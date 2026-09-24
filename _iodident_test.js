/**
 * 송장 소유권 점검 — 세 원천이 «같은 주문»을 같은 이름으로 부르는가
 *
 *  2026-09-16 점검 결과: 🔴 101 · 🟡 2253 · 🟢 합배송(정상) 0.
 *  🟢 이 «0» 이라는 것이 실마리였다. 합배송이 하루에 한 건도 없을 리 없다.
 *
 *  까닭: 같은 주문 하나가 원천마다 다른 이름으로 불렸다.
 *    송장원장  D열 → `0916-ds-ab12#2`   (꼬리가 붙는다)
 *    일일마감  M열 → `김철수/0916-ds-ab12`  (머리가 붙는다)
 *    허브      C열 → `0916-ds-ab12`     (맨몸)
 *  셋이 갈라지니 «한 주문에 한 송장» 인 정상 건이 «두 주문이 한 송장을
 *  다툰다» 로 둔갑했다. 그물이 2253 마리를 잡았고, 사람은 그 목록을 안 봤다.
 *
 *  ★ 지켜야 할 것 ★
 *    · 머리(이름/)와 꼬리(#n · |코드 · _S숫자)를 떼고 나면 셋이 «같아야» 한다
 *    · 이름만 적힌 칸은 고유ID 가 아니다 — 조합키로 보낸다.
 *      안 그러면 같은 사람의 «다른» 주문 둘이 한 주문으로 뭉쳐 충돌을 숨긴다
 *    · 정규화는 _iod_claim_ «한 곳»에서 한다. 원천마다 따로 하면 또 갈라진다
 *
 * 실행: node _iodident_test.js
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

function grabFrom(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

const iod = fs.readFileSync("_partnerInvoiceOwnerDiag.gs", "utf8");
const pep = fs.readFileSync("_partnerExclusivePush.gs", "utf8");

const ctx = {
  /*  주장 등록에 딸려 오는 것들 — 여기서 보는 것은 «고유ID» 하나다  */
  _pep_normInvoiceNo_: (s) => String(s || "").replace(/[^0-9]/g, ""),
  _pep_normRecipName_: (s) => String(s || "").replace(/[ \t]/g, ""),
  _pep_itemKey_: (s) => String(s || "").replace(/[ \t]/g, ""),
  _iod_toDate_: (s) => (s ? new Date(s) : null),
};
vm.createContext(ctx);
["_pep_normalizeMatchUid_", "_pep_uidFromOrdererCell_", "_pep_isRealUid_"]
  .forEach((n) => vm.runInContext(grabFrom(pep, n), ctx));
["_iod_oidKey_", "_iod_orderIdentity_", "_iod_claim_"]
  .forEach((n) => vm.runInContext(grabFrom(iod, n), ctx));

const 열쇠 = (raw) => vm.runInContext("_iod_oidKey_(" + JSON.stringify(raw) + ")", ctx);
function 정체(c) {
  ctx.__reg = {};
  ctx.__c = Object.assign({ name: "", item: "", dateStr: "" }, c);
  vm.runInContext("_iod_claim_(__reg, '1234567890', __c)", ctx);
  return vm.runInContext("_iod_orderIdentity_(__reg['1234567890'][0])", ctx);
}

console.log("\n[1] ★ 세 원천이 한 주문을 같은 이름으로 부른다");
{
  const 원장 = 정체({ oid: "0916-ds-ab12#2", name: "김철수", item: "미니탕", dateStr: "2026-09-15" });
  const 마감 = 정체({ oid: "김철수/0916-ds-ab12", name: "김철수", item: "미니탕", dateStr: "2026-09-15" });
  const 허브 = 정체({ oid: "0916-ds-ab12", name: "김철수", item: "미니탕", dateStr: "2026-09-15" });
  check("★ 송장원장 = 일일마감", 원장 === 마감, true);
  check("★ 일일마감 = 허브", 마감 === 허브, true);
  check("고유ID 로 간다", 허브, "U|0916-ds-ab12");
}

console.log("\n[2] 머리와 꼬리를 뗀다");
check("이름/ 머리", 열쇠("김철수/SB2026091500123"), "SB2026091500123");
check("#n 꼬리", 열쇠("SB2026091500123#2"), "SB2026091500123");
check("|코드 꼬리", 열쇠("SB2026091500123|A01"), "SB2026091500123");
check("_S숫자 세트꼬리", 열쇠("SB2026091500123_S2"), "SB2026091500123");
check("머리와 꼬리가 같이", 열쇠("김철수/SB2026091500123#3"), "SB2026091500123");
check("앞뒤 공백", 열쇠("  0916-ph-9f3a  "), "0916-ph-9f3a");
check("빈 칸", 열쇠(""), "");
check("null", 열쇠(null), "");

console.log("\n[3] ★ 이름만 적힌 칸은 고유ID 가 «아니다»");
{
  /*  전화주문은 마감 표에 이름만 남는 줄이 있다. 그것을 고유ID 로 삼으면
      같은 사람의 «다른» 주문 둘이 한 주문으로 뭉쳐, 남의 송장이 붙은 것을
      «한 주문이니 당연하다» 며 넘긴다. 그 줄은 조합키로 보낸다.  */
  check("★ 한글 이름", 열쇠("김철수"), "");
  check("★ 이름/이름", 열쇠("김철수/김철수"), "");
  check("TEL: 접두", 열쇠("TEL:01012345678"), "");
  check("FB: 접두", 열쇠("FB:1234"), "");
  check("휴대폰 번호만", 열쇠("01012345678"), "");
  check("두 글자 이하", 열쇠("AB"), "");
  check("우리가 발급한 전화주문 ID 는 진짜다", 열쇠("0916-ph-9f3a"), "0916-ph-9f3a");
}

console.log("\n[4] ★ 이름만 남은 줄은 사람+품목+날짜로 갈린다");
{
  const 첫 = 정체({ oid: "김철수", name: "김철수", item: "미니탕", dateStr: "2026-09-15" });
  const 둘 = 정체({ oid: "김철수", name: "김철수", item: "곰탕", dateStr: "2026-09-15" });
  check("조합키로 간다", 첫.indexOf("F|") === 0, true);
  check("★ 품목이 다르면 «다른 주문»", 첫 !== 둘, true);
}

console.log("\n[5] ★ 그물을 꺼 보면 빨개진다 (헛그물 아님)");
{
  /*  주석 처리한 줄은 «부르는 것»이 아니다 — 지우고 본다.
      2026-09-16 에 이 검사를 꺼 보니 주석만 남았는데도 통과했다.  */
  const 몸 = grabFrom(iod, "_iod_claim_").split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check("★ _iod_claim_ 이 정규화를 «부른다»", 몸.indexOf("c.oid = _iod_oidKey_(c.oid);") >= 0, true);
  const i오 = 몸.indexOf("c.oid = _iod_oidKey_");
  const i푸 = 몸.indexOf("reg[inv].push");
  check("★ 담기 «전»에 부른다", i오 >= 0 && i오 < i푸, true);
}

console.log("\n[6] ★ 마감 표는 「주문자명(사방넷)」 칸에서 ID 를 꺼낸다");
{
  /*  마감 표에는 「사방넷주문번호」 칸이 없다. _pep_mapArchiveMatchCols_ 는
      그 칸을 orderer 로 잡는다. 여기서 안 읽으면 마감 쪽 oid 가 늘 빈다 —
      그것이 2253 건의 정체였다.  */
  const 몸 = grabFrom(iod, "_iod_collectArchives_");
  check("★ orderer 칸을 본다", 몸.indexOf("cols.orderer >= 0") >= 0, true);
  check("oid 칸이 있으면 그것이 먼저", 몸.indexOf("cols.oid >= 0") >= 0, true);
}

console.log("\n[7] 원천마다 따로 정규화하지 «않는다»");
{
  /*  한 군데서만 한다. 원천마다 따로 걸면 새 원천이 붙을 때 또 갈라진다.  */
  ["_iod_collectLedger_", "_iod_collectHub_"].forEach((n) => {
    const 몸 = grabFrom(iod, n);
    check(n + " 는 날것을 넘긴다", 몸.indexOf("_iod_oidKey_") < 0, true);
  });
}
console.log("\n[8] ★ 합배송 표시를 읽는 칸 — 한 글자 붙어도 놓치지 않는다");
{
  /*  마감 표는 회차마다 칸 이름이 조금씩 다르다. 완전일치만 보던 때는
      「주문상태」·「비고1」·「배송메세지」를 통째로 놓쳤다.  */
  const 상수 = iod.slice(iod.indexOf("var _IOD_MARK_HEADERS_"),
    iod.indexOf(";", iod.indexOf("var _IOD_MARK_HEADERS_")) + 1);
  vm.runInContext(상수, ctx);
  ["_iod_hasMergeMark_", "_iod_markOf_"].forEach((n) => vm.runInContext(grabFrom(iod, n), ctx));

  const 읽나 = (h) => vm.runInContext("_IOD_MARK_HEADERS_.test(" + JSON.stringify(h) + ")", ctx);
  ["적요", "비고", "메모", "상태", "주문상태", "비고1", "특기사항"]
    .forEach((h) => check("읽는다: " + h, 읽나(h), true));
  /*  ★ 배송메시지는 «고객의 말»이다 ★  (2026-09-16)
      고객이 「합배송 해주세요」라고 적어 둔 것을 「합배송 되었다」로 읽으면
      요청이 사실로 둔갑한다. 우리가 적는 칸에서만 읽는다.  */
  ["수취인", "품목명", "송장번호", "수량", "배송메시지", "배송메세지", "배송지(사방넷)/배송메시지"]
    .forEach((h) => check("★ 안 읽는다: " + h, 읽나(h), false));
}

console.log("\n[9] 합배송·합포장만 표시로 친다");
{
  const 표시 = (m) => vm.runInContext("_iod_hasMergeMark_(" + JSON.stringify(m) + ")", ctx);
  check("합배송", 표시("합배송"), true);
  check("합포장", 표시("합포장 · 몸통"), true);
  check("띄어쓰기 섞임", 표시(" 합 배 송 "), true);
  check("빈 칸", 표시(""), false);
  check("상관없는 글", 표시("부재시 경비실"), false);
  check("undefined", 표시(undefined), false);
}

console.log("\n[10] ★ 어느 칸을 읽었는지 «남긴다»");
{
  ctx.__hdr = ["수취인", "품목명", "적요", "운송장번호"];
  ctx.__row = ["김철수", "미니탕", "합배송(대표)", "1234"];
  ctx.__seen = {};
  const m = vm.runInContext("_iod_markOf_(__hdr, __row, __seen)", ctx);
  check("적요를 읽었다", m.indexOf("합배송") >= 0, true);
  check("★ 읽은 칸 이름을 남긴다", Object.keys(ctx.__seen), ["적요"]);

  ctx.__hdr2 = ["수취인", "품목명", "운송장번호"];
  ctx.__seen2 = {};
  vm.runInContext("_iod_markOf_(__hdr2, __row, __seen2)", ctx);
  check("★ 못 찾으면 아무것도 안 남는다 (그래서 말할 수 있다)",
    Object.keys(ctx.__seen2).length, 0);
}

console.log("\n[11] ★ 송장원장에 «없는» 칸을 읽지 않는다");
{
  /*  _PIL_HEADERS_ 는 A~H 여덟 칸뿐인데 허브의 자리번호 12·14 를 읽고 있었다.
      주장 14134건의 표시가 «항상» 비었고, 그래서 🟢 이 0건이었다.  */
  const 몸 = grabFrom(iod, "_iod_collectLedger_");
  check("★ data[i][12] 를 안 읽는다", 몸.indexOf("data[i][12]") < 0, true);
  check("★ data[i][14] 를 안 읽는다", 몸.indexOf("data[i][14]") < 0, true);
  check("빈칸이라고 «적어» 둔다", 몸.indexOf('mark: ""') >= 0, true);
}

console.log("\n[12] ★ 허브는 적요·상태를 «가지고 있으니» 넘긴다");
{
  const 몸 = grabFrom(iod, "_iod_collectHub_").split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check("★ 표시를 만든다", 몸.indexOf("String(data[i][12]") >= 0, true);
  check("★ 주장에 담는다", /mark:\s*표시/.test(몸), true);
  check("15칸을 가져온다", 몸.indexOf(", 15)") >= 0, true);
}

console.log("\n[13] ★ 못 읽으면 «말한다»");
{
  /*  0건을 조용히 넘기면 정상 건이 통째로 의심이 되고, 사람은 목록을 안 본다.  */
  const 몸 = grabFrom(iod, "partnerDiagnoseInvoiceOwnership");
  check("셈 그릇이 있다", /markCols:\s*\{\},\s*marked:\s*0/.test(몸), true);
  check("★ 못 찾았다고 말한다", 몸.indexOf("«못 찾았습니다»") >= 0, true);
  check("★ 읽은 칸을 보여 준다", 몸.indexOf("읽은 칸: ") >= 0, true);
  check("★ 적힌 줄 수를 보여 준다", 몸.indexOf("합배송·합포장이 적힌 줄: ") >= 0, true);
}

console.log("\n[14] ★ 합포장과 합배송을 «링크»로 잇는다");
{
  /*  > "참 간단한 링크 개념인데 합포장 합배송을 결합을 못시키네.."
      세트분리는 「이 여섯 줄이 한 상자다」를 이미 알고 있다 —
      주문라인원장의 합포장그룹. 글자는 안 적히면 없지만,
      링크는 묶는 순간 거기 있다.  */
  vm.runInContext(grabFrom(iod, "_iod_packAsked_"), ctx);
vm.runInContext(grabFrom(iod, "_iod_samePackGroup_"), ctx);
  const 한상자 = (oids, pack) => {
    ctx.__cl = oids.map((o) => ({ oid: o }));
    ctx.__pk = pack;
    return vm.runInContext("_iod_samePackGroup_(__cl, __pk)", ctx);
  };
  const 원장 = { "A1": "260916-1/서울♦김철수♦C3", "A2": "260916-1/서울♦김철수♦C3" };

  check("★ 같은 합포장그룹 → 한 상자", 한상자(["A1", "A2"], 원장), "260916-1/서울♦김철수♦C3");
  check("★ 한 줄이라도 안 묶였으면 아니다", 한상자(["A1", "B9"], 원장), "");
  check("★ 그룹이 다르면 아니다",
    한상자(["A1", "C1"], { "A1": "260916-1/가", "C1": "260916-1/나" }), "");
  check("고유ID 가 없는 주장은 «모름»으로 넘긴다", 한상자(["A1", "", "A2"], 원장),
    "260916-1/서울♦김철수♦C3");
  check("★ 물어볼 수 있었던 것이 하나뿐이면 단정 안 한다", 한상자(["A1", ""], 원장), "");
  check("원장을 못 읽었으면 «모름»", 한상자(["A1", "A2"], null), "");
  check("빈 원장이면 «모름»", 한상자(["A1", "A2"], {}), "");
}

console.log("\n[15] ★ 회차키를 붙인다 — 다른 날이 한 상자로 보이면 안 된다");
{
  /*  합포장그룹은 출고지♦수취인♦조건ID 라 «날짜가 없다».
      여러 날치를 같이 읽는 점검에서 회차를 안 붙이면 어제 주문과
      오늘 주문이 한 상자가 된다. 오늘 사방넷 대량등록에서 고친 그 사고다.  */
  const 몸 = grabFrom(iod, "_iod_loadPackGroups_").split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check("★ 회차키를 읽는다", 몸.indexOf('ix["회차키"]') >= 0, true);
  check("★ 열쇠 앞에 붙인다", /rk \? rk \+ "\/" : ""/.test(몸), true);
  check("고유ID 를 같은 방식으로 다듬는다", 몸.indexOf("_iod_oidKey_(") >= 0, true);
  check("★ 칸이 없으면 «없다»고 말한다", 몸.indexOf("못 찾았습니다") >= 0, true);
}

console.log("\n[16] ★ 링크가 글자보다 «먼저»다");
{
  const 몸 = grabFrom(iod, "_iod_judge_");
  const i링 = 몸.indexOf("_iod_samePackGroup_");
  const i글 = 몸.indexOf("_iod_hasMergeMark_");
  check("★ 둘 다 본다", i링 >= 0 && i글 >= 0, true);
  check("★ 링크를 먼저 본다", i링 < i글, true);

  /*  실제로 그렇게 도는지 — 표시가 «없어도» 링크만으로 🟢 여야 한다  */
  const pack = { "SB-1001": "260916-1/박스가", "SB-1002": "260916-1/박스가" };
  ctx.__c2 = [
    { oid: "SB-1001", name: "김철수", nameKey: "김철수", item: "미니탕",
      date: new Date("2026-09-16"), mark: "", where: "원장" },
    { oid: "SB-1002", name: "김철수", nameKey: "김철수", item: "곰탕",
      date: new Date("2026-09-16"), mark: "", where: "원장" }
  ];
  ctx.__p2 = pack;
  vm.runInContext(grabFrom(iod, "_iod_dayDiff_"), ctx);
  ctx._IOD_STALE_GAP_DAYS_ = 2;
  vm.runInContext(grabFrom(iod, "_iod_judge_"), ctx);
  const v = vm.runInContext("_iod_judge_(__c2, __p2)", ctx);
  check("★ 표시가 없어도 링크만으로 🟢", v && v.grade, "🟢 합배송");
  check("★ 무엇으로 알았는지 말한다", v.reason.indexOf("세트분리가 한 상자로 묶은") >= 0, true);

  /*  링크가 없으면 종전대로 🟡 — 묶이지 않은 것을 정상이라 하지 않는다  */
  const v2 = vm.runInContext("_iod_judge_(__c2, {})", ctx);
  check("★ 링크가 없으면 의심 그대로", v2.grade, "🟡 의심");
}

console.log("\n[17] ★ 무엇으로 알았는지 보고에 적는다");
{
  const 몸 = grabFrom(iod, "partnerDiagnoseInvoiceOwnership");
  check("링크 건수를 보여 준다", 몸.indexOf("세트분리 합포장 링크: 주문 ") >= 0, true);
  check("★ 못 읽었으면 말한다", 몸.indexOf("글자»에만 기대고 있습니다") >= 0, true);
  check("실행마다 새로 읽는다", 몸.indexOf("_IOD_PACK_ = null;") >= 0, true);
  check("★ 판정에 넘긴다", 몸.indexOf("_iod_judge_(claims, pack)") >= 0, true);
}

console.log("\n[18] ★ 「모른다」와 「아니다」를 가른다");
{
  /*  ══════════════════════════════════════════════════════════
      2026-09-16 실제 결과 —
        🟡 의심 178건
           └ 원장이 «따로 나갔다»고 말하는 것: 0건
           └ 원장에 없어 물어볼 수 없던 것: 178건
      링크가 207건이나 잡혔는데 하나도 안 걸릴 수는 없다.

      까닭: _iod_loadPackGroups_ 가 `if (!grp) continue` 로 «묶인 줄만»
      담았다. 그래서 합포장이 «아닌» 주문은 전부 「원장에 없음」이 되고,
      원장이 분명히 아는 것까지 판단을 못 했다.

      담되 값으로 가른다:
        undefined   → 원장이 모르는 주문 (지난 회차)
        ""          → 원장이 알고, 합포장이 아니다 (따로 나갔다)
        "회차/그룹"  → 원장이 알고, 이 상자에 묶였다
      ══════════════════════════════════════════════════════════ */
  vm.runInContext(grabFrom(iod, "_iod_packAsked_"), ctx);
  const 물었나 = (oids, pack) => {
    ctx.__c3 = oids.map((o) => ({ oid: o }));
    ctx.__p3 = pack;
    return vm.runInContext("_iod_packAsked_(__c3, __p3)", ctx);
  };

  check("★ 원장이 둘 다 알면 물어본 것이다", 물었나(["A1", "A2"], { A1: "", A2: "" }), true);
  check("★ 묶인 것도 아는 것이다", 물었나(["A1", "A2"], { A1: "260916-1/가", A2: "" }), true);
  check("★ 하나라도 원장에 없으면 «모른다»", 물었나(["A1", "Z9"], { A1: "" }), false);
  check("원장을 못 읽었으면 «모른다»", 물었나(["A1", "A2"], null), false);
  check("고유ID 없는 주장은 세지 않는다", 물었나(["A1", ""], { A1: "" }), false);

  /*  ★ 그물을 꺼 보면 빨개진다 ★
      !pack[uid] 로 되돌리면 "" 가 «모른다»로 빠져 첫 두 줄이 false 가 된다.  */
  const 몸 = grabFrom(iod, "_iod_packAsked_");
  check("★ undefined 만 «모른다»로 본다", 몸.indexOf("=== undefined") >= 0, true);
  check("★ 참/거짓으로 뭉개지 않는다", /if \(!pack\[claims\[i\]\.oid\]\)/.test(몸), false);
}

console.log("\n[19] ★ 원장에 있는 주문은 «따로 나갔다»고 단정할 수 있다");
{
  const 몸 = grabFrom(iod, "_iod_loadPackGroups_").split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check("★ 합포장이 아닌 줄도 담는다", /if \(!grp\) \{ if \(map\[uid\] === undefined\) map\[uid\] = ""/.test(몸), true);
  check("★ 그냥 건너뛰지 않는다", /if \(!grp\) continue;/.test(몸), false);
  check("★ 아는 주문 수를 따로 센다", 몸.indexOf("stat.knownUids") >= 0, true);
  check("묶인 것만 packUids 로 센다", /if \(map\[k\]\) stat\.packUids\+\+/.test(몸), true);
}


console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
