/**
 * 택배사 열 도입 로컬 검증 (Apps Script 밖에서 순수 로직만 돌린다)
 *
 *   node _carrier_test.js
 *
 * 확인하는 것:
 *   ① 택배사를 운송장번호 **앞**에 넣어도 코드 전반의 위치 가정이 성립하는가
 *      (출처 = 마지막, 운송장번호 = 끝에서 두 번째)
 *   ② 택배사 판정 우선순위 (송장맵 → 출처 → 업체)
 *   ③ 옛 헤더 파일에 새 행을 붙일 때 열이 밀지 않는가
 *   ④ 웹앱 조회 링크가 택배사 기준으로 갈리는가
 */

var fs = require("fs");
var vm = require("vm");
var path = require("path");

var ROOT = __dirname;

// ── 대상 함수만 뽑아 sandbox 에 올린다 ──
function extract(file, decl) {
  var src = fs.readFileSync(path.join(ROOT, file), "utf8");
  var at = src.indexOf(decl);
  if (at < 0) throw new Error("못 찾음: " + decl + " in " + file);
  var open = decl.indexOf("[") >= 0 ? "[" : "{";
  var close = open === "[" ? "]" : "}";
  var i = src.indexOf(open, at);
  if (i < 0) throw new Error("본문 시작 못 찾음: " + decl);
  var depth = 0;
  for (var j = i; j < src.length; j++) {
    var c = src[j];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.substring(at, j + 1) + (open === "[" ? ";" : "");
    }
  }
  throw new Error("본문 끝 못 찾음: " + decl);
}

var pieces = [
  extract("_partnerExclusivePush.gs", "function _pep_splitInvNos_"),
  extract("_partnerExclusivePush.gs", "function _pep_normInvoiceNo_"),
  extract("_partnerExclusivePush.gs", "function _pep_addInvoiceMap_"),
  extract("_partnerExclusivePush.gs", "function _pep_ymdNum_"),
  extract("_partnerExclusivePush.gs", "function _pep_ymdLagDays_"),
  extract("_partnerExclusivePush.gs", "function _pep_carrierWithLag_"),
  extract("_partnerExclusivePush.gs", "function _pep_carrierFromSource_"),
  extract("_partnerExclusivePush.gs", "function _pep_carrierForArchiveRow_"),
  extract("_partnerExclusivePush.gs", "function _pep_mapArchiveMatchCols_"),
  extract("_partnerExclusivePush.gs", "function _pep_findCarrierIdx_"),
  extract("_partnerExclusivePush.gs", "function _pep_batchHasInvoicedRows_"),
  extract("CS_WebApp/csOrderSearch.gs", "function _cs_isSnapshotDailyArchiveHeader_"),
  extract("CS_WebApp/csOrderSearch.gs", "function _cs_mapSnapshotDailyHeaders_"),
  extract("CS_WebApp/csOrderSearch.gs", "function _cs_isShipMsgHeader_"),
  extract("_partnerUnifiedView.gs", "function _puv_mapDailyCols_"),
  extract("_partnerUnifiedView.gs", "function _puv_carrier_"),
  extract("_partnerUnifiedView.gs", "function _puv_carrierFromSource_"),
];

// 웹앱 링크 빌더 — home.html 의 script 블록에서 뽑는다
var html = fs.readFileSync(path.join(ROOT, "CS_WebApp/home.html"), "utf8");
function extractHtmlFn(name) {
  var decl = "function " + name;
  var at = html.indexOf(decl);
  if (at < 0) throw new Error("home.html 에서 못 찾음: " + name);
  var i = html.indexOf("{", at);
  var depth = 0;
  for (var j = i; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") { depth--; if (depth === 0) return html.substring(at, j + 1); }
  }
  throw new Error("본문 끝 못 찾음: " + name);
}
["lotteTrackUrl", "logenTrackUrl", "cjTrackUrl", "hanjinTrackUrl",
 "epostTrackUrl", "daesinTrackUrl", "kdexpTrackUrl", "naverTrackUrl",
 "carrierTrackBuilder", "isProxySource", "trackingUrl"].forEach(function (n) {
  pieces.push(extractHtmlFn(n));
});

// 스텁 — 실제 시트를 안 읽는 것들
var stub = [
  "var Logger = { log: function () {} };",
  "var _PEP_TEST_VENDOR_CARRIER_ = { '부엉이커피': '한진택배', '선우': 'CJ대한통운', '냅킨코리아': '롯데택배' };",
  "function _pep_carrierForVendor_(v) {",
  "  var s = String(v || '').replace(/\\s/g, '');",
  "  for (var k in _PEP_TEST_VENDOR_CARRIER_) {",
  "    if (s.indexOf(k) !== -1) return _PEP_TEST_VENDOR_CARRIER_[k];",
  "  }",
  "  return '';",
  "}",
  "function encodeURIComponent_shim(x) { return x; }",
].join("\n");

var ctx = vm.createContext({ encodeURIComponent: encodeURIComponent, console: console });
vm.runInContext(stub + "\n" + pieces.join("\n\n"), ctx);

// ── 테스트 러너 ──
var pass = 0, fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ok   " + name);
  } catch (e) {
    fail++;
    console.log("  FAIL " + name + "\n         " + e.message);
  }
}
function eq(actual, expected, what) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((what || "") + " 기대=" + b + " 실제=" + a);
}
function truthy(v, what) { if (!v) throw new Error((what || "값") + " 이 거짓"); }

var C = function (n) { return vm.runInContext(n, ctx); };
function call(name, args) {
  ctx.__args = args || [];
  return vm.runInContext(name + ".apply(null, __args)", ctx);
}

// 판매현황 C~Q 15열 헤더 (실제 양식과 같은 순서)
var CQ = ["순번", "일자-No.", "품목코드", "품목명", "택배박스", "수량", "전화", "모바일",
          "주소1", "배송메시지", "합계", "판매처", "단품배송비", "적요", "사방넷주문번호"];
var OLD_HDR = CQ.concat(["운송장번호", "출처"]);              // 17열 (도입 전)
var NEW_HDR = CQ.concat(["택배사", "운송장번호", "출처"]);     // 18열 (도입 후)

console.log("\n① 위치 가정 보존 — 택배사를 운송장번호 앞에 넣었을 때");

t("옛 헤더: 운송장번호 = length-2, 출처 = length-1", function () {
  eq(OLD_HDR[OLD_HDR.length - 2], "운송장번호");
  eq(OLD_HDR[OLD_HDR.length - 1], "출처");
});

t("새 헤더: 운송장번호 = length-2, 출처 = length-1 (그대로 성립)", function () {
  eq(NEW_HDR[NEW_HDR.length - 2], "운송장번호", "운송장번호 위치");
  eq(NEW_HDR[NEW_HDR.length - 1], "출처", "출처 위치");
});

t("_cs_isSnapshotDailyArchiveHeader_ 가 새 헤더도 인식", function () {
  truthy(call("_cs_isSnapshotDailyArchiveHeader_", [OLD_HDR]), "옛 헤더 인식");
  truthy(call("_cs_isSnapshotDailyArchiveHeader_", [NEW_HDR]), "새 헤더 인식");
});

t("_cs_mapSnapshotDailyHeaders_ 가 inv·src·carrier 를 바르게 짚음", function () {
  var m = call("_cs_mapSnapshotDailyHeaders_", [NEW_HDR]);
  eq(m.inv, 16, "운송장번호");
  eq(m.src, 17, "출처");
  eq(m.carrier, 15, "택배사");
});

t("'택배박스' 를 택배사로 오인하지 않음", function () {
  var m = call("_cs_mapSnapshotDailyHeaders_", [OLD_HDR]);
  eq(m.carrier, -1, "옛 헤더엔 택배사가 없어야 함");
  truthy(CQ.indexOf("택배박스") >= 0, "택배박스가 실제로 헤더에 있음");
});

t("_pep_mapArchiveMatchCols_ 가 새 헤더에서 inv·src·carrier 를 짚음", function () {
  var m = call("_pep_mapArchiveMatchCols_", [NEW_HDR]);
  eq(m.inv, 16, "운송장번호");
  eq(m.src, 17, "출처");
  eq(m.carrier, 15, "택배사");
});

t("_puv_mapDailyCols_ 가 새 헤더에서 inv·src·carrier 를 짚음", function () {
  var m = call("_puv_mapDailyCols_", [NEW_HDR]);
  eq(m.inv, 16, "운송장번호");
  eq(m.src, 17, "출처");
  eq(m.carrier, 15, "택배사");
});

t("_pep_batchHasInvoicedRows_ 가 새 레이아웃에서도 송장을 찾음", function () {
  var row = [];
  for (var i = 0; i < 15; i++) row.push("");
  var r = row.concat(["한진택배", "123456789012", "대리판매"]);
  truthy(call("_pep_batchHasInvoicedRows_", [[r]]), "송장 있는 행 인식");
  var r2 = row.concat(["", "", "미매칭"]);
  eq(call("_pep_batchHasInvoicedRows_", [[r2]]), false, "미매칭 행");
});

console.log("\n② 택배사 판정 우선순위");

t("송장맵이 실어 온 값이 1순위", function () {
  var info = { inv: "1", source: "롯데", carrier: "한진택배" };
  eq(call("_pep_carrierForArchiveRow_", [info, "롯데", "냅킨코리아"]), "한진택배");
});

t("송장맵이 비면 출처로 판정", function () {
  eq(call("_pep_carrierForArchiveRow_", [{ inv: "1", source: "롯데" }, "롯데", ""]), "롯데택배");
  eq(call("_pep_carrierForArchiveRow_", [{ inv: "1", source: "롯데", lag: 3 }, "롯데", ""]), "롯데택배(03)");
  eq(call("_pep_carrierWithLag_", ["롯데택배", 0]), "롯데택배");
  eq(call("_pep_carrierWithLag_", ["한진택배(03)", 0]), "한진택배");
  eq(call("_pep_carrierForArchiveRow_", [null, "로젠", ""]), "로젠택배");
  eq(call("_pep_carrierForArchiveRow_", [null, "합포장", ""]), "롯데택배");
  eq(call("_pep_carrierForArchiveRow_", [null, "1주출고", ""]), "롯데택배");
});

t("출처가 대리판매면 업체로 판정 (핵심 시나리오)", function () {
  eq(call("_pep_carrierFromSource_", ["대리판매"]), "", "대리판매는 택배사를 알려주지 않음");
  eq(call("_pep_carrierForArchiveRow_", [null, "대리판매", "부엉이커피"]), "한진택배");
});

t("셋 다 모르면 빈칸 (송장번호로 억지 추론하지 않음)", function () {
  eq(call("_pep_carrierForArchiveRow_", [null, "대리판매", ""]), "");
  eq(call("_pep_carrierForArchiveRow_", [null, "미매칭", "모르는업체"]), "");
});

t("_pep_addInvoiceMap_ 이 carrier 를 보관하고 첫 값을 지킴", function () {
  var map = {};
  call("_pep_addInvoiceMap_", [map, "UID1", "123456789012", "대리판매", "한진택배"]);
  eq(map.UID1.carrier, "한진택배");
  call("_pep_addInvoiceMap_", [map, "UID1", "999999999999", "대리판매", "로젠택배"]);
  eq(map.UID1.carrier, "한진택배", "첫 택배사를 지켜야 함");
  eq(map.UID1.inv.split("\n").length, 2, "송장은 둘 다 누적");
});

t("carrier 없이 호출해도 종전처럼 동작 (하위호환)", function () {
  var map = {};
  call("_pep_addInvoiceMap_", [map, "UID2", "123456789012", "롯데"]);
  eq(map.UID2.carrier, "", "빈 문자열이어야 함");
  eq(map.UID2.source, "롯데");
});

t("_puv_carrier_ 는 마감이 적어 둔 값을 재산정으로 덮지 않음", function () {
  // 마감은 발주업체를 알지만, 통합조회가 마감을 다시 읽을 땐 그 열에 판매처가 있다
  eq(call("_puv_carrier_", ["대리판매", "쿠팡", "한진택배"]), "한진택배", "기록값 우선");
  eq(call("_puv_carrier_", ["대리판매", "쿠팡", ""]), "", "기록값 없고 판매처로는 못 찾음");
  eq(call("_puv_carrier_", ["대리판매", "부엉이커피", ""]), "한진택배", "업체명을 알면 찾음");
});

console.log("\n③ 옛 헤더 파일 이행 — 열이 밀지 않아야 한다");

// _pep_fitArchiveCarrierColumn_ 의 폴백 갈래(열 삽입 실패)를 시트 없이 재현한다
function fitFallback(headers, rows) {
  var idx = call("_pep_findCarrierIdx_", [headers]);
  if (idx < 0) return { headers: headers, rows: rows };
  var h = headers.filter(function (_, i) { return i !== idx; });
  var r = rows.map(function (row) {
    return row.filter(function (_, i) { return i !== idx; });
  });
  return { headers: h, rows: r };
}

t("_pep_findCarrierIdx_ 가 위치를 정확히 짚음", function () {
  eq(call("_pep_findCarrierIdx_", [NEW_HDR]), 15);
  eq(call("_pep_findCarrierIdx_", [OLD_HDR]), -1);
});

t("택배사를 떼어내면 옛 레이아웃과 정확히 일치", function () {
  var newRow = [];
  for (var i = 0; i < 15; i++) newRow.push("v" + i);
  newRow = newRow.concat(["한진택배", "123456789012", "대리판매"]);
  var fit = fitFallback(NEW_HDR, [newRow]);
  eq(fit.headers, OLD_HDR, "헤더");
  eq(fit.headers.length, 17, "열 수");
  eq(fit.rows[0][fit.rows[0].length - 2], "123456789012", "운송장번호가 제자리");
  eq(fit.rows[0][fit.rows[0].length - 1], "대리판매", "출처가 제자리");
});

t("택배사 없는 호출은 그대로 통과", function () {
  var fit = fitFallback(OLD_HDR, [["a", "b"]]);
  eq(fit.headers, OLD_HDR);
});

console.log("\n④ 웹앱 조회 링크");

t("택배사를 알면 그 택배사로 간다", function () {
  var d = "123456789012";
  truthy(call("trackingUrl", [d, "대리판매", "한진택배"]).indexOf("hanjin.com") >= 0, "한진");
  truthy(call("trackingUrl", [d, "대리판매", "로젠택배"]).indexOf("ilogen.com") >= 0, "로젠");
  truthy(call("trackingUrl", [d, "대리판매", "CJ대한통운"]).indexOf("cjlogistics") >= 0, "CJ");
  truthy(call("trackingUrl", [d, "대리판매", "롯데택배"]).indexOf("lotteglogis") >= 0, "롯데");
  truthy(call("trackingUrl", [d, "대리판매", "롯데택배(03)"]).indexOf("lotteglogis") >= 0, "롯데(지연)");
  truthy(call("trackingUrl", [d, "대리판매", "우체국"]).indexOf("epost.go.kr") >= 0, "우체국");
  truthy(call("trackingUrl", [d, "대리판매", "대신택배"]).indexOf("ds3211") >= 0, "대신");
});

t("★ 핵심: 대리판매 + 택배사 있음 → 네이버로 안 떨어진다", function () {
  var url = call("trackingUrl", ["123456789012", "대리판매", "한진택배"]);
  eq(url.indexOf("search.naver.com"), -1, "네이버 폴백이 나오면 안 됨");
});

t("택배사 없으면 종전 동작 유지 (대리판매 → 네이버)", function () {
  var url = call("trackingUrl", ["123456789012", "대리판매", ""]);
  truthy(url.indexOf("search.naver.com") >= 0, "네이버 폴백");
});

t("택배사 없어도 출처가 알려주면 그대로 (회귀 방지)", function () {
  truthy(call("trackingUrl", ["123456789012", "로젠", ""]).indexOf("ilogen.com") >= 0, "로젠");
  truthy(call("trackingUrl", ["123456789012", "롯데", ""]).indexOf("lotteglogis") >= 0, "롯데");
});

t("8자리 미만 송장은 링크를 만들지 않음", function () {
  eq(call("trackingUrl", ["1234", "대리판매", "한진택배"]), "");
});

t("모르는 택배사면 출처 경로로 내려간다", function () {
  var url = call("trackingUrl", ["123456789012", "대리판매", "듣보택배"]);
  truthy(url.indexOf("search.naver.com") >= 0, "모르는 택배사 → 출처 폴백");
});

t("carrierTrackBuilder 가 아는/모르는 택배사를 가림", function () {
  truthy(call("carrierTrackBuilder", ["한진택배"]), "한진은 안다");
  eq(call("carrierTrackBuilder", ["듣보택배"]), null, "모르는 것은 null");
  eq(call("carrierTrackBuilder", [""]), null, "빈 값은 null");
});

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
