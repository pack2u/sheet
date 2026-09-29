/**
 * 물류 입고 ↔ CS · 반품포털 연동  (2026-09-29)
 *
 *  > "물류 반품 입고 시스템 … 반품포털·CS 연동으로 진행해줘"
 *
 *  지키는 것 넷
 *    ① 반품송장 칸을 «아무 번호로나» 덮지 않는다 — 뒤 4자리·이름으로 고른 건이
 *       대장의 진짜 반품송장을 「1234」로 바꾸던 것
 *    ② 물류 입고 사진 줄(현장입고 …)을 CS 카드도 사진으로 알아본다
 *    ③ 대장에 못 붙은 입고 사진이 「확인 대기」로 모인다 — 닫힌 줄·오래된 줄은 빠진다
 *    ④ CS 가 나중에 붙이면 촬영 때와 같은 길로 들어가고, 두 번 붙지 않는다
 *
 * 실행: node _cslpending_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const rd = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const OS = rd("csOrderSearch.gs");
function fn(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

// ── 가짜 시트 ──────────────────────────────────────────
function pad(n) { return String(n).padStart(2, "0"); }
function kst(d) { return new Date(d.getTime() + 9 * 3600000); }
function fmt(d, _tz, p) {
  const k = kst(d);
  return p.replace("yyyy", k.getUTCFullYear()).replace("MM", pad(k.getUTCMonth() + 1))
    .replace("dd", pad(k.getUTCDate())).replace("HH", pad(k.getUTCHours()))
    .replace("mm", pad(k.getUTCMinutes())).replace("ss", pad(k.getUTCSeconds()))
    .replace("yy", String(k.getUTCFullYear()).slice(2));
}
const now = new Date();
const ymd = (daysAgo) => fmt(new Date(now.getTime() - daysAgo * 86400000), "", "yyyy-MM-dd");
const thisTab = "입고_" + fmt(now, "", "yyyyMM");

function sheet(rows) {
  return {
    rows,
    getLastRow() { return rows.length; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getDisplayValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = rows[r - 1 + i] || [];
            const o = [];
            for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? "" : String(row[c - 1 + j]));
            out.push(o);
          }
          return out;
        },
        setValue(v) { rows[r - 1][c - 1] = v; },
        setValues(vs) { for (let i = 0; i < vs.length; i++) for (let j = 0; j < vs[i].length; j++) rows[r - 1 + i][c - 1 + j] = vs[i][j]; },
        setNumberFormat() {}
      };
    }
  };
}

const H = ["일시", "담당자", "신뢰도", "인식경로", "송장번호", "원문", "매칭탭", "매칭행", "수취인", "품목", "처리결과", "사진", "비고"];
const U1 = "https://x.supabase.co/storage/v1/object/sign/return-photos/a.jpg?token=1";
const U2 = "https://x.supabase.co/storage/v1/object/sign/return-photos/b.jpg?token=2";
const intake = sheet([
  H,
  [ymd(0) + " 10:00:00", "강물류", "미상", "ocr", "", "", "", "", "", "", "사진만 적재 (번호 미상)", U1 + "\n" + U2, ""],
  [ymd(1) + " 11:00:00", "강물류", "후보", "ocr", "255252851199", "", "", "", "", "", "사진만 적재 (확인 대기)", U1, "흔들림"],
  [ymd(0) + " 12:00:00", "강물류", "확정", "detector", "255252851162", "", "202609", 11, "김철동", "HR", "입고검수 처리 · 사진 1장", U1, ""],
  [ymd(0) + " 13:00:00", "강물류", "후보", "manual", "1234", "", "", "", "", "", "제외 · 흔들림 · CS 09-29 13:10", U1, ""],
  [ymd(0) + " 14:00:00", "강물류", "후보", "manual", "1234", "", "202609", 12, "이민동", "TY", "연동 실패: 잠김", U1, ""],
  [ymd(30) + " 09:00:00", "강물류", "미상", "ocr", "", "", "", "", "", "", "사진만 적재 (번호 미상)", U1, ""],
]);

//  반품대장 — A 상태 · B 이름 · C 원송장 · D 반품송장 · E 비고
const ledger = sheet([
  ["상태", "이름", "원송장", "반품송장", "비고"],
  ["회수중", "김민동", "4408-1289-1733", "", ""],
  ["회수중", "김철동", "4466-5170-4219", "2552-5285-1162", ""],
]);
const COL = { status: 0, name: 1, invoice: 2, returnInvoice: 3, notice: 4, item: -1 };

const log = { consult: [], status: [] };
let cachePut = 0;
const cache = {};
const ctx = {
  String, Number, RegExp, Math, JSON, Date, parseInt, console,
  _CS_RETURN_LEDGER_ID_: "L",
  Utilities: { formatDate: fmt },
  CacheService: { getScriptCache: () => ({
    get: (k) => cache[k] || null,
    put: (k, v) => { cache[k] = v; cachePut++; },
    remove: (k) => { delete cache[k]; }
  }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => (n === thisTab ? intake : null), insertSheet() {} }) },
  _cs_ac_guard_: () => null,
  _cs_openReturnLedgerRow_: (tab, row) => ({ tab: ledger, col: COL, rowNum: row, row: ledger.rows[row - 1].map(String) }),
  appendReturnConsultation: (p) => { log.consult.push(p); return { ok: true }; },
  updateReturnLedgerStatus: (p) => { log.status.push(p); return { ok: true }; },
};
vm.createContext(ctx);
vm.runInContext(rd("csLogistics.gs"), ctx);
vm.runInContext(rd("csReturnIntake.gs"), ctx);
vm.runInContext([
  fn(OS, "_cs_formatLedgerInvoice_"),
  fn(OS, "_cs_parseReturnInvFromNotice_"),
  fn(OS, "_cs_appendNoticeLine_"),
  fn(OS, "_cs_isPhotoLine_"),
].join("\n"), ctx);

// ── ① 반품송장 칸 ──────────────────────────────────────
console.log("\n[①] 반품송장 칸을 아무 번호로나 덮지 않는다");
ctx._cs_intakeExistingReturn_("202609", 3, "1234", "강물류", "manual", [U1]);
check("★ 뒤 4자리로 고른 건 — 진짜 반품송장이 남는다", ledger.rows[2][3], "2552-5285-1162");
check("이력에 「1234」를 송장처럼 적지 않는다", log.consult[0].text.indexOf("1234"), -1);
check("사진 줄 앞말은 「현장입고」", /^현장입고 스캔 · 사진 1장\shttps/.test(log.consult[0].text), true);

ctx._cs_intakeExistingReturn_("202609", 3, "", "강물류", "manual", [U1]);
check("★ 이름으로 고른 건(번호 없음) — 그대로", ledger.rows[2][3], "2552-5285-1162");

ctx._cs_intakeExistingReturn_("202609", 2, "440812891733", "강물류", "OCR → 원송장 일치", [U1]);
check("★ 원송장 번호는 반품송장 칸에 안 들어간다", ledger.rows[1][3], "");
check("원송장 일치라고 적는다", log.consult[2].text.indexOf("(원송장 일치)") > 0, true);

ctx._cs_intakeExistingReturn_("202609", 3, "255252859999", "강물류", "스캔", [U1]);
check("★ 이미 다른 번호가 있으면 덮지 않는다", ledger.rows[2][3], "2552-5285-1162");
check("다르다는 것은 이력에 남긴다", log.consult[3].text.indexOf("과 다름") > 0, true);

ctx._cs_intakeExistingReturn_("202609", 2, "255252851199", "강물류", "스캔", [U1]);
check("빈 칸에 온전한 번호는 적는다", ledger.rows[1][3], "2552-5285-1199");

ctx._cs_intakeExistingReturn_("202609", 2, "0504-1234-5678", "강물류", "스캔", []);
check("안심번호(0 으로 시작)는 안 적는다 — 이미 적힌 값 그대로", ledger.rows[1][3], "2552-5285-1199");

// ── ② CS 가 사진 줄로 알아본다 ─────────────────────────
console.log("\n[②] CS 카드 사진 줄 판정 — 포털과 같은 규칙");
check("현장입고 + 링크 → 사진", ctx._cs_isPhotoLine_("현장입고 스캔 · 사진 2장 " + U1), true);
check("사진 첨부 + 링크 → 사진", ctx._cs_isPhotoLine_("사진 첨부 1장. " + U1), true);
check("현장입고인데 링크 없음 → 사진 아님", ctx._cs_isPhotoLine_("현장입고 스캔 · 2552-5285-1162"), false);
check("상담 중 「현장입고」 언급 → 사진 아님", ctx._cs_isPhotoLine_("고객이 현장입고 됐냐고 물음"), false);
const P = rd("../Partner_WebApp/prpLedger.gs");
check("★ 포털도 같은 정규식을 쓴다",
  P.indexOf("/^(사진\\s*첨부|현장입고)/.test(body)") >= 0 &&
  OS.indexOf("/^(사진\\s*첨부|현장입고)/.test(s)") >= 0, true);

// ── ③ 확인 대기 목록 ──────────────────────────────────
console.log("\n[③] 확인 대기 — 못 붙은 줄만, 최근 14일만");
let pend = ctx.csLogisticsPending(true);
check("대기 건수 (미상 · 후보 · 연동 실패)", pend.count, 3);
check("닫힌 줄(입고검수·제외)과 30일 전 줄은 빠진다",
  pend.rows.map((r) => r.intakeRow).sort(), [2, 3, 6]);
check("최신이 위", pend.rows[0].intakeRow, 6);
check("사진 두 장을 나눠 싣는다", pend.rows.find((r) => r.intakeRow === 2).photos.length, 2);
check("캐시에 담는다", cachePut > 0, true);

// ── ④ 나중에 붙이기 ───────────────────────────────────
console.log("\n[④] CS 가 붙인다 — 촬영 때와 같은 길, 두 번은 안 된다");
log.consult = []; log.status = [];
let r = ctx.csLogisticsResolve({ intakeTab: thisTab, intakeRow: 2, action: "attach", tab: "202609", row: 2, staff: "박CS" });
check("붙었다", r.ok, true);
check("대장 이력에 사진 두 장", /사진 2장/.test(log.consult[0].text) && log.consult[0].text.indexOf(U2) > 0, true);
check("입고검수로 올린다", log.status[0].status, "입고검수");
check("이력 도장은 붙인 사람", log.consult[0].staff, "박CS");
check("입고대장 G·H 에 그 건", [intake.rows[1][6], intake.rows[1][7]], ["202609", 2]);
check("처리결과가 「입고검수 처리 … CS연결」", /^입고검수 처리 · 사진 2장 · CS연결 박CS/.test(intake.rows[1][10]), true);
check("캐시를 비웠다", cache["csl_pending_v1"] === undefined, true);

r = ctx.csLogisticsResolve({ intakeTab: thisTab, intakeRow: 2, action: "attach", tab: "202609", row: 3, staff: "최CS" });
check("★ 같은 사진을 또 붙이면 막는다", r.ok, false);
check("무엇 때문인지 말한다", /이미 처리된 사진/.test(r.error), true);
check("대장에 두 번 안 적었다", log.consult.length, 1);

r = ctx.csLogisticsResolve({ intakeTab: thisTab, intakeRow: 3, action: "dismiss", reason: "중복 촬영", staff: "박CS" });
check("제외", r.ok, true);
check("제외 까닭이 남는다", /^제외 · 중복 촬영 · 박CS/.test(intake.rows[2][10]), true);
check("사진 링크는 그대로", intake.rows[2][11], U1);

r = ctx.csLogisticsResolve({ intakeTab: "202609", intakeRow: 2, action: "dismiss" });
check("입고대장 아닌 탭은 안 받는다", r.ok, false);
r = ctx.csLogisticsResolve({ intakeTab: thisTab, intakeRow: 6, action: "attach", staff: "박CS" });
check("붙일 건을 안 고르면 안 받는다", r.ok, false);

pend = ctx.csLogisticsPending(true);
check("남은 대기는 연동 실패 한 건", pend.rows.map((x) => x.intakeRow), [6]);

// ── ⑤ 찍고 → 이름으로 찾고 → 골라 → 올리기 ─────────────
console.log("\n[⑤] 사진 먼저, 이름 검색 나중 — 사진이 안 날아가고, 라벨의 가린 이름도 쓴다");
const LG = rd("logistics.html");
const 검색 = fn(LG, "doSearch");
check("★ 사진이 있으면 PENDING 을 비우지 않는다",
  /if \(PENDING\.length\) \{/.test(검색) && 검색.indexOf("LAST.match = res") >= 0, true);
check("★ 인식 중에 찾아도 사진을 지킨다 (LAST 가 없으면 만든다)",
  검색.indexOf('if (!LAST) LAST = { raw: q, via: "검색"') >= 0, true);
check("★ 인식이 늦게 끝나도 찾아 둔 후보를 안 덮는다",
  fn(LG, "handleFiles").indexOf("if (LAST && LAST.searched)") >= 0, true);
check("인식 시간을 비고에 남긴다", LG.indexOf('"올리기까지 "') >= 0, true);
check("사진 아래 칸이 이름도 받는다 (글자면 doSearch)", /doSearch\(v, true\)/.test(LG), true);
const 저장 = fn(LG, "save");
check("★ 이름으로 찾아도 사진에서 읽은 번호를 보낸다", 저장.indexOf("LAST.match.digits || LAST.scanDigits") >= 0, true);
check("「김*동 1234」의 1234 를 송장으로 안 본다", 저장.indexOf("/^[\\d\\s-]+$/.test(mv)") >= 0, true);

const ctx2 = {
  String, Number, RegExp, Math, console,
  csParseCourierBarcode: () => ({ ok: false }),
  _cs_loadReturnLedgerCases_: () => [
    { tab: "202609", row: 10, name: "김민동", phone: "010-9948-1234", item: "AJ", status: "회수중", invDigits: "440812891733", returnInvDigits: "" },
    { tab: "202609", row: 11, name: "박철수", phone: "010-2222-1234", item: "HR", status: "접수", invDigits: "", returnInvDigits: "" },
  ],
};
vm.createContext(ctx2);
vm.runInContext(rd("csLogistics.gs"), ctx2);
let mm = ctx2.csLogisticsMatch("255252859999", { senderName: "김*동", senderPhone: "010-****-1234" });
check("★ 라벨 「김*동 · 뒤4 1234」 → 한 건", mm.matches.map((x) => x.name), ["김민동"]);
check("읽은 값이라 자동 처리는 안 한다", mm.tier, "maybe");
mm = ctx2.csLogisticsMatch("255252859999", { senderPhone: "010-****-1234" });
check("전화 뒤4 만이면 둘 다 후보", mm.matches.length, 2);
mm = ctx2.csLogisticsMatch("440812891733", { senderName: "김*동" });
check("번호로 찾았으면 이름은 안 섞는다", mm.matches.length, 1);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
