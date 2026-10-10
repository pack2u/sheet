/**
 * ══════════════════════════════════════════════════════════════
 *  반품대장 기록 — 「업체(거래처)」 칸
 *
 *  > "반품대장 기록에 업체도 적을수 있게.. 자동이면 좋고...기능을 넣어줘"
 *                                                      (2026-10-07)
 *
 *  ★ 서버는 이미 적고 있었다 ★
 *    submitReturnLedger 는 처음부터 data.vendor 를 대장 「거래처」 열에
 *    적는다. 빠진 것은 «적을 칸»뿐이었다 — 그래서 이 창으로 기록한 건은
 *    거래처가 늘 비어 나갔다. 화면 예시(박영혜/쿠팡)가 그랬다.
 *
 *  ★ 자동값이 틀리면 안 넣느니만 못하다 ★
 *    품목명 꼬리(「…200개---법인/쿠팡」)에서 읽는데, 같은 자리에 «포장 표지»도
 *    붙는다 — 합포장 · 합배송 · 소분 · 몸통만 · 뚜껑만.
 *    그것을 거래처로 적으면 「이번 달 쿠팡 반품 몇 건」이 조용히 어긋난다.
 *    그래서 규칙을 떠내 «실제로 돌려» 본다. 글자만 보지 않는다.
 *
 *  실행: node CS_WebApp/_csledgervendor_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
const OS = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ok   " + 이름); return; }
  틀린것++;
  console.log("  FAIL " + 이름 + (덧붙임 ? "\n         " + 덧붙임 : ""));
}
function eq(이름, 얻은, 바란) {
  ok(이름 + "  →  " + JSON.stringify(얻은),
    JSON.stringify(얻은) === JSON.stringify(바란),
    "기대 " + JSON.stringify(바란));
}

/** 함수 하나를 떠낸다 */
function 꺼내(src, 이름) {
  const i = src.indexOf("function " + 이름 + "(");
  if (i < 0) return null;
  const j = src.indexOf("{", i);
  let 깊이 = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (깊이 === 0) return src.slice(i, k + 1); }
  }
  return null;
}

/* ══ [1] 칸이 창에 있고, 보내는 꾸러미에 실린다 ═══════════ */
console.log("\n[1] 칸이 있고 실려 나간다");

ok("★ 기록 창에 업체 칸이 있다", /id="ledgerVendor"/.test(HTML));
ok("  무엇을 적는 칸인지 알려 준다", /주문이 어디서 왔나/.test(HTML));
ok("  어디서 온 값인지 밑에 적는다", /id="ledgerVendorWhy"/.test(HTML));

/*  ★ 읽는 자리는 하나다 ★ 단건(submitLedger)과 여러건(submitLedgerMany)이
    각자 읽던 시절, 여러건 쪽에 귀책·사유가 «빠져» 있었다. 창은 하나인데
    읽는 코드가 둘이면 반드시 갈라진다 — 그래서 ledgerModalCommon 만 본다. */
const 공통 = 꺼내(HTML, "ledgerModalCommon") || "";
ok("ledgerModalCommon 을 찾았다", 공통.length > 0);
ok("★ 거기서 업체를 읽는다 (단건·여러건이 같은 자리에서 읽는다)",
  /vendor:\s*g\('ledgerVendor'\)/.test(공통));

ok("★ 창을 열 때 자동으로 채운다", /ledgerFillVendor\(r\)/.test(HTML));
ok("★ 임시저장에도 담는다 (닫았다 열어도 남는다)",
  /'ledgerVendor'/.test(HTML) && /fields: \['ledgerStaff'[\s\S]{0,260}'ledgerVendor'/.test(HTML));

/* ── 서버가 그 값을 실제로 대장에 적는가 ───────────────── */
ok("★ 서버가 거래처 열에 적는다",
  /if \(col\.vendor >= 0\) row\[col\.vendor\] = String\(data\.vendor \|\| ""\)\.trim\(\);/.test(OS));
ok("★ 「거래처」 머리글을 알아본다 (9월 「주문지」·옛 「업체명」도)",
  /col\.vendor < 0 && \/업체명\|주문지\|판매처\|발주업체\|\^거래처\$\//.test(OS));

/* ══ [2] 자동값 — 규칙을 떠내 «돌려» 본다 ═════════════════ */
console.log("\n[2] 품목명 꼬리에서 거래처를 읽는다");

const ctx = { String, Math };
vm.createContext(ctx);
const 표지 = (HTML.match(/var LEDGER_PACK_MARKS = \[[^\]]*\];/) || [""])[0];
ok("포장 표지 목록을 찾았다", 표지.length > 0);
vm.runInContext(표지 + "\n" + (꺼내(HTML, "ledgerVendorFromItem") || ""), ctx);
const 꼬리 = (s) => vm.runInContext("ledgerVendorFromItem", ctx)(s);

eq("★ 화면에서 본 그 줄 — 법인/쿠팡",
  꼬리("NK 알루미늄 원형용기 DS 95 200개---법인/쿠팡"), "법인/쿠팡");
eq("  대리발송도 읽는다", 꼬리("220파이 감자탕 중---대리발송-리바이"), "대리발송-리바이");
eq("  꼬리가 없으면 빈칸", 꼬리("NK 알루미늄 원형용기 DS 95 200개"), "");
eq("  빈 값도 견딘다", 꼬리(""), "");
eq("  null 도 견딘다", 꼬리(null), "");

console.log("\n[2-1] ★ 포장 표지를 거래처로 적지 않는다 ★");
/*  여기가 틀리면 「이번 달 쿠팡 반품 몇 건」이 조용히 어긋난다. */
eq("★ 합포장은 거래처가 아니다", 꼬리("물티슈 100매---합포장"), "");
eq("★ 합배송도 아니다", 꼬리("물티슈 100매===합배송"), "");
eq("★ 소분도 아니다", 꼬리("물티슈 100매---/소분"), "");
eq("★ 몸통만·뚜껑만도 아니다", 꼬리("감자탕 중---몸통만"), "");
eq("  뚜껑만", 꼬리("감자탕 중---뚜껑만"), "");

console.log("\n[2-2] 표지와 거래처가 «같이» 붙은 줄");
/*  실제로 둘이 같이 붙는다 — 표지는 건너뛰고 거래처를 집어야 한다. */
eq("★ 표지를 건너뛰고 거래처를 집는다",
  꼬리("물티슈 100매---합포장---법인/쿠팡"), "법인/쿠팡");
eq("  차례가 바뀌어도", 꼬리("물티슈 100매---법인/쿠팡---합포장"), "법인/쿠팡");
eq("  === 와 --- 가 섞여도", 꼬리("물티슈 100매===합배송---법인/쿠팡"), "법인/쿠팡");
eq("  표지뿐이면 빈칸 (지어내지 않는다)",
  꼬리("물티슈 100매---합포장===합배송"), "");

/* ══ [3] 어디서 왔는지 사람에게 말한다 ════════════════════ */
console.log("\n[3] 자동값은 출발점이지 결론이 아니다");

const 채움 = 꺼내(HTML, "ledgerFillVendor") || "";
ok("ledgerFillVendor 를 찾았다", 채움.length > 0);
/*  ★ 차례가 중요하다 ★ 주문 자료가 아는 값(조치업체·거래처명)이 먼저다.
    품목명 꼬리는 그것이 없을 때만 본다 — 꼬리는 짐작이고 자료는 사실이다. */
const r자리 = 채움.indexOf("r.vendor");
const 꼬리자리 = 채움.indexOf("ledgerVendorFromItem");
ok("★ 주문 자료의 거래처를 «먼저» 본다", r자리 > 0 && 꼬리자리 > r자리,
  "자료 " + r자리 + " · 꼬리 " + 꼬리자리);
ok("  꼬리는 자료가 없을 때만 본다", /if \(!v\) \{[\s\S]{0,160}ledgerVendorFromItem/.test(채움));
ok("★ 어디서 온 값인지 적는다", /자동 — /.test(채움));
ok("★ 못 찾으면 «모른다»고 적는다 (빈칸으로 두고 지어내지 않는다)",
  /거래처가 없습니다/.test(채움));
ok("  고치라고 말해 둔다", /다르면 고치세요/.test(채움));
/*  임시저장이 자동값을 덮으면 밑의 「자동 — …」이 거짓말이 된다 */
ok("★ 임시저장이 덮으면 그렇다고 바꿔 적는다",
  /임시저장에서 되살림/.test(HTML));

console.log("");
console.log(틀린것 ? "실패 " + 틀린것 + "건 / 통과 " + (잰것 - 틀린것)
                  : "모두 통과 (" + 잰것 + "건)");
process.exit(틀린것 ? 1 : 0);
