/**
 * 샘플 합포장 — 조건이 달라도 한 박스로, 14개마다 나눈다
 *
 *  > "여전히 샘플은 10개를 기준으로 합포장을 하는거 같은데?"
 *  > "샘플만 14개로 하고 나머지는 10개로 해줘"
 *
 *  ★ 한도가 아니라 «열쇠»가 문제였다 ★
 *    합배송조건 마스터가 샘플을 크기별로 열세 가지로 갈라 놓았다
 *    (샘플1218 · 샘플1512 · 샘플1914 · 평택샘플 …). 조건이 묶는 열쇠에 들어가니
 *    크기를 섞어 주문하면 크기 수만큼 박스가 나왔다 — 9/21 김부남은 샘플 27건이
 *    다섯 박스였다. 한도 14 는 닿아 보지도 못했다.
 *
 * 실행: node _ssmerge_sample_test.js
 */
const path = require("path");
const core = require(path.join(__dirname, "세트분리V2", "core.js"));

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const cfg = Object.assign({}, core.SS_DEFAULT_CONFIG, {
  합포장_최대건수: '10',          // 나머지
  합포장_최대건수_샘플: '14',      // 샘플
});
const 출고지 = cfg.합배송출고지;

/** 한 줄 만들기 */
function 줄(품목명, 조건ID, 이름) {
  return {
    출고지: 출고지, route: core.SS_ROUTE.LOTTE, 조건ID: 조건ID, 수량: 1,
    품목명: 품목명, 받는분: 이름 || "김부남", 주소1: "경기 수원시 팔달구 경수대로 567",
    보내는분: "팩투유", 배송비: 3000, 주문수량: 1,
  };
}
/** 묶고 나서 박스가 몇 개이고 각각 몇 건인가 */
function 박스들(units) {
  core.ssMerge(units, cfg, []);
  const 묶음 = {};
  for (const u of units) if (u.합포장그룹) (묶음[u.합포장그룹] = 묶음[u.합포장그룹] || 0) , 묶음[u.합포장그룹]++;
  return Object.keys(묶음).map((k) => 묶음[k]).sort((a, b) => b - a);
}

console.log("\n① 크기가 달라도 샘플은 한 박스 (지금까지는 크기 수만큼 갈렸다)");
{
  const units = [
    줄("[샘플] JH 실링 12152 화이트", "샘플1512"),
    줄("[샘플] JH 실링 12153 화이트", "샘플1512"),
    줄("[샘플] JH 실링 12183 블랙", "샘플1218"),
    줄("[샘플] JH 실링 191440-2B", "샘플1914"),
    줄("[샘플] 평택 수저", "평택샘플수저"),
  ];
  const b = 박스들(units);
  console.log("   조건 4가지 · 샘플 5건 → 박스 " + b.length + "개 " + JSON.stringify(b));
  ok("한 박스로 묶인다", b.length === 1 && b[0] === 5, JSON.stringify(b));
}

console.log("\n② 14개를 넘으면 그때 나뉜다 — 김부남 27건");
{
  const units = [];
  const 조건들 = ["샘플1512", "샘플1218", "샘플1914", "평택샘플", "샘플2318"];
  for (let i = 0; i < 27; i++) units.push(줄("[샘플] 실링 " + i, 조건들[i % 조건들.length]));
  const b = 박스들(units);
  console.log("   샘플 27건 → 박스 " + b.length + "개 " + JSON.stringify(b));
  ok("두 박스", b.length === 2, JSON.stringify(b));
  ok("14 + 13", b[0] === 14 && b[1] === 13, JSON.stringify(b));
}

console.log("\n③ 샘플이 아닌 것은 여전히 조건을 따진다 (섞어 담으면 안 되는 것이 있다)");
{
  const units = [
    줄("JH 샐러드 용기", "JH샐러드"),
    줄("JH 샐러드 뚜껑", "JH샐러드"),
    줄("KR 꼬지", "KR꼬지"),
    줄("KR 꼬지 대", "KR꼬지"),
  ];
  const b = 박스들(units);
  console.log("   조건 2가지 · 4건 → 박스 " + b.length + "개 " + JSON.stringify(b));
  ok("조건대로 두 박스", b.length === 2 && b[0] === 2 && b[1] === 2, JSON.stringify(b));
}

console.log("\n④ 샘플이 아닌 것은 한도 10에서 나뉜다");
{
  const units = [];
  for (let i = 0; i < 14; i++) units.push(줄("KR 꼬지 " + i, "KR꼬지"));
  const b = 박스들(units);
  console.log("   14건 → 박스 " + b.length + "개 " + JSON.stringify(b));
  ok("10 + 4", b.length === 2 && b[0] === 10 && b[1] === 4, JSON.stringify(b));
}

console.log("\n⑤ 받는 사람이 다르면 안 묶인다 (조건을 안 따져도 주소는 따진다)");
{
  const units = [
    줄("[샘플] 실링 A", "샘플1512", "김부남"),
    줄("[샘플] 실링 B", "샘플1218", "김부남"),
    줄("[샘플] 실링 C", "샘플1512", "박영희"),
    줄("[샘플] 실링 D", "샘플1218", "박영희"),
  ];
  const b = 박스들(units);
  console.log("   두 사람 · 4건 → 박스 " + b.length + "개 " + JSON.stringify(b));
  ok("사람마다 한 박스", b.length === 2 && b[0] === 2 && b[1] === 2, JSON.stringify(b));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
