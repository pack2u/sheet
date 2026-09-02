/* 미매칭 → 미발송 의심 판정 검증 (로컬 검증용)
   파일: _partnerInvoiceAudit.gs 의 _pia_isNoShipStatus_ / _pia_itemStatusMap_

   틀리면 조용히 나쁜 쪽으로 간다:
     · "품절+7"(7일 뒤 입고)을 품절로 보면 멀쩡한 주문이 미발송 의심으로 뜬다.
     · 헤더를 못 찾으면 전건이 "의심 없음"으로 나와 아무도 문제를 모른다.
       그래서 그 경우 error 를 채워 보고서에 경고가 뜨게 했다. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '_partnerInvoiceAudit.gs'), 'utf8');
const a = src.indexOf('var _PIA_STATUS_MAP_ = null;');
const b = src.indexOf('function partnerAnalyzeUnmatched');
if (a < 0 || b < 0 || b <= a) { console.error('모듈 구간을 못 찾았습니다'); process.exit(1); }

let SHEET = null;
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => (n === '상품정보' && SHEET) ? SHEET : null }) },
  String, console,
};
vm.createContext(ctx);
vm.runInContext(src.slice(a, b), ctx);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };
const setSheet = rows => { SHEET = { getDataRange: () => ({ getDisplayValues: () => rows }) }; ctx._PIA_STATUS_MAP_ = null; };

console.log('\n[상태값 판정]');
ok('품절 → 품절', ctx._pia_isNoShipStatus_('품절') === '품절');
ok('단종품 → 단종', ctx._pia_isNoShipStatus_('단종품') === '단종');
ok('판매중 → 아님', ctx._pia_isNoShipStatus_('판매중') === '');
ok('재고까지만 → 아님 (아직 나간다)', ctx._pia_isNoShipStatus_('재고까지만') === '');
ok('품절+7 → 아님 (7일 뒤 입고)', ctx._pia_isNoShipStatus_('품절+7') === '');
ok('품절+14 → 아님', ctx._pia_isNoShipStatus_('품절+14') === '');
ok('빈 값 → 아님', ctx._pia_isNoShipStatus_('') === '');
ok('null → 아님', ctx._pia_isNoShipStatus_(null) === '');

console.log('\n[상품정보 읽기 — 표준 5행 헤더]');
setSheet([
  ['', '', ''], ['', '', ''], ['', '', ''], ['', '', ''],
  ['품목코드', '품목명', '상태'],
  ['AJ00011', '냅킨 대용량', '품절'],
  ['AJ00012', '종이컵 6.5oz', '판매중'],
  ['AJ00013', '빨대 개별포장', '단종품'],
]);
let m = ctx._pia_itemStatusMap_();
ok('헤더를 찾는다', !m.error);
ok('3행을 읽는다', m.rows === 3);
ok('코드로 상태를 준다', m.byCode['AJ00011'] === '품절');
ok('품목명으로도 준다', m.byName['냅킨대용량'] === '품절');
ok('소문자 코드도 대문자로 맞춰 저장', m.byCode['AJ00013'] === '단종품');

console.log('\n[헤더 위치가 달라도 찾는다]');
setSheet([
  ['메모', '이카운트코드', '상품명', '단가', '상태'],
  ['', 'NK0001', '물티슈', '1000', '품절'],
]);
m = ctx._pia_itemStatusMap_();
ok('1행 헤더 + 다른 이름(이카운트코드/상품명)', !m.error && m.byCode['NK0001'] === '품절');

console.log('\n[못 읽으면 조용히 넘어가지 않는다]');
setSheet([['가', '나', '다'], ['1', '2', '3']]);
m = ctx._pia_itemStatusMap_();
ok('헤더가 없으면 error 를 채운다', !!m.error);
ok('error 문구에 무엇을 못 찾았는지 적는다', /품목코드|상태/.test(m.error));
SHEET = null; ctx._PIA_STATUS_MAP_ = null;
m = ctx._pia_itemStatusMap_();
ok('탭 자체가 없어도 error', m.error.indexOf('상품정보') !== -1);

console.log('\n[상태가 빈 행은 건너뛴다]');
setSheet([
  ['품목코드', '품목명', '상태'],
  ['A1', '가', ''],
  ['A2', '나', '품절'],
]);
m = ctx._pia_itemStatusMap_();
ok('빈 상태는 세지 않는다', m.rows === 1 && !m.byCode['A1']);

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
