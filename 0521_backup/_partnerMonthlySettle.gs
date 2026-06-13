/**
 * [협력업체] 발주 및 송장조회 → 월별 발주 마감 시스템  v4.2
 * 파일: _partnerMonthlySettle.gs
 *
 * ★ 핵심 흐름 ★
 *   각 협력업체 파일의 「발주 및 송장조회」탭을 스캔
 *   → 송장번호가 입력된 행만 이동
 *   → 같은 파일 내 「(YYYY년 M월) 발주 마감」탭으로 이동
 *   → 원본 행 삭제 (A열·L열 spill 수식 보호)
 *
 * ★ 올바른 워크플로우 ★
 *   ① 송장 수집 (partnerFetchInvoices)  ← 반드시 먼저 실행
 *   ② 월별 정산 이동 (이 함수)          ← 송장 수집 후 실행
 *   ※ 이동 후에는 추가 송장 수집이 발주마감 탭에 반영되지 않음
 *
 * ★ 취소·반품 체크박스 열 의미 ★
 *   발주마감 탭의 확장 열(취소 / 반품 / 취소반품사유 / 반품송장번호)은 이동 조건과 무관.
 *   → 배송 완료(송장 있음) 후 소비자 사유로 취소·반품이 발생했을 때
 *      해당 행을 체크 → 사유 입력 → 반품송장번호 기입
 *      체크된 행은 정산 합계에서 자동 제외됨.
 *   → 정산 시 합계 = 취소·반품 체크된 행을 뺀 실발송 건 기준
 *
 * ★ 보호 설정 ★
 *   헤더(1~4행)만 보호, 데이터 영역(5행~)은 편집 가능
 *
 * ⚠ 상품정보시트에 탭을 추가하지 않음
 */

// ── 탭 상수 (독립배포 ARCH_MONTH_* 와 동일)
var _PMS_HEADER_ROW    = 4;   // 헤더 행
var _PMS_DATA_START    = 5;   // 데이터 시작 행
var _PMS_KEY_CELL      = "AZ1";
var _PMS_KEY_PREFIX    = "PARTNER_ARCHIVE_MONTH:";
var _PMS_ORDER_TAB     = "발주 및 송장조회";  // ← 소스 탭 (전용양식 X)

/**
 * 날짜 셀 값을 받아 "yyyyMMdd" 형식의 8자리 문자열로 다드면서 리턴.
 * 모든 형식이 실패하면 null 리턴.
 * ★ 지원 형식:
 *   - Date 객체 → Utilities.formatDate
 *   - Google Sheets 날짜 시리얼(숫자, 40000~60000 범위) → Date 변환 후 포맷
 *   - "YYYYMMDD" 형식 문자열 → 직접 사용
 *   - 기타 문자열 → 숫자만 추출 후 YYYYMMDD 판별
 * ★ 유효성 검사:
 *   - 연도 2000~2099, 월 1~12 범위를 벗어나면 null
 */
function _pms_parseDateStr_(orderDate) {
  var dateStr = "";

  if (orderDate instanceof Date) {
    // Date 객체 → 정상 포맷
    dateStr = Utilities.formatDate(orderDate, "Asia/Seoul", "yyyyMMdd");

  } else if (typeof orderDate === "number") {
    // Google Sheets 날짜 시리얼 (38000~60000 범위) → Date 변환
    if (orderDate > 20000101 && orderDate <= 21001231) {
      // 이미 YYYYMMDD 숫자로 저장된 경우
      dateStr = String(Math.floor(orderDate));
    } else if (orderDate >= 38000 && orderDate <= 62000) {
      // 시리얼 당일 수 → JS Date (기준: 1900-01-01 = 1)
      var msPerDay = 86400000;
      var baseMs = new Date(1899, 11, 30).getTime(); // 1899-12-30
      var d = new Date(baseMs + orderDate * msPerDay);
      dateStr = Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd");
    } else {
      return null;
    }

  } else {
    // 문자열 전성: 숫자만 추출
    dateStr = String(orderDate).replace(/[^0-9]/g, "");
  }

  if (!dateStr || dateStr.length < 8) return null;
  dateStr = dateStr.substring(0, 8);

  var yyyy = parseInt(dateStr.substring(0, 4), 10);
  var mm   = parseInt(dateStr.substring(4, 6), 10);

  // 유효성 검사: 연도 2000~2099, 월 1~12
  if (yyyy < 2000 || yyyy > 2099) return null;
  if (mm < 1 || mm > 12) return null;

  return dateStr;
}


// ──────────────────────────────────────────────────────
//  공개 함수
// ──────────────────────────────────────────────────────

/** [수동] 발주 및 송장조회 완료건 → 같은 파일 내 월별 마감 탭으로 이동 */
function partnerArchiveToMonthlySettle() {
  var ui   = SpreadsheetApp.getUi();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    ui.alert("⚠ 다른 작업 진행 중. 잠시 후 다시 시도해주세요."); return;
  }
  try { _pms_core_(ui, false); }
  finally { lock.releaseLock(); }
}

/** [트리거용] 무음 실행 */
function partnerArchiveToMonthlySilent_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;
  try { _pms_core_(null, true); }
  catch(e) { try{Logger.log("[PMS_ERR] "+String(e.message||e));}catch(_){} }
  finally { lock.releaseLock(); }
}

/** [Dry-run] 이동 후보 미리보기 */
function partnerDiagnoseMonthlyArchive() {
  var ui    = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일 없음");

  var todayNum = parseInt(
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), 10);

  var total = 0;
  var lines = ["📋 발주 및 송장조회 → 월별 마감 이동 후보 (Dry-run)\n"];

  files.forEach(function(f) {
    try {
      var ss  = SpreadsheetApp.openById(f.id);
      var tab = ss.getSheetByName(_PMS_ORDER_TAB);
      if (!tab || tab.getLastRow() < 2) return;

      var scan = _pms_scanOrderTab_(tab, todayNum);
      if (!scan.candidates.length) return;

      lines.push("■ " + f.name + " (" + scan.candidates.length + "건)");
      var byM = {};
      scan.candidates.forEach(function(c){ byM[c.tabName]=(byM[c.tabName]||0)+1; });
      Object.keys(byM).sort().forEach(function(t){ lines.push("  · "+t+": "+byM[t]+"건"); });
      total += scan.candidates.length;
    } catch(e) {
      lines.push("■ " + f.name + ": 읽기 오류(" + e.message + ")");
    }
  });

  if (!total) lines.push("이동 후보 없음\n(조건: 오늘 이전 날짜 + 송장번호 있음/취소/품절/발송완료)");
  else lines.push("\n총 이동 예정: " + total + "건");

  ui.alert("월별 정산 진단", lines.join("\n"), ui.ButtonSet.OK);
}

// ──────────────────────────────────────────────────────
//  핵심 로직
// ──────────────────────────────────────────────────────
function _pms_core_(ui, silent) {
  var files = _pt_listFiles();
  if (!files || !files.length) {
    if (!silent && ui) ui.alert("협력업체 파일 없음"); return;
  }

  if (!silent && ui) {
    var cf = ui.alert("월별 정산 이동",
      "각 협력업체 파일의 「발주 및 송장조회」탭에서\n" +
      "송장번호가 입력된 행을 월별 마감 탭으로 이동합니다.\n\n" +
      "⚠ 송장 수집을 먼저 실행한 뒤 이 기능을 사용하세요.\n" +
      "계속할까요?",
      ui.ButtonSet.YES_NO);
    if (cf !== ui.Button.YES) return;
  }

  var todayStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  var todayNum = parseInt(todayStr, 10);

  var archived = 0, failed = 0, errMsgs = [];
  var _pms_archivedUids_ = {}; // ★ 이동된 행의 고유ID 세트 (허브 정리용)

  files.forEach(function(fileInfo) {
    try {
      var ss      = SpreadsheetApp.openById(fileInfo.id);
      var orderTab = ss.getSheetByName(_PMS_ORDER_TAB);
      if (!orderTab || orderTab.getLastRow() < 2) return;

      // 헤더 분석
      var lr  = orderTab.getLastRow();
      var lc  = orderTab.getMaxColumns();
      var all = orderTab.getRange(1, 1, lr, lc).getValues();
      var headers = all[0];
      var cMap = _pms_buildColMap_(headers);

      if (cMap.date === -1) return; // 주문일자 열 없으면 스킵

      // 확장 헤더 (원본 + 취소 + 반품 + 취소반품사유 + 반품송장번호)
      var extHeaders = _pms_buildExtHeaders_(headers, lc);
      var extLc      = extHeaders.length;
      var cancelC    = extLc - 3;  // 1-based: 취소
      var returnC    = extLc - 2;  // 1-based: 반품
      var reasonC    = extLc - 1;  // 1-based: 취소반품사유
      var retInvC    = extLc;      // 1-based: 반품송장번호

      var keepData            = [];
      var archiveDataByMonth  = {}; // tabName → [rowData, ...]

      for (var r = 1; r < all.length; r++) {
        var rowData = all[r];
        var orderDate = rowData[cMap.date];

        // 빈 행(주문일자 없음)은 유지
        if (!orderDate) { keepData.push(rowData); continue; }

        var dateStr = _pms_parseDateStr_(orderDate);
        if (!dateStr) { keepData.push(rowData); continue; }


        var dNum   = parseInt(dateStr.substring(0, 8), 10);
        var isPast = dNum < todayNum;

        if (!isPast) { keepData.push(rowData); continue; }

        // 완료 조건 판별
        // ★ 이동 조건: 송장번호가 입력된 행만 (상태값 무관)
        var invoiceVal = cMap.invoice !== -1
          ? String(rowData[cMap.invoice] || "").trim() : "";

        if (!invoiceVal) { keepData.push(rowData); continue; }

        // 월별 마감 탭명 결정
        var yyyy   = dateStr.substring(0, 4);
        var mm     = parseInt(dateStr.substring(4, 6), 10);

        var tabName = "(" + yyyy + "년 " + mm + "월) 발주 마감";

        if (!archiveDataByMonth[tabName]) archiveDataByMonth[tabName] = [];
        // ★ 발주마감 이동 시: 단가 × 수량 = 정산금액으로 변환
        var archiveRow = rowData.slice(0);
        if (cMap.price !== -1 && cMap.qty !== -1) {
          var unitPrice = Number(archiveRow[cMap.price]);
          var qty       = Number(archiveRow[cMap.qty]);
          if (!isNaN(unitPrice) && !isNaN(qty) && qty > 0) {
            archiveRow[cMap.price] = unitPrice * qty;
          }
        }
        // ★ 이동된 행의 고유ID 수집 (허브 정리용) — M열(index 12) = 고유ID
        var uidColIdx = 12; // 발주탭 기본 헤더: M열(0-based 12) = 고유ID
        for (var hsi = 0; hsi < headers.length; hsi++) {
          var hh = String(headers[hsi] || "").replace(/\s/g, "").toLowerCase();
          if (hh.indexOf("고유id") !== -1 || hh.indexOf("uniqueid") !== -1) {
            uidColIdx = hsi; break;
          }
        }
        var archivedUid = String(rowData[uidColIdx] || "").trim();
        if (archivedUid) _pms_archivedUids_[archivedUid] = true;
        archiveDataByMonth[tabName].push(archiveRow);
      }

      var hasArchived = false;

      // 월별 마감 탭으로 이동
      for (var tabName in archiveDataByMonth) {
        var arr = archiveDataByMonth[tabName];
        if (!arr.length) continue;

        hasArchived = true;
        var monthKey = _PMS_KEY_PREFIX + tabName;

        // 탭 취득 or 생성
        var archTab = ss.getSheetByName(tabName);
        if (!archTab) {
          // 키 셀로 탐색
          var byKey = _pms_findTabByKey_(ss, monthKey);
          if (byKey) {
            archTab = byKey;
          } else {
            archTab = ss.insertSheet(tabName);
          }
        }

        var isNewBlank = archTab.getLastRow() < 1;

        // 레이아웃 적용 (헤더 + 요약수식 + 보호)
        _pms_layoutArchiveTab_(archTab, extHeaders, cMap, extLc, cancelC, returnC, reasonC, retInvC, isNewBlank);
        _pms_setKey_(archTab, monthKey);

        // 기존 행 체크박스 보정
        _pms_ensureCheckboxes_(archTab, cancelC, returnC);

        // 데이터 추가
        var padded = arr.map(function(row) {
          return _pms_padRow_(row, extLc, lc);
        });
        var nextRow = archTab.getLastRow() + 1;
        if (nextRow < _PMS_DATA_START) nextRow = _PMS_DATA_START;

        archTab.getRange(nextRow, 1, padded.length, extLc)
          .setValues(padded)
          .setVerticalAlignment("middle");

        // 취소·반품 체크박스 (2열만)
        archTab.getRange(nextRow, cancelC, padded.length, 2)
          .clearDataValidations();
        archTab.getRange(nextRow, cancelC, padded.length, 2)
          .setValue(false);
        archTab.getRange(nextRow, cancelC, padded.length, 2)
          .insertCheckboxes();

        _pms_applyProtection_(archTab);
        archived += padded.length;
      }

      if (hasArchived) {
        SpreadsheetApp.flush();

        // 발주탭 원본 행 삭제 — A열·L열은 spill 수식이므로 clearContent 후 B~K, M~ 복원
        orderTab.getRange(2, 1, orderTab.getMaxRows() - 1, lc).clearContent();

        if (keepData.length > 0) {
          // B~K열 (인덱스 1~10, 10열)
          var bkCount = Math.min(10, lc - 1);
          if (bkCount > 0) {
            var bkData = keepData.map(function(r){ return r.slice(1, 1 + bkCount); });
            orderTab.getRange(2, 2, keepData.length, bkCount).setValues(bkData);
          }
          // M열 이후 (인덱스 12~, 고유ID·비고 등)
          if (lc >= 13) {
            var tailW = lc - 12;
            var tailData = keepData.map(function(r) {
              var t = r.slice(12, 12 + tailW);
              while (t.length < tailW) t.push("");
              return t;
            });
            orderTab.getRange(2, 13, keepData.length, tailW).setValues(tailData);
          }
        }
        SpreadsheetApp.flush();
        // ★ A열·L열 spill 수식 heal (clearContent로 파괴된 경우 자동 복구)
        try {
          var _viewerTab_ = _pt_findViewerSheet(ss);
          var _viewerName_ = _viewerTab_ ? _viewerTab_.getName() : "단가조회";
          _pt_healOrderSpillFormulas(orderTab, _viewerName_);
        } catch(_eH) {}
        // ★ 검색입력 탭 초기화 (월별마감 이동 완료 시)
        try { _pt_clearSearchInputTab_(ss); } catch(_e) {}
      }

    } catch(e) {
      errMsgs.push("[" + fileInfo.name + "] " + e.message);
      failed++;
    }
  });

  // ── 협력업체_발주허브 탭에서 이동된 행 삭제 ──
  if (archived > 0 && Object.keys(_pms_archivedUids_).length > 0) {
    try {
      var hubSS  = SpreadsheetApp.getActiveSpreadsheet();
      var hubTab = hubSS.getSheetByName("협력업체_발주허브"); // _PO_HUB_SHEET_NAME 직접 기입
      if (hubTab && hubTab.getLastRow() >= 2) {
        var hubLr      = hubTab.getLastRow();
        var hubLc      = hubTab.getLastColumn();
        var HUB_UID_COL = 3;  // C열(1-based): 고유ID
        var hubData    = hubTab.getRange(2, 1, hubLr - 1, hubLc).getValues();
        // 삭제 대신 데이터 덮어쓰기 방식으로 속도 개선
        var keepHubData = [];
        for (var hr = 0; hr < hubData.length; hr++) {
          var hubUid = String(hubData[hr][HUB_UID_COL - 1] || "").trim();
          if (!(hubUid && _pms_archivedUids_[hubUid])) {
            keepHubData.push(hubData[hr]);
          }
        }
        
        hubTab.getRange(2, 1, hubLr - 1, hubLc).clearContent();
        if (keepHubData.length > 0) {
          hubTab.getRange(2, 1, keepHubData.length, hubLc).setValues(keepHubData);
        }
        SpreadsheetApp.flush();
      }
    } catch (eHub) {
      errMsgs.push("[허브 정리] " + eHub.message);
    }
  }

  var msg = "✅ 월별 정산 이동 완료\n이동: " + archived + "건"
    + (failed > 0 ? "\n⚠ 파일 오류 " + failed + "건:\n" + errMsgs.slice(0,5).join("\n") : "");
  Logger.log("[PMS] " + msg.replace(/\n/g," | "));
  if (!silent && ui) ui.alert(msg);
}

// ──────────────────────────────────────────────────────
//  스캔 헬퍼 (Dry-run용)
// ──────────────────────────────────────────────────────
function _pms_scanOrderTab_(tab, todayNum) {
  var candidates = [];
  var lr  = tab.getLastRow();
  if (lr < 2) return { candidates: candidates };

  var lc  = tab.getMaxColumns();
  var all = tab.getRange(1, 1, lr, lc).getValues();
  var cMap = _pms_buildColMap_(all[0]);
  if (cMap.date === -1) return { candidates: candidates };

  for (var r = 1; r < all.length; r++) {
    var rowData   = all[r];
    var orderDate = rowData[cMap.date];
    if (!orderDate) continue;

    var dateStr = _pms_parseDateStr_(orderDate);
    if (!dateStr) continue;

    var dNum = parseInt(dateStr.substring(0, 8), 10);

    if (dNum >= todayNum) continue;

    // ★ 이동 조건: 송장번호 입력된 행만
    var invoiceVal = cMap.invoice !== -1 ? String(rowData[cMap.invoice]||"" ).trim() : "";
    if (!invoiceVal) continue;

    var yyyy = dateStr.substring(0, 4);
    var mm   = parseInt(dateStr.substring(4, 6), 10);
    candidates.push({ tabName: "(" + yyyy + "년 " + mm + "월) 발주 마감", rowIndex: r });
  }
  return { candidates: candidates };
}

// ──────────────────────────────────────────────────────
//  열 매핑 (발주 및 송장조회 헤더 분석)
// ──────────────────────────────────────────────────────
function _pms_buildColMap_(headers) {
  var m = { date: -1, invoice: -1, status: -1, qty: -1, price: -1 };
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]||"").replace(/\s/g,"").toLowerCase();
    if (m.date === -1 && (
      h.indexOf("주문일자") !== -1 ||
      h.indexOf("yyyymmdd") !== -1 ||
      h === "일자"
    )) { m.date = i; }
    else if (m.invoice === -1 && (
      h.indexOf("송장번호") !== -1 ||
      h.indexOf("운송장") !== -1
    )) { m.invoice = i; }
    else if (m.status === -1 && (
      h.indexOf("상태") !== -1 ||
      h.indexOf("적요") !== -1
    )) { m.status = i; }
    else if (m.qty === -1 && (
      h === "수량" ||
      h.indexOf("박스수량") !== -1 ||
      h.indexOf("판매수량") !== -1
    )) { m.qty = i; }
    else if (m.price === -1 && (
      h === "단가" ||
      h.indexOf("정산금액") !== -1 ||
      h.indexOf("정산단가") !== -1 ||
      h.indexOf("확정단가") !== -1
    )) { m.price = i; }
  }
  return m;
}

// ──────────────────────────────────────────────────────
//  확장 헤더 구성 (원본 + 취소 + 반품 + 취소반품사유 + 반품송장번호)
// ──────────────────────────────────────────────────────
function _pms_buildExtHeaders_(headers, lc) {
  var base = [];
  for (var i = 0; i < lc; i++) base.push(i < headers.length ? headers[i] : "");
  // 기존 취소·반품 열이 있으면 제거 후 재구성 (일관성 보장)
  while (base.length > 0) {
    var tail = String(base[base.length-1]||"").trim();
    if (tail === "취소" || tail === "반품" || tail === "취소반품사유" || tail === "반품송장번호") {
      base.pop();
    } else {
      break;
    }
  }
  base.push("취소");
  base.push("반품");
  base.push("취소반품사유");
  base.push("반품송장번호");
  return base;
}

// ──────────────────────────────────────────────────────
//  행 길이 맞춤 (취소=false, 반품=false, 사유="", 반품송장="")
// ──────────────────────────────────────────────────────
function _pms_padRow_(row, extLc, origLc) {
  var padded = [];
  for (var i = 0; i < extLc; i++) {
    if (i < origLc && i < row.length) {
      padded.push(row[i]);
    } else if (i === extLc - 4 || i === extLc - 3) {
      padded.push(false); // 취소/반품 = false
    } else {
      padded.push(""); // 취소반품사유, 반품송장번호 = 빈 문자열
    }
  }
  return padded;
}

// ──────────────────────────────────────────────────────
//  월별 마감 탭 레이아웃 적용
// ──────────────────────────────────────────────────────
function _pms_layoutArchiveTab_(tab, extHeaders, cMap, extLc, cancelC, returnC, reasonC, retInvC, isNewBlank) {
  // 1행: 요약 마커
  try {
    tab.getRange(1, 1, 1, 6).merge()
      .setValue("📊 월별 마감 요약")
      .setBackground("#444444").setFontColor("white")
      .setFontWeight("bold").setHorizontalAlignment("center");
  } catch(e) {}

  // 2~3행: 합계 수식
  _pms_applyFormulas_(tab, cMap, cancelC, returnC);

  // 4행: 헤더
  if (tab.getMaxColumns() < extLc) {
    tab.insertColumnsAfter(tab.getMaxColumns(), extLc - tab.getMaxColumns());
  }
  tab.getRange(_PMS_HEADER_ROW, 1, 1, extLc).setValues([extHeaders])
    .setBackground("#555555").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center");
  // 취소·반품 체크박스 헤더 강조 (빨간)
  tab.getRange(_PMS_HEADER_ROW, cancelC).setBackground("#c0392b").setFontColor("white");
  tab.getRange(_PMS_HEADER_ROW, returnC).setBackground("#c0392b").setFontColor("white");
  // 사유·반품송장 헤더 강조 (주황)
  tab.getRange(_PMS_HEADER_ROW, reasonC).setBackground("#e67e22").setFontColor("white");
  tab.getRange(_PMS_HEADER_ROW, retInvC).setBackground("#e67e22").setFontColor("white");
  // 사유·반품송장 열 너비
  try {
    tab.setColumnWidth(reasonC, 200);
    tab.setColumnWidth(retInvC, 150);
  } catch(e) {}
  tab.setFrozenRows(_PMS_HEADER_ROW);
}

// ──────────────────────────────────────────────────────
//  요약 수식 (2~3행): 건수 + 정산금액 합계, 취소·반품 제외
// ──────────────────────────────────────────────────────
function _pms_applyFormulas_(tab, cMap, cancelC, returnC) {
  function L(n) {
    var s = "", c = n;
    while (c > 0) { var m = (c-1)%26; s = String.fromCharCode(65+m)+s; c = Math.floor((c-1)/26); }
    return s;
  }
  var dr    = String(_PMS_DATA_START);
  var cO    = L(cancelC) + dr + ":" + L(cancelC);
  var rO    = L(returnC) + dr + ":" + L(returnC);
  var dO    = cMap.date !== -1 ? L(cMap.date+1) + dr + ":" + L(cMap.date+1) : "";

  var cntAll, cntNet;
  if (dO) {
    cntAll = '=IFERROR(COUNTIF(' + dO + ',">0"),0)';
    cntNet = "=IFERROR(SUMPRODUCT((" + dO + '>0)*(' + cO + "<>TRUE)*(" + rO + "<>TRUE)),0)";
  } else {
    cntAll = '=IFERROR(COUNTA(A' + dr + ':A),0)';
    cntNet = "=IFERROR(SUMPRODUCT((A" + dr + ':A<>"")*(' + cO + "<>TRUE)*(" + rO + "<>TRUE)),0)";
  }

  // 2행: 전체 건수 + 정산금액 합계 (참고용)
  tab.getRange(2,1).setValue("전체 건수");
  tab.getRange(2,2).setFormula(cntAll).setNumberFormat("#,##0");

  // 3행: 취소·반품 제외 건수 + 정산금액 합계 (실결제 기준)
  tab.getRange(3,1).setValue("취소·반품 제외 건수");
  tab.getRange(3,2).setFormula(cntNet).setNumberFormat("#,##0");

  // 정산금액 합계 (price 열이 감지된 경우)
  if (cMap.price !== -1) {
    var pO = L(cMap.price+1) + dr + ":" + L(cMap.price+1);
    // 전체 합계
    var sumAll = dO
      ? '=IFERROR(SUMIF(' + dO + ',">0",' + pO + '),0)'
      : '=IFERROR(SUM(' + pO + '),0)';
    // 취소·반품 제외 합계
    var sumNet = dO
      ? "=IFERROR(SUMPRODUCT((" + dO + ">0)*(" + cO + "<>TRUE)*(" + rO + "<>TRUE)*(" + pO + ")),0)"
      : "=IFERROR(SUMPRODUCT((" + pO + '<>"")*(' + cO + "<>TRUE)*(" + rO + "<>TRUE)*(" + pO + ")),0)";
    tab.getRange(2,3).setValue("정산금액 합계");
    tab.getRange(2,4).setFormula(sumAll).setNumberFormat("#,##0");
    tab.getRange(3,3).setValue("정산금액 합계 (취소반품 제외)");
    tab.getRange(3,4).setFormula(sumNet).setNumberFormat("#,##0");
    tab.getRange(2,1,2,4).setBackground("#f5f5f5").setBorder(true,true,true,true,true,true);
  } else {
    tab.getRange(2,1,2,2).setBackground("#f5f5f5").setBorder(true,true,true,true,true,true);
  }
}

// ──────────────────────────────────────────────────────
//  보호 설정: 헤더(1~4행)만 보호, 데이터 영역(5행~)은 전체 편집 가능
// ──────────────────────────────────────────────────────
function _pms_applyProtection_(tab) {
  // 기존 보호 전부 제거
  try {
    var ps = tab.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var i = 0; i < ps.length; i++) ps[i].remove();
    var pr = tab.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    for (var j = 0; j < pr.length; j++) pr[j].remove();
  } catch(e) {}
  // 헤더 영역(1~4행)만 보호
  try {
    var maxC = Math.max(tab.getMaxColumns(), 1);
    var p = tab.getRange(1, 1, _PMS_HEADER_ROW, maxC).protect()
      .setDescription("월별 마감 헤더 보호 (데이터 편집 가능)");
    p.setWarningOnly(true);
  } catch(e) {}
}

// ──────────────────────────────────────────────────────
//  기존 데이터 행 체크박스 보정
// ──────────────────────────────────────────────────────
function _pms_ensureCheckboxes_(tab, cancelC, returnC) {
  var lr = tab.getLastRow();
  if (lr < _PMS_DATA_START) return;
  var rowCount = lr - _PMS_DATA_START + 1;
  var dv = tab.getRange(_PMS_DATA_START, cancelC, rowCount, 2).getDataValidations();
  for (var i = 0; i < dv.length; i++) {
    var need = false;
    for (var j = 0; j < dv[i].length; j++) {
      if (!dv[i][j]) { need = true; break; }
      try {
        if (dv[i][j].getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.CHECKBOX) {
          need = true; break;
        }
      } catch(e) { need = true; break; }
    }
    if (need) {
      var row = _PMS_DATA_START + i;
      tab.getRange(row, cancelC, 1, 2).clearDataValidations();
      tab.getRange(row, cancelC, 1, 2).setValue(false);
      tab.getRange(row, cancelC, 1, 2).insertCheckboxes();
    }
  }
}

// ──────────────────────────────────────────────────────
//  유틸
// ──────────────────────────────────────────────────────
function _pms_setKey_(tab, key) {
  try { tab.getRange(_PMS_KEY_CELL).setValue(key).setFontColor("white"); } catch(e) {}
}
function _pms_findTabByKey_(ss, key) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    try {
      if (String(sheets[i].getRange(_PMS_KEY_CELL).getValue()||"").trim() === key)
        return sheets[i];
    } catch(e) {}
  }
  return null;
}

// ──────────────────────────────────────────────────────
//  월별 마감 탭 레이아웃 보정 (AS 메뉴용)
// ──────────────────────────────────────────────────────
function partnerRepairMonthlySettleTabs() {
  var ui = SpreadsheetApp.getUi();
  var go = ui.alert(
    "🔧 월별 마감 탭 레이아웃 보정",
    "모든 협력업체 파일의 '(YYYY년 M월) 발주 마감' 탭을 찾아\n" +
    "요약·헤더·취소반품열·보호를 최신 형식으로 재적용합니다.\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (go !== ui.Button.YES) return;

  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일 없음");

  var fixed = 0, errs = [];
  var tabPattern = /^\((\d{4})년 (\d{1,2})월\) 발주 마감$/;

  files.forEach(function(fileInfo) {
    try {
      var ss       = SpreadsheetApp.openById(fileInfo.id);
      var orderTab = ss.getSheetByName(_PMS_ORDER_TAB);
      if (!orderTab) return;

      var lc0     = orderTab.getMaxColumns();
      var headers = orderTab.getRange(1, 1, 1, lc0).getValues()[0];
      var cMap    = _pms_buildColMap_(headers);
      var extHdr  = _pms_buildExtHeaders_(headers, lc0);
      var extLc   = extHdr.length;
      var cancelC = extLc - 3;
      var returnC = extLc - 2;
      var reasonC = extLc - 1;
      var retInvC = extLc;

      ss.getSheets().forEach(function(sh) {
        if (!String(sh.getName()).match(tabPattern)) return;

        _pms_layoutArchiveTab_(sh, extHdr, cMap, extLc, cancelC, returnC, reasonC, retInvC, false);
        _pms_ensureCheckboxes_(sh, cancelC, returnC);
        _pms_applyProtection_(sh);
        fixed++;
        SpreadsheetApp.flush();
      });
    } catch(e) {
      errs.push("[" + fileInfo.name + "] " + e.message);
    }
  });

  ui.alert(
    "✅ 월별 마감 탭 보정 완료\n보정: " + fixed + "개 탭"
    + (errs.length ? "\n⚠ 오류:\n" + errs.join("\n") : "")
  );
}
