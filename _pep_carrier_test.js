/**
 * 택배사 판정 — 「물건을 대는 업체」가 보낸다
 *
 *  > "하나팩이 발송하는게 아니자나.. 하나팩에서 주문한거자나.."
 *  > "발송 업체의 택배사를 따라가는거지.."
 *  > "자릿수로 택배사는 못구별해.. 택배사 정보를 읽게 만들어줘"
 *
 *  거래처가 「대리발송-하나팩 유채정」이어도 하나팩은 «주문한 쪽»이다.
 *  박스를 부치는 것은 그 물건을 대는 업체고, 그 업체는 이카운트코드
 *  앞 두 글자가 가리킨다. 택배사는 그 업체를 「업체_택배사」 표에서 읽는다.
 *
 *  지켜야 할 것
 *    · 품목코드가 출처보다 앞선다 (출처=로젠은 「우리 탭에서 눈에 띄었다」는 뜻뿐)
 *    · 거래처명은 맨 뒤 — 주문한 쪽의 택배사로 새면 안 된다
 *    · 자사출고 택배사를 코드에 박지 않는다 (2026-09-11 롯데→로젠에서 데였다)
 *    · 송장 자릿수로 가르지 않는다
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
const 표 = { HP: "롯데택배", HR: "로젠택배", JT: "대한통운", GS: "CJ대한통운", OC: "한진택배" };
const 이름표 = { 하나팩: "롯데택배", 뉴파츠: "로젠택배", 부엉이커피: "한진택배" };
//  품목코드 → 출고지. HRACM0001 은 평소엔 «우리»가 평택에서 보내는 물건이다.
const 출고지 = { HRACM0001: "평택", JHSGJJIM00102: "대리발송", GSVNBT0001: "대리발송" };

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
  "function _pep_carrierFromSource_(s) {",
  "  s = String(s || '');",
  "  if (s.indexOf('로젠') >= 0) return '로젠택배';",
  "  if (s.indexOf('롯데') >= 0) return '롯데택배';",
  "  return '';",
  "}",
  "function _pep_normalizeTempVendorPrefix_(v) {",
  "  var c = String(v || '').replace(/\s/g, '').toUpperCase();",
  "  for (var k in _PEP_VENDOR_LABELS_) if (c === k) return k;",
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

//  판정(송장맵, 출처, 거래처·발주업체, 이카운트코드)
const 판정 = (inv, src, vendor, code) =>
  ctx._pep_carrierForArchiveRow_(inv, src, vendor, code);
const 하나팩 = "대리발송-하나팩 유채정";

console.log("\n[택배사] 보내는 것은 «물건을 대는 업체»다");
check("★ HR 물건 → 뉴파츠가 보낸다 (출처가 로젠이어도)",
  판정(null, "로젠", 하나팩, "HRACM0001"), "로젠택배");
check("★ JH 물건 → 준테크가 보낸다 (JH→JT)",
  판정(null, "로젠", 하나팩, "JHSGJJIM00102"), "대한통운");
check("★ GS 물건 → 지에스가 보낸다",
  판정(null, "", 하나팩, "GSVNBT0001"), "CJ대한통운");
check("★ 거래처(하나팩=롯데)의 택배사로 새지 않는다",
  판정(null, "", 하나팩, "GSVNBT0001") !== "롯데택배", true);
check("송장맵이 실어 온 값은 여전히 1순위",
  판정({ carrier: "한진택배" }, "로젠", 하나팩, "HRACM0001"), "한진택배");

console.log("\n[택배사] 자사출고는 출처가 답한다");
check("업체 물건이 아니면 출처로", 판정(null, "로젠", "", "없는코드"), "로젠택배");
check("롯데 탭에서 온 옛 건", 판정(null, "롯데택배", "", "없는코드"), "롯데택배");

console.log("\n[택배사] 지어내지 않는다");
check("★ 평택 출고지라고 롯데를 박지 않는다",
  판정(null, "", "", "HRACM0001"), "");
check("★ 업체를 못 짚으면 빈칸",
  판정(null, "대리공급", "", "ZZ0001"), "");
check("★ 12자리라고 롯데라 하지 않는다",
  판정(null, "", "", "없는코드463273768403"), "");

console.log("\n" + (fail ? "실패 " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
