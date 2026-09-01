/* csFavorites.gs 를 최소 GAS 스텁으로 돌려본다 (로컬 검증용)
   중점: 깨진 설정이 들어와도 바가 통째로 죽지 않는가, 이상한 URL 을 걸러내는가 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, 'csFavorites.gs'), 'utf8');

let prop = null;
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => prop }) },
  Logger: { log: () => {} },
  _cs_ac_guard_: () => null,          // 통과한 사용자
  JSON, String, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };
const names = () => ctx.csGetFavorites().items.map(i => i.name);
const DEF = ctx._CS_FAV_DEFAULT_.length;   // 기본 목록이 늘어도 테스트가 안 깨지게

console.log('\n[속성이 없으면 코드 기본 목록]');
prop = null;
ok('기본 목록이 통째로 나온다', ctx.csGetFavorites().items.length === DEF);
ok('전부 https 링크', ctx.csGetFavorites().items.every(i => i.url.indexOf('https://') === 0));
ok('출처를 코드 기본이라고 말한다', ctx._cs_fav_list_().from.indexOf('코드 기본') === 0);

console.log('\n[속성이 있으면 그쪽이 이긴다]');
prop = JSON.stringify([{ icon: '📦', name: '사방넷', url: 'https://sabangnet.example/' }]);
ok('속성 목록으로 바뀐다', names().join() === '사방넷');
ok('출처를 속성이라고 말한다', ctx._cs_fav_list_().from.indexOf('스크립트 속성') === 0);

console.log('\n[깨진 설정이 바를 죽이지 않는다]');
prop = '{이건 JSON 이 아니다';
ok('JSON 이 깨지면 기본 목록으로 돌아간다', ctx.csGetFavorites().items.length === DEF);
ok('출처에 깨졌다고 적어 준다', ctx._cs_fav_list_().from.indexOf('깨졌음') !== -1);
prop = '[]';
ok('빈 배열도 기본 목록으로 돌아간다', ctx.csGetFavorites().items.length === DEF);

console.log('\n[쓸 수 없는 항목은 걸러낸다]');
prop = JSON.stringify([
  { icon: '✅', name: '정상', url: 'https://ok.example/' },
  { icon: '💀', name: '스크립트', url: 'javascript:alert(1)' },
  { icon: '💀', name: '데이터', url: 'data:text/html,<script>' },
  { icon: '💀', name: '주소없음' },
  { icon: '💀', name: '상대경로', url: '/somewhere' },
]);
ok('javascript: 는 버린다', names().indexOf('스크립트') === -1);
ok('data: 는 버린다', names().indexOf('데이터') === -1);
ok('url 없는 항목은 버린다', names().indexOf('주소없음') === -1);
ok('상대경로는 버린다', names().indexOf('상대경로') === -1);
ok('정상 항목만 남는다', names().join() === '정상');

console.log('\n[모자란 값은 채워 준다]');
prop = JSON.stringify([{ url: 'https://noname.example/' }]);
const one = ctx.csGetFavorites().items[0];
ok('이름이 없으면 주소를 이름으로 쓴다', one.name === 'https://noname.example/');
ok('아이콘이 없으면 기본 아이콘', one.icon === '🔗');

console.log('\n[접근 권한이 없으면 목록을 주지 않는다]');
ctx._cs_ac_guard_ = () => ({ ok: false, denied: true, error: '차단' });
ok('가드 결과를 그대로 돌려준다', ctx.csGetFavorites().denied === true);
ctx._cs_ac_guard_ = () => null;

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
