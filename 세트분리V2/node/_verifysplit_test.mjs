/**
 * ★ 나가기 직전 검문 ★ — 주문한 구성과 나가는 구성이 같은가
 *
 *   > "다시는 이런일이 발생하지 않게 수정해줘"
 *
 * 2026-09-17 에 몸통이 뚜껑으로 바뀌어 나갔다. 원인은 수동조치였지만,
 * 그 전에 BOM 겹침이라 짚었다가 틀렸고 뚜껑이 세트로 등록된 것이라
 * 짚었다가 또 틀렸다. 세 번째 길이 없다는 보장이 없다.
 *
 * 그래서 원인이 아니라 «결과»를 본다. 이 시험은 그 그물이
 * 정말 촘촘한지, 그리고 «멀쩡한 것까지 잡지는 않는지»를 본다.
 *
 * 실행: node node/_verifysplit_test.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../core.js");

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

const 세트 = "JHMINIJJIMB00002";
const 몸통 = "JHMINIJJIMB90002";
const 뚜껑 = "JHMINIJJIM90005";
const masters = { bom: { [세트]: [{ code: 몸통, qty: 1 }, { code: 뚜껑, qty: 1 }] } };

function 검문(codes, opts) {
  opts = opts || {};
  const units = codes.map((c, i) => ({
    고유ID: "2163378867", 순번: 100047, 원본코드: 세트, 품목코드: c,
    라인ID: "100047-" + (i + 1), 세트분해: true,
    route: "로젠택배", 수정코드: (opts.수정코드 || [])[i] === true,
  }));
  const warnings = [];
  const n = C.ssVerifySplit(units, masters, warnings);
  return { units, warnings, 막음: n };
}

/* ── [1] ★ 9/17 그 상황 ★ ──────────────────────────────── */
console.log("\n[1] 몸통이 뚜껑으로 바뀌었을 때");
{
  const r = 검문([뚜껑, 뚜껑]);   // 둘 다 뚜껑 — 실제로 나간 모습
  eq("★ 두 줄 모두 미발송으로 세운다", r.막음, 2);
  eq("  첫 줄 경로", r.units[0].route, C.SS_ROUTE.HOLD);
  eq("  둘째 줄 경로", r.units[1].route, C.SS_ROUTE.HOLD);
  eq("  사유", r.units[0].보류사유, "구성품어긋남");
  eq("  상세에 무엇이 겹쳤는지 적는다",
    r.units[0].보류상세.indexOf(뚜껑) >= 0, true);

  const w = r.warnings.filter((x) => x.code === "SPLIT_MISMATCH");
  eq("★ 오류로 말한다", w.length, 1);
  eq("  등급", w[0].level, "오류");
  eq("  왜 «둘 다» 세웠는지 적는다",
    w[0].msg.indexOf("반쪽만 나가는 것보다") >= 0, true);
  eq("  무엇을 하면 되는지 적는다",
    w[0].msg.indexOf("판매현황을 고쳐 다시 실행") >= 0, true);
}

/* ── [2] 멀쩡한 것은 안 잡는다 ──────────────────────────── */
console.log("\n[2] 멀쩡한 세트");
{
  const r = 검문([몸통, 뚜껑]);
  eq("★ 안 막는다", r.막음, 0);
  eq("  경로 그대로", r.units[0].route, "로젠택배");
  eq("  경고 없음", r.warnings.length, 0);
}

/* ── [3] BOM 에 없는 코드로 바뀐 것 ─────────────────────── */
console.log("\n[3] 엉뚱한 코드로 바뀌었을 때");
{
  const r = 검문([몸통, "ZZZ999"]);
  eq("★ 막는다", r.막음, 2);
  eq("  상세", r.units[0].보류상세.indexOf("BOM 에 없는") >= 0, true);
}

/* ── [4] 사람이 «일부러» 고친 코드는 통과시킨다 ─────────── */
console.log("\n[4] 수동조치로 일부러 고친 코드");
{
  //  보류에서 코드를 올바른 것으로 고쳐 내보내는 것은 정상 흐름이다
  const r = 검문([몸통, "ZZZ999"], { 수정코드: [false, true] });
  eq("★ 막지 않는다", r.막음, 0);
  eq("  경로 그대로", r.units[1].route, "로젠택배");

  //  ★ 다만 «겹치면» 일부러 고친 것이라도 막는다 ★
  const r2 = 검문([뚜껑, 뚜껑], { 수정코드: [true, true] });
  eq("★ 겹치면 고친 것이라도 막는다", r2.막음, 2);
}

/* ── [5] 구성품이 «모자란» 것은 막지 않는다 ─────────────── */
console.log("\n[5] 한쪽이 재고부족으로 빠졌을 때");
{
  //  몸통이 보류로 빠지고 뚜껑만 나가는 것은 정상이다.
  //  여기서 막으면 나갈 수 있는 것도 못 나간다.
  const units = [{
    고유ID: "U9", 순번: 1, 원본코드: 세트, 품목코드: 뚜껑,
    라인ID: "1-2", 세트분해: true, route: "로젠택배",
  }];
  const warnings = [];
  eq("★ 한 줄만 있어도 안 막는다", C.ssVerifySplit(units, masters, warnings), 0);
  eq("  경고 없음", warnings.length, 0);
}

/* ── [6] 쪼개지 않은 줄은 견줄 것이 없다 ────────────────── */
console.log("\n[6] 안 쪼갠 줄");
{
  const units = [
    { 고유ID: "U8", 순번: 2, 원본코드: "PLAIN", 품목코드: "PLAIN", 라인ID: "2", 세트분해: false, route: "로젠택배" },
    { 고유ID: "U8", 순번: 3, 원본코드: "PLAIN", 품목코드: "PLAIN", 라인ID: "3", 세트분해: false, route: "로젠택배" },
  ];
  const warnings = [];
  eq("★ 같은 코드가 둘이어도 안 막는다", C.ssVerifySplit(units, masters, warnings), 0);
  eq("  (다른 주문줄이 같은 물건을 시킨 것뿐이다)", warnings.length, 0);
}

/* ── [7] 다른 순번끼리는 섞어 보지 않는다 ───────────────── */
console.log("\n[7] 한 사람이 같은 세트를 두 줄 시켰을 때");
{
  const mk = (순번, code, seq) => ({
    고유ID: "U7", 순번, 원본코드: 세트, 품목코드: code,
    라인ID: 순번 + "-" + seq, 세트분해: true, route: "로젠택배",
  });
  const units = [mk(10, 몸통, 1), mk(10, 뚜껑, 2), mk(11, 몸통, 1), mk(11, 뚜껑, 2)];
  const warnings = [];
  eq("★ 안 막는다 (순번이 다르면 다른 주문줄)",
    C.ssVerifySplit(units, masters, warnings), 0);
  eq("  경고 없음", warnings.length, 0);
}

/* ── [8] 배선 — ssRun 이 정말 부르는가 ──────────────────── */
console.log("\n[8] 배선");
{
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "core.js"), "utf8");
  const at = src.indexOf("function ssRun(");
  const body = src.substring(at, at + 2000);
  eq("★ ssRun 이 부른다", body.indexOf("ssVerifySplit(units, masters, warnings);") >= 0, true);
  //  ★ 자리가 중요하다 ★ 라우팅 뒤여야 보류가 반영되고,
  //    합포장 앞이어야 잘못된 줄이 박스에 빨려 들지 않는다
  const r = body.indexOf("ssRoute(units");
  const v = body.indexOf("ssVerifySplit(units");
  const m = body.indexOf("ssMerge(units");
  eq("  라우팅 «뒤»", v > r, true);
  eq("  합포장 «앞»", v < m, true);
}

console.log("");
console.log(fail ? "FAIL " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
