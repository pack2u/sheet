/**
 * csLogistics.gs 로컬 검증 — 실제 현장 라벨에서 뽑은 값으로 고정한다.
 *
 * ★ 왜 이 테스트가 있나 ★
 *   반품회수 라벨에는 안심번호(0504-XXXX-XXXX)가 크게 인쇄돼 있는데
 *   송장번호와 자릿수·하이픈 모양이 완전히 같다. OCR 이 이걸 집으면
 *   매칭이 통째로 어긋난다. 앞자리로 가르는 규칙이 깨지지 않게 묶어둔다.
 *
 *   아래 번호는 전부 실제 라벨 사진에서 읽은 값이다. 임의로 바꾸지 말 것.
 *
 * 실행: node _csl_match_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");
const vm = require("vm");

const SRC = "csLogistics.gs";
const lines = fs.readFileSync(SRC, "utf8").split(/\r?\n/);

try {
  new vm.Script(lines.join("\n"));
  console.log("구문 검사(" + SRC + "): OK\n");
} catch (e) {
  console.log("구문 검사(" + SRC + "): 실패 — " + e.message);
  process.exit(1);
}

function grab(name) {
  const s = lines.findIndex(l => l.indexOf("function " + name + "(") === 0);
  if (s < 0) throw new Error(name + " 없음");
  let e = s;
  while (lines[e] !== "}") e++;
  return lines.slice(s, e + 1).join("\n");
}
const _CSL_TAIL_MIN_ = Number(
  (lines.find(l => l.indexOf("var _CSL_TAIL_MIN_") === 0) || "").match(/=\s*(\d+)/)[1]
);
eval(grab("_csl_digits_"));
eval(grab("_csl_looksLikeInvoice_"));

// ── 실제 라벨에서 읽은 값 ──────────────────────────────
const 운송장 = [
  "2581-3149-4106", "2581-3149-4110", "2627-7218-4102", "2539-0373-5455",
  "2606-7032-7816", "2632-1398-3340", "2559-2946-2515", "2566-3542-6036",
  "2544-4055-6171"
];
const 원송장 = [
  "2599-9895-1133", "2599-9889-3814", "2679-4525-9912", "2679-4526-0004",
  "2679-4526-2793", "2879-4519-0041", "2679-4531-5055"
];
const 안심번호 = [
  "0504-1889-0003", "0504-1355-7439", "0504-4931-3640",
  "0502-1822-6904", "0502-1420-5829", "0502-4385-7475"
];
const 일반전화 = ["031-923-7795", "010-6239-8832", "010-9901-9202"];

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  OK " : "  NG ") + label);
}

console.log("── 송장번호는 통과해야 한다 ──");
운송장.concat(원송장).forEach(function (s) {
  ok("송장 " + s, _csl_looksLikeInvoice_(_csl_digits_(s)) === true);
});

console.log("\n── 안심번호·전화는 걸러져야 한다 (같은 12자리 하이픈 형식) ──");
안심번호.forEach(function (s) {
  ok("안심 " + s + " 배제", _csl_looksLikeInvoice_(_csl_digits_(s)) === false);
});
일반전화.forEach(function (s) {
  ok("전화 " + s + " 배제", _csl_looksLikeInvoice_(_csl_digits_(s)) === false);
});

console.log("\n── 경계 ──");
ok("빈값 배제", _csl_looksLikeInvoice_("") === false);
ok("3자리 배제(최소 " + _CSL_TAIL_MIN_ + ")", _csl_looksLikeInvoice_("123") === false);
ok("4자리 통과", _csl_looksLikeInvoice_("2515") === true);

// ── 롯데 mod7 체크섬 ──────────────────────────────────
//
// ★ 2026-08-31 정정 ★
//   여기에는 원래 "체크섬 실패율 70% 이상 — 무작위 수준" 이라는 단언이 있었고,
//   그걸 근거로 csLogistics 의 자동 처리 조건에서 체크섬을 빼두고 있었다.
//   그런데 실패의 원인은 규칙이 아니라 **구현**이었다.
//
//     종전 구현 : 자릿수의 **합** mod 7          → 16건 중 3건만 통과
//     정식 규칙 : 앞 11자리 **정수** mod 7        → 16건 중 14건 통과
//                (출처: 롯데 API Portal「운송장 채번규칙」)
//
//   틀린 단언이 틀린 구현을 지켜주고 있었던 셈이라, 반대 방향으로 고정을 바꾼다.
//   체크섬 상세 검증은 _csbarcode_test.js 에 있다.
console.log("\n── 롯데 mod7 체크섬 (정식 규칙: 앞 11자리 정수 mod 7) ──");
function mod7(d) {
  let m = 0;
  for (let i = 0; i < 11; i++) m = (m * 10 + (d.charCodeAt(i) - 48)) % 7;
  return m === (d.charCodeAt(11) - 48);
}
let cok = 0, ctot = 0;
운송장.concat(원송장).forEach(function (s) {
  ctot++;
  if (mod7(_csl_digits_(s))) cok++;
});
console.log("  " + ctot + "건 중 " + cok + "건 통과 (" + Math.round(cok / ctot * 100) + "%)");
ok("정식 규칙 통과율 80% 이상 (나머지는 OCR 오독 의심)", cok / ctot >= 0.8);
운송장.forEach(function (s) {
  ok("운송장 " + s + " 체크섬 통과", mod7(_csl_digits_(s)));
});
안심번호.forEach(function (s) {
  ok("안심번호 " + s + " 체크섬 배제", mod7(_csl_digits_(s)) === false);
});

console.log("\n결과: 통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
