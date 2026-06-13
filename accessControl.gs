// 접근 제어 헬퍼 (편집 권한자라면 모든 기능 사용 가능 — 관리자 차단 없음)

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