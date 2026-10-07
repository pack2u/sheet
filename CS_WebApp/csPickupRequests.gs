/**
 * ══════════════════════════════════════════════════════════════
 *  업체가 요청한 반품 접수를 «실제로» 보낸다
 *
 *  > 사장님: "업체가 직접 반품접수 하는거 진행"  ·  "1시간이면 충분해, 기존거에 얹어줘"
 *
 *  ★ 길은 둘로 나뉘어 있다 ★
 *    업체 포털(Partner_WebApp/prpPickup.gs)은 **요청만** 적는다 —
 *    대장 비고에 「[yyMMdd HH:mm 업체:이름] 반품접수 요청.」 한 줄.
 *    실제 로젠·롯데 호출은 **여기**가 한다.
 *
 *    왜 나눴나 — 접수 로직(주소 되짚기·운임 조회·박스별 접수·대장 기록)은
 *    csLotteReturnPickupFromCard 에 있고 백 줄이 넘는다. 포털에 복사하면
 *    같은 것이 두 군데가 되고, 고칠 때 한쪽만 고치면 조용히 갈린다
 *    ([[one-value-one-owner]]). 포털은 별도 Apps Script 프로젝트라 그 함수를
 *    직접 못 부른다 — 그래서 «대장»을 사이에 두고 주고받는다.
 *
 *  ★ 1시간마다 돈다 ★
 *    새 트리거를 걸지 않고 csLogenSlipFill 의 1시간 트리거에 얹었다
 *    (csReturnHourlyJob). 차례가 중요하다 —
 *      ① 요청을 접수한다 (여기)  → takeNo 가 생긴다
 *      ② 송장을 채운다           → 그 자리에서 송장까지 붙는 날도 있다
 *
 *  ★ 실패해도 «요청 줄»을 그냥 두지 않는다 ★
 *    그대로 두면 다음 시간에 또 보내고, 또 실패하고, 업체는 영영 모른다.
 *    결과를 반드시 한 줄 적는다 — 성공이든 실패든. 업체 화면에도 보이게
 *    [yyMMdd HH:mm CS] 꼴로 찍는다(포털 prpPublicTimeline_ 이 그 모양만 내보낸다).
 * ══════════════════════════════════════════════════════════════
 */

/** 포털이 적는 요청 표시 — Partner_WebApp/prpPickup.gs 의 PRP_PICKUP_MARK_ 와 «같아야» 한다 */
var _CPR_REQ_MARK_ = "반품접수 요청";

/** 이미 처리했다고 볼 흔적 */
var _CPR_DONE_RE_ = /반품접수\s*(완료|실패)|회수접수\s*·/;

/** 한 번에 처리할 줄 수. 되돌리기 어려운 일이라 적게 잡는다. */
var _CPR_MAX_ = 20;

/** 며칠치까지 본다 */
var _CPR_DAYS_ = 14;

/**
 * 1시간마다 도는 일 — 요청 접수 → 송장 채우기.
 *
 * ★ 트리거는 이 함수를 부른다 ★ (csInstallLogenSlipFillTrigger 가 건다)
 *   차례를 바꾸지 말 것. 접수가 먼저여야 그 자리에서 송장까지 붙는다.
 */
function csReturnHourlyJob() {
  var L = [];
  try { L.push(csProcessPickupRequests()); }
  catch (e) { L.push("요청 접수 실패: " + e.message); }
  /*  기존트리거아님 — 여기서 부르는 것은 트리거가 «직접» 부른 것이 아니다.
      그 표를 안 주면 csLogenFillReturnSlips 가 옛 트리거를 찾느라 한 번 더
      훑는다(csLogenSlipFill.gs 머리말). 일은 같지만 헛걸음이다. */
  try { L.push(csLogenFillReturnSlips({ 기존트리거아님: true })); }
  catch (e) { L.push("송장 채우기 실패: " + e.message); }
  var 글 = L.join("\n\n");
  Logger.log(글);
  return 글;
}

/**
 * 대장을 훑어 «업체가 요청한» 줄을 찾아 실제로 접수한다.
 *
 * @param {Object} opt {days, dry}  dry=true 면 보내지 않고 보기만
 */
function csProcessPickupRequests(opt) {
  opt = opt || {};
  var days = opt.days > 0 ? opt.days : _CPR_DAYS_;
  var dry = !!opt.dry;
  var L = ["── 업체 반품접수 요청 처리 ──"];

  var ss;
  try { ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_); }
  catch (e) { var m = "NG 반품대장을 못 열었습니다: " + e.message; Logger.log(m); return m; }

  var 기준 = new Date();
  기준.setDate(기준.getDate() - days);

  //  ① 요청 줄을 모은다
  var 할것 = [];
  var 탭들 = _cs_listReturnLedgerMonthTabs_(ss);
  for (var t = 0; t < 탭들.length && 할것.length < _CPR_MAX_; t++) {
    var tab = ss.getSheetByName(탭들[t]);
    if (!tab) continue;
    var lastRow = tab.getLastRow();
    if (lastRow < 2) continue;
    var lastCol = Math.max(tab.getLastColumn(), 15);

    var scan = tab.getRange(1, 1, Math.min(lastRow, 40), lastCol).getDisplayValues();
    var hIdx = _cs_findReturnHeaderRow_(scan);
    if (hIdx < 0) continue;
    var col = _cs_mapReturnLedgerCols_(scan[hIdx]);
    if (col.notice < 0) continue;

    var 값 = tab.getRange(hIdx + 2, 1, lastRow - (hIdx + 1), lastCol).getDisplayValues();
    for (var i = 0; i < 값.length; i++) {
      var notice = String(값[i][col.notice] || "");
      if (notice.indexOf(_CPR_REQ_MARK_) === -1) continue;   // 요청이 없다
      if (_CPR_DONE_RE_.test(notice)) continue;              // 이미 처리했다

      if (col.date >= 0) {
        var d = _cpr_date_(값[i][col.date]);
        if (d && d < 기준) continue;
      }
      할것.push({ tabName: 탭들[t], tab: tab, rowNum: hIdx + 2 + i, col: col,
                  name: col.name >= 0 ? String(값[i][col.name] || "").trim() : "" });
      if (할것.length >= _CPR_MAX_) break;
    }
  }

  if (!할것.length) { var 끝0 = L.concat(["요청이 없습니다."]).join("\n"); Logger.log(끝0); return 끝0; }
  L.push("요청 " + 할것.length + "건");

  //  ② 하나씩 접수한다 — 되돌리기 어려운 일이라 건별로 결과를 남긴다
  var 됨 = 0, 안됨 = 0;
  for (var k = 0; k < 할것.length; k++) {
    var it = 할것[k];
    var 어디 = it.tabName + "!" + it.rowNum + (it.name ? "  " + it.name : "");

    if (dry) { L.push("  (연습) " + 어디); 됨++; continue; }

    var res = null, 왜 = "";
    try {
      res = csLotteReturnPickupFromCard({ tab: it.tabName, row: it.rowNum });
    } catch (e) { 왜 = e.message; }

    var 성공 = !!(res && res.ok && ((res.invoices && res.invoices.length) ||
                                    (res.takeNos && res.takeNos.length)));
    if (!왜 && !성공) 왜 = (res && res.error) || "원인 미상";

    /*  ★ 결과를 «반드시» 적는다 ★
        안 적으면 다음 시간에 또 보내고, 또 실패하고, 업체는 영영 모른다.
        [yyMMdd HH:mm CS] 꼴이라야 포털 타임라인에 나간다. */
    var 줄 = 성공
      ? (_CPR_REQ_MARK_.replace("요청", "완료") + "." +
         (res.takeNos && res.takeNos.length ? " 접수번호 " + res.takeNos.join(" ") : "") +
         (res.invoices && res.invoices.length ? " 반품송장 " + res.invoices.join(" ") : ""))
      : ("반품접수 실패 — " + 왜);
    try { _cpr_note_(it.tab, it.rowNum, it.col.notice, 줄); } catch (e) {}

    if (성공) { 됨++; L.push("  " + 어디 + " → " + 줄); }
    else { 안됨++; L.push("  ★ " + 어디 + " — " + 왜); }
  }

  L.push("");
  L.push("접수 " + 됨 + " · 실패 " + 안됨);
  if (안됨) L.push("★ 실패한 건은 사람이 봐야 합니다 — 업체 화면에도 그 사유가 보입니다");
  var 끝 = L.join("\n");
  Logger.log(끝);
  return 끝;
}

/** 비고에 한 줄 더한다 — 업체도 보게 [yyMMdd HH:mm CS] 를 찍는다 */
function _cpr_note_(tab, rowNum, noticeCol, body) {
  if (noticeCol < 0) return;
  var cell = tab.getRange(rowNum, noticeCol + 1);
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd HH:mm");
  var 줄 = "[" + now + " CS] " + body;
  cell.setValue(_cs_appendNoticeLine_(String(cell.getDisplayValue() || ""), 줄));
}

/** 대장의 날짜 글자 → Date. 못 읽으면 null (그때는 거르지 않는다) */
function _cpr_date_(v) {
  var s = String(v || "").trim();
  if (!s) return null;
  var m = s.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  if (!m) return null;
  var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}
