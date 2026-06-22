// ═══════════════════════════════════════════════════════════════════
// [단일 소스] 배포 시트 onEdit 자동완성 코드
// ───────────────────────────────────────────────────────────────────
// ★ 이 파일이 유일한 소스입니다. onEdit 수정은 여기서만 하세요!
// ★ 수정 후 clasp push → 스크립트 재설치 실행
// ═══════════════════════════════════════════════════════════════════
function getPartnerOnEditCode_() {
  return `
// ── [Pack2U] 발주 및 송장조회 탭 — 값 기반 자동완성 (2026-06-17) ──
function onEdit(e) {
  function cleanCode_(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\u00a0/g, '')
      .replace(/[\\u200b-\\u200d\\ufeff]/g, '')
      .replace(/[\\x00-\\x1F\\x7F-\\x9F]/g, '')
      .replace(/\\s/g, '')
      .toUpperCase();
  }
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();

    // ── [보강] 단가조회 탭 서식 오염 방지 및 조건부서식 재구축 ──
    if (sheetName === '단가조회' || sheetName === '팩투유 단가조회') {
      var r = e.range;
      var row = r.getRow();
      var numRows = r.getNumRows();
      sheet.getRange(row, 1, numRows, 10).setBackground(null);
      try {
        sheet.clearConditionalFormatRules();
        var vRange = sheet.getRange("A3:J5000");
        var rules = [];
        rules.push(
          SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied('=ISNUMBER(SEARCH("품절", $A3))')
            .setBackground("#f4cccc")
            .setRanges([vRange])
            .build()
        );
        rules.push(
          SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied('=ISNUMBER(SEARCH("단종", $A3))')
            .setBackground("#d9d9d9")
            .setRanges([vRange])
            .build()
        );
        rules.push(
          SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied('=ISNUMBER(SEARCH("재고까지만", $A3))')
            .setBackground("#ffe599")
            .setRanges([vRange])
            .build()
        );
        sheet.setConditionalFormatRules(rules);
      } catch(errDesign) {}
      return;
    }

    // ── [신규] 붙여넣기 서식 자동 제거 (발주/전용양식 탭) ──
    var isPasteTarget = (sheetName === '발주 및 송장조회' || sheetName.indexOf('전용양식') !== -1);
    if (isPasteTarget) {
      var pr = e.range;
      var pRow = pr.getRow();
      var pNumRows = pr.getNumRows();
      var pNumCols = pr.getNumColumns();
      if (pRow >= 2 && (pNumRows >= 2 || pNumCols >= 3)) {
        try {
          var pasteRange = sheet.getRange(pRow, pr.getColumn(), pNumRows, pNumCols);
          pasteRange.setBackground(null);
          pasteRange.setFontColor(null);
          pasteRange.setFontFamily(null);
          pasteRange.setFontSize(10);
          pasteRange.setFontWeight('normal');
          pasteRange.setFontStyle('normal');
        } catch(ePaste) {}
      }
    }

    if (sheetName !== '발주 및 송장조회') return;

    var r = e.range;
    var row = r.getRow();
    var numRows = r.getNumRows();
    var startCol = r.getColumn();
    var numCols = r.getNumColumns();
    if (row < 2 || numRows <= 0) return;
    if (numRows > 500) return;

    // ★ 2026-06-22: 자동입력 열 보호: A(1), D(4), L(12), M(13) — 수동 입력 시 즉시 차단 + 뷰어탭 값 복구
    var _protCols = [1, 4, 12, 13];
    var _hadProt = false;
    for (var pi = 0; pi < _protCols.length; pi++) {
      var pc = _protCols[pi];
      if (pc >= startCol && pc < startCol + numCols) {
        sheet.getRange(row, pc, numRows, 1).clearContent();
        _hadProt = true;
      }
    }
    if (_hadProt) {
      try { SpreadsheetApp.getActiveSpreadsheet().toast('이 열은 자동입력 열입니다. 수동 입력이 차단되었습니다.', '⚠️ 입력 차단', 3); } catch(eT){}
    }

    // C열(코드), D열(품목명), L열(단가) 수정 감지
    var hasC = (startCol <= 3 && startCol + numCols > 3);
    var hasD = (startCol <= 4 && startCol + numCols > 4);
    var hasL = (startCol <= 12 && startCol + numCols > 12);
    var hasEH = (startCol <= 8 && startCol + numCols > 5);
    if (!hasC && !hasD && !hasL && !hasEH) return;

    // [안전성] 뷰어(단가조회) 탭 동적 탐색
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var viewerTab = ss.getSheetByName('단가조회');
    if (!viewerTab) {
      var allTabs = ss.getSheets();
      for (var t = 0; t < allTabs.length; t++) {
        var tn = allTabs[t].getName();
        if (tn.indexOf('마감') !== -1 || tn.indexOf('발주') !== -1 || tn.indexOf('설정') !== -1 || tn.indexOf('검색') !== -1) continue;
        if (tn.indexOf('단가조회') !== -1 || tn.indexOf('뷰어') !== -1 || tn.indexOf('팩투유') !== -1 || tn.indexOf('단가') !== -1) {
          viewerTab = allTabs[t]; break;
        }
      }
    }
    if (!viewerTab) viewerTab = ss.getSheets()[0];
    var vLast = viewerTab.getLastRow();
    if (vLast < 3) return;
    var vData = viewerTab.getRange(3, 1, vLast - 2, 7).getValues();

    // B열(주문일자): C 입력이 있는데 비어있으면 오늘 날짜(yyyyMMdd) 자동입력
    try {
      var bcdData = sheet.getRange(row, 2, numRows, 2).getValues();
      var todayYmd = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
      var bVals = [];
      var bChanged = false;
      for (var bi = 0; bi < bcdData.length; bi++) {
        var curB = bcdData[bi][0];
        var curC = String(bcdData[bi][1] || '').trim();
        if (curC && !String(curB || '').trim()) {
          curB = todayYmd;
          bChanged = true;
        }
        bVals.push([curB]);
      }
      if (bChanged) sheet.getRange(row, 2, numRows, 1).setValues(bVals);
    } catch (eDateFill) {}

    // ★ C열 코드 입력 또는 D/L열 직접 편집 시: 뷰어 탭에서 조회하여 D/L 값 기록
    // ★ 2026-06-18: 배치 처리로 전환 (개별 getValue/setValue → getValues/setValues)
    //   기존: 행마다 6~8회 API 호출 → 8행 = 50+회 → 시간초과
    //   개선: 전체 2회 (읽기1+쓰기1) → 100행도 1초 이내
    if (hasC || hasD || hasL) {
      var batchData = sheet.getRange(row, 1, numRows, 14).getValues(); // A~N 일괄 읽기
      var dVals = []; // D열 결과
      var lVals = []; // L열 결과
      var jVals = []; // J열 결과
      var jOrig = []; // J열 원본
      var didRecover = false;

      for (var i = 0; i < numRows; i++) {
        var inputCode = cleanCode_(batchData[i][2]); // C열 (index 2)
        var origJ = String(batchData[i][9] || '').trim(); // J열 (index 9)
        jOrig.push(origJ);

        if (!inputCode) {
          if (hasC) {
            dVals.push(['']);
            lVals.push(['']);
          } else {
            dVals.push([batchData[i][3]]);
            lVals.push([batchData[i][11]]);
          }
          jVals.push([origJ]);
          continue;
        }

        var finalName = '';
        var foundStatus = '';
        var foundPrice = '';

        for (var v = 0; v < vData.length; v++) {
          var vCode = cleanCode_(vData[v][2]);
          if (vCode.indexOf('#REF') !== -1 || vCode.indexOf('#N/A') !== -1) continue;
          if (vCode === inputCode) {
            finalName = vData[v][3];
            foundStatus = vData[v][0];
            foundPrice = vData[v][6];
            break;
          }
        }

        // D열(품목명) + L열(단가)
        dVals.push([finalName || '']);
        lVals.push([foundPrice || '']);

        // J열(적요) 경고 처리
        var jNew = origJ;
        if (inputCode && !finalName) {
          if (origJ.indexOf('코드오류') === -1) {
            jNew = String.fromCharCode(0xD83D, 0xDEA8) + '코드오류 (총 ' + vData.length + '행 중 일치없음 / 입력: ' + inputCode + ')';
          }
        } else if (foundStatus && (String(foundStatus).indexOf('품절') !== -1 || String(foundStatus).indexOf('단종') !== -1 || String(foundStatus).indexOf('재고까지만') !== -1)) {
          var warn = String.fromCharCode(0xD83D, 0xDEA8) + ' ' + foundStatus;
          if (origJ !== warn) jNew = warn;
        } else if (origJ.indexOf('코드오류') !== -1 || origJ.indexOf(String.fromCharCode(0xD83D, 0xDEA8)) === 0) {
          jNew = '';
        }
        jVals.push([jNew]);

        if (!hasC && (hasD || hasL)) didRecover = true;
      }

      // ★ 일괄 쓰기 (API 호출 2~3회로 끝)
      sheet.getRange(row, 4, numRows, 1).setValues(dVals);   // D열
      sheet.getRange(row, 12, numRows, 1).setValues(lVals);  // L열
      // J열: 변경된 행만 쓰기
      var jChanged = false;
      for (var ji = 0; ji < jVals.length; ji++) {
        if (jVals[ji][0] !== jOrig[ji]) { jChanged = true; break; }
      }
      if (jChanged) sheet.getRange(row, 10, numRows, 1).setValues(jVals);

      if (didRecover) {
        try { ss.toast('단가/품목명은 자동입력 열입니다.\\n원래 데이터로 복구되었습니다.', '⚠️ 자동 복구', 4); } catch(eToast){}
      }
    }

    // ★ 필수필드 완성도 감지: N열(상태) 자동 갱신
    // ★ 2026-06-18: 배치 처리 (개별 getValue → 일괄 getValues)
    if (hasC || hasEH) {
      try {
        var nCol = 14;
        var statusData = (typeof batchData !== 'undefined' && batchData) ?
          batchData : sheet.getRange(row, 1, numRows, 14).getValues();
        var nVals = [];
        var nChanged = false;
        for (var ci = 0; ci < numRows; ci++) {
          var cV = String(statusData[ci][2] || '').trim();  // C열
          var nNow = String(statusData[ci][13] || '').trim(); // N열
          if (!cV) { nVals.push([nNow]); continue; }
          var eV = String(statusData[ci][4] || '').trim();  // E열
          var fV = String(statusData[ci][5] || '').trim();  // F열
          var gV = String(statusData[ci][6] || '').trim();  // G열
          var hV = String(statusData[ci][7] || '').trim();  // H열
          var miss = [];
          if (!eV || eV === '0') miss.push('수량');
          if (!fV) miss.push('수취인');
          if (!gV) miss.push('전화번호');
          if (!hV) miss.push('주소');
          if (miss.length > 0) {
            var wm = '⚠️입력미완(' + miss.join(',') + ')';
            if (nNow !== wm) { nVals.push([wm]); nChanged = true; }
            else nVals.push([nNow]);
          } else if (nNow.indexOf('입력미완') !== -1) {
            nVals.push(['']); nChanged = true;
          } else {
            nVals.push([nNow]);
          }
        }
        if (nChanged) sheet.getRange(row, nCol, numRows, 1).setValues(nVals);
      } catch (eN) {}
    }

  } catch (err) {}
}
`;
}
