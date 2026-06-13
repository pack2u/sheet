function diagnoseOldSystem() {
  var ui = SpreadsheetApp.getUi();
  var OLD_SYSTEM_ID = "1vWdJgmbW_Gwm_2b1pP8mVBxpfYBbUiAduSwkStXxs0Y";
  
  try {
    var ss = SpreadsheetApp.openById(OLD_SYSTEM_ID);
    var targetSheet = ss.getSheetByName("판매현황");
    if (!targetSheet) {
      ui.alert("⚠️ 기존 시스템 엑셀에 '판매현황' 이라는 시트가 없습니다!");
      return;
    }
    
    // 1행과 2행의 헤더 판별
    var headerRow = targetSheet.getRange(1, 1, 2, targetSheet.getLastColumn()).getValues();
    
    // 3~5행의 수식 샘플 스캔 (1행, 2행은 대체로 헤더이므로)
    var formulas = targetSheet.getRange(3, 1, 3, targetSheet.getLastColumn()).getFormulas();
    
    var msg = "💡 [판매현황 수식 분석 결과]\n\n";
    var foundFormulas = false;
    for(var r=0; r<formulas.length; r++) {
      for(var c=0; c<formulas[r].length; c++) {
         if(formulas[r][c] !== "") {
            var colLetter = String.fromCharCode(65 + c); 
            // 컬럼이 Z를 넘어가는 경우 처리
            if (c >= 26) {
               colLetter = String.fromCharCode(64 + Math.floor(c/26)) + String.fromCharCode(65 + (c%26));
            }
            msg += "[" + colLetter + "열] " + (r+3) + "행 수식:\n" + formulas[r][c] + "\n\n";
            foundFormulas = true;
         }
      }
    }
    
    if(!foundFormulas) {
       msg += "이 탭(3~5행)에는 현재 아무런 엑셀 수식이 걸려있지 않습니다. 값이 모두 수동으로 입력(복붙)되어 있습니다.";
    }
    
    ui.alert("진단 완료", msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("🚨 진단 중 오류가 발생했습니다.\n권한이 없거나 파일을 찾을 수 없습니다.\n" + e.message);
  }
}
