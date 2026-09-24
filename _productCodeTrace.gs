/**
 * ══════════════════════════════════════════════════════════════
 *  코드 한 개를 끝까지 쫓는다
 *
 *  「이 코드가 왜 안 나오지」는 앞으로도 계속 생기는 물음이다.
 *  그때마다 시트를 열어 눈으로 찾지 않게, 한 번에 답한다.
 *    · 그 업체 단가조회에 있는가 (몇 행)
 *    · 허브 「전체 그룹 단가표」에 있는가 (몇 행)
 *    · 몸통이 같은 «비슷한 코드»는 무엇이 있는가
 *
 *  ★ 비슷한 코드를 같이 준다 ★  빠진 것인지 «코드가 바뀐 것»인지는 옆 코드를
 *    봐야 안다. HPKAN00001 이 없고 HPKAN20001 이 있으면 대개 후자다.
 *
 *  ★ 보이지 않는 글자를 걷고 견준다 ★  엑셀에서 긁어 붙이면 줄바꿈 없는
 *    빈칸(NBSP)이 섞인다. 허브 발주탭 수식도 CHAR(160) 을 지우고 본다.
 *
 *  읽기만 한다. 아무것도 고치지 않는다.
 *
 *  ── 2026-09-21 ──
 *  이 파일은 그날 만든 도구들 중 «남긴 것»이다. 단가조회 값→수식 전환과
 *  발주탭 수식 끝 열기는 한 번 돌리고 끝나는 일이라 메뉴·함수를 함께 지웠다.
 *  한 번 쓰고 끝날 것은 끝나면 지운다 — 안 지우면 쌓여서 매일 쓰는 걸 못 찾는다.
 * ══════════════════════════════════════════════════════════════
 */

var _PCT_HUB_ID_ = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";
var _PCT_HUB_TAB_ = "전체 그룹 단가표";
var _PCT_VENDOR_FOLDERS_ = [
  "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl",
  "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v"
];

/** 협력업체 배포파일 목록 — 포털이 쓰는 폴더와 같은 곳을 본다 */
function _pct_listVendorFiles_() {
  var seen = {}, out = [];
  for (var i = 0; i < _PCT_VENDOR_FOLDERS_.length; i++) {
    var files;
    try { files = DriveApp.getFolderById(_PCT_VENDOR_FOLDERS_[i]).getFiles(); }
    catch (e) { continue; }
    while (files.hasNext()) {
      var f = files.next();
      var nm = f.getName();
      if (nm.indexOf("[협력업체]") < 0) continue;
      var id = f.getId();
      if (seen[id]) continue;
      seen[id] = true;
      out.push({ id: id, name: nm });
    }
  }
  return out;
}

function _pct_codeKey_(s) {
  return String(s == null ? "" : s)
    .replace(/[ ​-‍﻿]/g, "")
    .replace(/\s/g, "")
    .toUpperCase();
}

/** 한 탭에서 코드를 찾는다 — 같은 것과 «비슷한 것»을 같이 준다 */
function _pct_findCode_(tab, codeCol, nameCol, want) {
  var out = { hit: null, near: [] };
  if (!tab || tab.getLastRow() < 2) return out;
  var lastCol = Math.max(nameCol, codeCol) + 1;
  var all;
  try { all = tab.getRange(1, 1, tab.getLastRow(), lastCol).getDisplayValues(); }
  catch (e) { return out; }

  var key = _pct_codeKey_(want);
  var 몸통 = key.replace(/[0-9_]+$/, "");       // 끝의 숫자를 뗀 몸통
  if (몸통.length < 3) 몸통 = key.substring(0, Math.min(5, key.length));

  for (var r = 0; r < all.length; r++) {
    var c = _pct_codeKey_(all[r][codeCol]);
    if (!c) continue;
    var nm = String(all[r][nameCol] || "").trim();
    if (c === key) { out.hit = { row: r + 1, code: all[r][codeCol], name: nm }; continue; }
    if (몸통 && c.indexOf(몸통) === 0 && out.near.length < 12) {
      out.near.push({ row: r + 1, code: all[r][codeCol], name: nm });
    }
  }
  return out;
}

function partnerPriceCodeTrace() {
  var ui = SpreadsheetApp.getUi();
  var ask = ui.prompt("코드 찾아보기",
    "이카운트코드를 입력하세요. 읽기만 합니다.\n\n" +
    "그 업체 단가조회와 허브 「" + _PCT_HUB_TAB_ + "」 양쪽에서 찾고,\n" +
    "비슷한 코드도 같이 보여 드립니다.",
    ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;
  var code = String(ask.getResponseText() || "").trim();
  if (!code) return;

  var files = _pct_listVendorFiles_();
  if (!files.length) { ui.alert("배포파일을 찾지 못했습니다."); return; }
  var 목록 = files.map(function (f, i) { return (i + 1) + ". " + f.name; }).join("\n");
  var pick = ui.prompt("어느 업체 단가조회에서 볼까요",
    "번호를 입력하세요.\n\n" + 목록, ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  var n = parseInt(String(pick.getResponseText() || "").trim(), 10);
  if (!(n >= 1 && n <= files.length)) { ui.alert("번호가 올바르지 않습니다."); return; }

  var 줄 = ["■ 찾는 코드: " + code, ""];

  //  ① 업체 단가조회 (C=코드, D=품목명)
  try {
    var vtab = SpreadsheetApp.openById(files[n - 1].id).getSheetByName("단가조회");
    if (!vtab) 줄.push("[" + files[n - 1].name + "] 단가조회 탭 없음");
    else {
      var v = _pct_findCode_(vtab, 2, 3, code);
      줄.push("[" + files[n - 1].name + " · 단가조회]  모두 " + (vtab.getLastRow() - 2) + "줄");
      줄.push(v.hit ? "  ✅ " + v.hit.row + "행 — " + v.hit.name : "  ❌ 없음");
      if (v.near.length) {
        줄.push("  비슷한 코드:");
        v.near.forEach(function (x) { 줄.push("    " + x.code + "  " + x.name); });
      }
    }
  } catch (e) { 줄.push("업체 파일 읽기 실패: " + e.message); }

  줄.push("");

  //  ② 허브 전체 그룹 단가표 (C=코드, D=품목명 — 배포와 같은 자리)
  try {
    var htab = SpreadsheetApp.openById(_PCT_HUB_ID_).getSheetByName(_PCT_HUB_TAB_);
    if (!htab) 줄.push("허브 「" + _PCT_HUB_TAB_ + "」 탭 없음");
    else {
      var h = _pct_findCode_(htab, 2, 3, code);
      줄.push("[허브 · " + _PCT_HUB_TAB_ + "]  모두 " + (htab.getLastRow() - 2) + "줄");
      줄.push(h.hit ? "  ✅ " + h.hit.row + "행 — " + h.hit.name : "  ❌ 없음");
      if (h.near.length) {
        줄.push("  비슷한 코드:");
        h.near.forEach(function (x) { 줄.push("    " + x.code + "  " + x.name); });
      }
    }
  } catch (e2) { 줄.push("허브 읽기 실패: " + e2.message); }

  줄.push("");
  줄.push("허브에 없으면 → 허브 단가표에 넣어야 모든 업체로 내려갑니다.");
  줄.push("허브에는 있는데 업체에 없으면 → 그 업체 단가조회 C열에 코드를 적으면 됩니다.");

  //  _productCodeWatch.gs 의 창을 같이 쓴다
  _pcw_show_(줄.join("\n"), "코드 찾아보기 (읽기만)");
}
