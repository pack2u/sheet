/**
 * 대리발송으로 가는 줄도 섬이면 「도서산간(위탁배송)」 탭에 선다
 *
 *   > "제주도인데 대리발송으로 빠졌는데 도서산간에 안잡혔어 확인해줘"  (2026-10-02)
 *   > (고르신 것) 도서산간 탭에 세운다 — 업체 발주를 멈추고 사람이 정한다
 *
 * 대리발송 갈래 셋(출고지 대리발송 · 대리발송품목 표 · 재고부족 자동)을 따로 박는다.
 * 실행: node node/_islandpartner_test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  ok   ' + label); return; }
  fail++;
  console.log('  FAIL ' + label + '\n       got  ' + got + '\n       want ' + want);
}
const R = C.SS_ROUTE;
const 제주 = '제주특별자치도 서귀포시 태평로 399-1';
const 육지 = '경기 평택시 평택2로 29-8';

function 돌리기(o) {
  const w = [];
  const u = Object.assign({
    고유ID: 'T1', 순번: '100303', 주소1: 제주, route: '', 상태: '판매중',
    출고지: '대리발송', 품목코드: 'BWSCJW0005', 원본코드: 'BWSCJW0005', 부족수량: 0
  }, o.u || {});
  const cfg = Object.assign({}, C.SS_DEFAULT_CONFIG, o.cfg || {});
  if (o.조치 !== undefined) cfg._섬조치 = { [u.순번 + '|' + u.품목코드]: o.조치 };
  const M = Object.assign({
    ferry: [], islandZips: {}, addrZip: {}, localAddrs: {}, override: {},
    islandKeywords: [{ kw: '제주', confirm: true, zone: '제주' }],
    vendors: { BW: '비더블유', TY: '티와이' }, partnerItems: {}
  }, o.M || {});
  C.ssRoute([u], M, cfg, w);
  return { u, w };
}

console.log('\n[1] 출고지 대리발송 + 제주');
{
  const a = 돌리기({});
  eq('★ 업체로 안 넘어가고 위탁 도서산간에 선다', a.u.route, R.LOTTE_ISLAND_CONSIGN);
  eq('★ 판정 칸에 표시', a.u.도서판정.indexOf('⚠대리발송 확인') >= 0, true);
  eq('  어느 업체 건인지 보인다', a.u.도서판정.indexOf('(BW)') >= 0, true);
  eq('  권역 · 도선료가 찬다', a.u.도서권역 + '/' + (a.u.도선료 > 0), '제주/true');
  eq('★ 경고로 알린다', a.w.filter((x) => x.code === 'ISLAND_PARTNER_WAIT').length, 1);
}

console.log('\n[2] 조치 칸에 적은 대로');
{
  eq('「대리발송」 → 업체로', 돌리기({ 조치: '대리발송' }).u.route, R.PARTNER);
  const t = 돌리기({ 조치: 'ty' });
  eq('업체코드(ty) → 그 업체로', t.u.route + '/' + t.u.업체코드, R.PARTNER + '/TY');
  eq('「보류」 → 보류', 돌리기({ 조치: '보류' }).u.route, R.HOLD);
  eq('「발송」 → 우리가 일반으로', 돌리기({ 조치: '발송' }).u.route, R.LOTTE);
  const x = 돌리기({ 조치: '몰라' });
  eq('★ 못 알아들으면 안 보낸다(보류)', x.u.route + '/' + x.u.보류사유, R.HOLD + '/도서산간확인');
}

console.log('\n[3] 대리발송품목 표 + 제주');
{
  const a = 돌리기({ u: { 출고지: '평택A-1' }, M: { partnerItems: { BWSCJW0005: { 코드: 'BWSCJW0005', 업체코드: 'BW' } } } });
  eq('★ 위탁 도서산간에 선다', a.u.route, R.LOTTE_ISLAND_CONSIGN);
  eq('  업체코드는 표 값', a.u.업체코드, 'BW');
}

console.log('\n[4] 재고부족 자동 대리발송 + 제주');
{
  const a = 돌리기({ u: { 출고지: '대리발송', 부족수량: 1 } });
  eq('★ 위탁 도서산간에 선다', a.u.route, R.LOTTE_ISLAND_CONSIGN);
}

console.log('\n[5] 육지는 그대로 대리발송');
{
  eq('출고지 대리발송', 돌리기({ u: { 주소1: 육지 } }).u.route, R.PARTNER);
  eq('경고 없음', 돌리기({ u: { 주소1: 육지 } }).w.filter((x) => x.code === 'ISLAND_PARTNER_WAIT').length, 0);
}

console.log('\n[6] 산간은 섬이 아니다');
{
  const 산 = '강원 인제군 기린면 1';
  const M = { addrZip: { [C.ssNormAddr(산)]: '24600' }, islandZips: { '24600': '산간' } };
  eq('산간 + 대리발송 → 업체로', 돌리기({ u: { 주소1: 산 }, M }).u.route, R.PARTNER);
}

console.log('\n' + (fail ? '✗ ' + fail + '건 실패' : '✓ 모두 통과 (' + pass + ')'));
process.exit(fail ? 1 : 0);
