/**
 * 로젠 계약 만료 감시 — «막히기 전에» 알자는 것
 *
 * ★ 이 시험이 지키는 것 ★
 *   2026-10-02 에 로젠 API 가 통째로 막혔다. 원인은 useYn = "E"(계약 종료).
 *   그때는 막히고 나서야 알았다 — 추적도 반품접수도 다 멈춘 뒤에.
 *
 *   조용히 망가지는 자리 —
 *     · 규격서에는 useYn 이 Y/N 뿐인데 실제로는 E 가 왔다. 아는 값만 나쁘다고
 *       치면 다음에 또 새 값이 올 때 그냥 지나간다
 *     · 「못 물은 것」과 「계약이 끊긴 것」을 같은 말로 올리면 엉뚱한 데를 본다
 *     · 하루 한 번이 아니면 1시간 일감이 하루 24번 로젠을 두드린다
 *     · 정상인데 카드가 남아 있으면 「또 그 소리」가 되어 아무도 안 본다
 *
 * 실행: node _cscontract_test.js
 */
const fs = require("fs");
const vm = require("vm");

const src = fs.readFileSync("csLogenContract.gs", "utf8");
const stale = fs.readFileSync("csLogenStale.gs", "utf8");
const hourly = fs.readFileSync("csPickupRequests.gs", "utf8");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}

function 판(응답) {
  const 한일 = { 부른것: [], 카드: [], 점검: [] };
  const 속성 = {};
  const ctx = {
    console, String, Number, Array, Math, JSON, Date, Object, parseInt, isNaN,
    Logger: { log: () => {} },
    Utilities: { formatDate: () => "20261008" },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in 속성 ? 속성[k] : null),
      setProperty: (k, v) => { 속성[k] = String(v); },
    }) },
    _CS_RETURN_LEDGER_ID_: "y",
    SpreadsheetApp: { openById: () => ({}) },
    _cpr_ops_: (ss, 항목, 값) => { 한일.점검.push([항목, 값]); },
    _logen_userId_: () => "u", _logen_custCd_: () => "30556066",
    _logen_arr_: (v) => (v == null ? [] : (Object.prototype.toString.call(v) === "[object Array]" ? v : [v])),
    _logen_ok_: (v) => ["TRUE", "SUCCESS"].indexOf(String(v || "").toUpperCase().trim()) >= 0,
    _logen_call_: (api, body) => { 한일.부른것.push([api, body]); return ctx.응답; },
    응답,
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

const 응답으로 = (useYn) => ({ ok: true, json: { data: [{
  useYn, resultCd: "TRUE", pickBranNm: "동수원",
  pickSalesNm: "홍성현(010-3860-0592)", pickSalesCd: "30510551",
  fareTy: "030", fareTyNm: "신용" }] } });

console.log("\n[1] 계약이 성하면 조용하다");
{
  const c = 판(응답으로("Y"));
  const 글 = c.csLogenContractWatch();
  ok("카드를 만들지 않는다", !c.한일.카드.some((x) => x.무엇 === "만듦"));
  ok("읽은 값을 글로 남긴다", /사용여부 Y/.test(글) && /동수원/.test(글));
  ok("★ 운영점검 탭에는 늘 남긴다 (돌았다는 자취)",
     c.한일.점검.some((x) => x[0] === "로젠 계약" && /Y/.test(x[1])));

  //  전에 떠 있던 카드는 내린다 — 안 내리면 「또 그 소리」가 된다
  const c2 = 판(응답으로("Y"));
  c2.보드.push({ id: 7, srcKey: "자동점검:로젠계약", status: "진행" });
  c2.csLogenContractWatch();
  ok("★ 풀렸으면 떠 있던 카드를 닫는다", c2.한일.카드.some((x) => x.무엇 === "닫음"));
}

console.log("\n[2] ★ 2026-10-02 그 상황 — useYn = E");
{
  const c = 판(응답으로("E"));
  c.csLogenContractWatch();
  const a = c.한일.카드[0];
  ok("카드를 올린다", a && a.무엇 === "만듦");
  ok("★ 긴급으로", a.level === "긴급");
  ok("★ 지연 카드들과 다른 표를 쓴다", a.srcKey === "자동점검:로젠계약");
  ok("제목에 그 값이 보인다", /useYn = E/.test(a.title));
  ok("무슨 뜻인지 풀어 준다", /계약 종료/.test(a.body));
  ok("★ 무엇이 막히는지 적는다", /추적·반품접수가 «전부» 막힙니다/.test(a.body));
  ok("★ 어디에 거는지 적는다 (영업소 번호)", /홍성현\(010-3860-0592\)/.test(a.body));
  ok("지난번에 그랬다는 것도 적는다", /2026-10-02/.test(a.body));
}

console.log("\n[3] ★ 「Y 가 아니면 이상하다」 — 아는 값만 집지 않는다");
{
  //  규격서에는 Y/N 뿐인데 실제로 E 가 왔다. 다음에 또 새 값이 오면?
  for (const v of ["N", "E", "X", "", "y "]) {
    const c = 판(응답으로(v));
    c.csLogenContractWatch();
    const 떴나 = c.한일.카드.some((x) => x.무엇 === "만듦");
    const 정상 = String(v).trim().toUpperCase() === "Y";
    ok((정상 ? "「" + v + "」는 정상으로 본다" : "★ 「" + (v || "빈 값") + "」는 이상하다고 올린다"),
       정상 ? !떴나 : 떴나);
  }
  const c = 판(응답으로("X"));
  c.csLogenContractWatch();
  ok("★ 모르는 값이라고 말해 준다", /문서에 없는 값/.test(c.한일.카드[0].body));
}

console.log("\n[4] ★ 「못 물은 것」과 「계약이 끊긴 것」을 구분한다");
{
  const c = 판({ ok: false, error: "중계기가 응답하지 않습니다" });
  c.csLogenContractWatch();
  const a = c.한일.카드[0];
  ok("그래도 조용히 넘기지 않는다", a && a.무엇 === "만듦");
  ok("★ 「계약이 끊겼다」고 단정하지 않는다", /확인하지 못했습니다/.test(a.title));
  ok("사유를 적는다", /중계기가 응답하지 않습니다/.test(a.body));
  ok("★ 어디를 먼저 볼지 알려 준다", /중계기나 그물 문제일 수도/.test(a.body));

  //  로젠이 빈 몸통을 줄 때
  const c2 = 판({ ok: true, json: { data: [], sttsMsg: "처리결과 0건" } });
  c2.csLogenContractWatch();
  ok("빈 응답도 「못 읽음」으로 본다", /확인하지 못했습니다/.test(c2.한일.카드[0].title));

  //  건별 실패
  const c3 = 판({ ok: true, json: { data: [{ resultCd: "FALSE", resultMsg: "거래처 없음" }] } });
  c3.csLogenContractWatch();
  ok("건별 실패도 「못 읽음」", /확인하지 못했습니다/.test(c3.한일.카드[0].title));
  ok("그 사유를 적는다", /거래처 없음/.test(c3.한일.카드[0].body));
}

console.log("\n[5] ★ 하루 한 번만 묻는다");
{
  const c = 판(응답으로("Y"));
  c.csLogenContractWatch();
  c.csLogenContractWatch();
  c.csLogenContractWatch();
  ok("★ 1시간 일감이 몇 번 불러도 한 번만 묻는다", c.한일.부른것.length === 1);
  ok("두 번째부터는 빈 글 (일감 보고가 지저분해지지 않게)", c.csLogenContractWatch() === "");
  ok("손으로는 다시 볼 수 있다",
     (c.csLogenContractWatch({ "강제": true }), c.한일.부른것.length === 2));

  //  못 물어도 하루 한 번은 지킨다 — 그물이 끊겼을 때 24번 두드리면 안 된다
  const c2 = 판({ ok: false, error: "끊김" });
  c2.csLogenContractWatch();
  c2.csLogenContractWatch();
  ok("★ 실패해도 하루 한 번", c2.한일.부른것.length === 1);
}

console.log("\n[6] 로젠에 무엇을 보내나");
{
  const c = 판(응답으로("Y"));
  c.csLogenContractWatch();
  const [api, body] = c.한일.부른것[0];
  ok("contractTotalInfo 를 부른다", api === "contractTotalInfo");
  ok("userId 를 싣는다", !!body.userId);
  ok("거래처코드를 싣는다", body.data[0].custCd === "30556066");
}

console.log("\n[7] 1시간 일감에 얹혔나");
{
  ok("일감이 부른다", /csLogenContractWatch\(\)/.test(hourly));
  ok("★ 빈 글이면 안 붙인다", /if \(계약\) L\.push\(계약\)/.test(hourly));
  ok("터져도 일감은 안 죽는다", /catch \(e\) \{ L\.push\("계약 점검 실패/.test(hourly));
  ok("앞 일들이 먼저 끝난다 (계약은 급하지 않다)",
     hourly.indexOf("csLogenContractWatch") > hourly.indexOf("csOutboundStaleCheck"));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
