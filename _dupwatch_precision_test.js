/**
 * 허브 중복의심 — 헛것을 안 내는가
 *
 *   > "허브에서 중복의심을 걸러내고 있나? 중복의심이 너무 많은데
 *   >  허브의 중복의심은 좀더 디테일하게 확실하게 잡아내게 수정해줘"
 *
 * 「너무 많다」는 못 잡는 것보다 위험하다 — 목록이 길면 아무도 안 본다.
 * 그래서 여기서 박는 것은 두 가지다.
 *   ① 헛것이 «안 나오는가»  (동명이인 · 한 주문의 여러 품목 · 같은 아파트)
 *   ② 진짜가 «그대로 나오는가» (안 나오면 이 도구는 있으나 마나다)
 *
 * 실행: node _dupwatch_precision_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

const SRC = fs.readFileSync("_partnerDupWatch.gs", "utf8");
const has = (s) => SRC.indexOf(s) >= 0;

function fnFrom(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) throw new Error("못 찾음: " + name);
  let d = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error("안 닫힘: " + name);
}

/* ── 판정에 쓰이는 남의 함수는 진짜 것을 가져다 쓴다 ─────────
   내가 흉내 내면 «내 흉내»를 시험하게 된다. */
const PEP = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
const ctx = { console, String, Number, Object, parseInt, isFinite };
vm.createContext(ctx);
vm.runInContext("var _PEP_ADDR_KEY_LEN_ = 20; var _PEP_SIDO_ALIAS_ = [];", ctx);
["_pep_normRecipName_", "_pep_addrKey_", "_pep_phoneDigits_"].forEach((n) => {
  vm.runInContext(fnFrom(PEP, n), ctx);
});
["_dw_nameKey_", "_dw_conflict_", "_dw_splitByConflict_",
  "_dw_invoiceNote_", "_dw_levels_", "_dw_findSuspects_"].forEach((n) => {
  vm.runInContext(fnFrom(SRC, n), ctx);
});

let seq = 0;
function rec(o) {
  seq++;
  return {
    uid: o.uid === undefined ? "ID" + seq : o.uid,
    code: o.code === undefined ? "AAA1" : o.code,
    item: o.item || "샘플",
    name: o.name || "",
    phone: o.phone === undefined ? "" : o.phone,
    addr: o.addr === undefined ? "" : o.addr,
    inv: o.inv || "",
    batch: o.batch === undefined ? 1 : o.batch,
    batchLabel: o.batchLabel || (o.batch === 2 ? "오후" : "오전"),
    hubRow: o.hubRow || seq + 1,
    vendor: o.vendor || "업체A",
    qty: o.qty || "1",
    orderDate: o.orderDate || "20260918",
    status: o.status || "",
    at: "2026-09-18 09:00:00",
  };
}
const 찾기 = (recs) => ctx._dw_findSuspects_(recs);

/* ── [1] 어긋나면 다른 사람이다 ─────────────────────────── */
console.log("\n[1] _dw_conflict_ — 둘 다 있는데 다르면 다른 사람");
{
  const C = ctx._dw_conflict_;
  eq("전화가 서로 다르면 어긋남",
    C({ phone: "010-1111-2222", addr: "" }, { phone: "010-3333-4444", addr: "" }),
    "전화가 다름");
  //  ★ 한쪽이 «비어 있는» 것은 어긋난 게 아니다 — 모르는 것뿐이다 ★
  eq("★ 한쪽 전화가 없으면 어긋난 게 아니다",
    C({ phone: "010-1111-2222", addr: "" }, { phone: "", addr: "" }), "");
  eq("주소가 서로 다르면 어긋남",
    C({ phone: "", addr: "서울 강남구 1" }, { phone: "", addr: "부산 해운대구 9" }),
    "주소가 다름");
  eq("★ 한쪽 주소가 없으면 어긋난 게 아니다",
    C({ phone: "", addr: "서울 강남구 1" }, { phone: "", addr: "" }), "");
  //  마스킹 전화(010-1234-****)는 10자리가 안 되므로 «모른다»로 다룬다
  eq("★ 마스킹 전화는 어긋남으로 세지 않는다",
    C({ phone: "010-1111-****", addr: "" }, { phone: "010-3333-4444", addr: "" }), "");
  eq("전화가 같으면 어긋난 데 없음",
    C({ phone: "010-1111-2222", addr: "" }, { phone: "01011112222", addr: "" }), "");
}

/* ── [2] 동명이인 — 여태 매번 걸리던 것 ─────────────────── */
console.log("\n[2] 동명이인은 이제 안 걸린다");
{
  //  같은 이름 + 같은 품목 + 전화가 «둘 다 있고 다름» = 다른 사람 둘
  const g = 찾기([
    rec({ name: "김민수", code: "AAA1", phone: "010-1111-2222", batch: 1 }),
    rec({ name: "김민수", code: "AAA1", phone: "010-9999-8888", batch: 2 }),
  ]);
  eq("★ 전화가 다른 동명이인은 의심이 아니다", g.length, 0);

  //  전화가 한쪽만 있으면 «모르는» 것이라 여전히 🟡 의심으로 낸다
  const g2 = 찾기([
    rec({ name: "김민수", code: "AAA1", phone: "010-1111-2222", batch: 1 }),
    rec({ name: "김민수", code: "AAA1", phone: "", batch: 2 }),
  ]);
  eq("한쪽 전화가 없으면 여전히 의심으로 낸다", g2.length, 1);
  eq("  등급은 🟡", g2[0].grade, "🟡 의심");

  //  셋 중 둘만 같은 사람이면 «그 둘만» 묶는다
  const g3 = 찾기([
    rec({ name: "이정훈", code: "AAA1", phone: "010-1111-2222", batch: 1 }),
    rec({ name: "이정훈", code: "AAA1", phone: "", batch: 2 }),
    rec({ name: "이정훈", code: "AAA1", phone: "010-7777-6666", batch: 2 }),
  ]);
  eq("★ 셋 중 같은 사람일 수 있는 둘만 묶는다", g3.length, 1);
  eq("  그 그룹은 두 줄", g3[0].members.length, 2);
}

/* ── [3] 한 주문의 여러 품목 — 여태 🔴 확실로 나오던 것 ─── */
console.log("\n[3] 한 주문에 품목이 여럿");
{
  const g = 찾기([
    rec({ uid: "0918-ds-a1", code: "AAA1", name: "박수현", phone: "010-1111-2222", batch: 1 }),
    rec({ uid: "0918-ds-a1", code: "BBB2", name: "박수현", phone: "010-1111-2222", batch: 1 }),
    rec({ uid: "0918-ds-a1", code: "CCC3", name: "박수현", phone: "010-1111-2222", batch: 1 }),
  ]);
  eq("★ 고유ID가 같아도 품목이 다르면 중복이 아니다", g.length, 0);

  //  ★ 같은 고유ID·같은 품목이 둘이면 그건 진짜다 ★
  const g2 = 찾기([
    rec({ uid: "0918-ds-a1", code: "AAA1", name: "박수현", phone: "010-1111-2222", batch: 1 }),
    rec({ uid: "0918-ds-a1", code: "AAA1", name: "박수현", phone: "010-1111-2222", batch: 2 }),
  ]);
  eq("고유ID도 품목도 같으면 잡는다", g2.length, 1);
  eq("  등급 🔴", g2[0].grade, "🔴 확실");
  eq("  사유", g2[0].reason, "같은 고유ID·같은 품목이 두 번");
}

/* ── [4] 같은 아파트·같은 회사 ──────────────────────────── */
console.log("\n[4] 주소만 같은 남남");
{
  const 주소 = "서울 강남구 테헤란로 152 8층";
  const g = 찾기([
    rec({ name: "김철수", code: "AAA1", phone: "010-1111-2222", addr: 주소, batch: 1 }),
    rec({ name: "이영희", code: "AAA1", phone: "010-3333-4444", addr: 주소, batch: 2 }),
  ]);
  eq("★ 주소·품목만 같고 사람이 다르면 안 낸다", g.length, 0);

  //  ★ 전화·주소·품목이 같은데 «이름만» 다르면 그건 같은 사람이다 ★
  const g2 = 찾기([
    rec({ name: "김철수", code: "AAA1", phone: "010-1111-2222", addr: 주소, batch: 1 }),
    rec({ name: "김 철수", code: "AAA1", phone: "010-1111-2222", addr: 주소, batch: 2 }),
    rec({ name: "철수아빠", code: "AAA1", phone: "010-1111-2222", addr: 주소, batch: 2 }),
  ]);
  ok("전화+주소+품목이 같으면 이름이 달라도 잡는다", g2.length >= 1);
}

/* ── [5] 회차 ───────────────────────────────────────────── */
console.log("\n[5] 오전↔오후를 넘었는가");
{
  const 짝 = (b1, b2) => 찾기([
    rec({ name: "정다은", code: "AAA1", phone: "010-1111-2222", batch: b1 }),
    rec({ name: "정다은", code: "AAA1", phone: "010-1111-2222", batch: b2 }),
  ]);
  const cross = 짝(1, 2);
  eq("회차를 넘으면 🔴", cross[0].grade, "🔴 확실");
  eq("  회차 간 표시", cross[0].spansBatch, true);

  //  ★ 사장님 지시 — 같은 회차 안의 것은 ⚪ 참고로 내린다 ★
  const same = 짝(1, 1);
  eq("★ 같은 회차 안은 ⚪ 참고로 내린다", same[0].grade, "⚪ 참고");
  eq("  그래도 목록에서 사라지진 않는다", same.length, 1);
}

/* ── [6] 송장 — 막을 수 있나, 이미 벌어졌나 ─────────────── */
console.log("\n[6] 지금 어떤 상태인가");
{
  const 짝 = (i1, i2, b2) => 찾기([
    rec({ name: "한지우", code: "AAA1", phone: "010-1111-2222", batch: 1, inv: i1 }),
    rec({ name: "한지우", code: "AAA1", phone: "010-1111-2222", batch: b2 || 2, inv: i2 }),
  ]);
  ok("둘 다 송장 없음 → 지금 막으면 된다고 말한다",
    짝("", "")[0].invNote.indexOf("지금 막으면") >= 0);
  ok("한쪽만 송장 → 나머지는 막을 수 있다고 말한다",
    짝("123456789", "")[0].invNote.indexOf("아직 막을 수 있음") >= 0);
  const 둘 = 짝("123456789", "987654321");
  ok("★ 송장이 둘 → 이미 두 번 나갔다고 말한다",
    둘[0].invNote.indexOf("이미 두 번 나갔습니다") >= 0);
  eq("  shipped 는 2", 둘[0].shipped, 2);
  //  같은 송장이면 한 박스로 나간 것이다 — 사고가 아니다
  ok("같은 송장이면 한 박스라고 말한다",
    짝("123456789", "123-456-789")[0].invNote.indexOf("한 박스") >= 0);

  /* ★ 같은 회차라도 «이미 두 번 나간» 것은 안 내린다 ★
     등급을 내리는 규칙보다 이 사실이 먼저다. */
  const 같은회차_둘나감 = 짝("123456789", "987654321", 1);
  eq("★ 같은 회차라도 송장이 둘이면 🔴 그대로", 같은회차_둘나감[0].grade, "🔴 확실");
}

/* ── [7] 차례 — 손대야 할 것이 위로 오는가 ──────────────── */
console.log("\n[7] 차례");
{
  const g = 찾기([
    //  같은 회차 · 안 나감  (⚪)
    rec({ name: "가나", code: "AAA1", phone: "010-1000-0001", batch: 1 }),
    rec({ name: "가나", code: "AAA1", phone: "010-1000-0001", batch: 1 }),
    //  회차 간 · 안 나감  (🔴)
    rec({ name: "다라", code: "BBB2", phone: "010-2000-0002", batch: 1 }),
    rec({ name: "다라", code: "BBB2", phone: "010-2000-0002", batch: 2 }),
    //  이미 두 번 나감  (최우선)
    rec({ name: "마바", code: "CCC3", phone: "010-3000-0003", batch: 1, inv: "111" }),
    rec({ name: "마바", code: "CCC3", phone: "010-3000-0003", batch: 2, inv: "222" }),
  ]);
  eq("세 그룹이 나온다", g.length, 3);
  eq("★ 이미 나간 것이 맨 위", g[0].shipped, 2);
  eq("  그 다음이 회차 간", g[1].spansBatch, true);
  eq("  마지막이 같은 회차", g[2].grade, "⚪ 참고");
}

/* ── [8] 배선 — 화면까지 닿는가 ─────────────────────────── */
console.log("\n[8] 배선");
{
  ok("★ 확인 끝난 그룹은 맨 아래로 내린다", has("groups = 남은것.concat(확인한것);"));
  ok("  그룹의 줄이 «전부» 찍혀야 확인으로 본다", has("if (checked[_dw_recKey_(records[gg.members[cm]])] !== true) { 다찍힘 = false; break; }"));
  ok("  회색으로 눕힌다", has('rng.setBackground("#f8f9fa").setFontColor("#9aa0a6");'));
  ok("  사유에도 [확인함]이 적힌다", has('(g.confirmed ? " · [확인함]" : "")'));
  ok("★ 사유에 송장 상태가 실린다", has('(g.invNote ? " · " + g.invNote : "")'));
  ok("★ Push 카드가 «이미 나간 것»을 먼저 말한다", has('label: "🚨 이미 두 번 나감",'));
  ok("★ 어느 그물이 얼마나 내는지 적는다", has('lines.push("무엇으로 잡혔나:");'));
  ok("  동명이인으로 갈라 낸 수도 적는다", has("res.splitApart +"));
  //  ★ 헛것을 낸 옛 규칙이 되살아나지 않게 못을 박는다 ★
  ok("★ 「고유ID만」으로 묶던 옛 규칙이 없다", !has('return r.uid ? "U|" + r.uid : "";'));
  ok("★ 「전화 다름」을 대놓고 허용하던 옛 사유가 없다",
    !has('reason: "수취인+품목코드 일치 (전화 다름/없음)"'));
  ok("★ 「주소+품목, 수취인 다름」 옛 규칙이 없다",
    !has('reason: "주소+품목코드 일치 (수취인 다름)"'));
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
