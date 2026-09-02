/* 커뮤니티 보드 「묵은 카드」 표시 검증 (로컬 검증용)

   조용히 틀리기 쉬운 곳이라 못을 박아 둔다:
     · 시각 문자열을 못 읽으면 -1 을 줘야 한다. NaN 이 나오면 비교가 모두
       false 가 되어 아무것도 안 깜박이거나, 반대로 전부 깜박인다.
     · 완료된 카드는 아무리 묵어도 깜박이지 않는다. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, 'home.html'), 'utf8').split(/\r?\n/);
const a = src.findIndex(l => l.indexOf('var HB_STALE_HOURS = 5;') !== -1);
const b = src.findIndex((l, i) => i > a && l.indexOf('function hbShortAt(at)') !== -1);
if (a < 0 || b < 0) { console.error('home.html 에서 묵은카드 모듈을 못 찾았습니다'); process.exit(1); }

// 지금 시각을 고정해 테스트가 시계에 흔들리지 않게 한다
const NOW = new Date(2026, 8, 2, 15, 0, 0);          // 2026-09-02 15:00
const cards = [];
const mkCard = (at, done) => ({
  _at: at,
  classList: {
    s: new Set(done ? ['hb-card', 'hb-done'] : ['hb-card']),
    contains(c) { return this.s.has(c); },
    toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); },
  },
  getAttribute(k) { return k === 'data-at' ? this._at : null; },
});
const ctx = {
  document: { querySelectorAll: () => cards },
  setInterval: () => {},
  Date: class extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } },
  String, isFinite, console,
};
vm.createContext(ctx);
vm.runInContext(src.slice(a, b).join('\n'), ctx);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };
const near = (v, want) => Math.abs(v - want) < 0.02;

console.log('\n[경과 시간 계산]');
ok('1시간 전', near(ctx.hbAgeHours('2026-09-02 14:00'), 1));
ok('5시간 전 정확히', near(ctx.hbAgeHours('2026-09-02 10:00'), 5));
ok('하루 전', near(ctx.hbAgeHours('2026-09-01 15:00'), 24));
ok('한 자리 시각도 읽는다', near(ctx.hbAgeHours('2026-09-02 9:00'), 6));
ok('T 구분자도 읽는다', near(ctx.hbAgeHours('2026-09-02T14:00'), 1));

console.log('\n[못 읽는 값은 -1]');
ok('빈 문자열', ctx.hbAgeHours('') === -1);
ok('null', ctx.hbAgeHours(null) === -1);
ok('두 자리 연도(전달내역 형식)', ctx.hbAgeHours('26-09-02 14:00') === -1);
ok('말이 안 되는 값', ctx.hbAgeHours('언젠가') === -1);
ok('-1 은 5보다 작다 → 깜박이지 않는다', ctx.hbAgeHours('') < ctx.HB_STALE_HOURS);

console.log('\n[깜박임 판정]');
const run = (list) => {
  cards.length = 0;
  list.forEach(c => cards.push(mkCard(c[0], c[1])));
  ctx.hbRefreshStale();
  return cards.map(c => c.classList.contains('hb-stale'));
};
ok('5시간 지난 미완료 → 깜박임', run([['2026-09-02 09:59', false]])[0] === true);
ok('5시간 정확히 → 깜박임', run([['2026-09-02 10:00', false]])[0] === true);
ok('4시간 59분 → 아직 아님', run([['2026-09-02 10:01', false]])[0] === false);
ok('완료된 카드는 이틀이 지나도 조용하다', run([['2026-08-31 09:00', true]])[0] === false);
ok('시각을 못 읽으면 조용하다', run([['', false]])[0] === false);

console.log('\n[다시 계산하면 상태가 뒤집힌다]');
cards.length = 0;
const c1 = mkCard('2026-09-02 09:00', false);   // 6시간 전
cards.push(c1);
ctx.hbRefreshStale();
ok('처음엔 깜박임', c1.classList.contains('hb-stale'));
c1._at = '2026-09-02 14:30';                    // 카드가 갱신돼 시각이 최근으로 바뀌면
ctx.hbRefreshStale();
ok('조건이 풀리면 꺼진다', !c1.classList.contains('hb-stale'));

console.log('\n[CSS 쪽 준비]');
const raw = src.join('\n');
ok('깜박임 애니메이션이 있다', /@keyframes hbStaleGlow/.test(raw));
ok('펼친 카드는 깜박이지 않는다', /\.hb-card\.hb-stale:not\(\.open\)/.test(raw));
ok('모션 끄기 설정을 존중한다',
   /prefers-reduced-motion[\s\S]{0,220}hb-stale[\s\S]{0,120}animation:\s*none/.test(raw));
ok('카드에 data-at 을 심는다', /data-at="'\s*\+\s*esc\(c\.at\)/.test(raw));

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
