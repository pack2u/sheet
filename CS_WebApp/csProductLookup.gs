/**
 * CS WebApp — 상품정보(이카운트코드) 조회
 * ★ SSOT: Supabase products_hub 만 (시트 폴백 없음)
 */

var _CS_PRODUCT_CACHE_VER_ = "v8";
var _CS_MALL_BASE_ = "https://pack2u.co.kr";
var _CS_HUB_API_URL_ = "https://script.google.com/macros/s/AKfycbzTRCZpioVmlgC_Mfji-UeTBVuAA6yiku5-cX4n/exec";
var _CS_ITEM_CODE_CACHE_VER_ = "v2";
var _CS_SB_URL_ = "https://bmlbehjtdleshsbvxfrx.supabase.co";
var _CS_SB_SELECT_ = "ecount_code,item_name,status,stock_qty,base_price,purchase_price,retail_price,hub_base_price,warehouse,supplier";
var _CS_SB_KEY_ = "";

function _cs_sb_getKey_() {
  if (_CS_SB_KEY_) return _CS_SB_KEY_;
  if (typeof SUPABASE_SERVICE_KEY !== "undefined" && SUPABASE_SERVICE_KEY) {
    _CS_SB_KEY_ = String(SUPABASE_SERVICE_KEY);
    return _CS_SB_KEY_;
  }
  try {
    _CS_SB_KEY_ = PropertiesService.getScriptProperties().getProperty("SUPABASE_KEY") ||
      PropertiesService.getScriptProperties().getProperty("SUPABASE_SERVICE_KEY") || "";
  } catch (e) {}
  return _CS_SB_KEY_;
}

/** Supabase REST GET — CS앱에서 직접 (허브 GAS 경유 없음) */
function _cs_sb_get_(table, query) {
  var key = _cs_sb_getKey_();
  if (!key) return [];

  var url = _CS_SB_URL_ + "/rest/v1/" + table + (query ? "?" + query : "");
  try {
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true,
      headers: {
        "apikey": key,
        "Authorization": "Bearer " + key,
      },
    });
    if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
      return JSON.parse(res.getContentText()) || [];
    }
  } catch (e) {}
  return [];
}

function _cs_sb_productByCode_(normCode, rawTok) {
  normCode = String(normCode || "").trim();
  rawTok = String(rawTok || normCode || "").trim().toUpperCase();
  var tries = [];
  if (rawTok) tries.push(rawTok);
  if (normCode && tries.indexOf(normCode) < 0) tries.push(normCode);
  if (rawTok.indexOf("-") < 0 && normCode.length >= 4) tries.push(rawTok.replace(/([A-Z]{2})(\d)/, "$1-$2"));

  var i;
  for (i = 0; i < tries.length; i++) {
    var rows = _cs_sb_get_(
      "products_hub",
      "ecount_code=eq." + encodeURIComponent(tries[i]) +
      "&select=" + _CS_SB_SELECT_ + "&limit=1"
    );
    if (rows && rows.length) return rows[0];
  }

  var fuzzy = _cs_sb_get_(
    "products_hub",
    "ecount_code=ilike.*" + encodeURIComponent(normCode) + "*" +
    "&select=" + _CS_SB_SELECT_ + "&limit=5"
  );
  if (fuzzy && fuzzy.length) {
    for (i = 0; i < fuzzy.length; i++) {
      if (_cs_prod_normCode_(fuzzy[i].ecount_code) === normCode) return fuzzy[i];
    }
    return fuzzy[0];
  }
  return null;
}

function _cs_sb_productSearch_(q, limit) {
  q = String(q || "").trim();
  if (!q) return [];
  limit = limit || 10;

  var byCode = _cs_sb_get_(
    "products_hub",
    "ecount_code=eq." + encodeURIComponent(q) +
    "&select=" + _CS_SB_SELECT_ + "&limit=1"
  );
  if (byCode && byCode.length) return byCode;

  return _cs_sb_get_(
    "products_hub",
    "or=(item_name.ilike.*" + encodeURIComponent(q) + "*,ecount_code.ilike.*" + encodeURIComponent(q) + "*)" +
    "&select=" + _CS_SB_SELECT_ +
    "&limit=" + limit + "&order=item_name"
  );
}

/** DB 검색 — Supabase 직접 → (키 없을 때만) 허브 API */
function _cs_prod_dbSearch_(q, limit) {
  q = String(q || "").trim();
  if (!q) return [];

  var cache = CacheService.getScriptCache();
  var ck = _CS_PRODUCT_CACHE_VER_ + "_dbq_" + q.toLowerCase().substring(0, 80);
  try {
    var hit = cache.get(ck);
    if (hit) return JSON.parse(hit) || [];
  } catch (eC) {}

  var rows = [];
  if (_cs_sb_getKey_()) {
    rows = _cs_sb_productSearch_(q, limit);
  }
  if (!rows.length) {
    rows = _cs_hubProductSearch_(q, limit);
  }

  try {
    cache.put(ck, JSON.stringify(rows), 1800);
  } catch (ePut) {}
  return rows;
}

function _cs_hubApiUrl_() {
  if (typeof HUB_WEBAPP_URL !== "undefined" && HUB_WEBAPP_URL) {
    return String(HUB_WEBAPP_URL).replace(/\?.*$/, "");
  }
  try {
    var p = String(PropertiesService.getScriptProperties().getProperty("HUB_WEBAPP_URL") || "").trim();
    if (p) return p.replace(/\?.*$/, "");
  } catch (e) {}
  return _CS_HUB_API_URL_;
}

/** 허브 WebApp productSearch → Supabase products_hub */
function _cs_hubProductSearch_(q, limit) {
  q = String(q || "").trim();
  if (!q) return [];
  limit = limit || 10;

  var cache = CacheService.getScriptCache();
  var ck = _CS_PRODUCT_CACHE_VER_ + "_hubq_" + q.toLowerCase().substring(0, 80);
  try {
    var hit = cache.get(ck);
    if (hit) return JSON.parse(hit) || [];
  } catch (eC) {}

  try {
    var url = _cs_hubApiUrl_() +
      "?action=productSearch&q=" + encodeURIComponent(q) +
      "&limit=" + limit;
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { "User-Agent": "Pack2U-CS-WebApp/1.0" },
    });
    if (resp.getResponseCode() !== 200) return [];
    var json = JSON.parse(resp.getContentText());
    if (json && json.error) return [];
    var rows = (json && json.data) ? json.data : [];
    try {
      cache.put(ck, JSON.stringify(rows), 1800);
    } catch (ePut) {}
    return rows;
  } catch (e) {
    return [];
  }
}

function _cs_prod_normItemKey_(itemName) {
  return String(itemName || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .substring(0, 120);
}

function _cs_prod_pickBestByItemName_(results, itemName) {
  if (!results || !results.length) return null;
  var target = _cs_prod_normItemKey_(itemName);
  if (!target) return results[0];

  var best = null;
  var bestScore = -1;
  for (var i = 0; i < results.length; i++) {
    var name = _cs_prod_normItemKey_(results[i].item_name);
    if (!name) continue;
    var score = 0;
    if (name === target) score = 1000;
    else if (name.indexOf(target) >= 0 || target.indexOf(name) >= 0) score = 500;
    else {
      var ta = target.split(/[\s/|,]+/).filter(Boolean);
      for (var t = 0; t < ta.length; t++) {
        if (ta[t].length >= 2 && name.indexOf(ta[t]) >= 0) score += 20;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = results[i];
    }
  }
  return best || results[0];
}

function _cs_prod_fromHubRow_(row, sourceTag) {
  if (!row || !row.ecount_code) return null;
  var norm = _cs_prod_normCode_(row.ecount_code);
  if (!norm) return null;
  var codeRaw = String(row.ecount_code || "").trim();
  return {
    ok: true,
    code: norm,
    codeRaw: codeRaw,
    productName: String(row.item_name || "").trim(),
    optionName: "",
    status: String(row.status || "").trim(),
    salePrice: String(row.retail_price || row.hub_base_price || row.base_price || "").trim(),
    offlinePrice: String(row.base_price || row.purchase_price || "").trim(),
    shipFrom: String(row.warehouse || "").trim(),
    note: String(row.supplier || "").trim(),
    stock: row.stock_qty != null && row.stock_qty !== "" ? String(row.stock_qty) : "",
    source: sourceTag || "db",
    fromCache: false,
  };
}

function _cs_prod_loadFromDbByCode_(code, rawTok) {
  if (_cs_sb_getKey_()) {
    var row = _cs_sb_productByCode_(code, rawTok);
    if (row) return _cs_prod_fromHubRow_(row, "db");
  }
  return _cs_prod_loadFromHubByCode_(code);
}

function _cs_prod_loadFromHubByCode_(code) {
  var rows = _cs_hubProductSearch_(code, 3);
  for (var i = 0; i < rows.length; i++) {
    if (_cs_prod_normCode_(rows[i].ecount_code) === code) {
      return _cs_prod_fromHubRow_(rows[i], "db_hub");
    }
  }
  return null;
}

// ── 배송비: 상품정보 시트 O열 (Supabase products_hub에 없는 값) ──
// 상품정보 탭 구조: 4행=헤더, 6행~=데이터, E열=이카운트코드, O열=배송비
var _CS_SHIPFEE_CACHE_VER_ = "v1";
var _CS_PRODINFO_TAB_ = "상품정보";
var _CS_PRODINFO_HEADER_ROW_ = 4;
var _CS_PRODINFO_DATA_ROW_ = 6;
var _CS_PRODINFO_CODE_COL_ = 5;  // E
var _CS_PRODINFO_SHIP_COL_ = 15; // O

function _cs_prod_fmtShipFee_(v) {
  if (v === null || v === undefined || v === "") return "";
  var num = null;
  if (typeof v === "number") {
    if (!isFinite(v)) return "";
    num = v;
  } else {
    var s = String(v).trim();
    if (!s) return "";
    if (!/^-?[\d,]+(\.\d+)?$/.test(s)) return s;
    var parsed = parseFloat(s.replace(/,/g, ""));
    if (isNaN(parsed)) return s;
    num = parsed;
  }
  return String(Math.round(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
}

/** 이카운트코드 → 상품정보 O열 배송비 (코드별 6시간 캐시) */
function _cs_prod_shipFeeByCode_(normCode) {
  normCode = String(normCode || "").trim();
  if (!normCode) return null;

  var cache = CacheService.getScriptCache();
  var ck = _CS_SHIPFEE_CACHE_VER_ + "_ship_" + normCode;
  try {
    var hit = cache.get(ck);
    if (hit) return hit === "__NONE__" ? null : JSON.parse(hit);
  } catch (eC) {}

  var found = null;
  try {
    var tab = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID).getSheetByName(_CS_PRODINFO_TAB_);
    if (tab) {
      var lastRow = tab.getLastRow();
      if (lastRow >= _CS_PRODINFO_DATA_ROW_) {
        var label = String(
          tab.getRange(_CS_PRODINFO_HEADER_ROW_, _CS_PRODINFO_SHIP_COL_).getValue() || ""
        ).replace(/\s+/g, " ").trim() || "배송비";
        // E~O 한 번에 읽어 API 호출 최소화
        var width = _CS_PRODINFO_SHIP_COL_ - _CS_PRODINFO_CODE_COL_ + 1;
        var feeIdx = width - 1;
        var rows = tab
          .getRange(_CS_PRODINFO_DATA_ROW_, _CS_PRODINFO_CODE_COL_, lastRow - _CS_PRODINFO_DATA_ROW_ + 1, width)
          .getValues();
        for (var i = 0; i < rows.length; i++) {
          if (_cs_prod_normCode_(rows[i][0]) !== normCode) continue;
          found = {
            label: label,
            fee: _cs_prod_fmtShipFee_(rows[i][feeIdx]),
            raw: rows[i][feeIdx] === null || rows[i][feeIdx] === undefined ? "" : String(rows[i][feeIdx]).trim(),
          };
          break;
        }
      }
    }
  } catch (e) {}

  try {
    cache.put(ck, found ? JSON.stringify(found) : "__NONE__", 21600);
  } catch (ePut) {}
  return found;
}

/** DB 응답 마무리 — 자사몰 검색 링크 + 상품정보 O열 배송비 */
function _cs_prod_finishDetailFast_(out) {
  if (!out || !out.ok) return out;
  var codeRaw = out.codeRaw || out.code || "";
  out.mallSearchUrl = codeRaw
    ? (_CS_MALL_BASE_ + "/product/search.html?keyword=" + encodeURIComponent(codeRaw))
    : "";
  out.mallUrl = "";
  out.sheetUrl = "";

  out.shipFee = "";
  out.shipFeeLabel = "배송비";
  out.shipFeeRaw = "";
  try {
    var sf = _cs_prod_shipFeeByCode_(out.code);
    if (sf) {
      out.shipFee = sf.fee;
      out.shipFeeLabel = sf.label || "배송비";
      out.shipFeeRaw = sf.raw;
    }
  } catch (eSf) {}
  return out;
}

/** @param {string} code 이카운트코드 */
function csLookupProductDetail(code) {
  var t0 = Date.now();
  var tok = String(code || "").trim().split(/[\s\t\r\n]+/)[0];
  var norm = _cs_prod_normCode_(tok);
  if (!norm) {
    return { ok: false, error: "이카운트 코드를 확인할 수 없습니다." };
  }

  var cache = CacheService.getScriptCache();
  var ck = _CS_PRODUCT_CACHE_VER_ + "_" + norm;
  try {
    var hit = cache.get(ck);
    if (hit) {
      var parsed = JSON.parse(hit);
      parsed.fromCache = true;
      parsed.loadMs = Date.now() - t0;
      return parsed;
    }
  } catch (eC) {}

  var out = _cs_prod_loadFromDbByCode_(norm, tok);
  if (!out || !out.ok) {
    return {
      ok: false,
      error: "Supabase DB에 '" + tok + "' 품목이 없습니다. (상품정보→DB 동기화 후 재시도)",
      loadMs: Date.now() - t0,
    };
  }

  out = _cs_prod_finishDetailFast_(out);
  out.loadMs = Date.now() - t0;
  try {
    cache.put(ck, JSON.stringify(out), 21600);
  } catch (ePut) {}
  return out;
}

/** 품목명 → DB 검색 → 상품 상세 (코드 없을 때) */
function csLookupProductByItemName(itemName) {
  var t0 = Date.now();
  var name = String(itemName || "").replace(/\s+/g, " ").trim();
  if (!name || name.length < 2) {
    return { ok: false, error: "품목명이 없습니다." };
  }

  var rows = _cs_prod_dbSearch_(name, 8);
  var best = _cs_prod_pickBestByItemName_(rows, name);
  if (best) {
    var out = _cs_prod_fromHubRow_(best, _cs_sb_getKey_() ? "db" : "db_hub");
    if (out && out.ok) {
      out = _cs_prod_finishDetailFast_(out);
      out.loadMs = Date.now() - t0;
      return out;
    }
  }

  if (!_cs_sb_getKey_() && !rows.length) {
    return { ok: false, error: "Supabase 연결 실패. _secrets.gs 키 또는 허브 API 확인.", loadMs: Date.now() - t0 };
  }
  return {
    ok: false,
    error: "Supabase DB에 '" + name + "' 품목이 없습니다. (동기화 후 재시도)",
    loadMs: Date.now() - t0,
  };
}

/** 주문검색용 — 품목명 → 이카운트코드 (캐시) */
function _cs_resolveCodeFromDbByItem_(itemName) {
  var key = _cs_prod_normItemKey_(itemName);
  if (!key || key.length < 2) return "";

  var cache = CacheService.getScriptCache();
  var ck = _CS_ITEM_CODE_CACHE_VER_ + "_item_" + key.substring(0, 100);
  try {
    var hit = cache.get(ck);
    if (hit !== null && hit !== undefined) return hit === "__NONE__" ? "" : hit;
  } catch (eC) {}

  var rows = _cs_prod_dbSearch_(itemName, 8);
  var best = _cs_prod_pickBestByItemName_(rows, itemName);
  var code = best ? _cs_prod_normCode_(best.ecount_code) : "";

  try {
    cache.put(ck, code || "__NONE__", 7200);
  } catch (ePut) {}
  return code;
}

function _cs_prod_normCode_(v) {
  var tok = String(v == null ? "" : v).trim().split(/[\s\t\r\n]+/)[0];
  var s = tok.toUpperCase().replace(/[^A-Z0-9\-]/g, "").replace(/-/g, "");
  if (s.length < 3 || s.length > 32) return "";
  if (/^\d+$/.test(s)) return "";
  if (!/[A-Z]/.test(s)) return "";
  return s;
}

/** DB·Supabase 연결 점검 */
function csDiagnoseProductDb() {
  var out = {
    ok: true,
    supabaseDirect: null,
    hubApiUrl: _cs_hubApiUrl_(),
    hubSearch: null,
    errors: [],
    ssot: "Supabase products_hub only (no sheet fallback)",
  };

  var t0 = Date.now();
  if (_cs_sb_getKey_()) {
    try {
      var sbRows = _cs_sb_get_("products_hub", "select=ecount_code&limit=1");
      out.supabaseDirect = {
        ok: sbRows && sbRows.length > 0,
        hasKey: true,
        ms: Date.now() - t0,
        sampleCode: sbRows[0] ? sbRows[0].ecount_code : "",
      };
    } catch (eSb) {
      out.ok = false;
      out.supabaseDirect = { ok: false, hasKey: true, error: eSb.message };
      out.errors.push("Supabase 직접: " + eSb.message);
    }
  } else {
    out.supabaseDirect = { ok: false, hasKey: false };
    out.errors.push("SUPABASE_KEY 없음 → 허브 API 폴백(느림). CS _secrets.gs 확인");
  }

  try {
    var url = _cs_hubApiUrl_() + "?action=productSearch&q=TEST&limit=1";
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { "User-Agent": "Pack2U-CS-WebApp/1.0" },
    });
    var code = resp.getResponseCode();
    var body = resp.getContentText();
    var json = {};
    try { json = JSON.parse(body); } catch (eJ) {}
    out.hubSearch = {
      ok: code === 200 && !json.error,
      httpCode: code,
      hasDataArray: !!(json && json.data && json.data.length),
      sampleCode: (json.data && json.data[0]) ? json.data[0].ecount_code : "",
    };
    if (code !== 200 || json.error) out.errors.push("허브 productSearch: HTTP " + code + (json.error ? " " + json.error : ""));
  } catch (e) {
    out.ok = false;
    out.errors.push("허브 API: " + e.message);
  }

  // 배송비(상품정보 O열) 읽기 점검
  try {
    var tab = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID).getSheetByName(_CS_PRODINFO_TAB_);
    if (!tab) {
      out.shipFee = { ok: false, error: "'" + _CS_PRODINFO_TAB_ + "' 탭 없음" };
      out.errors.push("배송비: 상품정보 탭을 찾지 못함");
    } else {
      var hdr = String(tab.getRange(_CS_PRODINFO_HEADER_ROW_, _CS_PRODINFO_SHIP_COL_).getValue() || "").trim();
      var sample = tab.getLastRow() >= _CS_PRODINFO_DATA_ROW_
        ? tab.getRange(_CS_PRODINFO_DATA_ROW_, _CS_PRODINFO_SHIP_COL_).getValue()
        : "";
      out.shipFee = {
        ok: true,
        headerRow: _CS_PRODINFO_HEADER_ROW_,
        column: "O",
        headerName: hdr,
        sample: _cs_prod_fmtShipFee_(sample),
      };
      if (hdr.indexOf("배송비") < 0) {
        out.errors.push("배송비: O열 헤더가 '" + hdr + "' — 열 위치 확인 필요");
      }
    }
  } catch (eSf) {
    out.shipFee = { ok: false, error: eSf.message };
    out.errors.push("배송비: " + eSf.message);
  }

  return out;
}
