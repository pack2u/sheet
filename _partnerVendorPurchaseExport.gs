/**
 * ══════════════════════════════════════════════════════════════
 *  [구매입력] 한 업체분만 날짜별로 갈라 내보낸다
 *  파일: _partnerVendorPurchaseExport.gs
 *  2026-09-07
 *
 *  ★ 왜 필요한가 ★
 *    월 정산 때 한 업체만 이카운트에 다시 넣어야 하는 일이 있다.
 *    「이카운트-구매입력변환」 탭에는 그 달 모든 업체가 섞여 있어
 *    거기서 눈으로 골라 붙여넣으면 반드시 빠지거나 겹친다.
 *
 *    이카운트 구매입력은 「한 업체의 하루치」가 한 번에 넣는 단위다.
 *    그래서 날짜별로 탭을 갈라 둔다. 탭 하나가 곧 한 번의 붙여넣기다.
 *
 *  ★ 쓰는 순서 ★
 *    ① 「🧾 전용마감 → 구매입력 변환」 으로 그 달을 먼저 변환한다
 *    ② 이 기능을 돌려 업체를 고른다
 *    ③ 「구매입력」 폴더에 생긴 파일에서 날짜 탭을 하나씩 붙여넣는다
 *    ④ 요약 탭에 날짜별 합계가 있으니 넣은 날짜를 지워 가며 확인한다
 *
 *  ★ 원본을 건드리지 않는다 ★
 *    변환 탭에서 읽기만 한다. 골라낸 것을 새 파일에 쓴다.
 * ══════════════════════════════════════════════════════════════
 */

var _PVE_PREFIX_ = "구매입력_";

/** [메뉴] 업체 하나만 날짜별로 내보내기 */
function partnerExportVendorPurchase() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { return "UI 없음"; }

  var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var src = hub.getSheetByName(_EPX_OUT_TAB_);
  if (!src || src.getLastRow() < 2) {
    ui.alert("먼저 변환하세요",
      "「" + _EPX_OUT_TAB_ + "」 탭이 비어 있습니다.\n" +
      "「🧾 전용마감 → 구매입력 변환」 을 먼저 돌리세요.", ui.ButtonSet.OK);
    return "빈 탭";
  }

  var data = src.getRange(2, 1, src.getLastRow() - 1, _EPX_HEADERS_.length)
    .getDisplayValues();

  // 어떤 업체가 들어 있는지 먼저 보여준다. 이름을 외워서 칠 필요가 없다.
  var seen = {}, order = [];
  for (var i = 0; i < data.length; i++) {
    var nm = String(data[i][3] || "").trim();
    if (!nm) continue;
    if (!seen[nm]) { seen[nm] = 0; order.push(nm); }
    seen[nm]++;
  }
  order.sort();
  var list = [];
  for (var o = 0; o < order.length; o++) list.push("  " + order[o] + " (" + seen[order[o]] + "행)");

  var rs = ui.prompt(
    "업체 구매입력 내보내기",
    "내보낼 업체명을 넣으세요. 일부만 쳐도 됩니다 (예: 뉴파츠)\n\n" +
      "탭에 들어 있는 업체:\n" + list.join("\n"),
    ui.ButtonSet.OK_CANCEL
  );
  if (rs.getSelectedButton() !== ui.Button.OK) return "취소";
  var want = String(rs.getResponseText() || "").trim();
  if (!want) return "빈 값";

  var wantKey = _pve_norm_(want);
  var picked = [], hitNames = {};
  for (var r = 0; r < data.length; r++) {
    var vn = _pve_norm_(data[r][3]);
    if (!vn || vn.indexOf(wantKey) === -1) continue;
    picked.push(data[r]);
    hitNames[String(data[r][3] || "").trim()] = 1;
  }
  if (!picked.length) {
    ui.alert("없음", "「" + want + "」 로 찾은 행이 없습니다.", ui.ButtonSet.OK);
    return "0행";
  }

  // 날짜별로 나눈다
  var byDate = {}, dates = [];
  for (var p = 0; p < picked.length; p++) {
    var d = String(picked[p][0] || "").replace(/[^\d]/g, "");
    if (d.length !== 8) d = "날짜없음";
    if (!byDate[d]) { byDate[d] = []; dates.push(d); }
    byDate[d].push(picked[p]);
  }
  dates.sort();

  var vendorLabel = Object.keys(hitNames).join("·").substring(0, 24);
  var ym = dates.length && dates[0].length === 8
    ? dates[0].slice(0, 4) + "-" + dates[0].slice(4, 6) : "기간미상";
  var fileName = _PVE_PREFIX_ + vendorLabel + "_(" + ym + ")";

  var ss = _pve_getOrCreate_(hub, fileName);

  // 기존 탭을 지우기 전에 새 탭을 하나 만들어 둔다 — 시트가 0개가 되면 안 된다
  var keep = ss.insertSheet("_tmp_" + Date.now());
  var olds = ss.getSheets();
  for (var s = 0; s < olds.length; s++) {
    if (olds[s].getSheetId() !== keep.getSheetId()) ss.deleteSheet(olds[s]);
  }

  // ── 요약 탭 ──
  var sum = keep;
  sum.setName("요약");
  var sumRows = [];
  var gQty = 0, gSup = 0, gVat = 0, gAmt = 0, gNoCd = 0;
  for (var di = 0; di < dates.length; di++) {
    var rows = byDate[dates[di]];
    var q = 0, sp = 0, vt = 0, am = 0, noCd = 0;
    for (var k = 0; k < rows.length; k++) {
      q += _pve_num_(rows[k][13]);
      sp += _pve_num_(rows[k][16]);
      vt += _pve_num_(rows[k][17]);
      am += _pve_num_(rows[k][18]);
      if (!String(rows[k][2] || "").trim()) noCd++;
    }
    gQty += q; gSup += sp; gVat += vt; gAmt += am; gNoCd += noCd;
    sumRows.push([_pve_dash_(dates[di]), rows.length, q, sp, vt, am,
      noCd ? "★ 거래처코드 없음 " + noCd + "행" : "", ""]);
  }
  sumRows.push(["합계", picked.length, gQty, gSup, gVat, gAmt,
    gNoCd ? "★ 총 " + gNoCd + "행" : "", ""]);

  var sumHead = ["일자", "행수", "수량", "공급가액", "부가세", "금액", "확인", "입력완료"];
  sum.getRange(1, 1, 1, sumHead.length).setValues([sumHead])
    .setBackground("#1f4e78").setFontColor("#ffffff").setFontWeight("bold");
  sum.getRange(2, 1, sumRows.length, sumHead.length).setValues(sumRows);
  sum.getRange(sumRows.length + 1, 1, 1, sumHead.length).setFontWeight("bold")
    .setBackground("#f1f3f4");
  sum.setFrozenRows(1);
  try { sum.autoResizeColumns(1, sumHead.length); } catch (e) {}

  // ── 날짜별 탭 ──
  for (var dj = 0; dj < dates.length; dj++) {
    var rowsD = byDate[dates[dj]];
    var tab = ss.insertSheet(_pve_dash_(dates[dj]));
    tab.getRange(1, 1, 1, _EPX_HEADERS_.length).setValues([_EPX_HEADERS_])
      .setBackground("#1f4e78").setFontColor("#ffffff")
      .setFontWeight("bold").setHorizontalAlignment("center");

    // 앞자리 0 이 사는 열은 값 넣기 전에 텍스트로 잠근다 (A·C·K·W)
    try {
      for (var t = 0; t < _EPX_TEXT_COLS_.length; t++) {
        tab.getRange(2, _EPX_TEXT_COLS_[t], rowsD.length, 1).setNumberFormat("@");
      }
      SpreadsheetApp.flush();   // 서식은 미뤄졌다가 try 밖에서 터진다
    } catch (eFmt) {
      Logger.log("[PVE] 텍스트 서식 실패: " + eFmt.message);
    }

    // 순번을 그 날짜 안에서 1부터 다시 매긴다. 원본 순번은 월 전체 기준이라
    // 하루치만 떼어 붙이면 1 부터 시작하지 않아 이카운트에서 헷갈린다.
    var out = [];
    for (var rr = 0; rr < rowsD.length; rr++) {
      var row = rowsD[rr].slice();
      row[1] = rr + 1;
      out.push(row);
    }
    tab.getRange(2, 1, out.length, _EPX_HEADERS_.length).setValues(out);
    tab.setFrozenRows(1);
  }

  var msg = "업체: " + vendorLabel + "\n" +
    "행 " + picked.length + " · 날짜 " + dates.length + "일\n" +
    "금액 합계 " + gAmt.toLocaleString() + "\n" +
    (gNoCd ? "\n★ 거래처코드 없는 행 " + gNoCd + "개 — 요약 탭 확인\n" : "") +
    "\n파일: " + fileName + "\n「구매입력」 폴더에 있습니다.\n\n" +
    "날짜 탭 하나가 한 번의 붙여넣기 단위입니다.";
  ui.alert("내보내기 완료", msg, ui.ButtonSet.OK);
  Logger.log("[PVE] " + msg);
  return ss.getUrl();
}

// ───────────────────────────────────────────────────────────

function _pve_norm_(v) {
  return String(v == null ? "" : v)
    .replace(/㈜|주식회사|유한회사/g, "")
    .replace(/[\s\-_.,·|/()\[\]]/g, "")
    .toUpperCase();
}

function _pve_num_(v) {
  if (typeof v === "number" && !isNaN(v)) return v;
  var s = String(v == null ? "" : v).replace(/,/g, "").replace(/[^\d.\-]/g, "").trim();
  if (!s) return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function _pve_dash_(ymd) {
  var s = String(ymd || "");
  if (!/^\d{8}$/.test(s)) return s;
  return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
}

/** 「구매입력」 폴더에 파일을 만들거나 연다. 지우지 않고 내용만 새로 쓴다. */
function _pve_getOrCreate_(hub, fileName) {
  var folder = _epd_purchaseFolder_(hub);
  var it = folder.getFilesByName(fileName);
  while (it.hasNext()) {
    var f = it.next();
    var trashed = false;
    try { trashed = f.isTrashed(); } catch (eT) {}
    if (!trashed) return SpreadsheetApp.openById(f.getId());
  }
  var ss = SpreadsheetApp.create(fileName);
  try { DriveApp.getFileById(ss.getId()).moveTo(folder); } catch (eM) {}
  return ss;
}
