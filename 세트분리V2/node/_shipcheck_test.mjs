/**
 * 나갈 줄에 빠진 칸이 없는가 — 「주소 안 나오는 문제」를 잡는 그물
 *
 *  > "내일 실무에서 적용될꺼라 비용문제랑 직결되는 부분이니 … (어제 주소
 *  >  안나오는문제 같은) 꼼꼼히 확인 검증해줘"
 *
 *  주소가 빈 채로 송장이 나가면 그 건은 배송이 안 되고, 비용은 이미 나간다.
 *  받는분·연락처·품목명·수량도 마찬가지다. 그래서 «나가기 전에» 본다.
 *
 *  ★ 이 시험이 지키는 것 ★
 *    · 다섯 칸을 모두 본다 (하나라도 빠지면 그 부류가 통째로 안 잡힌다)
 *    · 실제로 빈 줄을 넣으면 경고가 «난다» — 있다고만 하고 안 잡히면 없느니만 못하다
 *    · 멀쩡한 줄에는 경고가 «안 난다» (거짓 경고는 사람을 무디게 만든다)
 *    · 검사 대상은 그때그때의 출력 탭 목록을 따라간다 (탭이 늘거나 줄어도)
 *
 * 실행: node _shipcheck_test.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + JSON.stringify(got) +
    "\n       want " + JSON.stringify(want)); }
};

const main = readFileSync("../gasMain.js", "utf8");
function grab(n) {
  const i = main.indexOf("function " + n + "(");
  if (i < 0) throw new Error(n + " 없음");
  let d = 0, s = false;
  for (let k = i; k < main.length; k++) {
    if (main[k] === "{") { d++; s = true; }
    else if (main[k] === "}") { d--; if (s && d === 0) return main.slice(i, k + 1); }
  }
}
const i0 = main.indexOf("var SS_SHIP_MUST = [");
const i1 = main.indexOf("];", i0) + 2;

function 판(출력탭) {
  const ctx = {
    ssText: (v) => (v == null ? "" : String(v).trim()),
    ssNum: (v) => Number(v) || 0,
    SSIO_TABS: { 출력: 출력탭 },
    ssWarn: (w, lv, c, t, m) => w.push({ lv, c, t, m }),
  };
  vm.createContext(ctx);
  vm.runInContext(main.slice(i0, i1) + "\n" + grab("ss출고점검"), ctx);
  return ctx;
}

const 줄 = (o) => Object.assign({
  순번: 1, 받는분: "홍길동", 주소1: "서울 강남구 1",
  모바일: "010-1111-2222", 출력품목명: "컵", 수량: 1,
}, o);

console.log("\n[다섯 칸] 무엇을 보는가");
{
  const 몸 = main.slice(i0, i1);
  for (const 칸 of ["받는분", "주소", "연락처", "품목명", "수량"]) {
    eq("★ " + 칸 + " 을 본다", 몸.includes("이름: '" + 칸 + "'"), true);
  }
}

console.log("\n[잡는다] 빈 칸이 있으면 경고가 난다");
{
  const c = 판(["로젠택배", "대리발송"]);
  const 돌려 = (바꿈) => {
    const w = [];
    c.ss출고점검({ 로젠택배: [줄(바꿈)], 대리발송: [] }, w);
    return w;
  };
  eq("★ 주소가 비면 잡는다", 돌려({ 주소1: "" }).length, 1);
  eq("★ 받는분이 비면 잡는다", 돌려({ 받는분: "" }).length, 1);
  eq("★ 연락처가 둘 다 비면 잡는다", 돌려({ 모바일: "", 전화: "" }).length, 1);
  eq("★ 품목명이 비면 잡는다", 돌려({ 출력품목명: "", 품목명: "" }).length, 1);
  eq("★ 수량이 0이면 잡는다", 돌려({ 수량: 0 }).length, 1);
  eq("무엇이 빠졌는지 말한다", 돌려({ 주소1: "" })[0].t.indexOf("주소 없음") >= 0, true);
}

console.log("\n[안 잡는다] 멀쩡한 줄에 거짓 경고가 없다");
{
  const c = 판(["로젠택배", "대리발송"]);
  const w = [];
  c.ss출고점검({ 로젠택배: [줄({}), 줄({ 순번: 2 })], 대리발송: [줄({ 순번: 3 })] }, w);
  eq("★ 멀쩡한 세 줄 — 경고 없음", w.length, 0);
  //  전화만 있고 모바일이 없어도 연락은 된다
  const w2 = [];
  c.ss출고점검({ 로젠택배: [줄({ 모바일: "", 전화: "031-923-7795" })], 대리발송: [] }, w2);
  eq("★ 모바일 없고 전화만 있으면 통과", w2.length, 0);
}

console.log("\n[범위] 그때그때의 출력 탭을 따라간다");
{
  //  2026-09-16 에 동네배송 탭을 지웠다 — 목록이 줄어도 나머지는 그대로 본다
  const c = 판(["로젠택배"]);
  const w = [];
  c.ss출고점검({ 로젠택배: [줄({ 주소1: "" })], 대리발송: [줄({ 주소1: "" })] }, w);
  eq("★ 목록에 없는 탭은 안 본다 (대리발송 제외 → 1건)", w.length, 1);
  eq("목록을 코드에 박지 않는다", grab("ss출고점검").includes("SSIO_TABS.출력"), true);
}

console.log("\n[연결] 실행이 이 검사를 실제로 부른다");
eq("★ ss_실행 이 ss출고점검 을 부른다",
  main.includes("var 출고빔 = ss출고점검(res.buckets, res.warnings);"), true);
eq("★ 실행요약에 크게 띄운다",
  main.includes("★★ 나갈 줄에 빠진 칸"), true);

console.log("\n" + (fail ? "실패 " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
