function moveToEcount(targetSheetName) {
  var sName = targetSheetName || '상품정보';
  const copyss = SpreadsheetApp.openByUrl("https://docs.google.com/spreadsheets/d/1hqNYXOKbSiizNBb0zns46c6hxjin10I2Z5-HjKHgltI/edit#gid=986643732");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const copySheet = copyss.getSheetByName('상품정보(목록)');
  const pasteSheet = ss.getSheetByName(sName);

  const headerRow = 4;
  const lastRow = copySheet.getRange(4+2,1).getDataRegion().getLastRow();

  // A열부터 S열까지 복사하는 기존 로직
  const copyValues1 = copySheet.getRange(headerRow + 2, 1, lastRow - headerRow - 1, 56).getValues();
  pasteSheet.getRange('A6:BE').clearContent();
  pasteSheet.getRange(headerRow + 2, 1, lastRow - headerRow - 1, 56).setValues(copyValues1);//첫행 비워놓기(필터를 위해)

  pasteSheet.getRange('V6:W').clearContent();
  pasteSheet.getRange('Y6:Z').clearContent();
  pasteSheet.getRange('AB6:AF').clearContent();
  pasteSheet.getRange('AG6:AG').clearContent(); // 여기서 AG열 삭제(길뚫기)가 되도록 제가 추가했습니다!
  pasteSheet.getRange('AH6:BE').clearContent();

  var timezone = "GMT+9";
  var date = Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd HH:mm"); // "yyyy-MM-dd'T'HH:mm:ss'Z'"
  pasteSheet.getRange('A1').setValue(date);
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
