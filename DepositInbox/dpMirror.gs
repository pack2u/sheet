/**
 * ══════════════════════════════════════════════════════════════
 *  입금대장 → V2 미러
 *  ★ 2026-09-28 신규
 *
 *  > "이것도 V2를 염두해서 만들어줘"
 *
 *  ★ 원문을 보낸다 ★  (_partnerReturnsV2Mirror.gs 와 같은 판단)
 *    V2 는 받은 «문자 원문»을 같은 dpParse(core) 로 다시 읽는다.
 *    시트가 읽은 결과(sheet)도 같이 실어 보내지만 그건 «대조용»이다 —
 *    V2 가 그걸 믿고 쓰면 규칙이 한 벌이 아니게 된다.
 *    둘이 다르면 V2 가 그 줄만 따로 보여 준다(그림자 운전, 이식전략 원칙 2).
 *
 *  ★ 몇 번 보내도 한 줄 ★
 *    고유번호(key)로 V2 가 upsert 한다. 실패하면 dpMirrorBackfill 로 다시 밀면 된다.
 *
 *  ★ 절대 원래 흐름을 막지 않는다 ★
 *    미러가 실패해도 대장은 이미 적혔고 챗 알림도 갔다. 전부 삼키고 기록만 남긴다.
 *
 *  ★ 켜는 법 ★
 *    V2 에 /api/deposits/ingest 가 생기기 전에는 보낼 곳이 없다. 그래서 기본은 «꺼짐».
 *    스크립트 속성 DEPOSIT_MIRROR = on 으로 켠다. off 면 즉시 멈춘다.
 *    다른 미러(기본 켜짐)와 반대인 까닭은 받는 쪽이 아직 없어서다.
 * ══════════════════════════════════════════════════════════════
 */

var DP_MIRROR_PATH_ = "/api/deposits/ingest";
var DP_MIRROR_MAX_ROWS_ = 500;

function _dp_mirror_on_() {
  return String(_dp_prop_("DEPOSIT_MIRROR")).toLowerCase() === "on";
}

function _dp_v2_url_() {
  return String(_dp_secret_("V2_URL") || "").replace(/\/+$/, "");
}

/**
 * 대장 한 줄 → V2 가 받는 모양.
 * 칸 이름은 영어로 고정한다 — 시트 머리글(한글)은 사람이 바꿀 수 있지만 이 모양은 약속이다.
 */
function dpMirrorRecord_(key, receivedAt, from, body, parsed, bal, status) {
  return {
    key: key,
    receivedAt: receivedAt,
    from: from || "",
    body: body,
    sheet: parsed && parsed.ok ? {
      bank: parsed.bank, account: parsed.account, kind: parsed.kind, name: parsed.name,
      amount: parsed.amount, balance: parsed.balance, txAt: parsed.txAt,
      balanceCheck: bal ? bal.status : "", status: status
    } : { status: status, reason: parsed ? parsed.reason : "" }
  };
}

/** 여러 줄을 보낸다. 성공하면 true. 실패해도 던지지 않는다. */
function dpMirrorSend_(records) {
  if (!_dp_mirror_on_() || !records || !records.length) return false;
  var url = _dp_v2_url_();
  var tok = String(_dp_secret_("DEPOSIT_INGEST_TOKEN") || "");
  if (!url || !tok) {
    Logger.log("[입금미러] V2_URL · DEPOSIT_INGEST_TOKEN 이 없습니다 (_secrets.gs)");
    return false;
  }
  try {
    var res = UrlFetchApp.fetch(url + DP_MIRROR_PATH_, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { "x-ingest-token": tok },
      payload: JSON.stringify({ coreVersion: DP_CORE_VERSION, rows: records }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 300) {
      PropertiesService.getScriptProperties().setProperty("DP_MIRROR_FAIL",
        Utilities.formatDate(new Date(), "Asia/Seoul", "MM-dd HH:mm") + " · HTTP " + code);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log("[입금미러] 실패(무시): " + e.message);
    return false;
  }
}

/**
 * 대장의 최근 며칠치를 다시 민다 (편집기에서 ▶ 실행).
 * V2 가 한동안 꺼져 있었거나, 미러를 새로 켰을 때 쓴다. 고유번호로 upsert 되므로 겹쳐도 된다.
 */
function dpMirrorBackfill(days) {
  days = Number(days) || 45;
  if (!_dp_mirror_on_()) return "DEPOSIT_MIRROR 가 on 이 아닙니다";
  var sh = dpLedgerSheet_(dpLedgerSs_(false));
  var last = sh.getLastRow();
  if (last < 2) return "보낼 줄 없음";
  var c = _dp_cols_(sh);
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues();
  var since = Utilities.formatDate(new Date(Date.now() - days * 86400000), "Asia/Seoul", "yyyy-MM-dd");
  var batch = [], sent = 0, failed = 0;
  var flush = function () {
    if (!batch.length) return;
    if (dpMirrorSend_(batch)) sent += batch.length; else failed += batch.length;
    batch = [];
  };
  vals.forEach(function (r) {
    var rcv = String(r[c["수신시각"] - 1]);
    if (rcv.slice(0, 10) < since) return;
    var body = String(r[c["원문"] - 1]);
    // 시트 결과는 «지금 규칙»으로 다시 읽어 싣는다 — 원문이 주인이다
    var p = dpParseSms(body, new Date(rcv.replace(" ", "T") + "+09:00"));
    batch.push(dpMirrorRecord_(String(r[c["고유번호"] - 1]), rcv, String(r[c["발신번호"] - 1]),
      body, p, { status: String(r[c["잔액확인"] - 1]) }, String(r[c["상태"] - 1])));
    if (batch.length >= DP_MIRROR_MAX_ROWS_) flush();
  });
  flush();
  var msg = "보냄 " + sent + " · 실패 " + failed;
  Logger.log("[입금미러] " + msg);
  return msg;
}
