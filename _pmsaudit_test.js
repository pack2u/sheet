/**
 * 월별 마감 탭 점검(_partnerMonthlySettleAudit.gs) — 순수 부분 시험.  2026-10-05
 * ★ 새 모양: 취소·반품 칸 없음 · 도서산간은 원본 O열 · 최종 = 정산금액 + 도서산간 + 기타정산
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
global._PMS_HEADER_ROW = 4;
global._PMS_OLD_EXT_ = ["취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"];
["_pms_audit_headerDiff_", "_pms_audit_expectedFormulas_", "_pms_audit_normF_", "_pms_audit_recalc_",
 "_pms_audit_dateLike_", "_pms_audit_col_", "_pms_audit_a1_", "_pms_audit_fmt_"]
  .forEach(function (n) { eval.call(null, 꺼내(점검, n)); });
["_pms_applyFormulas_", "_pms_summaryFormulas_", "_pms_buildExtHeaders_", "_pms_newLayout_", "_pms_expectedSummaryFormulas_", "_pms_normF_"]
  .forEach(function (n) { eval.call(null, 꺼내(마감, n)); });

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, JSON.stringify(얻은) === JSON.stringify(기대), "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

//  원본: A 일자 · B 수취인 · C 수량 · D 정산금액 · E 도서산간배송비  → + F 기타정산
var 머리 = ["일자", "수취인", "수량", "정산금액", "도서산간배송비"];
var ext = _pms_buildExtHeaders_(머리, 5);
var c = { island: 5, etc: 6 };
var cMap = { date: 0, qty: 2, price: 3 };

console.log("\n[0] ★ 새 모양 — 취소·반품 칸이 없다 ★");
같나("원본 + 기타정산만", ext, ["일자", "수취인", "수량", "정산금액", "도서산간배송비", "기타정산"]);
같나("원본 꼬리에 옛 확장 칸이 남아 있어도 떼고 다시 만든다",
  _pms_buildExtHeaders_(머리.concat(["취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"]), 12), ext);
같나("원본에 도서산간이 없으면 뒤에 하나", _pms_buildExtHeaders_(["일자", "수량", "정산금액"], 3),
  ["일자", "수량", "정산금액", "도서산간배송비", "기타정산"]);

console.log("\n[1] 기대 수식 — 보정 코드에서 그대로 받아 적는다");
var 기대 = _pms_audit_expectedFormulas_(cMap, { island: c.island, etc: c.etc, hdr: ext });
//  ★ 2026-10-10 어느 칸인지는 머리글 이름으로 — 여기 머리글엔 코드·품명 칸이 없어 금액(D)만 센다
같나("B2 전체 건수 — 금액이 있는 줄", 기대["2,2"],
  '=IFERROR(ARRAYFORMULA(SUMPRODUCT(SIGN(ABS(IFERROR(VALUE(SUBSTITUTE(TO_TEXT(D5:D),",","")),0))))),0)');
같나("D2 정산금액 — 글자 금액도 숫자로", 기대["2,4"],
  '=IFERROR(ARRAYFORMULA(SUMPRODUCT(IFERROR(VALUE(SUBSTITUTE(TO_TEXT(D5:D),",","")),0))),0)');
ok("F2 도서산간 = E열", 기대["2,6"].indexOf("TO_TEXT(E5:E)") !== -1, 기대["2,6"]);
ok("H2 기타정산 = F열", 기대["2,8"].indexOf("TO_TEXT(F5:F)") !== -1, 기대["2,8"]);
var 기대2 = _pms_audit_expectedFormulas_(cMap, { island: 15, etc: 17,
  hdr: ["거래처명", "주문일자", "이카운트코드", "품목명(자동)", "수량", "", "", "", "", "", "송장번호", "정산금액", "고유ID", "상태", "도서산간배송비", "택배사", "기타정산"] });
ok("표준 모양 — 코드 C · 품명 D · 금액 L 을 이름으로 골라 센다",
  기대2["2,2"].indexOf("LEN(TO_TEXT(C5:C))+LEN(TO_TEXT(D5:D))+ABS(IFERROR(VALUE(SUBSTITUTE(TO_TEXT(L5:L)") !== -1, 기대2["2,2"]);
var 밀린머리 = ["거래처명", "주문일자", "새칸", "이카운트코드", "품목명(자동)", "수량", "", "", "", "", "", "송장번호", "정산금액", "고유ID", "상태", "도서산간배송비", "택배사", "기타정산"];
var 기대3 = _pms_audit_expectedFormulas_(cMap, { island: 16, etc: 18, hdr: 밀린머리 });
ok("★ 칸이 하나 밀리면 수식도 이름 따라 M열로", 기대3["2,4"].indexOf("TO_TEXT(M5:M)") !== -1 && 기대3["2,2"].indexOf("TO_TEXT(D5:D))+LEN(TO_TEXT(E5:E))") !== -1, 기대3["2,4"] + " / " + 기대3["2,2"]);
같나("B3 최종 = 정산금액 + 도서산간 + 기타정산", 기대["3,2"], "=IFERROR(D2+F2+H2,0)");
같나("요약 수식 5칸 (유효 건수·반품배송비 없음)", Object.keys(기대).length, 5);
ok("취소·반품을 보는 수식이 없다", Object.keys(기대).every(function (k) { return 기대[k].indexOf("TRUE") === -1; }));
같나("띄어쓰기·대소문자는 같은 수식", _pms_audit_normF_("=iferror( D2 + F2 ,0)"), _pms_audit_normF_("=IFERROR(D2+F2,0)"));

console.log("\n[2] 머리글 견주기");
같나("같으면 없음", _pms_audit_headerDiff_(ext.slice(), ext).length, 0);
var 밀린 = ext.slice(); 밀린[1] = "전화번호";
같나("다른 칸을 알려 준다", _pms_audit_headerDiff_(밀린, ext)[0], "B: 「전화번호」→「수취인」");
같나("뒤에 남은 칸도", _pms_audit_headerDiff_(ext.concat(["반품"]), ext)[0], "G: 뒤에 남은 「반품」");

console.log("\n[3] 다시 셈 — 수식과 같은 뜻");
function 줄(일자, 금액, 도서, 기타) { return [일자, "홍길동", 1, 금액, 도서 || "", 기타 || ""]; }
var rows = [
  줄(20260901, 10000),
  줄(20260902, 20000, 5000),
  줄("", "", 3000),                         //  일자 없는 줄: 건수엔 안 들고 SUM 칸은 든다
  줄(20260904, 40000, "", -1000),
];
var 셈 = _pms_audit_recalc_(rows, cMap, c);
같나("전체 건수 (일자 있는 줄)", 셈.전체건, 3);
같나("정산금액", 셈.전체금액, 70000);
같나("도서산간 (일자 없는 줄도 SUM 에 든다)", 셈.도서산간, 8000);
같나("기타정산", 셈.기타정산, -1000);
같나("최종 = 70000 + 8000 - 1000", 셈.최종, 77000);
같나("깨끗하면 경고 없음", 셈.경고.length, 0);

console.log("\n[4] ★ 수식이 맞아도 값이 틀리는 것 · 칸 밀림 ★");
var 나쁜 = [
  줄(20260901, "1,000원"),
  줄("홍길동", 2000),
  줄(20260904, "#REF!"),
];
//  ★ 2026-10-10 줄은 «코드·품명·금액 중 하나»로 센다 — 여기선 B칸(홍길동)을 품명 자리로 친다
var c품 = { island: c.island, etc: c.etc, name: 1 };
var 경고 = _pms_audit_recalc_(나쁜, cMap, c품).경고.join(" | ");
ok("금액 칸 글자(숫자로 못 읽는 것)를 잡는다", 경고.indexOf("금액 칸에 숫자로 못 읽는 글자 2줄") !== -1, 경고);
ok("일자 칸 밀림을 잡는다", /일자 칸에 날짜가 아닌 값 1줄 \(예: 6행 「홍길동」\)/.test(경고), 경고);
ok("오류값을 잡는다", /오류값 1칸 \(예: D7 #REF!\)/.test(경고), 경고);

console.log("\n[4b] ★ «금액을 넣었는데 최종이 안 바뀐다» — 합계에 안 들어가는 금액 ★");
var 안들어감 = [
  줄(20260901, 10000, "3,000원"),            //  도서산간 글자
  줄(20260902, 20000, "", "5000"),           //  기타정산 글자 숫자
  줄("", 7000),                              //  일자 없는 줄의 금액
];
var 셈3 = _pms_audit_recalc_(안들어감, cMap, c품);
var 경고3 = 셈3.경고.join(" | ");
ok("도서산간 「3,000원」은 숫자로 못 읽는다고 알린다", 경고3.indexOf("도서산간배송비 칸에 숫자로 못 읽는 글자 1칸 (예: E5 「3,000원」)") !== -1, 경고3);
ok("★ 기타정산 글자 「5000」은 이제 센다 (요약 수식과 같다)", 경고3.indexOf("기타정산 칸") === -1 && 셈3.기타정산 === 5000, 경고3 + " / " + 셈3.기타정산);
ok("★ 일자 없는 줄의 금액도 합계에 든다 — 일자 빠뜨렸나만 알린다",
  셈3.전체금액 === 37000 && 경고3.indexOf("일자가 없는 줄 1줄 (예: 7행) — 합계에는 들어갑니다") !== -1, 경고3 + " / " + 셈3.전체금액);
같나("★ 일자 없는 줄도 건수에", 셈3.전체건, 3);

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
