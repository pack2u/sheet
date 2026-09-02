/**
 * masters.mjs — 스프레드시트(xlsx)에서 마스터를 읽어 core.js 자료구조로 만든다.
 *
 * 두 가지 배치를 모두 지원한다.
 *   - 구 시트(세트분리 사용중) 내보내기  → legacy
 *   - 신 시트(세트분리 뉴) 내보내기       → v2
 * 어느 쪽이든 같은 masters 객체가 나오므로 엔진은 차이를 모른다.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

const T = (v) => (v === null || v === undefined ? '' : String(v).trim());
const N = (v) => { const n = parseFloat(T(v).replace(/[,\s]/g, '')); return isFinite(n) ? n : 0; };

function empty() {
  return {
    items: {}, stock: {}, bom: {}, splitExcept: {},
    cond: {}, condCodes: {}, feeRules: {},
    islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {}
  };
}

function addFeeRules(M, code, raw, stat) {
  const p = C.ssParseFeeRule(code, raw);
  for (const x of p.rows) (M.feeRules[code] ||= {})[String(x.qty)] = { fee: x.fee, fullBox: x.fullBox };
  if (p.bad.length) { stat.feeBad += p.bad.length; stat.feeBadSamples.push(`${code}: ${p.bad[0]}`); }
}

function finishBom(M, setName) {
  for (const k of Object.keys(M.bom)) if (/소분/.test(setName[k] || '')) M.splitExcept[k] = true;
}

/** 시트 이름으로 어떤 배치인지 알아낸다 */
export function detectLayout(wb) {
  return wb.names.includes('상품정보(ALL)') ? 'legacy' : 'v2';
}

export function loadMasters(wb, layout = detectLayout(wb)) {
  const M = empty();
  const stat = { feeBad: 0, feeBadSamples: [], layout };
  const body = (n) => wb.sheet(n).slice(1);
  const has = (n) => wb.names.includes(n);

  if (layout === 'legacy') {
    for (const r of body('상품정보(ALL)')) {
      const code = T(r[2]); if (!code) continue;
      M.items[code] = { name: T(r[3]), status: T(r[0]), origin: T(r[1]), unitFee: N(r[4]), feeRuleRaw: T(r[5]) };
      addFeeRules(M, code, T(r[5]), stat);
    }
    for (const r of body('IMPORT이카운트재고')) { const c = T(r[0]); if (c) M.stock[c] = N(r[1]); }
    const setName = {};
    for (const r of body('(직접수정금지)importBOM현황')) {
      const s = T(r[0]), comp = T(r[4]); if (!s || !comp) continue;
      setName[s] = T(r[1]);
      (M.bom[s] ||= []).push({ code: comp, qty: N(r[7]) || 1 });
    }
    finishBom(M, setName);
    for (const r of body('(예외품목추가)분리예외')) { const c = T(r[0]); if (c) M.splitExcept[c] = true; }
    for (const r of body('합배송조건')) {
      const cond = T(r[0]), code = T(r[1]); if (!cond || !code) continue;
      const a = (M.cond[code] ||= []); if (!a.includes(cond)) a.push(cond);
      (M.condCodes[cond] ||= {})[code] = true;
    }
    for (const r of body('import도서산간목록')) {
      const kw = T(r[0]); if (kw) M.islandKeywords.push(kw);
      const zp = T(r[1]); if (zp) M.islandZips[zp] = true;
    }
    for (const tab of ['도서산간분류확인', '도서산간분류확인(위탁배송)']) {
      if (!has(tab)) continue;
      for (const r of wb.sheet(tab).slice(2)) {
        const addr = C.ssNormAddr(r[2]); const zip = T(r[3]);
        if (addr && zip) M.addrZip[addr] = zip;
      }
    }
    if (has('import금일동네배송')) {
      for (const r of wb.sheet('import금일동네배송')) {
        const a = C.ssNormAddr(r[0]);
        if (a && !a.startsWith('#')) M.localAddrs[a] = true;
      }
    }
    return { masters: M, stat };
  }

  // v2 배치 — 신 시트 탭 이름 그대로
  for (const r of body('M_품목정보')) {
    const code = T(r[0]); if (!code) continue;
    M.items[code] = { name: T(r[1]), status: T(r[2]), origin: T(r[3]), unitFee: N(r[4]), feeRuleRaw: T(r[5]) };
  }
  for (const r of body('M_배송비규칙')) {
    const code = T(r[0]); if (!code) continue;
    (M.feeRules[code] ||= {})[String(N(r[1]))] = { fee: N(r[2]), fullBox: T(r[3]) === 'Y' };
  }
  for (const r of body('M_재고')) { const c = T(r[0]); if (c) M.stock[c] = N(r[1]); }
  const setName = {};
  for (const r of body('M_BOM')) {
    const s = T(r[0]), comp = T(r[2]); if (!s || !comp) continue;
    setName[s] = T(r[1]);
    (M.bom[s] ||= []).push({ code: comp, qty: N(r[3]) || 1 });
  }
  finishBom(M, setName);
  for (const r of body('분리예외')) { const c = T(r[0]); if (c) M.splitExcept[c] = true; }
  for (const r of body('합배송조건')) {
    const cond = T(r[0]), code = T(r[1]); if (!cond || !code) continue;
    const a = (M.cond[code] ||= []); if (!a.includes(cond)) a.push(cond);
    (M.condCodes[cond] ||= {})[code] = true;
  }
  for (const r of body('도서산간_시군')) { const k = T(r[0]); if (k) M.islandKeywords.push(k); }
  for (const r of body('도서산간_우편번호')) { const z = T(r[0]); if (z) M.islandZips[z] = true; }
  for (const r of body('도서산간_주소사전')) {
    const a = T(r[0]), z = T(r[1]); if (a && z) M.addrZip[a] = z;
  }
  for (const r of body('동네배송_금일')) { const a = T(r[0]); if (a) M.localAddrs[a] = true; }
  return { masters: M, stat };
}

export function loadConfig(wb) {
  const cfg = { ...C.SS_DEFAULT_CONFIG };
  if (!wb.names.includes('설정')) return cfg;
  for (const r of wb.sheet('설정').slice(1)) {
    const k = T(r[0]); if (k && k in cfg) cfg[k] = T(r[1]);
  }
  return cfg;
}
