/**
 * ══════════════════════════════════════════════════════════════
 *  단가 대조 — 상품정보 단가 ↔ 업체 거래명세서 단가
 *  파일: _partnerPriceCheck.gs        2026-10-18
 *
 *  > "우리 상품정보시트의 단가와 업체(거래명세서)의 단가들이 맞는지 전부 체크해주고
 *  >  상품정보시트의 양식대로 다른부분을 체크하고 다른 부분만 셀칼라를 노란색으로 채워지게 새로운 시트를 만들어줘"
 *
 *  ① v2 /api/statements/price-lines 가 «짝지은 명세서 줄»을 준다 (자동 대조와 같은 엔진, 이번 달 1일부터)
 *       대리공급 업체 → 우리 품목코드(E 이카운트코드)    창고 매입(콤콤·정희화학) → 이카운트 품목명(C)
 *  ② 상품정보 탭에서 그 품목을 찾아 개당매입별도가(U)와 견준다.
 *       명세서 단가가 «박스»인지 «낱개»인지는 수량으로 가린다:
 *         명세서 수량 = 우리 박스 수        → 박스 단가 → 개당 = 단가 ÷ 수량(N)
 *         명세서 수량 = 우리 박스 수 × N    → 낱개 단가
 *         창고 매입(콤콤·정희화학)          → 늘 낱개 단가
 *         어느 쪽도 아니면 U 에 더 가까운 쪽으로 보고 「단위?」라고 적는다
 *  ③ 「단가대조_MMDD」 탭 — 상품정보 머리글(1~4행)과 줄 모양을 그대로 쓰고, 오른쪽에 명세서 칸을 붙인다.
 *       다른 줄만 노랑: 상품정보의 U(개당매입별도가)·W(매입가) 칸과 명세서 개당·차이 칸.
 *
 *  ★ 상품정보는 «읽기만» 한다 ★  U·V 는 W 에서 나오는 수식이다(price-goes-in-purchase-price-not-unit-price).
 *    이 탭은 보고서다 — 단가를 바꾸지 않는다. 고칠지는 사람이 본다.
 *  ★ 부가세 ★  명세서 단가와 U 는 둘 다 «부가세 별도»다.
 * ══════════════════════════════════════════════════════════════
 */
var _PC_YELLOW_ = "#FDB813";      // 브랜드 노랑 — 다른 칸
var _PC_HEADER_ROWS_ = 4;         // 상품정보 머리글은 4행
var _PC_COL_NAME_ = 3;            // C 이카운트상품명 / 옵션명
var _PC_COL_CODE_ = 5;            // E 이카운트코드
var _PC_COL_VENDOR_ = 6;          // F 구매처
var _PC_COL_QTY_ = 14;            // N 수량 (한 박스 몇 개)
var _PC_COL_NET_ = 21;            // U 개당매입별도가 — 견주는 값
var _PC_COL_BUY_ = 23;            // W 매입가

function partnerBuildPriceCheckTab(fromYmd) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName("상품정보");
  if (!src) throw new Error("「상품정보」 탭이 없습니다");

  //  ① v2 에서 짝지은 줄
  var from = fromYmd || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-01");
  var res = UrlFetchApp.fetch(_psm_v2url_() + "/api/statements/price-lines?from=" + from, {
    method: "get", headers: { "x-ingest-token": _psm_token_() }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("v2 응답 " + res.getResponseCode());   // ★ 표는 싣지 않는다
  var data = JSON.parse(res.getContentText());
  var lines = data.lines || [];

  //  ② 상품정보 — 한 번에 읽는다 (서비스 호출을 루프에 넣지 않는다)
  var lastRow = src.getLastRow(), lastCol = src.getLastColumn();
  var vals = src.getRange(1, 1, lastRow, lastCol).getValues();
  var 코드행 = {}, 이름행 = {};
  var 낱 = function (s) { return String(s == null ? "" : s).replace(/\s/g, ""); };
  for (var r = _PC_HEADER_ROWS_; r < vals.length; r++) {
    var code = String(vals[r][_PC_COL_CODE_ - 1] || "").trim();
    var name = 낱(vals[r][_PC_COL_NAME_ - 1]);
    if (code && !(code in 코드행)) 코드행[code] = r;
    if (name && !(name in 이름행)) 이름행[name] = r;
  }

  //  품목 × 업체 × 개당단가 로 묶는다 — 같은 값이 여러 날 나오면 한 줄(최근 날·횟수)
  var 묶음 = {}, 순서 = [];
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    if (L.price == null || /택배|운반|배송비|운송|운임/.test(String(L.item))) continue;
    var row = -1;
    if (L.kind === "대리공급" && L.our_code && (L.our_code in 코드행)) row = 코드행[L.our_code];
    if (row < 0 && L.our_name) {
      var nn = 낱(String(L.our_name).replace(/---\s*(법인|개인).*$/, ""));
      if (nn in 이름행) row = 이름행[nn];
    }
    var N = row >= 0 ? Number(vals[row][_PC_COL_QTY_ - 1]) || 0 : 0;
    var U = row >= 0 ? Number(vals[row][_PC_COL_NET_ - 1]) : NaN;
    var p = Number(L.price), 단위 = "", 개당 = p;
    if (L.kind === "창고") { 단위 = "낱개"; 개당 = p; }
    else if (N > 1 && L.명세합 != null && L.our_qty != null && Number(L.명세합) === Number(L.our_qty)) { 단위 = "박스"; 개당 = p / N; }
    else if (N > 1 && L.명세합 != null && L.our_qty != null && Math.abs(Number(L.명세합) - Number(L.our_qty) * N) < 0.5) { 단위 = "낱개"; 개당 = p; }
    else if (N > 1 && !isNaN(U)) { 단위 = "단위?"; 개당 = Math.abs(p - U) <= Math.abs(p / N - U) ? p : p / N; }
    else { 단위 = N === 1 ? "낱개" : "단위?"; }
    개당 = Math.round(개당 * 100) / 100;
    var key = row + "|" + L.vendor_name + "|" + 개당;
    if (!(key in 묶음)) { 묶음[key] = { row: row, L: L, N: N, U: U, 단위: 단위, 개당: 개당, 날: L.date, 횟수: 0 }; 순서.push(key); }
    var b = 묶음[key]; b.횟수++;
    if (String(L.date) > String(b.날)) { b.날 = L.date; b.L = L; }
  }
  var 결과 = 순서.map(function (k) {
    var b = 묶음[k];
    var 허용 = isNaN(b.U) ? 0 : Math.max(0.1, Math.abs(b.U) * 0.005);
    b.차이 = isNaN(b.U) ? null : Math.round((b.개당 - b.U) * 100) / 100;
    b.다름 = b.row < 0 || isNaN(b.U) || Math.abs(b.개당 - b.U) > 허용;
    b.판정 = b.row < 0 ? "상품정보에 없음" : isNaN(b.U) ? "상품정보 단가 없음" : b.다름 ? "다름" : "같음";
    return b;
  });
  //  다른 것이 위로, 그 안에서는 업체·품목 차례
  결과.sort(function (a, c) {
    if (a.다름 !== c.다름) return a.다름 ? -1 : 1;
    if (a.L.vendor_name !== c.L.vendor_name) return a.L.vendor_name < c.L.vendor_name ? -1 : 1;
    return a.row - c.row;
  });

  //  ③ 새 탭 — 상품정보 머리글·열 너비·줄 모양을 그대로
  var 이름 = "단가대조_" + Utilities.formatDate(new Date(), "Asia/Seoul", "MMdd");
  var old = ss.getSheetByName(이름);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(이름);
  var 덧 = ["명세서 업체", "명세서 날짜(최근)", "명세서 품목명", "명세서 수량", "명세서 단가(별도)", "단위", "명세서 개당(별도)",
           "상품정보 개당매입별도가(U)", "차이(개당)", "나온 횟수", "판정", "짝지은 길"];
  var 전체열 = lastCol + 덧.length;
  if (sh.getMaxColumns() < 전체열) sh.insertColumnsAfter(sh.getMaxColumns(), 전체열 - sh.getMaxColumns());
  if (sh.getMaxRows() < 결과.length + _PC_HEADER_ROWS_ + 5) sh.insertRowsAfter(sh.getMaxRows(), 결과.length + _PC_HEADER_ROWS_ + 5 - sh.getMaxRows());
  src.getRange(1, 1, _PC_HEADER_ROWS_, lastCol).copyTo(sh.getRange(1, 1));
  for (var c = 1; c <= lastCol; c++) sh.setColumnWidth(c, src.getColumnWidth(c));
  sh.getRange(_PC_HEADER_ROWS_, lastCol + 1, 1, 덧.length).setValues([덧]).setFontWeight("bold").setBackground("#FFF2CC");
  sh.getRange(1, lastCol + 1).setValue("v2 명세서 " + data.from + " ~ " + data.to + " · 짝지은 줄 " + lines.length + " · 다름 " +
    결과.filter(function (b) { return b.다름; }).length + " / " + 결과.length);

  if (결과.length) {
    var out = [], bg = [];
    for (var k = 0; k < 결과.length; k++) {
      var b = 결과[k];
      var base = b.row >= 0 ? vals[b.row].slice() : new Array(lastCol).fill("");
      if (b.row < 0) { base[_PC_COL_CODE_ - 1] = b.L.our_code || ""; base[_PC_COL_NAME_ - 1] = b.L.our_name || ""; }
      out.push(base.concat([b.L.vendor_name, b.날, b.L.item, b.L.qty, b.L.price, b.단위, b.개당,
        isNaN(b.U) ? "" : b.U, b.차이 == null ? "" : b.차이, b.횟수, b.판정, b.L.how || b.L.kind]));
      var rowBg = new Array(전체열).fill(null);
      if (b.다름) {
        rowBg[_PC_COL_NET_ - 1] = _PC_YELLOW_;
        rowBg[_PC_COL_BUY_ - 1] = _PC_YELLOW_;
        rowBg[lastCol + 6] = _PC_YELLOW_;     // 명세서 개당
        rowBg[lastCol + 8] = _PC_YELLOW_;     // 차이
        rowBg[lastCol + 10] = _PC_YELLOW_;    // 판정
      }
      bg.push(rowBg);
    }
    var first = _PC_HEADER_ROWS_ + 1;
    //  줄 모양(숫자 꼴·글꼴)은 상품정보 첫 자료 줄을 본으로 한 번에 칠한다
    src.getRange(first, 1, 1, lastCol).copyTo(sh.getRange(first, 1, out.length, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(first, 1, out.length, 전체열).setValues(out);
    sh.getRange(first, 1, out.length, 전체열).setBackgrounds(bg);
  }
  sh.setFrozenRows(_PC_HEADER_ROWS_);
  ss.setActiveSheet(sh);
  var msg = "「" + 이름 + "」 탭을 만들었습니다.\n짝지은 명세서 줄 " + lines.length + " → 품목·업체·단가 " + 결과.length +
    "줄\n다른 것 " + 결과.filter(function (b) { return b.다름; }).length + "줄 (노란 칸)";
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}
