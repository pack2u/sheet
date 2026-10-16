/**
 * 대리발송(업체) 물건은 우리 박스에 합포장하지 않는다 — ssMerge  (2026-10-16)
 *   > "합포장 합배송이 대리발송 업체것과 우리 출고것이 합쳐지는 경우가 있어.. 대리발송의 경우는 합배송이 안되.."
 * 실행: cd node && node _mergeconsign_test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');
const R = C.SS_ROUTE;
let fail = 0, pass = 0;
const eq = (l, g, w) => { if (String(g) === String(w)) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + '  got ' + g + '  want ' + w); } };
const cfg = Object.assign({}, C.SS_DEFAULT_CONFIG);
const 줄 = (o) => Object.assign({ route: R.LOTTE, 출고지: cfg.합배송출고지, 조건ID: 'C1', 수량: 1, 받는분: '홍길동',
  주소1: '제주 제주시 남성로 26', 보내는분: '팩투유', 품목명: 'AJ 감자탕 200개', 배송비: 3000, 박스수: 1 }, o);

{ const a = 줄({ 고유ID: '1' }), b = 줄({ 고유ID: '2' });
  C.ssMerge([a, b], cfg); eq('우리 줄 둘은 합배송된다', !!(a.합포장그룹 && a.합포장그룹 === b.합포장그룹), true); }
{ const a = 줄({ 고유ID: '1' }), b = 줄({ 고유ID: '2', route: R.PARTNER });
  C.ssMerge([a, b], cfg); eq('대리발송 줄은 안 묶인다', !!(a.합포장그룹 || b.합포장그룹), false); }
{ const a = 줄({ 고유ID: '1' }), b = 줄({ 고유ID: '2', route: R.LOTTE_ISLAND_CONSIGN });
  C.ssMerge([a, b], cfg); eq('★ 도서산간(위탁배송) 줄도 안 묶인다', !!(a.합포장그룹 || b.합포장그룹), false); }
{ const a = 줄({ 고유ID: '1', route: R.LOTTE_ISLAND }), b = 줄({ 고유ID: '2', route: R.LOTTE_ISLAND });
  C.ssMerge([a, b], cfg); eq('우리 도서산간 줄끼리는 그대로 묶인다', !!(a.합포장그룹 && a.합포장그룹 === b.합포장그룹), true); }
console.log(fail ? '✗ ' + fail + '건 실패' : '✓ 모두 통과 (' + pass + ')');
process.exit(fail ? 1 : 0);
