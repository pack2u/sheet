/**
 * CS웹앱 쪽 동작 — 주문서 올리기 · 입금 상세(후보) · 주문 찾기 · 지정/제외/되돌리기
 * ★ 2026-09-29 신규
 *
 * ★ 잔액은 여기서도 안 내보낸다 ★ (챗·목록과 같은 판단)
 * ★ 지정은 «매칭 칸»만 바꾼다 ★ — 입금자·금액·거래일시는 문자에서 온 그대로 둔다.
 */

/** 주문서조회 엑셀(보이는 값 2차원 배열)을 받아 붙이고 매칭을 다시 돌린다 */
function dpCsOrdersUpload_(rows, by) {
  var parsed = dpParseOrderSheet(rows || []);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!parsed.orders.length) return { ok: false, error: "주문이 한 줄도 없습니다" };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = dpLedgerSs_(true);
    var up = dpUpsertOrders_(ss, parsed, by);
    var res = dpMatchRunLocked_(ss);
    var tally = {};
    Object.keys(res).forEach(function (k) {
      if (res[k].result === "제외") return;
      tally[res[k].result] = (tally[res[k].result] || 0) + 1;
    });
    return { added: up.added, updated: up.updated, stale: up.stale, missing: up.missing, revived: up.revived,
             total: up.total, read: parsed.orders.length, fileAt: up.fileAt, warn: up.warn, tally: tally };
  } finally {
    lock.releaseLock();
  }
}

/** 고유번호로 입금 줄 찾기 → {sh, c, rowNo, row} */
function _dp_findRow_(ss, key) {
  var sh = dpLedgerSheet_(ss);
  var c = _dp_cols_(sh);
  if (!key || sh.getLastRow() < 2) return null;
  var hit = sh.getRange(2, c["고유번호"], sh.getLastRow() - 1, 1)
    .createTextFinder(key).matchEntireCell(true).findNext();
  if (!hit) return null;
  var rowNo = hit.getRow();
  return { sh: sh, c: c, rowNo: rowNo, row: sh.getRange(rowNo, 1, 1, sh.getLastColumn()).getValues()[0] };
}

/** 주문마다 이미 받은 돈 — 입금대장의 배분을 모두 더한다 (excludeKey 입금은 빼고) */
function _dp_paidMap_(ss, excludeKey) {
  var sh = dpLedgerSheet_(ss);
  var c = _dp_cols_(sh);
  var map = {};
  if (sh.getLastRow() < 2 || !c["배분"]) return map;
  var n = sh.getLastRow() - 1;
  var keys = sh.getRange(2, c["고유번호"], n, 1).getValues();
  var res = sh.getRange(2, c["매칭결과"], n, 1).getValues();
  var alloc = sh.getRange(2, c["배분"], n, 1).getValues();
  for (var i = 0; i < n; i++) {
    if (String(keys[i][0]) === excludeKey || String(res[i][0]) === "제외") continue;
    var a = [];
    try { a = JSON.parse(String(alloc[i][0] || "[]")) || []; } catch (e) { a = []; }
    a.forEach(function (x) { map[x.no] = (map[x.no] || 0) + (Number(x.apply) || 0); });
  }
  return map;
}

function _dp_orderView_(o, paid, tag) {
  return { no: o.no, date: o.date, due: o.due, code: o.code, name: o.name,
           amount: o.amount, remain: o.amount - (paid[o.no] || 0), tag: tag || "" };
}

/**
 * 입금 한 건의 상세 — 지금 판정 + 고를 만한 주문들
 *   ① 지금 배분된 주문  ② 판정이 올린 후보  ③ 찾은 거래처의 남은 주문  ④ 같은 금액의 남은 주문
 */
function dpCsDetail_(key) {
  var ss = dpLedgerSs_(false);
  if (!ss) return { ok: false, error: "입금대장이 없습니다" };
  var f = _dp_findRow_(ss, key);
  if (!f) return { ok: false, error: "입금을 찾지 못했습니다" };
  var g = function (h) { return f.c[h] ? f.row[f.c[h] - 1] : ""; };
  var amount = Number(g("금액")) || 0;
  var paid = _dp_paidMap_(ss, key);
  var orders = dpLoadOrders_(ss);
  var byNo = {};
  orders.forEach(function (o) { byNo[o.no] = o; });

  var picked = {}, list = [];
  var add = function (o, tag) {
    if (!o || picked[o.no]) return;
    picked[o.no] = 1;
    list.push(_dp_orderView_(o, paid, tag));
  };
  var alloc = [];
  try { alloc = JSON.parse(String(g("배분") || "[]")) || []; } catch (e) { alloc = []; }
  alloc.forEach(function (a) { add(byNo[a.no], "지금 배분"); });
  String(g("주문번호") || "").replace(/^후보:\s*/, "").split(/,\s*/).forEach(function (no) { add(byNo[no], "후보"); });
  var code = String(g("거래처코드") || "");
  if (code) orders.filter(function (o) { return o.code === code && o.amount - (paid[o.no] || 0) > 0; })
    .forEach(function (o) { add(o, "같은 거래처"); });
  orders.filter(function (o) { return o.amount - (paid[o.no] || 0) === amount; }).slice(0, 10)
    .forEach(function (o) { add(o, "같은 금액"); });

  return {
    deposit: {
      key: key, txAt: _dp_ts_(g("거래일시")), name: String(g("입금자")), amount: amount,
      bank: String(g("은행")), acct: String(g("계좌")).replace(/[^\d]/g, "").slice(-4),
      status: String(g("상태")), result: String(g("매칭결과")), cust: String(g("거래처")),
      orderNos: String(g("주문번호")), diff: Number(g("차액")) || 0, memo: String(g("매칭메모")),
      pinned: String(g("지정") || ""), frozen: DP_FROZEN_STATES_.indexOf(String(g("상태"))) >= 0
    },
    options: list
  };
}

/** 남은 주문 찾기 — 숫자면 금액·주문번호, 아니면 거래처명 */
function dpCsOrdersSearch_(q) {
  var ss = dpLedgerSs_(false);
  if (!ss) return { rows: [] };
  q = String(q || "").trim();
  if (!q) return { rows: [] };
  var paid = _dp_paidMap_(ss, "");
  var digits = q.replace(/[,\s원]/g, "");
  var isNum = /^\d+$/.test(digits);
  var nq = dpNormName(q);
  var hits = dpLoadOrders_(ss).filter(function (o) {
    if (isNum) return String(o.amount) === digits || String(o.amount - (paid[o.no] || 0)) === digits || o.no.indexOf(q) >= 0;
    return nq && dpNormName(o.name).indexOf(nq) >= 0;
  }).map(function (o) { return _dp_orderView_(o, paid, ""); });
  hits.sort(function (a, b) { return (b.remain > 0) - (a.remain > 0) || (a.date < b.date ? 1 : -1); });
  return { rows: hits.slice(0, 30) };
}

/**
 * 지정 · 제외 · 되돌리기.
 * @param pin  {orders:[…]} | "제외" | ""(되돌리기 — 자동 판정으로)
 * @param remember  true 면 이 입금자 → 첫 주문의 거래처를 별칭표에 남긴다
 */
function dpCsPin_(key, pin, remember, by) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = dpLedgerSs_(false);
    if (!ss) return { ok: false, error: "입금대장이 없습니다" };
    var f = _dp_findRow_(ss, key);
    if (!f) return { ok: false, error: "입금을 찾지 못했습니다" };
    var state = String(f.row[f.c["상태"] - 1]);
    if (DP_FROZEN_STATES_.indexOf(state) >= 0) {
      return { ok: false, error: "이미 이카운트에 넘어간 입금입니다 (" + state + ") — 여기서는 못 바꿉니다" };
    }
    var val = "";
    if (pin === "제외") val = "제외";
    else if (pin && pin.orders && pin.orders.length) val = JSON.stringify({ orders: pin.orders, by: by, at: _dp_now_() });
    else if (pin && pin.orders) return { ok: false, error: "주문을 하나 이상 고르세요" };
    f.sh.getRange(f.rowNo, f.c["지정"]).setValue(val);

    if (remember && pin && pin.orders && pin.orders.length) {
      var o = dpLoadOrders_(ss).filter(function (x) { return x.no === pin.orders[0]; })[0];
      if (o) dpSaveAlias_(ss, String(f.row[f.c["입금자"] - 1]), o.code, o.name, by);
    }
    var res = dpMatchRunLocked_(ss);
    return { match: res[key] || null };
  } finally {
    lock.releaseLock();
  }
}
