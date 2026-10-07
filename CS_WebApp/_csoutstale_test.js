/**
 * 2일 넘게 «도착 안 한» 출고 — 찾아내되, 로젠을 두드리지 않게
 *
 * ★ 이 시험이 지키는 것 ★
 *   > "로젠택배는 다음날 95%는 도착을 하거든" · "2틀이상 안움직이는건 찾아내면 아주 굿이지"
 *
 *   출고는 건수가 많다. 원장을 세어 보니 2~7일 창에 1,898건이었다 —
 *   10건씩 190번 · 2초 간격이면 380초로 **6분 한도를 넘는다.**
 *   그래서 «2일 전 하루치»만 보고, 1시간마다 조금씩 나눠 본다.
 *
 *   여기서 틀어지면 조용히 망가지는 자리들 —
 *     · 코호트가 아닌 날짜를 집으면 7일치를 훑어 한도를 넘는다
 *     · 합포장을 안 묶으면 같은 송장을 몇 번씩 묻는다
 *     · 차례가 흔들리면 「어디까지 봤나」가 어긋나 어떤 건은 영영 안 묻는다
 *     · 잡아 둔 것을 다시 안 물으면, 그새 도착한 건이 카드에 남아 「늑대야」가 된다
 *     · 다 보기 전에 「없음」으로 닫으면 카드가 깜빡인다
 *
 * 실행: node _csoutstale_test.js
 */
const fs = require("fs");
const vm = require("vm");

const src = fs.readFileSync("csLogenOutStale.gs", "utf8");
const stale = fs.readFileSync("csLogenStale.gs", "utf8");
const hourly = fs.readFileSync("csPickupRequests.gs", "utf8");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}

const p2 = (n) => String(n).padStart(2, "0");
const 회차 = (전, 차 = 1) => {
  const d = new Date(); d.setDate(d.getDate() - 전);
  return p2(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" + 차;
};

const 머리 = ["회차키", "운송장번호", "택배사", "거래처명", "사방넷주문번호"];

function 판(줄들, 추적) {
  const 한일 = { 물은것: [], 카드: [] };
  const 속성 = {};
  const ctx = {
    console, String, Number, Array, Math, JSON, Date, Object, parseInt, isNaN,
    Logger: { log: () => {} },
    Utilities: { formatDate: (d, tz, fmt) =>
      fmt === "yyMMdd"
        ? p2(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate())
        : d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in 속성 ? 속성[k] : null),
      setProperty: (k, v) => { 속성[k] = String(v); },
    }) },
    _CS_LEDGER_SS_ID_: "x", _CS_RETURN_LEDGER_ID_: "y",
    SpreadsheetApp: { openById: () => ({
      getSheetByName: (n) => n !== "주문라인원장" ? null : {
        getLastRow: () => 줄들.length + 1,
        getLastColumn: () => 머리.length,
        getRange: (r, c, nr) => ({ getDisplayValues: () =>
          r === 1 ? [머리] : 줄들.slice(r - 2, r - 2 + nr) }),
      },
    }) },
    _cpr_ops_: () => {},
    csLogenTrackMany: (invs) => {
      한일.물은것.push(invs.slice());
      const o = {}; invs.forEach((v) => { o[v] = ctx.추적(v); }); return o;
    },
    추적,
    보드: [],
    csListHandoffCards: () => ({ ok: true, rows: ctx.보드 }),
    csCreateHandoffCard: (p) => { 한일.카드.push(Object.assign({ 무엇: "만듦" }, p));
      ctx.보드.push({ id: 1, srcKey: p.srcKey, status: "진행" }); return { ok: true, id: 1 }; },
    csEditHandoffCard: (p) => { 한일.카드.push(Object.assign({ 무엇: "고침" }, p)); return { ok: true }; },
    csCompleteHandoffCard: (p) => { 한일.카드.push({ 무엇: "닫음", id: p.id });
      const c = ctx.보드.find((x) => x.id === p.id); if (c) c.status = "완료"; return { ok: true }; },
  };
  vm.createContext(ctx);
  vm.runInContext(stale, ctx);
  vm.runInContext(src, ctx);
  ctx.한일 = 한일; ctx.속성 = 속성;
  return ctx;
}

const 멈춤 = () => ({ ok: true, delivered: false, statusName: "배송출고",
                      branch: "동수원", empNm: "홍기사", lastAt: "10-06 09:12" });
const 도착함 = () => ({ ok: true, delivered: true, statusName: "배송완료" });
const 마지막카드 = (c) => c.한일.카드[c.한일.카드.length - 1];

console.log("\n[1] 2일 전 치가 안 왔으면 올린다");
{
  const c = 판([[회차(2), "45324003760", "로젠택배", "최지우", "d1007000098"]], 멈춤);
  c.csOutboundStaleCheck();
  const a = c.한일.카드[0];
  ok("카드를 만든다", a && a.무엇 === "만듦");
  ok("★ 긴급으로", a.level === "긴급");
  ok("★ 반품 카드와 «다른» 표를 쓴다 (섞이면 둘 다 안 읽힌다)",
     a.srcKey === "자동점검:로젠출고지연" && a.srcKey !== "자동점검:로젠반품지연");
  ok("송장을 읽기 좋게 끊는다", /45-3240-03760/.test(a.body));
  ok("며칠째인지", /2일째/.test(a.body));
  ok("수취인", /최지우/.test(a.body));
  ok("★ 영업소를 적는다 (바로 전화하려고)", /동수원/.test(a.body));
  ok("마지막 움직인 때", /10-06 09:12/.test(a.body));
  ok("주문번호", /d1007000098/.test(a.body));
  ok("아직 보는 중이면 그렇다고 적는다 (다 봤으면 다르게)", /다 봤습니다|보는 중/.test(a.body));
}

console.log("\n[2] ★ «2일 전 하루치»만 본다 — 7일을 훑으면 한도를 넘는다");
{
  const c = 판([
    [회차(1), "45324000001", "로젠택배", "어제", "x1"],
    [회차(2), "45324000002", "로젠택배", "그제", "x2"],
    [회차(3), "45324000003", "로젠택배", "사흘전", "x3"],
    [회차(7), "45324000007", "로젠택배", "일주일전", "x7"],
  ], 멈춤);
  c.csOutboundStaleCheck();
  const 물은 = c.한일.물은것[0];
  ok("★ 그제 치만 묻는다", 물은.length === 1 && 물은[0] === "45324000002");
  ok("어제 치는 아직 이르다", 물은.indexOf("45324000001") < 0);
  ok("★ 사흘·일주일 전은 안 훑는다", 물은.indexOf("45324000003") < 0 && 물은.indexOf("45324000007") < 0);
}

console.log("\n[3] 이미 도착했으면 올리지 않는다");
{
  const c = 판([[회차(2), "45324003762", "로젠택배", "박두리", "x2"]], 도착함);
  c.csOutboundStaleCheck();
  ok("★ 카드를 만들지 않는다", !c.한일.카드.some((x) => x.무엇 === "만듦"));
}

console.log("\n[4] ★ 로젠을 두드리지 않는다");
{
  const 합 = [
    [회차(2), "45324003770", "로젠택배", "이합포", "a1"],
    [회차(2), "45324003770", "로젠택배", "이합포", "a2"],
    [회차(2), "45324003770", "로젠택배", "이합포", "a3"],
  ];
  const c = 판(합, 멈춤);
  c.csOutboundStaleCheck();
  ok("★ 합포장은 한 번만 묻는다", c.한일.물은것[0].length === 1);

  ok("★ 한 번에 묻는 수에 윗한도가 있다", /var _OST_PER_RUN_ = \d+;/.test(src));
  ok("원장도 뒤에서 몇 줄만 훑는다", /var _OST_SCAN_ROWS_ = \d+;/.test(src));
  ok("★ 10건씩 끊는 일은 csLogenTrackMany 에 맡긴다 (여기서 다시 안 짠다)",
     /csLogenTrackMany\(송장\)/.test(src) && !/_LOGEN_BATCH_SIZE_/.test(src));
}

console.log("\n[5] ★ 나눠 보되, 한 건도 빠뜨리지 않는다");
{
  const 많음 = [];
  for (let i = 0; i < 300; i++) 많음.push([회차(2), "4532400" + (1000 + i), "로젠택배", "손님" + i, "e" + i]);
  const c = 판(많음, 도착함);     // 다 도착했다 치고 «몇 건을 물었나»만 본다

  c.csOutboundStaleCheck();
  const 첫판 = c.한일.물은것[0].length;
  ok("★ 한 번에 다 묻지 않는다", 첫판 > 0 && 첫판 < 300);

  let 돈횟수 = 1;
  while (c.csOutboundStaleCheck() !== "" && 돈횟수 < 20) 돈횟수++;
  const 물은전체 = [].concat.apply([], c.한일.물은것);
  const 고유 = {}; 물은전체.forEach((v) => { 고유[v] = (고유[v] || 0) + 1; });

  ok("★ 결국 300건을 다 묻는다", Object.keys(고유).length === 300);
  ok("★ 같은 송장을 두 번 묻지 않는다",
     Object.keys(고유).every((k) => 고유[k] === 1));
  ok("다 보면 빈 글을 준다 (일감 보고가 지저분해지지 않게)", c.csOutboundStaleCheck() === "");
  ok("차례를 못 박았다 (어디까지 봤나를 번호로 적는다)", /out\.sort\(function \(a, b\) \{ return a\.inv/.test(src));
}

console.log("\n[6] ★ 늑대야 소리를 하지 않는다");
{
  const c = 판([
    [회차(2), "45324003781", "로젠택배", "가도착", "f1"],
    [회차(2), "45324003782", "로젠택배", "나멈춤", "f2"],
  ], 멈춤);
  c.csOutboundStaleCheck();
  ok("둘 다 잡혔다", /45-3240-03781/.test(마지막카드(c).body) && /45-3240-03782/.test(마지막카드(c).body));

  //  그새 하나가 도착했다
  c.추적 = (v) => (v === "45324003781" ? 도착함() : 멈춤());
  c.속성.OST_IDX = "0";                 // 다음 시간에 또 돌았다 치고
  c.csOutboundStaleCheck();
  const b = 마지막카드(c).body;
  ok("★ 도착한 건은 카드에서 빠진다", !/45-3240-03781/.test(b));
  ok("안 온 건은 남는다", /45-3240-03782/.test(b));
}

console.log("\n[7] 다 도착하면 내려간다 · 사람이 닫으면 안 되살린다");
{
  const c = 판([[회차(2), "45324003790", "로젠택배", "정내림", "d1"]], 멈춤);
  c.csOutboundStaleCheck();
  c.추적 = 도착함;
  c.속성.OST_IDX = "0";
  c.csOutboundStaleCheck();
  ok("★ 다 왔으면 카드를 닫는다", c.한일.카드.some((x) => x.무엇 === "닫음"));

  const c2 = 판([[회차(2), "45324003791", "로젠택배", "손닫음", "d2"]], 멈춤);
  c2.보드.push({ id: 9, srcKey: "자동점검:로젠출고지연", status: "완료" });
  c2.csOutboundStaleCheck();
  ok("★ 사람이 닫은 카드는 안 건드린다", c2.한일.카드[0].무엇 === "만듦");

  //  ★ 다 보기 전에 「없음」으로 닫으면 카드가 깜빡인다 ★
  const 많음 = [];
  for (let i = 0; i < 300; i++) 많음.push([회차(2), "4532401" + (1000 + i), "로젠택배", "손님" + i, "g" + i]);
  const c3 = 판(많음, 도착함);
  c3.csOutboundStaleCheck();
  ok("★ 아직 보는 중이면 닫지 않는다", !c3.한일.카드.some((x) => x.무엇 === "닫음"));
}

console.log("\n[8] 로젠 건만 · 로젠 송장만");
{
  const c = 판([
    [회차(2), "268334465383", "롯데택배", "롯데건", "c1"],
    [회차(2), "45324003780", "로젠택배", "로젠건", "c2"],
    [회차(2), "", "로젠택배", "송장없음", "c3"],
  ], 멈춤);
  c.csOutboundStaleCheck();
  const 물은 = c.한일.물은것[0];
  ok("★ 롯데 건은 안 묻는다", 물은.indexOf("268334465383") < 0);
  ok("송장 없는 줄도 안 묻는다", 물은.length === 1);
  ok("로젠 건만 묻는다", 물은[0] === "45324003780");
}

console.log("\n[9] 많으면 줄인다");
{
  const 많음 = [];
  for (let i = 0; i < 40; i++) 많음.push([회차(2), "4532402" + (1000 + i), "로젠택배", "손님" + i, "h" + i]);
  const c = 판(많음, 멈춤);
  c.csOutboundStaleCheck();
  const b = 마지막카드(c).body;
  ok("★ 줄 수를 자른다", (b.match(/^· /gm) || []).length <= 20);
  ok("자른 만큼 「외 n건」", /외 \d+건/.test(b));
}

console.log("\n[10] 1시간 일감에 얹혔나");
{
  ok("일감이 부른다", /csOutboundStaleCheck\(\)/.test(hourly));
  ok("★ 빈 글이면 안 붙인다", /if \(출고\) L\.push\(출고\)/.test(hourly));
  ok("앞 일(접수·송장 채우기)이 먼저 끝난다",
     hourly.indexOf("csOutboundStaleCheck") > hourly.indexOf("csLogenFillReturnSlips"));
  ok("터져도 일감은 안 죽는다", /catch \(e\) \{ L\.push\("출고 지연 점검 실패/.test(hourly));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
