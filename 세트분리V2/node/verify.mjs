/**
 * verify.mjs — 구 시트(세트분리 사용중) 스냅샷으로 신 엔진을 검증한다.
 *
 *   node node/verify.mjs <구시트.xlsx>
 *
 * 구 시트를 xlsx 로 내보낸 파일 하나만 있으면 된다. 같은 입력·같은 마스터로
 * 신 엔진을 돌려 구 시트의 출력 탭과 한 줄씩 대조한다.
 * 차이가 나오면 그게 곧 "구 시트가 틀렸거나 / 신 엔진이 틀렸거나" 목록이 된다.
 */

import { createRequire } from 'node:module';
import { openXlsx } from './xlsxread.mjs';
import { loadMasters } from './masters.mjs';
const require = createRequire(import.meta.url);
const C = require('../core.js');

const path = process.argv[2];
if (!path) { console.error('사용법: node node/verify.mjs <구시트.xlsx>'); process.exit(2); }
const wb = openXlsx(path);

const T = (v) => (v === null || v === undefined ? '' : String(v).trim());
const N = (v) => { const n = parseFloat(T(v).replace(/[,\s]/g, '')); return isFinite(n) ? n : 0; };
const body = (name) => wb.sheet(name).slice(1);

/* ── 마스터는 masters.mjs 가 만든다 (run.mjs 와 완전히 같은 경로) ── */

const { masters, stat } = loadMasters(wb, 'legacy');
const feeBad = stat.feeBad;

/* ── 실행 ─────────────────────────────────────────────── */

const cfg = C.SS_DEFAULT_CONFIG;
const res = C.ssRun(wb.sheet('판매현황'), masters, cfg);

console.log('\n════ 신 엔진 결과 ════');
console.log('  입력 판매현황 행       :', res.stats.입력행);
console.log('  세트분해 후            :', res.stats.분해행);
console.log('  합포장 흡수            :', res.stats.합포장흡수);
console.log('  출력 합계              :', res.stats.출력행);
for (const k of Object.keys(C.SS_ROUTE)) {
  const name = C.SS_ROUTE[k];
  console.log('    ' + name.padEnd(24) + ':', res.buckets[name].length);
}
console.log('  경고                   :', res.warnings.length, '(배송비 문자열 해석실패', feeBad, '건 포함 안 됨)');

/* ── 구 시트 출력과 대조 ──────────────────────────────── */

const keyOf = (seq, code) => C.ssPad6(seq) + '|' + T(code);
const oldSet = (tab, seqCol, codeCol, from = 1) => {
  const s = new Set();
  try {
    for (const r of wb.sheet(tab).slice(from)) {
      const seq = T(r[seqCol]); const code = T(r[codeCol]);
      if (!seq || seq === '순번' || !code) continue;
      s.add(keyOf(seq, code));
    }
  } catch (e) { /* 탭 없음 */ }
  return s;
};

// 구 시트 로젠 출력 4탭 (B=순번, D=품목코드 기준 → 0-based 1, 3)
const oldTabs = {
  '롯데택배': oldSet('로젠택배', 1, 3),
  '롯데택배-도서산간': oldSet('로젠택배-도서산간', 1, 3),
  '롯데택배-도서산간(위탁배송)': oldSet('로젠택배-도서산간(위탁배송)', 1, 3),
  '롯데택배-동네배송': oldSet('로젠택배-동네배송', 1, 3),
  '대리발송': oldSet('대리발송', 1, 3)
};

console.log('\n════ 구 시트와 대조 ════');
let sameTotal = 0, onlyNewTotal = 0, onlyOldTotal = 0;
for (const [name, oldKeys] of Object.entries(oldTabs)) {
  const merged = res.buckets[C.SS_ROUTE.MERGED].filter((u) => u.합포장대표 && u.실경로 === name);
  const newKeys = new Set(res.buckets[name].concat(merged).map((u) => keyOf(u.순번, u.품목코드)));
  const same = [...newKeys].filter((k) => oldKeys.has(k)).length;
  const onlyNew = [...newKeys].filter((k) => !oldKeys.has(k));
  const onlyOld = [...oldKeys].filter((k) => !newKeys.has(k));
  sameTotal += same; onlyNewTotal += onlyNew.length; onlyOldTotal += onlyOld.length;
  console.log(`  ${name.padEnd(24)} 구 ${String(oldKeys.size).padStart(4)} / 신 ${String(newKeys.size).padStart(4)}` +
    ` · 일치 ${String(same).padStart(4)} · 신에만 ${String(onlyNew.length).padStart(3)} · 구에만 ${String(onlyOld.length).padStart(3)}`);
  if (onlyNew.length) console.log('      신에만: ' + onlyNew.slice(0, 6).join(', ') + (onlyNew.length > 6 ? ' …' : ''));
  if (onlyOld.length) console.log('      구에만: ' + onlyOld.slice(0, 6).join(', ') + (onlyOld.length > 6 ? ' …' : ''));
}
console.log(`  합계 · 일치 ${sameTotal} · 신에만 ${onlyNewTotal} · 구에만 ${onlyOldTotal}`);

/* ── 구 시트에서는 조용히 사라졌던 행 ─────────────────── */

const allOld = new Set();
for (const s of Object.values(oldTabs)) for (const k of s) allOld.add(k);
const lost = res.units
  .filter((u) => !u.합포장흡수 && !allOld.has(keyOf(u.순번, u.품목코드)));

console.log('\n════ 구 시트 출력 어디에도 없던 라인 ════');
const byReason = {};
for (const u of lost) {
  const r = u.보류사유 || ('정상출고여야 함 → ' + u.route);
  (byReason[r] ||= []).push(u);
}
for (const [r, list] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(4)}건  ${r}`);
  for (const u of list.slice(0, 3)) {
    console.log(`         ${u.순번} ${u.품목코드} ${T(u.품목명).slice(0, 34)} | 상태:${u.상태 || '-'} 출고지:${u.출고지 || '-'}`);
  }
}

/* ── 경고 요약 ────────────────────────────────────────── */

console.log('\n════ 경고 ════');
const wc = {};
for (const w of res.warnings) (wc[w.code] ||= []).push(w);
for (const [code, list] of Object.entries(wc).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(4)}건  ${code}  ${list[0].msg.slice(0, 70)}`);
}
if (!res.warnings.length) console.log('  없음');

/* ── 구 시트에만 있던 라인은 어디로 갔나 ─────────────── */
const strip = (k) => k.replace(/^1/, '');
const missing = new Set();
for (const [name, oldKeys] of Object.entries(oldTabs)) {
  const newKeys = new Set(res.buckets[name].map((u) => keyOf(u.순번, u.품목코드)));
  for (const k of oldKeys) if (!newKeys.has(k)) missing.add(k);
}
if (missing.size) {
  console.log('\n════ 구 시트에만 있던 라인의 신 엔진 처리 ════');
  for (const k of missing) {
    const u = res.units.find((x) => keyOf(x.순번, x.품목코드) === k);
    if (!u) { console.log('  ' + k + ' → 신 엔진에 라인 자체가 없음'); continue; }
    console.log(`  ${strip(k)} → ${u.합포장흡수 ? '합포장으로 흡수됨' : u.route} ` +
      `| 조건ID:${u.조건ID || '-'} 수량:${u.수량} 배송비:${u.배송비} 그룹:${(u.합포장그룹 || '-').slice(0, 60)}`);
  }
}

/* ── 보류 상세 ────────────────────────────────────────── */
console.log('\n════ 보류 상세 ════');
for (const u of res.buckets[C.SS_ROUTE.HOLD]) {
  console.log(`  ${u.순번} ${u.품목코드.padEnd(20)} ${u.보류사유.padEnd(12)} 상태:${(u.상태||'-').padEnd(14)} 출고지:${(u.출고지||'-').padEnd(8)} 부족:${u.부족수량} | ${T(u.보류상세).slice(0,50)}`);
}
