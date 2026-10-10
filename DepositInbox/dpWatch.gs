/**
 * 폰 생존 감시
 * ★ 2026-09-28 신규
 *
 * 폰이 꺼지거나 앱이 죽으면 문자가 «조용히» 안 온다. 입금이 없어서 조용한 것과 구별이 안 된다.
 * 그래서 폰이 30분마다 ping 을 보내고, 1시간 넘게 아무 소리가 없으면 챗으로 말한다.
 * 한 번 말하면 돌아올 때까지 다시 말하지 않는다 — 30분마다 같은 경고가 쌓이면 아무도 안 본다.
 */

var DP_OFFLINE_AFTER_MIN_ = 60;
/** 끊긴 채면 이만큼마다 다시 알린다 */
var DP_REALERT_HOURS_ = 24;

/** 폰에서 무엇이든 오면 부른다 (ping·문자 모두). */
function dpTouchSeen_() {
  var props = PropertiesService.getScriptProperties();
  var wasOff = props.getProperty("DP_OFFLINE_ALERTED");
  props.setProperty("DP_LAST_SEEN", String(Date.now()));
  if (wasOff) {
    props.deleteProperty("DP_OFFLINE_ALERTED");
    dpNotifyText_("📶 입금 폰 다시 연결됨 — 끊긴 동안 온 입금은 은행 앱에서 한 번 확인해 주세요.");
  }
}

/** 트리거가 30분마다 부른다. */
function dpWatch() {
  //  V2 로 대장 상태를 민다 (2026-10-10 · dpMirror.gs dpMirrorSync_). 실패해도 감시는 계속한다.
  try { dpMirrorSync_(); } catch (eM) { Logger.log("[입금미러] 30분 동기 실패(무시): " + eM.message); }
  var props = PropertiesService.getScriptProperties();
  var seen = Number(props.getProperty("DP_LAST_SEEN") || 0);
  if (!seen) return;                                   // 아직 한 번도 안 붙은 폰
  var gapMin = (Date.now() - seen) / 60000;
  if (gapMin < DP_OFFLINE_AFTER_MIN_) return;
  // ★ 하루에 한 번은 다시 말한다 (2026-10-10) ★
  //   한 번만 말했더니 10-05 밤 경고가 묻혀 나흘 넘게 입금이 안 들어온 줄 아무도 몰랐다.
  //   예전 값 "1" 은 시각이 아니라 0 으로 읽혀 곧바로 다시 말한다.
  var lastAlert = Number(props.getProperty("DP_OFFLINE_ALERTED") || 0);
  if (lastAlert > 1 && Date.now() - lastAlert < DP_REALERT_HOURS_ * 3600000) return;
  props.setProperty("DP_OFFLINE_ALERTED", String(Date.now()));
  dpNotifyText_((lastAlert ? "📵 입금 폰 아직 끊김 (입금이 안 들어오고 있습니다) — 마지막 신호 " : "📵 입금 폰 연결 끊김 — 마지막 신호 ") +
    Utilities.formatDate(new Date(seen), "Asia/Seoul", "MM-dd HH:mm") +
    " (" + (gapMin >= 1440 ? Math.floor(gapMin / 1440) + "일 " : "") + Math.round(gapMin % 1440 / 60) + "시간 전)\n폰 전원·와이파이·MacroDroid(요청 방법이 POST 인지)를 확인해 주세요.\n끊긴 동안 온 입금은 은행 앱에서 확인해 주세요.");
}

/** 감시 트리거를 건다. 이미 있으면 그대로 둔다. */
function dpInstallTriggers() {
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "dpWatch";
  });
  if (!has) ScriptApp.newTrigger("dpWatch").timeBased().everyMinutes(30).create();
  return has ? "이미 있음" : "만들었음";
}

/**
 * 진단 한 장 — CS 열쇠로만 (Code.gs action=health). 2026-10-10
 *   입금이 며칠째 없을 때 «입금이 없어서»인지 «폰이 끊겨서»인지 가른다.
 *   문자 본문(입금자 이름이 들어 있다)은 싣지 않는다.
 */
function dpHealth_() {
  var props = PropertiesService.getScriptProperties();
  var seen = Number(props.getProperty("DP_LAST_SEEN") || 0);
  var fmt = function (d) { return Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd HH:mm"); };
  var out = {
    lastSeen: seen ? fmt(new Date(seen)) : "",
    gapMin: seen ? Math.round((Date.now() - seen) / 60000) : null,
    offlineAlerted: !!props.getProperty("DP_OFFLINE_ALERTED"),
    watchTrigger: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "dpWatch"; }),
    log: [], ledgerRows: 0, lastRows: []
  };
  var ss = dpLedgerSs_(false);
  if (!ss) return out;
  var lg = ss.getSheetByName(DP_REQLOG_SHEET_);
  if (lg && lg.getLastRow() > 1) {
    var n = Math.min(10, lg.getLastRow() - 1);
    out.log = lg.getRange(lg.getLastRow() - n + 1, 1, n, DP_REQLOG_HEADERS_.length).getDisplayValues()
      .map(function (r) { return [r[0], r[1], r[2], r[3], r[5], r[7]].join(" | "); });
  }
  var sh = dpLedgerSheet_(ss);
  var c = _dp_cols_(sh);
  out.ledgerRows = Math.max(0, sh.getLastRow() - 1);
  if (out.ledgerRows) {
    var k = Math.min(5, out.ledgerRows);
    var rows = sh.getRange(sh.getLastRow() - k + 1, 1, k, sh.getLastColumn()).getValues();
    out.lastRows = rows.map(function (r) {
      return _dp_ts_(r[c["거래일시"] - 1]) + " · " + r[c["금액"] - 1] + " · " + r[c["매칭결과"] - 1] + " · " + r[c["상태"] - 1];
    });
  }
  return out;
}
