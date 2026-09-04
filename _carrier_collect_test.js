/**
 * 로컬 검증: 송장수집 → 택배사 열 배선
 *
 *   송장맵 src(원천 탭 이름)가 후보 → picked → writeUpdates 까지 살아서
 *   허브 R열 / 임시기록 V열 값이 되는지를 본다.
 *   판정 규칙 자체는 _carrier_origin_test.js 담당 — 여기서는 "배선"만 본다.
 *
 * 실행: node _carrier_collect_test.js
 */
const fs = require("fs");
const vm = require("vm");

function extractFrom(file, decl, openCh, closeCh) {
  const src = fs.readFileSync(file, "utf8");
  const at = src.indexOf(decl);
  if (at < 0) throw new Error("못 찾음: " + decl + " (" + file + ")");
  const open = src.indexOf(openCh, at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error("닫는 기호 없음: " + decl);
}
const fnFrom = (file, name) => extractFrom(file, "function " + name + "(", "{", "}");

const H = "_partnerHelpers.gs";
const O = "_partnerOrders.gs";
const P = "_partnerExclusivePush.gs";

// 판정 엔진은 실제 소스에서 가져온다 — 스텁으로 두면 배선이 끊겨도 통과해 버린다
const pieces = [
  extractFrom(P, "var _PEP_VENDOR_CARRIER_ =", "{", "}") + ";",
  extractFrom(P, "var _PEP_VENDOR_LABELS_ =", "{", "}") + ";",
  extractFrom(P, "var _PEP_VENDOR_PREFIX_ALIAS_ =", "{", "}") + ";",
  fnFrom(P, "_pep_resolvePrefixAlias_"),
  fnFrom(P, "_pep_carrierFromSource_"),
  fnFrom(P, "_pep_isPartnerShipSource_"),
  fnFrom(P, "_pep_isOwnWarehouseOrigin_"),
  fnFrom(P, "_pep_isProxyShipOrigin_"),
  fnFrom(P, "_pep_carrierFromItemCodePrefix_"),
  fnFrom(P, "_pep_carrierFromItemCode_"),
  fnFrom(P, "_pep_carrierWithLag_"),
  fnFrom(P, "_pep_carrierForArchiveRow_"),
  fnFrom(P, "_pep_normalizeTempVendorPrefix_"),
  // 배선 대상
  fnFrom(H, "parseInvoiceLinesFromMatchedRows_"),
  fnFrom(H, "_pt_pickInvoicesForHubRow"),
  fnFrom(O, "_po_carrierForHubRow_"),
  fnFrom(O, "_po_carrierFromPicked_"),
  fnFrom(O, "_po_carrierForTempRow_"),
  "var _PO_TEMP_PFX_COL_ = 22;",
].join("\n\n");

const stubs = `
var Logger = { log: function () {} };
var _PEP_VENDOR_DIRECT_MAP_ = { JT: {}, HR: {}, TY: {}, JM: {} };
var _VC_TABLE_ = { byPfx: {}, byLabel: {}, code: {}, conflicts: [], rows: 0 };
var _pep_loadVendorCarrierTable_ = function () { return _VC_TABLE_; };
var _ORIGIN_MAP_ = {};
var _pep_loadItemShipOriginIndex_ = function () {
  return { map: _ORIGIN_MAP_, rows: Object.keys(_ORIGIN_MAP_).length, error: "" };
};
var _pep_carrierForVendor_ = function (v) {
  var up = String(v || "").replace(/\\s/g, "");
  var pfx = _pep_normalizeTempVendorPrefix_(up);
  if (pfx && _PEP_VENDOR_CARRIER_[pfx]) return _PEP_VENDOR_CARRIER_[pfx];
  for (var k in _PEP_VENDOR_LABELS_) {
    if (up.indexOf(_PEP_VENDOR_LABELS_[k]) !== -1) return _PEP_VENDOR_CARRIER_[k] || "";
  }
  return "";
};
// 품목 근거 채점은 이 테스트의 관심사가 아니다 — 전부 중립으로 둔다
var _pt_evStat_ = function () {
  return { blocked: 0, blockedRows: [], strong: 0, plain: 0, weak: 0 };
};
var _pt_scoreInvoiceEvidence_ = function () {
  return { score: 0, specHit: 0, hasInfo: false, opposite: false };
};
`;

const ctx = vm.createContext({});
vm.runInContext(stubs + "\n" + pieces, ctx);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

/** 송장맵 엔트리 배열 → 허브 행에 실제로 붙는 택배사 (수집 경로 재현) */
function collect(matchedArr, hubRow, need) {
  const used = {};
  const cands = ctx.parseInvoiceLinesFromMatchedRows_(matchedArr, used);
  const picked = ctx._pt_pickInvoicesForHubRow(cands, hubRow, need || 1, used);
  return { picked: picked, carrier: ctx._po_carrierFromPicked_(picked, hubRow) };
}

// 허브 행: 0=수집일시 1=발주업체 2=고유ID 3=주문일자 4=이카운트코드 5=품목명
const hubRow = (vendor, code) => ["", vendor || "", "UID1", "", code || "", "품목"];

console.log("\n[1] src 가 후보 → picked 까지 살아 있다");
const r1 = collect([{ invRaw: "1234567890", detailRaw: "", src: "롯데택배" }], hubRow());
check("picked[0].src 보존", r1.picked[0].src, "롯데택배");
check("송장은 그대로", r1.picked[0].inv, "1234567890");

console.log("\n[2] 원천 탭 이름이 곧 택배사");
check("롯데택배 탭", collect([{ invRaw: "1", src: "롯데택배" }], hubRow()).carrier, "롯데택배");
check("★최우선(로젠주문실적)",
  collect([{ invRaw: "2", src: "★최우선(로젠주문실적)" }], hubRow()).carrier, "로젠택배");
check("합포장 → 자사출고(롯데)",
  collect([{ invRaw: "3", src: "합포장" }], hubRow()).carrier, "롯데택배");

console.log("\n[3] 출처가 답을 못 줄 때 — 발주업체명 → 품목코드 순");
ctx._ORIGIN_MAP_ = { PT1000: "평택", HR1234: "대리발송" };
vm.runInContext("_ORIGIN_MAP_ = " + JSON.stringify(ctx._ORIGIN_MAP_) + ";", ctx);
check("업체명 '준테크' → CJ",
  collect([{ invRaw: "4", src: "대리공급" }], hubRow("준테크", "")).carrier, "CJ대한통운");
check("업체명 없음 + 출고지 평택 → 롯데",
  collect([{ invRaw: "5", src: "" }], hubRow("", "PT1000")).carrier, "롯데택배");
check("근거 전무 → 빈칸 (추측 금지)",
  collect([{ invRaw: "6", src: "" }], hubRow("", "")).carrier, "");

console.log("\n[4] 세트 다건 — 첫 유효 src 를 쓴다");
const r4 = collect(
  [{ invRaw: "10\n11", detailRaw: "몸통만\n뚜껑만", src: "롯데택배" }],
  hubRow(), 2);
check("송장 2건 배정", r4.picked.length, 2);
check("택배사 1개로 수렴", r4.carrier, "롯데택배");

console.log("\n[5] 임시기록 행 (W열 접두 → 택배사)");
// 임시기록: 3=품목코드, 22=업체prefix
const tempRow = (code, pfx) => { const r = new Array(26).fill(""); r[3] = code; r[22] = pfx; return r; };
check("W열 'HR' → 로젠", ctx._po_carrierForTempRow_(tempRow("", "HR")), "로젠택배");
check("W열 'NS' → JT → CJ", ctx._po_carrierForTempRow_(tempRow("", "NS")), "CJ대한통운");
check("W열 비고 품목코드 PT1000 → 롯데",
  ctx._po_carrierForTempRow_(tempRow("PT1000", "")), "롯데택배");
check("둘 다 비면 빈칸", ctx._po_carrierForTempRow_(tempRow("", "")), "");

console.log("\n[6] 방어 — 잘못 부른 경우에도 던지지 않는다");
check("행 없음", ctx._po_carrierForTempRow_(null), "");
check("picked 빈 배열", ctx._po_carrierFromPicked_([], hubRow()), "");
check("picked null", ctx._po_carrierFromPicked_(null, hubRow()), "");

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
