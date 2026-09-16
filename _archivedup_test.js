/**
 * 일일마감 — 같은 줄이 두 번 붙지 않는다
 *
 *  > "일일 마감시 이미지와 같이 하단데 따로 또 붙는 경우는 무슨 상황인지?"
 *    (2026-09-16 · 「★ 합계 (758건)」 아래에 「★ 합계 (70건)」이 또 있었고,
 *     그 70줄 안에서도 같은 주문이 두 번씩 있었다)
 *
 *  까닭이 둘이다 —
 *    ① 마감이 그 파일에 두 번 붙었다.
 *       예약 마감(20:00)에는 「당일이 이미 있으면 건너뛴다」가 있는데
 *       손으로 누르는 「📋 통합 일일마감」에는 없다.
 *    ② 그날 판매현황(MMDD판매현황)에 같은 주문이 두 회차로 쌓였다.
 *       같은 판매현황으로 세트분리를 두 번 돌리면 그렇게 된다.
 *
 *  둘 다 부르는 쪽 문제지만 막는 곳은 «마지막에 쓰는 자리» 하나여야 한다.
 *  2026-09-07 에도 같은 일로 411행이 늘어 손으로 골라냈다.
 *
 * 실행: node _archivedup_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const src = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext([grab("_pep_mapArchiveMatchCols_"), grab("_pep_archiveRowKey_")].join("\n"), ctx);
const key = (row, hdr) =>
  vm.runInContext("_pep_archiveRowKey_(" + JSON.stringify(row) + "," + JSON.stringify(hdr) + ")", ctx);

/*  실제 마감 표 모양 — 판매현황 C~Q + 택배사 + 운송장번호 + 출처  */
const HDR = ["순번", "일자-No.", "품목코드", "품목명", "택배박스", "수량", "전화", "모바일",
  "주소1", "배송메시지", "합계", "판매처", "단품배송비", "적요", "주문자명(사방넷)",
  "택배사", "운송장번호", "출처"];

function 줄(o) {
  return [o.순번 || 1, "260916-1", o.코드 || "MATYG0050", "JH 미니탕 소 200세트", 1,
    o.수량 == null ? 1 : o.수량, "010-6389-3604", "010-6389-3604", "경기도 평택시",
    "", 48900, "점촌소머리국밥", 5700, "", o.oid || "점촌소머리국밥/0916-ds-ab12",
    o.택배사 || "", o.송장 || "", o.출처 || "미매칭"];
}

console.log("\n[1] 같은 줄은 같은 열쇠");
{
  check("글자 하나 안 다르면 같다", key(줄({}), HDR) === key(줄({}), HDR), true);
  check("수량이 다르면 다르다", key(줄({}), HDR) === key(줄({ 수량: 2 }), HDR), false);
  check("고유ID 가 다르면 다르다",
    key(줄({}), HDR) === key(줄({ oid: "다른가게/0916-ds-zzzz" }), HDR), false);
  check("품목이 다르면 다르다", key(줄({}), HDR) === key(줄({ 코드: "AJ19500003" }), HDR), false);
  check("순번이 다르면 다르다 (같은 내용 두 줄을 뭉개지 않는다)",
    key(줄({ 순번: 1 }), HDR) === key(줄({ 순번: 2 }), HDR), false);
}

console.log("\n[2] ★ 나중에 채워지는 칸은 열쇠에서 뺀다");
{
  /*  미매칭으로 적힌 줄이 다음 마감에서 송장을 얻으면 «다른 줄»이 되어
      또 붙는다. 송장을 채우는 일은 2단계 보강이 «그 자리에» 한다.  */
  const 미매칭 = 줄({ 출처: "미매칭" });
  const 송장붙음 = 줄({ 택배사: "로젠택배", 송장: "451-6945-9705", 출처: "로젠" });
  check("★ 송장이 붙어도 같은 줄로 본다", key(미매칭, HDR) === key(송장붙음, HDR), true);
}

console.log("\n[3] 머리글을 못 읽어도 맨 뒤 셋은 뺀다");
{
  /*  이 표의 약속이다 — 판매현황 C~Q + 택배사 + 운송장번호 + 출처.
      머리글 이름이 바뀌어도 자리는 그대로다.  */
  const 낯선 = HDR.slice(0, 15).concat(["열16", "열17", "열18"]);
  const a = 줄({ 출처: "미매칭" });
  const b = 줄({ 택배사: "로젠택배", 송장: "451-6945-9705", 출처: "로젠" });
  check("★ 그래도 같은 줄로 본다", key(a, 낯선) === key(b, 낯선), true);
}

console.log("\n[4] 거르는 코드가 쓰는 자리에 있다");
{
  const i = src.indexOf("function _pep_appendArchiveRows_(");
  const 몸 = src.slice(i, i + 6000);
  check("기존 줄을 읽는다", 몸.indexOf("var _있던키_ = {}") >= 0, true);
  check("★ 열쇠로 거른다", 몸.indexOf("if (_있던키_[_k_])") >= 0, true);
  check("★ 이번에 들어온 것끼리의 겹침도 거른다",
    /_있던키_\[_k_\] = true;\s*\/\/\s*이번에 들어온/.test(몸), true);
  check("몇 줄 건너뛰었는지 센다", 몸.indexOf("out.skippedDup") >= 0, true);
  check("★ 다 이미 있으면 합계 줄도 안 만든다",
    /if \(!rows\.length\) return out;/.test(몸), true);

  /*  거르다 실패해서 하루치를 통째로 빠뜨리는 것이 두 번 붙는 것보다 나쁘다 */
  check("★ 기존 줄을 못 읽으면 거르지 않는다",
    /catch \(e있던\)[\s\S]{0,320}_있던키_ = null;/.test(몸), true);
  check("못 읽었으면 그냥 쓴다", /if \(_있던키_\) \{/.test(몸), true);
}

console.log("\n[5] 건너뛴 것을 «말한다»");
{
  check("결과에 담는다", src.indexOf("result.detail.archiveDup") >= 0, true);
  check("자리를 미리 만들어 둔다", src.indexOf("archiveDup: 0 }") >= 0, true);
  const web = fs.readFileSync("_partnerWebApp.gs", "utf8");
  check("수동 마감 화면에 적는다", web.indexOf("↷ 이미 있어서 건너뜀") >= 0, true);
  check("★ 까닭까지 적는다", web.indexOf("마감을 두 번 눌렀거나") >= 0, true);
  check("예약 마감 로그에도 적는다", web.indexOf("이미있어건너뜀:") >= 0, true);
}

console.log("\n[6] 합계 줄은 열쇠로 안 만든다");
{
  /*  합계 줄까지 키로 만들면 쓸데없이 커지고, 다음 마감에서 「이미 있는 줄」로
      오인될 여지가 생긴다.  */
  const i = src.indexOf("function _pep_appendArchiveRows_(");
  const 몸 = src.slice(i, i + 6000);
  check("★ 합계 줄은 건너뛴다", 몸.indexOf("indexOf('★ 합계') === 0") >= 0, true);
}


console.log("\n[7] 옛 표(택배사 없는 17칸)도 같이 본다");
{
  /*  2026-08-27 이전에 만들어진 날 파일은 택배사 칸이 없다.
      그 표에서도 뒤쪽 둘(운송장·출처)은 빼야 한다.  */
  const 옛HDR = HDR.slice(0, 15).concat(["운송장번호", "출처"]);
  const 옛줄 = (o) => 줄(o).slice(0, 15).concat([o.송장 || "", o.출처 || "미매칭"]);
  check("송장이 붙어도 같은 줄", key(옛줄({}), 옛HDR) === key(옛줄({ 송장: "451-6945-9705", 출처: "로젠" }), 옛HDR), true);
  check("내용이 다르면 다르다", key(옛줄({}), 옛HDR) === key(옛줄({ 수량: 9 }), 옛HDR), false);
}

console.log("\n[8] 이름을 못 읽어도 자리로 뺀다");
{
  const 낯선18 = HDR.slice(0, 15).concat(["열16", "열17", "열18"]);
  const a = 줄({ 출처: "미매칭" });
  const b = 줄({ 택배사: "로젠택배", 송장: "451-6945-9705", 출처: "로젠" });
  check("★ 18칸이면 뒤 셋을 뺀다", key(a, 낯선18) === key(b, 낯선18), true);

  const 낯선17 = HDR.slice(0, 15).concat(["열16", "열17"]);
  const c = 줄({}).slice(0, 15).concat(["", "미매칭"]);
  const d = 줄({}).slice(0, 15).concat(["451-6945-9705", "로젠"]);
  check("★ 17칸이면 뒤 둘을 뺀다", key(c, 낯선17) === key(d, 낯선17), true);
}

console.log("\n[9] 실제 사고 모양 — 같은 줄이 두 벌 들어와도 한 벌만 남는다");
{
  /*  사장님 화면의 70줄이 35건 × 2 였다. 그날 판매현황에 같은 주문이
      두 회차로 쌓인 모양이다.  */
  const 한벌 = [];
  for (let i = 1; i <= 35; i++) 한벌.push(줄({ 순번: i, oid: "가게" + i + "/0916-ds-x" + i }));
  const 두벌 = 한벌.concat(한벌.map((r) => r.slice()));
  const 본것 = {}; const 남은 = [];
  for (const r of 두벌) {
    const k = key(r, HDR);
    if (본것[k]) continue;
    본것[k] = true;
    남은.push(r);
  }
  check("들어온 줄", 두벌.length, 70);
  check("★ 남는 줄", 남은.length, 35);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
