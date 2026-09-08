/**
 * 롯데 회수(반품) 접수 — 규칙 검증.
 * 2026-09-08
 *
 *   node _cslotteret_test.js
 *
 * ★ 여기는 실제 기사를 부르는 코드다 ★
 *   잘못 보내면 남의 집에 기사가 간다. 그래서 「막아야 하는 것」을 먼저 본다.
 *   API 호출 자체는 안 한다 — 규격 값과 가드만 확인한다.
 */
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/csLotteReturn.gs", "utf8");
const html = fs.readFileSync(__dirname + "/home.html", "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  OK " + name); }
  else { fail++; console.log("  NG " + name + (got !== undefined ? "  → " + got : "")); }
};

console.log("\n[1] ★ 규격 값을 틀리면 출고가 나간다 ★");
// ustRtgSctCd 01 은 출고다. 02 여야 반품이다. 이걸 틀리면 고객에게 물건이 또 간다.
ok("반품 구분은 02", /_LRT_SCT_RETURN_ = "02"/.test(src));
ok("운임은 신용(03) — 사장님 지시", /_LRT_FARE_CREDIT_ = "03"/.test(src));
ok("거래처코드가 박혀 있다", /_LRT_CUST_CD_ = "348782"/.test(src));
ok("박스크기 기본값은 A~F 중 하나", /_LRT_BOX_DEFAULT_ = "[A-F]"/.test(src));
ok("주문접수 경로가 맞다", src.indexOf("/api/pid/cus/714a/apiSndOut") > -1);
ok("송장은 비워 보낸다 (롯데가 채번)", !/invNo:\s*String\(p\./.test(src));

console.log("\n[2] ★ 받는 주소를 코드에 안 박는다 ★");
/* 실제로 기사가 찾아가는 주소다. 코드에 박으면 창고가 바뀔 때 배포를 해야 하고
   그 사이 물건이 엉뚱한 데로 간다. 속성에 두고, 없으면 접수를 막는다. */
ok("속성에서 읽는다", /getProperty\(_LRT_TO_PROP_\)/.test(src));
ok("네 칸이 다 있어야 한다", /need = \["name", "tel", "zip", "addr"\]/.test(src));
ok("없으면 접수를 막는다", /받는 곳\(창고\)이 설정되지 않았습니다/.test(src));
ok("화면이 물어볼 수 있다 (csLotteReturnReady)", src.indexOf("function csLotteReturnReady") > -1);
ok("주소가 코드에 안 박혀 있다",
   !/(경기|서울|인천|부산|대구|광주|대전|울산|세종|강원|충청|전라|경상|제주)[^\n]{0,40}(로|길)\s*[0-9]/.test(src));

console.log("\n[3] ★ 고객 정보가 없으면 안 보낸다 ★");
// 주소가 빈 채로 접수하면 기사가 헛걸음한다. 지어내지 않는다.
for (const f of ["고객명", "전화", "우편번호", "주소"]) {
  ok(f + " 없으면 막는다", src.indexOf('miss.push("' + f + '")') > -1);
}
ok("무엇이 없는지 말해 준다", /고객 " \+ miss\.join\("·"\)/.test(src));

console.log("\n[4] 집하요청일 — 다음 영업일 (사장님 지시)");
ok("다음 영업일을 계산한다", src.indexOf("function _lrt_nextBusinessDay_") > -1);
ok("주말을 건너뛴다", /day === 0 \|\| day === 6/.test(src));
ok("공휴일표가 있다", /_LRT_HOLIDAYS_ = \{/.test(src));
ok("임시공휴일은 속성으로 더한다", /_LRT_HOLIDAY_PROP_/.test(src));
ok("★ 못 찾아도 접수를 막지 않는다 ★", /접수를 막느니 하루 어긋나는 편이 낫다/.test(src));

// 규칙을 실제로 돌려 본다
const HOL = { "20260924": 1, "20260925": 1, "20260926": 1 };
function nextBiz(from) {
  const d = new Date(from);
  for (let i = 0; i < 10; i++) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") +
                String(d.getDate()).padStart(2, "0");
    if (day !== 0 && day !== 6 && !HOL[ymd]) return ymd;
  }
  return "";
}
ok("화요일 → 수요일", nextBiz("2026-09-08") === "20260909", nextBiz("2026-09-08"));
ok("★ 금요일 → 월요일 ★", nextBiz("2026-09-11") === "20260914", nextBiz("2026-09-11"));
ok("토요일 → 월요일", nextBiz("2026-09-12") === "20260914", nextBiz("2026-09-12"));
ok("★ 추석 연휴(9/24~26)를 건너뛴다 ★", nextBiz("2026-09-23") === "20260928", nextBiz("2026-09-23"));

console.log("\n[5] 권한 · 쿼터");
ok("접근제어를 통과해야 한다", /_cs_ac_guard_\(\)/.test(src));
ok("공용 호출기를 쓴다 (쿼터·캐시가 거기 있다)", /_lotte_call_\("post"/.test(src));

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
