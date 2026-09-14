/**
 * 로컬 검증: 일일마감의 자사출고 송장원
 *
 *  > "니말대로라면 상품정보의 롯데 송장이 아닌 로젠으로 연결시켜
 *  >  일일 마감을 다시 해보는게 맞는거 같은데?"
 *
 *  통합 일일마감은 자사출고 송장을 「롯데 탭」에서만 읽고 있었다.
 *  2026-09-11 에 로젠으로 갈아탄 뒤로 그 탭에는 새 송장이 안 쌓인다.
 *  오류는 안 났다. 그냥 0 에 가까워졌고, 미매칭이 475건이 됐다.
 *
 *  지켜야 할 것
 *    · 로젠과 롯데를 «둘 다» 읽는다 — 갈아탄 날 앞뒤가 빠지면 안 된다
 *    · 머리글은 이름으로 찾는다 (로젠 탭은 머리글이 2행)
 *    · 몇 줄을 읽었는지 늘 말한다 — 0 이면 그 자리에서 보여야 한다
 *    · 화면의 「롯데 송장」은 이제 「자사출고 송장」이고 로젠을 포함한다
 *
 * 실행: node _pep_dailyown_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const push = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
const web = fs.readFileSync("_partnerWebApp.gs", "utf8");
const diag = fs.readFileSync("_partnerUnmatchedDiag.gs", "utf8");
const help = fs.readFileSync("_partnerHelpers.gs", "utf8");

console.log("\n[일일마감] 자사출고 송장원이 둘인가");
check("★ 자사출고 로더가 있다",
  push.includes("function _pep_loadOwnCarrierInvoices_(invoiceMap, result) {"), true);
check("★ 마감이 그것을 부른다",
  push.includes("_pep_loadOwnCarrierInvoices_(invoiceMap, result);"), true);
check("★ 로젠을 먼저 읽는다 (지금 쓰는 택배사)",
  push.indexOf('이름: "로젠"') < push.indexOf('이름: "롯데"'), true);
check("★ 롯데도 읽는다 (9/10 까지의 옛 건)",
  push.includes('이름: "롯데"') && push.includes("_PT_SECONDARY_INVOICE_GID"), true);
check("★ 「로젠은 안 쓴다」던 옛 줄이 사라졌다",
  push.includes("일일마감 송장 소스로 사용하지 않음"), false);
check("★ 옛 롯데 전용 블록도 사라졌다",
  push.includes("var lotteSrcTab = _pt_getSheetByGid(invSS, _PT_SECONDARY_INVOICE_GID);"), false);

console.log("\n[일일마감] 머리글을 «찾는가»");
check("★ 이름으로 먼저 찾는다",
  push.includes("_po_findInvoiceHeader_(tab)"), true);
check("★ 못 찾으면 정해진 자리로 (로젠은 _PT_ROZEN_FIXED_COL)",
  push.includes("? _PT_ROZEN_FIXED_COL"), true);
check("★ 어느 쪽으로 갔는지 남긴다",
  push.includes('var 어떻게 = H.row ? ("머리글 " + H.row + "행") : "고정자리";'), true);
check("★ 로젠 머리글은 2행이다 (고정자리일 때 2행부터)",
  push.includes("var from = H.row ? H.row + 1 : 2;"), true);
check("★ 긴 숫자가 지수로 깨지지 않게 화면값을 읽는다",
  push.includes("getDisplayValues()"), true);

console.log("\n[일일마감] 읽은 것을 말하는가");
check("★ 탭별로 몇 줄 읽었는지 남긴다",
  push.includes('result.detail[편.키 + "Read"] = nInv;'), true);
check("★ 어느 칸을 골랐는지도 남긴다",
  push.includes('result.detail[편.키 + "Cols"] = 칸글;'), true);
check("★ detail 초기값에 자리가 있다",
  push.includes('rozenRead: 0, rozenCols: ""'), true);
check("★ 탭이 없거나 터져도 나머지 탭은 읽는다",
  push.includes('읽음.push(편.이름 + " 오류");'), true);

console.log("\n[일일마감] 화면 숫자가 진실을 말하는가");
check("★ 자사출고 = 로젠 + 롯데 + 1주출고 + 합포장",
  push.includes("result.detail.lotte = _lotteCount_ + _lozenCount_ + _weeklyCount_ + _packSrcCount_;"), true);
check("★ 갈라 본 값도 남긴다",
  push.includes("result.detail.rozenMatched = _lozenCount_;") &&
  push.includes("result.detail.lotteMatched = _lotteCount_;"), true);
check("★ 알림이 「자사출고 송장」이라고 부른다",
  web.includes('" └ 자사출고 송장: "'), true);
check("★ 「롯데 송장」이라는 옛 이름표가 사라졌다",
  web.includes('" └ 롯데 송장: " + (result.detail.lotte || result.detail.lozen || 0)'), false);
check("★ 로젠 0건이면 경고가 뜬다",
  web.includes("⚠ 로젠탭 송장 0건 — 탭/열 확인 필요"), true);
check("★ 읽은 탭을 화면에 적는다",
  web.includes('"    읽은 탭: " + (result.detail.ownTabs || "(없음)")'), true);

console.log("\n[진단 도구] 표가 거짓이면 진단도 거짓이다");
check("★ 로젠이 usedByDaily:true 가 됐다",
  diag.includes('{ key: "로젠",            usedByDaily: true },'), true);
check("★ 옛 false 가 사라졌다",
  diag.includes('{ key: "로젠",            usedByDaily: false },'), false);
check("★ 칸 자리를 _PT_ROZEN_FIXED_COL 에서 가져온다",
  diag.includes("? _PT_ROZEN_FIXED_COL"), true);
check("★ 옛 로젠 양식 숫자가 사라졌다",
  diag.includes("{ name: 9, phone: 12, invoice: 5, uid: 4 }, 1)"), false);

console.log("\n[상수] 자리는 한 군데에만 적는다");
check("_PT_ROZEN_FIXED_COL 이 있다", help.includes("var _PT_ROZEN_FIXED_COL = {"), true);
check("로젠 운송장 = D열(3)", /invoice:\s*3,/.test(help.slice(help.indexOf("_PT_ROZEN_FIXED_COL"), help.indexOf("_PT_ROZEN_FIXED_COL") + 700)), true);
check("로젠 주문번호 = S열(18)", /uid:\s*18,/.test(help.slice(help.indexOf("_PT_ROZEN_FIXED_COL"), help.indexOf("_PT_ROZEN_FIXED_COL") + 700)), true);

console.log("\n[칸 찾기] 반은 이름 반은 자리로 읽지 않는다");
const vm = require("vm");
function grab(n) {
  const s = push.indexOf("function " + n + "(");
  let d = 0, seen = false;
  for (let i = s; i < push.length; i++) {
    if (push[i] === "{") { d++; seen = true; }
    else if (push[i] === "}") { d--; if (seen && d === 0) return push.slice(s, i + 1); }
  }
}
function grabArr(n) {
  const a = push.indexOf("var " + n + " = [");
  let d = 0;
  for (let i = push.indexOf("[", a); i < push.length; i++) {
    if (push[i] === "[") d++;
    else if (push[i] === "]") { d--; if (d === 0) return push.slice(a, i + 1) + ";"; }
  }
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext([grabArr("_PEP_CARRIER_COL_RULES_"), grabArr("_PEP_CARRIER_WEAK_NAME_"),
  grab("_pep_mapCarrierCols_")].join("\n"), ctx);
const 맵 = (h) => ctx._pep_mapCarrierCols_(h);
const 줄 = (o) => { const a = []; Object.keys(o).forEach((k) => { a[+k] = o[k]; }); return a; };

check("★ 머리글을 찾았으면 나머지 칸도 이름으로 찾는다",
  push.includes("이름표 = _pep_mapCarrierCols_(hv);") &&
  push.includes('var nameIdx = 뽑기("name", 편.col.name);'), true);
check("★ 이름을 못 찾으면 이름 열쇠를 «안 만든다» (row[0] 을 이름 삼지 않는다)",
  push.includes("if (nameIdx >= 0) {") && !push.includes("row[nameIdx >= 0 ? nameIdx : 0]"), true);

console.log("\n[칸 찾기] 로젠의 「명」은 둘이다 — 뒤엣것이 수하인");
{
  //  09/14 두 번째 판: 이름=O 로 «첫» 「명」이 걸렸다. 세트분리 _ssf_freeCols_ 는
  //  진작부터 «마지막»을 쓰고 있었다. 같은 규칙으로 맞춘다.
  check("★ 「명」이 둘이면 마지막을 쓴다", 맵(줄({ 9: "주문번호", 10: "운송장번호", 14: "명", 20: "명" })).name, 20);
  check("★ 강한 이름이 있으면 그것이 이긴다",
    맵(줄({ 14: "명", 16: "수하인명", 20: "명" })).name, 16);
  check("「명」이 하나면 그것", 맵(줄({ 14: "명" })).name, 14);
  check("이름이 아예 없으면 없다", 맵(줄({ 9: "주문번호" })).name, undefined);
}

console.log("\n[칸 찾기] 날짜는 «보낸 날»만 쓴다");
{
  //  09/14 두 번째 판: 날짜=D 가 걸리면서 로젠 매칭이 46 → 24 로 떨어졌다.
  //  날짜를 잘못 집으면 「주문일보다 이른 송장」으로 걸러진다.
  check("★ 등록일자는 날짜가 아니다", 맵(줄({ 3: "등록일자" })).date, undefined);
  check("★ 파일명도 날짜가 아니다", 맵(줄({ 5: "파일명" })).date, undefined);
  check("집하일자는 날짜다", 맵(줄({ 3: "집하일자" })).date, 3);
  check("발송일자도 날짜다", 맵(줄({ 7: "발송일자" })).date, 7);
  check("출고일자도 날짜다", 맵(줄({ 2: "출고일자" })).date, 2);
}

console.log("\n[칸 찾기] 나머지");
{
  const 로젠44 = 줄({ 3: "운송장번호", 6: "수하인", 9: "수하인 전화", 14: "물품명", 18: "주문번호" });
  check("로젠(44칸) 이름 G(6)", 맵(로젠44).name, 6);
  check("로젠(44칸) 전화 J(9)", 맵(로젠44).phone, 9);
  check("★ 로젠(44칸)엔 보낸 날 칸이 없다", 맵(로젠44).date, undefined);
  const 롯데 = 줄({ 3: "집하일자", 5: "수하인명", 6: "운송장번호", 9: "주문번호", 28: "상품명" });
  check("롯데 집하일자 D(3)", 맵(롯데).date, 3);
  check("롯데 수하인명 F(5)", 맵(롯데).name, 5);
  check("롯데 상품명 AC(28)", 맵(롯데).item, 28);
  check("★ 모르는 탭이면 아무것도 안 집는다", 맵(["가", "나", "다"]), {});
}

console.log("\n[말하기] 무엇을 집었는지 «이름째로» 말한다");
{
  vm.runInContext([grab("_pep_colLetter_"), grab("_pep_colDesc_")].join("\n"), ctx);
  const hv = 줄({ 9: "주문번호", 10: "운송장번호", 20: "명" });
  check("★ 이름(자리) 꼴로 적는다", ctx._pep_colDesc_(hv, 10), "운송장번호(K)");
  check("★ 못 찾은 칸은 「-」", ctx._pep_colDesc_(hv, -1), "-");
  check("이름 없는 칸도 자리는 말한다", ctx._pep_colDesc_(hv, 5), "(이름없음)(F)");
  check("★ 보고에 이름이 들어간다",
    push.includes('"송장=" + _pep_colDesc_(hv, invIdx) +'), true);
  check("★ 자리만 찍던 옛 코드는 사라졌다",
    push.includes('var 자리글 = function (i) { return i >= 0 ? _pep_colLetter_(i) : "-"; };'), false);
  check("★ 머리글을 통째로 한 번 찍는다 (다음엔 안 물어보게)",
    push.includes('Logger.log("[UNIFIED] " + 편.이름 + " 머리글(" + H.row + "행): " +'), true);
}

console.log("\n[계측] 날짜 관문이 열려 있는지 한 줄로 안다");
check("★ 날짜가 붙은 줄 수를 센다", push.includes("if (picked) nDated++;"), true);
check("★ 보고에 [N/N줄] 로 적는다",
  push.includes("nDated + " ) && push.includes(" + nInv + "), true);
check("★ 날짜 칸이 없으면 그 표시도 없다 (0 을 0 으로 오해하지 않게)",
  push.includes("dateIdx >= 0 ?"), true);

console.log("\n[탭 상태] 「없다」와 「비었다」를 가른다");
check("★ 탭을 못 찾으면 GID 를 적는다",
  push.includes('result.detail[편.키 + "Cols"] = "탭을 못 찾음 (GID " + 편.gid + ")";'), true);
check("★ 비었으면 탭 이름을 적는다",
  push.includes('"탭은 있는데 비었음 (" + tab.getName() + ")"'), true);
check("★ 뭉뚱그린 「없음/비어있음」이 사라졌다",
  push.includes("송장탭 없음/비어있음"), false);


console.log("[진단 도구] 부를 데가 없으면 없는 것과 같다");
{
  const menu = fs.readFileSync("_partnerMenu.gs", "utf8");
  /*  ★ 진작부터 메뉴에 있었다 ★  (2026-09-14)
      나는 없는 줄 알고 하나 더 달았다가 되물렀다. grep 을
      「diagnoseUnmatched」로 걸어서 partnerDiagnose«Unified»Unmatched 를
      못 봤다. 「한 번만」이 이 시험의 요점이다 — 같은 항목이 두 곳에 있으면
      직원이 어느 쪽을 눌러야 하는지 매번 고민한다. */
  check("★ 미매칭 진단이 메뉴에 «한 번만» 있다",
    (menu.match(/일일마감 미매칭 원인 진단/g) || []).length, 1);
  check("★ 「🧭 송장 매칭 점검·정비」 아래에 있다",
    menu.slice(menu.indexOf("송장 매칭 점검·정비"), menu.indexOf("송장 매칭 점검·정비") + 900)
      .includes("partnerDiagnoseUnifiedUnmatched"), true);
  check("★ 그 함수가 실제로 있다",
    diag.includes("function partnerDiagnoseUnifiedUnmatched() {"), true);
  check("★ 읽기만 한다 (결과 탭만 만든다)",
    diag.includes("운영 데이터는 쓰지 않는다"), true);
}

console.log("[계측] 주문번호가 몇 줄에 있었나");
check("★ 주문번호 있는 줄 수를 적는다",
  push.includes("[\" + nUid + \"/\" + nInv + \"줄]"), true);


console.log("\n[스냅샷] 하루가 통째로 담기는가");
{
  //  09-10 507건 → 09-11 2건 → 09-12 29건 → 09-14 169건.
  //  미매칭이 많았던 게 아니라 «담긴 줄 자체»가 없었다. 「판매현황」은
  //  회차마다 지우고 붙이는 칸이라, Push 때 올라와 있던 한 회차만 담긴다.
  check("★ 그날 탭(MMDD판매현황)을 «먼저» 본다",
    push.includes("var 날탭 = String(날).slice(4) + \"판매현황\";"), true);
  check("★ 없으면 「판매현황」으로 떨어진다 (한 회차라도 담는다)",
    push.includes("result.읽은탭 = \"판매현황(한 회차분)\";"), true);
  check("★ 어느 탭을 읽었는지 돌려준다",
    push.includes("읽은탭: \"\""), true);
  check("★ 마감이 그 값을 detail 에 담는다",
    push.includes("result.detail.snapFrom = snapResult.읽은탭 || \"\";"), true);
  check("★ detail 초기값에 자리가 있다",
    push.includes("snapFrom: \"\", snapSaved: 0"), true);
  const web2 = fs.readFileSync("_partnerWebApp.gs", "utf8");
  check("★ 화면에 원천 탭을 적는다",
    web2.includes("├ 판매현황 원천: "), true);
  check("★ 한 회차만 담겼으면 «경고»한다",
    web2.includes("⚠ 그날 탭(MMDD판매현황)이 없어 한 회차만 담겼습니다"), true);
}


console.log("\n[이름] 뭉쳐 세면 숫자가 거짓말을 한다");
{
  //  「롯데 탭 0줄(빈 탭)」인데 화면엔 「롯데 143」이 떴다.
  //  _lotteCount_ 가 롯데·1주출고·합포장을 한 칸에 담고 있었기 때문이다.
  check("★ 롯데만 센다",
    push.includes("if (item.source === \"롯데\") _lotteCount_++;"), true);
  check("★ 1주출고는 따로 센다",
    push.includes("else if (item.source === \"1주출고\") _weeklyCount_++;"), true);
  check("★ 합포장도 따로 센다",
    push.includes("else if (item.source === \"합포장\") _packSrcCount_++;"), true);
  check("★ 뭉쳐 세던 옛 코드는 사라졌다",
    push.includes("/* 합포장은 롯데 계열 */ _lotteCount_++;"), false);
  check("★ 자사출고 합계는 넷을 다 더한다",
    push.includes("result.detail.lotte = _lotteCount_ + _lozenCount_ + _weeklyCount_ + _packSrcCount_;"), true);
  const web3 = fs.readFileSync("_partnerWebApp.gs", "utf8");
  check("★ 화면이 넷을 갈라 보여 준다",
    web3.includes("· 1주출고 ") && web3.includes("· 합포장 "), true);
}

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
