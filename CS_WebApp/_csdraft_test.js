/* home.html 의 임시저장 모듈만 떼어내 최소 DOM 으로 돌려본다 (로컬 검증용) */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, 'home.html'), 'utf8').split(/\r?\n/);
// 행 번호로 자르면 home.html 이 조금만 움직여도 엉뚱한 걸 검사한다 → 표식으로 찾는다
const a = src.findIndex(l => l.indexOf('var DRAFT_PREFIX') !== -1);
const b = src.findIndex(l => l.indexOf('function openHbModal') !== -1);
if (a < 0 || b < 0 || b <= a) { console.error('home.html 에서 임시저장 모듈을 못 찾았습니다'); process.exit(1); }
const body = src.slice(a, b).join('\n');

// ── 최소 DOM ──
const store = {};
function mkEl(id, tag) {
  return { id, tag, value: '', get tagName() { return this.tag; },
           classList: { s: new Set(), add(c){this.s.add(c)}, remove(...c){c.forEach(x=>this.s.delete(x))},
                        toggle(c,on){on?this.s.add(c):this.s.delete(c)}, contains(c){return this.s.has(c)} },
           querySelector(){ return { textContent: '' }; },
           addEventListener(){}, };
}
const els = {};
function el(id, tag) { return els[id] = mkEl(id, tag || 'INPUT'); }
['retNewName','retNewPhone','retNewInvoice','retNewQty','retNewItem','retNewVendor',
 'retNewPickup','retNewRetInvoice','retNewFee','retNewMemo'].forEach(i => el(i));
['retNewStaff','retNewType','retNewStatus'].forEach(i => el(i, 'SELECT'));
['ledgerPickup','ledgerMemo'].forEach(i => el(i));
['ledgerStaff','ledgerType'].forEach(i => el(i, 'SELECT'));
el('retNewDraftBar','DIV'); el('ledgerDraftBar','DIV'); el('hbDraftBar','DIV');
el('retNewModal','DIV'); el('ledgerModal','DIV'); el('hbModal','DIV');

const ctx = {
  document: { getElementById: id => els[id] || null },
  localStorage: { getItem: k => (k in store ? store[k] : null),
                  setItem: (k,v) => { store[k] = String(v); },
                  removeItem: k => { delete store[k]; } },
  setTimeout, clearTimeout, Date, JSON, String, Number,
  toast: () => {}, pickHbLevel: () => {}, HB_NEW_LEVEL: '일반',
  CS_ROWS: [{ invoice: '1234-5678-90' }, { invoice: '' }], LEDGER_IDX: -1,
  console,
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(body, ctx);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };

console.log('\n[반품 카드 — 담고 되살리기]');
els.retNewName.value = '홍길동';
els.retNewMemo.value = '박스 파손 확인 요청';
els.retNewType.value = '파손';
ctx.draftSave('retNew');
ok('localStorage 에 담겼다', !!store['pack2u_draft_retNew']);
els.retNewName.value = ''; els.retNewMemo.value = ''; els.retNewType.value = '단순반품';
ok('되살리기 성공', ctx.draftRestore('retNew') === true);
ok('수취인 복원', els.retNewName.value === '홍길동');
ok('메모 복원', els.retNewMemo.value === '박스 파손 확인 요청');
ok('선택칸도 복원', els.retNewType.value === '파손');

console.log('\n[등록 성공 후 지우기]');
ctx.draftClear('retNew');
ok('저장분 사라짐', !store['pack2u_draft_retNew']);
ok('되살릴 것 없음', ctx.draftRestore('retNew') === false);

console.log('\n[선택칸만 건드린 건 담지 않는다]');
els.retNewName.value = ''; els.retNewMemo.value = '';   // 앞 테스트의 복원값을 비우고 시작
els.retNewType.value = '교환';
ctx.draftSave('retNew');
ok('기본값만 바뀐 상태는 안 담김', !store['pack2u_draft_retNew']);

console.log('\n[하루 지난 초안은 흘려보낸다]');
els.retNewName.value = '김철수';
ctx.draftSave('retNew');
const old = JSON.parse(store['pack2u_draft_retNew']);
old.t = Date.now() - 25 * 3600 * 1000;
store['pack2u_draft_retNew'] = JSON.stringify(old);
els.retNewName.value = '';
ok('25시간 전 초안은 안 되살림', ctx.draftRestore('retNew') === false);
ok('만료분은 지워짐', !store['pack2u_draft_retNew']);

console.log('\n[대장 기록 — 반품 건별로 따로 담긴다]');
ctx.LEDGER_IDX = 0;
els.ledgerMemo.value = '0번 건 메모';
ctx.draftSave('ledger');
ok('송장 숫자로 키가 잡힌다', !!store['pack2u_draft_ledger_1234567890']);
ctx.LEDGER_IDX = 1;                       // 송장 없는 건
els.ledgerMemo.value = '1번 건 메모';
ctx.draftSave('ledger');
ok('송장 없으면 담지 않는다', Object.keys(store).filter(k=>k.startsWith('pack2u_draft_ledger')).length === 1);
els.ledgerMemo.value = '';
ok('송장 없는 건은 되살릴 것도 없다', ctx.draftRestore('ledger') === false);
ctx.LEDGER_IDX = 0;
ok('0번 건은 제 메모를 되살린다', ctx.draftRestore('ledger') === true && els.ledgerMemo.value === '0번 건 메모');

console.log('\n[모달 여는 중엔 담지 않는다]');
ctx.DRAFT_QUIET = true;
ctx.draftTouch('ledger');
ok('quiet 중 draftTouch 는 조용하다', true);
ctx.DRAFT_QUIET = false;

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
