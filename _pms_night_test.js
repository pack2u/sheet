/**
 * 대리판매 마감 — 밤에 스스로 시작한다
 *
 *  > "그럼 이기능을 어떻게 쓰라는거지?"
 *
 *  17개 파일을 배치로 나눠 도니 끝까지 몇십 분이 걸린다. 사람이 누르고
 *  기다리면 그동안 아무것도 못 하고, 끝났는지도 모른다. 쓸 수가 없다.
 *  밤 22시 통합마감이 «시작만» 시키고, 아침에 Chat 알림으로 결과만 본다.
 *
 *  지켜야 할 것
 *    · 22시 작업은 «시작만» 한다 — 배치를 돌리면 6분 예산을 먹는다
 *    · 이미 돌고 있으면 건드리지 않는다 (두 번 돌면 같은 파일을 두 번 옮긴다)
 *    · 깃발만 남고 멈춰 있으면 처음부터 다시 건다
 *    · 새 트리거를 만들지 않는다 — 재개 트리거는 일회용이라 자리를 안 먹는다
 *    · 실패해도 일일마감은 계속된다
 *
 * 실행: node _pms_night_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const pms = fs.readFileSync("_partnerMonthlySettle.gs", "utf8");
const web = fs.readFileSync("_partnerWebApp.gs", "utf8");

console.log("");
console.log("[시작 함수] 큐만 담고 빠진다");
check("★ pmsStartBackground 가 있다", pms.indexOf("function pmsStartBackground() {") >= 0, true);
check("★ 배치를 안 돌린다 (_pms_core_ 를 안 부른다)",
  pms.slice(pms.indexOf("function pmsStartBackground"),
            pms.indexOf("function partnerArchiveToMonthlySettle")).indexOf("_pms_core_") >= 0, false);
check("큐를 저장한다", pms.indexOf("_pms_saveResumeState_({") >= 0, true);
check("재개 트리거를 건다", pms.indexOf("var ok = _pms_scheduleResume_(5 * 1000);") >= 0, true);
check("예약 실패면 큐를 되돌린다", pms.indexOf("    _pms_clearResumeState_();\n    return '예약 실패") >= 0 ||
  pms.indexOf("_pms_clearResumeState_();\r\n    return '예약 실패") >= 0, true);

console.log("");
console.log("[두 번 돌지 않는다]");
check("★ 이미 돌고 있으면 건드리지 않는다",
  pms.indexOf("if (st.돌고있나) return '이미 진행 중") >= 0, true);
check("★ 멈춰 있으면 처음부터 다시",
  pms.indexOf("//  깃발만 남고 멈춰 있다 — 처음부터 다시 건다") >= 0, true);
check("돌고 있는지는 트리거로 본다 (_pms_runState_)",
  pms.indexOf("var st = _pms_runState_();") >= 0, true);

console.log("");
console.log("[밤에 부르지 «않는다»]  ★ 2026-09-16 되돌림 ★");
/*  9/15 에 「일일마감이 대리판매 마감을 시작한다」를 넣었다가 하루 만에 뺐다.

    ① 22:00 에 이미 제 트리거가 있다 (_trigger_monthlySettle_). 두 번 돈다.
    ② 시작 절차가 임시기록의 «송장 찍힌 행»을 지운다. 그런데 바로 뒤에 도는
       일일마감이 그 임시기록을 원천으로 읽는다. 20:00 에 비우고 20:00 에
       읽으니 대리공급 송장이 통째로 빠졌다 — 「마감 제대로 안됨」이 이것이다.

    그래서 이 검사는 «없음»을 지킨다. 다시 넣으면 여기서 걸린다. */
check("★ 일일마감은 대리판매 마감을 시작하지 않는다",
  web.indexOf("pmsStartBackground()") < 0, true);
check("왜 뺐는지가 코드에 적혀 있다",
  web.indexOf("여기서 대리판매 마감을 시작시키지 않는다") >= 0, true);
check("대리판매 마감은 22:00 제 트리거로 돈다",
  web.indexOf(mkKey()) >= 0, true);
console.log("");
console.log("[완료 알림] 끝나면 사람이 안다");
check("★ 백그라운드로 끝나면 Chat 카드를 보낸다",
  pms.indexOf('_chat_sendCard_("✅ 대리판매 마감 완료"') >= 0, true);
check("보냈는지 확인한다 (_chat_checkSend_)",
  fs.readFileSync("_partnerChatNotify.gs", "utf8").indexOf("_chat_checkSend_(res") >= 0, true);

console.log("");
console.log("[트리거] 자리를 늘리지 않는다");
check("★ 새 정규 트리거를 안 만든다 (everyDays 없음)",
  pms.slice(pms.indexOf("function pmsStartBackground"),
            pms.indexOf("function partnerArchiveToMonthlySettle")).indexOf("everyDays") >= 0, false);
check("재개 트리거는 일회용(after)",
  pms.indexOf("ScriptApp.newTrigger(_PMS_RESUME_TRIGGER_).timeBased().after(") >= 0, true);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);


/** 스케줄 표의 22:00 대리판매 마감 줄을 찾는 열쇠 */
function mkKey() { return "_trigger_monthlySettle_"; }