import { openXlsx } from './xlsxread.mjs';
const wb = openXlsx(process.argv[2]);
const s = wb.sheet('판매현황');
const h = s[1];
for (const r of [2, 9, 209, 211]) {
  console.log('--- 행 ' + (r+1));
  for (let c = 0; c < 20; c++) console.log('   ' + String.fromCharCode(65+c) + ' ' + String(h[c]||'').padEnd(28) + ' = ' + JSON.stringify(s[r][c] ?? ''));
}
