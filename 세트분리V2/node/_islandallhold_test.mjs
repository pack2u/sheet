/**
 * v2 도서산간 전부 보류 — ssIslandAllHold  (2026-10-20 · 2026-10-26 사방넷 1박스는 내보냄)
 *   > "도서산간 사방넷 주문중에 세트상품이거나 2박스 이상만 미발송으로 빠지게해줘. 지금은 1박스짜리도 빠지더라"
 * 실행: node node/_islandallhold_test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');
const R = C.SS_ROUTE;
let fail = 0, pass = 0;
const eq = (l, g, w) => { if (String(g) === String(w)) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + '  got ' + g + '  want ' + w); } };
const cfg = Object.assign({}, C.SS_DEFAULT_CONFIG, { 도서산간_전부보류: '켬', _섬조치: {} });
const 줄 = (o) => Object.assign({ route: R.LOTTE_ISLAND, 주문번호출처: '사방넷', 받는분: '홍길동', 주소1: '제주 제주시 남성로 26',
  보내는분: '팩투유', 박스수: 1, 도선료: 5000, 고유ID: '1', 순번: '000001', 품목코드: 'A', 원본코드: 'A', 주문수량: 1, 합포장그룹: '' }, o);
const 돌 = (units) => { const w = []; C.ssIslandMultiBoxHold(units, cfg, w); C.ssIslandAllHold(units, cfg, w); return units; };

eq('★ 사방넷 1박스 → 도서산간으로 나감', 돌([줄({})])[0].route, R.LOTTE_ISLAND);
{ const u = 돌([줄({ 고유ID: '1' }), 줄({ 고유ID: '2', 순번: '000002' })]);
  eq('★ 사방넷 같은 받는분 2박스 → 보류(도서산간추가비)', u.map((x) => x.route + ':' + x.보류사유).join(','), '보류:도서산간추가비,보류:도서산간추가비'); }
{ const u = 돌([줄({ 품목코드: 'A-몸통' }), 줄({ 품목코드: 'A-뚜껑' })]);
  eq('★ 사방넷 쪼갠 세트(2박스) → 보류', u[0].route, R.HOLD); }
eq('사방넷 아닌 주문(이카운트) 1박스 → 여태처럼 보류', 돌([줄({ 주문번호출처: '이카운트' })])[0].route, R.HOLD);
eq('위탁(업체 섬 줄) → 여태처럼 보류', 돌([줄({ route: R.LOTTE_ISLAND_CONSIGN })])[0].route, R.HOLD);
console.log(fail ? `✗ 실패 ${fail}` : `✓ 모두 통과 (${pass})`);
process.exit(fail ? 1 : 0);
