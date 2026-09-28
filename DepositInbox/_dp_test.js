/* 입금 문자 해석·고유번호·잔액 연속성 검증 (로컬 검증용, clasp push 제외)

   ★ 아래 문자는 은행별 «흔한 형식»을 본떠 만든 것이다 ★
   실제 문자를 받으면 FIXTURE 를 실문자로 바꾸고 기대값을 맞춘다.
   (계좌·이름은 가려서 넣는다) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'dpParse.gs'), 'utf8'), ctx);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};

const RCV = new Date(2026, 8, 28, 14, 33); // 2026-09-28 14:33

const FIXTURE = [
  { bank: '신한', body: '[Web발신]\n신한09/28 14:32\n110-***-123456\n입금     50,000\n잔액  1,230,000\n 홍길동',
    want: { bank: '신한', kind: '입금', amount: 50000, balance: 1230000, name: '홍길동', txAt: '2026-09-28 14:32' } },
  { bank: '국민', body: '[KB]09/28 14:32\n123456**789\n태양포장\n입금\n500,000\n잔액3,730,000',
    want: { bank: '국민', kind: '입금', amount: 500000, balance: 3730000, name: '태양포장', txAt: '2026-09-28 14:32' } },
  { bank: '농협', body: '농협 입금50,000원\n09/28 14:32 351-****-5678-12 홍길동 잔액1,230,000원',
    want: { bank: '농협', kind: '입금', amount: 50000, balance: 1230000, name: '홍길동' } },
  { bank: '기업', body: '[기업은행] 입금 120,000원 (주)콤콤 09/28 14:32 잔액 1,350,000원 123-******-01-012',
    want: { bank: '기업', kind: '입금', amount: 120000, balance: 1350000, name: '(주)콤콤' } },
  { bank: '우리', body: '우리 09/28 14:32\n*123456\n입금 50,000원\n홍길동\n잔액 1,230,000원',
    want: { bank: '우리', kind: '입금', amount: 50000, balance: 1230000, name: '홍길동' } },
  { bank: '하나', body: '하나,09/28,14:32\n123-******-12345\n입금50,000원\n홍길동\n잔액1,230,000원',
    want: { bank: '하나', kind: '입금', amount: 50000, balance: 1230000, name: '홍길동' } },
  { bank: '신한 출금', body: '[Web발신]\n신한09/28 15:10\n110-***-123456\n출금     3,000\n잔액  1,227,000\n 수수료',
    want: { bank: '신한', kind: '출금', amount: 3000, balance: 1227000 } },
  // ★ 실문자 — IBK기업은행 1566-2566, 2026-09-28 23:35 (이름·계좌 숫자는 바꿔 넣음, 줄 모양은 그대로)
  { bank: '실문자 IBK기업', body: '[Web발신]\n2026/09/28\n23:35\n입금 1원\n잔액 28,967,453원\n홍길동\n458***12345678\n기업',
    want: { bank: '기업', kind: '입금', amount: 1, balance: 28967453, name: '홍길동',
            account: '458***12345678', txAt: '2026-09-28 23:35' } },
  { bank: '실문자 IBK기업 (회사명 입금)', body: '[Web발신]\n2026/09/28\n14:02\n입금 500,000원\n잔액 29,467,453원\n(주)태양포장\n458***12345678\n기업',
    want: { bank: '기업', kind: '입금', amount: 500000, balance: 29467453, name: '(주)태양포장' } },
  { bank: '잔액 없음', body: '[Web발신] 신한 09/28 16:00 입금 70,000 김철수',
    want: { kind: '입금', amount: 70000, balance: null, name: '김철수' } },
];

console.log('\n[은행별 해석]');
for (const f of FIXTURE) {
  const r = ctx.dpParseSms(f.body, RCV);
  ok(f.bank + ' — 해석 성공', r.ok, r.reason);
  for (const k of Object.keys(f.want)) {
    ok(f.bank + ' — ' + k, r[k] === f.want[k], JSON.stringify(r[k]) + ' ≠ ' + JSON.stringify(f.want[k]));
  }
}

console.log('\n[모르면 모른다고 한다]');
{
  const r = ctx.dpParseSms('[Web발신] 신한은행 보안카드 인증번호 [482910]', RCV);
  ok('입출금 문자가 아니면 ok:false', !r.ok);
  const r2 = ctx.dpParseSms('', RCV);
  ok('빈 문자 ok:false', !r2.ok);
}

console.log('\n[연도 넘김]');
{
  const r = ctx.dpParseSms('신한12/31 23:59 110-***-1 입금 10,000 잔액 20,000 홍길동', new Date(2027, 0, 1, 0, 1));
  ok('1월 1일에 받은 12/31 문자는 작년', r.txAt === '2026-12-31 23:59', r.txAt);
}

console.log('\n[고유번호]');
{
  const a = ctx.dpParseSms(FIXTURE[0].body, RCV);
  const b = ctx.dpParseSms(FIXTURE[0].body, new Date(2026, 8, 28, 14, 40)); // 늦게 재전송
  ok('같은 문자는 받은 시각이 달라도 같은 번호', ctx.dpMakeKey(a) === ctx.dpMakeKey(b));
  const c = ctx.dpParseSms(FIXTURE[0].body.replace('1,230,000', '1,280,000'), RCV);
  ok('같은 분·사람·금액이라도 잔액이 다르면 다른 번호', ctx.dpMakeKey(a) !== ctx.dpMakeKey(c));
}

console.log('\n[잔액 연속성]');
{
  const dep = ctx.dpParseSms(FIXTURE[0].body, RCV);          // 입금 50,000 → 1,230,000
  ok('직전 1,180,000 이면 정상', ctx.dpCheckBalance(1180000, dep).status === '정상');
  const gap = ctx.dpCheckBalance(1100000, dep);
  ok('직전 1,100,000 이면 불연속', gap.status === '불연속');
  ok('예상 잔액을 알려 준다', gap.expected === 1150000, gap.expected);
  const wd = ctx.dpParseSms(FIXTURE[6].body, RCV);           // 출금 3,000 → 1,227,000
  ok('출금도 계산한다', ctx.dpCheckBalance(1230000, wd).status === '정상');
  ok('직전 잔액이 없으면 확인불가', ctx.dpCheckBalance(null, dep).status === '확인불가');
  ok('계좌 구분은 은행+끝4자리', ctx.dpAccountKey(dep) === '신한:3456', ctx.dpAccountKey(dep));
}

console.log('\n[V2 와 한 파일]');
{
  const core = require(path.join(__dirname, 'dpParse.gs'));
  ok('Node require 로 읽힌다', typeof core.dpParseSms === 'function');
  ok('같은 문자 → 같은 결과',
    JSON.stringify(core.dpParseSms(FIXTURE[0].body, RCV)) === JSON.stringify(ctx.dpParseSms(FIXTURE[0].body, RCV)));
  ok('규칙 버전을 내보낸다', core.DP_CORE_VERSION === '1.0.0');
}

console.log('\n' + pass + ' 통과 · ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
