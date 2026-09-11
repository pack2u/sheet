/* 비고에서 실번호 주인 이름을 읽는 규칙 — 파일에 적힌 것 그대로 시험한다 */
var fs = require("fs");
var src = fs.readFileSync("csOrderSearch.gs", "utf8");
var i = src.indexOf("function _cs_parseReturnPhone2NameFromNotice_(");
var 깊이 = 0, 시작 = src.indexOf("{", i), 끝 = -1;
for (var k = 시작; k < src.length; k++) {
  if (src[k] === "{") 깊이++;
  else if (src[k] === "}") { 깊이--; if (!깊이) { 끝 = k + 1; break; } }
}
eval(src.substring(i, 끝));

var LF = String.fromCharCode(10);
var 실패 = 0;
function eq(t, got, want) {
  var ok = got === want; if (!ok) 실패++;
  console.log((ok ? "  통과 " : "★ 실패 ") + t + (ok ? "" : '  got "' + got + '" want "' + want + '"'));
}
var f = _cs_parseReturnPhone2NameFromNotice_;

eq("한 줄", f("[260911 10:00 홍] 실번호 010-1111-2222 (김영희)"), "김영희");
eq("여러 줄 중에서", f("[.. ] 상태→수거" + LF + "[.. ] 실번호 010-1-2 (며느리)"), "며느리");
eq("★ 나중에 바로잡은 이름이 이긴다",
  f("[a] 실번호 010-1-2 (김영희)" + LF + "[b] 실번호 010-3-4 (박순자)"), "박순자");
eq("전각 괄호", f("[.. ] 실번호 010-1-2 （정민）"), "정민");
eq("이름이 없으면 빈 값", f("[.. ] 실번호 010-1111-2222"), "");
eq("★ 다른 줄의 괄호를 물지 않는다",
  f("[.. ] 반품송장: 123 (재발송)" + LF + "[.. ] 실번호 010-1-2 (김영희)"), "김영희");
eq("실번호 줄이 없으면 빈 값", f("[.. ] 상태→완료 (확인)"), "");
eq("빈 비고", f(""), "");
eq("★ 줄을 넘어가서 물지 않는다", f("실번호 010-1-2" + LF + "메모 (아무개)"), "");

console.log(실패 ? "\n실패 " + 실패 + "건" : "\n전부 통과");
process.exit(실패 ? 1 : 0);
