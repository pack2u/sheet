/**
 * 로컬 검증: 수량 1개 행에 송장 수십 개가 붙던 문제
 *
 *  증상 — 대리발송 건의 일일마감에서 운송장번호 칸에 송장이 40개씩 들어갔다.
 *  고유ID 도 있고 수량도 1개인 행이었다.
 *
 *  원인은 세 겹이었다.
 *    ① `_pep_lookupNamePhoneInvoice_` 가 확정 송장이 없으면 **여러 개짜리 키를
 *       그대로 돌려줬다.** 대리발송은 수취인·전화·주소가 업체 자기 것이라
 *       NP7·NA·NPA 한 키에 그 업체의 모든 주문 송장이 쌓여 있었다.
 *    ② 스냅샷·백필 두 곳이 `invoiceMap["NAME:" + 이름]` 을 **직접** 집어
 *       단일필드 금지 정책을 건너뛰었다.
 *    ③ 사방넷 그룹 병합이 `NAME:`·`NP:` 까지 끌어와 합친 뒤 그 목록을
 *       **그룹 전원에게 덮어썼다.** 그래서 서로 다른 품목 행이 같은 목록을 가졌다.
 *
 *  고친 뒤 지켜야 할 것
 *    · 사람만 가리키는 키(NP7·NA·NPA·NP·NAME·TEL·PH)는 송장이 하나일 때만 쓴다
 *    · 품목까지 맞는 키(NPI·NAI·NI)는 분할 출고일 수 있어 여러 개를 허용한다
 *    · 그룹 전파는 병합 결과가 **송장 하나**일 때만 한다 (합포장)
 *
 * 실행: node _pep_multiinv_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const src = fs.readFileSync("_partnerExclusivePush.gs", "utf8");

function grabFn(name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
function grabVar(name, open, close) {
  const at = src.search(new RegExp("^var\\s+" + name + "\\s*=\\s*\\" + open, "m"));
  if (at < 0) throw new Error(name + " 를 못 찾음");
  let d = 0;
  for (let i = src.indexOf(open, at); i < src.length; i++) {
    if (src[i] === open) d++;
    else if (src[i] === close) { d--; if (d === 0) return src.slice(at, i + 1) + ";"; }
  }
  throw new Error(name + " 가 안 닫힘");
}
const grabObj = (n) => grabVar(n, "{", "}");
const grabArr = (n) => grabVar(n, "[", "]");

const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext([
  grabObj("_PEP_PERSON_ONLY_VIA_"),
  grabArr("_PEP_SIDO_ALIAS_"),
  "var _PEP_ADDR_KEY_LEN_ = 12, _PEP_ITEM_KEY_LEN_ = 16;",
  grabFn("_pep_normInvoiceNo_"),
  grabFn("_pep_splitInvNos_"),
  grabFn("_pep_normalizeMatchUid_"),
  grabFn("_pep_uidFromOrdererCell_"),
  grabFn("_pep_isRealUid_"),
  grabFn("_pep_addInvoiceMap_"),
  grabFn("_pep_lookupInvoiceMap_"),
  grabFn("_pep_invCount_"),
  grabFn("_pep_normRecipName_"),
  grabFn("_pep_phoneDigits_"),
  grabFn("_pep_isMaskedPhone_"),
  grabFn("_pep_phone7_"),
  grabFn("_pep_addrKey_"),
  grabFn("_pep_itemKey_"),
  grabFn("_pep_addNamePhoneInvoiceKeys_"),
  grabFn("_pep_lookupNamePhoneInvoice_"),
  grabFn("_pep_resolveRowInvoice_"),
  grabFn("_pep_ymdNum_"),
  grabFn("_pep_ymdLagDays_"),
  grabFn("_pep_carrierWithLag_"),
  grabFn("_pep_applyOrderDateFilter_"),
  grabFn("_pep_mergeInvCells_"),
  grabFn("_pep_mapArchiveMatchCols_"),
  "function _pt_allowSingleFieldMatch_() { return false; }",
  "function _pep_fixPhoneLeadingZero_(v) { return v; }"
].join("\n"), ctx);

const call = (expr) => vm.runInContext(expr, ctx);

// ── 화면에 나온 상황 재현 ────────────────────────────────────
// 대리발송 — 수취인·전화·주소가 전부 업체 자기 것이라 사람 키가 통째로 겹친다.
const VENDOR = { name: "주식회사 뉴트리트", phone: "010-7110-4329", addr: "경기도 파주시 조리읍 1" };

function buildMap(orders) {
  ctx.__map = {};
  for (const o of orders) {
    call("_pep_addNamePhoneInvoiceKeys_(__map, " +
      [JSON.stringify(VENDOR.name), JSON.stringify(VENDOR.phone),
       JSON.stringify(o.inv), '"대리발송"',
       JSON.stringify({ addr: VENDOR.addr, item: o.item })].join(",") + ")");
  }
  return ctx.__map;
}

// 같은 업체 앞으로 40건이 나간 하루
const many = [];
for (let i = 0; i < 40; i++) {
  many.push({ item: "품목" + i, inv: "26794555" + String(10000 + i) });
}
buildMap(many);

console.log("[1] 사람만 가리키는 키에 실제로 40건이 쌓인다 (원인 확인)");
const worst = {};
for (const k of Object.keys(ctx.__map)) {
  const via = k.split(":")[0];
  worst[via] = Math.max(worst[via] || 0, call("_pep_invCount_(__map[" + JSON.stringify(k) + "])"));
}
check("NP7 키가 들고 있는 최대 송장 수", worst.NP7, 40);
check("NPA 키가 들고 있는 최대 송장 수", worst.NPA, 40);
check("NA 키가 들고 있는 최대 송장 수", worst.NA, 40);
check("품목까지 맞는 NPI 는 1개씩", worst.NPI, 1);

console.log("\n[2] 품목이 맞으면 그 행의 송장 하나만 돌아온다 (정상 경로)");
let via = {};
ctx.__via = {};
let hit = call('_pep_lookupNamePhoneInvoice_(__map, ' +
  JSON.stringify(VENDOR.name) + ',' + JSON.stringify(VENDOR.phone) + ',' +
  JSON.stringify(VENDOR.addr) + ',"품목7", __via)');
check("송장", hit && hit.inv, "2679455510007");
check("경유 키", ctx.__via.via, "NPI");

console.log("\n[3] 품목이 안 맞으면 40개를 주는 대신 미매칭이다 (핵심 수정)");
ctx.__via = {};
hit = call('_pep_lookupNamePhoneInvoice_(__map, ' +
  JSON.stringify(VENDOR.name) + ',' + JSON.stringify(VENDOR.phone) + ',' +
  JSON.stringify(VENDOR.addr) + ',"송장맵에 없는 품목", __via)');
check("결과", hit, null);
check("모호로 걸러진 키가 있었다", ctx.__via.ambiguous > 0, true);

console.log("\n[4] 품목을 아예 모를 때도 40개를 주지 않는다");
ctx.__via = {};
hit = call('_pep_lookupNamePhoneInvoice_(__map, ' +
  JSON.stringify(VENDOR.name) + ',' + JSON.stringify(VENDOR.phone) + ',' +
  JSON.stringify(VENDOR.addr) + ',"", __via)');
check("결과", hit, null);

console.log("\n[5] 사람 키라도 송장이 하나면 그대로 쓴다 (매칭률을 깎지 않는다)");
buildMap([{ item: "물티슈", inv: "1234567890" }]);
ctx.__via = {};
hit = call('_pep_lookupNamePhoneInvoice_(__map, ' +
  JSON.stringify(VENDOR.name) + ',' + JSON.stringify(VENDOR.phone) + ',' +
  JSON.stringify(VENDOR.addr) + ',"다른 품목", __via)');
check("송장", hit && hit.inv, "1234567890");
check("경유 키가 사람 키다", ["NPA", "NP7", "NA"].indexOf(ctx.__via.via) >= 0, true);

console.log("\n[6] 같은 사람·같은 품목의 분할 출고는 여러 개를 유지한다");
buildMap([{ item: "물티슈", inv: "1111111111" }, { item: "물티슈", inv: "2222222222" }]);
ctx.__via = {};
hit = call('_pep_lookupNamePhoneInvoice_(__map, ' +
  JSON.stringify(VENDOR.name) + ',' + JSON.stringify(VENDOR.phone) + ',' +
  JSON.stringify(VENDOR.addr) + ',"물티슈", __via)');
check("송장 2개 유지", hit && hit.inv.split("\n").length, 2);
check("경유 키가 품목 키다", ctx.__via.via, "NPI");

// ── 그룹 전파 규칙 ───────────────────────────────────────────
console.log("\n[7] 그룹 전파 — 병합 결과가 송장 하나일 때만 (합포장)");
function propagate(members) {
  let merged = "";
  for (const m of members) merged = call("_pep_mergeInvCells_(" +
    JSON.stringify(merged) + "," + JSON.stringify(m) + ")");
  if (!merged) return { mode: "none", out: members };
  if (call("_pep_splitInvNos_(" + JSON.stringify(merged) + ").length") !== 1) {
    return { mode: "ambiguous", out: members }; // 각자 것 유지
  }
  return { mode: "pack", out: members.map(() => merged) };
}
check("합포장 (한 송장을 여럿이 나눠 씀)",
  propagate(["1234567890", "", ""]),
  { mode: "pack", out: ["1234567890", "1234567890", "1234567890"] });
check("송장이 서로 다르면 전파하지 않는다",
  propagate(["1111111111", "2222222222", ""]),
  { mode: "ambiguous", out: ["1111111111", "2222222222", ""] });
check("아무도 못 찾았으면 그대로", propagate(["", ""]), { mode: "none", out: ["", ""] });

// ── 정책 구멍이 막혔는지 ─────────────────────────────────────
console.log("\n[8] NAME: 직접 조회가 코드에서 사라졌다 (사다리를 건너뛰던 구멍)");
const leaks = src.split("\n")
  .map((l, i) => ({ n: i + 1, t: l }))
  .filter(o => /invoiceMap\["NAME:"/.test(o.t) && !/^\s*\/\//.test(o.t));
if (leaks.length) leaks.forEach(o => console.log("      → " + o.n + "행: " + o.t.trim()));
check("남은 직접 조회", leaks.length, 0);

console.log("\n[9] 그룹 병합이 송장맵을 직접 뒤지지 않는다");
const grpStart = src.indexOf("var sabangGroups = {};");
const grpEnd = src.indexOf("for (var wj = 0; wj < workItems.length; wj++)", grpStart);
const grpBlock = src.slice(grpStart, grpEnd);
check("그룹 블록에 NAME: 조회 없음", /invoiceMap\["NAME:/.test(grpBlock), false);
check("그룹 블록에 NP: 조회 없음", /invoiceMap\[npk\]|"NP:"/.test(grpBlock), false);
check("단일 송장 조건이 전파를 감싼다",
  /_pep_splitInvNos_\(mergedInv\)\.length !== 1/.test(grpBlock), true);

// ── 마지막 관문: 송장 개수 상한 ──────────────────────────────
// 상한은 `_par_slotSpec_` 이 정한다 (세트는 뚜껑·몸통이 따로 나가 2N 이 정상).
const refix = fs.readFileSync("_partnerArchiveInvoiceRefix.gs", "utf8");
function grabFnFrom(text, name) {
  const s = text.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < text.length; i++) {
    if (text[i] === "{") { d++; seen = true; }
    else if (text[i] === "}") { d--; if (seen && d === 0) return text.slice(s, i + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
vm.runInContext([
  grabFnFrom(refix, "_par_qtyNum_"),
  grabFnFrom(refix, "_par_isSetItem_"),
  grabFnFrom(refix, "_par_slotSpec_"),
  grabFnFrom(fs.readFileSync("_partnerArchiveQtyPurge.gs", "utf8"), "_pqp_overReason_")
].join("\n"), ctx);

// 마감 관문 — `_partnerExclusivePush.gs` 안의 판정과 같은 식
function qtyGate(qty, item, inv) {
  const slot = call("_par_slotSpec_(" + JSON.stringify(qty) + "," + JSON.stringify(item) + ")");
  const n = call("_pep_splitInvNos_(" + JSON.stringify(inv) + ").length");
  const raw = String(qty == null ? "" : qty).replace(/[^0-9]/g, "");
  return (raw && n > slot.max) ? "" : inv;
}
const TWO = "1111111111\n2222222222";
const FORTY = many.map(m => m.inv).join("\n");

console.log("\n[10] 세트 — 1개 주문에 박스 2개라 송장 2장이 정상이다");
check("세트 · 수량1 · 송장2 → 통과", qtyGate(1, "물티슈 세트", TWO), TWO);
check("세트 · 수량2 · 송장4 → 통과",
  qtyGate(2, "밀폐용기 세트", TWO + "\n3333333333\n4444444444"),
  TWO + "\n3333333333\n4444444444");
check("세트 · 수량1 · 송장3 → 차단", qtyGate(1, "물티슈 세트", TWO + "\n3333333333"), "");
check("세트 · 수량1 · 송장40 → 차단", qtyGate(1, "물티슈 세트", FORTY), "");
check("세트 최대 장수는 2N", call('_par_slotSpec_(1,"세트").max'), 2);
check("세트 기대 장수도 2N", call('_par_slotSpec_(1,"세트").expect'), 2);

console.log("\n[11] 비세트 상한 — 박스가 쪼개지면 2N 까지");
check("수량1 · 송장1 → 통과", qtyGate(1, "일반 컵", "1111111111"), "1111111111");
check("수량1 · 송장2 (분할) → 통과", qtyGate(1, "일반 컵", TWO), TWO);
check("수량1 · 송장3 → 차단", qtyGate(1, "일반 컵", TWO + "\n3333333333"), "");
check("수량1 · 송장40 → 차단 (화면에 나온 상황)", qtyGate(1, "일반 컵", FORTY), "");
check("수량 못 읽음 → 막지 않는다", qtyGate("", "일반 컵", FORTY), FORTY);

console.log("\n[12] 정리 도구도 같은 상한을 쓴다");
check("세트 수량1 · 송장2 → 정리 대상 아님", call('_pqp_overReason_(' +
  JSON.stringify(TWO) + ',1,"물티슈 세트")'), "");
check("비세트 수량1 · 송장2 → 정리 대상 아님", call('_pqp_overReason_(' +
  JSON.stringify(TWO) + ',1,"일반 컵")'), "");
check("비세트 수량1 · 송장40 → 정리 대상",
  call('_pqp_overReason_(' + JSON.stringify(FORTY) + ',1,"일반 컵")').indexOf("40장") > 0, true);
check("세트 수량1 · 송장40 → 정리 대상 (사유에 세트 표기)",
  call('_pqp_overReason_(' + JSON.stringify(FORTY) + ',1,"물티슈 세트")').indexOf("세트") === 0, true);
check("수량 빈칸 → 판정하지 않는다",
  call('_pqp_overReason_(' + JSON.stringify(FORTY) + ',"","일반 컵")'), "");

console.log("\n[13] 상한 정의가 한 곳뿐이다");
check("수량 열 탐지", /SNAP_QTY < 0 && \/\^수량\$\/\.test\(hh2\)/.test(src), true);
check("마감 관문이 _pep_qtyOverMax_ 를 쓴다", /_pep_qtyOverMax_/.test(src), true);
check("마감 관문이 수량을 직접 자르지 않는다", /invN > rowQty/.test(src), false);
check("정리 도구도 _par_slotSpec_ 을 쓴다",
  /list\.length <= ok\.max/.test(fs.readFileSync("_partnerArchiveQtyPurge.gs", "utf8")), true);

vm.runInContext([
  grabFn("_pep_qtyOverMax_"),
  grabFn("_pep_deriveMatchKeyFromSalesCols_"),
  grabFn("_pep_deriveMatchKeyFromArchiveRow_"),
].join("\n"), ctx);

console.log("\n[14] 고유ID 는 M열 주문자명/고유아이디 의 슬래시 뒤");
check("슬래시 뒤만 뽑는다",
  call('_pep_uidFromOrdererCell_("홍길동/2025082812345678")'), "2025082812345678");
check("칸 전체는 고유ID 가 아니다 (한글)",
  call('_pep_isRealUid_("홍길동/2025082812345678")'), true);
check("뽑은 값은 고유ID",
  call('_pep_isRealUid_("2025082812345678")'), true);
check("한글 이름만은 고유ID 아님", call('_pep_isRealUid_("홍길동")'), false);
check("TEL: 키는 고유ID 아님", call('_pep_isRealUid_("TEL:01012345678")'), false);
check("우리가 발급한 ph-UID 는 고유ID", call('_pep_isRealUid_("0828-ph-A3KM")'), true);

const hdr = ["품목코드", "품목명", "수량", "전화", "주소", "주문자명(사방넷)", "운송장번호", "출처"];
ctx.__hdr = hdr;
const cols = call("_pep_mapArchiveMatchCols_(__hdr)");
check("주문자명(사방넷) 은 orderer", cols.orderer, 5);
check("주문자명(사방넷) 은 name", cols.name, 5);
check("주문자명(사방넷) 을 oid raw 로 안 잡는다", cols.oid, -1);

const row = ["C1", "물티슈 세트", "1", "010-1111-2222", "서울", "홍길동/2025082812345678", "", "미매칭"];
ctx.__row = row; ctx.__cols = cols;
check("재매칭 키는 슬래시 뒤",
  call("_pep_deriveMatchKeyFromArchiveRow_(__row, __cols)"), "2025082812345678");

console.log("\n[15] 고유ID 가 있으면 이름 사다리로 내려가지 않는다");
ctx.__map = {};
call('_pep_addInvoiceMap_(__map, "2025082812345678", "9999999999", "롯데")');
call('_pep_addNamePhoneInvoiceKeys_(__map, "홍길동", "010-1111-2222", "8888888888", "롯데", ' +
  JSON.stringify({ addr: "서울시", item: "물티슈" }) + ")");
ctx.__via = {};
let r15 = call('_pep_resolveRowInvoice_(__map, ' +
  JSON.stringify({ uid: "홍길동/2025082812345678", name: "홍길동",
    phone: "010-1111-2222", addr: "서울시", item: "물티슈" }) + ", __via)");
check("UID 로 맞음", r15 && r15.inv, "9999999999");
check("경유 UID", ctx.__via.via, "UID");

ctx.__via = {};
r15 = call('_pep_resolveRowInvoice_(__map, ' +
  JSON.stringify({ uid: "홍길동/9999999999999", name: "홍길동",
    phone: "010-1111-2222", addr: "서울시", item: "물티슈" }) + ", __via)");
check("UID 미스면 사다리를 안 탄다", r15, null);
check("경유 UID미매칭", ctx.__via.via, "UID미매칭");

ctx.__via = {};
r15 = call('_pep_resolveRowInvoice_(__map, ' +
  JSON.stringify({ uid: "홍길동", name: "홍길동",
    phone: "010-1111-2222", addr: "서울시", item: "물티슈" }) + ", __via)");
check("고유ID 없으면 조합키", r15 && r15.inv, "8888888888");

console.log("\n[18] 주문일보다 이른 집하 송장은 빼고, 당일·지연을 가른다");
check("집하일 파싱 yyyy-MM-dd", call('_pep_ymdNum_("2026-08-24")'), 20260824);
check("집하일 파싱 Date",
  call('(function(){ var d = new Date(2026, 7, 24); return _pep_ymdNum_(d); })()'),
  20260824);
check("빈값은 0", call('_pep_ymdNum_("")'), 0);
check("당일 lag 0", call("_pep_ymdLagDays_(20260824, 20260824)"), 0);
check("3일 lag", call("_pep_ymdLagDays_(20260824, 20260827)"), 3);
check("집하가 더 이르면 0", call("_pep_ymdLagDays_(20260827, 20260824)"), 0);
check("당일은 숫자 없음", call('_pep_carrierWithLag_("롯데택배", 0)'), "롯데택배");
check("3일은 (03)", call('_pep_carrierWithLag_("롯데택배", 3)'), "롯데택배(03)");
check("이미 붙은 숫자는 갈아끼움",
  call('_pep_carrierWithLag_("롯데택배(03)", 1)'), "롯데택배(01)");

ctx.__map = {};
call('_pep_addInvoiceMap_(__map, "UID-DATE", "1111111111", "롯데", "", 20260820)');
call('_pep_addInvoiceMap_(__map, "UID-DATE", "2222222222", "롯데", "", 20260825)');
ctx.__via = {};
let r18 = call('_pep_resolveRowInvoice_(__map, ' +
  JSON.stringify({ uid: "UID-DATE", orderDate: "2026-08-24" }) + ", __via)");
check("과거 집하 송장은 빠짐", r18 && r18.inv, "2222222222");
check("지연 1일", r18 && r18.lag, 1);

ctx.__via = {};
r18 = call('_pep_resolveRowInvoice_(__map, ' +
  JSON.stringify({ uid: "UID-DATE", orderDate: "2026-08-26" }) + ", __via)");
check("둘 다 주문일 이전이면 미매칭", r18, null);

ctx.__map = {};
call('_pep_addInvoiceMap_(__map, "UID-NODATE", "3333333333", "롯데")');
ctx.__via = {};
r18 = call('_pep_resolveRowInvoice_(__map, ' +
  JSON.stringify({ uid: "UID-NODATE", orderDate: "2026-08-24" }) + ", __via)");
check("집하일 없는 송장은 유지", r18 && r18.inv, "3333333333");
check("날짜 없으면 lag 0", r18 && r18.lag, 0);

ctx.__map = {};
call('_pep_addInvoiceMap_(__map, "UID-SAME", "4444444444", "롯데", "", 20260824)');
ctx.__via = {};
r18 = call('_pep_resolveRowInvoice_(__map, ' +
  JSON.stringify({ uid: "UID-SAME", orderDate: "2026-08-24" }) + ", __via)");
check("당일 집하는 붙음", r18 && r18.inv, "4444444444");
check("당일 lag 0", r18 && r18.lag, 0);

console.log("\n[16] 전용마감탭은 사방넷주문번호도 키로 잡는다");
const pea = fs.readFileSync("_partnerExclusiveArchive.gs", "utf8");
vm.runInContext(grabFnFrom(pea, "_pea_archiveInvCols_"), ctx);
const exHdr = ["이동일시", "송장번호", "품목명", "사방넷주문번호", "수취인", "고유ID"];
ctx.__exHdr = exHdr;
const exCols = call("_pea_archiveInvCols_(__exHdr)");
check("송장", exCols.inv, 1);
check("사방넷주문번호", exCols.sabang, 3);
check("고유ID", exCols.uid, 5);
check("재매칭 맵이 전용마감을 읽는다",
  /_pea_addExclusiveArchiveToInvoiceMap_/.test(fs.readFileSync("_partnerUnifiedView.gs", "utf8")), true);

console.log("\n[17] 대리판매 월마감(발주 마감)도 송장맵에 넣는다");
const pms = fs.readFileSync("_partnerMonthlySettle.gs", "utf8");
vm.runInContext(grabFnFrom(pms, "_pms_findOrderArchiveHeaderRow_"), ctx);
vm.runInContext(grabFnFrom(pms, "_pms_orderArchiveCols_"), ctx);
const ordHdr4 = [
  ["안내", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["거래처명(자동)", "주문일자(자동)", "이카운트코드", "품목명(자동)", "수량",
    "수취인", "수취인전화번호", "수취인주소", "배송메시지", "적요",
    "송장번호", "정산금액(자동)", "고유ID(자동)", "상태(자동)", "도서산간배송비"]
];
ctx.__ordAll = ordHdr4;
check("헤더는 4행", call("_pms_findOrderArchiveHeaderRow_(__ordAll)"), 3);
const ordCols = call("_pms_orderArchiveCols_(__ordAll[3])");
check("송장 K열", ordCols.inv, 10);
check("고유ID M열", ordCols.uid, 12);
check("수취인 F열", ordCols.name, 5);
const uvs = fs.readFileSync("_partnerUnifiedView.gs", "utf8");
check("재매칭 맵이 발주마감을 읽는다", /_pms_addOrderArchiveToInvoiceMap_/.test(uvs), true);
check("재매칭 맵이 허브아카이브를 읽는다", /_ha_addHubArchiveToInvoiceMap_/.test(uvs), true);
const pepSrc = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
check("일일마감 본기록도 발주마감을 읽는다", /_pms_addOrderArchiveToInvoiceMap_/.test(pepSrc), true);

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
