/**
 * 진행 단계가 두 화면에서 «같은가» — CS 웹앱 vs 협력업체 포털.
 *
 * ★ 왜 이 시험이 있나 ★  (2026-09-11)
 *   > "반품현황에 상태값이 우리 웹앱 반품카드 상황과 안맞고
 *      서로 같이 반응도 안되"
 *
 *   CS 가 상태를 넷으로 줄이면서 「반품송장」을 새로 썼는데, 포털은 옛 일곱
 *   단계 낱말로만 찾고 있었다. 「반품송장」이 어디에도 안 걸려 폴백 0(접수)로
 *   떨어졌다 — CS 는 회수 송장을 냈는데 업체 화면은 계속 접수였다.
 *   오류가 아니라 폴백이라 아무도 몰랐다.
 *
 *   규칙이 두 파일에 따로 적혀 있는 한 또 갈라진다. 그래서 여기서 «맞대 본다».
 *   손으로 옮겨 적지 않고 두 파일에서 함수를 그대로 꺼내 쓴다 —
 *   옮겨 적으면 시험이 코드가 아니라 내 기억을 검사하게 된다.
 *
 * 실행: node Partner_WebApp/_prpstage_test.js  (어느 자리에서 불러도 된다)
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 안 올라간다)
 */
var fs = require("fs");
var path = require("path");
/* 어디서 부르든 같은 파일을 본다 — 뿌리에서 돌려도 깨지지 않게 */
var 뿌리 = path.join(__dirname, "..");
var 곳 = function (p) { return path.join(뿌리, p); };

function 꺼내기(src, 이름) {
  var i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 못 찾음");
  var 깊이 = 0, 시작 = src.indexOf("{", i);
  for (var k = 시작; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (!깊이) return src.substring(i, k + 1); }
  }
  throw new Error(이름 + " 끝 못 찾음");
}
eval(꺼내기(fs.readFileSync(곳("CS_WebApp/csOrderSearch.gs"), "utf8"), "_cs_returnStage_"));
eval(꺼내기(fs.readFileSync(곳("Partner_WebApp/portal.html"), "utf8"), "stepIndex"));

/* CS 는 active(진행중) 를, 포털은 done(완료) 를 받는다 — 서로 반대다 */
function 대장완료(s) {
  var t = String(s || "").replace(/\s/g, "");
  if (t === "완료" || t.indexOf("완료") === 0) return true;
  return /이카운트\s*ok/i.test(String(s || ""));
}

var 시험 = [
  "접수", "반품송장", "입고검수", "이카운트OK",          // 지금 쓰는 넷
  "수거요청", "수거중", "반품입고", "입고", "환불처리", "완료",  // 옛 낱말
  "", "처리중"
];
var 실패 = 0;
console.log("상태          CS   포털");
시험.forEach(function (s) {
  var done = 대장완료(s);
  var cs = _cs_returnStage_(s, !done);
  var pt = stepIndex(s, done);
  var ok = cs === pt;
  if (!ok) 실패++;
  var 이름 = (s || "(빈칸)");
  while (이름.length < 12) 이름 += " ";
  console.log((ok ? "  " : "★ ") + 이름 + cs + "    " + pt + (ok ? "" : "   ← 어긋남"));
});
/* 철회는 포털만 따로 -1 로 빼 놓는다 (업체에게 「철회된 건」이라고 알린다) */
console.log("");
console.log("철회 → 포털 " + stepIndex("철회", false) + " (-1 이면 별도 안내)");
console.log("");
console.log(실패 ? "★ 어긋남 " + 실패 + "건" : "두 화면이 같은 단계를 말한다");
process.exit(실패 ? 1 : 0);
