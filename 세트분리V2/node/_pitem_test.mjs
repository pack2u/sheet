/**
 * 「대리발송품목」 탭 — 적어 두면 늘 대리발송으로 빠지는가.
 *   node _pitem_test.mjs
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
const vendors = { JH: '정화식품', HP: '한평' };

function unit(over) {
  return Object.assign({
    고유ID: 'u1', 원본코드: 'A100', 품목코드: 'A100', 품목명: '감자탕',
    출고지: '평택1', 상태: '판매중', 주소1: '서울시 강남구 테헤란로 1',
    부족수량: 0, 총필요수량: 1, 현재고: 9, 품목누락: false, 주문수량: 1
  }, over || {});
}
function route(units, partnerItems) {
  const w = [];
  C.ssRoute(units, { vendors: vendors, override: {}, partnerItems: partnerItems || {} }, cfg, w);
  return w;
}

console.log('\n[대리발송품목] 표에 적힌 품목');
{
  const u = unit();
  route([u], { A100: { 업체코드: 'JH', 사유: '업체가 직접 보냄' } });
  eq('표에 있으면 대리발송', u.route, C.SS_ROUTE.PARTNER);
  eq('업체코드가 붙는다', u.업체코드, 'JH');
  eq('업체명도 붙는다', u.업체명, '정화식품');
}
{
  const u = unit();
  route([u], {});
  eq('표에 없으면 종전대로 자사', u.route !== C.SS_ROUTE.PARTNER, true);
}

console.log('\n[대리발송품목] 세트를 쪼갠 뒤의 구성품');
{
  //  SET900 을 시켰고 쪼개면 A100 · B200 이 나온다. 업체가 대는 것은 B200 뿐.
  const a = unit({ 고유ID: 'u2', 원본코드: 'SET900', 품목코드: 'A100' });
  const b = unit({ 고유ID: 'u2', 원본코드: 'SET900', 품목코드: 'B200' });
  route([a, b], { B200: { 업체코드: 'HP', 사유: '' } });
  eq('걸린 구성품만 대리발송', b.route, C.SS_ROUTE.PARTNER);
  eq('나머지 구성품은 그대로', a.route !== C.SS_ROUTE.PARTNER, true);
}
{
  //  시킨 코드(세트 통째)로 적어도 걸려야 한다
  const a = unit({ 원본코드: 'SET900', 품목코드: 'A100' });
  route([a], { SET900: { 업체코드: 'JH', 사유: '' } });
  eq('시킨 코드로 적어도 걸린다', a.route, C.SS_ROUTE.PARTNER);
}
{
  const a = unit({ 원본코드: 'a100', 품목코드: 'a100' });
  route([a], { A100: { 업체코드: 'JH', 사유: '' } });
  eq('대소문자는 안 가린다', a.route, C.SS_ROUTE.PARTNER);
}

console.log('\n[대리발송품목] 재고·상태를 안 본다');
{
  const u = unit({ 부족수량: 5, 현재고: 0 });
  route([u], { A100: { 업체코드: 'JH', 사유: '' } });
  eq('재고가 없어도 보류로 안 간다', u.route, C.SS_ROUTE.PARTNER);
}
{
  const u = unit({ 출고지: '', 상태: '단종' });
  route([u], { A100: { 업체코드: 'JH', 사유: '' } });
  eq('출고지·상태가 비어도 대리발송', u.route, C.SS_ROUTE.PARTNER);
}

console.log('\n[대리발송품목] 사람이 내린 결정이 이긴다');
{
  const u = unit();
  const w = [];
  C.ssRoute([u], {
    vendors: vendors,
    override: { 'u1|A100': { 조치: '발송', 업체코드: '', 메모: '' } },
    partnerItems: { A100: { 업체코드: 'JH', 사유: '' } }
  }, cfg, w);
  eq('「발송」이라 뒤집으면 표를 무시', u.route !== C.SS_ROUTE.PARTNER, true);
}

console.log('\n[대리발송품목] 업체코드가 이상하면 말해 준다');
{
  const u = unit({ 원본코드: 'ZZ9', 품목코드: 'ZZ9' });
  const w = route([u], { ZZ9: { 업체코드: 'XX', 사유: '' } });
  eq('없는 업체코드는 경고', w.some((x) => x.code === 'PITEM_BAD_VENDOR'), true);
  eq('그래도 대리발송으로는 간다', u.route, C.SS_ROUTE.PARTNER);
}

console.log('\n' + (fail ? 'FAIL ' + fail + '건' : '통과 ' + pass + '건'));
process.exit(fail ? 1 : 0);
