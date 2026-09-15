/**
 * csBarcodeParse.gs 로컬 검증 — 롯데 채번규칙(체크섬) 고정.
 *
 * ★ 왜 이 테스트가 있나 ★
 *   체크섬이 "자릿수 합 mod 7" 로 잘못 구현돼 있었고, 테스트 샘플까지 손으로
 *   지어낸 번호였다. 틀린 구현과 틀린 샘플이 서로를 통과시켜서 버그가 오래 숨었다.
 *   그래서 여기서는 **실제 라벨에서 읽은 값만** 쓴다. 임의로 바꾸지 말 것.
 *
 *   정식 규칙: 12자리 = 앞 11자리 일련번호 + (앞 11자리 정수 mod 7)
 *   출처: 롯데 API Portal「운송장 채번규칙」— 롯데택배_OpenAPI_규격.md 6장
 *
 * 실행: node _csbarcode_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");

// csBarcodeParse.gs 는 GAS API 를 안 쓰는 순수 함수 파일이라 통째로 평가할 수 있다.
eval(fs.readFileSync("csBarcodeParse.gs", "utf8"));

// ── 실제 라벨에서 읽은 값 (_csl_match_test.js 와 동일 출처) ──────────
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

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  OK " : "  NG ") + label);
}

console.log("\n[1] 롯데 채번규칙 — 문서 예제");
ok("3030-4040-5054 (문서 예제) 통과", csValidateLotteChecksum_("303040405054"));
ok("313633845254 (화물추적 응답 실제값) 통과", csValidateLotteChecksum_("313633845254"));
ok("앞자리 제약 없음 — 3 으로 시작해도 통과", csValidateLotteChecksum_("313633845254"));

console.log("\n[2] 실제 운송장 " + 운송장.length + "건 — 전부 통과해야 한다");
운송장.forEach(v => {
  const r = csParseCourierBarcode(v);
  ok(v + "  courier=" + r.courier + " checksumOk=" + r.checksumOk,
     r.courier === "lotte" && r.checksumOk === true);
});

console.log("\n[3] 실제 원송장 " + 원송장.length + "건");
let 원송장통과 = 0;
원송장.forEach(v => {
  const r = csParseCourierBarcode(v);
  if (r.checksumOk) 원송장통과++;
  // 체크섬이 깨져도 우리 대역(2로 시작)이면 롯데로는 잡혀야 한다(파손 송장 구제).
  ok(v + "  courier=" + r.courier + " checksumOk=" + r.checksumOk,
     r.courier === "lotte");
});
console.log("  → 체크섬 통과 " + 원송장통과 + "/" + 원송장.length +
            " (나머지는 OCR 오독 의심 — 체크섬이 잡아낸 것이므로 정상)");

console.log("\n[4] 안심번호 " + 안심번호.length + "건 — 롯데로 잡히면 안 된다");
안심번호.forEach(v => {
  const r = csParseCourierBarcode(v);
  ok(v + "  courier=" + r.courier, r.courier !== "lotte");
});

console.log("\n[5] 원문 변형 — 같은 번호를 뽑아내야 한다");
[
  ["2581-3149-4106", "하이픈"],
  ["258131494106", "숫자만"],
  ["]C1258131494106", "AIM 식별자"],
  ["2581314941060123", "GS1 부가데이터 뒤에 붙음"],
  ["0123258131494106", "부가데이터 앞에 붙음"]
].forEach(([raw, why]) => {
  const r = csParseCourierBarcode(raw);
  ok(why + " → " + r.digits, r.digits === "258131494106" && r.courier === "lotte");
});

console.log("\n[6] 타 택배사 대역 — 롯데로 오인하면 안 된다");
[["3123456789012", "cj"], ["812345678901", "logen"]].forEach(([v, want]) => {
  const r = csParseCourierBarcode(v);
  ok(v + " → " + r.courier + " (기대 " + want + ")", r.courier === want);
});

console.log("\n[7] 종전 구현이 쓰던 가짜 샘플 — 이제 걸러져야 한다");
ok("212345678905 는 채번규칙 위반 → 체크섬 실패",
   csValidateLotteChecksum_("212345678905") === false);

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
