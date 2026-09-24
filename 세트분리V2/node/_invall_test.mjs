/**
 * 한 칸의 글자 → 송장번호들 (ssInvAll_)
 *
 *  실행 결과가 이랬다:
 *    자사출고 송장탭: 로젠 816줄(머리글 없음 → 자리로 · 주문 J(9) · 송장 K(10))
 *    · 원천 · 롯데 0        ← 816줄을 읽고도 표가 비었다
 *    · 사방넷송장 · 미매칭 571
 *
 *  ★ 하이픈이 «구분자»로 잘리고 있었다 ★
 *    split(/[^0-9]+/) 는 숫자가 아닌 글자를 모두 구분자로 본다.
 *    로젠은 송장을 「451-6945-9705」 로 찍는다 →  451 · 6945 · 9705 세 토막,
 *    전부 9자리 미만이라 다 버려진다. 오류는 안 난다 —
 *    읽은 «줄 수»만 세고 있어서 816 으로 보였다.
 *
 *  진짜 구분자는 줄바꿈·공백·쉼표·세미콜론·/·| 다(SSB_INV_SPLIT).
 *  한 칸에 송장이 여러 장일 때 그것들로 이어 적는다.
 *
 * 실행: node _invall_test.mjs
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
const bulk = readFileSync("../gasBulk.js", "utf8");

function grab(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 없음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
}
//  SSB_INV_SPLIT 정의를 gasBulk 에서 그대로 가져온다 — 시험이 규칙을 베끼지 않게
const i0 = bulk.indexOf("var SSB_INV_SPLIT =");
const 분리정의 = bulk.slice(i0, bulk.indexOf(";", bulk.indexOf("]+')", i0)) + 1);

const ctx = {};
vm.createContext(ctx);
vm.runInContext([분리정의, grab(main, "ssInvAll_"), grab(main, "ssInvPut_")].join("\n"), ctx);

console.log("\n[로젠] 하이픈이 붙은 채로 온다");
eq("★ 451-6945-9705 → 한 장", ctx.ssInvAll_("451-6945-9705"), ["45169459705"]);
eq("하이픈 없이 적어도 같은 값", ctx.ssInvAll_("45169459705"), ["45169459705"]);
eq("★ 11자리가 지켜진다", ctx.ssInvAll_("451-6945-9705")[0].length, 11);

console.log("\n[롯데] 12자리도 그대로");
eq("463273768403", ctx.ssInvAll_("463273768403"), ["463273768403"]);

console.log("\n[여러 장] 진짜 구분자로만 나눈다");
eq("공백", ctx.ssInvAll_("451-6945-9705 451-6946-0195"),
  ["45169459705", "45169460195"]);
eq("줄바꿈", ctx.ssInvAll_("451-6945-9705\n451-6946-0195"),
  ["45169459705", "45169460195"]);
eq("쉼표", ctx.ssInvAll_("45169459705,45169460195"),
  ["45169459705", "45169460195"]);
eq("같은 번호가 두 번이면 한 번만", ctx.ssInvAll_("45169459705 45169459705"),
  ["45169459705"]);

console.log("\n[아닌 것] 지어내지 않는다");
eq("송장이 아닌 말", ctx.ssInvAll_("재고확인 후 판단"), []);
eq("빈칸", ctx.ssInvAll_(""), []);
eq("9자리 미만은 버린다", ctx.ssInvAll_("451-6945"), []);
eq("null 도 안전", ctx.ssInvAll_(null), []);

console.log("\n[표에 담긴다] 816줄이 0건이 되지 않게");
{
  const map = {};
  ctx.ssInvPut_(map, "2162784744", "451-6945-9705", "로젠택배");
  ctx.ssInvPut_(map, "2162785020", "451-6945-9716", "로젠택배");
  eq("★ 두 건이 표에 담긴다", Object.keys(map).length, 2);
  eq("송장이 들어 있다", map["2162784744"].list, ["45169459705"]);
  eq("택배사도 실린다", map["2162784744"].c, "로젠택배");
  //  한 주문에 20박스 — 덮지 말고 모아야 한다
  ctx.ssInvPut_(map, "2162784744", "451-6946-0195", "로젠택배");
  eq("★ 같은 주문번호면 모은다 (덮지 않는다)",
    map["2162784744"].list, ["45169459705", "45169460195"]);
}

console.log("\n[한 군데] 분리 규칙을 두 번 적지 않는다");
eq("★ gasMain 이 SSB_INV_SPLIT 을 쓴다",
  main.includes("split(SSB_INV_SPLIT)"), true);
//  ★ 주석이 아니라 «코드»를 본다 ★ 내가 까닭을 적은 주석에 그 글자가 들어 있어
//     소스 전체를 찾으면 늘 걸린다. 떼어 낸 함수 본문만 본다.
const 본문 = grab(main, "ssInvAll_");
eq("★ 숫자 아닌 것을 통째로 자르던 줄이 사라졌다",
  본문.includes("split(/[^0-9]+/)"), false);

console.log("\n" + (fail ? "실패 " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
