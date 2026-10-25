<?php
/**
 * ══════════════════════════════════════════════════════════════
 *  쿠팡 Open API 중계기 — 읽기만                            (2026-10-25)
 *
 *  ★ 왜 있나 ★
 *    쿠팡도 IP 화이트리스트다. v2(Vercel)는 나가는 IP 가 고정이 아니라 못 부른다.
 *    이 호스팅의 고정 IP(222.122.39.14)를 쿠팡에 등록해 두고 여기로 지나간다.
 *      [v2] → https://siot.com/pack2u/coupang/coupang.php → api-gateway.coupang.com
 *    사방넷 중계기(_sabang_relay/sabang.php)와 같은 꼴이다. 새로 배우지 않아도 된다.
 *
 *  ★ 사방넷 중계기와 «다른» 점 — 서명을 여기서 안 만든다 ★
 *    사방넷은 BCrypt 를 GAS 가 못 해서 중계기가 서명했다. 쿠팡은 HMAC-SHA256 이라
 *    v2 가 직접 만들 수 있다. 그래서 **비밀키를 이 공용 호스팅에 두지 않는다.**
 *    v2 가 서명한 Authorization 머리글을 그대로 받아 실어 보낸다.
 *    → 이 파일이 새어도 쿠팡 요청을 «새로 만들지는» 못한다. 울타리가 하나 더 있는 셈이다.
 *
 *  ★ 읽기만 ★ 이 판에는 GET 밖에 없다.
 *    출고중지완료·이미출고·반품승인(PATCH)은 가드를 따로 짜고 깨 본 뒤에 연다.
 *    「나중에 쓰려고」 미리 열어 두지 않는다 — 열어 두면 눌린다.
 *
 *  ★ 쿠팡은 테스트 환경이 없다 ★ (개발자센터 기타문의 11번)
 *    그래서 깨 보는 시험은 «가드까지»만 한다: 길을 틀리게 보내 400 이 오는지만 본다.
 *    _coupang_guard_check.mjs
 *
 *  올릴 곳: /siot00/www/pack2u/coupang/  (coupang.php + coupang_config.php 둘 다)
 *  주소:    https://siot.com/pack2u/coupang/coupang.php
 *
 *  문서: Pack2U_협력업체시스템_v2/_docs/2026-10-24_쿠팡_반품취소_설계.md
 *        상품정보sheet/_docs/2026-10-24_몰_직접API_조사.md
 * ══════════════════════════════════════════════════════════════
 */

$cfgPath = __DIR__ . '/coupang_config.php';
if (!is_file($cfgPath)) {
    http_response_code(500);
    echo json_encode(['code' => 'RELAY_NO_CONFIG',
                      'message' => 'coupang_config.php 가 없습니다'],
                     JSON_UNESCAPED_UNICODE);
    exit;
}
$CFG = require $cfgPath;

const COUPANG_HOST = 'https://api-gateway.coupang.com';

/*  ★ 판 번호 ★ 올렸는지 «짐작»하지 않으려고 둔다. 모든 응답 머리에 실린다.
    올리고 나서 이 값이 안 바뀌면 다른 자리에 올라간 것이다. */
const RELAY_BUILD = '20261025-read-only';

/**
 * ★ 지나갈 수 있는 길 ★ 적힌 것만. vendorId 는 업체마다 달라 본으로 적는다.
 *   전부 GET 이다. 쓰기는 이 판에 없다.
 *   (문서 경로 그대로 — 목록은 v6, 단건·철회이력은 문서에 적힌 그대로)
 */
const ALLOWED = [
    // 반품/취소 요청 목록 조회
    '#^/v2/providers/openapi/apis/api/v6/vendors/[A-Za-z0-9]{1,20}/returnRequests$#',
    // 반품요청 단건 조회
    '#^/v2/providers/openapi/apis/api/v5/vendors/[A-Za-z0-9]{1,20}/returnRequests/[0-9]{1,20}$#',
    '#^/v2/providers/openapi/apis/api/v1/vendors/[A-Za-z0-9]{1,20}/returnRequests/[0-9]{1,20}$#',
    // 반품철회 이력 기간별 조회
    '#^/v2/providers/openapi/apis/api/v1/vendors/[A-Za-z0-9]{1,20}/returnWithdrawList$#',
    // 발주서 목록 조회 (분단위) — 세트분리 맞대기에 쓸 수 있게 미리 둔다. 읽기다
    '#^/v2/providers/openapi/apis/api/v4/vendors/[A-Za-z0-9]{1,20}/ordersheets$#',
];

/**
 * ★ 질의글에 올 수 있는 칸 ★ 적힌 것만.
 *   모르는 칸이 끼면 서명과 어긋나 어차피 쿠팡이 막지만, 여기서 먼저 막아
 *   «무엇이 틀렸는지»를 알려 준다(쿠팡 400 은 까닭을 잘 안 알려준다).
 */
const QUERY_OK = [
    'searchType' => true, 'createdAtFrom' => true, 'createdAtTo' => true,
    'status' => true, 'cancelType' => true, 'orderId' => true,
    'nextToken' => true, 'maxPerPage' => true,
    // 발주서 목록
    'vendorItemId' => true, 'searchByOrderId' => true,
];

header('Content-Type: application/json; charset=utf-8');
header('X-Relay-Build: ' . RELAY_BUILD);

/** 오류를 쿠팡 응답과 «같은 모양»으로 돌려준다 — 부르는 쪽이 한 갈래로 읽게 */
function fail($http, $code, $msg) {
    http_response_code($http);
    echo json_encode(['code' => $code, 'message' => $msg, 'status' => $http,
                      'timestamp' => round(microtime(true) * 1000)],
                     JSON_UNESCAPED_UNICODE);
    exit;
}

/*  GET 으로 열면 «무엇이 올라가 있는지» 말해 준다.
    올리다 끊겨 0바이트가 되면 화면이 하얗게만 나와 원인을 못 찾는다 —
    로젠 중계기에서 2026-10-07 에 실제로 그랬다. 비밀은 보여 주지 않는다. */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(200);
    echo json_encode([
        'relay'   => 'coupang',
        'build'   => RELAY_BUILD,
        'paths'   => count(ALLOWED),
        'writes'  => false,
        'note'    => '실제 호출은 POST 로만 받습니다. 서명은 부르는 쪽(v2)이 만듭니다.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$token = $_SERVER['HTTP_X_PROXY_TOKEN'] ?? '';
if (($CFG['token'] ?? '') === '' || !hash_equals((string)$CFG['token'], (string)$token)) {
    /* 토큰이 틀리면 «404 처럼» 굴지 않는다 — 부르는 쪽이 원인을 알아야 한다. */
    fail(401, 'RELAY_BAD_TOKEN', '중계기 토큰이 맞지 않습니다.');
}

$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) fail(400, 'RELAY_BAD_BODY', '요청 본문을 읽지 못했습니다.');

$method = strtoupper((string)($req['method'] ?? 'GET'));
$path   = (string)($req['path'] ?? '');
$query  = (string)($req['query'] ?? '');
$auth   = (string)($req['authorization'] ?? '');

/* ── 울타리 ① 읽기만 ── */
if ($method !== 'GET') {
    fail(400, 'RELAY_READ_ONLY',
         '이 중계기는 읽기(GET)만 지나갑니다. 쓰기는 가드를 따로 세운 뒤에 엽니다.');
}

/* ── 울타리 ② 경로 모양 ── 「/../」 같은 것을 먼저 막는다 */
if (strpos($path, '..') !== false || strpos($path, "\0") !== false || strpos($path, '?') !== false) {
    fail(400, 'RELAY_BAD_PATH', '허용되지 않은 경로 모양입니다. (query 는 따로 보내세요)');
}

/* ── 울타리 ③ 적힌 길인가 ── */
$okPath = false;
foreach (ALLOWED as $re) { if (preg_match($re, $path)) { $okPath = true; break; } }
if (!$okPath) fail(403, 'RELAY_PATH_DENIED', '허용되지 않은 경로입니다: ' . $path);

/* ── 울타리 ④ 질의글의 칸 ── 적힌 칸만. 글자도 눈여겨본다 */
if ($query !== '') {
    if (strpos($query, "\0") !== false) fail(400, 'RELAY_BAD_QUERY', 'query 에 못 쓸 글자가 있습니다.');
    if (strlen($query) > 600) fail(400, 'RELAY_BAD_QUERY', 'query 가 너무 깁니다.');
    foreach (explode('&', $query) as $pair) {
        if ($pair === '') continue;
        $kv = explode('=', $pair, 2);
        $k  = $kv[0];
        if (!array_key_exists($k, QUERY_OK)) {
            fail(400, 'RELAY_QUERY_DENIED', '허용되지 않은 질의 칸입니다: ' . $k);
        }
    }
}

/* ── 울타리 ⑤ 서명 모양 ──
   ★ 여기서 서명을 «만들지» 않는다 ★ 다만 꼴이 맞는지는 본다 —
   빈 머리글을 그대로 보내면 쿠팡이 401 을 주고, 그 401 을 「IP 문제」로 잘못 읽게 된다. */
if (!preg_match('/^CEA algorithm=HmacSHA256, access-key=[A-Za-z0-9\-_]{4,64}, signed-date=[0-9]{6}T[0-9]{6}Z, signature=[0-9a-f]{64}$/', $auth)) {
    fail(400, 'RELAY_BAD_AUTH',
         'Authorization 머리글 꼴이 쿠팡 규격과 다릅니다. 서명은 부르는 쪽(v2)이 만들어 보냅니다.');
}

/* ── 보낸다 ── */
$url = COUPANG_HOST . $path . ($query !== '' ? '?' . $query : '');

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => 'GET',
    CURLOPT_TIMEOUT        => (int)($CFG['timeout'] ?? 30),
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HEADER         => true,   // 호출 경고 머리글을 되돌려 주려고 받는다
    CURLOPT_HTTPHEADER     => [
        'Authorization: ' . $auth,
        'Content-Type: application/json;charset=UTF-8',
        'Accept: application/json',
    ],
]);

$res     = curl_exec($ch);
$code    = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$hdrSize = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$cerr    = curl_error($ch);
curl_close($ch);

if ($res === false || $code === 0) {
    fail(502, 'RELAY_UNREACHABLE',
         '쿠팡에 연결하지 못했습니다 (' . ($cerr !== '' ? $cerr : 'timeout') . ').');
}

/*  ★ 호출 경고 머리글을 되돌려 준다 ★
    쿠팡은 숫자로 된 TPS 를 문서에 안 적어 두고, 임계치 90% 에서 X-CAG-Warnings 로만
    울어 준다(기타문의 16번). 부르는 쪽이 속도를 늦출 수 있어야 한다. */
$rawHdr  = substr((string)$res, 0, $hdrSize);
$payload = substr((string)$res, $hdrSize);
foreach (explode("\n", $rawHdr) as $line) {
    $l = strtolower(trim($line));
    if (strpos($l, 'x-cag-') === 0 || strpos($l, 'x-ratelimit-') === 0 || strpos($l, 'retry-after') === 0) {
        header(trim($line));
    }
}

http_response_code($code);
echo $payload;
