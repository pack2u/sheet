/**
 * 일일마감 — v2 가 실패해도 예전 시트 마감으로 안 넘어간다 · 소유권 점검은 파일 대신 v2 줄   (2026-10-28)
 * > 사장님: "남은 정리 두 가지도 해줘"
 *   node _dcv2_nofallback_test.js
 *
 * 진짜 파일 셋(_partnerDailyCloseV2 · _partnerWebApp · _partnerInvoiceOwnerDiag)을 불러 서비스만 가짜로 바꾼다.
 * _secrets 는 안 불러온다. 값은 지어냄.
 */
const fs = require("fs"), vm = require("vm");
let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok   " + label); } else { fail++; console.log("  FAIL " + label + "  ->  " + g + "   (기대: " + w + ")"); }
}

let 상황 = "v2";          // v2 · 시트 · 막힘(아무 것도 안 받음) · post실패
let 부름 = [], 옛마감 = 0, 파일찾기 = 0, 카드 = [], 적음 = [];
const 머리 = ["품목코드", "품목명", "수량", "전화", "모바일", "주소1", "합계", "거래처명", "세트구성및배송비", "단품배송비", "묶음배송비", "적요", "주문자명(사방넷)", "전화번호(사방넷)", "추가장문형식1", "택배사", "운송장번호", "출처"];
const 줄 = [["A1", "시험 품목", "1", "", "010-0000-0000", "시험시 1", "1,000", "시험가게", "", "", "", "", "홍길동/p1027000001", "", "", "로젠택배", "45200000001", "로젠"]];
function 답(code, body) { return { getResponseCode: () => code, getContentText: () => JSON.stringify(body) }; }

const ctx = {
  console, Logger: { log() {} }, JSON, Math, Date, String, Number, Object, Array, RegExp,
  UrlFetchApp: { fetch: (url, o) => {
    부름.push((o.method || "get") + " " + url.replace(/^https:\/\/[^/]+/, ""));
    if (상황 === "막힘") throw new Error("Address unavailable");
    if (o.method === "get") {
      if (/\?날=/.test(url)) return 답(200, { ok: true, 주인: 상황 === "시트" ? "시트" : "v2", 머리, 줄 });
      return 답(200, { ok: true, 주인: 상황 === "시트" ? "시트" : "v2" });
    }
    if (상황 === "post실패") return 답(500, { ok: false, error: "boom" });
    return 답(200, { ok: true });
  } },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({}), getUi: () => ui, flush() {} },
  Utilities: { formatDate: (d, tz, f) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, f === "HH:mm" ? undefined : 10) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
};
const ui = { ButtonSet: { OK: 1, OK_CANCEL: 2, YES_NO: 3 }, Button: { OK: "OK", YES: "YES" },
  alert: (t, m) => { 카드.push("창 " + t); }, prompt: () => ({ getSelectedButton: () => "OK", getResponseText: () => "" }) };
vm.createContext(ctx);
for (const f of ["_partnerDailyCloseV2.gs", "_partnerWebApp.gs", "_partnerInvoiceOwnerDiag.gs"]) {
  vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
}
//  곁의 것들은 가짜로 — 이 시험이 보는 것은 «어느 길로 가나» 하나다
vm.runInContext(`
  _psm_token_ = function () { return "t"; };
  _psm_v2url_ = function () { return "https://v2.test"; };
  triggerListSafe = function () {}; _pt_ensureMirrorTriggers_ = function () {}; _pil_refreshScheduled_ = function () {};
  _pt_isWeekendBlackout_ = function () { return false; }; _pt_isNonBusinessDate_ = function () { return false; };
  _pep_afterStart_ = function () { return true; };
  _UNIFIED_ARCHIVE_PREFIX_ = "일일마감_";
`, ctx);
ctx._chat_sendCard_ = (t) => 카드.push("챗 " + t);
ctx._pep_archiveUnifiedDaily_ = () => { 옛마감++; return { archived: 0, detail: {}, error: "그만" }; };
ctx._unified_findExistingArchiveSs_ = () => { 파일찾기++; return null; };
ctx._pep_appendArchiveRows_ = (ss, d, h, rows) => { 적음.push(d + ":" + rows.length); return { written: rows.length, skippedDup: 0 }; };
ctx._pep_mapArchiveMatchCols_ = (h) => ({ inv: h.indexOf("운송장번호"), src: h.indexOf("출처"), oid: -1, orderer: h.indexOf("주문자명(사방넷)"), name: h.indexOf("주문자명(사방넷)"), phone: h.indexOf("모바일"), item: h.indexOf("품목명") });
ctx._pep_splitInvNos_ = (v) => String(v || "").split(/[\r\n,;]+/).filter(Boolean);
function 처음() { 부름 = []; 옛마감 = 0; 파일찾기 = 0; 카드 = []; 적음 = []; }

console.log("[1] 주인 묻기 — 못 물으면 «모름» (시트라고 하지 않는다)");
상황 = "v2"; check("v2", ctx._dcv2_owner_(), "v2");
상황 = "시트"; check("시트", ctx._dcv2_owner_(), "시트");
상황 = "막힘"; check("막힘 → 모름", ctx._dcv2_owner_(), "모름");

console.log("[2] 20:00 — v2 가 잘 되면 v2 줄을 적고 끝");
처음(); 상황 = "v2"; ctx._pep_unifiedDailyArchiveScheduled_();
check("옛 마감 안 돎", 옛마감, 0);
check("v2 에 다시 만들게 했다", 부름.includes("post /api/setsplit/daily-close"), true);
check("오늘 줄을 적었다", 적음.length >= 1, true);
check("완료 챗", 카드.some((x) => /일일마감 완료 \(v2\)/.test(x)), true);

console.log("[3] 20:00 — v2 가 실패하면 알리고 멈춘다 (예전엔 시트 마감으로 넘어갔다)");
처음(); 상황 = "post실패"; ctx._pep_unifiedDailyArchiveScheduled_();
check("옛 마감 안 돎", 옛마감, 0);
check("실패 챗", 카드.some((x) => /일일마감 v2 실패 — 파일을 안 만들었습니다/.test(x)), true);
check("아무 것도 안 적음", 적음.length, 0);

console.log("[4] 20:00 — 주인을 못 물으면 건너뛴다 (예전엔 «시트»로 쳐서 옛 마감이 돌았다)");
처음(); 상황 = "막힘"; ctx._pep_unifiedDailyArchiveScheduled_();
check("옛 마감 안 돎", 옛마감, 0);
check("건너뜀 챗", 카드.some((x) => /v2 에 못 물어 오늘은 건너뜀/.test(x)), true);

console.log("[5] 20:00 — 스위치를 «시트»로 되돌리면 예전 마감이 돈다 (되돌림 길은 산다)");
처음(); 상황 = "시트"; try { ctx._pep_unifiedDailyArchiveScheduled_(); } catch (e) {}
check("옛 마감 돎", 옛마감, 1);

console.log("[6] 메뉴 — 주인이 v2 면 v2 로, 못 물으면 멈춤");
처음(); 상황 = "v2"; ctx.partnerUnifiedDailyArchiveManual();
check("수동: 옛 마감 안 돎 · v2 완료 창", [옛마감, 카드.some((x) => /완료 \(v2\)/.test(x))], [0, true]);
처음(); 상황 = "막힘"; ctx.partnerUnifiedDailyArchiveManual();
check("수동 막힘: 옛 마감 안 돎 · 못 물음 창", [옛마감, 카드.some((x) => /못 물었습니다/.test(x))], [0, true]);
처음(); 상황 = "v2"; ctx.partnerUnifiedDailyArchiveForDate();
check("재처리: 옛 마감 안 돎 · v2 에 일수 실어 post · 적음", [옛마감, 부름.filter((x) => /^post/.test(x)).length, 적음.length], [0, 1, 1]);

console.log("[7] 16:40 소유권 점검 — 주인이 v2 면 파일을 안 열고 v2 줄을 읽는다");
처음(); 상황 = "v2";
const reg = {}, stat = { notes: [], files: 0, archive: 0, marked: 0, skippedOld: 0, markCols: {} };
vm.runInContext("_iod_claim_ = function (reg, inv, o) { (reg[inv] = reg[inv] || []).push(o); };", ctx);
ctx._iod_collectArchives_(reg, 3, stat, Date.now());
check("파일 안 찾음", 파일찾기, 0);
check("날마다 v2 GET", 부름.filter((x) => /\?날=/.test(x)).length, 3);
check("송장을 등록 · 어디서=일일마감_날", [Object.keys(reg), /^일일마감_\d{4}-\d{2}-\d{2}$/.test(reg["45200000001"][0].where)], [["45200000001"], true]);
처음(); 상황 = "막힘";
const stat2 = { notes: [], files: 0, archive: 0, marked: 0, skippedOld: 0, markCols: {} };
ctx._iod_collectArchives_({}, 3, stat2, Date.now());
check("못 물으면 파일로 안 가고 적어 둔다", [파일찾기, /못 물어/.test(stat2.notes[0] || "")], [0, true]);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
