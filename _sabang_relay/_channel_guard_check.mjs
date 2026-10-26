/**
 *  CHANNEL_GUARD 가 정말 우는가 — 깨 보고 나서 믿는다           (2026-10-27)
 *
 *    node _sabang_relay/_channel_guard_check.mjs
 *
 *  ★ 이 길로 나간 글은 손님이 상세페이지에서 읽는다 ★
 *    `productDetailDescription` 은 그 몰의 상세페이지를 통째로 덮는다.
 *    사방넷은 되돌려 주지 않는다. 그래서 막아야 할 것을 실제로 던져 본다.
 *
 *  ★ 2026-10-27 저녁 — 칸을 열다섯으로 넓혔다 ★
 *    「막혀야 한다」만 보면 모자란다. 넓힌 칸이 **정말 지나가는지**도 봐야
 *    「열었다고 적어 놓고 실은 막혀 있는」 것을 못 본 채 넘어가지 않는다.
 *    그래서 깨보기(막혀야 함)와 지나보기(통과해야 함)를 둘 다 돌린다.
 *
 *  ★ 모든 시험이 없는 품목코드를 쓴다 ★
 *    가드는 통과하고 사방넷이 «그런 상품 없다»로 건별 실패를 돌려준다.
 *    길이 끝까지 뚫렸는지만 보고, 진짜 상세페이지는 한 글자도 안 바뀐다.
 *
 *  ★ HTTP 로 성패를 가르지 말 것 ★ 전부 실패하면 사방넷은 400 을 준다 — results 로 본다.
 */
import { readFileSync } from "node:fs";
const token = readFileSync("D:/Pack2U_상품정보sheet/_sabang_relay/sabang_config.php", "utf8")
  .match(/'token'\s*=>\s*'([^']+)'/)?.[1] ?? "";
const URL_ = process.env.SABANG_RELAY_URL || "https://siot.com/pack2u/sabang/sabang.php";

async function 보내(몸통) {
  try {
    const r = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Proxy-Token": token },
      body: JSON.stringify({ method: "POST", path: "/v3/sb/channels-product", env: "PRODUCTION", body: 몸통 }),
    });
    return { build: r.headers.get("x-relay-build"), status: r.status, 글: (await r.text()).slice(0, 240) };
  } catch (e) { return { build: null, status: 0, 글: `못 불렀습니다 — ${e.message}` }; }
}

/*  ★ 없는 품목코드 ★ 이 값이 바뀌면 진짜 상세페이지가 덮인다. 건드리지 말 것. */
const 없는코드 = "ZZZ_GUARD_TEST_0000";
const 한줄 = (x = {}) => ({ shopCode: "shop0546", customProductCode: 없는코드, salePrice: 1000, ...x });

/* 깨기 전에 어느 판이 올라가 있는지 본다 — 길이 안 열린 옛 판이면 전부 RELAY_PATH_DENIED 다 */
const 판 = await 보내({ products: [한줄()] });
if (판.글.includes("RELAY_PATH_DENIED")) {
  console.error(`\n중계기가 아직 옛 판입니다 — 판 번호 ${판.build ?? "(못 읽음)"}`);
  console.error("  길이 안 열려 있어 울타리를 깨 볼 수가 없습니다 (샌 것이 «아닙니다»).");
  console.error("  올릴 것 — node _sabang_relay/_올리기_sftp.mjs --올려\n");
  process.exit(1);
}
console.log(`\n중계기 판 ${판.build ?? "(없음)"}`);

const 긴글 = "가".repeat(1_200_000);   // 2MB 를 넘기려는 글 (UTF-8 한 글자 3바이트)
const 인증한벌 = {
  productAuthorizationNumber: "CB-2026-TEST",
  authorizationNumberIssueDate: 20260101, authorizationDate: 20260101,
  authorizationExpiryDateFrom: 20260101, authorizationExpiryDateTo: 20261231,
  authorizationOrganizationName: "한국화학융합시험연구원", authorizationSphereName: "식품용기 적합",
};

const 깰것 = [
  ["products 가 없다",        { list: [한줄()] }],
  ["빈 배열",                 { products: [] }],
  ["몸통에 딴 칸",            { products: [한줄()], mode: "U" }],
  ["줄이 객체가 아니다",       { products: ["글자"] }],
  ["51건",                    { products: Array.from({ length: 51 }, () => 한줄()) }],
  ["shopCode 가 이상",        { products: [한줄({ shopCode: "쿠팡" })] }],
  ["품목코드가 비었다",        { products: [한줄({ customProductCode: "" })] }],
  ["가격이 0",                { products: [한줄({ salePrice: 0 })] }],
  ["가격이 음수",             { products: [한줄({ salePrice: -100 })] }],
  ["가격이 글자",             { products: [한줄({ salePrice: "만원" })] }],
  ["상세가 빈 글",            { products: [한줄({ productDetailDescription: "   " })] }],
  ["상품명이 빈 글",          { products: [한줄({ productName: "" })] }],
  ["글이 2MB 넘음",           { products: [한줄({ productDetailDescription: 긴글 })] }],
  /*  ── 여기부터 10/27 저녁에 넓힌 칸들 ── 넓힌 자리마다 울타리를 새로 둔다 */
  ["칸 이름 오타",            { products: [한줄({ productDetailDescriptoin: "<p>오타</p>" })] }],
  ["재고비율 101",            { products: [한줄({ shopMallStockRate: 101 })] }],
  ["재고비율 음수",           { products: [한줄({ shopMallStockRate: -1 })] }],
  ["재고비율이 글자",         { products: [한줄({ shopMallStockRate: "쉰" })] }],
  ["재고비율이 소수",         { products: [한줄({ shopMallStockRate: 12.5 })] }],
  ["배송정책에 한글",         { products: [한줄({ shopMallShippingPolicyId: "기본 배송" })] }],
  ["배송정책이 빈 글",        { products: [한줄({ shopMallShippingPolicyId: "" })] }],
  ["속성코드에 공백",         { products: [한줄({ productAttributeClassificationCode: "0 1" })] }],
  ["날짜가 2026-01-01",       { products: [한줄({ ...인증한벌, authorizationDate: "2026-01-01" })] }],
  ["없는 날 20260230",        { products: [한줄({ ...인증한벌, authorizationDate: 20260230 })] }],
  ["유효기간이 거꾸로",        { products: [한줄({ ...인증한벌, authorizationExpiryDateFrom: 20261231, authorizationExpiryDateTo: 20260101 })] }],
  ["번호 없이 발급일만",       { products: [한줄({ authorizationNumberIssueDate: 20260101 })] }],
  ["인증기관 이름 300자",      { products: [한줄({ productAuthorizationNumber: "CB1", authorizationOrganizationName: "가".repeat(300) })] }],
];

let 샌다 = 0;
console.log("\n── ① 깨 본다 (전부 막혀야 한다) ──");
for (const [이름, 몸통] of 깰것) {
  const r = await 보내(몸통);
  const 막힘 = r.글.includes("RELAY_CHANNEL_GUARD");
  /*  ★ 웹서버가 PHP «앞에서» 끊는 경우가 있다 ★  (2026-10-27)
      2MB 가 넘는 몸통은 호스팅이 502 HTML 을 주고 PHP 까지 가지 않는다 —
      내 가드가 못 본다. 사방넷에 안 닿는 것은 같지만 «다른 울타리»다.
      그걸 「샌다」로 세면 멀쩡한 가드를 고치러 가고, 「막힘」으로 세면
      가드가 본 줄 착각한다. 그래서 따로 적는다. 진짜 자리는 v2 쪽 미리 막기다. */
  const 웹서버가끊음 = !막힘 && (r.status === 502 || r.status === 413) && !r.글.trim().startsWith("{");
  if (!막힘 && !웹서버가끊음) 샌다++;
  const 표 = 막힘 ? "막힘 OK" : 웹서버가끊음 ? "웹서버가 끊음 ~" : "** 샌다 **";
  console.log(`  ${표.padEnd(14)} ${이름.padEnd(20)} HTTP ${r.status}  ${r.글.replace(/\s+/g, " ").slice(0, 86)}`);
}

/*  ── ② 지나야 할 것 ── 넓힌 칸이 «정말» 지나가는지.
    막기만 보고 끝내면, 열었다고 적어 놓고 실은 막혀 있는 것을 못 본다. */
const 지날것 = [
  ["가격만",                  { products: [한줄()] }],
  ["상세만",                  { products: [{ shopCode: "shop0546", customProductCode: 없는코드, productDetailDescription: "<p>울타리 시험</p>" }] }],
  ["재고비율 50",             { products: [한줄({ shopMallStockRate: 50 })] }],
  ["재고비율 0",              { products: [한줄({ shopMallStockRate: 0 })] }],
  ["배송정책 아이디",          { products: [한줄({ shopMallShippingPolicyId: "B0000001" })] }],
  ["속성분류코드",            { products: [한줄({ productAttributeClassificationCode: "001" })] }],
  ["인증 한 벌",              { products: [한줄(인증한벌)] }],
  ["열다섯 칸 전부",           { products: [한줄({ productName: "시험 상품명", productDetailDescription: "<p>시험</p>",
                                                  shopMallStockRate: 30, shopMallShippingPolicyId: "B0000001",
                                                  productAttributeClassificationCode: "001", ...인증한벌 })] }],
];

let 막혔다 = 0;
console.log("\n── ② 지나야 한다 (없는 품목코드라 사방넷이 건별로 거절한다 — 아무것도 안 바뀐다) ──");
for (const [이름, 몸통] of 지날것) {
  const r = await 보내(몸통);
  const 가드가막음 = r.글.includes("RELAY_");
  /*  사방넷까지 닿았다는 표 — 건별 결과(results)나 건별 오류글이 온다 */
  const 닿음 = !가드가막음 && /results|errorMessage|상품정보/.test(r.글);
  if (!닿음) 막혔다++;
  const 표 = 닿음 ? "지나감 OK" : 가드가막음 ? "** 가드가 막음 **" : "** 못 닿음 **";
  console.log(`  ${표.padEnd(18)} ${이름.padEnd(16)} HTTP ${r.status}  ${r.글.replace(/\s+/g, " ").slice(0, 86)}`);
}

console.log("\n── 판정 ──");
if (샌다) console.log(`  ** ${샌다}가지가 샙니다 — 울타리가 제대로 안 올라갔습니다.`);
if (막혔다) console.log(`  ** ${막혔다}가지가 못 지나갑니다 — 열었다고 적어 둔 칸이 실은 막혀 있습니다.`);
if (!샌다 && !막혔다) console.log(`  OK  막을 것 ${깰것.length}가지를 막고, 열어 둔 ${지날것.length}가지가 사방넷까지 닿습니다.`);
console.log("");
