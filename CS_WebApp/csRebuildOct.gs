/**
 * ══════════════════════════════════════════════════════════════
 *  202610 탭을 «협의된 배열»로 새로 만든다  (한 번만 돈다)
 *
 *  > "디. 10월 텝을 새로 만든거로 바꿔줘"   (가. 상태값은 유지)
 *
 *  ★ 왜 ★
 *    지금 202610 은 사람이 손으로 만든 탭에 내가 열을 끼운 것이다.
 *    머리글 이름이 협의안과 여덟 군데 다르고, 서식·너비·유효성이 같다는
 *    보장도 없다. 협의된 탭을 본떠 «깨끗이» 만들고 지금 줄만 옮긴다.
 *
 *  ★ 옮기는 길 — «머리글 이름»으로 ★
 *    자리로 옮기면 한 칸만 달라도 통째로 어긋난다. 2026-10-01 에 그래서
 *    접수날짜 7줄이 지워졌다. 같은 이름끼리 옮기고, 받을 칸이 없는 값은
 *    «버리지 않고» 비고에 붙인다.
 *
 *  ★ 틀 만드는 일은 내가 안 한다 ★
 *    csReturnMonthTab.gs 의 _cs_newReturnTabFromSpec_ 이 만든다. 달마다
 *    만드는 일도 그것을 부른다 — 한 벌이라야 달마다 같은 모양이 나온다.
 *
 *  ★ 옛 탭은 안 지운다 ★
 *    202610_구버전_<날짜시각> 으로 이름만 바꿔 둔다. 달 탭 이름 규칙(^\d{6}$)에
 *    안 걸리므로 읽는 쪽이 두 번 세지 않는다. 눈으로 보고 나중에 지우면 된다.
 *
 *  돌리는 법  —  편집기에서 ▶ 실행 → Ctrl+Enter 로 로그
 *    ① csRebuildOct2026_미리보기   무엇이 어디로 가는지만 «본다». 안 바꾼다.
 *    ② csRebuildOct2026            실제로 바꾼다.
 *
 *  다 쓰면 이 파일은 지운다.
 * ══════════════════════════════════════════════════════════════
 */

var _CS_REBUILD_TAB_ = "202610";

/** 머리글 이름 → 칸번호(0기준). 같은 이름이 둘이면 앞것을 쓴다. */
function _csrb_index_(names) {
  var m = {};
  for (var i = 0; i < names.length; i++) {
    var h = String(names[i] || "").replace(/\s/g, "");
    if (h && m[h] === undefined) m[h] = i;
  }
  return m;
}

/** 자료가 있는 줄만 (빈 줄 버림) */
function _csrb_dataRows_(values, headerIdx) {
  return values.slice(headerIdx + 1).filter(function (r) {
    for (var i = 0; i < r.length; i++) if (String(r[i] == null ? "" : r[i]).trim()) return true;
    return false;
  });
}

/** 비고 칸 — 정식 이름 → 「비고」 들어간 칸 → 맨 끝 */
function _csrb_memoCol_(자리, 이름들) {
  if (자리["비고및추가처리사항"] !== undefined) return 자리["비고및추가처리사항"];
  for (var i = 0; i < 이름들.length; i++) {
    if (/비고/.test(String(이름들[i] || ""))) return i;
  }
  return Math.max(이름들.length - 1, 0);
}

/**
 * 옮김 표를 짠다 — 읽기만 한다. 아무것도 안 바꾼다.
 * @return {{탈:string, 옛이름:Array, 옛자료:Array, 새이름:Array, 짝:Object, 못받는:Array, 비고칸:number}}
 */
function _csrb_plan_(ss) {
  var out = { 탈: "", 옛이름: [], 옛자료: [], 새이름: [], 짝: {}, 못받는: [], 비고칸: 0 };

  var 옛 = ss.getSheetByName(_CS_REBUILD_TAB_);
  if (!옛) { out.탈 = _CS_REBUILD_TAB_ + " 탭이 없습니다."; return out; }
  var 본 = _cs_returnLedgerSpecTab_(ss);
  if (!본) { out.탈 = "협의안 탭(「" + _CS_RETURN_SPEC_TAB_ + "」)이 없습니다."; return out; }

  var 옛폭 = Math.max(옛.getLastColumn(), 15);
  var 옛값 = 옛.getRange(1, 1, Math.max(옛.getLastRow(), 1), 옛폭).getDisplayValues();
  var hi = _cs_findReturnHeaderRow_(옛값);
  if (hi < 0) { out.탈 = "지금 " + _CS_REBUILD_TAB_ + " 에서 머리글 줄을 못 찾았습니다."; return out; }
  out.옛이름 = 옛값[hi].map(function (x) { return String(x || "").replace(/\s/g, ""); });
  out.옛자료 = _csrb_dataRows_(옛값, hi);

  var b = _cs_returnHeaderNames_(본);
  if (!b) { out.탈 = "협의안 탭에서 머리글 줄을 못 찾았습니다."; return out; }
  //  상태값(우리가 끼우는 칸) + 협의안 이름들 — _cs_newReturnTabFromSpec_ 이 만드는 모양과 같다
  out.새이름 = ["상태값"].concat(b.이름);

  var 자리 = _csrb_index_(out.새이름);
  out.비고칸 = _csrb_memoCol_(자리, out.새이름);

  for (var o = 0; o < out.옛이름.length; o++) {
    var nm = out.옛이름[o];
    if (!nm) continue;
    if (자리[nm] !== undefined) out.짝[o] = 자리[nm];
    else out.못받는.push({ 칸: o, 이름: nm });
  }
  return out;
}

/** ① 무엇이 어디로 가는지만 본다 — 아무것도 안 바꾼다 */
function csRebuildOct2026_미리보기() {
  var 줄 = ["■ " + _CS_REBUILD_TAB_ + " → 협의된 배열  (미리보기 · 안 바꿉니다)", ""];
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var p = _csrb_plan_(ss);
  if (p.탈) { 줄.push("★ " + p.탈); return _csrbLog_(줄); }

  줄.push("지금 — " + p.옛이름.filter(String).length + "칸 · 자료 " + p.옛자료.length + "줄");
  줄.push("새로 — " + p.새이름.filter(String).length + "칸 (협의안 " + (p.새이름.length - 1) + " + 상태값)");
  줄.push("");
  줄.push("· 이름끼리 가는 칸");
  var keys = Object.keys(p.짝).sort(function (a, b) { return a - b; });
  for (var i = 0; i < keys.length; i++) {
    var o = Number(keys[i]), n = p.짝[o];
    줄.push("   " + _cs_colLetter_(o) + " " + p.옛이름[o] +
      (o === n ? "   (제자리)" : "   →  " + _cs_colLetter_(n)));
  }
  if (p.못받는.length) {
    줄.push("");
    줄.push("⏸ 새 배열에 «받을 칸이 없는» 머리글 — 값은 비고에 붙입니다");
    for (var m = 0; m < p.못받는.length; m++) {
      var 쓴줄 = 0;
      for (var r = 0; r < p.옛자료.length; r++) {
        if (String(p.옛자료[r][p.못받는[m].칸] == null ? "" : p.옛자료[r][p.못받는[m].칸]).trim()) 쓴줄++;
      }
      줄.push("   " + _cs_colLetter_(p.못받는[m].칸) + " " + p.못받는[m].이름 +
        "  (값 있는 줄 " + 쓴줄 + ")");
    }
  }
  var 안쓰는 = [];
  var 옛맵 = _csrb_index_(p.옛이름);
  for (var k = 0; k < p.새이름.length; k++) {
    if (p.새이름[k] && 옛맵[p.새이름[k]] === undefined) 안쓰는.push(_cs_colLetter_(k) + " " + p.새이름[k]);
  }
  if (안쓰는.length) {
    줄.push("");
    줄.push("· 새로 생기는 빈 칸 — " + 안쓰는.join(", "));
  }
  줄.push("");
  줄.push("이대로 괜찮으면 csRebuildOct2026 을 실행하세요.");
  return _csrbLog_(줄);
}

/** ② 실제로 바꾼다 */
function csRebuildOct2026() {
  var 줄 = ["■ " + _CS_REBUILD_TAB_ + " 을 협의된 배열로 새로 만든다", ""];
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);

  var p = _csrb_plan_(ss);
  if (p.탈) { 줄.push("★ " + p.탈); return _csrbLog_(줄); }

  //  이미 협의안 모양이면 손대지 않는다 — 두 번 돌려도 탈이 없게
  if (!_cs_returnTabShapeNote_(ss, _CS_REBUILD_TAB_)) {
    줄.push("· 이미 협의된 배열입니다 — 아무것도 안 했습니다.");
    return _csrbLog_(줄);
  }
  줄.push("지금 — " + p.옛이름.filter(String).length + "칸 · 자료 " + p.옛자료.length + "줄");

  /* ── 틀을 만든다 (만드는 자리는 csReturnMonthTab.gs 하나) ── */
  var 임시이름 = _CS_REBUILD_TAB_ + "_새것_" +
    Utilities.formatDate(new Date(), "Asia/Seoul", "HHmmss");
  var r = _cs_newReturnTabFromSpec_(ss, 임시이름);
  if (!r.tab) { 줄.push("★ " + r.왜); return _csrbLog_(줄); }
  var 새 = r.tab;
  줄.push("새로 — " + p.새이름.filter(String).length + "칸 (협의안 + 상태값)");

  /* ── 이름끼리 옮긴다 ─────────────────────────────────────── */
  var 옮긴줄 = [];
  for (var i = 0; i < p.옛자료.length; i++) {
    var 새줄 = [];
    for (var c = 0; c < p.새이름.length; c++) 새줄.push("");
    var 덤 = [];
    for (var o = 0; o < p.옛이름.length; o++) {
      var 값 = String(p.옛자료[i][o] == null ? "" : p.옛자료[i][o]).trim();
      if (!값) continue;
      if (p.짝[o] !== undefined) { 새줄[p.짝[o]] = 값; continue; }
      //  받을 칸이 없다 — 버리지 않고 비고에 붙인다
      덤.push((p.옛이름[o] || _cs_colLetter_(o) + "열") + ": " + 값);
    }
    if (덤.length) {
      새줄[p.비고칸] = String(새줄[p.비고칸] || "") +
        (새줄[p.비고칸] ? "\n" : "") + "[옮기며 남은 값] " + 덤.join(" / ");
    }
    옮긴줄.push(새줄);
  }

  var hi2 = _cs_findReturnHeaderRow_(
    새.getRange(1, 1, Math.max(Math.min(새.getLastRow(), 40), 12),
      Math.max(새.getLastColumn(), 15)).getDisplayValues());
  if (hi2 < 0) {
    ss.deleteSheet(새);
    줄.push("★ 새 탭에서 머리글 줄을 못 찾았습니다 — 아무것도 안 했습니다.");
    return _csrbLog_(줄);
  }
  if (옮긴줄.length) {
    새.getRange(hi2 + 2, 1, 옮긴줄.length, p.새이름.length).setValues(옮긴줄);
  }
  SpreadsheetApp.flush();

  /* ── 자리를 넘긴다 ──────────────────────────────────────── */
  var 보관 = _CS_REBUILD_TAB_ + "_구버전_" +
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd-HHmm");
  ss.getSheetByName(_CS_REBUILD_TAB_).setName(보관);
  새.setName(_CS_REBUILD_TAB_);
  try { ss.setActiveSheet(새); ss.moveActiveSheet(0); } catch (eMove) {}

  //  이름이 바뀌었으니 드롭다운을 그 이름으로 다시 건다
  try {
    PropertiesService.getScriptProperties()
      .deleteProperty(_CS_RET_DV_PROP_ + _CS_REBUILD_TAB_);
  } catch (eP) {}
  var 걸림 = false;
  try { 걸림 = !!_cs_ensureReturnStatusDropdown_(새, _CS_REBUILD_TAB_); } catch (eD) {}

  /* ── 나가기 직전 검문 — 원인이 아니라 «결과»를 본다 ────── */
  줄.push("");
  var 말 = _cs_returnTabShapeNote_(ss, _CS_REBUILD_TAB_);
  줄.push(말 ? "⏸ 아직 모양이 다릅니다:\n   " + 말
    : "✅ 모양이 협의된 배열과 같습니다.");

  var 뒤값 = 새.getRange(1, 1, Math.max(새.getLastRow(), 1),
    Math.max(새.getLastColumn(), 15)).getDisplayValues();
  var 뒤줄 = _csrb_dataRows_(뒤값, hi2);
  줄.push((뒤줄.length === p.옛자료.length ? "✅ " : "⏸ ") +
    "줄수 " + p.옛자료.length + " → " + 뒤줄.length);
  줄.push("   상태 드롭다운 " + (걸림 ? "걸었습니다." : "거는 데 실패했습니다(권한·잠금)."));
  줄.push("   옛 탭은 「" + 보관 + "」 로 이름만 바꿔 뒀습니다 — 눈으로 보고 지우세요.");

  if (p.못받는.length) {
    줄.push("");
    줄.push("⏸ 받을 칸이 없던 머리글 — " +
      p.못받는.map(function (x) { return x.이름; }).join(", "));
    줄.push("   그 값은 버리지 않고 비고에 「[옮기며 남은 값] …」 으로 붙였습니다.");
  }

  /* ── 옮긴 줄 몇 개를 실물로 보인다 ─────────────────────── */
  줄.push("");
  줄.push("· 옮긴 줄 (앞 " + Math.min(뒤줄.length, 5) + "개)");
  var 보일칸 = ["상태값", "반품접수날짜", "고객명", "원송장번호", "발생원인"];
  var 새자리 = _csrb_index_(p.새이름);
  for (var s = 0; s < Math.min(뒤줄.length, 5); s++) {
    var 조각 = [];
    for (var v = 0; v < 보일칸.length; v++) {
      var ci = 새자리[보일칸[v]];
      if (ci === undefined) continue;
      조각.push(보일칸[v] + "=" + (String(뒤줄[s][ci] || "").trim() || "—"));
    }
    줄.push("   " + (s + 1) + ") " + 조각.join(" · "));
  }

  줄.push("");
  줄.push("다 됐으면 CS_WebApp/csRebuildOct.gs 를 지우세요 — 한 번 쓰는 것입니다.");

  try { csInvalidateReturnLedgerCache_(); } catch (e) {}
  return _csrbLog_(줄);
}

function _csrbLog_(줄) {
  var 글 = 줄.join("\n");
  Logger.log(글);
  return 글;
}
