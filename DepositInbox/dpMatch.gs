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

var DP_MATCH_VERSION = "1.1.0";

/**
 * ★ 플랫폼 정산금 (2026-09-29 첫날 실입금) ★
 *   스마트스토어·쿠팡페이·지마켓·우아한형제들·카카오 — 22건 중 7건이 이것이었다.
 *   주문서와 맞출 돈이 아니다. 게다가 거래처명에 「(지마켓 중복 - 세금영수증 미발행)박규현」 처럼
 *   플랫폼 이름이 섞인 거래처가 있어, 그대로 두면 엉뚱한 주문에 «초과»로 붙었다 (실제로 붙었다).
 *   그래서 거래처를 찾기 «전에» 걸러 「정산」으로 둔다.
 *   정리한 이름(dpNormName)에 이 낱말이 들어 있으면 정산이다.
 */
var DP_PLATFORM_PAYERS_ = [
  "스마트스토어", "네이버", "naver", "npay", "네이버페이", "페이충전",   // 2026-09-30 실입금 「Npay충전금」
   "쿠팡", "coupang", "지마켓", "g마켓", "gmarket", "옥션", "auction", "11번가",
  "이베이", "ebay", "우아한형제들", "배달의민족", "배민", "요기요", "위대한상상", "쿠팡이츠", "카카오", "kakao",
  "위메프", "티몬", "ssg", "쓱", "롯데온", "토스", "toss", "페이코", "payco", "카페24", "cafe24",
  "나이스페이", "이니시스", "inicis", "kg모빌리언스", "다날", "케이에스넷", "kicc", "한국정보통신", "nhn", "올리브영"
];

/** 플랫폼 정산금인가 */
function dpIsPlatformPayer(name) {
  var n = dpNormName(name);
  if (!n) return false;
  for (var i = 0; i < DP_PLATFORM_PAYERS_.length; i++) {
    if (n.indexOf(DP_PLATFORM_PAYERS_[i]) >= 0) return true;
  }
  return false;
}

/**
 * 입금자 이름의 «조각»들.
 * 은행은 「전진홍(손큰할매순대」 처럼 «대표자(상호» 를 괄호로 붙여 보내고 뒤를 자른다 (2026-09-29 실입금 4건).
 * 통째로는 어느 거래처와도 안 맞지만 「전진홍」 · 「손큰할매순대」 로 나누면 맞는다.
 */
function _dp_payerParts_(name) {
  return String(name == null ? "" : name).split(/[()\[\]{}\/,·\s]+/)
    .map(dpNormName).filter(function (s) { return s.length >= 2; });
}

/**
 * ★ 후보는 입금일 «당일 · 전날» 주문만 (2026-09-29) ★
 *   > "입금확인시 후보가 너무 많네.. 후보가 주문 최신순으로 보이게 해주고..당일,전날까지만 보이게 해줘
 *   >  대부분 하루이틀안에 확인이 되니까.."
 *   첫날 허기복 58,600원에 9/16~9/22 주문 6건이 후보로 떴다 — 같은 금액의 옛 주문은 대개 이미 받은 돈이다.
 *   거래처를 «찾은» 입금의 자동 매칭은 그대로 14일을 본다 (그건 후보가 아니라 그 거래처의 주문이다).
 *   주문일이나 납기일 중 하나가 창 안이면 된다 — 주문번호 날짜가 미래인 주문이 있다.
 */
var DP_CANDIDATE_DAYS_ = 1;   // 입금일 포함 이만큼 앞날까지 (1 = 당일 + 전날)

function _dp_dayShift_(ymd, n) {
  var m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return d.toISOString().slice(0, 10);
}

/** 입금일(yyyy-MM-dd) 기준 후보 창 안의 주문인가 */
function dpIsRecentOrder(o, depDay) {
  if (!depDay) return true;
  var from = _dp_dayShift_(depDay, -DP_CANDIDATE_DAYS_);
  var inWin = function (x) { return x && x >= from && x <= depDay; };
  return inWin(String(o.date || "").slice(0, 10)) || inWin(String(o.due || "").slice(0, 10));
}

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
  var tokensOf = {};
  codes.forEach(function (k) {
    tokensOf[k] = String(byCode[k].name).split(/[()\[\]{}\s\/,·]+/).map(dpNormName).filter(Boolean);
  });
  var one = function (hits, how) {
    return hits.length === 1 ? { code: hits[0], name: byCode[hits[0]].name, how: how } : null;
  };
  var tokenHits = codes.filter(function (k) { return tokensOf[k].indexOf(p) >= 0; });
  if (tokenHits.length) return one(tokenHits, "이름 일부");   // 둘 이상이면 짐작하지 않는다
  if (p.length >= 3) {
    var hits = codes.filter(function (k) {
      var n = dpNormName(byCode[k].name);
      return n.length >= 3 && (n.indexOf(p) >= 0 || p.indexOf(n) >= 0);
    });
    if (hits.length === 1) return one(hits, "비슷한 이름");
    if (hits.length > 1) return null;
  }

  // 입금자 이름을 조각내서 다시 — 「전진홍(손큰할매순대」 → 전진홍 · 손큰할매순대
  //   조각마다 맞는 거래처를 모아, «한 거래처»로 모일 때만 붙인다
  var parts = _dp_payerParts_(payer).filter(function (s) { return s !== p; });
  if (parts.length) {
    var seen = {};
    parts.forEach(function (part) {
      codes.forEach(function (k) {
        var n = dpNormName(byCode[k].name);
        if (tokensOf[k].indexOf(part) >= 0 || (part.length >= 3 && n.length >= 3 && n.indexOf(part) >= 0)) seen[k] = 1;
      });
    });
    var partHits = Object.keys(seen);
    if (partHits.length === 1) return one(partHits, "이름 조각");
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
  if (dpIsPlatformPayer(dep && dep.name)) {
    out.result = "정산";
    out.reason = "플랫폼 정산금 — 주문서와 맞추지 않음";
    return out;
  }

  // 아직 다 안 받은 주문만 (금액 0 이하 = 반품·차감 주문은 자연히 빠진다)
  var open = (orders || []).map(function (o) {
    return { no: String(o.no), date: String(o.date || ""), due: String(o.due || ""), code: String(o.code || ""), name: String(o.name || ""),
             remain: (Number(o.amount) || 0) - (Number(o.paid) || 0) };
  }).filter(function (o) { return o.remain > 0; });
  open.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.no < b.no ? -1 : a.no > b.no ? 1 : 0); });

  var customers = [];
  var seen = {};
  open.forEach(function (o) { if (o.code && !seen[o.code]) { seen[o.code] = 1; customers.push({ code: o.code, name: o.name }); } });

  var cust = dpFindCustomer(dep.name, customers, aliases);

  if (!cust) {
    // 후보는 당일 · 전날 주문만, 최신순 (DP_CANDIDATE_DAYS_)
    var depDay = String((dep && dep.txAt) || "").slice(0, 10);
    var same = open.filter(function (o) { return o.remain === amt && dpIsRecentOrder(o, depDay); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.no < b.no ? 1 : -1); });
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

/**
 * 이카운트 「주문서조회」 엑셀(보이는 값 2차원 배열) → 주문 목록
 * ★ 2026-09-29 — 실파일 「주문서 전체.xlsx」 모양
 *
 *   0행  회사명 : 주식회사 팩투유 / 2026/08/30 ~ 2026/10/29
 *   1행  주문번호 | 거래처명 | 거래처코드 | 거래처모바일 | 수령인 | 담당자 | 품목 | 납기일자 | 금액 | 종결\n여부 | 진행\n상태 | 인쇄
 *   2행~ 2026/10/13 -2 | 의령농산/표건욱 | 504-90-89283 | … | 1,410,000 | 진행중 | …
 *   끝행 2026/09/29 (화) 오전 12:26:11   ← 내려받은 시각
 *
 * ★ 칸은 «이름으로» 찾는다 ★ 머리글 줄도 찾아서 쓴다 — 이카운트 화면 설정에 따라 칸이 바뀐다.
 * ★ 「종결여부」 는 입금과 관계없다 ★ — 「완료」 = 판매현황으로 넘겼다는 뜻 (사용자 확인 2026-09-29).
 *   그래서 거르지 않고 싣기만 한다.
 *
 * ★ 조회 기간 · 내려받은 시각도 읽는다 (2026-09-29) ★
 *   > "주문서올리기는 각각 다른사람이 계속 다른 화일을 올리면 어떻게 되는거야?"
 *   여러 사람이 서로 다른 때 받은 파일을 올린다. 옛 파일이 새 내용을 덮지 않게 «언제 받은 파일인지»를,
 *   이카운트에서 지운 주문을 알아채려고 «어느 기간을 조회한 파일인지»를 함께 돌려준다.
 *
 * @param {Array<Array<string>>} rows
 * @return {{ok:boolean, error:string, orders:Array<{no,date,due,code,name,amount,done}>, skipped:number,
 *           range:{from:string,to:string}|null, downloadedAt:string}}
 *   downloadedAt: "yyyy-MM-dd HH:mm:ss" — 못 찾으면 ""
 */
function dpParseOrderSheet(rows) {
  var out = { ok: false, error: "", orders: [], skipped: 0, range: null, downloadedAt: "" };
  rows = rows || [];
  var norm = function (s) { return String(s == null ? "" : s).replace(/\s+/g, ""); };
  var hi = -1, col = {};
  for (var i = 0; i < Math.min(rows.length, 15); i++) {
    var r = (rows[i] || []).map(norm);
    if (r.indexOf("주문번호") >= 0 && r.indexOf("금액") >= 0) {
      hi = i;
      r.forEach(function (h, j) { if (h && col[h] == null) col[h] = j; });
      break;
    }
  }
  if (hi < 0) { out.error = "머리글(주문번호 · 금액)을 찾지 못했습니다 — 이카운트 「주문서조회」 엑셀인지 확인해 주세요"; return out; }
  var need = ["주문번호", "거래처명", "거래처코드", "금액"];
  var miss = need.filter(function (h) { return col[h] == null; });
  if (miss.length) { out.error = "칸이 없습니다: " + miss.join(", "); return out; }

  var ymd = function (s) {
    var m = String(s || "").match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    return m ? m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2) : "";
  };

  // 머리글 위 줄: 「회사명 : 주식회사 팩투유 / 2026/08/30  ~ 2026/10/29」
  for (var t = 0; t < hi; t++) {
    var mr = String((rows[t] || []).join(" ")).match(/(\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})\s*~\s*(\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})/);
    if (mr) { out.range = { from: ymd(mr[1]), to: ymd(mr[2]) }; break; }
  }
  // 「2026/09/29 (화) 오전 12:26:11」 — 이카운트가 끝에 적는 내려받은 시각
  var stamp = function (s) {
    var m = String(s || "").match(/^\s*(\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})\s*\([^)]*\)\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return "";
    var h = Number(m[3]) % 12 + (m[2] === "오후" ? 12 : 0);
    return ymd(m[1]) + " " + ("0" + h).slice(-2) + ":" + m[4] + ":" + m[5];
  };

  for (var k = hi + 1; k < rows.length; k++) {
    var row = rows[k] || [];
    var rawNo = String(row[col["주문번호"]] || "").trim();
    var mNo = rawNo.match(/^(\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})\s*-\s*(\d+)$/);
    if (!mNo) {
      var st = stamp(rawNo);
      if (st) out.downloadedAt = st;
      else if (rawNo) out.skipped++;
      continue;
    }
    var amt = Number(String(row[col["금액"]] || "").replace(/[^\d\-]/g, "")) || 0;
    out.orders.push({
      no: ymd(mNo[1]).replace(/-/g, "/") + "-" + mNo[2],   // 「2026/10/13 -2」 → 「2026/10/13-2」
      date: ymd(mNo[1]),
      due: col["납기일자"] != null ? ymd(row[col["납기일자"]]) : "",
      code: String(row[col["거래처코드"]] || "").trim(),
      name: String(row[col["거래처명"]] || "").trim(),
      amount: amt,
      done: col["종결여부"] != null ? String(row[col["종결여부"]] || "").trim() : ""
    });
  }
  out.ok = true;
  return out;
}

// ══════════════════════════════════════════════
//  대장 전체 매칭 — 순수 함수 (2026-10-10 dpOrders.gs dpMatchRunLocked_ 에서 옮김)
// ══════════════════════════════════════════════

/**
 * ★ 왜 옮겼나 ★  (2026-10-10 v2 이전)
 *   입금 «한 건» 판정(dpMatchDeposit)은 여기 있었지만, 대장 «전체»를 도는 순서 —
 *   거래일시 순으로 돌며 앞 입금이 채운 만큼 주문의 남은 돈을 줄이고, 이카운트에
 *   넘어간 줄은 적힌 배분대로 세기만 하고, 사람이 지정한 줄은 그대로 따르는 것 —
 *   은 시트 쪽 dpMatchRunLocked_ 안에 시트 읽기·쓰기와 섞여 있었다.
 *   V2 가 같은 답을 내려면 이 순서까지 같아야 한다. 두 벌로 짜면 갈라진다.
 *   그래서 순서만 떼어 여기 둔다 — 시트도 V2 도 이것을 부른다.
 */

/** 주문 몇 개에 입금액을 오래된 것부터 나눠 담는다 (사람이 고른 주문) */
function dpAllocManual(amount, picked) {
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
 * @param {Array} deps  대장 «줄 차례 그대로» —
 *   {key, kind(구분), txAt("yyyy-MM-dd HH:mm[:ss]"), state(상태), pin(지정), stored(배분 배열),
 *    prevResult(매칭결과), name(입금자), amount}
 * @param {Array} orders  {no, date, due, code, name, amount} — paid 는 여기서 0 부터 센다
 * @param {Object} aliases  정리한 입금자 → 거래처코드
 * @param {{since:string, frozen:string[]}} opts  since = 이 날 앞의 입금은 다시 안 본다
 * @return {Object} 고유번호 → {result, code, cust, alloc, diff, candidates, reason, nos}
 *   기간 밖·이카운트에 넘어간 줄은 «안 돌려준다» (적힌 대로 둔다 — 세기만 한다)
 */
function dpMatchAll(deps, orders, aliases, opts) {
  opts = opts || {};
  var since = String(opts.since || ""), frozen = opts.frozen || [];
  var mine = orders.map(function (o) {
    return { no: o.no, date: o.date, due: o.due, code: o.code, name: o.name, amount: Number(o.amount) || 0, paid: 0 };
  });
  var byNo = {};
  mine.forEach(function (o) { byNo[o.no] = o; });
  var addPaid = function (alloc) {
    (alloc || []).forEach(function (a) { if (byNo[a.no]) byNo[a.no].paid += Number(a.apply) || 0; });
  };

  var idx = [];
  deps.forEach(function (d, i) { if (String(d.kind) === "입금") idx.push(i); });
  idx.sort(function (a, b) {
    var ta = String(deps[a].txAt || ""), tb = String(deps[b].txAt || "");
    return ta < tb ? -1 : ta > tb ? 1 : a - b;
  });

  var out = {};
  idx.forEach(function (i) {
    var d = deps[i];
    var txAt = String(d.txAt || "");
    var pin = String(d.pin || "");
    var stored = d.stored || [];
    if (frozen.indexOf(String(d.state || "")) >= 0 || txAt.slice(0, 10) < since) {
      if (String(d.prevResult || "") !== "제외") addPaid(stored);
      return;
    }
    var amount = Number(d.amount) || 0;
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
        var m = dpAllocManual(amount, picked);
        res = { result: m.diff === 0 ? "일치(지정)" : (m.diff < 0 ? "부족(지정)" : "초과(지정)"),
                code: picked[0].code, cust: picked[0].name, alloc: m.alloc, diff: m.diff, candidates: [], reason: "사람이 지정" };
      }
    } else {
      res = dpMatchDeposit({ name: String(d.name || ""), amount: amount, txAt: txAt },
        mine.map(function (o) { return { no: o.no, date: o.date, due: o.due, code: o.code, name: o.name, amount: o.amount, paid: o.paid }; }),
        aliases);
      if (res.how && res.how !== "이름") res.reason = (res.reason ? res.reason + " · " : "") + "거래처: " + res.how;
    }
    addPaid(res.alloc);
    res.nos = res.alloc.length ? res.alloc.map(function (a) { return a.no; }).join(", ")
      : (res.candidates.length ? "후보: " + res.candidates.join(", ") : "");
    out[String(d.key)] = res;
  });
  return out;
}

// ══════════════════════════════════════════════
//  이카운트 일반전표 (4단계, 2026-09-29) — 규격: 이카운트_일반전표_API.md
// ══════════════════════════════════════════════

/**
 * 이카운트에 넘길 수 있는 판정.
 * 부족은 «들어온 만큼» 넘긴다 — 모자란 돈은 채권 잔액으로 남는 게 맞다.
 * 초과는 넘기지 않는다 — 남는 돈을 선수금으로 둘지 환불할지는 사람이 정한다.
 */
var DP_POSTABLE_RESULTS_ = ["일치", "일치(합산)", "일치(지정)", "부족", "부족(지정)"];

/**
 * ★ 반영 시작 시각 (2026-09-29) ★
 *   > "이미 처리된것도 이중으로 처리되는지 확인해줘.. 수동 확인건과 업로드하면 이중입금처리 되는거 아닌지.."
 *   이카운트 API 로는 입금·전표를 «읽을» 수 없다 — 누가 손으로(또는 엑셀로) 이미 넣었는지 알 길이 없다.
 *   그래서 선을 긋는다: 시작 시각 «이전» 입금은 시스템이 넘기지 않는다 (예전처럼 손으로).
 *   시작 시각이 비어 있으면 아무것도 넘기지 않는다 — 선을 긋지 않은 채 켜는 일이 없게.
 *   시작 뒤에 누가 손으로 넣었으면 「이미 이카운트에 넣었음」 으로 막는다 (dpEcount.gs mark_manual).
 *
 * @param {{result, status, code, amount, txAt}} r  입금대장 한 줄
 * @param {string} from  반영 시작 시각 "yyyy-MM-dd HH:mm" (스크립트 속성 DP_ECOUNT_FROM)
 * @return {{ok:boolean, reason:string, beforeStart:boolean}}
 */
function dpCanPost(r, from) {
  var base = _dp_canPostBase_(r);
  if (!base.ok) return base;
  if (!from) return { ok: false, reason: "반영 시작 시각이 정해지지 않음", beforeStart: true };
  if (String(r.txAt || "") < String(from)) {
    return { ok: false, reason: "반영 시작(" + from + ") 전 입금 — 손으로 처리했을 수 있어 넘기지 않는다", beforeStart: true };
  }
  return base;
}

function _dp_canPostBase_(r) {
  if (!r) return { ok: false, reason: "입금 없음" };
  if (String(r.status) !== "대기") return { ok: false, reason: "상태가 「" + r.status + "」 — 대기인 입금만 넘긴다" };
  if (DP_POSTABLE_RESULTS_.indexOf(String(r.result)) < 0) return { ok: false, reason: "「" + r.result + "」 은 넘기지 않는다" };
  if (!String(r.code || "").trim()) return { ok: false, reason: "거래처코드 없음" };
  if (!(Number(r.amount) > 0)) return { ok: false, reason: "금액 없음" };
  return { ok: true, reason: "" };
}

/** 고유번호 지문 (FNV-1a 32bit, 16진 8자) — 적요에 실어 이카운트에서 어느 입금인지 찾는다 */
function dpFingerprint(s) {
  var h = 0x811c9dc5;
  s = String(s || "");
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

/**
 * 입금 1건 → 일반전표 1장 (BulkDatas 두 줄, 같은 UPLOAD_SER_NO)
 *   차변(3) 보통예금  입금액
 *   대변(4) 외상매출금 입금액  거래처
 * 「입금(2)」 구분은 상대 계정이 현금으로 잡혀 쓰지 않는다 — 돈은 통장으로 들어왔다.
 *
 * @param {{key, txAt, name, amount, orderNos, code}} d
 * @param {{bankGye:string, arGye:string}} cfg
 * @param {number} serNo  이 요청 안에서의 전표 순번 (1부터)
 */
function dpBuildJournal(d, cfg, serNo) {
  var date = String(d.txAt || "").replace(/[^\d]/g, "").slice(0, 8);
  var nos = String(d.orderNos || "").replace(/^후보:\s*/, "");
  var remark = ("입금 " + (d.name || "") + (nos ? " · " + nos : "") + " · DP" + dpFingerprint(d.key)).slice(0, 200);
  var line = function (gubun, gye, cust) {
    return { BulkDatas: {
      UPLOAD_SER_NO: String(serNo || 1), TRX_DATE: date, ACCT_DOC_NO: "", SLIP_GUBUN: gubun,
      SITE: "", PJT_CD: "", GYE_CODE: String(gye), CUST_D: cust || "", CUST_NAME: "",
      DR_AMT: String(Number(d.amount) || 0), TAX_AMT: "", ACC101_EXCHANGE_RATE: "",
      REMARKS_CD: "", REMARKS_DES: remark,
      ITEM1_CD: "", ITEM2_CD: "", ITEM3_CD: "", ITEM4: "", ITEM5: "", ITEM6: "", ITEM7: "", ITEM8: ""
    } };
  };
  return [line("3", cfg.bankGye, ""), line("4", cfg.arGye, String(d.code || ""))];
}

/**
 * 이카운트 응답 → {kind, slipNo, message}
 *   kind: "ok"      전표가 만들어졌다 (전표번호 있음)
 *         "reject"  이카운트가 «안 받았다»고 분명히 말했다 → 다시 넣어도 된다
 *         "unknown" 들어갔는지 모른다 → 다시 넣지 말고 사람이 이카운트에서 확인
 */
function dpReadJournalResult(res) {
  if (!res || typeof res !== "object") return { kind: "unknown", slipNo: "", message: "응답을 읽지 못함" };
  var d = res.Data || {};
  var slips = d.SlipNos || [];
  if (String(res.Status) === "200" && Number(d.SuccessCnt) >= 1 && slips.length && slips[0]) {
    return { kind: "ok", slipNo: String(slips[0]), message: "" };
  }
  var msg = "";
  var details = d.ResultDetails;
  if (typeof details === "string") { try { details = JSON.parse(details); } catch (e) { msg = details; } }
  if (details && details.length) {
    msg = details.map(function (x) {
      var errs = (x.Errors || []).map(function (e) { return (e.ColCd ? e.ColCd + ": " : "") + (e.Message || ""); }).join(", ");
      return (x.TotalError || "") + (errs ? " (" + errs + ")" : "");
    }).join(" / ");
  }
  if (res.Error && res.Error.Message) msg = (msg ? msg + " / " : "") + res.Error.Message;
  if (String(res.Status) === "200" && Number(d.FailCnt) >= 1 && Number(d.SuccessCnt || 0) === 0) {
    return { kind: "reject", slipNo: "", message: msg || "이카운트가 거절함" };
  }
  if (String(res.Status) !== "200" && res.Error) return { kind: "reject", slipNo: "", message: msg };
  return { kind: "unknown", slipNo: "", message: msg || "결과가 분명하지 않음" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    dpCanPost: dpCanPost,
    dpFingerprint: dpFingerprint,
    dpBuildJournal: dpBuildJournal,
    dpReadJournalResult: dpReadJournalResult,
    DP_MATCH_VERSION: DP_MATCH_VERSION,
    dpNormName: dpNormName,
    dpFindCustomer: dpFindCustomer,
    dpMatchDeposit: dpMatchDeposit,
    dpMatchAll: dpMatchAll,
    dpAllocManual: dpAllocManual,
    dpParseOrderSheet: dpParseOrderSheet,
    dpIsRecentOrder: dpIsRecentOrder,
    dpIsPlatformPayer: dpIsPlatformPayer
  };
}
