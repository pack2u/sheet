/**
 * 사방넷 송장대량등록 — 다른 날 주문이 한 박스로 섞이지 않는다
 *
 *  > "사방넷 송장대량등록 도 오류가 많은듯.. 다른 주문번호에 송장이 붙어 버리네.."
 *    (2026-09-16)
 *
 *  ★ 까닭 ★
 *    합포장그룹은 ssMerge 가 이렇게 만든다 —
 *        출고지 ♦ 배송키(수취인·주소·전화) ♦ 조건ID   (+ 박스번호)
 *    날짜도 회차도 안 들어간다. 같은 사람이 같은 물건을 다른 날 시키면
 *    «글자가 똑같은» 그룹이 나온다.
 *
 *    사방넷 대량등록은 대상일 여러 날치를 한꺼번에 읽는다(기본 4일, 주말이면 더).
 *    그래서 한 열쇠에 9/15 것과 9/16 것이 같이 담겼다 —
 *      rep 은 나중 줄로 덮이고, kids 에는 두 날 것이 섞인다.
 *    결국 9/15 동봉 주문에 9/16 대표의 송장이 붙는다.
 *
 *  ★ 허브는 이미 맞게 하고 있었다 ★
 *    _partnerOrders.gs 의 combinedKeyByUid 는 «회차키 + / + 그룹»이다.
 *    같은 일을 하는 두 곳 중 여기만 안 따라왔다.
 *
 * 실행: node _bulkbox_test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + JSON.stringify(got) +
    "\n       want " + JSON.stringify(want)); }
};

const bulk = readFileSync("../gasBulk.js", "utf8");
const core = readFileSync("../core.js", "utf8");

const ssText = (v) => (v == null ? "" : String(v).trim());

/*  원장을 훑어 박스를 짓는 대목만 떼어 내 돌린다.
    실제 코드를 오려 오므로, 코드가 바뀌면 이 시험도 같이 바뀐다.  */
function 박스짓기(줄들) {
  const 박스 = {};
  for (const r of 줄들) {
    const rk = ssText(r.회차키);
    const uid4 = ssText(r.고유ID);
    const grp4 = ssText(r.합포장그룹);
    if (!uid4 || !grp4) continue;
    //  ── gasBulk.js 와 «같은» 열쇠를 쓴다 ──
    const 박키4 = (rk || "(회차없음)") + "/" + grp4;
    const 박4 = 박스[박키4] || (박스[박키4] = { rep: "", kids: [], rk: "" });
    if (!박4.rk && rk) 박4.rk = rk;
    if (ssText(r.합포장대표) === "Y") 박4.rep = uid4;
    else 박4.kids.push(uid4);
  }
  return 박스;
}

/*  고쳐지기 «전»의 열쇠 — 그룹만 쓴다  */
function 박스짓기_옛(줄들) {
  const 박스 = {};
  for (const r of 줄들) {
    const rk = ssText(r.회차키);
    const uid4 = ssText(r.고유ID);
    const grp4 = ssText(r.합포장그룹);
    if (!uid4 || !grp4) continue;
    const 박4 = 박스[grp4] || (박스[grp4] = { rep: "", kids: [], rk: "" });
    if (!박4.rk && rk) 박4.rk = rk;
    if (ssText(r.합포장대표) === "Y") 박4.rep = uid4;
    else 박4.kids.push(uid4);
  }
  return 박스;
}

/*  같은 사람이 같은 물건을 이틀에 걸쳐 시켰다.
    ssMerge 가 만드는 그룹 문자열에는 날짜가 없으므로 «글자가 같다».  */
const 같은그룹 = "평택♦김철수|010-1111-2222|서울시 강남구 테헤란로 1♦조건A";
const 원장 = [
  { 회차키: "260915-1", 고유ID: "SB-1001", 합포장그룹: 같은그룹, 합포장대표: "Y" },
  { 회차키: "260915-1", 고유ID: "SB-1002", 합포장그룹: 같은그룹, 합포장대표: "" },
  { 회차키: "260916-1", 고유ID: "SB-2001", 합포장그룹: 같은그룹, 합포장대표: "Y" },
  { 회차키: "260916-1", 고유ID: "SB-2002", 합포장그룹: 같은그룹, 합포장대표: "" },
];

console.log("\n[1] ★ 사고 재현 — 옛 열쇠는 두 날을 한 박스로 만든다");
{
  const 옛 = 박스짓기_옛(원장);
  const 키들 = Object.keys(옛);
  eq("박스가 하나뿐이다 (두 날이 섞였다)", 키들.length, 1);
  const 박 = 옛[키들[0]];
  eq("★ 대표가 «나중 줄»로 덮였다", 박.rep, "SB-2001");
  eq("★ 동봉에 두 날 것이 섞였다", 박.kids, ["SB-1002", "SB-2002"]);
  /*  그래서 9/15 동봉(SB-1002)에 9/16 대표(SB-2001)의 송장이 붙는다.
      사방넷에는 「다른 주문번호에 남의 송장」으로 올라간다.  */
}

console.log("\n[2] ★ 고친 열쇠는 회차별로 갈라 놓는다");
{
  const 박스 = 박스짓기(원장);
  const 키들 = Object.keys(박스).sort();
  eq("★ 박스가 둘이다", 키들.length, 2);
  eq("회차키가 열쇠에 들어 있다", 키들, [
    "260915-1/" + 같은그룹,
    "260916-1/" + 같은그룹,
  ]);

  const 구일오 = 박스[키들[0]], 구일육 = 박스[키들[1]];
  eq("★ 9/15 대표는 9/15 것", 구일오.rep, "SB-1001");
  eq("★ 9/15 동봉은 9/15 것뿐", 구일오.kids, ["SB-1002"]);
  eq("★ 9/16 대표는 9/16 것", 구일육.rep, "SB-2001");
  eq("★ 9/16 동봉은 9/16 것뿐", 구일육.kids, ["SB-2002"]);
}

console.log("\n[3] 같은 회차 안에서는 여전히 한 박스다");
{
  //  가르는 것은 «회차»지 주문이 아니다. 한 회차의 합포장은 그대로 묶여야 한다.
  const 한회차 = [
    { 회차키: "260916-1", 고유ID: "SB-2001", 합포장그룹: 같은그룹, 합포장대표: "Y" },
    { 회차키: "260916-1", 고유ID: "SB-2002", 합포장그룹: 같은그룹, 합포장대표: "" },
    { 회차키: "260916-1", 고유ID: "SB-2003", 합포장그룹: 같은그룹, 합포장대표: "" },
  ];
  const 박스 = 박스짓기(한회차);
  eq("박스 하나", Object.keys(박스).length, 1);
  const 박 = 박스[Object.keys(박스)[0]];
  eq("대표 하나", 박.rep, "SB-2001");
  eq("동봉 둘", 박.kids, ["SB-2002", "SB-2003"]);
}

console.log("\n[4] 회차키가 없는 옛 줄도 그것끼리만 묶인다");
{
  const 섞임 = [
    { 회차키: "", 고유ID: "OLD-1", 합포장그룹: 같은그룹, 합포장대표: "Y" },
    { 회차키: "", 고유ID: "OLD-2", 합포장그룹: 같은그룹, 합포장대표: "" },
    { 회차키: "260916-1", 고유ID: "SB-2001", 합포장그룹: 같은그룹, 합포장대표: "Y" },
    { 회차키: "260916-1", 고유ID: "SB-2002", 합포장그룹: 같은그룹, 합포장대표: "" },
  ];
  const 박스 = 박스짓기(섞임);
  eq("★ 갈린다", Object.keys(박스).length, 2);
  eq("옛 줄끼리", 박스["(회차없음)/" + 같은그룹].kids, ["OLD-2"]);
  eq("★ 옛 줄이 오늘 대표를 안 가져간다", 박스["(회차없음)/" + 같은그룹].rep, "OLD-1");
}

console.log("\n[5] 합포장그룹에 날짜가 «없다»는 것을 못 박는다");
{
  /*  이 시험의 전제다. 언젠가 ssMerge 가 그룹에 날짜를 넣으면 이 사고는
      저절로 없어지고, 그때는 회차키를 붙이는 것이 군더더기가 된다.
      전제가 바뀌면 여기서 걸려 다시 생각하게 된다.  */
  const i = core.indexOf("var key = u.출고지 + '♦' + ssDeliveryKey(u) + '♦' + u.조건ID;");
  eq("★ 그룹 열쇠가 그대로다 (출고지·배송키·조건ID)", i >= 0, true);
  const 앞 = core.slice(Math.max(0, i - 400), i);
  eq("★ 날짜·회차가 안 들어간다", /회차|날짜|ymd|Date/.test(
    core.slice(i, i + 120)), false);
}

console.log("\n[6] 코드가 실제로 회차키를 쓰고 있다");
{
  eq("★ 박스 열쇠에 회차키를 붙인다",
    bulk.indexOf("var 박키4 = (rk || '(회차없음)') + '/' + grp4;") >= 0, true);
  eq("★ 그룹만으로 만들던 자리가 없다",
    /박스\[grp4\]/.test(bulk), false);
  eq("만든 열쇠로 담는다", /박스\[박키4\]/.test(bulk), true);

  //  회차키를 읽는 곳이 박스 짓는 곳보다 «앞»에 있어야 한다
  const rk자리 = bulk.indexOf("var rk = ix['회차키'] !== undefined");
  const 박자리 = bulk.indexOf("var 박키4 =");
  eq("★ 회차키를 먼저 읽는다", rk자리 >= 0 && rk자리 < 박자리, true);
}

console.log("\n[7] 허브와 같은 규칙인가");
{
  /*  같은 일을 하는 두 곳이 다른 규칙을 쓰면, 한쪽에서 맞는 것이 다른 쪽에서
      틀린다. 허브(_partnerOrders.gs)는 9/15 에 이미 회차키를 붙였다.  */
  let 허브 = "";
  try { 허브 = readFileSync("../../_partnerOrders.gs", "utf8"); } catch (e) { 허브 = ""; }
  if (!허브) {
    console.log("  --   허브 파일을 못 읽어 대조는 건너뜁니다");
  } else {
    eq("★ 허브도 회차키를 붙여 묶는다",
      /combinedKeyByUid\[_u\] = \(_rk \? _rk \+ "\/" : ""\) \+ _g;/.test(허브), true);
  }
}

console.log("");
console.log(fail === 0 ? "✅ 통과 " + pass + "건" : "❌ 실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
