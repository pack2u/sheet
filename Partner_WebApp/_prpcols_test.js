/**
 * 협력업체 반품 포털 — 대장 열 찾기
 * ★ 2026-09-09
 *
 *   node --test Partner_WebApp/_prpcols_test.js
 *
 * ★ 왜 있나 ★
 *   9월 탭(202609)에서 대장 머리글이 두 군데 바뀌었다 —
 *     D열  「업체명」        → 「주문지」
 *     H열  (없던 것)         → 「반품송장번호」가 끼어 뒤가 한 칸씩 밀림
 *   포털은 「주문지」를 몰라 col.vendor 가 -1 이 되었고,
 *   **협력업체가 반품 접수를 아예 못 했다** (당장드림 신고, 2026-09-09).
 *
 *   반품비도 같이 틀렸다. 머리글이 「반품/환불비용」인데 가운데 「/」 때문에
 *   「반품비」로 안 걸려 M열 폴백으로 떨어졌고, 9월의 M열은 「회수신청」이라
 *   「자동회수」 같은 글자를 금액으로 읽었다. 업체 화면의 「반품비 합계」가
 *   0원이던 것이 이것이다.
 *
 * ★ 머리글은 앞으로도 바뀐다 ★
 *   사람이 쓰는 시트다. 그러니 「지금 맞다」가 아니라 **달마다 다른 머리글을
 *   다 넣어 두고** 돌린다. 다음에 누가 또 바꾸면 여기가 먼저 운다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/* prpLedger.gs 에서 매핑 함수만 떼어 온다. GAS 파일이라 require 가 안 된다. */
function loadMapper() {
  const src = fs.readFileSync(path.join(__dirname, "prpLedger.gs"), "utf8");
  const from = src.indexOf("function prpMapCols_");
  assert.ok(from >= 0, "prpMapCols_ 를 못 찾았습니다");
  const end = src.indexOf("\n}", src.indexOf("return col;", from));
  assert.ok(end > from, "prpMapCols_ 의 끝을 못 찾았습니다");
  const fn = { prpMapCols_: null };
  new Function("out", src.slice(from, end + 2) + "\nout.prpMapCols_ = prpMapCols_;")(fn);
  return fn.prpMapCols_;
}
const prpMapCols_ = loadMapper();

const split = (s) => s.split("|");

/** 2026-09-09 실측 — D열이 「주문지」, H열에 반품송장번호가 끼어 있다 */
const H202609 = split(
  "|반품접수날짜|접수자|주문지|반품신청자/수취인명|연락처|추가연락처|반품송장번호|" +
  "상품명|수량|원송장번호|재출고/단순/오주문입력/오배송|회수신청|반품/환불비용|" +
  "이카운트 반영|비고 및추가처리사항|||||반품송장번호"
);

/** 8월 — 예전 모양 */
const H202608 = split(
  "|반품접수날짜|접수자|업체명|반품신청자/수취인명|연락처|추가연락처|상품명|수량|" +
  "원송장번호|교환/반품|고객오주문/오배송|선출고/입고검수후출고|처리상태|" +
  "비고 및추가처리사항|이카운트 반영|반품송장번호"
);

test("★ 9월 「주문지」를 업체 열로 읽는다 ★ — 접수를 막던 그것", () => {
  const c = prpMapCols_(H202609);
  assert.equal(c.vendor, 3, "col.vendor 가 -1 이면 협력업체가 접수를 못 한다");
  assert.equal(H202609[c.vendor], "주문지");
});

test("8월 「업체명」도 그대로 읽는다 — 옛 탭을 깨지 않는다", () => {
  const c = prpMapCols_(H202608);
  assert.equal(c.vendor, 3);
  assert.equal(H202608[c.vendor], "업체명");
});

test("★ 9월에 한 칸 밀린 열들이 제자리를 찾는다 ★", () => {
  const c = prpMapCols_(H202609);
  assert.equal(H202609[c.item], "상품명");
  assert.equal(H202609[c.qty], "수량");
  assert.equal(H202609[c.invoice], "원송장번호");
  //  H열에 새로 끼어든 반품송장번호를 원송장으로 잘못 잡으면 안 된다
  assert.notEqual(c.invoice, 7);
});

test("★ 9월 반품비는 「반품/환불비용」이다 ★ — M열 폴백이 회수신청을 읽던 것", () => {
  const c = prpMapCols_(H202609);
  assert.equal(H202609[c.fee], "반품/환불비용");
  assert.notEqual(c.fee, 12, "12번은 「회수신청」이다 — 금액이 아니다");
});

test("옛 탭은 M열 폴백을 그대로 쓴다 — 거기엔 실제로 반품비가 적혀 있다", () => {
  const c = prpMapCols_(H202608);
  //  머리글이 「선출고/입고검수후출고」라 이름으로는 못 찾는다. 그래도 M(12)이다.
  assert.equal(c.fee, 12);
});

test("머리글이 아예 비어도 M열로 떨어진다 — 옛 자료가 죽지 않게", () => {
  const c = prpMapCols_(["", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  assert.equal(c.fee, 12);
});

test("반품송장번호를 원송장으로 잡지 않는다", () => {
  const c = prpMapCols_(H202609);
  assert.ok(c.returnInvoice >= 0);
  assert.equal(H202609[c.returnInvoice], "반품송장번호");
  assert.notEqual(c.returnInvoice, c.invoice);
});

test("A열은 늘 처리상태다 — 머리글이 뭐든 자리로 못 박는다", () => {
  assert.equal(prpMapCols_(H202609).status, 0);
  assert.equal(prpMapCols_(H202608).status, 0);
});
