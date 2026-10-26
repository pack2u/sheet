/**
 *  CHANNEL_GUARD 가 정말 우는가 — 깨 보고 나서 믿는다           (2026-10-27)
 *
 *    node _sabang_relay/_channel_guard_check.mjs
 *
 *  ★ 이 길로 나간 글은 손님이 상세페이지에서 읽는다 ★
 *    `productDetailDescription` 은 그 몰의 상세페이지를 통째로 덮는다.
 *    사방넷은 되돌려 주지 않는다. 그래서 막아야 할 것을 실제로 던져 본다.
 *
 *  ★ 마지막 「바른 몸통」도 아무것도 안 바꾼다 ★
 *    없는 품목코드를 넣는다. 가드는 통과하고 사방넷이 «그런 상품 없다»로 건별 실패를
 *    돌려준다. 길이 끝까지 뚫렸는지만 보고, 상세페이지는 한 글자도 안 바뀐다.
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
  console.error("  올릴 것 — node _sabang_relay/_올리기_sftp.mjs --올려  (판 20261027-channel-guard)\n");
  process.exit(1);
}
console.log(`\n중계기 판 ${판.build ?? "(없음)"}`);

const 긴글 = "가".repeat(1_200_000);   // 2MB 를 넘기려는 글 (UTF-8 한 글자 3바이트)

const 깰것 = [
  ["products 가 없다",       { list: [한줄()] },                                    "RELAY_CHANNEL_GUARD"],
  ["빈 배열",                { products: [] },                                      "RELAY_CHANNEL_GUARD"],
  ["몸통에 딴 칸",           { products: [한줄()], mode: "U" },                     "RELAY_CHANNEL_GUARD"],
  ["줄에 재고비율",          { products: [한줄({ shopMallStockRate: 50 })] },        "RELAY_CHANNEL_GUARD"],
  ["줄에 인증번호",          { products: [한줄({ productAuthorizationNumber: "CB1" })] }, "RELAY_CHANNEL_GUARD"],
  ["shopCode 가 이상",       { products: [한줄({ shopCode: "쿠팡" })] },             "RELAY_CHANNEL_GUARD"],
  ["품목코드가 비었다",       { products: [한줄({ customProductCode: "" })] },        "RELAY_CHANNEL_GUARD"],
  ["가격이 0",               { products: [한줄({ salePrice: 0 })] },                 "RELAY_CHANNEL_GUARD"],
  ["가격이 음수",            { products: [한줄({ salePrice: -100 })] },              "RELAY_CHANNEL_GUARD"],
  ["가격이 글자",            { products: [한줄({ salePrice: "만원" })] },            "RELAY_CHANNEL_GUARD"],
  ["상세가 빈 글",           { products: [한줄({ productDetailDescription: "   " })] }, "RELAY_CHANNEL_GUARD"],
  ["상품명이 빈 글",         { products: [한줄({ productName: "" })] },              "RELAY_CHANNEL_GUARD"],
  ["51건",                   { products: Array.from({ length: 51 }, () => 한줄()) }, "RELAY_CHANNEL_GUARD"],
  ["줄이 객체가 아니다",      { products: ["글자"] },                                "RELAY_CHANNEL_GUARD"],
  ["글이 2MB 넘음",          { products: [한줄({ productDetailDescription: 긴글 })] }, "RELAY_CHANNEL_GUARD"],
];

let 샌다 = 0;
console.log("\n── 깨 본다 (전부 막혀야 한다) ──");
for (const [이름, 몸통, 바라는] of 깰것) {
  const r = await 보내(몸통);
  const 막힘 = r.글.includes(바라는);
  /*  ★ 웹서버가 PHP «앞에서» 끊는 경우가 있다 ★  (2026-10-27)
      2MB 가 넘는 몸통은 호스팅이 502 HTML 을 주고 PHP 까지 가지 않는다 —
      내 가드가 못 본다. 사방넷에 안 닿는 것은 같지만 «다른 울타리»다.
      그걸 「샌다」로 세면 멀쩡한 가드를 고치러 가고, 「막힘 ✅」로 세면
      가드가 본 줄 착각한다. 그래서 따로 적는다. 진짜 자리는 v2 쪽 미리 막기다. */
  const 웹서버가끊음 = !막힘 && (r.status === 502 || r.status === 413) && !r.글.trim().startsWith("{");
  if (!막힘 && !웹서버가끊음) 샌다++;
  const 표 = 막힘 ? "막힘 ✅" : 웹서버가끊음 ? "웹서버가 끊음 ⚠" : "★ 샌다 ★";
  console.log(`  ${표.padEnd(14)} ${이름.padEnd(20)} HTTP ${r.status}  ${r.글.replace(/\s+/g, " ").slice(0, 80)}`);
}

console.log("\n── 바른 몸통 (없는 품목코드 — 상세페이지는 한 글자도 안 바뀐다) ──");
const ok = await 보내({ products: [한줄({ productDetailDescription: "<p>울타리 시험</p>" })] });
console.log(`  HTTP ${ok.status}  ${ok.글.slice(0, 220)}`);
const 닿음 = !ok.글.includes("RELAY_") && /results|errorMessage/.test(ok.글);

console.log("\n── 판정 ──");
if (샌다) console.log(`  ★ ${샌다}가지가 샙니다 — 울타리가 제대로 안 올라갔습니다.`);
else if (!닿음) console.log(`  막기는 다 막는데 바른 것이 사방넷까지 못 갔습니다 — ${ok.글.slice(0, 140)}`);
else console.log("  ✅ 열다섯 가지 다 막고, 바른 것만 사방넷까지 닿습니다.");
console.log("");
