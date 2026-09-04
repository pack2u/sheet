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
  eq('수취인+전화+주소+품목 → 확실', f3.groups[0].reason, '수취인+전화+주소+품목 일치');

  // 주소가 다르면 정상 주문으로 본다 (동명이인 · 여러 지점 배송)
  const f5 = C.ssFindDuplicates([
    R('260902-2', 'A1', 'X', '김미숙', '0504-2758-4217', '경기 고양시 일산서구 빕고길 568-61'),
    R('260902-2', 'B2', 'X', '김미숙', '0504-3507-1463', '경남 양산시 대운9길 16-257')
  ]);
  eq('주소 다르면 참고 등급', f5.groups[0].grade, '⚪ 참고');

  // 비배송(적립금·반품배송비)은 아예 보지 않는다
  const f6 = C.ssFindDuplicates([
    { ...R('260902-2', 'C1', 'FEE', '법인/쿠팡', '', ''), 경로: '비배송' },
    { ...R('260902-2', 'C2', 'FEE', '법인/쿠팡', '', ''), 경로: '비배송' }
  ]);
  eq('비배송은 중복 대상 아님', f6.groups.length, 0);

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


console.log('\n[수동조치] 보류를 사람이 되살린다');
{
  const grid = [
    ['순번','일자-No.','품목코드','품목명','수량','전화','모바일','주소1','합계','거래처명','세트구성및배송비','단품배송비','묶음배송비','적요','주문자명(사방넷)','전화번호(사방넷)','추가장문형식1','주문자명(주문서)','전화번호(주문서)','배송지(주문서)/배송메시지(주문서)'],
    [1,'2026/09/02 -1','SOLD','JH 품절품목',1,'010-1111-2222','010-1111-2222','서울 강남구 1',10000,'행주국수','','2500','','','','','','','',''],
  ];
  const base = {
    items: { SOLD: { name: 'JH 품절품목', status: '품절', origin: '평택A-1', unitFee: 2500, feeRuleRaw: '' } },
    stock: { SOLD: 0 }, bom: {}, splitExcept: {}, cond: {}, condCodes: {}, feeRules: {},
    islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {},
    vendors: { JH: '준테크', HP: '하나팩' }, override: {}
  };
  const idOf = (r) => r.units[0].고유ID;

  const r0 = C.ssRun(grid, base, C.SS_DEFAULT_CONFIG);
  eq('품절이면 보류', r0.buckets[C.SS_ROUTE.HOLD].length, 1);
  eq('보류사유', r0.buckets[C.SS_ROUTE.HOLD][0].보류사유, '상태보류');
  eq('업체코드는 품목명 앞 토큰', r0.buckets[C.SS_ROUTE.HOLD][0].업체코드, 'JH');

  const key = idOf(r0) + '|SOLD';

  const m1 = { ...base, override: { [key]: { 조치: '발송', 업체코드: '' } } };
  const r1 = C.ssRun(grid, m1, C.SS_DEFAULT_CONFIG);
  eq('발송 지정 → 보류 해제', r1.buckets[C.SS_ROUTE.HOLD].length, 0);
  eq('발송 지정 → 롯데택배', r1.buckets[C.SS_ROUTE.LOTTE].length, 1);

  const m2 = { ...base, override: { [key]: { 조치: '대리발송', 업체코드: 'HP' } } };
  const r2 = C.ssRun(grid, m2, C.SS_DEFAULT_CONFIG);
  eq('대리발송 지정 → 대리발송 탭', r2.buckets[C.SS_ROUTE.PARTNER].length, 1);
  eq('지정한 업체코드가 우선', r2.buckets[C.SS_ROUTE.PARTNER][0].업체코드, 'HP');
  eq('업체명 채워짐', r2.buckets[C.SS_ROUTE.PARTNER][0].업체명, '하나팩');
  eq('대리발송 행 폭', C.ssPartnerRow(r2.buckets[C.SS_ROUTE.PARTNER][0]).length, C.SS_PARTNER_HEADER.length);

  // 품목명에서 업체를 알 수 없고 지정도 없으면 경고해야 한다
  const grid2 = grid.map((r) => r.slice());
  grid2[1][3] = '무명 품절품목';
  const m3 = {
    ...base,
    items: { SOLD: { name: '무명 품절품목', status: '품절', origin: '평택A-1', unitFee: 2500, feeRuleRaw: '' } },
    override: {}
  };
  const r3a = C.ssRun(grid2, m3, C.SS_DEFAULT_CONFIG);
  const key2 = r3a.units[0].고유ID + '|SOLD';
  const r3 = C.ssRun(grid2, { ...m3, override: { [key2]: { 조치: '대리발송', 업체코드: '' } } }, C.SS_DEFAULT_CONFIG);
  eq('업체를 알 수 없으면 오류', r3.warnings.some((w) => w.code === 'MANUAL_NO_VENDOR'), true);
  eq('대리발송으로 안 넘어가고 보류 유지', r3.buckets[C.SS_ROUTE.PARTNER].length, 0);
  eq('보류사유는 업체코드확인', r3.buckets[C.SS_ROUTE.HOLD][0].보류사유, '업체코드확인');

  // 표에 없는 코드도 막는다
  const r4 = C.ssRun(grid, { ...base, override: { [key]: { 조치: '대리발송', 업체코드: 'ZZ' } } }, C.SS_DEFAULT_CONFIG);
  eq('미등록 코드는 거부', r4.buckets[C.SS_ROUTE.PARTNER].length, 0);
  eq('사유에 코드 표시', r4.buckets[C.SS_ROUTE.HOLD][0].보류상세.indexOf('ZZ') >= 0, true);
}


console.log('\n[입력 간소화] 업체코드만 적어도 대리발송');
{
  const grid = [
    ['순번','일자-No.','품목코드','품목명','수량','전화','모바일','주소1','합계','거래처명','세트구성및배송비','단품배송비','묶음배송비','적요','주문자명(사방넷)','전화번호(사방넷)','추가장문형식1','주문자명(주문서)','전화번호(주문서)','배송지(주문서)/배송메시지(주문서)'],
    [1,'2026/09/02 -1','SOLD','무명 품절품목',1,'010-1111-2222','010-1111-2222','서울 강남구 1',10000,'행주국수','','2500','','','','','','','','']
  ];
  const base = {
    items: { SOLD: { name: '무명 품절품목', status: '품절', origin: '평택A-1', unitFee: 2500, feeRuleRaw: '' } },
    stock: { SOLD: 0 }, bom: {}, splitExcept: {}, cond: {}, condCodes: {}, feeRules: {},
    islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {},
    vendors: { HP: '하나팩' }, override: {}
  };
  const k = C.ssRun(grid, base, C.SS_DEFAULT_CONFIG).units[0].고유ID + '|SOLD';
  const r = C.ssRun(grid, { ...base, override: { [k]: { 조치: '', 업체코드: 'HP' } } }, C.SS_DEFAULT_CONFIG);
  eq('조치 비우고 업체코드만 → 대리발송', r.buckets[C.SS_ROUTE.PARTNER].length, 1);
  eq('대리발송 T열이 업체코드', C.SS_PARTNER_HEADER[19], '업체코드');
  eq('앞 19열은 표준 그대로', C.SS_PARTNER_HEADER.slice(0, 19).join(), C.SS_OUT_HEADER.join());
}


console.log('\n[적요 배송지 변경] 전화주문 주소 갈아끼우기');
{
  const H = ['순번','일자-No.','품목코드','품목명','수량','전화','모바일','주소1','합계','거래처명','세트구성및배송비','단품배송비','묶음배송비','적요','주문자명(사방넷)','전화번호(사방넷)','추가장문형식1','주문자명(주문서)','전화번호(주문서)','배송지(주문서)/배송메시지(주문서)'];
  const row = (적요) => [1,'2026/09/02 -29','AJJUG0002','AJ 죽용기 대 500세트',1,'010-8711-4550','010-8711-4550','세종특별자치시 원주소',91400,'보든에프엔비','', '2500','',적요,'','','','','',''];
  const masters = {
    items: { AJJUG0002: { name: 'AJ 죽용기 대 500세트', status: '판매중', origin: '평택A-1', unitFee: 2500, feeRuleRaw: '' } },
    stock: { AJJUG0002: 99 }, bom: {}, splitExcept: {}, cond: {}, condCodes: {}, feeRules: {},
    islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {}, vendors: {}, override: {}
  };
  const 새주소 = '세종특별자치시 도움8로 11-11, 1층 120호(어진동,어진프라자)';

  const r1 = C.ssRun([H, row('010-8711-4550/' + 새주소)], masters, C.SS_DEFAULT_CONFIG);
  const u1 = r1.buckets[C.SS_ROUTE.LOTTE][0];
  eq('주소가 적요 값으로 바뀜', u1.주소1, 새주소);
  eq('원주소 보존', u1.원주소1, '세종특별자치시 원주소');
  eq('주소변경 표시', u1.주소변경, '적요(연락처·주소)');

  // 이름/전화/주소 3단 형식
  const r2 = C.ssRun([H, row('변영걸/010-9999-8888/' + 새주소)], masters, C.SS_DEFAULT_CONFIG);
  const u2 = r2.buckets[C.SS_ROUTE.LOTTE][0];
  eq('이름도 바뀜', u2.받는분, '변영걸');
  eq('원받는분 보존', u2.원받는분, '보든에프엔비');
  eq('연락처도 바뀜', u2.모바일, '010-9999-8888');
  eq('변경 종류 표시', u2.주소변경, '적요(이름·연락처·주소)');
  eq('이름이 바뀌어도 고유ID 그대로', u2.고유ID, u1.고유ID);
  eq('경고 남김', r1.warnings.some((w) => w.code === 'ADDR_OVERRIDE'), true);

  const r0 = C.ssRun([H, row('09/02 출고요청')], masters, C.SS_DEFAULT_CONFIG);
  const u0 = r0.buckets[C.SS_ROUTE.LOTTE][0];
  eq('일반 적요는 손대지 않음', u0.주소1, '세종특별자치시 원주소');
  eq('그때는 경고 없음', r0.warnings.some((w) => w.code === 'ADDR_OVERRIDE'), false);

  eq('배송지가 바뀌어도 고유ID는 그대로', u1.고유ID, u0.고유ID);

  // 사방넷 주문은 쇼핑몰 배송지가 정답이므로 적요로 덮어쓰지 않는다
  const sabang = row('010-9999-8888/' + 새주소);
  sabang[14] = '홍길동/2159999999';        // 주문자명(사방넷)
  sabang[15] = '010-7777-6666';           // 전화번호(사방넷)
  sabang[16] = '서울 송파구 올림픽로 300'; // 추가장문형식1 = 배송지
  const rs = C.ssRun([H, sabang], masters, C.SS_DEFAULT_CONFIG);
  const us = rs.buckets[C.SS_ROUTE.LOTTE][0];
  eq('사방넷 주문은 적요로 안 바뀜', us.주소1, '서울 송파구 올림픽로 300');
  eq('사방넷 주문엔 변경 표시 없음', us.주소변경 || '', '');
  eq('사방넷 주문엔 경고 없음', rs.warnings.some((w) => w.code === 'ADDR_OVERRIDE'), false);
}


console.log('\n[비배송] 적립금·배송비는 송장 없이 매출로만');
{
  const H = ['순번','일자-No.','품목코드','품목명','수량','전화','모바일','주소1','합계','거래처명','세트구성및배송비','단품배송비','묶음배송비','적요','주문자명(사방넷)','전화번호(사방넷)','추가장문형식1','주문자명(주문서)','전화번호(주문서)','배송지(주문서)/배송메시지(주문서)'];
  const row = (n, code, name, amt) => [n,'2026/09/02 -1',code,name,1,'010-1111-2222','010-1111-2222','서울 강남구 1',amt,'행주국수','','2500','','','','','','','',''];
  const masters = {
    items: { OK1: { name: '정상품목', status: '판매중', origin: '평택A-1', unitFee: 2500, feeRuleRaw: '' },
             LGTB00017: { name: '반품배송비', status: '판매중', origin: '평택A-1', unitFee: 0, feeRuleRaw: '' } },
    stock: { OK1: 99, LGTB00017: 99 }, bom: {}, splitExcept: {}, cond: {}, condCodes: {}, feeRules: {},
    islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {}, vendors: {}, override: {}
  };
  const r = C.ssRun([
    H,
    row(1, 'OK1', '정상품목', 50000),
    row(2, '77', '적립금', -206270),
    row(3, 'LGTB00017', '반품배송비---법인/쿠팡', 3500)
  ], masters, C.SS_DEFAULT_CONFIG);

  eq('정상품목만 롯데택배', r.buckets[C.SS_ROUTE.LOTTE].length, 1);
  eq('적립금·반품배송비는 비배송', r.buckets[C.SS_ROUTE.NONSHIP].length, 2);
  eq('보류에는 안 들어감', r.buckets[C.SS_ROUTE.HOLD].length, 0);
  eq('사유가 붙는다', r.buckets[C.SS_ROUTE.NONSHIP][0].비배송사유.indexOf('음수') >= 0, true);

  // 매출 집계에 그대로 남아야 한다
  const 합계 = r.units.reduce((s, u) => s + u.합계, 0);
  eq('원장 매출 합계 보존', 합계, 50000 - 206270 + 3500);
  eq('분해행 = 탭 합계', r.stats.분해행, r.stats.출력행);
  eq('비배송 행 폭', C.ssNonshipRow(r.buckets[C.SS_ROUTE.NONSHIP][0]).length, C.SS_NONSHIP_HEADER.length);
}


console.log('\n[합배송] 롯데엔 대표만 · 사방넷엔 전부');
{
  const H = ['순번','일자-No.','품목코드','품목명','수량','전화','모바일','주소1','합계','거래처명','세트구성및배송비','단품배송비','묶음배송비','적요','주문자명(사방넷)','전화번호(사방넷)','추가장문형식1','주문자명(주문서)','전화번호(주문서)','배송지(주문서)/배송메시지(주문서)'];
  const r = (n, code) => [n,'2026/09/02 -1',code,'샘플'+code,1,'','010-1','서울 강남구 1',10,'법인/배민상회','','2200','','','홍길동/215971115'+n,'010-1','서울 강남구 1','','',''];
  const M = { items:{}, stock:{}, bom:{}, splitExcept:{},
    cond:{S1:['평택샘플'],S2:['평택샘플'],S3:['평택샘플']},
    condCodes:{평택샘플:{S1:1,S2:1,S3:1}}, feeRules:{},
    islandKeywords:[], islandZips:{}, addrZip:{}, localAddrs:{}, vendors:{}, override:{} };
  for (const k of ['S1','S2','S3']) {
    M.items[k] = { name:'샘플'+k, status:'판매중', origin:'평택S-1', unitFee:2200, feeRuleRaw:'' };
    M.stock[k] = 99;
  }
  const res = C.ssRun([H, r(1,'S1'), r(2,'S2'), r(3,'S3')], M, C.SS_DEFAULT_CONFIG);
  const lotte = res.buckets[C.SS_ROUTE.LOTTE];

  eq('롯데엔 대표 1건만', lotte.length, 1);
  eq('대표 품목명에 ===합배송', /===합배송/.test(lotte[0].출력품목명), true);
  eq('대표만 배송비 청구', lotte[0].배송비, 2200);
  eq('합배송 확인뷰는 3행', res.합배송뷰.length, 3);

  const invRows = C.ssInvoiceRows(res.units);
  eq('사방넷송장엔 3건 모두', invRows.length, 3);
  eq('대표 1 · 동봉 2', invRows.filter((x) => x[2] === '동봉').length, 2);
  const rep = invRows.find((x) => x[2] === '대표')[0];
  eq('동봉은 대표주문번호를 가리킨다', invRows.filter((x) => x[2] === '동봉').every((x) => x[4] === rep), true);
  eq('주문번호는 각자 유지', new Set(invRows.map((x) => x[0])).size, 3);
}


console.log('\n[합포장] 기본은 제한 없음 (구 시트와 동일) · 설정하면 박스 분할');
{
  const H = ['순번','일자-No.','품목코드','품목명','수량','전화','모바일','주소1','합계','거래처명','세트구성및배송비','단품배송비','묶음배송비','적요','주문자명(사방넷)','전화번호(사방넷)','추가장문형식1','주문자명(주문서)','전화번호(주문서)','배송지(주문서)/배송메시지(주문서)'];
  const run = (n, cap) => {
    const rows = [H];
    const M = { items:{}, stock:{}, bom:{}, splitExcept:{}, cond:{}, condCodes:{평택샘플:{}},
      feeRules:{}, islandKeywords:[], islandZips:{}, addrZip:{}, localAddrs:{}, vendors:{}, override:{} };
    for (let i = 1; i <= n; i++) {
      const k = 'S' + i;
      rows.push([i,'2026/09/02 -11',k,'[샘플] 감자탕 '+i,1,'','010-1','대전 서구 갈마역로 3',10,'법인/배민상회','','2200','','','조은주/1082494'+String(i).padStart(3,'0'),'010-1','대전 서구 갈마역로 3','','','']);
      M.items[k] = { name:'[샘플] 감자탕 '+i, status:'판매중', origin:'평택S-1', unitFee:2200, feeRuleRaw:'' };
      M.stock[k] = 99; M.cond[k] = ['평택샘플']; M.condCodes.평택샘플[k] = 1;
    }
    const cfg = cap === undefined ? C.SS_DEFAULT_CONFIG
      : Object.assign({}, C.SS_DEFAULT_CONFIG, { 합포장_최대건수: String(cap) });
    return C.ssRun(rows, M, cfg);
  };
  const boxes = (r) => r.buckets[C.SS_ROUTE.LOTTE].length;

  eq('기본값은 제한 없음', C.SS_DEFAULT_CONFIG.합포장_최대건수, '0');
  eq('14건도 한 박스', boxes(run(14)), 1);
  eq('25건도 한 박스', boxes(run(25)), 1);
  eq('설정 10 → 14건은 2박스', boxes(run(14, 10)), 2);
  eq('설정 10 → 11건은 10+단독', boxes(run(11, 10)), 2);
  eq('설정 10 → 박스 표기', run(14, 10).units.find((u) => u.합포장대표).출력품목명.indexOf('(1/2)') >= 0, true);
  eq('제한 없으면 박스 표기 안 붙음', run(14).units.find((u) => u.합포장대표).출력품목명.indexOf('(1/') , -1);
}


console.log('\n[사방넷등록 표시] 주문번호당 한 줄 · 전화주문 제외');
{
  const H = ['순번','일자-No.','품목코드','품목명','수량','전화','모바일','주소1','합계','거래처명','세트구성및배송비','단품배송비','묶음배송비','적요','주문자명(사방넷)','전화번호(사방넷)','추가장문형식1','주문자명(주문서)','전화번호(주문서)','배송지(주문서)/배송메시지(주문서)'];
  // 사방넷 주문(같은 주문번호에 품목 2개) + 전화주문 1건
  const rows = [H,
    [1,'2026/09/02 -1','A1','품목A',1,'','010-1','서울 강남구 1',1000,'거래처','','2500','','','홍길동/2159999999','010-1','서울 강남구 1','','',''],
    [2,'2026/09/02 -1','B1','품목B',1,'','010-1','서울 강남구 1',2000,'거래처','','2500','','','홍길동/2159999999','010-1','서울 강남구 1','','',''],
    [3,'2026/09/02 -2','C1','품목C',1,'010-2','010-2','부산 해운대 2',3000,'행주국수','','2500','','','','','','','','']
  ];
  const M = { items:{A1:{name:'품목A',status:'판매중',origin:'평택A-1',unitFee:2500,feeRuleRaw:''},
    B1:{name:'품목B',status:'판매중',origin:'평택A-1',unitFee:2500,feeRuleRaw:''},
    C1:{name:'품목C',status:'판매중',origin:'평택A-1',unitFee:2500,feeRuleRaw:''}},
    stock:{A1:9,B1:9,C1:9}, bom:{}, splitExcept:{}, cond:{}, condCodes:{}, feeRules:{},
    islandKeywords:[], islandZips:{}, addrZip:{}, localAddrs:{}, vendors:{}, override:{} };
  const res = C.ssRun(rows, M, C.SS_DEFAULT_CONFIG);
  const inv = C.ssInvoiceRows(res.units);
  const iSrc = C.SS_INVOICE_HEADER.indexOf('주문출처');
  const iReg = C.SS_INVOICE_HEADER.indexOf('사방넷등록');

  eq('행 폭 = 헤더 폭', inv[0].length, C.SS_INVOICE_HEADER.length);
  eq('사방넷 첫 품목만 등록 Y', inv.filter((r) => r[iReg] === 'Y').length, 1);
  eq('같은 주문번호 둘째 품목은 빈칸', inv.filter((r) => r[0] === '2159999999' && r[iReg] === '').length, 1);
  eq('전화주문은 등록 대상 아님', inv.filter((r) => r[iSrc] === '자동발급').every((r) => r[iReg] === ''), true);
  eq('원장 행 폭 (운송장번호·송장매칭 포함)', C.ssLedgerRow(res.units[0], 'k', 'at').length, C.SS_LEDGER_HEADER.length);
}


console.log('\n[사방넷 번호 판별] 시스템 발급 ID는 등록 제외');
{
  eq('사방넷 숫자 번호', C.ssIsSabangnetUid('2159711511'), true);
  eq('상품정보 발급 -ds-', C.ssIsSabangnetUid('0902-ds-e158'), false);
  eq('세트분리 전화주문 -PH-', C.ssIsSabangnetUid('260903-PH-4bdf'), false);
  eq('빈 값', C.ssIsSabangnetUid(''), false);
  eq('문자 섞임', C.ssIsSabangnetUid('ABC123'), false);
}

console.log('\n' + (fail ? `실패 ${fail}건 / ` : '') + `통과 ${pass}건`);
process.exit(fail ? 1 : 0);
