/**
 * 고유ID 없는 건은 «대상이 아니다» — 실패로 세지 않는다
 *
 *  > "고유아이디가 없는건 이제 무시할꺼야.. 몇달을 해도 매칭율이 10%도 안되"
 *  > "판매현황에 고유아이디를 붙이는 작업을 하는거고..
 *  >  고유아이디를 붙였는데도 못하면 포기하는게 맞다고 생각해"
 *      — 2026-09-16
 *
 *  ★ 셈법이 바뀐다 ★
 *    ① 고유ID 붙은 주문 중 송장을 찾은 것   ← 이것이 매칭률
 *    ② 고유ID 붙었는데 못 찾은 것           ← 여기만 파면 된다
 *    ③ 고유ID 가 안 붙은 것                 ← 실패가 아니다. ID 발급 쪽 일
 *
 *    ③ 을 분모에 섞으면 몇 달을 고쳐도 10% 밑으로 보인다. 그러면 무엇이
 *    진짜 문제인지 영영 안 보이고, 고치는 사람도 지친다.
 *
 *  ★ 조용히 버리지 않는다 ★
 *    맵이 거절한 조합키 수를 센다. 어느 날 갑자기 늘면 「고유ID 가 안 찍히기
 *    시작했다」는 뜻이고, 그건 매칭보다 앞선 문제다.
 *
 * 실행: node _uidonly_test.js
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
const web = fs.readFileSync("_partnerWebApp.gs", "utf8");

const ctx = {
  _PEP_MAP_REFUSED_: 0,
  _pep_splitInvNos_: (v) => String(v || "").split(/[^0-9]+/).filter((x) => x.length >= 9),
  _pep_ymdNum_: () => 0,
};
vm.createContext(ctx);
["_pep_normalizeMatchUid_", "_pep_uidFromOrdererCell_", "_pep_isRealUid_", "_pep_addInvoiceMap_",
 "_pep_lookupInvoiceMap_"].forEach((n) => vm.runInContext(grab(pep, n), ctx));

function 넣기(키, 송장) {
  ctx.__m = ctx.__m || {};
  vm.runInContext("_pep_addInvoiceMap_(__m, " + JSON.stringify(키) + ", " +
    JSON.stringify(송장) + ", '시험')", ctx);
  return ctx.__m;
}
const 새맵 = () => { ctx.__m = {}; ctx._PEP_MAP_REFUSED_ = 0; return ctx.__m; };
const 거절수 = () => vm.runInContext("_PEP_MAP_REFUSED_", ctx);

console.log("\n[1] ★ 고유ID 는 들어간다");
{
  새맵();
  넣기("0916-ds-ab12", "1234567890");
  check("★ 우리가 발급한 대리판매 ID", !!ctx.__m["0916-ds-ab12"], true);
  넣기("0916-ph-9f3a", "1234567891");
  check("★ 전화주문 ID 도 들어간다", !!ctx.__m["0916-ph-9f3a"], true);
  넣기("SB2026091500123", "1234567892");
  check("★ 사방넷 주문번호", !!ctx.__m["SB2026091500123"], true);
  check("거절 없음", 거절수(), 0);
}

console.log("\n[2] ★ 고유ID 가 아닌 열쇠는 «안 들어간다»");
{
  새맵();
  ["TEL:01012345678", "NAME:김철수", "NPI:김철수|01012345678|미니탕", "김철수", "FB:1234"]
    .forEach((k, i) => {
      넣기(k, "12345678" + (90 + i));
      check("★ 막는다: " + k, ctx.__m[k] === undefined, true);
    });
  check("★ 몇 개를 거절했는지 «센다»", 거절수(), 5);
}

console.log("\n[3] ★ 「이름/고유ID」는 뒤쪽이 들어간다 — 사람은 안 들어간다");
{
  /*  마감 표 M열이 이 모양이다. 통째로는 막되, 슬래시 뒤의 진짜 ID 는 살린다.  */
  새맵();
  넣기("김철수/0916-ds-ab12", "1234567890");
  check("★ 고유ID 로는 들어갔다", !!ctx.__m["0916-ds-ab12"], true);
  check("★ 이름 붙은 통째 열쇠는 없다", ctx.__m["김철수/0916-ds-ab12"] === undefined, true);
}

console.log("\n[4] ★ 「1단계 나」가 사라졌다 — 헛되이 돌지 않는다");
{
  /*  _pep_resolveRowInvoice_ 는 고유ID 가 아니면 맨 앞에서 null 을 준다.
      그런데도 되돌이가 줄 수만큼 lookup 을 돌고 있었다. 한 건도 못 붙이면서.  */
  const 몸 = pep.slice(pep.indexOf("// 1단계 가"), pep.indexOf("result.detail.uidMatched ="));
  const 나 = 몸.slice(몸.indexOf("for (var wi2"));
  check("★ 고유ID 없는 되돌이가 lookup 을 안 한다", 나.indexOf("_pep_resolveRowInvoice_") < 0, true);
  check("★ 세기는 한다", 나.indexOf("_noUidTried_++") >= 0, true);
  check("고유ID 있는 쪽은 그대로 찾는다", 몸.indexOf("_pep_resolveRowInvoice_") >= 0, true);
}

console.log("\n[5] ★ 매칭률의 분모는 «고유ID 붙은 주문»이다");
{
  const 몸 = pep.slice(pep.indexOf("result.detail.uidMatched ="), pep.indexOf("// ★ 같은 수취인"));
  check("★ 분모가 uidTried 다", /uidRate = _uidTried_/.test(몸), true);
  check("★ 분자가 uidHit 다", /_uidHit_ \* 100\) \/ _uidTried_/.test(몸), true);
  check("★ 대상 아닌 것을 따로 남긴다", 몸.indexOf("noUidSkipped = _noUidTried_") >= 0, true);
  check("★ 거절 수도 남긴다", 몸.indexOf("mapRefused = _PEP_MAP_REFUSED_") >= 0, true);
  check("실행마다 새로 센다", pep.indexOf("_PEP_MAP_REFUSED_ = 0;") >= 0, true);
}

console.log("\n[6] ★ 사람이 읽는 글에서도 셋이 갈린다");
{
  check("★ 매칭률을 보여 준다", web.indexOf("result.detail.uidRate") >= 0, true);
  check("★ 「ID 는 있는데 못 찾음」을 따로 적는다",
    web.indexOf("ID 는 있는데 송장을 못 찾음") >= 0, true);
  check("★ 「대상 아님」이라고 적는다", web.indexOf("고유ID 가 안 붙어 대상 아님") >= 0, true);
  check("★ 「고유ID없음 매칭」이라는 옛 문구가 없다", web.indexOf("고유ID없음 매칭") < 0, true);
}

console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
