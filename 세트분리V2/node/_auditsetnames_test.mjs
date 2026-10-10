/**
 * 세트 이름 점검 (ssAuditSetNames) — 원장을 나간 뒤에 다시 본다
 *   node _auditsetnames_test.mjs
 * 9/28 회차 260928-1·2 의 실제 줄 모양을 그대로 옮겼다.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want)); }
};

const head = ['회차키', '라인ID', '고유ID', '경로', '순번', '원본품목코드', '품목코드', '품목명', '출력품목명', '거래처명'];
const 줄 = (rk, 순번, 원본, 코드, 이름, 받는분, uid) =>
  [rk, '', uid || 'U' + 순번, '로젠택배', 순번, 원본, 코드, 이름.replace(/---(법인|개인)\/.*$/, ''), 이름, 받는분 || '홍길동'];

console.log('\n[9/28 실제 사고] 몸통 줄에 뚜껑 이름');
{
  const rows = [
    줄('260928-2', '100733', 'BFTANGB00002', 'BFTANGB30002', 'JH/BF 225파이 감자탕 공용 200개---뚜껑만---법인/배민상회', '오은수'),
    줄('260928-2', '100733', 'BFTANGB00002', 'MAJHG0022', 'JH/BF 225파이 감자탕 공용 200개---뚜껑만---법인/배민상회', '오은수'),
    줄('260928-2', '100734', 'BFTANGB00001', 'BFTANGB30001', 'JH/BF 225파이 감자탕 공용 200개---뚜껑만---법인/배민상회', '오은수'),
    줄('260928-2', '100734', 'BFTANGB00001', 'MAJHG0022', 'JH/BF 225파이 감자탕 공용 200개---뚜껑만---법인/배민상회', '오은수'),
    줄('260928-1', '100454', 'FP220TANG0002', 'FP220TANG0015', 'BF 220파이 감자탕 공용 200개---뚜껑만---법인/쿠팡', '신경순'),
    줄('260928-1', '100454', 'FP220TANG0002', 'FP220TANG0020', 'BF 220파이 감자탕 공용 200개---뚜껑만---법인/쿠팡', '신경순'),
  ];
  const r = C.ssAuditSetNames(rows, head);
  eq('세 주문 다 잡는다', r.탈.length, 3);
  eq('  받는분', r.탈.map(x => x.받는분).sort(), ['신경순', '오은수', '오은수']);
  eq('  본 주문 수', r.본주문, 3);
}

console.log('\n[정상] 몸통만·뚜껑만으로 갈린 세트');
{
  const rows = [
    줄('261001-1', '1', 'TYSL00029', 'TYSL00026', 'TY 사출 냉면 중 200개---몸통만---법인/쿠팡'),
    줄('261001-1', '1', 'TYSL00029', 'TYSL00023', 'TY 사출 냉면 중 200개---뚜껑만---법인/쿠팡'),
  ];
  eq('꼬리로 갈리면 정상', C.ssAuditSetNames(rows, head).탈.length, 0);
}

console.log('\n[정상] 안 쪼갠 줄 · 낱개 · 소분');
{
  const rows = [
    줄('261001-1', '2', 'JHN70SAUCE00001', 'JHN70SAUCE00001', 'JH 68파이 특소 화이트 3000 SET'),
    줄('261001-1', '3', 'MADYSS0048-1', 'MADYSS0048-1', 'JH 사각소스컵 (100*5팩) 500개--/소분'),
    줄('261001-1', '3', 'MADYSS0048-1', 'MADYSS0048-1', 'JH 사각소스컵 (100*5팩) 500개--/소분'),
  ];
  const r = C.ssAuditSetNames(rows, head);
  eq('안 쪼갠 줄은 안 본다', r.본주문, 0);
  eq('  탈 없음', r.탈.length, 0);
}

console.log('\n[정상] 같은 구성품이 두 줄 (코드도 같다)');
{
  const rows = [
    줄('261001-1', '4', 'SETX', 'LIDA', '공용 뚜껑'),
    줄('261001-1', '4', 'SETX', 'LIDA', '공용 뚜껑'),
  ];
  eq('코드가 같으면 이름이 같아도 정상', C.ssAuditSetNames(rows, head).탈.length, 0);
}

console.log('\n[범위] 회차를 골라 본다');
{
  const rows = [
    줄('260928-1', '9', 'S1', 'A', '같은 이름'),
    줄('260928-1', '9', 'S1', 'B', '같은 이름'),
    줄('261001-1', '9', 'S1', 'A', '같은 이름'),
    줄('261001-1', '9', 'S1', 'B', '같은 이름'),
  ];
  const r = C.ssAuditSetNames(rows, head, { 회차들: { '261001-1': true } });
  eq('고른 회차만', r.탈.map(x => x.회차키), ['261001-1']);
}

console.log('\n[머리글] 칸이 없으면 «못 봄»이라고 말한다');
{
  const r = C.ssAuditSetNames([], ['회차키', '품목코드']);
  eq('못봄 사유가 있다', /원본품목코드|순번/.test(r.못봄 || ''), true);
}

console.log('');
console.log(fail ? 'FAIL ' + fail + '건' : '통과 ' + pass + '건');
process.exit(fail ? 1 : 0);
