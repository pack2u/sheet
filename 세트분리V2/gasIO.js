/**
 * gasIO.js — 시트 입출력 도우미
 * 이 파일과 gasMasters/gasMain 만 SpreadsheetApp 을 만진다. 계산은 전부 core.js.
 */

var SSIO_TABS = {
  입력: '판매현황',
  출력: ['롯데택배', '롯데택배-도서산간', '롯데택배-도서산간(위탁배송)', '롯데택배-동네배송', '대리발송'],
  합배송: '합배송',
  비배송: '비배송',
  사방넷송장: '사방넷송장',
  사방넷등록: '사방넷등록',
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
function ssio_write(name, headers, rows, style) {
  var sh = ssio_sheet(name, headers);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  ssio_clearBody(sh);
  if (rows && rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  ssio_styleHeader(sh, headers.length, style);
  return sh;
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
  ['롯데송장탭GID', '1575029201', '롯데 송장탭 GID (J열 주문번호 · G열 운송장번호)'],
  ['대량등록_대상일수', '1', '사방넷 대량등록에 포함할 날짜 범위. 1=오늘만, 2=어제까지, 전체=제한없음'],
  ['발주허브탭', '협력업체_발주허브', '상품정보 시트의 대리판매 발주허브 — C열 UID · N열 송장. 송장 전파가 함께 읽는다'],
  ['대리공급_임시기록탭', '대리공급_임시기록', '상품정보 시트의 대리공급 송장 기록. 송장 전파가 롯데 실적과 함께 읽는다'],
  ['도서산간시트ID', '1E9j6aLcc9WA6omx_9LosF4XblPuLv74RLXen8Fumaks', '도서산간 시/군 · 우편번호 원천'],
  ['도서산간_시군탭', '시,군', 'B열 = 시/군 이름'],
  ['도서산간_우편번호탭', '우편번호', 'A열 = 도서산간 우편번호'],
  ['동네배송시트ID', '1Y12Yh8hONbH3w-3FQ7Iu1u2TVTlSmWHHK3dU-wATNpo', '동네배송 내역 원천'],
  ['동네배송_탭', '동네배송내역', 'B=동네 C=일자 I=주소'],
  ['동네배송_사용', '중단', '중단 | 사용 — 중단이면 동네배송 분류를 통째로 건너뛰고 경고도 내지 않는다'],
  ['실행전_마스터갱신', '재고만', '재고만 | 재고+품목 | 전체 | 안함 — 재고는 하루에도 바뀌므로 실행 때마다 다시 읽는다'],
  ['자사출고지접두', '평택', '이 접두로 시작하는 출고지는 자사 출고'],
  ['합배송출고지', '평택S-1', '합포장 대상 출고지'],
  ['합포장_최대건수', '0', '0 = 제한 없음(구 시트와 동일). 숫자를 넣으면 그 건수마다 박스를 나눈다'],
  ['위탁출고지', '대리발송', '재고 부족 시 협력업체로 넘기는 출고지명'],
  ['허용상태', '판매중,임박,특판', '이 상태만 출고. 나머지는 보류로 간다'],
  ['보내는주소', '경기도 평택시 포승읍 성해홍원로 91 팩투유', ''],
  ['대표전화', '031-923-7795', ''],
  ['비배송_품목패턴', '적립금|반품배송비|배송비|할인|쿠폰|수수료|차감', '품목명에 이 낱말이 있으면 송장을 안 낸다. 매출 집계에는 그대로 남는다'],
  ['재고부족_자동대리발송', '사용', '사용 = 재고 부족분을 바로 대리발송으로 / 안함 = 미발송에 세워 두고 사람이 업체코드로 토스'],
  ['도서산간_미확인', '보류', '보류 | 일반출고 — 지역명만 걸리고 우편번호를 못 구한 건의 처리'],
  ['도서산간_판정', '우편번호우선', '우편번호우선 — 주소마다 우편번호를 한 번 구해 그것만으로 판정한다'],
  ['우편번호_최대조회', '300', '한 회차에 카카오로 새로 조회할 주소 수 상한'],
  ['전화주문_고유ID', '주문번호칸에채움', '주문번호칸에채움 | 원장만 — 주문번호 없는 건(전화주문)에 결정적 ID를 부여한다'],
  ['판매현황_원천시트ID', '1Ss1Bb5WEi7mMEUonW3hXqnJk8FT8X6LwoV0V3_yCb70', '판매현황(뉴) — 여기에 회차마다 붙여넣는다. 비우면 이 시트의 판매현황 탭을 쓴다'],
  ['판매현황_원천탭', '판매현황', '가져올 탭 이름 (없으면 첫 번째 탭을 쓴다)']
];

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

  var old = name + '_구버전_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd-HHmm');
  sh.setName(old);
  var fresh = ss.insertSheet(name);
  fresh.getRange(1, 1, 1, headers.length).setValues([headers]);
  ssio_styleHeader(fresh, headers.length);
  return old;
}
