/**
 * 입금대장 — 기록·중복 거름·잔액 연속성
 * ★ 2026-09-28 신규
 *
 * ★ 칸은 «이름으로» 찾는다 ★
 *   다음 단계에서 매칭결과·거래처·전표번호 칸이 붙는다. 자리 번호로 읽으면
 *   칸을 끼울 때마다 옆 칸을 읽게 된다(9/27 적요확인 탭 사고). 머리글 이름으로 찾는다.
 *
 * ★ 같은 거래는 한 줄 ★
 *   고유번호가 이미 있으면 적지 않는다. 확인과 적기 사이에 다른 요청이 끼지 않게
 *   스크립트 잠금 안에서 한다 — 폰이 같은 문자를 두 번 연달아 보내도 한 줄이다.
 */

var DP_SHEET_NAME_ = "입금대장";
var DP_HEADERS_ = [
  "고유번호", "수신시각", "거래일시", "은행", "계좌", "구분", "입금자", "금액",
  "거래후잔액", "잔액확인", "상태", "메모", "원문", "발신번호", "계좌키"
];
/** 잔액 연속성을 볼 때 뒤에서부터 읽는 줄 수. 한 계좌의 직전 거래는 이 안에 있다. */
var DP_LOOKBACK_ROWS_ = 500;

function dpLedgerSs_(createIfMissing) {
  var id = DP_LEDGER_ID || _dp_prop_("DP_LEDGER_ID");
  if (id) return SpreadsheetApp.openById(id);
  if (!createIfMissing) return null;
  var ss = SpreadsheetApp.create("팩투유_입금대장");
  PropertiesService.getScriptProperties().setProperty("DP_LEDGER_ID", ss.getId());
  Logger.log("입금대장을 만들었습니다: " + ss.getUrl());
  return ss;
}

function dpLedgerSheet_(ss) {
  var sh = ss.getSheetByName(DP_SHEET_NAME_);
  if (!sh) {
    sh = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0
      ? ss.getSheets()[0].setName(DP_SHEET_NAME_)
      : ss.insertSheet(DP_SHEET_NAME_);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, DP_HEADERS_.length).setValues([DP_HEADERS_]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.hideColumns(1);                                   // 고유번호
    sh.hideColumns(DP_HEADERS_.indexOf("계좌키") + 1);
    sh.getRange("H:I").setNumberFormat("#,##0");
    sh.getRange("B:C").setNumberFormat("@");
  } else {
    // 머리글이 모자라면 뒤에 붙인다 (다음 단계 칸 추가 대비)
    var have = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    DP_HEADERS_.forEach(function (h) {
      if (have.indexOf(h) < 0) {
        sh.getRange(1, have.length + 1).setValue(h).setFontWeight("bold");
        have.push(h);
      }
    });
  }
  return sh;
}

function _dp_cols_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var m = {};
  head.forEach(function (h, i) { m[String(h)] = i + 1; });
  return m;
}

/**
 * 문자 한 통 → 대장 한 줄 (+ 알림).
 * @return {{result:string, dup:boolean, key:string}}  result: 입금·출금·미해석
 */
function dpIngestSms_(body, rcv, from) {
  var p = dpParseSms(body, rcv);
  var key = p.ok ? dpMakeKey(p)
    : "RAW-" + Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, body, Utilities.Charset.UTF_8)).slice(0, 16);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var row, bal = { status: "확인불가", expected: null }, now = "", status = "";
  try {
    var sh = dpLedgerSheet_(dpLedgerSs_(true));
    var c = _dp_cols_(sh);

    if (sh.getLastRow() > 1) {
      var hit = sh.getRange(2, c["고유번호"], sh.getLastRow() - 1, 1)
        .createTextFinder(key).matchEntireCell(true).findNext();
      if (hit) return { result: p.ok ? p.kind : "미해석", dup: true, key: key };
    }

    if (p.ok) bal = dpCheckBalance(dpPrevBalance_(sh, c, p), p);

    now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    var rec = {
      "고유번호": key, "수신시각": now, "거래일시": p.txAt, "은행": p.bank, "계좌": p.account,
      "구분": p.ok ? p.kind : "", "입금자": p.name, "금액": p.amount, "거래후잔액": p.balance,
      "잔액확인": p.ok ? (bal.status === "불연속"
        ? "불연속 (예상 " + bal.expected.toLocaleString() + ")" : bal.status) : "",
      "상태": (status = !p.ok ? "미해석" : (p.kind === "입금" ? "대기" : "-")),
      "메모": p.ok ? p.warnings.join(" · ") : p.reason,
      "원문": body, "발신번호": from || "", "계좌키": p.ok ? dpAccountKey(p) : ""
    };
    row = [];
    var width = sh.getLastColumn();
    for (var i = 0; i < width; i++) row.push("");
    Object.keys(rec).forEach(function (h) {
      if (c[h]) row[c[h] - 1] = rec[h] == null ? "" : rec[h];
    });
    sh.appendRow(row);
  } finally {
    lock.releaseLock();
  }

  // 알림은 잠금 밖에서 — 챗이 느려도 다음 문자를 막지 않는다
  if (!p.ok) dpNotifyUnparsed_(body, p.reason);
  else if (p.kind === "입금") dpNotifyDeposit_(p, bal);
  else if (bal.status === "불연속") dpNotifyGap_(p, bal);

  // V2 그림자 — 꺼져 있거나 실패해도 여기서 끝난다 (dpMirror.gs)
  dpMirrorSend_([dpMirrorRecord_(key, now, from, body, p, bal, status)]);

  return { result: p.ok ? p.kind : "미해석", dup: false, key: key };
}

/**
 * 같은 계좌에서 이번 거래 «직전» 줄의 거래후잔액.
 * 문자가 늦게 도착할 수 있으므로 «마지막 줄»이 아니라 «거래일시가 이번보다 이르거나 같은 것 중 가장 늦은 줄»이다.
 */
function dpPrevBalance_(sh, c, p) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var start = Math.max(2, last - DP_LOOKBACK_ROWS_ + 1);
  var n = last - start + 1;
  var accKey = dpAccountKey(p);
  var keys = sh.getRange(start, c["계좌키"], n, 1).getValues();
  var times = sh.getRange(start, c["거래일시"], n, 1).getValues();
  var bals = sh.getRange(start, c["거래후잔액"], n, 1).getValues();
  var best = null, bestT = "";
  for (var i = 0; i < n; i++) {
    if (String(keys[i][0]) !== accKey) continue;
    var t = _dp_ts_(times[i][0]);
    if (t > p.txAt) continue;
    if (bals[i][0] === "" || bals[i][0] == null) continue;
    if (t >= bestT) { bestT = t; best = Number(bals[i][0]); }
  }
  return best;
}

/**
 * 하루치 입금 목록 — CS웹앱 대시보드가 부른다 (읽기만)
 * ★ 2026-09-29 신규
 *
 * > "웹앱에 입금 내용카드가 뜨게해줘 … 10개정도까지 보이게 … 더보기를 클릭해 당일 내용을"
 *
 * ★ 잔액은 안 내보낸다 ★ — 챗 알림과 같은 판단. 잔액확인은 «정상/불연속» 말만 준다.
 * ★ 입금만 ★ — 출금·미해석은 대시보드에 안 뜬다. 미해석은 건수만 알려 준다.
 *
 * @param {string} date   "yyyy-MM-dd". 비우면 오늘(서울)
 * @param {number} limit  0 이면 전부
 * @return {{date, total, sum, unparsed, rows:[{key,txAt,time,name,amount,bank,acct,status,check,memo}]}}
 */
function dpListDeposits_(date, limit) {
  var day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date
    : Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  var out = { date: day, total: 0, sum: 0, unparsed: 0, rows: [] };
  var ss = dpLedgerSs_(false);
  if (!ss) return out;
  var sh = ss.getSheetByName(DP_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) return out;

  var c = _dp_cols_(sh);
  var last = sh.getLastRow();
  var start = Math.max(2, last - DP_LOOKBACK_ROWS_ + 1);
  var vals = sh.getRange(start, 1, last - start + 1, sh.getLastColumn()).getValues();
  var col = function (r, h) { return c[h] ? r[c[h] - 1] : ""; };

  var hits = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var st = String(col(r, "상태"));
    var rcvDay = _dp_ts_(col(r, "수신시각")).slice(0, 10);
    if (st === "미해석") { if (rcvDay === day) out.unparsed++; continue; }
    if (String(col(r, "구분")) !== "입금") continue;
    var txAt = _dp_ts_(col(r, "거래일시"));
    if (txAt.slice(0, 10) !== day) continue;
    var amt = Number(col(r, "금액")) || 0;
    var acct = String(col(r, "계좌")).replace(/[^\d]/g, "").slice(-4);
    hits.push({
      key: String(col(r, "고유번호")),
      txAt: txAt,
      rcv: _dp_ts_(col(r, "수신시각")),
      time: txAt.slice(11, 16),
      name: String(col(r, "입금자")),
      amount: amt,
      bank: String(col(r, "은행")),
      acct: acct,
      status: st,
      check: String(col(r, "잔액확인")).indexOf("불연속") === 0 ? "불연속" : String(col(r, "잔액확인")),
      memo: String(col(r, "메모"))
    });
    out.sum += amt;
  }
  // 최근 것이 위로 — 같은 분이면 늦게 받은 것이 위
  hits.sort(function (a, b) {
    return a.txAt < b.txAt ? 1 : a.txAt > b.txAt ? -1 : (a.rcv < b.rcv ? 1 : a.rcv > b.rcv ? -1 : 0);
  });
  out.total = hits.length;
  out.rows = (limit > 0 ? hits.slice(0, limit) : hits).map(function (h) { delete h.rcv; return h; });
  return out;
}

/**
 * 시트 칸 → "yyyy-MM-dd HH:mm[:ss]" 글자.
 *
 * ★ 2026-09-29 ★ 글자로 적은 「2026-09-28 23:55」 를 시트가 날짜로 바꿔 두었다.
 *   getValues 는 그걸 Date 로 돌려주고, String(Date) 는 "Mon Sep 28 …" 이 된다.
 *   그래서 오늘 입금 조회가 0건이었고, 잔액 연속성도 직전 줄을 못 찾고 있었다.
 */
function _dp_ts_(v) {
  if (v && typeof v.getTime === "function" && !isNaN(v.getTime())) {
    var withSec = v.getSeconds() !== 0;
    return Utilities.formatDate(v, "Asia/Seoul", withSec ? "yyyy-MM-dd HH:mm:ss" : "yyyy-MM-dd HH:mm");
  }
  return String(v == null ? "" : v);
}
