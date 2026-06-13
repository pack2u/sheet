// 구글 스크립트 기반 발주(주문) 취합 및 송장 연동 시스템
const ORDER_TARGET_FOLDER_ID = "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v";

function getOrderHubTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("통합 발주 DB");
  if (!sheet) {
    sheet = ss.insertSheet("통합 발주 DB");
    sheet.getRange("A1:L1").setValues([[
      "수집일시", "발주업체", "발주고유ID", "발주일자", "품목코드", "품목명", "수량", "수취인", "연락처", "주소", "처리상태", "운송장번호"
    ]]);
    sheet.getRange("A1:L1").setBackground("#38761d").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 판매업체의 발주 데이터를 허브로 취합 (오전 8시/오후 2시)
function pullOrdersFromVendors() {
  var ui = SpreadsheetApp.getUi();
  var folder = DriveApp.getFolderById(ORDER_TARGET_FOLDER_ID);
  var files = folder.getFiles();
  var hubSheet = getOrderHubTab();
  
  // 기존에 이미 취합된 고유ID 목록을 가져옵니다 (중복 방지)
  var lastRow = hubSheet.getLastRow();
  var existingIds = {};
  if (lastRow > 1) {
    var idData = hubSheet.getRange(2, 3, lastRow - 1, 1).getValues();
    for (var i = 0; i < idData.length; i++) {
        if(idData[i][0]) existingIds[idData[i][0]] = true;
    }
  }

  var newOrders = [];
  var now = new Date();
  var timeStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

  while (files.hasNext()) {
    var file = files.next();
    if (file.getName().indexOf("[독립 배포]") !== -1) {
      var vendorName = file.getName().replace("[독립 배포]", "").trim();
      var ss;
      try { ss = SpreadsheetApp.openById(file.getId()); } catch(e) { continue; }
      
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (!orderTab) continue; 
      
      var lr = orderTab.getLastRow();
      if (lr <= 1) continue;
      
      var data = orderTab.getRange(2, 1, lr - 1, 9).getValues();
      for (var r = 0; r < data.length; r++) {
        var orderDate = data[r][0]; // A열: 발주일자
        var itemCode = data[r][1]; // B열
        var qty = data[r][3]; // C->D열 등. 구조맞춤
        var phone = data[r][5]; // 폰번호 결합시
        
        if (!orderDate || !itemCode) continue; // 필수값 없으면 패스
        
        // 고유 ID 생성 (업체명 + 발주일 + 품목 + 연락처 끝 4자리)
        var strPhone = String(phone).replace(/[^0-9]/g, "");
        var shortPhone = strPhone.substring(strPhone.length - 4);
        var dateStr = (orderDate instanceof Date) ? Utilities.formatDate(orderDate, "Asia/Seoul", "MMdd") : String(orderDate);
        var uniqueId = vendorName + "-" + dateStr + "-" + itemCode + "-" + shortPhone;
        
        if (!existingIds[uniqueId]) {
          newOrders.push([
            timeStr, // 수집일시
            vendorName,
            uniqueId,
            orderDate,
            itemCode,
            data[r][2], // 품목명
            data[r][3], // 수량
            data[r][4], // 수취인
            data[r][5], // 연락처
            data[r][6], // 주소
            data[r][7] || "접수 대기", // 처리상태 (기본값)
            data[r][8] || "" // 송장번호
          ]);
          existingIds[uniqueId] = true;
        }
      }
    }
  }

  if (newOrders.length > 0) {
    hubSheet.getRange(hubSheet.getLastRow() + 1, 1, newOrders.length, 12).setValues(newOrders);
    SpreadsheetApp.flush();
    ui.alert("✅ " + newOrders.length + "건의 신규 발주 데이터가 취합되었습니다.");
  } else {
    ui.alert("ℹ️ 새로 추가된 발주 건이 없습니다.");
  }
}

// 송장/상태 변경본을 각 뷰어로 쏘아주기 (푸시)
function pushInvoicesToVendors() {
  var ui = SpreadsheetApp.getUi();
  var msg = ui.alert("🔄 송장 푸시", "현재 통합 발주 DB에 입력된 [처리상태] 및 [운송장번호]를 각 뷰어(결과값)에 적용(덮어쓰기) 하시겠습니까?", ui.ButtonSet.YES_NO);
  if(msg !== ui.Button.YES) return;

  var hubSheet = getOrderHubTab();
  var hubLr = hubSheet.getLastRow();
  if (hubLr <= 1) return ui.alert("데이터 없음.");

  var hubData = hubSheet.getRange(2, 2, hubLr - 1, 11).getValues(); 
  // 업체명[0], 고유ID[1], 날짜[2], 품목코드[3], 명[4], 수량[5], 수취인[6], 번호[7], 주소[8], 상태[9], 송장[10]
  
  // 업체별로 데이터 그룹화
  var vendorMap = {};
  for (var i = 0; i < hubData.length; i++) {
    var vName = hubData[i][0];
    var uid = hubData[i][1];
    var status = hubData[i][9];
    var invoice = hubData[i][10];
    if (!vName || !uid) continue;
    if (!vendorMap[vName]) vendorMap[vName] = {};
    vendorMap[vName][uid] = { status: status, invoice: invoice };
  }

  var folder = DriveApp.getFolderById(ORDER_TARGET_FOLDER_ID);
  var files = folder.getFiles();
  var pushCount = 0;

  while (files.hasNext()) {
    var file = files.next();
    if (file.getName().indexOf("[독립 배포]") !== -1) {
      var vendorName = file.getName().replace("[독립 배포]", "").trim();
      if (!vendorMap[vendorName]) continue;
      
      var ss;
      try { ss = SpreadsheetApp.openById(file.getId()); } catch(e) { continue; }
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (!orderTab) continue;
      
      var lr = orderTab.getLastRow();
      if (lr <= 1) continue;
      
      var data = orderTab.getRange(2, 1, lr - 1, 9).getValues();
      var changed = false;
      
      for (var r = 0; r < data.length; r++) {
        var orderDate = data[r][0]; 
        var itemCode = data[r][1]; 
        var phone = data[r][5]; 
        
        if (!orderDate || !itemCode) continue;
        
        var strPhone = String(phone).replace(/[^0-9]/g, "");
        var shortPhone = strPhone.substring(strPhone.length - 4);
        var dateStr = (orderDate instanceof Date) ? Utilities.formatDate(orderDate, "Asia/Seoul", "MMdd") : String(orderDate);
        var uniqueId = vendorName + "-" + dateStr + "-" + itemCode + "-" + shortPhone;
        
        var match = vendorMap[vendorName][uniqueId];
        if (match) {
           // 상태나 송장 정보가 허브와 하나라도 다르면 업데이트
           if (data[r][7] !== match.status || data[r][8] !== String(match.invoice)) {
             data[r][7] = match.status;  // 처리상태
             data[r][8] = String(match.invoice); // 송장
             changed = true;
           }
        }
      }
      
      if (changed) {
        orderTab.getRange(2, 1, data.length, 9).setValues(data);
        SpreadsheetApp.flush();
        pushCount++;
      }
    }
  }

  ui.alert("✅ " + pushCount + "개 업체의 뷰어 시트에 송장/상태값이 성공적으로 반영(동기화)되었습니다.");
}
