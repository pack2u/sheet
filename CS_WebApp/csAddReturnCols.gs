/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장에 칸 셋을 더한다  (한 번만 돈다)
 *
 *  > "재출고상품, 배송비를 추가해줘"  → 「둘 다 — 칸을 셋 만든다」
 *
 *    재출고상품     우리가 다시 보내는 물건. 상품명 칸은 «돌려받는 것»이다
 *    재출고배송비   우리가 다시 보내며 쓴 돈
 *    반품비         고객이 돌려보낼 때 든 돈 (누가 내나는 귀책으로 갈린다)
 *
 *  ★ 돈을 한 칸에 뭉뚱그리지 않는다 ★
 *    반품에서 돈은 두 번 움직인다. 한 칸에 적으면 「이번 달 우리가 쓴
 *    배송비」를 영영 셀 수 없다.
 *
 *  ★ 맨 뒤에 붙인다 ★
 *    중간에 끼우면 뒤 칸이 전부 밀린다. 대장은 머리글 «이름»으로 읽으니
 *    맨 뒤여도 똑같이 잡힌다. 자리가 안 움직여야 v2 미러도 안 어긋난다.
 *
 *  ★ 협의안 탭에도 넣는다 ★
 *    달 탭은 「202609의 테스트 시트」를 본떠 만들어진다
 *    (csReturnMonthTab._cs_newReturnTabFromSpec_). 거기에 안 넣으면
 *    11월 탭에 이 칸들이 없다 — 한 달 뒤에 조용히 사라진다.
 *
 *  ★ 지난 달 탭은 안 건드린다 ★
 *    202609 이하는 이미 「반품/환불비용」을 갖고 있다. 또 넣으면 같은 뜻의
 *    칸이 둘이 되어 어느 것을 읽을지 알 수 없다.
 *
 *  돌리는 법  —  편집기에서 ▶ 실행 → Ctrl+Enter 로 로그
 *    ① csAddReturnCols_미리보기   무엇이 어디에 붙나만 «본다». 안 바꾼다.
 *    ② csAddReturnCols            실제로 붙인다. 두 번 돌려도 탈이 없다.
 *
 *  다 쓰면 이 파일은 지운다.
 * ══════════════════════════════════════════════════════════════
 */

/** 더할 칸 — 이름이 곧 약속이다. 코드가 이 이름으로 찾는다. */
var _CS_ADD_COLS_ = [
  { 이름: "재출고상품", 폭: 220, 글꼴: "@" },
  { 이름: "재출고배송비", 폭: 110, 글꼴: null },
  { 이름: "반품비", 폭: 110, 글꼴: null },
];

/** 칸을 더할 탭 — 협의안과 이번 달. 지난 달은 안 건드린다. */
function _csac_targets_(ss) {
  var out = [];
  var 본 = ss.getSheetByName(_CS_RETURN_SPEC_TAB_);
  if (본) out.push({ 이름: _CS_RETURN_SPEC_TAB_, tab: 본, 왜: "본 — 다음 달이 물려받는다" });
  var 이번달 = _cs_returnLedgerMonthKey_();
  var t = ss.getSheetByName(이번달);
  if (t) out.push({ 이름: 이번달, tab: t, 왜: "이번 달" });
  return out;
}

/** 그 탭의 머리글 줄과 이름들 */
function _csac_head_(tab) {
  var lc = Math.max(tab.getLastColumn(), 15);
  var v = tab.getRange(1, 1, Math.max(Math.min(tab.getLastRow(), 40), 12), lc).getDisplayValues();
  var hi = _cs_findReturnHeaderRow_(v);
  if (hi < 0) return null;
  var 이름 = [];
  for (var i = 0; i < v[hi].length; i++) 이름.push(String(v[hi][i] || "").replace(/\s/g, ""));
  while (이름.length && !이름[이름.length - 1]) 이름.pop();
  return { 줄: hi + 1, 이름: 이름, 폭: 이름.length };
}

/** ① 무엇이 어디에 붙나만 본다 */
function csAddReturnCols_미리보기() { return _csac_run_(true); }

/** ② 실제로 붙인다 */
function csAddReturnCols() { return _csac_run_(false); }

function _csac_run_(미리보기만) {
  var 줄 = ["■ 반품관리대장에 칸 셋 더하기" + (미리보기만 ? "  (미리보기 · 안 바꿉니다)" : ""), ""];
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var 대상 = _csac_targets_(ss);
  if (!대상.length) { 줄.push("★ 붙일 탭을 못 찾았습니다."); return _csacLog_(줄); }

  for (var t = 0; t < 대상.length; t++) {
    var tab = 대상[t].tab;
    var h = _csac_head_(tab);
    줄.push("· " + 대상[t].이름 + "  (" + 대상[t].왜 + ")");
    if (!h) { 줄.push("   ★ 머리글 줄을 못 찾았습니다 — 건너뜁니다."); continue; }
    줄.push("   머리 " + h.줄 + "행 · 지금 " + h.폭 + "칸");

    var 있는것 = {};
    for (var i = 0; i < h.이름.length; i++) if (h.이름[i]) 있는것[h.이름[i]] = i + 1;

    var 붙일것 = [];
    for (var c = 0; c < _CS_ADD_COLS_.length; c++) {
      var nm = _CS_ADD_COLS_[c].이름;
      if (있는것[nm]) {
        줄.push("   · " + nm + " — 이미 " + _cs_colLetter_(있는것[nm] - 1) + "열에 있습니다");
      } else {
        붙일것.push(_CS_ADD_COLS_[c]);
      }
    }
    if (!붙일것.length) { 줄.push("   ✅ 더할 것이 없습니다."); continue; }

    if (미리보기만) {
      var 끝 = h.폭;
      for (var p = 0; p < 붙일것.length; p++) {
        줄.push("   + " + _cs_colLetter_(끝 + p) + "열 ← " + 붙일것[p].이름);
      }
      continue;
    }

    /*  맨 뒤에 붙인다. getLastColumn 이 아니라 «머리글 폭» 뒤다 —
        누군가 오른쪽 멀리에 메모를 적어 두면 getLastColumn 이 그만큼 커진다.  */
    var at = h.폭;
    for (var k = 0; k < 붙일것.length; k++) {
      var 칸 = at + k + 1;                       // 1기준
      if (칸 > tab.getMaxColumns()) tab.insertColumnsAfter(tab.getMaxColumns(), 칸 - tab.getMaxColumns());
      var 머리칸 = tab.getRange(h.줄, 칸);
      머리칸.setValue(붙일것[k].이름).setFontWeight("bold");
      //  머리글 모양은 «옆 칸»에서 가져온다 — 색을 코드에 박으면 테마가 바뀔 때 혼자 튄다
      try {
        tab.getRange(h.줄, at).copyTo(머리칸, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        머리칸.setValue(붙일것[k].이름);
      } catch (eF) {}
      if (붙일것[k].글꼴) {
        //  글로 잠근다 — 품목명이 날짜·숫자로 바뀌어 적히는 것을 막는다
        tab.getRange(h.줄 + 1, 칸, Math.max(1, tab.getMaxRows() - h.줄), 1)
          .setNumberFormat(붙일것[k].글꼴);
      }
      try { tab.setColumnWidth(칸, 붙일것[k].폭); } catch (eW) {}
      줄.push("   + " + _cs_colLetter_(칸 - 1) + "열 ← " + 붙일것[k].이름);
    }
  }

  SpreadsheetApp.flush();
  줄.push("");
  if (미리보기만) {
    줄.push("이대로 괜찮으면 csAddReturnCols 를 실행하세요.");
    return _csacLog_(줄);
  }

  /* ── 나가기 직전 검문 — 결과를 다시 잰다 ─────────────────── */
  var 탈 = 0;
  for (var z = 0; z < 대상.length; z++) {
    var h2 = _csac_head_(대상[z].tab);
    if (!h2) { 줄.push("★ " + 대상[z].이름 + " — 다시 읽지 못했습니다."); 탈++; continue; }
    var 없는것 = [];
    for (var y = 0; y < _CS_ADD_COLS_.length; y++) {
      if (h2.이름.indexOf(_CS_ADD_COLS_[y].이름) < 0) 없는것.push(_CS_ADD_COLS_[y].이름);
    }
    줄.push((없는것.length ? "★ " : "✅ ") + 대상[z].이름 + " — " + h2.폭 + "칸" +
      (없는것.length ? " · 아직 없는 칸: " + 없는것.join(", ") : " · 셋 다 있습니다"));
    if (없는것.length) 탈++;
  }

  줄.push("");
  줄.push("▶ 다음");
  줄.push("   ① CS 웹앱에서 반품 카드를 하나 기록해 보세요 — 반품비가 비고가 아니라");
  줄.push("      「반품비」 칸에 들어가야 맞습니다.");
  줄.push("   ② 허브에서 partnerMirrorReturnsToV2 를 한 번 돌리세요 — v2 가 새 칸을 읽습니다.");
  줄.push("");
  줄.push("다 됐으면 CS_WebApp/csAddReturnCols.gs 를 지우세요 — 한 번 쓰는 것입니다.");

  try { csInvalidateReturnLedgerCache_(); } catch (e) {}
  return _csacLog_(줄);
}

function _csacLog_(줄) {
  var 글 = 줄.join("\n");
  Logger.log(글);
  return 글;
}
