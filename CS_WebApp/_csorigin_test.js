/**
 * ══════════════════════════════════════════════════════════════
 *  주문송장조회 카드 — 「주문처」
 *
 *  > "CS웹앱의 주문 조회에서 전화주문인지. 법인/ 배민상회, 등
 *  >  발주업체를 볼수 있을까?"                            (2026-10-07)
 *
 *  ★ 왜 안 보였나 ★
 *    카드의 「업체」 줄은 r.vendor 가 «있을 때만» 떴다. 그 칸은 조치업체
 *    (대리발송) 자리라 거의 비어 있다 — 그래서 사실상 안 보였다.
 *
 *  ★ 가르는 잣대는 고유ID 머리다 ★
 *    세트분리 core.js 의 ssIsHubOrderUid 와 «같은 모양»이다.
 *      p0921000001 · 0921-PH-…  전화주문
 *      d0930000044 · 0901-ds-…  대리판매
 *      숫자만                    사방넷 → 어느 몰인지는 품목명 꼬리
 *    두 곳이 다른 규칙을 쓰면 한쪽에서 맞는 것이 다른 쪽에서 틀린다.
 *    그래서 그 모양이 어긋나지 않았는지도 여기서 센다.
 *
 *  실행: node CS_WebApp/_csorigin_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
const CORE = fs.readFileSync(
  path.join(__dirname, "..", "세트분리V2", "core.js"), "utf8");

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

/* ══ 규칙을 떠내 돌린다 ═══════════════════════════════════ */
const ctx = { String, Math };
vm.createContext(ctx);
const 표지 = (HTML.match(/var LEDGER_PACK_MARKS = \[[^\]]*\];/) || [""])[0];
vm.runInContext([표지,
  꺼내(HTML, "ledgerVendorFromItem"),
  꺼내(HTML, "orderOriginOf")].join("\n"), ctx);
const 주문처 = (r) => vm.runInContext("orderOriginOf", ctx)(r);

/* ── [1] 전화주문 ───────────────────────────────────────── */
console.log("\n[1] 전화주문 — p… · …-PH-…");
eq("★ p0921000001", 주문처({ orderNo: "p0921000001" }), { kind: "전화주문", who: "" });
eq("  대문자 P 도", 주문처({ orderNo: "P0921000001" }), { kind: "전화주문", who: "" });
eq("  옛 모양 0921-PH-a3f19",
  주문처({ orderNo: "0921-PH-a3f19" }), { kind: "전화주문", who: "" });
eq("  더 옛 모양 260902-PH-a3f19",
  주문처({ orderNo: "260902-PH-a3f19" }), { kind: "전화주문", who: "" });

/* ── [2] 대리판매 ───────────────────────────────────────── */
console.log("\n[2] 대리판매 — d… · …-ds-…");
eq("★ d0930000044", 주문처({ orderNo: "d0930000044" }), { kind: "대리판매", who: "" });
eq("★ 업체명을 알면 같이 보여 준다",
  주문처({ orderNo: "d1007000022", vendor: "대리발송-당장드림/탁기선" }),
  { kind: "대리판매", who: "대리발송-당장드림/탁기선" });
eq("  옛 모양 0901-ds-4581",
  주문처({ orderNo: "0901-ds-4581" }), { kind: "대리판매", who: "" });

/* ── [3] 사방넷 — 어느 몰인가 ───────────────────────────── */
console.log("\n[3] 사방넷 주문 — 품목명 꼬리에서 몰을 읽는다");
eq("★ 법인/쿠팡",
  주문처({ orderNo: "2165247640",
          item: "NK 알루미늄 원형용기 DS 95 200개---법인/쿠팡" }),
  { kind: "", who: "법인/쿠팡" });
eq("★ 배민상회",
  주문처({ orderNo: "2165247640", item: "JH 샐러드 202 투명 100세트---배민상회" }),
  { kind: "", who: "배민상회" });
/*  ★ 포장 표지를 몰 이름으로 적지 않는다 ★ 거래처 칸과 같은 규칙을 쓴다 */
eq("★ 합포장은 몰이 아니다 (줄을 안 만든다)",
  주문처({ orderNo: "2165247640", item: "물티슈 100매---합포장" }), null);
eq("  표지를 건너뛰고 몰을 집는다",
  주문처({ orderNo: "2165247640", item: "물티슈 100매---합포장---배민상회" }),
  { kind: "", who: "배민상회" });

/* ── [4] 모르면 지어내지 않는다 ─────────────────────────── */
console.log("\n[4] ★ 「모른다」를 「없다」로 적지 않는다 ★");
eq("★ 아무것도 모르면 줄을 안 만든다",
  주문처({ orderNo: "2165247640", item: "물티슈 100매" }), null);
eq("  주문번호가 없어도", 주문처({}), null);
eq("  꼬리는 없고 조치업체만 있으면 그것이라도 보여 준다",
  주문처({ orderNo: "2165247640", item: "물티슈 100매", vendor: "당장드림" }),
  { kind: "", who: "당장드림" });

/* ── [5] 「이름/번호#2」로 붙어 와도 읽는다 ─────────────── */
console.log("\n[5] 주문번호가 붙어서 올 때");
/*  대장·원장은 「김미화/2157237902#2」 같은 모양으로 담기도 한다 */
eq("★ 이름이 앞에 붙어도 전화주문을 알아본다",
  주문처({ orderNo: "김미화/p0921000001" }), { kind: "전화주문", who: "" });
eq("  대리판매도", 주문처({ orderNo: "홍길동/d0930000044" }),
  { kind: "대리판매", who: "" });

/* ══ [6] 세트분리와 «같은 규칙»인가 ═══════════════════════ */
console.log("\n[6] 한 값에 주인은 하나 — 세트분리와 모양이 같은가");
/*  세트분리 ssIsHubOrderUid 가 패스로 거르는 것과 여기서 전화·대리로 보는 것이
    어긋나면, 한쪽에서 「전화주문」인 건이 다른 쪽에서 아니게 된다.  */
const 허브규칙 = 꺼내(CORE, "ssIsHubOrderUid") || "";
ok("세트분리 규칙을 찾았다", 허브규칙.length > 0);
ok("★ p·d 열 자리 모양을 쓴다", /\[pd\]\\d\{10\}/.test(허브규칙));
ok("★ ds·PH 옛 모양도 본다", /\(\?:ds\|PH\)/.test(허브규칙));
const 내규칙 = 꺼내(HTML, "orderOriginOf") || "";
ok("  이쪽도 p 열 자리", /\^p\\d\{10\}\$/.test(내규칙));
ok("  이쪽도 d 열 자리", /\^d\\d\{10\}\$/.test(내규칙));
ok("  이쪽도 PH 옛 모양", /PH-/.test(내규칙));
ok("  이쪽도 ds 옛 모양", /ds-/.test(내규칙));
/*  실제로 돌려서 맞춰 본다 — 글자가 같아도 뜻이 갈릴 수 있다 */
const 허브ctx = { };
vm.createContext(허브ctx);
vm.runInContext((꺼내(CORE, "ssText") || "function ssText(v){return v==null?'':String(v).trim();}") +
  "\n" + (꺼내(CORE, "ssBaseUid") || "") + "\n" + 허브규칙, 허브ctx);
const 허브판정 = vm.runInContext("ssIsHubOrderUid", 허브ctx);
["p0921000001", "d0930000044", "0921-PH-a3f19", "0901-ds-4581"].forEach((u) => {
  const 내것 = 주문처({ orderNo: u });
  ok("  " + u + " — 양쪽 다 「허브 주문」",
    !!허브판정(u) && !!내것 && (내것.kind === "전화주문" || 내것.kind === "대리판매"),
    "세트분리 " + 허브판정(u) + " · 여기 " + JSON.stringify(내것));
});
["2165247640", "20250918-0000123"].forEach((u) => {
  const 내것 = 주문처({ orderNo: u });
  ok("  " + u + " — 양쪽 다 사방넷(전화·대리 아님)",
    !허브판정(u) && (!내것 || !내것.kind),
    "세트분리 " + 허브판정(u) + " · 여기 " + JSON.stringify(내것));
});

/* ══ [7] 화면에 붙었는가 ═════════════════════════════════ */
console.log("\n[7] 카드에 실제로 그려진다");
ok("★ 카드가 주문처 줄을 부른다", /orderOriginRowHtml\(r\)/.test(HTML));
ok("  옛 「업체」 줄은 걷어냈다 (한 줄에 모은다)",
  !/os-lab">업체<\/div><div class="os-val">' \+ esc\(r\.vendor\)/.test(HTML));
ok("  딱지 모양이 있다", /\.os-origin \{/.test(HTML));
ok("  밝은 바탕 짝도 있다",
  /:root\[data-theme="light"\] \.os-origin \{/.test(HTML));

console.log("");
console.log(틀린것 ? "실패 " + 틀린것 + "건 / 통과 " + (잰것 - 틀린것)
                  : "모두 통과 (" + 잰것 + "건)");
process.exit(틀린것 ? 1 : 0);
