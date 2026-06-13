let userId = 'PACK2U';
let apiCertKey = '4217bd7835e2f42db8e15f890e5aae0024';
let lanType = 'ko-KR';
let comCode = '176341';

function showEcountSyncModal() {
  var html = HtmlService.createHtmlOutputFromFile('ecount_sync_modal')
      .setWidth(500)
      .setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, '이카운트 자동 동기화 팝업');
}

// ============================================
// 단계별 동기화 함수 (UI 차단 방지를 위한 분할)
// ============================================

function ecountStep1() {
  let zone = verifyZoneAPI();
  let sessionData = login(zone);
  
  if (sessionData && sessionData.Data && sessionData.Data.Datas && sessionData.Data.Datas.SESSION_ID) {
    let rawSessionId = sessionData.Data.Datas.SESSION_ID;
    return { zone: zone, sessionId: encodeURIComponent(rawSessionId) };
  } else {
    throw new Error('로그인 실패 (키 만료 또는 IP 권한)');
  }
}

function ecountStep2(auth) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let url = `https://oapi${auth.zone}.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?SESSION_ID=${auth.sessionId}`;
  let requestData = { "PROD_CD": "" };
  let options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(requestData),
    "headers": { "Accept": "application/json" },
    "muteHttpExceptions": true
  };
  
  let response = UrlFetchApp.fetch(url, options);
  let rawText = response.getContentText();
  let responseData;
  try {
    responseData = JSON.parse(rawText);
  } catch(e) {
    throw new Error("품목 파싱 오류 (서버 원문: " + rawText.substring(0, 100) + "...)");
  }

  if (responseData.Status === "200") {
    let productList = responseData.Data.Result;
    var sheet = spreadsheet.getSheetByName('이카운트-품목정보');
    if(!sheet) throw new Error("'이카운트-품목정보' 시트를 찾을 수 없습니다.");
    
    var lastCol = sheet.getRange(1,1).getDataRegion().getLastColumn();
    var requestHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    if (sheet.getLastRow() > 2) {
      sheet.deleteRows(3, sheet.getLastRow() - 2); 
    }

    var rows = productList.map(product => {
      return requestHeaders.map(header => product[header]);
    });

    if (rows.length > 0) {
      const chunkSize = 1000;
      for (let i = 0; i < rows.length; i += chunkSize) {
        let chunk = rows.slice(i, i + chunkSize);
        sheet.getRange(3 + i, 1, chunk.length, requestHeaders.length).setValues(chunk);
        SpreadsheetApp.flush();
      }
    }
    return true;
  } else {
    throw new Error('품목 정보 오류:\n' + JSON.stringify(responseData.Error));
  }
}

function ecountStep3(auth) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let url = `https://oapi${auth.zone}.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=${auth.sessionId}`;
  let requestData = {
    "WH_CD": "100",
    "BASE_DATE" : ""+Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd")+"",
    "ZERO_FLAG" : "Y"
  };
  let options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(requestData),
    "headers": { "Accept": "application/json" },
    "muteHttpExceptions": true
  };

  let response = UrlFetchApp.fetch(url, options);
  let rawText = response.getContentText();
  let responseData;
  try {
    responseData = JSON.parse(rawText);
  } catch(e) {
    throw new Error("재고 파싱 오류 (서버 원문: " + rawText.substring(0, 100) + "...)");
  }

  if (responseData.Status === "200") {
    let productList = responseData.Data.Result;
    var sheet = spreadsheet.getSheetByName('이카운트-재고');
    if(!sheet) throw new Error("'이카운트-재고' 시트를 찾을 수 없습니다.");
    
    var lastCol = sheet.getRange(1,1).getDataRegion().getLastColumn();
    var requestHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    if (sheet.getLastRow() > 2) {
      sheet.deleteRows(3, sheet.getLastRow() - 2);
    }
    
    var rows = productList.map(product => {
      return requestHeaders.map(header => product[header]);
    });
    
    if (rows.length > 0) {
      const chunkSize = 1000;
      for (let i = 0; i < rows.length; i += chunkSize) {
        let chunk = rows.slice(i, i + chunkSize);
        sheet.getRange(3 + i, 1, chunk.length, requestHeaders.length).setValues(chunk);
        SpreadsheetApp.flush();
      }
    }
    return true;
  } else {
    throw new Error('재고 정보 오류:\n' + JSON.stringify(responseData.Error));
  }
}

function ecountStep4() {
  if (typeof moveToEcount === 'function') {
    moveToEcount();
  }
  return true;
}

// ============================================
// 내부 통신 및 로우레벨 함수 모음
// ============================================

function verifyZoneAPI() {
  let url = 'https://oapi.ecount.com/OAPI/V2/Zone'; 
  let requestData = { "COM_CODE": comCode };
  let options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(requestData),
    "headers": { "Accept": "application/json" },
    "muteHttpExceptions": true
  };
  let response = UrlFetchApp.fetch(url, options);
  let rawText = response.getContentText();
  let responseData;
  try {
    responseData = JSON.parse(rawText);
  } catch(e) {
    throw new Error("verifyZoneAPI 오류");
  }
  let zone = responseData.Data.ZONE;
  return zone;
}

function login(zone) {
  let url = `https://oapi${zone}.ecount.com/OAPI/V2/OAPILogin`;
  let requestData = {
    "COM_CODE": comCode,
    "USER_ID": userId,
    "ZONE": zone,
    "API_CERT_KEY": apiCertKey,
    "LAN_TYPE": lanType
  };
  let options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(requestData),
    "headers": { "Accept": "application/json" },
    "muteHttpExceptions": true
  };
  let response = UrlFetchApp.fetch(url, options);
  let rawText = response.getContentText();
  let responseData;
  try {
    responseData = JSON.parse(rawText);
  } catch(e) {
    throw new Error("login 파싱 오류");
  }
  return responseData;
}

function getEcountAll(){
  // 하위 호환성 유지 
  showEcountSyncModal();
}

// ============================================
// 시간 기반 자동 트리거 (매일 스케줄링) - 2분할 안전버전
// ============================================
function setupDailyTrigger() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch(e) {}
  
  removeDailyTrigger(true); // 중복 방지 (무음 처리)
  
  // 1. 이카운트 로드 (새벽 4시)
  ScriptApp.newTrigger('runDailyEcountBatch')
           .timeBased()
           .everyDays(1)
           .atHour(4)
           .create();
           
  // 2. 통합 허브 동기화 (오전 6시)
  ScriptApp.newTrigger('runDailyHubBatch')
           .timeBased()
           .everyDays(1)
           .atHour(6)
           .create();
           
  if (ui) ui.alert("⏰ [예약 완료]\n\n매일 새벽 4시: 이카운트 데이터 스캔 및 시트 갱신\n매일 오전 6시: 최신화된 데이터 기반 '통합허브' 단가 동기화\n\n두 작업이 2시간 간격을 두고 구글 서버 부담 없이 가장 안전하게 실행되도록 분리 예약되었습니다.");
}

function removeDailyTrigger(isSilent) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'runDailyEcountBatch' || fn === 'runDailyHubBatch' || fn === 'runDailyAutoBatch') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  if (!isSilent) {
    var ui = null;
    try { ui = SpreadsheetApp.getUi(); } catch(e) {}
    if (ui) ui.alert("의도적으로 모든 자동 예약 스케줄을 껐습니다.");
  }
}

// 1차 자동화: 이카운트 순수 데이터 로드 (새벽 4시)
function runDailyEcountBatch() {
  try {
    let auth = ecountStep1();
    ecountStep2(auth);
    ecountStep3(auth);
    SpreadsheetApp.flush();
    
    // 외부 수식 대기 후 본부로 복사
    Utilities.sleep(10000); 
    ecountStep4(); 
    SpreadsheetApp.flush();
  } catch (e) {
    console.error("이카운트 새벽배치 에러: " + e.message);
  }
}

// 2차 자동화: 허브 서버 최종 정렬 (오전 6시)
function runDailyHubBatch() {
  try {
    if (typeof syncStatusOnly === 'function') {
      syncStatusOnly(true); 
    }
  } catch (e) {
    console.error("허브 아침배치 에러: " + e.message);
  }
}
