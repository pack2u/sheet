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

/*  ═══════════════════════════════════════════════════════════
    ★ 쪼갠 줄은 로젠·업체에 «꼬리표 번호»로 나간다 ★  (2026-09-29)
    > "몸통은 2314556-1 뚜껑은 2314556-2 이런식으로 분리되면 …
    >  송장번호도 몸통 뚜껑 확실하게 구분될수 있고"
    ═══════════════════════════════════════════════════════════ */
console.log('\n[꼬리표] 몸통 _S1 · 뚜껑 _S2');
const P = C.SS_OUT_HEADER.indexOf('사방넷주문번호');
const 켬 = Object.assign({}, cfg, { 세트_송장꼬리표: '켬' });
function 꼬리돌리기(code, over) {
  const w = [];
  const L = Object.assign({ 순번: '100001', 원본코드: code, 원본품목명: items[code].name, 주문수량: 1,
    고유ID: '2314556', 사방넷주문번호: '2314556', 주소1: '서울시 강남구 테헤란로 1',
    받는분: '홍길동', 보내는분: '팩투유', 합계: 50000 }, over || {});
  const units = C.ssExplode([L], { bom, splitExcept: {}, partnerItems: {} }, w);
  C.ssEnrich(units, { items }, w);
  for (const u of units) { u.부족수량 = 0; u.총필요수량 = 1; u.현재고 = 9; }
  C.ssRoute(units, { vendors, override: {}, partnerItems: {} }, cfg, w);
  C.ssMerge(units, cfg);
  for (const u of units) u.송장키 = C.ssShipKey(u, 켬);
  const by = {}; for (const u of units) by[u.품목코드] = u;
  return { by, units };
}
{
  const { by, units } = 꼬리돌리기('BWSC195B0001');
  eq('몸통 송장키 _S1', by.BWSC195B0005.송장키, '2314556_S1');
  eq('뚜껑 송장키 _S2', by.BWSC1950009.송장키, '2314556_S2');
  eq('★ 로젠 출력 P칸에 꼬리표', C.ssOutRow(by.BWSC195B0005)[P], '2314556_S1');
  eq('★ 대리발송 탭 P칸에 꼬리표 (업체가 이 번호로 송장을 준다)', C.ssPartnerRow(by.BWSC1950009)[P], '2314556_S2');
  eq('  고유ID 는 그대로', by.BWSC1950009.고유ID, '2314556');
  const led = C.ssLedgerRow(by.BWSC1950009, 'R', 'T');
  eq('원장 고유ID 칸은 맨 번호', led[C.SS_LEDGER_HEADER.indexOf('고유ID')], '2314556');
  eq('원장 송장키 칸', led[C.SS_LEDGER_HEADER.indexOf('송장키')], '2314556_S2');
  eq('  원장 줄 길이 = 머리글 길이', led.length, C.SS_LEDGER_HEADER.length);
  const inv = C.ssInvoiceRows(units);
  eq('사방넷송장 A칸은 맨 번호', inv[0][0], '2314556');
  eq('사방넷송장 송장키 칸', inv[1][C.SS_INVOICE_HEADER.indexOf('송장키')], '2314556_S2');
  eq('  줄 길이 = 머리글 길이', inv[0].length, C.SS_INVOICE_HEADER.length);
  eq('  사방넷 등록은 한 번만', inv.filter(r => r[10] === 'Y').length, 1);
}
{
  const { by } = 꼬리돌리기('AJSET0001');
  eq('둘 다 평택이어도 꼬리표 (송장이 두 장 온다)', by.AJLID0001.송장키, '2314556_S2');
}
{
  //  낱개 주문은 그대로
  const w = [];
  const units = C.ssExplode([{ 순번: '1', 원본코드: 'AJBODY001', 원본품목명: 'AJ 몸통', 주문수량: 1,
    고유ID: '777', 사방넷주문번호: '777' }], { bom, splitExcept: {}, partnerItems: {} }, w);
  eq('낱개는 꼬리표 없음', C.ssShipKey(units[0], 켬), '777');
}
{
  //  보류 줄은 맨 번호 — 보류 탭 P칸은 조치를 걷는 열쇠다
  const { by } = 꼬리돌리기('AJSET0001');
  const u = by.AJLID0001; u.route = C.SS_ROUTE.HOLD; u.보류사유 = '재고부족';
  eq('보류 줄은 꼬리표 없음', C.ssShipKey(u, 켬), '2314556');
  u.route = C.SS_ROUTE.PARTNER; u.보류사유 = '';
  eq('★ 설정이 「끔」(기본)이면 꼬리표 없음', C.ssShipKey(u, cfg), '2314556');
}
{
  //  전화주문 겹침 꼬리(-2)와 안 부딪힌다
  eq('맨 번호 되찾기 _S2', C.ssBaseUid('2314556_S2'), '2314556');
  eq('  전화주문 -2 는 그대로 (다른 주문이다)', C.ssBaseUid('p0929000086-2'), 'p0929000086-2');
  eq('  꼬리표 붙은 번호는 사방넷 번호가 아니다 (떼고 봐야 한다)', C.ssIsSabangnetUid('2314556_S2'), false);
  eq('  떼면 사방넷 번호', C.ssIsSabangnetUid(C.ssBaseUid('2314556_S2')), true);
}

console.log('');
console.log(fail ? 'FAIL ' + fail + '건' : '통과 ' + pass + '건');
process.exit(fail ? 1 : 0);
