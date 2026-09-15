/**
 * gasIO.js — 시트 입출력 도우미
 * 이 파일과 gasMasters/gasMain 만 SpreadsheetApp 을 만진다. 계산은 전부 core.js.
 */

var SSIO_TABS = {
  입력: '판매현황',
  /* ★ 2026-09-09: 고유아이디를 붙인 사본 ★
     사장님: "맨앞텝(판매현황)에 판매현황을 복붙하고 … 판매현황_고유아이디 라는
     텝으로 … 시트내에서 다 처리되면 좋겠어"
     붙여넣는 칸(판매현황)은 깨끗하게 두고, 아이디를 채운 것은 여기 따로 낸다.
     같은 탭에 되쓰면 다음 회차에 지우고 붙여넣기 전까지 옛 아이디가 남는다. */
  입력아이디: '판매현황_고유아이디',
  출력: ['로젠택배', '로젠택배-도서산간', '로젠택배-도서산간(위탁배송)', '로젠택배-동네배송', '대리발송'],
  합배송: '합배송',
  비배송: '비배송',
  사방넷송장: '사방넷송장',
  사방넷등록: '사방넷등록',
  /* ★ 엑셀 저장 결과는 «다른 탭»에 남긴다 ★  (2026-09-11)
     「사방넷등록」은 송장 전파가 쓰는 탭이다(3칸: 주문번호·송장·택배사).
     엑셀 저장도 여기에 5칸(주문번호·송장·빈칸·빈칸·택배사코드)으로 덮어써서,
     나중에 실행한 쪽이 이기고 있었다 — 「전파는 385건인데 왜 91건이냐」의
     절반이 이것이다. 허브의 세트분리(뉴) 보강도 3번째 칸을 택배사로 읽는데
     5칸 모양에서는 빈칸을 읽는다. 자리를 갈라 둘이 서로를 안 지우게 한다. */
  사방넷대량등록: '사방넷대량등록',
  /* ★ 마지막으로 «내보낸» 목록 ★  (2026-09-14)
     엑셀에 들어간 그대로를 시트에도 남긴다. 출력 탭은 로젠택배와 도서산간으로
     갈려 있어서, 실제로 로젠에 올린 한 장이 무엇이었는지 시트에서는 볼 수가
     없었다. 나중에 「이 건이 나갔나」를 물을 데가 필요하다.
     ※ 세트분리 실행은 이 탭을 안 건드린다 — 출력했을 때만 갈아 끼운다. */
  출력사본: '로젠택배_출력',
  보류: '보류(미발송)',
  경고: '경고',
  요약: '실행요약',
  원장: '주문라인원장',
  실행이력: '실행이력',
  회차: '회차',
  중복의심: '중복의심',
  수동조치: '수동조치',
  업체: '대리발송업체',
  설정: '설정',
  M품목: 'M_품목정보',
  M재고: 'M_재고',
  MBOM: 'M_BOM',
  M배송비: 'M_배송비규칙',
  합배송조건: '합배송조건',
  분리예외: '분리예외',
  도서산간시군: '도서산간_시군',
  도서산간우편: '도서산간_우편번호',
  도선료: '도서산간_도선료',
  도서산간사전: '도서산간_주소사전',
  동네배송: '동네배송_금일'
};

/** 이 스크립트가 붙어 있는 스프레드시트 (헤드리스 실행 대비 ID 폴백) */
var SSIO_SHEET_ID = '1JuwZjorbBG7tOa92xfAy07eUV-r2j2P8bpbYrgCDAwo';

function ssio_ss() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  try {
    return SpreadsheetApp.openById(SSIO_SHEET_ID);
  } catch (e) {
    var who = '';
    try { who = Session.getActiveUser().getEmail() || '(확인 불가)'; } catch (e2) { who = '(확인 불가)'; }
    throw new Error(
      '세트분리(뉴) 스프레드시트를 열 수 없습니다.\n' +
      '  시트 ID : ' + SSIO_SHEET_ID + '\n' +
      '  실행 계정 : ' + who + '\n' +
      '  원인 : ' + e.message + '\n\n' +
      '이 계정이 시트 소유자(pack2u@pack2u.co.kr)와 다르면\n' +
      '브라우저에서 해당 계정으로 로그인한 뒤 시트 메뉴에서 다시 실행하세요.');
  }
}

/** UI가 없는 환경(clasp run·트리거)에서는 로그로 대신한다 */
function ssio_alert(msg) {
  try { SpreadsheetApp.getUi().alert(msg); }
  catch (e) { Logger.log(msg); }
  return msg;
}

function ssio_sheet(name, headers) {
  var ss = ssio_ss();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  if (headers && headers.length && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

/** 헤더 1행을 남기고 그 아래를 전부 비운다 */
function ssio_clearBody(sh) {
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getMaxColumns()).clearContent();
}

/** 헤더 아래로 값 덮어쓰기 */
/**
 * 앞자리 0 이 살아 있어야 하는 칸들.
 *
 * ★ 2026-09-14: 「대리발송 전화번호 앞에 0이 빠지네」 ★
 *   값이 멀쩡한 문자열 '01012345678' 이어도, 칸 서식이 «자동»이면 구글이
 *   수로 알아듣고 앞 0 을 지워 보여 준다. 사람 눈에는 값이 틀린 것으로 보이고,
 *   그 탭을 복사해 업체에 보내면 «실제로» 틀린 번호가 간다.
 *   ss_로젠출력엑셀 은 파일로 낼 때 이미 이 처리를 한다 — 탭에는 없었다.
 *
 *   수량·합계·배송비는 넣지 않는다. 텍스트로 굳으면 더하기가 안 된다.
 */
var SSIO_TEXT_COLS = ['전화', '모바일', '보내는분전화', '원연락처', '우편번호',
  '운송장번호', '송장번호', '사방넷주문번호', '고유ID', '주문번호'];

function ssio_write(name, headers, rows, style) {
  var sh = ssio_sheet(name, headers);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  ssio_clearBody(sh);
  if (rows && rows.length) {
    /*  ★ 값을 넣기 «전»에 서식을 잡는다 ★
        넣고 나서 바꾸면 이미 수로 해석된 뒤라 0 이 안 돌아온다. */
    ssio_textFormat(sh, headers, rows.length);
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  ssio_styleHeader(sh, headers.length, style);
  return sh;
}

/** 머리글 이름으로 찾아 그 열만 텍스트 서식으로. 자리로 박지 않는다. */
function ssio_textFormat(sh, headers, rowCount) {
  try {
    for (var i = 0; i < headers.length; i++) {
      if (SSIO_TEXT_COLS.indexOf(ssText(headers[i])) < 0) continue;
      sh.getRange(2, i + 1, rowCount, 1).setNumberFormat('@');
    }
  } catch (e) {
    //  서식은 곁다리다. 실패해도 자료는 들어가야 한다.
  }
}

/** 맨 아래에 이어붙이기 (이력용) */
function ssio_append(name, headers, rows) {
  var sh = ssio_sheet(name, headers);
  if (!rows || !rows.length) return sh;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  return sh;
}

function ssio_styleHeader(sh, cols, style) {
  var bg = (style && style.bg) || '#1f3d3a';
  var r = sh.getRange(1, 1, 1, cols);
  r.setBackground(bg).setFontColor('#ffffff').setFontWeight('bold').setVerticalAlignment('middle');
  sh.setFrozenRows(1);
}

/** 시트 전체 값 (없으면 빈 배열) */
function ssio_values(name) {
  var sh = ssio_ss().getSheetByName(name);
  if (!sh || sh.getLastRow() === 0) return [];
  return sh.getDataRange().getValues();
}

/** 헤더 1행을 제외한 값 */
function ssio_body(name) {
  var v = ssio_values(name);
  return v.length > 1 ? v.slice(1) : [];
}

/* ── 설정 ─────────────────────────────────────────────── */

var SSIO_CONFIG_HEADER = ['키', '값', '설명'];

var SSIO_CONFIG_DEFAULTS = [
  ['이카운트시트ID', '1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE', '품목정보·재고·BOM·상태·출고지 원천'],
  ['이카운트_품목정보탭', '이카운트-품목정보', 'A=코드 B=품목명 C=상태코드 J=배송비규칙 O=단품배송비 R=출고지코드'],
  ['이카운트_재고탭', '이카운트-재고', 'A=코드 B=가용수량'],
  ['이카운트_BOM탭', 'BOM현황', 'A=세트코드 B=세트명 E=구성품코드 H=소요량'],
  ['이카운트_상태탭', '상태', 'A=상태코드 B=상태명'],
  ['이카운트_출고지탭', '출고지', 'A=출고지코드 B=출고지명'],
  ['롯데송장시트ID', '1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs', '거래관리시스템송장 — 송장수집이 채우는 롯데 송장 원천'],
  /* ★ 자사출고 송장 원천은 «두 탭» ★  (2026-09-11)
     > "우리가 택배사를 바꿨고 거래관리대장송장의 입력_로젠주문실적에서
        송장번호를 불러와야되"

     9월 10일까지 나간 건은 롯데 탭에, 11일부터는 로젠 탭에 쌓인다.
     둘 다 읽는다 — 한쪽만 보면 갈아탄 날 앞뒤가 «조용히» 빠진다.
     롯데 탭은 더 안 늘어나니 시간이 지나면 저절로 뜻이 없어진다.
     («롯데송장시트ID» 는 두 탭이 같이 사는 파일이라 이름을 그대로 둔다) */
  ['로젠송장탭GID', '548505068', '입력_로젠주문실적 GID (E열 주문번호 · F열 운송장번호) — 지금 쓰는 택배사'],
  /* ★ 택배 마감이 지난 회차 ★  (2026-09-14)
     > "3차 오후3시 발주건들은 대리공급업체에서 송장번호를 다음날 기입하게 되"
     이 시각 뒤에 돈 회차의 «대리발송» 건은 오늘 송장이 없는 것이 정상이다.
     일일마감이 그것을 미매칭이 아니라 「업체 대기」로 센다. 회차 «번호»로
     가리지 않는 이유는, 회차를 몇 번 돌리느냐가 날마다 다르기 때문이다. */
  ['마감_업체송장_기준시각', '14:00', '이 시각 뒤 회차의 대리발송은 「업체 대기」로 센다. 택배 마감이 지나 업체가 내일 송장을 적는다'],
  ['중복점검_대상일수', '2', '중복 점검이 며칠치 회차를 견주나. 2 면 오늘+어제. 연휴 뒤엔 올린다'],
  ['기초데이터_최근실행', '', '17:00 자동 기초데이터가 마지막으로 돈 시각. 기계가 적는다 — 손대지 마세요'],
  ['출력엑셀_시트나누기', '합침', '송장출력 엑셀을 한 시트로 낼지. 「나눔」이면 탭마다 시트를 만든다(도서산간 따로 올릴 때)'],
  ['롯데송장탭GID', '1575029201', '롯데 송장탭 GID (J열 주문번호 · G열 운송장번호) — 2026-09-10 까지의 옛 건'],
  /* ★ 2026-09-11: 기본을 「전체」로 ★
     > "대량등록_대상일수 전체로 바꿔줘"
     하루 안에 다 올리지 못하고 넘어가는 날이 있는데, 「오늘만」이면
     어제 것이 영영 안 올라간다. 같은 주문을 다시 올려도 사방넷은
     송장을 덮어쓸 뿐이라, 빠뜨리는 쪽이 더 나쁘다.
     ※ 이 값은 설정 탭에 «이미 적힌 값이 이긴다». 여기를 고쳐도 지난 시트는
       안 바뀐다 — 메뉴 「📅 대량등록 대상일수」로 바꾼다. */
  ['대량등록_대상일수', '전체', '사방넷 대량등록에 포함할 날짜 범위. 1=오늘만, 2=어제까지, 전체=제한없음'],
  ['발주허브탭', '협력업체_발주허브', '상품정보 시트의 대리판매 발주허브 — C열 UID · N열 송장. 송장 전파가 함께 읽는다'],
  ['대리공급_임시기록탭', '대리공급_임시기록', '상품정보 시트의 대리공급 송장 기록. 송장 전파가 롯데 실적과 함께 읽는다'],
  ['도서산간시트ID', '1E9j6aLcc9WA6omx_9LosF4XblPuLv74RLXen8Fumaks', '도서산간 시/군 · 우편번호 원천'],
  ['도서산간_시군탭', '시,군', 'B열 = 시/군 이름'],
  ['도서산간_우편번호탭', '우편번호', 'A열 = 도서산간 우편번호'],
  ['동네배송시트ID', '1Y12Yh8hONbH3w-3FQ7Iu1u2TVTlSmWHHK3dU-wATNpo', '동네배송 내역 원천'],
  ['동네배송_탭', '동네배송내역', 'B=동네 C=일자 I=주소'],
  ['동네배송_사용', '중단', '중단 | 사용 — 중단이면 동네배송 분류를 통째로 건너뛰고 경고도 내지 않는다'],
  /* ★ 2026-09-10: 「실행전_마스터갱신」을 없앴다 ★
     9/9 에 기본값을 「재고만」→「전체」로 바꿨는데 소용이 없었다.
     아래 ssio_config 는 이미 있는 값을 안 건드리므로, 시트에 처음 적힌
     「재고만」이 그대로 이겼다. 판매현황 원천과 똑같은 함정이다.
     이제 ssm_refreshBeforeRun 이 늘 전부 읽는다 — 고를 것이 없다. */
  ['자사출고지접두', '평택', '이 접두로 시작하는 출고지는 자사 출고'],
  ['합배송출고지', '평택S-1', '합포장 대상 출고지'],
  ['합포장_최대건수', '0', '0 = 제한 없음(구 시트와 동일). 숫자를 넣으면 그 건수마다 박스를 나눈다'],
  ['위탁출고지', '대리발송', '재고 부족 시 협력업체로 넘기는 출고지명'],
  ['허용상태', '판매중,임박,특판', '이 상태만 출고. 나머지는 보류로 간다'],
  ['보내는주소', '경기도 평택시 포승읍 성해홍원로 91 팩투유', ''],
  ['대표전화', '031-923-7795', ''],
  ['비배송_품목패턴', '적립금|반품배송비|배송비|할인|쿠폰|수수료|차감', '품목명에 이 낱말이 있으면 송장을 안 낸다. 매출 집계에는 그대로 남는다'],
  ['재고부족_자동대리발송', '사용', '사용 = 재고 부족분을 바로 대리발송으로 / 안함 = 미발송에 세워 두고 사람이 업체코드로 토스'],
  ['도선료표_기준', '롯데', '도선료 표가 어느 택배사 기준인지. 로젠 표로 갈아 넣으면 「로젠」으로 바꾼다 — 그 전까지 회차마다 경고가 뜬다'],
  ['도서산간_미확인', '보류', '보류 | 일반출고 — 지역명만 걸리고 우편번호를 못 구한 건의 처리'],
  ['도서산간_판정', '우편번호우선', '우편번호우선 — 주소마다 우편번호를 한 번 구해 그것만으로 판정한다'],
  ['우편번호_최대조회', '300', '한 회차에 카카오로 새로 조회할 주소 수 상한'],
  ['고유ID_짧은날짜_전환일', '20260909', '이 날짜(YYYYMMDD) 주문부터 고유ID 날짜를 MMdd 로 줄인다. 이전 주문은 YYMMDD 유지'],
  ['전화주문_고유ID', '주문번호칸에채움', '주문번호칸에채움 | 원장만 — 주문번호 없는 건(전화주문)에 결정적 ID를 부여한다'],
  /* ★ 2026-09-10: 판매현황 원천 설정을 없앴다 ★
     여기서 뺐다고 이미 있는 줄이 사라지지는 않는다(아래 ssio_config 는
     있는 값을 안 건드린다). 그래서 9/9 에 기본값만 바꿨을 때 옛 ID 가
     그대로 이겨서 바깥 시트를 계속 읽었다. 이제 **코드가 아예 안 읽는다** —
     ssm_readSales 는 이 시트의 판매현황 탭만 본다.
     남아 있는 옛 줄은 「판매현황 원천 확인」 메뉴가 비워 준다. */
];

/**
 * 이제 안 쓰는 설정 키 — 값을 비우고 설명에 「안 씁니다」를 적는다.
 * ★ 2026-09-10
 *
 * 줄을 지우지는 않는다. 옛 값을 남겨 두면 "그 시트가 뭐였지"를 다시 찾을 수
 * 있고, 지운 자리에 다른 줄이 밀려 올라오는 사고도 없다.
 *
 * ★ 왜 이게 필요한가 ★
 *   ssio_config() 는 이미 있는 값을 안 건드린다 — 사람이 정한 값을 지키려는
 *   규칙이고, 그건 맞다. 그런데 그 때문에 «코드에서 없앤 설정»이 시트에
 *   살아남아 계속 이겼다. 두 번 당했다(판매현황 원천 · 마스터갱신).
 *   없앤 키는 여기 적어 두면 다음 실행 때 저절로 정리된다.
 */
var SSIO_DEAD_KEYS = {
  '판매현황_원천시트ID': '안 씁니다 — 판매현황은 이 시트의 「판매현황」 탭만 읽습니다 (2026-09-10)',
  '판매현황_원천탭':     '안 씁니다 — 판매현황은 이 시트의 「판매현황」 탭만 읽습니다 (2026-09-10)',
  '실행전_마스터갱신':   '안 씁니다 — 실행할 때마다 마스터를 전부 다시 읽습니다 (2026-09-10)',
  /*  드라이브 폴더는 고를 수 있었지만 «로컬 폴더»는 구글이 막는다.
      반쪽만 되는 설정은 헷갈리기만 한다 — 다운로드 버튼으로 고르는 편이 낫다. */
  '송장출력_폴더':       '안 씁니다 — 로컬 폴더는 고를 수 없어 걷어냈습니다. 결과창의 ⬇ 엑셀 다운로드를 쓰세요 (2026-09-14)'
};

/**
 * 설정 값 하나를 «시트에» 적는다.
 *
 * ★ 기본값을 고치는 것으로는 안 바뀐다 ★
 *   ssio_config 는 이미 있는 값을 건드리지 않는다 — 사람이 정한 것을
 *   코드가 덮으면 안 되기 때문이다. 그래서 «바꾸는 문»이 따로 필요하다.
 *   (2026-09-09 판매현황 원천에서 기본값만 바꿨다가 옛 값이 이겨
 *    엉뚱한 시트를 읽은 일이 있었다.)
 *
 * @return {boolean} 적었으면 true, 그 키가 없으면 false
 */
function ssio_setConfig(key, value) {
  var sh = ssio_sheet(SSIO_TABS.설정, SSIO_CONFIG_HEADER);
  var rows = ssio_body(SSIO_TABS.설정);
  for (var i = 0; i < rows.length; i++) {
    if (ssText(rows[i][0]) !== key) continue;
    sh.getRange(i + 2, 2).setValue(value);
    return true;
  }
  //  줄이 아예 없으면 새로 만든다 — 설정 탭을 손으로 지운 시트도 있다
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[key, value, '']]);
  return true;
}

function ssio_config() {
  var sh = ssio_sheet(SSIO_TABS.설정, SSIO_CONFIG_HEADER);
  if (sh.getLastRow() < 2) {
    sh.getRange(2, 1, SSIO_CONFIG_DEFAULTS.length, 3).setValues(SSIO_CONFIG_DEFAULTS);
    ssio_styleHeader(sh, 3);
    sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 380); sh.setColumnWidth(3, 420);
  }
  var cfg = {};
  var rows = ssio_body(SSIO_TABS.설정);
  for (var i = 0; i < rows.length; i++) {
    var k = ssText(rows[i][0]);
    if (k) cfg[k] = ssText(rows[i][1]);
  }

  // 새 설정 키가 생기면 뒤에 덧붙인다. 이미 있는 값은 건드리지 않는다.
  var add = [];
  for (var d = 0; d < SSIO_CONFIG_DEFAULTS.length; d++) {
    var key = SSIO_CONFIG_DEFAULTS[d][0];
    if (cfg[key] === undefined) {
      add.push(SSIO_CONFIG_DEFAULTS[d]);
      cfg[key] = SSIO_CONFIG_DEFAULTS[d][1];
    }
  }
  if (add.length) {
    sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  }

  /* 없앤 설정이 시트에 값을 들고 남아 있으면 치운다. 값이 있을 때만 쓰므로
     한 번 치우면 그다음부터는 아무 일도 안 한다. */
  for (var z = 0; z < rows.length; z++) {
    var dk = ssText(rows[z][0]);
    if (!SSIO_DEAD_KEYS[dk] || !ssText(rows[z][1])) continue;
    sh.getRange(z + 2, 2).setValue('');
    sh.getRange(z + 2, 3).setValue(SSIO_DEAD_KEYS[dk] + ' · 옛 값 ' + ssText(rows[z][1]));
    delete cfg[dk];
  }
  return cfg;
}

/* ── 진행 표시 ────────────────────────────────────────── */

function ssio_toast(msg, title) {
  try { ssio_ss().toast(msg, title || '세트분리 V2', 5); } catch (e) {}
}

/**
 * 누적 탭(원장·이력)의 헤더가 코드와 달라졌는지 확인하고 맞춘다.
 *
 * 열을 새로 추가하면 헤더 행은 그대로인데 새 행만 새 배치로 쌓인다.
 * 그러면 읽을 때 열이 어긋나 엉뚱한 값이 나온다 — 실제로 중복점검이 그렇게 망가졌다.
 * 옛 자료를 지우지 않고 다른 이름으로 옮긴 뒤 새로 시작한다.
 *
 * @return {string} 옮긴 탭 이름 (문제 없으면 '')
 */
function ssio_migrateHeader(name, headers) {
  var ss = ssio_ss();
  var sh = ss.getSheetByName(name);
  if (!sh) { ssio_sheet(name, headers); return ''; }

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return '';
  }

  var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var same = cur.length >= headers.length;
  if (same) {
    for (var i = 0; i < headers.length; i++) {
      if (ssText(cur[i]) !== headers[i]) { same = false; break; }
    }
  }
  if (same) return '';

  // 기존 헤더가 새 헤더의 앞부분이면 열이 뒤에 추가된 것뿐이다.
  // 자료를 옮길 필요 없이 헤더만 넓힌다. 옛 행의 새 열은 빈칸으로 남는다.
  var isPrefix = true;
  for (var p = 0; p < cur.length; p++) {
    var cv = ssText(cur[p]);
    if (!cv) continue;
    if (p >= headers.length || cv !== headers[p]) { isPrefix = false; break; }
  }
  if (isPrefix) {
    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return '';
  }

  if (sh.getLastRow() < 2) {           // 헤더만 있으면 그냥 덮어쓴다
    sh.clear();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    ssio_styleHeader(sh, headers.length);
    return '';
  }

  /* ★ 칸 수가 같으면 «이름만 바뀐 것»이다 — 자료를 두고 오지 않는다 ★
     (2026-09-11)

     실행이력 머리글에 택배사 이름이 박혀 있었다(…'롯데택배'…).
     오늘 롯데 → 로젠으로 바꾸자 머리글이 달라졌다고 보고 탭을 통째로
     «구버전»으로 밀어낸 뒤 빈 탭을 새로 만들었다. 그래서 오전 1차(10:05)가
     현재 실행이력에서 사라져 보였다 — 자료는 옛 탭에 있지만, 이어서 읽는
     코드는 옛 탭을 안 본다. 그게 더 나쁘다.

     칸 수가 그대로면 자리도 그대로다. 머리글 줄만 새로 쓰면 이어진다.
     칸 수가 «달라졌을 때»만 옛 탭으로 밀어낸다 — 그때는 자리가 어긋나
     위치로 옮기면 엉뚱한 칸에 값이 들어간다.

     ★ 칸 수만 보면 안 된다 ★
       전혀 다른 16칸 표도 「이름만 바뀐 것」으로 보게 된다. 몇 칸이나
       그대로인지도 함께 본다 — 이름 하나 둘 바꾼 것이면 나머지는 같다.
       절반도 안 같으면 다른 표로 보고 옛 탭으로 밀어낸다. */
  if (cur.length === headers.length) {
    var 같은칸 = 0;
    for (var q = 0; q < headers.length; q++) {
      if (ssText(cur[q]) === headers[q]) 같은칸++;
    }
    if (같은칸 * 2 > headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      ssio_styleHeader(sh, headers.length);
      return '';
    }
  }

  var old = name + '_구버전_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd-HHmm');
  sh.setName(old);
  var fresh = ss.insertSheet(name);
  fresh.getRange(1, 1, 1, headers.length).setValues([headers]);
  ssio_styleHeader(fresh, headers.length);
  return old;
}
