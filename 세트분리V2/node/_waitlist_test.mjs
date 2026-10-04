/**
 * 아직 송장을 못 받은 주문 — 「대기 명부」
 *
 *  > "일일 마감시 오래된 데이타를 채우려고 너무 많은 데이타를 찾는거 같아..
 *  >  품절이나 재고부족으로 1~7일, 최대 20일(주문인쇄 제작등)의 경우가 있어.
 *  >  빠져있는 데이타만 따로 모아서 송장수집시 주문날짜와 고유아이디만 찾아
 *  >  삽입하면 더 빠르고 정확하지 않을까?"
 *
 *  맞는 설계다. 그리고 그 명부는 «이미 있다» — 원장에서 운송장번호가 빈 줄이
 *  정확히 그것이고, 회차키(YYMMDD-N)가 주문날짜를 갖고 있다.
 *  새 표를 만들면 또 하나의 원천이 될 뿐이다.
 *
 *  전파는 매일 원장 «전체»를 훑어 빈 줄을 채운다 — 20일 전 주문도 오늘 채워진다.
 *  그러니 마감이 지난 마감 파일을 14일치 다시 여는 일은 중복이다.
 *  지우기 전에, 아직 못 받은 게 몇 건이고 며칠짜리인지부터 보여 준다.
 *
 * 실행: node _waitlist_test.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + JSON.stringify(got) +
    "\n       want " + JSON.stringify(want)); }
};

const main = readFileSync("../gasMain.js", "utf8");

//  ── 나이 계산 함수를 떼어 내 돌린다 ──
function grab(name) {
  const i = main.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 없음");
  let d = 0, seen = false;
  for (let k = i; k < main.length; k++) {
    if (main[k] === "{") { d++; seen = true; }
    else if (main[k] === "}") { d--; if (seen && d === 0) return main.slice(i, k + 1); }
  }
}
const ctx = { ssText: (v) => (v == null ? "" : String(v).trim()) };
vm.createContext(ctx);
vm.runInContext(grab("ss_회차나이_"), ctx);

const 오늘 = new Date();
const 회차키 = (전) => {
  const d = new Date(오늘.getTime() - 전 * 86400000);
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getFullYear() % 100) + p(d.getMonth() + 1) + p(d.getDate()) + "-1";
};

console.log("");
console.log("[나이] 회차키에서 며칠 전인지 센다");
eq("오늘 것은 0일", ctx.ss_회차나이_(회차키(0)), 0);
eq("3일 전", ctx.ss_회차나이_(회차키(3)), 3);
eq("★ 20일 전", ctx.ss_회차나이_(회차키(20)), 20);
eq("★ 25일 전", ctx.ss_회차나이_(회차키(25)), 25);
eq("회차키 꼴이 아니면 0", ctx.ss_회차나이_("이상한값"), 0);
eq("빈칸도 0", ctx.ss_회차나이_(""), 0);

console.log("");
console.log("[구간] 사장님이 말한 대로 가른다");
//  코드와 «같은 규칙»을 옮겨 적는다: <=7 / <=20 / 그 밖
const 구간 = (일) => (일 <= 7 ? "d7" : 일 <= 20 ? "d20" : "초과");
eq("당일~7일은 기다리는 중", [0, 1, 7].map(구간), ["d7", "d7", "d7"]);
eq("8~20일도 기다리는 중 (제작·품절)", [8, 14, 20].map(구간), ["d20", "d20", "d20"]);
eq("★ 20일 넘으면 사람이 봐야 한다", [21, 40].map(구간), ["초과", "초과"]);

console.log("");
console.log("[소스] 전파가 그 명부를 만들고 보여 주는가");
eq("★ 대기 그릇이 있다", main.includes("var 대기 = { d7: 0, d20: 0, 초과: 0"), true);
eq("★ 송장을 못 붙인 줄만 센다", main.includes("if (!hit2) {"), true);
eq("회차키에서 날짜를 얻는다", main.includes("var 며칠 = ss_회차나이_(rk대기);"), true);
eq("★ 결과에 적는다", main.includes("'📭 아직 송장 없음 '"), true);
eq("20일 넘은 건은 예를 든다", main.includes("대기.오래된예.push("), true);
eq("없으면 없다고 말한다", main.includes("'📭 아직 송장 없음: 없습니다'"), true);

console.log("");
console.log("[전제] 전파는 원장 전체를 훑는다 — 그래서 새 표가 필요 없다");
eq("★ 원장을 통째로 읽는다",
  main.includes("var lv = lg.getRange(2, 1, lg.getLastRow() - 1, lcols).getValues();"), true);
eq("★ 빈 줄만 채운다", main.includes("if (!ssText(lv[a][li['운송장번호']])) {"), true);

console.log("\n" + (fail ? "실패 " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
