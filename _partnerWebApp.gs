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
  _owner_runWithNotify_("발주 수집", function() {
    partnerCollectOrders();
    // ★ 2026-07-08: 발주수집 후 자동 중복 감지
    _oa_autoCheckDuplicates_("발주탭");
  });
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
  _owner_runWithNotify_("대리공급 발주 Push", function() {
    partnerPushOrdersToExclusiveForms();
    // ★ 2026-07-08: Push 후 자동 중복 감지
    _oa_autoCheckDuplicates_("전용양식");
  });
}
function partnerPushFromTempTabToExclusiveOwner() {
  _owner_runWithNotify_("임시기록 Push", function() {
    partnerPushFromTempTabToExclusive();
    // ★ 2026-07-08: Push 후 자동 중복 감지
    _oa_autoCheckDuplicates_("전용양식");
  });
}
// ★ 2026-07-06: 임시기록 강제 재생성 (버그 복구용)
function partnerRebuildTempRecordsOwner() {
  _owner_runWithNotify_("임시기록 재생성", partnerRebuildTempRecords);
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
    // ★ 2026-06-25: 스냅샷+송장매칭 단일 포맷 알림
    ui.alert("📋 통합 일일마감 완료",
      "저장 위치: 구글드라이브 시트\n" +
      "파일명: " + (result.tabName || "(없음)") + "\n\n" +
      "매칭 기록: " + result.archived + "건\n" +
      " └ 로젠 송장: " + (result.detail.lozen || 0) + "건\n" +
      " └ 대리공급 송장: " + (result.detail.supply || 0) + "건\n" +
      "미매칭(다음날 재시도): " + (result.detail.noInvoice || 0) + "건",
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("❌ 일일마감 오류: " + e.message);
  }
}

/**
 * ★ 2026-06-23: 단가맵 제거됨 — 세트분리 시트 판매현황 직접 읽기로 전환
 * 이 함수는 하위호환을 위해 유지 (메뉴 호출 시 안내 표시)
 */
function partnerCollectPriceMapManual() {
  SpreadsheetApp.getUi().alert(
    "ℹ️ 안내",
    "판매현황_단가맵이 제거되었습니다.\n\n" +
    "일일마감 시 세트분리 시트의 판매현황 탭을\n" +
    "직접 읽어서 단가를 매칭합니다.\n\n" +
    "별도 수집이 필요하지 않습니다.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ★ 2026-06-20: 매칭 진단 — 단가맵 vs 로젠 키 비교 출력
function partnerDiagnosePriceMatch() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var lines = [];

    // ── 1) 단가맵 읽기 (처음 5건) ──
    var mapTab = ss.getSheetByName("판매현황_단가맵");
    if (!mapTab || mapTab.getLastRow() < 2) {
      ui.alert("⚠️ 판매현황_단가맵 탭이 없거나 비어있습니다.\n먼저 수동 수집을 실행해주세요.");
      return;
    }
    var mapCols = Math.max(mapTab.getLastColumn(), 8);
    var mapData = mapTab.getRange(2, 1, Math.min(5, mapTab.getLastRow() - 1), mapCols).getValues();

    lines.push("═══ 단가맵 (처음 " + mapData.length + "건) ═══");
    for (var mi = 0; mi < mapData.length; mi++) {
      var mPhone = String(mapData[mi][4] || "").replace(/[^0-9]/g, "");
      var mPhone7 = mPhone.substring(0, 7);
      var mItemName = mapCols > 6 ? String(mapData[mi][6] || "").trim() : "";
      var mRecip = String(mapData[mi][3] || "").trim();
      var mPrice = mapData[mi][2];
      lines.push("[" + (mi + 1) + "] phone7=" + mPhone7 +
        " | 품목명=" + String(mItemName).substring(0, 20) +
        " | 수취인=" + mRecip +
        " | 단가=" + mPrice +
        " → PH7키=[PH7:" + mPhone7 + "|" + String(mItemName).substring(0, 20) + "]");
    }

    // ── 2) 로젠(입력_로젠주문실적) 읽기 (처음 5건) ──
    lines.push("");
    lines.push("═══ 로젠 입력_로젠주문실적 (처음 5건) ═══");
    try {
      var invSs = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
      var lTab = null;
      var lSheets = invSs.getSheets();
      for (var si = 0; si < lSheets.length; si++) {
        if (lSheets[si].getName().indexOf("로젠주문실적") !== -1 ||
            lSheets[si].getName().indexOf("로젠") !== -1) {
          lTab = lSheets[si];
          break;
        }
      }
      if (!lTab) {
        // GID로 직접 접근
        try { lTab = invSs.getSheetByName("입력_로젠주문실적"); } catch(e2) {}
      }
      if (lTab && lTab.getLastRow() >= 2) {
        var lCols = Math.max(lTab.getLastColumn(), 30);
        var lData = lTab.getRange(2, 1, Math.min(5, lTab.getLastRow() - 1), lCols).getValues();
        // 헤더도 표시
        var lHeaders = lTab.getRange(1, 1, 1, lCols).getValues()[0];
        var hList = [];
        for (var hhi = 0; hhi < lHeaders.length; hhi++) {
          var hv = String(lHeaders[hhi] || "").trim();
          if (hv) hList.push((hhi + 1) + ":" + hv);
        }
        lines.push("헤더: " + hList.slice(0, 20).join(", "));
        lines.push("");

        for (var li = 0; li < lData.length; li++) {
          var row = lData[li];
          var lOrdNo = String(row[4] || "").trim();    // E열
          var lInvNo = String(row[5] || "").trim();    // F열
          var lRecip = String(row[9] || "").trim();    // J열
          var lItemName = String(row[10] || "").trim(); // K열
          var lPhoneM = String(row[12] || "");          // M열
          var lPhoneN = String(row[13] || "");          // N열
          var lPhoneRaw = (lPhoneM || lPhoneN);
          var lPhone7 = lPhoneRaw.replace(/[^0-9]/g, "").substring(0, 7);
          var lItemCode = String(row[21] || "").trim(); // V열

          lines.push("[" + (li + 1) + "] 주문번호=" + lOrdNo +
            " | 운송장=" + lInvNo +
            " | 수취인=" + lRecip +
            " | phone_raw=" + lPhoneRaw.substring(0, 15) +
            " | phone7=" + lPhone7 +
            " | 품목명=" + String(lItemName).substring(0, 20) +
            " | 품목코드=" + lItemCode +
            " → PH7키=[PH7:" + lPhone7 + "|" + String(lItemName).substring(0, 20) + "]");
        }
      } else {
        lines.push("⚠️ 로젠 탭 없음 또는 데이터 없음. 탭 목록: " +
          lSheets.map(function(s) { return s.getName(); }).join(", "));
      }
    } catch (eInv) {
      lines.push("❌ 송장시트 접근 오류: " + eInv.message);
    }

    // ── 3) 매칭 테스트 (단가맵 → priceMap → 로젠 5건 조회) ──
    lines.push("");
    lines.push("═══ 매칭 테스트 ═══");
    var priceMap = _buildSalesPriceMap_();
    lines.push("priceMap 총 키 수: " + Object.keys(priceMap).length);
    var pmSample = Object.keys(priceMap).slice(0, 5);
    lines.push("priceMap 키 샘플: " + pmSample.join(" | "));

    ui.alert("🔍 매칭 진단 결과", lines.join("\n"), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("❌ 진단 오류: " + e.message + "\n" + e.stack);
  }
}
/**
 * ★ 통합 일일마감 — 매일 20시 자동 실행 (트리거 핸들러)
 * 가드 조건:
 *   1) 이미 해당 날짜 마감 시트가 존재하면 스킵 (중복 방지)
 *   2) 주말(토/일)이면 데이터 유무를 먼저 확인 → 없으면 스킵
 *   3) 최근 7일간 미생성 마감을 소급 확인 → 데이터 있으면 오늘 날짜로 통합 생성
 */
function _pep_unifiedDailyArchiveScheduled_() {
  // ★ 2026-06-27: 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → 통합 일일마감 스킵"); return; }
  try {
    var now = new Date();
    // ★ 2026-07-01: 당일 23:30 실행 → 당일 날짜 그대로 사용 (yesterday 계산 불필요)
    var todayStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd");

    // ── ① 이미 당일 마감 시트가 존재하면 스킵 ──
    var archFileName = "일일마감_(" + todayStr + ")";
    var todayExists = false;
    try {
      var existing = _unified_findExistingArchiveSs_(archFileName);
      if (existing) {
        var existTab = existing.getSheetByName("일일마감") || existing.getSheets()[0];
        if (existTab && existTab.getLastRow() >= 2) {
          todayExists = true;
        }
      }
    } catch (eExist) {}

    // ── ② 최근 7일 미생성 마감 소급 확인 ──
    var missedDays = [];
    for (var d = 1; d <= 7; d++) {
      var pastDate = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      var pastStr = Utilities.formatDate(pastDate, "Asia/Seoul", "yyyy-MM-dd");
      var pastDay = pastDate.getDay();

      // 주말은 미생성이 정상
      if (pastDay === 0 || pastDay === 6) continue;

      var pastFileName = "일일마감_(" + pastStr + ")";
      try {
        var pastExist = _unified_findExistingArchiveSs_(pastFileName);
        if (!pastExist) {
          missedDays.push(pastStr);
        }
      } catch (ePast) {}
    }

    if (missedDays.length > 0) {
      Logger.log("[SCHEDULED] 최근 7일 미생성 마감: " + missedDays.join(", "));
    }

    // ── ③ 당일 이미 있고 미생성 과거도 없으면 → 완전 스킵 ──
    if (todayExists && missedDays.length === 0) {
      Logger.log("[SCHEDULED] 당일(" + todayStr + ") 마감 존재 + 미생성 없음 → 스킵");
      return;
    }

    // ── ④ 마감 실행 (당일 날짜 전달) ──
    if (todayExists) {
      Logger.log("[SCHEDULED] 당일(" + todayStr + ") 마감 이미 존재하나 미생성 과거(" +
        missedDays.join(", ") + ") 있음 → 데이터 추가 아카이브");
    }

    var result = _pep_archiveUnifiedDaily_(todayStr);
    // ★ 2026-06-25: 스냅샷+송장매칭 단일 포맷 로그
    // ★ 2026-06-29: 로젠(전화) 건수 추가
    var logMsg = "[SCHEDULED] 통합 일일마감 완료: " +
      result.archived + "건 (로젠:" + (result.detail.lozen || 0) +
      " 로젠(전화):" + (result.detail.lozenPhone || 0) +
      " 대리공급:" + (result.detail.supply || 0) +
      " 미매칭:" + (result.detail.noInvoice || 0) + ")";
    if (missedDays.length > 0) {
      logMsg += " ※ 미생성 과거: " + missedDays.join(", ");
    }
    Logger.log(logMsg);

    // ★ 2026-06-25: Google Chat 알림 — 매칭 기반
    // ★ 2026-06-29: 로젠(전화) 건수 추가
    try {
      var kvItems = [
        { label: "📊 매칭 기록", value: result.archived + "건" },
        { label: "🚚 로젠 송장", value: (result.detail.lozen || 0) + "건" },
        { label: "📞 로젠(전화)", value: (result.detail.lozenPhone || 0) + "건" },
        { label: "🏭 대리공급 송장", value: (result.detail.supply || 0) + "건" },
        { label: "⏳ 미매칭", value: (result.detail.noInvoice || 0) + "건" },
      ];
      if (result.error) {
        kvItems.push({ label: "⚠ 오류", value: String(result.error).substring(0, 200) });
      }
      if (missedDays.length > 0) {
        kvItems.push({ label: "⏰ 미생성 과거", value: missedDays.join(", ") });
      }
      _chat_sendCard_("📊 통합 일일마감 완료",
        Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), kvItems);
    } catch (_) {}

    if (result.error) {
      Logger.log("[SCHEDULED] 일일마감 오류: " + result.error);
    }
  } catch (e) {
    Logger.log("[SCHEDULED] 통합 일일마감 자동 실행 실패: " + e.message);
    // ★ 2026-06-24: 실패 시 Chat 알림
    try { _chat_sendCard_("❌ 통합 일일마감 실패", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

/**
 * ★ 당일 마감 대상 데이터 존재 여부 확인 (주말 스킵 판단용)
 * 로젠 + 대리공급 임시기록에 데이터가 1건이라도 있으면 true
 * @return {boolean}
 */
function _pep_checkDailyDataExists_() {
  try {
    // ① 로젠: 입력_로젠주문실적 데이터 확인
    try {
      var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
      var lozenTab = _pt_getSheetByGid(invSS, _PT_PRIMARY_INVOICE_GID);
      if (lozenTab && lozenTab.getLastRow() >= 2) return true;
    } catch (eL) {}

    // ② 대리공급 임시기록 (송장번호 있는 행)
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var tempTab = _po_getNonPartnerTempTab_(ss);
      if (tempTab && tempTab.getLastRow() >= 2) {
        var tData = tempTab.getRange(2, _PO_TEMP_INV_COL_ + 1, tempTab.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < tData.length; i++) {
          if (String(tData[i][0] || "").trim()) return true; // 송장번호 있는 행 발견
        }
      }
    } catch (eT) {}

    return false;
  } catch (e) {
    Logger.log("[SCHEDULED] 데이터 존재 확인 오류: " + e.message);
    return false; // 확인 실패 시 안전하게 스킵
  }
}

/** ★ 통합 일일마감 트리거 설치 (매일 23:30) */
function setupUnifiedDailyArchiveTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "_pep_unifiedDailyArchiveScheduled_") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("_pep_unifiedDailyArchiveScheduled_")
    .timeBased().everyDays(1).atHour(23).nearMinute(30).create();
  try {
    SpreadsheetApp.getUi().alert("✅ 통합 일일마감 트리거 설치 완료 (매일 23:30)");
  } catch (e) { Logger.log("[TRIGGER] 트리거 설치 완료"); }
}

/** ★ 통합 일일마감 트리거 제거 */
function removeUnifiedDailyArchiveTrigger() {
  var removed = 0;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "_pep_unifiedDailyArchiveScheduled_") {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  try {
    SpreadsheetApp.getUi().alert("✅ 통합 일일마감 트리거 " + removed + "개 제거됨");
  } catch (e) { Logger.log("[TRIGGER] 트리거 " + removed + "개 제거됨"); }
}

// ★ 통합 실행: 월별정산 + 전용마감 → 초기화
// ★ v4.1 (2026-06-19): 통합 일일마감을 별도 20시 트리거로 분리
//   1+2단계: 단일 루프에서 월별정산 + 전용마감 동시 처리
//   3단계: 초기화 (임시기록 정리 + 사방넷_송장매칭 + 로젠_임시기록 탭 삭제)
//   ★ 통합 일일마감은 _pep_unifiedDailyArchiveScheduled_ (23:30 자동 트리거)
function partnerDailyArchiveAll() {
  var ui = null;
  var ss = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}

  // ★ 최초 확인 팝업 (1회)
  if (ui) {
    var cf = ui.alert(
      "🔄 일괄 마감 시작",
      "다음 작업을 순차적으로 실행합니다:\n\n" +
      "1️⃣ 월별 정산 이동 (발주탭 → 마감탭)\n" +
      "2️⃣ 전용양식 마감 이동\n" +
      "3️⃣ 초기화 (임시기록 정리)\n\n" +
      "※ 통합 일일마감은 20시 자동 실행됩니다.\n" +
      "⚠ 송장 수집을 먼저 실행한 뒤 진행하세요.\n" +
      "계속할까요?",
      ui.ButtonSet.YES_NO
    );
    if (cf !== ui.Button.YES) return;
  }
  var _startMs_ = new Date().getTime();
  var MAX_EXEC_MS = 5 * 60 * 1000; // ★ 5분 안전 제한 (6분 GAS 제한 대비 1분 여유)
  var _steps_ = [
    { label: "월별정산 + 전용마감 (통합)", status: "ok", count: "" },
    { label: "허브 정리", status: "ok", count: "" },
    { label: "초기화", status: "ok", count: "" }
  ];
  var _warnings_ = [];

  var _toast_ = function(msg) {
    if (ss) try { ss.toast(msg, "⏳ 일괄 마감 진행 중", 30); } catch(e) {}
  };

  // ══════════════════════════════════════════════
  //  1+2단계: 통합 파일 루프 (월별정산 + 전용마감 동시)
  // ══════════════════════════════════════════════
  _toast_("1/3 단계: 월별정산 + 전용마감 통합 처리 중...");

  var files = _pt_listFiles();
  var todayStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  var todayNum = parseInt(todayStr, 10);
  var _pms_archivedUids_ = {};
  var pmsArchived = 0, peaArchived = 0, peaKept = 0;
  var failedFiles = 0, errMsgs = [];
  var skippedByTimeout = 0;

  // 전용마감 탭명 계산
  var now = new Date();
  var peaTabName = "(" + Utilities.formatDate(now, "Asia/Seoul", "yyyy") +
    "년 " + parseInt(Utilities.formatDate(now, "Asia/Seoul", "M"), 10) +
    "월) " + _PEA_TAB_SUFFIX;

  try {
    for (var fi = 0; fi < files.length; fi++) {
      // ★ 경과 시간 안전 체크
      if (Date.now() - _startMs_ > MAX_EXEC_MS) {
        skippedByTimeout = files.length - fi;
        _warnings_.push("⏰ 시간 제한으로 " + skippedByTimeout + "개 업체 미처리");
        break;
      }

      try {
        var fileSS = SpreadsheetApp.openById(files[fi].id); // ★ 1번만 열기!

        // ── 1단계: 월별정산 (발주탭 → 마감탭) ──
        try {
          var pmsRes = _pms_processOneFile_(fileSS, todayNum, _pms_archivedUids_);
          pmsArchived += pmsRes.archived;
        } catch (ePms) {
          errMsgs.push("[월별정산/" + files[fi].name + "] " + ePms.message);
        }

        // ── 2단계: 전용마감 (전용양식 → 전용발주 마감탭) ──
        try {
          var peaRes = _pea_processOneFile_(fileSS, peaTabName);
          peaArchived += peaRes.moved;
          peaKept += peaRes.kept;
        } catch (ePea) {
          errMsgs.push("[전용마감/" + files[fi].name + "] " + ePea.message);
        }

        // ── 취소/반품 수식 갱신 (새 마감탭 생성 시에만) ──
        // ★ 같은 달 내 반복 마감은 기존 탭에 추가만 하므로 수식 갱신 불필요
        try {
          if (pmsRes.newTabCreated) {
            var crTab = fileSS.getSheetByName(_CR_TAB_NAME);
            if (crTab) _cr_applyFormulas_(crTab);
          }
        } catch (eCr) {}

      } catch (eFile) {
        errMsgs.push("[" + files[fi].name + "] " + eFile.message);
        failedFiles++;
      }
    }

    _steps_[0].count = "월별:" + pmsArchived + "건, 전용:" + peaArchived + "건" +
      (peaKept > 0 ? " (잔류:" + peaKept + ")" : "") +
      (skippedByTimeout > 0 ? " ⏰" + skippedByTimeout + "개 미처리" : "");
  } catch (e1) {
    _steps_[0].status = "err";
    _steps_[0].count = String(e1.message || e1).substring(0, 60);
  }

  // ── 허브 정리 (이동된 UID 행 삭제) ──
  _toast_("2/3 단계: 허브 정리 중...");
  try {
    _pms_cleanupHub_(_pms_archivedUids_, pmsArchived, errMsgs);
    _steps_[1].count = "UID " + Object.keys(_pms_archivedUids_).length + "건 정리";
  } catch (e1b) {
    _steps_[1].status = "err";
    _steps_[1].count = String(e1b.message || e1b).substring(0, 60);
  }

  // ── 전용마감 UID 초기화 (소스 탭) ──
  try {
    var srcSS  = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
    var srcTab = null;
    var srcSheets = srcSS.getSheets();
    for (var si = 0; si < srcSheets.length; si++) {
      if (srcSheets[si].getSheetId() === _PEP_SOURCE_TAB_GID) { srcTab = srcSheets[si]; break; }
    }
    if (!srcTab) srcTab = srcSS.getSheetByName(_pep_getSourceTabName_());
    if (srcTab && srcTab.getLastRow() >= 2) {
      var hdr = srcTab.getRange(1, 1, 1, srcTab.getLastColumn()).getValues()[0];
      var uidCol = -1;
      for (var hi = 0; hi < hdr.length; hi++) {
        var hn = String(hdr[hi] || "").replace(/\s/g, "").toLowerCase();
        if (hn === "협력push" || hn === "pep_uid") { uidCol = hi; break; }
      }
      if (uidCol !== -1) {
        var srcLr    = srcTab.getLastRow();
        var uidVals  = srcTab.getRange(2, uidCol + 1, srcLr - 1, 1).getValues();
        var blankArr = uidVals.map(function(r) {
          return (String(r[0] || "").trim()) ? [""] : r;
        });
        srcTab.getRange(2, uidCol + 1, srcLr - 1, 1).setValues(blankArr);
        SpreadsheetApp.flush();
      }
    }
  } catch (eUid) {
    errMsgs.push("[UID초기화] " + eUid.message);
  }

  // ★ Google Chat 알림 (전용마감)
  try { _chat_notifyArchive_(peaArchived, peaKept, 0, 0); } catch (eChat) {}

  // ★ 2026-06-19: 통합 일일마감은 23:30 자동 트리거로 분리 (여기서 실행하지 않음)

  // ══════════════════════════════════════════════
  //  3단계: 초기화
  // ══════════════════════════════════════════════
  _toast_("3/3 단계: 초기화 중...");
  var _tempClear_ = { cleared: 0, kept: 0 };
  var _lozenTabDeleted_ = false;
  try {
    // ★ 2026-07-06: 임시기록은 상품정보 시트 (_PT.INFO_SS_ID)
    var _ss_ = SpreadsheetApp.openById(_PT.INFO_SS_ID);
    var _tempTab_ = _po_getNonPartnerTempTab_(_ss_);
    if (_tempTab_) {
      _tempClear_ = _po_clearTempTabInvoicedRowsOnly_(_tempTab_);
    }
    try {
      var _srcSS_ = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
      var _unmatchedTab_ = _srcSS_.getSheetByName("사방넷_송장매칭");
      if (_unmatchedTab_ && _unmatchedTab_.getLastRow() >= 2) {
        _unmatchedTab_
          .getRange(2, 1, _unmatchedTab_.getLastRow() - 1, _unmatchedTab_.getLastColumn())
          .clearContent();
      }
    } catch (e4b) {}
    try {
      var _lozenTempTab_ = _ss_.getSheetByName("로젠_임시기록");
      if (_lozenTempTab_) {
        _ss_.deleteSheet(_lozenTempTab_);
        _lozenTabDeleted_ = true;
      }
    } catch (e4c) {}
  } catch (e4) {
    if (ui) ui.alert("[단계 4 오류] 초기화\n" + String(e4.message || e4));
  }

  // ★ 단계별 결과 수집
  _steps_[2].count = "삭제 " + _tempClear_.cleared + "건, 유지 " + _tempClear_.kept + "건";

  if (_tempClear_.kept > 0) _warnings_.push("미매칭 " + _tempClear_.kept + "건 유지 (송장 미입력)");
  if (failedFiles > 0) _warnings_.push("파일 오류 " + failedFiles + "건");

  var _elapsedSec_ = Math.round((new Date().getTime() - _startMs_) / 1000);
  var _hasError_ = _steps_.some(function(s) { return s.status === "err"; });

  if (ui) {
    try {
      var _resultData_ = {
        title: _hasError_ ? "일괄 마감 (일부 오류)" : "일괄 마감 완료",
        icon: _hasError_ ? "⚠️" : "✅",
        success: !_hasError_,
        elapsed: _elapsedSec_,
        steps: _steps_,
        warnings: _warnings_,
        detail: "임시기록: 삭제 " + _tempClear_.cleared + "건, 유지 " + _tempClear_.kept + "건" +
          (_lozenTabDeleted_ ? "\n로젠_임시기록 탭 삭제 완료" : "") +
          "\n사방넷_송장매칭 초기화 완료" +
          "\n\n※ 통합 일일마감은 20시 자동 실행"
      };
      var _html_ = HtmlService.createHtmlOutputFromFile("resultModal")
        .setWidth(420).setHeight(480);
      _html_.setTitle("일괄 마감 결과");
      var _script_ = "<script>renderResult(" + JSON.stringify(_resultData_) + ");</script>";
      _html_.append(_script_);
      ui.showModalDialog(_html_, "일괄 마감 결과");
    } catch (eModal) {
      ui.alert(
        (_hasError_ ? "⚠️" : "✅") + " 일괄 마감 (" + _elapsedSec_ + "초)\n" +
        _steps_.map(function(s, i) {
          return (i + 1) + ". " + s.label + ": " + (s.status === "ok" ? "✅" : "❌") + " " + s.count;
        }).join("\n")
      );
    }
  }
}

// ══════════════════════════════════════════════
//  (더미) — 메뉴에서 참조하는 함수명 유지용
// ══════════════════════════════════════════════
function partnerSetWebAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var current = PropertiesService.getScriptProperties().getProperty("INVOICE_MATCH_WEB_APP_URL") || "(미설정)";
  var resp = ui.prompt(
    "📬 송장 매칭 Web App URL 설정",
    "현재: " + current + "\n\n웹앱 배포 후 URL을 붙여넣으세요:",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var url = String(resp.getResponseText() || "").trim();
  if (!url) return;
  PropertiesService.getScriptProperties().setProperty("INVOICE_MATCH_WEB_APP_URL", url);
  ui.alert("✅ 저장 완료\n\n" + url);
}

function partnerCheckWebAppStatus() {
  var url = PropertiesService.getScriptProperties().getProperty("INVOICE_MATCH_WEB_APP_URL") || "";
  SpreadsheetApp.getUi().alert(
    "📬 송장 매칭 Web App 상태\n\n" +
    (url ? "✅ URL: " + url : "❌ URL 미설정 — '웹앱 URL 설정' 메뉴를 실행하세요.")
  );
}

// ═══════════════════════════════════════════════════════════════
//  ★ 2026-06-22: 송장 매칭 Web App (doPost)
//  사이드바 → fetch(POST) → 이 함수 → openById() → 매칭/반영
//  ▶ 배포: "나(소유자)로 실행" + "모든 사용자 접근"
//  ▶ google.script.run 불필요 → 권한 승인/세션 충돌 문제 해결
// ═══════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var action = String(req.action || "");
    var ssId = String(req.spreadsheetId || "");

    // list 액션이 아닌 경우에만 spreadsheetId 보안 유효성 검사 수행
    if (action !== "list") {
      if (!ssId) return _imJsonResp_({ error: "spreadsheetId 누락" });
      if (!_imIsValidVendorSheet_(ssId)) {
        return _imJsonResp_({ error: "유효하지 않은 시트입니다." });
      }
    }

    switch (action) {
      case "list":
        return _imJsonResp_(_imGetPartnerFileList_());
      case "analyze":
        return _imJsonResp_(_imParseAndMatch_(ssId, String(req.text || "")));
      case "apply":
        return _imJsonResp_(_imApplyMatches_(ssId, req.matches));
      default:
        return _imJsonResp_({ error: "알 수 없는 액션: " + action });
    }
  } catch (err) {
    return _imJsonResp_({ error: "서버 오류: " + err.message });
  }
}

// ── JSON 응답 헬퍼 ──
function _imJsonResp_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ★ 2026-06-23: 소유자 권한으로 업체 파일 목록을 에러 없이 즉시 반환하는 웹앱 헬퍼
 */
function _imGetPartnerFileList_() {
  try {
    var files = _pt_listFiles();
    var prefixToFile = _pep_buildPrefixToFileMap_(files);
    var result = [];
    for (var pfx in prefixToFile) {
      var f = prefixToFile[pfx];
      result.push({
        id: f.id,
        pfx: pfx,
        name: f.name.replace("[협력업체] ", ""),
      });
    }
    result.sort(function (a, b) {
      return a.pfx.localeCompare(b.pfx);
    });
    return result;
  } catch (e) {
    return { error: "목록 로드 오류: " + e.message };
  }
}

// ── 보안: 허브 폴더 내 협력업체 파일인지 확인 ──
function _imIsValidVendorSheet_(ssId) {
  try {
    var file = DriveApp.getFileById(ssId);
    var parents = file.getParents();
    while (parents.hasNext()) {
      var folderId = parents.next().getId();
      if (folderId === _PT.FOLDER_ID || folderId === _PT.FOLDER_ID2) return true;
    }
    // 폴더 확인 실패 시 이름으로 확인 (백업)
    return file.getName().indexOf("[협력업체]") !== -1;
  } catch (e) {
    return false;
  }
}

// ── Web App URL 반환 (독립 스크립트 배포 — ★ 2026-06-23: 실제 활성 배포 ID로 수정) ──
function _getWebAppUrl_() {
  return "https://script.google.com/macros/s/AKfycbzTRCZpioVmlgC_Mfji-UeTBVuAA6yiku5-cX4n/exec";
}

// ═══════════════════════════════════════════════════════════════
//  Web App 서버 함수: 분석 (parseAndMatchInvoiceTextLocal과 동일 로직)
// ═══════════════════════════════════════════════════════════════
function _imParseAndMatch_(ssId, rawText, preParsedPairs) {
  try {
    var ss = SpreadsheetApp.openById(ssId);

    // 전용양식 탭 탐색
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) {
        exTab = tabs[ti];
        break;
      }
    }
    if (!exTab) return { error: "전용양식 탭 없음" };

    var lr = exTab.getLastRow();
    if (lr < 2) return { error: "전용양식 데이터 없음" };
    var lc = Math.max(exTab.getLastColumn(), 1);
    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];

    // 수취인 열 자동 탐지
    var KEYWORDS = ["받는분","받는사람","수령인","고객명","받으시는","수하인","수취인","수취주","수화주"];
    var EXCLUDE_KW = ["보내는","송하인","발화주","발신"];
    var recipientCol = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      var h = String(headers[hi] || "").replace(/\s/g, "");
      var excluded = false;
      for (var ei = 0; ei < EXCLUDE_KW.length; ei++) {
        if (h.indexOf(EXCLUDE_KW[ei]) !== -1) { excluded = true; break; }
      }
      if (excluded) continue;
      for (var ki = 0; ki < KEYWORDS.length; ki++) {
        if (h.indexOf(KEYWORDS[ki]) !== -1) { recipientCol = hi; break; }
      }
      if (recipientCol !== -1) break;
    }
    if (recipientCol === -1) return { error: "수취인 열 없음. 헤더: " + headers.slice(0, 8).join(", ") };

    // 상품명 열 자동 탐지
    var PRODUCT_KW = ["상품명","품목명","품명","제품명","상품","item","product"];
    var productCol = -1;
    for (var phi = 0; phi < headers.length; phi++) {
      var ph = String(headers[phi] || "").replace(/\s/g, "").toLowerCase();
      for (var pki = 0; pki < PRODUCT_KW.length; pki++) {
        if (ph.indexOf(PRODUCT_KW[pki]) !== -1) { productCol = phi; break; }
      }
      if (productCol !== -1) break;
    }

    // ★ 수량 열 자동 탐지
    var QTY_KW = ["수량","qty","quantity","갯수","개수"];
    var qtyCol = -1;
    for (var qhi = 0; qhi < headers.length; qhi++) {
      var qh = String(headers[qhi] || "").replace(/\s/g, "").toLowerCase();
      for (var qki = 0; qki < QTY_KW.length; qki++) {
        if (qh.indexOf(QTY_KW[qki]) !== -1) { qtyCol = qhi; break; }
      }
      if (qtyCol !== -1) break;
    }
    Logger.log("[송장매칭] productCol=" + productCol + ", qtyCol=" + qtyCol);

    // NFC 정규화 + "님" 제거로 이름→행 큐 맵 구성
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var nameToRows = {};
    for (var ri = 0; ri < data.length; ri++) {
      var rn = String(data[ri][recipientCol] || "").normalize("NFC").replace(/\s*님\s*$/g, "").trim();
      if (!rn) continue;
      if (!nameToRows[rn]) nameToRows[rn] = [];
      nameToRows[rn].push(ri);
    }
    var rowQueue = {};
    for (var qk in nameToRows) rowQueue[qk] = nameToRows[qk].slice();

    // ★ 2026-07-07: 파싱 — 1) TSV헤더 → 2) Gemini AI → 3) 정규식
    var pairs = preParsedPairs || null;
    var parseMethod = "pre-parsed";
    if (!pairs && rawText) {
      // ★ 2026-07-08: 다중 송장 전처리 + 그룹 추적
      // 패턴1: "이애란 259421457945 / 259421457956" (슬래시 구분)
      // 패턴2: "오영임 259421457993 259421458004" (공백 구분)
      // → 개별 줄로 분리 + 같은 그룹 ID 부여
      var _slashGroupMap = {};  // { tracking: groupId }
      var _nextGid = 1;

      // 패턴1: 슬래시 구분
      rawText = rawText.replace(/^(.+?)\s+([\d\-]{10,20}(?:\s*\/\s*[\d\-]{10,20})+)\s*$/gm, function(match, name, nums) {
        var gid = _nextGid++;
        var parts = nums.split(/\s*\/\s*/);
        var cleanName = name.trim();
        parts.forEach(function(n) {
          _slashGroupMap[n.trim().replace(/[-\s]/g, "")] = gid;
        });
        return parts.map(function(n) { return cleanName + " " + n.trim(); }).join("\n");
      });

      // 패턴2: 공백 구분 다중 송장 (이름 + 숫자10~14자리 + 공백 + 숫자10~14자리)
      rawText = rawText.replace(/^(.+?)\s+([\d]{10,14}(?:\s+[\d]{10,14})+)\s*$/gm, function(match, name, nums) {
        // 이미 슬래시 처리된 줄이면 스킵 (이름에 \n이 없어야 함)
        var trackNums = nums.trim().split(/\s+/);
        if (trackNums.length < 2) return match; // 1개면 변환 불필요
        var gid = _nextGid++;
        var cleanName = name.trim();
        trackNums.forEach(function(n) {
          _slashGroupMap[n.trim().replace(/[-\s]/g, "")] = gid;
        });
        return trackNums.map(function(n) { return cleanName + " " + n.trim(); }).join("\n");
      });

      // 1단계: 헤더 기반 TSV 파싱 (가장 빠르고 정확)
      pairs = _parseStructuredTSV_(rawText);
      parseMethod = "tsv-header";
      if (!pairs) {
        // 2단계: Gemini AI (비구조 텍스트)
        pairs = _parseInvoicePairsWithGemini_(rawText);
        parseMethod = "gemini";
      }
      if (!pairs) {
        // 3단계: 정규식 폴백
        pairs = _parseInvoicePairs_(rawText);
        parseMethod = "regex-fallback";
      }

      // ★ 파싱 후 슬래시 그룹 ID 주입
      if (pairs && _nextGid > 1) {
        for (var _gi = 0; _gi < pairs.length; _gi++) {
          var _gt = (pairs[_gi].tracking || "").replace(/[-\s]/g, "");
          if (_slashGroupMap[_gt]) pairs[_gi]._slashGroup = _slashGroupMap[_gt];
        }
      }
    }
    if (!pairs || pairs.length === 0) return { error: '인식된 쌍 없음. 형식: "송장번호   이름" (각 줄)' };
    Logger.log("[송장매칭] 파싱방식=" + parseMethod + ", 건수=" + pairs.length);
    // ★ DEBUG: 슬래시 그룹 추적 상태
    if (_nextGid > 1) {
      Logger.log("[송장매칭] 슬래시 그룹: " + JSON.stringify(_slashGroupMap));
      var sgCount = 0;
      for (var _dgi = 0; _dgi < pairs.length; _dgi++) {
        if (pairs[_dgi]._slashGroup) sgCount++;
      }
      Logger.log("[송장매칭] 그룹 주입된 pairs: " + sgCount + "/" + pairs.length);
    }

    // ★ 2026-07-07: itemName에서 송하인/택배사 패턴 제거
    var SENDER_FILTER = /^(팩투유|주식회사\s*팩투유|\(주\)\s*팩투유|Pack2U|한진|한진택배|로젠|로젠택배|CJ대한통운|CJ택배|롯데택배|우체국택배|경동택배)$/i;
    for (var fi = 0; fi < pairs.length; fi++) {
      if (pairs[fi].itemName && SENDER_FILTER.test(pairs[fi].itemName.trim())) {
        Logger.log("[송장매칭] itemName 필터링: '" + pairs[fi].itemName + "' → 제거");
        pairs[fi].itemName = "";
      }
    }

    // NFC 정규화 + 잔여 택배사 프리픽스 정리
    var COURIER_PFX = /^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\s*[\/]\s*/i;
    for (var nfi = 0; nfi < pairs.length; nfi++) {
      if (pairs[nfi].name) {
        pairs[nfi].name = pairs[nfi].name.normalize("NFC").replace(COURIER_PFX, "").replace(/^[\s\/]+/, "").trim();
      }
    }

    // 5단계 매칭 — ★ 같은(이름+품목)은 같은 행에 append
    var matches = [], unmatched = [], lastRowForName = {};
    var nameItemRowMap = {}; // ★ "이름|품목" → 이미 매칭된 행 번호
    var rowCapacity = {};    // ★ rowIndex → { max: 수량, used: 사용량 } (수량 기반 배분)
    var slashGroupRowMap = {}; // ★ 2026-07-08: 슬래시 그룹 → 배정된 행

    for (var pi = 0; pi < pairs.length; pi++) {
      var p = pairs[pi];
      var assignedRows = [];
      var matchedName = p.name;
      var isAppend = false;
      var queueKey = null;

      // ★ 슬래시 그룹 체크: 같은 그룹의 이전 송장이 이미 행에 배정되었으면 같은 행 사용
      if (p._slashGroup && slashGroupRowMap[p._slashGroup] !== undefined) {
        assignedRows = [slashGroupRowMap[p._slashGroup].row];
        matchedName = slashGroupRowMap[p._slashGroup].matchedName || p.name;
        isAppend = true;
      }

      // ★ 0. 같은 (이름+품목) 조합이 이미 행에 배정되었으면
      //   단, _slashGroup이 있으면 스킵 (새 그룹은 반드시 큐에서 새 행을 받아야 함)
      if (assignedRows.length === 0 && !p._slashGroup) {
        var itemKey = p.name + "|" + (p.itemName || "").replace(/\s/g, "").toUpperCase();
        if (nameItemRowMap[itemKey] !== undefined) {
          var mapped = nameItemRowMap[itemKey];
          if (p.itemName) {
            assignedRows = [mapped.row];
            matchedName = mapped.matchedName || p.name;
            isAppend = true;
          } else if (qtyCol !== -1 && rowCapacity[mapped.row]) {
            var cap = rowCapacity[mapped.row];
            if (cap.used >= cap.max) {
              delete nameItemRowMap[itemKey];
            } else {
              cap.used++;
              assignedRows = [mapped.row];
              matchedName = mapped.matchedName || p.name;
              isAppend = true;
            }
          } else {
            // 품목명도 없고 수량 열도 없으면 → 큐에 다른 행이 남아있으면 새 행 배정
            var fallbackQ = rowQueue[p.name] || rowQueue[mapped.matchedName || p.name];
            if (fallbackQ && fallbackQ.length > 0) {
              // fall-through to queue lookup
            } else {
              assignedRows = [mapped.row];
              matchedName = mapped.matchedName || p.name;
              isAppend = true;
            }
          }
        }
      }

      if (assignedRows.length === 0) {
        // 1. 완전 일치
        if (rowQueue[p.name] && rowQueue[p.name].length > 0) queueKey = p.name;
        // 2. 공백 제거 후 비교
        if (!queueKey) {
          var inputNoSp = p.name.replace(/\s/g, "");
          for (var nm in rowQueue) {
            if (rowQueue[nm].length > 0 && nm.replace(/\s/g, "") === inputNoSp) { queueKey = nm; matchedName = nm; break; }
          }
        }
        // 3. 부분 문자열 포함 (3자 이상, 길이 차이 1 이하)
        if (!queueKey) {
          for (var nm2 in rowQueue) {
            if (rowQueue[nm2].length > 0) {
              var lenDiff = Math.abs(nm2.length - p.name.length);
              if (nm2.length >= 3 && p.name.length >= 3 && lenDiff <= 1) {
                if (nm2.indexOf(p.name) !== -1 || p.name.indexOf(nm2) !== -1) {
                  queueKey = nm2; matchedName = nm2; break;
                }
              }
            }
          }
        }
        // 4. 공백 제거 후 부분 포함 (3자 이상, 길이 차이 1 이하)
        if (!queueKey) {
          var inputNoSp2 = p.name.replace(/\s/g, "");
          for (var nm3 in rowQueue) {
            if (rowQueue[nm3].length > 0) {
              var sheetNoSp = nm3.replace(/\s/g, "");
              var lenDiff = Math.abs(sheetNoSp.length - inputNoSp2.length);
              if (sheetNoSp.length >= 3 && inputNoSp2.length >= 3 && lenDiff <= 1) {
                if (sheetNoSp.indexOf(inputNoSp2) !== -1 || inputNoSp2.indexOf(sheetNoSp) !== -1) {
                  queueKey = nm3; matchedName = nm3; break;
                }
              }
            }
          }
        }
        // 5. 유사도 매칭
        if (!queueKey) {
          var bestKey = null, bestDist = 999;
          var inputNorm = p.name.replace(/\s/g, "");
          for (var nm4 in rowQueue) {
            if (rowQueue[nm4].length === 0) continue;
            var sheetNorm = nm4.replace(/\s/g, "");
            var maxLen = Math.max(inputNorm.length, sheetNorm.length);
            if (maxLen === 0) continue;
            var dist = _levenshteinLocal_(inputNorm, sheetNorm);
            var threshold = 0;
            if (maxLen >= 6) threshold = 2;
            else if (maxLen >= 3) threshold = 1;
            if (dist > Math.ceil(maxLen * 0.5)) threshold = -1;
            if (dist <= threshold && dist < bestDist) { bestDist = dist; bestKey = nm4; }
          }
          if (bestKey) { queueKey = bestKey; matchedName = bestKey; }
        }

        // 행 배정 — 품목명 기반 행 선택
        if (queueKey && rowQueue[queueKey] && rowQueue[queueKey].length > 0) {
          var q = rowQueue[queueKey];
          var selectedIdx = 0;

          // 품목명 매칭: pair에 itemName이 있고, 전용양식에 productCol이 있고, 큐에 2건 이상
          if (p.itemName && productCol !== -1 && q.length > 1) {
            var inputItem = String(p.itemName).toUpperCase().replace(/\s/g, "");
            var bestScore = -999, bestQIdx = 0;
            for (var qi = 0; qi < q.length; qi++) {
              var sheetItem = String(data[q[qi]][productCol] || "").toUpperCase().replace(/\s/g, "");
              if (!sheetItem) continue;
              var tokens = inputItem.match(/[A-Z0-9가-힣]+/g) || [];
              var score = 0;
              for (var tk = 0; tk < tokens.length; tk++) {
                if (sheetItem.indexOf(tokens[tk]) !== -1) score += 10;
              }
              if (sheetItem.indexOf(inputItem) !== -1 || inputItem.indexOf(sheetItem) !== -1) score += 50;
              var sizeKeys = ["바디", "캡", "뚜껑", "소", "중", "대", "특대"];
              for (var sk = 0; sk < sizeKeys.length; sk++) {
                var hasInput = inputItem.indexOf(sizeKeys[sk]) !== -1;
                var hasSheet = sheetItem.indexOf(sizeKeys[sk]) !== -1;
                if (hasInput && hasSheet) score += 100;
                else if (hasInput !== hasSheet) score -= 200;
              }
              if (score > bestScore) { bestScore = score; bestQIdx = qi; }
            }
            selectedIdx = bestQIdx;
          }

          assignedRows = [q.splice(selectedIdx, 1)[0]];
          lastRowForName[queueKey] = assignedRows[0];
          lastRowForName[p.name] = assignedRows[0];

          // ★ 이 (이름+품목)의 행 등록 + 수량 기반 용량 초기화
          nameItemRowMap[itemKey] = { row: assignedRows[0], matchedName: matchedName };
          if (qtyCol !== -1) {
            var maxQty = parseInt(data[assignedRows[0]][qtyCol], 10) || 1;
            rowCapacity[assignedRows[0]] = { max: maxQty, used: 1 };
          }
        } else if (lastRowForName[p.name] !== undefined) {
          assignedRows = [lastRowForName[p.name]];
          isAppend = true;
        } else {
          for (var lrn in lastRowForName) {
            var lenDiff = Math.abs(lrn.length - p.name.length);
            if (lrn.length >= 3 && p.name.length >= 3 && lenDiff <= 1) {
              if (lrn.indexOf(p.name) !== -1 || p.name.indexOf(lrn) !== -1) {
                assignedRows = [lastRowForName[lrn]];
                matchedName = lrn;
                isAppend = true;
                break;
              }
            }
          }
        }
      }

      // ★ 슬래시 그룹 행 등록: 이후 같은 그룹의 송장은 이 행에 append
      if (p._slashGroup && assignedRows.length > 0 && !slashGroupRowMap[p._slashGroup]) {
        slashGroupRowMap[p._slashGroup] = { row: assignedRows[0], matchedName: matchedName };
      }

      if (assignedRows.length > 0) {
        matches.push({ tracking: p.tracking, name: p.name, matchedName: matchedName, rows: assignedRows, append: isAppend, itemName: p.itemName || "" });
      } else {
        unmatched.push(p);
      }
    }

    return {
      matches: matches,
      unmatched: unmatched,
      recipientHeader: String(headers[recipientCol] || ""),
      total: pairs.length,
      parseMethod: parseMethod,
      _debug_sheetNames: Object.keys(nameToRows).slice(0, 20)
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  Web App 서버 함수: 반영 (applyInvoiceMatchesLocal과 동일 로직)
// ═══════════════════════════════════════════════════════════════
function _imApplyMatches_(ssId, matches) {
  try {
    if (typeof matches === "string") matches = JSON.parse(matches);
    var ss = SpreadsheetApp.openById(ssId);
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) { exTab = tabs[ti]; break; }
    }
    if (!exTab) return { msg: "❌ 전용양식 탭 없음" };

    var lr = exTab.getLastRow();
    var lc = Math.max(exTab.getLastColumn(), 1);
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var writeCount = 0;

    for (var mi = 0; mi < matches.length; mi++) {
      var m = matches[mi];
      if (!m.rows) continue;
      for (var ri = 0; ri < m.rows.length; ri++) {
        var idx = m.rows[ri];
        if (idx >= 0 && idx < data.length) {
          var ex = String(data[idx][0] || "").trim();
          data[idx][0] = m.append && ex ? ex + "\n" + String(m.tracking) : String(m.tracking);
          data[idx][1] = "발송완료";
          writeCount++;
        }
      }
    }
    exTab.getRange(2, 1, data.length, lc).setValues(data);
    SpreadsheetApp.flush();
    return { msg: "✅ " + writeCount + "행에 송장번호 반영 완료" };
  } catch (e) {
    return { msg: "❌ " + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  ★ 2026-06-23: 통합 자동 트리거 설정 시스템
//  전체 업무를 시간표 기반으로 자동 실행
//  GAS 트리거 20개 제한 내에서 관리 (onEdit 등 제외 시 19개)
// ═══════════════════════════════════════════════════════════════

/**
 * ★ 통합 트리거에서 사용할 Silent 래퍼 함수들
 * UI(alert/prompt) 없이 자동 실행 + 에러 로깅
 */

/** 일일 전체마감 (05시) — Silent */
function _trigger_dailyArchiveAll_() {
  try {
    Logger.log("[TRIGGER 05:00] 일일 전체마감 시작");
    partnerDailyArchiveAll();
    Logger.log("[TRIGGER 05:00] 일일 전체마감 완료");
    try { _chat_sendCard_("✅ 일일 전체마감 완료", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "상태", value: "정상 완료" }]); } catch (_) {}
  } catch (e) {
    Logger.log("[TRIGGER 05:00] 일일 전체마감 에러: " + e.message);
    try { _chat_sendCard_("❌ 자동마감 에러", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

/** 대리판매 마감 (07시) — Silent
 *  ★ partnerArchiveToMonthlySettle은 UI 의존적이므로,
 *  기존 Silent 래퍼 partnerArchiveToMonthlySilent_ 호출 */
function _trigger_monthlySettle_() {
  // ★ 2026-06-27: 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → 대리판매 마감 스킵"); return; }
  try {
    Logger.log("[TRIGGER 07:00] 대리판매 마감 시작");
    partnerArchiveToMonthlySilent_();
    Logger.log("[TRIGGER 07:00] 대리판매 마감 완료");
    try { _chat_sendCard_("✅ 대리판매 마감 완료", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "상태", value: "정상 완료" }]); } catch (_) {}
  } catch (e) {
    Logger.log("[TRIGGER 07:00] 대리판매 마감 에러: " + e.message);
    try { _chat_sendCard_("❌ 대리판매 마감 에러", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

/** 대리공급(전용양식) 마감 (07:20) — Silent
 *  ★ partnerArchiveExclusiveForm은 UI 의존적이므로,
 *  핵심 로직 _pea_core_ 를 직접 호출 */
function _trigger_exclusiveArchive_() {
  // ★ 2026-06-27: 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → 대리공급 마감 스킵"); return; }
  try {
    Logger.log("[TRIGGER 07:20] 대리공급 마감 시작");
    // ★ 2026-06-30: 디버깅 — 파일 목록 확인
    var files = _pt_listFiles();
    Logger.log("[TRIGGER 07:20] 파일 목록: " + (files ? files.length : "null") + "개");

    var now     = new Date();
    var yyyy    = Utilities.formatDate(now, "Asia/Seoul", "yyyy");
    var mm      = parseInt(Utilities.formatDate(now, "Asia/Seoul", "M"), 10);
    var tabName = "(" + yyyy + "년 " + mm + "월) " + _PEA_TAB_SUFFIX;
    Logger.log("[TRIGGER 07:20] 마감탭명: " + tabName);
    var result  = _pea_core_(tabName);
    Logger.log("[TRIGGER 07:20] 대리공급 마감 완료: 이동=" + result.moved + "건, 잔류=" + result.kept + "건" +
      (result.tempCleared ? ", 임시기록삭제=" + result.tempCleared + "건" : "") +
      (result.hubCleared ? ", 허브정리=" + result.hubCleared + "건" : "") +
      (result.errors && result.errors.length > 0 ? ", 에러=" + result.errors.join("; ") : ""));
    try {
      var kvItems = [
        { label: "이동", value: result.moved + "건" },
        { label: "잔류", value: result.kept + "건" },
        { label: "파일 수", value: (files ? files.length : 0) + "개" },
      ];
      if (result.tempCleared !== undefined) {
        kvItems.push({ label: "📋 임시기록 삭제", value: result.tempCleared + "건" });
        kvItems.push({ label: "📋 임시기록 유지", value: (result.tempKept || 0) + "건" });
      }
      if (result.hubCleared) {
        kvItems.push({ label: "📋 발주허브 정리", value: result.hubCleared + "건" });
      }
      if (result.errors && result.errors.length > 0) {
        kvItems.push({ label: "⚠ 에러", value: result.errors.slice(0, 3).join(", ") });
      }
      _chat_sendCard_("✅ 대리공급 마감 완료", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), kvItems);
    } catch (_) {}
  } catch (e) {
    Logger.log("[TRIGGER 07:20] 대리공급 마감 에러: " + e.message + "\n" + e.stack);
    try { _chat_sendCard_("❌ 대리공급 마감 에러", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

/** 도서산간 추가배송비 (09:15 / 14:20) — Silent
 *  ★ partnerCheckIslandShipping / _island_core_ 은 UI 의존적이므로,
 *  핵심 로직(uidBoxMap → 허브적용 → 업체적용)을 직접 호출 */
function _trigger_islandShipping_() {
  // ★ 2026-06-27: 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → 도서산간 스킵"); return; }
  try {
    Logger.log("[TRIGGER] 도서산간 추가배송비 시작");
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) { Logger.log("[TRIGGER] 도서산간 락 획득 실패 → 스킵"); return; }
    try {
      var uidBoxMap = _island_loadIslandUidBoxMap_();
      if (!uidBoxMap || Object.keys(uidBoxMap).length === 0) {
        Logger.log("[TRIGGER] 도서산간 탭 데이터 없음 → 스킵");
        return;
      }
      var hubResult = _island_applyToHub_(uidBoxMap);
      var partnerResult = { applied: 0, skipped: 0, files: 0, errors: [] };
      if (hubResult.vendorNames && hubResult.vendorNames.length > 0) {
        partnerResult = _island_applyToPartnerSheets_(uidBoxMap, hubResult.vendorNames);
      }
      Logger.log("[TRIGGER] 도서산간 완료: 허브=" + hubResult.applied + "건, 업체=" + partnerResult.applied + "건");
      try { _chat_sendCard_("✅ 도서산간 배송비 완료", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "허브", value: hubResult.applied + "건" }, { label: "업체", value: partnerResult.applied + "건" }]); } catch (_) {}
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log("[TRIGGER] 도서산간 추가배송비 에러: " + e.message);
    try { _chat_sendCard_("❌ 도서산간 배송비 에러", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

/** 우편번호 채우기 (09:25 / 14:40) — Silent (UI 없이 실행) */
function _trigger_fillZipAndShipping_() {
  // ★ 2026-06-27: 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → 우편번호 채우기 스킵"); return; }
  try {
    Logger.log("[TRIGGER] 우편번호/택배비 채우기 시작");
    // partnerJmFillZipAndShipping은 UI 의존적이므로, 핵심 로직만 직접 호출
    var files = _pt_listFiles();
    var jmFile = null;
    for (var fi = 0; fi < files.length; fi++) {
      if (files[fi].name.indexOf("제이엠") !== -1) { jmFile = files[fi]; break; }
    }
    if (!jmFile) { Logger.log("[TRIGGER] 제이엠 파일 없음 → 스킵"); return; }

    var ss = SpreadsheetApp.openById(jmFile.id);
    var tab = null;
    var allSheets = ss.getSheets();
    for (var si = 0; si < allSheets.length; si++) {
      if (allSheets[si].getName().indexOf("전용양식") !== -1) { tab = allSheets[si]; break; }
    }
    if (!tab || tab.getLastRow() < 2) { Logger.log("[TRIGGER] 전용양식 탭 없거나 데이터 없음"); return; }

    var lr = tab.getLastRow();
    var lc = Math.max(tab.getLastColumn(), 49);
    var data = tab.getRange(2, 1, lr - 1, lc).getValues();

    // 공급가 탭에서 택배비 맵 로드
    var shippingMap = {};
    try {
      var JM_TAB_NAMES = ["공급가", "단가표", "JM공급가"];
      var priceTab = null;
      for (var jti = 0; jti < JM_TAB_NAMES.length; jti++) {
        priceTab = ss.getSheetByName(JM_TAB_NAMES[jti]);
        if (priceTab) break;
      }
      if (priceTab && priceTab.getLastRow() >= 2) {
        var pAll = priceTab.getRange(1, 1, priceTab.getLastRow(), Math.max(priceTab.getLastColumn(), 13)).getValues();
        for (var pi = 1; pi < pAll.length; pi++) {
          var pCode = String(pAll[pi][0] || "").trim();
          var pShip = parseFloat(pAll[pi][12]) || 0;
          if (pCode && pShip > 0) shippingMap[pCode] = pShip;
        }
      }
    } catch (eP) {}

    var zipFilled = 0, shipFilled = 0, zipCache = {};
    var zipCol = [], shipCol = [];

    for (var r = 0; r < data.length; r++) {
      var addr = String(data[r][5] || "").trim();
      var curZip = String(data[r][11] || "").trim();
      var curShip = data[r][15];
      var ecCode = String(data[r][48] || "").trim();

      var newZip = curZip;
      if (addr && !curZip) {
        if (zipCache[addr] !== undefined) {
          newZip = zipCache[addr];
        } else {
          try { newZip = _pep_getZipCodeFromKakao_(addr); } catch (eApi) {}
          zipCache[addr] = newZip || "";
          Utilities.sleep(120);
        }
        if (newZip) zipFilled++;
      }
      zipCol.push([newZip || curZip || ""]);

      var newShip = curShip;
      if (ecCode && (!curShip || Number(curShip) === 0) && shippingMap[ecCode]) {
        newShip = shippingMap[ecCode];
        shipFilled++;
      }
      shipCol.push([newShip || ""]);
    }

    if (zipFilled > 0) tab.getRange(2, 12, zipCol.length, 1).setValues(zipCol);
    if (shipFilled > 0) tab.getRange(2, 16, shipCol.length, 1).setValues(shipCol);
    SpreadsheetApp.flush();
    Logger.log("[TRIGGER] 우편번호: " + zipFilled + "건, 택배비: " + shipFilled + "건 채우기 완료");
    try { _chat_sendCard_("✅ 우편번호/택배비 완료", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "우편번호", value: zipFilled + "건" }, { label: "택배비", value: shipFilled + "건" }]); } catch (_) {}
  } catch (e) {
    Logger.log("[TRIGGER] 우편번호/택배비 채우기 에러: " + e.message);
    try { _chat_sendCard_("❌ 우편번호/택배비 에러", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

/** ★ 2026-06-23: 단가맵 제거됨 — 하위호환용 빈 함수 */
function _trigger_collectPriceMap_() {
  Logger.log("[TRIGGER] 단가맵 제거됨 — 스킵");
}

/** 냅킨코리아 Gmail 송장수집 (15:40) — Silent (★ 2026-06-23: 시간 윈도우 보정 및 Chat 알림 추가) */
function _trigger_NK_Gmail_() {
  try {
    Logger.log("[TRIGGER 15:40] 냅킨코리아 Gmail 송장수집 시작");
    
    // 시간 윈도우 체크 (15:30 ~ 16:30)
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    var totalMin = h * 60 + m;
    var startMin = _GMI_TRIGGER_START_HOUR * 60 + _GMI_TRIGGER_START_MIN;
    var endMin = _GMI_TRIGGER_END_HOUR * 60 + _GMI_TRIGGER_END_MIN;
    
    if (totalMin < startMin || totalMin > endMin) {
      Logger.log("[TRIGGER 15:40] 시간 윈도우 밖으로 인한 스킵 (현재 " + h + ":" + m + ")");
      return;
    }
    
    // 락 검사 및 메일 처리 실행 (동시 실행 방지)
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      Logger.log("[TRIGGER 15:40] NK Gmail 송장수집: Lock 확보 실패");
      return;
    }
    
    try {
      var result = _gmi_processNKInvoiceMails_(false);
      var statusMsg = "메일 " + result.mailCount + "건, 파싱 " + result.parsedCount + "쌍, 매칭 " + result.matchedCount + "건, 미매칭 " + result.unmatchedCount + "건";
      Logger.log("[TRIGGER 15:40] 냅킨코리아 Gmail 송장수집 완료: " + statusMsg);
      
      try {
        _chat_sendCard_(
          "✅ 냅킨코리아 Gmail 송장수집 완료",
          Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
          [
            { label: "메일 확인", value: result.mailCount + " 건" },
            { label: "매칭 결과", value: "매칭: " + result.matchedCount + " 건 / 미매칭: " + result.unmatchedCount + " 건" }
          ]
        );
      } catch (_) {}
    } finally {
      lock.releaseLock();
    }
    
  } catch (e) {
    Logger.log("[TRIGGER 15:40] 냅킨코리아 Gmail 송장수집 에러: " + e.message);
    try {
      _chat_sendCard_(
        "❌ 냅킨코리아 Gmail 수집 에러",
        Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
        [{ label: "오류 내용", value: String(e.message).substring(0, 200) }]
      );
    } catch (_) {}
  }
}

/** 송장 수집 (15:50) — Silent */
function _trigger_fetchInvoices_() {
  // ★ 2026-06-27: 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → 송장 수집 스킵"); return; }
  try {
    Logger.log("[TRIGGER 15:50] 허브 송장 수집 시작");
    partnerFetchInvoices();
    Logger.log("[TRIGGER 15:50] 허브 송장 수집 완료");
    try { _chat_sendCard_("✅ 자동 송장 수집 완료", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), []); } catch (_) {}
  } catch (e) {
    Logger.log("[TRIGGER 15:50] 허브 송장 수집 에러: " + e.message);
    try { _chat_sendCard_("❌ 자동 송장 수집 에러", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

/** 송장 배포 (16:30) — Silent */
function _trigger_pushInvoices_() {
  // ★ 2026-06-27: 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → 송장 배포 스킵"); return; }
  try {
    Logger.log("[TRIGGER 16:30] 송장 배포 시작");
    partnerPushInvoices();
    Logger.log("[TRIGGER 16:30] 송장 배포 완료");
    try { _chat_sendCard_("✅ 자동 송장 배포 완료", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "상태", value: "배포 완료" }]); } catch (_) {}
  } catch (e) {
    Logger.log("[TRIGGER 16:30] 송장 배포 에러: " + e.message);
    try { _chat_sendCard_("❌ 자동 송장 배포 에러", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

/** ★ 2026-07-02: Supabase DB 동기화 (17:00) — Silent */
function _trigger_syncDb_() {
  // 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → DB 동기화 스킵"); return; }
  try {
    Logger.log("[TRIGGER] Supabase DB 동기화 시작");
    // ★ 2026-07-03: syncAllToDbOwner → UI 의존(getUi) → 트리거에서 에러
    //   핵심 로직만 직접 호출 (UI confirm/alert 제거)
    var msgs = [];
    var ordersResult = _sb_syncOrders_();
    msgs.push("[발주] " + (ordersResult.ok ? "✅" : "❌") + " " + ordersResult.msg.split("\n")[0]);
    var vendorsResult = _sb_syncVendors_();
    msgs.push("[업체] " + (vendorsResult.ok ? "✅" : "❌") + " " + vendorsResult.msg.split("\n")[0]);
    Logger.log("[TRIGGER] DB 동기화 완료: " + msgs.join(", "));
    try { _chat_sendCard_("✅ 자동 DB 동기화 완료", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
      [{ label: "발주", value: ordersResult.msg.split("\n")[0] },
       { label: "업체", value: vendorsResult.msg.split("\n")[0] }]); } catch (_) {}
  } catch (e) {
    Logger.log("[TRIGGER] DB 동기화 에러: " + e.message);
    try { _chat_sendCard_("❌ 자동 DB 동기화 에러", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────
//  통합 트리거 설정/제거/상태 확인
// ─────────────────────────────────────────────────────

/**
 * ★ 전체 트리거 목록 (handler 함수명, 시, 분)
 * 이 배열의 순서가 곧 실행 스케줄입니다.
 */
var _ALL_SCHEDULED_TRIGGERS_ = [
  // ─── 새벽/아침: 이카운트 + 마감 ───
  // ★ 2026-07-02: 02시 이카운트 완전 제거 (6시/12시는 유지)
  { fn: "runDailyEcountBatch",                           h: 6,  m: 0,  label: "이카운트 전체동기화 1" },
  { fn: "_trigger_monthlySettle_",                       h: 7,  m: 0,  label: "대리판매 마감" },
  { fn: "_trigger_exclusiveArchive_",                    h: 7,  m: 20, label: "대리공급 마감" },

  // ─── 오전 1회전 ───
  { fn: "partnerCollectOrdersSilent_",                   h: 8,  m: 0,  label: "발주 수집 + 판매현황 갱신 (1회전)" },
  { fn: "partnerPushOrdersToExclusiveFormsSilent_",      h: 9,  m: 20, label: "대리공급 Push + 우편번호 (1회전)" },

  // ─── 점심: 이카운트 + Supabase + 허브 ───
  { fn: "runDailyEcountBatch",                           h: 12, m: 0,  label: "이카운트 전체동기화 2" },
  { fn: "_trigger_syncDb_",                              h: 12, m: 30, label: "통합 DB 동기화 [Supabase]" },
  { fn: "runDailyHubBatch",                              h: 12, m: 40, label: "통합허브 상태/재고 업데이트" },

  // ─── 오후 2회전 ───
  { fn: "partnerCollectOrdersSilent_",                   h: 14, m: 5,  label: "발주 수집 + 판매현황 갱신 (2회전)" },
  { fn: "partnerPushOrdersToExclusiveFormsSilent_",      h: 14, m: 20, label: "대리공급 Push + 우편번호 (2회전)" },

  // ─── 송장 처리 ───
  { fn: "_gmi_triggerFetchNKInvoice_",                   h: 15, m: 35, label: "넵킨코리아 Gmail 송장수집" },
  { fn: "_trigger_fetchInvoices_",                       h: 15, m: 40, label: "송장 수집" },
  { fn: "_trigger_pushInvoices_",                        h: 16, m: 20, label: "송장 배포" },

  // ─── 저녁: Supabase + 일일마감 ───
  { fn: "_trigger_syncDb_",                              h: 17, m: 0,  label: "발주허브-DB + 협력업체-DB 동기화 [Supabase]" },
  { fn: "_pep_unifiedDailyArchiveScheduled_",            h: 23, m: 30, label: "통합 일일마감" },
];


/**
 * ★ 기존 모든 시간 기반 트리거를 정리하는 헬퍼
 * onEdit 등 이벤트 기반은 건드리지 않음
 */
function _removeAllTimeTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    var type = triggers[i].getEventType();
    // TIME_DRIVEN만 삭제 (ON_EDIT, ON_OPEN 등은 유지)
    if (type === ScriptApp.EventType.CLOCK) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return removed;
}

/**
 * ★ 통합 자동 트리거 설치 (메뉴에서 호출)
 * 기존 모든 시간 기반 트리거를 제거 후, 새 시간표로 재설치
 */
function setupAllScheduledTriggers() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  // 확인 팝업
  if (ui) {
    var lines = ["⏰ 전체 자동 트리거를 설치합니다.\n"];
    lines.push("기존 모든 시간 기반 트리거를 제거하고,");
    lines.push("아래 " + _ALL_SCHEDULED_TRIGGERS_.length + "개 스케줄로 재설치합니다:\n");
    for (var i = 0; i < _ALL_SCHEDULED_TRIGGERS_.length; i++) {
      var t = _ALL_SCHEDULED_TRIGGERS_[i];
      var hh = String(t.h).length < 2 ? "0" + t.h : String(t.h);
      var mm = String(t.m).length < 2 ? "0" + t.m : String(t.m);
      lines.push("  " + hh + ":" + mm + "  " + t.label);
    }
    lines.push("\n⚠ 기존 5분 간격 수집, 이카운트 자동, 대시보드 트리거 등");
    lines.push("모든 시간 기반 트리거가 교체됩니다. 계속할까요?");
    var ans = ui.alert("⏰ 통합 자동 트리거 설치", lines.join("\n"), ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
  }

  // 1) 기존 시간 기반 트리거 모두 제거
  var removed = _removeAllTimeTriggers_();
  Logger.log("[TRIGGER_SETUP] 기존 시간 트리거 " + removed + "개 제거");

  // 2) MAIN_SS_ID 저장 (트리거에서 getActiveSpreadsheet 대체용)
  try {
    var activeSS = SpreadsheetApp.getActiveSpreadsheet();
    if (activeSS) {
      PropertiesService.getScriptProperties().setProperty("MAIN_SS_ID", activeSS.getId());
    }
  } catch (e) {}

  // 3) 새 스케줄 설치
  var installed = 0;
  var errors = [];
  for (var j = 0; j < _ALL_SCHEDULED_TRIGGERS_.length; j++) {
    var spec = _ALL_SCHEDULED_TRIGGERS_[j];
    try {
      ScriptApp.newTrigger(spec.fn)
        .timeBased()
        .everyDays(1)
        .atHour(spec.h)
        .nearMinute(spec.m)
        .create();
      installed++;
    } catch (eT) {
      errors.push(spec.label + ": " + eT.message);
    }
  }

  Logger.log("[TRIGGER_SETUP] " + installed + "개 트리거 설치 완료" +
    (errors.length > 0 ? " (" + errors.length + "개 실패)" : ""));

  // 4) 결과 표시
  if (ui) {
    var msg = "✅ 통합 자동 트리거 설치 완료\n\n" +
      "- 기존 트리거 제거: " + removed + "개\n" +
      "- 신규 설치: " + installed + "/" + _ALL_SCHEDULED_TRIGGERS_.length + "개\n" +
      (errors.length > 0 ? "\n⚠ 실패:\n" + errors.join("\n") : "") +
      "\n\n※ Google 트리거 특성상 실제 실행은 ±5분 오차 가능";
    ui.alert(msg);
  }

  // Chat 알림
  try {
    _chat_sendCard_("✅ 통합 트리거 설치", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
      [
        { label: "제거", value: removed + "개" },
        { label: "설치", value: installed + "/" + _ALL_SCHEDULED_TRIGGERS_.length + "개" },
      ]);
  } catch (_) {}
}

/**
 * ★ 통합 자동 트리거 전체 제거 (메뉴에서 호출)
 */
function removeAllScheduledTriggers() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  if (ui) {
    var ans = ui.alert("⏸ 전체 자동 트리거 제거",
      "모든 시간 기반 자동 트리거를 제거합니다.\n\n" +
      "⚠ 이카운트 동기화, 발주 수집, 송장 배포 등\n" +
      "모든 자동 실행이 중지됩니다. 계속할까요?",
      ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
  }

  var removed = _removeAllTimeTriggers_();

  if (ui) {
    ui.alert("✅ 자동 트리거 " + removed + "개 제거 완료\n\n모든 자동 실행이 중지되었습니다.");
  }
  Logger.log("[TRIGGER_REMOVE] 시간 기반 트리거 " + removed + "개 제거됨");
}

/**
 * ★ 통합 자동 트리거 상태 확인 (메뉴에서 호출)
 */
function showAllScheduledTriggerStatus() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();

  // 핸들러별 카운트
  var fnCount = {};
  var totalTime = 0;
  var totalEvent = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    var type = triggers[i].getEventType();
    if (type === ScriptApp.EventType.CLOCK) {
      fnCount[fn] = (fnCount[fn] || 0) + 1;
      totalTime++;
    } else {
      totalEvent++;
    }
  }

  var lines = ["⏰ 자동 트리거 상태 (총 " + totalTime + "개 시간 기반 / " + totalEvent + "개 이벤트)\n"];

  // 스케줄 정의 대비 설치 상태
  lines.push("═══ 스케줄 정의 vs 실제 설치 ═══");
  var missingCount = 0;
  for (var j = 0; j < _ALL_SCHEDULED_TRIGGERS_.length; j++) {
    var spec = _ALL_SCHEDULED_TRIGGERS_[j];
    var hh = String(spec.h).length < 2 ? "0" + spec.h : String(spec.h);
    var mm = String(spec.m).length < 2 ? "0" + spec.m : String(spec.m);
    var count = fnCount[spec.fn] || 0;
    var status = count > 0 ? "✅" : "❌";
    if (count === 0) missingCount++;
    lines.push("  " + status + " " + hh + ":" + mm + "  " + spec.label + (count > 1 ? " (" + count + "개)" : ""));
  }

  // 정의에 없는 시간 트리거
  var extraFns = [];
  var knownFns = {};
  for (var k = 0; k < _ALL_SCHEDULED_TRIGGERS_.length; k++) {
    knownFns[_ALL_SCHEDULED_TRIGGERS_[k].fn] = true;
  }
  for (var fn2 in fnCount) {
    if (!knownFns[fn2]) {
      extraFns.push("  ⚠ " + fn2 + " (" + fnCount[fn2] + "개) — 스케줄 외");
    }
  }
  if (extraFns.length > 0) {
    lines.push("\n═══ 스케줄 외 트리거 ═══");
    lines = lines.concat(extraFns);
  }

  // 요약
  lines.push("\n═══ 요약 ═══");
  if (missingCount === 0 && extraFns.length === 0) {
    lines.push("🟢 모든 트리거 정상 설치됨");
  } else {
    if (missingCount > 0) lines.push("🔴 " + missingCount + "개 미설치");
    if (extraFns.length > 0) lines.push("⚠ " + extraFns.length + "개 스케줄 외 트리거 존재");
    lines.push("\n'통합 자동 트리거 설치' 메뉴로 재설치하세요.");
  }
  lines.push("\n트리거 총합: " + (totalTime + totalEvent) + " / 20개 제한");

  ui.alert("⏰ 자동 트리거 상태", lines.join("\n"), ui.ButtonSet.OK);
}
