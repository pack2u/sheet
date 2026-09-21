/**
 * 사방넷 대량등록에 **우리가 만든 UID 가 섞이지 않는가**
 * ★ 2026-09-09
 *
 *   node --test _sabanguid_test.js
 *
 * ★ 왜 있나 ★
 *   사방넷 송장대량등록 파일에는 **사방넷이 아는 주문번호만** 들어가야 한다.
 *   우리가 붙인 ID(전화주문 PH-, 발주수집 ds-)가 섞이면 사방넷이 모르는
 *   번호라 그 줄이 업로드에서 튕기고, 결국 **사람이 건별로 손으로 넣게 된다.**
 *   대량등록을 만든 이유가 그걸 없애는 것인데 거꾸로 되는 셈이다.
 *
 *   막는 관문이 `_po_isGeneratedUid_` 하나인데, 날짜 자리가 두 가지다.
 *     0909-PH-a3f19    2026-09-09 부터 (세트분리V2 SS_ID_SHORT_FROM)
 *     260902-PH-a3f19  그 이전 주문 — **지금도 원장에 남아 있다**
 *   4자리만 보면 옛 것이 통과한다. 실제로 통과하고 있었다.
 *   (세트분리 보강 갈래에 막는 줄이 하나 더 있었지만 정규식에 \ 가 빠져
 *    「d 가 여섯 번」이 되어 아무것도 안 걸렀다.)
 *
 * ★ 두 시스템이 같은 답을 내야 한다 ★
 *   세트분리V2 의 ssIsSabangnetUid 와 허브의 _po_isGeneratedUid_ 가
 *   서로 다르게 판정하면, 한쪽이 넣은 줄을 다른 쪽이 빼거나 그 반대가 된다.
 *   그래서 두 파일에서 함수를 **실제로 떼어 와** 나란히 시험한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/** 파일에서 함수 하나를 떼어 온다 — 복사본을 두면 반드시 갈라진다 */
function grab(file, fnName) {
  const src = fs.readFileSync(path.join(__dirname, file), "utf8");
  const at = src.indexOf("function " + fnName + "(");
  if (at < 0) throw new Error(file + " 에서 " + fnName + " 을 못 찾았습니다");
  // 함수 끝 = 열 중괄호 짝이 맞는 곳
  let depth = 0, i = src.indexOf("{", at);
  const start = at;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start, i + 1);
  // ssText 는 세트분리 쪽 도우미다. 시험에서는 같은 뜻으로 채워 준다.
  const helper = "function ssText(v){return v==null?'':String(v).trim();}";
  return new Function(helper + "\n" + body + "\nreturn " + fnName + ";")();
}

const isGenerated = grab("_partnerOrders.gs", "_po_isGeneratedUid_");
const isSabang = grab("세트분리V2/core.js", "ssIsSabangnetUid");

/** [uid, 설명, 사방넷 주문번호인가] */
const CASES = [
  ["2160626355", "진짜 사방넷 주문번호", true],
  ["20260908123456", "긴 사방넷 번호", true],
  ["0909-PH-a3f19", "전화주문 — 새 4자리 날짜", false],
  ["0921-PH-a3f194", "전화주문 — 2026-09-21 부터 뒷자리 6", false],
  ["0921-PH-a3f194-2", "전화주문 — 같은 회차에 겹쳐 순번이 붙은 것", false],
  ["260902-PH-a3f19", "전화주문 — 옛 6자리 날짜", false],
  ["0908-ds-3768", "발주수집이 발급", false],
  ["0902-DS-e158", "발주수집 — 대문자", false],
];

test("★ 우리가 만든 UID 는 사방넷 대량등록에 안 들어간다 ★", () => {
  for (const [uid, why, isReal] of CASES) {
    assert.equal(
      isGenerated(uid), !isReal,
      `${uid} (${why}) — _po_isGeneratedUid_ 판정이 틀렸습니다`
    );
  }
});

test("세트분리와 허브가 같은 답을 낸다", () => {
  for (const [uid, why, isReal] of CASES) {
    assert.equal(
      isSabang(uid), isReal,
      `${uid} (${why}) — ssIsSabangnetUid 판정이 틀렸습니다`
    );
    assert.equal(
      isSabang(uid), !isGenerated(uid),
      `${uid} (${why}) — 두 시스템의 판정이 갈립니다`
    );
  }
});

test("옛 6자리 전화주문 ID 가 새는지 — 이번에 고친 바로 그것", () => {
  //  고치기 전에는 이 줄이 통과해 대량등록 파일에 들어갔다
  assert.equal(isGenerated("260902-PH-a3f19"), true);
  assert.equal(isSabang("260902-PH-a3f19"), false);
});

test("빈 값·이상한 값에 겁먹지 않는다", () => {
  for (const v of ["", null, undefined, "   ", "abc"]) {
    assert.equal(isGenerated(v), false, "생성 UID 는 아니다");
    assert.equal(isSabang(v), false, "사방넷 번호도 아니다");
  }
});

test("사방넷 번호는 숫자뿐이다 — 세트분리 쪽이 한 겹 더 막는다", () => {
  /* 허브의 _po_isGeneratedUid_ 는 「생성 UID 인가」만 본다. 그래서
     「ORD-123」 같은 것은 통과시킨다. 세트분리는 숫자만 통과시켜 한 겹 더 막는다.
     지금은 이 차이가 문제를 안 만들지만(그런 번호가 안 들어온다),
     들어오기 시작하면 허브 쪽이 먼저 샌다는 것을 여기 적어 둔다. */
  assert.equal(isSabang("ORD-123"), false);
  assert.equal(isGenerated("ORD-123"), false, "허브는 못 막는다 — 알고 두는 차이");
});
