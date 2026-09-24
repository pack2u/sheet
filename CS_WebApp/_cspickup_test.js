/**
 * 방문수령 딱지
 *
 *  > "자사 직접이라고 나오는데 방문수령이라고 나오게 해줘"
 *
 *  ★ 「자사 직접」은 방문수령이 아니다 ★
 *    그것은 «송장을 자사출고 탭에서 찾았다»는 뜻이다(세트분리 gasMain.js:1748).
 *    택배로 나간 건에도 붙는다. 이름만 바꾸면 택배 주문이 전부 방문수령이 된다.
 *    그래서 «진짜 방문수령»만 따로 가린다.
 *
 *  ★ 정규식을 쓰지 않는다 ★ 백슬래시가 먹혀 헛시험이 되는 일이 잦았다.
 *
 * 실행: node _cspickup_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

const GS = fs.readFileSync("csOrderSearch.gs", "utf8");
const HTML = fs.readFileSync("home.html", "utf8");
const has = (s) => HTML.indexOf(s) >= 0;

function fnFrom(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) throw new Error("못 찾음: " + name);
  let d = 0;
  const open = src.indexOf("{", at);
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error("안 닫힘: " + name);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fnFrom(GS, "_cs_isPickupMemo_"), ctx);
const 방문 = (s) => ctx._cs_isPickupMemo_(s);

/* ── [1] 방문수령으로 봐야 하는 말 ──────────────────────── */
console.log("\n[1] 이런 적요는 방문수령이다");
{
  ok("방문수령", 방문("방문수령"));
  ok("방문 수령 (띄어 씀)", 방문("방문 수령"));
  ok("직접수령", 방문("직접수령"));
  ok("직접 수령", 방문("직접 수령"));
  ok("픽업", 방문("픽업"));
  ok("★ 문장 안에 섞여 있어도", 방문("9/17 방문수령 하시기로 함"));
  ok("★ 방문·수령이 떨어져 있어도", 방문("고객이 방문하셔서 수령"));
}

/* ── [2] 방문수령이 «아닌» 말 ───────────────────────────── */
console.log("\n[2] 이런 말에 걸리면 안 된다");
{
  ok("★ 「직접」 한 글자로는 안 잡는다", !방문("직접 전화주세요"));
  ok("★ 「방문」 한 글자로도 안 잡는다", !방문("방문예정 9/20"));
  ok("  배송 관련 보통 말", !방문("부재시 경비실"));
  ok("  빈 칸", !방문(""));
  ok("  null", !방문(null));
  ok("  숫자만", !방문("12345"));
}

/* ── [3] 어디서 읽는가 ──────────────────────────────────── */
console.log("\n[3] 적요만 본다 — 배송메시지는 안 본다");
{
  //  배송메시지는 고객이 쓴 «요청»이지 우리가 확인한 «사실»이 아니다.
  //  (2026-09-16 에 「합배송 해주세요」를 「합배송 되었다」로 읽을 뻔했다)
  ok("★ 적요에서 읽는다", GS.indexOf('_cs_isPickupMemo_(G(row, "적요"))') >= 0);
  ok("★ 배송메시지는 안 섞는다",
    GS.indexOf('_cs_isPickupMemo_(G(row, "배송메시지")') < 0 &&
    GS.indexOf('_cs_isPickupMemo_(G(row, "적요") + ') < 0);
}

/* ── [4] 화면까지 오는가 ────────────────────────────────── */
console.log("\n[4] 배선 — 서버에서 딱지까지");
{
  ok("★ 서버가 pickup 을 실어 보낸다", GS.indexOf("pickup: _cs_isPickupMemo_") >= 0);
  //  ★ 여기서 안 넘기면 딱지가 «한 번도» 안 뜬다 (반품 뱃지가 그렇게 죽어 있었다)
  ok("★ 검색 결과로 넘길 때도 싣는다", has("pickup: !!row.pickup,"));
  ok("★ 카드가 딱지를 그린다", has('🚶 방문수령'));
  ok("  왜 붙었는지 알려 준다", has('title="적요에 방문수령이라 적혀 있습니다"'));
  ok("★ 「자사 직접」을 «대신»한다 (둘이 같이 안 뜬다)",
    has("(r.pickup\n          ? '<span class=\"os-tag pickup\"") ||
    has("r.pickup") && HTML.indexOf("r.pickup") < HTML.indexOf("tagClass(r.source, r.origin)"));

  ok("★ 딱지 색이 있다", has(".os-tag.pickup {"));
  ok("★ 밝은 화면에서도 보인다", has(':root[data-theme="light"] .os-tag.pickup'));
}

/* ── [5] 「자사 직접」은 그대로 둔다 ────────────────────── */
console.log("\n[5] 택배로 나간 건은 안 건드린다");
{
  //  이름만 바꾸면 택배 주문이 전부 방문수령으로 보인다 — 그렇게 안 했는지 본다
  ok("★ 「자사 직접」을 통째로 갈아치우지 않았다",
    HTML.indexOf("방문수령'") < 0 || HTML.indexOf("'자사 직접'") < 0);
  ok("★ 원천(세트분리)의 글자는 그대로다",
    fs.readFileSync("../세트분리V2/gasMain.js", "utf8").indexOf("'자사 직접'") >= 0);
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
