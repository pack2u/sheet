/**
 * 대리판매 마감이 하루에 두 번 돌지 않는다
 *
 *  2026-09-16 · 완료 카드가 22:20 · 22:30 두 번 왔다.
 *    22:20  이동 110 / 삭제 90 / 유지 31
 *    22:30  이동   0 / 삭제  0 / 유지 31
 *
 *  두 번째가 0건이라 이번엔 무해했다. 다만 그 사이에 송장이 더 들어왔다면
 *  «두 번 이동»했을 수도 있다.
 *
 *  ★ 막는 장치가 둘 있었는데 둘 다 샜다 ★
 *    _PMS_BATCH_RUNNING_     6분 창. 22:20 에 끝나며 지워져 22:30 은 통과
 *    _pms_clearResumeState_  재개 트리거는 지운다 — 이 길은 아니었다
 *  즉 22:00 트리거가 실제로 두 번 발화했거나 트리거가 둘이었다.
 *  까닭을 못 짚어도 «두 번 도는 것»은 막을 수 있다.
 *
 * 실행: node _settledup_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}
function grab(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const 코드만 = (s) => s.split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const pms = fs.readFileSync("_partnerMonthlySettle.gs", "utf8");
const web = fs.readFileSync("_partnerWebApp.gs", "utf8");

console.log("\n[1] ★ 오늘 이미 끝냈으면 안 돈다");
{
  /*  가짜 저장소로 실제 동작을 돌려 본다 — 글자만 보면 «부르기는 하는데
      값이 안 맞는» 경우를 못 잡는다.  */
  const ctx = { __store: {} };
  ctx.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return ctx.__store[k] || null; },
        setProperty: function (k, v) { ctx.__store[k] = String(v); },
        deleteProperty: function (k) { delete ctx.__store[k]; }
      };
    }
  };
  ctx.Utilities = {
    formatDate: function () { return ctx.__today; }
  };
  vm.createContext(ctx);
  vm.runInContext(pms.slice(pms.indexOf("var _PMS_DONE_DATE_KEY_"),
    pms.indexOf(";", pms.indexOf("var _PMS_DONE_DATE_KEY_")) + 1), ctx);
  ["_pms_doneToday_", "_pms_markDoneToday_"].forEach((n) => vm.runInContext(grab(pms, n), ctx));

  ctx.__today = "2026-09-16";
  check("처음에는 «안 끝냈다»", vm.runInContext("_pms_doneToday_()", ctx), false);
  vm.runInContext("_pms_markDoneToday_()", ctx);
  check("★ 끝내고 나면 «끝냈다»", vm.runInContext("_pms_doneToday_()", ctx), true);

  ctx.__today = "2026-09-17";
  check("★ 날이 바뀌면 다시 돈다", vm.runInContext("_pms_doneToday_()", ctx), false);

  /*  못 읽으면 «모른다» — 막지 않는다. 막아 버리면 마감이 영영 안 돈다.  */
  ctx.PropertiesService = { getScriptProperties: function () { throw new Error("권한 없음"); } };
  check("★ 못 읽으면 막지 않는다", vm.runInContext("_pms_doneToday_()", ctx), false);
}

console.log("\n[2] ★ 자동 실행만 막는다 — 손으로 누르는 길은 안 막는다");
{
  const 몸 = 코드만(grab(pms, "partnerArchiveToMonthlySilent_"));
  check("★ 맨 앞에서 본다", 몸.indexOf("_pms_doneToday_()") >= 0, true);
  check("★ 조용히 가지 않는다 (로그에 남긴다)",
    몸.indexOf("오늘 이미 마감 완료") >= 0, true);
  /*  사람이 누르는 메뉴는 이 함수를 안 거친다 — 일부러 누른 것이다.  */
  const 메뉴 = grab(pms, "partnerArchiveToMonthlySettle");
  check("★ 메뉴는 _pms_doneToday_ 를 안 본다", 메뉴.indexOf("_pms_doneToday_") < 0, true);
}

console.log("\n[3] ★ 끝낼 때 도장을 찍는다");
{
  const 몸 = 코드만(grab(pms, "_pms_runBatch_"));
  check("★ 완료할 때 적는다", 몸.indexOf("_pms_markDoneToday_()") >= 0, true);
  const i도장 = 몸.indexOf("_pms_markDoneToday_()");
  const i카드 = 몸.indexOf("대리판매 마감 완료");
  check("★ 카드를 보내기 «전»에 적는다", i도장 >= 0 && i도장 < i카드, true);
}

console.log("\n[4] ★ 설치할 때 «같은 함수 겹침»을 센다");
{
  const 몸 = 코드만(grab(web, "setupAllScheduledTriggers"));
  check("★ 설치 뒤 실제 트리거를 다시 센다",
    몸.indexOf("ScriptApp.getProjectTriggers()") >= 0, true);
  check("★ 시간 기반만 센다", 몸.indexOf("ScriptApp.EventType.CLOCK") >= 0, true);
  /*  표에 같은 함수를 여러 시각에 걸어 둔 것은 정상이다 (발주 수집 3회전).
      표가 기대하는 수보다 많을 때만 겹침이다.  */
  check("★ 표가 기대하는 수와 견준다", 몸.indexOf("Math.max(1, 기대)") >= 0, true);
  check("★ 확인 창에 적는다", web.indexOf("같은 함수가 여러 개 걸렸습니다") >= 0, true);
  check("★ 없으면 «없음»이라고 적는다", web.indexOf("같은 함수 겹침: 없음") >= 0, true);
  check("★ 챗 카드에도 적는다", web.indexOf('{ label: "같은 함수 겹침"') >= 0, true);
  check("★ 못 세면 그렇게 말한다", 몸.indexOf("세지 못했습니다") >= 0, true);
}

console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
