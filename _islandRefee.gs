/**
 * ══════════════════════════════════════════════════════════════
 *  이미 붙은 도서산간비를 «박스당»으로 다시 맞춘다   — 일회용
 *  파일: _islandRefee.gs      2026-10-06
 *
 *  > "박스 수량으로 따지니까 도서산간비도 박스당 가격으로 적용되야되"
 *  > "다시 계산해서 맞춰줘"
 *
 *  ★ 왜 일회용인가 ★
 *    2026-10-05 에 「수량과 상관없이 한 줄 5,000」으로 붙은 금액이 남아 있다.
 *    앞으로 붙는 것은 _island_lineFee_ 가 박스당으로 낸다 — 이 파일은
 *    «그 전에 붙은 것»만 따라잡는 자리다. 끝나면 지운다.
 *
 *  ★ 이카운트에 이미 올라간 줄은 기본으로 «안» 고친다 ★
 *    허브 「도서산간 판매갱신」이 찬 줄은 OUT00001 이 옛 금액으로 이미 올라갔다.
 *    여기서 업체 시트만 바꾸면 이카운트와 업체 시트가 서로 다른 돈을 말한다.
 *    목록에는 보여 주되 건드리지 않는다. 정말 고치려면 올린 쪽도 같이 고쳐야 한다.
 *
 *  돌리는 법 — 편집기 ▶ 실행에서 함수를 고른다
 *    ① partnerIslandRefeePreview   아무것도 안 바꾼다. 몇 줄이 어떻게 바뀌는지만 본다
 *    ② partnerIslandRefeeApply     ①에서 본 그대로 고친다 (허브 + 업체 시트)
 *
 *  편집기: https://script.google.com/home/projects/192tojXvo5GfhIJoHXo7UbmSMbNjpUjfx2nEUAz56kacKaQrDXoSMLC7i/edit
 * ══════════════════════════════════════════════════════════════
 */

/** 미리보기 — 아무것도 안 바꾼다 */
function partnerIslandRefeePreview() {
  var r = _irf_run_(false);
  _irf_tell_(r, false);
  return r.글;
}

/** 적용 — 허브와 업체 시트를 박스당 금액으로 맞춘다 */
function partnerIslandRefeeApply() {
  var r = _irf_run_(true);
  _irf_tell_(r, true);
  return r.글;
}

function _irf_tell_(r, 적용) {
  var 머리 = 적용 ? "🏝️ 도서산간비 박스당 적용" : "🏝️ 도서산간비 박스당 — 미리보기";
  Logger.log(머리 + "\n" + r.글);
  try { SpreadsheetApp.getUi().alert(머리, r.글, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

function _irf_num_(v) { return Number(String(v == null ? "" : v).replace(/[^0-9.-]/g, "")) || 0; }
function _irf_text_(v) { return String(v == null ? "" : v).trim(); }

/**
 * @param {boolean} 적용  false 면 읽기만 한다
 * @return {{글:string, 고칠것:Array, 올라간것:Array, 맞는것:number}}
 */
function _irf_run_(적용) {
  var out = { 글: "", 고칠것: [], 올라간것: [], 맞는것: 0, 업체적용: 0, 업체파일: 0 };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { out.글 = "다른 작업이 돌고 있습니다. 잠시 뒤 다시 해 주세요."; return out; }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
    if (!hubTab || hubTab.getLastRow() < 2) { out.글 = "허브가 비었습니다."; return out; }

    var lc = hubTab.getLastColumn();
    var hdr = hubTab.getRange(1, 1, 1, lc).getDisplayValues()[0];
    var feeCol = _island_findFeeCol1_(hdr);
    if (feeCol < 1) { out.글 = "허브에 「도서산간배송비」 칸이 없습니다 — 아직 판정을 한 번도 안 돌렸습니다."; return out; }

    //  「도서산간 판매갱신」 — 이카운트에 이미 올라간 줄을 가리는 칸
    var flagCol = 0;
    for (var i = 0; i < hdr.length; i++) {
      if (_irf_text_(hdr[i]).replace(/\s/g, "") === _PO_ISLAND_FLAG_HEADER_.replace(/\s/g, "")) { flagCol = i + 1; break; }
    }

    var lr = hubTab.getLastRow();
    var n = lr - 1;
    var data = hubTab.getRange(2, 1, n, Math.max(16, lc)).getValues();
    var feeVals = hubTab.getRange(2, feeCol, n, 1).getValues();
    var flagVals = flagCol ? hubTab.getRange(2, flagCol, n, 1).getValues() : null;

    var c = _isj_hubCols_(hdr);
    var 바꾼줄 = [];

    for (var r = 0; r < n; r++) {
      var 지금 = _irf_num_(feeVals[r][0]);
      if (지금 <= 0) continue;

      var 품목 = _irf_text_(data[r][c.item]);
      var 낱값 = _island_unitFee_(품목);
      var 박스 = _island_boxCount_(data[r][c.qty]);
      var 바른값 = 낱값 * 박스;
      if (지금 === 바른값) { out.맞는것++; continue; }

      var 한줄 = {
        행: r + 2,
        uid: _irf_text_(data[r][c.uid]),
        업체: _irf_text_(data[r][1]),
        받는분: _irf_text_(data[r][7]),
        품목: 품목,
        박스: 박스,
        지금: 지금,
        바른값: 바른값,
      };

      //  이카운트에 이미 올라간 줄 — 보여만 주고 안 건드린다
      if (flagVals && _irf_text_(flagVals[r][0])) { out.올라간것.push(한줄); continue; }

      out.고칠것.push(한줄);
      if (적용) { feeVals[r][0] = 바른값; 바꾼줄.push(한줄); }
    }

    if (적용 && 바꾼줄.length) {
      hubTab.getRange(2, feeCol, n, 1).setValues(feeVals);
      //  바뀐 금액을 업체 시트에도 같은 값으로 — 허브가 주인이다
      var feeByUid = {}, uidBoxMap = {}, 업체들 = {};
      for (var k = 0; k < 바꾼줄.length; k++) {
        var u = _island_uidKey_(바꾼줄[k].uid);
        if (!u) continue;
        feeByUid[u] = 바꾼줄[k].바른값;
        uidBoxMap[u] = true;
        if (바꾼줄[k].업체) 업체들[바꾼줄[k].업체] = true;
      }
      try {
        var pr = _irf_applyVendor_(uidBoxMap, Object.keys(업체들), feeByUid);
        out.업체적용 = pr.applied; out.업체파일 = pr.files;
      } catch (eV) {
        out.글 = "(업체 시트 적용 실패: " + (eV.message || eV) + ")\n";
      }
    }

    out.글 += _irf_report_(out, 적용);
    return out;
  } catch (e) {
    out.글 = "터졌습니다: " + (e && e.message ? e.message : e);
    return out;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 업체 시트 적용 — «이미 금액이 있어도» 덮어쓴다.
 * _island_applyToPartnerSheets_ 는 「이미 있으면 건너뛴다」라서 여기 쓸 수 없다.
 * 그 함수를 고치면 평소 길의 뜻이 바뀐다 — 다시 맞추는 일은 여기서만 한다.
 */
function _irf_applyVendor_(uidBoxMap, vendorNames, feeByUid) {
  var result = { applied: 0, files: 0 };
  var files = _pt_listFiles();
  if (!files || !files.length) return result;

  for (var f = 0; f < files.length; f++) {
    var ss, orderTab;
    try {
      ss = SpreadsheetApp.openById(files[f].id);
      orderTab = ss.getSheetByName("발주 및 송장조회");
    } catch (e) { continue; }
    if (!orderTab || orderTab.getLastRow() < 2) continue;

    var feeCol = _island_ensurePartnerFeeCol_(orderTab);
    if (typeof _ISLAND_HIDE_VENDOR_COL_ !== "undefined" && _ISLAND_HIDE_VENDOR_COL_) {
      try { orderTab.hideColumns(feeCol); } catch (eH) {}
    }
    var dataLr = _island_findLastDataRow_(orderTab, 3);
    if (dataLr < 2) continue;

    var readCols = Math.max(orderTab.getLastColumn(), feeCol, 15);
    var rows = dataLr - 1;
    var data = orderTab.getRange(2, 1, rows, readCols).getValues();
    var headers = orderTab.getRange(1, 1, 1, readCols).getDisplayValues()[0];
    var uidColIdx = _island_findUidCol0_(headers);
    if (uidColIdx < 0) uidColIdx = 12;

    var col = [], 바뀜 = 0;
    for (var r = 0; r < data.length; r++) {
      var cur = data[r][feeCol - 1];
      var uid = _island_uidKey_(data[r][uidColIdx]);
      if (uid && uidBoxMap[uid] && feeByUid[uid] != null && _irf_num_(cur) !== feeByUid[uid]) {
        col.push([feeByUid[uid]]); 바뀜++;
      } else {
        col.push([cur]);
      }
    }
    if (바뀜) {
      orderTab.getRange(2, feeCol, col.length, 1).setValues(col);
      result.applied += 바뀜;
      result.files++;
    }
  }
  return result;
}

function _irf_report_(out, 적용) {
  var L = [];
  L.push(적용 ? "고쳤습니다." : "아무것도 안 바꿨습니다 — 미리보기입니다.");
  L.push("");
  L.push("이미 맞는 줄        " + out.맞는것 + "개");
  L.push((적용 ? "고친 줄            " : "고칠 줄            ") + out.고칠것.length + "개");
  if (적용) L.push("업체 시트          " + out.업체적용 + "줄 · " + out.업체파일 + "곳");
  if (out.올라간것.length) {
    L.push("");
    L.push("★ 이카운트에 이미 올라간 줄 " + out.올라간것.length + "개 — 안 건드렸습니다 ★");
    L.push("   업체 시트만 바꾸면 이카운트와 서로 다른 돈을 말하게 됩니다.");
  }

  function 적기(제목, 목록) {
    if (!목록.length) return;
    L.push("");
    L.push("── " + 제목 + " ──");
    for (var i = 0; i < 목록.length && i < 25; i++) {
      var x = 목록[i];
      L.push("  " + x.행 + "행 · " + (x.업체 || "-") + " · " + (x.받는분 || "-") +
        " · " + x.품목.slice(0, 22) + " · " + x.박스 + "박스" +
        "   " + x.지금.toLocaleString() + " → " + x.바른값.toLocaleString());
    }
    if (목록.length > 25) L.push("  … 그 밖 " + (목록.length - 25) + "줄");
  }
  적기(적용 ? "고친 줄" : "고칠 줄", out.고칠것);
  적기("이카운트에 이미 올라감 (안 고침)", out.올라간것);

  if (!적용 && out.고칠것.length) {
    L.push("");
    L.push("맞으면 partnerIslandRefeeApply 를 돌리세요.");
  }
  return L.join("\n");
}
