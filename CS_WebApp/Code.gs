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
  var file = "home";
  var title = "팩투유(Pack2U) CS 웹앱";
  var startWorkspace = false;

  // ★ 2026-08-25: 허용 계정만 통과. 여기서 막으면 페이지 자체가 나가지 않는다.
  var acc = _cs_ac_check_();
  if (!acc.allowed) return _cs_ac_denyPage_(acc);

  switch (page) {
    case "barcode":
      file = "barcode";
      break;
    case "inventory":
      file = "inventory";
      break;
    case "camera_test":
      file = "camera_test";
      break;
    case "return_intake":
      file = "return_intake";
      title = "반품 입고 스캔";
      break;
    case "scan_test":
      file = "scan_test";
      title = "택배 바코드 스캔 테스트";
      break;
    case "diag":
      return _cs_withFavicon_(HtmlService.createHtmlOutput(_cs_buildDiagPage_()))
        .setTitle("웹앱 URL 진단")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag("viewport", "width=device-width, initial-scale=1.0");
    case "manual":
    case "csmanual":
    case "orders":
    case "cs":
    case "workspace":
      file = "home";
      startWorkspace = true;
      title = "팩투유(Pack2U) CS 웹앱";
      break;
  }

  try {
    // ★ 2026-08-25: 모든 페이지에 고정 exec URL 주입.
    //   GAS 샌드박스 iframe에서는 window.location이 googleusercontent 내부 주소이므로
    //   페이지 이동을 window.location 기준으로 만들면 Drive 오류가 난다.
    var tpl = HtmlService.createTemplateFromFile(file);
    tpl.webAppUrl = _csWebAppExecUrl_();
    tpl.staff = String((e && e.parameter && e.parameter.staff) || "").trim();
    tpl.startWorkspace = startWorkspace;
    tpl.userEmail = acc.email;
    tpl.userName = acc.name || "";
    var out = tpl.evaluate();
    return _cs_withFavicon_(out)
      .setTitle(title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no");
  } catch (err) {
    return HtmlService.createHtmlOutput(
      "<pre style='padding:16px;font-family:sans-serif'>페이지 로드 오류: " +
      String(err && err.message ? err.message : err) + "</pre>"
    ).setTitle("Pack2U 오류");
  }
}

/** HTML 인클루드 헬퍼 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** 노란 배경 + CS — 탭 아이콘. data URI가 거부되면 HTML link가 담당한다. */
var _CS_FAVICON_PNG_ =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAKzSURBVHhe7ZctT15BEIVfAg0QmqYhTcX7P6rq0Zj+gdbXVOIQ9WhEHYoEW2wFBkWC7Q+or7/NIZlmc+7M3dndKyAz4slNZr9mz579uJvpcTNFZsOBaKQAHIhGCsCBaKQAHIhGCsCBaKQAHIhGCsCBaKQAHIhGCsCBaKQAHIhGCsCBHv7e70x3V/vTj+9H05dPx/85//pmur08eCrnNjW0/gBivX1qDAmAJJDQdrutcnH22pX09cXhrK0Fxub2rXQL8Pvn3nR68m6W1BKoj3bclwDHcJsa6NMjrEWXAH9+7c4S8WIl/HDzalbXy4gTugSwVh4riL2LyeBrrSi2A/eJ/c315AxBf7U+uT8vzQIgIR4cgsAVXBfA8lwfsAu4HONwX4J2TkAgruehWYCPH97PBrcmL2ii8QS5XHNJibhCYEG9NAmg7f1aooIIJ1cZi8b9AjhrzStPo0kAbSW91uMJM9beFuR84XajNAmg3flrrY7mLgu4riaol2EBuM4I1oFpge209K7w8KwEAHBUbTswfKC28OwEECAErjvtfaDhPYuYYQG8FsRk0L7nypKfrSVnfPv8dtbOQ5MASIIH9tqP3w+YDNfxgjy01yjX89AkAFaCB4VFuR6jvfPhCCnHqV7+8pZlFtpicB0PTQIAWI0HXkoYommrVV5jmrVr20R7k3AdD80CWFeVdjdbv8xsf2010c462LTJY4txPQ/NAgDtMCwTh421iQssFOAzoqTcHlwm9P4SdwkANNt6sJ6zlrM8QGzuz0u3AED7LV3CsrQAEZacoAFX1M6LJYYEALAz7GcljjjKvUnKA2hpCwEcxpabWhgWoATJr/GPXgJXlH1q58cIqwrwEkkBOBCNFIAD0UgBOBCNFIAD0UgBOBCNFIAD0UgBOBCNFIAD0UgBOBCN8AL8A9lhp/MjNTwaAAAAAElFTkSuQmCC";

function _cs_withFavicon_(out) {
  try { out.setFaviconUrl(_CS_FAVICON_PNG_); } catch (eFav) {}
  return out;
}

/** 고정 폴백 exec URL (배포 ID 고정) */
var _CS_FALLBACK_EXEC_URL_ =
  "https://script.google.com/macros/s/AKfycbxvDzpleqHey7gm0aHILVdALGAuCaymCXlFUfyVKNYt8Je2qhOPbCoKFtgLKMmeXBdpTA/exec";

/** /exec 형식 웹앱 URL인지 검증 (/dev·오타·구 배포 문자열 차단) */
function _cs_isValidExecUrl_(u) {
  u = String(u || "").trim().replace(/\?.*$/, "");
  return /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]{30,}\/exec$/.test(u);
}

/**
 * CS WebApp exec URL
 * ★ 2026-08-25: 실행 중인 배포 URL을 1순위로 사용.
 *   스크립트 속성에 옛 배포 URL이 남아 있으면 페이지 이동이 전부
 *   "현재 파일을 열 수 없습니다"(Drive 오류)로 깨지므로 형식 검증 후에만 쓴다.
 */
function _csWebAppExecUrl_() {
  try {
    var live = String(ScriptApp.getService().getUrl() || "").trim();
    if (_cs_isValidExecUrl_(live)) return live.replace(/\?.*$/, "");
  } catch (eLive) {}

  try {
    var fromProp = String(
      PropertiesService.getScriptProperties().getProperty("CS_WEBAPP_URL") || ""
    ).trim();
    if (_cs_isValidExecUrl_(fromProp)) return fromProp.replace(/\?.*$/, "");
  } catch (eProp) {}

  return _CS_FALLBACK_EXEC_URL_;
}

/** 웹앱 URL 결정 과정 진단 (page=diag 화면에서 사용) */
function csDiagnoseWebAppUrl() {
  var out = {
    resolved: "",
    live: "",
    liveValid: false,
    prop: "",
    propValid: false,
    fallback: _CS_FALLBACK_EXEC_URL_,
    source: "",
  };
  try {
    out.live = String(ScriptApp.getService().getUrl() || "").trim();
  } catch (e) {
    out.live = "(오류: " + (e && e.message ? e.message : e) + ")";
  }
  out.liveValid = _cs_isValidExecUrl_(out.live);
  try {
    out.prop = String(
      PropertiesService.getScriptProperties().getProperty("CS_WEBAPP_URL") || ""
    ).trim();
  } catch (e2) {}
  out.propValid = _cs_isValidExecUrl_(out.prop);
  out.resolved = _csWebAppExecUrl_();
  out.source = out.liveValid
    ? "실행 중 배포(ScriptApp)"
    : out.propValid
      ? "스크립트 속성(CS_WEBAPP_URL)"
      : "고정 폴백";
  return out;
}

/** 잘못된 CS_WEBAPP_URL 스크립트 속성 제거 */
function csClearWebAppUrlProperty() {
  try {
    PropertiesService.getScriptProperties().deleteProperty("CS_WEBAPP_URL");
    return { ok: true, message: "CS_WEBAPP_URL 속성을 삭제했습니다." };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/** page=diag 화면 HTML */
function _cs_buildDiagPage_() {
  var d = csDiagnoseWebAppUrl();
  var base = d.resolved;
  var pages = ["home", "return_intake", "scan_test", "barcode", "inventory"];
  var links = "";
  for (var i = 0; i < pages.length; i++) {
    var u = base + "?page=" + pages[i];
    links +=
      '<a target="_top" rel="noopener" href="' + u + '"' +
      ' style="display:block;padding:12px 14px;margin:8px 0;background:#1b2130;' +
      'border:1px solid #2b3448;border-radius:10px;color:#8ab4ff;text-decoration:none">' +
      pages[i] + "</a>";
  }
  function row(label, val, ok) {
    return (
      '<div style="margin:10px 0"><div style="color:#8b8fa3;font-size:11px">' + label +
      "</div><div style=\"word-break:break-all;font-size:12px;color:" +
      (ok === false ? "#ef9a9a" : "#f0f0f5") + '">' + (val || "(없음)") + "</div></div>"
    );
  }
  return (
    '<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'background:#0f1117;color:#f0f0f5;min-height:100vh;padding:16px;box-sizing:border-box">' +
    '<h2 style="margin:0 0 4px;font-size:16px">웹앱 URL 진단</h2>' +
    '<div style="color:#8b8fa3;font-size:11px;margin-bottom:14px">이동 링크가 깨질 때 확인하는 화면입니다.</div>' +
    row("사용 중인 주소 · 출처: " + d.source, d.resolved) +
    row("실행 중 배포(ScriptApp)", d.live, d.liveValid) +
    row("스크립트 속성 CS_WEBAPP_URL", d.prop, d.prop ? d.propValid : undefined) +
    row("고정 폴백", d.fallback) +
    '<div style="margin-top:18px;color:#8b8fa3;font-size:11px">아래 링크를 눌러 각 페이지 진입을 확인하세요.</div>' +
    links +
    "</div>"
  );
}

// ══════════════════════════════════════════════
//  바코드 → 상품 정보 조회
// ══════════════════════════════════════════════

/**
 * 바코드(이카운트코드)로 상품 정보 조회 — Supabase SSOT
 */
function lookupProductByBarcode(barcode) {
  if (!barcode) return { found: false, error: "바코드가 비어 있습니다." };

  var detail = csLookupProductDetail(barcode);
  if (!detail || !detail.ok) {
    return {
      found: false,
      error: (detail && detail.error) || ("'" + barcode + "' 에 해당하는 상품을 찾을 수 없습니다."),
    };
  }
  return {
    found: true,
    ecountCode: detail.codeRaw || detail.code,
    productName: detail.productName || "",
    optionName: detail.optionName || "",
    barcode: barcode,
  };
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
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
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
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
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

/**
 * 담당자 목록 가져오기.
 * 표시 이름이 지정된 계정도 담당자로 넣는다. 목록에 없으면 그 사람의
 * 읽음 여부가 카드에 잡히지 않고, 옛 이름이 계속 작성자로 남는다.
 */
function getStaffList() {
  var list = ["김진수", "고윤서", "박상식"];
  var extra = [];
  try { extra = _cs_ac_allDisplayNames_(); } catch (e) { extra = []; }
  for (var i = 0; i < extra.length; i++) {
    if (list.indexOf(extra[i]) === -1) list.push(extra[i]);
  }
  return list;
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

    // ── 4차: 일일마감 최근 14일 ──
    if (typeof _cs_searchDailyArchiveByInvoice_ === "function") {
      var dailyResult = _cs_searchDailyArchiveByInvoice_(invClean);
      if (dailyResult) return dailyResult;
    }

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
        shipMsg: _cs_sanitizeShipMsg_(String(data[i][10] || "").trim(), String(data[i][9] || "").trim()),
        deliveryMessage: _cs_sanitizeShipMsg_(String(data[i][10] || "").trim(), String(data[i][9] || "").trim()),
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

/**
 * CS 웹앱은 허브와 별도 프로젝트라 _secrets.gs가 없을 수 있음.
 * 전역 참조를 로드 시점에 하면 doGet 전체가 죽는다.
 */
function _cs_getGeminiKey_() {
  if (typeof GEMINI_API_KEY !== "undefined" && GEMINI_API_KEY) return String(GEMINI_API_KEY);
  try {
    var k = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (k) return String(k);
  } catch (e) {}
  return "";
}

/**
 * 송장 이미지를 Gemini Vision으로 분석하여 정보 추출
 * @param {string} base64Data - base64 인코딩된 이미지 데이터
 * @param {string} mimeType  - 이미지 MIME 타입 (image/jpeg 등)
 * @return {Object} { invoiceNumber, recipientName, phone, address }
 */
function ocrInvoiceImage(base64Data, mimeType) {
  try {
    var apiKey = _cs_getGeminiKey_();
    if (!apiKey) {
      return { error: "Gemini API 키가 없습니다. CS 웹앱에 _secrets.gs 또는 스크립트 속성 GEMINI_API_KEY를 넣어 주세요." };
    }
    var model = "gemini-3.6-flash"; // ★ 2026-07-24 업그레이드 (OCR 정확도 최우선)
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      model + ":generateContent?key=" + apiKey;

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

/**
 * 스캔 화면 공용 OCR 엔드포인트 (csDecode.html 4단계)
 *
 * 바코드가 접혔거나 인쇄가 지워져 디코더가 실패했을 때, 라벨에 인쇄된
 * 숫자·글자를 읽어 송장번호를 건진다. 여러 개가 잡히면 택배사 송장번호
 * 형태(10~14자리)를 우선한다.
 *
 * @param {string} base64Data 리사이즈된 JPEG 의 base64 (dataURL 접두 제외)
 * @param {string} mimeType
 * @return {{ok:boolean, invoice:string, text:string, fields:Object, error:string}}
 */
function csOcrImageForScan(base64Data, mimeType) {
  try {
    if (!base64Data) return { ok: false, error: "이미지가 비어 있습니다." };

    var r = ocrInvoiceImage(base64Data, mimeType || "image/jpeg");
    if (!r || r.error) {
      return { ok: false, error: (r && r.error) ? r.error : "OCR 응답이 없습니다." };
    }

    var inv = String(r.invoiceNumber || "").replace(/[^0-9]/g, "");

    // 송장번호 칸이 비었으면 응답 전체에서 송장번호처럼 보이는 숫자를 찾는다
    if (inv.length < 8) {
      var pool = [r.invoiceNumber, r.phone, r.address, r.recipientName, r.senderName, r.carrier]
        .map(function (v) { return String(v || ""); }).join(" ");
      inv = _cs_pickInvoiceLikeDigits_(pool);
    }

    return {
      ok: inv.length >= 8,
      invoice: inv,
      text: [r.recipientName, r.phone, r.address, r.carrier]
        .filter(function (v) { return v; }).join(" / "),
      fields: {
        recipientName: String(r.recipientName || ""),
        phone: String(r.phone || ""),
        address: String(r.address || ""),
        senderName: String(r.senderName || ""),
        carrier: String(r.carrier || "")
      },
      error: inv.length >= 8 ? "" : "글자에서 송장번호를 찾지 못했습니다."
    };
  } catch (e) {
    Logger.log("[OCR-SCAN] 오류: " + e.message);
    return { ok: false, error: "OCR 처리 오류: " + e.message };
  }
}

/** 문자열에서 송장번호일 가능성이 큰 숫자 묶음을 고른다 (전화번호는 제외) */
function _cs_pickInvoiceLikeDigits_(s) {
  var groups = String(s || "").match(/[0-9][0-9\-\s]{8,}[0-9]/g) || [];
  var best = "";
  for (var i = 0; i < groups.length; i++) {
    var d = groups[i].replace(/[^0-9]/g, "");
    if (d.length < 10 || d.length > 14) continue;
    if (/^01[0-9]{8,9}$/.test(d)) continue; // 휴대폰
    if (/^0[2-6][0-9]{7,9}$/.test(d)) continue; // 지역번호
    if (d.length > best.length) best = d;
  }
  return best;
}
