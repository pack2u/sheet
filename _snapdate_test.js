/**
 * 스냅샷 주문일 — 지나간 날짜를 «뒤로 밀지» 않는다
 *
 *  > "일일마감시 이전날의 송장번호를 찾아 기입을 하는데 오늘날짜 밑에
 *  >  어제 날짜 송장번호 찾은 내역을 붙여 넣었더라. 결국 오늘꺼에
 *  >  어제꺼가 기입되는... 어제꺼엔 모두 송장이 미매칭으로 남아있고"
 *
 *  ★ 왜 두 날이 동시에 틀리나 ★
 *    마감은 스냅샷의 «주문일»로 파일을 가른다. 아직 안 나간 주문은 다음 회차
 *    판매현황에도 딸려 오는데, 그때 이 자리가 날짜를 오늘로 덮어썼다.
 *      어제 주문 + 어제 송장  →  오늘 파일로 들어가고
 *      어제 파일             →  미매칭인 채로 남는다
 *    어느 쪽을 봐도 사실이 아니다.
 *
 *  ★ 그렇다고 아예 못 고치게 하면 안 된다 ★
 *    처음 담을 때 일자 칸을 못 찾으면 «오늘»로 적힌다. 나중에 진짜 주문일을
 *    알게 되면 그건 «더 이른» 날짜다. 앞당기는 것만 허락한다.
 *
 * 실행: node _snapdate_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

const SRC = fs.readFileSync("_partnerExclusivePush.gs", "utf8");

/*  함수가 다른 함수 «안»에 들어 있어 이름으로 못 뗀다. 소스에서 잘라 온다. */
const at = SRC.indexOf("function _pep_bumpSnapDate_(hit, newDate) {");
if (at < 0) { console.log("  FAIL _pep_bumpSnapDate_ 를 못 찾음"); process.exit(1); }
let d = 0, end = -1;
for (let i = SRC.indexOf("{", at); i < SRC.length; i++) {
  if (SRC[i] === "{") d++;
  else if (SRC[i] === "}") { d--; if (d === 0) { end = i + 1; break; } }
}
const 본문 = SRC.slice(at, end);

function 판() {
  const 쓴것 = [];
  const ctx = {
    result: {},
    snapTab: { getRange: (r, c) => ({ setValue: (v) => 쓴것.push({ r, c, v }) }) },
    String, console,
  };
  vm.createContext(ctx);
  vm.runInContext(본문, ctx);
  return { ctx, 쓴것 };
}

/* ── [1] 뒤로 밀지 않는다 ───────────────────────────────── */
console.log("\n[1] 어제 주문이 오늘 판매현황에 또 올라왔을 때");
{
  const { ctx, 쓴것 } = 판();
  const hit = { row: 5, date: "2026-09-16" };
  ctx._pep_bumpSnapDate_(hit, "2026-09-17");
  eq("★ 주문일이 그대로 어제다", hit.date, "2026-09-16");
  eq("★ 시트를 안 건드린다", 쓴것.length, 0);
  eq("★ 막았다고 «센다» (조용히 넘어가지 않는다)", ctx.result.dateHeldBack, 1);
}

/* ── [2] 앞당기는 것은 허락한다 ─────────────────────────── */
console.log("\n[2] 처음에 «오늘»로 잘못 적혔다가 진짜 주문일을 알게 됐을 때");
{
  const { ctx, 쓴것 } = 판();
  const hit = { row: 7, date: "2026-09-17" };
  ctx._pep_bumpSnapDate_(hit, "2026-09-15");
  eq("★ 더 이른 날짜로 고친다", hit.date, "2026-09-15");
  eq("  시트에도 쓴다", 쓴것.length, 1);
  eq("  1열(주문일)에", 쓴것[0].c, 1);
  eq("  그 줄에", 쓴것[0].r, 7);
  eq("  고쳤다고 센다", ctx.result.dateFixed, 1);
  eq("  막은 것은 없다", ctx.result.dateHeldBack, undefined);
}

/* ── [3] 같으면 아무것도 안 한다 ────────────────────────── */
console.log("\n[3] 날짜가 같을 때");
{
  const { ctx, 쓴것 } = 판();
  ctx._pep_bumpSnapDate_({ row: 3, date: "2026-09-17" }, "2026-09-17");
  eq("★ 쓰지 않는다", 쓴것.length, 0);
  eq("  세지도 않는다", ctx.result.dateFixed, undefined);
  eq("  막은 것으로도 안 센다", ctx.result.dateHeldBack, undefined);
}

/* ── [4] 처음 적히는 줄은 그대로 받는다 ─────────────────── */
console.log("\n[4] 아직 날짜가 없는 줄");
{
  const { ctx, 쓴것 } = 판();
  const hit = { row: 9, date: "" };
  ctx._pep_bumpSnapDate_(hit, "2026-09-17");
  eq("★ 빈 것은 채운다", hit.date, "2026-09-17");
  eq("  시트에도 쓴다", 쓴것.length, 1);
}

/* ── [5] 못 쓰는 줄은 건드리지 않는다 ───────────────────── */
console.log("\n[5] 줄 번호·날짜가 없을 때");
{
  const { ctx, 쓴것 } = 판();
  ctx._pep_bumpSnapDate_(null, "2026-09-17");
  ctx._pep_bumpSnapDate_({ row: 0, date: "2026-09-16" }, "2026-09-17");
  ctx._pep_bumpSnapDate_({ row: 5, date: "2026-09-16" }, "");
  eq("★ 아무것도 안 쓴다", 쓴것.length, 0);
}

/* ── [6] 해를 넘겨도 문자열 비교가 맞는가 ───────────────── */
console.log("\n[6] 해가 바뀔 때");
{
  const { ctx } = 판();
  const hit = { row: 2, date: "2026-12-31" };
  ctx._pep_bumpSnapDate_(hit, "2027-01-01");
  eq("★ 다음 해로도 안 민다", hit.date, "2026-12-31");
  const { ctx: c2 } = 판();
  const h2 = { row: 2, date: "2027-01-01" };
  c2._pep_bumpSnapDate_(h2, "2026-12-31");
  eq("★ 지난 해로 앞당기는 것은 된다", h2.date, "2026-12-31");
}

/* ── [7] 배선 ───────────────────────────────────────────── */
console.log("\n[7] 배선");
{
  ok("★ 막은 건수를 로그에 적는다", SRC.indexOf("★주문일뒤로밀기막음=") >= 0);
  ok("  마감 결과에도 싣는다", SRC.indexOf("result.detail.snapDateHeldBack = snapResult.dateHeldBack") >= 0);
  ok("★ 덮어쓰기 전에 «비교»한다", SRC.indexOf("if (지금 && newDate > 지금) {") >= 0);
  //  마감이 이 날짜로 파일을 가른다 — 그 배선이 그대로여야 이 고침이 뜻이 있다
  ok("★ 마감이 그 날짜로 파일을 가른다", SRC.indexOf("var rowDate = item.snapDate || archiveDate;") >= 0);
  ok("  스냅샷 1열에서 읽는다", SRC.indexOf("_pep_normSnapDate_(snapData[si][0], archiveDate)") >= 0);
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
