/**
 * ══════════════════════════════════════════════════════════════
 *  롯데택배 Open API 연동 — 호출 래퍼
 *  규격: 롯데택배_OpenAPI_규격.md   키: _secrets.gs (LOTTE_API_KEY_DEV/PROD)
 *
 *  ★ 지금 쓸 수 있는 것 ★
 *    주소정제  — 우리 거래처코드(348782)로 동작 확인됨
 *    화물추적  — ⛔ 우리 거래처코드는 아직 막혀 있다.
 *                「화물추적 연계 등록」을 계약 영업점에 요청해야 풀린다.
 *                등록이 끝나면 _LOTTE_TRACK_CUST_CD_ 를 348782 로 바꾸면 끝이다.
 *                그때까지는 테스트 거래처 101000 으로 개발·검증한다.
 *
 *  ★ 쿼터 ★
 *    하루 10,000건. 화면을 새로고침할 때마다 부르면 금방 는다.
 *    그래서 (1) 응답을 캐시하고 (2) 일일 호출수를 세어 상한 앞에서 멈춘다.
 *    쿼터를 다 쓰면 CS 화면에서 배송조회가 통째로 죽으므로, 여유를 남긴다.
 *
 *  ★ 상태코드 ★
 *    롯데가 준 코드표에 없는 코드가 실제로 온다(02 출력). 표는 불완전하다.
 *    그래서 매핑에 없으면 응답의 godsStatNm 을 그대로 쓴다. 뭉개지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

// ── 환경 ────────────────────────────────────────────────
/** 운영 전환 시 true. 운영 키(LOTTE_API_KEY_PROD)를 먼저 채워야 한다. */
var _LOTTE_USE_PROD_ = false;

var _LOTTE_HOST_DEV_ = "https://devapigw.llogis.com:10100";
var _LOTTE_HOST_PROD_ = "https://apigw.llogis.com:10100";

/** 우리 거래처코드 — 주소정제·주문접수에 쓴다 */
var _LOTTE_CUST_CD_ = "348782";

/**
 * 화물추적 전용 거래처코드.
 * ★ 연계 등록이 끝나면 _LOTTE_CUST_CD_ 와 같은 값으로 바꿀 것 ★
 *   지금 348782 로 부르면 전부 아래 오류로 떨어진다.
 *     "영업담당자에게 문의하여 화물추적 연계 등록을 해주시기 바랍니다."
 */
var _LOTTE_TRACK_CUST_CD_ = "101000";

// ── 쿼터·캐시 ────────────────────────────────────────────
var _LOTTE_QUOTA_PER_DAY_ = 10000;
/** 상한을 다 쓰지 않고 남긴다. 다른 용도(주문접수)가 굶지 않게. */
var _LOTTE_QUOTA_SOFT_CAP_ = 9000;
var _LOTTE_CACHE_SEC_ = 1800; // 30분

/** 화물상태 코드 → 표시명 (롯데 전산 담당자 회신 2026-08-31) */
var _LOTTE_STATUS_ = {
  "09": "취소",
  "10": "집하",
  "12": "운송장등록",
  "20": "발송",
  "21": "도착",
  "40": "배달전",
  "41": "배달완료"
};

/** 배달이 끝났다고 볼 코드 — 이것만 신뢰한다 */
var _LOTTE_STATUS_DONE_ = "41";

// ── 공통 ────────────────────────────────────────────────
function _lotte_host_() {
  return _LOTTE_USE_PROD_ ? _LOTTE_HOST_PROD_ : _LOTTE_HOST_DEV_;
}

function _lotte_key_() {
  var k = _LOTTE_USE_PROD_
    ? (typeof LOTTE_API_KEY_PROD === "string" ? LOTTE_API_KEY_PROD : "")
    : (typeof LOTTE_API_KEY_DEV === "string" ? LOTTE_API_KEY_DEV : "");
  if (!k) {
    throw new Error("롯데 API 키가 없습니다 — _secrets.gs 의 " +
      (_LOTTE_USE_PROD_ ? "LOTTE_API_KEY_PROD" : "LOTTE_API_KEY_DEV") + " 를 확인하세요.");
  }
  return k;
}

function _lotte_digits_(v) {
  return String(v == null ? "" : v).replace(/[^0-9]/g, "");
}

/**
 * 일일 호출수 카운터.
 * ScriptProperties 에 날짜별로 쌓는다. CacheService 는 만료가 제멋대로라
 * "하루" 를 세는 용도로는 못 쓴다.
 * @return {boolean} 호출해도 되는가
 */
function _lotte_quotaTake_() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  var key = "LOTTE_QUOTA_" + today;
  var n = parseInt(props.getProperty(key) || "0", 10);
  if (n >= _LOTTE_QUOTA_SOFT_CAP_) return false;
  props.setProperty(key, String(n + 1));

  // 어제 이전 카운터는 지운다. 매번 훑지 않고 하루 첫 호출에서만.
  if (n === 0) {
    try {
      var all = props.getProperties();
      for (var k in all) {
        if (k.indexOf("LOTTE_QUOTA_") === 0 && k !== key) props.deleteProperty(k);
      }
    } catch (e) { /* 정리 실패는 무시 — 기능에 영향 없다 */ }
  }
  return true;
}

/** 오늘 쓴 호출수 (진단용) */
function csLotteQuotaUsed() {
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  var n = PropertiesService.getScriptProperties().getProperty("LOTTE_QUOTA_" + today);
  return {
    date: today,
    used: parseInt(n || "0", 10),
    softCap: _LOTTE_QUOTA_SOFT_CAP_,
    perDay: _LOTTE_QUOTA_PER_DAY_
  };
}

/**
 * 게이트웨이 호출.
 * @return {{ok:boolean, status:number, json:Object, error:string}}
 */
function _lotte_call_(method, path, body) {
  if (!_lotte_quotaTake_()) {
    return { ok: false, status: 0, json: null,
             error: "일일 호출 한도(" + _LOTTE_QUOTA_SOFT_CAP_ + ")에 도달했습니다." };
  }

  var opt = {
    method: method,
    headers: { "Authorization": "IgtAK " + _lotte_key_() },
    muteHttpExceptions: true,
    followRedirects: true
  };
  if (body) {
    opt.contentType = "application/json;charset=UTF-8";
    opt.payload = JSON.stringify(body);
  }

  var res;
  try {
    res = UrlFetchApp.fetch(_lotte_host_() + path, opt);
  } catch (e) {
    return { ok: false, status: 0, json: null, error: "호출 실패: " + e.message };
  }

  var code = res.getResponseCode();
  var text = res.getContentText("UTF-8");
  var json = null;
  try { json = JSON.parse(text); } catch (e) { /* 아래서 처리 */ }

  if (!json) {
    return { ok: false, status: code, json: null,
             error: "응답을 해석하지 못했습니다 (HTTP " + code + ")" };
  }

  // 인증/권한 오류는 메시지 꼬리로 갈라야 원인을 안다. 규격문서 EGTA4011 해석표 참조.
  if (json.code === "EGTA4011" || code >= 400) {
    var m = String(json.message || "");
    var why = m;
    if (/apiClient is null/.test(m)) {
      why = "앱 권한 미부여 또는 게이트웨이 반영 대기 (몇 분 후 재시도. 키 재발급 아님)";
    } else if (/입력이 필요/.test(m)) {
      why = "Authorization 헤더 형식 오류";
    }
    return { ok: false, status: code, json: json, error: why };
  }

  return { ok: true, status: code, json: json, error: "" };
}

// ── 화물추적 ────────────────────────────────────────────
/**
 * 상태코드 → 표시명.
 * ★ 코드표는 불완전하다 ★
 *   실제로 표에 없는 02(출력)가 온다. 롯데도 "통보 없이 추가될 수 있다"고 못박았다.
 *   그러니 매핑에 없으면 응답이 준 이름을 그대로 쓴다. "알 수 없음"으로 덮지 않는다.
 */
function _lotte_statusName_(code, fallbackNm) {
  var c = String(code == null ? "" : code);
  if (_LOTTE_STATUS_[c]) return _LOTTE_STATUS_[c];
  var nm = String(fallbackNm == null ? "" : fallbackNm).trim();
  return nm || ("코드 " + c);
}

/** yyyymmdd + hh24miss → "MM-dd HH:mm" */
function _lotte_when_(ymd, tme) {
  var d = _lotte_digits_(ymd), t = _lotte_digits_(tme);
  if (d.length !== 8) return "";
  var s = d.substring(4, 6) + "-" + d.substring(6, 8);
  if (t.length === 6) s += " " + t.substring(0, 2) + ":" + t.substring(2, 4);
  return s;
}

/**
 * 표준 화물추적.
 *
 * @param {string} invoice 운송장번호 (하이픈 있어도 됨)
 * @param {Object} opt     { ordNo:string, noCache:boolean }
 * @return {{ok:boolean, invoice:string, statusCode:string, statusName:string,
 *           delivered:boolean, lastAt:string, lastMsg:string,
 *           history:Array, cached:boolean, error:string}}
 */
function csLotteTrack(invoice, opt) {
  opt = opt || {};
  var inv = _lotte_digits_(invoice);
  var ordNo = String(opt.ordNo || "");
  if (!inv && !ordNo) {
    return { ok: false, error: "운송장번호 또는 주문번호가 필요합니다." };
  }

  var cache = CacheService.getScriptCache();
  var ck = "lotteTrk|" + (_LOTTE_USE_PROD_ ? "P" : "D") + "|" +
           _LOTTE_TRACK_CUST_CD_ + "|" + (inv || "o:" + ordNo);

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

  var path = "/api/pid/cus/806/custmer-view-tracking" +
    "?jobCustCd=" + encodeURIComponent(_LOTTE_TRACK_CUST_CD_) +
    "&invNo=" + encodeURIComponent(inv) +
    "&ordNo=" + encodeURIComponent(ordNo);

  var r = _lotte_call_("get", path, null);
  if (!r.ok) return { ok: false, invoice: inv, error: r.error };

  var j = r.json;
  if (String(j.code) !== "S") {
    return { ok: false, invoice: inv, error: String(j.message || "조회 실패") };
  }

  // 이력을 시간순으로 세운다. 응답 순서를 믿지 않는다.
  var raw = j.tracking || [];
  var hist = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    hist.push({
      code: String(t.godsStatCd || ""),
      name: _lotte_statusName_(t.godsStatCd, t.godsStatNm),
      at: _lotte_when_(t.scanYmd, t.scanTme),
      sortKey: _lotte_digits_(t.scanYmd) + _lotte_digits_(t.scanTme),
      branch: String(t.brnshpNm || ""),
      branchTel: String(t.brnshpTel || "").trim(),
      msg: String(t.status || "")
    });
  }
  hist.sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0); });

  var last = hist.length ? hist[hist.length - 1] : null;
  var out = {
    ok: true,
    invoice: inv,
    statusCode: last ? last.code : "",
    statusName: last ? last.name : "이력 없음",
    delivered: !!(last && last.code === _LOTTE_STATUS_DONE_),
    lastAt: last ? last.at : "",
    lastMsg: last ? last.msg : "",
    branch: last ? last.branch : "",
    branchTel: last ? last.branchTel : "",
    itemNm: j.user ? String(j.user.itemNm || "") : "",
    history: hist,
    cached: false,
    error: ""
  };

  try { cache.put(ck, JSON.stringify(out), _LOTTE_CACHE_SEC_); } catch (e) { /* 무시 */ }
  return out;
}

/**
 * 여러 건 조회. 화물추적 API 는 단건뿐이라 캐시를 앞세워 호출을 줄인다.
 * @param {Array<string>} invoices
 */
function csLotteTrackMany(invoices) {
  var list = invoices || [];
  var out = {};
  for (var i = 0; i < list.length; i++) {
    var inv = _lotte_digits_(list[i]);
    if (!inv || out[inv]) continue;
    out[inv] = csLotteTrack(inv);
  }
  return out;
}

// ── 주소정제 ────────────────────────────────────────────
/**
 * 주소정제 단건 — 주소 유효성 검증 + 배송 대리점/기사 확인.
 * 화물추적과 달리 **지금 우리 거래처코드로 바로 동작한다.**
 *
 * @param {Object} a { areaNo, zipNo, address, pickAreaNo, pickZipNo, pickAddress, name, tel }
 */
function csLotteRefineAddress(a) {
  a = a || {};
  if (!a.address) return { ok: false, error: "주소가 필요합니다." };

  var body = {
    id: _LOTTE_CUST_CD_,
    network: "00",
    area_no: String(a.areaNo || ""),
    zip_no: String(a.zipNo || ""),
    address: String(a.address || ""),
    pick_area_no: String(a.pickAreaNo || ""),
    pick_zip_no: String(a.pickZipNo || ""),
    pick_address: String(a.pickAddress || ""),
    spcalShopNm: String(a.name || ""),
    tel: String(a.tel || "")
  };

  var r = _lotte_call_("post", "/api/address/newprint-info", body);
  if (!r.ok) return { ok: false, error: r.error };

  var j = r.json;
  if (String(j.result) !== "success") {
    return { ok: false, error: String(j.message || "주소정제 실패") };
  }
  return {
    ok: true,
    cityGunGu: String(j.city_gun_gu || ""),
    dong: String(j.dong || ""),
    areaNo: String(j.area_no || ""),
    zipNo: String(j.zip_no || ""),
    branchCd: String(j.brnshp_cd || ""),
    branchNm: String(j.brnshp_nm || ""),
    empNm: String(j.emp_nm || ""),
    // 배송불가 지역 신호. CS 가 반품 회수 예약 전에 봐야 하는 값이다.
    dlvMsg: String(j.dlv_msg || ""),
    deliverable: !String(j.dlv_msg || ""),
    airFare: String(j.air_fare || "0"),
    shipFare: String(j.ship_fare || "0"),
    error: ""
  };
}

// ── 진단 (GAS 에디터에서 실행) ───────────────────────────
/**
 * 연결·권한·쿼터를 한 번에 점검한다.
 * 로컬 Node 검증은 _lotte_api_test.js 에 있다. 이건 GAS 안에서 도는 판이다.
 */
function csLotteSelfTest() {
  var out = { env: _LOTTE_USE_PROD_ ? "운영" : "개발", host: _lotte_host_(), steps: [] };

  try {
    _lotte_key_();
    out.steps.push({ step: "키 로드", ok: true });
  } catch (e) {
    out.steps.push({ step: "키 로드", ok: false, msg: e.message });
    return out;
  }

  var addr = csLotteRefineAddress({
    areaNo: "04527", zipNo: "100801", address: "서울 중구 통일로 10 10층",
    pickAreaNo: "08500", pickZipNo: "153803",
    pickAddress: "서울 금천구 가산디지털2로 179"
  });
  out.steps.push({
    step: "주소정제 (거래처 " + _LOTTE_CUST_CD_ + ")",
    ok: addr.ok,
    msg: addr.ok ? (addr.branchNm + " / " + addr.empNm) : addr.error
  });

  var trk = csLotteTrack("313633845254", { noCache: true });
  out.steps.push({
    step: "화물추적 (거래처 " + _LOTTE_TRACK_CUST_CD_ + ")",
    ok: trk.ok,
    msg: trk.ok ? (trk.statusName + " · " + trk.lastAt + " · " + trk.lastMsg) : trk.error
  });

  if (_LOTTE_TRACK_CUST_CD_ !== _LOTTE_CUST_CD_) {
    out.steps.push({
      step: "⚠ 화물추적 거래처코드",
      ok: false,
      msg: "아직 테스트코드(" + _LOTTE_TRACK_CUST_CD_ + ")를 쓰고 있습니다. " +
           "연계 등록이 끝나면 _LOTTE_TRACK_CUST_CD_ 를 " + _LOTTE_CUST_CD_ + " 로 바꾸세요."
    });
  }

  out.quota = csLotteQuotaUsed();
  return out;
}

/**
 * 거래관리시스템송장 — 롯데 송장 탭 구조 확인
 * 파일: csLotte.gs  ★ 2026-09-03 신규
 *
 * 반품 회수 송장을 사람이 손으로 넣지 않고 이 탭에서 읽어오려면, 먼저
 * 회수분이 어떤 모양으로 들어오는지 알아야 한다. 출고분과 같은 탭에 섞여
 * 있다면 무엇으로 구분하는지(열·값·집하일자)를 봐야 잘못 붙이지 않는다.
 *
 * 개인정보는 마스킹해서 찍는다 — 구조만 보면 되고 로그에 남길 이유가 없다.
 */
var _CS_TRADE_INVOICE_SS_ID_ = "1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs";
var _CS_TRADE_LOTTE_GID_ = 1575029201;

function _cs_colLetterOf_(i) {
  var n = Number(i) + 1, s = "";
  while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function _cs_maskCell_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  // 전화번호 꼴은 뒤 4자리만
  if (/^[\d\-]{9,14}$/.test(s) && /-/.test(s)) return "***-****-" + s.slice(-4);
  // 사람 이름 꼴(한글 2~4자)은 첫 글자만
  if (/^[가-힣]{2,4}$/.test(s)) return s.charAt(0) + "*".repeat(s.length - 1);
  return s.length > 28 ? s.slice(0, 28) + "…" : s;
}

function csDiagnoseTradeInvoiceSheet() {
  var out = { 시트: "", 탭목록: [], 대상탭: "", 행수: 0, 헤더: [], 표본: [], 오류: "" };
  try {
    var ss = SpreadsheetApp.openById(_CS_TRADE_INVOICE_SS_ID_);
    out.시트 = ss.getName();

    var sheets = ss.getSheets();
    var target = null;
    for (var i = 0; i < sheets.length; i++) {
      out.탭목록.push(sheets[i].getName() + " (gid " + sheets[i].getSheetId() + ")");
      if (sheets[i].getSheetId() === _CS_TRADE_LOTTE_GID_) target = sheets[i];
    }
    if (!target) { out.오류 = "gid " + _CS_TRADE_LOTTE_GID_ + " 탭을 못 찾음"; Logger.log(JSON.stringify(out, null, 2)); return out; }

    out.대상탭 = target.getName();
    var lr = target.getLastRow(), lc = Math.min(target.getLastColumn(), 40);
    out.행수 = lr;
    if (lr < 1) { out.오류 = "빈 탭"; Logger.log(JSON.stringify(out, null, 2)); return out; }

    var vals = target.getRange(1, 1, Math.min(lr, 6), lc).getDisplayValues();
    var hdr = vals[0] || [];
    for (var c = 0; c < lc; c++) {
      var h = String(hdr[c] || "").trim();
      if (h) out.헤더.push(_cs_colLetterOf_(c) + ": " + h);
    }
    // 최근 행이 궁금하다 — 맨 아래 3줄
    var from = Math.max(2, lr - 2);
    var recent = target.getRange(from, 1, Math.min(3, lr - from + 1), lc).getDisplayValues();
    for (var r = 0; r < recent.length; r++) {
      var cells = [];
      for (var c2 = 0; c2 < lc; c2++) {
        var v = _cs_maskCell_(recent[r][c2]);
        if (v) cells.push(_cs_colLetterOf_(c2) + "=" + v);
      }
      out.표본.push((from + r) + "행: " + cells.join(" | "));
    }
  } catch (e) {
    out.오류 = e.message;
  }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
