/**
 * 도서산간 판정 패스 — 전화주문 · 대리판매 고유ID 는 도서산간 탭에 세우지 않는다.
 * 2026-10-05
 *
 *   > "세트분리시 대리판매 업체는 이미도서산간을 실행했으니 도서산간 판정에서
 *   >  빠져야 되겠지?(고유아이디 인식 으로)"
 *   > "세트분리시 고유아이디(P00000, d00000)가 전화주문 또는 대리판매업체일경우
 *   >  도서산간 판정 패스 하게 해주면 되.."
 *
 *   대리판매는 허브가 판매현황 «전»에 같은 자료로 판정하고 OUT00001 을 실었다.
 *   그 OUT00001 줄은 물건이 아니니 송장도 안 낸다.
 *
 * 실행: node node/_islandpass_test.mjs
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
const M0 = {
  ferry: [{ 시군: '울릉군', 읍면동: '울릉읍', 리: [], 료: 6500, 권역: '도서' }],
  islandKeywords: [{ kw: '제주', zone: '제주', confirm: true }],
  islandZips: { '63309': '제주' }, addrZip: { '제주 제주시 연동 1': '63309' }, localAddrs: {}, override: {}
};

function 돌리기(uid, 주소, 출고지) {
  const w = [];
  const u = {
    고유ID: uid, 주소1: 주소, route: '', 상태: '판매중', 출고지: 출고지 || '평택A-1',
    품목코드: 'OK1', 원본코드: 'OK1'
  };
  C.ssRoute([u], Object.assign({}, M0), CFG, w);
  return u;
}

console.log('\n[1] 패스하는 고유ID 모양');
for (const [uid, want] of [
  ['d0930000044', true], ['d0930000044_S2', true], ['0901-ds-4581', true],
  ['p0921000001', true], ['P0921000001', true], ['0921-PH-a3f19', true], ['260902-PH-a3f19', true],
  ['2165247640', false], ['2165247640_S1', false], ['20250918-0000123', false], ['', false],
]) eq(`${uid || '(빈칸)'} → ${want ? '패스' : '판정'}`, C.ssIsHubOrderUid(uid), want);

console.log('\n[2] ★ 섬 주소라도 전화주문·대리판매는 일반 로젠으로 ★');
const 울릉 = '경북 울릉군 울릉읍 도동리 1';
const 제주 = '제주 제주시 연동 1';
eq('사방넷 주문 — 도선료표 섬이면 도서산간 (여태 그대로)', 돌리기('2165247640', 울릉).route, C.SS_ROUTE.LOTTE_ISLAND);
eq('사방넷 주문 — 우편번호 섬이면 도서산간 (여태 그대로)', 돌리기('2165247640', 제주).route, C.SS_ROUTE.LOTTE_ISLAND);
const d = 돌리기('d0930000044', 울릉);
eq('대리판매 — 일반 로젠', d.route, C.SS_ROUTE.LOTTE);
eq('  판정 칸에 왜 빠졌는지 남긴다', d.도서판정, C.SS_HUB_ISLAND_NOTE);
eq('대리판매(옛 모양) — 일반 로젠', 돌리기('0901-ds-4581', 제주).route, C.SS_ROUTE.LOTTE);
eq('대리판매 쪼갠 세트(_S2) — 일반 로젠', 돌리기('d0930000044_S2', 제주).route, C.SS_ROUTE.LOTTE);
eq('전화주문 — 일반 로젠', 돌리기('p0921000001', 울릉).route, C.SS_ROUTE.LOTTE);
eq('전화주문(옛 모양) — 일반 로젠', 돌리기('0921-PH-a3f19', 제주).route, C.SS_ROUTE.LOTTE);

console.log('\n[3] 대리발송 갈래에서도 세우지 않는다 (위탁배송 도서산간 탭에 안 섬)');
const 위탁 = 돌리기('d0930000044', 제주, CFG.위탁출고지);
eq('대리판매 + 대리발송 출고지 — 도서산간(위탁배송) 아님', 위탁.route === C.SS_ROUTE.LOTTE_ISLAND_CONSIGN, false);
const 위탁사방 = 돌리기('2165247640', 제주, CFG.위탁출고지);
eq('사방넷 + 대리발송 출고지 — 여태처럼 도서산간(위탁배송)', 위탁사방.route, C.SS_ROUTE.LOTTE_ISLAND_CONSIGN);

console.log('\n[4] OUT00001(도서산간비 줄)은 물건이 아니다 — 송장 안 냄');
//  ssNonShipReason 은 내보내지 않았다 — 코드 문자열로 확인한다
const src = require('node:fs').readFileSync(new URL('../core.js', import.meta.url), 'utf8');
eq('ssNonShipReason 이 OUT00001 을 비배송으로', /if \(code === SS_ISLAND_FEE_CODE\) return/.test(src), true);
eq('그 코드는 OUT00001', C.SS_ISLAND_FEE_CODE, 'OUT00001');

console.log('');
console.log(fail ? `FAIL ${fail}건 (통과 ${pass})` : `모두 통과 (${pass}건)`);
process.exit(fail ? 1 : 0);
