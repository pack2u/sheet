function runSystemAnalyzer() {
  var ui = SpreadsheetApp.getUi();
  ui.alert("진단을 시작합니다. 데이터 양에 따라 약 10~30초 정도 소요될 수 있습니다.");
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var report = [];
  
  report.push(["🤖 AI 구조 파악용 - 시스템 통합 진단 리포트"]);
  report.push(["분석일시: " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss")]);
  report.push(["설명: 이 문서의 텍스트를 전부 복사하여 AI(ChatGPT 등)에게 건네주면, 현재 회사 구글 스프레드시트의 전체 구조와 데이터 흐름을 완벽히 이해합니다."]);
  report.push(["=============================================================="]);
  report.push([""]);
  
  var externalLinks = [];
  
  // 1. 현재 팡리(마스터 허브) 구조 스캔
  report.push(["[1] 현재 메인 파일 구조 분석"]);
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var sName = sheet.getName();
    if (sName.indexOf("진단 리포트") !== -1) continue;
    
    report.push(["▶ 시트명: " + sName]);
    
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    
    if (lastRow === 0 || lastCol === 0) {
      report.push(["  (데이터가 없는 빈 시트입니다)"]);
      report.push([""]);
      continue;
    }
    
    // 1~3행 헤더 추출 (최대 30열까지만 요약)
    var maxC = Math.min(lastCol, 30);
    var maxR = Math.min(lastRow, 3);
    var headData = sheet.getRange(1, 1, maxR, maxC).getValues();
    
    // 제목(헤더) 요약
    var cols = [];
    for(var c=0; c<maxC; c++) {
      var val = headData[0][c] || (maxR>1?headData[1][c]:"") || (maxR>2?headData[2][c]:"") || "";
      if (val !== "") {
        // 엔터 제거 및 짧게 자르기
        var cleanVal = String(val).replace(/\n/g, ' ').replace(/\r/g, '').trim().substring(0, 30);
        cols.push(cleanVal);
      }
    }
    report.push(["  - 전체 규모: 약 " + lastRow + "행 / " + lastCol + "열"]);
    report.push(["  - 핵심 컬럼명: " + cols.join(", ") + (lastCol > 30 ? " ... (외 다수)" : "")]);
    
    // 외부 링크(IMPORTRANGE) 스캔 (수식이 많은 경우를 대비해 상위 500행만 검사)
    var checkRow = Math.min(lastRow, 500);
    var formulas = sheet.getRange(1, 1, checkRow, maxC).getFormulas();
    var foundLinks = {};
    for (var r = 0; r < checkRow; r++) {
      for (var c = 0; c < maxC; c++) {
        var f = formulas[r][c];
        if (f && f.toUpperCase().indexOf("IMPORTRANGE") !== -1) {
          var match = f.match(/IMPORTRANGE\s*\(\s*["']([^"']+)["']/i);
          if (match && match[1]) {
            var url = match[1];
            foundLinks[url] = true;
          }
        }
      }
    }
    
    var linksKeys = Object.keys(foundLinks);
    if (linksKeys.length > 0) {
      report.push(["  🔗 [외부 파일 참조] 데이터를 끌어오는 핏줄 링크들:"]);
      for(var k=0; k<linksKeys.length; k++) {
        report.push(["     -> " + linksKeys[k]]);
        if (externalLinks.indexOf(linksKeys[k]) === -1) externalLinks.push(linksKeys[k]);
      }
    } else {
      report.push(["  - 외부 링크 참조 없음 (독립된 흩어짐 없는 데이터)"]);
    }
    
    report.push([""]);
  }
  
  // 2. 같은 폴더 내 연결된 배포 뷰어 시트들 스캔
  report.push(["=============================================================="]);
  report.push(["[2] 팩투유 드라이브(서버 폴더) 내 다른 연결 파일들 탐색"]);
  try {
    var TARGET_FOLDER_ID = "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl"; 
    var folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    var fileCount = 0;
    while(files.hasNext()) {
      var file = files.next();
      if (file.getId() === ss.getId()) continue; // 현재 파일 제외
      report.push(["  - 연결된 뷰어 파일: " + file.getName() + " (ID: " + file.getId() + ")"]);
      fileCount++;
    }
    report.push(["  => 총 " + fileCount + "개의 배포용 또는 연계용 스프레드시트 존재 확인"]);
  } catch(e) {
    report.push(["  (드라이브 폴더 접근 권한이 없거나 찾을 수 없어 건너뜁니다.)"]);
  }
  
  // 3. 리포트 시트 생성 및 기록
  var rName = "🔍 시스템 진단 리포트 (AI입력용)";
  var rSheet = ss.getSheetByName(rName);
  if (rSheet) {
    ss.deleteSheet(rSheet);
  }
  rSheet = ss.insertSheet(rName, 0); // 가장 첫 번째 탭으로 배치
  
  // 배열을 세로 데이터로 변환
  var outData = [];
  for(var i=0; i<report.length; i++) {
    outData.push([report[i][0] || ""]);
  }
  
  rSheet.getRange(1, 1, outData.length, 1).setValues(outData);
  rSheet.setColumnWidth(1, 1000); // 가로 넓게
  
  // 타이틀 등 간단한 서식 지정
  rSheet.getRange("A1").setFontSize(14).setFontWeight("bold").setBackground("#d4edda");
  rSheet.getRange("A4").setBackground("#333333").setFontColor("white");
  var midPoint = report.indexOf("==============================================================");
  if(midPoint > 4) {
      rSheet.getRange("A" + (midPoint+1)).setBackground("#333333").setFontColor("white");
  }
  
  ui.alert("✅ [스캔 완료]\n\n엑셀 하단 탭을 보시면 첫 번째 위치에 [🔍 시스템 진단 리포트 (AI입력용)] 시트가 생성되었습니다.\n\n해당 시트에 적힌 텍스트를 쭉 드래그 복사해서 AI 대화창에 넣으시면 전체 구조 설명이 1초 만에 끝납니다.");
}
