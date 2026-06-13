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
      template = HtmlService.createTemplateFromFile("barcode");
      break;
    case "inventory":
      template = HtmlService.createTemplateFromFile("inventory");
      break;
    case "camera_test":
      template = HtmlService.createTemplateFromFile("camera_test");
      break;
    default:
      template = HtmlService.createTemplateFromFile("home");
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

// ══════════════════════════════════════════════
//  ★ 송장번호 → 판매데이터 자동 매칭
//  (로젠택배 바코드 스캔 → 주문자/품목/전화/주소 조회)
// ══════════════════════════════════════════════

/** 상품정보 시트 ID (메인 시트 — 발주허브가 있는 곳) */
var _CS_MAIN_SHEET_ID = "1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE";

/**
 * 송장번호로 판매 데이터 조회
 * 1차: 협력업체_발주허브 (N열=송장번호)
 * 2차: 사방넷_송장매칭 (F열=운송장번호)
 * 3차: 대리공급_임시기록 (X열=송장번호)
 *
 * @param {string} invoiceNumber - 로젠택배 바코드에서 읽은 송장번호
 * @return {Object} 매칭 결과 (주문자, 품목, 전화, 주소 등)
 */
function lookupByInvoice(invoiceNumber) {
  if (!invoiceNumber) return { found: false, error: "송장번호가 비어 있습니다." };

  var invClean = String(invoiceNumber).trim().replace(/[^0-9]/g, "");
  if (invClean.length < 8) return { found: false, error: "유효하지 않은 송장번호입니다. (8자리 이상)" };

  try {
    var ss = SpreadsheetApp.openById(_CS_MAIN_SHEET_ID);

    // ── 1차: 협력업체_발주허브 ──
    var hubResult = _cs_searchHub_(ss, invClean);
    if (hubResult) return hubResult;

    // ── 2차: 사방넷_송장매칭 ──
    var unmatchResult = _cs_searchUnmatched_(ss, invClean);
    if (unmatchResult) return unmatchResult;

    // ── 3차: 대리공급_임시기록 ──
    var tempResult = _cs_searchTempTab_(ss, invClean);
    if (tempResult) return tempResult;

    return { found: false, error: "'" + invoiceNumber + "' 에 해당하는 판매 데이터를 찾을 수 없습니다." };
  } catch (e) {
    return { found: false, error: "조회 오류: " + e.message };
  }
}

/**
 * 1차: 협력업체_발주허브에서 송장번호 검색
 * 헤더: 수집일시(0) 발주업체(1) 고유ID(2) 주문일자(3) 이카운트코드(4)
 *       품목명(5) 수량(6) 수취인(7) 수취인전화번호(8) 수취인주소(9)
 *       배송메시지(10) 정산금액(11) 적요(12) 송장번호(13) 상태(14)
 */
function _cs_searchHub_(ss, invDigits) {
  var hub = ss.getSheetByName("협력업체_발주허브");
  if (!hub || hub.getLastRow() < 2) return null;

  var data = hub.getRange(2, 1, hub.getLastRow() - 1, 15).getValues();
  for (var i = 0; i < data.length; i++) {
    var rowInv = String(data[i][13] || "").trim().replace(/[^0-9]/g, "");
    if (rowInv === invDigits) {
      return {
        found: true,
        source: "협력업체_발주허브",
        invoiceNumber: String(data[i][13] || "").trim(),
        vendor: String(data[i][1] || "").trim(),    // 발주업체
        uniqueId: String(data[i][2] || "").trim(),   // 고유ID
        orderDate: String(data[i][3] || "").trim(),  // 주문일자
        ecountCode: String(data[i][4] || "").trim(), // 이카운트코드
        productName: String(data[i][5] || "").trim(),// 품목명
        quantity: data[i][6] || 1,                   // 수량
        recipientName: String(data[i][7] || "").trim(),  // 수취인
        recipientPhone: String(data[i][8] || "").trim(), // 전화번호
        recipientAddr: String(data[i][9] || "").trim(),  // 주소
        memo: String(data[i][12] || "").trim(),      // 적요
        status: String(data[i][14] || "").trim()     // 상태
      };
    }
  }
  return null;
}

/**
 * 2차: 사방넷_송장매칭에서 송장번호 검색
 * F열(5)=운송장번호, E열(4)=주문번호, J열(9)=수취인, K열(10)=물품명
 * L열(11)=주소, M열(12)=전화, N열(13)=휴대폰, O열(14)=수량
 */
function _cs_searchUnmatched_(ss, invDigits) {
  var tab = ss.getSheetByName("사방넷_송장매칭");
  if (!tab || tab.getLastRow() < 2) return null;

  var lc = Math.min(tab.getLastColumn(), 37);
  var data = tab.getRange(2, 1, tab.getLastRow() - 1, lc).getValues();
  for (var i = 0; i < data.length; i++) {
    var rowInv = String(data[i][5] || "").trim().replace(/[^0-9]/g, ""); // F열=운송장번호
    if (rowInv === invDigits) {
      return {
        found: true,
        source: "사방넷_송장매칭",
        invoiceNumber: String(data[i][5] || "").trim(),
        orderNumber: String(data[i][4] || "").trim(),  // E열=주문번호
        recipientName: String(data[i][9] || "").trim(), // J열=수취인
        productName: String(data[i][10] || "").trim(),  // K열=물품명
        recipientAddr: String(data[i][11] || "").trim(),// L열=주소
        recipientPhone: String(data[i][12] || data[i][13] || "").trim(), // M/N열=전화
        quantity: data[i][14] || 1,                     // O열=수량
        vendor: String(data[i][27] || "").trim(),       // AB열=송하인명
        status: ""
      };
    }
  }
  return null;
}

/**
 * 3차: 대리공급_임시기록에서 송장번호 검색
 * X열(23)=송장번호
 */
function _cs_searchTempTab_(ss, invDigits) {
  var tab = ss.getSheetByName("대리공급_임시기록");
  if (!tab || tab.getLastRow() < 2) return null;

  var lc = Math.max(tab.getLastColumn(), 24);
  var data = tab.getRange(2, 1, tab.getLastRow() - 1, lc).getValues();
  for (var i = 0; i < data.length; i++) {
    var rowInv = String(data[i][23] || "").trim().replace(/[^0-9]/g, ""); // X열=송장번호
    if (rowInv === invDigits) {
      return {
        found: true,
        source: "대리공급_임시기록",
        invoiceNumber: String(data[i][23] || "").trim(),
        productName: String(data[i][4] || "").trim(),    // E열=품목명
        ecountCode: String(data[i][3] || "").trim(),     // D열=품목코드
        quantity: data[i][6] || 1,                       // G열=수량
        recipientPhone: String(data[i][7] || data[i][8] || "").trim(), // H/I열=전화
        recipientAddr: String(data[i][9] || "").trim(),  // J열=주소
        recipientName: String(data[i][12] || "").trim(), // M열=거래처명(수취인)
        vendor: String(data[i][22] || "").trim(),        // W열=업체prefix
        status: String(data[i][0] || "").trim()          // A열=상태
      };
    }
  }
  return null;
}

// ══════════════════════════════════════════════
//  ★ Gemini Vision OCR — 송장 이미지에서 정보 추출
//  (카메라 테스트 프로토타입용)
// ══════════════════════════════════════════════

/** Gemini API 키 (메인 시트 geminiChat.gs와 동일) */
var _CS_GEMINI_KEY = "AIzaSyA9O-Dh3SDsMSK7OVHQQ2BG9INiFcgXCB0";

/**
 * 송장 이미지를 Gemini Vision으로 분석하여 정보 추출
 * @param {string} base64Data - base64 인코딩된 이미지 데이터
 * @param {string} mimeType  - 이미지 MIME 타입 (image/jpeg 등)
 * @return {Object} { invoiceNumber, recipientName, phone, address }
 */
function ocrInvoiceImage(base64Data, mimeType) {
  try {
    var model = "gemini-2.5-flash-lite";
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      model + ":generateContent?key=" + _CS_GEMINI_KEY;

    var prompt = 
      "이 택배 송장 이미지를 분석해서 다음 정보를 JSON 형식으로 추출해 주세요.\n" +
      "반드시 아래 JSON 형식만 출력하고, 다른 텍스트는 포함하지 마세요.\n" +
      "찾을 수 없는 항목은 빈 문자열로 남겨주세요.\n\n" +
      "{\n" +
      "  \"invoiceNumber\": \"송장번호 (숫자만)\",\n" +
      "  \"recipientName\": \"수취인 이름\",\n" +
      "  \"phone\": \"수취인 전화번호\",\n" +
      "  \"address\": \"수취인 주소\",\n" +
      "  \"senderName\": \"발송인 이름\",\n" +
      "  \"carrier\": \"택배사명\"\n" +
      "}";

    var payload = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType || "image/jpeg",
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512
      }
    };

    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var json = JSON.parse(response.getContentText());

    if (json.error) {
      Logger.log("[OCR] Gemini API 오류: " + json.error.message);
      return { error: "Gemini API 오류: " + json.error.message };
    }

    var text = json.candidates[0].content.parts[0].text;
    Logger.log("[OCR] Gemini 응답: " + text);

    // JSON 추출 (```json ... ``` 감싸기 대응)
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: "JSON 파싱 실패", raw: text };
    }

    var result = JSON.parse(jsonMatch[0]);

    // 송장번호 정리 (숫자만)
    if (result.invoiceNumber) {
      result.invoiceNumber = String(result.invoiceNumber).replace(/[^0-9]/g, "");
    }

    return result;

  } catch (e) {
    Logger.log("[OCR] 오류: " + e.message);
    return { error: "OCR 처리 오류: " + e.message };
  }
}
