const fs = require('fs');
let lines = fs.readFileSync('fetchItem.gs', 'utf8').split('\n');
lines[64] = "    dbSheet = hubSs.getSheetByName('이카운트-품목정보');";
lines[65] = "    invSheet = hubSs.getSheetByName('이카운트-재고');";
fs.writeFileSync('fetchItem.gs', lines.join('\n'), 'utf8');
