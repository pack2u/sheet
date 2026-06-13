/**
 * 스프레드시트가 열릴 때 실행되어 커스텀 메뉴를 추가합니다.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Pack2U AI 가공')
      .addItem('AI 사진 가공 실행', 'showSidebar')
      .addToUi();
}

/**
 * 사이드바 UI를 화면에 표시합니다.
 */
function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar_UI')
      .setTitle('AI 사진 가공')
      .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}
