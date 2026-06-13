function sendInventoryToEcount() {
  var startTime = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('재고조정입력');

  if (!sheet) {
    createInventorySheet();
    return;
  }

  var dataStartRow = 3;
  var activeRange = sheet.getActiveRange();
  var selectedStartRow = activeRange.getRow();
  var selectedNumRows = activeRange.getNumRows();

  // 사용자가 헤더(1~2행)까지 포함해서 드래그했을 경우 데이터가 있는 3행부터로 조정
  if (selectedStartRow < dataStartRow) {
    var diff = dataStartRow - selectedStartRow;
    selectedStartRow = dataStartRow;
    selectedNumRows = selectedNumRows - diff;
  }

  if (selectedNumRows < 1) {
    SpreadsheetApp.getUi().alert('⚠️ 유효한 전송 범위를 마우스로 드래그하여 지정(선택)해 주세요.');
    return;
  }

  var zone = verifyZoneAPI();
  if (!zone) return;
  var sessionData = login(zone);
  if (!sessionData) return;
  var sessionId = sessionData.Data.Datas.SESSION_ID;

  var data = sheet.getRange(selectedStartRow, 1, selectedNumRows, 8).getValues();

  var resultsArray = [];
  for (var k = 0; k < data.length; k++) {
    resultsArray.push([data[k][7]]);
  }

  var groups = {};
  var skipCount = 0;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var resultText = String(row[7] || '').trim(); // H열은 7번 인덱스
    var rawDate = String(row[0]||'').trim();
    var ioType = String(row[1]||'').trim().toUpperCase();
    var prodCd = String(row[2]||'').trim();

    if (!rawDate && !prodCd && !resultText) continue;

    if (resultText.indexOf('✅ 성공') !== -1) {
      skipCount++;
      continue;
    }

    var slipDate = _formatDate(row[0]);
    var key = slipDate + '||' + ioType;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ rowIndex: i, row: row });
  }

  var successCount = 0;
  var failCount = 0;
  var isTimeout = false;

  for (var key in groups) {
    if (new Date().getTime() - startTime > 290000) {
      isTimeout = true; break; 
    }

    var group = groups[key];
    var firstRow = group[0].row;
    var slipDate = _formatDate(firstRow[0]);
    var ioType = String(firstRow[1]).trim().toUpperCase();

    if (!slipDate || (ioType !== 'IN' && ioType !== 'OUT')) {
      for (var g = 0; g < group.length; g++) {
        resultsArray[group[g].rowIndex][0] = '⚠️ 처리일자 또는 IN/OUT 지정 누락';
      }
      failCount++; continue; 
    }

    var prodList = [];
    for (var g = 0; g < group.length; g++) {
      var r = group[g].row;
      var prodCd = String(r[2]).trim();
      var qty = parseFloat(r[3]) || 0;
      if (!prodCd || qty === 0) continue;

      prodList.push({
        "PROD_CD": prodCd,
        "QTY": String(qty),
        "PRICE": r[4] !== '' ? String(parseFloat(r[4])) : '',
        "WH_CD": String(r[5]).trim() || '',
        "REMARK": String(r[6]).trim() || ''
      });
    }

    if (prodList.length === 0) { failCount++; continue; }
    var apiPath = ioType === 'IN' ? '/OAPI/V2/Inventory/SaveInventoryAdjustIn' : '/OAPI/V2/Inventory/SaveInventoryAdjustOut';
    var url = 'https://oapi' + zone + '.ecount.com' + apiPath + '?SESSION_ID=' + sessionId;
    var payload = { "IO_DATE": slipDate, "List": prodList };
    var options = {
      "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload),
      "headers": { "Accept": "application/json" }, "muteHttpExceptions": true
    };

    try {
      var response = UrlFetchApp.fetch(url, options);
      var result = JSON.parse(response.getContentText());
      
      var isSuccess = false;
      var errMsg = "알 수 없는 오류";
      
      if (result.Error && result.Error.Message) {
        errMsg = result.Error.Message;
      } else if (result.Data && result.Data.Error && result.Data.Error.Message) {
        errMsg = result.Data.Error.Message;
      } else if (result.Status !== '200') {
        errMsg = "네트워크 응답 오류 (" + result.Status + ")";
      } else {
        isSuccess = true;
      }

      var now = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm:ss');
      for (var g = 0; g < group.length; g++) {
        if (isSuccess) {
          resultsArray[group[g].rowIndex][0] = '✅ 성공 ' + now;
        } else {
          resultsArray[group[g].rowIndex][0] = '❌ 실패: ' + errMsg;
        }
      }
      if (isSuccess) successCount++; else failCount++;
    } catch (e) {
      for (var g = 0; g < group.length; g++) {
        resultsArray[group[g].rowIndex][0] = '❌ 시스템 오류';
      }
      failCount++;
    }
  }
  
  sheet.getRange(selectedStartRow, 8, resultsArray.length, 1).setValues(resultsArray);
  SpreadsheetApp.flush();

  var finalMsg = '전송 완료\n\n✅ 성공: ' + successCount + '개\n❌ 실패: ' + failCount + '개\n⏭️ 스킵: ' + skipCount + '건';
  if (isTimeout) finalMsg += '\n\n⏳ [안전 정지] 처리 시간이 길어져 자동 정지되었습니다.\n다시 전송을 누르시면 이어서 진행됩니다.';
  SpreadsheetApp.getUi().alert(finalMsg);
}

function createInventorySheet() {
  SpreadsheetApp.getUi().alert('재고조정입력 시트가 없습니다. 시트를 생성하거나 이름을 변경해주세요.');
}
