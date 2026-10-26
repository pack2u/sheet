/**
 *  사방넷 클레임·문의 — 7일치 집계 (읽기만)                    (2026-10-26)
 *
 *    node tools/사방넷_클레임CS_집계.mjs [일수]
 *
 *  ★ 왜 ★ 「되나」는 확인했다(됐다). 이제 「쓸 만한가」를 본다 —
 *    얼마나 들어오나 · 어느 몰에서 오나 · ★ 아직 안 나간 주문에 들어온 것이 몇 건인가 ★
 *    마지막 것이 쿠팡 직접 API 로 하려던 「출고 직전 검문」의 재료다.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const bcrypt = req("D:/Pack2U_협력업체시스템_v2/migrate/node_modules/bcryptjs");
const s = readFileSync("D:/Pack2U_상품정보sheet/_sabang_relay/sabang_config.php", "utf8");
const 뽑 = (k) => s.split("\n").find((l) => l.includes("'" + k + "'") && l.includes("=>"))?.match(/=>\s*'([^']*)'/)?.[1] ?? "";
const cfg = { clientCd: 뽑("clientCd"), clientType: 뽑("clientType"), svcAcntId: 뽑("svcAcntId"), secret: 뽑("secretProduction") };

const HOST = "https://api.sabangnet.co.kr";
const ts = Date.now();
const sign = Buffer.from(bcrypt.hashSync(cfg.clientCd + "_" + ts, cfg.secret), "utf8").toString("base64");
const tj = await (await fetch(HOST + "/oauth2/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", clientType: cfg.clientType || "SB_APP",
    clientCd: cfg.clientCd, timestamp: String(ts), secretSign: sign, authMode: "PRODUCTION" }),
})).json();
if (!tj.access_token) { console.error("토큰 실패"); process.exit(1); }

const 일수 = Math.max(1, Math.min(180, Number(process.argv[2] ?? 7)));
const 날 = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const 끝 = new Date(), 시작 = new Date(Date.now() - 일수 * 864e5);

async function 부르(경로, 몸) {
  const r = await fetch(HOST + 경로, {
    method: "POST",
    headers: { Authorization: "Bearer " + tj.access_token, "X-Svc-Acnt-Id": cfg.svcAcntId,
               "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(몸),
  });
  const j = await r.json().catch(() => null);
  /*  ★ HTTP 200 이어야 «열린» 것이다 ★ 400 봉투에도 data.results 가 빈 배열로 온다 —
      그것을 「0건」으로 읽으면 오류를 성공으로 센다(10/26 이 시험에서 실제로 그랬다).  */
  if (r.status !== 200 || !j?.data?.results) return { 탈: `HTTP ${r.status} ${JSON.stringify(j).slice(0, 180)}` };
  return { d: j.data };
}

async function 전부(경로, 본) {
  const 줄 = [];
  for (let p = 1; p <= 40; p++) {
    const r = await 부르(경로, { ...본, page: p, perPage: 1000 });
    if (r.탈) return { 줄, 탈: r.탈 };
    줄.push(...r.d.results);
    if (!r.d.hasNext || p >= (r.d.totalPage || 1)) break;
    await new Promise((x) => setTimeout(x, 150));
  }
  return { 줄 };
}

const 세기 = (arr, f) => arr.reduce((m, x) => { const k = f(x) ?? "(없음)"; m[k] = (m[k] || 0) + 1; return m; }, {});
const 표 = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`).join("\n");

console.log(`\n═══ 사방넷 클레임·문의 — 지난 ${일수}일 (${날(시작)}~${날(끝)}) ═══\n`);

/* ── 클레임 ── */
const 클레임칸 = ["CLAIM_SRNO","CLAIM_TEXT","CLAIM_STS_DIV_CD","CLAIM_CT_DT","CLAIM_REGS_DT",
  "ORDER_STATUS","ORDER_STATUS_NM","SB_ORD_NO","SHOP_ORD_NO","CUSTOM_PRD_CD","CT_PRD_NM","SHOP_NM"];
let c = await 전부("/v3/sb/claim", { startDate: 날(시작), endDate: 날(끝), responseItems: 클레임칸 });
if (c.탈) {
  /* SHOP_NM 이 없는 칸이면 사방넷이 400 을 준다 — 빼고 다시 */
  c = await 전부("/v3/sb/claim", { startDate: 날(시작), endDate: 날(끝), responseItems: 클레임칸.slice(0, -1) });
}
if (c.탈) { console.log("클레임 — " + c.탈 + "\n"); }
else {
  console.log(`■ 클레임  ${c.줄.length}건`);
  console.log("  유형\n" + 표(세기(c.줄, (x) => x.CLAIM_STS_DIV_CD)));
  console.log("  그때 주문상태\n" + 표(세기(c.줄, (x) => x.ORDER_STATUS_NM)));

  /*  ★ 알맹이 ★ 아직 «안 나간» 주문에 들어온 클레임 — 출고 직전 검문의 재료  */
  const 안나감 = /출고대기|상품준비|신규|결제완료|접수/;
  const 막을수있는것 = c.줄.filter((x) => 안나감.test(String(x.ORDER_STATUS_NM ?? "")));
  console.log(`\n  ★ 아직 안 나간 주문에 들어온 클레임 — ${막을수있는것.length}건 ★`);
  for (const x of 막을수있는것.slice(0, 12)) {
    console.log(`    ${x.CLAIM_CT_DT?.slice(4,12)}  주문 ${x.SB_ORD_NO}  ${String(x.ORDER_STATUS_NM).padEnd(6)} ` +
                `${String(x.CLAIM_STS_DIV_CD).padEnd(8)} ${String(x.CUSTOM_PRD_CD ?? "").padEnd(12)} ` +
                `${String(x.CLAIM_TEXT ?? "").replace(/\n/g, " ").slice(0, 46)}`);
  }
  if (막을수있는것.length > 12) console.log(`    … 그리고 ${막을수있는것.length - 12}건`);
}

/* ── 문의(CS) ── 네 상태를 다 센다 */
console.log("\n■ 문의(CS)");
const 상태들 = ["NEW_RECEIPT", "ANSWER_SAVED", "ANSWER_SENT", "FORCED_CONVERSION"];
const 모은문의 = [];
for (const st of 상태들) {
  const r = await 전부("/v3/sb/cs", { startDate: 날(시작), endDate: 날(끝), csStatus: st });
  if (r.탈) { console.log(`  ${st.padEnd(18)} ${r.탈}`); continue; }
  console.log(`  ${st.padEnd(18)} ${String(r.줄.length).padStart(4)}건`);
  모은문의.push(...r.줄.map((x) => ({ ...x, _상태: st })));
  await new Promise((x) => setTimeout(x, 150));
}
if (모은문의.length) {
  console.log("\n  몰별\n" + 표(세기(모은문의, (x) => x.shopName)));
  const 미답변 = 모은문의.filter((x) => x._상태 === "NEW_RECEIPT");
  console.log(`\n  ★ 아직 답 안 한 문의 ${미답변.length}건 ★`);
  for (const x of 미답변.slice(0, 10)) {
    console.log(`    ${String(x.csCreatedDate ?? "").slice(4,12)}  ${String(x.shopName).padEnd(8)} ` +
                `${String(x.csTitle ?? "").padEnd(10)} ${String(x.csContent ?? "").replace(/\n/g, " ").slice(0, 50)}`);
  }
}
console.log("");
