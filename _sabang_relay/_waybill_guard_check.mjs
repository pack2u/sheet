/**
 *  WAYBILL_GUARD 가 정말 우는가 — 깨 보고 나서 믿는다            (2026-10-23)
 *
 *    node _sabang_relay/_waybill_guard_check.mjs
 *
 *  ★ 마지막 「바른 몸통」도 아무것도 안 쓴다 ★
 *    없는 주문번호(1)를 넣는다. 가드는 통과하고 사방넷이 «그 주문 없다»로
 *    건별 실패를 돌려준다. 길이 끝까지 뚫렸는지만 보고, 송장은 한 건도 안 붙는다.
 */
import { readFileSync } from "node:fs";
const token = readFileSync("D:/Pack2U_상품정보sheet/_sabang_relay/sabang_config.php", "utf8")
  .match(/'token'\s*=>\s*'([^']+)'/)?.[1] ?? "";
const URL_ = "https://siot.com/pack2u/sabang/sabang.php";

async function 보내(몸통) {
  const r = await fetch(URL_, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Proxy-Token": token },
    body: JSON.stringify({ method: "POST", path: "/v3/sb/waybill", env: "PRODUCTION", body: 몸통 }) });
  return { build: r.headers.get("x-relay-build"), status: r.status, 글: (await r.text()).slice(0, 230) };
}
const 한줄 = (x = {}) => ({ sbOrderNo: "1", deliveryCompanyCode: "007", wayBillNo: "45312252204", ...x });

const 깰것 = [
  ["딴 칸이 섞였다",        { waybillList: [한줄({ shopCode: "shop0055" })] }],
  ["forceUpdateYn 이 Y",    { waybillList: [한줄()], forceUpdateYn: "Y" }],
  ["송장에 하이픈",          { waybillList: [한줄({ wayBillNo: "4531-2252-204" })] }],
  ["송장이 너무 짧다",       { waybillList: [한줄({ wayBillNo: "12345" })] }],
  ["주문번호가 글자",        { waybillList: [한줄({ sbOrderNo: "ORD-1" })] }],
  ["택배사 코드가 글자",     { waybillList: [한줄({ deliveryCompanyCode: "로젠" })] }],
  ["waybillList 가 없다",   { list: [한줄()] }],
  ["빈 배열",               { waybillList: [] }],
  ["501건",                 { waybillList: Array.from({ length: 501 }, () => 한줄()) }],
  ["몸통에 딴 칸",          { waybillList: [한줄()], memo: "덧붙임" }],
  //  2026-10-26 재출력 예외 — Y 는 reprint 표시 · 50건 이하 · 전부 로젠(007) 셋이 다 있어야 열린다
  ["Y + reprint 가 글자 true", { waybillList: [한줄()], forceUpdateYn: "Y", reprint: "true" }],
  ["Y + reprint · 로젠 아님",   { waybillList: [한줄({ deliveryCompanyCode: "001" })], forceUpdateYn: "Y", reprint: true }],
  ["Y + reprint · 51건",        { waybillList: Array.from({ length: 51 }, () => 한줄()), forceUpdateYn: "Y", reprint: true }],
  //  2026-10-28 가짜 송장 덮기 예외 — Y 는 fixFake 표시 · 20건 이하 · 우리 택배사 · «진짜 꼴» 송장이어야 열린다
  ["Y + fixFake 가 글자 true",  { waybillList: [한줄({ deliveryCompanyCode: "002", wayBillNo: "262717707335" })], forceUpdateYn: "Y", fixFake: "true" }],
  ["Y + fixFake · 21건",         { waybillList: Array.from({ length: 21 }, () => 한줄({ deliveryCompanyCode: "002", wayBillNo: "262717707335" })), forceUpdateYn: "Y", fixFake: true }],
  ["Y + fixFake · 모르는 택배사", { waybillList: [한줄({ deliveryCompanyCode: "003", wayBillNo: "262717707335" })], forceUpdateYn: "Y", fixFake: true }],
  ["Y + fixFake · 9자리 송장",    { waybillList: [한줄({ deliveryCompanyCode: "002", wayBillNo: "222222222" })], forceUpdateYn: "Y", fixFake: true }],
  ["Y + fixFake · 반복 숫자",     { waybillList: [한줄({ deliveryCompanyCode: "002", wayBillNo: "111111111111" })], forceUpdateYn: "Y", fixFake: true }],
  ["Y + fixFake + reprint 같이",  { waybillList: [한줄()], forceUpdateYn: "Y", fixFake: true, reprint: true }],
];

let 샌다 = 0, build = "";
console.log("\n── 깨 본다 (전부 막혀야 한다) ──");
for (const [이름, 몸통] of 깰것) {
  const r = await 보내(몸통);
  build ||= r.build ?? "";
  const 막힘 = r.status === 400 && r.글.includes("RELAY_WAYBILL_GUARD");
  if (!막힘) 샌다++;
  console.log(`  ${막힘 ? "막힘 ✅" : "★ 샌다 ★"}  ${이름.padEnd(18)} HTTP ${r.status}  ${r.글.slice(0, 105)}`);
}

console.log("\n── 바른 몸통 (없는 주문번호 — 송장은 한 건도 안 붙는다) ──");
const ok = await 보내({ waybillList: [한줄()], forceUpdateYn: "N" });
console.log(`  HTTP ${ok.status}  ${ok.글.slice(0, 200)}`);

/*  ★ HTTP 200 을 「통과」의 잣대로 쓰면 안 된다 ★  (2026-10-23 에 틀렸다)
    없는 주문번호를 넣었으니 사방넷은 **HTTP 400 · code 400** 으로 답한다 —
    다만 몸통에 `results[{status:false, errorMessage:"주문정보가 존재하지 않습니다"}]`
    가 들어 있다. 그것이 「가드를 지나 사방넷까지 닿았다」는 증거다.
    가드에 막혔으면 RELAY_WAYBILL_GUARD 가 왔을 것이다.
    잣대를 HTTP 로 삼으면 «뚫린 길»을 막혔다고 읽는다. */
const 닿음 = !ok.글.includes("RELAY_") && /results/.test(ok.글);

/*  ★ 막히는 것만 보면 모자란다 ★ 열어 둔 갈래가 정말 열렸는지도 본다 (2026-10-28).
    없는 주문번호(1)라 사방넷이 건별 실패를 돌려준다 — 송장은 한 건도 안 바뀐다. */
const ok2 = await 보내({ waybillList: [한줄({ deliveryCompanyCode: "002", wayBillNo: "262717707335" })], forceUpdateYn: "Y", fixFake: true });
const 닿음2 = !ok2.글.includes("RELAY_") && /results/.test(ok2.글);
console.log("");
console.log("── 가짜 덮기 갈래 (Y + fixFake · 002 · 12자리) ──");
console.log(`  ${닿음2 ? "열렸음 ✅" : "★ 막혔음 ★"}  HTTP ${ok2.status}  ${ok2.글.slice(0, 160)}`);
console.log("\n── 판정 ──");
console.log(`  판 번호 ${build || "(못 읽음)"}`);
if (샌다) console.log(`  ★ ${샌다}가지가 샙니다 — 가드가 제대로 안 올라갔습니다.`);
else if (!닿음) console.log(`  막기는 다 막는데 바른 것이 사방넷까지 못 갔습니다 — ${ok.글.slice(0, 120)}`);
else if (!닿음2) console.log("  막기는 다 막는데 «가짜 덮기» 갈래가 안 열렸습니다 — " + ok2.글.slice(0, 120));
else console.log(`  ✅ ${깰것.length}가지 다 막고, 바른 것(N)과 가짜 덮기(Y+fixFake)만 사방넷까지 닿습니다.`);
console.log("");
