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

console.log("\n⑥ ★ 지금 바로 돌리는 길  (2026-09-28)");
{
  /*  > "오늘 마감은 실행됬으나 이전꺼 입력만 실행해볼수 있나? 내일까지 미룰필요가.."

      마감 끝의 예약은 «다음 마감»부터다. 오늘 것은 손으로 한 번 돌린다. */
  const menu = fs.readFileSync(path.join(__dirname, "_partnerMenu.gs"), "utf8");
  ok("메뉴 함수가 있다", /function partnerFillUnmatchedRecent\(\)/.test(src));
  ok("  메뉴에 걸려 있다",
    /addItem\("⏪ 지난 7일 미매칭 송장 채우기 \(지금\)", "partnerFillUnmatchedRecent"\)/.test(menu));
  ok("★ 오늘 파일도 본다 (마감이 이미 끝났다)",
    /\[오늘\]\.concat\(_pep_backfillDates_\(오늘\)\)/.test(src));

  const 쓰임 = (src.match(/_pep_fillUnmatchedDays_\(/g) || []).length;
  ok("★ 예약 실행과 «같은 함수»를 쓴다 (결과가 갈릴 일이 없다)", 쓰임 >= 3, String(쓰임));

  ok("★ 송장맵을 «한 번만» 만든다 (7일이면 일곱 번이었다)",
    /function _pep_fillUnmatchedDays_[\s\S]{0,1200}_puv_buildInvoiceMap_\(stat\)[\s\S]{0,400}for \(var i = 0; i < dates\.length/.test(src));
  ok("  시간을 재며 돈다 (GAS 는 6분에 끊긴다)", /out\.remain\.push\(d\)/.test(src));
  ok("  못 본 날을 알려 준다", /시간이 모자라 못 본 날/.test(src));
  ok("  파일이 없는 날은 조용히 넘어간다 (주말·휴일)", /그날 마감 파일이 없다/.test(src));
}

console.log("\n⑦ ★ 빈 송장을 셋으로 가른다  (2026-09-28)");
{
  /*  최근 8일 빈 송장 45줄을 뜯어 보니 —
        9줄  키가 달라 못 붙음 (원장엔 송장이 있다)
        8줄  적립금·할인액·반품배송비·시안비용  ← 송장이 있을 수 없다
       17줄  9/28 당일 (대리공급 오후 푸시 대기)
      「45」 하나로 적으면 이 갈래가 안 보인다. */
  const ctx2 = { String, Number, Date, RegExp, console, Utilities };
  vm.createContext(ctx2);
  vm.runInContext(꺼내("_pep_unmatchedKind_"), ctx2);
  vm.runInContext(src.slice(src.indexOf("var _PEP_NONSHIP_WORDS_ = ["),
    src.indexOf("];", src.indexOf("var _PEP_NONSHIP_WORDS_ = [")) + 2), ctx2);
  const cols = { item: 0, src: 1 };
  const 갈래 = (item, 출처, d) => ctx2._pep_unmatchedKind_([item, 출처], cols, d);

  const 오늘 = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const 옛날 = "2026-01-01";

  ok("적립금 → 비배송", 갈래("적립금", "대리공급", 오늘) === "비배송");
  ok("할인액 → 비배송", 갈래("할인액", "로젠", 옛날) === "비배송");
  ok("반품배송비 → 비배송", 갈래("반품배송비", "로젠", 옛날) === "비배송");
  ok("시안 비용 → 비배송 (띄어쓰기 무시)", 갈래("시안 비용", "로젠", 오늘) === "비배송");
  ok("★ 비배송이 대기보다 먼저다", 갈래("적립금", "대리공급", 오늘) === "비배송");

  ok("★ 대리공급 + 오늘 → 대기", 갈래("AJ 감자탕 소 블랙 200세트", "대리공급", 오늘) === "대기");
  ok("  대리발송도 같다", 갈래("HR 앞치마 백색 1000매", "대리발송", 오늘) === "대기");
  ok("★ 대리공급이어도 이틀 지났으면 진짜 미매칭",
    갈래("AJ 감자탕 소 블랙 200세트", "대리공급", 옛날) === "미매칭",
    갈래("AJ 감자탕 소 블랙 200세트", "대리공급", 옛날));
  ok("로젠은 오늘이어도 미매칭 (자체발송은 4시면 나온다)",
    갈래("JH 사각찜 J2 소 100세트", "로젠", 오늘) === "미매칭");
  ok("출처를 모르면 미매칭", 갈래("BW 실링칼", "", 오늘) === "미매칭");

  ok("갈래 셋을 따로 센다", /비배송: 0, 대기: 0, 미매칭: 0/.test(src));
  ok("  세 자리 모두에서 센다", (src.match(/out\[갈래\]\+\+/g) || []).length === 3,
    String((src.match(/out\[갈래\]\+\+/g) || []).length));
  ok("  화면에 갈라 적는다", /★ 진짜 미매칭/.test(src) && /송장이 있을 수 없다/.test(src));
}

console.log("\n⑧ ★ 스냅샷이 TEL 로 굳는 것을 순번으로 막는다  (2026-09-28)");
{
  /*  > "키가 다른건 우리가 고유아이디를 바꾼게 22일인가 그럴껄?"
      ID 모양 탓은 아니었다 — 옛 모양(0921-PH-…)도 새 모양(p0928…)도 다 알아본다.

      진짜 까닭은 스냅샷이 매칭키를 «한 번 정하고 굳히는» 것이다.
      판매현황 O열이 아직 비어 있을 때 스냅샷이 뜨면 키가 TEL:전화 로 정해지고
      스냅샷 B열에 영구히 남는다. 세트분리가 나중에 O열을 채워도 영영 TEL 이다. */
  const ctx3 = { String, console };
  vm.createContext(ctx3);
  vm.runInContext(꺼내("_pep_seqKey_"), ctx3);
  const K = (d, s) => ctx3._pep_seqKey_(d, s);

  ok("일자와 순번을 잇는다", K("2026/09/22 -63", "000047") === "2026/09/22-63#47",
    K("2026/09/22 -63", "000047"));
  ok("★ 앞 0 을 턴다 (원장은 000047, 판매현황은 47 로 적힐 수 있다)",
    K("A", "000047") === K("A", "47"));
  ok("  공백도 턴다", K("2026/09/22 -63", "47") === K("2026/09/22-63", " 47 "));
  ok("둘 중 하나라도 비면 열쇠를 안 만든다",
    K("", "47") === "" && K("A", "") === "" && K(null, null) === "");

  ok("★ 순번표는 «필요할 때만» 만든다 (다 채워져 있으면 원장을 안 읽는다)",
    /if \(!_snapSeqMap\) _snapSeqMap = _pep_setsplitUidBySeq_\(\);/.test(src));
  ok("  TEL 로 떨어질 때만 되찾는다", /if \(!_pep_isRealUid_\(matchKey\)\) \{/.test(src));
  ok("  되찾은 ID 도 진짜인지 다시 본다", /if \(_uid2 && _pep_isRealUid_\(_uid2\)\)/.test(src));
  ok("  O열에도 채워 사람이 눈으로 찾게 한다", /telName \+ "\/" : ""\) \+ _uid2/.test(src));
  ok("★ 몇 줄을 되찾았는지 말해 준다", /★순번으로되찾음/.test(src) && /result\.순번되찾음 = _snapSeqFixed/.test(src));

  ok("★ 이름·전화로 짐작하지 않는다 (9/15 에 지운 길이다)",
    /짐작이 아니라 열쇠다/.test(src) && /동명이인이 96건/.test(src));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
