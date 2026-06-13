// ============================================
// 오프라인 판매가(X열) 마진 계산 및 원클릭 연동 스크립트 (원격 조종기 버전)
// ============================================

// 🔴 여기에 사장님의 원래 뚱뚱한 메인 엑셀(상품정보 시트가 있는 파일)의 인터넷 주소창 ID를 붙여넣으세요!
const MAIN_DB_ID = "여기에_메인_엑셀_아이디를_붙여넣으세요"; 

/**
 * 엑셀을 켤 때마다 자동으로 최상단 메뉴바에 버튼을 만들어주는 마법 함수
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 마진계산기 작동')
      .addItem('🌟 (최초 1회) 계산기 탭 만들기', 'setupMarginCalculatorTab')
      .addSeparator()
      .addItem('🔍 1단계: 마진 가계산 (연동 안 됨, 미리보기용)', 'previewMarginCalculation')
      .addItem('💥 2단계: 메인 DB에 실시간 연동 (덮어쓰기)', 'executeMarginCalculation')
      .addToUi();
}

/**
 * 1. 초기 탭(UI) 생성 함수
 * 다른 새로운 구글 시트 파일에 탭을 생성하기 위한 셋업 (최초 1회 실행)
 */
function setupMarginCalculatorTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("단가마진계산기");
  
  if (!sheet) {
    sheet = ss.insertSheet("단가마진계산기");
    
    // 기본 마진율 셋업 (수정 가능하게 오픈)
    sheet.getRange("A1").setValue("목표 마진율:").setFontWeight("bold").setBackground("#d9ead3").setHorizontalAlignment("right");
    sheet.getRange("B1").setValue(0.3).setNumberFormat("0%"); // 기본 30%
    
    // 올림 규칙 셋업 (100원, 1000원 등 선택가능)
    sheet.getRange("C1").setValue("올림 단위(원):").setFontWeight("bold").setBackground("#d9ead3").setHorizontalAlignment("right");
    sheet.getRange("D1").setValue(1000).setNumberFormat("#,##0"); // 기본 1000원 단위
    
    // 버튼 관련 안내
    sheet.getRange("F1").setValue("<- [마진율/올림 설정] 변경 후 연동 버튼을 누르세요.");
    
    // 헤더 작성
    var headers = [
      ["이카운트 코드", "상품명(F)", "기존 판매가(X)", "적용될 신규판매가(X)", "계산된 기본원가(N*V+O+S)", "연동(반영) 결과"]
    ];
    sheet.getRange("A3:F3").setValues(headers)
         .setBackground("#4a86e8").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
         
    // 틀고정
    sheet.setFrozenRows(3);
    
    // 열 너비 조절
    sheet.setColumnWidth(1, 150); // 코드
    sheet.setColumnWidth(2, 250); // 상품명
    sheet.setColumnWidth(3, 120); // 기존 X가
    sheet.setColumnWidth(4, 150); // 신규 X가
    sheet.setColumnWidth(5, 170); // 원가참조
    sheet.setColumnWidth(6, 300); // 결과 상태
    
    SpreadsheetApp.flush();
    SpreadsheetApp.getUi().alert("✅ '단가마진계산기' 탭이 생성되었습니다.");
  } else {
    SpreadsheetApp.getUi().alert("💡 이미 '단가마진계산기' 시트가 존재합니다.");
  }
}

/**
 * 버튼에 연결될 오프라인단가(X) 일괄 연동 함수 분리
 */
function previewMarginCalculation() {
  runMarginCalculationCore(false); // isCommit = false (미리보기만)
}

function executeMarginCalculation() {
  runMarginCalculationCore(true);  // isCommit = true (실제 DB 덮어쓰기)
}

function runMarginCalculationCore(isCommit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const calcSheet = ss.getSheetByName("단가마진계산기");
  
  if (!calcSheet) {
    ui.alert("⚠️ 계산기 탭을 먼저 생성해주세요!");
    return;
  }
  
  // 🛡️ 실수 방지용 안전 팝업 (버튼 잘못 누름 방지)
  if (isCommit) {
    const response = ui.alert(
      "경고: 실제 DB 연동", 
      "화면에 보이는 계산 결과들을 사장님의 진짜 메인 DB(상품정보 X열)에 영구적으로 덮어씌웁니다.\n정말로 연동을 진행하시겠습니까?", 
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) {
      return; // YES를 누르지 않으면 조용히 종료
    }
  }
  
  // 🚀 원격 접속 기술: 사장님의 메인 상품정보 DB 엑셀 파일을 원격으로 딱 엽니다!
  let mainDbSS;
  try {
     mainDbSS = SpreadsheetApp.openById(MAIN_DB_ID);
  } catch(e) {
     SpreadsheetApp.getUi().alert("❌ 원격 접속 실패! 맨 위 코드의 MAIN_DB_ID 에 메인 엑셀 아이디를 정확히 넣으셨나요?");
     return;
  }
  
  const mainSheet = mainDbSS.getSheetByName("상품정보");
  if (!mainSheet) {
    SpreadsheetApp.getUi().alert("⚠️ 원격 시트에 '상품정보' 탭이 없습니다.");
    return;
  }
  
  const marginRate = parseFloat(calcSheet.getRange("B1").getValue()) || 0.3; // 기본은 30%
  let roundUnit = parseInt(calcSheet.getRange("D1").getValue(), 10);
  if (isNaN(roundUnit) || roundUnit <= 0) {
    roundUnit = 1000; // 잘못된 값이면 기본 1000원으로 고정
  }
  
  const calcLr = calcSheet.getLastRow();
  
  if (calcLr < 4) {
    SpreadsheetApp.getUi().alert("⚠️ A열 4행부터 적용할 이카운트 코드를 입력해주세요.");
    return;
  }
  
  // 마진 계산기에 입력된 데이터 통째로 가져오기
  const calcData = calcSheet.getRange(4, 1, calcLr - 3, 6).getValues(); 
  
  // 가볍고 빠른 처리를 위해 메인 DB(상품정보) 전체를 메모리에 올림
  const mainLr = mainSheet.getLastRow();
  // X열(24)까지는 무조건 확보
  const mainLc = Math.max(mainSheet.getLastColumn(), 24);
  const mainData = mainSheet.getRange(1, 1, mainLr, mainLc).getValues();
  
  // 이카운트 코드(E열)를 방 번호로 기억하는 [딕셔너리] 세팅
  const mainMap = {};
  for (let r = 5; r < mainLr; r++) { // 6행(인덱스 5)부터 실제 데이터
    let rawCode = String(mainData[r][4] || "").replace(/[\s\u200B-\u200D\uFEFF]/g, '').toUpperCase(); // E열(인덱스 4) 품목코드
    if (rawCode) {
      mainMap[rawCode] = r; // 인덱스 위치(0-indexed) 자체를 저장
    }
  }
  
  let updateCount = 0;
  
  // 순서대로 코드 읽으면서 계산 및 연동
  for (let i = 0; i < calcData.length; i++) {
    let inputCode = String(calcData[i][0] || "").replace(/[\s\u200B-\u200D\uFEFF]/g, '').toUpperCase();
    
    // 코드를 지운 빈칸이라면 옆에 남아있던 과거 잔상 데이터(결과)들을 깨끗하게 지워줍니다.
    if (!inputCode) {
      calcData[i][1] = "";
      calcData[i][2] = "";
      calcData[i][3] = "";
      calcData[i][4] = "";
      calcData[i][5] = "";
      continue;
    }
    
    if (mainMap[inputCode] !== undefined) {
      let rIdx = mainMap[inputCode]; 
      let mmRow = mainData[rIdx]; // 메인 시트의 해당 1줄 데이터
      
      // 각 열별 데이터 파싱 (1-indexed 열번호 -> 0-indexed 인덱스로 매칭)
      let itmName = mmRow[2] || "이름없음"; // C열 (상품명, idx 2)
      let N = parseFloat(mmRow[13]) || 0; // N열 (박스입수량, idx 13)
      let O = parseFloat(mmRow[14]) || 0; // O열 (박스배송비, idx 14)
      let S = parseFloat(mmRow[18]) || 0; // S열 (포장비, idx 18)
      let V = parseFloat(mmRow[21]) || 0; // V열 (원가/매입가, idx 21)
      let oldX = parseFloat(mmRow[23]) || 0; // X열 (기존 오프라인판매가, idx 23)
      
      // 핵심 함수: ROUNDUP(((N*V)+O+S) / (1-마진율), -3 등)
      let denom = 1 - marginRate;
      let baseCost = (N * V) + O + S;
      let rawNewX = denom > 0 ? (baseCost / denom) : 0;
      
      // 사용자 지정 올림 로직 (100원 단위면 /100 * 100, 1000원 단위면 /1000 * 1000)
      let newX = Math.ceil(rawNewX / roundUnit) * roundUnit;
      
      // 🚀 실시간 덮어쓰기 연동! (상품정보 탭의 X열 위치인 24번째 칸에 삽입)
      if (isCommit && String(oldX) !== String(newX)) {
        mainSheet.getRange(rIdx + 1, 24).setValue(newX);
      }
      
      // 완료 후 계산기 화면에 즉시 보여줄 피드백 작성
      calcData[i][1] = itmName;
      calcData[i][2] = oldX;
      calcData[i][3] = newX;
      calcData[i][4] = baseCost; // 참고용 원가
      
      if (!isCommit) {
        calcData[i][5] = "👀 미연동 (결과 미리보기 상태)";
      } else {
        if (String(oldX) === String(newX)) {
          calcData[i][5] = "🔹 완벽 연동됨 (원래 값과 이미 동일해서 수정 불필요)";
        } else {
          calcData[i][5] = "✅ 새 단가로 덮어쓰기 완료 (기존 " + oldX + " ➔ 신규 " + newX + ")";
        }
      }
      // 통계용 카운트 증감 로직 (isCommit 여야 실제 연동 카운트)
      if (isCommit) updateCount++;
    } else {
      // 코드가 없는 상품 정보 예외처리
      calcData[i][1] = "코드 없음";
      calcData[i][2] = "";
      calcData[i][3] = "";
      calcData[i][4] = "";
      calcData[i][5] = "❌ DB에서 코드 못 찾음! 입력값: [" + inputCode + "]";
    }
  }
  
  // 계산이 다 끝난 뒤, 계산기 탭 화면 한 방에 갱신 (로딩속도 최적화)
  calcSheet.getRange(4, 1, calcData.length, 6).setValues(calcData);
  SpreadsheetApp.flush();
  
  if (isCommit) {
    SpreadsheetApp.getUi().alert("완료! ✅ 총 " + updateCount + "건의 오프라인 단가(X)가 메인 DB에 성공적으로 덮어씌워졌습니다!");
  } else {
    // 미리보기 종료
    SpreadsheetApp.getUi().alert("가계산 완료! 화면에 결과가 출력되었습니다.\n(DB에 영향 안 미침)\n확인 후 [2단계: 연동] 버튼을 누르시면 실제 반영됩니다.");
  }
}
