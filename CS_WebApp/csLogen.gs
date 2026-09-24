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
 *    그래서 여기서는 표 자체를 두지 않고 문자열을 그대로 흘린다.
 *    「배달 끝났나」만 단어로 판정한다(_LOGEN_DONE_WORDS_).
 *
 *  ★ 쿼터 ★
 *    로젠은 **공개된 일일 상한이 없다.** 문서 어디에도 없어서 담당자에게
 *    물어봤다(문의메일 2번). 모르는 채로 마음 놓고 부르면 안 되므로
 *    답이 올 때까지 롯데와 같은 방식으로 세고 캐시한다.
 * ══════════════════════════════════════════════════════════════
 */

// ── 환경 ────────────────────────────────────────────────
/**
 * 운영 사용 여부.
 * 키를 받으면 개발계(topenapi)에서 먼저 확인하고 나서 true 로 올린다.
 * 개발계에 우리 거래처 연계 등록이 없을 수 있다 — 롯데에서 그랬다.
 * (문의메일 4번에서 미리 물어봤다)
 */
var _LOGEN_USE_PROD_ = false;

var _LOGEN_HOST_DEV_ = "https://topenapi.ilogen.com";
var _LOGEN_HOST_PROD_ = "https://openapi.ilogen.com";

/** 모든 API 가 이 경로 아래에 있다 */
var _LOGEN_PATH_ = "/lrm02b-edi/edi/";

// ── 쿼터·캐시 ────────────────────────────────────────────
/**
 * 일일 소프트 캡.
 * ★ 근거가 약한 값이다 ★ 로젠이 상한을 안 알려줬다. 롯데(10,000)를 답습해
 * 보수적으로 잡아 둔 것뿐이다. **회신이 오면 반드시 고칠 것.**
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
 * 배달 완료로 볼 단어.
 * ★ 관측되는 대로 늘린다 ★ 로젠이 쓰는 문자열 전체 목록을 못 받았다
 * (문의메일 5번). 목록이 오기 전까지는 여기 있는 단어만 "끝"으로 본다.
 * 모르는 문자열이 와도 죽이지 않는다 — 그대로 보여주고 로그만 남긴다.
 */
var _LOGEN_DONE_WORDS_ = ["배송완료", "배달완료"];

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
 * ★ 우리는 연동업체가 아니라 화주사가 직접 개발한다 ★
 *   API Docs 에 "연동업체코드가 아닌 경우 거래처코드 입력" 으로 적혀 있어
 *   거래처코드(30556066)를 그대로 쓰는 것으로 잡아 뒀다.
 *   맞는지 담당자에게 확인 중이다(문의메일 3번).
 *   별도 연동업체코드가 발급되면 _secrets.gs 의 LOGEN_USER_ID 만 바꾸면 된다.
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
function _logen_noteStatus_(statNm) {
  var s = String(statNm == null ? "" : statNm).trim();
  if (!s) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var key = "LOGEN_STATNM_SEEN";
    var seen = props.getProperty(key) || "";
    if (seen.indexOf("|" + s + "|") !== -1) return;
    props.setProperty(key, seen + "|" + s + "|");
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
      empNm: String(t.salesNm || "").trim(),
      empTel: "",
      msg: String(t.acptorTyNm || "").trim()
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
 *   **로젠은 data[] 에 여러 송장을 한 번에 넣는다.** 한 번 부르고 나눠 담는다.
 *   건별로 돌면 GAS 6분 실행 제한에 걸린다.
 *
 * 전화번호(최종조회)는 여기서 부르지 않는다 — 목록에서는 필요 없고,
 * 건당 한 번씩 더 부르면 배치로 아낀 걸 도로 까먹는다.
 *
 * @param {Array<string>} invoices
 * @return {Object} { 송장번호: 결과 }
 */
function csLogenTrackMany(invoices) {
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
    var ck = "logenTrk|" + (_LOGEN_USE_PROD_ ? "P" : "D") + "|" + list[c];
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

  var body = { userId: _logen_userId_(), data: [] };
  for (var a = 0; a < ask.length; a++) body.data.push({ slipNo: ask[a] });

  var r = _logen_call_("inquiryCargoTrackingMulti", body);
  if (!r.ok) {
    for (var f = 0; f < ask.length; f++) {
      out[ask[f]] = { ok: false, carrier: "로젠", invoice: ask[f], error: r.error };
    }
    return out;
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
    var o2 = _logen_buildTrack_(sn, row);
    out[sn] = o2;
    try {
      cache.put("logenTrk|" + (_LOGEN_USE_PROD_ ? "P" : "D") + "|" + sn,
        JSON.stringify(o2), o2.delivered ? _LOGEN_CACHE_DONE_SEC_ : _LOGEN_CACHE_SEC_);
    } catch (e) { /* 무시 */ }
  }

  // 응답에 아예 안 실려 온 송장 — 조용히 빠지면 화면에서 원인을 못 읽는다
  for (var m = 0; m < ask.length; m++) {
    if (!got[ask[m]]) {
      out[ask[m]] = { ok: false, carrier: "로젠", invoice: ask[m],
                      error: "응답에 없습니다 (" + String(r.json.sttsMsg || "") + ")" };
    }
  }
  return out;
}

// ── 진단 ────────────────────────────────────────────────
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
