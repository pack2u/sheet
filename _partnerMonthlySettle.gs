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
  // ★ 2026-07-01: Lock 재시도 3회 (05시 일괄마감과 충돌 시 대비)
  var acquired = false;
  for (var _retry_ = 0; _retry_ < 3; _retry_++) {
    if (lock.tryLock(30000)) { acquired = true; break; }
    Logger.log("[PMS_SILENT] Lock 재시도 " + (_retry_ + 1) + "/3");
  }
  if (!acquired) {
    Logger.log("[PMS_SILENT] Lock 획득 실패 (3회 재시도 후) → 스킵");
    try { _chat_sendCard_("⚠ 대리판매 마감 Lock 실패", Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), [{ label: "상태", value: "Lock 3회 재시도 후 스킵" }]); } catch (_) {}
    return;
  }
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
// ★ 2026-07-16: 연속 실행(continuation) 상수 — GAS 6분 한도 회피
var _PMS_RESUME_KEY_ = "_PMS_RESUME_STATE";       // ScriptProperties 상태 저장 키
var _PMS_RESUME_TRIGGER_ = "_pms_continueResume_"; // 재개 트리거 핸들러명
var _PMS_TIME_BUDGET_MS_ = 4.5 * 60 * 1000;        // 배치당 시간 예산(4.5분, 6분 한도 안전마진)

function _pms_core_(ui, silent) {
  var files = _pt_listFiles();
  if (!files || !files.length) {
    if (!silent && ui) ui.alert("협력업체 파일 없음");
    return;
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

  // ★ 이전 미완료 상태/재개 트리거 정리 후 새 실행 시작
  _pms_clearResumeState_();

  var todayNum = parseInt(
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), 10);

  var errMsgs = [];
  var _tempCleared_ = 0, _tempKept_ = 0;

  // ★ 2026-07-04: 대리공급_임시기록 초기화 (파일 루프 전에 최우선 1회만 실행)
  try {
    var _hubSS_ = SpreadsheetApp.openById(_PT.INFO_SS_ID);
    var _tempTab_ = _po_getNonPartnerTempTab_(_hubSS_);
    if (_tempTab_) {
      var _tempClear_ = _po_clearTempTabInvoicedRowsOnly_(_tempTab_);
      _tempCleared_ = _tempClear_.cleared;
      _tempKept_ = _tempClear_.kept;
      Logger.log("[PMS] 임시기록 초기화: 삭제=" + _tempCleared_ + "건, 유지=" + _tempKept_ + "건");
    }
  } catch (_eTempClear_) {
    errMsgs.push("[임시기록초기화] " + _eTempClear_.message);
    Logger.log("[PMS] 임시기록 초기화 실패: " + _eTempClear_.message);
  }

  // ★ 처리 상태 저장 (파일 큐 + 누적 카운터) → 시간 초과 시 이어서 처리
  var state = {
    queue: files.map(function(f) { return { id: f.id, name: f.name }; }),
    todayNum: todayNum,
    archived: 0,
    failed: 0,
    errMsgs: errMsgs,
    tempCleared: _tempCleared_,
    tempKept: _tempKept_
  };
  _pms_saveResumeState_(state);

  // 첫 배치 실행 (시간 예산 내에서 가능한 만큼 처리)
  var done = _pms_runBatch_(silent);

  if (!silent && ui) {
    if (done) {
      var fin = _pms_loadFinalSummary_();
      ui.alert(fin || "✅ 월별 정산 이동 완료");
    } else {
      ui.alert("⏳ 대리판매 마감 진행 중\n\n" +
        "파일이 많아 나눠서 처리합니다.\n" +
        "나머지는 1분 뒤 백그라운드에서 자동으로 이어집니다.\n" +
        "(완료 시 Google Chat 알림이 전송됩니다.)");
    }
  }
}

/**
 * ★ 한 배치 처리 (시간 예산 내에서 파일 처리)
 * @param {boolean} silent 무음 여부 (완료 시 Chat 알림 발송용)
 * @return {boolean} 전체 완료 여부 (true=완료, false=재개 예약됨)
 */
function _pms_runBatch_(silent) {
  var startTime = new Date();
  var state = _pms_loadResumeState_();
  if (!state || !state.queue) return true; // 상태 없음 = 완료로 간주

  var batchArchivedUids = {}; // ★ 이번 배치에서 이동된 UID (배치별 허브 정리)
  var processedThisBatch = 0;

  while (state.queue.length > 0) {
    // 시간 예산 초과 시 중단 (단, 최소 1개는 처리해 무한루프 방지)
    if (processedThisBatch > 0 && (new Date() - startTime) > _PMS_TIME_BUDGET_MS_) break;

    var fileInfo = state.queue.shift();
    try {
      var ss = SpreadsheetApp.openById(fileInfo.id);
      var res = _pms_processOneFile_(ss, state.todayNum, batchArchivedUids);
      state.archived += res.archived;
      if (res.newTabCreated) {
        try {
          var crTab = ss.getSheetByName(_CR_TAB_NAME);
          if (crTab) _cr_applyFormulas_(crTab);
        } catch(_eCr) {}
      }
    } catch(e) {
      if (state.errMsgs.length < 20) state.errMsgs.push("[" + fileInfo.name + "] " + e.message);
      state.failed++;
    }
    processedThisBatch++;
    _pms_saveResumeState_(state); // 진행 상황 저장(중단 대비)
  }

  // ── 이번 배치에서 이동된 행을 허브에서 삭제 ──
  _pms_cleanupHub_(batchArchivedUids, Object.keys(batchArchivedUids).length, state.errMsgs);

  if (state.queue.length === 0) {
    // ── 전체 완료 ──
    var msg = "✅ 월별 정산 이동 완료\n이동: " + state.archived + "건"
      + "\n📋 임시기록 정리: 삭제 " + state.tempCleared + "건, 유지 " + state.tempKept + "건"
      + (state.failed > 0 ? "\n⚠ 파일 오류 " + state.failed + "건:\n" + state.errMsgs.slice(0,5).join("\n") : "");
    Logger.log("[PMS] " + msg.replace(/\n/g," | "));
    _pms_saveFinalSummary_(msg);
    _pms_clearResumeState_();
    if (silent) {
      try {
        _chat_sendCard_("✅ 대리판매 마감 완료",
          Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
          [
            { label: "이동", value: state.archived + "건" },
            { label: "📋 임시기록", value: "삭제 " + state.tempCleared + " / 유지 " + state.tempKept },
            { label: "⚠ 파일오류", value: state.failed + "건" }
          ]);
      } catch(_) {}
    }
    return true;
  }

  // ── 미완료 → 재개 트리거 설치 ──
  _pms_saveResumeState_(state);
  _pms_scheduleResume_();
  Logger.log("[PMS] 배치 중단 — 남은 파일 " + state.queue.length + "개, 1분 후 자동 재개");
  return false;
}

/** ★ 재개 트리거 핸들러 — 저장된 상태로 이어서 처리 */
function _pms_continueResume_() {
  _pms_deleteResumeTriggers_(); // 자기 자신(일회성 트리거) 정리
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("[PMS_RESUME] Lock 실패 → 재예약");
    _pms_scheduleResume_();
    return;
  }
  try { _pms_runBatch_(true); }
  catch(e) { try { Logger.log("[PMS_RESUME_ERR] " + String(e.message||e)); } catch(_) {} }
  finally { lock.releaseLock(); }
}

// ── 연속 실행 상태 관리 헬퍼 ──
function _pms_saveResumeState_(state) {
  try { PropertiesService.getScriptProperties().setProperty(_PMS_RESUME_KEY_, JSON.stringify(state)); }
  catch(e) { Logger.log("[PMS] 상태 저장 실패: " + e.message); }
}
function _pms_loadResumeState_() {
  try {
    var s = PropertiesService.getScriptProperties().getProperty(_PMS_RESUME_KEY_);
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
}
function _pms_clearResumeState_() {
  try { PropertiesService.getScriptProperties().deleteProperty(_PMS_RESUME_KEY_); } catch(e) {}
  _pms_deleteResumeTriggers_();
}
function _pms_saveFinalSummary_(msg) {
  try { PropertiesService.getScriptProperties().setProperty(_PMS_RESUME_KEY_ + "_FINAL", msg); } catch(e) {}
}
function _pms_loadFinalSummary_() {
  try { return PropertiesService.getScriptProperties().getProperty(_PMS_RESUME_KEY_ + "_FINAL"); }
  catch(e) { return null; }
}
function _pms_scheduleResume_() {
  _pms_deleteResumeTriggers_(); // 중복 방지
  try {
    ScriptApp.newTrigger(_PMS_RESUME_TRIGGER_).timeBased().after(60 * 1000).create();
  } catch(e) { Logger.log("[PMS] 재개 트리거 생성 실패: " + e.message); }
}
function _pms_deleteResumeTriggers_() {
  try {
    var trs = ScriptApp.getProjectTriggers();
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].getHandlerFunction() === _PMS_RESUME_TRIGGER_) {
        try { ScriptApp.deleteTrigger(trs[i]); } catch(_) {}
      }
    }
  } catch(e) {}
}

/**
 * ★ 단일 파일 처리 (일괄 마감 통합 루프에서 호출 가능)
 * @param {Spreadsheet} ss - 이미 열린 스프레드시트 객체
 * @param {number} todayNum - 오늘 날짜 숫자 (yyyyMMdd)
 * @param {Object} archivedUids - 이동된 고유ID 세트 (외부에서 누적)
 * @returns {{ archived: number }}
 */
function _pms_processOneFile_(ss, todayNum, archivedUids) {
  var result = { archived: 0, newTabCreated: false };
  var orderTab = ss.getSheetByName(_PMS_ORDER_TAB);
  if (!orderTab || orderTab.getLastRow() < 2) return result;

  var lr  = orderTab.getLastRow();
  var lc  = orderTab.getMaxColumns();
  var all = orderTab.getRange(1, 1, lr, lc).getValues();
  var headers = all[0];
  var cMap = _pms_buildColMap_(headers);

  if (cMap.date === -1) return result;

  // ★ 2026-07-01: 뷰어탭 1회만 접근 (캐싱)
  var _viewerTab_ = null;
  var _viewerName_ = "단가조회";
  try {
    _viewerTab_ = _pt_findViewerSheet(ss);
    if (_viewerTab_) _viewerName_ = _viewerTab_.getName();
  } catch(_eV) {}

  // ★ 품목명 보장: 단가조회 탭에서 코드→품목명 맵 구축
  var _codeToNameMap_ = {};
  try {
    if (_viewerTab_) {
      var _vLr_ = _viewerTab_.getLastRow();
      if (_vLr_ >= 3) {
        var _vData_ = _viewerTab_.getRange(3, 3, _vLr_ - 2, 2).getValues();
        for (var vi = 0; vi < _vData_.length; vi++) {
          var _code_ = String(_vData_[vi][0] || "").trim();
          var _name_ = String(_vData_[vi][1] || "").trim();
          if (_code_ && _name_) _codeToNameMap_[_code_] = _name_;
        }
      }
    }
  } catch(_eMap) {}

  var extHeaders = _pms_buildExtHeaders_(headers, lc);
  var extLc      = extHeaders.length;
  var etcFeeC    = extLc;
  var islandFeeC = extLc - 1;
  var shipFeeC   = extLc - 2;
  var retInvC    = extLc - 3;
  var reasonC    = extLc - 4;
  var returnC    = extLc - 5;
  var cancelC    = extLc - 6;

  // ★ 고유ID 열 인덱스 — 루프 밖에서 1회만 산출
  var uidColIdx = 12;
  for (var hsi = 0; hsi < headers.length; hsi++) {
    var hh = String(headers[hsi] || "").replace(/\s/g, "").toLowerCase();
    if (hh.indexOf("고유id") !== -1 || hh.indexOf("uniqueid") !== -1) {
      uidColIdx = hsi; break;
    }
  }

  var keepData            = [];
  var archiveDataByMonth  = {};

  for (var r = 1; r < all.length; r++) {
    var rowData = all[r];
    var orderDate = rowData[cMap.date];

    if (!orderDate) { keepData.push(rowData); continue; }

    var dateStr = _pms_parseDateStr_(orderDate);
    if (!dateStr) { keepData.push(rowData); continue; }

    var dNum   = parseInt(dateStr.substring(0, 8), 10);
    var isPast = dNum < todayNum;

    if (!isPast) { keepData.push(rowData); continue; }

    var invoiceVal = cMap.invoice !== -1
      ? String(rowData[cMap.invoice] || "").trim() : "";

    if (!invoiceVal) { keepData.push(rowData); continue; }

    var yyyy   = dateStr.substring(0, 4);
    var mm     = parseInt(dateStr.substring(4, 6), 10);
    var tabName = "(" + yyyy + "년 " + mm + "월) 발주 마감";

    if (!archiveDataByMonth[tabName]) archiveDataByMonth[tabName] = [];
    var archiveRow = rowData.slice(0);
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
    var archivedUid = String(rowData[uidColIdx] || "").trim();
    if (archivedUid) archivedUids[archivedUid] = true;
    archiveDataByMonth[tabName].push(archiveRow);
  }

  var hasArchived = false;

  for (var tabName in archiveDataByMonth) {
    var arr = archiveDataByMonth[tabName];
    if (!arr.length) continue;

    hasArchived = true;
    var monthKey = _PMS_KEY_PREFIX + tabName;

    var archTab = ss.getSheetByName(tabName);
    if (!archTab) {
      var byKey = _pms_findTabByKey_(ss, monthKey);
      if (byKey) {
        archTab = byKey;
      } else {
        archTab = ss.insertSheet(tabName);
        result.newTabCreated = true; // ★ 새 마감탭 생성됨
      }
    }

    var isNewBlank = archTab.getLastRow() < 1;

    _pms_layoutArchiveTab_(archTab, extHeaders, cMap, extLc, cancelC, returnC, reasonC, retInvC, shipFeeC, islandFeeC, etcFeeC, isNewBlank);
    _pms_setKey_(archTab, monthKey);
    _pms_ensureCheckboxes_(archTab, cancelC, returnC);

    var padded = arr.map(function(row) {
      return _pms_padRow_(row, extLc, lc);
    });
    var nextRow = archTab.getLastRow() + 1;
    if (nextRow < _PMS_DATA_START) nextRow = _PMS_DATA_START;

    archTab.getRange(nextRow, 1, padded.length, extLc)
      .setValues(padded)
      .setVerticalAlignment("middle");

    // ★ 2026-07-16 성능: 신규 append 행은 insertCheckboxes 1회면 충분
    //   (unchecked 기본값 자동 설정 → clearDataValidations/setValue(false) 불필요)
    archTab.getRange(nextRow, cancelC, padded.length, 2).insertCheckboxes();

    // ★ 2026-07-16 성능: 보호는 새/빈 탭일 때만 적용 (기존 탭은 이미 보호됨)
    if (isNewBlank || result.newTabCreated) {
      _pms_applyProtection_(archTab);
    }
    result.archived += padded.length;
  }

  if (hasArchived) {
    // ★ 2026-07-01: 잔류 데이터 복원 최적화 — 분할 5번 → 통합 1번 setValues
    orderTab.getRange(2, 1, orderTab.getMaxRows() - 1, lc).clearContent();

    if (keepData.length > 0) {
      // A열 제외(수식), B~끝까지 한 번에 복원
      var restW = lc - 1;
      var restData = keepData.map(function(r) {
        var row = r.slice(1, 1 + restW);
        while (row.length < restW) row.push("");
        return row;
      });
      orderTab.getRange(2, 2, keepData.length, restW).setValues(restData);
    }

    SpreadsheetApp.flush();
    try {
      _pt_healOrderSpillFormulas(orderTab, _viewerName_);
      // ★ D/L 백필 — 빈 품목명/단가를 뷰어 탭에서 조회하여 채움
      if (_viewerTab_) _pt_backfillOrderDL(orderTab, _viewerTab_);
    } catch(_eH) {}
    try { _pt_clearSearchInputTab_(ss); } catch(_e) {}
  }

  // ★ 2026-07-04: DB 동기화 — 대리판매 월별 마감 상세 + 정산 요약
  try {
    if (result.archived > 0) {
      // 업체명 추출 (설정 탭 B5 또는 시트 이름에서)
      var _vName_ = "";
      try {
        var _setTab_ = ss.getSheetByName("설정");
        if (_setTab_) _vName_ = String(_setTab_.getRange("B5").getValue() || "").trim();
      } catch(_) {}
      if (!_vName_) _vName_ = ss.getName().replace("[협력업체] ", "");

      // 마감 월별로 상세 행을 DB에 저장
      for (var _tab_ in archiveDataByMonth) {
        var _arr_ = archiveDataByMonth[_tab_];
        if (!_arr_ || !_arr_.length) continue;

        // 탭 이름에서 정산월 추출: "(2026년 7월) 발주 마감" → "2026-07"
        var _smMatch_ = _tab_.match(/\((\d{4})년\s*(\d{1,2})월\)/);
        var _sm_ = _smMatch_ ? _smMatch_[1] + "-" + String(_smMatch_[2]).padStart(2, "0") : "";

        if (_sm_) {
          var _dbRows_ = _arr_.map(function(row) {
            return {
              unique_id: String(row[uidColIdx] || "").trim() || null,
              order_date: String(row[cMap.date] || "").trim() || null,
              ecount_code: String(row[2] || "").trim() || null,  // C열
              item_name: String(row[3] || "").trim() || null,    // D열
              qty: parseInt(row[cMap.qty]) || 1,
              recipient: String(row[5] || "").trim() || null,    // F열
              phone: String(row[6] || "").trim() || null,        // G열
              address: String(row[7] || "").trim() || null,      // H열
              message: String(row[8] || "").trim() || null,      // I열
              unit_price: parseFloat(row[cMap.price]) || 0,
              note: String(row[10] || "").trim() || null,        // K열
              invoice_no: cMap.invoice !== -1 ? String(row[cMap.invoice] || "").trim() : null,
              status: "마감완료"
            };
          });
          _sb_syncPartnerSettle_(_vName_, _sm_, _dbRows_);
        }
      }
    }
  } catch (eDb) { Logger.log("[SB] 대리판매 마감 DB 동기화 오류: " + eDb.message); }

  return result;
}


/**
 * ★ 허브에서 이동된 행 삭제 (공통 로직)
 */
function _pms_cleanupHub_(archivedUids, archived, errMsgs) {
  if (archived > 0 && Object.keys(archivedUids).length > 0) {
    try {
      // ★ 2026-07-01: getActiveSpreadsheet() → openById (트리거 실행 시 null 방지)
      var hubSS  = SpreadsheetApp.getActiveSpreadsheet();
      if (!hubSS) hubSS = SpreadsheetApp.openById(_PT.HUB_ID);
      var hubTab = hubSS.getSheetByName("협력업체_발주허브");
      if (hubTab && hubTab.getLastRow() >= 2) {
        var hubLr      = hubTab.getLastRow();
        var hubLc      = hubTab.getLastColumn();
        var HUB_UID_COL = 3;
        var hubData    = hubTab.getRange(2, 1, hubLr - 1, hubLc).getValues();
        var keepHubData = [];
        for (var hr = 0; hr < hubData.length; hr++) {
          var hubUid = String(hubData[hr][HUB_UID_COL - 1] || "").trim();
          if (!(hubUid && archivedUids[hubUid])) {
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
}

/**
 * 취소/반품 접수 탭의 VLOOKUP 수식을 최신 마감탭 포함하여 갱신
 * ★ 2026-06-18: 별도 메뉴로 분리 (일괄 마감에서 자동 호출 제거)
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

/** ★ 2026-06-18: 취소/반품 수식 갱신 — 공개 메뉴 함수 */
function partnerRefreshCancelReturnFormulas() {
  var ui = SpreadsheetApp.getUi();
  var cf = ui.alert("🔄 취소/반품 수식 갱신",
    "모든 협력업체 파일의 '취소/반품 접수' 탭 수식을\n" +
    "최신 마감탭 포함하여 갱신합니다.\n\n" +
    "(월별 마감 이동 후 실행 권장)\n계속할까요?",
    ui.ButtonSet.YES_NO);
  if (cf !== ui.Button.YES) return;

  _pms_refreshCancelReturnFormulas_(null);
  ui.alert("✅ 취소/반품 수식 갱신 완료");
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
  // 1행: 요약 마커 ★ 2026-06-13 디자인 개선
  try {
    tab.getRange(1, 1, 1, 10).merge()
      .setValue("📊 월별 마감 요약")
      .setBackground("#1a237e").setFontColor("#ffffff")
      .setFontWeight("bold").setFontSize(12)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    tab.setRowHeight(1, 32);
  } catch(e) {}

  // 2~3행: 합계 수식
  _pms_applyFormulas_(tab, cMap, cancelC, returnC, shipFeeC, islandFeeC, etcFeeC);

  // 4행: 헤더
  if (tab.getMaxColumns() < extLc) {
    tab.insertColumnsAfter(tab.getMaxColumns(), extLc - tab.getMaxColumns());
  }
  tab.getRange(_PMS_HEADER_ROW, 1, 1, extLc).setValues([extHeaders])
    .setBackground("#37474f").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center")
    .setFontSize(10);
  // 취소·반품 체크박스 헤더 강조 (빨간)
  tab.getRange(_PMS_HEADER_ROW, cancelC).setBackground("#c62828").setFontColor("white");
  tab.getRange(_PMS_HEADER_ROW, returnC).setBackground("#c62828").setFontColor("white");
  // 사유·반품송장 헤더 강조 (주황)
  tab.getRange(_PMS_HEADER_ROW, reasonC).setBackground("#e65100").setFontColor("white");
  tab.getRange(_PMS_HEADER_ROW, retInvC).setBackground("#e65100").setFontColor("white");
  // 반품배송비 헤더 강조 (파랑)
  tab.getRange(_PMS_HEADER_ROW, shipFeeC).setBackground("#1565c0").setFontColor("white");
  // 도서산간배송비 헤더 강조 (보라)
  tab.getRange(_PMS_HEADER_ROW, islandFeeC).setBackground("#6a1b9a").setFontColor("white");
  // 기타정산 헤더 강조 (초록)
  tab.getRange(_PMS_HEADER_ROW, etcFeeC).setBackground("#2e7d32").setFontColor("white");

  // ★ 2026-06-13 개선: 자동 열 너비 + 주요 열 최적 너비
  try {
    // 기본 열 너비 설정
    if (cMap.date !== -1)      tab.setColumnWidth(cMap.date + 1, 90);    // 일자
    if (cMap.recipient !== -1) tab.setColumnWidth(cMap.recipient + 1, 80); // 수취인
    if (cMap.phone !== -1)     tab.setColumnWidth(cMap.phone + 1, 110);   // 전화번호
    if (cMap.price !== -1)     tab.setColumnWidth(cMap.price + 1, 85);    // 정산금액
    if (cMap.qty !== -1)       tab.setColumnWidth(cMap.qty + 1, 55);      // 수량
    tab.setColumnWidth(cancelC, 45);   // 취소
    tab.setColumnWidth(returnC, 45);   // 반품
    tab.setColumnWidth(reasonC, 200);  // 사유
    tab.setColumnWidth(retInvC, 150);  // 반품송장
    tab.setColumnWidth(shipFeeC, 100); // 반품배송비
    tab.setColumnWidth(islandFeeC, 100); // 도서산간
    tab.setColumnWidth(etcFeeC, 100);  // 기타정산
  } catch(e) {}

  // 금액 열 숫자 형식
  try { tab.getRange(_PMS_DATA_START, shipFeeC, tab.getMaxRows() - _PMS_DATA_START + 1, 1).setNumberFormat("#,##0"); } catch(e) {}
  try { tab.getRange(_PMS_DATA_START, islandFeeC, tab.getMaxRows() - _PMS_DATA_START + 1, 1).setNumberFormat("#,##0"); } catch(e) {}
  try { tab.getRange(_PMS_DATA_START, etcFeeC, tab.getMaxRows() - _PMS_DATA_START + 1, 1).setNumberFormat("#,##0"); } catch(e) {}
  if (cMap.price !== -1) {
    try { tab.getRange(_PMS_DATA_START, cMap.price + 1, tab.getMaxRows() - _PMS_DATA_START + 1, 1).setNumberFormat("#,##0"); } catch(e) {}
  }

  tab.setFrozenRows(_PMS_HEADER_ROW);

  // ★ 2026-06-13 추가: 주요 열 고정 확대 (수취인 열까지)
  try {
    var freezeCols = 1; // 최소 1열(일자) 고정
    if (cMap.recipient !== -1 && cMap.recipient + 1 <= 6) freezeCols = cMap.recipient + 1;
    else if (cMap.item !== -1 && cMap.item + 1 <= 6) freezeCols = cMap.item + 1;
    else freezeCols = Math.min(3, extLc);
    tab.setFrozenColumns(freezeCols);
  } catch(e) {}

  // ★ 2026-06-13 추가: 취소/반품 행 조건부 서식 (행 전체 연한 빨강 강조)
  try {
    var dataRange = tab.getRange(_PMS_DATA_START, 1, tab.getMaxRows() - _PMS_DATA_START + 1, extLc);
    // 취소=TRUE → 행 전체 연한 빨강
    var cancelFormula = "=INDIRECT(\"R[0]C" + cancelC + "\",FALSE)=TRUE";
    var cancelRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(cancelFormula)
      .setBackground("#fce4ec")
      .setRanges([dataRange])
      .build();
    // 반품=TRUE → 행 전체 연한 주황
    var returnFormula = "=INDIRECT(\"R[0]C" + returnC + "\",FALSE)=TRUE";
    var returnRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(returnFormula)
      .setBackground("#fff3e0")
      .setRanges([dataRange])
      .build();
    var existingRules = tab.getConditionalFormatRules() || [];
    existingRules.push(cancelRule);
    existingRules.push(returnRule);
    tab.setConditionalFormatRules(existingRules);
  } catch(e) {}
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

  tab.getRange(2,1).setValue("📦 전체 건수");
  tab.getRange(2,2).setFormula(cntAll).setNumberFormat("#,##0").setFontWeight("bold").setFontSize(11);
  tab.getRange(3,1).setValue("✅ 유효 건수 (취소·반품 제외)");
  tab.getRange(3,2).setFormula(cntNet).setNumberFormat("#,##0").setFontWeight("bold").setFontSize(11).setFontColor("#1b5e20");

  if (cMap.price !== -1) {
    var pO = L(cMap.price+1) + dr + ":" + L(cMap.price+1);
    var sumAll = dO
      ? '=IFERROR(SUMIF(' + dO + ',"<>0",' + pO + '),0)'
      : '=IFERROR(SUM(' + pO + '),0)';
    var sumNet = dO
      ? "=IFERROR(SUMPRODUCT((" + dO + "<>0)*(" + cO + "<>TRUE)*(" + rO + "<>TRUE)*(" + pO + ")),0)"
      : "=IFERROR(SUMPRODUCT((" + pO + '<>"")*(' + cO + "<>TRUE)*(" + rO + "<>TRUE)*(" + pO + ")),0)";
    tab.getRange(2,3).setValue("💰 정산금액 합계");
    tab.getRange(2,4).setFormula(sumAll).setNumberFormat("#,##0").setFontWeight("bold");
    tab.getRange(3,3).setValue("💰 유효 정산금액");
    tab.getRange(3,4).setFormula(sumNet).setNumberFormat("#,##0").setFontWeight("bold").setFontColor("#1b5e20");

    if (sfO) {
      // 2행: 반품배송비
      tab.getRange(2,5).setValue("📦 반품배송비");
      tab.getRange(2,6).setFormula('=IFERROR(SUM(' + sfO + '),0)').setNumberFormat("#,##0");

      // 2행: 도서산간배송비
      if (ifO) {
        tab.getRange(2,7).setValue("🏝️ 도서산간배송비");
        tab.getRange(2,8).setFormula('=IFERROR(SUM(' + ifO + '),0)').setNumberFormat("#,##0");
      }

      // 2행: 기타정산 합계
      if (efO) {
        tab.getRange(2,9).setValue("📋 기타정산");
        tab.getRange(2,10).setFormula('=IFERROR(SUM(' + efO + '),0)').setNumberFormat("#,##0");
      }

      // 3행: 최종 정산금액 = 정산금액(취소반품 제외) + 반품배송비 + 도서산간 + 기타정산
      tab.getRange(3,5).setValue("🏷️ 최종 정산금액");
      var finalParts = "D3+F2";
      if (ifO) finalParts += "+H2";
      if (efO) finalParts += "+J2";
      tab.getRange(3,6).setFormula("=IFERROR(" + finalParts + ",0)").setNumberFormat("#,##0");

      tab.getRange(3,5).setFontWeight("bold").setFontSize(11);
      tab.getRange(3,6).setFontWeight("bold").setFontColor("#c62828").setFontSize(12);

      var summaryColCount = efO ? 10 : (ifO ? 8 : 6);
      // ★ 2026-06-13: 요약 영역 시각화 강화
      tab.getRange(2,1,1,summaryColCount).setBackground("#e3f2fd").setBorder(true,true,true,true,true,true); // 연파랑
      tab.getRange(3,1,1,summaryColCount).setBackground("#e8f5e9").setBorder(true,true,true,true,true,true); // 연초록
    } else {
      tab.getRange(2,1,1,4).setBackground("#e3f2fd").setBorder(true,true,true,true,true,true);
      tab.getRange(3,1,1,4).setBackground("#e8f5e9").setBorder(true,true,true,true,true,true);
    }
  } else {
    tab.getRange(2,1,1,2).setBackground("#e3f2fd").setBorder(true,true,true,true,true,true);
    tab.getRange(3,1,1,2).setBackground("#e8f5e9").setBorder(true,true,true,true,true,true);
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

  // ★ 2026-07-16 성능: 첫 데이터 행에 이미 체크박스가 있으면 전체 정상으로 보고 스킵
  //   (정상 마감탭은 이 경로에서 즉시 반환 → 기존 행별 스캔·삽입 비용 제거)
  try {
    var fdv = tab.getRange(_PMS_DATA_START, cancelC, 1, 2).getDataValidations()[0];
    var CBX = SpreadsheetApp.DataValidationCriteria.CHECKBOX;
    var ok0 = fdv[0] && fdv[0].getCriteriaType() === CBX;
    var ok1 = fdv[1] && fdv[1].getCriteriaType() === CBX;
    if (ok0 && ok1) return;
  } catch(e) {}

  // ★ 2026-07-16 성능: 행별 삽입 대신 전체 범위 1회 처리
  //   기존 체크(true) 값은 보존하기 위해 값 백업 → insertCheckboxes → true만 복원
  try {
    var rng = tab.getRange(_PMS_DATA_START, cancelC, rowCount, 2);
    var vals = rng.getValues();
    rng.insertCheckboxes(); // 전체 unchecked 로 일괄 세팅
    var restore = vals.map(function(r) {
      return [ r[0] === true, r[1] === true ];
    });
    rng.setValues(restore);
  } catch(e) {
    Logger.log("[PMS] 체크박스 일괄 보정 실패: " + e.message);
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
