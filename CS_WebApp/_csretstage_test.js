/* 반품 진행 단계 판정 검증 (로컬 검증용)
 *
 * 주문검색 카드 옆 뱃지의 색·아이콘이 이 숫자 하나로 갈린다.
 * 여기가 틀리면 화면이 **거짓말을 한다** — 아직 안 들어온 물건에 「입고」가 뜨거나,
 * 이미 끝난 건이 진행 중으로 보인다. 둘 다 CS 가 고객에게 잘못 답하게 만든다.
 *
 * 특히 옛 상태값이 관건이다. 드롭다운은 2026-08-31 에 4개로 줄였지만
 * 기존 행에는 「수거요청」「반품입고」 같은 옛 글자가 그대로 남아 있다.
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (got !== undefined ? "  → " + got : "")); }
};

const src = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");
function take(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("못 찾음: " + from);
  return src.slice(a, b);
}

const ctx = { String, Number, RegExp, console };
vm.createContext(ctx);
/*  2026-09-28 — 단계 판정이 셋으로 갈렸다.
    «낱말 → 단계» 와 «처리 경과 → 단계» 를 합쳐 쓰므로 셋 다 넣어야 한다. */
vm.runInContext(
  take("/** 낱말 하나를 단계로", "/** CS앱 — 진행 중 반품 목록"), ctx);

const S = (status, active) => ctx._cs_returnStage_(status, active);

console.log("\n[지금 쓰는 4단계]");
ok("접수 → 0", S("접수", true) === 0, S("접수", true));
ok("반품송장 → 1", S("반품송장", true) === 1, S("반품송장", true));
ok("입고검수 → 2", S("입고검수", true) === 2, S("입고검수", true));
ok("이카운트OK 는 완료로 걸러져 들어온다 → 3", S("이카운트OK", false) === 3);

console.log("\n[옛 상태값 — 기존 행에 그대로 남아 있다]");
ok("수거요청 → 1 (회수)", S("수거요청", true) === 1, S("수거요청", true));
ok("수거중 → 1", S("수거중", true) === 1, S("수거중", true));
ok("회수중 → 1", S("회수중", true) === 1, S("회수중", true));
ok("반품입고 → 2 (입고가 회수보다 앞선다)", S("반품입고", true) === 2, S("반품입고", true));
ok("입고 → 2", S("입고", true) === 2, S("입고", true));
ok("검수중 → 2", S("검수중", true) === 2, S("검수중", true));

console.log("\n[완료 판정이 무엇보다 앞선다]");
ok("완료면 상태 글자와 무관하게 3", S("접수", false) === 3, S("접수", false));
ok("완료면 입고검수여도 3", S("입고검수", false) === 3, S("입고검수", false));

console.log("\n[모르는 값·빈 값은 0 — 없는 진행을 지어내지 않는다]");
ok("빈 값 → 0", S("", true) === 0);
ok("null → 0", S(null, true) === 0);
ok("듣도 보도 못한 값 → 0", S("보류", true) === 0, S("보류", true));
ok("공백 낀 「입고 검수」도 2", S("입고 검수", true) === 2, S("입고 검수", true));

console.log("\n[사진 장수 — 물류팀이 올린 입고 사진이 여기 잡힌다]");
const PC = ctx._cs_returnPhotoCount_;
ok("사진 이벤트만 센다",
  PC([{ kind: "photo" }, { kind: "consult" }, { kind: "photo" }, { kind: "status" }]) === 2,
  PC([{ kind: "photo" }, { kind: "consult" }, { kind: "photo" }, { kind: "status" }]));
ok("없으면 0", PC([{ kind: "consult" }]) === 0);
ok("빈 배열 0", PC([]) === 0);
ok("undefined 도 0 (터지지 않는다)", PC(undefined) === 0);

console.log("\n[★ 처리 경과가 말하는 단계]  (2026-09-28)");
{
  /*  > "아래 상태값에 따라 상단 아이콘도 바뀌어야 되는데 따로놀아"

      대장 A열은 사람이 자유롭게 적는 칸이다. 9월 한 달에만 열네 가지 말이
      쓰였고 「진행중·자동·사고·확인필요문정」 19건은 규칙이 모르는 말이라
      전부 0(접수)으로 떨어졌다 — 타임라인에는 「상태→입고검수」가 있는데도. */
  const 줄 = (kind, text) => ({ kind: kind, text: text, date: "260922", sortKey: "202609220939" });
  const T = (status, tl) => ctx._cs_returnStage_(status, true, tl);

  ok("★ 「진행중」인데 경과에 입고검수 → 2",
    T("진행중", [줄("status", "입고검수")]) === 2, T("진행중", [줄("status", "입고검수")]));
  ok("  「사고」도 마찬가지", T("사고", [줄("status", "입고검수")]) === 2);
  ok("  「자동」도", T("자동", [줄("status", "반품송장")]) === 1);

  ok("★ 뒤로는 안 내려간다 — A열 완료 + 경과 접수 → 3",
    T("완료", [줄("status", "접수")]) === 3, T("완료", [줄("status", "접수")]));

  ok("★ 상담 메모의 「입고」에는 안 걸린다 (사람이 단계로 적은 것만 본다)",
    T("진행중", [줄("consult", "입고 언제 되나요 문의")]) === 0,
    T("진행중", [줄("consult", "입고 언제 되나요 문의")]));
  ok("  반품송장 meta 줄은 회수로 본다",
    T("진행중", [{ kind: "meta", text: "반품송장: 492-9634-0100", sortKey: "100000000000" }]) === 1);

  ok("경과가 비면 여태와 같다", T("접수", []) === 0 && T("입고", []) === 2);
  ok("경과가 없어도 안 터진다", T("진행중") === 0 && T("진행중", null) === 0);
  ok("끝난 건은 언제나 3", ctx._cs_returnStage_("진행중", false, [줄("status", "접수")]) === 3);
}

console.log("\n" + (fail ? `실패 ${fail}건 / 통과 ${pass}건` : `모두 통과 (${pass}건)`));
process.exit(fail ? 1 : 0);
