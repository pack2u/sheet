// 접근 제어: isAdminUser_ = 이 스프레드시트의 Drive 소유자 또는 편집자.
// 스크립트 속성 ADMIN_EMAILS·하드코딩 이메일 목록은 사용하지 않음.

function getUserEmailSafe_() {
  var email = "";
  try {
    email = Session.getEffectiveUser().getEmail() || "";
  } catch (e1) {}
  if (!email) {
    try {
      email = Session.getActiveUser().getEmail() || "";
    } catch (e2) {}
  }
  return String(email || "").trim().toLowerCase();
}

function getSheetOwnerEmailSafe_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return "";
    var owner = DriveApp.getFileById(ss.getId()).getOwner();
    return String(owner && owner.getEmail ? owner.getEmail() : "")
      .trim()
      .toLowerCase();
  } catch (e) {
    return "";
  }
}

function getSheetOwnerDisplaySafe_() {
  var owner = getSheetOwnerEmailSafe_();
  if (owner) return owner;
  try {
    var msg = String(new Error().message || "").toLowerCase();
    if (msg.indexOf("shared drive") !== -1 || msg.indexOf("공유 드라이브") !== -1) {
      return "(공유드라이브: 개별 소유자 없음)";
    }
  } catch (e2) {}
  return "(확인불가)";
}

function isSheetEditorUser_(email) {
  var me = String(email || "").trim().toLowerCase();
  if (!me) return false;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return false;
    var editors = DriveApp.getFileById(ss.getId()).getEditors();
    for (var i = 0; i < editors.length; i++) {
      var one = String(editors[i] && editors[i].getEmail ? editors[i].getEmail() : "")
        .trim()
        .toLowerCase();
      if (one === me) return true;
    }
  } catch (e) {}
  return false;
}

function isAdminUser_() {
  var me = getUserEmailSafe_();
  if (!me) return false;
  var owner = getSheetOwnerEmailSafe_();
  if (owner && owner === me) return true;
  if (isSheetEditorUser_(me)) return true;
  return false;
}

function requireAdminOrAlert_(taskName) {
  // 운영 요청: 관리자 차단 비활성화
  return true;
}

// ---- 관리자 전용 메뉴 래퍼(함수명 유지) ----
function adminSetupDailyTrigger_() {
  if (!requireAdminOrAlert_("이카운트 자동연동 켜기")) return;
  setupDailyTrigger();
}
function adminRemoveDailyTrigger_() {
  if (!requireAdminOrAlert_("이카운트 자동연동 끄기")) return;
  removeDailyTrigger();
}
function adminRepairDailyTriggerHealth_() {
  if (!requireAdminOrAlert_("이카운트 자동연동 복구")) return;
  repairDailyTriggerHealth();
}
function adminSetupVendorSheetUpdateDailyTrigger_() {
  if (!requireAdminOrAlert_("배포시트 자동업데이트 켜기")) return;
  setupVendorSheetUpdateDailyTrigger();
}
function adminRemoveVendorSheetUpdateDailyTrigger_() {
  if (!requireAdminOrAlert_("배포시트 자동업데이트 끄기")) return;
  removeVendorSheetUpdateDailyTrigger();
}
function adminSetupIntegratedSalesUploadTriggers_() {
  if (!requireAdminOrAlert_("판매현황 탭 자동 갱신·레거시 정리")) return;
  setupIntegratedSalesUploadTriggers();
}
function adminInstallMonthlyArchiveShellTrigger_() {
  try { SpreadsheetApp.getUi().alert("이 기능은 독립배포 시스템 제거로 더 이상 사용하지 않습니다."); } catch(e) {}
}
function adminRemoveMonthlyArchiveShellTrigger_() {
  try { SpreadsheetApp.getUi().alert("이 기능은 독립배포 시스템 제거로 더 이상 사용하지 않습니다."); } catch(e) {}
}
function adminInstallDailyArchiveTrigger_() {
  try { SpreadsheetApp.getUi().alert("이 기능은 독립배포 시스템 제거로 더 이상 사용하지 않습니다."); } catch(e) {}
}
function adminRunPermissionBootstrap_() {
  if (!requireAdminOrAlert_("권한 일괄 승인")) return;
  runPermissionBootstrap_();
}
function adminRunUserPermissionSelfCheck_() {
  if (!requireAdminOrAlert_("사용자 권한 자가진단")) return;
  runUserPermissionSelfCheck();
}

function runPermissionBootstrap_() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var messages = [];
  try {
    messages.push("Spreadsheet OK: " + ss.getName());
  } catch (e0) {
    messages.push("Spreadsheet FAIL: " + (e0 && e0.message ? e0.message : e0));
  }
  try {
    var file = DriveApp.getFileById(ss.getId());
    messages.push("Drive(file) OK: " + file.getName());
  } catch (e1) {
    messages.push("Drive(file) FAIL: " + (e1 && e1.message ? e1.message : e1));
  }
  try {
    var folder = DriveApp.getFolderById(String(TARGET_FOLDER_ID || "").trim());
    messages.push("Drive(folder) OK: " + folder.getName());
  } catch (e2) {
    messages.push("Drive(folder) FAIL: " + (e2 && e2.message ? e2.message : e2));
  }
  try {
    ScriptApp.getProjectTriggers();
    messages.push("ScriptApp(trigger) OK");
  } catch (e3) {
    messages.push("ScriptApp(trigger) FAIL: " + (e3 && e3.message ? e3.message : e3));
  }
  try {
    var probe = UrlFetchApp.fetch("https://www.google.com", {
      method: "get",
      muteHttpExceptions: true,
    });
    messages.push("UrlFetch OK (status=" + probe.getResponseCode() + ")");
  } catch (e4) {
    messages.push("UrlFetch FAIL: " + (e4 && e4.message ? e4.message : e4));
  }
  ui.alert("권한 일괄 승인 점검 완료\n\n" + messages.join("\n"));
}
