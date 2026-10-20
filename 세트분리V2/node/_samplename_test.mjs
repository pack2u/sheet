/**
 * 샘플·출고 사유를 품목명에 — ssDisplayName · ssShipReasonOf  (2026-10-20)
 *   > "코드명이 SAMPLE일 경우 … [샘플] 적요내용"
 *   > "적요에 … 오배송 재출고 등의 내용이 적혀있는경우는 상품명 뒤에 - 적요의 출고내용이 적히게"
 * 실행: node node/_samplename_test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');
let fail = 0, pass = 0;
const eq = (l, g, w) => { if (String(g) === String(w)) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + '  got ' + g + '  want ' + w); } };
const 이름 = (o) => C.ssDisplayName(Object.assign({ 품목코드: 'AJBC10001', 품목명: 'AJ 반찬용기 3찬 1000개---몸통만', 적요: '', 판매처표기: '' }, o));

eq('SAMPLE → [샘플] 적요', 이름({ 품목코드: 'SAMPLE', 품목명: '[샘플] 샘플 발송요청', 적요: 'JH 샐러드 201 검정/ HN 샐러드 201 투명' }),
  '[샘플] JH 샐러드 201 검정/ HN 샐러드 201 투명');
eq('SAMPLE + 판매처 꼬리', 이름({ 품목코드: 'SAMPLE', 품목명: '[샘플] 샘플 발송요청', 적요: 'BF 5칸도시락', 판매처표기: '법인/배민상회' }),
  '[샘플] BF 5칸도시락---법인/배민상회');
eq('SAMPLE 인데 적요 없음 → 그대로', 이름({ 품목코드: 'SAMPLE', 품목명: '[샘플] 샘플 발송요청' }), '[샘플] 샘플 발송요청');
eq('이름 있는 샘플 세트(SAMPLE-JJIM3)는 그대로', 이름({ 품목코드: 'SAMPLE-JJIM3', 품목명: '[샘플] JH 미니사각찜', 적요: '오배송' }),
  '[샘플] JH 미니사각찜 - 오배송');
eq('★ 오배송/재출고 → 뒤에 붙음', 이름({ 적요: '오배송/재출고' }), 'AJ 반찬용기 3찬 1000개---몸통만 - 오배송/재출고');
eq('판매처 꼬리 뒤에 붙음', 이름({ 적요: '불량 재발송 부탁', 판매처표기: '법인/배민상회' }),
  'AJ 반찬용기 3찬 1000개---몸통만---법인/배민상회 - 불량 재발송');
eq('사유 말이 없으면 안 붙음', 이름({ 적요: '문 앞에 두세요 010-1234-5678' }), 'AJ 반찬용기 3찬 1000개---몸통만');
eq('이미 붙어 있으면 또 안 붙음', 이름({ 품목명: 'AJ 반찬용기---몸통만 - 오배송/재출고', 적요: '오배송/재출고' }), 'AJ 반찬용기---몸통만 - 오배송/재출고');
eq('괄호 떼기', C.ssShipReasonOf('(오출고) 다시 보내주세요'), '오출고');
eq('** 적요는 예전대로', 이름({ 적요: '**급함' }), 'AJ 반찬용기 3찬 1000개---몸통만**급함');

console.log(fail ? `\n❌ 실패 ${fail}건 / 통과 ${pass}건` : `\n✅ 통과 ${pass}건`);
process.exit(fail ? 1 : 0);
