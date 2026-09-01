/* home.html 의 새 배포 감지 모듈만 떼어내 최소 DOM 으로 돌려본다 (로컬 검증용)

   ★ 2026-09-01 흰 화면 사고 이후로 이 테스트의 핵심은 하나다:
     "자동으로는 절대 이동하지 않는다."
   GAS 웹앱은 googleusercontent.com 샌드박스 iframe 안에서 돈다.
   location.reload() 는 iframe 의 일회성 URL 을 다시 불러 흰 화면을 남기고,
   최상위 프레임 이동(csGoTo)은 사용자 조작 없이는 브라우저가 막는다.
   그래서 알림 줄을 띄우는 것까지가 자동이 할 수 있는 전부다. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, 'home.html'), 'utf8').split(/\r?\n/);
const a = src.findIndex(l => l.indexOf('var CS_BUILD_SEEN = null;') !== -1);
const b = src.findIndex(l => l.indexOf('function setPulseBar(which, show, label)') !== -1);
if (a < 0 || b < 0 || b <= a) { console.error('home.html 에서 배포 감지 모듈을 못 찾았습니다'); process.exit(1); }
const body = src.slice(a, b).join('\n');

const bar = { classList: { s: new Set(), toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); },
                           contains(c) { return this.s.has(c); } } };
let goneTo = [];        // csGoTo 로 실제 이동한 주소
let reloads = 0;        // location.reload() — 절대 불려선 안 된다
const env = { hbStaged: false, confirmAnswer: true };
const ctx = {
  document: { getElementById: id => (id === 'csBuildBar' ? bar : null) },
  location: { reload: () => { reloads++; } },
  confirm: () => env.confirmAnswer,
  csGoTo: (u) => { goneTo.push(u); },
  CS_EXEC_URL: 'https://script.google.com/macros/s/TESTDEPLOY/exec',
  hbAttStaged: () => env.hbStaged,
  RET_MODAL_PHOTOS: {}, RET_PHOTO_PEND: {}, LG_PENDING: [],
  String, console,
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(body, ctx);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };
const reset = () => {
  ctx.CS_BUILD_SEEN = null; ctx.CS_NEW_BUILD = false;
  goneTo = []; reloads = 0; bar.classList.s.clear();
  ctx.RET_MODAL_PHOTOS = {}; ctx.RET_PHOTO_PEND = {}; ctx.LG_PENDING = [];
  env.hbStaged = false; env.confirmAnswer = true;
};

console.log('\n[빌드 번호 비교]');
reset();
ctx.csSeeBuild('167');
ok('처음 본 값은 기준일 뿐 새 배포가 아니다', ctx.CS_NEW_BUILD === false);
ctx.csSeeBuild('167');
ok('같은 값은 아무 일 없다', ctx.CS_NEW_BUILD === false);
ctx.csSeeBuild('168');
ok('값이 바뀌면 새 배포로 잡는다', ctx.CS_NEW_BUILD === true);

console.log('\n[자동으로는 절대 이동하지 않는다 — 흰 화면 사고 재발 방지]');
reset(); ctx.csSeeBuild('167'); ctx.csSeeBuild('168');
for (let i = 0; i < 10; i++) ctx.csApplyNewBuild();   // 20초마다 열 번 돌아도
ok('알림 줄은 뜬다', bar.classList.contains('on'));
ok('location.reload() 를 부르지 않는다', reloads === 0);
ok('자동으로 페이지를 옮기지도 않는다', goneTo.length === 0);

console.log('\n[사람이 눌렀을 때만 이동한다]');
reset();
ctx.csForceReload();
ok('최상위 프레임을 옮긴다 (csGoTo)', goneTo.length === 1);
ok('앱 주소(/exec)로 보낸다', goneTo[0] === ctx.CS_EXEC_URL);
ok('iframe 을 reload 하지 않는다', reloads === 0);

console.log('\n[못 올린 사진이 있으면 먼저 묻는다]');
const guarded = (name, setup) => {
  reset(); setup(); env.confirmAnswer = false;
  ctx.csForceReload();
  ok(name, goneTo.length === 0);
};
guarded('모달에 붙여둔 사진', () => { ctx.RET_MODAL_PHOTOS = { retNew: [{}] }; });
guarded('카드에 붙여둔 사진', () => { ctx.RET_PHOTO_PEND = { 3: [{}] }; });
guarded('입고촬영 대기 사진', () => { ctx.LG_PENDING = [{}]; });
guarded('전달카드 첨부', () => { env.hbStaged = true; });

reset(); ctx.LG_PENDING = [{}]; env.confirmAnswer = true;
ctx.csForceReload();
ok('확인을 누르면 사진이 있어도 이동한다', goneTo.length === 1);

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
