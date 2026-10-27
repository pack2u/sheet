/**
 *  상품 등록이 운영계에서 «무엇을 더 달라고 하는지» 하나씩 받아 적는다   (2026-10-27)
 *
 *    node _sabang_relay/_product_create_probe.mjs
 *
 *  ★★ 이 도구는 상품을 «실제로 만든다» ★★  (2026-10-27 에 그렇게 당했다)
 *    분류코드를 없는 값(Z99)으로 두면 사방넷이 거절할 줄 알았다. **거절하지 않는다.**
 *    사방넷은 분류코드를 검사하지 않고 그대로 만들어 버린다 —
 *    ZZZ_GUARD_TEST_0000(품번 106718)이 그렇게 생겼고, 지우는 API 가 없어
 *    사장님이 사방넷 화면에서 지워야 했다. [[break-it-before-you-trust-the-test]]
 *
 *  ★ 그래서 ③ 걸음은 --진짜로만든다 를 붙여야 돈다 ★
 *    그리고 ZZZ_GUARD_TEST_0000 이 이미 있으므로, 이제 ①②도 «수정(U)»으로 성공한다 —
 *    「무엇이 모자란가」를 다시 알아보려면 **아직 없는 코드**를 새로 정해야 한다.
 *
 *  규격의 「필수 16칸」은 샌드박스에서 가려낸 것이라 운영계 «등록»에는 모자랐다.
 *  여기서 받아 적은 것이 진짜 목록이다 — 16칸 + optionInfo(재고관리사용여부) + imageInfo(대표이미지).
 */
import { readFileSync } from "node:fs";
const token = readFileSync("D:/Pack2U_상품정보sheet/_sabang_relay/sabang_config.php", "utf8")
  .match(/'token'\s*=>\s*'([^']+)'/)?.[1] ?? "";
const URL_ = "https://siot.com/pack2u/sabang/sabang.php";

async function 보내(몸) {
  const r = await fetch(URL_, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Proxy-Token": token },
    body: JSON.stringify({ method: "POST", path: "/v3/sb/product/upsert", env: "PRODUCTION", body: { products: [몸] } }),
  });
  const t = await r.text();
  try {
    const j = JSON.parse(t);
    if (String(j.code ?? "").startsWith("RELAY_")) return `중계기가 막음 — ${j.message}`;
    const x = (j.data ?? {}).results?.[0];
    return x ? (x.status ? "★ 만들어졌습니다 ★" : x.errorMessage) : t.slice(0, 200);
  } catch { return `글자가 아님 (HTTP ${r.status})`; }
}

const 바탕 = {
  productName: "울타리 시험 — 만들어지면 안 됩니다",
  customProductCode: "ZZZ_GUARD_TEST_0000",
  productDivisionCode: "PURCHASE",
  myCategoryCodeL: "Z99", myCategoryCodeM: "Z99", myCategoryCodeS: "Z99",   // ★ 없는 분류
  manufacturerName: "주식회사 팩투유", originName: "031", productTargetCode: "NO_DATA",
  productSupplyStatusCode: "OUT_OF_STOCK", deliveryCostCode: "FREE", taxCode: "TAXABLE",
  costPrice: 1, sellingPrice: 1000, consumerPrice: 1000,
  productDetailDescription: "<p>울타리 시험</p>",
};
const 옵션 = { stockUseYn: "N", optionEditCode: "RESET",
  options: [{ optionName: "단품", optionDetailName: "단품", stockQuantity: 999, safetyStockQuantity: 0 }] };
/*  남의 상품 사진 주소를 빌려 쓴다 — 어차피 만들어지지 않는다 */
const 사진 = [{ imageSrno: "1", imagePath: "https://pic.sabangnet.co.kr/product_image/mw57640/104/FAAVW_104088_1.jpg" }];

const 걸음 = [
  ["① 16칸만",                  { ...바탕 }],
  ["② + 옵션(재고관리)",        { ...바탕, optionInfo: 옵션 }],
  /*  ★ 여기부터는 상품이 «진짜로 만들어진다» ★ 사방넷은 분류가 없는 값이어도 만든다.
      그래서 평소에는 안 돈다 — 보려면 --진짜로만든다 를 붙인다. */
  ...(process.argv.includes("--진짜로만든다") ? [
    ["③ + 사진(대표) ★만듦★",   { ...바탕, optionInfo: 옵션, imageInfo: 사진 }],
  ] : []),
];

console.log("\n── 사방넷이 무엇을 더 달라고 하나 ──");
if (!process.argv.includes("--진짜로만든다")) {
  console.log("  (③ 사진까지 넣으면 상품이 «실제로» 만들어집니다 — --진짜로만든다 를 붙여야 돕니다)");
}
for (const [이름, 몸] of 걸음) {
  console.log(`  ${이름.padEnd(20)} → ${await 보내(몸)}`);
}
console.log("");
