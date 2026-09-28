/**
 * ══════════════════════════════════════════════════════════════
 *  주문서 · 별칭표 · 매칭 돌리기 (시트 쪽) — 규칙은 dpMatch.gs
 *  ★ 2026-09-29 신규
 *
 *  > "그냥 그날 주문수집전에 한번씩 다운 받아서 확인하고 판매현황으로 넘기는 기능이야"
 *    → 주문서조회 엑셀은 하루 한 번 받는다. 그때 CS웹앱에 한 번 올리면 된다.
 *
 *  ★ 입금누계를 «적어 두지» 않는다 — 매번 다시 센다 ★
 *    주문마다 「받은 돈」을 칸에 더해 두면, 매칭을 다시 돌리거나 사람이 고칠 때
 *    한 번 더 더해지는 일이 생긴다. 이 일의 발단이 바로 «두 번 세 번 들어가는» 것이었다.
 *    그래서 입금을 시간 차례대로 훑으며 그때그때 센다. 몇 번을 돌려도 답이 같다.
 *
 *  ★ 사람이 정한 것은 이긴다 ★
 *    「지정」 칸(주문번호 목록 또는 「제외」)이 있으면 자동 판정을 하지 않는다.
 *    이카운트에 이미 반영된 줄(상태 반영중·반영완료·확인필요)은 적어 둔 배분을 그대로 쓴다.
 *
 *  ★ 기간 ★
 *    주문서: 주문일이나 납기일이 최근 DP_ORDER_DAYS_ 일 안
 *    입금:   최근 DP_MATCH_DEPOSIT_DAYS_ 일 — 그 전 줄은 적어 둔 배분만 센다
 * ══════════════════════════════════════════════════════════════
 */

var DP_ORDERS_SHEET_ = "주문서";
var DP_ORDERS_HEADERS_ = ["주문번호", "주문일", "납기일", "거래처코드", "거래처명", "금액", "종결여부", "처음올림", "마지막올림"];
var DP_ALIAS_SHEET_ = "별칭표";
var DP_ALIAS_HEADERS_ = ["입금자(정리)", "입금자", "거래처코드", "거래처명", "지정자", "지정시각"];
var DP_ORDER_DAYS_ = 14;
var DP_MATCH_DEPOSIT_DAYS_ = 30;
/** 이카운트에 넘어간 줄 — 매칭을 다시 돌려도 건드리지 않는다 */
var DP_FROZEN_STATES_ = ["반영중", "반영완료", "확인필요"];
/** 입금대장에 붙는 매칭 칸 (dpLedgerSheet_ 가 없으면 뒤에 붙인다) */
var DP_MATCH_HEADERS_ = ["매칭결과", "거래처", "거래처코드", "주문번호", "차액", "매칭메모", "배분", "지정"];

function _dp_now_() { return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"); }
function _dp_daysAgo_(n) { return Utilities.formatDate(new Date(Date.now() - n * 86400000), "Asia/Seoul", "yyyy-MM-dd"); }

function _dp_tab_(ss, name, headers, textCols) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    // 날짜·번호가 날짜로 바뀌지 않게 글자 칸으로 (입금대장에서 겪은 일)
    if (textCols) sh.getRange(textCols).setNumberFormat("@");
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function _dp_readTab_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return { cols: _dp_cols_(sh), rows: [] };
  return { cols: _dp_cols_(sh), rows: sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() };
}

// ── 주문서 ────────────────────────────────────────

/**
 * 올린 주문을 붙인다. 주문번호가 같으면 고친다(금액·거래처가 바뀌었을 수 있다).
 * @return {{added:number, updated:number, total:number}}
 */
function dpUpsertOrders_(ss, orders) {
  var sh = _dp_tab_(ss, DP_ORDERS_SHEET_, DP_ORDERS_HEADERS_, "A:C");
  var t = _dp_readTab_(sh), c = t.cols;
  var at = {};
  t.rows.forEach(function (r, i) { at[String(r[c["주문번호"] - 1])] = i; });
  var now = _dp_now_(), added = [], updated = 0;
  orders.forEach(function (o) {
    var vals = [o.no, o.date, o.due, o.code, o.name, o.amount, o.done];
    if (at[o.no] != null) {
      var r = t.rows[at[o.no]];
      var changed = false;
      for (var j = 0; j < vals.length; j++) {
        var before = j === 1 || j === 2 ? _dp_ts_(r[j]).slice(0, 10) : String(r[j]);
        if (before !== String(vals[j])) { r[j] = vals[j]; changed = true; }
      }
      r[c["마지막올림"] - 1] = now;
      if (changed) updated++;
    } else {
      added.push(vals.concat([now, now]));
    }
  });
  if (t.rows.length) sh.getRange(2, 1, t.rows.length, t.rows[0].length).setValues(t.rows);
  if (added.length) sh.getRange(sh.getLastRow() + 1, 1, added.length, added[0].length).setValues(added);
  var props = PropertiesService.getScriptProperties();
  props.setProperty("DP_ORDERS_AT", now);
  props.setProperty("DP_ORDERS_COUNT", String(t.rows.length + added.length));
  return { added: added.length, updated: updated, total: t.rows.length + added.length };
}

/** 매칭에 쓸 주문 — 최근 DP_ORDER_DAYS_ 일 (주문일이나 납기일 기준) */
function dpLoadOrders_(ss) {
  var sh = ss.getSheetByName(DP_ORDERS_SHEET_);
  if (!sh) return [];
  var t = _dp_readTab_(sh), c = t.cols;
  var since = _dp_daysAgo_(DP_ORDER_DAYS_);
  return t.rows.map(function (r) {
    return {
      no: String(r[c["주문번호"] - 1]),
      date: _dp_ts_(r[c["주문일"] - 1]).slice(0, 10),
      due: _dp_ts_(r[c["납기일"] - 1]).slice(0, 10),
      code: String(r[c["거래처코드"] - 1]),
      name: String(r[c["거래처명"] - 1]),
      amount: Number(r[c["금액"] - 1]) || 0,
      paid: 0
    };
  }).filter(function (o) { return o.no && (o.date >= since || o.due >= since); });
}

// ── 별칭표 ────────────────────────────────────────

function dpLoadAliases_(ss) {
  var sh = ss.getSheetByName(DP_ALIAS_SHEET_);
  var map = {};
  if (!sh) return map;
  var t = _dp_readTab_(sh), c = t.cols;
  t.rows.forEach(function (r) {
    var k = String(r[c["입금자(정리)"] - 1]);
    if (k) map[k] = String(r[c["거래처코드"] - 1]);   // 아래 줄이 이긴다 — 나중에 고친 것
  });
  return map;
}

function dpSaveAlias_(ss, payer, code, name, by) {
  var k = dpNormName(payer);
  if (!k || !code) return false;
  var sh = _dp_tab_(ss, DP_ALIAS_SHEET_, DP_ALIAS_HEADERS_, "A:C");
  sh.appendRow([k, payer, code, name || "", by || "", _dp_now_()]);
  return true;
}

// ── 매칭 돌리기 ───────────────────────────────────

/** 주문 몇 개에 입금액을 오래된 것부터 나눠 담는다 (사람이 고른 주문) */
function _dp_allocManual_(amount, picked) {
  picked.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var left = amount, alloc = [];
  picked.forEach(function (o) {
    var remain = o.amount - o.paid;
    if (left <= 0 || remain <= 0) return;
    var put = Math.min(left, remain);
    alloc.push({ no: o.no, apply: put });
    left -= put;
  });
  var need = picked.reduce(function (s, o) { return s + Math.max(0, o.amount - o.paid); }, 0);
  return { alloc: alloc, diff: amount - need };
}

/**
 * 입금대장의 매칭 칸을 다시 채운다. 잠금은 부르는 쪽이 잡는다.
 * @return {Object} 고유번호 → {result, cust, nos, diff, reason}
 */
function dpMatchRunLocked_(ss) {
  var sh = dpLedgerSheet_(ss);
  var c = _dp_cols_(sh);
  var last = sh.getLastRow();
  var out = {};
  if (last < 2) return out;
  var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var orders = dpLoadOrders_(ss);
  var byNo = {};
  orders.forEach(function (o) { byNo[o.no] = o; });
  var aliases = dpLoadAliases_(ss);
  var since = _dp_daysAgo_(DP_MATCH_DEPOSIT_DAYS_);
  var g = function (r, h) { return c[h] ? r[c[h] - 1] : ""; };
  var s = function (r, h, v) { if (c[h]) r[c[h] - 1] = v; };

  var idx = [];
  rows.forEach(function (r, i) { if (String(g(r, "구분")) === "입금") idx.push(i); });
  idx.sort(function (a, b) {
    var ta = _dp_ts_(g(rows[a], "거래일시")), tb = _dp_ts_(g(rows[b], "거래일시"));
    return ta < tb ? -1 : ta > tb ? 1 : a - b;
  });

  var addPaid = function (alloc) {
    (alloc || []).forEach(function (a) { if (byNo[a.no]) byNo[a.no].paid += Number(a.apply) || 0; });
  };

  idx.forEach(function (i) {
    var r = rows[i];
    var key = String(g(r, "고유번호"));
    var txAt = _dp_ts_(g(r, "거래일시"));
    var state = String(g(r, "상태"));
    var pin = String(g(r, "지정") || "");
    var stored = [];
    try { stored = JSON.parse(String(g(r, "배분") || "[]")) || []; } catch (e) { stored = []; }

    // 이카운트에 넘어갔거나, 기간 밖이면 — 적어 둔 대로 세기만
    if (DP_FROZEN_STATES_.indexOf(state) >= 0 || txAt.slice(0, 10) < since) {
      if (String(g(r, "매칭결과")) !== "제외") addPaid(stored);
      return;
    }

    var amount = Number(g(r, "금액")) || 0;
    var res;
    if (pin === "제외") {
      res = { result: "제외", code: "", cust: "", alloc: [], diff: 0, candidates: [], reason: "주문 입금 아님 (사람이 제외)" };
    } else if (pin) {
      var want = [];
      try { want = (JSON.parse(pin).orders || []); } catch (e) { want = []; }
      var picked = want.map(function (no) { return byNo[no]; }).filter(Boolean);
      if (!picked.length) {
        res = { result: "확인필요", code: "", cust: "", alloc: [], diff: 0, candidates: want,
                reason: "지정한 주문(" + want.join(", ") + ")을 주문서에서 못 찾음 — 기간이 지났거나 주문서를 다시 올려야 함" };
      } else {
        var m = _dp_allocManual_(amount, picked);
        res = { result: m.diff === 0 ? "일치(지정)" : (m.diff < 0 ? "부족(지정)" : "초과(지정)"),
                code: picked[0].code, cust: picked[0].name, alloc: m.alloc, diff: m.diff, candidates: [], reason: "사람이 지정" };
      }
    } else {
      res = dpMatchDeposit({ name: String(g(r, "입금자")), amount: amount, txAt: txAt },
        orders.map(function (o) { return { no: o.no, date: o.date, code: o.code, name: o.name, amount: o.amount, paid: o.paid }; }),
        aliases);
      if (res.how && res.how !== "이름") res.reason = (res.reason ? res.reason + " · " : "") + "거래처: " + res.how;
    }
    addPaid(res.alloc);

    var nos = res.alloc.length ? res.alloc.map(function (a) { return a.no; }).join(", ")
      : (res.candidates.length ? "후보: " + res.candidates.join(", ") : "");
    s(r, "매칭결과", res.result);
    s(r, "거래처", res.cust || "");
    s(r, "거래처코드", res.code || "");
    s(r, "주문번호", nos);
    s(r, "차액", res.diff || "");
    s(r, "매칭메모", res.reason || "");
    s(r, "배분", res.alloc.length ? JSON.stringify(res.alloc) : "");
    out[key] = { result: res.result, cust: res.cust || "", nos: nos, diff: res.diff || 0, reason: res.reason || "" };
  });

  // 매칭 칸만 한 번에 쓴다
  DP_MATCH_HEADERS_.forEach(function (h) {
    if (!c[h] || h === "지정") return;
    sh.getRange(2, c[h], rows.length, 1).setValues(rows.map(function (r) { return [r[c[h] - 1]]; }));
  });
  return out;
}

/** 잠금을 잡고 매칭을 돌린다 */
function dpMatchRun_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = dpLedgerSs_(false);
    return ss ? dpMatchRunLocked_(ss) : {};
  } finally {
    lock.releaseLock();
  }
}

/** 편집기에서 ▶ — 매칭을 다시 돌려 본다 */
function dpMatchNow() {
  var r = dpMatchRun_();
  var n = {};
  Object.keys(r).forEach(function (k) { n[r[k].result] = (n[r[k].result] || 0) + 1; });
  Logger.log(JSON.stringify(n));
  return n;
}
