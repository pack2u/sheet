/**
 * 섬 쇼핑몰 주문이 2박스 이상이면 보류 — ssIslandMultiBoxHold  (2026-10-14)
 *   > "2개이상일때는 1건의 도서산간비만 붙기떄문에 일단 보류로 빠져야 되.."
 * 실행: node node/_islandmultibox_test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');
const R = C.SS_ROUTE;
let fail = 0, pass = 0;
const eq = (l, g, w) => { if (String(g) === String(w)) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + '  got ' + g + '  want ' + w); } };
const 줄 = (o) => Object.assign({ route: R.LOTTE_ISLAND, 주문번호출처: '사방넷', 받는분: '홍길동', 주소1: '제주 제주시 남성로 26',
  보내는분: '팩투유', 박스수: 1, 도선료: 5000, 고유ID: '1', 합포장그룹: '' }, o);
const 돌 = (units, cfg) => { const w = []; C.ssIslandMultiBoxHold(units, cfg || C.SS_DEFAULT_CONFIG, w); return { units, w }; };

{ const r = 돌([줄({ 고유ID: '1' })]); eq('1박스는 그대로', r.units[0].route, R.LOTTE_ISLAND); }
{ const r = 돌([줄({ 고유ID: '1' }), 줄({ 고유ID: '2' })]);
  eq('★ 같은 받는분 2박스 → 둘 다 보류', r.units.map(u => u.route).join(','), R.HOLD + ',' + R.HOLD);
  eq('  사유', r.units[0].보류사유, '도서산간추가비');
  eq('  추가 금액 5,000원쯤', r.units[0].보류상세.indexOf('5,000원쯤') >= 0, true);
  eq('  경고 1건', r.w.filter(x => x.code === 'ISLAND_MULTI_BOX').length, 1); }
{ const r = 돌([줄({ 고유ID: '1', 박스수: 2 })]); eq('★ 한 주문 2박스도 보류', r.units[0].route, R.HOLD); }
{ const 대표 = 줄({ 고유ID: '1', 합포장그룹: 'G1', 박스수: 1 }), 동봉 = 줄({ 고유ID: '2', route: R.MERGED, 합포장그룹: 'G1', 박스수: 0 });
  const r = 돌([대표, 동봉]); eq('★ 합포장 한 박스(송장 1장)는 안 세운다', 대표.route + ',' + 동봉.route, R.LOTTE_ISLAND + ',' + R.MERGED); }
{ const 대표 = 줄({ 고유ID: '1', 합포장그룹: 'G1' }), 동봉 = 줄({ 고유ID: '2', route: R.MERGED, 합포장그룹: 'G1', 박스수: 0 }), 따로 = 줄({ 고유ID: '3' });
  돌([대표, 동봉, 따로]); eq('★ 세운 대표의 동봉 줄도 같이 보류', [대표.route, 동봉.route, 따로.route].join(','), [R.HOLD, R.HOLD, R.HOLD].join(',')); }
{ const r = 돌([줄({ 고유ID: 'p1014000001', 주문번호출처: '자동발급' }), 줄({ 고유ID: 'p1014000002', 주문번호출처: '자동발급' })]);
  eq('전화주문은 안 세운다', r.units[0].route, R.LOTTE_ISLAND); }
{ const r = 돌([줄({ 고유ID: '1' }), 줄({ 고유ID: '2', 받는분: '김철수' })]); eq('받는분이 다르면 따로 센다', r.units[0].route, R.LOTTE_ISLAND); }
{ const r = 돌([줄({ 고유ID: '1', 도선료: '' }), 줄({ 고유ID: '2' })]); eq('도선료는 묶음 최댓값', r.units[0].보류상세.indexOf('5,000원쯤') >= 0, true); }
{ const r = 돌([줄({ 고유ID: '1', 도선료: '' }), 줄({ 고유ID: '2', 도선료: '' })]); eq('끝내 모르면 금액 안 적음', /원쯤/.test(r.units[0].보류상세), false); }
{ const cfg = Object.assign({}, C.SS_DEFAULT_CONFIG, { 도서산간_여러박스_보류: '끔' });
  const r = 돌([줄({ 고유ID: '1' }), 줄({ 고유ID: '2' })], cfg); eq('설정 끔이면 안 세운다', r.units[0].route, R.LOTTE_ISLAND); }
console.log(fail ? '✗ ' + fail + '건 실패' : '✓ 모두 통과 (' + pass + ')');
process.exit(fail ? 1 : 0);
