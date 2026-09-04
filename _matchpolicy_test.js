/**
 * 송장 매칭 정책 검증 (일회성 로컬 테스트)
 * 실행: node _matchpolicy_test.js
 *
 * 검증 대상
 *   ① 고유ID 가 있으면 고유ID 로만 — 이름·전화로 안 내려간다
 *   ② 고유ID 가 없으면 이름·전화·주소·상품명 **조합**만 — 단일 필드는 안 쓴다
 */
const fs = require("fs");
const vm = require("vm");

function extract(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error("not found: " + decl);
  const isFn = decl.startsWith("function");
  const open = isFn ? "{" : "[";
  const close = isFn ? "}" : "]";
  const from = isFn ? src.indexOf("{", at) : src.indexOf("[", at);
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
const helpSrc = fs.readFileSync("_partnerHelpers.gs", "utf8");
const refixSrc = fs.readFileSync("_partnerArchiveInvoiceRefix.gs", "utf8");

let allowSingle = false;

const src = [
  extract(pushSrc, "var _PEP_SIDO_ALIAS_ = ["),
  "var _PEP_ADDR_KEY_LEN_ = 12;",
  "var _PEP_ITEM_KEY_LEN_ = 10;",
  extract(pushSrc, "function _pep_normRecipName_("),
  extract(pushSrc, "function _pep_phoneDigits_("),
  extract(pushSrc, "function _pep_phone7_("),
  extract(pushSrc, "function _pep_isMaskedPhone_("),
  extract(pushSrc, "function _pep_addrKey_("),
  extract(pushSrc, "function _pep_itemKey_("),
  extract(pushSrc, "function _pep_normInvoiceNo_("),
  extract(pushSrc, "function _pep_splitInvNos_("),
  extract(pushSrc, "function _pep_normalizeMatchUid_("),
  extract(pushSrc, "function _pep_uidFromOrdererCell_("),
  extract(pushSrc, "function _pep_isRealUid_("),
  extract(pushSrc, "function _pep_addInvoiceMap_("),
  extract(pushSrc, "function _pep_invCount_("),
  extract(pushSrc, "function _pep_lookupInvoiceMap_("),
  extract(pushSrc, "function _pep_resolveRowInvoice_("),
  extract(pushSrc, "function _pep_addNamePhoneInvoiceKeys_("),
  extract(pushSrc, "function _pep_lookupNamePhoneInvoice_("),
  'var _PT_MATCH_SINGLE_FIELD_PROP_ = "INVOICE_MATCH_ALLOW_SINGLE_FIELD";',
  "var _PT_MATCH_SINGLE_CACHE_ = null;",
  extract(helpSrc, "function _pt_allowSingleFieldMatch_("),
  extract(refixSrc, "function _par_qtyNum_("),
  extract(refixSrc, "function _par_isSetItem_("),
  extract(refixSrc, "function _par_slotSpec_("),
  extract(refixSrc, "function _par_decideRow_("),
].join("\n\n");

const ctx = {
  console,
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => (allowSingle ? "true" : ""),
    }),
  },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const addKeys = vm.runInContext("_pep_addNamePhoneInvoiceKeys_", ctx);
const lookup = vm.runInContext("_pep_lookupNamePhoneInvoice_", ctx);

function resetPolicyCache() {
  vm.runInContext("_PT_MATCH_SINGLE_CACHE_ = null;", ctx);
}

let pass = 0;
let fail = 0;

function check(title, got, want) {
  const ok = got === want;
  if (ok) {
    pass++;
    console.log(`✅ ${title}`);
  } else {
    fail++;
    console.log(`❌ ${title}\n     기대: ${want}\n     실제: ${got}`);
  }
}

// ═══════════════════════════════════════════
//  ② 단일 필드 매칭 차단
// ═══════════════════════════════════════════
console.log("═══ ② 고유ID 없는 건 — 조합키만 허용 ═══\n");

allowSingle = false;
resetPolicyCache();

// 롯데처럼 전화·주소가 없고 이름+상품명만 있는 원천
{
  const map = {};
  addKeys(map, "홍길동", "", "1234567890", "롯데", { item: "종이컵 6.5oz" });

  // 이름+상품명이 맞으면 붙는다
  let via = {};
  let hit = lookup(map, "홍길동", "", "", "종이컵 6.5oz", via);
  check("롯데(이름+상품명) · 상품명 일치 → 매칭", hit ? via.via : "(없음)", "NI");

  // 상품명이 다르면 안 붙는다 (종전에는 NAME 단독으로 붙었다)
  via = {};
  hit = lookup(map, "홍길동", "", "", "플라스틱 스푼", via);
  check("롯데 · 상품명 불일치 → 미매칭 (이름 단독 차단)", hit ? via.via : "(없음)", "(없음)");

  // 상품명이 아예 없으면 안 붙는다
  via = {};
  hit = lookup(map, "홍길동", "", "", "", via);
  check("롯데 · 상품명 없음 → 미매칭", hit ? via.via : "(없음)", "(없음)");
}

// 전화만 같고 이름이 다른 경우 — 전화 단독 매칭이 막혀야 한다
{
  const map = {};
  addKeys(map, "홍길동", "010-1234-5678", "1111111111", "대리판매", {});

  let via = {};
  let hit = lookup(map, "김철수", "010-1234-5678", "", "", via);
  check("이름 다름 · 전화 같음 → 미매칭 (전화 단독 차단)", hit ? via.via : "(없음)", "(없음)");

  via = {};
  hit = lookup(map, "홍길동", "010-1234-5678", "", "", via);
  check("이름+전화 일치 → 매칭 (조합키는 유효)", hit ? via.via : "(없음)", "NP7");
}

// 이름+주소 조합
{
  const map = {};
  addKeys(map, "홍길동", "", "2222222222", "대리판매", {
    addr: "서울특별시 강남구 테헤란로 1",
  });
  const via = {};
  const hit = lookup(map, "홍길동", "", "서울특별시 강남구 테헤란로 1", "", via);
  check("이름+주소 일치 → 매칭", hit ? via.via : "(없음)", "NA");
}

// ═══════════════════════════════════════════
//  속성으로 되돌리면 단일 필드가 다시 살아난다
// ═══════════════════════════════════════════
console.log("\n═══ 되돌리기 (INVOICE_MATCH_ALLOW_SINGLE_FIELD=true) ═══\n");

allowSingle = true;
resetPolicyCache();

{
  const map = {};
  addKeys(map, "홍길동", "", "1234567890", "롯데", { item: "종이컵 6.5oz" });
  const via = {};
  const hit = lookup(map, "홍길동", "", "", "플라스틱 스푼", via);
  check("속성 ON · 상품명 불일치 → NAME(롯데) 로 매칭", hit ? via.via : "(없음)", "NAME(롯데)");
}

{
  const map = {};
  addKeys(map, "홍길동", "010-1234-5678", "1111111111", "대리판매", {});
  const via = {};
  const hit = lookup(map, "김철수", "010-1234-5678", "", "", via);
  check("속성 ON · 전화 단독 → TEL 로 매칭", hit ? via.via : "(없음)", "TEL");
}

allowSingle = false;
resetPolicyCache();

// ═══════════════════════════════════════════
//  ① 재매칭: 고유ID 있으면 폴백 금지
// ═══════════════════════════════════════════
console.log("\n═══ ① 재매칭 — 고유ID 우선 ═══\n");

/**
 * _par_applyDay_ 의 조회 분기를 그대로 옮긴 것.
 * 시트 I/O 를 뺀 판정 흐름만 재현한다.
 */
function resolveForRow(invoiceMap, r) {
  const lookupMap = vm.runInContext("_pep_lookupInvoiceMap_", ctx);
  const isTelKey = r.key && String(r.key).indexOf("TEL:") === 0;
  const hasUid = !!(r.key && !isTelKey);
  const via = {};
  let hit = null;
  if (hasUid) {
    hit = lookupMap(invoiceMap, r.key);
    if (hit && hit.inv) via.via = "UID";
  } else {
    hit = lookup(invoiceMap, r.name, r.phone, r.addr, r.item, via);
    if ((!hit || !hit.inv) && isTelKey) {
      hit = lookupMap(invoiceMap, r.key);
      if (hit && hit.inv) via.via = "TEL(키)";
    }
  }
  return { hit: hit, via: via.via || "" };
}

const addMap = vm.runInContext("_pep_addInvoiceMap_", ctx);

// 같은 고객의 과거 주문 송장이 이름 키에 남아 있는 상황
{
  const map = {};
  addMap(map, "ORDER-NEW", "1111111111", "대리판매");
  addKeys(map, "홍길동", "010-1234-5678", "9999999999", "롯데", {
    item: "종이컵 6.5oz",
  }); // 과거 출고분

  // 고유ID 로 찾히면 그것을 쓴다
  let got = resolveForRow(map, {
    key: "ORDER-NEW", name: "홍길동", phone: "010-1234-5678",
    addr: "", item: "종이컵 6.5oz",
  });
  check("고유ID 매칭 성공 → UID 사용", got.hit ? got.hit.inv : "(없음)", "1111111111");

  // 고유ID 가 있는데 맵에 없으면 미매칭 — 과거 송장으로 내려가지 않는다
  got = resolveForRow(map, {
    key: "ORDER-MISSING", name: "홍길동", phone: "010-1234-5678",
    addr: "", item: "종이컵 6.5oz",
  });
  check("고유ID 있으나 미발견 → 미매칭 (과거 송장 안 가져옴)",
    got.hit ? got.hit.inv : "(없음)", "(없음)");

  // 고유ID 가 없으면(TEL: 대체키) 조합키로 내려간다
  got = resolveForRow(map, {
    key: "TEL:01012345678", name: "홍길동", phone: "010-1234-5678",
    addr: "", item: "종이컵 6.5oz",
  });
  check("고유ID 없음(TEL 대체키) → 조합키로 매칭",
    got.hit ? got.hit.inv : "(없음)", "9999999999");
}

// ═══════════════════════════════════════════
//  신규 판정이 여전히 정상 동작하는지
// ═══════════════════════════════════════════
console.log("\n═══ _par_decideRow_ 회귀 ═══\n");

const decide = vm.runInContext("_par_decideRow_", ctx);

{
  const d = decide("", { inv: "1111111111", source: "롯데" }, "UID", 1, false, "종이컵");
  check("빈 행 + UID 매칭 → 신규 (반영)", d.verdict + "/" + d.apply, "신규/true");
}
{
  const d = decide("", null, "", 1, false, "종이컵");
  check("빈 행 + 미매칭 → 미매칭 (반영 안 함)", d.verdict + "/" + d.apply, "미매칭/false");
}
{
  const d = decide("2222222222", { inv: "3333333333", source: "롯데" }, "NI", 1, false, "종이컵");
  check("기존 송장 1개 ≠ 새 결과 → 검토필요 (덮지 않음)",
    d.verdict + "/" + d.apply, "검토필요/false");
}

console.log(`\n═══ 결과: ${pass} 통과 / ${fail} 실패 ═══`);
process.exit(fail ? 1 : 0);
