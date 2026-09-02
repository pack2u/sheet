import { openXlsx } from './xlsxread.mjs';
const wb = openXlsx(process.argv[2]);
const s = wb.sheet('판매현황');
const h = s[1];
const want = new Set(['150','99','61','169']);
for (let r = 2; r < s.length; r++) {
  if (!want.has(String(s[r][0]))) continue;
  console.log('--- 순번 ' + s[r][0]);
  for (let c = 0; c < 20; c++) {
    const v = s[r][c]; if (v === '' || v === undefined) continue;
    console.log('   ' + String(h[c]||'').padEnd(26) + ' = ' + JSON.stringify(v));
  }
}
console.log('\n=== 구시트 합배송 탭에서 해당 순번 ===');
for (const r of wb.sheet('합배송').slice(1)) {
  if (!want.has(String(r[2]).replace(/^1/,'').replace(/^0+/,''))) continue;
  console.log(' ', JSON.stringify([r[1],r[2],r[3],r[7],r[10],r[13],r[23]]));
}
