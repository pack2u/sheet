const fs = require('fs');

try {
  let text = fs.readFileSync('fetchItem.gs', 'utf8');
  
  // Replace the corrupted lines with English regex to avoid encoding match issues
  text = text.replace(/dbSheet = hubSs\.getSheetByName\([^;]+;/g, "dbSheet = hubSs.getSheetByName('이카운트-품목정보');");
  text = text.replace(/invSheet = hubSs\.getSheetByName\([^;]+;/g, "invSheet = hubSs.getSheetByName('이카운트-재고');");
  text = text.replace(/try \{(?:\r?\n.*?)*dbSheet/m, "try {\n    hubSs = SpreadsheetApp.openByUrl(hubUrl);\n    dbSheet");
  text = text.replace(/error: "\?.*?\?.*?: "/g, "error: \"허브 파일에 접근할 수 없습니다: \"");
  text = text.replace(/error: "\?.*?\?.*?\."/g, "error: \"허브 파일에서 시트를 찾을 수 없습니다.\"");

  fs.writeFileSync('fetchItem.gs', text, 'utf8');
  console.log("Fix successful.");
} catch (e) {
  console.error(e);
}
