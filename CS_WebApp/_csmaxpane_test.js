/**
 * 한 칸만 크게 보기 — 반품은 가로 셋
 *
 *  > "반품 부분만 커뮤니티 보드도 확대 아이콘을 클릭해서 전체 창이 보이게
 *  >  하면 좋겠어.. 전체창일떄는 반품텝일경우 가로 3개 배열로 보이게 하면
 *  >  많이 볼수 있을꺼 같아"
 *
 *  세 칸을 나눠 쓰면 반품 카드가 한 줄에 하나뿐이라 한 화면에 서너 장밖에
 *  안 들어온다. 크게 펴면 가로로 셋씩 — 세 배를 한눈에 본다.
 *
 *  ★ 지켜야 할 것 ★
 *    · 사람이 맞춰 둔 폭(ws-resizer)을 «안 건드린다». 끄면 그대로 돌아온다
 *    · 좁은 화면에서는 안 켠다 — 이미 한 칸이 화면을 다 쓴다
 *    · 한 번에 하나만 크다
 *    · Esc 로 닫힌다. 다만 모달이 열려 있으면 모달이 먼저다
 *
 * 실행: node _csmaxpane_test.js
 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok  " : "  FAIL ") + label);
}
const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
function grab(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { d++; seen = true; }
    else if (html[k] === "}") { d--; if (seen && d === 0) return html.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const 코드만 = (s) => s.split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

console.log("\n[1] 확대 단추가 둘 다 있다");
ok("반품에 있다", html.indexOf('id="maxReturns"') >= 0);
ok("보드에 있다", html.indexOf('id="maxBoard"') >= 0);
ok("반품이 제 칸을 가리킨다", html.indexOf("wsToggleMax('pane-returns')") >= 0);
ok("보드가 제 칸을 가리킨다", html.indexOf("wsToggleMax('pane-manual')") >= 0);
ok("★ 눌린 상태를 읽어 준다 (aria-pressed)", html.indexOf('aria-pressed="false"') >= 0);

console.log("\n[2] ★ 반품을 크게 펴면 가로 셋");
ok("★ 셋으로 편다",
  /#pane-returns\.is-max #returnActiveList[\s\S]{0,160}repeat\(3, minmax\(0, 1fr\)\)/.test(html));
ok("★ 좁아지면 둘로 준다",
  /max-width: 1180px[\s\S]{0,200}repeat\(2, minmax\(0, 1fr\)\)/.test(html));
ok("★ 더 좁으면 하나로",
  /max-width: 760px[\s\S]{0,200}grid-template-columns: 1fr/.test(html));
ok("★ 펼쳐 읽는 카드는 한 줄을 다 쓴다",
  /ret-card\.ret-focus[\s\S]{0,80}grid-column: 1 \/ -1/.test(html));
ok("보드는 셋으로 안 편다 (요청은 반품만)",
  html.indexOf("#pane-manual.is-max #hbList") < 0);

console.log("\n[3] ★ 사람이 맞춰 둔 폭을 안 건드린다");
{
  const 몸 = 코드만(grab("wsToggleMax"));
  ok("★ style.width 를 안 만진다", 몸.indexOf("style.width") < 0);
  ok("★ style.flex 를 안 만진다", 몸.indexOf("style.flex") < 0);
  ok("★ 클래스만 붙였다 뗀다", 몸.indexOf('classList.toggle("has-max"') >= 0);
  ok("★ 가리는 일은 CSS 가 한다",
    html.indexOf(".ws-split.has-max > .ws-pane:not(.is-max),") >= 0 &&
    html.indexOf("display: none !important;") >= 0);
  /*  ★ 잔상 지우기 ★  («스크롤 잔상이 남아», 2026-09-16)
      숨긴 칸의 스크롤 막대가 화면에 세로줄로 남았다. display:none 만으로는
      부족한 브라우저가 있다 — 자리까지 지우고, 레이아웃을 한 번 강제로
      다시 계산시킨다. CS 웹앱은 Apps Script 의 iframe 안이라 더 자주 난다.
      ※ 여기 시험에는 정규식을 안 쓴다 — 오늘 백슬래시가 세 번 먹혔다.  */
  ok("★ 자리까지 지운다 (width 0)", html.indexOf("width: 0 !important;") >= 0);
  ok("★ 한 번 강제로 다시 그린다", 몸.indexOf("void split.offsetHeight") >= 0);
  ok("★ 같은 프레임에서 되돌린다 (안 깜박인다)",
    몸.indexOf(String.fromCharCode(115,112,108,105,116)+".style.display = ") >= 0);
}

console.log("\n[4] ★ 한 번에 하나만 · 좁은 화면에서는 안 켠다");
{
  const 몸 = 코드만(grab("wsToggleMax"));
  ok("★ 다른 칸을 먼저 끈다", /panes\[i\]\.classList\.remove\("is-max"\)/.test(몸));
  ok("★ 좁은 화면이면 그냥 돌아간다",
    /mobile-mode[\s\S]{0,40}return;/.test(몸));
  ok("맨 위로 올려 준다", 몸.indexOf("scrollTop = 0") >= 0);
}

console.log("\n[5] ★ Esc 로 닫힌다 — 모달이 먼저다");
ok("★ Esc 를 듣는다", /e\.key !== "Escape" \|\| !WS_MAX_PANE/.test(html));
ok("★ 모달이 열려 있으면 안 가로챈다",
  /Escape[\s\S]{0,260}querySelector\("\.modal\.open/.test(html));
ok("★ 좁은 화면으로 바뀌면 저절로 꺼진다",
  /addEventListener\("resize"[\s\S]{0,260}wsToggleMax\(WS_MAX_PANE\)/.test(html));

console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
