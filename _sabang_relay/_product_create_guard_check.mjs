/**
 *  STOCK_GUARD 등록 갈래 — 깨 보고 나서 믿는다                 (2026-10-27)
 *
 *    node _sabang_relay/_product_create_guard_check.mjs
 *
 *  ★ product/upsert 는 상품을 통째로 덮어쓰는 API 다 ★
 *    그래서 두 갈래로만 연다 — 품절(두 칸·200건)과 등록(필수 16칸·한 건).
 *    두 갈래가 섞이지 않는지, 품절 갈래가 그대로인지를 같이 본다.
 *
 *  ★ 「지나야 한다」가 상품을 안 만드는 까닭 ★  (2026-10-27 에 똑바로 알았다)
 *    분류코드(Z99)가 틀려서가 **아니다.** 사방넷은 분류를 검사하지 않고 그냥 만든다 —
 *    그렇게 믿고 돌렸다가 시험 상품이 진짜로 생겼다(품번 106718).
 *    여기서 안 만들어지는 까닭은 **optionInfo 와 imageInfo 를 안 싣기 때문**이다.
 *    사방넷이 「[재고관리사용여부] 필수」로 먼저 거절한다.
 *    ★ 이 몸통에 optionInfo·imageInfo 를 넣지 말 것 ★ 넣는 순간 진짜로 만들어진다.
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
      body: JSON.stringify({ method: "POST", path: "/v3/sb/product/upsert", env: "PRODUCTION", body: 몸통 }),
    });
    return { build: r.headers.get("x-relay-build"), status: r.status, 글: (await r.text()).slice(0, 260) };
  } catch (e) { return { build: null, status: 0, 글: `못 불렀습니다 — ${e.message}` }; }
}

/*  ★ 없는 품목코드 ★ 바꾸지 말 것. 진짜 코드를 넣으면 그 상품이 덮인다. */
const 없는코드 = "ZZZ_GUARD_TEST_0000";

/*  필수 16칸 — 값은 실물에서 가져왔다(JCCR00002 를 읽어 본 것). 분류만 일부러 없는 값. */
const 등록한벌 = (x = {}) => ({
  productName: "울타리 시험 — 만들어지면 안 됩니다",
  customProductCode: 없는코드,
  productDivisionCode: "PURCHASE",
  myCategoryCodeL: "Z99", myCategoryCodeM: "Z99", myCategoryCodeS: "Z99",   // ★ 없는 분류
  manufacturerName: "주식회사 팩투유",
  originName: "031",
  productTargetCode: "NO_DATA",
  productSupplyStatusCode: "OUT_OF_STOCK",   // 혹시 만들어져도 팔리지 않게
  deliveryCostCode: "FREE",
  taxCode: "TAXABLE",
  costPrice: 1, sellingPrice: 1000, consumerPrice: 1000,
  productDetailDescription: "<p>울타리 시험</p>",
  ...x,
});
const 뺀것 = (k) => { const o = 등록한벌(); delete o[k]; return o; };

const 판 = await 보내({ products: [{ customProductCode: 없는코드, productSupplyStatusCode: "OUT_OF_STOCK" }] });
console.log(`\n중계기 판 ${판.build ?? "(없음)"}`);

const 깰것 = [
  /* ── 등록 갈래 ── */
  ["필수 칸 하나 빠짐",      { products: [뺀것("originName")] }],
  ["상세설명 빠짐",          { products: [뺀것("productDetailDescription")] }],
  ["분류 빠짐",              { products: [뺀것("myCategoryCodeM")] }],
  ["모르는 칸이 섞임",       { products: [등록한벌({ sellingPriceX: 1 })] }],
  ["optionInfo 가 섞임",     { products: [등록한벌({ optionInfo: { optionEditCode: "MODIFIABLE" } })] }],
  ["등록을 두 건",           { products: [등록한벌(), 등록한벌()] }],
  ["분류 모양이 이상",       { products: [등록한벌({ myCategoryCodeL: "포장용기" })] }],
  ["상품구분이 딴 값",       { products: [등록한벌({ productDivisionCode: "RENTAL" })] }],
  ["상태가 딴 값",           { products: [등록한벌({ productSupplyStatusCode: "PAUSE" })] }],
  ["필수 칸이 빈 글",        { products: [등록한벌({ manufacturerName: "   " })] }],
  ["값이 돈이 아님",         { products: [등록한벌({ sellingPrice: "만원" })] }],
  ["상품명 300자",           { products: [등록한벌({ productName: "가".repeat(300) })] }],
  ["등록과 품절을 섞음",     { products: [등록한벌(), { customProductCode: 없는코드, productSupplyStatusCode: "IN_SUPPLY" }] }],
  /* ── 품절 갈래가 그대로인지 ── */
  ["품절 갈래에 딴 칸",      { products: [{ customProductCode: 없는코드, productSupplyStatusCode: "IN_SUPPLY", sellingPrice: 100 }] }],
  ["품절 갈래 상태 틀림",    { products: [{ customProductCode: 없는코드, productSupplyStatusCode: "PAUSE" }] }],
  ["몸통에 딴 칸",           { products: [등록한벌()], mode: "I" }],
];

let 샌다 = 0;
console.log("\n── ① 깨 본다 (전부 막혀야 한다) ──");
for (const [이름, 몸통] of 깰것) {
  const r = await 보내(몸통);
  const 막힘 = r.글.includes("RELAY_STOCK_GUARD");
  if (!막힘) 샌다++;
  console.log(`  ${(막힘 ? "막힘 OK" : "** 샌다 **").padEnd(12)} ${이름.padEnd(18)} HTTP ${r.status}  ${r.글.replace(/\s+/g, " ").slice(0, 92)}`);
}

console.log("\n── ② 지나야 한다 ──");
const 품절 = await 보내({ products: [{ customProductCode: 없는코드, productSupplyStatusCode: "OUT_OF_STOCK" }] });
const 품절닿음 = !품절.글.includes("RELAY_") && /results|errorMessage|상품정보/.test(품절.글);
console.log(`  ${(품절닿음 ? "지나감 OK" : "** 막힘 **").padEnd(12)} 품절 갈래        HTTP ${품절.status}  ${품절.글.replace(/\s+/g, " ").slice(0, 92)}`);

/*  ★ 보내기 «전에» 그 코드가 사방넷에 있는지 본다 ★
    있으면 등록(I)이 아니라 수정(U)이 되어 그 상품을 덮는다 — 그건 시험이 아니라 사고다. */
const 본 = await fetch(URL_, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Proxy-Token": token },
  body: JSON.stringify({ method: "GET", path: "/v3/sb/product?customProductCode=" + 없는코드, env: "PRODUCTION" }),
}).then((r) => r.text());
const 만들어짐 = !/유효하지 않은/.test(본) && /"productName"/.test(본);

let 등록닿음 = false, 가드가막음 = false;
if (만들어짐) {
  console.log(`  건너뜀        등록 갈래        ${없는코드} 가 이미 사방넷에 있습니다 — 보내면 수정(U)이 되어 덮습니다.`);
  등록닿음 = true;   // 길이 뚫린 것은 이미 봤다. 다시 두드려 봐야 덮기만 한다.
} else {
  const 등록 = await 보내({ products: [등록한벌()] });
  가드가막음 = 등록.글.includes("RELAY_");
  등록닿음 = !가드가막음 && /results|errorMessage|successCount/.test(등록.글);
  console.log(`  ${(등록닿음 ? "지나감 OK" : 가드가막음 ? "** 가드가 막음 **" : "** 못 닿음 **").padEnd(12)} 등록 갈래        HTTP ${등록.status}  ${등록.글.replace(/\s+/g, " ").slice(0, 160)}`);
}

console.log("\n── 판정 ──");
if (샌다) console.log(`  ** ${샌다}가지가 샙니다 — 울타리가 제대로 안 올라갔습니다.`);
if (!품절닿음) console.log("  ** 품절 갈래가 막혔습니다 — 매일 쓰는 길입니다. 먼저 고칠 것.");
if (!등록닿음) console.log("  ** 등록 갈래가 사방넷까지 못 갑니다.");
if (만들어짐) {
  console.log(`  ★★ 시험 상품이 «실제로 만들어졌습니다» (${없는코드}) ★★`);
  console.log("     사방넷은 없는 분류여도 상품을 만듭니다 — 사방넷 화면에서 지워야 합니다.");
} else {
  console.log("  OK  시험 상품은 만들어지지 않았습니다 (사방넷이 거절).");
}
if (!샌다 && 품절닿음 && 등록닿음 && !만들어짐) console.log(`  OK  막을 것 ${깰것.length}가지를 막고, 두 갈래가 다 사방넷까지 닿습니다.`);
console.log("");
