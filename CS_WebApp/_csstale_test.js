/**
 * 2일 넘게 멈춘 반품 — «보이게 하되, 쌓이지 않게»
 *
 * ★ 이 시험이 지키는 것 ★
 *   207 은 접수번호까지 받아 놓고 5일째 멈춰 있었는데, 그걸 «우연히» 알았다.
 *   세고는 있었지만 Logger.log 에만 남았고 어느 줄인지도 안 알려줬다.
 *
 *   그래서 사람이 이미 보는 곳(공지 띠 = 인수인계보드)에 올린다. 그런데
 *   1시간마다 도는 일감이 부르는 것이라 **쌓이면 재앙**이다 —
 *     · 매번 새 카드를 만들면 하루 24장이 쌓여 사람이 쓰는 카드를 덮는다
 *     · 다 풀렸는데 안 닫으면 띠에 영영 남아 「또 그 소리」가 되고 아무도 안 본다
 *     · 사람이 손으로 닫은 카드를 되살리면 그 사람의 판단을 되돌리는 것이다
 *   셋 다 「알림이 있으나 마나」로 끝난다. 그 자리를 못 박는다.
 *
 * 실행: node _csstale_test.js
 */
const fs = require("fs");
const vm = require("vm");

const src = fs.readFileSync("csLogenStale.gs", "utf8");
const fill = fs.readFileSync("csLogenSlipFill.gs", "utf8");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}

/*  울타리 — 보드는 흉내만 낸다. 무엇을 «불렀는지»가 이 시험이 볼 것이다. */
function 판() {
  const 한일 = [];
  const ctx = {
    console, String, Number, Array, Math, JSON,
    보드: [],
    csListHandoffCards: () => ({ ok: true, rows: ctx.보드 }),
    csCreateHandoffCard: (p) => {
      한일.push({ 무엇: "만듦", level: p.level, title: p.title, body: p.body, srcKey: p.srcKey });
      ctx.보드.push({ id: 1, srcKey: p.srcKey, status: "진행", title: p.title });
      return { ok: true, id: 1 };
    },
    csEditHandoffCard: (p) => {
      한일.push({ 무엇: "고침", id: p.id, title: p.title, body: p.body, level: p.level });
      return { ok: true };
    },
    csCompleteHandoffCard: (p) => {
      한일.push({ 무엇: "닫음", id: p.id });
      const c = ctx.보드.find((x) => x.id === p.id); if (c) c.status = "완료";
      return { ok: true };
    },
    csLogenFillReturnSlips: () => "",
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.한일 = 한일;
  return ctx;
}

const 줄 = (어디, 며칠, 이름) => ({ 어디, 며칠, 이름: 이름 || "홍길동",
                                   takeNo: "261002111093", 상태: "집하영업소배정" });

console.log("\n[1] 멈춘 게 있으면 올린다");
{
  const c = 판();
  const r = c.csStaleReport_([줄("202609!207", 5)]);
  const a = c.한일[0];
  ok("카드를 만든다", a && a.무엇 === "만듦");
  ok("★ 긴급으로 올린다 (공지 띠에 뜨게)", a.level === "긴급");
  ok("★ «어느 줄»인지 적는다", /202609!207/.test(a.body));
  ok("★ 며칠째인지 적는다", /5일째/.test(a.body));
  ok("수취인 이름도 적는다", /홍길동/.test(a.body));
  ok("접수번호를 적는다 (로젠에 그대로 물으면 된다)", /261002111093/.test(a.body));
  ok("상태도 적는다", /집하영업소배정/.test(a.body));
  ok("제목에 건수가 보인다", /1건/.test(a.title));
  ok("돌려주는 말이 사람 말이다", /올림/.test(r));
}

console.log("\n[2] ★ 쌓이지 않는다 — 1시간마다 부르는 것이다");
{
  const c = 판();
  c.csStaleReport_([줄("202609!207", 5)]);
  c.csStaleReport_([줄("202609!207", 5)]);
  c.csStaleReport_([줄("202609!207", 6), 줄("202609!212", 3)]);
  const 만듦 = c.한일.filter((x) => x.무엇 === "만듦");
  const 고침 = c.한일.filter((x) => x.무엇 === "고침");
  ok("★ 카드는 «한 장»만 만든다", 만듦.length === 1);
  ok("★ 그 뒤로는 갈아 끼운다", 고침.length === 2);
  ok("★ 갈아 낀 내용이 최신이다", /6일째/.test(고침[1].body) && /202609!212/.test(고침[1].body));
  ok("제목도 같이 고친다 (1건 → 2건)", /2건/.test(고침[1].title));
}

console.log("\n[3] ★ 다 풀리면 내려간다");
{
  const c = 판();
  c.csStaleReport_([줄("202609!207", 5)]);
  const r = c.csStaleReport_([]);
  ok("★ 열린 카드를 닫는다", c.한일.some((x) => x.무엇 === "닫음"));
  ok("닫았다고 말해 준다", /내림/.test(r));

  //  이미 깨끗하면 아무것도 안 한다 — 빈 카드를 만들지 않는다
  const c2 = 판();
  const r2 = c2.csStaleReport_([]);
  ok("★ 멈춘 게 없으면 카드를 만들지 않는다", c2.한일.length === 0);
  ok("그래도 말은 해 준다", /없음/.test(r2));
}

console.log("\n[4] ★ 사람이 닫은 카드는 되살리지 않는다");
{
  const c = 판();
  c.보드.push({ id: 9, srcKey: "자동점검:로젠반품지연", status: "완료" });
  c.csStaleReport_([줄("202609!207", 5)]);
  const a = c.한일[0];
  ok("★ 닫힌 카드를 고치지 않는다", a.무엇 !== "고침");
  ok("새 카드를 만든다 (새로 멈춘 건이다)", a.무엇 === "만듦");
}

console.log("\n[5] 많으면 줄인다 — 띠가 글자로 뒤덮이지 않게");
{
  const c = 판();
  const 많음 = [];
  for (let i = 0; i < 40; i++) 많음.push(줄("202609!" + (100 + i), 3));
  c.csStaleReport_(많음);
  const b = c.한일[0].body;
  ok("★ 40건이면 40줄 다 적는다 (자르지 않는다)", (b.match(/^· /gm) || []).length === 40);
  ok("「외 n건」이 없다", !/외 d+건/.test(b));
  ok("제목에도 40건", /40건/.test(c.한일[0].title));
}

console.log("\n[6] 오래 멈춘 것부터 보여준다");
{
  const c = 판();
  c.csStaleReport_([줄("202609!1", 2), 줄("202609!2", 9), 줄("202609!3", 5)]);
  const b = c.한일[0].body;
  ok("★ 9일째가 맨 위", b.indexOf("202609!2") < b.indexOf("202609!3"));
  ok("2일째가 맨 아래", b.indexOf("202609!3") < b.indexOf("202609!1"));
}

console.log("\n[7] 자동 채우기와 맞물리나");
{
  /*  자는 csLogenOutStale.gs 의 _OST_FROM_DAYS_ 와 «같아야» 한다 —
      출고와 반품이 다른 자로 말하면 보는 사람이 헷갈린다.
      값이 맞는지는 _csoutstale_test.js [0] 에서 한 번만 못 박는다. */
  const out = fs.readFileSync("csLogenOutStale.gs", "utf8");
  const 자 = Number((out.match(/_OST_FROM_DAYS_ = (\d+)/) || [])[1]);
  ok("★ 반품 자가 출고 자와 같다",
     new RegExp("_LSF_STALE_DAYS_ = " + 자 + ";").test(fill));
  ok("★ «어느 줄»인지 모은다 (수만 세지 않는다)", /var 멈춘것 = \[\];/.test(fill));
  ok("원송장 경로가 모은다", /멈춘것\.push\(\{ 어디: 어디,/.test(fill));
  ok("접수번호 경로도 모은다", /멈춘것\.push\(\{ 어디: 어디T,/.test(fill));
  ok("수취인 이름을 싣는다", /name: col\.name >= 0/.test(fill));
  ok("끝에 공지로 넘긴다", /csStaleReport_\(멈춘것\)/.test(fill));

  //  ★ 손으로 돌려 보다가 실제 공지를 바꾸면 안 된다 ★
  ok("★ 연습(dry)이면 띠를 안 건드린다", /if \(!dry && !opt\["공지안함"\]\)/.test(fill));
  ok("공지 처리가 실패해도 채우기는 돈다", /catch \(e\) \{ L\.push\("★ 공지 처리 실패/.test(fill));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
