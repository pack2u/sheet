/**
 * [운영 도구] 트리거 관리 및 고아 트리거 정리
 * - debugTriggers: Push 트리거 정리 및 상태 확인
 * - deleteOrphanTriggers: 삭제된 함수를 참조하는 고아 트리거 탐지 및 삭제
 *
 * ★ 올팩 코드오류 진단용 함수들은 원인 해결(2026-05-29) 후 제거됨
 *   원인: Pack2U 공지팝업/Pack2U 송장매칭 프로젝트의 중복 onEdit
 */

function debugTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var log = "Triggers:\n";
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    log += fn + "\n";
    if (fn === "partnerPushOrdersToExclusiveFormsSilent_" || fn === "_PEP_PUSH_TRIGGER_FUNC") {
      ScriptApp.deleteTrigger(triggers[i]);
      log += " -> Deleted!\n";
    }
  }
  PropertiesService.getScriptProperties().setProperty("PEP_AUTO_PUSH", "OFF");
  log += "Set PEP_AUTO_PUSH to OFF.\n";
  console.log(log);
}

/**
 * ★ 존재하지 않는 함수를 참조하는 고아 트리거 탐지 및 삭제
 *
 * 삭제 대상:
 *   - runSalesStatusPasteRebuildScheduled_  (파일 삭제됨)
 *   - runOrderAutofillRepairScheduled        (파일 삭제됨)
 *   - _gmi_triggerFetchNKInvoice_            (NK Gmail 트리거 - 재설치 필요시 메뉴에서)
 *
 * 사용법: GAS 편집기에서 이 함수 선택 후 ▶ 실행
 */
function deleteOrphanTriggers() {
  // 현재 GAS 프로젝트에 실제 존재하는 함수 목록 (트리거용)
  var VALID_TRIGGER_FUNCTIONS = [
    "partnerCollectOrdersSilent_",
    "_PEP_PUSH_TRIGGER_FUNC",
    "partnerPushOrdersToExclusiveFormsSilent_",
    "_gmi_triggerFetchNKInvoice_",
    "partnerRefreshDashboardSilent_",
    "archiveHubTodayShippedOrdersTrigger_",
    "_pv_autoFillVoidedInvoices_",
    "onOpen",
    "onEdit",
  ];

  var triggers = ScriptApp.getProjectTriggers();
  var deleted = [], kept = [];

  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    var isValid = false;
    for (var j = 0; j < VALID_TRIGGER_FUNCTIONS.length; j++) {
      if (VALID_TRIGGER_FUNCTIONS[j] === fn) { isValid = true; break; }
    }
    if (!isValid) {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted.push(fn);
    } else {
      kept.push(fn);
    }
  }

  var msg = "=== 트리거 정리 결과 ===\n";
  msg += (deleted.length > 0)
    ? "삭제: " + deleted.join(", ") + "\n"
    : "삭제할 고아 트리거 없음\n";
  msg += "유지: " + (kept.length > 0 ? kept.join(", ") : "없음");
  console.log(msg);
  // ★ ui.alert 제거 — 팝업 대기로 6분 타임아웃 발생 방지
  // 결과는 GAS 편집기 실행 로그에서 확인하세요
}

/**
 * ★ 일회성: 전체 협력업체 단가조회 탭 L1:N1 잔재 정리
 * - L1([정산단가]), M1([고유ID]) 텍스트 삭제
 * - L~N열 배경/글자색 흰색 통일
 * 사용 후 이 함수는 삭제해도 됩니다.
 */
function cleanViewerLMN_OneTime() {
  var files = typeof _pt_listFiles === "function" ? _pt_listFiles(true) : [];
  var results = [];

  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var sheet = null;
      try { sheet = _pt_findViewerSheet(ss); } catch (e) {}
      if (!sheet) sheet = ss.getSheetByName("단가조회");
      if (!sheet) {
        var tabs = ss.getSheets();
        for (var t = 0; t < tabs.length; t++) {
          var tn = tabs[t].getName();
          if (tn.indexOf("단가") !== -1 || tn.indexOf("뷰어") !== -1) { sheet = tabs[t]; break; }
        }
      }
      if (!sheet) { results.push(files[i].name + ": 뷰어탭 없음"); continue; }

      // L1:N1 텍스트 삭제 + 흰색
      sheet.getRange("L1:N1").clearContent().setBackground("white").setFontColor("white");
      // L2:N2 헤더도 정리
      sheet.getRange("L2:N2").clearContent().setBackground("white").setFontColor("white");

      results.push(files[i].name.replace("[협력업체] ", "") + ": ✅");
    } catch (e) {
      results.push(files[i].name + ": ❌ " + e.message);
    }
  }

  var msg = "L~N열 정리 완료 (" + files.length + "개)\n\n" + results.join("\n");
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}
