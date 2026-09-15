/**
 * 사방넷 대량등록 — 자사출고(로젠)가 빠지지 않는가
 *
 *  > "세트분리(뉴)에서 사방넷 대량등록시 3번째 판매현황을 넣었다면..
 *  >  1,2,3차 다 포함되서 만들어져야 되는거 아닌가?"
 *
 *  맞다. 이 기능은 «회차»가 아니라 «원천»을 훑는다(gasBulk 머리주석).
 *  그런데 자사출고 원천이 통째로 빠지고 있었다 —
 *  로젠 탭이 「집하」 양식이라 머리글이 «없고», ssb_findHeader 가
 *  「머리글 못 찾음」으로 그 탭을 버렸다. 1·2차든 3차든 자사출고는 0줄.
 *
 *  지켜야 할 것
 *    · 머리글이 없어도 적어 둔 자리로 읽는다 (포기하지 않는다)
 *    · 그 자리는 허브 _PT_ROZEN_FIXED_COL 과 «같아야» 한다.
 *      두 군데가 다르면 한쪽만 고쳐지고 또 조용히 갈린다
 *    · 자리로 읽었으면 그 사실을 결과에 적는다
 *
 * 실행: node _bulkrozen_test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + JSON.stringify(got) +
    "\n       want " + JSON.stringify(want)); }
};

const bulk = readFileSync("../gasBulk.js", "utf8");
const hub = readFileSync("../../_partnerHelpers.gs", "utf8");

/** 「name: 10,」 에서 숫자 — 정규식 없이 글자로 찾는다 */
function 칸(본문, 시작말, name) {
  const p0 = 본문.indexOf(시작말);
  if (p0 < 0) return null;
  const 조각 = 본문.slice(p0, p0 + 1800);
  const key = name + ":";
  const p = 조각.indexOf(key);
  if (p < 0) return null;
  const t = 조각.slice(p + key.length).split(",")[0].split("//")[0].trim();
  const v = parseInt(t, 10);
  return isNaN(v) ? null : v;
}

console.log("\n[자리] 로젠 「집하」 양식에 맞는가");
eq("주문번호 = J열(9)", 칸(bulk, "var 자사탭 = [", "uid"), 9);
eq("운송장 = K열(10)", 칸(bulk, "var 자사탭 = [", "inv"), 10);
eq("집하일자 = C열(2)", 칸(bulk, "var 자사탭 = [", "date"), 2);

console.log("\n[한 군데] 허브와 같은 자리를 쓴다");
eq("★ 주문번호 — 세트분리 = 허브",
  칸(bulk, "var 자사탭 = [", "uid"), 칸(hub, "var _PT_ROZEN_FIXED_COL", "uid"));
eq("★ 운송장 — 세트분리 = 허브",
  칸(bulk, "var 자사탭 = [", "inv"), 칸(hub, "var _PT_ROZEN_FIXED_COL", "invoice"));
eq("★ 날짜 — 세트분리 = 허브",
  칸(bulk, "var 자사탭 = [", "date"), 칸(hub, "var _PT_ROZEN_FIXED_COL", "date"));

console.log("\n[포기하지 않는다] 머리글이 없어도 읽는다");
eq("머리글 없음을 따로 잡는다", bulk.includes("var 머리없음 = !H.row;"), true);
eq("★ 그때 예비 자리로 바꿔 쓴다",
  bulk.includes("H = { row: 0, head: [], uid: 편.uid, inv: 편.inv,"), true);
eq("★ 통째로 버리던 continue 가 사라졌다",
  bulk.includes("res.자사탭.push(편.이름 + ' 머리글 못 찾음');"), false);
eq("예비 자리도 없으면 그때는 말하고 건너뛴다",
  bulk.includes("예비 자리도 없음"), true);

console.log("\n[말한다] 어느 길로 읽었는지");
eq("★ 「머리글 없음 → 자리로」 를 남긴다",
  bulk.includes("머리글 없음 → 자리로"), true);

console.log("\n[설계] 회차가 아니라 원천을 훑는다");
eq("머리주석이 그 뜻을 적고 있다",
  bulk.includes("회차 하나가 아니라 원천을 직접 훑어"), true);
eq("원장도 원천에 있다 (지난 회차를 여기서 건진다)",
  bulk.includes("4. 주문라인원장"), true);

console.log("\n" + (fail ? "실패 " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
