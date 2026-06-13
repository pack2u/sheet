const ECOUNT_PROP_USER_ID = "ECOUNT_USER_ID";
const ECOUNT_PROP_API_CERT_KEY = "ECOUNT_API_CERT_KEY";
const ECOUNT_PROP_COM_CODE = "ECOUNT_COM_CODE";
const ECOUNT_PROP_LAN_TYPE = "ECOUNT_LAN_TYPE";
const ECOUNT_LAN_TYPE_DEFAULT = "ko-KR";

function showEcountSyncModal() {
  // 모달을 열 때 무조건 현재 엑셀의 ID를 메인으로 강제 갱신시켜 둠 (타임아웃 컨텍스트 유실 방지)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) {
    PropertiesService.getScriptProperties().setProperty("MAIN_SS_ID", ss.getId());
  }

  var html = HtmlService.createHtmlOutputFromFile('ecount_sync_modal')
      .setWidth(500)
      .setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, '이카운트 자동 동기화 팝업');
}

function getEcountCredentialConfig_() {
  var props = PropertiesService.getScriptProperties();
  var cfg = {
    userId: String(props.getProperty(ECOUNT_PROP_USER_ID) || "").trim(),
    apiCertKey: String(props.getProperty(ECOUNT_PROP_API_CERT_KEY) || "").trim(),
    comCode: String(props.getProperty(ECOUNT_PROP_COM_CODE) || "").trim(),
    lanType: String(props.getProperty(ECOUNT_PROP_LAN_TYPE) || ECOUNT_LAN_TYPE_DEFAULT).trim(),
  };
  if (!cfg.lanType) cfg.lanType = ECOUNT_LAN_TYPE_DEFAULT;
  return cfg;
}

function validateEcountCredentialConfig_() {
  var cfg = getEcountCredentialConfig_();
  var missing = [];
  if (!cfg.userId) missing.push(ECOUNT_PROP_USER_ID);
  if (!cfg.apiCertKey) missing.push(ECOUNT_PROP_API_CERT_KEY);
  if (!cfg.comCode) missing.push(ECOUNT_PROP_COM_CODE);
  return { ok: missing.length === 0, cfg: cfg, missing: missing };
}

function ensureEcountCredentialConfig_() {
  var v = validateEcountCredentialConfig_();
  if (v.ok) return v.cfg;
  throw new Error(
    "이카운트 인증정보가 설정되지 않았습니다: " +
      v.missing.join(", ") +
      "\n메뉴 > 이카운트 작업 > 🔐 이카운트 계정설정 에서 입력해주세요."
  );
}

function setupEcountCredentials() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var current = getEcountCredentialConfig_();

  var comCodeRes = ui.prompt(
    "이카운트 계정설정 (1/3)",
    "회사코드(COM_CODE)를 입력하세요.\n현재값: " + (current.comCode || "(없음)"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (comCodeRes.getSelectedButton() !== ui.Button.OK) return;
  var comCode = String(comCodeRes.getResponseText() || "").trim();
  if (!comCode) {
    ui.alert("회사코드가 비어 있어 취소되었습니다.");
    return;
  }

  var userRes = ui.prompt(
    "이카운트 계정설정 (2/3)",
    "사용자ID(USER_ID)를 입력하세요.\n현재값: " + (current.userId || "(없음)"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (userRes.getSelectedButton() !== ui.Button.OK) return;
  var userId = String(userRes.getResponseText() || "").trim();
  if (!userId) {
    ui.alert("사용자ID가 비어 있어 취소되었습니다.");
    return;
  }

  var certRes = ui.prompt(
    "이카운트 계정설정 (3/3)",
    "API 인증키(API_CERT_KEY)를 입력하세요.\n(보안상 화면에 그대로 보일 수 있습니다)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (certRes.getSelectedButton() !== ui.Button.OK) return;
  var certKey = String(certRes.getResponseText() || "").trim();
  if (!certKey) {
    ui.alert("API 인증키가 비어 있어 취소되었습니다.");
    return;
  }

  props.setProperty(ECOUNT_PROP_COM_CODE, comCode);
  props.setProperty(ECOUNT_PROP_USER_ID, userId);
  props.setProperty(ECOUNT_PROP_API_CERT_KEY, certKey);
  props.setProperty(ECOUNT_PROP_LAN_TYPE, ECOUNT_LAN_TYPE_DEFAULT);

  ui.alert("✅ 이카운트 계정설정 저장 완료");
}

// ============================================
// 단계별 동기화 함수 (UI 차단 방지를 위한 분할)
// ============================================

function ecountStep1() {
  // 동시 실행 방지 락 확인 (다른 계정이 진행 중이면 오류로 전달)
  if (!_acquireSyncLock_("이카운트 전체 동기화")) {
    // _acquireSyncLock_ 내부에서 alert를 띄우지만, 모달 컨텍스트에서는
    // 서버 함수 오류로 전달되도록 예외를 발생시킨다
    var raw = PropertiesService.getScriptProperties().getProperty(_SYNC_LOCK_KEY_);
    var msg = "다른 계정이 동기화 중입니다.";
    try {
      var lock = JSON.parse(raw);
      if (lock && lock.email) msg += " (" + lock.email + ")";
    } catch(e) {}
    throw new Error("🔒 " + msg + " 잠시 후 다시 시도하세요.");
  }

  let zone = verifyZoneAPI();
  let sessionData = login(zone);
  
  if (sessionData && sessionData.Data && sessionData.Data.Datas && sessionData.Data.Datas.SESSION_ID) {
    let rawSessionId = sessionData.Data.Datas.SESSION_ID;
    // 동시 실행 충돌(Race Condition) 방지를 위해 전역 Properties 대신 고유 UUID 캐시키 사용
    let reqId = "EC_" + Utilities.getUuid();
    CacheService.getScriptCache().put(reqId + "_ZONE", String(zone), 600);
    CacheService.getScriptCache().put(reqId + "_SID", rawSessionId, 600);
    return { reqId: reqId, zone: zone, sessionId: rawSessionId };
  } else {
    _releaseSyncLock_();
    throw new Error('로그인 실패 (키 만료 또는 IP 권한)');
  }
}

function ecountStep2(auth) {
  var spreadsheet = getSafeActiveSS();
  // HTML↔GAS 직렬화 중 세션ID 손상 우회 → 전달받은 고유 reqId로 독립 캐시에서 원본 복구
  var zone = String(auth.zone);
  var rawSid = String(auth.sessionId);
  if (auth && auth.reqId) {
     var cachedZone = CacheService.getScriptCache().get(auth.reqId + "_ZONE");
     if (cachedZone) zone = cachedZone;
     var cachedSid = CacheService.getScriptCache().get(auth.reqId + "_SID");
     if (cachedSid) rawSid = cachedSid;
  }
  var safeSessionId = encodeURIComponent(rawSid);
  let url = 'https://oapi' + zone + '.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?SESSION_ID=' + safeSessionId;
  let requestData = { "PROD_CD": "" };
  let options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(requestData),
    "headers": { "Accept": "application/json", "Expect": "" },
    "muteHttpExceptions": true
  };
  
  let response = fetchWithRetry(url, options, 3);
  let httpCode = response.getResponseCode();
  let rawText = response.getContentText();
  let responseData;
  try {
    responseData = JSON.parse(rawText);
  } catch(e) {
    throw new Error("품목 파싱 오류 [HTTP " + httpCode + "] 서버 원문: " + rawText.substring(0, 300).replace(/[<>]/g, '?') + "...");
  }

  if (responseData.Status === "200") {
    let productList = responseData.Data.Result;
    var sheet = spreadsheet.getSheetByName('이카운트-품목정보');
    if(!sheet) throw new Error("'이카운트-품목정보' 시트를 찾을 수 없습니다.");
    
    // 사장님의 요청에 따라 헤더 순서를 강제 고정! (이카운트-품목정보)
    // A: PROD_CD, B: PROD_DES, C: CLASS_CD3, R: CLASS_CD2 위치 보장!
    // 사장님이 지정해주신 사진과 100% 완벽하게 일치하는 A~T열 절대 순서!
    var fixedHeaders = [
      "PROD_CD",     // A
      "PROD_DES",    // B
      "CLASS_CD3",   // C
      "EXCH_RATE",   // D
      "DENO_RATE",   // E
      "CUST",        // F
      "IN_PRICE",    // G
      "OUT_PRICE",   // H
      "CONT1",       // I
      "CONT2",       // J
      "CONT3",       // K
      "CONT4",       // L
      "CONT5",       // M
      "CONT6",       // N
      "NO_USER1",    // O
      "NO_USER10",   // P
      "SET_FLAG",    // Q
      "CLASS_CD2",   // R
      "NO_USER3",    // S
      "NO_USER4"     // T
    ];
    
    var requestHeaders = fixedHeaders.slice(); // 고정 헤더 복사본
    
    // 사장님 요청: "모든 정보를 다 가져오게 해달라!"
    // Ecount API가 내려준 수십가지 추가 정보들(우리가 고정해둔 19개 열 외의 값들)을 버리지 않고 순서대로 뒤에 쫙 이어붙입니다.
    if (productList && productList.length > 0) {
      var allKeys = Object.keys(productList[0]);
      for (var k = 0; k < allKeys.length; k++) {
        if (requestHeaders.indexOf(allKeys[k]) === -1) {
          requestHeaders.push(allKeys[k]);
        }
      }
    }
    // 1행에 위 고정 헤더를 무조건 덮어쓰기! (동기화마다 원치 않는 순서로 초기화되는 현상 원천 차단)
    sheet.getRange(1, 1, 1, requestHeaders.length).setValues([requestHeaders]);

    var rows = productList.map(product => {
      return requestHeaders.map(header => product[header] !== undefined ? product[header] : '');
    });

    if (rows.length > 0) {
      // [최적화] IMPORTRANGE 연산 딜레이 방지를 위해 deleteRows 대신 덮어쓰기 진행
      var currentMaxRows = sheet.getMaxRows();
      if(currentMaxRows < rows.length + 2) {
         sheet.insertRowsAfter(currentMaxRows, rows.length + 2 - currentMaxRows + 10);
      }
      
      const chunkSize = 1000;
      for (let i = 0; i < rows.length; i += chunkSize) {
        let chunk = rows.slice(i, i + chunkSize);
        sheet.getRange(3 + i, 1, chunk.length, requestHeaders.length).setValues(chunk);
      }
      
      // 기존에 남아있던 잔여 쓰레기 데이터 정리
      var newLastRow = 2 + rows.length;
      if (sheet.getLastRow() > newLastRow) {
          sheet.getRange(newLastRow + 1, 1, sheet.getLastRow() - newLastRow, requestHeaders.length).clearContent();
      }
      SpreadsheetApp.flush();
    }
    return true;
  } else {
    throw new Error('품목 정보 오류:\n' + JSON.stringify(responseData.Error));
  }
}

function ecountStep3(auth) {
  var spreadsheet = getSafeActiveSS();
  // HTML↔GAS 직렬화 중 세션ID 손상 우회 → 전달받은 고유 reqId로 독립 캐시에서 원본 복구
  var zone = String(auth.zone);
  var rawSid = String(auth.sessionId);
  if (auth && auth.reqId) {
     var cachedZone = CacheService.getScriptCache().get(auth.reqId + "_ZONE");
     if (cachedZone) zone = cachedZone;
     var cachedSid = CacheService.getScriptCache().get(auth.reqId + "_SID");
     if (cachedSid) rawSid = cachedSid;
  }
  var safeSessionId = encodeURIComponent(rawSid);
  let url = 'https://oapi' + zone + '.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=' + safeSessionId;
  let requestData = {
    "WH_CD": "100",
    "BASE_DATE" : ""+Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd")+"",
    "ZERO_FLAG" : "Y"
  };
  let options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(requestData),
    "headers": { "Accept": "application/json", "Expect": "" },
    "muteHttpExceptions": true
  };

  let response = fetchWithRetry(url, options, 3);
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
    
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) lastCol = 1;
    var requestHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    
    // 빈 헤더 제거
    requestHeaders = requestHeaders.filter(function(h) { return h !== ""; });
    
    // API가 내려준 재고 데이터의 모든 필드를 파악해서, 엑셀에 없는 필드면 헤더 우측 끝에 전부 추가(동적 확장)
    if (productList && productList.length > 0) {
      var allKeys = Object.keys(productList[0]);
      for (var k = 0; k < allKeys.length; k++) {
        if (requestHeaders.indexOf(allKeys[k]) === -1) {
          requestHeaders.push(allKeys[k]);
        }
      }
    }
    
    // 1행에 확장된 헤더 덮어쓰기! (원치 않는 누락 방지)
    sheet.getRange(1, 1, 1, requestHeaders.length).setValues([requestHeaders]);

    var rows = productList.map(product => {
      return requestHeaders.map(header => product[header] !== undefined ? product[header] : '');
    });
    
    if (rows.length > 0) {
      var currentMaxRows = sheet.getMaxRows();
      if(currentMaxRows < rows.length + 2) {
         sheet.insertRowsAfter(currentMaxRows, rows.length + 2 - currentMaxRows + 10);
      }
      
      const chunkSize = 1000;
      for (let i = 0; i < rows.length; i += chunkSize) {
        let chunk = rows.slice(i, i + chunkSize);
        sheet.getRange(3 + i, 1, chunk.length, requestHeaders.length).setValues(chunk);
      }
      
      var newLastRow = 2 + rows.length;
      if (sheet.getLastRow() > newLastRow) {
          sheet.getRange(newLastRow + 1, 1, sheet.getLastRow() - newLastRow, requestHeaders.length).clearContent();
      }
      SpreadsheetApp.flush();
    }
    
    // 🔥 [사장님 특명] "필요없는건 가져오면서 왜 재고는 따로 빼냐! 이카운트-품목정보 탭에 무조건 박아라!"
    // 재고 탭을 따로 만들더라도, 품목정보 탭에도 강제로 합쳐버립니다.
    try {
      var pSheet = spreadsheet.getSheetByName("이카운트-품목정보");
      if (pSheet && productList.length > 0) {
         var invMap = {}; // 바코드 -> 재고수량
         for (var i = 0; i < productList.length; i++) {
            var pCode = String(productList[i]["PROD_CD"]).trim();
            var pQty = parseFloat(productList[i]["BAL_QTY"]) || parseFloat(productList[i]["U_BAL_QTY"]) || 0;
            if(pCode) invMap[pCode] = pQty;
         }
         
         var pLr = pSheet.getLastRow();
         var pLc = pSheet.getLastColumn();
         if (pLr >= 3 && pLc > 0) {
            var pHeaders = pSheet.getRange(1, 1, 1, pLc).getValues()[0];
            var prodCol = pHeaders.indexOf("PROD_CD");
            
            // 품목정보 탭에 BAL_QTY 기둥이 없으면 우측 맨 끝에 강제로 하나 세웁니다.
            var balCol = pHeaders.indexOf("BAL_QTY");
            if (balCol === -1) {
               balCol = pLc;
               pSheet.getRange(1, balCol + 1).setValue("BAL_QTY");
            }
            
            if (prodCol !== -1) {
               var masterData = pSheet.getRange(3, 1, pLr - 2, pLc).getValues(); // 3행부터 긁기
               var newInvData = [];
               for(var r=0; r<masterData.length; r++) {
                  var mCode = String(masterData[r][prodCol]).trim();
                  var mQty = (invMap[mCode] !== undefined) ? invMap[mCode] : 0;
                  newInvData.push([mQty]);
               }
               // 재고값만 핀셋으로 찝어서 이카운트-품목정보 탭에 꽂아버림!
               pSheet.getRange(3, balCol + 1, newInvData.length, 1).setValues(newInvData);
               SpreadsheetApp.flush();
            }
         }
      }
    } catch(e) {
      if (typeof logSystemError === 'function') logSystemError("재고 정보 병합 실패: " + e.message, "ecountStep3(재고)");
      throw new Error("품목 탭에 재고 정보 병합 실패: " + e.message);
    }

    return true;
  } else {
    throw new Error('재고 정보 오류:\n' + JSON.stringify(responseData.Error));
  }
}

function ecountStep4() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
  SpreadsheetApp.flush();
  // 정렬/수식 시트가 이카운트 최신 데이터를 바탕으로 연산할 시간을 충분히 줍니다(10초)
  Utilities.sleep(10000); 
  
  if (typeof moveToEcount === 'function') {
    moveToEcount(null, ss);
  }
  SpreadsheetApp.flush();
  return true;
}

/**
 * 동기화 모달(ecount_sync_modal) 전용: 4단계 실패 시에도 이카운트-자동연동로그에 남긴다.
 * 예약 배치(runDailyEcountBatch)는 ecountStep4()를 직접 호출하여 BATCH_ECOUNT 한 줄만 기록한다.
 */
function ecountStep4ForModal() {
  try {
    return ecountStep4();
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    try {
      appendEcountAutomationLog_("UI_FULL_SYNC", false, "4단계 후처리(moveToEcount): " + msg);
    } catch (logErr) {}
    throw e;
  } finally {
    _releaseSyncLock_();
  }
}

// ============================================
// 내부 통신 및 로우레벨 함수 모음
// ============================================

function verifyZoneAPI() {
  var cfg = ensureEcountCredentialConfig_();
  let url = 'https://oapi.ecount.com/OAPI/V2/Zone'; 
  let requestData = { "COM_CODE": cfg.comCode };
  let options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(requestData),
    "headers": { "Accept": "application/json", "Expect": "" },
    "muteHttpExceptions": true
  };
  let response = fetchWithRetry(url, options, 3);
  let statusCode = response.getResponseCode();
  let rawText = response.getContentText();
  let responseData;
  try {
    responseData = JSON.parse(rawText);
  } catch(e) {
    var preview = String(rawText || "").replace(/\s+/g, " ").slice(0, 220);
    throw new Error("verifyZoneAPI 파싱 오류 (HTTP " + statusCode + "): " + (preview || "응답 본문 없음"));
  }

  if (!responseData || !responseData.Data || !responseData.Data.ZONE) {
    var apiMsg = "";
    if (responseData && responseData.Error && responseData.Error.Message) {
      apiMsg = responseData.Error.Message;
    }
    throw new Error("verifyZoneAPI 응답 이상 (HTTP " + statusCode + "): " + (apiMsg || rawText || "ZONE 값 없음"));
  }

  let zone = responseData.Data.ZONE;
  return zone;
}

function login(zone) {
  var cfg = ensureEcountCredentialConfig_();
  let url = `https://oapi${zone}.ecount.com/OAPI/V2/OAPILogin`;
  let requestData = {
    "COM_CODE": cfg.comCode,
    "USER_ID": cfg.userId,
    "ZONE": zone,
    "API_CERT_KEY": cfg.apiCertKey,
    "LAN_TYPE": cfg.lanType
  };
  let options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(requestData),
    "headers": { "Accept": "application/json", "Expect": "" },
    "muteHttpExceptions": true
  };
  let response = fetchWithRetry(url, options, 3);
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
  var activeSheetName = getSafeActiveSS().getActiveSheet().getName();
  if (activeSheetName !== '상품정보') {
    SpreadsheetApp.getUi().alert('⚠️ 이 메뉴는 원본 [상품정보] 탭에서만 작동합니다.\n현재 탭: ' + activeSheetName);
    return;
  }
  // 하위 호환성 유지 
  showEcountSyncModal();
}

// ============================================
// 시간 기반 자동 트리거 (매일 스케줄링) - 2분할 안전버전
// ============================================
function setupDailyTrigger() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch(e) {}
  
  var activeSS = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSS) {
    PropertiesService.getScriptProperties().setProperty("MAIN_SS_ID", activeSS.getId());
  }
  try {
    removeDailyTrigger(true); // 중복 방지 (무음 처리)
    
    // 1. 이카운트 로드 (새벽 2시10분 전후)
    ScriptApp.newTrigger('runDailyEcountBatch')
             .timeBased()
             .everyDays(1)
             .atHour(2)
             .nearMinute(10)
             .create();
             
    // 2. 판매상태/재고 아침 동기화 (오전 7시 전후)
    ScriptApp.newTrigger('runMorningSyncStatusBatch')
             .timeBased()
             .everyDays(1)
             .atHour(7)
             .nearMinute(0)
             .create();

    // 3. 통합 허브 동기화 (오후 12시 30분 전후)
    ScriptApp.newTrigger('runDailyHubBatch')
             .timeBased()
             .everyDays(1)
             .atHour(12)
             .nearMinute(30)
             .create();

    // 4. 재고조정입력 자동 전송 (상품정보 동기화보다 40분 선행)
    ScriptApp.newTrigger('runDailyInventoryAdjustBatch')
             .timeBased()
             .everyDays(1)
             .atHour(1)
             .nearMinute(20)
             .create();
    ScriptApp.newTrigger('runDailyInventoryAdjustBatch')
             .timeBased()
             .everyDays(1)
             .atHour(11)
             .nearMinute(50)
             .create();
             
    if (ui) ui.alert(
      "⏰ [예약 완료]\n\n" +
      "매일 새벽 2시10분: 이카운트 데이터 스캔/재고 반영\n" +
      "매일 오전 7시00분: 판매 상태/재고 동기화 (1회차)\n" +
      "매일 오후 12시30분: 판매 상태/재고 동기화 (2회차)\n" +
      "매일 새벽 1시20분 / 오전 11시50분: 재고조정입력 자동 전송\n" +
      "매일 새벽 2시40분: 발주 월마감 자동 청소기(별도 설치)\n\n" +
      "※ '이카운트-판매현황업로드용' 탭: 통합 발주 DB 반영분 5분마다 자동 갱신(중복 시 1회만 설치)\n\n" +
      "※ 구글 시간기반 트리거 특성상 실제 실행 시각은 ±수분 오차가 있을 수 있습니다."
    );
    appendEcountAutomationLog_("TRIGGER_SETUP", true, "자동연동 트리거 재설치 완료");
    try {
      if (typeof ensureSalesStatusPasteRebuildTimeTrigger_ === "function") {
        ensureSalesStatusPasteRebuildTimeTrigger_();
      }
    } catch (ePasteTrig) {}
  } catch (e) {
    var p = getOwnershipDiagnostics_();
    var msg = String(e && e.message ? e.message : e);
    appendEcountAutomationLog_("TRIGGER_SETUP", false, msg);
    if (ui) {
      ui.alert(
        "🚨 자동연동 트리거 설치 실패\n\n" +
        "- 오류: " + msg + "\n" +
        "- 현재 실행계정: " + p.effectiveUser + "\n" +
        "- 시트 소유자: " + p.owner + "\n\n" +
        "소유자 계정으로 다시 실행하거나, 현재 계정에 편집 권한/스크립트 권한이 있는지 확인해주세요."
      );
    }
    throw e;
  }
}

function removeDailyTrigger(isSilent) {
  var removed = 0;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'runDailyEcountBatch' || fn === 'runDailyHubBatch' ||
        fn === 'runDailyInventoryAdjustBatch' || fn === 'runDailyAutoBatch' ||
        fn === 'runMorningSyncStatusBatch') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  appendEcountAutomationLog_("TRIGGER_REMOVE", true, "자동연동 트리거 삭제: " + removed + "건");
  if (!isSilent) {
    var ui = null;
    try { ui = SpreadsheetApp.getUi(); } catch(e) {}
    if (ui) ui.alert("의도적으로 모든 자동 예약 스케줄을 껐습니다.");
  }
}

function repairDailyTriggerHealth() {
  try {
    setupDailyTrigger();
  } catch (e) {
    appendEcountAutomationLog_("TRIGGER_REPAIR", false, String(e && e.message ? e.message : e));
    throw e;
  }
}

function showDailyTriggerStatus() {
  var triggers = ScriptApp.getProjectTriggers();
  var ecountCount = 0;
  var hubCount = 0;
  var morningStatusCount = 0;
  var inventoryAdjustCount = 0;
  var archiveCount = 0;

  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "runDailyEcountBatch") ecountCount++;
    else if (fn === "runDailyHubBatch") hubCount++;
    else if (fn === "runMorningSyncStatusBatch") morningStatusCount++;
    else if (fn === "runDailyInventoryAdjustBatch") inventoryAdjustCount++;
    else if (fn === "archivePastOrders") archiveCount++;
  }

  var allOn = ecountCount > 0 && hubCount > 0 && morningStatusCount > 0 && inventoryAdjustCount > 0;
  var status = allOn ? "🟢 ON" : "🔴 OFF/부분설치";
  var inventoryPending = countPendingInventoryAdjustRows_();

  var lines = [];
  lines.push("자동연동 상태: " + status);
  lines.push("");
  lines.push("기준 스케줄");
  lines.push("- 새벽 2시10분: 이카운트 데이터 스캔/재고 반영");
  lines.push("- 오전 7시00분: 판매 상태/재고 동기화 (1회차)");
  lines.push("- 오후 12시30분: 판매 상태/재고 동기화 (2회차)");
  lines.push("- 새벽 1시20분 / 오전 11시50분: 재고조정입력 자동 전송");
  lines.push("- 새벽 2시40분: 발주 월마감 자동 청소기(별도 설치)");
  lines.push("");
  lines.push("현재 트리거 감지");
  lines.push("- runDailyEcountBatch: " + ecountCount + "개");
  lines.push("- runMorningSyncStatusBatch (07:00): " + morningStatusCount + "개");
  lines.push("- runDailyHubBatch (12:30): " + hubCount + "개");
  lines.push("- runDailyInventoryAdjustBatch: " + inventoryAdjustCount + "개");
  lines.push("- archivePastOrders: " + archiveCount + "개");
  lines.push("");
  lines.push("재고조정입력 대기건: " + inventoryPending + "건");
  lines.push("※ 자동 전송 실패건은 '재고조정입력' 결과열(H)에서 다시 확인할 수 있습니다.");

  var ui = SpreadsheetApp.getUi();
  ui.alert("이카운트 자동연동 상태", lines.join("\n"), ui.ButtonSet.OK);
}

function diagnoseEcountIntegration() {
  var lines = [];
  var v = validateEcountCredentialConfig_();
  lines.push("=== 이카운트 연동 진단 ===");
  lines.push("");
  var p = getOwnershipDiagnostics_();
  lines.push("0) 실행 계정/소유권");
  lines.push("- 현재 실행계정: " + p.effectiveUser);
  lines.push("- 활성 사용자: " + p.activeUser);
  lines.push("- 시트 소유자: " + p.owner);
  lines.push("- 소유자 동일 여부: " + (p.isOwner ? "YES" : "NO"));
  if (!p.isOwner) {
    lines.push("- 안내: 트리거 생성/Drive 작업/권한승인은 소유자 계정에서 실행 권장");
  }
  lines.push("");
  lines.push("1) 인증정보");
  if (v.ok) {
    lines.push("- 상태: OK");
    lines.push("- COM_CODE: " + v.cfg.comCode);
    lines.push("- USER_ID: " + v.cfg.userId);
  } else {
    lines.push("- 상태: 누락");
    lines.push("- 누락 키: " + v.missing.join(", "));
  }
  lines.push("");

  var ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
  lines.push("2) 필수 시트");
  var required = ["이카운트-품목정보", "이카운트-재고", "재고조정입력"];
  for (var i = 0; i < required.length; i++) {
    lines.push("- " + required[i] + ": " + (ss.getSheetByName(required[i]) ? "OK" : "없음"));
  }
  lines.push("");

  var pending = countPendingInventoryAdjustRows_();
  lines.push("3) 대기 현황");
  lines.push("- 재고조정입력 미전송 건: " + pending + "건");
  lines.push("");
  lines.push("4) 자동연동 트리거");
  var t = getDailyTriggerCounts_();
  lines.push("- runDailyEcountBatch: " + t.ecountCount + "개");
  lines.push("- runDailyHubBatch: " + t.hubCount + "개");
  lines.push("- runDailyInventoryAdjustBatch: " + t.inventoryAdjustCount + "개");
  lines.push("- archivePastOrders: " + t.archiveCount + "개");
  if (t.unknownCount > 0) lines.push("- 구형 트리거: " + t.unknownCount + "개");
  lines.push("");
  lines.push("5) 이카운트 로그인/권한 실검");
  var loginProbe = probeEcountLoginPermission_();
  if (loginProbe.ok) {
    lines.push("- 상태: OK (SESSION_ID 발급 성공)");
  } else {
    lines.push("- 상태: 실패");
    lines.push("- 원인: " + loginProbe.message);
  }

  SpreadsheetApp.getUi().alert("이카운트 연동 진단", lines.join("\n"), SpreadsheetApp.getUi().ButtonSet.OK);
}

function extractEcountApiErrorMessage_(obj) {
  if (!obj) return "";
  try {
    if (obj.Error && obj.Error.Message) return String(obj.Error.Message);
  } catch (e1) {}
  try {
    if (obj.Data && obj.Data.Error && obj.Data.Error.Message) {
      return String(obj.Data.Error.Message);
    }
  } catch (e2) {}
  try {
    if (obj.message) return String(obj.message);
  } catch (e3) {}
  return "";
}

function probeEcountLoginPermission_() {
  try {
    var zone = verifyZoneAPI();
    var loginData = login(zone);
    var status = String((loginData && loginData.Status) || "");
    var sessionId = "";
    try {
      sessionId = String(
        loginData && loginData.Data && loginData.Data.Datas
          ? loginData.Data.Datas.SESSION_ID || ""
          : "",
      ).trim();
    } catch (eSid) {}
    if (status === "200" && sessionId) {
      return { ok: true, message: "OK" };
    }
    var apiErr = extractEcountApiErrorMessage_(loginData) || "SESSION_ID 발급 실패";
    return { ok: false, message: apiErr + " (Status=" + status + ")" };
  } catch (e) {
    return {
      ok: false,
      message: String(e && e.message ? e.message : e),
    };
  }
}

function getOwnershipDiagnostics_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
  var owner = "(확인 불가)";
  try {
    owner = DriveApp.getFileById(ss.getId()).getOwner().getEmail() || "(소유자 이메일 비공개)";
  } catch (e1) {}

  var effectiveUser = "(확인 불가)";
  try {
    effectiveUser = Session.getEffectiveUser().getEmail() || "(비공개)";
  } catch (e2) {}

  var activeUser = "(확인 불가)";
  try {
    activeUser = Session.getActiveUser().getEmail() || "(비공개)";
  } catch (e3) {}

  var ownerNorm = String(owner || "").toLowerCase();
  var userNorm = String(effectiveUser || "").toLowerCase();
  var isOwner = !!ownerNorm && !!userNorm && ownerNorm === userNorm;

  return {
    owner: owner,
    effectiveUser: effectiveUser,
    activeUser: activeUser,
    isOwner: isOwner
  };
}

function getDailyTriggerCounts_() {
  var triggers = ScriptApp.getProjectTriggers();
  var out = { ecountCount: 0, hubCount: 0, morningStatusCount: 0, inventoryAdjustCount: 0, archiveCount: 0, unknownCount: 0 };
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "runDailyEcountBatch") out.ecountCount++;
    else if (fn === "runDailyHubBatch") out.hubCount++;
    else if (fn === "runMorningSyncStatusBatch") out.morningStatusCount++;
    else if (fn === "runDailyInventoryAdjustBatch") out.inventoryAdjustCount++;
    else if (fn === "archivePastOrders") out.archiveCount++;
    else if (fn === "runDailyAutoBatch") out.unknownCount++;
  }
  return out;
}

function countPendingInventoryAdjustRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return 0;
  var sheet = ss.getSheetByName("재고조정입력");
  if (!sheet) return 0;
  var lr = sheet.getLastRow();
  if (lr < 3) return 0;

  var rows = sheet.getRange(3, 1, lr - 2, 8).getValues();
  var pending = 0;
  for (var i = 0; i < rows.length; i++) {
    var hasPayload = false;
    for (var c = 0; c < 7; c++) {
      if (String(rows[i][c] || "").trim() !== "") {
        hasPayload = true;
        break;
      }
    }
    if (!hasPayload) continue;
    var resultText = String(rows[i][7] || "").trim();
    if (resultText.indexOf("✅ 성공") === -1) pending++;
  }
  return pending;
}

function getSafeActiveSS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty("MAIN_SS_ID");
    if (id) {
      ss = SpreadsheetApp.openById(id);
    }
  }
  if (!ss) throw new Error("활성 스프레드시트를 찾을 수 없습니다. UI에서 예약을 다시 진행해주세요.");
  return ss;
}

// 1차 자동화: 이카운트 순수 데이터 로드 (새벽 2시10분 전후)
function runDailyEcountBatch() {
  var runner = function() {
    var started = new Date().getTime();
    try {
      let auth = ecountStep1();
      ecountStep2(auth);
      ecountStep3(auth);
      SpreadsheetApp.flush();
      
      // ecountStep4() 내부에 10초 대기가 적용되어 있습니다.
      ecountStep4(); 
      SpreadsheetApp.flush();
      appendEcountAutomationLog_("BATCH_ECOUNT", true, "실행 완료 (" + (new Date().getTime() - started) + "ms)");
    } catch (e) {
      console.error("이카운트 새벽배치 에러: " + e.message);
      logSystemError("이카운트 새벽배치 에러: " + e.message, "이카운트 자동스캔");
      appendEcountAutomationLog_("BATCH_ECOUNT", false, e.message);
    } finally {
      _releaseSyncLock_();
    }
  };
  if (typeof runWithAutomationScriptLock_ === "function") {
    runWithAutomationScriptLock_("BATCH_ECOUNT", 45000, runner);
    return;
  }
  runner();
}

// 1.5차 자동화: 판매상태/재고 아침 동기화 (오전 7시 전후)
function runMorningSyncStatusBatch() {
  var runner = function() {
    var started = new Date().getTime();
    try {
      if (typeof syncStatusOnly === 'function') {
        syncStatusOnly(true);
      }
      appendEcountAutomationLog_("BATCH_MORNING_STATUS", true, "실행 완료 (" + (new Date().getTime() - started) + "ms)");
    } catch (e) {
      console.error("아침 상태동기화 에러: " + e.message);
      logSystemError("아침 상태동기화 에러: " + e.message, "아침배치-상태");
      appendEcountAutomationLog_("BATCH_MORNING_STATUS", false, e.message);
    }
  };
  if (typeof runWithAutomationScriptLock_ === "function") {
    runWithAutomationScriptLock_("BATCH_MORNING_STATUS", 30000, runner);
    return;
  }
  runner();
}

// 2차 자동화: 허브 서버 최종 정렬 (오후 12시 30분 전후)
function runDailyHubBatch() {
  var runner = function() {
    var started = new Date().getTime();
    try {
      if (typeof syncStatusOnly === 'function') {
        syncStatusOnly(true); 
      }
      appendEcountAutomationLog_("BATCH_HUB", true, "실행 완료 (" + (new Date().getTime() - started) + "ms)");
    } catch (e) {
      console.error("허브 아침배치 에러: " + e.message);
      logSystemError("허브 단가 동기화 에러: " + e.message, "허브 아침배치");
      appendEcountAutomationLog_("BATCH_HUB", false, e.message);
    }
  };
  if (typeof runWithAutomationScriptLock_ === "function") {
    runWithAutomationScriptLock_("BATCH_HUB", 30000, runner);
    return;
  }
  runner();
}

// ============================================
// [통신 지연 및 시스템 모니터링 백오프 유틸리티]
// ============================================

function fetchWithRetry(url, options, maxRetries) {
  maxRetries = maxRetries || 3;
  var delay = 1000;
  
  for (var i = 0; i < maxRetries; i++) {
    try {
      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();
      
      if (code === 200) {
        return response;
      } else if (code >= 500 || code === 412 || code === 429) {
        if (i === maxRetries - 1) return response; 
      } else {
        return response; // 영구적 클라이언트 에러(400, 401, 404 등)
      }
    } catch (e) {
      if (i === maxRetries - 1) throw new Error("API 통신 완전 실패 (" + maxRetries + "회 연속튕김): " + e.message);
    }
    Utilities.sleep(delay);
    delay *= 2; 
  }
}

function logSystemError(errorMsg, source) {
  try {
    var ss = getSafeActiveSS();
    var logSheetName = "📡 시스템 로그";
    var logSheet = ss.getSheetByName(logSheetName);
    
    if (!logSheet) {
      logSheet = ss.insertSheet(logSheetName);
      logSheet.getRange("A1:C1").setValues([["발생 시간", "발생 영역", "에러 상세 내용"]])
              .setBackground("#ea4335").setFontColor("white").setFontWeight("bold");
      logSheet.setColumnWidth(1, 160);
      logSheet.setColumnWidth(2, 140);
      logSheet.setColumnWidth(3, 500);
      logSheet.setFrozenRows(1);
    }
    
    var timestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    logSheet.insertRowAfter(1);
    logSheet.getRange("A2:C2").setValues([[timestamp, source, errorMsg]]);
    logSheet.setTabColor("red"); // 에러 확인 전까지 시각적 경고
  } catch(e) {
    console.error("시스템 로그 기록 중 실패: " + e.message);
  }
}

function appendEcountAutomationLog_(job, ok, message) {
  try {
    var ss = getSafeActiveSS();
    var sh = ss.getSheetByName("이카운트-자동연동로그");
    if (!sh) {
      sh = ss.insertSheet("이카운트-자동연동로그");
      sh.getRange(1, 1, 1, 4).setValues([["실행시각", "작업", "성공", "메시지"]]);
      sh.setFrozenRows(1);
    }
    var ts = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 4).setValues([[ts, String(job || ""), ok ? "Y" : "N", String(message || "")]]);
  } catch (e) {
    if (typeof recordAutomationLogFailure_ === "function") {
      recordAutomationLogFailure_(
        "ECOUNT_AUTOMATION_LOG",
        "job=" + String(job || "") + ", ok=" + (ok ? "Y" : "N") + ", msg=" + String(message || ""),
        e,
      );
      return;
    }
    try {
      Logger.log("[ECOUNT_AUTOMATION_LOG_FAIL] " + (e && e.message ? e.message : e));
    } catch (_) {}
  }
}

// adminSetupDailyTrigger_, adminRemoveDailyTrigger_, adminRepairDailyTriggerHealth_
// → accessControl.gs 로 이관 (관리자 권한 체크 포함)

// ═══════════════════════════════════════════
//  원클릭 이카운트 전체 초기화
//  사본(최적화사본) 파일에서 처음 실행 시 한 번에 전체 설정
// ═══════════════════════════════════════════
/**
 * 실행 순서:
 *  1) MAIN_SS_ID 자동 등록
 *  2) 이카운트 계정 입력 (미설정 시)
 *  3) 필수 시트 자동 생성 (이카운트-품목정보, 이카운트-재고, 재고조정입력)
 *  4) '상품정보' 탭 존재 확인
 *  5) 이카운트 로그인 실검
 *  6) 자동 트리거 설치
 *  7) 결과 요약 표시
 */
function initializeEcountForSheet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var log = [];

  // ─ 1. MAIN_SS_ID 등록 ─
  props.setProperty("MAIN_SS_ID", ss.getId());
  log.push("✅ 스프레드시트 등록: " + ss.getName());

  // ─ 2. 이카운트 계정 확인 & 입력 ─
  var v = validateEcountCredentialConfig_();
  if (!v.ok) {
    log.push("⚠️ 이카운트 계정 미설정 → 입력 진행");
    var comRes = ui.prompt("이카운트 초기설정 (1/3)", "회사코드(COM_CODE)를 입력하세요.", ui.ButtonSet.OK_CANCEL);
    if (comRes.getSelectedButton() !== ui.Button.OK) return ui.alert("초기화가 취소되었습니다.");
    var comCode = comRes.getResponseText().trim();

    var userRes = ui.prompt("이카운트 초기설정 (2/3)", "사용자ID(USER_ID)를 입력하세요.", ui.ButtonSet.OK_CANCEL);
    if (userRes.getSelectedButton() !== ui.Button.OK) return ui.alert("초기화가 취소되었습니다.");
    var userId = userRes.getResponseText().trim();

    var certRes = ui.prompt("이카운트 초기설정 (3/3)", "API 인증키(API_CERT_KEY)를 입력하세요.", ui.ButtonSet.OK_CANCEL);
    if (certRes.getSelectedButton() !== ui.Button.OK) return ui.alert("초기화가 취소되었습니다.");
    var certKey = certRes.getResponseText().trim();

    if (!comCode || !userId || !certKey) return ui.alert("❌ 필수값이 비어 있어 초기화를 중단합니다.");

    props.setProperty(ECOUNT_PROP_COM_CODE, comCode);
    props.setProperty(ECOUNT_PROP_USER_ID, userId);
    props.setProperty(ECOUNT_PROP_API_CERT_KEY, certKey);
    props.setProperty(ECOUNT_PROP_LAN_TYPE, ECOUNT_LAN_TYPE_DEFAULT);
    log.push("✅ 이카운트 계정 저장 완료");
  } else {
    log.push("✅ 이카운트 계정 확인 (COM_CODE=" + v.cfg.comCode + ", USER=" + v.cfg.userId + ")");
  }

  // ─ 3. 필수 시트 자동 생성 ─
  var requiredSheets = [
    { name: "이카운트-품목정보", headers: ["PROD_CD","PROD_DES","CLASS_CD3","EXCH_RATE","DENO_RATE","CUST","IN_PRICE","OUT_PRICE"], bg: "#fff2cc" },
    { name: "이카운트-재고",     headers: ["PROD_CD","PROD_DES","WH_CD","BAL_QTY","U_BAL_QTY"],                                      bg: "#d9ead3" },
    { name: "재고조정입력",       headers: ["이카운트코드","수량","창고코드","메모","처리여부","결과"],                                     bg: "#cfe2f3" }
  ];
  for (var ri = 0; ri < requiredSheets.length; ri++) {
    var req = requiredSheets[ri];
    var sh = ss.getSheetByName(req.name);
    if (!sh) {
      sh = ss.insertSheet(req.name);
      sh.getRange(1, 1, 1, req.headers.length)
        .setValues([req.headers])
        .setBackground(req.bg)
        .setFontWeight("bold");
      sh.getRange("1:1").setFontColor("#000000");
      sh.setFrozenRows(1);
      log.push("✅ 시트 생성: " + req.name);
    } else {
      log.push("✅ 시트 확인: " + req.name + " (기존 유지)");
    }
  }

  // ─ 4. '상품정보' 탭 확인 ─
  if (!ss.getSheetByName("상품정보")) {
    log.push("⚠️ '상품정보' 탭 없음 — 동기화(4단계)가 이 탭에 데이터를 씁니다.");
    log.push("   탭 이름이 다르면 수동으로 탭 이름을 '상품정보'로 변경하세요.");
  } else {
    log.push("✅ '상품정보' 탭 확인");
  }

  // ─ 5. 이카운트 로그인 실검 ─
  log.push("");
  log.push("━━ 이카운트 로그인 실검 ━━");
  try {
    var probe = probeEcountLoginPermission_();
    if (probe.ok) {
      log.push("✅ 로그인 성공 (SESSION_ID 정상 발급)");
    } else {
      log.push("❌ 로그인 실패: " + probe.message);
      log.push("   → 계정정보를 다시 확인하세요.");
    }
  } catch (eLogin) {
    log.push("❌ 로그인 검사 오류: " + eLogin.message);
  }

  // ─ 6. 자동 트리거 설치 ─
  log.push("");
  log.push("━━ 자동 트리거 설치 ━━");
  try {
    // 기존 동일 트리거 정리
    var removed = 0;
    var triggers = ScriptApp.getProjectTriggers();
    for (var ti = 0; ti < triggers.length; ti++) {
      var fn = triggers[ti].getHandlerFunction();
      if (fn === "runDailyEcountBatch" || fn === "runDailyHubBatch" ||
          fn === "runDailyInventoryAdjustBatch" || fn === "runMorningSyncStatusBatch") {
        ScriptApp.deleteTrigger(triggers[ti]);
        removed++;
      }
    }
    if (removed > 0) log.push("  기존 트리거 " + removed + "개 정리");

    ScriptApp.newTrigger("runDailyEcountBatch").timeBased().everyDays(1).atHour(2).nearMinute(10).create();
    ScriptApp.newTrigger("runMorningSyncStatusBatch").timeBased().everyDays(1).atHour(7).nearMinute(0).create();
    ScriptApp.newTrigger("runDailyHubBatch").timeBased().everyDays(1).atHour(12).nearMinute(30).create();
    ScriptApp.newTrigger("runDailyInventoryAdjustBatch").timeBased().everyDays(1).atHour(1).nearMinute(20).create();
    ScriptApp.newTrigger("runDailyInventoryAdjustBatch").timeBased().everyDays(1).atHour(11).nearMinute(50).create();

    log.push("✅ 트리거 5개 설치 완료");
    log.push("   새벽 02:10  → 이카운트 스캔 & 재고 반영");
    log.push("   오전 01:20  → 재고조정 자동 전송 (1회차)");
    log.push("   오전 07:00  → 판매 상태/재고 동기화 (1회차)");
    log.push("   오전 11:50  → 재고조정 자동 전송 (2회차)");
    log.push("   오후 12:30  → 판매 상태/재고 동기화 (2회차)");
    appendEcountAutomationLog_("INIT_SETUP", true, "initializeEcountForSheet 완료");
  } catch (eTrig) {
    log.push("❌ 트리거 설치 실패: " + eTrig.message);
    log.push("   → 파일 소유자 계정으로 실행하세요.");
    log.push("   또는 메뉴 > ⏰ 자동연동 켜기 를 수동으로 실행하세요.");
  }

  // ─ 7. 결과 표시 ─
  log.push("");
  log.push("━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.push("이제 메뉴 > 🔄 이카운트 전체 동기화 로 수동 동기화를 실행하세요.");

  var summary = log.join("\n");
  if (summary.length > 4500) summary = summary.slice(0, 4400) + "\n...(이하 생략)";
  ui.alert("🚀 이카운트 연동 초기화 결과", summary, ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  사본 전용: 원본과 시간 충돌 없는 오프셋 트리거 설치
//  원본: 02:10 / 01:20 / 11:50 / 12:30
//  사본: 02:25 / 01:40 / 12:10 / 12:50  (15~20분 오프셋)
// ═══════════════════════════════════════════
function setupDailyTriggerForCopy() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // MAIN_SS_ID 갱신
  props.setProperty("MAIN_SS_ID", ss.getId());

  try {
    // 기존 트리거 전체 정리
    var removed = 0;
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      var fn = existing[i].getHandlerFunction();
      if (fn === "runDailyEcountBatch" || fn === "runDailyHubBatch" ||
          fn === "runDailyInventoryAdjustBatch" || fn === "runDailyAutoBatch" ||
          fn === "runMorningSyncStatusBatch") {
        ScriptApp.deleteTrigger(existing[i]);
        removed++;
      }
    }

    // 사본 전용 오프셋 시간으로 설치
    ScriptApp.newTrigger("runDailyEcountBatch").timeBased().everyDays(1).atHour(2).nearMinute(25).create();           // 원본 2:10 → +15분
    ScriptApp.newTrigger("runMorningSyncStatusBatch").timeBased().everyDays(1).atHour(7).nearMinute(20).create();     // 원본 7:00 → +20분
    ScriptApp.newTrigger("runDailyHubBatch").timeBased().everyDays(1).atHour(12).nearMinute(50).create();             // 원본 12:30 → +20분
    ScriptApp.newTrigger("runDailyInventoryAdjustBatch").timeBased().everyDays(1).atHour(1).nearMinute(40).create();  // 원본 1:20 → +20분
    ScriptApp.newTrigger("runDailyInventoryAdjustBatch").timeBased().everyDays(1).atHour(12).nearMinute(10).create(); // 원본 11:50 → +20분

    appendEcountAutomationLog_("COPY_TRIGGER_SETUP", true, "사본 전용 오프셋 트리거 설치 완료 (기존 " + removed + "개 정리)");
    ui.alert(
      "✅ 사본 전용 트리거 설치 완료",
      "원본(상품정보)과 시간 충돌 없도록 오프셋 적용:\n\n" +
      "  새벽 02:25  → 이카운트 스캔 & 재고 반영  (원본: 02:10)\n" +
      "  오전 01:40  → 재고조정 자동 전송 1회차   (원본: 01:20)\n" +
      "  오전 07:20  → 판매 상태/재고 동기화 1회차 (원본: 07:00)\n" +
      "  오전 12:10  → 재고조정 자동 전송 2회차   (원본: 11:50)\n" +
      "  오후 12:50  → 판매 상태/재고 동기화 2회차 (원본: 12:30)\n\n" +
      "※ 원본과 사본이 동시에 이카운트 API를 호출하지 않도록\n  15~20분 간격으로 설정되었습니다.",
      ui.ButtonSet.OK
    );
  } catch (e) {
    appendEcountAutomationLog_("COPY_TRIGGER_SETUP", false, e.message);
    ui.alert("❌ 트리거 설치 실패\n\n" + e.message + "\n\n파일 소유자 계정으로 실행해주세요.");
  }
}

/**
 * 모달용: 에러 발생 시 UI 알림 팝업 없이 백그라운드에서 동기화 락을 안전하게 해제합니다.
 */
function releaseSyncLockFromModal() {
  _releaseSyncLock_();
}
