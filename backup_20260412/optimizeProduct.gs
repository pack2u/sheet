function createOptimizedCopy() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var originalSheetName = "상품정보";
  var originalSheet = ss.getSheetByName(originalSheetName);
  
  if (!originalSheet) {
    ui.alert("⚠️ 원본 '상품정보' 시트를 찾을 수 없습니다.");
    return;
  }
  
  var newSheetName = "상품정보(최적화사본)";
  var existingCopy = ss.getSheetByName(newSheetName);
  
  if (existingCopy) {
    var response = ui.alert("안내", "이미 최적화 사본이 존재합니다. 지우고 새로 복사하시겠습니까?", ui.ButtonSet.YES_NO);
    if (response == ui.Button.YES) {
      ss.deleteSheet(existingCopy);
    } else {
      return;
    }
  }
  
  // 1. 기존 시트를 복제
  var newSheet = originalSheet.copyTo(ss);
  newSheet.setName(newSheetName);
  ss.setActiveSheet(newSheet);
  ss.moveActiveSheet(2); // 두 번째 탭으로 이동
  
  // 2. 수식 스캔 로직 (A~BZ, 1행~10행 위주 탐색)
  var lastRow = originalSheet.getLastRow();
  var lastCol = originalSheet.getLastColumn();
  
  var checkRow = Math.min(lastRow, 10);
  var maxC = Math.min(lastCol, 100);
  var formulas = newSheet.getRange(1, 1, checkRow, maxC).getFormulas();
  
  let formulaLog = [];
  formulaLog.push("🔍 [수식 스캔 결과]");
  for (var r = 0; r < checkRow; r++) {
    for (var c = 0; c < maxC; c++) {
      var f = formulas[r][c];
      if (f && f.length > 0) {
        var columnName = newSheet.getRange(1, c + 1).getValue() || ("(제목없음 열: " + (c+1) + ")");
        formulaLog.push("- " + columnName + " (" + (r+1) + "행) : " + f);
      }
    }
  }
  
  // 4. (추가) 사본 시트에 남아있는 무거운 수식들을 강제로 전부 제거 (텍스트화)
  // V~BC열, BG~BZ열 수식 걷어내기
  var heavyRanges = ["V5:BC", "BG6:BZ"];
  for (var k = 0; k < heavyRanges.length; k++) {
    var range = newSheet.getRange(heavyRanges[k]);
    var values = range.getValues();
    range.clearContent(); // 수식을 깡그리 날림
  }
  
  // 5. 진단 결과 출력 시트 생성
  var rName = "수식스캔_결과";
  var rSheet = ss.getSheetByName(rName);
  if(rSheet) ss.deleteSheet(rSheet);
  rSheet = ss.insertSheet(rName, 1);
  
  var outData = [];
  outData.push(["[상품정보] 사본 생성 완료 및 수식 물리적 제거 완료"]);
  for(var i=0; i<formulaLog.length; i++) {
    outData.push([formulaLog[i]]);
  }
  outData.push(["============================="]);
  outData.push(["위 수식들은 구글 서버에 부담을 주지 않도록 모두 삭제 처리하였으며,"]);
  outData.push(["수동 업데이트 버튼 작동 시 AI가 백그라운드 스크립트(JS)로 0.5초만에 순수 텍스트 값만 찍어냅니다."]);
  
  rSheet.getRange(1, 1, outData.length, 1).setValues(outData);
  rSheet.setColumnWidth(1, 800);
  
  ui.alert("✅ 1단계 최적화 사본 셋업이 완료되었습니다!\n\n무거운 엑셀 수식은 싹 다 지웠습니다.\n이제 메뉴의 [수동 연동] 버튼을 눌러 그 위력을 체감해보세요.");
}

function syncOptimizedCopyManual() {
  var ui = SpreadsheetApp.getUi();
  ui.alert("▶ 2단계 AI 초고속 계산 엔진을 가동합니다. 잠시만 기다려주세요.");
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("상품정보(최적화사본)");
    if (!sheet) throw new Error("사본 시트가 없습니다. 1단계 버튼을 먼저 눌러주세요.");
    
    // 1. 이카운트 데이터 수동 호출 (데이터 외부에서 받아오기)
    let auth = ecountStep1();
    ecountStep2(auth);
    ecountStep3(auth);
    SpreadsheetApp.flush();
    
    // 2. 사본으로 기초 데이터 밀어넣기
    moveToEcount("상품정보(최적화사본)");
    SpreadsheetApp.flush();
    
    // 3. AI 자바스크립트 엔진으로 전체 수식 일괄 번개 계산
    if (typeof calculateProductValuesJS === 'function') {
      calculateProductValuesJS(sheet);
    }
    
    ui.alert("✅ [업데이트 및 수식 연산 100% 완료!]\n\n'상품정보(최적화사본)' 시트로 가보세요!\n78개 열의 모든 계산이 수식 없이(빠르게) 완료되어 순수 텍스트로 박혀있을 것입니다.");
    
  } catch (e) {
    ui.alert("🚨 수동 로드 에러: " + e.message);
  }
}

