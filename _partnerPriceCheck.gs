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

/*  ★ 2026-10-18 둘째 판 ★
    > "상품이 300개 안쪽인데.. 상품정보에는 3400가지 가 있는데"  > "둘 다 해줘 상품정보 3400개 전부 넣어줘"
    ① 상품정보 «전 품목»을 같은 차례·같은 꼴로 싣는다 (견줄 단가가 없으면 「비교 단가 없음」)
    ② 견주는 것 둘:  명세서(v2 에 쌓인 전부, 8/28~)  ·  업체 단가표(「10월인상단가」 탭의 인상단가 — 정희화학·콤콤)
       업체 시트의 「단가조회」 탭은 쓰지 않는다 — 우리 「전체 그룹 단가표」를 베낀 것이라 자기와 견주게 된다.
    ③ 노랑은 «다른 칸»에만. 상품정보에서 옮겨 온 U·W 칸의 옛 색(단가 인상 때 칠한 노랑 등)은 지우고 다시 칠한다 — 섞이면 못 읽는다. */
var _PC_FROM_ = "2026-08-01";      // 명세서를 볼 처음 — v2 명세서는 8/28 부터 있다
var _PC_RAISE_TAB_ = "10월인상단가";

function partnerBuildPriceCheckTab(fromYmd) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName("상품정보");
  if (!src) throw new Error("「상품정보」 탭이 없습니다");

  //  ① v2 에서 짝지은 명세서 줄
  var from = fromYmd || _PC_FROM_;
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
  var U_ = function (row) { var u = vals[row][_PC_COL_NET_ - 1]; return u === "" || u == null ? NaN : Number(u); };
  var 허용 = function (u) { return Math.max(0.1, Math.abs(u) * 0.005); };
  /*  판정 하나 — 같음 / 같음(부가세 포함 단가) / 다름 / 짝 확인
      로엔그린·태양은 단가를 부가세 포함으로 적는다(11,550 = 10.5 × 1.1 × 1000). 20% 넘게 다르면 대개 짝을 잘못 지었다. */
  var 판정 = function (개당, u) {
    if (isNaN(u)) return "상품정보 단가 없음";
    if (Math.abs(개당 - u) <= 허용(u)) return "같음";
    if (Math.abs(개당 - u * 1.1) <= 허용(u)) return "같음(부가세 포함 단가)";
    return u > 0 && Math.abs(개당 - u) / u > 0.2 ? "짝 확인" : "다름";
  };

  //  ③ 명세서 — 품목마다 «가장 최근» 단가, 다른 단가가 몇 가지 나왔는지
  var 명세 = {}, 없음 = [];
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    if (L.price == null || /택배|운반|배송비|운송|운임/.test(String(L.item))) continue;
    var row = -1;
    if (L.kind === "대리공급" && L.our_code && (L.our_code in 코드행)) row = 코드행[L.our_code];
    if (row < 0 && L.our_name) {
      var nn = 낱(String(L.our_name).replace(/---\s*(법인|개인).*$/, ""));
      if (nn in 이름행) row = 이름행[nn];
    }
    if (row < 0) { 없음.push(L); continue; }
    var N = Number(vals[row][_PC_COL_QTY_ - 1]) || 0, U = U_(row);
    var p = Number(L.price), 단위 = "", 개당 = p;
    if (L.kind === "창고") { 단위 = "낱개"; }
    else if (N > 1 && L.명세합 != null && L.our_qty != null && Number(L.명세합) === Number(L.our_qty)) { 단위 = "박스"; 개당 = p / N; }
    else if (N > 1 && L.명세합 != null && L.our_qty != null && Math.abs(Number(L.명세합) - Number(L.our_qty) * N) < 0.5) { 단위 = "낱개"; }
    else if (N > 1 && !isNaN(U)) { 단위 = "단위?"; 개당 = Math.abs(p - U) <= Math.abs(p / N - U) ? p : p / N; }
    else { 단위 = N === 1 ? "낱개" : "단위?"; }
    개당 = Math.round(개당 * 100) / 100;
    var m = 명세[row] || (명세[row] = { 날: "", L: null, 개당: null, 단위: "", 값들: {}, 횟수: 0 });
    m.횟수++; m.값들[개당] = true;
    if (String(L.date) >= m.날) { m.날 = String(L.date); m.L = L; m.개당 = 개당; m.단위 = 단위; }
  }

  //  ④ 업체 단가표 — 「10월인상단가」: 업체(2) 업체품명(3) 박스(4) 인상단가(6, 개당 별도) 우리코드(13)
  var 단가표 = {};
  var rt = ss.getSheetByName(_PC_RAISE_TAB_);
  if (rt && rt.getLastRow() > 1) {
    var rv = rt.getRange(2, 1, rt.getLastRow() - 1, 13).getValues();
    for (var j = 0; j < rv.length; j++) {
      var c = String(rv[j][12] || "").trim(), 인상 = Number(rv[j][5]);
      if (!c || !(c in 코드행) || !인상 || /^(미판매|미취급|안씀|안함)$/.test(c)) continue;
      단가표[코드행[c]] = { 업체: String(rv[j][1] || ""), 품명: String(rv[j][2] || ""), 개당: 인상 };
    }
  }

  //  ⑤ 새 탭 — 상품정보를 그대로 옮기고(값·꼴) 오른쪽에 견준 칸을 붙인다
  var 이름 = "단가대조_" + Utilities.formatDate(new Date(), "Asia/Seoul", "MMdd");
  var old = ss.getSheetByName(이름);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(이름);
  var 덧 = ["상품정보 개당매입별도가(U)",
    "명세서 업체", "명세서 날짜(최근)", "명세서 품목명", "명세서 단가(별도)", "단위", "명세서 개당(별도)", "명세서 차이", "명세서 판정", "명세서 나온 횟수 · 단가 가짓수",
    "단가표 업체", "단가표 품목명", "단가표 개당(인상단가)", "단가표 차이", "단가표 판정", "종합"];
  var 덧수 = 덧.length, 전체열 = lastCol + 덧수;
  var 아래 = 없음.length ? 없음.length + 2 : 0;
  if (sh.getMaxColumns() < 전체열) sh.insertColumnsAfter(sh.getMaxColumns(), 전체열 - sh.getMaxColumns());
  if (sh.getMaxRows() < lastRow + 아래 + 2) sh.insertRowsAfter(sh.getMaxRows(), lastRow + 아래 + 2 - sh.getMaxRows());
  var 원본 = src.getRange(1, 1, lastRow, lastCol);
  원본.copyTo(sh.getRange(1, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  원본.copyTo(sh.getRange(1, 1), SpreadsheetApp.CopyPasteType.PASTE_VALUES, false);
  for (var cc = 1; cc <= lastCol; cc++) sh.setColumnWidth(cc, src.getColumnWidth(cc));

  var 덧값 = [], 덧색 = [], U색 = [], W색 = [];
  var 셈 = { 같음: 0, 다름: 0, 짝: 0, 없음: 0 };
  for (var r2 = _PC_HEADER_ROWS_; r2 < lastRow; r2++) {
    var U2 = U_(r2), m2 = 명세[r2], t2 = 단가표[r2];
    var 명판 = m2 ? 판정(m2.개당, U2) : "", 표판 = t2 ? 판정(t2.개당, U2) : "";
    var 다른 = function (x) { return x === "다름" || x === "짝 확인"; };
    var 종합 = !m2 && !t2 ? "비교 단가 없음" : 다른(명판) || 다른(표판) ? (명판 === "짝 확인" || 표판 === "짝 확인" ? "짝 확인" : "다름") : "같음";
    if (종합 === "같음") 셈.같음++; else if (종합 === "다름") 셈.다름++; else if (종합 === "짝 확인") 셈.짝++; else 셈.없음++;
    var 값가짓수 = m2 ? Object.keys(m2.값들).length : 0;
    덧값.push([isNaN(U2) ? "" : U2,
      m2 ? m2.L.vendor_name : "", m2 ? m2.날 : "", m2 ? m2.L.item : "", m2 ? m2.L.price : "", m2 ? m2.단위 : "", m2 ? m2.개당 : "",
      m2 && !isNaN(U2) ? Math.round((m2.개당 - U2) * 100) / 100 : "", 명판, m2 ? m2.횟수 + "회 · " + 값가짓수 + "가지" : "",
      t2 ? t2.업체 : "", t2 ? t2.품명 : "", t2 ? t2.개당 : "", t2 && !isNaN(U2) ? Math.round((t2.개당 - U2) * 100) / 100 : "", 표판, 종합]);
    var Y = _PC_YELLOW_, 줄색 = new Array(덧수).fill(null);
    if (다른(명판)) { 줄색[0] = Y; 줄색[6] = Y; 줄색[7] = Y; 줄색[8] = Y; }
    if (다른(표판)) { 줄색[0] = Y; 줄색[12] = Y; 줄색[13] = Y; 줄색[14] = Y; }
    if (다른(명판) || 다른(표판)) 줄색[15] = Y;
    덧색.push(줄색);
    var 칠 = 다른(명판) || 다른(표판) ? Y : null;
    U색.push([칠]); W색.push([칠]);
  }
  var 첫 = _PC_HEADER_ROWS_ + 1, 줄수 = lastRow - _PC_HEADER_ROWS_;
  sh.getRange(_PC_HEADER_ROWS_, lastCol + 1, 1, 덧수).setValues([덧]).setFontWeight("bold").setBackground("#FFF2CC").setWrap(true);
  if (줄수 > 0) {
    sh.getRange(첫, lastCol + 1, 줄수, 덧수).setValues(덧값).setBackgrounds(덧색);
    //  상품정보에서 옮겨 온 U·W 칸의 옛 색은 지우고 «다른 줄»만 노랑
    sh.getRange(첫, _PC_COL_NET_, 줄수, 1).setBackgrounds(U색);
    sh.getRange(첫, _PC_COL_BUY_, 줄수, 1).setBackgrounds(W색);
  }
  //  상품정보에서 못 찾은 명세서 품목 — 맨 아래
  if (없음.length) {
    var 표머리 = lastRow + 2;
    sh.getRange(표머리, 1).setValue("상품정보에서 못 찾은 명세서 품목 " + 없음.length + "줄 (우리 코드·이름으로 상품정보 줄을 못 찾음)").setFontWeight("bold");
    var 없값 = 없음.map(function (L) {
      var a = new Array(전체열).fill("");
      a[_PC_COL_CODE_ - 1] = L.our_code || ""; a[_PC_COL_NAME_ - 1] = L.our_name || "";
      a[lastCol + 1] = L.vendor_name; a[lastCol + 2] = L.date; a[lastCol + 3] = L.item; a[lastCol + 4] = L.price;
      a[lastCol + 8] = "상품정보에 없음"; a[lastCol + 15] = "상품정보에 없음";
      return a;
    });
    sh.getRange(표머리 + 1, 1, 없값.length, 전체열).setValues(없값);
    sh.getRange(표머리 + 1, lastCol + 16, 없값.length, 1).setBackground(_PC_YELLOW_);
  }
  sh.getRange(1, lastCol + 1).setValue("명세서 " + data.from + " ~ " + data.to + " (짝지은 줄 " + lines.length + ") · 단가표: " + _PC_RAISE_TAB_ +
    " · 같음 " + 셈.같음 + " · 다름 " + 셈.다름 + " · 짝 확인 " + 셈.짝 + " · 비교 단가 없음 " + 셈.없음 + " · 상품정보에 없음 " + 없음.length);
  sh.setFrozenRows(_PC_HEADER_ROWS_);
  //  「종합」 칸으로 거를 수 있게
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(_PC_HEADER_ROWS_, 1, 줄수 + 1, 전체열).createFilter();
  ss.setActiveSheet(sh);
  var msg = "「" + 이름 + "」 탭을 만들었습니다. 상품정보 " + 줄수 + "줄 전부\n" +
    "같음 " + 셈.같음 + " · 다름 " + 셈.다름 + " · 짝 확인 " + 셈.짝 + " · 비교 단가 없음 " + 셈.없음 + "\n" +
    "상품정보에서 못 찾은 명세서 품목 " + 없음.length + "줄 (맨 아래)";
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}
