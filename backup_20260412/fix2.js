const fs = require('fs');
let code = fs.readFileSync('fetchItem.gs', 'utf8');
code = code.replace(/dbSheet\s*=\s*hubSs\.getSheetByName\([^)]+\);/g, "dbSheet = hubSs.getSheetByName('이카운트-품목정보');");
code = code.replace(/invSheet\s*=\s*hubSs\.getSheetByName\([^)]+\);/g, "invSheet = hubSs.getSheetByName('이카운트-재고');");
code = code.replace(/try\s*\{\s*dbSheet =/, "try {\n    hubSs = SpreadsheetApp.openByUrl(hubUrl);\n    dbSheet =");
fs.writeFileSync('fetchItem.gs', code, 'utf8');
