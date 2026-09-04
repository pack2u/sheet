/* 커뮤니티 보드 「지목」 검증 (로컬 검증용)

   지목한 사람 화면에서만 카드가 빨갛게 깜박여야 한다.
   조용히 틀리면 티가 안 나는 곳들이라 못을 박아 둔다:

     · 지목 열은 반드시 **맨 뒤**여야 한다. 중간에 끼우면 협력업체 포털
       (prpBoard.gs)이 헤더명으로 찾는 열 위치가 밀린다.
     · 남의 화면에서 깜박이면 안 된다. 전원이 깜박이면 지목의 뜻이 사라진다.
     · 읽은 뒤에는 멈춰야 한다. 안 멈추면 곧 아무도 안 본다.
     · 지목과 「묵은 카드」가 같이 깜박이면 두 색이 겹쳐 둘 다 안 읽힌다.
*/
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = __dirname;

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };

/* ── 서버: csHandoffBoard.gs ── */
const gsSrc = fs.readFileSync(path.join(DIR, 'csHandoffBoard.gs'), 'utf8');
const gs = { String, Object, Math, Date, JSON, console, isFinite };
vm.createContext(gs);
vm.runInContext(gsSrc, gs);

console.log('\n[열 배치]');
const H = gs._CS_HB_HEADERS_, C = gs._CS_HB_COL_;
ok('지목 열이 존재한다', H.indexOf('지목') !== -1);
ok('지목이 맨 뒤다 (포털 열 밀림 방지)', H[H.length - 1] === '지목');
ok('mention 번호가 헤더 위치와 같다', C.mention === H.indexOf('지목'));
ok('기존 열 번호가 안 밀렸다', C.item === 17 && C.read === 8 && C.custName === 14);

console.log('\n[이름 목록 파싱 — 지목/읽음 공용]');
const RL = gs._cs_hb_readList_;
ok('배열을 그대로 받는다', RL(['김진수', '고윤서']).join('|') === '김진수|고윤서');
ok('빈 배열', RL([]).length === 0);
ok('쉼표 문자열', RL('김진수, 고윤서').join('|') === '김진수|고윤서');
ok('공백만 있는 칸은 버린다', RL(['김진수', '  ', '']).join('|') === '김진수');
ok('중복은 한 번만', RL(['김진수', '김진수']).join('|') === '김진수');
ok('null 은 빈 목록', RL(null).length === 0);
ok('undefined 는 빈 목록', RL(undefined).length === 0);

console.log('\n[행 → 카드]');
const row = [];
row[C.id] = 'HB260904120000'; row[C.at] = '2026-09-04 12:00';
row[C.author] = '박상식'; row[C.level] = '주의'; row[C.title] = '테스트';
row[C.read] = '박상식'; row[C.status] = '진행';
row[C.mention] = '김진수, 고윤서';
const card = gs._cs_hb_rowToCard_(row, 2);
ok('to 가 카드에 실린다', card.to.join('|') === '김진수|고윤서');
ok('지목이 비면 빈 배열', gs._cs_hb_rowToCard_([], 2).to.length === 0);

/* ── 화면: home.html 의 hbCardHtml ── */
const src = fs.readFileSync(path.join(DIR, 'home.html'), 'utf8').split(/\r?\n/);
const a = src.findIndex(l => l.indexOf('function hbCardHtml(c, me)') !== -1);
if (a < 0) { console.error('home.html 에서 hbCardHtml 을 못 찾았습니다'); process.exit(1); }
// 함수 끝을 중괄호로 센다 — 뒤에 다른 코드가 딸려 오면 vm 에서 터진다
let depth = 0, b = -1;
for (let i = a; i < src.length; i++) {
  for (const ch of src[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  if (depth === 0 && i > a) { b = i + 1; break; }
}
if (b < 0) { console.error('hbCardHtml 의 끝을 못 찾았습니다'); process.exit(1); }

const ui = {
  HB_OPEN_ID: null,
  HB_STALE_HOURS: 5,
  hbLevelCls: () => 'lv-normal',
  hbIsNotice: (c) => c.level === '공지',
  hbAgeHours: () => 1,                       // 항상 갓 올라온 카드로 둔다
  hbShortAt: (x) => String(x || ''),
  esc: (x) => String(x == null ? '' : x),
  js: (x) => String(x == null ? '' : x),
  hbTimeline: () => '',
  HB_STAFF: ['김진수', '고윤서', '박상식'],
  HB_LEVELS: ['공지', '긴급', '주의', '일반'],
  hbLevelName: (x) => String(x),
  String, Math, Date, console,
};
vm.createContext(ui);
vm.runInContext(src.slice(a, b).join('\n'), ui);

const mk = (over) => Object.assign({
  id: 'HB1', at: '2026-09-04 12:00', author: '박상식', level: '일반',
  title: '제목', body: '', read: [], to: [], notes: [], done: false,
}, over || {});
const blinks = (c, me) => ui.hbCardHtml(c, me).indexOf('hb-ping') !== -1;

console.log('\n[깜박임 — 지목된 사람만]');
ok('지목된 본인 → 깜박임', blinks(mk({ to: ['김진수'] }), '김진수'));
ok('지목 안 된 사람 → 안 깜박임', !blinks(mk({ to: ['김진수'] }), '고윤서'));
ok('여러 명 중 하나여도 깜박임', blinks(mk({ to: ['김진수', '고윤서'] }), '고윤서'));
ok('아무도 지목 안 함 → 안 깜박임', !blinks(mk(), '김진수'));
ok('이름을 모르면 안 깜박임', !blinks(mk({ to: ['김진수'] }), ''));

console.log('\n[읽으면 멈춘다]');
ok('읽은 뒤 → 멈춤', !blinks(mk({ to: ['김진수'], read: ['김진수'] }), '김진수'));
ok('남이 읽은 것은 상관없다', blinks(mk({ to: ['김진수'], read: ['고윤서'] }), '김진수'));
ok('완료된 카드는 안 깜박임', !blinks(mk({ to: ['김진수'], done: true }), '김진수'));

console.log('\n[묵은 카드와 겹치지 않는다]');
ui.hbAgeHours = () => 99;                    // 아주 묵은 카드로 바꾼다
const both = ui.hbCardHtml(mk({ to: ['김진수'] }), '김진수');
ok('지목이 있으면 hb-ping 만', both.indexOf('hb-ping') !== -1 && both.indexOf('hb-stale') === -1);
const onlyStale = ui.hbCardHtml(mk(), '김진수');
ok('지목이 없으면 hb-stale', onlyStale.indexOf('hb-stale') !== -1);
ui.hbAgeHours = () => 1;

console.log('\n[지목 배지는 모두에게 보인다]');
const mine = ui.hbCardHtml(mk({ to: ['김진수'] }), '김진수');
const other = ui.hbCardHtml(mk({ to: ['김진수'] }), '고윤서');
ok('본인 화면에 배지', mine.indexOf('hb-to') !== -1);
ok('남의 화면에도 배지', other.indexOf('hb-to') !== -1);
ok('본인 배지만 me 로 강조', mine.indexOf('hb-to me') !== -1 && other.indexOf('hb-to me') === -1);
ok('지목이 없으면 배지도 없다', ui.hbCardHtml(mk(), '김진수').indexOf('hb-to') === -1);

/* ── 작성 모달: 지목 고르기 ── */
const c1 = src.findIndex(l => l.indexOf('function hbToList()') !== -1);
const c2 = src.findIndex((l, i) => i > c1 && l.indexOf("var HB_MODAL_BOARD = 'cs'") !== -1);
if (c1 < 0 || c2 < 0) { console.error('home.html 에서 지목 칩 함수를 못 찾았습니다'); process.exit(1); }

const hidden = { value: '' };
const pick = {
  document: { getElementById: (id) => (id === 'hbToVal' ? hidden : null) },
  String, console,
};
vm.createContext(pick);
vm.runInContext(src.slice(c1, c2).join('\n'), pick);

console.log('\n[모달 — 고른 이름 담기]');
hidden.value = '';
ok('비었으면 빈 목록', pick.hbToList().length === 0);
hidden.value = '김진수, 고윤서';
ok('쉼표로 읽는다', pick.hbToList().join('|') === '김진수|고윤서');
hidden.value = ' 김진수 ,, 고윤서 ,';
ok('공백·빈칸을 걸러낸다', pick.hbToList().join('|') === '김진수|고윤서');

/* ── 임시저장 ── */
console.log('\n[임시저장]');
const whole = src.join('\n');
ok('hbToVal 이 임시저장 대상에 있다', /fields:\s*\[[^\]]*'hbToVal'/.test(whole));
ok('모달을 열 때 지목을 비운다', /'hbItem',\s*'hbToVal'\]\.forEach/.test(whole));
ok('되살린 뒤에 칩을 그린다',
  whole.indexOf("draftRestore('hb')") < whole.indexOf('hbToRender();'));
ok('등록할 때 to 를 보낸다', /to:\s*hbToList\(\),/.test(whole));

/* ── 이미 올라간 카드에 지목 걸기 ── */
// 시트를 흉내 낸다. withCard 는 잠금·탭조회까지 하므로 통째로 바꿔 끼운다.
function mkTab(rowArr) {
  const w = {};
  return {
    _row: rowArr, _w: w,
    getRange(r, c) { return { setValue(v) { w[c - 1] = v; } }; },
  };
}
gs._cs_ac_guard_ = () => null;
gs._cs_hb_now_ = () => '26-09-04 16:00';
let TAB = null;
gs._cs_hb_withCard_ = (ref, fn) => fn(TAB, 2, TAB._row);

function setMention(before, read, to) {
  const r = [];
  r[C.id] = 'HB1'; r[C.notes] = '';
  r[C.mention] = before; r[C.read] = read;
  TAB = mkTab(r);
  return gs.csSetHandoffMention({ id: 'HB1', to: to, staff: '박상식' });
}

console.log('\n[카드에 지목 걸기]');
let res = setMention('', '고윤서', ['김진수']);
ok('지목이 저장된다', TAB._w[C.mention] === '김진수');
ok('to 를 돌려준다', res.to.join('|') === '김진수');
ok('진행 과정에 남는다', String(TAB._w[C.notes] || '').indexOf('지목: 김진수') !== -1);

res = setMention('김진수', '김진수, 고윤서', ['김진수', '박상식']);
ok('원래 지목된 사람의 읽음은 그대로', String(TAB._w[C.read] === undefined ? '김진수, 고윤서' : TAB._w[C.read]).indexOf('김진수') !== -1);

console.log('\n[이미 읽은 사람을 새로 지목하면 다시 깜박여야 한다]');
res = setMention('', '김진수, 고윤서', ['김진수']);
ok('새로 지목된 사람은 읽음에서 빠진다', TAB._w[C.read] === '고윤서');
ok('돌려주는 read 도 같다', res.read.join('|') === '고윤서');
ok('지목 안 된 사람은 읽음 유지', res.read.indexOf('고윤서') !== -1);

console.log('\n[지목 해제]');
res = setMention('김진수', '고윤서', []);
ok('빈 값으로 지운다', TAB._w[C.mention] === '');
ok('해제도 진행 과정에 남는다', String(TAB._w[C.notes] || '').indexOf('지목 해제') !== -1);
ok('해제 때는 읽음을 안 건드린다', TAB._w[C.read] === undefined);

console.log('\n[같은 값이면 아무것도 안 쓴다]');
res = setMention('김진수', '김진수', ['김진수']);
ok('changed 가 false', res.changed === false);
ok('시트에 쓰지 않는다', Object.keys(TAB._w).length === 0);

/* ── 펼친 카드의 지목 줄 ── */
console.log('\n[펼친 카드]');
ui.HB_OPEN_ID = 'HB1';
ui.hbTimeline = () => [{ kind: 'new', by: '박상식', at: '26-09-04 12:00', text: '' }];
const openHtml = ui.hbCardHtml(mk({ to: ['김진수'] }), '박상식');
ok('지목 칩 자리가 있다', openHtml.indexOf('hb-to-pick card') !== -1);
ok('카드 ID 를 달고 있다', openHtml.indexOf('data-card="HB1"') !== -1);
ok('현재 지목을 달고 있다', openHtml.indexOf('data-to="김진수"') !== -1);
ok('카드 클릭으로 접히지 않게 막았다', openHtml.indexOf('hb-to-row" onclick="event.stopPropagation()') !== -1);
const doneHtml = ui.hbCardHtml(mk({ to: ['김진수'], done: true }), '박상식');
ok('완료된 카드에는 지목 줄이 없다', doneHtml.indexOf('hb-to-pick card') === -1);
ui.HB_OPEN_ID = null;

console.log('\n[배선]');
ok('렌더 뒤에 칩을 채운다', /hbToCardFill\(\);\s*\/\/ 펼친 카드/.test(whole));
ok('토글이 서버를 부른다', /\.csSetHandoffMention\(\{ id: id, to: list, staff: me \}\)/.test(whole));
ok('실패하면 서버 값으로 되돌린다', /toast\(String\(\(res && res\.error\)[\s\S]{0,120}hbReloadBoards\(\)/.test(whole));

console.log('\n' + (fail ? `실패 ${fail}건 / 통과 ${pass}건` : `모두 통과 (${pass}건)`));
process.exit(fail ? 1 : 0);
