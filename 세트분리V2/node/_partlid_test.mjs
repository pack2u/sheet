/**
 * 구성품 출고지가 「대리발송」이면 그 구성품만 대리발송으로 가는가 (2026-09-29)
 *   node _partlid_test.mjs
 *
 * > "세트중에 뚜껑만 출고지를 대리발송으로 빼놓으면 뚜껑만 대리공급으로
 * >  빠지는거지? 몸통은 평택으로 되있으면.."
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + got + '\n       want ' + want); }
};

const cfg = Object.assign({}, C.SS_DEFAULT_CONFIG);
const vendors = { BW: '부원', JH: '준테크' };

//  실제 마스터의 모양 그대로 (BW 사출 195파이 소 검정 300세트)
const items = {
  BWSC195B0001: { name: 'BW 사출 195파이 소 검정 300세트', status: '판매중', origin: '평택D-6', unitFee: 3000 },
  BWSC195B0005: { name: 'BW 사출 195파이 소 검정 몸통 300개', status: '판매중', origin: '평택D-6', unitFee: 3000 },
  BWSC1950009:  { name: 'BW 사출 195파이 뚜껑 300개', status: '판매중', origin: '대리발송', unitFee: 3000 },
  //  세트 자체가 대리발송 — 구성품이 평택이어도 세트를 따른다
  JHSET0001: { name: 'JH 세트 100세트', status: '판매중', origin: '대리발송', unitFee: 3000 },
  JHBODY001: { name: 'JH 몸통', status: '판매중', origin: '평택A-1', unitFee: 3000 },
  JHLID0001: { name: 'JH 뚜껑', status: '판매중', origin: '평택A-1', unitFee: 3000 },
  //  구성품이 모두 평택 — 종전 그대로
  AJSET0001: { name: 'AJ 세트', status: '판매중', origin: '평택S-1', unitFee: 3000 },
  AJBODY001: { name: 'AJ 몸통', status: '판매중', origin: '평택C-1', unitFee: 3000 },
  AJLID0001: { name: 'AJ 뚜껑', status: '판매중', origin: '평택C-2', unitFee: 3000 },
};
const bom = {
  BWSC195B0001: [{ code: 'BWSC195B0005', qty: 1 }, { code: 'BWSC1950009', qty: 1 }],
  JHSET0001: [{ code: 'JHBODY001', qty: 1 }, { code: 'JHLID0001', qty: 1 }],
  AJSET0001: [{ code: 'AJBODY001', qty: 1 }, { code: 'AJLID0001', qty: 1 }],
};

function 돌리기(code) {
  const w = [];
  const L = { 순번: '100001', 원본코드: code, 원본품목명: items[code].name, 주문수량: 1,
    고유ID: '2314556', 주소1: '서울시 강남구 테헤란로 1', 받는분: '홍길동', 보내는분: '팩투유', 합계: 50000 };
  const units = C.ssExplode([L], { bom, splitExcept: {}, partnerItems: {} }, w);
  C.ssEnrich(units, { items }, w);
  for (const u of units) { u.부족수량 = 0; u.총필요수량 = 1; u.현재고 = 9; }
  C.ssRoute(units, { vendors, override: {}, partnerItems: {} }, cfg, w);
  C.ssMerge(units, cfg);
  const by = {}; for (const u of units) by[u.품목코드] = u;
  return by;
}

console.log('\n[몸통 평택 · 뚜껑 대리발송] BW 사출 195파이');
{
  const r = 돌리기('BWSC195B0001');
  eq('몸통은 우리가 보낸다', r.BWSC195B0005.route !== C.SS_ROUTE.PARTNER && !r.BWSC195B0005.보류사유, true);
  eq('  몸통 출고지 평택D-6 그대로', r.BWSC195B0005.출고지, '평택D-6');
  eq('★ 뚜껑만 대리발송', r.BWSC1950009.route, C.SS_ROUTE.PARTNER);
  eq('  뚜껑 업체코드 BW', r.BWSC1950009.업체코드, 'BW');
  eq('  세트 출고지를 남겨 둔다', r.BWSC1950009.세트출고지, '평택D-6');
  eq('  뚜껑은 합포장에 안 들어간다', r.BWSC1950009.합포장그룹, '');
}

console.log('\n[세트가 대리발송] 구성품이 평택이어도 세트를 따른다');
{
  const r = 돌리기('JHSET0001');
  eq('몸통 대리발송', r.JHBODY001.route, C.SS_ROUTE.PARTNER);
  eq('뚜껑 대리발송', r.JHLID0001.route, C.SS_ROUTE.PARTNER);
  eq('  구성품 표식 안 붙음', !!r.JHLID0001.구성품대리, false);
}

console.log('\n[둘 다 평택] 종전 그대로');
{
  const r = 돌리기('AJSET0001');
  eq('몸통 우리', r.AJBODY001.route !== C.SS_ROUTE.PARTNER, true);
  eq('뚜껑 우리', r.AJLID0001.route !== C.SS_ROUTE.PARTNER, true);
  eq('  출고지는 세트(평택S-1) 그대로', r.AJLID0001.출고지, '평택S-1');
}

console.log('');
console.log(fail ? 'FAIL ' + fail + '건' : '통과 ' + pass + '건');
process.exit(fail ? 1 : 0);
