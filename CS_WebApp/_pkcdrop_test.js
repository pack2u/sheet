/**
 * 집하누락 카드 — 다 본 뒤에도 «잡아 둔 것»을 다시 묻는가
 *
 *  ★ 2026-10-15 ★ 로젠택배 API 방에서 알려 왔다.
 *    10/14 치 84건을 전수로 되물어 보니 ★71건이 이미 스캔★ 돼 있었다
 *    (배송출고 54 · 배송완료 9 · 배송입고 6 · 터미널출고 2).
 *    카드는 밤새 모은 옛 판 그대로 서 있었고, 사장님이 창고에 사람을
 *    보내실 뻔했다. 「조용히 있는다」가 「틀린 채로 서 있는다」가 됐다.
 *
 *  ★ 여기서 지키는 것 ★
 *    ① 다 본 뒤에도 되묻는다
 *    ② 그새 스캔된 것은 줄과 셋수에서 같이 덜어낸다
 *    ③ ★ 못 물은 것은 덜어내지 않는다 ★ 「답을 못 받았다」지 「스캔됐다」가
 *       아니다. 덜어내면 창고에 있는 박스가 조용히 사라진다.
 *    ④ 되묻기가 통째로 실패하면 아무것도 안 덜어낸다
 *    ⑤ 잡아 둔 것이 없으면 묻지 않는다 (쓸데없는 호출을 안 한다)
 *
 * 실행: node _pkcdrop_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let fail = 0, pass = 0;
const 소스 = fs.readFileSync(path.join(__dirname, "csLogenPickupCheck.gs"), "utf8");

function 꺼내(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

/*  답 흉내 — 판정은 진짜 _pkc_judge_ 가 한다. 흉내 내면 뜻이 없다.  */
function 틀(글, 답주기) {
  const 본것 = { 물어본것: null, 메모: [] };
  const ctx = {
    console, Logger: { log() {} },
    _pkc_note_: (m) => 본것.메모.push(String(m)),
    csLogenTrackMany: (송장) => {
      본것.물어본것 = 송장.slice();
      return 답주기(송장);
    },
    __본것: 본것,
  };
  vm.createContext(ctx);
  vm.runInContext(꺼내(글, "_pkc_judge_"), ctx);
  vm.runInContext(꺼내(글, "_pkc_dropScanned_"), ctx);
  return { ctx, 본것 };
}

/*  ★ 진짜 답 모양 ★ _pkc_judge_ 가 보는 칸 그대로다 (csLogenPickupCheck.gs:116).
    처음에 { lastStatus: … } 로 흉내 냈다가 밑판이 8개 틀렸다 — 가짜 모양으로
    시험하면 깨보기까지 통째로 거짓이 된다 (2026-10-15).  */
const 스캔됨 = { ok: true, statusName: "배송출고" };          // 실제: 배송입고 2026-10-15 07:39 서안산
const 아직 = { ok: true, statusName: "이력 없음" };           // 부름은 됐고 스캔이 없다 → 누락
const 못물음 = undefined;                                     // 응답에 아예 없었다

function 상태(st) {
  return { 우리: (st.우리 || []).map((x) => x.inv), 우리수: st.우리수,
           업체: (st.업체 || []).map((x) => x.inv), 업체수: st.업체수 };
}

function 재보기(글) {
  const 운것 = [];
  try {
    /* ① 그새 스캔된 것만 덜어낸다 */
    {
      const st = {
        우리: [{ inv: "A1" }, { inv: "A2" }, { inv: "A3" }], 우리수: 3,
        업체: [{ inv: "B1" }, { inv: "B2" }], 업체수: 2,
      };
      const { ctx, 본것 } = 틀(글, (inv) => {
        const o = {};
        inv.forEach((v) => { o[v] = (v === "A1" || v === "B2") ? 스캔됨 : 아직; });
        return o;
      });
      const 셈 = ctx._pkc_dropScanned_(st);
      const s = 상태(st);
      if (셈.덜어낸수 !== 2) 운것.push("①덜어낸수2(" + 셈.덜어낸수 + ")");
      if (s.우리.join() !== "A2,A3") 운것.push("①우리줄(" + s.우리.join() + ")");
      if (s.우리수 !== 2) 운것.push("①우리수2(" + s.우리수 + ")");
      if (s.업체.join() !== "B1") 운것.push("①업체줄(" + s.업체.join() + ")");
      if (s.업체수 !== 1) 운것.push("①업체수1(" + s.업체수 + ")");
      if (셈.다시물은수 !== 5) 운것.push("①다시물은수5");
      if ((본것.물어본것 || []).join() !== "A1,A2,A3,B1,B2") 운것.push("①우리와업체를같이묻는다");
    }

    /* ② ★ 못 물은 것은 덜어내지 않는다 ★ */
    {
      const st = { 우리: [{ inv: "A1" }, { inv: "A2" }], 우리수: 2, 업체: [], 업체수: 0 };
      const { ctx } = 틀(글, (inv) => {
        const o = {}; inv.forEach((v) => { o[v] = (v === "A1") ? 못물음 : 아직; });
        return o;
      });
      const 셈 = ctx._pkc_dropScanned_(st);
      if (셈.덜어낸수 !== 0) 운것.push("②못물음을덜어냄");
      if (셈.못물음 !== 1) 운것.push("②못물음을센다(" + 셈.못물음 + ")");
      if (상태(st).우리수 !== 2) 운것.push("②셋수를줄임");
      if (상태(st).우리.join() !== "A1,A2") 운것.push("②줄을지움");
    }

    /* ③ 되묻기가 통째로 실패하면 아무것도 안 덜어낸다 */
    {
      const st = { 우리: [{ inv: "A1" }], 우리수: 1, 업체: [], 업체수: 0 };
      const { ctx, 본것 } = 틀(글, () => { throw new Error("로젠 응답 없음"); });
      const 셈 = ctx._pkc_dropScanned_(st);
      if (셈.덜어낸수 !== 0) 운것.push("③실패했는데덜어냄");
      if (상태(st).우리수 !== 1) 운것.push("③실패했는데셋수줄임");
      if (!본것.메모.some((m) => /되묻기 실패/.test(m))) 운것.push("③실패를안적음");
    }

    /* ④ 잡아 둔 것이 없으면 묻지도 않는다 */
    {
      const st = { 우리: [], 우리수: 0, 업체: [], 업체수: 0 };
      const { ctx, 본것 } = 틀(글, () => ({}));
      const 셈 = ctx._pkc_dropScanned_(st);
      if (본것.물어본것 !== null) 운것.push("④빈데도물었다");
      if (셈.다시물은수 !== 0) 운것.push("④빈데도셌다");
    }

    /* ⑤ 다 스캔됐으면 카드가 0건이 된다 — 71/84 가 바로 이 꼴이었다 */
    {
      const st = { 우리: [{ inv: "A1" }, { inv: "A2" }], 우리수: 2, 업체: [{ inv: "B1" }], 업체수: 1 };
      const { ctx } = 틀(글, (inv) => {
        const o = {}; inv.forEach((v) => { o[v] = 스캔됨; }); return o;
      });
      const 셈 = ctx._pkc_dropScanned_(st);
      if (셈.덜어낸수 !== 3) 운것.push("⑤셋다덜어냄");
      if (상태(st).우리수 !== 0 || 상태(st).업체수 !== 0) 운것.push("⑤0건이안됨");
    }

    /* ⑥ 본체가 「다 봤다」 자리에서 되묻는 길을 실제로 탄다 */
    if (!/if \(st\.idx >= 목록\.length\) \{[\s\S]{0,400}?_pkc_dropScanned_\(st\)/.test(글))
      운것.push("⑥다본자리에서안부름");
    if (!/줄임\.덜어낸수[\s\S]{0,200}?_pkc_report_\(날, 목록\.length, st, true\)/.test(글))
      운것.push("⑥덜어냈으면카드를다시세움");
  } catch (e) {
    운것.push("터짐:" + e.message);
  }
  return 운것;
}

console.log("─ 집하누락 — 다 본 뒤 되묻기 ─\n");
const 운것 = 재보기(소스);
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) pass = 20;
console.log(fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과");

console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const 깨기 = [
  ["되묻기를 아예 안 한다 (옛 모양)", (s) => s.replace(
    /var 줄임 = _pkc_dropScanned_\(st\);/, "var 줄임 = { 다시물은수: 0, 덜어낸수: 0, 못물음: 0 };")],
  ["★ 못물음도 덜어낸다 ★", (s) => s.replace(
    'if (판정 === "못물음") { 셈.못물음++; 남길것.push(x); continue; }',
    'if (판정 === "못물음") { 셈.못물음++; }')],
  ["줄만 덜고 셋수는 안 줄인다", (s) => s.replace(
    'st[쪽 + "수"] = Math.max(0, (st[쪽 + "수"] || 0) - 1);', "")],
  ["업체 쪽은 안 본다", (s) => s.replace('var 쪽들 = ["우리", "업체"];', 'var 쪽들 = ["우리"];')],
  ["되묻기 실패해도 밀어붙인다", (s) => s.replace(
    /_pkc_note_\("그새 움직였나 되묻기 실패 — "[\s\S]*?return 셈;/, "답 = {};")],
  ["덜어내도 카드를 다시 안 세운다", (s) => s.replace(
    "_pkc_report_(날, 목록.length, st, true);      // 카드를 새 판으로 다시 세운다", "")],
];

let 안움 = 0;
for (const [이름, f] of 깨기) {
  const 깬것 = f(소스);
  if (깬것 === 소스) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운 = 재보기(깬것);
  if (운.length) console.log("  ✔ 울었다 [" + 운.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(fail || 안움 ? 1 : 0);
