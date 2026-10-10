/**
 * 주문송장조회 — 한 칸에 송장이 여럿일 때 찾아지나.
 *
 * 증상 (사장님, 2026-09-14 밤)
 *   > "롯데에서 로젠으로 바뀌면서 주문송장조회의 송장번호가 인식이 안 되고,
 *   >  이전 롯데 송장들은 숫자들이 붙어 버려"
 *
 * 원인 — 송장 칸을 「하나의 숫자」로 다뤘다. 한 칸에 둘이면 24자리 한 덩어리가
 * 되고, 그 덩어리는 어떤 한 장과도 같지 않으니 영영 안 걸린다.
 *
 * 돌리기:  node _csinvcell_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const 조회 = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");
const 본체 = fs.readFileSync(path.join(__dirname, "Code.gs"), "utf8");

/*  시트·네트워크를 안 건드리는 두 함수만 꺼내 돈다 */
function 떼기(소스, 이름) {
  const 시작 = 소스.indexOf("function " + 이름 + "(");
  if (시작 < 0) throw new Error(이름 + " 을 못 찾았습니다");
  //  중괄호를 세어 함수 끝을 찾는다
  let i = 소스.indexOf("{", 시작), 깊이 = 0, 따옴 = "";
  for (; i < 소스.length; i++) {
    const ch = 소스[i];
    if (따옴) { if (ch === "\\") i++; else if (ch === 따옴) 따옴 = ""; continue; }
    if (ch === '"' || ch === "'") { 따옴 = ch; continue; }
    if (ch === "{") 깊이++;
    else if (ch === "}") { 깊이--; if (!깊이) break; }
  }
  return 소스.slice(시작, i + 1);
}
// eslint-disable-next-line no-eval
const { _cs_invList_, _cs_invCellHas_ } = eval(
  "(function(){" + 떼기(조회, "_cs_invList_") + 떼기(조회, "_cs_invCellHas_") +
  "return { _cs_invList_: _cs_invList_, _cs_invCellHas_: _cs_invCellHas_ };})()"
);

let 실패 = 0;
function 같나(이름, 받은것, 바란것) {
  if (받은것 === 바란것) { console.log("  ✔ " + 이름); return; }
  console.log("  ✘ " + 이름 + " — 바란 것 「" + 바란것 + "」 받은 것 「" + 받은것 + "」");
  실패++;
}

/*  사장님이 말한 그 꼴 — 롯데 12자리 두 장이 줄바꿈으로 이어진 칸  */
const 두장 = "268334484434\n268334484445";

console.log("── ★ 사장님이 겪은 증상 ★ ──");
같나("둘째 송장으로 찾는다", _cs_invCellHas_(두장, "268334484445"), true);
같나("첫째 송장으로 찾는다", _cs_invCellHas_(두장, "268334484434"), true);
/*  옛 코드는 칸을 통째로 숫자만 남겨 24자리로 만들고 «같은지»로 견줬다.
    그 덩어리로는 못 찾는 것이 맞다 — 그게 결함의 모양이었다.           */
같나("붙어 버린 24자리로는 안 찾아진다(그게 옛 결함의 모양)",
  _cs_invCellHas_(두장, "268334484434268334484445"), false);

console.log("── 가르는 글자들 ──");
같나("공백으로 이어진 것 (2026-10-08 원장 실측)",
  _cs_invCellHas_("45330178666 45330178670", "45330178670"), true);
같나("쉼표", _cs_invCellHas_("268334484434,268334484445", "268334484445"), true);
같나("세미콜론", _cs_invCellHas_("268334484434;268334484445", "268334484434"), true);
같나("슬래시", _cs_invCellHas_("268334484434/268334484445", "268334484445"), true);
같나("파이프", _cs_invCellHas_("268334484434|268334484445", "268334484434"), true);
/*  ★ 하이픈은 가르지 않는다 ★ 허브에 "442-4720-4271" 꼴이 있다.
    하이픈으로 가르면 442·4720·4271 로 조각나 영영 안 걸린다.          */
같나("하이픈 표기를 한 장으로 본다",
  _cs_invCellHas_("442-4720-4271", "44247204271"), true);
같나("하이픈 표기를 하이픈 넣은 채로 찾아도 된다",
  _cs_invCellHas_("442-4720-4271", "442-4720-4271"), true);

console.log("── 로젠 11자리 ──");
같나("로젠 한 장", _cs_invCellHas_("45330179333", "45330179333"), true);
같나("로젠과 롯데가 섞인 칸",
  _cs_invCellHas_("45330179333 268334484434", "45330179333"), true);
/*  2026-10-08 실측: 복지관 한 주문에 로젠 송장 석 장 */
같나("로젠 석 장 중 가운데",
  _cs_invCellHas_("45330178666\n45330178670\n45330178681", "45330178670"), true);

console.log("── ★ 엉뚱한 것이 걸리면 안 된다 ★ ──");
같나("한 자리 다른 번호", _cs_invCellHas_("268334484434", "268334484435"), false);
/*  ★ 들어 있나(indexOf)로 보면 여기서 걸린다 ★ 남의 주문이 뜬다.
    가른 다음 «낱장과 같은지» 로 보는 까닭이다.                         */
같나("더 긴 번호 «안»에 들어 있어도 안 걸린다",
  _cs_invCellHas_("1268334484434", "268334484434"), false);
같나("앞에 붙은 꼴도 안 걸린다",
  _cs_invCellHas_("2683344844340", "268334484434"), false);
같나("빈 칸", _cs_invCellHas_("", "268334484434"), false);
같나("찾는 것이 비었다", _cs_invCellHas_(두장, ""), false);
같나("여덟 자리 밑은 안 본다", _cs_invCellHas_("1234567", "1234567"), false);
같나("칸이 null", _cs_invCellHas_(null, "268334484434"), false);

console.log("── 바코드 스캔 경로(Code.gs)가 이 함수를 쓰나 ──");
/*  ★ 여기가 고치려는 자리다 ★ 세 군데가 똑같이
        var rowInv = String(...).replace(/[^0-9]/g, "");
        if (rowInv === invDigits)
    로 견주고 있었다. 그 꼴이 하나라도 남아 있으면 그 탭은 여전히 못 찾는다.  */
const 덩어리로견주기 = /var rowInv = String\([^)]*\)[\s\S]{0,80}?replace\(\/\[\^0-9\]\/g, ""\)/g;
같나("칸을 덩어리로 만드는 자리가 없다",
  (본체.match(덩어리로견주기) || []).length, 0);
같나("세 탭 다 _cs_invCellHas_ 로 견준다",
  (본체.match(/_cs_invCellHas_\(/g) || []).length, 3);
/*  일일마감 쪽은 indexOf 로 보고 있었다 — 같은 꼴의 헛걸림이 생긴다 */
같나("일일마감 조회도 indexOf 를 안 쓴다",
  /String\(r\.invDigits \|\| ""\)\.indexOf\(needle\)/.test(조회), false);

console.log(실패 ? "\n✘ " + 실패 + "개 틀렸습니다" : "\n✔ 다 맞았습니다");
process.exit(실패 ? 1 : 0);
