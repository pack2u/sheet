/**
 * v2 입고 → 반품관리대장 다리 (csIntakeBridge.gs)  2026-09-29
 *
 *  지키는 것
 *    ① v2 가 말한 줄이 맞을 때만 쓴다 (이름 + 원송장/반품송장/전화뒤4)
 *    ② 줄이 밀렸으면 같은 탭에서 다시 찾는다. 한 줄로 안 좁혀지면 안 쓴다 → 확인 대기
 *    ③ 이미 쓴 입고(v2:<id>)는 다시 안 쓴다
 *    ④ 대장 쓰기가 실패하면 ok:false 로 돌려 v2 가 다시 주게 한다
 *
 * 실행: node _cib_test.js
 */
const fs = require("fs"), vm = require("vm");
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) + (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

//  대장 탭 202609 — 1행 머리글. col: A 상태 · B 이름 · C 전화 · D 원송장 · E 반품송장
const COL = { status: 0, name: 1, phone: 2, invoice: 3, returnInvoice: 4, notice: 5, item: -1 };
const ledger = [
  ["상태", "이름", "전화", "원송장", "반품송장", "비고"],
  ["회수중", "김민동", "010-9948-1234", "4408-1289-1733", "", ""],
  ["회수중", "박철수", "010-2222-5678", "4466-5170-4219", "", ""],
  ["회수중", "김민동", "010-7777-0000", "4000-0000-0001", "", ""],   // 동명이인
];
function sheet(rows) {
  return {
    getLastRow: () => rows.length, getLastColumn: () => rows[0].length,
    getRange: (r, c, nr, nc) => ({
      getDisplayValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map((x) => x.slice(c - 1, c - 1 + (nc || 1)).map(String)),
      setNumberFormat() {},
      setValue: (v) => { rows[r - 1][c - 1] = v; },
    }),
    appendRow: (a) => rows.push(a),
    getMaxColumns: () => 26,
  };
}
const L = sheet(ledger);
const intakeRows = [["일시", "담당자", "신뢰도", "인식경로", "송장번호", "원문", "매칭탭", "매칭행", "수취인", "품목", "처리결과", "사진", "비고"]];
const I = sheet(intakeRows);

const calls = [];
let failWrite = false;
const ctx = {
  String, Number, RegExp, Math, JSON, Date, parseInt, console,
  _CS_RETURN_LEDGER_ID_: "L", _CS_RI_STATUS_INTAKE_: "입고검수",
  Logger: { log() {} },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => (n.indexOf("입고_") === 0 ? I : null) }) },
  _csl_recentIntakeTabNames_: () => ["입고_202609"],
  _csl_ensureIntakeTab_: () => I,
  _cs_openReturnLedgerRow_: (tab, row) => ({ tab: L, col: COL, row: (ledger[row - 1] || []).map(String) }),
  _cs_intakeExistingReturn_: (tab, row, inv, staff, via, photos) => {
    calls.push({ tab, row, inv, staff, via, n: photos.length });
    return failWrite ? { ok: false, error: "잠김" } : { ok: true, name: ledger[row - 1][1], item: "" };
  },
  appendReturnConsultation: (p) => { calls.push({ memo: p.text }); return { ok: true }; },
  //  글자 인식 (2026-09-30) — 사진을 받아 Gemini 로 읽는 자리
  UrlFetchApp: { fetch: (u) => ({ getResponseCode: () => (/bad/.test(u) ? 404 : 200), getBlob: () => ({ getBytes: () => [1, 2, 3], getContentType: () => "image/jpeg" }) }) },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 19).replace("T", " "), base64Encode: () => "AAA" },
  csOcrImageForScan: () => ocrReply,
};
let ocrReply = { ok: true, invoice: "45244704050", fields: { returnInvoiceNumber: "45244704050", originalInvoiceNumber: "45209772915", senderName: "김병수", senderPhone: "010-8709-3916", itemName: "JH/BF 감자탕 공용", orderNumber: "" } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("csIntakeBridge.gs", "utf8"), ctx);
{ //  csLogistics.gs 의 글자인식 도우미만 떼어 온다
  const L = fs.readFileSync("csLogistics.gs", "utf8");
  const a = L.indexOf("function _csl_ocrPack_("), b = L.indexOf("/** 읽을 칸 수", a);
  vm.runInContext(L.slice(a, b), ctx);
}

const ret = (o) => Object.assign({ src_tab: "202609", src_row: 2, customer_name: "김민동", phone: "01099481234", order_invoice: "440812891733", return_invoice: "" }, o);
const item = (id, o) => Object.assign({ id: id, at: "2026-09-29T02:00:00Z", staff: "강물류", tier: "maybe", via: "scan", invoice: "255252859999", photos: ["https://x/a.jpg"], memo: "", ret: ret() }, o);

console.log("\n[①] 맞는 줄이면 그대로 쓴다");
check("같다 (이름 + 원송장)", ctx._cib_same_(COL, ledger[1], ret()), true);
check("이름만 같은 동명이인은 아니다", ctx._cib_same_(COL, ledger[3], ret()), false);
check("이름이 다르면 아니다", ctx._cib_same_(COL, ledger[2], ret()), false);
let applied = {};
let r = ctx._cib_apply_(item("11111111-1111-1111-1111-111111111111"), applied);
check("ok", r.ok, true);
check("그 줄(2행)에 썼다", [calls[0].tab, calls[0].row], ["202609", 2]);
check("읽은 송장을 넘긴다 (빈 반품송장 칸 채우기용)", calls[0].inv, "255252859999");
check("입고대장에 한 줄 + v2 표시", /v2:11111111/.test(intakeRows[1][12]), true);
check("처리결과", /^입고검수 처리 · 사진 1장 · v2$/.test(intakeRows[1][10]), true);

console.log("\n[②] 줄이 밀렸으면 다시 찾는다 · 못 좁히면 안 쓴다");
calls.length = 0;
r = ctx._cib_apply_(item("22222222-2222-2222-2222-222222222222", { ret: ret({ src_row: 3 }) }), applied); // 3행은 박철수
check("밀린 줄 → 2행을 다시 찾아 쓴다", calls[0] && calls[0].row, 2);
check("밀렸다고 적는다", /행 밀림/.test(r.note), true);
calls.length = 0;
r = ctx._cib_apply_(item("33333333-3333-3333-3333-333333333333", { ret: ret({ src_row: 9, order_invoice: "", phone: "" }) }), applied);
check("★ 가릴 근거가 없으면 안 쓴다", calls.length, 0);
check("확인 대기로 보낸다 (사진만 적재)", /^사진만 적재 \(확인 대기\)/.test(intakeRows[intakeRows.length - 1][10]), true);
r = ctx._cib_apply_(item("44444444-4444-4444-4444-444444444444", { ret: null, tier: "none" }), applied);
check("반품 건 미지정도 확인 대기", /반품 건 미지정/.test(r.note), true);

console.log("\n[③] 두 번 쓰지 않는다");
calls.length = 0;
const again = ctx._cib_appliedIds_();
check("비고에서 이미 쓴 id 를 읽는다", !!again["11111111-1111-1111-1111-111111111111"], true);
r = ctx._cib_apply_(item("11111111-1111-1111-1111-111111111111"), again);
check("다시 온 것은 안 쓴다", calls.length, 0);
check("그래도 ok (v2 가 done 으로 닫게)", r.ok, true);

console.log("\n[④] 대장 쓰기 실패 → ok:false (v2 가 다시 준다)");
failWrite = true;
const before = intakeRows.length;
r = ctx._cib_apply_(item("55555555-5555-5555-5555-555555555555"), {});
check("ok:false", r.ok, false);
check("입고대장에 줄을 남기지 않는다 (다시 올 것이라)", intakeRows.length, before);

console.log("\n[⑤] 올라온 사진에서 라벨 글자를 읽어 입고대장에 남긴다");
failWrite = false;
r = ctx._cib_apply_(item("66666666-6666-6666-6666-666666666666", { ret: null, tier: "none" }), {});
const last = intakeRows[intakeRows.length - 1];
check("F(원문)에 사람이 읽는 한 줄", last[5], "송장 45244704050 · 원송장 45209772915 · 보낸분 김병수 010-8709-3916 · 품명 JH/BF 감자탕 공용");
check("N(글자인식)에 JSON — 원송장", JSON.parse(last[13]).orig, "45209772915");
check("글자 인식이 실패해도 입고는 간다", (ocrReply = null, ctx._cib_apply_(item("77777777-7777-7777-7777-777777777777", { ret: null, photos: ["https://x/bad.jpg"] }), {}).ok), true);
check("실패 까닭을 남긴다", JSON.parse(intakeRows[intakeRows.length - 1][13]).error, "사진을 못 받음 HTTP 404");

console.log("\n[⑥] 확인 대기 줄의 빠진 글자를 채운다 (한가할 때 두 건씩)");
ocrReply = { ok: true, invoice: "45272060050", fields: { returnInvoiceNumber: "45272060050", senderName: "조*옥", senderPhone: "010-4860-****" } };
intakeRows.push(["2026-09-30 00:09:00", "김윤동", "미상", "v2/search", "", "", "", "", "", "", "사진만 적재 (확인 대기)", "https://x/c.jpg", "", ""]);
intakeRows.push(["2026-09-30 00:10:00", "강물류", "미상", "detector", "45272060050", "45272060050", "", "", "", "", "사진만 적재 (대장에 없음)", "https://x/d.jpg", "", ""]);
const nFill = (ctx._csl_isPendingRow_ = (r) => /^사진만 적재/.test(String(r[10])) && !String(r[6]), ctx._csl_readRows_ = (tab, from, n) => intakeRows.slice(from - 1, from - 1 + n).map((r) => { const x = r.slice(); while (x.length < 14) x.push(""); return x; }), ctx._csl_dropPendingCache_ = () => {}, ctx._CSL_HEADERS_ = new Array(14), ctx._cib_backfillOcr_(2));
check("두 건 채웠다", nFill, 2);
check("빈 F 는 사람이 읽는 줄로", intakeRows[intakeRows.length - 2][5], "송장 45272060050 · 보낸분 조*옥 010-4860-****");
check("바코드 원문이 있는 F 는 안 건드린다", intakeRows[intakeRows.length - 1][5], "45272060050");
check("N 은 채운다", JSON.parse(intakeRows[intakeRows.length - 1][13]).sender, "조*옥");

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
