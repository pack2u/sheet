/**
 * [협력업체] 취소/반품 연동 시스템  v1.1
 * 파일: _partnerCancelReturn.gs
 *
 * 기능:
 *   ③ partnerCollectCancels()      — 각 업체 '취소/반품 접수' 탭 → 허브·발주탭·마감탭 일괄 동기
 *   ① partnerPushCancelStatus()    — 허브 상태(취소/반품) → 각 업체 발주탭 N열 배포
 *      partnerCreateCancelTabAll()  — 전체 업체에 '취소/반품 접수' 탭 일괄 생성/갱신
 *
 * ★ 취소/반품 접수 탭 헤더 (v1.1):
 *   A: 고유ID (입력)
 *   B: 품목명 (자동 ARRAYFORMULA)
 *   C: 수취인 (자동 ARRAYFORMULA)
 *   D: 송장번호 (자동 ARRAYFORMULA)
 *   E: 구분 (취소/반품 드롭다운)
 *   F: 사유 (입력)
 *   G: 반품송장번호 (입력)
 *   H: 처리일시 (자동 — 수집 시 기록)
 */

// ── 상수 ──────────────────────────────────────────────
var _CR_TAB_NAME    = "취소/반품 접수";
var _CR_HEADERS     = ["고유ID", "품목명(자동)", "수취인(자동)", "송장번호(자동)",
                       "구분", "사유", "반품송장번호", "처리일시", "반품배송비",
                       "전화번호(자동)", "주소(자동)", "반품수량"];
var _CR_ORDER_TAB   = "발주 및 송장조회";

// 수집 시 읽는 열 인덱스 (0-based)
var _CR_COL = {
  UID: 0,        // A열: 고유ID
  ITEM: 1,       // B열: 품목명(자동)
  RECIP: 2,      // C열: 수취인(자동)
  INV: 3,        // D열: 송장번호(자동)
  CATEGORY: 4,   // E열: 구분
  REASON: 5,     // F열: 사유
  RET_INV: 6,    // G열: 반품송장번호
  DONE_AT: 7,    // H열: 처리일시
  SHIP_FEE: 8,   // I열: 반품배송비
  PHONE: 9,      // J열: 전화번호(자동)
  ADDR: 10,      // K열: 주소(자동)
  RTN_QTY: 11    // L열: 반품수량
};

// ═══════════════════════════════════════════════════════
//  ③ 취소/반품 수집 — 접수탭 → 허브·발주탭·마감탭 일괄 동기
// ═══════════════════════════════════════════════════════

/** [수동] 취소/반품 수집 실행 */
function partnerCollectCancels() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch(e) {}

  var files = _pt_listFiles();
  if (!files || !files.length) {
    if (ui) ui.alert("협력업체 파일 없음");
    return;
  }

  // 허브 데이터 로드
  var hubSS  = SpreadsheetApp.getActiveSpreadsheet();
  var hubTab = hubSS.getSheetByName("협력업체_발주허브");
  var hubMap = {}; // uid → { row(1-based), status, invoice }
  if (hubTab && hubTab.getLastRow() >= 2) {
    var hubLr   = hubTab.getLastRow();
    var hubData = hubTab.getRange(2, 1, hubLr - 1, 15).getValues();
    for (var hi = 0; hi < hubData.length; hi++) {
      var hUid = String(hubData[hi][2] || "").trim(); // C열=고유ID
      if (hUid) {
        hubMap[hUid] = {
          row: hi + 2,
          status: String(hubData[hi][14] || "").trim(), // O열=상태
          invoice: String(hubData[hi][13] || "").trim()  // N열=송장번호
        };
      }
    }
  }

  var collected = 0, skipped = 0, errors = [];
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");

  for (var fi = 0; fi < files.length; fi++) {
    var file = files[fi];
    try {
      var ss = SpreadsheetApp.openById(file.id);
      var crTab = ss.getSheetByName(_CR_TAB_NAME);
      if (!crTab || crTab.getLastRow() < 2) continue;

      var crLr = crTab.getLastRow();
      var crData = crTab.getRange(2, 1, crLr - 1, _CR_HEADERS.length).getValues();
      var timestamps = []; // 처리 완료 시각 기록용

      for (var r = 0; r < crData.length; r++) {
        var uid      = String(crData[r][_CR_COL.UID] || "").trim();
        var category = String(crData[r][_CR_COL.CATEGORY] || "").trim();
        var reason   = String(crData[r][_CR_COL.REASON] || "").trim();
        var retInv   = String(crData[r][_CR_COL.RET_INV] || "").trim();
        var doneAt   = String(crData[r][_CR_COL.DONE_AT] || "").trim();

        if (!uid || !category) { timestamps.push(doneAt); continue; }
        if (doneAt) { skipped++; timestamps.push(doneAt); continue; } // 이미 처리됨

        // 유효한 구분인지 확인
        var normCat = category.replace(/\s/g, "");
        if (normCat.indexOf("취소") === -1 && normCat.indexOf("반품") === -1) {
          timestamps.push(doneAt);
          continue;
        }
        var statusVal = normCat.indexOf("반품") !== -1 ? "반품" : "취소";

        // ── (1) 허브 상태 업데이트 → ★ 성능최적화: hubData 배열에 사전 반영
        if (hubTab && hubMap[uid]) {
          var hEntry = hubMap[uid];
          var hIdx = hEntry.row - 2;
          if (hIdx >= 0 && hIdx < hubData.length) {
            hubData[hIdx][14] = statusVal; // O열=상태
            if (reason) hubData[hIdx][12] = reason; // M열=적요 → 사유
          }
        }

        // ── (2) 발주탭 N열 상태 업데이트 ──
        _cr_updateOrderTab_(ss, uid, statusVal);

        // ── (3) 마감탭 체크박스 체크 + 반품배송비 기록 (취소완료/반품입고일 때만) ──
        var shipFee = crData[r][_CR_COL.SHIP_FEE] || "";
        _cr_updateArchiveTab_(ss, uid, statusVal, reason, retInv, normCat, shipFee);

        timestamps.push(now); // 처리 완료 시각 기록
        collected++;
      }

      // 처리일시 일괄 기록 (H열 = 8열)
      if (timestamps.length > 0) {
        var tsData = timestamps.map(function(t) { return [t]; });
        crTab.getRange(2, _CR_COL.DONE_AT + 1, tsData.length, 1).setValues(tsData);
        SpreadsheetApp.flush();
      }

    } catch(e) {
      errors.push(file.name + ": " + e.message);
    }
  }

  // ★ 성능최적화: 허브 데이터 배열 일괄 기록
  if (hubTab && hubTab.getLastRow() >= 2) {
    hubTab.getRange(2, 1, hubData.length, 15).setValues(hubData);
    SpreadsheetApp.flush();
  }

  var msg = "📋 취소/반품 수집 완료\n" +
    "- 처리: " + collected + "건\n" +
    "- 이미 처리됨: " + skipped + "건\n" +
    (errors.length > 0 ? "\n⚠ 오류:\n" + errors.slice(0, 5).join("\n") : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ── 발주탭 N열(상태) 업데이트 ──
function _cr_updateOrderTab_(ss, uid, statusVal) {
  var allTabs = ss.getSheets();
  for (var ti = 0; ti < allTabs.length; ti++) {
    var tabName = allTabs[ti].getName();
    if (tabName.indexOf("발주") === -1 || tabName.indexOf("송장") === -1) continue;
    if (tabName.indexOf("마감") !== -1) continue;

    var tab = allTabs[ti];
    var lr = tab.getLastRow();
    if (lr < 2) continue;
    var lc = Math.max(tab.getLastColumn(), 14);
    var data = tab.getRange(1, 1, lr, lc).getValues();
    var cMap = _po_buildColMap(data[0]);
    if (cMap.uniqueId === -1 || cMap.status === -1) continue;

    for (var r = 1; r < data.length; r++) {
      var rowUid = String(data[r][cMap.uniqueId] || "").trim();
      if (rowUid === uid) {
        tab.getRange(r + 1, cMap.status + 1).setValue(statusVal);
        return;
      }
    }
  }
}

// ── 마감탭 체크박스 + 반품배송비 업데이트 ──
// ★ 체크박스는 "취소완료" / "반품입고"일 때만 체크
// ★ 2026-06-13 최적화: 개별 setValue() 최대 5회 → 행 단위 setValues() 1회로 통합
function _cr_updateArchiveTab_(ss, uid, statusVal, reason, retInv, originalCat, shipFee) {
  var tabPattern = /\(\d{4}년 \d{1,2}월\) 발주 마감/;
  var allTabs = ss.getSheets();
  var cat = (originalCat || "").replace(/\s/g, "");

  for (var ti = 0; ti < allTabs.length; ti++) {
    var tabName = allTabs[ti].getName();
    if (!tabPattern.test(tabName)) continue;

    var tab = allTabs[ti];
    var lr = tab.getLastRow();
    if (lr < 5) continue;
    var lc = tab.getMaxColumns();
    var data = tab.getRange(1, 1, lr, lc).getValues();

    var hdr = data[3]; // 4행 = index 3
    var uidCol = -1, cancelCol = -1, returnCol = -1, reasonCol = -1, retInvCol = -1, shipFeeCol = -1;
    for (var c = 0; c < hdr.length; c++) {
      var h = String(hdr[c] || "").replace(/\s/g, "");
      if (uidCol === -1 && h.indexOf("고유ID") !== -1) uidCol = c;
      if (cancelCol === -1 && h === "취소") cancelCol = c;
      if (returnCol === -1 && h === "반품") returnCol = c;
      if (reasonCol === -1 && h === "취소반품사유") reasonCol = c;
      if (retInvCol === -1 && h === "반품송장번호") retInvCol = c;
      if (shipFeeCol === -1 && h === "반품배송비") shipFeeCol = c;
    }
    if (uidCol === -1) continue;

    for (var r = 4; r < data.length; r++) {
      var rowUid = String(data[r][uidCol] || "").trim();
      if (rowUid !== uid) continue;

      // ★ 행 데이터를 메모리에서 수정 후 1회 기록
      var rowData = data[r].slice(); // 복사
      var changed = false;

      if (cat === "취소완료" && cancelCol !== -1) {
        rowData[cancelCol] = true; changed = true;
      }
      if (cat === "반품입고" && returnCol !== -1) {
        rowData[returnCol] = true; changed = true;
      }
      if (reason && reasonCol !== -1) {
        rowData[reasonCol] = reason; changed = true;
      }
      if (retInv && retInvCol !== -1) {
        rowData[retInvCol] = retInv; changed = true;
      }
      if (shipFee && shipFeeCol !== -1) {
        var feeNum = parseFloat(String(shipFee).replace(/[^0-9.-]/g, ""));
        if (!isNaN(feeNum) && feeNum > 0) {
          rowData[shipFeeCol] = feeNum; changed = true;
        }
      }

      if (changed) {
        tab.getRange(r + 1, 1, 1, lc).setValues([rowData]);
      }
      return;
    }
  }
}


// ═══════════════════════════════════════════════════════
//  ① 취소/반품 배포 — 허브 상태(취소/반품) → 각 업체 발주탭 N열
// ═══════════════════════════════════════════════════════

/** [수동] 허브 취소/반품 상태 → 발주탭 배포 */
function partnerPushCancelStatus() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch(e) {}

  var hubTab = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("협력업체_발주허브");
  if (!hubTab || hubTab.getLastRow() < 2) {
    if (ui) ui.alert("허브에 데이터가 없습니다.");
    return;
  }

  var hubLr   = hubTab.getLastRow();
  var hubData = hubTab.getRange(2, 1, hubLr - 1, 15).getValues();

  var cancelByUid = {};
  for (var i = 0; i < hubData.length; i++) {
    var uid    = String(hubData[i][2] || "").trim();
    var status = String(hubData[i][14] || "").trim();
    var memo   = String(hubData[i][12] || "").trim();

    if (!uid) continue;
    var stN = status.replace(/\s/g, "");
    if (stN.indexOf("취소") !== -1 || stN.indexOf("반품") !== -1) {
      cancelByUid[uid] = { status: status, memo: memo };
    }
  }

  var pendingCount = Object.keys(cancelByUid).length;
  if (pendingCount === 0) {
    if (ui) ui.alert("배포할 취소/반품 건이 없습니다.\n허브 O열(상태)에 '취소' 또는 '반품'을 입력한 후 실행하세요.");
    return;
  }

  if (ui) {
    var cf = ui.alert("취소/반품 배포",
      pendingCount + "건의 취소/반품 상태를 각 업체 발주탭으로 배포합니다.\n계속할까요?",
      ui.ButtonSet.YES_NO);
    if (cf !== ui.Button.YES) return;
  }

  var files = _pt_listFiles();
  var pushed = 0, errors = [];

  for (var fi = 0; fi < files.length; fi++) {
    var file = files[fi];
    try {
      var ss = SpreadsheetApp.openById(file.id);
      var allTabs = ss.getSheets();

      for (var ti = 0; ti < allTabs.length; ti++) {
        var tabName = allTabs[ti].getName();
        if (!_po_isOrderTab(tabName)) continue;

        var tab = allTabs[ti];
        var lr = tab.getLastRow();
        if (lr < 2) continue;
        var lc = Math.max(tab.getLastColumn(), 14);
        var data = tab.getRange(1, 1, lr, lc).getValues();
        var cMap = _po_buildColMap(data[0]);
        if (cMap.uniqueId === -1 || cMap.status === -1) continue;

        var tabChanged = false;
        for (var r = 1; r < data.length; r++) {
          var rowUid = String(data[r][cMap.uniqueId] || "").trim();
          if (!rowUid || !cancelByUid[rowUid]) continue;

          var c = cancelByUid[rowUid];
          var curSt = String(data[r][cMap.status] || "").trim();
          if (curSt === c.status) continue;

          tab.getRange(r + 1, cMap.status + 1).setValue(c.status);
          tabChanged = true;
          pushed++;
        }
        if (tabChanged) SpreadsheetApp.flush();
      }
    } catch(e) {
      errors.push(file.name + ": " + e.message);
    }
  }

  var msg = "📬 취소/반품 배포 완료\n" +
    "- 대상: " + pendingCount + "건\n" +
    "- 배포: " + pushed + "건\n" +
    (errors.length > 0 ? "\n⚠ 오류:\n" + errors.slice(0,5).join("\n") : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}


// ═══════════════════════════════════════════════════════
//  취소/반품 접수 탭 생성/갱신
// ═══════════════════════════════════════════════════════

/** 전체 업체에 취소/반품 접수 탭 일괄 생성/갱신 */
function partnerCreateCancelTabAll() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch(e) {}

  var files = _pt_listFiles();
  if (!files || !files.length) {
    if (ui) ui.alert("협력업체 파일 없음");
    return;
  }

  if (ui) {
    var cf = ui.alert("취소/반품 접수 탭 생성/갱신",
      files.length + "개 파일에 '취소/반품 접수' 탭을 생성/갱신합니다.\n" +
      "(기존 탭은 수식만 업데이트합니다)\n\n계속할까요?",
      ui.ButtonSet.YES_NO);
    if (cf !== ui.Button.YES) return;
  }

  var created = 0, updated = 0, errors = [];

  for (var fi = 0; fi < files.length; fi++) {
    var file = files[fi];
    try {
      var ss = SpreadsheetApp.openById(file.id);
      var existing = ss.getSheetByName(_CR_TAB_NAME);

      if (existing) {
        // 기존 탭 → 수식 + 드롭다운 + 헤더 갱신
        // 헤더 갱신 (새 열 추가 대응)
        if (existing.getMaxColumns() < _CR_HEADERS.length) {
          existing.insertColumnsAfter(existing.getMaxColumns(), _CR_HEADERS.length - existing.getMaxColumns());
        }
        existing.getRange(1, 1, 1, _CR_HEADERS.length).setValues([_CR_HEADERS]);
        // 드롭다운 갱신
        var catRule = SpreadsheetApp.newDataValidation()
          .requireValueInList(["취소", "취소완료", "반품", "반품접수", "반품입고"], true)
          .setAllowInvalid(false)
          .build();
        existing.getRange("E2:E500").setDataValidation(catRule);
        // 수식 갱신
        _cr_applyFormulas_(existing);
        updated++;
      } else {
        // 새 탭 생성
        var tab = ss.insertSheet(_CR_TAB_NAME);
        _cr_buildTab_(tab);
        created++;
      }
    } catch(e) {
      errors.push(file.name + ": " + e.message);
    }
  }

  var msg = "✅ 취소/반품 접수 탭 완료\n" +
    "- 생성: " + created + "개\n" +
    "- 갱신: " + updated + "개\n" +
    (errors.length > 0 ? "\n⚠ 오류:\n" + errors.slice(0,5).join("\n") : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

/** 탭 구조 생성 (헤더 + 수식 + 서식) */
function _cr_buildTab_(tab) {
  // 헤더
  tab.getRange(1, 1, 1, _CR_HEADERS.length).setValues([_CR_HEADERS]);
  tab.getRange("1:1")
    .setBackground("#c0392b")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);

  // 열 너비
  tab.setColumnWidth(1, 180);  // A: 고유ID
  tab.setColumnWidth(2, 200);  // B: 품목명(자동)
  tab.setColumnWidth(3, 100);  // C: 수취인(자동)
  tab.setColumnWidth(4, 140);  // D: 송장번호(자동)
  tab.setColumnWidth(5, 80);   // E: 구분
  tab.setColumnWidth(6, 250);  // F: 사유
  tab.setColumnWidth(7, 160);  // G: 반품송장번호
  tab.setColumnWidth(8, 150);  // H: 처리일시
  tab.setColumnWidth(9, 100);  // I: 반품배송비
  tab.setColumnWidth(10, 120); // J: 전화번호(자동)
  tab.setColumnWidth(11, 280); // K: 주소(자동)
  tab.setColumnWidth(12, 80);  // L: 반품수량

  // 자동 조회 수식 적용
  _cr_applyFormulas_(tab);

  // E열 드롭다운 (취소/반품)
  var catRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["취소", "취소완료", "반품", "반품접수", "반품입고"], true)
    .setAllowInvalid(false)
    .build();
  tab.getRange("E2:E500").setDataValidation(catRule);

  // 자동 열(B,C,D,J,K) 배경색 — 수식이므로 연한 회색
  tab.getRange("B2:D500").setBackground("#f5f5f5").setFontColor("#333333");
  tab.getRange("J2:K500").setBackground("#f5f5f5").setFontColor("#333333");

  // H열(처리일시) 읽기전용 안내
  tab.getRange("H2:H500").setFontColor("#999999");

  // I열(반품배송비) 숫자 형식
  tab.getRange("I2:I500").setNumberFormat("#,##0");

  // L열(반품수량) 숫자 형식 — 수정 가능
  tab.getRange("L2:L500").setNumberFormat("#,##0");

  // 헤더 보호
  try {
    var p = tab.getRange("1:1").protect()
      .setDescription("취소/반품 접수 헤더 보호");
    p.setWarningOnly(true);
  } catch(e) {}
}

/**
 * ★ 핵심: 자동 조회 수식 적용
 * 고유ID(A열) 입력 시 →
 *   1차: 발주 및 송장조회 탭 검색
 *   2차: (YYYY년 M월) 발주 마감 탭 검색 (이동된 건도 조회 가능)
 * 발주탭/마감탭 공통: M열=고유ID, D열=품목명, F열=수취인, K열=송장번호
 *
 * ★ INDEX/MATCH → VLOOKUP 변경 이유:
 *   ARRAYFORMULA + INDEX(col, MATCH()) 조합은 배열 확장이 안 되어
 *   첫 번째 결과만 모든 행에 반복됨.
 *   VLOOKUP({키열,값열},2,FALSE)는 ARRAYFORMULA에서 정상 배열 확장됨.
 */
function _cr_applyFormulas_(tab) {
  var ss = tab.getParent();
  var srcTab = "'" + _CR_ORDER_TAB + "'";

  // 마감 탭 목록 수집
  var archiveTabs = [];
  var archivePattern = /\(\d{4}년 \d{1,2}월\) 발주 마감/;
  var allSheets = ss.getSheets();
  for (var si = 0; si < allSheets.length; si++) {
    var name = allSheets[si].getName();
    if (archivePattern.test(name)) {
      archiveTabs.push("'" + name + "'");
    }
  }

  /**
   * nested IFERROR VLOOKUP 수식 생성
   * VLOOKUP(A2:A, {M열, 대상열}, 2, FALSE) — ARRAYFORMULA 배열 확장 지원
   */
  function buildLookup(col) {
    // 가장 안쪽: 최종 폴백
    var inner = '"⚠ 미발견"';

    // 마감 탭 역순 (최근 먼저)
    for (var i = archiveTabs.length - 1; i >= 0; i--) {
      var at = archiveTabs[i];
      inner = 'IFERROR(VLOOKUP(A2:A,{' + at + '!M:M,' + at + '!' + col + ':' + col + '},2,FALSE),' + inner + ')';
    }

    // 발주 및 송장조회 탭 최우선
    var formula = 'IFERROR(VLOOKUP(A2:A,{' + srcTab + '!M:M,' + srcTab + '!' + col + ':' + col + '},2,FALSE),' + inner + ')';

    return '=ARRAYFORMULA(IF(A2:A="",,' + formula + '))';
  }

  // B2: 품목명 (M열→D열)
  tab.getRange("B2").setFormula(buildLookup("D"));

  // C2: 수취인 (M열→F열)
  tab.getRange("C2").setFormula(buildLookup("F"));

  // D2: 송장번호 (M열→K열)
  tab.getRange("D2").setFormula(buildLookup("K"));

  // J2: 전화번호 (M열→G열)
  tab.getRange("J2").setFormula(buildLookup("G"));

  // K2: 주소 (M열→H열)
  tab.getRange("K2").setFormula(buildLookup("H"));

  // L2: 반품수량 — 개별 수식 (수정 가능, ARRAYFORMULA 아님)
  // 올바른 중첩: IFERROR(VLOOKUP(src), IFERROR(VLOOKUP(arch1), IFERROR(VLOOKUP(arch2), 0)))
  var qtyInner = '0';
  for (var qi = archiveTabs.length - 1; qi >= 0; qi--) {
    var aq = archiveTabs[qi];
    qtyInner = 'IFERROR(VLOOKUP($A2,{' + aq + '!$M:$M,' + aq + '!$E:$E},2,FALSE),' + qtyInner + ')';
  }
  var qtyFormula = '=IF($A2="","",-IFERROR(VLOOKUP($A2,{' + srcTab + '!$M:$M,' + srcTab + '!$E:$E},2,FALSE),' + qtyInner + '))';
  // 개별 수식 적용 (각 셀에 독립적 → 수정 가능)
  tab.getRange("L2:L200").setFormula(qtyFormula);

  Logger.log("[취소/반품] VLOOKUP 수식 적용 완료 — 발주탭 + 마감탭 " + archiveTabs.length + "개");
}

// ═══════════════════════════════════════════════════════
//  ★ 경량 수식 갱신 — 수식만 빠르게 재빌드 (6분 초과 방지)
// ═══════════════════════════════════════════════════════

/**
 * 취소/반품 접수 탭의 VLOOKUP 수식만 갱신 (헤더/드롭다운/서식 건너뜀)
 * → 새 마감탭이 생겼을 때 "⚠ 미발견" 해결용
 */
function partnerRefreshCancelFormulasOnly() {
  var ui; try { ui = SpreadsheetApp.getUi(); } catch(e) {}
  var files = _pt_listFiles();
  if (!files || !files.length) { if (ui) ui.alert("파일 없음"); return; }

  var updated = 0, skipped = 0, errors = [];
  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var crTab = ss.getSheetByName(_CR_TAB_NAME);
      if (!crTab) { skipped++; continue; }
      _cr_applyFormulas_(crTab);
      updated++;
    } catch(e) {
      errors.push(files[fi].name.replace("[협력업체] ", "") + ": " + e.message);
    }
  }
  var msg = "✅ 취소/반품 수식 갱신 완료\n갱신: " + updated + "개 | 미해당: " + skipped + "개" +
    (errors.length > 0 ? "\n⚠ 오류: " + errors.slice(0,3).join(", ") : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}
