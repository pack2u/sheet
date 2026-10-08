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
    /*  중계기 — 2026-10-07 에 생겼다. 기본은 «없음» 으로 둔다.
        있으면 키가 없어도 쓸 수 있다(키는 중계기에 있다). */
    _logen_proxyUrl_: () => (응답.중계 ? "https://siot.com/pack2u/relay.php" : ""),
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
    "_lgr_fareOk_", "_lgr_contractFare_", "_lgr_alreadyDone_", "_lgr_sentTail_",
    "csLogenReturnRegister", "csLogenReturnState",
    "csLogenReturnCancel"].map(grab).join("\n"), ctx);
  return ctx;
}

const 정상조회 = { ok: true, json: { data: [{ resultCd: "TRUE", fareTy: "010", fareTyNm: "선불",
  dlvFare: 3000, dlvBranCd: "B12", branNm: "평택지점" }] } };
const 정상접수 = { ok: true, json: { data: [{ resultCd: "TRUE", takeNo: "T1234567890", fixTakeNo: "F1" }] } };
/*  ★ 반품 «계약» 운임 ★ contRtnFares 가 주는 값이다. 지점별 배송운임(정상조회의
    dlvFare 3000)과 «다르다» — 계약 운임은 2500 하나다. 이 둘을 헷갈려 실패했다. */
const 계약운임 = { ok: true, json: { data: [{ resultCd: "SUCCESS",
  data1: [{ boxTyCd: "ZW001", dlvFare: 2500 }] }] } };
const 고객 = { orgnSlipNo: "451-6945-9705", name: "김철수", tel: "010-1111-2222",
  addr: "서울시 강남구 테헤란로 1", goodsNm: "JH 미니탕 소", msg: "문 앞" };

console.log("\n[1] ★ 못 쓰면 «왜»를 말한다 — 중계기도 키도 없을 때");
{
  const c = 판({ 키없음: true });
  const r = vm.runInContext("csLogenReturnReady()", c);
  check("못 쓴다", r.ready, false);
  check("★ 까닭이 «부를 길이 없음»이다", r.reason.indexOf("부를 길이 없습니다") >= 0, true);
  check("무엇을 해야 하는지 말한다", r.reason.indexOf("LOGEN_PROXY_URL") >= 0, true);
}

/*  ★ 2026-10-07: 중계기가 생겼다 ★
    로젠은 등록된 공인 IP 에서 온 호출만 받는데 Apps Script 는 고정 IP 가 없다.
    그래서 siot.com 중계기가 대신 부르고 **인증키는 중계기에만** 둔다.
    여기서 키를 찾으면 늘 「없다」가 나와 접수 칸이 영영 안 나온다 — 실제로 그랬다. */
console.log("\n[1-2] ★ 중계기가 있으면 키가 없어도 쓸 수 있다");
{
  const c = 판({ 키없음: true, 중계: true });
  const r = vm.runInContext("csLogenReturnReady()", c);
  check("★ 쓸 수 있다", r.ready, true);
  check("받는 곳도 함께 준다", !!(r.to && r.to.name), true);
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
  /*  차례: ⓪ 이미 접수됐나 → ① 집하지점·타입 → ② 계약 운임 → ③ 접수 */
  check("★ 묻고 나서 접수한다", 부른API,
    ["inquiryReturnStateMulti", "reverseChkInfoMulti", "contRtnFares", "registReturnRequest"]);
  check("★ 접수가 맨 마지막이다", 부른API[부른API.length - 1], "registReturnRequest");

  const 보낸 = c.보낸것[c.보낸것.length - 1].body.data[0];
  check("★ 조회가 준 운임타입을 그대로 쓴다", 보낸.fareTy, "010");
}

console.log("\n[4-2] ★ 운임은 «반품 계약 운임» 이다 — 지점 배송운임이 아니다");
{
  /*  ★ 2026-10-08 실측으로 드러난 자리 ★
      reverseChkInfoMulti 의 dlvFare 는 «그 지점의 배송운임» 이고 지점마다 다르다 —
      서동작 2,400 · 남강서 2,500 · 서김포 4,000. 반품 계약 운임은 2,500 하나다.
      계약에 없는 운임을 보내면 로젠이 통째로 거절하는데, 돌려주는 말이
      「거래처계약정보 조회 오류 ( 거래처코드 : 348782 )」 라 운임 이야기가 없다.
      그 번호는 우리 거래처코드도 아니라 엉뚱한 데를 보게 만든다. 실제로 그랬다:
        45311894913 · 2,400 → 거래처계약정보 조회 오류
        45311894913 · 2,500 → 정상 접수 (takeNo 261008109134)
      2,500짜리 지점에서만 «우연히» 되고 있었다. 조용히 반이 실패하는 자리였다. */
  const c = 판({ reverseChkInfoMulti: 정상조회, contRtnFares: 계약운임, registReturnRequest: 정상접수 });
  vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  const 보낸 = c.보낸것[c.보낸것.length - 1].body.data[0];
  check("★ 계약 운임을 보낸다 (지점 배송운임 3000 이 아니다)", 보낸.dlvFare, 2500);

  //  ★ 계약 운임을 못 받으면 접수를 막지 않는다 ★
  //    막으면 멀쩡한 건까지 못 보낸다. 틀린 값이면 로젠이 거절하고 사유가 보인다.
  const c2 = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 정상접수 });
  const r2 = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c2);
  check("★ 계약 운임을 못 받아도 접수한다", r2.ok, true);
  check("그때는 조회가 준 값으로 보낸다", c2.보낸것[c2.보낸것.length - 1].body.data[0].dlvFare, 3000);

  //  0 이 오면 쓰지 않는다 — 로젠은 운임 0 인 반품을 안 받는다
  const 빈계약 = { ok: true, json: { data: [{ resultCd: "SUCCESS", data1: [{ dlvFare: 0 }] }] } };
  const c3 = 판({ reverseChkInfoMulti: 정상조회, contRtnFares: 빈계약, registReturnRequest: 정상접수 });
  vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c3);
  check("★ 계약 운임이 0 이면 안 쓴다", c3.보낸것[c3.보낸것.length - 1].body.data[0].dlvFare, 3000);
}

console.log("\n[5] ★ 방향이 반대다 — 송하인은 «고객»");
{
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 정상접수 });
  vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  const 보낸 = c.보낸것[c.보낸것.length - 1].body.data[0];
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
  check("★ 접수를 아예 안 불렀다", c.보낸것.map((x) => x.api).indexOf("registReturnRequest") < 0, true);
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
  check("★ 접수를 아예 안 불렀다", c.보낸것.map((x) => x.api).indexOf("registReturnRequest") < 0, true);
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

console.log("\n[11-2] ★ 이미 접수된 건이면 «또 보내지 않는다»");
{
  /*  > 사장님: "이미 접수 되었다고 뜨면 좋겠는데 그게 판별이 가능할까?"
      같은 건을 또 누르는 일이 실제로 생긴다 — 화면이 안 바뀌었거나, 앞서 실패로
      보였기 때문이다. 그때 로젠이 돌려주는 말이 사람을 더 헷갈리게 한다:
      운임이 맞으면 조용히 같은 접수번호를 주고, 어긋나면 「거래처계약정보 조회
      오류」 라는 엉뚱한 말을 한다. 그래서 «보내기 전에» 묻는다. */
  const 이미접수 = { ok: true, json: { data: [{ resultCd: "TRUE",
    data1: [{ takeNo: "261008109134", slipNo: null, resvStatNm: "접수" }] }] } };
  const c = 판({ inquiryReturnStateMulti: 이미접수, reverseChkInfoMulti: 정상조회,
                 registReturnRequest: 정상접수 });
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  check("★ 실패가 아니다 (그 건은 접수돼 있다)", r.ok, true);
  check("★ 「이미」라고 말해 준다", r.already, true);
  check("★ 그 접수번호를 돌려준다", r.takeNo, "261008109134");
  check("★ 접수를 아예 안 보낸다 (두 번 나가지 않는다)",
    c.보낸것.map((x) => x.api).indexOf("registReturnRequest") < 0, true);
  check("운임도 안 묻는다 (헛걸음)", c.보낸것.map((x) => x.api).indexOf("contRtnFares") < 0, true);

  //  ★ 취소된 건은 다시 접수할 수 있어야 한다 ★
  const 취소됨 = { ok: true, json: { data: [{ resultCd: "TRUE",
    data1: [{ takeNo: "T9", slipNo: null, resvStatNm: "취소" }] }] } };
  const c2 = 판({ inquiryReturnStateMulti: 취소됨, reverseChkInfoMulti: 정상조회,
                  contRtnFares: 계약운임, registReturnRequest: 정상접수 });
  const r2 = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c2);
  check("★ 취소된 건은 새로 접수한다", r2.already === true, false);
  check("그래서 접수가 나간다", c2.보낸것.map((x) => x.api).indexOf("registReturnRequest") >= 0, true);

  //  ★ 못 물으면 막지 않는다 ★ 조회가 안 된다고 접수를 막으면 멀쩡한 건이 영영 안 나간다
  const c3 = 판({ inquiryReturnStateMulti: { ok: false, error: "끊김" },
                  reverseChkInfoMulti: 정상조회, contRtnFares: 계약운임,
                  registReturnRequest: 정상접수 });
  const r3 = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c3);
  check("★ 못 물어도 접수는 한다", r3.ok, true);
  check("그때는 「이미」가 아니다", r3.already === true, false);
}

console.log("\n[12] 로젠이 거절하면 그대로 전한다");
{
  const 거절 = { ok: true, json: { data: [{ resultCd: "FALSE", resultMsg: "이미 접수된 건입니다" }] } };
  const c = 판({ reverseChkInfoMulti: 정상조회, registReturnRequest: 거절 });
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  check("실패로 본다", r.ok, false);
  check("★ 로젠이 한 말을 그대로 앞에 둔다", r.error.indexOf("이미 접수된 건입니다") === 0, true);
  /*  ★ 무엇을 보냈는지 같이 적는다 ★  (2026-10-08)
      로젠의 말이 원인과 동떨어져 있다 — 「거래처계약정보 조회 오류 ( 거래처코드 :
      348782 )」 가 실은 운임이 계약과 달라서였다. 그 말만 보고 계약이 끊겼나,
      남의 송장인가를 의심하며 한참 헤맸다. 보낸 값이 같이 적히면 한눈에 갈린다. */
  check("★ 보낸 운임을 같이 적는다", /보낸 운임 \d+원/.test(r.error), true);
  check("계약 운임을 못 받았으면 그것도 말한다", /계약운임 못 받음/.test(r.error), true);
  check("운임타입도 적는다", /타입 010/.test(r.error), true);
}

console.log("\n[13] 규격 문서와 어긋나지 않는가");
{
  /*  코드가 부르는 API 이름이 규격 문서에 실제로 있는지 본다.
      이름을 잘못 적으면 404 가 아니라 «조용한 실패»로 온다.  */
  const 부르는API = [];
  for (const m of src.matchAll(/_logen_call_\("([A-Za-z]+)"/g)) {
    if (부르는API.indexOf(m[1]) < 0) 부르는API.push(m[1]);
  }
  /*  숫자를 못 박지 않는다 — API 를 하나 늘릴 때마다 여기서 걸리는데,
      그건 이 시험이 보려던 것이 아니다. 「규격에 있는 것만 부르나」가 볼 것이다.
      (2026-10-08: contRtnFares 를 더하다 4 → 5 로 걸렸다) */
  check("부르는 API 를 하나라도 찾았다", 부르는API.length > 0, true);
  const 없는것 = 부르는API.filter((a) => 규격.indexOf(a) < 0);
  check("★ 규격에 없는 API 를 부르지 않는다", 없는것, []);
  check("★ 운임은 반품 계약 운임으로 받는다", 부르는API.indexOf("contRtnFares") >= 0, true);

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
  /*  ★ 2026-10-07: 택배사 판정을 «한 곳»으로 모았다 ★
      카드 쪽 네 군데가 저마다 '롯데'를 글자로 박아 두어, 로젠 건인데
      「롯데에 회수 접수합니다」라고 묻고 낱개 단추는 아예 안 나왔다.
      이제 retCardCarrier(c) 하나가 정하고 나머지는 그것을 쓴다. */
  check("★ 택배사를 한 곳에서 정한다", html.indexOf("function retCardCarrier(") >= 0, true);
  check("★ 로젠 건에서도 단추가 나온다",
    html.indexOf("var 로젠 = retCardCarrier(c) === '로젠';") >= 0, true);
  check("★ 택배사에 맞는 준비 상태를 본다",
    html.indexOf("var rdy = 로젠 ? LGR_READY : LRT_READY;") >= 0, true);
  check("★ 낱개 박스 단추도 로젠을 알아본다",
    html.indexOf("var canPick = retCardCanPick(c);") >= 0, true);
  check("★ 확인창이 택배사 이름을 바꿔 말한다",
    html.indexOf("retCardCarrier(c) + '에 회수 접수를 보냅니다") >= 0, true);
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

console.log("\n[16-2] ★ 실패하는 «두 가지 모두»가 보낸 값을 말해 준다");
{
  /*  ★ 이 시험이 생긴 까닭 ★  (2026-10-08)
      로젠의 실패 메시지가 원인과 동떨어져 있어서, 실패할 때 «무엇을 보냈는지»를
      같이 적게 했다. 그런데 처음엔 건별 resultCd 가지에만 붙였다.
      실제 실패는 «HTTP 단계»에서 통째로 거절되는 가지였고, 거기엔 안 붙어 있었다.
      그래서 그 글을 보고도 「내가 고친 자리에서 나온 게 아니다」를 못 알아봤고,
      사장님이 같은 화면을 네 번 보여 주셔야 했다.
      한쪽에만 붙이면, 안 붙은 쪽이 꼭 그 쪽이다. */

  //  ① HTTP 단계에서 통째로 거절될 때
  const 통째거절 = { ok: false, error: "거래처계약정보 조회 오류 ( 거래처코드 : 348782 )" };
  const c = 판({ reverseChkInfoMulti: 정상조회, contRtnFares: 계약운임,
                 registReturnRequest: 통째거절 });
  const r = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c);
  check("실패로 본다", r.ok, false);
  check("★ 로젠이 한 말이 앞에 있다", r.error.indexOf("거래처계약정보 조회 오류") === 0, true);
  check("★ HTTP 거절에도 보낸 값이 붙는다", /보낸 운임 \d+원/.test(r.error), true);
  check("계약 운임도 적는다", /계약 2500/.test(r.error), true);

  //  ② 건별 resultCd 가 FALSE 일 때
  const 건별거절 = { ok: true, json: { data: [{ resultCd: "FALSE", resultMsg: "무슨 오류" }] } };
  const c2 = 판({ reverseChkInfoMulti: 정상조회, contRtnFares: 계약운임,
                  registReturnRequest: 건별거절 });
  const r2 = vm.runInContext("csLogenReturnRegister(" + JSON.stringify(고객) + ")", c2);
  check("★ 건별 거절에도 붙는다", /보낸 운임 \d+원/.test(r2.error), true);

  //  ★ 두 가지가 «같은 함수»를 쓴다 — 두 벌이면 한쪽만 고쳐진다
  //  «부르는» 곳만 센다 — 정의 한 줄이 같은 모양이라 같이 걸린다
  check("★ 두 가지가 같은 함수를 쓴다 (꼬리말이 두 벌이 아니다)",
    (src.match(/_lgr_sentTail_\(/g) || []).length -
    (src.match(/function _lgr_sentTail_\(/g) || []).length, 2);
  check("꼬리말을 만드는 곳은 하나다",
    (src.match(/function _lgr_sentTail_\(/g) || []).length, 1);
}

console.log("\n[17] ★ 화면 둘이 «같은 자»로 성공을 재는가");
{
  /*  ★ 이 시험이 지키는 자리 ★  (2026-10-08)
      로젠은 접수 순간에 «반품송장을 안 준다». takeNo 만 온다(규격 §8.2).
      그런데 반품 카드 쪽 핸들러(_retPickupSend_)가 성공을 invoices 로만 재고
      있었다 — 그래서 **로젠 접수는 제대로 돼도 늘 「회수 접수 실패」로 보였다.**
      반품대장 창 쪽 핸들러는 takeNos 를 보고 있었다. 두 벌이라 한쪽만 고쳐져
      있던 자리다([[one-value-one-owner]]).

      사장님이 같은 화면을 세 번 보여 주셔서 찾았다. 그동안 실패한 줄 알고
      다시 누르면 접수가 두 번 나갈 뻔했다. */
  const home = fs.readFileSync("home.html", "utf8");

  //  성공을 재는 자리가 둘 다 takeNos 를 본다
  check("★ 두 화면 다 접수번호로도 성공을 잰다",
    (home.match(/var takes = \(res && res\.takeNos\) \|\| \[\];/g) || []).length, 2);
  check("★ 둘 다 「송장도 접수번호도 없을 때」만 실패로 본다",
    (home.match(/if \(!(got|slips)\.length && !takes\.length\)/g) || []).length, 2);
  check("★ 둘 다 「이미 접수된 건」을 말해 준다",
    (home.match(/이미 접수된 건입니다 · 접수번호/g) || []).length, 2);
  check("★ 둘 다 송장이 늦게 나온다는 것을 숨기지 않는다",
    (home.match(/반품송장은 로젠이 출력한 뒤에 나옵니다/g) || []).length, 2);

  //  서버가 그 둘을 실제로 채워 주는가
  check("접수번호를 돌려준다", /out\.takeNos\.push/.test(src), true);
  check("「이미」를 돌려준다", /out\.already = 이미된것;/.test(src), true);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
