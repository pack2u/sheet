/**
 * ====================================================
 * [협력업체] 검색 발주 시스템  v1.0
 * 파일명: 4_협력업체_검색발주_복사용.gs
 *
 * ★ 대상: 발주 및 송장조회 탭을 사용하는 협력업체 (비전용양식 업체)
 * ★ 주요 기능:
 *   - 검색입력 탭 생성 (주문일자/품목명/수량/수취인/전화/주소/배송메시지)
 *   - 단가조회 탭 B열(품목명) 기반 드롭다운 자동 생성
 *   - 발주 제출 → 발주 및 송장조회 탭으로 자동 이동
 *   - 월별마감 이동 후 검색입력 탭 자동 초기화
 *
 * ★ 설치 방법:
 *   1. 협력업체 파일 → 확장 프로그램 → Apps Script
 *   2. 새 파일 추가 → 이 코드 전체 붙여넣기 → 저장
 *   3. 시트 새로고침 → 「📋 검색 발주」메뉴 확인
 *
 * ★ 주의: 이미 chatbot.gs 등 onOpen이 있다면 아래 안내 참고
 *   → 기존 파일의 onOpen 끝에 registerSearchOrderMenu_() 호출 추가
 * ====================================================
 */

// ─── 헤더 상수 ───────────────────────────────────────
var _SI_HEADERS = [
  '품목명', '수량', '수취인',
  '수취인전화번호', '수취인주소', '배송메시지'
]; // ★ 주문일자 제외 (발주 제출 시 today 자동 채움)

// ─── onOpen (단독 설치 시) ───────────────────────────
function onOpen_copy_paste() { // 복사하여 사용할 때는 onOpen()으로 변경하세요.
  registerSearchOrderMenu_();
}

/** 검색 발주 메뉴 등록 (다른 파일의 onOpen에서 호출 가능) */
function registerSearchOrderMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('📋 검색 발주')
    .addItem('① 검색입력 탭 초기화 (최초 1회)', 'initSearchInputTab')
    .addItem('② 품목 드롭다운 갱신 (단가조회 기준)', 'refreshSearchDropdown')
    .addSeparator()
    .addItem('③ 발주 제출 → 발주 및 송장조회', 'submitSearchOrders')
    .addToUi();
}

// ─── 탭 생성 ──────────────────────────────────────────
/** 검색입력 탭 생성/갱신 (최초 1회 실행) */
function initSearchInputTab() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName('검색입력') || ss.insertSheet('검색입력');

  // 헤더 (6열: 품목명, 수량, 수취인, 전화번호, 주소, 배송메시지)
  tab.getRange(1, 1, 1, _SI_HEADERS.length).setValues([_SI_HEADERS]);
  tab.getRange('1:1')
    .setBackground('#0f4c81')
    .setFontColor('white')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  tab.setFrozenRows(1);

  // 열 너비 (A=품목명, B=수량, C=수취인, D=전화번호, E=주소, F=배송메시지)
  tab.setColumnWidth(1, 220); // 품목명
  tab.setColumnWidth(2,  60); // 수량
  tab.setColumnWidth(3, 100); // 수취인
  tab.setColumnWidth(4, 120); // 전화번호
  tab.setColumnWidth(5, 280); // 주소
  tab.setColumnWidth(6, 160); // 배송메시지

  // ★ D열(수취인전화번호) 텍스트 형식 → 앞자리 0 보존
  tab.getRange('D2:D1000').setNumberFormat('@');

  // 드롭다운 적용 (단가조회 D열 기준)
  _applySearchDropdown_(ss, tab);

  SpreadsheetApp.getUi().alert(
    '✅ 검색입력 탭 준비 완료\n\n' +
    '② 품목 드롭다운 갱신을 실행하면\n단가조회 탭의 품목 목록을 불러옵니다.'
  );
}

// ─── 드롭다운 갱신 ────────────────────────────────────
/** B열 품목명 드롭다운 갱신 (단가조회 탭 B열 기준) */
function refreshSearchDropdown() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var siTab = ss.getSheetByName('검색입력');
  if (!siTab) {
    SpreadsheetApp.getUi().alert('검색입력 탭이 없습니다.\n① 초기화를 먼저 실행하세요.');
    return;
  }
  var cnt = _applySearchDropdown_(ss, siTab);
  if (cnt > 0) {
    SpreadsheetApp.getUi().alert('✅ 드롭다운 갱신 완료 (' + cnt + '개 품목 | 단가조회 기준)');
  }
}

/**
 * 단가조회 탭 B열(품목명) 읽어서 B2:B1000에 데이터 유효성 적용
 * @return {number} 적용된 품목 수 (0이면 실패)
 */
function _applySearchDropdown_(ss, siTab) {
  try {
    // 단가조회 탭 탐색 ("단가조회" 또는 "뷰어" 포함 탭)
    var viewerTab = _findViewerTab_(ss);
    if (!viewerTab || viewerTab.getLastRow() < 3) {
      SpreadsheetApp.getUi().alert(
        '단가조회 탭이 없거나 데이터가 없습니다.\n' +
        '(탭 이름에 "단가조회" 또는 "뷰어"가 포함되어야 합니다.)'
      );
      return 0;
    }
    var lr      = viewerTab.getLastRow();
    var rawData = viewerTab.getRange(3, 4, lr - 2, 1).getValues(); // D열(품목명) = col 4
    var seen = {}, uniq = [];
    rawData.forEach(function(r) {
      var nm = String(r[0] || '').trim();
      // ★ 빈 값, "-", 하이픈 필터링
      if (nm && nm !== '-' && nm !== '−' && !seen[nm]) {
        seen[nm] = true;
        uniq.push(nm);
      }
    });
    uniq.sort();
    if (uniq.length === 0) return 0;

    // ★ 500개 이하면 기존 방식
    if (uniq.length <= 500) {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(uniq, true)
        .setAllowInvalid(true)
        .build();
      siTab.getRange('A2:A1000').setDataValidation(rule);
    } else {
      // ★ 500개 초과: H열에 목록 기록 → 범위 참조 드롭다운
      var listCol = 8; // H열
      try { siTab.getRange(1, listCol, siTab.getMaxRows(), 1).clearContent(); } catch(e){}
      siTab.getRange(1, listCol).setValue('품목목록').setFontColor('#cccccc').setFontSize(8);
      var listData = uniq.map(function(nm) { return [nm]; });
      siTab.getRange(2, listCol, listData.length, 1).setValues(listData);
      try { siTab.hideColumns(listCol); } catch(e){}

      var rule2 = SpreadsheetApp.newDataValidation()
        .requireValueInRange(siTab.getRange(2, listCol, listData.length, 1), true)
        .setAllowInvalid(true)
        .build();
      siTab.getRange('A2:A1000').setDataValidation(rule2);
    }
    return uniq.length;
  } catch(e) {
    Logger.log('[검색발주] 드롭다운 오류: ' + e.message);
    return 0;
  }
}

// ─── 발주 제출 ────────────────────────────────────────
/** 검색입력 탭 → 발주 및 송장조회 탭으로 발주 이동 */
function submitSearchOrders() {
  var ui    = SpreadsheetApp.getUi();
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var siTab = ss.getSheetByName('검색입력');

  if (!siTab)                   { ui.alert('검색입력 탭이 없습니다.'); return; }
  if (siTab.getLastRow() < 2)   { ui.alert('입력된 발주 내용이 없습니다.'); return; }

  var orderTab = ss.getSheetByName('발주 및 송장조회');
  if (!orderTab) { ui.alert('발주 및 송장조회 탭이 없습니다.'); return; }

  // ① 품목명 → 이카운트코드 맵 (단가조회 D열=품목명, C열=이카운트코드)
  var codeMap = {};
  var viewerTab = _findViewerTab_(ss);
  if (viewerTab && viewerTab.getLastRow() >= 3) {
    var vlr   = viewerTab.getLastRow();
    var vData = viewerTab.getRange(3, 3, vlr - 2, 2).getValues(); // C=코드, D=품목명
    vData.forEach(function(r) {
      var ec = String(r[0] || '').trim(); // C열 이카운트코드
      var nm = String(r[1] || '').trim(); // D열 품목명
      if (nm && ec && !codeMap[nm]) codeMap[nm] = ec;
    });
  }
  // ② 폴백: 발주 및 송장조회 기존 이력 (C=이카운트코드, D=품목명)
  if (orderTab.getLastRow() >= 2) {
    var eData = orderTab.getRange(2, 3, orderTab.getLastRow() - 1, 2).getValues();
    eData.forEach(function(r) {
      var ec = String(r[0] || '').trim();
      var nm = String(r[1] || '').trim();
      if (nm && ec && !codeMap[nm]) codeMap[nm] = ec;
    });
  }

  // 거래처명: 스프레드시트 이름에서 추출
  var ssName = ss.getName()
    .replace(/\[협력업체\]/g, '')
    .replace(/협력업체/g, '')
    .trim();
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');

  var siData = siTab.getRange(2, 1, siTab.getLastRow() - 1, _SI_HEADERS.length).getValues();
  var rows = [], errNames = [];

  for (var ri = 0; ri < siData.length; ri++) {
    var row       = siData[ri];
    var itemName  = String(row[0] || '').trim(); // A열 = 품목명 (1열)
    var qty       = parseFloat(row[1]) || 0;    // B열 = 수량
    var recipient = String(row[2] || '').trim(); // C열 = 수취인
    if (!itemName || !qty || !recipient) continue;

    var ecCode = codeMap[itemName] || '';
    if (!ecCode) errNames.push(itemName);

    var uid = 'SI-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'MMddHHmmss') + '-' + (ri + 1);

    // 발주 및 송장조회 헤더:
    // A:거래처명 B:주문일자 C:이카운트코드 D:품목명 E:수량
    // F:수취인 G:전화 H:주소 I:배송메시지 J:적요 K:송장번호 L:정산금액 M:고유ID N:상태
    rows.push([
      ssName,                        // A 거래처명
      today,                         // B 주문일자 (자동)
      ecCode,                        // C 이카운트코드
      itemName,                      // D 품목명
      qty,                           // E 수량
      recipient,                     // F 수취인
      String(row[3] || '').trim(),   // G 전화번호 (D열)
      String(row[4] || '').trim(),   // H 주소 (E열)
      String(row[5] || '').trim(),   // I 배송메시지 (F열)
      '검색입력',                     // J 적요
      '',                            // K 송장번호
      '',                            // L 정산금액
      uid,                           // M 고유ID
      '접수완료'                      // N 상태
    ]);
  }

  if (rows.length === 0) {
    ui.alert('유효한 발주 행이 없습니다.\n(품목명 + 수량 + 수취인이 모두 있어야 합니다.)');
    return;
  }

  // ★ 중복 검사: 발주 및 송장조회에 오늘 날짜 + 동일 품목명 + 동일 수취인 이미 있으면 스킵
  var existDupSet = {};
  if (orderTab.getLastRow() >= 2) {
    // B=주문일자, D=품목명, F=수취인 (col 2,4,6)
    var existRows = orderTab.getRange(2, 2, orderTab.getLastRow() - 1, 5).getValues();
    existRows.forEach(function(er) {
      var key = String(er[0]||'').trim() + '|' + String(er[2]||'').trim() + '|' + String(er[4]||'').trim();
      if (key !== '||') existDupSet[key] = true;
    });
  }

  var dupSkipped = [];
  rows = rows.filter(function(r) {
    // r[1]=today(B), r[3]=itemName(D), r[5]=recipient(F)
    var key = String(r[1]||'').trim() + '|' + String(r[3]||'').trim() + '|' + String(r[5]||'').trim();
    if (existDupSet[key]) { dupSkipped.push(r[3]); return false; }
    return true;
  });

  if (rows.length === 0) {
    ui.alert('⚠️ 모두 중복 발주입니다.\n이미 오늘 동일 품목·수취인으로 발주된 건:\n' + dupSkipped.join('\n'));
    return;
  }

  // ★ B열(주문일자)은 수식 없는 순수 데이터 열 → 첫 번째 빈 셀 = 데이터 쓸 위치
  // (C열/getLastRow() 방식은 A1 ARRAYFORMULA ""로 오염되어 997행 등 이상 위치 발생)
  var bColData = orderTab.getRange(2, 2, orderTab.getMaxRows() - 1, 1).getValues();
  var nextRow = 2; // 최소 2행 (헤더 아래)
  for (var bi = 0; bi < bColData.length; bi++) {
    if (String(bColData[bi][0] || '').trim() === '') {
      nextRow = bi + 2; // bi는 0-indexed, B2부터 시작했으므로 +2
      break;
    }
  }

  // Pass 1: B~K (col 2~11) — today, ecCode, itemName, qty, recipient, phone, addr, msg, 적요, 송장번호
  var pass1 = rows.map(function(r) { return r.slice(1, 11); });
  orderTab.getRange(nextRow, 2, pass1.length, pass1[0].length).setValues(pass1);

  // Pass 2: M~N (col 13~14) — 고유ID, 상태 (L열 단가는 L1 수식이 자동 채움)
  var pass2 = rows.map(function(r) { return [r[12], r[13]]; });
  orderTab.getRange(nextRow, 13, pass2.length, 2).setValues(pass2);

  SpreadsheetApp.flush();

  var msg = '✅ ' + rows.length + '건을 「발주 및 송장조회」탭에 추가했습니다.';
  if (errNames.length > 0) {
    msg += '\n\n⚠️ 이카운트코드 미매칭 품목 (직접 입력 필요):\n' + errNames.join('\n');
  }
  ui.alert(msg);
}

// ─── 초기화 (월별마감 후 자동 호출용) ──────────────────
/** 검색입력 탭 데이터 행 초기화 */
function clearSearchInput() {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var tab = ss.getSheetByName('검색입력');
    if (tab && tab.getLastRow() >= 2) {
      tab.getRange(2, 1, tab.getLastRow() - 1, _SI_HEADERS.length).clearContent();
      Logger.log('[검색발주] 검색입력 탭 초기화 완료');
    }
  } catch(e) {}
}

// ─── 내부 헬퍼 ───────────────────────────────────────
/** 단가조회/뷰어 탭 탐색 */
function _findViewerTab_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName();
    if (n.indexOf('단가조회') !== -1 || n.indexOf('뷰어') !== -1) return sheets[i];
  }
  return null;
}
