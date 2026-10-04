/**
 * ═══════════════════════════════════════════════════════════════
 *  합포장이 «대리발송 줄»을 삼키지 않는가
 *  파일: node/_mergepartner_test.mjs   돌리기: node node/_mergepartner_test.mjs
 *
 *  2026-09-17 사장님 :
 *    「대리발송품목이 제대로 작동을 안하는거 같아 어디서 걸러지는지 확인해줘」
 *    「대리발송품목에 적힌 제품은 우리재고가 있어도 무조건 대리발송으로 넘어가면되」
 *
 *  라우팅은 맞았다 — 재고를 안 보고 대리발송으로 보낸다.
 *  깨진 곳은 그 «다음»에 도는 합포장이었다. 경로를 안 보고 출고지만 보고
 *  묶어서, 대리발송 줄이 합포장동봉으로 흡수되거나(발주 사라짐)
 *  반대로 우리 물건을 빨아들였다(고객이 못 받음).
 * ═══════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = fs.readFileSync(path.join(뿌리, "core.js"), "utf8");
const { ssMerge, SS_ROUTE, SS_DEFAULT_CONFIG } = new Function(
  core + "\nreturn { ssMerge: ssMerge, SS_ROUTE: SS_ROUTE, SS_DEFAULT_CONFIG: SS_DEFAULT_CONFIG };",
)();

const cfg = SS_DEFAULT_CONFIG;

let 실패 = 0;
function eq(이름, 실제, 기대) {
  const a = String(실제), b = String(기대);
  if (a === b) { console.log("  ok   " + 이름); return; }
  실패++;
  console.log("  FAIL " + 이름 + "  기대=" + b + "  실제=" + a);
}

/*  같은 사람에게 가는 줄 하나. 출고지는 «평택S-1» — 합배송 출고지다.
    「대리발송품목」으로 빠진 줄도 출고지는 그대로 이것이다.  */
function 줄(코드, 이름, route, 받는분) {
  return {
    고유ID: "U-" + 코드, 원본코드: 코드, 품목코드: 코드, 품목명: 이름,
    출고지: cfg.합배송출고지,
    조건ID: "C1", 수량: 1, 배송비: 3000, 박스수: 1,
    받는분: 받는분 || "홍길동",
    주소1: "경기 평택시 평택2로 29-8",
    보내는분: "팩투유",
    route: route, 보류사유: "",
  };
}
const 남은 = (units, route) => units.filter((u) => u.route === route).length;

/* ── [1] 대리발송 + 우리 물건 ────────────────────────────── */
console.log("[1] 대리발송 줄과 우리 물건이 같은 주소로 갈 때");
{
  const units = [
    줄("NKCUP01", "냅킨컵", SS_ROUTE.PARTNER),
    줄("MATYG01", "우리 물건", SS_ROUTE.LOTTE),
  ];
  ssMerge(units, cfg);
  eq("★ 대리발송이 그대로 남는다", 남은(units, SS_ROUTE.PARTNER), 1);
  eq("★ 우리 물건도 그대로 남는다", 남은(units, SS_ROUTE.LOTTE), 1);
  eq("★ 아무것도 흡수되지 않는다", units.filter((u) => u.합포장흡수).length, 0);
  eq("합포장 자체가 안 생긴다", units.filter((u) => u.합포장그룹).length, 0);
  eq("★ 이름이 섞이지 않는다", units[0].출력품목명 || "", "");
  eq("배송비도 안 건드린다", units[1].배송비, 3000);
}

/* ── [2] 차례를 바꿔도 마찬가지 ──────────────────────────── */
console.log("\n[2] 차례를 바꿔도 (대리발송이 뒤에 와도)");
{
  const units = [
    줄("MATYG01", "우리 물건", SS_ROUTE.LOTTE),
    줄("NKCUP01", "냅킨컵", SS_ROUTE.PARTNER),
  ];
  ssMerge(units, cfg);
  eq("★ 대리발송이 사라지지 않는다", 남은(units, SS_ROUTE.PARTNER), 1);
  eq("우리 물건도 그대로", 남은(units, SS_ROUTE.LOTTE), 1);
  eq("합포장동봉이 없다", 남은(units, SS_ROUTE.MERGED), 0);
}

/* ── [3] 대리발송끼리도 안 묶는다 ────────────────────────── */
console.log("\n[3] 대리발송 줄만 여럿일 때");
{
  const units = [
    줄("NKCUP01", "냅킨컵", SS_ROUTE.PARTNER),
    줄("NKPLT01", "냅킨접시", SS_ROUTE.PARTNER),
    줄("NKSPN01", "냅킨수저", SS_ROUTE.PARTNER),
  ];
  ssMerge(units, cfg);
  eq("★ 세 줄이 다 대리발송에 남는다", 남은(units, SS_ROUTE.PARTNER), 3);
  eq("업체 발주가 한 건도 안 빠진다", units.filter((u) => u.합포장흡수).length, 0);
}

/* ── [4] 우리 물건끼리는 «여전히» 묶인다 (회귀 막이) ─────── */
console.log("\n[4] 우리 물건끼리는 그대로 합포장된다");
{
  const units = [
    줄("MAT001", "우리 물건 가", SS_ROUTE.LOTTE),
    줄("MAT002", "우리 물건 나", SS_ROUTE.LOTTE),
  ];
  ssMerge(units, cfg);
  eq("★ 대표가 선다", units.filter((u) => u.합포장대표).length, 1);
  eq("★ 하나는 동봉된다", 남은(units, SS_ROUTE.MERGED), 1);
  eq("대표 이름에 합배송 표시", units[0].출력품목명.indexOf("===합배송") >= 0, "true");
  eq("동봉행 배송비는 0", units[1].배송비, 0);
}

/* ── [5] 섞여 있어도 «우리 것만» 묶인다 ──────────────────── */
console.log("\n[5] 대리발송 3 + 우리 물건 2 가 한 주소로");
{
  const units = [
    줄("NKCUP01", "냅킨컵", SS_ROUTE.PARTNER),
    줄("MAT001", "우리 물건 가", SS_ROUTE.LOTTE),
    줄("NKPLT01", "냅킨접시", SS_ROUTE.PARTNER),
    줄("MAT002", "우리 물건 나", SS_ROUTE.LOTTE),
    줄("NKSPN01", "냅킨수저", SS_ROUTE.PARTNER),
  ];
  ssMerge(units, cfg);
  eq("★ 대리발송 3건 그대로", 남은(units, SS_ROUTE.PARTNER), 3);
  eq("★ 우리 물건은 대표 1 + 동봉 1", 남은(units, SS_ROUTE.LOTTE) + "/" + 남은(units, SS_ROUTE.MERGED), "1/1");
  eq("★ 합포장에 든 줄은 둘뿐", units.filter((u) => u.합포장그룹).length, 2);
  const 묶인것 = units.filter((u) => u.합포장그룹).map((u) => u.품목코드).join(",");
  eq("★ 묶인 것이 우리 물건이다", 묶인것, "MAT001,MAT002");
}

/* ── [6] 받는 사람이 다르면 원래대로 안 묶인다 ───────────── */
console.log("\n[6] 받는 사람이 다르면");
{
  const units = [
    줄("MAT001", "우리 물건 가", SS_ROUTE.LOTTE, "홍길동"),
    줄("MAT002", "우리 물건 나", SS_ROUTE.LOTTE, "김철수"),
  ];
  ssMerge(units, cfg);
  eq("따로 나간다", 남은(units, SS_ROUTE.LOTTE), 2);
}

/* ── [7] 문이 실제로 달려 있는가 ─────────────────────────── */
console.log("\n[7] 합포장이 경로를 보는가");
{
  /*  ssAssignCondition 에도 똑같이 생긴 출고지 줄이 있다.
      파일 전체에서 찾으면 그 줄을 집는다 — 합포장 «함수 안»만 본다.  */
  const 시작 = core.indexOf("function ssMerge(");
  const 끝 = core.indexOf("\nfunction ", 시작 + 10);
  const 몸통 = core.substring(시작, 끝 > 0 ? 끝 : core.length);
  eq("합포장 함수를 잘라 냈다", 시작 > 0 && 몸통.length > 200, "true");

  eq("★ 대리발송 문이 있다",
    몸통.indexOf("if (u.route === SS_ROUTE.PARTNER) continue;") >= 0, "true");
  //  출고지 문 «앞»에 서야 한다 — 뒤에 서면 출고지가 다른 대리발송 건을 못 거른다
  eq("★ 출고지 문보다 앞에 선다",
    몸통.indexOf("if (u.route === SS_ROUTE.PARTNER) continue;") <
    몸통.indexOf("if (u.출고지 !== cfg.합배송출고지) continue;"), "true");
}

console.log(실패 ? "\n실패 " + 실패 + "건" : "\n대리발송은 우리 박스에 안 담긴다");
process.exit(실패 ? 1 : 0);
