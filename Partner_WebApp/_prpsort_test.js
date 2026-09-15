/**
 * 협력업체 포털 — 반품 카드 나열 차례
 *
 *  > "당장드림 반품현황에서 카드 나열을 선택할수 있게 해줘..
 *  >  최신순. 오래된순, 등으로 선택할수 있게 해줘"
 *
 *  지켜야 할 것
 *    · 서버가 쓰는 sortKey(dateYmd_역순번)를 그대로 쓴다 — 규칙을 두 군데 두지 않는다
 *    · 상태순은 카드에 그리는 stepIndex 를 그대로 쓴다 (화면과 차례가 따로 놀면 못 믿는다)
 *    · 상태순은 손 안 간 것부터, 같은 단계면 오래된 것이 위
 *    · 철회된 건은 흐름 밖이라 맨 뒤
 *
 * 실행: node _prpsort_test.js
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

const html = fs.readFileSync("portal.html", "utf8");
function grabFn(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { d++; seen = true; }
    else if (html[k] === "}") { d--; if (seen && d === 0) return html.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

const ctx = { SORT: "new" };
vm.createContext(ctx);
vm.runInContext([grabFn("stepIndex"), grabFn("sortRows")].join("\n"), ctx);

//  sortKey = dateYmd_역순번 (prpLedger.gs 와 같은 모양)
const 행 = (id, ymd, seq, status, done) =>
  ({ id: id, sortKey: ymd + "_" + seq, status: status, done: !!done });

const 목록 = [
  행("A", "20260911", "099998", "접수"),
  행("B", "20260914", "099999", "반품입고"),
  행("C", "20260909", "099997", "환불처리", true),
  행("D", "20260914", "099995", "접수"),
  행("E", "20260913", "099996", "철회"),
];
const ids = (rows) => rows.map(function (r) { return r.id; });
const 차례 = (mode) => { ctx.SORT = mode; return ids(ctx.sortRows(목록)); };

console.log("");
console.log("[차례] 최신순 · 오래된순");
check("최신순 — 새 것이 위", 차례("new"), ["B", "D", "E", "A", "C"]);
check("오래된순 — 묵은 것이 위", 차례("old"), ["C", "A", "E", "D", "B"]);
check("★ 둘은 정확히 뒤집힌 차례", 차례("old").slice().reverse(), 차례("new"));

console.log("");
console.log("[차례] 상태순 — 손 안 간 것부터");
//  접수(A,D) → 입고검수(B) → 처리완료(C) → 철회(E, 흐름 밖이라 맨 뒤)
check("접수 → 입고 → 완료 → 철회", 차례("stage"), ["A", "D", "B", "C", "E"]);
check("★ 같은 단계면 오래된 것이 위 (A 가 D 보다 앞)",
  차례("stage").indexOf("A") < 차례("stage").indexOf("D"), true);
check("★ 철회는 맨 뒤", 차례("stage")[4], "E");

console.log("");
console.log("[차례] 카드에 그리는 단계와 같은 규칙인가");
check("반품입고 → 2단계", ctx.stepIndex("반품입고", false), 2);
check("환불처리 → 3단계", ctx.stepIndex("환불처리", false), 3);
check("철회 → 흐름 밖(-1)", ctx.stepIndex("철회", false), -1);

console.log("");
console.log("[차례] 원본을 건드리지 않는다");
ctx.SORT = "old";
ctx.sortRows(목록);
check("★ 넘겨 준 배열은 그대로", ids(목록), ["A", "B", "C", "D", "E"]);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
