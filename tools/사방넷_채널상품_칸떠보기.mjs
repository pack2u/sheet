/**
 *  POST /v3/sb/channels-product 의 «상세설명 칸 이름»을 찾는다      (2026-10-27)
 *
 *    node tools/사방넷_채널상품_칸떠보기.mjs
 *
 *  > 사장님: 「Html을 만들었어.. 이걸 사방넷에 올리는 탭을 만들어줘 …
 *  >  쇼핑몰마다 가격등을 설정할수 있게」
 *
 *  ★ 실제 상품을 안 건드린다 ★
 *    customProductCode 를 «없는 코드»로 둔다. 사방넷이 「그런 상품 없다」로 막아 주므로
 *    어떤 칸을 보내도 아무것도 안 바뀐다. 칸 이름이 틀렸는지 맞았는지만 본다.
 *    (운송장·답변 떠보기 때와 같은 손버릇 — 없는 번호로만 떠 본다)
 *
 *  ★ 사방넷 오류 문장은 거짓말을 한다 ★
 *    「[상품 목록] 필수 입력값입니다」가 «키가 틀렸을 때»도 «속 칸이 빠졌을 때»도 똑같이 나온다.
 *    그래서 «말이 달라지는 자리»를 찾는 식으로 훑는다.
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

/*  ★ 없는 품목코드 ★ 이 값이 바뀌면 진짜 상품의 상세페이지가 덮인다. 건드리지 말 것. */
const 없는코드 = "ZZZ_KAN_TEST_0000";
const 몰 = "shop0546";

async function 떠(몸, 이름) {
  const r = await fetch(HOST + "/v3/sb/channels-product", {
    method: "POST",
    headers: { Authorization: "Bearer " + tj.access_token, "X-Svc-Acnt-Id": cfg.svcAcntId,
               "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(몸),
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  const 건 = j?.data?.results?.[0] ?? j?.data?.[0];
  console.log(`  ${String(이름).padEnd(26)} HTTP ${r.status}  ${String(j?.message ?? "").slice(0, 36).padEnd(38)}` +
              ` ${건 ? JSON.stringify(건).slice(0, 110) : t.slice(0, 110)}`);
  return { s: r.status, j, t };
}

console.log(`\n/v3/sb/channels-product — 칸 떠보기 (없는 품목코드 ${없는코드} 로만)\n`);

/* ① 아는 꼴이 어떻게 답하는지 먼저 본다 — 이것이 「바닥」이다 */
await 떠({ products: [{ shopCode: 몰, customProductCode: 없는코드, salePrice: 1000 }] }, "① 가격만 (바닥)");

/* ② 상세설명 칸 후보 — 하나씩 더해 «말이 달라지는지» 본다 */
const 후보 = [
  "detailDescription", "detailHtml", "detail", "description",
  "productDetail", "goodsDetail", "detailContent", "content",
  "detailExplain", "explain", "detailInfo", "html",
  "shopDetailDescription", "mallDetailDescription", "detailDesc",
];
for (const k of 후보) {
  await 떠({ products: [{ shopCode: 몰, customProductCode: 없는코드, salePrice: 1000, [k]: "<p>시험</p>" }] }, "② " + k);
  await new Promise((x) => setTimeout(x, 150));
}

console.log(`\n── 읽는 법 ──`);
console.log(`  ①과 «같은» 답이면 그 칸을 사방넷이 조용히 버린 것이다 (이름이 틀렸거나 안 받는다).`);
console.log(`  ①과 «다른» 답(칸 이름을 꼬집는 오류)이 나오면 그 이름이 맞다.`);
console.log(`  전부 같으면 — 사방넷은 모르는 칸을 그냥 버린다는 뜻이라, 이 방법으론 못 가린다.`);
console.log(`  그때는 진짜 상품 하나로 «보내고 화면에서 확인»하는 수밖에 없다.\n`);
