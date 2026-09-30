/**
 * 반품 접수 — 귀책(구매자/판매자)과 사유
 *
 *  > "반품 접수시 내용을 (자동반품, 단순변심, 오입력, 오배송, 제품파손,
 *  >  택배사고, 제품불량, 배송지연 / 정보불일치, 오배송, 중복출고) 로 해줘"
 *  > "아니 구매자 귀책이 오주문... 판매자 귀책이 오배송"
 *
 *  ★ 사유는 칸이 있었는데 적는 데가 없었다 ★
 *    대장 L열(사유)은 2026-09-18 에 카드에 «보이게»만 됐다. 접수 화면에
 *    입력칸이 없어서 CS 가 적을 길이 없었고, 그래서 늘 비어 있었다.
 *
 *  ★ 낱말이 귀책마다 다르다 ★
 *    구매자가 잘못 주문한 것은 「오주문」, 우리가 잘못 보낸 것은 「오배송」.
 *    섞어 두면 CS 가 매번 어느 것인지 고민한다. 그래서 귀책을 먼저 고른다.
 *
 *  ★ 귀책 열은 아직 대장에 없다 ★
 *    반품송장·환불계좌가 걸어온 길과 같이 비고에 「귀책: 판매자 (오배송)」으로
 *    남기고, 시트에 「귀책」 열이 생기면 코드를 안 고쳐도 열을 읽는다.
 *    적은 것과 되읽는 것이 짝이 맞는지 여기서 지킨다.
 *
 * 실행: node _csretreason_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
const gs = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");
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

/* ── 사장님이 말한 낱말 그대로 ─────────────────────────────── */
const 시킨것 = {
  구매자: ["자동반품", "단순변심", "오입력", "오주문",
    "제품파손", "택배사고", "제품불량", "배송지연"],
  판매자: ["정보불일치", "오배송", "중복출고"],
};

/* ── 화면 쪽 — RET_REASONS 와 retFillReasons ─────────────────── */
const 표 = html.slice(html.indexOf("var RET_REASONS = {"));
const hctx = { console };
vm.createContext(hctx);
vm.runInContext(표.slice(0, 표.indexOf("};") + 2), hctx);
vm.runInContext(꺼내(html, "retFillReasons"), hctx);

console.log("\n─── ① 목록이 시킨 그대로인가 ───");
["구매자", "판매자"].forEach((귀책) => {
  const 실제 = hctx.RET_REASONS[귀책] || [];
  ok(귀책 + " " + 시킨것[귀책].length + "개", 실제.length === 시킨것[귀책].length,
    "지금 " + 실제.length);
  ok(귀책 + " 낱말이 한 글자도 안 다르다", 실제.join("·") === 시킨것[귀책].join("·"),
    "\n         지금: " + 실제.join("·") + "\n         시킨것: " + 시킨것[귀책].join("·"));
});
ok("구매자 4번째는 오주문이다 (오배송이 아니다)", hctx.RET_REASONS.구매자[3] === "오주문",
  hctx.RET_REASONS.구매자[3]);
ok("구매자 목록에 오배송은 없다", hctx.RET_REASONS.구매자.indexOf("오배송") < 0);
ok("판매자 목록에 오주문은 없다", hctx.RET_REASONS.판매자.indexOf("오주문") < 0);
const 겹침 = hctx.RET_REASONS.구매자.filter((x) => hctx.RET_REASONS.판매자.indexOf(x) >= 0);
ok("두 목록에 겹치는 낱말이 없다", 겹침.length === 0, 겹침.join("·"));

/* ── 화면 흉내 ───────────────────────────────────────────────── */
function 가짜화면(귀책값, 사유값) {
  const 칸 = {
    retNewFault: { value: 귀책값 },
    retNewReason: { value: 사유값 === undefined ? "" : 사유값, innerHTML: "" },
  };
  hctx.document = { getElementById: (id) => 칸[id] || null };
  return 칸;
}
const 고를수있는것 = (칸) =>
  (칸.retNewReason.innerHTML.match(/value="([^"]*)"/g) || [])
    .map((m) => m.slice(7, -1));

console.log("\n─── ② 귀책을 고르면 사유 목록이 바뀐다 ───");
let 칸 = 가짜화면("구매자");
hctx.retFillReasons();
let 것 = 고를수있는것(칸);
ok("맨 앞은 빈 값이다 (비워 둘 수 있다)", 것[0] === "", JSON.stringify(것[0]));
ok("빈칸 안내가 보인다", /비워도 됩니다/.test(칸.retNewReason.innerHTML));
ok("구매자 8개가 다 들어 있다", 것.slice(1).join("·") === 시킨것.구매자.join("·"), 것.slice(1).join("·"));

칸 = 가짜화면("판매자");
hctx.retFillReasons();
것 = 고를수있는것(칸);
ok("판매자 3개가 다 들어 있다", 것.slice(1).join("·") === 시킨것.판매자.join("·"), 것.slice(1).join("·"));
ok("판매자로 바꾸면 구매자 낱말은 사라진다", 것.indexOf("단순변심") < 0);

console.log("\n─── ③ 잘못 눌렀다 되돌려도 적은 것이 안 날아간다 ───");
칸 = 가짜화면("구매자", "제품불량");
hctx.retFillReasons();
ok("같은 귀책이면 고른 값이 그대로", 칸.retNewReason.value === "제품불량", 칸.retNewReason.value);
칸.retNewFault.value = "판매자";
hctx.retFillReasons();
ok("귀책이 바뀌어 없는 낱말이면 비워진다", 칸.retNewReason.value === "", 칸.retNewReason.value);

console.log("\n─── ④ 모르는 귀책이 와도 안 죽는다 ───");
칸 = 가짜화면("아무거나", "제품불량");
hctx.retFillReasons();
것 = 고를수있는것(칸);
ok("빈 목록만 남는다", 것.length === 1 && 것[0] === "", JSON.stringify(것));
ok("칸이 사라지면 조용히 돌아간다", (function () {
  hctx.document = { getElementById: () => null };
  try { hctx.retFillReasons(); return true; } catch (e) { return false; }
})());

/* ── 대장 쪽 — 열 찾기 ─────────────────────────────────────── */
const gctx = { String, Number, Array, Math, console, Logger: { log: () => {} } };
vm.createContext(gctx);
vm.runInContext(꺼내(gs, "_cs_faultFromNotice_"), gctx);
vm.runInContext(꺼내(gs, "_cs_mapReturnLedgerCols_"), gctx);

console.log("\n─── ⑤ 대장 머리글에서 귀책을 찾는다 ───");
let c = gctx._cs_mapReturnLedgerCols_(
  ["반품접수날짜", "담당자", "업체", "고객명", "전화번호", "품목", "수량",
   "송장번호", "교환반품구분", "반품사유", "반품비", "상태값", "주의점"]);
ok("귀책 열이 없으면 -1", c.fault === -1, String(c.fault));
ok("사유는 그대로 찾는다", c.reason === 9, String(c.reason));
ok("유형도 그대로 찾는다", c.type === 8, String(c.type));

c = gctx._cs_mapReturnLedgerCols_(
  ["반품접수날짜", "담당자", "업체", "고객명", "전화번호", "품목", "수량",
   "송장번호", "교환반품구분", "반품사유", "귀책", "반품비", "상태값", "주의점"]);
ok("「귀책」 열이 생기면 찾는다", c.fault === 10, String(c.fault));
ok("사유가 귀책에 안 먹힌다", c.reason === 9, String(c.reason));

console.log("\n─── ⑥ 사유가 귀책을 잡아먹지 않는다 ───");
/*  2026-09-18 에 K열(유형)이 L열(사유)을 잡아먹었다 — else-if 라서.
    같은 일이 귀책에 나면 안 된다. */
c = gctx._cs_mapReturnLedgerCols_(["반품귀책사유", "반품사유"]);
ok("「반품귀책사유」는 귀책으로 안 간다 (좁게 잡는다)", c.fault === -1, String(c.fault));
c = gctx._cs_mapReturnLedgerCols_(["귀책구분", "반품사유"]);
ok("「귀책구분」은 귀책", c.fault === 0, String(c.fault));
ok("그 뒤 사유도 따로 잡힌다", c.reason === 1, String(c.reason));
c = gctx._cs_mapReturnLedgerCols_(["책임구분", "사유"]);
ok("「책임구분」도 귀책", c.fault === 0, String(c.fault));
c = gctx._cs_mapReturnLedgerCols_(["과실구분"]);
ok("「과실구분」도 귀책", c.fault === 0, String(c.fault));
c = gctx._cs_mapReturnLedgerCols_(["귀 책"]);
ok("빈칸이 섞여도 잡는다", c.fault === 0, String(c.fault));

console.log("\n─── ⑦ 비고에 적은 것을 되읽는다 (열이 생기기 전 길) ───");
/*  적는 쪽과 읽는 쪽이 짝이 맞아야 한다. 적는 글자 모양은 코드에서 가져온다. */
const 적는꼴 = gs.match(/faultToNotice = "귀책: " \+ faultIn \+ " \(" \+ reasonIn \+ "\)"/);
ok("적는 글자 모양이 그대로다", !!적는꼴, "코드가 바뀌었으면 아래 시험도 같이 고쳐야 한다");
[["판매자", "오배송"], ["구매자", "오주문"], ["구매자", "제품파손"]].forEach((쌍) => {
  const 줄 = "귀책: " + 쌍[0] + " (" + 쌍[1] + ")";
  ok("「" + 줄 + "」 → " + 쌍[0], gctx._cs_faultFromNotice_(줄) === 쌍[0],
    gctx._cs_faultFromNotice_(줄));
});
ok("여러 줄 비고에서도 찾는다", gctx._cs_faultFromNotice_(
  "[260930 10:00 김진수] 고객 요청\n귀책: 판매자 (오배송)\n반품송장: 600622029800") === "판매자");
ok("전각 콜론도 받는다", gctx._cs_faultFromNotice_("귀책： 구매자 (오입력)") === "구매자");
ok("귀책이 없으면 빈 값", gctx._cs_faultFromNotice_("반품송장: 600622029800") === "");
ok("빈 비고도 탈 없다", gctx._cs_faultFromNotice_("") === "" && gctx._cs_faultFromNotice_(null) === "");
ok("모르는 낱말은 안 받는다", gctx._cs_faultFromNotice_("귀책: 택배사") === "");

console.log("\n─── ⑧ 적는 규칙 — 사유가 없으면 귀책만 남기지 않는다 ───");
/*  「판매자」 한 낱말만 비고에 남으면 나중에 읽는 사람에게 아무것도 안 알려 준다. */
const 쓰는데 = gs.slice(gs.indexOf("var faultIn = String(data.fault"),
  gs.indexOf("var faultIn = String(data.fault") + 400);
ok("귀책은 사유가 있을 때만 적는다", /if \(faultIn && reasonIn\)/.test(쓰는데), 쓰는데.slice(0, 120));
ok("사유는 값이 있을 때만 적는다", /if \(col\.reason >= 0 && reasonIn\)/.test(gs));
ok("전용 열이 있으면 열에 적는다", /if \(col\.fault >= 0\) row\[col\.fault\] = faultIn;/.test(쓰는데));
ok("비고 줄에 태운다", /if \(faultToNotice\) noticeLines\.push\(faultToNotice\);/.test(gs));

console.log("\n─── ⑨ 카드로 돌려준다 ───");
ok("열이 있으면 열을, 없으면 비고를 읽는다",
  /fault: col\.fault >= 0\s*\r?\n\s*\? String\(row\[col\.fault\] \|\| ""\)\.trim\(\)\s*\r?\n\s*: _cs_faultFromNotice_\(notice\)/.test(gs));
ok("카드 화면이 귀책을 낸다", /retCaseRowHtml\('귀책', c\.fault\)/.test(html));

console.log("\n─── ⑩ 화면이 서버로 같이 보낸다 ───");
ok("fault 를 보낸다", /fault: document\.getElementById\('retNewFault'\)\.value/.test(html));
ok("reason 을 보낸다", /reason: document\.getElementById\('retNewReason'\)\.value/.test(html));
ok("임시저장에 두 칸이 들어 있다", /'retNewFault', 'retNewReason'/.test(html));
ok("초기화가 귀책 먼저, 목록 채우기 다음", (function () {
  const i = html.indexOf("document.getElementById('retNewFault').value = '구매자'");
  const j = html.indexOf("retFillReasons();", i);
  return i > 0 && j > i;
})());
ok("임시저장 되살리기가 목록을 채운 뒤 사유를 넣는다", (function () {
  /*  되살리기는 값만 넣는다 — onchange 가 안 돈다. 그래서 사유 select 에는
      아직 그 귀책의 항목이 없고, 값을 넣어도 안 들어간다. 순서가 목숨이다.  */
  const i = html.indexOf("load: function (v) {");
  if (i < 0) return false;
  const 토막 = html.slice(i, i + 400);
  const 앞 = 토막.indexOf("retFillReasons();");
  const 뒤 = 토막.indexOf("r.value = v.retNewReason");
  return 앞 > 0 && 뒤 > 앞;
})());
ok("목록을 채울 때 값을 «드러내» 정한다 (브라우저 성질에 기대지 않는다)",
  /r\.value = \(있던것 && 목록\.indexOf\(있던것\) !== -1\) \? 있던것 : '';/.test(html));

console.log("\n" + (fail ? "❌" : "✅") + "  맞음 " + pass + " · 틀림 " + fail + "\n");
process.exit(fail ? 1 : 0);
