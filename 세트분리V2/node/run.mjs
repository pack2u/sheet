/**
 * run.mjs — 시트 없이 돌리는 세트분리 (로컬 CLI)
 *
 *   node node/run.mjs --masters <마스터.xlsx> [--sales <판매현황.xlsx>] [--out out]
 *
 *   --masters  마스터가 들어 있는 스프레드시트 내보내기(xlsx).
 *              구 시트(세트분리 사용중) / 신 시트(세트분리 뉴) 둘 다 인식한다.
 *   --sales    이카운트 판매현황 xlsx. 생략하면 --masters 파일의 「판매현황」 탭을 쓴다.
 *   --out      결과 CSV 폴더 (기본 out)
 *
 * 출력
 *   롯데택배.csv · 롯데택배-도서산간.csv · …(위탁배송).csv · …-동네배송.csv
 *   대리발송.csv · 보류.csv · 경고.csv · 주문라인원장.csv · 요약.txt
 *
 * 전부 UTF-8 BOM 이라 엑셀에서 바로 열린다.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { openXlsx } from './xlsxread.mjs';
import { loadMasters, loadConfig, detectLayout } from './masters.mjs';

const require = createRequire(import.meta.url);
const C = require('../core.js');

/* ── 인자 ─────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const mastersPath = arg('masters');
if (!mastersPath) {
  console.error('사용법: node node/run.mjs --masters <마스터.xlsx> [--sales <판매현황.xlsx>] [--out out]');
  process.exit(2);
}
const salesPath = arg('sales', mastersPath);
const outDir = arg('out', 'out');

/* ── 읽기 ─────────────────────────────────────────────── */
const t0 = Date.now();
const mwb = openXlsx(mastersPath);
const layout = detectLayout(mwb);
const { masters, stat } = loadMasters(mwb, layout);
const cfg = loadConfig(mwb);

const swb = salesPath === mastersPath ? mwb : openXlsx(salesPath);
const salesTab = swb.names.includes('판매현황')
  ? '판매현황'
  : swb.names.find((n) => /판매/.test(n)) || swb.names[0];
const grid = swb.sheet(salesTab);

/* ── 실행 ─────────────────────────────────────────────── */
const res = C.ssRun(grid, masters, cfg);
const ms = Date.now() - t0;

/* ── 쓰기 ─────────────────────────────────────────────── */
mkdirSync(outDir, { recursive: true });

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const writeCsv = (name, header, rows) => {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  writeFileSync(join(outDir, name + '.csv'), '﻿' + text, 'utf8');
};

for (const key of Object.keys(C.SS_ROUTE)) {
  const name = C.SS_ROUTE[key];
  if (name === C.SS_ROUTE.HOLD) continue;
  writeCsv(name, C.SS_OUT_HEADER, res.buckets[name].map(C.ssOutRow));
}
writeCsv('보류', C.SS_HOLD_HEADER,
  res.buckets[C.SS_ROUTE.HOLD].map((u) => C.ssOutRow(u).concat([u.보류사유, u.보류상세])));
writeCsv('경고', C.SS_WARN_HEADER, res.warnings.map((w) => [w.level, w.code, w.target, w.msg]));

const runKey = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(2);
const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
writeCsv('주문라인원장', C.SS_LEDGER_HEADER, res.units.map((u) => C.ssLedgerRow(u, runKey, at)));

/* ── 요약 ─────────────────────────────────────────────── */
const L = [];
L.push('세트분리 V2 · ' + C.SS_VERSION);
L.push('마스터 배치      : ' + layout + ' (' + mastersPath + ')');
L.push('판매현황         : ' + salesTab + ' (' + salesPath + ')');
L.push('소요             : ' + ms + 'ms');
L.push('');
L.push('입력 판매현황 행 : ' + res.stats.입력행);
L.push('세트분해 후      : ' + res.stats.분해행);
L.push('합포장 흡수      : ' + res.stats.합포장흡수);
L.push('출력 합계        : ' + res.stats.출력행);
L.push('검증 분해=출력+흡수 : ' +
  (res.stats.분해행 === res.stats.출력행 + res.stats.합포장흡수 ? 'OK' : '불일치!'));
L.push('');
for (const key of Object.keys(C.SS_ROUTE)) {
  const name = C.SS_ROUTE[key];
  L.push('  ' + name.padEnd(26) + String(res.buckets[name].length).padStart(5));
}
L.push('');
L.push('경고 ' + res.warnings.length + '건');
const wc = {};
for (const w of res.warnings) (wc[w.code] ||= []).push(w);
for (const [code, list] of Object.entries(wc).sort((a, b) => b[1].length - a[1].length)) {
  L.push('  ' + String(list.length).padStart(4) + '건  ' + code + '  ' + list[0].msg.slice(0, 60));
}
if (stat.feeBad) {
  L.push('');
  L.push('레거시 배송비 문자열 해석실패 ' + stat.feeBad + '건 (예: ' + stat.feeBadSamples.slice(0, 3).join(' / ') + ')');
}
const summary = L.join('\n');
writeFileSync(join(outDir, '요약.txt'), '﻿' + summary, 'utf8');
console.log('\n' + summary + '\n\n→ ' + outDir + ' 에 CSV 저장 완료');
