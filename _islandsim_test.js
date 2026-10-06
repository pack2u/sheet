/**
 * 도서산간 주소 판정 — «통째로» 돌려 본다 (가짜 허브·가짜 세트분리 시트·가짜 카카오).
 * 2026-10-05  내일 오전 첫 회차 전에.
 *
 *   순수 함수 시험은 따로 있다(_islandjudge_test · _islandfee_test). 여기서는
 *   _island_judgeHubByAddress_ 를 실제로 끝까지 돌려 이름·범위 실수를 잡는다.
 *
 * 실행: node _islandsim_test.js
 */
var fs = require("fs");
var path = require("path");
function 읽기(f) { return fs.readFileSync(path.join(__dirname, f), "utf8"); }

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) {
  if (참) { 통과++; console.log("  ok   " + 이름); }
  else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); }
}
function 같나(이름, 얻은, 기대) { ok(이름, JSON.stringify(얻은) === JSON.stringify(기대), "얻은 " + JSON.stringify(얻은) + " · 기대 " + JSON.stringify(기대)); }

/* ── 가짜 시트 ─────────────────────────────────────────── */
function 가짜탭(이름, 표) {
  var t = { 이름: 이름, 표: 표, 쓰기: 0, 규칙: [] };
  function 넓이() { return Math.max.apply(null, 표.map(function (r) { return r.length; }).concat([1])); }
  function 칸(r, c) { return (표[r - 1] && 표[r - 1][c - 1] !== undefined) ? 표[r - 1][c - 1] : ""; }
  t.getName = function () { return 이름; };
  t.getLastRow = function () {
    for (var i = 표.length - 1; i >= 0; i--) if (표[i].some(function (v) { return v !== "" && v != null; })) return i + 1;
    return 0;
  };
  t.getLastColumn = function () {
    var m = 0;
    표.forEach(function (r) { for (var i = r.length - 1; i >= 0; i--) if (r[i] !== "" && r[i] != null) { m = Math.max(m, i + 1); break; } });
    return m;
  };
  t.getMaxColumns = function () { return 넓이(); };
  t.insertColumnsAfter = function (after, n) { 표.forEach(function (r) { while (r.length < after + n) r.push(""); }); };
  t.setColumnWidth = function () {};
  t.getConditionalFormatRules = function () { return t.규칙; };
  t.setConditionalFormatRules = function (r) { t.규칙 = r; };
  t.getRangeList = function () { var o = {}; ["setNumberFormat", "setFontColor", "setFontWeight", "setBackground"].forEach(function (f) { o[f] = function () { return o; }; }); return o; };
  t.getRange = function (r, c, nr, nc) {
    if (typeof r === "string") { return { }; }
    nr = nr || 1; nc = nc || 1;
    var rg = {};
    function 읽() { var out = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(칸(r + i, c + j)); out.push(row); } return out; }
    rg.getValues = 읽;
    rg.getDisplayValues = function () { return 읽().map(function (row) { return row.map(function (v) { return v == null ? "" : String(v); }); }); };
    rg.getValue = function () { return 칸(r, c); };
    rg.setValues = function (v) {
      t.쓰기++;
      for (var i = 0; i < v.length; i++) { while (표.length < r + i) 표.push([]); var row = 표[r + i - 1]; for (var j = 0; j < v[i].length; j++) { while (row.length < c + j) row.push(""); row[c + j - 1] = v[i][j]; } }
      return rg;
    };
    rg.setValue = function (v) { return rg.setValues([[v]]); };
    ["setBackground", "setFontColor", "setFontWeight", "setHorizontalAlignment", "setNumberFormat"].forEach(function (f) { rg[f] = function () { return rg; }; });
    return rg;
  };
  return t;
}
function 가짜시트(탭들) {
  return { getSheetByName: function (n) { return 탭들[n] || null; }, getSheets: function () { return Object.keys(탭들).map(function (k) { return 탭들[k]; }); } };
}

/* ── 허브 (A~P + 도서산간배송비 Q) ─────────────────────────── */
var 허브머리 = ["수집일시", "발주업체", "고유ID", "주문일자", "이카운트코드", "품목명", "수량", "수취인", "전화번호", "주소",
  "배송메시지", "정산금액", "적요", "", "상태", "판매갱신 업 완료 여부", "도서산간배송비"];
function 허브줄(uid, 품목, 주소, P, 상태, 금액) {
  return ["2026-10-06 09:30", "그린우드", uid, "20261006", "C1", 품목, 1, "홍길동", "1012345678", 주소, "", 10000, "", "", 상태 || "접수완료", P || "", 금액 || ""];
}
var 허브표 = [허브머리,
  허브줄("d1006000001", "BW 사출 195파이 특대 투명 300세트", "제주특별자치도 제주시 연동 1"),     // 우편번호 섬, 세트 → 10000
  허브줄("d1006000002", "JH 실링 23195 화이트 100", "서울특별시 강남구 테헤란로 123"),            // 일반
  허브줄("d1006000003", "JH 신형 105파이 1000 SET", "경상북도 울릉군 울릉읍 도동리 1"),           // 도선료표 섬, 영문 SET → 5000
  허브줄("d1006000004", "뚜껑", "인천광역시 옹진군 영흥면 어딘가 9"),                           // 우편번호 못 찾음 + 후보 → 미확인
  허브줄("d1006000005", "몸통", "제주특별자치도 제주시 연동 2", "판매갱신 업 완료"),              // 이미 올라감 → 안 봄
  허브줄("d1006000006", "몸통", "제주특별자치도 제주시 연동 3", "", "취소"),                      // 취소 → 안 봄
  허브줄("d1006000007", "몸통", "제주특별자치도 제주시 연동 4", "", "", 15000),                  // 이미 금액 → 「금액 있음」
];
var 허브탭 = 가짜탭("협력업체_발주허브", 허브표);

/* ── 세트분리(뉴) 도서산간 자료 ──────────────────────────── */
var 세트분리 = 가짜시트({
  "도서산간_도선료": 가짜탭("도서산간_도선료", [["시도", "시군구", "읍면동", "리조건", "도선료", "권역"], ["경상북도", "울릉군", "울릉읍", "", 6500, "도서"]]),
  "도서산간_우편번호": 가짜탭("도서산간_우편번호", [["우편번호", "권역"], ["63309", "제주"]]),
  "도서산간_시군": 가짜탭("도서산간_시군", [["시/군", "권역", "확정"], ["옹진군", "도서", ""]]),
  "도서산간_주소사전": 가짜탭("도서산간_주소사전", [["정규주소", "우편번호"], ["제주특별자치도 제주시 연동 1", "63309"]]),
});

/* ── 업체 시트 ─────────────────────────────────────────── */
var 업체발주 = 가짜탭("발주 및 송장조회", [
  ["거래처명", "일자", "이카운트코드", "품목명", "수량", "수취인", "", "", "", "", "", "", "고유ID", "상태", "도서산간배송비"],
  ["그린우드", "20261006", "C1", "BW 사출 195파이 특대 투명 300세트", 1, "홍길동", "", "", "", "", "", "", "홍길동/d1006000001", "", ""],
  ["그린우드", "20261006", "C1", "JH 실링", 1, "홍길동", "", "", "", "", "", "", "홍길동/d1006000002", "", ""],
]);
var 업체시트 = 가짜시트({ "발주 및 송장조회": 업체발주 });

/* ── GAS 흉내 ─────────────────────────────────────────── */
var 카카오물음 = [];
global.Logger = { log: function () {} };
global.Utilities = { sleep: function () {} };
global.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
global.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return 가짜시트({ "협력업체_발주허브": 허브탭 }); },
  openById: function (id) { return id === "업체1" ? 업체시트 : 세트분리; },
  flush: function () {},
  getUi: function () { return { alert: function () {}, ButtonSet: {} }; },
  newConditionalFormatRule: function () { var b = {}; ["whenFormulaSatisfied", "setBackground", "setRanges"].forEach(function (f) { b[f] = function () { return b; }; }); b.build = function () { return {}; }; return b; },
};
global.UrlFetchApp = {
  fetchAll: function (reqs) {
    return reqs.map(function (q) {
      var 주소 = decodeURIComponent(q.url.split("query=")[1]);
      카카오물음.push(주소);
      var zip = 주소.indexOf("테헤란로") >= 0 ? "06134" : 주소.indexOf("연동") >= 0 ? "63310" : "";
      return { getResponseCode: function () { return 200; },
               getContentText: function () { return JSON.stringify({ documents: zip ? [{ road_address: { zone_no: zip } }] : [] }); } };
    });
  },
};
global._PO_HUB_SHEET_NAME = "협력업체_발주허브";
global._pt_listFiles = function () { return [{ id: "업체1", name: "[협력업체] 그린우드" }]; };
global._pep_zipCacheLoad_ = function () { return {}; };
global._pep_getKakaoApiKey_ = function () { return "KEY"; };
global._pep_getZipCodeCached_ = function () { return ""; };
global._pep_zipCacheSave_ = function () {};
var 채팅 = [];
global._chat_sendText_ = function (t) { 채팅.push(t); };

/* ── 진짜 코드를 올린다 ────────────────────────────────── */
[읽기("_partnerIslandShipping.gs"), 읽기("_partnerIslandJudge.gs"), 읽기("_partnerIslandSales.gs")]
  .forEach(function (s) { (0, eval)(s); });

console.log("\n[1] ★ 통째로 한 번 ★");
var r = _island_judgeHubByAddress_();
같나("본 줄 (이미 올라감·취소·금액있음 빼고)", r.본, 4);
같나("섬 2 · 일반 1 · 미확인 1", [r.섬, r.일반, r.미확인], [2, 1, 1]);
var 머리 = 허브표[0];
var 판정칸 = 머리.indexOf("도서산간판정"), 금액칸 = 머리.indexOf("도서산간배송비");
ok("허브 맨 뒤에 「도서산간판정」 칸이 생겼다", 판정칸 === 머리.length - 1, JSON.stringify(머리));
function 줄(i) { return 허브표[i]; }
같나("제주 세트 — 10,000", 줄(1)[금액칸], 10000);
ok("  판정: 섬 · 제주 · 우편번호 63309 (주소사전에서)", String(줄(1)[판정칸]).indexOf("섬 · 제주 · 우편번호 63309") === 0, 줄(1)[판정칸]);
같나("서울 — 금액 없음", 줄(2)[금액칸], "");
같나("  판정: 일반 · 06134", 줄(2)[판정칸], "일반 · 06134");
같나("울릉 영문 SET — 5,000 (도선료표)", 줄(3)[금액칸], 5000);
ok("  판정: 도선료표", String(줄(3)[판정칸]).indexOf("도선료표") >= 0, 줄(3)[판정칸]);
같나("옹진 후보뿐 — 금액 없음", 줄(4)[금액칸], "");
ok("  판정: 미확인", String(줄(4)[판정칸]).indexOf("미확인") === 0, 줄(4)[판정칸]);
ok("  미확인은 채팅으로 알린다", 채팅.length === 1 && 채팅[0].indexOf("미확인 1줄") >= 0);
같나("이미 올라간 줄은 안 건드린다", [줄(5)[금액칸], 줄(5)[판정칸] || ""], ["", ""]);
같나("취소 줄은 안 건드린다", [줄(6)[금액칸], 줄(6)[판정칸] || ""], ["", ""]);
같나("이미 금액이 있는 줄 — 「금액 있음」만 적는다", [줄(7)[금액칸], 줄(7)[판정칸]], [15000, "금액 있음"]);
ok("주소사전에 있는 주소는 카카오에 안 묻는다", 카카오물음.indexOf("제주특별자치도 제주시 연동 1") < 0, JSON.stringify(카카오물음));
ok("도선료표로 끝난 주소는 카카오에 안 묻는다", 카카오물음.indexOf("경상북도 울릉군 울릉읍 도동리 1") < 0);

/*  ★ 2026-10-06 — 적되, 업체 눈에는 안 보이게 ★  (㉮)
    > "대리발송으로 넘어갈때.. 도서산간 추가비용은 빠져야되"
    > "그리고 도서산간 추가배송비도 목록으로 뽑히게 해줘"

    한 칸을 두 곳이 쓴다 — 업체가 보는 「발주 및 송장조회」와 거래명세표다.
    안 적으면 명세서가 읽을 것이 없고, 적으면 업체가 본다.
    그래서 «적고 숨긴다». 명세서는 숨은 열도 읽는다.                       */
console.log("\n[2] ★ 업체 시트에 적되 그 열은 숨긴다 ★");
var 업체표 = 업체발주.표, 업금 = 업체표[0].indexOf("도서산간배송비");
같나("업체 시트 제주 세트 — 10,000 적힌다 (명세서가 읽는다)", 업체표[1][업금], 10000);
같나("업체 시트 서울 — 안 붙임", 업체표[2][업금], "");
var 섬글 = 읽기("_partnerIslandShipping.gs");
ok("적는 스위치는 켜져 있다", /_ISLAND_WRITE_TO_VENDOR_ = true/.test(섬글));
ok("★ 숨기는 스위치도 켜져 있다 ★", /_ISLAND_HIDE_VENDOR_COL_ = true/.test(섬글),
  "업체 발주서에 보이면 안 된다");
ok("★ 칸을 만든 «바로 그 자리»에서 숨긴다 ★",
  /_island_ensurePartnerFeeCol_\(orderTab\);[\s\S]{0,500}hideColumns\(feeCol\)/.test(섬글),
  "금액을 새로 쓸 때만 숨기면, 이미 적힌 시트는 영영 안 숨겨진다");
ok("숨기다 터져도 나머지는 간다", /try \{ orderTab\.hideColumns\(feeCol\); \} catch/.test(섬글),
  "곁다리 때문에 금액 쓰기가 멈추면 더 나쁘다");
ok("명세서가 그 칸을 가산 항목으로 읽는다",
  /h === "도서산간배송비"/.test(읽기("_partnerTaxStatement.gs")),
  "여기 이름이 바뀌면 명세서에서 조용히 사라진다");

console.log("\n[3] 두 번째 실행 — 다시 묻지 않는다");
var 물음수 = 카카오물음.length, 쓰기수 = 허브탭.쓰기;
var r2 = _island_judgeHubByAddress_();
같나("새로 볼 줄 없음", r2.본, 0);
같나("카카오에 다시 안 묻는다", 카카오물음.length, 물음수);

console.log("\n[4] 원장(받침)은 판정한 줄·올라간 줄에 새 금액을 안 붙인다");
var 원장섬 = { "d1006000002": { 권역: "도서" }, "d1006000005": { 권역: "제주" } };
var h = _island_applyToHub_(원장섬);
같나("일반으로 판정한 줄(서울)·이미 올라간 줄 — 둘 다 안 붙임", [줄(2)[금액칸], 줄(5)[금액칸], h.applied], ["", "", 0]);

console.log("\n[5] ★ 판매현황 갱신 — 첫날 막기 · 같은 회차 OUT00001 · 늦게 붙은 금액 ★");
(function () {
  var 주문 = 읽기("_partnerOrders.gs");
  function 꺼내(이름) {
    var i = 주문.indexOf("function " + 이름 + "(");
    var 깊이 = 0, 시작 = 주문.indexOf("{", i);
    for (var k = 시작; k < 주문.length; k++) {
      if (주문[k] === "{") 깊이++;
      else if (주문[k] === "}") { 깊이--; if (!깊이) return 주문.substring(i, k + 1); }
    }
  }
  function 상수(이름) { var i = 주문.indexOf("var " + 이름 + " "); return 주문.substring(i, 주문.indexOf("];", i) + 2); }
  (0, eval)(상수("_PO_SALES_UPLOAD_HEADERS"));
  (0, eval)(꺼내("partnerRebuildSalesUploadSheetCore_"));
  (0, eval)(꺼내("_po_countReason_"));
  global._PO_SALES_UPLOAD_TAB = "이카운트-판매현황업로드용(협력업체)";
  global._po_buildVendorCustCdMap_ = function () { return {}; };
  global._po_resolveVendorCustCd_ = function () { return "C001"; };
  global._dw_appendSalesHistory_ = function () {};
  var 올린 = null;
  global._po_writeSalesUploadSheet_ = function (ss, out) { 올린 = out; };
  global.Utilities.formatDate = function () { return "20261006"; };

  //  새 허브: 옛 줄(이미 올라감·옛 금액) · 새 섬 줄 · 새 일반 줄
  var 머리2 = 허브머리.slice();
  var 표2 = [머리2,
    허브줄("0915-ds-0001", "옛 주문", "제주 어딘가", "판매갱신 업 완료", "", 15000),
    허브줄("d1006000011", "BW 300세트", "제주특별자치도 제주시 연동 9", "", "", 10000),
    허브줄("d1006000012", "JH 실링", "서울특별시 어딘가", "", "", ""),
  ];
  var 탭2 = 가짜탭("협력업체_발주허브", 표2);
  var ss2 = 가짜시트({ "협력업체_발주허브": 탭2 });

  partnerRebuildSalesUploadSheetCore_(ss2, null, true);
  var 표지칸 = 표2[0].indexOf("도서산간 판매갱신");
  ok("「도서산간 판매갱신」 칸이 맨 뒤에 생겼다", 표지칸 === 표2[0].length - 1);
  같나("옛 줄(이미 올라감 + 옛 금액)은 「도입 전」으로 막았다", 표2[1][표지칸], "도입 전(2026-10-05)");
  var 코드들 = 올린.map(function (l) { return l[15]; });
  /*  ★ 이 줄은 세트라 OUT000011 이다 ★  (2026-10-06)
      > "세트상품은 도서산간 코드가 OUT000011이야"
      바로 아래 단가가 10,000 인 것이 세트라는 증거다. 금액과 코드가
      «같은 판정»으로 가는지를 이 한 줄이 지킨다 — 어긋나면 여기서 운다.
      아래 「늦게 붙은 금액」 줄은 5,000(보통 상품)이라 OUT00001 그대로다. */
  같나("올린 줄: 새 섬 주문 · 그 OUT000011(세트) · 새 일반 주문 (옛 줄 없음)", 코드들, ["C1", "OUT000011", "C1"]);
  같나("  세트 줄 단가 10,000", 올린[1][18], 10000);
  같나("  OUT00001 주문자명 = 수취인/고유ID", 올린[1][24], "홍길동/d1006000011");
  같나("새 섬 줄 — P 완료 · 도서산간 판매갱신 완료", [표2[2][15], 표2[2][표지칸]], ["판매갱신 업 완료", "판매갱신 업 완료"]);
  같나("일반 줄 — 도서산간 판매갱신 칸은 비어 있다", 표2[3][표지칸] || "", "");

  //  다음 날: 사람이 이미 올라간 일반 줄에 도서산간비를 손으로 넣었다
  var 금칸 = 표2[0].indexOf("도서산간배송비");
  표2[3][금칸] = 5000;
  partnerRebuildSalesUploadSheetCore_(ss2, null, true);
  같나("다음 갱신: 늦게 붙은 도서산간비만 OUT00001 한 줄", 올린.map(function (l) { return l[15] + ":" + l[18]; }), ["OUT00001:5000"]);
  같나("  그 줄도 완료 표시", 표2[3][표지칸], "판매갱신 업 완료");
  partnerRebuildSalesUploadSheetCore_(ss2, null, true);
  같나("그다음 갱신: 아무것도 다시 안 올린다", 올린.length, 0);
})();

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
