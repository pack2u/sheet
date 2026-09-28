/**
 * ══════════════════════════════════════════════════════════════
 *  입금 ↔ 주문서 매칭 — 순수 함수만 둔다 (dpParse.gs 와 같은 자리)
 *  ★ 2026-09-29 신규 · 적용계획 6절
 *
 *  > "확인했어, 이제 주문서 매칭 진행해줘"
 *
 *  ★ V2 와 한 파일 ★ 시트 API 를 부르지 않는다. V2 는 이 파일을 복사해 같은 답을 낸다.
 *
 *  ★ 판정 ★ (후보 = 아직 다 안 받은 주문서)
 *    거래처를 찾았다
 *      금액이 한 주문의 남은 돈과 같다          → 일치
 *      여러 주문의 남은 돈을 합친 것과 같다      → 일치(합산)   ※ 조합이 둘 이상이면 후보
 *      모자란다                                 → 부족  (오래된 주문부터 채운다)
 *      남는다                                   → 초과  (전부 채우고 차액)
 *    거래처를 못 찾았다
 *      같은 금액의 주문이 있다                   → 후보  (사람이 고른다)
 *      없다                                     → 미확인
 *
 *  ★ 거래처 찾기 ★
 *    1) 별칭표 (사람이 한 번 지정한 입금자 → 거래처)  ← 가장 믿는다
 *    2) 이름 정리 후 같음  「(주)태양 포장」 = 「태양포장」
 *    3) 이름 «조각»이 같음  「구도로통닭 역곡점 이병남」 의 「이병남」
 *       — 이카운트 거래처명 945건 중 904건이 「상호 + 대표자명」 이었다 (2026-09-29 실측).
 *         입금자는 대표자 개인 이름으로 찍히는 일이 많다. 2글자 이름도 조각이 «통째로» 같으면 본다.
 *    4) 한쪽이 다른 쪽을 품음 (3글자 이상일 때만)  — 은행이 긴 이름을 잘라 보낼 때
 *       「구도로통닭역곡」 ⊂ 「구도로통닭역곡점이병남」
 *    ※ 3)·4)가 둘 이상의 거래처에 걸리면 못 찾은 것으로 본다 — 짐작해서 붙이지 않는다
 *
 *  ★ 날짜로 거르지 않는다 ★ (2026-09-29)
 *    이카운트 주문번호 날짜가 납기보다 늦은 주문이 14건, 오늘보다 뒤인 주문이 3건 있었다.
 *    날짜로 거르면 진짜 주문이 빠진다. 기간은 부르는 쪽이 «최근 며칠치»로 잘라서 넘긴다.
 *
 *  ★ 모르면 모른다고 한다 ★ 애매하면 «후보»로 올리고 사람이 고른다.
 *    잘못 붙이면 채권이 틀어진다 — 그게 이 작업을 시작한 까닭이다.
 * ══════════════════════════════════════════════════════════════
 */

var DP_MATCH_VERSION = "1.0.0";

/** 합산 조합을 찾을 때 볼 주문 수 한도 — 2^n 이라 크게 잡으면 느려진다 */
var DP_MATCH_MAX_COMBO_ = 12;

/** 거래처·입금자 이름 정리 — 비교용. 보여 줄 때는 원래 이름을 쓴다 */
function dpNormName(s) {
  return String(s == null ? "" : s)
    .replace(/주식회사|유한회사|합자회사|\(주\)|\(유\)|㈜|㈔|\(사\)/g, "")
    .replace(/[\s()\[\]{}.,·\-_/&'"]/g, "")
    .toLowerCase();
}

/**
 * 입금자 → 거래처.
 * @param {string} payer
 * @param {Array<{code:string,name:string}>} customers   후보 주문서들의 거래처
 * @param {Object} aliases   { 정리된입금자명: 거래처코드 }
 * @return {{code:string, name:string, how:string}|null}
 */
function dpFindCustomer(payer, customers, aliases) {
  var p = dpNormName(payer);
  if (!p) return null;
  var byCode = {};
  customers.forEach(function (c) { if (c && c.code) byCode[c.code] = c; });

  if (aliases && aliases[p]) {
    var a = aliases[p];
    return { code: a, name: (byCode[a] && byCode[a].name) || "", how: "별칭" };
  }
  var codes = Object.keys(byCode);
  for (var i = 0; i < codes.length; i++) {
    if (dpNormName(byCode[codes[i]].name) === p) return { code: codes[i], name: byCode[codes[i]].name, how: "이름" };
  }
  var tokenHits = codes.filter(function (k) {
    return String(byCode[k].name).split(/[\s\/,·]+/).some(function (t) { return t && dpNormName(t) === p; });
  });
  if (tokenHits.length === 1) return { code: tokenHits[0], name: byCode[tokenHits[0]].name, how: "이름 일부" };
  if (tokenHits.length > 1) return null;   // 같은 이름이 여러 거래처에 — 짐작하지 않는다
  if (p.length >= 3) {
    var hits = codes.filter(function (k) {
      var n = dpNormName(byCode[k].name);
      return n.length >= 3 && (n.indexOf(p) >= 0 || p.indexOf(n) >= 0);
    });
    if (hits.length === 1) return { code: hits[0], name: byCode[hits[0]].name, how: "비슷한 이름" };
  }
  return null;
}

/**
 * 합이 target 인 조합들 (주문 차례 유지). 최대 2개까지만 찾는다 — 둘이면 이미 «애매»하다.
 */
function _dp_combos_(items, target) {
  var n = Math.min(items.length, DP_MATCH_MAX_COMBO_);
  var found = [];
  for (var mask = 1; mask < (1 << n) && found.length < 2; mask++) {
    var s = 0, pick = [];
    for (var i = 0; i < n; i++) if (mask & (1 << i)) { s += items[i].remain; pick.push(items[i]); }
    if (s === target && pick.length >= 2) found.push(pick);
  }
  return found;
}

/**
 * 입금 한 건을 주문서들에 맞춰 본다.
 *
 * @param {{name:string, amount:number, txAt:string}} dep
 * @param {Array<{no:string, date:string, code:string, name:string, amount:number, paid:number}>} orders
 *        paid = 이미 받은 돈(입금누계). 남은 돈 = amount - paid
 * @param {Object} aliases  { 정리된입금자명: 거래처코드 }
 * @return {{result:string, code:string, cust:string, how:string,
 *           alloc:Array<{no:string, apply:number}>, diff:number, candidates:string[], reason:string}}
 *   result: 일치 · 일치(합산) · 부족 · 초과 · 후보 · 미확인
 *   alloc : 주문마다 이번 입금에서 채우는 금액 (확정할 때 입금누계에 더한다)
 *   diff  : 부족이면 음수(더 받아야 할 돈), 초과면 양수(남는 돈)
 */
function dpMatchDeposit(dep, orders, aliases) {
  var amt = Number(dep && dep.amount) || 0;
  var out = { result: "미확인", code: "", cust: "", how: "", alloc: [], diff: 0, candidates: [], reason: "" };
  if (amt <= 0) { out.reason = "금액 없음"; return out; }

  // 아직 다 안 받은 주문만 (금액 0 이하 = 반품·차감 주문은 자연히 빠진다)
  var open = (orders || []).map(function (o) {
    return { no: String(o.no), date: String(o.date || ""), code: String(o.code || ""), name: String(o.name || ""),
             remain: (Number(o.amount) || 0) - (Number(o.paid) || 0) };
  }).filter(function (o) { return o.remain > 0; });
  open.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.no < b.no ? -1 : a.no > b.no ? 1 : 0); });

  var customers = [];
  var seen = {};
  open.forEach(function (o) { if (o.code && !seen[o.code]) { seen[o.code] = 1; customers.push({ code: o.code, name: o.name }); } });

  var cust = dpFindCustomer(dep.name, customers, aliases);

  if (!cust) {
    var same = open.filter(function (o) { return o.remain === amt; });
    if (same.length) {
      out.result = "후보";
      out.candidates = same.map(function (o) { return o.no; });
      out.reason = "입금자 「" + (dep.name || "?") + "」 를 거래처로 못 찾음 — 같은 금액 주문 " + same.length + "건";
    } else {
      out.reason = "입금자 「" + (dep.name || "?") + "」 를 거래처로 못 찾고, 같은 금액 주문도 없음";
    }
    return out;
  }

  out.code = cust.code; out.cust = cust.name; out.how = cust.how;
  var mine = open.filter(function (o) { return o.code === cust.code; });
  if (!mine.length) {
    out.result = "미확인";
    out.reason = cust.name + " — 받을 주문서가 없음 (선입금이거나 주문서 미등록)";
    return out;
  }

  // 1) 한 주문과 딱 맞음 — 같은 금액이 여럿이면 오래된 것부터
  for (var i = 0; i < mine.length; i++) {
    if (mine[i].remain === amt) {
      out.result = "일치";
      out.alloc = [{ no: mine[i].no, apply: amt }];
      return out;
    }
  }

  // 2) 여러 주문의 합과 맞음
  var combos = _dp_combos_(mine, amt);
  if (combos.length === 1) {
    out.result = "일치(합산)";
    out.alloc = combos[0].map(function (o) { return { no: o.no, apply: o.remain }; });
    return out;
  }
  if (combos.length > 1) {
    out.result = "후보";
    out.candidates = mine.map(function (o) { return o.no; });
    out.reason = cust.name + " — 합이 맞는 주문 조합이 둘 이상";
    return out;
  }

  // 3) 모자라거나 남음 — 오래된 주문부터 채운다
  var total = mine.reduce(function (s, o) { return s + o.remain; }, 0);
  var left = amt;
  for (var k = 0; k < mine.length && left > 0; k++) {
    var put = Math.min(left, mine[k].remain);
    out.alloc.push({ no: mine[k].no, apply: put });
    left -= put;
  }
  if (amt > total) {
    out.result = "초과";
    out.diff = amt - total;
    out.reason = cust.name + " — 받을 돈보다 " + out.diff.toLocaleString() + "원 더 들어옴";
  } else {
    out.result = "부족";
    // 마지막으로 채운 주문에서 모자란 만큼
    var lastNo = out.alloc[out.alloc.length - 1].no;
    var lastRemain = mine.filter(function (o) { return o.no === lastNo; })[0].remain;
    out.diff = out.alloc[out.alloc.length - 1].apply - lastRemain;
    out.reason = cust.name + " — 주문 " + lastNo + " 에 " + (-out.diff).toLocaleString() + "원 모자람";
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DP_MATCH_VERSION: DP_MATCH_VERSION,
    dpNormName: dpNormName,
    dpFindCustomer: dpFindCustomer,
    dpMatchDeposit: dpMatchDeposit
  };
}
