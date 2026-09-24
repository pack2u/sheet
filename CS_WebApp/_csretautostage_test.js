/* 반품송장을 적으면 상태가 저절로 「반품송장」이 되는가 (로컬 검증용)
 *
 *   > "cs 웹앱에서 반품 송장이 입력이 되면 자동으로 반품송장 상태로 바뀌게 해줘.. 2번 작업이네"
 *
 * ★ 두 군데가 막고 있었다 ★
 *   ① 서버가 「송장 «값이 바뀌었을 때»」만 올렸다(retInvSaved).
 *      롯데 회수 접수가 송장을 먼저 적어 둔 줄, 같은 번호를 다시 저장한 줄은
 *      「접수」에 그대로 머물렀다.
 *   ② 화면이 서버가 돌려준 res.status 를 안 읽었다. 시트는 바뀌었는데 카드는
 *      「접수」로 남아, 그걸 보고 사람이 한 번 더 바꿨다 — 그게 두 번째 일이다.
 *
 * 여기서는 ①의 «판정»만 본다. 시트 쓰기는 GAS 안에서만 되므로,
 * 상태를 정하는 그 줄을 실제 소스에서 꺼내 돌린다.
 *
 * 실행: node _csretautostage_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (got !== undefined ? "  → " + got : "")); }
};

const src = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");
function 꺼내(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("못 찾음: " + from);
  return src.slice(a, b);
}

const box = { String, Number, RegExp, console };
vm.createContext(box);
vm.runInContext(꺼내("function _cs_returnStage_", "/** CS앱 — 진행 중 반품 목록"), box);
vm.runInContext(꺼내("function _cs_isReturnDoneMark_", "function _cs_parseReturnInvFromNotice_"), box);
vm.runInContext("var _CS_STATUS_PICKUP_ = " +
  JSON.stringify(src.match(/var _CS_STATUS_PICKUP_ = "([^"]*)"/)[1]) + ";", box);

/*  ★ 실제 소스에서 그 줄을 꺼내 쓴다 ★
    베껴 적으면 코드가 바뀌어도 시험은 옛것을 지키느라 조용히 통과한다.  */
const 판정줄 = 꺼내("    if (retInvIn && _cs_isBeforePickup_(status)", "    if (status !== oldStatus)");
vm.runInContext(
  "function 정하기(status, retInvIn) {\n" + 판정줄 + "\n  return status;\n}", box);
const 정하기 = (status, retInvIn) => vm.runInContext("정하기", box)(status, retInvIn);

console.log("\n① 송장을 적으러 오면 — 앞 단계는 「반품송장」으로 올린다");
ok("접수 + 송장 → 반품송장", 정하기("접수", "451619") === "반품송장", 정하기("접수", "451619"));
ok("빈 상태 + 송장 → 반품송장", 정하기("", "451619") === "반품송장", 정하기("", "451619"));
//  「수거요청」은 _cs_returnStage_ 가 이미 «수거 단계»로 본다 — 올릴 것이 없다
ok("옛 글자 「수거요청」은 그대로 (이미 수거 단계)",
  정하기("수거요청", "451619") === "수거요청", 정하기("수거요청", "451619"));

console.log("\n② 이미 지나간 단계는 «뒤로 끌지» 않는다");
ok("입고검수 그대로", 정하기("입고검수", "451619") === "입고검수", 정하기("입고검수", "451619"));
ok("이카운트OK 그대로", 정하기("이카운트OK", "451619") === "이카운트OK", 정하기("이카운트OK", "451619"));
ok("반품송장 그대로", 정하기("반품송장", "451619") === "반품송장", 정하기("반품송장", "451619"));

console.log("\n③ 상태만 바꾸러 온 부름은 안 건드린다 (사람이 되돌릴 수 있어야 한다)");
ok("송장 없이 접수 → 접수", 정하기("접수", "") === "접수", 정하기("접수", ""));
ok("송장 없이 입고검수 → 입고검수", 정하기("입고검수", "") === "입고검수", 정하기("입고검수", ""));

console.log("\n④ ★ 값이 «안 바뀌어도» 올린다 ★  (여기가 이번에 고친 곳)");
/*  롯데 회수 접수가 송장을 먼저 적어 둔 줄을 사람이 다시 저장하는 경우다.
    retInvSaved(바뀐 값)는 비지만 retInvIn(적으러 온 값)은 차 있다.  */
{
  const 옛규칙 = /if \(retInvSaved && _cs_isBeforePickup_/.test(src);
  ok("retInvSaved 로 보던 줄이 없어졌다", !옛규칙);
  ok("retInvIn 으로 본다", /if \(retInvIn && _cs_isBeforePickup_/.test(src));
  //  끝 판정의 주인은 _cs_isReturnDoneMark_ 다 — _cs_returnStage_ 는 「이카운트OK」를 못 가린다
  ok("끝난 건은 막는다",
    /_cs_isBeforePickup_\(status\) && !_cs_isReturnDoneMark_\(status\)/.test(src));
}

console.log("\n⑤ 화면이 서버 답을 받아 쓴다");
{
  const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
  ok("retApplyServer 가 있다", /function retApplyServer\(c, res\)/.test(html));
  ok("반품송장 저장 성공 뒤에 부른다", /성공\(\);[\s\S]{0,200}retApplyServer\(c, res\)/.test(html));
  ok("서버 상태를 카드에 넣는다", /row\.status = String\(res\.status\)/.test(html));
  ok("다시 그린다", /retApplyServer[\s\S]{0,700}renderReturnActiveList\(\)/.test(html));
}

console.log("\n" + (fail ? "★ " + fail + "건 실패" : "모두 통과") + " (" + pass + "건)");
process.exit(fail ? 1 : 0);
