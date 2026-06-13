/**
 * [Pack2U 통합 메뉴]
 * ★ 2026-05-10 독립배포 시스템 제거 — 협력업체 시스템 + 이카운트만 유지
 *   제거 항목: 독립배포 관리, 발주/송장 관리, 업체 코드 매핑, 판매현황(엑셀)·점검
 *   유지 항목: 이카운트 연동, 협력업체 관리
 */

function onOpen() {
  try {
    registerPack2UMenu_();
  } catch (eMain) {
    try {
      SpreadsheetApp.getUi().alert(
        "메뉴 등록 오류",
        "Pack2U 메뉴 등록 실패:\n" +
          String(eMain && eMain.message ? eMain.message : eMain) +
          "\n\n스크립트 편집기에서 forceRegisterAllMenus 를 실행해 보세요.",
        SpreadsheetApp.getUi().ButtonSet.OK,
      );
    } catch (ignore) {}
  }
  try {
    registerPartnerMenu_();
  } catch (ePartner) {
    try {
      SpreadsheetApp.getUi().alert(
        "협력업체 메뉴 등록 오류",
        "💼 협력업체 관리 메뉴만 실패했습니다.\n" +
          String(ePartner && ePartner.message ? ePartner.message : ePartner) +
          "\n\nGAS에 orderSyncManager.gs 등 삭제 예정 파일이 남아 있으면 제거하세요.",
        SpreadsheetApp.getUi().ButtonSet.OK,
      );
    } catch (ignore2) {}
  }
}

/** 메뉴 강제 재등록 (스크립트 편집기에서 실행) */
function forceRegisterAllMenus() {
  registerPack2UMenu_();
  registerPartnerMenu_();
  SpreadsheetApp.getUi().alert("메뉴 재등록 완료", "시트를 새로고침(F5)해 확인하세요.", SpreadsheetApp.getUi().ButtonSet.OK);
}

function registerPack2UMenu_() {
  var ui = SpreadsheetApp.getUi();
  // ★ 수정: 독립배포 전용 ensureSalesStatusPasteSheetOnOpen_ 호출 제거

  ui.createMenu("💎 Pack2U")

    // ── 이카운트 데이터 가져오기 ──────────────────────────────
    .addItem("🔄 이카운트 전체 동기화", "getEcountAll")
    .addSeparator()
    .addItem("🛠️ 상품정보 최적화사본 만들기", "createOptimizedCopy")
    .addItem("⚡ 최적화사본 이카운트 수동 연동", "syncOptimizedCopyManual")
    .addSeparator()
    .addItem("🔎 선택 품목 최신정보 가져오기", "fetchSelectedItems")
    .addItem("🚀 선택 품목 상태 전송", "pushStatusToEcount")
    .addItem("🚀 선택 품목 재고 전송", "pushInventoryToEcount")
    .addSeparator()

    // ── 이카운트 연동 도구 ────────────────────────────────────
    .addSubMenu(
      ui
        .createMenu("🛠️ 이카운트 작업")
        .addItem(
          "🚀 이카운트 연동 초기화 (사본/첫 설치용)",
          "initializeEcountForSheet",
        )
        .addItem(
          "⏱️ 자동연동 켜기 — 사본 전용 시간 (원본과 충돌 방지)",
          "setupDailyTriggerForCopy",
        )
        .addSeparator()
        .addItem("UP 품목 검색 시트 만들기", "setupEcountFilterSheet")
        .addItem("🔍 조건으로 품목 조회", "runEcountItemFilter")
        .addSeparator()
        .addItem("📦 품목 등록/수정", "sendItemToEcount")
        .addItem("🧾 판매 전표 업로드(이카운트)", "sendSalesToEcount")
        .addItem("🛒 구매 발주 업로드(이카운트)", "sendPurchaseToEcount")
        .addItem("📊 재고 조정 업로드(이카운트)", "sendInventoryToEcount")
        .addSeparator()
        .addItem(
          "⏰ 자동연동 켜기 (01:20/02:00/11:50/12:30)",
          "setupDailyTrigger",
        )
        .addItem("⏰ 자동연동 끄기", "removeDailyTrigger")
        .addItem("📋 자동연동 상태 확인", "showDailyTriggerStatus")
        .addItem("🔧 자동연동 복구 실행", "repairDailyTriggerHealth")
        .addItem("🧪 이카운트 연동 진단", "diagnoseEcountIntegration")
        .addItem("🔐 이카운트 계정설정", "setupEcountCredentials"),
    )
    .addSeparator()

    .addItem("🤖 상품정보 분석 챗봇", "openProductChatbot")
    .addItem("ℹ️ 도움말 보기", "showHelp")
    .addToUi();
}

/**
 * onEdit 이벤트 핸들러
 * ★ 수정: 독립배포 전용 onEditMaybeRebuildSalesStatusPaste_ 호출 제거
 *   협력업체 시스템은 시간 기반 트리거로 운영하므로 onEdit 불필요
 */
function onEdit(e) {
  // 폐기송장 탭: 송장번호 입력 시 허브에서 판매처/품목명/수량/수취인 자동 조회
  try { _po_onEditVoidInvoiceAutoFill_(e); } catch(err) {}
}

/**
 * 도움말
 */
function showHelp() {
  var html = HtmlService.createHtmlOutput(
    `
    <style>
      body { font-family: 'Noto Sans KR', sans-serif; padding: 16px; color: #333; }
      h2 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }
      h3 { color: #0f9d58; margin-top: 20px; }
      .tip { background: #e8f4fd; border-left: 4px solid #1a73e8; padding: 8px 12px; margin: 8px 0; border-radius: 2px; }
    </style>
    <h2>📤 이카운트 전송 및 협력업체 관리 안내</h2>
    <div class="tip">⚡ <b>이카운트 연동</b>: 이카운트 전체 동기화로 상품정보를 최신 상태로 유지하세요.</div>
    <h3>💼 협력업체 관리 흐름</h3>
    <p>① 시트 생성 → ② 발주 수집 → ③ 송장 수집 → ④ 송장 배포 → ⑤ 월별 정산 이동</p>
    <h3>📦 New 발주 시스템 상세</h3>
    <p>1. <b>발주 수집</b>: 협력업체 시트 → 협력업체_발주허브로 수집</p>
    <p>2. <b>송장 수집</b>: 택배사 취합 시트 → 허브에 송장번호 매칭</p>
    <p>3. <b>송장 배포</b>: 허브 송장번호 → 각 협력업체 시트에 배포</p>
    <p>4. <b>월별 정산</b>: 송장 완료건 → 월별 마감 탭으로 이동</p>
    <h3>🤖 자동화 설정</h3>
    <p>⏰ 발주 수집 자동 켜기 (5분) → 발주 자동 수집이 실행됩니다.</p>
    <p>대리발주 자동 Push ON → 발주 수집 트리거 실행 시 Push도 함께 실행됩니다.</p>
  `,
  )
    .setWidth(600)
    .setHeight(550)
    .setTitle("전체 시스템 도움말");
  SpreadsheetApp.getUi().showModalDialog(html, "수행 가이드");
}
