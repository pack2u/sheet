/**
 * Pack2U CS 모바일 바코드 스캔 + 재고 실사 Web App
 * 파일: CS/Code.gs
 *
 * ★ 기존 AppSheet CS 앱과 연동하여 사용
 *   - 바코드 스캔 → CS시트에 사전 입력 → AppSheet에서 사진/내용 추가
 *   - 재고 실사 → 바코드 연속 스캔 + 수량 입력 → 이카운트 연동
 *
 * 데이터 소스:
 *   - CS목록 시트 (공유드라이브): 1qYkmcgO21DbEwTF8uSK-tTvrykaR759llbw5-vuP...
 *   - 상품정보 시트 (메인): 1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE
 */

// ══════════════════════════════════════════════
//  Web App 진입점
// ══════════════════════════════════════════════

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || "home";
  var template;

  switch (page) {
    case "barcode":
      template = HtmlService.createTemplateFromFile("CS/barcode");
      break;
    case "inventory":
      template = HtmlService.createTemplateFromFile("CS/inventory");
      break;
    default:
      template = HtmlService.createTemplateFromFile("CS/home");
  }

  return template.evaluate()
    .setTitle("Pack2U 모바일")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no");
}

/** HTML 인클루드 헬퍼 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ══════════════════════════════════════════════
//  바코드 → 상품 정보 조회
// ══════════════════════════════════════════════

/**
 * 바코드(이카운트코드)로 상품 정보 조회
 * 상품정보 시트의 E열(이카운트코드) → C열(상품명) 매핑
 */
function lookupProductByBarcode(barcode) {
  if (!barcode) return { found: false, error: "바코드가 비어 있습니다." };

  try {
    var ss = SpreadsheetApp.openById("1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE");
    var sheet = ss.getSheetByName("상품정보");
    if (!sheet) return { found: false, error: "상품정보 시트를 찾을 수 없습니다." };

    var lastRow = sheet.getLastRow();
    if (lastRow < 4) return { found: false, error: "상품 데이터가 없습니다." };

    // E열(이카운트코드), C열(상품명), D열(옵션명)
    var data = sheet.getRange(4, 1, lastRow - 3, 10).getValues();
    var barcodeClean = String(barcode).trim().toUpperCase();

    for (var i = 0; i < data.length; i++) {
      var ecountCode = String(data[i][4] || "").trim().toUpperCase(); // E열 = index 4
      if (ecountCode === barcodeClean) {
        return {
          found: true,
          ecountCode: ecountCode,
          productName: String(data[i][2] || "").trim(), // C열 = 상품명
          optionName: String(data[i][3] || "").trim(),  // D열 = 옵션명
          barcode: barcode
        };
      }
    }

    return { found: false, error: "'" + barcode + "' 에 해당하는 상품을 찾을 수 없습니다." };
  } catch (e) {
    return { found: false, error: "조회 오류: " + e.message };
  }
}

// ══════════════════════════════════════════════
//  CS 접수 — 바코드 스캔 결과를 CS시트에 사전 기록
// ══════════════════════════════════════════════

/**
 * CS번호 생성 (기존 AppSheet 형식 유지)
 * 형식: CS + YYYYMMDDHHmmss (예: CS20260605152250)
 */
function _cs_generateId_() {
  var now = new Date();
  var id = "CS" + Utilities.formatDate(now, "Asia/Seoul", "yyyyMMddHHmmss");
  return id;
}

/**
 * 바코드 스캔 결과를 CS시트에 사전 기록
 * AppSheet에서 나머지 (사진, 사유 등) 입력
 */
function submitBarcodeToCS(data) {
  try {
    // CS목록 시트 열기 (공유드라이브)
    var csSheetId = _cs_getCSSheetId_();
    var ss = SpreadsheetApp.openById(csSheetId);

    // 1. CS목록 탭에 기본 정보 추가
    var csSheet = ss.getSheetByName("CS목록");
    if (!csSheet) return { success: false, error: "CS목록 시트를 찾을 수 없습니다." };

    var csNumber = _cs_generateId_();
    var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

    // CS목록 헤더: 번호, 담당자, 고객명, 연락처, 주소, 접수일자, 상품주문일자,
    //              공급처, 판매처, CS내용, 처리방법, 처리상태, 비고,
    //              이카운트반영, 환불계좌, 환불금액, 환불완료, CS완료
    csSheet.appendRow([
      csNumber,           // A: 번호(CS번호)
      data.submitter || "",  // B: 담당자
      "",                 // C: 고객명 (AppSheet에서 입력)
      "",                 // D: 연락처
      "",                 // E: 주소
      now,                // F: 접수일자
      "",                 // G: 상품주문일자
      "",                 // H: 공급처
      "",                 // I: 판매처
      data.reason || "",  // J: CS내용 (바코드 스캔 시 간단 메모)
      "",                 // K: 처리방법
      "",                 // L: 처리상태
      "📱 모바일 바코드 접수", // M: 비고
      "",                 // N: 이카운트반영
      "",                 // O: 환불계좌
      "",                 // P: 환불금액
      "",                 // Q: 환불완료
      ""                  // R: CS완료
    ]);

    // 2. CS상품 탭에 상품 정보 추가
    var prodSheet = ss.getSheetByName("CS상품");
    if (prodSheet && data.ecountCode) {
      var uid = Utilities.getUuid().substring(0, 8);
      prodSheet.appendRow([
        uid,                    // A: UNIQUEID
        csNumber,               // B: CS번호
        data.ecountCode || "",  // C: 상품(이카운트코드)
        data.quantity || 1,     // D: 수량
        "",                     // E: 원송장번호
        "",                     // F: 회수송장번호
        ""                      // G: 재발송송장번호
      ]);
    }

    return {
      success: true,
      csNumber: csNumber,
      message: "CS 접수 완료! AppSheet에서 사진과 상세 내용을 추가하세요."
    };
  } catch (e) {
    return { success: false, error: "CS 등록 오류: " + e.message };
  }
}

// ══════════════════════════════════════════════
//  재고 실사 — 스캔 결과 저장
// ══════════════════════════════════════════════

/**
 * 재고 실사 결과 일괄 저장
 * @param {Object} sessionData - { submitter, warehouse, items: [{barcode, ecountCode, productName, systemQty, actualQty, diff}] }
 */
function submitInventoryCount(sessionData) {
  try {
    var ss = SpreadsheetApp.openById("1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE");
    var sheet = ss.getSheetByName("재고실사");

    // 시트가 없으면 생성
    if (!sheet) {
      sheet = ss.insertSheet("재고실사");
      sheet.appendRow([
        "실사일자", "실사자", "바코드", "이카운트코드", "품목명",
        "시스템재고", "실사수량", "차이", "창고", "비고", "이카운트전송결과"
      ]);
      sheet.getRange("1:1").setFontWeight("bold").setBackground("#4a90d9").setFontColor("white");
      sheet.setFrozenRows(1);
    }

    var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var items = sessionData.items || [];
    var rows = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      rows.push([
        now,                          // A: 실사일자
        sessionData.submitter || "",  // B: 실사자
        item.barcode || "",           // C: 바코드
        item.ecountCode || "",        // D: 이카운트코드
        item.productName || "",       // E: 품목명
        item.systemQty || 0,          // F: 시스템재고
        item.actualQty || 0,          // G: 실사수량
        (item.actualQty || 0) - (item.systemQty || 0), // H: 차이
        sessionData.warehouse || "",  // I: 창고
        item.memo || "",              // J: 비고
        ""                            // K: 이카운트전송결과
      ]);
    }

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
        .setValues(rows);
    }

    return {
      success: true,
      count: rows.length,
      message: rows.length + "건의 실사 데이터가 저장되었습니다."
    };
  } catch (e) {
    return { success: false, error: "재고 실사 저장 오류: " + e.message };
  }
}

// ══════════════════════════════════════════════
//  유틸리티
// ══════════════════════════════════════════════

/** CS 시트 ID 조회 (스크립트 속성에서) */
function _cs_getCSSheetId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("CS_SHEET_ID");
  if (!id) {
    // 기본값 설정 (최초 실행 시)
    id = "1qYkmcgO21DbEwTF8uSK-tTvrykaR759llbw5-vuP";
    props.setProperty("CS_SHEET_ID", id);
  }
  return id;
}

/** 담당자 목록 가져오기 */
function getStaffList() {
  return ["배진숙", "이정은", "김진수"];
}

/** CS시트 ID 설정 (관리자용) */
function setCSSheetId(sheetId) {
  PropertiesService.getScriptProperties().setProperty("CS_SHEET_ID", sheetId);
  return "CS 시트 ID가 설정되었습니다: " + sheetId;
}
