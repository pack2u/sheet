import { createRequire } from 'node:module';
import { openXlsx } from './xlsxread.mjs';
const require = createRequire(import.meta.url);
const wb = openXlsx(process.argv[2]);
const s = wb.sheet('판매현황');
console.log('판매현황 총 행:', s.length);
for (const r of [0,1,2,209,210,211,212,213,214,215]) {
  if (!s[r]) continue;
  console.log(String(r+1).padStart(4), JSON.stringify(s[r].slice(0,12)));
}
