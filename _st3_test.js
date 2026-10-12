/** _statusThree.gs 를 그대로 불러 시험한다 (GAS 전역 꼴이라 eval 로 올린다) */
import fs from "node:fs";
import assert from "node:assert/strict";
const src = fs.readFileSync("D:/Pack2U_상품정보sheet/_statusThree.gs", "utf8");
const g = {};
new Function("g", src + "\ng._st3_fold_=_st3_fold_; g._st3_isThree_=_st3_isThree_; g._ST3_WORDS_=_ST3_WORDS_;")(g);
const f = g._st3_fold_;

const 기대 = {
  "판매중": "판매중", "판매중(재고까지만)": "판매중", "품절임박": "판매중", "특판/할인": "판매중",
  "품절": "품절", "소싱중": "품절", "상세제작중": "품절", "상세제작종": "품절",
  "단종품": "단종품",
};
let n = 0;
for (const [a, b] of Object.entries(기대)) { assert.equal(f(a), b, `${a} → ${f(a)} (기대 ${b})`); n++; }
console.log("아는 낱말 " + n + "개 다 맞음");

/* 세 가지 안에만 드는가 */
for (const b of Object.values(기대)) assert.ok(g._st3_isThree_(b), b + " 가 세 가지에 없다");

/* ★ 모르는 낱말은 안 건드린다 ★ */
for (const u of ["주문제작", "", "  ", "판매", "품절 임박", "SET전용"]) {
  assert.equal(f(u), u.trim(), "모르는 낱말 「" + u + "」를 건드렸다");
}
console.log("모르는 낱말 6개 — 그대로 흘려보냄");

/* 공백·null 도 안 깨지나 */
assert.equal(f(null), ""); assert.equal(f(undefined), ""); assert.equal(f("  품절  "), "품절");
console.log("빈값·공백 처리 OK");
console.log("\n★ 깨 보기 ★");
for (const [이름, 바꿈] of [
  ["품절임박을 품절로", (s) => s.replace("'품절임박': '판매중'", "'품절임박': '품절'")],
  ["단종품을 품절로", (s) => s.replace("'단종품': '단종품'", "'단종품': '품절'")],
  ["모르는 낱말을 판매중으로", (s) => s.replace("return 접힘 ? 접힘 : s;", "return 접힘 ? 접힘 : '판매중';")],
  ["접기를 꺼 보기", (s) => s.replace("var _ST3_ON_ = true;", "var _ST3_ON_ = false;")],
]) {
  const g2 = {};
  new Function("g", 바꿈(src) + "\ng._st3_fold_=_st3_fold_;")(g2);
  let 잡힘 = false;
  try {
    for (const [a, b] of Object.entries(기대)) assert.equal(g2._st3_fold_(a), b);
    for (const u of ["주문제작"]) assert.equal(g2._st3_fold_(u), u);
  } catch (_) { 잡힘 = true; }
  console.log("  " + (잡힘 ? "OK " : "X  ") + 이름 + (잡힘 ? "  ← 시험이 잡았다" : "  ← 시험이 통과했다!"));
}
