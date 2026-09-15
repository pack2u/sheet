/**
 * 「일회용 트리거 걷어내기」가 정규 트리거를 지우지 못하게 막는다
 *
 *  > "오늘부터 알림이 안오네..확인해줘"
 *
 *  2026-09-15 에 트리거 20개 한도를 풀려고 _pt_reclaimOneShotTriggers_ 를
 *  넣으면서, 지워도 되는 「일회용」 목록에 여덟 개를 적었다. 그중 넷이
 *  «매일 도는» 정규 트리거였다 —
 *    _prv_scheduled_ 21:30 반품 미러 · _pbv_scheduled_ 21:40 보드 미러
 *    _pep_unifiedDailyArchiveScheduled_ 22:00 통합 마감
 *    _piv_scheduled_ 22:10 구매입력 미러
 *  지워졌으면 밤일이 서고, 거기서 나가는 Chat 알림도 같이 끊긴다.
 *
 *  ★ 사람의 주의력에 기대지 않는다 ★
 *    목록에 이름을 적는 일은 앞으로도 생긴다. 그때마다 「이게 일회용이었나」를
 *    기억해야 한다면 언젠가 또 틀린다. 소스를 뒤져서 기계가 막는다.
 *
 *  규칙: 목록에 적힌 핸들러는 «.after(…)» 로만 만들어져야 한다.
 *        everyDays / atHour 로 한 번이라도 만들어지면 실패.
 *
 * 실행: node _pt_oneshot_test.js
 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(label, ok, 덧붙임) {
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + (ok ? "" : "   " + (덧붙임 || "")));
}

//  ── 목록을 읽는다 ──
const settle = fs.readFileSync("_partnerMonthlySettle.gs", "utf8");
const m = settle.match(/var\s+_PT_ONESHOT_HANDLERS_\s*=\s*\[([\s\S]*?)\]\s*;/);
if (!m) { console.error("_PT_ONESHOT_HANDLERS_ 를 못 찾음"); process.exit(1); }
const 목록 = (m[1].match(/"([^"]+)"/g) || []).map((x) => x.replace(/"/g, ""));

//  ── 프로젝트의 모든 .gs 를 한 덩어리로 ──
const 본문 = fs.readdirSync(".")
  .filter((f) => /\.gs$/.test(f))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

/**
 * 그 핸들러를 만드는 newTrigger(…) 뒤 220자를 모두 모은다.
 *
 * ★ 정규식을 안 쓴다 ★
 *   처음엔 정규식으로 짰는데 따옴표·역슬래시가 한 겹 벗겨져 아무것도
 *   못 잡고 «전부 통과»로 보였다. 시험이 조용히 거짓말하면 없느니만 못하다.
 *   글자를 그대로 찾는다 — 벗겨질 것이 없다.
 */
function 만드는꼴(fn) {
  const out = [];
  const 조각 = 본문.split("newTrigger(");
  for (let i = 1; i < 조각.length; i++) {
    const 뒤 = 조각[i];
    //  newTrigger( 바로 뒤에 그 이름이 (따옴표째) 오는가
    const 머리 = 뒤.replace(/^[s]+/, "").slice(0, fn.length + 2);
    if (머리 !== '"' + fn + '"' && 머리 !== "'" + fn + "'") continue;
    out.push(뒤.slice(0, 220));
  }
  return out;
}
console.log("");
console.log("[목록] 비어 있지 않다");
check("일회용 목록이 있다 (" + 목록.length + "개)", 목록.length > 0);

console.log("");
console.log("[안전] 목록의 핸들러는 «.after()» 로만 만들어진다");
목록.forEach(function (fn) {
  const 꼴 = 만드는꼴(fn);
  if (!꼴.length) {
    check(fn + " — 이 프로젝트에서 안 만든다 (외부/동적)", true);
    return;
  }
  const 정규 = 꼴.filter((t) => /everyDays|atHour|everyHours|everyMinutes|onOpen|onEdit/.test(t));
  check(fn + " — 일회용만", 정규.length === 0,
    "★ 매일/주기 트리거로도 만들어진다: " + (정규[0] || "").replace(/\s+/g, " ").slice(0, 90));
});

console.log("");
console.log("[안전] 밤일 트리거는 목록에 없어야 한다");
[["_prv_scheduled_", "21:30 반품 미러"],
 ["_pbv_scheduled_", "21:40 보드 미러"],
 ["_pep_unifiedDailyArchiveScheduled_", "22:00 통합 마감"],
 ["_piv_scheduled_", "22:10 구매입력 미러"]].forEach(function ([fn, 설명]) {
  check("★ " + 설명 + " (" + fn + ") 는 목록에 없다", 목록.indexOf(fn) < 0,
    "★ 목록에 있다 — 걷어내기가 이걸 지운다");
});

console.log("");
console.log("[동작] 걷어내는 함수가 그 목록만 본다");
check("_PT_ONESHOT_HANDLERS_ 로만 고른다",
  settle.indexOf("_PT_ONESHOT_HANDLERS_.indexOf(h) < 0) continue;") >= 0);
check("지금 돌고 있는 일은 건너뛴다",
  settle.indexOf("if (빼고 && h === 빼고) continue;") >= 0);

console.log("");
console.log("[자리] 이어달리기가 쓸 자리가 남아 있다");
/*  ★ 구글은 스크립트당 트리거 20개까지 준다 ★

    2026-09-16 아침 사장님 화면: 「트리거 총합: 20 / 20개 제한 — 트리거 꽉참」.
    꽉 차면 .after() 재개 트리거를 «만들 수 없다». 마감·월정산·재매칭·푸시가
    6분 한도에 걸려 멈춰도 「1분 뒤 저절로 이어집니다」가 한 번도 안 걸리고
    그냥 끝났다. 오류도 안 난다 — 그래서 아무도 몰랐다.

    그래서 정규 스케줄은 «18개까지»만 둔다. 둘은 이어달리기 몫이다.
    스케줄을 늘리고 싶으면 먼저 둘을 하나로 묶어라 —
    17:00(구매입력+동기화) · 12:30(동기화+허브) · 21:30(v2 미러 셋)이 본보기다. */
const 웹앱 = fs.readFileSync(path.join(__dirname, "_partnerWebApp.gs"), "utf8");
const 표시작 = 웹앱.indexOf("var _ALL_SCHEDULED_TRIGGERS_ = [");
check("스케줄 표를 찾았다", 표시작 >= 0);
const 표몸 = 웹앱.slice(표시작, 웹앱.indexOf("];", 표시작));
const 줄수 = (표몸.match(/\{\s*fn:/g) || []).length;
console.log("      정규 스케줄 " + 줄수 + "개 · 남는 자리 " + (20 - 줄수) + "개");
check("정규 스케줄은 18개 이하 (이어달리기 몫 2자리를 남긴다)", 줄수 <= 18, 줄수 + "개");
check("표가 비어 있지 않다", 줄수 >= 10, 줄수 + "개");

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
