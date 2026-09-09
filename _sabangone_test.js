/**
 * 사방넷 대량등록 — 주문번호당 송장 **하나만**
 * ★ 2026-09-09
 *
 *   node --test _sabangone_test.js
 *
 * ★ 두 방향을 헷갈리면 안 된다 ★
 *   막아야 하는 것   한 주문번호 → 송장 여럿   (사방넷이 안 받는다)
 *   막으면 안 되는 것 여러 주문번호 → 같은 송장 (합포장·샘플. 각각 등록돼야 한다)
 *
 *   사장님 확인 (2026-09-09)
 *     "대량등록은 무조건 대표 송장 1개만 입력가능해.. 사방넷 시스템"
 *     "샘플은 각각 고유아이디를 가지는 주문으로 들어와.. 그것을 우리가 합쳐서
 *      하나의 박스로 담아서 배송하는거야"
 *
 *   한 번 반대로 만들었다가 되돌린 자리다. 그래서 시험으로 못 박는다.
 *   원장·일일마감은 반대로 **모든 송장**이 들어가야 한다(CS 택배조회) —
 *   그건 gasMain 쪽이고 여기와 쓰임이 다르다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/** gasBulk.js 에서 ssb_addRows 와 그 이웃을 떼어 온다 — 복사본을 두면 갈라진다 */
function load() {
  const src = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasBulk.js"), "utf8");
  const grab = (name) => {
    const at = src.indexOf("function " + name + "(");
    if (at < 0) throw new Error(name + " 을 못 찾았습니다");
    let depth = 0, i = src.indexOf("{", at);
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    return src.slice(at, i + 1);
  };
  const splitAt = src.indexOf("var SSB_INV_SPLIT");
  const splitEnd = src.indexOf(";", src.indexOf("]+')", splitAt)) + 1;
  const head =
    "function ssText(v){return v==null?'':String(v).trim();}\n" +
    src.slice(splitAt, splitEnd) + "\n" +
    grab("ssb_isPlaceholder") + "\n" +
    "function ssIsSabangnetUid(u){u=ssText(u);if(!u)return false;" +
    "if(/^\\d{4}(\\d{2})?-[A-Za-z]{2}-/.test(u))return false;return /^\\d+$/.test(u);}\n" +
    grab("ssb_addRows");
  return new Function(head + "\nreturn ssb_addRows;")();
}

const addRows = load();

/** 한 번 돌리는 껍데기 */
function run(pairs) {
  const rows = [], seen = {}, seenOrd = {}, res = { skipGen: 0, byCode: {} };
  for (const [ord, inv] of pairs) addRows(rows, seen, ord, inv, "002", res, {}, seenOrd);
  return rows;
}

test("★ 한 주문번호에 송장이 여럿이면 첫 장만 올린다 ★", () => {
  //  20박스 주문 — 사방넷에는 대표 한 장만
  const rows = run([["2161346705", "268334484434 268334484445 268334484541"]]);
  assert.equal(rows.length, 1, "여러 줄을 만들면 사방넷이 그 주문을 안 받는다");
  assert.equal(rows[0][0], "2161346705");
  assert.equal(rows[0][1], "268334484434", "첫 장이 대표다");
});

test("원천이 달라 다른 송장이 또 와도 한 줄만 남는다", () => {
  //  임시기록에서 한 장, 롯데탭에서 다른 장 — 같은 주문번호다
  const rows = run([
    ["2161346705", "268334484434"],
    ["2161346705", "268334484445"],
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], "268334484434");
});

test("★ 여러 주문번호가 같은 송장을 나눠 갖는 것은 막지 않는다 ★", () => {
  /* 합포장·샘플이다. 샘플은 각각 고유아이디를 가진 주문으로 들어와
     우리가 한 박스에 담는다. 사방넷에는 **주문마다** 등록돼야
     빠지는 주문 없이 송장번호가 다 들어간다. */
  const rows = run([
    ["2161346686", "268334485204"],
    ["2161346687", "268334485204"],
    ["2161346688", "268334485204"],
  ]);
  assert.equal(rows.length, 3, "합포장 동봉 건이 빠지면 안 된다");
  assert.deepEqual(rows.map((r) => r[1]), ["268334485204", "268334485204", "268334485204"]);
});

test("쉼표·공백·줄바꿈 어느 것으로 붙어 와도 첫 장을 뽑는다", () => {
  for (const cell of [
    "268334484434,268334484445",
    "268334484434 268334484445",
    "268334484434\n268334484445",
    "268334484434/268334484445",
  ]) {
    const rows = run([["2161346705", cell]]);
    assert.equal(rows.length, 1, cell);
    assert.equal(rows[0][1], "268334484434", cell);
  }
});

test("우리가 만든 UID 는 애초에 안 올라간다", () => {
  const rows = run([
    ["0909-PH-a3f19", "268334484434"],
    ["260902-PH-a3f19", "268334484445"],
    ["0908-ds-3768", "268334484541"],
  ]);
  assert.equal(rows.length, 0);
});

test("빈 값·송장 없는 줄은 그냥 넘어간다", () => {
  assert.equal(run([["2161346705", ""]]).length, 0);
  assert.equal(run([["", "268334484434"]]).length, 0);
});
