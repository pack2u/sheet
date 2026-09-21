/**
 * 전화주문 고유ID —  규칙 하나.  p0921000047
 *
 *  > "그냥 사방넷처럼 하자..걍 숫자로도 수백만개의 고유아이디를 적용하는데"
 *  > "날짜 자채가 새로운 넘버링인데.."
 *  > "전화주문은 p로 시작 대리판매는 d로 시작.. 뒤 여섯자리는 동일"
 *  > "그냥 앞으로 그렇게 고유아이디 부여하면되.. 날짜 상관하지말고..."
 *  > "그냥 고유아이디 규칙만 바꾸면 끝이야"
 *
 *  ── 규칙 ──
 *    원장에 이 주문의 ID 가 이미 있으면 그것을 쓴다. 없으면 그날 다음 번호를 준다.
 *    전환일도, 난수도, 해시도 없다.
 *
 *  ★ 기억이 없으면 돌지 않는다 ★
 *    판매현황은 하루 두 번 통째로 다시 받는다. 번호는 «다시 계산»할 수 없으니
 *    원장에 적힌 것을 꺼내 써야 한다. 기억 없이 돌면 번호를 1 번부터 다시 주고,
 *    아침에 나간 주문과 같은 번호가 다른 사람에게 간다.
 *
 * 실행: node _ssphid_test.js
 */
const path = require("path");
const core = require(path.join(__dirname, "세트분리V2", "core.js"));

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const 기본 = {
  일자: "20260922-100", 받는분: "김철수", 모바일: "01012345678",
  주소1: "서울시 강남구 테헤란로 1", 원본코드: "A100", 원본품목명: "밀폐용기 500ml", 주문수량: 2,
};
const 손님 = (이름) => Object.assign({}, 기본, { 받는분: 이름 });

/** 아직 아무 ID 도 안 나간 상태 */
function 새기억() { return { 표: {}, 다음: {} }; }
function 설정(기억) {
  return Object.assign({}, core.SS_DEFAULT_CONFIG, { _전화ID기억: 기억 });
}
/** 원장을 다시 읽어 온 것처럼 기억을 통째로 베낀다 (쓴횟수는 안 넘어간다) */
function 다음회차(기억) {
  return { 표: JSON.parse(JSON.stringify(기억.표)), 다음: Object.assign({}, 기억.다음) };
}

console.log("\n① 새 주문은 그날 다음 번호");
{
  const 기억 = 새기억(), cfg = 설정(기억);
  const a = core.ssMakeOrderId(기본, cfg);
  const b = core.ssMakeOrderId(손님("박영희"), cfg);
  console.log("   " + a + "   " + b);
  ok("p + MMdd + 여섯 자리", /^p0922\d{6}$/.test(a), a);
  ok("1번부터", a === "p0922000001", a);
  ok("다음은 2번", b === "p0922000002", b);
}

console.log("\n② ★ 같은 주문은 회차가 바뀌어도 같은 ID ★");
{
  const 오전기억 = 새기억(), 오전 = 설정(오전기억);
  const 김 = core.ssMakeOrderId(기본, 오전);
  const 박 = core.ssMakeOrderId(손님("박영희"), 오전);

  //  오후 — 새 주문이 «앞에» 끼어들었다. 차례가 바뀌어도 번호가 흔들리면 안 된다.
  const 오후 = 설정(다음회차(오전기억));
  const 최 = core.ssMakeOrderId(손님("최민수"), 오후);
  const 김2 = core.ssMakeOrderId(기본, 오후);
  const 박2 = core.ssMakeOrderId(손님("박영희"), 오후);

  console.log("   오전  " + 김 + " " + 박);
  console.log("   오후  최민수 " + 최 + " (새)   " + 김2 + " " + 박2);
  ok("김철수 그대로", 김2 === 김, 김 + " → " + 김2);
  ok("박영희 그대로", 박2 === 박, 박 + " → " + 박2);
  ok("새 주문만 다음 번호", 최 === "p0922000003", 최);
}

console.log("\n③ 옛 ID 를 가진 주문은 그 ID 그대로 (뒤돌아보지 않는다)");
{
  //  원장에서 옛 모양도 같이 읽어 오므로, 지난 주문은 손대지 않는다
  const 씨앗 = core.ssOrderSeed(기본);
  const 기억 = { 표: { [씨앗]: ["0922-PH-816c07"] }, 다음: { "0922": 5 } };
  const a = core.ssMakeOrderId(기본, 설정(기억));
  console.log("   " + a);
  ok("옛 해시 ID 를 그대로 돌려준다", a === "0922-PH-816c07", a);
}

console.log("\n④ 원장에 이미 47번까지 나갔으면 48번부터");
{
  ok("p0922000048",
    core.ssMakeOrderId(기본, 설정({ 표: {}, 다음: { "0922": 48 } })) === "p0922000048");
}

console.log("\n⑤ ★ 기억이 없으면 멈춘다 (옛 모양으로 슬쩍 돌아가지 않는다) ★");
{
  let 멈췄나 = false, 말 = "";
  try { core.ssMakeOrderId(기본, core.SS_DEFAULT_CONFIG); }
  catch (e) { 멈췄나 = true; 말 = e.message; }
  ok("멈춘다", 멈췄나);
  ok("왜 멈췄는지 말한다", 말.indexOf("기억") >= 0, 말.slice(0, 60));
}

console.log("\n⑥ 씨앗은 한 곳에서만 만든다 (발급과 기억이 같은 값을 본다)");
{
  ok("ssOrderSeed 를 내보낸다", typeof core.ssOrderSeed === "function");
  ok("배송지가 바뀌어도 같은 주문이다",
    core.ssOrderSeed(Object.assign({}, 기본, { 원받는분: "김철수", 받는분: "박영희" }))
    === core.ssOrderSeed(기본));
}

console.log("\n⑦ 하루 1,000건을 뽑아도 하나도 안 겹친다");
{
  const cfg = 설정(새기억());
  const 본것 = {}; let 겹침 = 0, 마지막 = "";
  for (let i = 0; i < 1000; i++) {
    마지막 = core.ssMakeOrderId(손님("손님" + i), cfg);
    if (본것[마지막]) 겹침++; 본것[마지막] = true;
  }
  ok("겹침 0", 겹침 === 0, "겹침 " + 겹침 + "건");
  ok("마지막이 001000", 마지막 === "p0922001000", 마지막);
}

console.log("\n⑧ 사방넷 주문번호와 헷갈리지 않는다");
{
  ok("p0922000001 은 사방넷이 아니다", core.ssIsSabangnetUid("p0922000001") === false);
  ok("d0922000001 도 아니다", core.ssIsSabangnetUid("d0922000001") === false);
  ok("0922-PH-816c07 도 아니다", core.ssIsSabangnetUid("0922-PH-816c07") === false);
  ok("2163979121 은 사방넷이다", core.ssIsSabangnetUid("2163979121") === true);
}

console.log("\n⑨ 똑같은 내용 두 줄 — 각자 제 번호를 갖고, 다음 회차에도 그대로");
{
  const 머리 = ["순번", "일자-No.", "품목코드", "품목명", "수량", "거래처명", "주소1",
    "전화", "모바일", "적요", "합계", "주문자명(주문서)", "주문자명(사방넷)",
    "배송지(주문서)/배송메시지(주문서)", "추가문자형7"];
  const 줄 = (순번, 이름) => [String(순번), "20260922-100", "A100", "밀폐용기 500ml", "2", 이름,
    "서울시 강남구 테헤란로 1", "", "01012345678", "", "10000", "", "", "", ""];
  const 판매현황 = [머리, 줄(1, "김철수"), 줄(2, "김철수")];

  const w1 = [], cfg = 설정(새기억());
  const ids = core.ssNormalize(판매현황, cfg, w1).map((l) => l.고유ID);
  console.log("   " + ids.join("   "));
  ok("둘 다 번호표 모양 (-2 가 안 붙는다)",
    ids.every((x) => /^p0922\d{6}$/.test(x)), ids.join(" , "));
  ok("앞뒤로 이어진 번호", ids[0] === "p0922000001" && ids[1] === "p0922000002", ids.join(" , "));
  ok("겹침 경고가 없다", w1.filter((w) => (w.code || w[1]) === "ID_COLLISION").length === 0);

  const w2 = [];
  const ids2 = core.ssNormalize(판매현황, 설정(다음회차(cfg._전화ID기억)), w2)
    .map((l) => l.고유ID);
  console.log("   다음 회차  " + ids2.join("   "));
  ok("다음 회차에도 그대로", ids2[0] === ids[0] && ids2[1] === ids[1], ids2.join(" , "));
}

console.log("\n⑩ 한 실행에서 두 번 계산해도 번호가 안 밀린다 (우편번호 재계산)");
{
  const 머리 = ["순번", "일자-No.", "품목코드", "품목명", "수량", "거래처명", "주소1",
    "전화", "모바일", "적요", "합계", "주문자명(주문서)", "주문자명(사방넷)",
    "배송지(주문서)/배송메시지(주문서)", "추가문자형7"];
  const 줄 = (순번, 이름) => [String(순번), "20260922-100", "A100", "밀폐용기 500ml", "2", 이름,
    "서울시 강남구 테헤란로 1", "", "01012345678", "", "10000", "", "", "", ""];
  const 판매현황 = [머리, 줄(1, "김철수"), 줄(2, "박영희")];
  const cfg = 설정(새기억());          // ★ 같은 cfg 를 두 번 태운다
  const 첫 = core.ssNormalize(판매현황, cfg, []).map((l) => l.고유ID);
  const 둘 = core.ssNormalize(판매현황, cfg, []).map((l) => l.고유ID);
  console.log("   첫 계산 " + 첫.join(" ") + "   다시 계산 " + 둘.join(" "));
  ok("두 번 계산해도 같다", 첫.join() === 둘.join(), 첫.join() + "  vs  " + 둘.join());
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
