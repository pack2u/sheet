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


/* ═══════════════════════════════════════════════════════════════
   중복검사가 «물건이 나간 자리»를 본다 (2026-09-14)

   > "중복검사도 전용양식 보게 고쳐줘"

   여태 중복검사는 대리공급_임시기록만 읽었다. 그런데 임시기록에 쓰는
   쪽이 고유ID+품목코드로 접어 두 줄이 생길 수가 없어, 「확실」 가지는
   켜질 수 없는 가지였다. 2026-09-10 아주팩 이지원 건(임시기록 2줄 ·
   전용양식 6줄 · 물건 6번)이 그래서 그냥 지나갔다.

   이제 양쪽을 맞댄다:
     기대 = 임시기록(+보관)에서 그 고유ID의 품목코드 가짓수
     실제 = 전용양식 AX + 당월·전월 마감탭의 그 고유ID 줄 수
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const src = fs.readFileSync("_partnerDupOrderCheck.gs", "utf8");
  let ok = true;
  const t = (label, got, want) => {
    const p = JSON.stringify(got) === JSON.stringify(want);
    if (!p) { ok = false; console.log("   FAIL " + label + " → " + JSON.stringify(got) +
      " (기대 " + JSON.stringify(want) + ")"); }
  };

  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(extract(src, "function _pdc_overOf_(") + "\n" +
    extract(src, "function _pdc_overLineOf_("), ctx);
  const over = (box, ax, arch) =>
    vm.runInContext("_pdc_overOf_(" + JSON.stringify(box) + "," +
      JSON.stringify(ax) + "," + JSON.stringify(arch) + ")", ctx);

  //  세트 한 건 — 몸통·뚜껑 두 줄이 정상이다. 조용해야 한다.
  const 세트 = { "2161234567": { uid: "2161234567", codes: { BODY: true, LID: true }, hits: [] } };
  t("세트 몸통+뚜껑은 정상", over(세트, { "2161234567": 2 }, {}).length, 0);

  //  아주팩 이지원 — 기대 2, 실제 6
  const r = over(세트, { "2161234567": 6 }, {});
  t("★ 초과를 잡는다", r.length, 1);
  t("실제 6", r[0].실제, 6);
  t("기대 2", r[0].기대, 2);
  t("★ 4줄 더 나갔다", r[0].초과, 4);

  //  마감이 옮겨 간 줄도 «나간 것»이다 — 합쳐서 센다
  const r2 = over(세트, { "2161234567": 2 }, { "2161234567": 4 });
  t("★ 마감탭 줄도 합쳐 센다", r2.length && r2[0].초과, 4);
  t("전용양식에만 있어도 같은 결과", over(세트, { "2161234567": 6 }, {})[0].초과, 4);

  //  실제가 기대보다 «적은» 것은 안 잡는다 (아직 안 나갔거나 업체가 지운 것)
  t("덜 나간 것은 안 잡는다", over(세트, { "2161234567": 1 }, {}).length, 0);
  t("아예 안 나간 것도 안 잡는다", over(세트, {}, {}).length, 0);

  //  한 주문에 품목 셋 — 기대 3. 셋이 나간 건 정상.
  const 셋 = { u1: { uid: "u1", codes: { A: true, B: true, C: true }, hits: [] } };
  t("품목 셋은 셋까지 정상", over(셋, { u1: 3 }, {}).length, 0);
  t("품목 셋인데 넷이면 잡는다", over(셋, { u1: 4 }, {})[0].초과, 1);

  //  빈 입력에 안 넘어진다
  t("box 없으면 빈 배열", over(null, {}, {}).length, 0);

  //  ── 붙어 있는가 ──
  t("메뉴가 전용양식을 본다", /var ex = _pdc_scanExclusive_\(\);/.test(src), true);
  t("푸시 직후에도 본다", /_pdc_scanExclusive_\(45000\)/.test(src), true);
  /* 점검이 업체 파일을 고치면 안 된다. _pep_loadExclusiveDedupCounts_ 는
     50열이 모자라면 칸을 «만든다» — 그래서 쓰지 않고 읽기만 하는 것을 따로 뒀다. */
  t("★ 칸을 만드는 로더를 «부르지» 않는다", src.includes("_pep_loadExclusiveDedupCounts_("), false);
  t("★ 전용양식 탭을 만드는 것도 «부르지» 않는다", src.includes("_pep_initVendorCache_("), false);
  t("읽기 전용 AX 세기가 있다", src.includes("function _pdc_axCounts_("), true);
  t("50열 모자라면 그냥 못 봤다고 한다", /getLastColumn\(\) < _PDC_AX_COL_/.test(src), true);

  console.log((ok ? "PASS " : "FAIL ") + "중복검사가 전용양식을 본다");
  all = all && ok;
})();


/* ═══════════════════════════════════════════════════════════════
   푸시 이어달리기 — 6분 한도에 통째로 죽지 않게 (2026-09-14)

   > "요즘 상품정보 스크립트 시간초과 현상이 자주 발생하는데"
   > "푸시에도 이어달리기 붙여줘"

   마감·월정산·재매칭은 2026-07-16 과 09-09 두 차례에 걸쳐
   「시간예산 + 커서 + 제 트리거」를 받았는데 푸시만 두 번 다 빠졌다.
   쓰기가 전부 루프 끝의 배치라, 6분에 걸리면 한 줄도 안 나가고 죽는다.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const src = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
  let ok = true;
  const t = (label, got, want) => {
    const p = JSON.stringify(got) === JSON.stringify(want);
    if (!p) { ok = false; console.log("   FAIL " + label + " → " + JSON.stringify(got) +
      " (기대 " + JSON.stringify(want) + ")"); }
  };

  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(extract(src, "function _pep_resumeStartRow_(") + "\n" +
    extract(src, "function _pep_cursorAgeMs_("), ctx);
  const start = (rows, cur) =>
    vm.runInContext("_pep_resumeStartRow_(" + JSON.stringify(rows) + "," +
      JSON.stringify(cur) + ")", ctx);

  //  소스탭 흉내 — [2] 가 일자-No.
  const 소스 = (...일자들) =>
    [["머리글", "", "일자-No."]].concat(일자들.map((d) => ["", "", d]));

  //  커서가 없으면 처음부터
  t("커서 없으면 1행", start(소스("A", "B", "C"), null), 1);
  t("stopAt 없으면 1행", start(소스("A", "B"), { next: 5 }), 1);

  //  멈춘 주문을 «이름»으로 찾는다
  t("★ 멈춘 주문을 이름으로 찾는다", start(소스("A", "B", "C", "D"), { stopAt: "C", next: 99 }), 3);
  t("첫 주문에서 멈췄으면 1행", start(소스("A", "B"), { stopAt: "A", next: 1 }), 1);

  /* ★ 줄번호만 믿으면 안 된다 ★
     두 조각 사이에 소스탭이 바뀌면 그 번호는 엉뚱한 주문을 가리킨다.
     앞에 줄이 끼어들어도 이름으로 찾으므로 자리가 밀리지 않는다. */
  t("★ 앞에 줄이 끼어도 제자리를 찾는다",
    start(소스("새주문", "A", "B", "C"), { stopAt: "C", next: 3 }), 4);

  //  이름을 못 찾으면 줄번호로 돌아간다
  /* ★ 못 찾으면 줄번호로 «돌아가지 않는다» ★
     못 찾았다 = 소스탭이 갈렸다는 뜻이다. 옛 줄번호(500)를 믿으면
     새 자료의 앞 499줄이 통째로 안 나가고 아무 말도 안 남는다. */
  t("★ 이름 못 찾으면 «처음부터» — 줄번호를 안 믿는다",
    start(소스("A", "B", "C", "D"), { stopAt: "없음", next: 3 }), 1);
  //  줄번호도 못 믿으면 처음부터 — 두 번 지나가도 dedup 이 막는다
  t("줄번호가 범위 밖이어도 1행", start(소스("A", "B"), { stopAt: "없음", next: 999 }), 1);
  //  ★ 오래된 커서는 버린다 — 트리거가 끊겨 커서만 남은 경우
  t("★ 12시간 넘은 커서는 안 믿는다",
    start(소스("A", "B", "C"), { stopAt: "C", next: 3, at: "2020-01-01 00:00:00" }), 1);
  t("방금 적은 커서는 믿는다",
    start(소스("A", "B", "C"), { stopAt: "C", next: 3,
      at: new Date().toISOString().slice(0, 19).replace("T", " ") }), 3);
  t("시각을 못 읽으면 그냥 믿는다",
    start(소스("A", "B", "C"), { stopAt: "C", next: 3, at: "알수없음" }), 3);
  t("줄번호가 0이면 1행", start(소스("A", "B"), { stopAt: "없음", next: 0 }), 1);
  t("빈 소스에 안 넘어진다", start([], { stopAt: "A", next: 2 }), 1);

  //  ── 구조 ──
  t("시간 예산이 있다", /_PEP_TIME_BUDGET_MS_ = 4\.5 \* 60 \* 1000/.test(src), true);
  t("커서 키가 있다", src.includes('_PEP_CURSOR_KEY_ = "_PEP_PUSH_CURSOR"'), true);
  t("이어달리기 함수가 있다", src.includes("function _pep_resume_()"), true);
  t("제 트리거만 지운다", /getHandlerFunction\(\) === _PEP_RESUME_FN_/.test(src), true);
  t("1분 뒤에 잇는다", /newTrigger\(_PEP_RESUME_FN_\)[\s\S]{0,60}after\(60 \* 1000\)/.test(src), true);

  /* ★ 끊는 자리는 주문이 바뀌는 곳 ★
     한 주문이 중간에 잘리면, 뒤 조각의 셋째 품목이 「occurrence <= 기존」 으로
     스킵돼 영영 안 나간다. 시간을 «일자-No. 가 바뀔 때만» 본다. */
  const 시간검사 = src.indexOf("new Date().getTime() - _시작ms_ > _PEP_TIME_BUDGET_MS_");
  const 경계 = src.indexOf("if (_일자No_ !== _직전일자No_) {");
  t("★ 시간 검사가 주문 경계 «안»에 있다", 경계 > 0 && 시간검사 > 경계, true);
  t("★ 첫 주문은 무조건 한 번 지나간다", /ri > _시작행_ &&/.test(src), true);

  /* ★ 커서는 «쓴 뒤»에 적는다 ★
     쓰기 전에 적으면 「커서엔 적혔는데 안 써진」 조각이 생긴다. */
  const 임시쓰기 = src.indexOf("[PEP] 임시탭 배치 쓰기: ");
  const 커서저장 = src.indexOf("_pep_saveCursor_({");
  t("★ 배치 쓰기가 커서 저장보다 먼저", 임시쓰기 > 0 && 임시쓰기 < 커서저장, true);

  //  회차 도장은 조각이 나뉘어도 하나 — 커서 것을 그대로 쓴다
  t("★ 도장을 커서에서 잇는다",
    /_PEP_PUSH_STAMP_ = \(_pepCur_ && _pepCur_\.stamp\)/.test(src), true);
  //  반쪽 상태에서 중복 점검을 돌리면 없는 중복이 보인다
  t("★ 마지막 조각에서만 중복 점검", /if \(!_PEP_LAST_INCOMPLETE_\) \{/.test(src), true);
  //  끝났으면 커서도 트리거도 치운다 — 남으면 다음에 엉뚱한 데서 시작한다
  t("끝나면 커서를 지운다", src.includes("_pep_clearCursor_();"), true);
  t("끝나면 트리거도 지운다", src.includes("_pep_dropResumeTriggers_();"), true);

  console.log((ok ? "PASS " : "FAIL ") + "푸시 이어달리기");
  all = all && ok;
})();


/* ═══════════════════════════════════════════════════════════════
   「1분 뒤 저절로 이어집니다」가 왜 한 번도 안 됐나 (2026-09-14)

   > "1분 뒤 저절로 이어집니다. 이런거는 여태 한번도 재실행 된적이 없어"

   구글은 스크립트당 트리거 20개까지다. 이 프로젝트의 예약 트리거가
   «정확히 20개» 라 새 일회성 트리거를 못 건다. 네 모듈(마감·월정산·
   재매칭·푸시)이 그 예외를 전부 catch 해서 Logger 에만 적고 넘어갔다.
   로그는 아무도 안 본다.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const push = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
  const web = fs.readFileSync("_partnerWebApp.gs", "utf8");
  let ok = true;
  const t = (label, got, want) => {
    const p = JSON.stringify(got) === JSON.stringify(want);
    if (!p) { ok = false; console.log("   FAIL " + label + " → " + JSON.stringify(got) +
      " (기대 " + JSON.stringify(want) + ")"); }
  };

  /* ★ 예약 트리거가 20개를 넘으면 이어달리기가 영영 안 걸린다 ★
     새 배치를 더할 때 이 시험이 먼저 깨지게 둔다. 자리를 먼저 비워야 한다. */
  const blk = web.slice(web.indexOf("var _ALL_SCHEDULED_TRIGGERS_ = ["));
  const 정의 = (blk.slice(0, blk.indexOf("];")).match(/\{ fn:/g) || []).length;
  t("예약 트리거를 세어 둔다", 정의 > 0, true);
  if (정의 >= 20) {
    console.log("   ※ 예약 트리거 " + 정의 + "개 — 구글 한도 20개. " +
      "일회성 이어달리기 트리거를 걸 자리가 없습니다.");
  }
  t("★ 예약 트리거가 한도를 넘지 않는다 (자리 하나는 남겨야 이어달린다)", 정의 <= 19, true);

  //  ── 못 걸었을 때 «말하는가» ──
  t("실패 이유를 돌려준다", /@return \{\{ok:boolean, why:string/.test(push), true);
  t("★ 화면에 「스스로 못 잇습니다」가 뜬다", push.includes("⚠ 스스로 못 잇습니다."), true);
  t("★ 한도를 숫자로 보여 준다", push.includes("구글 한도 20개"), true);
  t("★ 그럼 어떻게 되는지 말한다", push.includes("다음 정기 푸시(10:30·13:50·15:40)가 이어받습니다"), true);

  //  ── 자리가 없으면 다 쓴 것을 치우고 다시 해 본다 ──
  t("죽은 트리거 정리기가 있다", push.includes("function _pep_sweepDeadResumeTriggers_("), true);
  t("실패하면 치우고 다시 건다", /out\.swept = _pep_sweepDeadResumeTriggers_\(\);/.test(push), true);
  /* ★ 남의 «살아 있는» 이어달리기는 안 건드린다 ★
     커서가 있으면 그 모듈은 아직 이어달릴 일이 남은 것이다. */
  t("★ 커서가 없는 것만 죽은 것으로 본다", /if \(!cur\) 죽은이름\[kind\.fn\] = true;/.test(push), true);
  t("네 모듈을 다 안다", (push.match(/key: "_(PEP|PAR|PEA|PMS)_/g) || []).length, 4);

  //  ── 조사(census)는 읽기만 ──
  t("트리거 census 가 있다", push.includes("function _pep_triggerCensus_("), true);
  t("census 는 안 지운다",
    push.slice(push.indexOf("function _pep_triggerCensus_("),
      push.indexOf("function _pep_sweepDeadResumeTriggers_(")).includes("deleteTrigger"), false);

  console.log((ok ? "PASS " : "FAIL ") + "이어달리기 트리거 자리");
  all = all && ok;
})();


/* ═══════════════════════════════════════════════════════════════
   송장원장 — 안 바뀐 업체 파일은 열지도 않는다 (2026-09-14)

   > "상품정보 스크립트 실행 시간을 줄이는 방법은 없을까?"

   협력업체 파일이 48곳. 하나 여는 데 1초쯤이라 여는 데만 50초가 넘는데
   예산은 2분이다. 그래서 이 일은 거의 매번 중간에 끊겼고, 송장원장은 늘
   반쪽이었다 — 그 반쪽을 사방넷 대량등록이 원천으로 읽는다.

   2026-09-13 「업체_휴면」 기준 48곳 중 36곳(75%)이 이틀 넘게 조용하다.
   커서로 «새 줄만» 읽는 구조라, 안 바뀐 파일은 열어 봐야 0건이다.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const src = fs.readFileSync("_partnerInvoiceLedger.gs", "utf8");
  let ok = true;
  const t = (label, got, want) => {
    const p = JSON.stringify(got) === JSON.stringify(want);
    if (!p) { ok = false; console.log("   FAIL " + label + " → " + JSON.stringify(got) +
      " (기대 " + JSON.stringify(want) + ")"); }
  };

  t("수정시각 기록 키가 있다", src.includes('_PIL_MOD_PREFIX_ = "PIL_MOD:"'), true);
  t("★ 안 바뀐 파일은 건너뛴다",
    /_mod_ > 0 && _mod_ <= _pil_lastSeenMod_\(props, files\[fi\]\.id\)/.test(src), true);
  t("건너뛴 수를 센다", src.includes("stat.skippedQuiet++"), true);
  t("★ 화면에도 적는다", src.includes("안 바뀌어 안 연 업체 파일"), true);

  /* ★ 다 읽은 «뒤»에 적어야 한다 ★
     중간에 예산이 끊겨 덜 읽고 적으면, 다음 실행이 그 파일을 건너뛰어
     그 줄들이 영영 안 들어온다. */
  const 달루프 = src.indexOf('mLabel + "발주 마감", "발주마감:" + vendor, "order");');
  const 적기 = src.indexOf("_pil_setSeenMod_(props, files[fi].id, _mod_);");
  t("★ 두 달을 다 읽은 뒤에 적는다", 달루프 > 0 && 적기 > 달루프, true);

  /* 커서를 초기화하면 수정시각도 같이 지워야 한다.
     안 그러면 「처음부터 다시 읽어라」가 «안 바뀌었으니 건너뛴다»에 막힌다. */
  const 초기화 = src.slice(src.indexOf("function partnerResetInvoiceLedgerCursors("));
  t("★ 초기화가 수정시각도 지운다",
    초기화.slice(0, 600).includes("_PIL_MOD_PREFIX_"), true);

  //  파일 목록이 최종수정 시각을 들고 있어야 이게 성립한다
  const dep = fs.readFileSync("_partnerDeploy.gs", "utf8");
  t("★ 파일 목록이 최종수정 시각을 준다",
    /modified: f\.getLastUpdated\(\)\.getTime\(\)/.test(dep), true);

  console.log((ok ? "PASS " : "FAIL ") + "송장원장 — 조용한 파일 건너뛰기");
  all = all && ok;
})();

console.log("");
console.log(all ? "ALL PASS" : "SOME FAILED");
process.exit(all ? 0 : 1);
