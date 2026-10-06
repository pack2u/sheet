/**
 * 발주 및 송장조회 D 품목명 · L 정산금액 — «줄마다 수식» + 입력 막기 해제.  2026-10-05
 *
 *   > "협력업체 시트의 발주 및 송장조회탭에 입력 막은거 삭제해줘.. 그거로 인해
 *   >  단가와 상품명이 사라지고 마감텝에 제대로 못넘어가는 경우가 생기는거 같아"
 *
 * 실행: node _orderdl_test.js
 */
var fs = require("fs");
var path = require("path");
function 읽기(f) { return fs.readFileSync(path.join(__dirname, f), "utf8"); }
var 도움 = 읽기("_partnerHelpers.gs"), 라이브 = 읽기("_partnerLibrary.gs"), 주문 = 읽기("_partnerOrders.gs");
function 꺼내(src, 이름) {
  var i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 못 찾음");
  var 깊이 = 0, 시작 = src.indexOf("{", i);
  for (var k = 시작; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (!깊이) return src.substring(i, k + 1); }
  }
}
global._PT_VIEWER_LOOKUP_END_ = 3700;
["_pt_orderRowFormulaD_", "_pt_orderRowFormulaL_", "_pt_rowFormulaPlan_"].forEach(function (n) { eval.call(null, 꺼내(도움, n)); });

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, JSON.stringify(얻은) === JSON.stringify(기대), "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

var sq = "'단가조회'";
var D = function (r) { return _pt_orderRowFormulaD_(sq, r); };

console.log("\n[1] 줄마다 수식 모양");
같나("D5 — 그 줄 C5 만 본다", _pt_orderRowFormulaD_(sq, 5),
  '=IF(C5="","",IFERROR(VLOOKUP(TRIM(CLEAN(SUBSTITUTE(C5,CHAR(160),""))),\'단가조회\'!$C$3:$G$3700,2,FALSE),"🚨코드오류"))');
ok("L — 5번째 칸(최종단가), 못 찾으면 빈칸", _pt_orderRowFormulaL_(sq, 7).indexOf(",5,FALSE),\"\"))") !== -1);

console.log("\n[2] ★ 옛 스필이 «멀쩡»할 때 — 펼친 값은 수식으로 바꾼다");
var p1 = _pt_rowFormulaPlan_([[""], [""], [""]], [["사과"], ["배"], [""]], true, false, D);
같나("셋 다 수식", p1.out.map(function (x) { return String(x[0]).slice(0, 6); }), ["=IF(C2", "=IF(C3", "=IF(C4"]);

console.log("\n[3] ★ 옛 스필이 «막혔을» 때 — 업체가 쓴 값은 남긴다 (여태는 지웠다)");
var p2 = _pt_rowFormulaPlan_([[""], [""], [""]], [["", ], ["업체가 쓴 품명"], [""]], true, true, D);
같나("쓴 값은 그대로, 나머지는 수식", [String(p2.out[0][0]).slice(0, 6), p2.out[1][0], String(p2.out[2][0]).slice(0, 6)],
  ["=IF(C2", "업체가 쓴 품명", "=IF(C4"]);

console.log("\n[4] 줄마다 수식이 된 뒤 — 몇 번을 불러도 같다");
var 지금 = [[D(2)], [""], ['=IF(C4="","",IFERROR(VLOOKUP(TRIM(CLEAN(SUBSTITUTE(C4,CHAR(160),""))),\'단가조회\'!$C$3:$G$3000,2,FALSE),"🚨코드오류"))'], ["=B5&\"세트\""], [""]];
var 값 = [["사과"], [12345], ["배"], ["감세트"], [""]];
var p3 = _pt_rowFormulaPlan_(지금, 값, false, false, D);
같나("우리 수식(최신)은 그대로", p3.out[0][0], D(2));
같나("업체가 쓴 값(숫자도)은 그대로", p3.out[1][0], 12345);
같나("우리 옛 수식(조회 끝 3000)은 최신으로", p3.out[2][0], D(4));
같나("남의 수식은 안 건드린다", p3.out[3][0], "=B5&\"세트\"");
같나("빈 칸은 수식", p3.out[4][0], D(6));
var p4 = _pt_rowFormulaPlan_([[D(2)], [D(3)]], [["사과"], [""]], false, false, D);
같나("다 맞으면 «안 바꿈»", p4.changed, false);

console.log("\n[5] ★ 막기를 뺐다 — 업체가 쓴 품명·단가를 지우는 길이 없다");
var 가드 = 꺼내(라이브, "p2u_partnerOnEdit");
ok("onEdit 가드가 D(4)·L(12)을 안 본다", !/\{ c: 4,/.test(가드) && !/\{ c: 12,/.test(가드));
var 열때 = 꺼내(라이브, "p2u_partnerOnOpen");
ok("시트 열 때 D/L 을 지우지 않는다 (옛 스필이면 줄마다 수식으로 바꿀 뿐)",
   열때.indexOf("getRange(2, 4, spillEndDL") === -1 && 열때.indexOf("_pt_ensureOrderRowFormulasDL_") !== -1);
var 수집전 = 꺼내(주문, "_po_refreshAutofillBeforeCollect_");
ok("수집 직전에 D/L 열을 지우지 않는다", 수집전.indexOf("tab.getRange(2, 4, _dEnd_ - 1, 1).clearContent()") === -1 &&
   수집전.indexOf("_pt_ensureOrderRowFormulasDL_") !== -1);
ok("수집 직전 빈칸 채우기가 줄마다 수식을 값으로 굳히지 않는다", 수집전.indexOf("fblock[i][3]") !== -1 && 수집전.indexOf("fblock[i][11]") !== -1);
var 주입 = 꺼내(도움, "_pt_injectOrderSpillFormulas");
ok("수식 주입이 D/L 을 지우고 스필을 다시 심지 않는다",
   주입.indexOf("_pt_buildOrderItemNameArrayFormula_") === -1 && 주입.indexOf("_pt_ensureOrderRowFormulasDL_") !== -1);
var 부름 = 도움.split("\n").filter(function (l) { return /_pt_build(OrderItemName|OrderUnitPrice)ArrayFormula_\(/.test(l) && l.indexOf("function ") === -1; });
ok("어디서도(heal 포함) D/L 스필을 다시 심지 않는다", 부름.length === 0, 부름.join(" | "));

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
