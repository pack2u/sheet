/**
 * 중복/더나간 발주 알림 — 같은 것을 날마다 다시 말하지 않는다
 *
 *  > "이건 며칠전껀데 계속뜨네"
 *
 *  ★ 왜 고쳐야 하나 ★
 *    같은 경고가 날마다 오면 사람은 그 카드를 안 읽게 된다. 그러면
 *    «다음에 진짜가 왔을 때»도 같이 흘려보낸다. 경고가 스스로를 죽인다.
 *
 *  ★ 그렇다고 지우면 안 된다 ★
 *    안 치운 건이 조용히 묻히면 그게 더 나쁘다.
 *    새것이 있을 때 「아직 안 치운 N건」을 한 줄 붙여 살려 둔다.
 *
 * 실행: node _dupseen_test.js
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

const SRC = fs.readFileSync("_partnerDupOrderCheck.gs", "utf8");
const has = (s) => SRC.indexOf(s) >= 0;

function fnFrom(name) {
  const at = SRC.indexOf("function " + name + "(");
  if (at < 0) throw new Error("못 찾음: " + name);
  let d = 0;
  const open = SRC.indexOf("{", at);
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === "{") d++;
    else if (SRC[i] === "}") { d--; if (d === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error("안 닫힘: " + name);
}

function 판(저장된, 저장실패) {
  const store = { v: 저장된 === undefined ? null : 저장된 };
  const ctx = {
    Logger: { log() {} },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = (n) => (n < 10 ? "0" : "") + n;
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => store.v,
        setProperty: (k, v) => {
          if (저장실패) throw new Error("Argument too large");
          store.v = v;
        },
      }),
    },
    _PDC_SEEN_PROP_: "_PDC_SEEN_V1",
    _PDC_SEEN_DAYS_: 30,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext([
    fnFrom("_pdc_loadSeen_"), fnFrom("_pdc_saveSeen_"), fnFrom("_pdc_splitNew_"),
  ].join("\n\n"), ctx);
  return { ctx, store };
}

const 오늘 = (() => {
  const d = new Date(), p = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
})();
const 며칠전 = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  const p = (x) => (x < 10 ? "0" : "") + x;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};

const 건 = (uid, 초과) => ({ vendor: "AJ", uid: uid, 초과: 초과, 실제: 6, 기대: 2, hits: [{ name: "이지원" }] });
const 열쇠 = (o) => "OVER|" + o.vendor + "|" + o.uid + "|" + o.초과;

/* ── [1] 처음 보는 건은 말한다 ──────────────────────────── */
console.log("\n[1] 처음 보는 건");
{
  const { ctx } = 판();
  const r = ctx._pdc_splitNew_([건("A", 4), 건("B", 1)], 열쇠, ctx._pdc_loadSeen_());
  eq("★ 둘 다 말한다", r.새것.length, 2);
  eq("  옛것은 없다", r.옛것, 0);
}

/* ── [2] 어제 말한 건은 다시 안 말한다 ──────────────────── */
console.log("\n[2] 어제 말한 건");
{
  const 저장 = {};
  저장[열쇠(건("A", 4))] = 며칠전(3);
  const { ctx } = 판(JSON.stringify(저장));
  const seen = ctx._pdc_loadSeen_();
  const r = ctx._pdc_splitNew_([건("A", 4), 건("B", 1)], 열쇠, seen);
  eq("★ 새것만 말한다", r.새것.length, 1);
  eq("  그것이 B 다", r.새것[0].uid, "B");
  eq("★ 옛것은 세기만 한다", r.옛것, 1);
}

/* ── [3] 더 나갔으면 «새 사실»이다 ──────────────────────── */
console.log("\n[3] 같은 주문인데 초과가 늘었을 때");
{
  const 저장 = {};
  저장[열쇠(건("A", 4))] = 며칠전(1);
  const { ctx } = 판(JSON.stringify(저장));
  const r = ctx._pdc_splitNew_([건("A", 6)], 열쇠, ctx._pdc_loadSeen_());
  eq("★ 4줄 → 6줄이면 다시 말한다", r.새것.length, 1);
  eq("  옛것으로 안 센다", r.옛것, 0);
}

/* ── [4] 오래된 것은 버린다 ─────────────────────────────── */
console.log("\n[4] 30일이 지나면");
{
  const 저장 = {};
  저장["OVER|AJ|옛것|1"] = 며칠전(40);
  저장["OVER|AJ|최근|1"] = 며칠전(5);
  const { ctx, store } = 판(JSON.stringify(저장));
  const 남은 = ctx._pdc_saveSeen_(ctx._pdc_loadSeen_());
  eq("★ 40일 전 것은 버린다", 남은, 1);
  const 다시 = JSON.parse(store.v);
  ok("  최근 것만 남는다", 다시["OVER|AJ|최근|1"] && !다시["OVER|AJ|옛것|1"]);
}
{
  //  버려진 뒤에는 다시 한 번 말한다 — 영영 묻히지 않게
  const 저장 = {};
  저장[열쇠(건("A", 4))] = 며칠전(40);
  const { ctx } = 판(JSON.stringify(저장));
  const seen = ctx._pdc_loadSeen_();
  ctx._pdc_saveSeen_(seen);                    // 여기서 버려진다
  const 다시판 = 판(JSON.stringify({}));
  const r = 다시판.ctx._pdc_splitNew_([건("A", 4)], 열쇠, 다시판.ctx._pdc_loadSeen_());
  eq("★ 30일 뒤에는 다시 말한다", r.새것.length, 1);
}

/* ── [5] 못 읽거나 못 써도 «알림은 돌아야» 한다 ─────────── */
console.log("\n[5] 저장이 막혔을 때");
{
  const { ctx } = 판("{깨진 JSON");
  eq("★ 못 읽으면 빈 목록으로 본다", Object.keys(ctx._pdc_loadSeen_()).length, 0);
  const r = ctx._pdc_splitNew_([건("A", 4)], 열쇠, ctx._pdc_loadSeen_());
  eq("  그래도 말은 한다 (조용해지지 않는다)", r.새것.length, 1);
}
{
  const { ctx } = 판(JSON.stringify({}), true);   // setProperty 가 던진다
  let 터짐 = "";
  try { ctx._pdc_saveSeen_({ "X": 오늘 }); } catch (e) { 터짐 = String(e.message || e); }
  eq("★ 저장이 실패해도 안 터진다", 터짐, "");
}

/* ── [6] 열쇠를 못 만들면 «말한다» ──────────────────────── */
console.log("\n[6] 열쇠를 못 만들 때");
{
  const { ctx } = 판(JSON.stringify({}));
  const r = ctx._pdc_splitNew_([건("A", 4)], function () { return ""; }, ctx._pdc_loadSeen_());
  eq("★ 모르면 조용히 넘기지 않고 말한다", r.새것.length, 1);
}

/* ── [7] 배선 ───────────────────────────────────────────── */
console.log("\n[7] 배선 — 알림이 그것을 쓰는가");
{
  ok("★ 더 나간 발주에 건다", has('return "OVER|" + o.vendor + "|" + o.uid + "|" + o.초과;'));
  ok("★ 중복 의심에도 건다", has('return "DUP|" + s.key + "|"'));
  ok("★ 새것이 없으면 카드를 안 띄운다", has("if (갈림.새것.length) {"));
  ok("★ 안 치운 옛 건을 한 줄로 살려 둔다",
    has('"(전에 알린 뒤 아직 안 치운 건 " + 갈림.옛것 + "건이 더 있습니다)"'));
  ok("  중복 의심 쪽도 같이", has('"(전에 알린 뒤 아직 안 치운 건 " + 의심갈림.옛것 + "건이 더 있습니다)"'));
  ok("★ 끝에 한 번만 저장한다", has("var 남은 = _pdc_saveSeen_(seen);"));

  //  메뉴 점검은 «전부» 보여 줘야 한다 — 거기까지 조용해지면 확인할 길이 없어진다
  const m = SRC.indexOf("function partnerCheckDuplicateOrders");
  const 몸통 = m >= 0 ? SRC.substring(m, m + 3000) : "";
  ok("★ 메뉴 점검은 안 걸렀다 (전부 보여 준다)",
    m >= 0 && 몸통.indexOf("_pdc_splitNew_") < 0);
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
