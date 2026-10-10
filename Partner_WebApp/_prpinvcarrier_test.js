/**
 * 송장 칸 가르기가 두 프로젝트에서 «같은가» — CS 웹앱 vs 협력업체 포털.
 *
 * ★ 왜 이 시험이 있나 ★  (2026-10-04)
 *   > "택배사 한 칸에 같이 적게 해줘"
 *
 *   10월 머리글이 「원송장번호 / 택배사」·「반품송장번호 / 택배사」다.
 *   두 프로젝트가 «같은 칸»을 읽는다. 가름이 갈라지면 한쪽은 번호만 보고
 *   다른 쪽은 「446651704219 / CJ대한통운」을 통째로 송장번호로 읽는다 —
 *   업체 화면의 배송조회가 조용히 안 되고, 숫자로 맞추는 쪽은 틀린 값을 쥔다.
 *
 *   GAS 프로젝트는 코드를 나눠 쓸 수 없어 복사했다. 그러면 반드시 갈라진다 —
 *   손으로 옮겨 적지 않고 두 파일에서 함수를 꺼내 «글자까지» 맞대 본다.
 *   주인은 CS_WebApp/csOrderSearch.gs 다.
 *
 * 실행: node Partner_WebApp/_prpinvcarrier_test.js
 */
var fs = require("fs");
var path = require("path");
var 뿌리 = path.join(__dirname, "..");
var 곳 = function (p) { return path.join(뿌리, p); };

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

/*  ★ 줄끝은 뜻이 아니다 ★  (2026-10-04)
    한쪽은 CRLF, 다른 쪽은 LF 로 저장될 수 있다. CR 을 벗기고 맞댄다 —
    안 그러면 모든 줄이 다르다고 나와 정작 «한쪽만 고친 것»이 묻힌다.  */
var 벗기 = function (s) { return s.split(String.fromCharCode(13)).join(""); };
var cs = 벗기(fs.readFileSync(곳("CS_WebApp/csOrderSearch.gs"), "utf8"));
var pt = 벗기(fs.readFileSync(곳("Partner_WebApp/prpLedger.gs"), "utf8"));

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "\n         " + 덧 : "")); }
}

/* ── ① 몸통이 글자까지 같은가 ───────────────────────── */
console.log("\n[1] ★ 두 벌이 글자까지 같은가 ★");
var 짝 = [
  ["_cs_splitLedgerInvoice_", "prpSplitLedgerInvoice_"],
  ["_cs_ledgerInvoiceCell_", "prpLedgerInvoiceCell_"],
  ["_cs_ledgerInvoiceReplaceNo_", "prpLedgerInvoiceReplaceNo_"]
];
짝.forEach(function (한쌍) {
  /*  이름만 바꿔 심었으므로, 이름을 되돌리면 글자가 똑같아야 한다.
      한 글자라도 다르면 누가 한쪽만 고친 것이다.  */
  var a = 꺼내(cs, 한쌍[0]);
  var b = 꺼내(pt, 한쌍[1])
    .split(한쌍[1]).join(한쌍[0])
    .split("_PRP_INV_CARRIER_SEP_").join("_CS_INV_CARRIER_SEP_")
    .split("prpSplitLedgerInvoice_").join("_cs_splitLedgerInvoice_")
    .split("prpLedgerInvoiceCell_").join("_cs_ledgerInvoiceCell_");
  ok(한쌍[0] + " ↔ " + 한쌍[1], a === b,
     a === b ? "" : "한쪽만 고쳤습니다 — 주인은 CS_WebApp/csOrderSearch.gs 입니다");
});

/* 칸 사이 기호도 같아야 한다 */
var csSep = (cs.match(/var _CS_INV_CARRIER_SEP_ = "([^"]*)";/) || [])[1];
var ptSep = (pt.match(/var _PRP_INV_CARRIER_SEP_ = "([^"]*)";/) || [])[1];
ok("칸 사이 기호가 같다 " + JSON.stringify(csSep), csSep === ptSep,
   "CS " + JSON.stringify(csSep) + " · 포털 " + JSON.stringify(ptSep));

/* ── ② 실제로 돌려서 같은 답을 내는가 ───────────────── */
console.log("\n[2] ★ 돌려 보아도 같은 답인가 ★");
var _CS_INV_CARRIER_SEP_ = csSep;
eval(꺼내(cs, "_cs_splitLedgerInvoice_"));
eval(꺼내(cs, "_cs_ledgerInvoiceCell_"));
var _PRP_INV_CARRIER_SEP_ = ptSep;
eval(꺼내(pt, "prpSplitLedgerInvoice_"));
eval(꺼내(pt, "prpLedgerInvoiceCell_"));

[
  "446651704219 / CJ대한통운",
  "4466-5170-4219 / 롯데",
  "446651704219",
  "446651704219 440812891733 / 한진",
  "/ CJ대한통운",
  "4466/5170/4219",
  "재출고/단순/오주문입력/오배송",
  ""
].forEach(function (cell) {
  var a = _cs_splitLedgerInvoice_(cell);
  var b = prpSplitLedgerInvoice_(cell);
  ok("가르기 " + JSON.stringify(cell),
     a.번호 === b.번호 && a.택배사 === b.택배사,
     "CS " + JSON.stringify(a) + " · 포털 " + JSON.stringify(b));
});

[["446651704219", "롯데"], ["", "CJ대한통운"], ["446651704219", ""]].forEach(function (쌍) {
  var a = _cs_ledgerInvoiceCell_(쌍[0], 쌍[1]);
  var b = prpLedgerInvoiceCell_(쌍[0], 쌍[1]);
  ok("합치기 " + JSON.stringify(쌍), a === b,
     "CS " + JSON.stringify(a) + " · 포털 " + JSON.stringify(b));
});

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건"
                 : "두 프로젝트가 같은 가름을 쓴다 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
