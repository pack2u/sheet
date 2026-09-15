/**
 * ══════════════════════════════════════════════════════════════
 *  일일마감 — 수량을 넘는 송장 정리
 *
 *  대리발송 건에서 한 행에 송장이 수십 개 붙는 일이 있었다. 수취인·전화·주소가
 *  업체 자기 것이라 사람만 가리키는 조회 키에 그 업체의 모든 주문 송장이 쌓였고,
 *  사방넷 그룹 병합이 그 목록을 그룹 전원에게 덮어썼다.
 *
 *  수집 쪽은 `_partnerExclusivePush.gs` 에서 막았다. 이 도구는 **막기 전에
 *  이미 기록된 파일**을 되돌린다.
 *
 *  ★ 판정은 하나다 — 송장 개수가 그 주문이 만들 수 있는 최대 장수를 넘는가.
 *    한 주문을 여러 박스로 나눠 보내면 송장이 여러 장일 수 있지만, 박스는
 *    아무리 쪼개도 수량의 두 배를 넘지 않는다 (`_par_slotSpec_` 의 max).
 *    세트 품목은 뚜껑·몸통이 따로 나가므로 그 계산에 이미 반영돼 있다.
 *
 *  ★ 넘치는 행은 **비운다. 골라내지 않는다.**
 *    어느 것이 이 행 임자인지 알 방법이 없다. 40장 중 하나를 찍어 남기면
 *    39장을 지우고 틀린 1장을 남길 수 있다. 미매칭으로 두면 송장원장이
 *    바로잡힌 뒤 `⏪ 일일마감 송장 재매칭` 이 제 값을 채운다.
 *
 *  ★ 지운 값은 「수량초과_정리」 탭에 원본 그대로 남긴다. 되돌릴 근거다.
 * ══════════════════════════════════════════════════════════════
 */

var _PQP_LOG_TAB_ = "수량초과_정리";
var _PQP_DEFAULT_DAYS_ = 14;

/**
 * 정리 대상 판정 — 넘치면 사유, 아니면 ""
 *
 * 상한은 `_par_slotSpec_` 이 정한다. 수량으로 직접 자르면 안 된다 —
 * 품목명에 「세트」가 있으면 뚜껑·몸통이 따로 나가 1개 주문에 송장 2장이 정상이다.
 *
 * 수량 칸이 비어 있으면 판정하지 않는다. `_par_qtyNum_` 이 빈값을 1 로 뭉개므로
 * 그대로 믿으면 수량을 모르는 행을 「수량 1」로 단정해 멀쩡한 송장을 지운다.
 */
function _pqp_overReason_(invCell, qty, item) {
  var list = _pep_splitInvNos_(invCell);
  if (list.length <= 1) return "";
  if (!String(qty == null ? "" : qty).replace(/[^0-9]/g, "")) return "";
  var ok = _par_slotSpec_(qty, item);
  if (list.length <= ok.max) return "";
  return (ok.set ? "세트 수량 " + ok.qty : "수량 " + ok.qty) +
    "(최대 " + ok.max + "장)인데 송장 " + list.length + "장";
}

/** 최근 N일치 마감 파일을 훑어 넘치는 행을 모은다 */
function _pqp_scan_(days) {
  var res = { files: 0, scanned: 0, noItemCol: [] };
  var out = { files: 0, scanned: 0, hits: [], byDate: {} };
  var today = new Date();

  for (var d = 0; d < days; d++) {
    var dt = new Date(today.getTime());
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
    var day = _par_readDay_(dateStr, res);
    if (!day) continue;
    out.files++;

    for (var mi = 0; mi < day.metas.length; mi++) {
      var m = day.metas[mi];
      out.scanned++;
      var why = _pqp_overReason_(m.cur, m.qty, m.item);
      if (!why) continue;
      out.hits.push({
        day: day, dateStr: dateStr, ri: m.ri,
        name: m.name, item: String(m.item || "").trim(),
        qty: m.qty, inv: m.cur, count: m.invs.length, why: why,
        src: day.cols.src >= 0 ? String(day.all[m.ri][day.cols.src] || "").trim() : "",
      });
      out.byDate[dateStr] = (out.byDate[dateStr] || 0) + 1;
    }
  }
  return out;
}

function _pqp_logTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PQP_LOG_TAB_);
  if (!tab) {
    tab = ss.insertSheet(_PQP_LOG_TAB_);
    tab.getRange(1, 1, 1, 8).setValues([[
      "정리일시", "마감일자", "행", "수취인", "품목명", "수량", "지운 송장", "사유",
    ]]).setFontWeight("bold");
    tab.setFrozenRows(1);
    // 송장은 앞자리 0 이 날아가지 않게 텍스트로 둔다
    tab.getRange(2, 7, tab.getMaxRows() - 1, 1).setNumberFormat("@");
  }
  return tab;
}

/**
 * 🧹 일일마감 수량초과 송장 정리
 *
 * 미리 보여주고, 확인을 받은 뒤에만 지운다.
 */
function partnerPurgeArchiveQtyOverflow() {
  var ui = SpreadsheetApp.getUi();

  var ask = ui.prompt(
    "🧹 일일마감 수량초과 송장 정리",
    "송장 개수가 수량을 넘는 행을 찾아 그 칸을 비웁니다.\n" +
    "(수량 1개인데 송장 여러 장 — 남의 송장이 붙은 것)\n\n" +
    "비운 값은 「" + _PQP_LOG_TAB_ + "」 탭에 남습니다.\n\n" +
    "며칠 전까지 볼까요? (기본 " + _PQP_DEFAULT_DAYS_ + "일)",
    ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;

  var days = parseInt(String(ask.getResponseText() || "").replace(/[^0-9]/g, ""), 10);
  if (!(days >= 1)) days = _PQP_DEFAULT_DAYS_;
  if (days > 90) days = 90;

  var scan = _pqp_scan_(days);
  if (!scan.hits.length) {
    ui.alert("🧹 수량초과 송장 정리",
      "최근 " + days + "일 · 마감파일 " + scan.files + "개 · " + scan.scanned + "행을 봤습니다.\n\n" +
      "수량을 넘는 송장이 없습니다. 정리할 것이 없습니다.", ui.ButtonSet.OK);
    return;
  }

  var lines = [];
  var dates = Object.keys(scan.byDate).sort().reverse();
  for (var di = 0; di < dates.length; di++) {
    lines.push(" · " + dates[di] + ": " + scan.byDate[dates[di]] + "건");
  }
  var eg = [];
  for (var ei = 0; ei < Math.min(scan.hits.length, 8); ei++) {
    var h = scan.hits[ei];
    eg.push("  " + h.dateStr + " " + (h.ri + 1) + "행 · " + (h.name || "?") +
      " · " + h.item.substring(0, 14) + " → " + h.why);
  }

  var ok = ui.alert("🧹 수량초과 송장 정리 — 확인",
    "최근 " + days + "일 · 마감파일 " + scan.files + "개 · " + scan.scanned + "행\n\n" +
    "정리 대상 " + scan.hits.length + "건\n" + lines.join("\n") + "\n\n" +
    "예시:\n" + eg.join("\n") +
    (scan.hits.length > 8 ? "\n  … 외 " + (scan.hits.length - 8) + "건" : "") + "\n\n" +
    "이 행들의 운송장번호·택배사를 비우고 출처를 「미매칭」으로 바꿉니다.\n" +
    "지운 값은 「" + _PQP_LOG_TAB_ + "」 탭에 남습니다.\n\n" +
    "진행할까요?", ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  // ── 반영 ──
  var stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var logRows = [];
  var touchedDays = {};
  for (var hi = 0; hi < scan.hits.length; hi++) {
    var hit = scan.hits[hi];
    var cols = hit.day.cols;
    var row = hit.day.all[hit.ri];
    logRows.push([stamp, hit.dateStr, hit.ri + 1, hit.name, hit.item, hit.qty,
      String(hit.inv).replace(/\n/g, ", "), hit.why + " (종전 출처 " + (hit.src || "-") + ")"]);

    row[cols.inv] = "";
    if (cols.carrier >= 0) row[cols.carrier] = "";
    if (cols.src >= 0) row[cols.src] = "미매칭";
    touchedDays[hit.dateStr] = hit.day;
  }

  var written = 0;
  for (var dk in touchedDays) {
    if (!touchedDays.hasOwnProperty(dk)) continue;
    var dd = touchedDays[dk];
    dd.tab.getRange(1, 1, dd.all.length, dd.lc).setValues(dd.all);
    written++;
  }

  var logTab = _pqp_logTab_();
  logTab.getRange(logTab.getLastRow() + 1, 1, logRows.length, 8).setValues(logRows);
  SpreadsheetApp.flush();

  ui.alert("🧹 수량초과 송장 정리 — 완료",
    scan.hits.length + "건을 미매칭으로 돌렸습니다. (마감파일 " + written + "개 수정)\n\n" +
    "지운 값은 「" + _PQP_LOG_TAB_ + "」 탭에 있습니다.\n\n" +
    "송장원장이 바로잡힌 뒤 「⏪ 일일마감 송장 재매칭」 을 돌리면\n" +
    "이 행들이 제 송장으로 다시 채워집니다.", ui.ButtonSet.OK);
}
