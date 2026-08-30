/**
 * [협력업체] 명세서 정리 — 프로필·파싱
 * 파일: _partnerStatementProfiles.gs
 */

var _PSTMT_PROFILES_ = {
  GENERIC_거래명세서_v1: {
    id: "GENERIC_거래명세서_v1",
    headerHints: ["품목명", "공급가액", "부가세", "단가", "수량", "일자"],
    columns: {
      date: ["일자", "날짜", "date"],
      itemName: ["품목명", "상품명", "품명"],
      spec: ["규격", "spec"],
      box: ["box", "박스"],
      qty: ["수량", "수량(단위포함)", "수량(단위 포함)"],
      unitPrice: ["단가", "unitprice"],
      supplyAmt: ["공급가액", "공급가", "supply"],
      vatAmt: ["부가세", "vat", "세액"],
    },
    summaryHints: ["전잔액", "총합계", "합계"],
    vatFromColumns: true,
  },
  BW_거래명세서_v1: {
    id: "BW_거래명세서_v1",
    prefix: "BW",
    headerHints: ["품목명", "공급가액", "부가세", "단가", "수량", "일자"],
    columns: {
      date: ["일자"],
      itemName: ["품목명"],
      spec: ["규격"],
      box: ["box"],
      qty: ["수량", "수량(단위포함)"],
      unitPrice: ["단가"],
      supplyAmt: ["공급가액"],
      vatAmt: ["부가세"],
    },
    invoiceInName: /\d{12}/,
    vatFromColumns: true,
  },
};

function _pstmt_getProfile_(profileId) {
  var id = profileId || "GENERIC_거래명세서_v1";
  if (_PSTMT_PROFILES_[id]) return _PSTMT_PROFILES_[id];
  return _PSTMT_PROFILES_.GENERIC_거래명세서_v1;
}

function _pstmt_guessHeaderRow_(data, profile) {
  var hints = (profile && profile.headerHints) || ["품목명", "공급가액"];
  var best = 0;
  var bestScore = 0;
  var n = Math.min(data.length, 15);
  for (var ri = 0; ri < n; ri++) {
    var score = 0;
    for (var ci = 0; ci < data[ri].length; ci++) {
      var cell = String(data[ri][ci] || "").replace(/\s/g, "").toLowerCase();
      if (!cell) continue;
      for (var hi = 0; hi < hints.length; hi++) {
        if (cell.indexOf(String(hints[hi]).replace(/\s/g, "").toLowerCase()) !== -1) score += 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = ri;
    }
  }
  return bestScore >= 2 ? best : 0;
}

function _pstmt_buildColMap_(headerRow, profile) {
  var map = {};
  var cols = profile.columns || {};
  for (var key in cols) {
    var aliases = cols[key];
    map[key] = -1;
    for (var ci = 0; ci < headerRow.length; ci++) {
      var h = String(headerRow[ci] || "").replace(/\s/g, "").toLowerCase();
      if (!h) continue;
      for (var ai = 0; ai < aliases.length; ai++) {
        var a = String(aliases[ai]).replace(/\s/g, "").toLowerCase();
        if (h === a || h.indexOf(a) !== -1) {
          map[key] = ci;
          break;
        }
      }
      if (map[key] >= 0) break;
    }
  }
  return map;
}

function _pstmt_parseNumber_(v) {
  if (typeof v === "number" && !isNaN(v)) return v;
  var s = String(v == null ? "" : v).replace(/,/g, "").replace(/[^\d.\-]/g, "").trim();
  if (!s) return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function _pstmt_parseQty_(v) {
  var s = String(v == null ? "" : v).trim();
  var m = s.match(/([\d,.]+)/);
  return m ? _pstmt_parseNumber_(m[1]) : _pstmt_parseNumber_(s);
}

function _pstmt_extractInvoice_(text, profile) {
  var s = String(text || "");
  var re = (profile && profile.invoiceInName) || /\d{12}/;
  var m = s.match(re);
  return m ? m[0] : "";
}

function _pstmt_detectRowType_(row, profile) {
  var name = String(row.itemName || "");
  var inv = row.invoice || _pstmt_extractInvoice_(name, profile);
  if (inv && row.qty <= 1.001 && row.unitPriceIncVat >= 2000) return "shipping";
  if (inv) return "shipping";
  if (row.spec || row.qty > 1) return "product";
  return "other";
}

/** 명세서_원본 → canonical rows */
function _pstmt_parseRawSheet_(ss, settings) {
  var tab = ss.getSheetByName(_PSTMT_TAB_RAW);
  if (!tab) throw new Error("「" + _PSTMT_TAB_RAW + "」탭 없음");
  var lr = tab.getLastRow();
  var lc = Math.max(tab.getLastColumn(), 1);
  if (lr < 2) throw new Error("「" + _PSTMT_TAB_RAW + "」에 데이터가 없습니다.");

  var data = tab.getRange(1, 1, lr, lc).getDisplayValues();
  var profile = _pstmt_getProfile_(settings.profileId);
  var headerIdx = _pstmt_guessHeaderRow_(data, profile);
  var header = data[headerIdx];
  var col = _pstmt_buildColMap_(header, profile);

  if (col.itemName < 0) {
    throw new Error("품목명 열을 찾지 못했습니다. 1행 헤더(일자·품목명·단가·공급가액·부가세)를 확인하세요.");
  }

  var rows = [];
  var sumSupply = 0;
  var sumIncVat = 0;

  for (var ri = headerIdx + 1; ri < data.length; ri++) {
    var r = data[ri];
    var itemName = col.itemName >= 0 ? String(r[col.itemName] || "").trim() : "";
    if (!itemName) continue;
    if (/^[-=─_]+$/.test(itemName)) continue;
    if (/전잔액|총합계|합\s*계|인\s*수|계좌번호/.test(itemName)) continue;

    var qty = col.qty >= 0 ? _pstmt_parseQty_(r[col.qty]) : 0;
    var unitEx = col.unitPrice >= 0 ? _pstmt_parseNumber_(r[col.unitPrice]) : 0;
    var supply = col.supplyAmt >= 0 ? _pstmt_parseNumber_(r[col.supplyAmt]) : 0;
    var vat = col.vatAmt >= 0 ? _pstmt_parseNumber_(r[col.vatAmt]) : 0;

    if (!supply && unitEx && qty) supply = Math.round(unitEx * qty);
    if (!vat && supply) vat = Math.round(supply * 0.1);
    if (!unitEx && supply && qty) unitEx = supply / qty;

    var unitInc = qty ? (supply + vat) / qty : unitEx * 1.1;
    var amtInc = supply + vat;
    if (!amtInc && unitInc && qty) amtInc = Math.round(unitInc * qty);

    var invoice = _pstmt_extractInvoice_(itemName, profile);
    var recipient = "";
    if (invoice) {
      recipient = itemName.replace(invoice, "").replace(/\d{12}/g, "").trim();
    }

    var row = {
      rowNum: ri + 1,
      date: col.date >= 0 ? String(r[col.date] || "").trim() : "",
      itemName: itemName,
      spec: col.spec >= 0 ? String(r[col.spec] || "").trim() : "",
      qty: qty,
      unitPriceExVat: unitEx,
      supplyAmt: supply,
      vatAmt: vat,
      unitPriceIncVat: Math.round(unitInc * 100) / 100,
      amountIncVat: amtInc,
      invoice: invoice,
      recipient: recipient,
      rowType: "",
      channel: settings.inputChannel || "paste",
    };
    row.rowType = _pstmt_detectRowType_(row, profile);
    rows.push(row);
    sumSupply += supply;
    sumIncVat += amtInc;
  }

  var summary = _pstmt_tryParseSummary_(data, profile);
  return {
    rows: rows,
    profile: profile,
    headerIdx: headerIdx,
    colMap: col,
    totals: {
      supply: sumSupply,
      incVat: sumIncVat,
      summarySupply: summary.supply,
      summaryVat: summary.vat,
      summaryIncVat: summary.incVat,
      summaryOk: summary.ok,
    },
  };
}

function _pstmt_tryParseSummary_(data) {
  var out = { supply: 0, vat: 0, incVat: 0, ok: false };
  for (var ri = 0; ri < data.length; ri++) {
    var line = data[ri].join(" ");
    if (line.indexOf("공급가액") === -1 && line.indexOf("부가세") === -1) continue;
    for (var ci = 0; ci < data[ri].length; ci++) {
      var cell = String(data[ri][ci] || "");
      var n = _pstmt_parseNumber_(cell);
      if (n <= 0) continue;
      if (cell.indexOf("전잔") !== -1) continue;
      if (!out.supply && n > 1000 && n < 1e9) out.supply = n;
    }
    if (out.supply) {
      out.vat = Math.round(out.supply * 0.1);
      out.incVat = out.supply + out.vat;
      out.ok = true;
      break;
    }
  }
  return out;
}

function _pstmt_loadViewerPriceMap_(ss) {
  var map = { byCode: {}, byName: {} };
  var tab = _pstmt_findViewerTab_(ss);
  if (!tab || tab.getLastRow() < 4) return map;
  var lr = tab.getLastRow();
  var data = tab.getRange(3, 1, lr - 2, Math.min(10, tab.getLastColumn())).getDisplayValues();
  for (var i = 0; i < data.length; i++) {
    var code = String(data[i][2] || "").trim();
    var name = String(data[i][3] || "").trim();
    var price = _pstmt_parseNumber_(data[i][6]);
    if (!code) continue;
    map.byCode[code] = { code: code, name: name, priceIncVat: price };
    if (name) map.byName[name.replace(/\s/g, "")] = map.byCode[code];
  }
  return map;
}

function _pstmt_loadVendorNameMap_(prefix) {
  var out = {};
  try {
    if (typeof _PEP_HUB_ALIAS_TAB_CANDIDATES !== "undefined") {
      var props = PropertiesService.getScriptProperties();
      var hubId = props.getProperty("DB_HUB_ID") || _PT.HUB_ID;
      var hubSS = SpreadsheetApp.openById(hubId);
      var hubTab = null;
      for (var hi = 0; hi < _PEP_HUB_ALIAS_TAB_CANDIDATES.length; hi++) {
        hubTab = hubSS.getSheetByName(_PEP_HUB_ALIAS_TAB_CANDIDATES[hi]);
        if (hubTab && hubTab.getLastRow() >= 2) break;
      }
      if (hubTab) {
        var data = hubTab.getDataRange().getDisplayValues();
        var hdr = data[0];
        var nameCol = -1;
        var codeCol = -1;
        var packNameCol = -1;
        var priceVatCol = -1;
        var pfxCol = -1;
        for (var c = 0; c < hdr.length; c++) {
          var h = String(hdr[c] || "").replace(/\s/g, "").toLowerCase();
          if (nameCol < 0 && h.indexOf("업체") !== -1 && (h.indexOf("품목") !== -1 || h.indexOf("상품") !== -1)) nameCol = c;
          if (codeCol < 0 && h.indexOf("팩투유") !== -1 && h.indexOf("코드") !== -1) codeCol = c;
          if (packNameCol < 0 && h.indexOf("팩투유") !== -1 && h.indexOf("명") !== -1) packNameCol = c;
          if (priceVatCol < 0 && (h.indexOf("포함") !== -1 || h.indexOf("vat포함") !== -1)) priceVatCol = c;
          if (pfxCol < 0 && h.indexOf("접두") !== -1) pfxCol = c;
        }
        for (var ri = 1; ri < data.length; ri++) {
          var vName = nameCol >= 0 ? String(data[ri][nameCol] || "").trim() : "";
          var code = codeCol >= 0 ? String(data[ri][codeCol] || "").trim() : "";
          var pName = packNameCol >= 0 ? String(data[ri][packNameCol] || "").trim() : code;
          var rowPfx = pfxCol >= 0 ? String(data[ri][pfxCol] || "").trim().toUpperCase() : "";
          if (prefix && rowPfx && rowPfx !== prefix) continue;
          if (!vName || !code) continue;
          var k2 = vName.replace(/\s/g, "").toLowerCase();
          out[k2] = {
            code: code,
            pack2uName: pName || code,
            priceIncVat: priceVatCol >= 0 ? _pstmt_parseNumber_(data[ri][priceVatCol]) : 0,
            vendorName: vName,
          };
        }
      }
    }
  } catch (e) {
    Logger.log("[PSTMT] vendor map: " + e.message);
  }
  return out;
}

function _pstmt_resolvePack2UItem_(row, prefix, vendorMap, viewerMap) {
  var name = String(row.itemName || "");
  var norm = name.replace(/\d{12}/g, "").replace(/\s/g, "").toLowerCase();

  var best = null;
  var bestLen = 0;
  for (var k in vendorMap) {
    if (norm.indexOf(k) !== -1 || k.indexOf(norm) !== -1) {
      if (k.length > bestLen) {
        bestLen = k.length;
        best = vendorMap[k];
      }
    }
  }

  if (!best && row.rowType === "product") {
    for (var vn in viewerMap.byName) {
      if (norm.indexOf(vn) !== -1 || vn.indexOf(norm) !== -1) {
        best = {
          code: viewerMap.byName[vn].code,
          pack2uName: viewerMap.byName[vn].name,
          priceIncVat: viewerMap.byName[vn].priceIncVat,
          vendorName: name,
        };
        break;
      }
    }
  }

  if (!best) {
    return {
      code: "",
      pack2uName: "",
      quoteIncVat: 0,
      mapped: false,
      note: "UNMAPPED",
    };
  }

  var quote = best.priceIncVat || 0;
  if (!quote && best.code && viewerMap.byCode[best.code]) {
    quote = viewerMap.byCode[best.code].priceIncVat;
  }

  return {
    code: best.code,
    pack2uName: best.pack2uName,
    quoteIncVat: quote,
    mapped: true,
    note: "",
  };
}
