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
  // 배분 목록은 판 번호 캐시 (dpCache.gs) — 뺄 입금만 여기서 뺀다
  var rows = dpCached_("alloc", function () { return _dp_allocRows_(ss); });
  var map = {};
  rows.forEach(function (x) {
    if (x[0] === excludeKey) return;
    x[1].forEach(function (a) { map[a.no] = (map[a.no] || 0) + (Number(a.apply) || 0); });
  });
  return map;
}

/** [[고유번호, 배분[]], …] — 제외된 입금 · 배분 없는 입금은 뺀다 */
function _dp_allocRows_(ss) {
  var sh = dpLedgerSheet_(ss);
  var c = _dp_cols_(sh);
  var out = [];
  if (sh.getLastRow() < 2 || !c["배분"]) return out;
  var n = sh.getLastRow() - 1;
  var keys = sh.getRange(2, c["고유번호"], n, 1).getValues();
  var res = sh.getRange(2, c["매칭결과"], n, 1).getValues();
  var alloc = sh.getRange(2, c["배분"], n, 1).getValues();
  for (var i = 0; i < n; i++) {
    if (String(res[i][0]) === "제외") continue;
    var a = [];
    try { a = JSON.parse(String(alloc[i][0] || "[]")) || []; } catch (e) { a = []; }
    if (a.length) out.push([String(keys[i][0]), a]);
  }
  return out;
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
  // ★ 최신순 · 같은 금액은 당일·전날만 (2026-09-29) — "후보가 너무 많네.. 최신순으로 … 당일,전날까지만"
  //   옛 주문은 아래 「찾기」 로 여전히 찾을 수 있다
  var newestFirst = function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.no < b.no ? 1 : -1); };
  var depDay = _dp_ts_(g("거래일시")).slice(0, 10);
  var code = String(g("거래처코드") || "");
  if (code) orders.filter(function (o) { return o.code === code && o.amount - (paid[o.no] || 0) > 0; })
    .sort(newestFirst).forEach(function (o) { add(o, "같은 거래처"); });
  orders.filter(function (o) { return o.amount - (paid[o.no] || 0) === amount && dpIsRecentOrder(o, depDay); })
    .sort(newestFirst).slice(0, 10).forEach(function (o) { add(o, "같은 금액"); });
  // 「지금 배분」 은 맨 위에 두고, 나머지는 최신순으로 다시 늘어놓는다
  var head = list.filter(function (o) { return o.tag === "지금 배분"; });
  list = head.concat(list.filter(function (o) { return o.tag !== "지금 배분"; }).sort(newestFirst));

  return {
    deposit: {
      key: key, txAt: _dp_ts_(g("거래일시")), name: String(g("입금자")), amount: amount,
      bank: String(g("은행")), acct: String(g("계좌")).replace(/[^\d]/g, "").slice(-4),
      status: String(g("상태")), result: String(g("매칭결과")), cust: String(g("거래처")),
      orderNos: String(g("주문번호")), diff: Number(g("차액")) || 0, memo: String(g("매칭메모")),
      pinned: String(g("지정") || ""), frozen: DP_FROZEN_STATES_.indexOf(String(g("상태"))) >= 0,
      slipNo: String(g("전표번호") || ""), postMemo: String(g("반영메모") || ""), postedBy: String(g("반영자") || ""),
      canPost: dpCanPost({ result: String(g("매칭결과")), status: String(g("상태")), code: String(g("거래처코드")), amount: amount, txAt: _dp_ts_(g("거래일시")) }, dpPostFrom_()).ok,
      // 시작 전이거나 스위치가 꺼져 있어도, 넘길 만한 판정이면 「이미 이카운트에 넣었음」 은 누를 수 있다
      // A안 (2026-10-10): 주문이 붙은 입금이면 판매 전환 대상 — 초과도 판매는 넘긴다 (차액만 따로 처리)
      canMarkManual: String(g("상태")) === "대기" &&
        DP_POSTABLE_RESULTS_.concat(["초과", "초과(지정)"]).indexOf(String(g("매칭결과"))) >= 0,
      postFrom: dpPostFrom_(),
      postOn: dpPostOn_()
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
