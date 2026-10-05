/**
 * 도서산간 추가배송비 v3 — 세트분리(뉴) 원장 연동 · 줄마다 5,000/세트 10,000 · 이카운트 OUT00001.
 * 2026-10-05
 *
 *   > "발주 수집때 제주도서산간을 인식해서 건당..5000원.. 세트상품일경우 10000원이 붙게"
 *   > "도서산간 코드는 OUT00001 … 수취인과 상품명, 주소등이 붙어 줘야되고"
 *   > "한글 세트만 적용 영문 set는 한박스로 나가는것들이야"
 *
 * 실행: node _islandfee_test.js
 */
var fs = require("fs");
var path = require("path");
function 읽기(f) { return fs.readFileSync(path.join(__dirname, f), "utf8"); }
var 섬 = 읽기("_partnerIslandShipping.gs");
var 판매 = 읽기("_partnerIslandSales.gs");
var 주문 = 읽기("_partnerOrders.gs");
var 웹 = 읽기("_partnerWebApp.gs");

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
function 상수(src, 이름) {
  var i = src.indexOf("var " + 이름 + " ");
  if (i < 0) throw new Error(이름 + " 상수 못 찾음");
  return src.substring(i, src.indexOf(";", i) + 1);
}
["_ISLAND_FEE_LINE_", "_ISLAND_FEE_SET_"].forEach(function (n) { eval.call(null, 상수(섬, n)); });
["_PO_ISLAND_ITEM_CODE_", "_PO_ISLAND_FLAG_HEADER_", "_PO_ISLAND_MEMO_MAX_"].forEach(function (n) { eval.call(null, 상수(판매, n)); });
["_island_normUid_", "_island_uidKey_", "_island_lineFee_", "_island_pickFromLedger_", "_island_findFeeCol1_", "_island_findItemCol0_"]
  .forEach(function (n) { eval.call(null, 꺼내(섬, n)); });
["_po_islandSaleLine_", "_po_islandCancelLike_"].forEach(function (n) { eval.call(null, 꺼내(판매, n)); });

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, 얻은 === 기대, "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

console.log("\n[1] 금액 — 줄마다 5,000 · 한글 「세트」만 10,000");
같나("보통 상품", _island_lineFee_("JH 실링 23195 화이트 (100*1팩) 100"), 5000);
같나("한글 세트", _island_lineFee_("BW 사출 195파이 특대 투명 300세트"), 10000);
같나("영문 SET 은 한 박스 — 5,000", _island_lineFee_("JH 신형 105파이 중 블랙 1000 SET"), 5000);
같나("소문자 set 도 5,000", _island_lineFee_("뚜껑 set"), 5000);
같나("빈 이름", _island_lineFee_(""), 5000);

console.log("\n[2] 고유ID 열쇠 — 허브·업체·원장이 같은 번호로 만난다");
같나("그대로", _island_uidKey_("0901-ds-4581"), "0901-ds-4581");
같나("수취인/고유ID", _island_uidKey_("조찬민 님/0901-ds-b6cb"), "0901-ds-b6cb");
같나("세트분리가 쪼갠 _S2", _island_uidKey_("d0930000044_S2"), "d0930000044");
같나("#2 · |코드", _island_uidKey_("2165247640#2"), "2165247640");
같나("|코드", _island_uidKey_("2165247640|JH001"), "2165247640");
같나("앞뒤 띄어쓰기", _island_uidKey_("  0902-ds-01fb "), "0902-ds-01fb");

console.log("\n[3] ★ 세트분리(뉴) 원장에서 «지금» 도서산간인 것만 ★");
var 머리 = ["고유ID", "경로", "도서권역"];
var 원장 = [
  ["0901-ds-aaaa", "로젠택배-도서산간", "제주"],
  ["d0930000044_S1", "로젠택배-도서산간", "도서"],
  ["d0930000044_S2", "로젠택배-도서산간", "도서"],
  ["0902-ds-bbbb", "로젠택배", ""],
  ["0903-ds-cccc", "로젠택배-도서산간", "도서"],
  ["0903-ds-cccc", "로젠택배", "도서"],                       //  사람이 「발송」 → 일반으로 뺐다
  ["0904-ds-dddd", "로젠택배", "산간"],                       //  산간은 일반 로젠이지만 추가운임
  ["0905-ds-eeee", "로젠택배-도서산간(위탁배송)", "제주"],
  ["0906-ds-ffff", "보류", ""],
  ["0906-ds-ffff", "로젠택배-도서산간", "도서"],              //  보류였다가 다음 회차에 섬으로
];
var 고름 = _island_pickFromLedger_(머리, 원장);
var 키 = Object.keys(고름).sort().join(",");
같나("고른 고유ID", 키, "0901-ds-aaaa,0904-ds-dddd,0905-ds-eeee,0906-ds-ffff,d0930000044");
ok("세트분리가 쪼갠 두 줄은 한 주문으로", !!고름["d0930000044"]);
ok("「발송」으로 일반 처리된 주문은 안 붙인다 (마지막 기록이 이긴다)", !고름["0903-ds-cccc"]);
ok("일반 로젠은 안 붙인다", !고름["0902-ds-bbbb"]);
같나("산간도 붙인다", (고름["0904-ds-dddd"] || {}).권역, "산간");
ok("위탁배송 도서산간도 붙인다", !!고름["0905-ds-eeee"]);
같나("머리글이 다르면 빈 결과", Object.keys(_island_pickFromLedger_(["번호", "길"], 원장)).length, 0);

console.log("\n[4] 열 찾기");
같나("도서산간배송비 열", _island_findFeeCol1_(["업체", "고유ID", "도서산간배송비", "도서산간 판매갱신"]), 3);
같나("표지 열(도서산간 판매갱신)을 금액 열로 착각하지 않는다", _island_findFeeCol1_(["도서산간 판매갱신", "도서산간배송비"]), 2);
같나("품목명 열 — 출력품목명은 아님", _island_findItemCol0_(["출력품목명", "이카운트코드", "품목명"]), 2);
같나("상품명도 품목명", _island_findItemCol0_(["상품명"]), 0);

console.log("\n[5] ★ 이카운트 판매입력 OUT00001 줄 ★");
//  허브 A~P: A 수집 · B 업체 · C 고유ID · D 일자 · E 코드 · F 품목명 · G 수량 · H 수취인 · I 전화 · J 주소 · K 메시지
var 허브줄 = ["", "그린우드", "0901-ds-aaaa", "20260901", "BWSC195C004", "BW 사출 195파이 특대 투명 300세트", 2,
  "홍길동", "1012345678", "제주특별자치도 제주시 연동 1", "문앞", 98000, "", "", "접수완료", ""];
var 줄 = _po_islandSaleLine_(허브줄, 10000, "C001", "20261005", 28);
같나("품목코드 OUT00001", 줄[15], "OUT00001");
같나("수량 1", 줄[17], 1);
같나("단가 = 도서산간비", 줄[18], 10000);
같나("공급가액 + 부가세 = 금액", 줄[20] + 줄[21], 10000);
같나("공급가액", 줄[20], 9091);
같나("거래처코드 · 출하창고 · 출고일자", 줄[2] + "/" + 줄[7] + "/" + 줄[0], "C001/100/20261005");
같나("적요 = 도서산간 · 수취인 · 상품명(코드) · 주소", 줄[23],
  "도서산간 · 홍길동 · BW 사출 195파이 특대 투명 300세트 (BWSC195C004) · 제주특별자치도 제주시 연동 1");
같나("주문자명 = 수취인/고유ID (본 주문과 같은 꼴)", 줄[24], "홍길동/0901-ds-aaaa");
같나("전화 앞 0 살림", 줄[25], "01012345678");
같나("배송지/메시지", 줄[26], "제주특별자치도 제주시 연동 1 / 문앞");
같나("생산전표 안 만듦", 줄[27], "N");
var 긴줄 = 허브줄.slice(); 긴줄[9] = new Array(300).join("가");
같나("적요는 200자까지", _po_islandSaleLine_(긴줄, 5000, "C001", "20261005", 28)[23].length, 200);
ok("취소·반품·불용은 안 올린다", _po_islandCancelLike_("취소완료") && _po_islandCancelLike_("반품") && !_po_islandCancelLike_("접수완료"));

console.log("\n[6] 흐름 — 어디에 붙었나");
var 재작성 = 꺼내(주문, "partnerRebuildSalesUploadSheetCore_");
ok("본 주문 바로 아래에 OUT00001", /hubPUpdates\.push\(r \+ 2\);[\s\S]{0,200}_islNeed_\(r\)[\s\S]{0,120}_po_islandSaleLine_\(row, islFeeNow, custCd/.test(재작성));
ok("본 주문이 이미 올라갔어도 늦게 붙은 도서산간은 올린다", /이미 판매갱신[\s\S]{0,40}|_islNeed_\(r\)[\s\S]{0,400}이미 판매갱신 업됨/.test(재작성) &&
   재작성.indexOf("islFeeLate") !== -1);
ok("올린 줄은 「도서산간 판매갱신」에 완료를 적는다 (두 번 안 올라가게)", 재작성.indexOf("islFlagVals[islUpdates[iu]][0] = _PO_ISLAND_FLAG_DONE_") !== -1);
var 수집 = 꺼내(주문, "_po_collectSilentCore_");
ok("발주 수집 때 도서산간을 먼저 붙이고 판매현황을 갱신한다",
   수집.indexOf("_trigger_islandShipping_()") !== -1 &&
   수집.indexOf("_trigger_islandShipping_()") < 수집.indexOf("partnerRebuildSalesUploadSheet(true)"));
ok("★ 판매현황 전에 «주소»로 먼저 본다 → 원장으로 받친다 → 판매현황 갱신",
   수집.indexOf("_island_judgeHubByAddress_()") !== -1 &&
   수집.indexOf("_island_judgeHubByAddress_()") < 수집.indexOf("_trigger_islandShipping_()") &&
   수집.indexOf("_trigger_islandShipping_()") < 수집.indexOf("partnerRebuildSalesUploadSheet(true)"));
ok("판정 열(도서산간판정)을 금액 열로 착각하지 않는다", _island_findFeeCol1_(["도서산간판정", "도서산간배송비"]) === 2);
var 트리거 = 꺼내(웹, "_trigger_islandShipping_");
ok("트리거는 허브 금액을 업체 시트에 그대로 넘긴다", 트리거.indexOf("hubResult.feeByUid") !== -1);
ok("예전 박스×수량×5,000 계산이 남아 있지 않다", 섬.indexOf("uidBoxMap[uid] * qty") === -1 && 섬.indexOf("* _ISLAND_FEE_PER_QTY") === -1);
ok("원천은 세트분리(뉴) 주문라인원장", 꺼내(섬, "_island_loadIslandUidBoxMap_").indexOf("_ISLAND_SS_ID_") !== -1);

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
