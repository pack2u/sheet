/**
 * [협력업체] 메뉴 등록  v4.0
 * 파일: _partnerMenu.gs
 *
 * v4.0: 복구 메뉴 통합 — 수식·단가 / 헤더·양식 / 스크립트 / 데이터보정
 *       각 복구 항목은 HTML 다이얼로그(전체/선택 다중) 지원
 */
function registerPartnerMenu_() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu("💼 협력업체 관리")

    // ━━━ 대리발송 발주시스템(New) ━━━━━━━━━━━━━━━━━━━━━━━━
    .addSubMenu(
      ui
        .createMenu("📦 대리발송 발주시스템(New)")
        .addItem(
          "🔄 [일괄] 대리판매+대리공급+발주허브 순차적 마감이동 ",
          "partnerDailyArchiveAllOwner",
        )
        .addItem("1️⃣ 대리판매 발주수집 ", "partnerCollectOrdersOwner")
        .addItem(
          "2️⃣ 이카운트 업로드용 판매현황 갱신",
          "partnerRebuildSalesUploadOwner",
        )
        .addItem(
          "   └ 🏝️ 도서산간 추가배송비 확인",
          "partnerCheckIslandShippingOwner",
        )
        .addItem(
          "3️⃣ 대리공급업체로 발주 Push ",
          "partnerPushOrdersToExclusiveFormsOwner",
        )
        .addItem(
          "   └ 📋 임시기록 → 전용양식 Push",
          "partnerPushFromTempTabToExclusiveOwner",
        )
        .addItem(
          "   └ 📮 전용양식 우편번호/택배비 채우기",
          "partnerJmFillZipAndShipping",
        )
        .addSeparator()
        .addItem("5️⃣ 허브로 송장 수집 ", "partnerFetchInvoicesOwner")
        .addItem(
          "   └ 📬 카카오 송장매칭 (중앙 관리용)",
          "openInvoiceMatchSidebar",
        )
        .addItem(
          "   └ 📧 냅킨코리아 Gmail 송장 수집",
          "partnerFetchInvoiceFromGmail_NK_Manual",
        )
        .addItem("6️⃣ 폐기송장 적용", "partnerApplyVoidedInvoicesOwner")
        .addItem("7️⃣ 대리판매업체로 송장 배포", "partnerPushInvoicesOwner")
        .addSeparator()
        .addItem(
          "🚫 취소/반품 수집 (접수탭→허브·발주·마감)",
          "partnerCollectCancelsOwner",
        )
        .addItem("🚫 취소/반품 배포 (허브→업체시트)", "partnerPushCancelStatusOwner")
        .addSeparator()
        // ── 마감탭 관리
        .addSubMenu(
          ui
            .createMenu("📋 마감탭 정리")
            .addItem(
              "📦 대리판매 발주 마감이동",
              "partnerArchiveToMonthlySettleOwner",
            )
            .addItem(
              "🏭 대리공급 발주 마감이동",
              "partnerArchiveExclusiveFormOwner",
            )
            .addSeparator()
            .addItem(
              "📋 통합 일일마감 (수동)",
              "partnerUnifiedDailyArchiveManual",
            )
            .addSeparator()
            .addItem(
              "🔧 월별 마감 탭 레이아웃 보정",
              "partnerRepairMonthlySettleTabs",
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

    // ━━━ 🔧 관리/AS 도구 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ★ 2026-06-13 메뉴 재구성: 3단→2단, 역할 기반 분리
    .addSubMenu(
      ui
        .createMenu("🔧 관리/AS 도구")
        .addItem("➕ 시트 생성 (표준)", "partnerCreateSheet")
        .addItem("➕ 시트 생성 (소비자용)", "partnerCreateConsumerSheet")
        .addItem("➕ 시트 생성 (단가조회 전용)", "partnerCreateViewerOnlySheet")
        .addItem("🔄 일반 → 소비자용 전환", "partnerConvertToConsumer")
        .addSeparator()
        .addItem("📊 수식·단가 복구", "openRepairDialog_formula")
        .addItem("📋 헤더·양식 복구", "openRepairDialog_header")
        .addItem("📝 스크립트 재설치", "openRepairDialog_script")
        .addItem("🗃️ 데이터 보정", "openRepairDialog_data")
        .addItem("📑 탭 재생성", "openRepairDialog_tabs")
        .addSeparator()
        .addItem("🔄 전체 수식 갱신", "partnerForceUpdateAll")
        .addItem("🔄 검색입력 탭만 갱신", "partnerRefreshSearchInputOnly")
        .addItem("💰 단가 새로고침 (빠른)", "partnerRefreshViewerPrices")
        .addItem("🔑 뷰어 코드 → 수동 모드 전환", "partnerViewerCodeToManual")
        .addItem("✂️ 발주탭 행 트림 (250행)", "partnerTrimOrderTabs")
        .addSeparator()
        .addItem("🔓 단가조회 필터 허용 (보호→경고)", "partnerMigrateProtectionToWarning")
        .addItem("🔑 스크립트 권한 승인 (직원 최초 1회)", "partnerAuthorizeForStaff")
        .addItem("🔓 동기화 락 강제 해제 (stuck 복구용)", "adminForceReleaseSyncLock_")
        .addItem("⚙️ 스크립트 캐시 초기화", "adminClearSingleVendorScriptId"),
    )
    .addSeparator()

    // ━━━ 📊 상태 확인 / 진단 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    .addSubMenu(
      ui
        .createMenu("📊 상태 확인 / 진단")
        // ── 시스템 진단
        .addItem("🩺 Push 시스템 통합 진단", "partnerDiagnosePushSystem")
        .addItem("🔍 거래처코드 매핑 진단", "partnerDiagnoseCustCdMapping")
        .addItem("📋 발주탭 헤더 일괄 검증", "partnerValidateAllOrderTabHeaders")
        .addItem("🛡️ Spill Guard 수식보호 진단", "partnerDiagnoseSpillGuard")
        .addItem("🔍 전용양식 AX열 UID 누락 진단", "partnerDiagnoseExclusiveUid")
        .addItem("📋 코드변환 별칭 진단", "partnerDiagnoseAliasMap")
        .addItem("📋 별칭맵 진단 (단가 미입력 확인)", "diagnosePepAliasMap")
        .addItem("📋 뷰어 익월단가 열 진단", "partnerDiagnoseViewerPriceColumns")
        .addItem("📋 월별 정산 Dry-run (미리보기)", "partnerDiagnoseMonthlyArchive")
        .addSeparator()
        // ── 허브 보정
        .addItem("🔧 허브 발주업체명 일괄 보정 (B5 기준)", "partnerFixHubVendorLabels")
        .addItem("🔧 허브 단가 보정 (수량×단가→개별단가)", "partnerFixHubUnitPrices")
        .addItem("🔄 협력Push 초기화 → 재Push용", "partnerResetExclusivePushUids")
        .addSeparator()
        // ── 대시보드
        .addItem("📊 협력업체 상태 대시보드 갱신", "partnerShowStatusDashboard")
        .addItem("📈 발주 현황 보기", "partnerShowOrderSummary")
        .addItem("🏆 베스트 고객 분석", "partnerBestCustomerAnalysis")
        .addSeparator()
        // ── 알림
        .addItem("🔔 Google Chat 알림 테스트", "chatNotifyTest"),
    )
    .addSeparator()

    // ━━━ ⚙️ 자동화 설정 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    .addSubMenu(
      ui
        .createMenu("⚙️ 자동화 설정")
        .addItem("▶ 발주 수집 자동 켜기 (5분)", "partnerSetupAutoCollectTrigger")
        .addItem("⏸ 발주 수집 자동 끄기", "partnerRemoveAutoCollectTrigger")
        .addItem("📋 자동 수집 상태 확인", "partnerShowAutoCollectTriggerStatus")
        .addSeparator()
        .addItem("▶ 대리발주 자동 Push 켜기", "partnerEnableAutoPush")
        .addItem("⏸ 대리발주 자동 Push 끄기", "partnerDisableAutoPush")
        .addItem("📋 대리발주 자동 Push 상태 확인", "partnerShowAutoPushStatus")
        .addSeparator()
        .addItem("⏰ 냅킨코리아 Gmail 트리거 설치", "partnerSetupGmailInvoiceTrigger_NK")
        .addItem("⏸ 냅킨코리아 Gmail 트리거 제거", "partnerRemoveGmailInvoiceTrigger_NK")
        .addItem("📋 냅킨코리아 Gmail 트리거 상태", "partnerShowGmailInvoiceTriggerStatus_NK")
        .addSeparator()
        .addItem("⏰ 대시보드 자동갱신 켜기", "partnerSetupDashboardAutoRefresh")
        .addItem("⏸ 대시보드 자동갱신 끄기", "partnerRemoveDashboardAutoRefresh")
        .addItem("📋 대시보드 자동갱신 상태 확인", "partnerShowDashboardTriggerStatus")
        .addSeparator()
        .addItem("폐기송장 자동조회 트리거 설치", "partnerSetupVoidAutoFillTrigger"),
    )
    .addToUi();
}

// ═══════════════════════════════════════════
//  복구 다이얼로그 열기 (카테고리별)
// ═══════════════════════════════════════════

/** 수식·단가 복구 다이얼로그 */
function openRepairDialog_formula() { _openRepairDialog_("formula"); }
/** 헤더·양식 복구 다이얼로그 */
function openRepairDialog_header() { _openRepairDialog_("header"); }
/** 스크립트 재설치 다이얼로그 */
function openRepairDialog_script() { _openRepairDialog_("script"); }
/** 데이터 보정 다이얼로그 */
function openRepairDialog_data() { _openRepairDialog_("data"); }
/** 탭 재생성 다이얼로그 */
function openRepairDialog_tabs() { _openRepairDialog_("tabs"); }

function _openRepairDialog_(preselect) {
  var html = HtmlService.createHtmlOutputFromFile("repairDialog")
    .setWidth(460)
    .setHeight(580);
  // 사전 선택 카테고리를 title에 포함하여 전달
  var titles = {
    formula: "🔧 수식·단가 복구",
    header: "🔧 헤더·양식 복구",
    script: "🔧 스크립트 재설치",
    data: "🔧 데이터 보정",
    tabs: "📑 탭 재생성",
  };
  html.setTitle(titles[preselect] || "🔧 복구 도구");
  SpreadsheetApp.getUi().showModalDialog(html, titles[preselect] || "🔧 복구 도구");
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
    case "header":
      results = _repairBatch_header_(fileIds);
      break;
    case "script":
      results = _repairBatch_script_(fileIds);
      break;
    case "data":
      results = _repairBatch_data_(fileIds);
      break;
    case "tabs":
      results = _repairBatch_tabs_(fileIds, extraOpts || {});
      break;
    default:
      return { msg: "알 수 없는 카테고리: " + category };
  }

  for (var i = 0; i < results.length; i++) {
    if (results[i].indexOf("✅") !== -1) ok++;
    else fail++;
  }

  return {
    msg: ok + "개 성공" + (fail > 0 ? ", " + fail + "개 실패" : "") + "\n\n" + results.join("\n"),
  };
}

// ═══════════════════════════════════════════
//  카테고리별 복구 배치 구현
// ═══════════════════════════════════════════

/** 1. 수식·단가 복구 */
function _repairBatch_formula_(fileIds) {
  var hubId = _PT.HUB_ID;
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var logs = [];

      // ① 단가조회(뷰어) 수식 복구
      var viewer = null;
      try { viewer = _pt_findViewerSheet(ss); } catch (e) {}
      if (!viewer) viewer = ss.getSheetByName("단가조회") || ss.getSheets()[0];
      if (viewer) {
        var K2 = parseInt(viewer.getRange("K2").getValue(), 10);
        if (K2 && !isNaN(K2)) {
          _pt_repairViewerSheetCore_(ss, nm, viewer, K2, hubId);
          logs.push("뷰어수식");
        } else {
          logs.push("K2없음-스킵");
        }
      }

      // ② 발주탭 spill 수식 heal
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (ot) {
        var viewerName = viewer ? viewer.getName() : "단가조회";

        // L열 헤더 보정
        var lHeader = String(ot.getRange(1, 12).getValue() || "").trim();
        if (lHeader === "정산금액") ot.getRange(1, 12).setValue("단가");

        // AA1 거래처명 수식 보정
        if (viewer) {
          try {
            var aa1V = String(viewer.getRange("AA1").getValue() || "").trim();
            var aa1F = String(viewer.getRange("AA1").getFormula() || "");
            if (!aa1F || aa1V.indexOf("#REF") !== -1 || aa1V === "") {
              var st = ss.getSheetByName("설정");
              if (st) viewer.getRange("AA1").setFormula('=IFERROR(\'설정\'!B5, "")').setFontColor("white");
            }
          } catch (eAA1) {}
        }

        var healResult = _pt_healOrderSpillFormulas(ot, viewerName);
        if (healResult.aFixed || healResult.lFixed || healResult.dFixed) {
          logs.push("spill수식");
        }
      }

      results.push("✅ " + nm + " (" + logs.join(", ") + ")");
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 40));
    }
  }
  return results;
}

/** 2. 헤더·양식 복구 */
function _repairBatch_header_(fileIds) {
  var results = [];
  var defaultH = [
    "거래처명(자동)", "주문일자(자동)", "이카운트코드", "품목명",
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

      // ① 발주탭 헤더 복구
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (ot) {
        ot.getRange(1, 1, 1, defaultH.length).setValues([defaultH]);
        ot.getRange("1:1").setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
        ot.setFrozenRows(1);
        logs.push("발주헤더");

        // ② 조건부서식 재적용
        try {
          if (typeof _pt_applyOrderTabDesign === "function") {
            _pt_applyOrderTabDesign(ot);
            logs.push("조건부서식");
          }
        } catch (eCfr) {}

        // spill 수식 재연결
        try {
          var viewerTab = _pt_findViewerSheet(ss);
          var viewerName = viewerTab ? viewerTab.getName() : "단가조회";
          _pt_healOrderSpillFormulas(ot, viewerName);
        } catch (eSpill) {}
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
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();

      // 자동완성 스크립트 재설치
      if (typeof _pd_installVendorAutofillScript_ === "function") {
        _pd_installVendorAutofillScript_(ss, fid);
        results.push("✅ " + nm + " (자동완성 스크립트)");
      } else {
        results.push("⚠️ " + nm + " (설치 함수 없음)");
      }
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 40));
    }
  }
  return results;
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

      // ② L열 단가 검증 (코드오류 정리)
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (ot) {
        // spill 수식 heal (CLEAN/TRIM 포함 최신 수식으로 교체)
        var viewerTab = _pt_findViewerSheet(ss);
        var viewerName = viewerTab ? viewerTab.getName() : "단가조회";
        var healResult = _pt_healOrderSpillFormulas(ot, viewerName);
        if (healResult.aFixed || healResult.lFixed || healResult.dFixed) {
          logs.push("수식갱신");
        }
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
            "거래처명(자동)", "주문일자(자동)", "이카운트코드", "품목명",
            "수량", "수취인", "수취인전화번호", "수취인주소",
            "배송메시지", "적요", "송장번호", "정산금액(자동)",
            "고유ID(자동)", "상태(자동)",
          ];
          orderTab.getRange(1, 1, 1, defaultH.length).setValues([defaultH]);
          orderTab.getRange("1:1").setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
          orderTab.setFrozenRows(1);
          _pt_applyOrderTabDesign(orderTab);
          try { _pt_injectOrderSpillFormulas(orderTab, viewerTabName); } catch (eSpill) {}
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
