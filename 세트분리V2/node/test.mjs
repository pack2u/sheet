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


console.log('\n[중복발주 의심] 상품정보 시트와 같은 등급 규칙');
{
  const R = (회차, 고유ID, 원본코드, 받는분, 전화, 주소) =>
    ({ 회차, 고유ID, 원본코드, 받는분, 전화, 주소, 품목명: '품', 수량: 1, 금액: 1000, 경로: '롯데택배' });

  // 세트분리로 갈린 2행은 한 건이다
  const f1 = C.ssFindDuplicates([
    R('260902-1', 'A1', 'SET', '고동', '010-1111-2222', '서울 1'),
    R('260902-1', 'A1', 'SET', '고동', '010-1111-2222', '서울 1')
  ]);
  eq('세트분리 2행 → 1건으로 접힘', f1.records.length, 1);
  eq('그래서 중복 아님', f1.groups.length, 0);

  // 같은 고유ID가 다른 회차에 → 확실
  const f2 = C.ssFindDuplicates([
    R('260902-1', 'A1', 'X', '고동', '010-1111-2222', '서울 1'),
    R('260902-2', 'A1', 'X', '고동', '010-1111-2222', '서울 1')
  ]);
  eq('회차간 동일 고유ID → 확실', f2.groups[0].grade, '🔴 확실');
  eq('회차간 표시', f2.groups[0].회차간, true);

  // 수취인+전화+품목 일치 (고유ID는 다름)
  const f3 = C.ssFindDuplicates([
    R('260902-1', 'A1', 'X', '김철수', '010-3333-4444', '부산 2'),
    R('260902-2', 'B2', 'X', '김철수', '010-3333-4444', '부산 2')
  ]);
  eq('수취인+전화+품목 → 확실', f3.groups[0].reason, '수취인+전화+품목코드 일치');

  // 전화가 없으면 한 단계 낮은 등급
  const f4 = C.ssFindDuplicates([
    R('260902-1', 'A1', 'X', '김철수', '', '부산 2'),
    R('260902-2', 'B2', 'X', '김철수', '', '부산 2')
  ]);
  eq('전화 없음 → 의심 등급', f4.groups[0].grade, '🟡 의심');

  // 창고 대량 배송은 참고 등급에서도 버려진다 (6건 > maxMembers 5)
  const bulk = [];
  for (let i = 0; i < 6; i++) bulk.push(R('260902-1', 'ID' + i, 'X', '수취인' + i, '010-0000-000' + i, '경기 창고 1'));
  eq('같은 주소 대량은 버림', C.ssFindDuplicates(bulk).groups.length, 0);
}

console.log('\n' + (fail ? `실패 ${fail}건 / ` : '') + `통과 ${pass}건`);
process.exit(fail ? 1 : 0);
