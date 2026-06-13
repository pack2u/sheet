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

      // ★ 품목명 보장: 단가조회 탭에서 코드→품목명 맵 구축
      var _codeToNameMap_ = {};
      try {
        var _vTab_ = _pt_findViewerSheet(ss);
        if (_vTab_) {
          var _vLr_ = _vTab_.getLastRow();
          if (_vLr_ >= 3) {
            var _vData_ = _vTab_.getRange(3, 3, _vLr_ - 2, 2).getValues(); // C:D열 (코드, 품목명)
            for (var vi = 0; vi < _vData_.length; vi++) {
              var _code_ = String(_vData_[vi][0] || "").trim();
              var _name_ = String(_vData_[vi][1] || "").trim();
              if (_code_ && _name_) _codeToNameMap_[_code_] = _name_;
            }
          }
        }
      } catch(_eMap) {}

      // 확장 헤더 (원본 + 취소 + 반품 + 취소반품사유 + 반품송장번호 + 반품배송비 + 도서산간배송비 + 기타정산)
      var extHeaders = _pms_buildExtHeaders_(headers, lc);
      var extLc      = extHeaders.length;
      var etcFeeC    = extLc;      // 1-based: 기타정산 (마지막)
      var islandFeeC = extLc - 1;  // 1-based: 도서산간배송비
      var shipFeeC   = extLc - 2;  // 1-based: 반품배송비
      var retInvC    = extLc - 3;  // 1-based: 반품송장번호
      var reasonC    = extLc - 4;  // 1-based: 취소반품사유
      var returnC    = extLc - 5;  // 1-based: 반품
      var cancelC    = extLc - 6;  // 1-based: 취소

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
        // ★ 품목명(D열, index 3)이 비어있으면 코드→품목명 맵에서 직접 조회
        var _arItemName_ = String(archiveRow[3] || "").trim();
        if (!_arItemName_ && String(archiveRow[2] || "").trim()) {
          var _lookupName_ = _codeToNameMap_[String(archiveRow[2]).trim()];
          if (_lookupName_) archiveRow[3] = _lookupName_;
        }
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
        _pms_layoutArchiveTab_(archTab, extHeaders, cMap, extLc, cancelC, returnC, reasonC, retInvC, shipFeeC, islandFeeC, etcFeeC, isNewBlank);
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

        // 발주탭 원본 행 삭제 — A열·D열·L열은 spill 수식이므로 clearContent 후 B~C, E~K, M~ 복원
        orderTab.getRange(2, 1, orderTab.getMaxRows() - 1, lc).clearContent();

        if (keepData.length > 0) {
          // B~C열 (열2~3, 인덱스 1~2) — D열(품목명)은 ARRAYFORMULA이므로 건너뜀
          var bcData = keepData.map(function(r){ return r.slice(1, 3); });
          orderTab.getRange(2, 2, keepData.length, 2).setValues(bcData);
          // E~K열 (열5~11, 인덱스 4~10) — D열(품목명) 건너뛴 후 복원
          var ekCount = Math.min(7, lc - 4);
          if (ekCount > 0) {
            var ekData = keepData.map(function(r){ return r.slice(4, 4 + ekCount); });
            orderTab.getRange(2, 5, keepData.length, ekCount).setValues(ekData);
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

  // ── 취소/반품 접수 탭 수식 자동 갱신 ──
  // ★ 마감탭이 새로 생겼으므로 VLOOKUP 범위를 최신 마감탭 포함으로 갱신
  if (archived > 0) {
    try {
      _pms_refreshCancelReturnFormulas_(files);
    } catch (eCr) {
      errMsgs.push("[취소반품 수식 갱신] " + eCr.message);
    }
  }

  var msg = "✅ 월별 정산 이동 완료\n이동: " + archived + "건"
    + (failed > 0 ? "\n⚠ 파일 오류 " + failed + "건:\n" + errMsgs.slice(0,5).join("\n") : "");
  Logger.log("[PMS] " + msg.replace(/\n/g," | "));
  if (!silent && ui) ui.alert(msg);
}

/**
 * 취소/반품 접수 탭의 VLOOKUP 수식을 최신 마감탭 포함하여 갱신
 * 월별 마감 이동 후 자동 호출됨
 */
function _pms_refreshCancelReturnFormulas_(files) {
  if (!files) files = _pt_listFiles();
  if (!files || !files.length) return;

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var crTab = ss.getSheetByName(_CR_TAB_NAME);
      if (!crTab) continue;
      _cr_applyFormulas_(crTab);
    } catch (e) {
      Logger.log("[취소반품 수식 갱신] " + files[fi].name + ": " + e.message);
    }
  }
  Logger.log("[PMS] 취소/반품 수식 갱신 완료 (" + files.length + "개 파일)");
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
//  ★ 2026-06-13 통합: _pt_buildOrderTabColumnMap 위임 래퍼
//  기존 필드(date, invoice, status, qty, price) 하위호환 유지
// ──────────────────────────────────────────────────────
function _pms_buildColMap_(headers) {
  var full = _pt_buildOrderTabColumnMap(headers);
  return {
    date:    full.date,
    invoice: full.invoice,
    // ★ status: 통합 매핑의 status 우선, 없으면 voucherMemo(적요) 폴백
    //   (기존 _pms_buildColMap_는 '적요'도 status로 매핑했으나,
    //    통합 매핑은 적요를 voucherMemo에 별도 매핑함)
    status:  full.status !== -1 ? full.status : full.voucherMemo,
    qty:     full.qty,
    // ★ price: 통합 매핑의 unitPrice 사용
    price:   full.unitPrice
  };
}

// ──────────────────────────────────────────────────────
//  확장 헤더 구성 (원본 + 취소 + 반품 + 취소반품사유 + 반품송장번호 + 반품배송비 + 도서산간배송비 + 기타정산)
// ──────────────────────────────────────────────────────
function _pms_buildExtHeaders_(headers, lc) {
  var base = [];
  for (var i = 0; i < lc; i++) base.push(i < headers.length ? headers[i] : "");
  while (base.length > 0) {
    var tail = String(base[base.length-1]||"").trim();
    if (tail === "취소" || tail === "반품" || tail === "취소반품사유" || tail === "반품송장번호" || tail === "반품배송비" || tail === "도서산간배송비" || tail === "기타정산") {
      base.pop();
    } else {
      break;
    }
  }
  base.push("취소");
  base.push("반품");
  base.push("취소반품사유");
  base.push("반품송장번호");
  base.push("반품배송비");
  base.push("도서산간배송비");
  base.push("기타정산");
  return base;
}

// ──────────────────────────────────────────────────────
//  행 길이 맞춤 (취소=false, 반품=false, 사유="", 반품송장="", 반품배송비="", 도서산간=O열값, 기타정산="")
// ──────────────────────────────────────────────────────
function _pms_padRow_(row, extLc, origLc) {
  var padded = [];
  // ★ 발주탭 O열(index 14) = 도서산간배송비 값 추출
  var islandFeeVal = (row.length > 14) ? (Number(row[14]) || 0) : 0;

  for (var i = 0; i < extLc; i++) {
    if (i < origLc && i < row.length) {
      padded.push(row[i]);
    } else if (i === extLc - 7 || i === extLc - 6) {
      padded.push(false); // 취소/반품 = false
    } else if (i === extLc - 2) {
      // ★ 도서산간배송비: O열 값 복사
      padded.push(islandFeeVal > 0 ? islandFeeVal : "");
    } else {
      padded.push(""); // 취소반품사유, 반품송장번호, 반품배송비, 기타정산
    }
  }
  return padded;
}

// ──────────────────────────────────────────────────────
//  월별 마감 탭 레이아웃 적용
// ──────────────────────────────────────────────────────
function _pms_layoutArchiveTab_(tab, extHeaders, cMap, extLc, cancelC, returnC, reasonC, retInvC, shipFeeC, islandFeeC, etcFeeC, isNewBlank) {
  // 1행: 요약 마커
  try {
    tab.getRange(1, 1, 1, 10).merge()
      .setValue("📊 월별 마감 요약")
      .setBackground("#444444").setFontColor("white")
      .setFontWeight("bold").setHorizontalAlignment("center");
  } catch(e) {}

  // 2~3행: 합계 수식
  _pms_applyFormulas_(tab, cMap, cancelC, returnC, shipFeeC, islandFeeC, etcFeeC);

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
  // 반품배송비 헤더 강조 (파랑)
  tab.getRange(_PMS_HEADER_ROW, shipFeeC).setBackground("#2980b9").setFontColor("white");
  // 도서산간배송비 헤더 강조 (보라)
  tab.getRange(_PMS_HEADER_ROW, islandFeeC).setBackground("#7b1fa2").setFontColor("white");
  // 기타정산 헤더 강조 (초록)
  tab.getRange(_PMS_HEADER_ROW, etcFeeC).setBackground("#27ae60").setFontColor("white");
  // 열 너비
  try {
    tab.setColumnWidth(reasonC, 200);
    tab.setColumnWidth(retInvC, 150);
    tab.setColumnWidth(shipFeeC, 120);
    tab.setColumnWidth(islandFeeC, 120);
    tab.setColumnWidth(etcFeeC, 120);
  } catch(e) {}
  // 금액 열 숫자 형식
  try { tab.getRange(_PMS_DATA_START, shipFeeC, tab.getMaxRows() - _PMS_DATA_START + 1, 1).setNumberFormat("#,##0"); } catch(e) {}
  try { tab.getRange(_PMS_DATA_START, islandFeeC, tab.getMaxRows() - _PMS_DATA_START + 1, 1).setNumberFormat("#,##0"); } catch(e) {}
  try { tab.getRange(_PMS_DATA_START, etcFeeC, tab.getMaxRows() - _PMS_DATA_START + 1, 1).setNumberFormat("#,##0"); } catch(e) {}
  tab.setFrozenRows(_PMS_HEADER_ROW);
}

// ──────────────────────────────────────────────────────
//  요약 수식 (2~3행): 건수 + 정산금액, 반품배송비, 도서산간, 기타정산, 최종정산
// ──────────────────────────────────────────────────────
function _pms_applyFormulas_(tab, cMap, cancelC, returnC, shipFeeC, islandFeeC, etcFeeC) {
  function L(n) {
    var s = "", c = n;
    while (c > 0) { var m = (c-1)%26; s = String.fromCharCode(65+m)+s; c = Math.floor((c-1)/26); }
    return s;
  }
  var dr    = String(_PMS_DATA_START);
  var cO    = L(cancelC) + dr + ":" + L(cancelC);
  var rO    = L(returnC) + dr + ":" + L(returnC);
  var dO    = cMap.date !== -1 ? L(cMap.date+1) + dr + ":" + L(cMap.date+1) : "";

  var sfO   = shipFeeC ? L(shipFeeC) + dr + ":" + L(shipFeeC) : "";
  var ifO   = islandFeeC ? L(islandFeeC) + dr + ":" + L(islandFeeC) : "";
  var efO   = etcFeeC ? L(etcFeeC) + dr + ":" + L(etcFeeC) : "";

  var cntAll, cntNet;
  if (dO) {
    cntAll = '=IFERROR(COUNTIF(' + dO + ',"<>0"),0)';
    cntNet = "=IFERROR(SUMPRODUCT((" + dO + '<>0)*(' + cO + "<>TRUE)*(" + rO + "<>TRUE)),0)";
  } else {
    cntAll = '=IFERROR(COUNTA(A' + dr + ':A),0)';
    cntNet = "=IFERROR(SUMPRODUCT((A" + dr + ':A<>"")*(' + cO + "<>TRUE)*(" + rO + "<>TRUE)),0)";
  }

  tab.getRange(2,1).setValue("전체 건수");
  tab.getRange(2,2).setFormula(cntAll).setNumberFormat("#,##0");
  tab.getRange(3,1).setValue("취소·반품 제외 건수");
  tab.getRange(3,2).setFormula(cntNet).setNumberFormat("#,##0");

  if (cMap.price !== -1) {
    var pO = L(cMap.price+1) + dr + ":" + L(cMap.price+1);
    var sumAll = dO
      ? '=IFERROR(SUMIF(' + dO + ',"<>0",' + pO + '),0)'
      : '=IFERROR(SUM(' + pO + '),0)';
    var sumNet = dO
      ? "=IFERROR(SUMPRODUCT((" + dO + "<>0)*(" + cO + "<>TRUE)*(" + rO + "<>TRUE)*(" + pO + ")),0)"
      : "=IFERROR(SUMPRODUCT((" + pO + '<>"")*(' + cO + "<>TRUE)*(" + rO + "<>TRUE)*(" + pO + ")),0)";
    tab.getRange(2,3).setValue("정산금액 합계");
    tab.getRange(2,4).setFormula(sumAll).setNumberFormat("#,##0");
    tab.getRange(3,3).setValue("정산금액 (취소반품 제외)");
    tab.getRange(3,4).setFormula(sumNet).setNumberFormat("#,##0");

    if (sfO) {
      // 2행: 반품배송비
      tab.getRange(2,5).setValue("반품배송비");
      tab.getRange(2,6).setFormula('=IFERROR(SUM(' + sfO + '),0)').setNumberFormat("#,##0");

      // 2행: 도서산간배송비
      if (ifO) {
        tab.getRange(2,7).setValue("도서산간배송비");
        tab.getRange(2,8).setFormula('=IFERROR(SUM(' + ifO + '),0)').setNumberFormat("#,##0");
      }

      // 2행: 기타정산 합계
      if (efO) {
        tab.getRange(2,9).setValue("기타정산");
        tab.getRange(2,10).setFormula('=IFERROR(SUM(' + efO + '),0)').setNumberFormat("#,##0");
      }

      // 3행: 최종 정산금액 = 정산금액(취소반품 제외) + 반품배송비 + 도서산간 + 기타정산
      tab.getRange(3,5).setValue("최종 정산금액");
      var finalParts = "D3+F2";
      if (ifO) finalParts += "+H2";
      if (efO) finalParts += "+J2";
      tab.getRange(3,6).setFormula("=IFERROR(" + finalParts + ",0)").setNumberFormat("#,##0");

      tab.getRange(3,5).setFontWeight("bold");
      tab.getRange(3,6).setFontWeight("bold").setFontColor("#c0392b");

      var summaryColCount = efO ? 10 : (ifO ? 8 : 6);
      tab.getRange(2,1,2,summaryColCount).setBackground("#f5f5f5").setBorder(true,true,true,true,true,true);
    } else {
      tab.getRange(2,1,2,4).setBackground("#f5f5f5").setBorder(true,true,true,true,true,true);
    }
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
// ★ 2026-06-13 통합: 공통 _pt_setTabKey_/_pt_findTabByKey_ 위임 래퍼
function _pms_setKey_(tab, key) {
  _pt_setTabKey_(tab, key, _PMS_KEY_CELL);
}
function _pms_findTabByKey_(ss, key) {
  return _pt_findTabByKey_(ss, key, _PMS_KEY_CELL);
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
      var etcFeeC    = extLc;
      var islandFeeC = extLc - 1;
      var shipFeeC = extLc - 2;
      var retInvC  = extLc - 3;
      var reasonC  = extLc - 4;
      var returnC  = extLc - 5;
      var cancelC  = extLc - 6;

      ss.getSheets().forEach(function(sh) {
        if (!String(sh.getName()).match(tabPattern)) return;

        _pms_layoutArchiveTab_(sh, extHdr, cMap, extLc, cancelC, returnC, reasonC, retInvC, shipFeeC, islandFeeC, etcFeeC, false);
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
