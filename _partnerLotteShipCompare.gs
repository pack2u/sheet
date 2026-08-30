/**
 * [협력업체] 롯데택배 운임 ↔ 상품정보 책정배송비 비교
 * 파일: _partnerLotteShipCompare.gs
 *
 * 독립 스프레드시트:
 *   폴더: 협력업체 폴더 / 롯데택배-배송비비교
 *   파일: [검증] 롯데택배-배송비비교
 *
 * 레이아웃:
 *   1행 — 합계 요약 (운임합계 / 책정합계 / 차이합계 / 건수)
 *   2행 — 같은상품·다른운임 요약 (상세는「같은상품_다른운임」탭)
 *   3행~ — 롯데택배 내역 붙여넣기 (헤더 포함 가능, 하단 이어붙이기 OK)
 *   탭「같은상품_다른운임」— 동일상품 다른 운임 상세 + 비교시트 행번호
 *
 * 매칭:
 *   롯데 AK(상품명) ↔ 상품정보 C(상품명)
 *   이름 정규화: ---법인/채널, ---합포장, ---합배송 등 접미사 제거 (---뚜껑만/몸통만 유지)
 *                상품정보「대리발송」포함 품목은 매칭 제외
 *                상품명「샘플」또는「합배송」(===합배송 포함) 시 책정배송비 기본 1,900원
 *   금액: 롯데 AB(운임합계) ↔ 상품정보 Q(책정배송비)
 *   결과 AD: "3,600(-300)" = 책정배송비(책정−롯데운임)
 */

var _PLS_FOLDER_NAME = "롯데택배-배송비비교";
var _PLS_FILE_NAME = "[검증] 롯데택배-배송비비교";
var _PLS_TAB_NAME = "롯데택배_비교";
var _PLS_VARY_TAB = "같은상품_다른운임";
var _PLS_PROP_SS = "PLS_COMPARE_SS_ID";
var _PLS_BOUND_SCRIPT_PREFIX = "PLS_BOUND_SCRIPT_";
var _PLS_HUB_LIBRARY_ID = "192tojXvo5GfhIJoHXo7UbmSMbNjpUjfx2nEUAz56kacKaQrDXoSMLC7i";

var _PLS_DATA_START = 3; // 1-based
var _PLS_RESULT_COL = 30; // AD
var _PLS_FEE_COL = 28; // AB 운임합계
var _PLS_NAME_COL = 37; // AK 상품명
var _PLS_PRODUCT_NAME_COL = 3; // C
var _PLS_PRODUCT_SHIP_COL = 17; // Q
var _PLS_PRODUCT_DATA_START = 6; // 상품정보 데이터 시작 행
var _PLS_SAMPLE_BOOK_FEE = 1900; // 샘플 / ===합배송 책정배송비 기본값
var _PLS_UNMATCH_BG = "#f8bbd0"; // 미매칭 행 핑크
var _PLS_MATCH_AD_BG = "#c8e6c9"; // 매칭 AD 연한 그린

// ═══════════════════════════════════════════
//  메뉴 진입점
// ═══════════════════════════════════════════

/** ① 비교시트 만들기/열기 */
function partnerOpenLotteShipCompareSheet() {
  var ui = SpreadsheetApp.getUi();
  try {
    var created = _pls_getOrCreateCompareSs_();
    _pls_ensureLayout_(created.ss);
    var menuOk = false;
    var menuErr = "";
    try {
      menuOk = !!_pls_installBoundScript_(created.ss);
    } catch (eInst) {
      menuErr = String(eInst.message || eInst);
      Logger.log("[PLS] 로컬메뉴 설치 실패: " + menuErr);
    }
    ui.alert(
      "✅ 롯데택배 배송비 비교시트",
      (created.isNew ? "신규 생성\n" : "기존 시트 열기\n") +
        created.ss.getUrl() +
        "\n\n사용법:\n" +
        "1) 3행부터 롯데택배 내역 붙여넣기 (헤더 포함 OK)\n" +
        "2) 이후 데이터는 하단에 이어서 추가\n" +
        "3) 비교시트 메뉴「📦 롯데택배 배송비 → ▶ 비교 실행」\n" +
        "4) AD열에 책정배송비(차이) 표기 — 예: 3,600(-300)\n\n" +
        (menuOk
          ? "※ 비교시트를 새로고침(F5)하면 독립 메뉴가 보입니다."
          : "※ 로컬메뉴 설치 실패 — 허브에서「🔧 비교시트 로컬메뉴 설치」를 다시 실행하세요.\n" +
            (menuErr ? menuErr : "")),
      ui.ButtonSet.OK
    );
    try {
      var html = HtmlService.createHtmlOutput(
        '<script>window.open("' + created.ss.getUrl() + '");google.script.host.close();</script>'
      ).setWidth(100).setHeight(50);
      ui.showModalDialog(html, "비교시트 열기");
    } catch (eOpen) {}
  } catch (e) {
    ui.alert("비교시트 열기 실패", String(e.message || e), ui.ButtonSet.OK);
  }
}

/** ② 비교 실행 (허브 또는 비교시트에서) */
function partnerRunLotteShipCompare() {
  var ui = SpreadsheetApp.getUi();
  var ss = _pls_resolveCompareSs_();
  if (!ss) return;
  try {
    var result = _pls_runCompareOnSs_(ss);
    ui.alert(
      "✅ 롯데택배 배송비 비교 완료",
      "신규 비교(AD기록) " + result.wrote + "건 / 기존 AD 유지 " + result.kept + "건\n" +
        "비교 " + result.matched + "건 / 미매칭 " + result.unmatched + "건 / 스킵 " + result.skipped + "건\n\n" +
        "운임합계(롯데): " + _pls_fmtNum_(result.sumLotte) + "원\n" +
        "책정배송비 합계: " + _pls_fmtNum_(result.sumBook) + "원\n" +
        "차이 합계(책정−롯데): " + _pls_fmtNum_(result.sumDiff) + "원\n\n" +
        "※ AD에 비교결과가 있는 행은 건너뛰고, 추가분만 비교합니다.\n" +
        "  전체 재비교가 필요하면 해당 AD를 지운 뒤 다시 실행하세요.",
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("비교 실패", String(e.message || e), ui.ButtonSet.OK);
  }
}

/** 비교시트 로컬 메뉴용 */
function partnerLotteShipCompareOnActive() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!_pls_isCompareSpreadsheet_(ss)) {
    return ui.alert("이 메뉴는 「[검증] 롯데택배-배송비비교」시트에서만 사용할 수 있습니다.");
  }
  try {
    var result = _pls_runCompareOnSs_(ss);
    ui.alert(
      "✅ 비교 완료",
      "신규AD " + result.wrote + "건 / 유지 " + result.kept + "건\n" +
        "비교 " + result.matched + "건 / 미매칭 " + result.unmatched + "건\n" +
        "운임합계 " + _pls_fmtNum_(result.sumLotte) + "원  |  책정합계 " + _pls_fmtNum_(result.sumBook) + "원  |  차이합계 " + _pls_fmtNum_(result.sumDiff) + "원",
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("비교 실패", String(e.message || e), ui.ButtonSet.OK);
  }
}

/** 🔧 로컬메뉴 재설치 */
function partnerInstallLotteShipCompareMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    var created = _pls_getOrCreateCompareSs_();
    _pls_ensureLayout_(created.ss);
    _pls_installBoundScript_(created.ss);
    ui.alert(
      "로컬메뉴 설치 완료",
      "비교시트를 새로고침(F5)하면「📦 롯데택배 배송비」메뉴가 보입니다.\n" + created.ss.getUrl(),
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("설치 실패", String(e.message || e), ui.ButtonSet.OK);
  }
}

// ═══════════════════════════════════════════
//  시트 생성 / 레이아웃
// ═══════════════════════════════════════════

function _pls_getVerifyFolder_() {
  var parentId = (typeof _PT !== "undefined" && _PT.FOLDER_ID) ? _PT.FOLDER_ID : null;
  if (!parentId) throw new Error("협력업체 폴더 ID 없음 (_PT.FOLDER_ID)");
  var parent = DriveApp.getFolderById(parentId);
  var it = parent.getFoldersByName(_PLS_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return parent.createFolder(_PLS_FOLDER_NAME);
}

function _pls_getOrCreateCompareSs_() {
  var props = PropertiesService.getScriptProperties();
  var savedId = String(props.getProperty(_PLS_PROP_SS) || "").trim();
  if (savedId) {
    try {
      var ss0 = SpreadsheetApp.openById(savedId);
      return { ss: ss0, isNew: false };
    } catch (e0) {
      props.deleteProperty(_PLS_PROP_SS);
    }
  }

  // 폴더 내 동일 이름 검색
  try {
    var folder = _pls_getVerifyFolder_();
    var files = folder.getFilesByName(_PLS_FILE_NAME);
    if (files.hasNext()) {
      var f = files.next();
      props.setProperty(_PLS_PROP_SS, f.getId());
      return { ss: SpreadsheetApp.openById(f.getId()), isNew: false };
    }
  } catch (eFind) {}

  var ss = SpreadsheetApp.create(_PLS_FILE_NAME);
  var newId = ss.getId();
  props.setProperty(_PLS_PROP_SS, newId);
  try {
    var folder2 = _pls_getVerifyFolder_();
    var newFile = DriveApp.getFileById(newId);
    folder2.addFile(newFile);
    try { DriveApp.getRootFolder().removeFile(newFile); } catch (eRm) {}
  } catch (eMove) {}
  return { ss: ss, isNew: true };
}

function _pls_isCompareSpreadsheet_(ss) {
  if (!ss) return false;
  var name = String(ss.getName() || "");
  return name.indexOf(_PLS_FILE_NAME) === 0 || name.indexOf("[검증] 롯데택배") === 0;
}

function _pls_resolveCompareSs_() {
  var ui = SpreadsheetApp.getUi();
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (active && _pls_isCompareSpreadsheet_(active)) return active;

  try {
    var created = _pls_getOrCreateCompareSs_();
    _pls_ensureLayout_(created.ss);
    return created.ss;
  } catch (e2) {
    ui.alert("비교시트를 열 수 없습니다.\n먼저「① 비교시트 만들기/열기」를 실행하세요.\n" + e2.message);
    return null;
  }
}

function _pls_ensureLayout_(ss) {
  var tab = ss.getSheetByName(_PLS_TAB_NAME);
  if (!tab) {
    tab = ss.getSheets()[0];
    tab.setName(_PLS_TAB_NAME);
  }
  try { tab.setTabColor("#1565c0"); } catch (eC) {}

  // 최소 열 확보 (AK=37, AD=30)
  if (tab.getMaxColumns() < 40) {
    tab.insertColumnsAfter(tab.getMaxColumns(), 40 - tab.getMaxColumns());
  }

  var a1 = String(tab.getRange(1, 1).getDisplayValue() || "");
  if (!a1 || a1.indexOf("롯데택배") === -1) {
    tab.getRange(1, 1, 1, _PLS_RESULT_COL).merge()
      .setValue(
        "롯데택배 배송비 비교  |  책정합계 0원  |  차이합계 0원  |  비교 0건 / 미매칭 0건  |  " +
          "3행부터 롯데 내역 붙여넣기 → 메뉴「비교 실행」→ AD열=책정배송비(차이)"
      )
      .setBackground("#1565c0").setFontColor("white").setFontWeight("bold")
      .setFontSize(11).setVerticalAlignment("middle");
    try { tab.setRowHeight(1, 36); } catch (eH) {}
  }

  // 2행: 같은상품·다른운임 요약 (상세는 별도 탭)
  var a2 = String(tab.getRange(2, 1).getDisplayValue() || "");
  if (!a2 || a2.indexOf("같은상품") === -1) {
    tab.getRange(2, 1, 1, _PLS_RESULT_COL).merge()
      .setValue("같은상품·다른운임: 비교 실행 후「" + _PLS_VARY_TAB + "」탭에서 확인")
      .setBackground("#fff8e1").setFontColor("#e65100").setFontWeight("bold")
      .setVerticalAlignment("middle").setWrap(true);
  }
  try { tab.setRowHeight(2, 28); } catch (eH2) {}

  // 3행이 완전 비어 있으면 안내
  var r3 = String(tab.getRange(3, 1).getDisplayValue() || "").trim();
  var r3ak = String(tab.getRange(3, _PLS_NAME_COL).getDisplayValue() || "").trim();
  if (!r3 && !r3ak) {
    tab.getRange(3, 1).setValue(
      "↓ 여기에 롯데택배 내역을 붙여넣으세요 (1행 헤더 포함 가능). 이후에는 이 시트 맨 아래에 이어서 추가하세요."
    ).setFontColor("#666666").setFontStyle("italic");
  }

  try { tab.setFrozenRows(2); } catch (eF) {}
  try {
    tab.setColumnWidth(_PLS_FEE_COL, 90);
    tab.setColumnWidth(_PLS_NAME_COL, 280);
    tab.setColumnWidth(_PLS_RESULT_COL, 140);
  } catch (eW) {}

  // Sheet1 등 정리
  try {
    var sheets = ss.getSheets();
    for (var i = sheets.length - 1; i >= 0; i--) {
      var n = sheets[i].getName();
      if (n !== _PLS_TAB_NAME && sheets.length > 1 && (n === "시트1" || n === "Sheet1")) {
        try { ss.deleteSheet(sheets[i]); } catch (eD) {}
      }
    }
  } catch (eClean) {}
}

// ═══════════════════════════════════════════
//  비교 엔진
// ═══════════════════════════════════════════

/**
 * 채널/비고/합포 접미사인지 (매칭키에서 제거 대상)
 * 예: 법인/배민상회, 2개 합포장(완박스), 합배송, ★뚜껑만 1줄★
 * 유지: 정확히 "뚜껑만", "몸통만" 상품옵션
 */
function _pls_isChannelSuffix_(tail) {
  var t = String(tail == null ? "" : tail).replace(/\u00a0/g, " ").trim();
  if (!t) return true;
  // 상품옵션은 유지
  if (t === "뚜껑만" || t === "몸통만") return false;

  if (t.indexOf("법인") !== -1) return true;
  if (t.indexOf("합포장") !== -1) return true;
  if (t.indexOf("합배송") !== -1) return true;
  if (t.indexOf("완박스") !== -1) return true;
  if (t.indexOf("/") !== -1) return true;
  // ★뚜껑만 1줄★ / ★뚜껑만 출고★ 등 (옵션 문구+장식)
  if (t.indexOf("★") !== -1) return true;
  if (t.indexOf("뚜껑만") !== -1 && t !== "뚜껑만") return true;
  if (t.indexOf("몸통만") !== -1 && t !== "몸통만") return true;
  if (/^(스마트스토어|쿠팡|자사몰|지마켓|배민|오너클랜|배달의민족|소분)/.test(t)) return true;
  return false;
}

/**
 * 상품명 정규화
 * - "개 --- 몸통만" / "개---몸통만" 공백 통일
 * - ★뚜껑만 출고★ 등 → ---뚜껑만 / ---몸통만 (이미 있으면 중복 제거)
 * - --★ … 비고는 무조건 제거
 * - 채널/합포/합배송 접미사 제거
 */
function _pls_normProductName_(name) {
  var s = String(name == null ? "" : name).replace(/\u00a0/g, " ").trim();
  if (!s) return "";

  // --- 주변 공백 통일 (미매칭 주원인: "200개 --- 몸통만" vs "200개---몸통만")
  s = s.replace(/\s*-{3,}\s*/g, "---");

  // ★뚜껑만/몸통만 장식 → 표준 옵션 (--★ / ---★)
  // 예: ...---몸통만---★몸통만 출고★ → ...---몸통만---몸통만 → 아래에서 중복 축소
  s = s.replace(/-{2,}\s*★+\s*뚜껑만[^★]*★+/g, "---뚜껑만");
  s = s.replace(/-{2,}\s*★+\s*몸통만[^★]*★+/g, "---몸통만");
  s = s.replace(/---뚜껑만\s*\d+\s*줄/g, "---뚜껑만");
  s = s.replace(/---뚜껑만\s*출고/g, "---뚜껑만");
  s = s.replace(/---몸통만\s*출고/g, "---몸통만");
  // 연속 중복 옵션 제거: ---몸통만---몸통만 → ---몸통만
  s = s.replace(/(---뚜껑만)+/g, "---뚜껑만");
  s = s.replace(/(---몸통만)+/g, "---몸통만");

  // --★ 가 들어가면 그 지점부터 끝까지 무조건 무시
  s = s.replace(/\s*-{2,}★.*$/g, "").replace(/\s+$/g, "");

  // ===합배송 / +++비고 등 끝 접미사 정리 (요금판정은 rawName에서 합배송 여부 별도 확인)
  s = s.replace(/={2,}.*$/g, "").replace(/\s+$/g, "");
  s = s.replace(/\+{3,}.*$/g, "").replace(/\s+$/g, "");

  while (true) {
    var idx = s.lastIndexOf("---");
    if (idx < 0) break;
    var tail = s.substring(idx + 3).replace(/\u00a0/g, " ").trim();
    if (_pls_isChannelSuffix_(tail)) {
      s = s.substring(0, idx).replace(/\s+$/g, "");
      continue;
    }
    break;
  }
  s = s.replace(/\+{3,}.*$/g, "").replace(/\s+$/g, "");
  s = s.replace(/\s*-{3,}\s*/g, "---");
  // 채널 제거 후에도 옵션 중복이 남으면 한 번 더
  s = s.replace(/(---뚜껑만)+/g, "---뚜껑만");
  s = s.replace(/(---몸통만)+/g, "---몸통만");
  return s.replace(/\s+/g, " ").trim();
}

/** 상품정보 대리발송용 품목 제외 */
function _pls_isProxyOnlyProductName_(name) {
  return String(name == null ? "" : name).indexOf("대리발송") !== -1;
}

/** 샘플 품목 — 책정배송비 기본 1,900원 */
function _pls_isSampleProductName_(name) {
  return String(name == null ? "" : name).indexOf("샘플") !== -1;
}

/** ===합배송 등 — 책정배송비 기본 1,900원 (원본 상품명 기준) */
function _pls_isHapbaesongProductName_(name) {
  return String(name == null ? "" : name).indexOf("합배송") !== -1;
}

function _pls_resolveBookFee_(key, rawName, prodMap) {
  if (_pls_isSampleProductName_(rawName) || _pls_isSampleProductName_(key)) {
    return { book: _PLS_SAMPLE_BOOK_FEE, sample: true };
  }
  // ===합배송 은 정규화에서 잘리므로 rawName으로 판정
  if (_pls_isHapbaesongProductName_(rawName)) {
    return { book: _PLS_SAMPLE_BOOK_FEE, hapbaesong: true };
  }
  if (prodMap[key] == null) return { book: null, sample: false };
  return { book: _pls_toNumber_(prodMap[key]), sample: false };
}

function _pls_toNumber_(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  var s = String(v == null ? "" : v)
    .replace(/,/g, "")
    .replace(/원/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!s || s.charAt(0) === "#") return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function _pls_fmtNum_(n) {
  var x = Math.round(_pls_toNumber_(n));
  var sign = x < 0 ? "-" : "";
  var abs = Math.abs(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + abs;
}

function _pls_formatResult_(bookFee, diff) {
  var d = Math.round(diff);
  var dStr = d > 0 ? ("(+" + _pls_fmtNum_(d) + ")") : ("(" + _pls_fmtNum_(d) + ")");
  return _pls_fmtNum_(bookFee) + dStr;
}

function _pls_loadProductShipMap_() {
  var infoId = (typeof _PT !== "undefined" && _PT.INFO_SS_ID) ? _PT.INFO_SS_ID : "";
  if (!infoId) throw new Error("상품정보 시트 ID 없음 (_PT.INFO_SS_ID)");
  var ss = SpreadsheetApp.openById(infoId);
  var tab = ss.getSheetByName("상품정보");
  if (!tab) throw new Error("「상품정보」탭을 찾을 수 없습니다.");

  var lr = tab.getLastRow();
  if (lr < _PLS_PRODUCT_DATA_START) return { map: {}, count: 0 };

  var n = lr - _PLS_PRODUCT_DATA_START + 1;
  var names = tab.getRange(_PLS_PRODUCT_DATA_START, _PLS_PRODUCT_NAME_COL, n, 1).getDisplayValues();
  var fees = tab.getRange(_PLS_PRODUCT_DATA_START, _PLS_PRODUCT_SHIP_COL, n, 1).getValues();
  var map = {};
  var count = 0;
  var skippedProxy = 0;
  for (var i = 0; i < names.length; i++) {
    var rawName = names[i][0];
    if (_pls_isProxyOnlyProductName_(rawName)) {
      skippedProxy++;
      continue;
    }
    var key = _pls_normProductName_(rawName);
    if (!key) continue;
    if (map[key] == null) {
      map[key] = _pls_toNumber_(fees[i][0]);
      count++;
    }
  }
  return { map: map, count: count, skippedProxy: skippedProxy };
}

function _pls_isHeaderLikeRow_(nameVal, feeVal) {
  var n = String(nameVal || "").replace(/\s/g, "");
  var f = String(feeVal || "").replace(/\s/g, "");
  if (n === "상품명" || n.indexOf("상품명") === 0) return true;
  if (f === "운임합계" || f.indexOf("운임") !== -1 && f.indexOf("합계") !== -1) return true;
  if (n.indexOf("붙여넣") !== -1 || n.indexOf("여기에") === 0) return true;
  return false;
}

/**
 * AD열이 이미 비교 결과인지
 * - 예: 3,600(-300) / 미매칭 / 상품명없음
 * - 롯데 원본 AD(고정수하인코드 등)는 false → 재비교
 */
function _pls_isCompareResultAd_(v) {
  var s = String(v == null ? "" : v).replace(/\s/g, "").trim();
  if (!s) return false;
  if (s === "미매칭" || s === "상품명없음") return true;
  return /^[\d,]+(\([+\-]?[\d,]+\))$/.test(s);
}

/** AD 부분 쓰기 (연속 구간만 setValues) */
function _pls_writeAdUpdates_(tab, updates) {
  if (!updates || !updates.length) return;
  updates.sort(function (a, b) { return a.row - b.row; });

  function flush_(start, vals) {
    var rng = tab.getRange(start, _PLS_RESULT_COL, vals.length, 1);
    rng.setValues(vals);
    try { rng.setHorizontalAlignment("right").setFontWeight("bold"); } catch (eFmt) {}
  }

  var start = updates[0].row;
  var vals = [[updates[0].value]];
  for (var i = 1; i < updates.length; i++) {
    var u = updates[i];
    if (u.row === start + vals.length) {
      vals.push([u.value]);
    } else {
      flush_(start, vals);
      start = u.row;
      vals = [[u.value]];
    }
  }
  flush_(start, vals);
}

/**
 * 미매칭 행 전체 핑크 / 매칭 행은 배경 초기화 + AD만 연한 그린
 * paints: [{row, pink:boolean}, ...]
 */
function _pls_paintCompareRows_(tab, paints, colWidth) {
  if (!paints || !paints.length) return;
  var w = Math.max(colWidth || _PLS_NAME_COL, _PLS_RESULT_COL, _PLS_NAME_COL);
  paints.sort(function (a, b) { return a.row - b.row; });

  function flush_(start, n, pink) {
    try {
      var rng = tab.getRange(start, 1, n, w);
      if (pink) {
        rng.setBackground(_PLS_UNMATCH_BG);
      } else {
        rng.setBackground(null);
        tab.getRange(start, _PLS_RESULT_COL, n, 1).setBackground(_PLS_MATCH_AD_BG);
      }
    } catch (eBg) {}
  }

  var start = paints[0].row;
  var n = 1;
  var pink = !!paints[0].pink;
  for (var i = 1; i < paints.length; i++) {
    var p = paints[i];
    if (p.row === start + n && !!p.pink === pink) {
      n++;
    } else {
      flush_(start, n, pink);
      start = p.row;
      n = 1;
      pink = !!p.pink;
    }
  }
  flush_(start, n, pink);
}

function _pls_runCompareOnSs_(ss) {
  _pls_ensureLayout_(ss);
  var tab = ss.getSheetByName(_PLS_TAB_NAME) || ss.getSheets()[0];
  var lr = tab.getLastRow();
  if (lr < _PLS_DATA_START) {
    throw new Error("3행부터 롯데택배 내역을 붙여넣은 뒤 다시 실행하세요.");
  }

  var prod = _pls_loadProductShipMap_();
  if (!prod.count) throw new Error("상품정보 시트에서 상품명을 읽지 못했습니다.");

  var nRows = lr - _PLS_DATA_START + 1;
  var width = Math.max(tab.getLastColumn(), _PLS_NAME_COL);
  var data = tab.getRange(_PLS_DATA_START, 1, nRows, width).getValues();
  var adExisting = tab.getRange(_PLS_DATA_START, _PLS_RESULT_COL, nRows, 1).getDisplayValues();

  var adUpdates = [];
  var rowPaints = [];
  var sumBook = 0;
  var sumLotte = 0;
  var sumDiff = 0;
  var matched = 0;
  var unmatched = 0;
  var skipped = 0;
  var kept = 0; // AD 비교결과 유지
  var wrote = 0; // 신규 비교 기록
  var feeByKey = {};

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rawName = row[_PLS_NAME_COL - 1];
    var rawFee = row[_PLS_FEE_COL - 1];
    var name = String(rawName == null ? "" : rawName).trim();
    var fee = _pls_toNumber_(rawFee);
    var adPrev = adExisting[i] ? adExisting[i][0] : "";
    var alreadyDone = _pls_isCompareResultAd_(adPrev);
    var sheetRow = _PLS_DATA_START + i;

    // 완전 빈 행
    if (!name && !fee) {
      skipped++;
      continue;
    }
    // 헤더/안내 행
    if (_pls_isHeaderLikeRow_(name, rawFee)) {
      skipped++;
      continue;
    }

    sumLotte += fee;

    if (!name) {
      if (!alreadyDone) {
        adUpdates.push({ row: sheetRow, value: "상품명없음" });
        wrote++;
      } else {
        kept++;
      }
      rowPaints.push({ row: sheetRow, pink: true });
      unmatched++;
      continue;
    }

    var key = _pls_normProductName_(name);
    if (!key) {
      if (!alreadyDone) {
        adUpdates.push({ row: sheetRow, value: "상품명없음" });
        wrote++;
      } else {
        kept++;
      }
      rowPaints.push({ row: sheetRow, pink: true });
      unmatched++;
      continue;
    }

    if (!feeByKey[key]) {
      feeByKey[key] = { fees: {}, feeMeta: {}, count: 0, book: null };
    }
    var feeKey = String(Math.round(fee));
    feeByKey[key].fees[feeKey] = true;
    if (!feeByKey[key].feeMeta[feeKey]) {
      feeByKey[key].feeMeta[feeKey] = { rows: [], samples: [] };
    }
    feeByKey[key].feeMeta[feeKey].rows.push(sheetRow);
    if (feeByKey[key].feeMeta[feeKey].samples.length < 2) {
      feeByKey[key].feeMeta[feeKey].samples.push(name);
    }
    feeByKey[key].count++;

    var resolved = _pls_resolveBookFee_(key, name, prod.map);
    if (resolved.book == null) {
      if (!alreadyDone) {
        adUpdates.push({ row: sheetRow, value: "미매칭" });
        wrote++;
      } else {
        kept++;
      }
      rowPaints.push({ row: sheetRow, pink: true });
      unmatched++;
      continue;
    }

    var book = resolved.book;
    feeByKey[key].book = book;
    var diff = book - fee;
    sumBook += book;
    sumDiff += diff;
    matched++;
    rowPaints.push({ row: sheetRow, pink: false });

    if (alreadyDone) {
      kept++;
    } else {
      adUpdates.push({ row: sheetRow, value: _pls_formatResult_(book, diff) });
      wrote++;
    }
  }

  _pls_writeAdUpdates_(tab, adUpdates);
  _pls_paintCompareRows_(tab, rowPaints, width);

  // 1행 요약
  var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  tab.getRange(1, 1, 1, _PLS_RESULT_COL).merge()
    .setValue(
      "롯데택배 배송비 비교  |  " + nowStr +
        "  |  운임합계 " + _pls_fmtNum_(sumLotte) + "원" +
        "  |  책정합계 " + _pls_fmtNum_(sumBook) + "원" +
        "  |  차이합계 " + _pls_fmtNum_(sumDiff) + "원" +
        "  |  비교 " + matched + "건 / 미매칭 " + unmatched + "건" +
        "  |  신규AD " + wrote + "건 / 유지 " + kept + "건" +
        "  |  AD=책정배송비(책정−롯데) 예: 3,600(-300)"
    )
    .setBackground("#1565c0").setFontColor("white").setFontWeight("bold")
    .setFontSize(11).setVerticalAlignment("middle");

  // 2행 요약 + 상세 탭
  var varyCount = _pls_writeVaryTab_(ss, feeByKey, nowStr);
  var varyMsg = varyCount
    ? ("⚠ 같은상품·다른운임 " + varyCount + "종 → 상세는「" + _PLS_VARY_TAB + "」탭 참고")
    : ("같은상품·다른운임: 없음 (상세탭「" + _PLS_VARY_TAB + "」)");
  tab.getRange(2, 1, 1, _PLS_RESULT_COL).merge()
    .setValue(varyMsg)
    .setBackground(varyCount ? "#fff3e0" : "#e8f5e9")
    .setFontColor(varyCount ? "#e65100" : "#2e7d32")
    .setFontWeight("bold")
    .setFontSize(10)
    .setVerticalAlignment("middle")
    .setWrap(true);
  try { tab.setRowHeight(2, 28); } catch (eH2) {}

  try { ss.setActiveSheet(tab); } catch (eAct) {}

  return {
    matched: matched,
    unmatched: unmatched,
    skipped: skipped,
    kept: kept,
    wrote: wrote,
    sumBook: sumBook,
    sumLotte: sumLotte,
    sumDiff: sumDiff,
    varyCount: varyCount,
  };
}

/**
 * 「같은상품_다른운임」탭 작성
 * @return {number} 문제 상품 종수
 */
function _pls_writeVaryTab_(ss, feeByKey, nowStr) {
  var varyTab = ss.getSheetByName(_PLS_VARY_TAB);
  if (!varyTab) {
    varyTab = ss.insertSheet(_PLS_VARY_TAB);
  }
  try { varyTab.setTabColor("#ef6c00"); } catch (eC) {}
  varyTab.clear();

  var headers = [
    "순번",
    "정규화상품명",
    "책정배송비",
    "발견운임",
    "해당건수",
    "비교시트_행번호",
    "원본상품명_예시",
    "운임종류수",
    "비고",
  ];
  varyTab.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground("#ef6c00").setFontColor("white").setFontWeight("bold")
    .setHorizontalAlignment("center");
  varyTab.setFrozenRows(1);

  var groups = [];
  for (var pk in feeByKey) {
    if (!feeByKey.hasOwnProperty(pk)) continue;
    var info = feeByKey[pk];
    var feeList = [];
    for (var fv in info.fees) {
      if (info.fees.hasOwnProperty(fv)) feeList.push(Number(fv));
    }
    if (feeList.length < 2) continue;
    feeList.sort(function (a, b) { return a - b; });
    groups.push({ key: pk, info: info, feeList: feeList });
  }
  groups.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });

  varyTab.getRange(2, 1, 1, headers.length).merge()
    .setValue(
      (groups.length
        ? ("같은상품·다른운임 " + groups.length + "종  |  " + nowStr + "  |  비교시트「" + _PLS_TAB_NAME + "」행번호 기준")
        : ("같은상품·다른운임 없음  |  " + nowStr))
    )
    .setBackground("#fff3e0").setFontColor("#e65100").setFontWeight("bold");

  if (!groups.length) {
    try {
      varyTab.setColumnWidth(1, 50);
      varyTab.setColumnWidth(2, 320);
      varyTab.setColumnWidth(6, 220);
      varyTab.setColumnWidth(7, 320);
    } catch (eW0) {}
    return 0;
  }

  var out = [];
  var seq = 0;
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    var kinds = grp.feeList.length;
    for (var fi = 0; fi < grp.feeList.length; fi++) {
      seq++;
      var feeAmt = grp.feeList[fi];
      var meta = grp.info.feeMeta[String(feeAmt)] || { rows: [], samples: [] };
      var rowsTxt = meta.rows.join(", ");
      var sampleTxt = (meta.samples && meta.samples.length) ? meta.samples[0] : "";
      var note = fi === 0
        ? ("운임 " + grp.feeList.map(function (x) { return _pls_fmtNum_(x); }).join(" / ") + "원")
        : "";
      out.push([
        seq,
        grp.key,
        grp.info.book != null ? grp.info.book : "",
        feeAmt,
        meta.rows.length,
        rowsTxt,
        sampleTxt,
        kinds,
        note,
      ]);
    }
  }

  varyTab.getRange(3, 1, out.length, headers.length).setValues(out);
  try {
    varyTab.getRange(3, 3, out.length, 2).setNumberFormat("#,##0");
    varyTab.getRange(3, 1, out.length, 1).setHorizontalAlignment("center");
    varyTab.getRange(3, 5, out.length, 1).setHorizontalAlignment("center");
    varyTab.getRange(3, 8, out.length, 1).setHorizontalAlignment("center");
  } catch (eFmt) {}

  // 상품 그룹별 배경 교차
  try {
    var rowPtr = 3;
    for (var gi = 0; gi < groups.length; gi++) {
      var nFees = groups[gi].feeList.length;
      var bg = gi % 2 === 0 ? "#fff8e1" : "#ffffff";
      varyTab.getRange(rowPtr, 1, nFees, headers.length).setBackground(bg);
      // 운임이 책정과 다르면 운임열 강조
      for (var fj = 0; fj < nFees; fj++) {
        var fAmt = groups[gi].feeList[fj];
        var bookV = groups[gi].info.book;
        if (bookV != null && Math.round(fAmt) !== Math.round(bookV)) {
          varyTab.getRange(rowPtr + fj, 4).setFontColor("#c62828").setFontWeight("bold");
        }
      }
      rowPtr += nFees;
    }
  } catch (eBg) {}

  try {
    varyTab.setColumnWidth(1, 50);
    varyTab.setColumnWidth(2, 340);
    varyTab.setColumnWidth(3, 90);
    varyTab.setColumnWidth(4, 90);
    varyTab.setColumnWidth(5, 70);
    varyTab.setColumnWidth(6, 260);
    varyTab.setColumnWidth(7, 360);
    varyTab.setColumnWidth(8, 70);
    varyTab.setColumnWidth(9, 200);
    varyTab.setRowHeight(2, 28);
  } catch (eW) {}

  return groups.length;
}

// ═══════════════════════════════════════════
//  바운드 스크립트 (비교시트 로컬 메뉴)
// ═══════════════════════════════════════════

/**
 * 비교시트에 바운드 스크립트 설치 — onOpen 메뉴「📦 롯데택배 배송비」
 * Pack2U 라이브러리로 partnerLotteShipCompareOnActive 호출
 */
function _pls_installBoundScript_(ss) {
  var sheetId = ss.getId();
  var oauthToken = ScriptApp.getOAuthToken();
  var props = PropertiesService.getScriptProperties();
  var scriptKey = _PLS_BOUND_SCRIPT_PREFIX + sheetId;
  var savedScriptId = String(props.getProperty(scriptKey) || "").trim();

  var code = [
    "// Pack2U 롯데택배 배송비 비교 시트 메뉴 (자동 설치)",
    "function onOpen() {",
    "  try {",
    "    SpreadsheetApp.getUi()",
    "      .createMenu('📦 롯데택배 배송비')",
    "      .addItem('▶ 비교 실행', 'lotteShipCompareRun')",
    "      .addToUi();",
    "  } catch (e) {}",
    "}",
    "function lotteShipCompareRun() {",
    "  Pack2U.partnerLotteShipCompareOnActive();",
    "}",
  ].join("\n");

  var manifest = JSON.stringify({
    timeZone: "Asia/Seoul",
    dependencies: {
      libraries: [{
        userSymbol: "Pack2U",
        libraryId: _PLS_HUB_LIBRARY_ID,
        version: "0",
        developmentMode: true,
      }],
    },
    exceptionLogging: "STACKDRIVER",
    runtimeVersion: "V8",
  });

  function putContent_(scriptId) {
    return UrlFetchApp.fetch(
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
            { name: "Code", type: "SERVER_JS", source: code },
            { name: "appsscript", type: "JSON", source: manifest },
          ],
        }),
        muteHttpExceptions: true,
      }
    );
  }

  if (savedScriptId) {
    var upd = putContent_(savedScriptId);
    if (upd.getResponseCode() === 200) return true;
    if ([401, 403, 404, 410].indexOf(upd.getResponseCode()) !== -1) {
      props.deleteProperty(scriptKey);
      savedScriptId = "";
    } else {
      throw new Error("비교시트 스크립트 업데이트 실패(" + upd.getResponseCode() + "): " + upd.getContentText());
    }
  }

  var createResp = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + oauthToken,
      "Content-Type": "application/json",
      Expect: "",
    },
    payload: JSON.stringify({
      title: "Pack2U 롯데택배 배송비 메뉴",
      parentId: sheetId,
    }),
    muteHttpExceptions: true,
  });
  if (createResp.getResponseCode() !== 200) {
    throw new Error("비교시트 스크립트 생성 실패(" + createResp.getResponseCode() + "): " + createResp.getContentText());
  }
  var newId = JSON.parse(createResp.getContentText()).scriptId;
  var putResp = putContent_(newId);
  if (putResp.getResponseCode() !== 200) {
    throw new Error("비교시트 스크립트 코드 주입 실패(" + putResp.getResponseCode() + "): " + putResp.getContentText());
  }
  props.setProperty(scriptKey, newId);
  return true;
}
