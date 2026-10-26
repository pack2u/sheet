/**
 *  CS_ANSWER_GUARD 가 정말 우는가 — 깨 보고 나서 믿는다        (2026-10-26)
 *
 *    node _sabang_relay/_cs_answer_guard_check.mjs
 *
 *  ★ 이 길로 나간 글은 손님이 읽는다 ★
 *    사방넷에 저장된 답변은 원본 쇼핑몰로 송신된다. 되돌릴 길이 우리에게 없다.
 *    그래서 「막아야 할 것」을 실제로 던져 본다.
 *
 *  ★ 마지막 「바른 몸통」도 아무 답변을 안 단다 ★
 *    없는 문의번호(1)를 넣는다. 가드는 통과하고 사방넷이 «그런 문의 없다»로
 *    건별 실패를 돌려준다. 길이 끝까지 뚫렸는지만 보고, 글은 한 줄도 안 달린다.
 *
 *  ★ HTTP 로 성패를 가르지 말 것 ★ (운송장 가드 때 틀렸던 그것)
 *    전부 실패하면 사방넷이 HTTP 400 을 준다 — 몸통의 results 로 봐야 한다.
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
      body: JSON.stringify({ method: "POST", path: "/v3/sb/cs/answer", env: "PRODUCTION", body: 몸통 }),
    });
    return { build: r.headers.get("x-relay-build"), status: r.status, 글: (await r.text()).slice(0, 240) };
  } catch (e) { return { build: null, status: 0, 글: `못 불렀습니다 — ${e.message}` }; }
}

/*  ★ 없는 문의번호 ★ 이 값이 바뀌면 진짜 손님 문의에 글이 달린다. 건드리지 말 것. */
const 없는번호 = 1;
const 한줄 = (x = {}) => ({ csSrno: 없는번호, answerContent: "[울타리시험]", ...x });

const 깰것 = [
  ["items 가 없다",          { list: [한줄()] },                                  "RELAY_CS_ANSWER_GUARD"],
  ["빈 배열",                { items: [] },                                       "RELAY_CS_ANSWER_GUARD"],
  ["몸통에 딴 칸",           { items: [한줄()], csStatus: "ANSWER_SENT" },        "RELAY_CS_ANSWER_GUARD"],
  ["줄에 딴 칸",             { items: [한줄({ csStatus: "ANSWER_SENT" })] },      "RELAY_CS_ANSWER_GUARD"],
  ["줄에 answerer",          { items: [한줄({ answerer: "아무개" })] },           "RELAY_CS_ANSWER_GUARD"],
  ["번호가 글자",            { items: [한줄({ csSrno: "abc" })] },                "RELAY_CS_ANSWER_GUARD"],
  ["번호가 비었다",          { items: [한줄({ csSrno: "" })] },                   "RELAY_CS_ANSWER_GUARD"],
  ["답변이 비었다",          { items: [한줄({ answerContent: "" })] },            "RELAY_CS_ANSWER_GUARD"],
  ["답변이 공백뿐",          { items: [한줄({ answerContent: "   \n  " })] },     "RELAY_CS_ANSWER_GUARD"],
  ["답변이 2000자 넘음",     { items: [한줄({ answerContent: "가".repeat(2001) })] }, "RELAY_CS_ANSWER_GUARD"],
  ["21건",                   { items: Array.from({ length: 21 }, () => 한줄()) }, "RELAY_CS_ANSWER_GUARD"],
  ["줄이 객체가 아니다",     { items: ["글자"] },                                 "RELAY_CS_ANSWER_GUARD"],
];

/*  ★ 깨기 «전에» 어느 판이 올라가 있는지 본다 ★   (2026-10-26)
    길이 아예 안 열린 옛 판이면 모든 요청이 RELAY_PATH_DENIED 로 돌아오는데,
    그걸 「울타리가 샌다」로 읽으면 엉뚱한 데를 뒤진다.
    «문이 없는 것»과 «울타리가 새는 것»은 다르다 — 쿠팡 검사에서 똑같이 틀렸다. */
const 판 = await 보내({ items: [한줄()] });
if (판.글.includes("RELAY_PATH_DENIED")) {
  console.error(`\n중계기가 아직 옛 판입니다 — 판 번호 ${판.build ?? "(못 읽음)"}`);
  console.error("  길이 안 열려 있어 울타리를 깨 볼 수가 없습니다 (샌 것이 «아닙니다»).");
  console.error("  올릴 것 — _sabang_relay/sabang.php (판 20261026-cs-answer-guard)");
  console.error("    → /siot00/www/pack2u/sabang/sabang.php");
  console.error("  올린 뒤 다시 돌려 주세요.\n");
  process.exit(1);
}

let 샌다 = 0, build = "";
console.log("\n── 깨 본다 (전부 막혀야 한다) ──");
for (const [이름, 몸통, 바라는] of 깰것) {
  const r = await 보내(몸통);
  build ||= r.build ?? "";
  const 막힘 = r.글.includes(바라는);
  if (!막힘) 샌다++;
  console.log(`  ${막힘 ? "막힘 ✅" : "★ 샌다 ★"}  ${이름.padEnd(20)} HTTP ${r.status}  ${r.글.slice(0, 95)}`);
}

console.log("\n── 바른 몸통 (없는 문의번호 — 글은 한 줄도 안 달린다) ──");
const ok = await 보내({ items: [한줄()] });
console.log(`  HTTP ${ok.status}  ${ok.글.slice(0, 220)}`);
/*  사방넷까지 닿았다는 증거는 «건별 답(results)» 이다. 가드에 막혔으면 RELAY_ 가 온다. */
const 닿음 = !ok.글.includes("RELAY_") && /results/.test(ok.글);

console.log("\n── 판정 ──");
console.log(`  판 번호 ${build || "(못 읽음)"}`);
if (!build) console.log("  ※ 판 번호가 안 읽히면 중계기가 아직 안 올라간 것입니다 (FTP).");
if (샌다) console.log(`  ★ ${샌다}가지가 샙니다 — 울타리가 제대로 안 올라갔습니다.`);
else if (!닿음) console.log(`  막기는 다 막는데 바른 것이 사방넷까지 못 갔습니다 — ${ok.글.slice(0, 140)}`);
else console.log("  ✅ 열두 가지 다 막고, 바른 것만 사방넷까지 닿습니다 (건별 답을 받았습니다).");
console.log("");
