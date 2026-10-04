/* 주문 카드 반품 뱃지 검증 (로컬 검증용)
 *
 * 주문을 찾은 CS 가 이 뱃지 하나만 보고 고객에게 답한다.
 * 그래서 두 가지가 조용히 틀리면 안 된다.
 *
 *   1) 남의 건을 붙이면 안 된다 — 전화·송장이 진짜로 맞을 때만 붙는다
 *   2) 같은 사람 반품이 여러 건이면 **지금 처리할 건**을 보여야 한다
 *      지난달 완료건이 뜨면 CS 가 "그건 끝났는데요" 라고 잘못 답한다
 *
 * 뱃지에 적히는 글자는 시트 원값 그대로여야 한다. 화면과 시트가 다른 말을
 * 쓰면 둘을 나란히 놓고 볼 때 사람이 헷갈린다.
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (got !== undefined ? "  → " + got : "")); }
};

const src = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
function take(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("못 찾음: " + from);
  return src.slice(a, b);
}

const ctx = { String, Number, RegExp, parseInt, console, RETURN_CASES: [] };
vm.createContext(ctx);
vm.runInContext(take("function invDigitsOverlap(", "    /* ══"), ctx);
vm.runInContext(take("var RET_STAGE_ICON", "    function wsIsMobileMode("), ctx);

/* 반품대장 한 달치를 흉내낸다. 값 모양은 csGetReturnLedgerBadgeIndex 가 주는 그대로. */
const CASE = (o) => Object.assign({
  invDigits: "", returnInvDigits: "", phoneDigits: "", name: "",
  status: "접수", active: true, tab: "202609", row: 10, stage: 0, photos: 0
}, o);

const B = (order) => ctx.returnBadgeFor(order);
const ORDER = (o) => Object.assign({ phoneDigits: "", invDigits: "" }, o);

console.log("\n[안 붙어야 할 때는 안 붙는다]");
ctx.RETURN_CASES = [];
ok("반품이 하나도 없으면 null", B(ORDER({ phoneDigits: "01099481234" })) === null);

ctx.RETURN_CASES = [CASE({ phoneDigits: "01099481234", invDigits: "440812891733" })];
ok("전화·송장 다 다르면 null",
  B(ORDER({ phoneDigits: "01055550000", invDigits: "111122223333" })) === null);
ok("주문 쪽 값이 비어 있으면 null", B(ORDER({})) === null);
ok("빈 주문이면 null", B(null) === null);

console.log("\n[전화·송장으로 붙는다]");
ok("전화 일치", B(ORDER({ phoneDigits: "01099481234" })) !== null);
ok("송장 일치", B(ORDER({ invDigits: "440812891733" })) !== null);

console.log("\n[단계가 글자·색·아이콘을 정한다]");
ctx.RETURN_CASES = [CASE({ phoneDigits: "0101111", status: "입고검수", stage: 2 })];
let b = B(ORDER({ phoneDigits: "0101111" }));
ok("입고검수 → ret-s2", b.cls === "ret-s2", b.cls);
ok("아이콘은 📦", b.label.indexOf("📦") === 0, b.label);
ok("시트 글자를 그대로 쓴다", b.label.indexOf("입고검수") >= 0, b.label);

ctx.RETURN_CASES = [CASE({ phoneDigits: "0101111", status: "반품송장", stage: 1 })];
b = B(ORDER({ phoneDigits: "0101111" }));
ok("반품송장 → ret-s1", b.cls === "ret-s1", b.cls);
ok("이미 「반품」이 든 글자에 「반품」을 덧붙이지 않는다",
  b.label.indexOf("반품 반품") < 0, b.label);

ctx.RETURN_CASES = [CASE({ phoneDigits: "0101111", status: "접수", stage: 0 })];
ok("접수 → 「반품 접수」", B(ORDER({ phoneDigits: "0101111" })).label.indexOf("반품 접수") > 0,
  B(ORDER({ phoneDigits: "0101111" })).label);

ctx.RETURN_CASES = [CASE({ phoneDigits: "0101111", status: "이카운트OK", active: false, stage: 3 })];
b = B(ORDER({ phoneDigits: "0101111" }));
ok("완료 → ret-s3 · 「반품 완료」", b.cls === "ret-s3" && b.label.indexOf("반품 완료") > 0, b.label);

console.log("\n[사진 장수 — 물류팀이 올렸다는 표시]");
ctx.RETURN_CASES = [CASE({ phoneDigits: "0101111", status: "입고검수", stage: 2, photos: 3 })];
b = B(ORDER({ phoneDigits: "0101111" }));
ok("사진이 있으면 장수를 붙인다", /📷3/.test(b.label), b.label);
ok("설명에도 적는다", /입고 사진 3장/.test(b.title), b.title);
ctx.RETURN_CASES = [CASE({ phoneDigits: "0101111", photos: 0 })];
ok("없으면 안 붙인다", B(ORDER({ phoneDigits: "0101111" })).label.indexOf("📷") < 0);

console.log("\n[같은 사람 반품이 여러 건 — 지금 처리할 건을 보여준다]");
ctx.RETURN_CASES = [
  CASE({ phoneDigits: "0101111", status: "이카운트OK", active: false, stage: 3, row: 5 }),
  CASE({ phoneDigits: "0101111", status: "접수", active: true, stage: 0, row: 40 }),
];
b = B(ORDER({ phoneDigits: "0101111" }));
ok("완료건보다 진행건이 먼저", b.cls === "ret-s0", b.cls);
ok("누를 대상도 진행건", b.key === "202609|40", b.key);

// 순서를 뒤집어도 같아야 한다 — 목록 정렬에 기대면 안 된다
ctx.RETURN_CASES.reverse();
ok("목록 순서가 바뀌어도 같다", B(ORDER({ phoneDigits: "0101111" })).key === "202609|40",
  B(ORDER({ phoneDigits: "0101111" })).key);

ctx.RETURN_CASES = [
  CASE({ phoneDigits: "0101111", status: "접수", stage: 0, row: 11 }),
  CASE({ phoneDigits: "0101111", status: "입고검수", stage: 2, row: 22 }),
];
ok("둘 다 진행 중이면 더 나아간 단계", B(ORDER({ phoneDigits: "0101111" })).key === "202609|22",
  B(ORDER({ phoneDigits: "0101111" })).key);

console.log("\n[누를 대상 — 탭과 행이 정확해야 한다. 틀리면 남의 건이 열린다]");
ctx.RETURN_CASES = [CASE({ phoneDigits: "0101111", tab: "202608", row: 137 })];
ok("key 는 탭|행", B(ORDER({ phoneDigits: "0101111" })).key === "202608|137",
  B(ORDER({ phoneDigits: "0101111" })).key);

console.log("\n[서버가 아직 stage 를 안 줄 때 — 배포 순서가 어긋나도 안 깨진다]");
ctx.RETURN_CASES = [{ phoneDigits: "0101111", status: "입고검수", active: true, tab: "202609", row: 9 }];
b = B(ORDER({ phoneDigits: "0101111" }));
ok("진행 중이면 0단계로 그린다 (틀린 색이지만 안 터진다)", b.cls === "ret-s0", b.cls);
ctx.RETURN_CASES = [{ phoneDigits: "0101111", status: "완료", active: false, tab: "202609", row: 9 }];
ok("완료면 3단계", B(ORDER({ phoneDigits: "0101111" })).cls === "ret-s3");

console.log("\n" + (fail ? `실패 ${fail}건 / 통과 ${pass}건` : `모두 통과 (${pass}건)`));
process.exit(fail ? 1 : 0);
