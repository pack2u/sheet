/**
 * _partnerInvoiceOwnerDiag.gs 판정 로직 검증 (일회성 로컬 테스트)
 * 실행: node _invowner_test.js
 *
 * 검증 대상은 _iod_judge_ 하나다.
 * 시트 읽기·쓰기는 제외하고 "충돌이냐 아니냐"만 본다.
 */
const fs = require("fs");
const vm = require("vm");

/** 소스에서 함수/배열 선언 하나를 잘라낸다 */
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
const diagSrc = fs.readFileSync("_partnerInvoiceOwnerDiag.gs", "utf8");

const src = [
  extract(pushSrc, "var _PEP_SIDO_ALIAS_ = ["),
  "var _PEP_ITEM_KEY_LEN_ = 10;",
  extract(pushSrc, "function _pep_normRecipName_("),
  extract(pushSrc, "function _pep_itemKey_("),
  "var _IOD_STALE_GAP_DAYS_ = 2;",
  extract(diagSrc, "function _iod_toDate_("),
  extract(diagSrc, "function _iod_dayDiff_("),
  extract(diagSrc, "function _iod_orderIdentity_("),
  extract(diagSrc, "function _iod_judge_("),
].join("\n\n");

const ctx = { console, Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(src, ctx);

/** 주장 하나를 만든다 — _iod_claim_ 이 채우는 파생 필드까지 포함 */
function claim(o) {
  const c = {
    where: o.where || "일일마감_2026-08-20",
    src: o.src || "",
    oid: o.oid || "",
    name: o.name || "",
    phone: o.phone || "",
    item: o.item || "",
    dateStr: o.dateStr || "",
    row: o.row || 2,
  };
  c.nameKey = vm.runInContext("_pep_normRecipName_", ctx)(c.name);
  c.itemKey = vm.runInContext("_pep_itemKey_", ctx)(c.item);
  c.date = vm.runInContext("_iod_toDate_", ctx)(c.dateStr);
  return c;
}

const judge = vm.runInContext("_iod_judge_", ctx);

let pass = 0;
let fail = 0;

function run(title, claims, expect) {
  const got = judge(claims);
  const grade = got ? got.grade : "(충돌아님)";
  const ok = grade === expect.grade;
  let ownerOk = true;
  if (ok && expect.owner !== undefined) {
    const oi = got.owner ? claims.indexOf(got.owner) : -1;
    ownerOk = oi === expect.owner;
    if (!ownerOk) {
      console.log(`  주인추정 기대 idx=${expect.owner}, 실제 idx=${oi}`);
    }
  }
  if (ok && ownerOk) {
    pass++;
    console.log(`✅ ${title}`);
    if (got) console.log(`     ${got.reason}`);
  } else {
    fail++;
    console.log(`❌ ${title}`);
    console.log(`     기대: ${expect.grade} / 실제: ${grade}`);
    if (got) console.log(`     사유: ${got.reason}`);
  }
}

console.log("═══ _iod_judge_ 검증 ═══\n");

// 1. 같은 주문이 원장·마감·허브에 각각 적힌 것 → 충돌 아님
run(
  "같은 고유ID 가 여러 위치에 기록 → 정상",
  [
    claim({ where: "송장원장", oid: "0827-1234-ABCD", name: "홍길동", dateStr: "2026-08-27" }),
    claim({ where: "허브", oid: "0827-1234-ABCD", name: "홍길동", dateStr: "2026-08-27" }),
    claim({ where: "일일마감_2026-08-27", oid: "0827-1234-ABCD", name: "홍길동", dateStr: "2026-08-27" }),
  ],
  { grade: "(충돌아님)" }
);

// 2. 수취인이 다른 두 주문에 같은 송장 → 확실
run(
  "수취인이 다름 → 🔴 확실",
  [
    claim({ oid: "A1", name: "홍길동", dateStr: "2026-08-20" }),
    claim({ oid: "B2", name: "김철수", dateStr: "2026-08-21" }),
  ],
  { grade: "🔴 확실", owner: 0 }
);

// 3. 이것이 신고된 증상 — 같은 사람, 주문일 벌어짐
run(
  "같은 사람 · 주문일 7일 차 → 🔴 확실 (과거 송장 유용)",
  [
    claim({ oid: "OLD", name: "홍길동", dateStr: "2026-08-13", item: "종이컵 6.5oz" }),
    claim({ oid: "NEW", name: "홍길동", dateStr: "2026-08-20", item: "종이컵 6.5oz" }),
  ],
  { grade: "🔴 확실", owner: 0 }
);

// 4. 경계값 — 정확히 2일 차이면 확실
run(
  "같은 사람 · 주문일 2일 차 (경계) → 🔴 확실",
  [
    claim({ oid: "OLD", name: "홍길동", dateStr: "2026-08-18" }),
    claim({ oid: "NEW", name: "홍길동", dateStr: "2026-08-20" }),
  ],
  { grade: "🔴 확실", owner: 0 }
);

// 5. 하루 차이는 분할 출고일 수 있다
run(
  "같은 사람 · 주문일 1일 차 → 🟡 의심",
  [
    claim({ oid: "A", name: "홍길동", dateStr: "2026-08-19" }),
    claim({ oid: "B", name: "홍길동", dateStr: "2026-08-20" }),
  ],
  { grade: "🟡 의심", owner: 0 }
);

// 6. 같은 날 다른 고유ID → 의심
run(
  "같은 사람 · 같은 날 · 고유ID 다름 → 🟡 의심",
  [
    claim({ oid: "A", name: "홍길동", dateStr: "2026-08-20" }),
    claim({ oid: "B", name: "홍길동", dateStr: "2026-08-20" }),
  ],
  { grade: "🟡 의심", owner: 0 }
);

// 7. 고유ID 없는 건은 사람+품목+날짜로 정체를 잡는다
run(
  "고유ID 없음 · 같은 사람·품목·날짜 → 정상 (한 주문)",
  [
    claim({ where: "송장원장", name: "홍길동", item: "종이컵 6.5oz", dateStr: "2026-08-20" }),
    claim({ where: "허브", name: "홍길동", item: "종이컵 6.5oz", dateStr: "2026-08-20" }),
  ],
  { grade: "(충돌아님)" }
);

// 8. 고유ID 없음 · 품목이 다르면 별개 주문 → 같은 송장이면 충돌
run(
  "고유ID 없음 · 품목 다름 · 같은 날 → 🟡 의심",
  [
    claim({ name: "홍길동", item: "종이컵 6.5oz", dateStr: "2026-08-20" }),
    claim({ name: "홍길동", item: "플라스틱 스푼", dateStr: "2026-08-20" }),
  ],
  { grade: "🟡 의심" }
);

// 9. 이름 표기가 흔들려도 같은 사람으로 본다
run(
  "이름 표기 차이 (공백·괄호) → 같은 사람으로 묶임",
  [
    claim({ oid: "A", name: "홍 길동", dateStr: "2026-08-13" }),
    claim({ oid: "B", name: "홍길동", dateStr: "2026-08-20" }),
  ],
  { grade: "🔴 확실", owner: 0 }
);

// 10. 날짜가 하나도 없으면 gap 을 못 재므로 의심에 머문다
run(
  "주문일 정보 없음 → 🟡 의심 (판정 근거 부족)",
  [
    claim({ oid: "A", name: "홍길동", dateStr: "" }),
    claim({ oid: "B", name: "홍길동", dateStr: "" }),
  ],
  { grade: "🟡 의심", owner: -1 }
);

// 11. 세 건 이상 — 가장 이른 것이 주인
run(
  "3개 주문에 같은 송장 → 가장 이른 주문이 주인",
  [
    claim({ oid: "MID", name: "홍길동", dateStr: "2026-08-18" }),
    claim({ oid: "OLD", name: "홍길동", dateStr: "2026-08-10" }),
    claim({ oid: "NEW", name: "홍길동", dateStr: "2026-08-25" }),
  ],
  { grade: "🔴 확실", owner: 1 }
);

// 12. yyyyMMdd 표기도 읽어야 한다
run(
  "주문일이 yyyyMMdd 표기 → 날짜차 계산됨",
  [
    claim({ oid: "OLD", name: "홍길동", dateStr: "20260813" }),
    claim({ oid: "NEW", name: "홍길동", dateStr: "20260820" }),
  ],
  { grade: "🔴 확실", owner: 0 }
);

// 13. 원장 관측일시(시각 포함)도 읽어야 한다
run(
  "주문일에 시각이 붙은 표기 → 날짜만 취함",
  [
    claim({ oid: "OLD", name: "홍길동", dateStr: "2026-08-13 09:12:00" }),
    claim({ oid: "NEW", name: "홍길동", dateStr: "2026-08-20 14:03:00" }),
  ],
  { grade: "🔴 확실", owner: 0 }
);

// 14. 수취인명을 안 남기는 원천이 섞여도 '다른 사람' 으로 오판하지 않아야 한다
run(
  "한쪽 수취인명 없음 → 이름 비교에서 제외, 🟡 의심에 머문다",
  [
    claim({ oid: "A", name: "", dateStr: "2026-08-20" }),
    claim({ oid: "B", name: "홍길동", dateStr: "2026-08-20" }),
  ],
  { grade: "🟡 의심" }
);

// 15. 이름 없는 기록이 섞였더라도 날짜가 벌어지면 확실이다
run(
  "수취인명 없는 기록 + 주문일 9일 차 → 🔴 확실",
  [
    claim({ oid: "OLD", name: "홍길동", dateStr: "2026-08-11" }),
    claim({ oid: "NEW", name: "", dateStr: "2026-08-20" }),
  ],
  { grade: "🔴 확실", owner: 0 }
);

// 16. 이름이 전부 없으면 사람 비교가 불가능하다 — 확실로 올리지 않는다
run(
  "양쪽 모두 수취인명 없음 · 같은 날 → 🟡 의심",
  [
    claim({ oid: "A", name: "", dateStr: "2026-08-20" }),
    claim({ oid: "B", name: "", dateStr: "2026-08-20" }),
  ],
  { grade: "🟡 의심" }
);

console.log(`\n═══ 결과: ${pass} 통과 / ${fail} 실패 ═══`);
process.exit(fail ? 1 : 0);
