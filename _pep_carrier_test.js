/**
 * 택배사 판정 — 「누가 보내는가」가 먼저다
 *
 *  > "택배사 정보가 다르게 나오네.. 여기는 한진인데.."
 *  > "자릿수로 택배사는 못구별해.. 택배사 정보를 읽게 만들어줘"
 *
 *  대리발송-하나팩 유채정 줄에 롯데·로젠이 찍혔다. 물건 코드는 뉴파츠(HR)·
 *  준테크(JH)·지에스(GS) 것이지만 «보내는 사람»은 하나팩이다. 하나팩은 한진을 쓴다.
 *
 *  지켜야 할 것
 *    · 발주업체를 알면 업체가 출처보다 앞선다 (출처=로젠은 「우리 탭에서 눈에
 *      띄었다」는 뜻일 뿐, 하나팩이 한진으로 보낸 사실을 못 이긴다)
 *    · 업체가 보내는 줄에 «우리» 출고지(평택)로 택배사를 정하지 않는다
 *    · 자사출고 택배사를 코드에 박지 않는다 (2026-09-11 롯데→로젠에서 데였다)
 *
 * 실행: node _pep_carrier_test.js
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

//  실제 「업체_택배사」 표 모양 (접두 → 택배사)
const 표 = { HP: "한진택배", HR: "로젠택배", JT: "대한통운", GS: "CJ대한통운" };
const 이름표 = { 하나팩: "한진택배", 뉴파츠: "로젠택배" };
//  품목코드 → 출고지 (HRACM0001 은 평소 «우리»가 평택에서 보내는 물건이다)
const 출고지 = { HRACM0001: "평택", JHSGJJIM00102: "대리발송" };

const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext([
  "var _PEP_VENDOR_CARRIER_ = {};",
  "var _PEP_VENDOR_LABELS_ = { HP: '하나팩', HR: '뉴파츠', JT: '준테크', GS: '지에스' };",
  "var _PEP_PREFIX_ALIAS_ = { JH: 'JT', BF: 'JT', NS: 'JT' };",
  "function _pep_resolvePrefixAlias_(p) { return _PEP_PREFIX_ALIAS_[p] || p; }",
  "var _표_ = " + JSON.stringify(표) + ";",
  "var _이름표_ = " + JSON.stringify(이름표) + ";",
  "var _출고지_ = " + JSON.stringify(출고지) + ";",
  "function _pep_loadVendorCarrierTable_() { return { byPfx: _표_, byLabel: _이름표_ }; }",
  "function _pep_loadItemShipOriginIndex_() { return { map: _출고지_ }; }",
  "function _pep_carrierWithLag_(c) { return c || ''; }",
  "function _pep_carrierFromSource_(s) {",
  "  s = String(s || '');",
  "  if (s.indexOf('로젠') >= 0) return '로젠택배';",
  "  if (s.indexOf('롯데') >= 0) return '롯데택배';",
  "  return '';",
  "}",
  "function _pep_normalizeTempVendorPrefix_(v) {",
  "  var c = String(v || '').replace(/\s/g, '');",
  "  for (var k in _PEP_VENDOR_LABELS_) {",
  "    if (c.toUpperCase() === k) return k;",
  "  }",
  "  return '';",
  "}",
  grabFn("_pep_isPartnerShipSource_"),
  grabFn("_pep_isOwnWarehouseOrigin_"),
  grabFn("_pep_isProxyShipOrigin_"),
  grabFn("_pep_carrierFromItemCodePrefix_"),
  grabFn("_pep_carrierFromItemCode_"),
  grabFn("_pep_carrierForVendor_"),
  grabFn("_pep_carrierForArchiveRow_"),
].join("\n"), ctx);

const 판정 = (inv, src, vendor, code) =>
  ctx._pep_carrierForArchiveRow_(inv, src, vendor, code);

console.log("\n[택배사] 업체를 알면 업체가 먼저다");
check("★ 하나팩 줄은 출처가 로젠이어도 한진",
  판정(null, "로젠", "대리발송-하나팩 유채정", "HRACM0001"), "한진택배");
check("★ 물건이 준테크 코드여도 보내는 건 하나팩",
  판정(null, "로젠", "대리발송-하나팩 유채정", "JHSGJJIM00102"), "한진택배");
check("★ 물건이 지에스 코드여도 마찬가지",
  판정(null, "", "대리발송-하나팩 유채정", "GSVNBT0001"), "한진택배");
check("송장맵이 실어 온 값은 여전히 1순위",
  판정({ carrier: "대한통운" }, "로젠", "대리발송-하나팩 유채정", "HRACM0001"), "대한통운");

console.log("\n[택배사] 자사출고는 종전대로 출처가 답한다");
check("업체가 없으면 출처로", 판정(null, "로젠", "", "HRACM0001"), "로젠택배");
check("롯데 탭에서 온 옛 건", 판정(null, "롯데택배", "", "HRACM0001"), "롯데택배");

console.log("\n[택배사] 지어내지 않는다");
check("★ 평택 출고지라고 롯데를 박지 않는다",
  판정(null, "", "", "HRACM0001"), "");
check("★ 업체 줄인데 업체를 못 짚으면 빈칸",
  판정(null, "대리공급", "모르는업체", "ZZ0001"), "");
check("출고지가 대리발송이면 접두로 업체를 짚는다",
  판정(null, "", "", "JHSGJJIM00102"), "대한통운");

console.log("\n[택배사] 자릿수로 가르지 않는다");
check("★ 12자리라고 롯데라 하지 않는다",
  판정(null, "", "", "없는코드463273768403"), "");

console.log("\n" + (fail ? "실패 " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
