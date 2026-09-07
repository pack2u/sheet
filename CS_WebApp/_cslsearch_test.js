/* 물류 검색 검증 (로컬 검증용)
 *
 * 택배 송장은 이름을 가린다 — 「김*동」. 반품대장에는 전체 이름이 들어 있다.
 * 이 대조가 조용히 틀리면 두 방향으로 나쁘다.
 *   · 못 찾으면   → 물류팀이 검색을 포기하고 예전처럼 찍어서 찾는다
 *   · 너무 찾으면 → 김씨가 전부 걸려 고르는 게 더 오래 걸린다
 *
 * 그리고 **남의 건에 사진을 붙이는 것**이 제일 나쁘다. 그래서 자리 수까지 맞춘다.
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (got !== undefined ? "  → " + got : "")); }
};

const src = fs.readFileSync(path.join(__dirname, "csLogistics.gs"), "utf8");

/* 필요한 조각만 떼어 온다 */
function take(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("못 찾음: " + from);
  return src.slice(a, b);
}

const LEDGER = [
  { tab: "202609", row: 10, name: "김민동", phone: "010-9948-1234", item: "AJ 죽용기 400",
    status: "접수", invDigits: "440812891733", returnInvDigits: "", invoice: "", returnInvoice: "" },
  { tab: "202609", row: 11, name: "김철동", phone: "010-2222-5678", item: "HR 앞치마",
    status: "접수", invDigits: "446651704219", returnInvDigits: "255252851162", invoice: "", returnInvoice: "" },
  { tab: "202609", row: 12, name: "이민동", phone: "010-3333-1234", item: "TY 중화용기",
    status: "수거", invDigits: "", returnInvDigits: "", invoice: "", returnInvoice: "" },
  { tab: "202609", row: 13, name: "김동", phone: "010-4444-9999", item: "JH 실링",
    status: "접수", invDigits: "", returnInvDigits: "", invoice: "", returnInvoice: "" },
  { tab: "202609", row: 14, name: "백년가짬뽕", phone: "010-5555-0001", item: "AJ 삼계탕 특대",
    status: "완료", invDigits: "", returnInvDigits: "", invoice: "", returnInvoice: "" },
];

const ctx = {
  String, Number, RegExp, Math, console,
  _CSL_LOOKBACK_: 60,
  _CSL_TAIL_MIN_: 4,
  _cs_loadReturnLedgerCases_: () => LEDGER,
};
vm.createContext(ctx);
vm.runInContext(take("function _csl_norm_", "/**\n * 송장번호처럼 보이는가"), ctx);
vm.runInContext(take("function _csl_digits_", "function _csl_norm_"), ctx);
vm.runInContext(take("var _CSL_MASK_RE_", "// ── 적재 ─"), ctx);

const names = (r) => r.matches.map((m) => m.name).sort().join(",");
const S = (q) => ctx.csLogisticsSearch(q);

console.log("\n[가린 이름 — 자리 수까지 맞춘다]");
ok("김*동 → 김민동·김철동", names(S("김*동")) === "김민동,김철동", names(S("김*동")));
ok("김*동 은 「김동」(두 글자)을 안 잡는다", S("김*동").matches.every((m) => m.name !== "김동"));
ok("김*동 은 「이민동」을 안 잡는다", S("김*동").matches.every((m) => m.name !== "이민동"));
ok("이*동 → 이민동", names(S("이*동")) === "이민동", names(S("이*동")));
ok("*민동 → 김민동·이민동", names(S("*민동")) === "김민동,이민동", names(S("*민동")));

console.log("\n[가림 문자 여러 가지]");
for (const m of ["김*동", "김○동", "김·동", "김ㅇ동", "김X동"]) {
  ok(m + " 도 같게 본다", names(S(m)) === "김민동,김철동", names(S(m)));
}

console.log("\n[가리지 않은 이름]");
ok("김민동 완전일치", names(S("김민동")) === "김민동");
ok("김 부분일치 — 김씨 셋", names(S("김")) === "" || S("김").matches.length === 0,
  "두 글자 미만이라 안 찾는 게 맞다");
ok("백년 → 백년가짬뽕", names(S("백년")) === "백년가짬뽕", names(S("백년")));

console.log("\n[숫자]");
ok("전화 뒤4 1234 → 김민동·이민동", names(S("1234")) === "김민동,이민동", names(S("1234")));
ok("반품송장 뒤자리", S("851162").matches.length === 1 &&
  S("851162").matches[0].name === "김철동", names(S("851162")));
ok("원송장 뒤자리", S("891733").matches[0].name === "김민동", names(S("891733")));

console.log("\n[이름 + 숫자 — 이게 가장 확실하다]");
const both = S("김*동 1234");
ok("김*동 1234 → 김민동 하나", names(both) === "김민동", names(both));
ok("점수 100 (사실상 확정)", both.matches[0].score === 100, String(both.matches[0].score));
ok("경로에 둘 다 적힌다", /가린 이름 \+ 전화 뒤4자리/.test(both.matches[0].matchVia),
  both.matches[0].matchVia);

console.log("\n[한쪽만 맞으면 안 올린다 — 조건을 더 준 사람에게 더 넓은 결과를 주면 안 된다]");
ok("김*동 9999 → 없음 (이름은 맞지만 번호가 다름)", S("김*동 9999").matches.length === 0,
  names(S("김*동 9999")));
ok("이*동 1234 → 이민동", names(S("이*동 1234")) === "이민동", names(S("이*동 1234")));

console.log("\n[자동 처리하지 않는다]");
ok("하나만 걸려도 tier 는 maybe", S("김민동").tier === "maybe", S("김민동").tier);
ok("못 찾으면 none", S("없는이름").tier === "none");

console.log("\n[안내 문구]");
ok("가린 이름으로 못 찾으면 자릿수를 알려준다",
  /글자 수가 같아야/.test(S("최*수").note), S("최*수").note);
ok("두 글자 미만은 막는다", /두 글자 이상/.test(S("김").note), S("김").note);

console.log("\n" + (fail ? `실패 ${fail}건 / 통과 ${pass}건` : `모두 통과 (${pass}건)`));
process.exit(fail ? 1 : 0);
