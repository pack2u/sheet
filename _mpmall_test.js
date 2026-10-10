/**
 * ══════════════════════════════════════════════════════════════
 *  몰 찾기 — 베낀 꼬리 파서가 «원본과 같은 답»을 내는가
 *  파일: _mpmall_test.js
 *  2026-10-10
 *
 *    node --test _mpmall_test.js
 *
 *  ★ 왜 있나 ★
 *    품목명 꼬리에서 몰을 읽는 규칙의 원본은 CS웹앱 home.html 의
 *    ledgerVendorFromItem 이다. mallPolicy.gs 는 허브 프로젝트라 그 함수를
 *    부를 수 없어 _mp_mallFromItem_ 으로 «베꼈다».
 *
 *    베낀 것을 숨기면 한쪽만 고쳐지고, 그러면 같은 품목명이 CS 화면에서는
 *    「배민상회」, 몰 찾기에서는 「합포장」이 된다. 몰 목록이 틀리면 거기에
 *    요율을 매기고 가격이 나간다 — 돈으로 번진다.
 *
 *    그래서 두 구현을 «실제로 떼어 와» 같은 입력으로 나란히 돌린다
 *    (csReturnFee.gs / _csreturnfee_test.js 와 같은 손버릇).
 *
 *  ★ 고유ID 판정은 베끼지 않았다 ★
 *    mallPolicy.gs 는 허브의 _po_isGeneratedUid_ 를 그대로 부른다.
 *    같은 프로젝트라 베낄 이유가 없다. 여기서는 그 함수가 세 모양을
 *    모두 알아보는지만 한 번 더 못 박는다 (_pouid_test.js 와 겹치지만,
 *    몰 찾기가 그 판정에 기대고 있다는 사실을 여기에도 남긴다).
 * ══════════════════════════════════════════════════════════════
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** 소스에서 함수 하나를 중괄호 짝을 세어 떼어 온다 */
function 꺼내(src, 이름) {
  const i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error("함수를 못 찾았습니다: " + 이름);
  const j = src.indexOf("{", i);
  let 깊이 = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") {
      깊이--;
      if (깊이 === 0) return src.slice(i, k + 1);
    }
  }
  throw new Error("중괄호가 안 닫혔습니다: " + 이름);
}

function 뽑아(선언들, 이름) {
  const ctx = { String, Math, RegExp };
  vm.createContext(ctx);
  vm.runInContext(선언들.join("\n"), ctx);
  return vm.runInContext(이름, ctx);
}

const 허브 = fs.readFileSync(path.join(__dirname, "mallPolicy.gs"), "utf8");
const CS = fs.readFileSync(path.join(__dirname, "CS_WebApp", "home.html"), "utf8");

/* 원본 — home.html */
const 원본표지 = (CS.match(/var LEDGER_PACK_MARKS = \[[^\]]*\];/) || [])[0];
assert.ok(원본표지, "home.html 에서 LEDGER_PACK_MARKS 를 못 찾았습니다");
const 원본 = 뽑아([원본표지, 꺼내(CS, "ledgerVendorFromItem")], "ledgerVendorFromItem");

/* 베낀 것 — mallPolicy.gs */
const 베낀표지 = (허브.match(/var _MP_PACK_MARKS_ = \[[^\]]*\];/) || [])[0];
assert.ok(베낀표지, "mallPolicy.gs 에서 _MP_PACK_MARKS_ 를 못 찾았습니다");
const 베낀것 = 뽑아([베낀표지, 꺼내(허브, "_mp_mallFromItem_")], "_mp_mallFromItem_");

/* 허브의 UID 판정 — 베끼지 않고 그대로 쓰는 것 */
const 주문 = fs.readFileSync(path.join(__dirname, "_partnerOrders.gs"), "utf8");
const 발급된것인가 = 뽑아([꺼내(주문, "_po_isGeneratedUid_")], "_po_isGeneratedUid_");
const 몰아님 = 뽑아([베낀표지, 꺼내(허브, "_mp_notAMall_")], "_mp_notAMall_");
const 바닥 = 뽑아([꺼내(허브, "_mp_baseUid_")], "_mp_baseUid_");

/* ── 실제로 본 품목명들 ──────────────────────────────────
   _csledgervendor_test.js · _csorigin_test.js 에 적혀 있는 실제 줄들이다.
   지어낸 입력으로 견주면 지어낸 것만 같아진다.                        */
const 입력들 = [
  "NK 알루미늄 원형용기 DS 95 200개---법인/쿠팡",
  "IW 92파이 PET 중평리드 1000개---법인/스마트스토어",
  "JH 샐러드 202 투명 100세트---배민상회",
  "물티슈 100매---합포장---법인/쿠팡",
  "물티슈 100매---법인/쿠팡---합포장",
  "물티슈 100매===합배송---법인/쿠팡",
  "물티슈 100매---합포장",
  "물티슈 100매",
  "BF 225파이 감자탕 대/중/소 블랙---소분---법인/11번가",
  "뚜껑 단품---뚜껑만---법인/지마켓",
  "몸통 단품---몸통만",
  "컵 50개===법인/배민",
  "용기---대리발송-당장드림/탁기선",
  "",
  "---",
  "===법인/쿠팡",
  "접시 10개---   법인/옥션   ",
  "포크---합배송===소분---법인/티몬",
  //  2026-10-10 사장님이 알려주신 실제 꼬리
  "원형용기 500개---법인/자사몰",
  "뚜껑 300개---법인/ 쿠팡",
];

test("베낀 꼬리 파서가 원본과 «같은 답»을 낸다", () => {
  for (const s of 입력들) {
    assert.equal(
      베낀것(s), 원본(s),
      "어긋남 — 입력 " + JSON.stringify(s) +
      "\n  mallPolicy.gs : " + JSON.stringify(베낀것(s)) +
      "\n  home.html     : " + JSON.stringify(원본(s))
    );
  }
});

test("포장 표지 목록이 두 곳에서 같다", () => {
  const 떼기 = (s) => (s.match(/'[^']*'|"[^"]*"/g) || []).map((t) => t.slice(1, -1)).sort();
  assert.deepEqual(떼기(베낀표지), 떼기(원본표지),
    "포장 표지가 갈라졌습니다 — 한쪽만 고친 것입니다");
});

/* ── 몰이 아닌 것을 몰로 세지 않는다 ───────────────────── */
test("대리발송·포장표지·빈칸은 몰이 아니다", () => {
  assert.equal(몰아님("대리발송-당장드림/탁기선"), true);
  assert.equal(몰아님("대리발송-리바이"), true);
  assert.equal(몰아님("합포장"), true);
  assert.equal(몰아님("합배송"), true);
  assert.equal(몰아님("소분"), true);
  assert.equal(몰아님("뚜껑만"), true);
  assert.equal(몰아님("몸통만"), true);
  assert.equal(몰아님(""), true);
  assert.equal(몰아님("   "), true);
  assert.equal(몰아님(null), true);

  assert.equal(몰아님("법인/쿠팡"), false);
  assert.equal(몰아님("배민상회"), false);
  assert.equal(몰아님("법인/스마트스토어"), false);
});

/* ── 거래처명은 「법인/」일 때만 거든다 ─────────────────
   ★ 원장의 거래처명 칸에는 주문자 이름이 들어 있다 (2026-10-10 실측).
     아무 값이나 받으면 몰 목록이 사람 이름으로 찬다 — 실제로 그랬다.   */
const 거래처몰 = 뽑아(
  [베낀표지, 꺼내(허브, "_mp_notAMall_"), 꺼내(허브, "_mp_mallFromVendor_")],
  "_mp_mallFromVendor_");

test("★ 주문자 이름을 몰로 세지 않는다", () => {
  //  원장 거래처명에 실제로 들어오는 것 — 사람 이름
  for (const 이름 of ["김미화", "홍길동", "박영수", "이정희 ", "최 민수"]) {
    assert.equal(거래처몰(이름), "",
      "사람 이름이 몰로 새어 나왔습니다: " + JSON.stringify(이름));
  }
  //  업체·기타
  assert.equal(거래처몰("대리발송-당장드림/탁기선"), "");
  assert.equal(거래처몰("합포장"), "");
  assert.equal(거래처몰(""), "");
  assert.equal(거래처몰(null), "");
});

test("거래처명이 「법인/」이면 거든다", () => {
  assert.equal(거래처몰("법인/쿠팡"), "법인/쿠팡");
  assert.equal(거래처몰("법인/자사몰"), "법인/자사몰");
  assert.equal(거래처몰("  법인/스마트스토어  "), "법인/스마트스토어");

  //  「법인/」이 가운데 있으면 안 받는다 — 이름 뒤에 붙어 온 것일 수 있다
  assert.equal(거래처몰("김미화 법인/쿠팡"), "");
  //  「법인/」 없는 몰은 이 길로 안 들어온다 — 사람 이름과 가를 수 없다
  assert.equal(거래처몰("배민상회"), "");
});

/* ── 고유ID 로 전화주문·대리판매를 가른다 ──────────────── */
test("전화주문·대리판매 고유ID 세 모양을 모두 알아본다", () => {
  //  2026-09-22 부터
  assert.equal(발급된것인가("p0921000001"), true, "전화주문 p…");
  assert.equal(발급된것인가("d0930000044"), true, "대리판매 d…");
  //  그 전
  assert.equal(발급된것인가("0921-PH-a3f19"), true, "전화주문 MMdd-PH-");
  assert.equal(발급된것인가("0901-ds-4581"), true, "대리판매 MMdd-ds-");
  //  2026-09-09 이전 — 6자리. 4자리만 보면 여기서 새어 나간다
  assert.equal(발급된것인가("260902-PH-a3f19"), true, "옛 YYMMDD-PH-");

  //  사방넷 주문번호는 숫자뿐이다 — 걸리면 안 된다
  assert.equal(발급된것인가("2165247640"), false, "사방넷 주문번호");
  assert.equal(발급된것인가("2157237902"), false, "사방넷 주문번호");
});

test("「이름/고유ID#2」로 붙어 와도 고유ID 를 떼어낸다", () => {
  assert.equal(바닥("김미화/p0921000001"), "p0921000001");
  assert.equal(바닥("홍길동/d0930000044"), "d0930000044");
  assert.equal(바닥("김미화/2157237902#2"), "2157237902");
  assert.equal(바닥("2165247640"), "2165247640");
  assert.equal(바닥("  2165247640  "), "2165247640");

  //  떼어낸 뒤에야 판정이 맞는다 — 안 떼면 전화주문이 사방넷으로 센다
  assert.equal(발급된것인가(바닥("김미화/p0921000001")), true);
  assert.equal(발급된것인가(바닥("김미화/2157237902#2")), false);
});
