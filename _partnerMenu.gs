/**
 * [협력업체] 메뉴 등록  v5.0
 * 파일: _partnerMenu.gs
 *
 * v5.0  2026-06-23: 메뉴 2분할 재구성
 *       📦 대리발송 발주시스템 = 일상 실행 메뉴 (독립 최상위)
 *       💼 협력업체 관리 = 시트 관리 / 설정 / 진단 메뉴
 */
function registerPartnerMenu_() {
  var ui = SpreadsheetApp.getUi();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  📦 대리발송 발주시스템 — 일상 실행 메뉴
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ui.createMenu("📦 대리발송 발주시스템")

    // ── 발주 수집 ~ Push ──
    .addItem("1️⃣ 대리판매 발주수집", "partnerCollectOrdersOwner")
    .addItem("2️⃣ 이카운트 업로드용 판매현황 갱신", "partnerRebuildSalesUploadOwner")
    .addItem("   └ 🏝️ 도서산간 추가배송비 확인", "partnerCheckIslandShippingOwner")
    .addItem("3️⃣ 대리공급업체로 발주 Push", "partnerPushOrdersToExclusiveFormsOwner")
    .addItem("   └ 📋 임시기록 → 전용양식 Push", "partnerPushFromTempTabToExclusiveOwner")
    .addItem("   └ 🔧 임시기록 강제 재생성", "partnerRebuildTempRecordsOwner")
    .addItem("   └ 📮 전용양식 우편번호/택배비 채우기", "partnerJmFillZipAndShipping")
    .addSeparator()

    // ── 송장 ──
    .addItem("5️⃣ 허브로 송장 수집", "partnerFetchInvoicesOwner")
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
    .addSeparator()
    // ── 마감 ──
    .addSubMenu(
      ui.createMenu("📋 마감탭 정리")
        .addItem("📦 대리판매 발주 마감이동", "partnerArchiveToMonthlySettleOwner")
        .addItem("🏭 대리공급 발주 마감이동", "partnerArchiveExclusiveFormOwner")
        .addSeparator()
        .addItem("📋 통합 일일마감 (수동)", "partnerUnifiedDailyArchiveManual")
        .addSeparator()
        .addItem("🔄 취소/반품 수식 갱신", "partnerRefreshCancelReturnFormulas")
        .addItem("🔧 월별 마감 탭 레이아웃 보정", "partnerRepairMonthlySettleTabs")
    )
    .addToUi();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  💼 협력업체 관리 — 시트 관리 / 설정 / 진단
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ui.createMenu("💼 협력업체 관리")

    // ── 시트 생성/관리 ──
    .addItem("➕ 시트 생성 (표준)", "partnerCreateSheet")
    .addItem("➕ 시트 생성 (소비자용)", "partnerCreateConsumerSheet")
    .addItem("➕ 시트 생성 (단가조회 전용)", "partnerCreateViewerOnlySheet")
    .addItem("🔄 일반 → 소비자용 전환", "partnerConvertToConsumer")
    .addSeparator()

    // ── 복구/보정 ──
    .addItem("🔧 업체시트 관리·복구", "openRepairDialog")
    .addItem("🔄 검색입력 탭만 갱신", "partnerRefreshSearchInputOnly")
    .addItem("💰 단가 새로고침 (빠른)", "partnerRefreshViewerPrices")
    .addItem("✂️ 발주탭 행 트림 (250행)", "partnerTrimOrderTabs")
    .addItem("🧹 발주탭 자동 정리 (빈행+복원)", "partnerCleanupOrderTabsOwner")
    .addSeparator()

    // ── 통합 허브 단가 관리 ──
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
    .addSeparator()

    // ── 진단 / 현황 ──
    .addSubMenu(
      ui.createMenu("📊 상태 확인 / 진단")
        .addItem("🩺 Push 시스템 통합 진단", "partnerDiagnosePushSystem")
        .addItem("🔧 뷰어 3행 수식 일괄 복구", "partnerRepairAllViewerRow3Formulas")
        .addItem("📋 뷰어탭 이름 통일 + A열 마이그레이션", "partnerUnifyViewerTabNameOwner")
        .addItem("📊 발주탭 ARRAYFORMULA 일괄 전환 (속도 개선)", "partnerMigrateToNewArrayFormulaOwner")
        .addItem("🔧 전용양식 헤더 일괄 업데이트", "partnerRepairExclusiveFormHeaders")
        .addItem("📋 월별 정산 Dry-run (미리보기)", "partnerDiagnoseMonthlyArchive")
        .addSeparator()
        .addItem("🔧 허브 발주업체명 일괄 보정 (B5 기준)", "partnerFixHubVendorLabels")
        .addItem("🔧 허브 단가 보정 (수량×단가→개별단가)", "partnerFixHubUnitPrices")
        .addSeparator()
        .addItem("📊 협력업체 상태 대시보드 갱신", "partnerShowStatusDashboard")
        .addItem("📈 발주 현황 보기", "partnerShowOrderSummary")
        .addItem("🏆 베스트 고객 분석", "partnerBestCustomerAnalysis")
        .addSeparator()
        .addItem("🔔 Google Chat 알림 테스트", "chatNotifyTest")
    )
    .addSeparator()

    // ── ★ 2026-07-01: DB 동기화 (Supabase) ──
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
    .addSeparator()

    // ── 자동화 설정 ──
    .addSubMenu(
      ui.createMenu("⚙️ 자동화 설정")
        .addItem("⏰ 통합 자동 트리거 설치 (전체)", "setupAllScheduledTriggers")
        .addItem("⏸ 통합 자동 트리거 제거 (전체)", "removeAllScheduledTriggers")
        .addItem("📋 자동 트리거 상태 확인", "showAllScheduledTriggerStatus")
    )
    .addSeparator()

    // ── 권한/락 ──
    .addItem("🔑 스크립트 권한 승인 (직원 최초 1회)", "partnerAuthorizeForStaff")
    .addItem("🔓 동기화 락 강제 해제", "adminForceReleaseSyncLock_")
    .addItem("🛑 재설치 중단", "stopRepairScriptBatchOwner")
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

function _openRepairDialog_(preselect) {
  var html = HtmlService.createHtmlOutputFromFile("repairDialog")
    .setWidth(720)
    .setHeight(700);
  var titles = {
    "단가": "📊 단가조회 화면 복구",
    "헤더": "📋 양식·디자인 초기화",
    "스크립트": "🔧 상품검색 스크립트 재설치",
    "탭": "📑 탭 처음부터 다시 만들기",
    "발주": "📝 발주탭 자동입력 복구",
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

/** 1-B. 📝 발주탭 수식 복원 (발주탭 + 뷰어탭만) */
function _repairBatch_orderFormula_(fileIds) {
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var logs = [];

      var ot = ss.getSheetByName("발주 및 송장조회");
      if (!ot) { results.push("⏭ " + nm + " (발주탭 없음)"); continue; }

      var viewer = _pt_findViewerSheet(ss);
      var viewerName = viewer ? viewer.getName() : "단가조회";

      // L열 헤더 보정
      var lHeader = String(ot.getRange(1, 12).getValue() || "").trim();
      if (lHeader === "정산금액") { ot.getRange(1, 12).setValue("단가"); logs.push("L헤더"); }

      // spill heal
      var healResult = _pt_healOrderSpillFormulas(ot, viewerName);
      if (healResult.aFixed || healResult.lFixed || healResult.dFixed || healResult.nFixed) {
        logs.push("spill수식");
      }

      // D/L 백필
      if (viewer) {
        var bfResult = _pt_backfillOrderDL(ot, viewer);
        if (bfResult.filled > 0) logs.push("백필" + bfResult.filled + "행");
      }

      results.push("✅ " + nm + " (" + (logs.length > 0 ? logs.join(", ") : "이상없음") + ")");
    } catch (e) {
      results.push("❌ " + fid.substring(0, 10) + "...: " + String(e.message || "").substring(0, 40));
    }
  }
  return results;
}

/** ★ 2026-06-30: 빠른 품목명·단가 백필 전용 (수식 복구 없이 D/L만 채움) */
function _repairBatch_backfillDL_(fileIds) {
  var results = [];
  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var ss = SpreadsheetApp.openById(fid);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (!ot) { results.push("⏭ " + nm + " (발주탭 없음)"); continue; }

      var vTab = null;
      try { vTab = _pt_findViewerSheet(ss); } catch(e) {}
      if (!vTab) vTab = ss.getSheetByName("단가조회");
      if (!vTab) { results.push("⏭ " + nm + " (뷰어탭 없음)"); continue; }

      var bfResult = _pt_backfillOrderDL(ot, vTab);
      if (bfResult.filled > 0) {
        results.push("✅ " + nm + " (" + bfResult.filled + "행 채움)");
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
  var defaultH = [
    "거래처명(자동)", "주문일자(자동)", "이카운트코드", "품목명(자동)",
    "수량", "수취인", "수취인전화번호", "수취인주소",
    "배송메시지", "적요", "송장번호", "단가",
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

        // ★ 2026-07-15: ARRAYFORMULA 수식 재주입
        try {
          if (typeof _pt_injectOrderSpillFormulas === "function") {
            _pt_injectOrderSpillFormulas(ot);
            logs.push("수식복구");
          }
        } catch (eInj) {}
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
          // ★ 2026-07-03: D/L값 기반 전환 이후 수식→값 정리만 수행 (안전)
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
