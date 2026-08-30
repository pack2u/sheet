/**
 * _partnerDupWatch.gs 판정 로직 검증 (일회성 로컬 테스트)
 * 실행: node _dupwatch_test.js
 */
const fs = require("fs");
const vm = require("vm");

/**
 * 소스에서 선언 하나를 잘라낸다.
 * 함수는 본문 여는 중괄호부터 짝을 세고, 배열 변수는 대괄호 짝을 센다.
 */
function extract(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error("not found: " + decl);

  const isFn = decl.startsWith("function");
  const open = isFn ? "{" : "[";
  const close = isFn ? "}" : "]";
  const from = isFn ? src.indexOf("{", at) : src.indexOf("[", at);
  if (from < 0) throw new Error("no body: " + decl);

  let depth = 0;
  for (let j = from; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) {
      depth--;
      if (depth === 0) {
        let end = j + 1;
        if (!isFn && src[end] === ";") end++;
        return src.slice(at, end);
      }
    }
  }
  throw new Error("unbalanced: " + decl);
}

const pushSrc = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
const ordersSrc = fs.readFileSync("_partnerOrders.gs", "utf8");

const helpers = [
  extract(pushSrc, "var _PEP_SIDO_ALIAS_ = ["),
  "var _PEP_ADDR_KEY_LEN_ = 12;",
  extract(pushSrc, "function _pep_normRecipName_("),
  extract(pushSrc, "function _pep_phoneDigits_("),
  extract(pushSrc, "function _pep_addrKey_("),
  extract(ordersSrc, "function _po_normalizeCode("),
  'var _PO_HUB_SHEET_NAME = "\uD611\uB825\uC5C5\uCE60_\uBC1C\uC8FC\uD5C8\uBE0C";',
].join("\n\n");

const ctx = {
  console,
  Logger: { log() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const p = (n, w = 2) => String(n).padStart(w, "0");
      return fmt
        .replace("yyyy", d.getFullYear())
        .replace("MM", p(d.getMonth() + 1))
        .replace("dd", p(d.getDate()))
        .replace("HH", p(d.getHours()))
        .replace("mm", p(d.getMinutes()))
        .replace("ss", p(d.getSeconds()));
    },
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getUi: () => { throw new Error("no ui"); },
  },
};
vm.createContext(ctx);
vm.runInContext(helpers, ctx);
vm.runInContext(fs.readFileSync("_partnerDupWatch.gs", "utf8"), ctx);

// ── 테스트 데이터 ──────────────────────────────────────
let seq = 100;
function rec(o) {
  return Object.assign({
    at: "2026-08-27 09:00:00", batch: 1, batchLabel: "오전",
    hubRow: ++seq, vendor: "A업체", uid: "", orderDate: "20260827",
    code: "P001", item: "냅킨300", qty: "1",
    name: "홍길동", phone: "010-1234-5678", addr: "서울특별시 강남구 테헤란로 123",
    inv: "", status: "",
  }, o);
}
const PM = { batch: 2, batchLabel: "오후", at: "2026-08-27 14:00:00" };

const R_SURE_NP = "수취인+전화+품목코드 일치";
const R_DOUBT = "수취인+품목코드 일치 (전화 다름/없음)";
const R_ADDR = "주소+품목코드 일치 (수취인 다름)";

let all = true;

function run(label, records, expect) {
  const groups = ctx._dw_findSuspects_(records);
  const got = groups.map(g => ({
    grade: g.grade, reason: g.reason, spans: g.spansBatch,
    rows: g.members.map(m => records[m].hubRow),
  }));
  const pass = JSON.stringify(got) === JSON.stringify(expect);
  console.log((pass ? "PASS " : "FAIL ") + label);
  if (!pass) {
    console.log("   기대: " + JSON.stringify(expect));
    console.log("   실제: " + JSON.stringify(got));
  }
  all = all && pass;
}

// 1) 오전·오후에 같은 사람 같은 품목 + 전화 동일 → 확실, 회차 간
run("오전-오후 완전 일치", [
  rec({}),
  rec(Object.assign({}, PM)),
], [{ grade: "🔴 확실", reason: R_SURE_NP, spans: true, rows: [101, 102] }]);

// 2) 전화 표기만 다름(하이픈 유무)
run("전화 표기 차이 흡수", [
  rec({ phone: "010-1234-5678" }),
  rec(Object.assign({ phone: "01012345678" }, PM)),
], [{ grade: "🔴 확실", reason: R_SURE_NP, spans: true, rows: [103, 104] }]);

// 3) 이름 뒤 '님' / 공백 차이 흡수
run("수취인 표기 차이 흡수", [
  rec({ name: "홍 길동" }),
  rec(Object.assign({ name: "홍길동님" }, PM)),
], [{ grade: "🔴 확실", reason: R_SURE_NP, spans: true, rows: [105, 106] }]);

// 4) 전화가 다르면 의심으로 내려감
run("전화 다름 → 의심", [
  rec({ phone: "010-1111-2222" }),
  rec(Object.assign({ phone: "010-9999-8888" }, PM)),
], [{ grade: "🟡 의심", reason: R_DOUBT, spans: true, rows: [107, 108] }]);

// 5) 이름 다르고 주소·품목 같음 → 참고 (가족 주문 가능)
run("이름 다름·주소 같음 → 참고", [
  rec({ name: "홍길동" }),
  rec(Object.assign({ name: "김영희", phone: "010-5555-6666" }, PM)),
], [{ grade: "⚪ 참고", reason: R_ADDR, spans: true, rows: [109, 110] }]);

// 6) 주소 표기 차이(시도 축약·괄호·쉼표) 흡수
run("주소 표기 차이 흡수", [
  rec({ name: "홍길동", addr: "서울특별시 강남구 테헤란로 123, 4층" }),
  rec(Object.assign({
    name: "김영희", phone: "010-5555-6666",
    addr: "서울 강남구 테헤란로 123 (역삼동)",
  }, PM)),
], [{ grade: "⚪ 참고", reason: R_ADDR, spans: true, rows: [111, 112] }]);

// 7) 품목이 다르면 아무것도 안 잡힘
run("품목 다름 → 무시", [
  rec({ code: "P001" }),
  rec(Object.assign({ code: "P002" }, PM)),
], []);

// 8) 동일 고유ID → 최상위 등급, 하위 등급 중복 출력 없음
run("동일 고유ID 단일 그룹", [
  rec({ uid: "SB-999" }),
  rec(Object.assign({ uid: "SB-999" }, PM)),
], [{ grade: "🔴 확실", reason: "동일 고유ID", spans: true, rows: [115, 116] }]);

// 9) 같은 회차 내 중복은 spans=false 로 구분
run("같은 회차 내 중복", [
  rec({}),
  rec({}),
], [{ grade: "🔴 확실", reason: R_SURE_NP, spans: false, rows: [117, 118] }]);

// 10) 미업로드 건과 오전 업로드 건이 겹치는 경우 (오후 업로드 전 차단)
run("오전-미업로드", [
  rec({}),
  rec({ batch: 99, batchLabel: "미업로드", at: "2026-08-27 15:20:00" }),
], [{ grade: "🔴 확실", reason: R_SURE_NP, spans: true, rows: [119, 120] }]);

// 11) 같은 주소·품목이 6건 이상이면 대량발송 패턴으로 제외
(function () {
  const bulk = [];
  for (let i = 0; i < 6; i++) {
    bulk.push(rec({
      name: "수령인" + i, phone: "010-000-" + i,
      addr: "경기도 화성시 창고로 1",
    }));
  }
  const groups = ctx._dw_findSuspects_(bulk);
  const pass = groups.length === 0 && groups.skippedBulk === 1;
  console.log((pass ? "PASS " : "FAIL ") + "대량발송 패턴 제외");
  if (!pass) {
    console.log("   실제 그룹 " + groups.length + " / skippedBulk " + groups.skippedBulk);
  }
  all = all && pass;
})();

// 12) 전화가 짧아 신뢰 못 할 때는 확실 등급으로 올리지 않음
run("전화 자릿수 부족 → 의심", [
  rec({ phone: "1234" }),
  rec(Object.assign({ phone: "1234" }, PM)),
], [{ grade: "🟡 의심", reason: R_DOUBT, spans: true, rows: [127, 128] }]);

// 13) 정렬 — 회차 간이 같은 회차보다 위
(function () {
  const recs = [
    rec({ name: "같은회차A" }), rec({ name: "같은회차A" }),
    rec({ name: "회차간B" }), rec(Object.assign({ name: "회차간B" }, PM)),
    rec({ name: "회차간C", phone: "010-1111-1111" }),
    rec(Object.assign({ name: "회차간C", phone: "010-2222-2222" }, PM)),
  ];
  const groups = ctx._dw_findSuspects_(recs);
  const order = groups.map(g => (g.spansBatch ? "간" : "내") + g.grade.slice(0, 2));
  const pass = order.length === 3 &&
    order[0] === "간🔴" && order[1] === "간🟡" && order[2] === "내🔴";
  console.log((pass ? "PASS " : "FAIL ") + "정렬 (회차 간 우선 → 등급)");
  if (!pass) console.log("   실제: " + JSON.stringify(order));
  all = all && pass;
})();

// 14) 날짜·회차 유틸
(function () {
  const d = ctx._dw_toDate_("2026-08-27 09:12:03");
  const ok1 = d && ctx._dw_dateKey_(d) === "2026-08-27";
  const ok2 = ctx._dw_batchLabel_(ctx._dw_toDate_("2026-08-27 09:00:00")) === "오전";
  const ok3 = ctx._dw_batchLabel_(ctx._dw_toDate_("2026-08-27 14:00:00")) === "오후";
  // vm 컨텍스트와 호스트의 Date 가 다른 realm 이므로 안에서 만든다
  const inCtxDate = vm.runInContext("new Date(2026, 7, 27)", ctx);
  const ok4 = ctx._dw_orderDateText_(inCtxDate) === "20260827";
  const ok5 = ctx._dw_isDeadStatus_("취소요청") === true &&
    ctx._dw_isDeadStatus_("발송완료") === false;
  const pass = ok1 && ok2 && ok3 && ok4 && ok5;
  console.log((pass ? "PASS " : "FAIL ") + "날짜·회차·상태 유틸");
  if (!pass) console.log("   " + JSON.stringify([ok1, ok2, ok3, ok4, ok5]));
  all = all && pass;
})();

console.log("");
console.log(all ? "ALL PASS" : "SOME FAILED");
process.exit(all ? 0 : 1);
