/**
 * ══════════════════════════════════════════════════════════════
 *  저장만 되고 몰로 안 간 답변을 다시 민다                     (2026-10-26)
 *
 *  > 사장님: 「최근 2주 것만 밀고 경고도 띄워줘」
 *
 *    node tools/사방넷_멈춘답변_밀기.mjs            ← 보여주기만 (아무것도 안 보냄)
 *    node tools/사방넷_멈춘답변_밀기.mjs --보냄
 *    node tools/사방넷_멈춘답변_밀기.mjs --보냄 --일 14
 *
 *  ★ 손님이 읽는 글이다 ★ 그래서 세 가지를 지킨다
 *    ① **글을 새로 쓰지 않는다** — 직원이 이미 저장해 둔 글을 «그대로» 다시 올린다
 *    ② **기간을 자른다** — 묵은 답변은 늦게 가면 안 보내느니만 못하다
 *       (09/17 「확인중입니다」가 5주 뒤에 도착하는 꼴)
 *    ③ **한 건씩 보내고 건별 답을 적는다** — 묶어 보내면 어느 것이 실패했는지 묻힌다
 *
 *  ★ 왜 멈추나는 아직 모른다 ★ 31건 중 11번가가 14건으로 유독 많다.
 *    우리 쪽에서 푸는 모양이 아닐 수 있다 — 사방넷에 물어야 한다.
 *    이 도구는 「다시 저장하면 밀리나」를 실제로 재 보는 것이기도 하다.
 * ══════════════════════════════════════════════════════════════
 */
import { readFileSync } from "node:fs";

const 보냄 = process.argv.includes("--보냄");
const 일수 = (() => { const i = process.argv.indexOf("--일"); return i >= 0 ? Number(process.argv[i + 1]) : 14; })();

const token = readFileSync("D:/Pack2U_상품정보sheet/_sabang_relay/sabang_config.php", "utf8")
  .match(/'token'\s*=>\s*'([^']+)'/)[1];
const 중계 = "https://siot.com/pack2u/sabang/sabang.php";

async function 부르(path, body) {
  const r = await fetch(중계, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Proxy-Token": token },
    body: JSON.stringify({ method: "POST", path, env: "PRODUCTION", body }),
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t: t.slice(0, 220) };
}

const 날 = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, "");
const 때 = (s) => (s ? `${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : "(없음)");
/** yyyyMMddHHmmss(한국) → Date */
const 날짜 = (s) => { const x = String(s ?? ""); return x.length < 8 ? null
  : new Date(Date.UTC(+x.slice(0,4), +x.slice(4,6)-1, +x.slice(6,8), +(x.slice(8,10)||0)-9, +(x.slice(10,12)||0))); };

/* ── 멈춘 것을 모은다 (넉넉히 60일) ── */
const r = await 부르("/v3/sb/cs", {
  page: 1, perPage: 1000, startDate: 날(Date.now() - 60 * 864e5), endDate: 날(Date.now()),
  csStatus: "ANSWER_SAVED",
});
if (r.s !== 200 || !r.j?.data?.results) { console.error("못 받았습니다 — " + r.t); process.exit(1); }

const 전부 = r.j.data.results;
const 자름 = new Date(Date.now() - 일수 * 864e5);
const 밀것 = [], 둘것 = [];
for (const x of 전부) {
  const 글 = String(x.answerContent ?? "").trim();
  const t = 날짜(x.answerSavedDate);
  if (!글) continue;                                   // 빈 답변은 울타리가 막는다
  (t && t >= 자름 ? 밀것 : 둘것).push({ x, 글, t });
}
밀것.sort((a, b) => String(a.x.answerSavedDate).localeCompare(String(b.x.answerSavedDate)));

console.log(`\n저장만 되고 안 간 답변 ${전부.length}건 · 최근 ${일수}일 ${밀것.length}건 · 그보다 묵은 것 ${둘것.length}건 (안 건드림)\n`);
for (const { x, 글 } of 밀것) {
  console.log(`  ${x.csSrno} ${String(x.shopName).padEnd(12)} ${때(x.answerSavedDate)} · ${글.replace(/\n/g, " ").slice(0, 52)}`);
}
if (!보냄) { console.log(`\n보여주기만 했습니다 — 보내려면 --보냄\n`); process.exit(0); }
if (!밀것.length) { console.log("\n보낼 것이 없습니다.\n"); process.exit(0); }

/* ── 한 건씩 보낸다 ── 묶어 보내면 어느 것이 실패했는지 묻힌다 ── */
console.log(`\n── 한 건씩 보냅니다 (글은 그대로) ──`);
let 됨 = 0, 안됨 = 0;
for (const { x, 글 } of 밀것) {
  const a = await 부르("/v3/sb/cs/answer", { items: [{ csSrno: Number(x.csSrno), answerContent: 글 }] });
  /*  ★ HTTP 로 성패를 가르지 않는다 ★ 전부 실패해도 사방넷은 400 을 준다 — results 를 본다 */
  const 건 = a.j?.data?.results?.[0];
  const 좋나 = 건?.status === true;
  if (좋나) 됨++; else 안됨++;
  console.log(`  ${좋나 ? "✅" : "✕ "} ${x.csSrno} ${String(x.shopName).padEnd(12)} ${좋나 ? "" : String(건?.errorMessage ?? a.t).slice(0, 90)}`);
  await new Promise((z) => setTimeout(z, 300));
}
console.log(`\n보냄 ${됨} · 실패 ${안됨}`);

/* ── 밀렸는지 «사방넷에 되물어» 확인한다 ── 「보냈다」는 우리 말이다 ── */
console.log(`\n잠시 뒤 다시 물어봅니다…`);
await new Promise((z) => setTimeout(z, 20000));
const 다시 = await 부르("/v3/sb/cs", {
  page: 1, perPage: 1000, startDate: 날(Date.now() - 60 * 864e5), endDate: 날(Date.now()), csStatus: "ANSWER_SENT",
});
const 간것 = new Set((다시.j?.data?.results ?? []).map((x) => String(x.csSrno)));
const 갔다 = 밀것.filter(({ x }) => 간것.has(String(x.csSrno)));
console.log(`  ANSWER_SENT 로 넘어간 것 ${갔다.length} / ${밀것.length}`);
if (!갔다.length) {
  console.log(`  ※ 아직 안 넘어갔습니다. 송신은 사방넷이 따로 밉니다(가운뎃값 72분).`);
  console.log(`     한 시간쯤 뒤에 화면의 「안 간 답변」 경고가 줄었는지 보세요.`);
  console.log(`     그래도 안 줄면 다시 저장으로는 안 밀리는 것입니다 — 사방넷에 물어야 합니다.`);
}
console.log("");
