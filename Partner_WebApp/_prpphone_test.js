/**
 * 전화번호 다듬기 — 반품 포털 prpFormatPhone_ 와 CS 웹앱 _cs_formatLedgerPhone_ 가 «같은 답»을 내나   (2026-10-28)
 *   node _prpphone_test.js
 * 시트에 숫자로 들어가 맨 앞 0 이 빠진 휴대폰(1051637987 꼴)을 010-… 으로 되살린다. 값은 지어낸 번호다.
 */
const fs = require("fs"), path = require("path"), vm = require("vm");
let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok   " + label); } else { fail++; console.log("  FAIL " + label + "  ->  " + g + "   (기대: " + w + ")"); }
}
function 꺼내(file, name) {
  const s = fs.readFileSync(file, "utf8"); const a = s.indexOf("function " + name + "(");
  if (a < 0) throw new Error(file + " 에 " + name + " 가 없다");
  let depth = 0, i = s.indexOf("{", a);
  for (; i < s.length; i++) { if (s[i] === "{") depth++; else if (s[i] === "}" && --depth === 0) break; }
  return s.slice(a, i + 1);
}
const ctx = {}; vm.createContext(ctx);
vm.runInContext(꺼내("prpConfig.gs", "prpDigits_"), ctx);
vm.runInContext(꺼내("prpLedger.gs", "prpFormatPhone_"), ctx);
vm.runInContext(꺼내(path.join("..", "CS_WebApp", "csOrderSearch.gs"), "_cs_formatLedgerPhone_"), ctx);

const 표 = [
  ["1012345678", "010-1234-5678"],      // 0 빠진 휴대폰 (10자리, 1 로 시작)
  ["01012345678", "010-1234-5678"],
  ["010-1234-5678", "010-1234-5678"],
  ["0311234567", "031-123-4567"],       // 0 으로 시작하는 10자리는 그대로
  ["0212345678", "021-234-5678"],       // (옛 규칙 그대로 — 02 는 바꾸지 않는다)
  ["0504-1234-5678", "0504-1234-5678"], // 안심번호 12자리 — 손대지 않는다
  ["15881234", "15881234"],
  ["", ""],
];
for (const [입력, 기대] of 표) {
  check("포털 " + 입력, ctx.prpFormatPhone_(입력), 기대);
  check("CS웹앱 " + 입력, ctx._cs_formatLedgerPhone_(입력), 기대);
}
console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
