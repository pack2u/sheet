/**
 * [협력업체] 전용양식 → 전용발주 마감탭 이동 시스템  v1.0
 * 파일: _partnerExclusiveArchive.gs
 *
 * ★ 핵심 흐름 ★
 *   각 협력업체 파일의 「전용양식」탭 전체 데이터를
 *   → 같은 파일 내 「(YYYY년 M월) 전용발주 마감」탭으로 이동
 *   → 전용양식 원본 행 삭제 (헤더 1행만 유지)
 *   → 소스 탭 협력Push UID 초기화 (재Push 가능 상태)
 *
 * UID 유무와 무관하게 동작합니다.
 */

var _PEA_TAB_SUFFIX    = "전용발주 마감";
var _PEA_KEY_CELL      = "AZ1";
var _PEA_KEY_PREFIX    = "PEA_MONTH:";
var _PEA_HEADER_BG     = "#1f4e78";

// ★ 2026-07-16: 연속 실행(continuation) 상수 — GAS 6분 한도 회피
var _PEA_RESUME_KEY_     = "_PEA_RESUME_STATE";     // ScriptProperties 상태 저장 키
var _PEA_RESUME_TRIGGER_ = "_pea_continueResume_";  // 재개 트리거 핸들러명
var _PEA_PENDING_KEY_    = "_PEA_PENDING_TABNAME";  // 비차단 신규 시작용 tabName 보관 키

// ══════════════════════════════════════════════
//  공개 진입점
// ══════════════════════════════════════════════

/**
 * [수동] 전용양식 → 전용발주 마감탭 이동 + UID 초기화
 *  ★ 2026-07-16: 비차단(non-blocking) 방식.
 *  확인창(미리보기) → 백그라운드 트리거로 실제 처리 → 완료 시 Chat 알림.
 *  확인창 대기/처리 중 6분 한도로 죽던 문제 해결.
 */
function partnerArchiveExclusiveForm() {
  var ui = SpreadsheetApp.getUi();

  var now     = new Date();
  var yyyy    = Utilities.formatDate(now, "Asia/Seoul", "yyyy");
  var mm      = parseInt(Utilities.formatDate(now, "Asia/Seoul", "M"), 10);
  var tabName = "(" + yyyy + "년 " + mm + "월) " + _PEA_TAB_SUFFIX;

  // ★ 마감 이동 전 미리보기 (이동/잔류 예상 건수 사전 스캔)
  var preview = _pea_preview_(tabName);

  var cf = ui.alert(
    "📁 전용발주 마감 이동",
    "각 협력업체 파일의 「전용양식」데이터를\n" +
    "→ 「" + tabName + "」탭으로 이동합니다.\n\n" +
    "📊 예상 결과:\n" +
    "  · 이동: " + preview.moveCount + "행\n" +
    "  · 잔류: " + preview.keepCount + "행\n" +
    "  · 대상 탭: " + preview.tabCount + "개\n\n" +
    "· 전용양식 원본 행 → 삭제 (헤더 유지)\n" +
    "· 소스 탭 협력Push UID → 초기화 (재Push 가능)\n\n" +
    "▶ 확인을 누르면 백그라운드에서 처리되며,\n" +
    "   완료 시 Google Chat 알림이 전송됩니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (cf !== ui.Button.YES) return;

  // ★ 비차단: 이전 미완료 정리 → tabName 예약 → 백그라운드 트리거 시작
  _pea_clearResumeState_();
  try { PropertiesService.getScriptProperties().setProperty(_PEA_PENDING_KEY_, tabName); } catch(_) {}
  var scheduled = _pea_scheduleResume_(5 * 1000); // 5초 후 백그라운드 시작

  if (scheduled) {
    ui.alert("✅ 대리공급 마감을 시작했습니다.\n\n" +
      "백그라운드에서 처리되며, 완료되면 Google Chat 알림이 전송됩니다.\n" +
      "이 창은 닫으셔도 됩니다.");
    return;
  }

  // ── 트리거 예약 실패 → 인라인 폴백(차단 방식) ──
  try { PropertiesService.getScriptProperties().deleteProperty(_PEA_PENDING_KEY_); } catch(_) {}
  ui.alert("⚠ 백그라운드 예약 실패 → 즉시 처리합니다.\n(업체가 많으면 시간이 걸릴 수 있습니다.)");
  var result = _pea_core_(tabName, false);

  if (result.incomplete) {
    ui.alert(
      "⏳ 전용발주 마감 진행 중\n\n" +
      "업체가 많아 나눠서 처리합니다.\n" +
      "남은 " + result.remaining + "개 업체는 1분 뒤 백그라운드에서 자동으로 이어집니다.\n" +
      "(완료 시 Google Chat 알림이 전송됩니다.)"
    );
    return;
  }

  try { _chat_notifyArchive_(result.moved, result.kept, result.tabsCleared, result.uidCleared); } catch (eChat) {}

  ui.alert(
    "✅ 전용발주 마감 이동 완료\n\n" +
    "이동: " + result.moved + "행\n" +
    "잔류(송장없음·미완료): " + result.kept + "행\n" +
    "처리 탭: " + result.tabsCleared + "개\n" +
    "UID 초기화: " + result.uidCleared + "건\n" +
    "발주허브 정리: " + (result.hubCleared || 0) + "건\n" +
    "📋 임시기록 정리: 삭제 " + (result.tempCleared || 0) + "건, 유지 " + (result.tempKept || 0) + "건\n" +
    (result.errors.length > 0 ? "\n⚠ 오류:\n" + result.errors.slice(0, 5).join("\n") : "") +
    "\n\n이제 '대리발주 Push'를 실행하면 새 발주가 전용양식에 채워집니다."
  );
}



// ══════════════════════════════════════════════
//  핵심 로직
// ══════════════════════════════════════════════
function _pea_core_(tabName, silent) {
  var _startMs_ = Date.now();
  var _MAX_EXEC_MS_ = 4.5 * 60 * 1000; // ★ 2026-07-16: 배치 시간예산(6분 한도 안전마진)

  // ★ 2026-07-16: 연속 실행 — tabName 있으면 신규 시작, null이면 재개(저장 상태 사용)
  var state = _pea_loadResumeState_();
  var resuming = (tabName == null) && state && state.queue;

  if (!resuming) {
    // ── 신규 시작: 이전 미완료 상태 정리 후 초기화 ──
    _pea_clearResumeState_();
    state = {
      tabName: tabName, queue: [],
      moved: 0, kept: 0, tabsCleared: 0, uidCleared: 0,
      tempCleared: 0, tempKept: 0, hubCleared: 0, errors: []
    };

    // ★ 시작 초기화(1회만): 임시기록 + 허브 (재개 시엔 재실행 금지)
    try {
      var hubSS = SpreadsheetApp.openById(_PT.INFO_SS_ID);
      var tempTab = _po_getNonPartnerTempTab_(hubSS);
      if (tempTab) {
        var tempClear = _po_clearTempTabInvoicedRowsOnly_(tempTab);
        state.tempCleared = tempClear.cleared;
        state.tempKept = tempClear.kept;
        Logger.log("[PEA] 임시기록 초기화: 삭제=" + tempClear.cleared + "건, 유지=" + tempClear.kept + "건");
      }
    } catch (eTempClear) {
      state.errors.push("[임시기록초기화] " + eTempClear.message);
    }

    try {
      var hubSS_ = SpreadsheetApp.openById(_PT.HUB_ID);
      var hubTab_ = hubSS_.getSheetByName("협력업체_발주허브");
      if (hubTab_ && hubTab_.getLastRow() >= 2) {
        var hubLr_ = hubTab_.getLastRow();
        var hubLc_ = hubTab_.getLastColumn();
        var hubData_ = hubTab_.getRange(2, 1, hubLr_ - 1, hubLc_).getValues();
        var INV_COL_ = 13;
        var keepHub_ = [];
        var removedHub_ = 0;
        for (var hr_ = 0; hr_ < hubData_.length; hr_++) {
          var hubInv_ = String(hubData_[hr_][INV_COL_] || "").trim();
          if (hubInv_) {
            removedHub_++;
          } else {
            keepHub_.push(hubData_[hr_]);
          }
        }
        if (removedHub_ > 0) {
          hubTab_.getRange(2, 1, hubLr_ - 1, hubLc_).clearContent();
          if (keepHub_.length > 0) {
            hubTab_.getRange(2, 1, keepHub_.length, hubLc_).setValues(keepHub_);
          }
          SpreadsheetApp.flush();
          state.hubCleared = removedHub_;
          Logger.log("[PEA] 발주허브 초기화: 삭제=" + removedHub_ + "건, 유지=" + keepHub_.length + "건");
        }
      }
    } catch (eHubClear) {
      state.errors.push("[발주허브초기화] " + eHubClear.message);
    }

    var files = _pt_listFiles();
    state.queue = files.map(function(f) { return { id: f.id, name: f.name }; });
    _pea_saveResumeState_(state);
  } else {
    tabName = state.tabName; // 재개: 저장된 tabName 복원
  }

  var result = state; // 이후 result.* 접근을 state로 통일

  // ★ 안전망: 6분 강제종료 대비 5.5분 후 재개 예약 (정상 종료 시 교체/삭제됨)
  _pea_scheduleResume_(5.5 * 60 * 1000);

  var processed = 0;
  while (state.queue.length > 0) {
    if (processed > 0 && Date.now() - _startMs_ > _MAX_EXEC_MS_) break;
    var fileInfo = state.queue.shift();
    try {
      var ss   = SpreadsheetApp.openById(fileInfo.id);
      var tabs = ss.getSheets();

      for (var ti = 0; ti < tabs.length; ti++) {
        var tabSheet = tabs[ti];
        if (tabSheet.getName().indexOf("전용양식") === -1) continue;

        var lr = tabSheet.getLastRow();
        if (lr < 2) continue; // 헤더만 있는 경우 스킵

        var lc      = tabSheet.getLastColumn();
        var headers = tabSheet.getRange(1, 1, 1, lc).getValues()[0];
        var data    = tabSheet.getRange(2, 1, lr - 1, lc).getValues();

        // ★ B열(인덱스1) 날짜 기준 필터링: 오늘 이전(어제까지) 날짜만 마감탭으로 이동 (오늘 발주건은 남김)
        var today = new Date();
        today.setHours(23, 59, 59, 999); // 오늘 끝까지 포함
        var todayNum = today.getFullYear() * 10000 +
                       (today.getMonth() + 1) * 100 +
                       today.getDate();

        var archiveRows = []; // 마감탭으로 이동할 행
        var keepRowIdxs = []; // 전용양식에 남길 행 인덱스 (0-based in data[])

        for (var di = 0; di < data.length; di++) {
          var bVal = String(data[di][1] || "").trim();
          // B열 형식: "2026/05/15-33" → 날짜 부분 추출
          var dateMatch = bVal.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
          if (dateMatch) {
            var rowDateNum = parseInt(dateMatch[1], 10) * 10000 +
                             parseInt(dateMatch[2], 10) * 100 +
                             parseInt(dateMatch[3], 10);
            if (rowDateNum >= todayNum) {
              // 미래 날짜 + 오늘 날짜 → 전용양식에 남김 (날짜 우선)
              keepRowIdxs.push(di);
              continue;
            }
          }

          // ★ 송장번호(A열) 기준 이동 판단
          //   - 송장번호 있음 → 마감탭으로 이동
          //   - 송장번호 없음 → 15일 이내 잔류, 15일 초과 시 강제 이동
          var invoice    = String(data[di][0] || "").trim(); // A열: 송장번호

          if (!invoice) {
            // ★ 2026-07-07: 송장 없는 행 — 15일 이내 잔류, 15일 초과 강제 이동
            // AX열(49) 또는 전체 행에서 날짜 추출
            var _pushDate15 = null;
            // 방법1: AX열(49) UID에서 날짜 추출 (예: "AP-20260707-001")
            for (var _axc = Math.min(lc - 1, 49); _axc >= 2; _axc--) {
              var _axVal = String(data[di][_axc] || "").trim();
              var _axDateM = _axVal.match(/(\d{4})(\d{2})(\d{2})/);
              if (!_axDateM) _axDateM = _axVal.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
              if (_axDateM) {
                _pushDate15 = parseInt(_axDateM[1], 10) * 10000 +
                              parseInt(_axDateM[2], 10) * 100 +
                              parseInt(_axDateM[3], 10);
                break;
              }
            }
            if (_pushDate15) {
              var _cutoff15 = new Date();
              _cutoff15.setDate(_cutoff15.getDate() - 15);
              var _cutoffNum15 = _cutoff15.getFullYear() * 10000 +
                                 (_cutoff15.getMonth() + 1) * 100 +
                                 _cutoff15.getDate();
              if (_pushDate15 <= _cutoffNum15) {
                // 15일 초과 → 강제 마감 이동
                archiveRows.push(data[di]);
                continue;
              }
            }
            // 15일 이내 또는 날짜 불명 → 잔류
            keepRowIdxs.push(di);
            continue;
          }
          // 송장번호 있음 → 마감탭으로 이동
          archiveRows.push(data[di]);
        }

        if (archiveRows.length === 0) continue; // 이동할 행 없음

        // 마감 탭 취득 or 생성
        var archTab = ss.getSheetByName(tabName);
        if (!archTab) {
          var byKey = _pea_findTabByKey_(ss, _PEA_KEY_PREFIX + tabName);
          archTab   = byKey || ss.insertSheet(tabName);
        }

        // 레이아웃 (최초 1회)
        var isNew = archTab.getLastRow() < 1;
        if (isNew) {
          _pea_initArchiveTab_(archTab, headers, lc);
        }

        // 마감 탭으로 데이터 추가 (수집일시 자동 추가)
        var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
        var appendRows = archiveRows.map(function(row) {
          return [nowStr].concat(row);
        });
        var extHeaders = ["이동일시"].concat(headers);
        var extLc      = extHeaders.length;

        // ★ 항상 헤더를 최신으로 동기화 (기존 탭이더라도 전용양식 헤더 변경 시 반영)
        var maxCol = archTab.getMaxColumns();
        if (maxCol < extLc) {
          archTab.insertColumnsAfter(maxCol, extLc - maxCol);
        }
        archTab.getRange(1, 1, 1, extLc).setValues([extHeaders])
          .setBackground(_PEA_HEADER_BG).setFontColor("white")
          .setFontWeight("bold").setHorizontalAlignment("center");
        archTab.setFrozenRows(1);
        
        // 기존 탭의 낡은 헤더(초과분) 지우기
        var curMax = archTab.getMaxColumns();
        if (curMax > extLc) {
          archTab.getRange(1, extLc + 1, 1, curMax - extLc).clearContent().setBackground("#ffffff");
        }

        var nextRow = archTab.getLastRow() + 1;
        if (nextRow < 2) nextRow = 2;
        archTab.getRange(nextRow, 1, appendRows.length, extLc).setValues(appendRows);

        // 키 셀 기록
        _pea_setKey_(archTab, _PEA_KEY_PREFIX + tabName);

        // ★ 2026-06-22: 안전장치 — 마감탭 기록 성공 확인 후에만 원본 삭제
        SpreadsheetApp.flush();
        var verifyLastRow = archTab.getLastRow();
        var expectedLastRow = nextRow + appendRows.length - 1;
        if (verifyLastRow < expectedLastRow) {
          result.errors.push("[" + fileInfo.name + "/" + tabSheet.getName() + "] 마감탭 기록 검증 실패 (기대=" + expectedLastRow + " 실제=" + verifyLastRow + ") → 원본 보존");
          continue;
        }

        // 전용양식 원본에서 이동된 행 삭제
        // ★ try/catch 감싸 → 실패 시 메모리의 원본 data[] 배열로 전체 복구
        try {
          if (keepRowIdxs.length === 0) {
            // 전부 이동 → 전체 삭제
            tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
          } else {
            // ★ 잔류 데이터를 clearContent 전에 미리 구성
            var keepRowsData = [];
            for (var ki = 0; ki < keepRowIdxs.length; ki++) {
              keepRowsData.push(data[keepRowIdxs[ki]]);
            }
            tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
            if (keepRowsData.length > 0) {
              tabSheet.getRange(2, 1, keepRowsData.length, lc).setValues(keepRowsData);
            }
            SpreadsheetApp.flush();

            // ★ 잔류 행 복원 검증
            var restoredCount = tabSheet.getLastRow() - 1;
            if (restoredCount < keepRowsData.length) {
              // 복원 부족 → 원본 전체 복구
              tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
              tabSheet.getRange(2, 1, data.length, lc).setValues(data);
              SpreadsheetApp.flush();
              result.errors.push("[" + fileInfo.name + "] 잔류 복원 검증 실패 → 원본 전체 복구");
              continue;
            }
          }
        } catch (eClear) {
          // ★ clearContent 후 setValues 실패 → 원본 전체 복구
          try {
            tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
            tabSheet.getRange(2, 1, data.length, lc).setValues(data);
            SpreadsheetApp.flush();
          } catch (eRestore) {}
          result.errors.push("[" + fileInfo.name + "] 원본 삭제 중 오류 → 복구 시도: " + eClear.message);
          continue;
        }

        result.moved       += archiveRows.length;
        result.kept        += keepRowIdxs.length;
        result.tabsCleared += 1;
        SpreadsheetApp.flush();
      }
    } catch (e) {
      result.errors.push("[" + fileInfo.name + "] " + e.message);
    }
    processed++;
    _pea_saveResumeState_(state); // 진행 상황 저장(중단 대비)
  }

  // ── 미완료: 남은 업체 있으면 재개 예약 후 반환 ──
  if (state.queue.length > 0) {
    _pea_saveResumeState_(state);
    _pea_scheduleResume_(60 * 1000);
    Logger.log("[PEA] 배치 중단 — 남은 " + state.queue.length + "개 업체, 1분 후 자동 재개");
    result.incomplete = true;
    result.remaining = state.queue.length;
    return result;
  }

  // UID 초기화 (소스 탭)
  try {
    var srcSS  = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
    var srcTab = null;
    var srcSheets = srcSS.getSheets();
    for (var si = 0; si < srcSheets.length; si++) {
      if (srcSheets[si].getSheetId() === _PEP_SOURCE_TAB_GID) { srcTab = srcSheets[si]; break; }
    }
    if (!srcTab) srcTab = srcSS.getSheetByName(_pep_getSourceTabName_());
    if (srcTab && srcTab.getLastRow() >= 2) {
      var hdr = srcTab.getRange(1, 1, 1, srcTab.getLastColumn()).getValues()[0];
      var uidCol = -1;
      for (var hi = 0; hi < hdr.length; hi++) {
        var hn = String(hdr[hi] || "").replace(/\s/g, "").toLowerCase();
        if (hn === "협력push" || hn === "pep_uid") { uidCol = hi; break; }
      }
      if (uidCol !== -1) {
        var srcLr    = srcTab.getLastRow();
        var uidVals  = srcTab.getRange(2, uidCol + 1, srcLr - 1, 1).getValues();
        var cleared  = 0;
        var blankArr = uidVals.map(function(r) {
          if (String(r[0] || "").trim()) { cleared++; return [""]; }
          return r;
        });
        srcTab.getRange(2, uidCol + 1, srcLr - 1, 1).setValues(blankArr);
        result.uidCleared = cleared;
        SpreadsheetApp.flush();
      }
    }
  } catch (eUid) {
    result.errors.push("[UID초기화] " + eUid.message);
  }

  // ★ 2026-07-03: 임시기록+허브 초기화는 파일 루프 전으로 이동됨 (위 참조)

  // ── 전체 완료 → 상태 정리 + 완료 알림 ──
  result.incomplete = false;
  _pea_saveFinalSummary_(result);
  _pea_clearResumeState_();
  if (silent) {
    try {
      _chat_sendCard_("✅ 대리공급 마감 완료",
        Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
        [
          { label: "이동", value: result.moved + "행" },
          { label: "잔류", value: result.kept + "행" },
          { label: "처리 탭", value: result.tabsCleared + "개" },
          { label: "UID 초기화", value: result.uidCleared + "건" },
          { label: "📋 임시기록", value: "삭제 " + (result.tempCleared||0) + " / 유지 " + (result.tempKept||0) },
          { label: "⚠ 오류", value: result.errors.length + "건" }
        ]);
    } catch(_) {}
  }
  return result;
}

// ══════════════════════════════════════════════
//  ★ 2026-07-16: 연속 실행(continuation) 인프라
// ══════════════════════════════════════════════

/** 재개/시작 트리거 핸들러 — 저장 상태 재개 또는 대기 중 신규 시작 처리 */
function _pea_continueResume_() {
  _pea_deleteResumeTriggers_(); // 자기 자신(일회성 트리거) 정리
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("[PEA_RESUME] Lock 실패 → 재예약");
    _pea_scheduleResume_(60 * 1000);
    return;
  }
  try {
    var state = _pea_loadResumeState_();
    if (state && state.queue) {
      _pea_core_(null, true); // 저장 상태로 재개
    } else {
      // 비차단 신규 시작: 대기 중인 tabName으로 백그라운드 시작
      var pending = PropertiesService.getScriptProperties().getProperty(_PEA_PENDING_KEY_);
      if (pending) {
        try { PropertiesService.getScriptProperties().deleteProperty(_PEA_PENDING_KEY_); } catch(_) {}
        _pea_core_(pending, true);
      }
    }
  }
  catch(e) { try { Logger.log("[PEA_RESUME_ERR] " + String(e.message||e)); } catch(_) {} }
  finally { lock.releaseLock(); }
}

function _pea_saveResumeState_(state) {
  try { PropertiesService.getScriptProperties().setProperty(_PEA_RESUME_KEY_, JSON.stringify(state)); }
  catch(e) { Logger.log("[PEA] 상태 저장 실패: " + e.message); }
}
function _pea_loadResumeState_() {
  try {
    var s = PropertiesService.getScriptProperties().getProperty(_PEA_RESUME_KEY_);
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
}
function _pea_clearResumeState_() {
  try { PropertiesService.getScriptProperties().deleteProperty(_PEA_RESUME_KEY_); } catch(e) {}
  _pea_deleteResumeTriggers_();
}
function _pea_saveFinalSummary_(result) {
  try { PropertiesService.getScriptProperties().setProperty(_PEA_RESUME_KEY_ + "_FINAL", JSON.stringify(result)); } catch(e) {}
}
function _pea_scheduleResume_(delayMs) {
  _pea_deleteResumeTriggers_(); // 중복 방지 (안전망 트리거 포함 교체)
  try {
    ScriptApp.newTrigger(_PEA_RESUME_TRIGGER_).timeBased().after(delayMs || 60 * 1000).create();
    return true;
  } catch(e) { Logger.log("[PEA] 재개 트리거 생성 실패: " + e.message); return false; }
}
function _pea_deleteResumeTriggers_() {
  try {
    var trs = ScriptApp.getProjectTriggers();
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].getHandlerFunction() === _PEA_RESUME_TRIGGER_) {
        try { ScriptApp.deleteTrigger(trs[i]); } catch(_) {}
      }
    }
  } catch(e) {}
}

// ══════════════════════════════════════════════
//  헬퍼
// ══════════════════════════════════════════════

/**
 * ★ 2026-06-18: 단일 파일 전용마감 처리 (일괄 마감 통합 루프에서 호출)
 * @param {Spreadsheet} ss - 이미 열린 스프레드시트 객체
 * @param {string} tabName - 마감 탭 이름 (예: "(2026년 6월) 전용발주 마감")
 * @returns {{ moved: number, kept: number }}
 */
function _pea_processOneFile_(ss, tabName) {
  var result = { moved: 0, kept: 0 };
  var tabs = ss.getSheets();

  for (var ti = 0; ti < tabs.length; ti++) {
    var tabSheet = tabs[ti];
    if (tabSheet.getName().indexOf("전용양식") === -1) continue;

    var lr = tabSheet.getLastRow();
    if (lr < 2) continue;

    var lc      = tabSheet.getLastColumn();
    var headers = tabSheet.getRange(1, 1, 1, lc).getValues()[0];
    var data    = tabSheet.getRange(2, 1, lr - 1, lc).getValues();

    var today = new Date();
    today.setHours(23, 59, 59, 999);
    var todayNum = today.getFullYear() * 10000 +
                   (today.getMonth() + 1) * 100 +
                   today.getDate();

    var archiveRows = [];
    var keepRowIdxs = [];

    for (var di = 0; di < data.length; di++) {
      var bVal = String(data[di][1] || "").trim();
      var dateMatch = bVal.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (dateMatch) {
        var rowDateNum = parseInt(dateMatch[1], 10) * 10000 +
                         parseInt(dateMatch[2], 10) * 100 +
                         parseInt(dateMatch[3], 10);
        if (rowDateNum >= todayNum) {
          keepRowIdxs.push(di);
          continue;
        }
      }

      var invoice = String(data[di][0] || "").trim();
      if (!invoice) {
        keepRowIdxs.push(di);
        continue;
      }
      archiveRows.push(data[di]);
    }

    if (archiveRows.length === 0) continue;

    var archTab = ss.getSheetByName(tabName);
    if (!archTab) {
      var byKey = _pea_findTabByKey_(ss, _PEA_KEY_PREFIX + tabName);
      archTab   = byKey || ss.insertSheet(tabName);
    }

    var isNew = archTab.getLastRow() < 1;
    if (isNew) {
      _pea_initArchiveTab_(archTab, headers, lc);
    }

    var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var appendRows = archiveRows.map(function(row) {
      return [nowStr].concat(row);
    });
    var extHeaders = ["이동일시"].concat(headers);
    var extLc      = extHeaders.length;

    var maxCol = archTab.getMaxColumns();
    if (maxCol < extLc) {
      archTab.insertColumnsAfter(maxCol, extLc - maxCol);
    }
    archTab.getRange(1, 1, 1, extLc).setValues([extHeaders])
      .setBackground(_PEA_HEADER_BG).setFontColor("white")
      .setFontWeight("bold").setHorizontalAlignment("center");
    archTab.setFrozenRows(1);

    var curMax = archTab.getMaxColumns();
    if (curMax > extLc) {
      archTab.getRange(1, extLc + 1, 1, curMax - extLc).clearContent().setBackground("#ffffff");
    }

    var nextRow = archTab.getLastRow() + 1;
    if (nextRow < 2) nextRow = 2;
    archTab.getRange(nextRow, 1, appendRows.length, extLc).setValues(appendRows);

    _pea_setKey_(archTab, _PEA_KEY_PREFIX + tabName);

    // ★ 2026-06-22: 안전장치 — 마감탭 기록 성공 확인 후에만 원본 삭제
    SpreadsheetApp.flush();
    var verifyLastRow = archTab.getLastRow();
    var expectedLastRow = nextRow + appendRows.length - 1;
    if (verifyLastRow < expectedLastRow) {
      // 마감탭 기록 검증 실패 → 원본 보존 (데이터 소실 방지)
      continue;
    }

    // ★ try/catch 감싸 → 실패 시 메모리의 원본 data[] 배열로 전체 복구
    try {
      if (keepRowIdxs.length === 0) {
        tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
      } else {
        // ★ 잔류 데이터를 clearContent 전에 미리 구성
        var keepRowsData = [];
        for (var ki = 0; ki < keepRowIdxs.length; ki++) {
          keepRowsData.push(data[keepRowIdxs[ki]]);
        }
        tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
        if (keepRowsData.length > 0) {
          tabSheet.getRange(2, 1, keepRowsData.length, lc).setValues(keepRowsData);
        }
        SpreadsheetApp.flush();

        // ★ 잔류 행 복원 검증
        var restoredCount = tabSheet.getLastRow() - 1;
        if (restoredCount < keepRowsData.length) {
          tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
          tabSheet.getRange(2, 1, data.length, lc).setValues(data);
          SpreadsheetApp.flush();
          continue;
        }
      }
    } catch (eClear) {
      // ★ clearContent 후 setValues 실패 → 원본 전체 복구
      try {
        tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
        tabSheet.getRange(2, 1, data.length, lc).setValues(data);
        SpreadsheetApp.flush();
      } catch (eRestore) {}
      continue;
    }

    result.moved += archiveRows.length;
    result.kept  += keepRowIdxs.length;
    SpreadsheetApp.flush();

    // ★ 2026-07-04: DB 동기화 — 전용양식 마감 상세
    try {
      // 업체명 추출
      var _vn_ = "";
      try {
        var _st_ = ss.getSheetByName("설정");
        if (_st_) _vn_ = String(_st_.getRange("B5").getValue() || "").trim();
      } catch(_) {}
      if (!_vn_) _vn_ = ss.getName().replace("[협력업체] ", "");

      // 마감 탭 이름에서 정산월 추출: "(2026년 7월) 전용 마감" → "2026-07"
      var _smM_ = tabName.match(/\((\d{4})년\s*(\d{1,2})월\)/);
      var _sm_ = _smM_ ? _smM_[1] + "-" + String(_smM_[2]).padStart(2, "0") : "";

      if (_sm_ && archiveRows.length > 0) {
        // 헤더 기반 열 인덱스 매핑
        var _colMap_ = {};
        for (var _ci_ = 0; _ci_ < headers.length; _ci_++) {
          _colMap_[String(headers[_ci_]).trim()] = _ci_;
        }
        var _getC_ = function(names) {
          for (var _ni_ = 0; _ni_ < names.length; _ni_++) {
            if (_colMap_[names[_ni_]] !== undefined) return _colMap_[names[_ni_]];
          }
          return -1;
        };

        var _dbRows_ = archiveRows.map(function(row) {
          return {
            unique_id: null,
            push_date: String(row[1] || "").trim() || null,  // B열: 날짜
            ecount_code: String(row[_getC_(["품목코드", "코드"]) >= 0 ? _getC_(["품목코드", "코드"]) : 2] || "").trim(),
            item_name: String(row[_getC_(["품목명"]) >= 0 ? _getC_(["품목명"]) : 3] || "").trim(),
            qty: parseInt(row[_getC_(["수량"]) >= 0 ? _getC_(["수량"]) : 4]) || 1,
            recipient: String(row[_getC_(["수취인명", "수령인", "수취인"]) >= 0 ? _getC_(["수취인명", "수령인", "수취인"]) : 5] || "").trim(),
            phone: String(row[_getC_(["전화번호", "수령인연락처", "연락처"]) >= 0 ? _getC_(["전화번호", "수령인연락처", "연락처"]) : 6] || "").trim(),
            address: String(row[_getC_(["주소", "배송지주소"]) >= 0 ? _getC_(["주소", "배송지주소"]) : 7] || "").trim(),
            delivery_msg: String(row[_getC_(["배송메시지", "적요"]) >= 0 ? _getC_(["배송메시지", "적요"]) : 8] || "").trim(),
            invoice_no: String(row[0] || "").trim() || null,  // A열: 송장번호
            unit_price: parseFloat(row[_getC_(["단가"]) >= 0 ? _getC_(["단가"]) : 9]) || 0,
            settle_amount: parseFloat(row[_getC_(["금액", "금액1"]) >= 0 ? _getC_(["금액", "금액1"]) : 10]) || 0,
            shipping_fee: 0,
            note: null,
            status: "마감완료"
          };
        });
        _sb_syncExclusiveSettle_(_vn_, _sm_, _dbRows_);
      }
    } catch (eDb) {
      Logger.log("[SB] 대리공급 마감 DB 동기화 오류: " + eDb.message);
    }
  }

  return result;
}

function _pea_initArchiveTab_(tab, headers, lc) {
  // 빈 탭 초기 설정 (나중에 헤더 덮어씌워질 예정)
  try { tab.setFrozenRows(1); } catch(e) {}
}

// ★ 2026-06-13 통합: 공통 _pt_setTabKey_/_pt_findTabByKey_ 위임 래퍼
function _pea_setKey_(tab, key) {
  _pt_setTabKey_(tab, key, _PEA_KEY_CELL);
}

function _pea_findTabByKey_(ss, key) {
  return _pt_findTabByKey_(ss, key, _PEA_KEY_CELL);
}

// ══════════════════════════════════════════════
//  AS 툴: 기존 모든 "전용발주 마감" 탭 헤더 동기화
// ══════════════════════════════════════════════
function partnerRepairExclusiveArchiveHeaders() {
  var ui = SpreadsheetApp.getUi();
  var cf = ui.alert(
    "🔧 마감탭 헤더 일괄 보정",
    "모든 협력업체 파일의 '전용발주 마감' 탭 헤더를 현재 '전용양식' 탭과 동일하게 맞춥니다.\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (cf !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var fixed = 0, skipped = 0, errors = [];

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      
      var formTab = typeof _pep_findExclusiveFormTab_ === "function" ? _pep_findExclusiveFormTab_(ss) : null;
      if (!formTab) {
        // Fallback if _pep_findExclusiveFormTab_ is not found
        var sheets = ss.getSheets();
        for (var idx = 0; idx < sheets.length; idx++) {
          if (sheets[idx].getName().indexOf("전용양식") !== -1) {
            formTab = sheets[idx];
            break;
          }
        }
      }
      if (!formTab) { skipped++; continue; }
      
      var lc = formTab.getLastColumn();
      if (lc < 1) { skipped++; continue; }
      var headers = formTab.getRange(1, 1, 1, lc).getValues()[0];
      var extHeaders = ["이동일시"].concat(headers);
      var extLc = extHeaders.length;

      var tabs = ss.getSheets();
      var tabFixed = false;
      for (var ti = 0; ti < tabs.length; ti++) {
        var archTab = tabs[ti];
        if (archTab.getName().indexOf(_PEA_TAB_SUFFIX) === -1) continue;

        var maxCol = archTab.getMaxColumns();
        if (maxCol < extLc) {
          archTab.insertColumnsAfter(maxCol, extLc - maxCol);
        }
        archTab.getRange(1, 1, 1, extLc).setValues([extHeaders])
          .setBackground(_PEA_HEADER_BG).setFontColor("white")
          .setFontWeight("bold").setHorizontalAlignment("center");
        archTab.setFrozenRows(1);
        
        var curMax = archTab.getMaxColumns();
        if (curMax > extLc) {
          archTab.getRange(1, extLc + 1, 1, curMax - extLc).clearContent().setBackground("#ffffff");
        }
        tabFixed = true;
      }
      if (tabFixed) {
        fixed++;
        SpreadsheetApp.flush();
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push("[" + files[fi].name + "] " + e.message);
    }
  }

  ui.alert(
    "✅ 마감탭 헤더 보정 완료\n수정: " + fixed + "파일 / 스킵: " + skipped + "파일\n" +
    (errors.length > 0 ? "\n⚠ 오류:\n" + errors.slice(0, 5).join("\n") : "")
  );
}

// ══════════════════════════════════════════════
//  미리보기: 마감 이동 전 이동/잔류 예상 건수 스캔
// ══════════════════════════════════════════════
function _pea_preview_(tabName) {
  var result = { moveCount: 0, keepCount: 0, tabCount: 0 };
  var files = _pt_listFiles();
  var today = new Date();
  today.setHours(23, 59, 59, 999);
  var todayNum = today.getFullYear() * 10000 +
                 (today.getMonth() + 1) * 100 +
                 today.getDate();

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var tabs = ss.getSheets();
      for (var ti = 0; ti < tabs.length; ti++) {
        if (tabs[ti].getName().indexOf("전용양식") === -1) continue;
        var lr = tabs[ti].getLastRow();
        if (lr < 2) continue;
        result.tabCount++;
        var data = tabs[ti].getRange(2, 1, lr - 1, Math.max(tabs[ti].getLastColumn(), 2)).getValues();
        for (var di = 0; di < data.length; di++) {
          var bVal = String(data[di][1] || "").trim();
          var dateMatch = bVal.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
          if (dateMatch) {
            var rowDateNum = parseInt(dateMatch[1], 10) * 10000 +
                             parseInt(dateMatch[2], 10) * 100 +
                             parseInt(dateMatch[3], 10);
            if (rowDateNum >= todayNum) { result.keepCount++; continue; }
          }
          var invoice = String(data[di][0] || "").trim();
          if (!invoice) { result.keepCount++; } else { result.moveCount++; }
        }
      }
    } catch (e) {}
  }
  return result;
}

// ══════════════════════════════════════════════
//  AS 도구: 전용양식 AX열(UID) 누락 진단
//  데이터가 있지만 AX열(50번째)이 비어있는 행을 업체별 집계
// ══════════════════════════════════════════════
function partnerDiagnoseExclusiveUid() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  var results = [];
  var totalData = 0, totalMissing = 0;

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var tabs = ss.getSheets();
      for (var ti = 0; ti < tabs.length; ti++) {
        if (tabs[ti].getName().indexOf("전용양식") === -1) continue;
        var lr = tabs[ti].getLastRow();
        if (lr < 2) continue;
        var maxC = tabs[ti].getMaxColumns();
        if (maxC < 50) { continue; } // AX열 없음
        var data = tabs[ti].getRange(2, 1, lr - 1, 50).getValues();
        var dataRows = 0, missing = 0;
        for (var di = 0; di < data.length; di++) {
          // 데이터 행 판별: D열(3) 또는 E열(4)에 값이 있으면 데이터 행
          var hasData = String(data[di][3] || "").trim() || String(data[di][4] || "").trim();
          if (!hasData) continue;
          dataRows++;
          var axVal = String(data[di][49] || "").trim();
          if (!axVal) missing++;
        }
        totalData += dataRows;
        totalMissing += missing;
        var pfx = files[fi].name.replace("[협력업체] ", "").replace(/\s*\(소비자용\).*$/, "").trim();
        results.push({ name: pfx, dataRows: dataRows, missing: missing });
      }
    } catch (e) {}
  }

  // HTML 팝업
  var html = '<div style="font-family:\'Segoe UI\',sans-serif;padding:16px;">';
  html += '<h2 style="margin:0 0 12px;color:#1a73e8;">🔍 전용양식 AX열(UID) 진단</h2>';
  html += '<div style="background:' + (totalMissing > 0 ? '#fff3e0' : '#e8f5e9') + ';border-radius:8px;padding:12px;margin-bottom:12px;">';
  html += '전체 데이터: <b>' + totalData + '</b>행 / UID 누락: <b style="color:' + (totalMissing > 0 ? '#e65100' : '#2e7d32') + ';">' + totalMissing + '</b>행</div>';

  html += '<table style="width:100%;border-collapse:collapse;">';
  html += '<tr style="background:#1f4e78;color:#fff;"><th style="padding:6px 10px;text-align:left;">업체</th>';
  html += '<th style="padding:6px 10px;text-align:right;">데이터</th>';
  html += '<th style="padding:6px 10px;text-align:right;">UID누락</th>';
  html += '<th style="padding:6px 10px;text-align:right;">상태</th></tr>';
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    var bg = ri % 2 === 0 ? '#f5f5f5' : '#ffffff';
    var statusIcon = r.missing === 0 ? '✅' : '⚠️';
    html += '<tr style="background:' + bg + ';">';
    html += '<td style="padding:5px 10px;">' + r.name + '</td>';
    html += '<td style="padding:5px 10px;text-align:right;">' + r.dataRows + '</td>';
    html += '<td style="padding:5px 10px;text-align:right;color:' + (r.missing > 0 ? '#e65100' : '#333') + ';font-weight:bold;">' + r.missing + '</td>';
    html += '<td style="padding:5px 10px;text-align:center;">' + statusIcon + '</td></tr>';
  }
  html += '</table></div>';

  var htmlOut = HtmlService.createHtmlOutput(html).setWidth(550).setHeight(450);
  ui.showModalDialog(htmlOut, "🔍 AX열 UID 진단");
}
