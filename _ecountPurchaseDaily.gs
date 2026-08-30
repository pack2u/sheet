/**
 * [Pack2U] 당일 구매입력 시트 분리 저장
 * 파일: _ecountPurchaseDaily.gs
 *
 * 허브의 「이카운트-구매입력변환」 탭에서 당일(A열 일자 = 오늘) 행만 뽑아
 * 「구매입력」 폴더 안에 하루치 파일로 따로 만든다.
 *
 * 실행 경로
 *   · 메뉴   💎 Pack2U → 🛠️ 이카운트 작업 → 📤 당일 구매입력 시트 만들기
 *   · 트리거 매일 17시 (runDailyEcountPurchaseSheet)
 *
 * ★ 폴더 ★
 *   일일마감과 같은 상위 폴더를 쓴다(_unified_resolveArchiveFolder_).
 *   그 안에 「구매입력」 하위폴더를 만들어 저장한다.
 *
 * ★ 재실행 ★
 *   같은 날 다시 돌리면 새 파일을 만들지 않고 기존 파일 내용을 덮어쓴다.
 */

var _EPD_FOLDER_NAME_  = "구매입력";
var _EPD_FILE_PREFIX_  = "구매입력_";
var _EPD_TRIGGER_FN_   = "runDailyEcountPurchaseSheet";
var _EPD_TRIGGER_HOUR_ = 17;

// ── 날짜 ────────────────────────────────────────────────
/** 오늘 (변환탭 A열과 같은 yyyyMMdd) */
function _epd_todayYmd_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
}

/** 20260831 → 2026-08-31 (파일명·알림 표기용) */
function _epd_dashed_(ymd) {
  var s = String(ymd || "");
  if (!/^\d{8}$/.test(s)) return s;
  return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
}

// ── 폴더 / 파일 ─────────────────────────────────────────
/** 상위 폴더 안의 「구매입력」 하위폴더 */
function _epd_purchaseFolder_(ss) {
  if (typeof _unified_resolveArchiveFolder_ !== "function" ||
      typeof _unified_getOrCreateSubFolder_ !== "function") {
    throw new Error("폴더 헬퍼를 찾을 수 없습니다 (_partnerExclusivePush.gs 확인).");
  }
  var base = _unified_resolveArchiveFolder_(ss);
  var sub = null;
  try {
    sub = _unified_getOrCreateSubFolder_(base, _EPD_FOLDER_NAME_);
  } catch (eS) {
    Logger.log("[EPD] 구매입력 하위폴더 생성 실패, 상위 폴더에 저장: " + eS.message);
  }
  return sub || base;
}

/** 하루치 파일 — 있으면 열고 없으면 만든다 */
function _epd_getOrCreateSs_(ss, fileName) {
  var folder = _epd_purchaseFolder_(ss);

  var it = folder.getFilesByName(fileName);
  while (it.hasNext()) {
    var f = it.next();
    var trashed = false;
    try { trashed = f.isTrashed(); } catch (eT) { trashed = false; }
    if (!trashed) return SpreadsheetApp.openById(f.getId());
  }

  var newSs = SpreadsheetApp.create(fileName);
  var newFile = DriveApp.getFileById(newSs.getId());
  try {
    newFile.moveTo(folder);
  } catch (eMove) {
    Logger.log("[EPD] moveTo 실패, addFile 폴백: " + eMove.message);
    try {
      folder.addFile(newFile);
    } catch (eAdd) {
      Logger.log("[EPD] 폴더 이동 실패 (내 드라이브 루트에 생성됨): " + eAdd.message);
    }
  }
  Logger.log("[EPD] 새 파일 생성: " + fileName + " (ID=" + newSs.getId() + ")");
  return newSs;
}

// ── 본체 ────────────────────────────────────────────────
function _epd_run_(ymd) {
  var ss = SpreadsheetApp.getActive();

  var src = ss.getSheetByName(_EPX_OUT_TAB_);
  if (!src) {
    throw new Error("「" + _EPX_OUT_TAB_ + "」 탭이 없습니다.\n먼저 [전용마감 → 구매입력 변환]을 실행하세요.");
  }
  var lr = src.getLastRow();
  if (lr < 2) {
    throw new Error("「" + _EPX_OUT_TAB_ + "」 탭에 데이터가 없습니다.");
  }

  var main = src.getRange(2, 1, lr - 1, _EPX_HEADERS_.length).getValues();
  var diag = src.getRange(2, _EPX_DIAG_START_COL_, lr - 1, _EPX_DIAG_HEADERS_.length).getValues();

  // 당일 행만. 택배비 집계행도 A열 일자가 같으니 함께 딸려온다.
  var outMain = [], outDiag = [];
  for (var i = 0; i < main.length; i++) {
    if (String(main[i][0] || "").trim() !== String(ymd)) continue;
    outMain.push(main[i]);
    outDiag.push(diag[i]);
  }

  var fileName = _EPD_FILE_PREFIX_ + "(" + _epd_dashed_(ymd) + ")";
  var target = _epd_getOrCreateSs_(ss, fileName);

  var tab = target.getSheets()[0];
  if (tab.getName() !== _EPX_OUT_TAB_) tab.setName(_EPX_OUT_TAB_);
  tab.clear();

  var needCols = _EPX_DIAG_START_COL_ + _EPX_DIAG_HEADERS_.length - 1;
  if (tab.getMaxColumns() < needCols) {
    tab.insertColumnsAfter(tab.getMaxColumns(), needCols - tab.getMaxColumns());
  }

  tab.getRange(1, 1, 1, _EPX_HEADERS_.length)
    .setValues([_EPX_HEADERS_])
    .setBackground("#1f4e78").setFontColor("#ffffff")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.getRange(1, _EPX_DIAG_START_COL_, 1, _EPX_DIAG_HEADERS_.length)
    .setValues([_EPX_DIAG_HEADERS_])
    .setBackground("#7f7f7f").setFontColor("#ffffff")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  tab.setColumnWidth(12, 260); // 품목명
  tab.setColumnWidth(4, 200);  // 거래처명

  if (outMain.length) {
    if (tab.getMaxRows() < outMain.length + 1) {
      tab.insertRowsAfter(tab.getMaxRows(), outMain.length + 1 - tab.getMaxRows());
    }
    // ★ 값보다 서식이 먼저다 — 거래처코드·품목코드의 앞자리 0 이 죽지 않게.
    _epx_lockTextCols_(tab, outMain.length);

    tab.getRange(2, 1, outMain.length, _EPX_HEADERS_.length).setValues(outMain);
    tab.getRange(2, _EPX_DIAG_START_COL_, outDiag.length, _EPX_DIAG_HEADERS_.length).setValues(outDiag);

    tab.getRange(2, 14, outMain.length, 1).setNumberFormat("#,##0");  // 수량
    tab.getRange(2, 15, outMain.length, 5).setNumberFormat("#,##0");  // 단가~금액

    for (var v = 0; v < outDiag.length; v++) {
      if (String(outDiag[v][0]).indexOf("집계") === 0) {
        tab.getRange(v + 2, 1, 1, _EPX_HEADERS_.length).setBackground("#fff2cc");
      }
    }
  }

  return { rows: outMain.length, name: fileName, url: target.getUrl(), ymd: ymd };
}

// ── 메뉴 진입점 ─────────────────────────────────────────
function buildDailyEcountPurchaseSheetOwner() {
  var ui = SpreadsheetApp.getUi();
  try {
    var res = _epd_run_(_epd_todayYmd_());
    ui.alert(
      "당일 구매입력 시트",
      "파일: " + res.name + "\n" +
        "폴더: " + _EPD_FOLDER_NAME_ + "\n" +
        "행: " + res.rows + "건\n\n" +
        (res.rows
          ? res.url
          : "당일(" + _epd_dashed_(res.ymd) + ") 행이 없어 빈 파일만 만들었습니다.\n" +
            "변환탭 A열 일자를 확인하세요."),
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("당일 구매입력 시트 실패", e.message, ui.ButtonSet.OK);
  }
}

/** 트리거 진입점 — UI 를 쓰지 않는다 */
function runDailyEcountPurchaseSheet() {
  try {
    var res = _epd_run_(_epd_todayYmd_());
    Logger.log("[EPD] " + res.name + " — " + res.rows + "건");
  } catch (e) {
    Logger.log("[EPD] 실패: " + e.message);
  }
}

// ── 트리거 관리 ─────────────────────────────────────────
function _epd_removeTriggers_() {
  var all = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === _EPD_TRIGGER_FN_) {
      ScriptApp.deleteTrigger(all[i]);
      n++;
    }
  }
  return n;
}

function installDailyEcountPurchaseTrigger() {
  var ui = SpreadsheetApp.getUi();
  try {
    var removed = _epd_removeTriggers_(); // 중복 등록 방지
    ScriptApp.newTrigger(_EPD_TRIGGER_FN_)
      .timeBased().everyDays(1)
      .atHour(_EPD_TRIGGER_HOUR_).nearMinute(0)
      .create();
    ui.alert(
      "트리거 등록",
      "매일 " + _EPD_TRIGGER_HOUR_ + "시에 당일 구매입력 시트를 만듭니다." +
        (removed ? "\n(기존 트리거 " + removed + "개 정리)" : "") +
        "\n\n구글 시간 트리거는 정시가 아니라 그 시간대 안에서 실행됩니다.",
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("트리거 등록 실패", e.message, ui.ButtonSet.OK);
  }
}

function removeDailyEcountPurchaseTrigger() {
  var ui = SpreadsheetApp.getUi();
  try {
    var n = _epd_removeTriggers_();
    ui.alert("트리거 해제", n + "개를 제거했습니다.", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("트리거 해제 실패", e.message, ui.ButtonSet.OK);
  }
}
