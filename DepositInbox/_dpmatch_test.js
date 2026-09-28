/* 입금 ↔ 주문서 매칭 규칙 검증 (로컬, clasp push 제외)
   잘못 붙이면 채권이 틀어진다 — «애매하면 사람에게» 를 지키는지 본다. */
const path = require('path');
const m = require(path.join(__dirname, 'dpMatch.gs'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};
const dep = (name, amount, txAt = '2026-09-29 14:00') => ({ name, amount, txAt });
const O = (no, date, code, name, amount, paid = 0) => ({ no, date, code, name, amount, paid });

const ORDERS = [
  O('2026/09/25-1', '2026-09-25', 'C01', '(주)태양포장', 500000),
  O('2026/09/26-2', '2026-09-26', 'C01', '(주)태양포장', 300000),
  O('2026/09/27-1', '2026-09-27', 'C02', '콤콤', 320000),
  O('2026/09/27-2', '2026-09-27', 'C03', '부원산업 주식회사', 88000),
  O('2026/09/28-1', '2026-09-28', 'C04', '아주상사', 88000),
  O('2026/09/28-5', '2026-09-28', 'C05', '뉴파츠', 990000, 990000),       // 이미 다 받음
  O('2026/09/30-1', '2026-09-30', 'C02', '콤콤', 320000),                 // 입금일 뒤 주문
];

console.log('\n[이름 정리]');
ok('(주)·공백을 뺀다', m.dpNormName('(주)태양 포장') === '태양포장');
ok('주식회사·㈜', m.dpNormName('부원산업 주식회사') === '부원산업' && m.dpNormName('㈜콤콤') === '콤콤');

console.log('\n[일치]');
{
  const r = m.dpMatchDeposit(dep('태양포장', 500000), ORDERS, {});
  ok('이름 정리로 거래처를 찾고 한 주문과 일치', r.result === '일치' && r.code === 'C01' && r.alloc[0].no === '2026/09/25-1', JSON.stringify(r));
  ok('어떻게 찾았는지 남긴다', r.how === '이름');
}
{
  const r = m.dpMatchDeposit(dep('(주)태양포장', 300000), ORDERS, {});
  ok('같은 거래처 두 번째 주문과 일치', r.result === '일치' && r.alloc[0].no === '2026/09/26-2');
}

console.log('\n[일치(합산)]');
{
  const r = m.dpMatchDeposit(dep('태양포장', 800000), ORDERS, {});
  ok('두 주문 합 = 입금', r.result === '일치(합산)' && r.alloc.length === 2, JSON.stringify(r));
  ok('주문마다 남은 돈만큼 채운다', r.alloc[0].apply === 500000 && r.alloc[1].apply === 300000);
}

console.log('\n[부족 · 초과]');
{
  const r = m.dpMatchDeposit(dep('콤콤', 300000), ORDERS, {});
  ok('모자라면 부족', r.result === '부족' && r.diff === -20000, JSON.stringify(r));
  ok('있는 만큼 채운다', r.alloc[0].apply === 300000);
}
{
  const r = m.dpMatchDeposit(dep('콤콤', 322000), ORDERS, {});
  ok('콤콤 주문 둘(320,000×2) 합 640,000 보다 적으면 부족', r.result === '부족' && r.alloc[0].no === '2026/09/27-1', JSON.stringify(r));
}
{
  const r = m.dpMatchDeposit(dep('콤콤', 642000), ORDERS, {});
  ok('남으면 초과', r.result === '초과' && r.diff === 2000, JSON.stringify(r));
}
{
  // 이카운트 실데이터: 주문번호 날짜가 입금일보다 뒤인 주문이 있다 (납기는 앞)
  const r = m.dpMatchDeposit(dep('콤콤', 320000, '2026-09-29 10:00'), [O('2026/10/13-2', '2026-10-13', 'C02', '콤콤', 320000)], {});
  ok('주문번호 날짜가 입금일 뒤여도 쓴다', r.result === '일치', JSON.stringify(r));
}
{
  const r = m.dpMatchDeposit(dep('환불처리', 18000), [O('R', '2026-09-27', 'C09', '환불처리', -18000)], {});
  ok('금액 0 이하 주문(반품·차감)은 후보가 아니다', r.result === '미확인', JSON.stringify(r));
}
{
  const r = m.dpMatchDeposit(dep('태양포장', 600000), ORDERS, {});
  ok('두 주문 사이 금액 — 오래된 것부터 채우고 부족', r.result === '부족' && r.alloc.length === 2 &&
     r.alloc[0].apply === 500000 && r.alloc[1].apply === 100000 && r.diff === -200000, JSON.stringify(r));
}

console.log('\n[분할 입금 — 입금누계]');
{
  const orders = [O('A', '2026-09-27', 'C02', '콤콤', 320000, 300000)];
  const r = m.dpMatchDeposit(dep('콤콤', 20000), orders, {});
  ok('남은 20,000 이 들어오면 일치', r.result === '일치' && r.alloc[0].apply === 20000);
}

console.log('\n[못 찾으면 사람에게]');
{
  const r = m.dpMatchDeposit(dep('홍길동', 88000), ORDERS, {});
  ok('이름 모름 + 같은 금액 주문 2건 → 후보', r.result === '후보' && r.candidates.length === 2, JSON.stringify(r));
  ok('자동으로 붙이지 않는다', r.alloc.length === 0 && r.code === '');
}
{
  const r = m.dpMatchDeposit(dep('홍길동', 12345), ORDERS, {});
  ok('이름도 금액도 모름 → 미확인', r.result === '미확인' && r.alloc.length === 0);
}
{
  const r = m.dpMatchDeposit(dep('뉴파츠', 990000), ORDERS, {});
  ok('이미 다 받은 주문은 후보가 아니다 → 미확인', r.result === '미확인' && r.alloc.length === 0 && r.candidates.length === 0, JSON.stringify(r));
}

console.log('\n[별칭표]');
{
  const al = { [m.dpNormName('홍길동')]: 'C03' };
  const r = m.dpMatchDeposit(dep('홍길동', 88000), ORDERS, al);
  ok('한 번 지정한 입금자는 거래처로 바로', r.result === '일치' && r.code === 'C03' && r.how === '별칭', JSON.stringify(r));
}

console.log('\n[비슷한 이름]');
{
  const r = m.dpMatchDeposit(dep('부원산업사', 88000), ORDERS, {});
  ok('한쪽이 다른 쪽을 품으면 (3글자↑) 찾는다', r.result === '일치' && r.code === 'C03' && r.how === '비슷한 이름', JSON.stringify(r));
  const orders = [O('X', '2026-09-27', 'D1', '한빛포장', 1000), O('Y', '2026-09-27', 'D2', '한빛포장산업', 2000)];
  const r2 = m.dpMatchDeposit(dep('한빛포장산업사', 1000), orders, {});
  ok('비슷한 거래처가 둘이면 짐작하지 않는다 (같은 금액 주문은 후보로)',
     r2.code === '' && r2.result === '후보' && r2.candidates.join() === 'X', JSON.stringify(r2));
  const r3 = m.dpMatchDeposit(dep('한빛', 1000), orders, {});
  ok('2글자는 비슷한 이름으로 안 붙인다', r3.how !== '비슷한 이름', JSON.stringify(r3));
}

console.log('\n[「상호 + 대표자명」 — 이카운트 거래처 945건 중 904건]');
{
  const real = [
    O('1', '2026-09-28', '6190464617', '구도로통닭 역곡점 이병남', 68500),
    O('2', '2026-09-28', '5049089283', '의령농산/표건욱', 1410000),
    O('3', '2026-09-28', '1111111111', '본가참순대 이령', 45000),
    O('4', '2026-09-28', '2222222222', '육쌈냉면 산본점 서형택', 132000),
    O('5', '2026-09-28', '3333333333', '육쌈냉면 역곡점 김희숙', 99000),
  ];
  let r = m.dpMatchDeposit(dep('이병남', 68500), real, {});
  ok('대표자 이름으로 입금 → 거래처', r.result === '일치' && r.code === '6190464617' && r.how === '이름 일부', JSON.stringify(r));
  r = m.dpMatchDeposit(dep('표건욱', 1410000), real, {});
  ok('「상호/대표자」 슬래시도 조각으로', r.result === '일치' && r.code === '5049089283', JSON.stringify(r));
  r = m.dpMatchDeposit(dep('이령', 45000), real, {});
  ok('2글자 이름도 조각이 통째로 같으면', r.result === '일치' && r.code === '1111111111', JSON.stringify(r));
  r = m.dpMatchDeposit(dep('구도로통닭역곡', 68500), real, {});
  ok('은행이 잘라 보낸 상호도 (품음)', r.result === '일치' && r.code === '6190464617' && r.how === '비슷한 이름', JSON.stringify(r));
  r = m.dpMatchDeposit(dep('육쌈냉면', 132000), real, {});
  ok('같은 상호 가게가 둘이면 거래처로 안 붙이고 금액으로 후보', r.code === '' && r.result === '후보' && r.candidates.join() === '4', JSON.stringify(r));
  const twins = real.concat([O('6', '2026-09-28', '4444444444', '다른가게 이령', 45000)]);
  r = m.dpMatchDeposit(dep('이령', 45000), twins, {});
  ok('같은 대표자 이름이 두 거래처에 있으면 짐작하지 않는다', r.code === '' && r.result === '후보', JSON.stringify(r));
}

console.log('\n[합 조합이 둘 이상]');
{
  const orders = [O('a', '2026-09-20', 'E1', '이지팩', 100), O('b', '2026-09-21', 'E1', '이지팩', 200),
                  O('c', '2026-09-22', 'E1', '이지팩', 300), O('d', '2026-09-23', 'E1', '이지팩', 400)];
  const r = m.dpMatchDeposit(dep('이지팩', 500), orders, {});
  ok('100+400 · 200+300 둘 다 맞으면 후보', r.result === '후보' && r.alloc.length === 0, JSON.stringify(r));
}

console.log('\n[이카운트 주문서조회 엑셀 읽기]');
{
  const rows = [
    ['회사명 : 주식회사 팩투유 / 2026/08/30  ~ 2026/10/29 ', '', '', '', '', '', '', '', '', '', '', ''],
    ['주문번호', '거래처명', '거래처코드', '거래처모바일', '수령인', '담당자', '품목', '납기일자', '금액', '종결\n여부', '진행\n상태', '인쇄'],
    ['2026/10/13 -2', '의령농산/표건욱', '504-90-89283', '', '', '박상식', 'JH 9193', '2026/09/28 ', '1,410,000', '진행중', '조회', '인쇄'],
    ['2026/09/28 -44', '구도로통닭 역곡점 이병남', '6190464617', '010-0000-0000', '', '고윤서', 'JH 68파이', '2026/09/28 ', '68,500', '완료', '조회', '인쇄'],
    ['2026/09/20 -3', '반품가게', '1234567890', '', '', '', 'x', '2026/09/20', '-18,000', '완료', '조회', '인쇄'],
    ['2026/09/29 (화) 오전 12:26:11', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const r = m.dpParseOrderSheet(rows);
  ok('읽힌다', r.ok && r.orders.length === 3, JSON.stringify(r).slice(0, 200));
  ok('주문번호 공백 정리', r.orders[0].no === '2026/10/13-2');
  ok('날짜·납기', r.orders[0].date === '2026-10-13' && r.orders[0].due === '2026-09-28');
  ok('금액 쉼표·음수', r.orders[0].amount === 1410000 && r.orders[2].amount === -18000);
  ok('종결여부 줄바꿈 머리글도 찾는다', r.orders[1].done === '완료');
  ok('끝의 내려받은 시각 줄은 건너뛴다', r.skipped === 1);
  const bad = m.dpParseOrderSheet([['아무거나'], ['a', 'b']]);
  ok('다른 엑셀이면 알려 준다', !bad.ok && bad.error.includes('주문서조회'));
}
{
  // 실파일이 있으면 통째로 읽어 본다 (없는 PC 에서는 건너뛴다)
  let X = null;
  try { X = require('D:/Pack2U_협력업체시스템_v2/app/node_modules/xlsx'); } catch (e) {}
  const f = 'D:/이카운트/주문서 전체.xlsx';
  if (X && require('fs').existsSync(f)) {
    const wb = X.readFile(f);
    const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    const r = m.dpParseOrderSheet(rows);
    ok('실파일 945건', r.ok && r.orders.length === 945, r.orders.length);
    ok('실파일 주문번호가 겹치지 않는다', new Set(r.orders.map(o => o.no)).size === r.orders.length);
  } else console.log('  (실파일 없음 — 건너뜀)');
}

console.log('\n' + pass + ' 통과 · ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
