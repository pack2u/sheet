/* 카드에서 글을 긁으면 복사된다 — 송장번호도 (로컬 검증용)
 *
 *   > "cs웹앱에서 반품 카드내에 송장번호를 드래그하면 복사가 안되... 텍스트는 복사가 되는데"
 *
 * ★ 왜 송장번호만 안 됐나 ★
 *   복사는 pointerup 에서 일어나는데, 「손을 뗀 자리(e.target)가 카드 안인가」로
 *   가리고 있었다. 송장번호는 카드 «아래쪽 끝»에 있어서 마지막 자리를 긁고 손을
 *   떼면 포인터가 이미 카드 밖이다. 카드 한가운데 글은 떼는 자리도 카드 안이라
 *   잘 되고 — 그래서 「텍스트는 되는데 송장번호만 안 되는」 모양이 된다.
 *
 *   이제 «무엇을 골랐나»로 본다: 고른 글이 카드 안에서 시작했으면 복사한다.
 *
 * 실행: node _csdragcopy_test.js
 */
const fs = require("fs"), path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (got !== undefined ? "  → " + got : "")); }
};

const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
const 있다 = (s) => html.indexOf(s) >= 0;

console.log("\n[1] 복사는 «고른 글»을 보고 판단한다");
ok("★ 손을 뗀 자리로 가리던 줄이 없어졌다",
  !/if \(!e\.target\.closest\(HB_COPY_SEL_\)\) return;/.test(html));
ok("★ 고른 글의 시작점을 본다", 있다("var 뿌리 = sel && sel.anchorNode;"));
ok("  글자마디면 그 요소로 올라간다", 있다("뿌리.nodeType === 3"));
ok("  카드 안에서 시작했는지 본다", 있다("뿌리.closest(HB_COPY_SEL_)"));
ok("  반품 카드가 대상에 들어 있다", /HB_COPY_SEL_ = '[^']*\.ret-card/.test(html));
ok("  너무 짧게 긁은 것은 무시한다", 있다("s.replace(/\\s/g, '').length < 2"));
ok("  선택이 확정된 뒤에 읽는다 (setTimeout 0)",
  /setTimeout\(function \(\) \{[\s\S]{0,200}getSelection\(\)/.test(html));

console.log("\n[2] 긁은 뒤 카드가 접히거나 펴지지 않는다");
ok("★ 반품 카드도 긁기를 가린다",
  /function onReturnCardTap[\s\S]{0,700}hbClickWasDrag_\(ev\)\) return;/.test(html));
ok("  판별기가 있다", /function hbClickWasDrag_\(ev\)/.test(html));
ok("  긁는 중이면 참", /function hbClickWasDrag_[\s\S]{0,200}HB_PTR_\.moved\) return true;/.test(html));
ok("  더블·트리플 클릭도 참 (낱말 고르기)",
  /function hbClickWasDrag_[\s\S]{0,300}ev\.detail >= 2\) return true;/.test(html));

console.log("\n[3] 같은 덩어리 안에 있다 (호이스팅이 먹는다)");
{
  const a = html.indexOf("function hbClickWasDrag_");
  const b = html.indexOf("function onReturnCardTap");
  const 사이 = html.slice(Math.min(a, b), Math.max(a, b));
  ok("두 함수 사이에 </script> 가 없다", a > 0 && b > 0 && !/<\/script>/i.test(사이));
}

console.log("\n[4] 스와이프 잠금 목록과 어긋나지 않는다");
{
  //  한쪽만 늘리면 「이 카드는 되고 저 카드는 안 되는」 상태가 된다 — 주석이 그렇게 말한다
  const 잠금 = html.match(/return !!el\.closest\('([^']+)'\)/);
  const 복사 = html.match(/HB_COPY_SEL_ = '([^']+)'/);
  ok("둘 다 .ret-card 를 담는다",
    !!잠금 && !!복사 && 잠금[1].indexOf(".ret-card") >= 0 && 복사[1].indexOf(".ret-card") >= 0,
    (잠금 && 잠금[1]) + "  /  " + (복사 && 복사[1]));
}

console.log("\n" + (fail ? "★ " + fail + "건 실패" : "모두 통과") + " (" + pass + "건)");
process.exit(fail ? 1 : 0);
