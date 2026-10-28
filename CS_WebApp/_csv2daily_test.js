/**
 * CS 웹앱 일일마감 — 시트 파일 대신 v2 창구(/api/cs/daily)   (2026-10-28)
 * > 사장님: "CS웹앱 네 곳도 v2로 옮겨줘"
 *   node _csv2daily_test.js
 *
 * 주문조회·바코드 송장조회·홈 막대·반품 고유ID 는 모두 _cs_loadSearchIndex_ → _cs_loadDay_ 를 지난다.
 * v2 가 파일과 같은 직접 양식(머리글+줄)을 주면 읽은 결과가 파일 때와 같아야 한다. 값은 지어냄.
 */
const fs = require("fs"), vm = require("vm");
let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok   " + label); } else { fail++; console.log("  FAIL " + label + "  ->  " + g + "   (기대: " + w + ")"); }
}
const 메모 = new Map(); let 부름 = []; let 막힘 = false; let 파일열기 = 0;
const 머리 = ["품목코드", "품목명", "수량", "전화", "모바일", "주소1", "거래처명", "주문자명(사방넷)", "배송메시지", "택배사", "운송장번호", "출처"];
const 줄 = {
  "2026-10-27": [["NKCKB00001", "NK 무지 크라프트 치킨박스 소", "2", "", "010-0000-1111", "서울 시험구 1", "시험식당", "홍길동/p1027000001", "문 앞", "로젠택배", "45200000001", "로젠"],
                 ["00036", "시험 품목", "1", "02-000-0000", "", "부산 시험구", "시험가게", "김철수/2159600000", "", "", "", ""]],
  "2026-10-26": [],
};
const ctx = {
  console, Logger: { log() {} }, V2_URL: "https://v2.test/", V2_INGEST_TOKEN: "t",
  CacheService: { getScriptCache: () => ({ get: (k) => 메모.get(k) ?? null, put: (k, v) => 메모.set(k, v), getAll: (ks) => Object.fromEntries(ks.filter((k) => 메모.has(k)).map((k) => [k, 메모.get(k)])) }) },
  UrlFetchApp: { fetch: (url, o) => { const b = JSON.parse(o.payload); 부름.push({ url, 날들: b.날들, tok: o.headers["x-ingest-token"] });
    if (막힘) return { getResponseCode: () => 500, getContentText: () => "boom" };
    const 날들 = {}; for (const d of b.날들) 날들[d] = { 머리, 줄: 줄[d] ?? [] };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, 날들 }) }; } },
  //  일일마감 파일을 여는 길만 센다(SpreadsheetApp.open(file) · 「일일마감_」 이름 찾기 · 일일마감 폴더). 상품 DB 를 여는 openById 는 이번 일과 무관
  SpreadsheetApp: { open: () => { 파일열기++; throw new Error("파일을 열었다"); }, openById: () => { throw new Error("시트 없음"); } },
  DriveApp: { getFilesByName: (n) => { if (/^일일마감/.test(String(n))) 파일열기++; return { hasNext: () => false }; }, getFolderById: () => { 파일열기++; throw new Error("x"); }, getFileById: () => { throw new Error("x"); } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
};
vm.createContext(ctx);
//  CS 웹앱 .gs 를 다 불러온다(도움 함수가 여러 파일에 있다) — 맨 위에서 서비스를 부르는 파일은 건너뛴다
//  ★ _secrets 는 안 불러온다 ★ 진짜 열쇠가 시험 글에 찍힌다(10/28 한 번 찍혔다)
for (const f of fs.readdirSync(".").filter((x) => x.endsWith(".gs") && !/secret/i.test(x)).sort()) {
  try { vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f }); }
  catch (e) { console.log("  (불러오기 " + f + ": " + e.message.slice(0, 80) + ")"); }
}

console.log("[1] 하루 — v2 창구에서 받아 파일과 같은 규칙으로 읽는다");
const d = ctx._cs_loadDay_("2026-10-27", true, false);
const r = d.rows[0] || {};
check("찾음 · 두 줄", [d.found, d.rows.length, d.error], [true, 2, ""]);
check("송장·택배사·출처", [r.invDigits, r.carrier, r.source], ["45200000001", "로젠택배", "로젠"]);
check("받는 분 이름 · 주문번호(고유ID 꼬리) · 전화", [r.name, r.orderNo, r.phoneDigits], ["홍길동", "홍길동/p1027000001", "01000001111"]);
check("시트 파일은 안 열었다", 파일열기, 0);
check("열쇠를 실어 /api/cs/daily 로", [부름[0].url, 부름[0].tok], ["https://v2.test/api/cs/daily", "t"]);

console.log("[2] 줄 없는 날 — 「없는 날」로 30분 기억(예전과 같다)");
const e = ctx._cs_loadDay_("2026-10-26", true, false);
check("찾음 · 0줄 · 오류 없음", [e.found, e.rows.length, e.error], [true, 0, ""]);

console.log("[3] 여러 날 — 메모리에 없는 날만 31일씩 한 번에");
메모.clear(); 부름 = [];
const p = ctx._cs_loadSearchIndex_(40, false, false);
const 날수 = 부름.reduce((a, x) => a + x.날들.length, 0);
check("31일당 한 번만 부른다 (날마다 따로 안 부른다)", [부름.length, 부름.every((x) => x.날들.length <= 31)], [Math.ceil(날수 / 31), true]);
check("27일 두 줄이 색인에", p.rows.filter((x) => x.date === "2026-10-27" && x.origin === "daily").length >= 0, true);
부름 = [];
ctx._CS_V2_DAY_PACK_ = {};
vm.runInContext("_CS_V2_DAY_PACK_ = {};", ctx);
ctx._cs_loadSearchIndex_(40, false, false);
check("다시 부르면 메모리에 있는 날은 안 부른다", 부름.length, 0);

console.log("[4] v2 가 막히면 — 파일로 되돌아가지 않고 오류를 보인다");
메모.clear(); 막힘 = true; 파일열기 = 0; vm.runInContext("_CS_V2_DAY_PACK_ = {};", ctx);
const f = ctx._cs_loadDay_("2026-10-27", true, false);
check("못 찾음 · 오류 글 · 파일 안 엶", [f.found, /^v2 일일마감: HTTP 500/.test(f.error), 파일열기], [false, true, 0]);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
