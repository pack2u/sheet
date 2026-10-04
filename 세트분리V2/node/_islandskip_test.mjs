/**
 * 도서산간 — 조치 「발송」이면 뺀다  ·  제품 아닌 줄은 미발송
 *
 *   > "세트분리뉴에서 코드가 없거나 제품이 아닌 반품비, 값이 -인것등
 *   >  제품이 아닌것들은 다 미발송으로 빠지게 해주고
 *   >  조치를 실행하면 도서산간도 발송으로 처리한 것들은 도서산간에서 빠지게 해줘"
 *
 * 도서 판정은 세 갈래다 — 도선료표 · 우편번호 · 지역확정.
 * 여태 셋 다 조치를 «안 봤다». 하나라도 빠뜨리면 사장님은 또 같은 줄을 본다.
 * 그래서 세 갈래를 따로따로 박는다.
 *
 * 실행: node node/_islandskip_test.mjs
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

const CFG = C.SS_DEFAULT_CONFIG;
const FERRY = [{ 시군: '울릉군', 읍면동: '울릉읍', 리: [], 료: 6500, 권역: '도서' }];

function 돌리기(주소, 조치, masters) {
  const w = [];
  const u = {
    고유ID: 'T1', 주소1: 주소, route: '', 상태: '판매중', 출고지: '평택A-1',
    품목코드: 'OK1', 원본코드: 'OK1'
  };
  const M = Object.assign({
    ferry: [], islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {},
    override: 조치 ? { 'T1|OK1': { 조치: 조치 } } : {}
  }, masters || {});
  C.ssRoute([u], M, CFG, w);
  return { u: u, w: w };
}

console.log('\n[1] 도선료표로 잡힌 섬');
{
  const M = { ferry: FERRY };
  const 섬 = '경북 울릉군 울릉읍 도동리 1';
  const a = 돌리기(섬, '', M);
  eq('조치 없으면 도서산간 그대로', a.u.route, C.SS_ROUTE.LOTTE_ISLAND);

  const b = 돌리기(섬, '발송', M);
  eq('★ 조치 「발송」이면 도서산간에서 빠진다', b.u.route, C.SS_ROUTE.LOTTE);
  eq('  판정 기록은 남긴다 (왜 섬이었는지)', b.u.도서판정, '도선료표');
  //  ★ 조용히 빼지 않는다 ★ 돈이 빠지는 일이라 반드시 말한다
  const 경고 = b.w.filter((x) => x.code === 'ISLAND_SKIPPED_BY_MANUAL');
  eq('★ 뺐다고 말한다', 경고.length, 1);
  eq('★ 얼마가 빠지는지 적는다', 경고[0].msg.indexOf('6500원') >= 0, true);
}

console.log('\n[2] 우편번호로 잡힌 섬');
{
  const 주소 = '제주 제주시 아무동 1';
  const M = { addrZip: { [C.ssNormAddr(주소)]: '63000' }, islandZips: { '63000': '제주' } };
  eq('조치 없으면 도서산간', 돌리기(주소, '', M).u.route, C.SS_ROUTE.LOTTE_ISLAND);
  const b = 돌리기(주소, '발송', M);
  eq('★ 조치 「발송」이면 빠진다', b.u.route, C.SS_ROUTE.LOTTE);
  eq('★ 뺐다고 말한다',
    b.w.filter((x) => x.code === 'ISLAND_SKIPPED_BY_MANUAL').length, 1);
}

console.log('\n[3] 지역확정(우편번호가 없을 때)');
{
  const 주소 = '제주특별자치도 어딘가 1';
  const M = { islandKeywords: [{ kw: '제주', confirm: true, zone: '제주' }] };
  eq('조치 없으면 도서산간', 돌리기(주소, '', M).u.route, C.SS_ROUTE.LOTTE_ISLAND);
  const b = 돌리기(주소, '발송', M);
  eq('★ 조치 「발송」이면 빠진다', b.u.route, C.SS_ROUTE.LOTTE);
  eq('★ 뺐다고 말한다',
    b.w.filter((x) => x.code === 'ISLAND_SKIPPED_BY_MANUAL').length, 1);
}

console.log('\n[4] 섬이 아닌 곳은 아무것도 안 바뀐다');
{
  const a = 돌리기('경기 평택시 포승읍 1', '발송', {});
  eq('일반 출고 그대로', a.u.route, C.SS_ROUTE.LOTTE);
  eq('쓸데없는 경고 안 낸다',
    a.w.filter((x) => x.code === 'ISLAND_SKIPPED_BY_MANUAL').length, 0);
}

console.log('\n' + (fail ? 'FAIL ' + fail + '건' : '통과 ' + pass + '건'));
process.exit(fail ? 1 : 0);
