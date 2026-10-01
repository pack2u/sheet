/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장 월 탭 — 날짜가 바뀌기 «전»에 미리 만들어 둔다
 *
 *  > "월 탭은 매달 사람이 새로 만듭니다." → "자동으로 만들게 해줘"
 *  > "날짜가 바뀌면 알아서 생성 되게 해줘.. 아니면 9월 말일에 미리 생성을 해놓던가"
 *
 *  ★ 만드는 길은 «원래 있었다» ★
 *    _cs_getReturnLedgerTab_ 이 전달 탭을 본떠 만든다. 그런데 «쓸 때가 되어서야»
 *    만든다 — 그 달 첫 카드를 올리는 순간이다. 그 전에 사람이 먼저 만들면
 *    그 길은 영영 안 돈다.
 *
 *    2026-10-01 에 그랬다. 사람이 만든 202610 은 9월과 열 구조가 달랐고
 *    (A=반품접수날짜 · 상태 열 없음), 코드는 A 를 상태로 못 박고 있어
 *    그날 올라간 7줄이 전부 접수날짜를 잃었다. 최신순에서 사라졌다.
 *
 *  ★ 그래서 «먼저» 만든다 ★
 *    매일 돌면서 —
 *      ① 이번 달 탭이 없으면 만든다        (날짜가 바뀌면 알아서)
 *      ② 달 끝 5일 전부터 다음 달 탭을 만든다 (말일에 미리)
 *    둘 다 전달 탭을 본뜨므로 구조가 저절로 이어진다.
 *
 *  ★ 있는 탭은 건드리지 않는다 ★
 *    이미 있으면 아무것도 안 한다. 다만 «모양이 전달과 다르면» 말해 준다 —
 *    사람이 만든 탭일 수 있고, 그것이 10/01 사고의 모양이다.
 *    말만 하고 고치지는 않는다. 남이 적어 둔 자료가 그 안에 있다.
 *
 *  켜는 법 (한 번만)
 *    Apps Script 편집기에서 csInstallReturnMonthTabTrigger 를 ▶ 실행.
 *    매일 새벽 3시에 돈다.
 * ══════════════════════════════════════════════════════════════
 */

/** 달 끝 며칠 전부터 다음 달 탭을 미리 만드나 */
var _CS_MONTH_TAB_AHEAD_DAYS_ = 5;

/** yyyyMM 한 달 뒤 */
function _cs_monthKeyAfter_(monthKey, n) {
  var y = parseInt(String(monthKey).substring(0, 4), 10);
  var m = parseInt(String(monthKey).substring(4, 6), 10) - 1 + (n || 0);
  return Utilities.formatDate(new Date(y, m, 1), "Asia/Seoul", "yyyyMM");
}

/** 이 달이 며칠 남았나 (오늘 포함) */
function _cs_daysLeftInMonth_(optDate) {
  var now = optDate || new Date();
  var k = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd").split("-");
  var y = parseInt(k[0], 10), m = parseInt(k[1], 10), d = parseInt(k[2], 10);
  var 말일 = new Date(y, m, 0).getDate();     // m 은 1기준 → 다음 달 0일 = 이 달 말일
  return 말일 - d + 1;
}

/*  ★ 본은 «협의된 배열» 하나다 ★  (2026-10-01)
      전에는 «전달 탭»을 본떴다. 그러면 전달이 비뚤면 다음 달도 비뚤고,
      사람이 중간에 한 달을 손으로 만들면 그 뒤로 영영 비뚤어진다.
      내부적으로 협의된 탭을 본뜨면 «달이 바뀌어도 늘 같은 배열»이 된다.

      이 탭 이름이 바뀌거나 지워지면 옛 길(전달 탭 본뜨기)로 되돌아간다 —
      멈추지는 않는다. 다만 매일 도는 일이 그렇다고 말해 준다.            */
var _CS_RETURN_SPEC_TAB_ = "202609의 테스트 시트";

/*  협의안에 없어도 «우리 코드가 쓸 때 스스로» 맨 뒤에 만드는 칸들.
    모양 점검에서 「더 있는 칸」으로 세지 않는다.
      입고확인요청 — csReturnIntake._cs_ensureIntakeReqCol_
      반품송장/회수송장 — csReturnLedgerCols (입고 스캔이 회수 라벨로 찾으려면 필요)   */
var _CS_RETURN_OK_EXTRA_COLS_ = ["입고확인요청", "반품송장", "회수송장"];

/** 협의된 배열 탭 — 없으면 null */
function _cs_returnLedgerSpecTab_(ss) {
  if (!ss) return null;
  return ss.getSheetByName(_CS_RETURN_SPEC_TAB_) || null;
}

/**
 * 협의된 배열을 본떠 «새» 달 탭을 만든다.
 *
 * ★ 상태값 한 칸을 A 에 끼운다 ★  (사장님 결정, 2026-10-01)
 *   협의안에는 상태값 칸이 없다. 그래도 웹앱 카드의 단계는 그 낱말로 보는 게
 *   가장 빠르고, 사람이 눈으로 고칠 수도 있다. 그래서 A 앞에 한 칸 끼우고
 *   협의안 20칸은 B 부터 그대로 둔다. 읽는 쪽은 «이름»으로 찾으므로
 *   한 칸 밀려도 안 어긋난다.
 *
 * ★ 만드는 자리는 여기 하나다 ★
 *   달마다 만드는 일도, 10월을 새로 만드는 일(csRebuildOct.gs)도 이것을 부른다.
 *
 * @return {{tab: Sheet, 왜: string}}
 */
function _cs_newReturnTabFromSpec_(ss, newName) {
  var out = { tab: null, 왜: "" };
  var 본 = _cs_returnLedgerSpecTab_(ss);
  if (!본) { out.왜 = "협의안 탭(「" + _CS_RETURN_SPEC_TAB_ + "」)이 없습니다"; return out; }

  var tab = 본.copyTo(ss);
  //  이름을 먼저 임시로 — 같은 이름이 있으면 setName 이 터진다
  tab.setName(newName + "_짓는중_" + Utilities.formatDate(new Date(), "Asia/Seoul", "HHmmss"));
  _cs_clearReturnLedgerDataRows_(tab);

  tab.insertColumnBefore(1);
  var lc = Math.max(tab.getLastColumn(), 15);
  var v = tab.getRange(1, 1, Math.max(Math.min(tab.getLastRow(), 40), 12), lc).getDisplayValues();
  var hi = _cs_findReturnHeaderRow_(v);
  if (hi < 0) {
    ss.deleteSheet(tab);
    out.왜 = "본에서 머리글 줄을 못 찾았습니다 — 아무것도 안 했습니다";
    return out;
  }
  tab.getRange(hi + 1, 1).setValue("상태값");

  tab.setName(newName);
  try {
    ss.setActiveSheet(tab);
    ss.moveActiveSheet(0);
  } catch (eMove) {
    Logger.log("[RETURN_LEDGER] 탭 이동 skip: " + eMove.message);
  }
  /*  끼운 칸이라 유효성 규칙이 없다 — 상태 드롭다운을 새로 건다.
      기억해 둔 「이미 걸었다」 표시를 먼저 지운다.  */
  try {
    PropertiesService.getScriptProperties().deleteProperty(_CS_RET_DV_PROP_ + newName);
  } catch (eP) {}
  try { _cs_ensureReturnStatusDropdown_(tab, newName); } catch (eD) {}

  out.tab = tab;
  return out;
}

/**
 * 그 달 탭이 있는지 보고, 없으면 만든다.
 *
 * ★ 만드는 자리는 여기 하나다 ★
 *   _cs_getReturnLedgerTab_ 도 이것을 부른다. 두 벌로 두면 한쪽만 고쳐져
 *   달마다 다른 모양이 생긴다 — 그것이 이 사고의 뿌리였다.
 *
 * @return {{tab: Sheet, 만듦: boolean, 본뜬것: string, 왜: string}}
 */
function _cs_ensureReturnMonthTab_(ss, monthKey) {
  var out = { tab: null, 만듦: false, 본뜬것: "", 왜: "" };
  if (!ss || !monthKey) { out.왜 = "시트나 달이 없습니다"; return out; }

  var tab = ss.getSheetByName(monthKey);
  if (tab) { out.tab = tab; out.왜 = "이미 있습니다"; return out; }

  //  ① 협의된 배열을 본뜬다 (제 길)
  var r = _cs_newReturnTabFromSpec_(ss, monthKey);
  if (r.tab) {
    out.tab = r.tab;
    out.만듦 = true;
    out.본뜬것 = _CS_RETURN_SPEC_TAB_ + " + 상태값";
    Logger.log("[RETURN_LEDGER] 월별 탭 생성: " + monthKey + " ← " + out.본뜬것);
    return out;
  }

  //  ② 협의안 탭이 없다 — 옛 길(전달 탭)로 간다. 멈추지는 않는다.
  Logger.log("[RETURN_LEDGER] 협의안 본뜨기 실패(" + r.왜 + ") — 전달 탭으로 갑니다");
  var template = _cs_findReturnLedgerTemplateTab_(ss, monthKey);
  if (!template) { out.왜 = r.왜 + " · 본뜰 탭도 못 찾았습니다"; return out; }

  tab = template.copyTo(ss);
  tab.setName(monthKey);
  try {
    ss.setActiveSheet(tab);
    ss.moveActiveSheet(0);
  } catch (eMove) {
    Logger.log("[RETURN_LEDGER] 탭 이동 skip: " + eMove.message);
  }
  _cs_clearReturnLedgerDataRows_(tab);
  out.tab = tab;
  out.만듦 = true;
  out.본뜬것 = template.getName();
  out.왜 = "협의안 탭이 없어 전달 탭을 본떴습니다 — " + r.왜;
  Logger.log("[RETURN_LEDGER] 월별 탭 생성: " + monthKey + " ← " + out.본뜬것);
  return out;
}

/** 탭의 머리글 이름들 — 공백 뺀 낱말 배열. 못 찾으면 null */
function _cs_returnHeaderNames_(sh) {
  if (!sh) return null;
  var lc = Math.max(sh.getLastColumn(), 15);
  var scan = Math.max(Math.min(sh.getLastRow(), 40), 12);
  var v = sh.getRange(1, 1, scan, lc).getDisplayValues();
  var hi = _cs_findReturnHeaderRow_(v);
  if (hi < 0) return null;
  var out = [];
  for (var i = 0; i < v[hi].length; i++) out.push(String(v[hi][i] || "").replace(/\s/g, ""));
  while (out.length && !out[out.length - 1]) out.pop();
  return { 줄: hi + 1, 이름: out };
}

/**
 * 탭 모양이 «협의된 배열»과 같은가 — 머리글 «이름»으로 견준다.
 *
 * ★ 왜 자리가 아니라 이름인가 ★
 *   전에는 앞 세 칸만 봤다. 그러면 사람이 열 하나를 옮기기만 해도 못 잡고,
 *   반대로 상태값 한 칸을 끼운 것만으로도 늘 울린다. 읽는 쪽도 이름으로
 *   찾으니(csOrderSearch._cs_mapReturnLedgerCols_) 견주는 자도 이름이어야 한다.
 *
 * 다르면 «말만» 한다. 남이 적어 둔 자료가 들어 있어 고치지 않는다.
 */
function _cs_returnTabShapeNote_(ss, monthKey) {
  var tab = ss.getSheetByName(monthKey);
  if (!tab) return "";

  var a = _cs_returnHeaderNames_(tab);
  if (!a) return "★ " + monthKey + " — 머리글 줄(「반품접수날짜」)을 못 찾았습니다.";

  var 본 = _cs_returnLedgerSpecTab_(ss);
  if (!본) {
    return "⏸ 협의안 탭(「" + _CS_RETURN_SPEC_TAB_ + "」)이 없어 모양을 견주지 못했습니다.\n" +
      "   이름이 바뀌었으면 csReturnMonthTab.gs 의 _CS_RETURN_SPEC_TAB_ 을 맞춰 주세요.";
  }
  if (본.getName() === monthKey) return "";
  var b = _cs_returnHeaderNames_(본);
  if (!b) return "";

  //  기대하는 이름 = 상태값(우리가 끼운 것) + 협의안 이름들
  var 기대 = ["상태값"].concat(b.이름.filter(String));
  var 있는것 = {};
  for (var i = 0; i < a.이름.length; i++) if (a.이름[i]) 있는것[a.이름[i]] = true;

  var 없는것 = [];
  for (var k = 0; k < 기대.length; k++) if (!있는것[기대[k]]) 없는것.push(기대[k]);

  var 기대맵 = {};
  for (var m = 0; m < 기대.length; m++) 기대맵[기대[m]] = true;
  //  협의안엔 없어도 «우리 코드가 스스로 맨 뒤에 만드는» 칸은 탈이 아니다.
  //  있어도 되고 없어도 된다 — 쓰는 순간 생긴다.
  for (var x = 0; x < _CS_RETURN_OK_EXTRA_COLS_.length; x++) {
    기대맵[_CS_RETURN_OK_EXTRA_COLS_[x]] = true;
  }
  var 더있는것 = [];
  for (var n = 0; n < a.이름.length; n++) {
    if (a.이름[n] && !기대맵[a.이름[n]]) 더있는것.push(a.이름[n]);
  }

  if (!없는것.length && !더있는것.length) return "";
  var 말 = "★ " + monthKey + " 모양이 협의된 배열과 다릅니다 (머리 " + a.줄 + "행)";
  if (없는것.length) 말 += "\n   없는 칸 — " + 없는것.join(", ");
  if (더있는것.length) 말 += "\n   더 있는 칸 — " + 더있는것.join(", ");
  말 += "\n   없는 칸에 적힌 값은 웹앱이 못 읽습니다. 눈으로 보세요.";
  return 말;
}

/**
 * 매일 도는 일 — 이번 달 탭을 보장하고, 말일이 가까우면 다음 달도 미리 만든다.
 * 돌리기만 해도 탈이 없다. 있으면 아무것도 안 한다.
 */
function csEnsureReturnMonthTabs() {
  var 줄 = [];
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var 이번달 = _cs_returnLedgerMonthKey_();
  var 남은날 = _cs_daysLeftInMonth_();

  var 볼것 = [이번달];
  if (남은날 <= _CS_MONTH_TAB_AHEAD_DAYS_) 볼것.push(_cs_monthKeyAfter_(이번달, 1));

  for (var i = 0; i < 볼것.length; i++) {
    var k = 볼것[i];
    var r = _cs_ensureReturnMonthTab_(ss, k);
    if (r.만듦) 줄.push("✅ " + k + " 만들었습니다 (" + r.본뜬것 + " 를 본뜸)");
    else if (r.tab) {
      var 말 = _cs_returnTabShapeNote_(ss, k);
      줄.push("· " + k + " 이미 있습니다" + (말 ? "" : " — 모양도 같습니다"));
      if (말) 줄.push("  " + 말);
    } else 줄.push("★ " + k + " — " + r.왜);
  }
  줄.push("이 달 " + 남은날 + "일 남음 · 다음 달은 " + _CS_MONTH_TAB_AHEAD_DAYS_ + "일 전부터 미리 만듭니다.");

  var 글 = 줄.join("\n");
  Logger.log(글);
  try { csInvalidateReturnLedgerCache_(); } catch (e) {}
  return 글;
}

/** 편집기에서 한 번 실행 — 매일 새벽 3시 트리거를 건다 (이미 있으면 새로 건다) */
function csInstallReturnMonthTabTrigger() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "csEnsureReturnMonthTabs") ScriptApp.deleteTrigger(all[i]);
  }
  ScriptApp.newTrigger("csEnsureReturnMonthTabs").timeBased().everyDays(1).atHour(3).create();
  var 첫판 = csEnsureReturnMonthTabs();
  var msg = "✅ 반품대장 월 탭 — 매일 새벽 3시에 봅니다.\n\n" + 첫판 +
    "\n\n트리거 " + ScriptApp.getProjectTriggers().length + "개";
  Logger.log(msg);
  return msg;
}

/** 끄기 */
function csUninstallReturnMonthTabTrigger() {
  var n = 0, all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "csEnsureReturnMonthTabs") {
      ScriptApp.deleteTrigger(all[i]); n++;
    }
  }
  return "트리거 " + n + "개 지움";
}
