/**
 * _genferry.mjs — 롯데 도선료 엑셀 → gasSeed.js 시드 배열을 만든다.
 *
 *   node node/_genferry.mjs "D:/롯데_도선지역 산간료.xlsx"
 *
 * 엑셀은 (시도·시군·읍면동·도선료) 네 칸짜리 블록이 좌우로 두 벌 놓인 배치다.
 * 시도·시군은 병합되어 첫 행에만 있으므로 아래로 끌어 내린다.
 *
 * 읍면동 칸에는 세 가지 형태가 섞여 있다.
 *   「욕지면」                     → 그 면 전체가 대상
 *   「산양읍(연곡리, 저림리…)」    → 그 읍 안에서 적힌 리만 대상
 *   「마도동, 신수동」             → 한 칸에 두 곳
 */

import { openXlsx } from './xlsxread.mjs';

const T = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const PAREN = new RegExp('^([^(]+)\\((.+)\\)');

export function readFerry(path) {
  const s = openXlsx(path).sheet('Sheet1');
  const raw = [];
  for (const blk of [0, 4]) {
    let 시도 = '', 시군 = '';
    for (let i = 3; i < s.length; i++) {
      const a = T(s[i][blk]), b = T(s[i][blk + 1]), c = T(s[i][blk + 2]), f = T(s[i][blk + 3]);
      if (a) 시도 = a;
      if (b) 시군 = b;
      if (!c) continue;
      raw.push({ 시도, 시군, cell: c, 료: parseInt(f.replace(/[^0-9]/g, ''), 10) || 0 });
    }
  }

  const out = [], seen = new Set();
  for (const r of raw) {
    const m = r.cell.match(PAREN);
    let bases, 리 = '';
    if (m) {
      bases = [m[1].trim()];
      리 = m[2].split(',').map((x) => x.trim()).filter(Boolean).join('|');
    } else {
      bases = r.cell.split(',').map((x) => x.trim()).filter(Boolean);
    }
    for (const b of bases) {
      const key = [r.시도, r.시군, b, 리].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const zone = /제주|서귀/.test(r.시도 + r.시군) ? '제주' : '도서';
      out.push([r.시도, r.시군, b, 리, r.료, zone]);
    }
  }
  out.sort((x, y) => (x[0] + x[1] + x[2]).localeCompare(y[0] + y[1] + y[2], 'ko'));
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('_genferry.mjs')) {
  const rows = readFerry(process.argv[2] || 'D:/롯데_도선지역 산간료.xlsx');
  const 리조건 = rows.filter((r) => r[3]).length;
  console.error('행 ' + rows.length + ' · 리조건 ' + 리조건 + ' · 동단위 ' +
    rows.filter((r) => r[2].endsWith('동')).length);
  console.log('/** 롯데 도선료 표 — [시도, 시군, 읍면동, 리조건(| 구분), 도선료, 권역] */');
  console.log('var SSSEED_FERRY = [');
  for (const r of rows) {
    console.log('  [' + r.slice(0, 4).map((x) => "'" + x + "'").join(', ') +
      ', ' + r[4] + ", '" + r[5] + "'],");
  }
  console.log('];');
}
