/**
 * _ecountPurchaseFromExclusive.gs 로컬 검증
 *   ① 파일 전체 구문
 *   ② 마감탭 헤더 → 열 인덱스 해석 (_epx_resolveColumns_)
 *   ③ 송장번호 상한 (_epx_capInvoices_)
 *
 * 실행: node _epx_cols_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");
const vm = require("vm");

const SRC = "_ecountPurchaseFromExclusive.gs";
const lines = fs.readFileSync(SRC, "utf8").split(/\r?\n/);

// ① 파일 전체가 파싱되는지 먼저 본다.
//    함수 하나만 떼어 테스트하면 다른 곳의 구문 오류를 놓친다.
try {
  new vm.Script(lines.join("\n"));
  console.log("구문 검사(" + SRC + "): OK\n");
} catch (e) {
  console.log("구문 검사(" + SRC + "): 실패 — " + e.message);
  process.exit(1);
}

function grab(name) {
  const s = lines.findIndex(l => l.indexOf("function " + name + "(") === 0);
  if (s < 0) throw new Error(name + " 없음");
  let e = s;
  while (lines[e] !== "}") e++;
  return lines.slice(s, e + 1).join("\n");
}
eval(grab("_epx_resolveColumns_"));
eval(grab("_epx_capInvoices_"));
eval(grab("_epx_cleanCustCd_"));

// 상수는 원본에서 읽어 온다 (하드코딩하면 원본이 바뀌어도 테스트가 통과해 버린다)
const _EPX_MAX_INVOICES_ = Number(
  (lines.find(l => l.indexOf("var _EPX_MAX_INVOICES_") === 0) || "").match(/=\s*(\d+)/)[1]
);

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  OK " : "  NG ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   <기대 " + JSON.stringify(want) + ">"));
}
function cols(label, headers, want) {
  const c = _epx_resolveColumns_(headers);
  eq(label, { itemName: c.itemName, itemCode: c.itemCode }, want);
}

console.log("── 열 해석: 후아코리아 ──");
cols("H열 품목(필수)",
  ["이동일시","일자","받는분성명(필수)","연락처","주소","우편번호","배송메시지","품목(필수)","수량(필수)","송장번호"],
  { itemName: 7, itemCode: -1 });

console.log("\n── 열 해석: 회귀 ──");
cols("품목명 + 품목코드", ["이동일시","일자","품목코드","품목명","수량","송장번호"], { itemName: 3, itemCode: 2 });
cols("품목코드만", ["이동일시","일자","품목코드","수량","송장번호"], { itemName: -1, itemCode: 2 });
cols("상품명", ["이동일시","일자","상품명","수량"], { itemName: 2, itemCode: -1 });
cols("상품명1 + 상품코드", ["이동일시","상품코드","상품명1","수량"], { itemName: 2, itemCode: 1 });
cols("상품명상세 제외", ["이동일시","상품명상세","품목명","수량"], { itemName: 2, itemCode: -1 });
cols("업체상품코드 + 품목명", ["이동일시","업체상품코드","품목명","수량(a타입)"], { itemName: 2, itemCode: 1 });
cols("품명", ["이동일시","품명","수량"], { itemName: 1, itemCode: -1 });

console.log("\n── 송장 상한 (최대 " + _EPX_MAX_INVOICES_ + "개) ──");
eq("빈값", _epx_capInvoices_(""), "");
eq("null", _epx_capInvoices_(null), "");
eq("1개", _epx_capInvoices_("123456789012"), "123456789012");
eq("4개는 그대로", _epx_capInvoices_("1\n2\n3\n4"), "1\n2\n3\n4");
eq("5개 → 앞 4개", _epx_capInvoices_("1\n2\n3\n4\n5"), "1\n2\n3\n4");
eq("40개 → 앞 4개", _epx_capInvoices_(Array.from({length:40},(_,i)=>i+1).join("\n")), "1\n2\n3\n4");
eq("쉼표 구분", _epx_capInvoices_("1,2,3,4,5"), "1\n2\n3\n4");
eq("CRLF 구분", _epx_capInvoices_("1\r\n2\r\n3"), "1\n2\n3");
eq("중복 제거 후 4개", _epx_capInvoices_("1\n1\n2\n2\n3\n4\n5"), "1\n2\n3\n4");
eq("공백/빈줄 무시", _epx_capInvoices_(" 1 \n\n 2 \n"), "1\n2");


console.log("\n── 거래처코드 정리 (_epx_cleanCustCd_) ──");
eq("앞자리 0 텍스트 보존", _epx_cleanCustCd_("00123"), "00123");
eq("6자리 0패딩 보존", _epx_cleanCustCd_("000123"), "000123");
eq("숫자는 그대로", _epx_cleanCustCd_(123), "123");
eq("소수점 .0 제거", _epx_cleanCustCd_("123.0"), "123");
eq("천단위 구분자 제거", _epx_cleanCustCd_("1,234"), "1234");
eq("구분자+앞자리0", _epx_cleanCustCd_("0,123"), "0123");
eq("빈값", _epx_cleanCustCd_(""), "");
eq("null", _epx_cleanCustCd_(null), "");

console.log("\n── 앞자리 0: 서식 순서 (정적 검사) ──");
const TEXT_COLS = JSON.parse(
  (lines.find(l => l.indexOf("var _EPX_TEXT_COLS_") === 0) || "").match(/\[[^\]]*\]/)[0]
);
eq("텍스트 잠금 열 = A,C,K,W", TEXT_COLS, [1, 3, 11, 23]);

// setValues 앞에서 잠가야 한다. 뒤면 이미 숫자가 되어 앞자리 0 이 사라진다.
function lockBeforeWrite(file) {
  const t = fs.readFileSync(file, "utf8");
  const lock = t.indexOf("_epx_lockTextCols_(tab,");
  const write = t.indexOf("setValues(outMain)");
  return lock !== -1 && write !== -1 && lock < write;
}
eq("변환탭: 잠금이 쓰기보다 먼저", lockBeforeWrite(SRC), true);
eq("당일시트: 잠금이 쓰기보다 먼저", lockBeforeWrite("_ecountPurchaseDaily.gs"), true);

// 쓴 뒤에 A열 서식을 다시 거는 옛 코드가 남아 있으면 안 된다(무의미하고 오해를 부른다)
eq("사후 A열 서식 잔재 없음",
  /setValues\(outMain\)[\s\S]{0,400}?getRange\(2, 1, outMain\.length, 1\)\.setNumberFormat/.test(
    fs.readFileSync(SRC, "utf8")
  ), false);

console.log("\n결과: 통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
