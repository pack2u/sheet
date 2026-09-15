/**
 * 매칭을 한 곳으로 몰기 전에 — 어느 원천이 무엇을 붙이는가
 *
 *  > "매칭을 전파 한 곳으로 몰자"
 *
 *  합치려면 «어느 원천이 실제로 무엇을 붙이는지»부터 알아야 한다.
 *  여태 마지막 else 가 catch-all 이라 대리공급·보관·세트분리원장·송장원장·
 *  전용마감·발주마감이 전부 한 칸(_supplyCount_)에 뭉쳐 있었다.
 *
 *  ★ 증거 없이 지우지 않는다 ★
 *    앞서 원장을 «제한 없는» 원천으로 올렸다가 마감이 더 나빠진 적이 있다
 *    (자사출고 613→580 · 미매칭 402→441). 원장은 세트가 여러 줄이라 한
 *    고유ID에 송장이 여럿으로 잡히고, 송장맵이 그런 열쇠를 거부한다.
 *    그래서 지금은 «빈 칸만 채우는» 역할이다.
 *    숫자를 보고 0 인 원천부터 지운다.
 *
 * 실행: node _pep_srctally_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const push = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
const web = fs.readFileSync("_partnerWebApp.gs", "utf8");

console.log("");
console.log("[센다] 원천마다 갈라서");
check("★ 원천 이름으로 센다",
  push.indexOf("_srcTally_[item.source] = (_srcTally_[item.source] || 0) + 1;") >= 0, true);
check("그릇이 있다", push.indexOf("var _srcTally_ = {};") >= 0, true);
check("★ 기존 칸들도 그대로 센다 (숫자가 갑자기 바뀌지 않게)",
  push.indexOf('if (item.source === "롯데") _lotteCount_++;') >= 0, true);
check("catch-all 도 그대로 (_supplyCount_)",
  push.indexOf("else if (item.source !== \"이름+전화\") _supplyCount_++;") >= 0, true);

console.log("");
console.log("[보고] 많은 것부터");
check("★ 건수 내림차순으로 정렬한다",
  push.indexOf("return _srcTally_[b] - _srcTally_[a];") >= 0, true);
check("한 줄로 이어 담는다", push.indexOf('result.detail.srcBreakdown = _srcLines_.join(" · ");') >= 0, true);
check("표 자체도 남긴다 (나중에 견줄 수 있게)",
  push.indexOf("result.detail.srcTally = _srcTally_;") >= 0, true);

console.log("");
console.log("[화면] 마감 알림에 뜬다");
check("★ 「원천별:」 줄이 있다", web.indexOf('" └ 원천별: " + result.detail.srcBreakdown') >= 0, true);
check("없으면 그 줄을 안 그린다 (빈 줄이 남지 않게)",
  web.indexOf("(result.detail.srcBreakdown") >= 0, true);

console.log("");
console.log("[안전] 매칭 규칙은 안 건드렸다");
check("★ 원장은 아직 «빈 칸만 채운다»",
  push.indexOf("_pep_loadSetsplitLedgerInvoices_(invoiceMap, result, _lgSS_);") >= 0, true);
check("★ 송장맵에 쌓는 함수는 그대로",
  push.indexOf("function _pep_addInvoiceMap_(") >= 0, true);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
