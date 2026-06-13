const VENDOR_META_NAME_CELL = "AA1";
const VENDOR_META_CUST_CELL = "AB1";
const VENDOR_META_FILEID_CELL = "AC1";
const VENDOR_ORDER_TARGET_FOLDER_ID_LEGACY = "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v";

/**
 * 배포 시트 안에서 '뷰어/단가조회' 탭을 안전하게 찾아 반환.
 * - 일반 배포(createVendorVlookupSheet): "<업체명> 뷰어"
 * - 소비자 DC 배포: "<업체명> 단가조회"
 * - 과거 포맷/수동 리네임까지 fuzzy 매칭으로 포괄.
 * - 매칭이 복수여도 '마감' 탭은 제외(월별 아카이브 오매칭 방지).
 * @param {Spreadsheet} ss
 * @return {Sheet|null}
 */
function findViewerSheet_(ss) {
  if (!ss) return null;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = String(sheets[i].getName() || "");
    if (n.indexOf("마감") !== -1) continue;
    if (n.indexOf("단가조회") !== -1 || n.indexOf("뷰어") !== -1) {
      return sheets[i];
    }
  }
  // 완전 실패 시 null 반환 (랜덤 첫 탭 fallback은 위험하므로 금지)
  return null;
}

function isVendorDeployFileNameForMap_(name) {
  var n = String(name || "");
  return (
    n.indexOf("[독립 배포]") !== -1 ||
    n.indexOf("[독립배포]") !== -1 ||
    n.indexOf("독립 배포") !== -1 ||
    n.indexOf("독립배포") !== -1
  );
}

function listAllDeployFiles_() {
  var out = [];
  var seen = {};
  var folderIds = [
    typeof ORDER_TARGET_FOLDER_ID !== "undefined" ? ORDER_TARGET_FOLDER_ID : "",
    typeof TARGET_FOLDER_ID !== "undefined" ? TARGET_FOLDER_ID : "",
    VENDOR_ORDER_TARGET_FOLDER_ID_LEGACY,
  ];
  for (var i = 0; i < folderIds.length; i++) {
    var fid = String(folderIds[i] || "").trim();
    if (!fid || seen["FOLDER:" + fid]) continue;
    seen["FOLDER:" + fid] = true;
    var folder;
    try {
      folder = DriveApp.getFolderById(fid);
    } catch (eFolder) {
      continue;
    }
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (!isVendorDeployFileNameForMap_(f.getName())) continue;
      var k = f.getId();
      if (seen[k]) continue;
      seen[k] = true;
      out.push(f);
    }
  }
  return out;
}
const VENDOR_CUST_HEADERS = [
  "거래처명",
  "거래처코드(CUST_CD)",
  "단가그룹",
  "배포시트ID",
  "배포시트명",
  "최종동기화시각",
  "운영유형",
  "드롭다운사용",
  "송장회신사용",
  "송장입력주체",
  "가격표시",
  "잠금프로필",
  "override_드롭다운사용",
  "override_송장회신사용",
  "DC율기본",
  "override_DC율",
  "적용모드",
  "적용예약시각",
  "예외사용",
  "예외단가그룹",
  "운영메모",
  "변경요청자",
  "최종적용시각",
];

const VENDOR_GROUP_APPLY_MODE_DEFAULT = "수동";
const VENDOR_GROUP_APPLY_MODE_LIST = ["수동", "즉시", "예약"];

const VENDOR_POLICY_TYPE_DEFAULT = "대리판매";
const VENDOR_POLICY_DEFAULTS_BY_TYPE = {
  "대리판매": {
    dropdownEnabled: "N",
    invoiceReplyEnabled: "N",
    invoiceInputOwner: "판매처",
    priceVisibility: "비공개",
    lockProfile: "기본",
  },
  "대리발송": {
    dropdownEnabled: "N",
    invoiceReplyEnabled: "Y",
    invoiceInputOwner: "공급처",
    priceVisibility: "비공개",
    lockProfile: "강화",
  },
  "겸업": {
    dropdownEnabled: "Y",
    invoiceReplyEnabled: "Y",
    invoiceInputOwner: "혼합",
    priceVisibility: "비공개",
    lockProfile: "강화",
  },
  "일괄DC": {
    dropdownEnabled: "N",
    invoiceReplyEnabled: "N",
    invoiceInputOwner: "판매처",
    priceVisibility: "공개",
    lockProfile: "기본",
    dcRateDefault: "5",
  },
  "공급업체": {
    dropdownEnabled: "N",
    invoiceReplyEnabled: "Y",
    invoiceInputOwner: "공급처",
    priceVisibility: "비공개",
    lockProfile: "강화",
  },
  "프랜차이즈DC": {
    dropdownEnabled: "Y",
    invoiceReplyEnabled: "N",
    invoiceInputOwner: "판매처",
    priceVisibility: "공개",
    lockProfile: "기본",
    dcRateDefault: "5",
  },
};

function normalizeDcRate_(raw, fallback) {
  var v = String(raw || "").trim();
  if (!v) return String(fallback || "");
  var n = parseFloat(v);
  if (!isNaN(n) && n >= 1 && n <= 10) {
    var rounded = Math.round(n * 10) / 10; // 소수 1자리까지 허용
    return String(rounded);
  }
  return String(fallback || "");
}

function normalizeYesNo_(raw, fallback) {
  var v = String(raw || "").trim().toUpperCase();
  if (v === "Y" || v === "YES" || v === "TRUE" || v === "1") return "Y";
  if (v === "N" || v === "NO" || v === "FALSE" || v === "0") return "N";
  if (fallback === "") return "";
  return fallback || "N";
}

function normalizePolicyType_(raw) {
  var t = String(raw || "").trim();
  if (VENDOR_POLICY_DEFAULTS_BY_TYPE[t]) return t;
  return VENDOR_POLICY_TYPE_DEFAULT;
}

function guessPolicyTypeByFileName_(fileName) {
  var n = String(fileName || "");
  if (n.indexOf("(소비자용)") !== -1 || n.indexOf("DC") !== -1) {
    return "일괄DC";
  }
  return VENDOR_POLICY_TYPE_DEFAULT;
}

function buildResolvedVendorPolicy_(rawType, rawValues) {
  var type = normalizePolicyType_(rawType);
  var base = VENDOR_POLICY_DEFAULTS_BY_TYPE[type] || VENDOR_POLICY_DEFAULTS_BY_TYPE[VENDOR_POLICY_TYPE_DEFAULT];
  var out = {
    operatingType: type,
    dropdownEnabled: normalizeYesNo_(rawValues.dropdown, base.dropdownEnabled),
    invoiceReplyEnabled: normalizeYesNo_(rawValues.invoiceReply, base.invoiceReplyEnabled),
    invoiceInputOwner: String(rawValues.invoiceInputOwner || "").trim() || base.invoiceInputOwner,
    priceVisibility: String(rawValues.priceVisibility || "").trim() || base.priceVisibility,
    lockProfile: String(rawValues.lockProfile || "").trim() || base.lockProfile,
    overrideDropdownEnabled: normalizeYesNo_(rawValues.overrideDropdown, ""),
    overrideInvoiceReplyEnabled: normalizeYesNo_(rawValues.overrideInvoiceReply, ""),
    dcRateDefault: normalizeDcRate_(rawValues.dcRateDefault, base.dcRateDefault || ""),
    overrideDcRate: normalizeDcRate_(rawValues.overrideDcRate, ""),
  };
  if (out.overrideDropdownEnabled) out.dropdownEnabled = out.overrideDropdownEnabled;
  if (out.overrideInvoiceReplyEnabled) out.invoiceReplyEnabled = out.overrideInvoiceReplyEnabled;
  out.dcRate = out.overrideDcRate || out.dcRateDefault || "";
  return out;
}

function setupVendorCustCodeMappingSheet(silent) {
  silent = !!silent;
  var ss = resolveVendorMapMasterSpreadsheet_();
  var sheet = getOrCreateVendorCustMapSheet_(ss);
  // 매핑시트가 저장된 스프레드시트 ID를 기록
  // → 배포시트의 AA1/AB1 IMPORTRANGE 수식은 hubId가 아닌 이 ID를 참조해야 한다
  //   (관리자 시트 ≠ 허브 시트일 때 매핑이 안 먹던 고질적 버그의 원인)
  try {
    PropertiesService.getScriptProperties().setProperty(
      "VENDOR_MAP_SS_ID",
      ss.getId(),
    );
  } catch (eProp) {}
  upsertVendorRowsFromDeploymentSheets_(sheet);
  dedupeVendorCustMapRows_(sheet);
  ensureVendorCustMapSheetFormat_(sheet);
  validateVendorMapCoreColumns_(sheet);
  fillMissingPolicyDefaults_(sheet);
  highlightMissingCustCdRows_(sheet);
  var dup = highlightDuplicateFileIdRows_(sheet);
  if (!silent) {
    SpreadsheetApp.getUi().alert(
      "업체 매핑 시트를 최신화했습니다.\n`거래처코드(CUST_CD)`를 입력/수정 후 저장하세요.\n\n" +
        "배포시트ID 중복: " +
        dup.duplicateRows +
        "행 (" +
        dup.duplicateIds +
        "개 ID)",
    );
  }
}

function resolveVendorMapSheetForRead_(activeSs) {
  var ss = activeSs || SpreadsheetApp.getActiveSpreadsheet();
  var mapName =
    typeof SALES_PRICE_MAP_SHEET !== "undefined"
      ? SALES_PRICE_MAP_SHEET
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
      var remoteSheet = mapSs.getSheetByName(mapName);
      if (remoteSheet) return { ss: mapSs, sheet: remoteSheet, source: "property" };
    } catch (eOpen) {}
  }

  var localSheet = ss ? ss.getSheetByName(mapName) : null;
  if (localSheet) return { ss: ss, sheet: localSheet, source: "active" };
  return { ss: ss, sheet: null, source: "none" };
}

function resolveVendorMapMasterSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var mapName =
    typeof SALES_PRICE_MAP_SHEET !== "undefined"
      ? SALES_PRICE_MAP_SHEET
      : "업체등급단가매핑";

  // 1) 이미 고정된 매핑 마스터가 있으면 최우선
  try {
    var mapSsId = props.getProperty("VENDOR_MAP_SS_ID") || "";
    if (mapSsId) {
      var mapSs = SpreadsheetApp.openById(mapSsId);
      if (mapSs && mapSs.getSheetByName(mapName)) return mapSs;
    }
  } catch (e1) {}

  // 2) 메인 관리자 시트가 지정되어 있으면 그쪽을 우선
  try {
    var mainId = props.getProperty("MAIN_SS_ID") || "";
    if (mainId) {
      var mainSs = SpreadsheetApp.openById(mainId);
      if (mainSs) return mainSs;
    }
  } catch (e2) {}

  // 3) 마지막 fallback: 현재 활성 시트
  return SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
}

function validateVendorMapCoreColumns_(sheet) {
  if (!sheet) throw new Error("업체 매핑 시트를 찾을 수 없습니다.");
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 4)).getValues()[0];
  var expected = ["거래처명", "거래처코드(CUST_CD)", "단가그룹", "배포시트ID"];
  for (var i = 0; i < expected.length; i++) {
    var got = String(headers[i] || "").trim();
    if (got !== expected[i]) {
      throw new Error(
        "업체 매핑 시트 A:D 헤더가 변경되었습니다. " +
          (i + 1) +
          "열 기대값='" +
          expected[i] +
          "', 현재='" +
          got +
          "'",
      );
    }
  }
  return true;
}

function applyCustCodeToExistingVendorSheets(silent) {
  silent = !!silent;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapInfo = resolveVendorMapSheetForRead_(ss);
  var mapSheet = mapInfo.sheet;
  if (!mapSheet) {
    if (!silent)
      SpreadsheetApp.getUi().alert("`업체등급단가매핑` 시트를 찾을 수 없습니다.");
    return;
  }
  var rows = mapSheet.getDataRange().getValues();
  if (rows.length <= 1) {
    if (!silent) SpreadsheetApp.getUi().alert("`업체등급단가매핑` 시트에 데이터가 없습니다.");
    return;
  }

  var idx = mapVendorSheetIndexes_(rows[0]);
  var mapByVendor = {};
  var mapByVendorNorm = {};
  var mapByFileId = {};
  for (var i = 1; i < rows.length; i++) {
    var vendor = String(rows[i][idx.vendor] || "").trim();
    var vendorNorm = normalizeVendorKey_(vendor);
    var rowFileId = normalizeSheetId_(rows[i][idx.fileId]);
    var rowObj = {
      vendor: vendor,
      custCd: String(rows[i][idx.custCd] || "").trim(),
      groupName: String(rows[i][idx.group] || "").trim(),
      fileId: rowFileId,
    };
    if (vendor) {
      mapByVendor[vendor] = rowObj;
      mapByVendorNorm[vendorNorm] = rowObj;
    }
    if (rowObj.fileId) mapByFileId[rowObj.fileId] = rowObj;
  }

  // 매핑시트 ID(우선) 또는 허브 ID를 읽어 AA1/AB1을 IMPORTRANGE 수식으로 연결
  var mapSsId =
    PropertiesService.getScriptProperties().getProperty("VENDOR_MAP_SS_ID") || "";
  var hubId = PropertiesService.getScriptProperties().getProperty("DB_HUB_ID") || "";
  var canLinkFormula = !!(mapSsId || hubId);

  var applied = 0;
  var linkedFormula = 0;
  var deployFiles = listAllDeployFiles_();
  for (var fi = 0; fi < deployFiles.length; fi++) {
    var file = deployFiles[fi];
    var name = file.getName();
    if (!isVendorDeployFileNameForMap_(name)) continue;
    var vendorName = normalizeVendorName_(name);
    var conf =
      mapByFileId[normalizeSheetId_(file.getId())] ||
      mapByVendor[vendorName] ||
      mapByVendorNorm[normalizeVendorKey_(vendorName)];
    try {
      var viewerSS = SpreadsheetApp.openById(file.getId());
      var viewerSheet = findViewerSheet_(viewerSS);
      if (!viewerSheet) continue;

      // 1) AC1(fileId)는 키이므로 항상 최신으로 강제
      viewerSheet.getRange(VENDOR_META_FILEID_CELL).setValue(file.getId()).setFontColor("white");

      // 2) 매핑/허브 ID가 있으면 AA1/AB1은 IMPORTRANGE 수식으로 강제 연결
      //    → 매핑 시트에서 거래처명/CUST_CD만 바꾸면 즉시 반영됨 (정적 값이 아닌 수식)
      if (canLinkFormula && typeof applyViewerIdentityFormulaFromHubMap_ === "function") {
        applyViewerIdentityFormulaFromHubMap_(viewerSheet, hubId, file.getId());
        SpreadsheetApp.flush();
        var aa1AfterLink = String(viewerSheet.getRange(VENDOR_META_NAME_CELL).getValue() || "").trim();
        var ab1AfterLink = String(viewerSheet.getRange(VENDOR_META_CUST_CELL).getValue() || "").trim();
        var mapLinkBroken =
          aa1AfterLink.indexOf("[매핑연결실패]") === 0 ||
          aa1AfterLink.indexOf("[매핑없음:") === 0 ||
          (!aa1AfterLink && !!conf);
        if (mapLinkBroken && conf) {
          // IMPORTRANGE 권한/연결 실패 시 운영 중단 방지를 위해 정적 fallback 즉시 적용
          var fallbackName = String(conf.vendor || "").trim() || vendorName;
          viewerSheet.getRange(VENDOR_META_NAME_CELL).setValue(fallbackName).setFontColor("white");
          if (String(conf.custCd || "").trim()) {
            viewerSheet
              .getRange(VENDOR_META_CUST_CELL)
              .setValue(String(conf.custCd || "").trim())
              .setFontColor("white");
          } else if (!ab1AfterLink) {
            viewerSheet.getRange(VENDOR_META_CUST_CELL).setValue("").setFontColor("white");
          }
        }
        linkedFormula++;
      } else if (conf) {
        // 연결 ID가 전혀 없을 때만 정적 값 fallback (수식 연결 불가능한 예외 상황)
        var mappedName = String(conf.vendor || "").trim() || vendorName;
        viewerSheet.getRange(VENDOR_META_NAME_CELL).setValue(mappedName).setFontColor("white");
        if (conf.custCd) {
          viewerSheet.getRange(VENDOR_META_CUST_CELL).setValue(conf.custCd).setFontColor("white");
        }
      }

      // 설정 탭(B5/B6)에 입력된 거래처명/CUST_CD가 있으면 최우선으로 덮어쓴다.
      try {
        if (typeof applyLocalVendorIdentityOverride_ === "function") {
          applyLocalVendorIdentityOverride_(
            viewerSS,
            viewerSheet,
            conf && conf.vendor ? conf.vendor : vendorName,
            conf && conf.custCd ? conf.custCd : "",
          );
        }
      } catch (eLocalIdentity) {}

      // 3) 발주 및 송장조회 탭 A1/L1 spill 수식 self-heal
      //    - A1/L1이 깨졌거나 #REF!면 자동 재주입 (healOrderSpillFormulas_)
      //    - viewerSheet.getName()을 명시 전달 → 순환 종속성 방지
      try {
        var orderTab = viewerSS.getSheetByName("발주 및 송장조회");
        if (orderTab && typeof healOrderSpillFormulas_ === "function") {
          healOrderSpillFormulas_(orderTab, viewerSheet.getName());
        }
      } catch (eOrder) {}

      if (conf && conf.custCd) applied++;
    } catch (e) {}
  }

  if (!silent) {
    SpreadsheetApp.getUi().alert(
      "기존 배포시트 CUST_CD 반영 완료\n" +
        "- 매핑 연결(수식 IMPORTRANGE): " + linkedFormula + "개\n" +
        "- CUST_CD 확인된 업체: " + applied + "개",
    );
  }
}

function saveCurrentViewerVendorIdentity() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var active = ss.getActiveSheet();
  if (!active) return;
  var vendorName = normalizeVendorName_(ss.getName());
  active.getRange(VENDOR_META_NAME_CELL).setValue(vendorName).setFontColor("white");
  active.getRange(VENDOR_META_FILEID_CELL).setValue(ss.getId()).setFontColor("white");
}

function getOrCreateVendorCustMapSheet_(ss) {
  var sheet = ss.getSheetByName(SALES_PRICE_MAP_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SALES_PRICE_MAP_SHEET);
  } else if (sheet.getLastRow() < 1) {
    // keep sheet and rewrite below
  }
  ensureVendorCustMapSheetFormat_(sheet);
  validateVendorMapCoreColumns_(sheet);
  return sheet;
}

function ensureVendorCustMapSheetFormat_(sheet) {
  var headers = VENDOR_CUST_HEADERS;
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns(),
    );
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet
    .getRange(1, 1, 1, headers.length)
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 220); // 거래처명
  sheet.setColumnWidth(2, 180); // CUST_CD
  sheet.setColumnWidth(3, 130); // 단가그룹
  sheet.setColumnWidth(4, 210); // 배포시트ID
  sheet.setColumnWidth(5, 320); // 배포시트명
  sheet.setColumnWidth(6, 170); // 최종동기화시각
  sheet.setColumnWidth(7, 130); // 운영유형
  sheet.setColumnWidth(8, 95); // 드롭다운사용
  sheet.setColumnWidth(9, 95); // 송장회신사용
  sheet.setColumnWidth(10, 110); // 송장입력주체
  sheet.setColumnWidth(11, 90); // 가격표시
  sheet.setColumnWidth(12, 90); // 잠금프로필
  sheet.setColumnWidth(13, 140); // override_드롭다운사용
  sheet.setColumnWidth(14, 150); // override_송장회신사용
  sheet.setColumnWidth(15, 90); // DC율기본
  sheet.setColumnWidth(16, 105); // override_DC율
  sheet.setColumnWidth(17, 95); // 적용모드
  sheet.setColumnWidth(18, 170); // 적용예약시각
  sheet.setColumnWidth(19, 90); // 예외사용
  sheet.setColumnWidth(20, 150); // 예외단가그룹
  sheet.setColumnWidth(21, 180); // 운영메모
  sheet.setColumnWidth(22, 120); // 변경요청자
  sheet.setColumnWidth(23, 170); // 최종적용시각
  sheet.getRange("F2:F").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("R2:R").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("W2:W").setNumberFormat("yyyy-mm-dd hh:mm:ss");

  var maxRows = sheet.getMaxRows();
  if (maxRows >= 2) {
    var ynRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Y", "N"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 8, maxRows - 1, 1).setDataValidation(ynRule);
    sheet.getRange(2, 9, maxRows - 1, 1).setDataValidation(ynRule);
    sheet.getRange(2, 13, maxRows - 1, 1).setDataValidation(ynRule);
    sheet.getRange(2, 14, maxRows - 1, 1).setDataValidation(ynRule);

    var typeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(Object.keys(VENDOR_POLICY_DEFAULTS_BY_TYPE), true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 7, maxRows - 1, 1).setDataValidation(typeRule);

    var dcRule = SpreadsheetApp.newDataValidation()
      .requireNumberBetween(1, 10)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 15, maxRows - 1, 1).setDataValidation(dcRule);
    sheet.getRange(2, 16, maxRows - 1, 1).setDataValidation(dcRule);

    var applyModeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(VENDOR_GROUP_APPLY_MODE_LIST, true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 17, maxRows - 1, 1).setDataValidation(applyModeRule);
    sheet.getRange(2, 19, maxRows - 1, 1).setDataValidation(ynRule);
  }

  // 거래처명(A열) 존재 시 거래처코드(B열)는 필수 입력으로 강조
  var lr = sheet.getMaxRows();
  if (lr >= 2) {
    var requiredRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2<>"",$B2="")')
      .setBackground("#f4cccc")
      .setRanges([sheet.getRange(2, 2, lr - 1, 1)])
      .build();
    var okRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2<>"",$B2<>"")')
      .setBackground("#d9ead3")
      .setRanges([sheet.getRange(2, 2, lr - 1, 1)])
      .build();
    sheet.setConditionalFormatRules([requiredRule, okRule]);
  }
}

function registerVendorMappingOnCreate(vendorName, fileId, fileName, policySeed) {
  var ss = resolveVendorMapMasterSpreadsheet_();
  var sheet = getOrCreateVendorCustMapSheet_(ss);
  // 매핑시트가 저장된 ss 위치를 기록 (배포시트 AA1 수식의 IMPORTRANGE 대상)
  try {
    PropertiesService.getScriptProperties().setProperty(
      "VENDOR_MAP_SS_ID",
      ss.getId(),
    );
  } catch (eProp) {}
  var rows = sheet.getDataRange().getValues();
  var idx = mapVendorSheetIndexes_(rows[0]);
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var targetVendor = String(vendorName || "").trim();
  var targetVendorNorm = normalizeVendorKey_(targetVendor);
  var targetFileId = normalizeSheetId_(fileId);
  var targetFileNameNorm = normalizeVendorKey_(fileName);
  var inferredType =
    policySeed && policySeed.operatingType
      ? normalizePolicyType_(policySeed.operatingType)
      : guessPolicyTypeByFileName_(fileName);
  if (!targetVendor) return;

  for (var i = 1; i < rows.length; i++) {
    var existingVendor = String(rows[i][idx.vendor] || "").trim();
    var existingVendorNorm = normalizeVendorKey_(existingVendor);
    var existingFileId = normalizeSheetId_(rows[i][idx.fileId]);
    var existingFileNameNorm = normalizeVendorKey_(rows[i][idx.fileName]);
    if (
      existingFileId !== targetFileId &&
      existingVendorNorm !== targetVendorNorm &&
      existingFileNameNorm !== targetFileNameNorm
    ) {
      continue;
    }
    // 재발급/신규발급은 최신 fileId를 기준으로 갱신해야 이후 동기화가 정상 동작
    if (targetFileId && existingFileId !== targetFileId) {
      sheet.getRange(i + 1, idx.fileId + 1).setValue(targetFileId);
    }
    if (fileName && existingFileNameNorm !== targetFileNameNorm) {
      sheet.getRange(i + 1, idx.fileName + 1).setValue(fileName);
    }
    if (!existingVendor && targetVendor) {
      sheet.getRange(i + 1, idx.vendor + 1).setValue(targetVendor);
    }
    // 정책 기본값/override는 기존 값 유지가 우선이며, 빈 값만 보강한다.
    var rowWidth = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
    var cur = sheet.getRange(i + 1, 1, 1, rowWidth).getValues()[0];
    if (policySeed && policySeed.overrideDropdownEnabled !== undefined) {
      cur[idx.overrideDropdownEnabled] = normalizeYesNo_(policySeed.overrideDropdownEnabled, "");
    }
    if (policySeed && policySeed.overrideInvoiceReplyEnabled !== undefined) {
      cur[idx.overrideInvoiceReplyEnabled] = normalizeYesNo_(policySeed.overrideInvoiceReplyEnabled, "");
    }
    cur = applyPolicyDefaultsToRowValues_(cur, idx, inferredType);
    sheet.getRange(i + 1, 1, 1, rowWidth).setValues([cur]);
    sheet.getRange(i + 1, idx.syncedAt + 1).setValue(now);
    highlightMissingCustCdRows_(sheet);
    return;
  }

  var newRow = new Array(VENDOR_CUST_HEADERS.length);
  for (var z = 0; z < newRow.length; z++) newRow[z] = "";
  newRow[idx.vendor] = targetVendor;
  newRow[idx.fileId] = targetFileId || "";
  newRow[idx.fileName] = fileName || "";
  newRow[idx.syncedAt] = now;
  newRow[idx.operatingType] = inferredType;
  if (policySeed && policySeed.overrideDropdownEnabled !== undefined) {
    newRow[idx.overrideDropdownEnabled] = normalizeYesNo_(policySeed.overrideDropdownEnabled, "");
  }
  if (policySeed && policySeed.overrideInvoiceReplyEnabled !== undefined) {
    newRow[idx.overrideInvoiceReplyEnabled] = normalizeYesNo_(policySeed.overrideInvoiceReplyEnabled, "");
  }
  newRow = applyPolicyDefaultsToRowValues_(newRow, idx, inferredType);
  sheet
    .getRange(sheet.getLastRow() + 1, 1, 1, newRow.length)
    .setValues([newRow]);
  highlightMissingCustCdRows_(sheet);
}

function upsertVendorRowsFromDeploymentSheets_(sheet) {
  var rows = sheet.getDataRange().getValues();
  var idx = mapVendorSheetIndexes_(rows[0]);

  var existingByVendorNorm = {};
  var existingByFileId = {};
  var existingByFileNameNorm = {};
  for (var i = 1; i < rows.length; i++) {
    var vendor = String(rows[i][idx.vendor] || "").trim();
    var fileId = normalizeSheetId_(rows[i][idx.fileId]);
    var fileNameNorm = normalizeVendorKey_(rows[i][idx.fileName]);
    if (!vendor && !fileId) continue;
    var rowObj = {
      rowNum: i + 1,
      custCd: String(rows[i][idx.custCd] || "").trim(),
      groupName: String(rows[i][idx.group] || "").trim(),
      fileId: fileId,
      fileName: String(rows[i][idx.fileName] || "").trim(),
    };
    if (vendor) existingByVendorNorm[normalizeVendorKey_(vendor)] = rowObj;
    if (fileId) existingByFileId[fileId] = rowObj;
    if (fileNameNorm) existingByFileNameNorm[fileNameNorm] = rowObj;
  }

  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var appendRows = [];
  var deployFiles = listAllDeployFiles_();

  for (var fi = 0; fi < deployFiles.length; fi++) {
    var file = deployFiles[fi];
    var name = file.getName();
    if (!isVendorDeployFileNameForMap_(name)) continue;
    var vendorName = normalizeVendorName_(name);
    var vendorNorm = normalizeVendorKey_(vendorName);
    var fileNameNorm = normalizeVendorKey_(name);
    if (!vendorName) continue;
    var metaCustCd = "";
    try {
      var viewerSS = SpreadsheetApp.openById(file.getId());
      var viewerSheet = findViewerSheet_(viewerSS) || viewerSS.getSheets()[0];
      metaCustCd = String(viewerSheet.getRange(VENDOR_META_CUST_CELL).getValue() || "").trim();
    } catch (e) {}

    // 🚨 [버그 수정] 매칭 우선순위를 엄격히 한다
    //   1) fileId 완전 일치 → 같은 시트 확정, 업데이트
    //   2) fileId 불일치 시에는 "기존 행의 fileId가 비어있는 경우"만 보강 매칭 허용
    //      (수동으로 거래처명/CUST_CD만 적어놓은 빈 껍데기 행을 자동 연결하기 위함)
    //   3) 위 2가지 모두 해당 안 되면 → 반드시 새 행 추가 (기존 행 덮어쓰기 금지)
    //   이전 로직은 같은 거래처명 시트가 여러 개일 때 뒷 시트가 앞 시트의 fileId를
    //   덮어써서 한 시트만 매핑에 남고 나머지는 [매핑없음]이 뜨는 버그가 있었음.
    var currentIdNorm = normalizeSheetId_(file.getId());
    var existed = existingByFileId[currentIdNorm];
    if (!existed) {
      var candidateByName = existingByFileNameNorm[fileNameNorm];
      if (candidateByName && !candidateByName.fileId) existed = candidateByName;
    }
    if (!existed) {
      var candidateByVendor = existingByVendorNorm[vendorNorm];
      if (candidateByVendor && !candidateByVendor.fileId) existed = candidateByVendor;
    }

    if (existed) {
      var rowNum = existed.rowNum;
      if (!existed.custCd && metaCustCd) {
        sheet.getRange(rowNum, idx.custCd + 1).setValue(metaCustCd);
      }
      // 거래처명은 비어있을 때만 보완
      if (!String(sheet.getRange(rowNum, idx.vendor + 1).getValue() || "").trim()) {
        sheet.getRange(rowNum, idx.vendor + 1).setValue(vendorName);
      }
      // fileId/fileName 동기화: 빈 행을 채우는 경우만 수행 (existed.fileId === "" 보장)
      var oldIdNorm = normalizeSheetId_(sheet.getRange(rowNum, idx.fileId + 1).getValue());
      if (currentIdNorm && oldIdNorm !== currentIdNorm) {
        sheet.getRange(rowNum, idx.fileId + 1).setValue(currentIdNorm);
        // 메모리 인덱스도 갱신해서 이번 턴에 다른 파일이 또 덮어쓰는 것 방지
        existingByFileId[currentIdNorm] = existed;
        existed.fileId = currentIdNorm;
      }
      var oldName = String(sheet.getRange(rowNum, idx.fileName + 1).getValue() || "").trim();
      if (name && oldName !== name) {
        sheet.getRange(rowNum, idx.fileName + 1).setValue(name);
      }
      try {
        var rowWidth = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
        var curRow = sheet.getRange(rowNum, 1, 1, rowWidth).getValues()[0];
        curRow = applyPolicyDefaultsToRowValues_(curRow, idx, guessPolicyTypeByFileName_(name));
        sheet.getRange(rowNum, 1, 1, rowWidth).setValues([curRow]);
      } catch (ePolicy) {}
      sheet.getRange(rowNum, idx.syncedAt + 1).setValue(now);
    } else {
      var newRow = new Array(VENDOR_CUST_HEADERS.length);
      for (var z = 0; z < newRow.length; z++) newRow[z] = "";
      newRow[idx.vendor] = vendorName;
      newRow[idx.custCd] = metaCustCd;
      newRow[idx.group] = "";
      newRow[idx.fileId] = currentIdNorm;
      newRow[idx.fileName] = name;
      newRow[idx.syncedAt] = now;
      newRow[idx.operatingType] = guessPolicyTypeByFileName_(name);
      newRow = applyPolicyDefaultsToRowValues_(newRow, idx, newRow[idx.operatingType]);
      appendRows.push(newRow);
    }
  }

  if (appendRows.length > 0) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, appendRows.length, appendRows[0].length)
      .setValues(appendRows);
  }
  highlightMissingCustCdRows_(sheet);
}

function mapVendorSheetIndexes_(headers) {
  var idx = {
    vendor: 0,
    custCd: 1,
    group: 2,
    fileId: 3,
    fileName: 4,
    syncedAt: 5,
    operatingType: 6,
    dropdownEnabled: 7,
    invoiceReplyEnabled: 8,
    invoiceInputOwner: 9,
    priceVisibility: 10,
    lockProfile: 11,
    overrideDropdownEnabled: 12,
    overrideInvoiceReplyEnabled: 13,
    dcRateDefault: 14,
    overrideDcRate: 15,
    applyMode: 16,
    scheduledAt: 17,
    exceptionEnabled: 18,
    exceptionGroup: 19,
    opsMemo: 20,
    requestor: 21,
    appliedAt: 22,
  };
  if (!headers || headers.length === 0) return idx;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "");
    if (h.indexOf("발주업체") !== -1) idx.vendor = i;
    if (h.indexOf("거래처명") !== -1 || h.indexOf("업체명") !== -1) idx.vendor = i;
    else if (h.indexOf("CUST_CD") !== -1 || h.indexOf("거래처코드") !== -1) idx.custCd = i;
    else if (h.indexOf("단가그룹") !== -1 || h.indexOf("등급") !== -1) idx.group = i;
    else if (h.indexOf("배포시트ID") !== -1 || h.indexOf("fileid") !== -1 || h.indexOf("스프레드시트ID") !== -1) idx.fileId = i;
    else if (h.indexOf("배포시트명") !== -1 || h.indexOf("파일명") !== -1) idx.fileName = i;
    else if (h.indexOf("최종동기화시각") !== -1) idx.syncedAt = i;
    else if (h.indexOf("운영유형") !== -1) idx.operatingType = i;
    else if (h.indexOf("드롭다운사용") !== -1 && h.indexOf("override_") === -1) idx.dropdownEnabled = i;
    else if (h.indexOf("송장회신사용") !== -1 && h.indexOf("override_") === -1) idx.invoiceReplyEnabled = i;
    else if (h.indexOf("송장입력주체") !== -1) idx.invoiceInputOwner = i;
    else if (h.indexOf("가격표시") !== -1) idx.priceVisibility = i;
    else if (h.indexOf("잠금프로필") !== -1) idx.lockProfile = i;
    else if (h.indexOf("override_드롭다운사용") !== -1) idx.overrideDropdownEnabled = i;
    else if (h.indexOf("override_송장회신사용") !== -1) idx.overrideInvoiceReplyEnabled = i;
    else if (h.indexOf("DC율기본") !== -1) idx.dcRateDefault = i;
    else if (h.indexOf("override_DC율") !== -1) idx.overrideDcRate = i;
    else if (h.indexOf("적용모드") !== -1) idx.applyMode = i;
    else if (h.indexOf("적용예약시각") !== -1) idx.scheduledAt = i;
    else if (h.indexOf("예외사용") !== -1) idx.exceptionEnabled = i;
    else if (h.indexOf("예외단가그룹") !== -1) idx.exceptionGroup = i;
    else if (h.indexOf("운영메모") !== -1) idx.opsMemo = i;
    else if (h.indexOf("변경요청자") !== -1) idx.requestor = i;
    else if (h.indexOf("최종적용시각") !== -1) idx.appliedAt = i;
  }
  return idx;
}

function applyPolicyDefaultsToRowValues_(rowValues, idx, fallbackType) {
  var out = rowValues.slice();
  var rawType = out[idx.operatingType] || fallbackType || "";
  var policy = buildResolvedVendorPolicy_(rawType, {
    dropdown: out[idx.dropdownEnabled],
    invoiceReply: out[idx.invoiceReplyEnabled],
    invoiceInputOwner: out[idx.invoiceInputOwner],
    priceVisibility: out[idx.priceVisibility],
    lockProfile: out[idx.lockProfile],
    overrideDropdown: out[idx.overrideDropdownEnabled],
    overrideInvoiceReply: out[idx.overrideInvoiceReplyEnabled],
    dcRateDefault: out[idx.dcRateDefault],
    overrideDcRate: out[idx.overrideDcRate],
  });
  out[idx.operatingType] = policy.operatingType;
  out[idx.dropdownEnabled] = normalizeYesNo_(out[idx.dropdownEnabled], policy.dropdownEnabled);
  out[idx.invoiceReplyEnabled] = normalizeYesNo_(out[idx.invoiceReplyEnabled], policy.invoiceReplyEnabled);
  out[idx.invoiceInputOwner] = String(out[idx.invoiceInputOwner] || "").trim() || policy.invoiceInputOwner;
  out[idx.priceVisibility] = String(out[idx.priceVisibility] || "").trim() || policy.priceVisibility;
  out[idx.lockProfile] = String(out[idx.lockProfile] || "").trim() || policy.lockProfile;
  out[idx.overrideDropdownEnabled] = normalizeYesNo_(out[idx.overrideDropdownEnabled], "");
  out[idx.overrideInvoiceReplyEnabled] = normalizeYesNo_(out[idx.overrideInvoiceReplyEnabled], "");
  out[idx.dcRateDefault] = normalizeDcRate_(out[idx.dcRateDefault], policy.dcRateDefault);
  out[idx.overrideDcRate] = normalizeDcRate_(out[idx.overrideDcRate], "");
  out[idx.applyMode] =
    String(out[idx.applyMode] || "").trim() || VENDOR_GROUP_APPLY_MODE_DEFAULT;
  if (VENDOR_GROUP_APPLY_MODE_LIST.indexOf(out[idx.applyMode]) === -1) {
    out[idx.applyMode] = VENDOR_GROUP_APPLY_MODE_DEFAULT;
  }
  out[idx.exceptionEnabled] = normalizeYesNo_(out[idx.exceptionEnabled], "N");
  out[idx.exceptionGroup] = String(out[idx.exceptionGroup] || "").trim();
  out[idx.opsMemo] = String(out[idx.opsMemo] || "").trim();
  out[idx.requestor] = String(out[idx.requestor] || "").trim();
  return out;
}

function markVendorGroupApplyResultByFileId_(fileId, appliedMode, note) {
  if (!fileId) return false;
  var info = resolveVendorMapSheetForRead_(SpreadsheetApp.getActiveSpreadsheet());
  var sheet = info.sheet;
  if (!sheet || sheet.getLastRow() < 2) return false;
  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var data = sheet.getRange(1, 1, sheet.getLastRow(), lc).getValues();
  var idx = mapVendorSheetIndexes_(data[0]);
  var needle = normalizeSheetId_(fileId);
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  for (var r = 1; r < data.length; r++) {
    var rowId = normalizeSheetId_(data[r][idx.fileId]);
    if (!rowId || rowId !== needle) continue;
    sheet.getRange(r + 1, idx.appliedAt + 1).setValue(now);
    if (appliedMode) sheet.getRange(r + 1, idx.applyMode + 1).setValue("수동");
    if (note) sheet.getRange(r + 1, idx.opsMemo + 1).setValue(String(note));
    return true;
  }
  return false;
}

function setApplyModeForSelectedVendorRows_(mode, scheduledAtText) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapInfo = resolveVendorMapSheetForRead_(ss);
  var sheet = mapInfo.sheet;
  if (!sheet) throw new Error("업체등급단가매핑 시트를 찾지 못했습니다.");
  var active = sheet.getActiveRange();
  if (!active || active.getNumRows() < 1) throw new Error("매핑 시트에서 대상 행을 먼저 선택하세요.");
  var modeText = String(mode || "").trim();
  if (VENDOR_GROUP_APPLY_MODE_LIST.indexOf(modeText) === -1) {
    throw new Error("적용모드가 올바르지 않습니다: " + modeText);
  }
  var idx = mapVendorSheetIndexes_(sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length)).getValues()[0]);
  var startRow = Math.max(2, active.getRow());
  var endRow = active.getLastRow();
  if (endRow < startRow) return 0;
  var rowCount = endRow - startRow + 1;
  var values = sheet.getRange(startRow, 1, rowCount, Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length)).getValues();
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var fileId = normalizeSheetId_(row[idx.fileId]);
    if (!fileId) continue;
    sheet.getRange(startRow + i, idx.applyMode + 1).setValue(modeText);
    if (modeText === "예약") {
      sheet.getRange(startRow + i, idx.scheduledAt + 1).setValue(String(scheduledAtText || "").trim());
    } else {
      sheet.getRange(startRow + i, idx.scheduledAt + 1).clearContent();
    }
    changed++;
  }
  return changed;
}

function requestImmediateApplyForSelectedVendors() {
  var changed = setApplyModeForSelectedVendorRows_("즉시", "");
  SpreadsheetApp.getUi().alert("적용요청 완료: " + changed + "개 행을 즉시 모드로 변경했습니다.");
}

function scheduleGroupApplyForSelectedVendors() {
  var ui = SpreadsheetApp.getUi();
  var prompt = ui.prompt(
    "적용 예약 시각",
    "형식: yyyy-mm-dd hh:mm:ss\n예: 2026-04-27 22:30:00",
    ui.ButtonSet.OK_CANCEL,
  );
  if (prompt.getSelectedButton() !== ui.Button.OK) return;
  var text = String(prompt.getResponseText() || "").trim();
  if (!text) {
    ui.alert("예약 시각을 입력해야 합니다.");
    return;
  }
  var changed = setApplyModeForSelectedVendorRows_("예약", text);
  ui.alert("예약 적용 설정 완료: " + changed + "개 행");
}

function diagnoseVendorGroupApplyQueue() {
  var mapInfo = resolveVendorMapSheetForRead_(SpreadsheetApp.getActiveSpreadsheet());
  var sheet = mapInfo.sheet;
  if (!sheet || sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert("매핑 시트 데이터가 없습니다.");
    return;
  }
  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var data = sheet.getRange(1, 1, sheet.getLastRow(), lc).getValues();
  var idx = mapVendorSheetIndexes_(data[0]);
  var now = new Date();
  var pendingManual = 0;
  var pendingScheduled = 0;
  var readyScheduled = 0;
  var immediate = 0;
  var badRows = 0;
  for (var r = 1; r < data.length; r++) {
    var fileId = normalizeSheetId_(data[r][idx.fileId]);
    if (!fileId) continue;
    var mode = String(data[r][idx.applyMode] || VENDOR_GROUP_APPLY_MODE_DEFAULT).trim();
    if (mode === "즉시") immediate++;
    else if (mode === "예약") {
      pendingScheduled++;
      var dt = new Date(String(data[r][idx.scheduledAt] || "").trim());
      if (!isNaN(dt.getTime()) && dt.getTime() <= now.getTime()) readyScheduled++;
      else if (isNaN(dt.getTime())) badRows++;
    } else {
      pendingManual++;
    }
  }
  SpreadsheetApp.getUi().alert(
    "단가그룹 적용 대기 현황\n" +
      "- 수동 대기: " +
      pendingManual +
      "개\n- 즉시 요청: " +
      immediate +
      "개\n- 예약 대기: " +
      pendingScheduled +
      "개\n- 예약 도래(실행가능): " +
      readyScheduled +
      "개\n- 예약시각 형식 오류: " +
      badRows +
      "개",
  );
}

function showVendorGroupPilotRolloutGuide() {
  var mapInfo = resolveVendorMapSheetForRead_(SpreadsheetApp.getActiveSpreadsheet());
  var sheet = mapInfo.sheet;
  if (!sheet || sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert("매핑 시트 데이터가 없어 파일럿 대상을 계산할 수 없습니다.");
    return;
  }
  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var data = sheet.getRange(1, 1, sheet.getLastRow(), lc).getValues();
  var idx = mapVendorSheetIndexes_(data[0]);
  var candidates = [];
  var seenType = {};
  for (var r = 1; r < data.length; r++) {
    var fileId = normalizeSheetId_(data[r][idx.fileId]);
    if (!fileId) continue;
    var vendor = String(data[r][idx.vendor] || "").trim() || "(이름없음)";
    var opType = String(data[r][idx.operatingType] || VENDOR_POLICY_TYPE_DEFAULT).trim();
    if (!seenType[opType]) {
      seenType[opType] = true;
      candidates.push("- " + vendor + " [" + opType + "] fileId=" + fileId);
      if (candidates.length >= 3) break;
    }
  }
  var lines = [];
  lines.push("단가그룹 유연 운영 파일럿 가이드");
  lines.push("");
  lines.push("1) 서로 다른 운영유형 2~3개 업체를 선정");
  lines.push("2) 매핑시트에서 대상 행 선택 후 '선택 업체 즉시 적용' 실행");
  lines.push("3) 배포시트 강제 업데이트 실행 후 AA1/AB1/최종단가(G열) 검증");
  lines.push("4) 이상 없으면 다음 업체군으로 단계 확대");
  lines.push("");
  lines.push("[추천 후보]");
  lines.push(candidates.length ? candidates.join("\n") : "- 후보 계산 불가");
  SpreadsheetApp.getUi().alert(lines.join("\n"));
}

function fillMissingPolicyDefaults_(sheet) {
  var lr = sheet.getLastRow();
  if (lr < 2) return 0;
  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var values = sheet.getRange(2, 1, lr - 1, lc).getValues();
  var idx = mapVendorSheetIndexes_(sheet.getRange(1, 1, 1, lc).getValues()[0]);
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    var before = values[i];
    var existingType = String(before[idx.operatingType] || "").trim();
    var inferredType = existingType
      ? normalizePolicyType_(existingType)
      : guessPolicyTypeByFileName_(before[idx.fileName]);
    var after = applyPolicyDefaultsToRowValues_(before, idx, inferredType);
    var dirty = false;
    for (var c = 0; c < lc; c++) {
      if (String(before[c] || "") !== String(after[c] || "")) {
        dirty = true;
        break;
      }
    }
    if (!dirty) continue;
    sheet.getRange(i + 2, 1, 1, lc).setValues([after]);
    changed++;
  }
  return changed;
}

function buildVendorPolicyFromRow_(row, idx) {
  if (!row || !idx) return buildResolvedVendorPolicy_(VENDOR_POLICY_TYPE_DEFAULT, {});
  return buildResolvedVendorPolicy_(row[idx.operatingType], {
    dropdown: row[idx.dropdownEnabled],
    invoiceReply: row[idx.invoiceReplyEnabled],
    invoiceInputOwner: row[idx.invoiceInputOwner],
    priceVisibility: row[idx.priceVisibility],
    lockProfile: row[idx.lockProfile],
    overrideDropdown: row[idx.overrideDropdownEnabled],
    overrideInvoiceReply: row[idx.overrideInvoiceReplyEnabled],
    dcRateDefault: row[idx.dcRateDefault],
    overrideDcRate: row[idx.overrideDcRate],
  });
}

function getVendorPolicyByFileId_(sheet, fileId) {
  if (!sheet || !fileId) return null;
  var lr = sheet.getLastRow();
  if (lr < 2) return null;
  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var data = sheet.getRange(1, 1, lr, lc).getValues();
  var idx = mapVendorSheetIndexes_(data[0]);
  var needle = normalizeSheetId_(fileId);
  for (var r = 1; r < data.length; r++) {
    var rowFileId = normalizeSheetId_(data[r][idx.fileId]);
    if (rowFileId && rowFileId === needle) {
      return buildVendorPolicyFromRow_(data[r], idx);
    }
  }
  return null;
}

function getVendorPolicyByFileNameOrVendor_(sheet, fileName) {
  if (!sheet || !fileName) return null;
  var lr = sheet.getLastRow();
  if (lr < 2) return null;

  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var data = sheet.getRange(1, 1, lr, lc).getValues();
  var idx = mapVendorSheetIndexes_(data[0]);
  var nameNeedle = normalizeVendorKey_(fileName);
  var vendorNeedle = normalizeVendorKey_(normalizeVendorName_(fileName));
  if (!nameNeedle && !vendorNeedle) return null;

  // 1차: 배포시트명 우선 매칭 (가장 정확)
  for (var r = 1; r < data.length; r++) {
    var rowFileName = String(data[r][idx.fileName] || "").trim();
    if (!rowFileName) continue;
    if (normalizeVendorKey_(rowFileName) === nameNeedle) {
      return buildVendorPolicyFromRow_(data[r], idx);
    }
  }

  // 2차: 거래처명 매칭 (재발급/파일명 수정 상황 대비)
  for (var r2 = 1; r2 < data.length; r2++) {
    var rowVendor = String(data[r2][idx.vendor] || "").trim();
    if (!rowVendor) continue;
    if (normalizeVendorKey_(rowVendor) === vendorNeedle) {
      return buildVendorPolicyFromRow_(data[r2], idx);
    }
  }
  return null;
}

function updateVendorPolicyOverridesByFileId_(fileId, overrides) {
  if (!fileId) return false;
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
  var sheet = getOrCreateVendorCustMapSheet_(ss);
  var lr = sheet.getLastRow();
  if (lr < 2) return false;
  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var data = sheet.getRange(1, 1, lr, lc).getValues();
  var idx = mapVendorSheetIndexes_(data[0]);
  var needle = normalizeSheetId_(fileId);
  for (var r = 1; r < data.length; r++) {
    var rowFileId = normalizeSheetId_(data[r][idx.fileId]);
    if (!rowFileId || rowFileId !== needle) continue;
    var row = data[r].slice();
    if (overrides && overrides.operatingType) {
      row[idx.operatingType] = normalizePolicyType_(overrides.operatingType);
    }
    if (overrides && overrides.overrideDropdownEnabled !== undefined) {
      row[idx.overrideDropdownEnabled] = normalizeYesNo_(overrides.overrideDropdownEnabled, "");
    }
    if (overrides && overrides.overrideInvoiceReplyEnabled !== undefined) {
      row[idx.overrideInvoiceReplyEnabled] = normalizeYesNo_(overrides.overrideInvoiceReplyEnabled, "");
    }
    if (overrides && overrides.overrideDcRate !== undefined) {
      row[idx.overrideDcRate] = normalizeDcRate_(overrides.overrideDcRate, "");
    }
    row = applyPolicyDefaultsToRowValues_(row, idx, row[idx.operatingType]);
    sheet.getRange(r + 1, 1, 1, lc).setValues([row]);
    return true;
  }
  return false;
}

function normalizeVendorName_(raw) {
  return String(raw || "")
    .replace(/\[독립\s*배포\]/g, "")
    .replace(/\s*\(소비자용\)\s*.*$/, "")
    .trim();
}

function normalizeVendorKey_(raw) {
  return normalizeVendorName_(raw)
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLowerCase();
}

function normalizeSheetId_(raw) {
  var s = String(raw || "").trim();
  if (!s) return "";
  var m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (m && m[1]) return m[1];
  var m2 = s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m2 && m2[1] ? m2[1] : s;
}

function dedupeVendorCustMapRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length <= 2) return;
  var idx = mapVendorSheetIndexes_(values[0]);
  var keepByKey = {};
  var deleteRows = [];
  for (var r = 1; r < values.length; r++) {
    var vendor = String(values[r][idx.vendor] || "").trim();
    var vendorNorm = normalizeVendorKey_(vendor);
    var fileId = normalizeSheetId_(values[r][idx.fileId]);
    var key = fileId ? "F:" + fileId : "V:" + vendorNorm;
    if (!key || key === "V:") continue;
    if (!keepByKey[key]) {
      keepByKey[key] = r + 1;
      if (fileId && String(values[r][idx.fileId] || "").trim() !== fileId) {
        sheet.getRange(r + 1, idx.fileId + 1).setValue(fileId);
      }
      continue;
    }
    var keepRow = keepByKey[key];
    var keepVals = sheet.getRange(keepRow, 1, 1, values[0].length).getValues()[0];
    var curVals = values[r];
    var keepCust = String(keepVals[idx.custCd] || "").trim();
    var curCust = String(curVals[idx.custCd] || "").trim();
    if (!keepCust && curCust) sheet.getRange(keepRow, idx.custCd + 1).setValue(curCust);
    var keepGroup = String(keepVals[idx.group] || "").trim();
    var curGroup = String(curVals[idx.group] || "").trim();
    if (!keepGroup && curGroup) sheet.getRange(keepRow, idx.group + 1).setValue(curGroup);
    var keepName = String(keepVals[idx.fileName] || "").trim();
    var curName = String(curVals[idx.fileName] || "").trim();
    if (!keepName && curName) sheet.getRange(keepRow, idx.fileName + 1).setValue(curName);
    deleteRows.push(r + 1);
  }
  deleteRows.sort(function (a, b) { return b - a; });
  for (var i = 0; i < deleteRows.length; i++) {
    try { sheet.deleteRow(deleteRows[i]); } catch (e) {}
  }
}

function highlightMissingCustCdRows_(sheet) {
  var lr = sheet.getLastRow();
  if (lr < 2) return;
  var values = sheet.getRange(2, 1, lr - 1, 2).getValues();
  var colors = [];
  for (var i = 0; i < values.length; i++) {
    var vendor = String(values[i][0] || "").trim();
    var cust = String(values[i][1] || "").trim();
    colors.push([vendor && !cust ? "#f4cccc" : "#ffffff"]);
  }
  sheet.getRange(2, 2, colors.length, 1).setBackgrounds(colors);
}

function highlightDuplicateFileIdRows_(sheet) {
  var lr = sheet.getLastRow();
  if (lr < 2) return { duplicateRows: 0, duplicateIds: 0 };
  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, lc).getValues()[0];
  var idx = mapVendorSheetIndexes_(headers);
  var values = sheet.getRange(2, 1, lr - 1, lc).getValues();
  var idCount = {};
  for (var i = 0; i < values.length; i++) {
    var id = normalizeSheetId_(values[i][idx.fileId]);
    if (!id) continue;
    idCount[id] = (idCount[id] || 0) + 1;
  }
  var dupRows = 0;
  var dupIds = 0;
  for (var k in idCount) {
    if (idCount[k] > 1) dupIds++;
  }
  var colors = [];
  var notes = [];
  for (var r = 0; r < values.length; r++) {
    var rowId = normalizeSheetId_(values[r][idx.fileId]);
    if (rowId && idCount[rowId] > 1) {
      colors.push(["#f4cccc"]);
      notes.push(["중복 배포시트ID: " + rowId]);
      dupRows++;
    } else {
      colors.push(["#ffffff"]);
      notes.push([""]);
    }
  }
  sheet.getRange(2, idx.fileId + 1, colors.length, 1).setBackgrounds(colors).setNotes(notes);
  return { duplicateRows: dupRows, duplicateIds: dupIds };
}

function checkDuplicateDeploySheetIdsInMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateVendorCustMapSheet_(ss);
  var dup = highlightDuplicateFileIdRows_(sheet);
  if (dup.duplicateRows > 0) {
    SpreadsheetApp.getUi().alert(
      "⚠️ 배포시트ID 중복 감지\n중복 행: " +
        dup.duplicateRows +
        "행\n중복 ID: " +
        dup.duplicateIds +
        "개\n\n`업체등급단가매핑` D열(배포시트ID) 빨간 셀을 정리하세요.",
    );
  } else {
    SpreadsheetApp.getUi().alert("✅ 배포시트ID 중복이 없습니다.");
  }
}

function validateVendorGroupControlColumns_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) {
    return { missingGroupRows: 0, invalidModeRows: 0 };
  }
  var lc = Math.max(sheet.getLastColumn(), VENDOR_CUST_HEADERS.length);
  var data = sheet.getRange(1, 1, sheet.getLastRow(), lc).getValues();
  var idx = mapVendorSheetIndexes_(data[0]);
  var missingGroupRows = 0;
  var invalidModeRows = 0;
  for (var r = 1; r < data.length; r++) {
    var fileId = normalizeSheetId_(data[r][idx.fileId]);
    if (!fileId) continue;
    var groupName = String(data[r][idx.group] || "").trim();
    var mode = String(data[r][idx.applyMode] || VENDOR_GROUP_APPLY_MODE_DEFAULT).trim();
    if (!groupName) missingGroupRows++;
    if (VENDOR_GROUP_APPLY_MODE_LIST.indexOf(mode) === -1) invalidModeRows++;
  }
  return {
    missingGroupRows: missingGroupRows,
    invalidModeRows: invalidModeRows,
  };
}

/**
 * 매핑 복구 원클릭 실행:
 * 1) 매핑 시트 자동수집/중복정리
 * 2) 기존 배포시트 CUST_CD/메타 반영
 */
function runVendorMapRepairAll(silent) {
  silent = !!silent;
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e0) {}
  try {
    setupVendorCustCodeMappingSheet(true);
    applyCustCodeToExistingVendorSheets(true);
    var mapInfo = resolveVendorMapSheetForRead_(SpreadsheetApp.getActiveSpreadsheet());
    var groupDiag = validateVendorGroupControlColumns_(mapInfo.sheet);
    if (!silent && ui) {
      ui.alert(
        "✅ 매핑 복구 일괄 실행 완료\n" +
          "- 6단계 자동수집/중복정리\n" +
          "- 6-1단계 기존 배포시트 반영\n" +
          "- 단가그룹 미지정: " +
          groupDiag.missingGroupRows +
          "행\n" +
          "- 적용모드 오류: " +
          groupDiag.invalidModeRows +
          "행",
      );
    }
  } catch (e) {
    if (!silent && ui) ui.alert("❌ 매핑 복구 일괄 실행 실패: " + e.message);
    else throw e;
  }
}

function validateVendorCustMappingReady_(ss) {
  var mapInfo = resolveVendorMapSheetForRead_(ss);
  var sheet = mapInfo.sheet;
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: false, missingCount: 0, missingFileIds: [], message: "업체 매핑 시트가 없습니다." };
  }
  var values = sheet.getDataRange().getValues();
  var idx = mapVendorSheetIndexes_(values[0]);
  var missing = [];
  var missingFileIds = []; // CUST_CD 미입력 행의 배포시트 fileId 목록 (스킵 판단용)
  for (var i = 1; i < values.length; i++) {
    var vendor = String(values[i][idx.vendor] || "").trim();
    var cust = String(values[i][idx.custCd] || "").trim();
    if (vendor && !cust) {
      missing.push(vendor);
      var fid = String(values[i][idx.fileId] || "").trim();
      if (fid) missingFileIds.push(fid);
    }
  }
  highlightMissingCustCdRows_(sheet);
  return {
    ok: missing.length === 0,
    missingCount: missing.length,
    missingFileIds: missingFileIds,
    message:
      missing.length === 0
        ? ""
        : "CUST_CD 미입력 업체 " + missing.length + "건: " + missing.slice(0, 10).join(", "),
  };
}

// =============================================================================
// 📋 매핑 연결 진단 (AA1이 왜 안 뜨는지 한번에 찍어주는 함수)
// =============================================================================
function diagnoseVendorMapping() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var hubId = props.getProperty("DB_HUB_ID") || "";
  var mapSsId = props.getProperty("VENDOR_MAP_SS_ID") || "";
  var activeSs = SpreadsheetApp.getActiveSpreadsheet();
  var activeId = activeSs ? activeSs.getId() : "";

  var lines = [];
  lines.push("=== 매핑 연결 진단 ===");
  lines.push("현재 관리자 시트 ID: " + activeId);
  lines.push("DB_HUB_ID (허브)   : " + hubId);
  lines.push("VENDOR_MAP_SS_ID   : " + mapSsId);
  lines.push("");

  // 1. 매핑시트 위치 확인
  var mapSs = activeSs;
  if (mapSsId && mapSsId !== activeId) {
    try { mapSs = SpreadsheetApp.openById(mapSsId); } catch (e) {}
  }
  var mapSheet = mapSs ? mapSs.getSheetByName(SALES_PRICE_MAP_SHEET) : null;
  if (!mapSheet) {
    lines.push("❌ 매핑시트(`" + SALES_PRICE_MAP_SHEET + "`)를 찾을 수 없음.");
    lines.push("   → 6-1단계(업체매핑 최신화)를 먼저 실행하세요.");
    ui.alert(lines.join("\n"));
    return;
  }
  var mapData = mapSheet.getDataRange().getValues();
  var mapRowCount = Math.max(0, mapData.length - 1);
  lines.push("✓ 매핑시트 위치: " + mapSs.getName() + " (" + mapSs.getId() + ")");
  lines.push("  - 데이터 행 수: " + mapRowCount);

  // 2. 매핑시트 D열(배포시트ID) 샘플
  var sampleIds = [];
  for (var i = 1; i < Math.min(mapData.length, 6); i++) {
    var a = String(mapData[i][0] || "");
    var d = String(mapData[i][3] || "");
    sampleIds.push("    [" + (i) + "] A='" + a + "' | D='" + d + "'");
  }
  lines.push("  - 샘플(최대 5행):");
  lines.push(sampleIds.join("\n") || "    (없음)");
  lines.push("");

  // 3. 배포시트 샘플 1개 점검
  try {
    var files = listAllDeployFiles_();
    var sampleCount = 0;
    for (var fi = 0; fi < files.length && sampleCount < 2; fi++) {
      var f = files[fi];
      sampleCount++;
      var fid = f.getId();
      lines.push("── 배포시트 [" + f.getName() + "]");
      lines.push("  fileId: " + fid);
      // 매핑시트 D열에 이 fileId 행이 몇 개인지
      var match = 0;
      var matchVendor = "";
      for (var r = 1; r < mapData.length; r++) {
        if (String(mapData[r][3] || "").trim() === fid) {
          match++;
          if (!matchVendor) matchVendor = String(mapData[r][0] || "");
        }
      }
      lines.push("  매핑시트 D열 매칭 행: " + match + "개" + (match ? " → A열='" + matchVendor + "'" : " ❌"));

      try {
        var dss = SpreadsheetApp.openById(fid);
        var viewer = findViewerSheet_(dss);
        if (!viewer) {
          lines.push("  ❌ '단가조회/뷰어' 탭을 찾을 수 없음");
          lines.push("");
          continue;
        }
        lines.push("  viewer 탭명    : '" + viewer.getName() + "'");
        var ac1 = String(viewer.getRange("AC1").getValue() || "");
        var ad1V = String(viewer.getRange("AD1").getValue() || "");
        var ae1F = String(viewer.getRange("AE1").getFormula() || "");
        var ae1V = String(viewer.getRange("AE1").getValue() || "");
        var aa1F = String(viewer.getRange("AA1").getFormula() || "");
        var aa1V = String(viewer.getRange("AA1").getValue() || "");
        var ab1V = String(viewer.getRange("AB1").getValue() || "");
        lines.push("  AC1(fileId)      : " + ac1 + (ac1 === fid ? " ✓" : " ❌ 불일치"));
        lines.push("  AD1(상태)        : " + ad1V);
        lines.push("  AE1 수식         : " + (ae1F.length > 120 ? ae1F.substring(0,120)+"..." : ae1F));
        lines.push("  AE1 값(첫셀)     : '" + ae1V + "' (비어있으면 IMPORTRANGE 권한 미승인)");
        lines.push("  AA1 수식         : " + (aa1F.length > 120 ? aa1F.substring(0,120)+"..." : aa1F));
        lines.push("  AA1 현재 값      : '" + aa1V + "'");
        lines.push("  AB1 현재 값      : '" + ab1V + "'");
      } catch (eF) {
        lines.push("  ❌ 배포시트 열기 실패: " + eF.message);
      }
      lines.push("");
    }
    if (sampleCount === 0) lines.push("❌ 배포 폴더에 [독립 배포] 파일이 없음.");
  } catch (eFolder) {
    lines.push("❌ 배포 폴더 열기 실패: " + eFolder.message);
  }

  // 콘솔과 UI 양쪽에 출력 (긴 내용이므로 콘솔이 더 편함)
  Logger.log(lines.join("\n"));
  try { console.log(lines.join("\n")); } catch (eC) {}
  ui.alert("매핑 진단 결과 (로그에도 동일하게 기록됨)\n\n" + lines.join("\n"));
}

// =============================================================================
// 📋 전체 배포시트 매핑 상태 일괄 진단 (어느 파일이 어떤 이유로 실패했는지 한 방에)
// =============================================================================
function diagnoseVendorMappingAll() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (eUi) { ui = null; }
  var props = PropertiesService.getScriptProperties();
  var mapSsId = props.getProperty("VENDOR_MAP_SS_ID") || "";
  var hubId = props.getProperty("DB_HUB_ID") || "";
  var activeSs = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 매핑시트 로드
  var mapSs = activeSs;
  if (mapSsId && mapSsId !== activeSs.getId()) {
    try { mapSs = SpreadsheetApp.openById(mapSsId); } catch (eMap) {}
  }
  var mapSheet = mapSs ? mapSs.getSheetByName(SALES_PRICE_MAP_SHEET) : null;
  var mapFileIdSet = {};
  var mapFileIdDupSet = {};
  if (mapSheet) {
    var md = mapSheet.getDataRange().getValues();
    for (var mi = 1; mi < md.length; mi++) {
      var fid = String(md[mi][3] || "").trim();
      if (!fid) continue;
      if (mapFileIdSet[fid]) mapFileIdDupSet[fid] = true;
      mapFileIdSet[fid] = (mapFileIdSet[fid] || 0) + 1;
    }
  }

  // 2. 전체 배포시트 스캔
  var files = listAllDeployFiles_();

  var summary = {
    total: 0,
    ok: 0,
    noViewerTab: 0,
    ac1Mismatch: 0,
    ae1Empty: 0,
    notInMap: 0,
    duplicatedInMap: 0,
    staticValue: 0,
    openFail: 0,
  };
  var failed = [];

  for (var fi2 = 0; fi2 < files.length; fi2++) {
    var file = files[fi2];
    summary.total++;

    var fname = file.getName();
    var fid2 = file.getId();
    var issues = [];
    var dss;
    try { dss = SpreadsheetApp.openById(fid2); } catch (eOpen) {
      summary.openFail++;
      failed.push("❌ [" + fname + "] 열기 실패: " + (eOpen.message || eOpen));
      continue;
    }
    var viewer = findViewerSheet_(dss);
    if (!viewer) {
      summary.noViewerTab++;
      var tabs = dss.getSheets().map(function (s) { return s.getName(); }).join(", ");
      failed.push("❌ [" + fname + "] '단가조회/뷰어' 탭을 찾을 수 없음 (현재 탭: " + tabs + ")");
      continue;
    }
    var viewerName = viewer.getName();
    var ac1, ad1V, ae1F, ae1V, aa1F, aa1V, ab1V;
    try {
      ac1  = String(viewer.getRange("AC1").getValue() || "").trim();
      ad1V = String(viewer.getRange("AD1").getValue() || "").trim();
      ae1F = String(viewer.getRange("AE1").getFormula() || "");
      ae1V = String(viewer.getRange("AE1").getValue() || "").trim();
      aa1F = String(viewer.getRange("AA1").getFormula() || "");
      aa1V = String(viewer.getRange("AA1").getValue() || "").trim();
      ab1V = String(viewer.getRange("AB1").getValue() || "").trim();
    } catch (eCell) {
      failed.push("❌ [" + fname + "] 셀 읽기 실패: " + (eCell.message || eCell));
      continue;
    }

    if (ac1 !== fid2) {
      summary.ac1Mismatch++;
      issues.push("AC1 fileId 불일치(현재='" + ac1 + "')");
    }
    if (!ae1F) {
      issues.push("AE1 수식 없음");
    } else if (!ae1V) {
      summary.ae1Empty++;
      issues.push("AE1 IMPORTRANGE 권한 미승인 (AE1 비어있음)");
    }
    if (!aa1F && aa1V) {
      summary.staticValue++;
      issues.push("AA1이 수식 없이 정적 값('" + aa1V + "')");
    }
    if (aa1V.indexOf("[매핑없음") === 0 || aa1V.indexOf("[매핑연결실패") === 0) {
      issues.push("AA1 에러='" + aa1V + "'");
    }
    if (mapSheet) {
      var cnt = mapFileIdSet[fid2] || 0;
      if (cnt === 0) {
        summary.notInMap++;
        issues.push("매핑시트 D열에 이 fileId 없음");
      } else if (mapFileIdDupSet[fid2]) {
        summary.duplicatedInMap++;
        issues.push("매핑시트 D열에 fileId " + cnt + "회 중복");
      }
    }

    if (issues.length === 0) {
      summary.ok++;
    } else {
      failed.push(
        "📄 [" + fname + "]\n" +
        "   fileId: " + fid2 + "\n" +
        "   viewer 탭: '" + viewerName + "'\n" +
        "   AA1='" + aa1V + "' / AB1='" + ab1V + "' / AD1='" + ad1V + "'\n" +
        "   AE1값='" + (ae1V.length > 80 ? ae1V.substring(0, 80) + "…" : ae1V) + "'\n" +
        "   ⚠ " + issues.join(" | ")
      );
    }
  }

  var head = [
    "=== 전체 배포시트 매핑 진단 ===",
    "활성 관리자 시트 ID: " + activeSs.getId(),
    "VENDOR_MAP_SS_ID    : " + mapSsId,
    "DB_HUB_ID           : " + hubId,
    "매핑시트 상태       : " + (mapSheet ? "✓ 로드됨(" + (mapSheet.getLastRow() - 1) + "행)" : "❌ 없음"),
    "",
    "🧮 요약",
    "  전체 배포파일    : " + summary.total,
    "  ✅ 정상         : " + summary.ok,
    "  ❌ AC1 불일치   : " + summary.ac1Mismatch,
    "  ❌ AE1 권한미승인: " + summary.ae1Empty,
    "  ❌ 단가조회 탭無: " + summary.noViewerTab,
    "  ❌ 매핑표 누락  : " + summary.notInMap,
    "  ⚠ 매핑표 중복  : " + summary.duplicatedInMap,
    "  ⚠ AA1 정적값   : " + summary.staticValue,
    "  ❌ 파일 열기실패: " + summary.openFail,
    "",
  ];
  var out = head.join("\n") + "\n──── 문제 파일 상세 ────\n" +
    (failed.length ? failed.join("\n\n") : "(없음 — 전부 정상)");

  Logger.log(out);
  try { console.log(out); } catch (eC) {}
  if (ui) ui.alert("매핑 전체 진단 결과 (로그에도 동일 기록)\n\n" + out);
  return summary;
}
