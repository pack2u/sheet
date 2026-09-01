/* 커뮤니티 보드 카드 크기 ↔ 글자 배율 검증 (로컬 검증용)

   요구사항이 비대칭이라 실수하기 쉽다:
     · 기본(150) 이면 배율 1
     · 기본보다 줄이면  → 그래도 1 (글자는 안 줄인다)
     · 기본보다 키우면  → 같이 커진다
   "그냥 v/150" 로 쓰면 축소 구간에서 글자가 같이 작아져 아무도 못 읽는다. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, 'home.html'), 'utf8').split(/\r?\n/);

const a = src.findIndex(l => l.indexOf('function setHbCardSize') !== -1);
const b = src.findIndex((l, i) => i > a && l.indexOf('function initHbCardSize') !== -1);
if (a < 0 || b < 0) { console.error('home.html 에서 setHbCardSize 를 못 찾았습니다'); process.exit(1); }

const props = {};
const el = { style: { setProperty: (k, v) => { props[k] = v; } } };
const lab = { textContent: '' };
const slider = { value: '' };
const ctx = {
  document: { getElementById: id => (id === 'hbList' ? el : id === 'hbSizeVal' ? lab : id === 'hbSize' ? slider : null) },
  localStorage: { setItem: () => {} },
  HB_CARD_W_BASE: 150, HB_CARD_W: 150, HB_SIZE_KEY: 'k',
  Math, String, parseInt, console,
};
vm.createContext(ctx);
vm.runInContext(src.slice(a, b).join('\n'), ctx);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };
const scaleAt = (px) => { ctx.setHbCardSize(px, false); return parseFloat(props['--hb-text-scale']); };
const widthAt = (px) => { ctx.setHbCardSize(px, false); return props['--hb-card-w']; };

console.log('\n[기본 크기]');
ok('150 이면 배율 1', scaleAt(150) === 1);
ok('폭도 150px', widthAt(150) === '150px');

console.log('\n[축소 — 글자는 그대로 둔다]');
ok('130 이어도 배율 1', scaleAt(130) === 1);
ok('최소치 110 이어도 배율 1', scaleAt(110) === 1);
ok('범위 아래(50)로 내려도 배율 1', scaleAt(50) === 1);
ok('축소해도 폭은 실제로 줄어든다', widthAt(110) === '110px');

console.log('\n[확대 — 같이 커진다]');
ok('300 이면 배율 2', scaleAt(300) === 2);
ok('225 면 배율 1.5', scaleAt(225) === 1.5);
ok('최대치 420 이면 배율 2.8', Math.abs(scaleAt(420) - 2.8) < 1e-9);
ok('범위 위(999)는 420 으로 잘리고 배율도 2.8', Math.abs(scaleAt(999) - 2.8) < 1e-9);

console.log('\n[경계]');
ok('151 은 1 보다 아주 조금 크다', scaleAt(151) > 1 && scaleAt(151) < 1.01);
ok('149 는 정확히 1', scaleAt(149) === 1);

console.log('\n[잘못된 입력]');
ok('빈 값이면 기본으로 돌아간다', scaleAt('') === 1 && props['--hb-card-w'] === '150px');
ok('숫자가 아니어도 기본', scaleAt('abc') === 1 && props['--hb-card-w'] === '150px');

console.log('\n[CSS 쪽도 준비돼 있는가]');
const raw = src.join('\n');
ok(':root 에 기본값 1 이 있다', /--hb-text-scale:\s*1\s*;/.test(raw));
ok('카드 글자들이 배율을 쓴다(20곳 이상)',
   (raw.match(/font-size: calc\(\d+px \* var\(--hb-text-scale\)\)/g) || []).length >= 20);

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
