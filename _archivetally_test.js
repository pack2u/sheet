/**
 * 합계줄은 «그 파일» 것만 센다
 *
 *  2026-09-16 · 사장님이 일일마감_(2026-09-16) 에서 「미매칭」을 검색하니 26줄.
 *  그런데 합계줄에는 「미매칭:386건」이라고 적혀 있었다.
 *
 *  까닭: 마감은 주문일자별로 파일을 나눠 쓰는데, 각 파일 맨 아래에
 *  «마감 실행 전체»의 누계를 똑같이 찍고 있었다. 나머지 360건은 다른 날짜
 *  파일에 있었다. 어느 파일을 열어도 같은 숫자라, 사람이 세어 보면 늘 안 맞는다.
 *
 *  ★ 검증할 수 없는 숫자는 숫자가 아니다 ★
 *    사장님이 시트에서 세어 본 값과 합계줄이 같아야 한다. 그래야 그 줄이
 *    무언가를 «말해 준다». 지금까지는 아무것도 말해 주지 않았다.
 *
 * 실행: node _archivetally_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}
function grab(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

const pep = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(grab(pep, "_pep_archiveTally_"), ctx);

/** 가짜 탭 — A열(품목코드)과 마지막 열(출처)만 흉내낸다 */
function 탭(rows, 열수) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: (r, c, n) => ({
      getDisplayValues: () => rows.map((x) => [c === 1 ? x[0] : x[1]]),
    }),
  };
}
const 세기 = (rows) => {
  ctx.__t = 탭(rows, 18);
  return vm.runInContext("_pep_archiveTally_(__t, 18)", ctx);
};

console.log("\n[1] ★ 출처별로 «그 파일»만 센다");
{
  const r = 세기([
    ["AJ001", "로젠"], ["AJ002", "로젠"], ["AJ003", "합포장"],
    ["AJ004", "미매칭"], ["AJ005", "세트분리원장"], ["AJ006", "대리판매"],
  ]);
  check("줄 수", r.줄, 6);
  check("★ 자사출고 (로젠+합포장)", r.자사출고, 3);
  check("★ 미매칭", r.미매칭, 1);
  check("대리판매", r.대리판매, 1);
  check("★ 나머지는 대리공급 (세트분리원장)", r.대리공급, 1);
}

console.log("\n[2] ★ 옛 합계줄은 세지 않는다");
{
  /*  마감을 두 번 돌리면 합계줄이 파일 안에 여럿 남는다.
      그것까지 세면 줄 수가 부풀고, 「출처」 칸의 긴 글이 대리공급으로 잡힌다.  */
  const r = 세기([
    ["AJ001", "로젠"],
    ["★ 합계 (1건)", "자사출고:1 대리판매:0 대리공급:0 이름+전화:0 미매칭:0건"],
    ["AJ002", "미매칭"],
  ]);
  check("★ 합계줄을 건너뛴다", r.줄, 2);
  check("★ 합계줄이 대리공급으로 안 샌다", r.대리공급, 0);
  check("미매칭", r.미매칭, 1);
}

console.log("\n[3] 빈 줄은 안 센다");
{
  const r = 세기([["AJ001", "로젠"], ["", ""], ["", ""]]);
  check("줄 수", r.줄, 1);
}

console.log("\n[4] ★ 못 읽으면 «0» 이 아니라 «모른다»");
{
  /*  0 으로 적으면 「미매칭 0건」이 되어 «다 맞았다»로 읽힌다.
      오늘 하루 고친 병이 전부 이것이었다.  */
  ctx.__bad = {
    getLastRow: () => 5,
    getRange: () => { throw new Error("권한 없음"); },
  };
  const r = vm.runInContext("_pep_archiveTally_(__bad, 18)", ctx);
  check("★ 못 읽었다고 남긴다", r.못읽음, "권한 없음");
}

console.log("\n[5] ★ 합계줄이 그 셈을 쓴다 (전체 누계가 아니라)");
{
  const 몸 = grab(pep, "_pep_appendArchiveRows_");
  check("★ 파일 기준 셈을 부른다", 몸.indexOf("_pep_archiveTally_(archTab, colCount)") >= 0, true);
  check("★ detail.noInvoice 를 안 쓴다", 몸.indexOf("detail.noInvoice") < 0, true);
  check("★ detail.lotte 를 안 쓴다", 몸.indexOf("detail.lotte") < 0, true);
  check("★ 못 읽으면 그렇게 적는다", 몸.indexOf("못 읽어 세지 못했습니다") >= 0, true);
}

console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
