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
    var t = String(times[i][0]);
    if (t > p.txAt) continue;
    if (bals[i][0] === "" || bals[i][0] == null) continue;
    if (t >= bestT) { bestT = t; best = Number(bals[i][0]); }
  }
  return best;
}
