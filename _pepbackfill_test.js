/**
 * 일일마감 — 지난 7일치 빈 송장 다시 채우기
 *
 *  > "현재 일일 마감시 이전날 송장 없는 부분에 채워지고 있나?
 *  >  이전꺼 보면 안채워지는거 같은데?"      "7일로 해줘"
 *
 *  ★ 안 채워지고 있었다 ★
 *    채우는 함수(_pep_patchArchiveTabUnmatched_)도, 그것을 부르는 함수
 *    (_pep_fillUnmatchedArchiveDay_)도, 예약 함수(_pep_scheduleUnmatchedPatch_)도
 *    다 있었는데 «예약 함수를 부르는 데가 한 군데도 없었다».
 *    그래서 속성이 안 심기고 트리거가 안 걸려 한 번도 안 돌았다.
 *    주석은 「2단계: 바로 이전 일일마감 파일의 미매칭만 …」 이라고 적혀 있었지만
 *    그 2단계가 실제로는 없었다. 오류가 아니라 «빠진 배선»이라 아무도 몰랐다.
 *
 * 실행: node _pepbackfill_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const src = fs.readFileSync(path.join(__dirname, "_partnerExclusivePush.gs"), "utf8");
function 꺼내(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

/** GAS 의 Utilities.formatDate 흉내 — 서울 기준 yyyy-MM-dd 만 쓴다 */
const Utilities = {
  formatDate: (dt) => new Date(dt.getTime() + 9 * 3600000).toISOString().slice(0, 10),
};
const ctx = { String, Number, Date, RegExp, console, Utilities, _PEP_BACKFILL_DAYS_: 7 };
vm.createContext(ctx);
vm.runInContext(꺼내("_pep_backfillDates_"), ctx);
const 날짜들 = (d) => ctx._pep_backfillDates_(d);

console.log("\n① 마감일 «앞»으로 7일");
{
  const r = 날짜들("2026-09-28");
  ok("7개다", r.length === 7, JSON.stringify(r));
  ok("★ 마감일 자신은 없다 (방금 1단계가 붙였다)", r.indexOf("2026-09-28") < 0, JSON.stringify(r));
  ok("바로 앞날부터", r[0] === "2026-09-27", r[0]);
  ok("가장 먼 날", r[6] === "2026-09-21", r[6]);
  ok("가까운 날부터 차례로", JSON.stringify(r) === JSON.stringify(
    ["2026-09-27", "2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23", "2026-09-22", "2026-09-21"]),
    JSON.stringify(r));
}

console.log("\n② 달을 넘어가도 맞다");
{
  const r = 날짜들("2026-10-02");
  ok("9월로 넘어간다", r.indexOf("2026-09-30") >= 0 && r.indexOf("2026-09-25") >= 0, JSON.stringify(r));
  const y = 날짜들("2026-01-03");
  ok("해도 넘어간다", y.indexOf("2025-12-31") >= 0, JSON.stringify(y));
}

console.log("\n③ 그은 선보다 앞은 안 본다");
{
  //  2026-09-16 «거기서부터 다시 쌓는다» — 그 앞의 무너진 기록은 안 뒤진다
  ctx._pep_afterStart_ = (s) => s >= "2026-09-16";
  const r = 날짜들("2026-09-20");
  ok("★ 9/16 앞은 빠진다", r.indexOf("2026-09-15") < 0 && r.indexOf("2026-09-16") >= 0, JSON.stringify(r));
  ok("  그만큼 짧아진다", r.length === 4, String(r.length));
  delete ctx._pep_afterStart_;
}

console.log("\n④ 이상한 입력에 안 터진다");
{
  ok("빈 값 → []", 날짜들("").length === 0);
  ok("null → []", 날짜들(null).length === 0);
  ok("날짜 꼴이 아니면 → []", 날짜들("2026/09/28").length === 0 && 날짜들("오늘").length === 0);
}

console.log("\n⑤ ★ 배선 — 마감이 실제로 예약을 부른다 ★");
{
  const 부름 = (src.match(/_pep_scheduleUnmatchedPatch_\(/g) || []).length;
  //  정의 1 + 부르는 곳 1
  ok("★ 부르는 데가 생겼다 (여태 0이었다)", 부름 >= 2, String(부름));
  ok("  마감 끝에서 부른다", /_pep_backfillDates_\(archiveDate \|\| targetDateStr/.test(src));
  ok("  날짜를 쉼표로 이어 넘긴다", /_pep_scheduleUnmatchedPatch_\(_bfDates\.join\(","\)\)/.test(src));

  /*  ★ catch 밖에서 부른다 ★  오늘 마감이 넘어져도 어제·그제 파일의 빈 송장은
      채울 수 있다 — 서로 다른 일이다. */
  //  같은 문구가 다른 함수에도 있다 — 부르는 자리 «바로 앞»의 것을 본다
  //  정의(_pep_backfillDates_(archiveDateStr)) 가 접두로 걸린다 — 「 ||」 까지 본다
  const iCall = src.indexOf("_pep_backfillDates_(archiveDate ||");
  const iCatch = src.lastIndexOf('Logger.log("[UNIFIED_ARCHIVE] 오류: " + e.message);', iCall);
  ok("★ 마감이 실패해도 예약한다 (catch 밖)", iCall > iCatch && iCatch > 0, iCall + " > " + iCatch);

  ok("  곁다리라 터져도 마감 결과를 안 깬다", /미매칭 재채움 예약 실패/.test(src));
  ok("되돌아보는 날 수는 한 곳에서 정한다", /var _PEP_BACKFILL_DAYS_ = 7;/.test(src));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
