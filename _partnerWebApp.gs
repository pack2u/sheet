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
      "대리판매: " + (result.detail.hub || 0) + "건\n" +
      "합계: " + result.archived + "건",
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("❌ 일일마감 오류: " + e.message);
  }
}

/**
 * ★ 판매현황_단가맵 수동 수집 (메뉴에서 직접 호출)
 * 세트분리 시트의 판매현황 탭을 즉시 읽어 허브 단가맵에 누적 저장
 * ★ 초기화 없이 append → 하루 2회 누적 안전
 */
function partnerCollectPriceMapManual() {
  var ui = SpreadsheetApp.getUi();
  try {
    var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
    var salesTab = srcSS.getSheetByName("판매현황");
    if (!salesTab || salesTab.getLastRow() < 2) {
      ui.alert("⚠️ 판매현황 탭에 데이터가 없습니다.\n(초기화 이후일 수 있음)");
      return;
    }

    // ★ 진단용: 1행+2행 헤더 읽기
    var sLc = Math.max(salesTab.getLastColumn(), 30);
    var sRow1 = salesTab.getRange(1, 1, 1, sLc).getValues()[0];
    var sRow2 = salesTab.getRange(2, 1, 1, sLc).getValues()[0];
    // 2행이 실제 헤더일 가능성 높음 (1행=제목)
    var r1cnt = 0, r2cnt = 0;
    for (var rx = 0; rx < sRow1.length; rx++) {
      if (String(sRow1[rx] || "").trim()) r1cnt++;
      if (String(sRow2[rx] || "").trim()) r2cnt++;
    }
    var actualHeader = (r2cnt > r1cnt && r2cnt >= 3) ? sRow2 : sRow1;
    var headerList = [];
    for (var hi = 0; hi < actualHeader.length; hi++) {
      var hv = String(actualHeader[hi] || "").trim();
      if (hv) headerList.push((hi + 1) + ":" + hv);
    }

    var beforeCount = 0;
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var mapTab = ss.getSheetByName("판매현황_단가맵");
      if (mapTab) beforeCount = Math.max(mapTab.getLastRow() - 1, 0);
    } catch (e) {}

    _pep_appendSalesPriceMap_(salesTab);

    var afterCount = 0;
    try {
      var ss2 = SpreadsheetApp.getActiveSpreadsheet();
      var mapTab2 = ss2.getSheetByName("판매현황_단가맵");
      if (mapTab2) afterCount = Math.max(mapTab2.getLastRow() - 1, 0);
    } catch (e) {}

    var newCount = afterCount - beforeCount;

    // ★ 0건일 때 진단 정보 표시
    if (newCount === 0 && afterCount === 0) {
      // 데이터 샘플 (첫 행)
      var sampleRow = "";
      if (salesTab.getLastRow() >= 2) {
        var firstRow = salesTab.getRange(2, 1, 1, sLc).getValues()[0];
        var sampleParts = [];
        for (var si = 0; si < firstRow.length; si++) {
          var sv = String(firstRow[si] || "").trim();
          if (sv) sampleParts.push((si + 1) + ":" + sv.substring(0, 15));
        }
        sampleRow = sampleParts.slice(0, 15).join(", ");
      }

      ui.alert("⚠️ 단가맵 수집 0건 — 진단 정보",
        "판매현황 행수: " + (salesTab.getLastRow() - 1) + "건\n\n" +
        "【헤더 목록】\n" + headerList.join(", ") + "\n\n" +
        "【1행 데이터 샘플】\n" + sampleRow + "\n\n" +
        "※ 감지 대상 키워드:\n" +
        "  단가열: 판매단가, 판매가, 단가\n" +
        "  주문번호열: 주문번호, 사방넷주문번호, 고유ID\n" +
        "  품목코드열: 품목코드, 이카운트코드, 물품코드",
        ui.ButtonSet.OK);
    } else {
      ui.alert("💰 판매현황_단가맵 수집 완료",
        "소스: 세트분리 시트 → 판매현황 탭\n" +
        "판매현황 행수: " + (salesTab.getLastRow() - 1) + "건\n\n" +
        "기존 단가맵: " + beforeCount + "건\n" +
        "신규 추가: " + newCount + "건\n" +
        "현재 총합: " + afterCount + "건\n\n" +
        "※ 중복 주문번호+품목코드는 자동 제외됩니다.\n" +
        "※ 일일마감 완료 시 단가맵은 초기화됩니다.",
        ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert("❌ 단가맵 수집 오류: " + e.message);
  }
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
  try {
    var now = new Date();
    var todayStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd");
    var dayOfWeek = now.getDay(); // 0=일, 6=토

    // ── ① 이미 오늘 마감 시트가 존재하면 스킵 ──
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

      // 주말은 별도 체크 (데이터 없으면 미생성이 정상)
      var pastFileName = "일일마감_(" + pastStr + ")";
      try {
        var pastExist = _unified_findExistingArchiveSs_(pastFileName);
        if (!pastExist) {
          missedDays.push(pastStr + (pastDay === 0 ? "(일)" : pastDay === 6 ? "(토)" : ""));
        }
      } catch (ePast) {}
    }

    if (missedDays.length > 0) {
      Logger.log("[SCHEDULED] 최근 7일 미생성 마감: " + missedDays.join(", "));
    }

    // ── ③ 오늘 이미 있고 미생성 과거도 없으면 → 완전 스킵 ──
    if (todayExists && missedDays.length === 0) {
      Logger.log("[SCHEDULED] 오늘(" + todayStr + ") 마감 존재 + 미생성 없음 → 스킵");
      return;
    }

    // ── ④ 주말 + 데이터 없음 → 스킵 ──
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      var hasData = _pep_checkDailyDataExists_();
      if (!hasData) {
        Logger.log("[SCHEDULED] 주말(" + todayStr + ") + 데이터 없음 → 스킵");
        return;
      }
      Logger.log("[SCHEDULED] 주말(" + todayStr + ") 데이터 있음 → 마감 진행");
    }

    // ── ⑤ 마감 실행 ──
    if (todayExists) {
      Logger.log("[SCHEDULED] 오늘 마감 이미 존재하나 미생성 과거(" +
        missedDays.join(", ") + ") 있음 → 데이터 추가 아카이브");
    }

    var result = _pep_archiveUnifiedDaily_();
    var logMsg = "[SCHEDULED] 통합 일일마감 완료: " +
      result.archived + "건 (로젠:" + result.detail.lozen +
      " 대리공급:" + result.detail.temp +
      " 대리판매:" + (result.detail.hub || 0) + ")";
    if (missedDays.length > 0) {
      logMsg += " ※ 미생성 과거: " + missedDays.join(", ");
    }
    Logger.log(logMsg);

    if (result.error) {
      Logger.log("[SCHEDULED] 일일마감 오류: " + result.error);
    }
  } catch (e) {
    Logger.log("[SCHEDULED] 통합 일일마감 자동 실행 실패: " + e.message);
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

/** ★ 통합 일일마감 트리거 설치 (매일 20시) */
function setupUnifiedDailyArchiveTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "_pep_unifiedDailyArchiveScheduled_") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("_pep_unifiedDailyArchiveScheduled_")
    .timeBased().everyDays(1).atHour(20).create();
  try {
    SpreadsheetApp.getUi().alert("✅ 통합 일일마감 트리거 설치 완료 (매일 20시)");
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
//   ★ 통합 일일마감은 _pep_unifiedDailyArchiveScheduled_ (20시 자동 트리거)
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

  // ★ 2026-06-19: 통합 일일마감은 20시 자동 트리거로 분리 (여기서 실행하지 않음)

  // ══════════════════════════════════════════════
  //  3단계: 초기화
  // ══════════════════════════════════════════════
  _toast_("3/3 단계: 초기화 중...");
  var _tempClear_ = { cleared: 0, kept: 0 };
  var _lozenTabDeleted_ = false;
  try {
    var _ss_ = SpreadsheetApp.getActiveSpreadsheet();
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

    if (!ssId) return _imJsonResp_({ error: "spreadsheetId 누락" });

    // 보안: 허브 폴더 내 파일인지 확인
    if (!_imIsValidVendorSheet_(ssId)) {
      return _imJsonResp_({ error: "유효하지 않은 시트입니다." });
    }

    switch (action) {
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

// ── Web App URL 반환 (독립 스크립트 배포) ──
function _getWebAppUrl_() {
  return "https://script.google.com/macros/s/AKfycbxlW3o1kUK2cIGRbC2fc2c8Sk_G7UrdxBe5vNSWytLjfrYe6QS4qqCVpIfMGk0AHs3g6Q/exec";
}

// ═══════════════════════════════════════════════════════════════
//  Web App 서버 함수: 분석 (parseAndMatchInvoiceTextLocal과 동일 로직)
// ═══════════════════════════════════════════════════════════════
function _imParseAndMatch_(ssId, rawText) {
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
    var KEYWORDS = ["받는분","받는사람","수령인","고객명","받으시는","수하인","수취인"];
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

    // 파싱
    var pairs = _parseInvoicePairs_(rawText);
    if (pairs.length === 0) return { error: '인식된 쌍 없음. 형식: "송장번호   이름" (각 줄)' };

    // NFC 정규화 + 잔여 택배사 프리픽스 정리
    var COURIER_PFX = /^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\s*[\/]\s*/i;
    for (var nfi = 0; nfi < pairs.length; nfi++) {
      if (pairs[nfi].name) {
        pairs[nfi].name = pairs[nfi].name.normalize("NFC").replace(COURIER_PFX, "").replace(/^[\s\/]+/, "").trim();
      }
    }

    // 5단계 매칭 (허브와 동일)
    var matches = [], unmatched = [], lastRowForName = {};
    for (var pi = 0; pi < pairs.length; pi++) {
      var p = pairs[pi];
      var assignedRows = [];
      var matchedName = p.name;
      var isAppend = false;
      var queueKey = null;

      // 1. 완전 일치
      if (rowQueue[p.name] && rowQueue[p.name].length > 0) queueKey = p.name;
      // 2. 공백 제거 후 비교
      if (!queueKey) {
        var inputNoSp = p.name.replace(/\s/g, "");
        for (var nm in rowQueue) {
          if (rowQueue[nm].length > 0 && nm.replace(/\s/g, "") === inputNoSp) { queueKey = nm; matchedName = nm; break; }
        }
      }
      // 3. 부분 문자열 포함
      if (!queueKey) {
        for (var nm2 in rowQueue) {
          if (rowQueue[nm2].length > 0 && (nm2.indexOf(p.name) !== -1 || p.name.indexOf(nm2) !== -1)) { queueKey = nm2; matchedName = nm2; break; }
        }
      }
      // 4. 공백 제거 후 부분 포함
      if (!queueKey) {
        var inputNoSp2 = p.name.replace(/\s/g, "");
        for (var nm3 in rowQueue) {
          if (rowQueue[nm3].length > 0) {
            var sheetNoSp = nm3.replace(/\s/g, "");
            if (sheetNoSp.indexOf(inputNoSp2) !== -1 || inputNoSp2.indexOf(sheetNoSp) !== -1) { queueKey = nm3; matchedName = nm3; break; }
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
          var threshold = Math.max(2, Math.floor(maxLen * 0.3));
          if (dist > Math.ceil(maxLen * 0.5)) threshold = -1;
          if (dist <= threshold && dist < bestDist) { bestDist = dist; bestKey = nm4; }
        }
        if (bestKey) { queueKey = bestKey; matchedName = bestKey; }
      }

      // 행 배정
      if (queueKey && rowQueue[queueKey] && rowQueue[queueKey].length > 0) {
        assignedRows = [rowQueue[queueKey].shift()];
        lastRowForName[queueKey] = assignedRows[0];
        lastRowForName[p.name] = assignedRows[0];
      } else if (lastRowForName[p.name] !== undefined) {
        assignedRows = [lastRowForName[p.name]];
        isAppend = true;
      } else {
        for (var lrn in lastRowForName) {
          if (lrn.indexOf(p.name) !== -1 || p.name.indexOf(lrn) !== -1) {
            assignedRows = [lastRowForName[lrn]];
            matchedName = lrn;
            isAppend = true;
            break;
          }
        }
      }

      if (assignedRows.length > 0) {
        matches.push({ tracking: p.tracking, name: p.name, matchedName: matchedName, rows: assignedRows, append: isAppend });
      } else {
        unmatched.push(p);
      }
    }

    return {
      matches: matches,
      unmatched: unmatched,
      recipientHeader: String(headers[recipientCol] || ""),
      total: pairs.length,
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
