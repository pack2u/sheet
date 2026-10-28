/**
 * v2 가 판정한 접수 출처 — prpV2.gs prpV2Origin_ · prpApi.gs prpSubmitReturn   (2026-10-28)
 * > 사장님: "우리 V2에서 연동이 되게 해줘 시트사용은 이제 최대한 배재할꺼야"
 *   node _prpv2origin_test.js
 *
 * v2 업체 화면 접수는 v2 가 출처를 판정해 넘긴다(포털이 업체 시트를 다시 훑지 않게).
 * 그 판정은 열쇠로 들어온 doPost 에서만 받는다 — 브라우저 포털 접수(google.script.run)는 늘 직접 본다.
 */
const fs = require("fs"), vm = require("vm");
let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + "  ->  " + g + "   (기대: " + w + ")"); }
}
const 꺼내 = (f, n) => { const s = fs.readFileSync(f, "utf8"); const a = s.indexOf("function " + n + "("); let d = 0, i = s.indexOf("{", a); for (; i < s.length; i++) { if (s[i] === "{") d++; else if (s[i] === "}" && --d === 0) break; } return s.slice(a, i + 1); };
const ctx = { PRP_ORIGIN_OK_: "확인됨", PRP_ORIGIN_UNKNOWN_: "미확인", PRP_ORIGIN_MISMATCH_: "어긋남" };
vm.createContext(ctx);
vm.runInContext(꺼내("prpV2.gs", "prpV2Origin_"), ctx);

console.log("[1] 받는 글자");
check("확인됨", ctx.prpV2Origin_({ level: "확인됨", why: "v2 원장" }), { level: "확인됨", why: "v2 원장", hit: null });
check("어긋남 · 긴 까닭은 200자로", ctx.prpV2Origin_({ level: "어긋남", why: "가".repeat(300) }).why.length, 200);
check("모르는 글자는 안 받는다(포털이 직접 본다)", ctx.prpV2Origin_({ level: "OK" }), null);
check("빈 것", [ctx.prpV2Origin_(null), ctx.prpV2Origin_("확인됨")], [null, null]);

console.log("[2] 문과 접수가 그 판정을 쓰는 자리");
const 문 = 꺼내("prpV2.gs", "doPost");
check("doPost 가 본문에서 꺼내 전역에 두고 본문에서는 지운다", [/PRP_V2_ORIGIN_ = prpV2Origin_\(d\.__originV2\)/.test(문), /delete d\.__originV2/.test(문)], [true, true]);
check("열쇠 확인이 그보다 먼저", 문.indexOf("prpV2TokenOk_") < 문.indexOf("PRP_V2_ORIGIN_ ="), true);
const 접수 = 꺼내("prpApi.gs", "prpSubmitReturn");
check("접수는 전역 판정이 있으면 그것, 없으면 prpVerifyOrigin_", /if \(typeof PRP_V2_ORIGIN_ !== "undefined" && PRP_V2_ORIGIN_\) 출처 = PRP_V2_ORIGIN_;\s*else \{ try \{ 출처 = prpVerifyOrigin_\(sess, data\)/.test(접수), true);
check("접수는 data.__originV2 를 직접 읽지 않는다(브라우저가 실어 보낼 수 있다)", /__originV2/.test(접수), false);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
