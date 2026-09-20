/**
 * Pack2U CS 주문/송장 검색
 *
 * ★ 2026-09-16: 통합조회를 지웠다 ★
 *   > "cs웹앱도 통합 조회가 아닌 일일마감을 불러다 데이타로 쓰게 해줘"
 *   > "통합조회는 신뢰도가 무너진거라.. 통합조회텝 자체를 삭제할거니까"
 *
 *   통합조회는 여러 원천을 이름·전화·주소로 «이어 붙이는» 것이 본업이라
 *   추측이 본질이었다. 송장 없던 줄에 남의 송장이 붙고, 붙었으니 마감으로
 *   넘어가 고객 전화로 알았다.
 *
 *   이제 원천은 둘이다 — 둘 다 고유ID 를 처음부터 들고 있다.
 *     ① 세트분리 「주문라인원장」  (기본. 파일 1개)
 *     ② 일일마감_(YYYY-MM-DD) 파일  (원장을 못 읽을 때)
 *   당일 건은 허브·임시기록 오버레이가 보탠다.
 */

var _CS_DAILY_PREFIX_ = "일일마감_";

/**
 * 조회 일수. 원장은 최근 회차만 들고 있고, 일일마감은 날짜별 파일이다.
 * 늘리면 파일을 그만큼 더 연다 — 예열이 느려진다.
 */
var _CS_DAILY_DAYS_DEFAULT_ = 30;   // 2026-09-16: 한 달 (버튼 7·14·30)
var _CS_DA_CACHE_TTL_ = 21600; // 6시간
var _CS_DA_CACHE_VER_ = "v15";
var _CS_SEARCH_LIMIT_ = 80;


/* ══════════════════════════════════════════════════════════════
 *  세트분리(뉴) 「주문라인원장」 — 통합조회를 대신할 후보
 *  2026-09-14
 *
 *  > "통합조회를 위해 재매칭을 하는데 이부분의 에러가 제일큰거 같아..
 *  >  그래서 통합조회를 없애려고 하는거고"
 *
 *  ★ 왜 원장이 나은가 ★
 *    통합조회는 여러 원천을 «이름·전화·주소로 이어 붙이는» 것이 본업이다.
 *    추측이 본질이라 틀릴 수 있고, 실제로 틀렸다 — 송장 없던 줄에 남의
 *    송장이 붙고, 붙었으니 마감으로 넘어가 고객 전화로 알았다.
 *    원장은 고유ID 를 처음부터 들고 있다. 이어 붙일 일이 없다.
 *
 *  ★ 지금은 «꺼져 있다» ★
 *    스크립트 속성 CS_USE_LEDGER 를 "1" 로 넣어야 쓴다. 넣기 전까지
 *    이 파일이 하는 일은 하나도 안 바뀐다 — 되돌릴 것이 없다.
 *    켜도 원장에서 못 찾으면 통합조회로, 그것도 없으면 일일마감으로 내려간다.
 *
 *  ★ 자리가 아니라 «이름»으로 읽는다 ★
 *    원장은 46열이고 사람이 계속 손댄다. 자리를 박아 두면 한 칸만 밀려도
 *    오류 없이 엉뚱한 칸을 읽는다.
 * ══════════════════════════════════════════════════════════════ */
var _CS_LEDGER_SS_ID_ = "1JuwZjorbBG7tOa92xfAy07eUV-r2j2P8bpbYrgCDAwo"; // 세트분리(뉴)
var _CS_LEDGER_TAB_ = "주문라인원장";
var _CS_LEDGER_CACHE_TTL_ = 3600;

/**
 * 원장 경로 — «기본이 켜짐»이다.  (2026-09-15)
 *
 * 전에는 CS_USE_LEDGER="1" 을 넣어야 켜졌다. 그래서 만들어 놓고 한 번도
 * 안 쓰였다 — 켤 사람이 그 속성을 알아야 켜지는 스위치는 꺼진 것과 같다.
 *
 * 이제 «끄려면» CS_USE_LEDGER="off" 를 넣는다. 되돌리기는 그 한 칸이다.
 *
 * ★ 못 읽으면 저절로 옛길로 내려간다 ★
 *   원장을 못 읽으면 통합조회, 그것도 없으면 일일마감 14파일.
 *   그래서 켜도 «나빠질 자리»가 없다 — 잘되면 추측이 사라지고,
 *   안 되면 어제까지와 똑같다.
 */
function _cs_ledgerViewEnabled_() {
  try {
    return PropertiesService.getScriptProperties().getProperty("CS_USE_LEDGER") !== "off";
  } catch (e) {
    return true;
  }
}

/** 일일마감 파일이 있을 수 있는 Drive 폴더 (허브 아카이브 폴백) */
var _CS_DAILY_FOLDER_IDS_ = [
  "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl",
  "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v"
];

/**
 * 검색 진입점 (웹앱 google.script.run)
 * @param {string} query
 * @param {Object=} opts { days: 7|14, refresh: boolean }
 */
function csSearchOrders(query, opts) {
  opts = opts || {};
  var days = _cs_clampDays_(opts.days);
  var refresh = !!opts.refresh;
  var q = String(query || "").trim();
  if (!q) {
    return {
      ok: true,
      query: "",
      results: [],
      meta: _cs_buildMeta_(days, refresh, true)
    };
  }

  try {
    var pack = _cs_loadSearchIndex_(days, refresh);
    var results = _cs_filterRows_(pack.rows, q);
    _cs_markCombinedPack_(results, pack.rows);
    return {
      ok: true,
      query: q,
      results: results,
      totalHits: results.length,
      truncated: results.length >= _CS_SEARCH_LIMIT_,
      meta: {
        days: days,
        from: pack.from,
        to: pack.to,
        loadedDays: pack.loadedDays,
        missingDays: pack.missingDays,
        rowCount: pack.rows.length,
        cachedDays: pack.cachedDays,
        loadMs: pack.loadMs,
        errors: pack.errors
      }
    };
  } catch (e) {
    return { ok: false, error: e.message, results: [] };
  }
}

/** 페이지 로드 시 캐시 워밍 (날짜 단위) */
function csWarmArchiveCache(opts) {
  opts = opts || {};
  var days = _cs_clampDays_(opts.days);
  var refresh = !!opts.refresh;
  try {
    var pack = _cs_loadSearchIndex_(days, refresh);
    return {
      ok: true,
      from: pack.from,
      to: pack.to,
      loadedDays: pack.loadedDays,
      missingDays: pack.missingDays,
      rowCount: pack.rows.length,
      cachedDays: pack.cachedDays,
      loadMs: pack.loadMs,
      errors: pack.errors,
      indexSource: pack.indexSource,
      unified: false,   // 통합조회를 지웠다 (2026-09-16)
      viewUpdatedAt: pack.viewUpdatedAt
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 예열 방식 결정. 클라이언트는 이걸 먼저 부르고 unified가 true면
 * 날짜별 csWarmDay 루프(14회 RPC)를 건너뛴다.
 */
function csWarmPlan(days) {
  days = _cs_clampDays_(days);
  try {
    var uv = { found: false };   // 통합조회를 지웠다 (2026-09-16)
    return {
      ok: true,
      unified: !!uv.found,
      days: days,
      rowCount: uv.found ? uv.rows.length : 0,
      updatedAt: uv.updatedAt || "",
      dates: uv.found ? [] : _cs_dateList_(days),
      error: uv.error || ""
    };
  } catch (e) {
    return { ok: false, unified: false, days: days, dates: _cs_dateList_(days), error: e.message };
  }
}

/**
 * 원장 경로 상태 진단. csDiagnoseUnifiedView 와 짝이다.
 * 편집기에서 이 함수를 실행하고 로그를 본다.
 */
function csDiagnoseLedgerView() {
  var out = { enabled: _cs_ledgerViewEnabled_(), ss: _CS_LEDGER_SS_ID_, tab: _CS_LEDGER_TAB_ };
  try {
    var ss = SpreadsheetApp.openById(_CS_LEDGER_SS_ID_);
    var tab = ss.getSheetByName(_CS_LEDGER_TAB_);
    out.tabExists = !!tab;
    out.lastRow = tab ? tab.getLastRow() : 0;
    out.lastCol = tab ? tab.getLastColumn() : 0;
  } catch (e) {
    out.openError = e.message;
  }
  var lg = _cs_loadLedgerView_(_CS_DAILY_DAYS_DEFAULT_, true);
  out.loaded = lg.found;
  out.rows = lg.rows.length;
  out.updatedAt = lg.updatedAt;
  out.loadError = lg.error;

  var noInv = 0, byDate = {};
  for (var i = 0; i < lg.rows.length; i++) {
    if (String(lg.rows[i].invDigits || "").replace(/[^0-9]/g, "").length < 8) noInv++;
    var k = String(lg.rows[i].date || "(날짜없음)").slice(0, 10);
    byDate[k] = (byDate[k] || 0) + 1;
  }
  out.noInvoice = noInv;
  out.byDate = byDate;
  out.verdict = out.enabled
    ? (lg.found ? "원장 사용 중. 미매칭 " + noInv + "건" : "원장을 못 읽음 → 일일마감 파일로 폴백")
    : "원장 경로 꺼짐 (CS_USE_LEDGER 가 \"off\") — 지금은 일일마감 파일을 씁니다";
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** 하루치만 워밍 (통합조회 폴백 경로 전용. 클라이언트에서 날짜별 호출) */
function csWarmDay(dateStr, refresh) {
  dateStr = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { ok: false, error: "날짜 형식 오류", date: dateStr };
  }
  try {
    var day = _cs_loadDay_(dateStr, !!refresh, false);
    return {
      ok: true,
      date: dateStr,
      rows: day.rows.length,
      data: day.rows || [],
      cached: day.fromCache,
      found: day.found,
      error: day.error || ""
    };
  } catch (e) {
    return { ok: false, date: dateStr, error: e.message, data: [] };
  }
}

/**
 * 브라우저 메모리용 인덱스. cacheOnly면 Drive를 열지 않고 서버 캐시만 반환.
 */
function csGetSearchIndex(opts) {
  opts = opts || {};
  var days = _cs_clampDays_(opts.days);
  var refresh = !!opts.refresh;
  var cacheOnly = !!opts.cacheOnly;
  try {
    var pack = _cs_loadSearchIndex_(days, refresh, cacheOnly);
    return {
      ok: true,
      rows: pack.rows,
      from: pack.from,
      to: pack.to,
      loadedDays: pack.loadedDays,
      missingDays: pack.missingDays,
      cachedDays: pack.cachedDays,
      rowCount: pack.rows.length,
      loadMs: pack.loadMs,
      errors: pack.errors,
      cacheOnly: cacheOnly,
      indexSource: pack.indexSource,
      unified: false,   // 통합조회를 지웠다 (2026-09-16)
      viewUpdatedAt: pack.viewUpdatedAt
    };
  } catch (e) {
    return { ok: false, error: e.message, rows: [] };
  }
}

/** 최근 N일 파일 존재 여부만 빠르게 확인 */
function csListArchiveDays(days) {
  days = _cs_clampDays_(days);
  var dates = _cs_dateList_(days);
  var cache = CacheService.getScriptCache();
  var out = [];
  for (var i = 0; i < dates.length; i++) {
    var d = dates[i];
    var cached = !!cache.get(_cs_daCacheKey_(d));
    out.push({ date: d, cached: cached });
  }
  return { ok: true, days: days, from: dates[dates.length - 1], to: dates[0], list: out };
}

/**
 * 바코드 CS lookupByInvoice 4차 소스
 * @param {string} invDigits 숫자만
 * @return {Object|null}
 */
function _cs_searchDailyArchiveByInvoice_(invDigits) {
  if (!invDigits || String(invDigits).length < 8) return null;
  var pack = _cs_loadSearchIndex_(_CS_DAILY_DAYS_DEFAULT_, false);
  var needle = String(invDigits).replace(/[^0-9]/g, "");
  for (var i = 0; i < pack.rows.length; i++) {
    var r = pack.rows[i];
    if (String(r.invDigits || "").indexOf(needle) !== -1) {
      return {
        found: true,
        source: (pack.indexSource === "ledger" ? "원장" : "일일마감")
          + "(" + r.date + ")" + (r.source ? " · " + r.source : ""),
        invoiceNumber: r.invoice || needle,
        vendor: r.vendor || "",
        uniqueId: r.orderNo || "",
        orderDate: r.date || "",
        ecountCode: r.ecountCode || "",
        productName: r.item || "",
        quantity: r.qty || "",
        recipientName: r.name || "",
        recipientPhone: r.phone || "",
        recipientAddr: r.addr || "",
        shipMsg: r.shipMsg || "",
        memo: r.orderNo || "",
        status: r.source || ""
      };
    }
  }
  return null;
}

// ══════════════════════════════════════════════
//  인덱스 로드
// ══════════════════════════════════════════════

/**
 * 세트분리(뉴) 주문라인원장 → 검색 행. 통합조회와 «같은 모양»으로 낸다.
 *
 *  ★ 같은 모양이어야 하는 이유 ★
 *    아래 오버레이·정렬·화면이 전부 이 모양을 전제한다. 모양이 다르면
 *    바꿔 끼우는 순간 그 모두를 같이 고쳐야 하고, 그러면 되돌릴 수가 없다.
 *
 *  ★ 한 주문이 여러 줄이다 ★
 *    원장은 «주문라인» 단위다. 세트가 둘로 쪼개지면 두 줄이다. 통합조회도
 *    품목 단위라 결이 같다 — 합치지 않고 그대로 낸다.
 */
/**
 * 이 줄이 «방문수령»인가 — 적요에 적힌 말로만 가린다.
 *
 * > "자사 직접이라고 나오는데 방문수령이라고 나오게 해줘"
 *
 * ★ 「자사 직접」은 방문수령이 아니다 ★
 *   그것은 «송장을 자사출고 탭에서 찾았다»는 뜻이다(세트분리 gasMain.js:1748).
 *   택배로 나간 건에도 붙는다. 이름만 바꾸면 택배 주문이 전부
 *   방문수령으로 보인다 — 그래서 «진짜 방문수령»만 따로 가린다.
 *
 * ★ 배송메시지는 안 본다 ★
 *   그 칸은 고객이 쓴 «요청»이지 우리가 확인한 «사실»이 아니다.
 *   적요는 우리 쪽이 적는 칸이다. (2026-09-16 에 배송메시지의
 *   「합배송 해주세요」를 「합배송 되었다」로 읽을 뻔한 일이 있었다.)
 *
 * ★ 「방문」이나 「직접」 한 글자로는 안 잡는다 ★
 *   「직접 전화주세요」·「방문예정」 같은 말이 걸린다.
 *   허브 _partnerInvoiceAudit.gs 의 집계는 느슨한 자를 쓰지만, 그것은
 *   «송장 없는 줄»만 세는 참고표다. 카드마다 붙는 딱지는 더 엄해야 한다.
 */
function _cs_isPickupMemo_(memo) {
  var s = String(memo == null ? "" : memo).split(" ").join("");
  if (!s) return false;
  if (s.indexOf("방문수령") >= 0) return true;
  if (s.indexOf("직접수령") >= 0) return true;
  if (s.indexOf("픽업") >= 0) return true;
  //  「방문」과 「수령」이 떨어져 적혀도 같은 뜻이다 («방문하셔서 수령»)
  if (s.indexOf("방문") >= 0 && s.indexOf("수령") >= 0) return true;
  return false;
}

function _cs_loadLedgerView_(days, refresh) {
  var out = { found: false, rows: [], updatedAt: "", error: "", fromCache: false };
  var cache = CacheService.getScriptCache();
  var key = _CS_DA_CACHE_VER_ + "_lg_" + days;

  if (!refresh) {
    try {
      var hit = cache.get(key);
      if (hit) {
        var pk = JSON.parse(hit);
        out.found = true;
        out.rows = pk.rows || [];
        out.updatedAt = pk.updatedAt || "";
        out.fromCache = true;
        return out;
      }
    } catch (e) {}
  }

  try {
    var ss = SpreadsheetApp.openById(_CS_LEDGER_SS_ID_);
    var tab = ss.getSheetByName(_CS_LEDGER_TAB_);
    if (!tab || tab.getLastRow() < 2) return out;

    var cols = tab.getLastColumn();
    var data = tab.getRange(1, 1, tab.getLastRow(), cols).getDisplayValues();

    //  ★ 이름으로 찾는다 ★ 원장은 46열이고 사람이 계속 손댄다.
    var ix = {};
    for (var h = 0; h < data[0].length; h++) {
      var hn = String(data[0][h] || "").trim();
      if (hn && ix[hn] === undefined) ix[hn] = h;
    }
    var 필요 = ["회차키", "고유ID", "거래처명", "품목명", "운송장번호"];
    for (var nq = 0; nq < 필요.length; nq++) {
      if (ix[필요[nq]] === undefined) {
        out.error = "원장 머리글에 「" + 필요[nq] + "」 열이 없습니다";
        return out;
      }
    }
    var G = function (row, name) { return ix[name] === undefined ? "" : String(row[ix[name]] || "").trim(); };

    var fromN = _cs_dateList_(days);
    var minN = fromN[fromN.length - 1].replace(/-/g, "");

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rk = G(row, "회차키");
      //  회차키는 YYMMDD-N 이다. 이 꼴이 아니면 원장 줄이 아니다.
      if (!/^[0-9]{6}-[0-9]+$/.test(rk)) continue;
      var ymd8 = "20" + rk.substring(0, 6);
      if (ymd8 < minN) continue;
      var d = ymd8.substring(0, 4) + "-" + ymd8.substring(4, 6) + "-" + ymd8.substring(6, 8);

      var nm = _cs_nameOnly_(G(row, "거래처명"));
      var item = G(row, "품목명");
      var invRaw = G(row, "운송장번호");
      if (!nm && !item && !invRaw) continue;

      var addr = G(row, "주소1");
      var tel = G(row, "전화") || G(row, "모바일");
      var uid = G(row, "사방넷주문번호") || G(row, "고유ID");
      var 경로 = G(row, "경로");
      var 보류 = G(row, "보류사유");

      out.rows.push({
        date: d,
        invoice: invRaw.replace(/\n/g, " ").trim(),
        invDigits: _cs_allInvDigits_(invRaw),
        phone: _cs_phoneDisplay_(tel),
        phoneDigits: _cs_phoneDigits_(tel),
        name: nm,
        item: item,
        ecountCode: _cs_readEcountCodeCell_(G(row, "원본품목코드") || G(row, "품목코드")),
        qty: G(row, "수량"),
        addr: addr,
        shipMsg: _cs_sanitizeShipMsg_(G(row, "배송메시지"), addr),
        source: G(row, "송장매칭") || 경로,
        //  적요에 적힌 방문수령. 「자사 직접」(송장을 어디서 찾았나)과는 다른 것이다.
        pickup: _cs_isPickupMemo_(G(row, "적요")),
        orderNo: uid,
        vendor: G(row, "조치업체"),
        //  택배사는 «적힌 것»만 쓴다. 지어내지 않는다.
        carrier: G(row, "택배사"),
        status: 보류 ? 경로 + "(" + 보류 + ")" : 경로,
        origin: "ledger",
        match: G(row, "주문번호출처") === "자동발급" ? "자동발급" : "UID",
        combinedPack: !!G(row, "합포장그룹")
      });
      var 갱신 = G(row, "실행시각");
      if (갱신 > out.updatedAt) out.updatedAt = 갱신;
    }
    out.found = out.rows.length > 0;
    if (out.found) _cs_putUvCache_(cache, key, out.rows, out.updatedAt);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

/*  ★ 자릿수로 택배사를 가르던 함수를 지웠다 ★  (2026-09-15)
    > "자릿수로 택배사는 못구별해.. 택배사 정보를 읽게 만들어줘"

    12자리면 롯데, 그 밖은 로젠이라고 했다. 자사출고 둘만 볼 때는 맞았지만
    대리발송은 업체가 제 택배사로 보낸다 — 한진도 CJ도 대신도 그 자릿수다.
    한진으로 나간 건에 롯데가 찍혔다.

    이제 원장에 「택배사」 칸이 있고 송장 전파가 «송장을 읽은 탭»이 알려 준
    값을 그대로 적는다(gasMain.js ss_송장전파). 짐작할 자리가 없어졌다.
    아직 안 적힌 옛 줄은 빈칸으로 둔다 — 틀린 택배사보다 빈칸이 낫다. */

function _cs_putUvCache_(cache, key, rows, updatedAt) {
  try {
    cache.put(key, JSON.stringify({ rows: rows, updatedAt: updatedAt }), 3600);  // 1시간
  } catch (e) {
    // 100KB 초과. 캐시 실패는 치명적이지 않다 — 파일 1개 읽기라 비용이 낮다.
  }
}

function _cs_loadSearchIndex_(days, refresh, cacheOnly) {
  var t0 = Date.now();
  var dates = _cs_dateList_(days);
  var rows = [];
  var loadedDays = 0;
  var cachedDays = 0;
  var missingDays = [];
  var errors = [];
  var indexSource = "daily";
  var viewUpdatedAt = "";

  /* ── 원장 우선 (켰을 때만) ──  (2026-09-14)
     통합조회는 이름·전화로 «이어 붙인» 결과다. 원장은 고유ID 를 처음부터
     들고 있어 이어 붙일 일이 없다. 다만 바로 갈아타지 않는다 —
     스크립트 속성 CS_USE_LEDGER="1" 일 때만 쓰고, 못 읽으면 아래로 내려간다.
     그래서 켜기 전까지 이 함수의 동작은 하나도 안 바뀐다. */
  var lgv = _cs_ledgerViewEnabled_() ? _cs_loadLedgerView_(days, refresh) : { found: false };
  if (lgv.found) {
    indexSource = "ledger";
    viewUpdatedAt = lgv.updatedAt;
    rows = lgv.rows;
    loadedDays = days;
    if (lgv.fromCache) cachedDays = days;
    if (lgv.error) errors.push("원장: " + lgv.error);
  }

  /*  ══════════════════════════════════════════════════════════
      ★ 통합조회 단을 «지웠다» ★  (2026-09-16)

      > "cs웹앱도 통합 조회가 아닌 일일마감을 불러다 데이타로 쓰게 해줘"
      > "통합조회는 신뢰도가 무너진거라.. 통합조회텝 자체를 삭제할거니까"

      통합조회는 여러 원천을 이름·전화·주소로 «이어 붙이는» 것이 본업이라
      추측이 본질이었다. 송장 없던 줄에 남의 송장이 붙고, 붙었으니
      마감으로 넘어가 고객 전화로 알았다.

      이제 두 단이다:  세트분리 주문라인원장  →  일일마감 파일
      둘 다 고유ID 를 처음부터 들고 있어 이어 붙일 일이 없다.
      ══════════════════════════════════════════════════════════ */
  if (!lgv.found) {
    if (lgv.error) errors.push("원장: " + lgv.error + " → 일일마감 파일로 폴백");
    for (var i = 0; i < dates.length; i++) {
      var day = _cs_loadDay_(dates[i], refresh, cacheOnly);
      if (day.error) errors.push(dates[i] + ": " + day.error);
      if (!day.found) {
        missingDays.push(dates[i]);
        continue;
      }
      loadedDays++;
      if (day.fromCache) cachedDays++;
      for (var r = 0; r < day.rows.length; r++) rows.push(day.rows[r]);
    }
  }

  try {
    var extraRows = [];
    extraRows = extraRows.concat(_cs_loadHubRecent_(dates[dates.length - 1], dates[0], refresh, cacheOnly));
    extraRows = extraRows.concat(_cs_loadTempRecent_(dates[dates.length - 1], dates[0], refresh, cacheOnly));
    // 통합조회는 전날 밤 기준이라 당일 허브·임시기록은 여기서 보탠다.
    // 이미 있는 행과 같으면 빈 송장·전화만 채우고, 새 건만 추가한다.
    _cs_overlayExtraRows_(rows, extraRows);
  } catch (eHub) {
    errors.push("허브/임시기록: " + eHub.message);
  }

  try {
    var bulkIdx = _cs_loadSabangBulkIndex_(refresh);
    for (var ri = 0; ri < rows.length; ri++) {
      _cs_enrichCarrier_(rows[ri], bulkIdx);
    }
  } catch (eCarrier) {
    errors.push("택배사(사방넷대량): " + eCarrier.message);
  }

  // 수량 1개인데 송장 40장이 붙은 행은 검색·표시에서 뺀다.
  // 대리발송 사람키에 그 업체 송장이 쌓인 과거 마감이 통합조회에 그대로 남아 있다.
  for (var si = 0; si < rows.length; si++) _cs_stripOverflowInvoice_(rows[si]);

  return {
    rows: rows,
    from: dates[dates.length - 1],
    to: dates[0],
    loadedDays: loadedDays,
    missingDays: missingDays,
    cachedDays: cachedDays,
    errors: errors,
    indexSource: indexSource,
    viewUpdatedAt: viewUpdatedAt,
    loadMs: Date.now() - t0
  };
}

/** 통합조회에 이미 있는 건과 허브·임시기록을 맞춘다. 주문번호는 `이름/고유ID` 와 고유ID 만 있어도 같다. */
function _cs_overlayOrderKey_(rec) {
  var id = _cs_orderKeyPart_(rec);
  if (!id) return "";
  return String(rec.date || "") + "|" + id + "|" + String(rec.item || "").trim();
}

function _cs_orderKeyPart_(rec) {
  var o = String((rec && rec.orderNo) || "").trim();
  if (!o) return "";
  var uid = _cs_orderNoFromName_(o);
  return String(uid || o).replace(/\s/g, "").toLowerCase();
}

function _cs_overlayPersonKey_(rec) {
  var n = String((rec && rec.name) || "").replace(/\s/g, "").toLowerCase();
  var item = String((rec && rec.item) || "").trim();
  if (!n || !item) return "";
  return n + "|" + item + "|" + String(rec.phoneDigits || "");
}

function _cs_fillSearchRowGaps_(dest, src) {
  if (!dest || !src) return;
  if (!dest.invDigits && src.invDigits) {
    dest.invoice = src.invoice;
    dest.invDigits = src.invDigits;
    if (src.source) dest.source = src.source;
  }
  if (!dest.phoneDigits && src.phoneDigits) {
    dest.phone = src.phone;
    dest.phoneDigits = src.phoneDigits;
  }
  if (!dest.orderNo && src.orderNo) dest.orderNo = src.orderNo;
  if (!dest.carrier && src.carrier) dest.carrier = src.carrier;
  if (!dest.addr && src.addr) dest.addr = src.addr;
}

function _cs_overlayExtraRows_(rows, extraRows) {
  if (!rows || !extraRows || !extraRows.length) return;
  var dailyKeys = {};
  var orderKeys = {};
  var personKeys = {};
  for (var k = 0; k < rows.length; k++) {
    var rk = rows[k];
    if (rk.invDigits) dailyKeys[rk.invDigits + "|" + rk.name + "|" + rk.item] = k;
    var ok = _cs_overlayOrderKey_(rk);
    if (ok) orderKeys[ok] = k;
    var pk = _cs_overlayPersonKey_(rk);
    if (pk) personKeys[pk] = k;
  }
  for (var h = 0; h < extraRows.length; h++) {
    var hr = extraRows[h];
    var idx = -1;
    var hk = hr.invDigits ? (hr.invDigits + "|" + hr.name + "|" + hr.item) : "";
    var ook = _cs_overlayOrderKey_(hr);
    var ppk = _cs_overlayPersonKey_(hr);
    if (hk && Object.prototype.hasOwnProperty.call(dailyKeys, hk)) idx = dailyKeys[hk];
    else if (ook && Object.prototype.hasOwnProperty.call(orderKeys, ook)) idx = orderKeys[ook];
    else if (ppk && Object.prototype.hasOwnProperty.call(personKeys, ppk)) idx = personKeys[ppk];
    if (idx >= 0) {
      _cs_fillSearchRowGaps_(rows[idx], hr);
      continue;
    }
    if (hk) dailyKeys[hk] = rows.length;
    if (ook) orderKeys[ook] = rows.length;
    if (ppk) personKeys[ppk] = rows.length;
    rows.push(hr);
  }
}

function _cs_loadDay_(dateStr, refresh, cacheOnly) {
  var cache = CacheService.getScriptCache();
  var key = _cs_daCacheKey_(dateStr);
  if (!refresh) {
    try {
      var hit = cache.get(key);
      if (hit) {
        var parsed = JSON.parse(hit);
        return { found: true, fromCache: true, rows: parsed.rows || [], error: "" };
      }
    } catch (eC) {}
  }

  if (cacheOnly) return { found: false, fromCache: false, rows: [], error: "" };

  var file = _cs_findDailyFile_(dateStr);
  if (!file) {
    /*  ★ 없는 날은 «없다»고 기억한다 ★  (2026-09-16)
        공휴일·아직 안 만들어진 날은 찾아도 없다. 기억해 두지 않으면
        새로고침마다 드라이브를 다시 뒤진다 — 늘 헛걸음이다.
        30분만 기억한다. 오늘치는 곧 생기므로 오래 붙들면 안 된다.  */
    try { cache.put(key, JSON.stringify({ rows: [] }), 1800); } catch (eN) {}
    return { found: true, fromCache: false, rows: [], error: "" };
  }

  try {
    var ss = SpreadsheetApp.open(file);
    var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
    if (!tab || tab.getLastRow() < 2) {
      return { found: true, fromCache: false, rows: [], error: "데이터 없음" };
    }
    var lc = tab.getLastColumn();
    var lr = tab.getLastRow();
    var vals = tab.getRange(1, 1, lr, lc).getDisplayValues();
    var hdr = vals[0];
    var map = _cs_mapArchiveHeaders_(hdr);
    var isDirectDaily = _cs_isDirectDailyArchiveHeader_(hdr);
    if (isDirectDaily) {
      map.code = 0;
      map.item = 1;
      if (map.qty < 0) map.qty = 2;
    } else {
      _cs_refineCodeColFromData_(map, vals.slice(1, Math.min(vals.length, 31)), hdr);
    }
    var rows = [];
    for (var i = 1; i < vals.length; i++) {
      var rec = _cs_rowFromArchive_(dateStr, vals[i], map);
      if (rec) rows.push(rec);
    }
    _cs_putDayCache_(cache, key, rows);
    return { found: true, fromCache: false, rows: rows, error: "" };
  } catch (e) {
    return { found: false, fromCache: false, rows: [], error: e.message };
  }
}

/** 허브가 일일마감을 모아 두는 하위폴더 (허브 _UNIFIED_DAILY_SUBFOLDER_ 와 같은 이름) */
var _CS_DAILY_SUBFOLDER_ = "일일마감";

/** 실행 1회분 폴더 캐시 — 날짜 14개마다 하위폴더를 다시 뒤지지 않게 */
var _CS_DAILY_FOLDER_CACHE_ = null;

/** 폴더를 못 연 이유를 모아 둔다. 진단이 읽어 간다 */
var _CS_DAILY_FOLDER_ERRORS_ = [];

/**
 * 일일마감 파일을 찾을 폴더 목록.
 * 허브가 「일일마감」 하위폴더에 저장하도록 바뀌었다.
 * 하위폴더를 앞에 두되, 그 이전 파일이 남아 있는 상위 폴더도 뒤에 유지한다.
 */
function _cs_dailyFolders_() {
  if (_CS_DAILY_FOLDER_CACHE_) return _CS_DAILY_FOLDER_CACHE_;

  var ids = [];
  try {
    var propId = String(
      PropertiesService.getScriptProperties().getProperty("UNIFIED_DAILY_ARCHIVE_FOLDER_ID") || ""
    ).trim();
    if (propId) ids.push(propId);
  } catch (eP) {}
  for (var i = 0; i < _CS_DAILY_FOLDER_IDS_.length; i++) ids.push(_CS_DAILY_FOLDER_IDS_[i]);

  /* ★ 2026-09-02: 상품정보 시트의 부모 폴더도 후보에 넣는다.
     허브의 _unified_resolveArchiveFolder_ 는 전용 폴더 ID 가 안 열리면 조용히
     「시트의 부모 폴더」로 폴백해 거기에 일일마감을 저장한다. CS앱은 죽은 ID 만
     보고 있어서 폴백이 통째로 죽어 있었다(2026-09-01 사고).
     같은 경로를 따라가면 양쪽이 ID 없이도 저절로 같은 폴더를 본다. */
  try {
    var parents = DriveApp.getFileById(_CS_MAIN_SHEET_ID).getParents();
    while (parents.hasNext()) ids.push(parents.next().getId());
  } catch (eMp) {}

  var subs = [], bases = [], seen = {};
  for (var f = 0; f < ids.length; f++) {
    var id = String(ids[f] || "").trim();
    if (!id || seen[id]) continue;
    var base = null;
    try {
      base = DriveApp.getFolderById(id);
    } catch (eF) {
      // 조용히 넘기면 안 된다. 전부 실패해도 "파일 없음"으로만 보여서
      // 폴백이 죽은 걸 아무도 모른 채 지나갔다(2026-09-01 사고).
      _CS_DAILY_FOLDER_ERRORS_.push(id + " · " + eF.message);
      continue;
    }
    seen[id] = true;
    bases.push(base);

    try {
      var it = base.getFoldersByName(_CS_DAILY_SUBFOLDER_);
      while (it.hasNext()) {
        var sub = it.next();
        var trashed = false;
        try { trashed = sub.isTrashed(); } catch (eT) { trashed = false; }
        if (trashed) continue;
        var sid = sub.getId();
        if (seen[sid]) continue;
        seen[sid] = true;
        subs.push(sub);
      }
    } catch (eS) {}
  }

  _CS_DAILY_FOLDER_CACHE_ = subs.concat(bases);
  return _CS_DAILY_FOLDER_CACHE_;
}

function _cs_findDailyFile_(dateStr) {
  var name = _CS_DAILY_PREFIX_ + "(" + dateStr + ")";

  var folders = _cs_dailyFolders_();
  for (var f = 0; f < folders.length; f++) {
    try {
      var it = folders[f].getFilesByName(name);
      if (it.hasNext()) return it.next();
    } catch (eF) {}
  }

  // 폴더를 못 찾아도 이름으로 한 번 더 — 위치가 바뀌어도 검색이 죽지 않게
  try {
    var glob = DriveApp.getFilesByName(name);
    if (glob.hasNext()) return glob.next();
  } catch (eG) {}

  return null;
}

function _cs_loadHubRecent_(fromDate, toDate, refresh, cacheOnly) {
  var cache = CacheService.getScriptCache();
  var key = _CS_DA_CACHE_VER_ + "_hub_" + fromDate + "_" + toDate;
  if (!refresh) {
    try {
      var hit = cache.get(key);
      if (hit) {
        var parsed = JSON.parse(hit);
        return parsed.rows || [];
      }
    } catch (eC) {}
  }

  // cacheOnly 는 일일마감 14파일 Drive 오픈을 건너뛰는 용도다.
  // 허브는 통합조회와 같은 파일이고, 당일 건은 야간 통합조회에 없다.
  // 여기를 건너뛰면 오전 검색이 빠진다.

  var ss = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID);
  var hub = ss.getSheetByName("협력업체_발주허브");
  if (!hub || hub.getLastRow() < 2) return [];

  var data = hub.getRange(2, 1, hub.getLastRow() - 1, 15).getDisplayValues();
  var fromN = fromDate.replace(/-/g, "");
  var toN = toDate.replace(/-/g, "");
  var rows = [];
  var seen = {};

  for (var i = 0; i < data.length; i++) {
    var orderDate = _cs_normYmd_(data[i][3]);
    if (orderDate) {
      var n = orderDate.replace(/-/g, "");
      if (n < fromN || n > toN) continue;
    }
    var rec = {
      date: orderDate || toDate,
      invoice: String(data[i][13] || "").trim(),
      invDigits: _cs_allInvDigits_(data[i][13]),
      phone: _cs_phoneDisplay_(data[i][8]),
      phoneDigits: _cs_phoneDigits_(data[i][8]),
      name: _cs_nameOnly_(data[i][7]),
      item: String(data[i][5] || "").trim(),
      ecountCode: _cs_readEcountCodeCell_(data[i][4]),
      qty: String(data[i][6] || "").trim(),
      addr: String(data[i][9] || "").trim(),
      shipMsg: _cs_sanitizeShipMsg_(String(data[i][10] || "").trim(), String(data[i][9] || "").trim()),
      source: "허브",
      orderNo: String(data[i][2] || "").trim() || _cs_orderNoFromName_(data[i][7]),
      vendor: String(data[i][1] || "").trim(),
      status: String(data[i][14] || "").trim()
    };
    _cs_enrichNameOrder_(rec);
    _cs_enrichEcountCode_(rec, true);
    if (_cs_isEmptyRecord_(rec)) continue;
    var dedupe = rec.invDigits + "|" + rec.phoneDigits + "|" + rec.name + "|" + rec.item + "|" + rec.date;
    if (seen[dedupe]) continue;
    seen[dedupe] = true;
    rec.origin = "hub";
    _cs_enrichCarrier_(rec);
    rows.push(rec);
  }

  try {
    cache.put(key, JSON.stringify({ rows: rows }), _CS_DA_CACHE_TTL_);
  } catch (ePut) {}
  return rows;
}

/**
 * 대리공급_임시기록 — 일일마감 전에 들어온 대리공급 송장/전화주문도 CS에서 보이게
 * C=일자, E=품목명, G=수량, H/I=전화, J=주소, M=수취인, P=주문번호, W=업체, X=송장
 */
function _cs_loadTempRecent_(fromDate, toDate, refresh, cacheOnly) {
  var cache = CacheService.getScriptCache();
  var key = _CS_DA_CACHE_VER_ + "_temp_" + fromDate + "_" + toDate;
  if (!refresh) {
    try {
      var hit = cache.get(key);
      if (hit) {
        var parsed = JSON.parse(hit);
        return parsed.rows || [];
      }
    } catch (eC) {}
  }

  // 허브와 같이 cacheOnly 여도 읽는다. 당일 대리공급 건이 빠지면 검색이 안 된다.

  var ss = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID);
  var tab = ss.getSheetByName("대리공급_임시기록");
  if (!tab || tab.getLastRow() < 2) return [];

  var lc = Math.max(tab.getLastColumn(), 24);
  var data = tab.getRange(2, 1, tab.getLastRow() - 1, lc).getDisplayValues();
  var fromN = fromDate.replace(/-/g, "");
  var toN = toDate.replace(/-/g, "");
  var rows = [];
  var seen = {};

  for (var i = 0; i < data.length; i++) {
    var orderDate = _cs_normYmd_(data[i][2]);
    if (orderDate) {
      var n = orderDate.replace(/-/g, "");
      if (n < fromN || n > toN) continue;
    }
    var rec = {
      date: orderDate || toDate,
      invoice: String(data[i][23] || "").trim(),
      invDigits: _cs_allInvDigits_(data[i][23]),
      phone: _cs_phoneDisplay_(data[i][7] || data[i][8]),
      phoneDigits: _cs_phoneDigits_(data[i][7] || data[i][8]),
      name: _cs_nameOnly_(data[i][12]),
      item: String(data[i][4] || "").trim(),
      ecountCode: _cs_readEcountCodeCell_(data[i][3]),
      qty: String(data[i][6] || "").trim(),
      addr: String(data[i][9] || "").trim(),
      source: "대리공급",
      orderNo: String(data[i][15] || "").trim(),
      vendor: String(data[i][22] || "").trim(),
      status: String(data[i][0] || "").trim()
    };
    _cs_enrichNameOrder_(rec);
    _cs_enrichEcountCode_(rec, true);
    if (_cs_isEmptyRecord_(rec)) continue;
    var dedupe = rec.invDigits + "|" + rec.phoneDigits + "|" + rec.name + "|" + rec.item + "|" + rec.date;
    if (seen[dedupe]) continue;
    seen[dedupe] = true;
    rec.origin = "temp";
    _cs_enrichCarrier_(rec);
    rows.push(rec);
  }

  var archTab = ss.getSheetByName("대리공급_임시기록_보관");
  if (archTab && archTab.getLastRow() >= 2) {
    var aLc = Math.max(archTab.getLastColumn(), 26);
    var aData = archTab.getRange(2, 1, archTab.getLastRow() - 1, aLc).getDisplayValues();
    var off = 2;
    for (var ai = 0; ai < aData.length; ai++) {
      var orderDateA = _cs_normYmd_(aData[ai][2 + off]);
      if (orderDateA) {
        var nA = orderDateA.replace(/-/g, "");
        if (nA < fromN || nA > toN) continue;
      }
      var recA = {
        date: orderDateA || toDate,
        invoice: String(aData[ai][23 + off] || "").trim(),
        invDigits: _cs_allInvDigits_(aData[ai][23 + off]),
        phone: _cs_phoneDisplay_(aData[ai][7 + off] || aData[ai][8 + off]),
        phoneDigits: _cs_phoneDigits_(aData[ai][7 + off] || aData[ai][8 + off]),
        name: _cs_nameOnly_(aData[ai][12 + off]),
        item: String(aData[ai][4 + off] || "").trim(),
        ecountCode: _cs_readEcountCodeCell_(aData[ai][3 + off]),
        qty: String(aData[ai][6 + off] || "").trim(),
        addr: String(aData[ai][9 + off] || "").trim(),
        source: "대리공급(보관)",
        orderNo: String(aData[ai][15 + off] || "").trim(),
        vendor: String(aData[ai][22 + off] || "").trim(),
        status: String(aData[ai][0 + off] || "").trim()
      };
      _cs_enrichNameOrder_(recA);
      _cs_enrichEcountCode_(recA, true);
      if (_cs_isEmptyRecord_(recA)) continue;
      var dedupeA = recA.invDigits + "|" + recA.phoneDigits + "|" + recA.name + "|" + recA.item + "|" + recA.date;
      if (seen[dedupeA]) continue;
      seen[dedupeA] = true;
      recA.origin = "temp_archive";
      _cs_enrichCarrier_(recA);
      rows.push(recA);
    }
  }

  try {
    cache.put(key, JSON.stringify({ rows: rows }), _CS_DA_CACHE_TTL_);
  } catch (ePut) {}
  return rows;
}

// ══════════════════════════════════════════════
//  택배사 SSOT: 상품정보「사방넷_송장대량등록」
//  A=주문번호 B=송장번호 E=택배사코드 (001 CJ / 002 롯데 / 007 로젠 / 037 대신)
// ══════════════════════════════════════════════

var _CS_SABANG_BULK_TAB_ = "사방넷_송장대량등록";
var _cs_sabangBulkIndexMem_ = null;

/** 사방넷 택배사코드 → 표시명. 한진 코드는 사방넷 계정값 확인 후 추가한다. */
function _cs_courierCodeLabel_(code) {
  var c = String(code || "").trim();
  if (c === "001") return "CJ대한통운";
  if (c === "002") return "롯데택배";
  if (c === "007") return "로젠택배";
  if (c === "037") return "대신택배";
  return "";
}

/** 사방넷_송장대량등록 → { byInv: {digits: label}, byOrder: {orderNo: label} } */
function _cs_loadSabangBulkIndex_(refresh) {
  if (refresh) _cs_sabangBulkIndexMem_ = null;
  if (!refresh && _cs_sabangBulkIndexMem_) return _cs_sabangBulkIndexMem_;
  var cache = CacheService.getScriptCache();
  var key = _CS_DA_CACHE_VER_ + "_sabang_bulk";
  if (!refresh) {
    try {
      var hit = cache.get(key);
      if (hit) {
        _cs_sabangBulkIndexMem_ = JSON.parse(hit);
        return _cs_sabangBulkIndexMem_;
      }
    } catch (eC) {}
  }

  var index = { byInv: {}, byOrder: {} };
  try {
    var ss = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID);
    var tab = ss.getSheetByName(_CS_SABANG_BULK_TAB_);
    if (tab && tab.getLastRow() >= 2) {
      var lr = tab.getLastRow();
      var data = tab.getRange(2, 1, lr - 1, 5).getDisplayValues();
      for (var i = 0; i < data.length; i++) {
        var orderNo = String(data[i][0] || "").trim();
        var invRaw = String(data[i][1] || "").trim();
        var label = _cs_courierCodeLabel_(data[i][4]);
        if (!label) continue;
        if (orderNo) index.byOrder[orderNo] = label;
        var invParts = invRaw.split(/[\r\n,;]+/);
        for (var p = 0; p < invParts.length; p++) {
          var chunk = String(invParts[p] || "").trim();
          if (!chunk) continue;
          var digits = chunk.replace(/[^0-9]/g, "");
          if (digits.length >= 8) index.byInv[digits] = label;
        }
      }
    }
  } catch (eLoad) {
    Logger.log("[CS_SABANG_BULK] load error: " + eLoad.message);
  }

  _cs_sabangBulkIndexMem_ = index;
  try {
    cache.put(key, JSON.stringify(index), _CS_DA_CACHE_TTL_);
  } catch (ePut) {}
  return index;
}

function _cs_lookupCarrierFromSabangBulk_(rec, index) {
  if (!rec || !index) return "";
  var orderNo = String(rec.orderNo || "").trim();
  if (orderNo && index.byOrder && index.byOrder[orderNo]) {
    return index.byOrder[orderNo];
  }
  var invRaw = String(rec.invDigits || rec.invoice || "").trim();
  if (!invRaw || !index.byInv) return "";
  var parts = invRaw.split(/\s+/);
  for (var i = 0; i < parts.length; i++) {
    var d = String(parts[i] || "").replace(/[^0-9]/g, "");
    if (d.length >= 8 && index.byInv[d]) return index.byInv[d];
  }
  var all = invRaw.replace(/[^0-9]/g, "");
  if (all.length >= 8 && index.byInv[all]) return index.byInv[all];
  return "";
}

function _cs_isProxySupplierRecord_(rec) {
  var src = String(rec && rec.source || "");
  if (src.indexOf("대리") >= 0) return true;
  var origin = String(rec && rec.origin || "");
  return origin === "temp" || origin === "temp_archive";
}

function _cs_carrierFromSource_(src) {
  src = String(src || "");
  if (src.indexOf("로젠") >= 0) return "로젠택배";
  if (src.indexOf("CJ") >= 0 || src.indexOf("대한통운") >= 0) return "CJ대한통운";
  if (src.indexOf("한진") >= 0) return "한진택배";
  if (src.indexOf("대신") >= 0) return "대신택배";
  if (src.indexOf("우체국") >= 0) return "우체국";
  if (src.indexOf("경동") >= 0) return "경동택배";
  if (src.indexOf("롯데") >= 0) return "롯데택배";

  /*  ★ 「합포장」·「1주출고」는 택배사가 아니다 ★  (2026-09-16)

      > "CS 웹앱 반품카드에서 수거택배사가 현재 롯데로 되있는데 로젠으로 바꿔줘"

      여기엔 이 둘을 롯데로 치는 줄이 있었다. 2026-09-11 에 자사출고가
      로젠으로 바뀐 뒤로 그 줄들은 계속 롯데로 찍혔다 — 반품 카드의
      수거택배사가 롯데로 나온 까닭이다.

      둘은 «어느 탭에서 걷었나»가 아니라 «어떻게 묶였나»를 말하는 이름표다.
      동봉 줄은 대표의 송장을 물려받고, 그 대표는 택배사 탭에서 걷힌다 —
      택배사는 거기서 온다. 여기서 지어내면 갈아탈 때마다 같은 사고가 난다.

      ★ 허브는 9/15 에 이미 고쳤다 ★
        _partnerExclusivePush.gs 의 _pep_carrierFromSource_ 가 같은 줄을
        갖고 있었고 그날 지웠다. CS 는 별도 프로젝트라 안 따라왔다.
        한 군데를 고치면 같은 일을 하는 다른 군데도 봐야 한다.

      모르면 빈칸이다. 틀린 택배사는 빈칸보다 나쁘다 —
      조회 링크가 엉뚱한 데로 가고, 회수 접수가 엉뚱한 곳으로 나간다.  */
  return "";
  return "";
}

// ══════════════════════════════════════════════
//  업체 택배사 SSOT: 상품정보「업체_택배사」탭
//  메인 프로젝트와 같은 표를 읽는다 (CS는 별도 프로젝트라 코드 공유 불가)
//  A=접두 B=업체명 C=택배사 D=사방넷코드
// ══════════════════════════════════════════════

var _CS_VENDOR_CARRIER_TAB_ = "업체_택배사";
var _cs_vendorCarrierMem_ = null;

/** { byPfx: {접두: 택배사}, byLabel: {업체명: 택배사} } */
function _cs_loadVendorCarrierIndex_(refresh) {
  if (refresh) _cs_vendorCarrierMem_ = null;
  if (!refresh && _cs_vendorCarrierMem_) return _cs_vendorCarrierMem_;

  var cache = CacheService.getScriptCache();
  var key = _CS_DA_CACHE_VER_ + "_vendor_carrier";
  if (!refresh) {
    try {
      var hit = cache.get(key);
      if (hit) {
        _cs_vendorCarrierMem_ = JSON.parse(hit);
        return _cs_vendorCarrierMem_;
      }
    } catch (eC) {}
  }

  var index = { byPfx: {}, byLabel: {} };
  try {
    var ss = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID);
    var tab = ss.getSheetByName(_CS_VENDOR_CARRIER_TAB_);
    if (tab && tab.getLastRow() >= 2) {
      var data = tab.getRange(2, 1, tab.getLastRow() - 1, 3).getDisplayValues();
      for (var i = 0; i < data.length; i++) {
        var pfx = String(data[i][0] || "").trim().toUpperCase();
        var label = String(data[i][1] || "").replace(/\s/g, "");
        var carrier = String(data[i][2] || "").trim();
        if (!carrier) continue;
        if (pfx) index.byPfx[pfx] = carrier;
        if (label) index.byLabel[label] = carrier;
      }
    }
  } catch (eLoad) {
    Logger.log("[CS_VENDOR_CARRIER] load error: " + eLoad.message);
  }

  _cs_vendorCarrierMem_ = index;
  try {
    cache.put(key, JSON.stringify(index), _CS_DA_CACHE_TTL_);
  } catch (ePut) {}
  return index;
}

// ─────────────────────────────────────────────────────
//  보조 접두 별칭 — 한 업체가 이카운트코드 접두를 2개 이상 쓰는 경우
//
//  ★ 원본(SSOT)은 허브 `_partnerExclusivePush.gs` 의 `_PEP_VENDOR_PREFIX_ALIAS_` 다.
//    CS앱은 별도 Apps Script 프로젝트라 그 상수를 참조할 수 없어 복제해 둔다.
//    **한쪽만 고치면 CS앱이 조용히 그 업체를 못 찾는다.** 항상 쌍으로 확인한다.
//
//  `업체_택배사` 표에는 **대표 접두 행만** 둔다. 보조 접두는 여기서 환산된다.
// ─────────────────────────────────────────────────────
var _CS_VENDOR_PREFIX_ALIAS_ = {
  JH: "JT", // 준테크 보조 코드
  BF: "JT", // 준테크 보조 코드
  NS: "JT", // 준테크 보조 코드 (★ 2026-08-27)
};

/** 보조 접두 → 대표 접두. 별칭이 없으면 대문자 정규화만 */
function _cs_resolvePrefixAlias_(pfx) {
  var up = String(pfx == null ? "" : pfx).trim().toUpperCase();
  if (!up) return "";
  return _CS_VENDOR_PREFIX_ALIAS_[up] || up;
}

/** 업체명(또는 접두) → 택배사 */
function _cs_carrierFromVendor_(vendor, index) {
  var raw = String(vendor == null ? "" : vendor).trim();
  if (!raw) return "";
  var idx = index || _cs_loadVendorCarrierIndex_(false);
  var compact = raw.replace(/\s/g, "").replace(/\[협력업체\]/g, "");
  if (!compact) return "";

  var upper = compact.toUpperCase();
  if (idx.byPfx[upper]) return idx.byPfx[upper];
  var aliased = _cs_resolvePrefixAlias_(upper);
  if (aliased !== upper && idx.byPfx[aliased]) return idx.byPfx[aliased];
  if (upper.length >= 2 && !/[가-힣]/.test(compact)) {
    // 이카운트코드형(OC1234)에서 접두만 뽑는 경우 — 보조 접두(NS→JT)도 환산
    var two = upper.substring(0, 2);
    if (idx.byPfx[two]) return idx.byPfx[two];
    var twoAliased = _cs_resolvePrefixAlias_(two);
    if (twoAliased !== two && idx.byPfx[twoAliased]) return idx.byPfx[twoAliased];
  }
  for (var lbl in idx.byLabel) {
    if (idx.byLabel.hasOwnProperty(lbl) && compact.indexOf(lbl) !== -1) {
      return idx.byLabel[lbl];
    }
  }
  return "";
}

/**
 * 검색 결과 carrier — 통합조회 M열 → 출처 문자열 → 업체_택배사 표 → 사방넷_송장대량등록
 * ★ 2026-08-26: 통합조회 M열은 업체 택배사까지 반영된 값이므로 덮어쓰지 않는다.
 *   전용양식 업체(부엉이커피 등)는 출처에 택배사가 없어 예전엔 사방넷 코드로 잘못 표시됐다.
 * ★ 2026-08-27: 일일마감에도 택배사 열이 생겼다(운송장번호 앞). 그 값도 기록된
 *   사실이므로 여기서 덮지 않는다. 허브를 직접 읽는 경로만 업체 표로 채운다.
 */
function _cs_enrichCarrier_(rec, bulkIndex) {
  if (!rec) return;
  if (String(rec.carrier || "").trim()) return;
  var fromSrc = _cs_carrierFromSource_(rec.source);
  if (fromSrc) {
    rec.carrier = fromSrc;
    return;
  }
  var fromVendor = _cs_carrierFromVendor_(rec.vendor);
  if (fromVendor) {
    rec.carrier = fromVendor;
    return;
  }
  var idx = bulkIndex || _cs_loadSabangBulkIndex_(false);
  var fromBulk = _cs_lookupCarrierFromSabangBulk_(rec, idx);
  if (fromBulk) rec.carrier = fromBulk;
}

// ══════════════════════════════════════════════
//  행 매핑 / 검색
// ══════════════════════════════════════════════

function _cs_mapArchiveHeaders_(hdr) {
  var m = {
    inv: -1, phones: [], name: -1, code: -1, item: -1, qty: -1,
    addr: -1, addr2: -1, shipMsg: -1, src: -1, oid: -1, vendor: -1, date: -1,
    carrier: -1
  };

  // 운영 일일마감 실제 양식: A=품목코드, B=품목명, … P=운송장번호
  if (_cs_isDirectDailyArchiveHeader_(hdr)) {
    return _cs_mapDirectDailyHeaders_(hdr);
  }

  // 판매현황 C~Q 스냅샷 + 운송장번호 + 출처 (레거시)
  if (_cs_isSnapshotDailyArchiveHeader_(hdr)) {
    return _cs_mapSnapshotDailyHeaders_(hdr);
  }

  // 통합 일일마감 고정 레이아웃 (출처·주소·배송메시지 열 위치 SSOT)
  if (_cs_isUnifiedArchiveHeader_(hdr)) {
    m.src = 0;
    m.oid = 2;
    m.inv = 3;
    m.name = 4;
    m.phones = [5, 6];
    m.addr = 7;
    m.code = 8;
    m.item = 9;
    m.qty = 10;
    m.shipMsg = 11;
    m.vendor = 15;
    return m;
  }

  var addrFallback = -1;
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (m.inv < 0 && /운송장번호|송장번호/.test(h) && !/반품/.test(h)) m.inv = i;
    if (/전화|휴대폰|핸드폰|연락처/.test(h) && !/보내는|송하인/.test(h)) m.phones.push(i);
    if (m.name < 0 && /주문자명\(사방넷\)|주문자명/.test(h)) m.name = i;
    else if (m.name < 0 && /수하인|수취인|받는사람|받는분|고객명/.test(h) && !/주소|전화|번호/.test(h)) m.name = i;
    else if (m.name < 0 && h === "거래처명") m.vendor = i;
    if (m.item < 0 && /품목명|상품명|물품명/.test(h) && !/코드/.test(h)) m.item = i;
    if (m.code < 0 && /이카운트코드|품목코드|물품코드|PROD_CD|상품코드/.test(h)) m.code = i;
    if (m.qty < 0 && (h === "수량" || /수량/.test(h)) && !/합계|박스/.test(h)) m.qty = i;
    if (m.src < 0 && h === "출처") m.src = i;
    if (m.oid < 0 && /주문번호|사방넷|고유ID|고유Id/.test(h)) m.oid = i;
    if (m.vendor < 0 && h !== "거래처명" && /발주업체|거래처|업체명|주문지|판매처/.test(h)) m.vendor = i;
    if (m.date < 0 && /주문일자|발송일|매출일/.test(h)) m.date = i;
    if (m.shipMsg < 0 && _cs_isShipMsgHeader_(h)) m.shipMsg = i;
    // 일일마감이 기록한 택배사. "택배박스" 부분일치를 배제하려고 완전일치만 본다
    if (m.carrier < 0 && /^택배사$|^배송사$|^운송사$/.test(h)) m.carrier = i;

    var isSenderAddr = /보내는|송하인/.test(h);
    if (isSenderAddr) continue;
    if (m.addr < 0 && /수하인주소|수취인주소|배송지주소|받는분총주소|받는분주소/.test(h)) m.addr = i;
    else if (m.addr < 0 && (h === "주소1" || h === "주소")) m.addr = i;
    else if (h === "주소2" || /주소2/.test(h)) m.addr2 = i;
    else if (addrFallback < 0 && /주소/.test(h) && !/배송메시지|배송메세지|배송비|운임/.test(h)) addrFallback = i;
  }
  if (m.addr < 0) m.addr = addrFallback;
  // 판매현황 C~Q: J열 주소1 = index 7
  if (m.addr < 0 && hdr.length > 7) m.addr = 7;
  if (m.inv < 0 && hdr.length >= 2) m.inv = hdr.length - 2;
  if (m.src < 0 && hdr.length >= 1) m.src = hdr.length - 1;
  if (m.phones.indexOf(13) === -1 && hdr.length > 13) m.phones.push(13);
  return m;
}

/** 운영 일일마감 실제 양식: A=품목코드, B=품목명 (스크린샷 SSOT) */
function _cs_isDirectDailyArchiveHeader_(hdr) {
  if (!hdr || hdr.length < 8) return false;
  var h0 = String(hdr[0] || "").replace(/\s/g, "");
  var h1 = String(hdr[1] || "").replace(/\s/g, "");
  if (h0 === "품목코드" && h1 === "품목명") return true;
  if (/품목코드|이카운트코드|물품코드/.test(h0) && /품목명|상품명|물품명/.test(h1)) return true;
  return false;
}

function _cs_mapDirectDailyHeaders_(hdr) {
  var m = {
    code: 0, item: 1, qty: 2,
    inv: -1, src: -1, phones: [], name: -1,
    addr: -1, addr2: -1, shipMsg: -1, oid: -1, vendor: -1, date: -1,
    carrier: -1
  };
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (m.inv < 0 && /운송장번호|송장번호/.test(h) && !/반품/.test(h)) m.inv = i;
    if (m.src < 0 && h === "출처") m.src = i;
    if (m.carrier < 0 && /^택배사$|^배송사$|^운송사$/.test(h)) m.carrier = i;
    if (/전화번호\(사방넷\)/.test(h)) m.phones.unshift(i);
    else if (/^전화$|^모바일$|휴대폰|핸드폰/.test(h) && !/보내는|송하인/.test(h)) m.phones.push(i);
    if (/주문자명\(사방넷\)|주문자명/.test(h)) m.name = i;
    if (h === "거래처명") m.vendor = i;
    if (/주소\(사방넷\)/.test(h)) {
      m.addr = i;
      if (/배송메시지|배송메세지/.test(h)) m.shipMsg = i;
    } else if (m.addr < 0 && (h === "주소1" || h === "주소")) m.addr = i;
    if (m.shipMsg < 0 && _cs_isShipMsgHeader_(h)) m.shipMsg = i;
  }
  if (m.name >= 0) m.oid = m.name;
  return m;
}

/** 레거시: 판매현황 C~Q 스냅샷 + 맨 끝 운송장번호·출처 */
function _cs_isSnapshotDailyArchiveHeader_(hdr) {
  if (!hdr || hdr.length < 5) return false;
  var c0 = String(hdr[0] || "").replace(/\s/g, "");
  if (c0 === "출처") return false;
  var last = String(hdr[hdr.length - 1] || "").replace(/\s/g, "");
  var prev = String(hdr[hdr.length - 2] || "").replace(/\s/g, "");
  return last === "출처" && /운송장번호|송장번호/.test(prev);
}

/**
 * 스냅샷 일일마감 열 매핑 (판매현황 C~Q + [택배사] + 운송장번호 + 출처)
 *
 * ★ 2026-08-27: 택배사 열이 운송장번호 **앞**에 들어왔다. 그래서 아래 두 위치
 *   가정(끝에서 두 번째 = 운송장번호, 마지막 = 출처)은 그대로 성립한다.
 *   택배사는 헤더명으로 찾는다. 새 열을 맨 끝에 붙였다면 이 매핑이 한 칸씩
 *   틀어져 출처를 송장으로 읽었을 것이다.
 */
function _cs_mapSnapshotDailyHeaders_(hdr) {
  var m = {
    inv: hdr.length - 2,
    src: hdr.length - 1,
    phones: [], name: -1, code: -1, item: -1, qty: -1,
    addr: -1, addr2: -1, shipMsg: -1, oid: -1, vendor: -1, date: -1,
    carrier: -1
  };

  var addrFallback = -1;
  var dataEnd = hdr.length - 2;
  for (var i = 0; i < dataEnd; i++) {
    var h = String(hdr[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (/전화|휴대폰|핸드폰|연락처|모바일/.test(h) && !/보내는|송하인/.test(h)) m.phones.push(i);
    if (m.name < 0 && /주문자명\(사방넷\)|주문자명/.test(h)) m.name = i;
    else if (m.name < 0 && /수하인|수취인|받는사람|받는분|고객명/.test(h) && !/주소|전화|번호/.test(h)) m.name = i;
    else if (m.name < 0 && h === "거래처명") m.vendor = i;
    if (m.item < 0 && /품목명|상품명|물품명/.test(h) && !/코드/.test(h)) m.item = i;
    if (m.code < 0 && /이카운트코드|품목코드|물품코드|PROD_CD|상품코드/.test(h)) m.code = i;
    if (m.qty < 0 && (h === "수량" || /판매수량|주문수량/.test(h)) && !/합계|박스/.test(h)) m.qty = i;
    if (m.oid < 0 && /주문번호|사방넷|고유ID|고유Id|일자-No/.test(h)) m.oid = i;
    if (m.vendor < 0 && h !== "거래처명" && /발주업체|거래처|업체명|주문지|판매처/.test(h)) m.vendor = i;
    if (m.date < 0 && /주문일자|발송일|매출일/.test(h)) m.date = i;
    if (m.shipMsg < 0 && _cs_isShipMsgHeader_(h)) m.shipMsg = i;
    // 택배사 — "택배박스" 부분일치를 배제하려고 완전일치만 본다
    if (m.carrier < 0 && /^택배사$|^배송사$|^운송사$/.test(h)) m.carrier = i;

    var isSenderAddr = /보내는|송하인/.test(h);
    if (isSenderAddr) continue;
    if (m.addr < 0 && /수하인주소|수취인주소|배송지주소|받는분총주소|받는분주소/.test(h)) m.addr = i;
    else if (m.addr < 0 && (h === "주소1" || h === "주소")) m.addr = i;
    else if (h === "주소2" || /주소2/.test(h)) m.addr2 = i;
    else if (addrFallback < 0 && /주소/.test(h) && !/배송메시지|배송메세지|배송비|운임/.test(h)) addrFallback = i;
  }
  if (m.addr < 0) m.addr = addrFallback;

  // 판매현황 C~Q 고정: A=순번, B=일자-No., C=품목코드, D=품목명 (헤더명 기준 보조)
  var h0 = String(hdr[0] || "").replace(/\s/g, "");
  var h1 = String(hdr[1] || "").replace(/\s/g, "");
  var h2 = String(hdr[2] || "").replace(/\s/g, "");
  var h3 = String(hdr[3] || "").replace(/\s/g, "");
  if (h0 === "순번" && /품목코드|이카운트코드|물품코드/.test(h2)) {
    if (m.code < 0) m.code = 2;
    if (m.item < 0 && /품목명|상품명|물품명/.test(h3)) m.item = 3;
    if (m.oid < 0 && /일자-No/.test(h1)) m.oid = 1;
  } else if (/품목코드|이카운트코드|물품코드/.test(h0)) {
    if (m.code < 0) m.code = 0;
    if (m.item < 0 && /품목명|상품명|물품명/.test(h1)) m.item = 1;
  }

  return m;
}

/** 통합 일일마감 탭 1행 헤더 여부 */
function _cs_isUnifiedArchiveHeader_(hdr) {
  if (!hdr || hdr.length < 12) return false;
  var c0 = String(hdr[0] || "").replace(/\s/g, "");
  var c7 = String(hdr[7] || "").replace(/\s/g, "");
  var c11 = String(hdr[11] || "").replace(/\s/g, "");
  return c0 === "출처" && c7 === "주소" && /배송메시지|배송메세지/.test(c11);
}

/** 배송메시지 열 — 주소·적요 혼동 방지 */
function _cs_isShipMsgHeader_(h) {
  var x = String(h || "").replace(/\s/g, "");
  if (!x || /주소|우편|addr|zip|postal/i.test(x)) return false;
  if (/^배송메시지$|^배송메세지$|^배송요청$/.test(x)) return true;
  if (/^적요\(배송메시지\)$|^적요\(배송메세지\)$/.test(x)) return true;
  if (/배송메시지|배송메세지/.test(x) && !/주소|배송지/.test(x)) return true;
  return false;
}

function _cs_looksLikeAddress_(s) {
  var t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t || t.length < 10) return false;
  if (/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(t)) return true;
  if (/(특별시|광역시|특별자치시|특별자치도)/.test(t)) return true;
  if (/(시|군|구)\s+[\S]+(로|길|동|읍|면|리)\s*\d/.test(t)) return true;
  if (/\d+\s*(로|길|동)\s*\d*/.test(t) && /(시|군|구)/.test(t)) return true;
  return false;
}

/** 주소가 배송메시지 칸에 들어온 경우 제거 */
function _cs_sanitizeShipMsg_(msg, addr) {
  var m = String(msg || "").replace(/\s+/g, " ").trim();
  if (!m) return "";
  var a = String(addr || "").replace(/\s+/g, " ").trim();
  if (a) {
    if (m === a) return "";
    if (m.length >= 8 && (m.indexOf(a) !== -1 || a.indexOf(m) !== -1)) return "";
  }
  if (_cs_looksLikeAddress_(m)) return "";
  return m;
}

/** 품목코드 셀 — 첫 토큰만 (품목명 숫자가 코드에 붙는 것 방지) */
function _cs_extractCodeToken_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (/^[\uAC00-\uD7AF]/.test(s)) return "";
  var tok = s.split(/[\s\t\r\n]+/)[0];
  if (!tok || /[\uAC00-\uD7AF]/.test(tok)) return "";
  return tok;
}

function _cs_normEcountCode_(v) {
  var s = String(v == null ? "" : v).trim().toUpperCase();
  if (!s) return "";
  s = s.replace(/[^A-Z0-9\-]/g, "");
  if (s.length < 3 || s.length > 32) return "";
  if (/^\d+$/.test(s)) return "";
  if (!/[A-Z]/.test(s.replace(/-/g, ""))) return "";
  return s.replace(/-/g, "");
}

/** 셀 원값 → 이카운트코드 (첫 토큰만) */
function _cs_readEcountCodeCell_(raw) {
  var tok = _cs_extractCodeToken_(raw);
  if (!tok) return "";
  return _cs_normEcountCode_(tok);
}

function _cs_looksLikeEcountCode_(v) {
  var raw = String(v == null ? "" : v).trim();
  if (!raw || raw.length < 3) return false;
  if (/^[\uAC00-\uD7AF]/.test(raw)) return false;
  if (raw.indexOf("/") >= 0 && /[\uAC00-\uD7AF]/.test(raw)) return false;
  if (/^\d+$/.test(raw)) return false;
  if (/^\d{4}[-/.]?\d/.test(raw)) return false;
  var s = raw.toUpperCase().replace(/\s/g, "");
  if (/^[A-Z0-9][A-Z0-9\-]{2,40}$/.test(s) && /[A-Z]/.test(s)) return true;
  return false;
}

/** 샘플 데이터로 품목코드 열 보정 — 헤더가 품목코드면 A열 고정 */
function _cs_refineCodeColFromData_(map, dataRows, hdr) {
  if (!map || !dataRows || !dataRows.length) return;
  if (map.code >= 0 && hdr && hdr.length > map.code) {
    var hc = String(hdr[map.code] || "").replace(/\s/g, "");
    if (/품목코드|이카운트코드|물품코드|PROD_CD|상품코드/.test(hc)) return;
  }
  var end = map.inv >= 0 ? map.inv : (dataRows[0] ? dataRows[0].length - 2 : 0);
  if (end <= 0) return;

  var scores = {};
  var scanMax = Math.min(dataRows.length, 25);
  for (var r = 0; r < scanMax; r++) {
    var row = dataRows[r];
    if (!row) continue;
    for (var c = 0; c < Math.min(end, row.length); c++) {
      if (_cs_looksLikeEcountCode_(row[c])) scores[c] = (scores[c] || 0) + 1;
    }
  }

  var best = -1, bestScore = 0;
  for (var k in scores) {
    if (scores[k] > bestScore) { bestScore = scores[k]; best = parseInt(k, 10); }
  }
  if (best < 0 || bestScore < 2) return;
  if (map.code < 0) map.code = best;
}

function _cs_guessEcountCodeFromItem_(item) {
  var s = String(item || "").trim();
  if (!s || /[\uAC00-\uD7AF]/.test(s)) return "";
  var m = s.match(/^([A-Za-z]{2}\d{3,10})\b/);
  return m ? _cs_normEcountCode_(m[1]) : "";
}

var _CS_DB_CODE_ENRICH_MAX_ = 80;

function _cs_enrichEcountCode_(rec, hadCodeCol) {
  if (rec.ecountCode) return;
  if (!hadCodeCol) {
    rec.ecountCode = _cs_guessEcountCodeFromItem_(rec.item);
  }
  if (!rec.ecountCode && rec.item) {
    rec.ecountCode = _cs_resolveCodeFromDbByItem_(rec.item);
    if (rec.ecountCode) rec.codeSource = "db_item";
  }
}

function _cs_rowFromArchive_(dateStr, row, map) {
  var nameRaw = map.name >= 0 ? row[map.name] : "";
  var invRaw = map.inv >= 0 ? row[map.inv] : "";
  var src = map.src >= 0 ? String(row[map.src] || "").trim() : "";
  var phoneRaw = "";
  for (var p = 0; p < map.phones.length; p++) {
    var pv = String(row[map.phones[p]] || "").trim();
    if (pv && /[0-9]/.test(pv)) { phoneRaw = pv; break; }
  }
  var rec = {
    date: dateStr,
    invoice: String(invRaw || "").replace(/\n/g, " ").trim(),
    invDigits: _cs_allInvDigits_(invRaw),
    phone: _cs_phoneDisplay_(phoneRaw),
    phoneDigits: _cs_phoneDigits_(phoneRaw),
    name: _cs_nameOnly_(nameRaw),
    item: map.item >= 0 ? String(row[map.item] || "").trim() : "",
    ecountCode: _cs_readEcountCodeCell_(map.code >= 0 ? row[map.code] : ""),
    qty: map.qty >= 0 ? String(row[map.qty] || "").trim() : "",
    addr: _cs_joinAddr_(
      map.addr >= 0 ? row[map.addr] : "",
      map.addr2 >= 0 ? row[map.addr2] : ""
    ),
    shipMsg: _cs_sanitizeShipMsg_(
      map.shipMsg >= 0 ? String(row[map.shipMsg] || "").trim() : "",
      _cs_joinAddr_(
        map.addr >= 0 ? row[map.addr] : "",
        map.addr2 >= 0 ? row[map.addr2] : ""
      )
    ),
    source: src,
    orderNo: map.oid >= 0 ? String(row[map.oid] || "").trim() : _cs_orderNoFromName_(nameRaw),
    vendor: map.vendor >= 0 ? String(row[map.vendor] || "").trim() : "",
    // 일일마감이 확정해 적어 둔 택배사. 비어 있으면 아래 _cs_enrichCarrier_ 가 추론한다.
    carrier: map.carrier >= 0 ? String(row[map.carrier] || "").trim() : "",
    status: "",
    origin: "daily"
  };
  if (_cs_isEmptyRecord_(rec)) return null;
  if (/합계/.test(rec.item) && !rec.invDigits && !rec.phoneDigits && !rec.name) return null;
  _cs_enrichNameOrder_(rec);
  _cs_enrichEcountCode_(rec, map.code >= 0);
  _cs_enrichCarrier_(rec);
  return rec;
}

function _cs_isEmptyRecord_(rec) {
  if (rec.name || rec.invDigits || rec.phoneDigits || rec.item) return false;
  return true;
}

function _cs_joinAddr_(a, b) {
  var s1 = String(a == null ? "" : a).replace(/\s+/g, " ").trim();
  var s2 = String(b == null ? "" : b).replace(/\s+/g, " ").trim();
  if (s1 && s2 && s1.indexOf(s2) === -1) return s1 + " " + s2;
  return s1 || s2;
}

/**
 * 이름 비교 키. 매칭 파이프라인의 _pep_normRecipName_ 과 같은 규칙이다:
 * '/' 앞부분만 사용, 공백 전부 제거, 끝의 '님' 제거.
 * 두 시스템이 같은 규칙을 써야 "매칭은 됐는데 CS 검색으로는 안 잡힌다"가 사라진다.
 * (CS는 별도 Apps Script 프로젝트라 코드를 공유할 수 없어 규칙을 복제한다.
 *  한쪽을 바꾸면 반드시 다른 쪽도 바꿀 것.)
 */
function _cs_nameKey_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (/[\/|／]/.test(s)) s = s.split(/[\/|／]/)[0].trim();
  return s.replace(/\s+/g, "").replace(/님$/, "").toLowerCase();
}

function _cs_nameMatch_(name, query) {
  if (!name || !query) return false;
  if (String(name).toLowerCase().indexOf(String(query).toLowerCase()) !== -1) return true;
  var k = _cs_nameKey_(name);
  var qk = _cs_nameKey_(query);
  return !!(k && qk && k.indexOf(qk) !== -1);
}

/** 주문번호 칸의 `이름/고유ID` 또는 고유ID 자체 */
function _cs_rowUid_(r) {
  var o = String((r && r.orderNo) || "").trim();
  var after = _cs_orderNoFromName_(o);
  if (after) return after;
  return o;
}

/** 송장 끝자리. 칸에 송장이 여러 장이면 각 장을 따로 본다. */
function _cs_invSuffixMatch_(invDigits, qDigits) {
  if (!invDigits || !qDigits || qDigits.length < 4) return false;
  var parts = String(invDigits).split(/\s+/);
  for (var i = 0; i < parts.length; i++) {
    var d = String(parts[i] || "").replace(/[^0-9]/g, "");
    if (d.length >= qDigits.length && d.slice(-qDigits.length) === qDigits) return true;
  }
  return false;
}

/**
 * 검색어 한 토큰. 화면 filterLocal 과 규칙을 맞춘다.
 * 띄어쓴 검색은 토큰마다 이 점수가 나고, 하나라도 0이면 행을 버린다(AND).
 */
function _cs_scoreSearchToken_(r, token) {
  var q = String(token || "").trim();
  var why = [];
  var score = 0;
  if (!q) return { score: 0, why: why };
  var qLower = q.toLowerCase();
  var looksNum = /^[0-9+\-.\s()]+$/.test(q);
  var qDigits = looksNum ? q.replace(/[^0-9]/g, "") : "";
  var qPhone = looksNum ? _cs_phoneDigits_(q) : "";
  var pd = r.phoneDigits || "";
  var id = r.invDigits || "";
  var uid = _cs_rowUid_(r);

  if (qPhone && pd) {
    if (pd === qPhone) { score += 100; why.push("전화일치"); }
    else if (pd.indexOf(qPhone) !== -1) { score += 80; why.push("전화포함"); }
    else if (qDigits.length === 4 && pd.slice(-4) === qDigits) { score += 70; why.push("끝4자리"); }
    else if (qDigits.length >= 4 && pd.slice(-qDigits.length) === qDigits) { score += 60; why.push("전화끝자리"); }
  } else if (qDigits.length === 4 && pd && pd.slice(-4) === qDigits) {
    score += 70; why.push("끝4자리");
  }

  if (qDigits.length >= 8 && id && id.indexOf(qDigits) !== -1) {
    score += (id.indexOf(qDigits) === 0 || id.split(" ").indexOf(qDigits) >= 0) ? 95 : 75;
    why.push("송장");
  } else if (qDigits.length >= 4 && qDigits.length <= 7 && _cs_invSuffixMatch_(id, qDigits)) {
    score += qDigits.length >= 6 ? 65 : 40;
    why.push(qDigits.length >= 6 ? "송장끝자리" : "송장끝4");
  }

  if (qDigits.length >= 4 && uid) {
    var uidDigits = String(uid).replace(/[^0-9]/g, "");
    if (uidDigits && (uidDigits === qDigits || uidDigits.indexOf(qDigits) !== -1)) {
      score += 55; why.push("고유ID");
    }
  }

  if (qLower.length >= 2) {
    if (_cs_nameMatch_(r.name, q)) { score += 50; why.push("이름"); }
    if (r.item && r.item.toLowerCase().indexOf(qLower) !== -1) { score += 35; why.push("품목"); }
    if (r.orderNo && String(r.orderNo).toLowerCase().indexOf(qLower) !== -1) { score += 55; why.push("주문번호"); }
    else if (uid && String(uid).toLowerCase().indexOf(qLower) !== -1) { score += 55; why.push("고유ID"); }
    if (r.ecountCode) {
      var code = String(r.ecountCode).replace(/[-\s]/g, "").toLowerCase();
      var qCode = qLower.replace(/[-\s]/g, "");
      if (code && qCode.length >= 3 && code.indexOf(qCode) !== -1) { score += 45; why.push("품목코드"); }
    }
    if (r.vendor && r.vendor.toLowerCase().indexOf(qLower) !== -1) { score += 20; why.push("업체"); }
    if (r.addr && r.addr.toLowerCase().indexOf(qLower) !== -1) { score += 15; why.push("주소"); }
    if (r.shipMsg && r.shipMsg.toLowerCase().indexOf(qLower) !== -1) { score += 25; why.push("배송메시지"); }
  }

  return { score: score, why: why };
}

function _cs_scoreSearchRow_(r, query) {
  var q = String(query || "").trim();
  if (!q) return null;
  var tokens = q.split(/\s+/).filter(function (t) { return !!t; });
  var total = 0;
  var why = [];
  for (var t = 0; t < tokens.length; t++) {
    var tok = tokens[t];
    if (tok.length < 2 && !/[0-9]/.test(tok)) continue;
    var part = _cs_scoreSearchToken_(r, tok);
    if (part.score <= 0) return null;
    total += part.score;
    for (var w = 0; w < part.why.length; w++) why.push(part.why[w]);
  }
  if (total <= 0) return null;
  return { score: total, why: why };
}

function _cs_filterRows_(rows, query) {
  var scored = [];

  for (var i = 0; i < rows.length; i++) {
    var hit = _cs_scoreSearchRow_(rows[i], query);
    if (!hit) continue;
    scored.push({ score: hit.score, why: hit.why, row: rows[i] });
  }

  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.row.date).localeCompare(String(a.row.date));
  });

  var out = [];
  for (var s = 0; s < scored.length && out.length < _CS_SEARCH_LIMIT_; s++) {
    var row = scored[s].row;
    out.push({
      date: row.date,
      invoice: row.invoice,
      phone: row.phone,
      name: row.name,
      item: row.item,
      ecountCode: row.ecountCode || "",
      qty: row.qty,
      addr: row.addr,
      shipMsg: row.shipMsg || "",
      source: row.source,
      orderNo: row.orderNo,
      vendor: row.vendor,
      carrier: row.carrier || "",
      status: row.status || "",
      origin: row.origin || "daily",
      match: scored[s].why.join(" · "),
      invOverflow: !!row.invOverflow,
      invOverflowN: row.invOverflowN || 0
    });
  }
  return out;
}

/** 동일 송장번호가 2건 이상이면 합포장 표시 */
function _cs_markCombinedPack_(results, allRows) {
  if (!results || !results.length) return;
  var invCount = {};
  var rows = allRows || results;
  for (var i = 0; i < rows.length; i++) {
    var invRaw = String(rows[i].invDigits || rows[i].invoice || "").trim();
    if (!invRaw) continue;
    var parts = invRaw.split(/\s+/);
    for (var p = 0; p < parts.length; p++) {
      var d = String(parts[p] || "").replace(/[^0-9]/g, "");
      if (d.length >= 8) invCount[d] = (invCount[d] || 0) + 1;
    }
  }
  for (var j = 0; j < results.length; j++) {
    var inv2 = String(results[j].invoice || "").replace(/[^0-9]/g, "");
    if (inv2.length >= 8 && invCount[inv2] >= 2) {
      results[j].combinedPack = true;
      continue;
    }
    if (/---\/\s*소분|---\/.*소분|\/소분|합포장/.test(String(results[j].item || ""))) {
      results[j].combinedPack = true;
    }
    if (String(results[j].source || "") === "합포장") {
      results[j].combinedPack = true;
    }
  }
}

// ══════════════════════════════════════════════
//  정규화 헬퍼
// ══════════════════════════════════════════════

function _cs_phoneDigits_(p) {
  var s = String(p == null ? "" : p).replace(/[^0-9]/g, "");
  if (!s) return "";
  if (s.length >= 10 && s.charAt(0) !== "0") s = "0" + s;
  return s;
}

function _cs_phoneDisplay_(p) {
  var d = _cs_phoneDigits_(p);
  if (!d) return String(p || "").trim();
  if (d.length === 11) return d.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
  if (d.length === 10) return d.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  return d;
}

/**
 * 송장 장수 상한. 허브 `_par_slotSpec_` 과 같다 — 세트는 2N, 그 외 N~2N.
 * 수량 칸이 비면 판정하지 않는다 (_par_qtyNum_ 이 빈값을 1로 만들기 때문).
 */
function _cs_isSetItem_(item) {
  return /세트/i.test(String(item == null ? "" : item));
}

function _cs_qtyNum_(qty) {
  var n = parseInt(String(qty == null ? "" : qty).replace(/[^0-9]/g, ""), 10);
  return (isNaN(n) || n < 1) ? 1 : n;
}

function _cs_slotSpec_(qty, item) {
  var n = _cs_qtyNum_(qty);
  var set = _cs_isSetItem_(item);
  return { qty: n, min: n, max: n * 2, expect: set ? n * 2 : n, set: set };
}

function _cs_invList_(raw) {
  var parts = String(raw == null ? "" : raw).split(/[\s,;/|\n]+/);
  var seen = {};
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var d = String(parts[i] || "").replace(/[^0-9]/g, "");
    if (d.length < 8 || seen[d]) continue;
    seen[d] = true;
    out.push(d);
  }
  return out;
}

function _cs_qtyOverMax_(qty, item, invRaw) {
  var qtyRaw = String(qty == null ? "" : qty).replace(/[^0-9]/g, "");
  if (!qtyRaw) return false;
  return _cs_invList_(invRaw).length > _cs_slotSpec_(qty, item).max;
}

function _cs_stripOverflowInvoice_(rec) {
  if (!rec) return rec;
  var raw = rec.invoice || rec.invDigits || "";
  if (!_cs_qtyOverMax_(rec.qty, rec.item, raw)) return rec;
  rec.invOverflow = true;
  rec.invOverflowN = _cs_invList_(raw).length;
  rec.invoice = "";
  rec.invDigits = "";
  return rec;
}

function _cs_allInvDigits_(raw) {
  var s = String(raw == null ? "" : raw).replace(/[–—]/g, "-");
  var parts = s.split(/[\s,;/|\n]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var d = String(parts[i] || "").replace(/[^0-9]/g, "");
    if (d.length >= 8) out.push(d);
  }
  if (!out.length) {
    var all = s.replace(/[^0-9]/g, "");
    if (all.length >= 8) out.push(all);
  }
  return out.join(" ");
}

function _cs_nameOnly_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  var cut = s.split(/[\/|／]/)[0];
  return String(cut || s).trim();
}

function _cs_orderNoFromName_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  var m = s.split(/[\/|／]/);
  if (m.length >= 2) return String(m[m.length - 1] || "").trim();
  return "";
}

/** 이름 비었을 때 주문번호 "김미화/2157237902" → 타이틀 김미화, 주문 2157237902 */
function _cs_enrichNameOrder_(rec) {
  if (!rec || rec.name) return rec;
  var orderRaw = String(rec.orderNo || "").trim();
  if (!orderRaw || !/[\/|／]/.test(orderRaw)) return rec;
  var parsedName = _cs_nameOnly_(orderRaw);
  var parsedOid = _cs_orderNoFromName_(orderRaw);
  if (!parsedName || !parsedOid) return rec;
  if (!/[\uAC00-\uD7AF]/.test(parsedName)) return rec;
  rec.name = parsedName;
  rec.orderNo = parsedOid;
  return rec;
}

function _cs_normYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, "Asia/Seoul", "yyyy-MM-dd");
  }
  var s = String(v || "").trim();
  if (!s) return "";
  var m = s.match(/(\d{4})[.\-\/]?(\d{1,2})[.\-\/]?(\d{1,2})/);
  if (!m) return "";
  var mm = ("0" + m[2]).slice(-2);
  var dd = ("0" + m[3]).slice(-2);
  return m[1] + "-" + mm + "-" + dd;
}

/**
 * 조회할 «날짜» 목록 — 토·일은 뺀다.  (2026-09-16)
 *
 * > "1달이라면 사실 주 5일...20개~25개 정도야"   "주말 출고는 없어"
 *
 * ★ 왜 빼야 하나 ★
 *   주말엔 마감 파일이 아예 없다. 그런데 날짜 목록에 넣어 두니 늘
 *   「못 찾은 날」로 남았고, 화면은 그걸 보고 «아직 다 못 불러왔다»고
 *   판단해 매번 주말을 다시 찾으러 갔다. 있을 리 없는 파일을.
 *
 *   공휴일은 표로 두지 않는다 — 해마다 사람이 고쳐야 하고, 안 고치면
 *   조용히 틀린다. 대신 «한 번 찾아 없으면 없는 날로 기억»한다
 *   (_cs_loadDay_ 의 빈 캐시).
 *
 * days 는 «달력 날수»다. 30 이면 그 안의 영업일 21~22일이 나온다.
 */
function _cs_dateList_(days) {
  var n = _cs_clampDays_(days);
  var out = [];
  var now = new Date();
  var tzNow = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd");
  var parts = tzNow.split("-");
  var base = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  for (var i = 0; i < n; i++) {
    var d = new Date(base.getTime());
    d.setDate(d.getDate() - i);
    var dow = d.getDay();               // 0=일 6=토
    if (dow === 0 || dow === 6) continue;
    out.push(Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd"));
  }
  return out;
}

/**
 * 물어본 일수를 «허용된 값»으로 자른다.
 *
 * ★ 30일을 더했다 ★  (2026-09-16)
 *   > "cs에서는 지금 한달치를 볼수 있게 해달라고 하는데..."
 *   > "기본 30일로 해줘"
 *
 *   30일은 일일마감 파일 30개를 연다. 첫 예열이 느리지만 지난 날짜는
 *   안 바뀌어서 캐시(6시간)가 잘 먹는다 — 두 번째부터는 빠르다.
 */
function _cs_clampDays_(days) {
  var n = Number(days);
  if (n === 7) return 7;
  if (n === 14) return 14;
  return 30;
}

function _cs_daCacheKey_(dateStr) {
  return _CS_DA_CACHE_VER_ + "_da_" + dateStr;
}

function _cs_putDayCache_(cache, key, rows) {
  try {
    cache.put(key, JSON.stringify({ rows: rows }), _CS_DA_CACHE_TTL_);
  } catch (e) {
    // 100KB 초과 시 필드를 줄여 재시도
    try {
      var slim = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        slim.push({
          date: r.date, invoice: r.invoice, invDigits: r.invDigits,
          phone: r.phone, phoneDigits: r.phoneDigits, name: r.name,
          item: r.item, qty: r.qty, addr: r.addr, shipMsg: r.shipMsg || "",
          ecountCode: r.ecountCode || "", source: r.source,
          orderNo: r.orderNo, vendor: r.vendor, carrier: r.carrier || "",
          origin: r.origin
        });
      }
      cache.put(key, JSON.stringify({ rows: slim }), _CS_DA_CACHE_TTL_);
    } catch (e2) {}
  }
}

function _cs_buildMeta_(days, refresh, emptyQuery) {
  var dates = _cs_dateList_(days);
  return {
    days: days,
    from: dates[dates.length - 1],
    to: dates[0],
    refresh: refresh,
    emptyQuery: emptyQuery
  };
}

/** 일일마감 A열 품목코드 인식 점검 (스크립트 편집기에서 실행) */
function csDiagnoseEcountCode(optDateStr) {
  var dateStr = String(optDateStr || "").trim();
  if (!dateStr) {
    var dates = _cs_dateList_(3);
    dateStr = dates[0];
  }

  var file = _cs_findDailyFile_(dateStr);
  if (!file) {
    return { ok: false, error: "일일마감 파일 없음: " + dateStr };
  }

  var ss = SpreadsheetApp.open(file);
  var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
  var vals = tab.getRange(1, 1, Math.min(tab.getLastRow(), 30), tab.getLastColumn()).getDisplayValues();
  var hdr = vals[0] || [];
  var isDirect = _cs_isDirectDailyArchiveHeader_(hdr);
  var map = _cs_mapArchiveHeaders_(hdr);
  if (isDirect) {
    map.code = 0;
    map.item = 1;
  }

  var samples = [];
  for (var i = 1; i < vals.length && samples.length < 8; i++) {
    var row = vals[i];
    var rawA = row[0];
    var rawCodeCol = map.code >= 0 ? row[map.code] : "";
    var item = map.item >= 0 ? String(row[map.item] || "").trim() : "";
    var parsed = _cs_readEcountCodeCell_(rawCodeCol);
    var dbCode = "";
    if (!parsed && item) dbCode = _cs_resolveCodeFromDbByItem_(item);
    samples.push({
      row: i + 1,
      rawA: String(rawA || "").substring(0, 40),
      rawCodeCol: String(rawCodeCol || "").substring(0, 40),
      parsed: parsed,
      item: item.substring(0, 50),
      dbFallback: dbCode,
    });
  }

  var productDb = typeof csDiagnoseProductDb === "function" ? csDiagnoseProductDb() : null;

  return {
    ok: true,
    date: dateStr,
    fileName: file.getName(),
    layout: isDirect ? "direct_daily_A=품목코드" : "other",
    codeCol: map.code,
    itemCol: map.item,
    headerA: String(hdr[0] || ""),
    headerB: String(hdr[1] || ""),
    cacheVer: _CS_DA_CACHE_VER_,
    samples: samples,
    productDb: productDb,
  };
}

// ══════════════════════════════════════════════
//  반품관리대장 기록 (기존 열만 사용, 열 추가 금지)
//  https://docs.google.com/spreadsheets/d/1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU
// ══════════════════════════════════════════════

var _CS_RETURN_LEDGER_ID_ = "1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU";
/** 레거시 GID — 월별(yyyyMM) 탭 우선, 없을 때만 참고 */
var _CS_RETURN_LEDGER_GID_ = 1972370268;

/** 반품대장 월 키 — 탭명 202608 형식 */
function _cs_returnLedgerMonthKey_(optDate) {
  return Utilities.formatDate(optDate || new Date(), "Asia/Seoul", "yyyyMM");
}

function _cs_isReturnLedgerMonthName_(name) {
  return /^\d{6}$/.test(String(name || "").trim());
}

function _cs_listReturnLedgerMonthTabs_(ss) {
  var out = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var nm = String(sheets[i].getName() || "").trim();
    if (_cs_isReturnLedgerMonthName_(nm)) out.push(nm);
  }
  out.sort(function(a, b) { return b.localeCompare(a); });
  return out;
}

/** 신규 월 탭 복사 원본 — 직전 월 yyyyMM 탭 → 레거시 탭 */
function _cs_findReturnLedgerTemplateTab_(ss, monthKey) {
  var sheets = ss.getSheets();
  var monthTabs = [];
  for (var i = 0; i < sheets.length; i++) {
    var nm = sheets[i].getName();
    if (_cs_isReturnLedgerMonthName_(nm)) {
      monthTabs.push({ name: nm, tab: sheets[i] });
    }
  }
  monthTabs.sort(function(a, b) { return b.name.localeCompare(a.name); });
  for (var j = 0; j < monthTabs.length; j++) {
    if (monthTabs[j].name < monthKey) return monthTabs[j].tab;
  }
  if (monthTabs.length) return monthTabs[0].tab;
  for (var g = 0; g < sheets.length; g++) {
    if (sheets[g].getSheetId() === _CS_RETURN_LEDGER_GID_) return sheets[g];
  }
  var names = ["입고완료", "반품관리대장", "반품대장"];
  for (var n = 0; n < names.length; n++) {
    var t = ss.getSheetByName(names[n]);
    if (t) return t;
  }
  return sheets.length ? sheets[0] : null;
}

/** 복사된 월 탭 — 헤더 아래 데이터만 비움 (열 구조 유지) */
function _cs_clearReturnLedgerDataRows_(tab) {
  if (!tab) return;
  var lastCol = Math.max(tab.getLastColumn(), 15);
  var scan = Math.max(tab.getLastRow(), 40);
  var values = tab.getRange(1, 1, scan, lastCol).getDisplayValues();
  var headerIdx = _cs_findReturnHeaderRow_(values);
  if (headerIdx < 0) return;
  var dataStart = headerIdx + 2;
  var lr = tab.getLastRow();
  if (lr < dataStart) return;
  tab.getRange(dataStart, 1, lr - dataStart + 1, lastCol).clearContent();
}

/**
 * 반품관리대장 기록 탭 — 당월 yyyyMM (예: 202608)
 * 없으면 직전 월 탭 복사 후 생성
 */
function _cs_getReturnLedgerTab_(ss) {
  if (!ss) return null;
  var monthKey = _cs_returnLedgerMonthKey_();
  var tab = ss.getSheetByName(monthKey);
  if (tab) return tab;

  var template = _cs_findReturnLedgerTemplateTab_(ss, monthKey);
  if (!template) return null;

  tab = template.copyTo(ss);
  tab.setName(monthKey);
  try {
    ss.setActiveSheet(tab);
    ss.moveActiveSheet(0);
  } catch (eMove) {
    Logger.log("[RETURN_LEDGER] 탭 이동 skip: " + eMove.message);
  }
  _cs_clearReturnLedgerDataRows_(tab);
  Logger.log("[RETURN_LEDGER] 월별 탭 생성: " + monthKey + " ← " + template.getName());
  return tab;
}

function submitReturnLedger(data) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  data = data || {};
  try {
    var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    var tab = _cs_getReturnLedgerTab_(ss);
    if (!tab) return { success: false, error: "반품관리대장 탭을 찾을 수 없습니다." };

    var lastCol = Math.max(tab.getLastColumn(), 15);
    var lastRow = Math.max(tab.getLastRow(), 1);
    var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    var headerIdx = _cs_findReturnHeaderRow_(values);
    if (headerIdx < 0) return { success: false, error: "반품접수날짜 헤더를 찾지 못했습니다." };

    var header = values[headerIdx];
    var col = _cs_mapReturnLedgerCols_(header);
    var invoice = _cs_formatLedgerInvoice_(data.invoice);
    var invDigits = String(invoice || "").replace(/[^0-9]/g, "");

    if (!data.force && invDigits.length >= 8) {
      var dup = _cs_findReturnDupRow_(values, headerIdx, col.invoice, invDigits);
      if (dup > 0) {
        return {
          success: false,
          duplicate: true,
          existingRow: dup,
          message: tab.getName() + " 탭 " + dup + "행에 같은 송장이 있습니다. 그래도 추가할까요?"
        };
      }
    }

    var row = [];
    for (var c = 0; c < lastCol; c++) row.push("");
    if (col.date >= 0) row[col.date] = _cs_ledgerDate_();
    if (col.staff >= 0) row[col.staff] = String(data.staff || "").trim();
    if (col.vendor >= 0) row[col.vendor] = String(data.vendor || "").trim();
    if (col.name >= 0) row[col.name] = String(data.name || "").trim();
    if (col.phone >= 0) row[col.phone] = _cs_formatLedgerPhone_(data.phone);
    /* 실번호는 「추가연락처」 열에 따로 적는다 — 주 연락처를 덮지 않는다.
       주문서의 안심번호도 남아 있어야 쇼핑몰 자료와 맞춰 볼 수 있다. */
    if (col.phone2 >= 0 && String(data.phone2 || "").trim()) {
      row[col.phone2] = _cs_formatLedgerPhone_(data.phone2);
    }
    /* 실번호 주인 이름 — 전용 열이 있을 때만 여기서 적는다.
       없으면 아래 비고 줄에 «(이름)» 으로 따라 붙는다. */
    var p2NameIn = String(data.phone2Name || "").trim().substring(0, 20);
    var p2NameToNotice = "";
    if (p2NameIn) {
      if (col.phone2Name >= 0) {
        row[col.phone2Name] = p2NameIn;
      } else {
        /* 전용 열이 없는 탭 — 비고에 «실번호 010-… (이름)» 으로 남긴다.
           반품송장이 걸어온 길과 같다. 시트에 「실번호 이름」 열을 만들면
           코드를 안 고쳐도 그쪽으로 옮겨 간다. */
        p2NameToNotice = _cs_ledgerStamp_(data.staff) + " 실번호 " +
          _cs_formatLedgerPhone_(data.phone2) + " (" + p2NameIn + ")";
      }
    }
    if (col.pickup >= 0) {
      var pickupVal = String(data.pickup || "").trim();
      if (!pickupVal && data.carrier) pickupVal = String(data.carrier).trim();
      if (!pickupVal) {
        var bulkIdx = _cs_loadSabangBulkIndex_(false);
        var recForCarrier = {
          orderNo: data.orderNo,
          invoice: data.invoice,
          invDigits: String(data.invoice || "").replace(/[^0-9\s]/g, " ").trim(),
          source: data.source,
          origin: data.origin
        };
        pickupVal = _cs_lookupCarrierFromSabangBulk_(recForCarrier, bulkIdx);
        if (!pickupVal) {
          _cs_enrichCarrier_(recForCarrier, bulkIdx);
          pickupVal = recForCarrier.carrier || "";
        }
      }
      row[col.pickup] = pickupVal;
    }
    if (col.item >= 0) row[col.item] = String(data.item || "").trim();
    if (col.qty >= 0) row[col.qty] = data.qty || "";
    if (col.invoice >= 0) row[col.invoice] = invoice;
    if (col.type >= 0) row[col.type] = String(data.type || "단순반품").trim();
    if (col.fee >= 0 && data.fee !== undefined && data.fee !== null && String(data.fee).trim() !== "") {
      row[col.fee] = String(data.fee).trim();
    }
    if (col.status >= 0 && data.status) row[col.status] = String(data.status).trim();

    // 반품송장 — 전용 열이 있으면 열에 쓰고, 없는 탭이면 예전처럼 비고에 남긴다
    var retInv = data.returnInvoice ? _cs_formatLedgerInvoice_(data.returnInvoice) : "";
    var retInvToNotice = "";
    if (retInv) {
      if (col.returnInvoice >= 0) row[col.returnInvoice] = retInv;
      else retInvToNotice = "반품송장: " + retInv;
    }

    /* 환불계좌 — 반품송장과 같은 방식. 전용 열이 있으면 열에, 없으면 비고에.
       ★ 사람이 적은 그대로 둔다 ★ 「농협 302-0578-9806-91 조명숙」처럼
       은행·번호·예금주가 한 덩어리로 온다. 쪼개려 들면 은행 이름 표기가
       제각각이라 반드시 틀린다. 돈이 걸린 값은 원문이 안전하다. */
    var acct = String(data.account || "").trim();
    var acctToNotice = "";
    if (acct) {
      if (col.account >= 0) row[col.account] = acct;
      else acctToNotice = "계좌: " + acct;
    }

    if (col.notice >= 0) {
      var noticeLines = [];
      if (data.memo) noticeLines.push(_cs_ledgerStamp_(data.staff) + " " + String(data.memo || "").trim());
      if (retInvToNotice) noticeLines.push(retInvToNotice);
      if (acctToNotice) noticeLines.push(acctToNotice);
      if (p2NameToNotice) noticeLines.push(p2NameToNotice);
      row[col.notice] = noticeLines.join("\n");
    }

    if (col.date < 0 && col.invoice < 0 && col.name < 0) {
      return {
        success: false,
        error: "반품대장 헤더 매핑 실패 (" + tab.getName() + "). 관리자에게 csDiagnoseReturnLedger 점검 요청."
      };
    }

    var dest = _cs_nextReturnLedgerDestRow_(values, headerIdx, col);
    tab.getRange(dest, 1, 1, lastCol).setValues([row]);
    if (dest > headerIdx + 2) {
      try {
        tab.getRange(dest - 1, 1, 1, lastCol)
          .copyTo(tab.getRange(dest, 1, 1, lastCol), { formatOnly: true });
        tab.getRange(dest, 1, 1, lastCol).setValues([row]);
      } catch (eFmt) {
        Logger.log("[RETURN_LEDGER] format copy skip: " + eFmt.message);
      }
    }

    return {
      success: true,
      row: dest,
      sheet: tab.getName(),
      message: tab.getName() + " 탭 " + dest + "행에 기록했습니다."
    };
  } catch (e) {
    return { success: false, error: "반품대장 기록 오류: " + e.message };
  } finally {
    try { csInvalidateReturnLedgerCache_(); } catch (eInv) {}
  }
}

/** 진단용 — 월 탭 자동 생성 없이 조회 */
function _cs_peekReturnLedgerTab_(ss) {
  var monthKey = _cs_returnLedgerMonthKey_();
  var tab = ss.getSheetByName(monthKey);
  if (tab) {
    return { tab: tab, monthKey: monthKey, missingMonthTab: false, templateName: "" };
  }
  var template = _cs_findReturnLedgerTemplateTab_(ss, monthKey);
  return {
    tab: template,
    monthKey: monthKey,
    missingMonthTab: true,
    templateName: template ? template.getName() : ""
  };
}

/** 반품대장 연결·헤더 매핑 점검 (CS앱 기록 안 될 때) */
function csDiagnoseReturnLedger() {
  try {
    var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    var monthKey = _cs_returnLedgerMonthKey_();
    var monthTabs = _cs_listReturnLedgerMonthTabs_(ss);
    var peek = _cs_peekReturnLedgerTab_(ss);
    var tab = peek.tab;
    if (!tab) return { ok: false, error: "반품대장 탭/템플릿 없음", monthKey: monthKey, monthTabs: monthTabs };
    var lastCol = Math.max(tab.getLastColumn(), 15);
    var lastRow = tab.getLastRow();
    var scanRows = Math.max(lastRow, 30);
    var values = tab.getRange(1, 1, scanRows, lastCol).getDisplayValues();
    var headerIdx = _cs_findReturnHeaderRow_(values);
    var header = headerIdx >= 0 ? values[headerIdx] : [];
    var colMap = headerIdx >= 0 ? _cs_mapReturnLedgerCols_(header) : null;

    /* 어느 항목이 어느 열에 붙었는지 사람이 읽을 수 있게 편다.
       -1 이면 그 항목은 **조용히 안 적힌다** — 이게 유형(K열)이 안 써지던
       이유였다. 매핑 실패가 보이지 않으면 아무도 모른다. */
    var readable = [], unmapped = [];
    if (colMap) {
      var label = {
        status: "처리상태", date: "반품접수날짜", staff: "접수자", vendor: "업체명",
        name: "반품신청자", phone: "연락처", phone2: "추가연락처(실번호)",
        phone2Name: "실번호 이름",
        pickup: "수거입력처", item: "상품명",
        qty: "수량", invoice: "원송장", type: "유형", fee: "반품비",
        notice: "고객요청/비고", returnInvoice: "반품송장"
      };
      for (var f in label) {
        if (!Object.prototype.hasOwnProperty.call(label, f)) continue;
        var idx = colMap[f];
        if (idx >= 0) {
          readable.push(label[f] + " → " + _cs_colLetter_(idx) + "열 (헤더: \"" +
            String(header[idx] || "").trim() + "\")");
        } else {
          unmapped.push(label[f]);
        }
      }
    }

    var out = {
      ok: headerIdx >= 0,
      ssName: ss.getName(),
      monthKey: monthKey,
      monthTabs: monthTabs,
      missingMonthTab: peek.missingMonthTab,
      templateName: peek.templateName,
      tabName: tab.getName(),
      tabGid: tab.getSheetId(),
      lastRow: lastRow,
      headerRow: headerIdx >= 0 ? headerIdx + 1 : 0,
      headers: header,
      매핑: readable,
      매핑실패: unmapped.length ? unmapped : "없음",
      colMap: colMap,
      error: headerIdx < 0 ? "반품접수날짜 헤더 없음 (상위 " + scanRows + "행 검색)" : ""
    };
    // 편집기는 반환값을 로그에 찍어주지 않는다. 사람이 직접 돌리는 점검이라 남긴다.
    try { Logger.log(JSON.stringify(out, null, 2)); } catch (eL) {}
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _cs_findReturnHeaderRow_(values) {
  var n = Math.min(values.length, 40);
  for (var i = 0; i < n; i++) {
    var row = values[i] || [];
    var joined = "";
    var hits = 0;
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] || "").replace(/\s/g, "");
      if (!cell) continue;
      joined += cell + "|";
      if (/반품접수날짜|접수날짜|접수일자/.test(cell)) hits++;
      if (cell === "접수자") hits++;
      if (/원송장번호|원송장/.test(cell)) hits++;
      if (/상품명|품목명/.test(cell) && !/코드/.test(cell)) hits++;
    }
    // 실제 헤더(4행): B=반품접수날짜, C=접수자 … — A열이 비어 있어도 행 전체로 판별
    if (hits >= 2) return i;
    if (/반품접수날짜|접수날짜/.test(joined)) return i;
  }
  return -1;
}

/** 0-based 열 번호 → 스프레드시트 열 문자 (0 → A, 10 → K) */
function _cs_colLetter_(idx) {
  var n = Number(idx);
  if (!(n >= 0)) return "?";
  var s = "";
  n = n + 1;
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function _cs_mapReturnLedgerCols_(header) {
  var col = {
    date: -1, staff: -1, vendor: -1, name: -1, phone: -1, phone2: -1, phone2Name: -1,
    pickup: -1, item: -1, qty: -1, invoice: -1, type: -1, fee: -1, status: -1, notice: -1,
    /* 반품사유 — 대장 L열. type(K열 구분)과 «다른» 칸이다.
       2026-09-18 까지 else-if 에 가려 한 번도 안 읽혔다. */
    reason: -1,
    // 반품송장번호 — 대장 맨 끝에 추가한 열. 없으면 -1 이고 N열 비고 파싱으로 폴백한다.
    returnInvoice: -1,
    /* 환불계좌 — 아직 대장에 없는 열이다 (2026-09-08).
       시트에 「환불계좌」 열을 만들면 **코드를 안 고쳐도** 여기로 잡힌다.
       그전까지는 비고에 「계좌: …」로 남는다. 반품송장이 걸어온 길과 같다. */
    account: -1
  };
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (col.date < 0 && /반품접수날짜|접수날짜|접수일자/.test(h)) col.date = i;
    else if (col.staff < 0 && h === "접수자") col.staff = i;
    /* 2026-09-09: 9월 탭에서 D열이 「업체명」 → 「주문지」로 바뀌었다.
       뜻은 같다 — 「법인/쿠팡」·「대리발송-리바이」처럼 주문이 어디서 왔나다.
       여기는 못 찾아도 안 막고 빈칸으로 두던 자리라 조용히 업체명이 사라지고
       있었다. 협력업체 포털(prpLedger.gs)은 같은 이유로 접수를 막았다. */
    else if (col.vendor < 0 && /업체명|주문지|판매처|발주업체/.test(h)) col.vendor = i;
    else if (col.name < 0 && /반품신청자|수취인명|수취인|받는분/.test(h) && !/전화|주소/.test(h)) col.name = i;
    /* ★ 「추가」를 «먼저» 걸러야 한다 ★  (2026-09-11)
       /연락처/ 는 「추가연락처」에도 걸린다. 지금은 E(연락처)가 F(추가연락처)보다
       앞이라 우연히 맞고 있었을 뿐이다 — 열 순서가 바뀌는 날 추가연락처가
       주 연락처 자리로 들어간다. 포털(prpLedger.gs:77)은 이미 이렇게 막아 뒀다.

       그리고 종전에는 phone2 항목 자체가 없어서 실번호가 «어디에도 안 나왔다».
       대장 F열에 적어 둔 실번호가 조용히 버려지고 있었다. */
    /* ★ 실번호의 «주인 이름» ★  (2026-09-11)
       > "실번호에 이름 넣는 칸도 만들어줘... 주문자와 상담자가 다른경우가 있어"
       주문은 며느리가 하고 전화는 시어머니가 받는 식이다. 번호만 적어 두면
       다음 사람이 걸어서 "누구세요"를 두 번 한다.

       ★ 「이름」을 먼저 걸러야 한다 ★
         /실번호/ 는 「실번호 이름」에도 걸린다. 이 줄이 위에 있어야
         이름 열이 번호 열 자리를 뺏지 않는다. */
    else if (col.phone2Name < 0 && /(실번호|추가연락처|연락처)(이름|성함)|상담자|통화자/.test(h)) col.phone2Name = i;
    else if (col.phone2 < 0 && /추가연락처|추가전화|비상연락|실번호/.test(h)) col.phone2 = i;
    else if (col.phone < 0 && /연락처|전화|휴대폰/.test(h) && !/주소|추가/.test(h)) col.phone = i;
    /* ★ 2026-09-10: 「회수신청」을 더한다 (포털 prpLedger.gs 와 쌍) ★
       9월 탭 M열 머리글이 「수거입력처」 → 「회수신청」 이라 수거 택배사가
       어느 화면에도 안 나오고 있었다. 아래 M열 반품비 폴백은 이 열을
       이미 알고 있었는데(자동회수가 금액으로 들어갔던 사고), 수거 쪽에는
       반영이 안 돼 있었다. */
    else if (col.pickup < 0 && /수거입력처|회수신청|수거택배|회수택배|수거요청/.test(h)) col.pickup = i;
    else if (col.item < 0 && /상품명|품목명/.test(h) && !/코드/.test(h)) col.item = i;
    else if (col.qty < 0 && (h === "수량" || h.indexOf("수량") === 0)) col.qty = i;
    else if (col.invoice < 0 && /원송장|송장번호/.test(h) && !/회수|재발송|반품송장/.test(h)) col.invoice = i;
    else if (col.returnInvoice < 0 && /반품송장|회수송장/.test(h)) col.returnInvoice = i;
    else if (col.account < 0 && /환불계좌|입금계좌|계좌번호|^계좌$/.test(h)) col.account = i;
    /* ★ 반품사유(L열)를 «따로» 읽는다 ★  (2026-09-18)
       > "반품대장의 l열에 반품사유가 있는데 그게 나타나야할꺼 같아.."

       아래 type 정규식에 이미 「반품사유」가 들어 있었다. 그런데 K열
       (「재출고/단순/오주문입력/오배송」)이 먼저 type 을 채우고 나면
       else-if 라 L열은 «아무 데도» 안 들어갔다. 그래서 대장에 적힌
       사유가 어느 화면에도 안 나왔다 — 조용히.

       ★ type 보다 «앞»에 둔다 ★ 뒤에 두면 또 같은 일이 난다.
       ★ 좁게 잡는다 ★ /사유/ 만 보면 「취소반품사유」 같은 다른 칸까지
         빨아들인다. 반품 쪽 사유만 집는다. */
    else if (col.reason < 0 && /^반품사유$|^사유$|반품이유|교환반품사유/.test(h)) col.reason = i;
    // 2026-09-04: 실제 헤더 문구를 넣는다.
    //   시트는 「재출고/단순/오주문입력/오배송」이라고 적혀 있는데 정규식에 없어서
    //   지금껏 K열 위치 폴백으로만 맞고 있었다. 9월에 열이 한 칸 밀리자 바로 깨졌다.
    else if (col.type < 0 && /교환.?반품|반품구분|반품유형|처리구분|반품사유|재출고|오주문입력/.test(h)) col.type = i;
    // 「반품/환불비용」이 실제 헤더다. 슬래시 때문에 /반품비/ 로는 안 걸린다.
    else if (col.fee < 0 && /반품비|반품운임|반품배송비|환불비용/.test(h)) col.fee = i;
    else if (col.notice < 0 && /고객요청|유의사항|비고/.test(h)) col.notice = i;
  }
  // A열 = 처리상태 (접수/수거중/완료 …). 헤더명이 비어도 A를 쓴다.
  col.status = 0;

  /* M열 = 반품비 폴백.
     ★ 2026-09-04: **헤더가 비었거나 옛 문구일 때만** 쓴다.
       전에는 무조건 M을 금액으로 읽었다. 9월에 열이 한 칸 밀려 M이
       「회수신청」이 되자 Y/N 값이 반품비로 들어왔다. 조용히 틀렸고,
       사람은 금액이 안 적힌 줄 알았다.
       옛 탭(202604~07)은 헤더가 「선출고/입고검수후출고」인데 칸에는
       실제로 반품비가 적혀 있다 — 그 경우는 계속 읽어야 한다. */
  if (col.fee < 0) {
    var mHdr = String(header[12] || "").replace(/\s/g, "");
    if (!mHdr || /선출고|입고검수후출고/.test(mHdr)) col.fee = 12;
  }

  /* K열 = 유형 (재출고/단순/오주문입력/오배송).
     ★ 2026-09-02: 헤더명으로 못 찾으면 K열을 쓴다.
       헤더 문구가 코드의 정규식과 어긋나면 col.type 이 -1 로 남고, 그러면
       유형이 **조용히 안 적힌다**. 사람은 드롭다운에서 골랐으니 적힌 줄 안다.
       A열(처리상태)·M열(반품비)이 이미 같은 방식으로 위치를 못 박고 있다.
       다른 항목이 이미 K를 가져갔으면 건드리지 않는다 — 덮어쓰는 게 더 나쁘다. */
  if (col.type < 0) {
    var K = 10;
    var kHdr = String(header[K] || "").replace(/\s/g, "");
    var taken = false;
    for (var k in col) {
      if (Object.prototype.hasOwnProperty.call(col, k) && col[k] === K) { taken = true; break; }
    }
    // ★ 2026-09-04: 헤더가 있는 열은 건드리지 않는다.
    //   9월 탭은 K가 「원송장번호」라 이미 다른 항목이 가져갔다. 그때 억지로
     //   K를 유형으로 쓰면 송장번호가 유형이 된다.
    if (!taken && !kHdr) col.type = K;
  }
  return col;
}

function _cs_formatReturnFee_(v) {
  if (v === null || v === undefined || v === "") return "";
  var s = String(v).trim();
  if (!s || s === "-") return "";
  if (/원/.test(s)) return s;
  if (!/^-?[\d,]+(\.\d+)?$/.test(s)) return s;
  var n = parseFloat(s.replace(/,/g, ""));
  if (isNaN(n)) return s;
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
}

function _cs_findReturnDupRow_(values, headerIdx, invCol, invDigits) {
  if (invCol < 0 || !invDigits) return 0;
  for (var i = headerIdx + 1; i < values.length; i++) {
    var d = String(values[i][invCol] || "").replace(/[^0-9]/g, "");
    if (d && d === invDigits) return i + 1;
  }
  return 0;
}

/**
 * 새 반품 건을 쓸 행 번호 (1-기반 시트 행).
 *
 * 아래쪽에 서식만 남은 빈 줄이 흔하므로 `getLastRow()` 를 믿지 않고
 * 키 열(날짜·송장·이름·품목·전화)에 값이 있는 **마지막 행**을 직접 찾는다.
 *
 * ★ `values` 는 0-기반이고 시트 행은 1-기반이다 — 인덱스 i 의 시트 행은 i+1.
 *   그래서 마지막 데이터가 인덱스 `lastData` 면 **다음 빈 행은 lastData+2** 다.
 *   여기서 +1 을 쓰면 방금 찾은 그 마지막 행을 도로 가리켜 **덮어쓴다.**
 *   실제로 그랬다 — 접수할 때마다 직전 건 위에 쓰여 대장에 한 건만 남고,
 *   앱에서는 카드가 떴다가 다음 접수 때 사라졌다. 에러는 나지 않는다.
 *
 * 같은 계산이 반품 포털 `prpNextDestRow_` 에 복제돼 있다. **쌍으로 고친다.**
 * 검사는 `node _return_append_test.js`.
 */
function _cs_nextReturnLedgerDestRow_(values, headerIdx, col) {
  var dataStart = headerIdx + 1;
  var lastData = headerIdx;
  var keyCols = [col.date, col.invoice, col.name, col.item, col.phone].filter(function(c) {
    return c >= 0;
  });
  if (!keyCols.length) keyCols = [col.date, col.invoice, col.name];
  for (var i = dataStart; i < values.length; i++) {
    var row = values[i] || [];
    var has = false;
    for (var k = 0; k < keyCols.length; k++) {
      var v = String(row[keyCols[k]] || "").trim();
      if (v && v !== "-") {
        has = true;
        break;
      }
    }
    if (has) lastData = i;
  }
  // lastData(인덱스) → 시트 행 lastData+1 → 그 다음 행 lastData+2
  return Math.max(lastData + 2, headerIdx + 2);
}

function _cs_ledgerDate_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd");
}

function _cs_formatLedgerPhone_(raw) {
  var d = String(raw || "").replace(/[^0-9]/g, "");
  if (d.length === 11) return d.substring(0, 3) + "-" + d.substring(3, 7) + "-" + d.substring(7);
  if (d.length === 10) return d.substring(0, 3) + "-" + d.substring(3, 6) + "-" + d.substring(6);
  return String(raw || "").trim();
}

/**
 * ══════════════════════════════════════════════════════════════
 *  걸 수 있는 번호를 앞에 세운다
 *  2026-09-11
 *
 *  > "반품접수 또는 반품 카드에 실번호가 입력되있으면 실번호 위주로
 *     나오게 해줘.. 쿠팡의 경우 안심번호라 기간이 지나면 연락이 안되"
 *
 *  ★ 이 웹앱은 「추가연락처」 열을 «아예 안 읽고 있었다» ★
 *    대장 F열에 실번호를 적어 두면 협력업체 포털(prpLedger.gs)은 읽는데,
 *    CS 웹앱의 열 찾기에는 그 항목 자체가 없었다. 그래서 직원이 힘들게
 *    받아 적은 실번호가 이 화면 어디에도 안 나왔다.
 *
 *  ★ 안심번호는 시한부다 ★
 *    050 으로 시작하는 번호는 쇼핑몰이 만들어 준 가림막이라 배송이 끝나면
 *    끊긴다. 반품은 그 뒤에 움직이는 일이라, 회수 기사가 걸 즈음엔 이미
 *    안 받는 번호인 경우가 많다. 쿠팡 건이 특히 그렇다.
 *
 *  v2 의 lib/returns.ts pickPhones 와 «같은 규칙»이다. 한쪽만 고치면
 *  같은 건이 두 화면에서 다른 번호로 보인다.
 * ══════════════════════════════════════════════════════════════
 */
function _cs_isSafePhone_(v) {
  return /^050[0-9]/.test(String(v || "").replace(/[^0-9]/g, ""));
}

/**
 * @param phone   대장의 「연락처」 (쿠팡 건이면 안심번호인 경우가 많다)
 * @param phone2  대장의 「추가연락처」 (접수할 때 받아 적은 실번호)
 * @return {{main:string, mainTag:string, sub:string, subTag:string, onlySafe:boolean}}
 */
function _cs_pickPhones_(phone, phone2) {
  var 주 = String(phone || "").trim();
  var 실 = String(phone2 || "").trim();
  var 주가안심 = _cs_isSafePhone_(주);

  /* 실번호 칸에도 «안심번호»를 적어 둔 경우가 있다. 그때까지 앞세우면
     거꾸로가 된다 — 둘 다 안심이라 순서를 바꿔 봐야 나아질 게 없다. */
  if (실 && !_cs_isSafePhone_(실)) {
    return {
      main: 실, mainTag: "",
      sub: (주 && 주 !== 실) ? 주 : "",
      subTag: (주 && 주 !== 실) ? (주가안심 ? "안심" : "주문서") : "",
      onlySafe: false
    };
  }
  return {
    main: 주 || 실,
    mainTag: 주 ? (주가안심 ? "안심" : "") : (실 ? "안심" : ""),
    sub: (주 && 실 && 주 !== 실) ? 실 : "",
    subTag: (주 && 실 && 주 !== 실) ? "추가" : "",
    onlySafe: !!(주 || 실) && (주 ? 주가안심 : true)
  };
}

function _cs_formatLedgerInvoice_(raw) {
  var s = String(raw || "").trim();
  var parts = s.match(/\d{10,14}/g);
  if (parts && parts.length) {
    var d = parts[0];
    if (d.length === 12) {
      return d.substring(0, 4) + "-" + d.substring(4, 8) + "-" + d.substring(8);
    }
    return d;
  }
  var dAll = s.replace(/[^0-9]/g, "");
  if (dAll.length === 12) {
    return dAll.substring(0, 4) + "-" + dAll.substring(4, 8) + "-" + dAll.substring(8);
  }
  return s || dAll;
}

// ══════════════════════════════════════════════
//  반품관리대장 조회 — 진행 중 목록 · 검색 뱃지
// ══════════════════════════════════════════════

// v9: lastRow<5 가드 수정. 고치기 전에 캐시된 "빈 결과"를 버려야 해서 올린다
var _CS_RETURN_CACHE_VER_ = "v9";
var _CS_RETURN_CACHE_TTL_ = 600; // 10분
// 캐시 세대 — 기록이 생길 때마다 올라간다. `csInvalidateReturnLedgerCache_` 참고.
var _CS_RETURN_GEN_PROP_ = "_CS_RET_CACHE_GEN_";

/*  ★ (days, activeOnly) 별 캐시 키는 없앴다 ★  (2026-09-17)
    그 열쇠가 바로 같은 탭을 세 번 읽게 만든 까닭이다 —
    30일·진행만 / 30일·전부 / 90일·전부 가 저마다 다른 열쇠였다.
    이제 «월 탭 하나»만 캐시하고 날짜·진행 여부는 메모리에서 거른다.
    _cs_loadReturnLedgerTabRows_ 참고. 세대 번호는 거기서도 쓴다.  */
/**
 * 반품 상태 — 2026-08-31 9개에서 4개로 줄였다.
 *
 *   접수        고객 반품 요청을 받은 단계
 *   반품송장    회수 송장이 나간 단계 (구 수거요청·수거중)
 *   입고검수    물건이 들어와 확인한 단계 (구 반품입고·입고·입고검수)
 *               물류팀이 사진을 올리면 여기로 넘어간다
 *   이카운트OK  처리 종료 (구 환불처리·완료·철회)
 *
 * 드롭다운만 줄인 것이라 기존 행의 옛 값은 그대로 남는다.
 * 옛 값도 화면에 보여야 하므로 이 목록으로 필터링하지 말 것.
 * 완료 판정은 _cs_isReturnDoneMark_ 가 하며 "이카운트OK"·"이카운트 ok" 둘 다 잡는다.
 */
var _CS_RETURN_STATUS_OPTS_ = [
  "접수", "반품송장", "입고검수", "이카운트OK"
];

/** 주문검색 뱃지가 훑는 기간. 뱃지는 "이 주문 반품된 적 있나"를 답해야 하므로 완료건까지 본다. */
var _CS_RETURN_BADGE_DAYS_ = 90;

/**
 * 상태 → 진행 단계 0~3.
 *
 * 주문검색 뱃지의 색과 아이콘이 이 숫자로 갈린다. 글자는 시트 원값을 그대로
 * 보여준다 — 화면이 시트와 다른 말을 쓰면 둘을 대조할 때 사람이 헷갈린다.
 *
 * 옛 값(수거요청·수거중·반품입고·입고 …)도 같이 잡는다. 드롭다운만 4개로
 * 줄였을 뿐 기존 행에는 옛 글자가 그대로 남아 있다.
 *
 *   0 접수      아직 물건이 안 움직였다
 *   1 회수      회수 송장이 나갔다 (반품송장·수거요청·수거중)
 *   2 입고      물류팀이 받아서 사진을 올렸다 (입고검수·반품입고·입고)
 *   3 완료      _cs_isReturnDoneMark_ 가 완료로 본 건
 */
/*
 * ★ 2026-09-11: 두 군데를 고친다 ★
 *   ① replace(/s/g) 는 «알파벳 s»를 지운다. 공백을 지우려던 것인데
 *     역슬래시가 먹혔다. 한글 상태에는 해가 없었지만 뜻이 틀렸다.
 *   ② 「환불처리」가 어디에도 안 걸려 0(접수)으로 떨어졌다. 옛 값이라
 *     드롭다운에는 없지만 지난 행에는 남아 있다 — 완료로 본다.
 *
 *   ★ 협력업체 포털 portal.html stepIndex 와 «같은 규칙»이다 ★
 *     한쪽만 고치면 같은 건이 두 화면에서 다른 단계로 보인다.
 *     실제로 그 일이 있었다 — 포털이 「반품송장」을 몰라 계속 접수였다.
 */
function _cs_returnStage_(status, active) {
  if (!active) return 3;
  var s = String(status || "").replace(/[ 	]/g, "");
  if (!s) return 0;
  if (/완료|환불/.test(s)) return 3;
  if (/입고|검수/.test(s)) return 2;
  if (/반품송장|회수|수거/.test(s)) return 1;
  return 0;
}

/*
 * ★ 반품송장이 생기면 「접수」에 머물 까닭이 없다 ★  (2026-09-20)
 *
 * > "반품송장이 입력되면 수거중으로 상태값이 바뀌면 좋겠어"
 *
 * 대장에 적히는 값은 「반품송장」이고, 협력업체 포털은 그것을 「회수중」으로
 * 보여준다 (portal.html STEPS). 화면 글자를 대장에 넣으면 두 화면이 갈린다.
 *
 * ★ 올리기만 한다 ★ 이미 입고검수·완료로 간 건을 뒤로 끌어내리지 않는다.
 *   나중에 송장을 하나 더 붙이는 일이 있는데, 그때 카드가 되돌아가면
 *   물류가 이미 받은 박스를 다시 기다리게 된다.
 */
var _CS_STATUS_PICKUP_ = "반품송장";

/** 지금 상태가 아직 「접수」인가 — 그렇다면 회수 단계로 올릴 자리다 */
function _cs_isBeforePickup_(status) {
  return _cs_returnStage_(status, true) === 0;
}

/** 상담이력에 붙은 사진 장수 (물류팀이 올린 입고 사진 포함) */
function _cs_returnPhotoCount_(timeline) {
  var n = 0;
  for (var i = 0; i < (timeline || []).length; i++) {
    if (timeline[i] && timeline[i].kind === "photo") n++;
  }
  return n;
}

function _cs_ledgerStamp_(staff) {
  var d = Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd HH:mm");
  return "[" + d + " " + String(staff || "CS").trim() + "]";
}

function _cs_appendNoticeLine_(existing, line) {
  var s = String(existing || "").trim();
  return s ? (s + "\n" + line) : line;
}

function _cs_timelineSortKey_(yymmdd, hm) {
  var ymd = _cs_ledgerYmdFromCell_(yymmdd);
  if (!ymd) return "000000000000";
  var t = String(hm || "00:00").replace(/[^0-9]/g, "");
  while (t.length < 4) t += "0";
  return ymd + t.substring(0, 4);
}

function _cs_timelineSortKeyFromYymmdd_(yymmdd) {
  var ymd = _cs_ledgerYmdFromCell_(yymmdd);
  return ymd ? (ymd + "0000") : "000000000000";
}

/** N열 비고 → 타임라인 (최신순 정렬용 sortKey 포함) */
function _cs_parseReturnTimeline_(notice, status, staff, date, type) {
  var events = [];
  var lines = String(notice || "").split(/\n/);

  for (var i = 0; i < lines.length; i++) {
    var ln = String(lines[i] || "").trim();
    if (!ln) continue;
    /* ★ CS확인 표시도 meta 다 ★  (2026-09-18)
       > "업체에서 등록하면.. cs들이 확인을 못할수 있으니까..
       >  반품카드 최상단에 위치해서 하이라이트.. cs에서 확인하면 꺼지게"

       확인했다는 것을 어딘가 적어야 팀이 같이 안다(브라우저에만 담으면
       사람마다 따로 논다). 그런데 이력에 보이면 카드마다 군더더기가 된다.
       그래서 «대괄호 없는» 한 줄로 적는다 —
         · CS 화면 : 여기서 meta 로 걸러 안 보인다
         · 업체 포털 : 대괄호 형식이 아니면 아예 안 내보낸다
                      (prpLedger.prpPublicTimeline_ 의 `if (!m) continue;`)
       반품송장 줄이 걸어온 길과 같다. */
    if (/^반품송장\s*[:：]|^회수송장\s*[:：]|^CS확인\s*[:：]/.test(ln)) {
      events.push({ kind: "meta", text: ln, sortKey: "100000000000" });
      continue;
    }
    var m = ln.match(/^\[(\d{6})\s+(\d{1,2}:\d{2})\s+([^\]]+)\]\s*(.*)$/);
    if (m) {
      var body = String(m[4] || "").trim();
      var isStatus = /^상태→/.test(body);
      // 사진 첨부 줄 — CS앱(csAttach)과 협력업체 포털(prpAttach)이 같은 문구로 남긴다
      var isPhoto = /^사진\s*첨부/.test(body) && /https?:\/\//.test(body);
      events.push({
        kind: isStatus ? "status" : (isPhoto ? "photo" : "consult"),
        date: m[1],
        time: m[2],
        staff: String(m[3] || "").trim(),
        text: isStatus ? body.replace(/^상태→/, "").trim() : body,
        raw: ln,
        noticeLineIdx: i,
        sortKey: _cs_timelineSortKey_(m[1], m[2])
      });
      continue;
    }
    events.push({ kind: "note", text: ln, raw: ln, noticeLineIdx: i, sortKey: "000000000001" });
  }

  if (date) {
    events.push({
      kind: "access",
      date: date,
      time: "",
      staff: String(staff || "").trim(),
      text: "반품 접수" + (type ? " · " + type : "") + (status ? " · " + status : ""),
      sortKey: _cs_timelineSortKeyFromYymmdd_(date)
    });
  }

  events.sort(function(a, b) {
    return String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
  });
  return events;
}

function _cs_openReturnLedgerRow_(tabName, rowNum) {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var tab = ss.getSheetByName(String(tabName || "").trim());
  if (!tab) throw new Error("탭 없음: " + tabName);
  rowNum = parseInt(rowNum, 10);
  if (!(rowNum > 0)) throw new Error("행 번호 오류");

  var lastCol = Math.max(tab.getLastColumn(), 15);
  var scanRows = Math.max(tab.getLastRow(), rowNum);
  var headerScan = tab.getRange(1, 1, Math.min(scanRows, 40), lastCol).getDisplayValues();
  var headerIdx = _cs_findReturnHeaderRow_(headerScan);
  if (headerIdx < 0) throw new Error("반품접수날짜 헤더 없음");

  var col = _cs_mapReturnLedgerCols_(headerScan[headerIdx]);
  var row = tab.getRange(rowNum, 1, 1, lastCol).getDisplayValues()[0];
  return { tab: tab, col: col, rowNum: rowNum, row: row, lastCol: lastCol };
}

/** 처리상태(A열) 변경 + 비고 이력 */
function updateReturnLedgerStatus(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var tabName = String(payload.tab || "").trim();
  var rowNum = parseInt(payload.row, 10);
  var status = String(payload.status || "").trim();
  var staff = String(payload.staff || "").trim();
  var retInvIn = String(payload.returnInvoice || "").trim();
  var phone2In = String(payload.phone2 || "").trim();
  var phone2NameIn = String(payload.phone2Name || "").trim().substring(0, 20);
  if (!tabName || !(rowNum > 0) || !status) {
    return { ok: false, error: "탭·행·상태가 필요합니다." };
  }
  try {
    var ctx = _cs_openReturnLedgerRow_(tabName, rowNum);
    if (ctx.col.status < 0) return { ok: false, error: "처리상태 열을 찾지 못했습니다." };

    var oldStatus = String(ctx.row[ctx.col.status] || "").trim();
    var notice = ctx.col.notice >= 0 ? String(ctx.row[ctx.col.notice] || "").trim() : "";
    var retInvSaved = "";

    // 반품송장 — 상태와 함께 넘어오면 같이 저장한다. 접수 시점엔 모르고
    // 나중에 수거 송장을 받는 게 보통이라 상태 변경과 같이 들어오는 게 자연스럽다.
    if (retInvIn) {
      var newDigits = retInvIn.replace(/[^0-9]/g, "");
      if (newDigits.length < 8) {
        return { ok: false, error: "반품송장은 숫자 8자리 이상이어야 합니다." };
      }
      var formatted = _cs_formatLedgerInvoice_(retInvIn);
      if (ctx.col.returnInvoice >= 0) {
        var curDigits = String(ctx.row[ctx.col.returnInvoice] || "").replace(/[^0-9]/g, "");
        if (curDigits !== newDigits) {
          ctx.tab.getRange(rowNum, ctx.col.returnInvoice + 1).setValue(formatted);
          retInvSaved = formatted;
        }
      } else if (ctx.col.notice >= 0) {
        // 전용 열이 없는 과거 탭 — 예전 방식대로 비고에 남긴다
        var fromNotice = _cs_parseReturnInvFromNotice_(notice).replace(/[^0-9]/g, "");
        if (fromNotice !== newDigits) {
          notice = _cs_appendNoticeLine_(notice, "반품송장: " + formatted);
          retInvSaved = formatted;
        }
      }
    }

    /* ★ 실번호 ★  (2026-09-11)
       > "반품 카드에서 상태 변경, 실전화번호, 반품송장번호를 입력할수 있게"
       「추가연락처」 열에 적는다 — 주 연락처(주문서의 안심번호)를 덮지 않는다.
       안심번호도 남아 있어야 쇼핑몰 자료와 맞춰 볼 수 있다.

       바뀐 때만 적고, 바뀐 때만 비고에 남긴다. 같은 값을 다시 저장했다고
       이력이 늘면 정작 «언제 알아냈나»를 못 읽는다. */
    var phone2Saved = "", phone2NameSaved = "";
    if (phone2In) {
      var p2new = phone2In.replace(/[^0-9]/g, "");
      if (p2new.length < 9) {
        return { ok: false, error: "전화번호가 짧습니다 (숫자 9자리 이상)." };
      }
      if (_cs_isSafePhone_(phone2In)) {
        return { ok: false, error: "실번호 칸에는 안심번호(050…) 말고 실제 번호를 넣어 주세요." };
      }
      if (ctx.col.phone2 < 0) {
        return { ok: false, error: "대장에 「추가연락처」 열이 없습니다. 열을 만들어 주세요." };
      }
      var p2cur = String(ctx.row[ctx.col.phone2] || "").replace(/[^0-9]/g, "");
      var nameCur = ctx.col.phone2Name >= 0
        ? String(ctx.row[ctx.col.phone2Name] || "").trim()
        : _cs_parseReturnPhone2NameFromNotice_(notice);
      if (p2cur !== p2new || phone2NameIn !== nameCur) {
        phone2Saved = _cs_formatLedgerPhone_(phone2In);
        ctx.tab.getRange(rowNum, ctx.col.phone2 + 1).setValue(phone2Saved);
        /* ★ 이름은 전용 열이 있으면 그 열에 ★
           없으면 비고에 «(이름)» 으로 남긴다 — 반품송장이 걸어온 길과 같다.
           나중에 시트에 「실번호 이름」 열을 만들면 코드를 안 고쳐도 옮겨 간다. */
        if (ctx.col.phone2Name >= 0) {
          ctx.tab.getRange(rowNum, ctx.col.phone2Name + 1).setValue(phone2NameIn);
        }
        notice = _cs_appendNoticeLine_(notice, _cs_ledgerStamp_(staff) + " 실번호 " + phone2Saved +
          (phone2NameIn ? " (" + phone2NameIn + ")" : ""));
        phone2NameSaved = phone2NameIn;
      }
    }

    /*  ★ 송장이 생겼으면 단계도 같이 간다 ★  (2026-09-20)
        여태 이 칸은 «송장만» 적었다. 그래서 회수 송장이 나간 뒤에도 카드가
        「접수」로 남아, 업체 화면에는 수거가 시작된 줄 모르고 있었다.
        사람이 상태를 한 번 더 바꿔 줘야 하는 일은 자동화가 아니다.  */
    if (retInvSaved && _cs_isBeforePickup_(status)) {
      status = _CS_STATUS_PICKUP_;
    }

    if (status !== oldStatus) {
      notice = _cs_appendNoticeLine_(notice, _cs_ledgerStamp_(staff) + " 상태→" + status);
      ctx.tab.getRange(rowNum, ctx.col.status + 1).setValue(status);
      if (_cs_isReturnDoneMark_(status)) {
        ctx.tab.getRange(rowNum, 1).setValue("완료");
      }
    }

    if (ctx.col.notice >= 0 && notice !== String(ctx.row[ctx.col.notice] || "").trim()) {
      ctx.tab.getRange(rowNum, ctx.col.notice + 1).setValue(notice);
    }

    csInvalidateReturnLedgerCache_();
    return {
      ok: true,
      status: status,
      notice: notice,
      returnInvoice: retInvSaved,
      phone2: phone2Saved,
      phone2Name: phone2NameSaved,
      message: tabName + " " + rowNum + "행 · " + status +
        (retInvSaved ? " · 반품송장 " + retInvSaved : "")
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** 반품대장 행 삭제 (전체 건 — CS앱 UI에서는 미사용, 점검용) */
function deleteReturnLedgerRow(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var tabName = String(payload.tab || "").trim();
  var rowNum = parseInt(payload.row, 10);
  if (!tabName || !(rowNum > 0)) {
    return { ok: false, error: "탭·행이 필요합니다." };
  }
  try {
    var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    var tab = ss.getSheetByName(tabName);
    if (!tab) return { ok: false, error: "탭 없음: " + tabName };

    var lastCol = Math.max(tab.getLastColumn(), 15);
    var scanRows = Math.max(tab.getLastRow(), rowNum);
    var headerScan = tab.getRange(1, 1, Math.min(scanRows, 40), lastCol).getDisplayValues();
    var headerIdx = _cs_findReturnHeaderRow_(headerScan);
    if (headerIdx < 0) return { ok: false, error: "반품접수날짜 헤더 없음" };
    if (rowNum <= headerIdx + 1) {
      return { ok: false, error: "헤더·양식 행은 삭제할 수 없습니다." };
    }

    var col = _cs_mapReturnLedgerCols_(headerScan[headerIdx]);
    var row = tab.getRange(rowNum, 1, 1, lastCol).getDisplayValues()[0];
    if (!_cs_returnLedgerRowHasData_(row, col)) {
      return { ok: false, error: "이미 비어 있는 행입니다." };
    }

    var name = col.name >= 0 ? String(row[col.name] || "").trim() : "";
    var item = col.item >= 0 ? String(row[col.item] || "").trim() : "";
    tab.deleteRow(rowNum);

    csInvalidateReturnLedgerCache_();
    return {
      ok: true,
      tab: tabName,
      row: rowNum,
      name: name,
      item: item,
      message: tabName + " " + rowNum + "행 삭제됨" + (name ? " · " + name : "")
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function _cs_normNoticeLine_(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** 진행 카드(비고 N열 이력 1줄) 삭제 — 오기재 상담·상태 이력 제거. M열 현재 상태는 유지 */
function deleteReturnTimelineEvent(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var tabName = String(payload.tab || "").trim();
  var rowNum = parseInt(payload.row, 10);
  var rawLine = String(payload.raw || "").trim();
  var lineIndex = payload.lineIndex;
  var kind = String(payload.kind || "").trim();
  if (!tabName || !(rowNum > 0)) {
    return { ok: false, error: "탭·행이 필요합니다." };
  }
  if (kind === "access") {
    return { ok: false, error: "접수 카드는 삭제할 수 없습니다." };
  }
  try {
    var ctx = _cs_openReturnLedgerRow_(tabName, rowNum);
    if (ctx.col.notice < 0) return { ok: false, error: "비고 열을 찾지 못했습니다." };

    var notice = String(ctx.row[ctx.col.notice] || "").trim();
    if (!notice) return { ok: false, error: "비고가 비어 있습니다." };

    var lines = notice.split(/\n/);
    var removed = false;

    if (lineIndex !== undefined && lineIndex !== null && lineIndex !== "") {
      var idx = parseInt(lineIndex, 10);
      if (!isNaN(idx) && idx >= 0 && idx < lines.length) {
        var at = String(lines[idx] || "").trim();
        if (at) {
          lines.splice(idx, 1);
          removed = true;
        }
      }
    }

    if (!removed && rawLine) {
      var normRaw = _cs_normNoticeLine_(rawLine);
      for (var i = 0; i < lines.length; i++) {
        if (_cs_normNoticeLine_(lines[i]) === normRaw) {
          lines.splice(i, 1);
          removed = true;
          break;
        }
      }
    }

    if (!removed) {
      return { ok: false, error: "대장에서 해당 이력 줄을 찾지 못했습니다. 새로고침 후 다시 시도하세요." };
    }

    var newNotice = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    ctx.tab.getRange(rowNum, ctx.col.notice + 1).setValue(newNotice);

    var status = ctx.col.status >= 0 ? String(ctx.row[ctx.col.status] || "").trim() : "";
    var staffVal = ctx.col.staff >= 0 ? String(ctx.row[ctx.col.staff] || "").trim() : "";
    var dateVal = ctx.col.date >= 0 ? String(ctx.row[ctx.col.date] || "").trim() : "";
    var typeVal = ctx.col.type >= 0 ? String(ctx.row[ctx.col.type] || "").trim() : "";
    var timeline = _cs_parseReturnTimeline_(newNotice, status, staffVal, dateVal, typeVal);

    csInvalidateReturnLedgerCache_();
    return {
      ok: true,
      notice: newNotice,
      timeline: timeline,
      message: "진행 카드(이력 1건) 삭제됨"
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** 상담 내용 N열 append */
function appendReturnConsultation(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var tabName = String(payload.tab || "").trim();
  var rowNum = parseInt(payload.row, 10);
  var text = String(payload.text || "").replace(/\s+/g, " ").trim();
  var staff = String(payload.staff || "").trim();
  if (!tabName || !(rowNum > 0)) {
    return { ok: false, error: "탭·행이 필요합니다." };
  }
  if (!text) return { ok: false, error: "상담 내용을 입력하세요." };
  try {
    var ctx = _cs_openReturnLedgerRow_(tabName, rowNum);
    if (ctx.col.notice < 0) return { ok: false, error: "비고 열을 찾지 못했습니다." };

    var notice = String(ctx.row[ctx.col.notice] || "").trim();
    notice = _cs_appendNoticeLine_(notice, _cs_ledgerStamp_(staff) + " " + text);
    ctx.tab.getRange(rowNum, ctx.col.notice + 1).setValue(notice);

    csInvalidateReturnLedgerCache_();
    return { ok: true, notice: notice, message: "상담 내용 추가됨" };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function _cs_isReturnDoneMark_(v) {
  var raw = String(v == null ? "" : v).trim();
  if (!raw) return false;
  var s = raw.replace(/\s/g, "");
  if (s === "완료" || s.indexOf("완료") === 0) return true;
  if (/이카운트\s*ok/i.test(raw)) return true;
  // 철회 — 고객이 반품을 취소한 건.
  //   2026-08-31 상태를 4개로 줄이면서 드롭다운에서 뺐지만 과거 행에는 남아 있다.
  //   여기서 완료로 쳐 주지 않으면 영원히 "진행 중"으로 떠 있는다.
  //   대장 값을 고치지 않고 판정만 바꾼다 — 되돌리기 쉽고 이력도 그대로 남는다.
  if (s === "철회" || s.indexOf("철회") === 0) return true;
  return false;
}

function _cs_isReturnLedgerDone_(status, row) {
  if (_cs_isReturnDoneMark_(status)) return true;
  if (row && _cs_isReturnDoneMark_(row[0])) return true; // A열 완료 표시
  return false;
}

function _cs_ledgerYmdFromCell_(raw) {
  var s = String(raw || "").trim();
  var m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return "20" + m[1] + m[2] + m[3];
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    return m[1] + ("0" + m[2]).slice(-2) + ("0" + m[3]).slice(-2);
  }
  return "";
}

function _cs_daysAgoYmd_(days) {
  var d = new Date();
  d.setDate(d.getDate() - (days || 0));
  return Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd");
}

function _cs_parseReturnInvFromNotice_(text) {
  var s = String(text || "");
  var m = s.match(/반품송장\s*[:：]\s*([0-9\-]+)/i);
  if (m) return String(m[1] || "").trim();
  m = s.match(/회수송장\s*[:：]\s*([0-9\-]+)/i);
  if (m) return String(m[1] || "").trim();
  return "";
}

/**
 * 비고에 남긴 실번호 주인 이름을 읽는다.
 *
 * ★ 전용 열이 있으면 그 열이 먼저다. 이건 «없을 때»의 길이다 ★
 *   반품송장이 걸어온 길과 같다 — 시트에 「실번호 이름」 열을 만들면
 *   코드를 안 고쳐도 그쪽으로 옮겨 간다.
 *
 * ★ «마지막» 것을 쓴다 ★
 *   비고는 쌓이는 자리다. 나중에 바로잡은 이름이 뒤에 붙으므로
 *   첫 줄을 집으면 고친 것이 안 보인다.
 *   (반품송장 파서는 첫 줄을 집는다 — 거긴 번호가 안 바뀌어서 그렇다.)
 */
function _cs_parseReturnPhone2NameFromNotice_(text) {
  var s = String(text || "");
  /* ※ 역슬래시(\n)를 안 쓴다 — 이 파일을 스크립트로 고칠 때
       역슬래시가 조용히 먹혀 정규식이 쪼개진 사고가 실제로 났다.
       줄바꿈은 문자코드로 만들어 붙인다. */
  var NLCH = String.fromCharCode(10);
  var re = new RegExp('실번호[^()' + NLCH + ']*[(（]([^)）' + NLCH + ']{1,20})[)）]', 'g');
  var m, last = "";
  while ((m = re.exec(s))) last = String(m[1] || "").trim();
  return last;
}

function _cs_returnLedgerRowHasData_(row, col) {
  if (!row) return false;
  var keys = [col.date, col.name, col.item, col.phone, col.invoice, col.status];
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] < 0) continue;
    var v = String(row[keys[i]] || "").trim();
    if (v && v !== "-") return true;
  }
  return false;
}

function _cs_returnLedgerMonthsToScan_(days) {
  days = days || 30;
  var months = Math.max(2, Math.ceil(days / 28) + 1);
  var out = [];
  var d = new Date();
  for (var i = 0; i < months; i++) {
    var mk = Utilities.formatDate(d, "Asia/Seoul", "yyyyMM");
    if (out.indexOf(mk) < 0) out.push(mk);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function _cs_readReturnLedgerTabCases_(tab, tabName, cutoffYmd, activeOnly) {
  if (!tab) return [];
  var lastCol = Math.max(tab.getLastColumn(), 15);
  var lastRow = tab.getLastRow();
  // ★ 2026-09-01 수정 ★
  //   전에는 `lastRow < 5` 였다. 헤더가 4행에 있다는 가정에서 나온 숫자인데,
  //   새로 만들어지는 월별 탭은 헤더가 1행이다. 그래서 월이 바뀐 첫날
  //   "접수는 되는데 조회가 안 되는" 증상이 났다 — 헤더 1행 + 데이터 1행이면
  //   lastRow 가 2라서 읽어보지도 않고 빈 배열을 돌려줬다.
  //   헤더 위치는 아래 _cs_findReturnHeaderRow_ 가 알아서 찾으므로
  //   여기서는 "헤더 + 데이터 최소 1행"만 확인하면 된다.
  if (lastRow < 2) return [];

  var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headerIdx = _cs_findReturnHeaderRow_(values);
  if (headerIdx < 0) return [];

  var header = values[headerIdx];
  var col = _cs_mapReturnLedgerCols_(header);
  var out = [];

  for (var ri = headerIdx + 1; ri < values.length; ri++) {
    var row = values[ri];
    if (!_cs_returnLedgerRowHasData_(row, col)) continue;

    var dateYmd = _cs_ledgerYmdFromCell_(col.date >= 0 ? row[col.date] : "");
    if (cutoffYmd && dateYmd && dateYmd < cutoffYmd) continue;

    var status = String(row[0] || "").trim();
    var doneFlag = status;
    var done = _cs_isReturnLedgerDone_(status, row);
    if (activeOnly && done) continue;

    var notice = col.notice >= 0 ? String(row[col.notice] || "").trim() : "";
    // 반품송장은 전용 열이 우선이다. 열이 없거나 비어 있으면 과거 방식(N열 비고
    // "반품송장: …" 한 줄)에서 읽는다. 이관 전 데이터가 그대로 살아 있어야 한다.
    var returnInvCell = col.returnInvoice >= 0 ? String(row[col.returnInvoice] || "").trim() : "";
    var returnInv = returnInvCell || _cs_parseReturnInvFromNotice_(notice);
    var invRaw = col.invoice >= 0 ? String(row[col.invoice] || "").trim() : "";
    var invDigits = invRaw.replace(/[^0-9]/g, "");
    var retDigits = returnInv.replace(/[^0-9]/g, "");
    var phoneRaw = col.phone >= 0 ? String(row[col.phone] || "").trim() : "";
    var phone2Raw = col.phone2 >= 0 ? String(row[col.phone2] || "").trim() : "";
    var ph = _cs_pickPhones_(phoneRaw, phone2Raw);
    /* 실번호 주인 — 전용 열이 먼저, 없으면 비고에서 */
    var phone2Name = col.phone2Name >= 0 ? String(row[col.phone2Name] || "").trim() : "";
    if (!phone2Name) phone2Name = _cs_parseReturnPhone2NameFromNotice_(notice);
    var staffVal = col.staff >= 0 ? String(row[col.staff] || "").trim() : "";
    var dateVal = col.date >= 0 ? String(row[col.date] || "").trim() : "";
    var typeVal = col.type >= 0 ? String(row[col.type] || "").trim() : "";

    out.push({
      tab: tabName,
      row: ri + 1,
      date: dateVal,
      dateYmd: dateYmd,
      staff: staffVal,
      vendor: col.vendor >= 0 ? String(row[col.vendor] || "").trim() : "",
      name: col.name >= 0 ? String(row[col.name] || "").trim() : "",
      /* 걸 수 있는 번호가 phone 이다 — 화면은 이것만 크게 쓴다 */
      phone: _cs_formatLedgerPhone_(ph.main),
      phoneTag: ph.mainTag,
      phoneSub: ph.sub ? _cs_formatLedgerPhone_(ph.sub) : "",
      phoneSubTag: ph.subTag,
      phoneOnlySafe: ph.onlySafe,
      phone2Name: phone2Name,
      /* ★ 찾기는 둘 다 걸려야 한다 ★
         고객이 주문서에 적힌 안심번호를 대고 전화할 수도, 직원이 실번호로
         찾을 수도 있다. 보여 주는 번호만 색인하면 나머지로는 못 찾는다. */
      phoneDigits: _cs_phoneDigits_(phoneRaw),
      phone2Digits: _cs_phoneDigits_(phone2Raw),
      item: col.item >= 0 ? String(row[col.item] || "").trim() : "",
      qty: col.qty >= 0 ? String(row[col.qty] || "").trim() : "",
      invoice: invRaw,
      invDigits: invDigits,
      returnInvoice: returnInv,
      returnInvDigits: retDigits,
      returnInvFromCol: !!returnInvCell,
      type: typeVal,
      /* ★ 사유는 «구분»과 다르다 ★  (2026-09-18)
         구분(type) 은 「재출고/단순/오배송」처럼 처리하는 갈래고,
         사유(reason) 는 「뚜껑 깨짐」처럼 왜 반품인지다. 상담에서
         먼저 묻는 것은 «왜»다. 같으면 카드가 한 번만 보여 준다. */
      reason: col.reason >= 0 ? String(row[col.reason] || "").trim() : "",
      /* ★ 업체가 새로 올린 건데 CS 가 아직 안 본 것 ★  (2026-09-18)
         이 값 하나로 화면이 «맨 위 + 하이라이트»를 정한다.
         판정은 _cs_needsCsCheck_ 한 곳에서만 한다 — 두 곳에서 따로
         세면 화면과 숫자가 어긋난다. */
      needsCheck: _cs_needsCsCheck_(staffVal, notice, status),
      /* ★ 출처 ★  (2026-09-20)
         업체 포털이 접수할 때 그 업체 장부에서 주문을 찾았는지를 비고 첫 줄에
         적어 둔다. 「미확인·어긋남」이면 다른 업체 물건이 섞였을 수 있다 —
         사진으로 먼저 보라는 뜻이다. 판정은 포털이 하고 여기서는 읽기만 한다. */
      origin: _cs_returnOrigin_(notice),
      status: status,
      doneFlag: doneFlag,
      notice: notice,
      pickup: col.pickup >= 0 ? String(row[col.pickup] || "").trim() : "",
      fee: col.fee >= 0 ? _cs_formatReturnFee_(row[col.fee]) : "",
      feeRaw: col.fee >= 0 ? String(row[col.fee] == null ? "" : row[col.fee]).trim() : "",
      active: !done,
      timeline: _cs_parseReturnTimeline_(notice, status, staffVal, dateVal, typeVal),
      sortKey: (dateYmd || "00000000") + "_" + String(100000 - ri)
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════
 *  반품대장 읽기 — «월 탭 하나를 한 번만» 읽는다   (2026-09-17)
 *
 *  > "속도가 느려서 그래"
 *
 *  ★ 느렸던 까닭 둘 ★
 *
 *  ① 한 번 띄울 때 같은 탭을 «열한 번» 읽었다.
 *     csListActiveReturnCases 가 (30일·진행만) 과 (30일·전부) 를 잇달아
 *     부른다. 캐시 열쇠에 activeOnly 가 들어 있어 «다른 열쇠»라 두 번 다
 *     시트를 읽었다. 코드 주석에는 「동일 캐시 키라 추가 부담이 적다」고
 *     적혀 있었는데 사실이 아니었다.
 *     거기에 뱃지 색인이 (90일·전부) 를 또 부른다.
 *     월 탭으로 치면  3 + 3 + 5 = 열한 번이다.
 *
 *  ② 캐시가 «아예 안 먹고» 있었다.
 *     CacheService 한 칸은 100KB 까지다. 90일치를 통째로 한 칸에 넣으면
 *     넘쳐서 put 이 던지는데, 그 try 는 조용히 삼킨다.
 *     그래서 열한 번을 «매번» 다시 읽었다. 조용히.
 *
 *  ★ 그래서 ★
 *    · 월 탭을 «자르지 않고» 통째로 캐시한다. 날짜·진행 여부는 메모리에서
 *      거른다 — 30일치는 90일치가 읽어 둔 것을 그대로 쓴다
 *    · 캐시는 조각내어 넣는다. 넘쳐서 조용히 안 먹는 일이 없게
 *    · 한 실행 안에서는 같은 탭을 두 번 읽지 않는다 (새로고침이어도)
 * ══════════════════════════════════════════════════════════════ */

/*  한글은 UTF-8 에서 한 글자가 3바이트다. 100KB 한도에 안 걸리게
    글자 수로 2만씩 자른다 — 최악(전부 한글)이어도 60KB다.  */
var _CS_RET_CHUNK_ = 20000;

/** 한 실행 안에서 이미 읽은 월 탭 (GAS 전역은 실행이 끝나면 사라진다) */
var _CS_RET_TAB_MEMO_ = {};

function _cs_retCachePut_(cache, key, obj, ttl) {
  var s;
  try { s = JSON.stringify(obj); } catch (e) { return false; }
  var n = Math.ceil(s.length / _CS_RET_CHUNK_) || 1;
  var map = {};
  for (var i = 0; i < n; i++) {
    map[key + "_" + i] = s.substring(i * _CS_RET_CHUNK_, (i + 1) * _CS_RET_CHUNK_);
  }
  /*  조각을 다 넣은 «뒤»에 개수를 넣는다 — 개수가 먼저 보이면
      아직 없는 조각을 읽으러 간다. 어차피 한 번에 나가지만 뜻을 남긴다.  */
  map[key + "_n"] = String(n);
  try { cache.putAll(map, ttl); return true; } catch (e2) { return false; }
}

function _cs_retCacheGet_(cache, key) {
  try {
    var nRaw = cache.get(key + "_n");
    if (!nRaw) return null;
    var n = parseInt(nRaw, 10);
    if (!(n > 0)) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + "_" + i);
    var got = cache.getAll(keys) || {};
    var s = "";
    for (var j = 0; j < n; j++) {
      var part = got[key + "_" + j];
      /*  ★ 한 조각만 없어도 통째로 버린다 ★
          조각은 저마다 따로 말라 죽을 수 있다. 있는 것만 이어 붙이면
          JSON 이 깨지거나 — 더 나쁘게는 «일부만 맞는 표»가 된다.
          반쪽짜리 반품 목록은 없는 것보다 나쁘다.  */
      if (part === null || part === undefined) return null;
      s += part;
    }
    var out = JSON.parse(s);
    return (out && out.length !== undefined) ? out : null;
  } catch (e) { return null; }
}

/**
 * 월 탭 캐시 열쇠. 세대 번호가 들어가므로 접수 한 번이면 «통째로» 무효가 된다.
 * 열쇠 규칙은 여기 한 곳에만 둔다 — 손으로 적은 키 목록이 다시 생기면
 * 그때 못 지운 것만 조용히 살아남는다 (csInvalidateReturnLedgerCache_ 주석 참고).
 */
function _cs_returnTabCacheKey_(gen, tabName) {
  return _CS_RETURN_CACHE_VER_ + "t" + String(gen || "1") + "_" + String(tabName || "");
}

/** 월 탭 하나 — 자르지 않은 전부. 캐시는 이 단위로만 잡는다. */
function _cs_loadReturnLedgerTabRows_(ss, tabName, refresh) {
  var gen = "1";
  try {
    gen = PropertiesService.getScriptProperties().getProperty(_CS_RETURN_GEN_PROP_) || "1";
  } catch (e) {}

  /*  ★ 실행 안 기억이 맨 앞이다 ★ 새로고침이어도 한 실행에서 같은 탭을
      두 번 읽을 까닭은 없다. 이것이 «열한 번»을 막는 마지막 문이다.  */
  var memoKey = gen + "|" + tabName;
  if (_CS_RET_TAB_MEMO_[memoKey]) return _CS_RET_TAB_MEMO_[memoKey];

  var cache = CacheService.getScriptCache();
  var ck = _cs_returnTabCacheKey_(gen, tabName);
  if (!refresh) {
    var hit = _cs_retCacheGet_(cache, ck);
    if (hit) { _CS_RET_TAB_MEMO_[memoKey] = hit; return hit; }
  }

  var tab = ss.getSheetByName(tabName);
  if (!tab) return [];
  //  자르지 않고 읽는다 — 30일치도 90일치도 이 하나로 만든다
  var rows = _cs_readReturnLedgerTabCases_(tab, tabName, "", false);
  _cs_retCachePut_(cache, ck, rows, _CS_RETURN_CACHE_TTL_);
  _CS_RET_TAB_MEMO_[memoKey] = rows;
  return rows;
}

function _cs_loadReturnLedgerCases_(days, activeOnly, refresh) {
  days = days || 30;
  activeOnly = !!activeOnly;

  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var monthKeys = _cs_returnLedgerMonthsToScan_(days);
  var monthTabs = _cs_listReturnLedgerMonthTabs_(ss);
  var cutoffYmd = _cs_daysAgoYmd_(days);
  var all = [];

  for (var mi = 0; mi < monthKeys.length; mi++) {
    var mk = monthKeys[mi];
    if (monthTabs.indexOf(mk) < 0 && !ss.getSheetByName(mk)) continue;
    var chunk = _cs_loadReturnLedgerTabRows_(ss, mk, refresh);
    for (var ci = 0; ci < chunk.length; ci++) {
      var r = chunk[ci];
      /*  «읽을 때» 하던 거르기를 여기서 똑같이 한다.
          _cs_readReturnLedgerTabCases_ 의 두 줄과 글자 그대로 같아야 한다 —
          하나라도 어긋나면 목록이 조용히 달라진다.  */
      if (cutoffYmd && r.dateYmd && r.dateYmd < cutoffYmd) continue;
      if (activeOnly && !r.active) continue;
      all.push(r);
    }
  }

  all.sort(function(a, b) {
    return String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
  });
  return all;
}

/** CS앱 — 진행 중 반품 목록 (최근 30일, 완료·이카운트ok 제외) */
function csListActiveReturnCases(opt) {
  opt = opt || {};
  var days = parseInt(opt.days, 10) || 30;
  var refresh = !!opt.refresh;
  try {
    var rows = _cs_loadReturnLedgerCases_(days, true, refresh);

    // 접수 건수는 완료된 건도 세야 맞다. 진행 목록(rows)은 완료건이 빠져 있어
    // 같은 기간의 전체 목록을 따로 본다 (동일 캐시 키라 추가 부담이 적다).
    var allRows = _cs_loadReturnLedgerCases_(days, false, refresh);
    var todayYmd = _cs_daysAgoYmd_(0);
    var ydayYmd = _cs_daysAgoYmd_(1);
    var intakeToday = 0, intakeYesterday = 0;
    for (var i = 0; i < allRows.length; i++) {
      var ymd = String(allRows[i].dateYmd || "");
      if (ymd === todayYmd) intakeToday++;
      else if (ymd === ydayYmd) intakeYesterday++;
    }

    return {
      ok: true,
      days: days,
      count: rows.length,
      rows: rows,
      intakeToday: intakeToday,
      intakeYesterday: intakeYesterday,
      statusOptions: _CS_RETURN_STATUS_OPTS_
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e), rows: [] };
  }
}

/** CS앱 — 주문검색 뱃지용 인덱스 (진행+최근완료 90일) */
function csGetReturnLedgerBadgeIndex(opt) {
  opt = opt || {};
  var refresh = !!opt.refresh;
  try {
    var active = _cs_loadReturnLedgerCases_(30, true, refresh);
    var allRecent = _cs_loadReturnLedgerCases_(_CS_RETURN_BADGE_DAYS_, false, refresh);
    var slim = [];
    for (var i = 0; i < allRecent.length; i++) {
      var r = allRecent[i];
      /* 주문 카드 옆 뱃지 하나를 그리는 데 필요한 만큼만 싣는다.
         상담이력(timeline)은 뺀다 — 90일치면 몇 배로 무거워진다.
         눌러서 펼칠 때 csGetReturnCaseAt 이 그 한 건만 가져온다. */
      slim.push({
        /*  서버가 쓰는 정렬 열쇠를 그대로 실어 보낸다 (dateYmd_역순번).
            화면에서 「오래된순」을 고를 때 날짜를 다시 파싱하지 않게 —
            차례를 정하는 규칙이 두 군데로 갈리면 반드시 어긋난다. */
        sortKey: r.sortKey,
        invDigits: r.invDigits,
        returnInvDigits: r.returnInvDigits,
        phoneDigits: r.phoneDigits,
        name: r.name,
        status: r.status,
        active: r.active,
        tab: r.tab,
        row: r.row,
        stage: _cs_returnStage_(r.status, r.active),
        photos: _cs_returnPhotoCount_(r.timeline),
        date: r.date,
        item: r.item,
        qty: r.qty,
        phone: r.phone,
        invoice: r.invoice,
        returnInvoice: r.returnInvoice,
        staff: r.staff,
        vendor: r.vendor,
        type: r.type,
        reason: r.reason,   // 2026-09-18 — 여기 안 실으면 카드까지 못 간다
        needsCheck: r.needsCheck,
        origin: r.origin,   // 2026-09-20 — 여기 안 실으면 카드까지 못 간다
        fee: r.fee
      });
    }
    return {
      ok: true,
      activeCount: active.length,
      count: slim.length,
      rows: slim,
      cacheVer: _CS_RETURN_CACHE_VER_
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e), rows: [] };
  }
}

/**
 * 반품 한 건 전체 (상담이력 포함) — 주문검색에서 뱃지를 눌렀을 때.
 * ★ 2026-09-07 신규
 *
 * 진행 중인 건은 화면의 「진행 반품」 목록에 이미 있으므로 서버를 부르지 않는다.
 * 이 함수가 필요한 건 **완료됐거나 30일보다 오래된 건**이다 — 목록에 없는 것들.
 * "이 주문 예전에 반품된 적 있었나"에 답하려면 그것도 열려야 한다.
 *
 * 시트를 새로 읽지 않는다. 뱃지 인덱스가 이미 채워 둔 캐시를 그대로 탄다.
 */
function csGetReturnCaseAt(opt) {
  opt = opt || {};
  var tabName = String(opt.tab || "").trim();
  var rowNum = parseInt(opt.row, 10);
  if (!tabName || !(rowNum > 0)) return { ok: false, error: "반품 위치가 없습니다" };
  try {
    var rows = _cs_loadReturnLedgerCases_(_CS_RETURN_BADGE_DAYS_, false, !!opt.refresh) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].tab === tabName && rows[i].row === rowNum) {
        return { ok: true, row: rows[i] };
      }
    }
    return {
      ok: false,
      error: "대장에서 그 건을 찾지 못했습니다 (" + tabName + " " + rowNum + "행)"
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * 반품대장 캐시 무효화 (기록 후 호출)
 *
 * 캐시 키에는 `days` 와 `activeOnly` 가 들어가는데 CacheService 는 키를
 * 열거할 수 없다. 종전에는 `30_A·30_X·90_A·90_X` 네 개를 손으로 지웠고,
 * 그래서 **`csFindReturnIntakeMatches` 가 쓰는 `days=60` 은 10분간 남았다.**
 * 방금 접수한 건을 스캔이 못 찾고 새 행을 또 만드는 경로다.
 *
 * 세대 번호를 키에 넣어 값 하나만 올리면 `days` 가 몇이든 통째로 무효화된다.
 * 새 `days` 옵션을 추가할 때 여기를 같이 고칠 필요가 없다.
 */
function csInvalidateReturnLedgerCache_() {
  try {
    var p = PropertiesService.getScriptProperties();
    var g = parseInt(p.getProperty(_CS_RETURN_GEN_PROP_) || "1", 10);
    if (!(g > 0)) g = 1;
    p.setProperty(_CS_RETURN_GEN_PROP_, String(g + 1));
  } catch (e) {
    Logger.log("[RETURN_LEDGER] 캐시 세대 증가 실패: " + e.message);
  }
}

/**
 * 특정 날짜의 건수가 왜 그렇게 나오는지 캐낸다.
 * 파일: csOrderSearch.gs  ★ 2026-09-02 신규
 *
 * 대시보드는 통합조회(또는 일일마감 폴백)로 만든 인덱스를 날짜별로 세는데,
 * 날짜를 못 읽은 행은 date:"" 로 들어가 어느 날짜 버킷에도 안 걸린다.
 * 즉 데이터는 있는데 집계에서만 조용히 빠진다. 그 차이를 눈으로 보게 한다.
 *
 * @param {string} dateStr "2026-09-01" (비우면 어제)
 */
function csDiagnoseDayCount(dateStr) {
  var out = { date: "", unified: {}, daily: {}, verdict: "", hint: "" };

  dateStr = String(dateStr || "").trim();
  if (!dateStr) {
    var y = new Date();
    y.setDate(y.getDate() - 1);
    dateStr = Utilities.formatDate(y, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  out.date = dateStr;

  // ── 검색 인덱스 쪽 (원장 또는 일일마감) ──  (2026-09-16 통합조회 지움)
  try {
    var uv = { rows: _cs_loadSearchIndex_(_CS_DAILY_DAYS_DEFAULT_, false).rows };
    var onDate = 0, blank = 0, byDate = {};
    for (var i = 0; i < uv.rows.length; i++) {
      var d = String(uv.rows[i].date || "");
      if (!d) blank++;
      else {
        byDate[d] = (byDate[d] || 0) + 1;
        if (d === dateStr) onDate++;
      }
    }
    out.unified = {
      사용중: uv.found,
      전체행: uv.rows.length,
      해당날짜: onDate,
      날짜없는행: blank,
      갱신시각: uv.updatedAt || "",
      오류: uv.error || "",
      날짜별: byDate,
    };
  } catch (eU) {
    out.unified = { 오류: eU.message };
  }

  // ── 일일마감 파일 쪽 (캐시 무시하고 새로 읽는다) ──
  try {
    var day = _cs_loadDay_(dateStr, true, false);
    out.daily = {
      파일찾음: day.found,
      행수: (day.rows || []).length,
      오류: day.error || "",
    };
  } catch (eD) {
    out.daily = { 오류: eD.message };
  }

  var u = out.unified.해당날짜 || 0;
  var f = out.daily.행수 || 0;
  out.verdict = "통합조회 " + u + "건 · 일일마감 파일 " + f + "건";
  if (out.unified.날짜없는행) {
    out.hint = "★ 통합조회에 날짜를 못 읽은 행이 " + out.unified.날짜없는행 +
      "건 있다. 이 행들은 대시보드 날짜 집계에서 통째로 빠진다 — " +
      "통합조회 시트의 날짜 열 서식(텍스트/빈칸)을 확인할 것.";
  } else if (f > u) {
    out.hint = "일일마감 파일이 " + (f - u) + "건 더 많다. 통합조회가 그만큼 " +
      "덜 담고 있다는 뜻이다 — 허브의 통합조회 갱신이 늦었거나 일부 출처가 빠졌다.";
  } else {
    out.hint = "두 쪽 건수가 비슷하다. 대시보드가 다르게 보인다면 브라우저에 " +
      "남은 옛 인덱스(localStorage) 문제일 수 있다.";
  }

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * 대시보드용 날짜별 건수 — **일일마감 파일에서 바로 센다.**
 * 파일: csOrderSearch.gs  ★ 2026-09-10 신규
 *
 * > "갯수는.. 일일마감을 기준으로 하면 좋겠어 통합조회는 왜 하는지 모르겠네.."
 *
 * ★ 통합조회를 왜 안 보나 ★
 *   통합조회는 **검색을 빠르게 하려고** 만든 한 장짜리 사본이다. 이름·전화로
 *   찾을 때 열흘치 마감 파일을 열 개 여는 대신 탭 하나만 읽게 하는 것,
 *   그게 그 탭의 존재 이유다. 그런데 사본은 원본과 어긋날 수 있다 —
 *   2026-09-09 은 마감 파일에 702행이 있는데 통합조회엔 109행뿐이었다.
 *   **세는 자리에서는 사본을 볼 이유가 없다.** 원본을 센다.
 *   (검색은 그대로 통합조회를 쓴다. 행 전체가 필요해 값이 다르다.)
 *
 * ★ 주말·공휴일은 자리를 안 준다 ★
 *   토·일은 요일로 뺀다 — 확실하고 공짜다.
 *   공휴일은 표를 두지 않는다. **마감을 안 돌린 날은 파일이 없다**는
 *   사실 하나로 판별한다. 표를 두면 해마다 사람이 고쳐야 하고,
 *   안 고치면 조용히 틀린다.
 *
 * ★ 없는 파일을 찾는 것이 제일 비싸다 ★
 *   못 찾으면 폴더를 통째로 훑는다 (_cs_findDailyFile_). 그래서 주말을
 *   먼저 걸러 내는 것이 그냥 예쁘게 보이려는 것이 아니라 실제로 값을 아낀다.
 *   찾은 날은 _cs_loadDay_ 가 캐시에 담아 두므로 두 번째부터는 싸다.
 *
 * @param {number=} days 거슬러 볼 영업일 수 (기본 10)
 * @return {{ok:boolean, days:Array, skipped:Array, ms:number}}
 *   days[i] = { date, rows, noInv, gapBefore }
 *     gapBefore — 이 날 앞에 건너뛴 날(주말·마감없음)이 몇이나 되나.
 *                 화면은 그 자리에 얇은 줄 하나만 긋는다.
 */
function csDailyDashCounts(days) {
  var t0 = Date.now();
  var want = Math.max(1, Math.min(31, parseInt(days, 10) || _CS_DAILY_DAYS_DEFAULT_));
  var out = { ok: true, days: [], skipped: [], ms: 0 };

  /* 대시보드는 **어제**를 마지막으로 삼는다 (오늘 출고는 20시 마감 뒤라야
     온전하다). home.html shipDateList 와 같은 시작점이다. */
  var d = new Date();
  d.setDate(d.getDate() - 1);

  var gap = 0;
  var guard = 0;
  while (out.days.length < want && guard < 80) {
    guard++;
    var ymd = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
    var dow = d.getDay();   // 0=일 6=토
    d.setDate(d.getDate() - 1);

    if (dow === 0 || dow === 6) {
      out.skipped.push({ date: ymd, why: "주말" });
      gap++;
      continue;
    }

    var day;
    try {
      day = _cs_loadDay_(ymd, false, false);
    } catch (e) {
      out.skipped.push({ date: ymd, why: "읽기실패 · " + e.message });
      gap++;
      continue;
    }

    if (!day.found) {
      //  마감을 안 돌린 날 — 공휴일이거나 쉰 날이다. 0 막대를 그리지 않는다.
      out.skipped.push({ date: ymd, why: "마감 없음" });
      gap++;
      continue;
    }

    var rows = day.rows || [];
    var noInv = 0;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].invDigits || "").replace(/[^0-9]/g, "").length < 8) noInv++;
    }
    /* ★ 건너뛴 날은 «바로 앞서 담은 날»의 것이다 ★  (2026-09-10 바로잡음)
       여기는 최신에서 과거로 걷는다. 08-31 을 담고 → 주말 둘을 건너뛰고 →
       08-28 을 담는 순서다. 그런데 화면은 왼쪽이 오래된 날이라, 그 주말은
       **08-28 다음(오른쪽)** 에 와야 한다 — 즉 먼저 담은 08-31 의 몫이다.
       처음엔 지금 담는 날에 붙였더니 줄이 한 칸 왼쪽으로 밀려
       09-03 과 09-04 사이에 그어졌다. 실제로 화면에서 그렇게 보였다. */
    if (gap && out.days.length) out.days[out.days.length - 1].gapBefore = gap;
    gap = 0;
    out.days.push({ date: ymd, rows: rows.length, noInv: noInv, gapBefore: 0 });
  }

  //  최신이 마지막에 오게 뒤집는다 — 막대는 왼쪽이 오래된 날이다
  out.days.reverse();
  if (out.days.length) out.days[0].gapBefore = 0;   // 맨 앞의 줄은 뜻이 없다
  out.ms = Date.now() - t0;
  return out;
}

/**
 * 대시보드 막대가 왜 그 숫자인지 — 인자 없이 한 번에 본다.
 * 파일: csOrderSearch.gs  ★ 2026-09-10 신규
 *
 * ★ 왜 또 만드나 ★
 *   csDiagnoseDayCount(dateStr) 가 이미 같은 일을 하는데 **편집기 ▶ 실행은
 *   인자를 못 넘긴다.** 날짜를 손으로 넣으려면 코드를 고쳐야 하고, 그러면
 *   급할 때 안 쓴다. 인자 없는 문을 따로 낸다.
 *
 * ★ 무엇을 보여 주나 ★
 *   ① 통합조회가 날짜별로 몇 건을 들고 있나 — **대시보드 막대와 같은 수**다.
 *   ② 그중 날짜를 못 읽은 행이 몇 건인가 — 이 행들은 막대에서 통째로 빠진다.
 *   ③ 어제 날짜에 대해 일일마감 **파일**은 몇 건인가.
 *   ④ 통합조회가 마지막으로 갱신된 시각.
 *
 *   ①과 ③을 나란히 보면 갈린다:
 *     ③ ≫ ① 이면 통합조회가 덜 담은 것 (재생성이 늦었거나 빠졌다).
 *     ① ≈ ③ 인데 화면만 적으면 브라우저에 남은 옛 인덱스다.
 *     ②가 크면 자료는 있는데 날짜를 못 읽어 집계에서 빠지는 것이다.
 *
 * ★ 캐시를 무시하고 새로 읽는다 ★
 *   지금 시트에 무엇이 들어 있는지를 묻는 자리다. 캐시된 값을 보여 주면
 *   물어본 것과 다른 것을 답하게 된다.
 */
function csDiagnoseDashboardDays() {
  var out = { 어제날짜: "", 통합조회: {}, 어제파일: {}, 판정: "", 다음: "" };

  /* 대시보드는 **어제**를 마지막 막대로 삼는다 (home.html shipDateList 는
     오늘이 아니라 어제부터 센다). 그래서 물어볼 날짜도 어제다. */
  var y = new Date();
  y.setDate(y.getDate() - 1);
  var yStr = Utilities.formatDate(y, Session.getScriptTimeZone(), "yyyy-MM-dd");
  out.어제날짜 = yStr;

  try {
    var uv = { rows: _cs_loadSearchIndex_(_CS_DAILY_DAYS_DEFAULT_, false).rows };
    var byDate = {}, blank = 0, noInv = 0;
    for (var i = 0; i < uv.rows.length; i++) {
      var r = uv.rows[i];
      var d = String(r.date || "");
      if (!d) blank++;
      else byDate[d] = (byDate[d] || 0) + 1;
      if (String(r.invDigits || "").replace(/[^0-9]/g, "").length < 8) noInv++;
    }
    out.통합조회 = {
      사용중: uv.found,
      전체행: uv.rows.length,
      날짜별: byDate,
      날짜없는행: blank,
      송장미확인: noInv,
      갱신시각: uv.updatedAt || "",
      오류: uv.error || ""
    };
  } catch (eU) {
    out.통합조회 = { 오류: eU.message };
  }

  try {
    var day = _cs_loadDay_(yStr, true, false);
    out.어제파일 = { 파일찾음: day.found, 행수: (day.rows || []).length, 오류: day.error || "" };
  } catch (eD) {
    out.어제파일 = { 오류: eD.message };
  }

  var u = (out.통합조회.날짜별 || {})[yStr] || 0;
  var f = out.어제파일.행수 || 0;
  out.판정 = "어제(" + yStr + ") — 통합조회 " + u + "건 · 일일마감 파일 " + f + "건";

  if (out.통합조회.날짜없는행) {
    out.다음 = "★ 통합조회에 날짜를 못 읽은 행이 " + out.통합조회.날짜없는행 +
      "건 있다. 이 행들은 막대에서 통째로 빠진다 — 통합조회 날짜 열 서식을 볼 것.";
  } else if (f - u > 30 && f > u * 1.5) {
    out.다음 = "일일마감 파일이 " + (f - u) + "건 더 많다. 통합조회가 그만큼 덜 담았다 — " +
      "메뉴 「🩹 통합조회 하루치 채우기」로 " + yStr + " 을 지정해 넣거나, " +
      "「🗂️ 통합조회 재생성」을 다시 돌린다.";
  } else {
    out.다음 = "두 쪽이 비슷하다. 그런데도 대시보드가 적게 보이면 브라우저에 남은 " +
      "옛 인덱스다 — 대시보드 오른쪽 위 ↻ 갱신을 누르거나 새로고침한다.";
  }

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * 일일마감 파일이 실제로 어디에 어떤 이름으로 있는지 훑는다.
 * 파일: csOrderSearch.gs  ★ 2026-09-02 신규
 *
 * csDiagnoseDayCount 가 "파일찾음: false" 를 냈을 때, 파일이 정말 없는 건지
 * 이름·위치가 어긋난 건지 구분하려고 만든다. CS앱은 「일일마감_(YYYY-MM-DD)」
 * 이라는 정확한 이름으로만 찾으므로, 한 글자만 달라도 못 본다.
 */
function csListDailyFiles() {
  var out = { 폴더ID점검: [], 폴더: [], 찾는이름형식: _CS_DAILY_PREFIX_ + "(YYYY-MM-DD)", 파일: [] };

  /* 어느 ID 가 왜 안 열리는지 먼저 본다.
     _cs_dailyFolders_ 는 열기 실패를 catch{continue} 로 조용히 삼키기 때문에,
     전부 실패해도 "폴더 0곳"이라는 결과만 남고 이유가 안 보인다. */
  var probe = [];
  try {
    var pid = String(
      PropertiesService.getScriptProperties().getProperty("UNIFIED_DAILY_ARCHIVE_FOLDER_ID") || ""
    ).trim();
    probe.push({ 출처: "스크립트속성 UNIFIED_DAILY_ARCHIVE_FOLDER_ID", id: pid });
  } catch (eP) {
    probe.push({ 출처: "스크립트속성", id: "", 결과: "읽기실패 · " + eP.message });
  }
  for (var p = 0; p < _CS_DAILY_FOLDER_IDS_.length; p++) {
    probe.push({ 출처: "코드 _CS_DAILY_FOLDER_IDS_[" + p + "]", id: _CS_DAILY_FOLDER_IDS_[p] });
  }
  try {
    var par = DriveApp.getFileById(_CS_MAIN_SHEET_ID).getParents();
    while (par.hasNext()) {
      probe.push({ 출처: "상품정보 시트의 부모 폴더 (허브가 실제로 쓰는 곳)", id: par.next().getId() });
    }
  } catch (eMp2) {
    probe.push({ 출처: "상품정보 시트의 부모 폴더", id: "", 결과: "조회실패 · " + eMp2.message });
  }
  for (var q = 0; q < probe.length; q++) {
    var pe = probe[q];
    if (pe.결과) { out.폴더ID점검.push(pe); continue; }
    if (!pe.id) { pe.결과 = "(값 없음)"; out.폴더ID점검.push(pe); continue; }
    try {
      var fo = DriveApp.getFolderById(pe.id);
      pe.결과 = "열림 · " + fo.getName();
      try { if (fo.isTrashed()) pe.결과 += "  ★휴지통에 있음"; } catch (eT2) {}
    } catch (eO) {
      pe.결과 = "열기실패 · " + eO.message;
    }
    out.폴더ID점검.push(pe);
  }

  var folders = _cs_dailyFolders_();
  for (var f = 0; f < folders.length; f++) {
    var name = "?", id = "?";
    try { name = folders[f].getName(); id = folders[f].getId(); } catch (eN) {}
    out.폴더.push(name + "  [" + id + "]");

    try {
      var it = folders[f].getFiles();
      var n = 0;
      while (it.hasNext() && n < 40) {
        var file = it.next();
        var fn = file.getName();
        if (fn.indexOf(_CS_DAILY_PREFIX_) !== 0) continue;   // 일일마감_ 로 시작하는 것만
        n++;
        out.파일.push({
          이름: fn,
          폴더: name,
          수정: Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), "MM-dd HH:mm"),
          이름규칙일치: /^일일마감_\(\d{4}-\d{2}-\d{2}\)$/.test(fn),
        });
      }
    } catch (eL) {}
  }

  // 최근 것이 위로 오게
  out.파일.sort(function (a, b) { return a.이름 < b.이름 ? 1 : -1; });
  out.파일 = out.파일.slice(0, 20);

  var bad = 0;
  for (var i = 0; i < out.파일.length; i++) if (!out.파일[i].이름규칙일치) bad++;
  out.요약 = "폴더 " + out.폴더.length + "곳 · 일일마감 파일 " + out.파일.length +
    "개(최근 20개만) · 이름규칙 어긋남 " + bad + "개";

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/* ══════════════════════════════════════════════════════════════
 *  업체가 새로 올린 반품을 CS 가 놓치지 않게   (2026-09-18)
 *
 *   > "반품 접수가 새로 업체에서 등록하면.. cs들이 확인을 못할수 있으니까..
 *   >  반품카드 최상단에 위치해서 하이라이트 효과가 들어간다던지..
 *   >  cs에서 확인하면 꺼지게.."
 * ══════════════════════════════════════════════════════════════ */

/** 업체가 올린 것인가 — 접수자가 「업체:…」 로 시작한다 (포털 PRP_STAFF_PREFIX) */
function _cs_filedByVendor_(staff) {
  return String(staff || "").trim().indexOf("업체:") === 0;
}

/**
 * CS 가 확인했다고 적어 둔 표시가 있는가.
 *
 * ★ 두 모양을 다 받는다 ★
 *   ① [260918 14:20 홍길동] CS 확인 …   ← 지금 쓰는 것. 업체에게도 보인다.
 *   ② CS확인: 260918 14:20 홍길동        ← 2026-09-18 잠깐 쓴 옛 모양.
 *      업체에게 «안» 보이게 하려던 것인데, 사장님이 보이게 해 달라 하셨다.
 *      이미 적힌 줄이 있을 수 있으니 계속 읽는다 — 읽는 것은 공짜다.
 */
function _cs_hasCheckMark_(notice) {
  var lines = String(notice || "").split(/\n/);
  for (var i = 0; i < lines.length; i++) {
    var ln = String(lines[i] || "").trim();
    if (!ln) continue;
    if (/^CS확인\s*[:：]/.test(ln)) return true;              // 옛 모양
    var m = ln.match(/^\[\d{6}\s+\d{1,2}:\d{2}\s+[^\]]+\]\s*(.*)$/);
    if (m && /^CS\s*확인/.test(String(m[1] || "").trim())) return true;
  }
  return false;
}

/**
 * 이 줄이 «CS 가 아직 안 본 새 접수»인가.
 *
 * ★ 옛 건이 한꺼번에 켜지지 않게 한다 ★
 *   표시만으로 가리면, 이 기능을 넣는 순간 지난 업체 접수가 전부
 *   빨갛게 켜진다. 그건 알림이 아니라 소음이다.
 *   그래서 «CS 가 이미 손댄 자취»가 있으면 본 것으로 친다 —
 *     · 상태가 「접수」에서 움직였다        (CS 가 바꾼 것이다)
 *     · 비고에 CS 이름으로 된 줄이 있다      (메모·사진·상태 기록)
 *   업체가 쓴 줄(「업체:」)은 자취로 치지 않는다 — 그건 업체가 한 것이다.
 */
/**
 * 비고에서 「[출처 …]」를 읽는다 — 적는 쪽은 협력업체 포털 `prpSubmitReturn`.
 *
 * ★ 문구를 고치면 양쪽을 같이 고친다 ★ 포털이 적고 여기가 읽는다.
 *   한쪽만 고치면 뱃지가 조용히 사라지고, 사라진 줄도 모른다.
 *
 * @return {string} "확인됨" · "미확인" · "어긋남" · "" (옛 건이라 표시가 없음)
 */
function _cs_returnOrigin_(notice) {
  var m = String(notice || "").match(/\[출처\s*(확인됨|미확인|어긋남)\]/);
  return m ? m[1] : "";
}

function _cs_needsCsCheck_(staff, notice, status) {
  if (!_cs_filedByVendor_(staff)) return false;
  if (_cs_hasCheckMark_(notice)) return false;

  var st = String(status || "").trim();
  if (st && st !== "접수") return false;

  var lines = String(notice || "").split(/\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = String(lines[i] || "").trim()
      .match(/^\[(\d{6})\s+(\d{1,2}:\d{2})\s+([^\]]+)\]/);
    if (!m) continue;
    if (String(m[3] || "").trim().indexOf("업체:") === 0) continue;  // 업체가 쓴 줄
    return false;   // CS 가 손댄 자취가 있다
  }
  return true;
}

/**
 * 「확인했습니다」를 적는다 — 그 카드의 하이라이트가 꺼진다.
 *
 * ★ 브라우저에 담지 않는다 ★ 담으면 사람마다 따로 놀아서, 한 사람이
 *   본 것을 다른 사람은 계속 새 것으로 본다. 대장에 적어 팀이 같이 안다.
 *
 * ★ 업체에게도 보인다 ★  (2026-09-18 — 처음엔 숨겼다가 바꿨다)
 *   > "확인을 누르면 업체에서도 확인이 보이게.."
 *   업체는 올려 놓고 «봤나 안 봤나»를 모른다. 그래서 전화가 온다.
 *   보이게 하는 것이 서로 일을 던다.
 *   그래서 «대괄호 형식»으로 적는다 — 포털이 그 형식만 내보낸다.
 *   ★ 표시가 곧 이력이다 ★ 숨김용 줄을 따로 두고 보이는 줄을 또 적으면
 *     한 사실에 주인이 둘이 된다. 한 줄로 둘 다 한다.
 */
function markReturnChecked(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var tabName = String(payload.tab || "").trim();
  var rowNum = parseInt(payload.row, 10);
  var staff = String(payload.staff || "").trim();
  if (!tabName || !(rowNum > 0)) return { ok: false, error: "탭·행이 필요합니다." };
  if (!staff) return { ok: false, error: "담당자를 먼저 선택하세요." };

  try {
    var ctx = _cs_openReturnLedgerRow_(tabName, rowNum);
    if (ctx.col.notice < 0) return { ok: false, error: "비고 열을 찾지 못했습니다." };

    var notice = String(ctx.row[ctx.col.notice] || "");
    if (_cs_hasCheckMark_(notice)) {
      return { ok: true, already: true };   // 다른 사람이 먼저 봤다 — 탈이 아니다
    }
    var 이제 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd HH:mm");
    /*  다른 이력과 «같은 모양»으로 적는다 — [날짜 시각 담당자] 글.
        그래야 포털이 내보내고, CS 이력에도 한 줄로 얌전히 선다. */
    var 본문 = "CS 확인 — 접수 내용을 확인했습니다";
    var 줄 = "[" + 이제 + " " + staff + "] " + 본문;
    var 새비고 = notice ? (notice.replace(/\s+$/, "") + "\n" + 줄) : 줄;
    ctx.tab.getRange(rowNum, ctx.col.notice + 1).setValue(새비고);
    return { ok: true, at: 이제, staff: staff, text: 본문 };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
