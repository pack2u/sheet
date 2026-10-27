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
 * ★ POST /v3/sb/order 를 열었다 ★ (2026-10-13 · 문서는 GET 이라 적었지만 실측은 POST 전용)
 *   그 API 는 부르는 것만으로 «신규주문을 주문확인으로 바꾼다».
 *   updateOrderStsYn:"N" 을 빠뜨린 호출 한 번이 쇼핑몰 흐름을 어긋나게 하고,
 *   되돌릴 API 가 없다. 그래서 세 가지를 «같이» 넣었다 —
 *     ① ALLOWED 에 경로        ② READ_POST (읽기인 POST 를 운영계 잠금에서 뺌)
 *     ③ ORDER_GUARD ($body 를 읽은 뒤에서 「N」을 못박음)
 *   ★ 셋 중 하나만 빼고 올리지 말 것 ★ 특히 ③ 없이 ①만 넣으면 울타리가 없는 채 열린다.
 */
const ALLOWED = [
    // 조회 — 아무것도 바꾸지 않는다
    'GET /v3/sb/mall/SHOP'    => true,
    'GET /v3/sb/mall/CHOP'    => true,
    'GET /v3/sb/mall/GLOBAL'  => true,
    'GET /v3/sb/product'      => true,
    /*  ★ 읽기만 하는 것들 ★  (2026-10-23) 아무것도 안 바꾼다.
        물음표 뒤를 떼고 견주게 고쳤으므로 이제 값까지 넘길 수 있다. */
    'GET /v3/sb/category'          => true,
    'GET /v3/sb/standard-category' => true,
    /*  ★ claim·cs 는 «죽은 줄»이었다 ★  (2026-10-12 샌드박스 실측)
        GET 으로 부르면 405 GW_REQ_005 다 — order 와 마찬가지로 POST 전용이다.
        문서(PDF 247쪽)가 GET 이라고 적어 둔 것을 그대로 옮겨 적었던 것이다.

        ★ POST 로 «고치지 않고» 닫아 둔다 ★
          order 가 부르는 것만으로 신규주문을 주문확인으로 바꾸는 API 였다.
          claim·cs 도 수집하면서 「확인」 표시를 남기는지 모른다. 모르는 채
          POST 를 열면 그 한 번이 쇼핑몰 흐름을 바꿀 수 있다.
          개발자센터 규격을 보고 「읽기만 한다」를 확인한 뒤에 연다.         */
    'POST /v3/sb/claim'       => true,   // 2026-10-26 열었다 — 두 번 불러도 숫자가 그대로였다(읽기만 한다)
    'POST /v3/sb/cs'          => true,   // 2026-10-26 열었다 — 두 번 불러도 숫자가 그대로였다(읽기만 한다)

    // 쓰기 — 1단계
    'POST /v3/sb/waybill'     => true,
    /*  ★ 문의 답변 저장 ★  (2026-10-26)
        사장님 「답변 쓰는 것도 붙여줘」. 저장하면 사방넷이 **몰로 송신**한다 —
        손님에게 그대로 나가는 글이다. 아래 CS_ANSWER_GUARD 가 본다.  */
    'POST /v3/sb/cs/answer'   => true,
    /*  ★ 몰별 가격·상세페이지 ★  (2026-10-27)
        사장님 「Html을 만들었어.. 이걸 사방넷에 올리는 탭을 만들어줘」
        손님이 보는 상세페이지를 «덮어쓴다». 아래 CHANNEL_GUARD 가 본다.  */
    'POST /v3/sb/channels-product' => true,

    /*  ★ 주문 수집 ★  (2026-10-13)
        문서는 GET 이라고 적었지만 실측은 POST 전용이다(GET 은 405).
        부르는 것만으로 신규주문을 「주문확인」으로 바꾸는 API 라 여태 닫아 뒀다.
        아래 ORDER_GUARD 가 updateOrderStsYn 을 「N」으로 못박으므로 이제 연다.
        ★ 가드 없이 이 줄만 넣지 말 것 ★ 되돌릴 API 가 없다. */
    'POST /v3/sb/order'       => true,

    /*  ★ 품절·판매 보내기 ★  (2026-10-22)
        재고·품절을 사방넷에 적는 길. 아래 STOCK_GUARD 가 «두 칸만» 통과시킨다.
        ★ 가드 없이 이 줄만 넣지 말 것 ★ upsert 는 상품 전체를 덮어쓸 수 있는 API 다. */
    'POST /v3/sb/product/upsert' => true,
];

/*  ★ POST 지만 «읽기»인 것 ★  (2026-10-13)
    아래 운영계 쓰기 잠금은 「GET 이 아니면 쓰기」로 보고 막는다. 주문 수집은
    읽기인데 POST 라 거기 걸린다. 그렇다고 allowProdWrite 를 통째로 켜면
    상품·송장 쓰기까지 같이 열린다 — 그건 잠금을 둔 까닭을 지우는 일이다.
    그래서 «이 경로 하나»만 읽기로 빼 준다. 늘릴 때는 그 API 가 정말 아무것도
    안 바꾸는지 규격으로 확인하고 늘린다(claim·cs 는 아직 모른다). */
const READ_POST = [
    'POST /v3/sb/order' => true,
    /*  ★ 2026-10-26 ★ claim·cs 는 POST 지만 «읽기»다. 두 번 불러 숫자가 그대로였다.
        ALLOWED 에만 넣고 여기를 빼먹어 운영계 잠금(RELAY_PROD_WRITE_LOCKED)에 걸렸다 —
        이 파일 머리글의 「셋 중 하나만 빼고 올리지 말 것」이 그 말이었다. */
    'POST /v3/sb/claim' => true,
    'POST /v3/sb/cs'    => true,
];

/*  ★ 좁게 연 쓰기 ★  (2026-10-22)
    품절·판매 보내기는 «진짜 쓰기»다. 그렇다고 allowProdWrite 를 통째로 켜면
    송장 올리기까지 같이 열린다 — 송장은 한 번 나가면 쇼핑몰까지 번진다.
    그래서 이 경로 하나만 잠금에서 빼고, 대신 STOCK_GUARD 가 몸통을 샅샅이 본다.
    allowProdWrite 는 false 로 둔다. */
const STOCK_WRITE = [
    'POST /v3/sb/product/upsert' => true,
    /*  ★ 송장 올리기 ★  (2026-10-23)
        매일 1,700줄짜리 엑셀을 손으로 올리던 일. 아래 WAYBILL_GUARD 가 본다.
        ★ 가드 없이 이 줄만 넣지 말 것 ★ 송장은 한 번 나가면 쇼핑몰까지 번진다. */
    'POST /v3/sb/waybill' => true,
    'POST /v3/sb/cs/answer' => true,   // 2026-10-26 — CS_ANSWER_GUARD 가 본다
    'POST /v3/sb/channels-product' => true,  // 2026-10-27 — CHANNEL_GUARD 가 본다
];

const HOSTS = [
    'SANDBOX'    => 'https://sandbox.sabangnet.co.kr',
    'PRODUCTION' => 'https://api.sabangnet.co.kr',
];

header('Content-Type: application/json; charset=utf-8');
/*  ★ 판 번호 ★  (2026-10-22)
    올렸는지 «짐작»하지 않으려고 둔다. 모든 응답 머리에 실린다 —
    올리고 나서 이 값이 안 바뀌면 다른 자리에 올라간 것이다.
    [[ops-tab-carries-the-build-number]] 와 같은 뜻이다. */
header('X-Relay-Build: 20261027-product-create-b');

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

/*  ★ 물음표 뒤는 떼고 견준다 ★  (2026-10-23)
    `GET /v3/sb/product?customProductCode=JPCR00002` 를 보냈더니 RELAY_PATH_DENIED 였다.
    ALLOWED 에는 `GET /v3/sb/product` 가 있는데, 열쇠에 질의글자까지 붙여 만드니
    영영 안 맞는다. **GET 으로 값을 넘기는 API 가 통째로 막혀 있었다** —
    상품 조회·카테고리·고시 모두. 사방넷에 보낼 때는 $path 를 그대로 쓴다. */
$key = $method . ' ' . explode('?', $path, 2)[0];
if (!array_key_exists($key, ALLOWED)) {   // 상수 배열 — isset() 을 쓰면 안 된다 (위 참고)
    fail(403, 'RELAY_PATH_DENIED', '허용되지 않은 경로입니다: ' . $key);
}

/*  ★ 쓰기는 운영계에서 «한 번 더» 막는다 ★
    config 의 allowProdWrite 가 true 일 때만 운영계 쓰기를 통과시킨다.
    설치 직후 기본값은 false 다 — 샌드박스로 먼저 돌려 보고 사람이 연다. */
if ($env === 'PRODUCTION' && $method !== 'GET'
    && !array_key_exists($key, READ_POST)              // 읽기인 POST 는 뺀다 (위 참고)
    && !array_key_exists($key, STOCK_WRITE)            // 좁게 연 쓰기 (STOCK_GUARD 가 본다)
    && empty($CFG['allowProdWrite'])) {
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

/*  ══ ORDER_GUARD ══  (2026-10-13)
    주문 수집은 몸통에 updateOrderStsYn 이 없거나 「Y」면, 조회하는 것만으로
    «신규주문이 주문확인으로 바뀐다». 되돌릴 API 가 없다.

    ★ 반드시 $body 를 읽은 «뒤»에 둔다 ★ 앞에 두면 아래 한 줄이 통째로 덮어써
    가드가 아무 일도 안 한 채 조용히 지나간다. 처음에 그렇게 짰다가 찾았다.

    ★ 부르는 쪽을 믿지 않는다 ★ v2 든 GAS 든 사람 손이든 여기서 한 번 더 박는다.
      · 빠뜨렸으면 → 「N」으로 채운다. 흔한 실수이고 안전한 쪽이 분명하다.
      · 「N」이 아닌 값을 «일부러» 보냈으면 → 막는다.
        조용히 고쳐 주면 「상태를 바꾸려던 코드」가 살아남아 다음에 또 온다.
        그런 뜻이 담긴 호출은 여기서 터뜨려 사람이 찾게 한다. */
if ($key === 'POST /v3/sb/order') {
    if (!is_array($body)) $body = [];
    if (array_key_exists('updateOrderStsYn', $body)) {
        $v = strtoupper(trim((string)$body['updateOrderStsYn']));
        if ($v !== 'N') {
            fail(400, 'RELAY_ORDER_STS_GUARD',
                 'updateOrderStsYn 은 「N」이어야 합니다 (보낸 값: ' . $v . '). '
               . '조회만으로 신규주문이 「주문확인」으로 바뀌는 것을 막는 울타리입니다.');
        }
    }
    $body['updateOrderStsYn'] = 'N';
}

/*  ══ STOCK_GUARD ══  (2026-10-22)
    upsert 는 상품 «전체»를 덮어쓸 수 있는 API 다. 상세설명 14,853자까지 들어 있는
    물건이라, 몸통을 잘못 만들면 상품이 통째로 망가진다.

    그래서 이 길은 «두 갈래»로만 열어 둔다.

    ① 품절 갈래 — customProductCode · productSupplyStatusCode «두 칸만». 200건까지.
       이미 있는 상품의 파는가/안 파는가만 바꾼다. 상태값도 둘만 받는다.

    ② 등록 갈래 — 2026-10-27. 사장님 「상세페이지 올리는데 이게 상품등록까지 안되는건가?」
       사방넷에 «없는» 품목을 새로 만든다(자체상품코드가 없으면 I, 있으면 U).
       필수 16칸을 «정확히» 받는다. 하나라도 빠지거나 하나라도 더 오면 막는다.

       ★ 한 번에 한 건 ★ 등록은 사람이 눈으로 보며 하나씩 한다. 묶음으로 나가는
         길을 아예 안 낸다 — 틀린 몸통이 200건을 한꺼번에 망치는 자리를 없앤다.
       ★ optionInfo 는 «RESET 만» 받는다 ★  (2026-10-27 저녁에 고쳤다)
         처음에는 아예 안 받았는데, 운영계가 등록을 거절했다 —
           results[{ mode:"I", errorMessage:"[재고관리사용여부] 필수 입력" }]
         규격의 「필수 16칸」은 **샌드박스에서 가려낸 것**이라 운영계 등록에는 모자랐다.
         재고관리사용여부(stockUseYn)는 optionInfo 안에 있다.

         그래서 열되, 함정만 막는다:
           optionEditCode 는 **RESET 만** 받는다. MODIFIABLE 은 기존 단품을 전부
           지우고 다시 만든다 — 혹시 그 코드가 이미 있으면(U) 옵션이 전멸한다.
           RESET 은 optionDetailName 으로 찾아 그것만 고치고 나머지는 둔다.
         options 는 5개까지, 칸도 정해진 것만 받는다.
       ★ 이미 있는 코드인지는 여기서 모른다 ★ 그건 v2 가 보내기 «전에» GET 으로 본다.
         여기서 보는 것은 «몸통의 모양»이다. 둘 다 있어야 한다.

    두 갈래를 한 몸통에 섞지 못한다 — 섞이면 어느 울타리로 볼지 갈라진다.

    ★ 부르는 쪽을 믿지 않는다 ★ v2 가 맞게 만들어도 여기서 한 번 더 본다.
      화면이 바뀌거나 누가 손으로 부를 때 이 울타리만 남는다. */
if ($key === 'POST /v3/sb/product/upsert') {
    if (!is_array($body) || !isset($body['products']) || !is_array($body['products'])) {
        fail(400, 'RELAY_STOCK_GUARD', '몸통에 products 배열이 있어야 합니다.');
    }
    if (count($body['products']) === 0) {
        fail(400, 'RELAY_STOCK_GUARD', 'products 가 비어 있습니다.');
    }
    if (count($body['products']) > 200) {
        fail(400, 'RELAY_STOCK_GUARD', '한 번에 200건까지만 보냅니다 (' . count($body['products']) . '건).');
    }
    if (count($body) !== 1) {
        fail(400, 'RELAY_STOCK_GUARD',
             '몸통에는 products 만 있어야 합니다. 들어온 칸: ' . implode(', ', array_keys($body)));
    }
    $둘 = ['customProductCode' => true, 'productSupplyStatusCode' => true];
    $상태 = ['IN_SUPPLY' => true, 'OUT_OF_STOCK' => true];

    /*  ★ 등록 갈래의 필수 16칸 ★ (규격 「필수 칸 16개 — 한 칸씩 빼 보며 가려냈다」)
        값의 «모양»을 함께 적어 둔다. 여기 없는 이름은 통과 못 한다. */
    $등록칸 = [
        'productName'              => '글',   'customProductCode'       => '코드',
        'productDivisionCode'      => '갈래', 'myCategoryCodeL'         => '분류',
        'myCategoryCodeM'          => '분류', 'myCategoryCodeS'         => '분류',
        'manufacturerName'         => '글',   'originName'              => '글',
        'productTargetCode'        => '글',   'productSupplyStatusCode' => '상태',
        'deliveryCostCode'         => '글',   'taxCode'                 => '글',
        'costPrice'                => '돈',   'sellingPrice'            => '돈',
        'consumerPrice'            => '돈',   'productDetailDescription' => '긴글',
        /*  ★ 운영계가 더 달라고 한 것 ★ 아래 optionInfo 검사가 따로 본다 */
        'optionInfo'               => '옵션',
    ];
    /*  옵션 한 줄에 받을 칸 — 이 밖은 막는다 */
    $옵션칸 = ['optionName' => true, 'optionDetailName' => true, 'stockQuantity' => true,
               'safetyStockQuantity' => true, 'optionSupplyStatusCode' => true,
               'additionalAmount' => true, 'barcode' => true, 'ea' => true];

    /*  갈래를 «첫 줄»로 정하고, 나머지 줄도 같은 갈래인지 본다 */
    $첫 = $body['products'][0];
    if (!is_array($첫)) fail(400, 'RELAY_STOCK_GUARD', '1번째 줄이 객체가 아닙니다.');
    $등록인가 = false;
    foreach (array_keys($첫) as $k0) { if (!isset($둘[$k0])) { $등록인가 = true; break; } }

    if ($등록인가) {
        /*  ══ 등록 갈래 ══ */
        if (count($body['products']) !== 1) {
            fail(400, 'RELAY_STOCK_GUARD', '등록은 한 번에 한 건만 보냅니다 (' . count($body['products']) . '건).');
        }
        $p = $첫;
        foreach (array_keys($p) as $k) {
            if (!isset($등록칸[$k])) {
                fail(400, 'RELAY_STOCK_GUARD',
                     '등록에 허용되지 않은 칸이 있습니다: ' . $k
                   . ' — 필수 16칸만 보냅니다 (optionInfo 는 옵션을 전멸시켜 영영 안 받습니다).');
            }
        }
        foreach (array_keys($등록칸) as $k) {
            if (!array_key_exists($k, $p)) {
                fail(400, 'RELAY_STOCK_GUARD', '등록에 빠진 칸이 있습니다: ' . $k . ' — 필수 16칸을 다 보내야 합니다.');
            }
        }
        foreach ($등록칸 as $k => $꼴) {
            $v = $p[$k];
            if ($꼴 === '옵션') {
                if (!is_array($v)) fail(400, 'RELAY_STOCK_GUARD', 'optionInfo 가 객체가 아닙니다.');
                foreach (array_keys($v) as $ok) {
                    if ($ok !== 'stockUseYn' && $ok !== 'optionEditCode' && $ok !== 'options') {
                        fail(400, 'RELAY_STOCK_GUARD', 'optionInfo 에 허용되지 않은 칸이 있습니다: ' . $ok);
                    }
                }
                $use = isset($v['stockUseYn']) ? (string)$v['stockUseYn'] : '';
                if ($use !== 'Y' && $use !== 'N') {
                    fail(400, 'RELAY_STOCK_GUARD', 'optionInfo.stockUseYn 은 Y · N 만 됩니다: ' . $use);
                }
                /*  ★ 여기가 이 울타리의 심장이다 ★ MODIFIABLE 은 옵션을 전멸시킨다 */
                $ed = isset($v['optionEditCode']) ? (string)$v['optionEditCode'] : '';
                if ($ed !== 'RESET') {
                    fail(400, 'RELAY_STOCK_GUARD',
                         'optionInfo.optionEditCode 는 RESET 만 됩니다 (받은 값: ' . $ed . ')'
                       . ' — MODIFIABLE 은 그 상품의 단품을 전부 지우고 다시 만듭니다.');
                }
                $ops = isset($v['options']) ? $v['options'] : null;
                if (!is_array($ops) || count($ops) === 0) {
                    fail(400, 'RELAY_STOCK_GUARD', 'optionInfo.options 가 비었습니다.');
                }
                if (count($ops) > 5) {
                    fail(400, 'RELAY_STOCK_GUARD', 'optionInfo.options 는 5개까지입니다 (' . count($ops) . '개).');
                }
                foreach ($ops as $oi => $o) {
                    if (!is_array($o)) fail(400, 'RELAY_STOCK_GUARD', ($oi + 1) . '번째 옵션이 객체가 아닙니다.');
                    foreach (array_keys($o) as $okk) {
                        if (!isset($옵션칸[$okk])) {
                            fail(400, 'RELAY_STOCK_GUARD', ($oi + 1) . '번째 옵션에 허용되지 않은 칸이 있습니다: ' . $okk);
                        }
                    }
                    $dn = isset($o['optionDetailName']) ? trim((string)$o['optionDetailName']) : '';
                    if ($dn === '') {
                        fail(400, 'RELAY_STOCK_GUARD', ($oi + 1) . '번째 옵션에 optionDetailName 이 없습니다 — RESET 이 이 이름으로 찾습니다.');
                    }
                }
                continue;
            }
            if ($꼴 === '돈') {
                if (!is_numeric($v) || (int)$v < 0 || (int)$v > 100000000) {
                    fail(400, 'RELAY_STOCK_GUARD', $k . ' 가 돈이 아닙니다: ' . var_export($v, true));
                }
                continue;
            }
            $g = trim((string)$v);
            if ($g === '') fail(400, 'RELAY_STOCK_GUARD', $k . ' 가 비었습니다. 필수 칸은 빈 값으로 못 보냅니다.');
            if ($꼴 === '분류' && !preg_match('/^[A-Z][0-9]{1,4}$/', $g)) {
                fail(400, 'RELAY_STOCK_GUARD', $k . ' 모양이 이상합니다(A05·B47·C02 꼴): ' . $g);
            }
            if ($꼴 === '상태' && !isset($상태[$g])) {
                fail(400, 'RELAY_STOCK_GUARD', 'productSupplyStatusCode 가 IN_SUPPLY · OUT_OF_STOCK 이 아닙니다: ' . $g);
            }
            /*  상품구분은 우리가 쓰는 두 가지만 — 위탁(CONSIGN)·사입(PURCHASE) */
            if ($k === 'productDivisionCode' && $g !== 'PURCHASE' && $g !== 'CONSIGN') {
                fail(400, 'RELAY_STOCK_GUARD', 'productDivisionCode 는 PURCHASE · CONSIGN 만 됩니다: ' . $g);
            }
            if ($꼴 === '글' && mb_strlen($g, 'UTF-8') > 200) {
                fail(400, 'RELAY_STOCK_GUARD', $k . ' 이 너무 깁니다 (' . mb_strlen($g, 'UTF-8') . '자, 200자까지).');
            }
            if ($꼴 === '긴글' && strlen($g) > 2 * 1024 * 1024) {
                fail(400, 'RELAY_STOCK_GUARD', 'productDetailDescription 이 2MB 를 넘습니다.');
            }
        }
    } else {
    /*  ══ 품절 갈래 ══ (2026-10-22 부터 돌던 그대로) */
    foreach ($body['products'] as $i => $p) {
        if (!is_array($p)) {
            fail(400, 'RELAY_STOCK_GUARD', ($i + 1) . '번째 줄이 객체가 아닙니다.');
        }
        foreach (array_keys($p) as $k) {
            if (!isset($둘[$k])) {
                fail(400, 'RELAY_STOCK_GUARD',
                     ($i + 1) . '번째 줄에 허용되지 않은 칸이 있습니다: ' . $k
                   . ' — 품절·판매중 갈래로는 customProductCode 와 productSupplyStatusCode 만 보냅니다'
                   . ' (등록 갈래는 필수 16칸을 한 건으로 보냅니다).');
            }
        }
        $code = isset($p['customProductCode']) ? trim((string)$p['customProductCode']) : '';
        $st   = isset($p['productSupplyStatusCode']) ? trim((string)$p['productSupplyStatusCode']) : '';
        if ($code === '') {
            fail(400, 'RELAY_STOCK_GUARD', ($i + 1) . '번째 줄에 customProductCode 가 없습니다.');
        }
        if (!isset($상태[$st])) {
            fail(400, 'RELAY_STOCK_GUARD',
                 ($i + 1) . '번째 줄의 상태값이 IN_SUPPLY · OUT_OF_STOCK 이 아닙니다: ' . $st);
        }
    }
    }
}

/*  ══ CHANNEL_GUARD ══  (2026-10-27)
    ★ 이 길로 나간 글은 손님이 상세페이지에서 읽는다 ★
      `productDetailDescription` 은 그 몰의 상세페이지를 **통째로 덮는다.**
      되돌리려면 예전 HTML 을 우리가 갖고 있어야 한다 — 사방넷은 되돌려 주지 않는다.
      `salePrice` 도 그 몰의 판매가를 덮는다. 둘 다 돈과 손님에 바로 닿는다.

    ★ 2026-10-27 저녁 — 규격의 열다섯 칸을 다 연다 ★
      사장님 「몰별로 추가적으로 넣어야 되는 것들이 있는지 확인해주고 있으면 그부분도 세팅에」.
      규격(_docs/사방넷_API3.0_규격.md 「채널별 상품」)이 적은 칸은 이게 전부다:
        shopCode · customProductCode · salePrice · productName · productDetailDescription
        shopMallStockRate · shopMallShippingPolicyId · productAttributeClassificationCode
        productAuthorizationNumber · authorizationNumberIssueDate · authorizationDate
        authorizationExpiryDateFrom · authorizationExpiryDateTo
        authorizationOrganizationName · authorizationSphereName

      ★ 열되, 칸마다 «모양»을 본다 ★ 여는 것과 아무거나 받는 것은 다르다.
        재고비율은 0~100 정수, 날짜는 YYYYMMDD 여덟 자리, 코드는 글자·숫자만.
        사방넷은 **모르는 칸을 조용히 버리므로** 이름에 오타가 나도 아무 말이 없다 —
        통과시키면 「보냈는데 안 바뀐다」가 되고 까닭을 영영 못 찾는다. 여기서 돌려보낸다.

      ★ 인증 칸은 혼자 가지 않는다 ★ 발급일·기관만 덮고 번호가 없으면 몰에서
        인증정보가 반쪽이 된다. 하나라도 있으면 productAuthorizationNumber 를 같이 받는다.

      ★ 재고비율은 듣는지 아직 모른다 ★ 우리는 stockUseYn="N"(재고관리 안 씀)이다.
        길은 열되, 먹히는지는 보내 보고 사방넷 화면에서 확인해야 안다.

    ★ 한 번에 조금만 ★ 50건. 상세페이지는 한 건이 수만 자다.
      묶음으로 많이 나가는 길을 아예 안 낸다 — 잘못 쓰면 몰 전체가 같이 틀어진다.  */
if ($key === 'POST /v3/sb/channels-product') {
    if (!is_array($body) || !isset($body['products']) || !is_array($body['products'])) {
        fail(400, 'RELAY_CHANNEL_GUARD', '몸통에 products 배열이 있어야 합니다.');
    }
    foreach (array_keys($body) as $k) {
        if ($k !== 'products') {
            fail(400, 'RELAY_CHANNEL_GUARD', '몸통에 허용되지 않은 칸이 있습니다: ' . $k);
        }
    }
    $n = count($body['products']);
    if ($n === 0) fail(400, 'RELAY_CHANNEL_GUARD', 'products 가 비어 있습니다.');
    if ($n > 50)  fail(400, 'RELAY_CHANNEL_GUARD', '한 번에 50건까지만 보냅니다 (' . $n . '건).');

    /*  여기 없는 이름은 통과 못 한다 — 값의 «모양»을 칸마다 아래에서 본다. */
    $칸 = [
        'shopCode'                            => true,
        'customProductCode'                   => true,
        'salePrice'                           => true,
        'productName'                         => true,
        'productDetailDescription'            => true,
        'shopMallStockRate'                   => true,
        'shopMallShippingPolicyId'            => true,
        'productAttributeClassificationCode'  => true,
        'productAuthorizationNumber'          => true,
        'authorizationNumberIssueDate'        => true,
        'authorizationDate'                   => true,
        'authorizationExpiryDateFrom'         => true,
        'authorizationExpiryDateTo'           => true,
        'authorizationOrganizationName'       => true,
        'authorizationSphereName'             => true,
    ];
    /*  인증 묶음 — 하나라도 오면 번호를 같이 받는다 */
    $인증칸 = ['authorizationNumberIssueDate', 'authorizationDate',
               'authorizationExpiryDateFrom', 'authorizationExpiryDateTo',
               'authorizationOrganizationName', 'authorizationSphereName'];
    $총 = 0;
    foreach ($body['products'] as $i4 => $pd) {
        $자리 = ($i4 + 1) . '번째 줄';
        if (!is_array($pd)) fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '이 객체가 아닙니다.');
        foreach (array_keys($pd) as $k4) {
            if (!isset($칸[$k4])) {
                fail(400, 'RELAY_CHANNEL_GUARD',
                     $자리 . '에 허용되지 않은 칸이 있습니다: ' . $k4
                   . ' — 이 길로 보낼 수 있는 칸은 ' . implode(' · ', array_keys($칸)) . ' 입니다.');
            }
        }
        $shop = isset($pd['shopCode']) ? trim((string)$pd['shopCode']) : '';
        $code = isset($pd['customProductCode']) ? trim((string)$pd['customProductCode']) : '';
        if ($shop === '' || !preg_match('/^shop[0-9]{1,8}$/', $shop)) {
            fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 shopCode 가 이상합니다: ' . $shop);
        }
        if ($code === '') fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 customProductCode 가 비었습니다.');

        /*  ★ 가격이 0 이거나 음수면 막는다 ★ 0원짜리가 몰에 걸리는 사고를 미리 끊는다.
            「안 바꿀 거면 칸을 아예 빼라」가 이 길의 규칙이다 — 빈 값으로 덮지 않는다. */
        if (array_key_exists('salePrice', $pd)) {
            $pr = $pd['salePrice'];
            if (!is_numeric($pr) || (int)$pr <= 0) {
                fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 salePrice 가 0 이하이거나 숫자가 아닙니다. 안 바꿀 거면 칸을 빼세요.');
            }
            if ((int)$pr > 100000000) fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 salePrice 가 너무 큽니다.');
        }
        /*  ★ 재고비율 ★ 0~100 정수. 0 은 뜻이 있다(그 몰에 재고를 안 돌림) —
            품절 수단은 «아니다»(규격이 못박았다). 그래서 0 을 막지 않는다. */
        if (array_key_exists('shopMallStockRate', $pd)) {
            $rt = $pd['shopMallStockRate'];
            if (!is_int($rt) && !(is_string($rt) && preg_match('/^[0-9]{1,3}$/', $rt))) {
                fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 shopMallStockRate 는 0~100 정수여야 합니다: ' . var_export($rt, true));
            }
            if ((int)$rt < 0 || (int)$rt > 100) {
                fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 shopMallStockRate 는 0~100 입니다: ' . (int)$rt);
            }
        }

        /*  ★ 사방넷이 발급한 아이디·코드 ★ 글자·숫자·밑줄·붙임표만. 사람이 옮겨 적다
            공백이나 한글이 섞이면 사방넷이 조용히 버린다 — 여기서 돌려보낸다. */
        foreach (['shopMallShippingPolicyId', 'productAttributeClassificationCode'] as $id칸) {
            if (!array_key_exists($id칸, $pd)) continue;
            $v = trim((string)$pd[$id칸]);
            if ($v === '') fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 ' . $id칸 . ' 이 비었습니다. 안 바꿀 거면 칸을 빼세요.');
            if (!preg_match('/^[A-Za-z0-9_-]{1,50}$/', $v)) {
                fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 ' . $id칸 . ' 모양이 이상합니다(글자·숫자만): ' . $v);
            }
        }

        /*  ★ 날짜는 YYYYMMDD 여덟 자리 ★ 2026-01-01 처럼 보내면 사방넷이 버린다.
            달·날까지 실제로 있는 날인지 본다 — 20260230 은 막는다. */
        foreach (['authorizationNumberIssueDate', 'authorizationDate',
                  'authorizationExpiryDateFrom', 'authorizationExpiryDateTo'] as $날칸) {
            if (!array_key_exists($날칸, $pd)) continue;
            $d = (string)$pd[$날칸];
            if (!preg_match('/^[0-9]{8}$/', $d)
                || !checkdate((int)substr($d, 4, 2), (int)substr($d, 6, 2), (int)substr($d, 0, 4))) {
                fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 ' . $날칸 . ' 은 YYYYMMDD 여덟 자리여야 합니다: ' . $d);
            }
        }
        if (array_key_exists('authorizationExpiryDateFrom', $pd) && array_key_exists('authorizationExpiryDateTo', $pd)
            && (string)$pd['authorizationExpiryDateFrom'] > (string)$pd['authorizationExpiryDateTo']) {
            fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 인증 유효기간이 거꾸로입니다.');
        }

        /*  ★ 인증 칸은 혼자 가지 않는다 ★ 번호 없이 발급일·기관만 덮으면
            몰에서 인증정보가 반쪽이 된다. */
        foreach ($인증칸 as $인) {
            if (array_key_exists($인, $pd) && !array_key_exists('productAuthorizationNumber', $pd)) {
                fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '에 ' . $인 . ' 만 있고 productAuthorizationNumber 가 없습니다.');
            }
        }

        foreach (['productName', 'productDetailDescription',
                  'productAuthorizationNumber', 'authorizationOrganizationName', 'authorizationSphereName'] as $글칸) {
            if (!array_key_exists($글칸, $pd)) continue;
            $글 = (string)$pd[$글칸];
            if (trim($글) === '') {
                fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 ' . $글칸 . ' 이 비어 있습니다. 안 바꿀 거면 칸을 빼세요.');
            }
            /*  상세설명만 길다. 이름·인증기관에 수만 자가 들어오면 어딘가 잘못 담은 것이다. */
            if ($글칸 !== 'productDetailDescription' && mb_strlen($글, 'UTF-8') > 200) {
                fail(400, 'RELAY_CHANNEL_GUARD', $자리 . '의 ' . $글칸 . ' 이 너무 깁니다 (' . mb_strlen($글, 'UTF-8') . '자, 200자까지).');
            }
            $총 += strlen($글);
        }
    }
    /*  한 번에 보내는 글의 총량 — 2MB. 넘으면 사방넷이 통째로 거절해 무엇이 문제인지 안 보인다 */
    if ($총 > 2 * 1024 * 1024) {
        fail(400, 'RELAY_CHANNEL_GUARD', '보내는 글이 너무 많습니다 (' . round($총 / 1024) . 'KB). 2MB 까지입니다.');
    }
}

/*  ══ CS_ANSWER_GUARD ══  (2026-10-26)
    ★ 이 길로 나간 글은 손님이 읽는다 ★
      사방넷에 저장된 답변은 **원본 쇼핑몰로 송신**된다(csStatus=ANSWER_SENT).
      지우거나 고칠 길이 우리 쪽에 없다. 그래서 여태 만든 울타리 중 제일 좁게 짠다.

    규격은 떠서 알아냈다 (개발자센터 세션이 만료돼 문서를 못 읽었다) —
      { "items": [ { "csSrno": 숫자, "answerContent": "글" } ] }
      답은 data.results[{csSrno, status, errorMessage}] 건별로 온다.
      ★ 전부 실패하면 HTTP 400 이 온다 ★ HTTP 로 성패를 가르지 말 것.

    ★ 두 칸만 지나간다 ★ csSrno · answerContent.
      csStatus 같은 칸을 열어 두면 「강제전환」처럼 뜻 모를 상태가 끼어들 수 있다.

    ★ 한 번에 조금만 ★ 20건. 답변은 사람이 한 건씩 읽고 쓰는 일이다 —
      묶음으로 많이 나가는 길을 아예 안 낸다. 잘못 쓰면 손님 스무 명이 읽는다. */
if ($key === 'POST /v3/sb/cs/answer') {
    if (!is_array($body) || !isset($body['items']) || !is_array($body['items'])) {
        fail(400, 'RELAY_CS_ANSWER_GUARD', '몸통에 items 배열이 있어야 합니다.');
    }
    foreach (array_keys($body) as $k) {
        if ($k !== 'items') {
            fail(400, 'RELAY_CS_ANSWER_GUARD', '몸통에 허용되지 않은 칸이 있습니다: ' . $k);
        }
    }
    $n = count($body['items']);
    if ($n === 0)  fail(400, 'RELAY_CS_ANSWER_GUARD', 'items 가 비어 있습니다.');
    if ($n > 20)   fail(400, 'RELAY_CS_ANSWER_GUARD', '한 번에 20건까지만 보냅니다 (' . $n . '건). 답변은 한 건씩 읽고 쓰는 일입니다.');

    foreach ($body['items'] as $i3 => $it) {
        $자리 = ($i3 + 1) . '번째 줄';
        if (!is_array($it)) fail(400, 'RELAY_CS_ANSWER_GUARD', $자리 . '이 객체가 아닙니다.');
        foreach (array_keys($it) as $k3) {
            if ($k3 !== 'csSrno' && $k3 !== 'answerContent') {
                fail(400, 'RELAY_CS_ANSWER_GUARD',
                     $자리 . '에 허용되지 않은 칸이 있습니다: ' . $k3
                   . ' — 이 길로는 csSrno 와 answerContent 만 보냅니다.');
            }
        }
        $no = isset($it['csSrno']) ? trim((string)$it['csSrno']) : '';
        if ($no === '' || !ctype_digit($no)) {
            fail(400, 'RELAY_CS_ANSWER_GUARD', $자리 . '의 csSrno 가 숫자가 아닙니다: ' . $no);
        }
        $글 = isset($it['answerContent']) ? (string)$it['answerContent'] : '';
        $길이 = function_exists('mb_strlen') ? mb_strlen($글, 'UTF-8') : strlen($글);
        if (trim($글) === '') {
            fail(400, 'RELAY_CS_ANSWER_GUARD', $자리 . '의 answerContent 가 비어 있습니다. 빈 답변은 보내지 않습니다.');
        }
        if ($길이 > 2000) {
            fail(400, 'RELAY_CS_ANSWER_GUARD', $자리 . '의 answerContent 가 너무 깁니다 (' . $길이 . '자). 2000자까지입니다.');
        }
    }
}

/*  ══ WAYBILL_GUARD ══  (2026-10-23)
    송장은 사방넷에 적히는 순간 쇼핑몰로 번진다. 되돌리기가 제일 비싼 쓰기다.
    그래서 이 길로는 «네 칸만» 지나가게 한다 —
      sbOrderNo · deliveryCompanyCode · wayBillNo · (hopeDeliveryDate)

    ★ forceUpdateYn 은 「N」으로 못박는다 ★
      「Y」면 이미 붙은 송장을 덮어쓴다. 재출력 자리에서 조용히 바뀌면 어느 송장이
      진짜인지 아무도 모른다. 덮어써야 할 때는 사람이 사방넷 화면에서 한다.

    ★ 단 하나의 예외 — 「재출력 상황」 (2026-10-26) ★
      > 사장님: "재출력이 발생하는 경우 재출력상황 버튼을 만들어주면 그거 클릭하면 되디 않을까?"
      사람이 v2 화면에서 «고른» 주문만 온다. 그래서 Y 는 셋을 다 갖췄을 때만 연다 —
        reprint: true 표시(사방넷엔 안 보낸다) · 50건 이하 · 택배사 전부 로젠(007).
      표시 없이 Y 를 보내면 예전처럼 막힌다.

    ★ 부르는 쪽을 믿지 않는다 ★ v2 가 맞게 만들어도 여기서 한 번 더 본다. */
if ($key === 'POST /v3/sb/waybill') {
    if (!is_array($body) || !isset($body['waybillList']) || !is_array($body['waybillList'])) {
        fail(400, 'RELAY_WAYBILL_GUARD', '몸통에 waybillList 배열이 있어야 합니다.');
    }
    $n = count($body['waybillList']);
    if ($n === 0) fail(400, 'RELAY_WAYBILL_GUARD', 'waybillList 가 비어 있습니다.');
    if ($n > 500) fail(400, 'RELAY_WAYBILL_GUARD', '한 번에 500건까지만 보냅니다 (' . $n . '건).');

    foreach (array_keys($body) as $k) {
        if ($k !== 'waybillList' && $k !== 'forceUpdateYn' && $k !== 'reprint') {
            fail(400, 'RELAY_WAYBILL_GUARD', '몸통에 허용되지 않은 칸이 있습니다: ' . $k);
        }
    }
    $재출력 = array_key_exists('reprint', $body) && $body['reprint'] === true;
    unset($body['reprint']);
    $force = 'N';
    if (array_key_exists('forceUpdateYn', $body)) {
        $v = strtoupper(trim((string)$body['forceUpdateYn']));
        if ($v === 'Y' && $재출력) {
            if ($n > 50) fail(400, 'RELAY_WAYBILL_GUARD', '재출력 덮어쓰기는 한 번에 50건까지만 (' . $n . '건).');
            foreach ($body['waybillList'] as $i3 => $w3) {
                $c3 = is_array($w3) && isset($w3['deliveryCompanyCode']) ? trim((string)$w3['deliveryCompanyCode']) : '';
                if ($c3 !== '007') fail(400, 'RELAY_WAYBILL_GUARD', '재출력 덮어쓰기는 로젠(007)만 — ' . ($i3 + 1) . '번째 줄: ' . $c3);
            }
            $force = 'Y';
        } elseif ($v !== 'N') {
            fail(400, 'RELAY_WAYBILL_GUARD',
                 'forceUpdateYn 은 「N」이어야 합니다 (보낸 값: ' . $v . '). '
               . '이미 붙은 송장을 덮어쓰는 것을 막는 울타리입니다 — 재출력 상황에서 고른 것만 예외.');
        }
    }
    $body['forceUpdateYn'] = $force;

    $칸 = ['sbOrderNo' => true, 'deliveryCompanyCode' => true, 'wayBillNo' => true, 'hopeDeliveryDate' => true];
    foreach ($body['waybillList'] as $i2 => $w) {
        if (!is_array($w)) fail(400, 'RELAY_WAYBILL_GUARD', ($i2 + 1) . '번째 줄이 객체가 아닙니다.');
        foreach (array_keys($w) as $k2) {
            if (!isset($칸[$k2])) {
                fail(400, 'RELAY_WAYBILL_GUARD',
                     ($i2 + 1) . '번째 줄에 허용되지 않은 칸이 있습니다: ' . $k2
                   . ' — 이 길로는 sbOrderNo · deliveryCompanyCode · wayBillNo · hopeDeliveryDate 만 보냅니다.');
            }
        }
        $ord  = isset($w['sbOrderNo']) ? trim((string)$w['sbOrderNo']) : '';
        $car  = isset($w['deliveryCompanyCode']) ? trim((string)$w['deliveryCompanyCode']) : '';
        $wbno = isset($w['wayBillNo']) ? trim((string)$w['wayBillNo']) : '';
        if ($ord === '' || !ctype_digit($ord)) {
            fail(400, 'RELAY_WAYBILL_GUARD', ($i2 + 1) . '번째 줄의 sbOrderNo 가 숫자가 아닙니다: ' . $ord);
        }
        if (!preg_match('/^[0-9]{1,5}$/', $car)) {
            fail(400, 'RELAY_WAYBILL_GUARD', ($i2 + 1) . '번째 줄의 deliveryCompanyCode 가 택배사 코드 꼴이 아닙니다: ' . $car);
        }
        /*  송장번호는 10~14자리 숫자다. 하이픈이 섞여 오면 여기서 터뜨린다 —
            조용히 고쳐 주면 「하이픈을 넣는 코드」가 살아남아 다음에 또 온다. */
        if (!preg_match('/^[0-9]{9,16}$/', $wbno)) {
            fail(400, 'RELAY_WAYBILL_GUARD', ($i2 + 1) . '번째 줄의 wayBillNo 가 숫자 9~16자리가 아닙니다: ' . $wbno);
        }
    }
}

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
