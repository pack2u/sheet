/**
 * 직매입 거래처는 방문수령 — 로젠으로 안 나간다  (2026-10-02)
 *   > "직매입인 경우가 3개가 있어 그린우드, 넵킨코리아, 성우플러스
 *   >  여기는 로젠 출력으로 넘어가면 안되.. 방문수령이라.."
 * 실행: node node/_pickup_test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');
let fail = 0, pass = 0;
const eq = (l, g, w) => { if (String(g) === String(w)) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + '  got ' + g + '  want ' + w); } };
function 돌리기(거래처, 조치) {
  const w = [];
  const u = { 고유ID: 'd1002000052', 순번: '262', 주소1: '직접 수령', route: '', 상태: '판매중',
    출고지: '평택A-4', 품목코드: 'JHTWJJIM0101', 원본코드: 'JHTWJJIM0101', 합계: 41800, 품목명: 'JH 타원찜 소 100세트',
    거래처명원본: 거래처 };
  const M = { ferry: [], islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {}, vendors: {}, partnerItems: {},
    override: 조치 ? { 'd1002000052|JHTWJJIM0101': { 조치: 조치 } } : {} };
  C.ssRoute([u], M, C.SS_DEFAULT_CONFIG, w);
  return u;
}
for (const n of ['직매입-그린우드-이신종', '직매입-냅킨코리아', '직매입-성우플러스']) {
  const u = 돌리기(n);
  eq('★ ' + n + ' → 보류(방문수령)', u.route + '/' + u.보류사유, C.SS_ROUTE.HOLD + '/방문수령');
}
eq('보류상세에 거래처', 돌리기('직매입-그린우드-이신종').보류상세.indexOf('그린우드') >= 0, true);
eq('★ 대리발송-그린우드 는 그대로 나간다', 돌리기('대리발송-그린우드스토리 이신종').route !== C.SS_ROUTE.HOLD, true);
eq('일반 거래처는 그대로', 돌리기('법인/배민상회').route !== C.SS_ROUTE.HOLD, true);
eq('보류 탭 조치 「발송」이면 나간다', 돌리기('직매입-그린우드-이신종', '발송').route !== C.SS_ROUTE.HOLD, true);
console.log(fail ? '✗ ' + fail + '건 실패' : '✓ 모두 통과 (' + pass + ')');
process.exit(fail ? 1 : 0);
