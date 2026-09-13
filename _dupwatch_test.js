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


/* ═══════════════════════════════════════════════════════════════
   같은 회차에 겹친 줄 막기 (2026-09-13)

   > "같은 주문이 3개가 중복출고가 되는 상황"
   > "합배송이 아니야 세트상품이라 2개로 분리되는... 그래서 결국 6개"
   > "중복검사를 통과한것도 문제네"

   2026-09-10 아주팩: 소스에 같은 주문이 세 줄, 세트가 몸통·뚜껑으로
   쪼개져 전용양식에 여섯 줄 → 물건이 여섯 번 나갔다.

   못 막은 이유: 전용양식 dedup 은 «UID 발생횟수»만 센다.
   「한 주문에 품목 셋」과 「같은 줄이 셋」이 둘 다 3회라 구분이 안 된다.
   임시기록은 UID+품목코드로 접고 있어 멀쩡했고, 중복검사는 임시기록만
   보고 있어 통과시켰다 — 두 결함이 서로를 가렸다.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const src = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
  let ok = true;
  const t = (label, got, want) => {
    const p = JSON.stringify(got) === JSON.stringify(want);
    if (!p) { ok = false; console.log("   FAIL " + label + " → " + JSON.stringify(got) +
      " (기대 " + JSON.stringify(want) + ")"); }
  };

  // ── 두 푸시 경로에 다 있는가 ──
  const 자리 = [];
  let at = -1;
  while ((at = src.indexOf("if (_runRowSeen_[_runRowKey_])", at + 1)) >= 0) 자리.push(at);
  t("두 푸시 경로에 모두 있다", 자리.length, 2);

  // ── «세기»보다 먼저 있는가 ──
  //    버릴 줄까지 세면 재푸시 때 「이미 있는 수」와 비교가 어긋나
  //    다음 회차가 통째로 스킵된다. 순서가 곧 정확성이다.
  const 셈 = [];
  at = -1;
  while ((at = src.indexOf("_dedupOccurrenceInRun_[_dedupKey_] =", at + 1)) >= 0) 셈.push(at);
  t("발생횟수 세는 곳도 둘", 셈.length, 2);
  t("경로1 — 막기가 세기보다 먼저", 자리[0] < 셈[0], true);
  t("경로2 — 막기가 세기보다 먼저", 자리[1] < 셈[1], true);

  // ── 임시기록과 «같은 기준»인가 ──
  //    이 둘이 갈라지면 또 「임시기록엔 1개인데 발주는 3개」가 된다.
  t("막기 키 = 고유ID + 품목코드",
    /_runRowKey_ = _rowUid_ \? _rowUid_ \+ "\|" \+ rawCode : ""/.test(src), true);
  t("임시기록 키도 고유ID + 품목코드",
    /var compositeKey = uid \+ "\|" \+ code;/.test(src), true);

  // ── 화면에 숫자가 뜨는가 (조용히 버리지 않는다) ──
  t("스킵 합계에 들어간다", (src.match(/skipUid \+ skipSameRow \+/g) || []).length, 3);
  t("모달에 줄이 있다", src.includes("같은 회차에 겹친 줄 (주문+품목 동일)"), true);

  /* ── 실제로 몇 줄이 나가는가 ──
     소스의 판단 순서를 그대로 흉내 낸다. 위에서 «순서»와 «키»를 이미
     소스에서 확인했으므로, 이 흉내가 소스와 갈라지면 위 시험이 먼저 깨진다. */
  function 푸시(소스줄, 전용양식기존) {
    const 본줄 = {}, 발생 = {}, 나간것 = [];
    let 겹침 = 0, 이미 = 0;
    for (const r of 소스줄) {
      const 줄키 = r.uid ? r.uid + "|" + r.code : "";
      if (줄키) {
        if (본줄[줄키]) { 겹침++; continue; }
        본줄[줄키] = true;
      }
      발생[r.uid] = (발생[r.uid] || 0) + 1;
      if (발생[r.uid] <= (전용양식기존[r.uid] || 0)) { 이미++; continue; }
      나간것.push(r);
    }
    return { 나간것, 겹침, 이미 };
  }

  //  아주팩 그날 — 같은 주문 셋 × 세트 2분해
  const 세트 = [];
  for (let i = 0; i < 3; i++) {
    세트.push({ uid: "2161234567", code: "AJ00011-BODY" });
    세트.push({ uid: "2161234567", code: "AJ00011-LID" });
  }
  const r1 = 푸시(세트, {});
  t("★ 여섯 줄이 두 줄로", r1.나간것.length, 2);
  t("몸통·뚜껑이 둘 다 남는다",
    r1.나간것.map((x) => x.code), ["AJ00011-BODY", "AJ00011-LID"]);
  t("겹쳐서 버린 줄 넷", r1.겹침, 4);

  //  한 주문에 품목 셋 — 이건 중복이 아니다. 다 나가야 한다.
  const 셋품목 = [
    { uid: "2169999999", code: "A1" },
    { uid: "2169999999", code: "B2" },
    { uid: "2169999999", code: "C3" },
  ];
  t("★ 서로 다른 품목 셋은 다 나간다", 푸시(셋품목, {}).나간것.length, 3);

  //  재푸시 — 이미 전용양식에 두 줄이 있으면 하나도 더 안 나간다
  const r2 = 푸시(세트, { "2161234567": 2 });
  t("★ 재푸시는 0건", r2.나간것.length, 0);
  t("이미 나간 것으로 센다", r2.이미, 2);

  //  고유ID 가 없는 줄은 막기에서 건드리지 않는다 (확신 없이 버리지 않는다)
  const 무UID = [{ uid: "", code: "A1" }, { uid: "", code: "A1" }];
  t("고유ID 없으면 그대로 둔다", 푸시(무UID, {}).겹침, 0);

  console.log((ok ? "PASS " : "FAIL ") + "겹친 줄 막기 (중복 발주)");
  all = all && ok;
})();

console.log("");
console.log(all ? "ALL PASS" : "SOME FAILED");
process.exit(all ? 0 : 1);
