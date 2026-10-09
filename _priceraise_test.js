/**
 * ══════════════════════════════════════════════════════════════
 *  단가 인상 적용 — 틀린 줄에 값을 적지 않는가
 *  2026-10-09
 *
 *  > "시트에서 확인 체크하는 열을 만들어서 체크한 부분만 적용되게"
 *
 *  ★ 무엇이 무서운가 ★
 *    업체 품명과 우리 상품명이 다르다. 기계가 붙인 것 가운데 틀린 것이 섞인다.
 *    틀린 줄에 단가를 적으면 «엉뚱한 품목»이 비싸진다 — 그 뒤로 발주·명세서·
 *    정산이 전부 그 값을 믿는다. 조용히 틀리고, 되돌리기 어렵다.
 *
 *  그래서 이 시험은 «맞게 붙었나»보다 «함부로 안 적는가»를 센다.
 *
 *  실행: node _priceraise_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const vm = require("vm");

const SRC = fs.readFileSync("_partnerPriceRaise.gs", "utf8");
const MENU = fs.readFileSync("_partnerMenu.gs", "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ok   " + 이름); return; }
  틀린것++;
  console.log("  FAIL " + 이름 + (덧붙임 ? "\n         " + 덧붙임 : ""));
}
function eq(이름, 얻은, 바란) {
  ok(이름 + "  →  " + JSON.stringify(얻은),
    JSON.stringify(얻은) === JSON.stringify(바란), "기대 " + JSON.stringify(바란));
}

/* ── 순수 함수만 떠내 돌린다 (GAS 없이) ────────────────── */
function 꺼내(이름) {
  const i = SRC.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 없음");
  const j = SRC.indexOf("{", i);
  let d = 0;
  for (let k = j; k < SRC.length; k++) {
    if (SRC[k] === "{") d++;
    else if (SRC[k] === "}") { d--; if (!d) return SRC.slice(i, k + 1); }
  }
  throw new Error(이름 + " 끝을 못 찾음");
}
const ctx = { String, Number, Math, JSON, console };
vm.createContext(ctx);
vm.runInContext([
  (SRC.match(/var _PR_SIZE_ = \[[^\]]*\];/) || [""])[0],
  (SRC.match(/var _PR_VAT_ = [\d.]+;/) || [""])[0],
  (SRC.match(/var _PR_PRICE_ = \[[\s\S]*?\n\];/) || [""])[0],
  (SRC.match(/var _PR_PAIR_ = \[[\s\S]*?\n\];/) || [""])[0],
  꺼내("_pr_norm_"), 꺼내("_pr_vnorm_"), 꺼내("_pr_words_"),
  꺼내("_pr_size_"), 꺼내("_pr_kind_"), 꺼내("_pr_setPrice_"),
].join("\n"), ctx);
const F = (n) => vm.runInContext(n, ctx);

/* ── [1] 자료가 온전한가 ────────────────────────────────── */
console.log("\n[1] 단가표·짝 자료");
const P = F("_PR_PRICE_"), PAIR = F("_PR_PAIR_");
ok("단가표를 읽었다 (" + P.length + "줄)", P.length >= 150);
ok("짝을 읽었다 (" + PAIR.length + "줄)", PAIR.length >= 50);
ok("★ 업체는 둘뿐 (정희·콤콤)",
  [...new Set(P.map((r) => r[0]))].sort().join(",") === "정희,콤콤");
/*  동결(*)은 인상단가를 종전과 «같게» 담아 두었다. 비워 두면 적용 때 0 이 들어간다. */
const 동결들 = P.filter((r) => r[6] === 1);
ok("★ 동결 줄은 인상단가 = 종전단가", 동결들.every((r) => r[4] === r[5]),
  "비워 두면 적용에서 0 원이 됩니다");
ok("  동결이 아닌데 값이 둘 다 있으면 서로 다르다",
  P.filter((r) => r[6] !== 1 && r[4] != null && r[5] != null).every((r) => r[4] !== r[5]));
/*  돈이 음수이거나 터무니없이 크면 베껴 적다 틀린 것이다 */
ok("★ 단가가 0 이하이거나 10만원 넘는 줄이 없다",
  P.every((r) => (r[4] == null || (r[4] > 0 && r[4] < 100000)) &&
                 (r[5] == null || (r[5] > 0 && r[5] < 100000))));

/*  ★ 인하도 있다 ★ 전부 오르기만 한다고 치면 JH신죽 두 줄을 놓친다. */
const 인하 = P.filter((r) => r[4] != null && r[5] != null && r[5] < r[4]);
ok("★ 내려가는 줄도 담겨 있다 (" + 인하.length + "줄)", 인하.length >= 2,
  "PDF 에 파란 글씨로 적힌 인하분입니다");

/* ── [2] 이름 다듬기 ───────────────────────────────────── */
console.log("\n[2] 이름을 견줄 수 있게 다듬는다");
const norm = F("_pr_norm_"), vnorm = F("_pr_vnorm_");
eq("괄호를 뗀다", norm("105파이(소)"), "105파이소");
eq("  꼬리표를 뗀다", norm("JH 사각찜 J2 소 100개---몸통만"), "사각찜j2소100개");
eq("  JH 머리말을 뗀다", norm("JH 실링 23195 화이트"), "실링23195화이트");
eq("★ 원장 이름의 색 꼬리를 뗀다", vnorm("23195/백색"), "23195");
eq("  수량 꼬리도 뗀다", vnorm("105파이대셋/백색/1000셋트"), "105파이대셋");
eq("  ★ 표도 뗀다", vnorm("★신밀폐201,202뚜껑"), "신밀폐201202뚜껑");

/* ── [3] ★ 낱말 — 한 자로 걸면 안 된다 ★ ───────────────── */
console.log("\n[3] 낱말은 두 자부터");
const words = F("_pr_words_");
ok("★ 한 자짜리는 안 쓴다 (「소」로 걸면 소스·소분이 다 걸린다)",
  words("신삼계탕(소)").every((w) => w.length >= 2));
ok("  크기말을 뗀 알맹이가 남는다", words("신삼계탕(중)158Ø").indexOf("신삼계탕") >= 0);
ok("  긴 숫자는 쓴다", words("신삼계탕(중)158Ø").indexOf("158") >= 0);
ok("★ 두 자리 미만 숫자는 안 쓴다", words("3칸찬용기").every((w) => !/^\d$/.test(w)));

const size = F("_pr_size_");
eq("크기 — 특대가 대보다 먼저 잡힌다", size("밀폐죽(특대)"), "특대");
eq("  소", size("225파이탕(소)"), "소");
eq("  없으면 빈칸", size("12144 용기"), "");

/* ── [4] 갈래 ──────────────────────────────────────────── */
console.log("\n[4] 세트·몸통·뚜껑·소분을 가른다");
const kind = F("_pr_kind_");
eq("몸통", kind("JH 감자탕 특대 200개---몸통만"), "몸통");
eq("뚜껑", kind("JH 감자탕 특대 200개---뚜껑만"), "뚜껑");
eq("세트", kind("JH 68파이 특소 화이트 3000 SET"), "세트");
eq("★ 소분이 세트보다 먼저다", kind("JH 감자탕 특대 (50*2팩) 100세트--/소분"), "소분");
eq("그밖", kind("JH 실링 23195 화이트 600개"), "그밖");

/* ── [5] 세트 단가는 비고에서만 ────────────────────────── */
console.log("\n[5] 세트는 낱개가를 그대로 쓰면 안 된다");
/*  세트 = 몸통 + 뚜껑 이다. 업체가 비고에 적어 준 「셋51.5」가 그 값이다.
    낱개가(37)를 세트 줄에 적으면 세트가 반값이 된다.                     */
const sp = F("_pr_setPrice_");
eq("셋51.5 를 읽는다", sp("셋51.5"), 51.5);
eq("  공백이 있어도", sp("셋 12.9"), 12.9);
eq("  없으면 null", sp(""), null);
eq("  엉뚱한 글자면 null", sp("뚜껑60"), null);
ok("★ 세트 줄은 비고가 있을 때만 값을 제안한다",
  /u\.kind === "세트"[\s\S]{0,200}_pr_setPrice_\(비고\)/.test(SRC));
ok("★ 소분 줄은 아예 비워 둔다 (단가가 따로 계산된다)",
  /u\.kind === "소분"[\s\S]{0,120}적용후 = "";/.test(SRC));

/* ── [6] ★ 체크한 줄만 간다 ★ ──────────────────────────── */
console.log("\n[6] 체크 안 한 줄은 절대 안 바꾼다");
ok("★ 체크(true)인 줄만 모은다", /vals\[i\]\[_PR_C\.적용 - 1\] !== true\) continue;/.test(SRC),
  "빈칸·문자열을 참으로 치면 안 됩니다");
ok("★ 기본 체크는 ①② 만 켠다",
  /켜기 = \(m\.근거\.indexOf\("①"\) === 0 \|\| m\.근거\.indexOf\("②"\) === 0\)/.test(SRC));
ok("  값이 비었거나 지금과 같으면 안 켠다",
  /적용후 !== "" && u\.net != null && Number\(적용후\) !== Number\(u\.net\)/.test(SRC));
ok("★ ③값만은 꺼진 채로 둔다 (켜는 규칙에 ③이 없다)",
  !/indexOf\("③"\) === 0\s*\|\|/.test(SRC));

/* ── [7] 적용 전 안전장치 ──────────────────────────────── */
console.log("\n[7] 적으면 되돌리기 어렵다 — 먼저 지킨다");
ok("★ 미리보기가 따로 있다 (아무것도 안 바꾼다)",
  /function partnerPriceRaisePreview\(\) \{ _pr_applyProduct_\(true\); \}/.test(SRC));
ok("★ 바꾸기 전에 묻는다", /ButtonSet\.YES_NO/.test(SRC));
ok("★ 옛 값을 이력 탭에 «먼저» 남긴다",
  SRC.indexOf("이력.push") < SRC.indexOf("ptab.getRange(b.p.row, _PR_P_NET_).setValue"),
  "덮어쓰고 나면 되짚을 데가 없습니다");
ok("  부가세 포함 값도 같이 바꾼다 (한쪽만 고치면 갈라진다)",
  /_PR_P_GROSS_\)\.setValue\(Math\.round\(b\.새값 \* _PR_VAT_/.test(SRC));
ok("★ 0 이하는 안 적는다", /적용후 가 0 이하/.test(SRC) || /!\(Number\(적용후\) > 0\)/.test(SRC));
ok("★ 상품정보에 없는 코드면 건너뛴다", /를 못 찾았습니다/.test(SRC));
ok("  건너뛴 까닭을 줄마다 적는다", /_PR_C\.결과\)\.setValue\(결과\[i\]\[0\]\)/.test(SRC));

/* ── [8] 샘플은 안 건드린다 ────────────────────────────── */
console.log("\n[8] 샘플·빈 줄");
ok("★ [샘플] 품목은 아예 안 싣는다", /if \(\/\\\[샘플\\\]\/\.test\(name\)\) continue;/.test(SRC),
  "샘플은 재고가 아니라 전시용입니다");

/* ── [9] 누적품목매핑 ──────────────────────────────────── */
console.log("\n[9] 누적품목매핑에 쌓기");
ok("★ 이미 있는 짝은 안 쌓는다", /if \(있나\[code \+ "\\u0000" \+ 업체명\]\) \{ 건너\+\+; continue; \}/.test(SRC));
ok("★ 업체명은 «원장 이름»을 먼저 쓴다",
  /_PR_C\.원장품명 - 1\] \|\| ""\)\.trim\(\) \|\|[\s\S]{0,80}_PR_C\.업체품명/.test(SRC),
  "다음 달 원장과 맞댈 때 그대로 걸려야 합니다");

/* ── [10] 메뉴 ─────────────────────────────────────────── */
console.log("\n[10] 메뉴");
ok("★ 새 파트를 안 만들었다 (파트가 이미 열셋이다)",
  !/createMenu\("💹 단가 인상 \(정희·콤콤\)"\)[\s\S]{0,40}\.addToUi/.test(MENU));
ok("  「정산 비교 검증」 안에 들어갔다",
  /createMenu\("📑 정산 비교 검증"\)[\s\S]{0,600}💹 단가 인상/.test(MENU));
["partnerPriceRaiseBuild", "partnerPriceRaisePreview", "partnerPriceRaiseApply",
 "partnerPriceRaiseApplyMapping", "partnerPriceRaiseCheckSets"].forEach((fn) => {
  ok("  메뉴가 " + fn + " 을 가리키고 그 함수가 있다",
    MENU.indexOf('"' + fn + '"') >= 0 && SRC.indexOf("function " + fn + "(") >= 0);
});

console.log("");
console.log(틀린것 ? "실패 " + 틀린것 + "건 / 통과 " + (잰것 - 틀린것)
                  : "모두 통과 (" + 잰것 + "건)");
process.exit(틀린것 ? 1 : 0);
