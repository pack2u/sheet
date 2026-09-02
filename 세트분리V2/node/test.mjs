import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + got + '\n       want ' + want); }
};

console.log('\n[ssCompressNames] 구 시트 실제 출력과 대조');
eq('감자탕 왕대/특대',
  C.ssCompressNames(['JH 감자탕 왕대', 'JH 감자탕 특대']),
  'JH 감자탕 왕대/특대');
eq('225파이 대/중/소 블랙',
  C.ssCompressNames(['BF 225파이 감자탕 대 블랙', 'BF 225파이 감자탕 중 블랙', 'BF 225파이 감자탕 소 블랙']),
  'BF 225파이 감자탕 대/중/소 블랙');
eq('블랙 유무는 따로 묶임',
  C.ssCompressNames(['BF 225파이 감자탕 대 블랙', 'BF 225파이 감자탕 중 블랙', 'BF 225파이 감자탕 대', 'BF 225파이 감자탕 중']),
  'BF 225파이 감자탕 대/중 블랙, BF 225파이 감자탕 대/중');
eq('앞뒤 공통 + 가운데 2토큰',
  C.ssCompressNames(['GS 좋은봉투 대 유백 (100*1팩) 100매--/소분', 'GS 좋은봉투 중 투명 (100*1팩) 100매--/소분']),
  'GS 좋은봉투 대 유백/중 투명 (100*1팩) 100매--/소분');
eq('브랜드가 다르면 안 묶임',
  C.ssCompressNames(['JH 9193 돈까스도시락', 'BF 8909 돈까스도시락', '6칸도시락', '5칸도시락']),
  'JH 9193 돈까스도시락, BF 8909 돈까스도시락, 6칸도시락, 5칸도시락');

console.log('\n[ssParseFeeRule] 레거시 문자열 이관');
{
  const r = C.ssParseFeeRule('X', '2개-2200/3개-2200/9개-2500/10개-2500');
  eq('행 수', r.rows.length, 4);
  eq('9개 → 2500', r.rows[2].fee, 2500);
  const r2 = C.ssParseFeeRule('Y', '2개(완박스)-3600/3개-3000');
  eq('완박스 인식', r2.rows[0].fullBox, true);
  const r3 = C.ssParseFeeRule('Z', '두개에 삼천원');
  eq('파싱 실패 수집', r3.bad.length, 1);
}

console.log('\n[ssPad6 / ssNormAddr]');
eq('순번 포맷 TEXT(n,"100000")', C.ssPad6(35), '100035');

console.log('\n[고유ID] 결정적이어야 한다');
const _L = { 일자: '2026/09/02 -8', 받는분: '김대선', 모바일: '010-5415-4432', 주소1: '서울 강동구 양재대로89가길 34', 원본코드: 'BFTANG00001', 주문수량: 2 };
eq('형식 YYMMDD-PH-xxxxx', /^260902-PH-[0-9a-f]{5}$/.test(C.ssMakeOrderId(_L)), true);
eq('재계산해도 동일', C.ssMakeOrderId(_L), C.ssMakeOrderId(_L));
eq('전표 다르면 다른 ID', C.ssMakeOrderId(Object.assign({}, _L, { 일자: '2026/09/02 -12' })) !== C.ssMakeOrderId(_L), true);
eq('상품정보 -ds- 와 형식 구분', /-ds-/.test(C.ssMakeOrderId(_L)), false);
eq('주소 정규화', C.ssNormAddr('서울  강남구  1\n.(참고)'), '서울 강남구 1');

console.log('\n' + (fail ? `실패 ${fail}건 / ` : '') + `통과 ${pass}건`);
process.exit(fail ? 1 : 0);
