/**
 * 일일마감이 같은 자료를 두 번 쌓지 않는가.
 * 2026-09-09
 *
 *   node _dailyarchive_dedupe_test.js
 *
 * ★ 왜 있나 ★
 *   2026-09-07 에 Supabase 일일마감이 950행이어야 하는데 1,361행이었다.
 *   411행이 더 있었고, 사장님이 시트에서 지우셔도 그대로 남아 있었다.
 *   원인이 두 겹이었다:
 *     ① 예약 마감이 「최근 7일에 미생성 날이 있으면」 당일 마감이 이미 있어도
 *        다시 돌면서 **오늘 자료를 오늘 파일 끝에 한 번 더** 붙였다.
 *     ② v2 미러가 중복 방지 키 없이 그냥 INSERT 해서 그것이 그대로 쌓였다.
 *   둘 다 고쳤다. 이 시험은 **그 고침이 지워지지 않게** 지킨다.
 *
 *   화면이 없는 코드라 DOM 시험을 못 한다. 대신 「그 자리에 그 규칙이 있는가」를
 *   글자로 확인한다 — 되돌려지면 여기서 걸린다.
 */
const fs = require("fs");
const R = (f) => fs.readFileSync(__dirname + "/" + f, "utf8");
const push = R("_partnerExclusivePush.gs");
const webapp = R("_partnerWebApp.gs");
const mirror = R("_partnerSupabaseV2Mirror.gs");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  OK " + name); }
  else { fail++; console.log("  NG " + name + (got !== undefined ? "  → " + got : "")); }
};

console.log("\n[1] ★ 이미 기록된 날짜는 다시 안 쓴다 ★");
ok("마감이 skipDates 를 받는다",
   /function _pep_archiveUnifiedDaily_\(targetDateStr, opts\)/.test(push));
ok("날짜 반복문에서 건너뛴다",
   /opts && opts\.skipDates && opts\.skipDates\.indexOf\(dKey\) >= 0/.test(push));
ok("건너뛴 것을 로그에 남긴다 (조용히 넘어가지 않는다)",
   /은 이미 기록됨 → 건너뜀/.test(push));
ok("건너뛴 날짜 수를 센다", /skippedExistingDates/.test(push));

console.log("\n[2] 예약 마감이 「당일은 건너뛰라」고 알려준다");
ok("당일이 있으면 skipDates 를 넘긴다",
   /archOpts = \{ skipDates: \[todayStr\] \}/.test(webapp));
ok("그대로 마감에 전달한다",
   /_pep_archiveUnifiedDaily_\(todayStr, archOpts\)/.test(webapp));
ok("★ 당일이 없으면 아무것도 안 건너뛴다 ★",
   /var archOpts = null;/.test(webapp));

console.log("\n[3] DB 로도 안 보낸다");
/* 시트만 막고 DB 로 보내면 미러가 그 날짜를 다시 갈아 끼운다.
   두 번째 실행이 (임시기록이 비워진 뒤라) 더 적은 행을 만들면
   멀쩡한 자료를 적은 것으로 덮어쓴다. */
ok("건너뛴 날짜 행을 걸러낸다",
   /var syncRows = _skip_\.length[\s\S]{0,160}_skip_\.indexOf\(_pep_rowDate_\.get\(r\)\) < 0/.test(push));
ok("★ 원본 matchedRows 를 갈아치우지 않는다 ★",
   /var dbRows = syncRows\.map/.test(push) && !/matchedRows = matchedRows\.filter/.test(push));

console.log("\n[4] ★ 행이 자기 날짜를 들고 간다 ★");
/* 전에는 미러가 모든 행을 「오늘」로 찍었다. 소급 마감이 돌면
   지난 날짜 자료가 오늘 날짜로 들어갔다. */
ok("행→날짜 지도를 만든다", /var _pep_rowDate_ = new Map\(\);/.test(push));
ok("행을 담을 때 같이 적는다", /_pep_rowDate_\.set\(row, dateKey\)/.test(push));
ok("DB 행에 archive_date 를 싣는다",
   /archive_date: _pep_rowDate_\.get\(row\) \|\| archiveDate/.test(push));

console.log("\n[5] ★ 미러는 그 날짜를 통째로 갈아 끼운다 ★");
ok("지우는 함수가 있다", /function _sbv2_deleteDay_\(dateStr\)/.test(mirror));
ok("delete 로 그 날짜만 지운다",
   /daily_archive\?archive_date=eq\./.test(mirror) && /method: "delete"/.test(mirror));
ok("날짜별로 나눠 처리한다", /var byDate = \{\};/.test(mirror));
ok("행이 들고 온 날짜를 먼저 쓴다",
   /archive_date: _sbv2_ymd_\(row\.archive_date\) \|\| today/.test(mirror));
ok("★ 지우기가 실패하면 넣지 않는다 ★",
   /if \(!del\.ok\) \{[\s\S]{0,200}continue;/.test(mirror));
ok("날짜 모양이 아니면 안 받는다 (엉뚱한 날을 지우지 않게)",
   /function _sbv2_ymd_/.test(mirror) && /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(mirror));

console.log("\n[6] 원래 있던 안전장치를 안 없앴다");
ok("미러 실패가 마감을 죽이지 않는다",
   /catch \(eV2\) \{ Logger\.log\("\[V2\] 미러 오류/.test(push));
ok("옛 Supabase 동기화도 그대로 부른다", /_sb_syncDailyArchive_\(dbRows\);/.test(push));
ok("미러를 끌 수 있다 (V2_MIRROR=off)", /_SBV2_OFF_PROP_ = "V2_MIRROR"/.test(mirror));
ok("당일도 없고 소급도 없으면 통째로 스킵",
   /if \(todayExists && missedDays\.length === 0\)/.test(webapp));

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
