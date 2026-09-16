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

console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
