/**
 * [협력업체] 도서산간 추가배송비 시스템  v2.2
 * 파일: _partnerIslandShipping.gs
 *
 * ★ v2.2 (2026-07-16):
 *   - 허브/업체 열을 헤더명「도서산간배송비」로 동적 탐지 (Q=17 고정 버그 수정)
 *   - 발주탭 ARRAYFORMULA 스필로 getLastRow() 부풀림 → C열 기준 실데이터 행만 처리
 *   - UID 정규화 + 소스 P열 외 인접열 폴백
 *   - 매칭 0건 시 진단 메시지 강화
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

/** 허브: 상태(O=15) 다음 열(P=16) 기본 — 예전 Q=17 고정을 폐기 */
var _ISLAND_HUB_COL_FALLBACK     = 16;
/** 업체 발주탭: O=15 도서산간배송비 */
var _ISLAND_PARTNER_COL_FALLBACK = 15;

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

  var uidBoxMap = _island_loadIslandUidBoxMap_();
  if (!uidBoxMap || Object.keys(uidBoxMap).length === 0) {
    ui.alert(
      "ℹ️ 도서산간 탭에서 UID를 읽지 못했습니다.\n\n" +
      "확인:\n" +
      "1) 소스 시트의 도서산간 탭(P열)에 UID가 있는지\n" +
      "2) 시트/탭 접근 권한"
    );
    return;
  }

  var totalIslandUids = Object.keys(uidBoxMap).length;

  var hubResult = _island_applyToHub_(uidBoxMap);

  var partnerResult = { applied: 0, skipped: 0, files: 0, errors: [], unmatchedHint: "" };
  if (hubResult.vendorNames && hubResult.vendorNames.length > 0) {
    partnerResult = _island_applyToPartnerSheets_(uidBoxMap, hubResult.vendorNames);
  }

  var elapsed = Math.round((Date.now() - t0) / 1000);
  var feeColLabel = hubResult.feeCol || _ISLAND_HUB_COL_FALLBACK;

  var msg = "🏝️ 도서산간 추가배송비 적용 완료 (" + elapsed + "초)\n" +
    "═══════════════════════════════\n" +
    "도서산간 탭 UID: " + totalIslandUids + "건\n" +
    "허브 매칭: " + hubResult.matched + "건 (열=" + feeColLabel + ")\n\n" +
    "── 허브 도서산간배송비 ──\n" +
    "  적용: " + hubResult.applied + "건 / 이미있음: " + hubResult.skipped + "건\n\n" +
    "── 업체 발주탭 (" + (hubResult.vendorNames ? hubResult.vendorNames.length : 0) + "개 업체) ──\n" +
    "  적용: " + partnerResult.applied + "건 / 이미있음: " + partnerResult.skipped + "건";

  if (hubResult.matched === 0) {
    msg += "\n\n⚠ 허브에서 UID 매칭 0건입니다.\n" +
      "도서산간 탭 UID ↔ 허브 C열(고유ID) 형식이 같은지 확인하세요.\n" +
      "샘플 UID: " + Object.keys(uidBoxMap).slice(0, 3).join(", ");
  }

  if (hubResult.errors.length > 0 || partnerResult.errors.length > 0) {
    msg += "\n\n⚠ 오류:\n" + hubResult.errors.concat(partnerResult.errors).slice(0, 8).join("\n");
  }

  ui.alert("도서산간 추가배송비", msg.substring(0, 4500), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  도서산간 탭 로드
// ═══════════════════════════════════════════

function _island_normUid_(raw) {
  return String(raw || "")
    .replace(/\u00a0/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s/g, "")
    .trim();
}

function _island_loadIslandUidBoxMap_() {
  try {
    var ss = SpreadsheetApp.openById(_ISLAND_SOURCE_SHEET_ID);
    var tab = _pt_getSheetByGid(ss, _ISLAND_SOURCE_TAB_GID);
    if (!tab) {
      Logger.log("[도서산간] GID 탭 없음: " + _ISLAND_SOURCE_TAB_GID);
      return null;
    }
    var lr = tab.getLastRow();
    var lc = tab.getLastColumn();
    if (lr < 2) return null;

    // P열(16) 우선, 비면 O~R(15~18)에서 UID 형태 열 탐색
    var tryCols = [16, 15, 17, 18, 14];
    var map = {};
    var usedCol = 0;

    for (var ti = 0; ti < tryCols.length; ti++) {
      var col = tryCols[ti];
      if (lc < col) continue;
      var numRows = lr - 1;
      if (numRows < 1) continue;
      var data = tab.getRange(2, col, numRows, 1).getDisplayValues();
      var tmp = {};
      var hits = 0;
      for (var i = 0; i < data.length; i++) {
        var uid = _island_normUid_(data[i][0]);
        if (!uid) continue;
        // UID 형태: 숫자/하이픈 조합 (너무 짧은 한글 헤더 제외)
        if (uid.length < 4) continue;
        if (/^[가-힣]+$/.test(uid)) continue;
        tmp[uid] = (tmp[uid] || 0) + 1;
        hits++;
      }
      if (hits > 0) {
        map = tmp;
        usedCol = col;
        break;
      }
    }

    Logger.log("[도서산간] 소스 열=" + usedCol + ", UID=" + Object.keys(map).length + "건");
    return Object.keys(map).length ? map : null;
  } catch (e) {
    Logger.log("[도서산간] 소스 로드 실패: " + e.message);
    return null;
  }
}

// ═══════════════════════════════════════════
//  열 탐지 유틸
// ═══════════════════════════════════════════

/** 헤더 행에서 「도서산간」포함 열 찾기 (1-based). 없으면 0 */
function _island_findFeeCol1_(headers) {
  if (!headers || !headers.length) return 0;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "");
    if (h.indexOf("도서산간") !== -1) return i + 1;
  }
  return 0;
}

function _island_findStatusCol0_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h === "상태" || h === "상태(자동)" || h.indexOf("status") !== -1) return i;
  }
  return -1;
}

function _island_findUidCol0_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h.indexOf("고유id") !== -1 || h.indexOf("uniqueid") !== -1 || h === "uid") return i;
  }
  // 폴백: 업체 발주탭 M열(12), 허브 C열(2)
  return -1;
}

function _island_findQtyCol0_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h === "수량" || h.indexOf("박스수량") !== -1 || h.indexOf("판매수량") !== -1 ||
        h.indexOf("택배수량") !== -1 || h.indexOf("택배박스수량") !== -1) return i;
  }
  return -1;
}

/** ARRAYFORMULA 스필로 lastRow가 부풀어 있을 때 C열(코드) 기준 실데이터 끝행 */
function _island_findLastDataRow_(tab, codeCol1) {
  var lr = tab.getLastRow();
  if (lr < 2) return 1;
  var maxScan = Math.min(lr, 2000);
  var col = codeCol1 || 3;
  var vals = tab.getRange(2, col, maxScan - 1, 1).getDisplayValues();
  var last = 1;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim()) last = i + 2;
  }
  return last;
}

// ═══════════════════════════════════════════
//  허브 적용
// ═══════════════════════════════════════════

function _island_applyToHub_(uidBoxMap) {
  var result = {
    applied: 0, skipped: 0, matched: 0, errors: [], vendorNames: [], feeCol: 0
  };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
    if (!hubTab || hubTab.getLastRow() < 2) return result;

    var feeCol = _island_ensureHubFeeCol_(hubTab);
    result.feeCol = feeCol;

    var hubLr = _island_findLastDataRow_(hubTab, 5); // E=이카운트코드 (또는 C=고유ID)
    if (hubLr < 2) hubLr = hubTab.getLastRow();
    // C열(고유ID) 기준으로 다시
    hubLr = Math.max(hubLr, _island_findLastDataRow_(hubTab, 3));
    if (hubLr < 2) return result;

    var readCols = Math.max(hubTab.getLastColumn(), feeCol, 15);
    var numRows = hubLr - 1;
    var hubData = hubTab.getRange(2, 1, numRows, readCols).getValues();
    var headers = hubTab.getRange(1, 1, 1, readCols).getDisplayValues()[0];

    var uidCol0 = _island_findUidCol0_(headers);
    if (uidCol0 < 0) uidCol0 = 2; // C열
    var statusCol0 = _island_findStatusCol0_(headers);
    if (statusCol0 < 0) statusCol0 = 14; // O열
    var qtyCol0 = _island_findQtyCol0_(headers);
    if (qtyCol0 < 0) qtyCol0 = 6; // G열

    var feeArr = [];
    for (var i = 0; i < hubData.length; i++) {
      feeArr.push([hubData[i][feeCol - 1]]);
    }

    var vendorSet = {};
    var changedRows = [];

    for (var r = 0; r < hubData.length; r++) {
      var uid = _island_normUid_(hubData[r][uidCol0]);
      if (!uid || !uidBoxMap[uid]) continue;

      result.matched++;

      var existing = Number(hubData[r][feeCol - 1]) || 0;
      if (existing > 0) {
        result.skipped++;
        var vn0 = String(hubData[r][1] || "").trim();
        if (vn0) vendorSet[vn0] = true;
        continue;
      }

      var status = statusCol0 >= 0 ? String(hubData[r][statusCol0] || "").trim() : "";
      var isCombinedShip = status.indexOf("합배송") !== -1;
      var qty = parseFloat(hubData[r][qtyCol0]) || 1;
      var boxes = isCombinedShip ? 1 : (uidBoxMap[uid] * qty);
      var fee = boxes * _ISLAND_FEE_PER_QTY;

      feeArr[r][0] = fee;
      changedRows.push(_island_colToLetter_(feeCol) + (r + 2));
      result.applied++;

      var vendorName = String(hubData[r][1] || "").trim();
      if (vendorName) vendorSet[vendorName] = true;
    }

    if (changedRows.length > 0) {
      hubTab.getRange(2, feeCol, feeArr.length, 1).setValues(feeArr);
      hubTab.getRangeList(changedRows)
        .setNumberFormat("#,##0")
        .setFontColor(_ISLAND_FONT_COLOR)
        .setFontWeight("bold")
        .setBackground(_ISLAND_BG_COLOR);
      _island_addConditionalFormatRule_(hubTab, "A2:" + _island_colToLetter_(feeCol) + "5000", feeCol);
      SpreadsheetApp.flush();
    }

    for (var vn in vendorSet) result.vendorNames.push(vn);

  } catch (e) {
    result.errors.push("[허브] " + e.message);
  }

  return result;
}

/** 허브에 도서산간배송비 열 확보 → 1-based 열번호 */
function _island_ensureHubFeeCol_(hubTab) {
  var lc = Math.max(hubTab.getLastColumn(), 15);
  var headers = hubTab.getRange(1, 1, 1, lc).getDisplayValues()[0];
  var found = _island_findFeeCol1_(headers);
  if (found > 0) return found;

  // 상태 열 다음(기본 P=16)
  var status0 = _island_findStatusCol0_(headers);
  var target = status0 >= 0 ? status0 + 2 : _ISLAND_HUB_COL_FALLBACK; // 1-based = index+2 for next col... 
  // status0 is 0-based → status col 1-based = status0+1 → next = status0+2
  if (status0 >= 0) target = status0 + 2;
  else target = _ISLAND_HUB_COL_FALLBACK;

  var maxCol = hubTab.getLastColumn();
  if (maxCol < target) {
    hubTab.insertColumnsAfter(maxCol, target - maxCol);
  }
  hubTab.getRange(1, target)
    .setValue("도서산간배송비")
    .setBackground(_ISLAND_HEADER_BG)
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  hubTab.setColumnWidth(target, 120);
  return target;
}

// ═══════════════════════════════════════════
//  업체 시트 적용
// ═══════════════════════════════════════════

function _island_applyToPartnerSheets_(uidBoxMap, vendorNames) {
  var result = { applied: 0, skipped: 0, files: 0, errors: [] };

  var files = _pt_listFiles();
  if (!files || !files.length) return result;

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
  if (targetFiles.length === 0) targetFiles = files;

  for (var f = 0; f < targetFiles.length; f++) {
    try {
      var ss = SpreadsheetApp.openById(targetFiles[f].id);
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (!orderTab || orderTab.getLastRow() < 2) continue;

      var feeCol = _island_ensurePartnerFeeCol_(orderTab);
      var dataLr = _island_findLastDataRow_(orderTab, 3); // C=이카운트코드
      if (dataLr < 2) continue;

      var readCols = Math.max(orderTab.getLastColumn(), feeCol, 15);
      var numRows = dataLr - 1;
      var data = orderTab.getRange(2, 1, numRows, readCols).getValues();
      var headers = orderTab.getRange(1, 1, 1, readCols).getDisplayValues()[0];

      var uidColIdx = _island_findUidCol0_(headers);
      if (uidColIdx < 0) uidColIdx = 12; // M열 폴백
      var statusColIdx = _island_findStatusCol0_(headers);
      var qtyColIdx = _island_findQtyCol0_(headers);

      var oColArr = [];
      for (var i = 0; i < data.length; i++) {
        oColArr.push([data[i][feeCol - 1]]);
      }

      var changedRows = [];

      for (var r = 0; r < data.length; r++) {
        var uid = _island_normUid_(data[r][uidColIdx]);
        if (!uid || !uidBoxMap[uid]) continue;

        var existing = Number(data[r][feeCol - 1]) || 0;
        if (existing > 0) { result.skipped++; continue; }

        var status = statusColIdx !== -1 ? String(data[r][statusColIdx] || "").trim() : "";
        var isCombinedShip = status.indexOf("합배송") !== -1;
        var qty = qtyColIdx !== -1 ? (parseFloat(data[r][qtyColIdx]) || 1) : 1;
        var boxes = isCombinedShip ? 1 : (uidBoxMap[uid] * qty);
        var fee = boxes * _ISLAND_FEE_PER_QTY;

        oColArr[r][0] = fee;
        changedRows.push(_island_colToLetter_(feeCol) + (r + 2));
      }

      if (changedRows.length > 0) {
        orderTab.getRange(2, feeCol, oColArr.length, 1).setValues(oColArr);
        orderTab.getRangeList(changedRows)
          .setNumberFormat("#,##0")
          .setFontColor(_ISLAND_FONT_COLOR)
          .setFontWeight("bold");
        _island_addConditionalFormatRule_(
          orderTab,
          "A2:" + _island_colToLetter_(feeCol) + "5000",
          feeCol
        );
        result.files++;
        result.applied += changedRows.length;
      }

      SpreadsheetApp.flush();

    } catch (e) {
      result.errors.push("[" + targetFiles[f].name.replace("[협력업체] ", "") + "] " + e.message);
    }
  }

  return result;
}

function _island_ensurePartnerFeeCol_(orderTab) {
  var lc = Math.max(orderTab.getLastColumn(), 14);
  var headers = orderTab.getRange(1, 1, 1, lc).getDisplayValues()[0];
  var found = _island_findFeeCol1_(headers);
  if (found > 0) return found;

  var target = _ISLAND_PARTNER_COL_FALLBACK; // O=15
  var maxCol = orderTab.getLastColumn();
  if (maxCol < target) {
    orderTab.insertColumnsAfter(maxCol, target - maxCol);
  }
  var h = String(orderTab.getRange(1, target).getDisplayValue() || "").trim();
  if (!h || h.indexOf("도서산간") === -1) {
    orderTab.getRange(1, target)
      .setValue("도서산간배송비")
      .setBackground(_ISLAND_HEADER_BG)
      .setFontColor("white")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    orderTab.setColumnWidth(target, 120);
  }
  return target;
}

// 하위 호환 별칭
function _island_ensureHubHeader_(hubTab) { _island_ensureHubFeeCol_(hubTab); }
function _island_ensurePartnerHeader_(orderTab) { _island_ensurePartnerFeeCol_(orderTab); }
function _island_findUidCol_(headers) { return _island_findUidCol0_(headers); }
function _island_findStatusCol_(headers) { return _island_findStatusCol0_(headers); }
function _island_findQtyCol_(headers) { return _island_findQtyCol0_(headers); }

// ═══════════════════════════════════════════
//  조건부서식
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
        if (v && v.length > 0 && String(v[0]).indexOf("$" + colLetter + "2") !== -1 &&
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
