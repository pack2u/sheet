/**
 * [협력업체] 직원 스크립트 권한 승인 도우미
 * 파일: _partnerWebApp.gs  (웹앱 제거 → 권한 도우미로 재활용)
 *
 * ★ 0건 문제의 실제 원인:
 *   GAS 스크립트는 파일 공유 편집자라도 OAuth 승인을 별도로 해야 함.
 *   승인하지 않은 직원이 메뉴를 클릭 → 조용히 실패 → 0건
 *
 * ★ 해결:
 *   각 직원이 "스크립트 권한 승인" 메뉴를 1회 실행하면 됨.
 */

// ══════════════════════════════════════════════
//  직원용 권한 승인 (1회만 수행하면 됨)
// ══════════════════════════════════════════════

/**
 * 직원이 최초 1회 실행하는 권한 승인 함수.
 * 실행 시 Google OAuth 동의 화면이 뜨고, 승인하면 이후 모든 기능 정상 작동.
 */
function partnerAuthorizeForStaff() {
  var ui = SpreadsheetApp.getUi();
  var currentUser = Session.getEffectiveUser().getEmail();
  var results = [];
  var failed = [];

  // ① 송장취합 시트 접근 테스트
  try {
    SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID).getName();
    results.push("✅ 송장취합 시트");
  } catch (e) {
    failed.push("❌ 송장취합 시트: " + e.message);
  }

  // ② 협력업체 파일 접근 테스트
  try {
    var files = _pt_listFiles();
    var accessOk = 0,
      accessFail = 0,
      failNames = [];
    for (var i = 0; i < files.length; i++) {
      try {
        SpreadsheetApp.openById(files[i].id).getName();
        accessOk++;
      } catch (e) {
        accessFail++;
        failNames.push(files[i].name.replace("[협력업체] ", ""));
      }
    }
    if (accessFail === 0) {
      results.push("✅ 협력업체 파일 " + accessOk + "개 전부 접근 가능");
    } else {
      failed.push(
        "❌ 협력업체 파일 " +
          accessFail +
          "개 접근 불가: " +
          failNames.join(", "),
      );
    }
  } catch (e) {
    failed.push("❌ 협력업체 목록 조회: " + e.message);
  }

  // ③ 허브 탭 접근 테스트
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hub = ss.getSheetByName("협력업체_발주허브");
    results.push(hub ? "✅ 협력업체_발주허브" : "⚠️ 협력업체_발주허브 탭 없음");
  } catch (e) {
    failed.push("❌ 허브 탭: " + e.message);
  }

  var msg = "🔐 권한 승인 결과\n실행 계정: " + currentUser + "\n\n";
  if (results.length > 0) msg += results.join("\n") + "\n";
  if (failed.length > 0) {
    msg += "\n" + failed.join("\n") + "\n\n";
    msg += "📌 위 ❌ 항목은 파일 소유자에게 해당 계정(" + currentUser + ")을\n";
    msg += "   편집자로 공유 요청하세요.";
  } else {
    msg += "\n🎉 모든 권한 정상!\n이제 모든 메뉴 기능을 사용할 수 있습니다.";
  }

  ui.alert("권한 승인 완료", msg, ui.ButtonSet.OK);
}

// ══════════════════════════════════════════════
//  Owner 래퍼 — 웹앱 없이 직접 실행 (단순 포워딩)
//  메뉴에서 *Owner 함수를 호출하면 원래 함수 직접 실행
// ══════════════════════════════════════════════
function partnerFetchInvoicesOwner() {
  partnerFetchInvoices();
}
function partnerPushInvoicesOwner() {
  partnerPushInvoices();
}
function partnerCollectOrdersOwner() {
  partnerCollectOrders();
}
function partnerArchiveToMonthlySettleOwner() {
  partnerArchiveToMonthlySettle();
}
function archiveHubIntegratedOrdersOwner() {
  archiveHubIntegratedOrders();
}
function partnerArchiveExclusiveFormOwner() {
  partnerArchiveExclusiveForm();
}
function partnerRebuildSalesUploadOwner() {
  partnerRebuildSalesUploadSheetManual();
}

// ★ 통합 실행: 월별정산 → 전용마감 → 허브아카이브 → 임시탭 초기화
// ★ 실행 순서 주의 (v2.0 — 2026-05-19 수정):
//   1단계: 월별 정산 이동 (발주탭 → 월별마감 + 허브 UID 행 동시 삭제)
//   2단계: 전용양식 마감탭 이동
//   3단계: 허브 잔여 완료건 아카이브 (1단계에서 UID 정리 완료된 후 실행해야 정확)
//   4단계: 임시탭 초기화
// ★ 왜 이 순서인가?
//   - 월별정산(_pms_core_)이 발주탭을 마감으로 이동하면서 허브의 해당 UID 행도 삭제함
//   - 허브아카이브를 먼저 실행하면 허브 행이 이미 사라져서 월별정산의 UID 정리가 실패함
//   - 따라서 월별정산 → 허브아카이브 순서가 올바름
function partnerDailyArchiveAll() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  try {
    // 1단계: 발주 및 송장조회 → 월별 마감탭 이동 (+ 허브 UID 행 동시 삭제)
    partnerArchiveToMonthlySettle();
  } catch (e1) {
    if (ui)
      ui.alert("[단계 1 오류] 월별 정산 이동\n" + String(e1.message || e1));
    return;
  }
  try {
    // 2단계: 전용양식 → 전용발주 마감탭 이동
    partnerArchiveExclusiveForm();
  } catch (e2) {
    if (ui)
      ui.alert("[단계 2 오류] 전용양식 마감이동\n" + String(e2.message || e2));
    return;
  }
  try {
    // 3단계: 허브 잔여 완료건 아카이브 (1단계 UID 정리 완료 후 실행)
    archiveHubIntegratedOrders();
  } catch (e3) {
    if (ui)
      ui.alert("[단계 3 오류] 허브 아카이브\n" + String(e3.message || e3));
    return;
  }
  try {
    // 4단계: 대리발송_임시기록 탭 + 사방넷_송장매칭 탭 데이터 초기화
    var _ss_ = SpreadsheetApp.getActiveSpreadsheet();
    // ① 대리발송_임시기록 (현재 시트)
    var _tempTab_ = _ss_.getSheetByName("대리발송_임시기록");
    if (_tempTab_ && _tempTab_.getLastRow() >= 2) {
      _tempTab_
        .getRange(2, 1, _tempTab_.getLastRow() - 1, _tempTab_.getLastColumn())
        .clearContent();
    }
    // ② 사방넷_송장매칭 (대리발송 외부 시트)
    try {
      var _srcSS_ = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
      var _unmatchedTab_ = _srcSS_.getSheetByName("사방넷_송장매칭");
      if (_unmatchedTab_ && _unmatchedTab_.getLastRow() >= 2) {
        _unmatchedTab_
          .getRange(
            2,
            1,
            _unmatchedTab_.getLastRow() - 1,
            _unmatchedTab_.getLastColumn(),
          )
          .clearContent();
      }
    } catch (e4b) {
      // 탭이 없거나 시트 접근 실패 시 무시
    }
  } catch (e4) {
    if (ui)
      ui.alert("[단계 4 오류] 임시탭 초기화\n" + String(e4.message || e4));
    return;
  }
  if (ui)
    ui.alert(
      "✅ 일괄 완료\n1. 발주 및 송장조회 → 월별 마감탭 이동\n2. 전용양식 → 전용발주 마감탭 이동\n3. 허브 잔여 완료건 아카이브\n4. 대리발송_임시기록 + 사방넷_송장매칭 초기화",
    );
}

// ══════════════════════════════════════════════
//  (더미) — 메뉴에서 참조하는 함수명 유지용
// ══════════════════════════════════════════════
function partnerSetWebAppUrl() {
  SpreadsheetApp.getUi().alert(
    "ℹ️ 웹앱 방식을 사용하지 않습니다.\n\n" +
      "직원 권한 문제는 '스크립트 권한 승인' 메뉴를 각자 1회 실행하면 해결됩니다.",
  );
}
function partnerCheckWebAppStatus() {
  SpreadsheetApp.getUi().alert(
    "ℹ️ 웹앱을 사용하지 않는 설정입니다.\n'스크립트 권한 승인'을 대신 사용하세요.",
  );
}
