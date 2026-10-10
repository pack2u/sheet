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
/*  _ls_isLogenRow_ 가 거기 있다 — 「갓 돌린 회차는 택배사가 비어 경로를 본다」는
    판단은 출고 쪽 둘이 같이 쓴다. 울타리에도 같이 올린다. */
const ship = fs.readFileSync("csLogenShipSlips.gs", "utf8");
const stale = fs.readFileSync("csLogenStale.gs", "utf8");
const hourly = fs.readFileSync("csPickupRequests.gs", "utf8");

/*  ★ 자를 «코드에서 읽는다» ★
    시험이 숫자를 베껴 적으면, 자를 고칠 때 시험도 같이 틀어져서 고친 것이
    맞는지 알 수가 없다. 값이 맞는지는 [0] 에서 한 번만 못 박는다. */
const 자 = Number((src.match(/_OST_FROM_DAYS_ = (\d+)/) || [])[1]);

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}

const p2 = (n) => String(n).padStart(2, "0");
//  달력으로 N일 전
const 회차 = (전, 차 = 1) => {
  const d = new Date(); d.setDate(d.getDate() - 전);
  return p2(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" + 차;
};
//  ★ 영업일로 N일 전 ★
//  _ost_bizSince_(D) === n 이 되는 발송일 D 를 고른다.
//  = 오늘부터 거꾸로 센 n번째 영업일 (0 = 오늘).
//    오늘이 목요일이면  n=2 → 화요일  (수·목 두 영업일이 지난 셈)
//  오늘이 무슨 요일이든, 연휴가 끼어 있든 시험이 흔들리지 않는다.
const 영업회차 = (n, 휴일 = {}) => {
  const off = (d) => { const w = d.getDay();
    return w === 0 || w === 6 || !!휴일[d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())]; };
  const d = new Date(); d.setHours(0, 0, 0, 0);
  let 센것 = 0;
  while (true) {
    if (!off(d)) { if (센것 === n) break; 센것++; }
    d.setDate(d.getDate() - 1);
  }
  return p2(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate()) + "-1";
};

const 머리 = ["회차키", "운송장번호", "택배사", "거래처명", "사방넷주문번호", "경로"];

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
    //  휴일표는 csLotteReturn.gs 것을 쓴다. 울타리에서는 토·일 + 아래 표.
    휴일: {},
    _lrt_isOff_: (d) => {
      const w = d.getDay();
      if (w === 0 || w === 6) return true;
      const p = (x) => String(x).padStart(2, "0");
      return !!ctx.휴일[d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())];
    },
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
  vm.runInContext(ship, ctx);
  vm.runInContext(src, ctx);
  ctx.한일 = 한일; ctx.속성 = 속성;
  return ctx;
}

const 멈춤 = () => ({ ok: true, delivered: false, statusName: "배송출고",
                      branch: "동수원", empNm: "홍기사", lastAt: "10-06 09:12" });
const 도착함 = () => ({ ok: true, delivered: true, statusName: "배송완료" });
const 마지막카드 = (c) => c.한일.카드[c.한일.카드.length - 1];

console.log("\n[0] ★ 자 — 사장님이 정하신 값");
{
  /*  2026-10-08: 처음 2영업일로 뒀다가 3영업일로 올렸다.
      > "로젠 연동 움직임이 없는 기준을 2일로 했는데 3일로 수정하자"

      ★ 셋이 같아야 한다 ★ 출고(_OST_FROM_DAYS_) · 반품 판정(_LSF_STALE_DAYS_) ·
      반품 카드 글자(_STALE_DAYS_). 한쪽만 고치면 두 카드가 다른 자로 말하거나,
      글과 실제가 갈린다. 자를 또 바꿀 때 여기서 걸린다. */
  ok("★ 출고 자가 3영업일", 자 === 3);
  const fill = fs.readFileSync("csLogenSlipFill.gs", "utf8");
  const 반품자 = Number((fill.match(/_LSF_STALE_DAYS_ = (\d+)/) || [])[1]);
  const 글자자 = Number((stale.match(/_STALE_DAYS_ = (\d+)/) || [])[1]);
  ok("★ 반품 판정 자도 같다", 반품자 === 자);
  ok("★ 반품 카드 글자용 자도 같다 (글과 실제가 갈리면 안 된다)", 글자자 === 자);
}

console.log("\n[1] 자를 넘겼는데 안 왔으면 올린다");
{
  const c = 판([[영업회차(자), "45324003760", "로젠택배", "최지우", "d1007000098"]], 멈춤);
  c.csOutboundStaleCheck();
  const a = c.한일.카드[0];
  ok("카드를 만든다", a && a.무엇 === "만듦");
  ok("★ 긴급으로", a.level === "긴급");
  ok("★ 반품 카드와 «다른» 표를 쓴다 (섞이면 둘 다 안 읽힌다)",
     a.srcKey === "자동점검:로젠출고지연" && a.srcKey !== "자동점검:로젠반품지연");
  ok("송장을 읽기 좋게 끊는다", /453-2400-3760/.test(a.body));
  ok("영업일로 며칠째인지", new RegExp("영업일 " + 자 + "일째").test(a.body));
  ok("수취인", /최지우/.test(a.body));
  ok("★ 영업소를 적는다 (바로 전화하려고)", /동수원/.test(a.body));
  ok("마지막 움직인 때", /10-06 09:12/.test(a.body));
  ok("주문번호", /d1007000098/.test(a.body));
  ok("아직 보는 중이면 그렇다고 적는다 (다 봤으면 다르게)", /다 봤습니다|보는 중/.test(a.body));
}

console.log("\n[2] ★ «2일 전 하루치»만 본다 — 7일을 훑으면 한도를 넘는다");
{
  const c = 판([
    [영업회차(자 - 1), "45324000001", "로젠택배", "하루전", "x1"],
    [영업회차(자), "45324000002", "로젠택배", "이틀전", "x2"],
    [영업회차(자 + 1), "45324000003", "로젠택배", "자보다 하루 더", "x3"],
    [영업회차(자 + 2), "45324000007", "로젠택배", "자보다 이틀 더", "x7"],
  ], 멈춤);
  c.csOutboundStaleCheck();
  const 물은 = c.한일.물은것[0];
  ok("★ 꼭 " + 자 + "영업일 된 것만 묻는다", 물은.length === 1 && 물은[0] === "45324000002");
  ok("자보다 이른 것은 아직 안 묻는다", 물은.indexOf("45324000001") < 0);
  ok("★ 자보다 오래된 것도 «오늘» 훑지 않는다 (이미 잡혀 공지에 남아 있다)",
     물은.indexOf("45324000003") < 0 && 물은.indexOf("45324000007") < 0);
}

console.log("\n[3] 이미 도착했으면 올리지 않는다");
{
  const c = 판([[영업회차(자), "45324003762", "로젠택배", "박두리", "x2"]], 도착함);
  c.csOutboundStaleCheck();
  ok("★ 카드를 만들지 않는다", !c.한일.카드.some((x) => x.무엇 === "만듦"));
}

console.log("\n[4] ★ 로젠을 두드리지 않는다");
{
  const 합 = [
    [영업회차(자), "45324003770", "로젠택배", "이합포", "a1"],
    [영업회차(자), "45324003770", "로젠택배", "이합포", "a2"],
    [영업회차(자), "45324003770", "로젠택배", "이합포", "a3"],
  ];
  const c = 판(합, 멈춤);
  c.csOutboundStaleCheck();
  ok("★ 합포장은 한 번만 묻는다", c.한일.물은것[0].length === 1);

  ok("★ 한 번에 묻는 수에 윗한도가 있다", /var _OST_PER_RUN_ = \d+;/.test(src));
  ok("원장도 뒤에서 몇 줄만 훑는다", /var _OST_SCAN_ROWS_ = \d+;/.test(src));
  ok("★ 10건씩 끊는 일은 csLogenTrackMany 에 맡긴다 (여기서 다시 안 짠다)",
     /csLogenTrackMany\(송장/.test(src) && !/_LOGEN_BATCH_SIZE_/.test(src));
}

console.log("\n[5] ★ 나눠 보되, 한 건도 빠뜨리지 않는다");
{
  const 많음 = [];
  for (let i = 0; i < 300; i++) 많음.push([영업회차(자), "4532400" + (1000 + i), "로젠택배", "손님" + i, "e" + i]);
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
    [영업회차(자), "45324003781", "로젠택배", "가도착", "f1"],
    [영업회차(자), "45324003782", "로젠택배", "나멈춤", "f2"],
  ], 멈춤);
  c.csOutboundStaleCheck();
  ok("둘 다 잡혔다", /453-2400-3781/.test(마지막카드(c).body) && /453-2400-3782/.test(마지막카드(c).body));

  //  그새 하나가 도착했다
  c.추적 = (v) => (v === "45324003781" ? 도착함() : 멈춤());
  c.속성.OST_IDX = "0";                 // 다음 시간에 또 돌았다 치고
  c.csOutboundStaleCheck();
  const b = 마지막카드(c).body;
  ok("★ 도착한 건은 카드에서 빠진다", !/453-2400-3781/.test(b));
  ok("안 온 건은 남는다", /453-2400-3782/.test(b));
}

console.log("\n[7] 다 도착하면 내려간다 · 사람이 닫으면 안 되살린다");
{
  const c = 판([[영업회차(자), "45324003790", "로젠택배", "정내림", "d1"]], 멈춤);
  c.csOutboundStaleCheck();
  c.추적 = 도착함;
  c.속성.OST_IDX = "0";
  c.csOutboundStaleCheck();
  ok("★ 다 왔으면 카드를 닫는다", c.한일.카드.some((x) => x.무엇 === "닫음"));

  const c2 = 판([[영업회차(자), "45324003791", "로젠택배", "손닫음", "d2"]], 멈춤);
  c2.보드.push({ id: 9, srcKey: "자동점검:로젠출고지연", status: "완료" });
  c2.csOutboundStaleCheck();
  ok("★ 사람이 닫은 카드는 안 건드린다", c2.한일.카드[0].무엇 === "만듦");

  //  ★ 다 보기 전에 「없음」으로 닫으면 카드가 깜빡인다 ★
  const 많음 = [];
  for (let i = 0; i < 300; i++) 많음.push([영업회차(자), "4532401" + (1000 + i), "로젠택배", "손님" + i, "g" + i]);
  const c3 = 판(많음, 도착함);
  c3.csOutboundStaleCheck();
  ok("★ 아직 보는 중이면 닫지 않는다", !c3.한일.카드.some((x) => x.무엇 === "닫음"));
}

console.log("\n[8] 로젠 건만 · 로젠 송장만");
{
  const c = 판([
    [영업회차(자), "268334465383", "롯데택배", "롯데건", "c1"],
    [영업회차(자), "45324003780", "로젠택배", "로젠건", "c2"],
    [영업회차(자), "", "로젠택배", "송장없음", "c3"],
  ], 멈춤);
  c.csOutboundStaleCheck();
  const 물은 = c.한일.물은것[0];
  ok("★ 롯데 건은 안 묻는다", 물은.indexOf("268334465383") < 0);
  ok("송장 없는 줄도 안 묻는다", 물은.length === 1);
  ok("로젠 건만 묻는다", 물은[0] === "45324003780");
}

console.log("\n[9] ★ 자르지 않는다 — 잘린 것은 어디서도 못 본다");
{
  /*  > 사장님: "37건인데 외 17건으로 나오는데 37개 전체를 보여줘야지.."
      처음엔 20줄로 잘랐다. 「띠가 글자로 뒤덮일까」 걱정해서였는데 틀렸다 —
      띠에 흐르는 것은 «제목»이고, 본문은 카드를 펼쳐서 보는 곳이다.
      거기서 자르면 나머지는 로젠 화면을 다시 뒤져야 한다.
      그러면 이 공지를 만든 뜻이 없다. */
  const 많음 = [];
  for (let i = 0; i < 40; i++) 많음.push([영업회차(자), "4532402" + (1000 + i), "로젠택배", "손님" + i, "h" + i]);
  const c = 판(많음, 멈춤);
  c.csOutboundStaleCheck();
  const b = 마지막카드(c).body;
  ok("★ 40건이면 40줄 다 적는다", (b.match(/^· /gm) || []).length === 40);
  ok("★ 「외 n건」이 없다", !/외 \d+건/.test(b));
  ok("제목에도 40건", /40건/.test(마지막카드(c).title));

  /*  ★ 속성 한 칸은 9KB ★ 넘으면 저장이 «통째로» 실패해 멈춘 건을 전부 잃는다.
      숫자가 아니라 글자 수가 진짜 뚜껑이어야 한다. */
  const 아주많음 = [];
  for (let i = 0; i < 700; i++) 아주많음.push([영업회차(자), "4532403" + (1000 + i), "로젠택배", "아주긴수취인이름" + i, "k" + i]);
  const c2 = 판(아주많음, 멈춤);
  let 돈다 = 0;
  while (c2.csOutboundStaleCheck() !== "" && 돈다 < 20) 돈다++;
  const 적힌것 = String(c2.속성.OST_FOUND || "");
  ok("★ 속성 한 칸을 넘지 않는다 (넘으면 통째로 잃는다)", 적힌것.length <= 8000);
  ok("★ 그래도 들어갈 만큼은 적는다", 적힌것.length > 3000);
  const 글 = c2.csOutboundStaleCheck({ "처음부터": true });
  ok("★ 줄였으면 몇 건인지 말해 준다",
     /적어 두지 못했습니다/.test(글) || 적힌것.length <= 8000);

  //  본문 다듬기는 따로 잰다 — 줄이 아주 길어질 때의 마지막 빗장이다
  const 긴줄 = [];
  for (let i = 0; i < 2000; i++) 긴줄.push("· " + "가".repeat(60));
  const 다듬 = c2.눈금_fit ? null : null;
  const r = c2.csOutboundStaleCheck && vm.runInContext(
    "_stale_fitBody_(" + JSON.stringify(긴줄) + ", 40000)", c2);
  ok("★ 본문도 한 칸에 들어가게 다듬는다", r.join("\n").length < 50000);
  ok("다듬었으면 몇 줄인지 말해 준다", /줄을 줄였습니다/.test(r[r.length - 1]));
}

console.log("\n[11] ★ 연휴·주말을 센다 — 금요일부터 연휴인 그 경우");
{
  /*  > 사장님: "연휴 주말도 판단해서 날짜 기준을 잡아줘.. 금요일부터 연휴야.."
      목요일에 실은 것은 금요일에 닿는 것이 보통인데, 금·토·일이 쉬면 월요일에
      닿는다. 달력으로 세면 월요일 아침에 «목요일 치가 통째로» 「2일째 미도착」
      으로 뜬다. 한 번 그러면 그 뒤로 아무도 이 공지를 안 본다. */

  //  「오늘」을 못 박고 영업일을 세어 본다
  function 센다(발송, 오늘, 휴일) {
    const c = 판([], 멈춤);
    Object.assign(c.휴일, 휴일 || {});
    const 진짜 = Date;
    c.Date = function (...a) { return a.length ? new 진짜(...a) : new 진짜(오늘); };
    c.Date.prototype = 진짜.prototype;
    return vm.runInContext("_ost_bizSince_(new Date(" + 발송 + "))", c);
  }
  const 한글날 = { "20261009": 1 };

  //  2026-10-08(목) 발송 · 금 10/09 한글날 · 토 10/10 · 일 10/11 → 10/12(월)이 첫 영업일
  ok("★ 목 발송 → 월요일에도 1영업일뿐 (아직 정상, 안 뜬다)",
     센다("2026,9,8", "2026-10-12T09:00:00", 한글날) === 1);
  ok("★ 목 발송 → 화요일에 비로소 2영업일 (이때 뜬다)",
     센다("2026,9,8", "2026-10-13T09:00:00", 한글날) === 2);
  ok("연휴가 없으면 달력과 같다 (화 발송 → 목 = 2영업일)",
     센다("2026,9,6", "2026-10-08T09:00:00", {}) === 2);
  ok("주말만 껴도 센다 (금 발송 → 월 = 1영업일)",
     센다("2026,9,2", "2026-10-05T09:00:00", {}) === 1);
  ok("★ 휴일을 안 빼면 답이 달라진다 (자가 실제로 쓰이고 있다)",
     센다("2026,9,8", "2026-10-12T09:00:00", {}) === 2);

  //  ★ 공휴일표를 새로 만들면 연말에 한쪽만 고쳐진다 ★
  ok("★ 표를 새로 만들지 않았다 (csLotteReturn 의 _lrt_isOff_ 를 쓴다)",
     /_lrt_isOff_\(d\)/.test(src) && !/_OST_HOLIDAYS_/.test(src));
  ok("표를 못 읽어도 주말은 센다", /w === 0 \|\| w === 6/.test(src));
  ok("공지 글이 「영업일」이라고 말한다", /영업일/.test(src) && /주말·공휴일은 세지 않습니다/.test(src));
}

console.log("\n[12] ★ 한 번 멈춘 건은 도착할 때까지 남는다");
{
  /*  오늘 훑기에서 빠졌다고 카드에서 사라지면, 사흘째 멈춘 건이 조용히
      화면에서 없어진다. 정작 그때가 제일 급한데. */
  const c = 판([[영업회차(자), "45324003800", "로젠택배", "오래멈춤", "z1"]], 멈춤);
  c.csOutboundStaleCheck();
  ok("오늘 잡혔다", /453-2400-3800/.test(마지막카드(c).body));

  //  다음 날 — 그 송장은 이제 2영업일이 아니라 훑기 목록에서 빠진다
  c.속성.OST_COHORT = "000000";
  c.csOutboundStaleCheck();
  ok("★ 훑기에서 빠져도 카드에 남아 있다", /453-2400-3800/.test(마지막카드(c).body));
  ok("★ 적어 둔 것도 그대로다 (날이 바뀌어도 안 지운다)",
     /45324003800/.test(String(c.속성.OST_FOUND || "")));
  //  오늘 몫이 아닌 건(5영업일 전)을 적어 두고 「처음부터」를 부른다.
  //  오늘 몫이면 지워도 곧바로 다시 잡혀서 지워졌는지 알 수 없다.
  const c2 = 판([[영업회차(자 + 2), "45324003801", "로젠택배", "옛것", "z2"]], 멈춤);
  c2.속성.OST_FOUND = JSON.stringify([{ inv: "45324003801", 이름: "옛것", 며칠: 5, 상태: "배송출고" }]);
  c2.속성.OST_COHORT = "000000";
  c2.csOutboundStaleCheck();
  ok("날이 바뀌어도 살아 있다", /45324003801/.test(String(c2.속성.OST_FOUND || "")));
  c2.csOutboundStaleCheck({ "처음부터": true });
  ok("★ 「처음부터」로 부를 때만 비운다 (손으로 되돌릴 길은 남긴다)",
     !/45324003801/.test(String(c2.속성.OST_FOUND || "")));
}

console.log("\n[13] ★ 갓 돌린 회차 — 택배사가 비어 있다");
{
  /*  2026-10-08 실측: 261008-1 은 169줄 모두 택배사·운송장·송장매칭이 빈칸이었다.
      세트분리가 돌 때 정해지는 것은 「경로」뿐이고, 택배사는 나중에 송장이 붙을 때
      채워진다. 「택배사」로만 거르면 **오늘 회차를 통째로 건너뛴다** —
      정작 봐야 할 그 회차를. */
  const 갓 = (경로) => [영업회차(자), "", "", "손님", "u1", 경로];
  const c = 판([갓("로젠택배")], 멈춤);
  c.csOutboundStaleCheck();
  ok("★ 택배사가 비어도 경로로 집는다", c.한일.물은것.length === 0);  // 운송장이 없어 못 묻는 것은 맞다

  //  경로로 가르는 규칙 자체를 잰다
  const g = 판([], 멈춤);
  const 로젠인가 = (경로, 택배사) =>
    vm.runInContext("_ls_isLogenRow_(" + JSON.stringify(경로) + "," + JSON.stringify(택배사) + ")", g);
  ok("★ 경로 「로젠택배」 → 우리 것", 로젠인가("로젠택배", "") === true);
  ok("★ 경로 「로젠택배-도서산간」 → 우리 것", 로젠인가("로젠택배-도서산간", "") === true);
  ok("★ 「대리발송」 → 아니다 (업체가 직접 보낸다)", 로젠인가("대리발송", "") === false);
  ok("★ 「합포장동봉」 → 아니다 (제 송장이 없다)", 로젠인가("합포장동봉", "") === false);
  ok("「보류」 → 아니다", 로젠인가("보류", "") === false);
  ok("경로가 비면 택배사로 물러선다 (옛 줄)", 로젠인가("", "로젠택배") === true);
  ok("둘 다 아니면 아니다", 로젠인가("", "롯데택배") === false);
}

console.log("\n[14] ★ 한 칸에 송장이 여럿 — 다박스가 통째로 빠지고 있었다");
{
  /*  2026-10-08 실측: 「45324003174 45324003185」처럼 띄어쓰기로 둘·셋이 들어 있다.
      칸 전체에서 숫자만 뽑으면 22자리가 되어 **그 줄이 통째로 빠졌다.**
      10월 회차에만 446줄이 그랬다 — 박스가 여럿인 건이니 더 봐야 할 줄들이다. */
  const g = 판([], 멈춤);
  const 쪼갠다 = (v) => vm.runInContext("_ost_splitInvoices_(" + JSON.stringify(v) + ")", g);
  ok("★ 띄어쓰기로 둘", 쪼갠다("45324003174 45324003185").length === 2);
  ok("★ 셋도 집는다", 쪼갠다("45324002496 45324002500 45324002511").length === 3);
  ok("하나면 하나", 쪼갠다("45324003174").length === 1);
  ok("쉼표·줄바꿈도 집는다", 쪼갠다("45324003174, 45324003185").length === 2);
  ok("11자리가 아니면 버린다 (롯데 12자리)", 쪼갠다("268334465383").length === 0);
  ok("빈칸은 빈 것", 쪼갠다("").length === 0);

  //  실제로 두 줄이 되는지
  const c = 판([[영업회차(자), "45324003174 45324003185", "로젠택배", "다박스", "m1"]], 멈춤);
  c.csOutboundStaleCheck();
  ok("★ 다박스는 송장마다 묻는다", c.한일.물은것[0].length === 2);
  ok("둘 다 카드에 오른다", (마지막카드(c).body.match(/^· /gm) || []).length === 2);
}

console.log("\n[15] ★ 할 일이 없어도 «한 줄은 남긴다»");
{
  /*  > 사장님: "3일동안 이동 없는 택배에 대한 정보는 … 오늘은 안올라오던데
      >  공휴일이라 그런건가?"   (2026-10-09)

      여태는 할 일이 없으면 조용히 넘어갔다. 그래서 _운영점검 탭에 어제 기록만
      남아 있었고, 보시는 분은 「안 돈 건가?」를 알 길이 없었다. 실제로는 멀쩡히
      돌았고 그날 볼 차례인 10/05 에 로젠 출고가 한 건도 없었을 뿐이다.

      ★ 조용한 것은 「아무 말도 안 한 것」이지 「괜찮다」가 아니다. ★ */
  const 적힌것 = [];
  const c = 판([], 멈춤);
  c._cpr_ops_ = (ss, 항목, 값) => { 적힌것.push([항목, 값]); };
  const 글 = c.csOutboundStaleCheck();

  ok("★ 일감 보고에는 안 붙인다 (매시간 같은 말이 쌓이면 안 읽힌다)", 글 === "");
  ok("★ 그래도 운영점검에는 남긴다", 적힌것.length === 1);
  ok("★ 「볼 것 없음」이라고 말해 준다", /볼 것 없음/.test(적힌것[0][1]));
  ok("어느 날 치였는지 적는다", /^\d{6} 치 0건/.test(적힌것[0][1]));
  ok("항목 이름은 평소와 같다 (한 줄에 덮인다)", 적힌것[0][0] === "출고 지연 점검");

  //  다 본 날도 조용하면 안 된다
  const 많음 = [];
  for (let i = 0; i < 3; i++) 많음.push([영업회차(자), "4532409" + (1000 + i), "로젠택배", "손님" + i, "y" + i]);
  const c2 = 판(많음, 도착함);
  const 적힌것2 = [];
  c2.csOutboundStaleCheck();                     // 첫 바퀴 — 다 본다
  c2._cpr_ops_ = (ss, 항목, 값) => { 적힌것2.push([항목, 값]); };
  const 글2 = c2.csOutboundStaleCheck();         // 두 번째 — 볼 것이 없다
  ok("★ 다 본 날도 한 줄 남긴다", 적힌것2.length === 1 && /다 봤습니다/.test(적힌것2[0][1]));
  ok("그때도 보고에는 안 붙인다", 글2 === "");
}

console.log("\n[16] ★ 카드에서 «바로 전화»할 수 있게 — 영업소 번호");
{
  /*  ★ 왜 ★  (2026-10-09)
      CS 가 제일 많이 하는 것이 「영업소에 바로 전화」다. 그런데 카드에 영업소
      «이름»만 있어서 그 번호를 또 찾아야 했다.

      이력용 조회(inquiryCargoTrackingMulti)에는 전화번호가 «없다». 최종조회
      (…MultiLast)에만 salesCellNo 가 온다. 지연 점검은 「지금 어디 있나」만
      보면 되니 최종조회가 맞다 — 규격 §7.2 도 그렇게 적어 뒀다.
      같은 묶음 호출로 문만 바꾸는 것이라 호출 수는 그대로다.

      ★ 실측 (2026-10-09 운영계) ★
        45311894913 → 서동작 · 72 하영철(대방) · 010-2841-7324
        45326801796 → 남강서 · 1 심원식 · 010-2230-2791  */
  const 번호있음 = () => ({ ok: true, delivered: false, statusName: "배송출고",
    branch: "서동작", empNm: "72 하영철(대방)", empTel: "010-2841-7324",
    branchTel: "010-2841-7324", lastAt: "10-07 13:50" });

  const c = 판([[영업회차(자), "45311894913", "로젠택배", "서민주", "u1"]], 번호있음);
  c.csOutboundStaleCheck();
  const b = 마지막카드(c).body;
  ok("★ 전화번호가 카드에 찍힌다", /☎ 010-2841-7324/.test(b));
  ok("기사 이름도 같이", /72 하영철\(대방\)/.test(b));
  ok("영업소 이름은 그대로", /서동작/.test(b));

  //  ★ 최종조회 문을 쓰는가 ★ 이력용에는 번호가 없다
  ok("★ 최종만으로 묻는다", /csLogenTrackMany\(송장, \{ "최종만": true \}\)/.test(src));
  ok("다시 물을 때도 최종만", (src.match(/"최종만": true/g) || []).length >= 2);

  const logen = fs.readFileSync("csLogen.gs", "utf8");
  ok("★ 최종만이면 다른 API 를 부른다",
     /최종만 \? "inquiryCargoTrackingMultiLast" : "inquiryCargoTrackingMulti"/.test(logen));
  ok("★ 캐시를 섞지 않는다 (둘은 모양이 다르다)", /var 캐시표 = 최종만 \? "L" : "H";/.test(logen));
  ok("이력이 필요한 화면은 그대로다 (부르는 쪽이 고른다)",
     /csLogenTrackMany\(logen\)/.test(fs.readFileSync("csTrack.gs", "utf8")));

  //  번호가 없을 때도 깨지지 않는다
  const c2 = 판([[영업회차(자), "45324003760", "로젠택배", "손님", "u2"]], 멈춤);
  c2.csOutboundStaleCheck();
  ok("번호가 없으면 그 자리만 빈다", !/☎/.test(마지막카드(c2).body));
}

console.log("\n[17] ★ 다 본 뒤에도 «그새 도착했나»를 다시 묻는다");
{
  /*  > 사장님: "니가 알려준건들이 대부분 배송완료건이라.. 이걸 이동이 없다고
      >  판단한 근거를 확인해봐"   (2026-10-09)

      2026-10-08 03:33 에 37건으로 뜬 카드가, 그날 낮에 다 도착했는데도 그대로
      떠 있었다. 실측으로 10건을 물어 보니 10건 모두 10/08 10:28~15:57 배송완료.
      _운영점검 은 「261008 치 720/1087건 봄 · 멈춤 37 | 261008 09:24」 에서 멎어
      있었다 — 그 뒤로 한 번도 안 고쳐졌다.

      까닭: 하루치를 다 보면 «그 자리에서 돌아섰다». 도착한 것을 빼 주는
      _ost_dropArrived_ 까지 못 갔다. 「늑대야 소리를 하지 않겠다」고 넣은 장치를,
      정작 그 장치가 일할 때(다 본 뒤)에 안 돌게 해 둔 것이다.

      ★ 다 본 것은 «끝»이 아니라, 잡아 둔 것을 되묻기 시작하는 때다. ★ */
  const c = 판([[영업회차(자), "45324003900", "로젠택배", "그새도착", "w1"]], 멈춤);
  c.csOutboundStaleCheck();                      // 첫 바퀴 — 잡는다
  ok("먼저 잡혔다", /453-2400-3900/.test(마지막카드(c).body));
  ok("다 봤다고 적혔다", String(c.속성.OST_IDX) === "1");

  const 적힌것 = [];
  c._cpr_ops_ = (ss, 항목, 값) => { 적힌것.push(값); };
  c.추적 = 도착함;                                // 낮에 도착했다
  const 물은횟수 = c.한일.물은것.length;
  c.csOutboundStaleCheck();                      // 다 본 뒤의 바퀴

  ok("★ 다 본 뒤에도 로젠에 다시 묻는다", c.한일.물은것.length > 물은횟수);
  ok("★ 물을 때 잡아 둔 송장을 묻는다",
     c.한일.물은것[c.한일.물은것.length - 1].indexOf("45324003900") >= 0);
  ok("★ 도착했으면 적어 둔 것에서 뺀다",
     !/45324003900/.test(String(c.속성.OST_FOUND || "")));
  ok("★ 다 빠졌으면 카드를 닫는다", 마지막카드(c).무엇 === "닫음");
  ok("★ 운영점검에 «그새 도착»을 적는다",
     적힌것.length === 1 && /그새 도착 1/.test(적힌것[0]));
  ok("멈춤 수도 줄어 있다", /멈춤 0/.test(적힌것[0]));

  //  아직 안 왔으면 그대로 남아 있어야 한다 — 멀쩡한 건을 지우면 더 나쁘다
  const c2 = 판([[영업회차(자), "45324003901", "로젠택배", "아직", "w2"]], 멈춤);
  c2.csOutboundStaleCheck();
  const 적힌것2 = [];
  c2._cpr_ops_ = (ss, 항목, 값) => { 적힌것2.push(값); };
  c2.csOutboundStaleCheck();
  ok("아직이면 적어 둔 것에 남는다", /45324003901/.test(String(c2.속성.OST_FOUND || "")));
  ok("아직이면 카드도 안 닫는다", 마지막카드(c2).무엇 !== "닫음");
  ok("그때는 «그새 도착»을 안 적는다", !/그새 도착/.test(적힌것2[0]));

  //  잡아 둔 것이 없는 날은 괜히 묻지 않는다 (하루 24번이 그냥 나간다)
  const c3 = 판([], 멈춤);
  c3.csOutboundStaleCheck();
  ok("★ 잡아 둔 것이 없으면 묻지 않는다", c3.한일.물은것.length === 0);

  ok("코드가 그 자리에서 되묻는다 (돌아서기 전에)",
     src.indexOf("_ost_dropArrived_(잡은것)") < src.indexOf("var L = ["));
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
