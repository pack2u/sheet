/**
 * 로젠 재출력 가르기 — _pt_findRozenReprints_  (2026-10-16)
 *
 *  10/15 4차에 같은 주문 38건이 로젠에 두 번 등록(453-7639 → 453-7663).
 *  다음 날 배송조회로 47개 전부 «뒤» 번호만 집하됐다. 그 실물 모양으로 시험한다.
 *
 * 실행: node _reprint_test.js
 */
var fs = require("fs");
var path = require("path");
var src = fs.readFileSync(path.join(__dirname, "_partnerHelpers.gs"), "utf8");
function 꺼내(이름) {
  var i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 없음");
  var d = 0, s = src.indexOf("{", i);
  for (var k = s; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.substring(i, k + 1); } }
}
function 상수(이름) {
  var m = src.match(new RegExp("var " + 이름 + " = [^;]*;"));
  if (!m) throw new Error(이름 + " 없음");
  return m[0];
}
(0, eval)(상수("_PT_REPRINT_GAP_"));
(0, eval)(상수("_PT_REPRINT_MAX_SPAN_"));
(0, eval)("var _PT_ROZEN_FIXED_COL = { invoice: 10, uid: 9, date: 2 };");
(0, eval)(꺼내("_pt_reprintDateKey_"));
(0, eval)(꺼내("_pt_findRozenReprints_"));

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) { if (참) { 통과++; console.log("  ok   " + 이름); } else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); } }
/** 입력_로젠주문실적 한 줄: C 날짜 · J 주문번호 · K 운송장 */
function 줄(날, 주문, 송장) { var r = []; for (var i = 0; i < 12; i++) r.push(""); r[0] = 1; r[1] = "집하"; r[2] = 날; r[9] = 주문; r[10] = 송장; return r; }

console.log("\n[1] ★ 10/15 실물 — 몸통만 1개 줄이 두 번 등록 ★");
var rows = [
  줄("2026-10-15", "d1015000066", "453-7639-8653"),
  줄("2026-10-15", "d1015000066", "453-7663-7202"),
  줄("2026-10-15", "d1015000067", "453-7639-8620"),
  줄("2026-10-15", "d1015000067", "453-7663-7176"),
];
var r1 = _pt_findRozenReprints_(rows);
ok("두 주문 다 재출력", r1.voids.length === 2, JSON.stringify(r1));
var v66 = r1.voids.filter(function (v) { return v.key === "d1015000066"; })[0];
ok("앞 번호를 버린다", v66 && v66.drop.join() === "45376398653");
ok("뒤 번호를 남긴다", v66 && v66.keep.join() === "45376637202");

console.log("\n[2] 여러 상자는 재출력이 아니다 (한 출력 안 이웃 번호)");
var 상자 = [줄("2026-10-15", "d1015000070", "453-7639-8955"), 줄("2026-10-15", "d1015000070", "453-7639-8966"),
  줄("2026-10-15", "d1015000070", "453-7639-8970"), 줄("2026-10-15", "d1015000070", "453-7639-8981"), 줄("2026-10-15", "d1015000070", "453-7639-8992")];
var r2 = _pt_findRozenReprints_(상자);
ok("6칸도시락 5상자 — 아무것도 안 버림", r2.voids.length === 0 && r2.confirm.length === 0, JSON.stringify(r2));

console.log("\n[3] 여러 상자를 통째로 다시 뽑음 — 뒤 묶음만 남김");
var 통째 = [줄("2026-10-15", "2168394154", "453-7639-8524"), 줄("2026-10-15", "2168394154", "453-7639-8535"),
  줄("2026-10-15", "2168394154", "453-7663-7073"), 줄("2026-10-15", "2168394154", "453-7663-7084")];
var r3 = _pt_findRozenReprints_(통째);
ok("앞 2장 버림 · 뒤 2장 남김", r3.voids.length === 1 && r3.voids[0].drop.length === 2 && r3.voids[0].keep.length === 2, JSON.stringify(r3));

console.log("\n[4] 일부만 다시 뽑음 — 자동으로 안 버리고 확인으로");
var 일부 = [줄("2026-10-15", "2166312377", "453-0321-6954"), 줄("2026-10-15", "2166312377", "453-0321-6965"),
  줄("2026-10-15", "2166312377", "453-0321-6976"), 줄("2026-10-15", "2166312377", "453-1188-9560")];
var r4 = _pt_findRozenReprints_(일부);
ok("버리지 않음", r4.voids.length === 0, JSON.stringify(r4));
ok("확인 필요로 올림", r4.confirm.length === 1);

console.log("\n[5] 다른 날 같은 주문번호 = 재발송 — 건드리지 않음");
var 재발송 = [줄("2026-10-14", "d1014000085", "453-6746-0784"), 줄("2026-10-15", "d1014000085", "453-7663-9000")];
ok("날이 다르면 안 묶는다", _pt_findRozenReprints_(재발송).voids.length === 0);

console.log("\n[6] 세트 꼬리는 벗기지 않는다 — _S1 과 _S2 는 다른 상자");
var 세트 = [줄("2026-10-15", "2168393913_S1", "453-7639-8686"), 줄("2026-10-15", "2168393913_S2", "453-7663-7261")];
ok("S1·S2 를 한 주문으로 보지 않음", _pt_findRozenReprints_(세트).voids.length === 0);

console.log("\n[7] 날짜 칸이 Date 로 와도 같은 날로 본다");
var 날짜형 = [줄(new Date(2026, 9, 15), "d1015000064", "453-7639-8642"), 줄("2026-10-15", "d1015000064", "453-7663-7191")];
ok("Date · 글자 날짜 섞여도 묶임", _pt_findRozenReprints_(날짜형).voids.length === 1);

console.log("\n[7b] ★ 재발송은 재출력이 아니다 — 로젠 배송조회로 둘 다 배송완료 (10/16 실측) ★");
var 재발송실물 = [
  줄("2026-10-06", "p0928000026", "452-5995-2290"),   // 9/28 배송완료
  줄("2026-10-06", "p0928000026", "453-1189-2231"),   // 10/06 배송완료
  줄("2026-10-13", "2165338223", "452-6559-4931"), 줄("2026-10-13", "2165338223", "452-6559-4942"),   // 9/29
  줄("2026-10-13", "2165338223", "453-5619-3433"), 줄("2026-10-13", "2165338223", "453-5619-3444"),   // 10/14
];
var r7b = _pt_findRozenReprints_(재발송실물);
ok("9/28 → 10/06 재발송은 안 버림", r7b.voids.length === 0 && r7b.confirm.length === 0, JSON.stringify(r7b));
var 같은날늦게 = [줄("2026-10-07", "2166790707", "453-1749-1273"), 줄("2026-10-07", "2166790707", "453-2403-3123")];
ok("같은 날 65만 차이 재출력(앞 조회 안 됨·뒤 배송완료)은 잡음", _pt_findRozenReprints_(같은날늦게).voids.length === 1);

console.log("\n[8] ★ 울타리를 깨 본다 — 틈을 아주 크게 하면 재출력을 못 잡아야 한다 ★");
var 원래 = _PT_REPRINT_GAP_;
_PT_REPRINT_GAP_ = 1e12;
ok("틈 무한대면 10/15 실물도 0건 (시험이 틈 값을 실제로 쓴다)", _pt_findRozenReprints_(rows).voids.length === 0);
_PT_REPRINT_GAP_ = 원래;

console.log("\n[9] 일일마감 송장맵(_pep_addInvoiceMap_)이 폐기송장을 뺀다");
var pep = fs.readFileSync(path.join(__dirname, "_partnerExclusivePush.gs"), "utf8");
function 꺼내P(이름) {
  var i = pep.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 없음");
  var d = 0, s = pep.indexOf("{", i);
  for (var k = s; k < pep.length; k++) { if (pep[k] === "{") d++; else if (pep[k] === "}") { d--; if (!d) return pep.substring(i, k + 1); } }
}
["_pep_normInvoiceNo_", "_pep_splitInvNos_", "_pep_normalizeMatchUid_", "_pep_uidFromOrdererCell_", "_pep_isRealUid_", "_pep_addInvoiceMap_"]
  .forEach(function (n) { (0, eval)(꺼내P(n)); });
(0, eval)("var _PEP_MAP_REFUSED_ = 0; function _pep_ymdNum_() { return 0; }");
(0, eval)("function _pep_voidSet_() { return { '45376398653': true }; }");
var 맵 = {};
_pep_addInvoiceMap_(맵, "d1015000066", "453-7639-8653\n453-7663-7202", "로젠");
ok("앞 번호 빠지고 뒤 번호만", 맵["d1015000066"] && 맵["d1015000066"].inv === "45376637202", JSON.stringify(맵));
(0, eval)("function _pep_voidSet_() { return {}; }");
var 맵2 = {};
_pep_addInvoiceMap_(맵2, "d1015000066", "453-7639-8653\n453-7663-7202", "로젠");
ok("깨 보기: 폐기 목록이 비면 둘 다 들어간다", 맵2["d1015000066"] && 맵2["d1015000066"].inv.split("\n").length === 2);

console.log("");
console.log(실패 ?"★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
