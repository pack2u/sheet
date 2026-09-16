/**
 * 송장 소유권 점검 — 정상을 정상이라고 하는가
 *
 *  2026-09-16 실제 점검: 🔴 확실 101 · 🟡 의심 2253.
 *  송장 18105 개 중 13% 가 충돌로 잡혔다. 그만큼이 진짜일 리 없다.
 *
 *  까닭: 「같은 수취인 · 같은 날 · 같은 송장」을 의심으로 세고 있었다.
 *  그런데 그 모양이 바로 «합배송»이다 — 한 사람의 주문 여럿이 한 상자로
 *  나가면 송장이 같은 것이 맞다.
 *
 *  ★ 울부짖는 그물은 없는 것만 못하다 ★
 *    2253 건을 들이밀면 사람은 그 목록을 안 본다. 그러면 그 속에 섞인
 *    진짜 몇 건도 같이 묻힌다. 정상인 것은 정상이라고 해야 한다.
 *
 *  지켜야 할 것
 *    · 수취인이 다르면 🔴 — 상자가 남에게 간다
 *    · 같은 사람이라도 주문일이 2일 넘게 벌어지면 🔴 — 과거 송장을 가져다 붙인 것
 *    · 같은 사람 · 날짜가 안 벌어짐 → 🟢 합배송 (정상)
 *    · 이름이 빈 기록은 사람 수 세기에서 «뺀다» — 안 그러면 정상 건이 🔴 로 올라간다
 *
 * 실행: node _iodjudge_test.js
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

const src = fs.readFileSync("_partnerInvoiceOwnerDiag.gs", "utf8");
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

const ctx = {
  _iod_orderIdentity_: (c) => String(c.oid || (c.name + "|" + c.item)),
  _iod_dayDiff_: (a, b) => Math.round(Math.abs(b.getTime() - a.getTime()) / 86400000),
  _IOD_STALE_GAP_DAYS_: 2,
};
vm.createContext(ctx);
vm.runInContext(grab("_iod_judge_"), ctx);
const 판정 = (claims) => vm.runInContext("_iod_judge_(" + JSON.stringify(claims) + ")", ctx,
  { /* Date 는 JSON 으로 못 넘긴다 — 아래 주장() 에서 문자열로 만들고 되살린다 */ });

/*  Date 를 살려 넘기려면 컨텍스트 안에서 만들어야 한다  */
function 판정하기(claims) {
  ctx.__c = claims.map((c) => ({
    oid: c.oid || "", name: c.name || "", nameKey: c.nameKey === undefined ? (c.name || "") : c.nameKey,
    item: c.item || "", date: c.날 ? new Date(c.날) : null, where: c.where || "원장",
    mark: c.표시 || "",
  }));
  return vm.runInContext("_iod_judge_(__c)", ctx);
}

console.log("\n[1] ★ 같은 사람 · 같은 날인데 «표시가 없으면» 의심이다");
{
  /*  > "합배송만의 문제가 아니고 개별 주문건에도 문제라"
      개별 주문 둘에 같은 송장이 붙어도 이 모양이다. 정상이라 하면 사고를 덮는다. */
  const v = 판정하기([
    { oid: "SB-1001", name: "김철수", 날: "2026-09-15" },
    { oid: "SB-1002", name: "김철수", 날: "2026-09-15" },
  ]);
  check("★ 등급", v && v.grade, "🟡 의심");
  check("★ 표시가 없다고 말한다", v.reason.indexOf("표시가 «없습니다»") >= 0, true);
  check("무엇을 뜻하는지 말한다", v.reason.indexOf("한쪽은 남의 송장") >= 0, true);
}

console.log("\n[1-b] ★ 합배송이라고 «적혀 있으면» 정상이다");
{
  const v = 판정하기([
    { oid: "SB-1001", name: "김철수", 날: "2026-09-15", 표시: "합배송 · 몸통" },
    { oid: "SB-1002", name: "김철수", 날: "2026-09-15" },
  ]);
  check("★ 등급", v.grade, "🟢 합배송");
  check("★ «적혀» 있다고 말한다", v.reason.indexOf("«적혀» 있습니다") >= 0, true);
}

console.log("\n[1-c] 「합포장」이라고 적혀 있어도 정상");
{
  const v = 판정하기([
    { oid: "A", name: "김철수", 날: "2026-09-15", 표시: "합포장" },
    { oid: "B", name: "김철수", 날: "2026-09-15" },
  ]);
  check("등급", v.grade, "🟢 합배송");
}

console.log("\n[2] 같은 사람 · 하루 차 — 「확실」로는 안 올린다");
{
  /*  마감이 날짜를 하루 늦게 적는 일이 있다. 그것까지 의심하면 또 수천 건이 된다.
      경계는 _IOD_STALE_GAP_DAYS_(2일)이다.  */
  const v = 판정하기([
    { oid: "SB-1001", name: "김철수", 날: "2026-09-15" },
    { oid: "SB-1002", name: "김철수", 날: "2026-09-16" },
  ]);
  /*  날짜가 하루 어긋나는 것은 마감이 늦게 적어서일 수 있다.
      그것까지 «확실»이라 하면 또 수천 건이 된다. 경계는 2일이다. */
  check("★ 확실은 아니다", v.grade !== "🔴 확실", true);
  check("며칠 차인지 적는다", v.reason.indexOf("1일 차") >= 0, true);
}

console.log("\n[3] ★ 수취인이 다르면 🔴 — 상자가 남에게 간다");
{
  const v = 판정하기([
    { oid: "SB-1001", name: "김철수", 날: "2026-09-15" },
    { oid: "SB-2002", name: "박영희", 날: "2026-09-15" },
  ]);
  check("★ 등급", v.grade, "🔴 확실");
  check("누구인지 적는다",
    v.reason.indexOf("김철수") >= 0 && v.reason.indexOf("박영희") >= 0, true);
}

console.log("\n[4] ★ 같은 사람이라도 날짜가 벌어지면 🔴");
{
  /*  과거 주문 송장을 가져다 붙인 것이다. 상자는 안 오는데 송장은 있다. */
  const v = 판정하기([
    { oid: "SB-1001", name: "김철수", 날: "2026-09-10" },
    { oid: "SB-2002", name: "김철수", 날: "2026-09-15" },
  ]);
  check("★ 등급", v.grade, "🔴 확실");
  check("며칠 차인지", v.reason.indexOf("5일 차") >= 0, true);
  check("까닭을 적는다", v.reason.indexOf("과거 주문 송장을 가져다 붙인") >= 0, true);
}

console.log("\n[5] 같은 주문이 여러 곳에 적힌 것은 충돌이 아니다");
{
  /*  원장에도 마감에도 같은 줄이 있다. 주문이 하나면 볼 것이 없다. */
  const v = 판정하기([
    { oid: "SB-1001", name: "김철수", 날: "2026-09-15", where: "송장원장" },
    { oid: "SB-1001", name: "김철수", 날: "2026-09-15", where: "일일마감" },
  ]);
  check("★ 판정 자체를 안 한다", v, null);
}

console.log("\n[6] ★ 이름 없는 기록이 사람을 «둘»로 만들지 않는다");
{
  /*  수취인명을 안 남기는 원천이 섞이면 「이름없음」이 별개 사람으로 잡혀
      정상 합배송이 🔴 로 올라간다.  */
  const v = 판정하기([
    { oid: "SB-1001", name: "김철수", nameKey: "김철수", 날: "2026-09-15" },
    { oid: "SB-1002", name: "", nameKey: "", 날: "2026-09-15" },
  ]);
  check("★ 확실로 안 올린다", v.grade !== "🔴 확실", true);
  check("이름 없는 기록이 있었다고 적는다",
    v.reason.indexOf("수취인명 없는 기록") >= 0, true);
}

console.log("\n[7] ★ 합배송은 목록에 안 쌓는다 — 숫자만 보여 준다");
{
  /*  목록에 넣으면 2천 줄이 쌓여 그 속의 진짜 몇 건이 묻힌다.
      그렇다고 숨기지도 않는다 — 「안 보고 있다」가 아니라
      「보고 정상이라 했다」임을 숫자로 말한다.  */
  check("★ 세고 넘어간다",
    src.indexOf('if (verdict.grade === "🟢 합배송") { counts.merged++; continue; }') >= 0, true);
  check("셈 자리가 있다", src.indexOf("merged: 0") >= 0, true);
  check("★ 화면에 숫자를 보여 준다", src.indexOf("🟢 합배송(정상): ") >= 0, true);
  check("무슨 뜻인지 적는다", src.indexOf("같은 사람이 한 상자로 받은 것") >= 0, true);
  check("깨끗하면 깨끗하다고 말한다",
    src.indexOf("남의 송장이 붙은 것으로 보이는 건은 없습니다") >= 0, true);
  check("밤/수집 뒤 알림도 셈을 받는다", src.indexOf("merged: counts.merged") >= 0, true);
}

console.log("\n[8] 경계값을 코드에서 읽어 맞춘다");
{
  /*  2일을 여기 베껴 적으면 상수를 바꿀 때 시험만 옛말을 한다. */
  const m = src.match(/var _IOD_STALE_GAP_DAYS_ = (\d+);/);
  check("경계값을 찾았다", !!m, true);
  const 경계 = Number(m[1]);
  ctx._IOD_STALE_GAP_DAYS_ = 경계;

  const 안쪽 = 판정하기([
    { oid: "A", name: "김철수", 날: "2026-09-15" },
    { oid: "B", name: "김철수", 날: "2026-09-" + (15 + 경계 - 1) },
  ]);
  check("★ 경계 «미만»은 확실이 아니다", 안쪽.grade !== "🔴 확실", true);

  const 바깥 = 판정하기([
    { oid: "A", name: "김철수", 날: "2026-09-15" },
    { oid: "B", name: "김철수", 날: "2026-09-" + (15 + 경계) },
  ]);
  check("★ 경계 «이상»은 확실", 바깥.grade, "🔴 확실");
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
