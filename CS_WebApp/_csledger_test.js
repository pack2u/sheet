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

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
