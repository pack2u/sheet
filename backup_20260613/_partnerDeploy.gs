/**
 * ┌──────────────────────────────────────────┐
 * │  [협력업체] 배포 시스템  v1.0             │
 * │  파일: _partnerDeploy.gs                 │
 * │  기존 시스템 무관. 삭제 시 완전 분리.      │
 * └──────────────────────────────────────────┘
 *
 * 매핑시트 없음 — K2에 그룹 열 번호 저장, 그게 끝.
 * 6단계(priceManager.gs L2379~2475) 수식과 100% 동일.
 */

// ═══════════════════════════════════════════
//  상수 (기존 코드와 이름 충돌 없음)
// ═══════════════════════════════════════════
var _PT = {
  HUB_ID: "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk",
  INFO_SS_ID: "1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE",
  FOLDER_ID: "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl",
  FOLDER_ID2: "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v",
  TEMPLATE_ID: "1ZT9hqXXOSuSYRS6gYaJUhvVpTHDql6HokqExJdPcbiA",
  PREFIX: "[협력업체] ",
};

// ═══════════════════════════════════════════
//  유틸: 허브 그룹 목록 읽기
// ═══════════════════════════════════════════
function _pt_getHubGroups() {
  var hubSS = _pt_getHubSS(_PT.HUB_ID);
  var tab = hubSS.getSheetByName("전체 그룹 단가표");
  if (!tab) throw new Error("허브에 '전체 그룹 단가표' 탭 없음");
  var h = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0];
  var groups = _pt_buildHubGroupColumnMap(h); // {groupCode: col1based, ...}

  // ★ 가상 소비자가 할인 그룹 추가 (HUB 열 불필요, K2에 NNN 저장)
  // 예: 444 → K2=444 → 소비자가 4% 할인, 555 → 5% 할인 ...
  var virtualRates = [4, 5, 6, 7, 8, 9];
  for (var vi = 0; vi < virtualRates.length; vi++) {
    var r = virtualRates[vi];
    var key = String(r) + String(r) + String(r); // "444", "555" ...
    if (!groups[key]) groups[key] = parseInt(key, 10); // K2 = 444, 555 ...
  }
  return groups;
}

// ═══════════════════════════════════════════
//  유틸: [협력업체] 파일 목록
//  실행범위 캐시: 동일 실행 컨텍스트 내 Drive API 중복 호출 방지
// ═══════════════════════════════════════════
var _PT_FILES_CACHE_ = null; // 실행범위 캐시 (GAS 실행 종료 시 자동 소멸)

function _pt_listFiles(opt_forceRefresh) {
  if (!opt_forceRefresh && _PT_FILES_CACHE_) return _PT_FILES_CACHE_;
  var ids = [_PT.FOLDER_ID, _PT.FOLDER_ID2];
  var PREFIX_UNDERSCORE = "[협력업체]_"; // 언더스코어 변형도 인식
  var seen = {};
  var out = [];
  for (var fi = 0; fi < ids.length; fi++) {
    var fid = String(ids[fi] || "").trim();
    if (!fid || seen["F:" + fid]) continue;
    seen["F:" + fid] = true;
    try {
      var folder = DriveApp.getFolderById(fid);
      var files = folder.getFiles();
      while (files.hasNext()) {
        var f = files.next();
        var nm = f.getName();
        // "[협력업체] " 또는 "[협력업체]_" 모두 인식
        if (
          nm.indexOf(_PT.PREFIX) === -1 &&
          nm.indexOf(PREFIX_UNDERSCORE) === -1
        )
          continue;
        var id = f.getId();
        if (seen[id]) continue;
        seen[id] = true;
        // "[협력업체]_" → "[협력업체] " 로 정규화 (일관성 유지)
        var normalizedName = nm.replace(PREFIX_UNDERSCORE, _PT.PREFIX);
        out.push({ id: id, name: normalizedName });
      }
    } catch (e) {}
  }
  out.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  _PT_FILES_CACHE_ = out;
  return out;
}

// ═══════════════════════════════════════════
//  유틸: Row 3 수식 적용 (6단계 정본 복사)
// ═══════════════════════════════════════════
function _pt_applyRow3Formulas(sheet, hubId, isConsumer, dcMul) {
  var hubLink = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!';
  var ids = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!C:C")';

  // A3: 상태
  sheet
    .getRange("A3")
    .setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
        ids +
        ", " +
        hubLink +
        'A:A")), "-")))',
    );
  // B3: 출고지
  sheet
    .getRange("B3")
    .setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
        ids +
        ", " +
        hubLink +
        'B:B")), "-")))',
    );
  // C3: 이카운트코드 (수동 모드 전용 — 사용자가 직접 입력/삭제, 수식 미개입)
  // D3: 품목명
  sheet
    .getRange("D3")
    .setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
        ids +
        ", " +
        hubLink +
        'D:D")), "-")))',
    );
  // E3: 재고
  sheet
    .getRange("E3")
    .setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
        ids +
        ", " +
        hubLink +
        'E:E")), "-")))',
    );
  // F3: 소비자가
  sheet
    .getRange("F3")
    .setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
        ids +
        ", " +
        hubLink +
        'F:F")), "-")))',
    );

  // G3: 최종단가 (K2 동적 참조)
  var gRange =
    'SUBSTITUTE(ADDRESS(1, K2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2, 4), "1", "")';
  if (isConsumer) {
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
          hubId +
          '", "전체 그룹 단가표!" & ' +
          gRange +
          ')), "-")))',
      );
  }

  // I3: 지난단가 (K2+2)
  var iRange =
    'SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "")';
  sheet
    .getRange("I3")
    .setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' +
        ids +
        ', IMPORTRANGE("' +
        hubId +
        '", "전체 그룹 단가표!" & ' +
        iRange +
        ')), "-")))',
    );

  // H3: 단가변동 ← 6단계 정본: G=I면 "-"
  sheet
    .getRange("H3")
    .setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(G3:G=I3:I, "-", G3:G-I3:I), "-")))',
    );

  // J3: 익월변동단가 (K2+4) ← 6단계 정본
  var jRange =
    'SUBSTITUTE(ADDRESS(1, K2+4, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2+4, 4), "1", "")';
  sheet
    .getRange("J3")
    .setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", LET(nxt, IFNA(XLOOKUP(C3:C, ' +
        ids +
        ', IMPORTRANGE("' +
        hubId +
        '", "전체 그룹 단가표!" & ' +
        jRange +
        ')), "-"), IF((nxt="-")+(nxt="")+(nxt=G3:G), "-", nxt))))',
    );
}

// ═══════════════════════════════════════════
//  유틸: ARRAYFORMULA 스필 공간 확보
// ═══════════════════════════════════════════
function _pt_clearSpillArea(sheet, isConsumer) {
  var lr = Math.max(sheet.getLastRow(), 4);
  if (lr < 4) return;
  var rows = lr - 3;
  try {
    sheet.getRange(4, 1, rows, 2).clearContent();
  } catch (e) {} // A~B
  try {
    sheet.getRange(4, 4, rows, 7).clearContent();
  } catch (e) {} // D~J
  // C열(이카운트코드)은 수동 입력값이므로 절대 클리어하지 않음
}

// ═══════════════════════════════════════════
//  유틸: Row 2~3 보호(경고) + Row 3 숨김
//  ★ warningOnly: 필터 사용 가능 + 실수 방지 경고
// ═══════════════════════════════════════════
function _pt_protectAndHide(sheet) {
  try {
    // 기존 강제 보호 제거 (이전 버전 호환)
    var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    for (var i = 0; i < existing.length; i++) {
      var desc = String(existing[i].getDescription() || "");
      if (desc === "협력업체_헤더보호") existing[i].remove();
    }
    // 경고만 보호 재적용
    var p = sheet
      .getRange("A2:K3")
      .protect()
      .setDescription("협력업체_헤더보호");
    p.setWarningOnly(true);
  } catch (e) {}
  try {
    sheet.hideRows(3);
  } catch (e) {}
}

// ═══════════════════════════════════════════
//  유틸: Row 2 헤더 + 스타일 적용
// ═══════════════════════════════════════════
function _pt_applyRow2(sheet, hubId, isConsumer, K2) {
  var codeHeader = isConsumer ? "이카운트코드(입력👇)" : "이카운트코드";
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
    sheet.getRange("J2").setFormula(_pt_buildDeployTitleFormula(hubId));
  } catch (e) {}
  sheet
    .getRange("A2:J2")
    .setBackground("#cfe2f3")
    .setFontColor("#000000")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  if (isConsumer) sheet.getRange("C2").setBackground("#fff2cc");
  sheet.setFrozenRows(2);
  sheet.getRange("K2").setValue(K2).setFontColor("white");
}

// ═══════════════════════════════════════════
//  유틸: 디자인 포맷
// ═══════════════════════════════════════════
function _pt_applyDesign(sheet) {
  sheet.getRange("E3:J5000").setNumberFormat("#,##0");
  sheet.getRange("G3:H5000").setFontColor("red");
  sheet.getRange("I3:I5000").setFontColor("#666666");
  sheet.getRange("J3:J5000").setFontColor("blue");

  // 단가조회(뷰어) 탭 상태값 조건부 서식 복구
  sheet.clearConditionalFormatRules();
  var vRange = sheet.getRange("A3:J5000");
  var rules = [];
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=ISNUMBER(SEARCH("품절", $A3))')
      .setBackground("#f4cccc")
      .setRanges([vRange])
      .build(),
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=ISNUMBER(SEARCH("단종", $A3))')
      .setBackground("#d9d9d9")
      .setRanges([vRange])
      .build(),
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=ISNUMBER(SEARCH("재고까지만", $A3))')
      .setBackground("#ffe599")
      .setRanges([vRange])
      .build(),
  );
  sheet.setConditionalFormatRules(rules);
}

// ═══════════════════════════════════════════
//  유틸: 발주탭/전용양식탭 상태별 조건부서식
//  J열(적요) + N열(상태(자동)) 기준: 품절(핑크), 단종(회색), 재고까지만(노랑)
// ═══════════════════════════════════════════
function _pt_applyOrderTabDesign(tab) {
  try {
    var oRange = tab.getRange("A2:N250");
    var rules = [];
    // 1) 송장번호 입력 (K열이 비어있지 않고 "-"가 아님) → 연두색
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($K2<>"", $K2<>"-")')
        .setBackground("#d9ead3")
        .setRanges([oRange])
        .build(),
    );
    // 2) 발송완료 (N열 상태) → 연두색
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("발송완료", $N2))')
        .setBackground("#d9ead3")
        .setRanges([oRange])
        .build(),
    );
    // 3) 접수완료 (N열 상태) → 하늘색
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("접수완료", $N2))')
        .setBackground("#cfe2f3")
        .setRanges([oRange])
        .build(),
    );
    // 4) 품절/품절임박 경고 (J열 적요 OR N열 상태) → 연핑크
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=OR(ISNUMBER(SEARCH("품절", $J2)), ISNUMBER(SEARCH("품절임박", $J2)), ISNUMBER(SEARCH("품절", $N2)))')
        .setBackground("#f4cccc")
        .setRanges([oRange])
        .build(),
    );
    // 5) 단종 경고 (J열 적요 OR N열 상태) → 회색
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=OR(ISNUMBER(SEARCH("단종", $J2)), ISNUMBER(SEARCH("단종", $N2)))')
        .setBackground("#d9d9d9")
        .setRanges([oRange])
        .build(),
    );
    // 6) 재고까지만 경고 (J열 적요 OR N열 상태) → 노랑
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=OR(ISNUMBER(SEARCH("재고까지만", $J2)), ISNUMBER(SEARCH("재고까지만", $N2)))')
        .setBackground("#ffe599")
        .setRanges([oRange])
        .build(),
    );
    // 7) 🏝️ 도서산간 의심 주소 (H열 수취인주소) → 글씨색 진한 자홍색2
    var hRange = tab.getRange("H2:H250");
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(
          '=REGEXMATCH($H2,"제주|서귀포|울릉|옹진|신안' +
          '|백령|연평|덕적|자월|흑산|비금|도초|추자|우도|무의' +
          '|거문|청산|보길|소안|조도' +
          '|욕지|사량|한산|위도|낙월|가파|마라|금오|거금|노화")'
        )
        .setFontColor("#a64d79")
        .setBold(true)
        .setRanges([hRange])
        .build(),
    );
    tab.setConditionalFormatRules(rules);
  } catch (e) {}
}

// ═══════════════════════════════════════════
//  유틸: 공지/메타 셀 (Y1, Z1, AC1, AA1)
// ═══════════════════════════════════════════
//  ⚠ 보안 정책:
//    [협력업체] 시트는 매핑 시트를 IMPORTRANGE로 로드하지 않는다.
//    → AE~AH에 모든 업체 정보(거래처명/CUST_CD/단가그룹/파일ID)가
//      공개되는 구조적 정보 유출을 원천 차단.
//    AA1(거래처명)은 이 파일 자체의 설정탭 B5에서 직접 읽는다.
// ═══════════════════════════════════════════
function _pt_applyMetaCells(sheet, hubId, fileId) {
  if (sheet.getMaxColumns() < 29) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 29 - sheet.getMaxColumns());
  }
  sheet
    .getRange("Y1")
    .setFormula('=IFERROR(IMPORTRANGE("' + hubId + '", "설정!B1"), "")')
    .setFontColor("white");
  sheet
    .getRange("Z1")
    .setFormula('=IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!A1")')
    .setFontColor("white");
  sheet.getRange("AC1").setValue(fileId).setFontColor("white");

  // AA1: 거래처명 — 설정탭 B5에서 직접 읽기 (매핑 시트 불필요, 타 업체 정보 유출 없음)
  sheet
    .getRange("AA1")
    .setFormula("=IFERROR('설정'!B5, \"\")")
    .setFontColor("white");

  // AE~AH 열 사용 안 함 (구 applyViewerIdentityFormulaFromHubMap_ 호출 제거)
  // → IMPORTRANGE로 매핑 시트 전체를 로드하던 구조 폐기
}

// ═══════════════════════════════════════════
//  시트 생성: [협력업체] 표준
// ═══════════════════════════════════════════
function partnerCreateSheet() {
  var ui = SpreadsheetApp.getUi();
  var hubId = _PT.HUB_ID;
  var groups = _pt_getHubGroups();

  // 그룹 선택
  var groupList = [];
  for (var g in groups) groupList.push(g + " (열:" + groups[g] + ")");
  if (groupList.length === 0) return ui.alert("허브에 그룹이 없습니다.");
  var groupInput = ui.prompt(
    "단가 그룹 선택",
    "아래 그룹 중 하나를 정확히 입력하세요:\n\n" + groupList.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (groupInput.getSelectedButton() !== ui.Button.OK) return;
  var groupName = groupInput
    .getResponseText()
    .trim()
    .replace(/\s*\(열:\d+\)$/, "");
  if (!groups[groupName]) return ui.alert("존재하지 않는 그룹: " + groupName);
  var K2 = groups[groupName];

  // 업체명
  var nameInput = ui.prompt(
    "업체명",
    "파일명용 짧은 이름 입력 (예: 냅킨코리아)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (nameInput.getSelectedButton() !== ui.Button.OK) return;
  var vendorName = nameInput.getResponseText().trim();
  if (!vendorName) return;

  // ★ 중복 업체명 검사
  var fullNameToCreate = _PT.PREFIX + vendorName;
  var existingFiles = _pt_listFiles();
  for (var ci = 0; ci < existingFiles.length; ci++) {
    var exName = existingFiles[ci].name;
    if (exName === fullNameToCreate) {
      return ui.alert(
        "⚠️ 중복 파일 확인",
        "이미 같은 이름의 협력업체 파일이 존재합니다.\n\n파일명: " +
          exName +
          "\n\n다른 업체명을 사용하거나, 기존 파일을 확인하세요.",
        ui.ButtonSet.OK,
      );
    }
  }

  // 전용양식
  var formatInput = ui.prompt(
    "발주 양식",
    "기본양식이면 빈칸, 맞춤양식이면 양식명 입력 (예: 태양)\n허브 '업체전용양식마스터'에 등록된 이름",
    ui.ButtonSet.OK_CANCEL,
  );
  if (formatInput.getSelectedButton() !== ui.Button.OK) return;
  var formatName = formatInput.getResponseText().trim();

  // 파일 복사
  var newFile = _pt_createTemplateCopy(
    _PT.TEMPLATE_ID,
    _PT.PREFIX + vendorName,
  );
  var fileId = newFile.getId();
  var ss = SpreadsheetApp.openById(fileId);
  var sheet = ss.getSheets()[0];
  sheet.setName(vendorName + " 뷰어");

  // 설정 탭 (업체명만, 그룹 안 넣음)
  try {
    _pt_ensureLocalSettingsTab(ss, vendorName, "");
  } catch (e) {}

  // Row 1: 공지
  _pt_ensureNoticeRowLinked(sheet, hubId);
  // Row 2: 헤더
  _pt_applyRow2(sheet, hubId, false, K2);
  // 스필 공간 확보
  _pt_clearSpillArea(sheet, false);
  // Row 3: 수식
  _pt_applyRow3Formulas(sheet, hubId, false, 1);
  // 디자인
  _pt_applyDesign(sheet);
  // 메타
  _pt_applyMetaCells(sheet, hubId, fileId);
  // 보호+숨김
  _pt_protectAndHide(sheet);

  // 발주 탭 생성
  _pt_createOrderTab(ss, vendorName, formatName, sheet.getName());

  // ★ 검색입력 탭 자동 생성 (품목 드롭다운 포함)
  try { _pt_createSearchInputTab_(ss); } catch (eSI) {}

  // 전용양식 탭 자동 생성 (_PEP_EXCLUSIVE_FORM_HEADERS_ 매핑 있는 업체만)
  try {
    var pfxForForm = null;
    var masterRows =
      typeof _PEP_EXCLUSIVE_FORM_HEADERS_ !== "undefined"
        ? _PEP_EXCLUSIVE_FORM_HEADERS_
        : [];
    for (var mi = 0; mi < masterRows.length; mi++) {
      if (
        masterRows[mi].label &&
        vendorName.indexOf(masterRows[mi].label) !== -1
      ) {
        pfxForForm = masterRows[mi].prefix;
        break;
      }
    }
    if (pfxForForm && typeof _pep_createExclusiveFormTab_ === "function") {
      _pep_createExclusiveFormTab_(ss, pfxForForm);
    }
  } catch (eF) {}

  ui.alert(
    "✅ " +
      _PT.PREFIX +
      vendorName +
      " 생성 완료\n그룹: " +
      groupName +
      " (K2=" +
      K2 +
      ")",
  );
}

// ═══════════════════════════════════════════
//  시트 생성: [협력업체] 단가조회 전용 (발주/검색입력 없음)
// ═══════════════════════════════════════════
function partnerCreateViewerOnlySheet() {
  var ui = SpreadsheetApp.getUi();
  var hubId = _PT.HUB_ID;
  var groups = _pt_getHubGroups();

  // 그룹 선택
  var groupList = [];
  for (var g in groups) groupList.push(g + " (열:" + groups[g] + ")");
  if (groupList.length === 0) return ui.alert("허브에 그룹이 없습니다.");
  var groupInput = ui.prompt(
    "단가 그룹 선택",
    "아래 그룹 중 하나를 정확히 입력하세요:\n\n" + groupList.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (groupInput.getSelectedButton() !== ui.Button.OK) return;
  var groupName = groupInput
    .getResponseText()
    .trim()
    .replace(/\s*\(열:\d+\)$/, "");
  if (!groups[groupName]) return ui.alert("존재하지 않는 그룹: " + groupName);
  var K2 = groups[groupName];

  // 업체명
  var nameInput = ui.prompt(
    "업체명",
    "파일명용 짧은 이름 입력 (예: 냅킨코리아)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (nameInput.getSelectedButton() !== ui.Button.OK) return;
  var vendorName = nameInput.getResponseText().trim();
  if (!vendorName) return;

  // 중복 업체명 검사
  var fullNameToCreate = _PT.PREFIX + vendorName;
  var existingFiles = _pt_listFiles();
  for (var ci = 0; ci < existingFiles.length; ci++) {
    if (existingFiles[ci].name === fullNameToCreate) {
      return ui.alert(
        "⚠️ 중복 파일 확인",
        "이미 같은 이름의 협력업체 파일이 존재합니다.\n\n파일명: " +
          existingFiles[ci].name +
          "\n\n다른 업체명을 사용하거나, 기존 파일을 확인하세요.",
        ui.ButtonSet.OK,
      );
    }
  }

  // 파일 복사
  var newFile = _pt_createTemplateCopy(
    _PT.TEMPLATE_ID,
    _PT.PREFIX + vendorName,
  );
  var fileId = newFile.getId();
  var ss = SpreadsheetApp.openById(fileId);
  var sheet = ss.getSheets()[0];
  sheet.setName(vendorName + " 뷰어");

  // 설정 탭
  try {
    _pt_ensureLocalSettingsTab(ss, vendorName, "");
  } catch (e) {}

  // Row 1: 공지
  _pt_ensureNoticeRowLinked(sheet, hubId);
  // Row 2: 헤더
  _pt_applyRow2(sheet, hubId, false, K2);
  // 스필 공간 확보
  _pt_clearSpillArea(sheet, false);
  // Row 3: 수식
  _pt_applyRow3Formulas(sheet, hubId, false, 1);
  // 디자인
  _pt_applyDesign(sheet);
  // 메타
  _pt_applyMetaCells(sheet, hubId, fileId);
  // 보호+숨김
  _pt_protectAndHide(sheet);

  // ★ 발주탭·전용양식·검색입력 생성 안 함 (단가조회 전용)

  ui.alert(
    "✅ " +
      _PT.PREFIX +
      vendorName +
      " (단가조회 전용) 생성 완료\n" +
      "그룹: " +
      groupName +
      " (K2=" +
      K2 +
      ")\n\n" +
      "이 시트는 단가조회만 가능하며,\n발주/검색입력/검색발주 탭이 없습니다.",
  );
}

// ═══════════════════════════════════════════
//  시트 생성: [협력업체] 소비자용
// ═══════════════════════════════════════════
function partnerCreateConsumerSheet() {
  var ui = SpreadsheetApp.getUi();
  var hubId = _PT.HUB_ID;

  var nameInput = ui.prompt(
    "업체명",
    "파일명용 짧은 이름",
    ui.ButtonSet.OK_CANCEL,
  );
  if (nameInput.getSelectedButton() !== ui.Button.OK) return;
  var vendorName = nameInput.getResponseText().trim();
  if (!vendorName) return;

  var dcInput = ui.prompt(
    "할인율",
    "할인율(%) 입력 (예: 7.5)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (dcInput.getSelectedButton() !== ui.Button.OK) return;
  var dcRate = _pt_normalizeDcRateNumber(
    parseFloat(dcInput.getResponseText()),
    5,
  );
  var dcMul = (100 - dcRate) / 100;

  // ★ 중복 업체명 검사 (파일명은 DC율이 다르면 다른 파일이므로 업체명만 비교)
  var fullNameToCreate =
    _PT.PREFIX + vendorName + " (소비자용) " + dcRate + "%DC";
  var existingFiles = _pt_listFiles();
  for (var ci = 0; ci < existingFiles.length; ci++) {
    if (existingFiles[ci].name === fullNameToCreate) {
      return ui.alert(
        "⚠️ 중복 파일 확인",
        "이미 같은 이름의 파일이 존재합니다.\n\n파일명: " +
          fullNameToCreate +
          "\n\n다른 업체명 또는 DC율을 사용하세요.",
      );
    }
  }

  var fullName = _PT.PREFIX + vendorName + " (소비자용) " + dcRate + "%DC";
  var newFile = _pt_createTemplateCopy(_PT.TEMPLATE_ID, fullName);
  var fileId = newFile.getId();
  var ss = SpreadsheetApp.openById(fileId);
  var sheet = ss.getSheets()[0];
  sheet.setName(vendorName + " 뷰어");

  try {
    _pt_ensureLocalSettingsTab(ss, vendorName, "");
  } catch (e) {}

  _pt_ensureNoticeRowLinked(sheet, hubId);
  // ★ 소비자용 K2: dcRate * 111 (NNN 패턴) 저장 → 복구 시 자동 DC율 역산
  //   예: 5%→555, 7%→777, 8%→888 (_pt_getConsumerRateFromK2 로 역산 가능)
  var consumerK2 = Math.round(dcRate) * 111;
  _pt_applyRow2(sheet, hubId, true, consumerK2);
  _pt_clearSpillArea(sheet, true);
  _pt_applyRow3Formulas(sheet, hubId, true, dcMul);
  _pt_applyDesign(sheet);
  _pt_applyMetaCells(sheet, hubId, fileId);
  _pt_protectAndHide(sheet);
  _pt_createOrderTab(ss, vendorName, "", sheet.getName());

  ui.alert("✅ " + fullName + " 생성 완료 (DC " + dcRate + "%)");
}

// ═══════════════════════════════════════════
//  발주 탭 생성
// ═══════════════════════════════════════════
function _pt_createOrderTab(
  ss,
  vendorName,
  formatName,
  viewerTabName,
  exclusiveHeaders,
  exclusiveTabName,
) {
  var defaultHeaders = [
    "거래처명(자동)",
    "주문일자(자동)",
    "이카운트코드",
    "품목명",
    "수량",
    "수취인",
    "수취인전화번호",
    "수취인주소",
    "배송메시지",
    "적요",
    "송장번호",
    "정산금액(자동)",
    "고유ID(자동)",
    "상태(자동)",
  ];

  // ★ 발주 및 송장조회 탭은 항상 표준 헤더 고정
  var orderTabHeaders = defaultHeaders;

  // ★ 전용양식 탭 헤더 결정 (발주탭과 완전 분리)
  var exTabHeaders = defaultHeaders;
  if (
    formatName &&
    typeof loadVendorExclusiveTemplateHeadersFromHub_ === "function"
  ) {
    try {
      var tmpl = loadVendorExclusiveTemplateHeadersFromHub_(
        SpreadsheetApp.getActiveSpreadsheet(),
        formatName,
      );
      if (tmpl && tmpl.length) exTabHeaders = tmpl;
    } catch (e) {}
  }
  // 마이그레이션 시 기존 전용양식 헤더 (전용양식 탭에만 적용)
  if (exclusiveHeaders && exclusiveHeaders.length > 0) {
    var cleaned = exclusiveHeaders.filter(function (h) {
      return String(h || "").trim() !== "";
    });
    if (cleaned.length > 0) exTabHeaders = exclusiveHeaders;
  }

  // 기본 발주탭 — 항상 표준 헤더
  var orderTab = ss.getSheetByName("발주 및 송장조회");
  if (!orderTab) orderTab = ss.insertSheet("발주 및 송장조회");
  orderTab
    .getRange(1, 1, 1, orderTabHeaders.length)
    .setValues([orderTabHeaders]);
  orderTab
    .getRange("1:1")
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold");
  orderTab.setFrozenRows(1);
  _pt_applyOrderTabDesign(orderTab); // 조건부서식

  // 전용양식 탭 — 전용양식 헤더
  var exTabName =
    exclusiveTabName || (formatName ? vendorName + " 전용양식" : "");
  if (exTabName) {
    var exTab = ss.getSheetByName(exTabName);
    if (!exTab) exTab = ss.insertSheet(exTabName);
    exTab.getRange(1, 1, 1, exTabHeaders.length).setValues([exTabHeaders]);
    exTab
      .getRange("1:1")
      .setBackground("#4a148c")
      .setFontColor("white")
      .setFontWeight("bold");
    exTab.setFrozenRows(1);
    // ★ 전용양식은 조건부서식 불필요 (Push 시 교차색상만 사용하므로 발주탭 서식 적용 제외)
  }

  // 단가/업체명 스필 수식 연결 (발주탭만 — 전용양식은 A열=송장번호이므로 제외)
  try {
    _pt_injectOrderSpillFormulas(orderTab, viewerTabName);
  } catch (e) {}
  // ⚠ 전용양식 탭에는 spill 수식을 주입하지 않음
  // (전용양식 A열=송장번호, B열=적요 → 업체 수기 입력 영역)
}

// ═══════════════════════════════════════════
//  검색입력 탭 생성/갱신
// ═══════════════════════════════════════════
var _SEARCH_TAB_NAME = "검색입력";
var _SEARCH_TAB_HEADERS = [
  "품목명",
  "수량",
  "수취인",
  "수취인전화번호",
  "수취인주소",
  "배송메시지",
]; // ★ 주문일자 제외 (발주 제출 시 오늘 날짜 자동 입력)

/**
 * 협력업체 파일에 「검색입력」탭을 생성 또는 갱신.
 * - 헤더 고정, 스타일 적용
 * - B열(품목명)에 기존 발주 및 송장조회 D열 품목 목록 데이터 유효성 적용
 */
function _pt_createSearchInputTab_(ss) {
  var tab = ss.getSheetByName(_SEARCH_TAB_NAME);
  if (!tab) tab = ss.insertSheet(_SEARCH_TAB_NAME);

  // 헤더
  tab
    .getRange(1, 1, 1, _SEARCH_TAB_HEADERS.length)
    .setValues([_SEARCH_TAB_HEADERS]);
  tab
    .getRange("1:1")
    .setBackground("#0f4c81")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);

  // 열 너비
  tab.setColumnWidth(1, 220); // 품목명
  tab.setColumnWidth(2, 60); // 수량
  tab.setColumnWidth(3, 100); // 수취인
  tab.setColumnWidth(4, 120); // 전화번호
  tab.setColumnWidth(5, 280); // 주소
  tab.setColumnWidth(6, 160); // 배송메시지

  // ★ D열(수취인전화번호) 텍스트 형식 → 앞자리 0 보존
  tab.getRange("D2:D1000").setNumberFormat("@");

  // 품목명 드롭다운: 단가조회 D열 기준
  _pt_refreshSearchInputDropdown_(ss, tab);

  return tab;
}

/** B열 품목명 드롭다운 갱신 (단가조회 탭 D열=품목명, C열=이카운트코드) */
function _pt_refreshSearchInputDropdown_(ss, tab) {
  try {
    // 단가조회 탭 탐색 ("단가조회" | "뷰어" 포함 탭)
    var viewerTab = null;
    var sheets = ss.getSheets();
    for (var si = 0; si < sheets.length; si++) {
      var tn = sheets[si].getName();
      if (tn.indexOf("단가조회") !== -1 || tn.indexOf("뷰어") !== -1) {
        viewerTab = sheets[si];
        break;
      }
    }
    if (!viewerTab || viewerTab.getLastRow() < 3) return; // 3행부터 데이터

    var lr = viewerTab.getLastRow();
    // D열(품목명) 읽기 (3행~), 인덱스 3 = D열
    var rawData = viewerTab.getRange(3, 4, lr - 2, 1).getValues();
    var seen = {},
      uniq = [];
    rawData.forEach(function (r) {
      var nm = String(r[0] || "").trim();
      // ★ 빈 값, "-", 하이픈만 있는 값 필터링
      if (nm && nm !== "-" && nm !== "−" && !seen[nm]) {
        seen[nm] = true;
        uniq.push(nm);
      }
    });
    uniq.sort();
    if (uniq.length === 0) return;

    if (!tab) tab = ss.getSheetByName(_SEARCH_TAB_NAME);
    if (!tab) return;

    // ★ 500개 이하면 기존 방식 (requireValueInList)
    if (uniq.length <= 500) {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(uniq, true)
        .setAllowInvalid(true)
        .build();
      tab.getRange("A2:A1000").setDataValidation(rule);
    } else {
      // ★ 500개 초과: H열에 목록 기록 → 범위 참조 드롭다운
      var listCol = 8; // H열
      // 기존 H열 목록 초기화
      try {
        tab.getRange(1, listCol, tab.getMaxRows(), 1).clearContent();
      } catch (e) {}
      tab
        .getRange(1, listCol)
        .setValue("품목목록")
        .setFontColor("#cccccc")
        .setFontSize(8);
      var listData = uniq.map(function (nm) {
        return [nm];
      });
      tab.getRange(2, listCol, listData.length, 1).setValues(listData);
      // H열 숨김
      try {
        tab.hideColumns(listCol);
      } catch (e) {}

      var listRange =
        "'" + tab.getName() + "'!$H$2:$H$" + (listData.length + 1);
      var rule2 = SpreadsheetApp.newDataValidation()
        .requireValueInRange(tab.getRange(2, listCol, listData.length, 1), true)
        .setAllowInvalid(true)
        .build();
      tab.getRange("A2:A1000").setDataValidation(rule2);
    }
    Logger.log(
      "[검색입력] 단가조회 D열에서 " + uniq.length + "개 품목 드롭다운 적용",
    );
  } catch (e) {
    Logger.log("[검색입력 드롭다운] " + e.message);
  }
}

/** 검색입력 탭 데이터 행 초기화 (월별마감 이동 후 호출) */
function _pt_clearSearchInputTab_(ss) {
  try {
    var tab = ss.getSheetByName(_SEARCH_TAB_NAME);
    if (!tab || tab.getLastRow() < 2) return;
    tab
      .getRange(2, 1, tab.getLastRow() - 1, _SEARCH_TAB_HEADERS.length)
      .clearContent();
    Logger.log("[검색입력] 탭 초기화 완료");
  } catch (e) {}
}

/** 관리 시트: 전체 협력업체 파일에 검색입력 탭 일괄 생성/갱신 */
function partnerCreateSearchInputTabAll() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    "📋 검색입력 탭 생성",
    "모든 협력업체 파일에 「검색입력」탭을 생성/갱신합니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (ans !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var ok = [],
    failed = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace("[협력업체] ", "").trim();
    try {
      var ss = SpreadsheetApp.openById(f.id);
      _pt_createSearchInputTab_(ss);
      ok.push("✅ " + nm);
    } catch (e) {
      failed.push("❌ " + nm + ": " + String(e.message || "").substring(0, 30));
    }
  }
  ui.alert(
    "검색입력 탭 생성 결과",
    "성공: " +
      ok.length +
      "개\n" +
      (failed.length ? "실패:\n" + failed.join("\n") : ""),
    ui.ButtonSet.OK,
  );
}

/**
 * 검색입력 탭이 이미 존재하는 협력업체 파일만 대상으로
 * 드롭다운을 새로고침합니다.
 * ★ 검색입력 탭이 없는 시트는 건드리지 않습니다.
 * ★ 전체 수식 갱신(partnerForceUpdateAll)과 달리 뷰어 탭을 건드리지 않아 안전합니다.
 */
function partnerRefreshSearchInputOnly() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    "🔄 검색입력 탭 갱신",
    "검색입력 탭이 있는 협력업체만 대상으로\n드롭다운을 갱신합니다.\n\n(뷰어·발주 탭은 변경하지 않습니다)\n\n계속할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (ans !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var updated = [], skipped = [], failed = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace("[협력업체] ", "").trim();
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var siTab = ss.getSheetByName(_SEARCH_TAB_NAME);
      if (siTab) {
        // 이미 있음 → 드롭다운 갱신만
        _pt_refreshSearchInputDropdown_(ss, siTab);
        updated.push("🔄 " + nm);
      } else {
        // 검색입력 탭 없음 → 건드리지 않음
        skipped.push("⏭ " + nm);
      }
    } catch (e) {
      failed.push("❌ " + nm + ": " + String(e.message || "").substring(0, 40));
    }
  }

  var msg = "📋 검색입력 탭 갱신 결과\n\n";
  if (updated.length) msg += "갱신: " + updated.length + "개\n" + updated.join("\n") + "\n\n";
  if (skipped.length) msg += "스킵 (검색입력 없음): " + skipped.length + "개\n";
  if (failed.length) msg += "\n실패: " + failed.length + "개\n" + failed.join("\n") + "\n\n";
  if (!updated.length) msg += "대상 시트가 없습니다.";

  ui.alert("검색입력 탭 갱신 결과", msg, ui.ButtonSet.OK);
}

//  partnerRepairSingleViewer / partnerForceUpdateAll 공유
// ═══════════════════════════════════════════
/**
 * 뷰어 탭에 수식·디자인·보호·발주탭서식을 한 번에 재적용한다.
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {string} fileName - 로그/isConsumer 판별용
 * @param {SpreadsheetApp.Sheet} sheet - 뷰어탭
 * @param {number} K2 - 그룹 열 번호 (0 또는 NaN 이면 Row2 스킵)
 * @param {string} hubId
 * @returns {string} 결과 표시용 짧은 문자열
 */
function _pt_repairViewerSheetCore_(ss, fileName, sheet, K2, hubId) {
  // ★ 소비자가 모드 판별: 파일명 (소비자용) 또는 K2=NNN 패턴 (444·555 등)
  var isConsumer = fileName.indexOf("(소비자용)") !== -1;
  var dcRate = 5;
  var dcMul = 1;

  if (isConsumer) {
    // 파일명에서 DC율 파싱
    dcRate = _pt_parseConsumerDcRateFromName(fileName);
    dcMul = (100 - dcRate) / 100;

    // ★ 레거시 K2 보정: K2가 NNN 패턴이 아니면 dcRate * 111 로 교정
    //   예: K2=7 (구버전 고정값) → 777 (5%→555, 7%→777)
    var rateFromK2 = _pt_getConsumerRateFromK2(K2);
    if (rateFromK2 <= 0) {
      var correctedK2 = Math.round(dcRate) * 111;
      Logger.log(
        "[PT] 소비자 K2 보정: " +
          K2 +
          " → " +
          correctedK2 +
          " (DC " +
          dcRate +
          "%)",
      );
      K2 = correctedK2;
    }
  } else {
    // ★ 새 방식: K2 값이 NNN 패턴이면 소비자가 할인 모드
    var rateFromK2 = _pt_getConsumerRateFromK2(K2);
    if (rateFromK2 > 0) {
      isConsumer = true;
      dcRate = rateFromK2;
      dcMul = (100 - dcRate) / 100;
      Logger.log("[PT] K2=" + K2 + " → 소비자가 " + dcRate + "% 할인 모드");
    }
  }

  // ★ 설정탭 없으면 자동 생성 (삭제/유실 복구)
  try {
    var vendorForSettings = fileName
      .replace(_PT.PREFIX, "")
      .replace("[협력업체]_", "")
      .replace(/\s*\(소비자용\).*$/, "")
      .trim();
    _pt_ensureLocalSettingsTab(ss, vendorForSettings, "");
  } catch (eSettings) {}

  _pt_ensureNoticeRowLinked(sheet, hubId);
  if (K2 && !isNaN(K2)) _pt_applyRow2(sheet, hubId, isConsumer, K2);
  _pt_clearSpillArea(sheet, isConsumer);
  _pt_applyRow3Formulas(sheet, hubId, isConsumer, dcMul);
  _pt_applyDesign(sheet);

  SpreadsheetApp.flush();
  try {
    _pt_sortViewerByEcountCode_(sheet, true);
  } catch (eSort) {}
  _pt_protectAndHide(sheet);

  // 레거시 잔재 정리 (AE~AH, AA1, AD1)
  try {
    sheet.getRange("AE1:AH1").clearContent();
  } catch (e) {}
  try {
    sheet
      .getRange("AA1")
      .setFormula("=IFERROR('설정'!B5, \"\")")
      .setFontColor("white");
  } catch (e) {}
  try {
    sheet.getRange("AD1").clearContent();
  } catch (e) {}

  // 발주탭 조건부서식 재적용 (전용양식은 Push 교차색상만 사용하므로 조건부서식 제외)
  try {
    var allTabs = ss.getSheets();
    for (var ti = 0; ti < allTabs.length; ti++) {
      var tn = allTabs[ti].getName();
      if (tn === "발주 및 송장조회") {
        _pt_applyOrderTabDesign(allTabs[ti]);
        // ★ 발주탭 spill 수식 복구 (품목명 자동완성 포함)
        try { _pt_healOrderSpillFormulas(allTabs[ti], sheet.getName()); } catch (eSpill) {}
      } else if (tn.indexOf("전용양식") !== -1) {
        // ★ 전용양식은 조건부서식 불필요 → 기존 잔류 규칙 정리만
        try { allTabs[ti].clearConditionalFormatRules(); } catch (eCfr) {}
      }
    }
  } catch (eOrd) {}

  // ★ 검색입력 탭이 있는 경우만 드롭다운 갱신 (없으면 건드리지 않음)
  try {
    var siTab = ss.getSheetByName(_SEARCH_TAB_NAME);
    if (siTab) {
      _pt_refreshSearchInputDropdown_(ss, siTab);
    }
  } catch (eSI) {}

  return K2 && !isNaN(K2)
    ? "(K2=" +
        K2 +
        ", " +
        (isConsumer ? "소비자가 " + dcRate + "%" : "그룹단가") +
        ")"
    : "(K2 없음)";
}


// ═══════════════════════════════════════════
//  단일 업체 단가조회 탭 복구 (파일 선택)
//  → K2(그룹) 유지, 수식·레이아웃·보호 전체 재적용
// ═══════════════════════════════════════════
function partnerRepairSingleViewer() {
  var ui = SpreadsheetApp.getUi();
  var hubId = _PT.HUB_ID;
  var files = _pt_listFiles();
  if (files.length === 0) return ui.alert("협력업체 파일 없음");

  // 파일 목록 (K2 현황 표시)
  var fileLines = [];
  for (var fi = 0; fi < files.length; fi++) {
    var shortName = files[fi].name.replace(_PT.PREFIX, "").trim();
    fileLines.push(fi + 1 + ") " + shortName);
  }

  var resp = ui.prompt(
    "🔧 단가조회 탭 복구 — 업체 선택",
    "복구할 업체 번호를 입력하세요:\n\n" + fileLines.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var idx = parseInt(resp.getResponseText().trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= files.length)
    return ui.alert("잘못된 번호입니다.");

  var f = files[idx];

  try {
    var ss = SpreadsheetApp.openById(f.id);

    // 뷰어탭 탐색
    var sheet = null;
    try {
      sheet = _pt_findViewerSheet(ss);
    } catch (e) {}
    if (!sheet) sheet = ss.getSheetByName("단가조회") || ss.getSheets()[0];
    if (!sheet) return ui.alert("❌ 뷰어탭을 찾을 수 없습니다:\n" + f.name);

    // K2 확인
    var K2 = parseInt(sheet.getRange("K2").getValue(), 10);
    if (!K2 || isNaN(K2)) {
      var ans = ui.alert(
        "⚠️ K2(그룹 열 번호) 없음",
        f.name +
          "\n\nK2가 비어있습니다.\n" +
          "'K2 설정 + 수식 복구' 메뉴를 먼저 실행하세요.\n\n계속하시겠습니까? (K2 없이 수식만 재적용)",
        ui.ButtonSet.YES_NO,
      );
      if (ans !== ui.Button.YES) return;
    }

    // ── 복구 시퀀스 (공통 헬퍼 사용) ──
    var K2Info = _pt_repairViewerSheetCore_(ss, f.name, sheet, K2, hubId);
    ui.alert(
      "✅ 복구 완료\n\n" +
        f.name +
        " " +
        K2Info +
        "\n\n" +
        "· 수식 재적용\n· 정렬\n· 보호 설정\n· 발주탭 서식 재적용",
    );
  } catch (e) {
    ui.alert("❌ 복구 실패\n" + f.name + "\n\n" + e.message);
  }
}

// ═══════════════════════════════════════════
//  일괄 업데이트: 수식만 갱신 (K2 유지)
// ═══════════════════════════════════════════
function partnerForceUpdateAll() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  var hubId = _PT.HUB_ID;
  var files = _pt_listFiles();
  var results = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var sheet = ss.getSheetByName("단가조회") || ss.getSheets()[0];
      // 기존 뷰어 탭 찾기
      try {
        {
          var vs = _pt_findViewerSheet(ss);
          if (vs) sheet = vs;
        }
      } catch (e) {}

      var K2 = parseInt(sheet.getRange("K2").getValue(), 10);
      if (!K2 || isNaN(K2)) {
        results.push(f.name + ": K2없음 스킵");
        continue;
      }
      // ── 복구 시퀀스 (공통 헬퍼 사용) ──
      var K2Info = _pt_repairViewerSheetCore_(ss, f.name, sheet, K2, hubId);
      results.push(f.name + ": ✅ " + K2Info);
    } catch (e) {
      results.push(f.name + ": ❌ " + e.message);
    }
  }

  // ★ 허브 탭 조건부서식 재적용 (구 partnerRepairAll 기능 흡수)
  try {
    var hubTab =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName("협력업체_발주허브");
    if (hubTab && typeof _po_applyHubDesign === "function") _po_applyHubDesign(hubTab);
  } catch (e) {}

  var msg =
    "협력업체 일괄 업데이트\n" + files.length + "개\n\n" + results.join("\n");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ═══════════════════════════════════════════
//  K2 설정 + 수식 전체 복구 (이름변경으로 편입한 파일용)
// ═══════════════════════════════════════════
/**
 * K2가 비어있거나 잘못 설정된 협력업체 시트에서 실행.
 * 허브의 그룹 목록을 보여주고, 선택된 그룹의 열 번호를 K2에 설정한 뒤
 * 수식 전체를 재적용합니다.
 *
 * ★ 사용법: 해당 협력업체 시트를 열고 이 메뉴를 실행
 */
function partnerSetK2AndRepair() {
  var ui = SpreadsheetApp.getUi();
  var hubId = _PT.HUB_ID;

  // 1) 협력업체 파일 목록 조회
  var files = _pt_listFiles();
  if (files.length === 0)
    return ui.alert(
      "협력업체 파일 없음\n폴더에 '[협력업체] ' 이름 파일이 없습니다.",
    );

  // K2 비어있는(=미설정) 파일 우선 표시
  var fileLines = [];
  for (var fi = 0; fi < files.length; fi++) {
    var shortName = files[fi].name
      .replace(_PT.PREFIX, "")
      .replace("(소비자용)", "")
      .trim();
    fileLines.push(fi + 1 + ") " + shortName + "  [" + files[fi].name + "]");
  }

  // 2) 파일 선택
  var fResp = ui.prompt(
    "복구할 파일 선택",
    "번호를 입력하세요:\n\n" + fileLines.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (fResp.getSelectedButton() !== ui.Button.OK) return;
  var fIdx = parseInt(fResp.getResponseText().trim(), 10) - 1;
  if (isNaN(fIdx) || fIdx < 0 || fIdx >= files.length)
    return ui.alert("잘못된 번호입니다.");
  var targetFile = files[fIdx];

  // 3) 그룹 목록 조회
  var groups;
  try {
    groups = _pt_getHubGroups();
  } catch (e) {
    return ui.alert("❌ 허브 그룹 목록 조회 실패: " + e.message);
  }
  var groupList = [];
  for (var g in groups) groupList.push(g + " (열:" + groups[g] + ")");
  if (groupList.length === 0) return ui.alert("허브에 그룹이 없습니다.");

  // 4) 그룹 선택
  var gResp = ui.prompt(
    "단가 그룹 선택 → " + targetFile.name,
    "적용할 그룹을 정확히 입력하세요:\n\n" + groupList.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (gResp.getSelectedButton() !== ui.Button.OK) return;
  var groupName = gResp
    .getResponseText()
    .trim()
    .replace(/\s*\(열:\d+\)$/, "");
  var K2 = groups[groupName];
  if (!K2) return ui.alert("존재하지 않는 그룹: " + groupName);

  // 5) 파일 열기 + 뷰어 탭 찾기
  var ss;
  try {
    ss = SpreadsheetApp.openById(targetFile.id);
  } catch (e) {
    return ui.alert("❌ 파일 열기 실패: " + e.message);
  }
  var sheet = null;
  try {
    sheet = _pt_findViewerSheet(ss);
  } catch (e) {}
  if (!sheet) sheet = ss.getSheetByName("단가조회");
  if (!sheet) {
    var tabs = ss.getSheets();
    for (var si = 0; si < tabs.length; si++) {
      var tn = tabs[si].getName();
      if (tn.indexOf("뷰어") !== -1 || tn.indexOf("단가조회") !== -1) {
        sheet = tabs[si];
        break;
      }
    }
  }
  if (!sheet)
    return ui.alert(
      "단가조회/뷰어 탭을 찾을 수 없습니다.\n현재 탭: " +
        ss
          .getSheets()
          .map(function (t) {
            return t.getName();
          })
          .join(", "),
    );

  // 6) 소비자용 여부
  var fname = ss.getName();
  var isConsumer = fname.indexOf("(소비자용)") !== -1;
  var dcMul = 1;
  if (isConsumer) {
    var dcRate = _pt_parseConsumerDcRateFromName(fname);
    dcMul = (100 - dcRate) / 100;
  }

  // 7) 수식 전체 재적용
  try {
    _pt_ensureNoticeRowLinked(sheet, hubId);
    _pt_applyRow2(sheet, hubId, isConsumer, K2); // K2 설정 포함
    _pt_clearSpillArea(sheet, isConsumer);
    _pt_applyRow3Formulas(sheet, hubId, isConsumer, dcMul);
    _pt_applyDesign(sheet);
    try {
      sheet.getRange("AE1:AH1").clearContent();
    } catch (e2) {}
    try {
      sheet
        .getRange("AA1")
        .setFormula("=IFERROR('설정'!B5, \"\")")
        .setFontColor("white");
    } catch (e2) {}
    // 정렬 먼저 → 보호 나중
    SpreadsheetApp.flush();
    _pt_sortViewerByEcountCode_(sheet, true); // skipProtect=true
    _pt_protectAndHide(sheet);
  } catch (e) {
    return ui.alert("❌ 수식 재적용 실패: " + e.message);
  }

  ui.alert(
    "✅ 복구 완료\n\n" +
      "파일: " +
      fname +
      "\n" +
      "탭:   " +
      sheet.getName() +
      "\n" +
      "그룹: " +
      groupName +
      "  (K2=" +
      K2 +
      ")\n\n" +
      "#REF!가 남아있으면 해당 파일의 C3 셀을 클릭 후\n'액세스 허용' 버튼을 눌러 IMPORTRANGE를 인증하세요.",
  );
}

// ═══════════════════════════════════════════
//  일반 협력업체 시트 → 소비자용 전환
//  이미 만들어진 일반 시트에 할인율을 부여해 소비자용으로 변경
// ═══════════════════════════════════════════
function partnerConvertToConsumer() {
  var ui = SpreadsheetApp.getUi();
  var hubId = _PT.HUB_ID;
  var files = _pt_listFiles();
  if (files.length === 0) return ui.alert("협력업체 파일 없음");

  // 1) 파일 선택
  var fileLines = [];
  for (var fi = 0; fi < files.length; fi++) {
    var shortName = files[fi].name.replace(_PT.PREFIX, "").trim();
    fileLines.push(fi + 1 + ") " + shortName);
  }
  var fResp = ui.prompt(
    "🔄 일반 → 소비자용 전환",
    "전환할 업체 번호를 입력하세요:\n\n" + fileLines.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (fResp.getSelectedButton() !== ui.Button.OK) return;
  var fIdx = parseInt(fResp.getResponseText().trim(), 10) - 1;
  if (isNaN(fIdx) || fIdx < 0 || fIdx >= files.length)
    return ui.alert("잘못된 번호입니다.");
  var targetFile = files[fIdx];

  // 2) DC율 입력
  var dcResp = ui.prompt(
    "🔄 소비자 할인율 입력",
    "적용할 DC율(%)을 입력하세요.\n예: 5  또는  7.5\n(범위: 1~10)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (dcResp.getSelectedButton() !== ui.Button.OK) return;
  var dcRate = _pt_normalizeDcRateNumber(
    parseFloat(dcResp.getResponseText()),
    NaN,
  );
  if (isNaN(dcRate))
    return ui.alert("유효하지 않은 DC율입니다. 1~10 사이 숫자를 입력하세요.");
  var dcMul = (100 - dcRate) / 100;

  // 3) K2 = dcRate * 111 (NNN 패턴)
  //    예: 5% → 555,  7% → 777,  8% → 888
  var consumerK2 = Math.round(dcRate) * 111;

  // 4) 파일 열기 + 뷰어 탭 탐색
  var ss;
  try {
    ss = SpreadsheetApp.openById(targetFile.id);
  } catch (e) {
    return ui.alert("❌ 파일 열기 실패: " + e.message);
  }

  var sheet = null;
  try {
    sheet = _pt_findViewerSheet(ss);
  } catch (e) {}
  if (!sheet) {
    var allTabs = ss.getSheets();
    for (var ti = 0; ti < allTabs.length; ti++) {
      var tn = allTabs[ti].getName();
      if (tn.indexOf("뷰어") !== -1 || tn.indexOf("단가조회") !== -1) {
        sheet = allTabs[ti];
        break;
      }
    }
  }
  if (!sheet)
    return ui.alert(
      "❌ 뷰어/단가조회 탭을 찾을 수 없습니다.\n현재 탭: " +
        ss
          .getSheets()
          .map(function (t) {
            return t.getName();
          })
          .join(", "),
    );

  // 5) 수식 전환 (소비자용 모드로 재적용)
  try {
    _pt_ensureNoticeRowLinked(sheet, hubId);
    _pt_applyRow2(sheet, hubId, true, consumerK2); // K2=NNN, isConsumer=true
    _pt_clearSpillArea(sheet, true);
    _pt_applyRow3Formulas(sheet, hubId, true, dcMul); // G3 = ROUNDUP(F3:F * dcMul, -2)
    _pt_applyDesign(sheet);
    // 메타셀 정리
    try {
      sheet
        .getRange("AA1")
        .setFormula("=IFERROR('설정'!B5, \"\")")
        .setFontColor("white");
    } catch (e2) {}
    SpreadsheetApp.flush();
    try {
      _pt_sortViewerByEcountCode_(sheet, true);
    } catch (eSort) {}
    _pt_protectAndHide(sheet);
  } catch (e) {
    return ui.alert("❌ 전환 실패: " + e.message);
  }

  ui.alert(
    "✅ 소비자용 전환 완료\n\n" +
      "파일: " +
      targetFile.name +
      "\n" +
      "탭:   " +
      sheet.getName() +
      "\n" +
      "DC율: " +
      dcRate +
      "%  (K2=" +
      consumerK2 +
      ")\n\n" +
      "G열(최종단가) = 소비자가 × " +
      Math.round(dcMul * 100) / 100 +
      "\n" +
      "※ #REF! 발생 시 Z1셀 'IMPORTRANGE 액세스 허용' 클릭",
  );
}

// ═══════════════════════════════════════════
//  긴급 복구: 모든 것 재적용
// ═══════════════════════════════════════════
function partnerRepairAll() {
  // forceUpdateAll과 동일 — 별도 분리하여 의미 명확화
  partnerForceUpdateAll();
  // 협력업체_발주허브 조건부서식 재적용
  try {
    var hubTab =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName("협력업체_발주허브");
    if (hubTab) _po_applyHubDesign(hubTab);
  } catch (e) {}
}

// ═══════════════════════════════════════════
//  단가 새로고침 (IMPORTRANGE 강제 리프레시)
//  — 수식만 재세팅하여 캐시를 강제 무효화
//  — partnerForceUpdateAll보다 빠름 (디자인/보호 건너뜀)
// ═══════════════════════════════════════════
function partnerRefreshViewerPrices() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  var hubId = _PT.HUB_ID;
  var files = _pt_listFiles();
  var refreshed = 0,
    failed = 0,
    errors = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var sheet = null;
      try {
        sheet = _pt_findViewerSheet(ss);
      } catch (e) {}
      if (!sheet) sheet = ss.getSheetByName("단가조회") || ss.getSheets()[0];

      var K2 = parseInt(sheet.getRange("K2").getValue(), 10);
      if (!K2 || isNaN(K2)) {
        errors.push(f.name + ": K2없음");
        failed++;
        continue;
      }

      var isConsumer = f.name.indexOf("(소비자용)") !== -1;
      var dcMul = 1;
      if (isConsumer) {
        var dcRate = _pt_parseConsumerDcRateFromName(f.name);
        dcMul = (100 - dcRate) / 100;
      }

      // 수동 모드 전용: C열(이카운트코드)은 건드리지 않고, A/B/D~J 수식만 재적용
      _pt_clearSpillArea(sheet, isConsumer);
      _pt_applyRow3Formulas(sheet, hubId, isConsumer, dcMul);
      refreshed++;
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(f.name + ": " + e.message);
    }
  }

  SpreadsheetApp.flush();
  var msg =
    "🔄 단가 새로고침 완료\n\n" +
    "- 전체: " +
    files.length +
    "개\n" +
    "- 새로고침: " +
    refreshed +
    "개\n" +
    "- 실패: " +
    failed +
    "개" +
    (errors.length > 0 ? "\n\n⚠ 오류:\n" + errors.join("\n") : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ═══════════════════════════════════════════
//  진단: 뷰어 익월단가 열 정합성 확인
// ═══════════════════════════════════════════
function partnerDiagnoseViewerPriceColumns() {
  var ui = SpreadsheetApp.getUi();
  var hubId = _PT.HUB_ID;

  // 허브 열 구조 읽기
  var hubSS = _pt_getHubSS(hubId);
  var hubTab = hubSS.getSheetByName("전체 그룹 단가표");
  if (!hubTab) return ui.alert("❌ 허브에 '전체 그룹 단가표' 탭 없음");

  var hubLC = hubTab.getLastColumn();
  var hubRow1 = hubTab.getRange(1, 1, 1, hubLC).getValues()[0]; // 그룹명
  var hubRow2 = hubTab.getRange(2, 1, 1, hubLC).getValues()[0]; // 서브헤더
  // 샘플 데이터 (4행)
  var sampleRow = hubTab.getRange(4, 1, 1, hubLC).getValues()[0];

  // 그룹별 시작 열 매핑
  var groupCols = {};
  for (var c = 6; c < hubRow1.length; c++) {
    var gn = String(hubRow1[c] || "").trim();
    if (gn && !groupCols[gn]) groupCols[gn] = c + 1; // 1-based
  }

  // 협력업체 뷰어 K2 값 수집
  var files = _pt_listFiles();
  var lines = [];
  lines.push("📊 뷰어 익월단가 열 진단\n");
  lines.push("허브 그룹 구조:");
  for (var gn2 in groupCols) {
    var col = groupCols[gn2];
    var subHdr = String(hubRow2[col + 3] || "").trim(); // K2+4 위치의 서브헤더
    var sampleVal = sampleRow[col + 3]; // K2+4 위치의 샘플값
    lines.push(
      "  " +
        gn2 +
        " → 시작열:" +
        col +
        ", +4열(" +
        (col + 4) +
        ") 헤더='" +
        subHdr +
        "' 샘플=" +
        sampleVal,
    );
  }

  lines.push("\n업체별 K2 설정:");
  for (var i = 0; i < Math.min(files.length, 15); i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var sheet = null;
      try {
        sheet = _pt_findViewerSheet(ss);
      } catch (e) {}
      if (!sheet) sheet = ss.getSheetByName("단가조회") || ss.getSheets()[0];
      var K2 = sheet.getRange("K2").getValue();
      var shortName = files[i].name.replace(_PT.PREFIX, "");

      // 허브에서 K2 열의 그룹명 확인
      var hubGroupName =
        K2 && K2 > 0 && K2 <= hubRow1.length
          ? String(hubRow1[K2 - 1] || "").trim()
          : "범위초과";
      var hubNextHdr =
        K2 && K2 + 3 < hubRow2.length
          ? String(hubRow2[K2 + 3] || "").trim()
          : "범위초과";

      // J3 수식 확인
      var j3f = "";
      try {
        j3f = String(sheet.getRange("J3").getFormula() || "").substring(0, 30);
      } catch (e) {}
      var j3v = "";
      try {
        j3v = String(sheet.getRange("J3").getDisplayValue() || "");
      } catch (e) {}

      lines.push(
        "  " +
          shortName +
          " → K2=" +
          K2 +
          " 그룹=" +
          hubGroupName +
          " K2+4헤더=" +
          hubNextHdr +
          " J3값=" +
          j3v,
      );
    } catch (e) {
      lines.push("  " + files[i].name + ": ❌ " + e.message);
    }
  }

  var msg = lines.join("\n");
  Logger.log(msg);
  ui.alert(msg);
}

//  뷰어 수동 모드:
//  C열만 IMPORTRANGE → 값 변환
//  A,B,D~J열의 XLOOKUP ARRAYFORMULA는 유지
//  → C열 편집 시 다른 열이 자동 연동 (새로고침 불필요)
//  → C열 값을 지우면 해당 행이 사라짐
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
//  전체 협력업체 뷰어탭 수동 모드 일괄 전환
//  C열 IMPORTRANGE → 값(이카운트코드)으로 변환
//  다른 열(A,B,D~J) XLOOKUP 수식은 유지
// ═══════════════════════════════════════════
function partnerViewerCodeToManual() {
  var ui = SpreadsheetApp.getUi();

  var ans = ui.alert(
    "📝 전체 수동 모드 전환",
    "모든 협력업체 파일의 뷰어탭 C열을\n" +
      "IMPORTRANGE → 값(이카운트코드)으로 변환합니다.\n" +
      "다른 열(A,B,D~J)의 XLOOKUP 수식은 유지됩니다.\n\n" +
      "계속하시겠습니까?",
    ui.ButtonSet.YES_NO,
  );
  if (ans !== ui.Button.YES) return;

  var hubId = _PT.HUB_ID;
  var files = _pt_listFiles();
  if (files.length === 0) return ui.alert("협력업체 파일 없음");

  var converted = [],
    skipped = [],
    errors = [];

  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var sheet = null;
      try {
        sheet = _pt_findViewerSheet(ss);
      } catch (e) {}
      if (!sheet) sheet = ss.getSheetByName("단가조회") || ss.getSheets()[0];
      if (!sheet) {
        skipped.push(files[i].name + ": 뷰어탭 없음");
        continue;
      }

      // C3 수식 확인
      var c3f = String(sheet.getRange("C3").getFormula() || "");
      if (!c3f || c3f.indexOf("IMPORTRANGE") === -1) {
        skipped.push(files[i].name.replace(_PT.PREFIX, "") + ": 이미 수동모드");
        continue;
      }

      // C열 값 읽기
      var lr = sheet.getLastRow();
      if (lr < 3) {
        skipped.push(files[i].name + ": 데이터 없음");
        continue;
      }
      var cVals = sheet.getRange(3, 3, lr - 2, 1).getValues();

      // C열 수식 → 값 변환
      sheet.getRange(3, 3, lr - 2, 1).clearContent();
      var filled = [];
      var codeCount = 0;
      for (var r = 0; r < cVals.length; r++) {
        var v = String(cVals[r][0] || "").trim();
        if (v && v !== "-" && v.indexOf("#") === -1) {
          filled.push([v]);
          codeCount++;
        } else {
          filled.push([""]);
        }
      }
      if (filled.length > 0) {
        sheet.getRange(3, 3, filled.length, 1).setValues(filled);
      }

      // A,B,D~F XLOOKUP 수식 없으면 복원
      var a3f = String(sheet.getRange("A3").getFormula() || "");
      if (!a3f || a3f.indexOf("ARRAYFORMULA") === -1) {
        var K2 = parseInt(sheet.getRange("K2").getValue(), 10);
        if (K2 && !isNaN(K2)) {
          var ids = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!C:C")';
          var hubLink = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!';
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
        }
      }
      SpreadsheetApp.flush();
      converted.push(
        files[i].name.replace(_PT.PREFIX, "") +
          ": " +
          codeCount +
          "개 코드 변환",
      );
    } catch (e) {
      errors.push(files[i].name + ": ❌ " + e.message);
    }
  }

  var msg =
    "📝 전체 수동 모드 전환 완료\n\n" +
    (converted.length
      ? "✅ 변환 (" +
        converted.length +
        "개):\n" +
        converted.join("\n") +
        "\n\n"
      : "") +
    (skipped.length
      ? "⏩ 스킵 (" + skipped.length + "개):\n" + skipped.join("\n") + "\n\n"
      : "") +
    (errors.length ? "❌ 오류:\n" + errors.join("\n") : "");
  Logger.log(msg);
  ui.alert(msg);
}

// ═══════════════════════════════════════════
/**
 * 단가조회 탭에서 C열(이카운트코드) 기준으로 행을 오름차순 정렬:
 *   - 통합허브의 이카운트코드 순서와 일치시킴
 *   - 코드가 비어있는 행은 하단으로 배치
 *
 * ★ partnerForceUpdateAll 호출 후 자동 실행됨.
 *   수동 실행도 가능 (메뉴 추가 시).
 */
/**
 * @param {Sheet}   sheet
 * @param {boolean} skipProtect  true=보호 해제/재보호 생략 (배치 실행 시, 보호 적용 전에 호출)
 *                               false(기본)=단독 실행 시, A2:K3 보호 해제→정렬→재보호
 */
function _pt_sortViewerByEcountCode_(sheet, skipProtect) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 4) return;

  var dataRows = lastRow - 2;
  var lc = Math.min(sheet.getLastColumn(), 10);
  var data = sheet.getRange(3, 1, dataRows, lc).getValues();

  var filled = [],
    empty = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][2]).trim() !== "") filled.push(data[i]);
    else empty.push(data[i]);
  }
  if (filled.length === 0) return;

  // C열(인덱스2) 이카운트코드 기준 오름차순 정렬
  filled.sort(function (a, b) {
    var aCode = String(a[2] || "");
    var bCode = String(b[2] || "");
    return aCode.localeCompare(bCode);
  });

  var sorted = filled.concat(empty);
  if (sorted.length !== dataRows) return;

  if (skipProtect) {
    // 배치 실행: 보호 적용 전에 호출되므로 그냥 write
    sheet.getRange(3, 1, dataRows, lc).setValues(sorted);
  } else {
    // 단독 실행: 기존 A2:K3 보호 일시 해제 → write → 재보호
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    var removed = [];
    for (var pi = 0; pi < protections.length; pi++) {
      var rng = protections[pi].getRange();
      // A2:K3 영역과 겹치는 보호만 해제
      if (rng.getRow() <= 3 && rng.getLastRow() >= 2) {
        try {
          protections[pi].remove();
          removed.push(true);
        } catch (e) {}
      }
    }
    try {
      sheet.getRange(3, 1, dataRows, lc).setValues(sorted);
    } finally {
      // 정렬 후 보호 재적용
      if (removed.length > 0) _pt_protectAndHide(sheet);
    }
  }
}

// ═══════════════════════════════════════════
//  변동단가 정렬 공개 함수
// ═══════════════════════════════════════════
/** 메뉴 3-1: 현재 열려있는 협력업체 시트의 단가조회 탭만 정렬 */
function partnerSortChangedPriceCurrentSheet() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = null;
    try {
      sheet = _pt_findViewerSheet(ss);
    } catch (e) {}
    if (!sheet) sheet = ss.getSheetByName("단가조회") || ss.getSheets()[0];
    SpreadsheetApp.flush();
    _pt_sortViewerByEcountCode_(sheet);
    if (ui)
      ui.alert(
        "✅ 이카운트코드 순 정렬 완료\n\n통합허브의 이카운트코드 순서대로 정렬되었습니다.",
      );
  } catch (e) {
    if (ui) ui.alert("❌ 오류: " + e.message);
  }
}

/** 전체 협력업체 시트 일괄 정렬 (수식 갱신 없이 정렬만) */
function partnerSortChangedPriceAllSheets() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  var files = _pt_listFiles();
  var results = [];
  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var sheet = null;
      try {
        sheet = _pt_findViewerSheet(ss);
      } catch (e) {}
      if (!sheet) sheet = ss.getSheetByName("단가조회") || ss.getSheets()[0];
      SpreadsheetApp.flush();
      _pt_sortViewerByEcountCode_(sheet);
      results.push(files[i].name + ": ✅");
    } catch (e) {
      results.push(files[i].name + ": ❌ " + e.message);
    }
  }
  var msg =
    "이카운트코드 순 정렬 (전체 " +
    files.length +
    "개)\n\n" +
    results.join("\n");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ═══════════════════════════════════════════
//  전체 협력업체 뷰어탭 이름 → "단가조회" 일괄 변경
//  변경 후 발주탭 A/L열 spill 수식을 새 탭명으로 자동 재연결
// ═══════════════════════════════════════════
function partnerRenameViewerTabToDankaJohoe() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var TARGET_NAME = "단가조회";
  var files = _pt_listFiles();
  var renamed = [],
    skipped = [],
    errors = [];

  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);

      // 뷰어탭 탐색
      var viewerTab = null;
      try {
        viewerTab = _pt_findViewerSheet(ss);
      } catch (e) {}

      if (!viewerTab) {
        skipped.push(files[i].name + ": 뷰어탭 없음");
        continue;
      }

      var oldName = viewerTab.getName();

      if (oldName === TARGET_NAME) {
        skipped.push(files[i].name + ': 이미 "' + TARGET_NAME + '"');
        continue;
      }

      // ① 뷰어탭 이름 변경
      viewerTab.setName(TARGET_NAME);

      // ② 발주탭 A/L열 spill 수식 재연결 (heal 함수가 구버전 감지 후 새 탭명으로 교체)
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (orderTab) {
        try {
          // 현재 A1 수식에 구 탭명이 있으면 강제 교체
          var a1F = String(orderTab.getRange("A1").getFormula() || "");
          var l1F = String(orderTab.getRange("L1").getFormula() || "");
          var oldSafe = oldName.replace(/'/g, "''");

          if (a1F.indexOf(oldSafe) !== -1) {
            orderTab.getRange("A1:A").clearContent();
            orderTab
              .getRange("A1")
              .setFormula(_pt_buildOrderVendorNameSpillFormula(TARGET_NAME));
          }
          if (l1F.indexOf(oldSafe) !== -1) {
            orderTab.getRange("L1:L").clearContent();
            orderTab
              .getRange("L1")
              .setFormula(_pt_buildOrderUnitPriceSpillFormula(TARGET_NAME));
          }
          try {
            var d1F = String(orderTab.getRange("D1").getFormula() || "");
            if (d1F.indexOf(oldSafe) !== -1 || !d1F) {
              orderTab.getRange("D1:D").clearContent();
              orderTab
                .getRange("D1")
                .setFormula(_pt_buildOrderItemNameSpillFormula(TARGET_NAME));
            }
          } catch(eD) {}
        } catch (eSpill) {}
      }

      SpreadsheetApp.flush();
      renamed.push(
        files[i].name + ': "' + oldName + '" → "' + TARGET_NAME + '"',
      );
    } catch (e) {
      errors.push(files[i].name + ": ❌ " + e.message);
    }
  }

  var msg =
    "🔄 뷰어탭 이름 변경 결과\n\n" +
    (renamed.length
      ? "✅ 변경 (" + renamed.length + "개):\n" + renamed.join("\n") + "\n\n"
      : "") +
    (skipped.length
      ? "⏩ 스킵 (" + skipped.length + "개):\n" + skipped.join("\n") + "\n\n"
      : "") +
    (errors.length
      ? "❌ 오류 (" + errors.length + "개):\n" + errors.join("\n")
      : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ═══════════════════════════════════════════
//  기존 시트에서 마이그레이션
// ═══════════════════════════════════════════
function partnerMigrateFromExisting() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "기존 [독립 배포] → [협력업체] 마이그레이션",
    "기존 [독립 배포] 시트에서 직접 K2, 업체명, 소비자용 여부를 읽어\n[협력업체] 시트를 새로 생성합니다.\n\n기존 시트는 그대로 유지됩니다.\n\n진행하시겠습니까?",
    ui.ButtonSet.YES_NO,
  );
  if (confirm !== ui.Button.YES) return;

  // 기존 [독립 배포] 파일 목록 가져오기
  var folderIds = [
    "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl",
    "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v",
  ];
  var seen = {},
    srcFiles = [];
  for (var fi = 0; fi < folderIds.length; fi++) {
    try {
      var folder = DriveApp.getFolderById(folderIds[fi]);
      var iter = folder.getFiles();
      while (iter.hasNext()) {
        var f = iter.next();
        var nm = f.getName();
        if (nm.indexOf("[독립 배포]") === -1 && nm.indexOf("[독립배포]") === -1)
          continue;
        if (seen[f.getId()]) continue;
        seen[f.getId()] = true;
        srcFiles.push({ id: f.getId(), name: nm });
      }
    } catch (e) {}
  }

  if (srcFiles.length === 0)
    return ui.alert("기존 [독립 배포] 시트를 찾을 수 없습니다.");

  var created = 0,
    skipped = 0,
    errors = [];
  var hubId = _PT.HUB_ID;

  for (var i = 0; i < srcFiles.length; i++) {
    var src = srcFiles[i];
    try {
      var srcSS = SpreadsheetApp.openById(src.id);
      // 뷰어 탭 찾기
      var srcSheet = null;
      try {
        srcSheet = _pt_findViewerSheet(srcSS);
      } catch (e) {}
      if (!srcSheet) srcSheet = srcSS.getSheets()[0];

      // K2 읽기
      var K2 = parseInt(srcSheet.getRange("K2").getValue(), 10);
      if (!K2 || isNaN(K2) || K2 < 7) {
        K2 = 7;
      }

      var isConsumer = src.name.indexOf("(소비자용)") !== -1;

      // 업체명 추출 ([독립 배포] 제거, (소비자용) 등 제거)
      var shortName = src.name
        .replace(/\[독립\s*배포\]/g, "")
        .replace(/\(소비자용\)/g, "")
        .replace(/\d+(\.\d+)?%DC/gi, "")
        .trim();

      var fileName = _PT.PREFIX + shortName;
      var dcRate = 5,
        dcMul = 1;
      if (isConsumer) {
        dcRate = _pt_parseConsumerDcRateFromName(src.name);
        dcMul = (100 - dcRate) / 100;
        fileName += " (소비자용) " + dcRate + "%DC";
      }

      // 설정탭에서 공식 업체명 읽기
      var officialName = shortName;
      try {
        var settingTab = srcSS.getSheetByName("설정");
        if (settingTab) {
          var sv = settingTab.getRange("B5").getValue();
          if (sv) officialName = String(sv).trim();
        }
      } catch (e) {}

      var newFile = _pt_createTemplateCopy(_PT.TEMPLATE_ID, fileName);
      var ss = SpreadsheetApp.openById(newFile.getId());
      var sheet = ss.getSheets()[0];
      sheet.setName(shortName + " 뷰어");

      try {
        _pt_ensureLocalSettingsTab(ss, officialName, "");
      } catch (e) {}
      _pt_ensureNoticeRowLinked(sheet, hubId);
      _pt_applyRow2(sheet, hubId, isConsumer, K2);
      _pt_clearSpillArea(sheet, isConsumer);
      _pt_applyRow3Formulas(sheet, hubId, isConsumer, dcMul);
      _pt_applyDesign(sheet);
      _pt_applyMetaCells(sheet, hubId, newFile.getId());
      _pt_protectAndHide(sheet);

      // 기존 전용양식 탭 감지 및 복사
      var exclusiveTabName = "";
      var exclusiveHeaders = null;
      var srcAllTabs = srcSS.getSheets();
      for (var ti = 0; ti < srcAllTabs.length; ti++) {
        var tName = srcAllTabs[ti].getName();
        if (tName.indexOf("전용양식") !== -1) {
          exclusiveTabName = tName;
          var lr = srcAllTabs[ti].getLastRow();
          if (lr >= 1) {
            exclusiveHeaders = srcAllTabs[ti]
              .getRange(1, 1, 1, srcAllTabs[ti].getLastColumn())
              .getValues()[0];
          }
          break;
        }
      }

      _pt_createOrderTab(
        ss,
        shortName,
        "",
        sheet.getName(),
        exclusiveHeaders,
        exclusiveTabName,
      );
      created++;
      Logger.log(
        "생성: " +
          fileName +
          " K2=" +
          K2 +
          (exclusiveTabName ? " 전용양식:" + exclusiveTabName : ""),
      );
    } catch (e) {
      errors.push(src.name + ": " + e.message);
    }
  }

  var msg =
    "마이그레이션 완료\n생성: " +
    created +
    "개 / 전체: " +
    srcFiles.length +
    "개\n" +
    (errors.length > 0
      ? "\n오류 " + errors.length + "건:\n" + errors.join("\n")
      : "");
  Logger.log(msg);
  ui.alert(msg);
}

// ═══════════════════════════════════════════
//  취소반품 탭 생성
//  발주양식에서 A열(거래처명) 제거 + 적요 드롭다운
// ═══════════════════════════════════════════
var _PT_CANCEL_TAB_NAME = "취소반품";
var _PT_CANCEL_DROPDOWN = ["반품접수", "반품입고", "취소접수", "취소완료"];

/**
 * 취소반품 탭 생성 (협력업체 파일 내)
 * 발주 헤더에서 A열(거래처명) 제거 → 나머지를 앞으로 당김
 * B열(적요)에 드롭다운 적용
 */
function _pt_createCancelReturnTab_(ss) {
  var tabName = _PT_CANCEL_TAB_NAME;
  var existing = ss.getSheetByName(tabName);
  if (existing) return existing; // 이미 있으면 반환

  // 발주양식 기본 헤더에서 "거래처명" 제거
  var baseHeaders = [
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
    "반품송장번호",
    "비고",
  ];

  var tab = ss.insertSheet(tabName);
  tab.getRange(1, 1, 1, baseHeaders.length).setValues([baseHeaders]);
  tab
    .getRange("1:1")
    .setBackground("#8e44ad")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);

  // 적요 열(I열, 9번째) 드롭다운 적용: 반품접수/반품입고/취소접수/취소완료
  var reasonCol = baseHeaders.indexOf("적요") + 1; // 1-based
  if (reasonCol > 0) {
    var dv = SpreadsheetApp.newDataValidation()
      .requireValueInList(_PT_CANCEL_DROPDOWN, true)
      .setAllowInvalid(false)
      .build();
    tab.getRange(2, reasonCol, 998, 1).setDataValidation(dv);
    // 적요 헤더 강조
    tab.getRange(1, reasonCol).setBackground("#e74c3c").setFontColor("white");
  }

  // 열 너비 조정
  try {
    tab.setColumnWidth(1, 130); // 주문일자
    tab.setColumnWidth(3, 180); // 품목명
    tab.setColumnWidth(7, 250); // 주소
    tab.setColumnWidth(9, 100); // 적요(드롭다운)
    tab.setColumnWidth(10, 150); // 송장번호
    tab.setColumnWidth(13, 150); // 반품송장번호
    tab.setColumnWidth(14, 200); // 비고
  } catch (e) {}

  // 헤더 보호 (1행만)
  try {
    var p = tab.getRange("1:1").protect().setDescription("취소반품 헤더 보호");
    p.setWarningOnly(true);
  } catch (e) {}

  SpreadsheetApp.flush();
  return tab;
}

/** 기존 취소반품 탭에 드롭다운 재적용 (복구용) */
function _pt_repairCancelReturnDropdown_(tab) {
  if (!tab) return;
  var headers = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0];
  var reasonIdx = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === "적요") {
      reasonIdx = i;
      break;
    }
  }
  if (reasonIdx === -1) return;
  var dv = SpreadsheetApp.newDataValidation()
    .requireValueInList(_PT_CANCEL_DROPDOWN, true)
    .setAllowInvalid(false)
    .build();
  tab
    .getRange(2, reasonIdx + 1, Math.max(tab.getMaxRows() - 1, 998), 1)
    .setDataValidation(dv);
}

/**
 * [메뉴] 전체 협력업체 파일에 취소반품 탭 일괄 추가
 */
function partnerCreateCancelReturnTabAll() {
  var ui = SpreadsheetApp.getUi();
  var go = ui.alert(
    "취소반품 탭 일괄 추가",
    "모든 협력업체 파일에 '취소반품' 탭을 추가합니다.\n이미 있는 파일은 스킵됩니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (go !== ui.Button.YES) return;

  var files = _pt_listFiles();
  if (!files || files.length === 0) return ui.alert("협력업체 파일 없음");

  var created = 0,
    skipped = 0,
    errs = [];

  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var existTab = ss.getSheetByName(_PT_CANCEL_TAB_NAME);
      if (existTab) {
        // 드롭다운 복구만 수행
        _pt_repairCancelReturnDropdown_(existTab);
        skipped++;
        continue;
      }
      _pt_createCancelReturnTab_(ss);
      created++;
    } catch (e) {
      errs.push("[" + files[i].name + "] " + e.message);
    }
  }

  ui.alert(
    "✅ 취소반품 탭 일괄 추가 완료\n" +
      "생성: " +
      created +
      "개\n" +
      "이미있음(드롭다운복구): " +
      skipped +
      "개\n" +
      (errs.length > 0 ? "\n⚠ 오류:\n" + errs.slice(0, 5).join("\n") : ""),
  );
}

// ══════════════════════════════════════════════════════════
//  [이식] 전용양식 템플릿 헬퍼
//  출처: orderSyncManager.gs (독립배포 시스템 삭제 전 이식)
//  _pep_createExclusiveFormTab 등에서 typeof 가드로 호출
// ══════════════════════════════════════════════════════════

/** 허브 「업체전용양식마스터」탭 이름 */
var VENDOR_EXCLUSIVE_TEMPLATE_MASTER_SHEET_NAME = "업체전용양식마스터";

/**
 * 코드 내장 업체별 전용양식 헤더 목록.
 * 허브 시트에 별도 마스터 탭이 없어도 이 목록을 우선 사용.
 */
var EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_ = [
  { label: "올팩",    prefix: "AP", headerCsv: "송장번호|적요|보내는사람(지정)|전화번호1(지정)|전화번호2(지정)|우편번호(지정)|주소(지정)|받는사람|전화번호1|전화번호2|우편번호|주소|상품명1|상품상세1|수량(A타입)|배송메시지|운임구분|운임|운송장번호" },
  { label: "아주팩",  prefix: "AJ", headerCsv: "송장번호|적요|보내는분 성명|보내는분 전화번호|보내는분 주소(전체, 분할)|받는분 성명|받는분 전화번호|받는분 주소(전체, 분할)|품목명|박스수량|박스타입|배송메세지1" },
  { label: "코라마",  prefix: "KR", headerCsv: "송장번호|적요|받으시는 분|받는분총주소|받으시는 분 전화|받는분핸드폰|품번|품목명|수량|특기사항|보내시는 분|보내시는 분 전화|지불조건" },
  { label: "태양",    prefix: "TY", headerCsv: "송장번호|적요|고객명|수하인주소|수하인번호|박스수량|택배운임(합계)|운임구분|품목명|배송메세지|송하인명|송하인주소|송하인번호" },
  { label: "팩시스",  prefix: "PS", headerCsv: "주문번호|받는사람|전화번호1|전화번호2|우편번호|주소|상품명1|상품상세1|수량(A타입)|배송메시지|운임구분|운임|운송장번호|송하인명|송하인전화번호|송하인주소" },
  { label: "제이씨",  prefix: "JC", headerCsv: "월/일 (필수입력)|거래처명(주문번호) (필수입력)|품목명 (필수입력)|수량 (필수입력)|수령인 (필수입력)|수령인연락처 (필수입력)|배송지주소 (필수입력)|적요(배송메시지)|보내는분성명 (고정)|보내는분전화번호 (고정)|보내는분주소(전체, 분할) (고정)" },
  { label: "하나팩",  prefix: "HP", headerCsv: "송장번호|적요|보내는사람|전화번호|보내는사람주소|상품명|수량|받는사람|연락처|주소|배송메시지" },
  { label: "뉴파츠_NEW", prefix: "HR", headerCsv: "송장번호|적요|일자|순번|거래처코드|거래처명|담당자|출하창고|거래유형|통화|환율|참조|결제조건|유효기간|납기일자|검색창내용|배송방식|수령인|수령인연락처|배송지주소|적요(배송메시지)|변환품목코드|변환품목명|규격|수량|단가|금액1|외화금액|공급가액|부가세|납기일자|적요" },
  { label: "부원",    prefix: "BW", headerCsv: "송장번호|적요|받는사람|전화번호|주소|우편번호|상품명|수량|배송메세지|보내는사람|주소|전화" },
  { label: "부엉이커피", prefix: "OC", headerCsv: "송장번호|적요|받는사람|전화번호|주소|우편번호|상품명|수량|배송메세지|보내는사람|주소|전화" },
  { label: "지에스",  prefix: "GS", headerCsv: "송장번호|적요|순번|일자-No.|품목코드|품목명|택배박스수량|판매수량|전화|모바일|주소1|배송메시지|합계|거래처명|단품배송비|적요|사방넷주문번호|보내는분|보내는분전화|보내는주소(팩투유)" },
  { label: "그린우드", prefix: "GW", headerCsv: "송장번호|적요|순번|일자-No.|품목코드|품목명|택배박스수량|판매수량|전화|모바일|주소1|배송메시지|합계|거래처명|단품배송비|적요|사방넷주문번호|보내는분|보내는분전화|보내는주소(팩투유)" },
  { label: "냅킨코리아", prefix: "NK", headerCsv: "송장번호|적요|받는사람|전화번호|주소|우편번호|상품명|수량|배송메세지|보내는사람|주소|전화" },
  { label: "인터웍스", prefix: "IW", headerCsv: "송장번호|적요|받는사람|전화번호|주소|우편번호|상품명|박스타입|수량|배송메세지|보내는사람|주소|전화" },
  { label: "후아코리아", prefix: "HU", headerCsv: "송장번호|적요|받는분(필수)|받는분전화번호|휴대폰번호(필수입력)|받는분주소(전체, 분할)필수입력|품목(필수)|배송메세지1|택배수량(필수입력)|운임구분 (신용/착불) 필수입력|운임|보내는분성명(필수)|보내는분전화번호(필수)" },
  { label: "선우",    prefix: "SW", headerCsv: "송장번호|적요|사용안함|보내는분성명|보내는분전화번호|보내는분기타연락처|보내는분우편번호|보내는분주소(전체, 분할)|받는분성명|받는분전화번호|받는분기타연락처|받는분우편번호|받는분주소(전체, 분할)|품목명|내품명|박스수량|배송메세지1|박스타입|운임구분" },
  { label: "로엔그린", prefix: "LG", headerCsv: "송장번호|보내는사람(지정)|전화번호1(지정)|전화번호2(지정)|우편번호(지정)|주소(지정)|받는사람|전화번호1|전화번호2|우편번호|주소|상품명1|상품상세1|수량(A타입)|배송메시지|운임구분 신용.선불.착불|운임|운송장번호|운송장번호" },
];

/** 헤더 문자열 정규화 (공백 제거) */
function normHubMappingHeader_(v) {
  return String(v == null ? "" : v).replace(/\s/g, "");
}

function normVendorExclusiveTemplateKey_(v) {
  return String(v == null ? "" : v).replace(/\s/g, "").toLowerCase();
}

/** 셀 하나에 | 또는 탭으로 구분된 전용양식 헤더 목록 파싱 */
function parseVendorExclusiveHeaderCsv_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return [];
  var parts = s.indexOf("|") !== -1 ? s.split("|") : s.split(/\t/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = String(parts[i]).trim();
    if (p) out.push(p);
  }
  return out;
}

function resolveVendorExclusiveTemplateColumns_(headerRow) {
  var nameIx = -1, csvIx = -1;
  for (var c = 0; c < headerRow.length; c++) {
    var hn = normHubMappingHeader_(headerRow[c]);
    if (!hn) continue;
    if (hn.match(/^맞춤양식명$|^양식명$|^전용양식키$/)) nameIx = c;
    else if (hn.match(/헤더CSV|전용양식헤더|헤더목록|^헤더$/)) csvIx = c;
  }
  if (nameIx === -1) nameIx = 0;
  if (csvIx === -1) csvIx = headerRow.length >= 3 ? 2 : 1;
  return { nameIx: nameIx, csvIx: csvIx };
}

/** 맞춤양식명 일치 시 코드 내장 목록에서 헤더 배열 반환 */
function loadVendorExclusiveTemplateHeadersFromEmbedded_(supplierFormatName) {
  var rows = EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_;
  if (!rows || !rows.length) return null;
  var want = normVendorExclusiveTemplateKey_(supplierFormatName);
  if (!want) return null;
  for (var ri = 0; ri < rows.length; ri++) {
    var er = rows[ri];
    if (!er || typeof er !== "object") continue;
    var label = String(er.label || "").trim();
    if (!label || normVendorExclusiveTemplateKey_(label) !== want) continue;
    var headers = parseVendorExclusiveHeaderCsv_(er.headerCsv);
    if (headers.length) return headers;
  }
  return null;
}

/**
 * 허브 「업체전용양식마스터」에서 맞춤양식명과 같은 행의 헤더 목록.
 * 코드 내장(EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_)이 있으면 시트보다 우선.
 * @returns {string[]|null} 없으면 null (호출측에서 기본 헤더 사용)
 */
function loadVendorExclusiveTemplateHeadersFromHub_(hubSs, supplierFormatName) {
  if (!hubSs || !String(supplierFormatName || "").trim()) return null;
  var fromEmb = loadVendorExclusiveTemplateHeadersFromEmbedded_(supplierFormatName);
  if (fromEmb && fromEmb.length) return fromEmb;
  var sh = hubSs.getSheetByName(VENDOR_EXCLUSIVE_TEMPLATE_MASTER_SHEET_NAME);
  if (!sh) return null;
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) return null;
  var data = sh.getRange(1, 1, lr, lc).getValues();
  var meta = resolveVendorExclusiveTemplateColumns_(data[0]);
  var want = normVendorExclusiveTemplateKey_(supplierFormatName);
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var nm = normVendorExclusiveTemplateKey_(row[meta.nameIx]);
    if (!nm || nm !== want) continue;
    var headers = parseVendorExclusiveHeaderCsv_(row[meta.csvIx]);
    if (headers.length) return headers;
  }
  return null;
}

// ═══════════════════════════════════════════
//  기존 배포 시트 보호 일괄 변환: 강제 잠금 → 경고만(warningOnly)
//  ★ 필터 사용을 위해 1회 실행 필요 (메뉴: AS/진단 > 복구도구)
// ═══════════════════════════════════════════
function partnerMigrateProtectionToWarning() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || files.length === 0) {
    return ui.alert("협력업체 파일이 없습니다.");
  }

  var ok = 0, fail = 0, details = [];

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var shortName = files[fi].name.replace("[협력업체] ", "").trim();
      var tabs = ss.getSheets();
      var converted = [];

      for (var ti = 0; ti < tabs.length; ti++) {
        var tab = tabs[ti];
        var tabName = tab.getName();

        // 단가조회(뷰어) 탭 감지: "뷰어" 포함 또는 첫 번째 탭
        var isViewer = tabName.indexOf("뷰어") !== -1 || ti === 0;
        if (!isViewer) continue;

        // ① 시트 전체 보호(SHEET) → 경고만으로 변환
        var sheetProts = tab.getProtections(SpreadsheetApp.ProtectionType.SHEET);
        for (var si = 0; si < sheetProts.length; si++) {
          if (!sheetProts[si].isWarningOnly()) {
            sheetProts[si].setWarningOnly(true);
            converted.push("시트보호→경고");
          }
        }

        // ② 범위 보호(RANGE) → 경고만으로 변환
        var rangeProts = tab.getProtections(SpreadsheetApp.ProtectionType.RANGE);
        for (var ri = 0; ri < rangeProts.length; ri++) {
          if (!rangeProts[ri].isWarningOnly()) {
            rangeProts[ri].setWarningOnly(true);
            converted.push("범위보호→경고");
          }
        }
      }

      if (converted.length > 0) {
        details.push("✅ " + shortName + " (" + converted.length + "건 변환)");
      } else {
        details.push("⏭ " + shortName + " (변환 불필요)");
      }
      ok++;
    } catch (e) {
      fail++;
      details.push(
        "❌ " + files[fi].name.replace("[협력업체] ", "") +
        ": " + String(e.message || "").substring(0, 40),
      );
    }
  }

  var msg =
    "🔓 단가조회 보호 → 경고만 일괄 변환 완료\n\n" +
    "성공: " + ok + "개" + (fail > 0 ? ", 실패: " + fail + "개" : "") +
    "\n\n" + details.join("\n");
  ui.alert("보호 변환 결과", msg, ui.ButtonSet.OK);
}
