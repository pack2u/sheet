/**
 * 로컬 검증: 포털 고유ID → 그 업체 발주 마감 조회
 *
 *  슬래시 뒤만 키. 헤더는 4행일 수 있다. 파일은 이름으로만 고른다.
 *
 * 실행: node _prp_lookup_test.js
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

const lookupSrc = fs.readFileSync("Partner_WebApp/prpLookup.gs", "utf8");
const configSrc = fs.readFileSync("Partner_WebApp/prpConfig.gs", "utf8");
const ledgerSrc = fs.readFileSync("Partner_WebApp/prpLedger.gs", "utf8");
const portalSrc = fs.readFileSync("Partner_WebApp/portal.html", "utf8");
const apiSrc = fs.readFileSync("Partner_WebApp/prpApi.gs", "utf8");

const ctx = vm.createContext({
  PRP_ARCHIVE_TAB_SUFFIX_: "발주 마감",
  PRP_LOOKUP_MONTHS_: 6,
  PRP_VENDOR_LABELS: { JT: "준테크" }
});
[
  "prpDigits_", "prpVendorKey_", "prpFormatPhone_", "prpFormatInvoice_",
  "prpUidFromCell_", "prpUidNorm_", "prpUidEquals_",
  "prpFindOrderHeaderRow_", "prpMapOrderCols_", "prpRowMatchesUid_", "prpRowToMatch_",
  "prpArchiveTabName_", "prpRecentArchiveTabNames_",
  "prpVendorNameFromFileName_", "prpFileLooksConsumer_", "prpFileBelongsTo_",
  "prpVendorSearchLabels_"
].forEach(function (n) {
  const src = [lookupSrc, configSrc, ledgerSrc].map(function (s) {
    try { return grabFn(s, n); } catch (e) { return ""; }
  }).join("");
  if (!src) throw new Error(n + " 를 못 찾음");
  vm.runInContext(src, ctx);
});

console.log("\n[1] 고유ID 는 슬래시 뒤 + 접미 제거");
check("이름/abc123", ctx.prpUidFromCell_("홍길동/abc123"), "abc123");
check("전각 슬래시", ctx.prpUidFromCell_("홍길동／PH-0828-1"), "PH-0828-1");
check("#n 접미", ctx.prpUidFromCell_("abc123#2"), "abc123");
check("|코드 접미", ctx.prpUidFromCell_("abc123|JT01"), "abc123");
check("빈값", ctx.prpUidFromCell_(""), "");
check("하이픈 무시 비교", ctx.prpUidEquals_("0828-ds-aa", "0828dsaa"), true);

console.log("\n[2] 발주 마감 표준 15열");
const hdr = ["거래처명(자동)","주문일자(자동)","이카운트코드","품목명(자동)","수량","수취인","수취인전화번호","수취인주소","배송메시지","적요","송장번호","정산금액(자동)","고유ID(자동)","상태(자동)","도서산간배송비"];
const cols = ctx.prpMapOrderCols_(hdr);
check("송장 = 10", cols.inv, 10);
check("고유ID = 12", cols.uid, 12);
check("이름 = 5", cols.name, 5);
check("전화 = 6", cols.phone, 6);
check("품목 = 3", cols.item, 3);
check("수량 = 4", cols.qty, 4);
check("적요 = 9", cols.note, 9);

const emptyCols = ctx.prpMapOrderCols_(["","","","","","","","","","","","","","",""]);
check("헤더 없어도 고유ID 폴백 12", emptyCols.uid, 12);

const all = [
  ["제목","","","","","","","","","","","","","",""],
  ["","","","","","","","","","","","","","",""],
  ["","","","","","","","","","","","","","",""],
  hdr
];
check("헤더가 4행", ctx.prpFindOrderHeaderRow_(all), 3);

console.log("\n[3] 행 매칭");
const row = new Array(15).fill("");
row[3] = "물티슈";
row[4] = "2";
row[5] = "홍길동";
row[6] = "01012345678";
row[10] = "1234-5678-9012";
row[12] = "홍길동/abc123";
check("고유ID 열로 맞음", ctx.prpRowMatchesUid_(row, cols, "abc123"), true);
const noteRow = row.slice();
noteRow[12] = "";
noteRow[9] = "abc123";
check("적요 폴백", ctx.prpRowMatchesUid_(noteRow, cols, "abc123"), true);
check("다른 ID", ctx.prpRowMatchesUid_(row, cols, "zzz"), false);
const hit = ctx.prpRowToMatch_(row, cols, "발주 마감");
check("채움 이름", hit.name, "홍길동");
check("채움 품목", hit.item, "물티슈");
check("채움 UID 슬래시 뒤", hit.uid, "abc123");

console.log("\n[4] 탭 이름 · 파일은 이름으로만");
check("탭 이름", ctx.prpArchiveTabName_(2026, 8), "(2026년 8월) 발주 마감");
check("최근 3개월", ctx.prpRecentArchiveTabNames_(new Date(2026, 7, 28), 3), [
  "(2026년 8월) 발주 마감",
  "(2026년 7월) 발주 마감",
  "(2026년 6월) 발주 마감"
]);
check("소비자용·DC 는 건너뜀", ctx.prpFileLooksConsumer_("[협력업체] 부엉이커피 (소비자용) 5%DC"), true);
check("본파일은 통과", ctx.prpFileLooksConsumer_("[협력업체] 부엉이커피"), false);
const sess = { vendor: "준테크", key: ctx.prpVendorKey_("준테크"), prefix: "JT", aliases: [] };
check("검색 라벨에 업체명", ctx.prpVendorSearchLabels_(sess).indexOf("준테크") >= 0, true);
check("파일명 소속", ctx.prpFileBelongsTo_(sess, "", "[협력업체] 준테크"), true);
check("다른 업체 아님", ctx.prpFileBelongsTo_(sess, "", "[협력업체] 부엉이커피"), false);

console.log("\n[5] 조회는 발주 마감만 — 전용양식을 전수 열지 않는다");
check("발주 마감 탭을 연다", /발주 마감/.test(lookupSrc) && /prpRecentArchiveTabNames_/.test(lookupSrc), true);
check("발주 및 송장조회도 본다", /발주 및 송장조회/.test(lookupSrc), true);
check("전용양식 탭을 열지 않는다", /getSheetByName\([^\)]*전용양식/.test(lookupSrc), false);
check("파일명으로 고른다", /getFilesByName/.test(lookupSrc), true);
check("B5 전수 대조 없음", /getRange\("B5"\)/.test(lookupSrc), false);

console.log("\n[6] 접수·화면");
check("submit 이 uid 를 읽는다", /prpUidFromCell_\(data\.uid\)/.test(apiSrc), true);
check("고유ID 입력란", /id="nUid"/.test(portalSrc), true);

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
