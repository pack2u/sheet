/**
 * 로젠 회수(반품) 접수 — 규격의 함정을 지키는가
 *
 *  > "로젠 회수 접수 규격 확인해서 붙여줘"   (2026-09-16)
 *
 *  규격(로젠택배_OpenAPI_규격.md §8)에는 롯데와 다른 점이 셋 있다.
 *  하나라도 어기면 로젠이 거절하거나, 더 나쁘게는 «엉뚱한 곳으로» 접수된다.
 *
 *    ① dlvFare 는 null·0 이 안 된다 — 지어내지 말고 조회해서 쓴다
 *    ② fareTy 는 010·020 만 (2026-04-29 에 030·040 빠짐)
 *    ③ qty 는 1 고정 — 박스가 여럿이면 건마다
 *
 *  그리고 반품은 «방향이 반대»다. 송하인 = 반품 보내는 고객,
 *  수하인 = 화주사(우리). 뒤집으면 기사가 우리 창고로 가지러 간다.
 *
 * 실행: node _cslogenret_test.js
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

const src = fs.readFileSync("csLogenReturn.gs", "utf8");
const 규격 = fs.readFileSync("로젠택배_OpenAPI_규격.md", "utf8");

function grab(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

/*  ── 로젠을 흉내 낸다. 무엇을 보냈는지 그대로 받아 둔다 ── */
function 판(응답) {
  const 보낸것 = [];
  const ctx = {
    보낸것,
    _logen_digits_: (v) => String(v == null ? "" : v).replace(/[^0-9]/g, ""),
    _logen_userId_: () => "uid",
    _logen_custCd_: () => "CUST01",
    _logen_key_: () => (응답.키없음 ? "" : "KEY"),
    _logen_arr_: (v) => (Array.isArray(v) ? v : (v ? [v] : [])),
    _logen_ok_: (c) => ["TRUE", "SUCCESS", "Y", "OK"].indexOf(String(c || "").toUpperCase()) >= 0,
    _lrt_to_: () => (응답.받는곳없음 ? null
      : { name: "주식회사 팩투유", tel: "031-923-7795", zip: "17858", addr: "경기 평택시 포승읍 석정리 369" }),
    _logen_call_: function (api, body) {
      보낸것.push({ api: api, body: body });
      const r = 응답[api];
      if (!r) return { ok: false, error: api + " 응답을 안 정해 뒀습니다" };
      return r;
    },
    Utilities: { formatDate: function () { return "2026-09-16"; } },
    Logger: { log: function () {} },
    SpreadsheetApp: { getUi: function () { throw new Error("no ui"); } },
  };
  vm.createContext(ctx);
  vm.runInContext(["_lgr_to_", "csLogenReturnReady", "csLogenReturnCheck",
    "_lgr_fareOk_", "csLogenReturnRegister", "csLogenReturnState",
    "csLogenReturnCancel"].map(grab).join("\n"), ctx);
  return ctx;
}

const 정상조회 = { ok: true, json: { data: [{ resultCd: "TRUE", fareTy: "010", fareTyNm: "선불",
  dlvFare: 3000, dlvBranCd: "B12", branNm: "평택지점" }] } };
const 정상접수 = { ok: true, json: { data: [{ resultCd: "TRUE", takeNo: "T1234567890", fixTakeNo: "F1" }] } };
const 고객 = { orgnSlipNo: "451-6945-9705", name: "김철수", tel: "010-1111-2222",
  addr: "서울시 강남구 테헤란로 1", goodsNm: "JH 미니탕 소", msg: "문 앞" };

console.log("\n[1] ★ 지금은 «못 쓴다»고 말한다 — 키가 없다");
{
  const c = 판({ 키없음: true });
  const r = vm.runInContext("csLogenReturnReady()", c);
  check("못 쓴다", r.ready, false);
  check("★ 까닭이 «키 없음»이다", r.reason.indexOf("인증키가 아직 없습니다") >= 0, true);
  check("무엇을 해야 하는지 말한다", r.reason.indexOf("LOGEN_SECRET_KEY_DEV") >= 0, true);
}

console.log("\n[2] 받는 곳이 없어도 못 쓴다");
{
  const c = 판({ 받는곳없음: true });
  const r = vm.runInContext("csLogenReturnReady()", c);
  check("못 쓴다", r.ready, false);
  check("까닭이 다르다", r.reason.indexOf("받는 곳") >= 0, true);
}

console.log("\n[3] 준비되면 쓸 수 있다");
{
  const c = 판({});
  const r = vm.runInContext("csLogenReturnReady()", c);
  check("쓸 수 있다", r.ready, true);
  check("받는 곳을 알려 준다", r.to.name, "주식회사 팩투유");
}

console.log("\n[4] ★ 운임은 «조회해서» 쓴다 — 지어내지 않는다");
{
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 정상접수 });
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  check("접수됨", r.ok, true);
  check("접수번호를 돌려준다", r.takeNo, "T1234567890");

  const 부른API = c.보낸것.map((x) => x.api);
  check("★ 조회를 «먼저» 부른다", 부른API, ["reverseChkInfoMulti", "registReturnRequest"]);

  const 보낸 = c.보낸것[1].body.data[0];
  check("★ 조회가 준 운임을 그대로 쓴다", 보낸.dlvFare, 3000);
  check("★ 조회가 준 운임타입을 그대로 쓴다", 보낸.fareTy, "010");
}

console.log("\n[5] ★ 방향이 반대다 — 송하인은 «고객»");
{
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 정상접수 });
  vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  const 보낸 = c.보낸것[1].body.data[0];
  check("★ 송하인 = 반품 보내는 고객", 보낸.sndCustNm, "김철수");
  check("★ 수하인 = 화주사(우리)", 보낸.rcvCustNm, "주식회사 팩투유");
  check("고객 주소가 송하인 자리에", 보낸.sndCustAddr1, "서울시 강남구 테헤란로 1");
  check("우리 주소가 수하인 자리에", 보낸.rcvCustAddr1, "경기 평택시 포승읍 석정리 369");
  check("원송장은 숫자만", 보낸.orgnSlipNo, "45169459705");
  check("★ 수량은 1 고정", 보낸.qty, 1);
}

console.log("\n[6] ★ 운임타입이 010·020 이 아니면 «접수하지 않는다»");
{
  /*  2026-04-29 에 신용(030)·본사신용(040)이 빠졌다. 몰래 010 으로 바꿔
      넣으면 운임이 엉뚱한 데로 간다.  */
  const 신용 = { ok: true, json: { data: [{ resultCd: "TRUE", fareTy: "030", fareTyNm: "신용",
    dlvFare: 3000, branNm: "평택지점" }] } };
  const c = 판({ reverseChkInfoMulti: 신용, registReturnRequest: 정상접수 });
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  check("★ 접수 안 한다", r.ok, false);
  check("★ 접수를 아예 안 불렀다", c.보낸것.map((x) => x.api), ["reverseChkInfoMulti"]);
  check("까닭을 말한다", r.error.indexOf("010·020 만 받습니다") >= 0, true);
  check("무엇이 왔는지도 말한다", r.error.indexOf("030") >= 0, true);
}

console.log("\n[7] ★ 운임이 0 이면 접수하지 않는다");
{
  //  규격: dlvFare 는 null 또는 0 불가
  const 영원 = { ok: true, json: { data: [{ resultCd: "TRUE", fareTy: "010", dlvFare: 0 }] } };
  const c = 판({ reverseChkInfoMulti: 영원, registReturnRequest: 정상접수 });
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  check("★ 접수 안 한다", r.ok, false);
  check("★ 접수를 아예 안 불렀다", c.보낸것.length, 1);
  check("까닭을 말한다", r.error.indexOf("운임 0") >= 0, true);
}

console.log("\n[8] ★ 보내는 분 칸이 비면 접수하지 않는다");
{
  /*  세 칸이 다 있어야 기사가 찾아간다. 「접수됐다」고 해 놓고 아무도
      안 가는 것이 제일 나쁘다.  */
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 정상접수 });
  const 빈주소 = JSON.parse(JSON.stringify(고객)); 빈주소.addr = "";
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(빈주소) + ")", c);
  check("★ 접수 안 한다", r.ok, false);
  check("★ 로젠을 아예 안 불렀다", c.보낸것.length, 0);
  check("무엇이 비었는지 말한다", r.error.indexOf("주소없음") >= 0, true);
}

console.log("\n[9] ★ 접수번호(takeNo)가 없으면 «됐다»고 안 한다");
{
  /*  접수는 됐는데 번호를 못 받으면 조회도 취소도 못 한다.
      규격 §8.1: 이후 모든 조회·취소의 키가 takeNo 다.  */
  const 번호없음 = { ok: true, json: { data: [{ resultCd: "TRUE", takeNo: "" }] } };
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 번호없음 });
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  check("★ 성공이라 하지 않는다", r.ok, false);
  check("까닭을 말한다", r.error.indexOf("접수번호(takeNo)가 없습니다") >= 0, true);
}

console.log("\n[10] 상태 조회는 «한글 명칭»을 그대로 흘린다");
{
  /*  규격 §8.2: inquiryReturnStateMulti 만 resvStatNm(명칭)을 준다.
      나머지 둘은 코드다. 로젠은 화물상태에도 코드가 없다 — 이름을 그대로 쓴다. */
  const 조회 = { ok: true, json: { data1: [{ takeNo: "T1", slipNo: "451", resvStatNm: "집하완료" }] } };
  const c = 판({ inquiryReturnStateMulti: 조회 });
  const r = vm.runInContext("csLogenReturnState('451-6945-9705')", c);
  check("읽는다", r.ok, true);
  check("★ 명칭을 그대로", r.rows[0].stat, "집하완료");
  check("접수번호도 같이", r.rows[0].takeNo, "T1");
  check("원송장으로 묻는다", c.보낸것[0].body.data[0].orgnSlipNo, "45169459705");
}

console.log("\n[11] 취소는 응답 코드를 «해석하지 않는다»");
{
  /*  규격 §8.3 경고: 조회 코드표는 「20 = 접수취소」인데 취소 응답은 「030」.
      자릿수도 다르다. 같은 표로 매핑하면 안 된다 — 그래서 성공 여부만 본다. */
  const 취소 = { ok: true, json: { data: [{ resultCd: "TRUE", takeNo: "T1", resvStat: "030" }] } };
  const c = 판({ cancelReserveState: 취소 });
  const r = vm.runInContext("csLogenReturnCancel('T1')", c);
  check("취소됨", r.ok, true);
  check("접수번호를 돌려준다", r.takeNo, "T1");

  const 몸 = grab("csLogenReturnCancel").replace(/\/\*[\s\S]*?\*\//g, "");
  check("★ 상태코드를 해석하는 코드가 없다", /resvStat/.test(몸), false);
  check("접수번호로 부른다", c.보낸것[0].body.data[0].takeNo, "T1");
}

console.log("\n[12] 로젠이 거절하면 그대로 전한다");
{
  const 거절 = { ok: true, json: { data: [{ resultCd: "FALSE", resultMsg: "이미 접수된 건입니다" }] } };
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 거절 });
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  check("실패로 본다", r.ok, false);
  check("★ 로젠이 한 말을 그대로", r.error, "이미 접수된 건입니다");
}

console.log("\n[13] 규격 문서와 어긋나지 않는가");
{
  /*  코드가 부르는 API 이름이 규격 문서에 실제로 있는지 본다.
      이름을 잘못 적으면 404 가 아니라 «조용한 실패»로 온다.  */
  const 부르는API = [];
  for (const m of src.matchAll(/_logen_call_\("([A-Za-z]+)"/g)) {
    if (부르는API.indexOf(m[1]) < 0) 부르는API.push(m[1]);
  }
  check("부르는 API 를 찾았다", 부르는API.length, 4);
  const 없는것 = 부르는API.filter((a) => 규격.indexOf(a) < 0);
  check("★ 규격에 없는 API 를 부르지 않는다", 없는것, []);

  //  규격이 못 박은 제약이 코드에도 적혀 있는가 (사람이 다시 읽을 수 있게)
  check("010·020 제약을 적어 뒀다", src.indexOf("010") >= 0 && src.indexOf("020") >= 0, true);
  check("qty 1 고정을 적어 뒀다", src.indexOf("qty: 1") >= 0, true);
  check("takeNo 를 남기라는 경고를 적어 뒀다", src.indexOf("takeNo") >= 0, true);
}


console.log("\n[14] 카드에서 로젠 건도 접수로 이어진다");
{
  const html = fs.readFileSync("home.html", "utf8");
  const lotte = fs.readFileSync("csLotteReturn.gs", "utf8");

  check("화면이 로젠 준비 상태를 묻는다", html.indexOf(".csLogenReturnReady();") >= 0, true);
  check("★ 로젠 건에서도 단추가 나온다", html.indexOf("var 로젠 = pu.indexOf('로젠') !== -1;") >= 0, true);
  check("★ 못 쓰면 «왜»를 보여 준다",
    html.indexOf("반품접수(로젠 준비중)") >= 0, true);
  check("롯데도 로젠도 아니면 안 낸다",
    html.indexOf("if (pu && !로젠 && pu.indexOf('롯데') === -1) return '';") >= 0, true);

  /*  복사해 두 벌을 두지 않았다 — 다른 것은 «부르는 API 하나»뿐이다.
      주소 되짚기·박스 가려내기·대장 적기가 두 군데가 되면 언젠가 한쪽만 고친다. */
  check("★ 접수 함수를 복사하지 않았다",
    /function csLogenReturnPickupFromCard/.test(lotte + src), false);
  check("★ 한 흐름에서 택배사만 가른다", /var res = 로젠인가/.test(lotte), true);
  check("로젠이면 로젠으로", /\? _lgr_pickupMany_\(\{/.test(lotte), true);
  check("아니면 롯데로", /: csLotteReturnPickup\(\{/.test(lotte), true);
  check("로젠인데 준비가 안 됐으면 거기서 막는다",
    /if \(로젠인가\) \{[\s\S]{0,260}return \{ ok: false, error: lgReady\.reason \}/.test(lotte), true);
}

console.log("\n[15] 박스가 여럿이면 «건마다» 접수한다");
{
  /*  규격 §8.1: qty 는 1 고정. 한 번에 보내면 한 박스만 온다.  */
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 정상접수 });
  vm.runInContext(["_lgr_pickupMany_"].map(grab).join("\n"), c);
  const r = vm.runInContext("_lgr_pickupMany_(" + JSON.stringify({
    name: "김철수", phone: "010-1111-2222", addr: "서울시 강남구 테헤란로 1",
    item: "JH 미니탕 소", orglInvNos: ["45169459705", "45169459706"]
  }) + ")", c);
  check("성공", r.ok, true);
  check("★ 두 번 접수했다", c.보낸것.filter((x) => x.api === "registReturnRequest").length, 2);
  check("건별 결과를 남긴다", r.results.length, 2);
  check("★ 접수번호를 담는다 (송장은 나중에 나온다)", r.results[0].takeNo, "T1234567890");
}

console.log("\n[16] ★ 하나가 실패해도 나머지는 접수한다");
{
  let n = 0;
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 정상접수 });
  //  두 번째 접수만 거절하게 바꾼다
  const 원래 = c._logen_call_;
  c._logen_call_ = function (api, body) {
    if (api === "registReturnRequest" && ++n === 2) {
      c.보낸것.push({ api: api, body: body });
      return { ok: true, json: { data: [{ resultCd: "FALSE", resultMsg: "이미 접수된 건입니다" }] } };
    }
    return 원래(api, body);
  };
  vm.runInContext(["_lgr_pickupMany_"].map(grab).join("\n"), c);
  const r = vm.runInContext("_lgr_pickupMany_(" + JSON.stringify({
    name: "김철수", phone: "010-1111-2222", addr: "서울시 강남구 테헤란로 1",
    orglInvNos: ["45169459705", "45169459706"]
  }) + ")", c);
  check("★ 하나라도 됐으면 성공으로 본다", r.ok, true);
  check("첫째는 됐다", r.results[0].ok, true);
  check("★ 둘째는 실패로 남는다", r.results[1].ok, false);
  check("왜 실패했는지 말한다", r.error.indexOf("이미 접수된 건입니다") >= 0, true);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
