/**
 * 로젠 자사출고 송장 — 「집하」 양식을 실제로 읽는가
 *
 *  > "허브에서 송장 수집시 로젠이 수집이 안되지?"  "지금 안되고 있다고."
 *  > "대리공급 송장은 다 들어왔는데"
 *
 *  거래관리시스템송장 시트의 「입력_로젠주문실적」 탭이 «집하» 양식으로
 *  바뀌어 있었다. 코드에 적힌 자리(44칸 「주문등록_출력」: D=운송장·S=주문번호)와
 *  통째로 다르고, 게다가 이 탭에는 «머리글이 없다» — 1행부터 바로 자료다.
 *
 *    · D열이 비어 고정열 검증이 「헤더 탐지로 전환」
 *    · 그런데 헤더가 없으니 그것도 실패 → 송장 0건
 *    · 오류는 한 줄도 안 났다. 대리공급은 멀쩡해서 더 안 보였다
 *
 *  실제 한 줄 (2026-09-15, 사장님 화면):
 *    A 1 · B 집하 · C 2026-09-15 · E X · G X · H 30556066…
 *    I 주식회사 팩투유 · J 2162784744 · K 451-6945-9705
 *    M 동수원 · N 북부천 · O 최유찬 · P 14*** · Q 경기 부천시…
 *
 * 실행: node _pt_rozencol_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const src = fs.readFileSync("_partnerHelpers.gs", "utf8");
const m = src.match(/var\s+_PT_ROZEN_FIXED_COL\s*=\s*\{([\s\S]*?)\n\};/);
if (!m) { console.error("_PT_ROZEN_FIXED_COL 를 못 찾음"); process.exit(1); }
const 몸 = m[1];
/**
 * 「name: 10,」 에서 숫자를 꺼낸다.
 *
 * ★ 정규식을 안 쓴다 ★ 이 저장소에서 스크립트로 파일을 쓸 때 역슬래시가
 *   한 겹 벗겨지는 일이 있었다. 그러면 시험이 «조용히» 아무것도 못 잡고
 *   전부 통과처럼 보인다. 글자를 그대로 찾는다 — 벗겨질 것이 없다.
 */
function 칸(name) {
  const key = name + ":";
  const i = 몸.indexOf(key);
  if (i < 0) return null;
  let t = 몸.slice(i + key.length);
  t = t.split(",")[0].split("//")[0].trim();
  const v = parseInt(t, 10);
  return isNaN(v) ? null : v;
}
//  0-based 인덱스 → 엑셀 열 글자
const 글자 = (i) => (i < 0 ? "(안 씀)" : String.fromCharCode(65 + i));

//  사장님 화면의 실제 한 줄 (0-based)
const 실제 = [
  "1", "집하", "2026-09-15", "", "X", "", "X", "30556066",
  "주식회사 팩투유", "2162784744", "451-6945-9705", "",
  "동수원", "북부천", "최유찬", "14***", "경기 부천시 오정구 고리울…",
];

console.log("");
console.log("[자리표] 실제 시트와 맞는가");
check("운송장번호 = K열", 글자(칸("invoice")), "K");
check("주문번호 = J열", 글자(칸("uid")), "J");
check("수하인 = O열", 글자(칸("name")), "O");
check("집하일자 = C열", 글자(칸("date")), "C");
check("★ 전화는 안 쓴다 (P열이 마스킹)", 칸("phone"), -1);

console.log("");
console.log("[읽기] 그 자리에서 실제 값이 나오는가");
check("송장", 실제[칸("invoice")], "451-6945-9705");
check("주문번호", 실제[칸("uid")], "2162784744");
check("수하인", 실제[칸("name")], "최유찬");
check("날짜", 실제[칸("date")], "2026-09-15");

console.log("");
console.log("[송장] 숫자만 남기면 로젠 11자리");
{
  const d = String(실제[칸("invoice")]).replace(/[^0-9]/g, "");
  check("하이픈을 떼면 45169459705", d, "45169459705");
  check("★ 11자리 — 로젠", d.length, 11);
}

console.log("");
console.log("[옛 자리] 그대로 뒀으면 0건이었다");
check("★ 옛 D열에는 송장이 없다", String(실제[3] || ""), "");
check("★ 옛 S열은 이 양식에 아예 없다", 실제.length <= 18, true);

console.log("");
console.log("[머리글 없음] 첫 줄을 버리지 않는다");
check("0행 송장이 9자리 이상이면 0행부터 읽는다",
  src.indexOf("_startRow_ = 0;") >= 0, true);
check("그 사실을 결과에 적는다",
  src.indexOf("머리글 없음 — 1행부터 자료") >= 0, true);
check("루프가 _startRow_ 를 쓴다",
  src.indexOf("for (var i = _startRow_; i < invData.length; i++)") >= 0, true);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
