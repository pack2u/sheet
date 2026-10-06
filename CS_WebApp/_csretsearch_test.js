/**
 * ══════════════════════════════════════════════════════════════
 *  반품 검색 — 완료된 건과 오래된 진행 건도 찾아진다
 *  2026-10-06
 *
 *  > "현재 반품 카드 검색이 안되는게 9월과 10월 열 배열이 바뀌어서
 *  >  그런거 같은데.. 9월도 보일수 있게 해줘"
 *
 *  ★ 열 배열 탓이 아니었다 ★
 *    매핑은 9월·10월 모두 제대로 된다(머리글 이름으로 찾으므로).
 *    막힌 곳은 둘이었다 —
 *
 *    ① 화면: filterReturnRows 가 첫 줄에서 완료 카드를 «무조건» 걷어냈다.
 *       부르는 쪽은 2026-09-30부터 완료 목록을 합쳐 넘기는데, 받는 쪽이
 *       그것을 다시 버렸다. 그래서 「검색에서 완료도 보이게」가 넣은 그날부터
 *       막혀 있었고, 아무도 몰랐다 — 오류가 아니라 «안 나오는» 것이라서.
 *       실측: 9월 반품 276건 중 151건이 완료.
 *
 *    ② 서버: 검색용 목록이 「완료」만이었다. 그래서 «진행인데 30일보다
 *       오래된» 줄은 두 묶음 어디에도 없었다. 실측: 202608 의 진행 36건.
 *
 *  ★ 왜 시험이 있나 ★
 *    이 고장은 조용하다. 화면에 오류가 안 뜨고, 그냥 «안 나온다».
 *    그러면 CS 는 「접수가 안 됐다」고 보고 다시 만든다 — 그게 9/30 에
 *    사장님이 말한 그 일이고, 고쳤다고 한 뒤에도 계속되고 있었다.
 *
 *  돌리는 법   node CS_WebApp/_csretsearch_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
const GS = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ✔ " + 이름); return; }
  틀린것++;
  console.log("  ✗ " + 이름 + (덧붙임 ? "\n      " + 덧붙임 : ""));
}

/** 함수 하나를 떠낸다 */
function 꺼내(src, 이름) {
  const i = src.indexOf("function " + 이름 + "(");
  if (i < 0) return null;
  const j = src.indexOf("{", i);
  let 깊이 = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (깊이 === 0) return src.slice(i, k + 1); }
  }
  return null;
}

/* ── ① 화면: 찾을 때는 완료를 남긴다 ─────────────────────── */
console.log("─── ① 화면 — filterReturnRows ───");
const ctx = { String, Object, Number, Array, Math, console, RegExp };
vm.createContext(ctx);
for (const n of ["isReturnCardDone", "returnSearchHaystack", "filterReturnRows"]) {
  const f = 꺼내(HTML, n);
  if (!f) { console.log("★ " + n + " 을 못 찾음"); process.exit(1); }
  vm.runInContext(f, ctx);
}
const 걸러 = (a, q) => vm.runInContext("filterReturnRows", ctx)(a, q);

const 카드 = (이름, 상태, 더) => Object.assign({
  name: 이름, status: 상태, item: "", phone: "", phoneDigits: "", phoneSub: "",
  phone2Digits: "", invoice: "", invDigits: "", returnInvoice: "", returnInvDigits: "",
  staff: "", tab: "202609", type: "", vendor: "", notice: "", fee: "", row: 10,
  date: "260901", uid: ""
}, 더 || {});

const 진행건 = 카드("김진행", "접수");
const 완료건 = 카드("박완료", "완료");
const 이카건 = 카드("최이카", "이카운트OK");

ok("찾는 말이 없으면 완료는 안 보인다 (할 일 목록)",
  걸러([진행건, 완료건], "").length === 1 &&
  걸러([진행건, 완료건], "")[0].name === "김진행",
  "완료를 늘 섞으면 할 일이 안 보인다");

ok("★ 이름으로 찾으면 완료도 나온다 ★",
  걸러([진행건, 완료건], "박완료").length === 1,
  "이것이 2026-09-30부터 막혀 있던 바로 그것이다");

ok("★ 「이카운트OK」도 나온다 ★", 걸러([진행건, 이카건], "최이카").length === 1,
  "완료 표시가 「완료」만은 아니다");

ok("진행 건은 그대로 찾아진다", 걸러([진행건, 완료건], "김진행").length === 1);

ok("섞여 있어도 둘 다 찾는다",
  걸러([진행건, 완료건], "건").length === 0 ||
  걸러([카드("같은이름", "접수"), 카드("같은이름", "완료")], "같은이름").length === 2,
  "같은 이름이면 진행·완료 둘 다 나와야 한다");

ok("찾는 말이 안 맞으면 안 나온다", 걸러([진행건, 완료건], "없는사람").length === 0);

//  ★ 첫 줄이 다시 완료를 걷어내지 않는지 글자로도 못 박는다 ★
const f걸러 = 꺼내(HTML, "filterReturnRows");
ok("완료 걷어내기가 «찾는 말이 없을 때»로 묶여 있다",
  /q \? \(all \|\| \[\]\)\.slice\(\)/.test(f걸러) &&
  !/^\s*all = \(all \|\| \[\]\)\.filter\(function\s*\(c\)\s*\{\s*return !isReturnCardDone\(c\);/m.test(f걸러),
  "무조건 걷어내면 부르는 쪽이 합쳐 넘긴 완료 목록이 그 자리에서 버려진다");

/* ── ② 서버: 검색용 목록은 「목록에 없는 것」이다 ────────── */
console.log("\n─── ② 서버 — csListActiveReturnCases ───");
const f목록 = 꺼내(GS, "csListActiveReturnCases");
ok("검색용 목록을 «목록에 없는 줄»로 담는다",
  /목록에있나\[/.test(f목록) && /if \(!목록에있나\[/.test(f목록),
  "「완료만」으로 담으면 진행인데 30일보다 오래된 줄이 어디에도 없다");
ok("(탭, 행)으로 가린다", /\.tab\) \+ "\|" \+ String\(/.test(f목록),
  "열쇠가 없으면 같은 줄이 목록과 검색에 두 번 들어간다");
ok("완료만 담던 옛 줄이 남아 있지 않다", !/if \(!allRows\[i\]\.active\) doneRows\.push/.test(f목록));
ok("기간은 넓은 쪽(45일)으로 한 번 읽는다", /wideDays = Math\.max\(days, _CS_RETURN_DONE_DAYS_\)/.test(f목록));

/* ── ③ 부르는 쪽이 합쳐 넘기나 ───────────────────────────── */
console.log("\n─── ③ 화면이 두 목록을 합쳐 넘기나 ───");
ok("찾을 때만 완료 목록을 합친다",
  /RETURN_QUERY && RETURN_DONE_ROWS\.length[\s\S]{0,80}RETURN_ALL_ROWS\.concat\(RETURN_DONE_ROWS\)/.test(HTML),
  "합치지 않으면 서버가 보낸 목록이 화면에 닿지 않는다");
ok("그 결과를 filterReturnRows 에 넘긴다", /filterReturnRows\(뒤질것, RETURN_QUERY\)/.test(HTML));
ok("서버가 보낸 doneRows 를 받아 둔다", /RETURN_DONE_ROWS = res\.doneRows \|\| \[\]/.test(HTML));

/* ── ④ 열 배열은 탓이 아니었다 — 머리글로 찾는다 ────────── */
console.log("\n─── ④ 9월·10월 열 배열이 달라도 찾는다 ───");
const f매핑 = 꺼내(GS, "_cs_mapReturnLedgerCols_");
for (const [이름, 재는것] of [
  ["접수날짜", /col\.date < 0 && \/반품접수날짜\|접수날짜\|접수일자\//],
  ["수취인", /col\.name < 0 &&/],
  ["원송장", /col\.invoice < 0 &&/],
]) {
  ok(이름 + " 을 «머리글 이름»으로 찾는다", 재는것.test(f매핑),
    "자리로 못 박으면 9월(머리글 9행)과 10월(1행)이 어긋난다");
}
ok("머리글 줄을 스스로 찾는다", /_cs_findReturnHeaderRow_/.test(GS),
  "9월은 머리글이 9행, 10월은 1행이다");

console.log("\n" + (틀린것 ? "✗ " : "✅ ") + 잰것 + "개 중 " + 틀린것 + "개 틀렸습니다.");
process.exit(틀린것 ? 1 : 0);
