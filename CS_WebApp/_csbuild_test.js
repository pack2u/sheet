/* home.html 의 새 배포 감지 모듈 검증 (로컬 검증용)

   ★ 2026-09-01 흰 화면 사고에서 배운 것 두 가지 ★
   이 HTML 은 googleusercontent.com 샌드박스 iframe 안에서 돈다.
     1) location.reload() 는 앱 주소가 아니라 iframe 의 일회성 URL 을 다시
        불러 흰 화면을 남긴다.
     2) JS 로 최상위 프레임을 옮기는 것(top.location)은 막힐 수 있고,
        막히면 폴백이 iframe 안에서 이동해 또 흰 화면이 된다.
   그래서 이동은 <a target="_top"> 에게 맡기고, JS 는 확인만 한다.
   아래 검사는 그 두 가지가 되돌아가지 않는지 지킨다. */
const fs = require('fs'), vm = require('vm');
const path = require('path').join(__dirname, 'home.html');
const raw = fs.readFileSync(path, 'utf8');
const src = raw.split(/\r?\n/);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };

/* ── 1. 마크업 검사 — 진짜 고친 부분이라 JS 만 봐서는 못 잡는다 ── */
console.log('\n[알림 줄 마크업]');
/* 여는 태그를 정규식 한 방으로 잡으려 하면 href 의 <?= webAppUrl ?> 안에 있는
   '>' 에서 잘린다. 그래서 id 가 있는 줄부터 몇 줄을 통째로 본다. */
const barLine = src.findIndex(l => l.indexOf('id="csBuildBar"') !== -1);
const barTag = barLine >= 0 ? src.slice(barLine, barLine + 3).join('\n') : '';
ok('div 가 아니라 <a> 다', /<a\s[^\n]*id="csBuildBar"/.test(barTag));
ok('target="_top" 으로 최상위에 나간다', /target="_top"/.test(barTag));
ok('href 가 앱 주소 템플릿이다', /href="<\?=\s*webAppUrl\s*\?>"/.test(barTag));
ok('클릭 확인을 붙였다', /onclick="return csBuildBarClick\(\)"/.test(barTag));

/* ── 2. 모듈 동작 검사 ── */
const a = src.findIndex(l => l.indexOf('var CS_BUILD_SEEN = null;') !== -1);
const b = src.findIndex(l => l.indexOf('function setPulseBar(which, show, label)') !== -1);
if (a < 0 || b < 0 || b <= a) { console.error('home.html 에서 배포 감지 모듈을 못 찾았습니다'); process.exit(1); }
const body = src.slice(a, b).join('\n');

/* 주석 안의 location.reload() 는 설명이라 괜찮다. 실제 호출만 잡는다 —
   줄 앞머리로 주석을 판별하면 블록 주석 가운데 줄을 놓치므로 통째로 지운다. */
const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok('모듈 안에 살아있는 location.reload() 가 없다', !/location\.reload\(/.test(codeOnly));

const bar = { classList: { s: new Set(), toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); },
                           contains(c) { return this.s.has(c); } } };
let reloads = 0, navs = 0;
const env = { hbStaged: false, confirmAnswer: true };
const ctx = {
  document: { getElementById: id => (id === 'csBuildBar' ? bar : null) },
  // 아래 셋 중 하나라도 불리면 사고다. 이동은 <a> 가 해야 한다.
  location: { reload: () => { reloads++; }, set href(v) { navs++; } },
  csGoTo: () => { navs++; },
  confirm: () => env.confirmAnswer,
  CS_EXEC_URL: 'https://script.google.com/macros/s/TESTDEPLOY/exec',
  hbAttStaged: () => env.hbStaged,
  RET_MODAL_PHOTOS: {}, RET_PHOTO_PEND: {}, LG_PENDING: [],
  String, console,
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(body, ctx);

const reset = () => {
  ctx.CS_BUILD_SEEN = null; ctx.CS_NEW_BUILD = false;
  reloads = 0; navs = 0; bar.classList.s.clear();
  ctx.RET_MODAL_PHOTOS = {}; ctx.RET_PHOTO_PEND = {}; ctx.LG_PENDING = [];
  env.hbStaged = false; env.confirmAnswer = true;
};

console.log('\n[빌드 번호 비교]');
reset();
ctx.csSeeBuild('168');
ok('처음 본 값은 기준일 뿐 새 배포가 아니다', ctx.CS_NEW_BUILD === false);
ctx.csSeeBuild('168');
ok('같은 값은 아무 일 없다', ctx.CS_NEW_BUILD === false);
ctx.csSeeBuild('170');
ok('값이 바뀌면 새 배포로 잡는다', ctx.CS_NEW_BUILD === true);

console.log('\n[자동으로는 절대 이동하지 않는다 — 흰 화면 재발 방지]');
reset(); ctx.csSeeBuild('168'); ctx.csSeeBuild('170');
for (let i = 0; i < 10; i++) ctx.csApplyNewBuild();   // 20초마다 열 번 돌아도
ok('알림 줄은 뜬다', bar.classList.contains('on'));
ok('location.reload() 를 부르지 않는다', reloads === 0);
ok('스스로 페이지를 옮기지도 않는다', navs === 0);

console.log('\n[클릭 확인 — 이동 여부는 반환값으로만 정한다]');
reset();
ok('잃을 게 없으면 true (이동 허용)', ctx.csBuildBarClick() === true);
ok('JS 가 직접 옮기지는 않는다', navs === 0 && reloads === 0);

console.log('\n[못 올린 사진이 있으면 먼저 묻는다]');
const guarded = (name, setup) => {
  reset(); setup(); env.confirmAnswer = false;
  ok(name, ctx.csBuildBarClick() === false);
};
guarded('모달에 붙여둔 사진 → 취소하면 이동 안 함', () => { ctx.RET_MODAL_PHOTOS = { retNew: [{}] }; });
guarded('카드에 붙여둔 사진 → 취소하면 이동 안 함', () => { ctx.RET_PHOTO_PEND = { 3: [{}] }; });
guarded('입고촬영 대기 사진 → 취소하면 이동 안 함', () => { ctx.LG_PENDING = [{}]; });
guarded('전달카드 첨부 → 취소하면 이동 안 함', () => { env.hbStaged = true; });

reset(); ctx.LG_PENDING = [{}]; env.confirmAnswer = true;
ok('확인을 누르면 사진이 있어도 이동 허용', ctx.csBuildBarClick() === true);

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
