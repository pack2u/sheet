/**
 * 자동으로 돌아야 할 것이 사람 손을 기다리지 않는가
 *
 *  > "자동으로 되야지 매번 사람이 다 눌러줄꺼면 자동화를 왜하는지;;"
 *  > "책임 지기 싫어서 사람이 누르게 만드는거야?"   (2026-09-16)
 *
 *  맞는 지적이었다. 이날 하루에만 네 번을 「메뉴를 눌러 주세요」로 넘겼다 —
 *  전체 수집 · 미매칭 소급 보강 · 그날 판매현황 메우기 · 통합 트리거 설치.
 *  그중 셋은 코드가 스스로 할 수 있는 일이었다.
 *
 *  지켜야 할 것
 *    · 하루 첫 수집은 «전체»로 돈다 — 빠진 파일이 그날 안에 저절로 돌아온다
 *    · 스케줄 표에 있는데 안 걸린 트리거는 스스로 건다
 *    · 다만 «지우는 일»은 스스로 하지 않는다 — 되돌릴 수 없다
 *    · 스무 자리를 넘기지 않는다 — 꽉 차면 이어달리기가 막힌다
 *
 * 실행: node _autopilot_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const orders = fs.readFileSync("_partnerOrders.gs", "utf8");
const mirror = fs.readFileSync("_partnerBoardV2Mirror.gs", "utf8");

console.log("\n[1] 하루 첫 수집은 «전체»로 돈다");
{
  check("날짜로 하루 한 번을 가린다",
    orders.indexOf("LAST_FULL_COLLECT_DATE") >= 0, true);
  check("★ 전체 수집으로 돌린다",
    /LAST_FULL_COLLECT_DATE'\) !== _오늘_\) \{[\s\S]{0,80}isForce = true;/.test(orders), true);
  check("★ 같은 날 두 번은 안 한다 (오후 회전은 스마트)",
    /isForce = true;[\s\S]{0,140}setProperty\('LAST_FULL_COLLECT_DATE', _오늘_\)/.test(orders), true);
  check("실패해도 수집은 계속한다", /catch \(eFull\) \{\}/.test(orders), true);
  check("★ 이미 전체로 정해졌으면 사람에게 안 묻는다",
    orders.indexOf("if (ui && !opt_noWriteBack && !isForce) {") >= 0, true);
}

console.log("\n[2] 빠진 트리거는 스스로 건다");
{
  check("★ 스케줄 표 «전체»를 본다",
    mirror.indexOf("_ALL_SCHEDULED_TRIGGERS_") >= 0, true);
  check("표를 못 읽어도 미러는 챙긴다",
    /\? _ALL_SCHEDULED_TRIGGERS_[\s\S]{0,140}_prv_scheduled_/.test(mirror), true);
  check("이미 걸린 것은 안 건다", mirror.indexOf("if (have[s.fn])") >= 0, true);
  check("걸었을 때만 알린다", /if \(out\.건것\.length\)/.test(mirror), true);
}

console.log("\n[3] ★ 스스로 «지우지» 않는다");
{
  /*  지우는 것은 되돌릴 수 없다. 9/15 에 「일회용 걷어내기」가 매일 도는
      트리거 넷을 지울 뻔했다 — 그 교훈이다.  */
  check("표에 없는 것을 모으긴 한다", mirror.indexOf("var 표에없음 = []") >= 0, true);
  /*  다른 함수(옛 21:40 보드 트리거 청소)에는 deleteTrigger 가 있어도 된다.
      스스로 도는 _pt_ensureMirrorTriggers_ «안»에 없어야 한다는 뜻이다. */
  const 자동몸 = (function () {
    const s = mirror.indexOf("function _pt_ensureMirrorTriggers_()");
    let d = 0, seen = false;
    for (let k = s; k < mirror.length; k++) {
      if (mirror[k] === '{') { d++; seen = true; }
      else if (mirror[k] === '}') { d--; if (seen && d === 0) return mirror.slice(s, k + 1); }
    }
    return "";
  })();
  check("자동으로 도는 함수를 찾았다", 자동몸.length > 200, true);
  check("★ 그 안에 지우는 코드가 없다", /deleteTrigger/.test(자동몸), false);
  check("★ 알리기만 한다", mirror.indexOf("(지우지 않았습니다)") >= 0, true);
}

console.log("\n[4] ★ 스무 자리를 넘기지 않는다");
{
  /*  꽉 차면 .after 재개 트리거를 못 만든다 — 마감·월정산·재매칭·푸시의
      이어달리기가 통째로 죽는다.  */
  check("남은 자리를 센다", mirror.indexOf("var 남은자리 = 20 - all.length;") >= 0, true);
  check("★ 둘 미만이면 안 건다", /if \(남은자리 < 2\) \{/.test(mirror), true);
  check("못 걸었다고 말한다", mirror.indexOf("트리거 자리가 없습니다") >= 0, true);
  check("건 만큼 줄인다", mirror.indexOf("남은자리--;") >= 0, true);
}

console.log("\n[5] 낮·밤 두 번 돈다");
{
  const web = fs.readFileSync("_partnerWebApp.gs", "utf8");
  check("낮(12:30 묶음)에서 부른다",
    /_trigger_syncDb_[\s\S]{0,400}_pt_ensureMirrorTriggers_\(\)/.test(web), true);
  check("밤(20:00 마감)에서도 부른다",
    /_pep_unifiedDailyArchiveScheduled_[\s\S]{0,300}_pt_ensureMirrorTriggers_\(\)/.test(web), true);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
