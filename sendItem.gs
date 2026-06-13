function sendItemToEcount() {
  var startTime = new Date().getTime(); // 시작 시간 측정
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("품목등록,변경");

  if (!sheet) {
    SpreadsheetApp.getUi().alert('❌ "품목등록,변경" 시트를 찾을 수 없습니다.');
    return;
  }

  if (ss.getActiveSheet().getName() !== "품목등록,변경") {
    SpreadsheetApp.getUi().alert(
      '⚠️ 잠시만요!\n\n현재 보고 계신 창이 "품목등록,변경" 시트가 아닙니다!\n\n업로드를 하시려면 하단 탭에서 "품목등록,변경" 시트로 이동하신 뒤, 업로드할 데이터를 거기에 붙여넣고 줄을 선택하여 전송해주세요.',
    );
    return;
  }

  // 🔥 [긴급 캐시 폭파 로직] 이카운트에 의해 밴(Ban)당한 기존 세션 강제 삭제
  try {
    var props = PropertiesService.getScriptProperties();
    var keys = props.getKeys();
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].toLowerCase().indexOf("session") !== -1) {
        props.deleteProperty(keys[k]);
      }
    }
    var cache = CacheService.getScriptCache();
    cache.remove("SESSION_ID");
    cache.remove("ecount_session");
  } catch (e) {}

  var dataStartRow = 2;
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
    SpreadsheetApp.getUi().alert(
      "⚠️ 유효한 전송 범위를 마우스로 드래그하여 지정(선택)해 주세요.",
    );
    return;
  }

  var zone = verifyZoneAPI();
  if (!zone) return;
  var sessionData = login(zone);
  if (!sessionData || !sessionData.Data || !sessionData.Data.Datas) return;
  var sessionId = sessionData.Data.Datas.SESSION_ID;

  var url =
    "https://oapi" +
    zone +
    ".ecount.com/OAPI/V2/InventoryBasic/SaveBasicProduct?SESSION_ID=" +
    sessionId;
  var data = sheet
    .getRange(selectedStartRow, 1, selectedNumRows, 27)
    .getValues();

  // ✅ 결과를 모아서 한 번에 기록하기 위한 배열 (속도 100배 향상)
  var resultsArray = [];
  for (var k = 0; k < data.length; k++) {
    resultsArray.push([data[k][26]]); // 기존 AA열 데이터 유지
  }

  var successCount = 0;
  var failCount = 0;
  var skipCount = 0;
  var isTimeout = false;

  for (var i = 0; i < data.length; i++) {
    // ✅ 4.5분(270,000ms) 경과 시 탈출 (여유분을 두어 벌크 업데이트 시간 확보)
    if (new Date().getTime() - startTime > 270000) {
      isTimeout = true;
      break;
    }

    var row = data[i];
    var prodCd = String(row[0]).trim();
    var prodNm = String(row[1]).trim();
    var resultText = String(row[26] || "").trim();

    if (!prodCd && !prodNm && !resultText) continue;

    if (resultText.indexOf("✅ 성공") !== -1) {
      skipCount++;
      continue;
    }

    if (!prodCd || !prodNm) {
      resultsArray[i][0] = "⚠️ 품목코드 또는 품목명 누락";
      failCount++;
      continue;
    }

    var payload = {
      ProductList: [
        {
          BulkDatas: {
            PROD_CD: prodCd,
            PROD_DES: prodNm,
            PROD_TYPE: String(row[2]).trim() || "3",
            UNIT: String(row[3]).trim() || "",
            OUT_PRICE: row[4] !== "" ? String(row[4]) : "",
            IN_PRICE: row[5] !== "" ? String(row[5]) : "",
            REMARKS: String(row[6]).trim() || "",
            SET_FLAG: String(row[7]).trim() === "1" ? "1" : "0",
          },
        },
      ],
    };

    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      headers: { Accept: "application/json" },
      muteHttpExceptions: true,
    };

    try {
      var response = UrlFetchApp.fetch(url, options);
      var result = JSON.parse(response.getContentText());

      var isSuccess = false;
      var errMsg = "알 수 없는 오류";

      // 이카운트는 Status 200을 주고도 Error 객체를 던지거나 FailCnt가 1일 수 있는 악덕 서버입니다. 완벽하게 잡아냅니다.
      if (result.Error && result.Error.Message) {
        errMsg = result.Error.Message;
      } else if (
        result.Data &&
        result.Data.Error &&
        result.Data.Error.Message
      ) {
        errMsg = result.Data.Error.Message;
      } else if (result.Status !== "200") {
        errMsg = "네트워크 응답 오류 (" + result.Status + ")";
      } else if (
        result.Data &&
        result.Data.FailCnt &&
        parseInt(result.Data.FailCnt) > 0
      ) {
        // 데이터 포맷 오류 (예: 세트여부 형식 오류 등)
        errMsg = "데이터 등록 거부";
        if (
          result.Data.ResultDetails &&
          result.Data.ResultDetails.length > 0 &&
          result.Data.ResultDetails[0].TotalError
        ) {
          errMsg = result.Data.ResultDetails[0].TotalError;
        }
      } else {
        isSuccess = true;
      }

      if (isSuccess) {
        var now = Utilities.formatDate(
          new Date(),
          "GMT+9",
          "yyyy-MM-dd HH:mm:ss",
        );
        resultsArray[i][0] = "✅ 성공 " + now;
        successCount++;
      } else {
        resultsArray[i][0] = "❌ 실패: " + errMsg;
        failCount++;
      }
    } catch (e) {
      resultsArray[i][0] = "❌ 시스템 오류: " + e.message;
      failCount++;
    }
  }

  // ✅ 루프 종료 후 변경된 결과값만 모두 모아서 단 한 번에 시트에 덮어쓰기! (초고속)
  sheet
    .getRange(selectedStartRow, 27, resultsArray.length, 1)
    .setValues(resultsArray);
  SpreadsheetApp.flush();

  var finalMsg =
    "전송 완료\n\n" +
    "✅ 전송 성공: " +
    successCount +
    "건\n" +
    "❌ 전송 실패: " +
    failCount +
    "건\n" +
    "⏭️ 성공 스킵: " +
    skipCount +
    "건";

  if (isTimeout) {
    finalMsg +=
      "\n\n⏳ [안전 정지] 데이터가 대량이어서 최대 실행시간에 도달했습니다.\n전송 버튼을 다시 한 번 눌러주시면 실패/대기 항목부터 이어서 전송됩니다!";
  }

  SpreadsheetApp.getUi().alert(finalMsg);
}
