/**
 * home.html 안의 자바스크립트가 «실제로» 파싱되는지 본다.
 *
 * ★ 왜 만드나 ★  (2026-09-14)
 *   그동안 나는 이런 검사를 쓰고 있었다.
 *
 *       if (js.indexOf("<?") >= 0) continue;   // GAS 템플릿은 건너뛴다
 *
 *   home.html 의 «본체 script 블록»에는 <?!= include(...) ?> 가 들어 있다.
 *   그래서 30만 자짜리 그 블록이 통째로 건너뛰어졌다 — 내가 온종일 고친
 *   코드가 전부 거기 있는데, 검사는 「script 2개 · 오류 0개」라고 답했다.
 *   실제로 `typeof x === function` 같은 문법 오류가 그대로 지나갔다.
 *
 *   건너뛸 일이 아니었다. 템플릿 자리를 «값처럼» 바꿔 놓고 파싱하면 된다.
 *
 *   ★ 검사를 건너뛰는 검사는 검사가 아니다 ★
 *     통과했다는 말이 무엇을 통과했다는 뜻인지 늘 말해야 한다.
 *     그래서 이 시험은 「몇 자를 봤는지」를 같이 찍는다.
 *
 * 실행: node CS_WebApp/_cshtml_syntax_test.js
 */
const fs = require("fs");
const path = require("path");

const 뿌리 = __dirname;
let fail = 0;

/**
 * GAS 템플릿 자리를 파싱 가능한 값으로 바꾼다.
 *   <?!= include('x') ?>  ·  <?= v ?>  ·  <? code ?>
 * 셋 다 «문자열 하나»로 바꾼다. 자리만 메우면 되고, 안의 뜻은 볼 필요가 없다.
 */
function 템플릿메움(js) {
  return js.replace(/<\?[\s\S]*?\?>/g, "''");
}

function 검사(파일) {
  const s = fs.readFileSync(path.join(뿌리, 파일), "utf8");
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m, n = 0, 본자수 = 0, 건너뜀 = 0;
  while ((m = re.exec(s))) {
    const attrs = String(m[1] || "");
    //  src= 로 불러오는 바깥 스크립트는 내용이 없다
    if (/\ssrc\s*=/.test(attrs)) { 건너뜀++; continue; }
    //  type 이 JS 가 아닌 블록(템플릿 조각 등)은 건너뛴다
    if (/type\s*=\s*["'](?!text\/javascript|module)/.test(attrs)) { 건너뜀++; continue; }
    n++;
    const js = 템플릿메움(m[2]);
    본자수 += js.length;
    try {
      new Function(js);
    } catch (e) {
      fail++;
      //  몇 번째 줄인지 짚어 준다 — 30만 자에서 눈으로 찾을 수는 없다
      console.log("  FAIL " + 파일 + " script#" + n + " : " + e.message);
      const 앞 = s.slice(0, m.index).split("\n").length;
      console.log("        (이 블록은 " + 앞 + "행부터 시작합니다)");
    }
  }
  console.log("  ok   " + 파일 + " — script " + n + "개 · " +
    본자수.toLocaleString() + "자 파싱" +
    (건너뜀 ? " (내용 없는 블록 " + 건너뜀 + "개 제외)" : ""));
  //  ★ 아무것도 안 봤으면 그것이 실패다 ★
  if (본자수 < 10000) {
    fail++;
    console.log("  FAIL " + 파일 + " — 파싱한 글자가 너무 적습니다. 블록을 건너뛰고 있습니다.");
  }
}

console.log("\n[home.html] 안의 자바스크립트가 실제로 파싱되는가");
["home.html"].forEach(검사);

console.log("\n[다른 화면들]");
fs.readdirSync(뿌리)
  .filter((f) => /\.html$/.test(f) && f !== "home.html")
  .forEach((f) => {
    const s = fs.readFileSync(path.join(뿌리, f), "utf8");
    if (s.indexOf("<script") < 0) return;
    const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
    let m, bad = 0, n = 0;
    while ((m = re.exec(s))) {
      if (/\ssrc\s*=/.test(String(m[1] || ""))) continue;
      n++;
      try { new Function(템플릿메움(m[2])); } catch (e) { bad++; fail++; console.log("  FAIL " + f + ": " + e.message); }
    }
    if (!bad) console.log("  ok   " + f + " — script " + n + "개");
  });

console.log("\n" + (fail ? "실패 " + fail + "건" : "다 통과"));
process.exit(fail ? 1 : 0);
