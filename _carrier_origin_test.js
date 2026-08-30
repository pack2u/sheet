/**
 * 로컬 검증: 품목코드 → 출고지 → 택배사 판정
 *
 *   · 출고지 평택 계열  → 롯데택배 (자사출고)
 *   · 출고지 대리발송    → 접두로 업체 택배사
 *   · 출고지 모름        → 출처가 업체출고라고 말할 때만 접두
 *
 * 실행: node _carrier_origin_test.js
 */
const fs = require("fs");
const vm = require("vm");

const SRC_FILE = "_partnerExclusivePush.gs";
const src = fs.readFileSync(SRC_FILE, "utf8");

/** 선언부로 시작하는 블록을 중괄호/대괄호 짝을 맞춰 잘라낸다 */
function extract(decl, openCh, closeCh) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error("못 찾음: " + decl);
  const open = src.indexOf(openCh, at);
  if (open < 0) throw new Error("여는 기호 없음: " + decl);
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

function fn(name) {
  return extract("function " + name + "(", "{", "}");
}

// 별칭표·라벨표는 **실제 소스에서** 가져온다. 스텁으로 두면 접두 등록을
// 빼먹어도 테스트가 통과해 버린다 (NS 같은 신규 접두가 조용히 누락된다).
const pieces = [
  extract("var _PEP_VENDOR_CARRIER_ =", "{", "}") + ";",
  extract("var _PEP_VENDOR_LABELS_ =", "{", "}") + ";",
  extract("var _PEP_VENDOR_PREFIX_ALIAS_ =", "{", "}") + ";",
  fn("_pep_resolvePrefixAlias_"),
  fn("_pep_aliasPrefixesFor_"),
  fn("_pep_carrierFromSource_"),
  fn("_pep_isPartnerShipSource_"),
  fn("_pep_isOwnWarehouseOrigin_"),
  fn("_pep_isProxyShipOrigin_"),
  fn("_pep_carrierFromItemCodePrefix_"),
  fn("_pep_carrierFromItemCode_"),
  fn("_pep_carrierWithLag_"),
  fn("_pep_carrierForArchiveRow_"),
  fn("_pep_normalizeTempVendorPrefix_"),
].join("\n\n");

// ── 스텁 ──
//   업체_택배사 표는 시트에서 읽으므로 여기서는 빈 표로 두고
//   코드 상수(_PEP_VENDOR_CARRIER_) 폴백을 검증한다.
//   DIRECT_MAP 은 거대하므로 전용양식이 등록된 접두만 흉내낸다.
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
  for (var k in _PEP_VENDOR_LABELS_) {
    if (up.indexOf(_PEP_VENDOR_LABELS_[k]) !== -1) return _PEP_VENDOR_CARRIER_[k] || "";
  }
  return "";
};
`;

/** 대리공급 전용양식 Push 의 접두 판정 재현 (_pep_pushToVendorExclusive_ 1순위/2순위) */
function routeToExclusiveForm(ctx, rawCode, rawName) {
  const codePfx = rawCode.length >= 2
    ? ctx._pep_resolvePrefixAlias_(rawCode.substring(0, 2)) : "";
  let namePfx = "";
  const m = String(rawName || "").replace(/^[^a-zA-Z]*/, "").match(/^([a-zA-Z]{2})/);
  if (m) namePfx = ctx._pep_resolvePrefixAlias_(m[1]);
  const D = ctx._PEP_VENDOR_DIRECT_MAP_;
  const L = ctx._PEP_VENDOR_LABELS_;
  if (codePfx && (D[codePfx] || L[codePfx])) return codePfx;
  if (namePfx && (D[namePfx] || L[namePfx])) return namePfx;
  return "";
}

const ctx = vm.createContext({});
vm.runInContext(stubs + "\n" + pieces, ctx);

function setOrigins(map) {
  vm.runInContext("_ORIGIN_MAP_ = " + JSON.stringify(map) + ";", ctx);
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

// 출고지 마스터: 평택 계열 / 대리발송 / 일산 / 미등록
setOrigins({
  "PT1000": "평택",
  "PTA1": "평택A-1",
  "HR1234": "대리발송",
  "TY-100": "대리발송",
  "ZZ9999": "대리발송",   // 접두가 표에 없다
  "IS5000": "일산",
  "JH0001": "대리발송",   // 보조 접두 JH → JT (준테크)
});

console.log("\n[1] 출고지 평택 계열 → 무조건 롯데택배");
check("평택 / 출처없음", ctx._pep_carrierFromItemCode_("PT1000", "").carrier, "롯데택배");
check("평택A-1",         ctx._pep_carrierFromItemCode_("PTA1", "").carrier, "롯데택배");
check("평택 / 출처 대리판매", ctx._pep_carrierFromItemCode_("PT1000", "대리판매").carrier, "롯데택배");
check("근거 표기",       ctx._pep_carrierFromItemCode_("PT1000", "").via, "출고지(평택)");

console.log("\n[2] 출고지 대리발송 → 접두로 업체 택배사");
check("HR → 로젠",      ctx._pep_carrierFromItemCode_("HR1234", "").carrier, "로젠택배");
check("TY-100 → 로젠",  ctx._pep_carrierFromItemCode_("TY-100", "").carrier, "로젠택배");
check("JH → JT → CJ",   ctx._pep_carrierFromItemCode_("JH0001", "").carrier, "CJ대한통운");
check("근거 표기",       ctx._pep_carrierFromItemCode_("HR1234", "").via, "출고지(대리발송)+접두");
check("접두 미등록 → 빈칸", ctx._pep_carrierFromItemCode_("ZZ9999", "대리판매").carrier, "");

console.log("\n[3] 출고지가 답을 주지 않을 때");
check("일산 → 빈칸 (추측 안 함)", ctx._pep_carrierFromItemCode_("IS5000", "").carrier, "");
check("일산 / 출처 대리판매여도 빈칸", ctx._pep_carrierFromItemCode_("IS5000", "대리판매").carrier, "");
check("미등록코드 + 출처 대리판매 → 접두 폴백",
  ctx._pep_carrierFromItemCode_("HR7777", "대리판매").carrier, "로젠택배");
check("미등록코드 + 출처 자사출고 → 빈칸 (접두 금지)",
  ctx._pep_carrierFromItemCode_("HR7777", "롯데").carrier, "");
check("빈 코드", ctx._pep_carrierFromItemCode_("", "대리판매").carrier, "");

console.log("\n[4] 행 단위 우선순위 (_pep_carrierForArchiveRow_)");
// ① 송장맵이 이긴다 — 발주업체를 실제로 아는 값이다
check("① 송장맵 > 출고지",
  ctx._pep_carrierForArchiveRow_({ carrier: "한진택배" }, "대리판매", "", "PT1000"), "한진택배");
// ② 출처가 곧 택배사
check("② 출처 롯데",
  ctx._pep_carrierForArchiveRow_(null, "롯데", "", "HR1234"), "롯데택배");
check("② 출처 로젠 > 출고지(평택)",
  ctx._pep_carrierForArchiveRow_(null, "로젠", "", "PT1000"), "로젠택배");
// ③ 업체명
check("③ 업체명",
  ctx._pep_carrierForArchiveRow_(null, "대리판매", "제이엠", "ZZ9999"), "대신택배");
// ④ 출고지
check("④ 대리판매 + 출고지 대리발송",
  ctx._pep_carrierForArchiveRow_(null, "대리판매", "", "HR1234"), "로젠택배");
check("④ 대리공급 + 출고지 평택",
  ctx._pep_carrierForArchiveRow_(null, "대리공급", "", "PT1000"), "롯데택배");
// 다 비면 빈칸
check("근거 없음 → 빈칸",
  ctx._pep_carrierForArchiveRow_(null, "대리판매", "", ""), "");
check("출처 미매칭 + 미등록 → 빈칸",
  ctx._pep_carrierForArchiveRow_(null, "미매칭", "", "ZZ9999"), "");

console.log("\n[5] via 전달 (진단 로그용)");
const box = {};
ctx._pep_carrierForArchiveRow_(null, "대리판매", "", "HR1234", box);
check("via", box.via, "출고지(대리발송)+접두");
const box2 = {};
ctx._pep_carrierForArchiveRow_({ carrier: "롯데택배" }, "대리판매", "", "", box2);
check("via 송장맵", box2.via, "송장맵");
const box3 = {};
ctx._pep_carrierForArchiveRow_(null, "대리판매", "", "", box3);
check("via 빈칸일 때", box3.via, "");

console.log("\n[6] 준테크 보조 접두 (JH · BF · NS → JT)");
// 별칭표를 실제 소스에서 읽으므로, 등록이 빠지면 여기서 바로 걸린다.
["JH", "BF", "NS"].forEach(function (a) {
  check(a + " → 대표 접두", ctx._pep_resolvePrefixAlias_(a), "JT");
});
check("소문자 ns 도 환산", ctx._pep_resolvePrefixAlias_("ns"), "JT");
check("JT 대표 접두는 그대로", ctx._pep_resolvePrefixAlias_("JT"), "JT");
check("별칭 목록에 NS 포함",
  ctx._pep_aliasPrefixesFor_("JT").join(","), "BF,JH,NS");

console.log("  — 대리공급: 전용양식 라우팅 (NS 품목 → 준테크 양식)");
check("NS0001 코드 → JT", routeToExclusiveForm(ctx, "NS0001", "NS 냅킨"), "JT");
check("품목명만 NS → JT", routeToExclusiveForm(ctx, "", "NS 냅킨"), "JT");
check("임시기록 W열 'NS' → JT", ctx._pep_normalizeTempVendorPrefix_("NS"), "JT");
check("임시기록 W열 '준테크' → JT", ctx._pep_normalizeTempVendorPrefix_("준테크"), "JT");
check("임시기록 W열 'NS0001' → JT", ctx._pep_normalizeTempVendorPrefix_("NS0001"), "JT");

console.log("  — 대리판매: 택배사 판정 (NS 품목 → CJ대한통운)");
setOrigins({ "NS0001": "대리발송", "NS0002": "평택" });
check("출고지 대리발송 + NS → CJ",
  ctx._pep_carrierForArchiveRow_(null, "대리판매", "", "NS0001"), "CJ대한통운");
check("출고지 없는 NS + 출처 대리판매 → CJ",
  ctx._pep_carrierForArchiveRow_(null, "대리판매", "", "NS9999"), "CJ대한통운");
check("출고지 평택인 NS → 롯데 (자사출고가 이긴다)",
  ctx._pep_carrierForArchiveRow_(null, "대리판매", "", "NS0002"), "롯데택배");
check("업체명 '준테크' → CJ",
  ctx._pep_carrierForArchiveRow_(null, "대리판매", "준테크", ""), "CJ대한통운");

console.log("\n[7] 업체_택배사 표가 접두를 덮는다 (시트 우선)");
setOrigins({ "HR1234": "대리발송" });
vm.runInContext('_VC_TABLE_.byPfx["HR"] = "우체국";', ctx);
check("표에 HR=우체국 → 표를 따른다",
  ctx._pep_carrierFromItemCode_("HR1234", "").carrier, "우체국");
// NS 는 JT 로 환산된 뒤 조회되므로, 표에 NS 행을 넣어도 무시된다
vm.runInContext('_VC_TABLE_.byPfx["NS"] = "한진택배";', ctx);
setOrigins({ "NS0001": "대리발송" });
check("표의 NS 행은 무시 (JT 로 환산 후 조회)",
  ctx._pep_carrierFromItemCode_("NS0001", "").carrier, "CJ대한통운");
vm.runInContext('_VC_TABLE_.byPfx["JT"] = "한진택배";', ctx);
check("표의 JT 행은 따른다",
  ctx._pep_carrierFromItemCode_("NS0001", "").carrier, "한진택배");

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
