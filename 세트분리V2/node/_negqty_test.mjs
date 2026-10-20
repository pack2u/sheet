/**
 * 수량이 음수인 줄은 안 나간다 — ssNonShipReason  (2026-10-20)
 *   > "-금액인게 로젠으로 붙었네?"  (DWSJ00003 · 수량 −1 · 합계 0 · 적요 「불량입고/1019」)
 * 실행: node node/_negqty_test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');
let fail = 0, pass = 0;
const eq = (l, g, w) => { if (String(g) === String(w)) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + '  got ' + g + '  want ' + w); } };
const cfg = C.SS_DEFAULT_CONFIG;
const 줄 = (o) => Object.assign({ 품목코드: 'DWSJ00003', 원본코드: 'DWSJ00003', 품목명: 'DW 170mm 숟가락 개별포장 블랙 1500개', 수량: 1, 주문수량: 1, 합계: 15000, 적요: '' }, o);

eq('★ 수량 −1 · 금액 0 → 안 나감', C.ssNonShipReason(줄({ 수량: -1, 주문수량: -1, 합계: 0, 적요: '불량입고/1019' }), cfg), '수량 음수 (-1)');
eq('주문수량만 음수여도 안 나감', C.ssNonShipReason(줄({ 주문수량: -2 }), cfg), '수량 음수 (-2)');
eq('금액 음수는 예전대로', C.ssNonShipReason(줄({ 합계: -3000 }), cfg), '금액 음수 (-3000)');
eq('정상 줄은 나감', C.ssNonShipReason(줄({}), cfg), '');

console.log(fail ? `\n❌ 실패 ${fail}건 / 통과 ${pass}건` : `\n✅ 통과 ${pass}건`);
process.exit(fail ? 1 : 0);
