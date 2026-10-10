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

/*  ★ 2026-10-10 — 받는 쪽이 생겼다. 기본을 «켜짐»으로 ★
    V2 /api/deposits/ingest 가 생겼으니 다른 미러처럼 기본 켜짐이다.
    끄려면 스크립트 속성 DEPOSIT_MIRROR = off. 주소·열쇠가 없으면 조용히 쉰다. */
function _dp_mirror_on_() {
  if (String(_dp_prop_("DEPOSIT_MIRROR")).toLowerCase() === "off") return false;
  return !!(_dp_v2_url_() && _dp_secret_("DEPOSIT_INGEST_TOKEN"));
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
  if (!records || !records.length) return false;
  return _dp_mirrorPost_({ coreVersion: DP_CORE_VERSION, rows: records });
}

function _dp_mirrorPost_(payload) {
  if (!_dp_mirror_on_()) return false;
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
      payload: JSON.stringify(payload),
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

/**
 * ══════════════════════════════════════════════════════════════
 *  30분마다 — 대장의 «지금 상태»를 V2 로   (2026-10-10)
 *
 *  받을 때 보내는 것(dpMirrorSend_)은 문자 원문뿐이다. 그 뒤에 바뀌는 것 —
 *  매칭 결과 · 사람이 지정/제외한 것 · 이카운트 반영 — 은 안 간다.
 *  V2 가 같은 dpMatchAll 로 «같은 답»을 내는지 맞대려면 입력(주문서 · 별칭표)과
 *  시트가 낸 답(매칭 칸)을 함께 받아야 한다.
 *
 *  ★ 폰의 웹앱 배포를 안 건드린다 ★  dpWatch(시간 트리거)가 부른다 — 시간 트리거는
 *    HEAD 를 돈다. 그래서 clasp push 만으로 켜지고, 폰이 부르는 웹앱 판(@27)은 그대로다.
 *  ★ 처음 한 번은 60일 ★  그 뒤로는 3일 — 고유번호로 덮으므로 겹쳐도 된다.
 *  ★ 실패해도 아무것도 안 막는다 ★  폰 감시는 그대로 돈다.
 * ══════════════════════════════════════════════════════════════
 */
var DP_MIRROR_SYNC_DAYS_ = 3;
var DP_MIRROR_FIRST_DAYS_ = 60;

function dpMirrorSync_() {
  if (!_dp_mirror_on_()) return "꺼짐";
  var ss = dpLedgerSs_(false);
  if (!ss) return "대장 없음";
  var props = PropertiesService.getScriptProperties();
  var first = !props.getProperty("DP_MIRROR_FULL_AT");
  var days = first ? DP_MIRROR_FIRST_DAYS_ : DP_MIRROR_SYNC_DAYS_;

  //  ① 입력 — 주문서(최근 DP_ORDER_DAYS_) · 별칭표 · 판정 기준. V2 는 이것을 «통째로» 갈아 끼운다.
  var okSnap = _dp_mirrorPost_({
    coreVersion: DP_CORE_VERSION, matchVersion: DP_MATCH_VERSION, kind: "snapshot",
    orders: dpLoadOrders_(ss), aliases: dpLoadAliases_(ss),
    since: _dp_daysAgo_(DP_MATCH_DEPOSIT_DAYS_), frozen: DP_FROZEN_STATES_
  });

  //  ② 대장 줄 — 원문 + 시트가 낸 답 + dpMatchAll 이 받는 모양(dpLedgerDeps_)
  var sh = dpLedgerSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return "줄 없음";
  var c = _dp_cols_(sh);
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var deps = dpLedgerDeps_(vals, c);
  var since = _dp_daysAgo_(days);
  var g = function (r, h) { return c[h] ? r[c[h] - 1] : ""; };
  var batch = [], sent = 0, failed = 0;
  var flush = function () {
    if (!batch.length) return;
    if (_dp_mirrorPost_({ coreVersion: DP_CORE_VERSION, matchVersion: DP_MATCH_VERSION, kind: "rows", rows: batch })) sent += batch.length;
    else failed += batch.length;
    batch = [];
  };
  vals.forEach(function (r, i) {
    var rcv = _dp_ts_(g(r, "수신시각"));
    if (rcv.slice(0, 10) < since) return;
    batch.push({
      key: String(g(r, "고유번호")), row: i + 2, receivedAt: rcv, from: String(g(r, "발신번호")), body: String(g(r, "원문")),
      deps: deps[i],
      sheet: {
        bank: String(g(r, "은행")), account: String(g(r, "계좌")), kind: String(g(r, "구분")), name: String(g(r, "입금자")),
        amount: Number(g(r, "금액")) || 0, balance: g(r, "거래후잔액") === "" ? null : Number(g(r, "거래후잔액")),
        txAt: _dp_ts_(g(r, "거래일시")), balanceCheck: String(g(r, "잔액확인")), status: String(g(r, "상태")), memo: String(g(r, "메모")),
        match: {
          result: String(g(r, "매칭결과")), cust: String(g(r, "거래처")), code: String(g(r, "거래처코드")),
          nos: String(g(r, "주문번호")), diff: g(r, "차액") === "" ? 0 : Number(g(r, "차액")) || 0,
          reason: String(g(r, "매칭메모")), alloc: String(g(r, "배분")), pin: String(g(r, "지정"))
        },
        ecount: { slipNo: String(g(r, "전표번호")), at: _dp_ts_(g(r, "반영시각")), by: String(g(r, "반영자")), memo: String(g(r, "반영메모")) }
      }
    });
    if (batch.length >= DP_MIRROR_MAX_ROWS_) flush();
  });
  flush();
  if (first && okSnap && !failed) props.setProperty("DP_MIRROR_FULL_AT", _dp_now_());
  var msg = (first ? "처음 " : "") + days + "일 · 보냄 " + sent + " · 실패 " + failed + (okSnap ? "" : " · 주문서 못 보냄");
  props.setProperty("DP_MIRROR_LAST", _dp_now_() + " · " + msg);
  return msg;
}
