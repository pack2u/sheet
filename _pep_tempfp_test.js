/**
 * 대리공급 Push — 고유ID 없는 줄이 임시기록에 두 번 적히던 것  (2026-10-11)
 *
 *  09/01 누림트레이딩 등 고유ID 없는 줄(MMDD-ph-)이 «같은 고유ID로» 임시기록에 두 번 들어갔고
 *  이카운트 구매전표도 두 번 만들어졌다. 고유ID 재사용 판단은 `<=`, 임시기록 적기 판단은 `<` 로 갈려 있었다.
 *  여기서는 Push 고리(_partnerExclusivePush.gs 2420~2460 줄)의 두 판단을 «실제 함수»로 흉내 낸다.
 *
 * 실행: node _pep_tempfp_test.js
 */
var fs = require("fs");
var path = require("path");
var src = fs.readFileSync(path.join(__dirname, "_partnerExclusivePush.gs"), "utf8");
function 꺼내(이름) {
  var i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 없음");
  var d = 0, s = src.indexOf("{", i);
  for (var k = s; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.substring(i, k + 1); } }
}
(0, eval)(꺼내("_pep_tempFpAlreadyThere_"));
(0, eval)(꺼내("_pep_tempFingerprintKey_"));

var 통과 = 0, 실패 = 0;
function ok(이름, 참, 덧) { if (참) { 통과++; console.log("  ok   " + 이름); } else { 실패++; console.log("  FAIL " + 이름 + (덧 ? "  — " + 덧 : "")); } }

/** Push 한 회차 — 고유ID 없는 줄만. 임시기록(tempRows)에 무엇을 더하는지 돌려준다 */
function 한회차(source, tempRows, 판정) {
  var fpRows = {};
  tempRows.forEach(function (t) { var k = _pep_tempFingerprintKey_(t[3], t[4], t); (fpRows[k] = fpRows[k] || []).push({ uid: t[15] }); });
  var occ = {}, 더함 = [], 쓴ID = [];
  source.forEach(function (row, n) {
    var k = _pep_tempFingerprintKey_(row[3], row[4], row);
    occ[k] = (occ[k] || 0) + 1;
    var 있던수 = (fpRows[k] || []).length;
    var uid = 판정(occ[k], 있던수) ? fpRows[k][occ[k] - 1].uid : "0901-ph-N" + n;   //  ① 고유ID 재사용
    쓴ID.push(uid);
    if (!(k && 판정(occ[k], 있던수))) {                                              //  ② 임시기록 적기
      var t = row.slice(); t[15] = uid; 더함.push(t);
      (fpRows[k] = fpRows[k] || []).push({ uid: uid });
    }
  });
  return { 더함: 더함, 쓴ID: 쓴ID };
}
function 줄(code, name, who, phone) { var r = []; for (var i = 0; i < 22; i++) r.push(""); r[3] = code; r[4] = name; r[12] = who; r[8] = phone; return r; }

var 누림 = 줄("AJBC10001", "AJ 반찬용기 직사각 3찬 블랙", "(주)누림트레이딩 이상진", "010-1234-5678");
var 브로스 = 줄("HUADSL00001", "HU KP도시락 1호", "주식회사 브로스에프앤비", "010-2222-3333");

console.log("\n[1] ★ 09/01 — 세트분리를 다시 돌려 고유ID 가 빠진 원천으로 Push 가 또 돈다 ★");
var 임시 = [];
var 첫 = 한회차([누림, 브로스], 임시, _pep_tempFpAlreadyThere_);
임시 = 임시.concat(첫.더함);
ok("첫 회차: 두 줄 적음", 첫.더함.length === 2);
var 둘 = 한회차([누림, 브로스], 임시, _pep_tempFpAlreadyThere_);
ok("둘째 회차: 하나도 더 안 적음", 둘.더함.length === 0, 둘.더함.length + "줄");
ok("둘째 회차: 첫 회차 고유ID 를 그대로 씀", 둘.쓴ID.join() === 첫.쓴ID.join());

console.log("\n[2] 같은 사람·같은 품목을 진짜로 두 번 시킨 날 — 둘 다 적는다");
var 둘주문 = 한회차([누림, 누림], [], _pep_tempFpAlreadyThere_);
ok("빈 임시기록에 같은 줄 둘 → 둘 다 적음", 둘주문.더함.length === 2);
var 다시 = 한회차([누림, 누림], 둘주문.더함, _pep_tempFpAlreadyThere_);
ok("다시 돌면 둘 다 이미 있음", 다시.더함.length === 0);
var 셋째 = 한회차([누림, 누림, 누림], 둘주문.더함, _pep_tempFpAlreadyThere_);
ok("세 번째 주문만 새로 적음", 셋째.더함.length === 1);

console.log("\n[3] 규칙 자체");
ok("임시기록에 없으면(0) 1번째는 새 줄", !_pep_tempFpAlreadyThere_(1, 0));
ok("하나 있으면 1번째는 이미 있음", _pep_tempFpAlreadyThere_(1, 1));
ok("하나 있으면 2번째는 새 줄", !_pep_tempFpAlreadyThere_(2, 1));
ok("0번째(안 셈)는 «있음» 아님 — 07-06 「0 <= 0」 사고", !_pep_tempFpAlreadyThere_(0, 0));

console.log("\n[4] ★ 예전 규칙(`<`)이면 09/01 처럼 두 번 적힌다 — 시험이 사고를 잡는지 ★");
//  고유ID 재사용은 `<=`, 적기는 `<` 이던 옛 고리를 그대로 흉내 낸다
var 옛고리 = (function () {
  var fpRows = {}; 임시.forEach(function (t) { var k = _pep_tempFingerprintKey_(t[3], t[4], t); (fpRows[k] = fpRows[k] || []).push({ uid: t[15] }); });
  var occ = {}, 더함 = [];
  [누림, 브로스].forEach(function (row) { var k = _pep_tempFingerprintKey_(row[3], row[4], row); occ[k] = (occ[k] || 0) + 1; var c = (fpRows[k] || []).length; if (!(k && occ[k] < c)) 더함.push(row); });
  return 더함.length;
})();
ok("옛 고리는 두 줄을 또 적는다 (그래서 09/01 에 두 벌)", 옛고리 === 2, 옛고리 + "줄");

console.log("");
console.log(실패 ? "★ 실패 " + 실패 + "건 / 통과 " + 통과 + "건" : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
