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
  ["적요", "비고", "메모", "상태", "주문상태", "비고1", "배송메시지", "배송메세지", "특기사항"]
    .forEach((h) => check("읽는다: " + h, 읽나(h), true));
  ["수취인", "품목명", "송장번호", "수량"].forEach((h) => check("안 읽는다: " + h, 읽나(h), false));
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


console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
