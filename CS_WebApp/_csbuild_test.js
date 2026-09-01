/* home.html 의 새 배포 감지 모듈만 떼어내 최소 DOM 으로 돌려본다 (로컬 검증용)
   중요한 건 "언제 새로고침하지 않는가" 다. 그쪽을 집중적으로 본다. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, 'home.html'), 'utf8').split(/\r?\n/);
const a = src.findIndex(l => l.indexOf('var CS_BUILD_SEEN = null;') !== -1);
const b = src.findIndex(l => l.indexOf('function setPulseBar(which, show, label)') !== -1);
if (a < 0 || b < 0 || b <= a) { console.error('home.html 에서 배포 감지 모듈을 못 찾았습니다'); process.exit(1); }
const body = src.slice(a, b).join('\n');

// ── 최소 DOM · 주변 함수 스텁 ──
const bar = { classList: { s: new Set(), toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); },
                           contains(c) { return this.s.has(c); } } };
let reloads = 0;
const env = {
  modalOpen: false, focused: null, hbStaged: false, boardBusy: false, retBusy: false,
  confirmAnswer: true,
};
const ctx = {
  document: {
    getElementById: id => (id === 'csBuildBar' ? bar : null),
    get activeElement() { return env.focused ? { tagName: env.focused } : null; },
  },
  location: { reload: () => { reloads++; } },
  confirm: () => env.confirmAnswer,
  csAnyModalOpen: () => env.modalOpen,
  hbAttStaged: () => env.hbStaged,
  csBoardBusy: () => env.boardBusy,
  csRetBusy: () => env.retBusy,
  RET_MODAL_PHOTOS: {}, RET_PHOTO_PEND: {}, LG_PENDING: [],
  String, console,
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(body, ctx);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };
const reset = () => {
  ctx.CS_BUILD_SEEN = null; ctx.CS_NEW_BUILD = false; ctx.CS_BUILD_NOTICED = false;
  reloads = 0; bar.classList.s.clear();
  ctx.RET_MODAL_PHOTOS = {}; ctx.RET_PHOTO_PEND = {}; ctx.LG_PENDING = [];
  env.modalOpen = env.hbStaged = env.boardBusy = env.retBusy = false;
  env.focused = null; env.confirmAnswer = true;
};

console.log('\n[빌드 번호 비교]');
reset();
ctx.csSeeBuild('163');
ok('처음 본 값은 기준일 뿐 새 배포가 아니다', ctx.CS_NEW_BUILD === false);
ctx.csSeeBuild('163');
ok('같은 값은 아무 일 없다', ctx.CS_NEW_BUILD === false);
ctx.csSeeBuild('164');
ok('값이 바뀌면 새 배포로 잡는다', ctx.CS_NEW_BUILD === true);

console.log('\n[한 틱은 알림만 — 예고 없이 화면이 튀지 않게]');
ctx.csApplyNewBuild();
ok('알림 줄이 뜬다', bar.classList.contains('on'));
ok('첫 틱엔 새로고침하지 않는다', reloads === 0);
ctx.csApplyNewBuild();
ok('다음 틱에 새로고침한다', reloads === 1);

console.log('\n[잃을 게 있으면 새로고침하지 않는다]');
const blocked = (name, setup) => {
  reset(); ctx.csSeeBuild('163'); ctx.csSeeBuild('164');
  setup();
  ctx.csApplyNewBuild(); ctx.csApplyNewBuild();   // 예고 틱까지 지나가게 두 번
  ok(name, reloads === 0 && bar.classList.contains('on'));
};
blocked('모달이 열려 있으면 미룬다', () => { env.modalOpen = true; });
blocked('입력칸에 커서가 있으면 미룬다', () => { env.focused = 'TEXTAREA'; });
blocked('선택칸에 커서가 있어도 미룬다', () => { env.focused = 'SELECT'; });
blocked('모달에 붙여둔 사진이 있으면 미룬다', () => { ctx.RET_MODAL_PHOTOS = { retNew: [{}] }; });
blocked('카드에 붙여둔 사진이 있으면 미룬다', () => { ctx.RET_PHOTO_PEND = { 3: [{}] }; });
blocked('입고촬영 대기 사진이 있으면 미룬다', () => { ctx.LG_PENDING = [{}]; });
blocked('전달카드 첨부가 있으면 미룬다', () => { env.hbStaged = true; });
blocked('보드를 쓰는 중이면 미룬다', () => { env.boardBusy = true; });
blocked('반품을 쓰는 중이면 미룬다', () => { env.retBusy = true; });

console.log('\n[막던 게 풀리면 그 다음 틱에 반영된다]');
reset(); ctx.csSeeBuild('163'); ctx.csSeeBuild('164');
env.modalOpen = true;
ctx.csApplyNewBuild(); ctx.csApplyNewBuild();
ok('모달 열려 있는 동안은 그대로', reloads === 0);
env.modalOpen = false;
ctx.csApplyNewBuild();
ok('닫으면 새로고침한다', reloads === 1);

console.log('\n[알림 줄을 직접 눌렀을 때]');
reset();
ctx.csForceReload();
ok('잃을 게 없으면 바로 새로고침', reloads === 1);
reset(); ctx.LG_PENDING = [{}]; env.confirmAnswer = false;
ctx.csForceReload();
ok('사진이 있는데 취소하면 새로고침 안 함', reloads === 0);
reset(); ctx.LG_PENDING = [{}]; env.confirmAnswer = true;
ctx.csForceReload();
ok('사진이 있어도 확인하면 새로고침', reloads === 1);

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
