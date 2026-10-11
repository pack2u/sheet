/**
 * ══════════════════════════════════════════════════════════════════════
 *  묵은 반품 일괄 종결  —  202601~202607 탭의 미완료 건을 닫는다
 *  2026-10-11
 *
 *  > "묵은건-종결로 591건 일괄 닫아줘"            — 사장님
 *  > (낱말은 「완료-묵은건종결」로 정하셨다 — 아래 까닭)
 *
 *  ★ 왜 「완료-」를 앞에 붙이나 ★
 *    `_cs_isReturnDoneMark_` 는 「완료」로 시작하거나 「이카운트 ok」 또는
 *    「철회」만 완료로 본다. 「묵은건-종결」 그대로 적으면 591칸이 바뀌는데
 *    미완료로 계속 남는다 — 브리핑도 CS 화면도 그대로 센다. 고쳐 놓고
 *    아무것도 안 끝나는 셈이다. 「완료-묵은건종결」은 바로 걸린다.
 *
 *  ★ 왜 마른 돌리기가 기본인가 ★
 *    이 함수가 쓰는 칸은 옛 탭의 ★A열★ 이고, 그 자리에서 이미 사고가 났다 —
 *      「A 를 상태로 잡으니, 카드를 쓸 때 A 에 날짜를 넣은 뒤 상태가 그 위를
 *       덮었다. 10/01 에 올라간 7줄이 전부 접수날짜를 잃었다」
 *      (csOrderSearch.gs _cs_mapReturnLedgerCols_ 머리말)
 *    591줄을 눈 감고 덮을 자리가 아니다. 그래서
 *      ① 아무 것도 안 쓰고 «무엇을 바꿀지» 먼저 적어 보여 준다
 *      ② 쓰기 전에 그 탭의 A열·접수날짜열을 백업 탭에 통째로 담는다
 *      ③ 상태 칸 «하나씩만» 쓴다. 범위로 쓰지 않는다
 *
 *  ★ A열을 못 박지 않는다 ★ 상태 칸은 `_cs_mapReturnLedgerCols_` 가 찾는다.
 *    머리글을 먼저 보고, 없으면 A 로 떨어진다 — 그 판단의 주인은 그 함수다.
 *    여기서 또 「A열」이라고 적으면 탭 모양이 바뀌는 날 엉뚱한 칸을 덮는다.
 *
 *  쓰는 법 (Apps Script 편집기에서 함수를 골라 실행):
 *    1) csOldReturnCloseDryRun      — 아무것도 안 쓰고 무엇을 바꿀지 본다
 *    2) csOldReturnCloseApply       — 백업을 남기고 실제로 적는다
 *    3) csOldReturnCloseUndo        — 백업 탭을 보고 되돌린다
 *  편집기: https://script.google.com/home/projects/1eTAUhXH2tWBqqDI-36J4QGoKcILo1vP8SKT_O7AB3Mc4aHoj66q_jRe4/edit
 * ══════════════════════════════════════════════════════════════════════
 */

/** 적을 낱말. ★「완료」로 시작해야 완료로 읽힌다★ (_cs_isReturnDoneMark_) */
var _ORC_MARK_ = "완료-묵은건종결";

/** 닫을 월 탭. ★지난 달만 못 박는다★ — 이번 달이 섞이면 살아 있는 건을 닫는다 */
var _ORC_TABS_ = ["202601", "202602", "202603", "202604", "202605", "202606", "202607"];

/** 백업 탭 이름 앞머리 */
var _ORC_BACKUP_PREFIX_ = "_묵은건종결_백업_";

/**
 * 바꿀 줄을 모은다. ★아무것도 쓰지 않는다★
 *
 * @param {boolean} 날짜없는것도 접수날짜가 빈 줄도 넣을지
 * @return {{탭별: Object, 모두: Array, 날짜없음: number, 송장있음: number}}
 */
function _orc_scan_(날짜없는것도) {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var 모두 = [], 탭별 = {}, 날짜없음 = 0, 송장있음 = 0;

  for (var t = 0; t < _ORC_TABS_.length; t++) {
    var 이름 = _ORC_TABS_[t];
    var tab = ss.getSheetByName(이름);
    if (!tab) { 탭별[이름] = { 없는탭: true }; continue; }
    var lr = tab.getLastRow(), lc = Math.max(tab.getLastColumn(), 15);
    if (lr < 2) { 탭별[이름] = { n: 0 }; continue; }

    var 값 = tab.getRange(1, 1, lr, lc).getDisplayValues();
    var hIdx = _cs_findReturnHeaderRow_(값);
    if (hIdx < 0) { 탭별[이름] = { 머리글못찾음: true }; continue; }
    var col = _cs_mapReturnLedgerCols_(값[hIdx]);
    if (col.status < 0) { 탭별[이름] = { 상태칸못찾음: true }; continue; }

    var n = 0;
    for (var r = hIdx + 1; r < 값.length; r++) {
      var row = 값[r];
      var 상태 = String(row[col.status] || "").trim();

      /*  이미 끝난 건은 건드리지 않는다. 판정은 기존 함수가 한다 —
          「완료」·「이카운트 ok」·「철회」와 A열 표시까지 본다.           */
      if (_cs_isReturnLedgerDone_(상태, row)) continue;

      /*  ★ 빈 줄을 닫지 않는다 ★ 이름도 품목도 없는 줄은 반품이 아니다.
          202609 처럼 머리글 위·아래에 안내문이 섞인 탭이 있다.          */
      var 이름칸 = col.name >= 0 ? String(row[col.name] || "").trim() : "";
      var 품목칸 = col.item >= 0 ? String(row[col.item] || "").trim() : "";
      if (!이름칸 && !품목칸) continue;

      /*  ★ 반품송장이 붙은 줄은 닫지 않는다 ★ 수거가 돌고 있던 건이다.

          ★★ col.invoice 가 아니다 ★★  (2026-10-11 · 마른 돌리기에서 걸렸다)
            col.invoice       = /원송장|송장번호/ (반품송장 제외) → ★원주문★ 송장
            col.returnInvoice = /반품송장|회수송장/              → 반품 송장
          처음에 col.invoice 를 봤다. 원주문 송장은 거의 다 차 있어서
          ★1,083줄이 통째로 건너뛰어졌다★ — 591 을 찾아야 하는데 9줄만 나왔다.
          202601~04 가 0줄이던 것도 같은 까닭이다.
          마른 돌리기를 먼저 돌린 덕에 ★쓰기 전에★ 잡았다.               */
      if (col.returnInvoice < 0) { 탭별[이름] = { 반품송장칸못찾음: true }; break; }
      var 송장 = String(row[col.returnInvoice] || "").trim();
      if (송장) { 송장있음++; continue; }

      var ymd = col.date >= 0 ? _cs_ledgerYmdFromCell_(row[col.date]) : "";
      if (!ymd) {
        날짜없음++;
        if (!날짜없는것도) continue;      // 기본은 안 넣는다 — 사장님이 591 이라 하셨다
      }

      /*  ★ 옛 값을 지우지 않는다 ★  (2026-10-11 · 표본에서 보였다)
          옛 탭의 상태 칸(A열)에는 업체코드가 들어 있는 줄이 있다 —
          「뉴파츠」·「태양」·「아주팩」. 그 건을 어느 업체로 돌렸나를 적어
          둔 것이다([[hold-action-cell-grammar]]). 덮으면 그 정보가 사라진다.
          그래서 괄호로 데리고 간다: 「완료-묵은건종결(뉴파츠)」.
          앞이 「완료」로 시작하니 완료 판정은 그대로 걸린다.              */
      var 적을말 = 상태 ? (_ORC_MARK_ + "(" + 상태 + ")") : _ORC_MARK_;
      n++;
      모두.push({
        탭: 이름, 행: r + 1, 상태칸: col.status + 1, 날짜칸: col.date + 1,
        옛상태: 상태, 적을말: 적을말, 날: ymd, 이름: 이름칸, 품목: 품목칸.slice(0, 24)
      });
    }
    탭별[이름] = { n: n };
  }
  return { 탭별: 탭별, 모두: 모두, 날짜없음: 날짜없음, 송장있음: 송장있음 };
}

/** 사람이 읽을 보고서 */
function _orc_report_(결과, 머리) {
  var L = [머리, ""];
  for (var t = 0; t < _ORC_TABS_.length; t++) {
    var k = _ORC_TABS_[t], o = 결과.탭별[k] || {};
    if (o.없는탭) { L.push("  " + k + " — 탭이 없습니다"); continue; }
    if (o.머리글못찾음) { L.push("  " + k + " — ★머리글(반품접수날짜)을 못 찾았습니다 (건너뜀)"); continue; }
    if (o.상태칸못찾음) { L.push("  " + k + " — ★상태 칸을 못 찾았습니다 (건너뜀)"); continue; }
    if (o.반품송장칸못찾음) { L.push("  " + k + " — ★반품송장 칸을 못 찾았습니다 (건너뜀)"); continue; }
    L.push("  " + k + " — " + o.n + "줄");
  }
  L.push("");
  L.push("합 " + 결과.모두.length + "줄 · 적을 낱말 「" + _ORC_MARK_ + "」");
  if (결과.송장있음) {
    L.push("※ 반품송장이 붙어 있어 ★안 닫은★ 줄 " + 결과.송장있음 + "건 — 수거가 돌던 건입니다");
  }
  if (결과.날짜없음) {
    L.push("※ 접수날짜가 빈 줄 " + 결과.날짜없음 + "건은 ★안 넣었습니다★ — " +
           "넣으려면 csOldReturnCloseDryRunWithUndated 로 보세요");
  }
  L.push("");
  L.push("── 표본 10줄 ──");
  for (var i = 0; i < 결과.모두.length && i < 10; i++) {
    var x = 결과.모두[i];
    L.push("  " + x.탭 + "!" + x.행 + " · " + (x.날 || "(날짜없음)") + " · " + x.이름 +
           " · 상태「" + (x.옛상태 || "(빈칸)") + "」→「" + x.적을말 + "」· " + x.품목);
  }
  return L.join("\n");
}

/**
 * ① 마른 돌리기 — ★아무것도 쓰지 않는다★
 * 실행로그에 무엇을 바꿀지 적는다.
 */
function csOldReturnCloseDryRun() {
  var 결과 = _orc_scan_(false);
  var 글 = _orc_report_(결과, "【마른 돌리기】 아무것도 쓰지 않았습니다. 바꿀 줄은 이렇습니다:");
  Logger.log(글);
  try { _cpr_ops_(SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_), "묵은건 종결(마른)", 글.split("\n")[2] + " … 합 " + 결과.모두.length + "줄"); } catch (e) {}
  return 글;
}

/** ①-2 접수날짜가 빈 줄까지 넣어 본다 (마른 돌리기) */
function csOldReturnCloseDryRunWithUndated() {
  var 결과 = _orc_scan_(true);
  var 글 = _orc_report_(결과, "【마른 돌리기 · 날짜 빈 줄 포함】 아무것도 쓰지 않았습니다:");
  Logger.log(글);
  return 글;
}

/**
 * ② 실제로 적는다. ★백업을 먼저 남긴다★
 *
 * @param {Object=} opt { 날짜없는것도: true } 로 날짜 빈 줄까지
 */
function csOldReturnCloseApply(opt) {
  opt = opt || {};
  var 날짜없는것도 = !!opt["날짜없는것도"];
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var 결과 = _orc_scan_(날짜없는것도);
  if (!결과.모두.length) {
    var 없다 = "닫을 줄이 없습니다 — 이미 다 닫혔거나 조건에 맞는 줄이 없습니다.";
    Logger.log(없다); return 없다;
  }

  /*  ★ 백업 ★ 상태 칸과 접수날짜 칸을 줄마다 담는다. 되돌리려면 이것만
      있으면 된다. 날짜 칸까지 담는 까닭은 10/01 사고가 ★날짜를 잃은★
      사고였기 때문이다 — 혹시 또 그러면 여기서 되살린다.                */
    var 때 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd_HHmm");
  var bk = ss.insertSheet(_ORC_BACKUP_PREFIX_ + 때);
  var 담을것 = [["탭", "행", "상태칸", "옛상태", "날짜칸", "옛날짜", "이름", "품목"]];
  for (var i = 0; i < 결과.모두.length; i++) {
    var x = 결과.모두[i];
    var 옛날짜 = "";
    try {
      if (x.날짜칸 > 0) {
        옛날짜 = String(ss.getSheetByName(x.탭).getRange(x.행, x.날짜칸).getDisplayValue() || "");
      }
    } catch (e) {}
    담을것.push([x.탭, x.행, x.상태칸, x.옛상태, x.날짜칸, 옛날짜, x.이름, x.품목]);
  }
  bk.getRange(1, 1, 담을것.length, 8).setValues(담을것);
  SpreadsheetApp.flush();

  /*  ★ 한 칸씩 쓴다 ★ 범위로 쓰면 사이에 끼인 줄(안내문·빈 줄)까지 덮는다.
      591칸이면 느리지만, 이 일은 한 번뿐이다. 빠른 쪽이 위험한 쪽이다.   */
  var 쓴것 = 0, 실패 = [];
  for (var j = 0; j < 결과.모두.length; j++) {
    var y = 결과.모두[j];
    try {
      ss.getSheetByName(y.탭).getRange(y.행, y.상태칸).setValue(y.적을말 || _ORC_MARK_);
      쓴것++;
    } catch (e) { 실패.push(y.탭 + "!" + y.행 + " " + e.message); }
    if (쓴것 % 100 === 0) SpreadsheetApp.flush();
  }
  SpreadsheetApp.flush();

  var 글 = "【적었습니다】 " + 쓴것 + "줄에 「" + _ORC_MARK_ + "」\n" +
    "백업 탭: " + bk.getName() + " (되돌리려면 csOldReturnCloseUndo)\n" +
    (실패.length ? "★ 실패 " + 실패.length + "줄: " + 실패.slice(0, 5).join(" / ") : "실패 없음");
  Logger.log(글);
  try {
    _cpr_ops_(ss, "묵은건 종결", 쓴것 + "줄 적었습니다 · 백업 " + bk.getName() +
      (실패.length ? " · 실패 " + 실패.length : ""));
  } catch (e) {}
  /*  CS 화면이 옛 셈을 들고 있으면 안 바뀐 것처럼 보인다 — 캐시를 비운다 */
  try { if (typeof csInvalidateReturnLedgerCache_ === "function") csInvalidateReturnLedgerCache_(); } catch (e) {}
  return 글;
}

/**
 * ③ 되돌린다. 가장 최근 백업 탭을 보고 옛 상태를 그대로 복구한다.
 *
 * ★ 「빈칸이었다」도 빈칸으로 되돌린다 ★ 옛 상태가 비어 있던 줄이 많았다
 *   (202608 에 11줄). 그 줄에 아무거나 넣으면 되돌린 게 아니다.
 */
function csOldReturnCloseUndo(opt) {
  opt = opt || {};
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var 탭들 = ss.getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return n.indexOf(_ORC_BACKUP_PREFIX_) === 0; })
    .sort();
  if (!탭들.length) { var 없 = "백업 탭이 없습니다."; Logger.log(없); return 없; }
  var 쓸것 = String(opt["백업탭"] || 탭들[탭들.length - 1]);
  var bk = ss.getSheetByName(쓸것);
  if (!bk) { var 못 = "백업 탭을 못 찾았습니다: " + 쓸것; Logger.log(못); return 못; }

  var 값 = bk.getDataRange().getDisplayValues();
  var 되돌림 = 0, 건너뜀 = 0;
  for (var i = 1; i < 값.length; i++) {
    var 탭 = 값[i][0], 행 = Number(값[i][1]), 칸 = Number(값[i][2]), 옛 = 값[i][3];
    if (!탭 || !(행 > 0) || !(칸 > 0)) { 건너뜀++; continue; }
    try {
      var cell = ss.getSheetByName(탭).getRange(행, 칸);
      /*  ★ 지금 값이 우리가 적은 낱말일 때만 되돌린다 ★ 그 사이에 사람이
          다른 값을 넣었으면 그것을 덮으면 안 된다.                      */
      /*  괄호로 옛 값을 데려갔으므로 「완료-묵은건종결」로 ★시작하는지★ 로 본다.
          그냽 같은지로 보면 「완료-묵은건종결(뉴파츠)」를 못 알아보고 안 되돌린다. */
      var 지금 = String(cell.getDisplayValue() || "").trim();
      if (지금.indexOf(_ORC_MARK_) !== 0) { 건너뜀++; continue; }
      cell.setValue(옛);       // 빈칸이었으면 빈칸으로
      되돌림++;
    } catch (e) { 건너뜀++; }
    if (되돌림 % 100 === 0) SpreadsheetApp.flush();
  }
  SpreadsheetApp.flush();
  var 글 = "【되돌렸습니다】 " + 되돌림 + "줄 (건너뜀 " + 건너뜀 + ") · 백업 " + 쓸것;
  Logger.log(글);
  try { _cpr_ops_(ss, "묵은건 종결 되돌림", 글); } catch (e) {}
  try { if (typeof csInvalidateReturnLedgerCache_ === "function") csInvalidateReturnLedgerCache_(); } catch (e) {}
  return 글;
}
