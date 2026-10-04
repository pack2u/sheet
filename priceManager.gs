/**
 * [Pack2U 기존 시스템 보호 및 정밀 수리본]
 * - 사장님의 '통합 허브(보라색)'와 '배포 시트' 연결을 절대 지우지 않습니다.
 * - #DIV/0! 오류 제거 및 ARRAYFORMULA 호환성 버그(OR 함수 불가) 완벽 수리
 * - '익월가 필터링(현재가와 같으면 숨김)' 로직 원상복구
 */

const TARGET_FOLDER_ID = "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl";
const MASTER_TEMPLATE_ID = "1UL96S9_mNpJF4Yyxye1fIljOp0pInx-ps03N-NrILho"; // ★ 2026-07-15: 신규 템플릿으로 교체
const DEPLOY_SHEET_SCHEMA_VERSION = "2026.04.21.1";
// 주의: AD1~AH1은 매핑(AA1~AH1) 진단/IMPORTRANGE 영역과 충돌하므로 메타 전용 셀을 분리한다.
const DEPLOY_META_SCHEMA_CELL = "N1";
const DEPLOY_META_TYPE_CELL = "O1";
const DEPLOY_META_DC_RATE_CELL = "P1";
const DEPLOY_META_NOTICE_SCRIPT_CELL = "Q1";
const DEPLOY_META_UPDATED_AT_CELL = "R1";
// 레거시(충돌) 메타 셀: 과거 값 읽기용 fallback
const DEPLOY_META_SCHEMA_CELL_LEGACY = "AD1";
const DEPLOY_META_TYPE_CELL_LEGACY = "AE1";
const DEPLOY_META_DC_RATE_CELL_LEGACY = "AF1";
const DEPLOY_META_UPDATED_AT_CELL_LEGACY = "AH1";
const DEPLOY_LOCAL_SETTINGS_TAB_NAME = "설정";
const DEPLOY_LOCAL_VENDOR_NAME_CELL = "B5";
const DEPLOY_LOCAL_CUST_CODE_CELL = "B6";
const VENDOR_UPDATE_CURSOR_KEY = "VENDOR_UPDATE_CURSOR_INDEX";
const VENDOR_UPDATE_DEFAULT_RUN_LIMIT = 20;
const VENDOR_CUST_MAP_SHEET_NAME = "업체등급단가매핑";
const VENDOR_UPDATE_AVG_MS_KEY = "VENDOR_UPDATE_AVG_MS_PER_FILE";
const VENDOR_UPDATE_LOG_SHEET_NAME = "업데이트실행로그";
/** 스크립트 속성: 웹 이관·운영 대비 마지막 성공/오류 시각·코드 */
const VENDOR_UPDATE_LAST_SUCCESS_AT_KEY = "VENDOR_UPDATE_LAST_SUCCESS_AT";
const VENDOR_UPDATE_LAST_ERROR_AT_KEY = "VENDOR_UPDATE_LAST_ERROR_AT";
const VENDOR_UPDATE_LAST_ERROR_CODE_KEY = "VENDOR_UPDATE_LAST_ERROR_CODE";

function normalizeSpreadsheetId_(raw) {
  var s = String(raw || "").trim();
  if (!s) return "";

  var byPath = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (byPath && byPath[1]) return byPath[1];

  var byQuery = s.match(/[?&]id=([a-zA-Z0-9-_]+)/i);
  if (byQuery && byQuery[1]) return byQuery[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return s;
}

function getCanonicalHubIdFromProps_(props) {
  var p = props || PropertiesService.getScriptProperties();
  var raw = String(p.getProperty("DB_HUB_ID") || "").trim();
  if (!raw) return "";

  var normalized = normalizeSpreadsheetId_(raw);
  if (normalized && normalized !== raw) {
    try {
      p.setProperty("DB_HUB_ID", normalized);
    } catch (eHubIdSave) {}
  }
  return normalized || raw;
}

function createTemplateCopyInTargetFolder_(templateId, copyName) {
  var templateFile = null;
  try {
    templateFile = DriveApp.getFileById(String(templateId || "").trim());
  } catch (eTpl) {
    throw new Error(
      "템플릿 파일 접근 실패(MASTER_TEMPLATE_ID): " + eTpl.message,
    );
  }

  // 1순위: 대상 폴더로 직접 복사 (공유드라이브/내 드라이브 루트 권한 충돌 회피)
  try {
    var targetFolder = DriveApp.getFolderById(
      String(TARGET_FOLDER_ID || "").trim(),
    );
    return templateFile.makeCopy(String(copyName || "").trim(), targetFolder);
  } catch (eDirectCopy) {
    // 2순위: 기본 복사 후 폴더 이동 시도
    try {
      var copy = templateFile.makeCopy(String(copyName || "").trim());
      try {
        var folder = DriveApp.getFolderById(
          String(TARGET_FOLDER_ID || "").trim(),
        );
        folder.addFile(copy);
        try {
          DriveApp.getRootFolder().removeFile(copy);
        } catch (eRootDetach) {}
      } catch (eMove) {}
      return copy;
    } catch (eFallbackCopy) {
      throw new Error(
        "템플릿 복사 실패(Drive 권한/공유설정 확인 필요): " +
          eFallbackCopy.message,
      );
    }
  }
}

function setVendorUpdateScriptHealth_(ok, errorCode) {
  var props = PropertiesService.getScriptProperties();
  var nowIso = Utilities.formatDate(
    new Date(),
    "Asia/Seoul",
    "yyyy-MM-dd HH:mm:ss",
  );
  if (ok) {
    props.setProperty(VENDOR_UPDATE_LAST_SUCCESS_AT_KEY, nowIso);
    props.deleteProperty(VENDOR_UPDATE_LAST_ERROR_AT_KEY);
    props.deleteProperty(VENDOR_UPDATE_LAST_ERROR_CODE_KEY);
  } else {
    props.setProperty(VENDOR_UPDATE_LAST_ERROR_AT_KEY, nowIso);
    props.setProperty(
      VENDOR_UPDATE_LAST_ERROR_CODE_KEY,
      errorCode || "UNKNOWN",
    );
  }
}

function parseConsumerDiscountRateFromName_(fileName) {
  var m = String(fileName || "").match(/(\d+(?:\.\d+)?)\s*%?\s*DC/i);
  if (!m || !m[1]) return 5;
  var n = parseFloat(m[1]);
  return normalizeDcRateNumber_(n, 5);
}

function normalizeDcRateNumber_(raw, fallback) {
  var n = typeof raw === "number" ? raw : parseFloat(String(raw || "").trim());
  if (isNaN(n)) return fallback;
  if (n < 1 || n > 10) return fallback;
  return Math.round(n * 10) / 10; // 소수 1자리까지 허용
}

function ensureDeployLocalSettingsTab_(ss, defaultVendorName, defaultCustCd) {
  if (!ss) return null;
  var tab = ss.getSheetByName(DEPLOY_LOCAL_SETTINGS_TAB_NAME);
  if (!tab) tab = ss.insertSheet(DEPLOY_LOCAL_SETTINGS_TAB_NAME);

  try {
    tab.getRange("A1:B1").merge().setValue("배포 설정");
  } catch (eMerge) {}
  tab
    .getRange("A1")
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold");
  tab.getRange("A2").setValue("※ 거래처명/CUST_CD는 이 탭에서 관리합니다.");
  tab.getRange("A3").setValue("파일명(자동)");
  tab.getRange("B3").setValue(ss.getName() || "");
  tab.getRange("A5").setValue("거래처명");
  tab.getRange("A6").setValue("거래처코드(CUST_CD)");
  tab.getRange("A3:A6").setFontWeight("bold");
  tab.setColumnWidth(1, 180);
  tab.setColumnWidth(2, 340);

  var curVendor = String(
    tab.getRange(DEPLOY_LOCAL_VENDOR_NAME_CELL).getValue() || "",
  ).trim();
  var curCust = String(
    tab.getRange(DEPLOY_LOCAL_CUST_CODE_CELL).getValue() || "",
  ).trim();
  if (!curVendor && String(defaultVendorName || "").trim()) {
    tab
      .getRange(DEPLOY_LOCAL_VENDOR_NAME_CELL)
      .setValue(String(defaultVendorName).trim());
  }
  if (!curCust && String(defaultCustCd || "").trim()) {
    tab
      .getRange(DEPLOY_LOCAL_CUST_CODE_CELL)
      .setValue(String(defaultCustCd).trim());
  }

  var custRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR($B6="",AND($B6<>$B5,$B6<>$B3))')
    .setAllowInvalid(true)
    .setHelpText("CUST_CD는 거래처명/파일명과 동일할 수 없습니다.")
    .build();
  tab.getRange(DEPLOY_LOCAL_CUST_CODE_CELL).setDataValidation(custRule);
  return tab;
}

function readLocalVendorIdentityFromSettings_(ss) {
  var out = {
    vendorName: "",
    custCd: "",
    hasVendor: false,
    hasCust: false,
    warning: "",
  };
  if (!ss) return out;
  var tab = ss.getSheetByName(DEPLOY_LOCAL_SETTINGS_TAB_NAME);
  if (!tab) return out;

  var vendorName = String(
    tab.getRange(DEPLOY_LOCAL_VENDOR_NAME_CELL).getValue() || "",
  ).trim();
  var custCd = String(
    tab.getRange(DEPLOY_LOCAL_CUST_CODE_CELL).getValue() || "",
  ).trim();
  var fileName = String(ss.getName() || "").trim();
  if (custCd && (custCd === vendorName || custCd === fileName)) {
    out.warning = "설정탭 CUST_CD가 거래처명/파일명과 동일하여 무시됨";
    custCd = "";
  }
  out.vendorName = vendorName;
  out.custCd = custCd;
  out.hasVendor = !!vendorName;
  out.hasCust = !!custCd;
  return out;
}

function applyLocalVendorIdentityOverride_(
  ss,
  viewerSheet,
  fallbackVendorName,
  fallbackCustCd,
) {
  if (!ss || !viewerSheet) return { applied: false, warning: "" };
  ensureDeployLocalSettingsTab_(ss, fallbackVendorName, fallbackCustCd);
  var local = readLocalVendorIdentityFromSettings_(ss);
  var hasLocalOverride = local.hasVendor || local.hasCust;
  if (!hasLocalOverride)
    return { applied: false, warning: local.warning || "" };

  var vendorToSet = local.vendorName || String(fallbackVendorName || "").trim();
  var custToSet = local.custCd || String(fallbackCustCd || "").trim();
  if (vendorToSet) {
    viewerSheet
      .getRange(VENDOR_META_NAME_CELL)
      .setValue(vendorToSet)
      .setFontColor("white");
  }
  if (custToSet) {
    viewerSheet
      .getRange(VENDOR_META_CUST_CELL)
      .setValue(custToSet)
      .setFontColor("white");
  }
  return { applied: true, warning: local.warning || "" };
}

function migrateLegacyDeploySettingsTabs_() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (eUi) {}

  var files = listDeployFilesSorted_();
  if (!files || files.length === 0) {
    if (ui) ui.alert("배포 대상 파일이 없습니다.");
    return;
  }

  var scanned = 0;
  var created = 0;
  var initialized = 0;
  var failed = 0;
  var samples = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    scanned++;
    try {
      var dss = SpreadsheetApp.openById(f.id);
      var viewer = null;
      if (typeof findViewerSheet_ === "function") {
        try {
          viewer = findViewerSheet_(dss);
        } catch (eFind) {}
      }
      if (!viewer) {
        viewer =
          dss.getSheetByName("단가조회") ||
          dss.getSheetByName("발주 및 송장조회");
      }
      if (!viewer) {
        failed++;
        if (samples.length < 5) samples.push("뷰어탭없음: " + f.name);
        continue;
      }

      var before = dss.getSheetByName(DEPLOY_LOCAL_SETTINGS_TAB_NAME);
      if (!before) created++;

      var aa = String(
        viewer.getRange(VENDOR_META_NAME_CELL).getValue() || "",
      ).trim();
      var ab = String(
        viewer.getRange(VENDOR_META_CUST_CELL).getValue() || "",
      ).trim();
      ensureDeployLocalSettingsTab_(dss, aa, ab);

      var local = readLocalVendorIdentityFromSettings_(dss);
      if (local.hasVendor || local.hasCust) initialized++;
    } catch (e) {
      failed++;
      if (samples.length < 5) {
        samples.push(
          "실패: " +
            f.name +
            " (" +
            String(e && e.message ? e.message : e) +
            ")",
        );
      }
    }
  }

  var lines = [];
  lines.push("기존 배포시트 설정탭 일괄 생성 완료");
  lines.push("- 점검: " + scanned + "개");
  lines.push("- 신규 생성: " + created + "개");
  lines.push("- 기본값 초기화(B5/B6): " + initialized + "개");
  lines.push("- 실패: " + failed + "개");
  if (samples.length > 0) {
    lines.push("");
    lines.push("[샘플 최대 5개]");
    for (var s = 0; s < samples.length; s++) lines.push("- " + samples[s]);
  }
  if (ui) ui.alert(lines.join("\n"));
}

function writeDeploySheetMeta_(sheet, meta) {
  var type = meta && meta.type ? String(meta.type) : "standard";
  var dcRate = meta && meta.dcRate ? String(meta.dcRate) : "";
  var updatedAt =
    meta && meta.updatedAt
      ? String(meta.updatedAt)
      : Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  sheet
    .getRange(DEPLOY_META_SCHEMA_CELL)
    .setValue(DEPLOY_SHEET_SCHEMA_VERSION)
    .setFontColor("white");
  sheet.getRange(DEPLOY_META_TYPE_CELL).setValue(type).setFontColor("white");
  sheet
    .getRange(DEPLOY_META_DC_RATE_CELL)
    .setValue(dcRate)
    .setFontColor("white");
  sheet
    .getRange(DEPLOY_META_UPDATED_AT_CELL)
    .setValue(updatedAt)
    .setFontColor("white");
}

function readDeploySheetMeta_(sheet, fileName) {
  var schema = String(
    sheet.getRange(DEPLOY_META_SCHEMA_CELL).getValue() || "",
  ).trim();
  var rawType = String(
    sheet.getRange(DEPLOY_META_TYPE_CELL).getValue() || "",
  ).trim();
  var rawRate = String(
    sheet.getRange(DEPLOY_META_DC_RATE_CELL).getValue() || "",
  ).trim();
  var updatedAt = String(
    sheet.getRange(DEPLOY_META_UPDATED_AT_CELL).getValue() || "",
  ).trim();

  // 과거 충돌 주소(AD~AH)에 남은 값은 신뢰도가 낮지만, 유효 패턴일 때만 제한적으로 보조 사용.
  if (!schema) {
    var legacySchema = String(
      sheet.getRange(DEPLOY_META_SCHEMA_CELL_LEGACY).getValue() || "",
    ).trim();
    if (/^\d{4}\.\d{2}\.\d{2}/.test(legacySchema)) schema = legacySchema;
  }
  if (!updatedAt || !parseMetaTimestampMs_(updatedAt)) {
    var legacyUpdatedAt = String(
      sheet.getRange(DEPLOY_META_UPDATED_AT_CELL_LEGACY).getValue() || "",
    ).trim();
    if (parseMetaTimestampMs_(legacyUpdatedAt)) updatedAt = legacyUpdatedAt;
  }
  if (!rawType) {
    var legacyType = String(
      sheet.getRange(DEPLOY_META_TYPE_CELL_LEGACY).getValue() || "",
    ).trim();
    if (legacyType === "consumer" || legacyType === "standard")
      rawType = legacyType;
  }
  if (!rawRate) {
    var legacyRate = String(
      sheet.getRange(DEPLOY_META_DC_RATE_CELL_LEGACY).getValue() || "",
    ).trim();
    if (/^(10|[1-9](?:\.\d+)?)$/.test(legacyRate)) rawRate = legacyRate;
  }

  var isConsumerByName = String(fileName || "").indexOf("(소비자용)") !== -1;
  var type = rawType || (isConsumerByName ? "consumer" : "standard");
  var dcRate = "";
  if (type === "consumer") {
    if (rawRate) dcRate = rawRate;
    else dcRate = String(parseConsumerDiscountRateFromName_(fileName));
  }
  return { schema: schema, type: type, dcRate: dcRate, updatedAt: updatedAt };
}

function parseMetaTimestampMs_(raw) {
  var s = String(raw || "").trim();
  if (!s) return 0;
  var normalized = s.replace(" ", "T");
  var d = new Date(normalized);
  var ms = d.getTime();
  if (isNaN(ms)) return 0;
  return ms;
}

function ensureNoticeRowLinked_(sheet, hubId) {
  // 공지행은 업체가 병합/보호를 건드려도 반드시 복구되도록 보수적으로 처리한다.
  sheet
    .getRange("A1")
    .setValue("📢 공지사항")
    .setBackground("#e69138")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // IFERROR 없이 IMPORTRANGE → 권한 미승인 시 "액세스 허용" 버튼이 노출되어 사용자가 클릭 가능
  var noticeFormula = '=IMPORTRANGE("' + hubId + '", "설정!B1")';
  var noticeRange = sheet.getRange("B1:J1");
  try {
    noticeRange.breakApart();
    noticeRange
      .merge()
      .setFormula(noticeFormula)
      .setBackground("#fff2cc")
      .setFontColor("#7f4f00")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);
  } catch (eNoticeMerge) {
    // 병합이 실패해도 공지 수식 자체는 B1에 강제 반영한다.
    sheet.getRange("B1").setFormula(noticeFormula);
    noticeRange
      .setBackground("#fff2cc")
      .setFontColor("#7f4f00")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);
  }
  sheet.setRowHeight(1, 50);
}

function buildDeployTitleFormula_(hubId) {
  // 권한/연결 이슈(#REF) 또는 공백값이어도 타이틀이 비지 않도록 기본값으로 폴백.
  return (
    '=IFERROR(LET(_t, IMPORTRANGE("' +
    hubId +
    '", "설정!B2"), IF(LEN(TRIM(_t&""))=0, "익월변동단가", _t)), "익월변동단가")'
  );
}

function quickCheckDeployUpdateFreshness(minutesWindow) {
  var ui = SpreadsheetApp.getUi();
  var windowMin = parseInt(minutesWindow, 10);
  if (!windowMin || windowMin <= 0) windowMin = 3;
  var windowMs = windowMin * 60 * 1000;
  var nowMs = new Date().getTime();

  var files = listDeployFilesSorted_();
  var total = files.length;
  if (total === 0) {
    ui.alert("배포시트가 없습니다.");
    return;
  }

  var fresh = 0;
  var stale = 0;
  var missingMeta = 0;
  var staleSamples = [];

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    try {
      var ss = SpreadsheetApp.openById(file.id);
      var viewer =
        typeof findViewerSheet_ === "function"
          ? findViewerSheet_(ss)
          : ss.getSheets()[0];
      if (!viewer) {
        missingMeta++;
        if (staleSamples.length < 5)
          staleSamples.push(file.name + " (뷰어탭 없음)");
        continue;
      }
      var metaTs = String(
        viewer.getRange(DEPLOY_META_UPDATED_AT_CELL).getValue() || "",
      ).trim();
      var ms = parseMetaTimestampMs_(metaTs);
      if (!ms) {
        missingMeta++;
        if (staleSamples.length < 5)
          staleSamples.push(file.name + " (메타시각 없음)");
        continue;
      }
      if (nowMs - ms <= windowMs) {
        fresh++;
      } else {
        stale++;
        if (staleSamples.length < 5)
          staleSamples.push(file.name + " (" + metaTs + ")");
      }
    } catch (e) {
      stale++;
      if (staleSamples.length < 5) staleSamples.push(file.name + " (열기실패)");
    }
  }

  var lines = [];
  lines.push("배포시트 반영 빠른 확인");
  lines.push("");
  lines.push("- 기준 시간창: 최근 " + windowMin + "분");
  lines.push("- 전체 배포시트: " + total + "개");
  lines.push("- 최신 반영(fresh): " + fresh + "개");
  lines.push("- 지연/미반영(stale): " + stale + "개");
  lines.push("- 메타누락: " + missingMeta + "개");
  if (staleSamples.length > 0) {
    lines.push("");
    lines.push("[지연 샘플 최대 5개]");
    for (var s = 0; s < staleSamples.length; s++)
      lines.push("- " + staleSamples[s]);
  }
  ui.alert(lines.join("\n"));
}

function repairMissingDeployMetaTimestamps() {
  var ui = SpreadsheetApp.getUi();
  var files = listDeployFilesSorted_();
  if (!files || files.length === 0) {
    ui.alert("배포시트가 없습니다.");
    return;
  }

  var repaired = 0;
  var scanned = 0;
  var failed = 0;
  var samples = [];
  var nowTs = Utilities.formatDate(
    new Date(),
    "Asia/Seoul",
    "yyyy-MM-dd HH:mm:ss",
  );

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    scanned++;
    try {
      var depSS = SpreadsheetApp.openById(f.id);
      var viewer =
        typeof findViewerSheet_ === "function"
          ? findViewerSheet_(depSS)
          : depSS.getSheets()[0];
      if (!viewer) {
        failed++;
        if (samples.length < 5) samples.push(f.name + " (뷰어탭 없음)");
        continue;
      }

      var meta = readDeploySheetMeta_(viewer, f.name);
      var hasUpdatedAt = meta && String(meta.updatedAt || "").trim() !== "";
      if (hasUpdatedAt) continue;

      writeDeploySheetMeta_(viewer, {
        type: meta && meta.type ? meta.type : "standard",
        dcRate: meta && meta.dcRate ? meta.dcRate : "",
        updatedAt: nowTs,
      });
      repaired++;
      if (samples.length < 5) samples.push(f.name + " (복구)");
    } catch (e) {
      failed++;
      if (samples.length < 5) samples.push(f.name + " (실패)");
    }
  }

  var lines = [];
  lines.push("메타누락 시각 자동 복구 완료");
  lines.push("");
  lines.push("- 점검: " + scanned + "개");
  lines.push("- 복구: " + repaired + "개");
  lines.push("- 실패: " + failed + "개");
  if (samples.length > 0) {
    lines.push("");
    lines.push("[샘플 최대 5개]");
    for (var s = 0; s < samples.length; s++) lines.push("- " + samples[s]);
  }
  ui.alert(lines.join("\n"));
}

function shouldInstallNoticeScript_(sheet) {
  var mark = String(
    sheet.getRange(DEPLOY_META_NOTICE_SCRIPT_CELL).getValue() || "",
  ).trim();
  return mark !== "1";
}

function markNoticeScriptInstalled_(sheet) {
  sheet
    .getRange(DEPLOY_META_NOTICE_SCRIPT_CELL)
    .setValue("1")
    .setFontColor("white");
}

function buildOrderUnitPriceFormula_(viewerTabName) {
  var safeName = String(viewerTabName || "").replace(/'/g, "''");
  return (
    "=ARRAYFORMULA(IF(LEN(C2:C), IFERROR(VLOOKUP(C2:C, '" +
    safeName +
    '\'!C:G, 5, FALSE), "코드오류"), ""))'
  );
}

function buildOrderVendorNameFormula_(viewerTabName) {
  // 반드시 단가조회 탭의 AA1을 가리켜야 함 (자기 탭 AA1 참조 시 순환 종속성 발생)
  var safeName = String(viewerTabName || "단가조회").replace(/'/g, "''");
  return (
    '=ARRAYFORMULA(IF(LEN(C2:C)+LEN(D2:D)=0, "", \'' + safeName + "'!$AA$1))"
  );
}

// A1에 넣으면 헤더("거래처명")와 A2:A 결과를 한 번에 spill하는 수식
// A2 단일 셀 삭제가 원천 차단됨 (배열 결과이므로)
function buildOrderVendorNameSpillFormula_(viewerTabName) {
  var safeName = String(viewerTabName || "단가조회").replace(/'/g, "''");
  return (
    '={"거래처명"; ARRAYFORMULA(IF(LEN(C2:C)+LEN(D2:D)=0, "", \'' +
    safeName +
    "'!$AA$1))}"
  );
}

// L1에 넣으면 헤더("정산금액")와 L2:L 결과를 한 번에 spill하는 수식
function buildOrderUnitPriceSpillFormula_(viewerTabName) {
  var safeName = String(viewerTabName || "단가조회").replace(/'/g, "''");
  return (
    '={"정산금액"; ARRAYFORMULA(IF(LEN(C2:C), IFERROR(VLOOKUP(C2:C, \'' +
    safeName +
    '\'!C:G, 5, FALSE) * E2:E, "코드오류"), ""))}'
  );
}

// 발주탭 A1/L1에 spill 수식 주입 (공통 헬퍼)
// - clearContent로 잔재 값 제거 후 수식 한 번만 박음
// - 주의: 바운드 스크립트도 실행 주체(EffectiveUser) 권한으로 동작한다.
//   '편집 제한' 보호 범위에 실행 계정이 포함되지 않으면 소유자여도 setValue가 실패할 수 있다.
function injectOrderSpillFormulas_(orderTab, viewerTabName) {
  if (!orderTab) return;
  // ★ 전용양식 탭에는 spill 수식 주입 금지 (A열=송장번호, 업체 수기 입력)
  try {
    var _tn = orderTab.getName();
    if (_tn.indexOf("전용양식") !== -1) return;
  } catch (e) {}
  var safeViewerTabName = resolveViewerTabNameForOrderSpill_(
    orderTab,
    viewerTabName,
  );
  try {
    orderTab.getRange("A1:A").clearContent();
    orderTab
      .getRange("A1")
      .setFormula(buildOrderVendorNameSpillFormula_(safeViewerTabName));
  } catch (e1) {}
  try {
    orderTab.getRange("L1:L").clearContent();
    orderTab
      .getRange("L1")
      .setFormula(buildOrderUnitPriceSpillFormula_(safeViewerTabName));
  } catch (e2) {}
}

function resolveViewerTabNameForOrderSpill_(orderTab, viewerTabName) {
  var fallback = String(viewerTabName || "").trim() || "단가조회";
  if (!orderTab) return fallback;
  try {
    var ss = orderTab.getParent();
    if (!ss) return fallback;

    if (fallback && ss.getSheetByName(fallback)) return fallback;

    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var n = sheets[i].getName();
      if (n.indexOf("단가조회") !== -1 || n.indexOf("뷰어") !== -1) return n;
    }
  } catch (e) {}
  return fallback;
}

// 발주탭 A1/L1 수식이 깨졌는지(값/빈칸/#REF!/ARRAYFORMULA 누락) 점검 후 자동 재주입
function healOrderSpillFormulas_(orderTab, viewerTabName) {
  if (!orderTab) return { aFixed: false, lFixed: false };
  // ★ 전용양식 탭에는 spill 수식 복구 금지 (A열=송장번호, 업체 수기 입력)
  try {
    var _tn2 = orderTab.getName();
    if (_tn2.indexOf("전용양식") !== -1)
      return { aFixed: false, lFixed: false };
  } catch (e) {}
  var safeViewerTabName = resolveViewerTabNameForOrderSpill_(
    orderTab,
    viewerTabName,
  );
  var out = { aFixed: false, lFixed: false };
  var sampleRows = Math.max(Math.min(orderTab.getLastRow(), 200), 2);
  var checkRows = sampleRows - 1;
  var aHasRefBelow = false;
  var lHasRefBelow = false;

  try {
    var aBelowValues = orderTab.getRange(2, 1, checkRows, 1).getDisplayValues();
    for (var ai = 0; ai < aBelowValues.length; ai++) {
      if (String(aBelowValues[ai][0] || "").indexOf("#REF") !== -1) {
        aHasRefBelow = true;
        break;
      }
    }
  } catch (eaScan) {}

  try {
    var lBelowValues = orderTab
      .getRange(2, 12, checkRows, 1)
      .getDisplayValues();
    for (var li = 0; li < lBelowValues.length; li++) {
      if (String(lBelowValues[li][0] || "").indexOf("#REF") !== -1) {
        lHasRefBelow = true;
        break;
      }
    }
  } catch (elScan) {}

  try {
    var a1 = orderTab.getRange("A1");
    var aF = String(a1.getFormula() || "");
    var aV = String(a1.getValue() || "");
    var a2F = String(orderTab.getRange("A2").getFormula() || "");
    var aBroken =
      !aF ||
      aF.indexOf("ARRAYFORMULA") === -1 ||
      aF.indexOf("$AA$1") === -1 ||
      aV.indexOf("#REF") !== -1 ||
      aHasRefBelow ||
      !!a2F;
    if (aBroken) {
      orderTab.getRange("A1:A").clearContent();
      a1.setFormula(buildOrderVendorNameSpillFormula_(safeViewerTabName));
      out.aFixed = true;
    }
  } catch (ea) {}
  try {
    var l1 = orderTab.getRange("L1");
    var lF = String(l1.getFormula() || "");
    var lV = String(l1.getValue() || "");
    var l2F = String(orderTab.getRange("L2").getFormula() || "");
    var lBroken =
      !lF ||
      lF.indexOf("ARRAYFORMULA") === -1 ||
      lF.indexOf("VLOOKUP") === -1 ||
      lV.indexOf("#REF") !== -1 ||
      lHasRefBelow ||
      !!l2F;
    if (lBroken) {
      orderTab.getRange("L1:L").clearContent();
      l1.setFormula(buildOrderUnitPriceSpillFormula_(safeViewerTabName));
      out.lFixed = true;
    }
  } catch (el) {}
  return out;
}

// 수동 실행용 강제 복구:
// 현재 활성 스프레드시트의 "발주 및 송장조회" A/L spill 수식을 즉시 재주입한다.
function repairOrderSpillNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;
  var orderTab = ss.getSheetByName("발주 및 송장조회");
  if (!orderTab) {
    SpreadsheetApp.getUi().alert(
      "❌ '발주 및 송장조회' 탭을 찾을 수 없습니다.",
    );
    return;
  }
  var viewerName = resolveViewerTabNameForOrderSpill_(orderTab, "단가조회");
  injectOrderSpillFormulas_(orderTab, viewerName);
  SpreadsheetApp.flush();
  var healed = healOrderSpillFormulas_(orderTab, viewerName);
  SpreadsheetApp.getUi().alert(
    "✅ spill 복구 완료\n- 참조 탭: " +
      viewerName +
      "\n- A열 복구: " +
      (healed.aFixed ? "예" : "정상 상태") +
      "\n- L열 복구: " +
      (healed.lFixed ? "예" : "정상 상태"),
  );
}

function ensureInvoiceReplyTab_(ss, orderTabName) {
  if (!ss) return null;
  var sourceOrderTabName = String(orderTabName || "발주 및 송장조회");
  var orderTab = ss.getSheetByName(sourceOrderTabName);
  if (!orderTab) return null;

  var replyTabName = "송장번호 회신";
  var replyTab = ss.getSheetByName(replyTabName);
  if (!replyTab) replyTab = ss.insertSheet(replyTabName);

  // A/B 입력, C 내부키(숨김), D~ 업체별 자유양식
  replyTab
    .getRange("A1:D1")
    .setValues([["송장번호", "적요", "고유ID(자동)", "업체양식(자율)"]])
    .setBackground("#cfe2f3")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  replyTab.setFrozenRows(1);
  replyTab.getRange("A2:B1000").setBackground("#ffffff");
  replyTab.getRange("C2:C1000").setBackground("#f3f3f3");
  replyTab.getRange("D2:Z1000").setBackground("#fff2cc");
  replyTab.getRange("A2:Z1000").setVerticalAlignment("middle");
  replyTab.getRange("A:B").setNumberFormat("@");

  // C열은 발주탭 M열(고유ID)과 자동 동기화
  replyTab
    .getRange("C2")
    .setFormula(
      "=ARRAYFORMULA(IF(LEN('" +
        sourceOrderTabName +
        "'!M2:M)=0, \"\", '" +
        sourceOrderTabName +
        "'!M2:M))",
    );
  try {
    replyTab.hideColumns(3, 1);
  } catch (eHide) {}

  // 헤더/내부키 보호 (입력은 A/B, 양식은 D~)
  try {
    var protections = replyTab.getProtections(
      SpreadsheetApp.ProtectionType.RANGE,
    );
    for (var pi = 0; pi < protections.length; pi++) protections[pi].remove();

    var headerProtect = replyTab
      .getRange("1:1")
      .protect()
      .setDescription("송장회신 헤더 락");
    headerProtect.removeEditors(headerProtect.getEditors());
    var keyProtect = replyTab
      .getRange("C:C")
      .protect()
      .setDescription("송장회신 내부키 락");
    keyProtect.removeEditors(keyProtect.getEditors());
  } catch (eProtect) {}

  return replyTab;
}

function backfillOrderCodesFromItemName_(orderTab, viewerTab) {
  if (!orderTab || !viewerTab) return 0;
  var orderLastRow = orderTab.getLastRow();
  if (orderLastRow < 2) return 0;
  var rowCount = orderLastRow - 1;

  var viewerLastRow = viewerTab.getLastRow();
  if (viewerLastRow < 2) return 0;

  // viewer C=이카운트코드, D=품목명 (row 2+ 또는 row 3+ 모두 포함되도록 2부터 조회)
  var mapData = viewerTab.getRange(2, 3, viewerLastRow - 1, 2).getValues();
  var codeByItemName = {};
  for (var i = 0; i < mapData.length; i++) {
    var code = String(mapData[i][0] || "").trim();
    var itemName = String(mapData[i][1] || "").trim();
    if (!code || !itemName) continue;
    if (!codeByItemName[itemName]) codeByItemName[itemName] = code;
  }

  var cd = orderTab.getRange(2, 3, rowCount, 2).getValues(); // C:D
  var cOut = [];
  var changed = false;
  var filled = 0;
  for (var r = 0; r < cd.length; r++) {
    var curCode = String(cd[r][0] || "").trim();
    var item = String(cd[r][1] || "").trim();
    if (!curCode && item && codeByItemName[item]) {
      cOut.push([codeByItemName[item]]);
      changed = true;
      filled++;
    } else {
      cOut.push([cd[r][0]]);
    }
  }

  if (changed) orderTab.getRange(2, 3, rowCount, 1).setValues(cOut);
  return filled;
}

function resolveVendorPolicyForFile_(mapSheet, fileId, fileName, fallbackType) {
  var out = null;
  if (mapSheet && fileId && typeof getVendorPolicyByFileId_ === "function") {
    try {
      out = getVendorPolicyByFileId_(mapSheet, fileId);
    } catch (ePolicyRead) {}
  }
  if (out) {
    out.__fallback = false;
    out.__matchedBy = "fileId";
    return out;
  }
  if (
    mapSheet &&
    fileName &&
    typeof getVendorPolicyByFileNameOrVendor_ === "function"
  ) {
    try {
      out = getVendorPolicyByFileNameOrVendor_(mapSheet, fileName);
    } catch (ePolicyNameRead) {}
  }
  if (out) {
    out.__fallback = false;
    out.__matchedBy = "fileNameOrVendor";
    return out;
  }

  var guessedType = String(fallbackType || "");
  if (!guessedType && typeof guessPolicyTypeByFileName_ === "function") {
    guessedType = guessPolicyTypeByFileName_(fileName);
  }
  if (!guessedType) guessedType = "대리판매";

  if (typeof buildResolvedVendorPolicy_ === "function") {
    var fallbackDc =
      guessedType === "일괄DC" || guessedType === "프랜차이즈DC"
        ? String(parseConsumerDiscountRateFromName_(fileName))
        : "";
    out = buildResolvedVendorPolicy_(guessedType, {
      dcRateDefault: fallbackDc,
    });
  } else {
    out = {
      operatingType: guessedType,
      dropdownEnabled: "N",
      invoiceReplyEnabled: "N",
      invoiceInputOwner: "판매처",
      priceVisibility: "비공개",
      lockProfile: "기본",
      dcRate:
        guessedType === "일괄DC"
          ? String(parseConsumerDiscountRateFromName_(fileName))
          : "",
    };
  }
  out.__fallback = true;
  out.__matchedBy = "fallback";
  return out;
}

function applyOrderDropdownPolicy_(orderTab, viewerSheet, enabled) {
  if (!orderTab) return false;
  var yn = String(enabled || "N").toUpperCase() === "Y";
  var itemRange = orderTab.getRange("D2:D1000");
  if (!yn) {
    itemRange.clearDataValidations();
    return false;
  }
  if (!viewerSheet) return false;
  var dropRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(viewerSheet.getRange("D3:D1000"), true)
    .setAllowInvalid(true)
    .build();
  itemRange.setDataValidation(dropRule);
  return true;
}

function applyInvoiceReplyPolicy_(ss, enabled) {
  if (!ss) return false;
  var yn = String(enabled || "N").toUpperCase() === "Y";
  var replyTab = ss.getSheetByName("송장번호 회신");
  if (yn) {
    try {
      ensureInvoiceReplyTab_(ss, "발주 및 송장조회");
    } catch (eEnsure) {}
    try {
      replyTab = ss.getSheetByName("송장번호 회신");
      if (replyTab && replyTab.isSheetHidden()) replyTab.showSheet();
    } catch (eShow) {}
    return true;
  }
  if (replyTab) {
    try {
      if (!replyTab.isSheetHidden()) replyTab.hideSheet();
    } catch (eHide) {}
  }
  return false;
}

function applyVendorPolicyToOrderAndReply_(ss, orderTab, viewerSheet, policy) {
  policy = policy || {};
  var dropdownApplied = applyOrderDropdownPolicy_(
    orderTab,
    viewerSheet,
    policy.dropdownEnabled || "N",
  );
  var invoiceReplyApplied = applyInvoiceReplyPolicy_(
    ss,
    policy.invoiceReplyEnabled || "N",
  );
  return {
    dropdownApplied: dropdownApplied,
    invoiceReplyApplied: invoiceReplyApplied,
  };
}

// ==============================================================================
// 🔗 매핑 연결 (신구조 v2)
// ==============================================================================
// 기존 구조의 고질병:
//   - AA1/AB1에 IMPORTRANGE를 직접 박아서, 한 배포시트에 IMPORTRANGE 4회 호출
//   - 실패 원인이 IFERROR에 전부 삼켜져 디버깅 불가능
//
// 신구조: 매핑시트 전체를 단가조회 탭 AE:AH 에 "한 번만" IMPORTRANGE로 로드.
//   - AC1: fileId 정적값 (매칭 키)
//   - AD1: 진단 상태 수식 ("매핑OK (N행)" 또는 "[매핑연결실패]")
//   - AE1: IMPORTRANGE("mapSsId","업체등급단가매핑!A:D")  ← 이 시트의 유일한 IMPORTRANGE
//     → AE=거래처명, AF=CUST_CD, AG=단가그룹, AH=배포시트ID(fileId)
//   - AA1: =INDEX(AE:AE, MATCH(AC1, AH:AH, 0))   ← 내부 참조 (초고속, 실패원인 명시)
//   - AB1: =INDEX(AF:AF, MATCH(AC1, AH:AH, 0))
// 장점:
//   1) IMPORTRANGE 권한 허용 1회(AE1)만으로 모든 셀이 동작
//   2) AE1 영역이 눈에 보여 연결 성공/실패를 즉시 판별 가능
//   3) AA1이 "[매핑연결실패]"/"[매핑없음:fileId]" 등 명시적 에러를 반환 → 발주탭 A열로 그대로 전파돼 사용자가 바로 인지
// ==============================================================================
function applyViewerIdentityFormulaFromHubMap_(sheet, hubId, fileId) {
  var safeFileId = String(fileId || "").replace(/"/g, "");
  var mapSsId =
    PropertiesService.getScriptProperties().getProperty("VENDOR_MAP_SS_ID") ||
    hubId ||
    "";
  var safeMapId = String(mapSsId).replace(/"/g, "");

  // 1) AC1: 매칭 키 (fileId 정적값)
  sheet
    .getRange(VENDOR_META_FILEID_CELL)
    .setValue(safeFileId)
    .setFontColor("white");

  // 2) AE1: 매핑시트 전체(A:D)를 IMPORTRANGE 로 한 번만 로드 (유일한 IMPORTRANGE)
  if (safeMapId) {
    var importFormula =
      '=IMPORTRANGE("' + safeMapId + '","업체등급단가매핑!A:D")';
    sheet.getRange("AE1").setFormula(importFormula).setFontColor("white");
  } else {
    // VENDOR_MAP_SS_ID 미설정 → 6단계를 먼저 실행해야 함
    sheet.getRange("AE1").clearContent();
  }

  // 3) AD1: 진단 상태 (AE1 로드 결과로 "매핑OK (N행)" 또는 "[매핑연결실패]" 를 표시)
  var diagFormula =
    '=IF(LEN(AE1)>0, "매핑OK (" & (COUNTA(AH:AH)-0) & "행)", "[매핑연결실패] 6단계 실행 후 AE1 IMPORTRANGE 권한 허용 필요")';
  sheet.getRange("AD1").setFormula(diagFormula).setFontColor("white");

  // 4) AA1: 거래처명 (내부 INDEX/MATCH — 실패 시 원인을 명시적으로 표시)
  var vendorFormula =
    '=IFERROR(INDEX(AE:AE, MATCH(AC1, AH:AH, 0)), IF(LEN(AE1)=0, "[매핑연결실패]", "[매핑없음:" & AC1 & "]"))';
  sheet
    .getRange(VENDOR_META_NAME_CELL)
    .setFormula(vendorFormula)
    .setFontColor("white");

  // 5) AB1: CUST_CD (내부 INDEX/MATCH, 못 찾으면 빈칸)
  var custFormula = '=IFERROR(INDEX(AF:AF, MATCH(AC1, AH:AH, 0)), "")';
  sheet
    .getRange(VENDOR_META_CUST_CELL)
    .setFormula(custFormula)
    .setFontColor("white");
}

/**
 * 배포 파일명 판정 — 협력업체 배포 파일만 대상으로 한다.
 * 폴더에는 허브·정산본 등 다른 파일도 같이 있어서 접두어로 걸러야 한다.
 * (_partnerDeploy.gs _PT.PREFIX 와 같은 규칙, 언더스코어 변형까지 인식)
 */
function isPartnerDeployFileName_(rawName) {
  var name = String(rawName || "");
  return name.indexOf("[협력업체] ") !== -1 || name.indexOf("[협력업체]_") !== -1;
}

/**
 * 배포 파일을 Drive File 객체로 반환.
 * 뷰어 보호·수식 복구 함수들이 file.getId()/getName() 을 직접 쓰기 때문에
 * {id,name} 을 주는 _pt_listFiles() 로 대체할 수 없어 따로 둔다.
 */
function listAllDeployFiles_() {
  var out = [];
  var seen = {};
  var folderIds = [TARGET_FOLDER_ID, "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v"];
  for (var fi = 0; fi < folderIds.length; fi++) {
    var fid = String(folderIds[fi] || "").trim();
    if (!fid) continue;
    var folder = null;
    try {
      folder = DriveApp.getFolderById(fid);
    } catch (eFolder) {
      continue;
    }
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (!isPartnerDeployFileName_(f.getName())) continue;
      var id = f.getId();
      if (seen[id]) continue;
      seen[id] = true;
      out.push(f);
    }
  }
  return out;
}

function listDeployFilesSorted_() {
  var arr = [];
  var seen = {};
  var folderIds = [
    TARGET_FOLDER_ID,
    "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v", // 레거시 배포 폴더
  ];
  for (var fi = 0; fi < folderIds.length; fi++) {
    var fid = String(folderIds[fi] || "").trim();
    if (!fid) continue;
    var folder = null;
    try {
      folder = DriveApp.getFolderById(fid);
    } catch (eFolder) {
      continue;
    }
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      var name = String(f.getName() || "");
      if (!isPartnerDeployFileName_(name)) continue;
      if (seen[f.getId()]) continue;
      seen[f.getId()] = true;
      arr.push({
        id: f.getId(),
        name: name,
      });
    }
  }
  arr.sort(function (a, b) {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return arr;
}

function computeAdaptiveRunLimit_(opts, props) {
  if (opts && opts.runLimit) {
    var explicit = parseInt(opts.runLimit, 10);
    if (explicit && explicit > 0) return explicit;
  }
  // 수동 실행은 체감/예측 가능성을 위해 고정값 유지
  // (팝업에 7개처럼 낮게 뜨는 혼란 방지)
  if (!opts || !opts.silent) {
    return VENDOR_UPDATE_DEFAULT_RUN_LIMIT;
  }
  var avgMs = parseFloat(props.getProperty(VENDOR_UPDATE_AVG_MS_KEY) || "0");
  if (!avgMs || avgMs <= 0) return VENDOR_UPDATE_DEFAULT_RUN_LIMIT;
  var tuned = Math.floor(150000 / avgMs);
  if (tuned < 10) tuned = 10;
  if (tuned > 30) tuned = 30;
  return tuned;
}

function getOrCreateVendorUpdateLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(VENDOR_UPDATE_LOG_SHEET_NAME);
  var headers = [
    "실행시각",
    "실행모드",
    "runLimit",
    "대상탐색",
    "업데이트성공",
    "일반",
    "소비자",
    "구버전메타",
    "메타갱신",
    "DC율보정",
    "CUST_CD동기화",
    "적용완료",
    "적용대기",
    "적용예약대기",
    "적용스킵",
    "매핑폴백",
    "이어처리필요",
    "오류건수",
    "에러코드",
    "메시지",
  ];
  if (!sh) {
    sh = ss.insertSheet(VENDOR_UPDATE_LOG_SHEET_NAME);
  }
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    var mismatch = false;
    for (var i = 0; i < headers.length; i++) {
      if (String(current[i] || "") !== headers[i]) {
        mismatch = true;
        break;
      }
    }
    if (mismatch) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sh.getRange(1, 1, 1, headers.length)
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  sh.setFrozenRows(1);
  return sh;
}

function appendVendorUpdateLogRow_(payload) {
  try {
    var sh = getOrCreateVendorUpdateLogSheet_();
    var now = Utilities.formatDate(
      new Date(),
      "Asia/Seoul",
      "yyyy-MM-dd HH:mm:ss",
    );
    var row = [
      now,
      payload.mode || "",
      payload.runLimit || "",
      payload.targetCount || 0,
      payload.updatedCount || 0,
      payload.standardCount || 0,
      payload.consumerCount || 0,
      payload.legacyMetaCount || 0,
      payload.migratedMetaCount || 0,
      payload.dcRateUpdatedCount || 0,
      payload.custCdAppliedCount || 0,
      payload.applyDoneCount || 0,
      payload.applyPendingCount || 0,
      payload.applyScheduledWaitCount || 0,
      payload.applySkipCount || 0,
      payload.mapFallbackCount || 0,
      payload.hasMore ? "Y" : "N",
      payload.errorCount || 0,
      payload.errorCode || "",
      payload.message || "",
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  } catch (e) {
    if (typeof recordAutomationLogFailure_ === "function") {
      recordAutomationLogFailure_(
        "VENDOR_UPDATE_LOG",
        "mode=" +
          (payload && payload.mode) +
          ", code=" +
          (payload && payload.errorCode) +
          ", msg=" +
          (payload && payload.message),
        e,
      );
      return;
    }
    try {
      Logger.log(
        "[VENDOR_UPDATE_LOG_FAIL] " + (e && e.message ? e.message : e),
      );
    } catch (_) {}
  }
}

function normalizeVendorNameFromDeployFile_(rawName) {
  return String(rawName || "")
    .replace(/\[독립\s*배포\]/g, "")
    .replace(/\s*\(소비자용\)\s*.*$/, "")
    .trim();
}

function normalizeVendorKeyForMap_(rawName) {
  return String(rawName || "")
    .replace(/\[독립\s*배포\]/g, "")
    .replace(/\s*\(소비자용\)\s*.*$/, "")
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .trim()
    .toLowerCase();
}

function resolveVendorMapSheetForPriceManager_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapName =
    typeof VENDOR_CUST_MAP_SHEET_NAME !== "undefined"
      ? VENDOR_CUST_MAP_SHEET_NAME
      : "업체등급단가매핑";
  var mapSsId = "";
  try {
    mapSsId =
      PropertiesService.getScriptProperties().getProperty("VENDOR_MAP_SS_ID") ||
      "";
  } catch (eProp) {}

  if (mapSsId) {
    try {
      var mapSs = SpreadsheetApp.openById(mapSsId);
      var remote = mapSs.getSheetByName(mapName);
      if (remote) return { ss: mapSs, sheet: remote, source: "property" };
    } catch (eOpen) {}
  }

  var local = ss ? ss.getSheetByName(mapName) : null;
  if (local) return { ss: ss, sheet: local, source: "active" };
  return { ss: ss, sheet: null, source: "none" };
}

function loadVendorCustCdMap_() {
  var bundle = {
    byVendor: {},
    byVendorNorm: {},
    byDeployNameNorm: {},
    byFileId: {},
    byCustCd: {},
  };
  var mapInfo = resolveVendorMapSheetForPriceManager_();
  var sheet = mapInfo.sheet;
  if (!sheet || sheet.getLastRow() < 2) return bundle;

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var vendorIdx = -1;
  var custIdx = -1;
  var fileIdIdx = -1;
  var deployNameIdx = -1;
  var groupIdx = -1;
  var applyModeIdx = -1;
  var scheduledAtIdx = -1;
  var exceptionEnabledIdx = -1;
  var exceptionGroupIdx = -1;
  var opsMemoIdx = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "");
    if (
      h.indexOf("발주업체") !== -1 ||
      h.indexOf("거래처명") !== -1 ||
      h.indexOf("업체명") !== -1
    ) {
      vendorIdx = i;
    }
    if (
      h.indexOf("CUST_CD") !== -1 ||
      h.indexOf("거래처코드") !== -1 ||
      h.indexOf("custcd") !== -1
    ) {
      custIdx = i;
    }
    if (
      h.indexOf("배포시트ID") !== -1 ||
      h.indexOf("fileid") !== -1 ||
      h.indexOf("스프레드시트ID") !== -1
    ) {
      fileIdIdx = i;
    }
    if (
      h.indexOf("배포시트명") !== -1 ||
      h.indexOf("파일명") !== -1 ||
      h.indexOf("sheetname") !== -1
    ) {
      deployNameIdx = i;
    }
    if (h.indexOf("단가그룹") !== -1) {
      groupIdx = i;
    }
    if (h.indexOf("적용모드") !== -1) {
      applyModeIdx = i;
    }
    if (h.indexOf("적용예약시각") !== -1) {
      scheduledAtIdx = i;
    }
    if (h.indexOf("예외사용") !== -1) {
      exceptionEnabledIdx = i;
    }
    if (h.indexOf("예외단가그룹") !== -1) {
      exceptionGroupIdx = i;
    }
    if (h.indexOf("운영메모") !== -1) {
      opsMemoIdx = i;
    }
  }
  if (vendorIdx < 0) vendorIdx = 0;
  if (custIdx < 0) custIdx = 1;
  if (fileIdIdx < 0) {
    // 관행상 4열(D)에 배포 파일 ID를 두는 경우가 많아 마지막 fallback
    fileIdIdx = Math.min(3, headers.length - 1);
  }
  for (var r = 1; r < data.length; r++) {
    var vendor = String(data[r][vendorIdx] || "").trim();
    var cust = String(data[r][custIdx] || "").trim();
    var fileId = String(data[r][fileIdIdx] || "").trim();
    var deployName =
      deployNameIdx >= 0 ? String(data[r][deployNameIdx] || "").trim() : "";
    var groupName = groupIdx >= 0 ? String(data[r][groupIdx] || "").trim() : "";
    var applyMode =
      applyModeIdx >= 0 ? String(data[r][applyModeIdx] || "").trim() : "";
    var scheduledAt =
      scheduledAtIdx >= 0 ? String(data[r][scheduledAtIdx] || "").trim() : "";
    var exceptionEnabled =
      exceptionEnabledIdx >= 0
        ? String(data[r][exceptionEnabledIdx] || "")
            .trim()
            .toUpperCase()
        : "N";
    var exceptionGroup =
      exceptionGroupIdx >= 0
        ? String(data[r][exceptionGroupIdx] || "").trim()
        : "";
    var opsMemo =
      opsMemoIdx >= 0 ? String(data[r][opsMemoIdx] || "").trim() : "";
    if (!fileId) {
      // 헤더 인식 실패/열 이동 대비: 행 전체에서 스프레드시트 ID 패턴 탐색
      for (var c = 0; c < data[r].length; c++) {
        var cell = String(data[r][c] || "").trim();
        if (/^[A-Za-z0-9_-]{40,}$/.test(cell)) {
          fileId = cell;
          break;
        }
      }
    }
    if (!vendor && !cust && !fileId) continue;
    var rowObj = {
      vendor: vendor,
      custCd: cust,
      fileId: fileId,
      groupName: groupName,
      applyMode: applyMode || "수동",
      scheduledAt: scheduledAt,
      exceptionEnabled: exceptionEnabled === "Y" ? "Y" : "N",
      exceptionGroup: exceptionGroup,
      opsMemo: opsMemo,
    };
    if (vendor) bundle.byVendor[vendor] = rowObj;
    if (vendor) {
      var vn = normalizeVendorKeyForMap_(vendor);
      if (vn && !bundle.byVendorNorm[vn]) bundle.byVendorNorm[vn] = rowObj;
    }
    if (deployName) {
      var dn = normalizeVendorKeyForMap_(deployName);
      if (dn && !bundle.byDeployNameNorm[dn])
        bundle.byDeployNameNorm[dn] = rowObj;
    }
    if (fileId) bundle.byFileId[fileId] = rowObj;
    if (cust) bundle.byCustCd[cust] = rowObj;
  }
  return bundle;
}

function parseVendorApplyScheduleMs_(raw) {
  var text = String(raw || "").trim();
  if (!text) return NaN;
  var dt = new Date(text);
  if (!isNaN(dt.getTime())) return dt.getTime();
  var normalized = text.replace(/\./g, "-");
  dt = new Date(normalized);
  return dt.getTime();
}

function shouldApplyVendorByMode_(rowObj, nowMs) {
  // 항상 적용 — 적용모드에 의한 스킵 제거
  return { apply: true, mode: "즉시", reason: "always_apply" };
}

function buildHubGroupColumnMap_(hubHeaders) {
  var out = {};
  if (!hubHeaders || !hubHeaders.length) return out;
  for (var col = 6; col < hubHeaders.length; col += 5) {
    var g = String(hubHeaders[col] || "").trim();
    if (g && !out[g]) out[g] = col + 1; // K2에 쓰는 1-based index
  }
  return out;
}

function getHubSS(id) {
  id = normalizeSpreadsheetId_(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!id || id === ss.getId()) return ss;

  var lastErr = null;
  var url = "https://docs.google.com/spreadsheets/d/" + id + "/edit";
  for (var i = 0; i < 3; i++) {
    try {
      // openById 대신 openByUrl을 사용하여 구글 데이터베이스의 ID 캐시 치명적 오류를 물리적으로 우회
      var target = SpreadsheetApp.openByUrl(url);
      if (target) return target;
    } catch (e) {
      lastErr = e;
      Utilities.sleep(1500);
    }
  }

  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    var errMsg = String(lastErr ? lastErr.message : e.message);
    var low = errMsg.toLowerCase();
    var isPermissionDenied =
      low.indexOf("permission") !== -1 ||
      low.indexOf("access") !== -1 ||
      errMsg.indexOf("액세스할 권한이 없습니다") !== -1 ||
      errMsg.indexOf("권한") !== -1;

    if (isPermissionDenied) {
      // ⚠ DB_HUB_ID를 삭제하지 않음 — 삭제하면 createStaticHub이 매번 새 허브를 생성하는 버그 유발
      throw new Error(
        "❌ 허브 파일 접근 권한 오류\n- 현재 저장된 허브ID: " +
          id +
          "\n- 원인: " +
          errMsg +
          "\n\n조치:\n1) 잠시 후 다시 시도해주세요 (일시적 구글 서버 오류일 수 있음).\n2) 계속 실패하면 메뉴 '1) 허브 만들기/재구성'에서 기존 허브를 연결하세요.\n3) 허브를 공동 사용 중이면 허브 파일의 편집 권한을 확인해주세요.",
      );
    }

    throw new Error(
      "❌ 시스템 치명적 지연(URL/ID 접속 모두 실패)\n- 원인: " +
        errMsg +
        "\n- 임시 조치: 잠시 후 다시 시도해주시거나, '✨ 시스템 초기화' 후 1번을 다시 눌러주세요.",
    );
  }
}
// 1. [허브 업그레이드] 새로 만들지 않고 "기존 허브"를 덮어씁니다.
function createStaticHub() {
  var ui = SpreadsheetApp.getUi();
  var rs = ui.prompt(
    "🗄️ 시스템 연결 유지",
    "기존에 직접 만드신 허브의 디자인과 구조만 업데이트합니다. (네 치시면 진행)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (rs.getResponseText().trim() !== "네") return;

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName("상품정보");
    var props = PropertiesService.getScriptProperties();

    // ⛔ 삭제 금지! - 사장님의 기존 ID 연결을 위해 props.deleteAllProperties() 날림
    var redundantTab = ss.getSheetByName("📊 전체 그룹 단가표(HUB)");
    if (redundantTab) ss.deleteSheet(redundantTab);

    var hubId = getCanonicalHubIdFromProps_(props);

    var newHubSS;
    var isNew = false;

    var newHubSS;
    var isNew = false;

    if (hubId) {
      try {
        newHubSS = getHubSS(hubId);
      } catch (e) {
        isNew = true; // 에러 덩어리 파일 버리고 새로 만듦
      }
    } else {
      isNew = true;
    }

    if (isNew) {
      // 새로 만들기 전에 Drive 폴더에서 기존 허브 검색 (중복 생성 방지)
      try {
        var folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
        var existingFiles = folder.getFiles();
        while (existingFiles.hasNext()) {
          var ef = existingFiles.next();
          if (String(ef.getName()).indexOf("통합 관리 HUB") !== -1) {
            try {
              newHubSS = SpreadsheetApp.openById(ef.getId());
              hubId = ef.getId();
              isNew = false;
              props.setProperty("DB_HUB_ID", hubId);
              break;
            } catch (eExist) {}
          }
        }
      } catch (eFolderSearch) {}
    }

    if (isNew) {
      newHubSS = SpreadsheetApp.create("[Pack2U] 통합 관리 HUB (최종 완성본)");
      hubId = newHubSS.getId();
      try {
        var folder2 = DriveApp.getFolderById(TARGET_FOLDER_ID);
        folder2.addFile(DriveApp.getFileById(hubId));
        DriveApp.getRootFolder().removeFile(DriveApp.getFileById(hubId));
      } catch (err) {}
      props.setProperty("DB_HUB_ID", hubId);
    }

    var hubTab = newHubSS.getSheets()[0];
    hubTab.setName("전체 그룹 단가표");

    var settingsTab = newHubSS.getSheetByName("설정");
    if (!settingsTab) {
      settingsTab = newHubSS.insertSheet("설정");
      settingsTab
        .getRange("A1:A3")
        .setValues([
          ["공지사항👇"],
          ["월 변동단가 제목👇"],
          ["동기화 업데이트"],
        ]);
      settingsTab
        .getRange("A1:A3")
        .setBackground("#e69138")
        .setFontColor("#ffffff")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
      settingsTab
        .getRange("B1")
        .setValue(
          "(여기에 공지를 입력하시면 모든 배포 시트에 즉시 표시됩니다)",
        );
      settingsTab
        .getRange("B2")
        .setValue("월 변동단가 (여기에 입력하면 모든 배포 시트에 즉시 반영)");
      settingsTab.getRange("B3").setValue("🕒 업데이트 기록 없음");
      settingsTab.setColumnWidth(1, 150);
      settingsTab.setColumnWidth(2, 600);
      settingsTab
        .getRange("B1:B2")
        .setBackground("#fff2cc")
        .setFontColor("#7f4f00")
        .setFontWeight("bold")
        .setWrap(true);
    }

    var maxCol = masterSheet.getLastColumn();
    var headerRow1 = masterSheet.getRange(1, 1, 1, maxCol).getValues()[0];
    var headerRow2 = masterSheet.getRange(2, 1, 1, maxCol).getValues()[0];

    // [완벽 그룹 분리 스캔] 인덱스 15부터 시작 (만약 컬럼이 지워져도 방어)
    var masterGroups = {};
    var orderedGroups = [];
    for (var k = 15; k < maxCol; k++) {
      // 2행을 먼저 읽고, 비어있으면 1행의 값을 읽습니다. (병합 셀 완벽 호환)
      var gName = String(headerRow2[k]).trim();
      if (!gName || gName === "") {
        gName = String(headerRow1[k]).trim();
      }

      if (
        !gName ||
        gName.indexOf("변동가") !== -1 ||
        gName.indexOf("차액") !== -1
      )
        continue;

      if (!masterGroups[gName]) {
        masterGroups[gName] = { current: k, next: -1 };
        orderedGroups.push(gName);
      } else if (masterGroups[gName].next === -1) {
        masterGroups[gName].next = k;
      }
    }

    var maxRow = Math.max(masterSheet.getLastRow(), 6);
    var masterData = masterSheet.getRange(1, 1, maxRow, maxCol).getValues();

    var hubCurrentData = [];
    try {
      hubCurrentData = hubTab.getDataRange().getValues();
    } catch (e) {}

    var baseInfo = [];
    for (var i = 5; i < maxRow; i++) {
      var r = masterData[i];
      baseInfo.push([
        r[0] || "",
        r[1] || "",
        r[4] || "",
        r[2] || "",
        r[6] || "",
        r[23] || "",
      ]);
    }

    var newTime = Utilities.formatDate(new Date(), "Asia/Seoul", "MM.dd HH:mm");
    if (settingsTab) {
      settingsTab.getRange("B3").setValue("🕒 업데이트: " + newTime);
    }

    // ── Row 1~2: 헤더명 지정 및 세로 병합 ──
    // [버그 픽스] 기존 시트에 1행 틀고정이 걸려 있으면 A1:A2 병합 시 에러 발생 -> 일시적으로 틀고정 해제
    hubTab.setFrozenRows(0);

    hubTab
      .getRange("A1:F2")
      .setBackground("#4a86e8")
      .setFontColor("#ffffff")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    hubTab.getRange("A1:A2").merge().setValue("상태");
    hubTab.getRange("B1:B2").merge().setValue("출고지");
    hubTab.getRange("C1:C2").merge().setValue("이카운트코드");
    hubTab.getRange("D1:D2").merge().setValue("품목명");
    hubTab.getRange("E1:E2").merge().setValue("재고");
    hubTab.getRange("F1:F2").merge().setValue("소비자가");

    // [초고속 일괄 처리(Batch Write) 배열 준비]
    var totalGroups = orderedGroups.length;
    var totalCols = 6 + totalGroups * 5;

    // Out of bounds 방지 (시트 공간 자동 확장)
    var currentMaxRows = hubTab.getMaxRows();
    var neededRows = Math.max(maxRow, 1000);
    if (neededRows > currentMaxRows) {
      hubTab.insertRowsAfter(currentMaxRows, neededRows - currentMaxRows + 10);
    }
    var currentMaxCols = hubTab.getMaxColumns();
    if (totalCols > currentMaxCols) {
      hubTab.insertColumnsAfter(currentMaxCols, totalCols - currentMaxCols + 2);
    }

    var row2 = new Array(totalCols).fill("");
    var row3 = new Array(totalCols).fill("");
    var row2Colors = new Array(totalCols).fill("#4a86e8");
    var row3Colors = new Array(totalCols).fill("#4a86e8");
    var rowFontColors = new Array(totalCols).fill("#ffffff");

    // 4행부터 끝까지의 데이터 배열
    var dataRowsLength = Math.max(0, maxRow - 4);
    var dataMatrix = [];
    for (var r = 0; r < dataRowsLength; r++) {
      dataMatrix.push(new Array(totalCols).fill(""));
    }

    // 1. 기본 정보 담기 (A~F열)
    row2[0] = "상태";
    row2[1] = "출고지";
    row2[2] = "이카운트코드";
    row2[3] = "품목명";
    row2[4] = "재고";
    row2[5] = "소비자가";
    for (var i = 0; i < baseInfo.length; i++) {
      for (var c = 0; c < 6; c++) dataMatrix[i][c] = baseInfo[i][c];
    }

    // 2. 그룹별 정보 매트릭스에 꾹꾹 눌러담기
    var writeCol = 6; // G열
    var premiumColors = [
      "#1c4587",
      "#274e13",
      "#741b47",
      "#7f6000",
      "#0b5394",
      "#1155cc",
      "#38761d",
      "#990000",
      "#b45f06",
      "#4c1130",
    ];
    for (var idx = 0; idx < totalGroups; idx++) {
      var gName = orderedGroups[idx];
      var cIdx = masterGroups[gName].current;
      var nIdx = masterGroups[gName].next;

      var groupTheme = premiumColors[idx % premiumColors.length];
      for (var k = 0; k < 5; k++) {
        row2Colors[writeCol + k] = groupTheme;
        row3Colors[writeCol + k] = "#dbeaf1";
      }

      // 구별을 쉽게 2행 그룹 이름을 5셀 전체 길이에 중앙정렬 처리
      row2[writeCol] = gName;

      var exCol1 = "📊 최근변동분",
        exCol3 = "지난가(2)",
        exCol4 = "☑️ 익월변동단가";
      if (hubCurrentData.length > 2 && hubCurrentData[1]) {
        var exGroupCol = hubCurrentData[1].indexOf(gName);
        if (exGroupCol !== -1) {
          var _val1 = String(hubCurrentData[2][exGroupCol + 1]).trim();
          var _val3 = String(hubCurrentData[2][exGroupCol + 3]).trim();
          var _val4 = String(hubCurrentData[2][exGroupCol + 4]).trim();
          if (_val1) exCol1 = _val1;
          if (_val3) exCol3 = _val3;
          if (_val4) exCol4 = _val4;
        }
      }

      // [보존 로직] 사용자가 에디팅한 컬럼 이름 보존 (업데이트 시간 제거)
      row3[writeCol] = "✨ 최종단가";
      row3[writeCol + 1] = exCol1;
      row3[writeCol + 2] = "지난가(1)";
      row3[writeCol + 3] = exCol3;
      row3[writeCol + 4] = exCol4;

      for (var j = 5; j < maxRow; j++) {
        var dpIdx = j - 5;
        // 현재가
        var p =
          masterData[j] && masterData[j][cIdx] ? masterData[j][cIdx] : "-";
        p =
          !p || String(p).trim() === "" || String(p).indexOf("#") === 0
            ? "-"
            : p;

        dataMatrix[dpIdx][writeCol] = p; // 최종단가
        dataMatrix[dpIdx][writeCol + 1] = "-"; // 변동분(빈값)
        dataMatrix[dpIdx][writeCol + 2] = p; // 지난가(1) (현재는 기초동기화라 같게)
        dataMatrix[dpIdx][writeCol + 3] = "-"; // 지난가(2)

        // 익월가
        if (nIdx !== -1) {
          var np =
            masterData[j] && masterData[j][nIdx] ? masterData[j][nIdx] : "-";
          np =
            !np || String(np).trim() === "" || String(np).indexOf("#") === 0
              ? "-"
              : np;
          dataMatrix[dpIdx][writeCol + 4] = np;
        } else {
          dataMatrix[dpIdx][writeCol + 4] = "-";
        }
      }
      writeCol += 5;
    }

    // [단 1번의 통신으로 시트 전체 그리기] Row 1=그룹헤더, Row 2=서브헤더, Row 3+=데이터
    hubTab
      .getRange(1, 1, 1, totalCols)
      .setValues([row2])
      .setBackgrounds([row2Colors])
      .setFontColor("#ffffff")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    hubTab
      .getRange(2, 1, 1, totalCols)
      .setValues([row3])
      .setBackgrounds([row3Colors])
      .setFontColor("#1c4587")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);

    // 각 그룹의 1행 5칸 병합 (Row 1 = 그룹명)
    var mCol = 7;
    for (var idx = 0; idx < totalGroups; idx++) {
      hubTab.getRange(1, mCol, 1, 5).merge();
      mCol += 5;
    }

    if (dataRowsLength > 0) {
      hubTab.getRange(3, 1, dataRowsLength, totalCols).setValues(dataMatrix);
    }

    // 상태값 조건부 서식 (Row 3부터 = 데이터 영역)
    hubTab.clearConditionalFormatRules();
    var hubCondRange = hubTab.getRange(
      3,
      1,
      hubTab.getMaxRows() - 2,
      totalCols,
    );
    var hubRule1 = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=ISNUMBER(SEARCH("품절", $A3))')
      .setBackground("#f4cccc")
      .setRanges([hubCondRange])
      .build();
    var hubRule2 = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=ISNUMBER(SEARCH("단종", $A3))')
      .setBackground("#d9d9d9")
      .setRanges([hubCondRange])
      .build();
    var hubRule3 = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=ISNUMBER(SEARCH("재고까지만", $A3))')
      .setBackground("#fff2cc")
      .setRanges([hubCondRange])
      .build();
    hubTab.setConditionalFormatRules([hubRule1, hubRule2, hubRule3]);
    hubTab.setFrozenRows(2);

    SpreadsheetApp.flush(); // 모든 데이터를 서버에 완벽하게 꽂아넣고 확정합니다.
    props.setProperty("DB_CURRENT_SYNC_TIME", newTime);

    ui.alert(
      "✅ [업데이트 완료] 기존 허브(그리고 연결된 뷰어들)를 유지하며 디자인과 구조를 복구했습니다!",
    );
  } catch (e) {
    var dbg = getPermissionDebugSummary_();
    ui.alert("🚨 에러: " + e.message + "\n\n" + dbg);
  }
}

// 2. 동기화 (#DIV/0! 직접 처리 및 계산)
function syncGroupPrices(isAuto) {
  var ui = null;
  if (!isAuto) {
    try {
      ui = SpreadsheetApp.getUi();
    } catch (e) {}
    // 수동 실행 시 동시 실행 방지 락 확인
    if (!_acquireSyncLock_("통합허브단가 동기화")) return;
  }
  var props = PropertiesService.getScriptProperties();
  var hubId = getCanonicalHubIdFromProps_(props);
  if (!hubId) {
    if (!isAuto) _releaseSyncLock_();
    if (ui) ui.alert("1번을 눌러 깨끗한 허브를 먼저 구축하세요.");
    return;
  }

  try {
    var hubSS = getHubSS(hubId);
    var hubTab = hubSS.getSheetByName("전체 그룹 단가표");
    var masterSheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName("상품정보");
    var masterData = masterSheet.getDataRange().getValues();
    var masterHeaders1 = masterData[0]; // 1행
    var masterHeaders2 = masterData[1]; // 2행 (헤더)

    // 마스터 시트에서 그룹 현재가, 익월가 컬럼 인덱스 찾기
    var masterGroups = {};
    for (var k = 15; k < masterHeaders2.length; k++) {
      var gName = String(masterHeaders2[k]).trim();
      if (!gName || gName === "") gName = String(masterHeaders1[k]).trim();

      if (
        !gName ||
        gName.indexOf("변동가") !== -1 ||
        gName.indexOf("차액") !== -1
      )
        continue;

      if (!masterGroups[gName]) {
        masterGroups[gName] = { current: k, next: -1 };
      } else if (masterGroups[gName].next === -1) {
        masterGroups[gName].next = k;
      }
    }

    var hubData = hubTab.getDataRange().getValues();

    // 1. 기존 허브 데이터(과거가)를 품목코드 기준으로 안전하게 저장 (인덱스 밀림 완벽 극복)
    var hubHistoryMap = {};
    // 앞서 구한 dataStartIdx 부터 읽는 것이 안전하지만, 상단에서 아직 안 구했으므로 r=3 부터 훑어서 데이터면 모두 담습니다.
    for (var r = 3; r < hubData.length; r++) {
      var hdItemCode = String(hubData[r][2]).trim();
      if (hdItemCode !== "") {
        hubHistoryMap[hdItemCode] = hubData[r];
      }
    }

    // 2. 헤더 인덱스 자동 감지 (상태 문자열을 찾음)
    var groupRowIdx = 1; // Default
    for (var r = 0; r < 4; r++) {
      if (String(hubData[r][0]).replace(/\s/g, "") === "상태") {
        groupRowIdx = r;
        break;
      }
    }
    var subHeaderRowIdx = groupRowIdx + 1;
    var dataStartIdx = groupRowIdx + 2;

    // 새로운 허브 데이터 매트릭스 생성 (마스터 길이와 일치하도록 보장)
    var newHubData = [];
    for (var r = 0; r < dataStartIdx; r++) {
      newHubData.push(hubData[r]);
    }

    var time = Utilities.formatDate(new Date(), "Asia/Seoul", "MM.dd HH:mm");
    // 업데이트 시간을 설정 탭에 기록
    try {
      var settingsTab = hubSS.getSheetByName("설정");
      if (settingsTab) {
        settingsTab.getRange("B3").setValue("🕒 업데이트: " + time);
      }
    } catch (e) {}

    var hubGroups = [];
    for (var i = 6; i < hubData[groupRowIdx].length; i += 5) {
      var gName = String(hubData[groupRowIdx][i]).trim();
      if (gName && gName !== "") {
        var mInfo = masterGroups[gName];
        if (mInfo) {
          hubGroups.push({
            name: gName,
            wColIdx: i,
            mColIndex: mInfo.current,
            nextMonthIdx: mInfo.next,
          });
          newHubData[subHeaderRowIdx][i] = "✨ 최종단가";
          newHubData[subHeaderRowIdx][i + 2] = "지난가(1)";
        }
      }
    }

    // 3. 마스터 데이터를 순회하며 무결점 데이터 채우기 (마스터 최신 정렬 기준)
    var totalCols = hubData[0].length;
    for (var idx = 5; idx < masterData.length; idx++) {
      var mRow = masterData[idx];
      var itemCode = String(mRow[4]).trim();

      var newRow = new Array(totalCols).fill("-");
      newRow[0] = mRow[0] || ""; // 상태
      newRow[1] = mRow[1] || ""; // 출고지
      newRow[2] = mRow[4] || ""; // 품목코드
      newRow[3] = mRow[2] || ""; // 품목명
      newRow[4] = mRow[6] || ""; // 재고
      newRow[5] = mRow[23] || ""; // 소비자가

      // 고유 품목코드로 기존 기록 조회 (없으면 null 유지)
      var oldRecord = null;
      if (itemCode !== "" && hubHistoryMap[itemCode]) {
        oldRecord = hubHistoryMap[itemCode];
      }

      for (var g = 0; g < hubGroups.length; g++) {
        var grp = hubGroups[g];
        var wIdx = grp.wColIdx;

        // 마스터 현재가
        var curVal = mRow[grp.mColIndex];
        if (
          !curVal ||
          String(curVal).trim() === "" ||
          String(curVal).indexOf("#") === 0
        )
          curVal = "-";

        // 기존가(History) 추적
        var prevVal = "-";
        var prev2Val = "-";
        if (oldRecord) {
          prevVal = oldRecord[wIdx]; // 과거의 기준 최종단가
          prev2Val = oldRecord[wIdx + 2]; // 과거의 지난가(1)
        }

        // 마스터 익월가
        var nextVal = "-";
        if (grp.nextMonthIdx !== -1) {
          nextVal = mRow[grp.nextMonthIdx];
          if (
            !nextVal ||
            String(nextVal).trim() === "" ||
            String(nextVal).indexOf("#") === 0
          )
            nextVal = "-";
        }

        newRow[wIdx] = curVal; // 최종단가

        // 변동분 계산 로직
        var curNum = parseFloat(curVal);
        var prevNum = parseFloat(prevVal);
        if (!isNaN(curNum) && !isNaN(prevNum)) {
          newRow[wIdx + 1] = curNum - prevNum; // 변동분
        } else {
          newRow[wIdx + 1] = "-";
        }

        newRow[wIdx + 2] = prevVal; // 지난가(1)
        newRow[wIdx + 3] = prev2Val; // 지난가(2)
        newRow[wIdx + 4] = nextVal; // 익월가
      }
      newHubData.push(newRow);
    }

    // 허브 시트 크기 조정
    if (hubTab.getMaxRows() < newHubData.length) {
      hubTab.insertRowsAfter(
        hubTab.getMaxRows(),
        newHubData.length - hubTab.getMaxRows() + 10,
      );
    }

    // 데이터 붓기 전 기존 셀 데이터 초기화 (찌꺼기 제거)
    // dataStartIdx 행 다음부터 지웁니다 (보통 Row 3부터)
    hubTab
      .getRange(
        dataStartIdx + 1,
        1,
        Math.max(1, hubTab.getMaxRows() - dataStartIdx),
        totalCols,
      )
      .clearContent();

    // Row 1~2 에 걸린 세로 병합(A~F열) 때문에 통째로 setValues를 하면 Google Sheets에서 병합 에러를 발생시킵니다.
    // ★ 성능최적화: 서브 헤더는 G열(7열) 이후만 배치 기록 (병합 영역 회피)
    if (newHubData[subHeaderRowIdx] && totalCols > 6) {
      var subRow = newHubData[subHeaderRowIdx].slice(6); // G열(인덱스6)부터
      hubTab
        .getRange(subHeaderRowIdx + 1, 7, 1, subRow.length)
        .setValues([subRow]);
    }

    // 2. 순수 데이터 영역만 잘라내서 한꺼번에 setValues (Row 3 부터)
    var pureData = newHubData.slice(dataStartIdx);
    if (pureData.length > 0) {
      hubTab
        .getRange(dataStartIdx + 1, 1, pureData.length, totalCols)
        .setValues(pureData);
    }

    props.setProperty("DB_CURRENT_SYNC_TIME", time);
    if (ui)
      ui.alert(
        "🚀 동기화 완료! 늘어난 상품 줄까지 모두 완벽하게 동기화되었습니다.",
      );
  } catch (e) {
    if (ui)
      ui.alert("🚨 에러: " + e.message + "\n\n" + getPermissionDebugSummary_());
    else console.error("syncGroupPrices 에러: " + e.message);
  } finally {
    if (!isAuto) _releaseSyncLock_();
  }
}

// [정기 업데이트] 배포 시트(전체)를 최신 단가/공지 반영 상태로 업데이트하는 함수
function updateAllVendorSheets(opts) {
  opts = opts || {};
  var isSilent = !!opts.silent;
  var modeLabel = isSilent ? "scheduled" : "manual";
  var allowInteractiveRepair =
    opts.allowInteractiveRepair === false ? false : !isSilent;

  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e0) {}

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    appendVendorUpdateLogRow_({
      mode: modeLabel,
      message:
        "다른 업데이트 작업이 이미 실행 중입니다. 잠시 후 다시 실행해주세요.",
      errorCode: "LOCK_NOT_AVAILABLE",
    });
    setVendorUpdateScriptHealth_(false, "LOCK_NOT_AVAILABLE");
    if (ui && !isSilent) {
      ui.alert(
        "다른 업데이트 작업이 이미 실행 중입니다. 잠시 후 다시 실행해주세요.",
      );
    }
    return;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var runLimit = computeAdaptiveRunLimit_(opts, props);
    var hubId = getCanonicalHubIdFromProps_(props);
    if (!hubId) {
      appendVendorUpdateLogRow_({
        mode: modeLabel,
        runLimit: runLimit,
        message:
          "[오류] 통합허브 1행 메뉴에서 동기화를 먼저 해야 합니다. (DB_HUB_ID 없음)",
        errorCount: 1,
        errorCode: "HUB_NOT_CONFIGURED",
      });
      setVendorUpdateScriptHealth_(false, "HUB_NOT_CONFIGURED");
      return ui && !isSilent
        ? ui.alert("❌ [오류] 통합허브 1행 메뉴에서 동기화를 먼저 해야 합니다.")
        : null;
    }

    // 운영 안정성: CUST_CD 미매핑 업체가 있으면 업데이트를 차단해 데이터 불일치 방지
    var requireCustCd = opts.requireCustCd === false ? false : true;
    // 수동 메뉴 의존 제거: 업데이트 시작 시 매핑 복구를 자동 선행
    try {
      if (typeof runVendorMapRepairAll === "function") {
        runVendorMapRepairAll(true);
      } else {
        if (typeof setupVendorCustCodeMappingSheet === "function") {
          setupVendorCustCodeMappingSheet(true);
        }
        if (typeof applyCustCodeToExistingVendorSheets === "function") {
          applyCustCodeToExistingVendorSheets(true);
        }
      }
    } catch (autoMapErr) {
      appendVendorUpdateLogRow_({
        mode: modeLabel,
        runLimit: runLimit,
        message:
          "매핑 자동복구 선행 실패: " +
          String(
            autoMapErr && autoMapErr.message ? autoMapErr.message : autoMapErr,
          ),
        errorCount: 1,
        errorCode: "MAP_REPAIR_PRECHECK_FAIL",
      });
    }

    // CUST_CD 미입력 파일 ID 목록 (전체 중단 대신 해당 파일만 스킵)
    var custCdSkipIds = {};
    var custCdSkipCount = 0;
    if (false && typeof validateVendorCustMappingReady_ === "function") {
      try {
        var mappingCheck = validateVendorCustMappingReady_(
          SpreadsheetApp.getActiveSpreadsheet(),
        );
        if (!mappingCheck.ok) {
          // 전체 중단 → 미입력 파일만 스킵 목록에 등록하고 나머지 업체는 정상 진행
          var skipFids = mappingCheck.missingFileIds || [];
          for (var si = 0; si < skipFids.length; si++)
            custCdSkipIds[skipFids[si]] = true;
          custCdSkipCount = mappingCheck.missingCount;
          var warnMsg =
            "CUST_CD 미입력 " +
            custCdSkipCount +
            "개 업체는 스킵됩니다: " +
            (mappingCheck.message || "");
          try {
            Logger.log("[MAP_MISSING_CUSTCD_SKIP] " + warnMsg);
          } catch (_) {}
          if (ui && !isSilent) {
            try {
              SpreadsheetApp.getActiveSpreadsheet().toast(
                "⚠ " + warnMsg,
                "매핑 경고",
                8,
              );
            } catch (_) {}
          }
        }
      } catch (mapErr) {
        // 가드 자체가 실패하면 절대 '성공'으로 흘러가게 두지 말 것.
        // 예외가 났다는 것 자체가 매핑 검증이 불완전하다는 신호이므로 업데이트를 중단한다.
        var mapErrMsg = String(
          mapErr && mapErr.message ? mapErr.message : mapErr,
        );
        try {
          Logger.log("[MAP_GUARD_EXCEPTION] " + mapErrMsg);
        } catch (_) {}
        appendVendorUpdateLogRow_({
          mode: modeLabel,
          runLimit: runLimit,
          message:
            "매핑 사전검증 중 예외 발생 (안전을 위해 업데이트 중단): " +
            mapErrMsg,
          errorCount: 1,
          errorCode: "MAP_GUARD_EXCEPTION",
        });
        setVendorUpdateScriptHealth_(false, "MAP_GUARD_EXCEPTION");
        if (ui && !isSilent) {
          ui.alert(
            "⚠️ 매핑 사전검증 중 예외가 발생해 안전을 위해 업데이트를 중단했습니다.\n\n" +
              mapErrMsg,
          );
        }
        return;
      }
    }

    if (!isSilent && ui) {
      var response = ui.alert(
        "🔄 배포 시트 일괄 업데이트 (순차 처리)",
        "부하를 줄이기 위해 한 번에 최대 " +
          runLimit +
          "개만 처리하고, 다음 실행 시 이어서 진행합니다.\n\n계속할까요?",
        ui.ButtonSet.YES_NO,
      );
      if (response !== ui.Button.YES) return;
    }

    var deployFiles = listDeployFilesSorted_();
    var updatedCount = 0;
    var startTime = new Date().getTime();
    var errorLog = [];
    var targetCount = 0;
    var standardCount = 0;
    var consumerCount = 0;
    var legacyMetaCount = 0;
    var migratedMetaCount = 0;
    var dcRateUpdatedCount = 0;
    var custCdAppliedCount = 0;
    var policyAppliedCount = 0;
    var policyDropdownEnabledCount = 0;
    var policyInvoiceReplyEnabledCount = 0;
    var policyFallbackCount = 0;
    var policyNameMatchCount = 0;
    var applyDoneCount = 0;
    var applyPendingCount = 0;
    var applyScheduledWaitCount = 0;
    var applySkipCount = 0;
    var mapFallbackCount = 0;
    var processedThisRun = 0;
    var custMapBundle = loadVendorCustCdMap_();
    var mapPolicySheet = null;
    try {
      var mapInfoForPolicy = resolveVendorMapSheetForPriceManager_();
      mapPolicySheet = mapInfoForPolicy.sheet;
      if (
        mapPolicySheet &&
        typeof validateVendorMapCoreColumns_ === "function"
      ) {
        validateVendorMapCoreColumns_(mapPolicySheet);
      }
    } catch (eMapPolicy) {}
    var cursorIndex = parseInt(
      props.getProperty(VENDOR_UPDATE_CURSOR_KEY) || "0",
      10,
    );
    if (!cursorIndex || cursorIndex < 0) cursorIndex = 0;
    if (cursorIndex >= deployFiles.length) cursorIndex = 0;
    var hasMore = false;
    var nextCursorIndex = cursorIndex;
    var runStartMs = new Date().getTime();
    var hubGroupColumnMap = {};
    try {
      var hubSheetForGroups =
        getHubSS(hubId).getSheetByName("전체 그룹 단가표");
      if (hubSheetForGroups) {
        var hubHeaders1 = hubSheetForGroups
          .getRange(1, 1, 1, hubSheetForGroups.getLastColumn())
          .getValues()[0];
        hubGroupColumnMap = buildHubGroupColumnMap_(hubHeaders1);
      }
    } catch (eHubGroup) {}

    for (var fIdx = cursorIndex; fIdx < deployFiles.length; fIdx++) {
      if (new Date().getTime() - startTime > 330000) {
        // 5.5분 (12개 파일 한번에 처리)
        props.setProperty(VENDOR_UPDATE_CURSOR_KEY, String(nextCursorIndex));
        // 3분 타임리밋 도달: 부분 완료 상태를 로그/헬스에 반드시 기록.
        // (silent 스케줄 실행에서 '중단됨'이 사후추적 가능하도록)
        appendVendorUpdateLogRow_({
          mode: modeLabel,
          runLimit: runLimit,
          targetCount: targetCount,
          updatedCount: updatedCount,
          standardCount: standardCount,
          consumerCount: consumerCount,
          legacyMetaCount: legacyMetaCount,
          migratedMetaCount: migratedMetaCount,
          dcRateUpdatedCount: dcRateUpdatedCount,
          custCdAppliedCount: custCdAppliedCount,
          applyDoneCount: applyDoneCount,
          applyPendingCount: applyPendingCount,
          applyScheduledWaitCount: applyScheduledWaitCount,
          applySkipCount: applySkipCount,
          mapFallbackCount: mapFallbackCount,
          hasMore: true,
          errorCount: errorLog.length,
          errorCode: "TIME_LIMIT_REACHED",
          message:
            "3분 실행 제한 도달 · 커서 " +
            nextCursorIndex +
            " 저장" +
            (errorLog.length > 0
              ? " · 부분오류 " + errorLog.length + "건"
              : ""),
        });
        setVendorUpdateScriptHealth_(false, "TIME_LIMIT_REACHED");
        if (ui && !isSilent) {
          ui.alert(
            "⚠️ 작업 제한 시간 도달\n\n구글 스크립트 실행 제한에 도달할 수 있어 잠시 멈춥니다.\n\n현재까지 " +
              updatedCount +
              "개 시트가 업데이트되었습니다.\n" +
              "- 대상 탐색: " +
              targetCount +
              "개\n" +
              "- 일반: " +
              standardCount +
              "개\n" +
              "- 소비자: " +
              consumerCount +
              "개\n" +
              "- 구버전 메타 감지: " +
              legacyMetaCount +
              "개\n" +
              "- 메타 갱신 완료: " +
              migratedMetaCount +
              "개\n" +
              "- 소비자 DC율 보정: " +
              dcRateUpdatedCount +
              "개\n" +
              "- 업체코드(CUST_CD) 동기화: " +
              custCdAppliedCount +
              "개\n" +
              (custCdSkipCount > 0
                ? "⚠ CUST_CD 미입력 스킵: " + custCdSkipCount + "개\n"
                : "") +
              "\n다시 메뉴를 눌러 이어서 진행해주세요.",
          );
        }
        return;
      }

      if (processedThisRun >= runLimit) {
        hasMore = true;
        break;
      }

      var file = deployFiles[fIdx];

      // CUST_CD 미입력 업체: 해당 파일만 스킵하고 커서는 진행 (processedThisRun 미차감)
      if (custCdSkipIds[file.id]) {
        nextCursorIndex = fIdx + 1;
        errorLog.push("[CUST_CD 미입력 스킵] " + file.name);
        applySkipCount++;
        try {
          Logger.log("[CUST_CD_SKIP] " + file.name);
        } catch (_) {}
        continue;
      }

      processedThisRun++;
      nextCursorIndex = fIdx + 1;
      targetCount++;
      try {
        var ss = SpreadsheetApp.openById(file.id);
        // 일반 배포는 "업체명 뷰어", 소비자 DC 배포는 "업체명 단가조회".
        // findViewerSheet_는 "마감" 탭을 제외하고 "단가조회"/"뷰어"가 포함된 탭을 찾는다.
        // ⚠ 과거 getSheets()[0] fallback이 있었으나, 아카이브/마감 탭이 맨 앞일 때
        //    거기에 수식/메타를 덮어써 터지는 사고가 있어 제거함. 못 찾으면 에러로 기록하고 스킵.
        var sheet =
          typeof findViewerSheet_ === "function" ? findViewerSheet_(ss) : null;
        if (!sheet) sheet = ss.getSheetByName("단가조회");
        if (!sheet) {
          errorLog.push(
            "[" +
              file.name +
              "] 뷰어/단가조회 탭을 찾지 못해 스킵 (탭명 확인 필요)",
          );
          try {
            Logger.log(
              "[VIEWER_TAB_NOT_FOUND] " + file.name + " (" + file.id + ")",
            );
          } catch (_) {}
          continue;
        }
        var normalizedVendor = normalizeVendorNameFromDeployFile_(file.name);
        var normalizedVendorKey = normalizeVendorKeyForMap_(file.name);
        var currentCustInSheet = String(
          sheet.getRange("AB1").getValue() || "",
        ).trim();
        // 거래처명은 이름이 아니라 코드(CUST_CD) 기준을 최우선으로 매칭
        var matchedRow =
          (currentCustInSheet
            ? custMapBundle.byCustCd[currentCustInSheet]
            : null) ||
          custMapBundle.byFileId[file.id] ||
          custMapBundle.byVendor[normalizedVendor] ||
          custMapBundle.byVendorNorm[normalizedVendorKey] ||
          custMapBundle.byDeployNameNorm[normalizedVendorKey];

        var applyDecision = shouldApplyVendorByMode_(
          matchedRow,
          new Date().getTime(),
        );
        if (!applyDecision.apply) {
          if (applyDecision.reason === "scheduled_wait")
            applyScheduledWaitCount++;
          else applyPendingCount++;
          applySkipCount++;
          continue;
        }

        if (matchedRow) {
          var mappedCustCd = String(matchedRow.custCd || "").trim();
          var mappedVendorName = String(
            matchedRow.vendor || normalizedVendor || "",
          ).trim();
          // 🚨 [중요] AA1/AB1에 정적 setValue를 박지 않는다.
          //   applyViewerIdentityFormulaFromHubMap_()가 두 셀 모두 IMPORTRANGE 수식으로 덮어쓰므로,
          //   여기서 setValue를 하면 직후 수식에 덮여 버려지고 쓰기 작업만 2회 낭비된다.
          //   또한 예전엔 이 정적 setValue 때문에 매핑시트 수정이 반영 안 된 것처럼 보이는 고질병이 있었다.
          if (mappedCustCd) custCdAppliedCount++;
        }
        applyViewerIdentityFormulaFromHubMap_(sheet, hubId, file.id);
        // IMPORTRANGE 권한/연결 실패 시 매핑표 값을 즉시 fallback 적용해 운영 중단을 방지
        try {
          SpreadsheetApp.flush();
          var aaAfter = String(sheet.getRange("AA1").getValue() || "").trim();
          var linkFailed =
            aaAfter.indexOf("[매핑연결실패]") === 0 ||
            aaAfter.indexOf("[매핑없음:") === 0;
          if (linkFailed && matchedRow) {
            var fbVendor = String(
              matchedRow.vendor || normalizedVendor || "",
            ).trim();
            var fbCust = String(matchedRow.custCd || "").trim();
            if (fbVendor)
              sheet.getRange("AA1").setValue(fbVendor).setFontColor("white");
            if (fbCust)
              sheet.getRange("AB1").setValue(fbCust).setFontColor("white");
            mapFallbackCount++;
          }
        } catch (eMapFallback) {}
        try {
          var localIdentity = applyLocalVendorIdentityOverride_(
            ss,
            sheet,
            matchedRow ? matchedRow.vendor : normalizedVendor,
            matchedRow ? matchedRow.custCd : "",
          );
          if (localIdentity && localIdentity.warning) {
            errorLog.push("[" + file.name + "] " + localIdentity.warning);
          }
        } catch (eLocalIdentity) {}
        // P4 최적화: 과거 A1, AA1, K1, K2를 각각 getValue()로 4번 읽었으나
        //   이제 A1:AB2 (2행 × 28열) 한 블록을 1회 getValues로 가져와 인덱싱한다.
        //   열 인덱스: A=0, K=10, AA=26, AB=27
        var topBlock = sheet.getRange(1, 1, 2, 28).getValues();
        var aa1Val = topBlock[0][26];
        var a1Value = String(topBlock[0][0]);
        var k1CurVal = topBlock[0][10];
        var k2CurVal = topBlock[1][10];

        // A열 표시는 매핑된 거래처명(코드 기준)으로 고정
        var resolvedVendorName = String(
          (matchedRow && matchedRow.vendor) || aa1Val || normalizedVendor || "",
        ).trim();

        // ── 공지 행 마이그레이션: 구버전(헤더가 Row 1) → 신버전(공지 Row 1 + 헤더 Row 2) ──
        var noticePresent = a1Value.indexOf("공지") !== -1;

        var K1 = null;
        if (noticePresent) {
          if (k2CurVal) K1 = parseInt(k2CurVal, 10);
        } else {
          if (k1CurVal) K1 = parseInt(k1CurVal, 10);
          sheet.insertRowBefore(1); // 기존 Row 1을 Row 2로 밀기 (K1은 K2 자동 이동)
          noticePresent = true;
        }

        // [핵심 패치2] K1/K2 셀이 삭제되어 훼손된 시트 자동 복구 로직 강화
        if (!K1 || isNaN(K1)) {
          // 1차 시도: 기존 G3 셀의 IMPORTRANGE 수식에서 주소를 파싱하여 완벽히 역추적
          try {
            var g3Formula = sheet.getRange("G3").getFormula();
            var numMatch = g3Formula.match(/ADDRESS\(1,\s*([0-9]+),\s*4\)/);
            if (numMatch && numMatch[1]) {
              K1 = parseInt(numMatch[1], 10);
            }
          } catch (e) {}

          if (!K1 || isNaN(K1)) {
            // 2차 시도: 사용자가 파일명을 그룹명과 다르게 지었을 가능성이 높으므로 팝업으로 직접 구조 요청
            var hubTab = getHubSS(hubId).getSheetByName("전체 그룹 단가표");
            var hubHeaders = hubTab
              .getRange(1, 1, 1, hubTab.getLastColumn())
              .getValues()[0];
            var hubGroupsList = [];
            for (var col = 6; col < hubHeaders.length; col += 5) {
              var hgName = String(hubHeaders[col]).trim();
              if (hgName) hubGroupsList.push(hgName);
            }

            if (allowInteractiveRepair && ui) {
              var promptResp = ui.prompt(
                "🔧 끊어진 시트 연결 복구",
                "주의: [" +
                  file.name +
                  "] 시트가 어느 단가 그룹을 쓰는지 판별할 수 없습니다.\n" +
                  "(업체명과 그룹명이 다르거나 숨김 좌표가 지워짐)\n\n" +
                  "이 매장이 연결될 올바른 [그룹명]을 정확히 입력해주세요.\n(취소 누르면 건너뜀)\n\n" +
                  "※ 허브 그룹 목록: " +
                  hubGroupsList.join(", "),
                ui.ButtonSet.OK_CANCEL,
              );
              if (promptResp.getSelectedButton() === ui.Button.OK) {
                var typedGroup = promptResp.getResponseText().trim();
                for (var col = 6; col < hubHeaders.length; col += 5) {
                  if (String(hubHeaders[col]).trim() === typedGroup) {
                    K1 = col + 1; // 7, 12, 17...
                    break;
                  }
                }
              }
            }
          }
        }

        var mapGroup = String(
          (matchedRow && matchedRow.groupName) || "",
        ).trim();
        var exceptionGroupEnabled =
          String(
            (matchedRow && matchedRow.exceptionEnabled) || "N",
          ).toUpperCase() === "Y";
        var exceptionGroup = String(
          (matchedRow && matchedRow.exceptionGroup) || "",
        ).trim();
        var effectiveGroup =
          exceptionGroupEnabled && exceptionGroup ? exceptionGroup : mapGroup;
        if (effectiveGroup && hubGroupColumnMap[effectiveGroup]) {
          K1 = hubGroupColumnMap[effectiveGroup];
        }

        // 그래도 못 찾으면 건너뜀
        if (!K1 || isNaN(K1)) {
          var vName = file.name
            .replace(/\[독립\s*배포\]/g, "")
            .replace(/\s*\(소비자용\)\s*.*$/, "")
            .trim();
          var debugMsg = "추출된이름: [" + vName + "], 수동복구 제외됨";
          errorLog.push(
            "⚠️ [" + file.name + "] 좌표 복구 실패. (" + debugMsg + ")",
          );
          applySkipCount++;
          continue;
        }

        // [핵심 패치] 통합 허브 열 2개 추가(출고지, 재고)로 인한 K2 오프셋 이동 마이그레이션
        // 구버전 K2: 5, 10, 15... (K1 % 5 === 0)
        // 신버전 K2: 7, 12, 17... (K1 % 5 === 2)
        if (K1 % 5 === 0) {
          K1 += 2;
        }
        // 구해진 안전한 좌표값을 K2에 강력하게 각인
        sheet.getRange("K2").setValue(K1).setFontColor("white");

        // 공지 행 (Row 1) 갱신
        ensureNoticeRowLinked_(sheet, hubId);

        // 헤더 갱신 (Row 2, 10개 열 신규 구조 적용)
        // 생성 시(partnerCreateSheet)와 동일하게 설정 탭(B2) 제목을 기준으로 유지
        // (강제 업데이트 실행 시 타이틀이 사라지거나 기본값으로 되돌아가는 현상 방지)
        var customTitleForm = buildDeployTitleFormula_(hubId);

        var deployMeta = readDeploySheetMeta_(sheet, file.name);
        if (
          !deployMeta.schema ||
          deployMeta.schema !== DEPLOY_SHEET_SCHEMA_VERSION
        ) {
          legacyMetaCount++;
        }
        var policyForThisFile = resolveVendorPolicyForFile_(
          mapPolicySheet,
          file.id,
          file.name,
          deployMeta.type === "consumer" ? "일괄DC" : "대리판매",
        );
        var isConsumer = deployMeta.type === "consumer";
        var policyDcRate = normalizeDcRateNumber_(
          policyForThisFile.dcRate,
          NaN,
        );
        var consumerRate = !isNaN(policyDcRate)
          ? policyDcRate
          : deployMeta.dcRate
            ? normalizeDcRateNumber_(deployMeta.dcRate, NaN)
            : parseConsumerDiscountRateFromName_(file.name);
        consumerRate = normalizeDcRateNumber_(consumerRate, 5);
        if (
          isConsumer &&
          String(deployMeta.dcRate || "") !== String(consumerRate)
        ) {
          dcRateUpdatedCount++;
        }
        if (isConsumer) consumerCount++;
        else standardCount++;
        var codeHeader = isConsumer ? "이카운트코드(입력👇)" : "이카운트코드";

        // 🚨 [초강력 복구 패치] 업체에서 2행 이하나 3행 등을 임의로 병합(#REF 방지용 clearContent 충돌 원인)하거나 숨겨서 setValues가 튕기는 현상 원천 봉쇄
        try {
          sheet.getRange("A2:Z").breakApart();
          sheet.showRows(1, sheet.getMaxRows() || 1000); // 3행 숨김 강제 해제
        } catch (e) {}

        sheet
          .getRange("A2:J2")
          .setValues([
            [
              "상태",
              "출고지",
              codeHeader,
              "품목명",
              "재고",
              "소비자가",
              "최종단가",
              "단가변동",
              "지난단가",
              "-",
            ],
          ]);
        sheet.getRange("J2").setFormula(customTitleForm);
        sheet
          .getRange("A2:J2")
          .setBackground("#cfe2f3")
          .setFontColor("#000000")
          .setFontWeight("bold")
          .setHorizontalAlignment("center");
        if (isConsumer) {
          sheet.getRange("C2").setBackground("#fff2cc"); // 입력칸 시각적 강조
        } else {
          sheet.getRange("C2").setBackground("#cfe2f3"); // 일반 헤더와 동일하게
        }
        sheet.setFrozenRows(2); // 공지행 + 헤더행 고정

        // 찌꺼기 완벽 청소 (배포 시트의 단가조회 탭 수식 충돌 #REF! 방지)
        if (!isConsumer) {
          try {
            sheet.getRange("A3:Z").clearContent();
          } catch (e) {}
        } else {
          try {
            sheet.getRange("A3:B").clearContent();
            sheet.getRange("D3:Z").clearContent();
          } catch (e) {}
        }

        // 최신 수식 덮어쓰기 (K2 활용, Row 3부터 데이터)
        var hubLink = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!';
        var ids = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!C:C")';

        sheet
          .getRange("A3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
              ids +
              ", " +
              hubLink +
              'A:A")), "-")))',
          );
        sheet
          .getRange("B3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
              ids +
              ", " +
              hubLink +
              'B:B")), "-")))',
          );
        if (isConsumer) {
          sheet.getRange("C3").clearContent(); // 잔여 수식 무결성 청소
        } else {
          sheet
            .getRange("C3")
            .setFormula(
              '=IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!C3:C")',
            );
        }
        sheet
          .getRange("D3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
              ids +
              ", " +
              hubLink +
              'D:D")), "-")))',
          );
        sheet
          .getRange("E3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
              ids +
              ", " +
              hubLink +
              'E:E")), "-")))',
          );
        sheet
          .getRange("F3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
              ids +
              ", " +
              hubLink +
              'F:F")), "-")))',
          );

        // K2 기준 동적 단가 열 참조 (소비자 시트는 소비자가 기준 DC 계산)
        var gRange =
          'SUBSTITUTE(ADDRESS(1, K2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2, 4), "1", "")';
        if (isConsumer) {
          var dcMultiplier = (100 - consumerRate) / 100;
          sheet
            .getRange("G3")
            .setFormula(
              '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(F3:F="-", "-", ROUNDUP(F3:F*' +
                dcMultiplier +
                ', -2)), "-")))',
            );
        } else {
          sheet
            .getRange("G3")
            .setFormula(
              '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
                ids +
                ', IMPORTRANGE("' +
                hubId +
                '", "전체 그룹 단가표!" & ' +
                gRange +
                ')), "-")))',
            );
        }

        var iRangeFormula =
          'SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "")';

        // ── [핵심] 헤더/수식 전체 영역의 과거 허브 ID → 최신 ID 교체 (수식 파괴 없이 ID만 최신화) ──
        // A1:AH10 범위 — 3행 수식, AE~AH IMPORTRANGE 권한셀까지 포함
        var headerRange = sheet.getRange("A1:AH10");
        var headerFormulas = headerRange.getFormulas();
        var headerChanged = false;
        for (var hr = 0; hr < headerFormulas.length; hr++) {
          for (var hc = 0; hc < headerFormulas[hr].length; hc++) {
            var fh = headerFormulas[hr][hc];
            if (fh && fh.toUpperCase().indexOf("IMPORTRANGE") !== -1) {
              var newFh = fh.replace(
                /(IMPORTRANGE\s*\(\s*["'])[a-zA-Z0-9_-]{40,46}(["'])/gi,
                "$1" + hubId + "$2",
              );
              if (newFh !== fh) {
                headerFormulas[hr][hc] = newFh;
                headerChanged = true;
              }
            }
          }
        }
        if (headerChanged) {
          headerRange.setFormulas(headerFormulas);
        }

        sheet
          .getRange("I3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
              ids +
              ', IMPORTRANGE("' +
              hubId +
              '", "전체 그룹 단가표!" & ' +
              iRangeFormula +
              ')), "-")))',
          );

        sheet
          .getRange("H3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(G3:G=I3:I, "-", G3:G-I3:I), "-")))',
          );

        // 서식 최신화 (10열 기준)
        var maxRows = sheet.getMaxRows();
        var maxDataRowLength = Math.max(2, maxRows - 2);

        if (sheet.getMaxColumns() < 10) {
          sheet.insertColumnsAfter(
            sheet.getMaxColumns(),
            10 - sheet.getMaxColumns(),
          );
        }

        // 숫자 포맷 등 조정
        sheet.getRange(3, 5, maxDataRowLength, 5).setNumberFormat("#,##0"); // E(재고)~I(지난단가)
        sheet.getRange(3, 5, maxDataRowLength, 1).setFontColor("blue"); // E: 재고
        sheet.getRange(3, 6, maxDataRowLength, 1).setFontColor("red"); // F: 소비자가
        sheet
          .getRange(3, 7, maxDataRowLength, 1)
          .setFontColor("#c90000")
          .setFontWeight("bold"); // G: 최종단가
        sheet.getRange(3, 8, maxDataRowLength, 1).setFontColor("blue"); // H: 단가변동

        // 공지 팝업용 숨김 셀 (Y1) 등 추가
        if (sheet.getMaxColumns() < 26) {
          sheet.insertColumnsAfter(
            sheet.getMaxColumns(),
            26 - sheet.getMaxColumns(),
          );
        }
        sheet
          .getRange("Y1")
          .setFormula('=IFERROR(IMPORTRANGE("' + hubId + '", "설정!B1"), "")')
          .setFontColor("white");
        sheet
          .getRange("Z1")
          .setFormula('=IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!A1")')
          .setFontColor("white");
        // 조건부 서식 마이그레이션 적용
        sheet.clearConditionalFormatRules();
        var vUpRange = sheet.getRange(3, 1, maxDataRowLength, 8); // A3:H
        var upRulePink = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=ISNUMBER(SEARCH("품절", $A3))')
          .setBackground("#f4cccc")
          .setRanges([vUpRange])
          .build();
        var upRuleGray = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=ISNUMBER(SEARCH("단종", $A3))')
          .setBackground("#d9d9d9")
          .setRanges([vUpRange])
          .build();
        var upRuleYellow = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=ISNUMBER(SEARCH("재고", $A3))')
          .setBackground("#ffe599")
          .setRanges([vUpRange])
          .build();
        sheet.setConditionalFormatRules([upRulePink, upRuleGray, upRuleYellow]);

        // ── [신규 플러그인] 단가조회 탭 무결성 보호(락) 기능 적용 ──
        try {
          var protections = sheet.getProtections(
            SpreadsheetApp.ProtectionType.SHEET,
          );
          for (var pIdx = 0; pIdx < protections.length; pIdx++)
            protections[pIdx].remove();
          var rangeProtections = sheet.getProtections(
            SpreadsheetApp.ProtectionType.RANGE,
          );
          for (var pIdx = 0; pIdx < rangeProtections.length; pIdx++)
            rangeProtections[pIdx].remove();

          if (!isConsumer) {
            // 일반 배포 뷰어는 시트 전체 잠금 (행/열 치수 변경 일체금지)
            var sheetProtection = sheet
              .protect()
              .setDescription("단가조회 무결성 락");
            sheetProtection.removeEditors(sheetProtection.getEditors());
          } else {
            // 소비자 배포 뷰어는 C열(입력창) 제외한 나머지(1~3행 포함) 완전 잠금
            var p1 = sheet
              .getRange("1:3")
              .protect()
              .setDescription("헤더 완전 잠금");
            p1.removeEditors(p1.getEditors());
            var p2 = sheet
              .getRange("A4:B")
              .protect()
              .setDescription("상태/출고지 락");
            p2.removeEditors(p2.getEditors());
            var p3 = sheet
              .getRange("D4:J")
              .protect()
              .setDescription("단가 결과 락");
            p3.removeEditors(p3.getEditors());
          }
        } catch (e) {}

        // ── [신규 플러그인] 기존 시트에도 '발주 탭 및 자동완성 드롭다운' 강제 주입/업데이트 ──
        var orderTabName = "발주 및 송장조회";
        var orderTab = ss.getSheetByName(orderTabName);
        if (!orderTab) {
          orderTab = ss.insertSheet(orderTabName);
          orderTab.getRange("A2:A1000").setBackground("#ffffff");
          orderTab.getRange("C2:D1000").setBackground("#fff2cc"); // 드롭다운 대상
          orderTab.getRange("E2:F1000").setBackground("#d9ead3");
          orderTab.getRange("H2:H1000").setBackground("#d9ead3");
          orderTab.setFrozenRows(1);
          orderTab.getRange("A2:Z1000").setVerticalAlignment("middle");
        }

        // 헤더는 신규/기존 상관없이 무조건 덮어씌워 누락된 정산단가/고유ID 열 추가
        var defaultHeaders = [
          "거래처명",
          "주문일자(YYYYMMDD)",
          "이카운트코드",
          "품목명",
          "수량",
          "수취인",
          "수취인전화번호",
          "수취인주소",
          "배송메시지",
          "적요",
          "송장번호",
          "정산금액",
          "고유ID",
        ];
        orderTab
          .getRange(1, 1, 1, defaultHeaders.length)
          .setValues([defaultHeaders])
          .setBackground("#4a86e8")
          .setFontColor("white")
          .setFontWeight("bold")
          .setHorizontalAlignment("center");
        orderTab.getRange("J1:K1").setBackground("#38761d");
        orderTab.getRange("L1:M1").setBackground("#990000"); // 정산/ID 강조
        orderTab.getRange("L2:L1000").setNumberFormat("#,##0");

        // B열은 누락 시만 오늘 날짜 보정
        // A열은 A1 spill 수식 결과 영역이므로 절대 직접 setValues 하지 않는다.
        var orderLastRow = orderTab.getLastRow();
        if (orderLastRow >= 2) {
          var rowCount = orderLastRow - 1;
          var abcd = orderTab.getRange(2, 1, rowCount, 4).getValues();
          var bVals = [];
          var bTouched = false;
          var todayYmd = Utilities.formatDate(
            new Date(),
            "Asia/Seoul",
            "yyyyMMdd",
          );
          for (var rr = 0; rr < abcd.length; rr++) {
            var cCode = String(abcd[rr][2] || "").trim();
            var dName = String(abcd[rr][3] || "").trim();
            var hasOrderKey = cCode || dName;
            var curB = abcd[rr][1];
            if (hasOrderKey && !String(curB || "").trim()) {
              curB = todayYmd;
              bTouched = true;
            }
            bVals.push([curB]);
          }
          if (bTouched) {
            orderTab.getRange(2, 2, rowCount, 1).setValues(bVals);
          }
        }

        // A1/L1에 spill 수식 주입 (A2 단일 삭제 원천 차단 + 헤더 텍스트도 수식 결과로 보호)
        var viewerTabName = sheet.getName();
        injectOrderSpillFormulas_(orderTab, viewerTabName);

        // C열은 사용자 입력(이카운트코드)이므로 절대 일괄 비우지 않는다.
        // 드롭다운으로 D열만 입력된 건은 품목명→코드 역매핑으로 보정.
        try {
          backfillOrderCodesFromItemName_(orderTab, sheet);
        } catch (eCodeBackfill) {}

        // [구글 시트 버그 회피용] 단가조회 탭이 락(보호) 걸려있으면 파란색 액세스 허용 버튼이 구글 버그로 안 뜹니다.
        // 따라서 보호가 풀려있는 발주 탭의 순백색 영역(Z2)에 권한 뚫기 전용 수식을 이중으로 설치합니다.
        orderTab
          .getRange("Z2")
          .setFormula('=IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!A1")')
          .setFontColor("white");

        // 발주 탭의 중요한 영역 보호 (업체에서 임의 조작 방지)
        try {
          var oProtections = orderTab.getProtections(
            SpreadsheetApp.ProtectionType.RANGE,
          );
          for (var pIdx = 0; pIdx < oProtections.length; pIdx++)
            oProtections[pIdx].remove();

          // 1. 헤더 구조 변경 원천 차단
          var headerProtect = orderTab
            .getRange("1:1")
            .protect()
            .setDescription("발주 시트 헤더 락");
          headerProtect.removeEditors(headerProtect.getEditors());

          // 2. [사장님 요청] 정산단가(L열) 및 고유ID(M열) 조작 방지 락 체결
          var abProtect = orderTab
            .getRange("A:B")
            .protect()
            .setDescription("거래처/주문일자 수동입력 방지");
          abProtect.removeEditors(abProtect.getEditors());
          var priceProtect = orderTab
            .getRange("L:M")
            .protect()
            .setDescription("정산금액 조작 방지");
          priceProtect.removeEditors(priceProtect.getEditors());
        } catch (e) {}

        // 기존 업체 운영 차이를 존중하기 위해 업데이트 시 드롭다운을 강제 주입하지 않는다.
        // (필요 업체는 생성 단계 선택 또는 수동 적용)

        // 발주 탭 조건부 서식 업데이트
        orderTab.clearConditionalFormatRules();
        var oRange = orderTab.getRange("A2:K1000");
        var oRulePink = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=AND(ISTEXT($J2), $J2<>"", $J2<>"발송완료")')
          .setBackground("#f4cccc")
          .setFontColor("red")
          .setBold(false)
          .setRanges([oRange])
          .build();
        var oRuleGray = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=ISNUMBER(SEARCH("발송완료", $J2))')
          .setBackground("#d9d9d9")
          .setFontColor("#000000")
          .setBold(false)
          .setRanges([oRange])
          .build();
        orderTab.setConditionalFormatRules([oRulePink, oRuleGray]);
        try {
          var policyApplyResult = applyVendorPolicyToOrderAndReply_(
            ss,
            orderTab,
            sheet,
            policyForThisFile,
          );
          policyAppliedCount++;
          if (policyForThisFile.__fallback) policyFallbackCount++;
          if (policyForThisFile.__matchedBy === "fileNameOrVendor")
            policyNameMatchCount++;
          if (policyApplyResult.dropdownApplied) policyDropdownEnabledCount++;
          if (policyApplyResult.invoiceReplyApplied)
            policyInvoiceReplyEnabledCount++;
        } catch (ePolicyUpdate) {}

        writeDeploySheetMeta_(sheet, {
          type: isConsumer ? "consumer" : "standard",
          dcRate: isConsumer ? consumerRate : "",
        });
        migratedMetaCount++;
        applyDoneCount++;
        try {
          if (typeof markVendorGroupApplyResultByFileId_ === "function") {
            markVendorGroupApplyResultByFileId_(
              file.id,
              true,
              "적용완료:" + (effectiveGroup || "자동"),
            );
          }
        } catch (eMarkApply) {}

        updatedCount++;
      } catch (e) {
        errorLog.push(file.name + " : " + e.message);
      }
    }


        var endMsg = "으로 업데이트되었습니다.\n" +
      "- 대상 탐색: " +
      targetCount +
      "개\n" +
      "- 일반: " +
      standardCount +
      "개\n" +
      "- 소비자: " +
      consumerCount +
      "개\n" +
      "- 구버전 메타 감지: " +
      legacyMetaCount +
      "개\n" +
      "- 메타 갱신 완료: " +
      migratedMetaCount +
      "개\n" +
      "- 소비자 DC율 보정: " +
      dcRateUpdatedCount +
      "개\n" +
      "- 업체코드(CUST_CD) 동기화: " +
      custCdAppliedCount +
      "개\n" +
      "- 그룹 적용완료: " +
      applyDoneCount +
      "개\n" +
      "- 그룹 적용대기: " +
      applyPendingCount +
      "개\n" +
      "- 그룹 예약대기: " +
      applyScheduledWaitCount +
      "개\n" +
      "- 그룹 스킵: " +
      applySkipCount +
      "개\n" +
      "- 정책 적용: " +
      policyAppliedCount +
      "개 (드롭다운 ON " +
      policyDropdownEnabledCount +
      " / 송장회신 ON " +
      policyInvoiceReplyEnabledCount +
      ")" +
      (policyNameMatchCount > 0
        ? "\n- 정책 파일명/거래처명 보조매칭: " + policyNameMatchCount + "개"
        : "") +
      (policyFallbackCount > 0
        ? "\n⚠ 정책 매핑 미탐지 fallback: " + policyFallbackCount + "개"
        : "") +
      (custCdSkipCount > 0
        ? "\n⚠ CUST_CD 미입력으로 스킵: " +
          custCdSkipCount +
          "개 → 매핑 시트에 코드 입력 후 재실행"
        : "");
    if (hasMore) {
      endMsg +=
        "\n\n⏭️ 이어서 처리할 시트가 남아 있습니다.\n다시 실행하면 다음 묶음(" +
        runLimit +
        "개)부터 이어서 진행합니다.";
    } else {
      endMsg += "\n\n✅ 이번 순차 업데이트 라운드는 모두 완료되었습니다.";
    }
    if (errorLog.length > 0) {
      endMsg +=
        "\n\n⚠️ 그러나 일부 시트에서 오류가 발생했습니다:\n" +
        errorLog.join("\n");
    }

    var rowErrorCode = errorLog.length > 0 ? "PARTIAL_VENDOR_ERRORS" : "OK";
    appendVendorUpdateLogRow_({
      mode: modeLabel,
      runLimit: runLimit,
      targetCount: targetCount,
      updatedCount: updatedCount,
      standardCount: standardCount,
      consumerCount: consumerCount,
      legacyMetaCount: legacyMetaCount,
      migratedMetaCount: migratedMetaCount,
      dcRateUpdatedCount: dcRateUpdatedCount,
      custCdAppliedCount: custCdAppliedCount,
      policyAppliedCount: policyAppliedCount,
      policyDropdownEnabledCount: policyDropdownEnabledCount,
      policyInvoiceReplyEnabledCount: policyInvoiceReplyEnabledCount,
      policyFallbackCount: policyFallbackCount,
      applyDoneCount: applyDoneCount,
      applyPendingCount: applyPendingCount,
      applyScheduledWaitCount: applyScheduledWaitCount,
      applySkipCount: applySkipCount,
      mapFallbackCount: mapFallbackCount,
      hasMore: hasMore,
      errorCount: errorLog.length,
      errorCode: rowErrorCode,
      message: errorLog.length > 0 ? errorLog.slice(0, 3).join(" | ") : "OK",
    });

    // 부분 실패도 "성공"으로 집계되면 대시보드에서 사고가 덮여 보인다.
    // 일부 시트에서 오류가 있었다면 헬스는 false로 기록해 요약에 노출되도록 한다.
    if (errorLog.length > 0) {
      setVendorUpdateScriptHealth_(false, "PARTIAL_VENDOR_ERRORS");
    } else {
      setVendorUpdateScriptHealth_(true);
    }
    if (ui && !isSilent) ui.alert(endMsg);
  } catch (runErr) {
    appendVendorUpdateLogRow_({
      mode: modeLabel,
      runLimit: typeof runLimit !== "undefined" ? runLimit : "",
      message: String(runErr && runErr.message ? runErr.message : runErr),
      errorCount: 1,
      errorCode: "RUNTIME_EXCEPTION",
    });
    setVendorUpdateScriptHealth_(false, "RUNTIME_EXCEPTION");
    if (ui && !isSilent) {
      try {
        ui.alert("❌ 배포 시트 업데이트 중 치명적 오류: " + runErr.message);
      } catch (eA) {}
    }
  } finally {
    try {
      lock.releaseLock();
    } catch (e9) {}
  }
}

var VENDOR_UPDATE_SCHEDULED_HANDLER = "runVendorSheetUpdateScheduled";

function runVendorSheetUpdateScheduled() {
  updateAllVendorSheets({
    silent: true,
    runLimit: VENDOR_UPDATE_DEFAULT_RUN_LIMIT,
    allowInteractiveRepair: false,
  });
}

function setupVendorSheetUpdateDailyTrigger() {
  var ui = SpreadsheetApp.getUi();
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (
        triggers[i].getHandlerFunction() === VENDOR_UPDATE_SCHEDULED_HANDLER
      ) {
        ui.alert("✅ 이미 배포 시트 순차 업데이트 자동예약이 켜져 있습니다.");
        return;
      }
    }
    ScriptApp.newTrigger(VENDOR_UPDATE_SCHEDULED_HANDLER)
      .timeBased()
      .everyDays(1)
      .atHour(22)
      .create();
    ui.alert(
      "예약 완료: 매일 오후 10시에 배포 시트 순차 업데이트를 청크 단위로 실행합니다.",
    );
  } catch (e) {
    ui.alert(
      "❌ 자동예약 설정 실패: " +
        e.message +
        "\n\n" +
        getPermissionDebugSummary_(),
    );
    throw e;
  }
}

function removeVendorSheetUpdateDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === VENDOR_UPDATE_SCHEDULED_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  SpreadsheetApp.getUi().alert(
    "배포 시트 순차 업데이트 자동예약을 " + removed + "건 해제했습니다.",
  );
}

function resetSystem() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (eUi) {}

  if (ui) {
    var confirm = ui.alert(
      "시스템 초기화 확인",
      "운영 핵심 키만 선택 초기화합니다.\n(전체 ScriptProperties 삭제는 더 이상 수행하지 않습니다.)\n\n계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (confirm !== ui.Button.YES) return;
  }

  var props = PropertiesService.getScriptProperties();
  var resetAllowlist = [
    "DB_HUB_ID",
    "DB_CURRENT_SYNC_TIME",
    "VENDOR_MAP_SS_ID",
    "VENDOR_UPDATE_CURSOR",
    "VENDOR_UPDATE_LAST_SUCCESS_AT",
    "VENDOR_UPDATE_LAST_ERROR_AT",
    "VENDOR_UPDATE_LAST_ERROR_CODE",
    "ARCHIVE_LAST_SUCCESS_AT",
    "ARCHIVE_LAST_ERROR_AT",
    "ARCHIVE_LAST_ERROR_CODE",
    "MAIN_SS_ID",
    "LAST_AUTOMATION_LOG_FAIL_AT",
    "LAST_AUTOMATION_LOG_FAIL_CHANNEL",
    "LAST_AUTOMATION_LOG_FAIL_MSG",
  ];

  var removed = [];
  for (var i = 0; i < resetAllowlist.length; i++) {
    var key = resetAllowlist[i];
    if (props.getProperty(key) !== null) {
      props.deleteProperty(key);
      removed.push(key);
    }
  }

  try {
    if (ui) {
      ui.alert(
        "✅ 시스템 초기화 완료\n\n" +
          "- 삭제된 키: " +
          removed.length +
          "개\n" +
          "- 전체 삭제(deleteAllProperties)는 비활성화됨",
      );
    }
  } catch (e) {}
}

// 🚨 [응급 복구 모듈] 권한 승인 문제가 없는 구형(오리지널) 허브로 시스템 강제 롤백
function rescueOldHub() {
  var ui = SpreadsheetApp.getUi();
  try {
    var TARGET_FOLDER_ID = "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl"; // 허브가 저장되는 폴더
    var folder = DriveApp.getFolderById(TARGET_FOLDER_ID);

    // 1. 드라이브에 존재하는 모든 허브 파일을 싹 스크랩합니다.
    var files = folder.getFilesByName("[Pack2U] 통합 관리 HUB (최종 완성본)");
    var candidateFiles = [];
    while (files.hasNext()) {
      var f = files.next();
      candidateFiles.push({ id: f.getId(), created: f.getDateCreated() });
    }

    if (candidateFiles.length === 0) {
      ui.alert("🚨 드라이브에서 허브 파일을 아예 찾을 수 없습니다.");
      return;
    }

    // 2. 생성 일자 기준으로 가장 오래된 (가장 처음 권한을 뚫어놨던 오리지널) 허브를 찾습니다.
    candidateFiles.sort(function (a, b) {
      return a.created.getTime() - b.created.getTime();
    });
    var originalHubId = candidateFiles[0].id;

    // 3. 환경 변수 강제 덮어쓰기 (새로 생성되어 권한이 꽉 막힌 허브를 버림)
    PropertiesService.getScriptProperties().setProperty(
      "DB_HUB_ID",
      normalizeSpreadsheetId_(originalHubId),
    );

    // 4. 배포 시트에 과거의(권한 승인 완료된) 허브 ID를 밀어넣는 강제 패치
    updateAllVendorSheets();

    ui.alert(
      "✅ 응급 복구 완료!\n'권한 승인' 문제가 없던 예전 원본 허브로 시스템을 돌려놓고, 모든 업체의 시트를 원상 복구 시켰습니다.\n이제 #REF! 오류가 즉각 사라졌을 것입니다.",
    );
  } catch (e) {
    ui.alert(
      "🚨 롤백 실패: " + e.message + "\n\n" + getPermissionDebugSummary_(),
    );
  }
}
function findMyHub() {
  try {
    SpreadsheetApp.getUi().alert(
      "허브ID: " +
        PropertiesService.getScriptProperties().getProperty("DB_HUB_ID"),
    );
  } catch (e) {}
}
function syncStatusOnly(isAuto) {
  syncGroupPrices(isAuto);
  // ★ 2026-08-24: 허브 동기화 후 협력업체 단가조회 IMPORTRANGE 빠른 새로고침
  try {
    if (typeof partnerRefreshViewerPrices === "function") {
      partnerRefreshViewerPrices({ silent: !!isAuto });
    }
  } catch (eVendor) {
    Logger.log(
      "[syncStatusOnly] 단가 새로고침 오류: " + (eVendor.message || eVendor),
    );
  }
}

/**
 * ★ 2026-06-23: 특정 업체 시트에 바인딩된 중복 스크립트 프로젝트를 검색하여,
 * 1개만 남기고 나머지는 자동으로 휴지통으로 정리하는 함수
 * ★ 2026-07-20: preferId 지원 — 캐시된(코드를 갱신할) 프로젝트를 우선 보존.
 *   구버전 onEdit(입력차단·자동복구·D/L 값 쓰기)이 남은 중복 프로젝트가
 *   편집 때마다 함께 실행되며 스필 #REF!를 유발하던 문제의 정리 경로.
 */
var _p2uDupScanCache_ = null; // ★ 2026-07-20: 실행당 1회 스캔 (parentId → 프로젝트 목록)

function _p2uScanAllBoundScripts_() {
  if (_p2uDupScanCache_) return _p2uDupScanCache_;
  var oauthToken = ScriptApp.getOAuthToken();
  var byParent = {};
  var names = ["Pack2U 공지팝업", "Pack2U 송장매칭"];

  names.forEach(function(name) {
    var files = DriveApp.getFilesByName(name);
    while (files.hasNext()) {
      var file = files.next();
      var id = file.getId();
      if (file.isTrashed()) continue;

      try {
        var resp = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id, {
          method: "GET",
          headers: { Authorization: "Bearer " + oauthToken },
          muteHttpExceptions: true
        });
        if (resp.getResponseCode() === 200) {
          var proj = JSON.parse(resp.getContentText());
          var pid = String(proj.parentId || "");
          if (!pid) continue;
          if (!byParent[pid]) byParent[pid] = [];
          byParent[pid].push({
            id: id,
            updateTime: file.getLastUpdated().getTime(),
            file: file
          });
        }
      } catch(e) {}
    }
  });
  _p2uDupScanCache_ = byParent;
  return byParent;
}

function cleanDuplicateViewerScripts_(viewerSheetId, preferId) {
  var oauthToken = ScriptApp.getOAuthToken();
  var foundProjects = _p2uScanAllBoundScripts_()[viewerSheetId] || [];

  if (foundProjects.length === 0) return null;
  
  // 가장 최근에 업데이트된 순서로 정렬
  foundProjects.sort(function(a, b) {
    return b.updateTime - a.updateTime;
  });
  
  // ★ preferId(캐시된 프로젝트)가 목록에 있으면 그것을 보존 — 없으면 최신 프로젝트
  var keepProject = foundProjects[0];
  if (preferId) {
    for (var pi = 0; pi < foundProjects.length; pi++) {
      if (foundProjects[pi].id === preferId) { keepProject = foundProjects[pi]; break; }
    }
  }
  
  // 나머지 중복 프로젝트는 자동 삭제
  for (var i = 0; i < foundProjects.length; i++) {
    if (foundProjects[i].id === keepProject.id) continue;
    try {
      foundProjects[i].file.setTrashed(true);
      Logger.log("중복 스크립트 자동 삭제 완료: " + foundProjects[i].id);
    } catch(eDel) {
      Logger.log("중복 삭제 중 실패: " + eDel.message);
      // ★ 삭제 실패 시 폴백: 구버전 onEdit을 no-op으로 덮어써 무력화
      try { _neutralizeBoundScriptProject_(foundProjects[i].id, oauthToken); } catch(eNu) {}
    }
  }
  
  return keepProject.id;
}

/**
 * ★ 2026-07-20: 바인딩 스크립트 프로젝트를 no-op 코드로 덮어써 무력화
 *   (휴지통 이동 실패 시 폴백 — 구버전 onEdit 실행 차단)
 */
function _neutralizeBoundScriptProject_(scriptId, oauthToken) {
  var manifest = JSON.stringify({
    timeZone: "Asia/Seoul",
    exceptionLogging: "STACKDRIVER",
    runtimeVersion: "V8",
  });
  var resp = UrlFetchApp.fetch(
    "https://script.googleapis.com/v1/projects/" + scriptId + "/content",
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + oauthToken,
        "Content-Type": "application/json",
        Expect: "",
      },
      payload: JSON.stringify({
        files: [
          {
            name: "Code",
            type: "SERVER_JS",
            source: "// [Pack2U] 구버전 스크립트 무력화 (2026-07-20)\nfunction onEdit(e) {}\nfunction onOpen() {}\n",
          },
          { name: "appsscript", type: "JSON", source: manifest },
        ],
      }),
      muteHttpExceptions: true,
    }
  );
  Logger.log("[NEUTRALIZE] " + scriptId + " → HTTP " + resp.getResponseCode());
  return resp.getResponseCode() === 200;
}

function createViewerNoticeScript_(viewerSS) {
  var viewerSheetId = viewerSS.getId();
  var oauthToken = ScriptApp.getOAuthToken();
  var props = PropertiesService.getScriptProperties();
  var scriptKey = "VIEWER_BOUND_SCRIPT_ID_" + viewerSheetId;
  
  // ★ 2026-07-01: 성능 최적화 — 캐시를 먼저 확인하고 유효하면 중복 정리(DriveApp 검색)를 건너뜀
  var savedScriptId = String(props.getProperty(scriptKey) || "").trim();
  
  if (savedScriptId) {
    // 캐시가 있으면 일단 유효한지 가볍게 체크
    try {
      var check = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + savedScriptId, {
        method: "GET",
        headers: { Authorization: "Bearer " + oauthToken },
        muteHttpExceptions: true
      });
      if (check.getResponseCode() === 200) {
        // 유효함 → 코드 갱신은 이 프로젝트에 진행
        // ★ 2026-07-20: 단, 중복 프로젝트 정리는 항상 실행 (캐시 프로젝트 보존)
        //   기존엔 캐시가 유효하면 정리를 건너뛰어, 같은 시트에 바인딩된
        //   "구버전 onEdit"(입력차단·자동복구·D/L 값 쓰기) 프로젝트가 살아남아
        //   재설치를 해도 편집 때마다 함께 실행되며 스필 #REF!를 재발시켰음
        try {
          cleanDuplicateViewerScripts_(viewerSheetId, savedScriptId);
        } catch (eDup) {
          Logger.log("중복 스크립트 정리 중 오류(캐시 유효 경로): " + eDup.message);
        }
      } else {
        savedScriptId = ""; // 유효하지 않음 → 검색 필요
      }
    } catch(e) { savedScriptId = ""; }
  }

  // 캐시가 없거나 유효하지 않을 때만 전체 검색 실행
  if (!savedScriptId) {
    try {
      savedScriptId = cleanDuplicateViewerScripts_(viewerSheetId) || "";
      if (savedScriptId) {
        props.setProperty(scriptKey, savedScriptId); // 캐시 갱신
      }
    } catch(eClean) {
      Logger.log("중복 스크립트 정리 중 오류: " + eClean.message);
    }
  }


  // ★ 2026-07-03: 라이브러리 패턴 전환 — onOpen도 라이브러리 호출
  var onOpenPart = [
    "// Pack2U 라이브러리 기반 (2026-07-03 전환)",
    "function onOpen() {",
    "  Pack2U.p2u_partnerOnOpen();",
    "}",
  ].join("\n");

  // ★ 2026-06-17: 단일 소스 전환 — onEdit 코드를 partnerOnEditSource.gs에서 읽음
  var onEditCode = "";
  try {
    onEditCode = getPartnerOnEditCode_();
  } catch (eRead) {
    Logger.log("getPartnerOnEditCode_ 호출 실패: " + eRead.message);
    onEditCode = "function onEdit(e) { Pack2U.p2u_partnerOnEdit(e); }";
  }

  // onOpen + onEdit 합치기
  var onOpenCode = onOpenPart + "\n\n" + onEditCode;

  // ★ 2026-07-01: DB 단가 검색/새로고침 함수 (업체 시트 주입용)
  var dbPriceCode = [
    "// ═══ [DB 단가] 웹앱 API 기반 단가 검색 (2026-07-01) ═══",
    "var _HUB_API_ = '" + (typeof HUB_WEBAPP_URL !== 'undefined' ? HUB_WEBAPP_URL : '') + "';",
    "",
    "function dbPriceSearch() {",
    "  var ui = SpreadsheetApp.getUi();",
    "  if (!_HUB_API_) { ui.alert('DB API URL이 설정되지 않았습니다.'); return; }",
    "  var input = ui.prompt('\uD83D\uDD0D DB \uD488\uBAA9 \uAC80\uC0C9', '\uC774\uCE74\uC6B4\uD2B8\uCF54\uB4DC \uB610\uB294 \uD488\uBAA9\uBA85 \uC77C\uBD80\uB97C \uC785\uB825\uD558\uC138\uC694:', ui.ButtonSet.OK_CANCEL);",
    "  if (input.getSelectedButton() !== ui.Button.OK) return;",
    "  var q = input.getResponseText().trim();",
    "  if (!q) return;",
    "  try {",
    "    var startTime = new Date();",
    "    var res = UrlFetchApp.fetch(_HUB_API_ + '?action=productSearch&q=' + encodeURIComponent(q) + '&limit=10', {muteHttpExceptions: true});",
    "    var data = JSON.parse(res.getContentText());",
    "    var elapsed = new Date() - startTime;",
    "    if (!data.data || data.data.length === 0) { ui.alert('\uAC80\uC0C9 \uACB0\uACFC \uC5C6\uC74C\\n\\n\"' + q + '\"\uC5D0 \uD574\uB2F9\uD558\uB294 \uD488\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.\\n\u23F1 ' + elapsed + 'ms'); return; }",
    "    var msg = '\uD83D\uDD0D \uAC80\uC0C9 \uACB0\uACFC (' + data.data.length + '\uAC74) \u2014 \u23F1 ' + elapsed + 'ms\\n\\n';",
    "    for (var i = 0; i < data.data.length; i++) {",
    "      var p = data.data[i];",
    "      msg += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\\n';",
    "      msg += '\uCF54\uB4DC: ' + p.ecount_code + '\\n';",
    "      msg += '\uD488\uBAA9: ' + p.item_name + '\\n';",
    "      msg += '\uC0C1\uD0DC: ' + (p.status || '-') + ' | \uC7AC\uACE0: ' + (p.stock_qty || 0) + '\\n';",
    "      msg += '\uD5C8\uBE0C\uB2E8\uAC00: ' + (p.hub_base_price || '-') + '\\n';",
    "    }",
    "    ui.alert(msg);",
    "  } catch(e) { ui.alert('\u274C DB \uAC80\uC0C9 \uC624\uB958: ' + e.message); }",
    "}",
    "",
    "function _findViewerTab_(ss) {",
    "  var sheets = ss.getSheets();",
    "  for (var i = 0; i < sheets.length; i++) {",
    "    var n = sheets[i].getName();",
    "    if (n.indexOf('\uB2E8\uAC00\uC870\uD68C') !== -1 || n.indexOf('\uBE74\uC5B4') !== -1) return sheets[i];",
    "  }",
    "  return null;",
    "}",
    "",
    "function dbPriceRefresh() {",
    "  var ui = SpreadsheetApp.getUi();",
    "  if (!_HUB_API_) { ui.alert('DB API URL\uC774 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.'); return; }",
    "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
    "  var settingsTab = ss.getSheetByName('\uC124\uC815');",
    "  var group = '';",
    "  if (settingsTab) { group = String(settingsTab.getRange('B5').getValue() || '').trim(); }",
    "  if (!group) { ui.alert('\uC124\uC815 \uD0ED B5\uC5D0 \uAC70\uB798\uCC98\uBA85\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'); return; }",
    "  ui.alert('\uD83D\uDD04 DB \uB2E8\uAC00 \uC0C8\uB85C\uACE0\uCE68\\n\\n\uADF8\uB8F9: ' + group + '\\n\uC870\uD68C \uC911... (\uC218\uCD08 \uC18C\uC694)');",
    "  try {",
    "    var res = UrlFetchApp.fetch(_HUB_API_ + '?action=vendorProducts&group=' + encodeURIComponent(group), {muteHttpExceptions: true});",
    "    var data = JSON.parse(res.getContentText());",
    "    if (!data.data || data.data.length === 0) { ui.alert('\u274C \uACB0\uACFC \uC5C6\uC74C: \"' + group + '\" \uADF8\uB8F9 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'); return; }",
    "    var viewerTab = _findViewerTab_(ss);",
    "    if (!viewerTab) { ui.alert('\uB2E8\uAC00\uC870\uD68C \uD0ED\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.'); return; }",
    "    var rows = data.data.map(function(p) { return [p.status || '', '', p.code || '', p.name || '', '', '', p.price || 0]; });",
    "    viewerTab.getRange(3, 1, viewerTab.getMaxRows() - 2, 7).clearContent();",
    "    viewerTab.getRange(3, 1, rows.length, 7).setValues(rows);",
    "    ui.alert('\u2705 DB \uB2E8\uAC00 \uC0C8\uB85C\uACE0\uCE68 \uC644\uB8CC\\n\\n\uADF8\uB8F9: ' + group + '\\n\uD488\uBAA9 \uC218: ' + rows.length + '\uAC74');",
    "  } catch(e) { ui.alert('\u274C DB \uC0C8\uB85C\uACE0\uCE68 \uC624\uB958: ' + e.message); }",
    "}",
    "",
    "function dbToggleMode() {",
    "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
    "  var settingsTab = ss.getSheetByName('\uC124\uC815');",
    "  if (!settingsTab) { SpreadsheetApp.getUi().alert('\uC124\uC815 \uD0ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'); return; }",
    "  var current = String(settingsTab.getRange('C20').getValue() || '').trim();",
    "  var newMode = (current === 'DB') ? '\uAE30\uC874' : 'DB';",
    "  settingsTab.getRange('B20').setValue('\uB2E8\uAC00\uC870\uD68C\uBC29\uC2DD');",
    "  settingsTab.getRange('C20').setValue(newMode);",
    "  SpreadsheetApp.getUi().alert('\u2705 \uB2E8\uAC00\uC870\uD68C \uBAA8\uB4DC \uC804\uD658\\n\\n' + current + ' \u2192 ' + newMode + '\\n\\n' + (newMode === 'DB' ? 'DB \uBAA8\uB4DC: \uC6F9\uC571 API\uB85C \uBE60\uB978 \uAC80\uC0C9' : '\uAE30\uC874 \uBAA8\uB4DC: IMPORTRANGE \uC0AC\uC6A9'));",
    "}",
  ].join("\n");

  var searchOrderCode = [
    "// [검색발주] 발주 제출 + 드롭다운 갱신 (자동 생성됨)",
    "var _SI_HEADERS = ['품목명','수량','수취인','수취인전화번호','수취인주소','배송메시지'];",
    "",
    "function _findViewerTab_(ss) {",
    "  var sheets = ss.getSheets();",
    "  for (var i = 0; i < sheets.length; i++) {",
    "    var n = sheets[i].getName();",
    "    if (n.indexOf('단가조회') !== -1 || n.indexOf('뷰어') !== -1) return sheets[i];",
    "  }",
    "  return null;",
    "}",
    "",
    "function refreshSearchDropdown() {",
    "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
    "  var siTab = ss.getSheetByName('검색입력');",
    "  if (!siTab) { SpreadsheetApp.getUi().alert('검색입력 탭이 없습니다.'); return; }",
    "  var viewerTab = _findViewerTab_(ss);",
    "  if (!viewerTab || viewerTab.getLastRow() < 3) { SpreadsheetApp.getUi().alert('단가조회 탭이 없거나 비어있습니다.'); return; }",
    "  var lr = viewerTab.getLastRow();",
    "  var rawData = viewerTab.getRange(3, 4, lr - 2, 1).getValues();",
    "  var seen = {}, uniq = [];",
    "  rawData.forEach(function(r) {",
    "    var nm = String(r[0] || '').trim();",
    "    if (nm && nm !== '-' && nm !== '−' && !seen[nm]) { seen[nm] = true; uniq.push(nm); }",
    "  });",
    "  uniq.sort();",
    "  if (uniq.length === 0) return;",
    "  if (uniq.length <= 500) {",
    "    var rule = SpreadsheetApp.newDataValidation().requireValueInList(uniq, true).setAllowInvalid(true).build();",
    "    siTab.getRange('A2:A1000').setDataValidation(rule);",
    "  } else {",
    "    var listCol = 8;",
    "    try { siTab.getRange(1, listCol, siTab.getMaxRows(), 1).clearContent(); } catch(e){}",
    "    siTab.getRange(1, listCol).setValue('품목목록').setFontColor('#cccccc').setFontSize(8);",
    "    var listData = uniq.map(function(nm) { return [nm]; });",
    "    siTab.getRange(2, listCol, listData.length, 1).setValues(listData);",
    "    try { siTab.hideColumns(listCol); } catch(e){}",
    "    var rule2 = SpreadsheetApp.newDataValidation().requireValueInRange(siTab.getRange(2, listCol, listData.length, 1), true).setAllowInvalid(true).build();",
    "    siTab.getRange('A2:A1000').setDataValidation(rule2);",
    "  }",
    "  SpreadsheetApp.getUi().alert('✅ 드롭다운 갱신 완료 (' + uniq.length + '개 품목)');",
    "}",
    "",
    "function submitSearchOrders() {",
    "  var ui = SpreadsheetApp.getUi();",
    "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
    "  var siTab = ss.getSheetByName('검색입력');",
    "  if (!siTab) { ui.alert('검색입력 탭이 없습니다.'); return; }",
    "  if (siTab.getLastRow() < 2) { ui.alert('입력된 발주 내용이 없습니다.'); return; }",
    "  var orderTab = ss.getSheetByName('발주 및 송장조회');",
    "  if (!orderTab) { ui.alert('발주 및 송장조회 탭이 없습니다.'); return; }",
    "  var codeMap = {};",
    "  var viewerTab = _findViewerTab_(ss);",
    "  if (viewerTab && viewerTab.getLastRow() >= 3) {",
    "    var vData = viewerTab.getRange(3, 3, viewerTab.getLastRow() - 2, 2).getValues();",
    "    vData.forEach(function(r) {",
    "      var ec = String(r[0] || '').trim(); var nm = String(r[1] || '').trim();",
    "      if (nm && ec && !codeMap[nm]) codeMap[nm] = ec;",
    "    });",
    "  }",
    "  if (orderTab.getLastRow() >= 2) {",
    "    var eData = orderTab.getRange(2, 3, orderTab.getLastRow() - 1, 2).getValues();",
    "    eData.forEach(function(r) {",
    "      var ec = String(r[0] || '').trim(); var nm = String(r[1] || '').trim();",
    "      if (nm && ec && !codeMap[nm]) codeMap[nm] = ec;",
    "    });",
    "  }",
    "  var ssName = ss.getName().replace(/\\[협력업체\\]/g, '').replace(/협력업체/g, '').trim();",
    "  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');",
    "  var siData = siTab.getRange(2, 1, siTab.getLastRow() - 1, _SI_HEADERS.length).getValues();",
    "  var rows = [], errNames = [];",
    "  for (var ri = 0; ri < siData.length; ri++) {",
    "    var row = siData[ri];",
    "    var itemName = String(row[0] || '').trim();",
    "    var qty = parseFloat(row[1]) || 0;",
    "    var recipient = String(row[2] || '').trim();",
    "    if (!itemName || !qty || !recipient) continue;",
    "    var ecCode = codeMap[itemName] || '';",
    "    if (!ecCode) errNames.push(itemName);",
    "    var uid = 'SI-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'MMddHHmmss') + '-' + (ri + 1);",
    "    rows.push([ssName, today, ecCode, itemName, qty, recipient, String(row[3]||'').trim(), String(row[4]||'').trim(), String(row[5]||'').trim(), '검색입력', '', '', uid, '접수완료']);",
    "  }",
    "  if (rows.length === 0) { ui.alert('유효한 발주 행이 없습니다.'); return; }",
    "  var existDupSet = {};",
    "  if (orderTab.getLastRow() >= 2) {",
    "    var existRows = orderTab.getRange(2, 2, orderTab.getLastRow() - 1, 5).getValues();",
    "    existRows.forEach(function(er) {",
    "      var key = String(er[0]||'').trim() + '|' + String(er[2]||'').trim() + '|' + String(er[4]||'').trim();",
    "      if (key !== '||') existDupSet[key] = true;",
    "    });",
    "  }",
    "  var dupSkipped = [];",
    "  rows = rows.filter(function(r) {",
    "    var key = String(r[1]||'').trim() + '|' + String(r[3]||'').trim() + '|' + String(r[5]||'').trim();",
    "    if (existDupSet[key]) { dupSkipped.push(r[3]); return false; } return true;",
    "  });",
    "  if (rows.length === 0) { ui.alert('⚠️ 모두 중복 발주입니다.'); return; }",
    "  var bColData = orderTab.getRange(2, 2, orderTab.getMaxRows() - 1, 1).getValues();",
    "  var nextRow = 2;",
    "  for (var bi = 0; bi < bColData.length; bi++) {",
    "    if (String(bColData[bi][0] || '').trim() === '') { nextRow = bi + 2; break; }",
    "  }",
    "  var pass1 = rows.map(function(r) { return r.slice(1, 11); });",
    "  orderTab.getRange(nextRow, 2, pass1.length, pass1[0].length).setValues(pass1);",
    "  var pass2 = rows.map(function(r) { return [r[12], r[13]]; });",
    "  orderTab.getRange(nextRow, 13, pass2.length, 2).setValues(pass2);",
    "  SpreadsheetApp.flush();",
    "  var msg = '✅ ' + rows.length + '건을 발주 및 송장조회 탭에 추가했습니다.';",
    "  if (errNames.length > 0) msg += '\\n\\n⚠️ 코드 미매칭: ' + errNames.join(', ');",
    "  ui.alert(msg);",
    "}",
  ].join("\n");

  // ★ 상품검색 사이드바 서버함수 + 인라인 HTML
  var productSearchCode = [
    "// [상품검색] 사이드바 서버함수 + HTML (자동 생성됨)",
    "",
    "function openProductSearchSidebar() {",
    "  var html = HtmlService.createHtmlOutput(_getProductSearchHtml_())",
    "    .setTitle('\uD83D\uDD0D \uC0C1\uD488 \uAC80\uC0C9');",
    "  SpreadsheetApp.getUi().showSidebar(html);",
    "}",
    "",
    "function searchProductByName(query) {",
    "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
    "  var viewerTab = null;",
    "  var sheets = ss.getSheets();",
    "  for (var i = 0; i < sheets.length; i++) {",
    "    var n = sheets[i].getName();",
    "    if (n.indexOf('\uB2E8\uAC00\uC870\uD68C') !== -1 || n.indexOf('\uBE74\uC5B4') !== -1) {",
    "      viewerTab = sheets[i]; break;",
    "    }",
    "  }",
    "  if (!viewerTab || viewerTab.getLastRow() < 4) return [];",
    "  var lr = viewerTab.getLastRow();",
    "  var data = viewerTab.getRange(4, 1, lr - 3, 7).getValues();",
    "  var q = String(query || '').trim().toLowerCase();",
    "  if (!q) return [];",
    "  var results = [];",
    "  for (var r = 0; r < data.length; r++) {",
    "    var status = String(data[r][0] || '').trim();",
    "    var code = String(data[r][2] || '').trim();",
    "    var name = String(data[r][3] || '').trim();",
    "    var price = data[r][6];",
    "    if (!code || !name) continue;",
    "    if (name.toLowerCase().indexOf(q) !== -1 || code.toLowerCase().indexOf(q) !== -1) {",
    "      results.push({ code: code, name: name, status: status, price: price });",
    "      if (results.length >= 50) break;",
    "    }",
    "  }",
    "  return results;",
    "}",
    "",
    "function insertEcountCode(code) {",
    "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
    "  var sheet = ss.getSheetByName('\uBC1C\uC8FC \uBC0F \uC1A1\uC7A5\uC870\uD68C');",
    "  if (!sheet) { var sheets = ss.getSheets(); for (var si = 0; si < sheets.length; si++) { if (sheets[si].getName().indexOf('\uC804\uC6A9\uC591\uC2DD') !== -1) { sheet = sheets[si]; break; } } }",
    "  if (!sheet) sheet = SpreadsheetApp.getActiveSheet();",
    "  var lastRow = sheet.getLastRow();",
    "  var cLastRow = 1;",
    "  if (lastRow >= 2) {",
    "    var cVals = sheet.getRange(2, 3, lastRow - 1, 1).getValues();",
    "    for (var ci = cVals.length - 1; ci >= 0; ci--) {",
    "      if (String(cVals[ci][0]).trim() !== '') { cLastRow = ci + 2; break; }",
    "    }",
    "  }",
    "  var row = (cLastRow < 2) ? 2 : cLastRow + 1;",

    "  // C열(3번째)에 코드 입력",
    "  sheet.getRange(row, 3).setValue(code);",
    "  // 다음 행 C열로 이동",
    "  sheet.setActiveRange(sheet.getRange(row + 1, 3));",
    "  return '';",
    "}",
    "",
    "function _getProductSearchHtml_() {",
    "  var css = [",
    "    '* { box-sizing: border-box; margin: 0; padding: 0; }',",
    "    'body { font-family: Apple SD Gothic Neo, Malgun Gothic, sans-serif; font-size: 13px; background: #f8f9fa; padding: 12px; }',",
    "    '.search-box { position: sticky; top: 0; background: #f8f9fa; padding-bottom: 8px; z-index: 10; }',",
    "    '.search-input { width: 100%; padding: 10px 12px; border: 2px solid #dadce0; border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; }',",
    "    '.search-input:focus { border-color: #1a73e8; }',",
    "    '.hint { font-size: 11px; color: #888; margin-top: 6px; }',",
    "    '.results { margin-top: 8px; }',",
    "    '.result-item { background: white; border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; cursor: pointer; border: 1px solid #e8eaed; transition: all 0.15s; }',",
    "    '.result-item:hover { border-color: #1a73e8; background: #e8f0fe; transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.08); }',",
    "    '.item-code { font-weight: bold; color: #1a73e8; font-size: 13px; }',",
    "    '.item-name { color: #333; font-size: 12px; margin-top: 2px; }',",
    "    '.item-meta { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: #888; }',",
    "    '.status-warn { color: #ea4335; font-weight: bold; }',",
    "    '.empty { text-align: center; color: #999; padding: 30px 0; font-size: 12px; }',",
    "    '.toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #333; color: white; padding: 8px 20px; border-radius: 20px; font-size: 12px; z-index: 100; display: none; }',",
    "  ].join('\\n');",
    "",
    "  var js = [",
    "    'var _timer = null;',",
    "    'function debounceSearch() { clearTimeout(_timer); _timer = setTimeout(doSearch, 300); }',",
    "    'function doSearch() {',",
    "    '  var q = document.getElementById(\"q\").value.trim();',",
    "    '  if (!q) { document.getElementById(\"results\").innerHTML = \"<div class=empty>\\uD488\\uBAA9\\uBA85\\uC744 \\uC785\\uB825\\uD558\\uC138\\uC694</div>\"; return; }',",
    "    '  document.getElementById(\"results\").innerHTML = \"<div class=empty>\\uAC80\\uC0C9 \\uC911...</div>\";',",
    "    '  google.script.run.withSuccessHandler(showResults).withFailureHandler(showError).searchProductByName(q);',",
    "    '}',",
    "    'function showResults(list) {',",
    "    '  if (!list || list.length === 0) { document.getElementById(\"results\").innerHTML = \"<div class=empty>\\uAC80\\uC0C9 \\uACB0\\uACFC \\uC5C6\\uC74C</div>\"; return; }',",
    "    '  var h = \"\";',",
    "    '  for (var i = 0; i < list.length; i++) {',",
    "    '    var it = list[i];',",
    "    '    var sc = (it.status && (it.status.indexOf(\"\\uD488\\uC808\") !== -1 || it.status.indexOf(\"\\uB2E8\\uC885\") !== -1)) ? \" status-warn\" : \"\";',",
    "    '    var ps = it.price ? Number(it.price).toLocaleString() + \"\\uC6D0\" : \"\";',",
    "    '    h += \"<div class=result-item data-code=\" + it.code + \">\";',",
    "    '    h += \"<div class=item-code>\" + it.code + \"</div>\";',",
    "    '    h += \"<div class=item-name>\" + it.name + \"</div>\";',",
    "    '    h += \"<div class=item-meta><span class=\" + sc + \">\" + (it.status || \"\\uC815\\uC0C1\") + \"</span><span>\" + ps + \"</span></div></div>\";',",
    "    '  }',",
    "    '  document.getElementById(\"results\").innerHTML = h;',",
    "    '  var els = document.querySelectorAll(\".result-item\");',",
    "    '  for (var j = 0; j < els.length; j++) {',",
    "    '    els[j].addEventListener(\"click\", function() { pickCode(this.getAttribute(\"data-code\")); });',",
    "    '  }',",
    "    '}',",
    "    'function showError(e) { document.getElementById(\"results\").innerHTML = \"<div class=empty style=color:#ea4335>\\uC624\\uB958: \" + (e.message || e) + \"</div>\"; }',",
    "    'function pickCode(code) {',",
    "    '  google.script.run.withSuccessHandler(function(err) {',",
    "    '    if (err) { showToast(\"\\u26A0\\uFE0F \" + err); return; }',",
    "    '    showToast(\"\\u2705 \" + code + \" \\uC785\\uB825 \\uC644\\uB8CC\");',",
    "    '  }).withFailureHandler(function(e) { showToast(\"\\u274C \" + (e.message || e)); }).insertEcountCode(code);',",
    "    '}',",
    "    'function showToast(msg) {',",
    "    '  var t = document.getElementById(\"toast\"); t.textContent = msg; t.style.display = \"block\";',",
    "    '  setTimeout(function() { t.style.display = \"none\"; }, 2000);',",
    "    '}',",
    "  ].join('\\n');",
    "",
    "  return '<!DOCTYPE html><html><head><base target=\"_top\"><style>' + css + '</style></head><body>' +",
    "    '<div class=search-box>' +",
    "    '<input type=text class=search-input id=q placeholder=\"품목명 또는 코드 입력...\" oninput=debounceSearch()>' +",
    "    '<div class=hint>검색 결과를 클릭하면 C열에 코드가 입력됩니다</div></div>' +",
    "    '<div class=results id=results><div class=empty>품목명을 입력하세요</div></div>' +",
    "    '<div class=toast id=toast></div>' +",
    "    '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';",
    "}",

  ].join("\n");


  // ★ 2026-07-03: 라이브러리 패턴 — 허브 프로젝트를 Pack2U 라이브러리로 참조
  var hubScriptId = "192tojXvo5GfhIJoHXo7UbmSMbNjpUjfx2nEUAz56kacKaQrDXoSMLC7i";
  var manifest = JSON.stringify({
    timeZone: "Asia/Seoul",
    dependencies: {
      libraries: [
        {
          userSymbol: "Pack2U",
          libraryId: hubScriptId,
          version: "0",
          developmentMode: true
        }
      ]
    },
    exceptionLogging: "STACKDRIVER",
    runtimeVersion: "V8",
  });

  // ★ 2026-06-23 v9: 송장 매칭 코드 주입 (HTML 파일 없이 인라인 방식)
  var invoiceMatchCode = "";
  try {
    invoiceMatchCode = getPartnerInvoiceMatchCode_();
  } catch (eIM) {
    Logger.log("getPartnerInvoiceMatchCode_ 호출 실패: " + eIM.message);
    invoiceMatchCode = "// InvoiceMatch 코드 로드 실패";
  }
  // ★ v9: InvoiceMatchSidebar.html 파일 주입 제거
  // openInvoiceMatchSidebarLocal이 _getInvoiceMatchHtml_()를 직접 호출하므로 불필요

  // ★ 2026-06-24: 429 Rate Limit 자동 재시도 래퍼
  function _fetchWithRetry_(url, options, maxRetries) {
    maxRetries = maxRetries || 3;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      var resp = UrlFetchApp.fetch(url, options);
      if (resp.getResponseCode() !== 429) return resp;
      if (attempt < maxRetries) {
        var waitSec = 3 + attempt * 3; // 3초, 6초, 9초
        Logger.log("[RATE_LIMIT] 429 감지 — " + waitSec + "초 대기 후 재시도 (" + (attempt + 1) + "/" + maxRetries + ")");
        Utilities.sleep(waitSec * 1000);
      }
    }
    return UrlFetchApp.fetch(url, options); // 마지막 시도
  }

  function putScriptContent_(scriptId) {
    var fileList = [
      { name: "Code", type: "SERVER_JS", source: onOpenCode },
      { name: "ProductSearch", type: "SERVER_JS", source: productSearchCode },
      { name: "InvoiceMatch", type: "SERVER_JS", source: invoiceMatchCode },
      { name: "DbPrice", type: "SERVER_JS", source: dbPriceCode },  // ★ 2026-07-01: DB 단가 검색
      { name: "appsscript", type: "JSON", source: manifest },
    ];
    return _fetchWithRetry_(
      "https://script.googleapis.com/v1/projects/" + scriptId + "/content",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + oauthToken,
          "Content-Type": "application/json",
          Expect: "",
        },
        payload: JSON.stringify({
          files: fileList,
        }),
        muteHttpExceptions: true,
      }
    );
  }

  // 2) 기존 저장 scriptId가 있으면 재사용 업데이트 시도 (중복 프로젝트 생성 방지)
  if (savedScriptId) {
    var reuseResp = putScriptContent_(savedScriptId);
    if (reuseResp.getResponseCode() === 200) return true;
    var respCode = reuseResp.getResponseCode();
    if (
      respCode === 404 ||
      respCode === 410 ||
      respCode === 403 ||
      respCode === 401
    ) {
      props.deleteProperty(scriptKey);
      savedScriptId = "";
    } else {
      throw new Error(
        "Script 코드 업데이트 실패 (" +
          respCode +
          "): " +
          reuseResp.getContentText()
      );
    }
  }

  // 3) 없으면 허브 바운드 Apps Script 프로젝트 생성 후 코드 주입
  var createResp = _fetchWithRetry_(
    "https://script.googleapis.com/v1/projects",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + oauthToken,
        "Content-Type": "application/json",
        Expect: "", // IIS 412 방지
      },
      payload: JSON.stringify({
        title: "Pack2U \uACF5\uC9C0\uD31D\uC5C5", // "Pack2U 공지팝업"
        parentId: viewerSheetId, // 해당 스프레드시트에 컨테이너 바인딩
      }),
      muteHttpExceptions: true,
    }
  );
  if (createResp.getResponseCode() !== 200) {
    throw new Error(
      "Script \uc0dd\uc131 \uc2e4\ud328 (" +
        createResp.getResponseCode() +
        "): " +
        createResp.getContentText(),
    );
  }

  var scriptId = JSON.parse(createResp.getContentText()).scriptId;
  var updateResp = putScriptContent_(scriptId);
  if (updateResp.getResponseCode() !== 200) {
    throw new Error(
      "Script \ucf54\ub4dc \uc8fc\uc785 \uc2e4\ud328 (" +
        updateResp.getResponseCode() +
        "): " +
        updateResp.getContentText(),
    );
  }

  props.setProperty(scriptKey, scriptId);
  return true;
}

function adminClearSingleVendorScriptId() {
  var ui = SpreadsheetApp.getUi();
  var files = typeof _pt_listFiles === "function" ? _pt_listFiles(true) : [];
  if (files.length === 0) {
    ui.alert("등록된 협력업체 배포 파일을 찾지 못했습니다.\n\n폴더 설정(_PT.FOLDER_ID)을 확인하세요.");
    return;
  }

  var lines = files.map(function (f, i) {
    return (i + 1) + ". " + f.name;
  });
  var resp = ui.prompt(
    "업체 스크립트 캐시 초기화",
    "스크립트 ID 캐시를 초기화(삭제)할 업체 번호를 입력하세요 (배포 권한 오류 해결용):\n\n" + lines.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var idx = parseInt(String(resp.getResponseText() || "").trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= files.length) {
    ui.alert("올바른 번호를 입력하세요 (1 ~ " + files.length + ").");
    return;
  }

  var target = files[idx];
  var props = PropertiesService.getScriptProperties();
  var scriptKey = "VIEWER_BOUND_SCRIPT_ID_" + target.id;
  
  if (props.getProperty(scriptKey)) {
    props.deleteProperty(scriptKey);
    ui.alert("✅ 초기화 완료\n\n" + target.name + "의 스크립트 ID 캐시가 삭제되었습니다.\n이제 '스크립트 재설치'를 진행하면 새로 프로젝트를 만들어 배포합니다.");
  } else {
    ui.alert("⚠️ 캐시 없음\n\n" + target.name + "에 해당하는 저장된 스크립트 ID가 존재하지 않습니다.");
  }
}

function adminInstallSingleVendorAutofillScript_() {
  var ui = SpreadsheetApp.getUi();

  // 협력업체 파일 목록 수집 (_pt_listFiles 사용)
  var files = typeof _pt_listFiles === "function" ? _pt_listFiles(true) : [];
  if (files.length === 0) {
    ui.alert("등록된 협력업체 배포 파일을 찾지 못했습니다.\n\n폴더 설정(_PT.FOLDER_ID)을 확인하세요.");
    return;
  }

  // 번호 목록 표시
  var lines = files.map(function (f, i) {
    return (i + 1) + ". " + f.name;
  });
  var resp = ui.prompt(
    "업체 선택",
    "자동완성 스크립트를 재설치할 업체 번호를 입력하세요:\n\n" + lines.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var idx = parseInt(String(resp.getResponseText() || "").trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= files.length) {
    ui.alert("올바른 번호를 입력하세요 (1 ~ " + files.length + ").");
    return;
  }

  var target = files[idx];
  try {
    var ss = SpreadsheetApp.openById(target.id);
    createViewerNoticeScript_(ss);
    ui.alert("✅ 완료\n\n" + target.name + "\n\n자동완성 스크립트가 재설치되었습니다.");
  } catch (e) {
    ui.alert("❌ 실패\n\n" + target.name + "\n\n" + (e && e.message ? e.message : e));
  }
}

function adminInstallVendorOrderDateAutofillScripts_() {
  var ui = SpreadsheetApp.getUi();
  var yes = ui.alert(
    "발주탭 자동완성 스크립트 재설치",
    "모든 협력업체 배포 시트에 onEdit 스크립트를 설치/갱신합니다.\n\n" +
      "- C열(코드) 입력 시 D열(품목명) 자동완성\n" +
      "- L열(정산단가) 자동완성\n" +
      "- J열(적요) 품절·단종·코드오류 경고 표시\n" +
      "- B열(주문일자) 자동기입\n\n계속할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (yes !== ui.Button.YES) return;

  // 협력업체 파일 목록 수집 (_pt_listFiles 사용)
  var allFiles = typeof _pt_listFiles === "function" ? _pt_listFiles(true) : [];
  if (allFiles.length === 0) {
    ui.alert("등록된 협력업체 배포 파일을 찾지 못했습니다.\n\n폴더 설정(_PT.FOLDER_ID)을 확인하세요.");
    return;
  }

  var scanned = 0;
  var ok = 0;
  var failed = [];
  for (var i = 0; i < allFiles.length; i++) {
    scanned++;
    try {
      var ss = SpreadsheetApp.openById(allFiles[i].id);
      createViewerNoticeScript_(ss);
      // ★ 2026-07-06: 뷰어 탭 #REF! 자동 복구 (스필 영역 클리어)
      try {
        var tabs = ss.getSheets();
        for (var ti = 0; ti < tabs.length; ti++) {
          var tn = tabs[ti].getName();
          if (tn.indexOf('단가') !== -1 || tn.indexOf('뷰어') !== -1 || tn.indexOf('팩투유') !== -1) {
            var a3v = String(tabs[ti].getRange('A3').getDisplayValue() || '');
            if (a3v.indexOf('#REF') !== -1 || a3v.indexOf('#오류') !== -1) {
              var vLr2 = Math.max(tabs[ti].getLastRow(), 4);
              if (vLr2 >= 4) {
                var cr = vLr2 - 3;
                try { tabs[ti].getRange(4, 1, cr, 2).clearContent(); } catch(e1) {}
                try { tabs[ti].getRange(4, 4, cr, 7).clearContent(); } catch(e2) {}
              }
            }
            break;
          }
        }
      } catch(eRef) {}
      ok++;
    } catch (e) {
      failed.push(allFiles[i].name + " :: " + (e && e.message ? e.message : e));
    }
  }

  var msg =
    "완료\n\n" +
    "- 대상 파일: " +
    scanned +
    "개\n" +
    "- 성공: " +
    ok +
    "개\n" +
    "- 실패: " +
    failed.length +
    "개";
  if (failed.length > 0) {
    msg += "\n\n실패 상위 8개:\n- " + failed.slice(0, 8).join("\n- ");
  }
  ui.alert(msg);
}

function getPermissionDebugSummary_() {
  var p = null;
  if (typeof getOwnershipDiagnostics_ === "function") {
    try {
      p = getOwnershipDiagnostics_();
    } catch (e0) {}
  }
  if (!p) {
    p = {
      effectiveUser: "(확인 불가)",
      activeUser: "(확인 불가)",
      owner: "(확인 불가)",
      isOwner: false,
    };
    try {
      p.effectiveUser = Session.getEffectiveUser().getEmail() || "(비공개)";
    } catch (e1) {}
    try {
      p.activeUser = Session.getActiveUser().getEmail() || "(비공개)";
    } catch (e2) {}
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        p.owner =
          DriveApp.getFileById(ss.getId()).getOwner().getEmail() ||
          "(소유자 이메일 비공개)";
      }
    } catch (e3) {}
    var ownerNorm = String(p.owner || "").toLowerCase();
    var userNorm = String(p.effectiveUser || "").toLowerCase();
    p.isOwner = !!ownerNorm && !!userNorm && ownerNorm === userNorm;
  }

  return (
    "- 현재 실행계정: " +
    p.effectiveUser +
    "\n- 활성 사용자: " +
    p.activeUser +
    "\n- 시트 소유자: " +
    p.owner +
    "\n- 소유자 동일 여부: " +
    (p.isOwner ? "YES" : "NO")
  );
}

// ─── 뷰어(단가조회) 3행 보호 & 자동 복구 ─────────────────────────────

/**
 * 단가조회/뷰어 탭의 1~3행을 삭제 방지 보호한다.
 * 행 삭제(구조 변경)만 차단하고, 셀 값 편집은 허용.
 * @param {Sheet} viewerSheet
 */
function protectViewerCriticalRows_(viewerSheet) {
  if (!viewerSheet) return;
  var desc = "뷰어 1~3행 구조 보호 (삭제방지)";
  // 기존 동일 보호가 있으면 제거 후 재생성
  var existing = viewerSheet.getProtections(
    SpreadsheetApp.ProtectionType.RANGE,
  );
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i].getDescription() || "") === desc) {
      existing[i].remove();
    }
  }
  try {
    var prot = viewerSheet.getRange("1:3").protect().setDescription(desc);
    // 편집자(시트 소유자/관리자)는 편집 가능, 나머지는 불가
    prot.setWarningOnly(true);
  } catch (e) {}
}

/**
 * 단가조회/뷰어 탭 3행의 IMPORTRANGE/XLOOKUP 수식이 깨졌는지 확인하고 복구.
 * C3(IMPORTRANGE)가 핵심 — 이게 없으면 A3~I3 전체가 빈 값.
 * @param {Sheet} viewerSheet
 * @param {string} [hubId] 허브 스프레드시트 ID (없으면 기존 수식에서 추출 시도)
 * @return {{ fixed: boolean, details: string }}
 */
function healViewerRow3Formulas_(viewerSheet, hubId) {
  var out = { fixed: false, details: "" };
  if (!viewerSheet) return out;

  // 허브 ID 추출: 인자로 없으면 Z1(IMPORTRANGE 권한 셀)에서 파싱
  if (!hubId) {
    try {
      var z1f = String(viewerSheet.getRange("Z1").getFormula() || "");
      var m = z1f.match(/IMPORTRANGE\s*\(\s*["']([a-zA-Z0-9_-]{30,50})["']/i);
      if (m) hubId = m[1];
    } catch (e) {}
  }
  if (!hubId) {
    // Y1에서도 시도
    try {
      var y1f = String(viewerSheet.getRange("Y1").getFormula() || "");
      var m2 = y1f.match(/IMPORTRANGE\s*\(\s*["']([a-zA-Z0-9_-]{30,50})["']/i);
      if (m2) hubId = m2[1];
    } catch (e) {}
  }
  if (!hubId) {
    out.details = "hubId를 찾을 수 없음 (Z1/Y1에 IMPORTRANGE 수식 없음)";
    return out;
  }

  // C3 수식 확인 — IMPORTRANGE가 있어야 함
  var c3f = "";
  try {
    c3f = String(viewerSheet.getRange("C3").getFormula() || "");
  } catch (e) {}
  var c3v = "";
  try {
    c3v = String(viewerSheet.getRange("C3").getDisplayValue() || "");
  } catch (e) {}

  // 소비자용 시트 여부 판별 (K2 존재 여부로)
  var isConsumer = false;
  try {
    var k2v = viewerSheet.getRange("K2").getValue();
    isConsumer = !k2v || String(k2v).trim() === "";
  } catch (e) {}
  // 소비자용이면 C3가 빈 것이 정상 — C열은 사용자 입력
  // 비소비자용이면 C3에 IMPORTRANGE 필요

  var needsRepair = false;
  if (!isConsumer) {
    // 비소비자: C3에 IMPORTRANGE 수식이 없거나 #REF이면 복구 필요
    if (
      !c3f ||
      c3f.indexOf("IMPORTRANGE") === -1 ||
      c3v.indexOf("#REF") !== -1
    ) {
      needsRepair = true;
    }
  } else {
    // 소비자: A3에 ARRAYFORMULA 수식이 없으면 복구 필요
    var a3f = "";
    try {
      a3f = String(viewerSheet.getRange("A3").getFormula() || "");
    } catch (e) {}
    if (!a3f || a3f.indexOf("ARRAYFORMULA") === -1) {
      needsRepair = true;
    }
  }

  if (!needsRepair) {
    out.details = "정상 (수식 손상 없음)";
    return out;
  }

  // ── 복구 시작 ──
  var hubLink = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!';
  var ids = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!C:C")';

  try {
    viewerSheet
      .getRange("A3")
      .setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids +
          ", " +
          hubLink +
          'A:A")), "-")))',
      );
    viewerSheet
      .getRange("B3")
      .setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids +
          ", " +
          hubLink +
          'B:B")), "-")))',
      );
    if (!isConsumer) {
      viewerSheet
        .getRange("C3")
        .setFormula('=IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!C3:C")');
    }
    viewerSheet
      .getRange("D3")
      .setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids +
          ", " +
          hubLink +
          'D:D")), "-")))',
      );
    viewerSheet
      .getRange("E3")
      .setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids +
          ", " +
          hubLink +
          'E:E")), "-")))',
      );
    viewerSheet
      .getRange("F3")
      .setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids +
          ", " +
          hubLink +
          'F:F")), "-")))',
      );

    // G3, H3, I3는 K2(단가그룹열) 참조 필요
    var gRange =
      'SUBSTITUTE(ADDRESS(1, K2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2, 4), "1", "")';
    var iRangeFormula =
      'SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "")';

    if (isConsumer) {
      // 소비자: DC 계산 — DC율은 K1 또는 메타에서 읽어야 하지만, 기존 수식 패턴 유지
      // G3 복구는 기존 수식이 깨진 경우만 — DC율을 모르면 기본 0.95 적용
      var g3f = "";
      try {
        g3f = String(viewerSheet.getRange("G3").getFormula() || "");
      } catch (e) {}
      if (!g3f || g3f.indexOf("ARRAYFORMULA") === -1) {
        viewerSheet
          .getRange("G3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(F3:F="-", "-", ROUNDUP(F3:F*0.95, -2)), "-")))',
          );
      }
    } else {
      viewerSheet
        .getRange("G3")
        .setFormula(
          '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
            ids +
            ', IMPORTRANGE("' +
            hubId +
            '", "전체 그룹 단가표!" & ' +
            gRange +
            ')), "-")))',
        );
    }

    viewerSheet
      .getRange("I3")
      .setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids +
          ', IMPORTRANGE("' +
          hubId +
          '", "전체 그룹 단가표!" & ' +
          iRangeFormula +
          ')), "-")))',
      );

    viewerSheet
      .getRange("H3")
      .setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(G3:G=I3:I, "-", G3:G-I3:I), "-")))',
      );

    out.fixed = true;
    out.details = "3행 수식 복구 완료 (hubId=" + hubId + ")";
  } catch (eRepair) {
    out.details = "복구 중 오류: " + (eRepair.message || eRepair);
  }
  return out;
}

/**
 * 모든 협력업체 배포 시트의 단가조회(뷰어) 탭을 점검:
 * 1) 1~3행 삭제 방지 보호 적용
 * 2) 3행 수식이 깨졌으면 자동 복구
 * 메뉴에서 수동 호출용.
 */
/**
 * 🚨 [긴급 복구] 전체 업체 단가조회 3행 수식 일괄 복구
 * - updateAllVendorSheets와 달리 오직 3행 수식(A3~J3)만 재주입
 * - 헤더/메타/보호/서식/발주탭 등 부가작업 전부 스킵 → 초고속
 * - 메뉴: 협력업체 관리 → AS/진단 → 복구 도구 → 🚨 단가조회 3행 수식 긴급 복구
 */
function emergencyRepairAllViewerRow3Formulas() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  if (ui) {
    var go = ui.alert(
      "🚨 단가조회 3행 수식 긴급 일괄 복구",
      "모든 배포 시트의 단가조회 탭 A3~J3 수식을 강제 재주입합니다.\n" +
        "(헤더/메타/보호 등은 건드리지 않고 수식만 빠르게 복구)\n\n계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (go !== ui.Button.YES) return;
  }

  var props = PropertiesService.getScriptProperties();
  var hubId = getCanonicalHubIdFromProps_(props);
  if (!hubId) {
    if (ui) ui.alert("❌ 허브 ID가 없습니다. 1번 메뉴(허브 구축)를 먼저 실행하세요.");
    return;
  }

  var hubGroupColumnMap = {};
  try {
    var hubSheetForGroups = getHubSS(hubId).getSheetByName("전체 그룹 단가표");
    if (hubSheetForGroups) {
      var hubHeaders1 = hubSheetForGroups
        .getRange(1, 1, 1, hubSheetForGroups.getLastColumn())
        .getValues()[0];
      hubGroupColumnMap = buildHubGroupColumnMap_(hubHeaders1);
    }
  } catch (eHubGroup) {}

  var files = listAllDeployFiles_();
  // 배포 파일 수집 (중복 제거)
  var allFiles = [];
  var seenIds = {};
  for (var di = 0; di < files.length; di++) {
    var df = files[di];
    var dfId = df.getId();
    if (!seenIds[dfId]) {
      seenIds[dfId] = true;
      allFiles.push({ id: dfId, name: df.getName() });
    }
  }
  try {
    if (typeof _pt_listFiles === "function") {
      var ptFiles = _pt_listFiles();
      for (var pi = 0; pi < ptFiles.length; pi++) {
        var pf = ptFiles[pi];
        if (!seenIds[pf.id]) {
          seenIds[pf.id] = true;
          allFiles.push({ id: pf.id, name: pf.name });
        }
      }
    }
  } catch (e) {}

  var total = 0;
  var repaired = 0;
  var skipped = 0;
  var errors = [];

  for (var fi = 0; fi < allFiles.length; fi++) {
    var file = allFiles[fi];
    total++;
    try {
      var ss = SpreadsheetApp.openById(file.id);
      var viewer =
        typeof findViewerSheet_ === "function" ? findViewerSheet_(ss) : null;
      if (!viewer) {
        skipped++;
        continue;
      }

      // K2에서 단가그룹 열 번호 읽기
      var K2 = "";
      try { K2 = viewer.getRange("K2").getValue(); } catch (e) {}
      if (!K2) {
        try { K2 = viewer.getRange("K1").getValue(); } catch (e) {}
      }
      var k2Num = parseInt(K2, 10);

      // 소비자용 판별: deployMeta 또는 파일명
      var isConsumer = false;
      try {
        var metaType = String(viewer.getRange(DEPLOY_META_TYPE_CELL).getValue() || "").trim();
        if (metaType === "consumer") isConsumer = true;
        if (!metaType && String(file.name).indexOf("(소비자용)") !== -1) isConsumer = true;
      } catch (e) {}

      // DC율 (소비자용 전용)
      var dcMultiplier = 0.95; // 기본 5%DC
      if (isConsumer) {
        try {
          var metaDc = String(viewer.getRange(DEPLOY_META_DC_RATE_CELL).getValue() || "").trim();
          var dcNum = parseFloat(metaDc);
          if (!isNaN(dcNum) && dcNum >= 1 && dcNum <= 10) {
            dcMultiplier = (100 - dcNum) / 100;
          }
        } catch (e) {}
      }

      // 수식 주입
      var hubLink = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!';
      var ids = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!C:C")';

      // 병합/숨김 해제 (수식 주입 실패 방지)
      try { viewer.getRange("A3:J3").breakApart(); } catch (e) {}

      // A3: 상태
      viewer.getRange("A3").setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids + ", " + hubLink + 'A:A")), "-")))'
      );
      // B3: 출고지
      viewer.getRange("B3").setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids + ", " + hubLink + 'B:B")), "-")))'
      );
      // C3: 이카운트코드 (수동 모드 전용 — 사용자 직접 입력/삭제, 수식 미개입)
      // D3: 품목명
      viewer.getRange("D3").setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids + ", " + hubLink + 'D:D")), "-")))'
      );
      // E3: 재고
      viewer.getRange("E3").setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids + ", " + hubLink + 'E:E")), "-")))'
      );
      // F3: 소비자가
      viewer.getRange("F3").setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
          ids + ", " + hubLink + 'F:F")), "-")))'
      );

      // G3: 최종단가 (K2 기준 동적 열 참조, 소비자는 DC 계산)
      var gRange =
        'SUBSTITUTE(ADDRESS(1, K2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2, 4), "1", "")';
      if (isConsumer) {
        viewer.getRange("G3").setFormula(
          '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(F3:F="-", "-", ROUNDUP(F3:F*' +
            dcMultiplier + ', -2)), "-")))'
        );
      } else if (k2Num) {
        viewer.getRange("G3").setFormula(
          '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
            ids + ', IMPORTRANGE("' + hubId +
            '", "전체 그룹 단가표!" & ' + gRange + ')), "-")))'
        );
      }

      // H3: 단가변동
      viewer.getRange("H3").setFormula(
        '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(G3:G=I3:I, "-", G3:G-I3:I), "-")))'
      );

      // I3: 지난단가 (K2+2 열)
      var iRangeFormula =
        'SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "")';
      if (k2Num) {
        viewer.getRange("I3").setFormula(
          '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
            ids + ', IMPORTRANGE("' + hubId +
            '", "전체 그룹 단가표!" & ' + iRangeFormula + ')), "-")))'
        );
      }

      // J3: 익월변동단가 (K2+4 열) — 비소비자만
      if (!isConsumer && k2Num) {
        var jRangeFormula =
          'SUBSTITUTE(ADDRESS(1, K2+4, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2+4, 4), "1", "")';
        viewer.getRange("J3").setFormula(
          '=ARRAYFORMULA(IF(C3:C="", "", LET(nxt, IFNA(XLOOKUP(C3:C, ' +
            ids + ', IMPORTRANGE("' + hubId +
            '", "전체 그룹 단가표!" & ' + jRangeFormula +
            ')), "-"), IF((nxt="-") + (nxt="") + (nxt=G3:G), "-", nxt))))'
        );
      }

      repaired++;
    } catch (e) {
      errors.push(file.name + ": " + (e.message || e));
    }
  }

  var msg =
    "🚨 단가조회 3행 수식 긴급 복구 완료\n\n" +
    "- 전체 파일: " + total + "개\n" +
    "- 수식 복구: " + repaired + "개\n" +
    "- 뷰어탭 없음(스킵): " + skipped + "개\n" +
    "- 오류: " + errors.length + "개";
  if (errors.length > 0) {
    msg += "\n\n⚠️ 오류 목록:\n" + errors.slice(0, 5).join("\n");
  }
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

function repairAndProtectAllViewerSheets() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    ui = null;
  }
  if (ui) {
    var go = ui.alert(
      "🔧 뷰어 3행 보호 & 복구",
      "모든 협력업체 배포 시트의 단가조회 탭을 점검합니다:\n" +
        "1) 1~3행 삭제 방지 보호 적용\n" +
        "2) 3행 수식이 깨졌으면 자동 복구\n\n계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (go !== ui.Button.YES) return;
  }

  var report = [];
  var protectedCount = 0;
  var repairedCount = 0;
  var files = listAllDeployFiles_();

  for (var fi = 0; fi < files.length; fi++) {
    var file = files[fi];
    try {
      var ss = SpreadsheetApp.openById(file.getId());
      var viewer =
        typeof findViewerSheet_ === "function" ? findViewerSheet_(ss) : null;
      if (!viewer) continue;

      // 보호 적용
      protectViewerCriticalRows_(viewer);
      protectedCount++;

      // 수식 복구 확인
      var healResult = healViewerRow3Formulas_(viewer);
      if (healResult.fixed) {
        repairedCount++;
        report.push("🔧 [" + file.getName() + "] " + healResult.details);
        SpreadsheetApp.flush();
      }
    } catch (e) {
      report.push("❌ [" + file.getName() + "] " + (e.message || e));
    }
  }

  var msg =
    "✅ 뷰어 3행 보호 & 복구 완료\n" +
    "보호 적용: " +
    protectedCount +
    "개\n" +
    "수식 복구: " +
    repairedCount +
    "개";
  if (report.length > 0) msg += "\n\n" + report.join("\n");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

function installAllVendorScriptsNoUI() {
  var allFiles = typeof _pt_listFiles === "function" ? _pt_listFiles(true) : [];
  if (allFiles.length === 0) {
    Logger.log("협력업체 배포 파일을 찾지 못했습니다.");
    return;
  }
  var scanned = 0, ok = 0, failed = [];
  for (var i = 0; i < allFiles.length; i++) {
    scanned++;
    try {
      var ss = SpreadsheetApp.openById(allFiles[i].id);
      createViewerNoticeScript_(ss);
      // ★ 2026-07-06: 뷰어 탭 #REF! 자동 복구
      try {
        var tabs = ss.getSheets();
        for (var ti = 0; ti < tabs.length; ti++) {
          var tn = tabs[ti].getName();
          if (tn.indexOf('단가') !== -1 || tn.indexOf('뷰어') !== -1 || tn.indexOf('팩투유') !== -1) {
            var a3v = String(tabs[ti].getRange('A3').getDisplayValue() || '');
            if (a3v.indexOf('#REF') !== -1 || a3v.indexOf('#오류') !== -1) {
              var vLr2 = Math.max(tabs[ti].getLastRow(), 4);
              if (vLr2 >= 4) {
                var cr = vLr2 - 3;
                try { tabs[ti].getRange(4, 1, cr, 2).clearContent(); } catch(e1) {}
                try { tabs[ti].getRange(4, 4, cr, 7).clearContent(); } catch(e2) {}
              }
            }
            break;
          }
        }
      } catch(eRef) {}
      ok++;
      Logger.log("✅ 성공: " + allFiles[i].name);
    } catch (e) {
      failed.push(allFiles[i].name + " (" + (e.message || e) + ")");
      Logger.log("❌ 실패: " + allFiles[i].name + " - " + e.message);
    }
  }
  Logger.log("일괄 배포 완료. 총: " + scanned + "개 중 성공: " + ok + "개, 실패: " + failed.length + "개");
}
