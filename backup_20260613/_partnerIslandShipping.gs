/**
 * [협력업체] 도서산간 추가배송비 시스템  v2.1  (배치 API 최적화)
 * 파일: _partnerIslandShipping.gs
 *
 * ★ v2.1 핵심 최적화:
 *   - Q열/O열 전체를 배열로 읽고 → 메모리에서 수정 → 한번에 setValues() (1회 API)
 *   - getRangeList()로 서식 일괄 적용 (1회 API)
 *   - 매칭된 거래처 업체만 열기
 *   - 예상: 176초 → 15~30초
 *
 * ★ 세트/합배송:
 *   - 세트: 도서산간탭행수 × 수량 × 단가
 *   - 합배송: 1박스 × 단가 (5,000원)
 */

// ═══════════════════════════════════════════
//  상수
// ═══════════════════════════════════════════
var _ISLAND_FEE_PER_QTY   = 5000;
var _ISLAND_BG_COLOR      = "#e8d5f5";
var _ISLAND_FONT_COLOR    = "#4a148c";
var _ISLAND_HEADER_BG     = "#7b1fa2";

var _ISLAND_SOURCE_SHEET_ID = "1vWdJgmbW_Gwm_2b1pP8mVBxpfYBbUiAduSwkStXxs0Y";
var _ISLAND_SOURCE_TAB_GID  = 1971071523;

var _ISLAND_HUB_COL       = 17;
var _ISLAND_PARTNER_COL   = 15;

// ═══════════════════════════════════════════
//  메뉴 진입점
// ═══════════════════════════════════════════

function partnerCheckIslandShipping() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    ui.alert("⚠ 다른 작업 진행 중. 잠시 후 다시 시도해주세요.");
    return;
  }
  try {
    _island_core_(ui);
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════
//  핵심 로직
// ═══════════════════════════════════════════

function _island_core_(ui) {
  var t0 = Date.now();

  // ① 도서산간 탭 → UID→박스수 맵
  var uidBoxMap = _island_loadIslandUidBoxMap_();
  if (!uidBoxMap || Object.keys(uidBoxMap).length === 0) {
    ui.alert("ℹ️ 도서산간 탭에 데이터가 없습니다.");
    return;
  }

  var totalIslandUids = Object.keys(uidBoxMap).length;

  // ② 허브 적용 + 거래처명 수집
  var hubResult = _island_applyToHub_(uidBoxMap);

  // ③ 매칭된 업체만 적용
  var partnerResult = { applied: 0, skipped: 0, files: 0, errors: [] };
  if (hubResult.vendorNames && hubResult.vendorNames.length > 0) {
    partnerResult = _island_applyToPartnerSheets_(uidBoxMap, hubResult.vendorNames);
  }

  var elapsed = Math.round((Date.now() - t0) / 1000);

  var msg = "🏝️ 도서산간 추가배송비 적용 완료 (" + elapsed + "초)\n" +
    "═══════════════════════════════\n" +
    "도서산간 탭: " + totalIslandUids + "건\n\n" +
    "── 허브 Q열 ──\n" +
    "  적용: " + hubResult.applied + "건 / 스킵: " + hubResult.skipped + "건\n\n" +
    "── 업체 O열 (" + hubResult.vendorNames.length + "개 업체) ──\n" +
    "  적용: " + partnerResult.applied + "건 / 스킵: " + partnerResult.skipped + "건";

  if (hubResult.errors.length > 0 || partnerResult.errors.length > 0) {
    msg += "\n\n⚠ 오류:\n" + hubResult.errors.concat(partnerResult.errors).slice(0, 5).join("\n");
  }

  ui.alert("도서산간 추가배송비", msg, ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  도서산간 탭 로드
// ═══════════════════════════════════════════

function _island_loadIslandUidBoxMap_() {
  try {
    var ss = SpreadsheetApp.openById(_ISLAND_SOURCE_SHEET_ID);
    var tab = _pt_getSheetByGid(ss, _ISLAND_SOURCE_TAB_GID);
    if (!tab) return null;
    var lr = tab.getLastRow();
    if (lr < 2 || tab.getLastColumn() < 16) return null;

    var data = tab.getRange(2, 16, lr - 1, 1).getValues();
    var map = {};
    for (var i = 0; i < data.length; i++) {
      var uid = String(data[i][0] || "").trim();
      if (uid) map[uid] = (map[uid] || 0) + 1;
    }
    return map;
  } catch (e) {
    Logger.log("[도서산간] 소스 로드 실패: " + e.message);
    return null;
  }
}

// ═══════════════════════════════════════════
//  허브 Q열 적용 (배치 API)
// ═══════════════════════════════════════════

function _island_applyToHub_(uidBoxMap) {
  var result = { applied: 0, skipped: 0, matched: 0, errors: [], vendorNames: [] };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
    if (!hubTab || hubTab.getLastRow() < 2) return result;

    _island_ensureHubHeader_(hubTab);

    var hubLr = hubTab.getLastRow();
    var readCols = Math.max(hubTab.getLastColumn(), _ISLAND_HUB_COL);
    var hubData = hubTab.getRange(2, 1, hubLr - 1, readCols).getValues();

    // ★ Q열(17번째) 전체를 배열로 복사 — 메모리에서 수정 후 한번에 기입
    var qColArr = [];
    for (var i = 0; i < hubData.length; i++) {
      qColArr.push([hubData[i][_ISLAND_HUB_COL - 1]]);
    }

    var vendorSet = {};
    var changedRows = [];  // 서식 적용할 행 번호 (A1 표기)

    for (var r = 0; r < hubData.length; r++) {
      var uid = String(hubData[r][2] || "").trim();
      if (!uid || !uidBoxMap[uid]) continue;

      result.matched++;

      var existing = Number(hubData[r][_ISLAND_HUB_COL - 1]) || 0;
      if (existing > 0) {
        result.skipped++;
        var vn = String(hubData[r][1] || "").trim(); // B열=발주업체
        if (vn) vendorSet[vn] = true;
        continue;
      }

      var status = String(hubData[r][14] || "").trim();
      var isCombinedShip = status.indexOf("합배송") !== -1;
      var qty = parseFloat(hubData[r][6]) || 1;
      var boxes = isCombinedShip ? 1 : (uidBoxMap[uid] * qty);
      var fee = boxes * _ISLAND_FEE_PER_QTY;

      qColArr[r][0] = fee;  // 메모리에서 수정
      changedRows.push("Q" + (r + 2));
      result.applied++;

      var vendorName = String(hubData[r][1] || "").trim(); // B열=발주업체
      if (vendorName) vendorSet[vendorName] = true;
    }

    if (changedRows.length > 0) {
      // ★ 1회 API: Q열 전체 한번에 기입
      hubTab.getRange(2, _ISLAND_HUB_COL, qColArr.length, 1).setValues(qColArr);

      // ★ 1회 API: 변경된 셀들 서식 일괄 적용
      hubTab.getRangeList(changedRows)
        .setNumberFormat("#,##0")
        .setFontColor(_ISLAND_FONT_COLOR)
        .setFontWeight("bold")
        .setBackground(_ISLAND_BG_COLOR);

      // 조건부서식 (최초 1회)
      _island_addConditionalFormatRule_(hubTab, "A2:Q5000", _ISLAND_HUB_COL);
      SpreadsheetApp.flush();
    }

    for (var vn in vendorSet) result.vendorNames.push(vn);

  } catch (e) {
    result.errors.push("[허브] " + e.message);
  }

  return result;
}

function _island_ensureHubHeader_(hubTab) {
  try {
    var maxCol = hubTab.getLastColumn();
    if (maxCol < _ISLAND_HUB_COL) {
      hubTab.insertColumnsAfter(maxCol, _ISLAND_HUB_COL - maxCol);
    }
    var h = String(hubTab.getRange(1, _ISLAND_HUB_COL).getValue() || "").trim();
    if (!h) {
      hubTab.getRange(1, _ISLAND_HUB_COL)
        .setValue("도서산간배송비")
        .setBackground(_ISLAND_HEADER_BG)
        .setFontColor("white")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
      hubTab.setColumnWidth(_ISLAND_HUB_COL, 120);
    }
  } catch (e) {}
}

// ═══════════════════════════════════════════
//  업체 시트 O열 적용 (배치 API + 매칭 업체만)
// ═══════════════════════════════════════════

function _island_applyToPartnerSheets_(uidBoxMap, vendorNames) {
  var result = { applied: 0, skipped: 0, files: 0, errors: [] };

  var files = _pt_listFiles();
  if (!files || !files.length) return result;

  // 거래처명으로 파일 필터
  var targetFiles = [];
  for (var fi = 0; fi < files.length; fi++) {
    var fn = files[fi].name.replace("[협력업체] ", "").replace("[협력업체]_", "");
    for (var vi = 0; vi < vendorNames.length; vi++) {
      if (fn.indexOf(vendorNames[vi]) !== -1 ||
          vendorNames[vi].indexOf(fn.split(" ")[0]) !== -1) {
        targetFiles.push(files[fi]);
        break;
      }
    }
  }
  if (targetFiles.length === 0) targetFiles = files; // 안전장치

  for (var fi = 0; fi < targetFiles.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(targetFiles[fi].id);
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (!orderTab || orderTab.getLastRow() < 2) continue;

      var lr = orderTab.getLastRow();
      var lc = orderTab.getLastColumn();
      _island_ensurePartnerHeader_(orderTab);
      var readCols = Math.max(lc, _ISLAND_PARTNER_COL);
      var data = orderTab.getRange(2, 1, lr - 1, readCols).getValues();

      var headers = orderTab.getRange(1, 1, 1, readCols).getValues()[0];
      var uidColIdx = _island_findUidCol_(headers);
      if (uidColIdx === -1) continue;
      var statusColIdx = _island_findStatusCol_(headers);
      var qtyColIdx = _island_findQtyCol_(headers);

      // ★ O열 배열 복사
      var oColArr = [];
      for (var i = 0; i < data.length; i++) {
        oColArr.push([data[i][_ISLAND_PARTNER_COL - 1]]);
      }

      var changedRows = [];

      for (var r = 0; r < data.length; r++) {
        var uid = String(data[r][uidColIdx] || "").trim();
        if (!uid || !uidBoxMap[uid]) continue;

        var existing = Number(data[r][_ISLAND_PARTNER_COL - 1]) || 0;
        if (existing > 0) { result.skipped++; continue; }

        var status = statusColIdx !== -1 ? String(data[r][statusColIdx] || "").trim() : "";
        var isCombinedShip = status.indexOf("합배송") !== -1;
        var qty = qtyColIdx !== -1 ? (parseFloat(data[r][qtyColIdx]) || 1) : 1;
        var boxes = isCombinedShip ? 1 : (uidBoxMap[uid] * qty);
        var fee = boxes * _ISLAND_FEE_PER_QTY;

        oColArr[r][0] = fee;
        changedRows.push("O" + (r + 2));
      }

      if (changedRows.length > 0) {
        // ★ 1회 API: O열 한번에 기입
        orderTab.getRange(2, _ISLAND_PARTNER_COL, oColArr.length, 1).setValues(oColArr);

        // ★ 1회 API: 서식 일괄 (배경색은 조건부서식이 처리 → 직접 setBackground 안 함)
        orderTab.getRangeList(changedRows)
          .setNumberFormat("#,##0")
          .setFontColor(_ISLAND_FONT_COLOR)
          .setFontWeight("bold");

        _island_addConditionalFormatRule_(orderTab, "A2:O5000", _ISLAND_PARTNER_COL);
        result.files++;
        result.applied += changedRows.length;
      }

      SpreadsheetApp.flush();

    } catch (e) {
      result.errors.push("[" + targetFiles[fi].name.replace("[협력업체] ", "") + "] " + e.message);
    }
  }

  return result;
}

function _island_ensurePartnerHeader_(orderTab) {
  try {
    var maxCol = orderTab.getLastColumn();
    if (maxCol < _ISLAND_PARTNER_COL) {
      orderTab.insertColumnsAfter(maxCol, _ISLAND_PARTNER_COL - maxCol);
    }
    var h = String(orderTab.getRange(1, _ISLAND_PARTNER_COL).getValue() || "").trim();
    if (!h) {
      orderTab.getRange(1, _ISLAND_PARTNER_COL)
        .setValue("도서산간배송비")
        .setBackground(_ISLAND_HEADER_BG)
        .setFontColor("white")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
      orderTab.setColumnWidth(_ISLAND_PARTNER_COL, 120);
    }
  } catch (e) {}
}

// ═══════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════

function _island_findUidCol_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h.indexOf("고유id") !== -1 || h.indexOf("uniqueid") !== -1) return i;
  }
  return -1;
}

function _island_findStatusCol_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h === "상태" || h === "상태(자동)" || h.indexOf("status") !== -1) return i;
  }
  return -1;
}

function _island_findQtyCol_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h === "수량" || h.indexOf("박스수량") !== -1 || h.indexOf("판매수량") !== -1 ||
        h.indexOf("택배수량") !== -1 || h.indexOf("택배박스수량") !== -1) return i;
  }
  return -1;
}

// ═══════════════════════════════════════════
//  조건부서식 (최우선 규칙)
// ═══════════════════════════════════════════

function _island_addConditionalFormatRule_(tab, rangeA1, feeCol) {
  try {
    var colLetter = _island_colToLetter_(feeCol);
    var formula = '=AND($' + colLetter + '2<>"", $' + colLetter + '2>0)';

    var existingRules = tab.getConditionalFormatRules() || [];
    for (var i = 0; i < existingRules.length; i++) {
      var bc = existingRules[i].getBooleanCondition();
      if (bc) {
        var v = bc.getCriteriaValues();
        if (v && v.length > 0 && String(v[0]).indexOf(colLetter + "2") !== -1 &&
            String(v[0]).indexOf(">0") !== -1) return;
      }
    }

    existingRules.unshift(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(formula)
        .setBackground(_ISLAND_BG_COLOR)
        .setRanges([tab.getRange(rangeA1)])
        .build()
    );
    tab.setConditionalFormatRules(existingRules);
  } catch (e) {}
}

function _island_colToLetter_(col) {
  var s = "";
  while (col > 0) { col--; s = String.fromCharCode(65 + (col % 26)) + s; col = Math.floor(col / 26); }
  return s;
}
