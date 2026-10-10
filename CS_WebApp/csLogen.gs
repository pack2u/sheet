/**
 * ══════════════════════════════════════════════════════════════
 *  로젠택배 Open API 연동 — 호출 래퍼
 *  규격: 로젠택배_OpenAPI_규격.md   계획: 로젠_CS웹앱_적용계획.md
 *  키:   _secrets.gs (LOGEN_SECRET_KEY_DEV/PROD)
 *
 *  ★ 키는 여기 적지 않는다 ★
 *    csLotte.gs 와 같은 규칙이다. 이 파일은 git 에 올라간다.
 *    키는 _secrets.gs 에만 두고, _secrets.gs 는 .claspignore 에 **넣지 않는다**
 *    (넣으면 clasp push 가 서버 파일을 지운다 — 2026-09-08 사고).
 *
 *  ★ 왜 만들었나 ★
 *    2026-09-11 자사출고 택배사를 로젠으로 바꿨다(_partnerHelpers.gs:197).
 *    그 뒤 나가는 송장은 11자리 로젠인데 CS 배송조회는 롯데 API 뿐이라
 *    **전환 이후 건이 화면에서 추적이 안 된다.** 그 구멍을 메운다.
 *
 *  ★ 아직 못 쓴다 — 두 가지가 막혀 있다 ★  (2026-09-15 현재)
 *    ① 인증키 미발급. 시스템연동신청서 제출 전이다.
 *    ② **IP 화이트리스트.** 로젠은 등록된 IP 에서 온 호출만 받는다.
 *       Apps Script 의 UrlFetchApp 은 구글 공용 대역에서 IP 가 유동으로
 *       배정되어 **고정 등록이 불가능하다.** 롯데는 헤더만 보고 IP 를 안 봐서
 *       문제가 없었다 — 그래서 csLotte.gs 를 그대로 베끼면 401 만 떨어진다.
 *
 *       담당자에게 면제 가능한지 물어봤다(로젠_담당자_문의메일_초안.md 1번).
 *       - 면제되면  : _LOGEN_PROXY_URL_ 을 비워 두고 직접 호출한다
 *       - 안 되면   : 고정 IP 중계 서버를 세우고 그 주소를 _secrets.gs 에 넣는다
 *       **코드는 두 경우를 모두 지원한다.** 값만 넣으면 갈린다.
 *
 *  ★ 상태 ★
 *    로젠은 화물상태에 **코드가 없다.** statNm 한글 문자열이 전부다.
 *    롯데에서 "표보다 응답의 이름을 우선한다"로 정착시킨 방식이
 *    (csLotte.gs 머리말) 로젠에서는 선택이 아니라 **유일한 방법**이다.
 *    2026-09-28 담당자가 7단계 목록을 회신해 줬다(_LOGEN_STATUS_FLOW_).
 *    그래도 문자열을 그대로 흘린다 — 목록에 없는 값이 와도 죽지 않게.
 *
 *  ★ 호출 방식 — 로젠이 직접 요청한 것이다 ★  (2026-09-28 정보전략팀 회신)
 *      "1회 호출 시 최대 10건 내외"
 *      "비동기가 아닌 순차적인 동기식(Synchronous) 호출"
 *      "각 호출 간 수 초 정도의 간격(Delay)"
 *    일일 상한은 안 알려줬다. 대신 이 세 가지를 지켜 달라고 했다.
 *    **지키지 않으면 차단당할 수 있다.** 아래 _LOGEN_BATCH_* 가 그 장치다.
 * ══════════════════════════════════════════════════════════════
 */

// ── 환경 ────────────────────────────────────────────────
/**
 * 운영 사용 여부.
 *
 * ★ 개발계에서는 검증할 수 없다 ★  (2026-09-28 로젠 회신)
 *   "개발계 환경에서의 **화물추적 및 반품 API 테스트는 지원이 어려움**을
 *    양해 부탁드립니다."
 *   롯데와 똑같다(csLotte.gs 머리말 — 개발계에 연계 등록이 없어 못 썼다).
 *   그래서 topenapi 로는 우리가 쓸 두 기능을 한 번도 못 돌려 본 채
 *   **곧바로 운영으로 가야 한다.**
 *
 * ★ 운영에서 시험할 때 ★
 *   화물추적 = 읽기 전용이라 운영에서 조회해도 부작용이 없다. 먼저 이것으로 확인한다.
 *   **반품 접수(registReturnRequest)는 다르다 — 운영에서 부르면 진짜로 접수된다.**
 *   csLogenReturn.gs 를 만들 때 이 점을 맨 앞에 못 박을 것.
 *
 * 운영 키를 받기 전까지는 false 로 둔다(그 사이 실수로 운영을 부르지 않게).
 * 키가 들어오면 true 로 올린다.
 */
var _LOGEN_USE_PROD_ = true;   // 2026-10-07 운영 전환 — 개발계는 스캔 DB 가 없어 쓸 수 없다

var _LOGEN_HOST_DEV_ = "https://topenapi.ilogen.com";
var _LOGEN_HOST_PROD_ = "https://openapi.ilogen.com";

/** 모든 API 가 이 경로 아래에 있다 */
var _LOGEN_PATH_ = "/lrm02b-edi/edi/";

// ── 쿼터·캐시 ────────────────────────────────────────────
/**
 * 일일 소프트 캡.
 *
 * ★ 로젠은 일일 한도가 없다 ★  (2026-09-28 회신)
 *   "현재 API 호출에 대한 별도의 일일 한도는 설정되어 있지 않습니다."
 *
 *   그래도 이 숫자를 지운다는 뜻은 아니다. 목적이 바뀐 것뿐이다 —
 *   전에는 「로젠에 차단당하지 않으려고」였고, 지금은 **「우리 실수를 막으려고」** 다.
 *   무한루프나 잘못된 배치가 밤새 도는 사고를 여기서 끊는다.
 *   로젠이 한도를 안 걸어 둔 만큼, 예절(10건·순차·지연)은 우리가 더 지켜야 한다.
 */
var _LOGEN_QUOTA_SOFT_CAP_ = 9000;

/** 진행 중인 건 — 스캔이 이보다 자주 찍히지 않는다 */
var _LOGEN_CACHE_SEC_ = 1800;      // 30분

/**
 * 배달이 끝난 건 — 상태가 더 바뀌지 않으니 길게 잡는다.
 * ★ "영구" 는 못 한다 ★ CacheService 의 최대 만료가 21600초(6시간)다.
 *   그 이상 두려면 시트나 ScriptProperties 로 따로 쌓아야 하는데,
 *   조회량이 얼마나 될지 모르는 지금 단계에서 벌일 일은 아니다.
 *   호출량이 문제가 되면 그때 시트 캐시를 붙인다.
 */
var _LOGEN_CACHE_DONE_SEC_ = 21600; // 6시간 (CacheService 최대)

/**
 * 화물상태(statNm) 흐름 — **담당자가 알려준 7단계** (2026-09-28 정보전략팀 회신)
 *
 *   집하완료 → 집하입고 → 터미널입고 → 터미널출고 → 배송입고 → 배송출고 → 배송완료
 *
 * ★ 이 목록을 «판정 기준»으로 쓰지 않는다 ★
 *   롯데에서 표를 믿었다가 데었다 — 표에 없는 값이 오고, 같은 값이 상황별로
 *   다른 이름을 썼다(csLotte.gs 머리말). 로젠도 "통보 없이 늘 수 있다"고 봐야 한다.
 *   여기서는 (1) 진행 단계를 몇 번째인지 셈하고 (2) «처음 보는 값»을 가려내는
 *   데만 쓴다. 화면에는 언제나 응답이 준 문자열을 그대로 보여준다.
 */
var _LOGEN_STATUS_FLOW_ = [
  "집하완료", "집하입고", "터미널입고", "터미널출고",
  "배송입고", "배송출고", "배송완료"
];

/**
 * 배달 완료로 볼 단어.
 * 목록의 마지막이 «배송완료»다. 롯데 쪽 표기(배달완료)도 같이 본다 —
 * 두 택배사 결과가 한 화면에 섞이므로 판정 함수를 갈라 두고 싶지 않다.
 *
 * ★ 「집하완료」가 걸리지 않게 조심 ★ 둘 다 "완료"로 끝난다.
 *   그래서 "완료"가 아니라 **낱말 전체**로 본다.
 */
var _LOGEN_DONE_WORDS_ = ["배송완료", "배달완료"];

// ── 호출 예절 — 로젠이 직접 요청한 것 (2026-09-28) ───────
/** "1회 호출 시 최대 10건 내외로 구성해 주세요" */
var _LOGEN_BATCH_SIZE_ = 10;

/** "각 호출 간에는 수 초 정도의 시간 간격(Delay)" */
var _LOGEN_BATCH_DELAY_MS_ = 2000;

/**
 * 한 번 실행에서 쓸 시간 예산.
 * ★ GAS 는 6분에서 잘린다 ★ 10건씩 끊어 2초씩 쉬면 100건에 40초쯤 걸린다.
 *   잘리면 앞부분 결과까지 통째로 날아가므로, 예산을 넘기면 **남은 건을
 *   「다음에」로 표시하고 정상 종료**한다. 조용히 사라지는 것보다 낫다.
 */
var _LOGEN_TIME_BUDGET_MS_ = 150000; // 2분 30초

// ── 설정 읽기 ────────────────────────────────────────────
function _logen_host_() {
  return _LOGEN_USE_PROD_ ? _LOGEN_HOST_PROD_ : _LOGEN_HOST_DEV_;
}

function _logen_key_() {
  var k = _LOGEN_USE_PROD_
    ? (typeof LOGEN_SECRET_KEY_PROD === "string" ? LOGEN_SECRET_KEY_PROD : "")
    : (typeof LOGEN_SECRET_KEY_DEV === "string" ? LOGEN_SECRET_KEY_DEV : "");
  if (!k) {
    throw new Error("로젠 API 키가 없습니다 — _secrets.gs 의 " +
      (_LOGEN_USE_PROD_ ? "LOGEN_SECRET_KEY_PROD" : "LOGEN_SECRET_KEY_DEV") + " 를 확인하세요.");
  }
  return k;
}

/**
 * 연동업체코드.
 * ★ 확정 ★ 2026-09-28 로젠 회신 —
 *   "언급하신 userId, custCd 에 **거래처코드(30556066)를 입력하시는 것이 맞습니다.**"
 *   즉 둘 다 같은 값이다. 화주사가 직접 개발하는 경우의 정상 사용법이다.
 */
function _logen_userId_() {
  return String(typeof LOGEN_USER_ID === "string" && LOGEN_USER_ID
    ? LOGEN_USER_ID : "30556066");
}

/** 거래처코드 — 주식회사 팩투유 */
function _logen_custCd_() {
  return String(typeof LOGEN_CUST_CD === "string" && LOGEN_CUST_CD
    ? LOGEN_CUST_CD : "30556066");
}

/** 중계 서버 주소. 비어 있으면 로젠을 직접 부른다. */
function _logen_proxyUrl_() {
  return String(typeof LOGEN_PROXY_URL === "string" ? LOGEN_PROXY_URL : "");
}

function _logen_digits_(v) {
  return String(v == null ? "" : v).replace(/[^0-9]/g, "");
}

// ── 쿼터 ────────────────────────────────────────────────
/**
 * 일일 호출수 카운터. csLotte.gs 와 같은 방식이다.
 * ScriptProperties 에 날짜별로 쌓는다 — CacheService 는 만료가 제멋대로라
 * "하루"를 세는 데 못 쓴다.
 * @return {boolean} 호출해도 되는가
 */
function _logen_quotaTake_() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  var key = "LOGEN_QUOTA_" + today;
  var n = parseInt(props.getProperty(key) || "0", 10);
  if (n >= _LOGEN_QUOTA_SOFT_CAP_) return false;
  props.setProperty(key, String(n + 1));

  // 어제 이전 카운터 정리 — 하루 첫 호출에서만 훑는다
  if (n === 0) {
    try {
      var all = props.getProperties();
      for (var k in all) {
        if (k.indexOf("LOGEN_QUOTA_") === 0 && k !== key) props.deleteProperty(k);
      }
    } catch (e) { /* 정리 실패는 무시 — 기능에 영향 없다 */ }
  }
  return true;
}

/** 오늘 쓴 호출수 (진단용) */
function csLogenQuotaUsed() {
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  var n = PropertiesService.getScriptProperties().getProperty("LOGEN_QUOTA_" + today);
  return {
    date: today,
    used: parseInt(n || "0", 10),
    softCap: _LOGEN_QUOTA_SOFT_CAP_,
    note: "로젠이 알려준 상한이 아니다 — 롯데 기준을 답습한 임시값"
  };
}

// ── 호출 ────────────────────────────────────────────────
/**
 * 로젠 API 호출. 모든 API 가 POST + JSON 이다.
 *
 * 중계 서버가 설정돼 있으면 그쪽으로 보낸다. 중계 서버는 **얇게** 간다 —
 * 로젠 응답을 그대로 통과시키고, 해석은 전부 여기서 한다.
 * 중계에 로직을 넣으면 배포처가 둘로 갈려 유지보수가 나빠진다.
 *
 * @param {string} api  엔드포인트 이름 (예: "inquiryCargoTrackingMulti")
 * @param {Object} body 요청 본문
 * @return {{ok:boolean, status:number, json:Object, error:string}}
 */
function _logen_call_(api, body) {
  if (!_logen_quotaTake_()) {
    return { ok: false, status: 0, json: null,
             error: "일일 호출 한도(" + _LOGEN_QUOTA_SOFT_CAP_ + ")에 도달했습니다." };
  }

  var url, opt;
  var proxy = _logen_proxyUrl_();

  if (proxy) {
    // 중계 경유 — 키는 중계 서버가 들고 있다. 여기서는 보내지 않는다.
    url = proxy;
    opt = {
      method: "post",
      contentType: "application/json;charset=UTF-8",
      headers: { "X-Proxy-Token": String(typeof LOGEN_PROXY_TOKEN === "string" ? LOGEN_PROXY_TOKEN : "") },
      payload: JSON.stringify({
        api: api,
        env: _LOGEN_USE_PROD_ ? "prod" : "dev",
        body: body
      }),
      muteHttpExceptions: true
    };
  } else {
    // 직접 호출 — IP 면제를 받았을 때만 통한다
    url = _logen_host_() + _LOGEN_PATH_ + api;
    opt = {
      method: "post",
      contentType: "application/json;charset=UTF-8",
      headers: { "secretKey": _logen_key_() },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    };
  }

  var res;
  try {
    res = UrlFetchApp.fetch(url, opt);
  } catch (e) {
    return { ok: false, status: 0, json: null, error: "호출 실패: " + e.message };
  }

  var code = res.getResponseCode();
  var text = res.getContentText("UTF-8");

  // 401 은 원인이 둘이고 대응이 전혀 다르다. 갈라서 알려준다.
  if (code === 401) {
    return { ok: false, status: 401, json: null,
             error: proxy
               ? "인증 실패 — 중계 서버의 인증키를 확인하세요."
               : "인증 실패 — 인증키가 틀렸거나 **호출 IP가 등록되지 않았습니다.** " +
                 "Apps Script 는 고정 IP가 없으므로 중계 서버가 필요할 수 있습니다 " +
                 "(로젠_CS웹앱_적용계획.md §1)." };
  }

  var json = null;
  try { json = JSON.parse(text); } catch (e) { /* 아래서 처리 */ }
  if (!json) {
    return { ok: false, status: code, json: null,
             error: "응답을 해석하지 못했습니다 (HTTP " + code + ")" };
  }
  if (code >= 400) {
    return { ok: false, status: code, json: json,
             error: String(json.sttsMsg || json.message || ("HTTP " + code)) };
  }
  return { ok: true, status: code, json: json, error: "" };
}

// ── 응답 해석 ────────────────────────────────────────────
/**
 * 건별 성공 판정.
 *
 * ★ 로젠은 resultCd 값 체계가 API 마다 다르다 ★  (규격서 2장)
 *     TRUE / FALSE    — 추적·반품·주문등록
 *     SUCCESS / FAIL  — contPickFares, contRtnFares
 *     SUCCESS / FALSE — integratedInquiry  (문서 표기 그대로다. 오기로 보이나 확인 못 함)
 *   그래서 값 하나로 비교하지 않고 **성공값 화이트리스트**로 본다.
 */
function _logen_ok_(resultCd) {
  var v = String(resultCd == null ? "" : resultCd).toUpperCase().trim();
  return v === "TRUE" || v === "SUCCESS";
}

/**
 * 빈 값 판정.
 * 성공 시 resultMsg 가 null 인 API 와 "" 인 API 가 섞여 있다. 둘 다 빈 것으로 본다.
 */
function _logen_blank_(v) {
  return v == null || String(v).trim() === "";
}

/**
 * 항상 배열로 받는다.
 * ★ data1[] 을 단일값으로 받으면 안 된다 ★ 다박스면 송장이 여러 장이고,
 *   추적 이력도 배열이다. 하나만 꺼내면 조용히 누락된다.
 */
function _logen_arr_(v) {
  if (v == null) return [];
  return Object.prototype.toString.call(v) === "[object Array]" ? v : [v];
}

/** scanDt(yyyymmdd) + scanTm(hhmmss) → "MM-dd HH:mm"  (롯데와 같은 표기) */
function _logen_when_(ymd, tme) {
  var d = _logen_digits_(ymd), t = _logen_digits_(tme);
  if (d.length !== 8) return "";
  var s = d.substring(4, 6) + "-" + d.substring(6, 8);
  if (t.length === 6) s += " " + t.substring(0, 2) + ":" + t.substring(2, 4);
  return s;
}

/**
 * 배달이 끝났는가.
 * 코드가 없으니 문자열로 볼 수밖에 없다. 모르는 문자열은 "아직"으로 본다 —
 * 끝난 걸 안 끝났다고 하는 쪽이, 안 끝난 걸 끝났다고 하는 것보다 덜 위험하다.
 */
function _logen_isDone_(statNm) {
  var s = String(statNm == null ? "" : statNm).replace(/\s/g, "");
  for (var i = 0; i < _LOGEN_DONE_WORDS_.length; i++) {
    if (s.indexOf(_LOGEN_DONE_WORDS_[i]) !== -1) return true;
  }
  return false;
}

/**
 * 처음 보는 상태 문자열을 로그에 남긴다.
 *
 * ★ 왜 ★ 로젠이 쓰는 문자열 전체 목록을 못 받았다(문의메일 5번).
 *   목록이 오기 전에는 «실제로 오는 값»을 모아야 한다.
 *   롯데에서도 표에 없는 코드가 나왔다(02 출력·05 집하출발·45 인수자등록).
 *   로젠은 표 자체가 없으니 더하다.
 *
 *   조회를 막지 않는다 — 기록만 한다.
 */
/** 이미 본 화물상태 문자열을 적어 두는 속성 이름 */
var _LOGEN_STATNM_PROP_ = "LOGEN_STATNM_SEEN";

/** 그 값을 «한 실행에 한 번»만 읽어 외운다 (null = 아직 안 읽음) */
var _LOGEN_STATNM_SEEN_ = null;

function _logen_noteStatus_(statNm) {
  var s = String(statNm == null ? "" : statNm).trim();
  if (!s) return;
  // 담당자가 알려준 7단계는 «아는 값»이다. 이것까지 경고하면 로그가 시끄러워
  // 정작 새 값이 나왔을 때 묻힌다.
  for (var f = 0; f < _LOGEN_STATUS_FLOW_.length; f++) {
    if (_LOGEN_STATUS_FLOW_[f] === s) return;
  }
  /*  ★ 속성은 한 실행에 한 번만 읽는다 ★  (2026-10-09)
      위의 «아는 7단계» 울타리가 보통은 여기까지 안 오게 막는다. 그런데 정말
      새 문자열이 나온 날에는, 그 상태를 가진 «줄마다» 속성을 읽었다.
      한 번에 10~20ms 이고 추적은 한 회차에 수백~천 건이다 —
      새 상태가 나온 날에만 느려지는, 가장 안 반가운 종류의 함정이다.
      [[gas-service-calls-in-loops]] 가 25분을 먹은 것과 같은 모양이다.

      ★ 적는 순간에는 다시 읽는다 ★ 외운 것만 믿고 덮으면, 다른 실행이 그 사이
      적어 둔 새 문자열을 지운다. 적는 일은 새 문자열마다 한 번뿐이라 싸다. */
  try {
    if (_LOGEN_STATNM_SEEN_ === null) {
      _LOGEN_STATNM_SEEN_ = PropertiesService.getScriptProperties()
        .getProperty(_LOGEN_STATNM_PROP_) || "";
    }
    if (_LOGEN_STATNM_SEEN_.indexOf("|" + s + "|") !== -1) return;

    var props = PropertiesService.getScriptProperties();
    var 지금것 = props.getProperty(_LOGEN_STATNM_PROP_) || "";
    if (지금것.indexOf("|" + s + "|") !== -1) {   // 그 사이 남이 적었다
      _LOGEN_STATNM_SEEN_ = 지금것;
      return;
    }
    _LOGEN_STATNM_SEEN_ = 지금것 + "|" + s + "|";
    props.setProperty(_LOGEN_STATNM_PROP_, _LOGEN_STATNM_SEEN_);
    console.warn("[로젠] 새 화물상태 문자열: " + s);
  } catch (e) { /* 기록 실패로 조회를 막지 않는다 */ }
}

/** 지금까지 관측된 상태 문자열 (진단용) */
function csLogenSeenStatuses() {
  var s = PropertiesService.getScriptProperties().getProperty("LOGEN_STATNM_SEEN") || "";
  return s.split("|").filter(function (x) { return x; });
}

// ── 화물추적 ────────────────────────────────────────────
/**
 * 화물추적 — 단건.
 *
 * ★ 응답 형태를 csLotteTrack 과 똑같이 맞춘다 ★
 *   home.html 의 _trkRender_ 가 롯데 응답 모양을 그대로 그린다.
 *   같은 모양으로 돌려주면 **화면을 한 벌만 쓴다.**
 *   (라우팅은 csTrack.gs 가 한다)
 *
 * ★ 왜 두 번 부르나 ★
 *   inquiryCargoTrackingMulti      — 이력 전체. 영업소 «전화번호»가 없다.
 *   inquiryCargoTrackingMultiLast  — 최종 1건. salesCellNo 가 여기에만 있다.
 *   CS 가 가장 많이 쓰는 게 「영업소에 바로 전화」라 전화번호를 포기할 수 없다.
 *   쿼터가 빠듯하면 _LOGEN_FETCH_TEL_ 을 false 로 내리면 한 번만 부른다.
 *
 * @param {string} invoice 운송장번호 (하이픈 있어도 됨)
 * @param {Object} opt     { noCache:boolean }
 * @return {Object} csLotteTrack 과 같은 형태
 */
var _LOGEN_FETCH_TEL_ = true;

function csLogenTrack(invoice, opt) {
  opt = opt || {};
  var inv = _logen_digits_(invoice);
  if (!inv) return { ok: false, carrier: "로젠", error: "운송장번호가 필요합니다." };

  var cache = CacheService.getScriptCache();
  var ck = "logenTrk|" + (_LOGEN_USE_PROD_ ? "P" : "D") + "|" + inv;

  if (!opt.noCache) {
    try {
      var hit = cache.get(ck);
      if (hit) {
        var c = JSON.parse(hit);
        c.cached = true;
        return c;
      }
    } catch (e) { /* 캐시 문제로 조회를 막지는 않는다 */ }
  }

  var r = _logen_call_("inquiryCargoTrackingMulti", {
    userId: _logen_userId_(),
    data: [{ slipNo: inv }]
  });
  if (!r.ok) return { ok: false, carrier: "로젠", invoice: inv, error: r.error };

  var rows = _logen_arr_(r.json.data);
  if (!rows.length) {
    return { ok: false, carrier: "로젠", invoice: inv,
             error: String(r.json.sttsMsg || "조회 결과가 없습니다.") };
  }

  // ★ 건별 결과를 본다 ★ sttsCd 만 보면 PARTIAL SUCCESS 에서 실패 건을 놓친다.
  var row = rows[0];
  if (!_logen_ok_(row.resultCd)) {
    return { ok: false, carrier: "로젠", invoice: inv,
             error: _logen_blank_(row.resultMsg) ? "조회 실패" : String(row.resultMsg) };
  }

  var out = _logen_buildTrack_(inv, row);

  // 영업소 전화번호는 최종조회에만 있다
  if (_LOGEN_FETCH_TEL_ && out.ok) {
    var tel = _logen_lastTel_(inv);
    if (tel.branchTel) { out.branchTel = tel.branchTel; out.empTel = tel.branchTel; }
    if (tel.empNm && !out.empNm) out.empNm = tel.empNm;
  }

  try {
    cache.put(ck, JSON.stringify(out),
      out.delivered ? _LOGEN_CACHE_DONE_SEC_ : _LOGEN_CACHE_SEC_);
  } catch (e) { /* 무시 */ }
  return out;
}

/**
 * data[] 한 줄을 csLotteTrack 형태로 옮긴다.
 *
 * 필드 대응:
 *   statNm      → statusName   (로젠은 코드가 없다. statusCode 는 빈 채로 둔다)
 *   branNm      → branch
 *   salesNm     → empNm        "홍길동/대치동" 형태 — 롯데의 담당기사 자리에 해당한다
 *   acptorTyNm  → msg          "현관/문앞"
 */
function _logen_buildTrack_(inv, row) {
  var raw = _logen_arr_(row.data1);
  var hist = [];

  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    var nm = String(t.statNm || "").trim();
    _logen_noteStatus_(nm);

    var tm = _logen_digits_(t.scanTm);
    hist.push({
      code: "",                       // 로젠은 상태코드가 없다
      name: nm || "(상태 없음)",
      at: _logen_when_(t.scanDt, t.scanTm),
      // 응답이 시간순이라는 보장이 없다. 롯데는 실제로 뒤섞여 왔다.
      sortKey: _logen_digits_(t.scanDt) + (tm.length === 6 ? tm : "999999") +
               ("00" + i).slice(-3),
      branch: String(t.branNm || ""),
      branchTel: "",                  // 이력에는 없다. 최종조회에서 채운다.
      /* ★ salesNm·acptorTyNm 은 «null» 로 온다 ★ (2026-10-07 운영 실측)
         빈 문자열이 아니라 null 이다. String(null) 은 "null" 이 되므로
         `|| ""` 를 반드시 거쳐야 한다. 안 그러면 화면에 "null" 이 찍힌다. */
      empNm: String(t.salesNm || "").trim(),
      empTel: "",
      /* 인수자구분명 자리인데 **배송예정 시간대**가 오기도 한다 ("10시~12시").
         문서에는 "현관/문앞" 예시뿐이다. 둘 다 CS 에 쓸모 있으니 그대로 흘린다. */
      msg: String(t.acptorTyNm || "").trim(),
      /* ★ 구간 ★ (2026-10-07 추가)
         sndBranNm → rcvBranNm 이 "동수원[305]" → "이천터미널[912]" 형태로 온다.
         문서는 「배송지점명·수하인지점명」이라고만 적어 두었는데, 실제로는
         **그 스캔에서 화물이 어디서 어디로 갔는지**다.
         상담원이 화물 위치를 읽는 데 가장 직관적인 값이라 살려 둔다. */
      leg: (function () {
        var from = String(t.sndBranNm || "").trim();
        var to = String(t.rcvBranNm || "").trim();
        return (from && to) ? (from + " → " + to) : "";
      })()
    });
  }
  hist.sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0); });

  /* 대표 상태 — 배달완료가 있으면 그것을 쓴다.
     마지막 이벤트를 그대로 쓰면 후속 처리가 대표가 되어, 「배달됐나?」만
     알고 싶은 CS 에게 오히려 불친절하다. (롯데에서 겪은 그대로다) */
  var done = null;
  for (var d = 0; d < hist.length; d++) {
    if (_logen_isDone_(hist[d].name)) done = hist[d];
  }
  var last = done || (hist.length ? hist[hist.length - 1] : null);

  // 영업소명은 가장 최근에 «찍힌» 이벤트에서 가져온다 — 마지막은 비어 있을 수 있다
  var emp = null;
  for (var e = hist.length - 1; e >= 0; e--) {
    if (hist[e].empNm) { emp = hist[e]; break; }
  }

  return {
    ok: true,
    carrier: "로젠",
    invoice: _logen_digits_(row.slipNo) || inv,
    ordNo: "",
    summary: "",
    statusCode: "",
    statusName: last ? last.name : "이력 없음",
    delivered: !!done,
    lastAt: last ? last.at : "",
    lastMsg: last ? last.msg : "",
    branch: last ? last.branch : "",
    branchTel: "",
    empNm: emp ? emp.empNm : "",
    empTel: "",
    itemNm: "",
    history: hist,
    cached: false,
    error: ""
  };
}

/**
 * 최종 1건 응답(§7.2)을 화면이 쓰는 모양으로 바꾼다.
 *
 * ★ 이력용과 칸 이름을 맞춘다 ★ 부르는 쪽이 둘을 한 벌로 다루려면 같아야 한다.
 *   다만 history 는 빈 채로 둔다 — 최종 1건만 왔으니 지어내지 않는다.
 * ★ 전화번호가 여기에만 온다 ★ salesCellNo. 이것 때문에 이 문을 쓴다.
 */
function _logen_buildLast_(inv, row) {
  var nm = String(row.statNm == null ? "" : row.statNm).trim();
  _logen_noteStatus_(nm);
  var tel = String(row.salesCellNo == null ? "" : row.salesCellNo).trim();
  return {
    ok: true, carrier: "로젠",
    invoice: _logen_digits_(row.slipNo) || inv,
    ordNo: "", summary: "", statusCode: "",
    statusName: nm || "이력 없음",
    delivered: _logen_isDone_(nm),
    lastAt: _logen_when_(row.scanDt, row.scanTm),
    lastMsg: "",
    branch: String(row.branNm == null ? "" : row.branNm).trim(),
    branchTel: tel,
    empNm: String(row.salesNm == null ? "" : row.salesNm).trim(),
    empTel: tel,
    itemNm: "", history: []
  };
}

/**
 * 최종 화물추적 — 영업소 전화번호만 꺼내 쓴다.
 * 실패해도 조용히 넘어간다. 전화번호가 없다고 배송조회를 죽일 이유가 없다.
 */
function _logen_lastTel_(inv) {
  try {
    var r = _logen_call_("inquiryCargoTrackingMultiLast", {
      userId: _logen_userId_(),
      data: [{ slipNo: inv }]
    });
    if (!r.ok) return { branchTel: "", empNm: "" };
    var rows = _logen_arr_(r.json.data);
    if (!rows.length || !_logen_ok_(rows[0].resultCd)) return { branchTel: "", empNm: "" };
    return {
      branchTel: String(rows[0].salesCellNo || "").trim(),
      empNm: String(rows[0].salesNm || "").trim()
    };
  } catch (e) {
    return { branchTel: "", empNm: "" };
  }
}

/**
 * 여러 건 조회.
 *
 * ★ 롯데와 다르다 ★ 롯데 화물추적은 단건뿐이라 루프를 돌 수밖에 없었지만,
 *   **로젠은 data[] 에 여러 송장을 한 번에 넣는다.**
 *
 * ★ 그렇다고 다 넣지는 않는다 ★  (2026-09-28 담당자 회신)
 *   로젠이 "1회 최대 10건 내외 · 동기식 순차 · 호출 간 수 초 간격"을 요청했다.
 *   그래서 10건씩 끊어 2초씩 쉬며 **차례로** 부른다.
 *   UrlFetchApp 은 원래 동기라 「순차」는 저절로 지켜진다.
 *
 * ★ 전화번호가 필요하면 {최종만:true} 로 부른다 ★  (2026-10-09)
 *   이력용(§7.1)에는 영업소 전화번호가 «없다». 최종조회(§7.2)에만 salesCellNo 가
 *   온다 — 「72 하영철(대방) · 010-2841-7324」 꼴. 건당 한 번 더 부르는 것이 아니라
 *   **같은 묶음 호출로 문만 바꾸는 것**이라 호출 수는 그대로다.
 *   규격 §7.2 도 「상태 폴링은 7.2 를, 상세 이력 화면은 7.1 을」 이라고 적어 뒀다.
 *
 * @param {Array<string>} invoices
 * @param {Object} opt { 최종만:boolean }  true 면 최종 1건 + 영업소 전화번호
 * @return {Object} { 송장번호: 결과 }
 */
function csLogenTrackMany(invoices, opt) {
  opt = opt || {};
  var 최종만 = !!opt["최종만"];
  var API = 최종만 ? "inquiryCargoTrackingMultiLast" : "inquiryCargoTrackingMulti";
  var 캐시표 = 최종만 ? "L" : "H";   // ★ 캐시를 섞지 않는다 ★ 둘은 모양이 다르다
  var out = {};
  var list = [];
  var seen = {};

  var src = invoices || [];
  for (var i = 0; i < src.length; i++) {
    var d = _logen_digits_(src[i]);
    if (!d || seen[d]) continue;
    seen[d] = true;
    list.push(d);
  }
  if (!list.length) return out;

  // 캐시에 있는 건 뺀다
  var cache = CacheService.getScriptCache();
  var ask = [];
  for (var c = 0; c < list.length; c++) {
    var ck = "logenTrk|" + (_LOGEN_USE_PROD_ ? "P" : "D") + 캐시표 + "|" + list[c];
    var hit = null;
    try { hit = cache.get(ck); } catch (e) { /* 무시 */ }
    if (hit) {
      try {
        var o = JSON.parse(hit);
        o.cached = true;
        out[list[c]] = o;
        continue;
      } catch (e) { /* 깨진 캐시는 다시 부른다 */ }
    }
    ask.push(list[c]);
  }
  if (!ask.length) return out;

  // ── 10건씩 끊어 순차로 부른다 (로젠 요청 사항) ──
  var started = new Date().getTime();

  for (var s = 0; s < ask.length; s += _LOGEN_BATCH_SIZE_) {
    var chunk = ask.slice(s, s + _LOGEN_BATCH_SIZE_);

    // 시간 예산을 넘었으면 남은 건을 표시하고 정상 종료한다.
    // 6분에 잘리면 앞서 받은 것까지 통째로 날아간다.
    if (s > 0 && (new Date().getTime() - started) > _LOGEN_TIME_BUDGET_MS_) {
      for (var z = s; z < ask.length; z++) {
        out[ask[z]] = { ok: false, carrier: "로젠", invoice: ask[z],
                        error: "한 번에 다 조회하지 못했습니다 — 나눠서 다시 눌러 주세요." };
      }
      break;
    }

    // 호출 사이에만 쉰다. 첫 호출 앞에서 쉬면 화면이 그만큼 늦어진다.
    if (s > 0) {
      try { Utilities.sleep(_LOGEN_BATCH_DELAY_MS_); } catch (e) { /* 무시 */ }
    }

    var body = { userId: _logen_userId_(), data: [] };
    for (var a = 0; a < chunk.length; a++) body.data.push({ slipNo: chunk[a] });

    var r = _logen_call_(API, body);

    if (!r.ok) {
      for (var f = 0; f < chunk.length; f++) {
        out[chunk[f]] = { ok: false, carrier: "로젠", invoice: chunk[f], error: r.error };
      }
      // 한도에 닿았으면 더 부를 이유가 없다 — 남은 것도 같은 사유로 세운다
      if (/한도/.test(String(r.error))) {
        for (var q = s + _LOGEN_BATCH_SIZE_; q < ask.length; q++) {
          out[ask[q]] = { ok: false, carrier: "로젠", invoice: ask[q], error: r.error };
        }
        break;
      }
      continue; // 한 묶음이 실패해도 나머지는 계속 본다
    }

    var rows = _logen_arr_(r.json.data);
    var got = {};
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      var sn = _logen_digits_(row.slipNo);
      if (!sn) continue;
      got[sn] = true;

      if (!_logen_ok_(row.resultCd)) {
        out[sn] = { ok: false, carrier: "로젠", invoice: sn,
                    error: _logen_blank_(row.resultMsg) ? "조회 실패" : String(row.resultMsg) };
        continue;
      }
      var o2 = 최종만 ? _logen_buildLast_(sn, row) : _logen_buildTrack_(sn, row);
      out[sn] = o2;
      try {
        cache.put("logenTrk|" + (_LOGEN_USE_PROD_ ? "P" : "D") + 캐시표 + "|" + sn,
          JSON.stringify(o2), o2.delivered ? _LOGEN_CACHE_DONE_SEC_ : _LOGEN_CACHE_SEC_);
      } catch (e) { /* 무시 */ }
    }

    // 이 묶음에서 응답에 안 실려 온 송장 — 조용히 빠지면 화면에서 원인을 못 읽는다
    for (var m = 0; m < chunk.length; m++) {
      if (!got[chunk[m]]) {
        out[chunk[m]] = { ok: false, carrier: "로젠", invoice: chunk[m],
                          error: "응답에 없습니다 (" + String(r.json.sttsMsg || "") + ")" };
      }
    }
  }

  return out;
}

// ── 진단 ────────────────────────────────────────────────
/**
 * ★ 이 스크립트가 «어느 IP·도메인으로» 밖에 나가는지 알아본다 ★
 *
 * 왜 필요한가 — 2026-09-28 로젠 회신:
 *   "당사는 IP 주소 외에도 **도메인 기반으로 등록이 가능**합니다.
 *    사용하시는 도메인 정보를 전달해 주실 수 있으신지요?"
 *
 *   Apps Script 는 고정 IP 가 없지만, 도메인으로 등록할 수 있다면 길이 열린다.
 *   다만 «어떤 도메인을 줘야 하는지»는 추측하면 안 된다.
 *   로젠이 들어오는 IP 를 역방향 조회(PTR)해서 도메인과 맞춰 보는 방식이라면,
 *   우리가 줘야 할 값은 script.google.com 이 아니라 **나가는 IP 의 PTR** 이다.
 *   (script.google.com 은 «들어오는» 주소지 «나가는» 주소가 아니다)
 *
 *   그래서 지어내지 말고 **실제로 재서** 로젠에 전달한다.
 *
 * 쓰는 법: Apps Script 편집기에서 이 함수를 골라 실행 → 실행로그를 본다.
 *   편집기: https://script.google.com/home/projects/1eTAUhXH2tWBqqDI-36J4QGoKcILo1vP8SKT_O7AB3Mc4aHoj66q_jRe4/edit
 *
 * @param {number} times 몇 번 재볼지 (기본 3). IP 가 매번 바뀌는지 보려고 여러 번 잰다.
 */
function csLogenWhoAmI(times) {
  var n = times || 10;
  var seen = {};
  var rows = [];

  /* ★ api.ipify.org 를 쓰면 안 된다 ★  (2026-09-28 에 속았다)
     Apps Script 는 외부 호출에 **실행한 사람의 브라우저 IP 를 X-Forwarded-For 로
     얹어서** 보낸다. ipify 는 그 헤더를 그대로 믿어 «사무실 IP» 를 돌려줬다.
     그 값을 로젠에 줬다면 개발에선 되다가 운영에서 조용히 막혔을 것이다.

     httpbin 의 origin 은 체인을 통째로 준다 — "14.34.200.225, 34.116.22.3".
     **맨 뒤가 진짜 발신 IP** 다. 그것만 쓴다. */
  for (var i = 0; i < n; i++) {
    var ip = "", chain = "";
    try {
      var res = UrlFetchApp.fetch("https://httpbin.org/get",
        { muteHttpExceptions: true, followRedirects: true });
      var j = JSON.parse(res.getContentText("UTF-8"));
      chain = String(j.origin || "");
      var parts = chain.split(",");
      ip = String(parts[parts.length - 1] || "").trim();
    } catch (e) {
      rows.push({ try: i + 1, ip: "", ptr: "", error: e.message });
      continue;
    }
    if (!ip) { rows.push({ try: i + 1, ip: "", chain: chain }); continue; }

    var ptr = _logen_reverseDns_(ip);
    seen[ip] = true;
    rows.push({ try: i + 1, ip: ip, ptr: ptr, chain: chain });
  }

  /* ★ 정말 «구글에서» 나간 게 맞는지 확인한다 ★  (2026-09-28)
     첫 측정에서 사무실 공인 IP(14.34.200.225)와 똑같은 값이 나왔다.
     구글 서버가 한국 ISP 대역으로 나갈 수는 없으므로 «어디서 잰 것인지»를
     먼저 가려야 한다. 잘못된 IP 를 로젠에 주면 개발에선 되다가 운영에서 막힌다.

     가리는 법: 밖으로 나갈 때 붙는 User-Agent 를 본다.
     Apps Script 의 UrlFetchApp 은 UA 에 «Google-Apps-Script» 를 달고 나간다
     ([[gas-cannot-call-supabase-directly]] 에서 겪은 그 UA 다). */
  var ua = "", echoIp = "", echoErr = "";
  try {
    var e1 = UrlFetchApp.fetch("https://httpbin.org/get",
      { muteHttpExceptions: true, followRedirects: true });
    var j1 = JSON.parse(e1.getContentText("UTF-8"));
    ua = String((j1.headers && (j1.headers["User-Agent"] || j1.headers["user-agent"])) || "");
    echoIp = String(j1.origin || "");
  } catch (e) {
    echoErr = e.message;
  }

  var ranOnGoogle = /Google-Apps-Script/i.test(ua);
  var ips = Object.keys(seen);

  // 흩어진 정도를 본다 — 좁으면 한시적으로 몇 개만 등록해 볼 여지가 있다
  var c24 = {}, c16 = {};
  for (var k = 0; k < ips.length; k++) {
    var seg = ips[k].split(".");
    c24[seg.slice(0, 3).join(".") + ".0/24"] = true;
    c16[seg.slice(0, 2).join(".") + ".0.0/16"] = true;
  }

  var out = {
    설명: "이 Apps Script 가 밖으로 나갈 때 쓰는 «진짜» IP 와 그 역방향 도메인",
    잰횟수: n,
    나온IP: ips,
    서로다른IP수: ips.length,
    IP가매번다른가: ips.length > 1,
    묶인_24: Object.keys(c24),
    묶인_16: Object.keys(c16),
    상세: rows,

    // ── 어디서 실행됐나 ──
    보낸UA: ua || ("(확인 실패: " + echoErr + ")"),
    에코가본IP: echoIp,
    구글에서실행된게맞나: ranOnGoogle,
    판정: !ua
      ? "판정 불가 — httpbin 응답을 못 받았다. 다시 실행해 볼 것."
      : (ranOnGoogle
          ? "OK — Apps Script 서버에서 나갔다. 위 IP/PTR 을 로젠에 전달해도 된다."
          : "⚠ 구글에서 나간 것이 아니다. UA 가 Google-Apps-Script 가 아니다. " +
            "편집기에서 실행한 게 맞는지 확인할 것 — 이 값을 로젠에 주면 안 된다.")
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * IP → 역방향 도메인(PTR).
 * 구글 공개 DNS 의 DoH 엔드포인트를 쓴다. 별도 키가 필요 없다.
 */
function _logen_reverseDns_(ip) {
  var p = String(ip || "").split(".");
  if (p.length !== 4) return "";
  var name = p[3] + "." + p[2] + "." + p[1] + "." + p[0] + ".in-addr.arpa";
  try {
    var res = UrlFetchApp.fetch(
      "https://dns.google/resolve?name=" + encodeURIComponent(name) + "&type=PTR",
      { muteHttpExceptions: true });
    var j = JSON.parse(res.getContentText("UTF-8"));
    var ans = j.Answer || [];
    for (var i = 0; i < ans.length; i++) {
      if (ans[i].data) return String(ans[i].data).replace(/\.$/, "");
    }
    return "(PTR 없음)";
  } catch (e) {
    return "(조회 실패: " + e.message + ")";
  }
}

/**
 * 연결 점검. 키를 받은 직후 이것부터 돌린다.
 * 실패 원인(키 없음 / IP 미등록 / 중계 오류)을 갈라서 알려준다.
 */
function csLogenPing(testInvoice) {
  var inv = _logen_digits_(testInvoice) || "";
  var info = {
    env: _LOGEN_USE_PROD_ ? "운영(openapi)" : "개발(topenapi)",
    proxy: _logen_proxyUrl_() ? "중계 경유" : "직접 호출",
    userId: _logen_userId_(),
    custCd: _logen_custCd_(),
    quota: csLogenQuotaUsed()
  };

  try { _logen_key_(); } catch (e) {
    if (!_logen_proxyUrl_()) { info.ok = false; info.error = e.message; return info; }
  }
  if (!inv) {
    info.ok = false;
    info.error = "점검할 운송장번호를 넣어 주세요 — csLogenPing(\"11자리송장\")";
    return info;
  }

  var r = _logen_call_("inquiryCargoTrackingMultiLast", {
    userId: _logen_userId_(),
    data: [{ slipNo: inv }]
  });
  info.ok = r.ok;
  info.status = r.status;
  info.error = r.error;
  if (r.ok) info.sttsMsg = String(r.json.sttsMsg || "");
  return info;
}
