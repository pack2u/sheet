/**
 * xlsxread.mjs — 의존성 없는 최소 xlsx 리더 (값 전용)
 *
 * 구글 시트를 xlsx 로 내보낸 파일이나 이카운트가 뱉는 xlsx 를 그대로 읽는다.
 * 수식은 무시하고 캐시된 값만 가져온다. 세트분리 파이프라인은 값만 필요하다.
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/* ── 아주 작은 zip 리더 ───────────────────────────────── */

function readZip(path) {
  const buf = readFileSync(path);
  // End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip(xlsx) 형식이 아닙니다: ' + path);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ── XML 조각 파싱 ────────────────────────────────────── */

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
function unesc(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m])
          .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
          .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function sharedStrings(xml) {
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    let text = '';
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(m[1]))) text += unesc(t[1]);
    out.push(text);
  }
  return out;
}

function colToIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** 엑셀 시리얼 날짜 → yyyy/MM/dd */
function serialToDate(n) {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
}

function parseSheet(xml, strings, dateCols) {
  const rows = [];
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let r;
  while ((r = rowRe.exec(xml))) {
    const rowIdx = +r[1] - 1;
    const cells = [];
    // 빈 셀은 <c r="G7" s="5"/> 처럼 자기닫힘으로 온다.
    // 속성부를 게으르게 잡아야 자기닫힘과 본문 있는 셀을 헷갈리지 않는다.
    const cRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cRe.exec(r[2]))) {
      const ci = colToIndex(c[1]);
      const attrs = c[2] || '';
      const body = c[3] || '';
      const tm = attrs.match(/t="([^"]+)"/);
      const type = tm ? tm[1] : 'n';
      let val = '';
      if (type === 'inlineStr') {
        const t = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = t ? unesc(t[1]) : '';
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        const raw = v ? unesc(v[1]) : '';
        if (type === 's') val = strings[+raw] ?? '';
        else if (type === 'e') val = raw;
        else if (raw === '') val = '';
        else if (dateCols && dateCols.has(ci) && /^\d+(\.\d+)?$/.test(raw)) val = serialToDate(+raw);
        else val = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      }
      cells[ci] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows[rowIdx] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/**
 * @returns {{names: string[], sheet(name): any[][]}}
 */
export function openXlsx(path) {
  const files = readZip(path);
  const dec = (n) => {
    const b = files.get(n);
    return b ? b.toString('utf8') : '';
  };
  const wb = dec('xl/workbook.xml');
  const rels = dec('xl/_rels/workbook.xml.rels');
  const relMap = new Map();
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap.set(m[1], m[2]);
  for (const m of rels.matchAll(/Target="([^"]+)"[^>]*Id="([^"]+)"/g)) relMap.set(m[2], m[1]);

  const sheets = [];
  for (const m of wb.matchAll(/<sheet([^>]*)\/>/g)) {
    const a = m[1];
    const name = unesc((a.match(/name="([^"]*)"/) || [, ''])[1]);
    const rid = (a.match(/r:id="([^"]*)"/) || [, ''])[1];
    const state = (a.match(/state="([^"]*)"/) || [, 'visible'])[1];
    let target = relMap.get(rid) || '';
    if (target && !target.startsWith('xl/')) target = 'xl/' + target.replace(/^\//, '');
    sheets.push({ name, target, state });
  }
  const strings = sharedStrings(dec('xl/sharedStrings.xml'));
  const cache = new Map();

  return {
    names: sheets.map((s) => s.name),
    states: Object.fromEntries(sheets.map((s) => [s.name, s.state])),
    sheet(name, opts = {}) {
      const key = name + '|' + (opts.dateCols || []).join(',');
      if (cache.has(key)) return cache.get(key);
      const s = sheets.find((x) => x.name === name);
      if (!s) throw new Error(`탭을 찾을 수 없습니다: ${name} (있는 탭: ${sheets.map((x) => x.name).join(', ')})`);
      const rows = parseSheet(dec(s.target), strings, opts.dateCols ? new Set(opts.dateCols) : null);
      cache.set(key, rows);
      return rows;
    }
  };
}
