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
    "계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (cf !== ui.Button.YES) return;

  var result = _pea_core_(tabName);

  // ★ Google Chat 알림
  try { _chat_notifyArchive_(result.moved, result.kept, result.tabsCleared, result.uidCleared); } catch (eChat) {}

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

          // ★ 송장번호(A열) 기준 이동 판단
          //   - 송장번호 있음 → 마감탭으로 이동
          //   - 송장번호 없음 → 전용양식 잔류 (상태값 무관)
          var invoice    = String(data[di][0] || "").trim(); // A열: 송장번호

          if (!invoice) {
            // 송장번호 없음 → 잔류
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
