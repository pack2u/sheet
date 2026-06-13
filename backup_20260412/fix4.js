const fs = require('fs');
let lines = fs.readFileSync('fetchItem.gs', 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("hubSs.getSheetByName")) {
    if (lines[i].includes("목") || lines[i].includes(Buffer.from([0xbf, 0xe4]).toString('binary'))) {
      lines[i] = "    dbSheet = hubSs.getSheetByName('이카운트-품목정보');";
    } else if (lines[i].includes("고") || lines[i].includes(Buffer.from([0xb0, 0xed]).toString('binary')) || lines[i].includes("?")) {
      // Just unconditionally override the next lines if they match sheet definitions
    }
  }
}
// Actually, let's just forcefully replace line 58, 59, 60 or wherever it is based on content
let startIdx = lines.findIndex(l => l.includes("function processEcountBatch"));
if (startIdx !== -1) {
    let tryIdx = startIdx + 3; // roughly
    for(let j=startIdx; j < startIdx+10; j++){
       if(lines[j].includes("getSheetByName")) {
           lines[j] = ""; // clear them
       }
    }
    // inject right after try {
    let tryLine = lines.findIndex((l, idx) => idx > startIdx && Object.values(l).join('').includes("try {"));
    if (tryLine === -1) tryLine = startIdx + 3;
    
    lines[tryLine] = "  try {\n    hubSs = SpreadsheetApp.openByUrl(hubUrl);\n    dbSheet = hubSs.getSheetByName('이카운트-품목정보');\n    invSheet = hubSs.getSheetByName('이카운트-재고');";
}

fs.writeFileSync('fetchItem.gs', lines.filter(Boolean).join('\n'), 'utf8');
