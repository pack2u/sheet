/**
 * 커뮤니티 보드 — 누르는 즉시 바뀌는가 (낙관적 갱신)
 *
 *  > "CS웹앱이 V2도 그렇고 글쓰고 등록, 이미지 등록, 처리완료시에도
 *  >  보면 버벅거리는 느낌이 강한데.. 바로바로 반응할수 있게 하는 방법이 없을까?"
 *  > "커뮤니티보드도 버벅이던데?"
 *
 *  ★ google.script.run 한 번이 1~3초다 ★
 *    Apps Script 웹앱의 천장이라 왕복 «횟수»를 줄여도 그 기다림은 안 없어진다.
 *    그래서 기다리지 않는다 — 화면을 먼저 바꾸고 서버는 뒤에서.
 *
 *  ★ 지켜야 할 것 ★
 *    · 실패하면 «반드시» 되돌린다. 조용히 넘어가면 화면과 시트가 어긋난다
 *    · 되돌린 뒤에는 되돌렸다고 «말한다»
 *    · 두 번 눌러 두 번 나가지 않는다 (자물쇠)
 *    · 되돌릴 수 없는 일(사진 올리기)에는 안 쓴다
 *
 * 실행: node _csoptimistic_test.js
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

const HTML = fs.readFileSync("home.html", "utf8");
const has = (s) => HTML.indexOf(s) >= 0;

function grabFn(name) {
  const i = HTML.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < HTML.length; k++) {
    if (HTML[k] === "{") { d++; seen = true; }
    else if (HTML[k] === "}") { d--; if (seen && d === 0) return HTML.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

function 판(카드들) {
  const 그린것 = [];
  const 말한것 = [];
  const ctx = {
    HB_CARDS: 카드들,
    LB_CARDS: [],
    HB_INFLIGHT: {},
    renderHandoffBoard: () => 그린것.push("hb"),
    lbRenderCards: () => 그린것.push("lb"),
    hbRenderCardModal: () => {},
    hbToCardFill: () => {},
    hbApplyCard: (c) => { ctx.적용된 = c; return true; },
    hbReloadBoards: () => 그린것.push("전체"),
    toast: (m) => 말한것.push(String(m)),
    JSON, Object, console,
  };
  vm.createContext(ctx);
  vm.runInContext([grabFn("hbLocateCard"), grabFn("hbRenderOne"), grabFn("hbOptimistic")].join("\n\n"), ctx);
  return { ctx, 그린것, 말한것 };
}

const 카드 = (id, t) => ({ id: id, title: t || "제목", status: "진행", notes: [] });

/* ── [1] 누르는 즉시 바뀐다 ─────────────────────────────── */
console.log("\n[1] 서버를 기다리지 않는다");
{
  const { ctx, 그린것 } = 판([카드("A"), 카드("B")]);
  let 보냈나 = false;
  const r = ctx.hbOptimistic("A",
    (c) => { c.title = "바뀐 제목"; return c; },
    () => { 보냈나 = true; });          // 성공/실패를 «안» 부른다 = 아직 서버가 안 돌아옴
  eq("★ 낙관적으로 처리했다", r, true);
  eq("★ 서버가 돌아오기 «전»에 이미 바뀌었다", ctx.HB_CARDS[0].title, "바뀐 제목");
  eq("★ 그 자리에서 그렸다", 그린것.join(","), "hb");
  eq("  서버로 보내긴 했다", 보냈나, true);
}

/* ── [2] 실패하면 되돌린다 ──────────────────────────────── */
console.log("\n[2] 실패했을 때");
{
  const { ctx, 말한것 } = 판([카드("A", "원래 제목")]);
  ctx.hbOptimistic("A",
    (c) => { c.title = "바뀐 제목"; return c; },
    (성공, 실패) => { 실패("통신 실패"); });
  eq("★ 원래대로 돌아왔다", ctx.HB_CARDS[0].title, "원래 제목");
  ok("★ 되돌렸다고 «말한다»", 말한것.join(" ").indexOf("되돌렸습니다") >= 0);
  ok("  왜인지도 말한다", 말한것.join(" ").indexOf("통신 실패") >= 0);
  eq("★ 자물쇠를 푼다", Object.keys(ctx.HB_INFLIGHT).length, 0);
}

/* ── [3] 성공하면 «진짜» 카드로 맞춘다 ──────────────────── */
console.log("\n[3] 성공했을 때");
{
  const { ctx } = 판([카드("A")]);
  ctx.hbOptimistic("A",
    (c) => { c.title = "임시"; return c; },
    (성공) => { 성공({ ok: true, card: { id: "A", title: "서버가 준 제목" } }); });
  ok("★ 서버 카드로 갈아 끼운다", ctx.적용된 && ctx.적용된.title === "서버가 준 제목");
  eq("  자물쇠를 푼다", Object.keys(ctx.HB_INFLIGHT).length, 0);
}

/* ── [4] 두 번 눌러도 두 번 안 나간다 ───────────────────── */
console.log("\n[4] 연달아 눌렀을 때");
{
  const { ctx, 말한것 } = 판([카드("A")]);
  let 보낸횟수 = 0;
  const 보내기 = () => { 보낸횟수++; };        // 아직 안 돌아옴
  ctx.hbOptimistic("A", (c) => c, 보내기);
  ctx.hbOptimistic("A", (c) => c, 보내기);
  eq("★ 한 번만 나간다", 보낸횟수, 1);
  ok("★ 두 번째는 말해 준다", 말한것.join(" ").indexOf("보내는 중") >= 0);
}

/* ── [5] 완료는 보드에서 «내려간다» ─────────────────────── */
console.log("\n[5] 처리 완료");
{
  const { ctx } = 판([카드("A"), 카드("B")]);
  ctx.hbOptimistic("A", () => "삭제", (성공) => { 성공({ ok: true }); });
  eq("★ 즉시 목록에서 빠진다", ctx.HB_CARDS.length, 1);
  eq("  남은 것은 B", ctx.HB_CARDS[0].id, "B");
}
{
  //  실패하면 도로 넣는다 — «없어진 채로 남는» 것이 제일 나쁘다
  const { ctx, 그린것, 말한것 } = 판([카드("A"), 카드("B")]);
  ctx.hbOptimistic("A", () => "삭제", (성공, 실패) => { 실패("완료 처리 실패"); });
  eq("★ 빠졌던 카드가 돌아온다", ctx.HB_CARDS.length, 2);
  ok("  그 카드가 A 다", ctx.HB_CARDS.some((c) => c.id === "A"));
  ok("★ 전체도 다시 받는다 (자리를 못 믿는다)", 그린것.indexOf("전체") >= 0);
  ok("  되돌렸다고 말한다", 말한것.join(" ").indexOf("되돌렸습니다") >= 0);
}

/* ── [6] 못 찾으면 옛 길로 ──────────────────────────────── */
console.log("\n[6] 카드를 못 찾을 때");
{
  const { ctx } = 판([카드("A")]);
  let 보냈나 = false;
  const r = ctx.hbOptimistic("없는ID", (c) => c, () => { 보냈나 = true; });
  eq("★ false 를 돌려준다 (부르는 쪽이 옛 길로)", r, false);
  eq("  제멋대로 보내지 않는다", 보냈나, false);
}
{
  //  바꿀 것이 없으면 손대지 않는다
  const { ctx } = 판([카드("A")]);
  const r = ctx.hbOptimistic("A", () => null, () => {});
  eq("★ 바꾸기가 null 이면 false", r, false);
  eq("  자물쇠도 안 건다", Object.keys(ctx.HB_INFLIGHT).length, 0);
}

/* ── [7] 배선 ───────────────────────────────────────────── */
console.log("\n[7] 배선 — 실제로 쓰이는가");
{
  ok("★ 완료가 낙관적으로 돈다", has("var 됐나 = hbOptimistic(id,"));
  ok("★ 완료는 목록에서 뺀다", has("function () { return '삭제'; },"));
  ok("★ 글도 즉시 붙는다", has("보내는중: true"));
  ok("  칸을 먼저 비운다", has("풀기();                       // 칸을 먼저 비운다"));
  ok("★ 첨부가 있으면 미리 안 붙인다", has("if (!pend.length) {"));
  ok("★ 글이 실패하면 치우고 내용을 돌려준다",
    has("if (ta && !ta.value) ta.value = text;") && has("올리지 못했습니다 — 되돌렸습니다"));

  //  ㉡ — 누를 때마다 뒤따라 돌던 재조회
  ok("★ hbReloadSoon 을 더는 안 부른다", HTML.indexOf("hbReloadSoon();") < 0);
  ok("★ 전달 추가가 보드를 통째로 안 받는다",
    has("if (!hbApplyCard(res && res.card)) hbReloadBoards();"));
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
