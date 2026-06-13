/**
 * [Pack2U 기존 시스템 보호 및 정밀 수리본]
 * - 사장님의 '통합 허브(보라색)'와 '배포 시트' 연결을 절대 지우지 않습니다.
 * - #DIV/0! 오류 제거 및 ARRAYFORMULA 호환성 버그(OR 함수 불가) 완벽 수리
 * - '익월가 필터링(현재가와 같으면 숨김)' 로직 원상복구
 */

const TARGET_FOLDER_ID = "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v";

// [사라진 핵심 함수 복구] 이카운트 로그인 (fetchItem, sendItem 등에 필수)
function verifyZoneAPI() {
  var url = 'https://oapi.ecount.com/OAPI/V2/Zone'; 
  var requestData = { "COM_CODE": "176341" };
  var options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(requestData), "headers": { "Accept": "application/json" }, "muteHttpExceptions": true };
  var response = UrlFetchApp.fetch(url, options);
  var responseData = JSON.parse(response.getContentText());
  return responseData.Data ? responseData.Data.ZONE : 'CD';
}

function login(zone) {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  // ⛔ 로그인 캐싱 끄기 (세션 꼬임 방지)
  var cachedSession = null;  
  if (cachedSession) return JSON.parse(cachedSession);

  var url = "https://oapi" + zone + ".ecount.com/OAPI/V2/OAPILogin";
  var payload = {
    COM_CODE: "176341",
    USER_ID: "PACK2U",
    API_CERT_KEY: "4217bd7835e2f42db8e15f890e5aae0024",
    ZONE: zone,
    LAN_TYPE: "ko-KR"
  };
  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "Accept": "application/json" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  var resp = UrlFetchApp.fetch(url, options);
  var result = JSON.parse(resp.getContentText());
  if (result.Status == "200") {
    cache.put("ecount_session", JSON.stringify(result), 3600);
    return result;
  }
  return null;
}

function getHubSS(id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!id || id === ss.getId()) return ss;

  var lastErr = null;
  var url = "https://docs.google.com/spreadsheets/d/" + id + "/edit";
  for (var i = 0; i < 3; i++) {
    try {
      // openById 대신 openByUrl을 사용하여 구글 데이터베이스의 ID 캐시 치명적 오류를 물리적으로 우회
      var target = SpreadsheetApp.openByUrl(url);
      if (target) return target;
    } catch (e) {
      lastErr = e;
      Utilities.sleep(1500);
    }
  }

  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error(
      "❌ 시스템 치명적 지연(URL/ID 접속 모두 실패)\n- 원인: " +
        (lastErr ? lastErr.message : e.message) +
        "\n- 임시 조치: 잠시 후 다시 시도해주시거나, '✨ 시스템 초기화' 후 1번을 다시 눌러주세요.",
    );
  }
}
// 1. [허브 업그레이드] 새로 만들지 않고 "기존 허브"를 덮어씁니다.
function createStaticHub() {
  var ui = SpreadsheetApp.getUi();
  var rs = ui.prompt(
    "🗄️ 시스템 연결 유지",
    "기존에 직접 만드신 허브의 디자인과 구조만 업데이트합니다. (네 치시면 진행)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (rs.getResponseText().trim() !== "네") return;

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName("상품정보");
    var props = PropertiesService.getScriptProperties();

    // ⛔ 삭제 금지! - 사장님의 기존 ID 연결을 위해 props.deleteAllProperties() 날림
    var redundantTab = ss.getSheetByName("📊 전체 그룹 단가표(HUB)");
    if (redundantTab) ss.deleteSheet(redundantTab);

    var hubId = props.getProperty("DB_HUB_ID");

    var newHubSS;
    var isNew = false;

    var newHubSS;
    var isNew = false;

    if (hubId) {
      try {
        newHubSS = getHubSS(hubId);
      } catch (e) {
        isNew = true; // 에러 덩어리 파일 버리고 새로 만듦
      }
    } else {
      isNew = true;
    }

    if (isNew) {
      newHubSS = SpreadsheetApp.create("[Pack2U] 통합 관리 HUB (최종 완성본)");
      hubId = newHubSS.getId();
      try {
        var folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
        folder.addFile(DriveApp.getFileById(hubId));
        DriveApp.getRootFolder().removeFile(DriveApp.getFileById(hubId));
      } catch (err) {}
      props.setProperty("DB_HUB_ID", hubId);
    }

    var hubTab = newHubSS.getSheets()[0];
    hubTab.setName("전체 그룹 단가표");

    var maxCol = masterSheet.getLastColumn();
    var headerRow1 = masterSheet.getRange(1, 1, 1, maxCol).getValues()[0];
    var headerRow2 = masterSheet.getRange(2, 1, 1, maxCol).getValues()[0];

    // [완벽 그룹 분리 스캔] AS열(인덱스 44)부터 시작
    var masterGroups = {};
    var orderedGroups = [];
    for (var k = 44; k < maxCol; k++) {
      // 2행을 먼저 읽고, 비어있으면 1행의 값을 읽습니다. (병합 셀 완벽 호환)
      var gName = String(headerRow2[k]).trim();
      if (!gName || gName === "") {
        gName = String(headerRow1[k]).trim();
      }

      if (
        !gName ||
        gName.indexOf("변동가") !== -1 ||
        gName.indexOf("차액") !== -1
      )
        continue;

      if (!masterGroups[gName]) {
        masterGroups[gName] = { current: k, next: -1 };
        orderedGroups.push(gName);
      } else if (masterGroups[gName].next === -1) {
        masterGroups[gName].next = k;
      }
    }

    var maxRow = Math.max(masterSheet.getLastRow(), 6);
    var masterData = masterSheet.getRange(1, 1, maxRow, maxCol).getValues();

    var hubCurrentData = [];
    try { hubCurrentData = hubTab.getDataRange().getValues(); } catch(e) {}

    var baseInfo = [];
    for (var i = 5; i < maxRow; i++) {
      var r = masterData[i];
      baseInfo.push([
        r[0] || "",
        r[4] || "",
        r[2] || "",
        r[6] || "",
        r[23] || "",
      ]);
    }

    var newTime = Utilities.formatDate(new Date(), "Asia/Seoul", "MM.dd HH:mm");
    hubTab
      .getRange("A1:E1")
      .merge()
      .setValue("📦 전체 그룹 단가 집중 관리소 (Hub)")
      .setBackground("#434343")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    var existingF1 = "";
    try { existingF1 = hubTab.getRange("F1").getValue(); } catch(e) {}
    var f1Title = (existingF1 && existingF1 !== "") ? existingF1 : "월 변동단가 (여기에 입력하면 모든 배포 시트에 즉시 반영)";

    hubTab
      .getRange("F1:J1")
      .merge()
      .setValue(f1Title)
      .setBackground("#fff2cc")
      .setFontColor("#b45f06")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    hubTab
      .getRange("K1:O1")
      .merge()
      .setValue("🕒 업데이트: " + newTime)
      .setBackground("#674ea7")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");

    hubTab
      .getRange("A2:E3")
      .setBackground("#4a86e8")
      .setFontColor("#ffffff")
      .setHorizontalAlignment("center");
    hubTab.getRange("A2:A3").merge().setValue("상태");
    hubTab.getRange("B2:B3").merge().setValue("품목코드");
    hubTab.getRange("C2:C3").merge().setValue("품목명");
    hubTab.getRange("D2:D3").merge().setValue("재고");
    hubTab.getRange("E2:E3").merge().setValue("소비자가");

    if (baseInfo.length > 0)
      hubTab.getRange(4, 1, baseInfo.length, 5).setValues(baseInfo);

    // [초고속 일괄 처리(Batch Write) 배열 준비]
    var totalGroups = orderedGroups.length;
    var totalCols = 5 + totalGroups * 5;

    // Out of bounds 방지 (시트 공간 자동 확장)
    var currentMaxRows = hubTab.getMaxRows();
    var neededRows = Math.max(maxRow, 1000);
    if (neededRows > currentMaxRows) {
      hubTab.insertRowsAfter(currentMaxRows, neededRows - currentMaxRows + 10);
    }
    var currentMaxCols = hubTab.getMaxColumns();
    if (totalCols > currentMaxCols) {
      hubTab.insertColumnsAfter(currentMaxCols, totalCols - currentMaxCols + 2);
    }

    var row2 = new Array(totalCols).fill("");
    var row3 = new Array(totalCols).fill("");
    var row2Colors = new Array(totalCols).fill("#4a86e8");
    var row3Colors = new Array(totalCols).fill("#4a86e8");
    var rowFontColors = new Array(totalCols).fill("#ffffff");

    // 4행부터 끝까지의 데이터 배열
    var dataRowsLength = Math.max(0, maxRow - 4);
    var dataMatrix = [];
    for (var r = 0; r < dataRowsLength; r++) {
      dataMatrix.push(new Array(totalCols).fill(""));
    }

    // 1. 기본 정보 담기 (A~E열)
    row2[0] = "상태";
    row2[1] = "품목코드";
    row2[2] = "품목명";
    row2[3] = "재고";
    row2[4] = "소비자가";
    for (var i = 0; i < baseInfo.length; i++) {
      for (var c = 0; c < 5; c++) dataMatrix[i][c] = baseInfo[i][c];
    }

    // 2. 그룹별 정보 매트릭스에 꾹꾹 눌러담기
    var writeCol = 5; // F열
    var premiumColors = [
      "#1c4587",
      "#274e13",
      "#741b47",
      "#7f6000",
      "#0b5394",
      "#1155cc",
      "#38761d",
      "#990000",
      "#b45f06",
      "#4c1130",
    ];
    for (var idx = 0; idx < totalGroups; idx++) {
      var gName = orderedGroups[idx];
      var cIdx = masterGroups[gName].current;
      var nIdx = masterGroups[gName].next;

      var groupTheme = premiumColors[idx % premiumColors.length];
      for (var k = 0; k < 5; k++) {
        row2Colors[writeCol + k] = groupTheme;
        row3Colors[writeCol + k] = "#dbeaf1";
      }

      // 구별을 쉽게 2행 그룹 이름을 5셀 전체 길이에 중앙정렬 처리
      row2[writeCol] = gName;

      var exCol1 = "📊 최근변동분", exCol3 = "지난가(2)", exCol4 = "☑️ 익월변동단가";
      if (hubCurrentData.length > 2 && hubCurrentData[1]) {
        var exGroupCol = hubCurrentData[1].indexOf(gName);
        if (exGroupCol !== -1) {
          var _val1 = String(hubCurrentData[2][exGroupCol + 1]).trim();
          var _val3 = String(hubCurrentData[2][exGroupCol + 3]).trim();
          var _val4 = String(hubCurrentData[2][exGroupCol + 4]).trim();
          if (_val1) exCol1 = _val1;
          if (_val3) exCol3 = _val3;
          if (_val4) exCol4 = _val4;
        }
      }

      // [보존 로직] 3행 업데이트 시간 포함 + 사용자가 에디팅한 컬럼 이름 보존
      row3[writeCol] = "✨ 최종단가\n" + newTime;
      row3[writeCol + 1] = exCol1;
      row3[writeCol + 2] = "지난가(1)\n" + newTime;
      row3[writeCol + 3] = exCol3;
      row3[writeCol + 4] = exCol4;

      for (var j = 5; j < maxRow; j++) {
        var dpIdx = j - 5;
        // 현재가
        var p =
          masterData[j] && masterData[j][cIdx] ? masterData[j][cIdx] : "-";
        p =
          !p || String(p).trim() === "" || String(p).indexOf("#") === 0
            ? "-"
            : p;

        dataMatrix[dpIdx][writeCol] = p; // 최종단가
        dataMatrix[dpIdx][writeCol + 1] = "-"; // 변동분(빈값)
        dataMatrix[dpIdx][writeCol + 2] = p; // 지난가(1) (현재는 기초동기화라 같게)
        dataMatrix[dpIdx][writeCol + 3] = "-"; // 지난가(2)

        // 익월가
        if (nIdx !== -1) {
          var np =
            masterData[j] && masterData[j][nIdx] ? masterData[j][nIdx] : "-";
          np =
            !np || String(np).trim() === "" || String(np).indexOf("#") === 0
              ? "-"
              : np;
          dataMatrix[dpIdx][writeCol + 4] = np;
        } else {
          dataMatrix[dpIdx][writeCol + 4] = "-";
        }
      }
      writeCol += 5;
    }

    // [단 1번의 통신으로 시트 전체 그리기 및 그룹별 컬러 도색]
    // 병합된 모양을 만들기 위해 강제로 병합 진행
    hubTab
      .getRange(2, 1, 1, totalCols)
      .setValues([row2])
      .setBackgrounds([row2Colors])
      .setFontColor("#ffffff")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    hubTab
      .getRange(3, 1, 1, totalCols)
      .setValues([row3])
      .setBackgrounds([row3Colors])
      .setFontColor("#1c4587")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);

    // 각 그룹의 2행 5칸 병합
    var mCol = 6;
    for (var idx = 0; idx < totalGroups; idx++) {
      hubTab.getRange(2, mCol, 1, 5).merge();
      mCol += 5;
    }

    if (dataRowsLength > 0) {
      hubTab.getRange(4, 1, dataRowsLength, totalCols).setValues(dataMatrix);
    }
    
    // [신규 요청] 허브 통합본 상태값 조건부 서식 3종 세트
    hubTab.clearConditionalFormatRules();
    var hubCondRange = hubTab.getRange(4, 1, hubTab.getMaxRows() - 3, totalCols);
    var hubRule1 = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=ISNUMBER(SEARCH(\"품절\", $A4))").setBackground("#f4cccc").setRanges([hubCondRange]).build(); // 핑크
    var hubRule2 = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=ISNUMBER(SEARCH(\"단종\", $A4))").setBackground("#d9d9d9").setRanges([hubCondRange]).build(); // 회색
    var hubRule3 = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=ISNUMBER(SEARCH(\"재고까지만\", $A4))").setBackground("#fff2cc").setRanges([hubCondRange]).build(); // 노랑
    hubTab.setConditionalFormatRules([hubRule1, hubRule2, hubRule3]);

    SpreadsheetApp.flush(); // 모든 데이터를 서버에 완벽하게 꽂아넣고 확정합니다.
    props.setProperty("DB_CURRENT_SYNC_TIME", newTime);

    ui.alert(
      "✅ [업데이트 완료] 기존 허브(그리고 연결된 뷰어들)를 유지하며 디자인과 구조를 복구했습니다!",
    );
  } catch (e) {
    ui.alert("🚨 에러: " + e.message);
  }
}

// 2. 동기화 (#DIV/0! 직접 처리 및 계산)
function syncGroupPrices(isAuto) {
  var ui = null;
  if (!isAuto) {
    try { ui = SpreadsheetApp.getUi(); } catch(e) {}
  }
  var props = PropertiesService.getScriptProperties();
  var hubId = props.getProperty("DB_HUB_ID");
  if (!hubId) {
    if (ui) ui.alert("1번을 눌러 깨끗한 허브를 먼저 구축하세요.");
    return;
  }

  try {
    var hubSS = getHubSS(hubId);
    var hubTab = hubSS.getSheetByName("전체 그룹 단가표");
    var masterSheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName("상품정보");
    var masterData = masterSheet.getDataRange().getValues();
    var masterHeaders = masterData[1]; // 2행 (헤더)

    // 마스터 시트에서 그룹 현재가, 익월가 컬럼 인덱스 찾기
    var masterGroups = {};
    for (var k = 44; k < masterHeaders.length; k++) {
      var gName = String(masterHeaders[k]).trim();
      if (!gName || gName.indexOf("변동가") !== -1) continue;

      if (!masterGroups[gName]) {
        masterGroups[gName] = { current: k, next: -1 };
      } else if (masterGroups[gName].next === -1) {
        masterGroups[gName].next = k;
      }
    }

    var hubRange = hubTab.getDataRange();
    var hubData = hubRange.getValues();

    var time = Utilities.formatDate(new Date(), "Asia/Seoul", "MM.dd HH:mm");
    hubData[0][10] = "🕒 업데이트: " + time; // K1 셀로 이동된 업데이트 날짜 칸 덮어쓰기

    // 허브에 펼쳐진 각 그룹별로 동기화
    for (var i = 5; i < hubData[1].length; i += 5) {
      var gName = String(hubData[1][i]).trim();
      if (!gName || gName === "") continue;

      var mInfo = masterGroups[gName];
      if (!mInfo) continue; // 마스터에 없는 그룹이면 스킵

      var wColIdx = i;
      var mColIndex = mInfo.current;
      var nextMonthIdx = mInfo.next;

      // [요청 사항 복원] 헤더에 업데이트 시간 쓰기
      hubData[2][wColIdx] = "✨ 최종단가\n" + time;
      hubData[2][wColIdx + 2] = "지난가(1)\n" + time;

      for (var r = 3; r < hubData.length; r++) {
        // [현재가] 데이터 가져오기
        var mVal =
          masterData[r + 2] && masterData[r + 2][mColIndex]
            ? masterData[r + 2][mColIndex]
            : "-";
        if (String(mVal).trim() === "" || String(mVal).indexOf("#") === 0)
          mVal = "-";

        hubData[r][wColIdx + 3] = hubData[r][wColIdx + 2];
        hubData[r][wColIdx + 2] = hubData[r][wColIdx];
        hubData[r][wColIdx] = mVal;

        // "최근변동분" 안전한 사칙연산
        var cur = parseFloat(hubData[r][wColIdx]);
        var prev = parseFloat(hubData[r][wColIdx + 2]);
        if (!isNaN(cur) && !isNaN(prev)) {
          hubData[r][wColIdx + 1] = cur - prev;
        } else {
          hubData[r][wColIdx + 1] = "-";
        }

        // [익월가] 데이터 가져오기
        if (nextMonthIdx !== -1) {
          var nVal =
            masterData[r + 2] && masterData[r + 2][nextMonthIdx]
              ? masterData[r + 2][nextMonthIdx]
              : "-";
          if (String(nVal).trim() === "" || String(nVal).indexOf("#") === 0)
            nVal = "-";
          hubData[r][wColIdx + 4] = nVal;
        } else {
          hubData[r][wColIdx + 4] = "-";
        }
      }
    }
    hubRange.setValues(hubData);
    props.setProperty("DB_CURRENT_SYNC_TIME", time);
    if (ui) ui.alert("🚀 동기화 완료! 모든 수식 에러가 세척되었습니다.");
  } catch (e) {
    if (ui) ui.alert("🚨 에러: " + e.message);
    else console.error("syncGroupPrices 에러: " + e.message);
  }
}

// 4. 배포 시트 생성 (스마트 필터링 및 ARRAYFORMULA 버그 수정 적용)
function createVendorVlookupSheet() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var hubId = props.getProperty("DB_HUB_ID");
  if (!hubId) return ui.alert("1번을 눌러 깨끗한 허브를 먼저 구축하세요.");

  try {
    var hubSS = getHubSS(hubId);
    var hubTab = hubSS.getSheetByName("전체 그룹 단가표");
    var hubData = hubTab.getDataRange().getValues();

    var groupLocs = {};
    for (var i = 5; i < hubData[1].length; i += 5) {
      var gName = String(hubData[1][i]).trim();
      if (gName && gName !== "") {
        groupLocs[gName] = i + 1;
      }
    }

    var groupListStr = Object.keys(groupLocs).join("  /  ");
    var promptMsg =
      "👉 아래 나열된 그룹 중 하나를 드래그+복사(Ctrl+C)하여 빈칸에 붙여넣으세요(Ctrl+V):\n\n" +
      "[ " +
      groupListStr +
      " ]\n\n" +
      "⚠️ 대소문자나 띄어쓰기가 틀리면 생성되지 않습니다.";

    var response = ui.prompt(
      "🔗 배포용 시트 (뷰어) 발급기",
      promptMsg,
      ui.ButtonSet.OK_CANCEL,
    );
    if (response.getSelectedButton() !== ui.Button.OK) return;

    var groupName = response.getResponseText().trim();
    if (!groupLocs[groupName]) {
      return ui.alert(
        "🚨 오류: ['" +
          groupName +
          "'] 은(는) 존재하지 않는 그룹명입니다. 복사/붙여넣기를 이용해주세요.",
      );
    }

    var vendorName = ui
      .prompt("업체명", "배포 시트 이름", ui.ButtonSet.OK_CANCEL)
      .getResponseText()
      .trim();
    if (!vendorName) return;

    var newSS = SpreadsheetApp.create("[독립 배포] " + vendorName);
    var fileId = newSS.getId();
    try {
      DriveApp.getFolderById(TARGET_FOLDER_ID).addFile(
        DriveApp.getFileById(fileId),
      );
      DriveApp.getRootFolder().removeFile(DriveApp.getFileById(fileId));
    } catch (e) {}

    var sheet = newSS.getSheets()[0];
    sheet.setName(vendorName + " 뷰어");

    // [요청 사항 복원] 커스텀 '익월단가' 텍스트를 허브 F1셀과 실시간 연동!
    var customTitleForm =
      '=IF(ISBLANK(IMPORTRANGE("' +
      hubId +
      '", "전체 그룹 단가표!F1")), "익월변동단가", IMPORTRANGE("' +
      hubId +
      '", "전체 그룹 단가표!F1"))';
    sheet
      .getRange("A1:H1")
      .setValues([
        [
          "상태",
          "품목코드(입력👇)",
          "품목명",
          "소비자가",
          "최종단가",
          "단가변동",
          "지난단가",
          "-",
        ],
      ]);
    sheet.getRange("H1").setFormula(customTitleForm);
    sheet
      .getRange("A1:H1")
      .setBackground("#cfe2f3")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    sheet.getRange("B1").setBackground("#fff2cc"); // 입력칸 시각적 강조

    sheet.getRange("K1").setValue(groupLocs[groupName]).setFontColor("white");

    var hubLink = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!';
    var ids = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!B:B")';

    sheet
      .getRange("A2")
      .setFormula(
        '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
          ids +
          ", " +
          hubLink +
          'A:A")), "-")))',
      );
    sheet
      .getRange("C2")
      .setFormula(
        '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
          ids +
          ", " +
          hubLink +
          'C:C")), "-")))',
      );
    sheet
      .getRange("D2")
      .setFormula(
        '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
          ids +
          ", " +
          hubLink +
          'E:E")), "-")))',
      ); // 소비가 추가

    var eRange =
      'SUBSTITUTE(ADDRESS(1, K1, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K1, 4), "1", "")';
    sheet
      .getRange("E2")
      .setFormula(
        '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
          ids +
          ', IMPORTRANGE("' +
          hubId +
          '", "전체 그룹 단가표!" & ' +
          eRange +
          ')), "-")))',
      );

    var gRange =
      'SUBSTITUTE(ADDRESS(1, K1+2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K1+2, 4), "1", "")';
    sheet
      .getRange("G2")
      .setFormula(
        '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
          ids +
          ', IMPORTRANGE("' +
          hubId +
          '", "전체 그룹 단가표!" & ' +
          gRange +
          ')), "-")))',
      );

    // [F열 완벽 교정] ARRAYFORMULA 내부에서는 OR 함수가 병합되므로 쓸 수 없습니다. 값 빼기가 불가능한 경우 방어.
    sheet
      .getRange("F2")
      .setFormula(
        '=ARRAYFORMULA(IF(B2:B="", "", IFERROR(IF(E2:E=G2:G, "-", E2:E-G2:G), "-")))',
      );

    // [H열: 익월가 스마트 필터링] (현재가와 같거나 비어있으면 숨김) 배열 수식 호환용 특수 구문 (+) 처리 완료!
    var hRange =
      'SUBSTITUTE(ADDRESS(1, K1+4, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K1+4, 4), "1", "")';
    sheet
      .getRange("H2")
      .setFormula(
        '=ARRAYFORMULA(IF(B2:B="", "", LET(nxt, IFNA(XLOOKUP(B2:B, ' +
          ids +
          ', IMPORTRANGE("' +
          hubId +
          '", "전체 그룹 단가표!" & ' +
          hRange +
          ')), "-"), IF((nxt="-") + (nxt="") + (nxt=E2:E), "-", nxt))))',
      );

    // 세부 디자인 ও 포맷팅 복원 (가격 콤마, 빨간색 폰트, 품절 시 핑크색 행 조건부 서식)
    sheet.getRange("D2:H1000").setNumberFormat("#,##0");
    sheet.getRange("E2:F1000").setFontColor("red"); // 최종단가, 단가변동은 붉은색 강조
    sheet.getRange("G2:G1000").setFontColor("#666666"); // 지난단가는 진한회색 적용
    sheet.getRange("H2:H1000").setFontColor("blue"); // 익월단가는 파란색으로 확 눈에 띄게 적용

    // [중요: IMPORTRANGE 권한 뚫기 전용 셀] 일반 업체들에게 보이지 않도록 Z1 셀에 흰색(투명)으로 숨깁니다.
    sheet.getRange("I1:J1").clearContent(); // 예전에 보였던 경고창 삭제
    sheet.getRange("Z1").setFormula('=IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!A1")').setFontColor("white");

    // [신규 요청] 독립 뷰어 시트 상태값 조건부 서식 3종 세트
    sheet.clearConditionalFormatRules();
    var vRange = sheet.getRange("A2:H1000");
    var rulePink = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=ISNUMBER(SEARCH(\"품절\", $A2))")
      .setBackground("#f4cccc")
      .setRanges([vRange])
      .build();
    var ruleGray = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=ISNUMBER(SEARCH(\"단종\", $A2))")
      .setBackground("#d9d9d9")
      .setRanges([vRange])
      .build();
    var ruleYellow = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=ISNUMBER(SEARCH(\"재고까지만\", $A2))")
      .setBackground("#ffe599")
      .setRanges([vRange])
      .build();
    sheet.setConditionalFormatRules([rulePink, ruleGray, ruleYellow]);

    // [신규 시스템] 발주 및 송장조회 탭 생성
    var orderTab = newSS.insertSheet("발주 및 송장조회");
    orderTab.getRange("A1:I1").setValues([[
      "발주일자", "품목코드", "품목명", "수량", "수취인", "연락처", "주소", "처리상태", "운송장번호"
    ]]);
    orderTab.getRange("A1:I1").setBackground("#4a86e8").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
    // 사용자가 입력하기 편하게 틀고정
    orderTab.setFrozenRows(1);
    // H, I 열(처리상태, 운송장번호)은 자동 연동되므로 살짝 붉은 톤으로 사용자 입력 지양 유도
    orderTab.getRange("H1:I1").setBackground("#38761d");
    orderTab.getRange("A2:I1000").setVerticalAlignment("middle");
    orderTab.getRange("H2:I1000").setBackground("#fce5cd");

    ui.alert("🎁 생성 성공! 사장님의 기획 의도가 100% 반영되었습니다.");
  } catch (e) {
    ui.alert("🚨 에러: " + e.message);
  }
}


function resetSystem() {
  PropertiesService.getScriptProperties().deleteAllProperties();
}
function findMyHub() {
  ui.alert(
    "허브ID: " +
      PropertiesService.getScriptProperties().getProperty("DB_HUB_ID"),
  );
}
function syncStatusOnly(isAuto) {
  syncGroupPrices(isAuto);
}

// [신규 도입] 기존의 모든 배포 시트(뷰어)를 원클릭으로 최신 디자인/수식으로 일괄 업데이트하는 기능
function updateAllVendorSheets() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var hubId = props.getProperty("DB_HUB_ID");
  if (!hubId)
    return ui.alert("🚨 [오류] 먼저 1번 메뉴를 눌러 허브를 구축하셔야 합니다.");

  var response = ui.alert(
    "🔄 독립 시트 일괄 업데이트",
    "구글 드라이브(Pack2U 폴더)에 등록된 과거의 모든 배포 시트를 현재 최신 양식과 디자인으로 강제 업데이트 하시겠습니까?",
    ui.ButtonSet.YES_NO,
  );
  if (response !== ui.Button.YES) return;

  var folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
  var files = folder.getFiles();
  var updatedCount = 0;
  var startTime = new Date().getTime();
  var errorLog = [];

  while (files.hasNext()) {
    // 제한 시간 3분(180초)으로 축소: 1개 처리당 오래 걸릴 수 있으므로 넉넉한 마진 확보
    if (new Date().getTime() - startTime > 180000) {
      ui.alert("⏳ 작업 제한 시간 도달\n\n구글 서버 제한에 도달하기 전 안전하게 멈췄습니다.\n\n지금까지 " + updatedCount + "개의 시트가 완료되었습니다. 다시 메뉴를 실행해 이어서 진행해주세요.");
      return;
    }

    var file = files.next();
    if (file.getName().indexOf("[독립 배포]") !== -1) {
      try {
        var sheetId = file.getId();
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheets()[0];

        var k1Val = sheet.getRange("K1").getValue();
        if (!k1Val) continue; // 올바른 뷰어 시트가 아니면 스킵
        var K1 = parseInt(k1Val, 10);
        if (isNaN(K1)) continue;

        // 헤더 갱신
        var customTitleForm =
          '=IF(ISBLANK(IMPORTRANGE("' +
          hubId +
          '", "전체 그룹 단가표!F1")), "익월변동단가", IMPORTRANGE("' +
          hubId +
          '", "전체 그룹 단가표!F1"))';
        sheet
          .getRange("A1:H1")
          .setValues([
            [
              "상태",
              "품목코드(입력👇)",
              "품목명",
              "소비자가",
              "최종단가",
              "단가변동",
              "지난단가",
              "-",
            ],
          ]);
        sheet.getRange("H1").setFormula(customTitleForm);
        sheet
          .getRange("A1:H1")
          .setBackground("#cfe2f3")
          .setFontColor("#000000")
          .setFontWeight("bold")
          .setHorizontalAlignment("center");
        sheet.getRange("B1").setBackground("#fff2cc");

        // 최신 수식 덮어쓰기 (K1 활용)
        var hubLink = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!';
        var ids = 'IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!B:B")';

        sheet
          .getRange("A2")
          .setFormula(
            '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
              ids +
              ", " +
              hubLink +
              'A:A")), "-")))',
          );
        sheet
          .getRange("C2")
          .setFormula(
            '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
              ids +
              ", " +
              hubLink +
              'C:C")), "-")))',
          );
        sheet
          .getRange("D2")
          .setFormula(
            '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
              ids +
              ", " +
              hubLink +
              'E:E")), "-")))',
          ); // 소비자가 정상 동기화

        var eRange =
          'SUBSTITUTE(ADDRESS(1, K1, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K1, 4), "1", "")';
        sheet
          .getRange("E2")
          .setFormula(
            '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
              ids +
              ', IMPORTRANGE("' +
              hubId +
              '", "전체 그룹 단가표!" & ' +
              eRange +
              ')), "-")))',
          );

        var gRange =
          'SUBSTITUTE(ADDRESS(1, K1+2, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K1+2, 4), "1", "")';
        sheet
          .getRange("G2")
          .setFormula(
            '=ARRAYFORMULA(IF(B2:B="", "", IFNA(XLOOKUP(B2:B, ' +
              ids +
              ', IMPORTRANGE("' +
              hubId +
              '", "전체 그룹 단가표!" & ' +
              gRange +
              ')), "-")))',
          );

        sheet
          .getRange("F2")
          .setFormula(
            '=ARRAYFORMULA(IF(B2:B="", "", IFERROR(IF(E2:E=G2:G, "-", E2:E-G2:G), "-")))',
          );

        var hRange =
          'SUBSTITUTE(ADDRESS(1, K1+4, 4), "1", "") & ":" & SUBSTITUTE(ADDRESS(1, K1+4, 4), "1", "")';
        sheet
          .getRange("H2")
          .setFormula(
            '=ARRAYFORMULA(IF(B2:B="", "", LET(nxt, IFNA(XLOOKUP(B2:B, ' +
              ids +
              ', IMPORTRANGE("' +
              hubId +
              '", "전체 그룹 단가표!" & ' +
              hRange +
              ')), "-"), IF((nxt="-") + (nxt="") + (nxt=E2:E), "-", nxt))))',
          );

        // 디자인 서식 최신화
        var maxRows = sheet.getMaxRows();
        var maxDataRowLength = Math.max(2, maxRows - 1);
        
        // Out of bounds 방지를 위해 필요한 컬럼 수(8개, H열) 확인 및 확보
        if (sheet.getMaxColumns() < 8) {
             sheet.insertColumnsAfter(sheet.getMaxColumns(), 8 - sheet.getMaxColumns());
        }

        sheet.getRange(2, 4, maxDataRowLength, 5).setNumberFormat("#,##0"); // D2:H
        sheet.getRange(2, 5, maxDataRowLength, 2).setFontColor("red"); // E2:F
        sheet.getRange(2, 7, maxDataRowLength, 1).setFontColor("#666666"); // G2:G
        sheet.getRange(2, 8, maxDataRowLength, 1).setFontColor("blue"); // H2:H
        
        // [중요: IMPORTRANGE 권한 뚫기 전용 셀] 벤더들에게 보이지 않도록 가장 끝인 Z1 구석에 흰색으로 숨깁니다.
        sheet.getRange("I1:J1").clearContent(); // 이전에 만들어진 텍스트 청소
        if (sheet.getMaxColumns() < 26) {
             sheet.insertColumnsAfter(sheet.getMaxColumns(), 26 - sheet.getMaxColumns());
        }
        sheet.getRange("Z1").setFormula('=IMPORTRANGE("' + hubId + '", "전체 그룹 단가표!A1")').setFontColor("white");

        // [신규 요청] 독립 뷰어 시트 상태값 조건부 서식 3종 세트 최신화
        sheet.clearConditionalFormatRules();
        var vUpRange = sheet.getRange(2, 1, maxDataRowLength, 8); // A2:H
        var upRulePink = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied("=ISNUMBER(SEARCH(\"품절\", $A2))")
          .setBackground("#f4cccc")
          .setRanges([vUpRange])
          .build();
        var upRuleGray = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied("=ISNUMBER(SEARCH(\"단종\", $A2))")
          .setBackground("#d9d9d9")
          .setRanges([vUpRange])
          .build();
        var upRuleYellow = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied("=ISNUMBER(SEARCH(\"재고까지만\", $A2))")
          .setBackground("#ffe599")
          .setRanges([vUpRange])
          .build();
        sheet.setConditionalFormatRules([upRulePink, upRuleGray, upRuleYellow]);

        // [신규 시스템 일괄 적용] 기존 뷰어 시트에도 발주 탭 누락 시 생성
        var orderTabEx = ss.getSheetByName("발주 및 송장조회");
        if (!orderTabEx) {
            orderTabEx = ss.insertSheet("발주 및 송장조회");
            orderTabEx.getRange("A1:I1").setValues([[
                "발주일자", "품목코드", "품목명", "수량", "수취인", "연락처", "주소", "처리상태", "운송장번호"
            ]]);
            orderTabEx.getRange("A1:I1").setBackground("#4a86e8").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
            orderTabEx.setFrozenRows(1);
            orderTabEx.getRange("H1:I1").setBackground("#38761d");
            orderTabEx.getRange("A2:I1000").setVerticalAlignment("middle");
            orderTabEx.getRange("H2:I1000").setBackground("#fce5cd");
        }

        updatedCount++;
        SpreadsheetApp.flush(); // 무거운 시트 객체를 메모리에서 즉시 털어내어 끊김/크래시 방지
        Utilities.sleep(500); // 0.5초 휴식하여 이카운트 및 구글 DB 부하 방지
      } catch (e) {
        // 에러를 모아서 마지막에 추적 가능하게 정리
        errorLog.push(file.getName() + " (" + e.message + ")");
      }
    }
  }

  var msg = "🎉 업그레이드 완료!\n\n총 " + updatedCount + "개의 배포 시트 양식이 최신 버전으로 일괄 동기화 되었습니다.";
  if (errorLog.length > 0) {
    msg += "\n\n⚠️ 일부 시트에서 오류가 발생하여 건너뛰었습니다 (" + errorLog.length + "개):\n";
    for (var i=0; i<Math.min(5, errorLog.length); i++) {
        msg += "- " + errorLog[i] + "\n";
    }
    if (errorLog.length > 5) msg += "등등...";
  }
  ui.alert(msg);
}
