/**
 * ══════════════════════════════════════════════════════════════
 *  은행 입출금 문자 해석 — 순수 함수만 둔다
 *  ★ 2026-09-28 신규
 *
 *  > "계좌로 입금이 되었을때 은행 문자를 인식해서 입금 내용을 자동으로 확인하고 싶은거야"
 *
 *  ★ 은행마다 줄 순서가 다르다 ★
 *    신한은 금액이 먼저, KB 는 이름이 먼저, 기업은 한 줄에 다 있다.
 *    은행별 정규식을 따로 두면 은행이 문구를 조금만 바꿔도 조용히 깨진다.
 *    그래서 «알아볼 수 있는 조각을 하나씩 떼어 내고, 남은 글자를 이름으로» 본다.
 *      1) 은행 이름·[Web발신] 같은 꼬리표
 *      2) 날짜·시각
 *      3) 계좌번호 (별표·하이픈 섞인 것)
 *      4) 「입금 50,000」 「잔액 1,230,000」
 *      5) 남은 것 = 입금자
 *
 *  ★ 모르면 모른다고 한다 ★
 *    구분(입금/출금)과 금액을 못 찾으면 ok:false 다. 짐작해서 채우지 않는다.
 *    대장에는 「미해석」으로 원문과 함께 남고, 사람이 본다.
 *
 *  이 파일은 SpreadsheetApp 등을 부르지 않는다 — _dp_test.js 가 Node 에서 그대로 읽는다.
 *
 *  ★ V2 와 «한 파일을 같이 쓴다» ★  (시트→V2 이식전략 원칙 1)
 *    세트분리 core.js 와 같은 자리다. 주인은 이 파일 하나고, V2 는 배포 직전에
 *    복사본을 심어(tools/syncCore.mjs 방식) 같은 함수로 다시 읽는다.
 *    규칙이 두 벌이면 늦게 고친 쪽이 조용히 틀린다 — 그래서 V2 쪽 사본은 손으로 고치지 않는다.
 *    판정 규칙(매칭 등)이 늘어나도 이 파일처럼 «시트 API 없는 순수 함수»로만 둔다.
 * ══════════════════════════════════════════════════════════════
 */

/** 규칙이 바뀌면 올린다. 미러에 실려 가서 «어느 규칙이 낸 답인지» V2 가 안다. */
var DP_CORE_VERSION = "1.0.0";

/** 은행 이름 → 표시 이름. 앞에 있을수록 먼저 본다(「새마을」이 「마을」보다 먼저 등). */
var DP_BANKS_ = [
  ["카카오뱅크", "카카오뱅크"], ["케이뱅크", "케이뱅크"], ["토스뱅크", "토스뱅크"],
  ["새마을", "새마을금고"], ["MG", "새마을금고"], ["우체국", "우체국"], ["신협", "신협"],
  ["수협", "수협"], ["SC제일", "SC제일"], ["제일", "SC제일"],
  ["IBK", "기업"], ["기업", "기업"], ["KB", "국민"], ["국민", "국민"],
  ["NH", "농협"], ["농협", "농협"], ["신한", "신한"], ["우리", "우리"], ["하나", "하나"],
  ["iM", "iM뱅크"], ["대구", "iM뱅크"], ["부산", "부산"], ["경남", "경남"],
  ["광주", "광주"], ["전북", "전북"], ["제주", "제주"], ["씨티", "씨티"]
];

/** 입금자로 보면 안 되는 낱말. 은행 문자에 섞여 오는 적요·꼬리표다. */
var DP_STOPWORDS_ = [
  "Web발신", "web발신", "국외발신", "국제발신",
  "입금", "출금", "지급", "잔액", "원", "님", "은행", "뱅크",
  "타행", "당행", "전자금융", "인터넷", "모바일", "스마트", "폰뱅킹", "텔레뱅킹",
  "펌뱅킹", "CMS", "ATM", "이체", "입금이체", "출금이체", "누적", "알림", "거래"
];

/** 숫자 사이의 쉼표는 금액이고, 그 밖의 쉼표는 구분자다(하나은행 「하나,09/28,14:32」). */
function _dp_normalize_(text) {
  var s = String(text == null ? "" : text);
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");           // 1,230,000 → 1230000
  s = s.replace(/[,\n\t|]/g, " ");
  s = s.replace(/[ 　]/g, " ");
  return s;
}

function _dp_num_(s) {
  var n = parseInt(String(s).replace(/[^\d]/g, ""), 10);
  return isNaN(n) ? null : n;
}

function _dp_pad2_(n) { return (n < 10 ? "0" : "") + n; }

/**
 * 문자 한 통을 해석한다.
 *
 * @param {string} body        문자 본문
 * @param {Date}   receivedAt  폰이 받은 시각 (문자에 연도가 없어서 여기서 가져온다)
 * @return {{ok:boolean, reason:string, bank:string, account:string, kind:string,
 *           name:string, amount:number, balance:(number|null),
 *           txAt:string, warnings:string[]}}
 *         txAt 은 "yyyy-MM-dd HH:mm" (시각을 못 찾으면 받은 시각)
 */
function dpParseSms(body, receivedAt) {
  var out = {
    ok: false, reason: "", bank: "", account: "", kind: "", name: "",
    amount: null, balance: null, txAt: "", warnings: []
  };
  var rcv = (receivedAt instanceof Date && !isNaN(receivedAt)) ? receivedAt : new Date();
  var s = " " + _dp_normalize_(body) + " ";

  // 1) 꼬리표 [Web발신] [KB] 등 — 대괄호 안의 은행 이름은 먼저 읽고 지운다
  s = s.replace(/\[([^\]]*)\]/g, function (_, inner) {
    if (!out.bank) out.bank = _dp_findBank_(inner);
    return " ";
  });
  if (!out.bank) out.bank = _dp_findBank_(s);

  // 2) 잔액 — 「잔액」 뒤의 첫 숫자. 금액보다 먼저 떼어야 금액으로 잘못 안 읽는다
  s = s.replace(/잔액\s*:?\s*(-?\d+)\s*원?/, function (_, n) {
    out.balance = _dp_num_(n) * (String(n).charAt(0) === "-" ? -1 : 1);
    return " ";
  });

  // 3) 구분 + 금액 — 「입금 50000」 「입금50000원」 「출금 3000」
  var m = s.match(/(입금|출금|지급)\s*:?\s*(\d+)\s*원?/);
  if (m) {
    out.kind = (m[1] === "입금") ? "입금" : "출금";
    out.amount = _dp_num_(m[2]);
    s = s.replace(m[0], " ");
  } else {
    // 「50000원 입금」 처럼 금액이 앞에 오는 은행
    m = s.match(/(\d+)\s*원\s*(입금|출금|지급)/);
    if (m) {
      out.kind = (m[2] === "입금") ? "입금" : "출금";
      out.amount = _dp_num_(m[1]);
      s = s.replace(m[0], " ");
    }
  }

  // 4) 날짜·시각 — 「09/28 14:32」 「09-28」 「14:32:05」
  var mon = null, day = null, hh = null, mi = null, yr = null;
  // 연도까지 적는 은행 — 「2026/09/28」 (2026-09-28 실문자에서 확인). 짧은 꼴보다 먼저 본다
  s = s.replace(/(^|[^\d])(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?![\d\-*])/, function (all, pre, y, a, b) {
    var M = +a, D = +b;
    if (M >= 1 && M <= 12 && D >= 1 && D <= 31) { yr = +y; mon = M; day = D; return pre + " "; }
    return all;
  });
  if (mon == null) s = s.replace(/(^|[^\d])(\d{1,2})[\/.\-](\d{1,2})(?![\d\-*])/, function (all, pre, a, b) {
    var M = +a, D = +b;
    if (M >= 1 && M <= 12 && D >= 1 && D <= 31) { mon = M; day = D; return pre + " "; }
    return all;
  });
  s = s.replace(/(^|[^\d])(\d{1,2}):(\d{2})(?::\d{2})?(?!\d)/, function (all, pre, a, b) {
    hh = +a; mi = +b;
    return pre + " ";
  });

  // 5) 계좌번호 — 별표나 하이픈이 섞인 숫자 덩어리
  s = s.replace(/[\d*]*\*[\d*\-]*|\d+(?:-[\d*]+)+/g, function (acc) {
    if (!out.account && /\d/.test(acc)) out.account = acc;
    return " ";
  });

  // 6) 남은 글자 = 입금자. 은행 이름·적요 낱말은 뺀다
  var bankWords = DP_BANKS_.map(function (b) { return b[0]; });
  var left = s.split(/\s+/).filter(function (t) {
    if (!t) return false;
    if (/^\d+원?$/.test(t)) return false;
    if (DP_STOPWORDS_.indexOf(t) >= 0) return false;
    for (var i = 0; i < bankWords.length; i++) {
      if (t === bankWords[i]) return false;
      // 「신한09/28」 에서 날짜가 빠지고 남은 「신한」 같은 조각
      if (t.indexOf(bankWords[i]) === 0 && t.length <= bankWords[i].length + 2 &&
          /^(은행|뱅크|뱅킹)?$/.test(t.slice(bankWords[i].length))) return false;
    }
    return true;
  });
  out.name = left.join(" ").replace(/님$/, "").trim();

  // 거래 시각 — 문자에 연도가 없다. 받은 시각의 연도를 쓰되 12월 문자를 1월에 받으면 한 해 뺀다
  var y = yr || rcv.getFullYear();
  if (yr) { /* 문자에 연도가 있으면 그대로 믿는다 */ }
  else if (mon == null) { mon = rcv.getMonth() + 1; day = rcv.getDate(); out.warnings.push("날짜 없음(받은 날짜 사용)"); }
  else if (mon === 12 && rcv.getMonth() === 0) y -= 1;
  if (hh == null) { hh = rcv.getHours(); mi = rcv.getMinutes(); out.warnings.push("시각 없음(받은 시각 사용)"); }
  out.txAt = y + "-" + _dp_pad2_(mon) + "-" + _dp_pad2_(day) + " " + _dp_pad2_(hh) + ":" + _dp_pad2_(mi);

  if (!out.kind || out.amount == null) { out.reason = "입금/출금 금액을 찾지 못함"; return out; }
  if (out.amount <= 0) { out.reason = "금액이 0"; return out; }
  if (!out.name) out.warnings.push("입금자 없음");
  if (out.balance == null) out.warnings.push("잔액 없음");
  out.ok = true;
  return out;
}

function _dp_findBank_(text) {
  var t = String(text || "");
  for (var i = 0; i < DP_BANKS_.length; i++) {
    if (t.indexOf(DP_BANKS_[i][0]) >= 0) return DP_BANKS_[i][1];
  }
  return "";
}

/**
 * 고유번호 — 같은 거래면 몇 번을 받아도 같은 값이 나와야 한다.
 *
 * 거래후잔액을 넣는 까닭: 같은 사람이 같은 분에 같은 금액을 두 번 보내도
 * 잔액은 다르다. 잔액이 없는 문자는 이 구분이 안 되므로 경고를 남긴다.
 */
function dpMakeKey(p) {
  return [
    String(p.txAt || "").replace(/[^\d]/g, ""),
    p.kind || "",
    p.amount == null ? "" : p.amount,
    String(p.name || "").replace(/\s+/g, ""),
    p.balance == null ? "" : p.balance,
    String(p.account || "").replace(/[^\d]/g, "").slice(-4)
  ].join("-");
}

/**
 * 잔액 연속성 — 사이에 빠진 문자가 있는지 본다.
 *
 * @param {number|null} prevBalance  같은 계좌의 직전 거래후잔액
 * @param {Object} p                 이번 해석 결과
 * @return {{status:string, expected:(number|null)}}
 *         status: "정상" | "불연속" | "확인불가"
 */
function dpCheckBalance(prevBalance, p) {
  if (prevBalance == null || p.balance == null || p.amount == null) {
    return { status: "확인불가", expected: null };
  }
  var expected = p.kind === "입금" ? prevBalance + p.amount : prevBalance - p.amount;
  return { status: expected === p.balance ? "정상" : "불연속", expected: expected };
}

/** 계좌 구분용 — 은행 + 계좌 끝 4자리. 가림 처리가 문자마다 달라도 끝자리는 대개 같다. */
function dpAccountKey(p) {
  var tail = String(p.account || "").replace(/[^\d]/g, "").slice(-4);
  return (p.bank || "?") + ":" + (tail || "?");
}

/* Node(V2·테스트)에서 require 로 읽을 때만 내보낸다. Apps Script 에는 module 이 없다. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DP_CORE_VERSION: DP_CORE_VERSION,
    dpParseSms: dpParseSms,
    dpMakeKey: dpMakeKey,
    dpCheckBalance: dpCheckBalance,
    dpAccountKey: dpAccountKey
  };
}
