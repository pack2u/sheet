function checkStatusTab() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("상태");
    if (!sheet) {
      SpreadsheetApp.getUi().alert("상태 탭이 없습니다.");
      return;
    }
    var data = sheet.getDataRange().getValues();
    var str = "";
    for (var i = 0; i < Math.min(data.length, 10); i++) {
      str += data[i].join(" | ") + "\n";
    }
    SpreadsheetApp.getUi().alert("상태 탭 데이터:\n" + str);
  } catch (e) {
    SpreadsheetApp.getUi().alert("에러: " + e.message);
  }
}

/**
 * 허브 ID 강제 복구 — 중복 허브 생성 후 사용.
 * Apps Script 에디터에서 이 함수를 직접 실행하세요.
 */
function forceSetCorrectHubId() {
  var CORRECT_HUB_ID = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";
  var props = PropertiesService.getScriptProperties();
  var oldId = props.getProperty("DB_HUB_ID") || "(없음)";
  props.setProperty("DB_HUB_ID", CORRECT_HUB_ID);

  var msg =
    "✅ 허브 ID 복구 완료\n\n" +
    "이전 ID: " +
    oldId +
    "\n" +
    "현재 ID: " +
    CORRECT_HUB_ID +
    "\n\n" +
    "다음 단계:\n" +
    "1) forceReplaceAllImportRangeIds() 실행 → 모든 배포시트 IMPORTRANGE 교체\n" +
    "2) 또는 메뉴 → 💰 독립배포 관리 → 6) 배포시트 강제 업데이트 실행";
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {}
}

/**
 * 모든 독립배포시트의 IMPORTRANGE 수식에서 이전 허브 ID → 현재 ID로 일괄 교체.
 * 강제 업데이트 전체 프로세스를 거치지 않고 ID만 빠르게 교체합니다.
 * Apps Script 에디터에서 직접 실행하세요.
 */
function forceReplaceAllImportRangeIds() {
  var CORRECT_HUB_ID = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";
  var props = PropertiesService.getScriptProperties();
  props.setProperty("DB_HUB_ID", CORRECT_HUB_ID);

  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var folderIds = [ORDER_TARGET_FOLDER_ID, ORDER_TARGET_FOLDER_ID_LEGACY];
  var seen = {};
  var totalFixed = 0;
  var totalFiles = 0;
  var errors = [];
  var idPattern = /(IMPORTRANGE\s*\(\s*["'])[a-zA-Z0-9_-]{30,50}(["'])/gi;

  for (var fi = 0; fi < folderIds.length; fi++) {
    var fid = String(folderIds[fi] || "").trim();
    if (!fid || seen["F:" + fid]) continue;
    seen["F:" + fid] = true;

    var folder;
    try {
      folder = DriveApp.getFolderById(fid);
    } catch (e) {
      continue;
    }

    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      var fname = file.getName();
      if (fname.indexOf("독립") === -1 && fname.indexOf("배포") === -1)
        continue;
      if (seen[file.getId()]) continue;
      seen[file.getId()] = true;

      totalFiles++;
      try {
        var ss = SpreadsheetApp.openById(file.getId());
        var sheets = ss.getSheets();
        var fileFixed = 0;

        for (var si = 0; si < sheets.length; si++) {
          var sheet = sheets[si];
          var maxRow = Math.min(sheet.getLastRow(), 20);
          var maxCol = Math.min(sheet.getLastColumn(), 34); // AH까지
          if (maxRow < 1 || maxCol < 1) continue;

          var range = sheet.getRange(1, 1, maxRow, maxCol);
          var formulas = range.getFormulas();
          var changed = false;

          for (var r = 0; r < formulas.length; r++) {
            for (var c = 0; c < formulas[r].length; c++) {
              var f = formulas[r][c];
              if (f && f.toUpperCase().indexOf("IMPORTRANGE") !== -1) {
                var newF = f.replace(idPattern, "$1" + CORRECT_HUB_ID + "$2");
                if (newF !== f) {
                  // 개별 셀만 수식 교체 (다른 셀의 텍스트 값을 건드리지 않음)
                  sheet.getRange(r + 1, c + 1).setFormula(newF);
                  fileFixed++;
                }
              }
            }
          }
        }

        if (fileFixed > 0) totalFixed += fileFixed;
      } catch (e) {
        errors.push(fname + ": " + (e.message || e));
      }
    }
  }

  var msg =
    "✅ IMPORTRANGE ID 일괄 교체 완료\n\n" +
    "대상 허브 ID: " +
    CORRECT_HUB_ID +
    "\n" +
    "검사 파일: " +
    totalFiles +
    "개\n" +
    "교체된 수식: " +
    totalFixed +
    "건\n" +
    (errors.length > 0
      ? "\n⚠ 오류 " + errors.length + "건:\n" + errors.slice(0, 5).join("\n")
      : "");

  Logger.log(msg);
  try {
    if (ui) ui.alert(msg);
  } catch (e) {}
}

/**
 * 🔧 배포시트 헤더+수식 완전 재건 (긴급 복구용)
 * - VENDOR_MAP_SS_ID를 상품정보시트로 강제 세팅하여 매핑 정상화
 * - 6단계와 동일한 형식 (Row 2 텍스트 헤더 + Row 3 수식)
 * - 매핑에서 정확한 K1 결정 (실패 시 K1=7 기본값)
 * Apps Script 에디터에서 직접 실행하세요.
 */
function emergencyRepairAllDeploySheets() {
  var CORRECT_HUB_ID = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";
  var PRODUCT_INFO_SS_ID = "1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE";
  var props = PropertiesService.getScriptProperties();

  // ── 핵심: 프로퍼티 교정 ──
  props.setProperty("DB_HUB_ID", CORRECT_HUB_ID);
  props.setProperty("VENDOR_MAP_SS_ID", PRODUCT_INFO_SS_ID);
  props.deleteProperty("VENDOR_UPDATE_CURSOR_INDEX");

  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var errors = [];

  // 매핑 직접 로드 — loadVendorCustCdMap_ 우회, 상품정보시트에서 직접 읽음
  var custMapBundle = {
    byVendor: {},
    byVendorNorm: {},
    byDeployNameNorm: {},
    byFileId: {},
    byCustCd: {},
  };
  try {
    var mapSS = SpreadsheetApp.openById(PRODUCT_INFO_SS_ID);
    var mapSheet = mapSS.getSheetByName("업체등급단가매핑");
    if (mapSheet && mapSheet.getLastRow() >= 2) {
      var mapData = mapSheet.getDataRange().getValues();
      var mh = mapData[0];
      var vi = 0,
        ci = 1,
        gi = 2,
        fi = 3,
        dni = 4;
      for (var mi = 0; mi < mh.length; mi++) {
        var mhn = String(mh[mi] || "").replace(/\s/g, "");
        if (mhn.indexOf("거래처명") !== -1 || mhn.indexOf("업체명") !== -1)
          vi = mi;
        if (mhn.indexOf("CUST_CD") !== -1 || mhn.indexOf("거래처코드") !== -1)
          ci = mi;
        if (mhn.indexOf("단가그룹") !== -1) gi = mi;
        if (mhn.indexOf("배포시트ID") !== -1) fi = mi;
        if (mhn.indexOf("배포시트명") !== -1) dni = mi;
      }
      for (var mr = 1; mr < mapData.length; mr++) {
        var vn = String(mapData[mr][vi] || "").trim();
        var cc = String(mapData[mr][ci] || "").trim();
        var gn = String(mapData[mr][gi] || "").trim();
        var fid = String(mapData[mr][fi] || "").trim();
        var dn = String(mapData[mr][dni] || "").trim();
        if (!vn && !fid) continue;
        var obj = { vendor: vn, custCd: cc, groupName: gn, fileId: fid };
        if (vn) custMapBundle.byVendor[vn] = obj;
        if (vn) custMapBundle.byVendorNorm[normalizeVendorKeyForMap_(vn)] = obj;
        if (dn)
          custMapBundle.byDeployNameNorm[normalizeVendorKeyForMap_(dn)] = obj;
        if (fid) custMapBundle.byFileId[fid] = obj;
        if (cc) custMapBundle.byCustCd[cc] = obj;
      }
    } else {
      errors.push("매핑시트 없거나 비어있음");
    }
  } catch (e) {
    errors.push("매핑로드실패: " + e.message);
  }
  var mapKeys = [];
  for (var k in custMapBundle.byFileId)
    mapKeys.push(
      custMapBundle.byFileId[k].vendor +
        "→" +
        custMapBundle.byFileId[k].groupName,
    );
  Logger.log("[매핑] " + mapKeys.length + "건: " + mapKeys.join(", "));

  // 허브 그룹맵
  var hubGroupColumnMap = {};
  try {
    var hubSS = getHubSS(CORRECT_HUB_ID);
    var hubSheetForGroups = hubSS.getSheetByName("전체 그룹 단가표");
    if (hubSheetForGroups) {
      var hubHeaders1 = hubSheetForGroups
        .getRange(1, 1, 1, hubSheetForGroups.getLastColumn())
        .getValues()[0];
      hubGroupColumnMap = buildHubGroupColumnMap_(hubHeaders1);
    }
  } catch (e) {
    errors.push("허브 그룹맵 실패: " + e.message);
  }
  var groupKeys = [];
  for (var gk in hubGroupColumnMap)
    groupKeys.push(gk + "=" + hubGroupColumnMap[gk]);
  Logger.log(
    "[그룹맵] " + (groupKeys.length > 0 ? groupKeys.join(", ") : "비어있음"),
  );

  var deployFiles = listDeployFilesSorted_();
  var repaired = 0;
  var totalFiles = deployFiles.length;

  for (var fIdx = 0; fIdx < deployFiles.length; fIdx++) {
    var file = deployFiles[fIdx];
    var fname = file.name;
    try {
      var ss = SpreadsheetApp.openById(file.id);
      var sheet =
        typeof findViewerSheet_ === "function" ? findViewerSheet_(ss) : null;
      if (!sheet) sheet = ss.getSheetByName("단가조회");
      if (!sheet) {
        errors.push(fname + ": 뷰어탭 없음");
        continue;
      }

      // ── K1 결정 (3단계) ──
      var K1 = null;
      // 1) K2 셀
      try {
        var k2V = sheet.getRange("K2").getValue();
        if (k2V) K1 = parseInt(k2V, 10);
      } catch (e) {}
      // 2) G3/G2 수식
      if (!K1 || isNaN(K1)) {
        try {
          var gF =
            sheet.getRange("G3").getFormula() ||
            sheet.getRange("G2").getFormula() ||
            "";
          var m = gF.match(/ADDRESS\(1,\s*([0-9]+),\s*4\)/);
          if (m && m[1]) K1 = parseInt(m[1], 10);
        } catch (e) {}
      }
      // 3) 매핑 → 그룹코드 → hubGroupColumnMap
      if (!K1 || isNaN(K1)) {
        var nv = normalizeVendorNameFromDeployFile_(fname);
        var nvk = normalizeVendorKeyForMap_(fname);
        var cust = "";
        try {
          cust = String(sheet.getRange("AB1").getValue() || "").trim();
        } catch (e) {}
        var mr =
          (cust ? custMapBundle.byCustCd[cust] : null) ||
          custMapBundle.byFileId[file.id] ||
          custMapBundle.byVendor[nv] ||
          custMapBundle.byVendorNorm[nvk] ||
          custMapBundle.byDeployNameNorm[nvk];
        var mg = String((mr && mr.groupName) || "").trim();
        var exEn =
          String((mr && mr.exceptionEnabled) || "N").toUpperCase() === "Y";
        var exGr = String((mr && mr.exceptionGroup) || "").trim();
        var eg = exEn && exGr ? exGr : mg;
        if (eg && hubGroupColumnMap[eg]) K1 = hubGroupColumnMap[eg];
        if (!K1 || isNaN(K1)) {
          K1 = 7;
          errors.push(
            fname +
              ": K2=" +
              K1 +
              "(기본값) vendor=[" +
              nv +
              "] group=[" +
              eg +
              "] matched=" +
              !!mr,
          );
        }
      }

      var isConsumer = fname.indexOf("(소비자용)") !== -1;
      var codeHeader = isConsumer ? "이카운트코드(입력👇)" : "이카운트코드";
      var hubLink = 'IMPORTRANGE("' + CORRECT_HUB_ID + '", "전체 그룹 단가표!';
      var ids = 'IMPORTRANGE("' + CORRECT_HUB_ID + '", "전체 그룹 단가표!C:C")';
      var gRange =
        'SUBSTITUTE(ADDRESS(1, K2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2, 4), "1", "")';
      var iRange =
        'SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "")';

      // ── 1) Row 1: 공지행 ──
      ensureNoticeRowLinked_(sheet, CORRECT_HUB_ID);

      // ── 2) Row 2: 텍스트 헤더 (6단계와 동일 형식) ──
      try {
        sheet.getRange("A2:Z2").breakApart();
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
      try {
        var customTitleForm = buildDeployTitleFormula_(CORRECT_HUB_ID);
        sheet.getRange("J2").setFormula(customTitleForm);
      } catch (e) {}
      sheet
        .getRange("A2:J2")
        .setBackground("#cfe2f3")
        .setFontColor("#000000")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
      if (isConsumer) sheet.getRange("C2").setBackground("#fff2cc");
      sheet.setFrozenRows(2);
      sheet.getRange("K2").setValue(K1).setFontColor("white");

      // ── 3) Row 3 이하: 수식열 클리어 (ARRAYFORMULA 스필 공간 확보) ──
      var lastRow = Math.max(sheet.getLastRow(), 3);
      if (lastRow >= 3) {
        try {
          sheet.getRange(3, 1, lastRow - 2, 2).clearContent();
        } catch (e) {} // A~B
        try {
          sheet.getRange(3, 4, lastRow - 2, 6).clearContent();
        } catch (e) {} // D~I
        if (!isConsumer) {
          try {
            sheet.getRange(3, 3, lastRow - 2, 1).clearContent();
          } catch (e) {} // C (비소비자만)
        }
      }

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
      if (!isConsumer) {
        sheet
          .getRange("C3")
          .setFormula(
            '=IMPORTRANGE("' + CORRECT_HUB_ID + '", "전체 그룹 단가표!C3:C")',
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

      if (isConsumer) {
        var dcRate = parseConsumerDiscountRateFromName_(fname);
        var dcMul = (100 - dcRate) / 100;
        sheet
          .getRange("G3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(F3:F="-", "-", ROUNDUP(F3:F*' +
              dcMul +
              ', -2)), "-")))',
          );
      } else {
        sheet
          .getRange("G3")
          .setFormula(
            '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
              ids +
              ', IMPORTRANGE("' +
              CORRECT_HUB_ID +
              '", "전체 그룹 단가표!" & ' +
              gRange +
              ')), "-")))',
          );
      }
      sheet
        .getRange("H3")
        .setFormula(
          '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(G3:G="-", "-", IF(I3:I="-", "-", G3:G-I3:I)), "-")))',
        );
      sheet
        .getRange("I3")
        .setFormula(
          '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
            ids +
            ', IMPORTRANGE("' +
            CORRECT_HUB_ID +
            '", "전체 그룹 단가표!" & ' +
            iRange +
            ')), "-")))',
        );

      // ── 4) AA/AB 매핑 ──
      try {
        applyViewerIdentityFormulaFromHubMap_(sheet, CORRECT_HUB_ID, file.id);
      } catch (e) {}

      // ── 5) Row 2~3 보호 + Row 3 숨김 ──
      try {
        var protection = sheet
          .getRange("A2:K3")
          .protect()
          .setDescription("헤더+수식 보호 (삭제금지)");
        protection.removeEditors(protection.getEditors());
        if (protection.canDomainEdit()) protection.setDomainEdit(false);
      } catch (e) {}
      try {
        sheet.hideRows(3);
      } catch (e) {}

      repaired++;
    } catch (e) {
      errors.push(fname + ": " + (e.message || e));
    }
  }

  var msg =
    "✅ 긴급 복구 완료\n\n" +
    "검사 파일: " +
    totalFiles +
    "개\n" +
    "복구 완료: " +
    repaired +
    "개\n" +
    (errors.length > 0
      ? "\n⚠ " + errors.length + "건:\n" + errors.slice(0, 12).join("\n")
      : "");
  Logger.log(msg);
  try {
    if (ui) ui.alert(msg);
  } catch (e) {}
}
/**
 * 현재 저장된 허브 ID 확인용
 */
function showCurrentHubId() {
  var props = PropertiesService.getScriptProperties();
  var hubId = props.getProperty("DB_HUB_ID") || "(없음)";
  var msg = "현재 DB_HUB_ID: " + hubId;
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {}
}

/**
 * 발주 수집 0건 원인 진단.
 * Apps Script에서 직접 실행 → 로그에 상세 결과 출력.
 */
function diagnoseOrderCollection() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  var report = [];
  report.push("=== 발주 수집 진단 시작 ===");
  report.push("시각: " + new Date().toLocaleString());

  // 1. 통합 발주 DB 확인
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubTab = ss.getSheetByName("통합 발주 DB");
  if (!hubTab) {
    report.push("❌ '통합 발주 DB' 탭 없음 (자동 생성됨)");
  } else {
    var hubLr = hubTab.getLastRow();
    report.push("✅ 통합 발주 DB: " + (hubLr - 1) + "건 기록됨");
  }

  // 2. 배포 시트 파일 목록
  var folderIds = [
    "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl",
    "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v",
  ];
  var totalFiles = 0;
  var deployFiles = [];

  for (var fi = 0; fi < folderIds.length; fi++) {
    try {
      var folder = DriveApp.getFolderById(folderIds[fi]);
      var files = folder.getFiles();
      while (files.hasNext()) {
        var file = files.next();
        var fname = file.getName();
        if (
          fname.indexOf("독립 배포") !== -1 ||
          fname.indexOf("독립배포") !== -1
        ) {
          totalFiles++;
          deployFiles.push(file);
        }
      }
    } catch (e) {
      report.push("⚠ 폴더 " + folderIds[fi] + " 접근 실패: " + e.message);
    }
  }
  report.push("\n📁 배포 시트 파일: " + totalFiles + "개 발견");

  // 3. 각 배포 시트의 발주 탭 상태 점검 (최대 5개만)
  var checkCount = Math.min(deployFiles.length, 5);
  for (var di = 0; di < checkCount; di++) {
    var dFile = deployFiles[di];
    report.push("\n── [" + dFile.getName() + "] ──");
    try {
      var dss = SpreadsheetApp.openById(dFile.getId());
      var allTabs = dss.getSheets();
      var tabNames = [];
      for (var ti = 0; ti < allTabs.length; ti++) {
        tabNames.push(allTabs[ti].getName());
      }
      report.push("  탭 목록: " + tabNames.join(", "));

      // 발주 탭 찾기
      for (var ti = 0; ti < allTabs.length; ti++) {
        var tName = allTabs[ti].getName();
        if (
          tName.indexOf("단가조회") !== -1 ||
          tName.indexOf("뷰어") !== -1 ||
          tName.indexOf("마감") !== -1 ||
          tName.indexOf("설정") !== -1
        )
          continue;

        var tab = allTabs[ti];
        var lr = tab.getLastRow();
        var lc = tab.getMaxColumns();
        if (lr <= 1) {
          report.push("  [" + tName + "] 데이터 없음 (행=" + lr + ")");
          continue;
        }

        var headers = tab.getRange(1, 1, 1, Math.min(lc, 20)).getValues()[0];
        var headerStr = [];
        for (var hi = 0; hi < headers.length; hi++) {
          var hv = String(headers[hi] || "").trim();
          if (hv) headerStr.push(String.fromCharCode(65 + hi) + "=" + hv);
        }
        report.push(
          "  [" + tName + "] 행=" + lr + " 헤더: " + headerStr.join(" | "),
        );

        // buildOrderTabColumnMap_ 시뮬레이션 — 핵심 필드만 확인
        var hasDate = false,
          hasCode = false;
        for (var hi = 0; hi < headers.length; hi++) {
          var h = String(headers[hi] || "").replace(/\s/g, "");
          if (h.indexOf("주문일자") !== -1 || h.indexOf("일자") !== -1)
            hasDate = true;
          if (
            h.indexOf("품목코드") !== -1 ||
            h.indexOf("이카운트코드") !== -1 ||
            h.indexOf("상품코드") !== -1 ||
            h.indexOf("검색창") !== -1
          )
            hasCode = true;
        }
        if (!hasDate)
          report.push("    ⚠ 주문일자 헤더 못 찾음 → 이 탭 스킵됨!");
        if (!hasCode)
          report.push("    ⚠ 품목코드 헤더 못 찾음 → 이 탭 스킵됨!");

        // 데이터 샘플 (2~4행)
        if (lr >= 2) {
          var sample = tab
            .getRange(2, 1, Math.min(3, lr - 1), Math.min(lc, 13))
            .getValues();
          for (var si = 0; si < sample.length; si++) {
            var row = sample[si];
            var vals = [];
            for (var ci = 0; ci < row.length; ci++) {
              var v = String(row[ci] || "").trim();
              if (v)
                vals.push(
                  String.fromCharCode(65 + ci) +
                    "=" +
                    (v.length > 15 ? v.substring(0, 15) + ".." : v),
                );
            }
            if (vals.length > 0)
              report.push("    행" + (si + 2) + ": " + vals.join(" | "));
          }
        }
      }
    } catch (e) {
      report.push("  ❌ 열기 실패: " + e.message);
    }
  }

  var fullReport = report.join("\n");
  Logger.log(fullReport);
  if (ui) {
    // alert는 길이 제한이 있으므로 축약
    var shortReport =
      fullReport.length > 2000
        ? fullReport.substring(0, 2000) + "\n\n...(나머지는 로그 확인)"
        : fullReport;
    ui.alert("발주 수집 진단 결과", shortReport, ui.ButtonSet.OK);
  }
}

/** 매핑 시트 진단 — 어디서 읽고 있는지, 그룹 데이터가 있는지 확인 */
function diagnoseMappingSheet() {
  var props = PropertiesService.getScriptProperties();
  var mapSsId = props.getProperty("VENDOR_MAP_SS_ID") || "(없음)";
  var report = [];
  report.push("VENDOR_MAP_SS_ID: " + mapSsId);

  var mapInfo = resolveVendorMapSheetForPriceManager_();
  report.push("source: " + mapInfo.source);
  report.push("sheet: " + (mapInfo.sheet ? mapInfo.sheet.getName() : "null"));
  report.push("ss: " + (mapInfo.ss ? mapInfo.ss.getName() : "null"));

  if (mapInfo.sheet) {
    var data = mapInfo.sheet.getDataRange().getValues();
    report.push("행수: " + data.length);
    report.push("헤더: " + data[0].join(" | "));
    for (var i = 1; i < Math.min(data.length, 4); i++) {
      report.push("행" + (i + 1) + ": " + data[i].slice(0, 5).join(" | "));
    }
  }

  var msg = report.join("\n");
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {}
}

/** K2 값만 수정 — 헤더/수식/보호 아무것도 안 건드림 */
function fixK2Only() {
  var HUB_ID = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";
  var MAP_SS_ID = "1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE";

  // 1) 매핑시트 직접 읽기 → fileId → groupName
  var groupByFileId = {};
  try {
    var ms =
      SpreadsheetApp.openById(MAP_SS_ID).getSheetByName("업체등급단가매핑");
    var d = ms.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      var fid = String(d[i][3] || "").trim(); // 배포시트ID (D열)
      var grp = String(d[i][2] || "").trim(); // 단가그룹 (C열)
      if (fid && grp) groupByFileId[fid] = grp;
    }
  } catch (e) {
    Logger.log("매핑읽기실패: " + e);
    return;
  }
  Logger.log("매핑: " + Object.keys(groupByFileId).length + "건");

  // 2) 허브 그룹 → 열번호
  var hubGroupCol = {};
  try {
    var hss =
      SpreadsheetApp.openById(HUB_ID).getSheetByName("전체 그룹 단가표");
    var hh = hss.getRange(1, 1, 1, hss.getLastColumn()).getValues()[0];
    hubGroupCol = buildHubGroupColumnMap_(hh);
  } catch (e) {
    Logger.log("허브읽기실패: " + e);
    return;
  }
  Logger.log("그룹맵: " + JSON.stringify(hubGroupCol));

  // 3) 배포시트 순회 → K2만 수정
  var files = listDeployFilesSorted_();
  var results = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var grp = groupByFileId[f.id] || "";
    var col = grp ? hubGroupCol[grp] : null;
    var oldK2 = "";
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var sh =
        typeof findViewerSheet_ === "function"
          ? findViewerSheet_(ss)
          : ss.getSheetByName("단가조회");
      if (!sh) {
        results.push(f.name + ": 뷰어없음");
        continue;
      }
      oldK2 = sh.getRange("K2").getValue();
      if (col && col !== oldK2) {
        sh.getRange("K2").setValue(col).setFontColor("white");
        results.push(f.name + ": " + oldK2 + "→" + col + " (" + grp + ")");
      } else if (!col) {
        results.push(
          f.name + ": 매핑없음 (fileId=" + f.id.substring(0, 8) + ")",
        );
      } else {
        results.push(f.name + ": 이미정확 (" + col + ")");
      }
    } catch (e) {
      results.push(f.name + ": 에러 " + e.message);
    }
  }
  var msg = "K2 수정 결과:\n" + results.join("\n");
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {}
}
