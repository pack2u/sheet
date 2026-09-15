/**
 * 택배사 판정 — 근거의 «차례»
 *
 *  > "대리판매업체외에는 자사출고지.. 중요한건 송장수집시 어디에서
 *  >  수집했냐가 중요한거지.."
 *  > "자릿수로 택배사는 못구별해.. 택배사 정보를 읽게 만들어줘"
 *
 *  흐름
 *    세트분리 → 대리공급 푸시 → 협력업체 파일(업체가 송장을 적는다)
 *    → 송장 수집 → _pep_carrierForArchiveRow_ ← 택배사는 «여기서만» 정해진다
 *    → 허브 R열 · 임시기록 V열 · 업체 발주탭 P열 · 일일마감 → 원장 → CS
 *    아래 것들은 전부 이 값을 «받아 적기만» 한다. 규칙을 두 군데 두지 않는다.
 *
 *  차례 (앞이 곧 신뢰도)
 *    ① 송장맵 — 걷어 온 탭이 실어 준 값
 *    ② 출처   — 로젠·롯데·한진처럼 «걷은 탭이 곧 택배사»인 경우
 *    ③ 발주업체 — 그 업체 파일에서 걷었으면 그 업체가 부친 것이다
 *    ④ 품목코드 접두 — 마지막 보루
 *
 *  2026-09-15 에 지운 것 (둘 다 자사 택배사를 코드에 박아 둔 것)
 *    · 「평택 출고지면 무조건 롯데」   — 출고지는 대리판매업체 빼면 전부 자사다
 *    · 「합포장·1주출고는 롯데」        — 그 둘은 택배사가 아니라 묶는 방식이다
 *  둘 다 09-11 로젠 전환 뒤로 계속 틀린 값을 냈다. 갈아탈 때마다 같은 사고가 난다.
 *
 * 실행: node _pep_carrier_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}
const 줄 = () => console.log("");

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

//  실제 「업체_택배사」 표 모양
const 표 = { HP: "롯데택배", HR: "로젠택배", JT: "대한통운", GS: "CJ대한통운", OC: "한진택배" };
const 이름표 = { 하나팩: "롯데택배", 뉴파츠: "로젠택배", 부엉이커피: "한진택배" };
const 출고지 = { HRACM0001: "평택", JHSGJJIM00102: "대리발송" };

const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext([
  "var _PEP_VENDOR_CARRIER_ = {};",
  "var _PEP_VENDOR_LABELS_ = { HP: '하나팩', HR: '뉴파츠', JT: '준테크', GS: '지에스', OC: '부엉이커피' };",
  "var _PEP_PREFIX_ALIAS_ = { JH: 'JT', BF: 'JT', NS: 'JT' };",
  "function _pep_resolvePrefixAlias_(p) { return _PEP_PREFIX_ALIAS_[p] || p; }",
  "var _표_ = " + JSON.stringify(표) + ";",
  "var _이름표_ = " + JSON.stringify(이름표) + ";",
  "var _출고지_ = " + JSON.stringify(출고지) + ";",
  "function _pep_loadVendorCarrierTable_() { return { byPfx: _표_, byLabel: _이름표_ }; }",
  "function _pep_loadItemShipOriginIndex_() { return { map: _출고지_ }; }",
  "function _pep_carrierWithLag_(c) { return c || ''; }",
  "function _pep_normalizeTempVendorPrefix_(v) {",
  "  var c = String(v || '').replace(/[ ]/g, '').toUpperCase();",
  "  for (var k in _PEP_VENDOR_LABELS_) if (c === k) return k;",
  "  return '';",
  "}",
  grabFn("_pep_carrierFromSource_"),
  grabFn("_pep_isPartnerShipSource_"),
  grabFn("_pep_isOwnWarehouseOrigin_"),
  grabFn("_pep_isProxyShipOrigin_"),
  grabFn("_pep_carrierFromItemCodePrefix_"),
  grabFn("_pep_carrierFromItemCode_"),
  grabFn("_pep_carrierForVendor_"),
  grabFn("_pep_carrierForArchiveRow_"),
].join("\n"), ctx);

//  판정(송장맵, 출처, 발주업체, 이카운트코드)
const 판정 = (inv, source, vendor, code) =>
  ctx._pep_carrierForArchiveRow_(inv, source, vendor, code);

줄();
console.log("[① 송장맵] 걷어 온 탭이 실어 준 값이 가장 앞");
check("★ 다른 근거가 뭐든 이것이 이긴다",
  판정({ carrier: "대신택배" }, "로젠", "뉴파츠", "HRACM0001"), "대신택배");

줄();
console.log("[② 출처] 걷은 탭이 곧 택배사인 경우");
check("★ 로젠 탭에서 걷었으면 로젠", 판정(null, "로젠", "부엉이커피", "HRACM0001"), "로젠택배");
check("★ 한진 탭에서 걷었으면 한진", 판정(null, "한진", "뉴파츠", "HRACM0001"), "한진택배");
check("롯데 탭에서 걷은 옛 건", 판정(null, "롯데택배", "", "없는코드"), "롯데택배");

줄();
console.log("[② 출처] 「합포장」·「1주출고」는 택배사가 아니다");
check("★ 합포장을 롯데라 하지 않는다", 판정(null, "합포장", "", "없는코드"), "");
check("★ 1주출고도 마찬가지", 판정(null, "1주출고", "", "없는코드"), "");

줄();
console.log("[③ 발주업체] 그 업체 파일에서 걷었으면 그 업체가 부친 것");
check("★ 부엉이커피 발주 → 한진", 판정(null, "대리공급", "부엉이커피", "HRACM0001"), "한진택배");
check("★ 물건이 HR 코드여도 발주업체가 앞선다",
  판정(null, "대리공급", "부엉이커피", "HRACM0001") !== "로젠택배", true);
check("뉴파츠 발주 → 로젠", 판정(null, "대리공급", "뉴파츠", "HRACM0001"), "로젠택배");

줄();
console.log("[④ 품목코드] 발주업체를 모를 때의 마지막 보루");
check("JH 물건 → 준테크 (JH→JT)", 판정(null, "대리공급", "", "JHSGJJIM00102"), "대한통운");

줄();
console.log("[근거가 없으면] 지어내지 않는다");
check("★ 평택 출고지라고 롯데를 박지 않는다", 판정(null, "", "", "HRACM0001"), "");
check("★ 업체를 못 짚으면 빈칸", 판정(null, "대리공급", "", "ZZ0001"), "");
check("★ 12자리라고 롯데라 하지 않는다", 판정(null, "", "", "없는코드463273768403"), "");

줄();
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
