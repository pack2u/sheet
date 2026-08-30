/**
 * [협력업체] 메뉴 등록  v6.0
 * 파일: _partnerMenu.gs
 *
 * v5.0  2026-06-23: 메뉴 2분할
 * v6.0  2026-08-28: 관리 메뉴를 파트별로 재편
 *
 * ── 두 메뉴의 경계 ──
 * 📦 대리발송 발주시스템 = **매일 순서대로 실행하는 것만.**
 *    숫자 배지(1️⃣~7️⃣)가 하루의 흐름이고, `└` 항목은 그 단계의 곁가지다.
 *    진단·설정·정비는 여기 두지 않는다. 매일 쓰지 않는 항목이 섞이면
 *    직원이 순서를 잃는다.
 * 💼 협력업체 관리 = 설정·점검·정비. **파트별 서브메뉴로만** 넣는다.
 *    최상위에 낱개 항목을 늘어놓지 않는다 — 종전에 그렇게 하다가
 *    「상태 확인 / 진단」 하나에 20개가 쌓여 무엇이 진단이고 무엇이
 *    데이터를 고치는 것인지 구분이 안 됐다.
 */
function registerPartnerMenu_() {
  var ui = SpreadsheetApp.getUi();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  📦 대리발송 발주시스템 — 매일 실행하는 것만
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ui.createMenu("📦 대리발송 발주시스템")

    // ── 발주 수집 ~ Push ──
    .addItem("1️⃣ 대리판매 발주수집", "partnerCollectOrdersOwner")
    .addItem("2️⃣ 이카운트 업로드용 판매현황 갱신", "partnerRebuildSalesUploadOwner")
    .addItem("🏝️ 도서산간 추가배송비 확인", "partnerCheckIslandShippingOwner")
    .addItem("3️⃣ 대리공급업체로 발주 Push", "partnerPushOrdersToExclusiveFormsOwner")
    .addItem("   └ 📋 임시기록 → 전용양식 Push", "partnerPushFromTempTabToExclusiveOwner")
    .addItem("   └ 🔧 임시기록 강제 재생성", "partnerRebuildTempRecordsOwner")
    .addItem("   └ 📮 전용양식 우편번호/택배비 채우기", "partnerJmFillZipAndShipping")
    .addSeparator()

    // ── 송장 ──
    // 사방넷 대량등록 탭은 5️⃣ 수집이 자동으로 다시 만든다. 수동 갱신은
    // 수집 없이 다시 만들 때만 쓰므로 관리 → 🚚 송장·택배사 설정 으로 옮겼다.
    .addItem("5️⃣ 허브로 송장 수집", "partnerFetchInvoicesOwner")
    .addItem("   └ 📥 사방넷 송장대량등록 엑셀 저장", "partnerExportSabangnetBulkExcel")
    .addItem("   └ 📬 송장매칭/엑셀저장", "openInvoiceMatchSidebar")
    .addItem("   └ 📧 냅킨코리아 Gmail 송장 수집", "partnerFetchInvoiceFromGmail_NK_Manual")
    .addItem("6️⃣ 폐기송장 적용", "partnerApplyVoidedInvoicesOwner")
    .addItem("7️⃣ 대리판매업체로 송장 배포", "partnerPushInvoicesOwner")
    .addSeparator()

    // ── 취소/반품 ──
    .addItem("🚫 취소/반품 수집 (접수탭→허브·발주·마감)", "partnerCollectCancelsOwner")
    .addItem("🚫 취소/반품 배포 (허브→업체시트)", "partnerPushCancelStatusOwner")
    .addSeparator()

    // ── 검증 ──
    .addItem("🔍 중복 발주 감지 (발주탭+전용양식)", "partnerCheckDuplicateOrdersOwner")
    .addItem("🕵️ 오전/오후 판매현황 중복 점검", "partnerCheckSalesDuplicatesOwner")
    .addItem("   └ 📅 날짜 지정 점검", "partnerCheckSalesDuplicatesForDate")
    .addSeparator()

    // ── 마감 ──
    .addSubMenu(
      ui.createMenu("📋 명세서 정리")
        .addItem("① 명세서 탭 생성 (현재 파일)", "partnerCreateStatementTabs")
        .addItem("② 원본 → 파싱", "partnerParseStatementFromRaw")
        .addItem("③ 비교·정리 실행", "partnerRunStatementReconcile")
        .addSeparator()
        .addItem("📧 Gmail 첨부 수집 (현재 파일)", "partnerFetchStatementFromGmail")
        .addItem("🧪 명세서 사전점검", "partnerDiagnoseStatementReconcile")
        .addItem("🧪 Gmail 미처리 점검", "partnerDiagnoseStatementGmail")
    )
    .addSubMenu(
      ui.createMenu("📋 마감탭 정리")
        .addItem("📦 대리판매 발주 마감이동", "partnerArchiveToMonthlySettle")
        .addItem("🏭 대리공급 발주 마감이동", "partnerArchiveExclusiveForm")
        .addSeparator()
        .addItem("📋 통합 일일마감 (수동)", "partnerUnifiedDailyArchiveManual")
        .addItem("📋 일일마감 재처리 (날짜 지정)", "partnerUnifiedDailyArchiveForDate")
        .addItem("🗂️ 일일마감 파일 폴더 정리 (일회성)", "partnerMoveDailyCloseFilesToSubFolder")
        .addItem("📒 송장원장 갱신", "partnerRefreshInvoiceLedger")
        .addItem("🗂️ 통합조회 재생성 (CS 조회용)", "partnerRebuildUnifiedView")
        .addItem("📞 CS 주문/송장 검색 웹앱", "partnerOpenCsOrderSearchApp")
        .addSeparator()
        .addItem("🔄 취소/반품 수식 갱신", "partnerRefreshCancelReturnFormulas")
        .addItem("🔧 월별 마감 탭 레이아웃 보정", "partnerRepairMonthlySettleTabs")
        .addItem("🔧 마감 정산금액 보정 (단가×수량)", "partnerRepairArchiveLineTotals")
    )
    .addToUi();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  💼 협력업체 관리 — 설정 · 점검 · 정비
  //
  //  파트 순서는 「무엇을 다루는가」로 잡았다.
  //    업체 시트 → 단가 → 명세서 → 반품포털   (업체를 향한 것)
  //    송장·택배사 → 송장 매칭                (마감을 향한 것)
  //    진단 → 데이터 보정                     (문제를 볼 때 / 고칠 때)
  //    정산 검증 → DB → 자동화 → 권한         (그 밖)
  //
  //  ★ 진단과 보정을 갈라 두었다. 「진단」은 읽기만 하고 「보정」은 쓴다.
  //    섞여 있으면 눈으로 보려다 데이터를 고치게 된다.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ui.createMenu("💼 협력업체 관리")

    // ─────────── 업체를 향한 것 ───────────
    .addSubMenu(
      ui.createMenu("🏢 업체 시트")
        .addItem("➕ 시트 생성 (표준)", "partnerCreateSheet")
        .addItem("➕ 시트 생성 (소비자용)", "partnerCreateConsumerSheet")
        .addItem("➕ 시트 생성 (단가조회 전용)", "partnerCreateViewerOnlySheet")
        .addItem("🔄 일반 → 소비자용 전환", "partnerConvertToConsumer")
        .addSeparator()
        .addItem("🔧 업체시트 관리·복구 (증상별)", "openRepairDialog")
        .addItem("📝 발주탭 수식 복구 (업체 선택)", "partnerMigrateToNewArrayFormulaOwner")
        // 명세서 **운영**(①②③·Gmail 수집·사전점검)은 발주시스템 메뉴에 있다.
        // 여기에는 전체 업체를 한 번에 세팅하는 것만 둔다 — 같은 항목을 두 메뉴에
        // 걸어 두면 직원이 어느 쪽을 눌러야 하는지 매번 고민한다.
        .addItem("📋 명세서 탭 일괄 생성 (전체 업체)", "partnerCreateStatementTabsAll")
        .addSeparator()
        .addItem("🔄 검색입력 탭만 갱신", "partnerRefreshSearchInputOnly")
        .addItem("💰 단가 새로고침 (빠른)", "partnerRefreshViewerPrices")
        .addItem("✂️ 발주탭 행 트림 (250행)", "partnerTrimOrderTabs")
        .addItem("🧹 발주탭 자동 정리 (빈행+복원)", "partnerCleanupOrderTabsOwner")
    )
    .addSubMenu(
      ui.createMenu("💰 통합 허브 단가 관리")
        .addItem("1️⃣ [허브] 데이터 허브 구축/재구성", "createStaticHub")
        .addItem("2️⃣ ⚡ [동기화] 상품정보 → 허브 단가 업데이트", "syncGroupPrices")
        .addItem("3️⃣ [통합] 상태/재고/단가 업데이트 + 배포", "syncStatusOnly")
        .addSeparator()
        .addItem("5️⃣ 🔄 [일괄 업데이트] 모든 배포 시트 양식 최신화", "updateAllVendorSheets")
        .addSeparator()
        .addItem("🔍 내 허브 주소 찾기", "findMyHub")
        .addItem("✨ 시스템 설정 전체 초기화", "resetSystem")
    )
    .addSubMenu(
      ui.createMenu("🔁 협력업체 반품 포털")
        .addItem("⚙️ 포털 URL 등록", "partnerPortalSetUrl")
        .addItem("📋 업체명 목록 확인", "partnerPortalListVendors")
        .addItem("🔄 업체 목록 동기화 (체크 선택)", "partnerPortalSyncVendors")
        .addItem("🔑 접속 링크 발급 / 재발급", "partnerPortalIssueLink")
        .addItem("🗑 계정 행 삭제 (토큰 미발급만)", "partnerPortalRemoveAccounts")
        .addSeparator()
        .addItem("🚦 접속 차단 / 해제", "partnerPortalToggleActive")
        .addItem("📊 포털 활동 보기", "partnerPortalShowActivity")
        .addItem("🧪 포털 설정 점검", "partnerPortalDiagnose")
        .addSeparator()
        .addItem("🧱 반품송장번호 열 추가 (맨 끝)", "partnerPortalEnsureReturnInvoiceColumn")
        .addItem("📤 과거 반품송장 이관 (미리보기)", "partnerPortalMigrateReturnInvoicePreview")
        .addItem("📤 과거 반품송장 이관 (반영)", "partnerPortalMigrateReturnInvoiceApply")
        .addItem("🔽 업체명 드롭다운 적용", "partnerPortalApplyVendorValidation")
    )
    .addSeparator()

    // ─────────── 마감을 향한 것 ───────────
    .addSubMenu(
      ui.createMenu("🚚 송장·택배사 설정")
        .addItem("🚚 업체 택배사 표 생성/점검", "partnerEnsureVendorCarrierTable")
        .addItem("📦 일일마감 택배사 채움률 점검", "partnerDiagnoseArchiveCarrier")
        .addItem("🏭 출고지 마스터 점검 (평택=롯데 / 대리발송=업체)", "partnerDiagnoseShipOrigin")
        .addItem("⏪ 지난 일일마감에 택배사 채우기", "partnerBackfillArchiveCarrier")
        .addSeparator()
        .addItem("📋 사방넷 송장대량등록 탭 갱신", "partnerRebuildSabangnetBulkUpload")
        .addItem("🔧 사방넷_송장매칭 열배열(롯데) 적용", "partnerApplySabangnetLotteHeaders")
        .addItem("🚚 롯데 송장탭 열 위치 확인", "partnerInspectLotteInvoiceColumns")
        .addSeparator()
        .addItem("📒 송장원장 재수집 (커서 초기화)", "partnerResetInvoiceLedgerCursors")
    )
    .addSubMenu(
      ui.createMenu("🧭 송장 매칭 점검·정비")
        // ── 왜 안 붙었나 (읽기 전용) ──
        .addItem("🪪 고유ID 인식 점검", "partnerDiagnoseUidRecognition")
        .addItem("🔎 일일마감 미매칭 원인 진단", "partnerDiagnoseUnifiedUnmatched")
        .addItem("🔑 보조키(이름·전화앞7·주소·품목) 매칭 진단", "partnerDiagnoseAuxKeys")
        .addItem("⚖️ 허브 송장 배정 근거 점검", "partnerDiagnoseCollectEvidence")
        .addItem("📋 대리공급_임시기록 송장 점검", "partnerDiagnoseTempInvoiceData")
        .addSeparator()
        // ── 남의 송장이 붙었나 (읽기 전용) ──
        .addItem("🧭 송장 소유권 점검 (남의 송장 붙었는지)", "partnerDiagnoseInvoiceOwnership")
        .addItem("   └ 📅 기간 지정 점검", "partnerDiagnoseInvoiceOwnershipForDays")
        .addSeparator()
        // ── 고치기 (쓴다) ──
        .addItem("1️⃣ 일일마감 송장 재매칭 미리보기 (2주)", "partnerPreviewArchiveInvoiceRefix")
        .addItem("2️⃣ 일일마감 송장 재매칭 반영 (2주)", "partnerApplyArchiveInvoiceRefix")
        .addItem("3️⃣ 지정일 송장 재매칭", "partnerFillUnmatchedArchiveForDate")
        .addItem("🧹 일일마감 수량초과 송장 정리", "partnerPurgeArchiveQtyOverflow")
    )
    .addSeparator()

    // ─────────── 문제를 볼 때 / 고칠 때 ───────────
    .addSubMenu(
      ui.createMenu("📊 상태 확인 / 진단")
        .addItem("🩺 Push 시스템 통합 진단", "partnerDiagnosePushSystem")
        .addItem("🧪 오전/오후 중복 점검 진단", "partnerDiagnoseSalesDuplicates")
        .addItem("📋 월별 정산 Dry-run (미리보기)", "partnerDiagnoseMonthlyArchive")
        .addSeparator()
        .addItem("📊 협력업체 상태 대시보드 갱신", "partnerShowStatusDashboard")
        .addItem("📈 발주 현황 보기", "partnerShowOrderSummary")
        .addItem("🏆 베스트 고객 분석", "partnerBestCustomerAnalysis")
        .addSeparator()
        .addItem("🔔 Google Chat 알림 테스트", "chatNotifyTest")
    )
    .addSubMenu(
      ui.createMenu("🔧 데이터 보정 / 서식")
        // ★ 여기 있는 것은 전부 **데이터를 고친다.** 보기만 하려면 위 진단으로.
        .addItem("🔧 허브 발주업체명 일괄 보정 (B5 기준)", "partnerFixHubVendorLabels")
        .addItem("🔧 허브 단가 보정 (수량×단가→개별단가)", "partnerFixHubUnitPrices")
        .addItem("🧹 허브 상태열 드롭다운 정리 (잔여 규칙 제거)", "partnerClearHubStatusDropdowns")
        .addSeparator()
        .addItem("🔧 전용양식 헤더 일괄 업데이트", "partnerRepairExclusiveFormHeaders")
        .addItem("🔧 뷰어 3행 수식 일괄 복구", "partnerRepairAllViewerRow3Formulas")
        .addItem("📋 뷰어탭 이름 통일 + A열 마이그레이션", "partnerUnifyViewerTabNameOwner")
        .addSeparator()
        .addItem("🎨 발주탭 상태색 재적용 (전체 업체)", "partnerReapplyOrderTabCFR")
        .addItem("🎨 허브 상태색 재적용", "partnerReapplyHubCFOwner")
        .addItem("🎨 조건부서식 중복 정리 (허브+전체 업체)", "partnerDedupConditionalFormatsAll")
    )
    .addSeparator()

    // ─────────── 그 밖 ───────────
    .addSubMenu(
      ui.createMenu("📑 정산 비교 검증")
        .addSubMenu(
          ui.createMenu("📦 롯데택배 배송비 비교")
            .addItem("① 비교시트 만들기/열기", "partnerOpenLotteShipCompareSheet")
            .addItem("② 비교 실행", "partnerRunLotteShipCompare")
            .addSeparator()
            .addItem("🔧 비교시트 로컬메뉴 설치", "partnerInstallLotteShipCompareMenu")
        )
        .addSubMenu(
          ui.createMenu("📑 월마감↔이카운트 비교")
            .addItem("⚙ 설정(대상월) 열기", "partnerOpenSettleCompareSettings")
            .addItem("⚙ 전달로 맞추기(자동)", "partnerResetSettleCompareMonthToPrev")
            .addSeparator()
            .addSubMenu(
              ui.createMenu("📂 독립시트 검증")
                .addItem("① 비교시트 만들기/열기 (복수)", "partnerCreateSettleReconcileSheets")
                .addItem("② 월마감 불러오기 (복수)", "partnerCollectSettleForReconcile")
                .addItem("③ 비교 실행 (복수)", "partnerRunSettleReconcile")
                .addItem("④ 이카운트 기준 월마감 수정 (복수)", "partnerApplyEcountFixToArchiveBatch")
                .addSeparator()
                .addItem("🔧 비교시트에 로컬메뉴 설치(복수)", "partnerInstallCompareSheetMenus")
            )
            .addSubMenu(
              ui.createMenu("📋 상품정보시트 검증")
                .addItem("① 비교 탭 준비", "partnerHubPrepareCompareTabs")
                .addItem("② 월마감 불러오기", "partnerHubCollectSettleForReconcile")
                .addItem("③ 비교 실행", "partnerHubRunSettleReconcile")
                .addItem("④ 이카운트 기준 월마감 수정", "partnerHubApplyEcountFixToArchive")
                .addSeparator()
                .addItem("🔧 탭이름 정리(대사→비교)", "partnerRenameHubCompareTabs")
            )
        )
    )
    .addSubMenu(
      ui.createMenu("🗄️ DB 동기화 (Supabase)")
        .addItem("🔗 DB 연결 테스트", "testDbConnectionOwner")
        .addSeparator()
        .addItem("📦 상품정보 → DB 동기화", "syncProductsToDbOwner")
        .addItem("📋 발주허브 → DB 동기화", "syncOrdersToDbOwner")
        .addItem("🏢 협력업체 → DB 동기화", "syncVendorsToDbOwner")
        .addSeparator()
        .addItem("🔄 통합 DB 동기화 (발주+업체)", "syncAllToDbOwner")
        .addSeparator()
        .addItem("🔍 DB 품목 검색", "searchProductFromDbOwner")
        .addItem("📊 단가 이력 조회", "viewPriceHistoryOwner")
    )
    .addSubMenu(
      ui.createMenu("⚙️ 자동화 설정")
        .addItem("⏰ 통합 자동 트리거 설치 (전체)", "setupAllScheduledTriggers")
        .addItem("⏸ 통합 자동 트리거 제거 (전체)", "removeAllScheduledTriggers")
        .addItem("📋 자동 트리거 상태 확인", "showAllScheduledTriggerStatus")
        .addItem("🗓️ 주말·공휴일 차단 상태 확인", "partnerShowBlackoutStatus")
        .addSeparator()
        .addItem("✅ 허브 상태동기화 트리거 설치 (출고가능/품절)", "partnerSetupShipApprovalTrigger")
        .addItem("⏸ 허브 상태동기화 트리거 제거", "partnerRemoveShipApprovalTrigger")
    )
    .addSubMenu(
      ui.createMenu("🔑 권한 / 잠금 해제")
        .addItem("🔑 스크립트 권한 승인 (직원 최초 1회)", "partnerAuthorizeForStaff")
        .addSeparator()
        .addItem("🔓 동기화 락 강제 해제", "adminForceReleaseSyncLock_")
        .addItem("🛑 마감 백그라운드 강제 초기화", "partnerForceClearArchiveJobs_")
        .addItem("🛑 재설치 중단", "stopRepairScriptBatchOwner")
    )
    .addToUi();
}

// ═══════════════════════════════════════════
//  복구 다이얼로그
//  ★ 2026-07-03: UI 전면 개편 — 직원 친화적 증상 중심 메뉴
// ═══════════════════════════════════════════

/** 통합 복구 다이얼로그 (메뉴에서 호출) */
function openRepairDialog() { _openRepairDialog_(null); }

// ★ 하위 호환: 기존 개별 함수 유지 (외부 참조 방지)
function openRepairDialog_formula() { _openRepairDialog_("단가"); }
function openRepairDialog_header() { _openRepairDialog_("헤더"); }
function openRepairDialog_script() { _openRepairDialog_("스크립트"); }
function openRepairDialog_tabs() { _openRepairDialog_("탭"); }
function openRepairDialog_data() { _openRepairDialog_("헤더"); }

function openRepairDialog_order() { _openRepairDialog_("발주"); }

function _openRepairDialog_(preselect) {
  var html = HtmlService.createHtmlOutputFromFile("repairDialog")
    .setWidth(720)
    .setHeight(700);
  var titles = {
    "단가": "📊 단가조회 화면 복구",
    "헤더": "📋 양식·디자인 초기화",
    "스크립트": "🔧 상품검색 스크립트 재설치",
    "탭": "📑 탭 처음부터 다시 만들기",
    "발주": "📝 발주탭 수식 복구",
  };
  var defaultTitle = "🔧 업체시트 관리·복구";
  html.setTitle(titles[preselect] || defaultTitle);
  SpreadsheetApp.getUi().showModalDialog(html, titles[preselect] || defaultTitle);
}

// ═══════════════════════════════════════════
//  복구 다이얼로그용 서버 API
// ═══════════════════════════════════════════

/** HTML → 업체 파일 목록 반환 (체크박스용) */
function getRepairVendorList() {
  var files = _pt_listFiles();
  var prefixMap = {};
  try { prefixMap = _pep_buildPrefixToFileMap_(files); } catch (e) {}

  // prefix→id 역맵
  var idToPfx = {};
  for (var pfx in prefixMap) {
    if (prefixMap[pfx]) idToPfx[prefixMap[pfx].id] = pfx;
  }

  var result = [];
  for (var i = 0; i < files.length; i++) {
    var shortName = files[i].name.replace("[협력업체] ", "").trim();
    var pfxCode = idToPfx[files[i].id] || "";
    result.push({ id: files[i].id, name: shortName, pfx: pfxCode });
  }
  return result;
}

/** HTML → 복구 배치 실행 */
function executeRepairBatch(category, fileIds, extraOpts) {
  if (!fileIds || !fileIds.length) return { msg: "선택된 업체 없음" };

  var results = [];
  var ok = 0, fail = 0;

  switch (category) {
    case "formula":
      results = _repairBatch_formula_(fileIds);
      break;
    case "viewerFormula":  // ★ 2026-06-30: 단가조회 수식만
      results = _repairBatch_viewerFormula_(fileIds);
      break;
    case "orderFormula":   // ★ 2026-06-30: 발주탭 수식만
      results = _repairBatch_orderFormula_(fileIds);
      break;
    case "backfillDL":
      results = _repairBatch_backfillDL_(fileIds);
      break;
    case "header":
    case "data":
      results = _repairBatch_header_(fileIds);
      break;
    case "script":
      results = _repairBatch_script_(fileIds);
      break;
    case "tabs":
      results = _repairBatch_tabs_(fileIds, extraOpts || {});
      break;
    default:
      return { msg: "알 수 없는 카테고리: " + category };
  }

  for (var i = 0; i < results.length; i++) {
    if (results[i].indexOf("✅") !== -1 || results[i].indexOf("✔") !== -1) ok++;
    else if (results[i].indexOf("❌") !== -1) fail++;
  }

  return {
    msg: ok + "개 성공" + (fail > 0 ? ", " + fail + "개 실패" : "") + "\n\n" + results.join("\n"),
  };
}

// ═══════════════════════════════════════════
//  카테고리별 복구 배치 구현
// ═══════════════════════════════════════════

/** 1. 수식 전체 복구 (기존 호환 래퍼 — viewerFormula + orderFormula 순차 실행) */
function _repairBatch_formula_(fileIds) {
  var r1 = _repairBatch_viewerFormula_(fileIds);
  var r2 = _repairBatch_orderFormula_(fileIds);
  // 결과 병합
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var v = (r1[i] || "").replace(/^[✅✔❌⏭⚠️]\s*/, "");
    var o = (r2[i] || "").replace(/^[✅✔❌⏭⚠️]\s*/, "");
    var nm = v.split(" (")[0] || o.split(" (")[0] || fileIds[i].substring(0, 10);
    results.push("✅ " + nm + " (뷰어+발주)");
  }
  return results;
}

/** 1-A. 📊 단가조회 수식 복구 (뷰어 탭만) */
function _repairBatch_viewerFormula_(fileIds) {
  var hubId = _PT.HUB_ID;
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var logs = [];

      // 단가조회(뷰어) 탭만 접근
      var viewer = _pt_findViewerSheet(ss);
      if (!viewer) { results.push("⏭ " + nm + " (뷰어탭 없음)"); continue; }

      var K2 = parseInt(viewer.getRange("K2").getValue(), 10);
      if (K2 && !isNaN(K2)) {
        _pt_repairViewerSheetCore_(ss, nm, viewer, K2, hubId);
        logs.push("뷰어수식");
      } else {
        logs.push("K2없음-스킵");
      }

      // AA1 거래처명 수식 보정
      try {
        var aa1V = String(viewer.getRange("AA1").getValue() || "").trim();
        var aa1F = String(viewer.getRange("AA1").getFormula() || "");
        if (!aa1F || aa1V.indexOf("#REF") !== -1 || aa1V === "") {
          var st = ss.getSheetByName("설정");
          if (st) viewer.getRange("AA1").setFormula('=IFERROR(\'설정\'!B5, "")').setFontColor("white");
          logs.push("AA1보정");
        }
      } catch (eAA1) {}

      results.push("✅ " + nm + " (" + logs.join(", ") + ")");
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 40));
    }
  }
  return results;
}

/** 1-B. 📝 발주탭 자동입력 복구 (수집 직전 채움 모드) */
function _repairBatch_orderFormula_(fileIds) {
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var r = _pt_repairOrderTabCollectMode_(ss);
      if (!r.ok) {
        results.push("⏭ " + nm + " (" + (r.msg || "발주탭 없음") + ")");
      } else {
        results.push("✅ " + nm + " (" + r.msg + ")");
      }
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 40));
    }
  }
  return results;
}

/** ★ 품목명·단가 빈칸 채우기 (수집과 동일 로직) */
function _repairBatch_backfillDL_(fileIds) {
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var r = _pt_repairOrderTabCollectMode_(ss);
      if (!r.ok) {
        results.push("⏭ " + nm + " (" + (r.msg || "발주탭 없음") + ")");
      } else if (r.filled > 0) {
        results.push("✅ " + nm + " (" + r.filled + "칸 채움)");
      } else {
        results.push("✔ " + nm + " (빈 항목 없음)");
      }
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 40));
    }
  }
  return results;
}

/** 2. 헤더·양식 복구 */
function _repairBatch_header_(fileIds) {
  var results = [];
  // ★ 2026-08-07: 헤더 텍스트만 덮어쓰면 열 밀림 시 데이터가 오라벨됨
  //   → _pt_normalizeOrderTabStructure_ + 수식복구가 열삽입·헤더·수식을 일괄 처리
  var defaultH =
    typeof _PT_ORDER_TAB_HEADERS_ !== "undefined"
      ? _PT_ORDER_TAB_HEADERS_
      : [
          "거래처명(자동)", "주문일자(자동)", "이카운트코드", "품목명(자동)",
          "수량", "수취인", "수취인전화번호", "수취인주소",
          "배송메시지", "적요", "송장번호", "정산금액(자동)",
          "고유ID(자동)", "상태(자동)", "도서산간배송비",
        ];

  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var logs = [];

      // ① 발주탭: 열 구조 정상화 → 수식·서식 복구
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (ot) {
        try {
          var rOrd = _pt_repairOrderTabCollectMode_(ss);
          if (rOrd.ok) logs.push("발주탭복구(" + (rOrd.msg || "") + ")");
          else logs.push("발주탭스킵");
        } catch (eInj) {
          // fallback: 헤더만이라도
          try {
            ot.getRange(1, 1, 1, defaultH.length).setValues([defaultH]);
            ot.getRange("1:1").setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
            ot.setFrozenRows(1);
            logs.push("발주헤더(폴백)");
            if (typeof _pt_applyOrderTabDesign === "function") {
              _pt_applyOrderTabDesign(ot);
              logs.push("조건부서식");
            }
          } catch (_) {}
        }
      }

      // ③ 전용양식 헤더 + 조건부서식 복구
      try {
        var tabs = ss.getSheets();
        for (var ti = 0; ti < tabs.length; ti++) {
          if (tabs[ti].getName().indexOf("전용양식") !== -1) {
            var exTab = tabs[ti];
            // 조건부서식 전체 제거 (수동 추가된 색상스케일 등 초기화)
            exTab.clearConditionalFormatRules();
            // 헤더(1행) 스타일 재적용
            var exLc = Math.max(exTab.getLastColumn(), 1);
            exTab.getRange(1, 1, 1, exLc)
              .setBackground("#4a148c")
              .setFontColor("white")
              .setFontWeight("bold");
            exTab.setFrozenRows(1);
            logs.push("전용양식서식");
          }
        }
      } catch (eEx) {}


      // ④ 발주마감 탭 이름 오류 확인
      try {
        var PAT = /^\((\d+)년\s*(\d+)월\)\s*발주\s*마감$/;
        var allTabs = ss.getSheets();
        for (var mti = 0; mti < allTabs.length; mti++) {
          var tabName = allTabs[mti].getName();
          var match = PAT.exec(tabName);
          if (!match) continue;
          var yr = parseInt(match[1], 10);
          var mo = parseInt(match[2], 10);
          if (yr < 2000 || yr > 2099 || mo < 1 || mo > 12) {
            logs.push("마감탭이름오류감지");
            break;
          }
        }
      } catch (eMal) {}

      // ⑤ 월별 마감 탭 레이아웃 보정
      try {
        if (typeof _pms_ensureTabLayout_ === "function") {
          var monthTabs = ss.getSheets().filter(function(t) {
            return t.getName().indexOf("발주 마감") !== -1;
          });
          for (var mt = 0; mt < monthTabs.length; mt++) {
            _pms_ensureTabLayout_(monthTabs[mt]);
          }
          if (monthTabs.length > 0) logs.push("마감레이아웃");
        }
      } catch (eLayout) {}

      // ⑥ B6 거래처코드 서식 보정 (★ 데이터 보정에서 흡수)
      try {
        var st = ss.getSheetByName("설정");
        if (st) {
          var currentVal = String(st.getRange("B6").getDisplayValue() || "").trim();
          st.getRange("B6").setNumberFormat("@");
          if (currentVal) st.getRange("B6").setValue(currentVal);
          logs.push("B6서식");
        }
      } catch (eB6) {}

      results.push("✅ " + nm + " (" + logs.join(", ") + ")");
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 40));
    }
  }
  return results;
}

/** 3. 스크립트 재설치 */
/** 개별 업체 자동완성 스크립트 설치 (createViewerNoticeScript_ 래핑) */
function _pd_installVendorAutofillScript_(ss, fileId) {
  if (typeof createViewerNoticeScript_ === "function") {
    createViewerNoticeScript_(ss);
  } else {
    throw new Error("createViewerNoticeScript_ 함수를 찾을 수 없습니다.");
  }
}

function _repairBatch_script_(fileIds) {
  // ★ 2026-06-30: 10개씩 분할 실행 — 나머지는 자동 연속 트리거
  var BATCH_SIZE = 10;
  var props = PropertiesService.getScriptProperties();

  if (fileIds.length <= BATCH_SIZE) {
    // 10개 이하: 바로 실행
    var results = _repairBatch_script_core_(fileIds);
    props.deleteProperty("_REPAIR_SCRIPT_QUEUE");
    props.deleteProperty("_REPAIR_SCRIPT_RESULTS");
    return results;
  }

  // 10개 초과: 첫 배치 실행 + 나머지 큐에 저장
  var firstBatch = fileIds.slice(0, BATCH_SIZE);
  var remaining = fileIds.slice(BATCH_SIZE);
  var results = _repairBatch_script_core_(firstBatch);

  // 큐 + 누적 결과 저장
  props.setProperty("_REPAIR_SCRIPT_QUEUE", JSON.stringify(remaining));
  props.setProperty("_REPAIR_SCRIPT_RESULTS", JSON.stringify(results));

  // 1분 후 자동 실행 트리거 생성
  _repairScript_scheduleNext_();

  // 현재 배치 결과 + 안내 메시지 반환
  results.push("⏳ 나머지 " + remaining.length + "개 자동 실행 예정 (1분 후)");
  return results;
}

/** 스크립트 재설치 — 실제 실행 코어 (10개 이하) */
function _repairBatch_script_core_(fileIds) {
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();

      if (typeof _pd_installVendorAutofillScript_ === "function") {
        _pd_installVendorAutofillScript_(ss, fid);
        // ★ 2026-07-16: 구버전 입력차단 제거 후 발주탭도 수집모드로 정리
        try { _pt_repairOrderTabCollectMode_(ss); } catch (_) {}
        results.push("✅ " + nm);
      } else {
        results.push("⚠️ " + nm + " (설치 함수 없음)");
      }
    } catch (e) {
      var errMsg = String(e.message || "");
      if (errMsg.indexOf("429") !== -1) {
        Utilities.sleep(15000);
        try {
          var ss2 = SpreadsheetApp.openById(fid);
          var nm2 = ss2.getName().replace("[협력업체] ", "").trim();
          _pd_installVendorAutofillScript_(ss2, fid);
          try { _pt_repairOrderTabCollectMode_(ss2); } catch (_) {}
          results.push("✅ " + nm2 + " (재시도)");
        } catch (e2) {
          results.push("❌ " + fid.substring(0, 10) + "...: " + String(e2.message || "").substring(0, 60));
        }
      } else {
        results.push("❌ " + fid.substring(0, 10) + "...: " + errMsg.substring(0, 60));
      }
    }
    if (i < fileIds.length - 1) Utilities.sleep(8000);
  }
  return results;
}

/** 스크립트 재설치 — 자동 연속 트리거 스케줄링 */
function _repairScript_scheduleNext_() {
  // 기존 동일 트리거 정리
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === "_repairScript_continueAuto_") {
      try { ScriptApp.deleteTrigger(triggers[t]); } catch(eDel) {}
    }
  }

  // ★ 2026-07-06: 트리거 20개 제한 대응 — 초과 시 오래된 time-based 트리거 정리
  try {
    var allTriggers = ScriptApp.getProjectTriggers();
    if (allTriggers.length >= 19) {
      Logger.log("[REPAIR_SCRIPT] ⚠️ 트리거 " + allTriggers.length + "개 — 불필요 트리거 정리 시도");
      for (var ti = 0; ti < allTriggers.length; ti++) {
        var fn = allTriggers[ti].getHandlerFunction();
        // 일회성 트리거(after) 중 _repairScript_ 외 트리거는 건드리지 않음
        if (fn.indexOf("_repairScript_") !== -1 || fn.indexOf("_continueAuto") !== -1) {
          try { ScriptApp.deleteTrigger(allTriggers[ti]); } catch(e) {}
        }
      }
    }
  } catch(eTriggerClean) {
    Logger.log("[REPAIR_SCRIPT] 트리거 정리 실패: " + eTriggerClean.message);
  }

  // 3분 후 실행 트리거 생성
  try {
    ScriptApp.newTrigger("_repairScript_continueAuto_")
      .timeBased()
      .after(3 * 60 * 1000)
      .create();
    Logger.log("[REPAIR_SCRIPT] ✅ 3분 후 연속 실행 트리거 생성 완료");
  } catch(eCreate) {
    Logger.log("[REPAIR_SCRIPT] ❌ 트리거 생성 실패: " + eCreate.message);
    // 트리거 생성 실패 시 → 프로퍼티에 실패 표시
    try {
      PropertiesService.getScriptProperties().setProperty("_REPAIR_SCRIPT_TRIGGER_ERROR", eCreate.message);
    } catch(e) {}
  }
}

/** 스크립트 재설치 — 자동 연속 실행 (트리거에서 호출) */
function _repairScript_continueAuto_() {
  var props = PropertiesService.getScriptProperties();
  var queueJson = props.getProperty("_REPAIR_SCRIPT_QUEUE");
  var resultsJson = props.getProperty("_REPAIR_SCRIPT_RESULTS");

  if (!queueJson) return; // 큐 없으면 종료

  var queue = JSON.parse(queueJson);
  var prevResults = resultsJson ? JSON.parse(resultsJson) : [];

  if (queue.length === 0) {
    props.deleteProperty("_REPAIR_SCRIPT_QUEUE");
    props.deleteProperty("_REPAIR_SCRIPT_RESULTS");
    return;
  }

  var BATCH_SIZE = 3; // ★ 2026-07-01: 429 방지를 위해 10→3 축소
  var batch = queue.slice(0, BATCH_SIZE);
  var remaining = queue.slice(BATCH_SIZE);

  Logger.log("[REPAIR_SCRIPT] 자동 연속 실행: " + batch.length + "개 (남은: " + remaining.length + "개)");
  var batchResults = _repairBatch_script_core_(batch);
  var allResults = prevResults.concat(batchResults);

  if (remaining.length > 0) {
    // 아직 남음 → 큐 업데이트 + 다음 트리거
    props.setProperty("_REPAIR_SCRIPT_QUEUE", JSON.stringify(remaining));
    props.setProperty("_REPAIR_SCRIPT_RESULTS", JSON.stringify(allResults));
    _repairScript_scheduleNext_();
    Logger.log("[REPAIR_SCRIPT] 다음 배치 예약됨: " + remaining.length + "개 남음");
    // ★ 2026-07-06: 여기서 트리거 정리하면 안 됨! (방금 생성한 트리거 삭제됨)
  } else {
    // 완료 → 정리
    props.deleteProperty("_REPAIR_SCRIPT_QUEUE");
    props.deleteProperty("_REPAIR_SCRIPT_RESULTS");
    Logger.log("[REPAIR_SCRIPT] ✅ 전체 완료! 총 " + allResults.length + "개 처리");

    // 완료 알림 (Google Chat 또는 Toast)
    try {
      var ok = 0, fail = 0;
      for (var r = 0; r < allResults.length; r++) {
        if (allResults[r].indexOf("✅") !== -1) ok++;
        else if (allResults[r].indexOf("❌") !== -1) fail++;
      }
      if (typeof _pcn_sendChat_ === "function") {
        _pcn_sendChat_("🔧 스크립트 재설치 완료\n" + ok + "개 성공" + (fail > 0 ? ", " + fail + "개 실패" : "") + "\n\n" + allResults.join("\n"));
      }
    } catch(eChat) {}

    // ★ 2026-07-06: 완료 시에만 트리거 정리 (remaining > 0일 때는 정리하면 안 됨!)
    var triggers = ScriptApp.getProjectTriggers();
    for (var t = 0; t < triggers.length; t++) {
      if (triggers[t].getHandlerFunction() === "_repairScript_continueAuto_") {
        try { ScriptApp.deleteTrigger(triggers[t]); } catch(eDel) {}
      }
    }
  }
}

/** 4. 데이터 보정 */
function _repairBatch_data_(fileIds) {
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var logs = [];

      // ① 거래처코드(B6) 서식 수정 (선행0 보존)
      var st = ss.getSheetByName("설정");
      if (st) {
        var currentVal = String(st.getRange("B6").getDisplayValue() || "").trim();
        st.getRange("B6").setNumberFormat("@");
        if (currentVal) st.getRange("B6").setValue(currentVal);
        logs.push("B6서식" + (currentVal ? "(" + currentVal + ")" : ""));
      }

      // ② D/L열 값 기반 전환 후 수식 잔존 정리
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (ot) {
        // ★ 2026-06-17: heal은 수식·단가 복구에서만 실행 (중복 방지)
        // 데이터 보정에서는 B6 서식 보정만 수행
        logs.push("B6보정완료");
      }

      results.push("✅ " + nm + " (" + logs.join(", ") + ")");
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 40));
    }
  }

  return results;
}

/** 5. 탭 재생성 (단가조회/발주 및 송장조회) */
function _repairBatch_tabs_(fileIds, opts) {
  var hubId = _PT.HUB_ID;
  var results = [];
  // 기본값: 모두 true (opts가 비어있으면 전체 실행)
  var doViewer = (opts && opts.viewer !== undefined) ? opts.viewer : true;
  var doOrder  = (opts && opts.order !== undefined)  ? opts.order  : true;
  var doSearch = (opts && opts.search !== undefined) ? opts.search : true;
  var doScript = (opts && opts.script !== undefined) ? opts.script : true;

  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var logs = [];

      // ★ 업체명 추출 (설정탭 B5 → 파일명 파싱)
      var vendorName = "";
      var settingsTab = ss.getSheetByName("설정");
      if (settingsTab) {
        vendorName = String(settingsTab.getRange("B5").getValue() || "").trim();
      }
      if (!vendorName) {
        vendorName = nm.replace(/\s*\(소비자용\).*$/, "").trim();
      }

      // ★ K2 감지 (기존 뷰어 탭에서 읽거나, 허브 매핑 시트에서 찾기)
      var K2 = 0;
      var existingViewer = _pt_findViewerSheet(ss);
      if (existingViewer) {
        K2 = parseInt(existingViewer.getRange("K2").getValue(), 10) || 0;
      }

      // ★ 소비자가 모드 감지
      var isConsumer = (nm.indexOf("소비자용") !== -1);
      var dcMul = 1;
      if (isConsumer) {
        var dcRate = _pt_getConsumerRateFromK2(K2);
        if (dcRate > 0) dcMul = (100 - dcRate) / 100;
      }

      // K2가 없으면 허브에서 매핑 시트 탐색
      if (!K2 || K2 < 7) {
        try {
          var hubSs = _pt_getHubSS(hubId);
          var hubSheet = hubSs.getSheetByName("전체 그룹 단가표");
          if (hubSheet) {
            var hubHeaders = hubSheet.getRange(1, 1, 1, hubSheet.getLastColumn()).getValues()[0];
            var groups = _pt_buildHubGroupColumnMap(hubHeaders);
            // 업체명으로 그룹 매칭 시도
            for (var gName in groups) {
              if (vendorName.indexOf(gName) !== -1 || gName.indexOf(vendorName) !== -1) {
                K2 = groups[gName];
                break;
              }
            }
            // 그래도 없으면 첫 번째 그룹
            if (!K2 || K2 < 7) {
              for (var firstG in groups) { K2 = groups[firstG]; break; }
            }
          }
        } catch (eHub) {}
      }

      if (!K2 || K2 < 7) {
        results.push("⚠️ " + nm + " (K2 그룹 열을 찾을 수 없음 — 허브 확인 필요)");
        continue;
      }

      // ── ① 단가조회(뷰어) 탭 재생성 ──
      var viewerTab = _pt_findViewerSheet(ss);
      var viewerTabName = vendorName + " 뷰어";

      if (doViewer) {
        if (!viewerTab) {
          viewerTab = ss.insertSheet(viewerTabName);
          logs.push("뷰어탭 생성");
        } else {
          viewerTabName = viewerTab.getName();
          logs.push("뷰어탭 복구");
        }

        // Row 1: 공지
        _pt_ensureNoticeRowLinked(viewerTab, hubId);
        // Row 2: 헤더
        _pt_applyRow2(viewerTab, hubId, isConsumer, K2);
        // 스필 공간 확보
        _pt_clearSpillArea(viewerTab, isConsumer);
        // Row 3: 수식
        _pt_applyRow3Formulas(viewerTab, hubId, isConsumer, dcMul);
        // 디자인
        _pt_applyDesign(viewerTab);
        // 메타
        _pt_applyMetaCells(viewerTab, hubId, fid);
        // 보호+숨김
        _pt_protectAndHide(viewerTab);
      } else {
        // 뷰어 탭 건너뛰더라도 이름은 파악
        if (viewerTab) viewerTabName = viewerTab.getName();
      }

      // ── ② 발주 및 송장조회 탭 재생성 ──
      if (doOrder) {
        var orderTab = ss.getSheetByName("발주 및 송장조회");
        if (!orderTab) {
          _pt_createOrderTab(ss, vendorName, "", viewerTabName);
          logs.push("발주탭 생성");
        } else {
          var defaultH = [
            "거래처명(자동)", "주문일자(자동)", "이카운트코드", "품목명(자동)",
            "수량", "수취인", "수취인전화번호", "수취인주소",
            "배송메시지", "적요", "송장번호", "단가",
            "고유ID(자동)", "상태(자동)",
          ];
          orderTab.getRange(1, 1, 1, defaultH.length).setValues([defaultH]);
          orderTab.getRange("1:1").setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
          orderTab.setFrozenRows(1);
          _pt_applyOrderTabDesign(orderTab);
          // ★ 2026-07-16: 수집 직전 채움 모드 (실시간 차단/ARRAYFORMULA 없음)
          try { _pt_repairOrderTabCollectMode_(ss); } catch (eSpill) {}
          logs.push("발주탭 복구");
        }
      }

      // ── ③ 검색입력 탭 확보 ──
      if (doSearch) {
        try {
          if (!ss.getSheetByName("검색입력")) {
            _pt_createSearchInputTab_(ss);
            logs.push("검색입력탭 생성");
          }
        } catch (eSI) {}
      }

      // ── ④ 상품검색 스크립트 재설치 ──
      if (doScript) {
        try {
          if (typeof createViewerNoticeScript_ === "function") {
            createViewerNoticeScript_(ss);
            logs.push("상품검색 스크립트");
          }
        } catch (eScript) {
          logs.push("스크립트오류:" + String(eScript.message || "").substring(0, 20));
        }
      }

      results.push("✅ " + nm + " (K2=" + K2 + ", " + logs.join(", ") + ")");
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 60));
    }
  }

  return results;
}

/** [Owner] 재설치 작업 강제 중단 */
function stopRepairScriptBatchOwner() {
  if (!accessControl_isAdmin()) {
    SpreadsheetApp.getUi().alert("❌ 관리자 권한이 필요합니다.");
    return;
  }

  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("_REPAIR_SCRIPT_QUEUE");
  props.deleteProperty("_REPAIR_SCRIPT_RESULTS");

  // 예약된 트리거 삭제
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "_repairScript_continueAuto_") {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }

  SpreadsheetApp.getUi().alert("🛑 재설치 작업이 중단되었습니다.\n(큐 삭제 완료, 트리거 " + count + "개 제거)");
}
