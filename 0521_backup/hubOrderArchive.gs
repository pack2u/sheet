// =============================================================
// hubOrderArchive.gs
// 협력업체_발주허브 완료건 → 별도 월별 스프레드시트 아카이브
// (★ 2026-05-11 : 소스를 "통합 발주 DB" → "협력업체_발주허브"로 변경)
// =============================================================
//
// 이동 조건 (AND):
//   ① 주문일자(D열, index 3)가 오늘 이전(과거일)
//   ② 송장번호(N열, index 13) 있음  OR
//      상태(O열, index 14)에 "취소/품절/발송완료" 포함
//
// 저장 구조 (월별 1파일 — 월 1만 건 이상 대비):
//   부모 폴더 > "[Pack2U 통합발주 아카이브] 2026-03" (월별 1파일)
//             > "발주 아카이브" 탭  ← 파일당 탭 1개
//
// 협력업체_발주허브 헤더 (0-based):
//   0=수집일시, 1=발주업체, 2=고유ID, 3=주문일자,
//   4=이카운트코드, 5=품목명, 6=수량, 7=수취인,
//   8=수취인전화번호, 9=수취인주소, 10=배송메시지,
//   11=정산금액, 12=적요, 13=송장번호, 14=상태
// =============================================================

const HUB_ARCHIVE_SS_ID_PREFIX = "HUB_ARCHIVE_SS_ID_";
const HUB_ARCHIVE_SS_NAME_PREFIX = "[Pack2U 통합발주 아카이브] ";
const HUB_ARCHIVE_PARENT_FOLDER_PROP_KEY = "HUB_ARCHIVE_PARENT_FOLDER_ID";
const HUB_ARCHIVE_DEFAULT_FOLDER_ID = "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl";

// 협력업체_발주허브 열 인덱스 (0-based)
var _HA_COL_DATE    = 3;   // 주문일자
var _HA_COL_INVOICE = 13;  // 송장번호
var _HA_COL_STATUS  = 14;  // 상태
var _HA_HUB_NAME    = "협력업체_발주허브";

// ── 공개 진입점 ──────────────────────────────────────────────

/**
 * [Dry-run] 아카이브 이동 후보를 미리 보여줍니다 (실제 이동 없음).
 */
function diagnoseHubArchiveCandidates() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubSheet = ss.getSheetByName(_HA_HUB_NAME);
  if (!hubSheet) {
    SpreadsheetApp.getUi().alert("'" + _HA_HUB_NAME + "' 시트를 찾을 수 없습니다.");
    return;
  }

  var result = scanHubArchiveCandidates_(hubSheet);
  var candidates = result.candidates;
  var skipped = result.skipped;
  var totalData = hubSheet.getLastRow() - 1;

  if (candidates.length === 0) {
    SpreadsheetApp.getUi().alert(
      "ℹ️ 아카이브 이동 후보가 없습니다.\n\n" +
      "이동 조건: 오늘 이전 주문 + (송장번호 있음 OR 취소/품절/발송완료 상태)\n" +
      "현재 허브 총 데이터: " + totalData + "행\n" +
      "조건 미달(잔류 예정): " + skipped + "건"
    );
    return;
  }

  // 월별 집계
  var byMonth = {};
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    byMonth[c.yyyymm] = (byMonth[c.yyyymm] || 0) + 1;
  }

  var lines = ["📋 아카이브 이동 후보 요약 (Dry-run — 실제 이동 없음)\n"];
  lines.push("전체 이동 예정: " + candidates.length + "건");
  lines.push("이동 후 허브 잔류: " + (totalData - candidates.length) + "건");
  lines.push("\n[월별 분류]");
  var months = Object.keys(byMonth).sort();
  for (var m = 0; m < months.length; m++) {
    lines.push("  · " + months[m] + " → " + byMonth[months[m]] + "건");
  }
  lines.push("\n조건 미달(잔류): " + skipped + "건");
  lines.push("\n실제 이동: 메뉴 '📁 통합발주DB 완료건 → 아카이브 이동'을 실행하세요.");

  SpreadsheetApp.getUi().alert("허브 아카이브 진단", lines.join("\n"), SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 협력업체_발주허브에서 완료건을 별도 아카이브 스프레드시트로 이동합니다.
 */
function archiveHubIntegratedOrders() {
  var ui = SpreadsheetApp.getUi();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    ui.alert("⚠ 다른 아카이브 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  try {
    _archiveHubCore_(ui, { skipConfirm: false, silent: false, mode: "pastDone" });
  } finally {
    lock.releaseLock();
  }
}

/**
 * [수동] 당일 발송완료 건만 월별 통합 아카이브로 이동합니다.
 */
function archiveHubTodayShippedOrders() {
  var ui = SpreadsheetApp.getUi();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    ui.alert("⚠ 다른 아카이브 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  try {
    _archiveHubCore_(ui, { skipConfirm: false, silent: false, mode: "todayShipped" });
  } finally {
    lock.releaseLock();
  }
}

/**
 * [자동/트리거용] 확인창 없이 허브 아카이브를 실행합니다.
 */
function archiveHubIntegratedOrdersScheduled() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    try {
      appendAutomationEventLog_({
        jobType: "HUB_ARCHIVE",
        ok: false,
        code: "LOCK_BUSY",
        message: "다른 허브 아카이브 작업이 진행 중이라 자동 실행을 건너뜀",
      });
    } catch(e) {}
    return;
  }

  try {
    _archiveHubCore_(null, { skipConfirm: true, silent: true, mode: "pastDone" });
  } catch (e) {
    try {
      appendAutomationEventLog_({
        jobType: "HUB_ARCHIVE",
        ok: false,
        code: "RUNTIME_EXCEPTION",
        message: String(e && e.message ? e.message : e),
      });
    } catch(_) {}
  } finally {
    lock.releaseLock();
  }
}

// ── 핵심 로직 ─────────────────────────────────────────────────

function _archiveHubCore_(ui, options) {
  options = options || {};
  var silent = options.silent === true;
  var skipConfirm = options.skipConfirm === true;
  var mode = String(options.mode || "pastDone");
  var modeCfg = getHubArchiveModeConfig_(mode);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubSheet = ss.getSheetByName(_HA_HUB_NAME);
  if (!hubSheet) {
    if (ui && !silent) ui.alert("'" + _HA_HUB_NAME + "' 시트를 찾을 수 없습니다.");
    return;
  }

  // 1. 데이터 로드 + 후보 스캔
  var hubAllData = hubSheet.getDataRange().getValues();
  var result = scanHubArchiveCandidates_(hubSheet, hubAllData, mode);
  var candidates = result.candidates;

  if (candidates.length === 0) {
    if (ui && !silent) {
      ui.alert(
        "ℹ️ 아카이브 이동 후보가 없습니다.\n" +
        "조건: " + modeCfg.shortCondition
      );
    }
    return;
  }

  // 2. 사용자 확인
  var confirmMsg =
    "📁 " + modeCfg.confirmTitle + "\n\n" +
    "이동 대상: " + candidates.length + "건\n" +
    "이동 후 허브 잔류: " + (hubSheet.getLastRow() - 1 - candidates.length) + "건\n" +
    "\n계속 진행하시겠습니까?";

  if (!skipConfirm && ui) {
    if (ui.alert("아카이브 이동 확인", confirmMsg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  }

  // 3. 부모 폴더 확보
  var parentFolder;
  try {
    parentFolder = resolveHubArchiveParentFolder_(ss);
  } catch (e) {
    if (ui && !silent) {
      ui.alert(
        "❌ 아카이브 저장 폴더를 찾을 수 없습니다.\n" + e.message +
        "\n\n기본 폴더 ID(" + HUB_ARCHIVE_PARENT_FOLDER_PROP_KEY +
        ")를 스크립트 속성에 지정해주세요."
      );
    }
    return;
  }

  // 4. 월별 그룹화
  var byMonth = {}; // key: "2026-03", value: [candidate, ...]
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!byMonth[c.yyyymm]) byMonth[c.yyyymm] = [];
    byMonth[c.yyyymm].push(c);
  }

  // 아카이브 헤더 = 허브 헤더 + 부가 2컬럼
  var hubHeaders = hubAllData[0];
  var archHeaders = hubHeaders.concat(["아카이브일시", "아카이브사유"]);

  var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var archivedRowIndices = []; // hubAllData 기준 0-based 인덱스 (헤더=0)
  var totalArchived = 0;
  var archiveSsCache = {}; // "2026-03" → archSs

  // 5. 월별로 아카이브 파일/탭에 배치 기록
  var months = Object.keys(byMonth).sort();
  for (var mi = 0; mi < months.length; mi++) {
    var ym = months[mi];
    var group = byMonth[ym];

    if (!archiveSsCache[ym]) {
      try {
        archiveSsCache[ym] = getOrCreateHubArchiveSs_(parentFolder, ym);
      } catch (e) {
        if (ui && !silent) ui.alert("❌ " + ym + " 아카이브 파일 생성/접근 실패:\n" + e.message);
        try {
          appendAutomationEventLog_({
            jobType: "HUB_ARCHIVE", ok: false,
            code: "ARCHIVE_SS_FAIL", message: e.message
          });
        } catch(_) {}
        return;
      }
    }
    var archSs = archiveSsCache[ym];

    var archTab;
    try {
      archTab = getOrCreateHubArchiveDataTab_(archSs, archHeaders);
    } catch (e) {
      if (ui && !silent) ui.alert("❌ " + ym + " 데이터 탭 준비 실패:\n" + e.message);
      return;
    }

    // 아카이브 행 구성
    var appendRows = [];
    for (var gi = 0; gi < group.length; gi++) {
      var cand = group[gi];
      var hubRow = hubAllData[cand.hubRowIndex];
      appendRows.push(hubRow.concat([nowStr, cand.reason]));
      archivedRowIndices.push(cand.hubRowIndex);
    }

    // 아카이브 탭에 배치 append
    var nextRow = archTab.getLastRow() + 1;
    archTab
      .getRange(nextRow, 1, appendRows.length, archHeaders.length)
      .setValues(appendRows);
    totalArchived += appendRows.length;
  }

  // 6. flush → 아카이브 커밋 확인 후 허브 행 삭제
  SpreadsheetApp.flush();

  // 역순(내림차순) 정렬 후 연속 블록 묶어 deleteRows (인덱스 밀림 방지)
  archivedRowIndices.sort(function(a, b) { return b - a; });
  var deleteGroups = buildHubDeleteGroups_(archivedRowIndices);
  for (var di = 0; di < deleteGroups.length; di++) {
    var dg = deleteGroups[di];
    hubSheet.deleteRows(dg.start + 1, dg.count);
  }

  SpreadsheetApp.flush();

  // 7. 자동화 로그 기록
  try {
    appendAutomationEventLog_({
      jobType: "HUB_ARCHIVE",
      ok: true,
      code: modeCfg.logCode,
      message: "[" + modeCfg.logLabel + "] " + totalArchived + "건 아카이브 이동 완료"
    });
  } catch(_) {}

  if (ui && !silent) {
    ui.alert(
      "✅ 아카이브 완료!\n\n" +
      "실행 모드: " + modeCfg.logLabel + "\n" +
      "이동 건수: " + totalArchived + "건\n" +
      "허브 잔류: " + (hubSheet.getLastRow() - 1) + "건\n\n" +
      "저장 위치: 관리자 시트와 같은 폴더\n" +
      "파일명: \"" + HUB_ARCHIVE_SS_NAME_PREFIX + "YYYY-MM\" (월별 1파일)"
    );
  }
}

// ── 스캔 헬퍼 ─────────────────────────────────────────────────

/**
 * 협력업체_발주허브에서 아카이브 후보 행을 스캔합니다.
 * @param {Sheet} hubSheet
 * @param {Array[][]=} preloadedData  이미 로드된 2D 배열 (없으면 내부 로드)
 * @param {string=} mode "pastDone" | "todayShipped"
 * @returns {{ candidates: Array, skipped: number }}
 */
function scanHubArchiveCandidates_(hubSheet, preloadedData, mode) {
  var candidates = [];
  var skipped = 0;
  mode = String(mode || "pastDone");

  var lr = hubSheet.getLastRow();
  if (lr <= 1) return { candidates: candidates, skipped: 0 };

  var hubData = preloadedData || hubSheet.getDataRange().getValues();

  // 오늘 YYYYMMDD
  var todayYYYYMMDD = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");

  for (var r = 1; r < hubData.length; r++) {
    var row = hubData[r];

    // 주문일자 파싱 (index 3)
    var rawDate = row[_HA_COL_DATE];
    if (!rawDate) { skipped++; continue; }
    var dateStr = String(rawDate).replace(/[^0-9]/g, "").substring(0, 8);
    if (dateStr.length < 8) { skipped++; continue; }

    var orderYYYYMMDD = dateStr.substring(0, 8);
    var isPastDoneTarget = orderYYYYMMDD < todayYYYYMMDD;
    var isTodayTarget = orderYYYYMMDD === todayYYYYMMDD;

    // 완료 조건
    var invoiceVal = String(row[_HA_COL_INVOICE] || "").trim();
    var statusVal  = String(row[_HA_COL_STATUS]  || "").replace(/\s/g, "");

    var isDone =
      invoiceVal !== "" ||
      statusVal.indexOf("취소") !== -1 ||
      statusVal.indexOf("품절") !== -1 ||
      statusVal.indexOf("단종") !== -1 ||
      statusVal.indexOf("발송완료") !== -1;
    var isTodayShipped = statusVal.indexOf("발송완료") !== -1;

    if (mode === "todayShipped") {
      if (!(isTodayTarget && isTodayShipped)) { skipped++; continue; }
    } else {
      if (!(isPastDoneTarget && isDone)) { skipped++; continue; }
    }

    // 아카이브 사유
    var reason = "";
    if (mode === "todayShipped") {
      reason = "당일발송완료";
    } else {
      reason = invoiceVal !== ""
        ? "송장완료"
        : (statusVal.indexOf("취소") !== -1 ? "취소"
          : (statusVal.indexOf("품절") !== -1 ? "품절"
            : (statusVal.indexOf("단종") !== -1 ? "단종" : "발송완료")));
    }

    candidates.push({
      hubRowIndex: r,
      yyyymm: dateStr.substring(0, 4) + "-" + dateStr.substring(4, 6),
      reason: reason
    });
  }

  return { candidates: candidates, skipped: skipped };
}

function getHubArchiveModeConfig_(mode) {
  if (mode === "todayShipped") {
    return {
      shortCondition: "오늘 주문 + 상태에 발송완료",
      confirmTitle: "협력업체_발주허브 당일 발송완료건 월별DB 이동",
      logCode: "TODAY_SHIPPED",
      logLabel: "당일 발송완료",
    };
  }
  return {
    shortCondition: "오늘 이전 주문 + (송장번호 있음 OR 취소/품절/발송완료)",
    confirmTitle: "협력업체_발주허브 완료건 → 월별 아카이브 이동",
    logCode: "PAST_DONE",
    logLabel: "과거 완료건",
  };
}

/**
 * 허브 아카이브 저장 폴더를 안전하게 찾습니다.
 */
function resolveHubArchiveParentFolder_(ss) {
  if (HUB_ARCHIVE_DEFAULT_FOLDER_ID) {
    return DriveApp.getFolderById(HUB_ARCHIVE_DEFAULT_FOLDER_ID);
  }

  var props = PropertiesService.getScriptProperties();
  var forcedFolderId = String(props.getProperty(HUB_ARCHIVE_PARENT_FOLDER_PROP_KEY) || "").trim();
  if (forcedFolderId) {
    return DriveApp.getFolderById(forcedFolderId);
  }

  var file = DriveApp.getFileById(ss.getId());
  var parents = file.getParents();
  if (parents && parents.hasNext()) {
    return parents.next();
  }

  var fallbackId = "";
  if (typeof ORDER_TARGET_FOLDER_ID !== "undefined" && ORDER_TARGET_FOLDER_ID) {
    fallbackId = String(ORDER_TARGET_FOLDER_ID).trim();
  } else if (typeof TARGET_FOLDER_ID !== "undefined" && TARGET_FOLDER_ID) {
    fallbackId = String(TARGET_FOLDER_ID).trim();
  }
  if (fallbackId) {
    return DriveApp.getFolderById(fallbackId);
  }

  throw new Error("부모 폴더 iterator가 비어 있고, 대체 폴더 ID도 설정되지 않았습니다.");
}

// ── 아카이브 파일/탭 관리 ────────────────────────────────────

/**
 * 월별 아카이브 스프레드시트를 가져오거나 생성합니다.
 * 파일명: "[Pack2U 통합발주 아카이브] 2026-03"
 */
function getOrCreateHubArchiveSs_(parentFolder, yyyymm) {
  var props    = PropertiesService.getScriptProperties();
  var propKey  = HUB_ARCHIVE_SS_ID_PREFIX + yyyymm;
  var cachedId = props.getProperty(propKey);

  if (cachedId) {
    try {
      return SpreadsheetApp.openById(cachedId);
    } catch (e) {
      props.deleteProperty(propKey);
    }
  }

  var targetName = HUB_ARCHIVE_SS_NAME_PREFIX + yyyymm;
  var files = parentFolder.getFilesByName(targetName);
  if (files.hasNext()) {
    var file = files.next();
    props.setProperty(propKey, file.getId());
    return SpreadsheetApp.openById(file.getId());
  }

  var newSs   = SpreadsheetApp.create(targetName);
  var newFile = DriveApp.getFileById(newSs.getId());
  parentFolder.addFile(newFile);
  DriveApp.getRootFolder().removeFile(newFile);

  props.setProperty(propKey, newSs.getId());
  return newSs;
}

/**
 * 월별 아카이브 파일 내 단일 데이터 탭을 가져오거나 생성합니다.
 */
function getOrCreateHubArchiveDataTab_(archSs, headers) {
  var TAB_NAME = "발주 아카이브";
  var tab = archSs.getSheetByName(TAB_NAME);

  if (!tab) {
    var sheets = archSs.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      tab = sheets[0];
      tab.setName(TAB_NAME);
    } else {
      tab = archSs.insertSheet(TAB_NAME);
    }

    tab.getRange(1, 1, 1, headers.length).setValues([headers]);
    tab.getRange(1, 1, 1, headers.length)
      .setBackground("#1c4587")
      .setFontColor("white")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    tab.setFrozenRows(1);
  }

  return tab;
}

// ── 삭제 그룹화 유틸 ─────────────────────────────────────────

/**
 * 내림차순으로 정렬된 hubData 0-based 인덱스 배열을
 * 연속 블록(그룹)으로 묶어 반환합니다.
 */
function buildHubDeleteGroups_(sortedDescIndices) {
  var groups = [];
  if (!sortedDescIndices.length) return groups;

  var end   = sortedDescIndices[0];
  var start = sortedDescIndices[0];

  for (var i = 1; i < sortedDescIndices.length; i++) {
    if (sortedDescIndices[i] === start - 1) {
      start = sortedDescIndices[i];
    } else {
      groups.push({ start: start, count: end - start + 1 });
      end   = sortedDescIndices[i];
      start = sortedDescIndices[i];
    }
  }
  groups.push({ start: start, count: end - start + 1 });

  return groups;
}
