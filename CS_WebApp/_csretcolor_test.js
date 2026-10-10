/**
 * ══════════════════════════════════════════════════════════════
 *  반품 크게보기 — 먼저 보여야 하는 칸들이 «색만 보고» 찾아지는가
 *
 *  > "반품카드 크게보기시 텍스트가 많다보니 수취인 이름과 주문쇼핑몰
 *  >  송장번호가 잘 안보여 1포인트 크게 볼드로 수정해주고 밝은 칼라로
 *  >  각각 통일시켜줘"                                      (2026-10-07)
 *  > "상태값도 잘보이게 해줘"
 *  > "반품 송장번호도 잘보이게 해줘"
 *
 *  ★ 왜 시험이 있나 ★
 *    이 손질은 한 번 «조용히 되돌아갔다». 사장님이 「아까 했던건데 다시
 *    돌아왔네」라고 두 번 말했다. 화면 색은 눈으로만 아는 것이라, 되돌아가도
 *    아무것도 울지 않는다. 그래서 센다.
 *
 *    두 가지가 어긋날 수 있다 —
 *      ① 이름표(rc-…)를 «칸 자리»에 맞춰 달았는데 칸 차례가 바뀐다
 *      ② CSS 가 더 센 선택자(.ws-split > #pane-returns.is-max …)에 져서
 *         굵기만 먹고 색이 안 든다 → !important 가 빠지면 그 꼴이 된다
 *
 *  실행: node CS_WebApp/_csretcolor_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ok   " + 이름); return; }
  틀린것++;
  console.log("  FAIL " + 이름 + (덧붙임 ? "\n         " + 덧붙임 : ""));
}
function eq(이름, 얻은, 바란) {
  ok(이름 + "  →  " + JSON.stringify(얻은),
    JSON.stringify(얻은) === JSON.stringify(바란),
    "기대 " + JSON.stringify(바란));
}

/* ── [1] 칸 차례와 이름표가 «같은 것»을 가리키는가 ───────── */
console.log("\n[1] 이름표가 맞는 칸에 붙어 있다");

//  retRowHtml 의 칸 배열을 떠내, 몇 번째가 무엇인지 읽는다
const 칸시작 = HTML.indexOf("      var 칸 = [", HTML.indexOf("function retRowHtml"));
const 칸끝 = HTML.indexOf("];", 칸시작);
ok("retRowHtml 의 칸 배열을 찾았다", 칸시작 > 0 && 칸끝 > 칸시작);
const 칸본문 = HTML.slice(칸시작, 칸끝);

/*  칸마다 «무엇을 담는가»를 c.xxx 로 읽는다. 한 줄에 둘이 있어도
    쉼표로 갈라 차례를 지킨다 — 자리를 세는 것이 이 시험의 핵심이다. */
const 조각 = 칸본문
  .slice(칸본문.indexOf("[") + 1)
  .split(/,(?![^(]*\))/)
  .map((s) => s.trim())
  .filter((s) => s.length);

function 자리(이름) {
  for (let i = 0; i < 조각.length; i++) {
    if (조각[i].indexOf("c." + 이름) >= 0) return i;
  }
  return -1;
}

const 바란자리 = { invoice: 5, vendor: 6, name: 7, returnInvoice: 12 };
Object.keys(바란자리).forEach((k) => {
  eq("  c." + k + " 는 " + 바란자리[k] + "번째", 자리(k), 바란자리[k]);
});

//  이름표 표가 그 자리를 그대로 가리키는가
const 표줄 = (HTML.match(/var 이름표 = \{[^}]*\}/) || [""])[0];
ok("이름표 표를 찾았다", 표줄.length > 0);
const 표 = {};
표줄.replace(/(\d+)\s*:\s*'([^']+)'/g, (_, n, cl) => { 표[Number(n)] = cl; return ""; });

const 바란표 = {
  5: "rc-inv",        //  원송장
  6: "rc-vendor",     //  주문 쇼핑몰
  7: "rc-name",       //  수취인
  12: "rc-retinv",    //  반품송장  ← 2026-10-07 추가
};
Object.keys(바란표).forEach((n) => {
  eq("  " + n + "번째 → " + 바란표[n], 표[n], 바란표[n]);
});
eq("★ 네 칸뿐이다 (번지면 색이 뜻을 잃는다)", Object.keys(표).length, 4);

/* ── [2] 네 색이 «서로 다른가» ───────────────────────────── */
console.log("\n[2] 색이 겹치지 않는다 — 색만 보고 찾는 것이 목적이다");

function 색(선택자) {
  const re = new RegExp("\\.ret-row \\." + 선택자 +
    "\\s*\\{[^}]*color:\\s*(#[0-9A-Fa-f]{3,6})", "");
  const m = HTML.match(re);
  return m ? m[1].toUpperCase() : null;
}
const 색들 = {
  "rc-name (수취인)": 색("rc-name"),
  "rc-vendor (쇼핑몰)": 색("rc-vendor"),
  "rc-inv (원송장)": 색("rc-inv"),
  "rc-retinv (반품송장)": 색("rc-retinv"),
};
Object.keys(색들).forEach((k) => ok("  " + k + " 색이 박혀 있다 — " + 색들[k], !!색들[k]));
eq("★ 네 색이 모두 다르다",
  new Set(Object.keys(색들).map((k) => 색들[k])).size, 4);

/*  ★ !important 가 빠지면 색이 «안 든다» ★
    .ws-split > #pane-returns.is-max .ret-row > span { color: … } 가 훨씬 세다
    (선택자 1,3,1). 2026-10-07 에 실제로 굵기만 먹고 색이 안 들어 사장님이
    「아 칼라가 안들어 갔네」라고 했다.                                      */
["rc-name", "rc-vendor", "rc-inv", "rc-retinv"].forEach((cl) => {
  const re = new RegExp("\\.ret-row \\." + cl + "\\s*\\{[^}]*!important");
  ok("  ." + cl + " 에 !important 가 있다", re.test(HTML),
    "더 센 선택자에 져서 색이 안 듭니다");
});

/* ── [3] 어두운 바탕·밝은 바탕 둘 다 ────────────────────── */
console.log("\n[3] 밝은 바탕에도 짝이 있다 (안 주면 글자가 날아간다)");
["rc-name", "rc-vendor", "rc-inv", "rc-retinv"].forEach((cl) => {
  const re = new RegExp(':root\\[data-theme="light"\\] \\.ret-row \\.' + cl +
    "\\s*\\{[^}]*color:[^}]*!important");
  ok("  " + cl, re.test(HTML));
});

/* ── [4] 굵기·크기를 같이 받는가 ────────────────────────── */
console.log("\n[4] 1포인트 크게 · 볼드");
const 굵기묶음 = (HTML.match(/\.ret-row \.rc-name,[\s\S]{0,260}?\}/) || [""])[0];
["rc-name", "rc-vendor", "rc-inv", "rc-retinv"].forEach((cl) => {
  ok("  " + cl + " 가 묶음에 들어 있다", 굵기묶음.indexOf("." + cl) >= 0);
});
ok("1px 크게", /font-size:\s*calc\(1em \+ 1px\)/.test(굵기묶음));
ok("볼드", /font-weight:\s*700/.test(굵기묶음));

/* ── [5] 상태값은 딱지로 세운다 ─────────────────────────── */
console.log("\n[5] 상태값 — 제일 먼저 보는 값");
/*  ★ `.ret-row .rs` 규칙은 «두 벌»이다 ★  (시험을 쓰다 걸렸다)
    앞의 한 벌은 빽빽한 목록용(10.5px)이고, 뒤의 한 벌이 크게보기 딱지다.
    선택자가 같아 «뒤엣것»이 이긴다 — 그러니 뒤엣것을 봐야 한다.
    첫 벌을 집으면 멀쩡한데 울고, 반대로 딱지가 사라져도 모른다.
    밝은 바탕용(:root[data-theme="light"] …)도 같은 꼴이라 같이 잡힌다 —
    머리를 같이 떠내 그것만 걸러 낸다.                                     */
const 상태묶음 = (HTML.match(/[^\n{]*\.ret-row \.rs \{[\s\S]{0,300}?\}/g) || [])
  .filter((s) => s.indexOf("data-theme") < 0);
ok("`.ret-row .rs` 규칙을 찾았다 (어두운 바탕 " + 상태묶음.length + "벌)",
  상태묶음.length > 0);
const 상태 = 상태묶음[상태묶음.length - 1] || "";
ok("딱지 바탕이 있다", /background:/.test(상태));
ok("모서리를 둥글린다", /border-radius:/.test(상태));
ok("1px 크게 · 볼드", /calc\(1em \+ 1px\)/.test(상태) && /font-weight:\s*700/.test(상태));
ok("밝은 바탕 짝이 있다",
  /:root\[data-theme="light"\] \.ret-row \.rs \{/.test(HTML));

/* ── [6] 카드의 「반품송장 …」 줄도 같은 색 ──────────────── */
console.log("\n[6] 목록 한 줄과 카드가 «같은 값»을 같은 색으로");
/*  색이 다르면 다른 것으로 읽힌다. 원송장은 .ro-inv b 가 맡는다. */
const 카드원송장 = (HTML.match(/\.ro-inv b \{[^}]*color:\s*(#[0-9A-Fa-f]{3,6})/) || [])[1];
const 카드반품 = (HTML.match(/\.ret-retinv-val \{[^}]*color:\s*(#[0-9A-Fa-f]{3,6})/) || [])[1];
eq("카드 원송장 색 = 목록 원송장 색",
  (카드원송장 || "").toUpperCase(), 색("rc-inv"));
eq("카드 반품송장 색 = 목록 반품송장 색",
  (카드반품 || "").toUpperCase(), 색("rc-retinv"));
ok("카드 반품송장도 밝은 바탕 짝이 있다",
  /:root\[data-theme="light"\] \.ret-retinv-val \{/.test(HTML));

console.log("");
console.log(틀린것 ? "실패 " + 틀린것 + "건 / 통과 " + (잰것 - 틀린것)
                  : "모두 통과 (" + 잰것 + "건)");
process.exit(틀린것 ? 1 : 0);
