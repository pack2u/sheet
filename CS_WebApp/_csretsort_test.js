/**
 * 반품 카드 나열 차례
 *
 *  > "반품현황에서 카드 나열을 선택할수 있게 해줘.. 최신순. 오래된순, 등으로"
 *
 *  지켜야 할 것
 *    · 서버가 쓰는 sortKey(dateYmd_역순번)를 그대로 쓴다 — 규칙을 두 군데 두지 않는다
 *    · 업체순·상태순은 «그 안에서» 차례가 있어야 한다 (아무렇게나 섞이면 못 쓴다)
 *    · 상태순은 손 안 간 것부터 (stage 0 접수 → 3 완료), 같은 단계면 오래된 것이 위
 *
 * 실행: node _csretsort_test.js
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

const html = fs.readFileSync("home.html", "utf8");
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

const ctx = { RETURN_SORT: "new" };
vm.createContext(ctx);
vm.runInContext(grabFn("sortReturnRows"), ctx);

//  sortKey = dateYmd_역순번 (서버와 같은 모양)
const 행 = (id, ymd, seq, vendor, stage) =>
  ({ id: id, sortKey: ymd + "_" + seq, vendor: vendor, stage: stage });

const 목록 = [
  행("A", "20260911", "099998", "하나팩", 0),
  행("B", "20260914", "099999", "뉴파츠", 2),
  행("C", "20260909", "099997", "하나팩", 3),
  행("D", "20260914", "099995", "가나팩", 0),
];
const ids = (rows) => rows.map(function (r) { return r.id; });
const 차례 = (mode) => { ctx.RETURN_SORT = mode; return ids(ctx.sortReturnRows(목록)); };

console.log("");
console.log("[차례] 최신순 · 오래된순");
check("최신순 — 새 것이 위", 차례("new"), ["B", "D", "A", "C"]);
check("오래된순 — 묵은 것이 위", 차례("old"), ["C", "A", "D", "B"]);
check("★ 둘은 정확히 뒤집힌 차례", 차례("old").slice().reverse(), 차례("new"));

console.log("");
console.log("[차례] 업체순 — 업체를 모으고, 그 안에서 최신순");
check("업체 이름차례 · 같은 업체는 새 것이 위", 차례("vendor"), ["D", "B", "A", "C"]);

console.log("");
console.log("[차례] 상태순 — 손 안 간 것부터");
//  stage 0 접수(A, D) → 2 입고(B) → 3 완료(C). 같은 단계면 오래된 것이 위.
check("접수 → 입고 → 완료, 같은 단계는 오래된 것이 위", 차례("stage"), ["A", "D", "B", "C"]);

console.log("");
console.log("[차례] 원본을 건드리지 않는다");
ctx.RETURN_SORT = "old";
ctx.sortReturnRows(목록);
check("★ 넘겨 준 배열은 그대로", ids(목록), ["A", "B", "C", "D"]);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
