/**
 * 폰 생존 감시
 * ★ 2026-09-28 신규
 *
 * 폰이 꺼지거나 앱이 죽으면 문자가 «조용히» 안 온다. 입금이 없어서 조용한 것과 구별이 안 된다.
 * 그래서 폰이 30분마다 ping 을 보내고, 1시간 넘게 아무 소리가 없으면 챗으로 말한다.
 * 한 번 말하면 돌아올 때까지 다시 말하지 않는다 — 30분마다 같은 경고가 쌓이면 아무도 안 본다.
 */

var DP_OFFLINE_AFTER_MIN_ = 60;

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
  if (props.getProperty("DP_OFFLINE_ALERTED")) return;
  var gapMin = (Date.now() - seen) / 60000;
  if (gapMin < DP_OFFLINE_AFTER_MIN_) return;
  props.setProperty("DP_OFFLINE_ALERTED", "1");
  dpNotifyText_("📵 입금 폰 연결 끊김 — 마지막 신호 " +
    Utilities.formatDate(new Date(seen), "Asia/Seoul", "MM-dd HH:mm") +
    " (" + Math.round(gapMin) + "분 전)\n폰 전원·와이파이·MacroDroid 를 확인해 주세요.");
}

/** 감시 트리거를 건다. 이미 있으면 그대로 둔다. */
function dpInstallTriggers() {
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "dpWatch";
  });
  if (!has) ScriptApp.newTrigger("dpWatch").timeBased().everyMinutes(30).create();
  return has ? "이미 있음" : "만들었음";
}
