/**
 * 반품대장 고유ID = «원래 주문»의 고유ID — 다듬기 · 찾기 · 새 반품 흐름.
 * 2026-10-04
 *
 * ★ 이 시험이 지키려는 것 ★
 *   > "고유아이디로 주문, 송장, 반품유무등을 한번에 찾을수 있게 하려는거야"
 *
 *   하나의 번호로 셋을 다 찾으려면 «같은 번호»가 세 곳에 있어야 한다. 그래서
 *     ⑴ 번호를 다듬는 규칙이 허브·포털·CS 세 벌에서 같아야 하고
 *     ⑵ 지난 반품을 찾아 넣을 때 «틀린 번호»를 넣으면 안 되고
 *     ⑶ 새 반품은 r 번호를 짓지 않고 주문의 번호를 받아야 한다
 *   틀린 고유ID 는 빈칸보다 나쁘다 — 다른 주문을 가리키며 맞는 척한다.
 *
 * 실행: node CS_WebApp/_csorderuid_test.js  (어느 자리에서 불러도 된다)
 */
var fs = require("fs");
var path = require("path");
var 여기 = __dirname;
var 뿌리 = path.join(여기, "..");

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

var 본 = fs.readFileSync(path.join(여기, "csReturnOrderUid.gs"), "utf8");
var 주문검색 = fs.readFileSync(path.join(여기, "csOrderSearch.gs"), "utf8");
var 포털 = fs.readFileSync(path.join(뿌리, "Partner_WebApp", "prpLookup.gs"), "utf8");
var 허브 = fs.readFileSync(path.join(뿌리, "_partnerExclusivePush.gs"), "utf8");

eval(꺼내(본, "_cs_orderUid_"));
eval(꺼내(본, "_cs_rou_시험번호인가_"));
eval(꺼내(본, "_cs_rou_상품_"));
eval(꺼내(본, "_cs_rou_송장색인_"));
eval(꺼내(본, "_cs_rou_좁히기_"));
eval(꺼내(본, "_cs_rou_맞추기_"));
eval(꺼내(본, "_cs_rou_탭들_"));
eval(꺼내(본, "_cs_rou_옛탭들_"));
eval(꺼내(본, "_cs_rou_시험번호비우기_"));
eval(본.substring(본.indexOf("var _CS_ROU_FROM_ = "), 본.indexOf(";", 본.indexOf("var _CS_ROU_FROM_ = ")) + 1));
eval(꺼내(포털, "prpUidFromCell_"));
eval(꺼내(허브, "_pep_normalizeMatchUid_"));
eval(꺼내(허브, "_pep_uidFromOrdererCell_"));

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "\n         " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) {
  ok(이름, 얻은 === 기대, "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대));
}

console.log("\n[1] ★ 번호 다듬기 — 세 벌이 같은 번호를 내는가 ★");
/*  허브(_pep_uidFromOrdererCell_) · 포털(prpUidFromCell_) · CS(_cs_orderUid_).
    한 벌이라도 다르면 같은 주문이 대장과 원장에서 다른 번호가 되어
    「고유ID 로 한 번에 찾기」가 조용히 깨진다. */
[
  ["김미화/2157237902", "2157237902"],
  ["2157237902", "2157237902"],
  ["김미화/2157237902#2", "2157237902"],       // 같은 주문의 둘째 줄
  ["김미화/2157237902|ABC01", "2157237902"],   // 코드 꼬리 — 고유ID 가 아니다
  ["김미화/0922-ds-00047_S1", "0922-ds-00047"], // 세트 꼬리
  ["홍길동/d1002000047", "d1002000047"],
  ["  김미화 / 2157237902  ", "2157237902"],
  ["", ""],
].forEach(function (쌍) {
  var cs = _cs_orderUid_(쌍[0]);
  var pt = prpUidFromCell_(쌍[0]);
  var hb = _pep_uidFromOrdererCell_(쌍[0]);
  ok(JSON.stringify(쌍[0]) + " → " + JSON.stringify(쌍[1]),
     cs === 쌍[1] && pt === 쌍[1] && hb === 쌍[1],
     "CS " + JSON.stringify(cs) + " · 포털 " + JSON.stringify(pt) + " · 허브 " + JSON.stringify(hb));
});
/*  ★ CS 옛 함수의 함정 ★  _cs_orderNoFromName_ 는 「|」로도 잘라 코드를 준다.
    그래서 고유ID 에는 _cs_orderUid_ 를 따로 쓴다. 그 사실에 못을 박는다. */
eval(꺼내(주문검색, "_cs_orderNoFromName_"));
같나("옛 _cs_orderNoFromName_ 는 「|」 뒤 코드를 준다 — 그래서 안 쓴다",
     _cs_orderNoFromName_("김미화/2157237902|ABC01"), "ABC01");
/*  전각 빗금 「／」 — 포털과 CS 는 받는다. 허브는 「/」만 본다(그쪽 칸엔 안 온다). */
같나("전각 빗금도 가른다 (CS)", _cs_orderUid_("김미화／2157237902"), "2157237902");
같나("전각 빗금도 가른다 (포털)", prpUidFromCell_("김미화／2157237902"), "2157237902");

console.log("\n[2] 시험으로 들어간 반품 번호인가 — 이것만 덮는다");
같나("r1002000003 은 시험 번호", _cs_rou_시험번호인가_("r1002000003"), true);
같나("주문 번호는 아니다", _cs_rou_시험번호인가_("2157237902"), false);
같나("d 발주 번호도 아니다", _cs_rou_시험번호인가_("d1002000047"), false);
같나("자리수가 다르면 아니다", _cs_rou_시험번호인가_("r100200000"), false);

/*  ── 맞추기 시험용 — 주문 색인과 반품 줄 ── */
var 주문들 = [
  { orderNo: "안희훈/2157230001", invDigits: "259104693330", name: "안희훈", item: "IW 92파이 PET 중평리드 1000개" },
  //  합포장 — 한 송장에 주문 둘
  { orderNo: "최영/2157230002", invDigits: "45045672792", name: "최영", item: "HU KP도시락 1호 400개" },
  { orderNo: "최영/2157230003", invDigits: "45045672792", name: "최영", item: "HU KP도시락 뚜껑 400개" },
  //  합포장인데 상품도 같고 수취인도 같다 — 기계가 못 가른다
  { orderNo: "김가/2157230010", invDigits: "333344445555", name: "김가", item: "같은상품" },
  { orderNo: "김가/2157230011", invDigits: "333344445555", name: "김가", item: "같은상품" },
  //  한 칸에 송장이 둘
  { orderNo: "박/2157230020", invDigits: "111122223333 111122224444", name: "박", item: "두박스" },
];
var 색인 = _cs_rou_송장색인_(주문들);
function 반품(o) {
  return Object.assign({ 행: 2, uid: "", 송장들: [], 이름: "", 상품: "", 요약: "" }, o);
}

console.log("\n[3] ★ 송장으로 찾는다 ★");
var r1 = _cs_rou_맞추기_([반품({ 송장들: ["259104693330"], 이름: "안희훈",
  상품: _cs_rou_상품_("IW 92파이 PET 중평리드 1000개---법인/스마트스토어") })], 색인);
같나("송장 하나에 주문 하나 — 넣는다", (r1.채울것[0] || {}).uid, "2157230001");
같나("근거는 송장", (r1.채울것[0] || {}).근거, "송장");

console.log("\n[4] ★ 합포장 — 상품으로 좁힌다 ★");
var r2 = _cs_rou_맞추기_([반품({ 송장들: ["45045672792"], 이름: "최영",
  상품: _cs_rou_상품_("HU KP도시락 뚜껑 400개") })], 색인);
같나("반품된 상품의 주문을 고른다", (r2.채울것[0] || {}).uid, "2157230003");
같나("근거는 송장+상품", (r2.채울것[0] || {}).근거, "송장+상품");

console.log("\n[5] ★ 못 가르면 넣지 않는다 ★");
/*  같은 송장 · 같은 상품 · 같은 수취인 — 어느 주문인지 기계가 모른다.
    아무거나 넣으면 다른 주문을 가리키며 맞는 척한다. 비워 두고 알린다. */
var r3 = _cs_rou_맞추기_([반품({ 송장들: ["333344445555"], 이름: "김가", 상품: "같은상품" })], 색인);
같나("넣지 않는다", r3.채울것.length, 0);
같나("후보 여럿으로 알린다", r3.겹침.length, 1);
ok("후보 둘이 다 보인다", (r3.겹침[0] || { 후보: [] }).후보.length === 2,
   JSON.stringify(r3.겹침[0]));

console.log("\n[6] 못 찾음 · 송장 없음");
var r4 = _cs_rou_맞추기_([
  반품({ 행: 2, 송장들: ["999988887777"], 이름: "없는사람" }),
  반품({ 행: 3, 송장들: [], 이름: "안희훈", 상품: "IW 92파이 PET 중평리드 1000개" }),
], 색인);
같나("원장에 없는 송장 — 못 찾음", r4.못찾음.length, 1);
/*  ★ 송장 없이 이름·전화로 이어 붙이지 않는다 ★
    2026-09-16 에 통합조회를 버린 바로 그 까닭이다 — 이어 붙인 것이 틀렸다. */
같나("송장이 없으면 이름이 맞아도 넣지 않는다", r4.송장없음.length, 1);
같나("그래서 채울 것이 없다", r4.채울것.length, 0);

console.log("\n[7] 한 칸에 송장이 둘");
var r5 = _cs_rou_맞추기_([반품({ 송장들: ["111122224444"], 이름: "박", 상품: "두박스" })], 색인);
같나("둘째 송장으로도 찾는다", (r5.채울것[0] || {}).uid, "2157230020");

console.log("\n[8] ★ 사람이 적은 값은 안 건드린다 · 시험 번호만 덮는다 ★");
var r6 = _cs_rou_맞추기_([
  반품({ 행: 2, uid: "사람이적음", 송장들: ["259104693330"] }),
  반품({ 행: 3, uid: "r1001000001", 송장들: ["259104693330"], 이름: "안희훈" }),
  반품({ 행: 4, uid: "2157230001", 송장들: ["259104693330"] }),
], 색인);
같나("사람이 적은 값 · 이미 맞는 주문 번호 — 둘 다 그대로", r6.이미, 2);
같나("시험 번호만 바뀐다", r6.채울것.length, 1);
같나("  그 줄은 3행", (r6.채울것[0] || {}).행, 3);
같나("  덮은 시험 번호를 알린다", (r6.채울것[0] || {}).덮음, "r1001000001");

console.log("\n[9] ★ 새 반품 — r 번호를 짓지 않고 주문 번호를 받는다 ★");
/*  > "웹앱에서 주문송장조회를 통해 주문건을 확인하고 바로 반품대장기록을
    >  통해 흘러가는 시스템으로"
    기록 단추는 이미 orderNo 를 보낸다. 서버가 그걸 버리고 r 번호를 짓던 것을 고쳤다. */
var 기록함수 = 꺼내(주문검색, "submitReturnLedger");
ok("submitReturnLedger 가 r 번호를 짓지 않는다",
   기록함수.indexOf("_cs_returnUidNext_") === -1);
ok("주문송장조회에서 받은 orderNo 를 다듬어 적는다",
   기록함수.indexOf("_cs_orderUid_(data.orderNo)") !== -1);
ok("주문이 없으면 지어내지 않는다 (있을 때만 적는다)",
   /if \(주문uid\) row\[col\.uid\] = 주문uid;/.test(기록함수));

console.log("\n[10] 옛 r 번호 함수는 막혀 있다");
var 옛 = fs.readFileSync(path.join(여기, "csReturnUid.gs"), "utf8");
ok("csReturnUidFill 이 r 번호를 다시 넣지 못한다",
   옛.indexOf("_cs_returnUidNext_") === -1 && 옛.indexOf("setValues") === -1);

console.log("\n[11] ★ 10월부터만 — 이전 달은 안 건드린다 ★");
/*  > "10월부터 적용해주면되 이전꺼는 쉽지 않아"
    8·9월은 주문 원장에 그 송장이 거의 없어 대부분 못 찾았다. 시험 r 번호가
    남아 있어도 손대지 않는다 — 고르는 탭에 아예 들지 않게 한다. */
function 가짜대장(이름들) {
  return { getSheets: function () {
    return 이름들.map(function (n) { return { getName: function () { return n; } }; });
  } };
}
var 고른탭 = _cs_rou_탭들_(가짜대장(["202608", "202609", "202610", "202611", "요약", "202610(사본)", "2026100"]));
같나("202610 부터 지금 달까지만, 새것이 앞", 고른탭.join(","), "202611,202610");
ok("9월·8월 탭은 고르지 않는다", 고른탭.indexOf("202609") < 0 && 고른탭.indexOf("202608") < 0);
ok("달 이름이 아닌 탭은 고르지 않는다", 고른탭.every(function (n) { return /^[0-9]{6}$/.test(n); }));
같나("10월 탭이 없으면 빈 목록", _cs_rou_탭들_(가짜대장(["202609", "202608"])).length, 0);
ok("고정 목록(_CS_ROU_TABS_)이 남아 있지 않다", 본.indexOf("_CS_ROU_TABS_") === -1);

console.log("\n[12] ★ 10월 이전 시험 r 번호 지우기 — r 번호만 비운다 ★");
/*  > "8·9월 r번호 지워줘"
    같은 칸에 사람이 적은 주문 고유ID 가 섞여 있을 수 있다 — 그건 남아야 한다. */
같나("10월 이전 달 탭만, 새것이 앞",
   _cs_rou_옛탭들_(가짜대장(["202608", "202609", "202610", "202611", "요약"])).join(","), "202609,202608");
var 칸값 = [["r0918000001"], ["20250918-0000123"], [""], ["r1002000003"], ["r123"], ["메모 r0918000002"]];
var 쓴값 = null;
var 가짜탭 = {
  getLastRow: function () { return 2 + 칸값.length; },
  getRange: function (행, 열, 줄수, 칸수) {
    return { getValues: function () { return 칸값.map(function (r) { return r.slice(); }); },
             setValues: function (v) { 쓴값 = v; } };
  }
};
var 비운행 = _cs_rou_시험번호비우기_(가짜탭, { 머리행: 1, col: { uid: 2 } });
같나("r 번호 두 칸만 비운다 (3행·6행)", 비운행.join(","), "3,6");
같나("  사람이 적은 주문 고유ID 는 남는다", 쓴값 && 쓴값[1][0], "20250918-0000123");
같나("  r 꼴이지만 길이가 다른 값은 남는다", 쓴값 && 쓴값[4][0], "r123");
같나("  글 속에 섞인 r 번호는 남는다", 쓴값 && 쓴값[5][0], "메모 r0918000002");
쓴값 = null; 칸값 = [["20250918-0000123"], [""]];
_cs_rou_시험번호비우기_(가짜탭, { 머리행: 1, col: { uid: 2 } });
ok("지울 게 없으면 쓰지도 않는다", 쓴값 === null);

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건"
                 : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
