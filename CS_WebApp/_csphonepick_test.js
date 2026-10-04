/**
 * csOrderSearch.gs _cs_pickPhones_ — 걸 수 있는 번호가 앞에 오는가.
 *
 * ★ 왜 이 테스트가 있나 ★  (2026-09-11)
 *   > "쿠팡의 경우 안심번호라 기간이 지나면 연락이 안되"
 *
 *   같은 규칙이 세 곳에 있다 — 여기, 협력업체 포털(portal.html pickPhones),
 *   v2(lib/returns.ts pickPhones). 한쪽만 고치면 같은 반품 건이 화면마다
 *   다른 번호로 보인다. 그런 어긋남은 아무 오류도 안 낸다.
 *
 * 실행: node _csphonepick_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 안 올라간다)
 */
const fs = require("fs");

/* 파일에 «실제로 적힌» 함수만 꺼내 쓴다. 손으로 옮겨 적으면 진짜 코드가 아니다. */
const src = fs.readFileSync("csOrderSearch.gs", "utf8");
function 꺼내기(이름) {
  const i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 를 못 찾았다");
  let 깊이 = 0, 시작 = src.indexOf("{", i);
  for (let k = 시작; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (!깊이) return src.substring(i, k + 1); }
  }
  throw new Error(이름 + " 의 끝을 못 찾았다");
}
eval(꺼내기("_cs_isSafePhone_"));
eval(꺼내기("_cs_pickPhones_"));

let 실패 = 0;
function eq(설명, 받은, 바란) {
  const ok = JSON.stringify(받은) === JSON.stringify(바란);
  if (!ok) 실패++;
  console.log((ok ? "  통과 " : "★ 실패 ") + 설명 +
    (ok ? "" : "\n       got  " + JSON.stringify(받은) +
               "\n       want " + JSON.stringify(바란)));
}
const 짧게 = (r) => [r.main, r.mainTag, r.sub, r.subTag, r.onlySafe];
const 고르기 = (a, b) => 짧게(_cs_pickPhones_(a, b));

console.log("\n[_cs_pickPhones_] 걸 수 있는 번호를 앞에");

eq("실번호가 있으면 앞으로 — 안심번호는 곁에",
  고르기("0504-1234-5678", "010-9999-8888"),
  ["010-9999-8888", "", "0504-1234-5678", "안심", false]);

eq("실번호만 있으면 그것뿐",
  고르기("", "010-9999-8888"),
  ["010-9999-8888", "", "", "", false]);

eq("★ 안심번호뿐이면 «그렇다고 말한다» — 걸어 보고서야 알면 늦다",
  고르기("0504-1234-5678", ""),
  ["0504-1234-5678", "안심", "", "", true]);

eq("보통 번호뿐이면 딱지도 경고도 없다",
  고르기("010-1111-2222", ""),
  ["010-1111-2222", "", "", "", false]);

eq("둘 다 보통이면 나중에 받아 적은 쪽이 앞 — 주문서 것을 곁에",
  고르기("010-1111-2222", "010-3333-4444"),
  ["010-3333-4444", "", "010-1111-2222", "주문서", false]);

eq("같은 번호가 두 칸에 있으면 한 번만 보인다",
  고르기("010-1111-2222", "010-1111-2222"),
  ["010-1111-2222", "", "", "", false]);

eq("★ 실번호 칸에도 안심번호면 거꾸로 세우지 않는다",
  고르기("0504-1111-2222", "0503-3333-4444"),
  ["0504-1111-2222", "안심", "0503-3333-4444", "추가", true]);

eq("둘 다 비면 아무것도 없다", 고르기("", ""), ["", "", "", "", false]);

console.log("\n[_cs_isSafePhone_] 050 계열이 안심번호다");
eq("0504", _cs_isSafePhone_("0504-1234-5678"), true);
eq("0503", _cs_isSafePhone_("050312345678"), true);
eq("0507", _cs_isSafePhone_("0507-1-2"), true);
eq("010 은 아니다", _cs_isSafePhone_("010-1234-5678"), false);
eq("050 만으로는 아니다 (뒤 한 자리가 더 있어야)", _cs_isSafePhone_("050"), false);
eq("빈 값", _cs_isSafePhone_(""), false);

console.log(실패 ? "\n실패 " + 실패 + "건" : "\n전부 통과");
process.exit(실패 ? 1 : 0);
