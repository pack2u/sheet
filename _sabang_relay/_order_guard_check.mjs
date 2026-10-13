/**
 *  올린 뒤 — ORDER_GUARD 가 «진짜» 살아 있나                (2026-10-13)
 *
 *    node _sabang_relay/_order_guard_check.mjs
 *
 *  올려 놓고 믿지 않는다. 울타리는 깨 보고 나서 믿는다.
 *  SANDBOX 로만 두드린다. 아무것도 안 바꾼다.
 *
 *  보는 것 셋
 *    ① 경로가 열렸나                    — 닫혀 있으면 아직 안 올라간 것이다
 *    ② updateOrderStsYn:"Y" 를 막나      — ★ 이것이 울타리의 알맹이다 ★
 *    ③ 아예 안 보내면 지나가나            — 가드가 「N」으로 채워 주는 쪽
 *
 *  ②가 통과(= 안 막힘)하면 울타리가 «없는» 것이다. ①만 올라가고 ③(ORDER_GUARD)이
 *  빠진 꼴이라, 그대로 두면 조회 한 번에 신규주문이 주문확인으로 바뀐다.
 */
import { readFileSync, existsSync } from "node:fs";

const 설정파일 = new URL("./sabang_config.php", import.meta.url);
let url = process.env.SABANG_RELAY_URL || "https://siot.com/pack2u/sabang/sabang.php";
let token = process.env.SABANG_PROXY_TOKEN || "";
if (!token && existsSync(설정파일)) {
  const 줄 = readFileSync(설정파일, "utf8").split("\n").find((l) => l.includes("'token'") && l.includes("=>"));
  token = 줄?.match(/'([^']*)'\s*,?\s*$/)?.[1] ?? "";
}
if (!token) { console.error("중계기 열쇠말이 없습니다"); process.exit(1); }

const 몸통바탕 = { responseItems: ["SB_ORD_NO"], page: 1, perPage: 50, startDate: "20260101", endDate: "20260101" };

async function 보내기(body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Proxy-Token": token },
    body: JSON.stringify({ method: "POST", path: "/v3/sb/order", body, env: "SANDBOX" }),
    signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 200) }; }
  return { code: String(j.code ?? ""), message: String(j.message ?? ""), status: r.status };
}

let 탈 = 0;
const 본다 = (이름, 됐나, 말) => { console.log((됐나 ? "  OK  " : "  ✗   ") + 이름 + (말 ? "  — " + 말 : "")); if (!됐나) 탈++; };

console.log(`중계기 ${url}  ·  SANDBOX\n`);

/* ① 경로 */
const a = await 보내기({ ...몸통바탕, updateOrderStsYn: "N" });
if (a.code === "RELAY_PATH_DENIED") {
  console.log("  ✗   ① 주문 경로가 아직 닫혀 있습니다 — sabang.php 가 안 올라갔습니다");
  process.exit(1);
}
본다("① 주문 경로 열림", true, `${a.code} ${a.message}`.trim().slice(0, 48));

/* ② ★ 울타리를 깨 본다 ★  「Y」를 일부러 보낸다 */
await new Promise((r) => setTimeout(r, 300));
const b = await 보내기({ ...몸통바탕, updateOrderStsYn: "Y" });
본다("② updateOrderStsYn:\"Y\" 를 막는다", b.code === "RELAY_ORDER_STS_GUARD",
     b.code === "RELAY_ORDER_STS_GUARD" ? "" : `★ 안 막혔습니다 — ${b.code} ${b.message}`.slice(0, 70));

/* ③ 안 보내면 가드가 채워 준다 (막히지 않아야 한다) */
await new Promise((r) => setTimeout(r, 300));
const c = await 보내기({ ...몸통바탕 });
본다("③ 안 보내면 지나간다 (가드가 「N」으로 채움)", c.code !== "RELAY_ORDER_STS_GUARD",
     `${c.code} ${c.message}`.trim().slice(0, 48));

console.log(탈 ? `\n★ ${탈}개 탈 — 울타리가 온전하지 않습니다. 쓰지 마세요.` : "\n울타리가 살아 있습니다.");
process.exit(탈 ? 1 : 0);
