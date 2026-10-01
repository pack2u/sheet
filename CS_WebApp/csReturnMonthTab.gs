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

/**
 * 그 달 탭이 있는지 보고, 없으면 전달 탭을 본떠 만든다.
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

  var template = _cs_findReturnLedgerTemplateTab_(ss, monthKey);
  if (!template) { out.왜 = "본뜰 탭을 못 찾았습니다"; return out; }

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
  Logger.log("[RETURN_LEDGER] 월별 탭 생성: " + monthKey + " ← " + out.본뜬것);
  return out;
}

/**
 * 탭 모양이 본뜰 탭과 같은가 — 머리글 줄과 앞 세 칸만 본다.
 * 다르면 «말만» 한다. 남이 적어 둔 자료가 들어 있을 수 있어 고치지 않는다.
 */
function _cs_returnTabShapeNote_(ss, monthKey) {
  var tab = ss.getSheetByName(monthKey);
  if (!tab) return "";
  var 본 = _cs_findReturnLedgerTemplateTab_(ss, monthKey);
  if (!본 || 본.getName() === monthKey) return "";

  var 보기 = function (sh) {
    var lc = Math.max(sh.getLastColumn(), 15);
    var scan = Math.max(Math.min(sh.getLastRow(), 40), 12);
    var v = sh.getRange(1, 1, scan, lc).getDisplayValues();
    var hi = _cs_findReturnHeaderRow_(v);
    if (hi < 0) return null;
    return { 줄: hi + 1, 앞: v[hi].slice(0, 3).map(function (x) { return String(x || "").replace(/\s/g, ""); }) };
  };
  var a = 보기(tab), b = 보기(본);
  if (!a) return "★ " + monthKey + " — 머리글 줄(「반품접수날짜」)을 못 찾았습니다.";
  if (!b) return "";
  if (a.줄 === b.줄 && a.앞.join("|") === b.앞.join("|")) return "";
  return "★ " + monthKey + " 모양이 " + 본.getName() + " 과 다릅니다 — " +
    monthKey + "[머리 " + a.줄 + "행 · " + a.앞.join(" / ") + "]  vs  " +
    본.getName() + "[머리 " + b.줄 + "행 · " + b.앞.join(" / ") + "]\n" +
    "   열 자리가 어긋나면 날짜·상태가 조용히 지워집니다(2026-10-01 에 그랬습니다). 눈으로 보세요.";
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
