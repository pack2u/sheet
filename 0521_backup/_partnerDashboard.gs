/**
 * ┌───────────────────────────────────────────────────────┐
 * │  [협력업체] 상태 대시보드                              │
 * │  파일: _partnerDashboard.gs                           │
 * │                                                       │
 * │  경영자 대시보드와 별개로 운영팀 전용                   │
 * │  각 업체의 K2·모드·발주현황·송장처리율을 한눈에 표시    │
 * └───────────────────────────────────────────────────────┘
 *
 * 주요 함수:
 *   partnerShowStatusDashboard()  — 대시보드 시트 생성/갱신
 */

// ═══════════════════════════════════════════
//  상수
// ═══════════════════════════════════════════
var _PD_SHEET_NAME = "협력업체_상태대시보드";
var _PD_HEADERS = [
  "순번",
  "업체명",
  "그룹(K2)",
  "모드",
  "단가조회\n수식",
  "총 발주\n(허브)",
  "미처리\n(송장없음)",
  "송장\n처리율",
  "마지막\n발주일",
  "당월\n정산탭",
  "파일 접근",
];

// 허브 헤더 인덱스 (협력업체_발주허브 탭 기준)
//  _PO_HUB_HEADERS = ["수집일시","발주업체","고유ID","주문일자",
//   "이카운트코드","품목명","수량","수취인","수취인전화번호",
//   "수취인주소","배송메시지","정산금액","적요","송장번호","상태"]
var _PD_HUB_COL_VENDOR = 1; // B: 발주업체
var _PD_HUB_COL_DATE = 3; // D: 주문일자
var _PD_HUB_COL_INVOICE = 13; // N: 송장번호

// ═══════════════════════════════════════════
//  메인: 협력업체 상태 대시보드 생성/갱신
// ═══════════════════════════════════════════
/**
 * 허브(협력업체_발주허브)에서 발주·송장 통계를 한 번에 읽고,
 * 각 협력업체 파일에서 K2·모드·정산탭 여부만 확인하여
 * "협력업체_상태대시보드" 탭에 표 형태로 출력한다.
 */
function partnerShowStatusDashboard() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var files = _pt_listFiles();

  if (files.length === 0) {
    if (ui)
      ui.alert(
        "협력업체 파일이 없습니다.\n폴더에 '[협력업체] ' 파일이 없습니다.",
      );
    return;
  }

  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var thisMonthPfx = Utilities.formatDate(
    new Date(),
    "Asia/Seoul",
    "yyyy년 M월",
  );

  // ── 1. 허브 발주 통계 수집 (한 번만 읽음) ──
  var orderStats = _pd_readHubStats_(ss);

  // ── 2. 대시보드 시트 준비 ──
  var dash = ss.getSheetByName(_PD_SHEET_NAME);
  if (!dash) {
    dash = ss.insertSheet(_PD_SHEET_NAME);
  } else {
    dash.clearContents();
    dash.clearFormats();
    dash.clearConditionalFormatRules();
  }

  // ── 3. 각 업체 파일에서 상태 수집 ──
  var rows = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var shortName = f.name.replace(_PT.PREFIX, "").trim();
    var row = _pd_collectFileStatus_(
      f,
      shortName,
      orderStats,
      thisMonthPfx,
      now,
      i + 1,
    );
    rows.push(row);
  }

  // ── 4. 시트 헤더 + 데이터 작성 ──
  _pd_writeSheet_(dash, rows, now, files.length);

  SpreadsheetApp.flush();
  dash.activate();

  if (ui) {
    ui.alert(
      "✅ 협력업체 상태 대시보드 갱신 완료",
      files.length +
        "개 업체 · " +
        now +
        "\n\n" +
        "※ 허브(협력업체_발주허브)에 없는 업체는 발주수 0으로 표시됩니다.",
      ui.ButtonSet.OK,
    );
  }
}

// ═══════════════════════════════════════════
//  내부: 허브에서 업체별 발주 통계 수집
// ═══════════════════════════════════════════
function _pd_readHubStats_(ss) {
  var stats = {}; // { 발주업체명: { total, invoiced, lastDate } }
  try {
    var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
    if (!hubTab || hubTab.getLastRow() < 2) return stats;

    var numCols = Math.max(_PO_HUB_HEADERS.length, hubTab.getLastColumn());
    var data = hubTab
      .getRange(2, 1, hubTab.getLastRow() - 1, numCols)
      .getValues();

    for (var i = 0; i < data.length; i++) {
      var vendorName = String(data[i][_PD_HUB_COL_VENDOR] || "").trim();
      if (!vendorName) continue;

      if (!stats[vendorName]) {
        stats[vendorName] = { total: 0, invoiced: 0, lastDate: "" };
      }
      stats[vendorName].total++;

      // 송장번호 있으면 처리 완료
      var inv = String(data[i][_PD_HUB_COL_INVOICE] || "").trim();
      if (inv && inv !== "-" && inv !== "폐기") {
        stats[vendorName].invoiced++;
      }

      // 마지막 발주일
      var d = data[i][_PD_HUB_COL_DATE];
      if (d) {
        var ds = "";
        try {
          // ★ 수정: new Date("20260508") 오파싱 → Date/문자열 분기 처리
          if (d instanceof Date) {
            ds = Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd");
          } else {
            var ds8 = String(d)
              .replace(/[^0-9]/g, "")
              .substring(0, 8);
            if (ds8.length === 8) {
              ds =
                ds8.substring(0, 4) +
                "-" +
                ds8.substring(4, 6) +
                "-" +
                ds8.substring(6, 8);
            } else {
              ds = String(d).substring(0, 10);
            }
          }
        } catch (eDateErr) {
          ds = String(d).substring(0, 10);
        }
        if (ds > stats[vendorName].lastDate) stats[vendorName].lastDate = ds;
      }
    }
  } catch (eHub) {
    Logger.log("[대시보드] 허브 읽기 실패: " + eHub.message);
  }
  return stats;
}

// ═══════════════════════════════════════════
//  내부: 개별 파일에서 상태 수집
// ═══════════════════════════════════════════
function _pd_collectFileStatus_(
  f,
  shortName,
  orderStats,
  thisMonthPfx,
  now,
  rowNum,
) {
  // row 구조: [순번, 업체명, K2, 모드, 수식상태, 총발주, 미처리, 처리율, 마지막발주일, 정산탭, 접근]
  var row = [rowNum, shortName, "", "", "", 0, 0, "-", "-", "?", "✅"];

  try {
    var fileSS = SpreadsheetApp.openById(f.id);

    // ─ 뷰어 탭 탐색 ─
    var viewerSheet = null;
    try {
      viewerSheet = _pt_findViewerSheet(fileSS);
    } catch (e) {}
    if (!viewerSheet)
      viewerSheet = fileSS.getSheetByName("단가조회") || fileSS.getSheets()[0];

    if (viewerSheet) {
      // K2 (그룹 열 번호)
      var K2val = viewerSheet.getRange("K2").getValue();
      row[2] =
        K2val && !isNaN(parseInt(K2val, 10)) ? String(K2val) : "❌ 미설정";

      // C3 수식 → 자동/수동 모드 판별
      var c3f = "";
      try {
        c3f = String(viewerSheet.getRange("C3").getFormula() || "");
      } catch (e) {}
      row[3] = c3f && c3f.indexOf("IMPORTRANGE") !== -1 ? "🔄 자동" : "✏️ 수동";

      // G3 수식 → 단가 수식 정상 여부
      var g3f = "";
      try {
        g3f = String(viewerSheet.getRange("G3").getFormula() || "");
      } catch (e) {}
      row[4] = g3f && g3f.indexOf("IMPORTRANGE") !== -1 ? "✅" : "⚠️ 없음";
    }

    // ─ 허브 기반 발주 통계 매핑 ─
    // 공식 업체명: 설정!B5 → 없으면 파일 단축명
    var officialName = shortName;
    try {
      var settingTab = fileSS.getSheetByName("설정");
      if (settingTab) {
        var b5 = String(settingTab.getRange("B5").getValue() || "").trim();
        if (b5) officialName = b5;
      }
    } catch (eS) {}

    var st = orderStats[officialName] ||
      orderStats[shortName] || { total: 0, invoiced: 0, lastDate: "" };

    row[5] = st.total;
    row[6] = st.total - st.invoiced;
    row[7] =
      st.total > 0 ? Math.round((st.invoiced / st.total) * 100) + "%" : "-";
    row[8] = st.lastDate || "-";

    // ─ 당월 정산탭 존재 여부 ─
    var allTabs = fileSS.getSheets();
    var hasMonth = false;
    for (var si = 0; si < allTabs.length; si++) {
      if (allTabs[si].getName().indexOf(thisMonthPfx) !== -1) {
        hasMonth = true;
        break;
      }
    }
    row[9] = hasMonth ? "✅ 있음" : "❌ 없음";
  } catch (eFile) {
    row[10] = "❌ " + String(eFile.message || "").substring(0, 25);
  }

  return row;
}

// ═══════════════════════════════════════════
//  내부: 시트에 데이터 + 서식 적용
// ═══════════════════════════════════════════
function _pd_writeSheet_(dash, rows, now, fileCount) {
  // ── 타이틀 행 (1행) ──
  dash
    .getRange(1, 1)
    .setValue("🏢 협력업체 상태 대시보드")
    .setFontSize(13)
    .setFontWeight("bold")
    .setFontColor("#1a237e");
  dash
    .getRange(1, 2)
    .setValue("📊 " + fileCount + "개 업체 · 갱신: " + now)
    .setFontColor("#555555")
    .setFontSize(10);

  // ── 헤더 행 (2행) ──
  var hRange = dash.getRange(2, 1, 1, _PD_HEADERS.length);
  hRange.setValues([_PD_HEADERS]);
  hRange
    .setBackground("#1a237e")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
  dash.setRowHeight(2, 48);

  // ── 데이터 행 (3행~) ──
  if (rows.length > 0) {
    dash.getRange(3, 1, rows.length, _PD_HEADERS.length).setValues(rows);
  }

  // ── 열 너비 ──
  var colWidths = [45, 170, 75, 75, 70, 70, 75, 75, 110, 85, 90];
  for (var ci = 0; ci < colWidths.length; ci++) {
    try {
      dash.setColumnWidth(ci + 1, colWidths[ci]);
    } catch (e) {}
  }

  // ── 행 높이 + 교호 배경 ──
  for (var ri = 0; ri < rows.length; ri++) {
    var rowIdx = 3 + ri;
    dash.setRowHeight(rowIdx, 30);
    var bg = ri % 2 === 0 ? "#f8f9fa" : "#ffffff";
    dash
      .getRange(rowIdx, 1, 1, _PD_HEADERS.length)
      .setBackground(bg)
      .setVerticalAlignment("middle")
      .setHorizontalAlignment("center");
    // 업체명은 좌정렬
    dash.getRange(rowIdx, 2).setHorizontalAlignment("left");
  }

  // ── 조건부 서식 ──
  var dataRange = dash.getRange(
    3,
    1,
    Math.max(rows.length, 1),
    _PD_HEADERS.length,
  );

  // 송장 처리율 100% → 녹색
  var r100 = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("100%")
    .setFontColor("#1b5e20")
    .setBackground("#e8f5e9")
    .setRanges([dash.getRange(3, 8, Math.max(rows.length, 1), 1)])
    .build();

  // 미처리 > 0 → 빨간 굵음
  var rPending = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0)
    .setFontColor("#b71c1c")
    .setBackground("#fce4e4")
    .setBold(true)
    .setRanges([dash.getRange(3, 7, Math.max(rows.length, 1), 1)])
    .build();

  // K2 미설정 → 노랑 경고
  var rK2 = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains("미설정")
    .setBackground("#fff9c4")
    .setFontColor("#e65100")
    .setRanges([dash.getRange(3, 3, Math.max(rows.length, 1), 1)])
    .build();

  // 파일 접근 오류 → 행 전체 연한 빨강
  var rErr = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=ISNUMBER(SEARCH("❌", $K3))')
    .setBackground("#fce4e4")
    .setRanges([dataRange])
    .build();

  dash.setConditionalFormatRules([r100, rPending, rK2, rErr]);

  // ── 고정 + 테두리 ──
  dash.setFrozenRows(2);
  try {
    var borderRange = dash.getRange(2, 1, rows.length + 1, _PD_HEADERS.length);
    borderRange.setBorder(
      true,
      true,
      true,
      true,
      true,
      true,
      "#cccccc",
      SpreadsheetApp.BorderStyle.SOLID,
    );
  } catch (e) {}

  // ── 요약 행 (마지막 + 2) ──
  var summaryRow = rows.length + 3;
  var totalOrders = rows.reduce(function (s, r) {
    return s + (r[5] || 0);
  }, 0);
  var totalPending = rows.reduce(function (s, r) {
    return s + (r[6] || 0);
  }, 0);
  var overallRate =
    totalOrders > 0
      ? Math.round(((totalOrders - totalPending) / totalOrders) * 100) + "%"
      : "-";

  dash
    .getRange(summaryRow, 1, 1, _PD_HEADERS.length)
    .merge()
    .setValue(
      "📋 전체 요약 — 총 발주: " +
        totalOrders +
        "건" +
        "  |  미처리: " +
        totalPending +
        "건" +
        "  |  전체 처리율: " +
        overallRate,
    )
    .setBackground("#e8eaf6")
    .setFontWeight("bold")
    .setFontColor("#1a237e")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  dash.setRowHeight(summaryRow, 32);
}

// ═══════════════════════════════════════════
//  대시보드 자동 갱신 트리거 관리
// ═══════════════════════════════════════════
var _PD_TRIGGER_PROP = "DASHBOARD_TRIGGER_ID";

/**
 * 대시보드 자동 갱신 트리거 설정
 */
function partnerSetupDashboardAutoRefresh() {
  var ui = SpreadsheetApp.getUi();

  var resp = ui.prompt(
    "⏰ 대시보드 자동 갱신 설정",
    "갱신 주기를 선택하세요:\n  15 = 15분마다\n  30 = 30분마다 (권장)\n  60 = 1시간마다",
    ui.ButtonSet.OK_CANCEL,
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var mins = parseInt(resp.getResponseText().trim(), 10);
  if (isNaN(mins) || [15, 30, 60].indexOf(mins) === -1) {
    ui.alert("15, 30, 60 중 하나를 입력하세요.");
    return;
  }

  _pd_removeExistingTrigger_();

  var trigger = ScriptApp.newTrigger("partnerShowStatusDashboard")
    .timeBased()
    .everyMinutes(mins)
    .create();

  PropertiesService.getScriptProperties().setProperty(
    _PD_TRIGGER_PROP,
    trigger.getUniqueId(),
  );

  ui.alert(
    "✅ 자동 갱신 설정 완료 — " +
      mins +
      "분마다 갱신\n\n" +
      "※ 업체 파일을 직접 열어야 해서 10개 업체 기준 약 30~60초 소요됩니다.\n" +
      "  너무 짧은 주기는 GAS 실행 한도(6분)에 걸릴 수 있습니다.",
  );
}

/** 자동 갱신 트리거 해제 */
function partnerRemoveDashboardAutoRefresh() {
  var ui = SpreadsheetApp.getUi();
  var removed = _pd_removeExistingTrigger_();
  ui.alert(
    removed
      ? "✅ 자동 갱신 트리거 해제 완료"
      : "ℹ️ 등록된 자동 갱신 트리거가 없습니다.",
  );
}

/** 현재 자동 갱신 상태 확인 */
function partnerShowDashboardTriggerStatus() {
  var ui = SpreadsheetApp.getUi();
  var allTriggers = ScriptApp.getProjectTriggers();
  var found = null;
  for (var i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() === "partnerShowStatusDashboard") {
      found = allTriggers[i];
      break;
    }
  }
  ui.alert(
    found
      ? "⏰ 자동 갱신: 활성 중\n함수: " + found.getHandlerFunction()
      : "⏸ 자동 갱신: 비활성\n\n진단·운영 → 대시보드 자동갱신 켜기 로 설정하세요.",
  );
}

function _pd_removeExistingTrigger_() {
  var allTriggers = ScriptApp.getProjectTriggers();
  var removed = false;
  for (var i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() === "partnerShowStatusDashboard") {
      ScriptApp.deleteTrigger(allTriggers[i]);
      removed = true;
    }
  }
  PropertiesService.getScriptProperties().deleteProperty(_PD_TRIGGER_PROP);
  return removed;
}
