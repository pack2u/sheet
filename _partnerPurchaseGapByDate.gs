/**
 * ══════════════════════════════════════════════════════════════
 *  [구매입력] 이카운트에 안 들어간 것을 날짜별로 뽑는다
 *  파일: _partnerPurchaseGapByDate.gs
 *  2026-09-07
 *
 *  ★ 무엇을 「빠진 것」으로 보나 ★
 *    이카운트를 직접 읽을 수 없다(OpenAPI 구매 조회 경로가 이 계정에 없다.
 *    후보 8개가 전부 404 였다). 그래서 이렇게 잡는다.
 *
 *      들어가야 할 것 = 허브 「이카운트-구매입력변환」  (마감탭 전체 변환분)
 *      이미 넣은 것   = 「구매입력」 폴더의 구매입력_(YYYY-MM-DD) 파일들
 *      빠진 것        = 앞의 것에서 뒤의 것을 뺀 나머지
 *
 *    일자별 파일이 곧 「그날 이카운트에 붙여넣은 것」이다. 그게 실제와
 *    다를 수 있다는 한계는 있다 — 이카운트에서 직접 지우거나 고친 건은
 *    여기서 안 보인다. 그건 구매 조회 API 가 열려야 잡을 수 있다.
 *
 *  ★ 왜 변환을 다시 돌지 않나 ★
 *    마감탭 → 구매입력 변환은 이미 있고 6분 제한 때문에 이어달리기까지 한다.
 *    같은 일을 여기서 또 하면 규칙이 두 벌이 되어 언젠가 갈라진다.
 *    변환 결과 탭을 그대로 읽는다. 거래처코드 보정 같은 수정도 자동으로 따라온다.
 *
 *  ★ 쓰는 순서 ★
 *    ① 「🧾 전용마감 → 이카운트 구매입력 변환」 을 먼저 돌린다 (그 달 전체)
 *    ② 이 기능을 돌린다 → 「구매입력」 폴더에 구매입력_누락_(YYYY-MM-DD) 생성
 *    ③ 날짜별로 열어 이카운트에 붙여넣는다
 *
 *  ★ 파일 이름을 구매입력_누락_ 으로 둔 이유 ★
 *    일일 구매입력은 구매입력_( 로 시작한다. 누락분이 같은 이름이면
 *    일일 작업과 명세서 대조가 그걸 「이미 넣은 것」으로 오해한다.
 *    이름을 갈라 두면 서로 간섭하지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

var _PPG_OUT_PREFIX_ = "구매입력_누락_";
var _PPG_MAX_MS_ = 240000;

/** [메뉴] 날짜별 누락 구매입력 만들기 */
function partnerBuildMissingPurchaseByDate() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  var t0 = new Date().getTime();
  var L = ["═══ 구매입력 누락분 (날짜별) ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];

  try {
    var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);

    // ── ① 들어가야 할 것 ──
    var src = hub.getSheetByName(_EPX_OUT_TAB_);
    if (!src || src.getLastRow() < 2) {
      L.push("★ 「" + _EPX_OUT_TAB_ + "」 탭이 비어 있습니다.");
      L.push("  먼저 「🧾 전용마감 → 이카운트 구매입력 변환」 을 돌리세요.");
      return _ppg_show_(L, ui);
    }
    var want = src.getRange(2, 1, src.getLastRow() - 1, _EPX_HEADERS_.length)
      .getDisplayValues();

    var byDate = {};        // yyyymmdd → [row,…]
    var wantKeys = {};      // yyyymmdd → { key: true }
    var wantRows = 0, noDate = 0;
    for (var i = 0; i < want.length; i++) {
      var row = want[i];
      var d = _ppg_ymd_(row[0]);
      if (!d) { if (String(row[10] || row[11] || "").trim()) noDate++; continue; }
      if (!String(row[10] || "").trim() && !String(row[11] || "").trim()) continue;
      if (!byDate[d]) { byDate[d] = []; wantKeys[d] = {}; }
      byDate[d].push(row);
      wantRows++;
    }
    L.push("변환분 " + wantRows + "행 · 날짜 " + Object.keys(byDate).length + "일" +
      (noDate ? "  (일자 없음 " + noDate + "행 제외)" : ""));

    // ── ② 이미 넣은 것 ──
    var folder = _epd_purchaseFolder_(hub);
    var have = {};          // yyyymmdd → { key: true }
    var haveFiles = 0, haveRows = 0;
    var it = folder.getFiles();
    while (it.hasNext()) {
      if (new Date().getTime() - t0 > _PPG_MAX_MS_) {
        L.push("★ 시간 초과 — 읽은 파일까지만 반영됐습니다. 기간을 좁혀 다시 돌리세요.");
        break;
      }
      var f = it.next();
      var nm;
      try { nm = f.getName(); } catch (eN) { continue; }
      // 누락분 파일은 「이미 넣은 것」이 아니다. 세면 다음 번에 안 나온다.
      if (nm.indexOf(_PPG_OUT_PREFIX_) === 0) continue;
      if (nm.indexOf(_EPD_FILE_PREFIX_ + "(") !== 0) continue;

      var dm = nm.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!dm) continue;
      var fd = dm[1] + dm[2] + dm[3];
      if (!byDate[fd]) continue;   // 변환분에 없는 날은 볼 필요가 없다

      var ptab;
      try {
        var pss = SpreadsheetApp.openById(f.getId());
        ptab = pss.getSheetByName(_EPX_OUT_TAB_) || pss.getSheets()[0];
      } catch (eO) { L.push("  " + nm + " 열기 실패: " + eO.message); continue; }
      if (!ptab || ptab.getLastRow() < 2) continue;
      haveFiles++;

      var lc = Math.min(Math.max(ptab.getLastColumn(), 1), _EPX_HEADERS_.length);
      var pdata = ptab.getRange(2, 1, ptab.getLastRow() - 1, lc).getDisplayValues();
      if (!have[fd]) have[fd] = {};
      for (var p = 0; p < pdata.length; p++) {
        var k = _ppg_key_(pdata[p]);
        if (k) { have[fd][k] = true; haveRows++; }
      }
    }
    L.push("기존 일자별 파일 " + haveFiles + "개 · " + haveRows + "행");
    L.push("");

    // ── ③ 차집합 ──
    var dates = Object.keys(byDate).sort();
    var made = 0, missTotal = 0;
    var detail = [];
    for (var di = 0; di < dates.length; di++) {
      var d2 = dates[di];
      var miss = [];
      var seen = {};
      for (var r2 = 0; r2 < byDate[d2].length; r2++) {
        var rr = byDate[d2][r2];
        var kk = _ppg_key_(rr);
        if (!kk) continue;
        if (have[d2] && have[d2][kk]) continue;
        // 변환분 자체에 같은 줄이 두 번 있으면 한 번만 낸다
        if (seen[kk]) continue;
        seen[kk] = true;
        miss.push(rr);
      }
      if (!miss.length) continue;

      missTotal += miss.length;
      var made1 = _ppg_writeFile_(folder, d2, miss);
      if (made1) made++;
      detail.push("  " + _epd_dashed_(d2) + "  " + miss.length + "행" +
        (have[d2] ? "" : "  ← 그날 구매입력 파일이 아예 없습니다"));
    }

    if (!missTotal) {
      L.push("빠진 것이 없습니다. 변환분이 모두 일자별 파일에 있습니다.");
    } else {
      L.push("★ 빠진 것 " + missTotal + "행 · 파일 " + made + "개 생성");
      L.push("");
      for (var dd = 0; dd < Math.min(detail.length, 25); dd++) L.push(detail[dd]);
      if (detail.length > 25) L.push("  … 외 " + (detail.length - 25) + "일");
      L.push("");
      L.push("「구매입력」 폴더에 " + _PPG_OUT_PREFIX_ + "(날짜) 로 만들었습니다.");
      L.push("날짜별로 열어 이카운트에 붙여넣으세요.");
    }
    L.push("");
    L.push("※ 이카운트에서 직접 지우거나 고친 건은 여기서 안 보입니다.");
    L.push("   그건 구매 조회 API 가 열려야 잡을 수 있습니다.");
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _ppg_show_(L, ui);
}

// ───────────────────────────────────────────────────────────
//  보조
// ───────────────────────────────────────────────────────────

/** 일자 → yyyymmdd. 2026-09-07 · 2026/09/07 · 20260907 을 모두 받는다 */
function _ppg_ymd_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  var d = s.replace(/[^\d]/g, "");
  if (d.length === 8) return d;
  return "";
}

/**
 * 한 줄을 가리키는 열쇠.
 *
 * ★ 송장번호만으로는 안 된다 ★
 *   한 송장에 여러 품목이 실린다. 품목코드까지 넣어야 줄이 갈린다.
 *   그리고 송장이 아직 없는 줄(방문수령·택배비 집계)도 있어서
 *   금액·수량까지 넣어야 같은 품목 두 줄이 하나로 뭉치지 않는다.
 *
 * 순번(B)·적요(T)는 넣지 않는다. 변환을 다시 돌리면 순번이 바뀌고,
 * 적요는 사람이 고치기도 한다. 그걸 넣으면 멀쩡한 줄이 매번 「빠진 것」이 된다.
 */
function _ppg_key_(row) {
  var code = String(row[10] || "").trim();       // K 품목코드
  var name = String(row[11] || "").trim();       // L 품목명
  if (!code && !name) return "";
  var cust = String(row[2] || "").trim();        // C 거래처코드
  var qty = _ppg_num_(row[13]);                  // N 수량
  var amt = _ppg_num_(row[18]);                  // S 금액
  var inv = String(row[22] || "").replace(/[^\d]/g, ""); // W 송장번호
  return [cust, code || name, qty, amt, inv].join("|");
}

function _ppg_num_(v) {
  if (typeof v === "number" && !isNaN(v)) return v;
  var s = String(v == null ? "" : v).replace(/,/g, "").replace(/[^\d.\-]/g, "").trim();
  if (!s) return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** 하루치 누락분을 구매입력 양식 파일로 만든다 */
function _ppg_writeFile_(folder, ymd, rows) {
  var fileName = _PPG_OUT_PREFIX_ + "(" + _epd_dashed_(ymd) + ")";

  // 같은 이름이 있으면 지우지 않고 내용만 새로 쓴다.
  // 지웠다 만들면 링크가 끊기고, 열어 둔 사람이 있으면 사라진 것처럼 보인다.
  var target = null;
  var it = folder.getFilesByName(fileName);
  while (it.hasNext()) {
    var f = it.next();
    var trashed = false;
    try { trashed = f.isTrashed(); } catch (eT) {}
    if (!trashed) { target = SpreadsheetApp.openById(f.getId()); break; }
  }
  if (!target) {
    target = SpreadsheetApp.create(fileName);
    try { DriveApp.getFileById(target.getId()).moveTo(folder); } catch (eM) {}
  }

  var tab = target.getSheets()[0];
  if (tab.getName() !== _EPX_OUT_TAB_) tab.setName(_EPX_OUT_TAB_);
  tab.clear();

  tab.getRange(1, 1, 1, _EPX_HEADERS_.length)
    .setValues([_EPX_HEADERS_])
    .setBackground("#7a2222").setFontColor("#ffffff")
    .setFontWeight("bold").setHorizontalAlignment("center");

  // 앞자리 0 이 살아 있어야 하는 열을 값 넣기 전에 텍스트로 잠근다.
  // A 일자 · C 거래처코드 · K 품목코드 · W 송장번호 (_EPX_TEXT_COLS_)
  try {
    for (var t = 0; t < _EPX_TEXT_COLS_.length; t++) {
      tab.getRange(2, _EPX_TEXT_COLS_[t], rows.length, 1).setNumberFormat("@");
    }
    SpreadsheetApp.flush();   // 서식은 미뤄졌다가 try 밖에서 터진다
  } catch (eFmt) {
    Logger.log("[PPG] 텍스트 서식 실패: " + eFmt.message);
  }

  tab.getRange(2, 1, rows.length, _EPX_HEADERS_.length).setValues(rows);
  tab.setFrozenRows(1);
  return true;
}

function _ppg_show_(L, ui) {
  var text = L.join("\n");
  Logger.log(text);
  try {
    if (ui) ui.alert("구매입력 누락분", text, ui.ButtonSet.OK);
  } catch (e) {}
  return text;
}
