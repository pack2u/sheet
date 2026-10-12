<?php
/**
 * ══════════════════════════════════════════════════════════════
 *  사방넷 API 3.0 중계기
 *
 *  ★ 왜 있나 ★
 *    두 가지 때문에 GAS 가 사방넷을 직접 못 부른다.
 *
 *    ① secretSign 이 BCrypt 다
 *       Apps Script Utilities 에는 BCrypt 가 없다(MD5·SHA·HMAC 뿐).
 *       손으로 짠 암호 코드를 돈이 걸린 자리에 두지 않는다.
 *       PHP 는 crypt() 가 bcrypt 를 기본으로 한다.
 *
 *    ② 허용 IP 가 아니면 «토큰 발급부터» 거부된다
 *       GAS 발신 IP 는 구글 대역에서 유동 배정되고 PTR 도 없어 등록할 수 없다.
 *       이 호스팅의 고정 IP(222.122.39.14)를 사방넷에 등록해 두었다.
 *
 *        [GAS 허브] → https://siot.com/pack2u/sabang/sabang.php → api.sabangnet.co.kr
 *
 *    로젠 중계기(_logen_relay/relay.php)와 «같은 꼴»이다. 새로 발명하지 않았다.
 *
 *  ★ 얇게 간다 ★
 *    사방넷 응답을 그대로 통과시킨다. 해석·정규화는 부르는 쪽(GAS)이 한다.
 *    여기에 로직을 넣으면 배포처가 둘로 갈려 유지보수가 나빠진다.
 *    다만 «토큰 발급»만은 여기서 한다 — BCrypt 가 여기에만 있기 때문이다.
 *
 *  ★ 토큰을 캐시한다 ★
 *    JWT 는 3시간이다. 호출마다 새로 받으면 TPS(10/초)를 토큰 발급이 먹는다.
 *    파일에 담아 두고 만료 5분 전부터 새로 받는다.
 *
 *  ★ 비밀은 여기 없다 ★
 *    clientCd·시크릿은 sabang_config.php 에 둔다. 이 파일은 git 에 올라가고
 *    config 는 안 올라간다(.gitignore). _secrets.gs 와 같은 규칙이다.
 *
 *  ★ 아무 데나 못 부르게 한다 ★
 *    경로를 화이트리스트로 막는다. 안 막으면 이 파일이 «아무 주소나 대신
 *    불러 주는 도구» 가 된다 — 토큰이 새는 날 남의 서버를 때리는 데 쓰인다.
 *
 *  ★ 쓰기는 따로 허락한다 ★
 *    조회(GET)와 달리 POST 는 사방넷 데이터를 바꾼다. 화이트리스트에
 *    메서드까지 적어 두고, 적힌 메서드가 아니면 거절한다.
 *
 *  설치: sabang.php + sabang_config.php 를 같은 폴더에 올린다.
 *        예) /siot00/www/pack2u/sabang/
 *        주소) https://siot.com/pack2u/sabang/sabang.php
 *
 *  실측 근거: _docs/사방넷_API3.0_규격.md
 * ══════════════════════════════════════════════════════════════
 */

$cfgPath = __DIR__ . '/sabang_config.php';
if (!is_file($cfgPath)) {
    http_response_code(500);
    echo json_encode(['code' => 'RELAY_NO_CONFIG',
                      'message' => 'sabang_config.php 가 없습니다'],
                     JSON_UNESCAPED_UNICODE);
    exit;
}
$CFG = require $cfgPath;

/** 올라간 판을 알아보려고 둔다. 고칠 때마다 올린다. */
const RELAY_VERSION = '2026-10-12a';

/**
 * 부를 수 있는 사방넷 경로 — 여기 없는 것은 거절한다.
 *
 * ★ 메서드까지 적는다 ★
 *   같은 경로라도 GET 은 읽기, POST 는 쓰기다. 쓰기를 늘릴 때는
 *   «의식해서» 이 표를 고치게 둔다.
 *
 * ★ POST /v3/sb/order 를 아직 열지 않았다 ★ (문서는 GET 이라 적었다 — 실측은 POST 전용)
 *   그 API 는 부르는 것만으로 «신규주문을 주문확인으로 바꾼다».
 *   updateOrderStsYn:"N" 을 빠뜨린 호출 한 번이 쇼핑몰 흐름을 어긋나게 한다.
 *   아래 ORDER_GUARD 가 그 값을 강제하도록 만든 뒤에 연다.
 */
const ALLOWED = [
    // 조회 — 아무것도 바꾸지 않는다
    'GET /v3/sb/mall/SHOP'    => true,
    'GET /v3/sb/mall/CHOP'    => true,
    'GET /v3/sb/mall/GLOBAL'  => true,
    'GET /v3/sb/product'      => true,
    /*  ★ claim·cs 는 «죽은 줄»이었다 ★  (2026-10-12 샌드박스 실측)
        GET 으로 부르면 405 GW_REQ_005 다 — order 와 마찬가지로 POST 전용이다.
        문서(PDF 247쪽)가 GET 이라고 적어 둔 것을 그대로 옮겨 적었던 것이다.

        ★ POST 로 «고치지 않고» 닫아 둔다 ★
          order 가 부르는 것만으로 신규주문을 주문확인으로 바꾸는 API 였다.
          claim·cs 도 수집하면서 「확인」 표시를 남기는지 모른다. 모르는 채
          POST 를 열면 그 한 번이 쇼핑몰 흐름을 바꿀 수 있다.
          개발자센터 규격을 보고 「읽기만 한다」를 확인한 뒤에 연다.         */
    // 'POST /v3/sb/claim'    => true,   ← 규격 확인 뒤
    // 'POST /v3/sb/cs'       => true,   ← 규격 확인 뒤

    // 쓰기 — 1단계
    'POST /v3/sb/waybill'     => true,
];

const HOSTS = [
    'SANDBOX'    => 'https://sandbox.sabangnet.co.kr',
    'PRODUCTION' => 'https://api.sabangnet.co.kr',
];

header('Content-Type: application/json; charset=utf-8');

/** 오류를 사방넷 응답과 «같은 모양» 으로 돌려준다 — 부르는 쪽이 한 갈래로 읽게 */
function fail($http, $code, $msg) {
    http_response_code($http);
    echo json_encode(['code' => $code, 'message' => $msg,
                      'timestamp' => round(microtime(true) * 1000),
                      'status' => $http],
                     JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 1. 요청 검사 ────────────────────────────────────────
/*  GET 으로 열면 «무엇이 올라가 있는지» 말해 준다.
    올리다 끊겨 0바이트가 되면 화면이 하얗게만 나와 원인을 못 찾는다 —
    로젠 중계기에서 2026-10-07 에 실제로 그랬다. 비밀은 보여 주지 않는다. */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(200);
    echo json_encode([
        'relay'   => 'sabang',
        'version' => RELAY_VERSION,
        'paths'   => count(ALLOWED),
        'note'    => '실제 호출은 POST 로만 받습니다.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$token = $_SERVER['HTTP_X_PROXY_TOKEN'] ?? '';
if (($CFG['token'] ?? '') === '' || !hash_equals($CFG['token'], $token)) {
    /* 토큰이 틀리면 «404 처럼» 굴지 않는다 — 부르는 쪽이 원인을 알아야 한다. */
    fail(401, 'RELAY_BAD_TOKEN', '중계기 토큰이 맞지 않습니다.');
}

$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) fail(400, 'RELAY_BAD_BODY', '요청 본문을 읽지 못했습니다.');

$method = strtoupper((string)($req['method'] ?? 'GET'));
$path   = (string)($req['path'] ?? '');
$env    = strtoupper((string)($req['env'] ?? 'SANDBOX'));

/*  ★ 상수 배열에는 isset() 을 못 쓴다 ★
    isset(HOSTS[$env]) 은 PHP 가 «Cannot use isset() on the result of an expression»
    으로 죽인다. 파서는 통과시키고 실행 때 터진다 — array_key_exists 를 쓴다. */
if (!array_key_exists($env, HOSTS)) fail(400, 'RELAY_BAD_ENV', 'env 는 SANDBOX 또는 PRODUCTION 입니다.');

/*  ★ 경로를 그대로 믿지 않는다 ★
    「/v3/sb/mall/SHOP/../../etc」 같은 것을 막는다. 화이트리스트가 1차 방어지만,
    경로 조작이 끼면 키가 달라져 어차피 걸린다 — 그래도 둘 다 둔다. */
if (strpos($path, '..') !== false || strpos($path, "\0") !== false) {
    fail(400, 'RELAY_BAD_PATH', '허용되지 않은 경로 모양입니다.');
}

$key = $method . ' ' . $path;
if (!array_key_exists($key, ALLOWED)) {   // 상수 배열 — isset() 을 쓰면 안 된다 (위 참고)
    fail(403, 'RELAY_PATH_DENIED', '허용되지 않은 경로입니다: ' . $key);
}

/*  ★ 쓰기는 운영계에서 «한 번 더» 막는다 ★
    config 의 allowProdWrite 가 true 일 때만 운영계 쓰기를 통과시킨다.
    설치 직후 기본값은 false 다 — 샌드박스로 먼저 돌려 보고 사람이 연다. */
if ($env === 'PRODUCTION' && $method !== 'GET' && empty($CFG['allowProdWrite'])) {
    fail(403, 'RELAY_PROD_WRITE_LOCKED',
         '운영계 쓰기가 잠겨 있습니다. sabang_config.php 의 allowProdWrite 를 켜세요.');
}

// ── 2. 토큰 발급 (캐시) ─────────────────────────────────
/**
 * 사방넷 JWT 를 받는다. 3시간짜리라 파일에 담아 두고 다시 쓴다.
 *
 * ★ secretSign = Base64( bcrypt("{clientCd}_{timestamp}", secret) ) ★
 *   시크릿이 곧 bcrypt salt 다 ($2a$10$ + 22자).
 *   PHP crypt() 는 salt 를 그대로 받아 자바 BCrypt.hashpw 와 같은 값을 낸다.
 *   (2026-10-12 Node bcryptjs 로 같은 식을 써서 운영계·샌드박스 둘 다 200 을 받았다)
 */
function 사방넷토큰($CFG, $env) {
    $cacheFile = __DIR__ . '/.token_' . strtolower($env) . '.json';

    if (is_file($cacheFile)) {
        $c = json_decode((string)file_get_contents($cacheFile), true);
        /* 만료 5분 전부터 새로 받는다 — 쓰는 도중에 끊기지 않게 */
        if (is_array($c) && !empty($c['token']) && ($c['exp'] ?? 0) > time() + 300) {
            return $c['token'];
        }
    }

    $secret = $env === 'SANDBOX' ? ($CFG['secretSandbox'] ?? '') : ($CFG['secretProduction'] ?? '');
    if ($secret === '') fail(500, 'RELAY_NO_SECRET', $env . ' 시크릿이 중계기에 없습니다.');

    $clientCd = (string)($CFG['clientCd'] ?? '');
    if ($clientCd === '') fail(500, 'RELAY_NO_CLIENTCD', 'clientCd 가 중계기에 없습니다.');

    $ts   = (string)round(microtime(true) * 1000);   // Unix milliseconds · 서버 시각 ±5분 30초
    $hash = crypt($clientCd . '_' . $ts, $secret);

    /*  ★ crypt() 가 실패하면 «짧은 문자열»을 돌려준다 ★
        salt 가 깨졌을 때 PHP 는 예외를 던지지 않고 "*0" 같은 것을 준다.
        그대로 보내면 사방넷이 AUTH_003(서명 오류)을 주고, 원인을 엉뚱한 데서 찾게 된다. */
    if (!is_string($hash) || strlen($hash) < 20 || strpos($hash, $secret) !== 0) {
        fail(500, 'RELAY_BAD_SIGN',
             'BCrypt 서명을 만들지 못했습니다. 시크릿이 $2a$10$+22자 모양인지 보세요.');
    }

    $post = http_build_query([
        'grant_type' => 'client_credentials',
        'clientType' => $CFG['clientType'] ?? 'SB_APP',
        'clientCd'   => $clientCd,
        'timestamp'  => $ts,
        'secretSign' => base64_encode($hash),
        'authMode'   => $env,
    ]);

    $ch = curl_init(HOSTS[$env] . '/oauth2/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $post,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT        => (int)($CFG['timeout'] ?? 20),
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $res  = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($res === false || $code === 0) {
        fail(502, 'RELAY_TOKEN_UNREACHABLE',
             '사방넷 인증 서버에 연결하지 못했습니다 (' . ($cerr !== '' ? $cerr : 'timeout') . ').');
    }
    $j = json_decode((string)$res, true);
    if ($code !== 200 || !is_array($j) || empty($j['access_token'])) {
        /*  ★ 사방넷이 준 말을 그대로 얹는다 ★
            AUTH_008/009 는 「이 서버 IP 가 등록 안 됐다」는 뜻이다.
            중계기가 제 말로 바꿔 버리면 그 단서가 사라진다. */
        $m = is_array($j) ? ($j['message'] ?? '') : substr((string)$res, 0, 200);
        $c = is_array($j) ? ($j['code'] ?? '') : '';
        /*  ★ 사방넷이 준 코드별로 어디를 보라고 짚어 준다 ★
            같은 「토큰 발급 실패」라도 원인이 셋이고 고치는 자리가 다르다. */
        $짚기 = '';
        if ($c === 'AUTH_008' || $c === 'AUTH_009') {
            $짚기 = ' — 이 서버 IP 가 사방넷 「연동 설정」에 등록돼 있는지 보세요.';
        } elseif ($c === 'AUTH_003') {
            /*  PHP crypt() 와 자바 BCrypt.hashpw 가 같은 값을 내야 한다.
                2026-10-12 Node bcryptjs 로는 운영계·샌드박스 둘 다 200 이었다.
                여기서만 AUTH_003 이면 crypt() 쪽을 의심한다. */
            $짚기 = ' — 서명(BCrypt)이 어긋났습니다. 시크릿이 $2a$10$+22자 모양인지,' .
                    ' 이 PHP 의 crypt() 가 bcrypt 를 지원하는지 보세요.';
        } elseif ($c === 'AUTH_006') {
            $짚기 = ' — 이 서버 시계가 ±5분 30초를 벗어났습니다. NTP 를 보세요.';
        }
        fail(502, 'RELAY_TOKEN_FAILED',
             '토큰 발급 실패 (' . $code . ' ' . $c . ') ' . $m . $짚기);
    }

    $exp = time() + (int)($j['expires_in'] ?? 10800);
    @file_put_contents($cacheFile,
        json_encode(['token' => $j['access_token'], 'exp' => $exp]), LOCK_EX);
    @chmod($cacheFile, 0600);
    return $j['access_token'];
}

$jwt = 사방넷토큰($CFG, $env);

// ── 3. 사방넷 호출 ──────────────────────────────────────
$url  = HOSTS[$env] . $path;
$body = array_key_exists('body', $req) ? $req['body'] : null;

$headers = [
    'Authorization: Bearer ' . $jwt,
    'X-Svc-Acnt-Id: ' . (string)($CFG['svcAcntId'] ?? ''),
    'Accept: */*',
];

$ch = curl_init($url);
$opt = [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_TIMEOUT        => (int)($CFG['timeout'] ?? 20),
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HEADER         => true,   // TPS 헤더를 되돌려 주려고 받는다
];
/*  ★ GET 에도 본문이 붙는다 ★
    사방넷 claim·order 는 GET 인데 JSON 본문을 받는다(실측). 흔치 않다.
    본문이 있으면 메서드와 상관없이 실어 보낸다. */
if ($body !== null) {
    $json = json_encode($body, JSON_UNESCAPED_UNICODE);
    if ($json === false) fail(400, 'RELAY_BAD_JSON', '본문을 JSON 으로 만들지 못했습니다.');
    $opt[CURLOPT_POSTFIELDS] = $json;
    $headers[] = 'Content-Type: application/json;charset=UTF-8';
}
$opt[CURLOPT_HTTPHEADER] = $headers;
curl_setopt_array($ch, $opt);

$res     = curl_exec($ch);
$code    = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$hdrSize = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$cerr    = curl_error($ch);
curl_close($ch);

if ($res === false || $code === 0) {
    fail(502, 'RELAY_UNREACHABLE',
         '사방넷에 연결하지 못했습니다 (' . ($cerr !== '' ? $cerr : 'timeout') . ').');
}

/*  ★ TPS 헤더를 되돌려 준다 ★
    버스트가 없어 남은 토큰이 중요하다. 부르는 쪽이 속도를 늦출 수 있어야 한다. */
$rawHdr = substr((string)$res, 0, $hdrSize);
$payload = substr((string)$res, $hdrSize);
foreach (explode("\n", $rawHdr) as $line) {
    if (stripos($line, 'x-ratelimit-') === 0) header(trim($line));
}

http_response_code($code);
echo $payload;
