/**
 * ══════════════════════════════════════════════════════════════
 *  단가조회 — 값 → 수식 되돌리기
 *
 *  > "단가조회 수식부터 수정하면 좋겠네" / "백업하고 바로 전환"
 *
 *  ★ C열은 건드리지 않는다 ★
 *    기존 복구 함수(priceManager.healViewerRow3Formulas_)는 비소비자 시트의
 *    C3 에 IMPORTRANGE(허브 전체 코드)를 심는다. 그러면 C열이 허브 전체 목록으로
 *    덮여, 「그 업체가 판매할 수 있는 것만」이 그 자리에서 사라진다.
 *    여기서는 A·B·D~I 만 수식으로 바꾼다. J(익월변동단가)도 손대지 않는다 —
 *    기존 복구 함수도 J 는 안 건드린다.
 *
 *  ★ 되돌릴 길을 먼저 만든다 ★
 *    바꾸기 전에 탭을 통째로 복사해 둔다. 값을 걷고 수식을 심는 일은
 *    되돌리기가 어렵다. #REF! 가 나면 그 자리에서 값으로 되돌린다.
 *
 *  ★ 무엇을 잃는지 세어 보고 묻는다 ★
 *    수식은 허브에 없는 코드를 「-」로 만든다. 지금 값으로 남아 있는 이름·단가가
 *    사라진다는 뜻이다. 몇 개인지 세어서 보여 주고, 보고 나서 정하게 한다.
 * ══════════════════════════════════════════════════════════════
 */

var _PTF_TAB_ = "단가조회";
var _PTF_HUB_TAB_ = "전체 그룹 단가표";

function _ptf_key_(s) {
  return String(s == null ? "" : s)
    .replace(/[ ​-‍﻿]/g, "")
    .replace(/\s/g, "")
    .toUpperCase();
}

/** 이 시트가 보는 허브 ID — Z1/Y1 의 IMPORTRANGE 에서 읽는다 */
function _ptf_hubId_(tab) {
  var cells = ["Z1", "Y1"];
  for (var i = 0; i < cells.length; i++) {
    try {
      var f = String(tab.getRange(cells[i]).getFormula() || "");
      var m = f.match(/IMPORTRANGE\s*\(\s*["']([a-zA-Z0-9_-]{30,50})["']/i);
      if (m) return m[1];
    } catch (e) {}
  }
  return _POS_HUB_ID_;   // _partnerOrderSpill.gs 의 값
}

function partnerPriceTabToFormula() {
  var ui = SpreadsheetApp.getUi();

  var files = _prpListVendorFilesForSpill_();
  if (!files.length) { ui.alert("배포파일을 찾지 못했습니다."); return; }
  var 목록 = files.map(function (f, i) { return (i + 1) + ". " + f.name; }).join("\n");
  var pick = ui.prompt("단가조회를 수식으로 되돌리기",
    "어느 업체입니까? 번호를 입력하세요.\n" +
    "한 번에 한 업체만 합니다 — 탈이 나면 그 하나만 되돌리면 됩니다.\n\n" + 목록,
    ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  var n = parseInt(String(pick.getResponseText() || "").trim(), 10);
  if (!(n >= 1 && n <= files.length)) { ui.alert("번호가 올바르지 않습니다."); return; }

  var ss, tab;
  try {
    ss = SpreadsheetApp.openById(files[n - 1].id);
    tab = ss.getSheetByName(_PTF_TAB_);
  } catch (e) { ui.alert("파일을 못 열었습니다: " + e.message); return; }
  if (!tab) { ui.alert("「" + _PTF_TAB_ + "」 탭이 없습니다."); return; }

  var last = tab.getLastRow();
  if (last < 4) { ui.alert("읽을 줄이 없습니다."); return; }

  /* ── ① K2 — 이 업체의 단가그룹 열 번호 ──
     G(최종단가)·I(지난단가)가 이 값을 보고 허브의 «그 업체 등급 열»을 찾는다.
     비어 있으면 모든 업체가 같은 단가를 보게 되거나 전부 「-」가 된다.
     여기서 막지 않으면 잘못된 단가가 업체 화면에 그대로 뜬다. */
  var k2 = "";
  try { k2 = String(tab.getRange("K2").getDisplayValue() || "").trim(); } catch (e) {}
  if (!k2 || !/^\d+$/.test(k2) || parseInt(k2, 10) < 1) {
    ui.alert("멈췄습니다 — K2(단가그룹 열)가 비어 있습니다",
      "K2 = 「" + k2 + "」\n\n" +
      "G(최종단가)·I(지난단가) 수식이 이 값으로 허브의 그 업체 등급 열을 찾습니다.\n" +
      "비어 있으면 단가가 전부 「-」가 되거나 엉뚱한 등급 단가가 뜹니다.\n\n" +
      "「🏢 업체 시트 · 허브 단가」의 단가 새로고침을 먼저 돌려 K2를 채우세요.",
      ui.ButtonSet.OK);
    return;
  }

  var hubId = _ptf_hubId_(tab);

  /* ── ② 지금 값을 다 읽는다 (백업 겸 세어 보기) ── */
  var 폭 = Math.max(tab.getLastColumn(), 10);
  var all = tab.getRange(1, 1, last, 폭).getDisplayValues();

  var 코드수 = 0, 코드들 = [];
  for (var r = 2; r < all.length; r++) {          // 3행(=index 2)부터
    var c = String(all[r][2] || "").trim();       // C열
    if (!c) continue;
    코드수++;
    코드들.push(c);
  }
  if (!코드수) { ui.alert("C열에 코드가 없습니다."); return; }

  /* ── ③ 허브에 없는 코드 세기 — 수식으로 바꾸면 이 줄들이 「-」가 된다 ── */
  var 허브코드 = {}, 허브줄 = 0;
  try {
    var htab = SpreadsheetApp.openById(hubId).getSheetByName(_PTF_HUB_TAB_);
    if (htab && htab.getLastRow() > 2) {
      var hv = htab.getRange(3, 3, htab.getLastRow() - 2, 1).getDisplayValues();
      for (var i = 0; i < hv.length; i++) {
        var k = _ptf_key_(hv[i][0]);
        if (k) { 허브코드[k] = 1; 허브줄++; }
      }
    }
  } catch (eH) {
    ui.alert("허브를 못 읽었습니다: " + eH.message + "\n\n허브를 못 읽으면 무엇을 잃을지 셀 수 없어 멈춥니다.");
    return;
  }
  if (!허브줄) { ui.alert("허브 「" + _PTF_HUB_TAB_ + "」에서 코드를 못 읽었습니다. 멈춥니다."); return; }

  var 없는것 = [];
  for (var j = 0; j < 코드들.length; j++) {
    if (!허브코드[_ptf_key_(코드들[j])]) 없는것.push(코드들[j]);
  }

  /* ── ④ 묻는다 ── */
  var 묻기 = ui.alert("수식으로 되돌립니다 — " + files[n - 1].name,
    "단가조회 " + 코드수 + "줄 · 허브 단가표 " + 허브줄 + "줄\n" +
    "K2(단가그룹 열) = " + k2 + "\n\n" +
    "★ 허브에 없는 코드 " + 없는것.length + "개 ★\n" +
    (없는것.length
      ? "  " + 없는것.slice(0, 12).join(", ") +
        (없는것.length > 12 ? " … 그 밖 " + (없는것.length - 12) + "개" : "") + "\n" +
        "  이 줄들은 품목명·단가가 「-」가 됩니다. 지금은 값이라 남아 있습니다.\n\n"
      : "  없습니다. 잃는 것 없이 바뀝니다.\n\n") +
    "바꾸는 것: A·B·D·E·F·G·H·I 열 (3행에 수식, 아래로 자동)\n" +
    "건드리지 않는 것: C열(취급 품목 코드) · J열\n" +
    "먼저 이 탭을 통째로 복사해 백업합니다.\n\n" +
    "계속할까요?",
    ui.ButtonSet.YES_NO);
  if (묻기 !== ui.Button.YES) return;

  /* ── ⑤ 백업 ── */
  var 도장 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd_HHmm");
  var 백업이름 = _PTF_TAB_ + "_백업_" + 도장;
  try {
    var bk = tab.copyTo(ss);
    bk.setName(백업이름);
    bk.hideSheet();
    SpreadsheetApp.flush();
  } catch (eB) {
    ui.alert("백업을 못 만들어 멈췄습니다: " + eB.message);
    return;
  }

  /* ── ⑥ 값을 걷고 수식을 심는다 ── */
  var ids = 'IMPORTRANGE("' + hubId + '", "' + _PTF_HUB_TAB_ + '!C:C")';
  var hubLink = 'IMPORTRANGE("' + hubId + '", "' + _PTF_HUB_TAB_ + '!';
  function 뽑기(col) {
    return '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' + ids + ', ' +
      hubLink + col + ':' + col + '")), "-")))';
  }
  var gRange = 'SUBSTITUTE(ADDRESS(1, K2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2, 4), "1", "")';
  var iRange = 'SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K2+2, 4), "1", "")';

  try {
    //  A·B 와 D~I 의 «값»을 걷는다. 걷지 않으면 스필이 막혀 #REF! 가 된다
    tab.getRange(3, 1, last - 2, 2).clearContent();     // A:B
    tab.getRange(3, 4, last - 2, 6).clearContent();     // D:I
    SpreadsheetApp.flush();

    tab.getRange("A3").setFormula(뽑기("A"));
    tab.getRange("B3").setFormula(뽑기("B"));
    tab.getRange("D3").setFormula(뽑기("D"));
    tab.getRange("E3").setFormula(뽑기("E"));
    tab.getRange("F3").setFormula(뽑기("F"));
    tab.getRange("G3").setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' + ids +
      ', IMPORTRANGE("' + hubId + '", "' + _PTF_HUB_TAB_ + '!" & ' + gRange + ')), "-")))');
    tab.getRange("I3").setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFNA(XLOOKUP(C3:C, ' + ids +
      ', IMPORTRANGE("' + hubId + '", "' + _PTF_HUB_TAB_ + '!" & ' + iRange + ')), "-")))');
    tab.getRange("H3").setFormula(
      '=ARRAYFORMULA(IF(C3:C="", "", IFERROR(IF(G3:G=I3:I, "-", G3:G-I3:I), "-")))');
    SpreadsheetApp.flush();
  } catch (eW) {
    _ptf_rollback_(tab, all, last, 폭);
    ui.alert("수식을 심다 실패해 값으로 되돌렸습니다: " + eW.message +
      "\n\n백업 탭: " + 백업이름);
    return;
  }

  /* ── ⑦ 결과를 견준다 — 「고쳤다」는 말만 하고 깨진 채 두지 않는다 ── */
  var 깨짐 = [];
  ["A3", "B3", "D3", "E3", "F3", "G3", "H3", "I3"].forEach(function (c) {
    var v = "";
    try { v = String(tab.getRange(c).getDisplayValue() || ""); } catch (e) {}
    if (v.indexOf("#REF") >= 0 || v.indexOf("#ERROR") >= 0 || v.indexOf("#N/A") >= 0) {
      깨짐.push(c + " = " + v);
    }
  });

  if (깨짐.length) {
    _ptf_rollback_(tab, all, last, 폭);
    ui.alert("되돌렸습니다 — 수식이 깨졌습니다",
      깨짐.join("\n") + "\n\n" +
      "값으로 되돌려 놓았습니다. 백업 탭도 남아 있습니다: " + 백업이름 + "\n\n" +
      "#REF! 는 대개 허브 IMPORTRANGE 권한이 끊긴 것입니다.\n" +
      "허브 시트에서 이 파일의 접근을 한 번 허용해 주세요.",
      ui.ButtonSet.OK);
    return;
  }

  //  몇 줄이 「-」가 됐나 — 미리 센 것과 맞는지 본다
  var 뒤 = tab.getRange(3, 3, last - 2, 2).getDisplayValues();
  var 빈이름 = 0;
  for (var q = 0; q < 뒤.length; q++) {
    if (String(뒤[q][0] || "").trim() && String(뒤[q][1] || "").trim() === "-") 빈이름++;
  }

  ui.alert("수식으로 되돌렸습니다",
    files[n - 1].name + " · " + _PTF_TAB_ + "\n\n" +
    "C열에 코드를 적으면 이제 나머지가 딸려옵니다.\n" +
    "품목명이 「-」인 줄: " + 빈이름 + "개 (미리 센 것 " + 없는것.length + "개)\n\n" +
    "백업 탭: " + 백업이름 + " (숨겨 둠)\n" +
    "탈이 나면 그 탭을 복사해 되돌리시면 됩니다.\n\n" +
    "★ 확인 ★ C열 맨 아래에 코드를 하나 적어 보세요.\n" +
    "품목명·단가가 바로 뜨면 된 것입니다.",
    ui.ButtonSet.OK);
}

/** 읽어 둔 값을 그대로 도로 쓴다 */
function _ptf_rollback_(tab, all, last, 폭) {
  try {
    var vals = [];
    for (var r = 2; r < all.length; r++) vals.push(all[r].slice(0, 폭));
    tab.getRange(3, 1, vals.length, 폭).setValues(vals);
    SpreadsheetApp.flush();
  } catch (e) {
    //  여기까지 실패하면 백업 탭이 마지막 보루다 — 그래서 먼저 만들어 둔다
  }
}
