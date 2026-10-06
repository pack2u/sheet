/**
 * ══════════════════════════════════════════════════════════════
 *  도서산간 판정을 건너뛰면 «이어달린다»
 *  2026-10-06
 *
 *  > "상품정보시트 발주 수집시 자동으로 도서산간이 안먹은거 같은데"
 *
 *  ★ 무엇이 일어났나 ★
 *    2026-10-06 09:30 회차가 09:35:58 에 끝났다 — 약 6분, GAS 한도에 거의
 *    닿았다. 수집은 「4분을 썼으면 도서산간을 건너뛴다」로 되어 있어
 *    101줄이 판정 없이 남았다. 「도서산간판정」 칸조차 안 생겼다 —
 *    그 칸은 판정이 돌 때 만들어지기 때문이다.
 *
 *  ★ 왜 아무도 몰랐나 ★
 *    건너뛴 것을 Logger 에만 적었다. 로그는 아무도 안 본다.
 *    그리고 자동 판매현황 갱신(silent)은 「바로 앞에서 이미 했다」고 보고
 *    판정을 안 한다 — 받침이 없었다. 수집이 늘 4분을 넘기는 동안
 *    «자동으로는 영영» 안 붙는다. 오류가 아니라 «안 붙는» 것이라서 조용하다.
 *
 *  ★ 이 시험이 지키는 것 ★
 *    ① 건너뛰는 자리에서 이어달리기를 «건다»
 *    ② 그 트리거가 판정과 원장 받침을 «둘 다» 돈다
 *    ③ 깃발을 세워 남의 자리 확보에 치워지지 않는다 — 그리고 돌면 지운다
 *    ④ 못 걸었으면 «말한다» (로그 + 챗)
 *
 *  돌리는 법   node _islandcatchup_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");

const 판정 = fs.readFileSync(path.join(__dirname, "_partnerIslandJudge.gs"), "utf8");
const 주문 = fs.readFileSync(path.join(__dirname, "_partnerOrders.gs"), "utf8");
const 푸시 = fs.readFileSync(path.join(__dirname, "_partnerExclusivePush.gs"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ✔ " + 이름); return; }
  틀린것++;
  console.log("  ✗ " + 이름 + (덧붙임 ? "\n      " + 덧붙임 : ""));
}
function 꺼내(src, 이름) {
  const i = src.indexOf("function " + 이름 + "(");
  if (i < 0) return "";
  const j = src.indexOf("{", i);
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  return "";
}

/* ── ① 건너뛰는 자리에서 거는가 ──────────────────────────── */
console.log("─── ① 건너뛸 때 이어달리기를 건다 ───");
const 수집 = 꺼내(주문, "_po_collectSilentCore_");
ok("4분 예산이 그대로 있다", /_islElapsed_ > 240000/.test(수집),
  "예산을 없애면 6분에 끊겨 뒤의 판매현황 갱신이 통째로 빠진다");
ok("★ 건너뛸 때 _isj_scheduleCatchUp_ 를 부른다 ★",
  /_islElapsed_ > 240000\)\s*\{[\s\S]{0,1400}?_isj_scheduleCatchUp_\(\)/.test(수집),
  "이것이 없으면 자동으로는 영영 안 붙는다 — 2026-10-06 에 101줄이 그랬다");
ok("건 결과를 로그에 남긴다 (걸었나 못 걸었나)",
  /이어\.ok[\s\S]{0,160}이어달리기도 못 걸었습니다/.test(수집),
  "조용히 넘어가면 오늘 일이 그대로 되풀이된다");
ok("거는 데 실패해도 수집은 계속 간다", /catch \(eSch\)/.test(수집),
  "곁다리 때문에 수집이 멈추면 더 나쁘다");

/* ── ② 이어달리기가 하는 일 ─────────────────────────────── */
console.log("\n─── ② 이어달리기가 판정과 받침을 둘 다 돈다 ───");
const 이어 = 꺼내(판정, "partnerIslandCatchUp_");
ok("판정을 돈다", /_island_judgeHubByAddress_\(\)/.test(이어));
ok("원장 받침도 돈다", /_trigger_islandShipping_\(\)/.test(이어),
  "판정은 아직 안 올라간 줄만 본다 — 이미 올라간 옛 줄은 원장이 받친다");
ok("한쪽이 터져도 다른 쪽을 돈다",
  (이어.match(/catch \(e\)/g) || []).length >= 2,
  "판정이 터지면 받침까지 안 도는 일이 생긴다");
ok("결과를 로그에 적는다", /ISLAND_CATCHUP/.test(이어));

/* ── ③ 깃발 — 남의 자리 확보에 안 치워진다 ──────────────── */
console.log("\n─── ③ 깃발 ───");
const 걸기 = 꺼내(판정, "_isj_scheduleCatchUp_");
ok("걸기 «전»에 깃발을 세운다",
  걸기.indexOf("setProperty(_ISJ_CATCHUP_FLAG_") < 걸기.indexOf("_isj_dropCatchUpTriggers_()"),
  "걸고 나서 세우면 그 사이에 남이 「다 쓴 것」으로 보고 치운다");
ok("이어달리기가 돌면 깃발을 «먼저» 지운다",
  이어.indexOf("deleteProperty(_ISJ_CATCHUP_FLAG_") < 이어.indexOf("_island_judgeHubByAddress_"),
  "일을 하다 터지면 깃발이 남아 트리거가 영영 「살아 있는 것」이 된다");
ok("못 걸었으면 깃발을 지운다", /deleteProperty\(_ISJ_CATCHUP_FLAG_\)/.test(걸기));
ok("★ 그 체계에 등록돼 있다 ★",
  /\{ fn: "partnerIslandCatchUp_", key: "_ISJ_CATCHUP_PENDING" \}/.test(푸시),
  "등록 안 하면 남의 자리 확보가 내 «살아 있는» 트리거를 치운다");
ok("깃발 이름이 두 곳에서 같다",
  /_ISJ_CATCHUP_FLAG_ = "_ISJ_CATCHUP_PENDING"/.test(판정) &&
  /key: "_ISJ_CATCHUP_PENDING"/.test(푸시),
  "이름이 어긋나면 규칙이 내 것을 못 알아본다");

/* ── ④ 내 것만 지운다 ───────────────────────────────────── */
console.log("\n─── ④ 남의 트리거는 안 건드린다 ───");
const 지우기 = 꺼내(판정, "_isj_dropCatchUpTriggers_");
ok("내 핸들러 이름인 것만 지운다",
  /getHandlerFunction\(\) === _ISJ_CATCHUP_FN_/.test(지우기),
  "이름을 안 가리면 남의 이어달리기를 끊는다");
ok("자리가 없으면 «다 쓴 것»만 치우고 다시 해 본다",
  /_pep_sweepDeadResumeTriggers_/.test(걸기),
  "트리거 20자리가 꽉 차는 일이 실제로 있었다");

/* ── ⑤ 못 걸었으면 말한다 ───────────────────────────────── */
console.log("\n─── ⑤ 못 걸었으면 말한다 ───");
ok("로그에 「손으로 눌러 주세요」를 적는다", /손으로 눌러 주세요/.test(걸기));
ok("구글 챗으로도 알린다", /_chat_sendText_/.test(걸기),
  "로그는 아무도 안 본다 — 이번 일이 그래서 몰랐다");

console.log("\n" + (틀린것 ? "✗ " : "✅ ") + 잰것 + "개 중 " + 틀린것 + "개 틀렸습니다.");
process.exit(틀린것 ? 1 : 0);
