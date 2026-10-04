/**
 * 발주 및 송장조회 스필 가드 — 자동 열 넷이 헤더와 짝이 맞는가
 *
 * > "업체들이 자꾸 품목명에 붙여넣기를 한다던가 텍스트를 쓰려고해..
 *    그럴떄 위쪽에 품목명이 다 사라져.. 단가도 같은 문제"   (2026-09-14)
 *
 * D1 의 ARRAYFORMULA 가 아래로 펼쳐지는데, 업체가 D5 에 한 글자라도 쓰면
 * 펼칠 자리가 막혀 #REF! 가 되고 «그 위 줄까지 전부» 사라진다.
 * 가드(p2u_partnerOnEdit)가 들어온 값을 즉시 걷어내야 수식이 되살아난다.
 *
 * ★ 이 시험이 지키는 것 ★
 *   가드가 보는 열과 헤더의 「(자동)」 열이 «같아야» 한다.
 *   헤더가 한 칸 밀리거나 자동 열이 늘면 가드는 엉뚱한 칸을 보게 되는데,
 *   그때 오류는 안 나고 «그 열만 조용히 사라진다».
 *
 * 실행: node _spillguard_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  통과 " : "★ 실패 ") + label +
    (ok ? "" : "  got " + JSON.stringify(got) + " want " + JSON.stringify(want)));
}

const lib = fs.readFileSync("_partnerLibrary.gs", "utf8");
const helpers = fs.readFileSync("_partnerHelpers.gs", "utf8");

// ── 헤더에서 「(자동)」 열이 몇 번째인지 뽑는다 ──
const hBlk = helpers.slice(helpers.indexOf("var _PT_ORDER_TAB_HEADERS_ = ["));
const headers = hBlk.slice(0, hBlk.indexOf("];"))
  .match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
eq("헤더 15열", headers.length, 15);

const 자동열_헤더 = [];
headers.forEach((h, i) => { if (h.indexOf("(자동)") !== -1) 자동열_헤더.push(i + 1); });
eq("헤더의 (자동) 열 = A·B·D·L·M·N", 자동열_헤더, [1, 2, 4, 12, 13, 14]);
/*  여섯 중 지금 스필 수식이 들어가는 것은 A·D·L·N 넷이다(헤더 정의의
    「수식 주입(A/D/L/N)」). B·M 은 스크립트가 값으로 채운다.
    가드는 여섯을 다 적어 두되 «1행이 ARRAYFORMULA 일 때만» 손대므로
    값으로 채우는 열은 저절로 건너뛴다 — 나중에 수식으로 바뀌어도 안 고친다. */

// ── 가드가 보는 열 ──
const gBlk = lib.slice(lib.indexOf("var 자동열 = ["));
const 가드열 = (gBlk.slice(0, gBlk.indexOf("];")).match(/c:\s*(\d+)/g) || [])
  .map((s) => parseInt(s.replace(/\D/g, ""), 10));
eq("★ 가드가 보는 열이 헤더의 (자동) 열과 같다", 가드열, 자동열_헤더);

// A1/D1/L1/N1 짝도 맞아야 한다 — 열 번호와 셀 주소가 어긋나면 엉뚱한 수식을 본다
const 글자 = (n) => String.fromCharCode(64 + n);
const 주소 = (gBlk.slice(0, gBlk.indexOf("];")).match(/a1:\s*"([A-Z]+1)"/g) || [])
  .map((s) => s.replace(/.*"([A-Z]+1)".*/, "$1"));
eq("셀 주소가 열 번호와 짝", 주소, 가드열.map((c) => 글자(c) + "1"));

// ── 지켜야 할 성질 ──
eq("발주 및 송장조회 탭에서만 돈다", lib.includes('sheet.getName() !== "발주 및 송장조회"'), true);
eq("★ 1행이 스필 수식일 때만 손댄다", lib.includes('f.indexOf("ARRAYFORMULA") === -1'), true);
eq("★ 1행(머리글)은 안 건드린다", lib.includes("if (endRow < 2) return;"), true);
eq("★ 왜 사라졌는지 알린다 (조용히 지우면 또 붙여넣는다)", /toast\(/.test(lib), true);
eq("걷어낸 게 없으면 조용하다", lib.includes("if (!걷어낸것.length) return;"), true);

console.log("\n결과: 통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
