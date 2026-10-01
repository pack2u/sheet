/**
 * 반품 접수 — 귀책(구매자/판매자)과 사유 · 두 화면이 똑같은가
 *
 *  > "반품 접수시 내용을 (자동반품, 단순변심, 오입력, 오배송, 제품파손,
 *  >  택배사고, 제품불량, 배송지연 / 정보불일치, 오배송, 중복출고) 로 해줘"
 *  > "아니 구매자 귀책이 오주문... 판매자 귀책이 오배송"
 *  > "주문송장조회에서 반품대장 기록으로 할경우는 아직도 이전 그대로네..
 *  >  여기도 적용시켜줘.. 다른 부분도 통일이 되야지"
 *
 *  ★ 접수 길이 둘이다 ★
 *    retNew : 반품탭 「+ 반품 접수」
 *    ledger : 주문송장조회 → 「반품대장 기록」
 *    HTML 에 <option> 을 두 벌 적어 두었더니 한쪽만 고쳤다. 그래서 낱말을
 *    RET_TYPES · RET_FAULTS · RET_REASONS 한 표로 모으고, 두 화면이
 *    retFillSelect / retFillPicks / retFillReasons 를 나눠 쓰게 했다.
 *    이 시험은 «두 화면이 갈라지지 않는지»를 지키는 것이 첫 일이다.
 *
 *  ★ 사유는 칸이 있었는데 적는 데가 없었다 ★
 *    대장 L열(사유)은 2026-09-18 에 카드에 «보이게»만 됐다. 두 접수 화면
 *    어디에도 입력칸이 없어서 늘 비어 있었다.
 *
 *  ★ 귀책 열은 아직 대장에 없다 ★
 *    반품송장·환불계좌가 걸어온 길과 같이 비고에 「귀책: 판매자 (오배송)」으로
 *    남기고, 시트에 「귀책」 열이 생기면 코드를 안 고쳐도 열을 읽는다.
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
  구매자: ["자동반품", "단순변심", "오입력"],
  판매자: ["오배송", "제품파손", "사고", "불량",
    "배송지연", "정보불일치", "중복출고"],
};

/* ── 화면 쪽 ─────────────────────────────────────────────────── */
const hctx = { console };
vm.createContext(hctx);
["RET_TYPES", "RET_FAULTS", "RETURN_STATUS_OPTS"].forEach((n) => {
  const i = html.indexOf("    var " + n + " = [");
  vm.runInContext(html.slice(i, html.indexOf("];", i) + 2), hctx);
});
const 표 = html.slice(html.indexOf("var RET_REASONS = {"));
vm.runInContext(표.slice(0, 표.indexOf("};") + 2), hctx);
["retFillSelect", "retFillPicks", "retFillReasons"].forEach((n) =>
  vm.runInContext(꺼내(html, n), hctx));

console.log("\n─── ① 목록이 시킨 그대로인가 ───");
["구매자", "판매자"].forEach((귀책) => {
  const 실제 = hctx.RET_REASONS[귀책] || [];
  ok(귀책 + " " + 시킨것[귀책].length + "개", 실제.length === 시킨것[귀책].length, "지금 " + 실제.length);
  ok(귀책 + " 낱말이 한 글자도 안 다르다", 실제.join("·") === 시킨것[귀책].join("·"),
    "\n         지금: " + 실제.join("·") + "\n         시킨것: " + 시킨것[귀책].join("·"));
});
/*  ★ 2026-09-30 두 번째 가름 ★
    물건이 깨지거나 늦은 것은 «우리(또는 택배사) 탓»이다 — 구매자 쪽에 두면
    반품비를 고객에게 물리게 된다. 귀책이 곧 돈이라 이 가름이 값을 정한다.  */
ok("구매자 쪽은 셋뿐 — 자동반품·단순변심·오입력",
  hctx.RET_REASONS.구매자.join("·") === "자동반품·단순변심·오입력",
  hctx.RET_REASONS.구매자.join("·"));
ok("오배송·파손·사고·불량·배송지연은 판매자 쪽이다",
  ["오배송", "제품파손", "사고", "불량", "배송지연"].every((w) =>
    hctx.RET_REASONS.판매자.indexOf(w) >= 0 && hctx.RET_REASONS.구매자.indexOf(w) < 0));
ok("구매자 목록에 오배송은 없다", hctx.RET_REASONS.구매자.indexOf("오배송") < 0);
const 겹침 = hctx.RET_REASONS.구매자.filter((x) => hctx.RET_REASONS.판매자.indexOf(x) >= 0);
ok("두 목록에 겹치는 낱말이 없다", 겹침.length === 0, 겹침.join("·"));
ok("귀책은 둘뿐", hctx.RET_FAULTS.join("·") === "구매자·판매자", hctx.RET_FAULTS.join("·"));
ok("사유 표의 열쇠가 귀책 목록과 같다",
  Object.keys(hctx.RET_REASONS).sort().join("·") === hctx.RET_FAULTS.slice().sort().join("·"),
  Object.keys(hctx.RET_REASONS).join("·"));

console.log("\n─── ② 낱말이 «한 곳»에만 적혀 있는가 ───");
/*  HTML 에 <option> 을 두 벌 적어 두었던 것이 이번 어긋남의 뿌리다.  */
["retNewType", "ledgerType", "retNewFault", "ledgerFault", "retNewReason", "ledgerReason"].forEach((id) => {
  const i = html.indexOf('<select id="' + id + '"');
  const e = html.indexOf("</select>", i);
  ok(id + " 는 빈 select 다 (표에서 채운다)", i > 0 && !/<option/.test(html.slice(i, e)),
    i < 0 ? "칸을 못 찾음" : html.slice(i, e + 9).replace(/\s+/g, " ").slice(0, 70));
});
ok("유형 낱말은 RET_TYPES 한 줄에만 있다",
  (html.match(/'단순반품'/g) || []).length + (html.match(/"단순반품"/g) || []).length ===
  (html.match(/document\.getElementById\('(retNew|ledger)Type'\)\.value = '단순반품'/g) || []).length + 1,
  "단순반품이 적힌 자리: " + ((html.match(/단순반품/g) || []).length) + "곳");

/* ── 화면 흉내 ───────────────────────────────────────────────── */
function 가짜화면(pfx, 귀책값, 사유값, 유형값) {
  const 칸 = {};
  칸[pfx + "Type"] = { value: 유형값 === undefined ? "" : 유형값, innerHTML: "" };
  칸[pfx + "Fault"] = { value: 귀책값 === undefined ? "" : 귀책값, innerHTML: "" };
  칸[pfx + "Reason"] = { value: 사유값 === undefined ? "" : 사유값, innerHTML: "" };
  hctx.document = { getElementById: (id) => 칸[id] || null };
  return 칸;
}
const 고를수있는것 = (el) =>
  (el.innerHTML.match(/value="([^"]*)"/g) || []).map((m) => m.slice(7, -1));

console.log("\n─── ③ 두 화면이 똑같이 도는가 ───");
["retNew", "ledger"].forEach((pfx) => {
  const 칸 = 가짜화면(pfx);
  hctx.retFillPicks(pfx);
  ok(pfx + " 유형 8개가 표대로", 고를수있는것(칸[pfx + "Type"]).join("·") === hctx.RET_TYPES.join("·"),
    고를수있는것(칸[pfx + "Type"]).join("·"));
  ok(pfx + " 유형 기본값 = 단순반품", 칸[pfx + "Type"].value === "단순반품", 칸[pfx + "Type"].value);
  ok(pfx + " 귀책 기본값 = 구매자", 칸[pfx + "Fault"].value === "구매자", 칸[pfx + "Fault"].value);
  const 사유 = 고를수있는것(칸[pfx + "Reason"]);
  ok(pfx + " 사유 맨 앞은 빈 값 (비워 둘 수 있다)", 사유[0] === "", JSON.stringify(사유[0]));
  ok(pfx + " 사유 기본값은 비어 있다", 칸[pfx + "Reason"].value === "", 칸[pfx + "Reason"].value);
  ok(pfx + " 구매자 사유 8개", 사유.slice(1).join("·") === 시킨것.구매자.join("·"), 사유.slice(1).join("·"));

  칸[pfx + "Fault"].value = "판매자";
  hctx.retFillReasons(pfx);
  ok(pfx + " 판매자로 바꾸면 3개로", 고를수있는것(칸[pfx + "Reason"]).slice(1).join("·") === 시킨것.판매자.join("·"),
    고를수있는것(칸[pfx + "Reason"]).slice(1).join("·"));
});

console.log("\n─── ④ which 를 안 주면 retNew 다 ───");
let 칸 = 가짜화면("retNew");
hctx.retFillPicks();
ok("retFillPicks() 가 retNew 를 채운다", 칸.retNewType.value === "단순반품", 칸.retNewType.value);
칸 = 가짜화면("retNew", "판매자");
hctx.retFillReasons();
ok("retFillReasons() 도 retNew 를 본다",
  고를수있는것(칸.retNewReason).slice(1).join("·") === 시킨것.판매자.join("·"));

console.log("\n─── ⑤ 잘못 눌렀다 되돌려도 적은 것이 안 날아간다 ───");
칸 = 가짜화면("ledger", "구매자", "단순변심");
hctx.retFillReasons("ledger");
ok("같은 귀책이면 고른 값이 그대로", 칸.ledgerReason.value === "단순변심", 칸.ledgerReason.value);
칸.ledgerFault.value = "판매자";
hctx.retFillReasons("ledger");
ok("귀책이 바뀌어 없는 낱말이면 비워진다", 칸.ledgerReason.value === "", 칸.ledgerReason.value);

console.log("\n─── ⑥ 모르는 값이 와도 안 죽는다 ───");
칸 = 가짜화면("retNew", "아무거나", "단순변심");
hctx.retFillReasons();
ok("빈 목록만 남는다", 고를수있는것(칸.retNewReason).join("·") === "", JSON.stringify(고를수있는것(칸.retNewReason)));
ok("칸이 사라지면 조용히 돌아간다", (function () {
  hctx.document = { getElementById: () => null };
  try { hctx.retFillPicks("ledger"); hctx.retFillReasons(); return true; } catch (e) { return false; }
})());
ok("빈칸 안내가 없는 칸은 첫 낱말을 고른다", (function () {
  const 칸2 = 가짜화면("retNew", "", "", "없는유형");
  hctx.retFillSelect("retNewType", hctx.RET_TYPES);
  return 칸2.retNewType.value === "단순반품";
})());

/* ── 대장 쪽 ─────────────────────────────────────────────────── */
const gctx = { String, Number, Array, Math, console, Logger: { log: () => {} } };
vm.createContext(gctx);
vm.runInContext(꺼내(gs, "_cs_faultFromNotice_"), gctx);
vm.runInContext(꺼내(gs, "_cs_mapReturnLedgerCols_"), gctx);

console.log("\n─── ⑦ 대장 머리글에서 귀책을 찾는다 ───");
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

console.log("\n─── ⑧ 사유가 귀책을 잡아먹지 않는다 ───");
/*  2026-09-18 에 K열(유형)이 L열(사유)을 잡아먹었다 — else-if 라서.  */
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

console.log("\n─── ⑨ 비고에 적은 것을 되읽는다 (열이 생기기 전 길) ───");
const 적는꼴 = gs.match(/faultToNotice = "귀책: " \+ faultIn \+ " \(" \+ reasonIn \+ "\)"/);
ok("적는 글자 모양이 그대로다", !!적는꼴, "코드가 바뀌었으면 아래 시험도 같이 고쳐야 한다");
[["판매자", "오배송"], ["구매자", "오주문"], ["구매자", "제품파손"]].forEach((쌍) => {
  const 줄 = "귀책: " + 쌍[0] + " (" + 쌍[1] + ")";
  ok("「" + 줄 + "」 → " + 쌍[0], gctx._cs_faultFromNotice_(줄) === 쌍[0], gctx._cs_faultFromNotice_(줄));
});
ok("여러 줄 비고에서도 찾는다", gctx._cs_faultFromNotice_(
  "[260930 10:00 김진수] 고객 요청\n귀책: 판매자 (오배송)\n반품송장: 600622029800") === "판매자");
ok("전각 콜론도 받는다", gctx._cs_faultFromNotice_("귀책： 구매자 (오입력)") === "구매자");
ok("귀책이 없으면 빈 값", gctx._cs_faultFromNotice_("반품송장: 600622029800") === "");
ok("빈 비고도 탈 없다", gctx._cs_faultFromNotice_("") === "" && gctx._cs_faultFromNotice_(null) === "");
ok("모르는 낱말은 안 받는다", gctx._cs_faultFromNotice_("귀책: 택배사") === "");

console.log("\n─── ⑩ 적는 규칙 — 사유가 없으면 귀책만 남기지 않는다 ───");
const 쓰는데 = gs.slice(gs.indexOf("var faultIn = String(data.fault"),
  gs.indexOf("var faultIn = String(data.fault") + 400);
ok("귀책은 사유가 있을 때만 적는다", /if \(faultIn && reasonIn\)/.test(쓰는데), 쓰는데.slice(0, 120));
ok("사유는 값이 있을 때만 적는다", /if \(col\.reason >= 0 && reasonIn\)/.test(gs));
ok("전용 열이 있으면 열에 적는다", /if \(col\.fault >= 0\) row\[col\.fault\] = faultIn;/.test(쓰는데));
ok("비고 줄에 태운다", /if \(faultToNotice\) noticeLines\.push\(faultToNotice\);/.test(gs));

console.log("\n─── ⑪ 카드로 돌려준다 ───");
ok("열이 있으면 열을, 없으면 비고를 읽는다",
  /fault: col\.fault >= 0\s*\r?\n\s*\? String\(row\[col\.fault\] \|\| ""\)\.trim\(\)\s*\r?\n\s*: _cs_faultFromNotice_\(notice\)/.test(gs));
ok("카드 화면이 귀책을 낸다", /retCaseRowHtml\('귀책', c\.fault\)/.test(html));

console.log("\n─── ⑫ 두 화면이 서버로 같은 값을 보낸다 ───");
["retNew", "ledger"].forEach((pfx) => {
  ok(pfx + " 가 fault 를 보낸다",
    new RegExp("fault: document\\.getElementById\\('" + pfx + "Fault'\\)\\.value").test(html));
  ok(pfx + " 가 reason 을 보낸다",
    new RegExp("reason: document\\.getElementById\\('" + pfx + "Reason'\\)\\.value").test(html));
  ok(pfx + " 임시저장에 두 칸이 들어 있다",
    new RegExp("'" + pfx + "Fault', '" + pfx + "Reason'").test(html));
  ok(pfx + " 화면 열 때 채우기가 기본값보다 «먼저»", (function () {
    const i = html.indexOf("retFillPicks('" + pfx + "')");
    const j = html.indexOf("document.getElementById('" + pfx + "Type').value = '단순반품'", i);
    return i > 0 && j > i;
  })());
  ok(pfx + " 임시저장 되살리기가 목록을 채운 뒤 사유를 넣는다", (function () {
    const i = html.indexOf("if (r && v && v." + pfx + "Reason) r.value = v." + pfx + "Reason;");
    if (i < 0) return false;
    const 앞 = html.lastIndexOf("retFillReasons(", i);
    return 앞 > 0 && i - 앞 < 300;
  })());
});
ok("onchange 가 제 화면을 가리킨다",
  /id="retNewFault" onchange="retFillReasons\(\)"/.test(html) &&
  /id="ledgerFault" onchange="retFillReasons\('ledger'\)"/.test(html));

console.log("\n─── ⑫ 상태 목록 — 시트가 받는 말과 같은가 ───");
/*  ★ 2026-10-01 ★  반품탭 접수에 「수거요청·수거중·반품입고·환불처리」가
    박혀 있었는데, 대장 상태 드롭다운은 넷만 받는다(setAllowInvalid(false)).
    그 넷 밖을 고르면 시트가 쓰기를 «거절»해 카드가 안 만들어진다.
    목록을 적어 둔 자리가 셋이었다 — 서버 표·화면 대비값·화면 <option>.  */
ok("화면 대비값이 시트가 받는 넷과 같다",
  hctx.RETURN_STATUS_OPTS.join("·") === "접수·반품송장·입고검수·이카운트OK",
  hctx.RETURN_STATUS_OPTS.join("·"));
ok("서버 표도 그 넷이다",
  /_CS_RETURN_STATUS_OPTS_ = \[[^\]]*"접수"[^\]]*"반품송장"[^\]]*"입고검수"[^\]]*"이카운트OK"[^\]]*\]/.test(gs));
["retNewStatus", "ledgerStatus"].forEach(function (id) {
  const i = html.indexOf('<select id="' + id + '"');
  ok(id + " 에 option 이 박혀 있지 않다 (표에서 채운다)",
    i > 0 && !/<option/.test(html.slice(i, html.indexOf("</select>", i))));
});
ok("두 화면 다 상태를 서버로 보낸다",
  /status: document\.getElementById\('retNewStatus'\)\.value/.test(html) &&
  /status: document\.getElementById\('ledgerStatus'\)\.value/.test(html));
ok("★ 기록 화면이 접수 화면과 «같은 값»을 보낸다 ★", (function () {
  const 뽑 = function (fn) {
    const i = html.indexOf(".submitReturnLedger({", html.indexOf(fn));
    const e = html.indexOf("});", i);
    return (html.slice(i, e).match(/^\s*(\w+):/gm) || []).map(function (x) {
      return x.trim().replace(":", "");
    });
  };
  const a = 뽑("function submitRetNew");
  const b = {};
  뽑("function submitLedger").forEach(function (k) { b[k] = 1; });
  //  source·origin·carrier·orderNo 는 주문에서 오는 것이라 접수 화면엔 없다
  const 빠진 = a.filter(function (k) { return !b[k]; });
  return 빠진.length === 0;
})());

console.log("\n─── ⑬ 사유도 비고 길을 탄다 (대장에 사유 열이 없다) ───");
/*  202609 탭 실측(2026-09-30) — 쓰이는 폭 21칸에 「반품사유」가 없다.
    12번째가 「재출고/단순/오주문입력/오배송」(유형)이고 그 옆은 회수신청이다.
    2026-09-18 에 「L열에 반품사유가 있다」고 알고 고쳤는데 L열은 유형이었다.
    그래서 사유는 그때부터 한 번도 안 적혔고 카드에도 안 떴다.  */
vm.runInContext(꺼내(gs, "_cs_reasonFromNotice_"), gctx);
ok("열이 없으면 비고에서 사유를 읽는다",
  /reason: col\.reason >= 0\s*\r?\n\s*\? String\(row\[col\.reason\] \|\| ""\)\.trim\(\)\s*\r?\n\s*: _cs_reasonFromNotice_\(notice\)/.test(gs));
ok("귀책이 비었을 때만 「사유: …」를 따로 적는다",
  /if \(col\.reason < 0 && reasonIn && !faultToNotice\) \{/.test(gs));
[["귀책: 판매자 (오배송)", "오배송"],
 ["[260930 10:00 김진수] 고객 요청\n귀책: 판매자 (불량)\n반품송장: 600622029800", "불량"],
 ["사유: 제품파손", "제품파손"],
 ["업체 포털 접수. 사유: 중복출고. 덧붙임", "중복출고"]].forEach(function (쌍) {
  ok("「" + 쌍[0].replace(/\n/g, " ").slice(0, 34) + "…」 → " + 쌍[1],
    gctx._cs_reasonFromNotice_(쌍[0]) === 쌍[1], gctx._cs_reasonFromNotice_(쌍[0]));
});
ok("귀책 줄 하나가 사유까지 담는다 — 줄을 둘 적지 않는다",
  gctx._cs_faultFromNotice_("귀책: 판매자 (오배송)") === "판매자" &&
  gctx._cs_reasonFromNotice_("귀책: 판매자 (오배송)") === "오배송");
ok("표시가 없으면 빈 값", gctx._cs_reasonFromNotice_("반품송장: 600622029800") === "");
ok("빈 비고도 탈 없다",
  gctx._cs_reasonFromNotice_("") === "" && gctx._cs_reasonFromNotice_(null) === "");
ok("괄호가 안 닫혔으면 안 받는다", gctx._cs_reasonFromNotice_("귀책: 판매자 (오배송") === "");

console.log("\n" + (fail ? "❌" : "✅") + "  맞음 " + pass + " · 틀림 " + fail + "\n");
process.exit(fail ? 1 : 0);
