/**
 * 주문취소 조치 · 도서산간비 줄 비배송  (2026-10-22)
 *   > "도서산간비 줄은 비배송으로 옮겨줘"
 *   > "로젠출력에서 삭제 하고 싶은 주문건이 생기면 체크하고 삭제가능한 기능. 대리발송에서 체크하고 삭제하는 기능"
 * 실행: node node/_cancel_test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; return; }
  fail++; console.log('  FAIL ' + label + '\n       got  ' + got + '\n       want ' + want);
}
const CFG = C.SS_DEFAULT_CONFIG;
const M0 = () => ({ ferry: [], islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {}, override: {}, vendors: { NK: '냅킨코리아' } });
const 줄 = (o) => Object.assign({ 고유ID: 'T1', 주소1: '경기도 평택시 포승읍 1', route: '', 상태: '판매중', 출고지: '평택A-1', 품목코드: 'OK1', 원본코드: 'OK1', 수량: 1, 합계: 1000 }, o);

// ① 로젠 줄을 취소 → 비배송 · 사유 주문취소
{
  const M = M0(); M.override['T1|OK1'] = { 조치: '취소', 메모: 'v2 조치' };
  const u = 줄(); C.ssRoute([u], M, CFG, []);
  eq('① 취소 → 비배송', u.route, C.SS_ROUTE.NONSHIP);
  eq('① 사유 주문취소', u.비배송사유, '주문취소');
  eq('① 비배송 탭 줄에 사유가 찍힌다', C.ssNonshipRow(u).indexOf('주문취소') >= 0, true);
}
// ② 같은 주문의 다른 줄은 그대로 (줄 단위)
{
  const M = M0(); M.override['T1|OK1'] = { 조치: '취소' };
  const a = 줄(), b = 줄({ 품목코드: 'OK2', 원본코드: 'OK2' });
  C.ssRoute([a, b], M, CFG, []);
  eq('② 고른 줄만 취소', a.route + '/' + b.route, C.SS_ROUTE.NONSHIP + '/' + C.SS_ROUTE.LOTTE);
}
// ③ 대리발송 줄을 취소 → 대리발송에서 빠짐 (조치 없을 땐 대리발송인 줄)
{
  const M = M0(); M.override['T1|OK1'] = { 조치: '대리발송', 업체코드: 'NK' };
  const u = 줄(); C.ssRoute([u], M, CFG, []);
  eq('③ 조치 대리발송이면 대리발송', u.route, C.SS_ROUTE.PARTNER);
  const M2 = M0(); M2.override['T1|OK1'] = { 조치: '취소' };
  const v = 줄({ 출고지: CFG.위탁출고지 || '대리발송' }); C.ssRoute([v], M2, CFG, []);
  eq('③ 대리발송 출고지 줄도 취소면 비배송', v.route, C.SS_ROUTE.NONSHIP);
}
// ④ 도서산간비 줄(OUT00001) → 비배송, 미발송 아님
{
  const u = 줄({ 품목코드: 'OUT00001', 원본코드: 'OUT00001', 품목명: '제주 도서산간 단품 추가비용', 합계: 5000 });
  C.ssRoute([u], M0(), CFG, []);
  eq('④ 도서산간비 줄은 비배송', u.route, C.SS_ROUTE.NONSHIP);
  eq('④ 보류사유 없음(미발송 아님)', u.보류사유 || '', '');
  const v = 줄({ 품목코드: 'OUT000011', 원본코드: 'OUT000011' });
  C.ssRoute([v], M0(), CFG, []);
  eq('④ OUT000011 도', v.route, C.SS_ROUTE.NONSHIP);
}
// ⑤ 다른 제품아님(금액 음수)은 여전히 미발송 — 이번에 안 바꾼 것
{
  const u = 줄({ 합계: -3000 }); C.ssRoute([u], M0(), CFG, []);
  eq('⑤ 금액 음수는 그대로 보류', u.route + '/' + u.보류사유, C.SS_ROUTE.HOLD + '/제품아님');
}
// ⑤-2 수량 음수(취소 들어옴)는 미발송 아니고 비배송 — 앞 회차는 core 가 안 건드린다 (2026-10-23)
{
  const u = 줄({ 수량: -2, 주문수량: -2, 합계: -76000 }); C.ssRoute([u], M0(), CFG, []);
  eq('⑤-2 수량 음수 → 비배송', u.route, C.SS_ROUTE.NONSHIP);
  eq('⑤-2 사유 취소 들어옴', String(u.비배송사유).indexOf('취소 들어옴') === 0, true);
  eq('⑤-2 보류사유 없음', u.보류사유 || '', '');
}
// ⑥ 깨 보기 — 조치 말이 다르면(취소 아님) 안 지운다
{
  const M = M0(); M.override['T1|OK1'] = { 조치: '취소함' };
  const u = 줄(); C.ssRoute([u], M, CFG, []);
  eq('⑥ 「취소함」은 취소가 아니다', u.route !== C.SS_ROUTE.NONSHIP, true);
}
console.log(fail ? `✗ ${fail}건 실패 · 통과 ${pass}` : `✅ 통과 ${pass}건`);
process.exit(fail ? 1 : 0);
