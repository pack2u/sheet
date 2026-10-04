/**
 * 「미확인만 보기」 — 무엇을 미확인으로 세는가.
 *
 * ★ 왜 이 시험이 있나 ★  (2026-09-11)
 *   > "커뮤니티보드에서 미확인 몇개가 뜨는데.. 그걸 클릭하면 미확인 카드만"
 *
 *   머리말의 숫자와 걸러진 목록이 «같은 규칙»으로 세어야 한다.
 *   종전에는 숫자를 세는 식이 renderHandoffBoard 안에 따로 적혀 있었다 —
 *   거르는 쪽을 새로 만들면서 둘이 갈라지면 「미확인 3」인데 카드가 2장,
 *   같은 화면 안에서 숫자가 안 맞는다. 그래서 hbIsUnread 하나로 모았고
 *   여기서 그 하나를 시험한다.
 *
 * 실행: node _cshbunread_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 안 올라간다)
 */
const fs = require("fs");

const src = fs.readFileSync("home.html", "utf8");
const i = src.indexOf("function hbIsUnread(");
if (i < 0) { console.error("hbIsUnread 를 못 찾았습니다"); process.exit(1); }
let 깊이 = 0, 시작 = src.indexOf("{", i), 끝 = -1;
for (let k = 시작; k < src.length; k++) {
  if (src[k] === "{") 깊이++;
  else if (src[k] === "}") { 깊이--; if (!깊이) { 끝 = k + 1; break; } }
}
eval(src.substring(i, 끝));

let 실패 = 0;
function eq(설명, 받은, 바란) {
  const ok = 받은 === 바란;
  if (!ok) 실패++;
  console.log((ok ? "  통과 " : "★ 실패 ") + 설명 + (ok ? "" : `  got ${받은} want ${바란}`));
}

console.log("\n[hbIsUnread] 내가 아직 안 본 진행 카드");

eq("안 읽은 진행 카드", hbIsUnread({ done: false, read: ["영희"] }, "철수"), true);
eq("읽은 카드는 아니다", hbIsUnread({ done: false, read: ["철수", "영희"] }, "철수"), false);
eq("아무도 안 읽은 카드", hbIsUnread({ done: false, read: [] }, "철수"), true);
eq("read 가 아예 없어도 터지지 않는다", hbIsUnread({ done: false }, "철수"), true);

console.log("\n[세지 않는 것]");
eq("★ 보관(완료) 카드는 안 센다 — 지난 일이다",
  hbIsUnread({ done: true, read: [] }, "철수"), false);
eq("★ 담당자를 안 고른 사람에게는 «미확인»이 없다 — 0 이 맞다",
  hbIsUnread({ done: false, read: [] }, ""), false);
eq("카드가 없으면 false", hbIsUnread(null, "철수"), false);

console.log("\n[같은 이름이 섞여도]");
eq("이름이 부분만 같으면 안 읽은 것이다",
  hbIsUnread({ done: false, read: ["김철수"] }, "철수"), true);

console.log(실패 ? `\n실패 ${실패}건` : "\n전부 통과");
process.exit(실패 ? 1 : 0);
