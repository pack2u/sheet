/**
 *  잘못 만들어진 시험 상품에 「지워 주세요」라고 적어 둔다            (2026-10-27)
 *
 *    node _sabang_relay/_시험상품_표시남기기.mjs
 *
 *  ★ 왜 이 파일이 있나 ★
 *    등록 규격을 알아보려고 분류코드를 없는 값(Z99)으로 넣어 보냈다.
 *    「사방넷이 거절할 것」이라고 짐작했는데 **사방넷은 분류를 검사하지 않고 만들어 버렸다.**
 *    ZZZ_GUARD_TEST_0000 (품번 106718) 이 그렇게 생겼다.
 *
 *    지우는 API 가 없다(17종에 삭제가 없다). 그래서 할 수 있는 것은 셋뿐이다 —
 *      ① 완전품절로 둔다(이미 그렇다)  ② 어느 몰에도 안 걸려 있다  ③ 이름에 적어 둔다.
 *    마지막을 여기서 한다. 지우는 것은 사방넷 화면에서 사람이 해야 한다.
 */
import { readFileSync } from "node:fs";
const token = readFileSync("D:/Pack2U_상품정보sheet/_sabang_relay/sabang_config.php", "utf8")
  .match(/'token'\s*=>\s*'([^']+)'/)?.[1] ?? "";

const 몸 = {
  productName: "[지워 주세요] v2 등록규격 시험 20261027 · 판매 안 함",
  customProductCode: "ZZZ_GUARD_TEST_0000",
  productDivisionCode: "PURCHASE",
  myCategoryCodeL: "Z99", myCategoryCodeM: "Z99", myCategoryCodeS: "Z99",
  manufacturerName: "주식회사 팩투유", originName: "031", productTargetCode: "NO_DATA",
  productSupplyStatusCode: "OUT_OF_STOCK",
  deliveryCostCode: "FREE", taxCode: "TAXABLE",
  costPrice: 1, sellingPrice: 1000, consumerPrice: 1000,
  productDetailDescription: "<p>v2 가 사방넷 등록 규격을 알아보려고 만든 시험 상품입니다. 지워 주세요. (2026-10-27)</p>",
};

const r = await fetch("https://siot.com/pack2u/sabang/sabang.php", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Proxy-Token": token },
  body: JSON.stringify({ method: "POST", path: "/v3/sb/product/upsert", env: "PRODUCTION", body: { products: [몸] } }),
});
const j = await r.json();
const x = (j.data ?? {}).results?.[0];
console.log(x?.status ? `적었습니다 — mode ${x.mode} · 품번 ${x.productCode}` : `못 적었습니다 — ${x?.errorMessage ?? JSON.stringify(j).slice(0, 200)}`);
