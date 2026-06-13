const fs = require('fs');
let lines = fs.readFileSync('fetchItem.gs', 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('hubSs.getSheetByName')) {
    if (lines[i].includes('목') || lines[i].includes('?목') || lines[i].includes('\ufffd\u00eb\ufffd')) {
       lines[i] = "    dbSheet = hubSs.getSheetByName('\\uC774\\uCE74\\uC6B4\\uD2B8-\\uD488\\uBAA9\\uC815\\uBCF4');"; // 이카운트-품목정보
    } else if (lines[i].includes('고') || lines[i].includes('?고') || lines[i].includes('?')) {
       lines[i] = "    invSheet = hubSs.getSheetByName('\\uC774\\uCE74\\uC6B4\\uD2B8-\\uC7AC\\uACE0');"; // 이카운트-재고
    }
  }
}
fs.writeFileSync('fetchItem.gs', lines.join('\n'), 'utf8');
