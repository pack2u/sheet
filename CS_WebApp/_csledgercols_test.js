/* 반품관리대장 열 인식 검증 (로컬 검증용)

   대장 양식은 지금까지 네 번 바뀌었다. 열이 하나 끼어들면 뒤가 전부 밀린다.
   그런데 코드는 못 찾으면 **위치로 찍는다**(K열=유형, M열=반품비).
   그래서 밀린 날부터 조용히 다른 열을 읽는다 — 아무도 모른다.

   실제로 2026-09 에 H열에 「반품송장번호」가 끼면서:
     · 유형(재출고/단순/오주문입력/오배송)이 안 읽혔다
     · 반품비 자리에 「회수신청」 Y/N 이 들어왔다

   여기 헤더는 csDumpReturnLedgerSchema 로 뽑은 **실제 시트 값**이다.
   양식이 또 바뀌면 이 파일에 한 줄 더 넣는다.
*/
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };

/* csOrderSearch.gs 는 크고 GAS 전역이 많다 — 필요한 함수만 떼어 온다 */
const src = fs.readFileSync(path.join(__dirname, 'csOrderSearch.gs'), 'utf8').split(/\r?\n/);
const a = src.findIndex(l => l.indexOf('function _cs_mapReturnLedgerCols_(header)') !== -1);
if (a < 0) { console.error('_cs_mapReturnLedgerCols_ 를 못 찾았습니다'); process.exit(1); }
let depth = 0, b = -1;
for (let i = a; i < src.length; i++) {
  for (const ch of src[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  if (depth === 0 && i > a) { b = i + 1; break; }
}
const ctx = { String, Object, console };
vm.createContext(ctx);
vm.runInContext(src.slice(a, b).join('\n'), ctx);
const map = ctx._cs_mapReturnLedgerCols_;

/** 열 문자로 읽기 쉽게 */
const L = (i) => (i < 0 ? '없음' : String.fromCharCode(65 + i));

/* ── 실제 헤더 (csDumpReturnLedgerSchema 결과) ── */
const 양식 = {
  '202604': ['', '반품접수날짜', '접수자', '업체명', '반품신청자/수취인명', '연락처', '추가연락처',
    '상품명', '수량', '원송장번호', '교환/반품', '고객오주문/오배송', '선출고/입고검수후출고',
    '처리상태', '비고 및추가처리사항', '이카운트 반영', '', '', '', '반품송장번호'],

  '202605': ['', '반품접수날짜', '접수자', '업체명', '반품신청자/수취인명', '연락처', '추가연락처',
    '상품명', '수량', '원송장번호', '교환/반품', '고객오주문/오배송', '선출고/입고검수후출고',
    '처리상태', '비고 및추가처리사항', '이카운트 반영', '반품송장번호'],

  '202608': ['', '반품접수날짜', '접수자', '업체명', '반품신청자/수취인명', '연락처', '추가연락처',
    '상품명', '수량', '원송장번호', '재출고/단순/오주문입력/오배송', '회수신청', '반품/환불비용',
    '이카운트 반영', '비고 및추가처리사항', '', '', '', '', '반품송장번호'],

  // 2026-09: H열에 반품송장번호가 끼어들어 뒤가 한 칸씩 밀렸다
  '202609': ['', '반품접수날짜', '접수자', '업체명', '반품신청자/수취인명', '연락처', '추가연락처',
    '반품송장번호', '상품명', '수량', '원송장번호', '재출고/단순/오주문입력/오배송', '회수신청',
    '반품/환불비용', '이카운트 반영', '비고 및추가처리사항', '', '', '', '', '반품송장번호'],
};

/* 기대값 — 열 문자 */
const 기대 = {
  '202604': { date: 'B', staff: 'C', vendor: 'D', name: 'E', phone: 'F', item: 'H', qty: 'I',
    invoice: 'J', type: 'K', fee: 'M', notice: 'O', returnInvoice: 'T' },
  '202605': { date: 'B', staff: 'C', vendor: 'D', name: 'E', phone: 'F', item: 'H', qty: 'I',
    invoice: 'J', type: 'K', fee: 'M', notice: 'O', returnInvoice: 'Q' },
  '202608': { date: 'B', staff: 'C', vendor: 'D', name: 'E', phone: 'F', item: 'H', qty: 'I',
    invoice: 'J', type: 'K', fee: 'M', notice: 'O', returnInvoice: 'T' },
  '202609': { date: 'B', staff: 'C', vendor: 'D', name: 'E', phone: 'F', item: 'I', qty: 'J',
    invoice: 'K', type: 'L', fee: 'N', notice: 'P', returnInvoice: 'H' },
};

for (const 월 in 양식) {
  console.log('\n[' + 월 + ' 양식]');
  const col = map(양식[월]);
  const want = 기대[월];
  for (const f in want) {
    ok(f + ' → ' + want[f], L(col[f]) === want[f] ? true
      : (console.log('       실제: ' + L(col[f]) + ' (' + (양식[월][col[f]] || '') + ')'), false));
  }
  ok('처리상태는 A열 고정', col.status === 0);
}

/* 이번에 터진 것 — 못을 따로 박는다 */
console.log('\n[2026-09 에 실제로 터진 것]');
{
  const col = map(양식['202609']);
  ok('반품비가 「회수신청」을 안 집는다', 양식['202609'][col.fee] !== '회수신청');
  ok('반품비는 「반품/환불비용」이다', 양식['202609'][col.fee] === '반품/환불비용');
  ok('유형을 찾는다 (전에는 못 찾았다)', col.type >= 0);
  ok('유형이 원송장번호를 안 집는다', 양식['202609'][col.type] !== '원송장번호');
  ok('반품송장은 앞쪽 H를 쓴다', col.returnInvoice === 7);
  ok('원송장과 반품송장이 다른 열이다', col.invoice !== col.returnInvoice);
}

/* ★ 추가연락처(실번호) — 2026-09-11 ★
     > "쿠팡의 경우 안심번호라 기간이 지나면 연락이 안되"

   두 가지를 못 박는다.
     ① 종전에는 phone2 항목 자체가 없어 F열 실번호를 «아무도 안 읽었다».
     ② /연락처/ 는 「추가연락처」에도 걸린다. 지금은 E가 F보다 앞이라
        우연히 맞고 있을 뿐이라, 순서가 바뀌는 날 뒤집힌다. */
console.log('\n[추가연락처 = 실번호]');
for (const 월 in 양식) {
  const col = map(양식[월]);
  ok(월 + ' — 실번호를 찾는다', col.phone2 >= 0 &&
    String(양식[월][col.phone2]).indexOf('추가연락처') === 0);
  ok(월 + ' — 주 연락처를 안 뺏는다', 양식[월][col.phone] === '연락처');
}
{
  /* 열 순서가 뒤바뀐 가상 양식 — 추가연락처가 «먼저» 온다 */
  const 뒤바뀜 = ['', '반품접수날짜', '접수자', '업체명', '반품신청자/수취인명',
    '추가연락처', '연락처', '상품명', '수량', '원송장번호'];
  const col = map(뒤바뀜);
  ok('추가연락처가 앞에 와도 주 연락처를 안 뺏는다', 뒤바뀜[col.phone] === '연락처');
  ok('그때도 실번호는 제자리', 뒤바뀜[col.phone2] === '추가연락처');
}

{
  /* ★ 「실번호 이름」 열 — 2026-09-11 ★
       > "주문자와 상담자가 다른경우가 있어"
     /실번호/ 는 「실번호 이름」에도 걸린다. 이름 열이 번호 열 자리를
     뺏으면 전화번호 칸에 사람 이름이 들어간다. */
  const 이름열 = ['', '반품접수날짜', '접수자', '업체명', '반품신청자/수취인명',
    '연락처', '추가연락처', '실번호 이름', '상품명', '수량', '원송장번호'];
  const col = map(이름열);
  ok('실번호 이름을 제 열로 찾는다', 이름열[col.phone2Name] === '실번호 이름');
  ok('이름 열이 실번호 자리를 안 뺏는다', 이름열[col.phone2] === '추가연락처');
  ok('이름 열이 주 연락처도 안 뺏는다', 이름열[col.phone] === '연락처');

  /* 이름 열이 «먼저» 와도 마찬가지여야 한다 */
  const 앞에 = ['', '반품접수날짜', '접수자', '업체명', '반품신청자/수취인명',
    '실번호 이름', '추가연락처', '연락처', '상품명'];
  const c2 = map(앞에);
  ok('이름이 앞에 와도 실번호는 제자리', 앞에[c2.phone2] === '추가연락처');
  ok('이름이 앞에 와도 주 연락처는 제자리', 앞에[c2.phone] === '연락처');

  /* 이름 열이 «없는» 지금 양식에서는 -1 이어야 한다 — 비고로 흘린다 */
  ok('이름 열이 없으면 -1', map(양식['202609']).phone2Name === -1);
}

console.log('\n[열이 또 밀려도 엉뚱한 걸 안 집는다]');
{
  // 앞에 열이 하나 더 끼는 가상 양식
  const 미래 = ['', '신규열', '반품접수날짜', '접수자', '업체명', '반품신청자/수취인명', '연락처',
    '추가연락처', '반품송장번호', '상품명', '수량', '원송장번호',
    '재출고/단순/오주문입력/오배송', '회수신청', '반품/환불비용', '이카운트 반영', '비고'];
  const col = map(미래);
  ok('유형을 헤더로 찾는다', 미래[col.type] === '재출고/단순/오주문입력/오배송');
  ok('반품비를 헤더로 찾는다', 미래[col.fee] === '반품/환불비용');
  ok('회수신청을 금액으로 안 읽는다', 미래[col.fee] !== '회수신청');
}

console.log('\n[헤더가 아예 없으면 옛 방식대로 위치로 찍는다]');
{
  const 빈헤더 = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  const col = map(빈헤더);
  ok('K열을 유형으로', col.type === 10);
  ok('M열을 반품비로', col.fee === 12);
}

console.log('\n' + (fail ? `실패 ${fail}건 / 통과 ${pass}건` : `모두 통과 (${pass}건)`));
process.exit(fail ? 1 : 0);
