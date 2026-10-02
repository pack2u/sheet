/**
 * ══════════════════════════════════════════════════════════════
 *  반품대장 기록 — «단건»과 «여러건»이 같은 값을 보내나
 *
 *  ★ 왜 이 시험이 있나 ★  (2026-10-01)
 *    기록 창은 하나인데 보내는 코드가 둘이었다 —
 *      submitLedger      품목 한 개
 *      submitLedgerMany  합포장처럼 품목 여럿
 *    여러건 쪽이 창을 «따로» 읽으면서 귀책·사유·상태·추가연락처를
 *    빠뜨리고 있었다. 합포장 반품을 기록하면 CS 가 골라 둔 귀책·사유가
 *    조용히 사라졌다. 화면엔 아무 표시도 안 났다.
 *
 *    고친 뒤에도 누가 한쪽에 칸을 더하면 또 갈라진다. 그래서 «읽는 자리가
 *    하나인지»를 시험으로 굳힌다.
 *
 *  돌리는 법   node CS_WebApp/_csledgerpath_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ✔ " + 이름); return; }
  틀린것++;
  console.log("  ✗ " + 이름 + (덧붙임 ? "\n      " + 덧붙임 : ""));
}

/** 함수 하나의 몸통을 중괄호 짝을 세어 떠낸다 */
function 떠내(이름) {
  const i = HTML.indexOf("function " + 이름 + "(");
  if (i < 0) return null;
  const j = HTML.indexOf("{", i);
  if (j < 0) return null;
  let 깊이 = 0;
  for (let k = j; k < HTML.length; k++) {
    if (HTML[k] === "{") 깊이++;
    else if (HTML[k] === "}") {
      깊이--;
      if (깊이 === 0) return HTML.slice(i, k + 1);
    }
  }
  return null;
}

/* ── ① 창을 읽는 자리가 하나인가 ───────────────────────────── */
console.log("─── ① 기록 창을 읽는 자리는 하나다 ───");

const 공통 = 떠내("ledgerModalCommon");
ok("ledgerModalCommon 이 있다", !!공통);

//  창에 있는 입력칸 가운데 «사람이 고르는 공통 값» — 품목마다 다를 수 없는 것들
const 공통칸 = ["ledgerType", "ledgerFault", "ledgerReason", "ledgerStatus",
  "ledgerPickup", "ledgerMemo", "ledgerAccount", "ledgerFee",
  "ledgerPhone2", "ledgerPhone2Name"];

공통칸.forEach(function (id) {
  ok("ledgerModalCommon 이 " + id + " 을 읽는다",
    !!공통 && 공통.indexOf("'" + id.replace(/^ledger/, "ledger") + "'") >= 0,
    "공통 함수에 없으면 어느 한쪽 길에서 빠진다");
});

/* ── ② 두 길이 공통 함수를 쓰나 ────────────────────────────── */
console.log("\n─── ② 단건·여러건이 그 함수를 쓴다 ───");

const 단건 = 떠내("submitLedger");
const 여러건 = 떠내("submitLedgerMany");
ok("submitLedger 가 있다", !!단건);
ok("submitLedgerMany 가 있다", !!여러건);

ok("단건이 ledgerModalCommon 을 쓴다",
  !!단건 && /ledgerModalCommon\s*\(/.test(단건));
ok("여러건이 ledgerModalCommon 을 쓴다",
  !!여러건 && /ledgerModalCommon\s*\(/.test(여러건));

/*  ★ 핵심 ★  두 길이 공통 칸을 «직접» 읽으면 안 된다.
    직접 읽는 순간 공통 함수와 두 임자가 되고, 한쪽만 고쳐져 갈라진다.
    단, submitLedger 안에는 submitLedgerMany 호출 전의 사전 검사
    (ledgerStaff 등 품목과 무관한 것)가 있어 공통칸만 본다.            */
공통칸.forEach(function (id) {
  const 쪽 = [["단건", 단건], ["여러건", 여러건]];
  쪽.forEach(function (p) {
    const 몸 = p[1] || "";
    //  submitLedger 는 submitLedgerMany 를 품지 않는다(따로 선언) — 그대로 본다
    const 직접 = new RegExp("getElementById\\(\\s*['\"]" + id + "['\"]\\s*\\)").test(몸);
    ok(p[0] + " 이 " + id + " 을 직접 안 읽는다", !직접,
      "공통 함수 밖에서 또 읽으면 임자가 둘이 된다");
  });
});

/* ── ③ 반품송장이 여러건 길까지 가나 ──────────────────────── */
console.log("\n─── ③ 방금 접수한 반품송장이 여러건 길까지 간다 ───");

ok("submitLedgerMany 가 pickedInv 를 받는다",
  !!여러건 && /function\s+submitLedgerMany\s*\([^)]*pickedInv/.test(여러건),
  "안 받으면 회수 접수로 만든 반품송장이 합포장에서 사라진다");
ok("단건이 pickedInv 를 넘겨 준다",
  !!단건 && /submitLedgerMany\s*\(\s*picked\s*,\s*staff\s*,\s*force\s*,\s*pickedInv/.test(단건));
ok("여러건이 returnInvoice 로 보낸다",
  !!여러건 && /returnInvoice\s*:/.test(여러건));

/* ── ④ 접수 창(추가)도 같은 낱말을 보내나 ─────────────────── */
console.log("\n─── ④ 반품 접수(추가) 창도 귀책·사유를 보낸다 ───");

const 접수 = 떠내("submitRetNew");
ok("submitRetNew 이 있다", !!접수);
[["type", "retNewType"], ["fault", "retNewFault"], ["reason", "retNewReason"],
  ["status", "retNewStatus"]].forEach(function (pair) {
  ok("접수가 " + pair[0] + " 을 보낸다",
    !!접수 && 접수.indexOf(pair[1]) >= 0);
});

/* ── ⑤ 서버가 셋을 다 받아 적나 ───────────────────────────── */
console.log("\n─── ⑤ 서버가 칸이 없을 때도 버리지 않는다 ───");

const GS = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");
const 쓰는것 = GS.slice(GS.indexOf("function submitReturnLedger("),
  GS.indexOf("function submitReturnLedger(") + 9000);

[["귀책·사유", "faultToNotice"], ["반품비", "feeToNotice"],
  ["반품송장", "retInvToNotice"], ["환불계좌", "acctToNotice"],
  ["교환반품구분", "typeToNotice"]].forEach(function (pair) {
  ok(pair[0] + " — 칸이 없으면 비고에 남긴다",
    쓰는것.indexOf(pair[1]) >= 0,
    "칸이 없다고 조용히 버리면 사람은 적힌 줄 안다");
});

ok("비고 모으는 데 typeToNotice 가 들어간다",
  /noticeLines\.push\(typeToNotice\)/.test(GS),
  "만들어 놓고 안 쓰면 그대로 사라진다");
ok("읽는 쪽이 비고에서 구분을 되찾는다",
  /function _cs_typeFromNotice_/.test(GS) && /_cs_typeFromNotice_\(notice\)/.test(GS),
  "쓰기만 하고 못 읽으면 카드에 안 보인다");

/* ── 끝 ───────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════
 *  다시 보내는 것 — 「둘다 적으면 좋겠네」  (2026-10-02)
 *
 *  상품명 칸은 «돌려받는 것»이다. 세트가 뚜껑만 나가면 우리가 몸통을
 *  다시 보내는데, 그것을 적을 칸이 협의된 배열에 없다.
 *  귀책·반품비·구분이 걸어온 길과 같이 비고에 「재출고: …」로 남긴다.
 * ══════════════════════════════════════════════════════════════ */
console.log("\n─── ⑥ 다시 보내는 것을 둘 다 적는다 ───");

const GS2 = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");

ok("접수 창에 재출고 칸이 있다", HTML.indexOf('id="retNewReship"') >= 0);
ok("기록 창에 재출고 칸이 있다", HTML.indexOf('id="ledgerReship"') >= 0);

//  기록 창은 읽는 자리가 하나여야 한다 — 앞의 ② 와 같은 규칙
ok("기록 창의 재출고도 공통 함수에서 읽는다", (function () {
  const i = HTML.indexOf("function ledgerModalCommon(");
  if (i < 0) return false;
  const j = HTML.indexOf("return {", i);
  return HTML.slice(j, HTML.indexOf("};", j)).indexOf("'ledgerReship'") >= 0;
})(), "여기 없으면 여러건 길에서 또 빠진다");
ok("여러건 길이 직접 안 읽는다",
  !/getElementById\(\s*['"]ledgerReship['"]\s*\)/.test(떠내("submitLedgerMany") || ""));
ok("접수 창이 reship 을 보낸다", /reship: document\.getElementById\('retNewReship'\)/.test(HTML));
ok("접수 임시저장에 재출고가 들어 있다", /'retNewReship'/.test(HTML));

ok("칸이 없으면 비고에 「재출고: …」로 남긴다",
  /reshipToNotice = "재출고: " \+ reshipIn/.test(GS2));
ok("비고 줄에 태운다", /noticeLines\.push\(reshipToNotice\)/.test(GS2));
ok("시트에 열이 생기면 그쪽으로 간다",
  /col\.reship >= 0.*row\[col\.reship\] = reshipIn/s.test(GS2) &&
  /\^재출고상품\$/.test(GS2));
ok("읽는 쪽이 비고에서 되찾는다",
  /function _cs_reshipFromNotice_/.test(GS2) && /_cs_reshipFromNotice_\(notice\)/.test(GS2));
ok("카드가 재출고를 낸다", /ret-reship/.test(HTML));
ok("상세 표에도 낸다", /retCaseRowHtml\('재출고', c\.reship\)/.test(HTML));

/*  ★ 품목명은 줄 끝까지 받아야 한다 ★
    「220파이 감자탕 중 백색 몸통 1」처럼 띄어쓰기·숫자가 섞인다.
    낱말 하나로 끊으면 「220파이」만 남는다.  */
ok("되읽기가 줄 끝까지 받는다", (function () {
  const m = GS2.match(/function _cs_reshipFromNotice_[\s\S]{0,500}?\n\}/);
  if (!m) return false;
  //  그 함수를 떼어 내 실제로 돌려 본다
  const fn = new Function("return (" + m[0].replace(/^function /, "function ") + ")")();
  const 비고 = "[261002 09:10 강서희] 뚜껑만 옴\n재출고: 220파이 감자탕 중 백색 몸통 1\n귀책: 판매자 (오배송)";
  return fn(비고) === "220파이 감자탕 중 백색 몸통 1";
})(), "낱말 하나로 끊기면 품목명이 잘린다");

console.log("\n" + (틀린것 ? "✗ " : "✅ ") + 잰것 + "개 중 " + 틀린것 + "개 틀렸습니다.");
process.exit(틀린것 ? 1 : 0);
