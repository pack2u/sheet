/* 폴링 캐시 검증 (로컬 검증용)

   csGetCsPulse 는 20초마다 사람 수만큼 불린다. 그때마다 보드 탭을 통째로
   읽고 있었다. 캐시를 끼웠는데, 여기서 조용히 틀리면 둘 중 하나가 된다:

     · 캐시가 안 먹으면 — 고친 게 없는 것과 같다. 아무도 모른다.
     · 캐시가 너무 먹으면 — 남이 올린 카드가 안 보인다. 이쪽이 더 나쁘다.

   그래서 「언제 읽고 언제 안 읽는가」를 횟수로 세어 못을 박는다.
*/
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };

const srcPulse = fs.readFileSync(path.join(__dirname, 'csPulse.gs'), 'utf8');

/* 시트를 흉내 낸다 — 실제로 몇 번 읽었는지 센다 */
function build() {
  const store = {};
  let reads = 0;
  const ctx = {
    String, Object, Math, JSON, console,
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        put: (k, v) => { store[k] = v; },
        remove: (k) => { delete store[k]; },
      }),
    },
    _cs_ac_guard_: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext(srcPulse, ctx);

  // 비싼 부분만 갈아 끼운다 — 캐시가 이걸 몇 번 부르는지가 핵심이다
  ctx._cs_pulse_board_ = () => { reads++; return { sig: 'B1', active: 3, done: 0 }; };
  ctx._cs_pulse_returns_ = () => ({ sig: 'R1', active: 2 });

  return { ctx, store, reads: () => reads, fail: (on) => {
    ctx._cs_pulse_board_ = () => { reads++; if (on) throw new Error('시트 열림 실패'); return { sig: 'B1' }; };
  } };
}

console.log('\n[시트를 몇 번 읽는가]');
{
  const t = build();
  t.ctx.csGetCsPulse();
  ok('첫 호출은 읽는다', t.reads() === 1);
  t.ctx.csGetCsPulse();
  t.ctx.csGetCsPulse();
  t.ctx.csGetCsPulse();
  ok('그 뒤 세 번은 안 읽는다', t.reads() === 1);
  ok('캐시에서 온 응답임을 표시한다', t.ctx.csGetCsPulse().cached === true);
  ok('내용은 같다', t.ctx.csGetCsPulse().board.sig === 'B1');
  ok('건수도 온다', t.ctx.csGetCsPulse().board.active === 3);
}

console.log('\n[카드를 쓰면 바로 보여야 한다]');
{
  const t = build();
  t.ctx.csGetCsPulse();
  ok('한 번 읽었다', t.reads() === 1);
  t.ctx._cs_pulse_bust_();          // 카드 등록·수정이 부르는 것
  const fresh = t.ctx.csGetCsPulse();
  ok('캐시를 지우면 다시 읽는다', t.reads() === 2);
  ok('지운 직후 응답은 캐시가 아니다', fresh.cached !== true);
  ok('그다음은 다시 캐시', t.ctx.csGetCsPulse().cached === true && t.reads() === 2);
}

console.log('\n[캐시를 건너뛰어야 하는 경우]');
{
  const t = build();
  t.ctx.csGetCsPulse();
  t.ctx.csGetCsPulse({ fresh: true });
  ok('fresh 면 캐시를 무시한다', t.reads() === 2);
}
{
  const t = build();
  t.ctx.csGetCsPulse();
  t.ctx.CS_BUILD_ = '999';          // 재배포
  const r = t.ctx.csGetCsPulse();
  ok('빌드가 바뀌면 캐시를 버린다', t.reads() === 2);
  ok('새 빌드 번호가 나간다', r.build === '999');
}

console.log('\n[실패는 캐시에 담지 않는다]');
{
  const t = build();
  t.fail(true);
  const r1 = t.ctx.csGetCsPulse();
  ok('오류를 담아 돌려준다', r1.errors.length === 1);
  ok('board 는 비어 있다', r1.board === null);
  t.ctx.csGetCsPulse();
  ok('다음 호출은 다시 시도한다', t.reads() === 2);
  t.fail(false);
  t.ctx.csGetCsPulse();
  ok('회복되면 정상 응답', t.ctx.csGetCsPulse().board.sig === 'B1');
}

console.log('\n[권한은 캐시보다 먼저]');
{
  const t = build();
  t.ctx.csGetCsPulse();                                   // 캐시를 채워 둔다
  t.ctx._cs_ac_guard_ = () => ({ ok: false, error: '권한 없음' });
  const r = t.ctx.csGetCsPulse();
  ok('권한이 없으면 캐시된 값을 안 준다', r.ok === false);
  ok('거부 사유가 그대로 나간다', r.error === '권한 없음');
}

console.log('\n[캐시가 없어도 돌아간다]');
{
  const t = build();
  t.ctx.CacheService = { getScriptCache: () => { throw new Error('캐시 못 씀'); } };
  const r = t.ctx.csGetCsPulse();
  ok('예전처럼 매번 읽는다', r.board.sig === 'B1');
  t.ctx.csGetCsPulse();
  ok('터지지 않는다', t.reads() === 2);
}

console.log('\n[설정값]');
{
  const t = build();
  ok('TTL 은 폴링 주기(20초)보다 짧다', t.ctx._CS_PULSE_CACHE_SEC_ < 20);
  ok('TTL 이 0 은 아니다', t.ctx._CS_PULSE_CACHE_SEC_ >= 5);
}

/* 쓰는 쪽이 실제로 캐시를 지우는지 */
console.log('\n[쓰기 경로 배선]');
{
  const board = fs.readFileSync(path.join(__dirname, 'csHandoffBoard.gs'), 'utf8');
  ok('카드 수정 뒤 지운다', board.indexOf('if (res && res.ok) { try { _cs_pulse_bust_(); } catch (eP) {} }') !== -1);
  ok('카드 등록 뒤 지운다', board.indexOf('try { _cs_pulse_bust_(); } catch (eP) {}\r\n    return { ok: true, id: id') !== -1 ||
    /_cs_pulse_bust_\(\);[\s\S]{0,40}return \{ ok: true, id: id/.test(board));
  ok('무효화가 실패해도 쓰기는 성공한다', /try \{ _cs_pulse_bust_\(\); \} catch/.test(board));
}

console.log('\n' + (fail ? `실패 ${fail}건 / 통과 ${pass}건` : `모두 통과 (${pass}건)`));
process.exit(fail ? 1 : 0);
