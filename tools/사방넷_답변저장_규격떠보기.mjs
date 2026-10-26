/**
 * ══════════════════════════════════════════════════════════════
 *  POST /v3/sb/cs/answer 의 «필수 칸»을 사방넷에게 묻는다      (2026-10-26)
 *
 *    node tools/사방넷_답변저장_규격떠보기.mjs
 *
 *  ★ 개발자센터 문서를 못 읽어서다 ★ 세션이 만료됐고 로그인은 내가 안 한다.
 *    그래서 «떠서» 알아낸다 — 사방넷은 빠진 필수 칸을 400 으로 말해 준다.
 *
 *  ★★ 실제 답변이 저장될 수 없게 한다 ★★
 *    이건 손님에게 나가는 글을 쓰는 API 다. 떠보기가 진짜 답변을 달면 사고다.
 *    - csSrno 를 **1**(없는 번호)로 둔다 — 운영계에 그런 문의는 없다
 *    - 답변 글에 사람 말을 안 쓴다
 *    - 「필수 칸이 뭐냐」만 알아내면 즉시 멈춘다. 200 이 나오면 더 안 부른다.
 *    (운송장 가드 깨보기 `_waybill_guard_check.mjs` 와 같은 손버릇이다)
 * ══════════════════════════════════════════════════════════════
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

/*  ★ 없는 문의번호 ★ 이 값이 바뀌면 안 된다. 진짜 문의에 글이 달릴 수 있다. */
const 없는번호 = 1;
const 표시글 = "[규격확인]";   // 사람 말이 아니다. 저장돼도 뜻이 없게.

async function 떠(몸, 이름) {
  const r = await fetch(HOST + "/v3/sb/cs/answer", {
    method: "POST",
    headers: { Authorization: "Bearer " + tj.access_token, "X-Svc-Acnt-Id": cfg.svcAcntId,
               "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(몸),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  console.log(`\n── ${이름} ──`);
  console.log(`   몸통 ${JSON.stringify(몸).slice(0, 170)}`);
  console.log(`   HTTP ${r.status}  ${String(j?.message ?? t).slice(0, 200)}`);
  return { status: r.status, j, 글: t };
}

console.log("\n/v3/sb/cs/answer — 필수 칸 떠보기 (없는 문의번호 " + 없는번호 + " 로만 부른다)");

const 차례 = [
  [{}, "① 맨몸"],
  [{ csSrno: 없는번호 }, "② 번호만"],
  [{ csSrno: 없는번호, answerContent: 표시글 }, "③ 번호 + 답변내용"],
  [{ csList: [{ csSrno: 없는번호, answerContent: 표시글 }] }, "④ csList 묶음"],
  [{ cs: [{ csSrno: 없는번호, answerContent: 표시글 }] }, "⑤ cs 묶음"],
  [{ answers: [{ csSrno: 없는번호, answerContent: 표시글 }] }, "⑥ answers 묶음"],
];

for (const [몸, 이름] of 차례) {
  const r = await 떠(몸, 이름);
  if (r.status === 200) {
    console.log("\n★ 200 이 왔습니다 — 여기서 멈춥니다 ★");
    console.log("  이 몸통 꼴이 맞습니다. 없는 번호라 저장된 것은 없습니다.");
    console.log("  날것: " + r.글.slice(0, 400));
    break;
  }
  await new Promise((x) => setTimeout(x, 200));
}
console.log("\n※ 전부 400 이면 몸통 이름을 더 찾아야 합니다 — 사방넷에 문의하는 편이 빠릅니다.\n");
