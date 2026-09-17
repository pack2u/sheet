/**
 * 일일마감 날짜 바로잡기 — 남의 날짜에 앉은 줄을 제자리로
 *
 *  > "계속 오류값 찾아내는 메뉴만 만들고 다시 작업하게 만들고
 *  >  이건 무슨 시간낭비지?"
 *
 *  찾기만 하는 것을 만들지 않는다. 찾고 «옮기고» 말한다.
 *  다만 자료를 옮기는 일이라 «사라지는 길»이 없어야 한다 —
 *  그것을 여기서 박는다.
 *
 * 실행: node _archivefixdate_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

const SRC = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
const has = (s) => SRC.indexOf(s) >= 0;

function fnFrom(name) {
  const at = SRC.indexOf("function " + name + "(");
  if (at < 0) throw new Error("못 찾음: " + name);
  let d = 0;
  for (let i = SRC.indexOf("{", at); i < SRC.length; i++) {
    if (SRC[i] === "{") d++;
    else if (SRC[i] === "}") { d--; if (d === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error("안 닫힘: " + name);
}

const ctx = { console, String };
vm.createContext(ctx);
vm.runInContext(fnFrom("_pep_dateFromRunKey_"), ctx);
const 날 = (s) => ctx._pep_dateFromRunKey_(s);

/* ── [1] 회차키에서 날짜 읽기 ───────────────────────────── */
console.log("\n[1] 회차키 → 주문일");
{
  eq("260917-1", 날("260917-1"), "2026-09-17");
  eq("260915-3", 날("260915-3"), "2026-09-15");
  eq("앞뒤 공백", 날("  260917-2  "), "2026-09-17");
  eq("회차 없이 여섯 자리만", 날("260917"), "2026-09-17");
  //  ★ 모르면 «빈칸» ★ 지어내면 그 줄이 엉뚱한 날로 옮겨 간다
  eq("★ 짧으면 모른다", 날("2609"), "");
  eq("★ 글자가 섞이면 모른다", 날("26091a-1"), "");
  eq("★ 빈 값", 날(""), "");
  eq("★ null", 날(null), "");
  eq("★ 날짜 꼴이 아니면 모른다", 날("2026-09-17"), "");
}

/* ── [2] 한 주문이 여러 회차에 걸칠 때 ──────────────────── */
console.log("\n[2] 가장 «이른» 날이 참이다");
{
  //  늦은 날을 고르면 이 함수가 바로 그 사고(주문일 뒤로 밀기)를 다시 저지른다
  ok("★ 더 이른 날로만 덮는다", has("if (!map[uid] || d < map[uid]) map[uid] = d;"));
  ok("  왜 그런지 적어 뒀다", has("늦은 날을 고르면 이 함수가 바로 그 사고를 다시 저지른다"));
}

/* ── [3] 자료가 사라지는 길이 없는가 ────────────────────── */
console.log("\n[3] 옮기는 차례");
{
  const at = SRC.indexOf("function partnerFixArchiveWrongDate(");
  const 몸통 = at >= 0 ? SRC.substring(at, at + 6000) : "";
  const 쓰기 = 몸통.indexOf("_pep_appendArchiveRows_(");
  const 지우기 = 몸통.indexOf("tab.deleteRow(");
  ok("★ «먼저 쓰고» 그 뒤에 지운다", 쓰기 > 0 && 지우기 > 쓰기);
  ok("★ 쓰기가 터지면 원본을 안 건드린다",
    몸통.indexOf("못옮김 += 묶음.length;") >= 0 && 몸통.indexOf("continue;") >= 0);
  ok("★ 뒤에서부터 지운다 (줄 번호가 안 밀리게)",
    몸통.indexOf("지울행.sort(function (a, b) { return b - a; });") >= 0);
  ok("★ 지우기 실패도 말한다 (두 곳에 남는다고)",
    몸통.indexOf("그 줄이 두 곳에 있습니다") >= 0);
}

/* ── [4] 모르는 것은 안 건드린다 ────────────────────────── */
console.log("\n[4] 모를 때");
{
  const at = SRC.indexOf("function partnerFixArchiveWrongDate(");
  const 몸통 = at >= 0 ? SRC.substring(at, at + 6000) : "";
  ok("★ 원장에 없으면 건드리지 않고 «센다»",
    몸통.indexOf("if (!참날) { 모름++; continue; }") >= 0);
  ok("★ 고유ID 가 아니면 건너뛴다",
    몸통.indexOf("if (!uid || !_pep_isRealUid_(uid))") >= 0);
  /*  ★ 2026-09-17: 처음에 cols.oid 만 보다가 열두 날을 통째로 건너뛰었다 ★
      일일마감의 ID 칸 이름은 「주문자명(사방넷)」 이고, 그것은 oid 가 아니라
      orderer 로 들어간다. 시스템에 이미 그걸 읽는 자가 하나 있다 — 그걸 쓴다. */
  ok("★ 고유ID 를 «이미 있는 자»로 읽는다 (내 방식으로 또 읽지 않는다)",
    몸통.indexOf("_pep_deriveMatchKeyFromArchiveRow_(all[ri], cols)") >= 0);
  ok("  cols.oid 만 보지 않는다", 몸통.indexOf("_pep_uidFromOrdererCell_(all[ri][cols.oid])") < 0);
  ok("★ 머리글을 못 찾으면 «무엇을 못 찾았는지» 적는다",
    몸통.indexOf("주문자명(사방넷)·주문번호 칸을 못 찾아 건너뜁니다") >= 0 &&
    몸통.indexOf("(머리글: ") >= 0);
  ok("★ 「0줄」이 무슨 뜻인지 갈린다 (훑은 줄을 센다)",
    몸통.indexOf("훑은 줄 : ") >= 0 && 몸통.indexOf("한 줄도 못 읽었습니다") >= 0);

  /*  ★ 숫자가 안 맞으면 그 표 전체를 못 믿는다 ★  (2026-09-17)
      처음엔 고유ID 없는 줄을 조용히 건너뛰어 3,046 줄이 어디로 갔는지
      말을 안 했다. 세고, 적고, 합이 맞는지 스스로 확인한다. */
  ok("★ 고유ID 없는 줄도 «센다»", 몸통.indexOf("{ ID없음++; continue; }") >= 0);
  ok("  그리고 적는다", 몸통.indexOf("고유ID 가 없어 «볼 수 없는» 줄") >= 0);
  ok("★ 합이 맞는지 스스로 확인한다", 몸통.indexOf("var 셈합 = 제자리 + 모름 + ID없음 + 옮김 + 이미있음 + 못옮김;") >= 0);
  ok("  안 맞으면 «안 맞는다»고 말한다", 몸통.indexOf("숫자가 안 맞습니다") >= 0);
  ok("★ 합계줄은 안 옮긴다", 몸통.indexOf('indexOf("합계") !== -1') >= 0);
  //  제자리인 줄은 «세기만» 하고 그대로 둔다 — 세야 「0줄 옮김」의 뜻이 갈린다
  ok("★ 제 날짜에 있는 줄은 그대로 둔다",
    몸통.indexOf("if (참날 === dateStr) { 제자리++; continue; }") >= 0);
  ok("  몇 줄을 모르는지 말한다", 몸통.indexOf("날짜를 모르는 줄") >= 0);
  ok("★ 원장을 못 읽으면 아예 «안 돈다»",
    몸통.indexOf("어느 날이 참인지 알 수 없습니다") >= 0);
}

/* ── [5] 6분에 걸려도 자료가 깨지지 않는가 ──────────────── */
console.log("\n[5] 시간 한도");
{
  const at = SRC.indexOf("function partnerFixArchiveWrongDate(");
  const 몸통 = at >= 0 ? SRC.substring(at, at + 6000) : "";
  ok("★ 예산을 두고 멈춘다", 몸통.indexOf("var 예산 = 4 * 60 * 1000;") >= 0);
  //  날짜 하나를 다 끝낸 «뒤»에 멈춘다 — 중간에 끊기면 반쪽만 옮겨진다
  const 멈춤 = 몸통.indexOf("멈춤 = d + \"일차에서 시간이 모자라 멈췄습니다.\";");
  const 파일열기 = 몸통.indexOf("_unified_findExistingArchiveSs_(");
  ok("★ 파일을 열기 «전»에 멈춘다 (반쪽 옮기기가 없게)", 멈춤 > 0 && 멈춤 < 파일열기);
  ok("  다시 누르면 이어서 본다고 말한다", 몸통.indexOf("다시 누르면 이어서 봅니다") >= 0);
}

/* ── [6] 메뉴에 달렸는가 ────────────────────────────────── */
console.log("\n[6] 배선");
{
  const MENU = fs.readFileSync("_partnerMenu.gs", "utf8");
  ok("★ 메뉴에 있다", MENU.indexOf('"partnerFixArchiveWrongDate"') >= 0);
  ok("  이름이 하는 일을 말한다", MENU.indexOf("제자리로 옮김") >= 0);
  ok("★ 함수가 실제로 있다", has("function partnerFixArchiveWrongDate(days)"));
  ok("  원장 읽는 자가 있다", has("function _pep_loadOrderDateByUid_()"));
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
