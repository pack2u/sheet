/**
 * 전용양식 · 전용발주 마감 송장 찾기 — prpLookup.gs   (2026-10-28)
 * > 사장님: "냅킨코리아 전용발주 송장은 A열이야"
 *   node _prpexclusive_test.js
 *
 * 머리글(칸 배치)은 2026-10-28 세 업체 파일에서 그대로 옮겼다(냅킨코리아·제이엠·태양). 이름·전화·주소·송장은 지어낸 값이다 — 손님 정보를 저장소에 두지 않는다.
 * 일반 「발주 마감」은 칸 배치가 그대로인지도 본다 — 전용 배치가 새어 들면 안 된다.
 */
const fs = require("fs"), vm = require("vm");
let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + "  ->  " + g + "   (기대: " + w + ")"); }
}
const ctx = { console, Logger: { log() {} } };
vm.createContext(ctx);
for (const f of ["prpLookup.gs", "prpConfig.gs", "prpLedger.gs"]) {
  const s = fs.readFileSync(f, "utf8");
  //  필요한 함수만 꺼낸다 — 파일 전체를 돌리면 서비스(SpreadsheetApp …)를 부르는 맨 위 코드가 있다
  const names = f === "prpLookup.gs"
    ? ["prpUidFromCell_", "prpUidNorm_", "prpFindOrderHeaderRow_", "prpMapOrderCols_", "prpFindExclusiveHeaderRow_", "prpMapExclusiveCols_",
       "prpRowMatchesUid_", "prpRowToMatch_", "prpScanTab_", "prpScanTabForUid_", "prpScanTabForInvoice_"]
    : f === "prpConfig.gs" ? ["prpDigits_"] : ["prpFormatPhone_", "prpFormatInvoice_"];
  for (const n of names) {
    const a = s.indexOf("function " + n + "(");
    if (a < 0) throw new Error(f + " 에 " + n + " 가 없다");
    let depth = 0, i = s.indexOf("{", a);
    for (; i < s.length; i++) { if (s[i] === "{") depth++; else if (s[i] === "}" && --depth === 0) break; }
    vm.runInContext(s.slice(a, i + 1), ctx);
  }
}
const tab = (name, rows) => ({
  getName: () => name, getLastRow: () => rows.length, getLastColumn: () => Math.max(...rows.map((r) => r.length)),
  getRange: (r, c, nr, nc) => ({ getDisplayValues: () => rows.slice(r - 1, r - 1 + nr).map((x) => { const y = x.slice(c - 1, c - 1 + nc); while (y.length < nc) y.push(""); return y; }) }),
});
const 찾기 = (t, inv) => { const out = []; ctx.prpScanTabForInvoice_(t, inv, t.getName(), out); return out; };

console.log("[1] 냅킨코리아 — 전용발주 마감 (A 이동일시 · B 송장번호 · C 이슈 — 실제 1행 머리글, 10/28)");
const NK마감 = tab("(2026년 10월) 전용발주 마감", [
  ["이동일시", "송장번호", "이슈", "받는사람", "전화번호", "주소", "우편번호", "", "상품명", "", "배송메세지", "보내는사람", "정산단가", "전화"],
  ["2026-10-01 23:06", "260000000001", "1001-2차", "시험가", "1000000001", "인천 시험구 1", "", "", "NK 크라프트 합지 피자박스 12인치 100개", "1", "", "팩투유", "", "031-923-7795"],
  ["2026-10-07 23:06", "260000000002", "1007-2차", "시험식당 홍길동", "010-0000-0001", "경기 시험시 2", "", "", "NK 내유지 각대봉투 대 1000장", "1", "", "팩투유", "", "031-923-7795"],
]);
const a = 찾기(NK마감, "260000000002");
check("송장으로 한 줄", a.length, 1);
check("받는 분 · 품목 · 마감 시각", [a[0].name, a[0].item, a[0].date], ["시험식당 홍길동", "NK 내유지 각대봉투 대 1000장", "2026-10-07 23:06"]);
check("보내는 사람 전화(031…)를 받는 분 전화로 안 잡는다", /^010/.test(a[0].phone), true);
check("마감 시각(A)으로는 안 걸린다", 찾기(NK마감, "202610012306").length, 0);

console.log("[2] 냅킨코리아 — 전용양식 (A 송장번호 · B 이슈)");
const NK양식 = tab("전용양식", [
  ["송장번호", "이슈", "받는사람", "전화번호", "주소", "우편번호", "", "상품명", "수량", "배송메세지", "보내는사람", "정산단가", "전화"],
  ["260000999001", "1028-1차", "홍길동", "010-1234-5678", "서울", "", "", "NK 종이컵", "2", "", "팩투유", "", "031-923-7795"],
]);
const b = 찾기(NK양식, "260000999001");
check("A열 송장으로 찾는다", [b.length, b[0] && b[0].name, b[0] && b[0].qty], [1, "홍길동", "2"]);

console.log("[3] 제이엠·태양 — 머리글 낱말이 달라도");
const JM = tab("(2026년 10월) 전용발주 마감", [
  ["이동일시", "송장번호", "이슈", "수화주전화1", "수화주전화2", "수화주명", "주소", "", "품명", "포장", "운임구분", "운송상품", "", "도착영업소", "발화주명", "발화주전화번호"],
  ["2026-10-01 23:11", "4100000000001", "1001-2차", "1000000002", "", "시험수화주", "충남 시험시", "1", "PSP 트레이 15호 백색1200개---법인/배민상회", "BOX", "현불", "택배", "31734", "", "팩투유", "031-923-7795"],
]);
const c = 찾기(JM, "4100000000001");
check("제이엠 — 송장·수화주명·품명", [c.length, c[0] && c[0].name, c[0] && c[0].item], [1, "시험수화주", "PSP 트레이 15호 백색1200개---법인/배민상회"]);
const TY = tab("(2026년 10월) 전용발주 마감", [
  ["이동일시", "송장번호", "이슈", "고객명", "", "수하인주소", "수하인번호", "", "", "택배운임(합계)", "운임구분", "품목명", "", "배송메세지"],
  ["2026-10-01 23:12", "45200000001", "발송완료", "시험고객", "", "서울 시험구", "010-0000-3322", "", "1", "", "", "포크 1매 /백색", "", ""],
]);
const d = 찾기(TY, "45200000001");
check("태양 — 송장·고객명·수하인번호·품목명", [d.length, d[0] && d[0].name, d[0] && d[0].item, /3322/.test(d[0] && d[0].phone)], [1, "시험고객", "포크 1매 /백색", true]);

console.log("[3-1] 머리글이 비어 있어도 (gviz 로 본 모양) — 「이슈」 왼쪽이 송장, 그 왼쪽 빈 칸이 날짜");
const 빈머리 = tab("(2026년 9월) 전용발주 마감", [["", "", "이슈", "받는사람", "전화번호", "", "", "", "상품명"], ["2026-09-30 23:05", "260000111222", "0930-2차", "김", "010-1", "", "", "", "NK 컵"]]);
const z = 찾기(빈머리, "260000111222");
check("빈 머리글 — 송장·날짜", [z.length, z[0] && z[0].date], [1, "2026-09-30 23:05"]);
check("제이엠 — 수화주전화1 을 전화로", String(c[0] && c[0].phone).replace(/\D/g, ""), "1000000002");

console.log("[4] 고유ID 로는 전용 탭에서 안 걸린다 (그 칸이 없다)");
const u = []; ctx.prpScanTabForUid_(NK마감, "p1006000117", NK마감.getName(), u);
check("고유ID — 0줄", u.length, 0);

console.log("[5] 일반 「발주 마감」은 그대로 — 전용 배치가 새면 안 된다");
const 일반 = tab("(2026년 10월) 발주 마감", [
  ["📊 월별 마감 요약"], ["📦 전체 건수", "135"], ["🏷️ 최종 정산금액", "6,775,200"],
  ["거래처명(자동)", "", "이카운트코드", "품목명(자동)", "수량", "수취인", "수취인전화번호", "수취인주소", "배송메시지", "적요", "송장번호", "", "고유ID(자동)", "상태(자동)", "도서산간배송비", "택배사"],
  ["대리발송-냅킨코리아", "20261001", "JHDOSIRAK0804003", "BF 6칸도시락 200SET", "3", "시험수취인", "010-0000-0003", "경기 시험시", "가게안으로 넣어주세요", "", "45200000002", "", "시험수취인/d1001000003", "", "", "로젠"],
]);
const e = 찾기(일반, "45200000002");
check("일반 마감 — 송장 K열 그대로", [e.length, e[0] && e[0].name, e[0] && e[0].item], [1, "시험수취인", "BF 6칸도시락 200SET"]);
const e2 = []; ctx.prpScanTabForUid_(일반, "d1001000003", 일반.getName(), e2);
check("일반 마감 — 고유ID 도 그대로", e2.length, 1);
//  이름에 「전용」이 없으면 「이슈」 머리글이 있어도 일반 배치 (탭 이름이 문지기)
const 이름만 = tab("발주 및 송장조회", [["", "", "이슈", "받는사람"], ["x", "999988887777", "a", "b"]]);
check("이름에 「전용」이 없으면 전용 배치를 안 쓴다 (B열을 송장으로 안 본다)", 찾기(이름만, "999988887777").length, 0);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
