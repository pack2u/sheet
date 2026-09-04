/**
 * [협력업체] 명세서 정리 — 비교·출력
 * 파일: _partnerStatementReconcile.gs
 */

// ═══════════════════════════════════════════
//  메뉴
// ═══════════════════════════════════════════

function partnerParseStatementFromRaw() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    _pstmt_ensureAllTabs_(ss, false);
    var settings = _pstmt_readSettings_(ss);
    var pack = _pstmt_parseRawSheet_(ss, settings);
    _pstmt_writeCanonTab_(ss, pack.rows);
    settings.inputChannel = settings.inputChannel || "paste";
    _pstmt_updateSummaryParse_(ss, pack);

    var msg =
      "파싱 " + pack.rows.length + "행\n" +
      "행합계 VAT포함: " + pack.totals.incVat.toLocaleString() + "원\n";
    if (pack.totals.summaryOk) {
      msg += "요약 공급가: " + pack.totals.summarySupply.toLocaleString() + "원\n";
      var diff = Math.abs(pack.totals.supply - pack.totals.summarySupply);
      msg += diff <= 1
        ? "✅ 행합계 = 요약란 일치"
        : "⚠️ 행합계 ≠ 요약란 (차이 " + diff.toLocaleString() + "원 — 누락행 가능)";
    } else {
      msg += "요약란 미감지 — 표 전체 붙여넣기 권장";
    }
    _pstmt_log_(ss, "parse", msg.replace(/\n/g, " "));
    ui.alert("✅ 명세 파싱 완료", msg + "\n\n다음: ③ 비교·정리 실행", ui.ButtonSet.OK);
  } catch (e) {
    _pstmt_log_(ss, "parse", "FAIL " + e.message);
    ui.alert("❌ 파싱 실패: " + (e.message || e));
  }
}

function partnerRunStatementReconcile() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    _pstmt_ensureAllTabs_(ss, false);
    var settings = _pstmt_readSettings_(ss);
    var pack = _pstmt_parseRawSheet_(ss, settings);
    var vendorMap = _pstmt_loadVendorNameMap_(settings.prefix);
    var viewerMap = _pstmt_loadViewerPriceMap_(ss);
    var formLines = _pstmt_loadExclusiveLines_(ss, "form");
    var archLines = _pstmt_loadExclusiveLines_(ss, "archive", settings.month);

    var results = [];
    var mirror = [];
    var ecount = [];
    var seq = 0;

    for (var i = 0; i < pack.rows.length; i++) {
      var row = pack.rows[i];
      var mapped = _pstmt_resolvePack2UItem_(row, settings.prefix, vendorMap, viewerMap);
      var quoteInc = mapped.quoteIncVat || 0;
      var priceDiff = quoteInc ? quoteInc - row.unitPriceIncVat : 0;
      var quoteAmt = quoteInc ? Math.round(quoteInc * row.qty) : 0;
      var amtDiff = quoteAmt ? quoteAmt - row.amountIncVat : 0;

      var match = _pstmt_matchOrderLines_(row, formLines, archLines);
      var status = _pstmt_buildStatus_(row, mapped, priceDiff, amtDiff, match, settings);

      results.push([
        status.icon,
        match.key,
        row.invoice,
        match.uid,
        mapped.code,
        mapped.pack2uName,
        row.itemName,
        row.qty,
        match.qtyForm,
        match.qtyArch,
        row.unitPriceIncVat,
        quoteInc,
        priceDiff,
        row.amountIncVat,
        quoteAmt,
        amtDiff,
        row.recipient || "",
        match.sourceLabel,
        status.note,
      ]);

      mirror.push([
        row.date,
        mapped.pack2uName || ("⚠️ " + row.itemName),
        mapped.code,
        row.spec,
        row.qty,
        row.unitPriceIncVat,
        quoteInc,
        priceDiff,
        quoteInc ? Math.round(quoteInc * row.qty / 1.1) : "",
        quoteInc ? Math.round(quoteInc * row.qty - quoteInc * row.qty / 1.1) : "",
        quoteAmt || row.amountIncVat,
        row.invoice,
        status.note,
      ]);

      if (mapped.code && row.qty > 0) {
        seq++;
        var amt1 = quoteAmt || row.amountIncVat;
        var supply = Math.round(amt1 / 1.1);
        var vat = amt1 - supply;
        var unitEx = row.qty ? Math.round(supply / row.qty) : 0;
        ecount.push([
          _pstmt_formatDateYmd_(row.date, settings.month),
          seq,
          settings.custCd,
          settings.vendorName,
          "", "", "", "", "", "", "", "", "",
          row.invoice || row.recipient,
          "",
          row.recipient,
          "", "", "",
          mapped.code,
          mapped.pack2uName,
          row.spec,
          row.qty,
          unitEx,
          amt1,
          "",
          supply,
          vat,
          "",
          row.itemName.substring(0, 80),
        ]);
      }
    }

    _pstmt_writeCanonTab_(ss, pack.rows);
    _pstmt_writeTable_(ss, _PSTMT_TAB_RESULT, _PSTMT_RESULT_HEADERS_, results);
    _pstmt_writeTable_(ss, _PSTMT_TAB_MIRROR, _PSTMT_MIRROR_HEADERS_, mirror);
    _pstmt_writeTable_(ss, _PSTMT_TAB_ECOUNT, _PSTMT_ECOUNT_PURCHASE_HEADERS_, ecount);
    _pstmt_updateSummaryReconcile_(ss, pack, results);

    ui.alert(
      "✅ 명세 비교 완료",
      "파싱 " + pack.rows.length + "행\n" +
        "전용양식 매칭: " + _pstmt_countMatch_(results, "양식") + "\n" +
        "마감 매칭: " + _pstmt_countMatch_(results, "마감") + "\n" +
        "미매핑: " + _pstmt_countNote_(results, "UNMAPPED") + "\n\n" +
        "「" + _PSTMT_TAB_MIRROR + "」「" + _PSTMT_TAB_ECOUNT + "」 확인",
      ui.ButtonSet.OK
    );
  } catch (e) {
    _pstmt_log_(ss, "reconcile", "FAIL " + e.message);
    ui.alert("❌ 비교 실패: " + (e.message || e));
  }
}

function partnerDiagnoseStatementReconcile() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lines = [];
  try {
    _pstmt_ensureAllTabs_(ss, false);
    var settings = _pstmt_readSettings_(ss);
    lines.push("대상월: " + settings.month);
    lines.push("prefix: " + (settings.prefix || "(미설정)"));
    lines.push("거래처: " + (settings.vendorName || "(설정 B5 없음)"));
    lines.push("CUST_CD: " + (settings.custCd || "(설정 B6 없음)"));

    var raw = ss.getSheetByName(_PSTMT_TAB_RAW);
    lines.push("원본 행: " + (raw ? Math.max(0, raw.getLastRow() - 1) : 0));

    var exTab = _pstmt_findSheetByNameContains_(ss, "전용양식");
    lines.push("전용양식: " + (exTab ? exTab.getName() + " (" + Math.max(0, exTab.getLastRow() - 1) + "행)" : "❌ 없음"));

    var tm = _pstmt_parseTargetMonth_(settings.month);
    var archName = _pstmt_archiveTabName_(tm.yyyy, tm.m);
    var arch = ss.getSheetByName(archName);
    lines.push("마감탭: " + (arch ? archName + " (" + Math.max(0, arch.getLastRow() - 1) + "행)" : "❌ " + archName));

    var viewer = _pstmt_findViewerTab_(ss);
    lines.push("단가조회: " + (viewer ? viewer.getName() : "❌ 없음"));

    var vMap = _pstmt_loadVendorNameMap_(settings.prefix);
    lines.push("업체품목 매핑: " + Object.keys(vMap).length + "건");

    try {
      var pack = _pstmt_parseRawSheet_(ss, settings);
      lines.push("파싱 가능: " + pack.rows.length + "행");
      lines.push("행합 VAT포함: " + pack.totals.incVat.toLocaleString());
      if (pack.totals.summaryOk) {
        lines.push("요약 VAT포함: " + pack.totals.summaryIncVat.toLocaleString());
      }
    } catch (pe) {
      lines.push("파싱: ❌ " + pe.message);
    }

    ui.alert("🧪 명세서 사전점검\n\n" + lines.join("\n"));
  } catch (e) {
    ui.alert("점검 오류: " + e.message);
  }
}

// ═══════════════════════════════════════════
//  전용양식 / 마감 로드
// ═══════════════════════════════════════════

function _pstmt_loadExclusiveLines_(ss, kind, monthStr) {
  var tab = null;
  if (kind === "form") {
    tab = _pstmt_findSheetByNameContains_(ss, "전용양식");
  } else {
    var tm = _pstmt_parseTargetMonth_(monthStr);
    tab = ss.getSheetByName(_pstmt_archiveTabName_(tm.yyyy, tm.m));
  }
  if (!tab || tab.getLastRow() < 2) return [];

  var lr = tab.getLastRow();
  var lc = Math.max(tab.getLastColumn(), 1);
  var data = tab.getRange(1, 1, lr, lc).getDisplayValues();
  var hdr = data[0];
  var colInv = _pstmt_findCol_(hdr, ["송장번호", "운송장번호"]);
  var colName = _pstmt_findCol_(hdr, ["품목명", "상품명", "품명"]);
  var colQty = _pstmt_findCol_(hdr, ["수량", "판매수량", "택배박스수량"]);
  var colUid = hdr.length >= 50 ? 49 : _pstmt_findCol_(hdr, ["고유ID", "UID"]);
  var colRecv = _pstmt_findCol_(hdr, ["받는사람", "수령인", "수하인", "고객명"]);

  var lines = [];
  for (var ri = 1; ri < data.length; ri++) {
    var inv = colInv >= 0 ? _pstmt_normInv_(data[ri][colInv]) : "";
    var name = colName >= 0 ? String(data[ri][colName] || "").trim() : "";
    var qty = colQty >= 0 ? _pstmt_parseQty_(data[ri][colQty]) : 0;
    var uid = colUid >= 0 ? String(data[ri][colUid] || "").trim() : "";
    var recv = colRecv >= 0 ? String(data[ri][colRecv] || "").trim() : "";
    if (!inv && !name && !uid) continue;
    lines.push({
      invoice: inv,
      name: name,
      qty: qty,
      uid: uid,
      recipient: recv,
      kind: kind,
    });
  }
  return lines;
}

function _pstmt_findCol_(hdr, aliases) {
  for (var ci = 0; ci < hdr.length; ci++) {
    var h = String(hdr[ci] || "").replace(/\s/g, "").toLowerCase();
    for (var ai = 0; ai < aliases.length; ai++) {
      var a = String(aliases[ai]).replace(/\s/g, "").toLowerCase();
      if (h === a || h.indexOf(a) !== -1) return ci;
    }
  }
  return -1;
}

function _pstmt_normInv_(v) {
  var s = String(v == null ? "" : v).replace(/[^0-9]/g, "");
  return s;
}

function _pstmt_matchOrderLines_(row, formLines, archLines) {
  var inv = _pstmt_normInv_(row.invoice);
  var qtyForm = "";
  var qtyArch = "";
  var uid = "";
  var key = "";
  var hitForm = false;
  var hitArch = false;

  function scan(lines, kind) {
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (inv && ln.invoice && ln.invoice === inv) {
        if (kind === "form") {
          qtyForm = ln.qty;
          hitForm = true;
        } else {
          qtyArch = ln.qty;
          hitArch = true;
        }
        uid = ln.uid || uid;
        key = "송장";
      }
    }
  }

  scan(formLines, "form");
  scan(archLines, "arch");

  var sourceLabel = "없음";
  if (hitForm && hitArch) sourceLabel = "양식✓ 마감✓";
  else if (hitForm) sourceLabel = "양식만";
  else if (hitArch) sourceLabel = "마감만";

  return {
    key: key || (inv ? "송장?" : ""),
    uid: uid,
    qtyForm: qtyForm,
    qtyArch: qtyArch,
    sourceLabel: sourceLabel,
    hitForm: hitForm,
    hitArch: hitArch,
  };
}

function _pstmt_buildStatus_(row, mapped, priceDiff, amtDiff, match, settings) {
  var notes = [];
  var icon = "✅";
  if (!mapped.mapped) {
    notes.push("UNMAPPED");
    icon = "⚠️";
  }
  if (mapped.mapped && Math.abs(priceDiff) > settings.priceTol) {
    notes.push("PRICE_DIFF");
    icon = "❌";
  }
  if (row.invoice && !match.hitForm && !match.hitArch) {
    notes.push("NO_ORDER");
    if (icon === "✅") icon = "⚠️";
  }
  return { icon: icon, note: notes.join(",") };
}

// ═══════════════════════════════════════════
//  출력
// ═══════════════════════════════════════════

function _pstmt_writeCanonTab_(ss, rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push([
      r.rowNum, r.date, r.itemName, r.spec, r.qty,
      r.unitPriceExVat, r.supplyAmt, r.vatAmt,
      r.unitPriceIncVat, r.amountIncVat,
      r.invoice, r.recipient, r.rowType, r.channel,
    ]);
  }
  _pstmt_writeTable_(ss, _PSTMT_TAB_CANON, _PSTMT_CANON_HEADERS_, out);
}

function _pstmt_writeTable_(ss, tabName, headers, rows) {
  var tab = ss.getSheetByName(tabName);
  if (!tab) return;
  tab.clear();
  tab.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setBackground("#455a64").setFontColor("#ffffff");
  if (rows.length) {
    tab.getRange(2, 1, rows.length + 1, headers.length).setValues(rows);
  }
  tab.setFrozenRows(1);
}

function _pstmt_updateSummaryParse_(ss, pack) {
  var tab = ss.getSheetByName(_PSTMT_TAB_SUMMARY);
  if (!tab) return;
  var ts = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  tab.getRange("B2").setValue(ts);
  tab.getRange("B3").setValue(pack.rows.length);
  tab.getRange("B4").setValue(pack.totals.supply);
  tab.getRange("B5").setValue(pack.totals.incVat);
  if (pack.totals.summaryOk) {
    var diff = Math.abs(pack.totals.supply - pack.totals.summarySupply);
    tab.getRange("B11").setValue(diff <= 1 ? "✅ 일치" : "⚠️ 차이 " + diff);
  }
}

function _pstmt_updateSummaryReconcile_(ss, pack, results) {
  var tab = ss.getSheetByName(_PSTMT_TAB_SUMMARY);
  if (!tab) return;
  var quoteSum = 0;
  var priceDiffSum = 0;
  for (var i = 0; i < results.length; i++) {
    quoteSum += _pstmt_parseNumber_(results[i][14]);
    priceDiffSum += _pstmt_parseNumber_(results[i][12]);
  }
  tab.getRange("B6").setValue(quoteSum);
  tab.getRange("B7").setValue(priceDiffSum);
  tab.getRange("B8").setValue(_pstmt_countMatch_(results, "양식"));
  tab.getRange("B9").setValue(_pstmt_countMatch_(results, "마감"));
  tab.getRange("B10").setValue(_pstmt_countNote_(results, "UNMAPPED"));
}

function _pstmt_countMatch_(results, token) {
  var n = 0;
  for (var i = 0; i < results.length; i++) {
    if (String(results[i][17] || "").indexOf(token) !== -1) n++;
  }
  return n;
}

function _pstmt_countNote_(results, token) {
  var n = 0;
  for (var i = 0; i < results.length; i++) {
    if (String(results[i][18] || "").indexOf(token) !== -1) n++;
  }
  return n;
}

function _pstmt_formatDateYmd_(dateStr, monthStr) {
  var s = String(dateStr || "").trim();
  var m = s.match(/(\d{1,2})[\/.\-](\d{1,2})/);
  if (m) {
    var tm = _pstmt_parseTargetMonth_(monthStr);
    return tm.yyyy + ("0" + m[1]).slice(-2) + ("0" + m[2]).slice(-2);
  }
  var tm2 = _pstmt_parseTargetMonth_(monthStr);
  return tm2.yyyy + ("0" + tm2.m).slice(-2) + "01";
}
