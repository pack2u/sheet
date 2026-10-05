/**
 * 월별 마감 탭 레이아웃 보정 — 업체 고르기 · 시간 한도.  2026-10-05
 *
 *   > "모든 업체가 작동을 하는데 특정 업체만 선택해서 실행되게 해줘..
 *   >  시간초과로 제대로 작동이 안되"
 *
 * 실행: node _pmsrepair_test.js
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
["_pms_vendorLabel_", "_pms_vendorNo_", "_pms_vendorNames_", "_pms_parseVendorPick_",
 "_pms_repairTabsForFiles_", "_pms_repairMemoGet_", "_pms_repairMemoPut_", "_pms_repairMemoClear_", "_pms_parseMonthPick_", "_pms_monthMatches_", "_pms_monthLabel_", "_pms_archiveLayout_", "_pms_archiveLayoutFrom_", "_pms_isOurRowRule_", "_pms_newLayout_"].forEach(function (n) { eval.call(null, 꺼내(n)); });

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, 얻은 === 기대, "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

var files = [
  { id: "a", name: "[협력업체] 옹진물산" },
  { id: "b", name: "[협력업체] 대한포장" },
  { id: "c", name: "[협력업체] 한빛용기" },
  { id: "d", name: "[협력업체] 대한상사" },
];
function ids(list) { return list.map(function (f) { return f.id; }).join(","); }

console.log("\n[1] 업체 고르기");
같나("번호 하나", ids(_pms_parseVendorPick_("3", files)), "c");
같나("번호 여럿 (쉼표·띄어쓰기)", ids(_pms_parseVendorPick_("1, 3 4", files)), "a,c,d");
같나("이름 일부", ids(_pms_parseVendorPick_("옹진", files)), "a");
같나("이름 일부가 여럿에 맞으면 다", ids(_pms_parseVendorPick_("대한", files)), "b,d");
같나("번호와 이름 섞기 · 겹치면 한 번", ids(_pms_parseVendorPick_("2,대한포장", files)), "b");
같나("all", ids(_pms_parseVendorPick_("ALL", files)), "a,b,c,d");
같나("전체", ids(_pms_parseVendorPick_("전체", files)), "a,b,c,d");
같나("없는 번호는 버린다", ids(_pms_parseVendorPick_("0,9", files)), "");
같나("빈 입력은 아무것도 안 고른다 (전체가 아니다)", _pms_parseVendorPick_("  ", files).length, 0);
같나("목록 번호", _pms_vendorNo_(files, files[2]), 3);
같나("이름 줄이기", _pms_vendorNames_(files, 2), "옹진물산, 대한포장, … 외 2곳");

console.log("\n[2] ★ 시간 한도 — 6분에 끊기기 전에 스스로 멈추고 남은 업체를 알려 준다 ★");
global._PMS_ORDER_TAB = "발주";
global._PMS_HEADER_ROW = 4;
global._PMS_OLD_EXT_ = ["취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"];
var 캐시 = {};
global.CacheService = { getScriptCache: function () { return {
  get: function (k) { return 캐시[k] || null; },
  put: function (k, v) { 캐시[k] = v; },
  remove: function (k) { delete 캐시[k]; } }; } };
global._PMS_REPAIR_LIMIT_MS_ = 270000;
global._pms_buildColMap_ = function () { return {}; };
global._pms_buildExtHeaders_ = function () { return new Array(20); };
global._pms_ensureCheckboxes_ = function () {};
global._pms_applyProtection_ = function () {};
var 지금 = 0, 한탭에 = 0, 고친탭 = [];
global.Date = { now: function () { return 지금; } };
global._pms_layoutArchiveTab_ = function (sh) { 고친탭.push(sh.이름); 지금 += 한탭에; };
global._pms_quickRepairTab_ = function (sh) { 고친탭.push(sh.이름); 지금 += 한탭에; return ["시험"]; };
function 시트(이름) { return { 이름: 이름, getName: function () { return 이름; } }; }
var 탭들 = { a: ["발주", "(2026년 8월) 발주 마감", "(2026년 9월) 발주 마감", "메모"],
             b: ["발주", "(2026년 9월) 발주 마감"],
             c: ["(2026년 9월) 발주 마감"],                          // 발주 탭 없음
             d: ["발주", "(2026년 7월) 발주 마감", "(2026년 9월) 발주 마감"] };
global.SpreadsheetApp = {
  flush: function () {},
  openById: function (id) {
    var 이름들 = 탭들[id];
    return {
      getSheetByName: function (n) {
        return 이름들.indexOf(n) < 0 ? null : {
          getMaxColumns: function () { return 10; }, getLastColumn: function () { return 10; },
          getRange: function () { return { getValues: function () { return [[]]; } }; },
        };
      },
      getSheets: function () { return 이름들.map(function (n) { return 시트(id + ":" + n); }); },
    };
  },
};
// 시트 이름에 업체 머리를 붙였으니 탭 패턴 검사용으로 getName 은 원래 이름을 준다
SpreadsheetApp.openById = (function (orig) {
  return function (id) {
    var ss = orig(id);
    var g = ss.getSheets;
    ss.getSheets = function () { return g().map(function (s) { var n = s.이름.slice(2); return { 이름: s.이름, getName: function () { return n; }, getMaxColumns: function () { return 3; },
      getRange: function () { return { getValues: function () { return [["일자", "취소", "반품"]]; } }; } }; }); };
    return ss;
  };
})(SpreadsheetApp.openById);

지금 = 0; 한탭에 = 1000; 고친탭 = [];
var r1 = _pms_repairTabsForFiles_(files, 0);
같나("시간 넉넉하면 마감 탭만 다 고친다", 고친탭.join("|"),
   "a:(2026년 8월) 발주 마감|a:(2026년 9월) 발주 마감|b:(2026년 9월) 발주 마감|c:(2026년 9월) 발주 마감|d:(2026년 7월) 발주 마감|d:(2026년 9월) 발주 마감");
같나("  고친 탭 수", r1.fixed, 6);
같나("  남은 업체 없음", r1.left.length, 0);
ok("  발주 탭이 없어도 마감 탭 제 배치(4행)로 고친다", r1.done.join("|").indexOf("한빛용기 — 1개 탭") >= 0, r1.done.join("|"));

지금 = 0; 한탭에 = 100000; 고친탭 = [];
var r2 = _pms_repairTabsForFiles_(files, 0);
//  0 → a 8월(100s) → a 9월(200s) → b 9월(300s) → 한도 넘음
같나("한도를 넘으면 멈춘다 — 고친 탭", r2.fixed, 3);
같나("  남은 업체는 한빛용기·대한상사", ids(r2.left), "c,d");

지금 = 0; 한탭에 = 200000; 고친탭 = [];
var r3 = _pms_repairTabsForFiles_(files, 0);
//  a 8월(200s) → a 9월 하기 전 확인 200s<270s → 한다(400s) → b 시작 전 넘음
같나("업체 사이에서 멈추면 그 업체부터 남는다", ids(r3.left), "b,c,d");

지금 = 0; 한탭에 = 280000; 고친탭 = [];
var r4 = _pms_repairTabsForFiles_(files, 0);
같나("업체 안에서 탭 하다 말면 그 업체도 «못 한 업체»", ids(r4.left), "a,b,c,d");
같나("  그 업체는 «한 업체»에 넣지 않는다", r4.done.length, 0);

console.log("\n[2b] ★ 한 업체 안에서 끊기면 이어서 한다 ★");
/*  마감 탭이 많은 업체가 혼자 4분 30초를 넘으면, 기억이 없을 때 매번 첫 탭부터
    하다 끊겨 영영 못 끝낸다. */
var 큰 = [files[0]];
캐시 = {}; 지금 = 0; 한탭에 = 280000; 고친탭 = [];
var e2 = _pms_repairTabsForFiles_(큰, 0);
같나("첫 번: 8월만 하고 끊긴다", 고친탭.join("|"), "a:(2026년 8월) 발주 마감");
ok("  못 한 업체로 남는다", e2.left.length === 1);
지금 = 0; 고친탭 = [];
var e3 = _pms_repairTabsForFiles_(큰, 0);
같나("두 번째: 8월은 건너뛰고 9월부터", 고친탭.join("|"), "a:(2026년 9월) 발주 마감");
ok("  이번엔 끝난다", e3.left.length === 0 && (e3.done[0] || "").indexOf("앞서 한 1개 건너뜀") >= 0, e3.done[0]);
ok("  끝나면 기억을 지운다 (다음에 또 돌리면 처음부터)", Object.keys(캐시).length === 0);

console.log("\n[2c] 월 고르기 — 편집기판에서 옮겨 심은 것");
같나("비우면 모든 달", _pms_parseMonthPick_("  "), null);
같나("2026-09", JSON.stringify(_pms_parseMonthPick_("2026-09")), JSON.stringify({ y: 2026, m: 9 }));
같나("202609", JSON.stringify(_pms_parseMonthPick_("202609")), JSON.stringify({ y: 2026, m: 9 }));
같나("2026년 9월", JSON.stringify(_pms_parseMonthPick_("2026년 9월")), JSON.stringify({ y: 2026, m: 9 }));
같나("9 (해 없이)", JSON.stringify(_pms_parseMonthPick_("9")), JSON.stringify({ y: null, m: 9 }));
같나("9월", JSON.stringify(_pms_parseMonthPick_("9월")), JSON.stringify({ y: null, m: 9 }));
ok("13 은 틀린 월", !!(_pms_parseMonthPick_("13") || {}).err);
ok("글자는 틀린 월", !!(_pms_parseMonthPick_("구월") || {}).err);
같나("이름표", _pms_monthLabel_({ y: null, m: 9 }) + " / " + _pms_monthLabel_(null), "9월 / 전체");
캐시 = {}; 지금 = 0; 한탭에 = 1000; 고친탭 = [];
_pms_repairTabsForFiles_(files, 0, { y: null, m: 9 });
같나("9월만 고르면 9월 탭만", 고친탭.join("|"), "a:(2026년 9월) 발주 마감|b:(2026년 9월) 발주 마감|c:(2026년 9월) 발주 마감|d:(2026년 9월) 발주 마감");
캐시 = {}; 고친탭 = [];
_pms_repairTabsForFiles_(files, 0, { y: 2025, m: 9 });
같나("해가 다르면 안 고친다", 고친탭.length, 0);

console.log("\n[2d] ★ 칸 배치는 그 마감 탭 4행에서 · 새 모양(취소·반품 없음 · 도서산간은 O열) ★");
/*  > "월 마감텝에서도 취소 반품 (Q,R열) 삭제해줘. O열 도서산간 배송비만 재대로 붙게해줘"
    옛 모양을 알아보고(지울 칸 자리), 새 모양을 알아보고, 둘 다 아니면 발주 탭 폭으로. */
(function () {
  var 진짜 = global._pms_buildColMap_;
  global._pms_buildColMap_ = function (h) {
    var m = { date: -1, price: -1, qty: -1 };
    h.forEach(function (x, i) { x = String(x); if (x === "일자" && m.date < 0) m.date = i; if (x.indexOf("정산금액") >= 0 && m.price < 0) m.price = i; });
    return m;
  };
  //  원본 16칸: A #REF! · B 일자 · … · L 정산금액 · … · O 도서산간배송비 · P
  var 원본 = ["#REF!", "일자"]; while (원본.length < 11) 원본.push("칸" + 원본.length);
  원본.push("정산금액"); while (원본.length < 14) 원본.push("칸" + 원본.length);
  원본.push("도서산간배송비"); 원본.push("칸15");
  var 옛 = 원본.concat(["취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"]);
  var 발주 = ["거래처명(자동)", "일자"]; while (발주.length < 11) 발주.push("칸" + 발주.length);
  발주.push("정산금액(자동)"); while (발주.length < 27) 발주.push("새칸" + 발주.length);
  발주[14] = "도서산간배송비";

  var L = _pms_archiveLayoutFrom_(옛, 발주, 27, true);
  같나("옛 모양을 알아본다 — 취소 Q(17)·반품 R(18)·뒤쪽 도서산간 V(22)·기타정산 W(23)",
    [L.구형.cancel, L.구형.ret, L.구형.island, L.구형.etc].join(","), "17,18,22,23");
  같나("새 모양 = 원본 16칸 + 기타정산", L.extHdr.slice(14).join(","), "도서산간배송비,칸15,기타정산");
  같나("도서산간은 원본 O(15)", L.islandC, 15);
  같나("기타정산은 Q(17)", L.etcC, 17);
  같나("깨진 A4 는 발주 탭 이름으로 메운다", L.extHdr[0] + " / 메움 " + L.메움.join(","), "거래처명(자동) / 메움 0");
  같나("금액 칸 머리글은 「정산금액」", L.extHdr[11], "정산금액");

  var 새 = 원본.concat(["기타정산"]);
  var N = _pms_archiveLayoutFrom_(새, 발주, 27, true);
  같나("새 모양을 알아본다 (옛 칸 자리 없음)", [N.출처, N.구형, N.islandC, N.etcC].join(","), "탭,,15,17");
  var 새빈 = 새.concat(["", ""]);
  같나("뒤에 빈 칸이 있어도 새 모양", _pms_archiveLayoutFrom_(새빈, 발주, 27, true).etcC, 17);

  var 섬없음 = 원본.slice(0, 14).concat(["칸14", "칸15"]);   //  원본에 도서산간 칸이 없는 옛 파일
  var S = _pms_archiveLayoutFrom_(섬없음.concat(["취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"]), 발주, 27, true);
  같나("원본에 도서산간이 없으면 뒤에 하나 둔다 — 원본+도서산간+기타정산", [S.addIsland, S.islandC, S.etcC].join(","), "true,17,18");

  var 깨진 = 원본.slice();   //  취소·반품도 기타정산도 없는 탭
  같나("둘 다 아니면 마감 이동과 같은 폭(최대 20칸) + 기타정산", _pms_archiveLayoutFrom_(깨진, 발주, 27, true).etcC, 21);
  같나("4행에도 없고 발주 탭도 없으면 건너뛴다", _pms_archiveLayoutFrom_(깨진, [], 0, false), null);
  global._pms_buildColMap_ = 진짜;
})();

function 규칙(f) { return { getBooleanCondition: function () { return f == null ? null : { getCriteriaValues: function () { return [f]; } }; } }; }
ok("옛 칠하기 규칙을 알아본다", _pms_isOurRowRule_(규칙('=INDIRECT("R[0]C27",FALSE)=TRUE')));
ok("  사장님이 만든 다른 규칙은 안 건드린다", !_pms_isOurRowRule_(규칙("=$A5>100")));
ok("  색 범위 규칙(조건 없음)도 안 건드린다", !_pms_isOurRowRule_(규칙(null)));
ok("레이아웃은 옛 칠하기 규칙을 걷어 낸다 (새로 넣지 않는다)", 꺼내("_pms_layoutArchiveTab_").indexOf("_pms_removeRowRules_(") >= 0 &&
   꺼내("_pms_layoutArchiveTab_").indexOf("newConditionalFormatRule") < 0);
ok("업체 보정은 빠른 보정을 쓴다", 꺼내("_pms_repairTabsForFiles_").indexOf("_pms_quickRepairTab_(sh, L)") >= 0);
var 체크본 = 꺼내("_pms_ensureCheckboxes_");
ok("체크박스는 첫 행이 아니라 모든 행을 본다", 체크본.indexOf("getRange(_PMS_DATA_START, cancelC, rowCount, 2).getDataValidations()") >= 0);

console.log("\n[3] 메뉴 함수가 고르기와 한도를 쓴다");
var 메뉴 = 꺼내("partnerRepairMonthlySettleTabs");
ok("업체를 고른다", 메뉴.indexOf("_pms_pickVendors_(") >= 0);
ok("고른 것만 돌린다", 메뉴.indexOf("_pms_repairTabsForFiles_(selected") >= 0);
ok("전 업체를 그냥 돌지 않는다", 메뉴.indexOf("files.forEach") < 0);
ok("못 한 업체 번호를 알려 준다", 메뉴.indexOf("r.left") >= 0);
ok("월을 묻고 넘긴다", 메뉴.indexOf("_pms_parseMonthPick_(") >= 0 && 메뉴.indexOf("Date.now(), 월)") >= 0);

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
