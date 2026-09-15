/**
 * 고유ID 인식 점검 (읽기 전용)
 *
 * 일일마감 M열 `주문자명(사방넷)` = `주문자명/고유아이디`.
 * 이 도구는 그 칸을 열어 슬래시 뒤를 뽑고, 송장맵에 그 키가 있는지 본다.
 *
 * 판정
 *   맵있음·미매칭   — 슬래시 뒤가 원천에 있고 지금 송장이 비어 있다 → 재매칭이 채움
 *   맵있음·이미채움 — 슬래시 뒤가 원천에 있고 이미 송장이 있다
 *   맵없음          — 고유ID 형식인데 롯데 J/허브 C/임시 P 에 없다
 *   고유ID없음      — 전화주문·이름만 (조합키 대상)
 *   수량초과        — 맵에 맞지만 장수가 2N 을 넘음
 *
 * 메뉴: 💼 협력업체 관리 → 🧭 송장 매칭 점검·정비 → 🪪 고유ID 인식 점검
 */

var _PUR_TAB_ = "고유ID_인식점검";
var _PUR_DAYS_ = 14;
var _PUR_MAX_ = 8000;

var _PUR_HEADERS_ = [
  "점검일시", "날짜", "행", "M열원문", "슬래시뒤", "스냅샷B식키",
  "진짜고유ID", "맵에있음", "맵출처", "현재송장수", "수량", "세트",
  "판정", "비고"
];

function partnerDiagnoseUidRecognition() {
  var ui = SpreadsheetApp.getUi();
  try {
    var res = _pur_run_(_PUR_DAYS_);
    var tab = _pur_write_(res);
    var mapOk = (res.by["맵있음·미매칭"] || 0) + (res.by["맵있음·이미채움"] || 0);
    var lines = [
      "고유ID 인식 점검 (최근 " + _PUR_DAYS_ + "일, 오늘 제외)",
      "",
      "파일 " + res.files + "개 · 행 " + res.scanned + "건",
      "송장맵 키 " + res.keys + " · 전용마감 " + (res.exclusive || 0) +
        "건 · 발주마감 " + (res.orderArchive || 0) +
        "건 · 허브아카이브 " + (res.hubArchive || 0) +
        "건 · 송장원장 " + (res.ledger || 0) + "건",
      "",
      "슬래시 뒤 고유ID → 송장맵에 있음: " + mapOk + "건",
      "  · 지금 송장 비어 있음 (재매칭이 채움): " + (res.by["맵있음·미매칭"] || 0) + "건",
      "  · 이미 송장 있음: " + (res.by["맵있음·이미채움"] || 0) + "건",
      "고유ID 형식인데 원천에 없음: " + (res.by["맵없음"] || 0) + "건",
      "고유ID 없음 (전화주문·조합키): " + (res.by["고유ID없음"] || 0) + "건",
      "수량초과: " + (res.by["수량초과"] || 0) + "건",
      "",
      "예전 방식(M열 칸 전체)으로는 " + (res.oldWholeMiss || 0) +
        "건이 미스였습니다. 지금은 슬래시 뒤만 씁니다.",
      "",
      "비어 있는 칸은 「일일마감 송장 재매칭 미리보기 → 반영」으로 채웁니다."
    ];
    ui.alert("🪪 고유ID 인식 점검", lines.join("\n"), ui.ButtonSet.OK);
    if (tab) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(tab);
  } catch (e) {
    ui.alert("고유ID 인식 점검 오류", String((e && e.message) || e), ui.ButtonSet.OK);
  }
}

function _pur_run_(days) {
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var stat = { lotte: 0, weekly: 0, ledger: 0, temp: 0, hub: 0, snapshot: 0, keys: 0, errors: [] };
  var invoiceMap = typeof _puv_buildInvoiceMap_ === "function" ? _puv_buildInvoiceMap_(stat) : {};
  var res = {
    files: 0, scanned: 0, rows: [], by: {}, keys: stat.keys,
    oldWholeMiss: 0, exclusive: stat.exclusive || 0, ledger: stat.ledger || 0,
    orderArchive: stat.orderArchive || 0, hubArchive: stat.hubArchive || 0
  };

  var today = new Date();
  for (var d = 1; d <= days; d++) {
    var dt = new Date(today.getTime());
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
    var fileName = _UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")";
    var archSs = _unified_findExistingArchiveSs_(fileName);
    if (!archSs) continue;
    var archTab = archSs.getSheetByName("일일마감") || archSs.getSheets()[0];
    if (!archTab || archTab.getLastRow() < 2) continue;
    res.files++;
    var lr = archTab.getLastRow();
    var lc = Math.max(archTab.getLastColumn(), 1);
    var all = archTab.getRange(1, 1, lr, lc).getDisplayValues();
    var cols = _pep_mapArchiveMatchCols_(all[0]);
    for (var ri = 1; ri < all.length; ri++) {
      if (String(all[ri][0] || "").indexOf("합계") !== -1) continue;
      res.scanned++;
      if (res.rows.length >= _PUR_MAX_) break;
      var raw = "";
      if (cols.orderer >= 0) raw = String(all[ri][cols.orderer] || "").trim();
      else if (cols.name >= 0) raw = String(all[ri][cols.name] || "").trim();
      else if (cols.oid >= 0) raw = String(all[ri][cols.oid] || "").trim();
      var extracted = _pep_uidFromOrdererCell_(raw);
      var derived = _pep_deriveMatchKeyFromArchiveRow_(all[ri], cols);
      var isUid = _pep_isRealUid_(extracted);
      var hit = isUid ? _pep_lookupInvoiceMap_(invoiceMap, extracted) : null;
      // lookup 은 슬래시를 빼므로, 예전 재매칭(칸 전체 키) 재현은 맵을 직접 본다
      var hitWhole = raw && invoiceMap[raw] && invoiceMap[raw].inv;
      var invCell = cols.inv >= 0 ? String(all[ri][cols.inv] || "").trim() : "";
      var invN = _pep_splitInvNos_(invCell).length;
      var qty = cols.qty >= 0 ? all[ri][cols.qty] : "";
      var item = cols.item >= 0 ? all[ri][cols.item] : "";
      var slot = typeof _par_slotSpec_ === "function" ? _par_slotSpec_(qty, item) : { set: false, max: 0 };
      var over = _pep_qtyOverMax_(qty, item, invCell);

      var verdict = "고유ID없음";
      var note = "";
      if (isUid && hit && hit.inv && raw !== extracted && !hitWhole) {
        res.oldWholeMiss++;
      }
      if (isUid && hit && hit.inv && over) {
        verdict = "수량초과";
        note = "맵에 맞음. 장수 " + invN + " > 최대 " + slot.max;
      } else if (isUid && hit && hit.inv && invN === 0) {
        verdict = "맵있음·미매칭";
        note = (hit.source || "") + (raw !== extracted && !hitWhole ? " · 예전 칸전체 조회면 미스" : "");
      } else if (isUid && hit && hit.inv) {
        verdict = "맵있음·이미채움";
        note = hit.source || "";
      } else if (isUid && !hit) {
        verdict = "맵없음";
        note = "슬래시 뒤=[" + extracted + "] 롯데 J·허브 C·임시 P 에 없음";
      } else if (!isUid && raw.indexOf("/") !== -1) {
        verdict = "고유ID없음";
        note = "슬래시 뒤가 고유ID 형식이 아님";
      } else {
        verdict = "고유ID없음";
        note = derived && String(derived).indexOf("TEL:") === 0 ? "전화주문 키" : "조합키 대상";
      }

      res.by[verdict] = (res.by[verdict] || 0) + 1;
      if (verdict === "맵있음·이미채움") continue;
      res.rows.push([
        now, dateStr, ri + 1, raw, extracted, derived,
        isUid ? "Y" : "N",
        hit && hit.inv ? "Y" : "N",
        hit && hit.source ? hit.source : "",
        invN, qty, slot.set ? "Y" : "N",
        verdict, note
      ]);
    }
  }
  return res;
}

function _pur_write_(res) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PUR_TAB_);
  if (!tab) tab = ss.insertSheet(_PUR_TAB_);
  tab.clear();
  tab.getRange(1, 1, 1, _PUR_HEADERS_.length).setValues([_PUR_HEADERS_])
    .setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
  tab.setFrozenRows(1);
  if (res.rows.length) {
    tab.getRange(2, 1, res.rows.length, _PUR_HEADERS_.length).setValues(res.rows);
  }
  tab.getRange(1, 2).setNote(
    "일일마감 M열 주문자명(사방넷) = 주문자명/고유아이디.\n" +
    "슬래시 뒤만 송장맵 키로 쓴다. 칸 전체를 넣으면 고유ID가 있어도 미스.\n" +
    "맵있음·이미채움 은 탭에 안 남긴다. 비어 있는 칸은 재매칭이 채운다."
  );
  tab.setColumnWidth(4, 220);
  tab.setColumnWidth(14, 360);
  return tab;
}
