function fetchSelectedItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = ss.getSheetByName('상품정보');
  
  if (!sourceSheet) {
    SpreadsheetApp.getUi().alert('원본 "상품정보" 시트를 찾을 수 없습니다.');
    return;
  }

  var activeRange = sourceSheet.getActiveRange();
  if (activeRange.getNumRows() < 1) {
    SpreadsheetApp.getUi().alert('⚠️ 이카운트에서 가져올 영역을 드래그해 주세요.');
    return;
  }
  
  var startRow = activeRange.getRow();
  var numRows = activeRange.getNumRows();
  
  // '이카운트코드'가 내용인지 확인 (E열 인덱스 5)
  // getRange(startRow, column, numRows, numColumns)
  var prodCdValues = sourceSheet.getRange(startRow, 5, numRows, 1).getValues();
  var targetProdCds = [];
  
  for (var i = 0; i < prodCdValues.length; i++) {
    var code = String(prodCdValues[i][0]).trim();
    // 빈칸이 아니면서 헤더('이카운트코드')가 아닌 실제 코드 수집
    if (code && code !== '이카운트코드' && targetProdCds.indexOf(code) === -1) {
      targetProdCds.push(code);
    }
  }

  if (targetProdCds.length === 0) {
    SpreadsheetApp.getUi().alert('⚠️ 선택한 영역에서 유효한 "이카운트 품목코드"를 찾을 수 없습니다.\nE열이 포함되게 드래그되었는지 확인해주세요.');
    return;
  }

  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('총 ' + targetProdCds.length + '개의 품목 정보를 안전하게 가져오시겠습니까?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;

  var htmlTemplate = HtmlService.createTemplateFromFile('fetchProgress');
  htmlTemplate.targetCodes = JSON.stringify(targetProdCds);
  var html = htmlTemplate.evaluate().setWidth(450).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, '이카운트 안전 무결성 가져오기 (분할 다운로드)');
}

function initSessionForFetch() {
  try {
    var zone = verifyZoneAPI();
    if (!zone) return { success: false, error: "ZONE 값을 가져오지 못했습니다." };
    var sessionData = login(zone);
    if (!sessionData || !sessionData.Data || !sessionData.Data.Datas) {
      return { success: false, error: "로그인에 실패했습니다." };
    }
    return { success: true, zone: zone, sessionId: sessionData.Data.Datas.SESSION_ID };
  } catch(e) {
    return { success: false, error: String(e) };
  }
}

function processEcountBatch(codesBatch, zone, sessionId) {
  var hubUrl = "https://docs.google.com/spreadsheets/d/1hqNYXOKbSiizNBb0zns46c6hxjin10I2Z5-HjKHgltI/edit#gid=1494958923";
  var hubSs, dbSheet, invSheet;
  try {
    hubSs = SpreadsheetApp.openByUrl(hubUrl);
    dbSheet = hubSs.getSheetByName('이카운트-품목정보');
    invSheet = hubSs.getSheetByName('이카운트-재고');
  } catch (e) {
    return { success: false, error: "허브 파일에 접근할 수 없습니다: " + e.message };
  }
  if (!dbSheet || !invSheet) return { success: false, error: "허브 파일에서 시트를 찾을 수 없습니다." };
  
  // --- 품목정보 세팅 ---
  var dbLastCol = dbSheet.getRange(1, 1).getDataRegion().getLastColumn();
  var dbRequestHeaders = dbSheet.getRange(1, 1, 1, dbLastCol).getValues()[0];
  var dbProdCdHeaderIndex = dbRequestHeaders.indexOf('PROD_CD');
  if (dbProdCdHeaderIndex === -1) dbProdCdHeaderIndex = 0;
  var dbLastRow = dbSheet.getLastRow();
  var dbProdCds = [];
  if (dbLastRow >= 3) {
    var dbRange = dbSheet.getRange(3, dbProdCdHeaderIndex + 1, dbLastRow - 2, 1);
    dbProdCds = dbRange.getValues().map(function(r) { return String(r[0]).trim(); });
  }

  // --- 재고정보 세팅 ---
  var invLastCol = invSheet.getRange(1, 1).getDataRegion().getLastColumn();
  var invRequestHeaders = invSheet.getRange(1, 1, 1, invLastCol).getValues()[0];
  var invProdCdHeaderIndex = invRequestHeaders.indexOf('PROD_CD');
  if (invProdCdHeaderIndex === -1) invProdCdHeaderIndex = 0;
  var invLastRow = invSheet.getLastRow();
  var invProdCds = [];
  if (invLastRow >= 3) {
    var invRange = invSheet.getRange(3, invProdCdHeaderIndex + 1, invLastRow - 2, 1);
    invProdCds = invRange.getValues().map(function(r) { return String(r[0]).trim(); });
  }

  var updatedCount = 0;
  var errorMessages = [];

  for (var k = 0; k < codesBatch.length; k++) {
    var code = codesBatch[k];
    
    // --- 품목 조회 ---
    var safeSessionId = encodeURIComponent(sessionId);
    var pUrl = 'https://oapi' + zone.toUpperCase() + '.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?SESSION_ID=' + safeSessionId;
    var pReq = { "PROD_CD": code };
    var pOpt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(pReq), "headers": { "Accept": "application/json" }, "muteHttpExceptions": true, "followRedirects": false };
    try {
      var pRes = UrlFetchApp.fetch(pUrl, pOpt);
      var rawPText = pRes.getContentText();
      if(pRes.getResponseCode() !== 200) throw new Error("HTTP " + pRes.getResponseCode() + " " + rawPText.substring(0, 50));
      var pData = JSON.parse(rawPText);
      if (pData.Status === "200" && pData.Data && pData.Data.Result) {
        var pList = Array.isArray(pData.Data.Result) ? pData.Data.Result : [pData.Data.Result];
        var matchP = null;
        for (var i=0; i<pList.length; i++) { if(pList[i] && pList[i]["PROD_CD"]===code){ matchP=pList[i]; break;} }
        if(!matchP && pList.length>0) matchP=pList[0];
        
        if (matchP) {
           var newRow = dbRequestHeaders.map(function(h) { return matchP[h]; });
           var rIdx = dbProdCds.indexOf(code);
           if (rIdx !== -1) {
             dbSheet.getRange(rIdx + 3, 1, 1, dbRequestHeaders.length).setValues([newRow]);
           } else {
             dbSheet.appendRow(newRow);
             dbProdCds.push(code); 
           }
           updatedCount++;
        }
      } else {
         errorMessages.push("[" + code + "] 품목오류: " + (pData.Error ? pData.Error.Message : "API 상태 에러"));
      }
    } catch(e) {
      errorMessages.push("[" + code + "] 품목통신 실패: " + e.message);
    }

    // --- 재고 수량 조회 ---
    var iUrl = 'https://oapi' + zone.toUpperCase() + '.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=' + safeSessionId;
    var iReq = { "WH_CD": "100", "BASE_DATE": Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), "ZERO_FLAG": "Y", "PROD_CD": code };
    var iOpt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(iReq), "headers": { "Accept": "application/json" }, "muteHttpExceptions": true, "followRedirects": false };
    try {
      var iRes = UrlFetchApp.fetch(iUrl, iOpt);
      var rawIText = iRes.getContentText();
      if(iRes.getResponseCode() !== 200) throw new Error("HTTP " + iRes.getResponseCode() + " " + rawIText.substring(0, 50));
      var iData = JSON.parse(rawIText);
      if (iData.Status === "200" && iData.Data && iData.Data.Result) {
        var iList = Array.isArray(iData.Data.Result) ? iData.Data.Result : [iData.Data.Result];
        var matchI = null;
        for(var j=0; j<iList.length; j++){ if(iList[j] && iList[j]["PROD_CD"]===code){ matchI=iList[j]; break;} }
        if(!matchI && iList.length>0) matchI=iList[0];
        
        if (matchI) {
           var newIRow = invRequestHeaders.map(function(h) { return matchI[h]; });
           var iIdx = invProdCds.indexOf(code);
           if (iIdx !== -1) {
             invSheet.getRange(iIdx + 3, 1, 1, invRequestHeaders.length).setValues([newIRow]);
           } else {
             invSheet.appendRow(newIRow);
             invProdCds.push(code); 
           }
        }
      } else {
         errorMessages.push("[" + code + "] 재고오류: " + (iData.Error ? iData.Error.Message : "API 상태 에러"));
      }
    } catch(e) {
      errorMessages.push("[" + code + "] 재고통신 실패: " + e.message);
    }
    
    // 이카운트 API 초과 연속 호출 방지 Rate Limit 우회
    Utilities.sleep(500);
  }

  SpreadsheetApp.flush();
  return { success: true, updatedCount: updatedCount, errorMessages: errorMessages };
}

function finishFetchItemProcess() {
  SpreadsheetApp.flush();
  Utilities.sleep(3000); // Wait for flush to complete fully
  try {
    if (typeof moveToEcount === 'function') {
      moveToEcount();
    }
  } catch(e) {
    return "수집 작업 완료! 다만, 후처리(moveToEcount) 실행 중 에러가 발생했습니다: " + e;
  }
  return "완벽하게 수집 및 동기화가 완료되었습니다.";
}