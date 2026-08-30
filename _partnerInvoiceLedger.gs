/**
 * 송장원장 (append-only) — 사라지는 송장을 영구 보존
 *
 * 배경:
 *   대리공급 마감은 대리공급_임시기록에서 송장 있는 행을 지운다. 보관탭 적재가
 *   실패하면 송장이 영구 소실되고, 일일마감은 그 주문을 매칭할 근거를 잃는다.
 *   반면 각 협력업체 파일의 마감탭과 통합발주 아카이브는 월별로 영구 보존된다.
 *
 * 이 모듈은 "사라지는 것"만 원장에 누적한다.
 *   롯데·1주출고는 이미 영구 누적되므로 담지 않는다. 원장을 작게 유지하는 게 목적이다.
 *
 * 수집 대상:
 *   1) 대리공급_임시기록 / _보관                     (현재값)
 *   2) 각 협력업체 (YYYY년 M월) 전용발주 마감        (당월+전월)
 *   3) 각 협력업체 (YYYY년 M월) 발주 마감            (당월+전월)
 *   4) [Pack2U 통합발주 아카이브] YYYY-MM            (당월+전월)
 *
 * 마감탭은 append-only이므로 파일·탭별 읽기 커서를 스크립트 속성에 저장해
 * 매 실행에서 새 행만 읽는다. 최초 1회만 무겁고 이후는 거의 비용이 없다.
 */

var _PIL_TAB_NAME_ = "송장원장";
var _PIL_RETENTION_DAYS_ = 60;
var _PIL_CURSOR_PREFIX_ = "PIL_CUR:";
var _PIL_TIME_BUDGET_MS_ = 120000; // 일일마감 안에서 돌므로 2분으로 제한
var _PIL_MAX_APPEND_ = 20000;

var _PIL_HEADERS_ = [
  "관측일시",   // A
  "출처",       // B: 임시기록 / 임시기록보관 / 전용마감:업체 / 발주마감:업체 / 허브아카이브
  "송장번호",   // C
  "고유ID",     // D
  "수취인",     // E
  "전화",       // F
  "주문일",     // G
  "품목명",     // H
];

// ═══════════════════════════════════════════
//  원장 탭
// ═══════════════════════════════════════════

function _pil_openLedgerSs_() {
  if (typeof _po_openTempSheetSs_ === "function") return _po_openTempSheetSs_();
  return SpreadsheetApp.getActiveSpreadsheet();
}

function _pil_ensureTab_(ss) {
  if (!ss) ss = _pil_openLedgerSs_();
  var tab = ss.getSheetByName(_PIL_TAB_NAME_);
  if (!tab) {
    tab = ss.insertSheet(_PIL_TAB_NAME_);
    tab.setFrozenRows(1);
  }
  if (tab.getMaxColumns() < _PIL_HEADERS_.length) {
    tab.insertColumnsAfter(tab.getMaxColumns(), _PIL_HEADERS_.length - tab.getMaxColumns());
  }
  if (tab.getLastColumn() < _PIL_HEADERS_.length) {
    tab.getRange(1, 1, 1, _PIL_HEADERS_.length).setValues([_PIL_HEADERS_])
      .setFontWeight("bold").setBackground("#1f4e78").setFontColor("#ffffff");
  }
  return tab;
}

function _pil_rowKey_(inv, uid) {
  return String(inv || "") + "|" + String(uid || "").trim().replace(/#\d+$/, "");
}

function _pil_normInv_(inv) {
  if (typeof _pep_normInvoiceNo_ === "function") return _pep_normInvoiceNo_(inv);
  var d = String(inv == null ? "" : inv).replace(/[^0-9]/g, "");
  return d.length >= 8 ? d : "";
}

function _pil_splitInv_(inv) {
  if (typeof _pep_splitInvNos_ === "function") return _pep_splitInvNos_(inv);
  return String(inv || "").split(/[\r\n,;]+/)
    .map(function (s) { return _pil_normInv_(s); })
    .filter(function (s) { return !!s; });
}

// ═══════════════════════════════════════════
//  읽기 커서 (마감탭은 append-only)
// ═══════════════════════════════════════════

function _pil_cursorKey_(fileId, tabName) {
  return _PIL_CURSOR_PREFIX_ + fileId + ":" + tabName;
}

function _pil_getCursor_(props, fileId, tabName, lastRow) {
  var raw = props.getProperty(_pil_cursorKey_(fileId, tabName));
  var n = raw ? parseInt(raw, 10) : 1;
  if (!(n >= 1)) n = 1;
  // 행이 줄었으면(보정·삭제) 커서를 신뢰할 수 없으므로 전체 재읽기
  if (n > lastRow) n = 1;
  return n;
}

function _pil_setCursor_(props, fileId, tabName, lastRow) {
  props.setProperty(_pil_cursorKey_(fileId, tabName), String(lastRow));
}

/** 커서 전체 초기화 — 다음 실행에서 마감탭을 처음부터 재수집한다 */
function partnerResetInvoiceLedgerCursors() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var removed = 0;
  for (var k in all) {
    if (k.indexOf(_PIL_CURSOR_PREFIX_) === 0) { props.deleteProperty(k); removed++; }
  }
  var msg = "송장원장 읽기 커서 " + removed + "건 초기화. 다음 갱신에서 마감탭을 처음부터 다시 읽습니다.";
  Logger.log("[LEDGER] " + msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return removed;
}

// ═══════════════════════════════════════════
//  수집
// ═══════════════════════════════════════════

/** 당월부터 monthsBack 개월 전까지의 (yyyy, m) 목록 */
function _pil_recentMonths_(monthsBack) {
  var out = [];
  var now = new Date();
  for (var b = 0; b <= (monthsBack == null ? 1 : monthsBack); b++) {
    var d = new Date(now.getFullYear(), now.getMonth() - b, 1);
    out.push({ yyyy: d.getFullYear(), m: d.getMonth() + 1 });
  }
  return out;
}

/** 헤더에서 키워드에 맞는 열 찾기 (오른쪽 우선 탐색 옵션) */
function _pil_findCol_(hdr, re, fromRight) {
  if (!hdr) return -1;
  if (fromRight) {
    for (var i = hdr.length - 1; i >= 0; i--) {
      if (re.test(String(hdr[i] || "").replace(/\s/g, ""))) return i;
    }
    return -1;
  }
  for (var j = 0; j < hdr.length; j++) {
    if (re.test(String(hdr[j] || "").replace(/\s/g, ""))) return j;
  }
  return -1;
}

/**
 * 대리공급_임시기록 + 보관 — 항상 전체 읽기 (행수가 적음)
 */
function _pil_harvestTemp_(out, stat) {
  var ss = _pil_openLedgerSs_();
  var off = (typeof _PO_TEMP_ARCHIVE_COL_OFFSET_ !== "undefined") ? _PO_TEMP_ARCHIVE_COL_OFFSET_ : 2;

  function read(label, tab, o) {
    if (!tab || tab.getLastRow() < 2) return;
    var need = _PO_TEMP_INV_COL_ + o + 1;
    var lc = Math.max(tab.getLastColumn(), need);
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, lc).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var invs = _pil_splitInv_(data[i][_PO_TEMP_INV_COL_ + o]);
      if (!invs.length) continue;
      var uid = String(data[i][_PO_TEMP_UID_COL_ + o] || "").trim();
      for (var k = 0; k < invs.length; k++) {
        out.push({
          src: label, inv: invs[k], uid: uid,
          name: String(data[i][12 + o] || "").trim(),
          phone: String(data[i][7 + o] || data[i][8 + o] || "").trim(),
          date: String(data[i][2 + o] || "").trim(),
          item: String(data[i][4 + o] || "").trim(),
        });
        stat.temp++;
      }
    }
  }

  try { read("임시기록", _po_getNonPartnerTempTab_(ss), 0); }
  catch (e) { stat.errors.push("임시기록: " + e.message); }
  try { read("임시기록보관", _po_getTempArchiveTab_(ss), off); }
  catch (e) { stat.errors.push("임시기록보관: " + e.message); }
}

/**
 * 각 협력업체 파일의 마감탭 — 커서 기반 증분 읽기
 *
 * 전용발주 마감 = ["이동일시"] + 전용양식 헤더
 *   → 송장 = index 1 (전용양식 A열), 고유ID = 헤더탐색 실패 시 index 50 (AX+1)
 * 발주 마감 = 발주 및 송장조회 15열 그대로
 *   → 송장 = index 10(K), 고유ID = index 12(M), 수취인 = 5(F), 전화 = 6(G)
 */
function _pil_harvestPartnerArchives_(out, stat, started) {
  var props = PropertiesService.getScriptProperties();
  var files = [];
  try { files = _pt_listFiles() || []; }
  catch (e) { stat.errors.push("협력업체 파일 목록: " + e.message); return; }

  var months = _pil_recentMonths_(1);
  var exSuffix = (typeof _PEA_TAB_SUFFIX !== "undefined") ? _PEA_TAB_SUFFIX : "전용발주 마감";

  for (var fi = 0; fi < files.length; fi++) {
    if (new Date().getTime() - started > _PIL_TIME_BUDGET_MS_) { stat.timedOut = true; return; }
    var vendor = String(files[fi].name || "").replace("[협력업체] ", "").trim();
    var ss;
    try { ss = SpreadsheetApp.openById(files[fi].id); }
    catch (e) { stat.errors.push(vendor + " 열기 실패: " + e.message); continue; }

    for (var mi = 0; mi < months.length; mi++) {
      var mLabel = "(" + months[mi].yyyy + "년 " + months[mi].m + "월) ";
      _pil_readArchiveTab_(out, stat, props, files[fi].id, ss,
        mLabel + exSuffix, "전용마감:" + vendor, "exclusive");
      _pil_readArchiveTab_(out, stat, props, files[fi].id, ss,
        mLabel + "발주 마감", "발주마감:" + vendor, "order");
    }
  }
}

function _pil_readArchiveTab_(out, stat, props, fileId, ss, tabName, label, kind) {
  var tab;
  try { tab = ss.getSheetByName(tabName); } catch (e) { return; }
  if (!tab) return;
  var lastRow = tab.getLastRow();
  if (lastRow < 2) return;

  var from = _pil_getCursor_(props, fileId, tabName, lastRow);
  var startRow = Math.max(from + 1, 2);
  if (startRow > lastRow) return;

  var lc = Math.max(tab.getLastColumn(), 1);
  var hdr = [];
  try { hdr = tab.getRange(1, 1, 1, lc).getValues()[0]; } catch (e) {}

  var cInv, cUid, cName, cPhone, cItem, cDate;
  if (kind === "exclusive") {
    cInv = _pil_findCol_(hdr, /^송장번호$|^운송장번호$/, false);
    if (cInv < 0) cInv = 1; // 이동일시 + 전용양식 A열
    cUid = _pil_findCol_(hdr, /^고유ID$/i, true);
    if (cUid < 0) cUid = Math.min(50, lc - 1);
    cName = _pil_findCol_(hdr, /수취인|수령인|받는분성명|받는분|받는사람/, false);
    cPhone = _pil_findCol_(hdr, /받는분전화|수취인전화|수령인연락처|받는전화/, false);
    cItem = _pil_findCol_(hdr, /품목명|상품명|품명/, false);
    cDate = _pil_findCol_(hdr, /주문일|일자|이동일시/, false);
  } else {
    cInv = 10; cUid = 12; cName = 5; cPhone = 6; cItem = 3; cDate = 1;
  }

  var data;
  try { data = tab.getRange(startRow, 1, lastRow - startRow + 1, lc).getDisplayValues(); }
  catch (e) { stat.errors.push(label + " 읽기 실패: " + e.message); return; }

  for (var i = 0; i < data.length; i++) {
    var invs = _pil_splitInv_(cInv >= 0 ? data[i][cInv] : "");
    if (!invs.length) continue;
    var uid = cUid >= 0 ? String(data[i][cUid] || "").trim() : "";
    for (var k = 0; k < invs.length; k++) {
      out.push({
        src: label, inv: invs[k], uid: uid,
        name: cName >= 0 ? String(data[i][cName] || "").trim() : "",
        phone: cPhone >= 0 ? String(data[i][cPhone] || "").trim() : "",
        date: cDate >= 0 ? String(data[i][cDate] || "").trim() : "",
        item: cItem >= 0 ? String(data[i][cItem] || "").trim() : "",
      });
      stat.archive++;
    }
  }
  _pil_setCursor_(props, fileId, tabName, lastRow);
}

/** [Pack2U 통합발주 아카이브] YYYY-MM — 허브 열 배열 */
function _pil_harvestHubArchive_(out, stat, started) {
  var props = PropertiesService.getScriptProperties();
  var months = _pil_recentMonths_(1);
  var namePrefix = (typeof HUB_ARCHIVE_SS_NAME_PREFIX !== "undefined")
    ? HUB_ARCHIVE_SS_NAME_PREFIX : "[Pack2U 통합발주 아카이브] ";

  for (var mi = 0; mi < months.length; mi++) {
    if (new Date().getTime() - started > _PIL_TIME_BUDGET_MS_) { stat.timedOut = true; return; }
    var yyyymm = months[mi].yyyy + "-" + ("0" + months[mi].m).slice(-2);
    var ss = _pil_findHubArchiveSs_(props, namePrefix, yyyymm);
    if (!ss) continue;
    var tab = ss.getSheetByName("발주 아카이브") || ss.getSheets()[0];
    if (!tab || tab.getLastRow() < 2) continue;

    var lastRow = tab.getLastRow();
    var from = _pil_getCursor_(props, ss.getId(), tab.getName(), lastRow);
    var startRow = Math.max(from + 1, 2);
    if (startRow > lastRow) continue;

    var lc = Math.max(tab.getLastColumn(), 15);
    var data;
    try { data = tab.getRange(startRow, 1, lastRow - startRow + 1, lc).getDisplayValues(); }
    catch (e) { stat.errors.push("허브아카이브 " + yyyymm + ": " + e.message); continue; }

    for (var i = 0; i < data.length; i++) {
      var invs = _pil_splitInv_(data[i][13]);
      if (!invs.length) continue;
      for (var k = 0; k < invs.length; k++) {
        out.push({
          src: "허브아카이브:" + yyyymm, inv: invs[k],
          uid: String(data[i][2] || "").trim(),
          name: String(data[i][7] || "").trim(),
          phone: String(data[i][8] || "").trim(),
          date: String(data[i][3] || "").trim(),
          item: String(data[i][5] || "").trim(),
        });
        stat.archive++;
      }
    }
    _pil_setCursor_(props, ss.getId(), tab.getName(), lastRow);
  }
}

/** 아카이브 파일은 생성하지 않고 찾기만 한다 (속성 → 이름 검색) */
function _pil_findHubArchiveSs_(props, namePrefix, yyyymm) {
  var idProp = (typeof HUB_ARCHIVE_SS_ID_PREFIX !== "undefined")
    ? HUB_ARCHIVE_SS_ID_PREFIX : "HUB_ARCHIVE_SS_ID_";
  var cached = props.getProperty(idProp + yyyymm);
  if (cached) {
    try { return SpreadsheetApp.openById(cached); } catch (e) {}
  }
  try {
    var it = DriveApp.getFilesByName(namePrefix + yyyymm);
    if (it.hasNext()) return SpreadsheetApp.openById(it.next().getId());
  } catch (e) {}
  return null;
}

// ═══════════════════════════════════════════
//  갱신
// ═══════════════════════════════════════════

/**
 * 원장 갱신. 일일마감 ①단계 앞에서 호출된다.
 * @return {Object} { appended, scanned, temp, archive, skippedDup, timedOut, errors }
 */
function _pil_refresh_(opt) {
  opt = opt || {};
  var started = new Date().getTime();
  var stat = { temp: 0, archive: 0, appended: 0, skippedDup: 0, timedOut: false, errors: [], trimmed: 0 };

  try {
    var ss = _pil_openLedgerSs_();
    var tab = _pil_ensureTab_(ss);

    // 기존 키 로드 (중복 적재 방지)
    var seen = {};
    var lr = tab.getLastRow();
    if (lr >= 2) {
      var exist = tab.getRange(2, 3, lr - 1, 2).getDisplayValues(); // C=송장, D=고유ID
      for (var e = 0; e < exist.length; e++) {
        seen[_pil_rowKey_(exist[e][0], exist[e][1])] = true;
      }
    }

    var harvested = [];
    _pil_harvestTemp_(harvested, stat);
    if (opt.skipArchives !== true) {
      _pil_harvestPartnerArchives_(harvested, stat, started);
      _pil_harvestHubArchive_(harvested, stat, started);
    }

    var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var rows = [];
    for (var i = 0; i < harvested.length && rows.length < _PIL_MAX_APPEND_; i++) {
      var h = harvested[i];
      var key = _pil_rowKey_(h.inv, h.uid);
      if (seen[key]) { stat.skippedDup++; continue; }
      seen[key] = true;
      rows.push([nowStr, h.src, h.inv, h.uid, h.name, h.phone, h.date, h.item]);
    }

    if (rows.length) {
      var start = Math.max(tab.getLastRow() + 1, 2);
      tab.getRange(start, 1, rows.length, _PIL_HEADERS_.length).setValues(rows);
      stat.appended = rows.length;
    }
    stat.trimmed = _pil_trim_(tab);
  } catch (e) {
    stat.errors.push(String(e.message || e));
  }
  Logger.log("[LEDGER] 적재=" + stat.appended + " 중복스킵=" + stat.skippedDup +
    " 임시=" + stat.temp + " 마감=" + stat.archive +
    (stat.timedOut ? " (시간초과 — 다음 실행에서 이어짐)" : "") +
    (stat.errors.length ? " 오류=" + stat.errors.length : ""));
  return stat;
}

/** 보존기간 초과 행 정리 */
function _pil_trim_(tab) {
  if (!tab || tab.getLastRow() < 2) return 0;
  var lr = tab.getLastRow();
  var lc = _PIL_HEADERS_.length;
  var data = tab.getRange(2, 1, lr - 1, lc).getValues();
  var cutoff = new Date(Date.now() - _PIL_RETENTION_DAYS_ * 86400000);
  var keep = [], removed = 0;
  for (var i = 0; i < data.length; i++) {
    var d = data[i][0];
    var dt = (d instanceof Date) ? d : new Date(String(d || ""));
    if (!isNaN(dt.getTime()) && dt < cutoff) { removed++; continue; }
    keep.push(data[i]);
  }
  if (removed > 0) {
    tab.getRange(2, 1, lr - 1, lc).clearContent();
    if (keep.length) tab.getRange(2, 1, keep.length, lc).setValues(keep);
  }
  return removed;
}

/**
 * 원장을 일일마감 송장맵에 주입.
 * 이름키는 등록하지 않는다 — 원장의 가치는 UID 커버리지이고,
 * 이름 단독 매칭은 동명이인 오매칭 위험이 크다.
 * @return {number} 주입한 송장 행수
 */
function _pil_addToInvoiceMap_(invoiceMap) {
  if (!invoiceMap) return 0;
  var added = 0;
  try {
    var tab = _pil_openLedgerSs_().getSheetByName(_PIL_TAB_NAME_);
    if (!tab || tab.getLastRow() < 2) return 0;
    var cols = Math.min(_PIL_HEADERS_.length, tab.getMaxColumns());
    if (cols < 4) return 0; // 최소 C=송장, D=고유ID 까지는 있어야 의미가 있다
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, cols).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var inv = data[i][2];
      if (!inv) continue;
      var uid = String(data[i][3] || "").trim();
      if (uid && !(invoiceMap[uid] && invoiceMap[uid].source === "롯데")) {
        _pep_addInvoiceMap_(invoiceMap, uid, inv, "송장원장");
      }
      if (cols >= 6 && typeof _pep_addNamePhoneInvoiceKeys_ === "function") {
        _pep_addNamePhoneInvoiceKeys_(invoiceMap, data[i][4], data[i][5], inv, "송장원장", {
          skipName: true,
          item: cols >= 8 ? data[i][7] : "",   // H: 품목명
        });
      }
      added++;
    }
  } catch (e) {
    Logger.log("[LEDGER] 송장맵 주입 오류: " + e.message);
  }
  return added;
}

// ═══════════════════════════════════════════
//  메뉴 진입점
// ═══════════════════════════════════════════

/** 수동 갱신 — 최초 백필도 이 함수로 수행한다 */
function partnerRefreshInvoiceLedger() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  var stat = _pil_refresh_({});

  var lines = [
    "신규 적재: " + stat.appended + "건",
    "중복 스킵: " + stat.skippedDup + "건",
    "",
    "임시기록·보관에서 읽음: " + stat.temp + "건",
    "마감탭·아카이브에서 읽음: " + stat.archive + "건",
    "보존기간 초과 정리: " + stat.trimmed + "건",
  ];
  if (stat.timedOut) {
    lines.push("", "⏳ 시간 제한으로 일부만 처리했습니다. 한 번 더 실행하면 이어서 수집합니다.");
  }
  if (stat.errors.length) {
    lines.push("", "── 오류 ──");
    for (var i = 0; i < Math.min(stat.errors.length, 8); i++) lines.push("  " + stat.errors[i]);
  }
  var text = lines.join("\n");
  Logger.log("[LEDGER]\n" + text);
  if (ui) ui.alert("송장원장 갱신 완료", text + "\n\n탭: " + _PIL_TAB_NAME_, ui.ButtonSet.OK);
  return stat;
}
