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
//  메모리(CacheService)는 [7] 전까지 없다 — 없으면 시트를 읽는 길이 그대로 도는지도 앞 시험이 본다
const ctx = { console, Logger: { log() {} }, PRP_CACHE_VER: "t", PRP_KEYCOL_CACHE_SEC_: 21600, PRP_KEYCOL_LIVE_CACHE_SEC_: 600, PRP_KEYCACHE_LIVE_: false, PRP_KEYCACHE_TRUST_: false, PRP_KEYCACHE_STALE_: false, PRP_KEYCACHE_STAMPED_: false, PRP_RESULT_CACHE_SEC_: 600, PRP_LOOKUP_MONTHS_: 12,
  PRP_ORDER_TAB_NAME_: "발주 및 송장조회", PRP_ARCHIVE_TAB_SUFFIX_: "발주 마감", PRP_EXCLUSIVE_ARCHIVE_SUFFIX_: "전용발주 마감", PRP_EXCLUSIVE_TAB_NAME_: "전용양식" };
vm.createContext(ctx);
for (const f of ["prpLookup.gs", "prpConfig.gs", "prpLedger.gs"]) {
  const s = fs.readFileSync(f, "utf8");
  //  필요한 함수만 꺼낸다 — 파일 전체를 돌리면 서비스(SpreadsheetApp …)를 부르는 맨 위 코드가 있다
  const names = f === "prpLookup.gs"
    ? ["prpUidFromCell_", "prpUidNorm_", "prpFindOrderHeaderRow_", "prpMapOrderCols_", "prpFindExclusiveHeaderRow_", "prpMapExclusiveCols_", "prpTabLayout_", "prpScanTabByKey_", "prpInvoiceCellHas_", "prpFileStamp_", "prpSheetsApi_", "prpA1Tab_", "prpColLetter_", "prpRowsTab_", "prpLazyTab_", "prpBatchTabs_", "prpStampedBook_", "prpBookTabNames_", "prpUniqMatches_", "prpScanVendorBook_", "prpFindVendorFileId_", "prpRecentArchiveTabNames_", "prpArchiveTabName_", "prpKeyColsCacheKey_", "prpKeyColsCacheSec_", "prpCacheHash_", "prpCacheGetJson_", "prpCachePutJson_",
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

console.log("[3-2] 아주팩·부원 (10/28 실제 머리글 · 값은 지어냄)");
const AJ = tab("(2026년 10월) 전용발주 마감", [
  ["이동일시", "송장번호", "이슈", "보내는분 성명", "보내는분 전화번호", "보내는분 주소(전체, 분할)", "받는분 성명", "받는분 전화번호", "받는분 주소(전체, 분할)", "품목명", "박스수량", "박스타입", "배송메세지1"],
  ["2026-10-01 23:08", "463400000001", "발송완료", "팩투유", "031-923-7795", "경기 평택시 팩투유", "시험식당 가나다", "010-0000-0004", "경북 시험시", "AJ도시락/5칸/흑(셋트)", "1", "", ""],
]);
const aj = 찾기(AJ, "463400000001");
check("아주팩 — 받는분 성명·전화(보내는분 아님)·품목·박스수량", [aj.length, aj[0] && aj[0].name, aj[0] && aj[0].phone, aj[0] && aj[0].item, aj[0] && aj[0].qty, aj[0] && aj[0].date],
  [1, "시험식당 가나다", "010-0000-0004", "AJ도시락/5칸/흑(셋트)", "1", "2026-10-01 23:08"]);
const BW = tab("(2026년 10월) 전용발주 마감", [
  ["이동일시", "송장번호", "이슈", "받는사람", "전화번호", "주소", "", "상품명", "수량", "B2750", "C3200", "D5500", "E6500", "배송메세지", "운임구분", "운임"],
  ["2026-10-01 23:07", "260300000001", "발송완료", "시험고객2", "1000000005", "서울 시험구", "", "BW 사출 195파이 공용뚜껑 300개---뚜껑만---법인/배민상회", "1", "", "", "", "", "부재시 문앞", "", ""],
]);
const bw = 찾기(BW, "260300000001");
check("부원 — 받는사람·빠진 0 되붙인 전화·상품명", [bw.length, bw[0] && bw[0].name, bw[0] && bw[0].phone, bw[0] && bw[0].item], [1, "시험고객2", "010-0000-0005", "BW 사출 195파이 공용뚜껑 300개---뚜껑만---법인/배민상회"]);

console.log("[3-1] 머리글이 비어 있어도 (gviz 로 본 모양) — 「이슈」 왼쪽이 송장, 그 왼쪽 빈 칸이 날짜");
const 빈머리 = tab("(2026년 9월) 전용발주 마감", [["", "", "이슈", "받는사람", "전화번호", "", "", "", "상품명"], ["2026-09-30 23:05", "260000111222", "0930-2차", "김", "010-1", "", "", "", "NK 컵"]]);
const z = 찾기(빈머리, "260000111222");
check("빈 머리글 — 송장·날짜", [z.length, z[0] && z[0].date], [1, "2026-09-30 23:05"]);
//  시트가 숫자로 들고 있어 맨 앞 0 이 빠진 번호 — 010… 으로 되살린다 (prpFormatPhone_, 10/28)
check("제이엠 — 수화주전화1 을 전화로 (빠진 0 을 되붙여)", c[0] && c[0].phone, "010-0000-0002");

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

console.log("[5-1] 한 칸에 송장 여럿 (태양 10월 모양 · 번호는 지어냄)");
const 여럿 = tab("(2026년 10월) 전용발주 마감", [TY.getRange(1, 1, 1, 14).getDisplayValues()[0],
  ["2026-10-02 23:12", "45200000101 45200000112 45200000123", "발송완료", "시험고객3", "", "서울 시험구", "010-0000-4455", "", "3", "", "", "포크 1매 /백색", "", ""],
  ["2026-10-03 23:12", "45200000201,45200000212\n45200000223", "발송완료", "시험고객4", "", "부산", "010-0000-6677", "", "2", "", "", "숟가락", "", ""]]);
check("가운데 송장으로 찾는다", [찾기(여럿, "45200000112").length, 찾기(여럿, "45200000112")[0].name], [1, "시험고객3"]);
check("맨 뒤 송장 · 쉼표·줄바꿈 칸", [찾기(여럿, "45200000123").length, 찾기(여럿, "45200000223")[0] && 찾기(여럿, "45200000223")[0].name], [1, "시험고객4"]);
check("앞자리만 같은 번호는 안 걸린다", 찾기(여럿, "4520000011").length, 0);
check("하이픈 송장은 그대로 한 송장", ctx.prpInvoiceCellHas_("4634-6108-5990", "463461085990"), true);
check("하이픈 조각으로는 안 걸린다", ctx.prpInvoiceCellHas_("4634-6108-5990", "4634"), false);

console.log("[6] 열쇠 칸만 먼저 읽는다 — 탭 전체를 읽지 않는다 (10/28 업체 화면 30~58초)");
const 큰줄 = [일반.getRange(4, 1, 1, 16).getDisplayValues()[0]];
for (let i = 0; i < 2000; i++) 큰줄.push(["대리발송-냅킨코리아", "20261001", "X", "품목" + i, "1", "수취인" + i, "010-0000-" + String(i).padStart(4, "0"), "주소", "", "", "4520" + String(1000000 + i), "", "수취인" + i + "/d1001" + String(100000 + i), "", "", "로젠"]);
const 큰 = tab("(2026년 9월) 발주 마감", [["📊 월별 마감 요약"], ["📦"], ["🏷️"], ...큰줄]);
let 읽은칸 = 0;
const 센 = { ...큰, getName: 큰.getName, getRange: (r, c, nr, nc) => { 읽은칸 += nr * nc; return 큰.getRange(r, c, nr, nc); } };
const f = 찾기(센, "45201001234");
check("2,000줄 — 송장으로 한 줄 · 받는 분", [f.length, f[0] && f[0].name], [1, "수취인1234"]);
check("읽은 칸이 전체(2,004줄×16칸)의 1/8 아래", 읽은칸 < (2004 * 16) / 8, true);
읽은칸 = 0;
const g2 = []; ctx.prpScanTabForUid_(센, "d1001101999", 센.getName(), g2);
check("2,000줄 — 고유ID 로 한 줄 · 품목", [g2.length, g2[0] && g2[0].item], [1, "품목1999"]);
const 합 = tab("(2026년 8월) 발주 마감", [큰줄[0], ...Array.from({ length: 12 }, (_, i) => ["", "", "", "합" + i, "1", "같은분", "", "", "", "", "463400009999"])]);
check("합포장 12줄(한 번에 읽는 길)", 찾기(합, "463400009999").map((m) => m.item).join(","), Array.from({ length: 12 }, (_, i) => "합" + i).join(","));

console.log("[7] 메모리(CacheService) — 닫힌 달만 담고, 맞은 줄은 시트에서 새로 읽는다");
const 메모 = new Map();
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (메모.has(k) ? 메모.get(k) : null), put: (k, v, sec) => { 메모.set(k, v); 둔시간.push(sec); } }) };
const 둔시간 = [];
ctx.Utilities = { DigestAlgorithm: { MD5: 1 }, Charset: { UTF_8: 1 }, computeDigest: (_a, s) => [...Buffer.from(require("crypto").createHash("md5").update(s).digest())], base64EncodeWebSafe: (b) => Buffer.from(b).toString("base64url") };
ctx.prpNow_ = () => new Date(2026, 9, 28);
let 줄물음 = 0;
const 센탭 = (name, rows) => { const t = tab(name, rows); return { ...t, getName: t.getName, getLastRow: () => { 줄물음++; return t.getLastRow(); }, getParent: () => ({ getId: () => "FILE1" }), getRange: (r, c, nr, nc) => { 읽은칸 += nr * nc; return t.getRange(r, c, nr, nc); } }; };
const 지난줄 = [["📊"], ["📦"], ["🏷️"], ...큰줄.map((r) => r.slice())];   // 탭이 이 배열을 그대로 본다
const 지난 = 센탭("(2026년 9월) 발주 마감", 지난줄);
읽은칸 = 0; const h1 = 찾기(지난, "45201001234"); const 처음 = 읽은칸;
읽은칸 = 0; const h2 = 찾기(지난, "45201000007"); const 둘째 = 읽은칸;
check("닫힌 달 — 두 번째는 맞은 줄만 읽는다(16칸)", [h1.length, h2.length, 처음 > 2000, 둘째], [1, 1, true, 16]);
지난줄[3 + 8][5] = "바뀐이름";   // 송장 …0007 줄의 받는 분을 시트에서 고친다
check("메모리에서 골라도 받는 분은 시트 지금 값", 찾기(지난, "45201000007")[0].name, "바뀐이름");
check("고유ID 는 따로 담는다(송장 메모리를 쓰지 않는다)", (() => { 읽은칸 = 0; const u2 = []; ctx.prpScanTabForUid_(지난, "d1001100005", 지난.getName(), u2); return [u2.length, 읽은칸 > 2000]; })(), [1, true]);
지난줄.push(["", "", "", "새줄", "1", "새분", "", "", "", "", "45209999999"]);
//  닫힌 달 메모리는 탭을 건드리지 않는다(줄 수도 안 본다) — 뒤에 붙은 줄은 메모리 판에선 안 보이고, 「새로 읽는 판」(못 찾았을 때 책이 다시 도는 길)에서 보인다
읽은칸 = 0; 줄물음 = 0; const h3 = 찾기(지난, "45209999999");
check("메모리 판 — 탭을 하나도 안 건드린다(줄 수도 안 묻는다 · 뒤에 붙은 줄은 아직 모름)", [h3.length, 읽은칸, 줄물음], [0, 0, 0]);
ctx.PRP_KEYCACHE_LIVE_ = true; 읽은칸 = 0; const h4 = 찾기(지난, "45209999999"); ctx.PRP_KEYCACHE_LIVE_ = false;
check("새로 읽는 판 — 붙은 줄을 찾는다", [h4.length, h4[0] && h4[0].name, 읽은칸 > 2000], [1, "새분", true]);
읽은칸 = 0; const h5 = 찾기(지난, "45209999999");
check("새로 읽은 판으로 메모리가 갈렸다 — 다음엔 메모리로 찾는다", [h5.length, 읽은칸], [1, 16]);
둔시간.length = 0;
const 이번줄 = [["📊"], ["📦"], ["🏷️"], ...큰줄.map((r) => r.slice())];
const 이번 = 센탭("(2026년 10월) 발주 마감", 이번줄);
찾기(이번, "45201001234"); 읽은칸 = 0; const i2 = 찾기(이번, "45201001234");
check("이번 달 탭 — 담되 10분 (닫힌 달은 6시간)", [i2.length, 읽은칸, 둔시간[0]], [1, 16, 600]);
check("닫힌 달은 6시간", ctx.prpKeyColsCacheSec_(지난), 21600);
const 양식 = 센탭("전용양식", NK양식.getRange(1, 1, 2, 13).getDisplayValues());
check("전용양식 — 10분", ctx.prpKeyColsCacheSec_(양식), 600);
//  메모리로 고른 줄이 지금은 다른 송장(낮에 줄이 지워져 밀렸다) — 그 탭을 새로 읽어 옮겨 간 자리에서 찾는다
const 옮긴 = 이번줄.splice(3 + 1, 1)[0];   // 맨 앞 자료 줄을 지워 한 칸씩 밀린다
이번줄.push(옮긴);
읽은칸 = 0; const i3 = 찾기(이번, "45201001234");
check("고른 줄이 안 맞으면 그 탭을 새로 읽는다 — 밀린 자리에서 찾는다", [i3.length, i3[0] && i3[0].name, 읽은칸 > 2000], [1, "수취인1234", true]);
const i4 = 찾기(이번, "45201000000");
check("맨 뒤로 옮긴 줄도 찾는다", [i4.length, i4[0] && i4[0].name], [1, "수취인0"]);

console.log("[8] 책 전체 — 메모리로 못 찾으면 새로 읽어 한 번 더 (「없다」는 시트가 준다)");
{
  메모.clear();
  const 줄들 = [["📊"], ["📦"], ["🏷️"], ...큰줄.map((r) => r.slice())];
  const 구월 = 센탭("(2026년 9월) 발주 마감", 줄들);
  const 책 = { getSheetByName: (n) => (n === 구월.getName() ? 구월 : null) };
  ctx.SpreadsheetApp = { openById: () => 책 };
  const 훑 = (inv) => (tab, src, out) => ctx.prpScanTabForInvoice_(tab, inv, src, out);
  const sess = { fileId: "FILE1" };
  check("처음 — 찾는다", ctx.prpScanVendorBook_(sess, 훑("45201000100"), "inv:45201000100").matches.length, 1);
  줄들.push(["", "", "", "늦게붙은", "1", "늦은분", "", "", "", "", "45208888888"]);
  줄물음 = 0;
  const r = ctx.prpScanVendorBook_(sess, 훑("45208888888"), "inv:45208888888");
  check("메모리 뒤에 붙은 줄 — 다시 읽어 찾는다", [r.matches.length, r.matches[0] && r.matches[0].name, 줄물음 > 0, !!(r.timing && r.timing.live)], [1, "늦은분", true, true]);
  const r2 = ctx.prpScanVendorBook_(sess, 훑("45207777777"), "inv:45207777777");
  check("정말 없는 송장 — 다시 읽고도 0 (메모리 판에서 끝내지 않는다)", [r2.matches.length, !!(r2.timing && r2.timing.live)], [0, true]);
  check("다시 보는 판은 한 번만 (끝나면 메모리 판으로 돌아온다)", ctx.PRP_KEYCACHE_LIVE_, false);
}

console.log("[9] 수정 시각 + 한 번에 읽기 — 파일이 안 바뀌면 메모리만으로 «없다»까지, 바뀌면 한 번에 새로");
{
  메모.clear();
  //  흉내 낸 업체 파일 — 9월 마감(닫힌 달) · 10월 마감(이번 달). 값은 지어냄
  const 머리 = 큰줄[0];
  const 책 = {
    "(2026년 9월) 발주 마감": [["📊"], ["📦"], ["🏷️"], 머리, ["", "", "", "구월품목", "1", "구월분", "010-0000-0901", "", "", "", "45200000901"]],
    "(2026년 10월) 발주 마감": [["📊"], ["📦"], ["🏷️"], 머리, ["", "", "", "시월품목", "2", "시월분", "010-0000-1001", "", "", "", "45200001001"]],
  };
  let 시각 = 1000, api = 0, 막힘 = false;
  ctx.DriveApp = { getFileById: () => ({ getLastUpdated: () => new Date(시각) }) };
  ctx.ScriptApp = { getOAuthToken: () => "t" };
  const 범위 = (a1) => { const m = a1.match(/^'(.*)'!([A-Z]+)(\d+)?:([A-Z]+)(\d+)?$/); return { name: m[1].replace(/''/g, "'"), r1: m[3] ? +m[3] : 1, r2: m[5] ? +m[5] : null }; };
  const 답 = (o, code = 200) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(o) });
  ctx.UrlFetchApp = { fetch: (url) => {
    api++;
    if (막힘) return 답({ error: "PERMISSION_DENIED" }, 403);
    if (url.includes("?fields=sheets.properties.title")) return 답({ sheets: Object.keys(책).map((t) => ({ properties: { title: t } })) });
    if (url.includes("/values:batchGet")) {
      const rs = url.split("&").filter((p) => p.startsWith("ranges=")).map((p) => 범위(decodeURIComponent(p.slice(7))));
      return 답({ valueRanges: rs.map((r) => ({ values: 책[r.name].map((x) => x.slice()) })) });
    }
    const r = 범위(decodeURIComponent(url.split("/values/")[1].split("?")[0]));
    return 답({ values: 책[r.name].slice(r.r1 - 1, r.r2).map((x) => x.slice()) });
  } };
  ctx.SpreadsheetApp = { openById: () => { throw new Error("옛 길로 왔다"); } };
  const 훑 = (inv) => (tab, src, out) => ctx.prpScanTabForInvoice_(tab, inv, src, out);
  const sess = { fileId: "FILE9" };
  const 찾아 = (inv) => { api = 0; const r = ctx.prpScanVendorBook_(sess, 훑(inv), "inv:" + inv); return { n: r.matches.length, name: r.matches[0] && r.matches[0].name, how: r.timing && (r.timing.how || (r.timing.cached ? "결과메모리" : "옛길")), api }; };

  check("처음 — 한 번에 새로 읽어 찾는다(API 2번: 탭 목록·값)", 찾아("45200000901"), { n: 1, name: "구월분", how: "한 번에 새로 읽음", api: 2 });
  check("파일 안 바뀜 · 없는 송장 — 메모리만으로 바로 0 (API 0번)", 찾아("45299999999"), { n: 0, name: undefined, how: "메모리(파일 안 바뀜)", api: 0 });
  check("파일 안 바뀜 · 다른 송장 — 메모리로 고르고 그 줄만 API 로(1번)", 찾아("45200001001"), { n: 1, name: "시월분", how: "메모리(파일 안 바뀜)", api: 1 });
  check("방금 찾은 송장 — 결과 메모리 (파일 안 바뀜 확인 뒤)", 찾아("45200001001").how, "결과메모리");
  //  송장이 새로 수집됐다 — 줄이 붙고 수정 시각이 바뀐다
  책["(2026년 10월) 발주 마감"].push(["", "", "", "새품목", "1", "새분", "010-0000-1002", "", "", "", "45200001002"]);
  시각 = 2000;
  check("새로 수집된 송장 — 시각이 바뀌어 한 번에 새로 읽고 찾는다", 찾아("45200001002"), { n: 1, name: "새분", how: "한 번에 새로 읽음", api: 2 });
  check("그 뒤로는 다시 메모리만 (없는 송장 API 0번)", 찾아("45299999998"), { n: 0, name: undefined, how: "메모리(파일 안 바뀜)", api: 0 });
  //  시각은 그대로인데 줄이 밀렸다(믿음이 틀린 경우) — 고른 줄이 안 맞으면 알아채고 새로 읽는다
  책["(2026년 10월) 발주 마감"].splice(4, 1);
  책["(2026년 10월) 발주 마감"].push(["", "", "", "시월품목", "2", "시월분", "010-0000-1001", "", "", "", "45200001001"]);
  메모.forEach((v, k) => { if (v.includes("matches")) 메모.delete(k); });   // 결과 메모리는 비우고 탭 메모리만으로
  const 밀림 = 찾아("45200001002");
  check("시각이 그대로여도 고른 줄이 안 맞으면 새로 읽어 맞는 줄을 준다", [밀림.n, 밀림.name, 밀림.how], [1, "새분", "한 번에 새로 읽음"]);
  //  API 가 막히면 옛 길 — 여기선 옛 길이 openById 에서 던진다(옛 길로 갔다는 표시)
  막힘 = true; 시각 = 3000;
  let 옛길 = false; try { 찾아("45200000901"); } catch (e) { 옛길 = /옛 길로 왔다/.test(e.message); }
  check("API 가 막히면 옛 길(탭 하나씩)로 간다", 옛길, true);
}

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
