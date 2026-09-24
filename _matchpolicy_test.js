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
  extract(pushSrc, "function _pep_ymdNum_("),      // 아래 함수들이 부른다
  extract(pushSrc, "function _pep_ymdPack_("),
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

/* ═══════════════════════════════════════════════════════════════
   고유ID 가 있으면 이름으로 «안» 내려간다

   > "가장큰 문제는 고유아이디가 있는데 그게 무시 된다는게 문제야"

   2026-08-27 에 «순서»는 고쳤다(고유ID 먼저). 그런데 고유ID 로 못 찾았을 때
   이름으로 내려가는 길을 그대로 뒀다. 고유ID 가 있는데 그 ID 로 송장이
   안 나온다는 건 «아직 송장이 없다»는 뜻이지, 이름이 비슷한 남의 송장을
   가져오라는 뜻이 아니다. 붙으면 마감으로 넘어가고 고객 전화로 알게 된다.
   ═══════════════════════════════════════════════════════════════ */
console.log("\n[고유ID 우선] 있으면 이름 폴백을 안 탄다");
{
  const po = fs.readFileSync("_partnerOrders.gs", "utf8");

  check("★ 고유ID 가 진짜면 이름 폴백을 막는다",
    po.indexOf("if ((!hit || !hit.inv) && !_uidReal_) {") > 0, true);
  check("★ 옛 무조건 폴백은 사라졌다",
    po.indexOf("if (!hit || !hit.inv) {" + String.fromCharCode(10) +
      "          var npHit = _pep_lookupNamePhoneInvoice_(") > 0, false);
  check("막은 건수를 센다", po.indexOf("fbUidOnly++") > 0, true);
  check("화면에 적는다", po.indexOf("고유ID 가 있어 이름으로는 안 찾음") > 0, true);
  check("어느 건인지 예시도 남긴다", po.indexOf("fbUidOnlyEg") > 0, true);

  //  본래 이렇게 하고 있던 함수 — 여기와 규칙이 같아야 한다
  const pep = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
  check("_pep_resolveRowInvoice_ 는 UID미매칭이면 null",
    pep.indexOf(String.fromCharCode(34) + "UID미매칭" + String.fromCharCode(34) + ";") > 0 ||
    pep.indexOf("outVia.via = " + String.fromCharCode(34) + "UID미매칭") > 0, true);
}


/* ═══════════════════════════════════════════════════════════════
   합배송 전용 시트 — 구 세트분리 → 뉴

   > "송장 수집시 합배송이 적요에 합배송 표시도 안되고 합배송건에 대한
   >  송장번호도 안들어와.. 대리판매업체 건이야"

   합배송 키의 원천이 「세트분리(사용중)」(구)을 가리키고 있었다. 뉴로 옮긴 뒤
   그 탭은 안 채워지므로 키가 하나도 안 만들어졌고, 같은 사람의 여러 줄을 묶을
   근거가 없어 적요에 「합배송」도, 대표 송장 복사도 일어나지 않았다.
   오류는 안 난다 — 조용히 「합배송이 없는 날」처럼 보인다.
   ═══════════════════════════════════════════════════════════════ */
console.log("\n[합배송 원천] 뉴 세트분리를 보는가");
{
  const ph = fs.readFileSync("_partnerHelpers.gs", "utf8");
  const po = fs.readFileSync("_partnerOrders.gs", "utf8");

  check('★ 뉴 세트분리를 가리킨다',
    ph.indexOf('_PT_COMBINED_INVOICE_SHEET_ID = "1JuwZjorbBG7tOa92xfAy07eUV-r2j2P8bpbYrgCDAwo"') > 0, true);
  check('★ GID 대신 탭 이름으로', ph.indexOf('_PT_COMBINED_INVOICE_TAB_NAME = "합배송"') > 0, true);
  check('GID 는 꺼 둔다', ph.indexOf('_PT_COMBINED_INVOICE_SHEET_GID = -1') > 0, true);
  check('옛 값을 주석으로 남겼다',
    ph.indexOf('1vWdJgmbW_Gwm_2b1pP8mVBxpfYBbUiAduSwkStXxs0Y') > 0, true);

  check('★ 이름 칸 무늬에 거래처명이 있다', po.indexOf('|거래처명/') > 0, true);
  check('★ 고유ID 를 이름으로 찾는다', po.indexOf('_uh === "사방넷주문번호"') > 0, true);
  check('못 찾으면 옛 자리 16', po.indexOf('if (_csUidCol < 0) _csUidCol = 16;') > 0, true);
  check('탭을 이름으로 여는 길이 둘 다 있다',
    po.split('_PT_COMBINED_INVOICE_TAB_NAME').length - 1 >= 2, true);
  check('어느 탭·어느 칸을 봤는지 적는다', po.indexOf('" — 이름+전화 키 "') > 0, true);
}


console.log(`\n═══ 결과: ${pass} 통과 / ${fail} 실패 ═══`);
process.exit(fail ? 1 : 0);
