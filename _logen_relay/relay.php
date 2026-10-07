<?php
/**
 * ══════════════════════════════════════════════════════════════
 *  로젠 OPEN API 중계기
 *
 *  ★ 왜 있나 ★
 *    로젠은 «등록된 공인 IP» 에서 온 호출만 받는다. 미등록 IP 는 401 이 아니라
 *    **TCP 연결 자체를 드롭**한다(2026-09-28 확인 — 사무실·호스팅 둘 다 timeout).
 *    CS웹앱은 Apps Script 라 발신 IP 가 구글 대역에서 유동 배정되고 PTR 도 없어
 *    IP 로도 도메인으로도 등록할 수 없다.
 *    그래서 **고정 IP 를 가진 이 호스팅이 대신 불러 준다.**
 *
 *        [CS웹앱 GAS] → https://siot.com/pack2u/logen/relay.php → [로젠]
 *                        (222.122.39.14 · 로젠에 등록된 IP)
 *
 *  ★ 얇게 간다 ★
 *    로젠 응답을 **그대로 통과**시킨다. 해석·정규화는 전부 csLogen.gs 가 한다.
 *    여기에 로직을 넣으면 배포처가 둘로 갈려 유지보수가 나빠진다.
 *
 *  ★ 비밀은 여기 없다 ★
 *    secretKey 와 접속 토큰은 relay_config.php 에 둔다. 이 파일은 git 에 올라가고
 *    config 는 안 올라간다(.gitignore). _secrets.gs 와 같은 규칙이다.
 *
 *  ★ 아무 데나 못 부르게 한다 ★
 *    api 이름을 화이트리스트로 막는다. 안 막으면 이 파일이 «아무 주소나 대신
 *    불러 주는 도구» 가 된다 — 토큰이 새는 날 남의 서버를 때리는 데 쓰인다.
 *
 *  설치: relay.php + relay_config.php 를 같은 폴더에 올린다.
 *        예) /siot00/www/pack2u/logen/
 *        주소) https://siot.com/pack2u/logen/relay.php
 * ══════════════════════════════════════════════════════════════
 */

// ── 설정 읽기 ───────────────────────────────────────────
$cfgPath = __DIR__ . '/relay_config.php';
if (!is_file($cfgPath)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['sttsCd' => 'FAIL', 'sttsMsg' => '중계기 설정 파일이 없습니다.'],
                     JSON_UNESCAPED_UNICODE);
    exit;
}
$CFG = require $cfgPath;

/** 올라간 판을 알아보려고 둔다. 고칠 때마다 올린다. */
const RELAY_VERSION = '2026-10-07a';

/** 부를 수 있는 로젠 API — 여기 없는 이름은 거절한다 */
const ALLOWED_APIS = [
    // 계약
    'contractTotalInfo', 'contPickFares',
    // 화물추적
    'inquiryCargoTrackingMulti', 'inquiryCargoTrackingMultiLast',
    // 주문·송장
    'inquirySlipNoMulti',
    // 주소로 지점, 분류코드, 제주/연륙도서/산간 여부를 묻는다 (읽기 전용, 2026-10-07 허용)
    'integratedInquiry',
    // 반품
    'registReturnRequest', 'reverseChkInfoMulti', 'contRtnFares',
    'inquiryReserveStateMulti', 'inquiryReserveStateFixTakeNo',
    'inquiryReturnStateMulti', 'cancelReserveState',
    // 기타
    'custExtraFare',
];

const HOSTS = [
    'dev'  => 'https://topenapi.ilogen.com',
    'prod' => 'https://openapi.ilogen.com',
];
const LOGEN_PATH = '/lrm02b-edi/edi/';

header('Content-Type: application/json; charset=utf-8');

/** 오류를 로젠 응답과 «같은 모양» 으로 돌려준다 — csLogen.gs 가 한 갈래로 읽게 */
function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['sttsCd' => 'FAIL', 'sttsMsg' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 1. 요청 검사 ────────────────────────────────────────
/*  GET 으로 열면 «무엇이 올라가 있는지» 말해 준다.
    올리다 끊겨 0바이트가 되면 화면이 하얗게만 나와 원인을 못 찾는다 —
    실제로 2026-10-07 에 그랬다. 판 번호가 보이면 올라간 것이 맞는지 바로 안다.
    비밀은 없다. 토큰도 키도 안 보여 준다. */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(200);
    echo json_encode([
        'relay'   => 'logen',
        'version' => RELAY_VERSION,
        'apis'    => count(ALLOWED_APIS),
        'note'    => '실제 호출은 POST 로만 받습니다.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$token = $_SERVER['HTTP_X_PROXY_TOKEN'] ?? '';
if ($CFG['token'] === '' || !hash_equals($CFG['token'], $token)) {
    // 토큰이 틀리면 «404 처럼» 굴지 않는다 — 부르는 쪽이 원인을 알아야 한다.
    fail(401, '중계기 토큰이 맞지 않습니다.');
}

$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) {
    fail(400, '요청 본문을 읽지 못했습니다.');
}

$api = (string)($req['api'] ?? '');
if (!in_array($api, ALLOWED_APIS, true)) {
    fail(400, '허용되지 않은 API 입니다: ' . $api);
}

$env = ($req['env'] ?? 'prod') === 'dev' ? 'dev' : 'prod';
$key = $env === 'dev' ? $CFG['secretKeyDev'] : $CFG['secretKeyProd'];
if ($key === '') {
    fail(500, ($env === 'dev' ? '개발계' : '운영계') . ' 인증키가 중계기에 없습니다.');
}

$body = $req['body'] ?? new stdClass();
$payload = json_encode($body, JSON_UNESCAPED_UNICODE);
if ($payload === false) {
    fail(400, '본문을 JSON 으로 만들지 못했습니다.');
}

// ── 2. 로젠 호출 ────────────────────────────────────────
$url = HOSTS[$env] . LOGEN_PATH . $api;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json;charset=UTF-8',
        'secretKey: ' . $key,
    ],
    CURLOPT_TIMEOUT        => (int)$CFG['timeout'],
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

$res  = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$cerr = curl_error($ch);
curl_close($ch);

// ── 3. 응답 그대로 돌려주기 ─────────────────────────────
if ($res === false || $code === 0) {
    /* 연결 자체가 안 됐다. 로젠은 미등록 IP 를 «드롭» 하므로 여기서 timeout 이 난다.
       원인을 짚어 줘야 CS 화면에서 헤매지 않는다. */
    fail(502, '로젠 서버에 연결하지 못했습니다 (' . ($cerr !== '' ? $cerr : 'timeout') .
              '). 이 서버 IP 가 로젠에 등록되어 있는지 확인하세요.');
}

http_response_code($code);
echo $res;
