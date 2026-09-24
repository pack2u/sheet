/**
 * 시트 쓰기 — 자리를 늘리고, 서비스가 투정하면 다시 해 본다
 *
 *  > "Exception: ID가 …인 문서에 액세스하는 동안 스프레드시트 서비스에 오류가
 *  >  발생했습니다   at ssio_append(gasIO:157)   at ss_실행(gasMain:627)"
 *
 *  코드가 틀려서가 아니라 구글 쪽이 잠깐 못 받아 줄 때 나는 오류다.
 *  하필 그 자리가 «원장 적재»였다 — 다 계산해 놓고 마지막에 못 적어 회차가
 *  통째로 남지 않았다. 2026-09-22 실제로 그렇게 멈췄다.
 *
 * 실행: node _ssio_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const src = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasIO.js"), "utf8");

/*  ★ 소스에서 그대로 꺼내 돌린다 ★  베껴 적으면 코드가 바뀌어도 시험은 옛것을 지킨다. */
const 토막 = src.match(/function ssio_다시해보기_[\s\S]*?\n\}/)[0];
let 잠든시간 = 0;
const box = vm.createContext({
  Logger: { log: function () {} },
  SpreadsheetApp: { flush: function () {} },
  Utilities: { sleep: function (ms) { 잠든시간 += ms; } },
  String, RegExp, console,
});
vm.runInContext(토막, box);
const 다시해보기 = vm.runInContext("ssio_다시해보기_", box);

console.log("\n① 한 번에 되면 그대로 돌려준다");
{
  let 횟수 = 0;
  const r = 다시해보기("시험", function () { 횟수++; return "됨"; });
  ok("값을 돌려준다", r === "됨", r);
  ok("한 번만 한다", 횟수 === 1, 횟수);
}

console.log("\n② 서비스 오류면 쉬었다 다시 한다");
{
  잠든시간 = 0;
  let 횟수 = 0;
  const r = 다시해보기("시험", function () {
    횟수++;
    if (횟수 < 3) throw new Error("ID가 1Juw…인 문서에 액세스하는 동안 스프레드시트 서비스에 오류가 발생했습니다");
    return "됨";
  });
  ok("세 번째에 성공", r === "됨" && 횟수 === 3, 횟수);
  ok("사이에 쉰다", 잠든시간 > 0, 잠든시간 + "ms");
}

console.log("\n③ ★ «내 잘못»은 다시 안 한다 ★");
{
  //  범위·인수 오류는 백 번 해도 같다. 되풀이하면 시간만 버린다.
  let 횟수 = 0, 던졌나 = false;
  try {
    다시해보기("시험", function () { 횟수++; throw new Error("The coordinates of the range are outside the dimensions of the sheet."); });
  } catch (e) { 던졌나 = true; }
  ok("곧장 던진다", 던졌나 && 횟수 === 1, 횟수);
}

console.log("\n④ 세 번 다 실패하면 마지막 것을 던진다");
{
  let 횟수 = 0, 말 = "";
  try {
    다시해보기("시험", function () { 횟수++; throw new Error("스프레드시트 서비스에 오류가 발생했습니다 #" + 횟수); });
  } catch (e) { 말 = e.message; }
  ok("세 번 해 본다", 횟수 === 3, 횟수);
  ok("마지막 오류를 던진다", /#3/.test(말), 말);
}

console.log("\n⑤ 배선 — 쓰는 자리가 그물 아래에 있다");
{
  ok("★ 이어붙이기가 쓴다", /function ssio_append[\s\S]{0,400}ssio_다시해보기_\(/.test(src));
  ok("★ 통째로 쓰기도 쓴다", /function ssio_write[\s\S]{0,500}ssio_다시해보기_\(/.test(src));

  //  자리가 모자라면 늘린다 — 안 늘리면 getRange 가 시트 밖을 가리켜 터진다
  ok("★ 이어붙일 때 행을 늘린다",
    /function ssio_append[\s\S]{0,600}insertRowsAfter\(sh\.getMaxRows\(\)/.test(src));
  ok("★ 통째로 쓸 때도 늘린다",
    /function ssio_write[\s\S]{0,700}insertRowsAfter\(sh\.getMaxRows\(\)/.test(src));

  //  이어붙이기는 lastRow 를 «다시 해 볼 때마다» 재야 두 번 안 붙는다
  ok("★ 시작 줄을 다시 잴 때마다 구한다",
    /ssio_다시해보기_\('이어붙이기[\s\S]{0,200}var 시작 = sh\.getLastRow\(\) \+ 1;/.test(src));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
