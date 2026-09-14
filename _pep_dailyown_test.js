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
check("★ 자사출고 = 로젠 + 롯데",
  push.includes("result.detail.lotte = _lotteCount_ + _lozenCount_;"), true);
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
const ctx = {};
vm.createContext(ctx);
vm.runInContext(grab("_pep_mapCarrierCols_"), ctx);
const 맵 = (h) => ctx._pep_mapCarrierCols_(h);

//  09/14 에 실제로 읽힌 꼴 — 머리글 1행, 주문번호 J(9)·운송장 K(10)
const 로젠1행 = ["번호", "", "", "", "", "", "수하인", "", "", "주문번호", "운송장번호", "",
  "수하인 전화", "물품명", "", "등록일자"];
check("★ 로젠(1행) 이름은 G(6) — 이름으로 찾는다", 맵(로젠1행).name, 6);
check("★ 로젠(1행) 전화는 M(12) — 고정표의 J(9)가 아니다", 맵(로젠1행).phone, 12);
check("★ 로젠(1행) 날짜는 P(15) — 고정표의 AL(37)이 아니다", 맵(로젠1행).date, 15);

//  44칸 「주문등록_출력」 양식 — _PT_ROZEN_FIXED_COL 이 가리키던 그것
const 로젠44 = ["", "", "", "운송장번호", "", "내품수량", "수하인", "", "", "수하인 전화",
  "", "", "", "", "물품명", "", "", "", "주문번호"];
check("로젠(44칸) 이름 G(6)", 맵(로젠44).name, 6);
check("로젠(44칸) 전화 J(9)", 맵(로젠44).phone, 9);
check("★ 로젠(44칸)엔 날짜 칸이 없다 — 없으면 «없다»", 맵(로젠44).date, undefined);

const 롯데 = ["", "", "", "집하일자", "", "수하인명", "운송장번호", "", "", "주문번호"];
check("롯데 집하일자 D(3)", 맵(롯데).date, 3);
check("롯데 수하인명 F(5)", 맵(롯데).name, 5);

check("★ 모르는 탭이면 아무것도 안 집는다", 맵(["가", "나", "다"]), {});

check("★ 머리글을 찾았으면 나머지 칸도 이름으로 찾는다",
  push.includes("이름표 = _pep_mapCarrierCols_(hv);") &&
  push.includes('var nameIdx = 뽑기("name", 편.col.name);'), true);
check("★ 이름을 못 찾으면 이름 열쇠를 «안 만든다» (row[0] 을 이름 삼지 않는다)",
  push.includes("if (nameIdx >= 0) {") && !push.includes("row[nameIdx >= 0 ? nameIdx : 0]"), true);
check("★ 고른 칸을 전부 적는다 (이름·전화·날짜까지)",
  push.includes('" 전화=" + 자리글(phoneIdx) +') && push.includes('" 날짜=" + 자리글(dateIdx) +'), true);
check("★ 못 찾은 칸은 「-」로 눈에 띈다",
  push.includes('var 자리글 = function (i) { return i >= 0 ? _pep_colLetter_(i) : "-"; };'), true);

console.log("\n[탭 상태] 「없다」와 「비었다」를 가른다");
check("★ 탭을 못 찾으면 GID 를 적는다",
  push.includes('result.detail[편.키 + "Cols"] = "탭을 못 찾음 (GID " + 편.gid + ")";'), true);
check("★ 비었으면 탭 이름을 적는다",
  push.includes('"탭은 있는데 비었음 (" + tab.getName() + ")"'), true);
check("★ 뭉뚱그린 「없음/비어있음」이 사라졌다",
  push.includes("송장탭 없음/비어있음"), false);

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
