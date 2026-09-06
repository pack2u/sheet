/* 썸네일 크기 검증 (로컬 검증용)
 *
 * 드라이브 썸네일은 `sz=w숫자` 로 크기를 정해 받는다.
 * 이 숫자가 **화면에 그리는 크기와 따로 놀면 아무도 모른다** — 화면은 똑같이
 * 보이고 데이터만 몇 배로 나간다. 실제로 그랬다:
 *   · 카드 첨부  50px 로 그리면서 480px 를 받음   (가로 9배, 넓이 80배)
 *   · 반품 사진  34px 로 그리면서 480px 를 받음   (가로 14배)
 *
 * 그래서 「받는 크기」와 「그리는 크기」를 같은 파일에서 뽑아 견줘 본다.
 * 한쪽만 고치면 여기서 걸린다.
 */
const fs = require("fs"), path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (got ? "  → " + got : "")); }
};

const home = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
const board = fs.readFileSync(path.join(__dirname, "csHandoffBoard.gs"), "utf8");

/** CSS 규칙에서 width 를 px 로 뽑는다 */
function cssWidth(src, selector) {
  const i = src.indexOf(selector);
  if (i < 0) return null;
  const block = src.slice(i, src.indexOf("}", i));
  const m = block.match(/width:\s*(\d+)px/);
  return m ? +m[1] : null;
}

/** sz=w숫자 를 뽑는다 */
function reqWidth(src, near) {
  const i = src.indexOf(near);
  if (i < 0) return null;
  const m = src.slice(i, i + 400).match(/sz=w'?\s*\+?\s*(\d+)/);
  return m ? +m[1] : null;
}

console.log("\n[카드 첨부 — .hb-thumb]");
const drawA = cssWidth(home, ".hb-thumb {");
const reqA = reqWidth(board, "thumbUrl:");
ok("그리는 크기를 찾았다", drawA !== null, String(drawA));
ok("받는 크기를 찾았다", reqA !== null, String(reqA));
ok("받는 크기가 그리는 크기보다 크다", reqA > drawA, reqA + " vs " + drawA);
ok("고화질 화면(3배)까지 감당한다", reqA >= drawA * 3, reqA + " >= " + drawA * 3);
ok("4배를 넘게 받지 않는다", reqA <= drawA * 4, reqA + " <= " + drawA * 4);

console.log("\n[반품 사진 — .ret-proc-thumbs]");
const drawB = cssWidth(home, ".ret-proc-thumbs button {");
const reqB = reqWidth(home, "thumbUrl: 'https://drive.google.com/thumbnail");
ok("그리는 크기를 찾았다", drawB !== null, String(drawB));
ok("받는 크기를 찾았다", reqB !== null, String(reqB));
ok("받는 크기가 그리는 크기보다 크다", reqB > drawB, reqB + " vs " + drawB);
ok("고화질 화면(3배)까지 감당한다", reqB >= drawB * 3, reqB + " >= " + drawB * 3);
/* 포커스된 카드는 44px 로 커진다. 그것의 3배(132)까지는 받아야 한다. */
const drawBFocus = cssWidth(home, ".ret-card.ret-focus .ret-proc-thumbs button {");
ok("펼친 카드(44px)의 3배도 감당한다", drawBFocus === null || reqB >= drawBFocus * 3,
  reqB + " >= " + (drawBFocus || 0) * 3);
ok("5배를 넘게 받지 않는다", reqB <= drawB * 5, reqB + " <= " + drawB * 5);

console.log("\n[확대보기는 크게 받아야 한다]");
const big = reqWidth(board, "bigUrl:");
ok("확대보기는 1024 이상", big >= 1024, String(big));

console.log("\n[늦게·조용히 받는다]");
ok("카드 첨부는 lazy", /esc\(a\.thumbUrl\)[\s\S]{0,160}loading="lazy"/.test(home));
ok("카드 첨부는 decoding=async", /esc\(a\.thumbUrl\)[\s\S]{0,200}decoding="async"/.test(home));
ok("카드 첨부는 우선순위 낮음", /esc\(a\.thumbUrl\)[\s\S]{0,220}fetchpriority="low"/.test(home));
ok("반품 사진은 lazy", /items\[i\]\.thumbUrl[\s\S]{0,160}loading="lazy"/.test(home));
ok("반품 사진은 decoding=async", /items\[i\]\.thumbUrl[\s\S]{0,200}decoding="async"/.test(home));
ok("반품 사진은 우선순위 낮음", /items\[i\]\.thumbUrl[\s\S]{0,220}fetchpriority="low"/.test(home));

console.log("\n" + (fail ? `실패 ${fail}건 / 통과 ${pass}건` : `모두 통과 (${pass}건)`));
process.exit(fail ? 1 : 0);
