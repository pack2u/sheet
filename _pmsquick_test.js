/**
 * 빠른 보정(_pms_quickRepairTab_) · 옛 모양 → 새 모양(_pms_migrateOldLayout_).  2026-10-05
 *
 *   > "빠르게 만들어줘"  — 맞는 탭은 쓰지 않는다.
 *   > "월 마감텝에서도 취소 반품 (Q,R열) 삭제해줘. O열 도서산간 배송비만 재대로 붙게해줘"
 *
 * 실행: node _pmsquick_test.js
 */
var fs = require("fs");
var path = require("path");
var src = fs.readFileSync(path.join(__dirname, "_partnerMonthlySettle.gs"), "utf8");
function 꺼내(이름) {
  var i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 못 찾음");
  var 깊이 = 0, 시작 = src.indexOf("{", i);
  for (var k = 시작; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (!깊이) return src.substring(i, k + 1); }
  }
  throw new Error(이름 + " 끝 못 찾음");
}
global._PMS_HEADER_ROW = 4;
global._PMS_DATA_START = 5;
global._PMS_OLD_EXT_ = ["취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"];
["_pms_quickRepairTab_", "_pms_expectedSummaryFormulas_", "_pms_normF_", "_pms_applyFormulas_", "_pms_summaryFormulas_",
 "_pms_isOurRowRule_", "_pms_removeRowRules_", "_pms_migrateOldLayout_",
 "_pms_archiveLayout_", "_pms_archiveLayoutFrom_", "_pms_newLayout_"].forEach(function (n) { eval.call(null, 꺼내(n)); });

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, JSON.stringify(얻은) === JSON.stringify(기대), "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

global._pms_buildColMap_ = function (h) {
  var m = { date: -1, price: -1, qty: -1 };
  h.forEach(function (x, i) { x = String(x); if (x === "일자" && m.date < 0) m.date = i; if (x === "수량" && m.qty < 0) m.qty = i; if (x.indexOf("정산금액") >= 0 && m.price < 0) m.price = i; });
  return m;
};
var 전부칠함 = 0, 보호함 = 0;
global._pms_layoutArchiveTab_ = function () { 전부칠함++; };
global._pms_applyProtection_ = function () { 보호함++; };
global.SpreadsheetApp = { ProtectionType: { RANGE: "R", SHEET: "S" }, flush: function () {} };

function 규칙(f) { return { getBooleanCondition: function () { return f == null ? null : { getCriteriaValues: function () { return [f]; } }; } }; }

/*  가짜 탭 — 표[행][열] (0부터). 쓰기를 센다. */
function 가짜탭(표, o) {
  o = o || {};
  var t = { 표: 표, 쓰기: [] };
  var 규칙들 = o.규칙들 || [];
  function 넓이() { return Math.max.apply(null, 표.map(function (r) { return r.length; })); }
  function 칸(r, c) { return 표[r - 1] && 표[r - 1][c - 1] !== undefined ? 표[r - 1][c - 1] : ""; }
  t.getMaxColumns = function () { return 넓이(); };
  t.getLastRow = function () { return 표.length; };
  t.getFrozenRows = function () { return o.고정 == null ? 4 : o.고정; };
  t.setFrozenRows = function () { t.쓰기.push("고정"); };
  t.insertColumnsAfter = function () { t.쓰기.push("열넣기"); };
  t.deleteColumns = function (c, n) { t.쓰기.push("열지움" + c + "+" + n); 표.forEach(function (r) { r.splice(c - 1, n); }); };
  t.getConditionalFormatRules = function () { return 규칙들; };
  t.setConditionalFormatRules = function (r) { t.쓰기.push("규칙" + r.length); 규칙들 = r; };
  t.getProtections = function (k) { return k === "R" ? new Array(o.보호 == null ? 1 : o.보호).fill({}) : []; };
  t.getRange = function (r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    var rg = {};
    function 읽(식) {
      var out = [];
      for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) { var v = 칸(r + i, c + j); row.push(식 ? (String(v).charAt(0) === "=" ? v : "") : (String(v).charAt(0) === "=" ? 0 : v)); } out.push(row); }
      return out;
    }
    rg.getValues = function () { return 읽(false); };
    rg.getFormulas = function () { return 읽(true); };
    rg.setValues = function (v) {
      t.쓰기.push("값@" + r + "," + c);
      for (var i = 0; i < v.length; i++) for (var j = 0; j < v[i].length; j++) {
        while (표.length < r + i) 표.push([]);
        while (표[r + i - 1].length < c + j) 표[r + i - 1].push("");
        표[r + i - 1][c + j - 1] = v[i][j];
      }
      return rg;
    };
    rg.setValue = function (v) { return rg.setValues([[v]]); };
    rg.setFormula = function (f) { return rg.setValues([[f]]); };
    rg.clearContent = function () {
      t.쓰기.push("지움@" + r);
      for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) if (표[r + i - 1] && 표[r + i - 1].length >= c + j) 표[r + i - 1][c + j - 1] = "";
      return rg;
    };
    ["setNumberFormat", "setFontWeight", "setFontSize", "setFontColor", "setBackground", "setBorder"].forEach(function (f) { rg[f] = function () { return rg; }; });
    return rg;
  };
  return t;
}

//  원본 5칸: A 일자 · B 수취인 · C 수량 · D 정산금액 · E 도서산간배송비
var 원본 = ["일자", "수취인", "수량", "정산금액", "도서산간배송비"];
var 새머리 = 원본.concat(["기타정산"]);
var 옛머리 = 원본.concat(["취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"]);
var L새 = _pms_archiveLayoutFrom_(새머리, [], 0, false);
var 기대식 = _pms_expectedSummaryFormulas_(L새.cMap, L새.islandC, L새.etcC, L새.extHdr);

function 새탭(o) {
  o = o || {};
  var 위1 = ["📊 월별 마감 요약"], 위2 = [], 위3 = [];
  Object.keys(기대식).forEach(function (k) {
    var rc = k.split(",");
    (rc[0] === "2" ? 위2 : 위3)[rc[1] - 1] = 기대식[k];
  });
  if (o.제목없음) 위1[0] = "";
  if (o.식) 위3[1] = o.식;
  var 머리 = 새머리.slice(); if (o.머리) 머리[3] = o.머리;
  var 표 = [위1, 위2, 위3, 머리, [20260901, "홍", 1, 10000, 5000, ""]];
  return 가짜탭(표, o);
}

console.log("\n[1] ★ 새 모양에 맞는 탭은 쓰지 않는다 ★");
var t0 = 새탭();
같나("고친 것 없음", _pms_quickRepairTab_(t0, L새), []);
같나("쓰기 0번", t0.쓰기, []);

console.log("\n[2] 틀린 것만");
var t1 = 새탭({ 머리: "정산금액(자동)" });
같나("머리글만", _pms_quickRepairTab_(t1, L새), ["머리글"]);
var t2 = 새탭({ 규칙들: [규칙('=INDIRECT("R[0]C6",FALSE)=TRUE'), 규칙('=INDIRECT("R[0]C7",FALSE)=TRUE'), 규칙("=$A5>100")] });
같나("옛 칠하기 규칙은 걷는다 (사장님 규칙은 남긴다)", [_pms_quickRepairTab_(t2, L새), t2.쓰기], [["취소·반품 칠하기 규칙 2개 걷음"], ["규칙1"]]);
var t3 = 새탭({ 식: "=IFERROR(D3+F2+H2+J2,0)" });
같나("요약 수식이 옛것이면 다시", _pms_quickRepairTab_(t3, L새), ["요약 수식"]);
var t4 = 새탭({ 고정: 0, 보호: 2 });
같나("고정·보호", _pms_quickRepairTab_(t4, L새), ["고정 행", "보호"]);
전부칠함 = 0;
var t5 = 새탭({ 제목없음: true });
같나("처음 꾸미는 탭은 전부 칠한다", [_pms_quickRepairTab_(t5, L새), 전부칠함], [["전체 레이아웃(처음 꾸밈)"], 1]);

console.log("\n[3] ★ 옛 모양 → 새 모양 ★");
function 옛탭(줄들) {
  return 가짜탭([["📊 월별 마감 요약"], [], [], 옛머리.slice()].concat(줄들));
}
//  원본5 + 취소·반품·사유·반품송장·반품배송비·도서산간(뒤)·기타정산
var 깨끗 = 옛탭([
  [20260901, "홍", 1, 10000, 5000, false, false, "", "", "", 5000, ""],
  [20260902, "김", 1, 20000, "", false, false, "", "", "", 10000, ""],   //  뒤쪽만 고친 도서산간
]);
var L옛 = _pms_archiveLayout_(깨끗, null);
ok("옛 모양을 알아본다", !!L옛.구형);
전부칠함 = 0;
var r깨끗 = _pms_quickRepairTab_(깨끗, L옛);
ok("새 모양으로 바꿨다고 말한다", /^새 모양으로 바꿈/.test(r깨끗[0]) && r깨끗[0].indexOf("도서산간 1줄 O열로 옮김") >= 0, r깨끗[0]);
같나("취소~뒤쪽 도서산간 6칸을 지웠다", 깨끗.쓰기.filter(function (w) { return w.indexOf("열지움") === 0; }), ["열지움6+6"]);
같나("4행 = 원본 + 기타정산", 깨끗.표[3], 새머리);
같나("뒤쪽만 고쳤던 도서산간 10,000 이 O(여기선 E)열로 옮겨졌다", 깨끗.표[5][4], 10000);
같나("전부 다시 칠했다", 전부칠함, 1);

var 기록 = 옛탭([
  [20260901, "홍", 1, 10000, 5000, true, false, "", "", "", 5000, ""],   //  취소 체크
]);
var r기록 = _pms_quickRepairTab_(기록, _pms_archiveLayout_(기록, null));
ok("취소·반품 기록이 있으면 그대로 둔다", /^⚠ 옛 모양 유지 — 취소·반품 기록 1줄/.test(r기록[0]), r기록[0]);
같나("  칸을 안 지웠다", 기록.쓰기.filter(function (w) { return w.indexOf("열지움") === 0; }), []);
var 반품비 = 옛탭([[20260901, "홍", 1, 10000, "", false, false, "", "", 3000, "", ""]]);
ok("반품배송비만 있어도 그대로 둔다", /^⚠ 옛 모양 유지/.test(_pms_quickRepairTab_(반품비, _pms_archiveLayout_(반품비, null))[0]));

console.log("\n[4] 원본에 도서산간 칸이 없는 옛 파일 — 뒤쪽 도서산간 칸은 남긴다");
var 섬없는옛 = 가짜탭([["📊 월별 마감 요약"], [], [],
  ["일자", "수취인", "수량", "정산금액", "취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"],
  [20260901, "홍", 1, 10000, false, false, "", "", "", 5000, ""]]);
_pms_quickRepairTab_(섬없는옛, _pms_archiveLayout_(섬없는옛, null));
같나("취소~반품배송비 5칸만 지웠다", 섬없는옛.쓰기.filter(function (w) { return w.indexOf("열지움") === 0; }), ["열지움5+5"]);
같나("4행 = 원본 + 도서산간배송비 + 기타정산", 섬없는옛.표[3], ["일자", "수취인", "수량", "정산금액", "도서산간배송비", "기타정산"]);
같나("도서산간 값은 그대로", 섬없는옛.표[4][4], 5000);

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
