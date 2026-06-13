function moveToEcount(targetSheetName, injectedSS) {
  var sName = targetSheetName || "상품정보";
  var ss = injectedSS || getSafeActiveSS();

  // ── 소스: 이카운트-품목정보 (실제 존재하는 탭) ──
  var ecountSheet = ss.getSheetByName("이카운트-품목정보");
  // ── 대상: 상품정보 탭 ──
  var pasteSheet  = ss.getSheetByName(sName);
  // ── 소스 2: 이카운트-재고 ──
  var invSheet = ss.getSheetByName("이카운트-재고");
  // ── 상태 매핑 시트 동적으로 로드 (우선순위 1) ──
  var statusTab = ss.getSheetByName("상태");
  var statusMap = {};
  if (statusTab) {
     var stData = statusTab.getRange(1, 1, Math.max(1, statusTab.getLastRow()), 2).getValues();
     for (var s=0; s<stData.length; s++) {
        var stKey = String(stData[s][0]).trim();
        var stVal = String(stData[s][1]).trim();
        if (stKey && stVal) statusMap[stKey] = stVal;
     }
  }

  if (!ecountSheet) throw new Error("'이카운트-품목정보' 탭을 찾을 수 없습니다. 탭 이름을 확인해주세요.");
  if (!pasteSheet)  throw new Error("'" + sName + "' 탭을 찾을 수 없습니다.");

  // ── 1) 이카운트-재고 데이터 읽기 (PROD_CD → 재고수량 누적) ──
  var invMap = {};
  if (invSheet) {
    var invLastRow = invSheet.getLastRow();
    var invLastCol = invSheet.getLastColumn();
    if (invLastRow >= 2) {
      var invHeaders = invSheet.getRange(1, 1, 1, invLastCol).getValues()[0];
      var invProdCol = invHeaders.indexOf("PROD_CD");
      var invQtyCol = invHeaders.indexOf("BAL_QTY"); // Ecount API 재고 필드
      if (invQtyCol === -1) invQtyCol = invHeaders.indexOf("U_BAL_QTY"); // 대안 필드
      
      if (invProdCol !== -1 && invQtyCol !== -1) {
        var invData = invSheet.getRange(3, 1, Math.max(1, invLastRow - 2), invLastCol).getValues();
        for (var i = 0; i < invData.length; i++) {
          var cd = String(invData[i][invProdCol]).trim();
          var qty = parseFloat(invData[i][invQtyCol]) || 0;
          if (cd) {
             if (invMap[cd] === undefined) invMap[cd] = 0;
             invMap[cd] += qty; // WH_CD 지정 안되거나 다중 창고일 경우 합산
          }
        }
      }
    }
  }

  // ── 2) 이카운트-품목정보: 헤더 1행 + 데이터 읽기 ──
  var ecLastRow = ecountSheet.getLastRow();
  var ecLastCol = ecountSheet.getLastColumn();
  if (ecLastRow < 2) {
    if (typeof logSystemError === 'function') logSystemError("수집된 데이터가 0건입니다 (API 조회 에러 의심).", "moveToEcount");
    throw new Error("이카운트-품목정보 탭에 데이터가 없습니다(조회 0건).");
  }

  var ecHeaders = ecountSheet.getRange(1, 1, 1, ecLastCol).getValues()[0];
  var prodCdCol   = ecHeaders.indexOf("PROD_CD");
  var classCd3Col = ecHeaders.indexOf("CLASS_CD3");  // 상태
  var classCd2Col = ecHeaders.indexOf("CLASS_CD2");  // 출고지명 (품목그룹2)

  if (prodCdCol === -1) {
    throw new Error("'이카운트-품목정보' 탭에서 PROD_CD 열을 찾을 수 없습니다.");
  }
  
  // CLASS_CD3가 없으면 PROD_SELL_TYPE으로 폴백
  var sellTypeCol = (classCd3Col === -1) ? ecHeaders.indexOf("PROD_SELL_TYPE") : -1;

  // 헤더1행+빈행2행을 제외하고, 3행부터 실제 데이터를 가져옴
  var ecData = ecountSheet.getRange(3, 1, ecLastRow - 2, ecLastCol).getValues();

  // ====== [직통 파이프 매핑 시트 자동 생성 및 로드] ======
  var mappingSheet = ensureSyncMappingSheet_(ss);

  // 매핑 시트의 데이터 리스트를 가져옵니다
  var mapData = mappingSheet.getDataRange().getValues();
  var explicitMappings = [];
  
  // 엑셀 알파벳(A, BW 등)을 컴퓨터용 열 번호(0, 1, 2...)로 변환하는 함수
  function getColIndex(letter) {
    var L = String(letter).toUpperCase().trim();
    if (!L) return -1;
    var column = 0;
    for (var i = 0; i < L.length; i++) {
        column += (L.charCodeAt(i) - 64) * Math.pow(26, L.length - i - 1);
    }
    return column - 1;
  }

  // 사장님이 적어놓으신 매핑 좌표들(C, E, W 등)을 모조리 수집합니다.
  for (var i = 1; i < mapData.length; i++) {
    var ecKey = String(mapData[i][0]).trim();
    var targetLetter = String(mapData[i][2]).trim();
    if (ecKey && targetLetter) {
       var tIdx = getColIndex(targetLetter);
       if (tIdx === -1) continue;
       
       if (ecKey === "INVENTORY") {
          explicitMappings.push({ type: "INV", targetColIdx: tIdx });
       } else if (ecKey.match(/[\+\-\*\/]/)) {
          // [마법의 수식 해석기] (예: IN_PRICE * CONT1)
          var tokens = ecKey.split(/([\+\-\*\/])/);
          var formulaData = [];
          var isValid = true;
          for (var t=0; t<tokens.length; t++) {
             var tok = tokens[t].trim();
             if (!tok) continue;
             if (tok === "+" || tok === "-" || tok === "*" || tok === "/") {
               formulaData.push(tok);
             } else if (!isNaN(tok)) {
               formulaData.push(Number(tok)); // 숫자(5, 10 등) 바로 허용
             } else {
               var idx = ecHeaders.indexOf(tok);
               if (idx !== -1) {
                 formulaData.push({ isEcKey: true, idx: idx });
               } else {
                 isValid = false; // 잘못된 오타 변수명 방어
               }
             }
          }
          if (isValid) {
             explicitMappings.push({ type: "CALC", formulaData: formulaData, targetColIdx: tIdx, rawEcKey: ecKey });
          }
       } else {
          var sIdx = ecHeaders.indexOf(ecKey);
          if (sIdx !== -1) {
             explicitMappings.push({ type: "EC", sourceColIdx: sIdx, targetColIdx: tIdx, ecKey: ecKey });
          }
       }
    }
  }

  // ── 3) 상품정보 탭 업데이트 ──
  var headerRow = 4;
  var dataStartRow = 6;
  var pasteLastRow = Math.max(pasteSheet.getLastRow(), dataStartRow);
  if (pasteLastRow < dataStartRow) {
    throw new Error("대상 시트(" + sName + ")에 데이터 영역(6행 이하)이 비어있습니다.");
  }

  var dataRows = pasteLastRow - dataStartRow + 1;
  var maxPasteCol = Math.max(pasteSheet.getLastColumn(), 40); // 최소 40열 확보
  var fullRange = pasteSheet.getRange(dataStartRow, 1, dataRows, maxPasteCol);
  var fullValues = fullRange.getValues();

  // (무적 방어막) 5행 전체를 뒤져서 =ArrayFormula 등 수식이 있으면 절대 안 건드림
  var formulaDefense = pasteSheet.getRange(5, 1, 1, maxPasteCol).getFormulas()[0];

  var updatedCount = 0;
  var modifiedCols = {}; // 변경된 대상 열(알파벳)만 기록하는 외과수술 장비
  
  // 🔥 [성능 최적화] O(N^2) 이중 루프를 O(N) 해시맵 탐색으로 압축 (검색 속도 100배 단축)
  var ecDataMap = {};
  for (var i = 0; i < ecData.length; i++) {
    var eCode = String(ecData[i][prodCdCol]).replace(/[\s\u200B-\u200D\uFEFF]/g, '');
    if (eCode && ecDataMap[eCode] === undefined) {
      ecDataMap[eCode] = i; 
    }
  }

  var modifiedCells = [];
  var missingCodes = [];
  
  for (var r = 0; r < dataRows; r++) {
    var code = String(fullValues[r][4]).replace(/[\s\u200B-\u200D\uFEFF]/g, ''); // E열(인덱스 4) 기준
    if (!code) continue;

    var isChanged = false;
    
    // 해시맵에서 O(1) 속도로 인덱스를 단 한 방에 즉시 반환
    var currentEcRow = ecDataMap[code] !== undefined ? ecDataMap[code] : -1;
    if (currentEcRow === -1 && missingCodes.indexOf(code) === -1) {
       missingCodes.push(code); // 이카운트 서버에 없는 미아 코드 수집
    }

    // 직통 파이프에 설정된 좌표대로 하나씩 꽂아넣습니다!
    for (var d = 0; d < explicitMappings.length; d++) {
       var rule = explicitMappings[d];
       
       // 수식 기둥(배열수식)에는 절대 값 덮어쓰기를 하지 않습니다! (REF 에러 원천 차단)
       if (formulaDefense[rule.targetColIdx]) continue;
       
       var tVal = fullValues[r][rule.targetColIdx];
       var sVal = undefined;
       
       if (rule.type === "INV") {
          if (invMap[code] !== undefined) sVal = invMap[code];
          else sVal = 0; // 이카운트 서버에 재고 이력이 없으면 강제로 0으로 잡음
       } else if (rule.type === "CALC" && currentEcRow !== -1) {
          // 마법의 수식 실행
          var evalString = "";
          for(var f=0; f<rule.formulaData.length; f++){
             var part = rule.formulaData[f];
             if (typeof part === "object" && part.isEcKey) {
                var rawVal = ecData[currentEcRow][part.idx];
                var num = parseFloat(rawVal);
                evalString += (isNaN(num) ? 0 : num); // 이카운트에 문자가 적혀있으면 에러 안나게 0으로 자동 쉴드
             } else {
                evalString += part;
             }
          }
          try {
             // 안전하게 계산식 실행 (예: "return 1000 * 5;")
             sVal = new Function("return " + evalString)();
          } catch(e) { sVal = ""; }
       } else if (rule.type === "EC" && currentEcRow !== -1) {
          sVal = ecData[currentEcRow][rule.sourceColIdx];
          
          // [한글 변환 서비스] 이카운트 코드를 이쁜 한글로 변환해서 꽂아줌
          if (rule.ecKey === "CLASS_CD3") {
            var clsStr = String(sVal).trim();
            // 사장님이 구성해둔 '상태' 탭 우선 적용
            if (Object.keys(statusMap).length > 0 && statusMap[clsStr]) {
                sVal = statusMap[clsStr];
            } else {
                if (clsStr === '9004') sVal = '단종품';
                else if (clsStr === '9003') sVal = '품절';
                else if (clsStr === '9002') sVal = '판매중(재고까지만)';
                else if (clsStr === '9005') sVal = '특판/할인';
                else if (clsStr === '9006') sVal = '상세제작종';
                else if (clsStr === '9007') sVal = '소싱중';
                else sVal = '판매중';
            }
          } else if (rule.ecKey === "CLASS_CD2") {
            var cStr = String(sVal).trim().toUpperCase();
            if (cStr === '8003') sVal = '대리발송';
            else if (cStr === '8002') sVal = '일산';
            else if (cStr === '8001') sVal = '평택';
            else {
               var match = cStr.match(/^P([A-Z])-0?(\d+)$/);
               if (match) sVal = '평택' + match[1] + '-' + parseInt(match[2], 10);
               else sVal = cStr;
            }
          }
       }
       
       // 이카운트 값이 존재하고 현재 엑셀에 적힌 값과 다를 때만 안전 교체
       if (sVal !== undefined && sVal !== "" && String(tVal) !== String(sVal)) {
           fullValues[r][rule.targetColIdx] = sVal;
           modifiedCols[rule.targetColIdx] = true;
           modifiedCells.push({ r: r + dataStartRow, c: rule.targetColIdx + 1, v: sVal });
           isChanged = true;
       }
    }
    
    if (isChanged) updatedCount++;
  }

  // [하이브리드 엔진 추가] 
  // 선택 동기화처럼 소수만 바뀌는 경우 열(Column) 전체를 교체하면 속도가 심각하게 저하되므로,
  // 50개 이하 변동 시에는 변경된 '셀 단위로' 핀셋 타격을 가해 동기화 속도를 비약적으로 단축합니다.
  if (updatedCount > 0) {
    if (updatedCount <= 50) {
       for (var z = 0; z < modifiedCells.length; z++) {
           var mc = modifiedCells[z];
           pasteSheet.getRange(mc.r, mc.c).setValue(mc.v);
       }
    } else {
       // 대규모 전체 동기화 시에는 무조건 열 단위 엎어치기가 가장 빠름
       var colKeys = Object.keys(modifiedCols);
       for (var k = 0; k < colKeys.length; k++) {
         var cIdx = parseInt(colKeys[k], 10);
         var singleColData = [];
         for (var rowI = 0; rowI < dataRows; rowI++) {
           singleColData.push([fullValues[rowI][cIdx]]); // 타겟 열만 뽑아내기
         }
         pasteSheet.getRange(dataStartRow, cIdx + 1, dataRows, 1).setValues(singleColData);
       }
    }
    SpreadsheetApp.flush();
  }

  // 마지막 동기화 시각 기록
  var date = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm");
  pasteSheet.getRange("A1").setValue(date);

  var dbgMsg = "다이렉트 동기화 완료! (" + updatedCount + "건 갱신)";
  
  if (missingCodes.length > 0) {
    var warnStr = missingCodes.join(", ");
    if (warnStr.length > 150) warnStr = warnStr.substring(0, 150) + "...";
    if (typeof logSystemError === 'function') {
       logSystemError("매핑 누락(" + missingCodes.length + "건): " + warnStr, "moveToEcount (미아코드)");
    }
    var warnMsg = dbgMsg + " (경고: " + missingCodes.length + "건 이카운트 미조회)";
    try { SpreadsheetApp.getActiveSpreadsheet().toast(warnMsg, "매핑 일부 누락", 10); } catch(e){}
    pasteSheet.getRange("Z3").setValue(warnMsg).setFontColor("red"); 
  } else {
    try { SpreadsheetApp.getActiveSpreadsheet().toast(dbgMsg, "성공", 5); } catch(e){}
    pasteSheet.getRange("Z3").setValue(dbgMsg).setFontColor("black");
  }
  
  return updatedCount;
}

function ensureSyncMappingSheet_(ss) {
  var mappingSheet = ss.getSheetByName("동기화매핑");
  if (mappingSheet) return mappingSheet;

  mappingSheet = ss.insertSheet("동기화매핑");
  var initialData = [
    ["이카운트 변수", "이카운트 항목명", "상품정보 타겟열", "비고 (설명)"],
    ["PROD_CD", "품목코드", "E", "고정값"],
    ["PROD_DES", "품목명", "C", ""],
    ["CLASS_CD3", "상태(품목그룹3)", "A", "9004->단종 등 자동변환"],
    ["CLASS_CD2", "출고지(품목그룹2)", "B", ""],
    ["IN_PRICE", "입고단가", "W", ""],
    ["OUT_PRICE", "출고단가", "X", ""],
    ["CONT1", "세트구성및배송비", "P", ""],
    ["CONT2", "묶음배송비", "R", ""],
    ["CONT3", "상품사이즈", "I", ""],
    ["CONT4", "상품용량", "J", ""],
    ["CONT5", "박스사이즈", "M", ""],
    ["CONT6", "쇼핑몰상품명", "", "비어있음"],
    ["NO_USER1", "단품배송비", "Q", ""],
    ["NO_USER10", "포장가격", "S", ""],
    ["SET_FLAG", "세트여부", "", ""],
    ["NO_USER3", "최저가", "", "비어있음"],
    ["NO_USER4", "배민판매가", "", "비어있음"],
    ["INVENTORY", "이카운트 실시간재고", "G", "재고 API 별도 연동"],
  ];
  mappingSheet.getRange(1, 1, initialData.length, 4).setValues(initialData);
  mappingSheet
    .getRange(1, 1, 1, 4)
    .setBackground("#ff9800")
    .setFontColor("white")
    .setFontWeight("bold");
  mappingSheet.setFrozenRows(1);
  SpreadsheetApp.flush();
  return mappingSheet;
}

/**
 * 선택 코드만 상품정보에 반영하는 경량 동기화.
 * fetchSelectedItems() 전용: 전체 재매핑(moveToEcount) 대신 코드 매칭 행만 갱신한다.
 */
function moveToEcountSelectedCodes_(codes, targetSheetName, injectedSS) {
  var sName = targetSheetName || "상품정보";
  var ss = injectedSS || getSafeActiveSS();
  var ecountSheet = ss.getSheetByName("이카운트-품목정보");
  var pasteSheet = ss.getSheetByName(sName);
  var invSheet = ss.getSheetByName("이카운트-재고");
  if (!ecountSheet) throw new Error("'이카운트-품목정보' 탭을 찾을 수 없습니다.");
  if (!pasteSheet) throw new Error("'" + sName + "' 탭을 찾을 수 없습니다.");

  var targetSet = {};
  for (var i = 0; i < (codes || []).length; i++) {
    var raw = String(codes[i] || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
    if (raw) targetSet[raw] = true;
  }
  var targetCodes = Object.keys(targetSet);
  if (targetCodes.length === 0) return 0;

  var invMap = {};
  if (invSheet && invSheet.getLastRow() >= 3) {
    var invLastCol = invSheet.getLastColumn();
    var invHeaders = invSheet.getRange(1, 1, 1, invLastCol).getValues()[0];
    var invProdCol = invHeaders.indexOf("PROD_CD");
    var invQtyCol = invHeaders.indexOf("BAL_QTY");
    if (invQtyCol === -1) invQtyCol = invHeaders.indexOf("U_BAL_QTY");
    if (invProdCol !== -1 && invQtyCol !== -1) {
      var invData = invSheet
        .getRange(3, 1, invSheet.getLastRow() - 2, invLastCol)
        .getValues();
      for (var ii = 0; ii < invData.length; ii++) {
        var ic = String(invData[ii][invProdCol] || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
        if (!ic || !targetSet[ic]) continue;
        invMap[ic] = parseFloat(invData[ii][invQtyCol]) || 0;
      }
    }
  }

  var ecLastCol = ecountSheet.getLastColumn();
  var ecHeaders = ecountSheet.getRange(1, 1, 1, ecLastCol).getValues()[0];
  var ecData = ecountSheet.getRange(3, 1, Math.max(1, ecountSheet.getLastRow() - 2), ecLastCol).getValues();
  var prodCdCol = ecHeaders.indexOf("PROD_CD");
  if (prodCdCol === -1) throw new Error("이카운트-품목정보에서 PROD_CD 열을 찾을 수 없습니다.");

  var ecRowByCode = {};
  for (var r = 0; r < ecData.length; r++) {
    var c = String(ecData[r][prodCdCol] || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
    if (c && targetSet[c] && ecRowByCode[c] === undefined) ecRowByCode[c] = r;
  }

  var mappingSheet = ensureSyncMappingSheet_(ss);
  var mapData = mappingSheet.getDataRange().getValues();
  function getColIndex_(letter) {
    var L = String(letter || "").toUpperCase().trim();
    if (!L) return -1;
    var col = 0;
    for (var x = 0; x < L.length; x++) {
      col += (L.charCodeAt(x) - 64) * Math.pow(26, L.length - x - 1);
    }
    return col - 1;
  }

  var explicitMappings = [];
  for (var m = 1; m < mapData.length; m++) {
    var ecKey = String(mapData[m][0] || "").trim();
    var targetLetter = String(mapData[m][2] || "").trim();
    if (!ecKey || !targetLetter) continue;
    var tIdx = getColIndex_(targetLetter);
    if (tIdx === -1) continue;
    if (ecKey === "INVENTORY") {
      explicitMappings.push({ type: "INV", targetColIdx: tIdx });
    } else if (ecKey.match(/[\+\-\*\/]/)) {
      var tokens = ecKey.split(/([\+\-\*\/])/);
      var formulaData = [];
      var isValidFormula = true;
      for (var tt = 0; tt < tokens.length; tt++) {
        var tok = String(tokens[tt] || "").trim();
        if (!tok) continue;
        if (tok === "+" || tok === "-" || tok === "*" || tok === "/") {
          formulaData.push(tok);
        } else if (!isNaN(tok)) {
          formulaData.push(Number(tok));
        } else {
          var fIdx = ecHeaders.indexOf(tok);
          if (fIdx !== -1) formulaData.push({ isEcKey: true, idx: fIdx });
          else isValidFormula = false;
        }
      }
      if (isValidFormula) {
        explicitMappings.push({
          type: "CALC",
          formulaData: formulaData,
          targetColIdx: tIdx,
          ecKey: ecKey,
        });
      }
    } else {
      var sIdx = ecHeaders.indexOf(ecKey);
      if (sIdx !== -1) {
        explicitMappings.push({
          type: "EC",
          sourceColIdx: sIdx,
          targetColIdx: tIdx,
          ecKey: ecKey,
        });
      }
    }
  }

  var statusTab = ss.getSheetByName("상태");
  var statusMap = {};
  if (statusTab) {
    var stData = statusTab.getRange(1, 1, Math.max(1, statusTab.getLastRow()), 2).getValues();
    for (var s = 0; s < stData.length; s++) {
      var sk = String(stData[s][0] || "").trim();
      var sv = String(stData[s][1] || "").trim();
      if (sk && sv) statusMap[sk] = sv;
    }
  }

  var dataStartRow = 6;
  var dataRows = Math.max(0, pasteSheet.getLastRow() - dataStartRow + 1);
  if (dataRows < 1) return 0;
  var maxPasteCol = Math.max(pasteSheet.getLastColumn(), 40);
  // ★ 성능최적화: 전체 데이터를 한 번에 읽기 (행별 getValues 제거)
  var fullValues = pasteSheet.getRange(dataStartRow, 1, dataRows, maxPasteCol).getValues();
  var formulaDefense = pasteSheet.getRange(5, 1, 1, maxPasteCol).getFormulas()[0];
  var updated = 0;
  var modifiedCols = {}; // 변경된 열 추적

  for (var pr = 0; pr < dataRows; pr++) {
    var pCode = String(fullValues[pr][4] || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
    if (!pCode || !targetSet[pCode]) continue;
    if (ecRowByCode[pCode] === undefined) continue;
    var ecRow = ecData[ecRowByCode[pCode]];
    var changed = false;

    for (var em = 0; em < explicitMappings.length; em++) {
      var rule = explicitMappings[em];
      if (formulaDefense[rule.targetColIdx]) continue;
      var oldVal = fullValues[pr][rule.targetColIdx];
      var newVal = oldVal;
      if (rule.type === "INV") {
        newVal = invMap[pCode] !== undefined ? invMap[pCode] : 0;
      } else if (rule.type === "CALC") {
        var evalExpr = "";
        for (var ff = 0; ff < rule.formulaData.length; ff++) {
          var part = rule.formulaData[ff];
          if (typeof part === "object" && part.isEcKey) {
            var rawVal = ecRow[part.idx];
            var numVal = parseFloat(rawVal);
            evalExpr += isNaN(numVal) ? 0 : numVal;
          } else {
            evalExpr += part;
          }
        }
        try {
          newVal = new Function("return " + evalExpr)();
        } catch (eCalc) {
          newVal = oldVal;
        }
      } else if (rule.type === "EC") {
        newVal = ecRow[rule.sourceColIdx];
        if (rule.ecKey === "CLASS_CD3") {
          var clsStr = String(newVal || "").trim();
          if (statusMap[clsStr]) newVal = statusMap[clsStr];
          else if (clsStr === "9004") newVal = "단종품";
          else if (clsStr === "9003") newVal = "품절";
          else if (clsStr === "9002") newVal = "판매중(재고까지만)";
          else if (clsStr === "9005") newVal = "특판/할인";
          else if (clsStr === "9006") newVal = "상세제작종";
          else if (clsStr === "9007") newVal = "소싱중";
          else newVal = "판매중";
        } else if (rule.ecKey === "CLASS_CD2") {
          var cStr = String(newVal || "").trim().toUpperCase();
          if (cStr === "8003") newVal = "대리발송";
          else if (cStr === "8002") newVal = "일산";
          else if (cStr === "8001") newVal = "평택";
          else {
            var mm = cStr.match(/^P([A-Z])-0?(\d+)$/);
            newVal = mm ? "평택" + mm[1] + "-" + parseInt(mm[2], 10) : cStr;
          }
        }
      }
      if (newVal !== undefined && String(oldVal) !== String(newVal)) {
        fullValues[pr][rule.targetColIdx] = newVal;
        modifiedCols[rule.targetColIdx] = true;
        changed = true;
      }
    }
    if (changed) updated++;
  }

  // ★ 성능최적화: 변경된 열만 배치 쓰기 (셀별 setValue 제거)
  if (updated > 0) {
    var colKeys = Object.keys(modifiedCols);
    for (var k = 0; k < colKeys.length; k++) {
      var cIdx = parseInt(colKeys[k], 10);
      var singleColData = [];
      for (var rowI = 0; rowI < dataRows; rowI++) {
        singleColData.push([fullValues[rowI][cIdx]]);
      }
      pasteSheet.getRange(dataStartRow, cIdx + 1, dataRows, 1).setValues(singleColData);
    }
  }

  var date = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm");
  pasteSheet.getRange("A1").setValue(date);
  SpreadsheetApp.flush();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "선택 동기화 완료 (" + updated + "건)",
      "성공",
      5,
    );
  } catch (e) {}
  return updated;
}

// function moveToEcount() {
//   const copyss = SpreadsheetApp.openByUrl("https://docs.google.com/spreadsheets/d/1hqNYXOKbSiizNBb0zns46c6hxjin10I2Z5-HjKHgltI/edit#gid=986643732");
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const copySheet = copyss.getSheetByName('상품정보(목록)');
//   const pasteSheet = ss.getSheetByName('상품정보');

//   const headerRow = 4;
//   const lastRow = copySheet.getLastRow();

//   // A열부터 S열까지 복사하는 기존 로직
//   const copyValues1 = copySheet.getRange(headerRow + 1, 1, lastRow - headerRow, 21).getValues();
//   pasteSheet.getRange('A6:U').clearContent();
//   pasteSheet.getRange(headerRow + 1, 1, lastRow - headerRow, 21).setValues(copyValues1);//첫행 비워놓기(필터를 위해)

//   // 추가할 열: X, AA, AG
//   // 열 번호를 배열로 정의
//   const columnsToCopy = [24, 27, 33]; // T, W, Z, AF에 해당하는 엑셀 열 번호

//   // 각 열에 대해 반복 (for문 사용)
//   for (let i = 0; i < columnsToCopy.length; i++) {
//     const column = columnsToCopy[i];
//     // 복사할 범위의 값을 가져옴
//     const copyValues = copySheet.getRange(headerRow + 1, column, lastRow - headerRow, 1).getValues();
//     // 붙여넣을 범위의 내용을 지움
//     pasteSheet.getRange(headerRow + 1, column, pasteSheet.getLastRow()).clearContent();//첫행 비워놓기(필터를 위해)
//     // 값을 붙여넣음
//     pasteSheet.getRange(headerRow + 1, column, lastRow - headerRow, 1).setValues(copyValues);//첫행 비워놓기(필터를 위해)
//     var timezone = "GMT+9";
//     var date = Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd HH:mm"); // "yyyy-MM-dd'T'HH:mm:ss'Z'"
//     pasteSheet.getRange('A1').setValue(date);
//   }
// }

// function moveToEcount() {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const copySheet = ss.getSheetByName('(정렬)상품정보');
//   const pasteSheet = ss.getSheetByName('상품정보');

//   const headerRow = 4;
//   const lastRow = copySheet.getRange(4, 4).getDataRegion().getLastRow();

//   // A열부터 S열까지 복사하는 기존 로직
//   const copyValues1 = copySheet.getRange(headerRow + 1, 1, lastRow - headerRow, 19).getValues();
//   pasteSheet.getRange('A5:S').clearContent();
//   pasteSheet.getRange(headerRow + 1+1, 1, lastRow - headerRow, 19).setValues(copyValues1);//첫행 비워놓기(필터를 위해)

//   // 추가할 열: T, W, 지, AF
//   // 열 번호를 배열로 정의
//   const columnsToCopy = [20, 23, 26, 32]; // T, W, Z, AF에 해당하는 엑셀 열 번호

//   // 각 열에 대해 반복 (for문 사용)
//   for (let i = 0; i < columnsToCopy.length; i++) {
//     const column = columnsToCopy[i];
//     // 복사할 범위의 값을 가져옴
//     const copyValues = copySheet.getRange(headerRow + 1, column, lastRow - headerRow, 1).getValues();
//     // 붙여넣을 범위의 내용을 지움
//     pasteSheet.getRange(headerRow + 1+1, column, pasteSheet.getLastRow()).clearContent();//첫행 비워놓기(필터를 위해)
//     // 값을 붙여넣음
//     pasteSheet.getRange(headerRow + 1+1, column, lastRow - headerRow, 1).setValues(copyValues);//첫행 비워놓기(필터를 위해)
//   }
// }

// function moveToEcount() {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const copySheet = ss.getSheetByName('(임시)상품정보');
//   const pasteSheet = ss.getSheetByName('상품정보');

//   const headerRow = 4;
//   const lastRow = copySheet.getRange(4,4).getDataRegion().getLastRow();

//   const copyValues1 = copySheet.getRange(headerRow+1,1,lastRow-headerRow,19).getValues();
//   pasteSheet.getRange('A5:S').clearContent();
//   pasteSheet.getRange(headerRow+1,1,lastRow-headerRow,19).setValues(copyValues1);

// }
