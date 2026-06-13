function pushStatusToEcount() {
  _pushDataToEcount('STATUS');
}

function pushInventoryToEcount() {
  _pushDataToEcount('INVENTORY');
}

function _pushDataToEcount(mode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  
  if (sheet.getName() !== '상품정보') {
    SpreadsheetApp.getUi().alert('⚠️ 이 기능은 원본 [상품정보] 탭에서만 작동합니다.');
    return;
  }
  
  var activeRange = sheet.getActiveRange();
  var startRow = activeRange.getRow();
  var numRows = activeRange.getNumRows();
  
  // 데이터행은 6행부터 시작
  if (startRow < 6) { 
    var diff = 6 - startRow;
    startRow = 6;
    numRows = numRows - diff;
    if (numRows < 1) {
       SpreadsheetApp.getUi().alert('⚠️ 실제 데이터 영역(6행 이하)의 품목들을 먼저 드래그해 주세요.');
       return;
    }
  }

  // A열(상태), C열(품목명), E열(품목코드), G열(재고)
  var dataValues = sheet.getRange(startRow, 1, numRows, 7).getValues();
  var trueCodeMap = buildTrueCodeMap(ss);
  
  var targetItems = [];
  for (var i = 0; i < dataValues.length; i++) {
    var rawCode = String(dataValues[i][4]);
    var searchKey = rawCode.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
    var code = trueCodeMap[searchKey] || rawCode.trim();
    
    if (searchKey) {
      targetItems.push({
        rowIdx: startRow + i,
        statusStr: String(dataValues[i][0]).trim(),
        name: String(dataValues[i][2]).trim(),
        code: code,
        expectedQty: parseFloat(dataValues[i][6]) || 0
      });
    }
  }
  
  if (targetItems.length === 0) {
    SpreadsheetApp.getUi().alert('⚠️ 선택한 영역에서 E열의 [이카운트 품목코드]를 찾을 수 없습니다.');
    return;
  }

  var modeTitle = mode === 'STATUS' ? "'상태값(A열)'만" : "'목표재고(G열)'만";
  
  // 사장님 요청: 묻지도 따지지도 않고 바로 덮어씁니다!
  // var response = ui.alert('총 ' + targetItems.length + '개의 품목에 대해\n이카운트로 ' + modeTitle + ' 역전송(덮어쓰기) 하시겠습니까?', ui.ButtonSet.YES_NO);
  // if (response !== ui.Button.YES) return;

  var zone = verifyZoneAPI();
  if (!zone) return;
  var sessionData = login(zone);
  if (!sessionData || !sessionData.Data || !sessionData.Data.Datas) {
     SpreadsheetApp.getUi().alert('로그인 오류가 발생했습니다.');
     return;
  }
  var sessionId = sessionData.Data.Datas.SESSION_ID;
  
  var successCount = 0;
  var errorMessages = [];
  
  // 상태 한글 -> 이카운트 코드(CLASS_CD3) 매핑
  function mapStatusToClassCd3(status) {
    if (status === '단종품') return '9004';
    if (status === '품절') return '9003';
    if (status === '판매중(재고까지만)') return '9002';
    if (status === '특판/할인') return '9005';
    if (status === '상세제작종') return '9006';
    if (status === '소싱중') return '9007';
    if (status === '판매중') return '9001';
    return ''; 
  }

  var pUrl = 'https://oapi' + zone.toUpperCase() + '.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=' + encodeURIComponent(sessionId);

  for (var k = 0; k < targetItems.length; k++) {
    var item = targetItems[k];
    
    try {
      if (mode === 'STATUS') {
          // 1. 상태 변환 및 품목 정보 전송 (SaveBasicProduct)
          var classCd3 = mapStatusToClassCd3(item.statusStr);
          var productUrl = "https://oapi" + zone + ".ecount.com/OAPI/V2/InventoryBasic/SaveBasicProduct?SESSION_ID=" + encodeURIComponent(sessionId);
          
          if (classCd3 !== '') {
              var productPayload = {
                ProductList: [{
                  BulkDatas: {
                    PROD_CD: item.code,
                    CLASS_CD3: classCd3
                  }
                }]
              };
              
              var pOpt = {
                method: "post",
                contentType: "application/json",
                payload: JSON.stringify(productPayload),
                headers: { Accept: "application/json" },
                muteHttpExceptions: true
              };
              
              var pRes = UrlFetchApp.fetch(productUrl, pOpt);
              var result = JSON.parse(pRes.getContentText());
              if (result.Status !== "200" || (result.Data && result.Data.FailCnt && result.Data.FailCnt > 0)) {
                 throw new Error("상태 전송 실패 (" + result.Status + ")");
              }
          } else {
              // 맵핑 불가 상태는 건너뜀
              throw new Error("처리 불가 상태명 ('" + item.statusStr + "')");
          }
      } 
      else if (mode === 'INVENTORY') {
          // 2. 이카운트 현재 재고 조회
          var iReq = { "WH_CD": "100", "BASE_DATE": Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), "ZERO_FLAG": "Y", "PROD_CD": item.code };
          var iOpt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(iReq), "headers": { "Accept": "application/json" }, "muteHttpExceptions": true };
          
          var iRes = UrlFetchApp.fetch(pUrl, iOpt);
          var currentQty = 0;
          if (iRes.getResponseCode() === 200) {
             var iData = JSON.parse(iRes.getContentText());
             if (iData.Status === "200" && iData.Data && iData.Data.Result) {
                var resArr = Array.isArray(iData.Data.Result) ? iData.Data.Result : [iData.Data.Result];
                if (resArr.length > 0 && resArr[0] && resArr[0].PROD_CD === item.code) {
                   currentQty = parseFloat(resArr[0].BAL_QTY) || parseFloat(resArr[0].U_BAL_QTY) || 0;
                }
             }
          }
          
          // 3. 재고 차액 계산
          var diff = item.expectedQty - currentQty;
          
          // 4. 차액 전표 전송
          if (Math.abs(diff) > 0) {
             var ioType = (diff > 0) ? "IN" : "OUT";
             var adjustQty = Math.abs(diff);
             
             var adjPath = (ioType === "IN") ? "/OAPI/V2/Inventory/SaveInventoryAdjustIn" : "/OAPI/V2/Inventory/SaveInventoryAdjustOut";
             var adjUrl = "https://oapi" + zone + ".ecount.com" + adjPath + "?SESSION_ID=" + encodeURIComponent(sessionId);
             
             // [V2 최신 표준] BulkDatas 규격으로 전면 개편 (2026.04.16 수리)
             var adjPayload = {
                InventoryList: [{
                   BulkDatas: {
                      IO_DATE: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"),
                      WH_CD: "100",
                      PROD_CD: item.code,
                      QTY: String(adjustQty),
                      REMARK: "상품정보 재고역전송"
                   }
                }]
             };
             
             var adjOpt = {
                method: "post",
                contentType: "application/json",
                payload: JSON.stringify(adjPayload),
                headers: { Accept: "application/json" },
                muteHttpExceptions: true
             };
             
             var adjRes = UrlFetchApp.fetch(adjUrl, adjOpt);
             var result = JSON.parse(adjRes.getContentText());
             
             var errMsg = "";
             if (result.Error && result.Error.Message) errMsg = result.Error.Message;
             else if (result.Data && result.Data.Error && result.Data.Error.Message) errMsg = result.Data.Error.Message;
             else if (result.Data && result.Data.FailCnt > 0) {
                 if (result.Data.ResultDetails && result.Data.ResultDetails.length > 0 && result.Data.ResultDetails[0].TotalError) {
                     errMsg = result.Data.ResultDetails[0].TotalError;
                 } else {
                     errMsg = "API 등록 거부 (데이터 오류)";
                 }
             }
             else if (result.Status !== "200") errMsg = result.Status + " (재고통신 실패)";

             if (errMsg !== "") {
                 throw new Error(errMsg);
             }
          }
      } // end of INVENTORY mode
      
      successCount++;
      Utilities.sleep(400); 
    } catch(e) {
      errorMessages.push("[" + item.name + "] 전송에러: " + e.message);
    }
  }
  
  var msg = modeTitle + " 처리 완료! (" + successCount + "건 전송 성공)";
  if (errorMessages.length > 0) {
     msg += "\n\n⚠️ 예외/실패 " + errorMessages.length + "건:\n" + errorMessages.join("\n");
  }
  SpreadsheetApp.getUi().alert(msg);
}

// ==========================================
// 💡 [최종 진단] 이카운트 서버가 우리를 속이는지 강제로 전체 짐을 뒤져서 확인합니다.
// ==========================================
function debugEcountAPI() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var trueCodeMap = buildTrueCodeMap(ss);
  
  // 사장님이 어느 열을 클릭하셨든 무조건 그 줄의 'E열(5번째)' 값을 강제로 끌어옵니다!
  var rowIdx = sheet.getActiveCell().getRow();
  var rawCode = String(sheet.getRange(rowIdx, 5).getValue());
  var prodName = String(sheet.getRange(rowIdx, 3).getValue()); // C열 품명
  
  var strippedKey = rawCode.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  var code = trueCodeMap[strippedKey] || rawCode.trim();
  
  if (!strippedKey) {
    SpreadsheetApp.getUi().alert("해당 줄의 E열(이카운트코드)이 비어있습니다. 코드가 있는 줄을 클릭해주세요.");
    return;
  }
  
  var zone = verifyZoneAPI();
  if (!zone) return;
  var sessionData = login(zone);
  var sessionId = sessionData.Data.Datas.SESSION_ID;
  var safeSessionId = encodeURIComponent(sessionId);
  
  var resultText = "🔍 ["+ prodName + " / 검색된코드: " + code + "] 강제 수색 모드\n\n";
  
  try {
    // 코드를 지정하지 않고 100번 창고의 '모든' 재고를 일단 싹 다 가져와 봅니다.
    var iUrl = 'https://oapi' + zone.toUpperCase() + '.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=' + safeSessionId;
    var iReq = { "WH_CD": "100", "BASE_DATE": Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), "ZERO_FLAG": "Y" };
    var iOpt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(iReq), "muteHttpExceptions": true };
    var iRes = UrlFetchApp.fetch(iUrl, iOpt);
    var iData = JSON.parse(iRes.getContentText());
    
    if (iData.Status === "200" && iData.Data && iData.Data.Result) {
       var fullList = Array.isArray(iData.Data.Result) ? iData.Data.Result : [iData.Data.Result];
       resultText += "✅ 창고 전체 데이터 " + fullList.length + "개 다운로드 성공.\n\n";
       
       var foundMatch = null;
       var similarMatches = [];
       for (var f = 0; f < fullList.length; f++) {
          var serverCd = String(fullList[f].PROD_CD);
          if (serverCd === code) {
             foundMatch = fullList[f];
          } else if (serverCd.replace(/[\s\u200B-\u200D\uFEFF]/g, '') === strippedKey) {
             similarMatches.push(serverCd);
          }
       }
       
       if (foundMatch) {
          resultText += "🎯 대박 발견! 서버에 똑같은 코드가 살아있습니다.\n";
          resultText += "  - 서버코드: " + foundMatch.PROD_CD + "\n";
          resultText += "  - 현재고: " + (foundMatch.BAL_QTY || foundMatch.U_BAL_QTY) + "\n\n";
       } // <-- 여기에 누락되었던 괄호 복구
       
       // 3. 재고 전표 페이로드 최신 규격 검증 (SaveInventoryAdjustIn V2 BulkDatas)
       try {
          var adjUrl = "https://oapi" + zone.toUpperCase() + ".ecount.com/OAPI/V2/Inventory/SaveInventoryAdjustIn?SESSION_ID=" + safeSessionId;
          
          // Ecount V2 최신 표준 양식 적용
          var adjPayloadV2 = {
             InventoryList: [{
               BulkDatas: {
                 IO_DATE: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"),
                 WH_CD: "100",
                 PROD_CD: code,
                 QTY: "1",
                 REMARK: "테스트"
               }
             }]
          };
          
          var adjOpt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(adjPayloadV2), "muteHttpExceptions": true };
          var adjRes = UrlFetchApp.fetch(adjUrl, adjOpt);
          resultText += "③ (V2최신표준) 재고조정 1개 테스트 결과: HTTP " + adjRes.getResponseCode() + "\n" + adjRes.getContentText() + "\n\n";
          
       } catch(e) {
          resultText += "③ 오류: " + e.message;
       }
       
    } else {
       resultText += "❌ 전체 다운로드 실패: " + iRes.getContentText().substring(0, 50);
    }
  } catch(e) {
    resultText += "오류 발생: " + e.message;
  }
  
  SpreadsheetApp.getUi().alert(resultText);
}

// ==========================================
// 💡 [안전망] 엑셀 띄어쓰기 오류 방지용: "이카운트-품목정보"에서 진짜 코드 원형 가져오는 매퍼
// ==========================================
function buildTrueCodeMap(ss) {
  var map = {};
  var dbSheet = ss.getSheetByName("이카운트-품목정보");
  if (!dbSheet) return map;
  
  var lastRow = dbSheet.getLastRow();
  var lastCol = dbSheet.getLastColumn();
  if (lastRow < 2) return map;
  
  var headers = dbSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var cdIdx = headers.indexOf("PROD_CD");
  if (cdIdx === -1) return map;
  
  var data = dbSheet.getRange(3, cdIdx + 1, lastRow - 2, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    var trueCode = String(data[i][0]);
    var strippedKey = trueCode.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
    if (strippedKey) {
      map[strippedKey] = trueCode; // 띄어쓰기 다 지운 키 -> 이카운트의 진짜 원문 코드
    }
  }
  return map;
}
