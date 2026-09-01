/* 즐겨찾기 바의 폴더 드릴다운·한번에 열기 검증 (로컬 검증용)

   핵심은 "한번에 열기가 하위 폴더까지 파고들지 않는다" 다.
   협력업체 시트 전체는 56개다. 재귀로 열면 탭 56개가 한 번에 뜬다. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, 'home.html'), 'utf8').split(/\r?\n/);
const a = src.findIndex(l => l.indexOf('var CS_FAV_ITEMS = [];') !== -1);
const b = src.findIndex((l, i) => i > a && l.indexOf('(function initFavorites()') !== -1);
if (a < 0 || b < 0) { console.error('home.html 에서 즐겨찾기 모듈을 못 찾았습니다'); process.exit(1); }

const els = {};
const mk = () => ({ innerHTML: '', scrollTop: 0, style: {},
  classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); },
               contains(c) { return this.s.has(c); } } });
['csFavWrap', 'csFavBar', 'csFavMenu'].forEach(id => els[id] = mk());

let opened = [], toasts = [], confirmAnswer = true, popupsBlocked = 0;
const ctx = {
  document: { getElementById: id => els[id] || null },
  esc: s => String(s == null ? '' : s),
  toast: (m) => { toasts.push(m); },
  confirm: () => confirmAnswer,
  parseInt, console,
};
ctx.window = ctx;
ctx.window.open = (u) => { opened.push(u); return popupsBlocked-- > 0 ? null : {}; };
vm.createContext(ctx);
vm.runInContext(src.slice(a, b).join('\n'), ctx);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); };

const L = (n) => ({ name: n, url: 'https://x.example/' + n });
const TREE = [
  L('상품정보시트'),
  { name: '협력업체 시트', children: [
    { name: '대리공급업체', children: [L('그린우드'), L('뉴파츠'), L('냅킨코리아')] },
    { name: '대리판매업체', children: [L('당장드림'), L('용기창고')] },
    L('상품정보'), L('반품관리대장'), L('사방넷'),
  ] },
];
const reset = () => {
  opened = []; toasts = []; confirmAnswer = true; popupsBlocked = 0;
  ctx.csFavRender(TREE);
};

console.log('\n[바 그리기]');
reset();
ok('폴더는 button, 링크는 a 로 그린다',
   /data-folder="1"/.test(els.csFavBar.innerHTML) && /<a class="cs-fav-item"/.test(els.csFavBar.innerHTML));
ok('목록이 비면 바를 통째로 감춘다',
   (ctx.csFavRender([]), els.csFavWrap.style.display === 'none'));

console.log('\n[파고들기]');
reset();
ctx.csFavOpenFolder(1, false);
ok('폴더를 열면 패널이 뜬다', els.csFavMenu.classList.contains('on'));
ok('바가 접히지 않게 고정된다', els.csFavWrap.classList.contains('on'));
ok('하위 폴더도 폴더칩으로 나온다', /data-folder="0"[^>]*data-in-menu/.test(els.csFavMenu.innerHTML));
ctx.csFavOpenFolder(0, true);
ok('한 겹 더 들어간다', ctx.CS_FAV_PATH.join() === '1,0');
ctx.csFavBack();
ok('뒤로 누르면 한 겹 올라온다', ctx.CS_FAV_PATH.join() === '1');
ctx.csFavBack();
ok('맨 위에서 뒤로 누르면 닫힌다', !els.csFavMenu.classList.contains('on'));

console.log('\n[같은 폴더칩을 다시 누르면 닫힌다]');
reset();
ctx.csFavOpenFolder(1, false);
ctx.csFavOpenFolder(1, false);
ok('토글로 닫힌다', !els.csFavMenu.classList.contains('on'));

console.log('\n[한번에 열기 — 하위 폴더는 따라가지 않는다]');
reset();
ctx.csFavOpenFolder(1, false);      // 협력업체 시트: 하위폴더 2 + 링크 3
ctx.csFavOpenAll();
ok('직접 링크 3개만 연다 (하위 5개는 제외)', opened.length === 3);
ok('연 것이 그 폴더의 링크가 맞다',
   opened.every(u => ['상품정보', '반품관리대장', '사방넷'].some(n => u.indexOf(n) !== -1)));
ok('버튼 라벨에 개수가 찍힌다', /한번에 열기 \(3\)/.test(els.csFavMenu.innerHTML));

reset();
ctx.csFavOpenFolder(1, false);
ctx.csFavOpenFolder(0, true);       // 대리공급업체: 링크 3개
ctx.csFavOpenAll();
ok('하위 폴더 안에서도 그 폴더 것만 연다', opened.length === 3);

console.log('\n[개수가 많으면 먼저 묻는다]');
const many = [{ name: '많음', children: Array.from({ length: 9 }, (_, i) => L('v' + i)) }];
ctx.csFavRender(many); opened = []; confirmAnswer = false;
ctx.csFavOpenFolder(0, false);
ctx.csFavOpenAll();
ok('취소하면 하나도 열지 않는다', opened.length === 0);
confirmAnswer = true;
ctx.csFavOpenAll();
ok('확인하면 전부 연다', opened.length === 9);

console.log('\n[팝업이 막히면 알려 준다]');
reset();
ctx.csFavOpenFolder(1, false);
popupsBlocked = 2; toasts = [];
ctx.csFavOpenAll();
ok('막힌 개수를 토스트로 알린다', toasts.some(t => /2개가 팝업 차단/.test(t)));

console.log('\n[폴더칩이 없으면 버튼도 없다]');
ctx.csFavRender([{ name: '한개뿐', children: [L('하나')] }]);
ctx.csFavOpenFolder(0, false);
ok('링크가 1개면 한번에 열기를 띄우지 않는다', !/data-openall/.test(els.csFavMenu.innerHTML));

console.log('\n통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
