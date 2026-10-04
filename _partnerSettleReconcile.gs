/**
 * [협력업체] 월마감 ↔ 이카운트 판매현황 비교(검증)
 * 파일: _partnerSettleReconcile.gs
 *
 * ★ 업체·월별 독립 스프레드시트 (허브 탭에 만들지 않음)
 * 탭:
 *   비교_월마감   — 업체 발주 마감 수집(또는 수동 붙여넣기)
 *   비교_이카운트 — 이카운트 판매현황 엑셀 붙여넣기
 *   비교_결과     — 고유ID 기준 차이 정리
 */

var _PSR_TAB_SETTLE = "비교_월마감";
var _PSR_TAB_ECOUNT = "비교_이카운트";
var _PSR_TAB_RESULT = "비교_결과";
var _PSR_TAB_SETTINGS = "비교검증_설정"; // 허브 상단 대상월 입력
var _PSR_TAB_META = "_비교메타"; // 비교시트 내부 메타(숨김)
var _PSR_AMT_TOLERANCE = 1; // 원 단위 허용 오차
var _PSR_PROP_PREFIX = "PSR_COMPARE_SS:"; // + vendorFileId + : + yyyyMM
var _PSR_BOUND_SCRIPT_PREFIX = "PSR_BOUND_SCRIPT_"; // + compareSsId
var _PSR_FOLDER_NAME = "월마감-이카운트_검증";
var _PSR_FILE_PREFIX = "[검증] 월마감-이카운트_";
var _PSR_SETTINGS_MONTH_CELL = "B2"; // 대상월 yyyy-MM
var _PSR_HUB_LIBRARY_ID = "192tojXvo5GfhIJoHXo7UbmSMbNjpUjfx2nEUAz56kacKaQrDXoSMLC7i";

var _PSR_ECOUNT_HINT_HEADERS = [
  "순번",
  "일자-No.",
  "품목코드",
  "품목명",
  "수량",
  "전화",
  "모바일",
  "주소1",
  "합계",
  "거래처명",
  "세트구성및배송비",
  "단품배송비",
  "묶음배송비",
  "적요",
  "주문자명(사방넷)",
  "전화번호(사방넷)",
  "배송지(사방넷)/배송메시지",
  "주문자명(주문서)",
  "전화번호(주문서)",
  "배송지(주문서)/배송메시지(주문서)",
];

var _PSR_RESULT_HEADERS = [
  "상태",
  "고유ID",
  "업체",
  "주문일자",
  "품목코드",
  "품목명",
  "수량_마감",
  "수량_이카",
  "금액_마감",
  "합계_이카",
  "개별단가_이카",
  "단가차이",
  "합계차이",
  "수취인",
  "비고",
];

// ═══════════════════════════════════════════
//  메뉴 진입점
// ═══════════════════════════════════════════

/** ⚙ 허브 상단 설정 탭 열기 (대상월) */
function partnerOpenSettleCompareSettings() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // 허브에 남은 대사_* 탭이 있으면 비교_* 로 자동 정리
  try { _psr_migrateOldTabNames_(ss); } catch (eMig) {}
  var tab = _psr_ensureSettingsTab_(ss);
  try { ss.setActiveSheet(tab); } catch (e) {}
  try { tab.getRange(_PSR_SETTINGS_MONTH_CELL).activate(); } catch (e2) {}
  var month = String(tab.getRange(_PSR_SETTINGS_MONTH_CELL).getDisplayValue() || "").trim();
  var mode = String(tab.getRange("C2").getDisplayValue() || "자동").trim();
  ui.alert(
    "⚙ 비교검증 설정",
    "기본은 모드「자동」→ 전달로 바로 불러옵니다.\n\n" +
      "현재 모드: " + mode + "\n" +
      "현재 월: " + month + "\n\n" +
      "다른 월: C2를「고정」→ B2에 yyyy-MM 입력\n" +
      "(허브 대사_* 탭이 있으면 비교_* 로 자동 변경됨)",
    ui.ButtonSet.OK
  );
}

/** 대상월을 전달(자동)로 맞추기 */
function partnerResetSettleCompareMonthToPrev() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = _psr_ensureSettingsTab_(ss);
  var prev = _psr_getPreviousYearMonth_();
  var label = prev.yyyy + "-" + ("0" + prev.m).slice(-2);
  tab.getRange(_PSR_SETTINGS_MONTH_CELL).setNumberFormat("@").setValue(label);
  tab.getRange("C2").setValue("자동");
  tab.getRange("B3").setValue("적용: 전달 자동 (" + label + ")");
  try { ss.setActiveSheet(tab); } catch (e) {}
  ui.alert("✅ 전달 자동으로 설정: " + label);
}

/**
 * ★ 비교시트(각 파일) 메뉴용 — 이 파일의 월마감 불러오기
 * (바운드 스크립트 → Pack2U.partnerCompareCollectOnActive)
 */
function partnerCompareCollectOnActive() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!_psr_isCompareSpreadsheet_(ss)) {
    return ui.alert("이 메뉴는 「[검증] 월마감-이카운트_…」 비교시트에서만 사용할 수 있습니다.");
  }
  var meta = _psr_readCompareMeta_(ss);
  if (!meta || !meta.vendorFileId) {
    return ui.alert("비교시트 메타 정보가 없습니다.\n허브에서 ① 비교시트 만들기/열기를 다시 실행해 주세요.");
  }

  var archTabName = "(" + meta.yyyy + "년 " + meta.m + "월) 발주 마감";
  var vendorSs;
  try {
    vendorSs = SpreadsheetApp.openById(meta.vendorFileId);
  } catch (e) {
    return ui.alert("업체 시트 열기 실패: " + e.message);
  }
  var archTab = vendorSs.getSheetByName(archTabName);
  if (!archTab) {
    return ui.alert("마감 탭 없음", "「" + archTabName + "」을 찾지 못했습니다.", ui.ButtonSet.OK);
  }
  var collected = _psr_readArchiveTab_(archTab, meta.vendorName);
  if (!collected.rows.length) {
    return ui.alert("데이터 없음", "「" + archTabName + "」에 데이터 행이 없습니다.", ui.ButtonSet.OK);
  }

  var parsed = { yyyy: meta.yyyy, m: meta.m };
  _psr_initCompareTabs_(ss, meta.vendorName, parsed, true, meta.vendorFileId);
  var settleTab = _psr_ensureTab_(ss, _PSR_TAB_SETTLE, "#1565c0");
  settleTab.clear();
  settleTab.getRange(1, 1, 1, collected.headers.length).setValues([collected.headers])
    .setBackground("#1565c0").setFontColor("white").setFontWeight("bold")
    .setHorizontalAlignment("center");
  settleTab.getRange(2, 1, collected.rows.length, collected.headers.length).setValues(collected.rows);
  settleTab.setFrozenRows(1);
  try { ss.setActiveSheet(settleTab); } catch (eAct) {}

  ui.alert(
    "✅ 월마감 불러오기 완료",
    "업체: " + meta.vendorName + "\n월: " + meta.yyyy + "-" + ("0" + meta.m).slice(-2) +
      "\n행수: " + collected.rows.length + "건\n\n다음: 「비교_이카운트」에 엑셀 붙여넣기 → 메뉴「비교 실행」",
    ui.ButtonSet.OK
  );
}

/**
 * ★ 비교시트(각 파일) 메뉴용 — 이 파일에서 비교 실행
 */
function partnerCompareRunOnActive() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!_psr_isCompareSpreadsheet_(ss)) {
    return ui.alert("이 메뉴는 「[검증] 월마감-이카운트_…」 비교시트에서만 사용할 수 있습니다.");
  }
  _psr_migrateOldTabNames_(ss);
  var settleTab = ss.getSheetByName(_PSR_TAB_SETTLE);
  var ecountTab = ss.getSheetByName(_PSR_TAB_ECOUNT);
  if (!settleTab || !ecountTab) {
    return ui.alert("비교 탭 없음", "비교_월마감 / 비교_이카운트 탭이 필요합니다.", ui.ButtonSet.OK);
  }
  var settleRows = _psr_parseSettleTab_(settleTab);
  var ecountRows = _psr_parseEcountTab_(ecountTab);
  if (!settleRows.length && !ecountRows.length) {
    return ui.alert("비교할 데이터가 없습니다.\n월마감 불러오기 또는 이카운트 붙여넣기를 확인하세요.");
  }
  var result = _psr_reconcile_(settleRows, ecountRows);
  var resultTab = _psr_ensureTab_(ss, _PSR_TAB_RESULT, "#2e7d32");
  _psr_writeResultTab_(resultTab, result);
  try { ss.setActiveSheet(resultTab); } catch (e) {}
  var s = result.summary;
  ui.alert(
    "✅ 비교 완료",
    "월마감 " + settleRows.length + "건 / 이카운트 " + ecountRows.length + "건\n\n" +
      "양쪽일치: " + s.matchOk + "\n금액불일치: " + s.amtDiff +
      "\n수량불일치: " + s.qtyDiff + "\n월마감만: " + s.settleOnly +
      "\n이카운트만: " + s.ecountOnly + "\n취소반품: " + s.cancelReturn +
      "\n\n금액합 차이: " + _psr_fmtNum_(s.amtSumDiff) + "원",
    ui.ButtonSet.OK
  );
}

/** 허브: 선택 비교시트들에 로컬 메뉴 스크립트 재설치 */
function partnerInstallCompareSheetMenus() {
  var ui = SpreadsheetApp.getUi();
  var batch = _psr_pickVendorsAndMonth_("비교시트 메뉴 설치");
  if (!batch) return;
  var ok = 0, fail = 0;
  var lines = [];
  for (var i = 0; i < batch.vendors.length; i++) {
    var v = batch.vendors[i];
    try {
      var created = _psr_getOrCreateCompareSs_(v.fileInfo.id, v.vendorName, batch.parsed);
      _psr_writeCompareMeta_(created.ss, v.fileInfo.id, v.vendorName, batch.parsed);
      _psr_installCompareBoundScript_(created.ss);
      ok++;
      lines.push("✅ " + v.vendorName);
    } catch (e) {
      fail++;
      lines.push("❌ " + v.vendorName + ": " + e.message);
    }
  }
  ui.alert(
    "비교시트 메뉴 설치 완료",
    "성공 " + ok + " / 실패 " + fail + "\n\n" +
      lines.join("\n") +
      "\n\n각 비교시트를 새로고침(F5)하면 「📑 비교검증」 메뉴가 보입니다.",
    ui.ButtonSet.OK
  );
}

/** ① 업체별 비교시트 만들기/열기 (복수 업체 가능) */
function partnerCreateSettleReconcileSheets() {
  var ui = SpreadsheetApp.getUi();
  var batch = _psr_pickVendorsAndMonth_("② 업체 비교시트 만들기/열기");
  if (!batch) return;

  var lines = [];
  var okNew = 0, okExist = 0, fail = 0;
  for (var i = 0; i < batch.vendors.length; i++) {
    var v = batch.vendors[i];
    try {
      var created = _psr_getOrCreateCompareSs_(v.fileInfo.id, v.vendorName, batch.parsed);
      _psr_initCompareTabs_(created.ss, v.vendorName, batch.parsed, false, v.fileInfo.id);
      try { _psr_installCompareBoundScript_(created.ss); } catch (eInst) {
        Logger.log("[PSR] 메뉴 설치 실패 " + v.vendorName + ": " + eInst.message);
      }
      if (created.isNew) okNew++; else okExist++;
      lines.push((created.isNew ? "🆕 " : "📂 ") + v.vendorName);
      if (batch.vendors.length <= 8) lines.push("   " + created.ss.getUrl());
    } catch (e) {
      fail++;
      lines.push("❌ " + v.vendorName + ": " + e.message);
    }
    if (i % 5 === 4) SpreadsheetApp.flush();
  }

  ui.alert(
    "✅ 비교시트 일괄 처리 완료",
    "월: " + batch.yyyy + "년 " + batch.m + "월\n" +
      "신규 " + okNew + " / 기존 " + okExist + " / 실패 " + fail + "\n" +
      "폴더: " + _PSR_FOLDER_NAME + "\n\n" +
      lines.join("\n") +
      (batch.vendors.length > 8 ? "\n\n※ URL은 드라이브 폴더에서 확인" : "") +
      "\n\n※ 각 비교시트를 새로고침하면 「📑 비교검증」메뉴(불러오기/비교)가 보입니다.\n" +
      "다음: 시트에서 월마감 불러오기 → 비교_이카운트 붙여넣기 → 비교 실행",
    ui.ButtonSet.OK
  );
}

/** ② 월마감 불러오기 → 업체별 비교시트에 적재 (복수 가능) */
function partnerCollectSettleForReconcile() {
  var ui = SpreadsheetApp.getUi();
  var batch = _psr_pickVendorsAndMonth_("③ 월마감 불러오기");
  if (!batch) return;

  var lines = [];
  var ok = 0, skip = 0, fail = 0;
  for (var i = 0; i < batch.vendors.length; i++) {
    var v = batch.vendors[i];
    try {
      var vendorSs = SpreadsheetApp.openById(v.fileInfo.id);
      var archTab = vendorSs.getSheetByName(batch.archTabName);
      if (!archTab) {
        skip++;
        lines.push("⏭ " + v.vendorName + ": 마감탭 없음");
        continue;
      }
      var collected = _psr_readArchiveTab_(archTab, v.vendorName);
      if (!collected.rows.length) {
        skip++;
        lines.push("⏭ " + v.vendorName + ": 데이터 0건");
        continue;
      }
      var created = _psr_getOrCreateCompareSs_(v.fileInfo.id, v.vendorName, batch.parsed);
      _psr_initCompareTabs_(created.ss, v.vendorName, batch.parsed, true, v.fileInfo.id);
      try { _psr_installCompareBoundScript_(created.ss); } catch (eInst2) {}
      var settleTab = _psr_ensureTab_(created.ss, _PSR_TAB_SETTLE, "#1565c0");
      settleTab.clear();
      settleTab.getRange(1, 1, 1, collected.headers.length).setValues([collected.headers])
        .setBackground("#1565c0").setFontColor("white").setFontWeight("bold")
        .setHorizontalAlignment("center");
      settleTab.getRange(2, 1, collected.rows.length, collected.headers.length).setValues(collected.rows);
      settleTab.setFrozenRows(1);
      ok++;
      lines.push("✅ " + v.vendorName + ": " + collected.rows.length + "건");
    } catch (e) {
      fail++;
      lines.push("❌ " + v.vendorName + ": " + e.message);
    }
    if (i % 5 === 4) SpreadsheetApp.flush();
  }

  ui.alert(
    "✅ 월마감 불러오기 완료",
    "월: " + batch.yyyy + "년 " + batch.m + "월 / 「" + batch.archTabName + "」\n" +
      "성공 " + ok + " / 스킵 " + skip + " / 실패 " + fail + "\n\n" +
      lines.join("\n") +
      "\n\n다음: 각 비교시트에서 「비교_이카운트」붙여넣기 → 메뉴「📑 비교검증 → 비교 실행」",
    ui.ButtonSet.OK
  );
}

/**
 * 📋 상품정보시트 검증 — ① 비교 탭 준비
 * 허브에 비교_월마감 / 비교_이카운트 / 비교_결과 탭 생성
 */
function partnerHubPrepareCompareTabs() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try { _psr_migrateOldTabNames_(ss); } catch (eMig) {}
  var parsed = _psr_resolveTargetMonthFromCtrl_();
  if (!parsed) return;
  _psr_initCompareTabs_(ss, "(상품정보시트)", parsed, true, "");
  // 허브용 안내 문구
  var settle = ss.getSheetByName(_PSR_TAB_SETTLE);
  if (settle) {
    var tip = settle.getRange(1, 2).getDisplayValue();
    if (!tip || String(tip).indexOf("월마감 불러오기") === -1) {
      settle.getRange(1, 1).setValue("업체");
      settle.getRange(1, 2).setValue(
        "← 메뉴「📋 상품정보시트 검증 → ② 월마감 불러오기」또는 붙여넣기 | " +
          parsed.yyyy + "-" + ("0" + parsed.m).slice(-2)
      );
      settle.getRange(1, 1, 1, 2)
        .setBackground("#1565c0").setFontColor("white").setFontWeight("bold");
    }
  }
  var result = ss.getSheetByName(_PSR_TAB_RESULT);
  if (result && result.getLastRow() < 4) {
    result.getRange(1, 1).setValue("비교 결과 (메뉴「📋 상품정보시트 검증 → ③ 비교 실행」)");
  }
  try { ss.setActiveSheet(ss.getSheetByName(_PSR_TAB_SETTLE) || settle); } catch (eAct) {}
  ui.alert(
    "✅ 상품정보시트 비교 탭 준비 완료",
    "탭: " + _PSR_TAB_SETTLE + " / " + _PSR_TAB_ECOUNT + " / " + _PSR_TAB_RESULT + "\n" +
      "대상월: " + parsed.yyyy + "-" + ("0" + parsed.m).slice(-2) + "\n\n" +
      "다음: ② 월마감 불러오기 → 「비교_이카운트」붙여넣기 → ③ 비교 실행",
    ui.ButtonSet.OK
  );
}

/**
 * 📋 상품정보시트 검증 — ② 월마감 불러오기
 * 업체 마감탭 → 허브「비교_월마감」에 적재 (독립시트 아님)
 */
function partnerHubCollectSettleForReconcile() {
  var ui = SpreadsheetApp.getUi();
  var hubSs = SpreadsheetApp.getActiveSpreadsheet();
  var batch = _psr_pickVendorsAndMonth_("상품정보시트 — 월마감 불러오기");
  if (!batch) return;

  try { _psr_migrateOldTabNames_(hubSs); } catch (eMig) {}
  _psr_initCompareTabs_(hubSs, batch.vendors[0].vendorName, batch.parsed, true, "");

  var settleTab = _psr_ensureTab_(hubSs, _PSR_TAB_SETTLE, "#1565c0");
  settleTab.clear();

  var allHeaders = null;
  var allRows = [];
  var lines = [];
  var ok = 0, skip = 0, fail = 0;

  for (var i = 0; i < batch.vendors.length; i++) {
    var v = batch.vendors[i];
    try {
      var vendorSs = SpreadsheetApp.openById(v.fileInfo.id);
      var archTab = vendorSs.getSheetByName(batch.archTabName);
      if (!archTab) {
        skip++;
        lines.push("⏭ " + v.vendorName + ": 마감탭 없음");
        continue;
      }
      var collected = _psr_readArchiveTab_(archTab, v.vendorName);
      if (!collected.rows.length) {
        skip++;
        lines.push("⏭ " + v.vendorName + ": 데이터 0건");
        continue;
      }
      if (!allHeaders) allHeaders = collected.headers;
      for (var r = 0; r < collected.rows.length; r++) {
        allRows.push(collected.rows[r]);
      }
      ok++;
      lines.push("✅ " + v.vendorName + ": " + collected.rows.length + "건");
    } catch (e) {
      fail++;
      lines.push("❌ " + v.vendorName + ": " + e.message);
    }
  }

  if (!allHeaders || !allRows.length) {
    return ui.alert(
      "월마감 불러오기 실패",
      "적재할 데이터가 없습니다.\n\n" + lines.join("\n"),
      ui.ButtonSet.OK
    );
  }

  settleTab.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders])
    .setBackground("#1565c0").setFontColor("white").setFontWeight("bold")
    .setHorizontalAlignment("center");
  settleTab.getRange(2, 1, allRows.length, allHeaders.length).setValues(allRows);
  settleTab.setFrozenRows(1);
  try { hubSs.setActiveSheet(settleTab); } catch (eAct) {}

  // 허브 메타: 단건이면 업체ID 기록 (참고용)
  if (batch.vendors.length === 1) {
    _psr_writeCompareMeta_(hubSs, batch.vendors[0].fileInfo.id, batch.vendors[0].vendorName, batch.parsed);
  } else {
    _psr_writeCompareMeta_(hubSs, "", "복수(" + ok + "업체)", batch.parsed);
  }

  ui.alert(
    "✅ 상품정보시트 — 월마감 불러오기 완료",
    "월: " + batch.yyyy + "년 " + batch.m + "월 / 「" + batch.archTabName + "」\n" +
      "적재: " + allRows.length + "건  →  탭「" + _PSR_TAB_SETTLE + "」\n" +
      "성공 " + ok + " / 스킵 " + skip + " / 실패 " + fail + "\n\n" +
      lines.join("\n") +
      "\n\n다음: 「" + _PSR_TAB_ECOUNT + "」에 이카운트 붙여넣기 → ③ 비교 실행",
    ui.ButtonSet.OK
  );
}

/**
 * 📋 상품정보시트 검증 — ③ 비교 실행
 * 허브의 비교_* 탭만 대상으로 실행
 */
function partnerHubRunSettleReconcile() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try { _psr_migrateOldTabNames_(ss); } catch (eMig) {}

  var settleTab = ss.getSheetByName(_PSR_TAB_SETTLE);
  var ecountTab = ss.getSheetByName(_PSR_TAB_ECOUNT);
  if (!settleTab || !ecountTab) {
    return ui.alert(
      "비교 탭 없음",
      "먼저 「① 비교 탭 준비」또는 「② 월마감 불러오기」를 실행하세요.\n" +
        "필요 탭: " + _PSR_TAB_SETTLE + " / " + _PSR_TAB_ECOUNT,
      ui.ButtonSet.OK
    );
  }

  var settleRows = _psr_parseSettleTab_(settleTab);
  var ecountRows = _psr_parseEcountTab_(ecountTab);
  if (!settleRows.length && !ecountRows.length) {
    return ui.alert("비교할 데이터가 없습니다.\n월마감 불러오기 또는 이카운트 붙여넣기를 확인하세요.");
  }

  var result = _psr_reconcile_(settleRows, ecountRows);
  var resultTab = _psr_ensureTab_(ss, _PSR_TAB_RESULT, "#2e7d32");
  _psr_writeResultTab_(resultTab, result);
  try { ss.setActiveSheet(resultTab); } catch (e) {}

  var s = result.summary;
  ui.alert(
    "✅ 상품정보시트 비교 완료",
    "월마감 " + settleRows.length + "건 / 이카운트 " + ecountRows.length + "건\n\n" +
      "양쪽일치: " + s.matchOk + "\n금액불일치: " + s.amtDiff +
      "\n수량불일치: " + s.qtyDiff + "\n월마감만: " + s.settleOnly +
      "\n이카운트만: " + s.ecountOnly + "\n취소반품: " + s.cancelReturn +
      "\n\n금액합 차이: " + _psr_fmtNum_(s.amtSumDiff) + "원",
    ui.ButtonSet.OK
  );
}

/**
 * 이카운트 기준으로 업체 월마감 수정
 * - 금액불일치·수량불일치: 고유ID로 마감 행의 수량·정산금액을 이카 합계/수량으로 갱신
 * - 이카운트만: 해당 월 발주 마감 탭 하단에 행 추가
 * (독립 비교시트 / 상품정보시트 공통)
 */
function partnerCompareApplyEcountFixOnActive() {
  return _psr_applyEcountFixFromCompareSs_(SpreadsheetApp.getActiveSpreadsheet());
}

/** 📋 상품정보시트 검증 — 이카운트 기준 월마감 수정 */
function partnerHubApplyEcountFixToArchive() {
  return _psr_applyEcountFixFromCompareSs_(SpreadsheetApp.getActiveSpreadsheet());
}

/** 📂 독립시트 검증 — 이카운트 기준 월마감 수정 (복수) */
function partnerApplyEcountFixToArchiveBatch() {
  var ui = SpreadsheetApp.getUi();
  var targets = _psr_resolveCompareSsListForRun_(true);
  if (!targets || !targets.length) return;
  var ans = ui.alert(
    "이카운트 기준 월마감 수정 (일괄)",
    targets.length + "개 비교시트에 대해\n금액불일치·수량불일치 수정 + 이카운트만 하단 추가를\n각 업체 발주 마감 탭에 적용합니다.\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var lines = [];
  var ok = 0, fail = 0;
  for (var i = 0; i < targets.length; i++) {
    try {
      var r = _psr_applyEcountFixFromCompareSs_(targets[i].ss, true);
      ok++;
      lines.push("✅ " + (targets[i].label || "") + ": 수정 " + r.updated + " / 추가 " + r.appended);
    } catch (e) {
      fail++;
      lines.push("❌ " + (targets[i].label || "") + ": " + e.message);
    }
  }
  ui.alert(
    "이카운트 기준 월마감 수정 (일괄)",
    "성공 " + ok + " / 실패 " + fail + "\n\n" + lines.join("\n"),
    ui.ButtonSet.OK
  );
}

/**
 * @param {Spreadsheet} ss 비교탭이 있는 스프레드시트
 * @param {boolean=} silentConfirm true면 확인 팝업 생략(일괄용, 첫 호출만 확인하려면 외부에서)
 * @return {{ updated: number, appended: number, vendors: number }}
 */
function _psr_applyEcountFixFromCompareSs_(ss, silentConfirm) {
  var ui = SpreadsheetApp.getUi();
  if (!ss) throw new Error("활성 스프레드시트 없음");

  try { _psr_migrateOldTabNames_(ss); } catch (eMig) {}
  var settleTab = ss.getSheetByName(_PSR_TAB_SETTLE);
  var ecountTab = ss.getSheetByName(_PSR_TAB_ECOUNT);
  if (!settleTab || !ecountTab) {
    ui.alert("비교 탭 없음", "비교_월마감 / 비교_이카운트 가 필요합니다.", ui.ButtonSet.OK);
    return { updated: 0, appended: 0, vendors: 0 };
  }

  var settleRows = _psr_parseSettleTab_(settleTab);
  var ecountRows = _psr_parseEcountTab_(ecountTab);
  if (!ecountRows.length) {
    ui.alert("이카운트 데이터 없음", "비교_이카운트에 판매현황을 붙여넣은 뒤 다시 실행하세요.", ui.ButtonSet.OK);
    return { updated: 0, appended: 0, vendors: 0 };
  }

  var plan = _psr_buildEcountFixPlan_(settleRows, ecountRows);
  if (!plan.updates.length && !plan.appends.length) {
    ui.alert("수정 대상 없음", "금액불일치·수량불일치·이카운트만 건이 없습니다.", ui.ButtonSet.OK);
    return { updated: 0, appended: 0, vendors: 0 };
  }

  var meta = _psr_readCompareMeta_(ss);
  var parsed = null;
  if (meta && meta.yyyy && meta.m) {
    parsed = { yyyy: String(meta.yyyy), m: meta.m };
  } else {
    parsed = _psr_resolveTargetMonthFromCtrl_();
  }
  if (!parsed) {
    ui.alert("대상월 없음", "비교검증_설정 또는 비교시트 메타의 대상월을 확인하세요.", ui.ButtonSet.OK);
    return { updated: 0, appended: 0, vendors: 0 };
  }

  if (!silentConfirm) {
    var ans = ui.alert(
      "이카운트 기준 월마감 수정",
      "이카운트를 기준으로 업체 「발주 마감」탭을 직접 수정합니다.\n\n" +
        "· 금액/수량 불일치 수정: " + plan.updates.length + "건 (고유ID)\n" +
        "· 이카운트만 하단 추가: " + plan.appends.length + "건\n" +
        "· 대상월: " + parsed.yyyy + "년 " + parsed.m + "월\n\n" +
        "정산금액 ← 이카 합계, 수량 ← 이카 수량\n계속할까요?",
      ui.ButtonSet.YES_NO
    );
    if (ans !== ui.Button.YES) return { updated: 0, appended: 0, vendors: 0 };
  }

  // 업체별 그룹
  // ★ 단업체 비교시트(메타 vendorFileId 있음): 이카 거래처명과 무관하게 전부 그 업체로
  //   (거래처명 불일치 시 일부 이카운트만 행이 다른 그룹/미상으로 빠져 추가 누락되던 문제)
  var byVendor = {};
  var defaultVendor = (meta && meta.vendorName && String(meta.vendorName).indexOf("복수") !== 0)
    ? meta.vendorName
    : "";
  var defaultFileId = (meta && meta.vendorFileId) ? meta.vendorFileId : "";
  var singleVendorMode = !!(defaultFileId && defaultVendor);

  function ensureGroup_(vendorName, hintFileId) {
    var key = String(vendorName || "").trim() || "(업체미상)";
    if (!byVendor[key]) {
      var fileId = String(hintFileId || "").trim();
      if (!fileId && meta && meta.vendorFileId && (
        !meta.vendorName ||
        String(meta.vendorName).indexOf("복수") === 0 ||
        key === String(meta.vendorName || "").trim()
      )) {
        fileId = meta.vendorFileId;
      }
      if (!fileId) {
        var found = _psr_findVendorFileByName_(key);
        fileId = found ? found.id : "";
      }
      byVendor[key] = { vendorName: key, fileId: fileId, updates: [], appends: [] };
    }
    return byVendor[key];
  }

  if (singleVendorMode) {
    byVendor[defaultVendor] = {
      vendorName: defaultVendor,
      fileId: defaultFileId,
      updates: plan.updates.slice(),
      appends: plan.appends.slice(),
    };
  } else {
    for (var ui0 = 0; ui0 < plan.updates.length; ui0++) {
      var u = plan.updates[ui0];
      var vnU = u.vendor || defaultVendor || u.e.vendor || "";
      ensureGroup_(vnU, defaultFileId).updates.push(u);
    }
    for (var ai0 = 0; ai0 < plan.appends.length; ai0++) {
      var a = plan.appends[ai0];
      // 이카 거래처명보다 마감/메타 업체명 우선 (파일 매칭 실패 방지)
      var vnA = a.vendor || defaultVendor || a.e.vendor || "";
      ensureGroup_(vnA, defaultFileId).appends.push(a);
    }
    var groupKeys = Object.keys(byVendor);
    if (defaultFileId) {
      for (var gk = 0; gk < groupKeys.length; gk++) {
        if (!byVendor[groupKeys[gk]].fileId) {
          byVendor[groupKeys[gk]].fileId = defaultFileId;
        }
      }
    }
  }

  var totalUpdated = 0;
  var totalAppended = 0;
  var vendorCount = 0;
  var lines = [];

  for (var vk in byVendor) {
    if (!byVendor.hasOwnProperty(vk)) continue;
    var g = byVendor[vk];
    if (!g.fileId) {
      lines.push("❌ " + g.vendorName + ": 업체 파일 못 찾음");
      continue;
    }
    try {
      var applied = _psr_applyEcountFixesToArchiveTab_(
        g.fileId,
        g.vendorName,
        parsed.yyyy,
        parsed.m,
        g.updates,
        g.appends
      );
      totalUpdated += applied.updated;
      totalAppended += applied.appended;
      vendorCount++;
      lines.push(
        "✅ " + g.vendorName +
          ": 수정 " + applied.updated +
          " / 추가 " + applied.appended +
          (applied.skippedDup ? " / 중복스킵 " + applied.skippedDup : "") +
          (applied.missUid ? " / UID없음→추가 " + applied.missUid : "")
      );

      // 비교_월마감 갱신 (해당 업체 분)
      try {
        var vendorSs = SpreadsheetApp.openById(g.fileId);
        var archName = "(" + parsed.yyyy + "년 " + parsed.m + "월) 발주 마감";
        var archTab = vendorSs.getSheetByName(archName);
        if (archTab) {
          var collected = _psr_readArchiveTab_(archTab, g.vendorName);
          // 단일이면 전체 교체, 복수면 해당 업체 행만 갈아끼우기
          _psr_refreshSettleTabAfterFix_(ss, settleTab, g.vendorName, collected, defaultFileId && !String(meta.vendorName || "").match(/^복수/));
        }
      } catch (eRef) {
        lines.push("  ⚠ 비교_월마감 갱신 실패: " + eRef.message);
      }
    } catch (eA) {
      lines.push("❌ " + g.vendorName + ": " + eA.message);
    }
  }

  // 비교 재실행
  try {
    var settleRows2 = _psr_parseSettleTab_(settleTab);
    var ecountRows2 = _psr_parseEcountTab_(ecountTab);
    var result2 = _psr_reconcile_(settleRows2, ecountRows2);
    var resultTab = _psr_ensureTab_(ss, _PSR_TAB_RESULT, "#2e7d32");
    _psr_writeResultTab_(resultTab, result2);
    try { ss.setActiveSheet(resultTab); } catch (eAct) {}
  } catch (eRun) {
    lines.push("⚠ 비교 재실행 실패: " + eRun.message);
  }

  if (!silentConfirm) {
    ui.alert(
      "✅ 이카운트 기준 월마감 수정 완료",
      "업체 " + vendorCount + "곳\n" +
        "수정 " + totalUpdated + "건 / 추가 " + totalAppended + "건\n\n" +
        lines.join("\n") +
        "\n\n비교_결과를 다시 계산해 두었습니다.",
      ui.ButtonSet.OK
    );
  }

  return { updated: totalUpdated, appended: totalAppended, vendors: vendorCount, lines: lines };
}

/** 비교_월마감 탭 갱신 — 단일 업체면 전체 교체, 복수면 해당 업체 행만 교체 */
function _psr_refreshSettleTabAfterFix_(ss, settleTab, vendorName, collected, replaceAll) {
  if (!settleTab || !collected || !collected.headers) return;
  if (replaceAll || settleTab.getLastRow() < 2) {
    settleTab.clear();
    settleTab.getRange(1, 1, 1, collected.headers.length).setValues([collected.headers])
      .setBackground("#1565c0").setFontColor("white").setFontWeight("bold")
      .setHorizontalAlignment("center");
    if (collected.rows.length) {
      settleTab.getRange(2, 1, collected.rows.length, collected.headers.length).setValues(collected.rows);
    }
    settleTab.setFrozenRows(1);
    return;
  }

  // 복수: 업체 열(보통 0) 기준으로 해당 업체 행 제거 후 새 데이터 append
  var lr = settleTab.getLastRow();
  var lc = Math.max(settleTab.getLastColumn(), collected.headers.length);
  var headers = settleTab.getRange(1, 1, 1, lc).getValues()[0];
  var vendorCol = _psr_findCol_(headers, ["업체", "발주업체", "거래처명"]);
  if (vendorCol < 0) vendorCol = 0;

  var keep = [];
  if (lr >= 2) {
    var data = settleTab.getRange(2, 1, lr - 1, lc).getValues();
    var vTarget = String(vendorName || "").trim();
    for (var i = 0; i < data.length; i++) {
      var vn = String(data[i][vendorCol] || "").trim();
      if (vn !== vTarget) keep.push(data[i]);
    }
  }
  for (var r = 0; r < collected.rows.length; r++) {
    var row = collected.rows[r].slice(0);
    while (row.length < lc) row.push("");
    if (row.length > lc) row = row.slice(0, lc);
    keep.push(row);
  }

  settleTab.clear();
  var outHeaders = collected.headers.slice(0);
  while (outHeaders.length < lc) outHeaders.push(String(headers[outHeaders.length] || ""));
  settleTab.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders])
    .setBackground("#1565c0").setFontColor("white").setFontWeight("bold")
    .setHorizontalAlignment("center");
  if (keep.length) {
    // 열 수 맞춤
    var width = outHeaders.length;
    var body = keep.map(function (row) {
      var x = row.slice(0, width);
      while (x.length < width) x.push("");
      return x;
    });
    settleTab.getRange(2, 1, body.length, width).setValues(body);
  }
  settleTab.setFrozenRows(1);
}

function _psr_findVendorFileByName_(vendorName) {
  var target = String(vendorName || "").replace(/^\[협력업체\]\s*/, "").trim();
  if (!target) return null;
  var files = _pt_listFiles();
  if (!files) return null;
  var partial = null;
  for (var i = 0; i < files.length; i++) {
    var short = files[i].name.replace("[협력업체] ", "").trim();
    if (short === target) return files[i];
    if (!partial && (short.indexOf(target) !== -1 || target.indexOf(short) !== -1)) {
      partial = files[i];
    }
  }
  return partial;
}

/**
 * 금액/수량 불일치 업데이트 + 이카운트만 append 계획
 * @return {{ updates: Array<{vendor,uid,s,e}>, appends: Array<{vendor,e}> }}
 */
function _psr_buildEcountFixPlan_(settleRows, ecountRows) {
  var eByUid = {};
  var eByAux = {};
  var eUsed = {};
  for (var ei = 0; ei < ecountRows.length; ei++) {
    var er = ecountRows[ei];
    if (er.uid) {
      if (!eByUid[er.uid]) eByUid[er.uid] = [];
      eByUid[er.uid].push(ei);
    }
    if (er.aux) {
      if (!eByAux[er.aux]) eByAux[er.aux] = [];
      eByAux[er.aux].push(ei);
    }
  }
  function takeEcount(idxList) {
    if (!idxList || !idxList.length) return -1;
    for (var t = 0; t < idxList.length; t++) {
      var idx = idxList[t];
      if (!eUsed[idx]) {
        eUsed[idx] = true;
        return idx;
      }
    }
    return -1;
  }

  var updates = [];
  var appends = [];

  for (var si = 0; si < settleRows.length; si++) {
    var s = settleRows[si];
    if (s.cancelReturn) {
      // 취소반품 건은 이카 매칭만 하고 수정 대상에서 제외 (사용 표시)
      if (s.uid && eByUid[s.uid]) takeEcount(eByUid[s.uid]);
      else if (s.aux && eByAux[s.aux]) takeEcount(eByAux[s.aux]);
      continue;
    }
    var eIdx = -1;
    if (s.uid && eByUid[s.uid]) eIdx = takeEcount(eByUid[s.uid]);
    if (eIdx < 0 && s.aux && eByAux[s.aux]) eIdx = takeEcount(eByAux[s.aux]);
    if (eIdx < 0) continue;

    var e = ecountRows[eIdx];
    var qtySame = Math.round(s.qty) === Math.round(e.qty);
    var amtOk = Math.abs(Math.round(s.amount - e.total)) <= _PSR_AMT_TOLERANCE;
    if (!qtySame || !amtOk) {
      updates.push({
        vendor: s.vendor || e.vendor || "",
        uid: s.uid || e.uid || "",
        s: s,
        e: e,
      });
    }
  }

  for (var ej = 0; ej < ecountRows.length; ej++) {
    if (eUsed[ej]) continue;
    var eo = ecountRows[ej];
    appends.push({ vendor: eo.vendor || "", e: eo });
  }

  return { updates: updates, appends: appends };
}

/** 마감 행/이카 행 동일 여부 키 (UID만으로 묶으면 배송비·다품목 추가가 누락됨) */
function _psr_archiveLineKey_(uid, code, qty, total, date) {
  return [
    String(uid || "").replace(/\s/g, "").trim(),
    String(code || "").trim(),
    String(Math.round(_psr_toNumber_(qty))),
    String(Math.round(_psr_toNumber_(total))),
    String(date || "").replace(/\D/g, "").slice(0, 8),
  ].join("|");
}

/**
 * 업체 파일의 발주 마감 탭에 이카 기준 수정/추가 적용
 */
function _psr_applyEcountFixesToArchiveTab_(vendorFileId, vendorName, yyyy, m, updates, appends) {
  var ss = SpreadsheetApp.openById(vendorFileId);
  var archTabName = "(" + yyyy + "년 " + m + "월) 발주 마감";
  var archTab = ss.getSheetByName(archTabName);
  if (!archTab) {
    throw new Error("마감탭 없음 「" + archTabName + "」");
  }

  var headerRow = (typeof _PMS_HEADER_ROW !== "undefined") ? _PMS_HEADER_ROW : 4;
  var dataStart = (typeof _PMS_DATA_START !== "undefined") ? _PMS_DATA_START : 5;
  var lc = Math.max(archTab.getLastColumn(), 1);
  var headers = archTab.getRange(headerRow, 1, 1, lc).getValues()[0];
  var full = _pt_buildOrderTabColumnMap(headers);

  // 금액열 폴백
  var priceCol = full.unitPrice;
  var qtyCol = full.qty;
  var uidCol = full.uniqueId;
  var codeCol = full.code;
  var dateCol = full.date;
  if (priceCol === -1 || qtyCol === -1 || uidCol === -1 || codeCol === -1) {
    for (var hi = 0; hi < headers.length; hi++) {
      var hh = String(headers[hi] || "").replace(/\s/g, "");
      if (priceCol === -1 && (hh.indexOf("정산금액") !== -1 || hh === "단가" || hh.indexOf("단가") !== -1)) priceCol = hi;
      if (qtyCol === -1 && hh.indexOf("수량") !== -1 && hh.indexOf("택배") === -1) qtyCol = hi;
      if (uidCol === -1 && (hh.indexOf("고유ID") !== -1 || hh.toLowerCase().indexOf("uniqueid") !== -1)) uidCol = hi;
      if (codeCol === -1 && (hh.indexOf("이카운트코드") !== -1 || hh.indexOf("품목코드") !== -1)) codeCol = hi;
      if (dateCol === -1 && (hh.indexOf("주문일자") !== -1 || hh === "일자")) dateCol = hi;
    }
  }
  if (priceCol === -1 || qtyCol === -1) {
    throw new Error("마감탭에 수량/정산금액 열 없음");
  }

  var cancelCol = -1;
  var returnCol = -1;
  for (var cj = 0; cj < headers.length; cj++) {
    var hn = String(headers[cj] || "").trim();
    if (hn === "취소") cancelCol = cj;
    if (hn === "반품") returnCol = cj;
  }

  var lr = archTab.getLastRow();
  var uidToRow = {}; // uid -> 1-based sheet row (수정용, 첫 행)
  var existingLineKeys = {}; // 완전 동일 행만 중복으로 스킵
  if (lr >= dataStart) {
    var nRows = lr - dataStart + 1;
    var block = archTab.getRange(dataStart, 1, nRows, lc).getValues();
    for (var ur = 0; ur < block.length; ur++) {
      var row = block[ur];
      var uid = uidCol >= 0 ? String(row[uidCol] || "").replace(/\s/g, "").trim() : "";
      if (uid && uidToRow[uid] == null) uidToRow[uid] = dataStart + ur;
      var k = _psr_archiveLineKey_(
        uid,
        codeCol >= 0 ? row[codeCol] : "",
        qtyCol >= 0 ? row[qtyCol] : "",
        priceCol >= 0 ? row[priceCol] : "",
        dateCol >= 0 ? row[dateCol] : ""
      );
      if (k !== "||||") existingLineKeys[k] = true;
    }
  }

  var updated = 0;
  var missUid = 0;
  var orphanAppends = [];

  for (var i = 0; i < (updates || []).length; i++) {
    var u = updates[i];
    var e = u.e;
    var uid = String(u.uid || e.uid || "").replace(/\s/g, "").trim();
    var sheetRow = uid ? uidToRow[uid] : null;
    if (!sheetRow) {
      // UID로 못 찾으면 추가 목록으로
      missUid++;
      orphanAppends.push({ e: e, vendor: vendorName });
      continue;
    }
    var newQty = _psr_toNumber_(e.qty);
    var newAmt = Math.round(_psr_toNumber_(e.total));
    archTab.getRange(sheetRow, qtyCol + 1).setValue(newQty);
    archTab.getRange(sheetRow, priceCol + 1).setValue(newAmt);
    existingLineKeys[_psr_archiveLineKey_(uid, e.code, newQty, newAmt, e.date)] = true;
    if (codeCol >= 0 && e.code) {
      var curCode = String(archTab.getRange(sheetRow, codeCol + 1).getDisplayValue() || "").trim();
      if (!curCode) archTab.getRange(sheetRow, codeCol + 1).setValue(e.code);
    }
    if (full.item >= 0 && e.item) {
      var curItem = String(archTab.getRange(sheetRow, full.item + 1).getDisplayValue() || "").trim();
      if (!curItem) archTab.getRange(sheetRow, full.item + 1).setValue(e.item);
    }
    if (full.voucherMemo >= 0) {
      var memo = String(archTab.getRange(sheetRow, full.voucherMemo + 1).getDisplayValue() || "").trim();
      if (memo.indexOf("이카운트보정") === -1) {
        archTab.getRange(sheetRow, full.voucherMemo + 1).setValue(
          memo ? (memo + " / 이카운트보정") : "이카운트보정"
        );
      }
    }
    updated++;
  }

  var toAppend = (appends || []).concat(orphanAppends);
  var appended = 0;
  var skippedDup = 0;
  if (toAppend.length) {
    var newRows = [];
    for (var a = 0; a < toAppend.length; a++) {
      var ae = toAppend[a].e;
      var aUid = String(ae.uid || "").replace(/\s/g, "").trim();
      var lineKey = _psr_archiveLineKey_(aUid, ae.code, ae.qty, ae.total, ae.date);
      // ★ 동일 UID라도 품목/수량/금액이 다르면 추가 (배송비·다품목)
      //   완전 동일 행만 중복 스킵
      if (existingLineKeys[lineKey]) {
        skippedDup++;
        continue;
      }
      newRows.push(_psr_buildArchiveRowFromEcount_(headers, ae, vendorName, full, priceCol, qtyCol, uidCol));
      existingLineKeys[lineKey] = true;
      if (aUid && uidToRow[aUid] == null) uidToRow[aUid] = -1;
    }
    if (newRows.length) {
      var nextRow = Math.max(archTab.getLastRow() + 1, dataStart);
      archTab.getRange(nextRow, 1, newRows.length, headers.length).setValues(newRows);
      if (cancelCol >= 0 && returnCol >= 0) {
        try {
          archTab.getRange(nextRow, cancelCol + 1, newRows.length, 2).insertCheckboxes();
        } catch (eCb) {}
      } else if (cancelCol >= 0) {
        try { archTab.getRange(nextRow, cancelCol + 1, newRows.length, 1).insertCheckboxes(); } catch (eCb2) {}
      }
      appended = newRows.length;
    }
  }

  SpreadsheetApp.flush();
  return { updated: updated, appended: appended, missUid: missUid, skippedDup: skippedDup };
}

function _psr_buildArchiveRowFromEcount_(headers, e, vendorName, full, priceCol, qtyCol, uidCol) {
  full = full || _pt_buildOrderTabColumnMap(headers);
  var row = [];
  for (var i = 0; i < headers.length; i++) row.push("");

  if (full.client >= 0) row[full.client] = vendorName || e.vendor || "";
  if (full.date >= 0) row[full.date] = e.date || "";
  if (full.code >= 0) row[full.code] = e.code || "";
  if (full.item >= 0) row[full.item] = e.item || "";
  if (qtyCol >= 0) row[qtyCol] = _psr_toNumber_(e.qty);
  if (priceCol >= 0) row[priceCol] = Math.round(_psr_toNumber_(e.total));
  if (full.recipient >= 0) row[full.recipient] = e.recipient || "";
  if (full.phone >= 0) row[full.phone] = e.phone || "";
  if (full.mobile >= 0 && !row[full.phone]) row[full.mobile] = e.phone || "";
  if (uidCol >= 0) row[uidCol] = e.uid || "";
  if (full.voucherMemo >= 0) row[full.voucherMemo] = "이카운트보정추가";
  if (full.invoice >= 0) row[full.invoice] = ""; // 송장 없으면 빈칸

  for (var h = 0; h < headers.length; h++) {
    var hn = String(headers[h] || "").trim();
    if (hn === "취소" || hn === "반품") row[h] = false;
  }
  return row;
}

/** 📂 독립시트 검증 — ③ 비교 실행 (복수 업체 가능) */
function partnerRunSettleReconcile() {
  var ui = SpreadsheetApp.getUi();
  var targets = _psr_resolveCompareSsListForRun_(true); // 독립시트 우선
  if (!targets || !targets.length) return;

  var lines = [];
  var ok = 0, skip = 0, fail = 0;
  for (var i = 0; i < targets.length; i++) {
    var ss = targets[i].ss;
    var label = targets[i].label || ss.getName();
    try {
      _psr_migrateOldTabNames_(ss);
      var settleTab = ss.getSheetByName(_PSR_TAB_SETTLE);
      var ecountTab = ss.getSheetByName(_PSR_TAB_ECOUNT);
      if (!settleTab || !ecountTab) {
        skip++;
        lines.push("⏭ " + label + ": 비교 탭 없음");
        continue;
      }
      var settleRows = _psr_parseSettleTab_(settleTab);
      var ecountRows = _psr_parseEcountTab_(ecountTab);
      if (!settleRows.length && !ecountRows.length) {
        skip++;
        lines.push("⏭ " + label + ": 데이터 없음");
        continue;
      }
      var result = _psr_reconcile_(settleRows, ecountRows);
      var resultTab = _psr_ensureTab_(ss, _PSR_TAB_RESULT, "#2e7d32");
      _psr_writeResultTab_(resultTab, result);
      var s = result.summary;
      ok++;
      lines.push(
        "✅ " + label +
          " | 일치" + s.matchOk +
          " 금액차" + s.amtDiff +
          " 마감만" + s.settleOnly +
          " 이카만" + s.ecountOnly
      );
    } catch (e) {
      fail++;
      lines.push("❌ " + label + ": " + e.message);
    }
    if (i % 5 === 4) SpreadsheetApp.flush();
  }

  ui.alert(
    "✅ 비교 실행 완료",
    "성공 " + ok + " / 스킵 " + skip + " / 실패 " + fail + "\n\n" + lines.join("\n"),
    ui.ButtonSet.OK
  );
}

// ═══════════════════════════════════════════
//  업체·월 선택 / 독립 시트
// ═══════════════════════════════════════════

/**
 * 업체 복수 선택 + 월 선택
 * @return {{ vendors: Array<{fileInfo, vendorName}>, parsed, yyyy, m, yyyyMM, archTabName }|null}
 */
function _psr_pickVendorsAndMonth_(title) {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) {
    ui.alert("협력업체 파일 없음");
    return null;
  }

  var names = [];
  for (var i = 0; i < files.length; i++) {
    names.push((i + 1) + ". " + files[i].name.replace("[협력업체] ", ""));
  }
  // prompt 길이 제한 대비: 목록이 너무 길면 앞부분만 표시 + 안내
  var listText = names.join("\n");
  if (listText.length > 3500) {
    listText = names.slice(0, 60).join("\n") + "\n… (이하 생략, 번호로 선택 / all=전체)";
  }
  var vResp = ui.prompt(
    title + " — 업체 선택",
    "업체 번호를 입력하세요.\n" +
      "· 여러 업체: 1,3,5  (쉼표)\n" +
      "· 전체: all\n\n" +
      listText,
    ui.ButtonSet.OK_CANCEL
  );
  if (vResp.getSelectedButton() !== ui.Button.OK) return null;

  var input = String(vResp.getResponseText() || "").trim().toLowerCase();
  var selected = [];
  if (input === "all" || input === "전체") {
    for (var a = 0; a < files.length; a++) {
      selected.push({
        fileInfo: files[a],
        vendorName: files[a].name.replace("[협력업체] ", "").trim(),
      });
    }
  } else {
    var nums = input.split(/[,\s]+/);
    var seen = {};
    for (var n = 0; n < nums.length; n++) {
      if (!nums[n]) continue;
      var idx = parseInt(nums[n], 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= files.length || seen[idx]) continue;
      seen[idx] = true;
      selected.push({
        fileInfo: files[idx],
        vendorName: files[idx].name.replace("[협력업체] ", "").trim(),
      });
    }
  }
  if (!selected.length) {
    ui.alert("선택된 업체가 없습니다.\n예: 1,3,5 또는 all");
    return null;
  }

  // ★ 월 팝업 없음 — 허브「비교검증_설정」B2 사용, 비우면/전달이면 전달 자동
  var parsed = _psr_resolveTargetMonthFromCtrl_();
  if (!parsed) return null;

  return {
    vendors: selected,
    parsed: parsed,
    yyyy: parsed.yyyy,
    m: parsed.m,
    yyyyMM: parsed.yyyy + ("0" + parsed.m).slice(-2),
    archTabName: "(" + parsed.yyyy + "년 " + parsed.m + "월) 발주 마감",
  };
}

/**
 * 대상월 결정 (팝업 없음)
 * - C2 = "자동"(기본) → 항상 전달
 * - C2 = "고정" → B2에 입력한 월 사용
 */
function _psr_resolveTargetMonthFromCtrl_() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = _psr_ensureSettingsTab_(ss);
  var prev = _psr_getPreviousYearMonth_();
  var prevLabel = prev.yyyy + "-" + ("0" + prev.m).slice(-2);

  var mode = String(tab.getRange("C2").getDisplayValue() || "").trim();
  var raw = String(tab.getRange(_PSR_SETTINGS_MONTH_CELL).getDisplayValue() || "").trim();
  var isFixed = mode === "고정" || mode.toLowerCase() === "fixed";

  if (!isFixed) {
    tab.getRange(_PSR_SETTINGS_MONTH_CELL).setNumberFormat("@").setValue(prevLabel);
    tab.getRange("C2").setValue("자동");
    tab.getRange("B3").setValue("적용: 전달 자동 (" + prevLabel + ")");
    return prev;
  }

  if (!raw || raw === "전달" || raw.toLowerCase() === "auto") {
    tab.getRange(_PSR_SETTINGS_MONTH_CELL).setNumberFormat("@").setValue(prevLabel);
    tab.getRange("B3").setValue("적용: 전달 (" + prevLabel + ") — 고정모드지만 값 비어 전달 사용");
    return prev;
  }

  var parsed = _psr_parseYearMonth_(raw);
  if (!parsed) {
    ui.alert(
      "대상월 형식 오류",
      "「" + _PSR_TAB_SETTINGS + "」탭 B2를 확인하세요.\n현재: " + raw + "\n예: " + prevLabel,
      ui.ButtonSet.OK
    );
    try { ss.setActiveSheet(tab); } catch (e) {}
    return null;
  }

  var label = parsed.yyyy + "-" + ("0" + parsed.m).slice(-2);
  tab.getRange(_PSR_SETTINGS_MONTH_CELL).setNumberFormat("@").setValue(label);
  tab.getRange("B3").setValue("적용: 지정월 고정 (" + label + ")");
  return parsed;
}

/** 허브「비교검증_설정」— 상단 B2 대상월, C2 자동/고정 */
function _psr_ensureSettingsTab_(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PSR_TAB_SETTINGS);
  var isNew = false;
  if (!tab) {
    tab = ss.insertSheet(_PSR_TAB_SETTINGS, 0);
    isNew = true;
  }
  try { tab.setTabColor("#6a1b9a"); } catch (e) {}

  var prev = _psr_getPreviousYearMonth_();
  var prevLabel = prev.yyyy + "-" + ("0" + prev.m).slice(-2);

  tab.getRange("A1").setValue("대상월");
  tab.getRange("C1").setValue("모드");
  tab.getRange("A1:C1")
    .setBackground("#6a1b9a").setFontColor("white").setFontWeight("bold");

  var curMonth = String(tab.getRange(_PSR_SETTINGS_MONTH_CELL).getDisplayValue() || "").trim();
  var curMode = String(tab.getRange("C2").getDisplayValue() || "").trim();
  if (isNew || !curMode) tab.getRange("C2").setValue("자동");
  // 자동 모드이거나 비어 있으면 전달로 채움
  if (isNew || !curMonth || curMode !== "고정") {
    tab.getRange(_PSR_SETTINGS_MONTH_CELL).setNumberFormat("@").setValue(prevLabel);
  }

  tab.getRange(_PSR_SETTINGS_MONTH_CELL)
    .setBackground("#fff9c4").setFontWeight("bold").setFontSize(14)
    .setHorizontalAlignment("center").setNumberFormat("@");
  tab.getRange("C2")
    .setBackground("#e1bee7").setFontWeight("bold")
    .setHorizontalAlignment("center");
  try {
    tab.getRange("C2").setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(["자동", "고정"], true)
        .setAllowInvalid(false)
        .build()
    );
  } catch (eDv) {}

  tab.getRange("A2").setValue("yyyy-MM");
  tab.getRange("A2").setFontColor("#666666");
  tab.getRange("A4").setValue("사용법").setFontWeight("bold");
  tab.getRange("A5").setValue(
    "▶ 기본(모드=자동): 항상 전달(" + prevLabel + ")로 바로 불러옵니다. 월 팝업 없음.\n" +
      "▶ 다른 월이 필요할 때만: C2를「고정」으로 바꾸고 B2에 월 입력 (예: 2026-06)\n" +
      "▶ 다시 전달로: C2를「자동」으로 두거나 메뉴「전달로 맞추기」"
  );
  tab.getRange("A5:E7").merge().setVerticalAlignment("top").setWrap(true);
  try {
    tab.setColumnWidth(1, 80);
    tab.setColumnWidth(2, 140);
    tab.setColumnWidth(3, 80);
    tab.setRowHeight(2, 36);
  } catch (eW) {}
  return tab;
}

/** 오늘 기준 전달(이전 달) yyyy/m — Asia/Seoul */
function _psr_getPreviousYearMonth_() {
  var now = new Date();
  var y = parseInt(Utilities.formatDate(now, "Asia/Seoul", "yyyy"), 10);
  var m = parseInt(Utilities.formatDate(now, "Asia/Seoul", "M"), 10);
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return { yyyy: String(y), m: m };
}

/**
 * 선택 업체들의 '(YYYY년 M월) 발주 마감' 탭에서 월 목록 수집
 * @return {string[]} "2026-07" 형식 정렬 목록
 */
function _psr_listArchiveMonths_(vendors) {
  var set = {};
  var pat = /^\((\d{4})년\s*(\d{1,2})월\)\s*발주\s*마감$/;
  var maxFiles = Math.min(vendors.length, 30); // 목록용 상한
  for (var i = 0; i < maxFiles; i++) {
    try {
      var ss = SpreadsheetApp.openById(vendors[i].fileInfo.id);
      var sheets = ss.getSheets();
      for (var s = 0; s < sheets.length; s++) {
        var mm = String(sheets[s].getName() || "").match(pat);
        if (!mm) continue;
        var key = mm[1] + "-" + ("0" + parseInt(mm[2], 10)).slice(-2);
        set[key] = true;
      }
    } catch (e) {}
  }
  return Object.keys(set).sort().reverse();
}

/** 하위 호환: 단일 선택 래퍼 */
function _psr_pickVendorAndMonth_(title) {
  var batch = _psr_pickVendorsAndMonth_(title);
  if (!batch || !batch.vendors.length) return null;
  var v = batch.vendors[0];
  return {
    fileInfo: v.fileInfo,
    vendorName: v.vendorName,
    parsed: batch.parsed,
    yyyy: batch.yyyy,
    m: batch.m,
    yyyyMM: batch.yyyyMM,
    archTabName: batch.archTabName,
  };
}

function _psr_propKey_(vendorFileId, yyyyMM) {
  return _PSR_PROP_PREFIX + vendorFileId + ":" + yyyyMM;
}

function _psr_getVerifyFolder_() {
  var parentId = (typeof _PT !== "undefined" && _PT.FOLDER_ID) ? _PT.FOLDER_ID : null;
  if (!parentId) {
    // 폴백: 허브 파일이 있는 폴더
    try {
      var hubFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
      var parents = hubFile.getParents();
      if (parents.hasNext()) parentId = parents.next().getId();
    } catch (e) {}
  }
  if (!parentId) return null;

  var parent = DriveApp.getFolderById(parentId);
  var it = parent.getFoldersByName(_PSR_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return parent.createFolder(_PSR_FOLDER_NAME);
}

function _psr_getOrCreateCompareSs_(vendorFileId, vendorName, parsed) {
  var yyyyMM = parsed.yyyy + ("0" + parsed.m).slice(-2);
  var propKey = _psr_propKey_(vendorFileId, yyyyMM);
  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty(propKey);
  var fileName = _PSR_FILE_PREFIX + vendorName + "_" + parsed.yyyy + "-" + ("0" + parsed.m).slice(-2);

  if (savedId) {
    try {
      var existSs = SpreadsheetApp.openById(savedId);
      return { ss: existSs, isNew: false };
    } catch (eOpen) {
      props.deleteProperty(propKey);
    }
  }

  // Drive에서 동일 이름 검색 (속성 유실 대비)
  try {
    var folder = _psr_getVerifyFolder_();
    if (folder) {
      var fit = folder.getFilesByName(fileName);
      if (fit.hasNext()) {
        var f = fit.next();
        props.setProperty(propKey, f.getId());
        return { ss: SpreadsheetApp.openById(f.getId()), isNew: false };
      }
    }
  } catch (eFind) {}

  var ss = SpreadsheetApp.create(fileName);
  var newId = ss.getId();
  props.setProperty(propKey, newId);

  try {
    var folder2 = _psr_getVerifyFolder_();
    if (folder2) {
      var newFile = DriveApp.getFileById(newId);
      folder2.addFile(newFile);
      try {
        var root = DriveApp.getRootFolder();
        root.removeFile(newFile);
      } catch (eRm) {}
    }
  } catch (eMove) {}

  // 기본 Sheet1 정리
  try {
    var sheets = ss.getSheets();
    // 비교 탭 만든 뒤 Sheet1 삭제
  } catch (eSh) {}

  return { ss: ss, isNew: true };
}

function _psr_initCompareTabs_(ss, vendorName, parsed, keepEcountData, vendorFileId) {
  _psr_migrateOldTabNames_(ss);
  if (vendorFileId) _psr_writeCompareMeta_(ss, vendorFileId, vendorName, parsed);

  var settle = _psr_ensureTab_(ss, _PSR_TAB_SETTLE, "#1565c0");
  var ecount = _psr_ensureTab_(ss, _PSR_TAB_ECOUNT, "#c62828");
  var result = _psr_ensureTab_(ss, _PSR_TAB_RESULT, "#2e7d32");

  // 안내 탭(있으면) / 기본 시트 제거 (_비교메타는 유지)
  try {
    var all = ss.getSheets();
    for (var i = all.length - 1; i >= 0; i--) {
      var n = all[i].getName();
      if (n === _PSR_TAB_SETTLE || n === _PSR_TAB_ECOUNT || n === _PSR_TAB_RESULT || n === _PSR_TAB_META) continue;
      if (all.length > 3 && (n === "시트1" || n === "Sheet1" || n.indexOf("대사_") === 0)) {
        try { ss.deleteSheet(all[i]); } catch (eDel) {}
      }
    }
  } catch (eClean) {}

  // 월마감 안내 (비어 있을 때만)
  if (settle.getLastRow() < 1 || !String(settle.getRange(1, 1).getValue() || "").trim()) {
    settle.clear();
    settle.getRange(1, 1).setValue("업체");
    settle.getRange(1, 2).setValue(
      "← 이 시트 메뉴「📑 비교검증 → 월마감 불러오기」또는 붙여넣기 | " +
        vendorName + " / " + parsed.yyyy + "-" + ("0" + parsed.m).slice(-2)
    );
    settle.getRange(1, 1, 1, 2)
      .setBackground("#1565c0").setFontColor("white").setFontWeight("bold");
    settle.setFrozenRows(1);
  }

  // 이카운트 실데이터가 없으면 안내 양식만 채움 (붙여넣은 데이터는 유지)
  var hasEcountData = false;
  try {
    if (ecount.getLastRow() >= 2) {
      var scanN = Math.min(ecount.getLastRow(), 8);
      var scanVals = ecount.getRange(1, 1, scanN, Math.max(ecount.getLastColumn(), 1)).getValues();
      hasEcountData = _psr_detectEcountHeaderRow_(scanVals) >= 0 &&
        String(ecount.getRange(1, 1).getValue() || "").indexOf("붙여넣") === -1;
    }
  } catch (eDet) {}

  if (!hasEcountData) {
    ecount.clear();
    ecount.getRange(1, 1).setValue(
      "이카운트 판매현황 엑셀을 A1부터 그대로 붙여넣으세요 (제목행+헤더+데이터 허용) | " +
        vendorName + " / " + parsed.yyyy + "-" + ("0" + parsed.m).slice(-2)
    );
    ecount.getRange(2, 1, 1, _PSR_ECOUNT_HINT_HEADERS.length).setValues([_PSR_ECOUNT_HINT_HEADERS]);
    ecount.getRange(1, 1).setBackground("#ffebee").setFontWeight("bold");
    ecount.getRange(2, 1, 1, _PSR_ECOUNT_HINT_HEADERS.length)
      .setBackground("#c62828").setFontColor("white").setFontWeight("bold");
    ecount.setFrozenRows(2);
  }

  if (result.getLastRow() < 4) {
    result.clear();
    result.getRange(1, 1).setValue("비교 결과 (이 시트 메뉴「📑 비교검증 → 비교 실행」)");
    result.getRange(1, 1, 1, _PSR_RESULT_HEADERS.length).merge()
      .setBackground("#2e7d32").setFontColor("white").setFontWeight("bold")
      .setHorizontalAlignment("center");
    result.getRange(4, 1, 1, _PSR_RESULT_HEADERS.length).setValues([_PSR_RESULT_HEADERS])
      .setBackground("#37474f").setFontColor("white").setFontWeight("bold")
      .setHorizontalAlignment("center");
    result.setFrozenRows(4);
  }

  try { ss.setActiveSheet(settle); } catch (eAct) {}
}

function _psr_isCompareSpreadsheet_(ss) {
  if (!ss) return false;
  var name = String(ss.getName() || "");
  // ★ 파일명 기준만 — 허브에 비교_* 탭이 있어도 독립 비교시트로 보지 않음
  return name.indexOf(_PSR_FILE_PREFIX) === 0 || name.indexOf("[검증]") === 0;
}

function _psr_writeCompareMeta_(ss, vendorFileId, vendorName, parsed) {
  var tab = ss.getSheetByName(_PSR_TAB_META);
  if (!tab) tab = ss.insertSheet(_PSR_TAB_META);
  tab.clear();
  tab.getRange(1, 1, 5, 2).setValues([
    ["vendorFileId", String(vendorFileId || "")],
    ["vendorName", String(vendorName || "")],
    ["yyyy", String(parsed.yyyy || "")],
    ["m", String(parsed.m || "")],
    ["updated", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm")],
  ]);
  try { tab.hideSheet(); } catch (eH) {}
}

function _psr_readCompareMeta_(ss) {
  var tab = ss.getSheetByName(_PSR_TAB_META);
  if (tab && tab.getLastRow() >= 4) {
    var vals = tab.getRange(1, 1, 4, 2).getValues();
    var map = {};
    for (var i = 0; i < vals.length; i++) map[String(vals[i][0])] = String(vals[i][1] || "").trim();
    // vendorFileId 없어도 월·업체명 메타는 사용 (상품정보 복수 업체 등)
    if (map.yyyy || map.vendorFileId || map.vendorName) {
      return {
        vendorFileId: map.vendorFileId || "",
        vendorName: map.vendorName || "",
        yyyy: map.yyyy || "",
        m: parseInt(map.m, 10) || 0,
      };
    }
  }
  // 파일명 폴백: [검증] 월마감-이카운트_업체_2026-07
  var parsedName = _psr_parseCompareFileName_(ss.getName());
  if (!parsedName) return null;
  var files = _pt_listFiles();
  var vendorFileId = "";
  for (var fi = 0; fi < files.length; fi++) {
    var short = files[fi].name.replace("[협력업체] ", "").trim();
    if (short === parsedName.vendorName || files[fi].name.indexOf(parsedName.vendorName) !== -1) {
      vendorFileId = files[fi].id;
      break;
    }
  }
  if (!vendorFileId) {
    return {
      vendorFileId: "",
      vendorName: parsedName.vendorName,
      yyyy: parsedName.yyyy,
      m: parsedName.m,
    };
  }
  return {
    vendorFileId: vendorFileId,
    vendorName: parsedName.vendorName,
    yyyy: parsedName.yyyy,
    m: parsedName.m,
  };
}

function _psr_parseCompareFileName_(name) {
  var s = String(name || "");
  if (s.indexOf(_PSR_FILE_PREFIX) !== 0) return null;
  var rest = s.substring(_PSR_FILE_PREFIX.length);
  var m = rest.match(/_(\d{4})-(\d{2})$/);
  if (!m) return null;
  return {
    vendorName: rest.substring(0, m.index),
    yyyy: m[1],
    m: parseInt(m[2], 10),
  };
}

/**
 * 비교시트에 바운드 스크립트 설치 — onOpen 메뉴「📑 비교검증」
 * Pack2U 라이브러리로 partnerCompareCollectOnActive / partnerCompareRunOnActive 호출
 */
function _psr_installCompareBoundScript_(ss) {
  var sheetId = ss.getId();
  var oauthToken = ScriptApp.getOAuthToken();
  var props = PropertiesService.getScriptProperties();
  var scriptKey = _PSR_BOUND_SCRIPT_PREFIX + sheetId;
  var savedScriptId = String(props.getProperty(scriptKey) || "").trim();

  var code = [
    "// Pack2U 비교검증 시트 메뉴 (자동 설치)",
    "function onOpen() {",
    "  try {",
    "    SpreadsheetApp.getUi()",
    "      .createMenu('📑 비교검증')",
    "      .addItem('월마감 불러오기', 'compareCollectSettle')",
    "      .addItem('비교 실행', 'compareRun')",
    "      .addSeparator()",
    "      .addItem('이카운트 기준 월마감 수정', 'compareApplyEcountFix')",
    "      .addToUi();",
    "  } catch (e) {}",
    "}",
    "function compareCollectSettle() {",
    "  Pack2U.partnerCompareCollectOnActive();",
    "}",
    "function compareRun() {",
    "  Pack2U.partnerCompareRunOnActive();",
    "}",
    "function compareApplyEcountFix() {",
    "  Pack2U.partnerCompareApplyEcountFixOnActive();",
    "}",
  ].join("\n");

  var manifest = JSON.stringify({
    timeZone: "Asia/Seoul",
    dependencies: {
      libraries: [{
        userSymbol: "Pack2U",
        libraryId: _PSR_HUB_LIBRARY_ID,
        version: "0",
        developmentMode: true,
      }],
    },
    exceptionLogging: "STACKDRIVER",
    runtimeVersion: "V8",
  });

  function putContent_(scriptId) {
    return UrlFetchApp.fetch(
      "https://script.googleapis.com/v1/projects/" + scriptId + "/content",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + oauthToken,
          "Content-Type": "application/json",
          Expect: "",
        },
        payload: JSON.stringify({
          files: [
            { name: "Code", type: "SERVER_JS", source: code },
            { name: "appsscript", type: "JSON", source: manifest },
          ],
        }),
        muteHttpExceptions: true,
      }
    );
  }

  if (savedScriptId) {
    var upd = putContent_(savedScriptId);
    if (upd.getResponseCode() === 200) return true;
    if ([401, 403, 404, 410].indexOf(upd.getResponseCode()) !== -1) {
      props.deleteProperty(scriptKey);
      savedScriptId = "";
    } else {
      throw new Error("비교시트 스크립트 업데이트 실패(" + upd.getResponseCode() + "): " + upd.getContentText());
    }
  }

  var createResp = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + oauthToken,
      "Content-Type": "application/json",
      Expect: "",
    },
    payload: JSON.stringify({
      title: "Pack2U 비교검증 메뉴",
      parentId: sheetId,
    }),
    muteHttpExceptions: true,
  });
  if (createResp.getResponseCode() !== 200) {
    throw new Error("비교시트 스크립트 생성 실패(" + createResp.getResponseCode() + "): " + createResp.getContentText());
  }
  var newId = JSON.parse(createResp.getContentText()).scriptId;
  var putResp = putContent_(newId);
  if (putResp.getResponseCode() !== 200) {
    throw new Error("비교시트 스크립트 코드 주입 실패(" + putResp.getResponseCode() + "): " + putResp.getContentText());
  }
  props.setProperty(scriptKey, newId);
  return true;
}

function _psr_migrateOldTabNames_(ss) {
  var map = {
    "대사_월마감": _PSR_TAB_SETTLE,
    "대사_이카운트": _PSR_TAB_ECOUNT,
    "대사_결과": _PSR_TAB_RESULT,
  };
  for (var oldName in map) {
    var oldTab = ss.getSheetByName(oldName);
    if (!oldTab) continue;
    var newName = map[oldName];
    if (ss.getSheetByName(newName)) {
      try { ss.deleteSheet(oldTab); } catch (e) {}
    } else {
      try { oldTab.setName(newName); } catch (e2) {}
    }
  }
}

/** 허브(상품정보)에 남은 대사_* 탭 → 비교_* 로 이름 변경 */
function partnerRenameHubCompareTabs() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var before = [];
  var names = ["대사_월마감", "대사_이카운트", "대사_결과"];
  for (var i = 0; i < names.length; i++) {
    if (ss.getSheetByName(names[i])) before.push(names[i]);
  }
  _psr_migrateOldTabNames_(ss);
  var after = [];
  if (ss.getSheetByName(_PSR_TAB_SETTLE)) after.push(_PSR_TAB_SETTLE);
  if (ss.getSheetByName(_PSR_TAB_ECOUNT)) after.push(_PSR_TAB_ECOUNT);
  if (ss.getSheetByName(_PSR_TAB_RESULT)) after.push(_PSR_TAB_RESULT);

  ui.alert(
    "탭 이름 정리",
    (before.length
      ? "변경: " + before.join(", ") + " → 비교_*\n"
      : "변경할 대사_* 탭 없음\n") +
      "현재: " + (after.length ? after.join(", ") : "(비교 탭 없음)"),
    ui.ButtonSet.OK
  );
}

/**
 * 비교 실행 대상 시트 목록 (독립시트 검증용)
 * @param {boolean} indepOnly true면 허브 탭 경로 제안 없이 독립시트만
 * @return {Array<{ss, label}>|null}
 */
function _psr_resolveCompareSsListForRun_(indepOnly) {
  var ui = SpreadsheetApp.getUi();
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}

  if (active) {
    _psr_migrateOldTabNames_(active);
    var activeName = String(active.getName() || "");
    var isIndepFile =
      activeName.indexOf(_PSR_FILE_PREFIX) === 0 || activeName.indexOf("[검증]") === 0;

    if (isIndepFile && active.getSheetByName(_PSR_TAB_SETTLE) && active.getSheetByName(_PSR_TAB_ECOUNT)) {
      var only = ui.alert(
        "독립시트 비교 실행 범위",
        "현재 열린 비교시트만 실행할까요?\n\n" +
          "YES = 현재 파일만\n" +
          "NO  = 업체 여러 개 선택해서 일괄 실행",
        ui.ButtonSet.YES_NO_CANCEL
      );
      if (only === ui.Button.CANCEL) return null;
      if (only === ui.Button.YES) {
        return [{ ss: active, label: activeName }];
      }
    } else if (!indepOnly && active.getSheetByName(_PSR_TAB_SETTLE) && active.getSheetByName(_PSR_TAB_ECOUNT)) {
      // 하위호환: 허브에서 옛 메뉴로 호출된 경우
      var go = ui.alert(
        "비교 실행 대상",
        "상품정보시트에 비교 탭이 있습니다.\n\n" +
          "YES = 상품정보시트에서 실행\n" +
          "NO  = 독립 비교시트에서 실행(업체 선택)",
        ui.ButtonSet.YES_NO_CANCEL
      );
      if (go === ui.Button.CANCEL) return null;
      if (go === ui.Button.YES) {
        return [{ ss: active, label: activeName }];
      }
    }
  }

  var batch = _psr_pickVendorsAndMonth_("독립시트 — 비교 실행");
  if (!batch) return null;
  var out = [];
  for (var i = 0; i < batch.vendors.length; i++) {
    var v = batch.vendors[i];
    try {
      var created = _psr_getOrCreateCompareSs_(v.fileInfo.id, v.vendorName, batch.parsed);
      _psr_initCompareTabs_(created.ss, v.vendorName, batch.parsed, true, v.fileInfo.id);
      out.push({ ss: created.ss, label: v.vendorName });
    } catch (e) {
      Logger.log("[PSR] 비교시트 열기 실패 " + v.vendorName + ": " + e.message);
    }
  }
  if (!out.length) {
    ui.alert("실행할 비교시트를 열지 못했습니다.");
    return null;
  }
  return out;
}

// ═══════════════════════════════════════════
//  탭 유틸
// ═══════════════════════════════════════════

function _psr_ensureTab_(ss, name, color) {
  var tab = ss.getSheetByName(name);
  if (!tab) tab = ss.insertSheet(name);
  try { if (color) tab.setTabColor(color); } catch (e) {}
  return tab;
}

function _psr_parseYearMonth_(raw) {
  var s = String(raw || "").trim();
  var m1 = s.match(/^(\d{4})\s*[-/.]\s*(\d{1,2})$/);
  if (m1) {
    return { yyyy: m1[1], m: parseInt(m1[2], 10) };
  }
  var m2 = s.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월$/);
  if (m2) {
    return { yyyy: m2[1], m: parseInt(m2[2], 10) };
  }
  return null;
}

function _psr_normHeader_(h) {
  return String(h || "").replace(/\s+/g, "").toLowerCase();
}

function _psr_toNumber_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  var s = String(v).replace(/[,\s원]/g, "").trim();
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function _psr_isChecked_(v) {
  if (v === true) return true;
  var s = String(v || "").replace(/\s/g, "").toLowerCase();
  return s === "true" || s === "✓" || s === "v" || s === "체크" || s === "1" || s === "y" || s === "yes";
}

function _psr_fmtNum_(n) {
  var x = Math.round(_psr_toNumber_(n));
  var sign = x < 0 ? "-" : "";
  var abs = String(Math.abs(x));
  var out = "";
  while (abs.length > 3) {
    out = "," + abs.slice(-3) + out;
    abs = abs.slice(0, -3);
  }
  return sign + abs + out;
}

function _psr_phoneTail4_(phone) {
  var d = String(phone || "").replace(/[^0-9]/g, "");
  if (d.length >= 4) return d.substring(d.length - 4);
  return d;
}

function _psr_parseUidFromSabang_(nameCell) {
  var s = String(nameCell || "").trim();
  if (!s) return { name: "", uid: "" };
  var slash = s.lastIndexOf("/");
  if (slash === -1) return { name: s, uid: "" };
  return {
    name: s.substring(0, slash).trim(),
    uid: s.substring(slash + 1).trim(),
  };
}

function _psr_findCol_(headers, keywords) {
  for (var i = 0; i < headers.length; i++) {
    var h = _psr_normHeader_(headers[i]);
    for (var k = 0; k < keywords.length; k++) {
      if (h.indexOf(keywords[k]) !== -1) return i;
    }
  }
  return -1;
}

function _psr_auxKey_(code, qty, phone) {
  return String(code || "").trim() + "|" + String(Math.round(_psr_toNumber_(qty))) + "|" + _psr_phoneTail4_(phone);
}

// ═══════════════════════════════════════════
//  월마감 읽기
// ═══════════════════════════════════════════

function _psr_readArchiveTab_(archTab, vendorName) {
  var lr = archTab.getLastRow();
  var lc = archTab.getLastColumn();
  var headers = [];
  var dataStart = 2;
  var headerRow = 1;

  // 표준 마감: 4행 헤더 / 5행~ 데이터
  if (typeof _PMS_HEADER_ROW !== "undefined" && typeof _PMS_DATA_START !== "undefined") {
    headerRow = _PMS_HEADER_ROW;
    dataStart = _PMS_DATA_START;
  } else {
    headerRow = 4;
    dataStart = 5;
  }

  if (lr >= headerRow) {
    headers = archTab.getRange(headerRow, 1, 1, lc).getValues()[0];
  }

  // 헤더 유효성 낮으면 1행 헤더로 폴백
  var uidProbe = _psr_findCol_(headers, ["고유id", "uniqueid"]);
  if (uidProbe < 0 && lr >= 1) {
    var h1 = archTab.getRange(1, 1, 1, lc).getValues()[0];
    if (_psr_findCol_(h1, ["고유id", "uniqueid", "이카운트코드", "품목코드"]) >= 0) {
      headers = h1;
      headerRow = 1;
      dataStart = 2;
    }
  }

  var outHeaders = ["업체"].concat(headers.map(function (h) { return String(h || ""); }));
  var rows = [];
  if (lr < dataStart) return { headers: outHeaders, rows: rows };

  var data = archTab.getRange(dataStart, 1, lr - dataStart + 1, lc).getValues();
  for (var r = 0; r < data.length; r++) {
    var empty = true;
    for (var c = 0; c < data[r].length; c++) {
      if (String(data[r][c] || "").trim() !== "") { empty = false; break; }
    }
    if (empty) continue;
    rows.push([vendorName].concat(data[r]));
  }
  return { headers: outHeaders, rows: rows };
}

function _psr_parseSettleTab_(tab) {
  var lr = tab.getLastRow();
  var lc = tab.getLastColumn();
  if (lr < 2 || lc < 1) return [];

  var headers = tab.getRange(1, 1, 1, lc).getValues()[0];
  var col = {
    vendor: _psr_findCol_(headers, ["업체", "발주업체", "거래처명"]),
    date: _psr_findCol_(headers, ["주문일자", "일자"]),
    code: _psr_findCol_(headers, ["이카운트코드", "품목코드"]),
    item: _psr_findCol_(headers, ["품목명"]),
    qty: _psr_findCol_(headers, ["수량"]),
    price: _psr_findCol_(headers, ["정산금액", "금액"]),
    recipient: _psr_findCol_(headers, ["수취인"]),
    phone: _psr_findCol_(headers, ["수취인전화번호", "전화번호"]),
    uid: _psr_findCol_(headers, ["고유id", "uniqueid"]),
    cancel: _psr_findCol_(headers, ["취소"]),
    ret: _psr_findCol_(headers, ["반품"]),
  };

  // 취소/반품 열이 둘 다 잡히면 구분: "취소"만 / "반품"만 (취소반품사유는 제외)
  for (var hi = 0; hi < headers.length; hi++) {
    var hn = _psr_normHeader_(headers[hi]);
    if (hn === "취소") col.cancel = hi;
    if (hn === "반품") col.ret = hi;
  }

  var data = tab.getRange(2, 1, lr - 1, lc).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var uid = col.uid >= 0 ? String(row[col.uid] || "").trim() : "";
    var code = col.code >= 0 ? String(row[col.code] || "").trim() : "";
    if (!uid && !code) continue;

    var phone = col.phone >= 0 ? String(row[col.phone] || "").trim() : "";
    var qty = col.qty >= 0 ? _psr_toNumber_(row[col.qty]) : 0;
    var amt = col.price >= 0 ? _psr_toNumber_(row[col.price]) : 0;
    var cancel = col.cancel >= 0 && _psr_isChecked_(row[col.cancel]);
    var ret = col.ret >= 0 && _psr_isChecked_(row[col.ret]);
    var recipient = col.recipient >= 0 ? String(row[col.recipient] || "").trim() : "";
    var dateStr = "";
    if (col.date >= 0) {
      try {
        if (typeof _pms_parseDateStr_ === "function") {
          dateStr = _pms_parseDateStr_(row[col.date]) || "";
        }
      } catch (eD) {}
      if (!dateStr) dateStr = String(row[col.date] || "").trim();
    }

    out.push({
      uid: uid,
      aux: _psr_auxKey_(code, qty, phone),
      vendor: col.vendor >= 0 ? String(row[col.vendor] || "").trim() : "",
      date: dateStr,
      code: code,
      item: col.item >= 0 ? String(row[col.item] || "").trim() : "",
      qty: qty,
      amount: amt,
      recipient: recipient,
      phone: phone,
      cancelReturn: cancel || ret,
      sourceRow: i + 2,
    });
  }
  return out;
}

// ═══════════════════════════════════════════
//  이카운트 탭 파싱
// ═══════════════════════════════════════════

function _psr_detectEcountHeaderRow_(values) {
  // values: 2D array of first N rows
  for (var r = 0; r < values.length; r++) {
    var row = values[r] || [];
    var joined = row.map(function (c) { return _psr_normHeader_(c); }).join("|");
    if (
      joined.indexOf("품목코드") !== -1 &&
      (joined.indexOf("합계") !== -1 || joined.indexOf("주문자명") !== -1 || joined.indexOf("수량") !== -1)
    ) {
      return r; // 0-based in values
    }
  }
  return -1;
}

function _psr_parseEcountTab_(tab) {
  var lr = tab.getLastRow();
  var lc = Math.max(tab.getLastColumn(), 1);
  if (lr < 1) return [];

  var scanRows = Math.min(lr, 10);
  var scan = tab.getRange(1, 1, scanRows, lc).getValues();
  var headerIdx = _psr_detectEcountHeaderRow_(scan);
  if (headerIdx < 0) {
    // 안내 문구만 있는 경우
    return [];
  }

  var headers = scan[headerIdx];
  var col = {
    dateNo: _psr_findCol_(headers, ["일자-no", "일자no", "일자"]),
    code: _psr_findCol_(headers, ["품목코드"]),
    item: _psr_findCol_(headers, ["품목명"]),
    qty: _psr_findCol_(headers, ["수량"]),
    total: _psr_findCol_(headers, ["합계"]),
    vendor: _psr_findCol_(headers, ["거래처명"]),
    singleShip: _psr_findCol_(headers, ["단품배송비"]),
    bundleShip: _psr_findCol_(headers, ["묶음배송비"]),
    sabangName: _psr_findCol_(headers, ["주문자명(사방넷)", "주문자명"]),
    sabangPhone: _psr_findCol_(headers, ["전화번호(사방넷)", "전화번호"]),
  };
  // 사방넷 주문자명 열 정확 매칭 우선
  for (var hi = 0; hi < headers.length; hi++) {
    var hn = String(headers[hi] || "").replace(/\s/g, "");
    if (hn.indexOf("주문자명(사방넷)") !== -1 || hn.indexOf("주문자명（사방넷）") !== -1) {
      col.sabangName = hi;
    }
    if (hn.indexOf("전화번호(사방넷)") !== -1) col.sabangPhone = hi;
    if (hn === "합계") col.total = hi;
    if (hn === "단품배송비") col.singleShip = hi;
    if (hn === "묶음배송비") col.bundleShip = hi;
  }

  var dataStartRow = headerIdx + 2; // 1-based sheet row
  if (lr < dataStartRow) return [];

  var data = tab.getRange(dataStartRow, 1, lr - dataStartRow + 1, lc).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var code = col.code >= 0 ? String(row[col.code] || "").trim() : "";
    var sabang = col.sabangName >= 0 ? _psr_parseUidFromSabang_(row[col.sabangName]) : { name: "", uid: "" };
    if (!code && !sabang.uid) continue;

    var qty = col.qty >= 0 ? _psr_toNumber_(row[col.qty]) : 0;
    var total = col.total >= 0 ? _psr_toNumber_(row[col.total]) : 0;
    var ship1 = col.singleShip >= 0 ? _psr_toNumber_(row[col.singleShip]) : 0;
    var ship2 = col.bundleShip >= 0 ? _psr_toNumber_(row[col.bundleShip]) : 0;
    var shipSum = ship1 + ship2;
    var phone = col.sabangPhone >= 0 ? String(row[col.sabangPhone] || "").trim() : "";
    var dateNo = col.dateNo >= 0 ? String(row[col.dateNo] || "").trim() : "";
    var dateStr = "";
    var dm = dateNo.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (dm) {
      dateStr =
        dm[1] +
        ("0" + dm[2]).slice(-2) +
        ("0" + dm[3]).slice(-2);
    }

    out.push({
      uid: sabang.uid,
      aux: _psr_auxKey_(code, qty, phone),
      vendor: col.vendor >= 0 ? String(row[col.vendor] || "").trim() : "",
      date: dateStr,
      dateNo: dateNo,
      code: code,
      item: col.item >= 0 ? String(row[col.item] || "").trim() : "",
      qty: qty,
      total: total,
      ship: shipSum,
      productEst: total - shipSum,
      // 배송비 포함 개별단가 = 합계 ÷ 수량
      unitWithShip: qty > 0 ? total / qty : total,
      recipient: sabang.name,
      phone: phone,
      sourceRow: dataStartRow + i,
    });
  }
  return out;
}

// ═══════════════════════════════════════════
//  대사 엔진
// ═══════════════════════════════════════════

function _psr_reconcile_(settleRows, ecountRows) {
  var eByUid = {};
  var eByAux = {};
  var eUsed = {};

  for (var ei = 0; ei < ecountRows.length; ei++) {
    var er = ecountRows[ei];
    if (er.uid) {
      if (!eByUid[er.uid]) eByUid[er.uid] = [];
      eByUid[er.uid].push(ei);
    }
    if (er.aux) {
      if (!eByAux[er.aux]) eByAux[er.aux] = [];
      eByAux[er.aux].push(ei);
    }
  }

  var resultRows = [];
  var settleSum = 0;
  var ecountSum = 0;
  var ecountProductSum = 0;
  var ecountShipSum = 0;
  for (var sSumi = 0; sSumi < settleRows.length; sSumi++) settleSum += _psr_toNumber_(settleRows[sSumi].amount);
  for (var eSumi = 0; eSumi < ecountRows.length; eSumi++) {
    ecountSum += _psr_toNumber_(ecountRows[eSumi].total);
    ecountProductSum += _psr_toNumber_(ecountRows[eSumi].productEst);
    ecountShipSum += _psr_toNumber_(ecountRows[eSumi].ship);
  }

  var summary = {
    matchOk: 0,
    amtDiff: 0,
    qtyDiff: 0,
    settleOnly: 0,
    ecountOnly: 0,
    cancelReturn: 0,
    amtSumDiff: 0,
    settleSum: settleSum,
    ecountSum: ecountSum,
    ecountProductSum: ecountProductSum,
    ecountShipSum: ecountShipSum,
    productDiffSum: Math.round(settleSum - ecountProductSum),
  };

  function takeEcount(idxList) {
    if (!idxList || !idxList.length) return -1;
    for (var t = 0; t < idxList.length; t++) {
      var idx = idxList[t];
      if (!eUsed[idx]) {
        eUsed[idx] = true;
        return idx;
      }
    }
    return -1;
  }

  for (var si = 0; si < settleRows.length; si++) {
    var s = settleRows[si];
    var eIdx = -1;
    var matchHow = "";

    if (s.uid && eByUid[s.uid]) {
      eIdx = takeEcount(eByUid[s.uid]);
      if (eIdx >= 0) matchHow = "고유ID";
    }
    if (eIdx < 0 && s.aux && eByAux[s.aux]) {
      eIdx = takeEcount(eByAux[s.aux]);
      if (eIdx >= 0) matchHow = "보조키";
    }

    if (s.cancelReturn) {
      summary.cancelReturn++;
      var eCR = eIdx >= 0 ? ecountRows[eIdx] : null;
      resultRows.push(_psr_makeResultRow_(
        eCR ? "월마감_취소반품(이카존재)" : "월마감_취소반품",
        s,
        eCR,
        matchHow ? (matchHow + " / 취소·반품 체크") : "취소·반품 체크"
      ));
      if (eCR) {
        summary.amtSumDiff += (s.amount - eCR.total);
      } else {
        summary.amtSumDiff += s.amount;
      }
      continue;
    }

    if (eIdx < 0) {
      summary.settleOnly++;
      summary.amtSumDiff += s.amount;
      resultRows.push(_psr_makeResultRow_("월마감만", s, null, "이카운트에 없음"));
      continue;
    }

    var e = ecountRows[eIdx];
    var qtySame = Math.round(s.qty) === Math.round(e.qty);
    var amtDiff = Math.round(s.amount - e.total);
    var amtOk = Math.abs(amtDiff) <= _PSR_AMT_TOLERANCE;
    summary.amtSumDiff += (s.amount - e.total);

    var status = "양쪽일치";
    var note = matchHow;
    if (!qtySame && !amtOk) {
      status = "수량불일치";
      note = matchHow + " / 수량·금액 모두 다름";
      summary.qtyDiff++;
    } else if (!qtySame) {
      status = "수량불일치";
      note = matchHow;
      summary.qtyDiff++;
    } else if (!amtOk) {
      status = "금액불일치";
      note = matchHow;
      var unitEchk = e.unitWithShip != null ? e.unitWithShip : (e.qty > 0 ? e.total / e.qty : 0);
      if (_psr_isSingleUnitSettleAmt_(s.amount, unitEchk, s.qty)) {
        note += " / 1개단가마감(수량×단가 미적용)";
      } else if (_psr_isUnitMultipleAmtDiff_(s.amount, e.total, unitEchk)) {
        note += " / 단가배수차이(수량×단가 미적용 가능)";
      } else if (Math.round(_psr_toNumber_(s.amount)) === 0) {
        note += " / 단가미기입";
      } else if (Math.abs(s.amount - e.productEst) <= _PSR_AMT_TOLERANCE) {
        note += " / 배송비 포함 차이 가능(상품추정은 일치)";
      } else if (e.ship > 0) {
        note += " / 배송비=" + _psr_fmtNum_(e.ship);
      }
      summary.amtDiff++;
    } else {
      summary.matchOk++;
    }

    resultRows.push(_psr_makeResultRow_(status, s, e, note));
  }

  for (var ej = 0; ej < ecountRows.length; ej++) {
    if (eUsed[ej]) continue;
    var eo = ecountRows[ej];
    summary.ecountOnly++;
    summary.amtSumDiff -= eo.total;
    resultRows.push(_psr_makeResultRow_("이카운트만", null, eo, "월마감에 없음"));
  }

  // 불일치·편측을 위로, 양쪽일치는 아래
  var rank = {
    "금액불일치": 1,
    "수량불일치": 2,
    "월마감만": 3,
    "이카운트만": 4,
    "월마감_취소반품(이카존재)": 5,
    "월마감_취소반품": 6,
    "양쪽일치": 9,
  };
  resultRows.sort(function (a, b) {
    var ra = rank[a[0]] || 8;
    var rb = rank[b[0]] || 8;
    if (ra !== rb) return ra - rb;
    return String(a[1]).localeCompare(String(b[1]));
  });

  return { rows: resultRows, summary: summary };
}

/**
 * 합계차이가 이카 개별단가의 정수 배수인지 판정.
 * (수량 미적용: 마감에 1개분만 들어간 경우 등 → 단가차이로 보지 않음)
 */
function _psr_isUnitMultipleAmtDiff_(settleAmt, ecountTotal, unitE) {
  var unit = Math.round(_psr_toNumber_(unitE));
  if (unit <= 0) return false;
  var diff = Math.round(_psr_toNumber_(settleAmt) - _psr_toNumber_(ecountTotal));
  var absDiff = Math.abs(diff);
  if (absDiff < 1) return false;
  var n = Math.round(absDiff / unit);
  if (n < 1) return false;
  return Math.abs(absDiff - n * unit) <= _PSR_AMT_TOLERANCE;
}

/** 마감금액이 이카 1개 단가와 같고 수량이 2 이상 → 1개분만 마감된 패턴 */
function _psr_isSingleUnitSettleAmt_(settleAmt, unitE, qty) {
  var unit = Math.round(_psr_toNumber_(unitE));
  var amt = Math.round(_psr_toNumber_(settleAmt));
  var q = Math.round(_psr_toNumber_(qty));
  if (unit <= 0 || q <= 1) return false;
  return Math.abs(amt - unit) <= _PSR_AMT_TOLERANCE;
}

function _psr_makeResultRow_(status, s, e, note) {
  s = s || {};
  e = e || {};
  note = note || "";
  var amtSettle = s.amount != null ? s.amount : "";
  var amtE = e.total != null ? e.total : "";
  var unitE = e.unitWithShip != null ? e.unitWithShip : "";
  if (unitE === "" && amtE !== "") {
    unitE = (e.qty > 0) ? (amtE / e.qty) : amtE;
  }
  var qtyS = s.qty != null ? s.qty : "";
  var qtyE = e.qty != null ? e.qty : "";
  var qtyForCheck = qtyS !== "" ? qtyS : qtyE;

  // 합계차이: 마감(줄합계) − 이카 합계(배송 포함)
  var totalDiff = "";
  if (amtSettle !== "" && amtE !== "") totalDiff = Math.round(amtSettle - amtE);
  else if (amtSettle !== "") totalDiff = Math.round(amtSettle);
  else if (amtE !== "") totalDiff = Math.round(-amtE);

  // 단가차이: 마감 개별단가(금액÷수량) − 이카 개별단가(합계÷수량, 배송포함)
  // ★ 금액차이가 단가 배수이면 수량×단가 미적용 → 단가차이에서 제외
  var unitSettle = "";
  if (amtSettle !== "") {
    unitSettle = (qtyS > 0) ? (amtSettle / qtyS) : amtSettle;
  }
  var unitDiff = "";
  var skipUnitDiff = false;

  if (amtSettle !== "" && Math.round(_psr_toNumber_(amtSettle)) === 0 && amtE !== "" && _psr_toNumber_(amtE) > 0) {
    skipUnitDiff = true;
    if (note.indexOf("단가미기입") === -1) note += (note ? " / " : "") + "단가미기입";
  } else if (
    amtSettle !== "" &&
    amtE !== "" &&
    unitE !== "" &&
    _psr_isUnitMultipleAmtDiff_(amtSettle, amtE, unitE)
  ) {
    skipUnitDiff = true;
    if (_psr_isSingleUnitSettleAmt_(amtSettle, unitE, qtyForCheck)) {
      if (note.indexOf("1개단가마감") === -1) {
        note += (note ? " / " : "") + "1개단가마감(수량×단가 미적용)";
      }
    } else if (note.indexOf("단가배수차이") === -1) {
      note += (note ? " / " : "") + "단가배수차이(수량×단가 미적용 가능)";
    }
  }

  if (!skipUnitDiff) {
    if (unitSettle !== "" && unitE !== "") unitDiff = Math.round(unitSettle - unitE);
    else if (unitSettle !== "") unitDiff = Math.round(unitSettle);
    else if (unitE !== "") unitDiff = Math.round(-unitE);
    // 차이가 0이면 빈칸
    if (unitDiff === 0) unitDiff = "";
  }

  return [
    status,
    s.uid || e.uid || "",
    s.vendor || e.vendor || "",
    s.date || e.date || "",
    s.code || e.code || "",
    s.item || e.item || "",
    qtyS,
    qtyE,
    amtSettle === "" ? "" : Math.round(amtSettle),
    amtE === "" ? "" : Math.round(amtE),
    unitE === "" ? "" : Math.round(unitE),
    unitDiff,
    totalDiff,
    s.recipient || e.recipient || "",
    note,
  ];
}

function _psr_writeResultTab_(tab, result) {
  tab.clear();
  var s = result.summary;
  var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var settleSum = _psr_toNumber_(s.settleSum);
  var ecountSum = _psr_toNumber_(s.ecountSum);
  var sumDiff = Math.round(settleSum - ecountSum);

  tab.getRange(1, 1, 1, _PSR_RESULT_HEADERS.length).merge()
    .setValue(
      "월마감 ↔ 이카운트 비교(검증) 결과  |  " + nowStr +
        "  |  ▶ 메뉴: 이카운트 기준 월마감 수정 (금액불일치·이카운트만)"
    )
    .setBackground("#2e7d32").setFontColor("white").setFontWeight("bold")
    .setFontSize(12)
    .setHorizontalAlignment("center");
  try { tab.setRowHeight(1, 28); } catch (eH1) {}

  tab.getRange(2, 1).setValue(
    "양쪽일치 " + s.matchOk +
      "  /  금액불일치 " + s.amtDiff +
      "  /  수량불일치 " + s.qtyDiff +
      "  /  월마감만 " + s.settleOnly +
      "  /  이카운트만 " + s.ecountOnly +
      "  /  취소반품 " + s.cancelReturn
  );
  tab.getRange(2, 1, 1, _PSR_RESULT_HEADERS.length).merge()
    .setBackground("#e8f5e9")
    .setFontWeight("bold")
    .setFontSize(14)
    .setVerticalAlignment("middle");
  try { tab.setRowHeight(2, 36); } catch (eH2) {}

  tab.getRange(3, 1).setValue(
    "월마감 합계 " + _psr_fmtNum_(settleSum) + "원" +
      "   |   이카운트 합계 " + _psr_fmtNum_(ecountSum) + "원" +
      "   |   합계차이(마감−합계) " + _psr_fmtNum_(sumDiff) + "원" +
      "   |   ※ 개별단가=합계÷수량  |  단가차이: 금액이 단가 배수 차이면 제외(수량미적용)"
  );
  tab.getRange(3, 1, 1, _PSR_RESULT_HEADERS.length).merge()
    .setBackground("#fff8e1")
    .setFontWeight("bold")
    .setFontSize(14)
    .setVerticalAlignment("middle");
  try { tab.setRowHeight(3, 42); } catch (eH3) {}

  tab.getRange(4, 1, 1, _PSR_RESULT_HEADERS.length).setValues([_PSR_RESULT_HEADERS])
    .setBackground("#37474f").setFontColor("white").setFontWeight("bold")
    .setHorizontalAlignment("center");

  if (result.rows.length > 0) {
    tab.getRange(5, 1, result.rows.length, _PSR_RESULT_HEADERS.length).setValues(result.rows);
    // 수량·금액·상품가격·차이 열 서식 (G~K, L~M)
    try {
      tab.getRange(5, 7, result.rows.length, 5).setNumberFormat("#,##0");
      tab.getRange(5, 12, result.rows.length, 2).setNumberFormat("#,##0");
    } catch (eFmt) {}
    // 상태별 배경
    var bgs = [];
    for (var i = 0; i < result.rows.length; i++) {
      var st = result.rows[i][0];
      var bg = "#ffffff";
      if (st === "양쪽일치") bg = "#e8f5e9";
      else if (st === "금액불일치") bg = "#fff3e0";
      else if (st === "수량불일치") bg = "#fce4ec";
      else if (st === "월마감만") bg = "#e3f2fd";
      else if (st === "이카운트만") bg = "#f3e5f5";
      else if (String(st).indexOf("취소반품") !== -1) bg = "#eeeeee";
      var rowBg = [];
      for (var c = 0; c < _PSR_RESULT_HEADERS.length; c++) rowBg.push(bg);
      bgs.push(rowBg);
    }
    tab.getRange(5, 1, result.rows.length, _PSR_RESULT_HEADERS.length).setBackgrounds(bgs);
  }

  tab.setFrozenRows(4);
  try {
    tab.setColumnWidth(1, 130);
    tab.setColumnWidth(2, 120);
    tab.setColumnWidth(5, 120);
    tab.setColumnWidth(6, 200);
    tab.setColumnWidth(11, 110); // 개별단가_이카
    tab.setColumnWidth(12, 90);  // 단가차이
    tab.setColumnWidth(13, 90);  // 합계차이
    tab.setColumnWidth(15, 220);
  } catch (eW) {}
}
