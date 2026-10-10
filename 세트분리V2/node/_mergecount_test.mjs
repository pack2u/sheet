/**
 *  합배송 대표 이름에 «같은 품목 몇 개»가 보이는가
 *  파일: node/_mergecount_test.mjs   돌리기: node node/_mergecount_test.mjs
 *  2026-10-02 사장님 : 「…200개--/소분 ==합배송 이렇게 나오는데 어떤거와 합배송인지가 안나와서」
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = fs.readFileSync(path.join(뿌리, "core.js"), "utf8");
const { ssMerge, SS_ROUTE, SS_DEFAULT_CONFIG } = new Function(
  core + "\nreturn { ssMerge: ssMerge, SS_ROUTE: SS_ROUTE, SS_DEFAULT_CONFIG: SS_DEFAULT_CONFIG };")();
const cfg = SS_DEFAULT_CONFIG;
let 실패 = 0;
const eq = (이름, a, b) => { if (String(a) === String(b)) console.log("  ok   " + 이름); else { 실패++; console.log("  FAIL " + 이름 + "\n    기대=" + b + "\n    실제=" + a); } };
const 줄 = (코드, 이름) => ({ 고유ID: "U-" + 코드 + Math.random(), 원본코드: 코드, 품목코드: 코드, 품목명: 이름,
  출고지: cfg.합배송출고지, 조건ID: "C1", 수량: 1, 배송비: 3000, 박스수: 1, 받는분: "전금주",
  주소1: "서울 강동구 아리수로76길 38", 보내는분: "팩투유", route: SS_ROUTE.LOTTE, 보류사유: "" });
const 실링 = "BF 실링 191440 (3호) 화이트 (100*2팩) 200개--/소분";

console.log("[1] 같은 품목 두 줄");
{ const u = [줄("A", 실링), 줄("A", 실링)]; ssMerge(u, cfg);
  eq("★ 「===2개 합배송」", u[0].출력품목명, 실링 + " ★★ ===2개 합배송"); }

console.log("[2] 다른 품목 둘 — 예전 그대로");
{ const u = [줄("A", 실링), 줄("B", "BW 2145 사출 중화면용기 소 검정 (100*1팩)")]; ssMerge(u, cfg);
  eq("숫자 없이 「===합배송」", / ===합배송$/.test(u[0].출력품목명), true); }

console.log("[3] 같은 것 둘 + 다른 것 하나");
{ const u = [줄("A", 실링), 줄("A", 실링), 줄("B", "BW 2145 사출 중화면용기 소 검정 (100*1팩)")]; ssMerge(u, cfg);
  eq("★ 건수 3개", / ===3개 합배송$/.test(u[0].출력품목명), true); }

console.log("[4] 읽는 쪽이 찾는 글자는 그대로");
{ const u = [줄("A", 실링), 줄("A", 실링)]; ssMerge(u, cfg);
  eq("합배송 글자가 들어 있다", /===\s*(\d+\s*개\s*)?합배송/.test(u[0].출력품목명), true); }

console.log(실패 ? "\n✗ " + 실패 + "건 실패" : "\n✓ 모두 통과");
process.exit(실패 ? 1 : 0);
