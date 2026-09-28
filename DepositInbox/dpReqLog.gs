/**
 * 수신로그 — 폰에서 온 요청을 «받아들이든 말든» 한 줄씩 남긴다
 * ★ 2026-09-28 신규
 *
 * > "로그는 있는데 알림은 안오네"
 *
 * 폰 쪽 로그에는 «보냈다»만 남고, 서버가 왜 안 받았는지는 안 보인다.
 * 토큰이 틀렸는지, GET 으로 왔는지, 본문이 비었는지 — 여기서 본다.
 *
 * ★ 토큰 값은 절대 안 적는다 ★ 맞음/틀림/없음만.
 * ★ 기록이 실패해도 수신을 막지 않는다 ★
 */

var DP_REQLOG_SHEET_ = "수신로그";
var DP_REQLOG_HEADERS_ = ["시각", "방식", "동작", "토큰", "본문형식", "본문길이", "본문앞부분", "결과"];
/** 이만큼 넘으면 오래된 줄을 지운다 — 진단용이라 오래 둘 이유가 없다 */
var DP_REQLOG_MAX_ = 500;

function dpReqLog_(method, e, p, tokenState, out) {
  // 정상 신호(ping)는 30분마다 온다. 다 적으면 정작 봐야 할 줄이 묻힌다 — 마지막 신호는 DP_LAST_SEEN 에 있다.
  if (out && out.ok && out.action === "ping") return;
  try {
    var ss = dpLedgerSs_(false);
    if (!ss) return;
    var sh = ss.getSheetByName(DP_REQLOG_SHEET_);
    if (!sh) {
      sh = ss.insertSheet(DP_REQLOG_SHEET_);
      sh.getRange(1, 1, 1, DP_REQLOG_HEADERS_.length).setValues([DP_REQLOG_HEADERS_]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
    var body = String((p && p.body) || "");
    var type = (e && e.postData && e.postData.type) || "";
    sh.appendRow([
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
      method,
      String((p && p.action) || ""),
      tokenState || "",
      type,
      body.length,
      body.replace(/\s+/g, " ").slice(0, 40),
      out && out.ok ? "OK " + (out.result || out.action || "") + (out.dup ? " (중복)" : "")
                    : "거절 " + String((out && out.error) || "")
    ]);
    var n = sh.getLastRow();
    if (n > DP_REQLOG_MAX_ + 50) sh.deleteRows(2, n - DP_REQLOG_MAX_ - 1);
  } catch (err) {
    Logger.log("[수신로그] 기록 실패(무시): " + err.message);
  }
}
