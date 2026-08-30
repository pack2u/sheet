/**
 * CS 주문 검색 — 화면(filterLocal)과 서버(_cs_filterRows_)가 같은 답을 내는지.
 *
 *  2026-08-28: 검색이 빠지던 자리
 *    · "홍길동 접이식" 처럼 띄어치면 한 문자열로만 봐서 둘 다 있는 행을 놓침
 *    · 송장 끝 4자리는 전화만 되고 송장은 8자리 이상만 봄
 *    · 통합조회에 송장이 비면 허브 송장을 버리고 넘어감
 *
 * 실행: node _cs_search_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

function grabFn(src, name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

const gs = fs.readFileSync("CS_WebApp/csOrderSearch.gs", "utf8");
const home = fs.readFileSync("CS_WebApp/home.html", "utf8");
const puv = fs.readFileSync("_partnerUnifiedView.gs", "utf8");

const srv = {};
vm.createContext(srv);
vm.runInContext([
  "var _CS_SEARCH_LIMIT_ = 80;",
  grabFn(gs, "_cs_phoneDigits_"),
  grabFn(gs, "_cs_nameKey_"),
  grabFn(gs, "_cs_nameMatch_"),
  grabFn(gs, "_cs_nameOnly_"),
  grabFn(gs, "_cs_orderNoFromName_"),
  grabFn(gs, "_cs_rowUid_"),
  grabFn(gs, "_cs_invSuffixMatch_"),
  grabFn(gs, "_cs_scoreSearchToken_"),
  grabFn(gs, "_cs_scoreSearchRow_"),
  grabFn(gs, "_cs_filterRows_"),
  grabFn(gs, "_cs_orderKeyPart_"),
  grabFn(gs, "_cs_overlayOrderKey_"),
  grabFn(gs, "_cs_overlayPersonKey_"),
  grabFn(gs, "_cs_fillSearchRowGaps_"),
  grabFn(gs, "_cs_overlayExtraRows_"),
  grabFn(puv, "_puv_normDate_"),
].join("\n"), srv);

const cli = {};
vm.createContext(cli);
vm.runInContext([
  grabFn(home, "phoneDigits"),
  grabFn(home, "nameKey"),
  grabFn(home, "nameMatch"),
  grabFn(home, "rowUid"),
  grabFn(home, "invSuffixMatch"),
  grabFn(home, "scoreSearchToken"),
  grabFn(home, "scoreSearchRow"),
].join("\n"), cli);

const row = {
  date: "2026-08-28",
  name: "홍길동",
  item: "접이식 박스 중형",
  phone: "010-1234-5678",
  phoneDigits: "01012345678",
  invoice: "4012-3456-789012",
  invDigits: "40123456789012",
  orderNo: "홍길동/2157237902",
  vendor: "법인/배민",
  addr: "경기도 평택시 고덕면",
  shipMsg: "문앞",
  ecountCode: "HR12345",
};

function hits(q) {
  return !!srv._cs_scoreSearchRow_(row, q);
}
function cliHits(q) {
  return !!cli.scoreSearchRow(row, q);
}

console.log("[1] 띄어쓴 AND — 예전엔 한 문자열이라 놓쳤다");
check("이름+품목", hits("홍길동 접이식"), true);
check("품목만", hits("접이식"), true);
check("이름+없는품목", hits("홍길동 없는품목"), false);
check("이름+전화끝4", hits("홍길동 5678"), true);
check("클라이언트도 이름+품목", cliHits("홍길동 접이식"), true);
check("클라이언트도 이름+없는품목", cliHits("홍길동 없는품목"), false);

console.log("[2] 송장 끝자리 — 8자리 미만도 찾는다");
check("송장 끝4", hits("9012"), true);
check("송장 끝6", hits("789012"), true);
check("송장 전체", hits("40123456789012"), true);
check("없는 끝4", hits("0001"), false);
check("클라이언트 송장 끝4", cliHits("9012"), true);

console.log("[3] 고유ID · 품목코드 · 업체 슬래시 뒤");
check("고유ID", hits("2157237902"), true);
check("품목코드", hits("HR12345"), true);
check("품목코드는 전화로 안 본다", (srv._cs_scoreSearchRow_(row, "HR12345").why || []).join(","), "품목코드");
check("업체 배민", hits("배민"), true);
check("이름/고유ID 통째", hits("홍길동/2157237902"), true);

console.log("[4] 서버·화면 점수 라벨이 같다");
const qs = ["홍길동 접이식", "5678", "9012", "HR12345", "배민"];
qs.forEach(function (q) {
  const a = srv._cs_scoreSearchRow_(row, q);
  const b = cli.scoreSearchRow(row, q);
  check("라벨 " + q, a && a.why, b && b.why);
});

console.log("[5] 허브 오버레이 — 빈 송장을 채운다");
const existing = [{
  date: "2026-08-28", name: "홍길동", item: "접이식 박스 중형",
  orderNo: "홍길동/2157237902", invDigits: "", invoice: "",
  phoneDigits: "01012345678",
}];
const extra = [{
  date: "2026-08-28", name: "홍길동", item: "접이식 박스 중형",
  orderNo: "2157237902", invDigits: "40123456789012", invoice: "40123456789012",
  phoneDigits: "01012345678", source: "허브",
}];
srv._cs_overlayExtraRows_(existing, extra);
check("행 수 그대로", existing.length, 1);
check("송장 채워짐", existing[0].invDigits, "40123456789012");

const onlyNew = [{ date: "2026-08-28", name: "이순신", item: "컵", orderNo: "99", invDigits: "" }];
const fresh = [{ date: "2026-08-28", name: "강감찬", item: "접시", orderNo: "88", invDigits: "12345678" }];
srv._cs_overlayExtraRows_(onlyNew, fresh);
check("새 건은 추가", onlyNew.length, 2);

console.log("[6] 통합조회 날짜 — yyyyMMdd 도 읽는다");
check("구분자 없음", srv._puv_normDate_("20260828"), "2026-08-28");
check("하이픈", srv._puv_normDate_("2026-08-28"), "2026-08-28");
check("빈값", srv._puv_normDate_(""), "");

console.log("[7] filterRows 가 띄어쓴 검색을 통과시킨다");
const found = srv._cs_filterRows_([row], "홍길동 접이식");
check("결과 1건", found.length, 1);
check("이름 라벨", found[0].match.indexOf("이름") >= 0, true);
check("품목 라벨", found[0].match.indexOf("품목") >= 0, true);

console.log("[8] 수량초과 송장 — 1개 주문에 40장이 붙으면 뺀다");
vm.runInContext([
  grabFn(gs, "_cs_isSetItem_"),
  grabFn(gs, "_cs_qtyNum_"),
  grabFn(gs, "_cs_slotSpec_"),
  grabFn(gs, "_cs_invList_"),
  grabFn(gs, "_cs_qtyOverMax_"),
  grabFn(gs, "_cs_stripOverflowInvoice_"),
].join("\n"), srv);
const manyInv = Array.from({ length: 40 }, (_, i) =>
  String(410164800000 + i)).join(" ");
const overflowRow = {
  qty: "1", item: "HR 앞치마 백색 1000매",
  invoice: manyInv, invDigits: manyInv.replace(/\s+/g, " "),
};
check("수량1 · 40장 → 초과", srv._cs_qtyOverMax_("1", "앞치마", manyInv), true);
check("세트 수량1 · 2장 → 허용", srv._cs_qtyOverMax_("1", "물티슈 세트", "11111111 22222222"), false);
check("수량 빈칸 → 막지 않음", srv._cs_qtyOverMax_("", "앞치마", manyInv), false);
srv._cs_stripOverflowInvoice_(overflowRow);
check("스트립 후 송장 비움", overflowRow.invoice, "");
check("스트립 후 장수 기록", overflowRow.invOverflowN, 40);
check("상한이 허브와 같다", srv._cs_slotSpec_(1, "앞치마").max,
  (function () {
    const par = {};
    vm.createContext(par);
    const refix = fs.readFileSync("_partnerArchiveInvoiceRefix.gs", "utf8");
    vm.runInContext([
      grabFn(refix, "_par_qtyNum_"),
      grabFn(refix, "_par_isSetItem_"),
      grabFn(refix, "_par_slotSpec_"),
    ].join("\n"), par);
    return par._par_slotSpec_(1, "앞치마").max;
  })());

if (fail) {
  console.log("\n실패 " + fail + " / " + (pass + fail));
  process.exit(1);
}
console.log("\n통과 " + pass);
