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
  ok('남으면 초과', r.result === '초과' && r.diff === 2000, JSON.stringify(r));
  ok('입금일 뒤 주문은 안 쓴다', r.alloc.length === 1 && r.alloc[0].no === '2026/09/27-1');
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

console.log('\n[합 조합이 둘 이상]');
{
  const orders = [O('a', '2026-09-20', 'E1', '이지팩', 100), O('b', '2026-09-21', 'E1', '이지팩', 200),
                  O('c', '2026-09-22', 'E1', '이지팩', 300), O('d', '2026-09-23', 'E1', '이지팩', 400)];
  const r = m.dpMatchDeposit(dep('이지팩', 500), orders, {});
  ok('100+400 · 200+300 둘 다 맞으면 후보', r.result === '후보' && r.alloc.length === 0, JSON.stringify(r));
}

console.log('\n' + pass + ' 통과 · ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
