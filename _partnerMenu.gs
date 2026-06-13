/**
 * [협력업체] 메뉴 등록  v3.1
 * 파일: _partnerMenu.gs
 */
function registerPartnerMenu_() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu("💼 협력업체 관리")

    // ━━━ 대리발송 발주시스템(New) ━━━━━━━━━━━━━━━━━━━━━━━━
    .addSubMenu(
      ui
        .createMenu("📦 대리발송 발주시스템(New)")
        .addItem(
          "🔄 [일괄] 허브아카이브 + 전용마감이동 + 월별정산이동",
          "partnerDailyArchiveAll",
        )
        .addItem("1️⃣ 대리판매 발주수집 ", "partnerCollectOrders")
        .addItem(
          "2️⃣ 이카운트 업로드용 판매현황 갱신",
          "partnerRebuildSalesUploadSheetManual",
        )
        .addItem(
          "3️⃣ 대리공급업체로 발주 Push ",
          "partnerPushOrdersToExclusiveForms",
        )
        .addSeparator()
        .addItem("5️⃣ 허브로 송장 수집 ", "partnerFetchInvoicesOwner")
        .addItem(
          "   └ 📬 카카오 송장매칭 (중앙 관리용)",
          "openInvoiceMatchSidebar",
        )
        .addItem("6️⃣ 폐기송장 적용", "partnerApplyVoidedInvoices")
        .addItem("7️⃣ 대리판매업체로 송장 배포", "partnerPushInvoicesOwner")
        .addSeparator()
        .addItem(
          "🚫 취소/반품 수집 (접수탭→허브·발주·마감)",
          "partnerCollectCancels",
        )
        .addItem("🚫 취소/반품 배포 (허브→업체시트)", "partnerPushCancelStatus")
        .addSeparator()
        // ── 마감탭 관리
        .addSubMenu(
          ui
            .createMenu("📋 마감탭 정리")
            .addItem(
              "월별 정산 이동 (송장완료→월별탭)",
              "partnerArchiveToMonthlySettleOwner",
            )
            .addItem(
              "📁 전용양식 → 전용발주 마감탭 이동",
              "partnerArchiveExclusiveFormOwner",
            )
            .addItem(
              "전일 허브 완료건 → 아카이브",
              "archiveHubIntegratedOrdersOwner",
            ),
        ),
    )
    .addSeparator()

    // ━━━ 통합 허브 단가 관리 (기존 그대로) ━━━━━━━━━━━━━
    .addSubMenu(
      ui
        .createMenu("💰 통합 허브 단가 관리")
        .addItem("1️⃣ [허브] 데이터 허브 구축/재구성", "createStaticHub")
        .addItem(
          "2️⃣ ⚡ [동기화] 상품정보 → 허브 단가 업데이트",
          "syncGroupPrices",
        )
        .addItem("3️⃣ [상태 반영] 판매 상태/재고만 업데이트", "syncStatusOnly")
        .addSeparator()
        .addItem(
          "5️⃣ 🔄 [일괄 업데이트] 모든 배포 시트 양식 최신화",
          "updateAllVendorSheets",
        )
        .addSeparator()
        .addItem("🔍 내 허브 주소 찾기", "findMyHub")
        .addItem("✨ 시스템 설정 전체 초기화", "resetSystem"),
    )
    .addSeparator()

    // ━━━ AS / 진단 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    .addSubMenu(
      ui
        .createMenu("🛠️ AS / 진단")

        // ── 시트·탭 관리
        .addSubMenu(
          ui
            .createMenu("📋 시트·탭 관리")
            .addItem("시트 생성 (표준)", "partnerCreateSheet")
            .addItem("시트 생성 (소비자용)", "partnerCreateConsumerSheet")
            .addItem(
              "시트 생성 (단가조회 전용)",
              "partnerCreateViewerOnlySheet",
            )
            .addSeparator()
            .addItem("전체 수식 갱신", "partnerForceUpdateAll")
            .addItem("🔄 검색입력 탭만 갱신", "partnerRefreshSearchInputOnly")
            .addItem("단가 새로고침 (빠른)", "partnerRefreshViewerPrices")
            .addItem("뷰어 코드 → 수동 모드 전환", "partnerViewerCodeToManual")

            .addItem(
              "협력Push 초기화 → 재Push용",
              "partnerResetExclusivePushUids",
            ),
        )
        .addSeparator()

        // ── 자동화 설정
        .addSubMenu(
          ui
            .createMenu("⚙️ 자동화 설정")
            .addItem("대리발주 자동 Push 켜기 (ON)", "partnerEnableAutoPush")
            .addItem("대리발주 자동 Push 끄기 (OFF)", "partnerDisableAutoPush")
            .addItem(
              "대리발주 자동 Push 상태 확인",
              "partnerShowAutoPushStatus",
            )
        )
        .addSeparator()

        // ── 복구 도구
        .addSubMenu(
          ui
            .createMenu("🔧 복구 도구")
            .addItem(
              "🚨 단가조회 3행 수식 긴급 복구 (전체)",
              "emergencyRepairAllViewerRow3Formulas",
            )
            .addSeparator()
            // ★ 직원 최초 1회 실행
            .addItem(
              "🔑 스크립트 권한 승인 (직원 최초 1회)",
              "partnerAuthorizeForStaff",
            )
            .addItem(
              "단가조회 탭 복구 (업체 선택)",
              "partnerRepairSingleViewer",
            )
            .addItem(
              "📝 발주탭 자동완성 스크립트 재설치 (전체 업체)",
              "adminInstallVendorOrderDateAutofillScripts_",
            )
            .addItem(
              "📝 발주탭 자동완성 스크립트 재설치 (특정 업체)",
              "adminInstallSingleVendorAutofillScript_",
            )
            .addItem("K2(그룹) 설정 + 수식 복구", "partnerSetK2AndRepair")
            .addItem("🔄 일반 → 소비자용 전환", "partnerConvertToConsumer")
            .addSeparator()
            .addItem("발주탭 헤더 복구", "partnerRepairOrderHeaders")
            .addItem("발주탭 단가수식 갱신", "partnerRepairOrderSpillFormulas")
            .addItem(
              "허브 단가 보정 (수량×단가→개별단가)",
              "partnerFixHubUnitPrices",
            )
            .addItem("발주탭 조건부서식 재적용", "partnerReapplyOrderTabCFR")
            .addSeparator()
            .addItem(
              "전용양식 헤더 일괄 업데이트",
              "partnerRepairExclusiveFormHeaders",
            )
            .addItem(
              "전용발주 마감탭 헤더 보정",
              "partnerRepairExclusiveArchiveHeaders",
            )
            .addSeparator()
            .addItem(
              "월별 마감 탭 레이아웃 보정",
              "partnerRepairMonthlySettleTabs",
            )
            .addItem(
              "발주마감 탭 이름 오류 수정",
              "partnerFixMalformedMonthlyTabs",
            )
            .addSeparator()
            .addSeparator()
            .addItem(
              "폐기송장 자동조회 트리거 설치",
              "partnerSetupVoidAutoFillTrigger",
            )
            .addItem(
              "거래처코드(B6) 서식 수정 (선행0 보존)",
              "partnerFixCustCodeCellFormat",
            ),
        )
        .addSeparator()

        // ── 진단·운영
        .addSubMenu(
          ui
            .createMenu("🔍 진단·운영")
            .addItem(
              "🩺 Push 시스템 통합 진단 (이걸 먼저!)",
              "partnerDiagnosePushSystem",
            )
            .addItem(
              "협력업체 상태 대시보드 갱신",
              "partnerShowStatusDashboard",
            )
            .addItem(
              "⏰ 대시보드 자동갱신 켜기",
              "partnerSetupDashboardAutoRefresh",
            )
            .addItem(
              "⏸ 대시보드 자동갱신 끄기",
              "partnerRemoveDashboardAutoRefresh",
            )
            .addItem(
              "대시보드 자동갱신 상태 확인",
              "partnerShowDashboardTriggerStatus",
            )
            .addItem("발주 현황 보기", "partnerShowOrderSummary")
            .addSeparator()
            .addItem("🔍 거래처코드 매핑 진단", "partnerDiagnoseCustCdMapping")
            .addItem("🔧 허브 발주업체명 일괄 보정 (B5 기준)", "partnerFixHubVendorLabels")
            .addSeparator()
            .addItem("코드변환 별칭 진단", "partnerDiagnoseAliasMap")
            .addItem("별칭맵 진단 (단가 미입력 확인)", "diagnosePepAliasMap")
            .addItem(
              "뷰어 익월단가 열 진단",
              "partnerDiagnoseViewerPriceColumns",
            )
            .addItem(
              "발주탭 헤더 일괄 검증",
              "partnerValidateAllOrderTabHeaders",
            )
            .addSeparator()
            .addItem(
              "월별 정산 Dry-run (미리보기)",
              "partnerDiagnoseMonthlyArchive",
            )
            .addSeparator()
            .addItem("허브 보관 후보 미리보기", "diagnoseHubArchiveCandidates")
            .addItem(
              "당일 발송완료건 → 아카이브",
              "archiveHubTodayShippedOrders",
            )
            .addSeparator()
            .addItem(
              "발주 수집 자동 켜기 (5분)",
              "partnerSetupAutoCollectTrigger",
            )
            .addItem("발주 수집 자동 끄기", "partnerRemoveAutoCollectTrigger")
            .addItem(
              "자동 수집 상태 확인",
              "partnerShowAutoCollectTriggerStatus",
            )
            .addSeparator()
            .addItem(
              "🔓 동기화 락 강제 해제 (stuck 복구용)",
              "adminForceReleaseSyncLock_",
            ),
        ),
    )
    .addToUi();
}
