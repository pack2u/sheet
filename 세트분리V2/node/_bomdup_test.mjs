/**
 * BOM 이 겹쳐 들어왔을 때 — 뚜껑이 세 개 나가지 않는가
 *
 *   > "세트메뉴에서 세트분리한거중에 몸통, 뚜껑 분리되고 뚜껑이 또
 *   >  분리가 되서 뚜껑이 3개가 나가는 상황이 벌어졌어...
 *   >  같은 제품 사람들만.. 특정품목 JHMINIJJIMB00002만 그런거 같아"
 *
 * 쪼개는 코드는 한 겹만 쪼갠다 — 되풀이해 쪼개는 길이 없다.
 * 그러니 셋이 나갔다면 BOM 자료에 그 줄이 여러 번 들어 있는 것이다.
 * 자료가 그래도 «물건은 제대로» 나가야 한다. 여기서 못 박는다.
 *
 * 실행: node node/_bomdup_test.mjs   (node/ 안에서 돌린다)
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../core.js");

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

const 세트 = "JHMINIJJIMB00002";
const 몸통 = "JHMINIJJIM-B";
const 뚜껑 = "JHMINIJJIM-L";

function 쪼개기(bomRows, 주문수량) {
  const warnings = [];
  const lines = [{
    순번: 1, 원본코드: 세트, 원본품목명: "JH 미니찜 세트",
    주문수량: 주문수량 === undefined ? 1 : 주문수량,
  }];
  const units = C.ssExplode(lines, { bom: { [세트]: bomRows }, splitExcept: {}, partnerItems: {} }, warnings);
  const 합 = {};
  for (const u of units) 합[u.품목코드] = (합[u.품목코드] || 0) + u.수량;
  return { 합, warnings, units };
}

/* ── [1] 제대로 된 BOM ──────────────────────────────────── */
console.log("\n[1] 멀쩡한 BOM");
{
  const r = 쪼개기([{ code: 몸통, qty: 1 }, { code: 뚜껑, qty: 1 }]);
  eq("몸통 1개", r.합[몸통], 1);
  eq("뚜껑 1개", r.합[뚜껑], 1);
  eq("경고 없음", r.warnings.length, 0);
}

/* ── [2] ★ 뚜껑 줄이 세 번 들어온 BOM ★ ────────────────── */
console.log("\n[2] 뚜껑 줄이 겹쳐 들어온 BOM");
{
  const r = 쪼개기([
    { code: 몸통, qty: 1 },
    { code: 뚜껑, qty: 1 },
    { code: 뚜껑, qty: 1 },
    { code: 뚜껑, qty: 1 },
  ]);
  //  ★ 겹친 줄은 «합친다» ★ 세 줄이 세 개로 나가면 안 된다… 가 아니라,
  //    합쳐서 3개가 된다. 숫자는 BOM 이 시킨 대로다.
  eq("뚜껑은 합쳐서 한 줄", r.units.filter((u) => u.품목코드 === 뚜껑).length, 1);
  eq("  합친 수량은 3", r.합[뚜껑], 3);
  //  ★ 그리고 «말한다» ★ 조용히 합치면 자료는 그대로 썩는다
  const w = r.warnings.filter((x) => x.code === "BOM_DUP");
  eq("★ 겹쳤다고 말한다", w.length, 1);
  eq("  등급은 오류", w[0].level, "오류");
  eq("  몇 줄 겹쳤는지 적는다", w[0].msg.indexOf("2줄 겹쳐") >= 0, true);
  eq("  어디서 보는지 알려 준다", w[0].msg.indexOf("BOM 진단") >= 0, true);
}

/* ── [3] ★ 자기 자신을 구성품으로 가진 BOM ★ ───────────── */
console.log("\n[3] 세트가 자기를 담고 있는 BOM");
{
  const r = 쪼개기([
    { code: 몸통, qty: 1 },
    { code: 뚜껑, qty: 1 },
    { code: 세트, qty: 1 },      // ← 자기 자신
  ]);
  //  두면 세트가 통째로 한 번 더 나간다 — 버린다
  eq("★ 자기 자신은 안 나간다", r.합[세트] === undefined, true);
  eq("몸통은 그대로 1", r.합[몸통], 1);
  eq("뚜껑은 그대로 1", r.합[뚜껑], 1);
  const w = r.warnings.filter((x) => x.code === "BOM_SELF");
  eq("★ 버렸다고 말한다", w.length, 1);
  eq("  등급은 오류", w[0].level, "오류");
}

/* ── [4] 주문 수량이 곱해지는가 ─────────────────────────── */
console.log("\n[4] 두 세트를 주문하면");
{
  const r = 쪼개기([{ code: 몸통, qty: 1 }, { code: 뚜껑, qty: 2 }], 2);
  eq("몸통 2개", r.합[몸통], 2);
  eq("뚜껑 4개", r.합[뚜껑], 4);
}

/* ── [5] 같은 코드가 여러 줄이어도 «한 줄로» 나간다 ────── */
console.log("\n[5] 창고가 집는 종이");
{
  const r = 쪼개기([
    { code: 뚜껑, qty: 1 },
    { code: 몸통, qty: 1 },
    { code: 뚜껑, qty: 1 },
  ]);
  //  같은 물건이 두 줄로 찍히면 창고가 두 번 집는다
  eq("★ 품목당 한 줄", r.units.length, 2);
  eq("  차례는 처음 나온 순서", r.units[0].품목코드, 뚜껑);
  eq("  라인ID 가 겹치지 않는다",
    new Set(r.units.map((u) => u.라인ID)).size, r.units.length);
}

console.log("");
console.log(fail ? "FAIL " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
