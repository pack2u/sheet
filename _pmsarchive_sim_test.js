/**
 * 마감 이동(_pms_processOneFile_)을 «통째로» 돌려 본다 — 새 마감탭 모양.  2026-10-05
 *
 *   > "월 마감텝에서도 취소 반품 (Q,R열) 삭제해줘. O열 도서산간 배송비만 재대로 붙게해줘"
 *   > "입력 막은거 삭제해줘.. 단가와 상품명이 사라지고 마감텝에 제대로 못넘어가는"
 *
 *   매일 밤 도는 함수라 이름·범위 실수 하나가 전 업체 마감을 멈춘다. 가짜 시트로 끝까지 돌린다.
 *   ① 새 달 탭      — 새 모양으로 만들고, 업체가 손으로 쓴 품명·단가가 그대로 넘어간다
 *   ② 새 모양 탭    — 그대로 이어 붙인다
 *   ③ 옛 모양(기록 없음) — 먼저 새 모양으로 바꾸고 붙인다
 *   ④ 옛 모양(취소 기록) — 바꾸지 않고 옛 모양대로 붙인다
 *
 * 실행: node _pmsarchive_sim_test.js
 */
var fs = require("fs");
var path = require("path");
function 읽기(f) { return fs.readFileSync(path.join(__dirname, f), "utf8"); }
var 도움 = 읽기("_partnerHelpers.gs");
function 꺼내(src, 이름) {
  var i = src.indexOf("function " + 이름 + "(");
  var 깊이 = 0, 시작 = src.indexOf("{", i);
  for (var k = 시작; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (!깊이) return src.substring(i, k + 1); }
  }
}

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, JSON.stringify(얻은) === JSON.stringify(기대), "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

/* ── 가짜 시트 ─────────────────────────────────────────── */
function 열번호(a1) { var m = a1.match(/^([A-Z]+)(\d+)$/); var n = 0; for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64); return [parseInt(m[2], 10), n]; }
function 가짜탭(이름, 표) {
  var t = { 이름: 이름, 표: 표, 체크: {}, 규칙: [], 보호: [] };
  function 칸(r, c) { return 표[r - 1] && 표[r - 1][c - 1] !== undefined ? 표[r - 1][c - 1] : ""; }
  t.getName = function () { return 이름; };
  t.getLastRow = function () { for (var i = 표.length - 1; i >= 0; i--) if (표[i].some(function (v) { return v !== "" && v != null; })) return i + 1; return 0; };
  t.getLastColumn = function () { var m = 0; 표.forEach(function (r) { for (var i = r.length - 1; i >= 0; i--) if (r[i] !== "" && r[i] != null) { m = Math.max(m, i + 1); break; } }); return m; };
  t.getMaxColumns = function () { return Math.max(1, Math.max.apply(null, 표.map(function (r) { return r.length; }).concat([0]))); };
  t.getMaxRows = function () { return Math.max(표.length, 50); };
  t.insertColumnsAfter = function (a, n) { 표.forEach(function (r) { while (r.length < a + n) r.push(""); }); };
  t.deleteColumns = function (c, n) { 표.forEach(function (r) { r.splice(c - 1, n); }); };
  ["setRowHeight", "setColumnWidth", "setFrozenRows", "setFrozenColumns"].forEach(function (f) { t[f] = function () {}; });
  t.getFrozenRows = function () { return 4; };
  t.getConditionalFormatRules = function () { return t.규칙; };
  t.setConditionalFormatRules = function (r) { t.규칙 = r; };
  t.getProtections = function () { return t.보호.map(function () { return { remove: function () { t.보호.pop(); } }; }); };
  t.getRange = function (r, c, nr, nc) {
    if (typeof r === "string") { var rc = 열번호(r); r = rc[0]; c = rc[1]; nr = 1; nc = 1; }
    nr = nr || 1; nc = nc || 1;
    var rg = {};
    function 읽(fn) { var o = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(fn(칸(r + i, c + j), r + i, c + j)); o.push(row); } return o; }
    rg.getValues = function () { return 읽(function (v) { return String(v).charAt(0) === "=" ? "" : v; }); };
    rg.getDisplayValues = function () { return 읽(function (v) { return v == null ? "" : String(v); }); };
    rg.getFormulas = function () { return 읽(function (v) { return String(v).charAt(0) === "=" ? v : ""; }); };
    rg.getFormula = function () { var v = 칸(r, c); return String(v).charAt(0) === "=" ? v : ""; };
    rg.getValue = function () { return 칸(r, c); };
    rg.getDisplayValue = function () { return String(칸(r, c)); };
    rg.setValues = function (v) {
      for (var i = 0; i < v.length; i++) { while (표.length < r + i) 표.push([]); var row = 표[r + i - 1]; for (var j = 0; j < v[i].length; j++) { while (row.length < c + j) row.push(""); row[c + j - 1] = v[i][j]; } }
      return rg;
    };
    rg.setValue = function (v) { return rg.setValues([[v]]); };
    rg.setFormula = function (f) { return rg.setValues([[f]]); };
    rg.clearContent = function () { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) if (표[r + i - 1] && 표[r + i - 1].length >= c + j) 표[r + i - 1][c + j - 1] = ""; return rg; };
    rg.insertCheckboxes = function () { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) t.체크[(r + i) + "," + (c + j)] = true; return rg; };
    rg.getDataValidations = function () { return 읽(function (v, rr, cc) { return t.체크[rr + "," + cc] ? { getCriteriaType: function () { return "CHECKBOX"; } } : null; }); };
    rg.protect = function () { t.보호.push(1); var p = { setDescription: function () { return p; }, setWarningOnly: function () { return p; } }; return p; };
    ["merge", "setBackground", "setFontColor", "setFontWeight", "setFontSize", "setHorizontalAlignment", "setVerticalAlignment",
     "setNumberFormat", "setBorder", "clearDataValidations"].forEach(function (f) { rg[f] = function () { return rg; }; });
    return rg;
  };
  return t;
}
function 가짜파일(탭들) {
  var ss = { 탭들: 탭들 };
  ss.getSheetByName = function (n) { return 탭들[n] || null; };
  ss.getSheets = function () { return Object.keys(탭들).map(function (k) { return 탭들[k]; }); };
  ss.insertSheet = function (n) { 탭들[n] = 가짜탭(n, []); return 탭들[n]; };
  ss.getName = function () { return "[협력업체] 시험"; };
  ss.getId = function () { return "파일1"; };
  return ss;
}

/* ── GAS 흉내 ─────────────────────────────────────────── */
global.Logger = { log: function () {} };
global.SpreadsheetApp = {
  flush: function () {}, ProtectionType: { RANGE: "R", SHEET: "S" },
  DataValidationCriteria: { CHECKBOX: "CHECKBOX" },
  newConditionalFormatRule: function () { var b = {}; ["whenFormulaSatisfied", "setBackground", "setRanges"].forEach(function (f) { b[f] = function () { return b; }; }); b.build = function () { return {}; }; return b; },
};
global.Utilities = { formatDate: function (d) { return "20261005"; } };
global._pt_findViewerSheet = function () { return null; };
global._pt_clearContentAndFormat_ = function (rg) { rg.clearContent(); };
global._pt_injectOrderSpillFormulas = function () {};
global._pt_clearSearchInputTab_ = function () {};
global._sb_syncPartnerSettle_ = function () {};
global._pt_setTabKey_ = function () {};
global._pt_findTabByKey_ = function () { return null; };
global._island_findLastDataRow_ = function (tab) { return tab.getLastRow(); };
(0, eval)(꺼내(도움, "_pt_buildOrderTabColumnMap"));
(0, eval)(읽기("_partnerMonthlySettle.gs"));

/* ── 발주 및 송장조회 (표준 15칸, O = 도서산간배송비) ───────────────── */
var 발주머리 = ["거래처명(자동)", "주문일자(자동)", "이카운트코드", "품목명(자동)", "수량", "수취인", "수취인전화번호",
  "수취인주소", "배송메시지", "적요", "송장번호", "정산금액(자동)", "고유ID(자동)", "상태(자동)", "도서산간배송비"];
function 주문(일자, 코드, 품명, 수량, 단가, uid, 섬) {
  return ["시험", 일자, 코드, 품명, 수량, "홍길동", "010", "서울", "", "", "123456789012", 단가, uid, "발송완료", 섬 || ""];
}
function 발주탭(줄들) { return 가짜탭("발주 및 송장조회", [발주머리.slice()].concat(줄들)); }

console.log("\n[1] ★ 새 달 탭 — 새 모양 · 업체가 손으로 쓴 품명·단가가 그대로 ★");
var f1 = 가짜파일({ "발주 및 송장조회": 발주탭([
  주문(20261001, "AB1", "업체가 손으로 쓴 품명", 2, 3000, "d1001000001", 5000),
  주문(20261002, "AB2", "보통 품명", 1, 10000, "d1002000001", ""),
]) });
var r1 = _pms_processOneFile_(f1, 20261005, {}, {});
같나("두 줄 마감", r1.archived, 2);
var 탭10 = f1.탭들["(2026년 10월) 발주 마감"];
ok("10월 탭이 생겼다", !!탭10);
같나("4행 = 발주 15칸 + 기타정산 (취소·반품 없음)", 탭10.표[3], 발주머리.slice(0, 11).concat(["정산금액", "고유ID(자동)", "상태(자동)", "도서산간배송비", "기타정산"]));
같나("손으로 쓴 품명이 그대로", 탭10.표[4][3], "업체가 손으로 쓴 품명");
같나("단가 × 수량 = 6,000", 탭10.표[4][11], 6000);
같나("도서산간은 O열에 5,000", 탭10.표[4][14], 5000);
같나("줄 길이 16칸 (뒤쪽 도서산간 칸 없음)", 탭10.표[4].length, 16);
같나("요약: F2 = 도서산간 O열 합", 탭10.표[1][5], "=IFERROR(SUM(O5:O),0)");
같나("요약: B3 최종 = D2+F2+H2", 탭10.표[2][1], "=IFERROR(D2+F2+H2,0)");
같나("체크박스를 안 넣는다", Object.keys(탭10.체크).length, 0);

console.log("\n[2] 새 모양 탭에 이어 붙인다");
var f2 = 가짜파일({ "발주 및 송장조회": 발주탭([주문(20261003, "AB3", "셋째", 1, 7000, "d1003000001", 5000)]),
                    "(2026년 10월) 발주 마감": 탭10 });
_pms_processOneFile_(f2, 20261005, {}, {});
같나("10월 탭에 셋째 줄", [탭10.표[6][3], 탭10.표[6][14], 탭10.표[6].length], ["셋째", 5000, 16]);
같나("4행은 그대로", 탭10.표[3][15], "기타정산");

console.log("\n[3] ★ 옛 모양(기록 없음) — 새 모양으로 바꾸고 붙인다 ★");
var 옛머리 = 발주머리.slice(0, 11).concat(["정산금액", "고유ID(자동)", "상태(자동)", "도서산간배송비",
  "취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"]);
var 옛줄 = 주문(20261001, "AB1", "옛 줄", 1, 9000, "d1001000009", 5000).concat([false, false, "", "", "", 8000, ""]);   //  뒤쪽만 8,000 으로 고쳐 둠
var 옛탭 = 가짜탭("(2026년 10월) 발주 마감", [["📊 월별 마감 요약"], [], [], 옛머리.slice(), 옛줄]);
var f3 = 가짜파일({ "발주 및 송장조회": 발주탭([주문(20261004, "AB4", "새 줄", 1, 1000, "d1004000001", "")]), "(2026년 10월) 발주 마감": 옛탭 });
_pms_processOneFile_(f3, 20261005, {}, {});
같나("4행이 새 모양이 됐다", 옛탭.표[3][15], "기타정산");
같나("옛 줄 — 뒤쪽에 고쳐 둔 도서산간 8,000 이 O열로", 옛탭.표[4][14], 8000);
같나("옛 줄 길이도 16칸", 옛탭.표[4].length, 16);
같나("새 줄이 새 모양으로 붙었다", [옛탭.표[5][3], 옛탭.표[5].length], ["새 줄", 16]);
같나("요약도 새 수식", 옛탭.표[2][1], "=IFERROR(D2+F2+H2,0)");

console.log("\n[4] ★ 옛 모양(취소 기록) — 안 바꾸고 옛 모양대로 붙인다 ★");
var 취소줄 = 주문(20261001, "AB1", "취소한 줄", 1, 9000, "d1001000010", "").concat([true, false, "고객변심", "", "", "", ""]);
var 기록탭 = 가짜탭("(2026년 10월) 발주 마감", [["📊 월별 마감 요약"], [], [], 옛머리.slice(), 취소줄]);
var f4 = 가짜파일({ "발주 및 송장조회": 발주탭([주문(20261004, "AB4", "새 줄", 1, 1000, "d1004000002", 5000)]), "(2026년 10월) 발주 마감": 기록탭 });
_pms_processOneFile_(f4, 20261005, {}, {});
같나("4행은 옛 모양 그대로", 기록탭.표[3][15], "취소");
같나("취소 기록 그대로", 기록탭.표[4][15], true);
같나("새 줄은 옛 모양대로 (22칸, 뒤쪽 도서산간에도 5,000)", [기록탭.표[5][3], 기록탭.표[5].length, 기록탭.표[5][20]], ["새 줄", 22, 5000]);
ok("새 줄 취소·반품 칸에 체크박스", 기록탭.체크["6,16"] && 기록탭.체크["6,17"]);

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
