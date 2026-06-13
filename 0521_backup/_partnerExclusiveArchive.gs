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

// ══════════════════════════════════════════════
//  공개 진입점
// ══════════════════════════════════════════════

/**
 * [수동] 전용양식 → 전용발주 마감탭 이동 + UID 초기화
 */
function partnerArchiveExclusiveForm() {
  var ui = SpreadsheetApp.getUi();

  var now     = new Date();
  var yyyy    = Utilities.formatDate(now, "Asia/Seoul", "yyyy");
  var mm      = parseInt(Utilities.formatDate(now, "Asia/Seoul", "M"), 10);
  var tabName = "(" + yyyy + "년 " + mm + "월) " + _PEA_TAB_SUFFIX;

  var cf = ui.alert(
    "📁 전용발주 마감 이동",
    "각 협력업체 파일의 「전용양식」데이터를\n" +
    "→ 「" + tabName + "」탭으로 이동합니다.\n\n" +
    "· 전용양식 원본 행 → 삭제 (헤더 유지)\n" +
    "· 소스 탭 협력Push UID → 초기화 (재Push 가능)\n\n" +
    "계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (cf !== ui.Button.YES) return;

  var result = _pea_core_(tabName);

  ui.alert(
    "✅ 전용발주 마감 이동 완료\n\n" +
    "이동: " + result.moved + "행\n" +
    "잔류(송장없음·미완료): " + result.kept + "행\n" +
    "처리 탭: " + result.tabsCleared + "개\n" +
    "UID 초기화: " + result.uidCleared + "건\n" +
    (result.errors.length > 0 ? "\n⚠ 오류:\n" + result.errors.slice(0, 5).join("\n") : "") +
    "\n\n이제 '대리발주 Push'를 실행하면 새 발주가 전용양식에 채워집니다."
  );
}



// ══════════════════════════════════════════════
//  핵심 로직
// ══════════════════════════════════════════════
function _pea_core_(tabName) {
  var result = { moved: 0, kept: 0, tabsCleared: 0, uidCleared: 0, errors: [] };

  var files = _pt_listFiles();

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss   = SpreadsheetApp.openById(files[fi].id);
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

          // ★ 송장번호(A열) / 발송완료(B열 적요) 기준 이동 판단
          //   - 송장번호 있음              → 마감탭으로 이동
          //   - 송장번호 없음 + 발송완료  → 마감탭으로 이동 (송장 없이 완료 처리된 케이스)
          //   - 송장번호 없음 + 미완료    → 전용양식 잔류
          var invoice    = String(data[di][0] || "").trim(); // A열: 송장번호
          var statusVal  = String(data[di][1] || "").trim(); // B열: 적요(발송완료 여부)
          var isShipped  = statusVal === "발송완료";

          if (!invoice && !isShipped) {
            // 송장번호도 없고 발송완료도 아님 → 잔류
            keepRowIdxs.push(di);
            continue;
          }
          // 송장번호 있거나 발송완료 → 마감탭으로 이동
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

        // 전용양식 원본에서 이동된 행 삭제 (데이터 덮어쓰기 방식으로 속도 개선)
        if (keepRowIdxs.length === 0) {
          // 전부 이동 → 기존처럼 전체 삭제
          tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
        } else {
          // 남길 행이 있음 → 일괄 clearContent 후 setValues
          tabSheet.getRange(2, 1, lr - 1, lc).clearContent();
          
          var keepRowsData = [];
          for (var ki = 0; ki < keepRowIdxs.length; ki++) {
            keepRowsData.push(data[keepRowIdxs[ki]]);
          }
          if (keepRowsData.length > 0) {
            tabSheet.getRange(2, 1, keepRowsData.length, lc).setValues(keepRowsData);
          }
        }

        result.moved       += archiveRows.length;
        result.kept        += keepRowIdxs.length;
        result.tabsCleared += 1;
        SpreadsheetApp.flush();
      }
    } catch (e) {
      result.errors.push("[" + files[fi].name + "] " + e.message);
    }
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

  return result;
}

// ══════════════════════════════════════════════
//  헬퍼
// ══════════════════════════════════════════════
function _pea_initArchiveTab_(tab, headers, lc) {
  // 빈 탭 초기 설정 (나중에 헤더 덮어씌워질 예정)
  try { tab.setFrozenRows(1); } catch(e) {}
}

function _pea_setKey_(tab, key) {
  try { tab.getRange(_PEA_KEY_CELL).setValue(key).setFontColor("white"); } catch(e) {}
}

function _pea_findTabByKey_(ss, key) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    try {
      if (String(sheets[i].getRange(_PEA_KEY_CELL).getValue() || "").trim() === key)
        return sheets[i];
    } catch(e) {}
  }
  return null;
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
