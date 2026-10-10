<?php
/**
 * ══════════════════════════════════════════════════════════════
 *  로젠 중계기 — 호스팅 적합성 점검 (probe)
 *
 *  ★ 무엇을 보려고 만들었나 ★
 *    로젠 OPEN API 는 «등록된 공인 IP» 에서 온 호출만 받는다.
 *    CS웹앱은 Apps Script 라 고정 IP 가 없다(발신이 구글 대역에서 유동 배정).
 *    그래서 고정 IP 를 가진 곳에 중계기를 하나 두어야 하는데,
 *    **이미 쓰고 있는 siot.com 공유호스팅이 그 자리가 될 수 있는지** 본다.
 *
 *    세 가지를 한 번에 확인한다:
 *      ① PHP 가 도는가 · 외부 호출에 필요한 확장이 있는가
 *      ② 밖으로 나갈 때 «어떤 IP» 를 쓰는가  ← 이 값을 로젠에 등록한다
 *      ③ 로젠 서버에 실제로 닿는가 (키 없이도 401 이 오면 «닿은» 것이다)
 *
 *  ★ 쓰는 법 ★
 *    1. 이 파일을 호스팅에 올린다   예) /siot00/www/pack2u/probe.php
 *    2. 브라우저로 연다            예) https://siot.com/pack2u/probe.php?k=p2u-logen-check
 *    3. 화면 맨 아래 「판정」을 본다
 *    4. **확인이 끝나면 지운다.** 진단용이라 계속 둘 이유가 없다.
 *
 *  ★ 안전 ★
 *    아무나 열어 서버 정보를 보지 못하게 열쇠말을 둔다(아래 PROBE_KEY).
 *    비밀은 아니지만, 주소만 알면 누구나 보는 상태로는 두지 않는다.
 *    로젠에 보내는 요청에는 **인증키를 싣지 않는다** — 닿는지만 보므로 401 이 정상이다.
 * ══════════════════════════════════════════════════════════════
 */

const PROBE_KEY = 'p2u-logen-check';

if (!isset($_GET['k']) || $_GET['k'] !== PROBE_KEY) {
    http_response_code(404);
    exit('Not Found');
}

header('Content-Type: text/html; charset=utf-8');

/** 값 하나를 HTML 로 안전하게 */
function h($v) { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }

/**
 * 외부 호출. curl 이 있으면 curl, 없으면 file_get_contents 로 대신한다.
 * @return array{ok:bool, code:int, body:string, err:string, via:string}
 */
function fetch_url($url, $method = 'GET', $payload = null, $timeout = 12) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => $timeout,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payload === null ? '' : $payload);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json;charset=UTF-8']);
        }
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        return ['ok' => $body !== false, 'code' => $code,
                'body' => (string)$body, 'err' => $err, 'via' => 'curl'];
    }

    if (ini_get('allow_url_fopen')) {
        $opts = ['http' => ['method' => $method, 'timeout' => $timeout,
                            'ignore_errors' => true]];
        if ($method === 'POST') {
            $opts['http']['header']  = "Content-Type: application/json;charset=UTF-8\r\n";
            $opts['http']['content'] = $payload === null ? '' : $payload;
        }
        $body = @file_get_contents($url, false, stream_context_create($opts));
        $code = 0;
        if (isset($http_response_header)) {
            foreach ($http_response_header as $line) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) $code = (int)$m[1];
            }
        }
        return ['ok' => $body !== false, 'code' => $code,
                'body' => (string)$body, 'err' => $body === false ? '호출 실패' : '',
                'via' => 'file_get_contents'];
    }

    return ['ok' => false, 'code' => 0, 'body' => '',
            'err' => 'curl 도 allow_url_fopen 도 없다', 'via' => '없음'];
}

// ── ① PHP 환경 ────────────────────────────────────────
$env = [
    'PHP 버전'        => PHP_VERSION,
    'curl 확장'       => function_exists('curl_init') ? '있음' : '없음',
    'openssl(HTTPS)'  => extension_loaded('openssl') ? '있음' : '없음',
    'allow_url_fopen' => ini_get('allow_url_fopen') ? '켜짐' : '꺼짐',
    'json'            => function_exists('json_encode') ? '있음' : '없음',
    '서버가 본 내 주소' => $_SERVER['SERVER_ADDR'] ?? '(모름)',
];
$canCallOut = function_exists('curl_init') || ini_get('allow_url_fopen');

// ── ② 나가는 IP ───────────────────────────────────────
$outIp = '';      // 진짜 발신 IP (체인 맨 뒤)
$outChain = '';
$ipifyIp = '';
$outErr = '';

if ($canCallOut) {
    $r = fetch_url('https://httpbin.org/get');
    if ($r['ok'] && $r['body'] !== '') {
        $j = json_decode($r['body'], true);
        if (isset($j['origin'])) {
            $outChain = $j['origin'];
            $parts = array_map('trim', explode(',', $j['origin']));
            $outIp = end($parts);   // 맨 뒤가 실제 발신
        } else {
            $outErr = 'httpbin 응답에 origin 이 없다';
        }
    } else {
        $outErr = $r['err'] !== '' ? $r['err'] : ('HTTP ' . $r['code']);
    }

    $r2 = fetch_url('https://api.ipify.org');
    if ($r2['ok']) $ipifyIp = trim($r2['body']);
}

// ── ③ 로젠 도달 여부 ──────────────────────────────────
// 인증키를 싣지 않는다. 닿기만 하면 401 이 온다 — 그게 「도달했다」는 증거다.
$logen = [];
if ($canCallOut) {
    foreach ([
        '개발계 topenapi' => 'https://topenapi.ilogen.com/lrm02b-edi/edi/contractTotalInfo',
        '운영계 openapi'  => 'https://openapi.ilogen.com/lrm02b-edi/edi/contractTotalInfo',
    ] as $label => $url) {
        $r = fetch_url($url, 'POST', '{}', 12);
        $logen[$label] = [
            'code' => $r['code'],
            'err'  => $r['err'],
            'body' => mb_substr(trim($r['body']), 0, 200),
        ];
    }
}

// ── ④ 판정 ───────────────────────────────────────────
$verdict = [];
if (!$canCallOut) {
    $verdict[] = ['bad', '외부 호출이 불가능하다 — 이 호스팅은 중계기로 쓸 수 없다. VPS 로 가야 한다.'];
} else {
    $verdict[] = ['good', 'PHP 에서 외부 호출이 된다.'];

    if ($outIp === '') {
        $verdict[] = ['bad', '나가는 IP 를 못 쟀다 — ' . $outErr];
    } else {
        $verdict[] = ['good', '나가는 IP = ' . $outIp . '  ← 이 값을 로젠에 등록한다'];
        if ($ipifyIp !== '' && $ipifyIp !== $outIp) {
            $verdict[] = ['warn', 'ipify 는 ' . $ipifyIp . ' 로 본다 — 중간에 프록시가 있을 수 있으니 두 값을 모두 로젠에 알릴 것'];
        }
        $srv = $_SERVER['SERVER_ADDR'] ?? '';
        if ($srv !== '' && $srv !== $outIp) {
            $verdict[] = ['warn', '들어오는 IP(' . $srv . ')와 나가는 IP 가 다르다 — 등록은 «나가는» 쪽으로 해야 한다'];
        }
    }

    $reach = false;
    foreach ($logen as $label => $v) {
        if ($v['code'] > 0) { $reach = true; }
    }
    if ($reach) {
        $verdict[] = ['good', '로젠 서버에 닿는다. (키가 없어 401/400 이 오는 것이 정상이다)'];
    } else {
        $verdict[] = ['bad', '로젠 서버에 닿지 못했다 — 호스팅이 외부 접속을 막고 있을 수 있다.'];
    }
}
?>
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>로젠 중계기 적합성 점검</title>
<style>
  body { font: 15px/1.7 -apple-system, "Malgun Gothic", sans-serif;
         margin: 0; padding: 20px; background: #f6f7f9; color: #1a1a1a; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
  section { background: #fff; border-radius: 10px; padding: 16px 18px;
            margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
  h2 { font-size: 15px; margin: 0 0 10px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  td:first-child { color: #666; width: 40%; }
  code { background: #f0f1f3; padding: 1px 5px; border-radius: 4px;
         font-size: 13px; word-break: break-all; }
  .v { padding: 9px 12px; border-radius: 7px; margin-bottom: 7px; font-size: 14px; }
  .good { background: #e8f5ea; border-left: 4px solid #2e9e4f; }
  .warn { background: #fff6e0; border-left: 4px solid #e0a020; }
  .bad  { background: #fdeaea; border-left: 4px solid #d34040; }
  .big { font-size: 19px; font-weight: 700; letter-spacing: .3px; }
  .note { font-size: 13px; color: #777; margin-top: 12px; }
</style>
<div class="wrap">
<h1>로젠 중계기 적합성 점검</h1>
<div class="sub">이 호스팅이 로젠 OPEN API 중계기로 쓸 수 있는지 봅니다 · <?= h(date('Y-m-d H:i')) ?></div>

<section>
  <h2>판정</h2>
  <?php foreach ($verdict as $v): ?>
    <div class="v <?= h($v[0]) ?>"><?= h($v[1]) ?></div>
  <?php endforeach; ?>
  <?php if ($outIp !== ''): ?>
    <div class="v good big">로젠에 등록할 IP : <?= h($outIp) ?></div>
  <?php endif; ?>
</section>

<section>
  <h2>① PHP 환경</h2>
  <table>
    <?php foreach ($env as $k => $v): ?>
      <tr><td><?= h($k) ?></td><td><code><?= h($v) ?></code></td></tr>
    <?php endforeach; ?>
  </table>
</section>

<section>
  <h2>② 밖으로 나갈 때 쓰는 IP</h2>
  <table>
    <tr><td>진짜 발신 IP</td><td><code><?= h($outIp !== '' ? $outIp : '(못 쟀음)') ?></code></td></tr>
    <tr><td>httpbin 이 본 체인</td><td><code><?= h($outChain !== '' ? $outChain : '-') ?></code></td></tr>
    <tr><td>ipify 가 본 IP</td><td><code><?= h($ipifyIp !== '' ? $ipifyIp : '-') ?></code></td></tr>
    <?php if ($outErr !== ''): ?>
      <tr><td>오류</td><td><code><?= h($outErr) ?></code></td></tr>
    <?php endif; ?>
  </table>
  <div class="note">체인이 여러 개면 <b>맨 뒤</b>가 실제 발신입니다. 앞엣것은 중간 프록시가 얹은 값입니다.</div>
</section>

<section>
  <h2>③ 로젠 서버에 닿는가</h2>
  <table>
    <?php foreach ($logen as $label => $v): ?>
      <tr>
        <td><?= h($label) ?></td>
        <td>
          <code>HTTP <?= h($v['code']) ?></code>
          <?php if ($v['err'] !== ''): ?><br><code><?= h($v['err']) ?></code><?php endif; ?>
          <?php if ($v['body'] !== ''): ?><br><code><?= h($v['body']) ?></code><?php endif; ?>
        </td>
      </tr>
    <?php endforeach; ?>
  </table>
  <div class="note">인증키를 싣지 않았으므로 <b>401 · 400 이 정상</b>입니다. 응답 코드가 오면 「닿았다」는 뜻입니다.
  코드가 <code>0</code> 이면 방화벽에 막힌 것입니다.</div>
</section>

<div class="note">확인이 끝나면 <b>이 파일을 지우세요.</b> 진단용이라 계속 둘 이유가 없습니다.</div>
</div>
