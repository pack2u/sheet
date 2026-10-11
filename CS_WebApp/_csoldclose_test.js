/**
 * csOldReturnClose.gs 시험 — ★안 쓰는 조건★ 을 잰다.
 *
 * 이 파일은 반품관리대장에 591줄을 «쓴다». 그리고 쓰는 칸은 옛 탭의 A열인데,
 * 그 자리에서 이미 사고가 났다(10/01 에 7줄이 접수날짜를 잃었다).
 * 그러니 여기서 재야 할 것은 「잘 쓰나」가 아니라 ★「안 써야 할 때 안 쓰나」★다.
 *
 * 돌리기:  node _csoldclose_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const 소스 = fs.readFileSync(path.join(__dirname, "csOldReturnClose.gs"), "utf8");
const 조회 = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");

let 실패 = 0;
function 같나(이름, 받은것, 바란것) {
  if (받은것 === 바란것) { console.log("  ✔ " + 이름); return; }
  console.log("  ✘ " + 이름 + " — 바란 것 「" + 바란것 + "」 받은 것 「" + 받은것 + "」");
  실패++;
}

/* ── ① 적는 낱말이 «완료로 읽히나» ───────────────────────────────────
     ★ 이것이 틀리면 591줄을 고쳐 놓고 아무것도 안 끝난다 ★
     처음에 「묵은건-종결」로 적으려 했는데 그 낱말은 완료로 안 읽힌다.
     판정 함수를 그대로 떼어 와서 실제로 걸리는지 본다 — 「완료로 시작하니까
     되겠지」로 두면 그 함수가 바뀌는 날 조용히 깨진다.                 */
function 떼기(src, 이름) {
  const 시작 = src.indexOf("function " + 이름 + "(");
  if (시작 < 0) throw new Error(이름 + " 못 찾음");
  let i = src.indexOf("{", 시작), 깊이 = 0, 따옴 = "";
  for (; i < src.length; i++) {
    const ch = src[i];
    if (따옴) { if (ch === "\\") i++; else if (ch === 따옴) 따옴 = ""; continue; }
    if (ch === '"' || ch === "'") { 따옴 = ch; continue; }
    if (ch === "{") 깊이++;
    else if (ch === "}") { 깊이--; if (!깊이) break; }
  }
  return src.slice(시작, i + 1);
}
// eslint-disable-next-line no-eval
const _cs_isReturnDoneMark_ = eval(
  "(function(){" + 떼기(조회, "_cs_isReturnDoneMark_") + "return _cs_isReturnDoneMark_;})()");
const 낱말 = (소스.match(/_ORC_MARK_ = "([^"]+)"/) || [])[1];

console.log("── 적는 낱말이 완료로 읽히나 ──");
같나("낱말을 찾았다 (" + 낱말 + ")", !!낱말, true);
같나("★ 그 낱말이 완료로 읽힌다 ★", _cs_isReturnDoneMark_(낱말), true);
/*  왜 「묵은건-종결」을 안 쓰는지 여기 박아 둔다 — 누가 되돌리면 울어야 한다 */
같나("「묵은건-종결」 그대로는 완료로 안 읽힌다(그래서 안 쓴다)",
  _cs_isReturnDoneMark_("묵은건-종결"), false);
같나("낱말 안에 사장님이 정한 말이 남아 있다", /묵은건/.test(낱말 || ""), true);

/* ── ② 안 써야 할 때 안 쓰나 (코드로 잰다) ─────────────────────────── */
console.log("── ★ 안 써야 할 때 안 쓰나 ★ ──");
/*  이미 끝난 건을 또 덮으면 이력이 지워진다 */
같나("이미 완료된 줄은 건너뛴다",
  /_cs_isReturnLedgerDone_\([\s\S]{0,40}continue;/.test(소스), true);
/*  반품송장이 붙은 줄은 수거가 돌던 건이다 — 사람이 봐야 한다 */
같나("반품송장이 붙은 줄은 건너뛴다",
  /if \(송장\) \{ 송장있음\+\+; continue; \}/.test(소스), true);
/*  ★★ 여기서 한 번 틀렸다 ★★  (2026-10-11 · 마른 돌리기가 잡아 줬다)
      col.invoice       = /원송장|송장번호/ (반품송장 제외) → ★원주문★ 송장
      col.returnInvoice = /반품송장|회수송장/              → 반품 송장
    col.invoice 를 봤더니 원주문 송장은 거의 다 차 있어서 1,083줄이 통째로
    건너뛰어졌다. 591 을 찾아야 하는데 9줄만 나왔다.
    ★마른 돌리기를 먼저 돌린 덕에 쓰기 전에 잡았다★                    */
같나("★ 반품송장은 col.returnInvoice 로 본다 ★",
  /row\[col\.returnInvoice\]/.test(소스), true);
같나("원주문 송장(col.invoice)을 반품송장으로 읽지 않는다",
  /row\[col\.invoice\]/.test(소스), false);
같나("반품송장 칸을 못 찾으면 그 탭을 건너뛴다",
  /col\.returnInvoice < 0[\s\S]{0,60}break;/.test(소스), true);

/*  ★ 옛 값을 데려간다 ★ 옛 탭 상태 칸에 업체코드가 든 줄이 있다
    (「뉴파츠」·「태양」·「아주팩」). 덮으면 그 정보가 사라진다.          */
같나("옛 값이 있으면 괄호로 데려간다",
  /_ORC_MARK_ \+ "\(" \+ 상태 \+ "\)"/.test(소스), true);
같나("데려간 꼴도 완료로 읽힌다",
  _cs_isReturnDoneMark_(낱말 + "(뉴파츠)"), true);
같나("쓸 때 적을말을 쓴다", /setValue\(y\.적을말/.test(소스), true);
/*  되돌림이 괄호 붙은 것도 알아봐야 한다 — 같은지로 보면 못 알아본다 */
같나("되돌림은 낱말로 «시작하는지»로 본다",
  /지금\.indexOf\(_ORC_MARK_\) !== 0/.test(소스), true);
/*  이름도 품목도 없는 줄은 반품이 아니다(안내문·빈 줄) */
같나("빈 줄·안내문 줄은 건너뛴다",
  /if \(!이름칸 && !품목칸\) continue;/.test(소스), true);
/*  ★ 날짜 빈 줄은 기본으로 안 넣는다 ★ 사장님이 591 이라 하셨다 */
같나("접수날짜 빈 줄은 기본으로 안 넣는다",
  /if \(!날짜없는것도\) continue;/.test(소스), true);
/*  ★ A열을 못 박지 않는다 ★ 그 자리에서 사고가 났다 */
같나("상태 칸을 _cs_mapReturnLedgerCols_ 로 찾는다",
  /_cs_mapReturnLedgerCols_\(/.test(소스), true);
같나("상태 칸을 못 찾으면 그 탭을 건너뛴다",
  /col\.status < 0.*상태칸못찾음|상태칸못찾음[\s\S]{0,40}continue/.test(소스), true);
같나("A열을 숫자로 못 박은 자리가 없다",
  /getRange\(\s*\w+\s*,\s*1\s*\)\.setValue/.test(소스), false);

/* ── ③ 이번 달·살아 있는 달을 건드리지 않나 ─────────────────────────── */
console.log("── 닫는 달이 지난 달뿐인가 ──");
const 탭들 = (소스.match(/_ORC_TABS_ = \[([^\]]+)\]/) || [])[1] || "";
같나("202601~202607 일곱 달만 닫는다",
  (탭들.match(/"20260[1-7]"/g) || []).length, 7);
/*  ★ 이번 달(202610)·지난달(202608·202609)이 섞이면 살아 있는 건을 닫는다 ★ */
같나("202608 은 없다", /"202608"/.test(탭들), false);
같나("202609 는 없다", /"202609"/.test(탭들), false);
같나("202610 은 없다", /"202610"/.test(탭들), false);

/* ── ④ 되돌릴 수 있나 ───────────────────────────────────────────── */
console.log("── 되돌릴 수 있나 ──");
같나("쓰기 전에 백업 탭을 만든다",
  /insertSheet\(_ORC_BACKUP_PREFIX_/.test(소스), true);
/*  10/01 사고가 ★날짜를 잃은★ 사고였다 — 날짜도 같이 담는다 */
같나("백업에 옛 날짜도 담는다", /"옛날짜"/.test(소스), true);
같나("되돌리는 함수가 있다", /function csOldReturnCloseUndo/.test(소스), true);
/*  ★ 사람이 그 사이에 넣은 값을 덮으면 안 된다 ★ */
/*  처음엔 옛 모양(`!== _ORC_MARK_`)을 못 박아 뒀는데, 괄호로 옛 값을
    데려가게 고치면서 이 줄이 울었다. 뜻은 위 「낱말로 시작하는지로 본다」가
    든다. 여기서는 ★남의 값을 덮지 않는지★ 만 본다 — 지금 값을 보고
    건너뛰는 길이 있나.                                                 */
같나("되돌릴 때 지금 값을 보고 건너뛴다",
  /getDisplayValue\(\)[\s\S]{0,160}건너뜀\+\+; continue;/.test(소스), true);

/* ── ⑤ 마른 돌리기가 정말 안 쓰나 ───────────────────────────────── */
console.log("── 마른 돌리기가 아무것도 안 쓰나 ──");
const 마른 = 소스.slice(소스.indexOf("function csOldReturnCloseDryRun()"),
                       소스.indexOf("function csOldReturnCloseDryRunWithUndated"));
같나("마른 돌리기에 setValue 가 없다", /setValue/.test(마른), false);
같나("마른 돌리기에 insertSheet 가 없다", /insertSheet/.test(마른), false);
const 훑기 = 소스.slice(소스.indexOf("function _orc_scan_"), 소스.indexOf("function _orc_report_"));
같나("훑는 함수에 setValue 가 없다", /setValue/.test(훑기), false);
같나("훑는 함수에 insertSheet 가 없다", /insertSheet/.test(훑기), false);

/* ── ⑥ 한 칸씩 쓰나 ─────────────────────────────────────────────── */
console.log("── 한 칸씩 쓰나 (범위로 덮지 않나) ──");
/*  범위로 쓰면 사이에 끼인 안내문·빈 줄까지 덮는다 */
같나("setValues(복수)로 대장을 덮는 자리가 없다",
  /getSheetByName\([^)]*\)\.getRange\([^)]*\)\.setValues/.test(소스), false);
같나("한 칸 setValue 로 쓴다",
  /getRange\(y\.행, y\.상태칸\)\.setValue\(/.test(소스), true);

console.log(실패 ? "\n✘ " + 실패 + "개 틀렸습니다" : "\n✔ 다 맞았습니다");
process.exit(실패 ? 1 : 0);
