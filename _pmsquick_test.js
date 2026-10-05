/**
 * 빠른 보정(_pms_quickRepairTab_) — 맞는 탭은 «쓰지 않고», 틀린 것만 고치는가.  2026-10-05
 *
 *   > "빠르게 만들어줘"  — 탭 하나에 1분 가까이 걸렸다(4분 30초에 4개 탭).
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
["_pms_quickRepairTab_", "_pms_expectedSummaryFormulas_", "_pms_normF_", "_pms_applyFormulas_",
 "_pms_rowRuleFormula_", "_pms_isOurRowRule_", "_pms_setRowRules_", "_pms_ensureCheckboxes_",
 "_pms_applyProtection_"].forEach(function (n) { eval.call(null, 꺼내(n)); });

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, 얻은 === 기대, "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

//  배치: A 일자 · B 수취인 · C 수량 · D 정산금액 + 확장 7칸 (E 취소 · F 반품 … K 기타정산)
var L = {
  cMap: { date: 0, qty: 2, price: 3 },
  extHdr: ["일자", "수취인", "수량", "정산금액", "취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"],
  extLc: 11, cancelC: 5, returnC: 6, reasonC: 7, retInvC: 8, shipFeeC: 9, islandFeeC: 10, etcFeeC: 11
};
var 기대식 = _pms_expectedSummaryFormulas_(L.cMap, L.cancelC, L.returnC, L.shipFeeC, L.islandFeeC, L.etcFeeC);

//  SpreadsheetApp 흉내 — 쓰기를 센다
var CBX = "CHECKBOX";
global.SpreadsheetApp = {
  DataValidationCriteria: { CHECKBOX: CBX },
  ProtectionType: { RANGE: "R", SHEET: "S" },
  newConditionalFormatRule: function () {
    var f = "";
    var b = {
      whenFormulaSatisfied: function (x) { f = x; return b; },
      setBackground: function () { return b; }, setRanges: function () { return b; },
      build: function () { return 규칙(f); }
    };
    return b;
  },
};
function 규칙(f) { return { getBooleanCondition: function () { return { getCriteriaValues: function () { return [f]; } }; } }; }

function 가짜탭(o) {
  var 쓰기 = [];
  var 위 = [["📊 월별 마감 요약"], [], [], L.extHdr.slice()];
  var 식 = [[], [], [], []];
  Object.keys(기대식).forEach(function (k) { var rc = k.split(","); 식[rc[0] - 1][rc[1] - 1] = 기대식[k]; });
  if (o.제목없음) 위[0][0] = "";
  if (o.머리) 위[3][3] = o.머리;
  if (o.식) 식[2][3] = o.식;
  var 규칙들 = o.규칙들 || [규칙(_pms_rowRuleFormula_(5)), 규칙(_pms_rowRuleFormula_(6))];
  var 체크 = o.체크없음 ? null : { getCriteriaType: function () { return CBX; } };
  var 보호 = o.보호 == null ? 1 : o.보호;
  var tab = {
    쓰기: 쓰기,
    getMaxColumns: function () { return 11; }, getMaxRows: function () { return 100; },
    getLastRow: function () { return 7; },
    getFrozenRows: function () { return o.고정 == null ? 4 : o.고정; },
    setFrozenRows: function () { 쓰기.push("고정"); },
    insertColumnsAfter: function () { 쓰기.push("열"); },
    getConditionalFormatRules: function () { return 규칙들; },
    setConditionalFormatRules: function (r) { 쓰기.push("규칙" + r.length); 규칙들 = r; },
    getProtections: function (t) {
      return t === "R" ? new Array(보호).fill({ remove: function () { 쓰기.push("보호풀기"); } }) : [];
    },
    getRange: function (r, c, nr, nc) {
      var rg = {
        getValues: function () {
          if (r === 1 && nr === 4) return 위.map(function (row) { var x = []; for (var i = 0; i < nc; i++) x.push(row[i] == null ? "" : row[i]); return x; });
          var out = []; for (var i = 0; i < (nr || 1); i++) out.push([false, false]); return out;
        },
        getFormulas: function () {
          return 식.map(function (row) { var x = []; for (var i = 0; i < nc; i++) x.push(row[i] == null ? "" : row[i]); return x; });
        },
        getDataValidations: function () { var out = []; for (var i = 0; i < nr; i++) out.push([체크, 체크]); return out; },
        setValues: function () { 쓰기.push("값@" + r); return rg; },
        insertCheckboxes: function () { 쓰기.push("체크박스"); return rg; },
        protect: function () { 쓰기.push("보호"); return { setDescription: function () { return { setWarningOnly: function () {} }; } }; },
      };
      ["setValue", "setFormula", "setNumberFormat", "setFontWeight", "setFontSize", "setFontColor", "setBackground", "setBorder"]
        .forEach(function (fn) { rg[fn] = function () { 쓰기.push(fn); return rg; }; });
      return rg;
    },
  };
  return tab;
}

console.log("\n[1] ★ 맞는 탭은 쓰지 않는다 ★");
var t0 = 가짜탭({});
var r0 = _pms_quickRepairTab_(t0, L);
같나("고친 것 없음", r0.length, 0);
같나("쓰기 0번", t0.쓰기.length, 0, t0.쓰기.join(","));

console.log("\n[2] 틀린 것만 고친다");
var t1 = 가짜탭({ 머리: "정산금액(자동)" });
같나("머리글만", _pms_quickRepairTab_(t1, L).join(","), "머리글");
같나("  4행 한 번 씀", t1.쓰기.join(","), "값@4");

var t2 = 가짜탭({ 규칙들: [규칙(_pms_rowRuleFormula_(5)), 규칙(_pms_rowRuleFormula_(6)), 규칙(_pms_rowRuleFormula_(5)), 규칙(_pms_rowRuleFormula_(6)), 규칙("=$A5>100")] });
같나("겹친 규칙", _pms_quickRepairTab_(t2, L).join(","), "칠하기 규칙 4→2");
같나("  사장님 규칙 1개 + 우리 2개 = 3개로", t2.쓰기.join(","), "규칙3");

var t3 = 가짜탭({ 규칙들: [규칙(_pms_rowRuleFormula_(17)), 규칙(_pms_rowRuleFormula_(18))] });
같나("규칙이 2개라도 옛 칸(Q·R)을 가리키면 고친다", _pms_quickRepairTab_(t3, L).join(","), "칠하기 규칙 2→2");

var t4 = 가짜탭({ 체크없음: true });
같나("빈 체크박스", _pms_quickRepairTab_(t4, L).join(","), "체크박스");

var t5 = 가짜탭({ 식: "=IFERROR(SUM(D5:D),0)" });
같나("요약 수식이 다르면 수식만 다시", _pms_quickRepairTab_(t5, L).join(","), "요약 수식");

var t6 = 가짜탭({ 고정: 0, 보호: 3 });
같나("고정·보호", _pms_quickRepairTab_(t6, L).join(","), "고정 행,보호");

console.log("\n[3] 처음 꾸미는 탭(1행 제목 없음)만 전부 칠한다");
var 전부 = 0;
global._pms_layoutArchiveTab_ = function () { 전부++; };
var t7 = 가짜탭({ 제목없음: true });
같나("전체 레이아웃", _pms_quickRepairTab_(t7, L).join(","), "전체 레이아웃(처음 꾸밈)");
같나("  _pms_layoutArchiveTab_ 를 부름", 전부, 1);

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
