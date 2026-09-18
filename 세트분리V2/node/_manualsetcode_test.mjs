/**
 * 세트가 쪼개진 주문에 «수동조치 코드»가 걸릴 때
 *
 *   > "세트메뉴에서 세트분리한거중에 몸통, 뚜껑 분리되고 뚜껑이 또
 *   >  분리가 되서 뚜껑이 3개가 나가는 상황이 벌어졌어"
 *   > "내가 보기에 뚜껑만이 세트분리되고 또한번 되었어..
 *   >  그러다보니 1개가 2개가 된거야"
 *
 * 2026-09-17 회차 260917-1 에서 실제로 난 사고 —
 *   라인 100047-1 (원본 JHMINIJJIMB00002) → JHMINIJJIM90005
 *   라인 100047-2 (원본 JHMINIJJIMB00002) → JHMINIJJIM90005
 * 같은 순번에서 나온 두 줄이 «둘 다 뚜껑»이 됐다. 몸통은 사라졌다.
 *
 * 조치의 열쇠는 (고유ID + 원본코드)인데, 세트가 쪼개지면 그 열쇠를 가진
 * 줄이 여럿이다. 새코드를 걸면 전부 그 코드가 된다.
 *
 * 실행: node node/_manualsetcode_test.mjs
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
const 몸통 = "JHMINIJJIMB90002";
const 뚜껑 = "JHMINIJJIM90005";
const UID = "2163378867";

const items = { [몸통]: { name: "몸통" }, [뚜껑]: { name: "뚜껑" }, XX9: { name: "딴것" } };

function 걸기(override) {
  const units = [
    { 고유ID: UID, 원본코드: 세트, 품목코드: 몸통, 라인ID: "100047-1" },
    { 고유ID: UID, 원본코드: 세트, 품목코드: 뚜껑, 라인ID: "100047-2" },
  ];
  const warnings = [];
  C.ssApplyManualEdits(units, { override, items, bom: {} }, warnings);
  const 합 = {};
  for (const u of units) 합[u.품목코드] = (합[u.품목코드] || 0) + 1;
  return { units, 합, warnings };
}

/* ── [1] ★ 9/17 에 난 그 사고 ★ ─────────────────────────── */
console.log("\n[1] 쪼개진 세트에 새코드가 걸리면");
{
  const r = 걸기({ [UID + "|" + 세트]: { 조치: "발송", 새코드: 뚜껑 } });
  //  ★ 여기가 사고 자리 ★ 막기 전에는 몸통까지 뚜껑이 됐다
  eq("★ 몸통이 살아 있다", r.units[0].품목코드, 몸통);
  eq("★ 뚜껑은 하나뿐", r.합[뚜껑], 1);
  eq("  뚜껑이 둘이 아니다", r.합[뚜껑] === 2, false);

  const w = r.warnings.filter((x) => x.code === "MANUAL_CODE_ON_SET");
  eq("★ 왜 안 고쳤는지 말한다", w.length, 1);
  eq("  등급은 오류", w[0].level, "오류");
  eq("  몇 줄로 쪼개졌는지 적는다", w[0].msg.indexOf("2줄로 쪼개져") >= 0, true);
  eq("  무엇을 하면 되는지 적는다", w[0].msg.indexOf("판매현황에서 고치고") >= 0, true);
  //  ★ 주문 하나에 경고는 한 번만 ★ 구성품마다 뜨면 경고 탭이 쓸모없어진다
  eq("  경고는 주문당 한 번", w.length, 1);
}

/* ── [2] 쪼개지지 않은 줄은 여태대로 고쳐진다 ───────────── */
console.log("\n[2] 안 쪼개진 주문은 그대로 고쳐야 한다");
{
  const units = [{ 고유ID: "SINGLE1", 원본코드: "PLAIN1", 품목코드: "PLAIN1", 라인ID: "1" }];
  const warnings = [];
  C.ssApplyManualEdits(units,
    { override: { "SINGLE1|PLAIN1": { 조치: "발송", 새코드: "XX9" } }, items, bom: {} },
    warnings);
  eq("★ 코드가 고쳐진다", units[0].품목코드, "XX9");
  eq("  수정 표시가 붙는다", units[0].수정코드, true);
  eq("  쓸데없는 경고 없음",
    warnings.filter((x) => x.code === "MANUAL_CODE_ON_SET").length, 0);
}

/* ── [3] 이름 고치기는 쪼개져도 막지 않는다 ─────────────── */
console.log("\n[3] 이름만 고친 것");
{
  //  이름은 «보이는 것»이라 여러 줄에 걸려도 물건이 틀려지지 않는다
  const r = 걸기({ [UID + "|" + 세트]: { 조치: "발송", 새이름: "다른 이름" } });
  eq("이름은 걸린다", r.units[0].수정이름, "다른 이름");
  eq("코드는 그대로", r.units[0].품목코드, 몸통);
  eq("경고 없음", r.warnings.length, 0);
}

/* ── [4] 새코드가 지금 코드와 같으면 아무 일도 없다 ─────── */
console.log("\n[4] 바꿀 것이 없을 때");
{
  const units = [{ 고유ID: "S2", 원본코드: "P2", 품목코드: "XX9", 라인ID: "1" }];
  const warnings = [];
  C.ssApplyManualEdits(units,
    { override: { "S2|P2": { 조치: "발송", 새코드: "XX9" } }, items, bom: {} }, warnings);
  eq("그대로", units[0].품목코드, "XX9");
  eq("경고 없음", warnings.length, 0);
}

console.log("");
console.log(fail ? "FAIL " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
