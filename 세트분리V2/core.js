/**
 * core.js — 세트분리 V2 순수 파이프라인
 *
 * Apps Script(GAS)와 Node에서 그대로 공유한다. 시트 API·파일 IO를 일절 쓰지 않으며
 * 입력(평범한 배열/맵)만 받아 출력(배열)을 돌려주는 순수 함수들이다.
 * 그래서 로컬에서 테스트할 수 있고, 시트 없이도 같은 결과가 나온다.
 *
 * 구 시트(세트분리 사용중) 대비 고친 것
 *  - 고정 행 범위 없음 (A2:A3011 같은 천장이 존재하지 않음)
 *  - 라우팅이 단일 값(routeCode). 출력 탭 필터가 서로 겹치지 않는다
 *  - 조건ID를 라인에 직접 보관. 품목코드로 되찾지 않는다
 *  - BOM 소요량을 수량에 곱한다
 *  - 배송비는 정규 테이블 조회. 정규식 폴백은 경고로 남긴다
 *  - 실패를 값으로 만들지 않는다. 판정 불가는 보류 + 사유
 */

var SS_VERSION = '2.0.0';

/* ── 상수 ─────────────────────────────────────────────── */

var SS_ROUTE = {
  LOTTE: '롯데택배',
  LOTTE_ISLAND: '롯데택배-도서산간',
  LOTTE_ISLAND_CONSIGN: '롯데택배-도서산간(위탁배송)',
  LOTTE_LOCAL: '롯데택배-동네배송',
  PARTNER: '대리발송',
  HOLD: '보류'
};

/** 출력 탭 공통 19열 (구 로젠택배 탭과 동일한 열 구성, 이름만 롯데) */
var SS_OUT_HEADER = [
  '출고지', '순번', '일자-No.', '품목코드', '품목명', '택배박스수량', '수량',
  '전화', '모바일', '주소1', '배송메시지', '합계', '거래처명', '단품배송비',
  '적요', '사방넷주문번호', '보내는분', '보내는분전화', '보내는주소(팩투유)'
];

var SS_HOLD_HEADER = SS_OUT_HEADER.concat(['보류사유', '상세']);

var SS_LEDGER_HEADER = [
  '회차키', '라인ID', '실행시각', '경로', '보류사유', '출고지', '순번', '일자-No.',
  '원본품목코드', '품목코드', '품목명', '출력품목명', '택배박스수량', '주문수량', '소요량', '수량',
  '조건ID', '합포장그룹', '합포장대표', '배송비', '배송비산출', '부족수량',
  '거래처명', '전화', '모바일', '주소1', '배송메시지', '합계',
  '적요', '사방넷주문번호', '보내는분', '보내는분전화'
];

var SS_WARN_HEADER = ['심각도', '코드', '대상', '내용'];

var SS_FEE_RULE_HEADER = ['품목코드', '수량', '배송비', '완박스', '출처'];

var SS_DEFAULT_CONFIG = {
  자사출고지접두: '평택',
  합배송출고지: '평택S-1',
  위탁출고지: '대리발송',
  허용상태: '판매중,임박,특판',
  보내는주소: '경기도 평택시 포승읍 성해홍원로 91 팩투유',
  대표전화: '031-923-7795',
  도서산간_미확인: '보류'
};

/* ── 작은 도구들 ──────────────────────────────────────── */

function ssText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return ssDateText(v);
  return String(v).trim();
}

function ssDateText(d) {
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate());
}

function ssNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = ssText(v).replace(/[,\s₩]/g, '');
  if (s === '') return 0;
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/** "a/b" → ["a","b"]. 구분자가 없으면 [전체, ""] */
function ssSplit2(v, sep) {
  var s = ssText(v);
  var i = s.indexOf(sep);
  if (i < 0) return [s, ''];
  return [s.slice(0, i).trim(), s.slice(i + sep.length).trim()];
}

function ssPad6(v) {
  var s = ssText(v).replace(/[^0-9]/g, '');
  if (s === '') return '';
  while (s.length < 5) s = '0' + s;
  return '1' + s;
}

function ssNorm(v) { return ssText(v).replace(/\s+/g, ' ').trim(); }

/** 주소 정규화 — 구 시트의 split(char(10)&".(") 첫 조각 규칙을 계승 */
function ssNormAddr(v) {
  var s = ssText(v);
  var i = s.indexOf('\n.(');
  if (i >= 0) s = s.slice(0, i);
  return s.replace(/\s+/g, ' ').trim();
}

function ssWarn(list, level, code, target, msg) {
  list.push({ level: level, code: code, target: ssText(target), msg: msg });
}

/* ── 1단계 · 판매현황 정규화 ──────────────────────────── */

var SS_SALES_COLS = [
  '순번', '일자-No.', '품목코드', '품목명', '수량', '전화', '모바일', '주소1', '합계',
  '거래처명', '세트구성및배송비', '단품배송비', '묶음배송비', '적요',
  '주문자명(사방넷)', '전화번호(사방넷)', '추가장문형식1',
  '주문자명(주문서)', '전화번호(주문서)', '배송지(주문서)/배송메시지(주문서)'
];

/** 헤더 행을 찾아 (headerIndex, colIndex맵)을 돌려준다 */
function ssFindSalesHeader(grid) {
  for (var r = 0; r < Math.min(grid.length, 20); r++) {
    var row = grid[r].map(ssText);
    if (row.indexOf('품목코드') >= 0 && row.indexOf('순번') >= 0) {
      var idx = {};
      for (var c = 0; c < row.length; c++) if (row[c]) idx[row[c]] = c;
      return { headerRow: r, idx: idx };
    }
  }
  return null;
}

/**
 * 판매현황 grid → 주문라인[]
 * 주문 출처(주문서 / 사방넷 / 이카운트)에 따라 수취인·연락처·주소를 다르게 뽑는다.
 */
function ssNormalize(grid, cfg, warnings) {
  cfg = cfg || SS_DEFAULT_CONFIG;
  var found = ssFindSalesHeader(grid);
  if (!found) throw new Error('판매현황 헤더(순번/품목코드)를 찾지 못했습니다.');
  var idx = found.idx;
  var need = ['순번', '일자-No.', '품목코드', '품목명', '수량'];
  for (var i = 0; i < need.length; i++) {
    if (idx[need[i]] === undefined) throw new Error('판매현황에 필수 열이 없습니다: ' + need[i]);
  }
  var g = function (row, name) {
    var c = idx[name];
    return c === undefined ? '' : ssText(row[c]);
  };

  var out = [];
  var seen = {};
  for (var r = found.headerRow + 1; r < grid.length; r++) {
    var row = grid[r];
    if (!row) continue;
    var code = g(row, '품목코드');
    if (!code || code === '품목코드') continue;

    var 주문서 = g(row, '주문자명(주문서)');
    var 사방넷 = g(row, '주문자명(사방넷)');
    var 거래처 = g(row, '거래처명');
    var 출처 = 주문서 ? '주문서' : (사방넷 ? '사방넷' : '이카운트');

    var 주소원본, 메시지;
    if (출처 === '주문서') {
      var t = ssSplit2(g(row, '배송지(주문서)/배송메시지(주문서)'), '/');
      주소원본 = t[0]; 메시지 = t[1];
    } else if (출처 === '사방넷') {
      var q = ssSplit2(g(row, '추가장문형식1'), '/');
      주소원본 = q[0]; 메시지 = q[1];
    } else {
      주소원본 = g(row, '주소1');
      메시지 = ssSplit2(g(row, '적요'), '//')[1];
    }

    var 받는분 = (출처 === '주문서') ? 주문서
      : (출처 === '사방넷') ? ssSplit2(사방넷, '/')[0] : 거래처;
    받는분 = 받는분.slice(0, 25);

    var 개인 = /개인/.test(거래처);
    var 위탁표기 = (출처 === '주문서') || /대리발송/.test(거래처);
    var 보내는분 = 개인 ? '팩투유(개인)'
      : (위탁표기 ? 거래처.replace('직매입-', '').replace('대리발송-', '') : '팩투유');
    var 보내는분전화 = 개인 ? cfg.대표전화
      : (위탁표기 ? (g(row, '모바일') || g(row, '전화')) : cfg.대표전화);

    var seqRaw = g(row, '순번');
    if (!/^[0-9]+$/.test(seqRaw)) {
      // 이카운트 판매현황 꼬리(소계·합계·출력시각)는 조용히 버린다
      if (seqRaw === '' || /계$|^[0-9]{4}[/-]/.test(seqRaw)) continue;
      ssWarn(warnings, '오류', 'NO_SEQ', code, '순번이 숫자가 아니라 건너뜁니다 (행 ' + (r + 1) + ', 값: ' + seqRaw + ')');
      continue;
    }
    var 순번 = ssPad6(seqRaw);
    if (seen[순번]) {
      ssWarn(warnings, '오류', 'DUP_SEQ', 순번, '판매현황에 순번이 중복입니다. 뒤의 행을 건너뜁니다.');
      continue;
    }
    seen[순번] = true;

    out.push({
      순번: 순번,
      출처: 출처,
      일자: g(row, '일자-No.'),
      원본코드: code,
      원본품목명: g(row, '품목명'),
      주문수량: ssNum(g(row, '수량')),
      받는분: 받는분,
      전화: (출처 === '이카운트') ? g(row, '전화') : '',
      모바일: (출처 === '주문서') ? g(row, '전화번호(주문서)')
        : (출처 === '사방넷') ? g(row, '전화번호(사방넷)') : g(row, '모바일'),
      주소1: 주소원본,
      배송메시지: 메시지,
      합계: ssNum(g(row, '합계')),
      적요: ssSplit2(g(row, '적요'), '//')[0],
      사방넷주문번호: (출처 === '사방넷') ? ssSplit2(사방넷, '/')[1] : '',
      보내는분: 보내는분,
      보내는분전화: 보내는분전화,
      보내는주소: cfg.보내는주소,
      판매처표기: /인\//.test(거래처) ? 거래처.replace('대리발송-', '') : '',
      거래처명원본: 거래처
    });
  }
  return out;
}

/* ── 2단계 · 세트 분해 (BOM 소요량 반영) ──────────────── */

function ssExplode(lines, masters, warnings) {
  var bom = masters.bom || {};
  var except = masters.splitExcept || {};
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    var parts = bom[L.원본코드];
    var 분해 = parts && parts.length > 1 && !except[L.원본코드];

    if (!분해) {
      out.push(ssMakeUnit(L, L.원본코드, 1, 0));
      continue;
    }
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      var 소요 = (p.qty === undefined || p.qty === null || p.qty === '') ? 1 : ssNum(p.qty);
      if (!(소요 > 0)) {
        ssWarn(warnings, '오류', 'BOM_QTY', L.원본코드 + ' > ' + p.code,
          '소요량이 ' + p.qty + ' 입니다. 1로 간주했습니다. BOM을 확인하세요.');
        소요 = 1;
      }
      out.push(ssMakeUnit(L, p.code, 소요, k + 1));
    }
  }
  return out;
}

function ssMakeUnit(L, code, 소요, seq) {
  var qty = L.주문수량 * 소요;
  var qtyInt = Math.ceil(qty - 1e-9);
  var u = {};
  for (var k in L) if (Object.prototype.hasOwnProperty.call(L, k)) u[k] = L[k];
  u.라인ID = L.순번 + (seq ? '-' + seq : '');
  u.품목코드 = code;
  u.소요량 = 소요;
  u.수량 = qtyInt;
  u.수량원시 = qty;
  u.세트분해 = seq > 0;
  return u;
}

/* ── 3단계 · 품목 마스터 결합 ─────────────────────────── */

function ssEnrich(units, masters, warnings) {
  var items = masters.items || {};
  var missing = {};
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var m = items[u.품목코드];
    if (!m) {
      u.품목명 = u.세트분해 ? '(품목정보 없음) ' + u.품목코드 : u.원본품목명;
      u.상태 = ''; u.출고지 = ''; u.단품배송비 = 0; u.배송비규칙원문 = '';
      u.품목누락 = true;
      if (!missing[u.품목코드]) {
        missing[u.품목코드] = true;
        ssWarn(warnings, '오류', 'ITEM_MISSING', u.품목코드,
          '상품정보(ALL)에 없는 품목입니다. 라우팅할 수 없어 보류합니다.');
      }
      continue;
    }
    u.품목명 = m.name || u.원본품목명;
    u.상태 = m.status || '';
    u.출고지 = m.origin || '';
    u.단품배송비 = ssNum(m.unitFee);
    u.배송비규칙원문 = ssText(m.feeRuleRaw);
  }
  return units;
}

/**
 * 출력용 품목명 — 구 시트 규칙 그대로:
 *   품목명 + (판매처표기 있으면 "---판매처") + (적요가 "**"로 시작하면 적요 붙임)
 */
function ssDisplayName(u) {
  var name = ssText(u.품목명);
  if (u.판매처표기) name += '---' + u.판매처표기;
  if (/^\*\*/.test(ssText(u.적요))) name += u.적요;
  return name;
}

/* ── 4단계 · 합배송 조건ID 판정 ───────────────────────── */

function ssDeliveryKey(u) {
  return ssNorm(u.받는분) + '♦' + ssNorm(u.주소1) + '♦' + ssNorm(u.보내는분);
}

/**
 * 코드가 여러 조건에 속할 때: 같은 배송키 묶음 안에서 그 조건에만 있는(전용) 코드가
 * 가장 많은 조건을 고른다. 동점이면 조건ID 사전순 — 항상 같은 답이 나온다.
 * 결과를 라인에 그대로 저장하므로 이후 어디서도 코드로 되찾지 않는다.
 */
function ssAssignCondition(units, masters, cfg) {
  var condOfCode = masters.cond || {};
  var codesOfCond = masters.condCodes || {};
  var groups = {};
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    u.조건ID = '';
    if (u.출고지 !== cfg.합배송출고지) continue;
    var key = ssDeliveryKey(u);
    (groups[key] || (groups[key] = [])).push(u);
  }
  for (var key in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
    var g = groups[key];
    var codeSet = {};
    for (var j = 0; j < g.length; j++) codeSet[g[j].품목코드] = true;
    for (var j2 = 0; j2 < g.length; j2++) {
      var uu = g[j2];
      var cands = condOfCode[uu.품목코드];
      if (!cands || !cands.length) continue;
      if (cands.length === 1) { uu.조건ID = cands[0]; continue; }
      var best = '', bestScore = -1;
      var sorted = cands.slice().sort();
      for (var c = 0; c < sorted.length; c++) {
        var cond = sorted[c];
        var score = 0;
        for (var code in codeSet) {
          if (!Object.prototype.hasOwnProperty.call(codeSet, code)) continue;
          var owners = condOfCode[code];
          if (owners && owners.length === 1 && owners[0] === cond) score++;
        }
        if (score > bestScore) { bestScore = score; best = cond; }
      }
      uu.조건ID = best || sorted[0];
    }
  }
  return units;
}

/* ── 5단계 · 배송비 ───────────────────────────────────── */

/**
 * 배송비규칙 테이블 조회. 테이블에 (코드, 수량) 규칙이 있으면 그 값 + 1박스,
 * 없으면 단품배송비 × 수량 + 수량만큼의 박스.
 * 규칙 원문은 있는데 이 수량에 해당하는 행이 없으면 경고로 남긴다(조용한 폴백 금지).
 */
function ssShippingFee(u, masters, warnings) {
  var byCode = (masters.feeRules || {})[u.품목코드];
  var hit = byCode ? byCode[String(u.수량)] : null;
  if (hit) {
    u.배송비 = ssNum(hit.fee);
    u.박스수 = 1;
    u.완박스 = !!hit.fullBox;
    u.배송비산출 = '규칙 ' + u.수량 + '개-' + u.배송비 + (hit.fullBox ? '(완박스)' : '');
    if (u.수량 >= 2) {
      u.출력품목명 = ssDisplayName(u) + '---' + u.수량 + '개 합포장' + (hit.fullBox ? '(완박스)' : '');
    }
    return u;
  }
  u.배송비 = u.단품배송비 * (u.수량 < 1 ? 0 : u.수량);
  u.박스수 = u.수량 < 1 ? 0 : u.수량;
  u.완박스 = false;
  u.배송비산출 = '단품 ' + u.단품배송비 + '×' + u.수량;
  if (byCode && u.수량 > 1) {
    ssWarn(warnings, '주의', 'FEE_RULE_GAP', u.품목코드,
      '수량 ' + u.수량 + '개에 대한 묶음배송비 규칙이 없어 단품×수량으로 계산했습니다.');
  }
  return u;
}

/* ── 6단계 · 합포장 ───────────────────────────────────── */

/**
 * 같은 (합배송출고지, 배송키, 조건ID) 묶음이 2건 이상이고 각 수량이 1 이하면
 * 대표 1건으로 합치고 나머지는 출력하지 않는다.
 * 조정배송비 = 묶음 안 최대 배송비, 박스수 = 1.
 */
function ssMerge(units, cfg) {
  var groups = {};
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    u.합포장그룹 = ''; u.합포장대표 = false; u.합포장흡수 = false;
    if (u.보류사유) continue;
    if (u.출고지 !== cfg.합배송출고지) continue;
    if (!u.조건ID) continue;
    if (u.수량 > 1) continue;
    var key = u.출고지 + '♦' + ssDeliveryKey(u) + '♦' + u.조건ID;
    (groups[key] || (groups[key] = [])).push(u);
  }
  for (var key in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
    var g = groups[key];
    if (g.length < 2) continue;
    var maxFee = 0, sample = false, names = [];
    for (var j = 0; j < g.length; j++) {
      g[j].합포장그룹 = key;
      if (g[j].배송비 > maxFee) maxFee = g[j].배송비;
      if (/^\[샘플\]/.test(g[j].품목명)) sample = true;
      names.push(ssStripName(g[j].품목명));
    }
    var rep = g[0];
    rep.합포장대표 = true;
    rep.배송비 = maxFee;
    rep.박스수 = 1;
    rep.배송비산출 = '합포장 최대 ' + maxFee + ' (' + g.length + '건)';
    rep.출력품목명 = (sample ? '[샘플] ' : '') + ssCompressNames(names) + ' ===합배송';
    for (var k = 1; k < g.length; k++) g[k].합포장흡수 = true;
  }
  return units;
}

/** 합포장 표기용 이름 정리 — ---뒤 꼬리, [샘플], 끝의 N세트/N개 제거 */
function ssStripName(name) {
  var s = ssText(name)
    .replace(/---.*$/, '')
    .replace(/^\[샘플\]\s*/, '')
    .replace(/\s*-?\s*\d+세트$/, '')
    .replace(/\s*-?\s*\d+개$/, '');
  return s.trim();
}

/**
 * 같은 계열 품목명을 "공통앞말 A/B/C 공통뒷말" 로 접는다.
 * 예) "BF 225파이 감자탕 대 블랙","…중 블랙","…소 블랙"
 *     → "BF 225파이 감자탕 대/중/소 블랙"
 * 합칠 조건: 공통 앞 토큰 2개 이상 + 가운데 남는 토큰 수가 서로 같음.
 * (구 시트의 커스텀 함수 groupItemNamesWithCondition 을 실제 출력에서 역설계해 재구현)
 */
function ssCompressNames(names) {
  var uniq = [], seen = {};
  for (var i = 0; i < names.length; i++) {
    var n = ssNorm(names[i]);
    if (n && !seen[n]) { seen[n] = true; uniq.push(n); }
  }
  var clusters = [];
  for (var u = 0; u < uniq.length; u++) {
    var toks = uniq[u].split(' ');
    var placed = false;
    for (var c = 0; c < clusters.length; c++) {
      var cl = clusters[c];
      var p = toks.length, s = toks.length, m;
      for (m = 0; m < cl.members.length; m++) p = Math.min(p, ssCommonPrefix(cl.members[m], toks));
      if (p < 2) continue;
      for (m = 0; m < cl.members.length; m++) s = Math.min(s, ssCommonSuffix(cl.members[m], toks, p));
      var midLen = toks.length - p - s;
      if (midLen <= 0) continue;
      var ok = true;
      for (m = 0; m < cl.members.length; m++) {
        if (cl.members[m].length - p - s !== midLen) { ok = false; break; }
      }
      if (!ok) continue;
      cl.pre = toks.slice(0, p);
      cl.suf = s ? toks.slice(toks.length - s) : [];
      cl.members.push(toks);
      placed = true;
      break;
    }
    if (!placed) clusters.push({ pre: toks.slice(), suf: [], members: [toks] });
  }
  var parts = [];
  for (var q = 0; q < clusters.length; q++) {
    var cq = clusters[q];
    if (cq.members.length === 1) { parts.push(cq.members[0].join(' ')); continue; }
    var pre = cq.pre.length, suf = cq.suf.length;
    var mids = [];
    for (var w = 0; w < cq.members.length; w++) {
      mids.push(cq.members[w].slice(pre, cq.members[w].length - suf).join(' '));
    }
    var text = cq.pre.join(' ') + ' ' + mids.join('/');
    if (suf) text += ' ' + cq.suf.join(' ');
    parts.push(text.replace(/\s+/g, ' ').trim());
  }
  return parts.join(', ');
}

function ssCommonPrefix(a, b) {
  var n = Math.min(a.length, b.length), i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** 뒤에서부터 같은 토큰 수. 양쪽 모두 가운데가 최소 1토큰은 남도록 멈춘다. */
function ssCommonSuffix(a, b, minKeep) {
  var i = 0, la = a.length, lb = b.length;
  while (i < la && i < lb &&
         a[la - 1 - i] === b[lb - 1 - i] &&
         (la - i) > minKeep && (lb - i) > minKeep) i++;
  return i;
}

/* ── 7단계 · 재고 배분 ────────────────────────────────── */

function ssAllocateStock(units, masters) {
  var need = {};
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (u.품목누락) continue;
    need[u.품목코드] = (need[u.품목코드] || 0) + u.수량;
  }
  var stock = masters.stock || {};
  var short = {};
  for (var code in need) {
    if (!Object.prototype.hasOwnProperty.call(need, code)) continue;
    var s = need[code] - ssNum(stock[code]);
    short[code] = s > 0 ? s : 0;
  }
  for (var j = 0; j < units.length; j++) {
    units[j].총필요수량 = need[units[j].품목코드] || 0;
    units[j].현재고 = ssNum(stock[units[j].품목코드]);
    units[j].부족수량 = short[units[j].품목코드] || 0;
  }
  return units;
}

/* ── 8단계 · 라우팅 (배타적 단일 값) ──────────────────── */

function ssRoute(units, masters, cfg, warnings) {
  var allow = [];
  ssText(cfg.허용상태).split(',').forEach(function (s) { if (s.trim()) allow.push(s.trim()); });
  var islandKw = masters.islandKeywords || [];
  var islandZip = masters.islandZips || {};
  var addrZip = masters.addrZip || {};
  var localAddr = masters.localAddrs || {};
  var holdIsland = ssText(cfg.도서산간_미확인) !== '일반출고';

  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    u.보류사유 = ''; u.보류상세 = '';

    if (u.품목누락) { u.route = SS_ROUTE.HOLD; u.보류사유 = '품목누락'; u.보류상세 = u.품목코드; continue; }
    if (!ssStatusOk(u.상태, allow)) {
      u.route = SS_ROUTE.HOLD; u.보류사유 = '상태보류';
      u.보류상세 = u.상태 || '(상태 없음)';
      continue;
    }
    var 자사 = u.출고지.indexOf(cfg.자사출고지접두) === 0;
    var 위탁 = (u.출고지 === cfg.위탁출고지);
    if (!자사 && !위탁) {
      u.route = SS_ROUTE.HOLD; u.보류사유 = '출고지미정';
      u.보류상세 = u.출고지 || '(출고지 없음)';
      continue;
    }
    if (위탁 && u.부족수량 > 0) { u.route = SS_ROUTE.PARTNER; continue; }

    var addr = ssNormAddr(u.주소1);
    u.정규주소 = addr;

    if (localAddr[addr]) { u.route = SS_ROUTE.LOTTE_LOCAL; continue; }

    var 후보 = false;
    for (var k = 0; k < islandKw.length; k++) {
      if (islandKw[k] && addr.indexOf(islandKw[k]) >= 0) { 후보 = true; break; }
    }
    if (후보) {
      var zip = ssText(addrZip[addr]);
      if (!zip) {
        if (holdIsland) {
          u.route = SS_ROUTE.HOLD; u.보류사유 = '도서산간미확인';
          u.보류상세 = addr;
          ssWarn(warnings, '주의', 'ISLAND_UNKNOWN', addr,
            '도서산간 후보 주소입니다. 「도서산간 우편번호」 탭에 우편번호를 입력하세요.');
          continue;
        }
        ssWarn(warnings, '주의', 'ISLAND_UNKNOWN', addr,
          '도서산간 후보인데 우편번호가 없어 일반 출고로 보냈습니다.');
      } else if (islandZip[zip]) {
        u.route = 위탁 ? SS_ROUTE.LOTTE_ISLAND_CONSIGN : SS_ROUTE.LOTTE_ISLAND;
        continue;
      }
    }
    u.route = SS_ROUTE.LOTTE;
  }
  return units;
}

/** 상태는 부분일치 — "품절임박"은 "임박"으로, "판매중(재고까지만)"은 "판매중"으로 통과 */
function ssStatusOk(status, allow) {
  var s = ssText(status);
  if (!s) return false;
  for (var i = 0; i < allow.length; i++) if (s.indexOf(allow[i]) >= 0) return true;
  return false;
}

/* ── 출력 행 만들기 ───────────────────────────────────── */

function ssOutRow(u) {
  return [
    u.출고지, u.순번, u.일자, u.품목코드, u.출력품목명 || ssDisplayName(u),
    u.박스수, u.수량, u.전화, u.모바일, u.주소1, u.배송메시지, u.합계,
    u.받는분, u.배송비, u.적요, u.사방넷주문번호, u.보내는분, u.보내는분전화, u.보내는주소
  ];
}

function ssLedgerRow(u, runKey, at) {
  return [
    runKey, u.라인ID, at, u.route, u.보류사유 || '', u.출고지, u.순번, u.일자,
    u.원본코드, u.품목코드, u.품목명, u.출력품목명 || ssDisplayName(u),
    u.박스수, u.주문수량, u.소요량, u.수량,
    u.조건ID || '', u.합포장그룹 || '', u.합포장대표 ? 'Y' : '',
    u.배송비, u.배송비산출, u.부족수량,
    u.받는분, u.전화, u.모바일, u.주소1, u.배송메시지, u.합계,
    u.적요, u.사방넷주문번호, u.보내는분, u.보내는분전화
  ];
}

/* ── 전체 실행 ────────────────────────────────────────── */

/**
 * @param {Array<Array>} grid  판매현황 원본 (헤더 포함)
 * @param {Object} masters     마스터 묶음
 * @param {Object} cfg         설정
 * @return {{buckets, warnings, units, stats}}
 */
function ssRun(grid, masters, cfg) {
  cfg = cfg || SS_DEFAULT_CONFIG;
  var warnings = [];

  var lines = ssNormalize(grid, cfg, warnings);
  var units = ssExplode(lines, masters, warnings);
  ssEnrich(units, masters, warnings);
  ssAssignCondition(units, masters, cfg);
  ssAllocateStock(units, masters);
  ssRoute(units, masters, cfg, warnings);
  for (var i = 0; i < units.length; i++) ssShippingFee(units[i], masters, warnings);
  ssMerge(units, cfg);

  var buckets = {};
  for (var k in SS_ROUTE) if (Object.prototype.hasOwnProperty.call(SS_ROUTE, k)) buckets[SS_ROUTE[k]] = [];
  var 출력건수 = 0, 흡수건수 = 0;
  for (var j = 0; j < units.length; j++) {
    var u = units[j];
    if (u.합포장흡수) { 흡수건수++; continue; }
    buckets[u.route].push(u);
    출력건수++;
  }

  var stats = {
    입력행: lines.length,
    분해행: units.length,
    합포장흡수: 흡수건수,
    출력행: 출력건수,
    보류: buckets[SS_ROUTE.HOLD].length,
    경고: warnings.length,
    버전: SS_VERSION
  };
  for (var b in buckets) {
    if (Object.prototype.hasOwnProperty.call(buckets, b)) stats['탭_' + b] = buckets[b].length;
  }

  // 행 보존 검증 — 분해행 = 출력행 + 흡수행 이어야 한다
  if (units.length !== 출력건수 + 흡수건수) {
    ssWarn(warnings, '오류', 'ROW_LOSS', '', '행 수가 맞지 않습니다. 분해 ' + units.length +
      ' ≠ 출력 ' + 출력건수 + ' + 합포장흡수 ' + 흡수건수);
  }

  return { buckets: buckets, warnings: warnings, units: units, stats: stats };
}

/* ── 레거시 배송비 문자열 → 규칙 테이블 (1회성 이관) ──── */

/**
 * 이카운트 CONT2 자유입력 문자열을 파싱해 (수량, 배송비, 완박스) 행으로 편다.
 * 예) "2개-3000/3개(완박스)-3600/10개-2500"
 * 파싱은 이관 시점 한 번만 하고, 이후 실행은 테이블만 본다.
 */
function ssParseFeeRule(code, raw) {
  var rows = [], bad = [];
  var s = ssText(raw);
  if (!s) return { rows: rows, bad: bad };
  var chunks = s.split(/[\/\n,]+/);
  for (var i = 0; i < chunks.length; i++) {
    var t = chunks[i].trim();
    if (!t) continue;
    var m = t.match(/(\d+)\s*개\s*(\([^)]*\))?\s*[-–—]\s*(\d+)/);
    if (!m) { bad.push(t); continue; }
    rows.push({
      code: code,
      qty: parseInt(m[1], 10),
      fee: parseInt(m[3], 10),
      fullBox: !!(m[2] && /완박스/.test(m[2])),
      src: t
    });
  }
  return { rows: rows, bad: bad };
}

/* Node에서 require 할 수 있게 — GAS에서는 이 블록이 그냥 무시된다 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SS_VERSION: SS_VERSION, SS_ROUTE: SS_ROUTE,
    SS_OUT_HEADER: SS_OUT_HEADER, SS_HOLD_HEADER: SS_HOLD_HEADER,
    SS_LEDGER_HEADER: SS_LEDGER_HEADER, SS_WARN_HEADER: SS_WARN_HEADER,
    SS_FEE_RULE_HEADER: SS_FEE_RULE_HEADER, SS_DEFAULT_CONFIG: SS_DEFAULT_CONFIG,
    ssRun: ssRun, ssNormalize: ssNormalize, ssExplode: ssExplode, ssEnrich: ssEnrich,
    ssAssignCondition: ssAssignCondition, ssAllocateStock: ssAllocateStock,
    ssRoute: ssRoute, ssMerge: ssMerge, ssShippingFee: ssShippingFee,
    ssCompressNames: ssCompressNames, ssParseFeeRule: ssParseFeeRule,
    ssOutRow: ssOutRow, ssLedgerRow: ssLedgerRow, ssDisplayName: ssDisplayName,
    ssStripName: ssStripName, ssNormAddr: ssNormAddr, ssPad6: ssPad6
  };
}
