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
//  ★ Google Chat 알림 통합: 실행 시작/완료/에러 알림
// ══════════════════════════════════════════════

/**
 * 공통 래퍼: 함수 실행 + Chat 알림 (시작/완료/에러)
 * @param {string} label - 알림에 표시할 작업명
 * @param {Function} fn - 실행할 함수
 */
function _owner_runWithNotify_(label, fn) {
  var startTime = new Date();
  try {
    fn();
    var elapsed = Math.round((new Date() - startTime) / 1000);
    try {
      _chat_sendCard_("✅ " + label + " 완료",
        Utilities.formatDate(startTime, "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        [{ label: "⏱ 소요시간", value: elapsed + "초" }]
      );
    } catch (eC) {}
  } catch (e) {
    var elapsed2 = Math.round((new Date() - startTime) / 1000);
    try {
      _chat_sendCard_("❌ " + label + " 에러",
        Utilities.formatDate(startTime, "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        [
          { label: "⏱ 소요시간", value: elapsed2 + "초" },
          { label: "오류", value: String(e.message || e).substring(0, 200) },
        ]
      );
    } catch (eC2) {}
    throw e; // 원래 에러를 다시 던져서 UI에도 표시
  }
}

function partnerFetchInvoicesOwner() {
  _owner_runWithNotify_("허브 송장 수집", partnerFetchInvoices);
}
function partnerPushInvoicesOwner() {
  _owner_runWithNotify_("송장 배포", partnerPushInvoices);
}
function partnerCollectOrdersOwner() {
  _owner_runWithNotify_("발주 수집", partnerCollectOrders);
}
function partnerArchiveToMonthlySettleOwner() {
  _owner_runWithNotify_("대리판매 월별 마감", partnerArchiveToMonthlySettle);
}
// ★ archiveHubIntegratedOrdersOwner — 삭제됨 (일일마감으로 대체)
function partnerArchiveExclusiveFormOwner() {
  _owner_runWithNotify_("대리공급 마감이동", partnerArchiveExclusiveForm);
}
function partnerRebuildSalesUploadOwner() {
  _owner_runWithNotify_("판매현황 갱신", partnerRebuildSalesUploadSheetManual);
}
function partnerCheckIslandShippingOwner() {
  _owner_runWithNotify_("도서산간 추가배송비", partnerCheckIslandShipping);
}

// ── 직접 호출 메뉴 함수 래퍼 (Chat 알림 통합) ──
function partnerPushOrdersToExclusiveFormsOwner() {
  _owner_runWithNotify_("대리공급 발주 Push", partnerPushOrdersToExclusiveForms);
}
function partnerPushFromTempTabToExclusiveOwner() {
  _owner_runWithNotify_("임시기록 Push", partnerPushFromTempTabToExclusive);
}
function partnerCollectCancelsOwner() {
  _owner_runWithNotify_("취소/반품 수집", partnerCollectCancels);
}
function partnerPushCancelStatusOwner() {
  _owner_runWithNotify_("취소/반품 배포", partnerPushCancelStatus);
}
function partnerApplyVoidedInvoicesOwner() {
  _owner_runWithNotify_("폐기송장 적용", partnerApplyVoidedInvoices);
}
function partnerDailyArchiveAllOwner() {
  _owner_runWithNotify_("일괄 마감이동", partnerDailyArchiveAll);
}

/**
 * ★ 통합 일일마감 수동 실행 (메뉴에서 직접 호출)
 * 일괄 마감의 3단계만 단독 실행 + UI 알림
 */
function partnerUnifiedDailyArchiveManual() {
  var ui = SpreadsheetApp.getUi();
  try {
    var result = _pep_archiveUnifiedDaily_();
    if (result.error) {
      ui.alert("❌ 일일마감 오류: " + result.error);
      return;
    }
    ui.alert("📋 통합 일일마감 완료",
      "저장 위치: 구글드라이브 시트\n" +
      "파일명: " + (result.tabName || "(없음)") + "\n\n" +
      "로젠: " + result.detail.lozen + "건\n" +
      "대리공급: " + result.detail.temp + "건\n" +
      "합계: " + result.archived + "건",
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("❌ 일일마감 오류: " + e.message);
  }
}

// ★ 통합 실행: 월별정산 → 전용마감 → 일일마감(구글드라이브) → 초기화
// ★ 실행 순서 (v3.0 — 2026-06-12 수정):
//   1단계: 월별 정산 이동 (발주탭 → 월별마감 + 허브 UID 행 동시 삭제)
//   2단계: 전용양식 마감탭 이동
//   3단계: 통합 일일마감 (로젠+대리공급 → 구글드라이브 시트)
//   4단계: 초기화 (임시기록 정리 + 사방넷_송장매칭 + 로젠_임시기록 탭 삭제)
function partnerDailyArchiveAll() {
  var ui = null;
  var ss = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}

  // ★ 2026-06-13 추가: 단계별 Toast 진행 알림
  var _toast_ = function(msg) {
    if (ss) try { ss.toast(msg, "⏳ 일괄 마감 진행 중", 30); } catch(e) {}
  };

  _toast_("1/4 단계: 월별 정산 이동 중...");
  try {
    // 1단계: 발주 및 송장조회 → 월별 마감탭 이동 (+ 허브 UID 행 동시 삭제)
    partnerArchiveToMonthlySettle();
  } catch (e1) {
    if (ui)
      ui.alert("[단계 1 오류] 월별 정산 이동\n" + String(e1.message || e1));
    return;
  }

  _toast_("2/4 단계: 전용양식 마감 이동 중...");
  try {
    // 2단계: 전용양식 → 전용발주 마감탭 이동
    partnerArchiveExclusiveForm();
  } catch (e2) {
    if (ui)
      ui.alert("[단계 2 오류] 전용양식 마감이동\n" + String(e2.message || e2));
    return;
  }

  // ★ 3단계: 통합 일일마감 (로젠+대리공급 → 정규화 → 구글드라이브 시트)
  // 입력_로젠주문실적에서 직접 읽기
  // 반드시 초기화(4단계) 전에 실행해야 데이터를 읽을 수 있음
  _toast_("3/4 단계: 통합 일일마감 중...");
  var _unifiedResult_ = { archived: 0, tabName: "", error: "", detail: { lozen: 0, temp: 0 } };
  try {
    _unifiedResult_ = _pep_archiveUnifiedDaily_();
  } catch (e3) {
    _unifiedResult_.error = String(e3.message || e3);
    if (ui)
      ui.alert("[단계 3 오류] 통합 마감\n" + String(e3.message || e3));
  }

  // 4단계: 초기화 (임시기록 + 사방넷_송장매칭 + 로젠_임시기록 탭 삭제)
  _toast_("4/4 단계: 초기화 중...");
  var _tempClear_ = { cleared: 0, kept: 0 };
  var _lozenTabDeleted_ = false;
  try {
    var _ss_ = SpreadsheetApp.getActiveSpreadsheet();
    // ① 대리공급_임시기록 — 송장번호 없는 행은 유지
    var _tempTab_ = _po_getNonPartnerTempTab_(_ss_);
    if (_tempTab_) {
      _tempClear_ = _po_clearTempTabInvoicedRowsOnly_(_tempTab_);
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
    // ③ 로젠_임시기록 탭 삭제 (더 이상 사용하지 않음 — 일일마감이 직접 외부시트에서 읽음)
    try {
      var _lozenTempTab_ = _ss_.getSheetByName("로젠_임시기록");
      if (_lozenTempTab_) {
        _ss_.deleteSheet(_lozenTempTab_);
        _lozenTabDeleted_ = true;
        Logger.log("[DAILY_ARCHIVE] 로젠_임시기록 탭 삭제 완료");
      }
    } catch (e4c) {
      Logger.log("[DAILY_ARCHIVE] 로젠_임시기록 탭 삭제 오류 (무시): " + e4c.message);
    }
  } catch (e4) {
    if (ui)
      ui.alert("[단계 4 오류] 초기화\n" + String(e4.message || e4));
  }

  if (ui) {
    var unifiedMsg = "";
    if (_unifiedResult_.error) {
      unifiedMsg = "⚠ " + _unifiedResult_.error;
    } else {
      unifiedMsg = _unifiedResult_.archived + "건 → " + (_unifiedResult_.tabName || "(없음)") +
        " (로젠:" + _unifiedResult_.detail.lozen +
        " 대리공급:" + _unifiedResult_.detail.temp + ")";
    }
    ui.alert(
      "✅ 일괄 완료\n" +
        "1. 발주 및 송장조회 → 월별 마감탭 이동\n" +
        "2. 전용양식 → 전용발주 마감탭 이동\n" +
        "3. 통합 일일마감(구글드라이브 시트): " + unifiedMsg + "\n" +
        "4. 초기화(송장 있음 " + _tempClear_.cleared + "건 제거, 미매칭 " + _tempClear_.kept + "건 유지)" +
        (_lozenTabDeleted_ ? " + 로젠_임시기록 탭 삭제" : "") +
        " + 사방넷_송장매칭",
    );
  }
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
