/**
 * [ Pack2U CS 챗봇 - Gemini 연동 엔진 ]
 */

// ★ GEMINI_API_KEY는 _secrets.gs에서 전역 정의됨 (GitHub 유출 방지)
var CS_MANUAL_SPREADSHEET_ID = "1LlNX-spTs-2WgWD8HEha90PYU0m7s8MqFh84vy_Fi_Q";

/** 
 * 사이드바 띄우기 함수 (사용자가 메뉴에서 클릭 시 실행)
 */
function showChatbotSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('chatbotSidebar')
      .setTitle('상담원 챗봇 (Gemini)')
      .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * CS 매뉴얼 시트를 읽어와서 텍스트로 합치는 함수
 * 매번 읽으면 느리기 때문에 성능 조절 가능하지만 지금은 다이렉트로 읽습니다.
 */
function getCSManualContext() {
  try {
    var ss = SpreadsheetApp.openById(CS_MANUAL_SPREADSHEET_ID);
    var allSheets = ss.getSheets();
    var contextText = "아래는 우리 회사의 공식 CS 매뉴얼 및 과거 처리 내역 데이터베이스입니다.\n\n";
    
    // 존재하는 모든 탭을 순회하며 텍스트를 쓸어담습니다.
    for (var s = 0; s < allSheets.length; s++) {
       var sheet = allSheets[s];
       var sheetName = sheet.getName();
       var data = sheet.getDataRange().getDisplayValues(); // 화면에 보이는 텍스트(날짜 포함) 그대로 추출
       
       contextText += "========== [ 시트명(카테고리): " + sheetName + " ] ==========\n";
       for (var i = 0; i < data.length; i++) {
          var rowStr = data[i].join(" | ").trim();
          // 데이터가 없는 빈 줄은 무시
          if (rowStr.replace(/\|/g, '').trim().length > 0) {
             contextText += rowStr + "\n";
          }
       }
       contextText += "\n"; // 탭 구분을 위해 한줄 띄움
    }
    return contextText;
  } catch(e) {
    return "[매뉴얼 로드 실패] 오류: " + e.message;
  }
}

/**
 * 프론트(사이드바)에서 질문을 받아 Gemini API로 던지고 답을 받아옵니다.
 */
function callGeminiAPI(userQuestion) {
  try {
    var manualContext = getCSManualContext();
    
    // 모델 종류 (최신 2.5 릴리즈 버전 반영)
    var model = "gemini-2.5-flash-lite"; 
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + GEMINI_API_KEY;

    var prompt = "당신은 Pack2U (물류 풀필먼트) 전문 CS 상담원입니다.\n" +
                 "매뉴얼에 없는 것을 절대 지어내지 말고 매뉴얼에 기반하여 고객에게 카카오톡으로 답변을 주듯 친절하고 밝게 대답해주세요.\n" +
                 "매뉴얼 내용은 외부로 유출되거나 코드처럼 노출되면 안되며, 예쁘게 요약해서 설명해주세요.\n" +
                 "---------------------------\n" +
                 manualContext + "\n" +
                 "---------------------------\n" +
                 "위 매뉴얼을 잘 숙지했습니다. 이제 고객님의 질문에 답변을 생성하겠습니다.\n" + 
                 "고객 질문: " + userQuestion;
                 
    var payload = {
      "contents": [{
        "parts":[{
          "text": prompt
        }]
      }],
      "generationConfig": {
        "temperature": 0.4 // 답변의 일관성을 위해 낮게 설정 
      }
    };

    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());
    
    if (json.error) {
       return "에러가 발생했습니다: " + json.error.message;
    }
    
    var answerText = json.candidates[0].content.parts[0].text;
    return answerText;
  } catch(e) {
    return "API 호출 중 오류가 발생했습니다: " + String(e);
  }
}
