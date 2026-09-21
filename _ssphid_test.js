/**
 * 전화주문 고유ID — 자리수와 «겹침 판정»
 *
 *  > "니 이론대로라면 자릿수가 문제가 아니네.. 그냥 확률게임이네.."
 *  > "생성되는 순서가 정해지지 않으면 의미가 없자나.."
 *  > "겹쳤을때 이름, 품목명을 확인하는 시스템이 필요한거 아니야?"
 *
 *  ★ 왜 이 시험이 있나 ★
 *    전화주문 ID 는 랜덤이 아니라 «내용 해시»다. 그래서 발주(-ds-)처럼
 *    「겹치면 다시 뽑기」를 못 한다 — 회차마다 같은 값이 나와야 하니까.
 *    남은 수단은 순번(-2)인데, 순번은 «그 회차에 무엇이 같이 들어왔느냐»로
 *    정해져 다음 회차에 딴 줄로 옮겨 붙을 수 있다.
 *
 *    그 흔들림이 해로운 건 «내용이 다른» 겹침 한 가지뿐이다.
 *    내용이 같은 두 줄은 서로 바꿔 놓아도 나가는 물건이 같다.
 *    그래서 둘을 갈라, 해로운 쪽만 '오류'로 올린다. 이 시험이 그것을 지킨다.
 *
 * 실행: node _ssphid_test.js
 */
const path = require("path");
const core = require(path.join(__dirname, "세트분리V2", "core.js"));

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 ? "   " + 덧 : "")); }
}

const 기본 = {
  일자: "20260921-100", 받는분: "김철수", 모바일: "01012345678",
  주소1: "서울시 강남구 테헤란로 1", 원본코드: "A100", 원본품목명: "밀폐용기 500ml", 주문수량: 2,
};
const 지난 = Object.assign({}, 기본, { 일자: "20260920-100" });

console.log("\n① 자리수 — 주문 «일자»로 끊는다");
const 새ID = core.ssMakeOrderId(기본), 옛ID = core.ssMakeOrderId(지난);
console.log("   9/21 주문 → " + 새ID + "      9/20 주문 → " + 옛ID);
ok("9/21 주문은 뒷자리 6", 새ID.split("-PH-")[1].length === 6, 새ID);
ok("9/20 주문은 뒷자리 5 그대로 (지난 ID 가 안 바뀐다)", 옛ID.split("-PH-")[1].length === 5, 옛ID);
ok("같은 주문은 몇 번을 계산해도 같은 값", core.ssMakeOrderId(기본) === 새ID);
ok("배송지가 바뀌어도 원래 값으로 계산한다",
  core.ssMakeOrderId(Object.assign({}, 기본, { 원받는분: "김철수", 받는분: "박영희" })) === 새ID);

console.log("\n② 씨앗은 한 곳에서만 만든다 (ID 와 겹침 판정이 같은 값을 본다)");
ok("ssOrderSeed 를 내보낸다", typeof core.ssOrderSeed === "function");
ok("씨앗이 같으면 ID 도 같다",
  core.ssOrderSeed(기본) === core.ssOrderSeed(Object.assign({}, 기본, { 일자: "20260920-100" })));

/* ── 판매현황 흉내 ────────────────────────────────── */
const 머리 = ["순번", "일자-No.", "품목코드", "품목명", "수량", "거래처명", "주소1",
  "전화", "모바일", "적요", "합계", "주문자명(주문서)", "주문자명(사방넷)",
  "배송지(주문서)/배송메시지(주문서)", "추가문자형7"];
function 줄(순번, 이름, 코드, 품목명, 수량) {
  return [String(순번), "20260921-100", 코드, 품목명, String(수량), 이름,
    "서울시 강남구 테헤란로 1", "", "01012345678", "", "10000", "", "", "", ""];
}
function 돌려(rows) {
  const warnings = [];
  const lines = core.ssNormalize([머리].concat(rows), core.SS_DEFAULT_CONFIG, warnings);
  return { lines: lines, 충돌: warnings.filter((w) => w.code === "ID_COLLISION" || w[1] === "ID_COLLISION") };
}

console.log("\n③ 내용이 «같은» 두 줄 — 순번을 붙이되 조용히");
{
  const r = 돌려([줄(1, "김철수", "A100", "밀폐용기 500ml", 2), 줄(2, "김철수", "A100", "밀폐용기 500ml", 2)]);
  const ids = r.lines.map((l) => l.고유ID);
  console.log("   " + ids.join("   "));
  ok("두 줄의 ID 가 갈린다", ids[0] !== ids[1]);
  ok("뒤 줄에 -2 가 붙는다", /-2$/.test(ids[1]), ids[1]);
  ok("경고는 안 낸다 (서로 바꿔 놓아도 나가는 물건이 같다)", r.충돌.length === 0,
    JSON.stringify(r.충돌).slice(0, 200));
}

console.log("\n④ 내용이 «다른» 두 줄 — 진짜 충돌을 일부러 만들어 본다");
//  같은 날·같은 품목·같은 수량인데 «이름만» 달라 6자리 해시가 겹치는 짝을 찾는다.
const 본것 = {};
let 짝 = null;
for (let i = 0; i < 400000 && !짝; i++) {
  const 이름 = "손님" + i;
  const id = core.ssMakeOrderId(Object.assign({}, 기본, { 받는분: 이름 }));
  if (본것[id]) 짝 = [본것[id], 이름, id]; else 본것[id] = 이름;
}
if (!짝) {
  fail++; console.log("  ❌ 40만 번 안에 겹치는 짝을 못 찾았습니다 (시험을 못 돌렸습니다)");
} else {
  console.log("   " + 짝[0] + " 와 " + 짝[1] + " 가 둘 다 " + 짝[2]);
  const r = 돌려([줄(1, 짝[0], "A100", "밀폐용기 500ml", 2), 줄(2, 짝[1], "A100", "밀폐용기 500ml", 2)]);
  const ids = r.lines.map((l) => l.고유ID);
  console.log("   나온 ID  " + ids.join("   "));
  ok("두 줄의 ID 가 갈린다", ids[0] !== ids[1]);
  ok("«오류»로 올린다", r.충돌.length === 1 && (r.충돌[0].level || r.충돌[0][0]) === "오류",
    JSON.stringify(r.충돌).slice(0, 300));
  const 글 = JSON.stringify(r.충돌);
  ok("경고에 두 사람 이름이 다 나온다", 글.indexOf(짝[0]) >= 0 && 글.indexOf(짝[1]) >= 0);
  ok("경고에 품목명이 나온다", 글.indexOf("밀폐용기") >= 0);
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
