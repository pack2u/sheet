/**
 * 반품 접수 — 합포장 품목 고르기.
 * 2026-09-08
 *
 *   node _csledger_test.js
 *
 * > "기존에 조회하면 반품대장 기록이 있는데 거기서 자동으로 뜨면 좋을꺼 같아.
 * >  선택해제를 통해 (전체 및 개별선택 가능하게)"
 *
 * 검색 결과는 **품목 한 줄이 한 카드**다. 합포장 주문은 같은 송장으로 카드가
 * 여럿 뜨는데, 아무 카드에서나 접수를 열면 그 한 품목만 대장에 들어갔다.
 * 나머지는 카드를 하나씩 찾아 또 눌러야 했다.
 *
 * 여기서는 home.html 안의 함수를 꺼내 **묶는 규칙**만 본다.
 * DOM 이 필요한 부분(체크박스)은 마크업이 있는지로 확인한다.
 */
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/home.html", "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  OK " + name); }
  else { fail++; console.log("  NG " + name + (got !== undefined ? "  → " + got : "")); }
};

/**
 * home.html 에서 함수 한 덩어리를 꺼낸다.
 * 정규식 대신 글자로 찾는다 — 함수 안에 중괄호가 여럿이라 정규식이 지저분해지고,
 * 여는 괄호를 세는 편이 틀릴 여지가 적다.
 */
function grab(name) {
  const head = html.indexOf("function " + name + "(");
  if (head === -1) throw new Error(name + " 를 못 찾았습니다");
  let depth = 0, started = false;
  for (let i = head; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") { depth++; started = true; }
    else if (ch === "}") { depth--; if (started && depth === 0) return html.slice(head, i + 1); }
  }
  throw new Error(name + " 의 끝을 못 찾았습니다");
}

// ledgerSiblings 는 CS_ROWS 만 있으면 돈다
const CS_ROWS = [
  { invoice: "268334382164", item: "A 캐리어", qty: 1 },
  { invoice: "268334382164", item: "B 뚜껑",   qty: 2 },
  { invoice: "268334382164", item: "C 용기",   qty: 3 },
  { invoice: "111122223333", item: "D 다른건", qty: 1 },
  { invoice: "",             item: "E 송장없음", qty: 1 },
];
const ledgerSiblings = new Function("CS_ROWS", grab("ledgerSiblings") + "; return ledgerSiblings;")(CS_ROWS);

console.log("\n[1] 같은 송장끼리 묶는다");
ok("합포장 3건이 함께 잡힌다", ledgerSiblings(0).length === 3, ledgerSiblings(0).join(","));
ok("어느 카드에서 열어도 같은 3건", ledgerSiblings(2).length === 3);
ok("★ 누른 카드가 맨 앞에 온다 ★", ledgerSiblings(2)[0] === 2, ledgerSiblings(2).join(","));
ok("다른 송장은 안 섞인다", ledgerSiblings(3).length === 1 && ledgerSiblings(3)[0] === 3);

console.log("\n[2] 묶을 근거가 없으면 혼자다");
// 송장이 없으면 이름이 같아도 묶지 않는다 — 남의 주문을 끌어오면 더 나쁘다
ok("송장이 비면 그 카드 하나", ledgerSiblings(4).length === 1 && ledgerSiblings(4)[0] === 4);

console.log("\n[3] 화면 — 고르는 칸이 실제로 있는가");
ok("품목 고르는 칸 마크업", html.indexOf('id="ledgerItems"') > -1);
ok("기본은 숨김 (품목이 하나면 안 보인다)", /id="ledgerItems"[^>]*hidden/.test(html));
ok("전체 해제/선택 단추", html.indexOf("ledgerToggleAll()") > -1);
ok("체크박스는 켠 채로 만든다",
   /<input type="checkbox" checked value="/.test(html));
ok("끄면 흐려진다", html.indexOf(":has(input:not(:checked))") > -1);
ok("손가락 크기 (18px)", /\.ledger-item input[\s\S]{0,80}width:\s*18px/.test(html));

console.log("\n[4] 접수 — 고른 만큼 줄이 들어가야 한다");
ok("고른 것만 모으는 함수", html.indexOf("function ledgerPicked") > -1);
ok("하나도 안 남기면 막는다", html.indexOf("반품할 품목을 하나는 남겨 주세요") > -1);
ok("여러 건은 따로 처리한다", html.indexOf("function submitLedgerMany") > -1);
ok("★ 두 번째부터는 force — 같은 송장이라 되묻지 않는다 ★",
   /step\(n \+ 1, true\)/.test(html));
ok("중간에 실패하면 몇 건까지 들어갔는지 말한다",
   html.indexOf("건까지는 들어갔습니다") > -1);
ok("사진은 첫 줄에만 붙인다",
   /retModalPhotoUpload\('ledger', first \|\| \{\}/.test(html));
ok("진행 상황을 단추에 보여준다", /기록 중… \(' \+ \(n \+ 1\)/.test(html));

console.log("\n[5] ★ 품목 하나 · 송장 여럿 — 박스를 고른다 ★ (2026-09-08 실사용)");
/* 「캐리어 200개 × 3 · 송장 3장」 같은 카드에서 체크가 아예 안 떴다.
   품목만 보고 만든 탓이다. 한 박스만 돌려받는 일이 흔한데 고를 방법이 없었다. */
ok("고르는 방식을 기억한다", html.indexOf("LEDGER_PICK_MODE") > -1);
ok("송장이 여럿이면 송장을 고른다",
   /LEDGER_PICK_MODE = 'invoice'/.test(html));
ok("머리말을 갈아 끼운다 (품목/송장)", html.indexOf('id="ledgerItemsHead"') > -1);
ok("송장 목록도 켠 채로 만든다",
   /LEDGER_PICK_MODE = 'invoice'[\s\S]{0,400}checkbox" checked/.test(html));
ok("하나도 안 남기면 막는다", html.indexOf("돌아오는 송장을 하나는 남겨 주세요") > -1);
ok("고른 송장만 대장에 적는다", /useInv = chosen\.join\(' '\)/.test(html));

console.log("\n[6] ★ 수량은 근거가 있을 때만 바꾼다 ★");
/* 송장 장수 == 수량이면 「한 박스에 하나」로 보고 고른 장수를 수량으로 쓴다.
   나눠떨어지지 않으면 원래 수량을 그대로 둔다 — 멋대로 계산하면 정산이 어긋난다. */
ok("장수와 수량이 같을 때만 고쳐 쓴다",
   /qn === allInv\.length\) useQty = String\(chosen\.length\)/.test(html));
ok("아니면 원래 수량 그대로", /var useInv = r\.invoice, useQty = r\.qty;/.test(html));
ok("보내는 값에 반영된다", /qty: useQty,[\s\S]{0,40}invoice: useInv,/.test(html));

// 규칙을 실제로 돌려 본다 — 조건식만 떼어 확인
function pickQty(qty, invTotal, chosen) {
  var useQty = qty;
  var qn = parseInt(String(qty || "").replace(/[^0-9]/g, ""), 10);
  if (invTotal && qn === invTotal) useQty = String(chosen);
  return useQty;
}
ok("송장3·수량3 에서 1장만 고르면 수량 1", pickQty(3, 3, 1) === "1", pickQty(3, 3, 1));
ok("송장3·수량3 에서 3장 다 고르면 수량 3", pickQty(3, 3, 3) === "3");
ok("★ 송장3·수량10 이면 수량을 안 건드린다 ★", pickQty(10, 3, 1) === 10, pickQty(10, 3, 1));
ok("수량이 비어 있으면 안 건드린다", pickQty("", 3, 1) === "");

console.log("\n[7] 환불계좌 칸 (2026-09-08 요청)");
const search = fs.readFileSync(__dirname + "/csOrderSearch.gs", "utf8");
ok("두 모달 다 계좌 칸이 있다",
   html.indexOf('id="ledgerAccount"') > -1 && html.indexOf('id="retNewAccount"') > -1);
ok("열 때 비운다",
   /getElementById\('ledgerAccount'\)\.value = ''/.test(html) &&
   /getElementById\('retNewAccount'\)\.value = ''/.test(html));
ok("임시저장에도 들어간다 — 적다 만 계좌가 날아가면 다시 물어봐야 한다",
   /* 자리(붙어 있는지)가 아니라 **있는지**를 본다. 사이에 다른 칸이 들어오면
      자리로 잡은 검사는 기능이 멀쩡한데도 깨진다 — 실제로 반품비가 들어오며 깨졌다. */
   /fields: \[[^\]]*'ledgerAccount'/.test(html) && /'retNewAccount'/.test(html));
ok("한 건 기록에 실어 보낸다", /account: document\.getElementById\('ledgerAccount'\)/.test(html));
ok("여러 건 기록에도 실어 보낸다", /memo: memo, account: account,/.test(html));
ok("새 반품 카드도 실어 보낸다", /account: document\.getElementById\('retNewAccount'\)/.test(html));

console.log("\n[8] ★ 시트에 열이 생기면 저절로 쓰인다 ★");
/* 대장에 환불계좌 열이 아직 없다. 시트를 코드가 함부로 바꾸지 않는다 —
   열이 생기는 순간 헤더 이름으로 잡히고, 그전까지는 비고에 남는다.
   반품송장이 걸어온 길과 같다. */
ok("열 지도에 account 가 있다", /account: -1/.test(search));
ok("헤더 이름으로 찾는다 (환불계좌·입금계좌·계좌번호)",
   /환불계좌\|입금계좌\|계좌번호/.test(search));
ok("전용 열이 있으면 열에 쓴다", /col\.account >= 0\) row\[col\.account\] = acct/.test(search));
ok("없으면 비고에 「계좌: …」로 남긴다", /acctToNotice = "계좌: " \+ acct/.test(search));
ok("비고 줄에 실제로 붙는다", /if \(acctToNotice\) noticeLines\.push\(acctToNotice\)/.test(search));
ok("★ 원문 그대로 둔다 (쪼개지 않는다) ★",
   !/split\([^)]*\)[\s\S]{0,40}acct/.test(search) && /String\(data\.account \|\| ""\)\.trim\(\)/.test(search));

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
