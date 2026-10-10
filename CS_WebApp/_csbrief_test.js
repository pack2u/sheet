/**
 * csBriefing.gs 시험 — 시트에 쓰는 표가 «네 칸짜리 네모»인가.
 *
 * 왜 이것만 보나: `tab.getRange(1, 1, 줄.length, 4).setValues(줄)` 는 모든 줄이
 *   «정확히 4칸»이어야 한다. 한 줄이 3칸이면 그 자리에서 터지고 — 브리핑이
 *   통째로 안 적힌다. 새벽 3시에 사람 없이 도는 일이라 터지면 아침에
 *   「브리핑이 없습니다」만 남는다. 장부를 넓힐 때마다 걸릴 수 있는 자리다.
 *
 *   눈으로는 못 본다. 줄이 60개가 넘고 push 가 열 군데에 흩어져 있다.
 *
 * 돌리기:  node _csbrief_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const 소스 = fs.readFileSync(path.join(__dirname, "csBriefing.gs"), "utf8");

let 실패 = 0;
function 맞나(이름, 참인가, 덧말) {
  if (참인가) { console.log("  ✔ " + 이름); return; }
  console.log("  ✘ " + 이름 + (덧말 ? " — " + 덧말 : ""));
  실패++;
}

/* ── ① 줄.push 하나하나가 네 칸인가 ──
     `줄.push([...])` 의 대괄호 안에서 맨 위 쉼표를 센다. 안쪽 괄호·따옴표
     속의 쉼표는 세지 않는다 — `.toLocaleString()` 이나 삼항이 들어 있다.     */
function 칸수(안쪽) {
  let 깊이 = 0, 칸 = 1, 따옴 = "";
  for (let i = 0; i < 안쪽.length; i++) {
    const ch = 안쪽[i];
    if (따옴) {
      if (ch === "\\") { i++; continue; }
      if (ch === 따옴) 따옴 = "";
      continue;
    }
    if (ch === '"' || ch === "'") { 따옴 = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { 깊이++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { 깊이--; continue; }
    if (ch === "," && 깊이 === 0) 칸++;
  }
  return 칸;
}

const 줄번호 = (i) => 소스.slice(0, i).split("\n").length;
let 본것 = 0, 나쁜것 = [];
const 재기 = /줄\.push\(\[/g;
let m;
while ((m = 재기.exec(소스)) !== null) {
  //  대괄호가 닫히는 자리를 찾는다
  let i = m.index + m[0].length, 깊이 = 1, 따옴 = "";
  for (; i < 소스.length && 깊이 > 0; i++) {
    const ch = 소스[i];
    if (따옴) { if (ch === "\\") i++; else if (ch === 따옴) 따옴 = ""; continue; }
    if (ch === '"' || ch === "'") { 따옴 = ch; continue; }
    if (ch === "[" || ch === "(" || ch === "{") 깊이++;
    else if (ch === "]" || ch === ")" || ch === "}") 깊이--;
  }
  const 안쪽 = 소스.slice(m.index + m[0].length, i - 1);
  본것++;
  const n = 칸수(안쪽);
  if (n !== 4) 나쁜것.push(줄번호(m.index) + "행: " + n + "칸 — " + 안쪽.slice(0, 60));
}

console.log("── 시트에 쓰는 줄이 다 네 칸인가 ──");
맞나("줄.push 를 찾았다 (" + 본것 + "군데)", 본것 >= 15, "줄이 " + 본것 + "군데뿐이다 — 재기가 안 맞는다");
맞나("다 네 칸이다", 나쁜것.length === 0, "\n      " + 나쁜것.join("\n      "));

/* ── ② 넓힌 장부 칸이 실제로 적히나 ──
     v2 가 보내 주는데 시트에 안 적히면 「v2 에만 있고 아무도 안 보는 숫자」가
     된다. 넓힌 뜻이 없어진다.                                              */
console.log("── 넓힌 장부가 시트에 적히나 ──");
for (const k of ["출고건수", "택배사별", "쇼핑몰별", "반품건수", "반품비", "안본것"]) {
  맞나(k + " 를 적는다", 소스.indexOf("장." + k) >= 0);
}

/* ── ③ ★ 「안 본 것」을 숨기지 않는다 ★ ──
     0 으로 적으면 「없었다」로 읽힌다. 장부에서 그 차이는 특히 크다 —
     매출이 0 인 날과 안 본 날은 전혀 다르다.                                */
맞나("「아직 못 보는 것」 자리가 있다", /아직 못 보는 것/.test(소스));

/* ── ④ 머리글 서식이 가리키는 6행이 아직 「갈래」 줄인가 ──
     위에 줄을 더하면 서식이 엉뚱한 줄에 칠해진다. 장부는 그 아래라 괜찮지만
     다음에 위를 건드리면 여기서 드러난다.                                   */
const 머리앞 = 소스.indexOf('줄.push(["갈래", "상태", "건수", "한마디"]);');
const 앞줄수 = (소스.slice(0, 머리앞).match(/줄\.push\(\[/g) || []).length;
맞나("「갈래」 머리글이 6행이다 (서식이 그 줄을 칠한다)", 앞줄수 === 5,
     "앞에 " + 앞줄수 + "줄 있다 — getRange(6, …) 서식을 같이 고쳐야 한다");

console.log(실패 ? "\n✘ " + 실패 + "개 틀렸습니다" : "\n✔ 다 맞았습니다");
process.exit(실패 ? 1 : 0);
