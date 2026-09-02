/**
 * Pack2U CS 주문/송장 검색
 *
 * ★ 2026-08-25: 조회 원천이 바뀌었다 ★
 *   기존: 일일마감_(YYYY-MM-DD) 파일 14개 + 허브 + 임시기록 + 보관 (최대 17회 파일 열기)
 *   현재: 허브 시트의 `통합조회` 탭 1개 + 허브·임시기록 오버레이 (3회)
 *
 *   `통합조회`는 허브에서 매일 밤 22:45에 주문+송장을 통째로 다시 조인해 만든다
 *   (_partnerUnifiedView.gs). 재생성 방식이므로 늦게 도착한 송장도 자동 반영된다.
 *   야간 1회 생성이라 당일 주문은 아직 없으므로, 허브·임시기록 오버레이는 유지한다.
 *
 *   통합조회 탭이 없거나 비어 있으면 기존 14파일 경로로 자동 폴백한다.
 *   강제로 옛 경로를 쓰려면 스크립트 속성 CS_USE_UNIFIED_VIEW = "0".
 */

var _CS_DAILY_PREFIX_ = "일일마감_";

/**
 * 조회 일수.
 * ★ 허브의 _PUV_DAYS_ (파일: _partnerUnifiedView.gs) 와 같은 값이어야 한다 ★
 *   CS 는 통합조회 탭 하나를 읽으므로, 여기서 14일을 달라고 해도 그 탭에
 *   10일치밖에 없으면 10일치만 온다. 숫자가 어긋나면 대시보드에 빈 날짜가
 *   0건으로 찍혀 고장난 것처럼 보인다.
 *   2026-09-02: 야간 재생성 시간초과 때문에 허브를 10일로 줄이면서 같이 맞췄다.
 */
var _CS_DAILY_DAYS_DEFAULT_ = 10;
var _CS_DA_CACHE_TTL_ = 21600; // 6시간
var _CS_DA_CACHE_VER_ = "v15";
var _CS_SEARCH_LIMIT_ = 80;

/** 허브가 만들어 주는 통합조회 탭 — 열 순서가 허브와의 계약이다 */
var _CS_UNIFIED_TAB_ = "통합조회";
var _CS_UV_CACHE_TTL_ = 3600; // 1시간. 야간 갱신이지만 수동 재생성도 빨리 반영되게
/** 통합조회 고정 열 (_PUV_HEADERS_ 와 1:1) */
var _CS_UV_COL_ = {
  date: 0, invoice: 1, phone: 2, name: 3, item: 4, code: 5, qty: 6,
  addr: 7, shipMsg: 8, source: 9, orderNo: 10, vendor: 11, carrier: 12,
  status: 13, origin: 14, match: 15, combined: 16, updated: 17
};

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
      unified: pack.indexSource === "unified",
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
    var uv = _cs_unifiedViewEnabled_() ? _cs_loadUnifiedView_(days, false) : { found: false };
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

/** 통합조회 상태 진단 — 전환이 실제로 먹었는지 확인용 */
function csDiagnoseUnifiedView() {
  var out = { enabled: _cs_unifiedViewEnabled_(), tab: _CS_UNIFIED_TAB_ };
  try {
    var ss = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID);
    var tab = ss.getSheetByName(_CS_UNIFIED_TAB_);
    out.tabExists = !!tab;
    out.lastRow = tab ? tab.getLastRow() : 0;
    out.header = tab ? tab.getRange(1, 1, 1, Math.min(tab.getLastColumn(), 18)).getDisplayValues()[0] : [];
  } catch (e) {
    out.openError = e.message;
  }
  var uv = _cs_loadUnifiedView_(_CS_DAILY_DAYS_DEFAULT_, true);
  out.loaded = uv.found;
  out.rows = uv.rows.length;
  out.updatedAt = uv.updatedAt;
  out.loadError = uv.error;
  var noInv = 0;
  for (var i = 0; i < uv.rows.length; i++) {
    if (String(uv.rows[i].invDigits || "").replace(/[^0-9]/g, "").length < 8) noInv++;
  }
  out.noInvoice = noInv;
  out.verdict = uv.found
    ? "통합조회 사용 중 (파일 1개). 미매칭 " + noInv + "건"
    : "통합조회 미사용 → 일일마감 14파일 폴백" + (uv.error ? " (" + uv.error + ")" : "");
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
      unified: pack.indexSource === "unified",
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
        source: (pack.indexSource === "unified" ? "통합조회" : "일일마감")
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

/** 스크립트 속성으로 통합조회 사용을 끌 수 있다 (문제 시 즉시 옛 경로 복귀) */
function _cs_unifiedViewEnabled_() {
  try {
    return PropertiesService.getScriptProperties().getProperty("CS_USE_UNIFIED_VIEW") !== "0";
  } catch (e) {
    return true;
  }
}

/**
 * 통합조회 탭 1개를 읽어 검색 행으로 만든다.
 * 파일 열기 1회로 14일치가 다 들어오므로 날짜별 예열이 필요 없다.
 */
function _cs_loadUnifiedView_(days, refresh) {
  var out = { found: false, rows: [], updatedAt: "", error: "", fromCache: false };
  var cache = CacheService.getScriptCache();
  var key = _CS_DA_CACHE_VER_ + "_uv_" + days;

  if (!refresh) {
    try {
      var hit = cache.get(key);
      if (hit) {
        var p = JSON.parse(hit);
        out.found = true;
        out.rows = p.rows || [];
        out.updatedAt = p.updatedAt || "";
        out.fromCache = true;
        return out;
      }
    } catch (e) {}
  }

  try {
    var ss = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID);
    var tab = ss.getSheetByName(_CS_UNIFIED_TAB_);
    if (!tab || tab.getLastRow() < 2) return out;

    var need = _CS_UV_COL_.updated + 1;
    var data = tab.getRange(1, 1, tab.getLastRow(), Math.max(tab.getLastColumn(), need)).getDisplayValues();

    // 헤더가 예상과 다르면 계약이 깨진 것 → 폴백에 맡긴다
    if (String(data[0][_CS_UV_COL_.invoice] || "").replace(/\s/g, "") !== "송장번호") {
      out.error = "통합조회 헤더 불일치";
      return out;
    }

    var C = _CS_UV_COL_;
    var fromN = _cs_dateList_(days);
    var minN = fromN[fromN.length - 1].replace(/-/g, "");

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var d = _cs_normYmd_(row[C.date]);
      if (d && d.replace(/-/g, "") < minN) continue;
      var nm = _cs_nameOnly_(row[C.name]);
      var item = String(row[C.item] || "").trim();
      var invRaw = String(row[C.invoice] || "");
      if (!nm && !item && !invRaw) continue;
      var addr = String(row[C.addr] || "").trim();
      out.rows.push({
        date: d || "",
        invoice: invRaw.replace(/\n/g, " ").trim(),
        invDigits: _cs_allInvDigits_(invRaw),
        phone: _cs_phoneDisplay_(row[C.phone]),
        phoneDigits: _cs_phoneDigits_(row[C.phone]),
        name: nm,
        item: item,
        ecountCode: _cs_readEcountCodeCell_(row[C.code]),
        qty: String(row[C.qty] || "").trim(),
        addr: addr,
        shipMsg: _cs_sanitizeShipMsg_(String(row[C.shipMsg] || "").trim(), addr),
        source: String(row[C.source] || "").trim(),
        orderNo: String(row[C.orderNo] || "").trim(),
        vendor: String(row[C.vendor] || "").trim(),
        carrier: String(row[C.carrier] || "").trim(),
        status: String(row[C.status] || "").trim(),
        origin: String(row[C.origin] || "").trim() || "daily",
        match: String(row[C.match] || "").trim(),
        combinedPack: String(row[C.combined] || "").trim() === "Y"
      });
      if (!out.updatedAt) out.updatedAt = String(row[C.updated] || "").trim();
    }
    out.found = out.rows.length > 0;
    if (out.found) _cs_putUvCache_(cache, key, out.rows, out.updatedAt);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

function _cs_putUvCache_(cache, key, rows, updatedAt) {
  try {
    cache.put(key, JSON.stringify({ rows: rows, updatedAt: updatedAt }), _CS_UV_CACHE_TTL_);
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

  // ── 통합조회 우선 (파일 1개) ──
  var uv = _cs_unifiedViewEnabled_() ? _cs_loadUnifiedView_(days, refresh) : { found: false };
  if (uv.found) {
    indexSource = "unified";
    viewUpdatedAt = uv.updatedAt;
    rows = uv.rows;
    loadedDays = days;
    if (uv.fromCache) cachedDays = days;
    if (uv.error) errors.push("통합조회: " + uv.error);
  } else {
    // ── 폴백: 기존 일일마감 14파일 경로 ──
    if (uv.error) errors.push("통합조회: " + uv.error + " → 일일마감 파일로 폴백");
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
  if (!file) return { found: false, fromCache: false, rows: [], error: "" };

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
  if (src === "롯데" || src === "합포장" || src === "1주출고" || src.indexOf("롯데") >= 0) {
    return "롯데택배";
  }
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
    if (m.vendor < 0 && h !== "거래처명" && /발주업체|거래처|업체명|판매처/.test(h)) m.vendor = i;
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
    if (m.vendor < 0 && h !== "거래처명" && /발주업체|거래처|업체명|판매처/.test(h)) m.vendor = i;
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
    out.push(Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd"));
  }
  return out;
}

function _cs_clampDays_(days) {
  var n = Number(days);
  if (n === 7) return 7;
  return 14;
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

    if (col.notice >= 0) {
      var noticeLines = [];
      if (data.memo) noticeLines.push(_cs_ledgerStamp_(data.staff) + " " + String(data.memo || "").trim());
      if (retInvToNotice) noticeLines.push(retInvToNotice);
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
    return {
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
      colMap: headerIdx >= 0 ? _cs_mapReturnLedgerCols_(header) : null,
      error: headerIdx < 0 ? "반품접수날짜 헤더 없음 (상위 " + scanRows + "행 검색)" : ""
    };
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

function _cs_mapReturnLedgerCols_(header) {
  var col = {
    date: -1, staff: -1, vendor: -1, name: -1, phone: -1,
    pickup: -1, item: -1, qty: -1, invoice: -1, type: -1, fee: -1, status: -1, notice: -1,
    // 반품송장번호 — 대장 맨 끝에 추가한 열. 없으면 -1 이고 N열 비고 파싱으로 폴백한다.
    returnInvoice: -1
  };
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (col.date < 0 && /반품접수날짜|접수날짜|접수일자/.test(h)) col.date = i;
    else if (col.staff < 0 && h === "접수자") col.staff = i;
    else if (col.vendor < 0 && /업체명|판매처|발주업체/.test(h)) col.vendor = i;
    else if (col.name < 0 && /반품신청자|수취인명|수취인|받는분/.test(h) && !/전화|주소/.test(h)) col.name = i;
    else if (col.phone < 0 && /연락처|전화|휴대폰/.test(h) && !/주소/.test(h)) col.phone = i;
    else if (col.pickup < 0 && /수거입력처/.test(h)) col.pickup = i;
    else if (col.item < 0 && /상품명|품목명/.test(h) && !/코드/.test(h)) col.item = i;
    else if (col.qty < 0 && (h === "수량" || h.indexOf("수량") === 0)) col.qty = i;
    else if (col.invoice < 0 && /원송장|송장번호/.test(h) && !/회수|재발송|반품송장/.test(h)) col.invoice = i;
    else if (col.returnInvoice < 0 && /반품송장|회수송장/.test(h)) col.returnInvoice = i;
    else if (col.type < 0 && /교환.?반품|반품구분/.test(h)) col.type = i;
    else if (col.fee < 0 && /반품비|반품운임|반품배송비/.test(h)) col.fee = i;
    else if (col.notice < 0 && /고객요청|유의사항|비고/.test(h)) col.notice = i;
  }
  // A열 = 처리상태 (접수/수거중/완료 …). 헤더명이 비어도 A를 쓴다.
  col.status = 0;
  // M열 = 반품비 (헤더명이 비어 있거나 다를 때)
  if (col.fee < 0) col.fee = 12;
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

/** 반품대장 캐시 키 — 세대 번호를 포함해 한 번에 무효화할 수 있게 한다 */
function _cs_returnCacheKey_(days, activeOnly) {
  var gen = "1";
  try {
    gen = PropertiesService.getScriptProperties().getProperty(_CS_RETURN_GEN_PROP_) || "1";
  } catch (e) {
    // 속성을 못 읽어도 조회는 되어야 한다 — 캐시가 조금 오래 갈 뿐이다
  }
  return _CS_RETURN_CACHE_VER_ + "g" + gen + "_" + days + "_" + (activeOnly ? "A" : "X");
}
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
    if (/^반품송장\s*[:：]|^회수송장\s*[:：]/.test(ln)) {
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
      phone: _cs_formatLedgerPhone_(phoneRaw),
      phoneDigits: _cs_phoneDigits_(phoneRaw),
      item: col.item >= 0 ? String(row[col.item] || "").trim() : "",
      qty: col.qty >= 0 ? String(row[col.qty] || "").trim() : "",
      invoice: invRaw,
      invDigits: invDigits,
      returnInvoice: returnInv,
      returnInvDigits: retDigits,
      returnInvFromCol: !!returnInvCell,
      type: typeVal,
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

function _cs_loadReturnLedgerCases_(days, activeOnly, refresh) {
  days = days || 30;
  activeOnly = !!activeOnly;
  var cache = CacheService.getScriptCache();
  var ck = _cs_returnCacheKey_(days, activeOnly);
  if (!refresh) {
    try {
      var hit = cache.get(ck);
      if (hit) return JSON.parse(hit) || [];
    } catch (eC) {}
  }

  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var monthKeys = _cs_returnLedgerMonthsToScan_(days);
  var monthTabs = _cs_listReturnLedgerMonthTabs_(ss);
  var cutoffYmd = _cs_daysAgoYmd_(days);
  var all = [];

  for (var mi = 0; mi < monthKeys.length; mi++) {
    var mk = monthKeys[mi];
    var tab = ss.getSheetByName(mk);
    if (!tab && monthTabs.indexOf(mk) < 0) continue;
    if (!tab) continue;
    var chunk = _cs_readReturnLedgerTabCases_(tab, mk, cutoffYmd, activeOnly);
    for (var ci = 0; ci < chunk.length; ci++) all.push(chunk[ci]);
  }

  all.sort(function(a, b) {
    return String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
  });

  try {
    cache.put(ck, JSON.stringify(all), _CS_RETURN_CACHE_TTL_);
  } catch (ePut) {}
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
    var allRecent = _cs_loadReturnLedgerCases_(90, false, refresh);
    var slim = [];
    for (var i = 0; i < allRecent.length; i++) {
      var r = allRecent[i];
      slim.push({
        invDigits: r.invDigits,
        returnInvDigits: r.returnInvDigits,
        phoneDigits: r.phoneDigits,
        name: r.name,
        status: r.status,
        active: r.active,
        tab: r.tab,
        row: r.row
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

  // ── 통합조회 쪽 ──
  try {
    var uv = _cs_loadUnifiedView_(_CS_DAILY_DAYS_DEFAULT_, true);
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
