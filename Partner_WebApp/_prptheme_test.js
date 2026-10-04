/**
 * 반품 포털 — CS 웹앱 색 · 다크/라이트 · PC 가로 3열
 *
 *  > "당장드림 도 ui를 바꿔줘... 지금은 모바일 버젼인데 pc에서는
 *  >  가로 3개 한줄로 전체를 다 볼수 있게.. 그리고 칼라도 cs웹앱 칼라로
 *  >  다크와 라이트 모드 2가지로 되게"
 *
 *  ★ 왜 ★
 *    폭이 720px 로 묶여 있어 큰 화면에서도 카드가 한 줄에 하나였다.
 *    업체는 진행 중 반품을 «훑어보는» 것이 일이라 한 화면에 많이 들어와야 한다.
 *    색은 푸른 기 도는 어두운 값이 서른 곳 넘게 박혀 있어, 업체가 보는 화면과
 *    우리가 보는 화면이 딴 물건 같았고 밝은 화면에서 일하는 사람은 못 봤다.
 *
 * 실행: node _prptheme_test.js
 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok  " : "  FAIL ") + label);
}
const html = fs.readFileSync(path.join(__dirname, "portal.html"), "utf8");
const 스타일 = html.slice(html.indexOf("* { box-sizing"), html.indexOf("</style>"));

console.log("\n[1] ★ 박아 둔 색이 남아 있지 않다");
{
  /*  :root 정의 밖에 hex 가 남으면 라이트 모드에서 그 자리만 안 바뀐다.
      「거의 다 바꿨다」는 통하지 않는다 — 한 곳만 남아도 눈에 띈다.  */
  const 토큰밖 = 스타일.slice(스타일.indexOf("* { box-sizing"));
  const 남은 = (토큰밖.match(/#[0-9a-fA-F]{6}/g) || []);
  ok("★ 스타일에 남은 hex 없음  (" + (남은.length ? 남은.join(" ") : "없음") + ")", 남은.length === 0);
  /*  &#128247; 같은 HTML 기호(📷)는 색이 아니다 — 먼저 걷어내고 본다.  */
  const 본문 = html.slice(html.indexOf("</style>")).replace(/&#[0-9]+;/g, "");
  const 인라인 = (본문.match(/#[0-9a-fA-F]{6}/g) || []);
  ok("★ 본문·스크립트에도 없음  (" + (인라인.length ? 인라인.join(" ") : "없음") + ")", 인라인.length === 0);
}

console.log("\n[2] ★ CS 웹앱과 «같은 값»");
{
  /*  값이 갈리면 두 앱이 딴 물건으로 보인다. 같은 값인지 글자로 못 박는다.  */
  [["--bg-primary: #111111", "어두운 바탕"],
   ["--bg-secondary: #1d1d1d", "어두운 카드 바탕"],
   ["--bg-card: #252525", "어두운 카드"],
   ["--text-primary: #f0f0f0", "어두운 글자"],
   ["--text-secondary: #909090", "어두운 보조글자"],
   ["--text-bright: #c1c1c1", "어두운 본문글자"],
   ["--bg-primary: #e9ebef", "밝은 바탕"],
   ["--bg-secondary: #ffffff", "밝은 카드 바탕"],
   ["--text-primary: #1b1e23", "밝은 글자"],
   ["--accent-green: #55a67c", "초록(완료)"],
   ["--accent-orange: #c5995b", "주황(진행)"],
   ["--accent-red: #d9817c", "빨강"]].forEach(function (쌍) {
    ok("CS 와 같다: " + 쌍[1], html.indexOf(쌍[0]) >= 0);
  });
  ok("★ 라이트 토큰 블록이 있다", html.indexOf(':root[data-theme="light"] {') >= 0);
}

console.log("\n[3] ★ 그리기 «전»에 테마를 입힌다");
{
  /*  body 나 onload 에서 하면 어두운 화면이 한 번 번쩍이고 밝게 바뀐다.  */
  const 머리 = html.slice(0, html.indexOf("<style>"));
  ok("★ head 안에서 입힌다", 머리.indexOf('setAttribute("data-theme", t)') >= 0);
  ok("★ CS 와 같은 열쇠를 쓴다", 머리.indexOf('localStorage.getItem("pack2u_theme")') >= 0);
  ok("★ 엉뚱한 값은 무시한다", 머리.indexOf('t === "light" || t === "dark"') >= 0);
}

console.log("\n[4] ★ 단추는 «누르면 무엇이 되는지»를 보인다");
{
  ok("단추가 있다", html.indexOf('id="btnTheme"') >= 0);
  ok("★ 어두울 때 해, 밝을 때 달", html.indexOf("light ? '\uD83C\uDF19' : '\u2600\uFE0F'") >= 0);
  ok("★ 제목도 바뀐다", html.indexOf("light ? '어둡게 보기' : '밝게 보기'") >= 0);
  ok("★ 고른 것을 기억한다", html.indexOf('localStorage.setItem(PRP_THEME_KEY') >= 0);
  ok("★ 열 때 단추 모양을 맞춘다", html.indexOf("prpApplyTheme(prpCurrentTheme(), false)") >= 0);
}

console.log("\n[5] ★ PC 에서는 가로 셋");
{
  ok("★ 900px 부터 넓어진다", html.indexOf("@media (min-width: 900px)") >= 0);
  ok("★ 폭을 푼다 (720 → 1560)", html.indexOf("max-width: 1560px") >= 0);
  ok("★ 목록이 격자가 된다", html.indexOf("grid-template-columns: repeat(auto-fill, minmax(330px, 1fr))") >= 0);
  /*  칸 수를 못 박지 않는다 — 노트북·태블릿·세로 모니터가 저마다 알맞게 선다.  */
  ok("★ 칸 수를 못 박지 않았다", 스타일.indexOf("repeat(3, ") < 0);
  ok("★ 격자에서는 아래 여백을 뗀다", html.indexOf("#list > .card { margin-bottom: 0; }") >= 0);
  ok("★ 「없음」 안내는 한 줄을 다 쓴다", html.indexOf("#list > .empty, #list > .err { grid-column: 1 / -1; }") >= 0);
  /*  폰에서는 그대로 한 줄 — 720px 기본값을 안 건드렸다.  */
  ok("★ 폰 기본은 그대로", html.indexOf(".wrap { padding: 14px; max-width: 720px; margin: 0 auto; }") >= 0);
}

console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
