/**
 * 로컬 검증: 품목 추적이 «칸을 고르지 않고» 뒤지는가
 *
 *  > 품목 추적 결과: 판매현황_임시기록 557행 · 품목명 열 = D
 *  >                 → "어림지해장국" 포함 0건
 *
 *  0건이 나온 것은 없어서가 아니라 «안 뒤져서»였다.
 *    ① 한 줄에서 세 칸(매칭키·D·품목명)만 봤다. 「어림지해장국」은 수취인이다.
 *    ② 판매현황_임시기록만 봤다. 대리발송 건은 대리공급_임시기록(과 _보관),
 *       협력업체_발주허브에 산다.
 *
 *  「없습니다」는 가장 위험한 답이다 — 사람이 그 말을 믿고 다른 데를 찾는다.
 *
 * 실행: node _pti_scope_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const src = fs.readFileSync("_partnerTraceItem.gs", "utf8");
function grab(name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(grab("_pti_rowHas_"), ctx);
const has = (row, kw) => ctx._pti_rowHas_(row, String(kw).toUpperCase());

console.log("\n[뒤지기] 칸을 고르지 않는다");
{
  //  판매현황_임시기록 한 줄 흉내 — O열(14)이 수취인
  const 줄 = [];
  줄[0] = "2026-09-14"; 줄[1] = "0914-ds-b2ec"; 줄[3] = "MATYG0076-2";
  줄[4] = "TY 158파이 삼계탕 중 300개"; 줄[14] = "어림지해장국"; 줄[15] = "010-5543-0557";

  check("★ 수취인(O열)으로도 찾는다 — 옛 코드가 0건을 낸 그 말", has(줄, "어림지해장국"), true);
  check("고유ID(B열)로 찾는다", has(줄, "0914-ds-b2ec"), true);
  check("품목코드(D열)로 찾는다", has(줄, "MATYG0076"), true);
  check("품목명으로 찾는다", has(줄, "삼계탕"), true);
  check("전화로도 찾는다", has(줄, "5543-0557"), true);
  check("없는 말은 없다", has(줄, "없는가게"), false);
  check("빈 칸을 건너뛴다 (undefined 에 안 걸린다)", has(줄, "UNDEFINED"), false);
  check("대소문자를 안 가린다", has(줄, "matyg0076"), true);
  check("빈 줄", has([], "무엇"), false);
}

console.log("\n[소스] 좁게 뒤지던 옛 코드가 사라졌는가");
{
  check("★ 세 칸만 보던 줄이 사라졌다",
    src.includes('var joined = [sData[i][1], sData[i][3], sData[i][itemCol]].join(" ");'), false);
  check("★ 줄 전체를 본다",
    src.includes("if (!_pti_rowHas_(sData[i], kw.toUpperCase())) continue;"), true);
}

console.log("\n[소스] 못 찾으면 «어디를 찾아봤는지» 말하는가");
{
  check("★ 밖도 뒤진다", src.includes("var 밖 = _pti_lookOutside_(kw);"), true);
  check("★ 대리공급_임시기록", src.includes('이름: "대리공급_임시기록"'), true);
  check("★ 그 보관 탭도", src.includes('이름: "대리공급_임시기록_보관"'), true);
  check("★ 발주허브도", src.includes('이름: "협력업체_발주허브"'), true);
  check("★ 그 탭의 «송장 칸»을 이름으로 찾는다",
    src.includes('hn.indexOf("송장") !== -1 || hn.indexOf("운송장") !== -1'), true);
  check("★ 반품송장은 안 집는다",
    src.includes('hn.indexOf("반품") === -1'), true);
  check("★ 송장 칸을 못 찾으면 «못 찾았다»고 적는다",
    src.includes("⚠ 송장 칸을 못 찾음"), true);
  check("★ 송장이 빈 줄인지 찬 줄인지 센다",
    src.includes("송장 있는 줄 "), true);
  check("★ 밖을 못 읽어도 추적은 끝까지 간다",
    src.includes("(밖을 못 읽었습니다: "), true);
  check("★ 「없습니다」로 끝내지 않는다",
    src.includes('L.push("판매현황_임시기록에 해당 건이 없습니다.");'), false);
}

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
