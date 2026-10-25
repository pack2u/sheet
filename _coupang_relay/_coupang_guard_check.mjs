/**
 *  쿠팡 중계기 울타리가 정말 우는가 — 깨 보고 나서 믿는다        (2026-10-25)
 *
 *    node _coupang_relay/_coupang_guard_check.mjs
 *    다른 자리에 올렸으면:  COUPANG_RELAY_URL=https://…/coupang.php 로 알려 준다
 *
 *  ★ 쿠팡에는 테스트 환경이 없다 ★ (개발자센터 기타문의 11번)
 *    그래서 이 시험은 «중계기까지»만 본다 — 울타리에 걸리면 RELAY_* 가 돌아온다.
 *    쿠팡까지 닿는 것은 서명이 맞아야 하니, 그것은 화면의 「연결시험」으로 본다.
 *
 *  ★ 2026-10-25 이 검사 자체를 고쳤다 ★
 *    중계기가 아직 안 올라가 열두 가지가 전부 404(웹서버 HTML)로 왔는데
 *    「12가지가 샙니다」라고 말했다. **울타리가 새는 것과 문이 없는 것은 다르다.**
 *    원인을 못 가르는 검사는 엉뚱한 데를 뒤지게 만든다 —
 *    그래서 깨기 «전에» 문이 있는지부터 묻는다.
 */
import { readFileSync, existsSync } from "node:fs";

const 설정 = "D:/Pack2U_상품정보sheet/_coupang_relay/coupang_config.php";
const token = existsSync(설정)
  ? (readFileSync(설정, "utf8").match(/'token'\s*=>\s*'([^']+)'/)?.[1] ?? "")
  : "";
const URL_ = process.env.COUPANG_RELAY_URL || "https://siot.com/pack2u/coupang/coupang.php";

if (!token) {
  console.error("\ncoupang_config.php 가 없거나 token 이 비었습니다.");
  console.error("  coupang_config.sample.php 를 coupang_config.php 로 복사해 token 을 채우고,");
  console.error("  그 파일과 coupang.php 를 /siot00/www/pack2u/coupang/ 에 올린 뒤 다시 돌려 주세요.\n");
  process.exit(1);
}

const VID = "A00012345";                       // 아무 업체 코드. 울타리만 보는 시험이라 실제 값이 아니어도 된다
const 길 = `/v2/providers/openapi/apis/api/v6/vendors/${VID}/returnRequests`;
const 서명꼴 = `CEA algorithm=HmacSHA256, access-key=aaaaaaaa, signed-date=261025T010101Z, signature=${"0".repeat(64)}`;
const 질의 = "searchType=timeFrame&createdAtFrom=2026-10-25T00:00&createdAtTo=2026-10-25T01:00&status=RU";

/** 중계기가 그 주소에 있나 — GET 으로 열면 스스로 판 번호를 말해 준다 */
async function 거기있나(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    const t = (await r.text()).slice(0, 400);
    let j = null;
    try { j = JSON.parse(t); } catch { /* HTML 이 오면 중계기가 아니다 */ }
    return {
      ok: j?.relay === "coupang",
      status: r.status,
      build: j?.build ?? r.headers.get("x-relay-build"),
      글: t,
      딴것: j?.relay ?? null,          // sabang.php 를 가리키고 있을 수도 있다
    };
  } catch (e) {
    return { ok: false, status: 0, 글: e.message, 딴것: null };
  }
}

async function 보내(몸통) {
  try {
    const r = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Proxy-Token": token },
      body: JSON.stringify(몸통),
    });
    return { build: r.headers.get("x-relay-build"), status: r.status, 글: (await r.text()).slice(0, 220) };
  } catch (e) {
    return { build: null, status: 0, 글: `못 불렀습니다 — ${e.message}` };
  }
}
const 바른 = (x = {}) => ({ method: "GET", path: 길, query: 질의, authorization: 서명꼴, ...x });

/* ─── 울타리를 깨기 «전에» 문이 있는지 본다 ─── */
const 문 = await 거기있나(URL_);
if (!문.ok) {
  console.error(`\n중계기가 ${URL_} 에 없습니다 (HTTP ${문.status}).`);
  console.error("  돌아온 것: " + String(문.글).replace(/\s+/g, " ").slice(0, 130));
  if (문.딴것) console.error(`  ★ 그 자리에는 「${문.딴것}」 중계기가 있습니다 — 주소를 잘못 짚었습니다.`);
  console.error("\n  ★ 울타리가 새는 것이 아니라 «문이 없는» 것입니다 ★");
  console.error("  올릴 곳 — /siot00/www/pack2u/coupang/   (sabang.php 가 있는 폴더의 «옆»)");
  console.error("    · pack2u 안에 coupang 폴더를 새로 만들어야 합니다");
  console.error("    · coupang.php 와 coupang_config.php 를 «둘 다» 올려야 합니다");
  console.error("  다른 데 올리셨으면 그 주소를 알려 주면 거기를 봅니다:");
  console.error("    $env:COUPANG_RELAY_URL='https://siot.com/…그-주소…/coupang.php'; node _coupang_relay/_coupang_guard_check.mjs\n");
  process.exit(1);
}
console.log(`\n중계기 있습니다 — 판 번호 ${문.build ?? "(없음)"}`);

const 깰것 = [
  ["PATCH 를 보낸다",        바른({ method: "PATCH" }), "RELAY_READ_ONLY"],
  ["POST 를 보낸다",         바른({ method: "POST" }),  "RELAY_READ_ONLY"],
  ["출고중지완료 길",         바른({ path: `/v2/providers/openapi/apis/api/v4/vendors/${VID}/returnRequests/1/stoppedShipment` }), "RELAY_PATH_DENIED"],
  ["상품 쪽 길",             바른({ path: `/v2/providers/openapi/apis/api/v2/vendors/${VID}/products` }), "RELAY_PATH_DENIED"],
  ["경로에 ..",              바른({ path: `/v2/providers/openapi/apis/api/v6/vendors/${VID}/../../etc` }), "RELAY_BAD_PATH"],
  ["경로에 ? 가 붙음",        바른({ path: 길 + "?x=1" }), "RELAY_BAD_PATH"],
  ["vendorId 가 비었다",      바른({ path: "/v2/providers/openapi/apis/api/v6/vendors//returnRequests" }), "RELAY_PATH_DENIED"],
  ["모르는 질의 칸",          바른({ query: 질의 + "&callback=evil" }), "RELAY_QUERY_DENIED"],
  ["질의글이 너무 길다",       바른({ query: "status=" + "R".repeat(700) }), "RELAY_BAD_QUERY"],
  ["서명이 없다",             바른({ authorization: "" }), "RELAY_BAD_AUTH"],
  ["서명 꼴이 틀렸다",         바른({ authorization: "Bearer abcdef" }), "RELAY_BAD_AUTH"],
  ["서명 길이가 짧다",         바른({ authorization: 서명꼴.replace("0".repeat(64), "0".repeat(32)) }), "RELAY_BAD_AUTH"],
];

let 샌다 = 0;
console.log("\n── 깨 본다 (전부 막혀야 한다) ──");
for (const [이름, 몸통, 바라는코드] of 깰것) {
  const r = await 보내(몸통);
  /* 바라는 RELAY_* 코드가 와야 «막혔다». 딴 코드나 HTML 은 막힌 것이 아니다 */
  const 막힘 = r.글.includes(바라는코드);
  if (!막힘) 샌다++;
  console.log(`  ${막힘 ? "막힘 ✅" : "★ 샌다 ★"}  ${이름.padEnd(20)} HTTP ${r.status}  ${r.글.slice(0, 95)}`);
}

/*  ★ 바른 몸통은 «쿠팡까지» 간다 ★
    서명이 가짜라 쿠팡이 401 을 준다. 그것이 「울타리를 지나 쿠팡까지 닿았다」는 증거다.
    HTTP 200 을 잣대로 쓰면 뚫린 길을 막혔다고 읽는다 — 사방넷 가드 때 그렇게 틀렸다.  */
console.log("\n── 바른 몸통 (서명이 가짜라 쿠팡이 거절하는 것이 «정답»이다) ──");
const ok = await 보내(바른());
console.log(`  HTTP ${ok.status}  ${ok.글.slice(0, 200)}`);
const 닿음 = !ok.글.includes("RELAY_");

console.log("\n── 판정 ──");
if (샌다) console.log(`  ★ ${샌다}가지가 샙니다 — 울타리가 제대로 안 올라갔습니다.`);
else if (!닿음) console.log(`  막기는 다 막는데 바른 것이 쿠팡까지 못 갔습니다 — ${ok.글.slice(0, 130)}`);
else console.log("  ✅ 열두 가지 다 막고, 바른 것만 쿠팡까지 닿습니다.");
console.log("");
