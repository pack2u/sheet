/**
 * ══════════════════════════════════════════════════════════════
 *  발주탭 자동 수식 — 끝을 열어 준다
 *
 *  2026-09-20. 포털 발주 넣기를 「넣어 보기」로 시험하다 드러났다.
 *
 *    > 자동 수식 범위가 500행까지입니다. 501행까지 넣으면
 *    >  품목명·정산금액이 빈칸으로 남습니다
 *
 *  지금 코드가 만드는 수식은 전부 `C2:C` 로 끝이 열려 있다
 *  (priceManager.buildOrderUnitPriceSpillFormula_ 등). 그런데 예전에 심긴
 *  수식 중에 `C2:C500` 처럼 «끝이 박힌» 것이 남아 있다. 허브도 그 경우를
 *  알고 있다 — _partnerOrders 의 스필 점검이 /C2:C(\d+)/ 를 읽는다.
 *
 *  범위가 박혀 있으면 그 행을 넘는 순간 품목명·정산금액이 빈칸이 되고,
 *  그대로 수집되면 «이름 없는 발주»가 된다. 조용한 사고다.
 *  포털로 넣든 시트에 손으로 적든 똑같이 일어난다 — 포털 때문에 생긴
 *  문제가 아니라, 포털이 먼저 보이게 해 준 문제다.
 *
 *  ★ 통째로 다시 심지 않는다 ★
 *    injectOrderSpillFormulas_ 로 갈아엎으면 그 업체가 손본 것까지 날아간다.
 *    여기서는 «박힌 끝»만 지운다. C2:C500 → C2:C. 그 밖은 한 글자도 안 건드린다.
 *
 *  ★ 다른 탭을 가리키는 범위는 손대지 않는다 ★
 *    VLOOKUP 이 '단가조회'!A2:G500 처럼 남의 탭을 볼 때가 있다. 그건 일부러
 *    묶어 둔 것일 수 있다. `!` 뒤에 오는 범위는 건너뛴다.
 * ══════════════════════════════════════════════════════════════
 */

var _POS_ORDER_TAB_ = "발주 및 송장조회";

/*  ★ D1·L1 만 다룬다 ★  (2026-09-21 · 처음엔 A1·N1 까지 넣었다가 물렸다)

    A1(거래처명)·N1(상태)의 수식은 «빈 문자열을 뿌리는» 것이 일이다.
      =ARRAYFORMULA(IF(LEN(C2:C500)+LEN(D2:D500)=0, "", …))
    500행까지면 넉넉하고, 열어 두면 A열이 시트 끝까지 빈 문자열로 차서
    getLastRow() 가 늘 1000쯤으로 잡힌다 — 더 나빠진다.

    정작 «데이터에 닿아야» 하는 것은 D1(품목명)·L1(정산금액)이다.
    당장드림은 이 둘이 89행까지였다. 90행부터는 품목명이 안 채워진다.
    허브도 못 메운다 — _po_refreshAutofillBeforeCollect_ 는 D1 에 수식이
    있으면(dHasF) 손대지 않기 때문이다.  */
var _POS_CELLS_ = ["D1", "L1"];

/**
 * 한 수식에서 «자기 탭» 범위의 박힌 끝만 지운다.
 * @return {string} 바꾼 수식. 바꿀 것이 없으면 원문 그대로.
 */
function _pos_openRanges_(formula) {
  var s = String(formula || "");
  if (!s) return s;
  var out = "";
  var re = /([A-Z]{1,2})(\d+):([A-Z]{1,2})(\d+)/g;
  var last = 0, m;
  while ((m = re.exec(s)) !== null) {
    var 앞 = s.substring(0, m.index);
    /*  바로 앞이 `!` 면 남의 탭 범위다 — 건드리지 않는다.
        (`'단가조회'!A2:G500` 의 A2:G500 이 여기 걸린다)  */
    var 남의탭 = /!\s*\$?$/.test(앞) || /!\s*$/.test(앞);
    out += s.substring(last, m.index);
    /*  ★ 2행뿐 아니라 3행부터도 ★  (2026-09-21)
        발주탭은 머리글이 1행이라 C2:C 지만, 단가조회는 수식 줄이 3행이라
        C3:C 다. 2행만 보다가 단가조회를 통째로 놓쳤다.  */
    if (남의탭 || m[1] !== m[3] || (m[2] !== "2" && m[2] !== "3")) {
      out += m[0];            // 그대로 둔다
    } else {
      out += m[1] + m[2] + ":" + m[3];   // C3:C91 → C3:C
    }
    last = m.index + m[0].length;
  }
  out += s.substring(last);
  return out;
}

/** 발주탭 한 개를 살핀다 */
function _pos_scanTab_(tab) {
  var 결과 = [];
  for (var i = 0; i < _POS_CELLS_.length; i++) {
    var cell = _POS_CELLS_[i];
    var f = "";
    try { f = String(tab.getRange(cell).getFormula() || ""); } catch (e) { continue; }
    if (!f) continue;
    var 새것 = _pos_openRanges_(f);
    if (새것 === f) continue;
    //  박힌 끝이 몇 행이었는지 — 사람에게 말해 주려고 뽑는다
    var 끝 = 0;
    var mm = f.match(/([A-Z]{1,2})2:\1(\d+)/g) || [];
    for (var k = 0; k < mm.length; k++) {
      var n = parseInt(String(mm[k]).replace(/[^0-9]/g, "").replace(/^2/, ""), 10);
      if (n > 끝) 끝 = n;
    }
    /*  ★ 열기 전에 «아래에 값이 있는지» 본다 ★  (2026-09-21)

        스필은 갈 길에 값이 하나라도 있으면 통째로 #REF! 가 된다. 그러면
        품목명 열이 그 자리에서 깨지고, 그 탭의 모든 줄이 이름을 잃는다.
        범위가 89행까지였다는 것은 그 아래에 사람이·스크립트가 값을 넣어
        막고 있었다는 뜻일 수 있다. 확인하지 않고 열면 안 된다.  */
    var 막는줄 = 0, 막는값 = "";
    try {
      var c = tab.getRange(cell).getColumn();
      var lr = tab.getLastRow();
      if (끝 && lr > 끝 + 1) {
        var 아래 = tab.getRange(끝 + 2, c, lr - (끝 + 1), 1).getDisplayValues();
        for (var a = 0; a < 아래.length; a++) {
          var v = String(아래[a][0] || "").trim();
          if (v) { 막는줄 = 끝 + 2 + a; 막는값 = v.substring(0, 30); break; }
        }
      }
    } catch (eB) {}

    결과.push({ cell: cell, was: f, now: 새것, end: 끝, blockRow: 막는줄, blockVal: 막는값 });
  }
  return 결과;
}

/**
 * 협력업체 배포파일들의 발주탭 자동 수식 끝을 연다.
 * @param {boolean} apply  false 면 «보기만» 한다.
 */
function _pos_run_(apply) {
  var ui = SpreadsheetApp.getUi();
  var files = [];
  try {
    files = _prpListVendorFilesForSpill_();
  } catch (e) {
    ui.alert("배포파일 목록을 못 읽었습니다: " + e.message);
    return;
  }
  if (!files.length) { ui.alert("배포파일을 찾지 못했습니다."); return; }

  var 걸린것 = [], 본것 = 0, 못연것 = [];
  for (var i = 0; i < files.length; i++) {
    var ss;
    try { ss = SpreadsheetApp.openById(files[i].id); }
    catch (e) { 못연것.push(files[i].name); continue; }
    var tab = ss.getSheetByName(_POS_ORDER_TAB_);
    if (!tab) continue;
    본것++;
    var hits = _pos_scanTab_(tab);
    if (!hits.length) continue;
    걸린것.push({ name: files[i].name, tab: tab, hits: hits });
  }

  if (!걸린것.length) {
    ui.alert("발주탭 자동 수식 점검",
      본것 + "개 파일을 봤습니다.\n\n끝이 박힌 수식은 없습니다 — 모두 열려 있습니다.",
      ui.ButtonSet.OK);
    return;
  }

  var 줄 = 걸린것.map(function (v) {
    return "· " + v.name + "  —  " +
      v.hits.map(function (h) {
        return h.cell + " (" + (h.end || "?") + "행까지)" +
          (h.blockRow ? " ⚠" + h.blockRow + "행에 값「" + h.blockVal + "」— 못 엽니다" : "");
      }).join(", ");
  }).join("\n");

  var 막힌수 = 0;
  for (var q = 0; q < 걸린것.length; q++) {
    for (var w = 0; w < 걸린것[q].hits.length; w++) {
      if (걸린것[q].hits[w].blockRow) 막힌수++;
    }
  }

  if (!apply) {
    ui.alert("끝이 박힌 수식 " + 걸린것.length + "개 파일",
      줄 + "\n\n지금은 «보기만» 했습니다. 고치려면 같은 메뉴의\n" +
      "「끝 열기 (반영)」을 실행하세요.",
      ui.ButtonSet.OK);
    return;
  }

  var ans = ui.alert("끝 열기 — 반영",
    줄 + "\n\n품목명(D1)·정산금액(L1)의 «박힌 끝»만 지웁니다 (C2:C89 → C2:C).\n" +
    (막힌수 ? "⚠ 표시가 붙은 " + 막힌수 + "곳은 아래에 값이 있어 건너뜁니다.\n" +
      "   그대로 열면 스필이 막혀 품목명 열이 통째로 #REF! 가 됩니다.\n" : "") +
    "그 밖의 내용은 한 글자도 바꾸지 않습니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;

  /*  ★ 시간 제한에 걸려도 이어서 할 수 있게 ★  (2026-09-21)
      38개 파일을 열고 수식을 쓰고 결과까지 견주면 6분을 넘길 수 있다.
      넘길 것 같으면 «끊고 말한다». 고친 파일은 다음 점검에서 안 걸리므로
      같은 메뉴를 한 번 더 누르면 남은 것부터 이어 간다.  */
  var 시작 = new Date().getTime();
  var 시간다됨 = false;

  var 고침 = 0, 건너뜀 = [], 실패 = [], 남음 = 0;
  for (var v = 0; v < 걸린것.length; v++) {
    if (시간다됨) { 남음++; continue; }
    if (new Date().getTime() - 시작 > 260000) { 시간다됨 = true; 남음++; continue; }
    for (var h = 0; h < 걸린것[v].hits.length; h++) {
      var hit = 걸린것[v].hits[h];
      if (hit.blockRow) {
        건너뜀.push(걸린것[v].name + " " + hit.cell + " — " + hit.blockRow + "행에 값이 있음");
        continue;
      }
      try {
        걸린것[v].tab.getRange(hit.cell).setFormula(hit.now);
        //  ★ 연 자리를 바로 견준다 ★ #REF! 가 나면 되돌린다.
        //    「고쳤다」는 말만 하고 깨진 채 두는 것이 가장 나쁘다.
        SpreadsheetApp.flush();
        var 결과 = String(걸린것[v].tab.getRange(hit.cell).getDisplayValue() || "");
        if (결과.indexOf("#REF") >= 0 || 결과.indexOf("#ERROR") >= 0) {
          걸린것[v].tab.getRange(hit.cell).setFormula(hit.was);
          SpreadsheetApp.flush();
          실패.push(걸린것[v].name + " " + hit.cell + ": " + 결과 + " — 되돌렸습니다");
          continue;
        }
        고침++;
      } catch (e) {
        실패.push(걸린것[v].name + " " + hit.cell + ": " + e.message);
      }
    }
  }
  SpreadsheetApp.flush();

  ui.alert(시간다됨 ? "끝 열기 — 이어서 해 주세요" : "끝 열기 완료",
    고침 + "곳을 고쳤습니다." +
    (시간다됨
      ? "\n\n★ 시간 제한에 걸려 " + 남음 + "개 파일이 남았습니다.\n" +
        "   같은 메뉴를 한 번 더 누르면 남은 것부터 이어 갑니다.\n" +
        "   (고친 파일은 다시 안 걸립니다)"
      : "") +
    (건너뜀.length ? "\n\n건너뛴 것 (아래에 값이 있어 열면 깨집니다):\n" + 건너뜀.join("\n") : "") +
    (실패.length ? "\n\n못 고친 것:\n" + 실패.join("\n") : "") +
    "\n\n★ 확인 ★ 발주탭 마지막 줄 아래에 이카운트코드를 하나 적어 보시면\n" +
    "품목명·정산금액이 바로 채워져야 합니다.",
    ui.ButtonSet.OK);
}

/** 협력업체 배포파일 목록 — 포털이 쓰는 폴더와 같은 곳을 본다 */
function _prpListVendorFilesForSpill_() {
  var folders = ["1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl", "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v"];
  var seen = {}, out = [];
  for (var i = 0; i < folders.length; i++) {
    var files;
    try { files = DriveApp.getFolderById(folders[i]).getFiles(); }
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

/* ══════════════════════════════════════════════════════════════
   단가조회 수식 그대로 보기  (2026-09-21)

   > "원래 C열에 코드를 넣으면 나머지 부분이 바로 딸려오는 시스템이었어..
   >  해당업체가 판매할수 있는 것만 정할수 있게.."

   코드를 넣어도 아무것도 안 딸려온다. 까닭을 «추측하지 않는다» —
   오늘 두 번 잘못 짚었다. 실제로 그 칸에 무엇이 적혀 있는지 그대로 보고
   판단한다. 읽기만 하고 아무것도 바꾸지 않는다.
   ══════════════════════════════════════════════════════════════ */
function partnerPriceTabInspect() {
  var ui = SpreadsheetApp.getUi();
  var files = _prpListVendorFilesForSpill_();
  if (!files.length) { ui.alert("배포파일을 찾지 못했습니다."); return; }

  var 목록 = files.map(function (f, i) { return (i + 1) + ". " + f.name; }).join("\n");
  var pick = ui.prompt("단가조회 수식 보기",
    "번호를 입력하세요. 읽기만 하고 아무것도 바꾸지 않습니다.\n\n" + 목록,
    ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  var n = parseInt(String(pick.getResponseText() || "").trim(), 10);
  if (!(n >= 1 && n <= files.length)) { ui.alert("번호가 올바르지 않습니다."); return; }

  var ss, tab;
  try {
    ss = SpreadsheetApp.openById(files[n - 1].id);
    tab = ss.getSheetByName("단가조회");
  } catch (e) { ui.alert("파일을 못 열었습니다: " + e.message); return; }
  if (!tab) { ui.alert("「단가조회」 탭이 없습니다."); return; }

  var 줄 = [];
  줄.push("■ " + files[n - 1].name + " · 단가조회");
  줄.push("마지막 행: " + tab.getLastRow() + " · 마지막 열: " + tab.getLastColumn());
  줄.push("");

  //  수식이 걸리는 자리 — 3행 A~J 와 코드열(C)의 아래쪽 몇 칸
  var 칸 = ["A3", "B3", "C3", "D3", "E3", "F3", "G3", "H3", "I3", "J3"];
  for (var i = 0; i < 칸.length; i++) {
    var f = "", v = "";
    try { f = String(tab.getRange(칸[i]).getFormula() || ""); } catch (e1) {}
    try { v = String(tab.getRange(칸[i]).getDisplayValue() || ""); } catch (e2) {}
    if (!f && !v) continue;
    줄.push(칸[i] + "  값[" + v.substring(0, 28) + "]");
    if (f) 줄.push("     식 " + f.substring(0, 200));
  }

  /*  코드열 마지막 값이 몇 행인지 — 새 코드를 어디에 넣어야 하는지가 이것이다  */
  줄.push("");
  var lastCode = 0, lastName = 0;
  try {
    var all = tab.getRange(1, 1, tab.getLastRow(), 4).getDisplayValues();
    for (var r = 0; r < all.length; r++) {
      if (String(all[r][2] || "").trim()) lastCode = r + 1;
      if (String(all[r][3] || "").trim()) lastName = r + 1;
    }
  } catch (e3) {}
  줄.push("코드(C열) 마지막 행: " + lastCode);
  줄.push("품목명(D열) 마지막 행: " + lastName);
  if (lastCode > lastName) {
    줄.push("★ 코드는 " + lastCode + "행까지 있는데 품목명은 " + lastName +
      "행에서 끊겼습니다 — 수식이 거기까지만 닿는다는 뜻입니다.");
  }

  ui.showModalDialog(
    HtmlService.createHtmlOutput(
      '<pre style="font-size:11px;line-height:1.6;white-space:pre-wrap;' +
      'font-family:monospace;padding:12px">' +
      줄.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</pre>"
    ).setWidth(720).setHeight(520),
    "단가조회 수식 (읽기만)"
  );
}

/* ══════════════════════════════════════════════════════════════
   코드 한 개를 끝까지 쫓는다  (2026-09-21)

   「단가조회에 없다」는 말이 세 번 나왔고, 그때마다 내가 못 본 것이기도 했고
   정말 없기도 했다. 이제 «어디에 있고 어디에 없는지»를 한 번에 본다.
     · 그 업체 단가조회
     · 허브 「전체 그룹 단가표」
   그리고 비슷한 코드를 같이 보여 준다 — 코드가 바뀐 것인지 빠진 것인지는
   옆 코드를 봐야 안다 (HPKAN00001 · HPKAN20001 처럼).
   읽기만 한다.
   ══════════════════════════════════════════════════════════════ */
var _POS_HUB_ID_ = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";
var _POS_HUB_TAB_ = "전체 그룹 단가표";

function _pos_codeKey_(s) {
  return String(s == null ? "" : s)
    .replace(/[ ​-‍﻿]/g, "")
    .replace(/\s/g, "")
    .toUpperCase();
}

/** 한 탭에서 코드를 찾는다 — 같은 것과 «비슷한 것»을 같이 준다 */
function _pos_findCode_(tab, codeCol, nameCol, want) {
  var out = { hit: null, near: [] };
  if (!tab || tab.getLastRow() < 2) return out;
  var lastCol = Math.max(nameCol, codeCol) + 1;
  var all;
  try { all = tab.getRange(1, 1, tab.getLastRow(), lastCol).getDisplayValues(); }
  catch (e) { return out; }

  var key = _pos_codeKey_(want);
  var 앞 = key.replace(/[0-9_]+$/, "");        // 끝의 숫자를 뗀 몸통
  if (앞.length < 3) 앞 = key.substring(0, Math.min(5, key.length));

  for (var r = 0; r < all.length; r++) {
    var c = _pos_codeKey_(all[r][codeCol]);
    if (!c) continue;
    var nm = String(all[r][nameCol] || "").trim();
    if (c === key) { out.hit = { row: r + 1, code: all[r][codeCol], name: nm }; continue; }
    if (앞 && c.indexOf(앞) === 0 && out.near.length < 12) {
      out.near.push({ row: r + 1, code: all[r][codeCol], name: nm });
    }
  }
  return out;
}

function partnerPriceCodeTrace() {
  var ui = SpreadsheetApp.getUi();
  var ask = ui.prompt("코드 찾아보기",
    "이카운트코드를 입력하세요. 읽기만 합니다.\n\n" +
    "그 업체 단가조회와 허브 「" + _POS_HUB_TAB_ + "」 양쪽에서 찾고,\n" +
    "비슷한 코드도 같이 보여 드립니다.",
    ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;
  var code = String(ask.getResponseText() || "").trim();
  if (!code) return;

  var files = _prpListVendorFilesForSpill_();
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
      var v = _pos_findCode_(vtab, 2, 3, code);
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
    var htab = SpreadsheetApp.openById(_POS_HUB_ID_).getSheetByName(_POS_HUB_TAB_);
    if (!htab) 줄.push("허브 「" + _POS_HUB_TAB_ + "」 탭 없음");
    else {
      var h = _pos_findCode_(htab, 2, 3, code);
      줄.push("[허브 · " + _POS_HUB_TAB_ + "]  모두 " + (htab.getLastRow() - 2) + "줄");
      줄.push(h.hit ? "  ✅ " + h.hit.row + "행 — " + h.hit.name : "  ❌ 없음");
      if (h.near.length) {
        줄.push("  비슷한 코드:");
        h.near.forEach(function (x) { 줄.push("    " + x.code + "  " + x.name); });
      }
    }
  } catch (e2) { 줄.push("허브 읽기 실패: " + e2.message); }

  줄.push("");
  줄.push("허브에 없으면 → 허브 단가표에 넣어야 모든 업체로 내려갑니다.");
  줄.push("허브에는 있는데 업체에 없으면 → 그 업체로 단가를 다시 밀어야 합니다.");

  ui.showModalDialog(
    HtmlService.createHtmlOutput(
      '<pre style="font-size:11.5px;line-height:1.65;white-space:pre-wrap;' +
      'font-family:monospace;padding:12px">' +
      줄.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</pre>"
    ).setWidth(760).setHeight(560),
    "코드 찾아보기 (읽기만)"
  );
}

/** 메뉴 — 보기만 */
function partnerOrderSpillCheck() { _pos_run_(false); }

/** 메뉴 — 반영 */
function partnerOrderSpillOpen() { _pos_run_(true); }
