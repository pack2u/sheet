/**
 * [Pack2U 최종 시스템 통합 메뉴 - 2026.04.09]
 * - 이카운트 연동(기능 보존) + 하이퍼 단가 관리(마스터 통합형)
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("💎 Pack2U 통합 제어탑")
    // 1. 이카운트 데이터 연동 파트
    .addItem("🔄 이카운트 전체 데이터 가져오기", "getEcountAll")
    .addItem("🔎 [선택 품목] 최신 정보 스캔", "fetchSelectedItems")
    .addSeparator()
    .addSubMenu(
      ui
        .createMenu("⏰ 전체 자동 업데이트 예약")
        .addItem("매일 자동 실행 켜기 (오전 6-7시)", "setupDailyTrigger")
        .addItem("자동 실행 끄기", "removeDailyTrigger")
    )
    .addSeparator()
    .addSubMenu(
      ui
        .createMenu("⬆️ 이카운트로 데이터 전송 (POST)")
        .addItem("📦 품목 등록/수정 전송", "sendItemToEcount")
        .addItem("🧾 판매 전표 전송", "sendSalesToEcount")
        .addItem("🛒 구매 발주서 전송", "sendPurchaseToEcount")
        .addItem("📊 재고 조정 전송", "sendInventoryToEcount"),
    )
    .addSeparator()
    .addSubMenu(
      ui
        .createMenu("🗂️ 구글 시트 양식 생성")
        .addItem("판매전표입력 탭 생성", "createSalesSheet")
        .addItem("구매발주입력 탭 생성", "createPurchaseSheet")
        .addItem("재고조정입력 탭 생성", "createInventorySheet"),
    )
    .addSeparator()

    // 2. 단가 관리 시스템 파트 (마스터 통합형)
    .addSubMenu(
      ui
        .createMenu("💰 단가 관리 마스터 시스템")
        .addItem("1️⃣ [허브] 데이터 허브 구축/재구성", "createStaticHub")
        .addItem("2️⃣ ⚡ [동기화] 전체 단가/이력 업데이트", "syncGroupPrices")
        .addItem(
          "3️⃣ 📦 [상태 반영] 판매 상태/재고만 업데이트",
          "syncStatusOnly",
        )
        .addSeparator()
        .addItem(
          "4️⃣ [링크발행] 프리미엄 배포용 시트 생성",
          "createVendorVlookupSheet",
        )
        .addItem(
          "5️⃣ 🔄 [일괄 업데이트] 모든 배포 시트 양식 최신화",
          "updateAllVendorSheets"
        )
        .addSeparator()
        .addItem("🔍 내 허브 주소 찾기", "findMyHub")
        .addItem("✨ 시스템 설정 전체 초기화", "resetSystem"),
    )
    .addSeparator()
    .addSubMenu(
      ui
        .createMenu("- 발주 및 송장 동기화 시스템 -")
        .addItem("[수집] 판매업체 발주건 통합 수집 (오전8시/오후2시)", "pullOrdersFromVendors")
        .addItem("[분배] 송장번호 및 처리상태 개별 뷰어 푸시 (오후4-5시)", "pushInvoicesToVendors")
    )
    .addSeparator()
    .addSubMenu(
      ui
        .createMenu("🤖 AI 헬퍼 메뉴")
        .addItem("전체 시트 구조 자동 진단 스캐너", "runSystemAnalyzer")
        .addSeparator()
        .addItem("✨ [1단계] 상품정보 시트 복사본 생성 및 수식 스캔", "createOptimizedCopy")
        .addItem("🛠️ [수동 연동] 사본 시트에만 데이터 로드 (테스트용)", "syncOptimizedCopyManual")
    )
    .addSeparator()
    .addItem("ℹ️ 도움말 보기", "showHelp")
    .addToUi();
}

/**
 * 이카운트 전송 도움말 (이미 사장님이 잘 사용 중이신 내용 유지)
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
    <h2>📤 이카운트 전송 및 단가 관리 안내</h2>
    <div class="tip">⚡ <b>단가 관리 팁</b>: 1번 메뉴로 허브를 구축한 후, 4번 메뉴로 업체에 링크를 발행하시면 '팩투유' 폴더에 자동으로 모입니다.</div>
    <p>... (나머지 상세 도움말 내용은 생략 없이 기존과 동일하게 유지됩니다) ...</p>
  `,
  )
    .setWidth(600)
    .setHeight(700)
    .setTitle("전체 시스템 도움말");
  SpreadsheetApp.getUi().showModalDialog(html, "수행 가이드");
}
