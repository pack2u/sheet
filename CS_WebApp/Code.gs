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
    case "logistics":
      // 물류팀 전용 — 반품 입고 사진 촬영·업로드 (csLogistics.gs)
      file = "logistics";
      title = "반품 입고 촬영";
      break;
    case "statement":
      // 명세서 올리기 — 판독은 v2 가 한다 (csStatement.gs)
      file = "statement";
      title = "명세서 올리기";
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
    // 물류팀이면 모바일에서 입고촬영 패널로 먼저 떨어진다 (권한과 무관, 시작 위치만)
    tpl.isLogistics = !!acc.logistics;
    // ★ 2026-09-09: v2 주소를 화면에 넘긴다 ★
    //   발주는 v2 가 맡는다 (17_발주시스템.md). 여기서 또 만들면 두 벌이 되고
    //   한쪽만 고쳐진다. 홈에서 그리로 가는 길만 낸다.
    //   주소를 화면에 박지 않는 것은 배포처가 바뀔 수 있어서다 — _secrets.gs 한 곳.
    //   주소 푸는 함수는 명세서가 쓰던 것을 그대로 쓴다 (csStatement.gs) —
    //   두 벌로 두면 배포처를 옮길 때 한쪽만 고쳐진다.
    tpl.v2Url = _cst_v2url_();
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

/** 팩투유 심벌 — 탭 아이콘. data URI가 거부되면 HTML link(csFavicon.html)가 담당한다. */
/**
 * 앱 아이콘 (브라우저 탭 · 폰 홈 화면 바로가기)
 *
 * ★ 2026-09-07: 64px 「CS」 임시 아이콘 → 192px 로 키움 ★
 *   폰에서 「홈 화면에 추가」를 하면 이 그림이 아이콘이 된다. 64px 로는
 *   런처가 늘려 쓰느라 뭉개졌다. 192px 이 안드로이드 권장 크기다.
 *
 * ★ 2026-09-08: 실제 팩투유 심벌로 교체 ★
 *   사장님이 준 원본 D:\LOGO_p.PNG (390x390) 에서 줄인 것이다.
 *   브랜드 노랑은 #FDB913, 좌상단 모서리는 #3C2F2F.
 *
 *   ★ 흰 바탕을 깔았다 ★ 원본은 배경이 투명하다. 그대로 두면 런처마다
 *   흰/검정을 제멋대로 끼워 넣어 지저분해진다. 그리고 이 도안은 흰 바탕
 *   위에 그려진 것이라 흰색이 원본에 맞기도 하다.
 *   (앞의 「CS」 아이콘 때는 같은 이유로 노랑을 깔았다. 그림이 바뀌었으니
 *    깔 색도 바뀐다 — 노랑을 깔면 심벌의 흰 획이 통째로 사라진다.)
 *   모서리는 런처가 알아서 깎는다.
 *
 * ⚠ 아이폰은 여기까지가 한계다
 *   사파리는 apple-touch-icon 을 먼저 찾는데, Apps Script 웹앱의 우리 HTML 은
 *   샌드박스 iframe 안이라 바깥 페이지에 그 태그를 넣을 방법이 없다.
 *   setFaviconUrl 이 바깥 페이지를 건드리는 유일한 수단이다.
 *   제대로 된 앱 아이콘·이름·전체화면은 새 앱(Next.js)에서 PWA 로만 된다.
 */
var _CS_FAVICON_PNG_ =
  "data:image/png;base64,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";

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

    // ★ 실제 현장 라벨(롯데 반품회수)을 보고 맞춘 프롬프트 ★
    //   · 번호가 두 개다: 「운송장번호」(이번 회수) 와 「원송장번호」(최초 출고)
    //   · 같은 번호가 상단 칸·좌측 세로·하단 바코드 옆에 여러 번 인쇄된다 → 대조하면 정확도가 오른다
    //   · 반품 라벨은 받는분이 팩투유(회수처)다. 실제 고객은 "보내는 분" 이다.
    //   · 현장 라벨에는 빨간 손글씨·검은 테이프·찢김이 흔하다. 인쇄된 글자만 읽어야 한다.
    var prompt =
      "이 택배 송장 사진에서 정보를 뽑아 JSON 만 출력하세요. 다른 말은 쓰지 마세요.\n" +
      "찾을 수 없으면 빈 문자열로 두세요.\n\n" +
      "읽는 요령:\n" +
      "- 번호는 NNNN-NNNN-NNNN 12자리 형식이 많습니다. 하이픈은 빼고 숫자만 적으세요.\n" +
      "- 「운송장번호」 칸의 번호와 「원송장번호」 칸의 번호는 서로 다릅니다. 각각 따로 적으세요.\n" +
      "- 같은 번호가 라벨의 여러 위치(상단 칸, 왼쪽 세로 여백, 아래쪽 바코드 옆)에 반복 인쇄됩니다.\n" +
      "  여러 곳을 서로 대조해서 가장 확실한 값을 쓰세요. 한 곳이 가려졌으면 다른 곳을 보세요.\n" +
      "- 빨간 손글씨, 검은 테이프, 찢어진 부분, 도장은 무시하고 인쇄된 글자만 읽으세요.\n" +
      "- ★ 0504-XXXX-XXXX, 0502-XXXX-XXXX 는 안심번호(전화)입니다. 송장번호가 아닙니다.\n" +
      "  송장번호와 자릿수·하이픈 모양이 똑같으니 헷갈리지 마세요. 송장번호는 2 로 시작합니다.\n" +
      "  0 으로 시작하는 번호는 절대 invoiceNumber 에 넣지 말고 전화번호 칸에 넣으세요.\n" +
      "- 라벨이 세로로 돌아가 있거나 다른 라벨이 겹쳐 있을 수 있습니다.\n" +
      "  「반품회수」 표시가 있는 라벨의 번호를 우선하세요.\n" +
      "- 「반품회수」 라벨이면 받는 분은 회수처(팩투유)이고, 보내는 분이 실제 고객입니다.\n" +
      "  senderName·senderPhone 에 보내는 분 정보를 정확히 넣으세요.\n\n" +
      "{\n" +
      "  \"invoiceNumber\": \"운송장번호 (숫자만). 없으면 사진에서 가장 확실한 송장번호\",\n" +
      "  \"returnInvoiceNumber\": \"운송장번호 칸의 번호 (숫자만)\",\n" +
      "  \"originalInvoiceNumber\": \"원송장번호 칸의 번호 (숫자만)\",\n" +
      "  \"recipientName\": \"받는 분 이름\",\n" +
      "  \"phone\": \"받는 분 전화번호\",\n" +
      "  \"address\": \"받는 분 주소\",\n" +
      "  \"senderName\": \"보내는 분 이름 (반품이면 이쪽이 고객)\",\n" +
      "  \"senderPhone\": \"보내는 분 전화번호\",\n" +
      "  \"orderNumber\": \"주문번호 칸의 값\",\n" +
      "  \"itemName\": \"품명 칸의 값\",\n" +
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

    // 번호 칸은 전부 숫자만 남긴다 (하이픈 표기 NNNN-NNNN-NNNN 대응)
    ["invoiceNumber", "returnInvoiceNumber", "originalInvoiceNumber"].forEach(function (k) {
      if (result[k]) result[k] = String(result[k]).replace(/[^0-9]/g, "");
    });
    // 운송장번호 칸을 읽었으면 그것을 대표값으로 올린다
    if (!result.invoiceNumber && result.returnInvoiceNumber) {
      result.invoiceNumber = result.returnInvoiceNumber;
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
        senderPhone: String(r.senderPhone || ""),
        carrier: String(r.carrier || ""),
        // 반품회수 라벨에는 번호가 둘이다. 매칭 쪽에서 둘 다 써야 한다.
        returnInvoiceNumber: String(r.returnInvoiceNumber || ""),
        originalInvoiceNumber: String(r.originalInvoiceNumber || ""),
        orderNumber: String(r.orderNumber || ""),
        itemName: String(r.itemName || "")
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
