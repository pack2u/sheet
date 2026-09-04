/* csProductLookup.gs 의 코드 조회를 최소 GAS 스텁으로 돌려본다 (로컬 검증용)
   중점: 왕복을 1회로 줄이면서 "먼저 넣은 후보가 이긴다" 는 우선순위가 유지되는가.
   여기가 틀리면 엉뚱한 상품이 조용히 나온다 — 에러도 안 난다. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, 'csProductLookup.gs'), 'utf8');

const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  UrlFetchApp: { fetch: () => { throw new Error('테스트에서 실제 호출 금지'); } },
  SpreadsheetApp: { openById: () => null },
  Logger: { log: () => {} },
  SUPABASE_SERVICE_KEY: 'test-key',
  Date, JSON, String, Math, encodeURIComponent, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

// _cs_sb_get_ 을 가로채 호출 내역을 기록하고 정해진 행을 돌려준다
let calls = [];
let table = [];   // DB 에 있다고 칠 행들
ctx._cs_sb_get_ = function (t, q) {
  calls.push(q);
  if (q.indexOf('ilike') !== -1) {          // fuzzy 질의
    return table.slice(0, 5);
  }
  const m = /ecount_code=in\.\(([^)]*)\)/.exec(q);
  if (!m) return [];
  const want = m[1].split(',').map(s => decodeURIComponent(s).replace(/"/g, ''));
  return table.filter(r => want.indexOf(r.ecount_code) !== -1);
};

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };
const reset = (rows) => { calls = []; table = rows || []; };

console.log('\n[왕복 횟수]');
reset([{ ecount_code: 'AJ00011', item_name: '정상품목' }]);
let r = ctx._cs_sb_productByCode_('AJ00011', 'AJ00011');
ok('찾으면 요청은 1번뿐', calls.length === 1);
ok('맞는 행을 돌려준다', r && r.item_name === '정상품목');
ok('in.() 형태로 묶어 보낸다', calls[0].indexOf('ecount_code=in.(') !== -1);
// 하이픈 없는 코드로 물으면 하이픈 변형까지 후보에 같이 넣는다
ok('값을 큰따옴표로 감쌌다',
   decodeURIComponent(calls[0]).indexOf('in.("AJ00011","AJ-00011")') !== -1);

console.log('\n[중복 후보는 한 번만 넣는다]');
reset([{ ecount_code: 'AJ00011' }]);
ctx._cs_sb_productByCode_('AJ00011', 'AJ00011');
// 원본과 정규화가 같으므로 후보는 원본 + 하이픈 변형 = 2개.
// 중복 제거가 없으면 'AJ00011' 이 두 번 들어가 3개가 된다.
const q0 = decodeURIComponent(calls[0]);
ok('후보는 2개', (q0.match(/"/g) || []).length === 4);
ok('같은 값이 두 번 들어가지 않는다', q0.split('"AJ00011"').length - 1 === 1);

console.log('\n[우선순위 — 먼저 넣은 후보가 이긴다]');
// DB 가 하이픈 버전을 먼저 돌려줘도, 요청한 원본 토큰이 우선이어야 한다
reset([
  { ecount_code: 'AJ-00011', item_name: '하이픈판' },
  { ecount_code: 'AJ00011', item_name: '원본판' },
]);
r = ctx._cs_sb_productByCode_('AJ00011', 'AJ00011');
ok('DB 응답 순서와 무관하게 원본이 이긴다', r && r.item_name === '원본판');

reset([{ ecount_code: 'AJ-00011', item_name: '하이픈판' }]);
r = ctx._cs_sb_productByCode_('AJ00011', 'AJ00011');
ok('원본이 없으면 하이픈 변형으로 찾는다', r && r.item_name === '하이픈판');
ok('그래도 요청은 1번', calls.length === 1);

console.log('\n[못 찾으면 fuzzy 로 넘어간다]');
reset([{ ecount_code: 'ZZ99999', item_name: '엉뚱한것' }]);
r = ctx._cs_sb_productByCode_('AJ00011', 'AJ00011');
ok('in.() 다음에 ilike 를 한 번 더 부른다', calls.length === 2 && calls[1].indexOf('ilike') !== -1);
ok('fuzzy 결과라도 돌려준다', r && r.ecount_code === 'ZZ99999');

reset([]);
r = ctx._cs_sb_productByCode_('AJ00011', 'AJ00011');
ok('아무 데도 없으면 null', r === null);

console.log('\n[빈 입력]');
reset([{ ecount_code: 'AJ00011' }]);
r = ctx._cs_sb_productByCode_('', '');
ok('후보가 없으면 요청조차 하지 않는다', calls.length === 0);
ok('null 을 돌려준다', r === null);

console.log('\n[정규화 규칙은 그대로]');
ok('하이픈은 지운다', ctx._cs_prod_normCode_('AJ-00011') === 'AJ00011');
ok('숫자만이면 코드가 아니다', ctx._cs_prod_normCode_('12345') === '');
ok('너무 짧으면 코드가 아니다', ctx._cs_prod_normCode_('AJ') === '');

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
