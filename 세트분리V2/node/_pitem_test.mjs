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

/*  ★ 2026-09-17 에 규칙이 «뒤집혔다» ★
    > "대리발송품목에 적힌 제품은 우리재고가 있어도 무조건 대리발송으로"

    여태는 수동조치 「발송」이 표를 건너뛰었다. 그래서 보류 탭에서 그 건을
    먼저 처리하고 «그 뒤에» 표를 만들면, 옛 조치가 회차 내내 이겨서 표가
    영영 안 먹었다. 게다가 그 「발송」은 사람이 안 적었을 수도 있다 —
    상세를 지우면 기계가 해소로 보고 발송을 박는다.

    표는 «품목»에 대한 결정, 수동조치는 그 회차 «한 줄»의 처리다.
    품목에 대한 결정이 이긴다. 대신 조용히 이기지 않는다.  */
console.log('\n[대리발송품목] 표가 수동조치 「발송」을 이긴다');
{
  const u = unit();
  const w = [];
  C.ssRoute([u], {
    vendors: vendors,
    override: { 'u1|A100': { 조치: '발송', 업체코드: '', 메모: '' } },
    partnerItems: { A100: { 코드: 'A100', 업체코드: 'JH', 사유: '' } }
  }, cfg, w);
  eq('★ 「발송」이라 잡혀 있어도 대리발송으로 간다', u.route, C.SS_ROUTE.PARTNER);
  eq('★ 업체코드도 표 것으로', u.업체코드, 'JH');
  eq('★ 조용히 이기지 않는다 — 말한다',
    w.some((x) => x.code === 'PITEM_BEATS_MANUAL'), true);
  eq('★ 되돌리는 법을 알려 준다',
    w.some((x) => x.code === 'PITEM_BEATS_MANUAL' && x.msg.indexOf('지우세요') >= 0), true);
}

console.log('\n[대리발송품목] 표에 없는 품목은 「발송」이 그대로 이긴다');
{
  //  표는 그 품목에만 힘을 쓴다. 표에 없는 건까지 덮으면 안 된다.
  const u = unit();
  const w = [];
  C.ssRoute([u], {
    vendors: vendors,
    override: { 'u1|A100': { 조치: '발송', 업체코드: '', 메모: '' } },
    partnerItems: { B200: { 코드: 'B200', 업체코드: 'JH', 사유: '' } }
  }, cfg, w);
  eq('★ 표에 없으면 사람 손이 이긴다', u.route !== C.SS_ROUTE.PARTNER, true);
  eq('엉뚱한 경고를 안 띄운다', w.some((x) => x.code === 'PITEM_BEATS_MANUAL'), false);
}

console.log('\n[대리발송품목] 표대로 갔을 때는 아무 말 안 한다');
{
  const u = unit();
  const w = [];
  C.ssRoute([u], {
    vendors: vendors,
    override: {},
    partnerItems: { A100: { 코드: 'A100', 업체코드: 'JH', 사유: '' } }
  }, cfg, w);
  eq('대리발송으로 간다', u.route, C.SS_ROUTE.PARTNER);
  eq('★ 뒤집은 적이 없으면 조용하다', w.some((x) => x.code === 'PITEM_BEATS_MANUAL'), false);
}

console.log('\n[대리발송품목] 적어 넣은 업체코드를 그대로 쓴다');
{
  //  ★ 실제 사례 ★ MATYG0007 / JT — 우리 이카운트 코드에 준테크를 지정
  //  JT 는 허브 푸시가 아는 코드다. 세트분리 이름표에 없다고 버리면
  //  업체코드가 빈칸이 되고 푸시는 'MA' 로 되돌아가 미분류가 된다.
  const u = unit({ 원본코드: 'MATYG0007', 품목코드: 'MATYG0007' });
  const w = route([u], { MATYG0007: { 코드: 'MATYG0007', 업체코드: 'JT', 사유: '재고부족' } });
  eq('MATYG0007 → 대리발송', u.route, C.SS_ROUTE.PARTNER);
  eq('★ 업체코드가 JT 로 실린다', u.업체코드, 'JT');
  eq('이름표에 없으면 업체명은 빈칸', u.업체명, '');
  eq('이름표에 없다고 말은 해 준다', w.some((x) => x.code === 'PITEM_NEW_VENDOR'), true);
  eq('업체코드가 비었다는 경고는 안 뜬다', w.some((x) => x.code === 'PITEM_NO_VENDOR'), false);
}
{
  //  이름표에 있으면 이름까지 붙는다
  const u2 = unit();
  const w2 = route([u2], { A100: { 코드: 'A100', 업체코드: 'JH', 사유: '' } });
  eq('아는 코드는 이름도 붙는다', u2.업체명, '정화식품');
  eq('그때는 아무 말 안 한다', w2.length, 0);
}

console.log('\n' + (fail ? 'FAIL ' + fail + '건' : '통과 ' + pass + '건'));
process.exit(fail ? 1 : 0);
