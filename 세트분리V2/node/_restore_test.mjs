/**
 * 원장 → 판매현황 되살리기.
 *
 * ★ 왜 이 시험이 있나 ★  (2026-09-11)
 *   > "오늘 날짜만 뽑아서 판매현황 양식으로 바꿔서 시트를 만들어줘"
 *
 *   원장은 판매현황의 사본이 아니라 «분해된 뒤»의 처리 결과다.
 *   한 주문 줄이 구성품만큼 늘어나 있고, 칸의 뜻도 다르다 —
 *   원장의 「거래처명」에는 받는분이 들어 있다(ssLedgerRow).
 *
 *   되살린 표를 그대로 세트분리에 넣으면 출고가 달라진다. 그래서
 *   «무엇을 못 되살렸는지»를 말하게 하는 것이 이 기능의 절반이다.
 *   그 절반이 빠지지 않았는지 여기서 못 박는다.
 *
 * 실행: node node/_restore_test.mjs
 */
import fs from "node:fs";
import path from "node:path";

const 뿌리 = path.join(import.meta.dirname, "..");
const main = fs.readFileSync(path.join(뿌리, "gasMain.js"), "utf8");
const core = fs.readFileSync(path.join(뿌리, "core.js"), "utf8");

const i = main.indexOf("function ss_오늘판매현황복원()");
if (i < 0) { console.error("함수를 못 찾았습니다"); process.exit(1); }
const 끝 = main.indexOf("function ss_구버전점검()", i);
const 몸 = main.substring(i, 끝);

let 실패 = 0;
function eq(설명, 받은, 바란) {
  const ok = String(받은) === String(바란);
  if (!ok) 실패++;
  console.log((ok ? "  통과 " : "★ 실패 ") + 설명 + (ok ? "" : `  got ${받은} want ${바란}`));
}

console.log("\n[분해된 줄을 도로 접는가]");
eq("★ 순번으로 묶는다 — 구성품 수만큼 늘어난 줄을 한 줄로", 몸.includes("본순번[순번]"), "true");
eq("원본품목코드를 쓴다 (분해된 품목코드가 아니라)", 몸.includes("G(r, '원본품목코드')"), "true");
eq("주문수량을 쓴다 (분해 후 수량이 아니라)", 몸.includes("G(r, '주문수량')"), "true");
eq("오늘 회차만", 몸.includes("rk.substring(0, 6) !== today"), "true");

console.log("\n[뜻이 다른 칸을 되살리는가]");
eq("★ 품목명은 마스터에서 — 원장엔 구성품 이름이 들어 있다", 몸.includes("이름[원본코드]"), "true");
eq("★ 거래처명은 보내는분에서 — 원장의 그 칸은 받는분이다", 몸.includes("'대리발송-' + 보내는분"), "true");
eq("사방넷 건은 이름/번호로 도로 접는다", 몸.includes("받는분 + '/' + 사방넷번호"), "true");
eq("사방넷 건은 주소/메시지도 한 칸으로", 몸.includes("추가장문형식1"), "true");
eq("주소는 원주소가 먼저 (주소변경 전 값)", 몸.includes("G(r, '원주소')"), "true");

console.log("\n[못 되살린 것을 말하는가]");
eq("품목명 출처를 말한다", 몸.includes("품목 마스터에서 가져왔습니다"), "true");
eq("거래처명이 되살린 값임을 말한다", 몸.includes("보내는분에서 되살린 값"), "true");
eq("배송비 칸이 빈 이유를 말한다", 몸.includes("세트분리가 안 읽고"), "true");
eq("★ 주문서 출처를 구분 못 한다고 말한다", 몸.includes("주문서의심"), "true");
eq("★ 「대조·보기가 먼저」라고 말한다", 몸.includes("대조·보기»가 먼저"), "true");

console.log("\n[판매현황 양식 그대로인가]");
{
  //  칸 이름을 손으로 적지 않고 SS_SALES_COLS 를 쓰는지 — 적으면 언젠가 갈라진다
  eq("SS_SALES_COLS 를 머리글로 쓴다", 몸.includes("SS_SALES_COLS"), "true");
  eq("칸 이름으로 넣는다 (자리번호가 아니라)", 몸.includes("SS_SALES_COLS.indexOf(name)"), "true");
  const j = core.indexOf("var SS_SALES_COLS = [");
  const 양식 = core.substring(j, core.indexOf("];", j));
  ["순번", "일자-No.", "품목코드", "품목명", "수량", "거래처명", "적요",
   "주문자명(사방넷)", "전화번호(사방넷)", "추가장문형식1"].forEach((c) => {
    eq(`양식에 「${c}」가 있다`, 양식.includes(`'${c}'`), "true");
  });
}

console.log("\n[메뉴에 있는가]");
eq("메뉴에 붙어 있다", main.includes("'ss_오늘판매현황복원'"), "true");

console.log(실패 ? `\n실패 ${실패}건` : "\n되살리고, 못 되살린 것을 말한다");
process.exit(실패 ? 1 : 0);
