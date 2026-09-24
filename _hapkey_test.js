/**
 * 합배송 전용 탭 → 이름+전화 키 만들기
 * ★ 2026-09-09
 *
 *   node --test _hapkey_test.js
 *
 * ★ 왜 있나 ★
 *   허브 송장수집이 합포장을 못 붙이고 있었다 — 적요에 「합포장」도,
 *   같은 송장도 안 적혔다. 원인은 키를 만드는 열이었다.
 *
 *   합배송 전용 탭의 열 순서는 「받는분 | 전화 | 모바일」인데,
 *   실측(2026-09-09, 23줄) 결과 **전화는 전부 비어 있고 번호는 모바일에**
 *   있었다. 옛 코드는 먼저 잡히는 한 열(전화)만 봐서 키가 「이름_」만
 *   만들어졌고, 허브 행과 하나도 안 맞았다.
 *
 * ★ 열 순서와 채움은 앞으로도 바뀐다 ★
 *   사람이 쓰는 시트다. 그러니 「지금 맞다」가 아니라 **번호가 어느 칸에
 *   있든** 잡히는지를 시험한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/* _partnerOrders.gs 에서 키 수집 블록만 떼어 쓸 수는 없다(함수가 아니다).
   대신 같은 규칙을 여기 옮겨 놓고, 원본이 바뀌면 이 시험이 먼저 깨지도록
   원본 문구를 함께 확인한다. */
const SRC = fs.readFileSync(path.join(__dirname, "_partnerOrders.gs"), "utf8");
const HELPERS = fs.readFileSync(path.join(__dirname, "_partnerHelpers.gs"), "utf8");

/** 원본에서 normalizeHubRecipientPhoneKey_ 를 그대로 가져온다 */
function loadKeyFn() {
  const at = HELPERS.indexOf("function normalizeHubRecipientPhoneKey_");
  assert.ok(at >= 0, "normalizeHubRecipientPhoneKey_ 를 못 찾았습니다");
  const end = HELPERS.indexOf("\n}", at);
  const box = {};
  new Function("out", HELPERS.slice(at, end + 2) + "\nout.f = normalizeHubRecipientPhoneKey_;")(box);
  return box.f;
}
const keyOf = loadKeyFn();

/** 고친 규칙 — 번호처럼 생긴 열을 다 읽고, 줄마다 있는 번호마다 키를 만든다 */
function collectKeys(headers, rows) {
  let nameIdx = -1;
  const phoneIdxs = [];
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).replace(/\s/g, "");
    if (nameIdx === -1 && h.match(/이름|고객명|수취인|수령인|받는분|받는사람|수하인/)) nameIdx = i;
    if (/보내는|발송|송하인|출고지/.test(h)) continue;
    if (h.match(/연락처|전화번호|모바일|핸드폰|휴대폰|수하인전화|받는전화|전화/)) phoneIdxs.push(i);
  }
  const set = {};
  if (nameIdx === -1 || !phoneIdxs.length) return set;
  for (const r of rows) {
    const name = String(r[nameIdx] || "").trim();
    if (!name) continue;
    for (const pi of phoneIdxs) {
      const ph = String(r[pi] || "").replace(/[^0-9]/g, "");
      if (ph.length < 4) continue;
      const k = keyOf(name, ph);
      if (k && k !== "_") set[k] = true;
    }
  }
  return set;
}

/** 2026-09-09 실측 머리글 (합배송 전용 탭, 24열 중 앞 18) */
const HEADER = [
  "상태", "출고지", "순번", "코드", "일자-No.", "품목명", "판매수량",
  "받는분", "전화", "모바일", "주소1", "배송메시지", "합계금액",
  "보내는분", "보내는분전화", "보내는주소(팩투유)", "사방넷주문번호", "적요",
];
const row = (받는분, 전화, 모바일) => {
  const r = new Array(18).fill("");
  r[7] = 받는분; r[8] = 전화; r[9] = 모바일;
  r[13] = "팩투유"; r[14] = "031-923-7795";   // 보내는분 — 키에 섞이면 안 된다
  return r;
};

test("★ 전화가 비고 모바일에만 번호가 있어도 잡는다 ★ — 실제로 그랬다", () => {
  const keys = collectKeys(HEADER, [row("양기석", "", "010-3974-2216")]);
  assert.ok(keys["양기석_2216"], "모바일로 키가 만들어져야 한다");
});

test("전화에만 있어도 잡는다 — 예전 모양", () => {
  const keys = collectKeys(HEADER, [row("김은희", "010-3232-0835", "")]);
  assert.ok(keys["김은희_0835"]);
});

test("둘 다 있으면 둘 다 만든다 — 허브가 어느 쪽을 갖고 있든 맞는다", () => {
  const keys = collectKeys(HEADER, [row("홍정원", "02-111-2222", "0502-4662-1063")]);
  assert.ok(keys["홍정원_2222"]);
  assert.ok(keys["홍정원_1063"]);
});

test("★ 보내는분 전화는 안 섞는다 ★ — 우리 번호로 남의 주문이 묶인다", () => {
  const keys = collectKeys(HEADER, [row("양기석", "", "010-3974-2216")]);
  assert.ok(!keys["양기석_7795"], "031-923-7795 는 팩투유 번호다");
  assert.equal(Object.keys(keys).length, 1);
});

test("★ 번호가 아예 없으면 키를 안 만든다 ★ — 동명이인이 묶인다", () => {
  const keys = collectKeys(HEADER, [row("정우희", "", "")]);
  assert.equal(Object.keys(keys).length, 0);
});

test("이름이 비면 건너뛴다", () => {
  const keys = collectKeys(HEADER, [row("", "", "010-1111-2222")]);
  assert.equal(Object.keys(keys).length, 0);
});

test("★ 2026-09-09 실측 23줄이 전부 키가 된다 ★", () => {
  //  받는분 23/23 · 전화 0/23 · 모바일 23/23 이었다
  const rows = [];
  for (let i = 0; i < 23; i++) {
    rows.push(row("고객" + i, "", "010-0000-" + String(1000 + i)));
  }
  const keys = collectKeys(HEADER, rows);
  assert.equal(Object.keys(keys).length, 23, "옛 규칙으로는 0개였다");
});

test("★ 원본이 한 열만 보는 옛 규칙으로 돌아가지 않았는지 ★", () => {
  //  _csPhoneIdx 하나만 쓰던 시절의 자취가 남아 있으면 알린다
  assert.ok(
    SRC.indexOf("_csPhoneIdxs") !== -1,
    "_partnerOrders.gs 가 다시 한 열만 보고 있다 — 합포장이 조용히 안 붙는다"
  );
  assert.ok(
    SRC.indexOf("var _csPhoneIdx = -1") === -1,
    "옛 한 열짜리 변수가 남아 있다"
  );
});
