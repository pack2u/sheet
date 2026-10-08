/**
 * 출고 송장 받아오기 — 붙여넣기를 없애되, 있는 것을 건드리지 않게
 *
 * ★ 이 시험이 지키는 것 ★
 *   > 사장님: "지우고 새로 붙여.. 자동으로 채우면 붙여넣기 안해도 돼"
 *
 *   사람은 로젠 실적을 「입력_로젠주문실적」 탭에 **지우고 새로** 붙여 왔다.
 *   이제 우리가 채운다. 그런데 그만두는 날까지는 **두 손이 같은 탭에 쓴다.**
 *     · 우리가 지우고 쓰면 → 사람이 넣은 줄이 날아간다
 *     · 겹쳐 적으면 → 같은 송장이 두 줄이 되어 일일마감 매칭이 틀어진다
 *     · 지워진 송장(delYn=Y)을 적으면 → 일일마감이 없는 송장을 쫓는다
 *   셋 다 «오류 한 줄 없이» 틀어진다. 그 자리를 못 박는다.
 *
 *   그리고 이 탭에는 **머리글이 없다.** 1행부터 자료다 — 첫 줄을 건너뛰면
 *   한 건을 놓친다. 2026-09-15 에 허브가 양식 변경을 못 읽어 송장을 0건 걷은
 *   적이 있다. 자리표가 어긋나면 그대로 되풀이된다.
 *
 * 실행: node _csshipslips_test.js
 */
const fs = require("fs");
const vm = require("vm");

const src = fs.readFileSync("csLogenShipSlips.gs", "utf8");
const hourly = fs.readFileSync("csPickupRequests.gs", "utf8");
const helpers = fs.readFileSync("../_partnerHelpers.gs", "utf8");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}

const 원장머리 = ["회차키", "운송장번호", "택배사", "거래처명", "사방넷주문번호"];
const p2 = (n) => String(n).padStart(2, "0");
const 회차 = (전) => { const d = new Date(); d.setDate(d.getDate() - 전);
  return p2(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate()) + "-1"; };

function 판(원장줄, 실적줄, 응답) {
  const 한일 = { 물은것: [], 쓴것: [], 지운적: 0 };
  const 실적 = (실적줄 || []).map((r) => r.slice());
  const ctx = {
    console, String, Number, Array, Math, JSON, Date, Object, parseInt, isNaN,
    Logger: { log: () => {} },
    Utilities: {
      formatDate: (d) => d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()),
      sleep: () => {},
    },
    _CS_LEDGER_SS_ID_: "L", _CS_TRADE_INVOICE_SS_ID_: "T", _CS_RETURN_LEDGER_ID_: "R",
    _LOGEN_BATCH_SIZE_: 10, _LOGEN_BATCH_DELAY_MS_: 0, _LOGEN_TIME_BUDGET_MS_: 150000,
    _logen_userId_: () => "u", _logen_custCd_: () => "30556066",
    _logen_arr_: (v) => (v == null ? [] : (Array.isArray(v) ? v : [v])),
    _logen_ok_: (v) => ["TRUE", "SUCCESS"].indexOf(String(v || "").toUpperCase().trim()) >= 0,
    _ost_roundDate_: (v) => { const m = String(v || "").match(/^(\d{2})(\d{2})(\d{2})/);
      return m ? new Date(2000 + +m[1], +m[2] - 1, +m[3]) : null; },
    _ost_pretty_: (d) => { const s = String(d || "").replace(/[^0-9]/g, "");
      return s.length === 11 ? s.slice(0, 3) + "-" + s.slice(3, 7) + "-" + s.slice(7) : String(d || ""); },
    _cpr_ops_: () => {},
    _logen_call_: (api, body) => { 한일.물은것.push([api, body]); return ctx.응답(body); },
    응답,
    SpreadsheetApp: { openById: (id) => ({
      getSheetByName: (n) => {
        if (id === "L" && n === "주문라인원장") return {
          getLastRow: () => 원장줄.length + 1, getLastColumn: () => 원장머리.length,
          getRange: (r, c, nr) => ({ getDisplayValues: () =>
            r === 1 ? [원장머리] : 원장줄.slice(r - 2, r - 2 + nr) }),
        };
        if (id === "T" && n === "입력_로젠주문실적") return {
          getLastRow: () => 실적.length,
          getRange: (r, c, nr, nc) => ({
            getDisplayValues: () => 실적.slice(r - 1, r - 1 + nr).map((x) => [x[c - 1] || ""]),
            setValues: (vals) => { 한일.쓴것.push(...vals);
              vals.forEach((v, i) => { 실적[r - 1 + i] = v; }); },
          }),
          clear: () => { 한일.지운적++; },
          clearContents: () => { 한일.지운적++; },
          deleteRows: () => { 한일.지운적++; },
        };
        return null;
      },
    }) },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.한일 = 한일; ctx.실적 = 실적;
  return ctx;
}

//  로젠이 송장을 주는 흉내
const 송장응답 = (표) => (body) => ({ ok: true, json: { data: body.data.map((d) => {
  const v = 표[d.fixTakeNo];
  if (v === undefined) return { fixTakeNo: d.fixTakeNo, resultCd: "FALSE", resultMsg: "없음" };
  return { fixTakeNo: d.fixTakeNo, resultCd: "TRUE",
           data1: v.map((x) => (typeof x === "string" ? { slipNo: x, delYn: "N" } : x)) };
}) } });

console.log("\n[1] 송장을 받아 탭에 더한다");
{
  const c = 판([[회차(1), "", "로젠택배", "최지우", "d1007000098"]], [],
               송장응답({ d1007000098: ["45324003760"] }));
  c.csLogenCollectShipSlips();
  const 줄 = c.한일.쓴것[0];
  ok("한 줄을 더한다", c.한일.쓴것.length === 1);
  ok("★ 주문번호는 J (10번째)", 줄[9] === "d1007000098");
  ok("★ 운송장은 K (11번째)", 줄[10] === "453-2400-3760");
  ok("★ 하이픈 3-4-4 로 적는다 (탭이 그렇게 적는다)", /^\d{3}-\d{4}-\d{4}$/.test(줄[10]));
  ok("수하인은 O (15번째)", 줄[14] === "최지우");
  ok("구분은 B 「집하」", 줄[1] === "집하");
  ok("집하일자는 C", /^\d{4}-\d{2}-\d{2}$/.test(줄[2]));
  ok("★ 우리가 적은 줄이라는 표가 있다", 줄[8] === "API");
}

console.log("\n[2] ★ 지우지 않는다 — 사람이 넣은 줄이 날아가면 안 된다");
{
  const 사람줄 = [];
  for (let i = 0; i <= 14; i++) 사람줄.push("");
  사람줄[9] = "2166312387"; 사람줄[10] = "453-0321-1446"; 사람줄[14] = "김민규";

  const c = 판([[회차(1), "", "로젠택배", "최지우", "d1007000098"]], [사람줄],
               송장응답({ d1007000098: ["45324003760"] }));
  c.csLogenCollectShipSlips();
  ok("★ 탭을 지우지 않는다", c.한일.지운적 === 0);
  ok("★ 사람이 넣은 줄이 그대로 있다", c.실적[0][9] === "2166312387");
  ok("밑에 더한다", c.실적[1] && c.실적[1][9] === "d1007000098");
}

console.log("\n[3] ★ 겹쳐 적지 않는다 — 같은 송장이 두 줄이면 매칭이 틀어진다");
{
  const 있던줄 = [];
  for (let i = 0; i <= 14; i++) 있던줄.push("");
  있던줄[9] = "d1007000098"; 있던줄[10] = "453-2400-3760";

  const c = 판([[회차(1), "", "로젠택배", "최지우", "d1007000098"]], [있던줄],
               송장응답({ d1007000098: ["45324003760"] }));
  const 글 = c.csLogenCollectShipSlips();
  ok("★ 이미 있는 주문번호는 안 묻는다", c.한일.물은것.length === 0);
  ok("★ 아무것도 안 더한다", c.한일.쓴것.length === 0);
  ok("할 일이 없으면 빈 글 (일감 보고가 지저분해지지 않게)", 글 === "");

  //  ★ 머리글이 없다 ★ 1행부터 자료다 — 건너뛰면 그 줄을 또 적는다
  //  ★ 머리글이 없다 ★ 1행도 자료다 — 건너뛰면 그 줄을 또 적는다
  ok("★ 1행도 읽는다 (머리글이 없는 탭이다)", /Math\.max\(1, last - _SSL_LOOKBACK_ROWS_ \+ 1\)/.test(src));
  /*  붙여넣기를 그만두면 이 탭은 끝없이 자란다. 겹침을 가리려고 열을 통째로
      읽으면 매시간 무거워진다. 최근 것만 묻으므로 뒤에서만 봐도 다 걸린다. */
  ok("★ 끝없이 자라도 버틴다 (뒤에서만 본다)", /var _SSL_LOOKBACK_ROWS_ = \d+;/.test(src));
}

console.log("\n[4] ★ 지워진 송장은 안 적는다");
{
  const c = 판([[회차(1), "", "로젠택배", "최지우", "d1"]], [],
               송장응답({ d1: [{ slipNo: "45324003760", delYn: "Y" }] }));
  const 글 = c.csLogenCollectShipSlips();
  ok("★ delYn=Y 는 버린다", c.한일.쓴것.length === 0);
  ok("버렸다고 말해 준다", /지워진 건 1/.test(글));

  //  한 주문에 박스가 여럿이면 송장도 여럿
  const c2 = 판([[회차(1), "", "로젠택배", "둘박스", "d2"]], [],
                송장응답({ d2: ["45324003761", "45324003762"] }));
  c2.csLogenCollectShipSlips();
  ok("★ 송장이 둘이면 두 줄 (박스마다 하나다)", c2.한일.쓴것.length === 2);
}

console.log("\n[5] 아직 송장이 안 나온 건은 기다린다");
{
  const c = 판([[회차(1), "", "로젠택배", "아직", "d3"]], [], 송장응답({}));
  const 글 = c.csLogenCollectShipSlips();
  ok("★ 없으면 안 적는다", c.한일.쓴것.length === 0);
  ok("기다린다고 말해 준다", /아직 송장 없음 1/.test(글));

  //  못 물었을 때 — 다음 시간에 또 본다. 빈 줄을 적어 두면 안 된다
  const c2 = 판([[회차(1), "", "로젠택배", "못물음", "d4"]], [],
                () => ({ ok: false, error: "중계기 끊김" }));
  c2.csLogenCollectShipSlips();
  ok("★ 못 물어도 빈 줄을 안 적는다", c2.한일.쓴것.length === 0);
}

console.log("\n[6] 로젠 건만 · 최근 것만 · 한 번씩만");
{
  const c = 판([
    [회차(1), "", "롯데택배", "롯데건", "x1"],
    [회차(1), "", "로젠택배", "로젠건", "x2"],
    [회차(1), "", "로젠택배", "합포장", "x3"],
    [회차(1), "", "로젠택배", "합포장", "x3"],   // 같은 주문, 줄만 둘
    [회차(99), "", "로젠택배", "오래된것", "x4"],
    [회차(1), "", "로젠택배", "번호없음", ""],
  ], [], 송장응답({ x2: ["45300000002"], x3: ["45300000003"] }));
  c.csLogenCollectShipSlips();
  const 물은 = c.한일.물은것[0][1].data.map((d) => d.fixTakeNo);
  ok("★ 롯데 건은 안 묻는다", 물은.indexOf("x1") < 0);
  ok("★ 합포장은 한 번만 묻는다", 물은.filter((v) => v === "x3").length === 1);
  ok("★ 오래된 것은 안 묻는다", 물은.indexOf("x4") < 0);
  ok("주문번호가 없으면 못 묻는다", 물은.indexOf("") < 0);
  ok("로젠·최근 건만 남는다", 물은.length === 2);
}

console.log("\n[7] 로젠에 무엇을 보내나");
{
  const c = 판([[회차(1), "", "로젠택배", "최지우", "d1"]], [], 송장응답({ d1: ["45300000001"] }));
  c.csLogenCollectShipSlips();
  const [api, body] = c.한일.물은것[0];
  ok("inquirySlipNoMulti 를 부른다", api === "inquirySlipNoMulti");
  ok("거래처코드를 싣는다", body.data[0].custCd === "30556066");
  ok("★ 주문번호를 fixTakeNo 로 보낸다", body.data[0].fixTakeNo === "d1");
  ok("★ 10건씩 끊는다 (로젠 요청)", /_LOGEN_BATCH_SIZE_/.test(src));
  ok("호출 사이를 쉰다", /Utilities\.sleep\(_LOGEN_BATCH_DELAY_MS_\)/.test(src));
  ok("시간 예산을 넘기면 멈춘다", /_LOGEN_TIME_BUDGET_MS_/.test(src));
}

console.log("\n[8] ★ 자리표가 허브와 같은가 — 어긋나면 송장이 0건이 된다");
{
  //  _partnerHelpers.gs 의 _PT_ROZEN_FIXED_COL 이 그 탭의 «주인»이다
  const 허브 = helpers.slice(helpers.indexOf("var _PT_ROZEN_FIXED_COL"));
  const 집 = (k) => { const m = 허브.match(new RegExp(k + ":\\s*(-?\\d+)")); return m ? +m[1] : null; };
  const 내 = (k) => { const m = src.match(new RegExp(k + ":\\s*(-?\\d+)")); return m ? +m[1] : null; };
  ok("★ 주문번호 자리가 같다 (J)", 집("uid") === 내("주문번호") && 내("주문번호") === 9);
  ok("★ 운송장 자리가 같다 (K)", 집("invoice") === 내("운송장") && 내("운송장") === 10);
  ok("★ 수하인 자리가 같다 (O)", 집("name") === 내("수하인") && 내("수하인") === 14);
  ok("★ 집하일자 자리가 같다 (C)", 집("date") === 내("일자") && 내("일자") === 2);
  ok("어디서 왔는지 적어 뒀다 (두 벌인 것을 알고 둔다)",
     /_PT_ROZEN_FIXED_COL/.test(src) && /_partnerHelpers\.gs/.test(src));
}

console.log("\n[9] 1시간 일감에 얹혔나");
{
  ok("일감이 부른다", /csLogenCollectShipSlips\(\)/.test(hourly));
  ok("★ 빈 글이면 안 붙인다", /if \(송장\) L\.push\(송장\)/.test(hourly));
  ok("★ 지연 점검보다 «먼저» 다 (송장이 붙어야 추적할 것이 생긴다)",
     hourly.indexOf("csLogenCollectShipSlips") < hourly.indexOf("csOutboundStaleCheck"));
  ok("터져도 일감은 안 죽는다", /catch \(e\) \{ L\.push\("출고 송장 받아오기 실패/.test(hourly));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
