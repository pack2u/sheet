/* 비영업일 판정 검증 (로컬 검증용)
 *
 * 이 판정이 틀리면 두 방향으로 다 나쁘다.
 *   · 영업일을 비영업일로 보면  → 그날 마감이 안 돌고, 통합조회에서 하루가 빈다
 *   · 비영업일을 영업일로 보면  → 없는 파일을 드라이브에서 찾느라 시간을 버린다
 *                                (그 검색이 재생성 5분의 큰 몫이었다)
 *
 * 그래서 경계값을 못으로 박는다. 특히 **모르는 값은 영업일로 본다** —
 * 빼먹는 쪽이 더 나쁘기 때문이다.
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (got !== undefined ? "  → " + got : "")); }
};

/* _partnerHelpers.gs 에서 필요한 것만 떼어 온다 */
const src = fs.readFileSync(path.join(__dirname, "_partnerHelpers.gs"), "utf8");
const ctx = {
  String, Date, parseInt,
  // 임시공휴일은 스크립트 속성에서 읽는다 — 여기서는 비워 둔다
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
  Utilities: { formatDate: () => "" },
  console,
};
vm.createContext(ctx);

function take(startsWith, endsBefore) {
  const a = src.indexOf(startsWith);
  const b = src.indexOf(endsBefore, a);
  if (a < 0 || b < 0) throw new Error("못 찾음: " + startsWith);
  return src.slice(a, b);
}
vm.runInContext(take("var _PT_KR_HOLIDAYS_ = {", "function _pt_koreanHolidayName_"), ctx);
vm.runInContext(take("function _pt_koreanHolidayName_", "function _pt_isNonBusinessDate_"), ctx);
vm.runInContext(take("function _pt_isNonBusinessDate_", "function _pt_isWeekendBlackout_"), ctx);

const f = ctx._pt_isNonBusinessDate_;

console.log("\n[주말]");
ok("2026-09-05 토요일", f("2026-09-05") === true);
ok("2026-09-06 일요일", f("2026-09-06") === true);
ok("2026-09-04 금요일은 영업일", f("2026-09-04") === false);
ok("2026-09-07 월요일은 영업일", f("2026-09-07") === false);

console.log("\n[공휴일]");
ok("2026-09-24 추석 연휴", f("2026-09-24") === true);
ok("2026-09-25 추석", f("2026-09-25") === true);
ok("2026-10-03 개천절", f("2026-10-03") === true);
ok("2026-10-05 개천절 대체공휴일", f("2026-10-05") === true);
ok("2026-12-25 성탄절", f("2026-12-25") === true);
ok("2026-08-17 광복절 대체공휴일", f("2026-08-17") === true);

console.log("\n[공휴일 바로 앞뒤는 영업일]");
ok("2026-10-02 금요일", f("2026-10-02") === false);
ok("2026-10-06 화요일", f("2026-10-06") === false);

console.log("\n[표기 형식]");
ok("하이픈 없이도 읽는다", f("20260905") === true);
ok("하이픈 있어도 읽는다", f("2026-09-05") === true);

console.log("\n[모르는 값은 영업일로 본다 — 빼먹는 쪽이 더 나쁘다]");
ok("빈 문자열", f("") === false);
ok("null", f(null) === false);
ok("undefined", f(undefined) === false);
ok("자릿수가 모자란 값", f("2026-9-5") === false);
ok("날짜가 아닌 글자", f("어제") === false);

console.log("\n[실제로 빠졌던 날 — 2026-08-29]");
/* 통합조회에 8/29 가 통째로 없었다. 토요일이라 마감을 안 돌린 것이 맞고,
   그래서 앞으로는 찾아보지도 않는다. */
ok("2026-08-29 는 토요일", f("2026-08-29") === true);

console.log("\n" + (fail ? `실패 ${fail}건 / 통과 ${pass}건` : `모두 통과 (${pass}건)`));
process.exit(fail ? 1 : 0);
