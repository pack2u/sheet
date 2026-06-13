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
 * 삭제 대상 (과거 사례):
 *   - runSalesStatusPasteRebuildScheduled_  (파일 삭제됨)
 *   - runOrderAutofillRepairScheduled        (파일 삭제됨)
 *
 * ★ 2026-06-13 최신화:
 *   VALID_TRIGGER_FUNCTIONS 목록에서 실제 존재하지 않는 함수 3개 제거
 *   - archiveHubTodayShippedOrdersTrigger_  (정의 없음 → 제거)
 *   - _pv_autoFillVoidedInvoices_            (정의 없음 → 제거)
 *   - partnerRefreshDashboardSilent_         (정의 없음 → 제거)
 *
 * 사용법: GAS 편집기에서 이 함수 선택 후 ▶ 실행
 */
function deleteOrphanTriggers() {
  // 현재 GAS 프로젝트에 실제 존재하는 함수 목록 (트리거용)
  // ★ 2026-06-13 최신화: 실제 정의된 함수만 유지
  var VALID_TRIGGER_FUNCTIONS = [
    "partnerCollectOrdersSilent_",           // _partnerOrders.gs
    "_gmi_triggerFetchNKInvoice_",           // _partnerGmailInvoice.gs
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
