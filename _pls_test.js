/**
 * 달마다 따라 바뀌는 거래명세서(_partnerLiveStatement.gs) 시험.  2026-10-10
 *  수식이 «시트에서» 맞게 도는지는 진짜 시트(CSV 가져오기)로 따로 확인했다 —
 *  여기서는 탭을 그리는 순서·이름·칸 자리·건너뛰는 경우를 본다.
 * 실행: node _pls_test.js
 */
var fs = require("fs");
var path = require("path");
global._PMS_HEADER_ROW = 4;
global._PMS_DATA_START = 5;
global._PT = { PREFIX: "[협력업체] " };
global.Logger = { log: function () {} };
(0, eval)(fs.readFileSync(path.join(__dirname, "_partnerLiveStatement.gs"), "utf8"));

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}

/* ── 가짜 시트 ── */
function 가짜탭(이름, 머리) {
  var t = { 이름: 이름, 식: {}, 값: {}, 머리: 머리 || [], 지움: 0, 보호: null, 고정: 0 };
  t.getName = function () { return 이름; };
  t.getIndex = function () { return 3; };
  t.getMaxRows = function () { return 1000; };
  t.getMaxColumns = function () { return 26; };
  t.getLastColumn = function () { return t.머리.length; };
  t.getRange = function (r, c, nr, nc) {
    var rg = {};
    ["merge", "setFontSize", "setFontWeight", "setHorizontalAlignment", "setVerticalAlignment", "setFontColor",
     "setBackground", "setWrap", "setBorder", "setNumberFormat", "breakApart"].forEach(function (f) { rg[f] = function () { return rg; }; });
    rg.setValue = function (v) { t.값[r + "," + c] = v; return rg; };
    rg.setValues = function (v) { t.값[r + "," + c] = v; return rg; };
    rg.setFormula = function (f) { t.식[r + "," + c] = f; return rg; };
    rg.getFormula = function () { return t.식[r + "," + c] || ""; };
    rg.getValues = function () { return [t.머리.slice(0, nc)]; };
    return rg;
  };
  ["setRowHeight", "setColumnWidth", "setTabColor", "insertColumnsAfter", "setConditionalFormatRules"].forEach(function (f) { t[f] = function () {}; });
  t.deleteColumns = function () {};
  t.clear = function () { t.지움++; t.식 = {}; t.값 = {}; };
  t.getImages = function () { return []; };
  t.getProtections = function () { return []; };
  t.protect = function () { var p = { setDescription: function () { return p; }, setWarningOnly: function (w) { t.보호 = w; return p; } }; return p; };
  t.setFrozenRows = function (n) { t.고정 = n; };
  t.insertImage = function () { throw new Error("직인 없음"); };
  return t;
}
function 가짜파일(탭들) {
  var ss = { 탭들: 탭들, 넣은자리: null };
  ss.getSheetByName = function (n) { return 탭들[n] || null; };
  ss.insertSheet = function (n, i) { ss.넣은자리 = i; 탭들[n] = 가짜탭(n); return 탭들[n]; };
  ss.getName = function () { return "[협력업체] 올팩"; };
  ss.getId = function () { return "파일1"; };
  return ss;
}
global.SpreadsheetApp = {
  ProtectionType: { SHEET: "S" },
  newConditionalFormatRule: function () { var b = {}; ["whenFormulaSatisfied", "setBackground", "setRanges"].forEach(function (f) { b[f] = function () { return b; }; }); b.build = function () { return {}; }; return b; }
};
global.DriveApp = { getFileById: function () { throw new Error("없음"); } };

var 머리 = ["거래처명(자동)", "주문일자(자동)", "이카운트코드", "품목명(자동)", "수량", "수취인", "수취인전화번호", "수취인주소",
  "배송메시지", "적요", "송장번호", "정산금액", "고유ID(자동)", "상태(자동)", "도서산간배송비", "택배사", "기타정산"];
var 공급자 = { "등록번호": "585-88-00931", "상호(법인명)": "주식회사 팩투유", "입금계좌": "IBK", "VAT 기준": "포함" };

console.log("\n[1] 새로 만든다 — 마감 탭 바로 뒤, 수식은 마감 탭을 가리킨다");
var 마감 = 가짜탭("(2026년 10월) 발주 마감", 머리);
var f1 = 가짜파일({ "(2026년 10월) 발주 마감": 마감 });
var 말 = _pls_build_(f1, 2026, 10, 공급자, { name: "(주)올팩코리아", bizNo: "689-87-00032" });
var 명 = f1.탭들["(2026년 10월) 거래명세서"];
ok("만듦", 말 === "만듦", 말);
ok("마감 탭 바로 뒤에 넣는다", f1.넣은자리 === 3);
var 품목 = 명.식["15,1"] || "";
ok("품목 줄 수식이 15행 A칸", 품목.indexOf("=ARRAYFORMULA(") === 0);
ok("마감 탭의 L열(정산금액)을 본다", 품목.indexOf("'(2026년 10월) 발주 마감'!L5:L,") !== -1, 품목.slice(0, 120));
ok("코드 C · 품명 D · 수량 E · 도서산간 O · 기타정산 Q", ["!C5:C", "!D5:D", "!E5:E", "!O5:O", "!Q5:Q"].every(function (x) { return 품목.indexOf(x) !== -1; }));
ok("합계 = 공급가액 + 세액", 명.식["10,8"] === "=D10+F10");
ok("마감표와 견주는 칸", (명.식["11,8"] || "").indexOf("'(2026년 10월) 발주 마감'!$B$3") !== -1);
ok("공급받는자 상호", 명.값["5,7"] === "(주)올팩코리아");
ok("14행 고정 · 경고만 하는 보호", 명.고정 === 14 && 명.보호 === true);
ok("직인을 못 찍어도 멈추지 않는다", 말 === "만듦");

console.log("\n[2] ★ 마감 탭에 칸이 하나 끼워지면 — 이름으로 다시 골라 M열 ★");
var 밀린 = 머리.slice(0, 2).concat(["메모"]).concat(머리.slice(2));
var 식2 = _pls_itemsFormula_("'X'!", "포함", 밀린, "");
ok("정산금액 M · 코드 D", 식2.indexOf("'X'!M5:M,") !== -1 && 식2.indexOf("c,'X'!D5:D") !== -1, 식2.slice(0, 160));

console.log("\n[3] 건너뛴다");
var f3 = 가짜파일({});
ok("마감 탭이 없으면", _pls_build_(f3, 2026, 9, 공급자, {}).indexOf("건너뜀") === 0);
var 옛 = 가짜탭("(2026년 9월) 발주 마감", 머리.slice(0, 15).concat(["취소", "반품", "취소반품사유"]));
var f4 = 가짜파일({ "(2026년 9월) 발주 마감": 옛 });
var 말4 = _pls_build_(f4, 2026, 9, 공급자, {});
ok("옛 모양(취소·반품 칸)이면 안 만든다", 말4.indexOf("옛 모양") !== -1 && !f4.탭들["(2026년 9월) 거래명세서"], 말4);
var 금액없음 = 가짜탭("(2026년 8월) 발주 마감", ["일자", "품목명"]);
var f5 = 가짜파일({ "(2026년 8월) 발주 마감": 금액없음 });
ok("정산금액 칸이 없으면 안 만든다 (모르는 것을 0 으로 그리지 않는다)", _pls_build_(f5, 2026, 8, 공급자, {}).indexOf("정산금액") !== -1);

console.log("\n[4] 밤 마감 — 있으면 수식만 맞춘다");
global._pts_readIssuer_ = function () { return 공급자; };
global._pts_readVendors_ = function () { return [{ fileId: "파일1", name: "(주)올팩코리아" }]; };
_PLS_PARTIES_ = null;
var 지움전 = 명.지움;
ok("같으면 손대지 않는다", _pls_ensure_(f1, "(2026년 10월) 발주 마감") === "" && 명.지움 === 지움전);
명.식["15,1"] = "=옛수식";
ok("다르면 그 칸만 고친다", _pls_ensure_(f1, "(2026년 10월) 발주 마감") === "수식 고침" && 명.식["15,1"] === 품목 && 명.지움 === 지움전);
var f6 = 가짜파일({ "(2026년 10월) 발주 마감": 가짜탭("(2026년 10월) 발주 마감", 머리) });
ok("없으면 만든다", _pls_ensure_(f6, "(2026년 10월) 발주 마감") === "만듦" && !!f6.탭들["(2026년 10월) 거래명세서"]);
ok("다른 탭 이름이면 아무것도 안 한다", _pls_ensure_(f6, "발주 및 송장조회") === "");

console.log("\n[5] VAT 별도");
var 별 = _pls_itemsFormula_("", "별도", 머리, "");
ok("공급가액 = 금액, 세액 = 10%", 별.indexOf(",a,ROUND(a*0.1)),has>0)") !== -1, 별);
ok("별도면 마감표와 공급가액(D10)을 견준다", _pls_summaryFormulas_("", "별도")["11,8"].indexOf("ABS(D10-") !== -1);

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
