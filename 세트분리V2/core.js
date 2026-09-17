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

/**
 * 합배송 품목명에서 **한 품목이 끝나는 자리**를 알리는 표시.
 * ★ 2026-09-09 (사장님 지정)
 *
 * 접어 놓은 「300/400 - (50*1팩) 50세트」는 박스를 싸는 사람에게 한 품목처럼
 * 보인다 — 300 짜리 하나만 넣고 끝낼 수 있다. 그래서 품목마다 제 꼬리를
 * 붙여 적고, 끝나는 자리를 이 표시로 못 박는다.
 *
 * ★ 눈에 띄는 글자여야 한다 ★
 *   품목명에는 -, /, *, (), 숫자가 잔뜩 들어간다. 그 사이에서 구분자가
 *   묻히면 없느니만 못하다. ★ 는 품목명에 절대 안 나오는 글자다.
 */
var SS_ITEM_MARK = '★★';

var SS_ROUTE = {
  /* ★ 2026-09-11: 롯데 → 로젠으로 바꿨다 ★
     열쇠 이름(LOTTE_…)은 그대로 뒀다. 22곳에서 쓰고 있어 한꺼번에 바꾸면
     흔들리는 자리가 많고, 값만 맞으면 도는 데 문제가 없다.
     ★ 이름으로 «접두 비교»를 하지 말 것 ★ — 전에 gasAuto·gasBulk 가
     indexOf('롯데') 로 걸렀는데, 이름을 바꾸는 순간 조용히 0건이 됐다.
     지금은 둘 다 SS_ROUTE.PARTNER 와 견준다. */
  LOTTE: '로젠택배',
  LOTTE_ISLAND: '로젠택배-도서산간',
  LOTTE_ISLAND_CONSIGN: '로젠택배-도서산간(위탁배송)',
  PARTNER: '대리발송',
  MERGED: '합포장동봉',
  NONSHIP: '비배송',
  HOLD: '보류'
};

/** 출력 탭 공통 19열.
    ★ 이 19열은 원래 «로젠» 양식이다 ★ 롯데로 갈 때 열은 그대로 두고 이름만
    바꿔 썼다. 2026-09-11 에 로젠으로 돌아오면서 이름을 되돌렸다 —
    열은 처음부터 맞았으므로 인쇄 쪽은 건드릴 것이 없다. */
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
/**
 * 보류(미발송) 탭.
 *
 * ★ 맨 뒤의 「원본코드」는 «건드리지 않는 칸»이다 ★  (2026-09-14)
 *   조치를 거는 열쇠가 (고유ID + 원본코드)다. 사람이 품목코드를 올바른 것으로
 *   고치면 그 열쇠를 원장에서 되찾아야 하는데 —
 *     한 주문이 세트라 두 줄로 쪼개져 있으면 고유ID 도 순번도 같아서
 *     어느 줄인지 기계가 못 정한다. 실제로 그런 줄이 흔하다.
 *   그래서 열쇠를 «아예 적어 둔다». 그러면 코드를 어떻게 고쳐도 안 깨진다.
 *
 *   사람이 적는 조치·메모 «뒤»에 둔다. 앞에 끼우면 조치 칸 자리가 밀려
 *   지금까지 쓰던 손버릇이 어긋난다.
 */
var SS_HOLD_HEADER = SS_OUT_HEADER.concat(['보류사유', '상세', '조치', '메모', '원본코드']);

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
/**
 * 수동조치 기록.
 *
 * ★ 맨 뒤의 「새코드·새품목명」 ★  (2026-09-14)
 *   > "미발송으로 빠지는 제품의 경우 우리가 코드와 품목명을 수정하고
 *   >  발송 이라고 적으면 그 내용으로 수정되어 넘어가면 좋겠어"
 *
 *   미발송의 큰 몫이 「품목누락」이다 — 판매현황의 코드가 M_품목정보에 없다.
 *   그때 사람이 올바른 코드를 아는데, 여태 그걸 적을 자리가 없어 코드를 고쳐
 *   봐야 무시됐다(오히려 조치 자체가 안 먹었다 — 키가 코드로 잡히니까).
 *
 *   앞이 아니라 맨 뒤에 붙인다. 앞 열이 밀리면 자리로 읽는 곳이 조용히 어긋난다.
 */
var SS_MANUAL_HEADER = ['등록일', '고유ID', '원본코드', '조치', '업체코드', '메모',
  '등록회차', '등록시각', '최근적용회차', '새코드', '새품목명'];

var SS_VENDOR_HEADER = ['업체코드', '업체명'];

/** 합배송 탭 — 대표행과 동봉행을 한자리에 모아 박스 구성이 보이게 한다 */
var SS_MERGED_HEADER = ['구분', '조건ID', '실제경로', '합포장키'].concat(SS_OUT_HEADER);

/** 도서산간 탭 — 택배사 요금 구분(제주연계 / 도선료·산간료)에 맞춘 권역을 앞에 붙인다 */
/**
 * 도서산간 출력 탭.
 * ★ 맨 뒤의 「조치」는 사람이 채우는 칸이다 ★  (2026-09-10)
 *   도서산간은 추가운임이 붙어서, 고객이 알고 동의했는지 확인한 것만 내보낸다.
 *   «발송» 이라고 적어야 로젠 출력 엑셀에 실린다 (gasBulk.js ss_로젠출력엑셀).
 *   보류(미발송) 탭의 조치와 «같은 낱말»이다 — 2026-09-14 에 통일했다.
 *   그 전에는 여기만 아무 글자나 받아서, 손버릇대로 O 를 적으면 도서산간에서는
 *   나가고 보류 탭에서는 「O 라는 업체로 대리발송」이 됐다.
 *   한 분에게 한 줄뿐이면 빈칸이어도 나간다 — 운임이 한 번뿐이라 볼 것이 없다.
 *   보류 탭의 「조치」와 같은 손버릇이다 — 새 개념을 만들지 않았다.
 *   앞이 아니라 **맨 뒤**에 붙인 이유: 앞 열들의 자리가 밀리면 그 열을
 *   위치로 읽는 곳이 조용히 어긋난다.
 */
var SS_ISLAND_HEADER = ['권역', '우편번호', '판정', '도선료']
  .concat(SS_OUT_HEADER).concat(['조치']);

/**
 * 도선료 표 — 택배사 청구 기준 그대로다.
 *
 * ★ 2026-09-11 현재 이 표는 아직 «롯데» 것이다 ★
 *   표는 코드가 아니라 「도서산간_도선료」 탭에 사람이 심어 두는 자료다
 *   (gasMasters.js ssm_ferryRows). 로젠으로 바꿨으면 그 탭을 로젠 표로
 *   갈아 넣어야 한다 — 안 갈면 청구액이 틀린다. 코드는 안 고쳐도 된다.
 *   권역 낱말(제주연계 등)이 로젠에서 다르면 그때 core 도 같이 본다.
 */
var SS_FERRY_HEADER = ['시도', '시군구', '읍면동', '리조건', '도선료', '권역'];

var SS_LEDGER_HEADER = [
  '회차키', '라인ID', '고유ID', '주문번호출처', '실행시각', '경로', '보류사유', '출고지', '순번', '일자-No.',
  '원본품목코드', '품목코드', '품목명', '출력품목명', '택배박스수량', '주문수량', '소요량', '수량',
  '조건ID', '합포장그룹', '합포장대표', '배송비', '배송비산출', '부족수량',
  '도서권역', '우편번호', '도서판정', '도선료', '주소변경', '원받는분', '원주소', '원연락처',
  '거래처명', '전화', '모바일', '주소1', '배송메시지', '합계',
  '적요', '사방넷주문번호', '보내는분', '보내는분전화',
  '운송장번호', '송장매칭',
  /* ★ 2026-09-09: 조치로 옮겨진 건인지 ★
     재고가 부족해 사람이 「조치」에 업체코드를 적어 대리발송으로 뺀 건이다.
     그런 건은 **롯데 송장을 기다릴 게 아니라 업체 송장**을 기다려야 한다.
     표식이 없으면 미매칭 점검이 「아직 안 온 것」과 「엉뚱한 데를 보는 것」을
     못 가른다. 고유ID 는 조치를 해도 안 바뀌므로 매칭 자체는 그대로다. */
  '조치', '조치업체',
  /* ★ 택배사 ★  (2026-09-15)
     > "일일마감에 데이타가 다 있는데.."
     여태 원장에는 송장만 적고 택배사는 안 적었다. 칸이 없어서다. 그래서
     읽는 쪽(CS·gasBulk)이 저마다 «자릿수로 짐작»했고, 12자리 대한통운이
     롯데가 됐다. 송장을 넣는 그 코드가 택배사도 이미 알고 있다 — 같이 적는다.
     ★ 반드시 맨 뒤 ★ 중간에 끼우면 머리글 이사가 돈다(ssio_migrateHeader). */
  '택배사'
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
  /* 도선료 표가 «어느 택배사» 기준인지.
     표 자체는 「도서산간_도선료」 탭에 사람이 심는다. 로젠 표로 갈아 넣은 뒤
     이 값을 '로젠' 으로 바꾸면 아래 경고가 멎는다. */
  도선료표_기준: '롯데',
  도서산간_미확인: '보류',
  도서산간_판정: '우편번호우선',
  전화주문_고유ID: '주문번호칸에채움',
  재고부족_자동대리발송: '사용',
  합포장_최대건수: '0',
  고유ID_짧은날짜_전환일: SS_ID_SHORT_FROM,
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

/**
 * ══════════════════════════════════════════════════════════════
 *  전화번호 앞의 0 을 되살린다
 *  2026-09-14
 *
 *  > "대리발송 전화번호 앞에 0이 빠지네"
 *
 *  ★ 어디서 사라지나 ★
 *    판매현황을 getValues 로 읽는다. 그 칸이 «숫자»로 저장돼 있으면 구글이
 *    01012345678 을 1012345678 이라는 수로 준다 — 읽는 순간 이미 0 이 없다.
 *    붙여넣기 한 번에 서식이 숫자로 바뀌는 일이 흔해서, 사람이 조심하는
 *    것으로는 못 막는다.
 *
 *  ★ 0 을 붙이는 조건을 좁게 잡는다 ★
 *    숫자만이고 · 9~10자리이고 · 0 으로 시작하지 않을 때만.
 *      1012345678(10) → 01012345678   휴대폰
 *       312345678(9)  →  0312345678   경기
 *       212345678(9)  →  0212345678   서울
 *    이미 0 으로 시작하거나 - 가 섞였으면 손대지 않는다. 사람이 적은 대로
 *    두는 편이 낫다 — 기계가 고쳐 주기 시작하면 무엇이 원본인지 알 수 없다.
 *
 *  @param v 원본 값 (문자열 또는 수)
 *  @return {string}
 * ══════════════════════════════════════════════════════════════
 */
function ssPhoneFix(v) {
  var s = ssText(v);
  if (!s) return '';
  if (!/^[0-9]+$/.test(s)) return s;      // -·공백·문자가 섞였으면 그대로
  if (s.charAt(0) === '0') return s;      // 이미 멀쩡하다
  if (s.length === 9 || s.length === 10) return '0' + s;
  return s;
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

/**
 * 고유ID 를 «어디서 얻었나».
 *
 *   사방넷   — 쇼핑몰이 확정해 보낸 주문번호. 다르면 다른 주문이다. 끝.
 *   자동발급 — 전화주문처럼 번호가 없어 세트분리가 만든 것(ssMakeOrderId).
 *              내용 해시라 전표번호만 달라져도 값이 달라진다. 근거가 못 된다.
 *
 * 중복 판정이 이 둘을 «다르게» 다뤄야 한다. 글자를 여기저기 적어 두면
 * 한 곳만 고치고 마는 일이 생겨 상수로 둔다.
 */
var SS_ORDNO_SRC = { 사방넷: '사방넷', 자동발급: '자동발급' };

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
 *   0902-PH-a3f19   (전환일 이전 주문은 260902-PH-a3f19)
 *    └날짜   └표식 └전표·수취인·연락처·주소·품목·수량 해시
 *
 * 상품정보 시트의 「MMdd-ds-xxxx」(발주수집이 발급)와 나란한 형태지만
 * 뒷자리가 랜덤이 아니라 내용 해시다 — 랜덤이면 회차마다 값이 달라진다.
 */
/**
 * 고유ID 날짜를 MMdd 로 줄이기 시작하는 날. 이 날짜 이전 주문은 YYMMDD 로 남는다.
 * 오늘 이미 롯데에 올라간 ID 가 바뀌면 송장이 안 맞으므로 날짜로 끊는다.
 */
var SS_ID_SHORT_FROM = '20260909';

function ssMakeOrderId(L, cfg) {
  var 일자 = ssText(L.일자);
  var parts = 일자.split('-');
  var digits = ssText(parts[0]).replace(/[^0-9]/g, '');
  // 전환일부터 상품정보 시트의 「MMdd-ds-xxxx」 와 자리수를 맞춘다.
  // 오늘 날짜가 아니라 「주문 일자」로 판정한다 — 지난 회차를 다시 돌려도
  // 그때 발급한 ID 가 그대로 나와야 원장·송장매칭이 어긋나지 않는다.
  var 전환일 = (cfg && ssText(cfg.고유ID_짧은날짜_전환일)) || SS_ID_SHORT_FROM;
  var ymd = digits;
  if (digits.length >= 8) {
    ymd = (digits.slice(0, 8) >= 전환일) ? digits.slice(4, 8) : digits.slice(2, 8);
  }
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
 *   거래처명 「행주국수 김순해」 + PH-ID  →  「행주국수 김순해/0902-PH-303d4」
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
    /* ★ 이름에 «/» 가 있으면 마지막 조각만 쓴다 ★  (2026-09-11)
       > "백반나라/김다영/0911-PH-64377 이런경우 김다영/0911-PH-64377 가
          고유아이디로 빠지더라"

       이 칸을 읽는 쪽이 둘인데 규칙이 다르다.
         세트분리 ssSplit2              → «첫» / 뒤 전부
         허브 _pep_uidFromOrdererCell_  → «마지막» / 뒤
       「백반나라/김다영」 처럼 상호와 이름이 / 로 붙어 있으면 슬래시가
       둘이 되어, 앞은 「김다영/0911-PH-64377」 뒤는 「0911-PH-64377」 로
       갈린다. 어느 쪽도 틀렸다고 말하기 어렵고, 둘을 맞추려면 읽는 쪽
       두 군데를 고쳐야 하는데 그 칸은 여러 화면이 읽는다.

       그래서 «넣는 값»에서 슬래시를 하나로 만든다. 사장님 판단으로
       뒷조각(사람 이름)을 남긴다 — 송장에 찍히는 것은 받는 사람이다.
       (상호는 거래처명 칸에 그대로 남아 있다) */
    if (who.indexOf('/') !== -1) {
      var 조각 = who.split('/');
      var 뒤 = ssText(조각[조각.length - 1]);
      //  「/」 로만 된 칸도 있다. 그때는 받는분으로, 그것도 없으면 ID 만.
      who = 뒤 || ssNorm(L.받는분) || '';
      if (who.indexOf('/') !== -1) who = who.split('/').join(' ').replace(/ {2,}/g, ' ').trim();
    }
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
/**
 * ══════════════════════════════════════════════════════════════
 *  머리글 이름이 «조금» 달라도 찾아낸다
 *  2026-09-14
 *
 *  > "수집했는데 주소가 80% 이상 안나와"
 *
 *  사방넷 건의 주소는 「추가장문형식1」 칸에서 읽는다. 이카운트에서 그 항목
 *  이름이 한 글자만 달라져도 idx 에 없어서 빈 문자열이 돌아온다 — 오류는 안 난다.
 *  사방넷이 80%인 날은 주소가 80% 빈 채로 송장이 나간다. 실제로 그랬다.
 *
 *  ★ 그래도 «아무거나» 집지는 않는다 ★
 *    먼저 정확한 이름들을 차례로 찾고, 없을 때만 느슨한 무늬로 한 번 더 본다.
 *    집은 이름은 부르는 쪽에 돌려줘 화면에 적게 한다 — 기계가 조용히
 *    골라 주면 다음에 또 엉뚱한 칸을 집어도 아무도 모른다.
 *
 *  @return {string} 찾은 «머리글 이름». 못 찾으면 ''
 * ══════════════════════════════════════════════════════════════
 */
function ssPickCol(idx, 후보들, 느슨) {
  for (var i = 0; i < 후보들.length; i++) {
    if (idx[후보들[i]] !== undefined) return 후보들[i];
  }
  if (!느슨) return '';
  for (var k in idx) {
    if (Object.prototype.hasOwnProperty.call(idx, k) && 느슨.test(k)) return k;
  }
  return '';
}

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
  /* ★ 머리글을 못 찾으면 «조용히 빈칸»이 된다 ★  (2026-09-14)
     > "수집했는데 주소가 80% 이상 안나와"

     이 표는 이름으로 칸을 찾는다. 이카운트에서 항목 이름이 한 글자만 달라져도
     g(row, '추가장문형식1') 이 빈 문자열을 돌려준다 — 오류는 안 난다.
     사방넷 건은 주소를 그 칸에서 읽으므로, 사방넷이 80%인 날은 주소가 80%
     빈다. 그리고 아무도 «왜»를 모른다.

     필수는 아니지만 못 찾으면 반드시 무언가가 비는 칸들을 먼저 세어 말한다.
     멈추지는 않는다 — 어떤 회차는 정말 그 칸이 없을 수 있다. */
  var 있어야 = ['주소1', '배송지(주문서)/배송메시지(주문서)',
    '주문자명(사방넷)', '주문자명(주문서)', '전화', '모바일', '거래처명', '적요', '합계'];
  var 없는칸 = [];
  for (var w0 = 0; w0 < 있어야.length; w0++) {
    if (idx[있어야[w0]] === undefined) 없는칸.push(있어야[w0]);
  }
  if (없는칸.length) {
    ssWarn(warnings, '오류', 'SALES_COL_MISSING', 없는칸.join(', '),
      '판매현황 머리글에서 이 칸을 못 찾았습니다. 이름이 한 글자라도 다르면 ' +
      '그 칸을 읽는 곳이 조용히 빈칸이 됩니다 — 사방넷 건의 주소는 ' +
      '「추가장문형식1」에서 읽습니다. 이카운트 엑셀의 항목 이름을 맞춰 주세요.');
  }

  var need = ['순번', '일자-No.', '품목코드', '품목명', '수량'];
  for (var i = 0; i < need.length; i++) {
    if (idx[need[i]] === undefined) throw new Error('판매현황에 필수 열이 없습니다: ' + need[i]);
  }

  /*  사방넷 건의 «주소»가 들어오는 칸. 이름이 조금 달라도 찾는다.
      못 찾으면 사방넷 주문 전부가 주소 없이 나간다 — 제일 크게 알린다. */
  /*  ★ 실제 이름은 「추가문자형7」 이었다 ★  (2026-09-14 확인)
      이카운트의 사용자 정의 항목이라 이름이 「추가문자형N」 꼴이다.
      「장문」도 「형식」도 없어서 처음 무늬에 안 걸렸다.
      N 은 사람이 항목을 늘리면 바뀔 수 있으므로 숫자를 박지 않는다. */
  var 사방넷주소칸 = ssPickCol(idx,
    ['추가문자형7', '추가장문형식1', '추가주문자형식1', '추가장문형식',
     '추가주문형식1', '추가장문1'],
    /추가.*(장문|형식|문자형)/);
  if (!사방넷주소칸) {
    /*  실제 머리글을 같이 싣는다. 「못 찾았다」만 말하면 무엇으로 바꿔야
        하는지 알 수가 없어 한 번 더 물어봐야 한다. */
    var 본이름 = [];
    for (var hk in idx) {
      if (Object.prototype.hasOwnProperty.call(idx, hk) && 본이름.length < 40) 본이름.push(hk);
    }
    ssWarn(warnings, '오류', 'SABANG_ADDR_COL', '(못 찾음)',
      '사방넷 주문의 주소를 읽을 칸을 못 찾았습니다 — 「추가문자형7」. ' +
      '사방넷 건은 주소 없이 나갑니다. 판매현황 머리글: ' + 본이름.join(' · '));
  } else if (사방넷주소칸 !== '추가문자형7') {
    ssWarn(warnings, '주의', 'SABANG_ADDR_COL', 사방넷주소칸,
      '사방넷 주소를 「' + 사방넷주소칸 + '」 칸에서 읽었습니다 (여태 쓰던 이름은 「추가문자형7」). ' +
      '이카운트 항목 이름이 바뀐 듯합니다 — 맞는지 한 번 보세요.');
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
    if (code === '품목코드') continue;
    /* ★ 코드가 없다고 «조용히» 버리지 않는다 ★  (2026-09-18)
       > "코드가 없거나 제품이 아닌 ... 다 미발송으로 빠지게 해주고"

       여태 여기서 통째로 버렸다. 그래서 그 줄은 미발송에도 안 나왔고,
       어디로 갔는지 아무도 모르는 채 «주문이 빠졌다».
       내용이 있는 줄은 태워 보내고 라우팅이 미발송에 세운다.
       다만 «정말 빈 줄»(엑셀 꼬리의 빈 행)은 여기서 버린다 — 그건 자료가 아니다. */
    if (!code) {
      var 뭐라도 = g(row, '품목명') || g(row, '합계') || g(row, '수량') ||
        g(row, '거래처명') || g(row, '일자-No.');
      if (!뭐라도) continue;
    }

    var 주문서 = g(row, '주문자명(주문서)');
    var 사방넷 = g(row, '주문자명(사방넷)');
    var 거래처 = g(row, '거래처명');
    var 출처 = 주문서 ? '주문서' : (사방넷 ? '사방넷' : '이카운트');

    var 주소원본, 메시지;
    if (출처 === '주문서') {
      var t = ssSplit2(g(row, '배송지(주문서)/배송메시지(주문서)'), '/');
      주소원본 = t[0]; 메시지 = t[1];
    } else if (출처 === '사방넷') {
      var q = ssSplit2(g(row, 사방넷주소칸), '/');
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
      : (위탁표기 ? ssPhoneFix(g(row, '모바일') || g(row, '전화')) : cfg.대표전화);

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
      //  숫자로 저장된 칸은 읽는 순간 앞 0 이 없다 — 여기서 되살린다
      전화: (출처 === '이카운트') ? ssPhoneFix(g(row, '전화')) : '',
      모바일: ssPhoneFix((출처 === '주문서') ? g(row, '전화번호(주문서)')
        : (출처 === '사방넷') ? g(row, '전화번호(사방넷)') : g(row, '모바일')),
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
    line.고유ID = ssText(line.사방넷주문번호) || ssMakeOrderId(line, cfg);
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
    line.주문번호출처 = ssText(line.사방넷주문번호) ? SS_ORDNO_SRC.사방넷 : SS_ORDNO_SRC.자동발급;
    if (line.주문번호출처 === '자동발급' && ssText(cfg.전화주문_고유ID) === '주문번호칸에채움') {
      line.사방넷주문번호 = line.고유ID;
    }
    out.push(line);
  }

  /* ★ 결과로 잡는 그물 ★  (2026-09-14)
     머리글을 아무리 잘 찾아도, 원천이 그 칸을 안 채워 보내면 주소가 빈다.
     원인이 무엇이든 «주소 없는 줄이 많다»는 사실 자체가 사고다 — 주소 없이
     송장이 나가면 그 택배는 못 간다. 그래서 까닭을 따지지 말고 세어서 알린다.

     한두 건은 늘 있다(비배송·적립금). 다섯 줄을 넘고 20% 이상일 때만 말한다 —
     늘 뜨는 경고는 안 보게 된다. */
  var 주소없음 = 0;
  for (var a0 = 0; a0 < out.length; a0++) {
    if (!ssText(out[a0].주소1)) 주소없음++;
  }
  if (out.length && 주소없음 > 5 && 주소없음 * 5 >= out.length) {
    ssWarn(warnings, '오류', 'ADDR_EMPTY',
      주소없음 + '/' + out.length + '줄 (' + Math.round(주소없음 * 100 / out.length) + '%)',
      '주소가 빈 줄이 많습니다. 이대로면 그 건들은 배송이 안 됩니다. ' +
      '사방넷 건은 「추가장문형식1」, 주문서 건은 「배송지(주문서)/배송메시지(주문서)」, ' +
      '전화주문은 「주소1」 칸에서 읽습니다 — 판매현황에 그 칸이 채워져 있는지 보세요.');
  }

  return out;
}

/**
 * 「쪼개야 하는 이름인가」 — 한글 「세트」면 그렇다.
 *
 * 영문 SET 은 한 박스에 다 들어 있는 완제품이라 쪼개지 않는다
 * (「AJ 소스 95파이 소 화이트 1000 SET 합포장」).
 * 이 규칙은 사장님이 쓰시는 이름 규칙 그대로다 — 우리가 만든 것이 아니다.
 */
function ssNeedsBom_(name, code) {
  var n = ssText(name);
  if (!n) return false;
  /* ★ 샘플은 뺀다 (사장님) ★
     소분해 한두 개씩 조합해 파는 것이 맞지만, 여기서 알릴 대상은 아니다.
     양이 적어 BOM 을 올릴 값이 없고, 주의만 시끄러워진다.
     시끄러운 주의는 안 보게 되고, 안 보는 주의는 없느니만 못하다. */
  if (n.indexOf('샘플') !== -1) return false;
  if (/^SAMPLE-/i.test(ssText(code))) return false;
  /* ★ 숫자 «바로 앞»에 붙은 「세트」만 본다 ★
     그냥 「세트」가 들어갔는지 보면 낱말 일부인 것까지 걸린다 —
     「KR 수저세트」는 몸통+뚜껑이 아니라 «1000개 묶음» 이라는 뜻이고,
     「바디세트」·「AP 실링기계 세트 MS 마스터 + 1215몰드」도 마찬가지다.

     2026-09-10 상품정보시트 1,531 품목을 세어 봤다:
       「세트」 들어간 것 394 · 그중 «숫자+세트» 375 · 숫자 없는 것 19
     그 19개가 정확히 위와 같은 부류였다.

     전각 숫자(１２３)도 받는다 — [샘플] 품목이 「１세트」로 적혀 있다. */
  return /[0-9０-９][ 　]*세트/.test(n);
}

/* ── 2단계 · 세트 분해 (BOM 소요량 반영) ──────────────── */

/**
 * 이 주문 줄이 「대리발송품목」에 걸리는가 — «쪼개기 전»에 본다.
 * 주문한 코드와 그 세트의 구성품을 다 본다.
 * @return {string} 걸린 표의 코드 (안 걸리면 '')
 */
function ssPartnerItemHit_(원본코드, parts, 대리품목) {
  var oc = ssText(원본코드).toUpperCase();
  if (대리품목[oc]) return oc;
  if (!parts) return '';
  for (var i = 0; i < parts.length; i++) {
    var pc = ssText(parts[i].code).toUpperCase();
    if (대리품목[pc]) return pc;
  }
  return '';
}

function ssExplode(lines, masters, warnings) {
  var bom = masters.bom || {};
  var except = masters.splitExcept || {};
  var 대리품목 = masters.partnerItems || {};
  var out = [];
  var warnedNoBom = {};   // 같은 코드로 여러 줄이 와도 주의는 한 번만
  var warnedPI = {};
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    var parts = bom[L.원본코드];

    /* ★ 업체가 대는 물건은 «쪼개지 않는다» ★  (2026-09-17)
       > "대리발송품목에서 빠지는것은 몸통뚜껑 세트분리전에 대리발송으로
       >  빠져야되.. 분리후에 빠지니까 뚜껑만 주문이 대리발송으로 빠지네"

       쪼개는 까닭은 «우리가» 창고에서 몸통과 뚜껑을 따로 꺼내 담기 때문이다.
       업체가 대는 물건은 우리 창고를 거치지 않는다 — 쪼갤 까닭이 없다.

       쪼갠 뒤에 판정하면 한 주문이 둘로 찢어진다. 뚜껑만 업체로 가고
       몸통은 로젠으로 간다. 고객은 반쪽을 받고, 업체는 왜 뚜껑만
       시켰는지 모른다. 그래서 판정을 «쪼개기 앞»으로 옮긴다.

       구성품 하나만 표에 있어도 그 줄 전체를 넘긴다 — 찢지 않는 것이
       먼저다. 다만 그 경우는 말해 준다(아래 PITEM_NO_SPLIT). */
    var 대리걸림 = ssPartnerItemHit_(L.원본코드, parts, 대리품목);
    var 분해 = parts && parts.length > 1 && !except[L.원본코드] && !대리걸림;

    if (대리걸림 && 대리걸림 !== ssText(L.원본코드).toUpperCase() && !warnedPI[L.원본코드]) {
      warnedPI[L.원본코드] = true;
      ssWarn(warnings, '주의', 'PITEM_NO_SPLIT', L.원본코드 + ' > ' + 대리걸림,
        '구성품 「' + 대리걸림 + '」 가 「대리발송품목」에 있어 세트를 쪼개지 않고 ' +
        '주문한 그대로 업체에 넘깁니다. 그 구성품만 업체 것이라면 표에서 빼 주세요.');
    }

    if (!분해) {
      /* ★ 2026-09-10: 「쪼개야 할 것 같은데 BOM 이 없다」를 알린다 ★
         여태는 BOM 이 없으면 세트 코드 그대로 조용히 나갔다. 그러면
         창고는 몸통·뚜껑을 집어야 하는데 종이에는 「1000세트」만 적힌다.
         2026-09-10 확인: 세트여부=1 품목 중 109개가 BOM현황에 없었고
         그중 37개가 판매중이었다 — 아무도 모르고 있었다.

         판단은 **품목명의 한글 「세트」** 로 한다 (사장님 규칙):
           한글 「세트」 = 몸통+뚜껑을 조합해 나간다 → 쪼개야 한다
           영문 「SET」  = 한 박스에 다 들어 있다   → 안 쪼갠다
         「수저세트」처럼 낱말 일부인 것이 잘못 걸릴 수 있지만, 그래 봐야
         주의 한 줄이다. 못 쪼갠 채 나가는 쪽이 훨씬 비싸다.

         분리예외에 들어 있으면 사람이 정한 것이므로 조용히 넘어간다. */
      if (!parts && !except[L.원본코드] && ssNeedsBom_(L.원본품목명, L.원본코드) && !warnedNoBom[L.원본코드]) {
        warnedNoBom[L.원본코드] = true;
        ssWarn(warnings, '주의', 'BOM_MISSING', L.원본코드,
          '「' + ssText(L.원본품목명) + '」 는 세트인데 BOM현황에 구성이 없습니다. ' +
          '쪼개지 않고 그대로 내보냅니다 — BOM 을 등록하거나 분리예외에 넣어 주세요.');
      }
      var u0 = ssMakeUnit(L, L.원본코드, 1, 0);
      //  구성품 코드로 걸린 건은 라우팅이 원본코드로는 못 찾는다 — 표식을 남긴다
      if (대리걸림) u0.대리품목걸림 = 대리걸림;
      out.push(u0);
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
    /*  ★ 사람이 보류 탭에서 고쳐 적은 품목명이 이긴다 ★  (2026-09-14)
        마스터 이름이 실제 보낼 것과 다를 때가 있다(묶음·증정·특판). 사람이
        고쳐 적었다면 그 줄에 한해 그 이름으로 나가야 한다 — 송장에 찍히는
        것이 그 이름이고, 업체가 그걸 보고 담는다. */
    if (ssText(u.수정이름)) u.품목명 = ssText(u.수정이름);
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
 * 협력업체 코드를 찾는다.
 *
 * ① 품목명 첫 토큰   "JH 실링 23189…" → JH   (원래 규칙, 그대로 둔다)
 * ② ①이 없으면 이카운트코드 앞글자  "JMPSPTB0014" → JM
 *
 * ★ ②를 «예비»로만 두는 이유 ★  (2026-09-11)
 *   품목명으로 이미 정해진 건은 건드리지 않는다. 코드 앞글자를 먼저 보면
 *   JH75SAUCE·AJ00011 처럼 «이미 잘 잡히던» 수천 건의 판정이 한꺼번에 바뀐다.
 *   ②는 지금 빈칸인 것만 채운다 — 없던 것을 넣을 뿐 있던 것을 바꾸지 않는다.
 *
 * ★ 왜 필요했나 ★
 *   제이엠 품목은 코드가 JM 으로 시작하는데 품목명은 「PSP 트레이 …」 로 시작한다.
 *   141개 전부 그렇다 (2026-09-11 확인). 그래서 업체코드가 빈칸이었고,
 *   재고가 부족해도 제이엠으로 넘길 대상으로 안 잡혔다.
 *
 * ★ 등록된 코드만 인정한다 ★
 *   「대리발송업체」 표에 없는 앞글자는 무시한다. 없는 업체로 토스하면
 *   그 건은 아무도 안 보낸다. JM 이 안 잡히면 그 표에 JM/제이엠이 있는지 본다.
 *
 *   앞글자 길이를 4→3→2 로 좁혀 가며 «가장 긴 것»을 고른다.
 *   두 글자 코드(JM·JH)와 세 글자 코드가 섞여 있어도 긴 쪽이 이긴다.
 */
function ssVendorOf(u, vendors) {
  if (!vendors) return '';

  var name = ssText(u.품목명) || ssText(u.원본품목명);
  var head = name.split(' ')[0];
  if (head && vendors[head]) return head;

  var code = ssText(u.품목코드) || ssText(u.원본코드);
  if (!code) return '';
  for (var len = 4; len >= 2; len--) {
    if (code.length < len) continue;
    var pre = code.substring(0, len).toUpperCase();
    if (vendors[pre]) return pre;
  }
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

    /* ★ 대리발송은 «우리 박스»에 담을 수 없다 ★  (2026-09-17)
       > "대리발송품목에 적힌 제품은 우리재고가 있어도 무조건 대리발송으로 넘어가면되"

       라우팅은 이미 재고를 안 보고 대리발송으로 보낸다. 그런데 그 «다음»에
       도는 이 합포장이 경로를 안 보고 출고지만 보고 묶었다.
       「대리발송품목」으로 빠진 줄은 출고지가 그대로 평택S-1 이다
       (원래 우리 물건인데 업체가 대신 대는 것이니까). 그래서 그물에 걸렸다.

       걸리면 차례에 따라 둘 중 하나로 망가진다 —
         · 대리발송 줄이 뒤면 : 동봉으로 흡수되어 «대리발송 탭에서 사라진다».
                               업체에 발주가 안 나간다
         · 앞이면             : 그 줄이 대표가 되어 «우리 물건을 빨아들인다».
                               업체는 갖고 있지도 않은 물건을 보내게 되고,
                               고객은 그것을 못 받는다

       업체 창고에서 나가는 물건과 우리 창고에서 나가는 물건이 한 박스에
       담길 리가 없다. 출고지가 같아 보여도 «나가는 곳»이 다르다.  */
    if (u.route === SS_ROUTE.PARTNER) continue;

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
      /* 샘플이 낀 박스는 예전처럼 접어 둔다 (사장님 확인).
         ===합배송 은 그대로 남긴다 — 롯데 배송비 비교가 이 말을 보고
         책정배송비 1,900 원을 잡는다 (_partnerLotteShipCompare.gs). */
      rep.출력품목명 = (sample ? '[샘플] ' : '') + ssCompressNames(names, !sample) + ' ===합배송' +
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
function ssCompressNames(names, spellOut) {
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
  /* ★ 2026-09-09: 펼쳐 적기 ★
     > "JH 반죽사각 300/ (50*1팩) 50세트-★★400 - … ★★ 이렇게 표시 되게 해줘"

     접어 놓은 「300/400 - (50*1팩) 50세트」는 박스를 싸는 사람에게
     **한 품목처럼 보인다.** 300 짜리 하나를 넣고 끝낼 수 있다.
     그래서 뒷말을 나눠 갖지 않고 품목마다 제 꼬리를 붙여 적는다.

       접어서:  JH 반죽사각 300/400 - (50*1팩) 50세트--/소분
       펼쳐서:  JH 반죽사각 300 - (50*1팩) 50세트--/소분 ★★400 - (50*1팩) 50세트--/소분 ★★

     같은 계열의 앞말(JH 반죽사각)은 한 번만 적는다 — 사장님 확인.
     ★★ 는 품목이 끝나는 자리다. 마지막 것 뒤에도 붙는다.

     ★ 안 묶이는 품목에도 붙인다 ★  (2026-09-09 사장님 시험에서 나옴)
       처음엔 묶인 덩어리 안에서만 ★★ 를 붙였다. 그래서

         BW 2166 사출 중화면용기 중 검정 (100*2팩), BW 2145 … 소 검정 (100*1팩)

       처럼 **안 묶인 것들은 쉼표로만** 이어져 ★★ 가 안 나왔다.
       (묶는 조건이 「공통 앞 토큰 2개 이상」인데 이 둘은 BW 하나뿐이다.)
       박스에 품목이 둘인 건 마찬가지라 표시도 같아야 한다.
       그래서 묶였든 아니든 **품목 하나하나를 한 줄로 펴서** ★★ 로 끊는다.

     ★ 샘플이 낀 박스는 접어 둔다 ★  (사장님 확인)
       샘플은 이름이 이미 길고, 그 박스는 어차피 사람이 따로 본다. */
  if (spellOut) {
    var items = [];
    for (var s = 0; s < clusters.length; s++) {
      var cs = clusters[s];
      if (cs.members.length === 1) { items.push(cs.members[0].join(' ')); continue; }
      var csPre = cs.pre.length;
      for (var e = 0; e < cs.members.length; e++) {
        var rest = cs.members[e].slice(csPre).join(' ');
        //  같은 계열 안에서만 앞말을 아낀다. 첫 놈이 그 앞말을 갖는다.
        items.push(e === 0 ? cs.pre.join(' ') + ' ' + rest : rest);
      }
    }
    if (!items.length) return '';
    return (items.join(' ' + SS_ITEM_MARK) + ' ' + SS_ITEM_MARK)
      .replace(/\s+/g, ' ').trim();
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
  var ferry = masters.ferry || [];
  var islandZip = masters.islandZips || {};
  var addrZip = masters.addrZip || {};
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
  var 대리품목 = masters.partnerItems || {};
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

    /* ★ 물건이 아닌 줄은 «미발송»으로 세운다 ★  (2026-09-18)
       > "코드가 없거나 제품이 아닌 반품비, 값이 -인것등 제품이 아닌것들은
       >  다 미발송으로 빠지게 해주고"

       여태는 「비배송」 탭으로 뺐다. 매출 집계에 남기려던 자리였는데,
       사람이 보는 목록이 하나 더 늘어날 뿐 손댈 일은 결국 미발송에서 한다.
       보류(미발송) 한 곳으로 모은다 — 사유는 적어 둔다.

       ★ 곁따라 막히는 것 ★ 보류사유가 붙으면 ssMerge 가 안 건드린다.
         전에는 적립금·배송비 줄이 합포장 «동봉»으로 빨려 들어갔다. */
    if (!면제) {
      //  코드가 아예 없는 줄. 어느 물건인지 모르니 내보낼 수 없다.
      if (!ssText(u.원본코드) && !ssText(u.품목코드)) {
        u.route = SS_ROUTE.HOLD;
        u.보류사유 = '코드없음';
        u.보류상세 = ssText(u.원본품목명) || ssText(u.품목명) || '(품목명도 없음)';
        continue;
      }
      var ns = ssNonShipReason(u, cfg);
      if (ns) {
        u.route = SS_ROUTE.HOLD;
        u.보류사유 = '제품아님';
        u.보류상세 = ns;          // 「품목명에 「반품배송비」」·「금액 음수 (-3000)」 …
        u.비배송사유 = ns;        // 읽던 쪽이 있으면 그대로 읽히게 남겨 둔다
        continue;
      }
    }

    /* ★ 출고지가 「대리발송」이면 그대로 대리발송이다 ★  (2026-09-14)
       > "출고지가 대리발송인 경우 무조건 대리발송으로 빠지게 해줘"

       여태 이런 줄은 아래 출고지 검사에서 «자사도 위탁도 아니다»라며
       보류(출고지미정)로 빠졌다. 사람이 이미 「이건 업체가 보낸다」고 적어
       보낸 것인데, 시트가 그 말을 못 알아듣고 되물은 셈이다.

       재고를 보지 않는다. 출고지가 대리발송이라는 건 애초에 우리 창고에서
       안 나간다는 뜻이라, 재고가 있고 없고는 물어볼 일이 아니다.

       ★ 사람이 「발송」이라고 적은 것만은 존중한다 ★
         보류 탭에서 «이건 그냥 우리가 보낸다»고 손으로 뒤집은 건이다.
         기계가 그 결정을 다시 덮으면 사람은 되돌릴 방법이 없어진다. */
    if (!면제 && ssNorm(u.출고지).split(' ').join('') === SS_ROUTE.PARTNER) {
      u.route = SS_ROUTE.PARTNER;
      /*  업체코드가 비어도 «보내긴 한다». 푸시는 품목코드 앞 두 글자로 업체를
          가리므로 이 칸이 비어도 돈다. 다만 비었다는 사실은 말해 준다 —
          대리발송 탭에서 업체가 빈칸이면 사람이 손으로 채워야 한다. */
      if (!u.업체코드) {
        ssWarn(warnings, '주의', 'PARTNER_BY_ORIGIN', u.고유ID + ' / ' + u.품목코드,
          '출고지가 「대리발송」이라 대리발송으로 보냈는데 업체코드를 못 정했습니다. ' +
          '대리발송 탭에서 업체코드를 채우거나, 품목 앞 두 글자가 업체 접두인지 보세요.');
      }
      continue;
    }

    /* ★ 「대리발송품목」에 적힌 품목은 늘 대리발송이다 ★  (2026-09-15)
       > "상품 예외 텝을 만들어 특정상품 이카운트 코드를 넣으면 대리발송으로"

       여태 이런 건은 주문이 들어올 때마다 사람이 보류 탭에서 「조치」를
       적어 하나씩 빼야 했다. 같은 품목인데 회차마다 같은 손질을 반복했다.
       품목은 안 바뀌는 사실이니 주문이 아니라 «표»에 적는 것이 맞다.

       ★ 주문한 코드와 쪼갠 뒤의 코드 둘 다 본다 ★
         세트를 시키면 원본코드(시킨 것)와 품목코드(쪼갠 구성품)가 갈린다.
         업체가 대는 것이 구성품 하나일 수도, 세트 통째일 수도 있다.

       ★ 재고를 안 본다 ★ 우리 창고에서 안 나가는 물건이다.

       ★ 표가 수동조치 「발송」을 이긴다 ★  (2026-09-17)
         > "대리발송품목에 적힌 제품은 우리재고가 있어도 무조건 대리발송으로"

         여태는 면제(사람이 「발송」이라 한 건)가 이 표를 건너뛰었다.
         그래서 실제로 이런 일이 있었다 — 보류 탭에서 그 건을 먼저 처리하고
         «그 뒤에» 표를 만들었더니, 옛 조치가 회차 내내 이겨서 표가 영영
         안 먹었다. 사람은 표를 고쳐도 안 되는 이유를 알 길이 없었다.

         게다가 그 「발송」은 사람이 안 적었을 수도 있다 —
         ssm_captureManual 은 «상세를 지우면» 해소로 보고 발송을 박는다.
         짐작으로 박힌 값이 표를 이기면 안 된다.

         표는 «품목»에 대한 결정이고 수동조치는 그 회차 «한 줄»의 처리다.
         품목에 대한 결정이 이긴다. 대신 조용히 이기지 않는다 — 말한다.
         우리가 보내야 하면 그 품목을 표에서 지우면 된다 (한 칸이면 된다).  */
    {
      /*  ssExplode 가 «쪼개기 전»에 이미 봤다. 구성품 코드로 걸린 건은
          원본코드·품목코드 어느 쪽으로도 안 찾아지므로 그 표식을 먼저 본다. */
      var 예외 = (u.대리품목걸림 ? 대리품목[u.대리품목걸림] : null) ||
                 대리품목[ssText(u.원본코드).toUpperCase()] ||
                 대리품목[ssText(u.품목코드).toUpperCase()];
      if (예외) {
        if (면제) {
          ssWarn(warnings, '주의', 'PITEM_BEATS_MANUAL', u.고유ID + ' / ' + 예외.코드,
            '보류 탭에서 「발송」으로 잡혀 있었지만 «대리발송품목» 표가 이깁니다. ' +
            '우리가 보내려면 그 품목을 「대리발송품목」 탭에서 지우세요.');
        }
        u.route = SS_ROUTE.PARTNER;
        u.보류상세 = 예외.사유 || '';
        u.대리품목적용 = 예외.코드;
        /* ★ 재고를 근거로 「지우세요」 하지 않는다 ★
           > 「재고가 실시간 반영이 안되니까 하는소리지..」
           시트 재고는 실시간이 아니다. 그걸 근거로 입고됐다고 말하면
           «그럴듯하게 틀린» 잔소리가 된다. 언제 지울지는 사람이 안다. */
        /* ★ 적어 넣은 업체코드를 그대로 쓴다 ★  (2026-09-15)
           「대리발송업체」 표에 없다고 버리면 안 된다. 그 표는 이름을 붙이려고
           있는 것이지 허가증이 아니다. 업체를 실제로 가리는 것은 허브 푸시이고
           그쪽은 제 표를 따로 갖고 있다 — JT(준테크)처럼 여기엔 없고 거기엔
           있는 코드가 실제로 있다.
           버리면 업체코드가 빈칸이 되고, 푸시는 품목 앞 두 글자로 되돌아간다.
           재고가 없어 남에게 맡기는 물건일수록 코드가 «우리 것»이라(MATYG…)
           앞 두 글자로는 아무 데도 안 걸려 미분류로 남는다. */
        var 예업 = 예외.업체코드;
        if (예업) {
          u.업체코드 = 예업;
          u.업체명 = vendors[예업] || '';
          if (!vendors[예업]) {
            ssWarn(warnings, '주의', 'PITEM_NEW_VENDOR', u.품목코드 + ' / ' + 예업,
              '「대리발송업체」 표에 없는 코드라 업체명을 비워 둡니다. ' +
              '푸시는 이 코드로 갑니다. 이름까지 보이게 하려면 그 표에 한 줄 더하세요.');
          }
        }
        if (!u.업체코드) {
          ssWarn(warnings, '주의', 'PITEM_NO_VENDOR', u.고유ID + ' / ' + u.품목코드,
            '「대리발송품목」이라 대리발송으로 보냈는데 업체코드를 못 정했습니다. ' +
            '그 탭의 업체코드 칸을 채우거나, 대리발송 탭에서 손으로 채우세요.');
        }
        continue;
      }
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


    var zip = ssText(addrZip[addr]);
    u.우편번호 = zip;

    // 0) 도선료 표 — 택배사가 실제로 청구하는 기준이라 가장 정확하다.
    //    읍·면은 도로명주소에도 그대로 들어가므로 주소 문자열만으로 확정된다.
    //    「리조건」이 붙은 곳은 그 읍·면 안에서 적힌 리만 대상이라, 리가 주소에
    //    없으면 확정하지 않고 아래 우편번호 판정으로 넘긴다.
    var fh = ssFerryMatch(addr, ferry);
    if (fh) {
      u.도서권역 = fh.권역;
      u.도서판정 = '도선료표';
      /* ★ 우도·추자는 항공료가 더 붙는다 ★
         비행기로 제주까지 간 뒤 배로 한 번 더 나간다. 도선료만 적으면
         제주 왕복분이 통째로 빠진다 (2026-09-08 사장님 확인). */
      u.도선료 = ssSurcharge(addr, fh.권역, ferry).합계;
      if (면제) { ssIslandSkipByManual_(u, warnings); continue; }
      u.route = 위탁 ? SS_ROUTE.LOTTE_ISLAND_CONSIGN : SS_ROUTE.LOTTE_ISLAND;
      continue;
    }

    // 1) 우편번호가 있으면 그것만으로 끝난다. 도시 이름은 보지 않는다.
    if (zip) {
      if (islandZip[zip]) {
        u.도서권역 = islandZip[zip];
        u.도서판정 = '우편번호';
        /* 제주 본섬은 도선료표에 없다(우도·추자만 있다). 항공료 정액만 붙는다. */
        u.도선료 = ssSurcharge(addr, islandZip[zip], ferry).합계;
        if (면제) { ssIslandSkipByManual_(u, warnings); continue; }
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
      //  «빼는 건»만 금액을 센다 — 얼마를 못 받는지 말하기 위해서다.
      //  안 빠지는 줄의 도선료 칸은 여태 하던 대로 둔다(이 자리 일이 아니다).
      if (면제) {
        u.도선료 = ssSurcharge(addr, 확정, ferry).합계;
        ssIslandSkipByManual_(u, warnings);
        continue;
      }
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

  /* ★ 도선료 표가 아직 옛 택배사 것이면 알린다 ★  (2026-09-11)
       2026-09-11 에 롯데 → 로젠으로 바꿨는데, 도선료 표는 코드가 아니라
       탭에 심어 둔 «자료»라 택배사를 바꿔도 그대로 남는다. 그대로 두면
       로젠이 청구하는 금액과 다른 값을 고객에게 안내하게 된다 —
       아무 오류도 안 나고, 청구서를 받는 다음 달에야 안다.

       도서산간 건이 «실제로 나온 회차»에만 알린다. 매번 뜨면 눈이 감긴다.
       표를 갈아 넣은 뒤 설정의 「도선료표_기준」을 로젠으로 바꾸면 멎는다. */
  var 표기준 = ssText(cfg.도선료표_기준) || '롯데';
  if (표기준.indexOf('로젠') < 0) {
    var 도서건 = 0;
    for (var f = 0; f < units.length; f++) {
      if (units[f].route === SS_ROUTE.LOTTE_ISLAND ||
          units[f].route === SS_ROUTE.LOTTE_ISLAND_CONSIGN) 도서건++;
    }
    if (도서건) {
      ssWarn(warnings, '주의', 'FERRY_TABLE_OLD', 표기준 + ' 기준',
        '도선료 표가 아직 「' + 표기준 + '」 기준입니다. 이번 회차 도서산간 ' + 도서건 +
        '건의 추가운임이 로젠 청구액과 다를 수 있습니다. ' +
        '「도서산간_도선료」 탭을 로젠 표로 바꾼 뒤 설정의 「도선료표_기준」을 로젠으로 고치세요.');
    }
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

/**
 * 제주 항공료 — 롯데는 제주를 「제주연계」로 정액 청구한다.
 * 도선료 표에는 제주 본섬이 없다(우도·추자만 있다). 본섬은 이 정액만 붙는다.
 * ★ 2026-09-08 사장님이 정해 주신 값 ★
 */
var SS_AIR_FEE_JEJU = 3000;

/**
 * 반품 박스비 — 반품은 상자를 새로 써야 해서 도서·육지를 가리지 않고 붙는다.
 * ★ 2026-09-08 사장님 지시: "반품시에는 +1000(박스비용)원을 더해서" ★
 */
var SS_RETURN_BOX_FEE = 1000;

/**
 * ★ 조치 「발송」이면 도서산간에서 뺀다 ★  (2026-09-18)
 *
 *   > "조치를 실행하면 도서산간도 발송으로 처리한 것들은 도서산간에서 빠지게 해줘"
 *
 * 여태 도서 판정 셋(도선료표 · 우편번호 · 지역확정)은 조치를 «안 봤다».
 * 사람이 보고 「발송」이라 눌러도 그 줄은 도서산간 탭에 그대로 남았다.
 *
 * ★ 대신 잃는 것 ★ 도선료·항공료가 안 붙는다. 진짜 섬이면 그만큼 못 받는다.
 *   그래서 «조용히» 빼지 않는다 — 얼마가 빠지는지 경고에 적는다.
 */
function ssIslandSkipByManual_(u, warnings) {
  u.route = SS_ROUTE.LOTTE;
  u.도서면제 = true;
  var 뺀료 = Number(u.도선료) || 0;
  ssWarn(warnings, '주의', 'ISLAND_SKIPPED_BY_MANUAL',
    (u.고유ID || '') + ' / ' + (u.정규주소 || ''),
    '조치 「발송」이라 도서산간에서 뺐습니다 (' + (u.도서판정 || '판정없음') +
    ' · ' + (u.도서권역 || '권역없음') + '). 추가운임 ' +
    (뺀료 > 0 ? 뺀료 + '원' : '(금액 미상)') + '은 못 받습니다.');
}

/**
 * 도서·제주 추가운임.
 *
 * ★ 항공료와 도선료는 **더한다** ★
 *   사장님 확인 (2026-09-08): "제주도 항공료 3000원 / 우도면, 추자면 항공료외 도선추가".
 *   제주 본섬은 항공료만, 우도·추자는 항공료 + 배편 삯이다. 둘 중 큰 것을 고르는
 *   것이 아니라 둘 다 든다 — 비행기로 제주까지 간 뒤 배로 한 번 더 나간다.
 *
 * @param addr  정규화된 주소
 * @param zone  이미 판정된 권역('제주'|'도서'|''). 없으면 도선료표에서 본다.
 * @param ferry 롯데 도선료 표
 */
function ssSurcharge(addr, zone, ferry, opts) {
  opts = opts || {};
  var air = opts.항공료 == null ? SS_AIR_FEE_JEJU : (Number(opts.항공료) || 0);
  var fh = ssFerryMatch(addr, ferry);
  var 도선료 = fh ? (Number(fh.료) || 0) : 0;
  /* 권역은 부르는 쪽이 이미 정했으면 그것을 믿는다 — 우편번호 판정이
     도선료표보다 넓다(제주 본섬은 표에 없고 우편번호로만 잡힌다). */
  var z = ssText(zone) || (fh ? fh.권역 : '');
  var 항공료 = z === '제주' ? air : 0;
  return {
    권역: z,
    항공료: 항공료,
    도선료: 도선료,
    합계: 항공료 + 도선료,
    근거: fh ? ('도선료표 ' + fh.읍면동) : (z ? (z + ' 권역') : '')
  };
}

/**
 * 반품비 — 추가운임에 박스비를 더한 것.
 * 육지 반품도 박스비는 든다. 그래서 도서가 아니어도 0 이 아니다.
 */
function ssReturnFee(addr, zone, ferry, opts) {
  opts = opts || {};
  var s = ssSurcharge(addr, zone, ferry, opts);
  var box = opts.박스비 == null ? SS_RETURN_BOX_FEE : (Number(opts.박스비) || 0);
  return {
    권역: s.권역,
    항공료: s.항공료,
    도선료: s.도선료,
    박스비: box,
    합계: s.합계 + box,
    근거: s.근거
  };
}

/**
 * 롯데 도선료 표에서 주소에 맞는 행을 찾는다.
 *
 * 시군구와 읍면동이 둘 다 주소에 있어야 한다. 읍면동만 보면 「남면」처럼
 * 여러 시군에 있는 이름이 엉뚱한 곳을 잡는다.
 * 리조건이 있으면 그 리까지 주소에 있어야 확정이다 — 없으면 null 을 돌려
 * 우편번호 판정에 맡긴다. 그 읍·면 전체가 도선료 대상은 아니기 때문이다.
 */
function ssFerryMatch(addr, ferry) {
  if (!addr || !ferry || !ferry.length) return null;
  for (var i = 0; i < ferry.length; i++) {
    var f = ferry[i];
    if (!f.시군 || !f.읍면동) continue;
    if (addr.indexOf(f.시군) < 0) continue;
    if (addr.indexOf(f.읍면동) < 0) continue;
    if (f.리 && f.리.length) {
      var hit = false;
      for (var j = 0; j < f.리.length; j++) {
        // 「매화리1구~3구」 같은 표기는 앞의 리 이름만 본다
        var ri = ssText(f.리[j]).split(/[0-9(]/)[0].trim();
        if (ri && addr.indexOf(ri) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
    }
    return { 권역: f.권역 || '도서', 료: f.료 || 0, 읍면동: f.읍면동 };
  }
  return null;
}

function ssIslandRow(u) {
  /* 맨 뒤 「조치」는 **빈 칸으로 낸다.** 사람이 확인하고 채우는 자리다.
     회차마다 출력 탭을 통째로 다시 쓰므로 지난 회차의 체크는 남지 않는다 —
     그게 맞다. 남아 있으면 「전에 봤으니 됐겠지」가 된다. */
  return [u.도서권역 || '', u.우편번호 || '', u.도서판정 || '', u.도선료 || '']
    .concat(ssOutRow(u)).concat(['']);
}

function ssNonshipRow(u) {
  return ssOutRow(u).concat([u.비배송사유 || '']);
}

function ssPartnerRow(u) {
  return ssOutRow(u).concat([u.업체코드 || '', u.업체명 || '', u.수동조치 || '']);
}

function ssHoldRow(u) {
  return ssOutRow(u).concat([u.보류사유 || '', u.보류상세 || '',
    u.조치입력 || '', u.메모입력 || '', u.원본코드 || '']);
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
    u.도서권역 || '', u.우편번호 || '', u.도서판정 || '', u.도선료 || '',
    u.주소변경 || '', u.원받는분 || '', u.원주소1 || '', u.원연락처 || '',
    u.받는분, u.전화, u.모바일, u.주소1, u.배송메시지, u.합계,
    u.적요, u.사방넷주문번호, u.보내는분, u.보내는분전화,
    '', '',
    /* 운송장번호·송장매칭은 전파가 나중에 채운다. 조치는 지금 안다. */
    u.수동조치 || '',
    (u.수동조치 === '대리발송' ? (u.업체코드 || '') : ''),
    ''   // 택배사 — 세트분리 때는 모른다. 송장 전파가 송장과 같이 적는다.
  ];
}

/* ── 전체 실행 ────────────────────────────────────────── */

/**
 * ══════════════════════════════════════════════════════════════
 *  출력 탭을 «집는 차례»로 정렬한다
 *  2026-09-14
 *
 *  출고지 → 품목코드 → 들어온 차례.
 *
 *  ★ 품목«코드»로 묶는다, 이름이 아니라 ★
 *    합포장 대표행의 출력품목명은 「A+B+C ===합배송」처럼 합쳐진 이름이다.
 *    이름으로 묶으면 그 박스만 엉뚱한 자리에 홀로 선다. 코드는 안 변한다.
 *
 *  ★ 들어온 차례를 끝까지 남긴다 ★
 *    같은 출고지·같은 품목 안에서는 판매현황 차례 그대로다. 자리표를 따로
 *    들고 비교한다 — 엔진이 안정 정렬이 아니어도 결과가 흔들리지 않게.
 *    회차마다 순서가 달라지면 「어제 것과 같은지」를 사람이 못 본다.
 *
 *  ★ 제자리에서 고친다 ★  buckets 를 그대로 쓰는 곳이 많다.
 *
 *  @param {Array} list 한 탭의 units
 *  @return {Array} 같은 배열
 * ══════════════════════════════════════════════════════════════
 */
/**
 * ══════════════════════════════════════════════════════════════
 *  대리발송 탭에 손으로 넣은 줄 — 이카운트 코드로 나머지를 채운다
 *  2026-09-14
 *
 *  > "대리발송에 하단에 추가하고싶은 발송을 넣으면 추가될수 있게 해줘
 *  >  이카운트 코드로 자동으로.. 그외는 업체 코드를 넣을께"
 *
 *  ★ 왜 손으로 넣나 ★
 *    수집에서 빠졌거나 분류가 안 돼 발주에서 통째로 누락된 건이 생긴다.
 *    그걸 메우려면 대리발송 탭에 줄을 보태야 하는데, 열이 스물두 개라
 *    사람이 다 채우다 보면 반드시 어딘가 틀린다. 코드 하나만 받는다.
 *
 *  ★ 이미 있는 값은 «안» 덮는다 ★
 *    사람이 일부러 고쳐 놓은 것을 기계가 되돌리면, 고칠 방법이 없어진다.
 *    빈 칸만 채운다.
 *
 *  ★ 업체코드는 안 건드린다 ★
 *    사장님이 손으로 넣으신다고 했다. 기계가 추측해 넣으면 «그럴듯하게 틀린»
 *    업체로 발주가 나간다 — 오늘 이름 매칭에서 본 그 모양이다.
 *
 *  @param code  이카운트(품목) 코드
 *  @param items ssm_load 의 M.items  { 코드: {name, ...} }
 *  @param 기존  지금 그 줄의 값 배열 (SS_PARTNER_HEADER 자리)
 *  @return {{ok:boolean, why:string, 채움:Object}}  채움 = {자리번호: 값}
 * ══════════════════════════════════════════════════════════════
 */
function ssAutofillPartner(code, items, 기존) {
  기존 = 기존 || [];
  var c = ssText(code);
  if (!c) return { ok: false, why: '', 채움: {} };

  var it = (items || {})[c];
  if (!it) {
    return { ok: false, 채움: {},
      why: '「' + c + '」 은 M_품목정보에 없는 코드입니다. 코드를 확인하거나 품목명을 손으로 적으세요.' };
  }

  var 비었나 = function (i) { return !ssText(기존[i]); };
  var 채움 = {};
  //  자리는 SS_OUT_HEADER 그대로다 — 0 출고지 · 4 품목명 · 5 택배박스수량 · 6 수량
  if (비었나(0)) 채움[0] = SS_ROUTE.PARTNER;
  if (비었나(4)) 채움[4] = ssText(it.name);
  if (비었나(5)) 채움[5] = 1;
  if (비었나(6)) 채움[6] = 1;
  return { ok: true, why: '', 채움: 채움 };
}

/**
 * ══════════════════════════════════════════════════════════════
 *  보류 탭에서 고친 코드·품목명을 실제로 반영한다
 *  2026-09-14
 *
 *  > "미발송으로 빠지는 제품의 경우 우리가 코드와 품목명을 수정하고
 *  >  발송 이라고 적으면 그 내용으로 수정되어 넘어가면 좋겠어"
 *
 *  ★ ssEnrich «앞»에서 돈다 ★
 *    품목명·배송비·재고는 전부 품목코드로 끌어온다. 코드를 바꿔 놓고
 *    Enrich 를 돌려야 새 코드의 것이 붙는다. 뒤에서 바꾸면 이름만 바뀌고
 *    배송비는 옛 코드 것이 남는다 — 그게 제일 나쁘다. 맞아 보이는데 틀리니까.
 *
 *  ★ 원본코드는 «안» 바꾼다 ★
 *    조치를 거는 열쇠가 원본코드다. 그것까지 바꾸면 다음 실행에서 자기가
 *    건 조치를 자기가 못 찾는다.
 *
 *  ★ 새 코드가 세트면 말해 준다 ★
 *    세트 분해(ssExplode)는 이미 끝난 뒤다. 세트 코드로 바꾸면 쪼개지지 않고
 *    한 줄로 나간다 — 조용히 그러면 몸통만 나가고 뚜껑이 빠진다.
 *
 *  @return {number} 바꾼 줄 수
 * ══════════════════════════════════════════════════════════════
 */
function ssApplyManualEdits(units, masters, warnings) {
  var override = (masters && masters.override) || {};
  var items = (masters && masters.items) || {};
  var bom = (masters && masters.bom) || {};
  var n = 0;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var ov = override[ssText(u.고유ID) + '|' + ssText(u.원본코드)];
    if (!ov) continue;
    var 새코드 = ssText(ov.새코드), 새이름 = ssText(ov.새이름);
    if (!새코드 && !새이름) continue;

    if (새코드 && 새코드 !== ssText(u.품목코드)) {
      if (!items[새코드]) {
        ssWarn(warnings, '오류', 'MANUAL_CODE_UNKNOWN', u.고유ID + ' → ' + 새코드,
          '보류 탭에서 고친 코드가 M_품목정보에 없습니다. 코드를 확인하세요 — 그대로 두면 옛 코드로 나갑니다.');
        continue;
      }
      if (bom[새코드] && bom[새코드].length) {
        ssWarn(warnings, '주의', 'MANUAL_CODE_IS_SET', u.고유ID + ' → ' + 새코드,
          '고친 코드가 «세트»입니다. 세트 분해는 이미 끝난 뒤라 쪼개지지 않고 한 줄로 나갑니다 — ' +
          '몸통·뚜껑을 따로 적어 주시거나, 판매현황을 고쳐 다시 실행하세요.');
      }
      u.품목코드 = 새코드;
      u.품목누락 = false;
      u.수정코드 = true;
      n++;
    }
    if (새이름) { u.수정이름 = 새이름; n++; }
  }
  return n;
}

function ssSortForPick(list) {
  if (!list || list.length < 2) return list;
  for (var i = 0; i < list.length; i++) list[i].__자리 = i;
  list.sort(function (a, b) {
    var x = ssText(a.출고지), y = ssText(b.출고지);
    if (x !== y) return x < y ? -1 : 1;
    var p = ssText(a.품목코드), q = ssText(b.품목코드);
    if (p !== q) return p < q ? -1 : 1;
    return a.__자리 - b.__자리;
  });
  for (var j = 0; j < list.length; j++) delete list[j].__자리;
  return list;
}

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
  /*  보류 탭에서 고친 코드·품목명을 «Enrich 앞»에서 반영한다.
      품목명·배송비·재고가 전부 코드로 끌려오므로 여기서 바꿔야 새 코드 것이 붙는다. */
  ssApplyManualEdits(units, masters, warnings);
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

  /* ★ 로젠택배 탭은 «출고지 → 같은 품목끼리» 모은다 ★  (2026-09-14)
     > "로젠택배 정렬을 출고지 순서대로.. 그리고 같은 품목끼리 뭉쳐서
     >  정리가 되게 해줘...기존 세트분리가 그렇게 처리 되있음"

     이 탭은 그대로 송장 인쇄로 넘어간다. 인쇄 차례가 곧 «집는 차례»다.
     판매현황에 들어온 순서대로 두면 같은 물건을 창고에서 몇 번씩 다시 집으러
     간다. 구 세트분리가 그렇게 하고 있었고, 뉴로 오면서 그것만 빠졌다.

     대리발송은 안 건드린다 — 업체별로 나가는 표라 성격이 다르고,
     지금 대리공급 푸시가 그 탭을 읽는다(_partnerExclusivePush.gs). */
  var 정렬대상 = [SS_ROUTE.LOTTE, SS_ROUTE.LOTTE_ISLAND,
    SS_ROUTE.LOTTE_ISLAND_CONSIGN];
  for (var si = 0; si < 정렬대상.length; si++) ssSortForPick(buckets[정렬대상[si]]);

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
 *   0903-PH-…      세트분리 전화주문 발급
 */
function ssIsSabangnetUid(uid) {
  var u = ssText(uid);
  if (!u) return false;
  if (/^\d{4}-[A-Za-z]{2}-/.test(u)) return false;   // MMdd-ds- · MMdd-PH- 형
  if (/^\d{6}-PH-/.test(u)) return false;            // 구 YYMMDD-PH- 형 (과거 발급분)
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

var SS_DUP_HEADER = ['확인', '그룹', '등급', '사유', '회차간', '회차', '고유ID', '번호출처', '경로',
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

    /*  ★ 이름·전화·주소로 짐작하는 세 등급을 지웠다 ★  (2026-09-15)
        > "중복검사도 고유아이디로만 중복검사를 하게 해줘..
        >  (중복검사를 빼고 싶지만 세트분리랑 또 별개의 시스템이라 최소한의 검증)"

        지운 것 —
          🔴 수취인+전화+주소+품목
          🟡 수취인+주소+품목 (전화 다름/없음)
          ⚪ 수취인+품목 (주소 다름)

        같은 사람이 같은 물건을 이틀에 걸쳐 시키는 일은 흔하다. 한 거래처가
        여러 지점으로 보내기도 한다. 이름·전화·주소가 같다고 중복이라 하면
        정상 주문이 걸리고, 사람은 매번 그걸 들여다보며 아니라고 판단해야 한다.
        오늘 이 방에서 이름·전화로 짚는 다른 길들도 같은 까닭으로 다 지웠다.

        ★ 고유ID + 품목 하나만 남긴다 ★
          같은 주문번호에 같은 품목이 두 번 있으면 그건 «사실»이다 —
          판매현황을 두 번 붙여넣었거나 세트분리를 두 번 돌린 것이다.
          짐작이 아니라서 사람이 볼 값어치가 있다. 최소한의 검증은 이것이다.

        되살릴 일이 있으면 git 이 갖고 있다. 코드로 남겨 두지 않는다. */
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
      주문번호출처: ssText(r.주문번호출처),
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
/**
 * ══════════════════════════════════════════════════════════════
 *  «연속 블록»으로 딸려온 지난 회차 건을 찾는다
 *  2026-09-14
 *
 *  > "판매현황에서 이전회차건이 실수로 같이 딸려오는경우
 *  >  (확실한건 고유아이디인데.. 전화주문은 고유아이디가 없다보니)"
 *
 *  ★ 한 줄씩 보면 못 가린다 ★
 *    같은 사람이 같은 물건을 다시 시키는 일은 늘 있다. 한 줄만 겹쳤다고
 *    중복이라 하면 정상 재주문이 매번 걸리고, 매번 걸리면 안 보게 된다.
 *    붙여넣기 범위가 겹쳐 딸려온 것은 다르다 — **여러 줄이 지난 회차와
 *    같은 차례로 줄줄이 이어진다.** 그 «이어짐»이 곧 증거다.
 *
 *  ★ 고유ID 를 안 쓴다 ★
 *    고유ID 가 있으면 애초에 🔴 확실 등급이 잡는다. 여기서 가리려는 것은
 *    **전화주문처럼 고유ID 가 없는 줄**이다. 그래서 이름+주소+품목으로만 센다.
 *
 *  ★ 두 줄부터 본다 ★
 *    한 줄은 위 등급 검사의 몫이다. 여기서 또 세면 같은 것을 두 번 말한다.
 *
 *  @param records ssFindDuplicates 가 접은 주문라인. **원장에 쌓인 차례** 그대로다.
 *  @param 오늘접두 오늘 회차키 앞 6자리 (yyMMdd)
 *  @param 최소 몇 줄부터 볼 것인가 (기본 2)
 *  @return Array<{grade,reason,회차간,members,sig,이전회차,길이}>
 * ══════════════════════════════════════════════════════════════
 */
function ssDupRunGroups(records, 오늘접두, 최소) {
  최소 = 최소 > 0 ? 최소 : 2;
  /*  ★ 사방넷 건은 여기서 세지 않는다 ★  (2026-09-16)
      > "고유아이디가 다른데 중복의심이라고 뜨네..사방넷주문번호일경우.."
      > "전화주문은 세트분리에서 고유번호를 만들기떄문"

      윗머리 설명에는 「고유ID 를 안 쓴다 — 여기서 가리려는 것은 전화주문처럼
      고유ID 가 없는 줄」이라고 적어 두고, 정작 코드는 그러지 않았다.
      사방넷 줄까지 이름·주소·품목으로 세는 바람에 주문번호가 «엄연히 다른»
      두 건이 중복 의심으로 올라왔다. 적어 둔 뜻대로 코드를 맞춘다.

      사방넷주문번호는 쇼핑몰이 확정해 보낸 것이다. 다르면 다른 주문이고,
      같으면 위의 🔴 「동일 고유ID + 품목」이 이미 잡는다. 여기서 또 보는 것은
      «틀릴 때만» 쓸모가 있다.

      ★ 전화주문만 남긴다 ★
        전화주문의 고유ID 는 우리가 만든다(ssMakeOrderId). 전표번호·이름·
        연락처·주소·품목·수량을 섞은 해시라, 같은 주문을 전표번호만 달리 해서
        다시 적으면 다른 값이 나온다. 그래서 ID 로는 못 가린다.
        대신 이름 + 품목코드 + 수량 (+주소)이 지난 회차와 «줄줄이» 같은가를 본다. */
  var 키of = function (r) {
    if (ssText(r.주문번호출처) === SS_ORDNO_SRC.사방넷) return '';   // 고유ID 가 답을 준다
    var n = ssNameKey(r.받는분), a = ssAddrKey(r.주소), c = ssText(r.품목코드);
    if (!n || !a || !c) return '';          // 못 가리는 줄은 안 센다
    //  수량까지 같아야 같은 줄로 본다 — 「주문갯수」가 다르면 다시 시킨 것이다
    return n + '|' + a + '|' + c + '|' + ssNum(r.수량);
  };

  //  회차별로 «쌓인 차례» 그대로 나눈다. 차례가 곧 증거라 정렬하지 않는다.
  var 오늘 = [], 지난 = {};
  for (var i = 0; i < records.length; i++) {
    var rk = ssText(records[i].회차);
    if (!rk) continue;
    if (rk.substring(0, 6) === 오늘접두) 오늘.push(i);
    else (지난[rk] || (지난[rk] = [])).push(i);
  }
  if (오늘.length < 최소) return [];

  var 오늘키 = 오늘.map(function (ix) { return 키of(records[ix]); });
  var 결과 = [];

  for (var rk2 in 지난) {
    if (!Object.prototype.hasOwnProperty.call(지난, rk2)) continue;
    var 그때 = 지난[rk2];
    if (그때.length < 최소) continue;
    var 그때키 = 그때.map(function (ix) { return 키of(records[ix]); });

    /*  이어진 길이를 재는 표를 두 줄만 들고 굴린다.
        dp[j] = 「오늘 i 번째와 그때 j 번째에서 끝나는 이어짐의 길이」.
        다음 칸으로 못 이어지면 그 자리가 «가장 긴 이어짐»의 끝이다. */
    var 앞 = new Array(그때키.length + 1);
    for (var z = 0; z <= 그때키.length; z++) 앞[z] = 0;
    for (var a1 = 0; a1 < 오늘키.length; a1++) {
      var 이번 = new Array(그때키.length + 1);
      이번[0] = 0;
      for (var b1 = 0; b1 < 그때키.length; b1++) {
        var 같나 = 오늘키[a1] && 오늘키[a1] === 그때키[b1];
        이번[b1 + 1] = 같나 ? 앞[b1] + 1 : 0;
        if (!같나) continue;
        var L = 이번[b1 + 1];
        if (L < 최소) continue;
        //  다음 칸으로 더 이어지면 여기서 끊지 않는다 — 가장 긴 것만 남긴다
        var 더 = (a1 + 1 < 오늘키.length && b1 + 1 < 그때키.length &&
                  오늘키[a1 + 1] && 오늘키[a1 + 1] === 그때키[b1 + 1]);
        if (더) continue;
        var mem = [];
        for (var m = L - 1; m >= 0; m--) mem.push(오늘[a1 - m]);
        결과.push({
          grade: '🔴 확실', 회차간: true, 이전회차: rk2, 길이: L,
          reason: '이전 회차(' + rk2 + ')와 연속 ' + L + '줄이 같음 — 딸려온 듯',
          members: mem, sig: mem.join(','),
        });
      }
      앞 = 이번;
    }
  }

  /*  같은 줄이 여러 지난 회차와 겹칠 수 있다. 긴 것부터 두고, 이미 잡힌 줄만으로
      이뤄진 것은 버린다 — 같은 사실을 두 번 말하지 않는다. */
  결과.sort(function (x, y) { return y.길이 - x.길이; });
  var 쓴줄 = {}, 남김 = [];
  for (var g = 0; g < 결과.length; g++) {
    var G = 결과[g], 새것 = false;
    for (var k = 0; k < G.members.length; k++) if (!쓴줄[G.members[k]]) { 새것 = true; break; }
    if (!새것) continue;
    for (var k2 = 0; k2 < G.members.length; k2++) 쓴줄[G.members[k2]] = true;
    남김.push(G);
  }
  return 남김;
}

function ssDupRows(found) {
  var out = [];
  for (var g = 0; g < found.groups.length; g++) {
    var G = found.groups[g];
    for (var m = 0; m < G.members.length; m++) {
      var r = found.records[G.members[m]];
      out.push([false, g + 1, G.grade, G.reason, G.회차간 ? '회차간' : '',
        r.회차, r.고유ID, r.주문번호출처 || '', r.경로, r.받는분, r.전화,
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
    ssParseAddrOverride: ssParseAddrOverride, ssLooksPhone: ssLooksPhone, ssMakeOrderId: ssMakeOrderId, SS_ID_SHORT_FROM: SS_ID_SHORT_FROM, ssHash4: ssHash4, ssHashN: ssHashN, ssFingerprint: ssFingerprint, ssSalesIdCells: ssSalesIdCells,
    ssFindDuplicates: ssFindDuplicates, ssDupRows: ssDupRows, SS_DUP_HEADER: SS_DUP_HEADER,
    ssDupRunGroups: ssDupRunGroups, SS_ORDNO_SRC: SS_ORDNO_SRC,
    ssOutRow: ssOutRow, ssMergedRow: ssMergedRow, ssIslandRow: ssIslandRow, ssFerryMatch: ssFerryMatch, SS_FERRY_HEADER: SS_FERRY_HEADER,
    ssSurcharge: ssSurcharge, ssReturnFee: ssReturnFee,
    SS_AIR_FEE_JEJU: SS_AIR_FEE_JEJU, SS_RETURN_BOX_FEE: SS_RETURN_BOX_FEE,
    ssPartnerRow: ssPartnerRow, ssHoldRow: ssHoldRow, ssVendorOf: ssVendorOf,
    ssInvoiceRows: ssInvoiceRows, ssIsSabangnetUid: ssIsSabangnetUid, SS_INVOICE_HEADER: SS_INVOICE_HEADER,
    ssNonshipRow: ssNonshipRow, ssNonShipReason: ssNonShipReason, SS_NONSHIP_HEADER: SS_NONSHIP_HEADER,
    SS_PARTNER_HEADER: SS_PARTNER_HEADER, SS_MANUAL_HEADER: SS_MANUAL_HEADER, SS_VENDOR_HEADER: SS_VENDOR_HEADER, ssLedgerRow: ssLedgerRow, ssDisplayName: ssDisplayName,
    ssStripName: ssStripName, ssNormAddr: ssNormAddr, ssPad6: ssPad6
  };
}
