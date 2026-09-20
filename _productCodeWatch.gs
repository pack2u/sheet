/**
 * ══════════════════════════════════════════════════════════════
 *  상품정보 — 이카운트코드 감시
 *
 *  > "상품정보시트의 코드값이 엄한게 들어가있어.. 최근에 하루에 몇개씩
 *  >  코드가 엄한걸로 바뀌는 경우가 있는데. 이부분 먼저 확인해줘"
 *
 *  이 시트의 코드가 곧 모든 것의 뿌리다 — 허브 단가표, 업체 단가조회,
 *  발주, 이카운트 전송이 전부 이 값을 본다. 여기서 한 글자가 바뀌면
 *  그 물건은 그 순간부터 «다른 물건»이 된다.
 *
 *  ★ 스크립트가 이 열에 쓰는 곳은 찾지 못했다 ★
 *    그래서 «무엇이» 바꾸는지는 아직 모른다. 모르는 것을 아는 척하지 않고,
 *    대신 «무엇이 바뀌었는지»를 잡을 수 있게 한다.
 *      ① 지금 어긋나 있는 것을 찾는다 (중복·빈칸·생김새)
 *      ② 코드를 찍어 둔다. 다음에 다시 보면 «바뀐 줄»이 그대로 나온다.
 *
 *  읽기와 찍어 두기만 한다. 코드를 고치지 않는다 — 무엇이 맞는지는
 *  사람이 안다.
 * ══════════════════════════════════════════════════════════════
 */

var _PCW_TAB_ = "상품정보";
var _PCW_HEADER_ROW_ = 4;
var _PCW_DATA_ROW_ = 6;
var _PCW_CODE_COL_ = 5;    // E 이카운트코드
var _PCW_SNAP_TAB_ = "상품정보_코드기록";

/** 품목명 열은 머리글로 찾는다 — 자리를 박으면 열이 하나 밀릴 때 통째로 틀린다 */
function _pcw_nameCol_(header) {
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || "").replace(/\s/g, "");
    if (/^품목명$|^상품명$|^품명$/.test(h)) return i + 1;
  }
  return 6;   // 못 찾으면 F
}

function _pcw_key_(s) {
  return String(s == null ? "" : s)
    .replace(/[ ​-‍﻿]/g, "")
    .replace(/\s/g, "")
    .toUpperCase();
}

/** 지금 시트에서 코드·품목명을 읽는다 */
function _pcw_read_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PCW_TAB_);
  if (!tab) throw new Error("「" + _PCW_TAB_ + "」 탭이 없습니다.");
  var last = tab.getLastRow();
  if (last < _PCW_DATA_ROW_) return { rows: [], nameCol: 6 };

  var lastCol = Math.max(tab.getLastColumn(), 15);
  var header = tab.getRange(_PCW_HEADER_ROW_, 1, 1, lastCol).getDisplayValues()[0];
  var nameCol = _pcw_nameCol_(header);

  var all = tab.getRange(_PCW_DATA_ROW_, 1, last - _PCW_DATA_ROW_ + 1, lastCol).getDisplayValues();
  var rows = [];
  for (var i = 0; i < all.length; i++) {
    var code = String(all[i][_PCW_CODE_COL_ - 1] || "").trim();
    var name = String(all[i][nameCol - 1] || "").trim();
    if (!code && !name) continue;
    rows.push({ row: _PCW_DATA_ROW_ + i, code: code, name: name });
  }
  return { rows: rows, nameCol: nameCol };
}

/* ══════════════════════════════════════════════════════════════
   ① 지금 어긋나 있는 것
   ══════════════════════════════════════════════════════════════ */
function productCodeAudit() {
  var ui = SpreadsheetApp.getUi();
  var r;
  try { r = _pcw_read_(); } catch (e) { ui.alert(e.message); return; }
  var rows = r.rows;
  if (!rows.length) { ui.alert("읽을 줄이 없습니다."); return; }

  var 본것 = {}, 중복 = [], 빈코드 = [], 이상 = [], 이름중복 = {};

  for (var i = 0; i < rows.length; i++) {
    var x = rows[i];
    if (!x.code) { if (x.name) 빈코드.push(x); continue; }

    var k = _pcw_key_(x.code);
    if (본것[k]) 중복.push({ a: 본것[k], b: x });
    else 본것[k] = x;

    /*  생김새가 어긋난 코드 — 한글이 들어갔거나, 너무 짧거나,
        숫자만이거나. 이카운트코드는 영문+숫자다.  */
    if (/[가-힣]/.test(x.code)) 이상.push({ row: x.row, code: x.code, name: x.name, why: "한글이 들어 있음" });
    else if (x.code.length < 3) 이상.push({ row: x.row, code: x.code, name: x.name, why: "너무 짧음" });
    else if (/^[0-9]+$/.test(x.code)) 이상.push({ row: x.row, code: x.code, name: x.name, why: "숫자뿐" });
    else if (/\s/.test(x.code)) 이상.push({ row: x.row, code: x.code, name: x.name, why: "빈칸이 섞임" });

    var nk = _pcw_key_(x.name);
    if (nk) {
      if (!이름중복[nk]) 이름중복[nk] = [];
      이름중복[nk].push(x);
    }
  }

  /*  같은 품목명이 서로 «다른» 코드를 갖는 것 — 하나가 덮어써졌을 때
      가장 잘 드러나는 모습이다.  */
  var 이름같고코드다름 = [];
  Object.keys(이름중복).forEach(function (nk) {
    var arr = 이름중복[nk];
    if (arr.length < 2) return;
    var codes = {};
    arr.forEach(function (x) { codes[_pcw_key_(x.code)] = 1; });
    if (Object.keys(codes).length > 1) 이름같고코드다름.push(arr);
  });

  var 줄 = [];
  줄.push("■ 상품정보 코드 점검 — 모두 " + rows.length + "줄");
  줄.push("");

  줄.push("★ 같은 코드가 두 줄 이상 — " + 중복.length + "건");
  줄.push("  (한 줄의 코드가 다른 물건 것으로 덮어써지면 이렇게 보입니다)");
  중복.slice(0, 30).forEach(function (p) {
    줄.push("  " + p.a.row + "행 " + p.a.code + "  " + p.a.name);
    줄.push("  " + p.b.row + "행 " + p.b.code + "  " + p.b.name);
    줄.push("  ────");
  });
  if (중복.length > 30) 줄.push("  … 그 밖 " + (중복.length - 30) + "건");
  줄.push("");

  줄.push("★ 같은 품목명인데 코드가 다름 — " + 이름같고코드다름.length + "건");
  이름같고코드다름.slice(0, 20).forEach(function (arr) {
    arr.forEach(function (x) { 줄.push("  " + x.row + "행 " + x.code + "  " + x.name); });
    줄.push("  ────");
  });
  줄.push("");

  줄.push("★ 코드 생김새가 어긋남 — " + 이상.length + "건");
  이상.slice(0, 25).forEach(function (x) {
    줄.push("  " + x.row + "행 [" + x.code + "] " + x.why + " · " + x.name);
  });
  줄.push("");

  줄.push("★ 품목명은 있는데 코드가 빔 — " + 빈코드.length + "건");
  빈코드.slice(0, 20).forEach(function (x) { 줄.push("  " + x.row + "행 " + x.name); });

  줄.push("");
  줄.push("고치지 않았습니다. 무엇이 맞는 코드인지는 사장님이 아십니다.");
  줄.push("「📸 코드 찍어 두기」를 눌러 두면, 다음에 「🔍 바뀐 코드 찾기」로");
  줄.push("그 사이에 «무엇이 무엇으로» 바뀌었는지 그대로 볼 수 있습니다.");

  _pcw_show_(줄.join("\n"), "상품정보 코드 점검");
}

/* ══════════════════════════════════════════════════════════════
   ② 찍어 두기 · 바뀐 것 찾기
   ══════════════════════════════════════════════════════════════ */
function _pcw_snapTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PCW_SNAP_TAB_);
  if (tab) return tab;
  tab = ss.insertSheet(_PCW_SNAP_TAB_);
  tab.getRange(1, 1, 1, 4).setValues([["찍은시각", "행", "이카운트코드", "품목명"]])
    .setFontWeight("bold").setBackground("#f1f3f4");
  tab.setFrozenRows(1);
  tab.hideSheet();
  return tab;
}

function productCodeSnapshot() {
  var ui = SpreadsheetApp.getUi();
  var r;
  try { r = _pcw_read_(); } catch (e) { ui.alert(e.message); return; }
  if (!r.rows.length) { ui.alert("읽을 줄이 없습니다."); return; }

  var tab = _pcw_snapTab_();
  var when = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var vals = r.rows.map(function (x) { return [when, x.row, x.code, x.name]; });

  //  ★ 덮어쓴다 ★ 기록을 쌓으면 시트가 무거워지고, 우리가 볼 것은 «직전»뿐이다
  var last = tab.getLastRow();
  if (last > 1) tab.getRange(2, 1, last - 1, 4).clearContent();
  tab.getRange(2, 1, vals.length, 4).setValues(vals);
  SpreadsheetApp.flush();

  ui.alert("코드 찍어 두기",
    when + " 기준 " + vals.length + "줄을 찍어 두었습니다.\n\n" +
    "나중에 「🔍 바뀐 코드 찾기」를 누르면 그 사이에 바뀐 줄이 나옵니다.\n" +
    "(기록은 「" + _PCW_SNAP_TAB_ + "」 탭에 숨겨 둡니다)",
    ui.ButtonSet.OK);
}

function productCodeDiff() {
  var ui = SpreadsheetApp.getUi();
  var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_PCW_SNAP_TAB_);
  if (!tab || tab.getLastRow() < 2) {
    ui.alert("찍어 둔 것이 없습니다.\n\n먼저 「📸 코드 찍어 두기」를 실행하세요.");
    return;
  }
  var r;
  try { r = _pcw_read_(); } catch (e) { ui.alert(e.message); return; }

  var old = tab.getRange(2, 1, tab.getLastRow() - 1, 4).getDisplayValues();
  var when = old.length ? old[0][0] : "";
  var 옛것 = {};
  for (var i = 0; i < old.length; i++) {
    옛것[String(old[i][1])] = { code: String(old[i][2] || ""), name: String(old[i][3] || "") };
  }

  var 바뀜 = [], 새줄 = [], 사라짐 = [];
  var 지금행 = {};
  r.rows.forEach(function (x) {
    지금행[String(x.row)] = 1;
    var o = 옛것[String(x.row)];
    if (!o) { 새줄.push(x); return; }
    if (_pcw_key_(o.code) !== _pcw_key_(x.code)) {
      바뀜.push({ row: x.row, was: o.code, now: x.code, wasName: o.name, nowName: x.name });
    }
  });
  Object.keys(옛것).forEach(function (k) {
    if (!지금행[k]) 사라짐.push({ row: k, code: 옛것[k].code, name: 옛것[k].name });
  });

  var 줄 = [];
  줄.push("■ " + when + " 에 찍어 둔 것과 견줌");
  줄.push("");
  줄.push("★ 코드가 바뀐 줄 — " + 바뀜.length + "건");
  바뀜.slice(0, 40).forEach(function (x) {
    줄.push("  " + x.row + "행  [" + x.was + "] → [" + x.now + "]");
    줄.push("        " + x.nowName +
      (x.wasName && x.wasName !== x.nowName ? "   (전: " + x.wasName + ")" : ""));
  });
  if (바뀜.length > 40) 줄.push("  … 그 밖 " + (바뀜.length - 40) + "건");
  줄.push("");
  줄.push("새로 생긴 줄 " + 새줄.length + "건 · 없어진 줄 " + 사라짐.length + "건");
  줄.push("");
  줄.push("★ 줄이 끼거나 지워졌으면 행 번호가 밀려 «바뀐 것»으로 보입니다.");
  줄.push("  품목명이 함께 바뀐 줄은 그 경우일 수 있습니다 — 이름을 같이 적어 둔 까닭입니다.");

  _pcw_show_(줄.join("\n"), "바뀐 코드 찾기");
}

function _pcw_show_(text, title) {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(
      '<pre style="font-size:11.5px;line-height:1.65;white-space:pre-wrap;' +
      'font-family:monospace;padding:12px">' +
      String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</pre>"
    ).setWidth(780).setHeight(580),
    title
  );
}
