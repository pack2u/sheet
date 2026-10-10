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
    //  묻어두기(_stale_mute*)가 쓰는 것들
    속성: {},
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in ctx.속성 ? ctx.속성[k] : null),
      setProperty: (k, v) => { ctx.속성[k] = String(v); },
    }) },
    Utilities: { formatDate: (d) => {
      const p = (x) => String(x).padStart(2, "0");
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
    } },
    Date,
    Object,
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

console.log("\n[묻어두기] ★ 사람이 닫으면 이레 · 이레 뒤엔 다시 올린다");
{
  /*  ─ 2026-10-10 · 사장님 「중간 길로 해줘」 ─
      이 공지들은 「풀릴 때까지 들고 있기」다. 그런데 영영 안 풀리는 건이 있다 —
      아예 안 실려 간 건(10/08 치 7건: "오래되서 이제 처리불가"), 분실·취소,
      그리고 **43856227041 은 2026-02-25 부터 「독촉」에 멈춰 있다(여덟 달)**.
      닫아도 다음 런이 같은 줄로 새 카드를 세우니 아무도 끝낼 수 없었다.
      매시간 닫아야 하는 늑대야가 되면 **정작 새로 멈춘 건을 아무도 안 본다.**

      ★ 그렇다고 영영 묻으면 안 된다 ★ 잘못 닫는 일이 있다. 지금은 잘못 닫아도
      다음 런이 다시 세워 준다 — 그 안전망을 버리지 않는다.
      그래서 가운데: **닫으면 이레 묻고, 이레 뒤에도 멈춰 있으면 다시 올린다.** */

  /*  ★ 접수번호를 달리 둔다 ★ 줄() 은 접수번호를 한 값으로 박아 둔다. 그대로
      쓰면 두 줄이 «한 건»으로 묶인다 — 그게 맞는 동작이다(같은 접수의 다박스는
      한 건이다). 여기서는 다른 두 건을 보려는 것이니 번호를 갈라 준다. */
  const 줄2 = (어디, 며칠, takeNo) =>
    Object.assign(줄(어디, 며칠), { takeNo: takeNo });

  //  ① 사람이 닫으면 묻는다 — 그리고 카드를 다시 세우지 않는다
  const c = 판();
  c.csStaleReport_([줄2("202610!36", 5, "T001"), 줄2("202610!40", 4, "T002")]);
  ok("먼저 카드가 섰다", c.한일.some((x) => x.무엇 === "만듦"));

  //  사람이 닫는다 (완료자가 자동점검이 «아니다»)
  c.보드[0].status = "완료";
  c.보드[0].doneBy = "강서희";

  const 전 = c.한일.length;
  const 말 = c.csStaleReport_([줄2("202610!36", 6, "T001"), 줄2("202610!40", 5, "T002")]);
  ok("★ 사람이 닫은 뒤에는 카드를 다시 세우지 않는다",
     !c.한일.slice(전).some((x) => x.무엇 === "만듦" || x.무엇 === "고침"));
  ok("★ 몇 건을 묻었는지 말해 준다 (조용히 묻지 않는다)",
     /사람이 닫아 2건 7일 묻어둠/.test(말), 말);
  ok("묻어둔 수도 적는다", /묻어둔 것 2/.test(말));
  ok("★ 속성에 남는다 (런이 바뀌어도 기억한다)",
     /T001/.test(String(c.속성["STALE_MUTE_RET"] || "")) &&
     /T002/.test(String(c.속성["STALE_MUTE_RET"] || "")));

  /*  ★ 같은 접수의 다박스는 «한 건»이다 ★ 줄이 셋이어도 접수번호가 같으면
      사람 눈에 한 건이고, 묻을 때도 한 건이어야 한다. 10/08 치 7건이 실제로
      주문 셋이었던 것과 같은 이야기다. */
  const cD = 판();
  cD.csStaleReport_([줄("202610!70", 3), 줄("202610!71", 3), 줄("202610!72", 3)]);
  cD.보드[0].status = "완료"; cD.보드[0].doneBy = "강서희";
  const 말D = cD.csStaleReport_([줄("202610!70", 4), 줄("202610!71", 4), 줄("202610!72", 4)]);
  ok("★ 접수번호가 같으면 한 건으로 묻는다", /사람이 닫아 1건/.test(말D), 말D);

  //  ② ★ 두 번 묻지 않는다 ★ 매 런마다 다시 묻으면 만료가 끝없이 밀려 «영영 안 뜸»이 된다
  const 말2 = c.csStaleReport_([줄("202610!36", 7)]);
  ok("★ 같은 카드로 두 번 묻지 않는다 (만료가 밀리면 영영 안 뜬다)",
     !/사람이 닫아/.test(말2), 말2);
  ok("그래도 묻어둔 것은 말해 준다", /묻어둔 것 /.test(말2));

  //  ③ ★ 이레가 지나면 돌아온다 ★ 잘못 닫은 것이 «사라지지는» 않는다
  const c3 = 판();
  c3.csStaleReport_([줄("202610!50", 3)]);
  c3.보드[0].status = "완료"; c3.보드[0].doneBy = "강서희";
  c3.csStaleReport_([줄("202610!50", 4)]);
  ok("묻었다", /261002111093/.test(String(c3.속성["STALE_MUTE_RET"] || "")));

  //  만료를 어제로 돌려 놓는다 — 이레가 지난 셈
  const 어제 = new Date(); 어제.setDate(어제.getDate() - 1);
  const p2 = (x) => String(x).padStart(2, "0");
  const 어제ymd = 어제.getFullYear() + p2(어제.getMonth() + 1) + p2(어제.getDate());
  c3.속성["STALE_MUTE_RET"] = JSON.stringify({ "261002111093": 어제ymd });

  const 전3 = c3.한일.length;
  c3.csStaleReport_([줄("202610!50", 11)]);
  ok("★ 이레가 지나면 다시 올린다 (잘못 닫은 것이 사라지지 않는다)",
     c3.한일.slice(전3).some((x) => x.무엇 === "만듦"));

  //  ④ ★ «우리가» 닫은 것은 묻지 않는다 ★ 다 풀려서 닫은 것이라 묻을 것이 없다
  const c4 = 판();
  c4.csStaleReport_([줄("202610!60", 3)]);
  c4.csStaleReport_([]);                       // 다 풀렸다 → 우리가 닫는다
  ok("우리가 닫았다", c4.한일.some((x) => x.무엇 === "닫음"));
  const 말4 = c4.csStaleReport_([줄("202610!60", 4)]);
  ok("★ 우리가 닫은 것은 묻지 않는다 (완료자가 자동점검이다)",
     !/묻어둠/.test(말4), 말4);
  ok("그러니 새 카드가 선다 (다시 멈췄다는 뜻)",
     c4.한일.some((x) => x.무엇 === "만듦"));

  //  ⑤ 열쇠 — 반품에는 송장번호가 없다
  ok("★ 접수번호를 열쇠로 쓴다", /var t = String\(s\.takeNo/.test(src));
  ok("접수번호가 없으면 대장 자리(「202610!36」)로", /t \|\| String\(s\.어디/.test(src));

  //  ⑥ 출고 쪽도 같은 장치를 쓴다 — 두 벌로 만들지 않았다
  const ost = fs.readFileSync("csLogenOutStale.gs", "utf8");
  ok("★ 출고 쪽은 공용 장치를 부른다 (다시 짜지 않았다)",
     /_stale_muteOnClose_\("OST", _OST_SRCKEY_/.test(ost));
  ok("★ 들어오는 문에서도 막는다 (안 막으면 곧바로 되살아난다)",
     /if \(묻힌\[d\]\) continue;/.test(ost));
  ok("잡아 둔 목록에서도 뺀다", /if \(!묻힌표\[잡은것\[mj\]\.inv\]\)/.test(ost));
  ok("출고 쪽도 운영점검에 적는다", /사람이 닫아 " \+ 새로묻음/.test(ost));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
