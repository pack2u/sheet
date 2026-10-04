/**
 * 단가조회 새로고침 — 날마다 주문 들어오는 업체부터
 *
 *  > "대리판매 주요 업체는 당장드림, 하나팩, 냅킨코리아, 올팩, 그린우드,
 *  >  쉬움, 뉴파츠, 엠케이테크, 리바이가 매일주문이 들어오고 나머지는
 *  >  거의 안들어오는 업체야"   + "하나더 용기창고"
 *  > "현제 통합허브가 바뀌어도 대리판매업체 단가조회까지 동기화 되는데
 *  >  한시간 넘는 시간이 걸려"
 *
 *  ★ 1시간의 정체 ★
 *    partnerRefreshViewerPrices 는 수식을 지웠다 다시 써서 IMPORTRANGE 를
 *    강제로 다시 가져오게 한다. 그런데 이걸 부르는 07:00 트리거가 표에 없어
 *    아예 안 돌고 있었다. 그래서 구글의 IMPORTRANGE 자동 갱신(최대 1시간)에
 *    맡겨져 있었다.
 *
 *  ★ 차례가 중요하다 ★
 *    업체 파일을 전부 여는 일이라 6분에 닿는다. 차례를 안 정하면 거의 주문이
 *    없는 업체를 먼저 훑다 시간이 끝나고, 날마다 주문 들어오는 곳이 옛 재고를
 *    그대로 보여 준다 — 품절인 줄 모르고 주문했다 취소하는 일이 거기서 난다.
 *
 * 실행: node _viewerprio_test.js
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

const dep = fs.readFileSync("_partnerDeploy.gs", "utf8");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(dep.slice(dep.indexOf("var _PT_PRIORITY_VENDORS_"),
  dep.indexOf("];", dep.indexOf("var _PT_PRIORITY_VENDORS_")) + 2), ctx);
["_pt_isPriorityVendor_", "_pt_priorityFirst_"].forEach((n) => vm.runInContext(grab(dep, n), ctx));

const 주요인가 = (n) => vm.runInContext("_pt_isPriorityVendor_(" + JSON.stringify(n) + ")", ctx);

console.log("\n[1] ★ 실제 파일 이름으로 알아본다");
{
  /*  파일 이름은 「대리발송-당장드림/탁기선」처럼 사람이 붙인 꼬리를 단다.
      완전일치로는 하나도 못 찾는다.  */
  [["대리발송-당장드림/탁기선", true],
   ["대리발송-하나팩 유채정", true],
   ["대리발송-넵킨코리아", true],
   ["대리발송-냅킨코리아", true],
   ["(주)올팩코리아", true],
   ["대리발송-쉬움PLANNING", true],
   ["대리발송-엠케이테크/문부건", true],
   ["대리발송-용기창고 김은지", true],
   ["뉴파츠_NEW", true],
   ["그린우드", true],
   ["리바이", true]].forEach(function (쌍) {
    check("★ 주요: " + 쌍[0], 주요인가(쌍[0]), 쌍[1]);
  });
}

console.log("\n[2] 나머지는 주요가 아니다");
{
  ["대리발송-인더샵/배민상회", "부엉이커피", "코라마", "태양", "아주팩", "인터웍스", ""]
    .forEach((n) => check("아님: " + (n || "(빈 이름)"), 주요인가(n), false));
}

console.log("\n[3] ★ 주요 업체가 앞으로 온다 — 차례는 그대로");
{
  ctx.__f = [
    { name: "부엉이커피" }, { name: "대리발송-당장드림/탁기선" },
    { name: "코라마" }, { name: "대리발송-하나팩 유채정" }, { name: "태양" }
  ];
  const r = vm.runInContext("_pt_priorityFirst_(__f).map(function (x) { return x.name; })", ctx);
  check("★ 주요 둘이 앞", r.slice(0, 2), ["대리발송-당장드림/탁기선", "대리발송-하나팩 유채정"]);
  check("★ 나머지는 원래 차례대로", r.slice(2), ["부엉이커피", "코라마", "태양"]);
  check("★ 하나도 안 잃는다", r.length, 5);
}

console.log("\n[4] ★ 시간이 모자라면 «말한다»");
{
  const 몸 = 코드만(grab(dep, "partnerRefreshViewerPrices"));
  check("★ 줄세워서 돈다", 몸.indexOf("_pt_priorityFirst_(_pt_listFiles())") >= 0, true);
  check("★ 시간 예산이 있다", 몸.indexOf("_PT_REFRESH_BUDGET_MS_") >= 0, true);
  check("★ 건너뛴 것을 모은다", 몸.indexOf("남긴것.push(f.name)") >= 0, true);
  check("★ 몇 개 건너뛰었는지 적는다", 몸.indexOf("개를 건너뛰었습니다") >= 0, true);
  check("★ 주요 업체 몇/몇 인지 적는다", 몸.indexOf("★ 주요 업체: ") >= 0, true);
  check("★ 주요를 따로 센다", 몸.indexOf("if (_pt_isPriorityVendor_(f.name)) 주요완료++") >= 0, true);
}

console.log("\n[5] 예산은 6분보다 짧다");
{
  const m = dep.match(/_PT_REFRESH_BUDGET_MS_ = (\d+) \* 60 \* 1000/);
  check("★ 분 단위로 읽힌다", !!m, true);
  check("★ 6분 미만", m ? Number(m[1]) < 6 : false, true);
}
console.log("\n[6] ★ 강제 새로고침이 «실제로 돈다»");
{
  /*  1시간의 정체 — syncStatusOnly 를 부르는 07:00 트리거가 표에 없어
      아예 안 돌고 있었다. 구글의 IMPORTRANGE 자동 갱신(최대 1시간)에
      맡겨져 있었던 것이다.  */
  const web = fs.readFileSync("_partnerWebApp.gs", "utf8");
  check("★ 07:00 이 표에 있다",
    /fn: "runMorningSyncStatusBatch",\s+h: 7,\s+m: 0/.test(web), true);

  const 낮 = 코드만(grab(web, "runNoonSyncAndHub"));
  check("★ 12:30 에도 붙어 있다", 낮.indexOf("syncStatusOnly(true)") >= 0, true);
  check("★ 남은 시간을 잰다", 낮.indexOf("_noonT0_") >= 0, true);
  check("★ 모자라면 «건너뛰었다»고 적는다", 낮.indexOf("상태 반영 건너뜀") >= 0, true);
  check("★ 실패해도 낮 일이 끝난다", 낮.indexOf("상태 반영 실패: ") >= 0, true);

  /*  syncStatusOnly 가 진짜로 강제 새로고침을 부르는가  */
  const pm = fs.readFileSync("priceManager.gs", "utf8");
  const 몸 = 코드만(grab(pm, "syncStatusOnly"));
  check("★ 허브 단가를 갱신한다", 몸.indexOf("syncGroupPrices(isAuto)") >= 0, true);
  check("★ 업체 단가조회를 강제로 다시 그린다",
    몸.indexOf("partnerRefreshViewerPrices(") >= 0, true);
}

console.log("\n[7] 트리거 자리");
{
  const web = fs.readFileSync("_partnerWebApp.gs", "utf8");
  const n = (web.match(/\{ fn: "/g) || []).length;
  check("★ 표에 있는 트리거 수", n, 18);
  check("★ 이어달리기 몫 둘이 남는다 (20 - 18)", 20 - n >= 2, true);
}


console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
