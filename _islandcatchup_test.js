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

/* ── ⑥ 섬 줄은 «행 전체»가 보라색 ─────────────────────────
     > "현재 도서산간비만 보라색인데 행 전체가 보라색으로 수정해줘"

     여태 조건부 서식 범위가 「A2:<도서산간비 칸>5000」이라 그 칸 «뒤»의 열
     (택배사 등)은 안 칠해졌다. 눈으로는 금액 칸만 보라색으로 보인다.
     그리고 「같은 칸을 보는 규칙이 있으면 그냥 돌아간다」였던 탓에, 좁던
     옛 규칙이 남은 시트는 코드를 고쳐도 영영 안 넓어졌다.                */
console.log("\n─── ⑥ 행 전체 칠하기 (직접) ───");
const 배송 = fs.readFileSync(path.join(__dirname, "_partnerIslandShipping.gs"), "utf8");

/*  ★ 조건부 서식을 접었다 ★  (2026-10-06)
    > "직접 칠하는 쪽으로 바꿔줘"
    같은 일로 세 번 걸렸다 — 범위가 금액 칸에서 끊겼고, 옛 규칙을 안 갈아
    끼웠고, 업체 시트가 아예 안 열렸다. 게다가 «고쳐졌는지 확인할 길이 없다» —
    서식 규칙은 값이 아니라 읽어 볼 수가 없어 매번 사람에게 물어야 했다.   */
const 칠하기 = 꺼내(배송, "_island_paintIslandRows_");
ok("줄 전체를 칠한다 (A부터 마지막 열까지)",
  /"A" \+ \(i \+ 2\) \+ ":" \+ 끝자 \+ \(i \+ 2\)/.test(칠하기),
  "금액 칸만 칠하면 처음 문제로 되돌아간다");
ok("그 시트의 지금 너비를 쓴다", /getLastColumn\(\)/.test(칠하기) && /끝자/.test(칠하기));
ok("도서산간비 칸보다 좁아지지 않는다", /Math\.max\(tab\.getLastColumn\(\), feeCol\)/.test(칠하기));
ok("★ 금액이 «있는 줄은 다» 칠한다 ★",
  /for \(var i = 0; i < feeVals\.length; i\+\+\)/.test(칠하기) &&
  /\(Number\(feeVals\[i\]\[0\]\) \|\| 0\) > 0/.test(칠하기),
  "새로 붙은 줄만 칠하면 전에 붙은 줄이 영영 안 바뀐다");
ok("한 번에 칠한다 (줄마다 왕복하지 않는다)", /getRangeList\(줄들\)\.setBackground/.test(칠하기));

const 걷기 = 꺼내(배송, "_island_dropOurConditionalRule_");
ok("★ 옛 조건부 서식을 걷는다 ★", /setConditionalFormatRules\(남길것\)/.test(걷기),
  "남겨 두면 규칙이 직접 칠한 것을 덮어 금액 칸만 보라색으로 보인다");
ok("사람이 건 규칙은 안 건드린다", /if \(우리것\) 뗀것\+\+; else 남길것\.push/.test(걷기));
ok("옛 조건부 서식 함수는 지웠다",
  배송.indexOf("_island_addConditionalFormatRule_") < 0,
  "남겨 두면 다음 사람이 그것을 쓴다");

/*  ★ 세 시트에 다 닿아야 한다 ★ 허브(판정) · 허브(원장 받침) · 업체 시트.
    하나라도 빠지면 그 시트만 옛 모양으로 남는다 — 이번에 실제로 그랬다.  */
console.log("\n─── ⑦ 세 자리에 다 닿는가 ───");
ok("허브(판정)에서 칠한다", /_island_paintIslandRows_\(hubTab, feeCol, feeVals\)/.test(판정));
ok("허브(판정)에서 옛 규칙을 걷는다", /_island_dropOurConditionalRule_\(hubTab, feeCol\)/.test(판정));
ok("허브(원장 받침)에서도 칠한다", /_island_paintIslandRows_\(hubTab, feeCol, feeArr\)/.test(배송));
ok("업체 시트에서도 칠한다", /_island_paintIslandRows_\(orderTab, feeCol, oColArr\)/.test(배송));

const 적용 = 꺼내(배송, "_island_applyToPartnerSheets_");
const 칠자리 = 적용.indexOf("_island_paintIslandRows_");
const 조건자리 = 적용.indexOf("if (changedRows.length > 0)");
ok("★ 업체 시트는 changedRows 와 상관없이 칠한다 ★",
  칠자리 >= 0 && 조건자리 >= 0 && 칠자리 > 조건자리 &&
  적용.slice(조건자리).indexOf("_island_paintIslandRows_") >
    적용.slice(조건자리).indexOf("result.applied += changedRows.length;"),
  "조건문 «안»에 두면 금액이 이미 적힌 시트는 영영 안 칠해진다");

/*  ★ 업체 시트까지 닿아야 한다 ★ 그 업체가 «목록에» 들어야 시트가 열린다.  */
ok("★ 금액이 이미 붙은 업체도 목록에 넣는다 ★",
  /Number\(feeVals\[fr\]\[0\]\)[\s\S]{0,120}업체\[vn2\] = true/.test(판정),
  "새로 판정된 섬이 없는 날에는 업체 시트가 아예 안 열린다");
ok("그 목록이 업체 시트 적용으로 간다",
  /var 업체들 = Object\.keys\(업체\);[\s\S]{0,160}_island_applyToPartnerSheets_/.test(판정));

console.log("\n" + (틀린것 ? "✗ " : "✅ ") + 잰것 + "개 중 " + 틀린것 + "개 틀렸습니다.");
process.exit(틀린것 ? 1 : 0);
