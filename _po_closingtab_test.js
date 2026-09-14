/**
 * 로컬 검증: 송장 수집이 「최근 발주 마감」 탭을 읽는가
 *
 *  > "어림지해장국 송장이 있는데 일일 마감에 못들어 온 이유를 찾아줘..
 *  >  그리고 대리판매 마감이 일부 업체만 되는 이유도 찾아줘"
 *
 *  둘은 같은 한 줄에서 갈렸다.
 *      if ( … || ptName.indexOf("마감") !== -1 ) continue;
 *  「전용양식」에 적는 업체는 수집되고, 줄이 이미 「(2026년 9월) 발주 마감」
 *  으로 넘어간 뒤에 적는 업체는 영영 안 읽혔다. 어느 탭에 적느냐로 되고
 *  안 되고가 갈렸는데, 그건 업체마다 다르다.
 *
 *  지켜야 할 것
 *    · 「발주 마감」 계열만 본다 — 취소/반품·정산 마감은 송장원이 아니다
 *    · 이번 달·지난달만 본다 — 달마다 쌓이는 탭을 다 훑으면 6분을 넘긴다
 *    · 해를 넘겨도 맞아야 한다 (1월의 「지난달」은 작년 12월)
 *
 * 실행: node _po_closingtab_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const src = fs.readFileSync("_partnerOrders.gs", "utf8");
function grab(name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
}

/** 오늘을 원하는 날로 고정해 놓고 본다 */
function 문맥(yyyy, mm) {
  const ctx = {
    Utilities: {
      formatDate(d, tz, fmt) { return fmt === "yyyy" ? String(yyyy) : String(mm).padStart(2, "0"); },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(grab("_po_isRecentClosingTab_"), ctx);
  return ctx._po_isRecentClosingTab_;
}

console.log("\n[마감 탭] 이번 달·지난달만 읽는다");
{
  const f = 문맥(2026, 9);   // 오늘이 2026-09
  check("★ 이번 달 발주 마감", f("(2026년 9월) 발주 마감"), true);
  check("★ 지난달 발주 마감", f("(2026년 8월) 발주 마감"), true);
  check("★ 두 달 전은 안 본다 (달마다 쌓인다)", f("(2026년 7월) 발주 마감"), false);
  check("★ 다음 달도 안 본다", f("(2026년 10월) 발주 마감"), false);
  check("0 을 붙여 적어도 읽는다", f("(2026년 09월) 발주 마감"), true);
  check("괄호 안 공백이 있어도", f("(2026년 9 월) 발주 마감"), false);
}

console.log("\n[마감 탭] 해를 넘겨도 맞는가");
{
  const f = 문맥(2027, 1);   // 오늘이 2027-01
  check("★ 1월의 「지난달」은 작년 12월", f("(2026년 12월) 발주 마감"), true);
  check("이번 달", f("(2027년 1월) 발주 마감"), true);
  check("작년 11월은 안 본다", f("(2026년 11월) 발주 마감"), false);
}

console.log("\n[마감 탭] 「발주 마감」 계열만 본다");
{
  const f = 문맥(2026, 9);
  check("★ 전용발주 마감도 발주 마감이다", f("(2026년 9월) 전용발주 마감"), true);
  check("★ 취소/반품 마감은 송장원이 아니다", f("(2026년 9월) 취소 마감"), false);
  check("★ 정산 마감도 아니다", f("(2026년 9월) 정산 마감"), false);
  check("날짜가 없는 마감 탭은 안 본다", f("발주 마감"), false);
  check("빈 이름", f(""), false);
  check("전용양식은 여기서 안 본다 (원래 길로 읽힌다)", f("전용양식"), false);
}

console.log("\n[수집] 소스 코드가 지켜야 할 것");
{
  check("★ 마감을 통째로 건너뛰던 줄이 사라졌다",
    src.includes('ptName.indexOf("설정") !== -1 ||\r\n            ptName.indexOf("마감") !== -1'), false);
  check("★ 최근 마감만 예외로 둔다",
    src.includes('(ptName.indexOf("마감") !== -1 && !_po_isRecentClosingTab_(ptName))'), true);
  check("★ 최근 마감은 송장원으로 친다",
    src.includes("_po_isRecentClosingTab_(ptName);   // 최근 발주 마감도 송장원이다"), true);
  check("★ 마감 탭에서 몇 키가 들어왔는지 적는다",
    src.includes('scannedLogs.push("[마감탭 송장] "'), true);
}

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
