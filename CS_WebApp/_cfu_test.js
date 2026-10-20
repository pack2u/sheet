/**
 * 금일 할 내용 — 통화에서 추린 것을 사람이 고른다
 *
 *  > "전화 통화 내용중에 추후에 할내용이 있는것이 다들어오는데.
 *  >  이부분은 따로 만드는게 나을꺼 같아.. 그중에 골라서 애프터 cs 로
 *  >  직원들이 옮기는것이 좋을꺼 같아"
 *  > "금일할 내용 옆에 확인 버튼을 누르면 사라지게해줘" · "애프터 CS로 보내기랑.."
 *
 *  지키는 것
 *    ① v2 는 cs_inquiries 에 ★자동으로 안 넣는다★ (After CS 가 자동 건에 묻혔다)
 *    ② 화면은 v2 가 준 요약·누구를 ★그대로★ 쓴다 (두 군데서 고르면 갈라진다)
 *    ③ 단추 둘 — 애프터 CS로 · 확인. 누르면 목록에서 내려간다
 *    ④ ★누르는 즉시 두 단추를 다 잠근다★ 안 그러면 두 번 간다
 *    ⑤ 담당자가 없으면 안 보낸다
 *    ⑥ 비면 상자째 숨고, 못 읽었으면 보여 준다
 *    ⑦ 확인해도 판정 줄은 안 지운다 (dismissed_at 만 찬다)
 *
 * 실행: node _cfu_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let fail = 0, pass = 0;
const 자리 = {
  home: path.join(__dirname, "home.html"),
  gs: path.join(__dirname, "csInquiry.gs"),
  fu: "D:/Pack2U_협력업체시스템_v2/app/src/lib/byto-call-followup.ts",
  api: "D:/Pack2U_협력업체시스템_v2/app/src/app/api/byto/followups/route.ts",
  sql: "D:/Pack2U_협력업체시스템_v2/sql/148_byto_call_fu_triage.sql",
};
const 읽기 = (k) => { try { return fs.readFileSync(자리[k], "utf8"); } catch (e) { return ""; } };

/*  화면 조각을 진짜 돌린다 */
function 틀(html) {
  const i = html.indexOf("var CFU_ROWS = []");
  const j = html.indexOf("function loadCsq(force) {", i);
  if (i < 0 || j < 0) return null;
  const 본것 = { 보낸것: [], 물은것: [], 토스트: [], 그린것: "" };
  const 단추들 = [];
  const el = (id) => ({
    id, textContent: "", innerHTML: "", hidden: false,
    querySelectorAll: () => 단추들,
  });
  const 상자 = el("cfuBox"), 목록 = el("cfuList"), 셈 = el("cfuCount");
  const ctx = {
    console,
    /*  ★ cfu-<serial> 줄도 돌려줘야 한다 ★ 처음에 이것을 빼먹어 「단추를 잠갔나」가
        밑판에서부터 실패했고, 그 하나가 깨기 줄마다 섞여 가짜 울음을 만들었다.  */
    document: {
      getElementById: (id) =>
        id === "cfuBox" ? 상자 : id === "cfuList" ? 목록 : id === "cfuCount" ? 셈
        : /^cfu-/.test(String(id)) ? el(id) : null,
    },
    esc: (s) => String(s == null ? "" : s),
    js: (s) => String(s == null ? "" : s),
    toast: (m) => 본것.토스트.push(String(m)),
    returnStaffName: () => ctx.__담당자,
    loadCsq: () => { 본것.loadCsq = true; },
    google: { script: { run: {
      withSuccessHandler(f) { this._s = f; return this; },
      withFailureHandler(f) { this._f = f; return this; },
      csListCallFollowups(p) { 본것.물은것.push(p || {}); if (ctx.__목록답) this._s(ctx.__목록답); return this; },
      csPickCallFollowup(p) { 본것.보낸것.push(p); if (ctx.__답) this._s(ctx.__답); return this; },
    } } },
    __담당자: "김CS",
    __답: { ok: true },
    __목록답: null,
    __본것: 본것, __단추들: 단추들, __상자: 상자, __목록: 목록, __셈: 셈,
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(i, j), ctx);
  return ctx;
}

function 재보기(고침) {
  고침 = 고침 || {};
  const g = (k) => (고침[k] !== undefined ? 고침[k] : 읽기(k));
  const 운것 = [];
  try {
    /* ① v2 가 자동으로 안 넣는다 */
    {
      const fu = g("fu");
      const 자료 = fu.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/from\("cs_inquiries"\)\.insert/.test(자료)) 운것.push("①자동으로넣음");
      //  판정은 그대로 쌓여야 한다
      if (!/await record\(c, \{/.test(자료)) 운것.push("①판정을안쌓음");
      //  보낼 때 쓸 상품도 적어 둬야 한다
      if (!/item: read\.item \|\| null/.test(자료)) 운것.push("①상품을안적음");
    }

    /* ② 요약·누구는 v2 가 정한다 */
    {
      const api = g("api");
      if (!/summary: String\(r\.extract \|\| r\.reason \|\| ""\)/.test(api)) 운것.push("②요약은v2가");
      if (!/who: 보일이름\(/.test(api)) 운것.push("②누구는v2가");
      //  보낼 때도 ★같은★ 보일이름을 쓴다 — 목록과 다르면 안 된다
      if ((api.match(/보일이름\(/g) || []).length < 2) 운것.push("②같은규칙으로보냄");
      if (!/문의본문\(/.test(api)) 운것.push("②본문도한곳에서");
    }

    /* ③④⑤⑥ 화면 */
    {
      const ctx = 틀(g("home"));
      if (!ctx) { 운것.push("③화면조각을못찾음"); return 운것; }

      //  비면 상자째 숨는다
      ctx.CFU_ROWS = [];
      ctx.renderCfu();
      if (!ctx.__상자.hidden) 운것.push("⑥비면숨김");

      //  못 읽었으면 보여 준다
      ctx.renderCfu("v2 가 안 열림");
      if (ctx.__상자.hidden) 운것.push("⑥오류는보여줌");
      if (!/못 읽었습니다/.test(ctx.__목록.innerHTML)) 운것.push("⑥까닭을적음");

      //  줄이 있으면 그린다
      ctx.CFU_ROWS = [
        { call_serial: "A1", verdict: "약속", summary: "월요일에 추가 발송", who: "📞 010-1234-5678" },
        { call_serial: "A2", verdict: "클레임", summary: "뚜껑 불량", who: "비타푸드 주희영" },
      ];
      ctx.renderCfu();
      const h = ctx.__목록.innerHTML;
      if (ctx.__상자.hidden) 운것.push("③있으면보임");
      if (ctx.__셈.textContent !== "2") 운것.push("③갯수(" + ctx.__셈.textContent + ")");
      if (!/애프터 CS로/.test(h)) 운것.push("③보내기단추");
      if (!/확인<\/button>/.test(h)) 운것.push("③확인단추");
      if (!/월요일에 추가 발송/.test(h)) 운것.push("③요약을그림");
      if (!/010-1234-5678/.test(h)) 운것.push("③누구를그림");
      if (!/cfu-kind claim/.test(h)) 운것.push("③클레임을가름");

      //  ④ 누르면 두 단추가 다 잠긴다
      const b1 = { disabled: false }, b2 = { disabled: false };
      ctx.__단추들.length = 0; ctx.__단추들.push(b1, b2);
      ctx.__답 = null;                       // 답을 안 주고 멈춰 둔다 — 잠갔는지만 본다
      ctx.cfuPick("A1", "보내기", b1);
      if (!b1.disabled || !b2.disabled) 운것.push("④두단추를다잠금");
      if (ctx.__본것.보낸것.length !== 1) 운것.push("④한번만보냄");

      //  ⑤ 담당자가 없으면 안 보낸다
      ctx.__본것.보낸것.length = 0;
      ctx.__담당자 = "";
      ctx.cfuPick("A2", "확인", b1);
      if (ctx.__본것.보낸것.length !== 0) 운것.push("⑤담당자없이보냄");
      if (!/담당자/.test(ctx.__본것.토스트.join(" "))) 운것.push("⑤담당자를말함");

      /*  ⑨ ★ 지난 것이 조용히 사라지지 않는다 ★   (2026-10-20)
       *
       *  목록을 「오늘 치」로 좁혀 놓았더니 어제 늦게 판정된 16건과 그림자
       *  시절 135건이 아무 자취 없이 묻혀 있었다. 「확인을 눌러야 사라진다」고
       *  적어 두고 정작 날짜로 사라지게 만든 꼴이다.
       */
      ctx.__목록답 = { ok: true, day: "2026-10-20", rows: [], older: 16 };
      ctx.CFU_AT = 0;
      ctx.loadCfu(true);
      if (ctx.__상자.hidden) 운것.push("⑨지난것이있는데숨김");
      if (!/지난 것 <b>16건<\/b>/.test(ctx.__목록.innerHTML)) 운것.push("⑨지난것을안알림");

      //  「보기」를 누르면 전부를 묻는다
      ctx.__본것.물은것.length = 0;
      ctx.cfuScope(true);
      if (!(ctx.__본것.물은것[0] && ctx.__본것.물은것[0].all)) 운것.push("⑨보기가전부를안물음");

      //  지난 줄에는 날짜 딱지가 붙는다 — 오늘 것과 섞이면 안 된다
      ctx.__목록답 = {
        ok: true, day: "2026-10-20", all: true, older: 0,
        rows: [{ call_serial: "B1", verdict: "약속", summary: "지난 약속", who: "가게",
                 at: "2026-10-16T05:00:00+00:00" }],
      };
      ctx.CFU_AT = 0;
      ctx.loadCfu(true);
      if (!/cfu-old/.test(ctx.__목록.innerHTML)) 운것.push("⑨지난날짜딱지가없음");
      if (!/>10\/16</.test(ctx.__목록.innerHTML)) 운것.push("⑨날짜가틀림");
      //  전부 보기에서는 되돌아갈 길이 보여야 한다
      if (!/오늘 것만 보기/.test(ctx.__목록.innerHTML)) 운것.push("⑨돌아갈길이없음");
    }

    /* ⑨' v2 와 다리도 「지난 것」을 나른다 */
    {
      const api = g("api");
      if (!/rows: 줄, older/.test(api)) 운것.push("⑨'older를안줌");
      if (!/searchParams\.get\("all"\) === "1"/.test(api)) 운것.push("⑨'전부보기가없음");
      /*  ★ 두 물음이 같은 잣대여야 한다 ★ 목록과 「지난 것 N건」이 어긋나면
          눌러도 안 나오거나, 0 건인데 꼬리가 서 있는 꼴이 된다.            */
      const 잣대 = api.match(
        /\.in\("verdict", \["약속", "클레임"\]\)\s*\.is\("cs_inquiry_id", null\)\s*\.is\("dismissed_at", null\)/g
      ) || [];
      if (잣대.length < 2) 운것.push("⑨'두물음의잣대가다름(" + 잣대.length + ")");
      const gs = g("gs");
      if (!/qs\.push\("all=1"\)/.test(gs)) 운것.push("⑨'다리가all을안나름");
    }

    /* ⑩ ★ 하루는 「통화한 때」로 가른다 ★   (2026-10-20)
     *
     *  판독(processed_at)은 몰아서 돌기도 한다. 그 값으로 하루를 가르면
     *  열흘 전 통화가 「오늘 할 일」로 서고 날짜 딱지도 거짓이 된다 —
     *  518줄 가운데 ★256줄(49%)★ 이 통화한 날과 판독한 날이 달랐다.
     *  10/19 에 뜬 16건이 실은 10/13 통화였다.
     */
    {
      const api = g("api");
      //  목록·꼬리 셈·정렬이 다 called_at 이어야 한다
      if (/\.(gte|lt)\("processed_at"/.test(api)) 운것.push("⑩판독때로하루를가름");
      if (!/\.order\("called_at"/.test(api)) 운것.push("⑩통화때로안줄세움");
      if (!/\.lt\("called_at", 끝\)/.test(api)) 운것.push("⑩끝이판독때");
      if (!/\.lt\("called_at", 시작\)/.test(api)) 운것.push("⑩꼬리셈이판독때");
      //  화면 날짜 딱지가 읽는 값
      if (!/at: String\(r\.called_at\)/.test(api)) 운것.push("⑩딱지가판독때");
      //  보낼 때 본문 머리의 시각도 통화한 때
      /*  [^)]* 로 쓰면 String(...) 의 닫는 괄호에서 멈춘다 — 늘 실패해서
          깨기 줄마다 가짜 울음이 섞였다. 벌써 여섯 번째다.                */
      if (!/문의본문\([\s\S]*?cur\.data\.called_at/.test(api)) 운것.push("⑩본문시각이판독때");

      //  판정을 쌓을 때 called_at 을 적어야 한다 — 안 적으면 위가 다 빈값이 된다
      const fu = g("fu");
      if (!/called_at: call\?\.called_at \?\? new Date\(\)\.toISOString\(\)/.test(fu)) {
        운것.push("⑩통화때를안적음");
      }
      //  ★ null 로 두면 하루를 가를 때 조용히 빠진다 ★
      if (/called_at: call\?\.called_at \?\? null/.test(fu)) 운것.push("⑩빈칸을남김");
    }

    /* ⑦ 확인해도 줄은 안 지운다 */
    {
      const api = g("api");
      if (/from\("byto_call_followups"\)\s*\.delete\(/.test(api)) 운것.push("⑦확인이줄을지움");
      if (!/dismissed_at: new Date\(\)\.toISOString\(\)/.test(api)) 운것.push("⑦확인때를적음");
      const sql = g("sql");
      if (!/add column if not exists dismissed_at/.test(sql)) 운것.push("⑦칸이없음");
      if (!/add column if not exists item/.test(sql)) 운것.push("⑦상품칸이없음");
    }

    /* ⑦' ★ 문이 열려 있나 ★  (2026-10-19 — 이것을 빼먹어 307 로 튕겼다)
     *
     *  v2 는 로그인 안 한 요청을 기본으로 로그인 화면으로 보낸다. 표(x-ingest-token)로
     *  여는 길은 proxy.ts 목록에 ★이름을 적어야★ 한다. 코드·시험이 다 멀쩡한데
     *  화면만 안 되는 꼴이라, 배포하고 불러 보기 전에는 안 보였다.
     */
    {
      const px = (고침.proxy !== undefined ? 고침.proxy : (() => {
        try { return fs.readFileSync("D:/Pack2U_협력업체시스템_v2/app/src/proxy.ts", "utf8"); } catch (e) { return ""; }
      })());
      if (!px) 운것.push("⑦'proxy를못읽음");
      else if (!/"\/api\/byto\/followups"/.test(px)) 운것.push("⑦'문이안열림");
    }

    /* ⑧ GAS 다리는 나르기만 한다 */
    {
      const gs = g("gs");
      if (!/function csListCallFollowups/.test(gs)) 운것.push("⑧목록다리");
      if (!/function csPickCallFollowup/.test(gs)) 운것.push("⑧고르기다리");
      if (!/action !== "보내기" && action !== "확인"/.test(gs)) 운것.push("⑧둘만받음");
      if (!/담당자를 먼저 선택하세요/.test(gs)) 운것.push("⑧담당자검사");
    }
  } catch (e) {
    운것.push("터짐:" + e.message);
  }
  return 운것;
}

console.log("─ 금일 할 내용 ─\n");
const 운것 = 재보기();
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) pass = 24;
console.log(fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과");

console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const H = 읽기("home"), FU = 읽기("fu"), API = 읽기("api"), GS = 읽기("gs"), SQL = 읽기("sql");
const PX = (function () { try { return fs.readFileSync("D:/Pack2U_협력업체시스템_v2/app/src/proxy.ts", "utf8"); } catch (e) { return ""; } })();
const 깨기 = [
  ["★ v2 가 다시 자동으로 넣는다 ★", { fu: FU.replace("await record(c, {\n        ...base, verdict: read.verdict",
    'await c.from("cs_inquiries").insert({});\n      await record(c, {\n        ...base, verdict: read.verdict') }],
  ["판정에 상품을 안 적는다", { fu: FU.replace("item: read.item || null,", "") }],
  ["★ 누르고도 안 잠근다 ★", { home: H.replace(/if \(row\) \{ var bs = row\.querySelectorAll\('button'\);[^\n]*\n/, "") }],
  ["담당자 검사를 뺀다", { home: H.replace("if (!staff) { toast('담당자를 먼저 선택하세요 (홈에서 CS 접수)'); return; }", "") }],
  ["비어도 상자를 세워 둔다", { home: H.replace("if (!CFU_ROWS.length && !CFU_OLDER) {", "if (false) {") }],
  /*  ★ 이 넷이 10/20 의 결함을 문다 ★ 「확인을 눌러야 사라진다」고 적어 두고
      정작 날짜로 사라지게 만들어 151건이 묻혀 있었다.                      */
  ["★ 지난 것이 있어도 상자를 숨긴다 ★", { home: H.replace(" && !CFU_OLDER", "") }],
  ["꼬리를 안 그린다", { home: H.replace("}).join('') + cfuTailHtml();", "}).join('');") }],
  ["★ v2 가 지난 건수를 안 준다 ★", { api: API.replace("rows: 줄, older, all: 전부", "rows: 줄") }],
  ["다리가 전부 보기를 안 나른다", { gs: GS.replace('if (opts.all) qs.push("all=1");', "") }],
  ["「보기」가 범위를 안 바꾼다", { home: H.replace("CFU_ALL = !!all;", "") }],
  ["지난 줄에 날짜를 안 붙인다", { home: H.replace("(지난 ? '<span class=\"cfu-old\"", "(false ? '<span class=\"cfu-old\"") }],
  /*  ★ 이 넷이 10/20 두 번째 결함을 문다 ★ 판독한 때로 하루를 가르면
      열흘 전 통화가 「오늘 할 일」로 선다 (16건이 실은 10/13 통화였다).  */
  ["★ 판독한 때로 하루를 가른다 ★", { api: API.split('.lt("called_at", 끝)').join('.lt("processed_at", 끝)')
    .split('.gte("called_at", 시작)').join('.gte("processed_at", 시작)') }],
  ["날짜 딱지가 판독한 때를 읽는다", { api: API.replace("at: String(r.called_at)", "at: String(r.processed_at)") }],
  ["보낸 문의 머리 시각이 판독한 때", { api: API.replace("cur.data.called_at ?? \"\"", "cur.data.processed_at ?? \"\"") }],
  ["★ 통화한 때를 빈칸으로 둔다 ★", { fu: FU.replace("called_at: call?.called_at ?? new Date().toISOString(),", "called_at: call?.called_at ?? null,") }],
  ["두 물음의 잣대가 어긋난다", { api: API.replace(
    /\.is\("dismissed_at", null\)(\s*)\.lt\("called_at", 시작\)/, '$1.lt("called_at", 시작)') }],
  ["못 읽어도 숨긴다", { home: H.replace(/if \(err\) \{\s*\n\s*box\.hidden = false;/, "if (err) {\n        box.hidden = true;") }],
  ["화면이 요약을 제 맘대로 고른다", { api: API.replace(/summary: String\(r\.extract \|\| r\.reason \|\| ""\)/, 'summary: ""') }],
  ["보낼 때 다른 이름을 쓴다", { api: API.replace(/vendor: 보일이름\([^)]*\),/, "vendor: null,") }],
  ["★ 확인이 줄을 지운다 ★", { api: API.replace(/\.update\(\{ dismissed_at: new Date\(\)\.toISOString\(\), dismissed_by: staff \}\)/,
    ".delete()") }],
  ["GAS 가 아무 action 이나 받는다", { gs: GS.replace('if (action !== "보내기" && action !== "확인") return { ok: false, error: "보내기 또는 확인만 됩니다." };', "") }],
  ["칸을 안 만든다", { sql: SQL.replace(/add column if not exists dismissed_at timestamptz;/, "") }],
  /*  ★ 이 깨기가 실제 사고를 재현한다 ★ 목록에서 빼면 v2 가 307 로 로그인에
      튕겨, 코드가 다 멀쩡해도 화면이 「못 읽었습니다」만 띄운다.  */
  ["★ 표로 여는 문을 안 연다 ★", { proxy: PX.replace(`"/api/byto/followups",`, "") }],
];

let 안움 = 0;
for (const [이름, 고침] of 깨기) {
  if (!Object.keys(고침).some((k) => 고침[k] !== 읽기(k))) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운 = 재보기(고침);
  if (운.length) console.log("  ✔ 울었다 [" + 운.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(fail || 안움 ? 1 : 0);
