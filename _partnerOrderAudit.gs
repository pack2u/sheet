/**
 * [Pack2U] 주문 검증 AI 시스템
 * 파일: _partnerOrderAudit.gs
 * ★ 2026-06-22: 신규 생성
 *
 * 기능:
 *   _oa_runFullAudit_()        — 전체 검증 실행 (메뉴/자동 트리거)
 *   _oa_runFullAuditOwner()    — 메뉴용 래퍼 (권한 체크)
 *   showOrderAuditSidebar()    — AI 사이드바 열기
 *   _oa_chatQuery_(msg)        — AI 챗봇 질문 처리
 *
 * 검증 항목 (10가지):
 *   1. 송장 미배정    2. 송장 중복    3. 주문번호 중복
 *   4. 단가 불일치    5. 수량 이상    6. 존재하지 않는 품목코드
 *   7. 취소/반품 미처리  8. 마감 누락  9. 도서산간 배송비 누락
 *  10. 상태 이상 (코드오류/품절 장기 방치)
 */

// ═══════════════════════════════════════════
//  상수 & 설정
// ═══════════════════════════════════════════

var _OA_AUDIT_TAB_NAME = '📋 주문검증';
var _OA_SEVERITY = { CRITICAL: '🔴긴급', WARNING: '🟡주의', INFO: '🟠경고' };

// 허브 컬럼 인덱스 (0-based, _PO_HUB_HEADERS 기준)
var _OA_HUB = {
  TIME: 0,      // 수집일시
  VENDOR: 1,    // 발주업체
  UID: 2,       // 고유ID
  DATE: 3,      // 주문일자
  CODE: 4,      // 이카운트코드
  ITEM: 5,      // 품목명
  QTY: 6,       // 수량
  RECV: 7,      // 수취인
  PHONE: 8,     // 수취인전화번호
  ADDR: 9,      // 수취인주소
  MSG: 10,      // 배송메시지
  PRICE: 11,    // 정산금액
  NOTE: 12,     // 적요
  INVOICE: 13,  // 송장번호
  STATUS: 14    // 상태
};

// ═══════════════════════════════════════════
//  메뉴 진입점
// ═══════════════════════════════════════════

function _oa_runFullAuditOwner() {
  var result = _oa_runFullAudit_();
  var ui = SpreadsheetApp.getUi();
  ui.alert('📊 주문 검증 완료',
    '✅ 정상: ' + result.okCount + '건\n' +
    '🔴 긴급: ' + result.critical + '건\n' +
    '🟡 주의: ' + result.warning + '건\n' +
    '🟠 경고: ' + result.info + '건\n\n' +
    '상세 결과: [📋 주문검증] 탭 확인',
    ui.ButtonSet.OK);
}

function showOrderAuditSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('orderAuditSidebar')
    .setTitle('🔍 주문 검증 AI')
    .setWidth(500);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ═══════════════════════════════════════════
//  전체 검증 실행
// ═══════════════════════════════════════════

function _oa_runFullAudit_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hubTab || hubTab.getLastRow() <= 1) {
    return { okCount: 0, critical: 0, warning: 0, info: 0, issues: [] };
  }

  // ── 허브 데이터 1회 로드 ──
  var hubLr = hubTab.getLastRow();
  var hubData = hubTab.getRange(2, 1, hubLr - 1, 15).getValues();

  // ── 상품정보 마스터 로드 (단가 검증용) ──
  var masterMap = _oa_loadMasterData_(ss);

  // ── 검증 실행 ──
  var allIssues = [];

  // 1. 송장 미배정
  allIssues = allIssues.concat(_oa_checkInvoiceMissing_(hubData));

  // 2. 송장 중복
  allIssues = allIssues.concat(_oa_checkInvoiceDuplicate_(hubData));

  // 3. 주문번호(고유ID) 중복
  allIssues = allIssues.concat(_oa_checkOrderDuplicate_(hubData));

  // 4. 단가 불일치
  allIssues = allIssues.concat(_oa_checkPriceMismatch_(hubData, masterMap));

  // 5. 수량 이상
  allIssues = allIssues.concat(_oa_checkQuantityAnomaly_(hubData));

  // 6. 존재하지 않는 품목코드
  allIssues = allIssues.concat(_oa_checkInvalidItemCode_(hubData, masterMap));

  // 7. 취소/반품 미처리
  allIssues = allIssues.concat(_oa_checkCancelReturnPending_(ss));

  // 8. 마감 누락 (3일 이상 미마감)
  allIssues = allIssues.concat(_oa_checkArchivePending_(hubData));

  // 9. 상태 이상 (코드오류/품절 장기 방치)
  allIssues = allIssues.concat(_oa_checkStatusAnomaly_(hubData));

  // 10. 도서산간 배송비 누락 (간단 체크)
  allIssues = allIssues.concat(_oa_checkIslandShipping_(hubData));

  // ── 결과 집계 ──
  var critical = 0, warning = 0, info = 0;
  for (var i = 0; i < allIssues.length; i++) {
    if (allIssues[i].severity === _OA_SEVERITY.CRITICAL) critical++;
    else if (allIssues[i].severity === _OA_SEVERITY.WARNING) warning++;
    else info++;
  }

  var result = {
    okCount: hubData.length - allIssues.length,
    critical: critical,
    warning: warning,
    info: info,
    issues: allIssues,
    totalOrders: hubData.length,
    timestamp: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')
  };

  // ── 검증 결과를 탭에 기록 ──
  _oa_writeToAuditSheet_(ss, result);

  return result;
}

// ═══════════════════════════════════════════
//  개별 검증 함수들
// ═══════════════════════════════════════════

/** 1. 송장 미배정: 접수완료/출고가능 상태인데 송장이 없는 건 (당일 데이터) */
function _oa_checkInvoiceMissing_(hubData) {
  var issues = [];
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  for (var i = 0; i < hubData.length; i++) {
    var status = String(hubData[i][_OA_HUB.STATUS] || '').trim();
    var invoice = String(hubData[i][_OA_HUB.INVOICE] || '').trim();
    var date = String(hubData[i][_OA_HUB.DATE] || '').replace(/[^0-9]/g, '').substring(0, 8);
    // 접수완료/출고가능 상태 + 송장 없음 + 당일 데이터
    if (!invoice && date === today &&
        (status === '접수완료' || status.indexOf('출고가능') !== -1)) {
      issues.push({
        severity: _OA_SEVERITY.CRITICAL,
        type: 'INVOICE_MISSING',
        row: i + 2,
        uid: String(hubData[i][_OA_HUB.UID] || ''),
        vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
        code: String(hubData[i][_OA_HUB.CODE] || ''),
        item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
        desc: '송장 미배정 (상태: ' + status + ')'
      });
    }
  }
  return issues;
}

/** 2. 송장 중복: 동일 송장번호가 2건 이상에 배정 */
function _oa_checkInvoiceDuplicate_(hubData) {
  var invoiceMap = {}; // { 송장번호: [행인덱스 배열] }
  for (var i = 0; i < hubData.length; i++) {
    var inv = String(hubData[i][_OA_HUB.INVOICE] || '').trim();
    if (!inv) continue;
    if (!invoiceMap[inv]) invoiceMap[inv] = [];
    invoiceMap[inv].push(i);
  }
  var issues = [];
  var keys = Object.keys(invoiceMap);
  for (var k = 0; k < keys.length; k++) {
    var indices = invoiceMap[keys[k]];
    if (indices.length > 1) {
      for (var j = 0; j < indices.length; j++) {
        var idx = indices[j];
        issues.push({
          severity: _OA_SEVERITY.CRITICAL,
          type: 'INVOICE_DUPLICATE',
          row: idx + 2,
          uid: String(hubData[idx][_OA_HUB.UID] || ''),
          vendor: String(hubData[idx][_OA_HUB.VENDOR] || ''),
          code: String(hubData[idx][_OA_HUB.CODE] || ''),
          item: String(hubData[idx][_OA_HUB.ITEM] || '').slice(0, 20),
          desc: '송장 중복 (' + keys[k] + ') — ' + indices.length + '건 동일 송장'
        });
      }
    }
  }
  return issues;
}

/** 3. 주문번호(고유ID) 중복 */
function _oa_checkOrderDuplicate_(hubData) {
  var uidMap = {};
  for (var i = 0; i < hubData.length; i++) {
    var uid = String(hubData[i][_OA_HUB.UID] || '').trim();
    if (!uid) continue;
    if (!uidMap[uid]) uidMap[uid] = [];
    uidMap[uid].push(i);
  }
  var issues = [];
  var keys = Object.keys(uidMap);
  for (var k = 0; k < keys.length; k++) {
    if (uidMap[keys[k]].length > 1) {
      var indices = uidMap[keys[k]];
      for (var j = 0; j < indices.length; j++) {
        var idx = indices[j];
        issues.push({
          severity: _OA_SEVERITY.WARNING,
          type: 'ORDER_DUPLICATE',
          row: idx + 2,
          uid: keys[k],
          vendor: String(hubData[idx][_OA_HUB.VENDOR] || ''),
          code: String(hubData[idx][_OA_HUB.CODE] || ''),
          item: String(hubData[idx][_OA_HUB.ITEM] || '').slice(0, 20),
          desc: '주문번호 중복 (' + keys[k] + ') — ' + indices.length + '건'
        });
      }
    }
  }
  return issues;
}

/** 4. 단가 불일치: 허브 정산금액 vs 마스터 단가 */
function _oa_checkPriceMismatch_(hubData, masterMap) {
  var issues = [];
  for (var i = 0; i < hubData.length; i++) {
    var code = String(hubData[i][_OA_HUB.CODE] || '').trim();
    var hubPrice = parseFloat(hubData[i][_OA_HUB.PRICE]) || 0;
    if (!code || !hubPrice || !masterMap[code]) continue;
    var masterPrice = parseFloat(masterMap[code].price) || 0;
    if (!masterPrice) continue;
    var diff = Math.abs(hubPrice - masterPrice);
    var diffPct = diff / masterPrice;
    // 20% 이상 차이나면 경고
    if (diffPct >= 0.20) {
      issues.push({
        severity: _OA_SEVERITY.WARNING,
        type: 'PRICE_MISMATCH',
        row: i + 2,
        uid: String(hubData[i][_OA_HUB.UID] || ''),
        vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
        code: code,
        item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
        desc: '단가 불일치: 허브 ' + hubPrice.toLocaleString() + '원 ≠ 마스터 ' +
              masterPrice.toLocaleString() + '원 (차이 ' + Math.round(diffPct * 100) + '%)'
      });
    }
  }
  return issues;
}

/** 5. 수량 이상: 0, 음수, 또는 비정상 대량 (>100) */
function _oa_checkQuantityAnomaly_(hubData) {
  var issues = [];
  for (var i = 0; i < hubData.length; i++) {
    var qty = parseFloat(hubData[i][_OA_HUB.QTY]);
    if (isNaN(qty) || qty <= 0) {
      issues.push({
        severity: _OA_SEVERITY.WARNING,
        type: 'QTY_ZERO',
        row: i + 2,
        uid: String(hubData[i][_OA_HUB.UID] || ''),
        vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
        code: String(hubData[i][_OA_HUB.CODE] || ''),
        item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
        desc: '수량 이상: ' + (isNaN(qty) ? '미입력' : qty)
      });
    } else if (qty > 100) {
      issues.push({
        severity: _OA_SEVERITY.INFO,
        type: 'QTY_HIGH',
        row: i + 2,
        uid: String(hubData[i][_OA_HUB.UID] || ''),
        vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
        code: String(hubData[i][_OA_HUB.CODE] || ''),
        item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
        desc: '대량 주문: ' + qty + '개 (확인 필요)'
      });
    }
  }
  return issues;
}

/** 6. 존재하지 않는 품목코드 */
function _oa_checkInvalidItemCode_(hubData, masterMap) {
  var issues = [];
  for (var i = 0; i < hubData.length; i++) {
    var code = String(hubData[i][_OA_HUB.CODE] || '').trim();
    var status = String(hubData[i][_OA_HUB.STATUS] || '').trim();
    if (!code) continue;
    // 이미 코드오류 상태인 건은 제외
    if (status.indexOf('코드오류') !== -1 || status.indexOf('코드확인') !== -1) continue;
    if (!masterMap[code]) {
      issues.push({
        severity: _OA_SEVERITY.WARNING,
        type: 'INVALID_CODE',
        row: i + 2,
        uid: String(hubData[i][_OA_HUB.UID] || ''),
        vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
        code: code,
        item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
        desc: '마스터에 없는 품목코드: ' + code
      });
    }
  }
  return issues;
}

/** 7. 취소/반품 미처리: 접수 후 3일 이상 미처리 */
function _oa_checkCancelReturnPending_(ss) {
  var issues = [];
  var crTab = ss.getSheetByName('취소/반품 접수');
  if (!crTab || crTab.getLastRow() <= 1) return issues;

  var crData = crTab.getRange(2, 1, crTab.getLastRow() - 1, crTab.getLastColumn()).getValues();
  var now = new Date();
  for (var i = 0; i < crData.length; i++) {
    var status = String(crData[i][crData[i].length - 1] || '').trim(); // 마지막 열 = 처리상태
    if (status && status.indexOf('완료') !== -1) continue;
    // 접수일 (첫 번째 열이 날짜인 경우)
    var regDate = crData[i][0];
    if (regDate instanceof Date) {
      var daysDiff = Math.floor((now - regDate) / (1000 * 60 * 60 * 24));
      if (daysDiff >= 3) {
        issues.push({
          severity: _OA_SEVERITY.CRITICAL,
          type: 'CANCEL_RETURN_PENDING',
          row: i + 2,
          uid: String(crData[i][1] || ''),
          vendor: '',
          code: String(crData[i][2] || ''),
          item: String(crData[i][3] || '').slice(0, 20),
          desc: '취소/반품 ' + daysDiff + '일 미처리'
        });
      }
    }
  }
  return issues;
}

/** 8. 마감 누락: 발주 후 3일 이상 접수완료 상태 유지 */
function _oa_checkArchivePending_(hubData) {
  var issues = [];
  var now = new Date();
  var todayNum = parseInt(Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMdd'));

  for (var i = 0; i < hubData.length; i++) {
    var status = String(hubData[i][_OA_HUB.STATUS] || '').trim();
    if (status !== '접수완료') continue;
    var dateStr = String(hubData[i][_OA_HUB.DATE] || '').replace(/[^0-9]/g, '').substring(0, 8);
    var dateNum = parseInt(dateStr);
    if (isNaN(dateNum) || dateNum <= 0) continue;
    var diff = todayNum - dateNum;
    if (diff >= 3) {
      issues.push({
        severity: _OA_SEVERITY.WARNING,
        type: 'ARCHIVE_PENDING',
        row: i + 2,
        uid: String(hubData[i][_OA_HUB.UID] || ''),
        vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
        code: String(hubData[i][_OA_HUB.CODE] || ''),
        item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
        desc: '발주 후 ' + diff + '일간 접수완료 상태 (마감 누락?)'
      });
    }
  }
  return issues;
}

/** 9. 상태 이상: 코드오류/품절 장기 방치 */
function _oa_checkStatusAnomaly_(hubData) {
  var issues = [];
  var todayNum = parseInt(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd'));

  for (var i = 0; i < hubData.length; i++) {
    var status = String(hubData[i][_OA_HUB.STATUS] || '').trim();
    var dateStr = String(hubData[i][_OA_HUB.DATE] || '').replace(/[^0-9]/g, '').substring(0, 8);
    var dateNum = parseInt(dateStr);
    var diff = isNaN(dateNum) ? 0 : todayNum - dateNum;

    // 코드오류 2일 이상 방치
    if (status.indexOf('코드오류') !== -1 && diff >= 2) {
      issues.push({
        severity: _OA_SEVERITY.INFO,
        type: 'STATUS_CODE_ERROR',
        row: i + 2,
        uid: String(hubData[i][_OA_HUB.UID] || ''),
        vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
        code: String(hubData[i][_OA_HUB.CODE] || ''),
        item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
        desc: '코드오류 상태 ' + diff + '일 방치'
      });
    }
    // 품절 3일 이상 방치
    if (status.indexOf('품절') !== -1 && status.indexOf('품절임박') === -1 && diff >= 3) {
      issues.push({
        severity: _OA_SEVERITY.INFO,
        type: 'STATUS_SOLD_OUT',
        row: i + 2,
        uid: String(hubData[i][_OA_HUB.UID] || ''),
        vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
        code: String(hubData[i][_OA_HUB.CODE] || ''),
        item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
        desc: '품절 상태 ' + diff + '일 방치 (취소 처리 필요?)'
      });
    }
  }
  return issues;
}

/** 10. 도서산간 배송비 누락 (간단 체크) */
function _oa_checkIslandShipping_(hubData) {
  var issues = [];
  var islandKeywords = ['제주', '울릉', '독도', '거문도', '흑산도', '백령도', '대청도', '소청도'];

  for (var i = 0; i < hubData.length; i++) {
    var addr = String(hubData[i][_OA_HUB.ADDR] || '').trim();
    if (!addr) continue;
    var isIsland = false;
    for (var k = 0; k < islandKeywords.length; k++) {
      if (addr.indexOf(islandKeywords[k]) !== -1) {
        isIsland = true;
        break;
      }
    }
    if (isIsland) {
      var note = String(hubData[i][_OA_HUB.NOTE] || '').trim();
      var msg = String(hubData[i][_OA_HUB.MSG] || '').trim();
      var hasShippingFee = (note + msg).indexOf('추가') !== -1 ||
                           (note + msg).indexOf('도서') !== -1 ||
                           (note + msg).indexOf('산간') !== -1;
      if (!hasShippingFee) {
        issues.push({
          severity: _OA_SEVERITY.INFO,
          type: 'ISLAND_SHIPPING',
          row: i + 2,
          uid: String(hubData[i][_OA_HUB.UID] || ''),
          vendor: String(hubData[i][_OA_HUB.VENDOR] || ''),
          code: String(hubData[i][_OA_HUB.CODE] || ''),
          item: String(hubData[i][_OA_HUB.ITEM] || '').slice(0, 20),
          desc: '도서산간 주소 (' + addr.slice(0, 15) + '...) — 추가배송비 확인 필요'
        });
      }
    }
  }
  return issues;
}

// ═══════════════════════════════════════════
//  헬퍼: 상품정보 마스터 데이터 로드
// ═══════════════════════════════════════════

function _oa_loadMasterData_(ss) {
  var masterMap = {};
  var masterTab = ss.getSheetByName('상품정보');
  if (!masterTab || masterTab.getLastRow() <= 5) return masterMap;

  // 상품정보 탭: 4행=헤더, 6행~=데이터
  var hdrs = masterTab.getRange(4, 1, 1, masterTab.getLastColumn()).getValues()[0];
  var codeCol = -1, nameCol = -1, priceCol = -1, statusCol = -1;
  for (var c = 0; c < hdrs.length; c++) {
    var h = String(hdrs[c] || '').replace(/\s/g, '');
    if (h.indexOf('이카운트코드') !== -1 || h.indexOf('품목코드') !== -1) codeCol = c;
    else if (h.indexOf('이카운트상품명') !== -1 || h.indexOf('품목명') !== -1) nameCol = c;
    else if (h.indexOf('개당판매가') !== -1 || h.indexOf('오프라인판매가') !== -1) { if (priceCol === -1) priceCol = c; }
    else if (h === '상태' || h === '판매상태') statusCol = c;
  }
  if (codeCol === -1) return masterMap;

  var lr = masterTab.getLastRow();
  if (lr < 6) return masterMap;
  var data = masterTab.getRange(6, 1, lr - 5, masterTab.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    var code = String(data[i][codeCol] || '').trim();
    if (!code) continue;
    masterMap[code] = {
      name: nameCol !== -1 ? String(data[i][nameCol] || '') : '',
      price: priceCol !== -1 ? data[i][priceCol] : 0,
      status: statusCol !== -1 ? String(data[i][statusCol] || '') : ''
    };
  }
  return masterMap;
}

// ═══════════════════════════════════════════
//  헬퍼: 전체 그룹 단가표에서 코드별 모든 그룹 가격 로드
//  ★ 2026-06-22: 소비자가 대신 실제 업체별 그룹 단가로 비교
// ═══════════════════════════════════════════

function _oa_loadGroupPrices_() {
  var map = {}; // { code: [price1, price2, ...] }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tab = ss.getSheetByName('전체 그룹 단가표');
    if (!tab || tab.getLastRow() <= 1) return map;

    var lastCol = tab.getLastColumn();
    var hdrs = tab.getRange(1, 1, 1, lastCol).getValues()[0];

    // 그룹 열 위치 식별 (G열=6부터 5열 간격, _pt_buildHubGroupColumnMap 동일 로직)
    var groupCols = [];
    for (var col = 6; col < hdrs.length; col += 5) {
      var g = String(hdrs[col] || '').trim();
      if (g) groupCols.push(col);
    }
    // 소비자가 열도 포함 (F열=5)
    groupCols.push(5);

    if (groupCols.length === 0) return map;

    // 코드 열(C열=2) 확인
    var lr = tab.getLastRow();
    if (lr <= 1) return map;
    var data = tab.getRange(2, 1, lr - 1, lastCol).getValues();

    for (var i = 0; i < data.length; i++) {
      var code = String(data[i][2] || '').trim(); // C열 = 이카운트코드
      if (!code) continue;
      var prices = [];
      for (var gi = 0; gi < groupCols.length; gi++) {
        var p = parseFloat(data[i][groupCols[gi]]) || 0;
        if (p > 0 && prices.indexOf(p) === -1) prices.push(p);
      }
      if (prices.length > 0) map[code] = prices;
    }
  } catch (e) {
    Logger.log('[OA] 그룹 단가표 로드 실패: ' + e.message);
  }
  return map;
}

// ═══════════════════════════════════════════
//  검증 결과 → 📋 주문검증 탭 기록
// ═══════════════════════════════════════════

function _oa_writeToAuditSheet_(ss, result) {
  var tab = ss.getSheetByName(_OA_AUDIT_TAB_NAME);
  if (!tab) {
    tab = ss.insertSheet(_OA_AUDIT_TAB_NAME);
    tab.getRange('A1:H1').setValues([['검증일시', '심각도', '유형', '행번호', '업체', '품목코드', '품목명', '상세']]);
    tab.getRange('1:1')
      .setBackground('#1a237e').setFontColor('white').setFontWeight('bold')
      .setHorizontalAlignment('center');
    tab.setFrozenRows(1);
    tab.setColumnWidth(1, 150);
    tab.setColumnWidth(2, 80);
    tab.setColumnWidth(3, 130);
    tab.setColumnWidth(8, 400);
  }
  // 기존 데이터 클리어
  if (tab.getLastRow() > 1) {
    tab.getRange(2, 1, tab.getLastRow() - 1, 8).clearContent();
  }

  if (result.issues.length === 0) {
    tab.getRange(2, 1, 1, 8).setValues([[result.timestamp, '✅', '이상 없음', '', '', '', '', '모든 검증 항목 통과 (' + result.totalOrders + '건 검증)']]);
    return;
  }

  var rows = [];
  for (var i = 0; i < result.issues.length; i++) {
    var iss = result.issues[i];
    rows.push([
      result.timestamp,
      iss.severity,
      iss.type,
      iss.row,
      iss.vendor,
      iss.code,
      iss.item,
      iss.desc
    ]);
  }
  if (rows.length > 0) {
    tab.getRange(2, 1, rows.length, 8).setValues(rows);
  }

  // ── 조건부 서식 적용 ──
  try {
    var rules = [];
    var range = tab.getRange('A2:H' + (rows.length + 1));
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🔴긴급').setBackground('#ffcdd2').setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🟡주의').setBackground('#fff9c4').setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🟠경고').setBackground('#ffe0b2').setRanges([range]).build());
    tab.setConditionalFormatRules(rules);
  } catch (e) {}
}

// ═══════════════════════════════════════════
//  AI 챗봇 (사이드바에서 호출)
// ═══════════════════════════════════════════

function _oa_chatQuery_(msg) {
  try {
    var intent = _oa_detectIntent_(msg);

    // 규칙 기반 핸들러
    if (intent === 'AUDIT_RUN') {
      var result = _oa_runFullAudit_();
      return JSON.stringify({
        type: 'AUDIT_RESULT',
        data: {
          timestamp: result.timestamp,
          total: result.totalOrders,
          ok: result.okCount,
          critical: result.critical,
          warning: result.warning,
          info: result.info,
          issues: result.issues.slice(0, 30) // 상위 30건만 전달
        }
      });
    }

    if (intent === 'SUMMARY') {
      return _oa_handleSummary_();
    }

    // AI 분석: Gemini에게 전달
    return _oa_callGemini_(msg);
  } catch (e) {
    return JSON.stringify({ type: 'TEXT', msg: '❌ 오류: ' + e.message });
  }
}

/** 의도 감지 */
function _oa_detectIntent_(text) {
  var t = text.replace(/\s/g, '');
  if (t.match(/검증실행|전체검증|오류찾아|오류확인|점검/)) return 'AUDIT_RUN';
  if (t.match(/현황|요약|통계|오늘|상태/)) return 'SUMMARY';
  return 'AI_GENERAL';
}

/** 현황 요약 핸들러 */
function _oa_handleSummary_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hubTab || hubTab.getLastRow() <= 1) {
    return JSON.stringify({ type: 'TEXT', msg: '허브에 데이터가 없습니다.' });
  }

  var hubLr = hubTab.getLastRow();
  var hubData = hubTab.getRange(2, 1, hubLr - 1, 15).getValues();
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');

  var total = hubData.length;
  var todayCount = 0;
  var statusCount = {};
  var vendorCount = {};
  var noInvoice = 0;

  for (var i = 0; i < hubData.length; i++) {
    var date = String(hubData[i][_OA_HUB.DATE] || '').replace(/[^0-9]/g, '').substring(0, 8);
    if (date === today) todayCount++;

    var st = String(hubData[i][_OA_HUB.STATUS] || '').trim();
    statusCount[st] = (statusCount[st] || 0) + 1;

    var vendor = String(hubData[i][_OA_HUB.VENDOR] || '').trim();
    if (vendor) vendorCount[vendor] = (vendorCount[vendor] || 0) + 1;

    var inv = String(hubData[i][_OA_HUB.INVOICE] || '').trim();
    if (!inv && (st === '접수완료' || st.indexOf('출고가능') !== -1)) noInvoice++;
  }

  var lines = [
    '📊 발주 허브 현황',
    '총 ' + total + '건 (오늘 ' + todayCount + '건)',
    '',
    '📌 상태별:',
  ];
  var stKeys = Object.keys(statusCount).sort(function(a, b) { return statusCount[b] - statusCount[a]; });
  for (var s = 0; s < stKeys.length; s++) {
    lines.push('  • ' + stKeys[s] + ': ' + statusCount[stKeys[s]] + '건');
  }
  if (noInvoice > 0) {
    lines.push('');
    lines.push('⚠️ 송장 미배정: ' + noInvoice + '건');
  }
  lines.push('');
  lines.push('🏢 업체별 (상위 10):');
  var vKeys = Object.keys(vendorCount).sort(function(a, b) { return vendorCount[b] - vendorCount[a]; });
  for (var v = 0; v < Math.min(vKeys.length, 10); v++) {
    lines.push('  • ' + vKeys[v] + ': ' + vendorCount[vKeys[v]] + '건');
  }

  return JSON.stringify({ type: 'TEXT', msg: lines.join('\n') });
}

/** Gemini AI 호출 */
function _oa_callGemini_(msg) {
  // 검증 결과 컨텍스트 구축
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var auditTab = ss.getSheetByName(_OA_AUDIT_TAB_NAME);
  var auditContext = '';
  if (auditTab && auditTab.getLastRow() > 1) {
    var auditData = auditTab.getRange(2, 1, Math.min(auditTab.getLastRow() - 1, 30), 8).getDisplayValues();
    auditContext = '\n=== 최근 검증 결과 (상위 ' + auditData.length + '건) ===\n';
    for (var i = 0; i < auditData.length; i++) {
      auditContext += (i + 1) + '. [' + auditData[i][1] + '] ' + auditData[i][2] + ' | ' +
                      auditData[i][4] + ' | ' + auditData[i][5] + ' | ' + auditData[i][7] + '\n';
    }
  }

  // 허브 현황 컨텍스트
  var summaryResp = _oa_handleSummary_();
  var summaryData = JSON.parse(summaryResp);
  var hubContext = summaryData.msg || '';

  var model = 'gemini-3.6-flash'; // ★ 2026-07-24 업그레이드
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
            ':generateContent?key=' + GEMINI_API_KEY;

  var prompt = '당신은 Pack2U 주문/발주 검증 전문 AI입니다.\n' +
    '주어진 데이터를 바탕으로 정확하고 구체적으로 답변하세요.\n' +
    '데이터에 없는 내용은 추측하지 마세요.\n\n' +
    '=== 현재 허브 현황 ===\n' + hubContext + '\n\n' +
    auditContext + '\n\n' +
    '────────────────────\n' +
    '사용자 질문: ' + msg;

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 }
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var json = JSON.parse(resp.getContentText());
  if (json.error) return JSON.stringify({ type: 'TEXT', msg: 'AI 오류: ' + json.error.message });

  var reply = json.candidates[0].content.parts[0].text;
  return JSON.stringify({ type: 'TEXT', msg: reply });
}

// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-08: 중복 발주 자동 감지
//  발주탭(대리판매) + 전용양식(대리공급) 모두 지원
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴 호출: 전체 업체 중복 발주 검사
 */
function partnerCheckDuplicateOrdersOwner() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  var allDups = [];
  var checkedCount = 0;

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var vendorName = files[fi].name.replace("[협력업체] ", "");

      // 1. 발주탭 중복 검사
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (orderTab && orderTab.getLastRow() >= 2) {
        var oLr = orderTab.getLastRow();
        var oData = orderTab.getRange(2, 1, oLr - 1, 14).getValues();
        var oDups = _oa_findDuplicates_(oData, "발주탭",
          { date: 1, recipient: 7, code: 2, product: 3, qty: 4, invoice: 13 });
        for (var oi = 0; oi < oDups.length; oi++) {
          oDups[oi].vendor = vendorName;
          allDups.push(oDups[oi]);
        }
        // ★ 중복 행 노란색 강조
        if (oDups.length > 0) {
          _oa_highlightDuplicateRows_(orderTab, oDups);
        }
      }

      // 2. 전용양식 중복 검사
      var tabs = ss.getSheets();
      for (var ti = 0; ti < tabs.length; ti++) {
        var tn = tabs[ti].getName();
        if (tn.indexOf("전용양식") === -1) continue;
        var eLr = tabs[ti].getLastRow();
        if (eLr < 2) continue;
        var eLc = tabs[ti].getLastColumn();
        var eHeaders = tabs[ti].getRange(1, 1, 1, eLc).getValues()[0];
        var eData = tabs[ti].getRange(2, 1, eLr - 1, eLc).getValues();

        // 헤더 기반 열 인덱스 매핑
        var eColMap = _oa_buildExclColMap_(eHeaders);
        if (eColMap.recipient < 0) continue;

        var eDups = _oa_findDuplicates_(eData, "전용양식", eColMap);
        for (var ei = 0; ei < eDups.length; ei++) {
          eDups[ei].vendor = vendorName;
          allDups.push(eDups[ei]);
        }
        if (eDups.length > 0) {
          _oa_highlightDuplicateRows_(tabs[ti], eDups);
        }
      }
      checkedCount++;
    } catch (e) {
      Logger.log("[DupCheck] " + files[fi].name + " 에러: " + e.message);
    }
  }

  // 결과 알림
  if (allDups.length === 0) {
    ui.alert("✅ 중복 감지 완료",
      "총 " + checkedCount + "개 업체 검사 → 중복 발주 없음",
      ui.ButtonSet.OK);
  } else {
    var msg = "⚠️ 중복 발주 " + allDups.length + "건 감지!\n" +
              "(해당 행에 노란색 강조 표시됨)\n\n";
    // 업체별 그룹
    var byVendor = {};
    for (var di = 0; di < allDups.length; di++) {
      var d = allDups[di];
      var key = d.vendor + " (" + d.tab + ")";
      if (!byVendor[key]) byVendor[key] = [];
      byVendor[key].push(d);
    }
    for (var vk in byVendor) {
      msg += "📦 " + vk + ":\n";
      var items = byVendor[vk];
      for (var ii = 0; ii < Math.min(items.length, 5); ii++) {
        msg += "  - " + items[ii].recipient + " | " + items[ii].product +
               " (행 " + items[ii].rows.join(",") + ")\n";
      }
      if (items.length > 5) msg += "  ... 외 " + (items.length - 5) + "건\n";
      msg += "\n";
    }
    ui.alert("⚠️ 중복 발주 감지", msg, ui.ButtonSet.OK);
  }
}

/**
 * 전용양식 헤더에서 열 인덱스 매핑
 */
function _oa_buildExclColMap_(headers) {
  var map = { date: -1, recipient: -1, code: -1, product: -1, qty: -1, invoice: 0 };
  var RECIP_KW = ["받는사람", "수취인", "수령인", "고객명"];
  var PROD_KW = ["상품명", "품목명", "품명", "품목코드", "코드"];
  var QTY_KW = ["수량"];
  var DATE_KW = ["날짜", "일자", "발주일"];

  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "");
    for (var rk = 0; rk < RECIP_KW.length; rk++) {
      if (h.indexOf(RECIP_KW[rk]) !== -1 && map.recipient < 0) map.recipient = i;
    }
    for (var pk = 0; pk < PROD_KW.length; pk++) {
      if (h.indexOf(PROD_KW[pk]) !== -1 && map.product < 0) map.product = i;
    }
    for (var qk = 0; qk < QTY_KW.length; qk++) {
      if (h.indexOf(QTY_KW[qk]) !== -1 && map.qty < 0) map.qty = i;
    }
    for (var dk = 0; dk < DATE_KW.length; dk++) {
      if (h.indexOf(DATE_KW[dk]) !== -1 && map.date < 0) map.date = i;
    }
  }
  return map;
}

/**
 * 데이터 배열에서 중복 발주 감지
 * @param {Array[]} data - 2D 데이터 (행 기준)
 * @param {string} tabLabel - "발주탭" 또는 "전용양식"
 * @param {Object} colMap - { date, recipient, code, product, qty, invoice }
 * @return {Array} 중복 목록 [{recipient, product, rows:[], tab}]
 */
function _oa_findDuplicates_(data, tabLabel, colMap) {
  var seen = {};   // key → { rows: [], recipient, product }
  var duplicates = [];

  for (var ri = 0; ri < data.length; ri++) {
    var row = data[ri];

    // 송장번호 있으면 이미 발송 완료 → 스킵
    if (colMap.invoice >= 0) {
      var inv = String(row[colMap.invoice] || "").trim();
      if (inv && inv.length > 5) continue;
    }

    // 수취인
    var recip = "";
    if (colMap.recipient >= 0) recip = String(row[colMap.recipient] || "").trim();
    if (!recip) continue;

    // 품목
    var prod = "";
    if (colMap.product >= 0) prod = String(row[colMap.product] || "").trim();
    if (colMap.code >= 0 && !prod) prod = String(row[colMap.code] || "").trim();

    // 수량 (같은 수취인+품목이지만 수량이 다르면 다른 주문일 수 있음 → 포함)
    var qty = colMap.qty >= 0 ? String(row[colMap.qty] || "").trim() : "";

    // 중복 키: 수취인 + 품목 (수량 제외 — 같은 사람이 같은 물건을 2번 주문하면 중복)
    var key = recip + "||" + prod;
    if (!seen[key]) {
      seen[key] = { rows: [ri + 2], recipient: recip, product: prod };
    } else {
      seen[key].rows.push(ri + 2);
    }
  }

  // 2건 이상인 것만 중복
  for (var sk in seen) {
    if (seen[sk].rows.length >= 2) {
      duplicates.push({
        recipient: seen[sk].recipient,
        product: seen[sk].product.length > 25 ? seen[sk].product.substring(0, 25) + "…" : seen[sk].product,
        rows: seen[sk].rows,
        tab: tabLabel
      });
    }
  }
  return duplicates;
}

/**
 * 중복 행에 노란색 배경 강조
 */
function _oa_highlightDuplicateRows_(sheet, dups) {
  try {
    var lc = Math.max(sheet.getLastColumn(), 1);
    for (var di = 0; di < dups.length; di++) {
      var rows = dups[di].rows;
      for (var ri = 0; ri < rows.length; ri++) {
        sheet.getRange(rows[ri], 1, 1, lc).setBackground("#FFF9C4"); // 연한 노란색
      }
    }
    SpreadsheetApp.flush();
  } catch (e) {}
}

/**
 * ★ 2026-07-08: 자동 중복 감지 (Push/발주수집 후 호출)
 * 에러 발생 시 메인 플로우에 영향 없이 조용히 로그만 남김
 * @param {string} mode - "발주탭" | "전용양식"
 */
function _oa_autoCheckDuplicates_(mode) {
  try {
    var files = _pt_listFiles();
    var allDups = [];

    for (var fi = 0; fi < files.length; fi++) {
      try {
        var ss = SpreadsheetApp.openById(files[fi].id);
        var vendorName = files[fi].name.replace("[협력업체] ", "");

        if (mode === "발주탭") {
          var orderTab = ss.getSheetByName("발주 및 송장조회");
          if (!orderTab || orderTab.getLastRow() < 2) continue;
          var oData = orderTab.getRange(2, 1, orderTab.getLastRow() - 1, 14).getValues();
          var oDups = _oa_findDuplicates_(oData, "발주탭",
            { date: 1, recipient: 7, code: 2, product: 3, qty: 4, invoice: 13 });
          for (var oi = 0; oi < oDups.length; oi++) {
            oDups[oi].vendor = vendorName;
            allDups.push(oDups[oi]);
          }
          if (oDups.length > 0) _oa_highlightDuplicateRows_(orderTab, oDups);

        } else if (mode === "전용양식") {
          var tabs = ss.getSheets();
          for (var ti = 0; ti < tabs.length; ti++) {
            if (tabs[ti].getName().indexOf("전용양식") === -1) continue;
            var eLr = tabs[ti].getLastRow();
            if (eLr < 2) continue;
            var eLc = tabs[ti].getLastColumn();
            var eHeaders = tabs[ti].getRange(1, 1, 1, eLc).getValues()[0];
            var eData = tabs[ti].getRange(2, 1, eLr - 1, eLc).getValues();
            var eColMap = _oa_buildExclColMap_(eHeaders);
            if (eColMap.recipient < 0) continue;
            var eDups = _oa_findDuplicates_(eData, "전용양식", eColMap);
            for (var ei = 0; ei < eDups.length; ei++) {
              eDups[ei].vendor = vendorName;
              allDups.push(eDups[ei]);
            }
            if (eDups.length > 0) _oa_highlightDuplicateRows_(tabs[ti], eDups);
          }
        }
      } catch (e) {
        Logger.log("[AutoDupCheck] " + files[fi].name + ": " + e.message);
      }
    }

    // 중복이 있으면 Google Chat + UI 알림
    if (allDups.length > 0) {
      var msg = "⚠️ 중복 발주 " + allDups.length + "건 감지!\n";
      var byVendor = {};
      for (var di = 0; di < allDups.length; di++) {
        var d = allDups[di];
        var key = d.vendor;
        if (!byVendor[key]) byVendor[key] = [];
        byVendor[key].push(d);
      }
      for (var vk in byVendor) {
        msg += "📦 " + vk + ": ";
        var items = byVendor[vk];
        var summaries = [];
        for (var ii = 0; ii < Math.min(items.length, 3); ii++) {
          summaries.push(items[ii].recipient + "|" + items[ii].product);
        }
        msg += summaries.join(", ");
        if (items.length > 3) msg += " 외 " + (items.length - 3) + "건";
        msg += "\n";
      }
      // Chat 알림
      try { _chat_sendText_(msg); } catch (e) {}
      // UI 알림 (사이드바가 아닌 경우)
      try {
        SpreadsheetApp.getUi().alert("⚠️ 중복 발주 감지",
          msg + "\n해당 행에 노란색 강조 표시됨",
          SpreadsheetApp.getUi().ButtonSet.OK);
      } catch (e) {}
      Logger.log("[AutoDupCheck] " + msg);
    } else {
      Logger.log("[AutoDupCheck] " + mode + " 중복 없음");
    }
  } catch (e) {
    // 메인 플로우에 영향 없도록 조용히 로그만
    Logger.log("[AutoDupCheck] 전체 에러: " + e.message);
  }
}
