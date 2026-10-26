/**
 * ══════════════════════════════════════════════════════════════
 *  사방넷 클레임·문의(CS) 수집이 되는가 — 떠 본다              (2026-10-26)
 *
 *  > 사장님: 「자 일단 클레임과 CS 수집이 가능한지 확인해봐」
 *
 *    node tools/사방넷_클레임CS_시험.mjs
 *
 *  ★ 중계기를 안 거친다 ★ 중계기는 **Vercel** 이 사방넷을 못 불러서 있는 것이다.
 *    이 PC(14.34.200.225)는 사방넷 화이트리스트에 들어 있어 바로 부른다.
 *    그래서 중계기 ALLOWED 에 claim·cs 가 닫혀 있어도 여기서는 잴 수 있다.
 *    (FTP 가 막혀 중계기를 못 고치는 것과 무관하게 답을 얻는다)
 *
 *  ★ 왜 중계기에서 닫아 뒀었나 ★
 *    주문 조회(`/v3/sb/order`)에는 `updateOrderStsYn` 이 있어서, 그냥 조회만 해도
 *    신규주문이 «주문확인»으로 바뀐다. claim·cs 도 수집하면서 「확인」 표시를
 *    남기는지 몰라서 닫아 뒀다.
 *    ★ 규격서에는 claim·cs 에 그런 파라미터가 «없다» ★ 그래도 문서에 없다고
 *    부작용이 없는 건 아니므로 — **창을 아주 좁게(어제~오늘) 잡고 한 번만** 부른다.
 *
 *  ★ 읽기만 ★ 답변 저장(`/v3/sb/cs/answer`)·상태변경은 건드리지 않는다.
 *
 *  ── 무엇을 보나 ──
 *   1) 길이 열려 있나 (200 이 오나, 권한 오류인가)
 *   2) 자료가 «들어와 있나» — 0건이면 길은 열렸어도 스케줄러(유료)가
 *      수집을 안 돌린 것일 수 있다. 그 둘을 반드시 갈라서 읽는다.
 * ══════════════════════════════════════════════════════════════
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const bcrypt = req("D:/Pack2U_협력업체시스템_v2/migrate/node_modules/bcryptjs");

const 설정 = "D:/Pack2U_상품정보sheet/_sabang_relay/sabang_config.php";
if (!existsSync(설정)) { console.error("sabang_config.php 가 없습니다"); process.exit(1); }
const s = readFileSync(설정, "utf8");
const 뽑 = (k) => {
  const m = s.split("\n").find((l) => l.includes("'" + k + "'") && l.includes("=>"));
  return m?.match(/=>\s*'([^']*)'/)?.[1] ?? "";
};
const cfg = { clientCd: 뽑("clientCd"), clientType: 뽑("clientType"), svcAcntId: 뽑("svcAcntId"), secret: 뽑("secretProduction") };
if (!cfg.secret) { console.error("운영계 시크릿이 없습니다"); process.exit(1); }

const HOST = "https://api.sabangnet.co.kr";
const ts = Date.now();
const sign = Buffer.from(bcrypt.hashSync(cfg.clientCd + "_" + ts, cfg.secret), "utf8").toString("base64");
const tr = await fetch(HOST + "/oauth2/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials", clientType: cfg.clientType || "SB_APP",
    clientCd: cfg.clientCd, timestamp: String(ts), secretSign: sign, authMode: "PRODUCTION",
  }),
});
const tj = await tr.json();
if (!tj.access_token) { console.error("토큰 실패 — " + JSON.stringify(tj).slice(0, 250)); process.exit(1); }
console.log("\n토큰 받았습니다 (운영계)\n");

const 어제 = new Date(Date.now() - 24 * 3600_000), 오늘 = new Date();
const 날 = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function 부르(경로, 몸, 이름) {
  const r = await fetch(HOST + 경로, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tj.access_token,
      "X-Svc-Acnt-Id": cfg.svcAcntId,
      "Content-Type": "application/json", Accept: "*/*",
    },
    body: JSON.stringify(몸),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  console.log(`── ${이름} ──`);
  console.log(`   보낸 몸통  ${JSON.stringify(몸).slice(0, 200)}`);
  console.log(`   HTTP ${r.status}  ·  남은 TPS ${r.headers.get("x-ratelimit-remaining") ?? "?"}`);
  /*  ★ HTTP 200 이어야 «열린» 것이다 ★  (2026-10-26 여기서 틀렸다)
      사방넷은 400 봉투에도 data.results 를 «빈 배열»로 담아 보낸다.
      results 만 보고 가르면 오류를 「0건」으로 읽어, 길이 막힌 것을
      「수집이 안 돌았다」로 잘못 말한다. 쿠팡 중계기 때와 같은 꼴의 실수다.  */
  if (r.status === 200 && j?.data?.results) {
    const d = j.data;
    console.log(`   ★ 열렸습니다 ★  모두 ${d.totalItemCnt ?? "?"}건 · 이 쪽 ${d.results.length}건 · 쪽 ${d.page}/${d.totalPage}`);
    if (d.results.length) {
      console.log(`   첫 줄의 칸들: ${Object.keys(d.results[0]).join(", ").slice(0, 300)}`);
      console.log(`   첫 줄: ${JSON.stringify(d.results[0]).slice(0, 400)}`);
    } else {
      console.log(`   ※ 길은 열렸는데 «0건» 입니다 — 수집이 안 돌았을 수 있습니다(스케줄러)`);
    }
  } else {
    console.log(`   답: ${t.slice(0, 420)}`);
  }
  console.log("");
  return { status: r.status, j, 글: t };
}

/* ── ① 클레임 ── 규격: 조회기간 최대 180일 · page≥1 · perPage 50~1000 · responseItems 필수 */
const 클레임칸 = ["CLAIM_SRNO", "CLAIM_TEXT", "CLAIM_STS_DIV_CD", "CLAIM_CT_DT", "CLAIM_REGS_DT",
                 "ORDER_STATUS", "ORDER_STATUS_NM", "SB_ORD_NO", "SHOP_ORD_NO", "CUSTOM_PRD_CD"];

await 부르("/v3/sb/claim", { page: 1, perPage: 50 }, "클레임 ① 맨몸 (무엇이 필수인지 사방넷에게 묻는다)");
await 부르("/v3/sb/claim",
  { page: 1, perPage: 50, startDate: 날(어제), endDate: 날(오늘), responseItems: 클레임칸 },
  "클레임 ② 규격대로 (어제~오늘)");

/* ── ② 문의사항(CS) ── csStatus 넷: NEW_RECEIPT · ANSWER_SAVED · ANSWER_SENT · FORCED_CONVERSION */
await 부르("/v3/sb/cs", { page: 1, perPage: 50 }, "문의 ① 맨몸");
await 부르("/v3/sb/cs",
  { page: 1, perPage: 50, startDate: 날(어제), endDate: 날(오늘), csStatus: "NEW_RECEIPT" },
  "문의 ② 신규접수만 (어제~오늘)");

console.log("── 읽는 법 ──");
console.log("  200 + results        → 길이 열렸다");
console.log("  200 + 0건            → 길은 열렸으나 «수집이 안 돌았다» (유료 스케줄러 「클레임수집」·「문의수집」)");
console.log("  400 + 필수값 안내     → 길은 열렸고 몸통만 고치면 된다");
console.log("  401/403              → 권한이 없다 (계약에 안 들어 있다)");
console.log("");
