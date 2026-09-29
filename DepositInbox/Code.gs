/**
 * ══════════════════════════════════════════════════════════════
 *  팩투유 입금수신 — 은행 문자를 받아 입금대장에 적는다
 *  ★ 2026-09-28 신규 · 적용계획: CS_WebApp/입금확인_CS웹앱_적용계획.md
 *
 *  > "하루에 최소 3번은 확인을 해야되는데.."
 *  > "이카운트의 문제는 입금확인이 2번 3번 클릭하면 계속 된다는거야"
 *
 *  ★ 왜 CS웹앱에 안 붙이고 프로젝트를 따로 두나 ★
 *    CS웹앱은 «접속한 사람» 권한(USER_ACCESSING)이라 구글 로그인이 있어야 열린다.
 *    폰 자동화 앱(MacroDroid)은 로그인을 못 한다. FileStore 와 같은 까닭으로 뗀다.
 *    이 웹앱은 USER_DEPLOYING — 언제나 pack2u 권한으로 대장에 적는다.
 *    입금대장은 pack2u 에게만 있고 직원 계정에 공유하지 않는다.
 *
 *  ★ 문을 여는 열쇠 ★
 *    access 가 ANYONE_ANONYMOUS 라 주소만 알면 누구나 부를 수 있다.
 *    그래서 토큰을 본다. 토큰은 _secrets.gs 에만 둔다(.gitignore).
 *    새어 나가면 가짜 입금 알림을 넣을 수 있으니, 폰을 잃어버리면 바로 바꾼다.
 *
 *  ★ 1단계 범위 ★
 *    수신 → 해석 → 중복 거름 → 대장 기록 → 잔액 연속성 → 구글챗 알림 · 폰 생존 감시.
 *    주문서 매칭·CS웹앱 탭·이카운트 반영은 다음 단계다.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * 입금대장 스프레드시트 ID.
 * 비어 있으면 dpSetup() 이 만들어 스크립트 속성에 적는다. 여기에 적으면 여기가 이긴다.
 */
var DP_LEDGER_ID = "";

function _dp_json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function _dp_prop_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || "").trim();
}

/** 비밀값은 «부를 때» 읽는다 — 파일 맨 위에서 읽으면 _secrets.gs 가 아직 안 돌았을 수 있다(9/16 챗 알림 사고). */
function _dp_secret_(name) {
  try {
    var v = (typeof globalThis !== "undefined") ? globalThis[name] : undefined;
    if (v) return v;
  } catch (e) {}
  return _dp_prop_(name);
}

/**
 * 폰이 부른다.
 *
 * 본문은 JSON 도 되고 폼(x-www-form-urlencoded)도 된다.
 * MacroDroid 에서 문자 본문을 JSON 문자열에 그대로 넣으면 줄바꿈·따옴표에서 깨지므로
 * 폼 방식을 권한다(설정 안내: DepositInbox/폰설정_안내.md).
 *
 *   action=sms   token, from, body, receivedAt(선택, 없으면 지금)
 *   action=ping  token                — 폰이 살아 있다는 신호
 *
 * @return {ok, action, result?, dup?, key?, error?}
 */
function doPost(e) {
  var p = {}, tokenState = "", out;
  try {
    p = _dp_params_(e);
    var want = String(_dp_secret_("DP_PHONE_TOKEN") || "");
    var csWant = String(_dp_secret_("DP_CS_TOKEN") || "");
    // ★ 열쇠 두 개 (2026-09-29) ★
    //   폰 열쇠는 «적기»만, CS웹앱 열쇠는 «읽기»만 연다.
    //   폰을 잃어버려도 입금 내역을 못 빼 가고, CS웹앱 열쇠로는 가짜 입금을 못 넣는다.
    var isCs = !!(csWant && p.token && String(p.token) === csWant);
    tokenState = !p.token ? "없음" : (String(p.token) === want ? "맞음" : (isCs ? "맞음(CS)" : "틀림"));
    if (!want) out = { ok: false, error: "수신기에 토큰이 설정되지 않았습니다" };
    else if (isCs) out = _dp_handleCs_(p);
    else if (tokenState !== "맞음") out = { ok: false, error: "토큰이 맞지 않습니다" };
    else out = _dp_handle_(p);
  } catch (err) {
    try { dpNotifyText_("⚠ 입금수신 오류: " + String((err && err.message) || err)); } catch (e2) {}
    out = { ok: false, error: String((err && err.message) || err) };
  }
  dpReqLog_("POST", e, p, tokenState, out);
  return _dp_json_(out);
}

/**
 * CS웹앱이 부른다. 폰 생존 신호로 치지 않는다.
 *
 * ★ 2026-09-29: 읽기에 «매칭 손질»이 더해졌다 ★
 *   주문서 올리기 · 주문 지정 · 제외 · 되돌리기. 입금 자체(금액·입금자)를 만들거나 고치는 길은
 *   여전히 폰 열쇠에만 있다 — CS 열쇠로는 가짜 입금을 못 넣는다.
 */
function _dp_handleCs_(p) {
  var action = String(p.action || "");
  var r;
  switch (action) {
    case "list":
      r = dpListDeposits_(String(p.date || ""), Number(p.limit) || 0);
      break;
    case "orders_upload":
      r = dpCsOrdersUpload_(p.rows, String(p.by || ""));
      break;
    case "detail":
      r = dpCsDetail_(String(p.key || ""));
      break;
    case "orders_search":
      r = dpCsOrdersSearch_(String(p.q || ""));
      break;
    case "assign":
      r = dpCsPin_(String(p.key || ""), { orders: [].concat(p.orders || []) }, !!p.remember, String(p.by || ""));
      break;
    case "exclude":
      r = dpCsPin_(String(p.key || ""), "제외", false, String(p.by || ""));
      break;
    case "unassign":
      r = dpCsPin_(String(p.key || ""), "", false, String(p.by || ""));
      break;
    case "post":
      // 이카운트 반영 — 막는 장치는 dpEcount.gs 머리말 (잠금 · 반영중 먼저 · 모르면 다시 안 보냄)
      r = dpCsPost_(p.keys, String(p.by || ""));
      break;
    case "ec_check":
      // 설정 점검 + 로그인까지만 — 전표는 보내지 않는다
      r = { report: dpEcountCheck() };
      break;
    case "post_resolve":
      r = dpCsPostResolve_(String(p.key || ""), String(p.slipNo || ""), String(p.by || ""));
      break;
    case "rematch":
      // 규칙이 바뀐 뒤 지난 입금을 다시 판정한다 (사람이 정한 것 · 이카운트에 넘어간 것은 그대로)
      r = { tally: dpMatchNow() };
      break;
    default:
      return { ok: false, error: "모르는 동작: " + action };
  }
  if (r && r.ok === false) return r;
  r.ok = true;
  r.action = action;
  return r;
}

function _dp_handle_(p) {
  dpTouchSeen_();

  var action = String(p.action || "sms");
  if (action === "ping") return { ok: true, action: "ping" };
  if (action === "list") return { ok: false, error: "폰 열쇠로는 조회할 수 없습니다" };
  if (action !== "sms") return { ok: false, error: "모르는 동작: " + action };

  var allowed = _dp_secret_("DP_ALLOWED_SENDERS");
  var from = String(p.from || "").replace(/[^\d]/g, "");
  if (allowed && allowed.length && from) {
    var list = (typeof allowed === "string" ? allowed.split(",") : allowed)
      .map(function (x) { return String(x).replace(/[^\d]/g, ""); });
    if (list.indexOf(from) < 0) return { ok: false, error: "허용되지 않은 발신번호" };
  }

  var rcv = p.receivedAt ? new Date(p.receivedAt) : new Date();
  if (isNaN(rcv)) rcv = new Date();
  var res = dpIngestSms_(String(p.body || ""), rcv, from);
  return { ok: true, action: "sms", result: res.result, dup: res.dup, key: res.key };
}

function _dp_params_(e) {
  var p = {};
  var raw = (e && e.postData && e.postData.contents) || "";
  var type = (e && e.postData && e.postData.type) || "";
  if (raw && /json/i.test(type)) {
    try { p = JSON.parse(raw) || {}; } catch (eJ) { throw new Error("본문을 읽지 못했습니다"); }
  } else if (raw && !/x-www-form-urlencoded|multipart/i.test(type)) {
    // ★ 폰 설정을 줄이려고 (2026-09-28) ★
    //   > "너무 복잡하네.."
    //   토큰·동작은 주소 뒤(?token=…&action=sms)에 박고, 본문에는 문자 내용만 그대로 싣는다.
    //   MacroDroid 에서 칸 하나만 채우면 된다. 줄바꿈·따옴표도 안 깨진다.
    p.body = raw;
  }
  var q = (e && e.parameter) || {};
  for (var k in q) if (p[k] == null) p[k] = q[k];
  // ★ 본문 맨 앞의 토큰 — 「dp:<토큰> [sms_message]」 (2026-09-28) ★
  //   > 폰 로그: POST 200, 서버 수신로그: 토큰 없음 · 동작 없음 · 본문은 도착
  //   MacroDroid 는 본문을 실어 보낼 때 주소의 «?» 뒷부분을 떼어 버린다(본문 없는 ping 은 멀쩡).
  //   경로(…/exec/sms/토큰)도 시험했으나 익명 웹앱에서는 스크립트까지 오지 않았다.
  //   끝까지 온전히 도착하는 것은 본문뿐이라, 토큰을 본문 맨 앞에 싣는다.
  if (!p.token && p.body) {
    var m = String(p.body).match(/^\s*dp:(\S+)\s*/);
    if (m) { p.token = m[1]; p.body = String(p.body).slice(m[0].length); }
  }
  // ★ 폼 형식으로 문자만 실어 온 경우 ★
  //   MacroDroid 의 기본 콘텐츠 유형이 폼이라, text/plain 으로 안 바꾸면 문자 본문이
  //   「이름=값」으로 잘못 쪼개져 body 가 비어 버린다. 그때는 원래 본문을 문자로 쓴다.
  if (p.body == null && raw && String(p.action || "sms") === "sms" && /x-www-form-urlencoded/i.test(type) &&
      !/(^|&)body=/.test(raw)) {
    p.body = raw;
  }
  return p;
}

/**
 * 살아 있는지만 본다. 토큰이 필요 없다 — 아무것도 안 알려 주기 때문이다.
 * 다만 폰이 «GET 으로» 보내면 여기로 온다(MacroDroid 기본값이 GET). 그건 기록하고 알려 준다.
 */
function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.token || q.action) {
    var out = { ok: false, error: "GET 으로 왔습니다 — MacroDroid 요청 방법을 POST 로 바꾸세요" };
    var want = String(_dp_secret_("DP_PHONE_TOKEN") || "");
    dpReqLog_("GET", e, q, !q.token ? "없음" : (String(q.token) === want ? "맞음" : "틀림"), out);
    return _dp_json_(out);
  }
  return _dp_json_({ ok: true, service: "팩투유 입금수신" });
}

// ══════════════════════════════════════════════
//  편집기에서 ▶ 실행하는 것들
// ══════════════════════════════════════════════

/**
 * ★ 처음 한 번 ★
 *   권한 승인 창을 띄우고, 입금대장이 없으면 만들고, 폰 감시 트리거를 건다.
 *   여러 번 실행해도 된다 — 있는 것은 그대로 둔다.
 */
function dpSetup() {
  var ss = dpLedgerSs_(true);
  dpLedgerSheet_(ss);
  dpInstallTriggers();
  return dpStatus();
}

/** 토큰·웹훅·대장·마지막 신호·트리거를 한 번에 본다. 아무것도 바꾸지 않는다. */
function dpStatus() {
  var out = ["팩투유 입금수신", ""];
  out.push("실행 계정    " + Session.getEffectiveUser().getEmail());
  out.push("폰 토큰      " + (_dp_secret_("DP_PHONE_TOKEN") ? "있음" : "★ 없음 — _secrets.gs"));
  out.push("챗 웹훅      " + (_dp_secret_("DP_CHAT_WEBHOOK") ? "있음" : "★ 없음 — 알림이 안 갑니다"));
  try {
    var ss = dpLedgerSs_(false);
    out.push("입금대장     " + (ss ? ss.getUrl() : "★ 없음 — dpSetup() 실행"));
  } catch (e) {
    out.push("입금대장     ★ " + e.message);
  }
  var seen = Number(_dp_prop_("DP_LAST_SEEN") || 0);
  out.push("마지막 신호  " + (seen ? Utilities.formatDate(new Date(seen), "Asia/Seoul", "MM-dd HH:mm") : "아직 없음"));
  var n = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === "dpWatch";
  }).length;
  out.push("폰 감시      " + (n ? "켜짐 (30분마다)" : "★ 꺼짐 — dpInstallTriggers()"));
  var msg = out.join("\n");
  Logger.log(msg);
  return msg;
}

/** 문자 한 통을 넣어 보고 어떻게 읽히는지만 본다. 대장에는 안 적는다. */
function dpTryParse() {
  var sample = "[Web발신]\n신한09/28 14:32\n110-***-123456\n입금     50,000\n잔액  1,230,000\n 홍길동";
  var r = dpParseSms(sample, new Date());
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/** 챗 방에 시험 글을 하나 보낸다. */
function dpTestNotify() {
  dpNotifyText_("🔔 입금알림 시험 — 이 글이 보이면 연결된 것입니다.");
}
