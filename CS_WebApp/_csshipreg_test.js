/**
 * 출고 주문 등록 — «취소 API 가 없는» 길이라 울타리를 두껍게 둔다
 *
 * ★ 이 시험이 지키는 것 ★
 *   > 사장님: "주문 등록 (③)부터 해줘"   (2026-10-15)
 *   > 규격서: 「계약에 없는 운임을 보내면 **통째로 거절**된다」 (2026-10-08 실측)
 *
 *   registerOrderData 는 **취소 API 가 없다.** 잘못 보내면 로젠에 전화해야 한다.
 *   그래서 이 시험은 「되나」가 아니라 「**잘못 보내지 않나**」를 본다.
 *
 * 실행: node _csshipreg_test.js
 */
const fs = require("fs");
const vm = require("vm");

const src = fs.readFileSync("csLogenShipRegister.gs", "utf8");
const ship = fs.readFileSync("csLogenShipSlips.gs", "utf8");
const hourly = fs.readFileSync("csPickupRequests.gs", "utf8");
const 규격 = fs.readFileSync("로젠택배_OpenAPI_규격.md", "utf8");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label + (cond || 덧 == null ? "" : "\n          " + 덧));
}

const 머리 = ["회차키", "경로", "택배사", "송장키", "운송장번호", "거래처명", "주소1",
             "전화", "모바일", "보내는분", "보내는분전화", "택배박스수량", "수량",
             "출력품목명", "배송메시지", "합계", "도선료"];

/*  울타리 — 로젠은 흉내만 낸다. 무엇을 «보냈는지»가 이 시험이 볼 것이다. */
function 판(줄들, opt) {
  opt = opt || {};
  const 보낸것 = [];
  const 속성 = Object.assign({}, opt.속성 || {});
  const ctx = {
    console, String, Number, Array, Math, JSON, Date, Object, parseInt, isNaN, RegExp,
    Logger: { log: () => {} },
    Utilities: {
      formatDate: (d) => {
        const p = (x) => String(x).padStart(2, "0");
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
      },
      sleep: () => {},
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in 속성 ? 속성[k] : null),
      setProperty: (k, v) => { 속성[k] = String(v); },
    }) },
    _CS_LEDGER_SS_ID_: "x", _CS_RETURN_LEDGER_ID_: "y",
    SpreadsheetApp: { openById: () => ({
      getSheetByName: (n) => n !== "주문라인원장" ? null : {
        getLastRow: () => 줄들.length + 1,
        getLastColumn: () => 머리.length,
        getRange: (r, cc, nr) => ({ getDisplayValues: () =>
          r === 1 ? [머리] : 줄들.slice(r - 2, r - 2 + nr) }),
      },
    }) },
    _cpr_ops_: () => {},
    _LOGEN_BATCH_SIZE_: 10, _LOGEN_BATCH_DELAY_MS_: 2000, _LOGEN_TIME_BUDGET_MS_: 150000,
    _logen_userId_: () => "30556066",
    _logen_custCd_: () => "30556066",
    _logen_arr_: (v) => (v == null ? [] : (Object.prototype.toString.call(v) === "[object Array]" ? v : [v])),
    _logen_ok_: (v) => { const s = String(v == null ? "" : v).trim().toUpperCase();
                         return s === "TRUE" || s === "SUCCESS"; },
    _logen_blank_: (v) => !String(v == null ? "" : v).trim(),
    _ls_isLogenRow_: (경로, 택배사) => {
      const p = String(경로 || "").trim();
      if (p) return p.indexOf("로젠택배") === 0;
      return String(택배사 || "").indexOf("로젠") !== -1;
    },
    _logen_call_: (api, body) => {
      보낸것.push({ api, body });
      if (api === "contPickFares") {
        if (opt.운임없음) return { ok: false, error: "못 물음" };
        return { ok: true, json: { sttsCd: "SUCCESS",
          data: [{ boxTyCd: "ZW001", dlvFare: opt.운임 == null ? 2200 : opt.운임 }] } };
      }
      if (api === "registerOrderData") {
        if (opt.등록실패) return { ok: false, error: "호출 실패: 끊김" };
        const data = body.data.map((d, i) =>
          (opt.응답빼기 && i === 0) ? null
            : { fixTakeNo: d.fixTakeNo, resultCd: opt.거절 ? "FALSE" : "TRUE",
                resultMsg: opt.거절 ? "거래처계약정보 조회 오류" : "" });
        return { ok: true, json: { data: data.filter(Boolean) } };
      }
      return { ok: false, error: "모르는 api " + api };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.보낸것 = 보낸것; ctx.속성 = 속성;
  return ctx;
}

const 줄 = (키, 덮 = {}) => {
  const base = {
    회차키: "261015-1", 경로: "로젠택배", 택배사: "", 송장키: 키, 운송장번호: "",
    거래처명: "장원분", 주소1: "대구광역시 달성군 구지면 응암리 1252",
    전화: "", 모바일: "0502-5294-5555", 보내는분: "팩투유", 보내는분전화: "031-923-7795",
    택배박스수량: "1", 수량: "1", 출력품목명: "JH 샐러드 203 204 공용 600개----뚜껑만",
    배송메시지: "문 앞", 합계: "57700", 도선료: "",
  };
  const v = Object.assign(base, 덮);
  return 머리.map((h) => String(v[h] == null ? "" : v[h]));
};
const 보낸등록 = (c) => c.보낸것.filter((x) => x.api === "registerOrderData");

console.log("\n[1] ★★ 기본은 «보내지 않는다» ★★ — 취소 API 가 없다");
{
  /*  잘못 보내면 로젠에 전화해야 한다. 사람이 눈으로 훑는 단계가 지금 복붙 전의
      유일한 안전장치이고, 그것을 없애면서 자동 전송까지 하면 안전망이 둘 다 사라진다. */
  const c = 판([줄("A_S1"), 줄("A_S2")]);
  const 말 = c.csLogenRegisterShipOrders();              // opt 없이
  ok("★ 아무 옵션 없이 부르면 보내지 않는다", 보낸등록(c).length === 0, 말.slice(0, 200));
  ok("★ 연습이라고 말해 준다", /연습 — 보내지 않습니다/.test(말));
  ok("★ 무엇이 나갈지 그대로 보여 준다 (마지막 검문)", /"fixTakeNo": "A_S1"/.test(말), 말.slice(0, 400));
  ok("보내는 법을 알려 준다", /보냄: true/.test(말));
  ok("취소 API 가 없다는 것이 파일에 적혀 있다", /취소 API 가 없다/.test(src));

  //  ★ 1시간 일감에 붙이지 않았다 ★ 붙으면 사람 없이 실제 주문이 나간다
  ok("★ 1시간 일감에 안 붙였다", !/csLogenRegisterShipOrders/.test(hourly));
}

console.log("\n[2] ★★ fixTakeNo 는 «송장키» 다 ★★ — 세트가 통째로 겹친다");
{
  /*  2026-10-15 실측: 261015-1 회차 로젠 172줄 중 **38개 주문이 세트로 쪼개져**
      있었다. 쪼개진 줄은 사방넷주문번호가 같고 송장키만 _S1 · _S2 로 갈린다.
      사방넷주문번호로 보내면 그 38개가 겹쳐 로젠이 가릴 수 없고, 송장 회수가
      «송장키»로 묻기 때문에 영영 짝이 안 맞는다. */
  const c = 판([줄("2168210706_S1"), 줄("2168210706_S2")], {});
  c.csLogenRegisterShipOrders({ 보냄: true });
  const d = 보낸등록(c)[0].body.data;
  ok("★ 두 줄이 서로 다른 fixTakeNo 로 나간다",
     d.length === 2 && d[0].fixTakeNo !== d[1].fixTakeNo,
     JSON.stringify(d.map((x) => x.fixTakeNo)));
  ok("★ 송장키를 그대로 쓴다 (_S1 꼬리가 살아 있다)",
     d[0].fixTakeNo === "2168210706_S1" && d[1].fixTakeNo === "2168210706_S2");
  ok("★ 사방넷주문번호로 보내지 않는다 (꼬리를 떼지 않는다)",
     !d.some((x) => x.fixTakeNo === "2168210706"));

  //  회수하는 쪽과 같은 열쇠여야 한다 — 두 파일이 갈라지면 조용히 안 맞는다
  ok("★ 회수하는 쪽도 송장키로 묻는다 (같은 열쇠)",
     /nm === "송장키"/.test(ship) && /fixTakeNo: chunk\[i\]\.uid/.test(ship));
  ok("등록하는 쪽도 송장키 열을 찾는다", /nm === "송장키"\) c\.key = h/.test(src));
  ok("송장키 열이 없으면 멈춘다 (엉뚱한 열로 보내지 않는다)",
     /「송장키」 열을 못 찾았습니다/.test(src));
}

console.log("\n[3] ★★ dlvFare 는 «계약 운임» — 원장 「배송비」가 아니다 ★★");
{
  /*  원장 「배송비」(= 출력 탭 「단품배송비」)는 2,200~4,000 으로 줄마다 다르다.
      그건 우리가 매기는 배송비고 로젠에 신고하는 운임이 아니다.
      규격서 실측: 「계약에 없는 운임을 보내면 **통째로 거절**된다」 */
  ok("규격서에 그 실측이 적혀 있다", /계약에 없는 운임을 .*보내면 \*\*통째로 거절\*\*된다/.test(규격));

  const c = 판([줄("B1")], { 운임: 2200 });
  c.csLogenRegisterShipOrders({ 보냄: true });
  const p = 보낸등록(c)[0].body.data[0];
  ok("★ 계약 운임(2200)을 보낸다", p.dlvFare === 2200, "실제: " + p.dlvFare);
  ok("★ contPickFares 를 «물어서» 쓴다",
     c.보낸것.some((x) => x.api === "contPickFares"));
  ok("원장 「배송비」 칸을 아예 읽지 않는다", !/"배송비"/.test(src) && !/배송비산출/.test(src));

  //  ★ 못 물으면 보내지 않는다 ★ 짐작한 운임을 보내지 않는다
  const c2 = 판([줄("B2")], { 운임없음: true });
  const 말2 = c2.csLogenRegisterShipOrders({ 보냄: true });
  ok("★ 운임을 못 물으면 한 건도 안 보낸다", 보낸등록(c2).length === 0, 말2.slice(0, 160));
  ok("★ 왜 안 보냈는지 말해 준다", /계약 운임을 못 물었습니다/.test(말2));

  //  운임은 한 실행에 한 번만 묻는다
  const c3 = 판([줄("B3"), 줄("B4")], {});
  c3.csLogenRegisterShipOrders({ 보냄: true });
  ok("운임은 한 번만 묻는다 (줄마다 묻지 않는다)",
     c3.보낸것.filter((x) => x.api === "contPickFares").length === 1);
  ok("contPickFares 에 resultCd 가 없다는 것을 적어 뒀다",
     /resultCd 가 «없다»/.test(src));
}

console.log("\n[4] ★ goodsAmt — 대표님이 정하실 때까지 «안 보낸다»");
{
  /*  규격상 필수가 아니다(N). 「물품금액을 무엇으로 신고하나」는 보상 한도·할증과
      엮이는 계약 이야기라 내가 정할 수 없다. 짐작한 금액을 신고하지 않는다. */
  const c = 판([줄("C1")], {});
  c.csLogenRegisterShipOrders({ 보냄: true });
  const p = 보낸등록(c)[0].body.data[0];
  ok("★ 기본값에서는 goodsAmt 를 안 보낸다", !("goodsAmt" in p), JSON.stringify(p));
  ok("★ 한 값만 고치면 되게 뒀다 (_LSR_GOODS_AMT_)", /var _LSR_GOODS_AMT_ = "";/.test(src));
  ok("「합계」로 고를 수 있다", /g === "합계"/.test(src));
  ok("숫자로 못 박을 수도 있다", /\^\[0-9\]\+\$/.test(src));
  ok("대표님 몫이라고 적어 뒀다", /대표님/.test(src));
}

console.log("\n[5] ★ 두 번 보내지 않는다 — 돌이킬 수 없는 일이다");
{
  const c = 판([줄("D1"), 줄("D2")], {});
  c.csLogenRegisterShipOrders({ 보냄: true });
  ok("첫 번에 둘 다 보냈다", 보낸등록(c)[0].body.data.length === 2);
  ok("★ 「등록함」에 적어 둔다", /D1/.test(String(c.속성["LSR_DONE_261015-1"] || "")));

  //  같은 회차를 다시 돌린다 — 한 건도 안 나가야 한다
  const 전 = 보낸등록(c).length;
  const 말 = c.csLogenRegisterShipOrders({ 보냄: true });
  ok("★ 다시 돌려도 안 보낸다", 보낸등록(c).length === 전, 말.slice(0, 160));
  ok("★ 건너뛴 까닭을 말해 준다", /이미 등록해 건너뜀 2/.test(말), 말.slice(0, 200));

  //  운송장번호가 이미 있으면 벌써 나간 건이다
  const c2 = 판([줄("E1", { 운송장번호: "45361367295" }), 줄("E2")], {});
  const 말2 = c2.csLogenRegisterShipOrders({ 보냄: true });
  ok("★ 송장이 이미 있는 줄은 안 보낸다",
     보낸등록(c2)[0].body.data.length === 1 &&
     보낸등록(c2)[0].body.data[0].fixTakeNo === "E2");
  ok("그것도 말해 준다", /송장이 이미 있어 건너뜀 1/.test(말2));

  //  ★ 거절된 것은 「등록함」에 적지 않는다 ★ 적으면 다시 못 보낸다
  const c3 = 판([줄("F1")], { 거절: true });
  c3.csLogenRegisterShipOrders({ 보냄: true });
  ok("★ 거절된 것은 등록함에 안 적는다 (다시 보낼 수 있어야 한다)",
     !/F1/.test(String(c3.속성["LSR_DONE_261015-1"] || "")));
  ok("거절 사유를 그대로 옮긴다", /거래처계약정보 조회 오류/.test(c3.csLogenRegisterShipOrders({ 보냄: false })) === false);
}

console.log("\n[6] ★ 모르는 것을 «됨»으로 세지 않는다");
{
  /*  응답에 안 실려 온 건을 성공으로 세면, 「등록함」에 적혀 다시 못 보내고
      로젠에도 없는 유령이 된다. [[dont-overwrite-what-you-couldnt-read]] */
  const c = 판([줄("G1"), 줄("G2")], { 응답빼기: true });
  const 말 = c.csLogenRegisterShipOrders({ 보냄: true });
  ok("★ 응답에 없는 건은 실패로 센다", /등록 1 · 실패 1/.test(말), 말.slice(-200));
  ok("★ 그 번호를 말해 준다", /응답에 없습니다/.test(말));
  ok("★ 등록함에도 안 적는다", !/G1/.test(String(c.속성["LSR_DONE_261015-1"] || "")));

  //  호출 자체가 실패하면 전건 실패
  const c2 = 판([줄("H1")], { 등록실패: true });
  const 말2 = c2.csLogenRegisterShipOrders({ 보냄: true });
  ok("호출이 실패하면 그 묶음은 전건 실패", /등록 0 · 실패 1/.test(말2));
}

console.log("\n[7] ★ 빈 칸은 지어내지 않는다 — 엉뚱한 데로 가는 것이 더 나쁘다");
{
  const c = 판([
    줄("I1", { 거래처명: "" }),
    줄("I2", { 주소1: "" }),
    줄("I3", { 전화: "", 모바일: "" }),
    줄("I4", { 택배박스수량: "0" }),
    줄("I5"),
  ], {});
  const 말 = c.csLogenRegisterShipOrders({ 보냄: true });
  const d = 보낸등록(c)[0].body.data;
  ok("★ 멀쩡한 한 줄만 나간다", d.length === 1 && d[0].fixTakeNo === "I5",
     JSON.stringify(d.map((x) => x.fixTakeNo)));
  ok("★ 몇 줄을 건너뛰었는지 센다", /칸이 비어 건너뜀 4/.test(말), 말.slice(0, 260));
  ok("★ 어느 칸이 비었는지 말해 준다 (사람이 고칠 수 있게)",
     /I1 — 거래처명 없음/.test(말) && /I3 — 전화·모바일 없음/.test(말), 말.slice(0, 400));
  ok("전화·모바일 중 하나만 있으면 된다 (둘 다 필수가 아니다)",
     /!한줄\.tel && !한줄\.cell/.test(src));

  /*  ★ 같은 번호를 두 칸에 넣지 않는다 ★ 규격은 「택1」이다. 2026-10-15 실측에서
      「전화」와 「모바일」이 같은 값인 줄이 흔했다 — 그대로 보내면 라벨에 같은
      번호가 두 번 찍힐 수 있다. 보내는 값은 적을수록 틀릴 데가 적다. */
  const c2 = 판([줄("K1", { 전화: "010-6462-3938", 모바일: "010-6462-3938" })], {});
  c2.csLogenRegisterShipOrders({ 보냄: true });
  const p2 = 보낸등록(c2)[0].body.data[0];
  ok("★ 전화와 모바일이 같으면 한 칸만 보낸다",
     p2.rcvCellNo === "010-6462-3938" && !("rcvTelNo" in p2), JSON.stringify(p2));

  //  하이픈 모양만 다른 것도 같은 번호로 본다
  const c3 = 판([줄("K2", { 전화: "01064623938", 모바일: "010-6462-3938" })], {});
  c3.csLogenRegisterShipOrders({ 보냄: true });
  ok("하이픈만 다른 것도 같은 번호로 본다",
     !("rcvTelNo" in 보낸등록(c3)[0].body.data[0]));

  //  다르면 둘 다 보낸다 — 집 전화와 휴대폰이 따로일 수 있다
  const c4 = 판([줄("K3", { 전화: "031-923-7795", 모바일: "010-6462-3938" })], {});
  c4.csLogenRegisterShipOrders({ 보냄: true });
  const p4 = 보낸등록(c4)[0].body.data[0];
  ok("★ 다르면 둘 다 보낸다 (집 전화가 따로일 수 있다)",
     p4.rcvCellNo === "010-6462-3938" && p4.rcvTelNo === "031-923-7795");
}

console.log("\n[8] ★ 규격이 못 박은 자리들");
{
  const c = 판([줄("J1", { 도선료: "5000" })], {});
  c.csLogenRegisterShipOrders({ 보냄: true });
  const p = 보낸등록(c)[0].body.data[0];
  ok("★ slipNo 는 공백으로 보낸다 (우리가 번호를 정하지 않는다)", p.slipNo === "");
  ok("규격에 그렇게 적혀 있다", /`slipNo` \| S11 \| N \| 운송장번호 \| ⚠️ \*\*공백으로 전송\*\*/.test(규격));
  ok("takeDt 는 회차에서 뽑는다 (261015-1 → 20261015)", p.takeDt === "20261015");
  ok("boxTyCd 는 ZW001", p.boxTyCd === "ZW001");
  ok("fareTy 는 선불 010", p.fareTy === "010");
  ok("★ 도선료는 extraFare 로 간다", p.extraFare === 5000);
  ok("qty 는 «박스 수», inQty 는 «내품 수»", p.qty === 1 && p.inQty === 1);
  ok("송하인 주소는 한 값이다 (출력 탭 172줄이 모두 같았다)",
     p.sndCustAddr === "경기도 평택시 포승읍 성해홍원로 91 팩투유");
  ok("보내는분은 줄에서 가져온다 (팩투유·인더샵 등으로 갈린다)", p.sndCustNm === "팩투유");

  //  도선료가 없으면 아예 안 보낸다 — 0 을 보내 할증을 덮지 않는다
  const c2 = 판([줄("J2")], {});
  c2.csLogenRegisterShipOrders({ 보냄: true });
  ok("도선료가 없으면 extraFare 를 안 보낸다",
     !("extraFare" in 보낸등록(c2)[0].body.data[0]));
}

console.log("\n[9] ★ 로젠을 두드리는 리듬은 csLogen 것을 쓴다");
{
  ok("10건씩 끊는다", /_LOGEN_BATCH_SIZE_/.test(src));
  ok("쉼도 그 상수", /Utilities\.sleep\(_LOGEN_BATCH_DELAY_MS_\)/.test(src));
  ok("시간 예산도 그 상수", /_LOGEN_TIME_BUDGET_MS_/.test(src));
  ok("★ 여기서 새 숫자를 안 정한다", !/Utilities\.sleep\(\s*\d/.test(src));
  ok("갓 돌린 회차 판별은 _ls_isLogenRow_ 하나다 (다시 안 짠다)",
     /_ls_isLogenRow_\(/.test(src) && !/indexOf\("로젠택배"\) === 0/.test(src));
  ok("운영점검에 남긴다", /_cpr_ops_\(SpreadsheetApp\.openById\(_CS_RETURN_LEDGER_ID_\), "출고 주문 등록"/.test(src));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
