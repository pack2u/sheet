/**
 * 머리글이 바뀌었을 때 «자료를 두고 오는가».
 *
 * ★ 왜 이 시험이 있나 ★  (2026-09-11)
 *   > "세트분리에서 판매현황 1,2,3차를 다 통합하지 못한건 아닌지 확인해줘"
 *
 *   실행이력 머리글에 택배사 이름('롯데택배')이 박혀 있었다. 롯데 → 로젠으로
 *   바꾸자 ssio_migrateHeader 가 «다른 표»로 보고 탭을 통째로
 *   실행이력_구버전_… 으로 밀어낸 뒤 빈 탭을 새로 만들었다.
 *   그날 오전 1차(10:05)가 현재 탭에서 사라져 보였다 — 자료는 옛 탭에 있지만
 *   이어서 읽는 코드는 옛 탭을 안 본다. 그게 더 나쁘다.
 *
 *   두 가지를 못 박는다.
 *     ① 머리글에 택배사 이름을 다시 쓰지 않는다.
 *     ② 이름만 바뀐 머리글은 탭을 밀어내지 않는다.
 *
 * 실행: node node/_migrate_test.mjs
 */
import fs from "node:fs";
import path from "node:path";

const 뿌리 = path.join(import.meta.dirname, "..");
/*  ★ 줄바꿈에 휘둘리지 않는다 ★  (2026-09-15)
    이 시험들은 소스를 «글자 그대로» 맞춰 본다. 그런데 윈도우 git 이
    체크아웃할 때 LF 를 CRLF 로 바꿔 놓는다 — 코드는 하나도 안 바뀌었는데
    여러 줄짜리 대조가 통째로 어긋나 「없다」고 나온다. 실제로 오늘
    git stash 한 번에 일일마감 검사가 거짓으로 실패했다. 한 가지로 맞춰 읽는다. */
const 읽기 = (p) => fs.readFileSync(path.join(뿌리, p), "utf8").split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));

let 실패 = 0;
function eq(설명, 받은, 바란) {
  const ok = String(받은) === String(바란);
  if (!ok) 실패++;
  console.log((ok ? "  통과 " : "★ 실패 ") + 설명 + (ok ? "" : `  got ${받은} want ${바란}`));
}

console.log("\n[머리글에 택배사 이름이 없는가]");
{
  const main = 읽기("gasMain.js");
  const i = main.indexOf("var SS_RUNLOG_HEADER");
  const 줄 = main.substring(i, main.indexOf(";", i));
  eq("실행이력 머리글에 「롯데」 없음", 줄.includes("롯데"), "false");
  eq("실행이력 머리글에 「로젠」 없음", 줄.includes("로젠"), "false");
  eq("대신 「자사출고」를 쓴다", 줄.includes("자사출고"), "true");
  /*  2026-09-15: 「동네배송」 칸을 뺐다 — 동네배송 시스템을 통째로 지웠다.
      칸 수를 못 박아 두면 «지우는 일»이 시험에 막힌다. 지금 사실로 맞춘다. */
  eq("칸 수 15 (동네배송 뺌)", 줄.split(",").length, 15);
  eq("★ 「동네배송」 칸이 없다", 줄.includes("동네배송"), "false");
}

console.log("\n[이름만 바뀐 머리글은 안 밀어내는가]");
{
  const io = 읽기("gasIO.js");
  const i = io.indexOf("function ssio_migrateHeader");
  const 몸 = io.substring(i, io.indexOf("var old = name +", i));
  eq("칸 수가 같은지 본다", 몸.includes("cur.length === headers.length"), "true");
  eq("몇 칸이 그대로인지도 본다", 몸.includes("같은칸"), "true");
  eq("★ 절반 넘게 같아야 이름 바뀜으로 본다", 몸.includes("같은칸 * 2 > headers.length"), "true");
  /* 밀어내기는 «남아 있어야» 한다 — 칸 수가 진짜 달라진 때를 위한 길이다 */
  eq("칸 수가 달라지면 여전히 밀어낸다", io.includes("'_구버전_'"), "true");
}

console.log(실패 ? `\n실패 ${실패}건` : "\n자료를 두고 오지 않는다");
process.exit(실패 ? 1 : 0);
