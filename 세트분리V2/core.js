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
  MERGED: '합포장동봉',
  NONSHIP: '비배송',
  HOLD: '보류'
};

/** 출력 탭 공통 19열 (구 로젠택배 탭과 동일한 열 구성, 이름만 롯데) */
var SS_OUT_HEADER = [
  '출고지', '순번', '일자-No.', '품목코드', '품목명', '택배박스수량', '수량',
  '전화', '모바일', '주소1', '배송메시지', '합계', '거래처명', '단품배송비',
  '적요', '사방넷주문번호', '보내는분', '보내는분전화', '보내는주소(팩투유)'
];

/**
 * 보류 탭 — 뒤 2열은 사람이 적는 칸이다.
 *   조치   「발송」 이라고 적으면 자체 출고, 업체코드(JH·HP…)를 적으면 그 업체로 대리발송
 *   메모   왜 그렇게 판단했는지
 * 칸을 나눌 이유가 없어 하나로 합쳤다. 무엇을 적었는지로 뜻이 갈린다.
 */
var SS_HOLD_HEADER = SS_OUT_HEADER.concat(['보류사유', '상세', '조치', '메모']);

/**
 * 대리발송 탭 — 앞 19열은 다른 출력 탭과 똑같이 두고 뒤에 업체 정보를 붙인다.
 * 그래야 업체 양식으로 복사할 때 열 위치가 어긋나지 않는다. (T=업체코드)
 */
var SS_PARTNER_HEADER = SS_OUT_HEADER.concat(['업체코드', '업체명', '조치']);

/**
 * 비배송 탭 — 물건이 아니라 금액만 오가는 줄.
 * 적립금·반품배송비·할인 같은 것들이다. 송장은 안 나가지만
 * 일일마감 매출 집계에 쓰이므로 버리지 않고 여기에 모아 원장에도 그대로 남긴다.
 */
var SS_NONSHIP_HEADER = SS_OUT_HEADER.concat(['비배송사유']);

/** 수동조치 이력 — 보류를 사람이 되살린 기록. 지우지 않는다 */
var SS_MANUAL_HEADER = ['등록일', '고유ID', '원본코드', '조치', '업체코드', '메모',
  '등록회차', '등록시각', '최근적용회차'];

var SS_VENDOR_HEADER = ['업체코드', '업체명'];

/** 합배송 탭 — 대표행과 동봉행을 한자리에 모아 박스 구성이 보이게 한다 */
var SS_MERGED_HEADER = ['구분', '조건ID', '실제경로', '합포장키'].concat(SS_OUT_HEADER);

/** 도서산간 탭 — 롯데 요금 구분(제주연계 / 도선료·산간료)에 맞춘 권역을 앞에 붙인다 */
var SS_ISLAND_HEADER = ['권역', '우편번호', '판정'].concat(SS_OUT_HEADER);

var SS_LEDGER_HEADER = [
  '회차키', '라인ID', '고유ID', '주문번호출처', '실행시각', '경로', '보류사유', '출고지', '순번', '일자-No.',
  '원본품목코드', '품목코드', '품목명', '출력품목명', '택배박스수량', '주문수량', '소요량', '수량',
  '조건ID', '합포장그룹', '합포장대표', '배송비', '배송비산출', '부족수량',
  '도서권역', '우편번호', '도서판정', '주소변경', '원받는분', '원주소', '원연락처',
  '거래처명', '전화', '모바일', '주소1', '배송메시지', '합계',
  '적요', '사방넷주문번호', '보내는분', '보내는분전화',
  '운송장번호', '송장매칭'
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
  동네배송_사용: '중단',
  도서산간_미확인: '보류',
  도서산간_판정: '우편번호우선',
  전화주문_고유ID: '주문번호칸에채움',
  재고부족_자동대리발송: '사용',
  합포장_최대건수: '0',
  비배송_품목패턴: '적립금|반품배송비|배송비|할인|쿠폰|수수료|차감'
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

/* ── 적요의 배송지 변경 ───────────────────────────────── */

/**
 * 전화주문은 배송지가 바뀌면 적요에 「전화번호/주소」 로 적어 둔다.
 *   010-8711-4550/세종특별자치시 도움8로 11-11, 1층 120호(어진동,어진프라자)
 *
 * 배송지를 자동으로 바꾸는 건 위험하므로 조건을 좁게 잡는다.
 *   · 앞부분이 0으로 시작하는 9~12자리 전화번호
 *   · 뒷부분이 6자 이상이고 한국 주소 낱말(시·군·구·읍·면·동·리·로·길)을 포함
 * 하나라도 어긋나면 손대지 않는다.
 *
 * "09/02 출고요청" · "2개-3000/3개-3000" · "2026/09/02" 같은 건 걸리지 않는다.
 *
 * 전화주문(이카운트 출처)에만 쓴다. 사방넷·주문서 주문은 쇼핑몰이 준 배송지가 정답이다.
 */
function ssLooksPhone(s) {
  var t = ssText(s);
  if (!t) return false;
  if (t.replace(/[0-9\-\s]/g, '') !== '') return false;   // 숫자·하이픈·공백만
  var d = t.replace(/[^0-9]/g, '');
  return d.length >= 9 && d.length <= 12 && d.charAt(0) === '0';
}

function ssParseAddrOverride(memo) {
  var s = ssText(memo);
  if (!s || s.indexOf('/') < 0) return null;
  var parts = s.split('/');

  // 전화번호가 어디 있느냐로 형식을 가른다
  //   이름/전화/주소  → parts[1] 이 전화
  //   전화/주소       → parts[0] 이 전화
  var pi = -1;
  if (parts.length >= 3 && ssLooksPhone(parts[1])) pi = 1;
  else if (ssLooksPhone(parts[0])) pi = 0;
  else if (parts.length >= 2 && ssLooksPhone(parts[1])) pi = 1;
  if (pi < 0) return null;

  var addr = parts.slice(pi + 1).join('/').trim();   // 주소 안에 / 가 있어도 살린다
  if (addr.length < 6) return null;
  if (!/(시|도|군|구|읍|면|동|리|로|길)/.test(addr)) return null;

  var name = pi === 1 ? ssText(parts[0]) : '';
  if (name.length > 25) return null;                 // 이름치고 너무 길면 이 형식이 아니다
  if (name && /(로|길)\s*[0-9]/.test(name)) return null;   // 주소 조각이 앞에 온 경우

  return { name: name, phone: ssText(parts[pi]), addr: addr };
}

/* ── 고유ID ───────────────────────────────────────────── */

/** FNV-1a 32bit — 짧고 결정적이면 충분하다 (암호용 아님) */
function ssHash4(s) {
  var h = 0x811c9dc5;
  var t = ssText(s);
  for (var i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-4);
}

/** 자릿수를 지정하는 판 */
function ssHashN(s, n) {
  var h = 0x811c9dc5;
  var t = ssText(s);
  for (var i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-(n || 5));
}

/**
 * 전화주문처럼 주문번호가 없는 건에 붙일 고유ID.
 *
 * 판매현황은 하루 두 번 통째로 다시 받는다.
 * 그래서 순번 기반이나 랜덤(UUID)은 쓸 수 없다 — 회차마다 값이 달라진다.
 * 전표번호와 주문 내용만으로 계산해 **같은 주문이면 언제 계산해도 같은 값**이 나온다.
 *
 *   260902-PH-a3f19
 *    └날짜   └표식 └전표·수취인·연락처·주소·품목·수량 해시
 *
 * 상품정보 시트의 「MMdd-ds-xxxx」(발주수집이 발급)와 나란한 형태지만
 * 뒷자리가 랜덤이 아니라 내용 해시다 — 랜덤이면 회차마다 값이 달라진다.
 */
function ssMakeOrderId(L) {
  var 일자 = ssText(L.일자);
  var parts = 일자.split('-');
  var digits = ssText(parts[0]).replace(/[^0-9]/g, '');
  var ymd = digits.length >= 8 ? digits.slice(2, 8) : digits;
  var no = ssText(parts[1]).replace(/[^0-9]/g, '') || '0';
  // 배송지가 바뀌어도 같은 주문이므로 원래 값으로 계산한다.
  // 그래야 오전에 발급한 ID가 오후 회차에서도 그대로다.
  var seed = [
    no, ssNorm(L.원받는분 || L.받는분),
    ssText(L.원연락처) || ssText(L.모바일) || ssText(L.전화),
    ssNorm(L.원주소1 || L.주소1), ssText(L.원본코드), ssText(L.주문수량)
  ].join('|');
  return ymd + '-PH-' + ssHashN(seed, 5);
}


/**
 * 판매현황 O열「주문자명(사방넷)」을 채울 값을 만든다.
 *
 * 사방넷·대리판매는 이미 「이름/고유아이디」 형식으로 들어온다. 전화주문만 비어 있으니
 * 같은 형식으로 채워 O열 하나로 전 주문이 통일되게 한다.
 *   거래처명 「행주국수 김순해」 + PH-ID  →  「행주국수 김순해/260902-PH-303d4」
 *
 * 이미 값이 있는 행은 손대지 않는다. 쇼핑몰이 확정해 보낸 값이 사실이다.
 * 반환: [{ 행: 0기준 행번호, 값: 이름/ID }]
 */
function ssSalesIdCells(lines) {
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    if (L._행 === undefined) continue;
    // 판정은 주문번호출처로 한다. 사방넷주문번호 칸은 설정에 따라 PH-ID 로
    // 덮어써지므로 그것만 보면 전화주문을 사방넷으로 오인한다.
    if (L.주문번호출처 !== '자동발급') continue;   // 사방넷·대리판매는 그대로 둔다
    var id = ssText(L.고유ID);
    if (!id) continue;
    // 상호와 이름이 거래처명에 있다. 비어 있으면 받는분으로 대신한다.
    var who = ssNorm(L.거래처명원본) || ssNorm(L.받는분);
    out.push({ 행: L._행, 값: who ? who + '/' + id : id });
  }
  return out;
}

/**
 * 판매현황 내용의 지문. 같은 자료를 다시 돌리면 같은 값이 나온다.
 * 이걸로 「같은 회차 재실행」과 「새 회차」를 구분한다.
 */
function ssFingerprint(lines) {
  var parts = [];
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    parts.push(L.일자 + '|' + L.원본코드 + '|' + L.주문수량 + '|' + ssNorm(L.받는분) + '|' + ssNorm(L.주소1));
  }
  parts.sort();
  return ssHash4(parts.join('~')) + ssHash4(parts.length + '~' + parts.join('#'));
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
  var issued = {};
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

    var line = {
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
    };

    // 적요에 배송지 변경이 적혀 있으면 갈아 끼운다. 원래 값은 남겨 둔다.
    // 전화주문(이카운트 직접 입력)에만 적용한다.
    // 사방넷·주문서 주문은 배송지가 쇼핑몰에서 확정되어 오므로 적요로 덮어쓰지 않는다.
    var ovAddr = (출처 === '이카운트') ? ssParseAddrOverride(line.적요) : null;
    if (ovAddr) {
      line.원받는분 = line.받는분;
      line.원주소1 = line.주소1;
      line.원연락처 = line.모바일 || line.전화;
      line.주소1 = ovAddr.addr;
      line.모바일 = ovAddr.phone;
      if (ovAddr.name) line.받는분 = ovAddr.name.slice(0, 25);
      line.주소변경 = ovAddr.name ? '적요(이름·연락처·주소)' : '적요(연락처·주소)';
      ssWarn(warnings, '주의', 'ADDR_OVERRIDE', line.순번,
        '적요대로 바꿨습니다: ' + ssText(line.원받는분).slice(0, 12) + ' / ' + ssText(line.원주소1).slice(0, 24) +
        '  →  ' + ssText(line.받는분).slice(0, 12) + ' / ' + ovAddr.addr.slice(0, 34));
    }
    line._행 = r;   // 판매현황 원본의 몇 번째 행인가 (0-기준). O열 되쓰기에 쓴다
    line.고유ID = ssText(line.사방넷주문번호) || ssMakeOrderId(line);
    if (line.주문번호출처 !== undefined) { /* noop */ }
    if (!ssText(line.사방넷주문번호)) {
      var base = line.고유ID, n = 1;
      while (issued[line.고유ID]) { n++; line.고유ID = base + '-' + n; }
      issued[line.고유ID] = true;
      if (n > 1) {
        ssWarn(warnings, '주의', 'ID_COLLISION', line.고유ID,
          '같은 회차에 동일한 고유ID가 계산되어 뒤에 순번을 붙였습니다.');
      }
    }
    line.주문번호출처 = ssText(line.사방넷주문번호) ? '사방넷' : '자동발급';
    if (line.주문번호출처 === '자동발급' && ssText(cfg.전화주문_고유ID) === '주문번호칸에채움') {
      line.사방넷주문번호 = line.고유ID;
    }
    out.push(line);
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

/**
 * 상태·출고지는 「원본 세트 코드」 기준, 품목명·배송비는 「구성품 코드」 기준.
 * (구 시트도 이 규칙이다 — 변환!B:C 는 판매현황 품목코드로 조회하고,
 *  품목명·배송비는 합배송 단계에서 분해된 코드로 다시 조회한다.
 *  세트가 판매중이면 그 구성품도 함께 나간다는 뜻)
 */
function ssEnrich(units, masters, warnings) {
  var items = masters.items || {};
  var missing = {};
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var m = items[u.품목코드];
    var head = items[u.원본코드] || m;
    if (head) { u.상태 = head.status || ''; u.출고지 = head.origin || ''; }
    if (!m) {
      u.품목명 = u.세트분해 ? '(품목정보 없음) ' + u.품목코드 : u.원본품목명;
      u.단품배송비 = 0; u.배송비규칙원문 = '';
      u.품목누락 = true;
      if (!missing[u.품목코드]) {
        missing[u.품목코드] = true;
        ssWarn(warnings, '오류', 'ITEM_MISSING', u.품목코드,
          '상품정보(ALL)에 없는 품목입니다. 라우팅할 수 없어 보류합니다.');
      }
      continue;
    }
    u.품목명 = m.name || u.원본품목명;
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

/**
 * 품목명 첫 토큰이 협력업체 코드다.  "JH 실링 23189…" → JH
 * 대리발송업체 표에 있는 코드만 인정한다.
 */
function ssVendorOf(u, vendors) {
  var name = ssText(u.품목명) || ssText(u.원본품목명);
  var head = name.split(' ')[0];
  if (head && vendors && vendors[head]) return head;
  return '';
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
  // 0 이면 제한 없음 — 구 시트와 같은 동작이다.
  // 박스당 건수를 제한하고 싶으면 설정에서 숫자를 넣는다.
  var cap = ssNum(cfg && cfg.합포장_최대건수);
  if (!(cap > 0)) cap = 0;

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

    // 한 박스에 담기는 건수에 한계가 있다 (기본 10건).
    // 넘치면 잘라서 박스를 나누고, 박스마다 대표를 따로 둔다.
    var boxes = [];
    if (cap > 0) { for (var st = 0; st < g.length; st += cap) boxes.push(g.slice(st, st + cap)); }
    else boxes.push(g);

    for (var b = 0; b < boxes.length; b++) {
      var box = boxes[b];
      if (box.length < 2) continue;          // 남은 1건은 단독 출고

      var boxKey = key + (boxes.length > 1 ? ' #' + (b + 1) : '');
      var maxFee = 0, sample = false, names = [];
      for (var j = 0; j < box.length; j++) {
        box[j].합포장그룹 = boxKey;
        if (box[j].배송비 > maxFee) maxFee = box[j].배송비;
        if (/^\[샘플\]/.test(box[j].품목명)) sample = true;
        names.push(ssStripName(box[j].품목명));
      }

      var rep = box[0];
      rep.합포장대표 = true;
      rep.배송비 = maxFee;
      rep.박스수 = 1;
      rep.배송비산출 = '합포장 최대 ' + maxFee + ' (' + box.length + '건' +
        (boxes.length > 1 ? ' · ' + (b + 1) + '/' + boxes.length + '박스' : '') + ')';
      rep.출력품목명 = (sample ? '[샘플] ' : '') + ssCompressNames(names) + ' ===합배송' +
        (boxes.length > 1 ? '(' + (b + 1) + '/' + boxes.length + ')' : '');
      for (var k = 1; k < box.length; k++) box[k].합포장흡수 = true;

      // 롯데 업로드에는 대표 하나만 올라가야 인식된다. 동봉행은 출력에서 뺀다.
      // 「사방넷송장」 탭이 동봉 주문번호를 들고 있다가 대표의 송장번호를 그대로 받는다.
      for (var q = 0; q < box.length; q++) {
        box[q].실경로 = box[q].route;
        if (box[q].합포장흡수) {
          box[q].배송비 = 0;
          box[q].박스수 = 0;
          box[q].배송비산출 = '합포장 동봉 (대표행에 청구)';
          box[q].route = SS_ROUTE.MERGED;
        }
      }
    }
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

/**
 * 물건이 오가지 않는 줄인가.
 *   · 합계가 음수 (반품·차감)
 *   · 품목명이 설정한 패턴에 걸림 (적립금·반품배송비·할인…)
 *   · 품목코드가 숫자뿐 (이카운트 회계 코드)
 * 매출에는 잡히지만 송장은 안 나간다.
 */
function ssNonShipReason(u, cfg) {
  var name = ssText(u.품목명) || ssText(u.원본품목명);
  var code = ssText(u.원본코드) || ssText(u.품목코드);
  if (ssNum(u.합계) < 0) return '금액 음수 (' + u.합계 + ')';
  var pat = ssText(cfg && cfg.비배송_품목패턴);
  if (pat) {
    var words = pat.split('|');
    for (var i = 0; i < words.length; i++) {
      var w = ssText(words[i]);
      if (w && name.indexOf(w) >= 0) return '품목명에 「' + w + '」';
    }
  }
  if (code && /^[0-9]+$/.test(code)) return '품목코드가 숫자뿐 (' + code + ')';
  return '';
}

/* ── 8단계 · 라우팅 (배타적 단일 값) ──────────────────── */

function ssRoute(units, masters, cfg, warnings) {
  var allow = [];
  ssText(cfg.허용상태).split(',').forEach(function (s) { if (s.trim()) allow.push(s.trim()); });
  var islandKw = masters.islandKeywords || [];
  var islandZip = masters.islandZips || {};
  var addrZip = masters.addrZip || {};
  var localAddr = (ssText(cfg.동네배송_사용) === '사용') ? (masters.localAddrs || {}) : {};
  var holdIsland = ssText(cfg.도서산간_미확인) !== '일반출고';

  // 한 글자 키워드는 시/군을 가려내지 못한다.
  // 예전 목록의 「중」은 중구·중랑구·중앙로·궁중보쌈까지 전부 후보로 만들었다.
  for (var kk = 0; kk < islandKw.length; kk++) {
    var kw = islandKw[kk];
    if (kw && ssText(kw.kw).length < 2) {
      kw.skip = true;
      ssWarn(warnings, '주의', 'ISLAND_KW', kw.kw,
        '한 글자 키워드라 무시했습니다. 시/군 이름을 두 글자 이상으로 적어 주세요.');
    }
  }

  var override = masters.override || {};
  var vendors = masters.vendors || {};

  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    u.보류사유 = ''; u.보류상세 = '';
    u.업체코드 = ssVendorOf(u, vendors);
    u.업체명 = u.업체코드 ? vendors[u.업체코드] : '';

    // 사람이 보류 탭에서 되살린 건
    var ov = override[ssText(u.고유ID) + '|' + ssText(u.원본코드)];
    // 조치를 비워 두고 업체코드만 적었으면 대리발송으로 본다 (타이핑 한 번 줄이기)
    if (ov && !ssText(ov.조치) && ssText(ov.업체코드)) ov = { 조치: '대리발송', 업체코드: ov.업체코드, 메모: ov.메모 };
    // 입력 칸은 매 실행 비운다.
    // 되비춰 주면 지워서 취소하려 해도 다음 실행에 다시 채워져 취소할 방법이 없다.
    // 내린 결정은 「수동조치」 탭에 남으므로 여기서 다시 보여 줄 필요가 없다.
    u.수동조치 = '';
    u.조치입력 = ''; u.업체코드입력 = ''; u.메모입력 = '';
    if (ov) {
      u.수동조치 = ov.조치;
      if (ov.업체코드) { u.업체코드 = ov.업체코드; u.업체명 = vendors[ov.업체코드] || ''; }
      if (ov.조치 === '대리발송') {
        // 「대리발송업체」 표에 등록된 코드일 때만 넘긴다.
        // 없는 코드로 넘기면 어느 업체로 갔는지 아무도 모르는 건이 생긴다.
        var vc = ssText(ov.업체코드) || u.업체코드;
        if (!vc || !vendors[vc]) {
          u.route = SS_ROUTE.HOLD;
          u.보류사유 = '업체코드확인';
          u.보류상세 = vc ? ('「대리발송업체」에 없는 코드: ' + vc) : '업체코드가 비어 있음';
          var codes = [];
          for (var vk in vendors) if (Object.prototype.hasOwnProperty.call(vendors, vk)) codes.push(vk);
          codes.sort();
          ssWarn(warnings, '오류', 'MANUAL_NO_VENDOR', u.고유ID + ' / ' + (vc || '(없음)'),
            '등록된 업체코드가 아닙니다. 「대리발송업체」 탭에 추가하거나 다음 중에서 고르세요 — ' +
            codes.join(', '));
          continue;
        }
        u.업체코드 = vc;
        u.업체명 = vendors[vc];
        u.route = SS_ROUTE.PARTNER;
        continue;
      }
    }
    var 면제 = ov && ov.조치 === '발송';

    // 물건이 아닌 줄은 보류가 아니라 비배송으로 뺀다. 매출 집계에는 그대로 남는다.
    if (!면제) {
      var ns = ssNonShipReason(u, cfg);
      if (ns) { u.route = SS_ROUTE.NONSHIP; u.비배송사유 = ns; continue; }
    }

    if (u.품목누락) {
      if (!면제) { u.route = SS_ROUTE.HOLD; u.보류사유 = '품목누락'; u.보류상세 = u.품목코드; continue; }
      ssWarn(warnings, '주의', 'MANUAL_MISSING_ITEM', u.품목코드,
        '품목정보가 없는데 수동으로 발송 처리했습니다. 품목명·배송비가 비어 있을 수 있습니다.');
    }
    if (!면제 && !ssStatusOk(u.상태, allow)) {
      u.route = SS_ROUTE.HOLD; u.보류사유 = '상태보류';
      u.보류상세 = u.상태 || '(상태 없음)';
      continue;
    }
    var 자사 = u.출고지.indexOf(cfg.자사출고지접두) === 0;
    var 위탁 = (u.출고지 === cfg.위탁출고지);
    if (!자사 && !위탁) {
      if (!면제) {
        u.route = SS_ROUTE.HOLD; u.보류사유 = '출고지미정';
        u.보류상세 = u.출고지 || '(출고지 없음)';
        continue;
      }
      자사 = true;   // 수동 발송 지정이면 자사 출고로 본다
    }
    if (위탁 && u.부족수량 > 0) {
      // 「사용」이면 구 시트처럼 자동으로 협력업체 발주로 넘긴다.
      // 「안함」이면 미발송에 세워 두고, 사람이 업체코드를 적어 필요한 건만 토스한다.
      if (ssText(cfg.재고부족_자동대리발송) !== '안함') { u.route = SS_ROUTE.PARTNER; continue; }
      u.route = SS_ROUTE.HOLD;
      u.보류사유 = '재고부족';
      u.보류상세 = '부족 ' + u.부족수량 + '개 (필요 ' + u.총필요수량 + ' / 재고 ' + u.현재고 + ')' +
        (u.업체코드 ? ' · 기본업체 ' + u.업체코드 : '');
      continue;
    }

    var addr = ssNormAddr(u.주소1);
    u.정규주소 = addr;

    if (localAddr[addr]) { u.route = SS_ROUTE.LOTTE_LOCAL; continue; }

    var zip = ssText(addrZip[addr]);
    u.우편번호 = zip;

    // 1) 우편번호가 있으면 그것만으로 끝난다. 도시 이름은 보지 않는다.
    if (zip) {
      if (islandZip[zip]) {
        u.도서권역 = islandZip[zip];
        u.도서판정 = '우편번호';
        u.route = 위탁 ? SS_ROUTE.LOTTE_ISLAND_CONSIGN : SS_ROUTE.LOTTE_ISLAND;
        continue;
      }
      u.route = SS_ROUTE.LOTTE;
      continue;
    }

    // 2) 우편번호가 아직 없을 때만 지역명을 본다
    var 확정 = '', 후보 = false;
    for (var k = 0; k < islandKw.length; k++) {
      if (!islandKw[k] || islandKw[k].skip) continue;
      if (addr.indexOf(islandKw[k].kw) < 0) continue;
      후보 = true;
      if (islandKw[k].confirm) { 확정 = islandKw[k].zone || '도서'; break; }
    }
    if (확정) {
      // 제주·울릉처럼 시/군 전체가 도서인 곳은 우편번호가 없어도 확정
      u.도서권역 = 확정;
      u.도서판정 = '지역확정';
      u.route = 위탁 ? SS_ROUTE.LOTTE_ISLAND_CONSIGN : SS_ROUTE.LOTTE_ISLAND;
      continue;
    }
    if (후보) {
      if (holdIsland && !면제) {
        u.route = SS_ROUTE.HOLD; u.보류사유 = '도서산간미확인';
        u.보류상세 = addr;
        ssWarn(warnings, '주의', 'ISLAND_UNKNOWN', addr,
          '우편번호를 구하지 못해 도서산간 여부를 확정할 수 없습니다.');
        continue;
      }
      ssWarn(warnings, '주의', 'ISLAND_UNKNOWN', addr,
        '우편번호를 구하지 못해 일반 출고로 보냈습니다. 도서산간이면 추가운임이 누락됩니다.');
    }
    u.route = SS_ROUTE.LOTTE;
  }

  // 지정이 실제로 결과를 바꿨는지 표시한다.
  // 업체코드가 틀려 보류에 남은 건은 「쓰지 못한 것」이므로 소진시키지 않는다.
  for (var z = 0; z < units.length; z++) {
    units[z].수동조치적용 = !!(units[z].수동조치 && units[z].route !== SS_ROUTE.HOLD);
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

function ssIslandRow(u) {
  return [u.도서권역 || '', u.우편번호 || '', u.도서판정 || ''].concat(ssOutRow(u));
}

function ssNonshipRow(u) {
  return ssOutRow(u).concat([u.비배송사유 || '']);
}

function ssPartnerRow(u) {
  return ssOutRow(u).concat([u.업체코드 || '', u.업체명 || '', u.수동조치 || '']);
}

function ssHoldRow(u) {
  return ssOutRow(u).concat([u.보류사유 || '', u.보류상세 || '', u.조치입력 || '', u.메모입력 || '']);
}

function ssMergedRow(u) {
  return [u.합포장대표 ? '대표' : '동봉', u.조건ID || '', u.실경로 || '', u.합포장그룹 || '']
    .concat(ssOutRow(u));
}

function ssLedgerRow(u, runKey, at) {
  return [
    runKey, u.라인ID, u.고유ID || '', u.주문번호출처 || '', at, u.route, u.보류사유 || '', u.출고지, u.순번, u.일자,
    u.원본코드, u.품목코드, u.품목명, u.출력품목명 || ssDisplayName(u),
    u.박스수, u.주문수량, u.소요량, u.수량,
    u.조건ID || '', u.합포장그룹 || '', u.합포장대표 ? 'Y' : '',
    u.배송비, u.배송비산출, u.부족수량,
    u.도서권역 || '', u.우편번호 || '', u.도서판정 || '',
    u.주소변경 || '', u.원받는분 || '', u.원주소1 || '', u.원연락처 || '',
    u.받는분, u.전화, u.모바일, u.주소1, u.배송메시지, u.합계,
    u.적요, u.사방넷주문번호, u.보내는분, u.보내는분전화,
    '', ''
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
  var 지문 = ssFingerprint(lines);
  var units = ssExplode(lines, masters, warnings);
  ssEnrich(units, masters, warnings);
  ssAssignCondition(units, masters, cfg);
  ssAllocateStock(units, masters);
  ssRoute(units, masters, cfg, warnings);
  for (var i = 0; i < units.length; i++) ssShippingFee(units[i], masters, warnings);
  ssMerge(units, cfg);

  var buckets = {};
  for (var k in SS_ROUTE) if (Object.prototype.hasOwnProperty.call(SS_ROUTE, k)) buckets[SS_ROUTE[k]] = [];
  var 흡수건수 = 0;
  for (var j = 0; j < units.length; j++) {
    var u = units[j];
    if (u.합포장흡수) 흡수건수++;
    buckets[u.route].push(u);
  }
  buckets[SS_ROUTE.MERGED].sort(function (a, b) {
    return a.합포장그룹 < b.합포장그룹 ? -1 : (a.합포장그룹 > b.합포장그룹 ? 1 : 0);
  });

  // 「합배송」 확인용 뷰 — 대표행(송장 나감) + 동봉행(같은 박스)을 묶음 단위로 모은다.
  // 대표행은 롯데택배 등에도 그대로 있으므로 이 목록은 탭 합계에 넣지 않는다.
  var 합배송뷰 = [];
  for (var vi = 0; vi < units.length; vi++) if (units[vi].합포장그룹) 합배송뷰.push(units[vi]);
  합배송뷰.sort(function (a, b) {
    if (a.합포장그룹 !== b.합포장그룹) return a.합포장그룹 < b.합포장그룹 ? -1 : 1;
    return (a.합포장대표 ? 0 : 1) - (b.합포장대표 ? 0 : 1);
  });
  var 출력건수 = units.length;

  var stats = {
    입력행: lines.length,
    분해행: units.length,
    합포장흡수: 흡수건수,
    출력행: 출력건수,
    // 송장이 실제로 나가는 건수 — 합포장 동봉·보류·비배송은 빠진다
    // 실제로 발행되는 송장 수 — 합포장 동봉분은 대표와 같은 송장을 쓴다
    송장건수: units.length - 흡수건수 - buckets[SS_ROUTE.HOLD].length - buckets[SS_ROUTE.NONSHIP].length,
    보류: buckets[SS_ROUTE.HOLD].length,
    경고: warnings.length,
    지문: 지문,
    버전: SS_VERSION
  };
  for (var b in buckets) {
    if (Object.prototype.hasOwnProperty.call(buckets, b)) stats['탭_' + b] = buckets[b].length;
  }

  // 행 보존 검증 — 분해된 모든 행이 정확히 한 탭에 들어가야 한다
  var 탭합계 = 0;
  for (var bb in buckets) if (Object.prototype.hasOwnProperty.call(buckets, bb)) 탭합계 += buckets[bb].length;
  if (units.length !== 탭합계) {
    ssWarn(warnings, '오류', 'ROW_LOSS', '', '행 수가 맞지 않습니다. 분해 ' + units.length +
      ' ≠ 탭 합계 ' + 탭합계);
  }

  return { buckets: buckets, warnings: warnings, units: units, stats: stats,
    합배송뷰: 합배송뷰, idCells: ssSalesIdCells(lines) };
}

/* ── 사방넷 송장 등록용 ───────────────────────────────── */

var SS_INVOICE_HEADER = ['주문번호', '품목코드', '구분', '합포장키', '대표주문번호',
  '운송장번호', '경로', '받는분', '품목명', '주문출처', '사방넷등록', '택배사'];

/**
 * 사방넷이 아는 주문번호인가.
 * 사방넷 번호는 숫자뿐이다. 시스템이 발급한 ID 는 전부 걸러야 한다:
 *   0902-ds-e158   상품정보 발주수집 발급 (허브 _po_isGeneratedUid_ 와 같은 판별)
 *   260903-PH-…    세트분리 전화주문 발급
 */
function ssIsSabangnetUid(uid) {
  var u = ssText(uid);
  if (!u) return false;
  if (/^\d{4}-[A-Za-z]{2}-/.test(u)) return false;   // MMdd-ds- 형
  if (/^\d{6}-PH-/.test(u)) return false;            // YYMMDD-PH- 형
  return /^\d+$/.test(u);
}

/**
 * 사방넷에 송장번호를 대량 등록할 때 쓰는 목록.
 *
 * 롯데에는 합포장 대표 하나만 올라가므로 송장번호도 대표 주문번호로만 돌아온다.
 * 동봉된 주문들은 같은 박스에 들어갔으니 같은 송장번호를 받아야 하는데,
 * 롯데 실적에는 그 주문번호가 아예 없다.
 * 그래서 여기에 「어느 대표를 따라가면 되는지」를 미리 적어 둔다.
 */
function ssInvoiceRows(units) {
  var 대표번호 = {};
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (u.합포장대표 && u.합포장그룹) 대표번호[u.합포장그룹] = ssText(u.사방넷주문번호);
  }
  var out = [], seenReg = {};
  for (var j = 0; j < units.length; j++) {
    var v = units[j];
    if (v.route === SS_ROUTE.HOLD || v.route === SS_ROUTE.NONSHIP) continue;
    var 구분 = v.합포장대표 ? '대표' : (v.합포장흡수 ? '동봉' : '단독');
    var uid = ssText(v.사방넷주문번호);
    var 출처 = ssText(v.주문번호출처);
    // 사방넷 대량등록은 주문번호당 한 줄이면 된다. 첫 줄에만 표시를 남긴다.
    // 전화주문(자동발급 ID)은 사방넷이 모르는 번호라 등록 대상이 아니다.
    var 등록 = '';
    if (ssIsSabangnetUid(uid) && !seenReg[uid]) { seenReg[uid] = true; 등록 = 'Y'; }
    out.push([
      uid, ssText(v.품목코드), 구분,
      ssText(v.합포장그룹), v.합포장흡수 ? (대표번호[v.합포장그룹] || '') : '',
      '', ssText(v.실경로 || v.route), ssText(v.받는분),
      ssText(v.출력품목명 || v.품목명), 출처, 등록, ''
    ]);
  }
  return out;
}

/* ── 중복발주 의심 ────────────────────────────────────── */

var SS_DUP_HEADER = ['확인', '그룹', '등급', '사유', '회차간', '회차', '고유ID', '경로',
  '받는분', '전화', '품목코드', '품목명', '수량', '금액', '주소'];

function ssNameKey(s) { return ssText(s).replace(/\s+/g, '').replace(/[()\[\]{}.,\-_\/]/g, ''); }
function ssPhoneDigits(s) { return ssText(s).replace(/[^0-9]/g, ''); }
function ssAddrKey(s) { return ssNormAddr(s).replace(/\s+/g, '').replace(/[()\[\]{}.,\-_\/]/g, ''); }

/**
 * 등급 정의 — 상품정보 시트 _partnerDupWatch.gs 와 같은 규칙을 쓴다.
 * 두 시스템이 서로 다른 판정을 내면 운영자가 무엇을 믿어야 할지 알 수 없다.
 * keyFn 이 빈 문자열을 돌려주면 그 레코드는 그 등급에서 빠진다.
 */
function ssDupLevels() {
  return [
    // 한 주문번호에 품목이 여럿일 수 있다. 품목까지 같아야 같은 건이다.
    { grade: '🔴 확실', reason: '동일 고유ID + 품목',
      keyFn: function (r) {
        if (!r.고유ID || !r.품목코드) return '';
        return 'U|' + r.고유ID + '|' + r.품목코드;
      } },

    // 배송지까지 같아야 같은 출고다.
    // 주소를 빼면 한 거래처가 여러 지점으로 보내는 정상 주문이 전부 걸린다.
    { grade: '🔴 확실', reason: '수취인+전화+주소+품목 일치',
      keyFn: function (r) {
        var n = ssNameKey(r.받는분), p = ssPhoneDigits(r.전화), a = ssAddrKey(r.주소);
        if (!n || !r.품목코드 || !a || p.length < 10) return '';
        return 'NPA|' + n + '|' + p + '|' + a + '|' + r.품목코드;
      } },

    { grade: '🟡 의심', reason: '수취인+주소+품목 일치 (전화 다름/없음)',
      keyFn: function (r) {
        var n = ssNameKey(r.받는분), a = ssAddrKey(r.주소);
        if (!n || !a || !r.품목코드) return '';
        return 'NA|' + n + '|' + a + '|' + r.품목코드;
      } },

    // 주소가 다르면 대개 정상이다 — 동명이인이거나 여러 지점으로 보내는 것.
    // 그래도 눈에는 걸어 둔다.
    { grade: '⚪ 참고', reason: '수취인+품목 일치 (주소 다름)',
      keyFn: function (r) {
        var n = ssNameKey(r.받는분);
        if (!n || !r.품목코드) return '';
        return 'N|' + n + '|' + r.품목코드;
      },
      maxMembers: 5 }
  ];
}

/**
 * 중복 의심 그룹 찾기.
 *
 * 세트분리 특성 주의 — 세트 1건이 몸통·뚜껑 2행으로 갈린다. 그건 중복이 아니다.
 * 그래서 (회차 + 고유ID + 원본코드) 로 먼저 한 건으로 접은 뒤 비교한다.
 *
 * 상위 등급에서 이미 잡힌 조합을 하위 등급이 반복하지 않도록,
 * 구성원이 기존 그룹의 부분집합이면 버린다.
 */
function ssFindDuplicates(rows) {
  // 1) 주문라인 단위로 접기
  var byLine = {}, records = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // 적립금·반품배송비 같은 정산 항목은 물건이 아니므로 중복을 따질 대상이 아니다
    if (ssText(r.경로) === SS_ROUTE.NONSHIP) continue;
    var k = ssText(r.회차) + '|' + ssText(r.고유ID) + '|' + ssText(r.원본코드);
    if (byLine[k] !== undefined) {
      var prev = records[byLine[k]];
      prev.수량 += ssNum(r.수량);
      continue;
    }
    byLine[k] = records.length;
    records.push({
      회차: ssText(r.회차), 고유ID: ssText(r.고유ID), 경로: ssText(r.경로),
      받는분: ssText(r.받는분), 전화: ssText(r.전화) || ssText(r.모바일),
      품목코드: ssText(r.원본코드) || ssText(r.품목코드), 품목명: ssText(r.품목명),
      수량: ssNum(r.수량), 금액: ssNum(r.금액), 주소: ssText(r.주소)
    });
  }

  // 2) 등급별로 묶기
  var levels = ssDupLevels();
  var groups = [], emitted = [];
  for (var li = 0; li < levels.length; li++) {
    var lv = levels[li];
    var buckets = {};
    for (var ri = 0; ri < records.length; ri++) {
      var key = lv.keyFn(records[ri]);
      if (!key) continue;
      (buckets[key] || (buckets[key] = [])).push(ri);
    }
    for (var bk in buckets) {
      if (!Object.prototype.hasOwnProperty.call(buckets, bk)) continue;
      var mem = buckets[bk];
      if (mem.length < 2) continue;
      if (lv.maxMembers && mem.length > lv.maxMembers) continue;

      var sig = mem.slice().sort(function (x, y) { return x - y; }).join(',');
      var dup = false;
      for (var e = 0; e < emitted.length; e++) {
        if (ssIsSubset(mem, emitted[e])) { dup = true; break; }
      }
      if (dup) continue;
      emitted.push(mem);

      var rounds = {};
      for (var m = 0; m < mem.length; m++) rounds[records[mem[m]].회차] = true;
      groups.push({
        grade: lv.grade, reason: lv.reason,
        회차간: Object.keys(rounds).length > 1,
        members: mem, sig: sig
      });
    }
  }

  // 회차 간 > 등급 순으로 정렬
  var order = { '🔴 확실': 0, '🟡 의심': 1, '⚪ 참고': 2 };
  groups.sort(function (x, y) {
    if (x.회차간 !== y.회차간) return x.회차간 ? -1 : 1;
    return (order[x.grade] || 9) - (order[y.grade] || 9);
  });
  return { groups: groups, records: records };
}

function ssIsSubset(small, big) {
  var set = {};
  for (var i = 0; i < big.length; i++) set[big[i]] = true;
  for (var j = 0; j < small.length; j++) if (!set[small[j]]) return false;
  return true;
}

/** 그룹 → 시트 행 */
function ssDupRows(found) {
  var out = [];
  for (var g = 0; g < found.groups.length; g++) {
    var G = found.groups[g];
    for (var m = 0; m < G.members.length; m++) {
      var r = found.records[G.members[m]];
      out.push([false, g + 1, G.grade, G.reason, G.회차간 ? '회차간' : '',
        r.회차, r.고유ID, r.경로, r.받는분, r.전화,
        r.품목코드, r.품목명, r.수량, r.금액, r.주소]);
    }
  }
  return out;
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
    SS_LEDGER_HEADER: SS_LEDGER_HEADER, SS_WARN_HEADER: SS_WARN_HEADER, SS_MERGED_HEADER: SS_MERGED_HEADER, SS_ISLAND_HEADER: SS_ISLAND_HEADER,
    SS_FEE_RULE_HEADER: SS_FEE_RULE_HEADER, SS_DEFAULT_CONFIG: SS_DEFAULT_CONFIG,
    ssRun: ssRun, ssNormalize: ssNormalize, ssExplode: ssExplode, ssEnrich: ssEnrich,
    ssAssignCondition: ssAssignCondition, ssAllocateStock: ssAllocateStock,
    ssRoute: ssRoute, ssMerge: ssMerge, ssShippingFee: ssShippingFee,
    ssCompressNames: ssCompressNames, ssParseFeeRule: ssParseFeeRule,
    ssParseAddrOverride: ssParseAddrOverride, ssLooksPhone: ssLooksPhone, ssMakeOrderId: ssMakeOrderId, ssHash4: ssHash4, ssHashN: ssHashN, ssFingerprint: ssFingerprint, ssSalesIdCells: ssSalesIdCells,
    ssFindDuplicates: ssFindDuplicates, ssDupRows: ssDupRows, SS_DUP_HEADER: SS_DUP_HEADER,
    ssOutRow: ssOutRow, ssMergedRow: ssMergedRow, ssIslandRow: ssIslandRow,
    ssPartnerRow: ssPartnerRow, ssHoldRow: ssHoldRow, ssVendorOf: ssVendorOf,
    ssInvoiceRows: ssInvoiceRows, ssIsSabangnetUid: ssIsSabangnetUid, SS_INVOICE_HEADER: SS_INVOICE_HEADER,
    ssNonshipRow: ssNonshipRow, ssNonShipReason: ssNonShipReason, SS_NONSHIP_HEADER: SS_NONSHIP_HEADER,
    SS_PARTNER_HEADER: SS_PARTNER_HEADER, SS_MANUAL_HEADER: SS_MANUAL_HEADER, SS_VENDOR_HEADER: SS_VENDOR_HEADER, ssLedgerRow: ssLedgerRow, ssDisplayName: ssDisplayName,
    ssStripName: ssStripName, ssNormAddr: ssNormAddr, ssPad6: ssPad6
  };
}
