/**
 * [협력업체] 명세서 정리 — 탭 생성
 * 파일: _partnerStatementDeploy.gs
 */

var _PSTMT_VER_ = "v1";

var _PSTMT_TAB_SETTINGS = "명세서_설정";
var _PSTMT_TAB_RAW = "명세서_원본";
var _PSTMT_TAB_CANON = "명세서_파싱";
var _PSTMT_TAB_RESULT = "명세서_정리";
var _PSTMT_TAB_MIRROR = "명세서_팩투유명세";
var _PSTMT_TAB_ECOUNT = "명세서_이카구매";
var _PSTMT_TAB_SUMMARY = "명세서_비교결과";
var _PSTMT_TAB_LOG = "명세서_오류로그";

var _PSTMT_CANON_HEADERS_ = [
  "행",
  "일자",
  "공급사품목명",
  "규격",
  "수량",
  "단가_VAT별도",
  "공급가액",
  "부가세",
  "단가_VAT포함",
  "금액_VAT포함",
  "송장번호",
  "수취인",
  "행유형",
  "입력채널",
];

var _PSTMT_RESULT_HEADERS_ = [
  "상태",
  "매칭키",
  "송장번호",
  "고유ID",
  "이카운트코드",
  "우리품목명",
  "공급사품목명",
  "수량_명세",
  "수량_전용양식",
  "수량_마감",
  "단가_명세_VAT포함",
  "단가_견적_VAT포함",
  "단가차",
  "금액_명세",
  "금액_견적",
  "금액차",
  "수취인_명세",
  "원천일치",
  "비고",
];

var _PSTMT_MIRROR_HEADERS_ = [
  "일자",
  "품목명_팩투유",
  "이카운트코드",
  "규격",
  "수량",
  "단가_명세_VAT포함",
  "단가_견적_VAT포함",
  "단가차",
  "공급가액_견적기준",
  "부가세_견적기준",
  "합계_VAT포함",
  "송장번호",
  "비고",
];

/** 이카운트 구매발주 업로드 — HR 전용양식 C~AF (30열) */
var _PSTMT_ECOUNT_PURCHASE_HEADERS_ = [
  "일자",
  "순번",
  "거래처코드",
  "거래처명",
  "담당자",
  "출하창고",
  "거래유형",
  "통화",
  "환율",
  "참조",
  "결제조건",
  "유효기간",
  "납기일자",
  "검색창내용",
  "배송방식",
  "수령인",
  "수령인연락처",
  "배송지주소",
  "적요(배송메시지)",
  "품목코드",
  "품목명",
  "규격",
  "수량",
  "단가",
  "금액1",
  "외화금액",
  "공급가액",
  "부가세",
  "납기일자",
  "적요",
];

// ═══════════════════════════════════════════
//  메뉴
// ═══════════════════════════════════════════

/** 현재 스프레드시트에 명세서 탭군 생성 */
function partnerCreateStatementTabs() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var r = _pstmt_ensureAllTabs_(ss, true);
    ui.alert(
      "✅ 명세서 탭 생성 완료",
      "생성: " + (r.created.length ? r.created.join(", ") : "(없음)") +
        "\n기존: " + (r.existing.length ? r.existing.join(", ") : "(없음)") +
        "\n\n「" + _PSTMT_TAB_RAW + "」에 명세 붙여넣기 → 메뉴 ② 파싱 → ③ 비교",
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("❌ 탭 생성 실패: " + (e.message || e));
  }
}

/** 전체 협력업체 파일에 탭 생성 */
function partnerCreateStatementTabsAll() {
  var ui = SpreadsheetApp.getUi();
  if (
    ui.alert(
      "전체 업체 명세서 탭",
      "협력업체 폴더 전체 파일에 명세서 탭을 생성합니다.\n계속할까요?",
      ui.ButtonSet.YES_NO
    ) !== ui.ButtonSet.YES
  ) {
    return;
  }
  var files = _pt_listFiles();
  var ok = 0;
  var fail = 0;
  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      _pstmt_ensureAllTabs_(ss, false);
      ok++;
    } catch (e) {
      fail++;
      Logger.log("[PSTMT] 탭 생성 실패 " + files[i].name + ": " + e.message);
    }
  }
  ui.alert("완료", "성공 " + ok + " · 실패 " + fail, ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  내부
// ═══════════════════════════════════════════

function _pstmt_ensureAllTabs_(ss, activate) {
  var created = [];
  var existing = [];

  var specs = [
    { name: _PSTMT_TAB_SETTINGS, color: "#5c6bc0", init: _pstmt_initSettingsTab_ },
    { name: _PSTMT_TAB_RAW, color: "#78909c", init: _pstmt_initRawTab_ },
    { name: _PSTMT_TAB_CANON, color: "#00897b", init: _pstmt_initCanonTab_ },
    { name: _PSTMT_TAB_RESULT, color: "#1565c0", init: _pstmt_initResultTab_ },
    { name: _PSTMT_TAB_MIRROR, color: "#6a1b9a", init: _pstmt_initMirrorTab_ },
    { name: _PSTMT_TAB_ECOUNT, color: "#ef6c00", init: _pstmt_initEcountTab_ },
    { name: _PSTMT_TAB_SUMMARY, color: "#455a64", init: _pstmt_initSummaryTab_ },
    { name: _PSTMT_TAB_LOG, color: "#37474f", init: _pstmt_initLogTab_ },
  ];

  for (var si = 0; si < specs.length; si++) {
    var sp = specs[si];
    var tab = ss.getSheetByName(sp.name);
    if (!tab) {
      tab = ss.insertSheet(sp.name);
      created.push(sp.name);
    } else {
      existing.push(sp.name);
    }
    try {
      tab.setTabColor(sp.color);
    } catch (eC) {}
    sp.init(tab, ss);
  }

  if (activate) {
    try {
      ss.setActiveSheet(ss.getSheetByName(_PSTMT_TAB_RAW));
    } catch (eA) {}
  }

  return { created: created, existing: existing };
}

function _pstmt_initSettingsTab_(tab) {
  tab.clear();
  // ★ 2026-08-31 버그수정: "A1:B20"(20행)에 18행 배열을 넣어 setValues 가 예외를 던졌다.
  //   이 함수는 탭 생성 루프의 첫 번째라, 죽으면 「명세서_설정」만 빈 채로 남고
  //   나머지 7개 탭은 아예 안 만들어진다. 행수는 배열에서 세어 쓴다.
  var rows = [
    ["명세서 정리 설정", ""],
    ["대상월 (yyyy-MM)", _pstmt_defaultMonth_()],
    ["공급사 prefix", ""],
    ["VAT 기준", "포함"],
    ["단가 허용오차(원)", "1"],
    ["수량 허용오차", "0"],
    ["비교 원천", "전용양식+마감"],
    ["프로필 ID", "GENERIC_거래명세서_v1"],
    ["입력 채널", "paste"],
    ["", ""],
    ["거래처명(SSOT)", "=IFERROR('설정'!B5,\"\")"],
    ["CUST_CD(SSOT)", "=IFERROR('설정'!B6,\"\")"],
    ["모듈 버전", _PSTMT_VER_],
    ["", ""],
    ["안내", "명세서_원본에 붙여넣기 → ②파싱 → ③비교"],
    ["", ""],
    ["Gmail 수집", "발신업체 미정 — 범용 첨부만 수집"],
    ["처리라벨", "P2U_명세처리완료"],
  ];
  tab.getRange(1, 1, rows.length, 2).setValues(rows);
  tab.getRange(1, 1, rows.length, 1).setFontWeight("bold");
  tab.getRange("B2:B9").setNumberFormat("@");
  tab.setColumnWidth(1, 180);
  tab.setColumnWidth(2, 220);
  tab.setFrozenRows(1);
}

function _pstmt_initRawTab_(tab) {
  if (tab.getLastRow() > 1) return;
  tab.clear();
  tab.getRange(1, 1, 1, 8).setValues([[
    "일자", "품목명", "규격", "BOX", "수량", "단가", "공급가액", "부가세",
  ]]).setFontWeight("bold").setBackground("#eceff1");
  tab.setFrozenRows(1);
}

function _pstmt_initCanonTab_(tab) {
  tab.clear();
  _pstmt_writeHeaderRow_(tab, _PSTMT_CANON_HEADERS_, "#00897b");
}

function _pstmt_initResultTab_(tab) {
  tab.clear();
  _pstmt_writeHeaderRow_(tab, _PSTMT_RESULT_HEADERS_, "#1565c0");
}

function _pstmt_initMirrorTab_(tab) {
  tab.clear();
  _pstmt_writeHeaderRow_(tab, _PSTMT_MIRROR_HEADERS_, "#6a1b9a");
}

function _pstmt_initEcountTab_(tab) {
  tab.clear();
  _pstmt_writeHeaderRow_(tab, _PSTMT_ECOUNT_PURCHASE_HEADERS_, "#ef6c00");
  tab.getRange(2, 1).setNote("이카운트 PC 구매입력 화면에 붙여넣기 (API 업로드 아님)");
}

function _pstmt_initSummaryTab_(tab) {
  tab.clear();
  tab.getRange("A1:B12").setValues([
    ["명세서 비교 요약", ""],
    ["실행시각", ""],
    ["파싱 행수", ""],
    ["명세 공급가 합", ""],
    ["명세 VAT포함 합", ""],
    ["견적 VAT포함 합", ""],
    ["단가차 합", ""],
    ["전용양식 매칭", ""],
    ["마감 매칭", ""],
    ["미매핑 품목", ""],
    ["합계검증", ""],
    ["비고", ""],
  ]);
  tab.getRange("A1:A12").setFontWeight("bold");
}

function _pstmt_initLogTab_(tab) {
  tab.clear();
  _pstmt_writeHeaderRow_(tab, ["시각", "단계", "메시지"], "#37474f");
}

function _pstmt_writeHeaderRow_(tab, headers, color) {
  tab.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold")
    .setBackground(color || "#455a64")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);
}

function _pstmt_defaultMonth_() {
  var d = new Date();
  return Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM");
}

function _pstmt_readSettings_(ss) {
  var tab = ss.getSheetByName(_PSTMT_TAB_SETTINGS);
  if (!tab) throw new Error("「" + _PSTMT_TAB_SETTINGS + "」탭이 없습니다. ① 탭 생성을 실행하세요.");
  return {
    month: String(tab.getRange("B2").getDisplayValue() || "").trim(),
    prefix: String(tab.getRange("B3").getDisplayValue() || "").trim().toUpperCase(),
    vatMode: String(tab.getRange("B4").getDisplayValue() || "포함").trim(),
    priceTol: parseFloat(tab.getRange("B5").getDisplayValue()) || 1,
    qtyTol: parseFloat(tab.getRange("B6").getDisplayValue()) || 0,
    compareSource: String(tab.getRange("B7").getDisplayValue() || "전용양식+마감").trim(),
    profileId: String(tab.getRange("B8").getDisplayValue() || "GENERIC_거래명세서_v1").trim(),
    inputChannel: String(tab.getRange("B9").getDisplayValue() || "paste").trim(),
    vendorName: String(tab.getRange("B11").getDisplayValue() || "").trim(),
    custCd: String(tab.getRange("B12").getDisplayValue() || "").trim(),
  };
}

function _pstmt_parseTargetMonth_(monthStr) {
  var m = String(monthStr || "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m) {
    var d = new Date();
    return { yyyy: d.getFullYear(), m: d.getMonth() + 1, label: _pstmt_defaultMonth_() };
  }
  return {
    yyyy: parseInt(m[1], 10),
    m: parseInt(m[2], 10),
    label: m[1] + "-" + ("0" + m[2]).slice(-2),
  };
}

function _pstmt_archiveTabName_(yyyy, m) {
  return "(" + yyyy + "년 " + m + "월) 전용발주 마감";
}

function _pstmt_log_(ss, step, msg) {
  try {
    var tab = ss.getSheetByName(_PSTMT_TAB_LOG);
    if (!tab) return;
    var ts = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    tab.appendRow([ts, step, String(msg || "").substring(0, 500)]);
  } catch (e) {}
}

function _pstmt_findSheetByNameContains_(ss, needle) {
  var tabs = ss.getSheets();
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getName().indexOf(needle) !== -1) return tabs[i];
  }
  return null;
}

function _pstmt_findViewerTab_(ss) {
  var tabs = ss.getSheets();
  for (var i = 0; i < tabs.length; i++) {
    var n = tabs[i].getName();
    if (n.indexOf("단가조회") !== -1 || n.indexOf("뷰어") !== -1) return tabs[i];
  }
  return null;
}
