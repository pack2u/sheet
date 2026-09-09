/**
 * ══════════════════════════════════════════════════════════════
 *  롯데택배 Open API 연동 — 호출 래퍼
 *  규격: 롯데택배_OpenAPI_규격.md   키: _secrets.gs (LOTTE_API_KEY_DEV/PROD)
 *
 *  ★ 키는 여기 적지 않는다 ★
 *    이 파일은 git 에 올라간다. 키는 _secrets.gs 에만 둔다(.gitignore 대상).
 *    _secrets.gs 는 .claspignore 에도 넣어 두었다. push 가 서버 값을 덮지 않는다.
 *    그래서 **서버의 키는 Apps Script 편집기에서 직접 넣고 고친다.**
 *
 *  ★ 지금 쓸 수 있는 것 (2026-09-08 운영 연동 완료) ★
 *    주소정제  — 우리 거래처코드(348782)로 동작 확인
 *    화물추적  — 우리 거래처코드로 실제 송장 조회 확인
 *
 *    운영(apigw)만 쓴다. 개발 샌드박스에는 348782 의 화물추적 「연계 등록」이
 *    없고, 우리 실제 송장 데이터 자체도 없다. 개발로 되돌리려면 연계 등록부터
 *    받아야 하고, _LOTTE_TRACK_CUST_CD_ 도 테스트코드 101000 으로 바꿔야 한다.
 *
 *  ★ 쿼터 ★
 *    하루 10,000건. 화면을 새로고침할 때마다 부르면 금방 는다.
 *    그래서 (1) 응답을 캐시하고 (2) 일일 호출수를 세어 상한 앞에서 멈춘다.
 *    쿼터를 다 쓰면 CS 화면에서 배송조회가 통째로 죽으므로, 여유를 남긴다.
 *
 *  ★ 상태코드 ★
 *    담당자가 준 코드표에 없는 코드가 온다(02 출력·05 집하출발·45 인수자등록).
 *    같은 코드가 상황별로 다른 이름을 쓴다(20 구간발송/셔틀발송, 21 셔틀도착/구간도착).
 *    그래서 표보다 응답의 godsStatNm 을 우선한다. 표를 우선하면 다 "도착"이 된다.
 * ══════════════════════════════════════════════════════════════
 */

// ── 환경 ────────────────────────────────────────────────
/**
 * 운영 사용 여부.
 * ★ 2026-09-08 운영 전환 ★
 *   운영 앱 C017229 로 실제 우리 송장 조회를 확인했다.
 *   개발(C011308)은 화물추적 연계 등록이 안 돼 있어 쓸 수 없다 —
 *   되돌리려면 그 등록부터 받아야 한다.
 */
var _LOTTE_USE_PROD_ = true;

var _LOTTE_HOST_DEV_ = "https://devapigw.llogis.com:10100";
var _LOTTE_HOST_PROD_ = "https://apigw.llogis.com:10100";

/** 우리 거래처코드 — 주소정제·주문접수에 쓴다 */
var _LOTTE_CUST_CD_ = "348782";

/**
 * 화물추적 거래처코드.
 * ★ 2026-09-08 ★ 운영에서는 우리 코드가 그대로 통한다(연계 등록 완료 확인).
 *   개발 환경으로 되돌릴 때는 이 값을 테스트코드 "101000" 으로 바꿔야 한다.
 *   개발에는 348782 의 화물추적 연계 등록이 없다.
 */
var _LOTTE_TRACK_CUST_CD_ = _LOTTE_CUST_CD_;

// ── 쿼터·캐시 ────────────────────────────────────────────
var _LOTTE_QUOTA_PER_DAY_ = 10000;
/** 상한을 다 쓰지 않고 남긴다. 다른 용도(주문접수)가 굶지 않게. */
var _LOTTE_QUOTA_SOFT_CAP_ = 9000;
var _LOTTE_CACHE_SEC_ = 1800; // 30분

/**
 * 화물상태 코드 → 표시명.
 *
 * ★ 이 표는 최후의 수단이다 ★
 *   응답이 주는 godsStatNm 을 우선 쓴다(_lotte_statusName_ 참조).
 *   이유는 운영 실데이터에서 드러났다.
 *     - 표에 없는 코드가 나온다 : 02 출력, 05 집하출발, 45 인수자등록
 *     - 같은 코드가 상황별로 다른 이름을 쓴다
 *         20 → "구간발송" / "셔틀발송"   (표에는 그냥 "발송")
 *         21 → "구간도착" / "셔틀도착"   (표에는 그냥 "도착")
 *   표를 우선하면 이 구분이 뭉개진다. 롯데도 "코드는 통보 없이 추가될 수 있다"고 했다.
 *
 *   출처: 롯데 전산 담당자 회신(2026-08-31) + 운영 실호출 관측(2026-09-08)
 */
var _LOTTE_STATUS_ = {
  "02": "출력",       // 관측 (표에 없음)
  "05": "집하출발",   // 관측 (표에 없음)
  "09": "취소",
  "10": "집하",
  "12": "운송장등록",
  "20": "발송",
  "21": "도착",
  "40": "배달전",
  "41": "배달완료",
  "45": "인수자등록"  // 관측 (표에 없음)
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
 *
 * ★ 응답이 준 이름을 먼저 쓴다 ★
 *   롯데 코드표보다 응답의 godsStatNm 이 더 정확하고 구체적이다.
 *   운영 실데이터에서 21 이 "셔틀도착"과 "구간도착"으로 갈리는데,
 *   표를 우선하면 둘 다 "도착"으로 뭉개진다. CS 가 화물 위치를 못 읽는다.
 *   표는 응답에 이름이 비어 있을 때만 쓴다.
 */
function _lotte_statusName_(code, respNm) {
  var nm = String(respNm == null ? "" : respNm).trim();
  if (nm) return nm;
  var c = String(code == null ? "" : code);
  return _LOTTE_STATUS_[c] || ("코드 " + c);
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

  // 이력을 시간순으로 세운다. 응답 순서는 시간순이 아니다.
  //   운영 실데이터에서 10:집하(17:31) 다음에 12:운송장등록(21:00)이 오고
  //   그 다음에 21:셔틀도착(18:26)이 온다. 그대로 보여주면 CS 가 헷갈린다.
  var raw = j.tracking || [];
  var hist = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    // ★ 시각이 "------" 로 오는 이벤트가 있다 (45:인수자등록에서 관측) ★
    //   비면 그 날의 끝으로 본다. 시각 없는 이벤트는 성격상 그날 마지막 처리다.
    var tm = _lotte_digits_(t.scanTme);
    hist.push({
      code: String(t.godsStatCd || ""),
      name: _lotte_statusName_(t.godsStatCd, t.godsStatNm),
      at: _lotte_when_(t.scanYmd, t.scanTme),
      sortKey: _lotte_digits_(t.scanYmd) + (tm.length === 6 ? tm : "999999") +
               ("00" + i).slice(-3), // 동시각이면 응답 순서를 유지한다
      branch: String(t.brnshpNm || ""),
      branchTel: String(t.brnshpTel || "").trim(),
      /* ★ 2026-09-08: 담당기사 ★
         응답에 empNm·empTel 이 오는데 여태 버리고 있었다. 롯데 홈페이지 조회에는
         나오는 값이라 CS 가 "기사님 번호 좀" 하면 그쪽을 다시 찾아봐야 했다.
         배달전·배달완료 단계에서만 채워져 온다. */
      empNm: String(t.empNm || "").trim(),
      empTel: String(t.empTel || "").trim(),
      msg: String(t.status || "")
    });
  }
  hist.sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0); });

  // 대표 상태 — 배달완료(41)가 있으면 그것을 쓴다.
  //   마지막 이벤트를 그대로 쓰면 45:인수자등록 같은 후속 처리가 대표가 되어
  //   "배달됐나?" 만 알고 싶은 CS 에게 오히려 불친절하다.
  var done = null;
  for (var d = 0; d < hist.length; d++) {
    if (hist[d].code === _LOTTE_STATUS_DONE_) done = hist[d];
  }
  var last = done || (hist.length ? hist[hist.length - 1] : null);

  /* 담당기사는 **가장 최근에 이름이 찍힌 이벤트**에서 가져온다.
     마지막 이벤트(45:인수자등록 등)에는 비어 있는 일이 많아 last 만 보면 놓친다. */
  var emp = null;
  for (var e = hist.length - 1; e >= 0; e--) {
    if (hist[e].empNm || hist[e].empTel) { emp = hist[e]; break; }
  }

  /* ★ 2026-09-09: 주문번호로 물었으면 송장번호를 응답에서 꺼낸다 ★
     result[].invNo 를 여태 버리고 있었다. 송장으로 물을 때는 우리가 넣은 값을
     그대로 돌려주면 그만이라 티가 안 났는데, 주문번호로 물으면 inv 가 비어
     **알고 싶은 송장번호가 안 온다.** 그게 주문번호 조회의 목적인데도.
     (일일마감에 송장이 안 붙은 건 — csLotteLookup.gs 참조) */
  var resInv = "";
  var resSummary = "";
  var rl = j.result || [];
  for (var q = 0; q < rl.length; q++) {
    if (!resInv) resInv = _lotte_digits_(rl[q].invNo);
    if (!resSummary) resSummary = String(rl[q].cdNm || "").trim();
  }

  var out = {
    ok: true,
    invoice: inv || resInv,
    ordNo: ordNo,
    summary: resSummary,
    statusCode: last ? last.code : "",
    statusName: last ? last.name : "이력 없음",
    delivered: !!done,
    lastAt: last ? last.at : "",
    lastMsg: last ? last.msg : "",
    branch: last ? last.branch : "",
    branchTel: last ? last.branchTel : "",
    empNm: emp ? emp.empNm : "",
    empTel: emp ? emp.empTel : "",
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
