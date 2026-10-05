/**
 * 월별 마감 탭 점검(_partnerMonthlySettleAudit.gs) — 순수 부분 시험.  2026-10-05
 * 실행: node _pmsaudit_test.js
 */
var fs = require("fs");
var path = require("path");
var 점검 = fs.readFileSync(path.join(__dirname, "_partnerMonthlySettleAudit.gs"), "utf8");
var 마감 = fs.readFileSync(path.join(__dirname, "_partnerMonthlySettle.gs"), "utf8");

function 꺼내(src, 이름) {
  var i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 못 찾음");
  var 깊이 = 0, 시작 = src.indexOf("{", i);
  for (var k = 시작; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (!깊이) return src.substring(i, k + 1); }
  }
  throw new Error(이름 + " 끝 못 찾음");
}
global._PMS_DATA_START = 5;
["_pms_audit_headerDiff_", "_pms_audit_expectedFormulas_", "_pms_audit_normF_", "_pms_audit_recalc_",
 "_pms_audit_dateLike_", "_pms_audit_col_", "_pms_audit_a1_", "_pms_audit_fmt_"]
  .forEach(function (n) { eval.call(null, 꺼내(점검, n)); });
["_pms_applyFormulas_", "_pms_buildExtHeaders_", "_pms_expectedSummaryFormulas_", "_pms_normF_"].forEach(function (n) { eval.call(null, 꺼내(마감, n)); });

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, 얻은 === 기대, "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

//  발주 탭: A 일자 · B 수취인 · C 수량 · D 정산금액  → 확장 7칸 붙어 E..K
var 머리 = ["일자", "수취인", "수량", "정산금액"];
var ext = _pms_buildExtHeaders_(머리, 4);
var extLc = ext.length;   // 11
var c = { cancel: extLc - 6, ret: extLc - 5, ship: extLc - 2, island: extLc - 1, etc: extLc };
var cMap = { date: 0, qty: 2, price: 3 };

console.log("\n[1] 기대 수식 — 보정 코드에서 그대로 받아 적는다");
var 기대 = _pms_audit_expectedFormulas_(cMap, c);
같나("B2 전체 건수", 기대["2,2"], '=IFERROR(COUNTIF(A5:A,"<>0"),0)');
ok("D3 유효 정산금액은 취소(E)·반품(F)을 뺀다", /E5:E<>TRUE/.test(기대["3,4"]) && /F5:F<>TRUE/.test(기대["3,4"]), 기대["3,4"]);
같나("F3 최종 = D3+F2+H2+J2", 기대["3,6"], "=IFERROR(D3+F2+H2+J2,0)");
같나("요약 수식 8칸", Object.keys(기대).length, 8);
같나("띄어쓰기·대소문자는 같은 수식", _pms_audit_normF_("=iferror( D3 + F2 ,0)"), _pms_audit_normF_("=IFERROR(D3+F2,0)"));

console.log("\n[2] 머리글 견주기");
같나("같으면 없음", _pms_audit_headerDiff_(ext.slice(), ext).length, 0);
var 밀린 = ext.slice(); 밀린[1] = "전화번호";
같나("다른 칸을 알려 준다", _pms_audit_headerDiff_(밀린, ext)[0], "B: 「전화번호」→「수취인」");
같나("뒤에 남은 칸도", _pms_audit_headerDiff_(ext.concat(["반품"]), ext)[0], "L: 뒤에 남은 「반품」");

console.log("\n[3] 다시 셈 — 수식과 같은 뜻");
function 줄(일자, 금액, 취소, 반품, 반품비, 도서, 기타) {
  return [일자, "홍길동", 1, 금액, 취소, 반품, "", "", 반품비 || "", 도서 || "", 기타 || ""];
}
var rows = [
  줄(20260901, 10000, false, false),
  줄(20260902, 20000, true, false),
  줄(20260903, 30000, false, true, 3000),
  줄("", "", false, false, "", 5000),          //  일자 없는 줄: 건수엔 안 들고 SUM 칸은 든다
  줄(20260904, 40000, false, false, "", "", -1000),
];
var 셈 = _pms_audit_recalc_(rows, cMap, c);
같나("전체 건수 (일자 있는 줄)", 셈.전체건, 4);
같나("유효 건수 (취소·반품 뺌)", 셈.유효건, 2);
같나("전체 금액", 셈.전체금액, 100000);
같나("유효 금액", 셈.유효금액, 50000);
같나("반품배송비", 셈.반품배송비, 3000);
같나("도서산간 (일자 없는 줄도 SUM 에 든다)", 셈.도서산간, 5000);
같나("최종 = 50000+3000+5000-1000", 셈.최종, 57000);
같나("깨끗하면 경고 없음", 셈.경고.length, 0);

console.log("\n[4] ★ 수식이 맞아도 값이 틀리는 것 · 칸 밀림 ★");
var 나쁜 = [
  줄(20260901, "1,000원", false, false),     //  금액에 글자 → 시트 SUMPRODUCT 는 0
  줄("홍길동", 2000, false, false),          //  일자 칸에 이름 → 칸 밀림
  줄(20260903, 3000, "TRUE", false),         //  체크박스 아닌 글자
  줄(20260904, "#REF!", false, false),
];
var 셈2 = _pms_audit_recalc_(나쁜, cMap, c);
var 경고 = 셈2.경고.join(" | ");
ok("금액 칸 글자를 잡는다", /금액 칸에 글자 2줄/.test(경고), 경고);
ok("일자 칸 밀림을 잡는다", /일자 칸에 날짜가 아닌 값 1줄 \(예: 6행 「홍길동」\)/.test(경고), 경고);
ok("체크 아닌 값을 잡는다", /체크\(참\/거짓\)가 아닌 값 1줄/.test(경고), 경고);
ok("오류값을 잡는다", /오류값 1칸 \(예: D8 #REF!\)/.test(경고), 경고);

console.log("\n[5] 날짜 꼴 · 숫자 꼴");
ok("20260901", _pms_audit_dateLike_(20260901));
ok("시리얼 46266", _pms_audit_dateLike_(46266));
ok("「2026-09-01」", _pms_audit_dateLike_("2026-09-01"));
ok("「260901」", _pms_audit_dateLike_("260901"));
ok("이름은 아님", !_pms_audit_dateLike_("홍길동"));
ok("전화번호는 아님", !_pms_audit_dateLike_("010-1234-5678"));
같나("1234567 → 1,234,567", _pms_audit_fmt_(1234567), "1,234,567");
같나("-1000 → -1,000", _pms_audit_fmt_(-1000), "-1,000");
같나("AA 칸", _pms_audit_col_(27), "AA");

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
