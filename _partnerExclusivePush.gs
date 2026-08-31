/**
 * [협력업체] 대리공급업체 발주 → 전용양식 자동 Push  v1.1
 * 파일: _partnerExclusivePush.gs
 *
 * 흐름:
 *   이카운트 발주 탭("대리공급업체 발주") 읽기
 *   → D열 이카운트코드 앞 2자리(prefix) → _PEP_VENDOR_COL_OVERRIDES_ 적용
 *   → 품목코드/품목명 별칭 변환 (대리발송 별칭 테이블)
 *   → 협력업체 파일의 "전용양식" 탭에 Push
 *      A열(송장번호), B열(이슈) = 비워둠  ← 업체가 직접 기입
 *   → 소스 탭에 고유ID 기록 → 다음 실행 시 UID 있는 행 = 스킵 (중복 방지)
 *
 * 자동 실행:
 *   partnerCollectOrdersSilent_() 트리거에서 호출 → 5분 간격 자동 Push
 *
 * 송장 회수:
 *   partnerFetchInvoices → 전용양식 A열(송장번호) 자동 역수집
 */

// ══════════════════════════════════════════════════════════
//  📬 카카오 송장 매칭 사이드바 — 서버사이드
// ══════════════════════════════════════════════════════════

/** 사이드바 열기 (★ 2026-06-24: 다이렉트 방식 — 웹앱 프록시 제거, google.script.run 직접 호출) */
function openInvoiceMatchSidebar() {
  var html = HtmlService.createHtmlOutputFromFile("invoiceMatchSidebar")
    .setTitle("📬 카카오 송장 매칭")
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

/** HTML → 업체 파일 목록 반환 (★ 2026-06-24: 다이렉트 호출 — 웹앱 프록시 제거) */
function getPartnerFileListForSidebar() {
  return _imGetPartnerFileList_();
}


/**
 * 이미지 OCR: Gemini Vision API를 사용하여 송장 테이블 이미지에서
 * 받는사람(수취인) + 송장번호를 **행 단위**로 추출.
 *
 * ★ 기존 Google Drive OCR은 테이블을 열(column) 단위로 읽어서
 *   이름-송장번호 매핑이 깨지는 근본 문제가 있었음.
 *   Gemini Vision은 테이블 구조를 이해하여 행(row) 단위로 정확히 추출.
 *
 * @param {string} base64Data - Base64 인코딩된 이미지 (data:image/... 프리픽스 포함 가능)
 * @returns {string} "이름 송장번호" 형식의 텍스트 (줄당 1건)
 */
function ocrImageToText(base64Data) {
  try {
    // Base64 프리픽스 처리
    var mimeType = "image/png";
    var rawB64 = base64Data;
    if (base64Data.indexOf(",") !== -1) {
      var parts = base64Data.split(",");
      var mimeMatch = parts[0].match(/data:([^;]+)/);
      if (mimeMatch) mimeType = mimeMatch[1];
      rawB64 = parts[1];
    }

    // ★ 2026-07-24: gemini-3.6-flash로 업그레이드 (OCR 정확도 최우선)
    var model = "gemini-3.6-flash";
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      model + ":generateContent?key=" + GEMINI_API_KEY;

    // ★ 2026-06-18: 거래명세서 운송방법 섹션도 인식하도록 프롬프트 확장
    var prompt =
      "이 이미지에서 **택배 수취인(받는사람) 이름**과 **택배 송장번호(운송장번호, 10~14자리 연속 숫자)**를 추출해주세요.\n\n" +
      "이미지 유형별 처리:\n" +
      "A) **택배 송장 목록 테이블**: 각 행(row)에서 받는사람 이름과 송장번호를 추출\n" +
      "B) **거래명세서**: '운송방법' 또는 '배송정보' 영역에서만 이름과 송장번호를 추출\n" +
      "C) **기타 형태**: 10~14자리 연속 숫자 근처의 이름을 추출\n\n" +
      "❌ 절대 추출하지 말 것:\n" +
      "- 사업자등록번호 (xxx-xx-xxxxx 형식, 예: 585-88-00931, 125-86-31688)\n" +
      "- 거래명세서 상단의 공급자/공급받는자 성명 (대표자명)\n" +
      "- TEL, FAX 전화번호\n" +
      "- 은행계좌번호\n\n" +
      "규칙:\n" +
      "1. 출력 형식: 한 줄에 '이름 송장번호' (공백으로 구분)\n" +
      "2. 송장번호는 반드시 10~14자리 **연속 숫자** (하이픈으로 구분된 xxx-xx-xxxxx는 송장번호가 아님)\n" +
      "3. 택배사명(롯데, CJ대한통운 등)은 이름이 아님. 단, '○○아파트 관리사무소', '○○ 커뮤니티센터' 같은 구체적 장소명은 수취인 이름으로 포함\n" +
      "4. 이름 뒤의 '님'은 제거\n" +
      "5. 한글/영문 이름 모두 추출\n" +
      "6. 인라인 형태도 줄 단위로 분리\n" +
      "7. 다른 설명 없이 오직 '이름 송장번호' 형식만 출력\n\n" +
      "예시 출력:\n" +
      "홍길동 1234567890\n" +
      "김철수 9876543210\n" +
      "YINCHENGGUO 2670961463010";

    var payload = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: rawB64,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        // ★ 2026-07-24: 3.x 모델은 thinking 토큰이 출력 한도를 소모 → 2048에서 상향
        maxOutputTokens: 8192,
      },
    };

    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());

    if (json.error) {
      throw new Error("Gemini API 오류: " + json.error.message);
    }

    var text = "";
    try {
      text = json.candidates[0].content.parts[0].text || "";
    } catch (eParse) {
      throw new Error("Gemini 응답 파싱 실패");
    }

    // ★ 마크다운 코드블록 제거 (```...``` 형태 응답 대응)
    text = text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");

    Logger.log("[OCR-Gemini] 추출 텍스트:\n" + text);
    return text || "";
  } catch (e) {
    Logger.log("[OCR-Gemini] 오류: " + e.message);
    // ★ 폴백: Gemini 실패 시 기존 Drive OCR 시도
    try {
      return _ocrImageToText_DriveFallback_(base64Data);
    } catch (eFb) {
      throw new Error("이미지 OCR 실패: " + e.message);
    }
  }
}

/**
 * ★ 폴백 OCR: 기존 Google Drive OCR 방식 (Gemini 실패 시 사용)
 */
function _ocrImageToText_DriveFallback_(base64Data) {
  var mimeType = "image/png";
  var rawB64 = base64Data;
  if (base64Data.indexOf(",") !== -1) {
    var parts = base64Data.split(",");
    var mimeMatch = parts[0].match(/data:([^;]+)/);
    if (mimeMatch) mimeType = mimeMatch[1];
    rawB64 = parts[1];
  }
  var decoded = Utilities.base64Decode(rawB64);
  var blob = Utilities.newBlob(decoded, mimeType, "ocr_temp_" + Date.now());
  var tempFile = DriveApp.createFile(blob);
  var fileId = tempFile.getId();
  var token = ScriptApp.getOAuthToken();
  var copyUrl = "https://www.googleapis.com/drive/v2/files/" + fileId + "/copy";
  var copyResp = UrlFetchApp.fetch(copyUrl, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({
      title: "OCR_temp_" + Date.now(),
      mimeType: "application/vnd.google-apps.document",
    }),
    muteHttpExceptions: true,
  });
  var copyResult = JSON.parse(copyResp.getContentText());
  var docId = copyResult.id;
  if (!docId) {
    tempFile.setTrashed(true);
    throw new Error("Drive OCR 변환 실패");
  }
  var doc = DocumentApp.openById(docId);
  var text = doc.getBody().getText();
  try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
  try { tempFile.setTrashed(true); } catch (e) {}
  return text || "";
}

// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-07: 헤더 기반 구조화 TSV 파서 (최우선)
//  한국 택배사 데이터는 항상 헤더가 있는 TSV
// ═══════════════════════════════════════════════════════════════

/**
 * 헤더가 있는 TSV/CSV 데이터를 직접 파싱
 * 헤더에서 수취인/송장/품목 열을 자동 감지
 * @returns {Array|null} [{name, tracking, itemName}] 또는 null
 */
function _parseStructuredTSV_(rawText) {
  if (!rawText || rawText.length < 20) return null;

  var lines = rawText.split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
  if (lines.length < 2) return null; // 헤더 + 최소 1행

  // 탭 구분 감지 (탭이 2개 이상이면 TSV)
  var headerLine = lines[0];
  var sep = (headerLine.split("\t").length > 2) ? "\t" : ",";
  var headers = headerLine.split(sep);

  // 열 인덱스 찾기 (다양한 헤더명 대응)
  var nameCol = -1, trackingCol = -1, itemCol = -1;
  var NAME_PATTERNS = ["받으시는", "받는분", "수취인", "받는사람", "수취인명", "받는분성명"];
  var TRACKING_PATTERNS = ["운송장", "송장번호", "송장", "운송장번호", "택배번호", "waybill"];
  var ITEM_PATTERNS = ["품목명", "품목", "상품명", "제품명", "품명"];
  // ★ 이 키워드가 포함된 열은 이름 열에서 제외
  var EXCLUDE_FROM_NAME = ["주소", "총주소", "연락처", "전화", "핸드폰", "휴대"];

  for (var h = 0; h < headers.length; h++) {
    var hdr = headers[h].trim().replace(/\s+/g, "");

    // 이름 열 (아직 못 찾았을 때만)
    if (nameCol === -1) {
      var isExcluded = false;
      for (var ei = 0; ei < EXCLUDE_FROM_NAME.length; ei++) {
        if (hdr.indexOf(EXCLUDE_FROM_NAME[ei]) !== -1) { isExcluded = true; break; }
      }
      if (!isExcluded) {
        for (var ni = 0; ni < NAME_PATTERNS.length; ni++) {
          if (hdr.indexOf(NAME_PATTERNS[ni].replace(/\s+/g, "")) !== -1) { nameCol = h; break; }
        }
      }
    }

    // 송장 열 (아직 못 찾았을 때만)
    if (trackingCol === -1) {
      for (var ti = 0; ti < TRACKING_PATTERNS.length; ti++) {
        if (hdr.indexOf(TRACKING_PATTERNS[ti].replace(/\s+/g, "")) !== -1) { trackingCol = h; break; }
      }
    }

    // 품목 열 (아직 못 찾았을 때만)
    if (itemCol === -1) {
      for (var ii = 0; ii < ITEM_PATTERNS.length; ii++) {
        if (hdr.indexOf(ITEM_PATTERNS[ii].replace(/\s+/g, "")) !== -1) { itemCol = h; break; }
      }
    }
  }

  // 최소 수취인 + 송장번호 열 필요
  if (nameCol === -1 || trackingCol === -1) {
    Logger.log("[TSV파싱] 헤더 감지 실패: nameCol=" + nameCol + ", trackingCol=" + trackingCol + ", headers=" + headers.join("|"));
    return null;
  }

  Logger.log("[TSV파싱] 헤더 감지 성공: name=" + nameCol + "(" + headers[nameCol] + "), tracking=" + trackingCol + "(" + headers[trackingCol] + "), item=" + (itemCol >= 0 ? itemCol + "(" + headers[itemCol] + ")" : "없음"));

  var result = [];
  for (var r = 1; r < lines.length; r++) {
    var cols = lines[r].split(sep);
    var name = (cols[nameCol] || "").trim();
    var tracking = (cols[trackingCol] || "").replace(/[-\s]/g, "").trim();
    var itemName = itemCol >= 0 ? (cols[itemCol] || "").trim() : "";

    if (!name || !tracking || !/^\d{10,14}$/.test(tracking)) continue;

    // 송하인 필터 (팩투유 등)
    if (/팩투유|pack2u/i.test(name)) continue;

    result.push({ name: name, tracking: tracking, itemName: itemName });
  }

  Logger.log("[TSV파싱] 결과: " + result.length + "건 추출 (총 " + (lines.length - 1) + "행)");
  return result.length > 0 ? result : null;
}

// ═══════════════════════════════════════════════════════════════
//  ★ Gemini AI 기반 송장 데이터 파싱 (TSV 실패 시 폴백)
// ═══════════════════════════════════════════════════════════════

/**
 * Gemini AI로 텍스트에서 수취인/송장번호/품목명 추출
 * @param {string} rawText - 원시 텍스트 (엑셀 붙여넣기, 카카오 메시지 등)
 * @returns {Array} [{name, tracking, itemName}] 배열
 */
function _parseInvoicePairsWithGemini_(rawText) {
  var model = "gemini-3.6-flash"; // ★ 2026-07-24 업그레이드
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    model + ":generateContent?key=" + GEMINI_API_KEY;

  // ★ 프롬프트: 예시 이름 사용하지 않음 (hallucination 방지)
  var prompt =
    "아래 === 데이터 시작 === 이후의 택배 배송 데이터만 분석해.\n" +
    "각 행에서 받는사람 이름(name), 송장번호(tracking), 품목명(itemName)을 추출해.\n" +
    "보내는 사람(팩투유, 주식회사 팩투유 등), 택배사명, 주소, 전화번호는 제외해.\n" +
    "반드시 실제 데이터에 있는 값만 추출해. 예시나 가짜 데이터를 만들지 마.\n" +
    "JSON 배열만 출력: [{\"name\":\"...\",\"tracking\":\"...\",\"itemName\":\"...\"}]\n\n" +
    "=== 데이터 시작 ===\n" +
    rawText;

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var respCode = response.getResponseCode();
  var respText = response.getContentText();
  Logger.log("[Gemini] HTTP " + respCode + ", 응답: " + respText.substring(0, 500));

  if (respCode !== 200) {
    // ★ 2026-07-24: 폴백 모델 — gemini-3.5-flash (1.5는 지원 종료)
    Logger.log("[Gemini] " + model + " 실패, gemini-3.5-flash 시도...");
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=" + GEMINI_API_KEY;
    response = UrlFetchApp.fetch(url, options);
    respCode = response.getResponseCode();
    respText = response.getContentText();
    Logger.log("[Gemini] 1.5 시도 HTTP " + respCode);
    if (respCode !== 200) {
      Logger.log("[Gemini] 모든 모델 실패: " + respText.substring(0, 200));
      return null;
    }
  }

  var json = JSON.parse(respText);
  if (json.error) {
    Logger.log("[Gemini] API 오류: " + json.error.message);
    return null;
  }

  var text = "";
  try {
    text = json.candidates[0].content.parts[0].text || "";
  } catch (eParse) {
    Logger.log("[Gemini] 응답 구조 이상: " + respText.substring(0, 200));
    return null;
  }

  // 마크다운 코드블록 제거
  text = text.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
  Logger.log("[Gemini] 파싱할 텍스트: " + text.substring(0, 300));

  var parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    Logger.log("[Gemini] 빈 결과");
    return null;
  }

  // 정규화
  var result = [];
  for (var i = 0; i < parsed.length; i++) {
    var p = parsed[i];
    var tracking = String(p.tracking || "").replace(/[-\s]/g, "").trim();
    var name = String(p.name || "").replace(/\s*님\s*$/g, "").trim();
    if (!tracking || !/^\d{10,14}$/.test(tracking) || !name) continue;
    result.push({
      tracking: tracking,
      name: name,
      itemName: String(p.itemName || "").trim(),
    });
  }

  Logger.log("[Gemini] 성공: " + result.length + "건 추출");
  return result.length > 0 ? result : null;
}

/**
 * Gemini AI로 이미지에서 직접 수취인/송장번호/품목명 추출
 * (OCR + 파싱을 한 번에 처리)
 * @param {string} base64Data - Base64 이미지 데이터
 * @returns {Array|null} [{name, tracking, itemName}] 또는 null(폴백)
 */
function _parseInvoiceImageWithGemini_(base64Data) {
  try {
    var mimeType = "image/png";
    var rawB64 = base64Data;
    if (base64Data.indexOf(",") !== -1) {
      var parts = base64Data.split(",");
      var mimeMatch = parts[0].match(/data:([^;]+)/);
      if (mimeMatch) mimeType = mimeMatch[1];
      rawB64 = parts[1];
    }

    var model = "gemini-3.6-flash"; // ★ 2026-07-24 업그레이드
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      model + ":generateContent?key=" + GEMINI_API_KEY;

    var prompt =
      "이 이미지에서 받는사람 이름, 송장번호(10~14자리 연속 숫자), 품목명을 찾아서 JSON 배열로 만들어줘.\n" +
      "받는사람은 상호·지점명일 수 있음 — 전체를 그대로 출력하고 '님'과 수량 표기는 제거.\n" +
      "보내는 사람(팩투유 등)·택배사명·사업자번호·전화번호는 제외해.\n" +
      "형식: [{\"name\":\"홍길동\",\"tracking\":\"1234567890\",\"itemName\":\"158Ø캡\"}]\n" +
      "JSON만 출력해.";

    var payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: rawB64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    };

    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());

    if (json.error) {
      Logger.log("[Gemini이미지파싱] API 오류: " + json.error.message);
      return null;
    }

    var text = "";
    try {
      text = json.candidates[0].content.parts[0].text || "";
    } catch (eParse) { return null; }

    text = text.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
    var parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    var result = [];
    for (var i = 0; i < parsed.length; i++) {
      var p = parsed[i];
      var tracking = String(p.tracking || "").replace(/[-\s]/g, "").trim();
      var name = String(p.name || "").replace(/\s*님\s*$/g, "").trim();
      if (!tracking || !/^\d{10,14}$/.test(tracking) || !name) continue;
      result.push({ tracking: tracking, name: name, itemName: String(p.itemName || "").trim() });
    }

    Logger.log("[Gemini이미지파싱] 성공: " + result.length + "건 추출");
    return result.length > 0 ? result : null;
  } catch (e) {
    Logger.log("[Gemini이미지파싱] 예외: " + e.message);
    return null;
  }
}

/**
 * 이미지에서 직접 파싱+매칭 (OCR 없이 한 번에)
 * 사이드바 HTML에서 호출
 */
function parseAndMatchInvoiceImage(fileId, base64Data) {
  var pairs = _parseInvoiceFileWithGemini_(base64Data);
  if (!pairs) {
    var text = ocrImageToText(base64Data);
    return _imParseAndMatch_(fileId, text);
  }
  return _imParseAndMatchWithPairs_(fileId, pairs);
}

/**
 * ★ 2026-07-07: 엑셀/CSV 파일을 서버에서 텍스트 변환 후 Gemini로 파싱+매칭
 * base64DataUrl: "data:application/vnd.ms-excel;base64,..." 형식
 */
function parseAndMatchInvoiceFile(fileId, base64DataUrl) {
  try {
    // data:mime;base64,XXXX 에서 분리
    var match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return { error: "파일 형식 오류" };
    var mimeType = match[1];
    var rawB64 = match[2];
    var bytes = Utilities.base64Decode(rawB64);

    // ★ 한국 사방넷/택배 시스템 엑셀 = 실제로는 UTF-16 LE TSV
    var textContent = null;

    // 1단계: UTF-16 LE BOM 감지 (0xFF 0xFE)
    if (bytes.length >= 2 && (bytes[0] & 0xFF) === 0xFF && (bytes[1] & 0xFF) === 0xFE) {
      Logger.log("[송장매칭-파일] UTF-16 LE 감지, 디코딩 중...");
      var decoded = [];
      for (var i = 2; i < bytes.length - 1; i += 2) {
        var lo = bytes[i] & 0xFF;
        var hi = bytes[i + 1] & 0xFF;
        decoded.push(String.fromCharCode(lo | (hi << 8)));
      }
      textContent = decoded.join("");
    }
    // 2단계: 일반 텍스트 (CSV/TSV)
    else if (mimeType.indexOf("text/") === 0 || mimeType === "application/csv") {
      textContent = Utilities.newBlob(bytes).getDataAsString("UTF-8");
    }
    // 3단계: 진짜 xlsx → Google Drive로 변환
    else {
      Logger.log("[송장매칭-파일] 바이너리 Excel 감지, Drive 변환 시도...");
      try {
        var blob = Utilities.newBlob(bytes, mimeType, "temp_invoice.xls");
        var tempFile = Drive.Files.insert(
          { title: "_temp_invoice_" + Date.now(), mimeType: "application/vnd.google-apps.spreadsheet" },
          blob, { convert: true }
        );
        var tempSs = SpreadsheetApp.openById(tempFile.id);
        var sheet = tempSs.getSheets()[0];
        var data = sheet.getDataRange().getValues();
        textContent = data.map(function(row) { return row.join("\t"); }).join("\n");
        Drive.Files.remove(tempFile.id);
        Logger.log("[송장매칭-파일] Drive 변환 완료, " + data.length + "행");
      } catch (driveErr) {
        Logger.log("[송장매칭-파일] Drive 변환 실패: " + driveErr.message);
        return { error: "엑셀 파일 변환 실패. 텍스트 붙여넣기를 시도해주세요." };
      }
    }

    if (!textContent || textContent.trim().length < 10) {
      return { error: "파일에서 텍스트를 추출하지 못했습니다." };
    }

    Logger.log("[송장매칭-파일] 추출 텍스트 " + textContent.length + "자, Gemini 파싱 시작");

    // Gemini에 텍스트로 전송
    var pairs = _parseInvoicePairsWithGemini_(textContent);
    if (pairs && pairs.length > 0) {
      return _imParseAndMatchWithPairs_(fileId, pairs);
    }

    // 폴백: 기존 정규식
    Logger.log("[송장매칭-파일] Gemini 실패, 정규식 폴백");
    return _imParseAndMatch_(fileId, textContent);
  } catch (e) {
    Logger.log("[송장매칭-파일] 예외: " + e.message);
    return { error: "파일 처리 오류: " + e.message };
  }
}

/**
 * Gemini에 파일(이미지)을 직접 전송하여 수취인/송장/품목 추출
 * ★ 이미지 전용 (엑셀은 parseAndMatchInvoiceFile 사용)
 */
function _parseInvoiceFileWithGemini_(base64DataUrl) {
  try {
    // data:mime;base64,XXXX 에서 mime과 base64 분리
    var match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      Logger.log("[송장매칭] base64 DataURL 형식 오류");
      return null;
    }
    var mimeType = match[1];
    var rawB64 = match[2];

    // 이미지가 아니면 null (엑셀 등은 별도 처리)
    if (mimeType.indexOf("image/") !== 0) {
      Logger.log("[송장매칭] 이미지가 아닌 파일: " + mimeType);
      return null;
    }

    // ★ 2026-07-24: 인식률 개선 — 프롬프트 상세화 (기존 4줄 프롬프트가 인식 실패 주원인 중 하나)
    var prompt =
      "이 이미지는 택배 발송 목록입니다 (송장 라벨, 접수 리스트 테이블, 채팅 캡처, 거래명세서 등).\n" +
      "각 건에서 받는사람(name), 송장번호(tracking), 품목명(itemName)을 추출해 JSON 배열로 출력하세요.\n\n" +
      "규칙:\n" +
      "1. tracking = 10~14자리 연속 숫자. 하이픈/공백이 섞여 있으면 제거하고 숫자만 출력.\n" +
      "   사업자등록번호(xxx-xx-xxxxx), 전화번호, 계좌번호, 금액은 송장번호가 아님.\n" +
      "2. name = 받는사람. 개인 이름뿐 아니라 상호·지점명일 수 있음(예: '밥장인 고터점', '햇살블루 김금자').\n" +
      "   상호+이름이 함께 있으면 전체를 그대로 출력. 뒤에 붙은 '님'과 수량 표기('1박스', '2개' 등)는 제거.\n" +
      "3. 보내는사람(팩투유, 주식회사 팩투유 등)·택배사명(로젠, CJ대한통운 등)·주소·전화번호는 제외.\n" +
      "4. 테이블은 반드시 행(row) 단위로 읽고, 같은 행의 이름과 송장번호를 짝지을 것.\n" +
      "5. 품목명이 안 보이면 itemName은 빈 문자열.\n" +
      "6. 실제 이미지에 있는 값만 출력. 예시나 가짜 데이터를 만들지 말 것.\n" +
      '출력 형식(JSON만): [{"name":"...","tracking":"...","itemName":"..."}]';

    var payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: rawB64 } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16384,
        // ★ 2026-07-24: JSON 강제 출력 — 마크다운 감싸기/설명문 차단
        responseMimeType: "application/json",
      },
    };

    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    // ★ 2026-07-24: gemini-3.6-flash 업그레이드 + 실패 시 3.5-flash 폴백
    var models = ["gemini-3.6-flash", "gemini-3.5-flash"];
    var json = null;
    for (var mi = 0; mi < models.length; mi++) {
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
        models[mi] + ":generateContent?key=" + GEMINI_API_KEY;
      var response = UrlFetchApp.fetch(url, options);
      var respCode = response.getResponseCode();
      json = JSON.parse(response.getContentText());
      if (respCode === 200 && !json.error) break;
      Logger.log("[송장매칭-이미지] " + models[mi] + " HTTP " + respCode +
        (json.error ? " (" + json.error.message + ")" : "") +
        (mi < models.length - 1 ? " → 폴백 시도" : ""));
      json = null;
    }
    if (!json) return null;

    var text = "";
    try {
      text = json.candidates[0].content.parts[0].text || "";
    } catch (eResp) {
      Logger.log("[송장매칭-이미지] 응답 구조 이상");
      return null;
    }
    Logger.log("[송장매칭-이미지] Gemini 응답: " + text.substring(0, 300));

    // ★ 2026-07-24 버그수정: 마크다운 코드블록 제거 — 기존엔 없어서
    //   ```json ...``` 응답이 오면 JSON.parse 예외 → "인식 못함"으로 떨어졌음
    text = text.replace(/```json\n?/gi, "").replace(/```/g, "").trim();

    var parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) parsed = [parsed];
    if (parsed.length === 0) return null;

    // ★ 2026-07-24: 서버측 정규화/검증 — 기존엔 원본 그대로 반환해
    //   하이픈 섞인 송장번호·'님' 접미가 매칭 단계에서 실패했음
    var result = [];
    for (var i = 0; i < parsed.length; i++) {
      var p = parsed[i] || {};
      var tracking = String(p.tracking || "").replace(/\D/g, "");
      var name = String(p.name || "")
        .replace(/\s*님\s*$/g, "")
        .replace(/\s*\d+\s*(박스|봉지|세트|묶음|개|EA)\s*$/i, "")
        .trim();
      if (!name || !/^\d{10,14}$/.test(tracking)) continue;
      result.push({ name: name, tracking: tracking, itemName: String(p.itemName || "").trim() });
    }
    Logger.log("[송장매칭-이미지] 정규화 후 " + result.length + "건 (원본 " + parsed.length + "건)");
    return result.length > 0 ? result : null;
  } catch (e) {
    Logger.log("[송장매칭-이미지] 예외: " + e.message);
    return null;
  }
}

/**
 * 이미 파싱된 pairs를 전용양식과 매칭
 * (Gemini 파싱 결과를 직접 매칭에 사용)
 */
function _imParseAndMatchWithPairs_(ssId, pairs) {
  return _imParseAndMatch_(ssId, null, pairs);
}

/** HTML → 텍스트 파싱 + 매칭 (★ 2026-06-24: 다이렉트 호출 — 웹앱 프록시 제거) */
function parseAndMatchInvoiceText(fileId, rawText) {
  return _imParseAndMatch_(fileId, rawText);
}

/** HTML → 송장번호 반영 (★ 2026-06-24: 다이렉트 호출 — 웹앱 프록시 제거) */
function applyInvoiceMatches(fileId, matchesJson) {
  return _imApplyMatches_(fileId, matchesJson);
}

/**
 * ★ 2026-07-08: 전용양식 미발주 데이터 엑셀 다운로드용
 * 사이드바 SheetJS에서 .xlsx 생성 → 브라우저 직접 다운로드
 * @param {string} fileId 업체 시트 ID
 * @return {{ headers: string[], data: Array[], vendorName: string, total: number, filtered: number }}
 */
function getExclusiveFormDataForDownload(fileId) {
  try {
    var ss = SpreadsheetApp.openById(fileId);
    var tabs = ss.getSheets();
    var exTab = null;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getName().indexOf("전용양식") !== -1) {
        exTab = tabs[i]; break;
      }
    }
    if (!exTab) return { error: "전용양식 탭을 찾을 수 없습니다." };

    var lr = exTab.getLastRow();
    if (lr < 2) return { error: "전용양식에 데이터가 없습니다." };
    var lc = exTab.getLastColumn();

    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();

    // A열(송장번호) 비어있고, C열 이후 데이터가 있는 행만 필터
    var filtered = [];
    for (var di = 0; di < data.length; di++) {
      var invoice = String(data[di][0] || "").trim();
      // 송장번호 있으면 이미 발주 완료 → 제외
      if (invoice) continue;
      // C열(index 2) 이후 값이 하나라도 있으면 포함
      var hasData = false;
      for (var ci = 2; ci < data[di].length; ci++) {
        if (String(data[di][ci] || "").trim()) { hasData = true; break; }
      }
      if (hasData) filtered.push(data[di].slice(2)); // C열부터
    }

    // 거래처명
    var vendorName = "";
    try {
      var st = ss.getSheetByName("설정");
      if (st) vendorName = String(st.getRange("B5").getValue() || "").trim();
    } catch(e) {}
    if (!vendorName) vendorName = ss.getName().replace("[협력업체] ", "");

    return {
      headers: headers.slice(2).map(function(h) { return String(h || ""); }),
      data: filtered,
      vendorName: vendorName,
      total: data.length,
      filtered: filtered.length
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── 소스: 외부 스프레드시트 (대리공급업체 발주 데이터)
var _PEP_SOURCE_SHEET_ID = "1vWdJgmbW_Gwm_2b1pP8mVBxpfYBbUiAduSwkStXxs0Y";
var _PEP_SOURCE_TAB_GID = 1981160530; // 대리공급업체 발주 탭 GID
var _PEP_SOURCE_TAB_NAME = "대리공급업체 발주"; // GID 불일치 시 이름 폴백
var _PEP_CODE_COL = 3; // D열 (0-based): 이카운트코드
var _PEP_ITEM_COL = 4; // E열 (0-based): 품목명

/**
 * P열(고유ID) 없는 행에만 UID 생성.
 * 형식: MMDD-ph-XXXX (4자리 영문+숫자, I/O/0/1 제외)
 * 기존 고유ID는 절대 수정·변형하지 않음.
 *
 * 해시: 일자+품목코드+수취인(M)+전화+주소 — 동일 품목·동일 이름만으로 UID가
 *       겹치지 않도록 수취인·연락처·주소를 포함한다.
 */
function _pep_deriveDeterministicUid_(row, todayYmd) {
  // 날짜 (yyyyMMdd)
  var dateStr = todayYmd || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  var rawDate = row[2];
  if (rawDate) {
    var ds = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, "Asia/Seoul", "yyyyMMdd")
      : String(rawDate).replace(/[^0-9]/g, "").substring(0, 8);
    if (ds && ds.length >= 8) dateStr = ds;
  }
  // MMDD (앞 4자리 yyyy 제거)
  var mmdd = dateStr.substring(4, 8);

  // C=일자 D=코드 M=거래처명(수취인) H/I=전화 J=주소
  var code = String(row[_PEP_CODE_COL] || "").replace(/\s/g, "").trim().substring(0, 12) || "X";
  var recipient = String(row[12] || "").replace(/\s/g, "").trim().substring(0, 12) || "U";
  var phone = String(row[8] || row[7] || "").replace(/[^0-9]/g, "");
  var addr = String(row[9] || "").replace(/\s/g, "").trim().substring(0, 16);
  var hashInput = dateStr + code + recipient + phone + addr;

  // 4자리 영문+숫자 결정론적 생성 (I/O/0/1 제외 — 혼동 방지)
  var CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var h = 0;
  for (var i = 0; i < hashInput.length; i++) {
    h = Math.imul(31, h) + hashInput.charCodeAt(i) | 0;
  }
  var n = Math.abs(h);
  var suffix = "";
  for (var j = 0; j < 4; j++) {
    suffix += CHARS[n % CHARS.length];
    n = Math.floor(n / CHARS.length);
  }

  // 형식: MMDD-ph-XXXX  예) 0521-ph-A3KM
  return mmdd + "-ph-" + suffix;
}

function _pep_cloneUidSet_(src) {
  var copy = {};
  if (!src) return copy;
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k)) copy[k] = true;
  }
  return copy;
}

/** AX(50열)에 저장된 고유ID 건수 집계 (동일 UID 여러 행 허용) */
function _pep_normalizeAxUid_(axUid) {
  var u = String(axUid || "").trim();
  if (!u) return "";
  var pipe = u.indexOf("|");
  if (pipe > 0) u = u.substring(0, pipe);
  u = u.replace(/_S\d+$/, "");
  return u;
}

function _pep_loadExclusiveUidCounts_(tab) {
  var counts = {};
  if (!tab || tab.getLastRow() < 2) return counts;
  var axVals = tab.getRange(2, 50, tab.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < axVals.length; i++) {
    var uid = _pep_normalizeAxUid_(axVals[i][0]);
    if (!uid) continue;
    counts[uid] = (counts[uid] || 0) + 1;
  }
  return counts;
}

/** 전용양식 중복 방지 키: UID 기반 (code 비어있으면 UID만 반환) */
function _pep_dedupKey_(uid, code) {
  var u = _pep_normalizeAxUid_(uid);
  var c = String(code || "").replace(/\s/g, "").trim();
  if (!u) return "";
  return c ? u + "|" + c : u;
}

/** AX(50열) 기준 dedup 건수 — UID만으로 중복 판별 (업체 간 일관성 보장) */
function _pep_loadExclusiveDedupCounts_(tab, directMap) {
  var counts = {};
  if (!tab || tab.getLastRow() < 2) return counts;
  var lr = tab.getLastRow();
  // ★ 최소 50열 확보 (AX열 누락 방지)
  try {
    var tabMaxC = tab.getMaxColumns();
    if (tabMaxC < 50) {
      tab.insertColumnsAfter(tabMaxC, 50 - tabMaxC);
    }
  } catch (eExpand) {}
  var vals = tab.getRange(2, 50, lr - 1, 1).getValues(); // AX열(50번째)만 읽기
  for (var i = 0; i < vals.length; i++) {
    var key = _pep_dedupKey_(vals[i][0], "");
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * ★ 2026-07-20: 마감탭("(YYYY년 M월) 전용발주 마감", 당월+전월) 고유ID 건수 집계
 *   마감 이동된 주문이 소스탭에 남아 있어도 재Push되지 않도록 dedup에 합산.
 *   마감탭은 "이동일시" 열이 앞에 붙어 고유ID가 51열(AY)이 기본 — 헤더로 탐지, 실패 시 51열 폴백.
 * @param {Spreadsheet} ss - 협력업체 파일
 * @returns {Object} { dedupKey: 건수 }
 */
function _pep_loadArchiveDedupCounts_(ss) {
  var counts = {};
  var now = new Date();
  for (var back = 0; back <= 1; back++) {
    var d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    var tabName =
      "(" + d.getFullYear() + "년 " + (d.getMonth() + 1) + "월) " +
      (typeof _PEA_TAB_SUFFIX !== "undefined" ? _PEA_TAB_SUFFIX : "전용발주 마감");
    var t = null;
    try { t = ss.getSheetByName(tabName); } catch (_) {}
    if (!t || t.getLastRow() < 2) continue;

    var lc = t.getLastColumn();
    var lr = t.getLastRow();
    var uidCol = -1;
    try {
      var hdr = t.getRange(1, 1, 1, lc).getValues()[0];
      for (var hi = hdr.length - 1; hi >= 0; hi--) {
        if (String(hdr[hi] || "").replace(/\s/g, "") === "고유ID") {
          uidCol = hi;
          break;
        }
      }
    } catch (_) {}
    if (uidCol === -1) uidCol = Math.min(50, lc - 1); // 폴백: 이동일시+AX = 51열(idx50)

    try {
      var vals = t.getRange(2, uidCol + 1, lr - 1, 1).getValues();
      for (var i = 0; i < vals.length; i++) {
        var key = _pep_dedupKey_(vals[i][0], "");
        if (!key) continue;
        counts[key] = (counts[key] || 0) + 1;
      }
    } catch (_) {}
  }
  return counts;
}

/** 임시기록 중복 판별용 — 코드+품목명+수취인+전화(동명·동품목 UID 재사용 방지) */
function _pep_tempFingerprintKey_(code, name, row) {
  var c = String(code || "").replace(/\s/g, "").trim();
  var n = String(name || "").replace(/\s/g, "").trim();
  if (!c && !n) return "";
  var base = c + "|" + n;
  if (!row) return base;
  var recipient = String(row[12] || "").replace(/\s/g, "").trim();
  var phone = String(row[8] || row[7] || "").replace(/[^0-9]/g, "");
  var phoneTail = phone.length >= 4 ? phone.slice(-4) : phone;
  return base + "|" + recipient + "|" + phoneTail;
}

function _pep_cloneFingerprintRows_(src) {
  var copy = {};
  if (!src) return copy;
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      copy[k] = src[k].slice();
    }
  }
  return copy;
}

/** 임시탭 기존 행 로드 — UID|코드 + (코드|품목명) 지문별 목록 */
function _pep_loadTempTabState_(tab) {
  var uidSet = {};
  var fingerprintRows = {};
  if (!tab || tab.getLastRow() < 2) {
    return { uidSet: uidSet, fingerprintRows: fingerprintRows };
  }
  var lastCol = Math.max(tab.getLastColumn(), 16);
  // ★ 2026-07-06: getLastRow()는 행 번호 → 행 수는 getLastRow() - 1
  var numRows = tab.getLastRow() - 1;
  var vals = tab.getRange(2, 1, numRows, lastCol).getValues();
  for (var i = 0; i < vals.length; i++) {
    var uid = String(vals[i][15] || "").trim();
    var code = String(vals[i][3] || "").trim();
    var name = String(vals[i][_PEP_ITEM_COL] || "").trim();
    // ★ 빈 행 스킵 (clearContent로 비워진 유령 행 방지)
    if (!uid && !code) continue;
    if (uid && code) {
      uidSet[uid + "|" + code] = true;
      uidSet[uid] = true;
    }
    var fp = _pep_tempFingerprintKey_(code, name, vals[i]);
    if (!fp) continue;
    if (!fingerprintRows[fp]) fingerprintRows[fp] = [];
    fingerprintRows[fp].push({ uid: uid, code: code, name: name });
  }
  return { uidSet: uidSet, fingerprintRows: fingerprintRows };
}

function _pep_escapeHtml_(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 대리발송 Push 완료 HTML 요약 (모달 다이얼로그용) */
function _pep_buildPushSummaryHtml_(opts) {
  var pushed = opts.pushed || 0;
  var pushedByPfx = opts.pushedByPfx || {};
  var tempNew = opts.tempNew || 0;
  var skipUid = opts.skipUid || 0;
  var skipNoMap = opts.skipNoMap || 0;
  var skipNoCode = opts.skipNoCode || 0;
  var skipNoFile = opts.skipNoFile || 0;
  var skipNoMapList = opts.skipNoMapList || [];
  var aliasCnt = opts.aliasCnt || 0;
  var errorLogs = opts.errorLogs || [];
  var vendorLabels =
    typeof _PEP_VENDOR_LABELS_ !== "undefined" ? _PEP_VENDOR_LABELS_ : {};

  var totalSkip = skipUid + skipNoMap + skipNoCode + skipNoFile;

  var h = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>";
  h += "body{font-family:'Noto Sans KR','Segoe UI',sans-serif;margin:0;padding:22px 24px;background:#f4f6f9;color:#1e293b;font-size:13px;line-height:1.5}";
  h += ".title{font-size:18px;font-weight:700;margin:0 0 16px;color:#0f172a}";
  h += ".summary{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}";
  h += ".card{flex:1;min-width:110px;padding:14px 12px;border-radius:10px;text-align:center;color:#fff;font-weight:600;box-shadow:0 2px 8px rgba(15,23,42,.12)}";
  h += ".card .num{font-size:26px;display:block;margin-bottom:2px;font-weight:700}";
  h += ".card .lbl{font-size:11px;opacity:.92}";
  h += ".c-push{background:linear-gradient(135deg,#2563eb,#1d4ed8)}";
  h += ".c-skip{background:linear-gradient(135deg,#64748b,#475569)}";
  h += ".c-temp{background:linear-gradient(135deg,#059669,#047857)}";
  h += ".c-alias{background:linear-gradient(135deg,#7c3aed,#6d28d9)}";
  h += "h3{margin:18px 0 10px;font-size:14px;font-weight:700;color:#0f172a;border-bottom:2px solid #cbd5e1;padding-bottom:6px}";
  h += ".vendor-table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(15,23,42,.06)}";
  h += ".vendor-table th{background:#f1f5f9;padding:10px 12px;text-align:left;font-size:12px;color:#475569;font-weight:600}";
  h += ".vendor-table td{padding:10px 12px;border-top:1px solid #f1f5f9;font-size:13px}";
  h += ".vendor-table tr:hover td{background:#f8fafc}";
  h += ".pfx{font-weight:700;color:#2563eb;min-width:48px;display:inline-block}";
  h += ".cnt{font-weight:700;font-size:15px;color:#0f172a;text-align:right}";
  h += ".zero{color:#94a3b8;font-weight:500}";
  h += ".detail-box{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:12px}";
  h += ".detail-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #f1f5f9;font-size:13px}";
  h += ".detail-row:last-child{border-bottom:0}";
  h += ".detail-label{color:#64748b}";
  h += ".detail-val{font-weight:600;color:#334155}";
  h += ".err-box{background:#fff5f5;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;max-height:160px;overflow-y:auto;font-size:12px;color:#991b1b}";
  h += ".err-line{padding:4px 0;border-bottom:1px solid #fee2e2}";
  h += ".err-line:last-child{border:0}";
  h += ".empty{padding:20px;text-align:center;color:#94a3b8;background:#fff;border:1px dashed #cbd5e1;border-radius:10px}";
  h += ".btn{display:block;width:140px;margin:20px auto 4px;padding:11px 0;background:#2563eb;color:#fff;border:0;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600}";
  h += ".btn:hover{background:#1d4ed8}";
  h += "</style></head><body>";

  h += "<div class=\"title\">📋 대리공급업체 발주 Push 완료</div>";

  h += "<div class=\"summary\">";
  h += "<div class=\"card c-push\"><span class=\"num\">" + pushed + "</span><span class=\"lbl\">전용양식 Push</span></div>";
  h += "<div class=\"card c-skip\"><span class=\"num\">" + totalSkip + "</span><span class=\"lbl\">스킵</span></div>";
  h += "<div class=\"card c-temp\"><span class=\"num\">" + tempNew + "</span><span class=\"lbl\">임시기록 신규</span></div>";
  h += "<div class=\"card c-alias\"><span class=\"num\">" + aliasCnt + "</span><span class=\"lbl\">별칭 로드</span></div>";
  h += "</div>";

  h += "<h3>🏭 업체별 Push 건수</h3>";
  var pfxKeys = Object.keys(pushedByPfx).sort(function (a, b) {
    return (pushedByPfx[b] || 0) - (pushedByPfx[a] || 0) || a.localeCompare(b);
  });
  if (pfxKeys.length === 0) {
    h += "<div class=\"empty\">이번 실행에서 전용양식으로 Push된 업체가 없습니다.</div>";
  } else {
    h += "<table class=\"vendor-table\"><thead><tr><th>접두</th><th>업체명</th><th style=\"text-align:right\">Push</th></tr></thead><tbody>";
    for (var pi = 0; pi < pfxKeys.length; pi++) {
      var pk = pfxKeys[pi];
      var cnt = pushedByPfx[pk] || 0;
      var vLabel = vendorLabels[pk] || "(미등록)";
      h +=
        "<tr><td><span class=\"pfx\">" +
        _pep_escapeHtml_(pk) +
        "</span></td><td>" +
        _pep_escapeHtml_(vLabel) +
        "</td><td class=\"cnt\">" +
        cnt +
        "건</td></tr>";
    }
    h += "</tbody></table>";
  }

  h += "<h3>⏭ 스킵 내역</h3><div class=\"detail-box\">";
  h += "<div class=\"detail-row\"><span class=\"detail-label\">이미 Push (고유ID 중복)</span><span class=\"detail-val\">" + skipUid + "건</span></div>";
  h += "<div class=\"detail-row\"><span class=\"detail-label\">매핑 없음</span><span class=\"detail-val\">" + skipNoMap + "건" +
    (skipNoMapList.length ? " (" + _pep_escapeHtml_(skipNoMapList.join(", ")) + ")" : "") + "</span></div>";
  h += "<div class=\"detail-row\"><span class=\"detail-label\">품목코드 없음 (D열)</span><span class=\"detail-val\">" + skipNoCode + "건</span></div>";
  h += "<div class=\"detail-row\"><span class=\"detail-label\">업체 파일 없음</span><span class=\"detail-val\">" + skipNoFile + "건</span></div>";
  h += "</div>";

  if (errorLogs.length > 0) {
    h += "<h3>⚠ 오류 (최대 10건)</h3><div class=\"err-box\">";
    for (var ei = 0; ei < Math.min(errorLogs.length, 10); ei++) {
      h += "<div class=\"err-line\">" + _pep_escapeHtml_(errorLogs[ei]) + "</div>";
    }
    h += "</div>";
  }

  h += "<button class=\"btn\" onclick=\"google.script.host.close()\">확인</button>";
  h += "</body></html>";
  return h;
}

// ── 별칭: 코드 변환 시트 (팩투유상품코드 → 업체상품코드/업체상품명)
// ★ HUB 「누적품목매핑」탭 우선 — 없으면 아래 외부 시트 폴백
// 탭 이름 후보 (앞에서부터 순서대로 탐색)
var _PEP_HUB_ALIAS_TAB_CANDIDATES = [
  "누적품목매핑",
  "매핑",
  "품목매핑",
  "대리발송_별칭맵",
  "별칭맵",
];
var _PEP_HUB_ALIAS_TAB_NAME = "누적품목매핑"; // 진단용 표시명
var _PEP_ALIAS_SHEET_ID = "1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE"; // 폴백 외부 시트
var _PEP_ALIAS_TAB_GID = 379869843;
var _PEP_ALIAS_TAB_NAME = ""; // GID 우선, 이름은 폴백

/**
 * 코드 변환 탭 로드
 * ★ 우선순위: HUB 「누적품목매핑」탭 → 외부 시트 폴백
 * 헤더: 팩투유상품코드, 팩투유상품명, 업체상품명, 업체상품코드, 업체접두, 단가(VAT포함)
 * 반환: { byPfxCode: {"HR_JH001": {sku, name, price, vat}}, byCode: {"JH001": {sku, name, price, vat}} }
 */
function _pep_loadAliasMap_() {
  var result = { byPfxCode: {}, byCode: {} };
  try {
    // ★ 1순위: HUB 「누적품목매핑」탭 — candidates 순서대로 탐색
    var tab = null;
    try {
      var props = PropertiesService.getScriptProperties();
      var hubId = props.getProperty("DB_HUB_ID");
      if (hubId) {
        var hubSS = SpreadsheetApp.openById(hubId);
        for (var hci = 0; hci < _PEP_HUB_ALIAS_TAB_CANDIDATES.length; hci++) {
          var cand = _PEP_HUB_ALIAS_TAB_CANDIDATES[hci];
          var hubTab = hubSS.getSheetByName(cand);
          if (hubTab && hubTab.getLastRow() >= 2) {
            tab = hubTab;
            Logger.log("[_pep_loadAliasMap_] HUB 탭 사용: " + cand);
            break;
          }
        }
      }
    } catch (eHub) {
      Logger.log(
        "[_pep_loadAliasMap_] HUB 접근 실패, 외부 시트 폴백: " + eHub.message,
      );
    }

    // ★ 2순위: 외부 시트 폴백
    if (!tab) {
      var ss = SpreadsheetApp.openById(_PEP_ALIAS_SHEET_ID);
      if (_PEP_ALIAS_TAB_GID) {
        var sheets = ss.getSheets();
        for (var si = 0; si < sheets.length; si++) {
          if (sheets[si].getSheetId() === _PEP_ALIAS_TAB_GID) {
            tab = sheets[si];
            break;
          }
        }
      }
      if (!tab && _PEP_ALIAS_TAB_NAME)
        tab = ss.getSheetByName(_PEP_ALIAS_TAB_NAME);
      if (!tab) tab = ss.getSheets()[0];
    }
    if (!tab || tab.getLastRow() < 2) return result;

    var data = tab
      .getRange(1, 1, tab.getLastRow(), tab.getLastColumn())
      .getValues();
    var hdr = data[0];

    // 열 위치 탐색 (유연한 키워드 매칭)
    var pfxCol = -1,
      codeCol = -1,
      skuCol = -1,
      nameCol = -1,
      priceCol = -1,
      vatCol = -1,
      priceVatCol = -1; // ★ G열: 부가세포함가
    for (var hi = 0; hi < hdr.length; hi++) {
      var h = String(hdr[hi] || "")
        .replace(/\s/g, "")
        .toLowerCase();

      if (
        pfxCol === -1 &&
        (h.indexOf("접두") !== -1 ||
          h === "prefix" ||
          h.indexOf("업체접두") !== -1)
      )
        pfxCol = hi;
      if (
        codeCol === -1 &&
        ((h.indexOf("팩투유") !== -1 && h.indexOf("코드") !== -1) ||
          (h.indexOf("이카운트") !== -1 && h.indexOf("코드") !== -1) ||
          h.indexOf("품목코드") !== -1 ||
          h.indexOf("상품코드") !== -1)
      )
        codeCol = hi;
      if (
        skuCol === -1 &&
        h.indexOf("업체") !== -1 &&
        (h.indexOf("코드") !== -1 || h.indexOf("상품코드") !== -1)
      )
        skuCol = hi;
      if (
        nameCol === -1 &&
        h.indexOf("업체") !== -1 &&
        (h.indexOf("품목명") !== -1 || h.indexOf("상품명") !== -1)
      )
        nameCol = hi;
      // E열: 단가(VAT제외) — "단가", "공급단가", "단가(vat제외)", "공급가" 등
      if (
        priceCol === -1 &&
        (h === "단가" ||
          h === "공급단가" ||
          h === "단가(vat제외)" ||
          h === "단가(부가세제외)" ||
          (h.indexOf("단가") !== -1 && h.indexOf("제외") !== -1) ||
          (h.indexOf("단가") !== -1 &&
            h.indexOf("포함") === -1 &&
            h.indexOf("vat") === -1))
      )
        priceCol = hi;
      // F열: 부가세
      if (
        vatCol === -1 &&
        (h === "부가세" || h === "vat" || h.indexOf("부가세") !== -1)
      )
        vatCol = hi;
      // ★ G열: 부가세포함가 — 기준값
      if (
        priceVatCol === -1 &&
        (h === "부가세포함가" ||
          h === "포함가" ||
          h === "단가(vat포함)" ||
          h.indexOf("포함가") !== -1 ||
          (h.indexOf("단가") !== -1 && h.indexOf("vat") !== -1) ||
          (h.indexOf("단가") !== -1 && h.indexOf("포함") !== -1) ||
          (h.indexOf("공급가") !== -1 && h.indexOf("vat") !== -1))
      )
        priceVatCol = hi;
    }

    // codeCol·skuCol 충돌 방지 (같은 열이면 skuCol은 다른 열에서 재탐색)
    if (codeCol !== -1 && codeCol === skuCol) {
      skuCol = -1;
      for (var hi3 = 0; hi3 < hdr.length; hi3++) {
        if (hi3 === codeCol) continue;
        var h3 = String(hdr[hi3] || "")
          .replace(/\s/g, "")
          .toLowerCase();
        if (h3.indexOf("업체") !== -1 && h3.indexOf("코드") !== -1) {
          skuCol = hi3;
          break;
        }
      }
    }

    if (codeCol === -1) return result; // lookup key 없으면 의미 없음

    for (var ri = 1; ri < data.length; ri++) {
      var row = data[ri];
      var code = String(row[codeCol] || "").trim();
      if (!code) continue;
      var pfx =
        pfxCol !== -1
          ? String(row[pfxCol] || "")
              .trim()
              .toUpperCase()
          : code.substring(0, 2).toUpperCase();
      var sku = skuCol !== -1 ? String(row[skuCol] || "").trim() : "";
      var name = nameCol !== -1 ? String(row[nameCol] || "").trim() : "";
      var price = priceCol !== -1 ? parseFloat(row[priceCol]) || 0 : 0; // E열: 단가(VAT제외)
      var vat = vatCol !== -1 ? parseFloat(row[vatCol]) || 0 : 0; // F열: 부가세
      var priceVat = priceVatCol !== -1 ? parseFloat(row[priceVatCol]) || 0 : 0; // G열: 부가세포함가 ★기준값
      var entry = {
        sku: sku,
        name: name,
        price: price,
        vat: vat,
        priceVat: priceVat,
      };
      // Push 는 접두를 대표 접두로 환산한 뒤 `JT_<코드>` 로 조회한다.
      // 운영자가 업체접두 칸에 보조 접두(NS 등)를 적어도 찾히게 두 키 다 넣는다.
      var pfxAlias = typeof _pep_resolvePrefixAlias_ === "function"
        ? _pep_resolvePrefixAlias_(pfx) : pfx;

      // ① 팩투유상품코드로 인덱싱
      result.byPfxCode[pfx + "_" + code] = entry;
      if (pfxAlias && pfxAlias !== pfx && !result.byPfxCode[pfxAlias + "_" + code]) {
        result.byPfxCode[pfxAlias + "_" + code] = entry;
      }
      if (!result.byCode[code]) result.byCode[code] = entry;
      // ② 업체상품코드(SKU)로도 역방향 인덱싱 ← 소스탭이 업체코드를 사용하는 경우 매칭
      if (sku) {
        var skuPfx = pfx || sku.substring(0, 2).toUpperCase();
        var skuPfxAlias = typeof _pep_resolvePrefixAlias_ === "function"
          ? _pep_resolvePrefixAlias_(skuPfx) : skuPfx;
        if (!result.byPfxCode[skuPfx + "_" + sku])
          result.byPfxCode[skuPfx + "_" + sku] = entry;
        if (skuPfxAlias && skuPfxAlias !== skuPfx && !result.byPfxCode[skuPfxAlias + "_" + sku])
          result.byPfxCode[skuPfxAlias + "_" + sku] = entry;
        if (!result.byCode[sku]) result.byCode[sku] = entry;
      }
    }
  } catch (e) {
    Logger.log("[_pep_loadAliasMap_] " + e.message);
  }
  return result;
}

// ─────────────────────────────────────────────────────
//  메인 함수 (silent=true: 트리거 자동 실행 시 알림창 없음)
// ─────────────────────────────────────────────────────
// ★ 2026-07-17 (H3): ScriptLock 래퍼 — 트리거(09:20/14:20)와 수동 실행이
//   동시에 돌면 같은 주문이 전용양식에 중복 Push되는 사고 방지
function partnerPushOrdersToExclusiveForms(silent) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    var lockMsg = "⚠ 대리공급 Push가 이미 실행 중입니다. 잠시 후 다시 시도하세요.";
    Logger.log("[PEP_LOCK] " + lockMsg);
    if (!silent) {
      try { SpreadsheetApp.getUi().alert(lockMsg); } catch (_) {}
    }
    return;
  }
  try {
    _pep_pushCore_(silent);
  } finally {
    try { _pep_zipCacheSave_(); } catch (_) {} // ★ M4: 우편번호 영구 캐시 저장
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _pep_pushCore_(silent) {
  var ui = null;
  if (!silent) {
    try {
      ui = SpreadsheetApp.getUi();
    } catch (e) {}
  }

  // 1) 소스 탭 확인 (외부 스프레드시트에서 로드)
  var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var srcTab = null;
  // GID 우선 탐색
  var srcSheets = srcSS.getSheets();
  for (var gsi = 0; gsi < srcSheets.length; gsi++) {
    if (srcSheets[gsi].getSheetId() === _PEP_SOURCE_TAB_GID) {
      srcTab = srcSheets[gsi];
      break;
    }
  }
  // 이름 폴백 — PropertiesService 저장값 우선, 없으면 상수
  if (!srcTab) srcTab = srcSS.getSheetByName(_pep_getSourceTabName_());
  if (!srcTab) {
    if (!silent && ui)
      ui.alert(
        "소스 탭을 찾을 수 없습니다.\n" +
          "시트: " +
          _PEP_SOURCE_SHEET_ID +
          "\n" +
          "GID: " +
          _PEP_SOURCE_TAB_GID +
          " / 이름: " +
          _PEP_SOURCE_TAB_NAME,
      );
    return;
  }
  if (srcTab.getLastRow() < 2) {
    if (!silent && ui) ui.alert("소스 탭에 데이터가 없습니다.");
    return;
  }

  // 2) 코드 변환 별칭 로드
  var aliasMap = _pep_loadAliasMap_();
  var aliasCnt = Object.keys(aliasMap.byCode).length;
  Logger.log(
    "[PEP] 별칭 맵 로드: byCode=" +
      aliasCnt +
      "건, byPfxCode=" +
      Object.keys(aliasMap.byPfxCode).length +
      "건",
  );

  // 3) 협력업체 파일 + prefix 매핑
  var files = _pt_listFiles();
  var prefixToFile = _pep_buildPrefixToFileMap_(files);

  // ★ 2026-07-06: 임시기록은 상품정보 시트에 저장 (HUB 아님!)
  var _tempSS_ = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var _tempTab_ = _pep_ensureNonPartnerTempTab_(_tempSS_);
  var _tempTabState_ = _pep_loadTempTabState_(_tempTab_);
  var _tempUidSet_ = _pep_cloneUidSet_(_tempTabState_.uidSet);
  var _tempFingerprintRows_ = _pep_cloneFingerprintRows_(
    _tempTabState_.fingerprintRows,
  );
  var _tempFpOccInRun_ = {};
  var _tempPendingRows_ = []; // ★ 성능최적화: 임시탭 배치 쓰기 버퍼
  var _dedupOccurrenceInRun_ = {}; // UID|코드 복합키 N번째 행 (전용양식 중복 판별)
  var _nowStr_ = Utilities.formatDate(
    new Date(),
    "Asia/Seoul",
    "yyyy-MM-dd HH:mm",
  );

  // 4) 소스 데이터 읽기
  var srcLr = srcTab.getLastRow();
  var srcLc = Math.max(srcTab.getLastColumn(), 20);
  var srcAll = srcTab.getRange(1, 1, srcLr, srcLc).getValues();
  var srcHdr = srcAll[0];

  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  var todaySlash = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy/MM/dd"); // HR C열용
  var cache = {}; // prefix → { ss, tab, nextSeq, pushedUids }
  var pushed = 0;
  var pushedByPfx = {}; // 업체별 Push 건수
  var skipUid = 0; // 이미 Push된 행 (협력Push 있음)
  var skipNoMap = 0; // _PEP_VENDOR_COL_OVERRIDES_ 미등록 접두
  var skipNoCode = 0; // 소스 D열(코드) 비어있는 행
  var skipNoFile = 0; // 접두→파일 매핑 없음
  var skipNoMapList = [];
  var errorLogs = [];
  var srcUidWrites = []; // 미사용

  for (var ri = 1; ri < srcAll.length; ri++) {
    var row = srcAll[ri];
    var rawCode = String(row[_PEP_CODE_COL] || "").trim();
    var rawName = String(row[_PEP_ITEM_COL] || "").trim();

    // ★ 2026-08-25: 보조 접두(JH/BF 등)는 대표 접두(JT)로 환산 후 판정
    var codePfx =
      rawCode.length >= 2 ? _pep_resolvePrefixAlias_(rawCode.substring(0, 2)) : "";
    var namePfx = "";
    // ★ 2026-07-14: 품목명 앞 영문 2글자 인식 보완 (한글/공백/대괄호 등 제외한 가장 처음에 등장하는 영문 2글자)
    var m = rawName.replace(/^[^a-zA-Z]*/, "").match(/^([a-zA-Z]{2})/);
    if (m) namePfx = _pep_resolvePrefixAlias_(m[1]);

    var pfx = "";
    // 1순위: 이카운트코드 앞 2자리(codePfx)가 유효한 대리공급업체 코드(DIRECT_MAP 또는 LABELS)인 경우
    if (codePfx && (_PEP_VENDOR_DIRECT_MAP_[codePfx] || _PEP_VENDOR_LABELS_[codePfx])) {
      pfx = codePfx;
    }
    // 2순위: 1순위 코드 제외 시 품목명 앞 영문 2글자(namePfx)가 유효한 대리공급업체 코드인 경우
    else if (namePfx && (_PEP_VENDOR_DIRECT_MAP_[namePfx] || _PEP_VENDOR_LABELS_[namePfx])) {
      pfx = namePfx;
    }

    if (!pfx) {
      skipNoCode++;
      continue;
    }

    var directMap = _PEP_VENDOR_DIRECT_MAP_[pfx] || null;

    // P열(15): 사방넷주문번호 = 고유ID
    var _hadOriginalUid_ = String(row[15] || "").trim() !== "";
    var _rowUid_ = _hadOriginalUid_ ? String(row[15] || "").trim() : "";

    if (!_rowUid_) {
      var _fpKey_ = _pep_tempFingerprintKey_(rawCode, rawName, row);
      _tempFpOccInRun_[_fpKey_] = (_tempFpOccInRun_[_fpKey_] || 0) + 1;
      var _fpOcc_ = _tempFpOccInRun_[_fpKey_];
      var _fpExisting_ = (_tempFingerprintRows_[_fpKey_] || []).length;
      if (_fpKey_ && _fpOcc_ <= _fpExisting_) {
        // 임시기록에 동일 (코드+품목명) 이미 있음 → 기존 UID 재사용 (신규 생성 금지)
        _rowUid_ = String(_tempFingerprintRows_[_fpKey_][_fpOcc_ - 1].uid || "").trim();
      }
      if (!_rowUid_) {
        _rowUid_ = _pep_deriveDeterministicUid_(row, today.replace(/-/g, ""));
        Logger.log("[PEP] R" + (ri + 1) + " 고유ID 없음 → UID 생성: " + _rowUid_);
      } else if (_fpKey_ && _fpOcc_ <= _fpExisting_) {
        Logger.log(
          "[PEP] R" +
            (ri + 1) +
            " 고유ID 없음 → 임시기록(코드+품목명) 기존 UID 재사용: " +
            _rowUid_,
        );
      }
      row[15] = _rowUid_;
    }

    // ★ 모든 발주 건 → 임시탭 기록 (협력/비협력 구분 없이, 내부에서 중복 스킵)
    var _skipTempAppend_ = false;
    if (!_hadOriginalUid_) {
      var _fpKeyT_ = _pep_tempFingerprintKey_(rawCode, rawName, row);
      var _fpOccT_ = _tempFpOccInRun_[_fpKeyT_] || 0;
      var _fpCntT_ = (_tempFingerprintRows_[_fpKeyT_] || []).length;
      // ★ 2026-07-06: <= → < 수정 (0 <= 0 = true 버그 — 빈 임시기록에서 전체 스킵됨)
      if (_fpKeyT_ && _fpOccT_ < _fpCntT_) {
        _skipTempAppend_ = true; // 코드+품목명 기준 이미 임시기록에 있음
      }
    } else {
      var _tCompositeKey_ = _rowUid_ + "|" + rawCode;
      if (_tempUidSet_[_tCompositeKey_]) _skipTempAppend_ = true;
    }
    if (!_skipTempAppend_ && _rowUid_ && _tempTab_) {
      var _tCompositeKey2_ = _rowUid_ + "|" + rawCode;
      _tempUidSet_[_tCompositeKey2_] = true;
      _tempUidSet_[_rowUid_] = true;
      var _fpKeyNew_ = _pep_tempFingerprintKey_(rawCode, rawName, row);
      if (_fpKeyNew_) {
        if (!_tempFingerprintRows_[_fpKeyNew_]) _tempFingerprintRows_[_fpKeyNew_] = [];
        _tempFingerprintRows_[_fpKeyNew_].push({
          uid: _rowUid_,
          code: rawCode,
          name: rawName,
        });
      }
      var _tRow_ = [];
      for (var _tci_ = 0; _tci_ < 22; _tci_++) {
        // V(21)은 택배사 열이다 — 소스탭 22번째 열을 그대로 실어오지 않는다.
        // 값은 송장수집이 채운다 (_PO_TEMP_CARRIER_COL_).
        if (_tci_ === 21) { _tRow_.push(""); continue; }
        _tRow_.push(_tci_ < row.length ? row[_tci_] : "");
      }
      _tempPendingRows_.push(_tRow_.concat([pfx, "", "발주완료"]));
    }

    if (!directMap) {
      skipNoMap++;
      if (skipNoMapList.indexOf(pfx) === -1) skipNoMapList.push(pfx);
      continue; // 비협력업체 → 임시탭 기록만
    }

    if (!prefixToFile[pfx]) {
      errorLogs.push("R" + (ri + 1) + " [" + pfx + "] 파일 없음");
      skipNoFile++;
      continue;
    }

    // 업체 캐시 초기화 (파일 열기 + 전용양식 탭 + AX열 기존UID 로드)
    if (!cache[pfx]) {
      var initResult = _pep_initVendorCache_(pfx, prefixToFile[pfx], directMap);
      cache[pfx] = initResult;
      if (initResult.err) {
        errorLogs.push("[" + pfx + "] " + initResult.err);
      }
    }
    if (cache[pfx].err) {
      skipNoFile++;
      continue;
    }

    // 별칭 조회 (품목코드·품목명 변환)
    var vendorSku = "",
      vendorName = "";
    try {
      var ak = pfx + "_" + rawCode;
      var ae = aliasMap.byPfxCode[ak] || aliasMap.byCode[rawCode];
      if (ae) {
        vendorSku = ae.sku || "";
        vendorName = ae.name || "";
      }
    } catch (eA) {}

    // ★ 전용양식 중복 방지: UID만으로 판별 (업체 간 일관성 보장)
    var _dedupKey_ = _pep_dedupKey_(_rowUid_, "");
    _dedupOccurrenceInRun_[_dedupKey_] =
      (_dedupOccurrenceInRun_[_dedupKey_] || 0) + 1;
    var _dedupOccurrence_ = _dedupOccurrenceInRun_[_dedupKey_];
    var _existingDedupCount_ =
      (cache[pfx].existingDedupCounts &&
        cache[pfx].existingDedupCounts[_dedupKey_]) ||
      0;
    if (_dedupOccurrence_ <= _existingDedupCount_) {
      skipUid++;
      continue; // 이미 발주된 UID → 스킵
    }

    // 출력 행 생성
    var dmCols = directMap.totalCols || 32;
    var outRow = [];
    for (var dc = 0; dc < dmCols; dc++) outRow.push("");

    // HR(뉴파츠) C열 지정 및 dateCol 지정 처리
    if (pfx === "HR") {
      outRow[2] = today; // C열: 일자
    } else if (directMap.dateCol != null) {
      outRow[directMap.dateCol] = today;
    }
    // 순번(seqCol) 입력 (공통)
    if (directMap.seqCol != null && cache[pfx].nextSeq != null) {
      outRow[directMap.seqCol] = cache[pfx].nextSeq++;
    }
    if (directMap.fixedValues) {
      for (var fk in directMap.fixedValues)
        outRow[parseInt(fk, 10)] = directMap.fixedValues[fk];
    }
    if (directMap.sourceToTarget) {
      for (var si2 = 0; si2 < directMap.sourceToTarget.length; si2++) {
        var stm = directMap.sourceToTarget[si2];
        var sv = stm.sourceCol < row.length ? row[stm.sourceCol] : "";
        if (sv != null && sv !== "") {
          // 전화번호 열이면 선행 0 복원 (숫자형 저장 버그 방지)
          if (
            directMap.phoneTargetCols &&
            _pep_isPhoneTargetCol_(stm.targetCol, directMap.phoneTargetCols)
          ) {
            sv = _pep_restoreLeadingZero_(sv);
          }
          outRow[stm.targetCol] = sv;
        }
      }
    }
    // ★ 진단: sourceToTarget 매핑 후 유효 값 검사 — 고유ID 외 빈값이면 소스 데이터 누락 경고
    var _mappedCount_ = 0;
    for (var _mc_ = 2; _mc_ < Math.min(outRow.length, dmCols); _mc_++) {
      if (String(outRow[_mc_] || "").trim()) _mappedCount_++;
    }
    if (_mappedCount_ <= 1) {
      Logger.log("[PEP] ⚠ R" + (ri + 1) + " [" + pfx + "] sourceToTarget 매핑 후 유효값=" + _mappedCount_ +
        "개 — 소스 데이터 누락 가능. rawCode=" + rawCode + " rawName=" + rawName);
    }
    // ★ 범용 별칭 적용: vendorSkuCol/vendorNameCol 미설정 업체도 자동 추론
    //   sourceToTarget에서 sourceCol===_PEP_CODE_COL(3) → 업체코드 열,
    //                      sourceCol===_PEP_ITEM_COL(4) → 업체품목명 열 자동 감지
    var effSkuCol = directMap.vendorSkuCol;
    var effNameCol = directMap.vendorNameCol;
    if (effSkuCol == null || effNameCol == null) {
      if (directMap.sourceToTarget) {
        for (var sti = 0; sti < directMap.sourceToTarget.length; sti++) {
          var stEntry = directMap.sourceToTarget[sti];
          if (effSkuCol == null && stEntry.sourceCol === _PEP_CODE_COL)
            effSkuCol = stEntry.targetCol;
          if (effNameCol == null && stEntry.sourceCol === _PEP_ITEM_COL)
            effNameCol = stEntry.targetCol;
        }
      }
    }
    // 별칭 덮어쓰기
    if (effSkuCol != null) {
      if (directMap.vendorSkuCol != null) {
        // 명시적 설정: vendorSku 없으면 rawCode 폴백 (기존 동작 유지)
        outRow[effSkuCol] = vendorSku || rawCode;
      } else if (vendorSku) {
        // 자동 추론: vendorSku 있을 때만 덮어쓰기 (없으면 sourceToTarget 값 유지)
        outRow[effSkuCol] = vendorSku;
      }
    }
    if (effNameCol != null) {
      if (directMap.vendorNameCol != null) {
        // 명시적 설정: vendorName 없으면 팩투유품목명 → rawCode 폴백 (기존 동작 유지)
        outRow[effNameCol] =
          vendorName || String(row[_PEP_ITEM_COL] || "").trim() || rawCode;
      } else if (vendorName) {
        // 자동 추론: vendorName 있을 때만 덮어쓰기 (없으면 sourceToTarget 값 유지)
        outRow[effNameCol] = vendorName;
      }
    }
    // ★ 2026-08-10: BW(부원) — 상품명(G=6)·수량(H=7) 분리 (부원택배 양식)
    if (pfx === "BW" && effNameCol != null) {
      var bwName =
        outRow[effNameCol] || String(row[_PEP_ITEM_COL] || "").trim();
      outRow[effNameCol] = bwName;
      var bwQtyCol =
        directMap.qtyExtract && directMap.qtyExtract.qtyCol != null
          ? directMap.qtyExtract.qtyCol
          : 7;
      if (!outRow[bwQtyCol] || outRow[bwQtyCol] === "") outRow[bwQtyCol] = 1;
    }

    // HR(뉴파츠): 30열 양식에서는 택배수량 열이 없으므로 별도 복사 불필요

    // A(0) 강제 비워둠 — 송장번호는 업체 직접 기입 (전 업체 공통)
    outRow[0] = ""; // 송장번호: 업체 직접 기입
    // B(1) 이슈 — ★ 2026-07-07: 적요→이슈 변경 (고유ID는 AX열에 별도 기입)
    // ★ AX열(index 49) — 원본 고유ID 그대로 (변형·접미사 없음)
    var _pepUid_ = _rowUid_;
    if (_pepUid_) {
      while (outRow.length <= 49) outRow.push(""); // AX열(index 49)까지 확장
      outRow[49] = _pepUid_; // AX열: 고유ID
    }
    // 업체별 열 오버라이드 (예: NK L열 정산단가 공란)
    var colOvr = _PEP_VENDOR_COL_OVERRIDES_[pfx];
    if (colOvr) {
      for (var oco in colOvr) outRow[parseInt(oco, 10)] = colOvr[oco];
    }

    // 전용양식 탭 기입 → ★ 배치 버퍼에 적재 (루프 종료 후 일괄 쓰기)
    try {
      // ★ 성능최적화: 캐시된 nextRow 사용 (매 행 _pep_findActualLastRow_ 호출 제거)
      var nextRow = cache[pfx].nextRow;
      if (nextRow < 2) nextRow = 2;

      // ★ 배치 교대 색상 결정 (업체별 Push 첫 행에서 한 번만 결정)
      if (cache[pfx].batchColor === null) {
        try {
          var prevColor = null;
          if (nextRow > 2) {
            prevColor = cache[pfx].tab.getRange(nextRow - 1, 1).getBackground();
          }
          // 이전 행이 흰색(#ffffff / null)이면 이번 배치는 회색, 아니면 흰색
          var prevIsWhite =
            !prevColor || prevColor === "#ffffff" || prevColor === "white";
          cache[pfx].batchColor = prevIsWhite ? "#efefef" : "#ffffff";
        } catch (eC) {
          cache[pfx].batchColor = "#ffffff";
        }
      }

      // ★ HR(뉴파츠): setValues() 전에 J~M열 단가를 outRow에 먼저 주입 (버그수정)
      // 폴백 순서: ① HUB 누적품목매핑 G열(VAT포함가) → ② 뉴파츠공급가 탭 → ③ 빈칸
      if (pfx === "HR") {
        try {
          var ak2 = pfx + "_" + rawCode;
          var ae2 = aliasMap.byPfxCode[ak2] || aliasMap.byCode[rawCode];

          var priceVat2 = 0;
          // ① 누적품목매핑 G열(priceVat) 우선
          if (ae2 && ae2.priceVat && ae2.priceVat > 0) {
            priceVat2 = ae2.priceVat;
          } else if (ae2 && ae2.price && ae2.price > 0) {
            // priceVat이 없으면 price + vat 계산
            priceVat2 =
              ae2.price + (ae2.vat > 0 ? ae2.vat : Math.round(ae2.price * 0.1));
          }

          // ② 뉴파츠공급가 탭 폴백 (업체상품코드로 조회)
          if (priceVat2 <= 0 && cache[pfx].newpartsMap) {
            var npKey = vendorSku || (ae2 ? ae2.sku : "") || "";
            if (npKey && cache[pfx].newpartsMap[npKey]) {
              priceVat2 = cache[pfx].newpartsMap[npKey];
              Logger.log(
                "[PEP] HR 뉴파츠공급가 폴백: " + npKey + "=" + priceVat2,
              );
            }
          }

          // 값이 있으면 outRow에 먼저 기입, 없으면 빈칸 (③)
          if (priceVat2 > 0) {
            var priceEx2 = Math.round(priceVat2 / 1.1);
            var vatUnit2 = priceVat2 - priceEx2;
            var qty2 = parseFloat(outRow[24]) || 0; // Y열: 수량
            var supplyAmt2 = qty2 * priceEx2;
            var vatAmt2 = qty2 * vatUnit2;
            var totalAmt2 = qty2 * priceVat2;
            outRow[25] = priceEx2; // Z열: 단가(VAT제외)
            outRow[26] = totalAmt2; // AA열: 금액1 (수량*단가VAT포함)
            outRow[28] = supplyAmt2; // AC열: 공급가액
            outRow[29] = vatAmt2; // AD열: 부가세
          }
          // ③ 없으면 빈칸 — outRow 기본값이 "" 이므로 별도 처리 불필요
        } catch (eFormula) {
          Logger.log("[PEP] HR 단가 사전주입 오류: " + eFormula.message);
        }
      }

      cache[pfx].pendingRows.push({ outRow: outRow, dmCols: dmCols });
      cache[pfx].nextRow = nextRow + 1;
      pushed++;
      pushedByPfx[pfx] = (pushedByPfx[pfx] || 0) + 1;
      if (!cache[pfx].existingDedupCounts) cache[pfx].existingDedupCounts = {};
      cache[pfx].existingDedupCounts[_dedupKey_] =
        (cache[pfx].existingDedupCounts[_dedupKey_] || 0) + 1;
    } catch (eW) {
      errorLogs.push(
        "R" + (ri + 1) + " [" + pfx + "] 쓰기 실패: " + eW.message,
      );
    }
  }

  // ═══════════════════════════════════════════════════════
  // ★ 성능최적화: 업체별 배치 일괄 쓰기 (루프 종료 후 실행)
  // 기존: 매 행마다 setValues + setNumberFormat + setBackground = 행당 3~5 API 호출
  // 개선: 업체당 1회 setValues + 1회 setBackground = 업체당 2~3 API 호출
  // ═══════════════════════════════════════════════════════
  for (var bpfx in cache) {
    if (!cache[bpfx] || cache[bpfx].err || !cache[bpfx].pendingRows || cache[bpfx].pendingRows.length === 0) continue;
    var bTab = cache[bpfx].tab;
    var bRows = cache[bpfx].pendingRows;
    var bStartRow = cache[bpfx].nextRow - bRows.length; // 첫 번째 행 위치
    if (bStartRow < 2) bStartRow = 2;

    try {
      // 모든 행의 열 수를 최대값으로 통일 (setValues 호환)
      var maxCols = 0;
      for (var bi = 0; bi < bRows.length; bi++) {
        if (bRows[bi].outRow.length > maxCols) maxCols = bRows[bi].outRow.length;
      }
      var batchData = [];
      for (var bi2 = 0; bi2 < bRows.length; bi2++) {
        var r = bRows[bi2].outRow;
        while (r.length < maxCols) r.push("");
        batchData.push(r);
      }

      // ★ 전화번호 열 텍스트 서식 일괄 적용 (배치 전체 범위)
      var bDirectMap = _PEP_VENDOR_DIRECT_MAP_[bpfx] || null;
      if (bDirectMap && bDirectMap.phoneTargetCols) {
        for (var ptci2 = 0; ptci2 < bDirectMap.phoneTargetCols.length; ptci2++) {
          var phCol2 = bDirectMap.phoneTargetCols[ptci2];
          bTab.getRange(bStartRow, phCol2 + 1, bRows.length, 1).setNumberFormat("@");
        }
      }

      // ★ 일괄 setValues (핵심 성능 개선)
      bTab.getRange(bStartRow, 1, bRows.length, maxCols).setValues(batchData);

      // ★ 배치 색상 일괄 적용
      var bDmCols = bRows[0].dmCols || maxCols;
      try {
        bTab.getRange(bStartRow, 1, bRows.length, bDmCols)
          .setBackground(cache[bpfx].batchColor || "#ffffff");
      } catch (eBg2) {}

      Logger.log("[PEP] " + bpfx + " 배치 쓰기 완료: " + bRows.length + "건 (행 " + bStartRow + "~" + (bStartRow + bRows.length - 1) + ")");
    } catch (eBatch) {
      errorLogs.push("[" + bpfx + "] 배치 쓰기 실패: " + eBatch.message);
    }
  }

  // ★ 성능최적화: 임시탭 배치 일괄 쓰기
  Logger.log("[PEP] 임시탭 대기 건수: " + _tempPendingRows_.length + " / _tempTab_: " + (!!_tempTab_));
  if (_tempPendingRows_.length > 0 && _tempTab_) {
    try {
      var tStartRow = _tempTab_.getLastRow() + 1;
      if (tStartRow < 2) tStartRow = 2;
      // 열 수 통일
      var tMaxCols = 0;
      for (var tbi = 0; tbi < _tempPendingRows_.length; tbi++) {
        if (_tempPendingRows_[tbi].length > tMaxCols) tMaxCols = _tempPendingRows_[tbi].length;
      }
      for (var tbi2 = 0; tbi2 < _tempPendingRows_.length; tbi2++) {
        while (_tempPendingRows_[tbi2].length < tMaxCols) _tempPendingRows_[tbi2].push("");
      }
      _tempTab_
        .getRange(tStartRow, 1, _tempPendingRows_.length, tMaxCols)
        .setValues(_tempPendingRows_);
      Logger.log("[PEP] 임시탭 배치 쓰기: " + _tempPendingRows_.length + "건");
    } catch (eTempBatch) {
      Logger.log("[PEP] 임시탭 배치 쓰기 실패: " + eTempBatch.message);
    }
  }

  // ★ 진단: Push 전후 소스 탭 행 수 비교 (소스 탭 초기화 여부 감지용)
  var _srcRowsAfterPush_ = srcTab.getLastRow();
  Logger.log("[PEP] 소스 탭 행 수 — Push 전: " + srcLr + " / Push 후: " + _srcRowsAfterPush_ +
    (_srcRowsAfterPush_ < srcLr ? "  ⚠ 행 감소! 소스탭이 외부에서 변경됐을 수 있음" : " (정상)"));

  // P열 역기록 제거 — 소스 시트 P열은 건드리지 않음

  SpreadsheetApp.flush();

  var totalSkip = skipUid + skipNoMap + skipNoCode + skipNoFile;
  var msg =
    "📋 대리공급업체 발주 Push 완료\n" +
    "- Push: " +
    pushed +
    "건\n" +
    "- 스킵: " +
    totalSkip +
    "건\n" +
    "    ├ 이미Push(협력Push있음): " +
    skipUid +
    "건\n" +
    "    ├ 매핑없음(_PEP_VENDOR_DIRECT_MAP_): " +
    skipNoMap +
    "건" +
    (skipNoMapList.length > 0 ? " (" + skipNoMapList.join(", ") + ")" : "") +
    "\n" +
    "    ├ 코드비어있음(D열): " +
    skipNoCode +
    "건\n" +
    "    └ 파일없음: " +
    skipNoFile +
    "건\n" +
    "\n📖 코드변환 별칭: " +
    aliasCnt +
    "건 로드" +
    (aliasCnt === 0 ? " ⚠️ 별칭이 없으면 코드/품목명 변환이 안 됩니다!" : "") +
    (errorLogs.length
      ? "\n\n⚠ 오류(최대10건):\n" + errorLogs.slice(0, 10).join("\n")
      : "");
  Logger.log(msg);
  if (Object.keys(pushedByPfx).length > 0) {
    var pfxLogLines = [];
    var pfxKeysLog = Object.keys(pushedByPfx).sort(function (a, b) {
      return (pushedByPfx[b] || 0) - (pushedByPfx[a] || 0) || a.localeCompare(b);
    });
    for (var pl = 0; pl < pfxKeysLog.length; pl++) {
      var ppk = pfxKeysLog[pl];
      pfxLogLines.push("  " + ppk + ": " + pushedByPfx[ppk] + "건");
    }
    Logger.log("[PEP] 업체별 Push\n" + pfxLogLines.join("\n"));
  }
  // ★ 2026-06-23: 단가맵 제거됨 — 트리거 예약 불필요

  // ★ Google Chat 알림
  try {
    _chat_notifyExclusivePush_(pushed, pushedByPfx, totalSkip, errorLogs);
  } catch (eChat) {}

  // ★ 2026-07-03: DB 동기화 — Push된 전용양식 → exclusive_orders
  // _tempPendingRows_ 구조: 소스탭 원본(0~21) + [22]=prefix + [23]="" + [24]="발주완료"
  // 소스탭 열: [3]=D(코드), [4]=E(품목명), [6]=G(수량), [8]=I(전화), [9]=J(주소),
  //           [10]=K(배송메시지), [12]=M(수취인), [15]=P(고유ID), [22]=prefix
  try {
    if (_tempPendingRows_.length > 0) {
      var dbPushRows = _tempPendingRows_.map(function(row) {
        var pfxName = String(row[22] || "").trim(); // prefix = 업체접두
        // prefix → 업체명 변환 시도
        var vName = pfxName;
        try {
          if (prefixToFile[pfxName]) vName = prefixToFile[pfxName].name.replace("[협력업체] ", "");
        } catch(e) {}
        return {
          vendor_name: vName || pfxName,
          unique_id: String(row[15] || "").trim() || null,   // P열(고유ID)
          ecount_code: String(row[3] || "").trim(),          // D열(코드)
          item_name: String(row[4] || "").trim(),            // E열(품목명)
          qty: parseInt(row[6]) || 1,                        // G열(수량)
          recipient: String(row[12] || "").trim(),           // M열(수취인)
          phone: String(row[8] || "").trim(),                // I열(전화)
          address: String(row[9] || "").trim(),              // J열(주소)
          delivery_msg: String(row[10] || "").trim(),        // K열(배송메시지)
          unit_price: parseFloat(row[11]) || 0,              // L열(단가)
          settle_amount: (parseFloat(row[11]) || 0) * (parseInt(row[6]) || 1),
          note: String(row[16] || "").trim(),                // Q열(보내는분)
          source: "push"
        };
      });
      _sb_syncExclusiveOrders_(dbPushRows);
    }
  } catch (eDb) { Logger.log("[SB] 전용양식 DB 동기화 오류: " + eDb.message); }


  if (ui) {
    try {
      var htmlOut = HtmlService.createHtmlOutput(
        _pep_buildPushSummaryHtml_({
          pushed: pushed,
          pushedByPfx: pushedByPfx,
          tempNew: _tempPendingRows_.length,
          skipUid: skipUid,
          skipNoMap: skipNoMap,
          skipNoCode: skipNoCode,
          skipNoFile: skipNoFile,
          skipNoMapList: skipNoMapList,
          aliasCnt: aliasCnt,
          errorLogs: errorLogs,
        }),
      )
        .setWidth(780)
        .setHeight(680);
      ui.showModalDialog(htmlOut, "📋 대리발송 Push 결과");
    } catch (eHtml) {
      ui.alert(msg);
    }
  }
}

// ═══════════════════════════════════════════════════════
//  ★ 임시기록 → 전용양식 Push (수동 추가 건 대응)
//  임시기록 탭의 데이터를 소스로 사용하여 전용양식에 Push
//  - 소스 탭 대신 임시기록(대리공급_임시기록) 탭을 읽음
//  - W열(22)에 저장된 prefix 사용 (JT / 준테크 등 — 대리공급 미분류 건 수동 지정)
//  - P열(15)에 저장된 UID 사용
//  - 전용양식 AX열 dedup으로 중복 방지
// ═══════════════════════════════════════════════════════

/**
 * 임시기록 W열(업체prefix) → 등록된 접두 정규화
 * 예: "JT", "jt", "준테크", "[협력업체] 준테크" → "JT"
 * 보조 접두도 대표 접두로 환산: "JH", "BF", "NS" → "JT"
 */
function _pep_normalizeTempVendorPrefix_(wVal) {
  var raw = String(wVal == null ? "" : wVal).trim();
  if (!raw) return "";
  var compact = raw.replace(/\s/g, "").replace(/\[협력업체\]/g, "");
  var upper = compact.toUpperCase();

  // ★ 2026-08-25: 보조 접두 우선 환산 (JH/BF → JT)
  var aliased = _pep_resolvePrefixAlias_(upper);
  if (
    aliased !== upper &&
    typeof _PEP_VENDOR_DIRECT_MAP_ !== "undefined" &&
    _PEP_VENDOR_DIRECT_MAP_[aliased]
  ) {
    return aliased;
  }

  if (
    typeof _PEP_VENDOR_DIRECT_MAP_ !== "undefined" &&
    _PEP_VENDOR_DIRECT_MAP_[upper]
  ) {
    return upper;
  }
  if (upper.length >= 2) {
    var two = _pep_resolvePrefixAlias_(upper.substring(0, 2));
    if (
      typeof _PEP_VENDOR_DIRECT_MAP_ !== "undefined" &&
      _PEP_VENDOR_DIRECT_MAP_[two]
    ) {
      return two;
    }
  }

  var labels =
    typeof _PEP_VENDOR_LABELS_ !== "undefined" ? _PEP_VENDOR_LABELS_ : {};
  for (var pfx in labels) {
    var lab = String(labels[pfx] || "").replace(/\s/g, "");
    if (!lab) continue;
    if (compact.indexOf(lab) !== -1 || upper.indexOf(lab.toUpperCase()) !== -1) {
      return pfx;
    }
  }
  return upper.length >= 2 ? _pep_resolvePrefixAlias_(upper.substring(0, 2)) : upper;
}

/** 상품정보 시트의 대리공급_임시기록 탭 */
function _pep_getTempRecordTab_() {
  var ss = null;
  try {
    if (typeof _PT !== "undefined" && _PT.INFO_SS_ID) {
      ss = SpreadsheetApp.openById(_PT.INFO_SS_ID);
    }
  } catch (eOpen) {}
  if (!ss) {
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (eAct) {}
  }
  if (!ss) return null;
  var tab = ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
  if (!tab) tab = ss.getSheetByName("대리발송_임시기록");
  return tab;
}

function partnerPushFromTempTabToExclusive() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  // 1) 임시기록 탭 확인 (상품정보 시트 기준)
  var tempTab = _pep_getTempRecordTab_();
  if (!tempTab || tempTab.getLastRow() < 2) {
    if (ui) {
      ui.alert(
        "임시기록 탭에 데이터가 없습니다.\n\n" +
          "상품정보 시트의 「대리공급_임시기록」 하단에 주문 행을 추가하고\n" +
          "W열(업체prefix)에 JT(또는 준테크)를 넣은 뒤 다시 실행하세요."
      );
    }
    return;
  }

  // 2) 확인 프롬프트
  if (ui) {
    var confirm = ui.alert(
      "📋 임시기록 → 전용양식 Push",
      "임시기록 탭의 데이터를 전용양식에 Push합니다.\n\n" +
        "· W열(업체prefix)에 JT / 준테크 등을 넣으면 해당 업체 전용양식으로 갑니다.\n" +
        "  (대리공급 미분류·재고없음 → 준테크 대리발송 수동 지정용)\n" +
        "· 이미 Push된 건(AX열 UID 중복·Y열 Push완료)은 스킵됩니다.\n\n계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (confirm !== ui.Button.YES) return;
  }

  // 3) 코드 변환 별칭 로드
  var aliasMap = _pep_loadAliasMap_();

  // 4) 협력업체 파일 + prefix 매핑
  var files = _pt_listFiles();
  var prefixToFile = _pep_buildPrefixToFileMap_(files);

  // 5) 임시기록 데이터 읽기
  var srcLr = tempTab.getLastRow();
  var srcLc = Math.max(tempTab.getLastColumn(), 26);
  var srcAll = tempTab.getRange(1, 1, srcLr, srcLc).getValues();

  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  var cache = {};
  var pushed = 0;
  var pushedByPfx = {};
  var skipUid = 0;
  var skipNoMap = 0;
  var skipNoCode = 0;
  var skipNoFile = 0;
  var skipDone = 0;
  var errorLogs = [];
  var _dedupOccurrenceInRun_ = {};
  var pushedSrcRows = []; // Push 성공한 임시기록 행 번호 (1-indexed)
  var uidWriteBack = []; // 생성한 UID → P열 기록

  // 팩투유 기본 보내는분 (수동 행에 Q/R/S 비어있을 때)
  var _DEFAULT_SENDER_NAME_ = "팩투유";
  var _DEFAULT_SENDER_PHONE_ = "031-923-7795";
  var _DEFAULT_SENDER_ADDR_ = "경기 평택시 포승읍 석정리 369";

  for (var ri = 1; ri < srcAll.length; ri++) {
    var row = srcAll[ri];
    var rawCode = String(row[_PEP_CODE_COL] || "").trim(); // D열(3)
    var rawName = String(row[_PEP_ITEM_COL] || "").trim(); // E열(4)
    if (!rawCode && !rawName) continue; // 빈 행 스킵

    // ★ 이미 전용양식 Push 완료 건 스킵 (하단 신규 수동 행만 처리)
    var yStatus = String(row[24] || "").replace(/\s/g, "");
    if (
      yStatus.indexOf("전용양식Push완료") !== -1 ||
      yStatus.indexOf("Push완료") !== -1
    ) {
      skipDone++;
      continue;
    }

    // prefix: W열(22) 우선 — JT/준테크 등 수동 지정
    var pfx = _pep_normalizeTempVendorPrefix_(row[22]);
    if (!pfx) {
      // ★ 2026-08-25: 보조 접두(JH/BF 등)는 대표 접두(JT)로 환산 후 판정
      var codePfx = rawCode.length >= 2 ? _pep_resolvePrefixAlias_(rawCode.substring(0, 2)) : "";
      var namePfx = "";
      var m = rawName.replace(/^[^a-zA-Z]*/, "").match(/^([a-zA-Z]{2})/);
      if (m) namePfx = _pep_resolvePrefixAlias_(m[1]);
      if (codePfx && _PEP_VENDOR_DIRECT_MAP_[codePfx]) pfx = codePfx;
      else if (namePfx && _PEP_VENDOR_DIRECT_MAP_[namePfx]) pfx = namePfx;
      else if (codePfx) pfx = codePfx;
      else if (namePfx) pfx = namePfx;
    }
    if (!pfx) { skipNoCode++; continue; }

    var directMap = _PEP_VENDOR_DIRECT_MAP_[pfx] || null;
    if (!directMap) { skipNoMap++; continue; }
    if (!prefixToFile[pfx]) { skipNoFile++; continue; }

    // W열에 정규화된 접두 되쓰기 (준테크 → JT)
    if (String(row[22] || "").trim().toUpperCase() !== pfx) {
      try {
        tempTab.getRange(ri + 1, 23).setValue(pfx); // W열 1-based=23
      } catch (eWset) {}
      row[22] = pfx;
    }

    // UID: P열(15)
    var _rowUid_ = String(row[15] || "").trim();
    if (!_rowUid_) {
      _rowUid_ = _pep_deriveDeterministicUid_(row, today.replace(/-/g, ""));
      Logger.log("[PEP-TEMP] R" + (ri + 1) + " UID 생성: " + _rowUid_);
      uidWriteBack.push({ row: ri + 1, uid: _rowUid_ });
      row[15] = _rowUid_;
    }

    // 캐시 초기화 (업체별 1회)
    if (!cache[pfx]) {
      cache[pfx] = _pep_initVendorCache_(pfx, prefixToFile[pfx], directMap);
      if (cache[pfx].err) {
        errorLogs.push("[" + pfx + "] " + cache[pfx].err);
        continue;
      }
    }
    if (cache[pfx].err) continue;

    // 별칭 적용
    var vendorSku = "", vendorName = "";
    try {
      var ak = pfx + "_" + rawCode;
      var ae = aliasMap.byPfxCode[ak] || aliasMap.byCode[rawCode];
      if (ae) {
        vendorSku = ae.sku || "";
        vendorName = ae.name || "";
      }
    } catch (eA) {}

    // dedup 체크 — UID만으로 판별 (메인 Push와 동일)
    var _dedupKey_ = _pep_dedupKey_(_rowUid_, "");
    _dedupOccurrenceInRun_[_dedupKey_] = (_dedupOccurrenceInRun_[_dedupKey_] || 0) + 1;
    var _dedupOccurrence_ = _dedupOccurrenceInRun_[_dedupKey_];
    var _existingDedupCount_ =
      (cache[pfx].existingDedupCounts && cache[pfx].existingDedupCounts[_dedupKey_]) || 0;
    if (_dedupOccurrence_ <= _existingDedupCount_) {
      skipUid++;
      continue;
    }

    // 출력 행 생성 (기존 Push 로직 재사용)
    var dmCols = directMap.totalCols || 32;
    var outRow = [];
    for (var dc = 0; dc < dmCols; dc++) outRow.push("");

    if (pfx === "HR") {
      outRow[2] = today;
    } else if (directMap.dateCol != null) {
      outRow[directMap.dateCol] = today;
    }
    if (directMap.seqCol != null && cache[pfx].nextSeq != null) {
      outRow[directMap.seqCol] = cache[pfx].nextSeq++;
    }
    if (directMap.fixedValues) {
      for (var fk in directMap.fixedValues) outRow[parseInt(fk, 10)] = directMap.fixedValues[fk];
    }
    if (directMap.sourceToTarget) {
      for (var si2 = 0; si2 < directMap.sourceToTarget.length; si2++) {
        var stm = directMap.sourceToTarget[si2];
        var sv = stm.sourceCol < row.length ? row[stm.sourceCol] : "";
        if (sv != null && sv !== "") {
          if (directMap.phoneTargetCols &&
              _pep_isPhoneTargetCol_(stm.targetCol, directMap.phoneTargetCols)) {
            sv = _pep_restoreLeadingZero_(sv);
          }
          outRow[stm.targetCol] = sv;
        }
      }
    }

    // ★ 보내는분 Q/R/S 비어 있으면 팩투유 기본값 (수동 하단 추가 건)
    if (!String(row[16] || "").trim() || !String(outRow[4] || "").trim()) {
      // JT 대한통운: E(4)=보내는분성명 / 그 외 AP형: 보내는사람 열은 매핑에 따름
      for (var si3 = 0; si3 < (directMap.sourceToTarget || []).length; si3++) {
        var stm3 = directMap.sourceToTarget[si3];
        if (stm3.sourceCol === 16 && !String(outRow[stm3.targetCol] || "").trim()) {
          outRow[stm3.targetCol] = _DEFAULT_SENDER_NAME_;
        }
        if (stm3.sourceCol === 17 && !String(outRow[stm3.targetCol] || "").trim()) {
          outRow[stm3.targetCol] = _DEFAULT_SENDER_PHONE_;
        }
        if (stm3.sourceCol === 18 && !String(outRow[stm3.targetCol] || "").trim()) {
          outRow[stm3.targetCol] = _DEFAULT_SENDER_ADDR_;
        }
      }
    }

    // 별칭 덮어쓰기 (기존 로직 재사용)
    var effSkuCol = directMap.vendorSkuCol;
    var effNameCol = directMap.vendorNameCol;
    if (effSkuCol == null || effNameCol == null) {
      if (directMap.sourceToTarget) {
        for (var sti = 0; sti < directMap.sourceToTarget.length; sti++) {
          var stEntry = directMap.sourceToTarget[sti];
          if (effSkuCol == null && stEntry.sourceCol === _PEP_CODE_COL) effSkuCol = stEntry.targetCol;
          if (effNameCol == null && stEntry.sourceCol === _PEP_ITEM_COL) effNameCol = stEntry.targetCol;
        }
      }
    }
    if (effSkuCol != null) {
      if (directMap.vendorSkuCol != null) outRow[effSkuCol] = vendorSku || rawCode;
      else if (vendorSku) outRow[effSkuCol] = vendorSku;
    }
    if (effNameCol != null) {
      if (directMap.vendorNameCol != null) {
        outRow[effNameCol] = vendorName || String(row[_PEP_ITEM_COL] || "").trim() || rawCode;
      } else if (vendorName) outRow[effNameCol] = vendorName;
    }

    // ★ 2026-08-10: BW(부원) — 상품명(G=6)·수량(H=7) 분리
    if (pfx === "BW" && effNameCol != null) {
      var bwName = outRow[effNameCol] || String(row[_PEP_ITEM_COL] || "").trim();
      outRow[effNameCol] = bwName;
      var bwQtyCol =
        directMap.qtyExtract && directMap.qtyExtract.qtyCol != null
          ? directMap.qtyExtract.qtyCol
          : 7;
      if (!outRow[bwQtyCol] || outRow[bwQtyCol] === "") outRow[bwQtyCol] = 1;
    }

    // ★ HR(뉴파츠) 전용: 단가 주입 (J~M열)
    if (pfx === "HR") {
      try {
        var ak2 = pfx + "_" + rawCode;
        var ae2 = aliasMap.byPfxCode[ak2] || aliasMap.byCode[rawCode];
        var priceVat2 = 0;
        if (ae2 && ae2.priceVat && ae2.priceVat > 0) {
          priceVat2 = ae2.priceVat;
        } else if (ae2 && ae2.price && ae2.price > 0) {
          priceVat2 = ae2.price + (ae2.vat > 0 ? ae2.vat : Math.round(ae2.price * 0.1));
        }
        if (priceVat2 <= 0 && cache[pfx].newpartsMap && cache[pfx].newpartsMap[rawCode]) {
          priceVat2 = cache[pfx].newpartsMap[rawCode];
        }
        if (priceVat2 > 0) {
          var qty2 = parseInt(row[6], 10) || 1;
          var vatAmt2 = Math.round(priceVat2 / 11);
          var priceEx2 = priceVat2 - vatAmt2;
          var supplyAmt2 = priceEx2 * qty2;
          var totalAmt2 = qty2 * priceVat2;
          outRow[25] = priceEx2;
          outRow[26] = totalAmt2;
          outRow[28] = supplyAmt2;
          outRow[29] = vatAmt2;
        }
      } catch (eHrPrice) {}
    }

    // ★ JM(제이엠) 전용: 택배비 주입 (P열) + AW열 이카운트코드
    if (pfx === "JM") {
      try {
        // AW열(인덱스 48)에 이카운트코드 기입
        while (outRow.length < 49) outRow.push("");
        outRow[48] = rawCode; // 소스 D열의 이카운트코드

        // 공급가 탭에서 택배비 조회 → P열(15)에 주입
        if (cache["JM"] && cache["JM"].jmShippingMap && cache["JM"].jmShippingMap[rawCode]) {
          outRow[15] = cache["JM"].jmShippingMap[rawCode];
          Logger.log("[PEP] JM 택배비 주입: " + rawCode + " = " + outRow[15]);
        }

        // ★ 품목명(H열, 인덱스 7)에서 "---" 이후 제거 (예: "상품명---/배민" → "상품명")
        if (outRow[7]) {
          var dashIdx = String(outRow[7]).indexOf("---");
          if (dashIdx !== -1) {
            outRow[7] = String(outRow[7]).substring(0, dashIdx).trim();
          }
        }

        // ★ 우편번호(L열, 인덱스 11) 자동 기입 — 카카오 로컬 API
        var addrForZip = String(outRow[5] || "").trim(); // F열=주소
        if (addrForZip && !outRow[11]) {
          try {
            // 세션 캐시 활용 (동일 주소 중복 호출 방지)
            // ★ 2026-07-17 (M4): 미스 시 영구 캐시(Properties) 경유
            if (!cache["JM"]._zipCache) cache["JM"]._zipCache = {};
            var zipCode = cache["JM"]._zipCache[addrForZip];
            if (zipCode === undefined) {
              zipCode = _pep_getZipCodeCached_(addrForZip);
              cache["JM"]._zipCache[addrForZip] = zipCode || "";
            }
            if (zipCode) {
              // ★ 2026-06-30: 우편번호 앞 0 보존 (문자열 5자리 패딩)
              outRow[11] = String(zipCode).length < 5 ? ("00000" + zipCode).slice(-5) : String(zipCode);
              Logger.log("[PEP] JM 우편번호: " + addrForZip.substring(0, 20) + "... = " + outRow[11]);
            }
          } catch (eZip) {
            Logger.log("[PEP] JM 우편번호 조회 오류: " + eZip.message);
          }
        }
      } catch (eJmShip) {
        Logger.log("[PEP] JM 택배비 주입 오류: " + eJmShip.message);
      }
    }

    // AX열 UID 기입
    outRow[0] = "";
    var _pepUid_ = _rowUid_;
    if (_pepUid_) {
      while (outRow.length <= 49) outRow.push("");
      outRow[49] = _pepUid_;
    }

    // 업체별 열 오버라이드
    var colOvr = _PEP_VENDOR_COL_OVERRIDES_[pfx];
    if (colOvr) {
      for (var oco in colOvr) outRow[parseInt(oco, 10)] = colOvr[oco];
    }

    // 배치 버퍼에 적재
    try {
      var nextRow = cache[pfx].nextRow;
      if (nextRow < 2) nextRow = 2;
      if (cache[pfx].batchColor === null) {
        try {
          var prevColor = nextRow > 2 ? cache[pfx].tab.getRange(nextRow - 1, 1).getBackground() : null;
          var prevIsWhite = !prevColor || prevColor === "#ffffff" || prevColor === "white";
          cache[pfx].batchColor = prevIsWhite ? "#efefef" : "#ffffff";
        } catch (eC) { cache[pfx].batchColor = "#ffffff"; }
      }
      cache[pfx].pendingRows.push({ outRow: outRow, dmCols: dmCols });
      cache[pfx].nextRow = nextRow + 1;
      pushed++;
      pushedByPfx[pfx] = (pushedByPfx[pfx] || 0) + 1;
      pushedSrcRows.push(ri + 1); // 임시기록 행 번호 기록 (1-indexed)
      if (!cache[pfx].existingDedupCounts) cache[pfx].existingDedupCounts = {};
      cache[pfx].existingDedupCounts[_dedupKey_] =
        (cache[pfx].existingDedupCounts[_dedupKey_] || 0) + 1;
    } catch (eW) {
      errorLogs.push("R" + (ri + 1) + " [" + pfx + "] 쓰기 실패: " + eW.message);
    }
  }

  // 배치 일괄 쓰기 (기존 로직 재사용)
  for (var bpfx in cache) {
    if (!cache[bpfx] || cache[bpfx].err || !cache[bpfx].pendingRows || cache[bpfx].pendingRows.length === 0) continue;
    var bTab = cache[bpfx].tab;
    var bRows = cache[bpfx].pendingRows;
    var bStartRow = cache[bpfx].nextRow - bRows.length;
    if (bStartRow < 2) bStartRow = 2;
    try {
      var maxCols = 0;
      for (var bi = 0; bi < bRows.length; bi++) {
        if (bRows[bi].outRow.length > maxCols) maxCols = bRows[bi].outRow.length;
      }
      var batchData = [];
      for (var bi2 = 0; bi2 < bRows.length; bi2++) {
        var r = bRows[bi2].outRow;
        while (r.length < maxCols) r.push("");
        batchData.push(r);
      }
      var bDirectMap = _PEP_VENDOR_DIRECT_MAP_[bpfx] || null;
      if (bDirectMap && bDirectMap.phoneTargetCols) {
        for (var ptci2 = 0; ptci2 < bDirectMap.phoneTargetCols.length; ptci2++) {
          var phCol2 = bDirectMap.phoneTargetCols[ptci2];
          bTab.getRange(bStartRow, phCol2 + 1, bRows.length, 1).setNumberFormat("@");
        }
      }
      // ★ 2026-06-30: JM 우편번호(L열=12) 텍스트 형식 — 앞 0 보존
      if (bpfx === "JM") {
        bTab.getRange(bStartRow, 12, bRows.length, 1).setNumberFormat("@");
      }
      bTab.getRange(bStartRow, 1, bRows.length, maxCols).setValues(batchData);
      var bDmCols = bRows[0].dmCols || maxCols;
      try {
        bTab.getRange(bStartRow, 1, bRows.length, bDmCols)
          .setBackground(cache[bpfx].batchColor || "#ffffff");
      } catch (eBg2) {}
      Logger.log("[PEP-TEMP] " + bpfx + " 배치 쓰기 완료: " + bRows.length + "건");
    } catch (eBatch) {
      errorLogs.push("[" + bpfx + "] 배치 쓰기 실패: " + eBatch.message);
    }
  }

  // ★ 생성한 UID → 임시기록 P열 기록 (재Push 시 dedup)
  if (uidWriteBack.length > 0 && tempTab) {
    try {
      for (var uwi = 0; uwi < uidWriteBack.length; uwi++) {
        tempTab.getRange(uidWriteBack[uwi].row, 16).setValue(uidWriteBack[uwi].uid); // P열
      }
    } catch (eUidWb) {
      Logger.log("[PEP-TEMP] UID 되쓰기 실패: " + eUidWb.message);
    }
  }

  // ★ Push 성공 건의 임시기록 Y열(진행상태) 갱신
  if (pushedSrcRows.length > 0 && tempTab) {
    try {
      var yCol = 25; // Y열 = 25번째 (1-indexed)
      for (var pri = 0; pri < pushedSrcRows.length; pri++) {
        tempTab.getRange(pushedSrcRows[pri], yCol).setValue("전용양식Push완료");
      }
      Logger.log("[PEP-TEMP] 임시기록 Y열 갱신: " + pushedSrcRows.length + "건");
    } catch (eYcol) {
      Logger.log("[PEP-TEMP] Y열 갱신 실패: " + eYcol.message);
    }
  }

  // 결과 표시 (HTML 팝업)
  var pfxList = Object.keys(pushedByPfx).sort(function(a,b){ return (pushedByPfx[b]||0)-(pushedByPfx[a]||0); });
  var pfxDetail = pfxList.map(function(k) { return k + ": " + pushedByPfx[k] + "건"; }).join(", ");
  var totalSkip = skipUid + skipNoMap + skipNoCode + skipNoFile + skipDone;
  Logger.log("[PEP-TEMP] Push=" + pushed + " Skip=" + totalSkip + " (" + pfxDetail + ")");

  // ★ Google Chat 알림
  try { _chat_notifyTempPush_(pushed, pushedByPfx, totalSkip); } catch (eChat) {}

  // ★ 로젠_임시기록 자동 기록 (대리공급 Push 시 연동)
  var lozenResult = null;
  try {
    lozenResult = _pep_recordLozenToTemp_();
  } catch (eLozen) {
    Logger.log("[LOZEN_TEMP_AUTO] " + String(eLozen.message || eLozen));
  }

  // ★ 2026-06-26: Push에서 스냅샷 생성하지 않음
  // 일일마감(05:00) 실행 시 판매현황을 직접 읽어서 스냅샷에 추가함

  if (ui) {
    try {
      var html = '<div style="font-family:\'Segoe UI\',sans-serif;padding:16px;">';
      html += '<h2 style="margin:0 0 12px;color:#1a73e8;">📋 임시기록 → 전용양식 Push</h2>';
      // Push 건수
      html += '<div style="background:#e8f5e9;border-radius:8px;padding:12px;margin-bottom:10px;">';
      html += '<span style="font-size:28px;font-weight:bold;color:#2e7d32;">' + pushed + '</span>';
      html += '<span style="color:#555;margin-left:8px;">건 Push 완료</span></div>';
      // 업체별
      if (pfxList.length > 0) {
        html += '<table style="width:100%;border-collapse:collapse;margin-bottom:10px;">';
        html += '<tr style="background:#1f4e78;color:#fff;"><th style="padding:6px 10px;text-align:left;">업체</th><th style="padding:6px 10px;text-align:right;">건수</th></tr>';
        for (var pi = 0; pi < pfxList.length; pi++) {
          var bg = pi % 2 === 0 ? '#f5f5f5' : '#ffffff';
          html += '<tr style="background:' + bg + ';"><td style="padding:5px 10px;">' + pfxList[pi] + '</td>';
          html += '<td style="padding:5px 10px;text-align:right;font-weight:bold;">' + pushedByPfx[pfxList[pi]] + '</td></tr>';
        }
        html += '</table>';
      }
      // 스킵
      if (totalSkip > 0) {
        html += '<div style="background:#fff3e0;border-radius:8px;padding:10px;margin-bottom:10px;">';
        html += '<b>⏭ 스킵: ' + totalSkip + '건</b><br>';
        if (skipUid > 0) html += '&nbsp;&nbsp;├ 중복(이미Push): ' + skipUid + '건<br>';
        if (skipDone > 0) html += '&nbsp;&nbsp;├ 이미완료(Y열): ' + skipDone + '건<br>';
        if (skipNoMap > 0) html += '&nbsp;&nbsp;├ 미등록업체: ' + skipNoMap + '건<br>';
        if (skipNoCode > 0) html += '&nbsp;&nbsp;├ 코드/접두없음: ' + skipNoCode + '건<br>';
        if (skipNoFile > 0) html += '&nbsp;&nbsp;└ 파일없음: ' + skipNoFile + '건<br>';
        html += '</div>';
      }
      // 오류
      if (errorLogs.length > 0) {
        html += '<div style="background:#ffebee;border-radius:8px;padding:10px;">';
        html += '<b>❌ 오류 (' + errorLogs.length + '건)</b><br>';
        for (var ei = 0; ei < Math.min(errorLogs.length, 10); ei++) {
          html += '<span style="font-size:12px;color:#c62828;">' + errorLogs[ei] + '</span><br>';
        }
        html += '</div>';
      }
      // 로젠_임시기록 결과
      if (lozenResult) {
        html += '<div style="background:#e8eaf6;border-radius:8px;padding:10px;margin-top:10px;">';
        html += '<b>📦 로젠 임시기록</b><br>';
        if (lozenResult.error) {
          html += '<span style="color:#c62828;">⚠ ' + lozenResult.error + '</span>';
        } else {
          html += '신규: <b>' + lozenResult.recorded + '</b>건 / 스킵: ' + lozenResult.skipped + '건';
        }
        html += '</div>';
      }
      html += '</div>';
      var htmlOut = HtmlService.createHtmlOutput(html).setWidth(500).setHeight(420);
      ui.showModalDialog(htmlOut, "📋 임시기록 Push 결과");
    } catch (eHtml) {
      var msg = "Push: " + pushed + "건, 스킵: " + totalSkip + "건" +
        (errorLogs.length > 0 ? "\n오류:\n" + errorLogs.join("\n") : "");
      ui.alert("임시기록 Push 결과", msg, ui.ButtonSet.OK);
    }
  }
}

// ★★ 비협력업체 임시탭 헬퍼 함수 ★★
// 탭 이름
var _PEP_NON_PARTNER_TEMP_TAB_NAME_ = "대리공급_임시기록";
// ★ 소스탭(대리발송) 원본 열 구조 그대로 + 끝에 2열 추가
// P열(15) = 사방넷주문번호 = 고유ID (UID 매칭 기준)
// W열(22) = 업체prefix (append)
// X열(23) = 송장번호 (수집 시 기록)
var _PEP_NON_PARTNER_TEMP_HEADERS_ = [
  "상태", // A(0)
  "순번", // B(1)
  "일자-No.", // C(2)
  "품목코드", // D(3)
  "품목명", // E(4)
  "택배박스", // F(5)
  "수량", // G(6)
  "전화", // H(7)
  "모바일", // I(8)
  "주소1", // J(9)
  "배송메시지", // K(10)
  "합계", // L(11)
  "거래처명", // M(12)
  "단품배송비", // N(13)
  "적요", // O(14)
  "사방넷주문번호", // P(15) ★ 고유ID
  "보내는분", // Q(16)
  "보내는분전화", // R(17)
  "보내는주소", // S(18)
  "", // T(19)
  "", // U(20)
  "택배사", // V(21) ← ★ 2026-08-31 송장수집이 기입 (_PO_TEMP_CARRIER_COL_)
  "업체prefix", // W(22) ← append
  "송장번호", // X(23) ← 수집 시 기록
  "진행상태", // Y(24) ← 발주완료 또는 송장수집 기입
  "이슈", // Z(25) ← ★ 2026-07-07: 전용양식 B열 이슈 내용
];

// 임시탭 없으면 생성, 헤더 불일치 시 보정
function _pep_ensureNonPartnerTempTab_(ss) {
  var tab = ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
  if (!tab) {
    tab = ss.insertSheet(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
    tab
      .getRange(1, 1, 1, _PEP_NON_PARTNER_TEMP_HEADERS_.length)
      .setValues([_PEP_NON_PARTNER_TEMP_HEADERS_]);
    tab
      .getRange("1:1")
      .setBackground("#37474f")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    tab.setFrozenRows(1);
    tab.setColumnWidth(1, 160);
    tab.setColumnWidth(7, 130);
    tab.setColumnWidth(8, 220);
  } else {
    // 열 개수 강제 보정 및 헤더 갱신 (Y열 대응)
    var maxC = tab.getMaxColumns();
    if (maxC < _PEP_NON_PARTNER_TEMP_HEADERS_.length) {
      tab.insertColumnsAfter(maxC, _PEP_NON_PARTNER_TEMP_HEADERS_.length - maxC);
    }
    tab.getRange(1, 1, 1, _PEP_NON_PARTNER_TEMP_HEADERS_.length).setValues([_PEP_NON_PARTNER_TEMP_HEADERS_]);
    tab.getRange("1:1")
      .setBackground("#37474f")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
  }
  return tab;
}

// 임시탭 P열(15)+D열(3) 복합키 로드 (레거시 호출용)
function _pep_loadTempTabUids_(tab) {
  return _pep_loadTempTabState_(tab).uidSet;
}

// 임시탭에 행 추가 (UID|품목코드 또는 코드+품목명 지문)
function _pep_appendToNonPartnerTempTab_(row, pfx, tab, uidSet, nowStr) {
  var uid = String(row[15] || "").trim();
  var code = String(row[3] || "").trim();
  var name = String(row[_PEP_ITEM_COL] || "").trim();
  if (!tab) return;
  var fp = _pep_tempFingerprintKey_(code, name, row);
  if (uid && code) {
    var compositeKey = uid + "|" + code;
    if (uidSet[compositeKey]) return;
    uidSet[compositeKey] = true;
    uidSet[uid] = true;
  } else if (fp && uidSet["fp:" + fp]) {
    return;
  }
  if (fp) uidSet["fp:" + fp] = true;
  var srcRow = [];
  // 22번째 열(index 21)까지 데이터 복사, 모자라면 빈칸으로 채우기
  for (var ci = 0; ci < 22; ci++) {
    srcRow.push(ci < row.length ? row[ci] : "");
  }
  var newRow = srcRow.concat([pfx, "", "발주완료"]); // 소스행 + 업체prefix(W) + 송장번호빈칸(X) + 진행상태(Y)
  var nextRow = tab.getLastRow() + 1;
  if (nextRow < 2) nextRow = 2;
  tab.getRange(nextRow, 1, 1, newRow.length).setValues([newRow]);
}

// ─────────────────────────────────────────────────────
//  별칭(코드 변환) 로딩 진단 (AS 메뉴)
// ─────────────────────────────────────────────────────
function partnerDiagnoseAliasMap() {
  var ui = SpreadsheetApp.getUi();
  try {
    var aliasMap = _pep_loadAliasMap_();
    var byCodeKeys = Object.keys(aliasMap.byCode);
    var cnt = byCodeKeys.length;
    var sample = [];
    for (var i = 0; i < Math.min(cnt, 10); i++) {
      var k = byCodeKeys[i];
      var e = aliasMap.byCode[k];
      sample.push(
        k +
          " \u2192 업체코드=" +
          (e.sku || "(없음)") +
          ", 업체명=" +
          (e.name || "(없음)"),
      );
    }
    var msg =
      "\ud83d\udcd6 코드 변환 별칭 진단\n" +
      "시트 ID: " +
      _PEP_ALIAS_SHEET_ID +
      "\n" +
      "GID: " +
      _PEP_ALIAS_TAB_GID +
      "\n\n" +
      "로드된 별칭: " +
      cnt +
      "건\n" +
      (cnt > 0
        ? "\n샘플(최대10건):\n" + sample.join("\n")
        : "\n\u26a0\ufe0f 별칭 데이터가 없습니다!");
    ui.alert(msg);
  } catch (e) {
    ui.alert("\u274c 별칭 로드 실패: " + e.message);
  }
}

// ─────────────────────────────────────────────────────
//  트리거용 무음 래퍼 — partnerCollectOrdersSilent_ 에서 호출
// ─────────────────────────────────────────────────────
function partnerPushOrdersToExclusiveFormsSilent_() {
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말/공휴일 차단 → 대리공급 Push 스킵"); return; }
  var startTime = new Date();
  var pushOk = false, errorMsg = "";
  // ① 대리공급 Push
  try {
    partnerPushOrdersToExclusiveForms(true);
    pushOk = true;
  } catch (e) {
    errorMsg = String(e.message || e);
    try { Logger.log("[PARTNER_EXCL_PUSH_ERR] " + errorMsg); } catch (_) {}
  }
  // ② 도서산간 추가배송비 확인 (Push 후 새 행 기준으로 즉시 적용)
  try {
    if (typeof _trigger_islandShipping_ === "function") {
      _trigger_islandShipping_();
      Logger.log("[ISLAND] Push 후 도서산간 추가배송비 자동 실행 완료");
    }
  } catch (eIsland) {
    try { Logger.log("[ISLAND_ERR] " + String(eIsland.message || eIsland)); } catch (_) {}
  }
  // ③ 우편번호/택배비 채우기
  try {
    if (typeof _trigger_fillZipAndShipping_ === "function") {
      _trigger_fillZipAndShipping_();
      Logger.log("[ZIP_FILL] Push 후 우편번호 채우기 자동 실행 완료");
    }
  } catch (eZip) {
    try { Logger.log("[ZIP_FILL_ERR] " + String(eZip.message || eZip)); } catch (_) {}
  }
  // ④ Chat 알림
  var elapsed = Math.round((new Date() - startTime) / 1000);
  var now = Utilities.formatDate(startTime, "Asia/Seoul", "HH:mm");
  try {
    if (pushOk) {
      _chat_sendCard_("📤 대리공급 Push 완료", now, [
        { label: "도서산간·우편번호", value: "✅ 자동 처리" },
        { label: "⏱ 소요시간", value: elapsed + "초" },
      ]);
    } else {
      _chat_sendCard_("❌ 대리공급 Push 에러", now, [
        { label: "오류", value: errorMsg.substring(0, 200) },
      ]);
    }
  } catch (_) {}
}

// ─────────────────────────────────────────────────────
//  헬퍼: 업체 캐시 초기화 (openById 최대 3회 재시도)
// ─────────────────────────────────────────────────────
function _pep_initVendorCache_(pfx, fileInfo, directMap) {
  // 1) openById 재시도 (간헐적 API 실패 대응)
  var ss = null;
  var lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      ss = SpreadsheetApp.openById(fileInfo.id);
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) Utilities.sleep(2000); // 2초 대기 후 재시도
    }
  }
  if (!ss) {
    return {
      err:
        "파일 열기 실패 (3회 재시도): " +
        (lastErr ? lastErr.message : "알수없음"),
    };
  }

  try {
    // ★ 2026-06-23 성능 최적화: 메인 탭 다이렉트 로드 + 폴백 구조 (스킵 방지 검증 완료)
    var tab = ss.getSheetByName("전용양식");
    if (!tab) {
      // 폴백: 탭 이름에 "전용양식"이 포함된 형태를 전체 탭 탐색하여 스킵 방지
      var tabs = ss.getSheets();
      for (var ti = 0; ti < tabs.length; ti++) {
        if (tabs[ti].getName().indexOf("전용양식") !== -1) {
          tab = tabs[ti];
          break;
        }
      }
    }
    // 전용양식 탭 없으면 자동 생성
    if (!tab) {
      try {
        tab = _pep_createExclusiveFormTab_(ss, pfx);
      } catch (eC) {}
      if (!tab) return { err: "전용양식 탭 없음/생성실패 → " + fileInfo.name };
    }

    // ★ 전용양식 A1 spill 수식 강제 제거 (거래처명 ARRAYFORMULA가 주입된 경우 보정)
    try {
      var a1f = String(tab.getRange("A1").getFormula() || "");
      if (
        a1f &&
        a1f.indexOf("ARRAYFORMULA") !== -1 &&
        a1f.indexOf("$AA$1") !== -1
      ) {
        tab.getRange("A1:A").clearContent();
        tab.getRange("A1").setValue("송장번호");
        Logger.log(
          "[PEP] " + pfx + " 전용양식 A1 spill 수식 제거 → '송장번호' 복원",
        );
      }
    } catch (eSpill) {}

    // ★ AX열(50번째 열)에 고유ID 기록하므로 최소 50열 확보 (모든 업체 공통)
    try {
      var maxC = tab.getMaxColumns();
      if (maxC < 50) {
        tab.insertColumnsAfter(maxC, 50 - maxC);
      }
    } catch (eCol50) {}

    // ★ AX열(50번째) 1행에 "고유ID" 헤더 자동 기록 (송장수집 인제스트용)
    try {
      var _axHdr_ = String(tab.getRange(1, 50).getValue() || "").trim();
      if (!_axHdr_) {
        tab.getRange(1, 50).setValue("고유ID");
        Logger.log("[PEP] " + pfx + " 전용양식 AX열 헤더 '고유ID' 자동 기록");
      }
    } catch (_eAxHdr_) {}

    // ★ 헤더 열 수 정합성 보정: directMap.totalCols와 실제 헤더 열 수가 다르면 보정
    try {
      var expectedHeaders = _PEP_EXCLUSIVE_FORM_HEADERS_[pfx];
      if (expectedHeaders) {
        var expectedCols = expectedHeaders.length;
        maxC = tab.getMaxColumns();
        var requiredCols = Math.max(expectedCols, 50);
        if (maxC < requiredCols) {
          tab.insertColumnsAfter(maxC, requiredCols - maxC);
        }

        // 헤더 행 확인 — 기존 헤더가 다르면 업데이트
        var curHdr = tab
          .getRange(1, 1, 1, Math.min(maxC, expectedCols))
          .getValues()[0];
        var hdrMismatch = curHdr.length !== expectedCols;
        if (!hdrMismatch) {
          for (var hc = 0; hc < expectedCols; hc++) {
            if (String(curHdr[hc] || "").trim() !== expectedHeaders[hc]) {
              hdrMismatch = true;
              break;
            }
          }
        }
        if (hdrMismatch) {
          tab.getRange(1, 1, 1, expectedCols).setValues([expectedHeaders]);
          tab
            .getRange(1, 1, 1, expectedCols)
            .setBackground("#1f4e78")
            .setFontColor("#ffffff")
            .setFontWeight("bold")
            .setHorizontalAlignment("center");
          Logger.log(
            "[PEP] " +
              pfx +
              " 전용양식 헤더 자동 보정 → " +
              expectedCols +
              "열",
          );
        }
      }
    } catch (eHdr) {}

    // 전화번호 열을 텍스트 서식(@)으로 설정 → setValues 시 선행 0 보존
    if (directMap.phoneTargetCols) {
      for (var ptc = 0; ptc < directMap.phoneTargetCols.length; ptc++) {
        var pcol = directMap.phoneTargetCols[ptc] + 1; // 1-indexed
        try {
          tab
            .getRange(2, pcol, Math.max(tab.getMaxRows() - 1, 1), 1)
            .setNumberFormat("@");
        } catch (eFmt) {}
      }
    }

    var nextSeq = null;
    if (directMap.seqCol != null) {
      nextSeq = _pep_computeNextSeq_(
        tab,
        directMap.seqCol,
        directMap.seqMinStart || 300,
      );
    }
    // HR(뉴파츠): seqCol=null이지만 C열(2) 결합형 날짜-순번에서 순번 추출
    if (pfx === "HR" && nextSeq == null) {
      nextSeq = _pep_computeHrNextSeqFromDateNo_(
        tab,
        directMap.seqMinStart || 1,
      );
    }

    // ★ HR(뉴파츠): 뉴파츠공급가 탭을 코드→VAT포함가 맵으로 선로드
    var newpartsMap = null;
    if (pfx === "HR") {
      try {
        // 탭 이름 후보 (공백 유무 모두 지원)
        var NP_TAB_CANDIDATES = [
          "뉴파츠공급가",
          "뉴파츠 공급가",
          "NewParts공급가",
          "공급가",
          "단가표",
        ];
        var npTab = null;
        for (var nti = 0; nti < NP_TAB_CANDIDATES.length; nti++) {
          npTab = ss.getSheetByName(NP_TAB_CANDIDATES[nti]);
          if (npTab) {
            Logger.log("[PEP] 뉴파츠공급가 탭 발견: " + NP_TAB_CANDIDATES[nti]);
            break;
          }
        }
        if (npTab && npTab.getLastRow() >= 2) {
          newpartsMap = {};
          var npLc = Math.max(npTab.getLastColumn(), 3);
          var npAll = npTab
            .getRange(1, 1, npTab.getLastRow(), npLc)
            .getValues();
          var npHdr = npAll[0];
          // 헤더로 코드열·단가열 탐지
          var npCodeCol = 0,
            npPriceCol = 2; // 기본: A=코드, C=단가
          for (var nph = 0; nph < npHdr.length; nph++) {
            var nh = String(npHdr[nph] || "")
              .replace(/\s/g, "")
              .toLowerCase();
            if (
              npCodeCol === 0 &&
              (nh.indexOf("코드") !== -1 || nh.indexOf("code") !== -1)
            )
              npCodeCol = nph;
            if (
              nh.indexOf("vat") !== -1 ||
              nh.indexOf("포함") !== -1 ||
              nh === "단가"
            )
              npPriceCol = nph;
          }
          for (var npi = 1; npi < npAll.length; npi++) {
            var npCode = String(npAll[npi][npCodeCol] || "").trim();
            var npPrice = parseFloat(npAll[npi][npPriceCol]) || 0;
            if (npCode && npPrice > 0) newpartsMap[npCode] = npPrice;
          }
          Logger.log(
            "[PEP] 뉴파츠공급가 선로드: " +
              Object.keys(newpartsMap).length +
              "건 (코드열=" +
              (npCodeCol + 1) +
              ", 단가열=" +
              (npPriceCol + 1) +
              ")",
          );
        } else {
          Logger.log("[PEP] 뉴파츠공급가 탭 없음 또는 데이터 없음");
        }
      } catch (eNP) {
        Logger.log("[PEP] 뉴파츠공급가 로드 실패: " + eNP.message);
      }
    }

    // ★ JM(제이엠): 공급가 탭 A열(코드) → M열(택배비) 맵 선로드
    var jmShippingMap = null;
    if (pfx === "JM") {
      try {
        var JM_TAB_CANDIDATES = ["공급가", "제이엠공급가", "JM공급가", "단가표"];
        var jmTab = null;
        for (var jti = 0; jti < JM_TAB_CANDIDATES.length; jti++) {
          jmTab = ss.getSheetByName(JM_TAB_CANDIDATES[jti]);
          if (jmTab) {
            Logger.log("[PEP] 제이엠 공급가 탭 발견: " + JM_TAB_CANDIDATES[jti]);
            break;
          }
        }
        if (jmTab && jmTab.getLastRow() >= 2) {
          jmShippingMap = {};
          var jmLc = Math.max(jmTab.getLastColumn(), 13);
          var jmAll = jmTab.getRange(1, 1, jmTab.getLastRow(), jmLc).getValues();
          // A열(0)=이카운트코드, M열(12)=택배비
          for (var ji = 1; ji < jmAll.length; ji++) {
            var jmCode = String(jmAll[ji][0] || "").trim();
            var jmShip = parseFloat(jmAll[ji][12]) || 0;
            if (jmCode && jmShip > 0) jmShippingMap[jmCode] = jmShip;
          }
          Logger.log(
            "[PEP] 제이엠 공급가 택배비 선로드: " +
              Object.keys(jmShippingMap).length + "건",
          );
        } else {
          Logger.log("[PEP] 제이엠 공급가 탭 없음 또는 데이터 없음");
        }
      } catch (eJM) {
        Logger.log("[PEP] 제이엠 공급가 로드 실패: " + eJM.message);
      }
    }
    // ★ 전용양식 AX(50열)+품목코드 — UID|코드 복합키별 건수
    var existingDedupCounts = _pep_loadExclusiveDedupCounts_(tab, directMap);
    // ★ 2026-07-20: 마감탭(전용발주 마감, 당월+전월) 고유ID도 dedup에 합산
    //   마감으로 행이 전용양식에서 빠지면 AX dedup이 사라져, 소스탭에 남은
    //   같은 주문이 다음 Push에서 "새 발주"로 재Push됨 → 이중 발주 사고 방지
    var _archDedupKeys_ = 0;
    try {
      var archCounts = _pep_loadArchiveDedupCounts_(ss);
      for (var _ak_ in archCounts) {
        existingDedupCounts[_ak_] =
          (existingDedupCounts[_ak_] || 0) + archCounts[_ak_];
        _archDedupKeys_++;
      }
    } catch (eArcDedup) {
      Logger.log("[PEP] " + pfx + " 마감탭 dedup 로드 실패: " + eArcDedup.message);
    }
    Logger.log(
      "[PEP] " + pfx +
      " 전용양식 dedup키=" + Object.keys(existingDedupCounts).length + "종" +
      " (마감탭 포함 " + _archDedupKeys_ + "종, tab.getLastRow=" + tab.getLastRow() + ")",
    );
    return {
      ss: ss,
      tab: tab,
      nextSeq: nextSeq,
      newpartsMap: newpartsMap,
      jmShippingMap: jmShippingMap,
      batchColor: null,
      existingDedupCounts: existingDedupCounts,
      nextRow: _pep_findActualLastRow_(tab) + 1, // ★ 성능최적화: 다음 쓰기 행 캐시
      pendingRows: [], // ★ 성능최적화: 배치 쓰기 버퍼 [{outRow, dmCols}]
    };
  } catch (e) {
    return { err: "캐시 초기화 실패: " + e.message };
  }
}

// ─────────────────────────────────────────────────────
//  헬퍼: 순번 최대값 + 1
// ─────────────────────────────────────────────────────
function _pep_computeNextSeq_(tab, seqCol, minStart) {
  var lr = _pep_findActualLastRow_(tab);
  if (lr < 2) return minStart || 300;
  var vals = tab.getRange(2, seqCol + 1, lr - 1, 1).getValues();
  var max = (minStart || 300) - 1;
  for (var i = 0; i < vals.length; i++) {
    var v = parseInt(vals[i][0], 10);
    if (!isNaN(v) && v > max) max = v;
  }
  return max + 1;
}

// ─────────────────────────────────────────────────────
//  헬퍼: HR(뉴파츠) C열 "yyyy/MM/dd-순번" 에서 순번 최대값 + 1
// ─────────────────────────────────────────────────────
function _pep_computeHrNextSeqFromDateNo_(tab, minStart) {
  var lr = _pep_findActualLastRow_(tab);
  if (lr < 2) return minStart || 1;
  var vals = tab.getRange(2, 3, lr - 1, 1).getValues(); // C열(3번째)
  var max = (minStart || 1) - 1;
  for (var i = 0; i < vals.length; i++) {
    var raw = String(vals[i][0] || "");
    // "2026/05/08-3" → 3 추출
    var m = raw.match(/-(\d+)$/);
    if (m) {
      var v = parseInt(m[1], 10);
      if (!isNaN(v) && v > max) max = v;
    }
  }
  return max + 1;
}

// ─────────────────────────────────────────────────────
//  헬퍼: prefix → 파일 매핑 (_PEP_VENDOR_LABELS_ 기반)
//  ★ 소비자용 파일 제외, 정확매칭 우선, 역방향 부분매칭 제거
// ─────────────────────────────────────────────────────
function _pep_buildPrefixToFileMap_(files) {
  // _PEP_VENDOR_LABELS_ (prefix→업체명)를 역전하여 label→prefix 매핑 생성
  var labelToPfx = {};
  try {
    var labels =
      typeof _PEP_VENDOR_LABELS_ !== "undefined" ? _PEP_VENDOR_LABELS_ : {};
    for (var pfx in labels) {
      if (labels[pfx]) labelToPfx[labels[pfx]] = pfx;
    }
  } catch (e) {}

  var map = {};

  // 1차: 소비자용 제외 + 정확 매칭 (shortName === label)
  for (var fi = 0; fi < files.length; fi++) {
    if (files[fi].name.indexOf("(소비자용)") !== -1) continue;
    var shortName = files[fi].name.replace("[협력업체] ", "").trim();
    for (var label in labelToPfx) {
      if (shortName === label) {
        var pfx = labelToPfx[label];
        if (!map[pfx]) map[pfx] = files[fi];
        break;
      }
    }
  }

  // 2차: 소비자용 제외 + 부분 매칭 (파일명에 label 포함 — 단방향만)
  for (var fi2 = 0; fi2 < files.length; fi2++) {
    if (files[fi2].name.indexOf("(소비자용)") !== -1) continue;
    var shortName2 = files[fi2].name.replace("[협력업체] ", "").trim();
    for (var label2 in labelToPfx) {
      var pfx2 = labelToPfx[label2];
      if (map[pfx2]) continue; // 1차에서 이미 매칭됨
      if (shortName2.indexOf(label2) !== -1) {
        map[pfx2] = files[fi2];
        break;
      }
    }
  }

  // 3차 폴백: 위에서 못 찾은 접두만 소비자용 포함 재시도
  for (var fi3 = 0; fi3 < files.length; fi3++) {
    var shortName3 = files[fi3].name
      .replace("[협력업체] ", "")
      .replace(/\s*\(소비자용\).*$/, "")
      .trim();
    for (var label3 in labelToPfx) {
      var pfx3 = labelToPfx[label3];
      if (map[pfx3]) continue;
      if (shortName3 === label3 || shortName3.indexOf(label3) !== -1) {
        map[pfx3] = files[fi3];
        break;
      }
    }
  }

  // ★ 2026-08-25: 보조 접두는 대표 접두와 같은 파일을 가리키게 한다.
  //   (JH/BF → JT 파일. 업체명 역매핑이 1:1이라 별칭은 여기서 이어붙인다)
  try {
    for (var alias in _PEP_VENDOR_PREFIX_ALIAS_) {
      if (!_PEP_VENDOR_PREFIX_ALIAS_.hasOwnProperty(alias)) continue;
      var primary = _PEP_VENDOR_PREFIX_ALIAS_[alias];
      if (!map[alias] && map[primary]) map[alias] = map[primary];
    }
  } catch (eAlias) {}

  return map;
}

// ─────────────────────────────────────────────────────
//  소스 탭 이름 변경 (메뉴에서 수동 실행)
//  ★ 수정: PropertiesService로 저장 → 트리거 컨텍스트에서도 유지됨
// ─────────────────────────────────────────────────────
function partnerSetExclusivePushSourceTab() {
  var ui = SpreadsheetApp.getUi();
  var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var names = srcSS
    .getSheets()
    .map(function (s) {
      return s.getName();
    })
    .join("\n");
  var currentName = _pep_getSourceTabName_();
  var resp = ui.prompt(
    "소스 탭 이름 변경",
    "현재: " +
      currentName +
      "\n\n소스 스프레드시트 탭 목록:\n" +
      names +
      "\n\n새 탭 이름:",
    ui.ButtonSet.OK_CANCEL,
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var newName = resp.getResponseText().trim();
  if (!srcSS.getSheetByName(newName)) {
    return ui.alert("탭 없음: " + newName + "\n\n소스 시트에서 확인하세요.");
  }
  PropertiesService.getScriptProperties().setProperty(
    "PEP_SOURCE_TAB_NAME",
    newName,
  );
  ui.alert(
    "✅ 소스 탭 변경 완료: " +
      newName +
      "\n(PropertiesService에 저장됨 — 트리거에서도 유지)",
  );
}

/**
 * ★ 수정: PropertiesService 저장값 우선, 없으면 상수(_PEP_SOURCE_TAB_NAME) 사용
 * 트리거 실행 시 전역변수는 초기화되므로 PropertiesService가 필수
 */
function _pep_getSourceTabName_() {
  try {
    var saved = PropertiesService.getScriptProperties().getProperty(
      "PEP_SOURCE_TAB_NAME",
    );
    if (saved) return saved;
  } catch (e) {}
  return _PEP_SOURCE_TAB_NAME;
}

// 협력업체 _PEP_EXCLUSIVE_FORM_HEADERS_ headerCsv 원본 (pipe 구분)
// parseVendorExclusiveHeaderCsv_ 방식과 동일하게 | 로 분리하여 배열로 사용
var _PEP_EXCLUSIVE_FORM_HEADERS_ = {
  // JT: 준테크 — 대한통운(CJ) 엑셀 양식 기준 (★ 2026-08-06)
  // A=송장번호, B=이슈(운영) + C~W=대한통운 양식 21열 = 총 23열
  // 원본: 폴더 「대한통운 양식.xlsx」
  JT: [
    "송장번호",
    "이슈",
    "예약구분",
    "집하예정일",
    "보내는분성명",
    "보내는분전화번호",
    "보내는분기타연락처",
    "보내는분우편번호",
    "보내는분주소(전체, 분할)",
    "받는분성명",
    "받는분전화번호",
    "받는분기타연락처",
    "받는분우편번호",
    "받는분주소(전체, 분할)",
    "운송장번호",
    "고객주문번호",
    "품목명",
    "박스수량",
    "박스타입",
    "기본운임",
    "배송메세지1",
    "배송메세지2",
    "운임구분",
  ],
  // SW: 선우 — 대한통운 양식 (★ 2026-08-25)
  // A=송장번호, B=이슈(운영) + C~R=업체 제공 양식 16열 = 총 18열
  SW: [
    "송장번호",
    "이슈",
    "보내는분성명",
    "보내는분전화번호",
    "보내는분기타연락처",
    "보내는분우편번호",
    "보내는분주소(전체, 분할)",
    "받는분성명",
    "받는분전화번호",
    "받는분기타연락처",
    "받는분우편번호",
    "받는분주소(전체, 분할)",
    "품목명",
    "내품명",
    "박스수량",
    "배송메세지1",
    "박스타입",
    "운임구분",
  ],
  // AP: 올팩 — 19열
  AP: [
    "송장번호",
    "이슈",
    "보내는사람(지정)",
    "전화번호1(지정)",
    "전화번호2(지정)",
    "우편번호(지정)",
    "주소(지정)",
    "받는사람",
    "전화번호1",
    "전화번호2",
    "우편번호",
    "주소",
    "상품명1",
    "상품상세1",
    "수량(A타입)",
    "배송메시지",
    "운임구분",
    "운임",
    "운송장번호",
  ],
  // HR: 뉴파츠_NEW — A=송장번호, B=이슈(공통) + C~AF=30열 이카운트 구매발주 업로드 양식 = 총 32열
  HR: [
    "송장번호",
    "이슈",
    "일자",
    "순번",
    "거래처코드",
    "거래처명",
    "담당자",
    "출하창고",
    "거래유형",
    "통화",
    "환율",
    "참조",
    "결제조건",
    "유효기간",
    "납기일자",
    "검색창내용",
    "배송방식",
    "수령인",
    "수령인연락처",
    "배송지주소",
    "적요(배송메시지)",
    "품목코드",
    "품목명",
    "규격",
    "수량",
    "단가",
    "금액1",
    "외화금액",
    "공급가액",
    "부가세",
    "납기일자",
    "적요",
  ],
  // NK: 냅킨코리아 — 13열 (G=빈칸, L=정산단가 공란 처리)
  NK: [
    "송장번호",
    "이슈",
    "받는사람",
    "전화번호",
    "주소",
    "우편번호",
    "",
    "상품명",
    "수량",
    "배송메세지",
    "보내는사람",
    "정산단가",
    "전화",
  ],
  // GW: 그린우드 — EMBEDDED 원본 20열
  GW: [
    "송장번호",
    "이슈",
    "순번",
    "일자-No.",
    "품목코드",
    "품목명",
    "택배박스수량",
    "판매수량",
    "전화",
    "모바일",
    "주소1",
    "배송메시지",
    "합계",
    "거래처명",
    "단품배송비",
    "적요",
    "사방넷주문번호",
    "보내는분",
    "보내는분전화",
    "보내는주소(팩투유)",
  ],
  // TY: 태양 — 실제 23열 (빈 열: D,G,L,N~T)
  TY: [
    "송장번호",
    "이슈",
    "고객명",
    "",
    "수하인주소",
    "수하인번호",
    "",
    "박스수량",
    "택배운임(합계)",
    "운임구분",
    "품목명",
    "",
    "배송메세지",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "송하인명",
    "송하인주소",
    "송하인번호",
  ],
  // AJ: 아주팩
  AJ: [
    "송장번호",
    "이슈",
    "보내는분 성명",
    "보내는분 전화번호",
    "보내는분 주소(전체, 분할)",
    "받는분 성명",
    "받는분 전화번호",
    "받는분 주소(전체, 분할)",
    "품목명",
    "박스수량",
    "박스타입",
    "배송메세지1",
  ],
  // BW: 부원 — 「부원택배 양식 (1).xlsx」+ 앞 송장번호·이슈 (★ 2026-08-10)
  // A=송장번호, B=이슈, C=받는사람 … R=전화 (총 18열)
  // 원본 엑셀은 받는사람부터 시작 → 운영 탭은 송장/이슈 2열을 앞에 붙임
  BW: [
    "송장번호",
    "이슈",
    "받는사람",
    "전화번호",
    "주소",
    "",
    "상품명",
    "수량",
    "B2750",
    "C3200",
    "D5500",
    "E6500",
    "배송메세지",
    "운임구분",
    "운임",
    "보내는사람",
    "주소",
    "전화",
  ],
  // KR: 코라마
  KR: [
    "송장번호",
    "이슈",
    "받으시는 분",
    "받는분총주소",
    "받으시는 분 전화",
    "받는분핸드폰",
    "품번",
    "품목명",
    "수량",
    "특기사항",
    "보내시는 분",
    "보내시는 분 전화",
    "지불조건",
  ],
  // HU: 후아코리아
  HU: [
    "송장번호",
    "이슈",
    "받는분(필수)",
    "받는분전화번호",
    "휴대폰번호(필수입력)",
    "받는분주소(전체, 분할)필수입력",
    "품목(필수)",
    "배송메세지1",
    "택배수량(필수입력)",
    "운임구분 (신용/착불) 필수입력",
    "운임",
    "보내는분성명(필수)",
    "보내는분전화번호(필수)",
  ],
  // IW: 인터웍스
  IW: [
    "송장번호",
    "이슈",
    "받는사람",
    "전화번호",
    "주소",
    "우편번호",
    "상품명",
    "박스타입",
    "수량",
    "배송메세지",
    "보내는사람",
    "주소",
    "전화",
  ],
  // JM: 제이엠 — 17열
  JM: [
    "송장번호",
    "이슈",
    "수화주전화1",
    "수화주전화2",
    "수화주명",
    "주소",
    "수량",
    "품명",
    "포장",
    "운임구분",
    "운송상품",
    "우편번호",
    "도착영업소",
    "발화주명",
    "발화주전화번호",
    "총운임",
    "특기사항",
  ],
  // OC: 부엉이커피 — 12열 (팩투유 기본 양식)
  // ★ 2026-07-07 추가
  OC: [
    "송장번호",
    "이슈",
    "받는사람",
    "전화번호",
    "주소",
    "상품명",
    "수량",
    "배송메세지",
    "보내는사람",
    "보내는분전화",
    "보내는분주소",
    "이카운트코드",
  ],
  // LG: 로엔그린 — 20열 (AP 기반 + B열에 이슈 추가, 기존 열 +1 밀림)
  // ★ 2026-07-07 추가: B열이 없었던 문제 해결
  LG: [
    "송장번호",
    "이슈",
    "보내는사람(지정)",
    "전화번호1(지정)",
    "전화번호2(지정)",
    "우편번호(지정)",
    "주소(지정)",
    "받는사람",
    "전화번호1",
    "전화번호2",
    "우편번호",
    "주소",
    "상품명1",
    "상품상세1",
    "수량(A타입)",
    "배송메시지",
    "운임구분",
    "운임",
    "운송장번호",
    "택배수량",
  ],
  // GP: 지니팩 — 12열 (OC 구조 동일)
  // ★ 2026-07-07 추가
  GP: [
    "송장번호",
    "이슈",
    "받는사람",
    "전화번호",
    "주소",
    "상품명",
    "수량",
    "배송메세지",
    "보내는사람",
    "보내는분전화",
    "보내는분주소",
    "이카운트코드",
  ],
  // HP: 하나팩 — 11열 (★ 2026-07-08 추가)
  HP: [
    "송장번호",
    "이슈",
    "보내는사람",
    "전화번호",
    "보내는사람주소",
    "상품명",
    "수량",
    "받는사람",
    "연락처",
    "주소",
    "배송메시지",
  ],
  // YS: 와이에스 — 14열 (★ 2026-07-14 추가)
  YS: [
    "송장번호",
    "이슈",
    "받는사람",
    "전화번호1",
    "전화번호2",
    "우편번호",
    "주소",
    "상품명1",
    "운임구분",
    "수량(A타입)",
    "배송메시지",
    "보내는사람(지정)",
    "전화번호1(지정)",
    "주소(지정)",
  ],
  // (BW 헤더는 위 「부원택배 양식」18열 정의 사용 — 구 13열 중복 키 제거)
  // KR 등 이어서
};

// ─────────────────────────────────────────────────────
//  🔍 Push 시스템 통합 진단
//  실제 Drive 파일 ↔ LABELS ↔ DIRECT_MAP ↔ 소스 UID 불일치를 한 번에 보고
// ─────────────────────────────────────────────────────
function partnerDiagnosePushSystem() {
  var ui = SpreadsheetApp.getUi();
  var lines = ["🔍 Push 시스템 통합 진단\n"];

  // 1) Drive에서 실제 협력업체 파일 스캔
  var allFiles = _pt_listFiles();
  lines.push("▶ Drive 협력업체 파일: " + allFiles.length + "개");

  var labels =
    typeof _PEP_VENDOR_LABELS_ !== "undefined" ? _PEP_VENDOR_LABELS_ : {};
  var directMap =
    typeof _PEP_VENDOR_DIRECT_MAP_ !== "undefined"
      ? _PEP_VENDOR_DIRECT_MAP_
      : {};

  // 2) 파일명에서 prefix 추출 시도 → LABELS/DIRECT_MAP 등록 여부 확인
  var fileIssues = [];
  var okFiles = [];
  for (var fi = 0; fi < allFiles.length; fi++) {
    var fname = allFiles[fi].name
      .replace("[협력업체] ", "")
      .replace(/\s*\(소비자용\).*$/, "")
      .trim();
    // LABELS 역매핑: 파일명에 업체명이 포함된 접두 찾기
    var foundPfx = null;
    for (var lp in labels) {
      if (fname.indexOf(labels[lp]) !== -1) {
        foundPfx = lp;
        break;
      }
    }
    var hasLabel = !!foundPfx;
    var hasMap = foundPfx ? !!directMap[foundPfx] : false;

    if (!hasLabel || !hasMap) {
      fileIssues.push(
        "  ⚠️ " +
          fname +
          (!hasLabel ? " → LABELS 미등록(접두 불명)" : " [" + foundPfx + "]") +
          (!hasMap ? " → DIRECT_MAP 미등록" : ""),
      );
    } else {
      okFiles.push("  ✅ [" + foundPfx + "] " + fname);
    }
  }
  if (okFiles.length) lines.push("\n[정상 등록 파일]");
  okFiles.forEach(function (l) {
    lines.push(l);
  });
  if (fileIssues.length) lines.push("\n[누락/불일치 파일]");
  fileIssues.forEach(function (l) {
    lines.push(l);
  });

  // 3) LABELS/DIRECT_MAP 등록은 됐지만 실제 파일이 없는 접두
  var allPfx = Object.keys(labels);
  for (var pi = 0; pi < allPfx.length; pi++) {
    var pfx = allPfx[pi];
    var labelName = labels[pfx];
    var fileFound = false;
    for (var fi2 = 0; fi2 < allFiles.length; fi2++) {
      if (allFiles[fi2].name.indexOf(labelName) !== -1) {
        fileFound = true;
        break;
      }
    }
    if (!fileFound) {
      lines.push(
        "  ❌ [" + pfx + "] LABELS엔 있지만 실제 파일 없음: " + labelName,
      );
    }
  }

  // 3-2) 등록 완성도: LABELS에만 있고 전용양식/Push 매핑이 없는 접두
  var incomplete = [];
  var formHeaders =
    typeof _PEP_EXCLUSIVE_FORM_HEADERS_ !== "undefined"
      ? _PEP_EXCLUSIVE_FORM_HEADERS_
      : {};
  for (var ci = 0; ci < allPfx.length; ci++) {
    var cp = allPfx[ci];
    var lack = [];
    if (!directMap[cp]) lack.push("Push매핑(DIRECT_MAP)");
    if (!formHeaders[cp]) lack.push("전용양식헤더(FORM_HEADERS)");
    if (lack.length) {
      incomplete.push("  ⚠️ [" + cp + "] " + labels[cp] + " → " + lack.join(" · ") + " 미등록");
    }
  }
  if (incomplete.length) {
    lines.push("\n[등록 미완성 접두 — Push 시 '매핑없음'으로 스킵됨]");
    incomplete.forEach(function (l) {
      lines.push(l);
    });
  }

  // 3-3) 보조 접두 별칭 (한 업체가 코드 접두를 2개 이상 쓰는 경우)
  try {
    var aliasMap =
      typeof _PEP_VENDOR_PREFIX_ALIAS_ !== "undefined"
        ? _PEP_VENDOR_PREFIX_ALIAS_
        : {};
    var aliasKeys = Object.keys(aliasMap);
    if (aliasKeys.length) {
      lines.push("\n[보조 접두 별칭]");
      for (var ai = 0; ai < aliasKeys.length; ai++) {
        var aKey = aliasKeys[ai];
        var aPrimary = aliasMap[aKey];
        lines.push(
          "  " +
            aKey +
            " → " +
            aPrimary +
            " (" +
            (labels[aPrimary] || "대표 접두 미등록") +
            ")" +
            (directMap[aPrimary] ? "" : "  ⚠️ 대표 접두 DIRECT_MAP 미등록"),
        );
      }
    }
  } catch (eAliasDiag) {}

  // 4) 소스 탭 UID 현황
  try {
    var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
    var srcTab = null;
    var srcSheets = srcSS.getSheets();
    for (var si = 0; si < srcSheets.length; si++) {
      if (srcSheets[si].getSheetId() === _PEP_SOURCE_TAB_GID) {
        srcTab = srcSheets[si];
        break;
      }
    }
    if (!srcTab) srcTab = srcSS.getSheetByName(_pep_getSourceTabName_());
    if (srcTab && srcTab.getLastRow() >= 2) {
      var hdr = srcTab.getRange(1, 1, 1, srcTab.getLastColumn()).getValues()[0];
      var uidCol = -1,
        codeCol = -1;
      for (var hi = 0; hi < hdr.length; hi++) {
        var hn = String(hdr[hi] || "")
          .replace(/\s/g, "")
          .toLowerCase();
        if (hn === "협력push" || hn === "pep_uid") uidCol = hi;
        if (hi === _PEP_CODE_COL) codeCol = hi;
      }
      var lr = srcTab.getLastRow();
      var data = srcTab
        .getRange(2, 1, lr - 1, srcTab.getLastColumn())
        .getValues();
      var totalRows = 0,
        hasUid = 0,
        noCode = 0,
        noMap = 0,
        noFile = 0,
        ready = 0;
      var prefixToFile = _pep_buildPrefixToFileMap_(allFiles);

      for (var r = 0; r < data.length; r++) {
        var code = String(data[r][_PEP_CODE_COL] || "").trim();
        var name = String(data[r][_PEP_ITEM_COL] || "").trim();

        // ★ 2026-08-25: 보조 접두(JH/BF)는 대표 접두(JT)로 환산해 집계
        var pfx2 = "";
        if (code.length >= 2) {
          pfx2 = _pep_resolvePrefixAlias_(code.substring(0, 2));
        } else {
          var m = name.match(/([a-zA-Z]{2})/);
          if (m) pfx2 = _pep_resolvePrefixAlias_(m[1]);
        }

        if (!pfx2) {
          noCode++;
          continue;
        }
        totalRows++;
        var uid = uidCol >= 0 ? String(data[r][uidCol] || "").trim() : "";
        if (uid) {
          hasUid++;
          continue;
        }
        if (!directMap[pfx2]) {
          noMap++;
          continue;
        }
        if (!prefixToFile[pfx2]) {
          noFile++;
          continue;
        }
        ready++;
      }
      lines.push(
        "\n▶ 소스 탭 현황 (" +
          srcTab.getName() +
          ", " +
          totalRows +
          "행)" +
          "\n  Push 가능(ready): " +
          ready +
          "건" +
          "\n  이미 Push됨(UID있음): " +
          hasUid +
          "건" +
          "\n  코드 없음: " +
          noCode +
          "건" +
          "\n  DIRECT_MAP 미등록: " +
          noMap +
          "건" +
          "\n  파일 매핑 없음: " +
          noFile +
          "건",
      );
      if (ready === 0 && (noMap > 0 || noFile > 0)) {
        lines.push(
          "\n⚠️ Push 0건 이유: " +
            (noMap > 0
              ? "코드 접두가 DIRECT_MAP에 없음 (" + noMap + "건)  "
              : "") +
            (noFile > 0 ? "파일 매핑 없음 (" + noFile + "건)" : ""),
        );
      }
    }
  } catch (e) {
    lines.push("\n❌ 소스 탭 접근 오류: " + e.message);
  }

  ui.alert("Push 시스템 진단", lines.join("\n"), ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────
//  prefix → 업체명 라벨 매핑 (파일명 매칭에 사용)
//  _PEP_EXCLUSIVE_FORM_HEADERS_는 Object(prefix→헤더배열)이므로
//  파일명 매칭용 label은 별도 상수로 관리한다.
// ─────────────────────────────────────────────────────
var _PEP_VENDOR_LABELS_ = {
  HR: "뉴파츠",
  NK: "냅킨코리아",
  GW: "그린우드",
  TY: "태양",
  AJ: "아주팩",
  BW: "부원",
  KR: "코라마",
  HU: "후아코리아",
  IW: "인터웍스",
  AP: "올팩",
  JM: "제이엠",
  LG: "로엔그린",
  OC: "부엉이커피", // ★ 2026-07-07 추가
  GP: "지니팩", // ★ 2026-07-07 추가
  HP: "하나팩", // ★ 2026-07-08 추가
  YS: "와이에스", // ★ 2026-07-14 추가
  JT: "준테크",  // ★ 2026-07-15 추가
  SW: "선우",    // ★ 2026-08-25 추가
};

// ─────────────────────────────────────────────────────
//  업체 → 택배사 (SSOT)
//  택배사는 업체 단위 사실이다. 사방넷 코드·통합조회 M열·CS 표시가
//  모두 이 표 하나를 따른다. 코드(숫자)를 직접 적지 않는다.
//  ★ 2026-08-26: 부엉이커피(OC) 한진택배 반영
// ─────────────────────────────────────────────────────
var _PEP_VENDOR_CARRIER_ = {
  GW: "로젠택배",   // 그린우드
  HR: "로젠택배",   // 뉴파츠
  NK: "롯데택배",   // 냅킨코리아
  LG: "롯데택배",   // 로엔그린
  BW: "롯데택배",   // 부원
  OC: "한진택배",   // 부엉이커피 (★ 2026-08-26 로젠 → 한진)
  AJ: "로젠택배",   // 아주팩
  AP: "롯데택배",   // 올팩
  YS: "롯데택배",   // 와이에스
  IW: "롯데택배",   // 인터웍스
  JM: "대신택배",   // 제이엠
  JT: "CJ대한통운", // 준테크 (보조 접두 JH·BF·NS 포함)
  KR: "롯데택배",   // 코라마
  SW: "CJ대한통운", // 선우
  TY: "로젠택배",   // 태양
  HP: "롯데택배",   // 하나팩
  HU: "로젠택배",   // 후아코리아
};

// ─────────────────────────────────────────────────────
//  택배사 → 사방넷 대량등록 택배사코드
//  계정(사방넷 「사용 택배사 등록」)에 종속된 값이다.
//  비어 있으면 해당 업체 행은 대량등록에서 제외되고
//  "택배사코드 미지정"으로 보고된다 (잘못된 코드로 올리지 않는다).
// ─────────────────────────────────────────────────────
var _PEP_CARRIER_SABANG_CODE_ = {
  "CJ대한통운": "001",
  "롯데택배": "002",
  "로젠택배": "007",
  "대신택배": "037",
  "한진택배": "", // ← 사방넷 계정의 한진 코드 확인 후 기입
};

// ─────────────────────────────────────────────────────
//  운영 SSOT는 상품정보「업체_택배사」탭이다.
//  위 두 상수는 탭이 없을 때의 씨앗·폴백일 뿐이다.
//  탭에 적으면 코드 배포 없이 신규 업체·택배사코드를 반영할 수 있고,
//  CS앱(별도 프로젝트)도 같은 탭을 읽으므로 표가 하나로 유지된다.
// ─────────────────────────────────────────────────────
var _PEP_VC_TAB_NAME_ = "업체_택배사";
var _PEP_VC_HEADERS_ = ["접두", "업체명", "택배사", "사방넷코드", "비고"];
var _pep_vcMem_ = null;

/** 「업체_택배사」탭 → { byPfx, byLabel, code, conflicts, rows } */
function _pep_loadVendorCarrierTable_(refresh) {
  if (!refresh && _pep_vcMem_) return _pep_vcMem_;

  var t = { byPfx: {}, byLabel: {}, code: {}, conflicts: [], rows: 0 };
  try {
    var infoId = typeof _PT !== "undefined" && _PT.INFO_SS_ID ? _PT.INFO_SS_ID : "";
    var tab = infoId
      ? SpreadsheetApp.openById(infoId).getSheetByName(_PEP_VC_TAB_NAME_)
      : null;
    if (tab && tab.getLastRow() >= 2) {
      var data = tab.getRange(2, 1, tab.getLastRow() - 1, 4).getDisplayValues();
      for (var i = 0; i < data.length; i++) {
        var pfx = String(data[i][0] || "").trim().toUpperCase();
        var label = String(data[i][1] || "").replace(/\s/g, "");
        var carrier = String(data[i][2] || "").trim();
        var code = String(data[i][3] || "").trim();
        if (!carrier) continue;
        if (pfx) t.byPfx[pfx] = carrier;
        if (label) t.byLabel[label] = carrier;
        if (code) {
          // 사방넷코드는 택배사 단위 사실이다. 같은 택배사에 다른 코드가 오면 알린다.
          if (t.code[carrier] && t.code[carrier] !== code) {
            t.conflicts.push(carrier + ": " + t.code[carrier] + " vs " + code);
          } else {
            t.code[carrier] = code;
          }
        }
        t.rows++;
      }
    }
  } catch (e) {
    Logger.log("[VENDOR_CARRIER] 탭 읽기 실패, 코드 폴백 사용: " + e.message);
  }

  _pep_vcMem_ = t;
  return t;
}

/**
 * 출처 문자열 → 택배사명. 출처가 택배사를 알려주면 그게 사실이다.
 * `_puv_carrierFromSource_` 와 같은 판정을 쓴다 — 기준이 갈리면 일일마감과
 * 통합조회의 택배사가 달라진다. 통합조회 쪽은 이 함수를 호출한다.
 */
function _pep_carrierFromSource_(src) {
  var s = String(src || "");
  if (!s) return "";
  if (s.indexOf("로젠") >= 0) return "로젠택배";
  if (s.indexOf("한진") >= 0) return "한진택배";
  if (s.indexOf("우체국") >= 0) return "우체국";
  if (s.indexOf("대신") >= 0) return "대신택배";
  if (s.indexOf("CJ") >= 0 || s.indexOf("대한통운") >= 0) return "CJ대한통운";
  // 합포장·1주출고는 우리 자사출고(롯데) 계열이다
  if (s === "롯데" || s === "합포장" || s === "1주출고" || s.indexOf("롯데") >= 0) {
    return "롯데택배";
  }
  return "";
}

/** 출처가 "업체가 자기 택배사로 보냈다" 를 뜻하는가 */
function _pep_isPartnerShipSource_(src) {
  var s = String(src || "");
  if (!s) return false;
  return s.indexOf("대리판매") >= 0 || s.indexOf("대리공급") >= 0;
}

// ═══════════════════════════════════════════
//  품목코드 → 출고지 → 택배사
//
//  출고지는 이카운트 CLASS_CD2(품목그룹2) 를 상품정보 B열에 내려받은 값이다
//  (`moveToEcount.gs` 동기화매핑: CLASS_CD2 → B).
//
//    · 평택 계열 (평택 / 평택A-1 …) → 우리 창고에서 나간다 → 롯데택배
//    · 대리발송                     → 대리공급업체가 자기 택배사로 보낸다
//    · 그 외 (일산 등)              → 모른다. 빈칸으로 둔다.
//
//  출고지가 접두보다 낫다. 접두는 「누구 상품인지」만 알려주므로 우리가 그
//  업체 상품을 자사출고하면 틀린 답을 준다. 출고지는 「어디서 나가는지」다.
// ═══════════════════════════════════════════

var _PEP_INFO_TAB_NAME_ = "상품정보";
var _PEP_INFO_HEADER_ROW_ = 4; // 4행=헤더, 6행~=데이터
var _PEP_INFO_DATA_ROW_ = 6;
var _pep_shipOriginMem_ = null;

/** 상품정보 탭 → { 품목코드: 출고지 }. 실행 1회만 읽는다 */
function _pep_loadItemShipOriginIndex_(refresh) {
  if (!refresh && _pep_shipOriginMem_) return _pep_shipOriginMem_;

  var idx = { map: {}, rows: 0, error: "" };
  try {
    var infoId = typeof _PT !== "undefined" && _PT.INFO_SS_ID ? _PT.INFO_SS_ID : "";
    var ss = infoId ? SpreadsheetApp.openById(infoId) : SpreadsheetApp.getActiveSpreadsheet();
    var tab = ss.getSheetByName(_PEP_INFO_TAB_NAME_);
    if (!tab || tab.getLastRow() < _PEP_INFO_DATA_ROW_) {
      idx.error = "'" + _PEP_INFO_TAB_NAME_ + "' 탭 없음/비어있음";
      _pep_shipOriginMem_ = idx;
      return idx;
    }

    var lc = tab.getLastColumn();
    var hdr = tab.getRange(_PEP_INFO_HEADER_ROW_, 1, 1, lc).getValues()[0];
    var codeCol = -1, originCol = -1;
    for (var c = 0; c < hdr.length; c++) {
      var h = String(hdr[c] || "").replace(/\s/g, "");
      if (!h) continue;
      if (codeCol < 0 && /이카운트코드|품목코드|물품코드|상품코드/.test(h)) codeCol = c;
      if (originCol < 0 && /^출고지/.test(h)) originCol = c;
    }
    if (codeCol < 0 || originCol < 0) {
      idx.error = "헤더 못 찾음 (품목코드=" + codeCol + ", 출고지=" + originCol + ")";
      _pep_shipOriginMem_ = idx;
      return idx;
    }

    // 필요한 두 열까지만 읽는다. 상품정보는 40열 넘게 넓어서 전폭을 읽으면
    // 마감 한 번에 수 초가 그냥 날아간다 (품목코드 E, 출고지 B 로 서로 가깝다).
    var lr = tab.getLastRow();
    var readCols = Math.max(codeCol, originCol) + 1;
    var data = tab.getRange(_PEP_INFO_DATA_ROW_, 1, lr - _PEP_INFO_DATA_ROW_ + 1, readCols)
      .getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var code = String(data[i][codeCol] || "").trim().toUpperCase();
      if (!code) continue;
      var origin = String(data[i][originCol] || "").trim();
      if (!origin) continue;
      idx.map[code] = origin;
      idx.rows++;
    }
  } catch (e) {
    idx.error = String(e.message || e);
    Logger.log("[SHIP_ORIGIN] 상품정보 읽기 실패: " + idx.error);
  }
  _pep_shipOriginMem_ = idx;
  return idx;
}

/** 출고지 문자열 → 자사출고 여부 (평택 계열) */
function _pep_isOwnWarehouseOrigin_(origin) {
  return /평택/.test(String(origin || ""));
}

/** 출고지 문자열 → 대리공급업체 출고 여부 */
function _pep_isProxyShipOrigin_(origin) {
  return /대리발송|대리공급/.test(String(origin || ""));
}

/**
 * 이카운트 품목코드 접두 → 업체 택배사. (예: `HR1234` → HR → 로젠택배)
 * 표에 없으면 빈 문자열. 억지로 추측하지 않는다.
 */
function _pep_carrierFromItemCodePrefix_(code) {
  var raw = String(code == null ? "" : code).trim().toUpperCase();
  if (!raw) return "";
  // 앞쪽 영문 연속만 접두로 본다 — 숫자·하이픈이 섞인 코드(HR1234, TY-100) 대응
  var m = raw.match(/^([A-Z]{2,})/);
  if (!m) return "";
  var head = m[1];
  var tbl = _pep_loadVendorCarrierTable_(false);

  // 두 글자 접두가 표준이다. 세 글자 이상이면 앞 두 글자도 같이 본다.
  var cands = head.length === 2 ? [head] : [head, head.substring(0, 2)];
  for (var i = 0; i < cands.length; i++) {
    var pfx = typeof _pep_resolvePrefixAlias_ === "function"
      ? _pep_resolvePrefixAlias_(cands[i]) : cands[i];
    if (tbl.byPfx[pfx]) return tbl.byPfx[pfx];
    if (_PEP_VENDOR_CARRIER_[pfx]) return _PEP_VENDOR_CARRIER_[pfx];
  }
  return "";
}

/**
 * 품목코드 → 택배사. 출고지를 먼저 보고, 그것이 답을 주지 않을 때만 접두를 본다.
 *
 * @param {string} code 이카운트 품목코드
 * @param {string=} source 출처 — 출고지를 모를 때 접두를 써도 되는지 판단용
 * @return {{carrier: string, via: string}} via 는 진단 표시용
 */
function _pep_carrierFromItemCode_(code, source) {
  var raw = String(code == null ? "" : code).trim().toUpperCase();
  if (!raw) return { carrier: "", via: "" };

  var origin = _pep_loadItemShipOriginIndex_(false).map[raw] || "";

  // 평택에서 나가면 우리가 보낸 것이다 — 무조건 롯데
  if (_pep_isOwnWarehouseOrigin_(origin)) {
    return { carrier: "롯데택배", via: "출고지(" + origin + ")" };
  }
  // 대리발송이면 업체가 자기 택배사로 보낸다 — 접두로 업체를 짚는다
  if (_pep_isProxyShipOrigin_(origin)) {
    var byPfx = _pep_carrierFromItemCodePrefix_(raw);
    if (byPfx) return { carrier: byPfx, via: "출고지(대리발송)+접두" };
    return { carrier: "", via: "" }; // 업체를 못 짚었다 — 추측하지 않는다
  }

  // 출고지를 못 읽었다(미등록·일산 등). 출처가 업체 출고라고 말해 줄 때만 접두를 쓴다.
  // 자사출고 건에 접두를 쓰면 그 업체 택배사로 잘못 나간다.
  if (_pep_isPartnerShipSource_(source)) {
    var pfxOnly = _pep_carrierFromItemCodePrefix_(raw);
    if (pfxOnly) return { carrier: pfxOnly, via: "접두(출고지없음)" };
  }
  return { carrier: "", via: "" };
}

/**
 * 일일마감 한 행의 택배사.
 *
 * 순서가 곧 신뢰도다.
 *   ① 송장맵 엔트리가 실어 온 값 — 업체 출고(허브·임시기록·전용마감)는
 *      발주업체를 알고 `업체_택배사` 표에서 뜬 것이므로 가장 정확하다.
 *   ② 출처 — 롯데·로젠처럼 출처가 곧 택배사인 경우.
 *   ③ 업체명 — ①이 비었지만 업체를 아는 경우.
 *   ④ 품목코드 → 출고지 (평택=롯데 / 대리발송=업체 접두) → 접두 폴백.
 * 넷이 다 비면 빈칸으로 둔다. 송장번호 자릿수 추론은 하지 않는다
 * (CJ 와 한진이 같은 4번대로 시작해 서로 뒤바뀐다).
 *
 * @param {?Object} invInfo 송장맵 엔트리 {inv, source, carrier, lag}
 * @param {string} source   확정된 출처 (합포장 승격 등이 반영된 값)
 * @param {string=} vendor  발주업체명
 * @param {string=} itemCode 이카운트 품목코드 (④ 용)
 * @param {?Object=} outVia via 를 받아 갈 객체 (진단용, 선택)
 */
function _pep_carrierForArchiveRow_(invInfo, source, vendor, itemCode, outVia) {
  function done(c, via) {
    var out = _pep_carrierWithLag_(c, invInfo && invInfo.lag);
    if (outVia) outVia.via = out ? via : "";
    return out;
  }
  if (invInfo && invInfo.carrier) return done(invInfo.carrier, "송장맵");
  var fromSrc = _pep_carrierFromSource_(source);
  if (fromSrc) return done(fromSrc, "출처");
  if (vendor) {
    var byVendor = _pep_carrierForVendor_(vendor);
    if (byVendor) return done(byVendor, "업체명");
  }
  if (itemCode) {
    var byCode = _pep_carrierFromItemCode_(itemCode, source);
    if (byCode.carrier) return done(byCode.carrier, byCode.via);
  }
  return done("", "");
}

/** 업체명 또는 접두 → 택배사명. 모르면 빈 문자열 */
function _pep_carrierForVendor_(vendorName) {
  var tbl = _pep_loadVendorCarrierTable_(false);

  var pfx =
    typeof _pep_normalizeTempVendorPrefix_ === "function"
      ? _pep_normalizeTempVendorPrefix_(vendorName)
      : "";
  if (pfx && typeof _pep_resolvePrefixAlias_ === "function") {
    pfx = _pep_resolvePrefixAlias_(pfx);
  }
  if (pfx && tbl.byPfx[pfx]) return tbl.byPfx[pfx];
  if (pfx && _PEP_VENDOR_CARRIER_[pfx]) return _PEP_VENDOR_CARRIER_[pfx];

  var compact = String(vendorName == null ? "" : vendorName)
    .replace(/\s/g, "")
    .replace(/\[협력업체\]/g, "");
  if (!compact) return "";
  for (var lbl in tbl.byLabel) {
    if (tbl.byLabel.hasOwnProperty(lbl) && compact.indexOf(lbl) !== -1) {
      return tbl.byLabel[lbl];
    }
  }
  for (var k in _PEP_VENDOR_CARRIER_) {
    if (!_PEP_VENDOR_CARRIER_.hasOwnProperty(k)) continue;
    var lab = String(_PEP_VENDOR_LABELS_[k] || "").replace(/\s/g, "");
    if (lab && compact.indexOf(lab) !== -1) return _PEP_VENDOR_CARRIER_[k];
  }
  return "";
}

/** 택배사 → 사방넷 대량등록 코드. 미지정이면 빈 문자열 */
function _pep_sabangCodeForCarrier_(carrier) {
  var c = String(carrier == null ? "" : carrier).replace(/\(\d{1,2}\)\s*$/, "").trim();
  if (!c) return "";
  var tbl = _pep_loadVendorCarrierTable_(false);
  if (tbl.code[c]) return tbl.code[c];
  return String(_PEP_CARRIER_SABANG_CODE_[c] || "").trim();
}

/** 「업체_택배사」탭 확보. 비어 있으면 코드 상수로 초기 1회 채운다 */
function _pep_ensureVendorCarrierTab_() {
  var infoId = typeof _PT !== "undefined" && _PT.INFO_SS_ID ? _PT.INFO_SS_ID : "";
  if (!infoId) throw new Error("상품정보 시트 ID 없음 (_PT.INFO_SS_ID)");
  var ss = SpreadsheetApp.openById(infoId);
  var tab = ss.getSheetByName(_PEP_VC_TAB_NAME_);
  var created = false;
  if (!tab) {
    tab = ss.insertSheet(_PEP_VC_TAB_NAME_);
    created = true;
  }

  if (tab.getLastRow() < 1 || !String(tab.getRange(1, 1).getDisplayValue()).trim()) {
    tab
      .getRange(1, 1, 1, _PEP_VC_HEADERS_.length)
      .setValues([_PEP_VC_HEADERS_])
      .setFontWeight("bold")
      .setBackground("#E8EAED");
    tab.setFrozenRows(1);
    tab.setColumnWidth(1, 60);
    tab.setColumnWidth(2, 140);
    tab.setColumnWidth(3, 110);
    tab.setColumnWidth(4, 100);
    tab.setColumnWidth(5, 320);
    tab
      .getRange(1, 3)
      .setNote("택배사명은 표시·조회에 그대로 쓰인다. 예: 한진택배, 롯데택배, 로젠택배, CJ대한통운, 대신택배");
    tab
      .getRange(1, 4)
      .setNote(
        "사방넷 「관리 > 사방넷 풀필먼트 설정 > 출고 > 사용 택배사 등록」의 코드.\n" +
          "택배사 단위 값이므로 같은 택배사 행끼리 같아야 한다.\n" +
          "비어 있으면 그 업체 행은 사방넷 대량등록에서 제외되고 '택배사코드 미지정'으로 보고된다.",
      );
    tab.getRange(1, 4).setNumberFormat("@"); // 001 앞 0 보존
  }

  var seeded = 0;
  if (tab.getLastRow() < 2) {
    var rows = [];
    for (var pfx in _PEP_VENDOR_CARRIER_) {
      if (!_PEP_VENDOR_CARRIER_.hasOwnProperty(pfx)) continue;
      var carrier = _PEP_VENDOR_CARRIER_[pfx];
      rows.push([
        pfx,
        _PEP_VENDOR_LABELS_[pfx] || "",
        carrier,
        String(_PEP_CARRIER_SABANG_CODE_[carrier] || ""),
        "",
      ]);
    }
    rows.sort(function (a, b) {
      return String(a[1]).localeCompare(String(b[1]), "ko");
    });
    if (rows.length) {
      tab.getRange(2, 1, rows.length, 5).setNumberFormat("@").setValues(rows);
      seeded = rows.length;
    }
  }

  _pep_vcMem_ = null; // 다음 읽기에서 새로 로드
  return { tab: tab, created: created, seeded: seeded };
}

/** 메뉴: 업체 택배사 표 생성/점검 */
function partnerEnsureVendorCarrierTable() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var lines = [];
  try {
    var res = _pep_ensureVendorCarrierTab_();
    var tbl = _pep_loadVendorCarrierTable_(true);

    lines.push("탭: 상품정보「" + _PEP_VC_TAB_NAME_ + "」");
    lines.push(
      res.created ? "· 탭을 새로 만들었습니다." : "· 기존 탭을 사용합니다.",
    );
    if (res.seeded) lines.push("· 코드 기본값 " + res.seeded + "행을 채웠습니다.");
    lines.push("· 등록 업체: " + tbl.rows + "행");

    // 택배사별 집계 + 코드 미지정
    var byCarrier = {};
    for (var p in tbl.byPfx) {
      if (tbl.byPfx.hasOwnProperty(p)) {
        byCarrier[tbl.byPfx[p]] = (byCarrier[tbl.byPfx[p]] || 0) + 1;
      }
    }
    lines.push("");
    lines.push("── 택배사별 ──");
    var noCode = [];
    for (var c in byCarrier) {
      if (!byCarrier.hasOwnProperty(c)) continue;
      var code = _pep_sabangCodeForCarrier_(c);
      lines.push("· " + c + ": " + byCarrier[c] + "개 업체 / 사방넷코드 " + (code || "미지정"));
      if (!code) noCode.push(c);
    }

    if (noCode.length) {
      lines.push("");
      lines.push("⚠ 사방넷코드 미지정: " + noCode.join(", "));
      lines.push(
        "해당 업체 송장은 사방넷 대량등록에서 제외됩니다. D열에 코드를 입력하세요.",
      );
    }
    if (tbl.conflicts.length) {
      lines.push("");
      lines.push("⛔ 같은 택배사에 코드가 서로 다릅니다:");
      for (var q = 0; q < tbl.conflicts.length; q++) lines.push("· " + tbl.conflicts[q]);
    }
    if (!noCode.length && !tbl.conflicts.length) {
      lines.push("");
      lines.push("✅ 코드 누락·충돌 없음");
    }

    lines.push("");
    lines.push("이 표는 CS앱도 같이 읽습니다. 신규 업체는 여기에 행을 추가하면 됩니다.");
  } catch (eMain) {
    lines.push("오류: " + String(eMain.message || eMain));
  }

  var msg = lines.join("\n");
  if (ui) ui.alert("업체 택배사 표", msg, ui.ButtonSet.OK);
  Logger.log("[VENDOR_CARRIER] " + msg);
}

/**
 * 일일마감 택배사 채움률 점검 (읽기 전용)
 *
 * 웹앱의 배송조회 링크는 일일마감 택배사 열을 근거로 삼는다. 그 열이 비면
 * 링크가 네이버 검색으로 떨어지므로, 어디가 비었는지 여기서 본다.
 *
 * 택배사가 비는 원인은 둘 중 하나다.
 *   ① 택배사 열이 아직 없는 옛 마감 파일 — 도입 전 날짜다. 정상.
 *   ② 열은 있는데 값이 빈 행 — 업체가 `업체_택배사` 표에 없다. 표에 추가한다.
 */
function partnerDiagnoseArchiveCarrier() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var days = _PEP_BACKFILL_DAYS_ || 7;
  var lines = [];
  lines.push("최근 " + days + "일 일일마감의 택배사 열을 봅니다.");
  lines.push("");

  var totalRows = 0, totalFilled = 0, noColumnFiles = 0, checkedFiles = 0;
  var byCarrier = {};
  var emptyByVendor = {};

  for (var d = 0; d <= days; d++) {
    var dt = new Date();
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
    var archSs;
    try { archSs = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")"); }
    catch (eF) { continue; }
    if (!archSs) continue;
    var tab = archSs.getSheetByName("일일마감") || archSs.getSheets()[0];
    if (!tab || tab.getLastRow() < 2) continue;
    checkedFiles++;

    var all = tab.getRange(1, 1, tab.getLastRow(), Math.max(tab.getLastColumn(), 2)).getDisplayValues();
    var cols = _pep_mapArchiveMatchCols_(all[0]);
    if (cols.carrier < 0) {
      noColumnFiles++;
      lines.push("· " + dateStr + ": 택배사 열 없음 (도입 전 파일)");
      continue;
    }

    var rows = 0, filled = 0;
    for (var r = 1; r < all.length; r++) {
      if (String(all[r][0] || "").indexOf("합계") !== -1) continue;
      var src = String(all[r][cols.src] || "").trim();
      // 송장이 없는 행은 조회할 것도 없으므로 분모에서 뺀다
      if (src === "미매칭" || src === "기타") continue;
      if (!_pep_normInvoiceNo_(all[r][cols.inv])) continue;
      rows++;
      var cr = String(all[r][cols.carrier] || "").trim();
      if (cr) {
        filled++;
        byCarrier[cr] = (byCarrier[cr] || 0) + 1;
      } else {
        var v = cols.jShop >= 0 ? String(all[r][cols.jShop] || "").trim() : "";
        var key = (src || "출처없음") + " / " + (v || "업체없음");
        emptyByVendor[key] = (emptyByVendor[key] || 0) + 1;
      }
    }
    totalRows += rows;
    totalFilled += filled;
    var pct = rows ? Math.round((filled / rows) * 100) : 0;
    lines.push("· " + dateStr + ": " + filled + "/" + rows + "건 (" + pct + "%)");
  }

  if (!checkedFiles) {
    lines.push("(최근 " + days + "일 일일마감 파일이 없습니다)");
  } else {
    var totalPct = totalRows ? Math.round((totalFilled / totalRows) * 100) : 0;
    lines.push("");
    lines.push("합계: " + totalFilled + "/" + totalRows + "건 (" + totalPct + "%)");

    var carrierNames = [];
    for (var c2 in byCarrier) if (byCarrier.hasOwnProperty(c2)) carrierNames.push(c2);
    if (carrierNames.length) {
      carrierNames.sort(function (a, b) { return byCarrier[b] - byCarrier[a]; });
      lines.push("");
      lines.push("── 택배사별 ──");
      for (var ci = 0; ci < carrierNames.length; ci++) {
        lines.push("· " + carrierNames[ci] + ": " + byCarrier[carrierNames[ci]] + "건");
      }
    }

    var emptyKeys = [];
    for (var k in emptyByVendor) if (emptyByVendor.hasOwnProperty(k)) emptyKeys.push(k);
    if (emptyKeys.length) {
      emptyKeys.sort(function (a, b) { return emptyByVendor[b] - emptyByVendor[a]; });
      lines.push("");
      lines.push("── 택배사 빈 건 (출처 / 업체) ──");
      for (var ei = 0; ei < Math.min(emptyKeys.length, 15); ei++) {
        lines.push("· " + emptyKeys[ei] + ": " + emptyByVendor[emptyKeys[ei]] + "건");
      }
      if (emptyKeys.length > 15) lines.push("· … 외 " + (emptyKeys.length - 15) + "종");
      lines.push("");
      lines.push("이 건들은 웹앱에서 네이버 검색 링크로 나갑니다.");
      lines.push("위 '🚚 업체 택배사 표 생성/점검' 에서 해당 업체 행을 추가하세요.");
      lines.push("추가 후 다음 일일마감부터 반영됩니다.");
    } else if (totalRows) {
      lines.push("");
      lines.push("✅ 송장 있는 행은 모두 택배사가 채워져 있습니다.");
    }
  }

  if (noColumnFiles) {
    lines.push("");
    lines.push("※ 택배사 열이 없는 " + noColumnFiles + "개 파일은 도입 전 날짜입니다.");
    lines.push("  그 날짜는 웹앱이 종전처럼 출처로 택배사를 추론합니다.");
  }

  var msg2 = lines.join("\n");
  if (ui) ui.alert("일일마감 택배사 채움률", msg2, ui.ButtonSet.OK);
  Logger.log("[ARCHIVE_CARRIER] " + msg2);
}

/**
 * 지난 일일마감에 택배사 소급 채움 (쓰기)
 *
 * 도입 전 파일에는 택배사 열이 아예 없다. 열을 운송장번호 앞에 끼워 넣고
 * **출처와 출고지만으로** 채운다. 지난 파일에는 송장맵이 없으므로
 * 발주업체를 알 길이 없고, 판매처 열에는 쿠팡·네이버가 들어 있다.
 *
 *   · 출처가 롯데·로젠·한진 → 그것이 곧 택배사다
 *   · 출고지가 평택 계열     → 롯데택배
 *   · 출고지가 대리발송      → 품목코드 접두로 업체 택배사
 *
 * 근거가 없으면 **빈칸으로 남긴다.** 웹앱은 빈칸이면 종전처럼 출처로 추론한다.
 * 이미 값이 있는 칸은 건드리지 않는다 (마감 시점 판정이 더 정확하다).
 */
function partnerBackfillArchiveCarrier() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var days = 14;
  if (ui) {
    var resp = ui.prompt(
      "지난 일일마감 택배사 채움",
      "며칠 전까지 볼까요? (기본 14, 최대 90)\n\n" +
      "· 택배사 열이 없는 파일은 운송장번호 앞에 열을 끼워 넣습니다\n" +
      "· 이미 채워진 칸은 건드리지 않습니다\n" +
      "· 근거(출처·출고지)가 없는 건은 빈칸으로 남습니다",
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var typed = parseInt(String(resp.getResponseText() || "").trim(), 10);
    if (!isNaN(typed) && typed > 0) days = Math.min(typed, 90);
  }

  // 출고지 인덱스를 먼저 확인한다. 이게 비면 소급 채움의 절반이 날아간다.
  var originIdx = _pep_loadItemShipOriginIndex_(true);
  if (originIdx.error || !originIdx.rows) {
    var warn = "상품정보 출고지를 읽지 못했습니다.\n\n" +
      (originIdx.error || "출고지 값이 있는 행이 0건") + "\n\n" +
      "출고지 없이도 출처(롯데·로젠 등)만으로는 채울 수 있지만,\n" +
      "대리판매·대리공급 건은 대부분 빈칸으로 남습니다. 계속할까요?";
    if (ui) {
      var go = ui.alert("출고지 못 읽음", warn, ui.ButtonSet.YES_NO);
      if (go !== ui.Button.YES) return;
    } else {
      Logger.log("[CARRIER_BACKFILL] " + warn);
    }
  }

  var lines = [];
  lines.push("최근 " + days + "일 일일마감에 택배사를 채웁니다.");
  lines.push("출고지 마스터: " + originIdx.rows + "품목" +
    (originIdx.error ? " (오류: " + originIdx.error + ")" : ""));
  lines.push("");

  var files = 0, inserted = 0, totalFilled = 0, totalBlank = 0, errs = [];
  var viaTally = {};

  for (var d = 0; d <= days; d++) {
    var dt = new Date();
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");

    try {
      var archSs = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
      if (!archSs) continue;
      var tab = archSs.getSheetByName("일일마감") || archSs.getSheets()[0];
      if (!tab || tab.getLastRow() < 2) continue;
      files++;

      var hdr = tab.getRange(1, 1, 1, Math.max(tab.getLastColumn(), 2)).getDisplayValues()[0];
      var carrierIdx = _pep_findCarrierIdx_(hdr);
      if (carrierIdx < 0) {
        carrierIdx = _pep_insertCarrierColumnInto_(tab, hdr);
        if (carrierIdx < 0) {
          lines.push("· " + dateStr + ": 운송장번호 열을 못 찾아 건너뜀");
          continue;
        }
        inserted++;
        hdr = tab.getRange(1, 1, 1, tab.getLastColumn()).getDisplayValues()[0];
      }

      var lr = tab.getLastRow();
      var lc = tab.getLastColumn();
      var all = tab.getRange(1, 1, lr, lc).getDisplayValues();
      var cols = _pep_mapArchiveMatchCols_(all[0]);
      if (cols.carrier < 0) { lines.push("· " + dateStr + ": 택배사 열 인식 실패"); continue; }

      // 택배사 열만 통째로 다시 쓴다. 다른 열을 건드리지 않는 것이 안전하다.
      var colVals = [];
      var filled = 0, blank = 0, changed = 0;
      for (var r = 1; r < all.length; r++) {
        var cur = String(all[r][cols.carrier] || "").trim();
        colVals.push([cur]);

        if (String(all[r][0] || "").indexOf("합계") !== -1) continue;
        if (cur) { filled++; continue; }

        var src = String(all[r][cols.src] || "").trim();
        if (src === "미매칭" || src === "기타") continue;
        if (!_pep_normInvoiceNo_(all[r][cols.inv])) continue;

        var code = cols.code >= 0 ? all[r][cols.code] : "";
        var vendor = cols.jShop >= 0 ? all[r][cols.jShop] : "";
        var box = {};
        var got = _pep_carrierForArchiveRow_(null, src, vendor, code, box);
        if (got) {
          colVals[colVals.length - 1] = [got];
          changed++;
          filled++;
          viaTally[box.via] = (viaTally[box.via] || 0) + 1;
        } else {
          blank++;
        }
      }

      if (changed > 0) {
        tab.getRange(2, cols.carrier + 1, colVals.length, 1).setValues(colVals);
        SpreadsheetApp.flush();
      }
      totalFilled += changed;
      totalBlank += blank;
      lines.push("· " + dateStr + ": +" + changed + "건 채움" +
        (blank ? " / " + blank + "건 근거없음" : "") +
        (filled - changed ? " (기존 " + (filled - changed) + "건 유지)" : ""));
    } catch (eDay) {
      errs.push(dateStr + ": " + String(eDay.message || eDay));
    }
  }

  lines.push("");
  lines.push("파일 " + files + "개 / 열 삽입 " + inserted + "개");
  lines.push("채움 " + totalFilled + "건, 근거없음 " + totalBlank + "건");

  var viaKeys = [];
  for (var vk in viaTally) if (viaTally.hasOwnProperty(vk)) viaKeys.push(vk);
  if (viaKeys.length) {
    viaKeys.sort(function (a, b) { return viaTally[b] - viaTally[a]; });
    lines.push("");
    lines.push("── 판정 근거 ──");
    for (var vi = 0; vi < viaKeys.length; vi++) {
      lines.push("· " + viaKeys[vi] + ": " + viaTally[viaKeys[vi]] + "건");
    }
  }

  if (totalBlank) {
    lines.push("");
    lines.push("근거없음 " + totalBlank + "건은 출처도 출고지도 답을 주지 않은 건입니다.");
    lines.push("빈칸이면 웹앱이 종전처럼 출처로 추론합니다 (잘못 채우지 않습니다).");
    lines.push("어느 업체인지는 '📦 일일마감 택배사 채움률 점검' 에서 봅니다.");
  }
  if (errs.length) {
    lines.push("");
    lines.push("── 오류 ──");
    for (var ei2 = 0; ei2 < Math.min(errs.length, 8); ei2++) lines.push("· " + errs[ei2]);
  }

  var msg3 = lines.join("\n");
  if (ui) ui.alert("지난 일일마감 택배사 채움", msg3, ui.ButtonSet.OK);
  Logger.log("[CARRIER_BACKFILL] " + msg3);
}

/**
 * 출고지 마스터 점검 (읽기 전용)
 *
 * 택배사 판정의 ④단계가 이 표에 걸려 있다. 상품정보 B열(출고지)이 비면
 * 대리판매·대리공급 건이 통째로 빈칸이 된다.
 */
function partnerDiagnoseShipOrigin() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var idx = _pep_loadItemShipOriginIndex_(true);
  var lines = [];
  lines.push("상품정보 '출고지' 열(이카운트 CLASS_CD2)을 봅니다.");
  lines.push("");

  if (idx.error) {
    lines.push("❌ " + idx.error);
    lines.push("");
    lines.push("상품정보 탭 4행 헤더에 '품목코드'(또는 이카운트코드) 와");
    lines.push("'출고지' 가 있어야 합니다. 6행부터 품목 데이터로 읽습니다.");
  } else {
    var buckets = { own: 0, proxy: 0, other: 0 };
    var otherVals = {};
    var pfxMissing = {};
    for (var code in idx.map) {
      if (!idx.map.hasOwnProperty(code)) continue;
      var o = idx.map[code];
      if (_pep_isOwnWarehouseOrigin_(o)) buckets.own++;
      else if (_pep_isProxyShipOrigin_(o)) {
        buckets.proxy++;
        if (!_pep_carrierFromItemCodePrefix_(code)) {
          var head = String(code).match(/^([A-Z]{2,})/);
          var key = head ? head[1].substring(0, 2) : "(접두없음)";
          pfxMissing[key] = (pfxMissing[key] || 0) + 1;
        }
      } else {
        buckets.other++;
        otherVals[o] = (otherVals[o] || 0) + 1;
      }
    }

    lines.push("읽은 품목: " + idx.rows + "건");
    lines.push("· 평택 계열 (→ 롯데택배): " + buckets.own + "건");
    lines.push("· 대리발송 (→ 업체 택배사): " + buckets.proxy + "건");
    lines.push("· 그 외: " + buckets.other + "건");

    var ov = [];
    for (var k in otherVals) if (otherVals.hasOwnProperty(k)) ov.push(k);
    if (ov.length) {
      ov.sort(function (a, b) { return otherVals[b] - otherVals[a]; });
      lines.push("");
      lines.push("── '그 외' 출고지 값 ──");
      for (var oi = 0; oi < Math.min(ov.length, 10); oi++) {
        lines.push("· " + ov[oi] + ": " + otherVals[ov[oi]] + "건");
      }
      lines.push("");
      lines.push("이 값들은 택배사를 판정하지 않습니다 (빈칸으로 둡니다).");
      lines.push("어느 택배사인지 정해지면 알려주세요.");
    }

    var pm = [];
    for (var k2 in pfxMissing) if (pfxMissing.hasOwnProperty(k2)) pm.push(k2);
    if (pm.length) {
      pm.sort(function (a, b) { return pfxMissing[b] - pfxMissing[a]; });
      lines.push("");
      lines.push("── 대리발송인데 접두가 '업체_택배사' 표에 없음 ──");
      for (var pi = 0; pi < Math.min(pm.length, 15); pi++) {
        lines.push("· " + pm[pi] + ": " + pfxMissing[pm[pi]] + "품목");
      }
      lines.push("");
      lines.push("이 접두 품목은 택배사가 빈칸으로 남습니다.");
      lines.push("위 '🚚 업체 택배사 표 생성/점검' 에서 행을 추가하세요.");
    } else if (buckets.proxy) {
      lines.push("");
      lines.push("✅ 대리발송 품목의 접두는 모두 표에 있습니다.");
    }
  }

  var msg4 = lines.join("\n");
  if (ui) ui.alert("출고지 마스터 점검", msg4, ui.ButtonSet.OK);
  Logger.log("[SHIP_ORIGIN_DIAG] " + msg4);
}

// ─────────────────────────────────────────────────────
//  보조 접두 별칭 — 한 업체가 이카운트코드 접두를 2개 이상 쓰는 경우
//  key: 보조 접두, value: 대표 접두
//  대표 접두의 전용양식·Push 매핑·택배사 코드를 그대로 따른다.
//  _PEP_VENDOR_LABELS_ / _PEP_VENDOR_DIRECT_MAP_ 에는 대표 접두만 등록한다.
//  (업체명 역매핑이 1:1 전제이므로 보조 접두를 LABELS에 넣으면 파일 매핑이 덮어써짐)
// ─────────────────────────────────────────────────────
var _PEP_VENDOR_PREFIX_ALIAS_ = {
  JH: "JT", // 준테크 보조 코드 (★ 2026-08-25)
  BF: "JT", // 준테크 보조 코드 (★ 2026-08-25)
  NS: "JT", // 준테크 보조 코드 (★ 2026-08-27)
};

/** 보조 접두 → 대표 접두. 별칭이 없으면 대문자 정규화만 하여 반환 */
function _pep_resolvePrefixAlias_(pfx) {
  var up = String(pfx == null ? "" : pfx).trim().toUpperCase();
  if (!up) return "";
  try {
    if (
      typeof _PEP_VENDOR_PREFIX_ALIAS_ !== "undefined" &&
      _PEP_VENDOR_PREFIX_ALIAS_[up]
    ) {
      return _PEP_VENDOR_PREFIX_ALIAS_[up];
    }
  } catch (e) {}
  return up;
}

/** 대표 접두 → 해당 대표에 묶인 보조 접두 목록 (진단·표시용) */
function _pep_aliasPrefixesFor_(primary) {
  var out = [];
  var up = String(primary == null ? "" : primary).trim().toUpperCase();
  if (!up) return out;
  try {
    for (var k in _PEP_VENDOR_PREFIX_ALIAS_) {
      if (!_PEP_VENDOR_PREFIX_ALIAS_.hasOwnProperty(k)) continue;
      if (_PEP_VENDOR_PREFIX_ALIAS_[k] === up) out.push(k);
    }
  } catch (e) {}
  return out.sort();
}

// ─────────────────────────────────────────────────────
//  업체별 소스→전용양식 열 매핑 (orderSyncManager.gs VENDOR_DIRECT_COLUMN_MAP_ 이식)
//  directMap: Push 시 소스 행 → 전용양식 행 변환에 사용
// ─────────────────────────────────────────────────────
var _PEP_VENDOR_DIRECT_MAP_ = {
  HR: {
    // 뉴파츠 — A=송장번호, B=이슈(공통) + C~AF=30열 이카운트 구매발주 업로드 = 총 32열
    // A(0)=송장번호, B(1)=적요,
    // C(2)=일자, D(3)=순번, E(4)=거래처코드, F(5)=거래처명, G(6)=담당자,
    // H(7)=출하창고, I(8)=거래유형, J(9)=통화, K(10)=환율, L(11)=참조,
    // M(12)=결제조건, N(13)=유효기간, O(14)=납기일자, P(15)=검색창내용,
    // Q(16)=배송방식, R(17)=수령인, S(18)=수령인연락처, T(19)=배송지주소,
    // U(20)=적요(배송메시지), V(21)=품목코드, W(22)=품목명, X(23)=규격,
    // Y(24)=수량, Z(25)=단가, AA(26)=금액1, AB(27)=외화금액,
    // AC(28)=공급가액, AD(29)=부가세, AE(30)=납기일자, AF(31)=적요
    totalCols: 32,
    seqCol: 3,
    seqMinStart: 300, // D열 순번 300번부터 시작
    fixedValues: { 4: "5858800931", 5: "주식회사 팩투유", 16: "택배,용달" },
    phoneTargetCols: [18], // S(수령인연락처)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 17, label: "M(거래처명)→R(수령인)" },
      { sourceCol: 8, targetCol: 18, label: "I(모바일)→S(수령인연락처)" },
      { sourceCol: 9, targetCol: 19, label: "J(주소1)→T(배송지주소)" },
      { sourceCol: 10, targetCol: 20, label: "K(배송메세지)→U(적요)" },
      { sourceCol: 6, targetCol: 24, label: "G(수량)→Y(수량)" },
    ],
    vendorSkuCol: 21,
    vendorNameCol: 22,
  },
  NK: {
    // 냅킨코리아
    totalCols: 13,
    phoneTargetCols: [3, 12], // D(전화번호), M(전화)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(주소)" },
      { sourceCol: 6, targetCol: 8, label: "G(수량)→I(수량)" },
      { sourceCol: 10, targetCol: 9, label: "K(배송메세지)→J(배송메세지)" },
      { sourceCol: 16, targetCol: 10, label: "Q(보내는분)→K(보내는사람)" },
      { sourceCol: 15, targetCol: 11, label: "P(확정단가)→L(정산단가)" },
      { sourceCol: 17, targetCol: 12, label: "R(보내는분전화)→M(전화)" },
    ],
    vendorNameCol: 7, // H열(상품명) — 별칭 테이블의 업체 품목명으로 덮어쓰기
  },
  GW: {
    // 그린우드
    totalCols: 20,
    seqCol: 2,
    dateCol: 3,
    phoneTargetCols: [8, 9, 18], // I(전화), J(모바일), S(보내는분전화)
    sourceToTarget: [
      { sourceCol: 4, targetCol: 5, label: "E(품목명)→F(품목명)" },
      { sourceCol: 5, targetCol: 6, label: "F(택배박스수량)→G(택배박스수량)" },
      { sourceCol: 6, targetCol: 7, label: "G(수량)→H(판매수량)" },
      { sourceCol: 7, targetCol: 8, label: "H(전화)→I(전화)" },
      { sourceCol: 8, targetCol: 9, label: "I(모바일)→J(모바일)" },
      { sourceCol: 9, targetCol: 10, label: "J(주소1)→K(주소1)" },
      { sourceCol: 10, targetCol: 11, label: "K(배송메세지)→L(배송메시지)" },
      { sourceCol: 12, targetCol: 13, label: "M(거래처명)→N(거래처명)" },
      { sourceCol: 16, targetCol: 17, label: "Q(보내는분)→R(보내는분)" },
      {
        sourceCol: 17,
        targetCol: 18,
        label: "R(보내는분전화)→S(보내는분전화)",
      },
      { sourceCol: 18, targetCol: 19, label: "S(보내는분주소)→T(보내는주소)" },
    ],
    vendorSkuCol: 4,
  },
  TY: {
    // 태양
    totalCols: 23,
    phoneTargetCols: [5, 22], // F(수하인번호), W(송하인번호)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(고객명)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(수하인주소)" },
      { sourceCol: 8, targetCol: 5, label: "I(모바일)→F(수하인번호)" },
      { sourceCol: 6, targetCol: 7, label: "G(수량)→H(박스수량)" },
      { sourceCol: 4, targetCol: 10, label: "E(품목명)→K(품목명)" },
      { sourceCol: 10, targetCol: 12, label: "K(배송메세지)→M(배송메세지)" },
      { sourceCol: 16, targetCol: 20, label: "Q(보내는분)→U(송하인명)" },
      { sourceCol: 18, targetCol: 21, label: "S(보내는분주소)→V(송하인주소)" },
      { sourceCol: 17, targetCol: 22, label: "R(보내는분전화)→W(송하인번호)" },
    ],
  },
  AJ: {
    // 아주팩
    totalCols: 12,
    phoneTargetCols: [3, 6], // D(보내는분전화번호), G(받는분전화번호)
    sourceToTarget: [
      { sourceCol: 16, targetCol: 2, label: "Q(보내는분)→C(보내는분성명)" },
      {
        sourceCol: 17,
        targetCol: 3,
        label: "R(보내는분전화)→D(보내는분전화번호)",
      },
      { sourceCol: 18, targetCol: 4, label: "S(보내는분주소)→E(보내는분주소)" },
      { sourceCol: 12, targetCol: 5, label: "M(거래처명)→F(받는분성명)" },
      { sourceCol: 8, targetCol: 6, label: "I(모바일)→G(받는분전화번호)" },
      { sourceCol: 9, targetCol: 7, label: "J(주소1)→H(받는분주소)" },
      { sourceCol: 4, targetCol: 8, label: "E(품목명)→I(품목명)" },
      { sourceCol: 6, targetCol: 9, label: "G(수량)→J(박스수량)" },
      { sourceCol: 10, targetCol: 11, label: "K(배송메세지)→L(배송메세지1)" },
    ],
  },
  BW: {
    // 부원 — 「부원택배 양식 (1).xlsx」+ 송장번호·이슈 (★ 2026-08-10, 18열)
    // A=송장번호 B=이슈 C=받는사람 D=전화번호 E=주소 F=(빈)
    // G=상품명 H=수량 I~L=B2750~E6500 M=배송메세지 N=운임구분 O=운임
    // P=보내는사람 Q=주소 R=전화
    totalCols: 18,
    phoneTargetCols: [3, 17], // D(전화번호), R(전화)
    vendorNameCol: 6, // G열(상품명)
    qtyExtract: { nameCol: 6, qtyCol: 7 }, // G=상품명, H=수량
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(주소)" },
      { sourceCol: 4, targetCol: 6, label: "E(품목명)→G(상품명)" },
      { sourceCol: 6, targetCol: 7, label: "G(수량)→H(수량)" },
      { sourceCol: 10, targetCol: 12, label: "K(배송메세지)→M(배송메세지)" },
      { sourceCol: 16, targetCol: 15, label: "Q(보내는분)→P(보내는사람)" },
      { sourceCol: 18, targetCol: 16, label: "S(보내는분주소)→Q(주소)" },
      { sourceCol: 17, targetCol: 17, label: "R(보내는분전화)→R(전화)" },
    ],
  },
  KR: {
    // 코라마
    totalCols: 13,
    phoneTargetCols: [4, 5, 11], // E(받으시는분전화), F(받는분핸드폰), L(보내시는분전화)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받으시는분)" },
      { sourceCol: 9, targetCol: 3, label: "J(주소1)→D(받는분총주소)" },
      { sourceCol: 8, targetCol: 4, label: "I(모바일)→E(받으시는분전화)" },
      { sourceCol: 8, targetCol: 5, label: "I(모바일)→F(받는분핸드폰)" },
      { sourceCol: 3, targetCol: 6, label: "D(품목코드)→G(품번)" },
      { sourceCol: 4, targetCol: 7, label: "E(품목명)→H(품목명)" },
      { sourceCol: 6, targetCol: 8, label: "G(수량)→I(수량)" },
      { sourceCol: 10, targetCol: 9, label: "K(배송메세지)→J(특기사항)" },
      { sourceCol: 16, targetCol: 10, label: "Q(보내는분)→K(보내시는분)" },
      {
        sourceCol: 17,
        targetCol: 11,
        label: "R(보내는분전화)→L(보내시는분전화)",
      },
    ],
  },
  HU: {
    // 후아코리아
    totalCols: 13,
    fixedValues: { 9: "신용" },
    phoneTargetCols: [4, 12], // E(휴대폰번호), M(보내는분전화번호)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는분)" },
      { sourceCol: 8, targetCol: 4, label: "I(모바일)→E(휴대폰번호)" },
      { sourceCol: 9, targetCol: 5, label: "J(주소1)→F(받는분주소)" },
      { sourceCol: 4, targetCol: 6, label: "E(품목명)→G(품목)" },
      { sourceCol: 6, targetCol: 8, label: "G(수량)→I(택배수량)" },
      { sourceCol: 13, targetCol: 10, label: "N(단품배송비)→K(운임)" },
      { sourceCol: 16, targetCol: 11, label: "Q(보내는분)→L(보내는분성명)" },
      {
        sourceCol: 17,
        targetCol: 12,
        label: "R(보내는분전화)→M(보내는분전화번호)",
      },
    ],
  },
  IW: {
    // 인터웍스
    totalCols: 13,
    // A(0): 송장번호, B(1): 적요 — 업체 입력
    // F(5)우편번호, H(7)박스타입: 비움
    phoneTargetCols: [3, 12], // D(전화번호), M(전화)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(주소)" },
      { sourceCol: 4, targetCol: 6, label: "E(품목명)→G(상품명)" },
      { sourceCol: 6, targetCol: 8, label: "G(수량)→I(수량)" },
      { sourceCol: 10, targetCol: 9, label: "K(배송메세지)→J(배송메세지)" },
      { sourceCol: 16, targetCol: 10, label: "Q(보내는분)→K(보내는사람)" },
      { sourceCol: 18, targetCol: 11, label: "S(보내는분주소)→L(주소)" },
      { sourceCol: 17, targetCol: 12, label: "R(보내는분전화)→M(전화)" },
    ],
  },
  AP: {
    // 올팩 — 19열
    // A(0):송장번호, B(1):적요, C(2):보내는사람(지정), D(3):전화번호1(지정),
    // E(4):전화번호2(지정), F(5):우편번호(지정), G(6):주소(지정),
    // H(7):받는사람, I(8):전화번호1, J(9):전화번호2, K(10):우편번호,
    // L(11):주소, M(12):상품명1, N(13):상품상세1, O(14):수량(A타입),
    // P(15):배송메시지, Q(16):운임구분, R(17):운임, S(18):운송장번호
    totalCols: 19,
    phoneTargetCols: [3, 8], // D(전화번호1-보내는), I(전화번호1-받는)
    sourceToTarget: [
      { sourceCol: 16, targetCol: 2, label: "Q(보내는분)→C(보내는사람)" },
      {
        sourceCol: 17,
        targetCol: 3,
        label: "R(보내는분전화)→D(전화번호1-지정)",
      },
      { sourceCol: 18, targetCol: 6, label: "S(보내는분주소)→G(주소-지정)" },
      { sourceCol: 12, targetCol: 7, label: "M(거래처명)→H(받는사람)" },
      { sourceCol: 8, targetCol: 8, label: "I(모바일)→I(전화번호1)" },
      { sourceCol: 9, targetCol: 11, label: "J(주소1)→L(주소)" },
      { sourceCol: 4, targetCol: 12, label: "E(품목명)→M(상품명1)" },
      { sourceCol: 6, targetCol: 14, label: "G(수량)→O(수량)" },
      { sourceCol: 10, targetCol: 15, label: "K(배송메세지)→P(배송메시지)" },
    ],
  },
  JT: {
    // 준테크 — 대한통운 양식 (★ 2026-08-06)
    // A(0):송장번호, B(1):이슈,
    // C(2):예약구분, D(3):집하예정일,
    // E(4):보내는분성명, F(5):보내는분전화번호, G(6):보내는분기타연락처,
    // H(7):보내는분우편번호, I(8):보내는분주소,
    // J(9):받는분성명, K(10):받는분전화번호, L(11):받는분기타연락처,
    // M(12):받는분우편번호, N(13):받는분주소,
    // O(14):운송장번호, P(15):고객주문번호, Q(16):품목명, R(17):박스수량,
    // S(18):박스타입, T(19):기본운임, U(20):배송메세지1, V(21):배송메세지2, W(22):운임구분
    totalCols: 23,
    phoneTargetCols: [5, 10], // F(보내는분전화), K(받는분전화)
    sourceToTarget: [
      { sourceCol: 16, targetCol: 4, label: "Q(보내는분)→E(보내는분성명)" },
      { sourceCol: 17, targetCol: 5, label: "R(보내는분전화)→F(보내는분전화번호)" },
      { sourceCol: 18, targetCol: 8, label: "S(보내는분주소)→I(보내는분주소)" },
      { sourceCol: 12, targetCol: 9, label: "M(거래처명)→J(받는분성명)" },
      { sourceCol: 8, targetCol: 10, label: "I(모바일)→K(받는분전화번호)" },
      { sourceCol: 9, targetCol: 13, label: "J(주소1)→N(받는분주소)" },
      { sourceCol: 4, targetCol: 16, label: "E(품목명)→Q(품목명)" },
      { sourceCol: 6, targetCol: 17, label: "G(수량)→R(박스수량)" },
      { sourceCol: 10, targetCol: 20, label: "K(배송메세지)→U(배송메세지1)" },
    ],
  },
  SW: {
    // 선우 — 대한통운 양식 (★ 2026-08-25)
    // A(0):송장번호, B(1):이슈,
    // C(2):보내는분성명, D(3):보내는분전화번호, E(4):보내는분기타연락처,
    // F(5):보내는분우편번호, G(6):보내는분주소(전체, 분할),
    // H(7):받는분성명, I(8):받는분전화번호, J(9):받는분기타연락처,
    // K(10):받는분우편번호, L(11):받는분주소(전체, 분할),
    // M(12):품목명, N(13):내품명, O(14):박스수량,
    // P(15):배송메세지1, Q(16):박스타입, R(17):운임구분
    // 보내는분(C~G)·내품명(N)·박스타입(Q)·운임구분(R)은 업체 입력 → 비움
    totalCols: 18,
    phoneTargetCols: [8], // I(받는분전화번호)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 7, label: "M(거래처명)→H(받는분성명)" },
      { sourceCol: 8, targetCol: 8, label: "I(모바일)→I(받는분전화번호)" },
      { sourceCol: 9, targetCol: 11, label: "J(주소1)→L(받는분주소)" },
      { sourceCol: 4, targetCol: 12, label: "E(품목명)→M(품목명)" },
      { sourceCol: 6, targetCol: 14, label: "G(수량)→O(박스수량)" },
      { sourceCol: 10, targetCol: 15, label: "K(배송메세지)→P(배송메세지1)" },
    ],
  },
  LG: {
    // 로엔그린 — 20열 (★ 2026-07-07: B열 이슈 추가, 기존 열 +1 밀림)
    totalCols: 20,
    phoneTargetCols: [3, 8], // D(전화번호1-보내는), I(전화번호1-받는) — 기존 C,H에서 +1
    sourceToTarget: [
      { sourceCol: 16, targetCol: 2, label: "Q(보내는분)→C(보내는사람)" },
      {
        sourceCol: 17,
        targetCol: 3,
        label: "R(보내는분전화)→D(전화번호1-지정)",
      },
      { sourceCol: 18, targetCol: 6, label: "S(보내는분주소)→G(주소-지정)" },
      { sourceCol: 12, targetCol: 7, label: "M(거래처명)→H(받는사람)" },
      { sourceCol: 8, targetCol: 8, label: "I(모바일)→I(전화번호1)" },
      { sourceCol: 9, targetCol: 11, label: "J(주소1)→L(주소)" },
      { sourceCol: 4, targetCol: 12, label: "E(품목명)→M(상품명1)" },
      { sourceCol: 6, targetCol: 14, label: "G(수량)→O(수량)" },
      { sourceCol: 10, targetCol: 15, label: "K(배송메세지)→P(배송메시지)" },
    ],
  },
  JM: {
    // 제이엠
    // A(0):송장번호, B(1):이슈
    // C(2):수화주전화1, D(3):수화주전화2, E(4):수화주명, F(5):주소,
    // G(6):수량, H(7):품명, I(8):포장, J(9):운임구분, K(10):운송상품,
    // L(11):우편번호, M(12):도착영업소, N(13):발화주명, O(14):발화주전화번호,
    // P(15):총운임, Q(16):특기사항, AW(48):이카운트코드
    totalCols: 17,
    fixedValues: { 8: "BOX", 9: "현불", 10: "택배" }, // ★ I=포장, J=운임구분, K=운송상품
    phoneTargetCols: [2, 14], // C(수화주전화1), O(발화주전화번호)
    sourceToTarget: [
      { sourceCol: 8, targetCol: 2, label: "I(모바일)→C(수화주전화1)" },
      { sourceCol: 12, targetCol: 4, label: "M(거래체명)→E(수화주명)" },
      { sourceCol: 9, targetCol: 5, label: "J(주소1)→F(주소)" },
      { sourceCol: 6, targetCol: 6, label: "G(수량)→G(수량)" },
      { sourceCol: 4, targetCol: 7, label: "E(품목명)→H(품명)" },
      { sourceCol: 16, targetCol: 13, label: "Q(보내는분)→N(발화주명)" },
      {
        sourceCol: 17,
        targetCol: 14,
        label: "R(보내는분전화)→O(발화주전화번호)",
      },
      { sourceCol: 10, targetCol: 16, label: "K(배송메세지)→Q(특기사항)" },
    ],
  },
  OC: {
    // 부엉이커피 — 12열 (팩투유 기본)
    // ★ 2026-07-07 추가
    totalCols: 12,
    phoneTargetCols: [3, 9], // D(전화번호), J(보내는분전화)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(주소)" },
      { sourceCol: 4, targetCol: 5, label: "E(품목명)→F(상품명)" },
      { sourceCol: 6, targetCol: 6, label: "G(수량)→G(수량)" },
      { sourceCol: 10, targetCol: 7, label: "K(배송메세지)→H(배송메세지)" },
      { sourceCol: 16, targetCol: 8, label: "Q(보내는분)→I(보내는사람)" },
      { sourceCol: 17, targetCol: 9, label: "R(보내는분전화)→J(보내는분전화)" },
      { sourceCol: 18, targetCol: 10, label: "S(보내는분주소)→K(보내는분주소)" },
      { sourceCol: 3, targetCol: 11, label: "D(품목코드)→L(이카운트코드)" },
    ],
  },
  GP: {
    // 지니팩 — 12열 (OC 구조 동일)
    // ★ 2026-07-07 추가
    totalCols: 12,
    phoneTargetCols: [3, 9], // D(전화번호), J(보내는분전화)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(주소)" },
      { sourceCol: 4, targetCol: 5, label: "E(품목명)→F(상품명)" },
      { sourceCol: 6, targetCol: 6, label: "G(수량)→G(수량)" },
      { sourceCol: 10, targetCol: 7, label: "K(배송메세지)→H(배송메세지)" },
      { sourceCol: 16, targetCol: 8, label: "Q(보내는분)→I(보내는사람)" },
      { sourceCol: 17, targetCol: 9, label: "R(보내는분전화)→J(보내는분전화)" },
      { sourceCol: 18, targetCol: 10, label: "S(보내는분주소)→K(보내는분주소)" },
      { sourceCol: 3, targetCol: 11, label: "D(품목코드)→L(이카운트코드)" },
    ],
  },
  HP: {
    // 하나팩 — 11열 (★ 2026-07-08 추가)
    // A(0):송장번호, B(1):이슈,
    // C(2):보내는사람, D(3):전화번호, E(4):보내는사람주소,
    // F(5):상품명, G(6):수량, H(7):받는사람, I(8):연락처,
    // J(9):주소, K(10):배송메시지
    totalCols: 11,
    phoneTargetCols: [3, 8], // D(보내는전화), I(받는연락처)
    sourceToTarget: [
      { sourceCol: 16, targetCol: 2, label: "Q(보내는분)→C(보내는사람)" },
      { sourceCol: 17, targetCol: 3, label: "R(보내는분전화)→D(전화번호)" },
      { sourceCol: 18, targetCol: 4, label: "S(보내는분주소)→E(보내는사람주소)" },
      { sourceCol: 4, targetCol: 5, label: "E(품목명)→F(상품명)" },
      { sourceCol: 6, targetCol: 6, label: "G(수량)→G(수량)" },
      { sourceCol: 12, targetCol: 7, label: "M(거래처명)→H(받는사람)" },
      { sourceCol: 8, targetCol: 8, label: "I(모바일)→I(연락처)" },
      { sourceCol: 9, targetCol: 9, label: "J(주소1)→J(주소)" },
      { sourceCol: 10, targetCol: 10, label: "K(배송메세지)→K(배송메시지)" },
    ],
  },
  YS: {
    // 와이에스 — 14열 (★ 2026-07-14 추가)
    // A(0):송장번호, B(1):이슈,
    // C(2):받는사람, D(3):전화번호1, E(4):전화번호2, F(5):우편번호,
    // G(6):주소, H(7):상품명1, I(8):운임구분, J(9):수량(A타입),
    // K(10):배송메시지, L(11):보내는사람(지정), M(12):전화번호1(지정), N(13):주소(지정)
    totalCols: 14,
    fixedValues: { 8: "선불" }, // I열 운임구분 고정
    phoneTargetCols: [3, 12], // D(전화번호1), M(전화번호1-지정)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호1)" },
      { sourceCol: 9, targetCol: 6, label: "J(주소1)→G(주소)" },
      { sourceCol: 4, targetCol: 7, label: "E(품목명)→H(상품명1)" },
      { sourceCol: 6, targetCol: 9, label: "G(수량)→J(수량A타입)" },
      { sourceCol: 10, targetCol: 10, label: "K(배송메세지)→K(배송메시지)" },
      { sourceCol: 16, targetCol: 11, label: "Q(보내는분)→L(보내는사람지정)" },
      { sourceCol: 17, targetCol: 12, label: "R(보내는분전화)→M(전화번호1지정)" },
      { sourceCol: 18, targetCol: 13, label: "S(보내는분주소)→N(주소지정)" },
    ],
  },
};

// ─────────────────────────────────────────────────────
//  열 오버라이드: Push 후 특정 열을 강제로 덮어씀
//  NK L열(11) 정산단가 → 공란 (업체에 단가 노출 불필요)
// ─────────────────────────────────────────────────────
var _PEP_VENDOR_COL_OVERRIDES_ = {
  NK: { 11: "" }, // L열 정산단가 공란
};

// ─────────────────────────────────────────────────────
//  전용양식 탭 생성 (협력업체 파일에 탭이 없을 때)
//  vendorSS: SpreadsheetApp 객체, pfx: "NK"|"GW"|...
// ─────────────────────────────────────────────────────
function _pep_createExclusiveFormTab_(vendorSS, pfx) {
  var headers = _PEP_EXCLUSIVE_FORM_HEADERS_[pfx];
  if (!headers || headers.length === 0) return null;

  var tabName = "전용양식";
  // 이미 있으면 반환 (단, HR은 뉴파츠단가 탭 생성 보장)
  var existing = vendorSS.getSheetByName(tabName);
  if (existing) {
    if (pfx === "HR") {
      try {
        _pep_ensureNewPartsPriceTab_(vendorSS);
      } catch (ePT) {}
    }
    return existing;
  }

  var tab = vendorSS.insertSheet(tabName);
  // 헤더 기록
  tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  // 헤더 스타일
  var hdr = tab.getRange(1, 1, 1, headers.length);
  hdr
    .setBackground("#1f4e78")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  // A열(송장번호), B열(이슈) 강조 — 업체 입력 영역
  tab
    .getRange("A1")
    .setValue("송장번호")
    .setBackground("#e06c75")
    .setFontColor("#ffffff");
  tab
    .getRange("B1")
    .setValue("이슈")  // ★ 2026-07-07: 적요 → 이슈 변경
    .setBackground("#e06c75")
    .setFontColor("#ffffff");

  // HR(뉴파츠): 뉴파츠단가 탭도 함께 생성
  if (pfx === "HR") {
    _pep_ensureNewPartsPriceTab_(vendorSS);
  }

  SpreadsheetApp.flush();
  return tab;
}

/**
 * 뉴파츠공급가 탭 생성 (품목코드 | 품목명 | 단가(부가세포함))
 * 전용양식 M열 VLOOKUP이 이 탭을 참조한다.
 * J열(단가)·K열(공급가액)·L열(부가세)는 M열에서 역추적 계산.
 */
function _pep_ensureNewPartsPriceTab_(ss) {
  var tabName = "뉴파츠공급가";
  var existing = ss.getSheetByName(tabName);
  if (existing) return existing;

  // 기존 "뉴파츠단가" 탭이 있으면 이름 변경
  var oldTab = ss.getSheetByName("뉴파츠단가");
  if (oldTab) {
    try {
      oldTab.setName(tabName);
      // 헤더도 갱신
      oldTab.getRange(1, 3).setValue("단가(부가세포함)");
      return oldTab;
    } catch (eRename) {}
  }

  var tab = ss.insertSheet(tabName);
  var priceHeaders = [["품목코드", "품목명", "단가(부가세포함)"]];
  tab.getRange(1, 1, 1, 3).setValues(priceHeaders);
  tab
    .getRange(1, 1, 1, 3)
    .setBackground("#274e13")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 140);
  tab.setColumnWidth(2, 250);
  tab.setColumnWidth(3, 160);
  // C열(단가) 천단위 콤마 서식
  try {
    tab.getRange("C2:C").setNumberFormat("#,##0");
  } catch (e) {}
  return tab;
}

// ─────────────────────────────────────────────────────
//  뉴파츠단가 탭 일괄 생성 (메뉴용)
//  뉴파츠(HR) 협력업체 파일에 '뉴파츠단가' 탭이 없으면 자동 생성
// ─────────────────────────────────────────────────────
function partnerEnsureNewPartsPriceTab() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  var prefixToFile = _pep_buildPrefixToFileMap_(files);
  var hrFile = prefixToFile["HR"];
  if (!hrFile) {
    ui.alert("뉴파츠(HR) 협력업체 파일을 찾을 수 없습니다.");
    return;
  }
  try {
    var ss = SpreadsheetApp.openById(hrFile.id);
    var tab = _pep_ensureNewPartsPriceTab_(ss);
    if (tab) {
      SpreadsheetApp.flush();
      ui.alert(
        "✅ 뉴파츠단가 탭 생성 완료\n파일: " +
          hrFile.name +
          "\n탭: " +
          tab.getName(),
      );
    }
  } catch (e) {
    ui.alert("❌ 오류: " + e.message);
  }
}

// ─────────────────────────────────────────────────────
//  공개: 기존 협력업체 파일에 전용양식 탭 추가 (복구용)
//  메뉴 → 전용양식 탭 생성 (파일 선택)
// ─────────────────────────────────────────────────────
function partnerCreateExclusiveFormTab() {
  var ui = SpreadsheetApp.getUi();

  // 파일 선택
  var files = _pt_listFiles();
  if (!files || files.length === 0)
    return ui.alert("협력업체 파일이 없습니다.");
  var nameList = files
    .map(function (f, i) {
      return i + 1 + ") " + f.name;
    })
    .join("\n");
  var resp = ui.prompt(
    "전용양식 탭 생성",
    "번호를 입력하세요:\n\n" + nameList,
    ui.ButtonSet.OK_CANCEL,
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var idx = parseInt(resp.getResponseText().trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= files.length)
    return ui.alert("올바른 번호를 입력하세요.");

  var fileInfo = files[idx];

  // prefix 탐색 (_PEP_EXCLUSIVE_FORM_HEADERS_ 기반)
  var pfx = _pep_getPrefixFromFileName_(fileInfo.name);
  if (!pfx) {
    var pfxResp = ui.prompt(
      "업체 접두 입력",
      fileInfo.name +
        "\n\n접두 2자리 입력 (예: NK, GW, HR, TY, AJ, BW, KR, HU):",
      ui.ButtonSet.OK_CANCEL,
    );
    if (pfxResp.getSelectedButton() !== ui.Button.OK) return;
    pfx = pfxResp.getResponseText().trim().toUpperCase();
  }

  if (!_PEP_EXCLUSIVE_FORM_HEADERS_[pfx]) {
    return ui.alert(
      "[" +
        pfx +
        "] 헤더 정보 없음.\n지원 접두: " +
        Object.keys(_PEP_EXCLUSIVE_FORM_HEADERS_).join(", "),
    );
  }

  try {
    var ss = SpreadsheetApp.openById(fileInfo.id);
    var tab = _pep_createExclusiveFormTab_(ss, pfx);
    if (tab) {
      ui.alert(
        "✅ 전용양식 탭 생성 완료\n파일: " +
          fileInfo.name +
          "\n탭: " +
          tab.getName(),
      );
    } else {
      ui.alert("ℹ️ 이미 전용양식 탭이 있습니다.");
    }
  } catch (e) {
    ui.alert("❌ 오류: " + e.message);
  }
}

// ─────────────────────────────────────────────────────
//  헬퍼: 파일명에서 prefix 추출
// ─────────────────────────────────────────────────────
function _pep_getPrefixFromFileName_(fileName) {
  try {
    var labels =
      typeof _PEP_VENDOR_LABELS_ !== "undefined" ? _PEP_VENDOR_LABELS_ : {};
    var shortName = fileName
      .replace("[협력업체] ", "")
      .replace(/\s*\(소비자용\).*$/, "")
      .trim();
    for (var pfx in labels) {
      var label = labels[pfx];
      if (
        label &&
        (shortName.indexOf(label) !== -1 || label.indexOf(shortName) !== -1)
      )
        return pfx;
    }
  } catch (e) {}
  return null;
}

// ─────────────────────────────────────────────────────
//  전용양식 헤더 일괄 업데이트 (AS 메뉴용)
//  독립배포 repairVendorExclusiveFormatHeaders 대응
// ─────────────────────────────────────────────────────
function partnerRepairExclusiveFormHeaders() {
  var ui = SpreadsheetApp.getUi();
  var go = ui.alert(
    "🔧 전용양식 헤더 일괄 업데이트",
    "모든 협력업체 파일의 '전용양식' 탭 1행을\n_PEP_EXCLUSIVE_FORM_HEADERS_ 정의에 맞춰 업데이트합니다.\n계속할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (go !== ui.Button.YES) return;

  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일 없음");

  var fixed = 0,
    skipped = 0,
    errs = [];

  files.forEach(function (fileInfo) {
    try {
      var pfx = _pep_getPrefixFromFileName_(fileInfo.name);
      if (!pfx) {
        skipped++;
        return;
      }
      var headers = _PEP_EXCLUSIVE_FORM_HEADERS_[pfx];
      if (!headers) {
        skipped++;
        return;
      }

      var ss = SpreadsheetApp.openById(fileInfo.id);
      var tab = _pep_findExclusiveFormTab_(ss);
      if (!tab) {
        skipped++;
        return;
      }

      var lc = Math.max(tab.getMaxColumns(), headers.length);
      if (tab.getMaxColumns() < headers.length) {
        tab.insertColumnsAfter(
          tab.getMaxColumns(),
          headers.length - tab.getMaxColumns(),
        );
      }
      tab
        .getRange(1, 1, 1, headers.length)
        .setValues([headers])
        .setBackground("#4a86e8")
        .setFontColor("white")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");

      // ★ A열에 잘못 주입된 spill 수식(ARRAYFORMULA 거래처명) 제거
      try {
        var a1F = String(tab.getRange("A1").getFormula() || "");
        if (a1F && a1F.indexOf("ARRAYFORMULA") !== -1) {
          tab.getRange("A1:A").clearContent();
          tab.getRange("A1").setValue("송장번호");
        }
        // A2 이하에 수식이 남아있으면 제거
        if (tab.getLastRow() >= 2) {
          var a2F = String(tab.getRange("A2").getFormula() || "");
          if (a2F) tab.getRange(2, 1, tab.getLastRow() - 1, 1).clearContent();
        }
      } catch (eSpill) {}

      // A1·B1 강조 (업체 입력 영역)
      tab.getRange("A1").setBackground("#e06c75").setFontColor("#ffffff");
      tab.getRange("B1").setBackground("#e06c75").setFontColor("#ffffff");
      tab.setFrozenRows(1);

      // 기존 열 수가 신규 헤더보다 많으면 초과 헤더 셀 정리 (예: 32열→20열 전환)
      if (lc > headers.length) {
        try {
          tab
            .getRange(1, headers.length + 1, 1, lc - headers.length)
            .clearContent()
            .setBackground("#ffffff");
        } catch (eClean) {}
      }

      // HR(뉴파츠): 뉴파츠단가 탭 생성 보장
      if (pfx === "HR") {
        try {
          _pep_ensureNewPartsPriceTab_(ss);
        } catch (ePriceTab) {}
      }

      fixed++;
      SpreadsheetApp.flush();
    } catch (e) {
      errs.push("[" + fileInfo.name + "] " + e.message);
    }
  });

  ui.alert(
    "✅ 전용양식 헤더 업데이트 완료\n갱신: " +
      fixed +
      "건 / 스킵: " +
      skipped +
      "건" +
      (errs.length ? "\n⚠ 오류:\n" + errs.join("\n") : ""),
  );
}

/** 전용양식 탭 탐색 (이름에 "전용양식" 포함) */
function _pep_findExclusiveFormTab_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().indexOf("전용양식") !== -1) return sheets[i];
  }
  return null;
}

// ─────────────────────────────────────────────────────
//  누락 업체 [협력업체] 파일 + 전용양식 탭 일괄 생성
//  _PEP_VENDOR_COL_OVERRIDES_ 등록 접두 중 [협력업체] 파일이 없는 업체를
//  자동으로 생성한다 (뷰어·단가 수식은 생략, 전용양식 Push만 가능).
// ─────────────────────────────────────────────────────
function partnerCreateMissingExclusiveFiles() {
  var ui = SpreadsheetApp.getUi();

  // 1) 현재 prefix→파일 매핑
  var files = _pt_listFiles();
  var prefixToFile = _pep_buildPrefixToFileMap_(files);

  // 2) _PEP_VENDOR_DIRECT_MAP_ 지원 접두 확인 (전체 8업체)
  var allPfx =
    typeof _PEP_VENDOR_DIRECT_MAP_ !== "undefined"
      ? Object.keys(_PEP_VENDOR_DIRECT_MAP_)
      : [];
  if (allPfx.length === 0)
    return ui.alert("_PEP_VENDOR_DIRECT_MAP_ 접두가 없습니다.");

  // 3) 누락 접두 찾기 (_PEP_VENDOR_LABELS_ 기반)
  var labels =
    typeof _PEP_VENDOR_LABELS_ !== "undefined" ? _PEP_VENDOR_LABELS_ : {};
  var missing = [];
  for (var i = 0; i < allPfx.length; i++) {
    var pfx = allPfx[i];
    if (prefixToFile[pfx]) continue; // 이미 있음
    var label = labels[pfx] || "";
    if (label) missing.push({ pfx: pfx, label: label });
  }

  if (missing.length === 0) {
    ui.alert(
      "✅ 모든 접두에 대한 [협력업체] 파일이 이미 존재합니다.\n\n" +
        allPfx
          .map(function (p) {
            return p + ": " + (prefixToFile[p] ? prefixToFile[p].name : "?");
          })
          .join("\n"),
    );
    return;
  }

  // 4) 사용자 확인
  var nameList = missing
    .map(function (m) {
      return m.pfx + " (" + m.label + ")";
    })
    .join("\n");
  var ans = ui.alert(
    "📂 전용양식 전용 파일 자동 생성",
    "다음 업체의 [협력업체] 파일이 없어 Push가 불가합니다:\n\n" +
      nameList +
      "\n\n위 업체들의 [협력업체] 파일 + 전용양식 탭을 자동 생성합니다.\n" +
      "(단가 뷰어는 생략됩니다. 필요 시 partnerSetK2AndRepair로 추후 설정)\n\n계속할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (ans !== ui.Button.YES) return;

  // 5) 일괄 생성
  var created = [],
    errors = [];
  for (var mi = 0; mi < missing.length; mi++) {
    var m = missing[mi];
    try {
      var fileName = _PT.PREFIX + m.label;

      // 템플릿 복사 → 폴더에 배치
      var newFile = _pt_createTemplateCopy(_PT.TEMPLATE_ID, fileName);
      var fileId = newFile.getId();
      var ss = SpreadsheetApp.openById(fileId);
      var sheet = ss.getSheets()[0];
      sheet.setName(m.label + " 뷰어");

      // 설정 탭 (업체명)
      try {
        _pt_ensureLocalSettingsTab(ss, m.label, "");
      } catch (e) {}

      // 전용양식 탭 생성
      _pep_createExclusiveFormTab_(ss, m.pfx);

      // 발주 탭 생성 (발주 수집용)
      try {
        _pt_createOrderTab(ss, m.label, "", sheet.getName());
      } catch (e) {}

      // 메타 셀
      try {
        _pt_applyMetaCells(sheet, _PT.HUB_ID, fileId);
      } catch (e) {}

      SpreadsheetApp.flush();
      created.push(m.pfx + "(" + m.label + ")");
    } catch (e) {
      errors.push(m.pfx + "(" + m.label + "): " + e.message);
    }
  }

  var msg =
    "📂 전용양식 파일 생성 완료\n\n" +
    "✅ 생성: " +
    created.length +
    "개\n" +
    (created.length ? created.join(", ") + "\n" : "") +
    (errors.length ? "\n❌ 오류:\n" + errors.join("\n") : "") +
    "\n\n이제 '대리발주 Push'를 실행하면 이 업체들도 Push됩니다.";
  ui.alert(msg);
}

// ─────────────────────────────────────────────────────
//  헬퍼: 실제 데이터가 있는 마지막 행 탐색
//  getLastRow()가 서식만 있는 빈 행까지 포함하는 문제 우회
//  (전용양식 탭에서 1000행부터 기입되는 버그 수정)
// ─────────────────────────────────────────────────────
function _pep_findActualLastRow_(tab) {
  var lr = tab.getLastRow();
  if (lr <= 1) return 1; // 헤더만 있음

  // B~H 범위 기준으로 실제 데이터 확인 (A열=송장번호는 비어있을 수 있으므로)
  var checkCols = Math.min(tab.getLastColumn(), 8);
  if (checkCols < 2) checkCols = 2;
  var data = tab.getRange(2, 1, lr - 1, checkCols).getValues();

  var actualLast = 1; // 헤더 행
  for (var i = data.length - 1; i >= 0; i--) {
    var hasData = false;
    for (var c = 0; c < data[i].length; c++) {
      if (String(data[i][c] || "").trim() !== "") {
        hasData = true;
        break;
      }
    }
    if (hasData) {
      actualLast = i + 2;
      break;
    } // +2: 1-indexed + header offset
  }
  return actualLast;
}

// ─────────────────────────────────────────────────────
//  헬퍼: targetCol이 전화번호 열인지 판별
// ─────────────────────────────────────────────────────
function _pep_isPhoneTargetCol_(targetCol, phoneTargetCols) {
  if (!phoneTargetCols) return false;
  for (var i = 0; i < phoneTargetCols.length; i++) {
    if (phoneTargetCols[i] === targetCol) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────
//  헬퍼: 전화번호 선행 0 복원
//  소스 데이터가 숫자형(Number)으로 읽혀 01012345678 → 1012345678 되는 문제 방지
//  9~10자리 순수 숫자이고 0으로 시작하지 않으면 "0" 붙임
// ─────────────────────────────────────────────────────
function _pep_restoreLeadingZero_(value) {
  var sv = String(value).trim();
  // 9~11자리 순수 숫자이고 0으로 시작하지 않으면 "0" 붙임
  // 9~10자리: 일반 전화/휴대폰 (010, 02, 031 등)
  // 11자리: 050 인터넷전화 (050-xxxx-xxxx)
  if (/^\d{9,11}$/.test(sv) && sv[0] !== "0") {
    return "0" + sv;
  }
  return sv;
}

// ─────────────────────────────────────────────────────
//  협력Push 초기화: 소스 탭의 "협력Push" 열 데이터 일괄 삭제
//  전용양식 탭 내용을 지운 뒤 재Push할 때 사용
// ─────────────────────────────────────────────────────
function partnerResetExclusivePushUids() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  // 1) 소스 탭 열기
  var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var srcTab = null;
  var srcSheets = srcSS.getSheets();
  for (var i = 0; i < srcSheets.length; i++) {
    if (srcSheets[i].getSheetId() === _PEP_SOURCE_TAB_GID) {
      srcTab = srcSheets[i];
      break;
    }
  }
  if (!srcTab) srcTab = srcSS.getSheetByName(_PEP_SOURCE_TAB_NAME);
  if (!srcTab) {
    if (ui) ui.alert("소스 탭을 찾을 수 없습니다.");
    return;
  }

  // 2) 협력Push 열 찾기
  var srcLr = srcTab.getLastRow();
  if (srcLr < 2) {
    if (ui) ui.alert("소스 탭에 데이터가 없습니다.");
    return;
  }
  var srcHdr = srcTab.getRange(1, 1, 1, srcTab.getLastColumn()).getValues()[0];
  var srcUidCol = -1;
  for (var hi = 0; hi < srcHdr.length; hi++) {
    var hn = String(srcHdr[hi] || "")
      .replace(/\s/g, "")
      .toLowerCase();
    if (hn === "협력push" || hn === "pep_uid") {
      srcUidCol = hi;
      break;
    }
  }

  // 3) 현재 UID 개수 확인
  var filledCount = 0;
  if (srcUidCol !== -1) {
    var uidData = srcTab.getRange(2, srcUidCol + 1, srcLr - 1, 1).getValues();
    for (var r = 0; r < uidData.length; r++) {
      if (String(uidData[r][0] || "").trim()) filledCount++;
    }
  }

  // 4) 사용자 확인
  if (ui) {
    var uidStatus =
      filledCount > 0
        ? "협력Push UID: " + filledCount + "건 (삭제됩니다)"
        : "협력Push UID: 이미 비어있음 (0건, 삭제 생략)";
    var ans = ui.alert(
      "🔄 협력Push 초기화",
      uidStatus +
        "\n\n" +
        "▸ 전용양식 탭 데이터(2행~) 전부 삭제\n\n" +
        "계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (ans !== ui.Button.YES) return;
  }

  // 5) 소스 UID 일괄 삭제 (있는 경우만)
  if (srcUidCol !== -1 && filledCount > 0) {
    var clearData = [];
    for (var c = 0; c < srcLr - 1; c++) clearData.push([""]);
    srcTab.getRange(2, srcUidCol + 1, srcLr - 1, 1).setValues(clearData);
  }

  // 6) 전용양식 탭 데이터 초기화 (헤더 유지, 2행 이하 완전 삭제)
  //    ★ _pt_listFiles()로 전체 협력업체 파일 직접 스캔
  var files = _pt_listFiles();
  var clearedTabs = [];
  var skippedFiles = [];
  for (var fi = 0; fi < files.length; fi++) {
    try {
      var vendorSS = SpreadsheetApp.openById(files[fi].id);
      var tabs = vendorSS.getSheets();
      var foundExclusive = false;
      for (var ti = 0; ti < tabs.length; ti++) {
        if (tabs[ti].getName().indexOf("전용양식") !== -1) {
          foundExclusive = true;
          var lr = tabs[ti].getLastRow();
          if (lr >= 2) {
            tabs[ti].deleteRows(2, lr - 1);
            clearedTabs.push(
              files[fi].name.replace("[협력업체] ", "") +
                " (" +
                tabs[ti].getName() +
                ", " +
                (lr - 1) +
                "행 삭제)",
            );
          } else {
            clearedTabs.push(
              files[fi].name.replace("[협력업체] ", "") +
                " (" +
                tabs[ti].getName() +
                ", 이미 비어있음)",
            );
          }
        }
      }
      if (!foundExclusive) {
        skippedFiles.push(
          files[fi].name.replace("[협력업체] ", "") + " (전용양식 탭 없음)",
        );
      }
    } catch (eV) {
      clearedTabs.push(
        files[fi].name.replace("[협력업체] ", "") + ": ❌ " + eV.message,
      );
    }
  }
  SpreadsheetApp.flush();

  var msg =
    "✅ 협력Push 초기화 완료\n" +
    "- UID 삭제: " +
    filledCount +
    "건\n" +
    "- 전용양식 초기화: " +
    clearedTabs.length +
    "개 탭\n" +
    (clearedTabs.length > 0 ? "  " + clearedTabs.join("\n  ") : "") +
    (skippedFiles.length > 0
      ? "\n- 전용양식 없음: " + skippedFiles.join(", ")
      : "") +
    "\n\n이제 '대리발주 Push'를 실행하면 다시 Push됩니다.";
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

/**
 * ── 카카오톡 텍스트 → 전용양식 송장번호 자동 매칭 ──
 * 송장번호 + 이름이 포함된 텍스트를 붙여넣으면
 * 전용양식의 수취인 열을 찾아 A열(송장번호)에 자동 기입.
 *
 * 지원 텍스트 형식:
 *   "1234567890 홍길동"  (한 줄, 번호+이름)
 *   "홍길동 1234567890"  (한 줄, 이름+번호)
 *   "홍길동\n1234567890" (두 줄)
 *   여러 건 혼합
 */
function partnerMatchInvoiceFromKakao() {
  var ui = SpreadsheetApp.getUi();

  // 1) 업체 파일 선택
  var files = _pt_listFiles();
  var prefixToFile = _pep_buildPrefixToFileMap_(files);
  var pfxList = Object.keys(prefixToFile).sort();
  if (pfxList.length === 0) return ui.alert("협력업체 파일이 없습니다.");

  var fileLines = pfxList.map(function (pfx, i) {
    return (
      i +
      1 +
      ") [" +
      pfx +
      "] " +
      prefixToFile[pfx].name.replace("[협력업체] ", "")
    );
  });
  var fResp = ui.prompt(
    "📦 카카오 송장 매칭 — 업체 선택",
    "번호를 입력하세요:\n\n" + fileLines.join("\n"),
    ui.ButtonSet.OK_CANCEL,
  );
  if (fResp.getSelectedButton() !== ui.Button.OK) return;
  var fIdx = parseInt(fResp.getResponseText().trim(), 10) - 1;
  if (isNaN(fIdx) || fIdx < 0 || fIdx >= pfxList.length)
    return ui.alert("잘못된 번호입니다.");
  var pfx = pfxList[fIdx];
  var targetFile = prefixToFile[pfx];

  // 2) 카카오톡 텍스트 입력
  var txtResp = ui.prompt(
    "📋 텍스트 붙여넣기 — [" + pfx + "]",
    "카카오톡에서 받은 송장번호+이름 텍스트를 붙여넣으세요.\n\n" +
      "지원 형식:\n" +
      "  • 1234567890 홍길동\n" +
      "  • 홍길동 1234567890\n" +
      "  • 홍길동 (줄바꿈) 1234567890",
    ui.ButtonSet.OK_CANCEL,
  );
  if (txtResp.getSelectedButton() !== ui.Button.OK) return;
  var rawText = txtResp.getResponseText().trim();
  if (!rawText) return ui.alert("텍스트가 없습니다.");

  // 3) 텍스트 파싱 (엑셀 탭 구분 우선 → 텍스트 폴백)
  var pairs = [];
  var hasProductHint = false;
  var tableResult = _pep_parseInvoiceTableData_(rawText);
  if (tableResult) {
    pairs = tableResult.pairs;
    hasProductHint = tableResult.productCol !== -1;
    Logger.log("[KakaoMatch] 엑셀 테이블 파싱: " + pairs.length + "건" +
      (hasProductHint ? " (제품힌트 포함, 열" + tableResult.productCol + ")" : ""));
  } else {
    var textPairs = _pep_parseInvoiceNamePairs_(rawText);
    for (var tpi = 0; tpi < textPairs.length; tpi++) {
      pairs.push({ tracking: textPairs[tpi].tracking, name: textPairs[tpi].name, productHint: '' });
    }
  }
  if (pairs.length === 0)
    return ui.alert(
      "❌ 인식된 (송장번호, 이름) 쌍이 없습니다.\n\n형식을 확인하세요.",
    );

  // 4) 전용양식 탭 열기
  var ss;
  try {
    ss = SpreadsheetApp.openById(targetFile.id);
  } catch (eO) {
    return ui.alert("❌ 파일 열기 실패: " + eO.message);
  }
  var exTab = null;
  var allTabs = ss.getSheets();
  for (var ti = 0; ti < allTabs.length; ti++) {
    if (allTabs[ti].getName().indexOf("전용양식") !== -1) {
      exTab = allTabs[ti];
      break;
    }
  }
  if (!exTab) return ui.alert("❌ 전용양식 탭 없음:\n" + targetFile.name);

  var lr = exTab.getLastRow();
  if (lr < 2) return ui.alert("전용양식 데이터가 없습니다.");
  var lc = Math.max(exTab.getLastColumn(), 1);
  var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];

  // 5) 수취인 열 자동 탐지
  var RECIPIENT_KEYWORDS = [
    "받는분",
    "받는사람",
    "수령인",
    "고객명",
    "받으시는",
    "수하인",
    "수취인",
  ];
  var recipientCol = -1;
  for (var hi = 0; hi < headers.length; hi++) {
    var h = String(headers[hi] || "").replace(/\s/g, "");
    for (var ki = 0; ki < RECIPIENT_KEYWORDS.length; ki++) {
      if (h.indexOf(RECIPIENT_KEYWORDS[ki]) !== -1) {
        recipientCol = hi;
        break;
      }
    }
    if (recipientCol !== -1) break;
  }
  if (recipientCol === -1) {
    return ui.alert(
      "❌ 수취인 열을 찾을 수 없습니다.\n\n" +
        "헤더: " +
        headers.slice(0, 10).join(", ") +
        "\n\n" +
        "인식 키워드: " +
        RECIPIENT_KEYWORDS.join(", "),
    );
  }

  // 6) 제품명 열 탐지 (이름 중복 시 제품명으로 추가 매칭용)
  var productColInForm = -1;
  if (hasProductHint) {
    var PRODUCT_KEYWORDS = ["품목명", "상품명", "제품명", "품명", "상품", "품목", "아이템", "item", "product", "sku", "코드"];
    for (var phi = 0; phi < headers.length; phi++) {
      var ph = String(headers[phi] || "").replace(/\s/g, "").toLowerCase();
      for (var pki = 0; pki < PRODUCT_KEYWORDS.length; pki++) {
        if (ph.indexOf(PRODUCT_KEYWORDS[pki]) !== -1) {
          productColInForm = phi;
          break;
        }
      }
      if (productColInForm !== -1) break;
    }
  }

  // 6-2) 이름 → 행 인덱스 매핑
  var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
  var nameToRows = {};
  for (var ri = 0; ri < data.length; ri++) {
    var rName = String(data[ri][recipientCol] || "").trim();
    if (!rName) continue;
    if (!nameToRows[rName]) nameToRows[rName] = [];
    nameToRows[rName].push(ri);
  }

  // 7) 매칭 (완전 일치 → 부분 일치, 이름 중복 시 제품명으로 추가 분기)
  var matched = [],
    unmatched = [];

  // 제품힌트로 단일 행 좁히기 헬퍼
  function _narrowByProduct_(rowIdxArr, productHint) {
    if (!productHint || productColInForm === -1 || rowIdxArr.length <= 1) return rowIdxArr;
    var hint = productHint.replace(/\s/g, "").toLowerCase();
    // 완전 포함 우선
    var exact = rowIdxArr.filter(function(ri) {
      var pv = String(data[ri][productColInForm] || "").replace(/\s/g, "").toLowerCase();
      return pv.indexOf(hint) !== -1 || hint.indexOf(pv) !== -1;
    });
    if (exact.length >= 1 && exact.length < rowIdxArr.length) return exact;
    // 앞 6자 부분 매칭
    var partial = rowIdxArr.filter(function(ri) {
      var pv = String(data[ri][productColInForm] || "").replace(/\s/g, "").toLowerCase().substring(0, 8);
      var hintShort = hint.substring(0, 8);
      return pv === hintShort;
    });
    if (partial.length >= 1 && partial.length < rowIdxArr.length) return partial;
    return rowIdxArr; // 좁히기 실패 → 전체 반환
  }

  for (var pi = 0; pi < pairs.length; pi++) {
    var p = pairs[pi];
    var rows = nameToRows[p.name];
    if (rows && rows.length > 0) {
      var narrowed = _narrowByProduct_(rows, p.productHint || "");
      matched.push({
        tracking: p.tracking,
        name: p.name,
        matchedName: p.name,
        rows: narrowed,
        productHint: p.productHint || "",
        narrowed: narrowed.length < rows.length,
      });
    } else {
      // 부분 일치 탐색
      var partialKey = null;
      for (var nm in nameToRows) {
        if (nm.indexOf(p.name) !== -1 || p.name.indexOf(nm) !== -1) {
          partialKey = nm;
          break;
        }
      }
      if (partialKey) {
        var narrowed2 = _narrowByProduct_(nameToRows[partialKey], p.productHint || "");
        matched.push({
          tracking: p.tracking,
          name: p.name,
          matchedName: partialKey,
          rows: narrowed2,
          productHint: p.productHint || "",
          narrowed: narrowed2.length < nameToRows[partialKey].length,
        });
      } else {
        unmatched.push(p);
      }
    }
  }

  // 8) 미리보기
  var narrowedCount = matched.filter(function(m) { return m.narrowed; }).length;
  var previewLines = [
    "수취인 열: " + (recipientCol + 1) + "번째 열 「" + headers[recipientCol] + "」" +
    (productColInForm !== -1 ? "  |  제품열: " + (productColInForm + 1) + "번째 「" + headers[productColInForm] + "」" : "") + "\n",
    "✅ 매칭: " + matched.length + "건  |  ❌ 미매칭: " + unmatched.length + "건" +
    (narrowedCount > 0 ? "  |  🎯 제품명으로 좁힘: " + narrowedCount + "건" : "") + "\n",
  ];
  for (var mi = 0; mi < Math.min(matched.length, 12); mi++) {
    var m = matched[mi];
    var rowNums = m.rows
      .map(function (r) {
        return r + 2;
      })
      .join(",");
    var nameStr =
      m.name === m.matchedName ? m.name : m.name + "≈" + m.matchedName;
    var narrowTag = m.narrowed ? " 🎯" : (m.rows.length > 1 ? " (" + m.rows.length + "행)" : "");
    previewLines.push(
      "✅ " + nameStr + " → " + m.tracking + " (행:" + rowNums + ")" + narrowTag,
    );
  }
  if (matched.length > 12)
    previewLines.push("  ... 외 " + (matched.length - 12) + "건");
  if (unmatched.length > 0) {
    previewLines.push("\n❌ 미매칭 (전용양식에 이름 없음):");
    for (var umi = 0; umi < Math.min(unmatched.length, 5); umi++) {
      previewLines.push(
        "  " + unmatched[umi].name + " / " + unmatched[umi].tracking,
      );
    }
  }

  var confirm = ui.alert(
    "📋 매칭 결과 미리보기",
    previewLines.join("\n") + "\n\n적용할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (confirm !== ui.Button.YES) return;

  // 9) A열(송장번호) 기입 — ★ 수량 기반 1:1 분배
  //    같은 이름의 여러 송장을 행에 1:1 배정 (제품힌트 스코어 기반 우선 배정)

  // 9-1) 수량 열 탐지 (택배수량/수량)
  var qtyCol = -1;
  var QTY_KEYWORDS = ["택배수량", "수량", "qty"];
  for (var qi = 0; qi < headers.length; qi++) {
    var qh = String(headers[qi] || "").replace(/\s/g, "").toLowerCase();
    for (var qki = 0; qki < QTY_KEYWORDS.length; qki++) {
      if (qh.indexOf(QTY_KEYWORDS[qki]) !== -1) { qtyCol = qi; break; }
    }
    if (qtyCol !== -1) break;
  }

  // 9-2) 같은 이름으로 매칭된 송장들을 그룹핑
  var nameGroupMap = {}; // matchedName → [{tracking, productHint, rows}]
  for (var wi = 0; wi < matched.length; wi++) {
    var wm = matched[wi];
    var gn = wm.matchedName;
    if (!nameGroupMap[gn]) nameGroupMap[gn] = { trackings: [], rows: wm.rows };
    nameGroupMap[gn].trackings.push({ tracking: wm.tracking, productHint: wm.productHint || "" });
  }

  // 9-3) 각 이름 그룹별 1:1 배정
  var writeCount = 0;
  var usedInvSet = {}; // 송장번호 중복 방지

  for (var gn in nameGroupMap) {
    var group = nameGroupMap[gn];
    var gTrackings = group.trackings;
    var gRows = group.rows;

    if (gTrackings.length === 0 || gRows.length === 0) continue;

    // ★ 행을 슬롯으로 확장: 수량이 있으면 qty개 슬롯, 없으면 1개
    var rowSlots = []; // [{rowIdx, product, qty}]
    for (var ri = 0; ri < gRows.length; ri++) {
      var rowIdx = gRows[ri];
      var rowProduct = productColInForm !== -1 ? String(data[rowIdx][productColInForm] || "") : "";
      var rowQty = 1;
      if (qtyCol !== -1) {
        var rawQ = Number(data[rowIdx][qtyCol]);
        if (isFinite(rawQ) && rawQ >= 1) rowQty = Math.floor(rawQ);
      }
      rowSlots.push({ rowIdx: rowIdx, product: rowProduct, qty: rowQty });
    }

    // ★ 송장 수 ≤ 1이면 기존처럼 전체 행에 동일 송장
    if (gTrackings.length === 1) {
      for (var s1 = 0; s1 < rowSlots.length; s1++) {
        data[rowSlots[s1].rowIdx][0] = String(gTrackings[0].tracking);
        writeCount++;
      }
      continue;
    }

    // ★ 송장 수 > 1: 수량 기반 1:1 분배
    // 행별 필요 슬롯 수 계산
    var totalNeedSlots = 0;
    for (var ns = 0; ns < rowSlots.length; ns++) totalNeedSlots += rowSlots[ns].qty;

    // 송장이 충분하면 품목별 스코어 기반 배정
    // 각 행에 자기 수량만큼 송장 배정
    var availableInvs = gTrackings.slice(); // 복사
    var invIdx = 0;

    // 제품힌트가 있는 경우: 행의 품목명과 송장의 productHint로 스코어 매칭
    for (var rs = 0; rs < rowSlots.length; rs++) {
      var slot = rowSlots[rs];
      var needQty = slot.qty;
      var rowInvs = [];

      // 이 행에 배정할 송장 선택
      for (var q = 0; q < needQty && availableInvs.length > 0; q++) {
        // 제품힌트가 있으면 스코어 기반 best 선택
        var bestIdx2 = 0;
        var bestScore2 = -9999;
        if (slot.product && productColInForm !== -1) {
          for (var ai = 0; ai < availableInvs.length; ai++) {
            var hint = availableInvs[ai].productHint;
            if (!hint) continue;
            var sc = _kakao_productScore_(hint, slot.product);
            if (sc > bestScore2) { bestScore2 = sc; bestIdx2 = ai; }
          }
        }
        var picked = availableInvs.splice(bestIdx2, 1)[0];
        rowInvs.push(picked.tracking);
      }

      // A열에 송장번호 기입 (여러 개면 줄바꿈)
      if (rowInvs.length > 0) {
        data[slot.rowIdx][0] = rowInvs.join("\n");
        writeCount++;
      }
    }

    // 남은 송장이 있으면 마지막 행에 추가
    if (availableInvs.length > 0 && rowSlots.length > 0) {
      var lastRow = rowSlots[rowSlots.length - 1].rowIdx;
      var existing = String(data[lastRow][0] || "").trim();
      var extras = availableInvs.map(function(a) { return a.tracking; }).join("\n");
      data[lastRow][0] = existing ? existing + "\n" + extras : extras;
    }
  }

  exTab.getRange(2, 1, data.length, lc).setValues(data);
  SpreadsheetApp.flush();

  ui.alert(
    "✅ 완료\n\n" +
      "파일: " +
      targetFile.name +
      "\n" +
      "기입: " +
      writeCount +
      "행\n" +
      "미매칭: " +
      unmatched.length +
      "건",
  );
}

/** 카카오 매칭용 간단 제품 스코어 (productHint vs 전용양식 품목명) */
function _kakao_productScore_(hint, product) {
  var h = String(hint || "").replace(/\s/g, "").toUpperCase();
  var p = String(product || "").replace(/\s/g, "").toUpperCase();
  if (!h || !p) return 0;
  if (p.indexOf(h) !== -1 || h.indexOf(p) !== -1) return 100;
  // 토큰 매칭
  var tokens = h.match(/[A-Z0-9가-힣]+/g) || [];
  var score = 0;
  for (var t = 0; t < tokens.length; t++) {
    if (p.indexOf(tokens[t]) !== -1) score += 10;
  }
  return score;
}

/**
 * ── 엑셀 탭 구분 데이터 파서: (송장번호, 이름, 제품힌트) 추출 ──
 * 엑셀에서 복붙한 탭(\t) 구분 데이터를 파싱.
 * 송장번호 열, 이름 열, 제품명/코드 열을 자동 탐지.
 * 반환: null이면 탭 데이터 아님 (텍스트 파서로 폴백)
 */
function _pep_parseInvoiceTableData_(text) {
  var lines = text.split(/[\r\n]+/)
    .map(function(l) { return l.trim(); })
    .filter(function(l) { return l.length > 0; });

  // 탭 포함 줄이 절반 이상이어야 테이블로 인식
  var tabCount = lines.filter(function(l) { return l.indexOf('\t') !== -1; }).length;
  if (tabCount < Math.max(1, lines.length * 0.4)) return null;

  var rows = lines.map(function(l) { return l.split('\t').map(function(c) { return c.trim(); }); });
  var colLen = rows.reduce(function(mx, r) { return Math.max(mx, r.length); }, 0);
  if (colLen < 2) return null;

  // ① 송장번호 열 탐지: 10~14자리 숫자가 가장 많은 열
  function isTracking(v) {
    var d = String(v || '').replace(/[\-\s]/g, '');
    return /^\d{10,14}$/.test(d);
  }
  var trackingCol = -1, bestTrackingCount = 0;
  for (var ci = 0; ci < colLen; ci++) {
    var cnt = 0;
    for (var ri = 0; ri < rows.length; ri++) {
      if (isTracking(rows[ri][ci] || '')) cnt++;
    }
    if (cnt > bestTrackingCount) { bestTrackingCount = cnt; trackingCol = ci; }
  }
  if (trackingCol === -1 || bestTrackingCount === 0) return null;

  // ② 이름 열 탐지: 한글 2~6자 비율 가장 높은 열 (송장 열 제외)
  function looksLikeName(v) {
    var s = String(v || '').trim();
    return /^[가-힣a-zA-Z]{1,8}$/.test(s) && s.length >= 1;
  }
  var nameCol = -1, bestNameScore = 0;
  for (var ci2 = 0; ci2 < colLen; ci2++) {
    if (ci2 === trackingCol) continue;
    var score = 0;
    for (var ri2 = 0; ri2 < rows.length; ri2++) {
      var v = rows[ri2][ci2] || '';
      if (looksLikeName(v)) score++;
      else if (isTracking(v)) score -= 5; // 숫자열이면 감점
    }
    if (score > bestNameScore) { bestNameScore = score; nameCol = ci2; }
  }
  if (nameCol === -1) return null;

  // ③ 제품 힌트 열 탐지: 송장/이름 제외, 가장 긴 텍스트가 많은 열 (제품명)
  var productCol = -1, bestProductScore = 0;
  for (var ci3 = 0; ci3 < colLen; ci3++) {
    if (ci3 === trackingCol || ci3 === nameCol) continue;
    var pscore = 0;
    for (var ri3 = 0; ri3 < rows.length; ri3++) {
      var pv = String(rows[ri3][ci3] || '').trim();
      if (pv.length >= 3 && !isTracking(pv)) pscore += pv.length;
    }
    if (pscore > bestProductScore) { bestProductScore = pscore; productCol = ci3; }
  }

  // ④ 파싱
  var pairs = [];
  for (var ri4 = 0; ri4 < rows.length; ri4++) {
    var tRaw = String(rows[ri4][trackingCol] || '').replace(/[\-\s]/g, '');
    if (!/^\d{10,14}$/.test(tRaw)) continue;
    var name = String(rows[ri4][nameCol] || '').trim();
    if (!name) continue;
    var productHint = productCol !== -1 ? String(rows[ri4][productCol] || '').trim() : '';
    pairs.push({ tracking: tRaw, name: name, productHint: productHint });
  }
  return pairs.length > 0 ? { pairs: pairs, trackingCol: trackingCol, nameCol: nameCol, productCol: productCol } : null;
}

/**
 * ★ 2026-06-18: 편집 거리(Levenshtein Distance) — 유사도 기반 매칭용
 * 두 문자열 사이의 최소 편집 횟수(삽입/삭제/치환) 반환
 */
function _pep_levenshtein_(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  var m = a.length, n = b.length;
  // 메모리 최적화: 2행 배열만 사용
  var prev = [], curr = [];
  for (var j = 0; j <= n; j++) prev[j] = j;
  for (var i = 1; i <= m; i++) {
    curr[0] = i;
    for (var j = 1; j <= n; j++) {
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // 삭제
        curr[j - 1] + 1,   // 삽입
        prev[j - 1] + cost  // 치환
      );
    }
    var tmp = prev; prev = curr; curr = tmp;
  }
  return prev[n];
}

/**
 * ── 텍스트 파서: (송장번호, 이름) 쌍 추출 ──
 * 10~14자리 숫자 = 송장번호, 한글/영문 텍스트 = 이름
 * ★ 2026-06-18: 인라인 파싱 + 영문 이름 지원 추가
 */
function _pep_parseInvoiceNamePairs_(text) {
  // ★ 택배사명 패턴 — 송장번호 앞뒤에 붙는 노이즈 제거용
  var COURIER_NAMES = /[|｜\s]*(롯데택배|CJ대한통운|한진택배|우체국택배|로젠택배|경동택배|대신택배|일양로지스|천일택배|합동택배|건영택배|호남택배|CVSnet|GSpostbox|CJ택배|택배)/gi;

  // ★ 2026-06-18: "택배사명 / " 프리픽스 제거 (거래명세서 운송방법 대응)
  // "롯데 / ", "CJ / ", "한진 / " 등 → 제거. "롯데약국" 같은 이름은 보호
  var COURIER_PREFIX = /^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\s*[\/]\s*/gim;

  // ★ 2026-06-18: 거래명세서 노이즈 줄 제거 (사업자등록번호, 전화, FAX 등)
  var NOISE_LINE_PATTERNS = /^.*(등록번호|사업자|TEL|FAX|전화|팩스|계좌|은행|입금바랍니다|거래명세서|공급가액|부가세|합계|수량|단가|품목|규격|거래일|상\s*호|업\s*태|종\s*목|주\s*소|성\s*명).*$/gim;

  // ★ 전처리: 택배사명 + 프리픽스 + 거래명세서 노이즈 제거
  var preprocessed = text.replace(COURIER_NAMES, "").replace(COURIER_PREFIX, "").replace(NOISE_LINE_PATTERNS, "");

  // 줄 분리
  var lines = preprocessed
    .split(/[\r\n]+/)
    .map(function (l) {
      return l.replace(/\t/g, "   ").trim();
    })
    .filter(function (l) {
      return l.length > 0;
    });

  var pairs = [];
  var pendingTracking = null; // 번호만 있는 줄이 앞에 왔을 때 대기

  // ★ 1단계: 번호만 있는 줄과 이름만 있는 줄을 각각 수집
  var trackingLines = []; // 송장번호 목록 (순서대로)
  var nameLines = [];     // 이름 목록 (순서대로)
  var pairedLines = [];   // 한 줄에 번호+이름 쌍이 있는 경우

  // ★ 헬퍼: 하이픈 포함 송장번호에서 순수 숫자 추출 + 10~14자리 검증
  // ★ 2026-06-18: 사업자등록번호(xxx-xx-xxxxx), 전화번호, FAX 필터 추가
  function _extractTracking(raw) {
    var trimmed = raw.trim();
    // 사업자등록번호 패턴: xxx-xx-xxxxx (3-2-5)
    if (/^\d{3}-\d{2}-\d{5}$/.test(trimmed)) return null;
    // 전화번호 패턴: 0xx-xxx-xxxx, 0xx-xxxx-xxxx
    if (/^0\d{1,2}-\d{3,4}-\d{4}$/.test(trimmed)) return null;
    var digits = trimmed.replace(/[\-\s]/g, "");
    if (/^\d{10,14}$/.test(digits)) return digits;
    return null;
  }

  // ★ 이름 정규화: "님", "|" 제거 + ★ 2026-06-18: "/" 제거, 앞뒤 공백 제거
  function _cleanName(n) {
    return n.replace(/[|｜\/]/g, "").replace(/\s*님\s*/g, "").trim();
  }

  // ★ 2026-06-18: 이름 유효성 검사 (한글 + 영문 모두 지원)
  function _isValidName(n) {
    if (!n || n.length < 2) return false;
    if (/^[\d\-\s]+$/.test(n)) return false; // 숫자만
    // 한글 이름: 2~15글자 (기관명 포함)
    if (/^[가-힣\s]{2,15}$/.test(n)) return true;
    // 영문 이름: 2글자 이상 영문 (한글+영문 혼합 불가)
    if (/^[A-Za-z\s]{2,30}$/.test(n)) return true;
    // 한글+영문+숫자 혼합 (기관명: "북한산1단지" 등)
    if (/[가-힣]/.test(n) && n.length >= 2 && n.length <= 20) return true;
    return false;
  }

  // ★ 2026-06-18: 노이즈 필터 제거 — 주소 입력 없이 글자=이름, 숫자=송장번호로 단순 인식

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // ★ 0단계: 인라인 파싱 — 한 줄에 "이름1 번호1 이름2 번호2 ..." 형태
    // 거래명세서 운송방법 섹션: "정현희 267096146273 이선미 267096146284 ..."
    var inlineMatches = line.match(/[A-Za-z가-힣\s]{2,30}\s+\d{10,14}/g);
    if (inlineMatches && inlineMatches.length >= 2) {
      // 한 줄에서 2쌍 이상 발견 → 인라인 모드로 전환
      for (var im = 0; im < inlineMatches.length; im++) {
        var imParts = inlineMatches[im].trim().match(/^(.+?)\s+(\d{10,14})$/);
        if (imParts) {
          var imName = _cleanName(imParts[1]);
          var imTrack = _extractTracking(imParts[2]);
          if (imTrack && _isValidName(imName)) {
            pairedLines.push({ tracking: imTrack, name: imName });
          } else if (imTrack) {
            trackingLines.push(imTrack);
          }
        }
      }
      // 인라인에서 못 잡은 단독 송장번호도 추출
      var remaining = line;
      for (var rm = 0; rm < inlineMatches.length; rm++) {
        remaining = remaining.replace(inlineMatches[rm], " ");
      }
      var soloNums = remaining.match(/\d{10,14}/g);
      if (soloNums) {
        for (var sn = 0; sn < soloNums.length; sn++) {
          var snTrack = _extractTracking(soloNums[sn]);
          if (snTrack) trackingLines.push(snTrack);
        }
      }
      continue;
    }

    // ① 한 줄에 "송장번호  이름" 형태
    var m1 = line.match(/^([\d\-]{10,20})\s{1,}(.+)$/);
    if (m1) {
      var t1 = _extractTracking(m1[1]);
      var name1 = _cleanName(m1[2]);
      if (t1 && _isValidName(name1)) {
        pairedLines.push({ tracking: t1, name: name1 });
        continue;
      } else if (t1) {
        trackingLines.push(t1);
        continue;
      }
    }

    // ② 한 줄에 "이름  송장번호" 형태
    var m2 = line.match(/^(.+?)\s{1,}([\d\-]{10,20})$/);
    if (m2) {
      var t2 = _extractTracking(m2[2]);
      var name2 = _cleanName(m2[1]);
      if (t2 && _isValidName(name2)) {
        pairedLines.push({ tracking: t2, name: name2 });
        continue;
      } else if (t2) {
        trackingLines.push(t2);
        continue;
      }
    }

    // ③ 번호만 있는 줄
    var soloTracking = _extractTracking(line);
    if (soloTracking && /^[\d\-]+$/.test(line.trim())) {
      trackingLines.push(soloTracking);
      continue;
    }

    // ④ 이름만 있는 줄 — 복수 이름이 공백으로 구분될 수 있음 (OCR 테이블 특성)
    var nameCandidates = line.split(/\s{2,}/);
    for (var ni = 0; ni < nameCandidates.length; ni++) {
      var nc = _cleanName(nameCandidates[ni]);
      // ★ 2026-06-18: 한글 + 영문 이름 모두 인식
      if (_isValidName(nc)) {
        nameLines.push(nc);
      }
    }
  }

  // ★ 2단계: 이미 쌍이 된 것은 바로 사용
  for (var pi = 0; pi < pairedLines.length; pi++) {
    pairs.push(pairedLines[pi]);
  }

  // ★ 3단계: 쌍 안 된 번호와 이름을 순서대로 매칭 (OCR 테이블 구조 복원)
  if (trackingLines.length > 0 && nameLines.length > 0) {
    var matchCount = Math.min(trackingLines.length, nameLines.length);
    for (var mi = 0; mi < matchCount; mi++) {
      pairs.push({ tracking: trackingLines[mi], name: nameLines[mi] });
    }
    // 남은 번호는 미매칭으로 버림 (이름 부족)
  } else if (trackingLines.length > 0 && nameLines.length === 0) {
    // ★ 폴백: 이전 방식 (번호 줄 → 다음 이름 줄 순서대로)
    pendingTracking = null;
    for (var fi = 0; fi < lines.length; fi++) {
      var fLine = lines[fi];
      var ft = _extractTracking(fLine);
      if (ft && /^[\d\-]+$/.test(fLine.trim())) {
        if (pendingTracking !== null) {
          // 연속 번호 → 이전 것 버림
        }
        pendingTracking = ft;
        continue;
      }
      var fName = _cleanName(fLine);
      if (_isValidName(fName)) {
        if (pendingTracking !== null) {
          pairs.push({ tracking: pendingTracking, name: fName });
          pendingTracking = null;
        }
      }
    }
  }

  return pairs;
}


/**
 * ── 전용양식 탭 내용만 초기화 ──

 * 소스 탭 협력Push UID는 유지(재Push 안 함),
 * 협력업체 파일의 전용양식 탭 데이터(2행~)만 삭제.
 * 용도: 전용양식을 받아서 발주 완료한 후 화면 정리용
 */
function partnerClearExclusiveFormOnly() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  // 1) 소스 탭 열기
  var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var srcTab = null;
  var srcSheets = srcSS.getSheets();
  for (var i = 0; i < srcSheets.length; i++) {
    if (srcSheets[i].getSheetId() === _PEP_SOURCE_TAB_GID) {
      srcTab = srcSheets[i];
      break;
    }
  }
  if (!srcTab) srcTab = srcSS.getSheetByName(_PEP_SOURCE_TAB_NAME);
  if (!srcTab) {
    if (ui) ui.alert("소스 탭을 찾을 수 없습니다.");
    return;
  }

  // 2) 협력Push 열 찾기
  var srcLr = srcTab.getLastRow();
  if (srcLr < 2) {
    if (ui) ui.alert("소스 탭에 데이터가 없습니다.");
    return;
  }
  var srcHdr = srcTab.getRange(1, 1, 1, srcTab.getLastColumn()).getValues()[0];
  var srcUidCol = -1;
  for (var hi = 0; hi < srcHdr.length; hi++) {
    var hn = String(srcHdr[hi] || "")
      .replace(/\s/g, "")
      .toLowerCase();
    if (hn === "협력push" || hn === "pep_uid") {
      srcUidCol = hi;
      break;
    }
  }
  if (srcUidCol === -1) {
    if (ui)
      ui.alert(
        "소스 탭에 '협력Push' 열이 없습니다.\n(아직 Push를 한 적이 없을 수 있습니다.)",
      );
    return;
  }

  // 3) 현재 UID 개수 확인
  var uidData = srcTab.getRange(2, srcUidCol + 1, srcLr - 1, 1).getValues();
  var filledCount = 0;
  for (var r = 0; r < uidData.length; r++) {
    if (String(uidData[r][0] || "").trim()) filledCount++;
  }
  if (filledCount === 0) {
    if (ui) ui.alert("협력Push 열이 이미 비어있습니다. (0건)");
    return;
  }

  // 4) 사용자 확인
  if (ui) {
    var ans = ui.alert(
      "🔄 협력Push UID만 초기화",
      "소스 탭 '협력Push' 열에 UID가 " +
        filledCount +
        "건 있습니다.\n\n" +
        "▸ 소스 탭 협력Push UID → 삭제 (재Push 가능)\n" +
        "▸ 전용양식 탭 기존 데이터 → 유지 (삭제 안 함)\n\n" +
        "오후 발주가 새로 들어왔을 때 재Push하기 위한 용도입니다.\n계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (ans !== ui.Button.YES) return;
  }

  // 5) UID만 삭제 (전용양식 건드리지 않음)
  var clearData = [];
  for (var c = 0; c < srcLr - 1; c++) clearData.push([""]);
  srcTab.getRange(2, srcUidCol + 1, srcLr - 1, 1).setValues(clearData);
  SpreadsheetApp.flush();

  var msg =
    "✅ 협력Push UID 초기화 완료\n" +
    "- UID 삭제: " +
    filledCount +
    "건\n\n" +
    "※ 전용양식 기존 데이터는 그대로입니다.\n" +
    "이제 '대리발주 Push'를 실행하면 새 발주가 전용양식에 추가됩니다.";
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

/**
 * ── 오후 재Push: 전용양식 AX 초기화 → Push ──
 *
 * 사용 시점:
 *   오후에 소스 탭(대리발송 탭)의 데이터를 새로 갱신(P열 값 포함 소멸)한 뒤
 *   전체 재Push가 필요할 때 사용.
 *
 * 처리 순서:
 *   1) 전용양식 탭 2행~ 삭제 (AX열 포함 완전 초기화)
 *   2) 소스 탭 P열(고유ID) 초기화 — 새 데이터에 맞게 UID 재생성 허용
 *   3) partnerPushOrdersToExclusiveForms 실행
 *
 * ※ 새 발주만 추가할 경우(기존 발주 유지)에는 이 메뉴 대신
 *    "4️⃣ 오후 대리공급업체로 발주 Push"를 그냥 실행하세요.
 */
function partnerAfternoonResetAndPush() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  if (ui) {
    var ans = ui.alert(
      "🔄 오후 재Push (전용양식 초기화 후 재발주)",
      "▸ 전용양식 탭 데이터(2행~) 전부 삭제 — AX 기존 UID 초기화\n" +
      "▸ 소스 탭 P열(고유ID) 초기화 — 새 UID 재생성 허용\n" +
      "▸ 대리공급업체로 발주 Push 실행\n" +
      "※ 임시기록(대리공급_임시기록)은 유지됩니다.\n\n" +
      "⚠ 이미 발주된 내용이 다시 전용양식에 들어갑니다.\n" +
      "소스 탭에 오늘 새 데이터가 반영된 상태일 때만 실행하세요.\n\n" +
      "계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (ans !== ui.Button.YES) return;
  }

  // 1) 전용양식 탭 초기화 (AX 포함)
  var files = _pt_listFiles();
  var clearedTabs = 0;
  for (var fi = 0; fi < files.length; fi++) {
    try {
      var vendorSS = SpreadsheetApp.openById(files[fi].id);
      var tabs = vendorSS.getSheets();
      for (var ti = 0; ti < tabs.length; ti++) {
        if (tabs[ti].getName().indexOf("전용양식") !== -1) {
          var lr = tabs[ti].getLastRow();
          if (lr >= 2) {
            tabs[ti].deleteRows(2, lr - 1);
            clearedTabs++;
          }
        }
      }
    } catch (eV) {
      Logger.log("[AfternoonReset] 전용양식 초기화 실패: " + files[fi].name + " / " + eV.message);
    }
  }

  // ★ 2026-07-06: 임시기록 초기화 제거 — 오전+오후 데이터 보존 필요
  // 임시기록은 대리공급 마감 시에만 정리됨
  var _tempCleared_ = 0;

  // 2) 소스 탭 P열 초기화
  var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var srcTab = null;
  var srcSheets = srcSS.getSheets();
  for (var i = 0; i < srcSheets.length; i++) {
    if (srcSheets[i].getSheetId() === _PEP_SOURCE_TAB_GID) {
      srcTab = srcSheets[i];
      break;
    }
  }
  if (!srcTab) srcTab = srcSS.getSheetByName(_pep_getSourceTabName_());
  var pCleared = 0;
  if (srcTab && srcTab.getLastRow() >= 2) {
    var srcLr = srcTab.getLastRow();
    var pVals = srcTab.getRange(2, 16, srcLr - 1, 1).getValues();
    var pClear = [];
    for (var pi = 0; pi < pVals.length; pi++) {
      var pv = String(pVals[pi][0] || "").trim();
      // 자동 생성 UID만 초기화 (MMdd- 패턴). 사방넷 원본 UID는 유지.
      if (pv && /^\d{4}-[A-Z]{2}-/.test(pv)) {
        pClear.push([""]);
        pCleared++;
      } else {
        pClear.push([pv]);
      }
    }
    srcTab.getRange(2, 16, srcLr - 1, 1).setValues(pClear);
  }

  SpreadsheetApp.flush();
  Logger.log("[AfternoonReset] 전용양식 초기화: " + clearedTabs + "탭, 임시기록: 유지(삭제 안 함), P열 초기화: " + pCleared + "건");

  // 3) Push 실행
  partnerPushOrdersToExclusiveForms();
}

/**
 * ★ 2026-07-06: 임시기록 강제 재생성 (소스 탭 데이터 → 임시기록 직접 기록)
 * 임시기록 저장 버그로 데이터가 누락된 경우 복구용
 * 전용양식 Push는 하지 않고, 임시기록만 재생성
 */
function partnerRebuildTempRecords() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  if (ui) {
    var ans = ui.alert(
      "🔧 임시기록 강제 재생성",
      "소스 탭(대리공급업체 발주)의 데이터를 읽어서\n" +
      "대리공급_임시기록 탭에 강제 기록합니다.\n\n" +
      "※ 기존 임시기록을 비우고 새로 씁니다.\n" +
      "※ 전용양식 Push는 하지 않습니다.\n\n" +
      "계속할까요?",
      ui.ButtonSet.YES_NO
    );
    if (ans !== ui.Button.YES) return;
  }

  // 1) 소스 탭 읽기
  var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var srcTab = null;
  var srcSheets = srcSS.getSheets();
  for (var i = 0; i < srcSheets.length; i++) {
    if (srcSheets[i].getSheetId() === _PEP_SOURCE_TAB_GID) {
      srcTab = srcSheets[i]; break;
    }
  }
  if (!srcTab) srcTab = srcSS.getSheetByName(_pep_getSourceTabName_());
  if (!srcTab || srcTab.getLastRow() < 2) {
    if (ui) ui.alert("소스 탭에 데이터가 없습니다.");
    return;
  }

  // 2) 허브 + 임시탭 준비
  // ★ 2026-07-06: 임시기록은 상품정보 시트에 저장 (HUB 아님!)
  var hubSS = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var tempTab = _pep_ensureNonPartnerTempTab_(hubSS);
  if (!tempTab) {
    if (ui) ui.alert("임시기록 탭을 생성할 수 없습니다.");
    return;
  }

  // ★ 기존 데이터 완전 삭제 (clearContent + deleteRows로 빈 행 제거)
  var oldLr = tempTab.getLastRow();
  if (oldLr >= 2) {
    tempTab.getRange(2, 1, oldLr - 1, tempTab.getMaxColumns()).clearContent();
    try { tempTab.deleteRows(2, oldLr - 1); } catch (e) {}
  }
  Logger.log("[REBUILD_TEMP] 기존 임시기록 삭제 완료 (oldRows=" + (oldLr - 1) + ")");

  // 3) 소스 데이터 읽기 + 임시기록 행 생성
  var srcLr = srcTab.getLastRow();
  var srcLc = Math.max(srcTab.getLastColumn(), 20);
  var srcAll = srcTab.getRange(1, 1, srcLr, srcLc).getValues();
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  var pendingRows = [];
  var seenKeys = {}; // 소스 내 중복 방지
  var srcDupes = 0;
  var noCode = 0;

  for (var ri = 1; ri < srcAll.length; ri++) {
    var row = srcAll[ri];
    var rawCode = String(row[_PEP_CODE_COL] || "").trim();
    var rawName = String(row[_PEP_ITEM_COL] || "").trim();
    if (!rawCode) { noCode++; continue; }

    // ★ 2026-08-25: 보조 접두(JH/BF 등)는 대표 접두(JT)로 환산 후 판정
    var codePfx = rawCode.length >= 2 ? _pep_resolvePrefixAlias_(rawCode.substring(0, 2)) : "";
    var namePfx = "";
    // ★ 2026-07-14: 품목명 앞 영문 2글자 인식 보완 (한글/공백/대괄호 등 제외한 가장 처음에 등장하는 영문 2글자)
    var m = rawName.replace(/^[^a-zA-Z]*/, "").match(/^([a-zA-Z]{2})/);
    if (m) namePfx = _pep_resolvePrefixAlias_(m[1]);

    var pfx = "";
    // 1순위: 이카운트코드 앞 2자리(codePfx)가 유효한 대리공급업체 코드(DIRECT_MAP 또는 LABELS)인 경우
    if (codePfx && (_PEP_VENDOR_DIRECT_MAP_[codePfx] || _PEP_VENDOR_LABELS_[codePfx])) {
      pfx = codePfx;
    }
    // 2순위: 1순위 코드 제외 시 품목명 앞 영문 2글자(namePfx)가 유효한 대리공급업체 코드인 경우
    else if (namePfx && (_PEP_VENDOR_DIRECT_MAP_[namePfx] || _PEP_VENDOR_LABELS_[namePfx])) {
      pfx = namePfx;
    }

    if (!pfx) continue; // ★ 유효한 대리공급업체가 아니면 스킵

    var rowUid = String(row[15] || "").trim();
    if (!rowUid) {
      rowUid = _pep_deriveDeterministicUid_(row, today.replace(/-/g, ""));
    }

    // 소스 내 중복만 체크
    var compositeKey = rowUid + "|" + rawCode;
    if (seenKeys[compositeKey]) {
      srcDupes++;
      continue;
    }
    seenKeys[compositeKey] = true;

    // 임시기록 행 생성 (22열 + pfx + "" + "발주완료")
    var tRow = [];
    for (var ci = 0; ci < 22; ci++) {
      // V(21)은 택배사 열 — 소스탭 값으로 덮지 않는다 (송장수집이 채운다)
      if (ci === 21) { tRow.push(""); continue; }
      tRow.push(ci < row.length ? row[ci] : "");
    }
    tRow[15] = rowUid;
    tRow.push(pfx); // ★ 2026-07-14: codePfx 대신 검증된 pfx 사용
    tRow.push("");
    tRow.push("발주완료");
    pendingRows.push(tRow);
  }

  // 4) 배치 쓰기
  if (pendingRows.length > 0) {
    var maxCols = 0;
    for (var pi = 0; pi < pendingRows.length; pi++) {
      if (pendingRows[pi].length > maxCols) maxCols = pendingRows[pi].length;
    }
    for (var pi2 = 0; pi2 < pendingRows.length; pi2++) {
      while (pendingRows[pi2].length < maxCols) pendingRows[pi2].push("");
    }
    try {
      tempTab.getRange(2, 1, pendingRows.length, maxCols).setValues(pendingRows);
      SpreadsheetApp.flush(); // ★ 강제 flush
      Logger.log("[REBUILD_TEMP] 배치 쓰기 완료: " + pendingRows.length + "건");
    } catch (writeErr) {
      Logger.log("[REBUILD_TEMP] 쓰기 오류: " + writeErr.message);
      if (ui) ui.alert("❌ 쓰기 오류: " + writeErr.message);
      return;
    }
  }

  // ★ 검증: 실제 기록된 데이터 확인
  var verifyLr = tempTab.getLastRow();
  var verifyUrl = hubSS.getUrl() + "#gid=" + tempTab.getSheetId();
  var verifySample = "";
  if (verifyLr >= 2) {
    var sampleData = tempTab.getRange(2, 4, Math.min(3, verifyLr - 1), 1).getValues();
    verifySample = sampleData.map(function(r) { return r[0]; }).join(", ");
  }

  var msg = "🔧 임시기록 강제 재생성 완료\n" +
    "- 소스 전체: " + (srcAll.length - 1) + "행\n" +
    "- 기록: " + pendingRows.length + "건\n" +
    "- 코드없음 스킵: " + noCode + "건\n" +
    "- 소스내 중복: " + srcDupes + "건\n\n" +
    "▶ 검증: 임시기록 탭 행수=" + verifyLr + "\n" +
    "▶ 샘플(D열): " + verifySample + "\n" +
    "▶ 시트: " + hubSS.getName() + "\n" +
    "▶ 탭명: " + tempTab.getName() + "\n" +
    "▶ URL: " + verifyUrl;
  Logger.log("[REBUILD_TEMP] " + msg);
  if (ui) ui.alert(msg);
}

// ═════════════════════════════════════════════
//  카카오 로컬 API — 주소 → 우편번호 변환
// ═════════════════════════════════════════════

/**
 * 카카오 로컬 API REST API 키 설정/조회
 * 메뉴에서 수동 실행하여 API 키를 PropertiesService에 저장
 */
function partnerSetKakaoApiKey() {
  var ui = SpreadsheetApp.getUi();
  var current = _pep_getKakaoApiKey_();
  var resp = ui.prompt(
    "🔑 카카오 REST API 키 설정",
    "현재: " + (current ? current.substring(0, 8) + "..." : "(미설정)") +
      "\n\n카카오 Developers → 내 애플리케이션 → 앱 키 → REST API 키를 입력하세요:",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var key = resp.getResponseText().trim();
  if (!key) return ui.alert("❌ API 키가 비어있습니다.");
  PropertiesService.getScriptProperties().setProperty("KAKAO_REST_API_KEY", key);
  ui.alert("✅ 카카오 API 키 저장 완료: " + key.substring(0, 8) + "...");
}

/**
 * PropertiesService에서 카카오 API 키 조회
 */
function _pep_getKakaoApiKey_() {
  var _DEFAULT_KEY = "938cf6d53b7227377c4b66fc3fee70dd";
  try {
    var saved = PropertiesService.getScriptProperties().getProperty("KAKAO_REST_API_KEY");
    return saved || _DEFAULT_KEY;
  } catch (e) { return _DEFAULT_KEY; }
}

/**
 * 카카오 로컬 API로 주소 → 우편번호(5자리) 변환
 * 특별자치도 등 신규 행정구역명 자동 정규화 포함
 * @param {string} address 주소 문자열
 * @return {string} 우편번호 (없으면 "")
 */
function _pep_getZipCodeFromKakao_(address) {
  if (!address) return "";
  var apiKey = _pep_getKakaoApiKey_();
  if (!apiKey) { Logger.log("[PEP] 카카오 API 키 미설정"); return ""; }

  var ADDR_NORM = [
    [/강원특별자치도/g, "강원도"],
    [/전북특별자치도/g, "전라북도"],
    [/전남특별자치도/g, "전라남도"],
    [/경북특별자치도/g, "경상북도"],
    [/충북특별자치도/g, "충청북도"],
    [/제주특별자치도/g, "제주도"],
    [/세종특별자치시/g, "세종시"]
  ];

  function _tryAddr(q) {
    var u = "https://dapi.kakao.com/v2/local/search/address.json?query=" + encodeURIComponent(q);
    var r = UrlFetchApp.fetch(u, { headers: { "Authorization": "KakaoAK " + apiKey }, muteHttpExceptions: true });
    var c = r.getResponseCode();
    Logger.log("[PEP] 카카오: HTTP " + c + " q=[" + q.substring(0, 30) + "]");
    if (c !== 200) { Logger.log("[PEP] 카카오 body: " + r.getContentText().substring(0, 200)); return null; }
    var j = JSON.parse(r.getContentText());
    if (j.documents && j.documents.length > 0) {
      var d = j.documents[0];
      if (d.road_address && d.road_address.zone_no) return d.road_address.zone_no;
      if (d.address && d.address.zip_code) return d.address.zip_code;
    }
    return null;
  }

  try {
    // 1차: 원본 주소
    var result = _tryAddr(address);
    if (result) return result;

    // 2차: 정규화 (특별자치도 → 구형명)
    var norm = address;
    for (var i = 0; i < ADDR_NORM.length; i++) norm = norm.replace(ADDR_NORM[i][0], ADDR_NORM[i][1]);
    if (norm !== address) {
      Logger.log("[PEP] 주소 정규화 재시도: " + norm.substring(0, 30));
      result = _tryAddr(norm);
      if (result) return result;
    }

    // 3차: 키워드 검색 폴백
    var u2 = "https://dapi.kakao.com/v2/local/search/keyword.json?query=" + encodeURIComponent(address);
    var r2 = UrlFetchApp.fetch(u2, { headers: { "Authorization": "KakaoAK " + apiKey }, muteHttpExceptions: true });
    if (r2.getResponseCode() === 200) {
      var j2 = JSON.parse(r2.getContentText());
      if (j2.documents && j2.documents.length > 0 && j2.documents[0].road_address_name) {
        return _tryAddr(j2.documents[0].road_address_name) || "";
      }
    }
    return "";
  } catch (e) {
    Logger.log("[PEP] 카카오 API 오류: " + e.message);
    return "";
  }
}

// ═════════════════════════════════════════════
//  ★ 2026-07-17 (M4): 주소→우편번호 영구 캐시
//  같은 수취인 주소가 매일 반복 조회되므로 ScriptProperties에 누적 저장.
//  - 성공(우편번호 있음) 결과만 영구 저장 — 실패는 실행 내 캐시로만
//  - 대량 행에서도 신규 주소만 API 호출 → 6분 한도·쿼터 압박 해소
// ═════════════════════════════════════════════
var _PEP_ZIP_CACHE_PROP_ = "_PEP_ZIP_CACHE_V1_";
var _PEP_ZIP_CACHE_MAX_ = 1500; // Properties 총 500KB 한도 보호
var _PEP_ZIP_CACHE_MEM_ = null;
var _PEP_ZIP_CACHE_DIRTY_ = false;

function _pep_zipCacheLoad_() {
  if (_PEP_ZIP_CACHE_MEM_) return _PEP_ZIP_CACHE_MEM_;
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(_PEP_ZIP_CACHE_PROP_);
    _PEP_ZIP_CACHE_MEM_ = raw ? JSON.parse(raw) : {};
  } catch (_) { _PEP_ZIP_CACHE_MEM_ = {}; }
  return _PEP_ZIP_CACHE_MEM_;
}

/** 실행 종료 전 1회 호출 — 신규 항목이 있을 때만 저장 */
function _pep_zipCacheSave_() {
  if (!_PEP_ZIP_CACHE_DIRTY_ || !_PEP_ZIP_CACHE_MEM_) return;
  try {
    var keys = Object.keys(_PEP_ZIP_CACHE_MEM_);
    if (keys.length > _PEP_ZIP_CACHE_MAX_) {
      // 초과분 앞쪽(오래된 삽입 순)부터 제거
      var drop = keys.length - _PEP_ZIP_CACHE_MAX_;
      for (var i = 0; i < drop; i++) delete _PEP_ZIP_CACHE_MEM_[keys[i]];
    }
    PropertiesService.getScriptProperties().setProperty(
      _PEP_ZIP_CACHE_PROP_, JSON.stringify(_PEP_ZIP_CACHE_MEM_));
    _PEP_ZIP_CACHE_DIRTY_ = false;
  } catch (eSave) {
    Logger.log("[PEP] 우편번호 캐시 저장 실패: " + eSave.message);
  }
}

/**
 * 주소→우편번호 (영구 캐시 우선, 미스 시 Kakao API + 120ms 대기)
 * @returns {string} 우편번호 또는 ""
 */
function _pep_getZipCodeCached_(addr) {
  var key = String(addr || "").replace(/\s+/g, " ").trim();
  if (!key) return "";
  var cache = _pep_zipCacheLoad_();
  if (cache[key]) return cache[key]; // 성공 결과만 저장돼 있음
  var zip = "";
  try { zip = _pep_getZipCodeFromKakao_(key) || ""; } catch (_) { zip = ""; }
  if (zip) {
    cache[key] = zip;
    _PEP_ZIP_CACHE_DIRTY_ = true;
  }
  Utilities.sleep(120); // API rate limit 보호
  return zip;
}

// ═════════════════════════════════════════════
//  JM 전용양식 배치 채우기 (수동입력 후 우편번호+택배비 일괄 적용)
// ═════════════════════════════════════════════

/**
 * 제이엠 전용양식에서 수동 입력된 행의 우편번호(L열)+택배비(P열)를 일괄 채우기
 * 메뉴: 협력업체 관리 → 전용양식 우편번호/택배비 채우기
 */
function partnerJmFillZipAndShipping() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    ui.alert("⚠ 다른 작업 진행 중. 잠시 후 다시 시도해주세요.");
    return;
  }

  try {
    var files = _pt_listFiles();
    var jmFile = null;
    for (var fi = 0; fi < files.length; fi++) {
      if (files[fi].name.indexOf("제이엠") !== -1) {
        jmFile = files[fi];
        break;
      }
    }
    if (!jmFile) {
      ui.alert("❌ 제이엠 협력업체 파일을 찾을 수 없습니다.");
      return;
    }

    var ss = SpreadsheetApp.openById(jmFile.id);
    var tab = null;
    var allSheets = ss.getSheets();
    for (var si = 0; si < allSheets.length; si++) {
      if (allSheets[si].getName().indexOf("전용양식") !== -1) {
        tab = allSheets[si];
        break;
      }
    }
    if (!tab || tab.getLastRow() < 2) {
      ui.alert("❌ 전용양식 탭을 찾을 수 없거나 데이터가 없습니다.\n(탭명에 '전용양식'이 포함되어 있어야 합니다)");
      return;
    }

    var lr = tab.getLastRow();
    var lc = Math.max(tab.getLastColumn(), 49);
    var data = tab.getRange(2, 1, lr - 1, lc).getValues();

    // 공급가 탭에서 택배비 맵 로드
    var shippingMap = {};
    try {
      var JM_TAB_NAMES = ["공급가", "단가표", "JM공급가"];
      var priceTab = null;
      for (var jti = 0; jti < JM_TAB_NAMES.length; jti++) {
        priceTab = ss.getSheetByName(JM_TAB_NAMES[jti]);
        if (priceTab) break;
      }
      if (priceTab && priceTab.getLastRow() >= 2) {
        var pAll = priceTab.getRange(1, 1, priceTab.getLastRow(), Math.max(priceTab.getLastColumn(), 13)).getValues();
        for (var pi = 1; pi < pAll.length; pi++) {
          var pCode = String(pAll[pi][0] || "").trim();
          var pShip = parseFloat(pAll[pi][12]) || 0;
          if (pCode && pShip > 0) shippingMap[pCode] = pShip;
        }
      }
    } catch (eP) {}

    var zipFilled = 0, shipFilled = 0, zipCache = {};
    var zipCol = [];
    var shipCol = [];

    // 디버그: 헤더 행 확인
    var headerRow = tab.getRange(1, 1, 1, Math.min(lc, 20)).getValues()[0];
    var debugHeader = [];
    for (var hi = 0; hi < headerRow.length; hi++) {
      if (String(headerRow[hi] || "").trim()) {
        debugHeader.push(String.fromCharCode(65 + hi) + "=" + headerRow[hi]);
      }
    }
    Logger.log("[JM ZIP] 탭명: " + tab.getName() + ", 헤더: " + debugHeader.join(" | "));

    // ★ API 직접 테스트: 첫 행 주소로 HTTP 응답코드 확인
    var apiTestInfo = "";
    if (data.length > 0) {
      var testAddr = String(data[0][5] || "").trim();
      if (testAddr) {
        try {
          var testApiKey = _pep_getKakaoApiKey_();
          var testUrl = "https://dapi.kakao.com/v2/local/search/address.json?query=" + encodeURIComponent(testAddr);
          var testResp = UrlFetchApp.fetch(testUrl, { headers: { "Authorization": "KakaoAK " + testApiKey }, muteHttpExceptions: true });
          var testCode = testResp.getResponseCode();
          var testBody = testResp.getContentText().substring(0, 150);
          apiTestInfo = "HTTP " + testCode + " | " + testBody;
          
          // 정규화 주소도 테스트
          var normAddr = testAddr.replace(/강원특별자치도/g, "강원도").replace(/전북특별자치도/g, "전라북도");
          if (normAddr !== testAddr) {
            var testUrl2 = "https://dapi.kakao.com/v2/local/search/address.json?query=" + encodeURIComponent(normAddr);
            var testResp2 = UrlFetchApp.fetch(testUrl2, { headers: { "Authorization": "KakaoAK " + testApiKey }, muteHttpExceptions: true });
            apiTestInfo += "\n정규화(" + normAddr.substring(0, 20) + "): HTTP " + testResp2.getResponseCode() + " | " + testResp2.getContentText().substring(0, 150);
          }
        } catch (eTest) {
          apiTestInfo = "테스트오류: " + eTest.message;
        }
      }
    }

    for (var r = 0; r < data.length; r++) {
      var addr = String(data[r][5] || "").trim();
      var curZip = String(data[r][11] || "").trim();
      var curShip = data[r][15];
      var ecCode = String(data[r][48] || "").trim();

      // 디버그: 각 행의 실제 데이터 로그
      Logger.log("[JM ZIP] 행" + (r+2) + ": F(주소)=[" + addr + "], L(우편번호)=[" + curZip + "], P(운임)=[" + curShip + "]");

      var newZip = curZip;
      var apiResult = "";
      if (addr && !curZip) {
        // ★ 2026-07-17 (M4): 실행 내 캐시 → 영구 캐시(Properties) → API 순
        if (zipCache[addr] !== undefined) {
          newZip = zipCache[addr];
          apiResult = "캐시=" + newZip;
        } else {
          try {
            newZip = _pep_getZipCodeCached_(addr);
            apiResult = "API/영구캐시=" + (newZip || "(빈값)");
          } catch (eApi) {
            apiResult = "API오류=" + eApi.message;
          }
          zipCache[addr] = newZip || "";
        }
        Logger.log("[JM ZIP] 행" + (r+2) + " API호출: addr=[" + addr + "] → " + apiResult);
        if (newZip) zipFilled++;
      } else {
        apiResult = addr ? "이미있음(" + curZip + ")" : "주소없음";
      }
      if (r < 3) debugHeader.push("행" + (r+2) + ": " + apiResult);
      // ★ 2026-06-30: 우편번호 앞 0 보존 (5자리 패딩)
      var finalZip = newZip || curZip || "";
      if (finalZip && String(finalZip).length < 5) {
        finalZip = ("00000" + finalZip).slice(-5);
      }
      zipCol.push([String(finalZip)]);

      var newShip = curShip;
      if (ecCode && (!curShip || Number(curShip) === 0) && shippingMap[ecCode]) {
        newShip = shippingMap[ecCode];
        shipFilled++;
      }
      shipCol.push([newShip || ""]);
    }

    if (zipFilled > 0) {
      tab.getRange(2, 12, zipCol.length, 1).setNumberFormat("@"); // ★ 2026-06-30: 텍스트 형식
      tab.getRange(2, 12, zipCol.length, 1).setValues(zipCol);
    }
    if (shipFilled > 0) {
      tab.getRange(2, 16, shipCol.length, 1).setValues(shipCol);
    }
    _pep_zipCacheSave_(); // ★ 2026-07-17 (M4): 신규 우편번호 영구 캐시 저장
    SpreadsheetApp.flush();

    // 디버그 정보 포함 알림
    var debugInfo = "\n\n[디버그]\n탭: " + tab.getName() + "\n헤더(F): " + (headerRow[5] || "(빈)") + "\n헤더(L): " + (headerRow[11] || "(빈)");
    if (data.length > 0) {
      debugInfo += "\n1행 F값: [" + String(data[0][5] || "") + "]";
      debugInfo += "\n1행 L값: [" + String(data[0][11] || "") + "]";
    }
    // API 결과 표시 (debugHeader에 행별 결과 추가됨)
    var apiResults = debugHeader.filter(function(h) { return h.indexOf("행") === 0; });
    if (apiResults.length > 0) {
      debugInfo += "\n\n[API 결과]\n" + apiResults.join("\n");
    }
    if (apiTestInfo) {
      debugInfo += "\n\n[API 직접테스트]\n" + apiTestInfo;
    }

    ui.alert("📮 전용양식 채우기 완료",
      "우편번호: " + zipFilled + "건\n" +
      "택배비: " + shipFilled + "건\n" +
      "(총 " + data.length + "행 스캔)" + debugInfo,
      ui.ButtonSet.OK);

  } catch (e) {
    ui.alert("❌ 오류: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

// ═════════════════════════════════════════════
//  로젠_임시기록 시스템
//  입력_로젠주문실적(37열) → 상품정보시트 로젠_임시기록 탭
// ═════════════════════════════════════════════

var _LOZEN_TEMP_TAB_NAME_ = "로젠_임시기록";
var _LOZEN_ARCHIVE_PREFIX_ = "로젠_";
var _LOZEN_ARCHIVE_SUFFIX_ = "마감";
var _LOZEN_HEADER_BG_ = "#1a237e";  // 진한 남색

/**
 * 로젠_임시기록 탭 확보 (없으면 자동 생성)
 * @param {Spreadsheet} ss - 상품정보시트
 * @return {Sheet} 로젠_임시기록 탭
 */
function _pep_ensureLozenTempTab_(ss) {
  var tab = ss.getSheetByName(_LOZEN_TEMP_TAB_NAME_);
  if (tab) return tab;

  tab = ss.insertSheet(_LOZEN_TEMP_TAB_NAME_);
  var headers = ["기록일시"].concat(_PO_UNMATCHED_HEADERS);
  tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  tab.getRange("1:1")
    .setBackground(_LOZEN_HEADER_BG_)
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  // F열(운송장번호), G열(주문번호) 텍스트 서식 (선행 0 보존)
  tab.getRange("G:G").setNumberFormat("@");
  tab.getRange("L:L").setNumberFormat("@"); // ★ 2026-06-30: 우편번호 (앞 0 보존)
  tab.getRange("N:N").setNumberFormat("@"); // 전화번호
  tab.getRange("O:O").setNumberFormat("@"); // 휴대폰
  SpreadsheetApp.flush();
  return tab;
}

/**
 * 입력_로젠주문실적 → 로젠_임시기록 탭으로 기록
 * 중복 체크: 주문번호(E열, idx4) + 운송장번호(F열, idx5) 기반
 * @return {Object} { recorded, skipped, total }
 */
function _pep_recordLozenToTemp_() {
  var result = { recorded: 0, skipped: 0, total: 0, error: "" };

  try {
    // 1) 거래관리시스템 시트 열기
    var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
    var srcTab = _pt_getSheetByGid(invSS, _PT_PRIMARY_INVOICE_GID);
    if (!srcTab) {
      result.error = "입력_로젠주문실적 탭 없음";
      return result;
    }

    var srcLr = srcTab.getLastRow();
    if (srcLr < 2) {
      result.error = "소스 데이터 없음";
      return result;
    }

    var srcLc = Math.max(srcTab.getLastColumn(), _PO_UNMATCHED_HEADERS.length);
    var srcData = srcTab.getRange(2, 1, srcLr - 1, srcLc).getValues();
    result.total = srcData.length;

    // 2) 상품정보시트 로젠_임시기록 탭 확보
    var hubSS = SpreadsheetApp.getActiveSpreadsheet();
    var tempTab = _pep_ensureLozenTempTab_(hubSS);

    // 3) 기존 기록의 중복 Set 구성: "주문번호|운송장번호"
    var existSet = {};
    var tempLr = tempTab.getLastRow();
    if (tempLr >= 2) {
      // 기록일시(A) + 원본37열이므로, 주문번호=F열(idx5), 운송장번호=G열(idx6)
      var existData = tempTab.getRange(2, 1, tempLr - 1, 8).getValues();
      for (var ei = 0; ei < existData.length; ei++) {
        var eOrdNo = String(existData[ei][5] || "").trim(); // F열 = 원본E열(주문번호)
        var eInvNo = String(existData[ei][6] || "").trim(); // G열 = 원본F열(운송장번호)
        if (eOrdNo || eInvNo) {
          existSet[eOrdNo + "|" + eInvNo] = true;
        }
      }
    }

    // 4) 신규분만 필터링
    var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var newRows = [];
    var headerLen = _PO_UNMATCHED_HEADERS.length;

    for (var r = 0; r < srcData.length; r++) {
      var ordNo = String(srcData[r][4] || "").trim();  // E열(idx4): 주문번호
      var invNo = String(srcData[r][5] || "").trim();  // F열(idx5): 운송장번호

      // 빈 행 스킵 (주문번호도 운송장번호도 없으면)
      if (!ordNo && !invNo) { result.skipped++; continue; }

      var key = ordNo + "|" + invNo;
      if (existSet[key]) { result.skipped++; continue; }

      // 기록일시 + 원본 37열 복사
      var row = [nowStr];
      for (var c = 0; c < headerLen; c++) {
        row.push(c < srcData[r].length ? srcData[r][c] : "");
      }
      newRows.push(row);
      existSet[key] = true;
    }

    // 5) 일괄 기록
    if (newRows.length > 0) {
      var writeStart = tempTab.getLastRow() + 1;
      if (writeStart < 2) writeStart = 2;
      var totalCols = 1 + headerLen; // 기록일시 + 37열
      tempTab.getRange(writeStart, 1, newRows.length, totalCols).setValues(newRows);
      SpreadsheetApp.flush();
    }

    result.recorded = newRows.length;
    Logger.log("[LOZEN_TEMP] 기록: " + result.recorded + "건, 스킵: " + result.skipped + "건, 전체: " + result.total + "건");

  } catch (e) {
    result.error = e.message;
    Logger.log("[LOZEN_TEMP] 오류: " + e.message);
  }

  return result;
}

/**
 * 수동 메뉴용 래퍼: 로젠_임시기록 수동 기록
 */
function partnerRecordLozenTemp() {
  var ui = SpreadsheetApp.getUi();
  var result = _pep_recordLozenToTemp_();
  if (result.error) {
    ui.alert("❌ 로젠 임시기록 오류: " + result.error);
    return;
  }
  ui.alert("📋 로젠 임시기록 완료",
    "신규 기록: " + result.recorded + "건\n" +
    "스킵(중복/빈행): " + result.skipped + "건\n" +
    "(소스 총 " + result.total + "행 스캔)",
    ui.ButtonSet.OK);
}

/**
 * 로젠_임시기록 → 로젠_(날짜)마감 탭 이동 + 초기화
 * ★ 폐기: _pep_archiveUnifiedDaily_ 로 대체됨 (하위 호환 래퍼)
 */
function _pep_archiveLozenTemp_() {
  return _pep_archiveUnifiedDaily_();
}

// ═════════════════════════════════════════════
//  ★ 판매현황 단가맵 (Push 시 자동 누적)
//  대리공급 Push 시 세트분리 시트의 판매현황 탭을 읽어
//  허브 '판매현황_단가맵' 탭에 누적 저장
// ═════════════════════════════════════════════

var _PEP_PRICE_MAP_TAB_ = "판매현황_단가맵";
// ★ 2026-06-20: 6열→9열 확장 (수량, 품목명, 주소 추가)
// ★ 2026-06-23: 9열→10열 확장 (운송장번호 추가 — 로젠 송장 매칭용)
var _PEP_PRICE_MAP_HEADERS_ = [
  "주문번호", "품목코드", "판매단가", "수취인", "전화번호",
  "수량", "품목명", "주소", "수집일시", "운송장번호"
];

/**
 * ★ 단가맵 수집 10분 후 예약 (Push 완료 후 지연 실행)
 * 원샷 트리거로 Push 업무 시간에 영향 없음
 */
function _pep_schedulePriceMapCollection_() {
  // 기존 대기 중인 트리거 제거 (중복 방지)
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "_pep_collectPriceMapDelayed_") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // 10분 후 실행
  ScriptApp.newTrigger("_pep_collectPriceMapDelayed_")
    .timeBased()
    .after(10 * 60 * 1000) // 10분
    .create();
  Logger.log("[PRICE_MAP] 단가맵 수집 10분 후 예약됨");
}

/**
 * ★ 단가맵 수집 지연 실행 (10분 후 트리거 핸들러)
 * 세트분리 시트를 열어 판매현황 탭 데이터를 읽고 단가맵에 저장
 */
function _pep_collectPriceMapDelayed_() {
  try {
    // ★ 트리거 자동 정리 (1회용)
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "_pep_collectPriceMapDelayed_") {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }

    var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
    var salesTab = srcSS.getSheetByName("판매현황");
    if (salesTab && salesTab.getLastRow() >= 2) {
      _pep_appendSalesPriceMap_(salesTab);
    } else {
      Logger.log("[PRICE_MAP] 판매현황 탭 데이터 없음 (스킵)");
    }
  } catch (e) {
    Logger.log("[PRICE_MAP] 지연 수집 오류: " + e.message);
  }
}

/**
 * ★ 판매현황 탭에서 단가 정보를 추출하여 허브에 누적 저장
 * ★ 2026-06-20: 헤더 자동 감지 + 9열 확장 (수량, 품목명, 주소 추가)
 * @param {Sheet} salesTab 세트분리 시트의 판매현황 탭
 */
function _pep_appendSalesPriceMap_(salesTab) {
  try {
    if (!salesTab || salesTab.getLastRow() < 2) return;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");

    // ★ 탭을 먼저 생성/확인 (데이터 처리 전)
    var mapTab = ss.getSheetByName(_PEP_PRICE_MAP_TAB_);
    if (!mapTab) {
      mapTab = ss.insertSheet(_PEP_PRICE_MAP_TAB_);
      mapTab.getRange(1, 1, 1, _PEP_PRICE_MAP_HEADERS_.length)
        .setValues([_PEP_PRICE_MAP_HEADERS_]);
      mapTab.getRange("1:1")
        .setBackground("#1a237e")
        .setFontColor("white")
        .setFontWeight("bold");
      mapTab.setFrozenRows(1);
      mapTab.getRange("E:E").setNumberFormat("@");
      Logger.log("[PRICE_MAP] 판매현황_단가맵 탭 신규 생성 (9열)");
    } else {
      // 기존 탭이 6열이면 헤더 갱신
      var curHeaders = mapTab.getRange(1, 1, 1, mapTab.getLastColumn()).getValues()[0];
      if (curHeaders.length < _PEP_PRICE_MAP_HEADERS_.length) {
        mapTab.getRange(1, 1, 1, _PEP_PRICE_MAP_HEADERS_.length)
          .setValues([_PEP_PRICE_MAP_HEADERS_]);
        Logger.log("[PRICE_MAP] 헤더 갱신: " + curHeaders.length + "열 → " + _PEP_PRICE_MAP_HEADERS_.length + "열");
      }
    }

    var sLr = salesTab.getLastRow();
    var sLc = Math.max(salesTab.getLastColumn(), 30);

    // ★ 판매현황 구조: 1행=제목(회사명), 2행=헤더, 3행~=데이터
    // 1행이 제목행인지 자동 감지 (빈 셀이 많으면 제목행)
    var row1 = salesTab.getRange(1, 1, 1, sLc).getValues()[0];
    var row2 = salesTab.getRange(2, 1, 1, sLc).getValues()[0];
    var row1NonEmpty = 0, row2NonEmpty = 0;
    for (var ri = 0; ri < row1.length; ri++) {
      if (String(row1[ri] || "").trim()) row1NonEmpty++;
      if (String(row2[ri] || "").trim()) row2NonEmpty++;
    }

    var headerRow, dataStartRow;
    if (row2NonEmpty > row1NonEmpty && row2NonEmpty >= 3) {
      // 2행이 헤더 (1행은 제목)
      headerRow = 2;
      dataStartRow = 3;
      Logger.log("[PRICE_MAP] 헤더 감지: 2행 (1행=제목, 2행 비빈셀=" + row2NonEmpty + " > 1행=" + row1NonEmpty + ")");
    } else {
      // 1행이 헤더
      headerRow = 1;
      dataStartRow = 2;
    }

    var sHeader = salesTab.getRange(headerRow, 1, 1, sLc).getValues()[0];
    if (sLr < dataStartRow) {
      Logger.log("[PRICE_MAP] 데이터 행 없음 (헤더행=" + headerRow + ", 마지막행=" + sLr + ")");
      return;
    }
    var sData = salesTab.getRange(dataStartRow, 1, sLr - dataStartRow + 1, sLc).getValues();

    // ★ 헤더에서 열 인덱스 자동 감지
    // 판매현황 실제 헤더: 순번, 일자-No., 품목코드, 품목명, 수량, 전화, 모바일, 주소1, 합계, 거래처명, ...
    var colMap = { orderNo: -1, itemCode: -1, price: -1, recipient: -1,
                   phone: -1, mobile: -1, qty: -1, itemName: -1, addr: -1 };
    for (var ci = 0; ci < sHeader.length; ci++) {
      var h = String(sHeader[ci] || "").replace(/\s/g, "");
      // 주문번호: 일자-No., 주문번호, 사방넷주문번호, 고유ID
      if (h.indexOf("주문번호") !== -1 || h.indexOf("사방넷주문번호") !== -1 ||
          h.indexOf("고유ID") !== -1 || h === "일자-No." || h.indexOf("일자-No") !== -1) {
        if (colMap.orderNo === -1) colMap.orderNo = ci;
      }
      // 품목코드
      if (h.indexOf("품목코드") !== -1 || h.indexOf("이카운트코드") !== -1 || h.indexOf("물품코드") !== -1) {
        if (colMap.itemCode === -1) colMap.itemCode = ci;
      }
      // 단가: 합계, 판매단가, 판매가, 단가, 금액
      if (h === "합계" || h.indexOf("판매단가") !== -1 || h.indexOf("판매가") !== -1 ||
          h.indexOf("단가") !== -1 || h === "금액") {
        if (colMap.price === -1) colMap.price = ci;
      }
      // 수취인: 주문자명, 수취인, 명
      if (h.indexOf("수취인") !== -1 || h.indexOf("주문자명") !== -1 || (h === "명" && ci < 15)) {
        if (colMap.recipient === -1) colMap.recipient = ci;
      }
      // 전화
      if (h.indexOf("전화") !== -1 && h.indexOf("보내는") === -1) {
        if (colMap.phone === -1) colMap.phone = ci;
      }
      // 모바일/휴대폰
      if (h.indexOf("휴대폰") !== -1 || h.indexOf("모바일") !== -1 || h.indexOf("핸드폰") !== -1) {
        if (colMap.mobile === -1) colMap.mobile = ci;
      }
      // 수량
      if (h === "수량" || h.indexOf("주문수량") !== -1) {
        if (colMap.qty === -1) colMap.qty = ci;
      }
      if (h.indexOf("품목명") !== -1 || h.indexOf("물품명") !== -1 || h.indexOf("상품명") !== -1) {
        if (colMap.itemName === -1) colMap.itemName = ci;
      }
      if (h.indexOf("주소") !== -1 && h.indexOf("보내는") === -1) {
        if (colMap.addr === -1) colMap.addr = ci;
      }
    }
    Logger.log("[PRICE_MAP] 판매현황 열 감지: " + JSON.stringify(colMap) +
      " 헤더샘플: [" + sHeader.slice(0, 10).join(", ") + "] (행수=" + sData.length + ")");

    if (colMap.price === -1) {
      // ★ throw로 변경 — 수동 호출 시 사용자에게 알림
      throw new Error("판매현황 헤더에서 '단가/판매단가/판매가' 열을 찾지 못함.\n" +
        "헤더 1~10열: " + sHeader.slice(0, 10).join(", "));
    }

    var newRows = [];
    for (var i = 0; i < sData.length; i++) {
      var orderNo = colMap.orderNo >= 0 ? String(sData[i][colMap.orderNo] || "").trim() : "";
      var itemCode = colMap.itemCode >= 0 ? String(sData[i][colMap.itemCode] || "").trim() : "";
      var price = sData[i][colMap.price];
      if (!orderNo && !itemCode) continue;
      if (!price && price !== 0) continue;

      var phone = "";
      if (colMap.phone >= 0) phone = String(sData[i][colMap.phone] || "").trim();
      if (!phone && colMap.mobile >= 0) phone = String(sData[i][colMap.mobile] || "").trim();

      newRows.push([
        orderNo,
        itemCode,
        price,
        colMap.recipient >= 0 ? String(sData[i][colMap.recipient] || "").trim() : "",
        phone,
        colMap.qty >= 0 ? (Number(sData[i][colMap.qty]) || 1) : 1,
        colMap.itemName >= 0 ? String(sData[i][colMap.itemName] || "").trim() : "",
        colMap.addr >= 0 ? String(sData[i][colMap.addr] || "").trim() : "",
        nowStr,
        ""  // ★ 운송장번호 (일일마감 시 로젠에서 매칭)
      ]);
    }

    if (newRows.length === 0) return;

    // ★ 중복 방지: 기존 맵에서 (주문번호+품목명) 세트 구축
    var existSet = {};
    var mapLr = mapTab.getLastRow();
    if (mapLr >= 2) {
      var colCnt = Math.max(mapTab.getLastColumn(), 7);
      var existData = mapTab.getRange(2, 1, mapLr - 1, colCnt).getValues();
      for (var ei = 0; ei < existData.length; ei++) {
        // 주문번호(A) + 품목명(G) 복합키
        var eKey = String(existData[ei][0] || "").trim() + "|" +
                   String(existData[ei][6] || "").trim();
        existSet[eKey] = true;
      }
    }

    // 중복 제거 후 신규 행만 추가
    var filtered = [];
    for (var fi = 0; fi < newRows.length; fi++) {
      // newRows: [주문번호(0), 품목코드(1), 단가(2), 수취인(3), 전화(4), 수량(5), 품목명(6), ...]
      var fKey = newRows[fi][0] + "|" + newRows[fi][6]; // 주문번호 + 품목명
      if (!existSet[fKey]) {
        filtered.push(newRows[fi]);
        existSet[fKey] = true;
      }
    }

    if (filtered.length > 0) {
      var appendRow = mapTab.getLastRow() + 1;
      if (appendRow < 2) appendRow = 2;
      mapTab.getRange(appendRow, 1, filtered.length, _PEP_PRICE_MAP_HEADERS_.length)
        .setValues(filtered);
      Logger.log("[PRICE_MAP] 판매현황_단가맵 누적: " + filtered.length + "건 (중복제거: " +
        (newRows.length - filtered.length) + "건)");
    }
  } catch (e) {
    Logger.log("[PRICE_MAP] 단가맵 저장 오류 (무시): " + e.message);
    // ★ Push 동작에 영향 주지 않음 — 에러 무시
  }
}

/**
 * ★ 판매현황_단가맵에서 { key: 단가 } 맵 구축
 * ★ 2026-06-20: 9열 확장 대응 (하위 호환)
 * @return {Object} priceMap - key: "주문번호|품목코드" 또는 "수취인|전화|품목코드"
 */
function _buildSalesPriceMap_() {
  var priceMap = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mapTab = ss.getSheetByName(_PEP_PRICE_MAP_TAB_);
    if (!mapTab || mapTab.getLastRow() < 2) return priceMap;

    var colCount = Math.max(mapTab.getLastColumn(), 7); // 최소 7열 (품목명 포함)
    var data = mapTab.getRange(2, 1, mapTab.getLastRow() - 1, colCount).getValues();
    for (var i = 0; i < data.length; i++) {
      var orderNo = String(data[i][0] || "").trim();
      var itemCode = String(data[i][1] || "").trim();
      var price = data[i][2];
      var recipient = String(data[i][3] || "").trim();
      var phone = String(data[i][4] || "").replace(/[^0-9]/g, "");
      var itemName = colCount > 6 ? String(data[i][6] || "").trim() : ""; // G열: 품목명

      // ★ 1순위 키: 전화앞7자리 + 품목명
      // (판매현황=전체번호, 로젠=뒤4자리마스킹 → 앞7자리 공통)
      var phone7 = phone.substring(0, 7);
      if (phone7.length >= 7 && itemName) {
        var phoneKey = "PH7:" + phone7 + "|" + itemName;
        if (!priceMap[phoneKey]) priceMap[phoneKey] = price;
      }
      // 2순위 키: 수취인 + 품목명
      if (recipient && itemName) {
        var nameKey = recipient + "|" + itemName;
        if (!priceMap[nameKey]) priceMap[nameKey] = price;
      }
      // 3순위 키: 주문번호 + 품목명 (형식 일치 시)
      if (orderNo && itemName) {
        var ordNameKey = orderNo + "|" + itemName;
        if (!priceMap[ordNameKey]) priceMap[ordNameKey] = price;
      }
    }
    Logger.log("[PRICE_MAP] 단가맵 로드: " + Object.keys(priceMap).length + "개 키");
  } catch (e) {
    Logger.log("[PRICE_MAP] 단가맵 읽기 오류: " + e.message);
  }
  return priceMap;
}

/**
 * ★ 판매현황_단가맵 초기화 (일일마감 완료 후 호출)
 */
function _clearSalesPriceMap_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mapTab = ss.getSheetByName(_PEP_PRICE_MAP_TAB_);
    if (mapTab && mapTab.getLastRow() >= 2) {
      mapTab.getRange(2, 1, mapTab.getLastRow() - 1, mapTab.getLastColumn()).clearContent();
      Logger.log("[PRICE_MAP] 판매현황_단가맵 초기화 완료");
    }
  } catch (e) {
    Logger.log("[PRICE_MAP] 초기화 오류: " + e.message);
  }
}


// ═════════════════════════════════════════════
//  ★ 2026-06-23: 로젠 송장번호 → 판매현황_단가맵 매칭
//  일일마감 시 호출하여 단가맵에 운송장번호를 기록
//  1차: D열(수취인)에서 "/" 뒤 사방넷번호/고유ID → 로젠 E열(주문번호)
//  2차: 이름 + 전화앞7자리 + 품목명 → 로젠 수취인+전화+품목명
// ═════════════════════════════════════════════

/**
 * ★ 입력_로젠주문실적의 송장번호를 판매현황_단가맵에 매칭
 * @return {Object} { matched, total, already, error }
 */
function _pep_matchInvoiceToPriceMap_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mapTab = ss.getSheetByName(_PEP_PRICE_MAP_TAB_);
    if (!mapTab || mapTab.getLastRow() < 2) {
      Logger.log("[INV_MATCH] 단가맵 데이터 없음 → 스킵");
      return { matched: 0, total: 0, already: 0 };
    }

    // ① 로젠 데이터 읽기
    var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
    var lozenTab = _pt_getSheetByGid(invSS, _PT_PRIMARY_INVOICE_GID);
    if (!lozenTab || lozenTab.getLastRow() < 2) {
      Logger.log("[INV_MATCH] 로젠 데이터 없음 → 스킵");
      return { matched: 0, total: 0, already: 0 };
    }

    var lLr = lozenTab.getLastRow();
    var lLc = Math.max(lozenTab.getLastColumn(), 28);
    var lData = lozenTab.getRange(2, 1, lLr - 1, lLc).getValues();

    // ② 로젠 맵 구축
    var idToInv = {};          // 1차: 주문번호(사방넷/고유ID) → 송장번호
    var namePhoneToInv = {};   // 2차: 이름|전화7|품목명 → 송장번호

    for (var li = 0; li < lData.length; li++) {
      var ordNo = String(lData[li][4] || "").trim();   // E열: 주문번호
      var invNo = String(lData[li][5] || "").trim();   // F열: 운송장번호
      if (!invNo) continue;

      // 1차 맵: 주문번호 → 송장번호
      if (ordNo && !idToInv[ordNo]) {
        idToInv[ordNo] = invNo;
      }

      // 2차 맵: 이름+전화앞7+품목명 → 송장번호
      var lRecip = String(lData[li][9] || "").trim();    // J열: 수취인
      var lPhoneRaw = String(lData[li][12] || "").replace(/[^0-9]/g, "");
      if (!lPhoneRaw) lPhoneRaw = String(lData[li][13] || "").replace(/[^0-9]/g, "");
      var lPhone7 = lPhoneRaw.substring(0, 7);
      var lItemName = String(lData[li][10] || "").trim(); // K열: 품목명

      if (lRecip && lPhone7.length >= 7 && lItemName) {
        var npKey = lRecip + "|" + lPhone7 + "|" + lItemName;
        if (!namePhoneToInv[npKey]) namePhoneToInv[npKey] = invNo;
      }
    }

    Logger.log("[INV_MATCH] 로젠 맵: ID=" + Object.keys(idToInv).length +
      "개, 이름+전화+품목=" + Object.keys(namePhoneToInv).length + "개");

    // ③ 단가맵 읽기 (10열 보장)
    var mapLr = mapTab.getLastRow();
    var mapLc = Math.max(mapTab.getLastColumn(), _PEP_PRICE_MAP_HEADERS_.length);
    var mapData = mapTab.getRange(2, 1, mapLr - 1, mapLc).getValues();

    var matched = 0, already = 0, unmatched = 0;
    var INV_COL = 9; // J열(10번째, 0-indexed=9) = 운송장번호

    for (var mi = 0; mi < mapData.length; mi++) {
      // 이미 송장번호가 있으면 스킵
      if (String(mapData[mi][INV_COL] || "").trim()) { already++; continue; }

      var recipient = String(mapData[mi][3] || "").trim(); // D열: "홍길동/사방넷번호"
      var phone = String(mapData[mi][4] || "").replace(/[^0-9]/g, ""); // E열
      var phone7 = phone.substring(0, 7);
      var itemName = String(mapData[mi][6] || "").trim(); // G열: 품목명
      var mapOrderNo = String(mapData[mi][0] || "").trim(); // A열: 주문번호

      var foundInv = "";

      // ── 1차 매칭: D열에서 "/" 뒤 사방넷번호/고유ID → 로젠 E열 ──
      if (recipient.indexOf("/") !== -1) {
        var parts = recipient.split("/");
        var extractedId = parts[parts.length - 1].trim();
        if (extractedId && idToInv[extractedId]) {
          foundInv = idToInv[extractedId];
        }
      }

      // A열(주문번호)로도 1차 시도
      if (!foundInv && mapOrderNo && idToInv[mapOrderNo]) {
        foundInv = idToInv[mapOrderNo];
      }

      // ── 2차 매칭: 이름 + 전화앞7자리 + 품목명 ──
      if (!foundInv && phone7.length >= 7 && itemName) {
        var namePart = recipient.indexOf("/") !== -1
          ? recipient.split("/")[0].trim()
          : recipient;

        if (namePart) {
          var npKey2 = namePart + "|" + phone7 + "|" + itemName;
          if (namePhoneToInv[npKey2]) {
            foundInv = namePhoneToInv[npKey2];
          }
        }
      }

      if (foundInv) {
        mapData[mi][INV_COL] = foundInv;
        matched++;
      } else {
        unmatched++;
      }
    }

    // ④ 매칭 결과 배치 쓰기
    if (matched > 0) {
      mapTab.getRange(2, 1, mapData.length, mapLc).setValues(mapData);
      SpreadsheetApp.flush();
    }

    Logger.log("[INV_MATCH] 송장매칭 완료: 매칭=" + matched + "건, 기존=" + already +
      "건, 미매칭=" + unmatched + "건 (총 " + mapData.length + "건)");

    return { matched: matched, total: mapData.length, already: already };
  } catch (e) {
    Logger.log("[INV_MATCH] 송장매칭 오류: " + e.message);
    return { matched: 0, total: 0, already: 0, error: e.message };
  }
}


// ═════════════════════════════════════════════
//  ★ 2026-06-24: 판매현황 스냅샷 시스템
//  대리공급 Push 시 판매현황 C~Q를 허브에 누적 저장
//  → 일일마감(05시)에서 송장맵과 매칭
// ═════════════════════════════════════════════

var _SNAPSHOT_TAB_NAME_ = "판매현황_임시기록"; // ★ 2026-06-26: 탭 이름 변경 (대리공급_임시기록과 네이밍 통일)
var _SNAPSHOT_STATUS_UNMATCHED_ = "미매칭";
var _SNAPSHOT_STATUS_MATCHED_ = "매칭완료";

/**
 * ★ 2026-06-25: 전화번호 앞 0 보존 유틸
 * 숫자로 읽힌 전화번호를 문자열로 보정 (예: 1012345678 → "01012345678")
 * @param {*} val - 셀 값
 * @return {string|*} 보정된 값 (전화번호가 아니면 원본 반환)
 */
function _pep_fixPhoneLeadingZero_(val) {
  if (val === "" || val == null) return val;
  var sv = String(val).trim();
  if (/e/i.test(sv) && isFinite(Number(val))) {
    sv = String(Math.round(Number(val)));
  }
  var digits = sv.replace(/[^0-9]/g, "");
  if (!digits) return val;
  if (digits.charAt(0) === "0") return sv.charAt(0) === "0" ? sv : digits;
  // 010/02 등이 숫자로 읽혀 앞 0이 빠진 경우 (9~11자리)
  if (/^[1-9]\d{8,10}$/.test(digits)) return "0" + digits;
  return typeof val === "number" ? sv : val;
}

/**
 * ★ 2026-06-25: 헤더 배열에서 전화번호/휴대폰 열 인덱스 감지
 * @param {Array} headers - 헤더 문자열 배열
 * @return {Array<number>} 전화번호/휴대폰 열의 인덱스 배열
 */
function _pep_detectPhoneColumns_(headers) {
  var phoneIdxs = [];
  var phoneKeywords = ["전화", "휴대폰", "핸드폰", "연락처", "phone", "mobile", "tel"];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").trim().toLowerCase();
    for (var k = 0; k < phoneKeywords.length; k++) {
      if (h.indexOf(phoneKeywords[k]) !== -1) {
        phoneIdxs.push(i);
        break;
      }
    }
  }
  return phoneIdxs;
}

/**
 * 판매현황 C~Q를 허브 시트의 스냅샷 탭에 누적 저장
 * ★ 대리공급 Push 시점에 호출 (이미 세트분리 시트를 열고 있으므로 추가 API 없음)
 * @param {Spreadsheet} srcSS - 이미 열린 세트분리 시트 (openById 재사용)
 * @return {Object} { saved, skipped, error }
 */
function _pep_saveSnapshotToHub_(srcSS, fallbackDateStr) {
  var result = { saved: 0, skipped: 0, error: "" };
  try {
    var salesTab = srcSS.getSheetByName("판매현황");
    if (!salesTab || salesTab.getLastRow() < 2) {
      result.error = "판매현황 탭 없거나 비어있음";
      return result;
    }

    var sLr = salesTab.getLastRow();
    var sLc = Math.max(salesTab.getLastColumn(), 17);

    // 헤더행 자동 감지 (1행 vs 2행)
    var r1 = salesTab.getRange(1, 1, 1, sLc).getValues()[0];
    var r2 = salesTab.getRange(2, 1, 1, sLc).getValues()[0];
    var r1cnt = 0, r2cnt = 0;
    for (var rx = 0; rx < Math.min(r1.length, 17); rx++) {
      if (String(r1[rx] || "").trim()) r1cnt++;
      if (String(r2[rx] || "").trim()) r2cnt++;
    }
    var hdrRow = (r2cnt > r1cnt && r2cnt >= 3) ? 2 : 1;
    var dtaRow = hdrRow + 1;

    if (sLr < dtaRow) {
      result.error = "판매현황 데이터 없음";
      return result;
    }

    // C~Q 데이터 읽기 (15열, 3열~17열)
    var salesData = salesTab.getRange(dtaRow, 3, sLr - dtaRow + 1, 15).getValues();
    // ★ 2026-06-30: A~B열 별도 읽기 (요약행 "계"/"합계" 감지용 — C~Q에는 이 텍스트가 없음)
    var abData = salesTab.getRange(dtaRow, 1, sLr - dtaRow + 1, 2).getValues();
    // C~Q 헤더도 읽기
    var fullHeader = salesTab.getRange(hdrRow, 1, 1, 17).getValues()[0];
    var salesHeaders = [];
    for (var hi = 2; hi < 17; hi++) {
      salesHeaders.push(String(fullHeader[hi] || "").trim() || ("열" + String.fromCharCode(67 + hi - 2)));
    }
    // ★ 2026-08-30: 일자는 B열 `일자-No.` 에 있다. C~Q만 보면 실행일로 떨어진다.
    var dateCol = _pep_findSalesDateCol_(fullHeader);
    Logger.log("[SNAPSHOT] 일자열=" + (dateCol >= 0 ? String.fromCharCode(65 + dateCol) : "없음") +
      " 헤더B=" + String(fullHeader[1] || ""));

    // ★ 2026-06-25: 전화번호/휴대폰 열 인덱스 감지 (C~Q 범위 내)
    var phoneColIdxs = _pep_detectPhoneColumns_(salesHeaders);
    if (phoneColIdxs.length > 0) {
      Logger.log("[SNAPSHOT] 전화번호 열 감지: " + phoneColIdxs.join(",") +
        " (헤더: " + phoneColIdxs.map(function(i) { return salesHeaders[i]; }).join(", ") + ")");
    }

    // ★ 2026-06-25: 전화번호 앞 0 보정 (getValues()가 숫자로 변환한 값 복구)
    var O_IDX_IN_CQ = 12; // O열 = C~Q 범위 내 index 12
    var P_IDX_IN_CQ = 13;  // P열 = 전화번호 (C~Q 범위 내 index 13)
    if (phoneColIdxs.indexOf(P_IDX_IN_CQ) === -1) phoneColIdxs.push(P_IDX_IN_CQ);
    for (var ri = 0; ri < salesData.length; ri++) {
      for (var pi = 0; pi < phoneColIdxs.length; pi++) {
        var pIdx = phoneColIdxs[pi];
        salesData[ri][pIdx] = _pep_fixPhoneLeadingZero_(salesData[ri][pIdx]);
      }
    }

    var todayStr = fallbackDateStr || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayStr))) {
      todayStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    }

    // 허브 시트에서 스냅샷 탭 가져오기/생성
    var hubSS = SpreadsheetApp.getActiveSpreadsheet();
    var snapTab = hubSS.getSheetByName(_SNAPSHOT_TAB_NAME_);
    if (!snapTab) {
      snapTab = hubSS.insertSheet(_SNAPSHOT_TAB_NAME_);
      // 헤더 설정: A=스냅샷날짜, B=매칭키, C~Q=판매현황(15열), R=상태
      var snapHeaders = ["스냅샷날짜", "매칭키"].concat(salesHeaders).concat(["상태"]);
      snapTab.getRange(1, 1, 1, snapHeaders.length).setValues([snapHeaders]);
      snapTab.getRange("1:1").setBackground("#1a237e").setFontColor("white")
        .setFontWeight("bold").setHorizontalAlignment("center");
      snapTab.setFrozenRows(1);
      // ★ 2026-06-25: 스냅샷 탭 전화번호 열 텍스트 서식 (앞 0 보존)
      for (var pfi = 0; pfi < phoneColIdxs.length; pfi++) {
        var snapPhoneCol = phoneColIdxs[pfi] + 3; // +2(날짜,매칭키) +1(1-based)
        snapTab.getRange(2, snapPhoneCol, snapTab.getMaxRows() - 1, 1).setNumberFormat("@");
      }
      Logger.log("[SNAPSHOT] 스냅샷 탭 신규 생성: " + _SNAPSHOT_TAB_NAME_);
    }

    // 기존 스냅샷에서 오늘 날짜 + 매칭키 중복 체크 셋 구축
    var existKeySet = {};
    var snapLr = snapTab.getLastRow();
    if (snapLr >= 2) {
      var existData = snapTab.getRange(2, 1, snapLr - 1, 2).getValues(); // A=날짜, B=매칭키
      for (var ei = 0; ei < existData.length; ei++) {
        var eDate = existData[ei][0];
        // 날짜 객체일 수 있으므로 포맷팅
        if (eDate instanceof Date) {
          eDate = Utilities.formatDate(eDate, "Asia/Seoul", "yyyy-MM-dd");
        } else {
          eDate = String(eDate || "").trim();
          if (eDate.length > 10) eDate = eDate.substring(0, 10);
        }
        var eKey = String(existData[ei][1] || "").trim();
        if (eKey) existKeySet[eKey] = { row: ei + 2, date: eDate };
      }
    }

    // 스냅샷 행 구성
    var newRows = [];
    var J_IDX_IN_CQ = 7;   // J열 = 판매처/가게명 (C~Q 범위 내 index 7)
    // ★ 2026-06-30: 동일 전화번호 복수 주문 지원용 카운터
    var telKeyCounter = {};

    for (var si = 0; si < salesData.length; si++) {
      // ★ 2026-06-30: 판매현황 A~B열 기반 요약행("계", "합계") 스킵
      var _colA_ = String(abData[si][0] || "").trim();
      var _colB_ = String(abData[si][1] || "").trim();
      if (/계$/.test(_colA_) || _colA_ === "합계" || /계$/.test(_colB_) || _colB_ === "합계") continue;

      var oVal = String(salesData[si][O_IDX_IN_CQ] || "").trim();
      var telName = String(salesData[si][J_IDX_IN_CQ] || "").trim();
      var telPhone = String(salesData[si][P_IDX_IN_CQ] || "").trim();
      telPhone = String(_pep_fixPhoneLeadingZero_(telPhone));
      // O열(일일마감 M열 주문자명(사방넷)) = 주문자명/고유아이디. 슬래시 뒤만 키.
      var matchKey = _pep_deriveMatchKeyFromSalesCols_(oVal, telName, telPhone);
      if (!oVal && telName) {
        salesData[si][O_IDX_IN_CQ] = telName;
      }

      // ★ 2026-06-30: 매칭키 없어도 절대 스킵하지 않음 — 판매현황 모든 내용 저장
      // 폴백: 행 데이터 기반 키 생성 (전화주문 등 O열+P열 모두 비어있는 경우)
      if (!matchKey) {
        var fbParts = [];
        for (var fbi = 0; fbi < Math.min(salesData[si].length, 15); fbi++) {
          var fbVal = String(salesData[si][fbi] || "").trim();
          if (fbVal) fbParts.push(String(fbVal).substring(0, 12));
        }
        if (fbParts.length > 0) {
          matchKey = "FB:" + fbParts.join("|");
        } else {
          continue; // 완전히 빈 행만 스킵
        }
      }

      var orderDateStr = todayStr;
      if (dateCol >= 0 && dateCol <= 1) {
        orderDateStr = _pep_parseSalesDateCell_(abData[si][dateCol], todayStr);
      } else if (dateCol >= 2) {
        orderDateStr = _pep_parseSalesDateCell_(salesData[si][dateCol - 2], todayStr);
      } else {
        var fromCQ = _pep_deriveSnapOrderDate_(salesData[si], salesHeaders, "");
        var fromB = _pep_parseSalesDateCell_(abData[si][1], "");
        orderDateStr = fromCQ || fromB || todayStr;
      }

      function _pep_bumpSnapDate_(hit, newDate) {
        if (!hit || !hit.row || !newDate) return;
        if (String(hit.date || "") === newDate) return;
        try {
          snapTab.getRange(hit.row, 1).setValue(newDate);
          hit.date = newDate;
          result.dateFixed = (result.dateFixed || 0) + 1;
        } catch (eFix) {}
      }

      // ★ 2026-06-30: 동일 매칭키 중복 시 순번 추가 (같은 전화번호로 여러 건 주문)
      if (existKeySet[matchKey]) {
        _pep_bumpSnapDate_(existKeySet[matchKey], orderDateStr);
        if (!telKeyCounter[matchKey]) telKeyCounter[matchKey] = 1;
        telKeyCounter[matchKey]++;
        var seqKey = matchKey + "#" + telKeyCounter[matchKey];
        if (existKeySet[seqKey]) {
          _pep_bumpSnapDate_(existKeySet[seqKey], orderDateStr);
          result.skipped++;
          continue;
        }
        matchKey = seqKey;
      }
      existKeySet[matchKey] = { row: 0, date: orderDateStr };

      // 행: [주문일, 매칭키, C~Q(15열), 상태]
      var snapRow = [orderDateStr, matchKey].concat(salesData[si]).concat([_SNAPSHOT_STATUS_UNMATCHED_]);
      newRows.push(snapRow);
      result.saved++;
    }


    // 배치 쓰기
    if (newRows.length > 0) {
      var writeRow = snapTab.getLastRow() + 1;
      if (writeRow < 2) writeRow = 2;
      for (var pfi2 = 0; pfi2 < phoneColIdxs.length; pfi2++) {
        var snapPhoneCol2 = phoneColIdxs[pfi2] + 3; // +2(날짜,매칭키) +1(1-based)
        snapTab.getRange(writeRow, snapPhoneCol2, newRows.length, 1).setNumberFormat("@");
      }
      snapTab.getRange(writeRow, 1, newRows.length, newRows[0].length).setValues(newRows);
      SpreadsheetApp.flush();
    }

    Logger.log("[SNAPSHOT] 판매현황 스냅샷 저장: 신규=" + result.saved +
      " 중복스킵=" + result.skipped +
      (result.dateFixed ? " 일자보정=" + result.dateFixed : "") +
      " (폴백날짜=" + todayStr + ")");

  } catch (e) {
    result.error = e.message;
    Logger.log("[SNAPSHOT] 오류: " + e.message);
  }
  return result;
}

/**
 * 스냅샷 탭에서 7일 초과 미매칭 행 정리 + 매칭완료 행 삭제
 * ★ 일일마감 끝에서 호출
 */
function _pep_cleanupSnapshot_() {
  try {
    var hubSS = SpreadsheetApp.getActiveSpreadsheet();
    var snapTab = hubSS.getSheetByName(_SNAPSHOT_TAB_NAME_);
    if (!snapTab || snapTab.getLastRow() < 2) return { cleaned: 0, expired: 0 };

    var lr = snapTab.getLastRow();
    var lc = snapTab.getLastColumn();
    var data = snapTab.getRange(2, 1, lr - 1, lc).getValues();

    var today = new Date();
    var keepRows = [];
    var cleaned = 0, expired = 0;

    for (var i = 0; i < data.length; i++) {
      var status = String(data[i][lc - 1] || "").trim(); // 마지막 열 = 상태

      // 매칭완료 → 삭제
      if (status === _SNAPSHOT_STATUS_MATCHED_) {
        cleaned++;
        continue;
      }

      // 7일 초과 미매칭 → 삭제 + 카운트
      var snapDate = new Date(String(data[i][0] || ""));
      if (!isNaN(snapDate.getTime())) {
        var daysDiff = Math.floor((today - snapDate) / (1000 * 60 * 60 * 24));
        if (daysDiff > 7) {
          expired++;
          continue;
        }
      }

      keepRows.push(data[i]);
    }

    // 재작성
    if (cleaned > 0 || expired > 0) {
      snapTab.getRange(2, 1, lr - 1, lc).clearContent();
      if (keepRows.length > 0) {
        snapTab.getRange(2, 1, keepRows.length, lc).setValues(keepRows);
      }
      SpreadsheetApp.flush();
    }

    Logger.log("[SNAPSHOT_CLEANUP] 매칭완료 삭제=" + cleaned + " 7일초과=" + expired +
      " 유지=" + keepRows.length);
    return { cleaned: cleaned, expired: expired };
  } catch (e) {
    Logger.log("[SNAPSHOT_CLEANUP] 오류: " + e.message);
    return { cleaned: 0, expired: 0 };
  }
}

// ═════════════════════════════════════════════
//  ★ 통합 일일 마감 시스템
//  4개 소스를 공통 포맷으로 정규화 → 일일마감_(날짜) 시트
// ═════════════════════════════════════════════

var _UNIFIED_ARCHIVE_PREFIX_ = "일일마감_";
var _UNIFIED_HEADER_BG_ = "#1a237e";

/**
 * 이전 일일마감 파일을 찾을 때 거슬러 보는 최대 일수.
 * 본체 2단계는 「바로 이전 파일 1개」만 채운다. 주말·휴일로 파일이 비면
 * 그 앞의 마지막 일일마감을 찾는다.
 */
var _PEP_BACKFILL_DAYS_ = 14;

var _UNIFIED_HEADERS_ = [
  "출처",         // A: 로젠 / 대리공급
  "기록일시",     // B
  "주문번호",     // C: 검색 핵심 키
  "운송장번호",   // D: 검색 핵심 키
  "수취인명",     // E
  "전화번호",     // F
  "휴대폰",       // G
  "주소",         // H
  "품목코드",     // I
  "품목명",       // J
  "수량",         // K
  "배송메시지",   // L
  "업체/판매처",  // M
  "운임/배송비",  // N
  "비고",         // O
  "발주업체",     // P: 협력업체명
  "주문유형",     // Q: 로젠/대리공급
  "단가",         // R: 플랫폼별 실판매단가
  "정산금액",     // S: 단가 × 수량
];

/** 운송장번호 정규화: 하이픈/공백 제거, "- -" 같은 빈칸 표시는 없음으로 처리 */
function _pep_normInvoiceNo_(inv) {
  var s = String(inv == null ? "" : inv).trim();
  if (!s) return "";
  var digits = s.replace(/[^0-9]/g, "");
  if (digits.length < 8) return "";
  return digits;
}

/** 운송장 문자열을 고유 번호 배열로 분해 (줄바꿈/쉼표 구분, 하이픈 제거) */
function _pep_splitInvNos_(inv) {
  return String(inv || "")
    .split(/[\r\n,;]+/)
    .map(function (s) { return _pep_normInvoiceNo_(s); })
    .filter(function (s) { return !!s; });
}

/**
 * invoiceMap에 송장을 누적 (같은 주문번호에 송장이 여러 개면 줄바꿈으로 합침)
 *
 * @param {string=} carrier 택배사명. 출처만으로는 택배사를 알 수 없는 원천
 *   (허브·임시기록·전용마감 = 업체가 자기 택배사로 보낸다) 이 넘긴다.
 *   일일마감 택배사 열은 이 값을 그대로 쓴다. 롯데·로젠처럼 출처가 곧
 *   택배사인 원천은 넘기지 않아도 `_pep_carrierFromSource_` 로 채워진다.
 */
/**
 * 일일마감 M열 `주문자명(사방넷)` = `주문자명/고유아이디`.
 * 마지막 `/` 뒤가 고유ID 다. 슬래시가 없으면 칸 전체가 후보.
 * 조회·적재·재매칭이 **여기만** 쓴다. 칸 전체를 키로 넣으면 송장맵과 안 맞는다.
 */
function _pep_uidFromOrdererCell_(cell) {
  var s = String(cell == null ? "" : cell).trim();
  if (!s) return "";
  if (s.indexOf("/") !== -1) s = s.split("/").pop().trim();
  return _pep_normalizeMatchUid_(s);
}

/** trim, `#n` 접미사, `|코드` 접미사, `_S숫자` 세트접미 */
function _pep_normalizeMatchUid_(uid) {
  var u = String(uid == null ? "" : uid).trim();
  if (!u) return "";
  u = u.replace(/#\d+$/, "");
  var pipe = u.indexOf("|");
  if (pipe > 0) u = u.substring(0, pipe);
  u = u.replace(/_S\d+$/, "");
  return u;
}

/**
 * 진짜 고유ID 인가.
 * 사방넷 주문번호·우리가 발급한 `MMdd-ds-` / `MMdd-ph-` 는 예.
 * 한글 이름만, `TEL:`, `FB:` 는 아니오 — 그 행은 조합키로 간다.
 */
function _pep_isRealUid_(key) {
  var k = _pep_uidFromOrdererCell_(key);
  if (!k || k.length <= 2) return false;
  if (k.indexOf("TEL:") === 0 || k.indexOf("FB:") === 0) return false;
  if (/[\uAC00-\uD7AF]/.test(k)) return false;
  var d = k.replace(/[^0-9]/g, "");
  if (/^01[016789]\d{7,8}$/.test(d) && !/-ph-|-ds-/i.test(k)) return false;
  return true;
}

/**
 * 행 하나 송장 조회 — 일일마감·백필·통합조회·재매칭이 같은 함수를 쓴다.
 * 고유ID 가 있으면 그 키만. 없으면 이름+전화+품목+주소 조합만.
 */
function _pep_resolveRowInvoice_(map, row, outVia) {
  row = row || {};
  if (outVia) { outVia.via = ""; outVia.uid = ""; }
  var uid = _pep_uidFromOrdererCell_(row.uid);
  if (_pep_isRealUid_(uid)) {
    if (outVia) outVia.uid = uid;
    var hit = _pep_lookupInvoiceMap_(map, uid);
    if (hit && hit.inv) {
      hit = _pep_applyOrderDateFilter_(hit, row.orderDate);
      if (hit && hit.inv) {
        if (outVia) outVia.via = "UID";
        return hit;
      }
    }
    if (outVia) outVia.via = "UID미매칭";
    return null;
  }
  var np = _pep_lookupNamePhoneInvoice_(map, row.name, row.phone, row.addr, row.item, outVia);
  return _pep_applyOrderDateFilter_(np, row.orderDate);
}

/** 화면값·Date → yyyymmdd 숫자. 못 읽거나 연도가 이상하면 0 */
function _pep_ymdNum_(raw) {
  if (raw && typeof raw.getFullYear === "function" && !isNaN(raw.getTime())) {
    return _pep_ymdPack_(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return 0;
  // 2026-08-28 / 2026. 8. 28 / 2026년 8월 28일 (점 뒤 공백 허용)
  var m = s.match(/(\d{4})[-/.년]\s*(\d{1,2})[-/.월]\s*(\d{1,2})/);
  if (m) {
    var n = _pep_ymdPack_(m[1], m[2], m[3]);
    if (n) return n;
  }
  // 08/28/2026 (MDY) 또는 28/08/2026 (DMY)
  var mdy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (mdy) {
    var a = parseInt(mdy[1], 10), b = parseInt(mdy[2], 10), y = parseInt(mdy[3], 10);
    var n2 = (a > 12 && b <= 12)
      ? _pep_ymdPack_(y, b, a)
      : _pep_ymdPack_(y, a, b);
    if (n2) return n2;
  }
  var d = s.replace(/[^0-9]/g, "");
  if (d.length >= 8) return _pep_ymdPack_(d.substring(0, 4), d.substring(4, 6), d.substring(6, 8));
  return 0;
}

function _pep_ymdPack_(y, m, d) {
  y = parseInt(y, 10);
  m = parseInt(m, 10);
  d = parseInt(d, 10);
  if (!(y >= 2020 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return 0;
  return y * 10000 + m * 100 + d;
}

function _pep_ymdLagDays_(orderYmd, pickYmd) {
  var a = parseInt(orderYmd, 10) || 0;
  var b = parseInt(pickYmd, 10) || 0;
  if (!a || !b || b < a) return 0;
  var ay = Math.floor(a / 10000), am = Math.floor((a % 10000) / 100), ad = a % 100;
  var by = Math.floor(b / 10000), bm = Math.floor((b % 10000) / 100), bd = b % 100;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** 택배사명에 주문~집하 경과일. 당일이면 숫자를 붙이지 않는다. */
function _pep_carrierWithLag_(carrier, lagDays) {
  var c = String(carrier || "").replace(/\(\d{1,2}\)\s*$/, "").trim();
  if (!c) return "";
  var n = parseInt(lagDays, 10);
  if (!(n >= 1)) return c;
  if (n > 99) n = 99;
  return c + "(" + (n < 10 ? "0" + n : String(n)) + ")";
}

/**
 * 집하일이 주문일보다 이른 송장은 뺀다 (재구매 고객의 과거 출고분).
 * 집하일이 없는 송장은 그대로 둔다 — 날짜 모른다고 미매칭으로 만들면 안 된다.
 */
function _pep_applyOrderDateFilter_(hit, orderDate) {
  if (!hit || !hit.inv) return hit;
  var orderYmd = _pep_ymdNum_(orderDate);
  var parts = _pep_splitInvNos_(hit.inv);
  if (!parts.length) return hit;
  var dates = hit._dates || {};
  var kept = [];
  var pickMin = 0;
  var dated = 0;
  for (var i = 0; i < parts.length; i++) {
    var d = parseInt(dates[parts[i]], 10) || 0;
    if (d) dated++;
    // 집하가 주문보다 3일 이상 이르면 과거 출고분으로 본다.
    // 1~2일 차이는 접수/매출일 어긋남·스냅샷이 실행일로 남은 경우라 버리지 않는다.
    if (orderYmd && d && d < orderYmd && _pep_ymdLagDays_(d, orderYmd) >= 3) continue;
    kept.push(parts[i]);
    if (d && (!pickMin || d < pickMin)) pickMin = d;
  }
  if (orderYmd && dated === parts.length && !kept.length) return null;
  if (!kept.length) return hit;
  return {
    inv: kept.join("\n"),
    source: hit.source || "",
    carrier: hit.carrier || "",
    _dates: dates,
    picked: pickMin,
    lag: (orderYmd && pickMin) ? _pep_ymdLagDays_(orderYmd, pickMin) : 0
  };
}

/** 수량 칸에 숫자가 있고 송장 장수가 slot.max(2N) 를 넘으면 true */
function _pep_qtyOverMax_(qty, itemName, invCell) {
  if (typeof _par_slotSpec_ !== "function") return false;
  var qtyRaw = String(qty == null ? "" : qty).replace(/[^0-9]/g, "");
  if (!qtyRaw) return false;
  var slot = _par_slotSpec_(qty, itemName);
  return _pep_splitInvNos_(invCell).length > slot.max;
}

/** picked = 집하일(yyyymmdd 숫자 또는 화면값). 같은 송장에 이미 날짜가 있으면 유지 */
function _pep_addInvoiceMap_(map, key, inv, source, carrier, picked) {
  if (!map || !key) return;
  key = String(key).trim();
  if (!key) return;
  // NAME: / NP7: 같은 조합키는 그대로. 원천 주문번호만 #n · |코드 · _S 를 벗긴다.
  if (key.indexOf(":") === -1 && typeof _pep_normalizeMatchUid_ === "function") {
    var nk = _pep_normalizeMatchUid_(key);
    if (nk) key = nk;
  }
  // 주문자명/고유ID 만 슬래시 뒤로도 적재. NPI:이름|전화|품목 의 | 는 건드리면 안 된다.
  if (key.indexOf("/") !== -1) {
    var extracted = _pep_uidFromOrdererCell_(key);
    if (extracted && extracted !== key) {
      _pep_addInvoiceMap_(map, extracted, inv, source, carrier, picked);
    }
  }
  var parts = _pep_splitInvNos_(inv);
  if (!parts.length) return;
  if (!map[key]) {
    map[key] = { inv: "", source: source || "", carrier: carrier || "", _set: {}, _dates: {} };
  }
  if (!map[key]._dates) map[key]._dates = {};
  var ymd = typeof picked === "number" ? picked : _pep_ymdNum_(picked);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (ymd && !map[key]._dates[p]) map[key]._dates[p] = ymd;
    if (map[key]._set[p]) continue;
    map[key]._set[p] = true;
    map[key].inv = map[key].inv ? map[key].inv + "\n" + p : p;
  }
  if (source && !map[key].source) map[key].source = source;
  if (carrier && !map[key].carrier) map[key].carrier = carrier;
}

function _pep_lookupInvoiceMap_(map, matchKey) {
  if (!map || !matchKey) return null;
  if (map[matchKey] && map[matchKey].inv) return map[matchKey];
  var extracted = _pep_uidFromOrdererCell_(matchKey);
  if (extracted && extracted !== matchKey && map[extracted] && map[extracted].inv) {
    return map[extracted];
  }
  var base = String(matchKey).replace(/#\d+$/, "");
  if (base && base !== matchKey && map[base] && map[base].inv) return map[base];
  return null;
}

function _pep_normRecipName_(name) {
  var s = String(name || "").trim();
  if (s.indexOf("/") !== -1) s = s.split("/")[0].trim();
  s = s.replace(/\s+/g, "").replace(/님$/, "");
  return s;
}

function _pep_phoneTail_(phone) {
  var p = _pep_phoneDigits_(phone);
  return p.length >= 4 ? p.substring(p.length - 4) : p;
}

// ─────────────────────────────────────────────────────
//  ★ 2026-08-25: 고유ID 없는 건의 매칭 보강
//    롯데 송장은 전화 뒷 4자리가 *로 마스킹돼 온다("010-1234-****").
//    → 뒷 4자리는 쓸 수 없으므로 앞 7자리 + 주소 앞부분을 보조키로 쓴다.
// ─────────────────────────────────────────────────────

/** 주소키 길이 — 시도+시군구+도로명 수준이면 동명이인 구분에 충분 */
var _PEP_ADDR_KEY_LEN_ = 12;

/** 선행 시/도 표준 축약 (긴 표기 우선 매칭) */
var _PEP_SIDO_ALIAS_ = [
  ["서울특별시", "서울"], ["부산광역시", "부산"], ["대구광역시", "대구"],
  ["인천광역시", "인천"], ["광주광역시", "광주"], ["대전광역시", "대전"],
  ["울산광역시", "울산"], ["세종특별자치시", "세종"],
  ["강원특별자치도", "강원"], ["전북특별자치도", "전북"],
  ["제주특별자치도", "제주"], ["충청북도", "충북"], ["충청남도", "충남"],
  ["전라북도", "전북"], ["전라남도", "전남"],
  ["경상북도", "경북"], ["경상남도", "경남"],
  ["경기도", "경기"], ["강원도", "강원"], ["제주도", "제주"],
  ["서울시", "서울"], ["부산시", "부산"], ["대구시", "대구"],
  ["인천시", "인천"], ["대전시", "대전"], ["울산시", "울산"], ["세종시", "세종"]
];

/**
 * 주소 → 비교용 정규화 키 (앞부분만)
 * 표기 차이("서울특별시 강남구 테헤란로 123, 4층" vs "서울 강남구 테헤란로 123 4층")를
 * 같은 키로 모으기 위해 시도 축약·괄호·공백·구분자를 제거한다.
 */
function _pep_addrKey_(addr, len) {
  var s = String(addr == null ? "" : addr).trim();
  if (!s) return "";
  s = s.replace(/\([^)]*\)/g, " ");   // (참고항목) 제거
  s = s.replace(/[,\.·]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  for (var i = 0; i < _PEP_SIDO_ALIAS_.length; i++) {
    if (s.indexOf(_PEP_SIDO_ALIAS_[i][0]) === 0) {
      s = _PEP_SIDO_ALIAS_[i][1] + s.substring(_PEP_SIDO_ALIAS_[i][0].length);
      break;
    }
  }
  s = s.replace(/\s+/g, "").replace(/[^0-9A-Za-z\u3131-\u318E\uAC00-\uD7A3\-]/g, "");
  if (!s) return "";
  return s.substring(0, len || _PEP_ADDR_KEY_LEN_);
}

/** 마스킹 전화 여부 (010-1234-**** / 자릿수 부족) */
function _pep_isMaskedPhone_(phone) {
  var s = String(phone == null ? "" : phone);
  if (!s.trim()) return false;
  if (/[*xX\uFF0A\u2731#]/.test(s)) return true;
  return _pep_phoneDigits_(phone).length < 10;
}

/** 전화 앞 7자리 — 마스킹돼도 남는 부분 */
function _pep_phone7_(phone) {
  var p = _pep_phoneDigits_(phone);
  return p.length >= 7 ? p.substring(0, 7) : "";
}

/** 품목키 길이 — 원천마다 뒤에 붙는 표기가 달라 앞부분만 쓴다 */
var _PEP_ITEM_KEY_LEN_ = 16;

/**
 * 품목명 정규화 키.
 * 한 사람이 여러 건을 주문하면 이름·전화·주소가 모두 같아 행을 구분할 수 없다.
 * 품목명을 키에 넣어 주문 행마다 자기 송장만 집어오게 한다.
 *
 * 걷어내는 것은 표기 차이뿐이다 — [무료배송] 같은 판촉 꼬리표, 공백, 구분기호.
 * ★ 숫자·규격은 남긴다. "종이컵50개"와 "종이컵100개"는 다른 품목이므로,
 *   수량 표기를 지우면 한 사람의 서로 다른 주문이 다시 한 키로 뭉친다.
 *   원천마다 품목명이 달라 키가 안 맞으면 종전 키로 폴백하니 손실이 없다.
 */
function _pep_itemKey_(item) {
  var s = String(item == null ? "" : item).trim();
  if (!s) return "";
  s = s.replace(/\[[^\]]*\]/g, " ");   // [무료배송] 같은 판촉 표시
  s = s.replace(/[^0-9A-Za-z\u3131-\u318E\uAC00-\uD7A3]/g, "");
  if (!s) return "";
  return s.substring(0, _PEP_ITEM_KEY_LEN_);
}

/** info.inv 에 실린 송장 개수 (누적되면 2개 이상이 된다) */
function _pep_invCount_(info) {
  if (!info || !info.inv) return 0;
  return _pep_splitInvNos_(info.inv).length;
}

/**
 * 소스별 보조키 등록 통계 — 「보조키 매칭 진단」에서 읽는다.
 * 어느 소스가 전화·주소를 실제로 제공하는지 눈으로 확인하는 용도.
 */
var _PEP_KEYSTAT_ = null;

function _pep_keyStatReset_() { _PEP_KEYSTAT_ = {}; }

function _pep_keyStat_(source) {
  if (!_PEP_KEYSTAT_) _PEP_KEYSTAT_ = {};
  var k = String(source || "기타");
  if (!_PEP_KEYSTAT_[k]) {
    _PEP_KEYSTAT_[k] = {
      rows: 0, name: 0, np7: 0, na: 0, npa: 0, masked: 0,
      item: 0, npi: 0, nai: 0, ni: 0,
    };
  }
  return _PEP_KEYSTAT_[k];
}

/** 전화번호 숫자만 (선행 0 복원) — 일일마감 이름+전화 매칭용 */
function _pep_phoneDigits_(phone) {
  var raw = (typeof _pep_fixPhoneLeadingZero_ === "function")
    ? _pep_fixPhoneLeadingZero_(phone)
    : phone;
  var p = String(raw == null ? "" : raw).replace(/[^0-9]/g, "");
  if (p.length >= 10 && p.charAt(0) !== "0") p = "0" + p;
  return p;
}

/**
 * 일일마감 전용: 수취인+전화 보조키를 invoiceMap에 누적
 * (송장수집 partnerFetchInvoices 는 이 키를 쓰지 않음)
 */
function _pep_addNamePhoneInvoiceKeys_(map, name, phone, inv, source, opt) {
  if (!map || !inv) return;
  var n = _pep_normRecipName_(name);
  var p = _pep_phoneDigits_(phone);
  var masked = _pep_isMaskedPhone_(phone);
  var p7 = _pep_phone7_(phone);
  var ak = _pep_addrKey_(opt && opt.addr);
  var st = opt && opt.stat ? opt.stat : null;
  // 택배사는 출처만으로 알 수 없는 원천(업체 출고)이 넘긴다. 일일마감 택배사 열이 쓴다.
  var cr = (opt && opt.carrier) || "";
  var pk = opt && opt.picked;

  if (n && !(opt && opt.skipName)) {
    _pep_addInvoiceMap_(map, "NAME:" + n, inv, source, cr, pk);
    if (st) st.name = (st.name || 0) + 1;
  }

  // ★ 마스킹 전화는 "앞자리만 남은 값"이므로 전체번호·뒷4자리 키를 만들면 안 된다.
  //   (예: "010-1234-****" → 숫자 "0101234", 뒷4자리 "1234"는 실제 뒷자리가 아님)
  if (p && !masked) {
    _pep_addInvoiceMap_(map, "TEL:" + p, inv, source, cr, pk);
    if (p.length >= 8) _pep_addInvoiceMap_(map, "PH:" + p, inv, source, cr, pk);
    if (n && p.length >= 4) {
      _pep_addInvoiceMap_(map, "NP:" + n + "|" + p.substring(p.length - 4), inv, source, cr, pk);
    }
  }
  if (n && p7) {
    _pep_addInvoiceMap_(map, "NP7:" + n + "|P" + p7, inv, source, cr, pk);
    if (st) st.np7 = (st.np7 || 0) + 1;
  }
  if (n && ak) {
    _pep_addInvoiceMap_(map, "NA:" + n + "|" + ak, inv, source, cr, pk);
    if (st) st.na = (st.na || 0) + 1;
    if (p7) {
      _pep_addInvoiceMap_(map, "NPA:" + n + "|P" + p7 + "|" + ak, inv, source, cr, pk);
      if (st) st.npa = (st.npa || 0) + 1;
    }
  }

  // ★ 2026-08-26: 품목키.
  //   위 키들은 사람만 가리키므로, 한 사람이 여러 건을 주문하면 한 키에 송장이
  //   여러 개 쌓이고 그 사람의 모든 행이 같은 목록을 받아간다. 품목명을 끼워
  //   주문 행마다 자기 송장을 집어오게 한다.
  var ik = _pep_itemKey_(opt && opt.item);
  if (n && ik) {
    if (p7) {
      _pep_addInvoiceMap_(map, "NPI:" + n + "|P" + p7 + "|" + ik, inv, source, cr, pk);
      if (st) st.npi = (st.npi || 0) + 1;
    }
    if (ak) {
      _pep_addInvoiceMap_(map, "NAI:" + n + "|" + ak + "|" + ik, inv, source, cr, pk);
      if (st) st.nai = (st.nai || 0) + 1;
    }
    // 롯데탭처럼 전화·주소가 없는 원천은 이 키만 만들 수 있다
    _pep_addInvoiceMap_(map, "NI:" + n + "|" + ik, inv, source, cr, pk);
    if (st) { st.ni = (st.ni || 0) + 1; st.item = (st.item || 0) + 1; }
  }

  if (st) {
    st.rows = (st.rows || 0) + 1;
    if (masked) st.masked = (st.masked || 0) + 1;
  }
}

/**
 * 고유ID가 없거나 UID 매칭 실패 시 보조 조회.
 * 정확한 키부터 순서대로 시도한다:
 *   이름+전화7+품목 → 이름+주소+품목 → 이름+전화7+주소 → 이름+전화7 → 이름+주소
 *   → 이름+품목 → 롯데 수취인명 → 이름+전화뒷4 → 전화 → 수취인명
 * ★ 롯데탭은 전화·주소가 없어 이름·품목 키만 만든다. 더 많은 필드가 맞는 키가
 *   신뢰도 높으므로 롯데 NAME 폴백보다 앞에 둔다(동명이인 오매칭 방지).
 * ★ 2026-08-26: 한 사람이 여러 건을 주문하면 사람만 가리키는 키에 송장이 여러 개
 *   쌓여 모든 행이 같은 목록을 받아갔다. 송장이 하나로 확정되는 키를 우선한다.
 * @param {Object} map  invoiceMap
 * @param {string} name 수취인명
 * @param {*} phone     전화 (마스킹 허용)
 * @param {string=} addr 주소 (없으면 생략)
 * @param {string=} item 품목명 (없으면 생략)
 * @param {Object=} outVia 진단용 — 맞은 키 종류를 outVia.via,
 *                  송장이 하나로 확정되지 않았으면 outVia.multi 에 담아준다
 */
/**
 * 사람만 가리키는 조회 키.
 *
 * 품목이 안 들어가 있어서 한 사람의 **서로 다른 주문**이 같은 키에 쌓인다.
 * 송장맵에는 날짜가 없어 과거 출고분까지 함께 쌓인다. 그래서 이 키들이
 * 송장을 여러 개 들고 있으면 「분할 출고」가 아니라 「충돌」로 본다.
 *
 * 품목까지 맞는 NPI·NAI·NI 는 여기 넣지 않는다 — 같은 사람이 같은 품목을
 * 두 박스로 나눠 받는 경우가 실제로 있고, 그때는 둘 다 그 주문의 송장이다.
 */
var _PEP_PERSON_ONLY_VIA_ = {
  NP7: 1, NA: 1, NPA: 1, NP: 1,
  NAME: 1, "NAME(롯데)": 1, TEL: 1, PH: 1
};

function _pep_lookupNamePhoneInvoice_(map, name, phone, addr, item, outVia) {
  if (!map) return null;
  var n = _pep_normRecipName_(name);
  var p = _pep_phoneDigits_(phone);
  var masked = _pep_isMaskedPhone_(phone);
  var p7 = _pep_phone7_(phone);
  var ak = _pep_addrKey_(addr);
  var ik = _pep_itemKey_(item);

  // 구체적인 키부터. 품목키는 한 사람의 여러 주문을 행 단위로 갈라주므로 앞에 둔다.
  var tries = [];
  if (n && ik && p7) tries.push(["NPI", "NPI:" + n + "|P" + p7 + "|" + ik]);
  if (n && ik && ak) tries.push(["NAI", "NAI:" + n + "|" + ak + "|" + ik]);
  if (n && ak && p7) tries.push(["NPA", "NPA:" + n + "|P" + p7 + "|" + ak]);
  if (n && p7) tries.push(["NP7", "NP7:" + n + "|P" + p7]);
  if (n && ak) tries.push(["NA", "NA:" + n + "|" + ak]);
  // 롯데탭은 전화·주소가 없어 이름·품목 키만 만든다. 이름 단독보다 품목까지 맞는 쪽이 낫다.
  if (n && ik) tries.push(["NI", "NI:" + n + "|" + ik]);
  if (n && !masked && p.length >= 4) {
    tries.push(["NP", "NP:" + n + "|" + p.substring(p.length - 4)]);
  }

  // ★ 2026-08-27: 단일 필드 키(이름 단독 NAME, 전화 단독 TEL·PH)를 사다리에서 뺐다.
  //   위 키들은 모두 두 개 이상의 필드가 맞아야 성립하지만, 아래 셋은 하나만 맞으면
  //   걸린다. 송장맵에는 날짜가 없으므로 재구매 고객은 과거 출고분과 새 주문이
  //   같은 이름·전화 키를 공유한다. 그래서 이 셋이 과거 송장을 주워오는 통로였다.
  //   매칭률이 크게 떨어져 되돌려야 하면 _pt_allowSingleFieldMatch_() 를 켠다.
  if (typeof _pt_allowSingleFieldMatch_ === "function" && _pt_allowSingleFieldMatch_()) {
    if (n) tries.push(["NAME(롯데)", "NAME:" + n, "롯데"]);
    if (!masked && p.length >= 8) {
      tries.push(["TEL", "TEL:" + p]);
      tries.push(["TEL", "PH:" + p]);
    }
    if (n) tries.push(["NAME", "NAME:" + n]);
  }

  // 송장이 하나로 확정되는 키를 우선한다.
  // 확정되지 않으면 품목까지 맞는 키에 한해 여러 개를 그대로 돌려준다 (분할 출고).
  var first = null, firstVia = "";
  for (var t = 0; t < tries.length; t++) {
    var via = tries[t][0];
    var info = map[tries[t][1]];
    if (!info || !info.inv) continue;
    if (tries[t][2] && info.source !== tries[t][2]) continue;
    if (_pep_invCount_(info) === 1) {
      if (outVia) outVia.via = via;
      return info;
    }
    // ★ 2026-08-28: 사람만 가리키는 키가 송장을 여러 개 들고 있으면
    //   그것은 분할 출고가 아니라 **서로 다른 주문이 한 키에 쌓인 것**이다.
    //   대리발송처럼 수취인·전화·주소가 업체 자기 것이면 한 키에 수십 건이 모인다.
    //   그대로 쓰면 수량 1개 행이 송장 수십 개를 받는다. 후보에서 뺀다.
    if (_PEP_PERSON_ONLY_VIA_[via]) {
      if (outVia) outVia.ambiguous = (outVia.ambiguous || 0) + 1;
      continue;
    }
    if (!first) { first = info; firstVia = via; }
  }
  if (first) {
    if (outVia) { outVia.via = firstVia; outVia.multi = true; }
    return first;
  }
  if (outVia) outVia.via = "";
  return null;
}

/** 판매현황 전체 헤더에서 일자 열 (0-based). B열 `일자-No.` 가 정본이다. */
function _pep_findSalesDateCol_(fullHdr) {
  if (!fullHdr) return -1;
  for (var i = 0; i < fullHdr.length; i++) {
    var h = String(fullHdr[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (/일자-No|일자No|^일자$|주문일|매출일|판매일/.test(h)) return i;
  }
  return -1;
}

/**
 * 판매현황 일자 셀 → yyyy-MM-dd
 * `일자-No.` 예: 20260828-1, 0828-15, 2026-08-28, Date
 */
function _pep_parseSalesDateCell_(raw, fallbackStr) {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, "Asia/Seoul", "yyyy-MM-dd");
  }
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return fallbackStr || "";
  var iso = _pep_normSnapDate_(s, "");
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  var digits = s.replace(/[^0-9]/g, "");
  if (digits.length >= 8 && /^20\d{2}/.test(digits)) {
    var y = digits.substring(0, 4);
    var mo = digits.substring(4, 6);
    var da = digits.substring(6, 8);
    var mi = parseInt(mo, 10), di = parseInt(da, 10);
    if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31) return y + "-" + mo + "-" + da;
  }
  var m2 = s.match(/^(\d{2})(\d{2})(?:\D|$)/);
  if (m2) {
    var mm = parseInt(m2[1], 10), dd = parseInt(m2[2], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      var yyyy = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy");
      return yyyy + "-" + ("0" + mm).slice(-2) + "-" + ("0" + dd).slice(-2);
    }
  }
  return fallbackStr || "";
}

/** 스냅샷/아카이브 날짜 → yyyy-MM-dd */
function _pep_normSnapDate_(val, fallback) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, "Asia/Seoul", "yyyy-MM-dd");
  }
  var s = String(val || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return fallback || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

/** 판매현황 행에서 주문일(일일마감 파일 날짜) 추출 */
function _pep_deriveSnapOrderDate_(salesRow, salesHeaders, fallbackStr) {
  if (!salesRow || !salesRow.length) {
    return fallbackStr || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  }
  for (var hi = 0; hi < (salesHeaders || []).length; hi++) {
    var h = String(salesHeaders[hi] || "").replace(/\s/g, "");
    if (!h) continue;
    if (/일자-No|일자No|^일자$|주문일|매출일|판매일/.test(h)) {
      var d0 = _pep_parseSalesDateCell_(salesRow[hi], "");
      if (d0) return d0;
    }
  }
  var first = _pep_parseSalesDateCell_(salesRow[0], "");
  if (first) return first;
  return fallbackStr || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

/** 합포장·소분 품목명 판별 (---/소분, 합포장 등) */
function _pep_isCombinedPackItem_(itemName) {
  var s = String(itemName || "");
  return /---\/\s*소분|---\/.*소분|\/소분|합포장|===합배송|---.*합포/.test(s);
}

/** 일일마감 배치에 송장이 있는 실출고 행이 1건이라도 있는지 */
function _pep_batchHasInvoicedRows_(rows) {
  if (!rows || !rows.length) return false;
  var invIdx = rows[0].length - 2;
  var srcIdx = rows[0].length - 1;
  for (var i = 0; i < rows.length; i++) {
    var src = String(rows[i][srcIdx] || "").trim();
    if (src === "미매칭" || src === "기타") continue;
    if (_pep_normInvoiceNo_(rows[i][invIdx])) return true;
  }
  return false;
}

/** 일일마감 행 헤더 → 매칭용 열 인덱스 */
function _pep_mapArchiveMatchCols_(hdr) {
  var m = {
    name: -1, phone: -1, jShop: -1, inv: -1, src: -1, oid: -1,
    addr: -1, item: -1, qty: -1, carrier: -1, code: -1, orderer: -1
  };
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (m.code < 0 && /^품목코드$|^이카운트코드$|^물품코드$|^상품코드$/.test(h)) m.code = i;
    if (m.inv < 0 && /운송장번호|송장번호/.test(h) && !/반품/.test(h)) m.inv = i;
    if (m.src < 0 && h === "출처") m.src = i;
    // "택배박스" 같은 부분일치를 배제하려고 완전일치만 본다
    if (m.carrier < 0 && /^택배사$|^배송사$|^운송사$/.test(h)) m.carrier = i;
    // M열 주문자명(사방넷) = 주문자명/고유아이디. 합성열이지 raw oid 가 아니다.
    // `/사방넷/` 만으로 oid 에 넣으면 칸 전체가 키가 되어 송장맵과 안 맞는다.
    if (/주문자명\(사방넷\)|^주문자명$/.test(h)) {
      if (m.orderer < 0) m.orderer = i;
      if (m.name < 0) m.name = i;
      continue;
    }
    if (m.name < 0 && /수하인|수취인|받는/.test(h) && !/주소|전화/.test(h)) m.name = i;
    if (m.phone < 0 && /전화|휴대폰|핸드폰|연락처/.test(h) && !/보내/.test(h)) m.phone = i;
    if (m.addr < 0 && /주소/.test(h) && !/배송메|우편|보내/.test(h)) m.addr = i;
    if (m.jShop < 0 && /판매처|가게|거래처/.test(h) && !/코드/.test(h)) m.jShop = i;
    if (m.oid < 0 && /주문번호|사방넷주문번호|^고유ID$|^고유Id$/.test(h) && !/주문자명/.test(h)) {
      m.oid = i;
    }
    if (m.item < 0 && /품목명|상품명|제품명|품명/.test(h) && !/코드|수량|옵션/.test(h)) m.item = i;
    if (m.qty < 0 && (h === "수량" || h === "주문수량")) m.qty = i;
  }
  if (m.inv < 0) m.inv = Math.max(hdr.length - 2, 0);
  if (m.src < 0) m.src = Math.max(hdr.length - 1, 0);
  return m;
}

function _pep_deriveMatchKeyFromSalesCols_(oVal, jVal, pVal) {
  var uid = _pep_uidFromOrdererCell_(oVal);
  if (_pep_isRealUid_(uid)) return uid;
  var telPhone = String(_pep_fixPhoneLeadingZero_(pVal || ""));
  if (telPhone) return "TEL:" + telPhone;
  return uid || "";
}

function _pep_deriveMatchKeyFromArchiveRow_(row, cols) {
  var cell = "";
  if (cols.orderer >= 0) cell = row[cols.orderer];
  else if (cols.oid >= 0) cell = row[cols.oid];
  else if (cols.name >= 0) cell = row[cols.name];
  var uid = _pep_uidFromOrdererCell_(cell);
  if (_pep_isRealUid_(uid)) return uid;
  var jVal = cols.jShop >= 0 ? row[cols.jShop] : "";
  var pVal = cols.phone >= 0 ? row[cols.phone] : "";
  return _pep_deriveMatchKeyFromSalesCols_(cell, jVal, pVal);
}

/** 해당 날짜 일일마감에 이미 기록된 (주문키|송장) 쌍 */
function _pep_loadArchiveExistPair_(dateStr) {
  var existPair = {};
  var existArchFileName = _UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")";
  try {
    var existArchSs = _unified_findExistingArchiveSs_(existArchFileName);
    if (!existArchSs) return existPair;
    var existSheets = existArchSs.getSheets();
    for (var esi = 0; esi < existSheets.length; esi++) {
      if (existSheets[esi].getLastRow() < 2) continue;
      var existAll = existSheets[esi].getRange(1, 1, existSheets[esi].getLastRow(), existSheets[esi].getLastColumn()).getDisplayValues();
      var cols = _pep_mapArchiveMatchCols_(existAll[0]);
      for (var eRow = 1; eRow < existAll.length; eRow++) {
        if (String(existAll[eRow][0] || "").indexOf("합계") !== -1) continue;
        var mk = _pep_deriveMatchKeyFromArchiveRow_(existAll[eRow], cols);
        var invs = _pep_splitInvNos_(existAll[eRow][cols.inv]);
        for (var eii = 0; eii < invs.length; eii++) {
          if (mk) existPair[mk + "|" + invs[eii]] = true;
        }
      }
    }
  } catch (eExist) {}
  return existPair;
}

/** beforeDateStr 바로 앞에 실제로 있는 일일마감 날짜. 없으면 "" */
function _pep_findPreviousArchiveDate_(beforeDateStr) {
  var base;
  if (beforeDateStr && /^\d{4}-\d{2}-\d{2}$/.test(beforeDateStr)) {
    base = new Date(beforeDateStr.replace(/-/g, "/") + " 12:00:00");
  } else {
    base = new Date();
  }
  var lookback = _PEP_BACKFILL_DAYS_ || 14;
  for (var d = 1; d <= lookback; d++) {
    var dt = new Date(base.getTime());
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
    var fileName = _UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")";
    if (_unified_findExistingArchiveSs_(fileName)) return dateStr;
  }
  return "";
}

/**
 * 2단계: 바로 이전 일일마감 파일의 미매칭만 오늘 송장맵으로 기입
 */
function _pep_backfillPreviousArchive_(invoiceMap, beforeDateStr) {
  var out = { patched: 0, scanned: 0, files: 0, days: [], date: "" };
  var prev = _pep_findPreviousArchiveDate_(beforeDateStr);
  if (!prev) return out;
  var fileName = _UNIFIED_ARCHIVE_PREFIX_ + "(" + prev + ")";
  var archSs = _unified_findExistingArchiveSs_(fileName);
  if (!archSs) return out;
  var archTab = archSs.getSheetByName("일일마감") || archSs.getSheets()[0];
  var patch = _pep_patchArchiveTabUnmatched_(archTab, invoiceMap, prev);
  out.date = prev;
  out.files = 1;
  out.scanned = patch.scanned || 0;
  out.patched = patch.patched || 0;
  if (out.patched > 0) out.days.push(prev + ":" + out.patched);
  Logger.log("[UNIFIED] 2단계 이전마감 보강 " + prev +
    ": 채움=" + out.patched + " 스캔=" + out.scanned);
  return out;
}

/**
 * 최근 N일 일일마감에서 미매칭 행을 오늘 송장맵(롯데·허브·임시기록)으로 재매칭
 */
function _pep_backfillRecentArchives_(invoiceMap, maxDays) {
  maxDays = maxDays || _PEP_BACKFILL_DAYS_;
  var out = { patched: 0, scanned: 0, files: 0, days: [] };
  var today = new Date();
  for (var d = 1; d <= maxDays; d++) {
    var dt = new Date(today.getTime());
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
    var fileName = _UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")";
    var archSs = _unified_findExistingArchiveSs_(fileName);
    if (!archSs) continue;
    var archTab = archSs.getSheetByName("일일마감") || archSs.getSheets()[0];
    if (!archTab || archTab.getLastRow() < 2) continue;
    out.files++;
    var lr = archTab.getLastRow();
    var lc = Math.max(archTab.getLastColumn(), 1);
    var all = archTab.getRange(1, 1, lr, lc).getDisplayValues();
    var cols = _pep_mapArchiveMatchCols_(all[0]);
    var dayPatched = 0;
    for (var ri = 1; ri < all.length; ri++) {
      if (String(all[ri][0] || "").indexOf("합계") !== -1) continue;
      out.scanned++;
      var src = String(all[ri][cols.src] || "").trim();
      var inv = String(all[ri][cols.inv] || "").trim();
      if (inv && _pep_normInvoiceNo_(inv)) continue;
      if (src && src !== "미매칭") continue;
      var matchKey = _pep_deriveMatchKeyFromArchiveRow_(all[ri], cols);
      if (!matchKey) continue;
      var recipName = cols.name >= 0 ? _pep_normRecipName_(all[ri][cols.name]) : "";
      var phone = cols.phone >= 0 ? all[ri][cols.phone] : "";
      var addr = cols.addr >= 0 ? all[ri][cols.addr] : "";
      var itemNm = cols.item >= 0 ? all[ri][cols.item] : "";
      var invInfo = _pep_resolveRowInvoice_(invoiceMap, {
        uid: matchKey,
        name: recipName,
        phone: phone,
        addr: addr,
        item: itemNm,
        orderDate: dateStr
      });
      if (!invInfo || !invInfo.inv) continue;
      if (_pep_qtyOverMax_(cols.qty >= 0 ? all[ri][cols.qty] : "", itemNm, invInfo.inv)) continue;
      all[ri][cols.inv] = invInfo.inv;
      all[ri][cols.src] = invInfo.source || "대리공급";
      // 송장을 채웠으면 택배사도 같이 채운다. 송장만 있고 택배사가 비면
      // 웹앱이 어느 택배사로 조회해야 할지 몰라 네이버 검색으로 떨어진다.
      if (cols.carrier >= 0 && !String(all[ri][cols.carrier] || "").trim()) {
        var bfVendor = cols.jShop >= 0 ? all[ri][cols.jShop] : "";
        var bfCode = cols.code >= 0 ? all[ri][cols.code] : "";
        all[ri][cols.carrier] =
          _pep_carrierForArchiveRow_(invInfo, all[ri][cols.src], bfVendor, bfCode);
      }
      dayPatched++;
    }
    if (dayPatched > 0) {
      archTab.getRange(1, 1, all.length, lc).setValues(all);
      SpreadsheetApp.flush();
      out.patched += dayPatched;
      out.days.push(dateStr + ":" + dayPatched);
    }
  }
  if (out.patched > 0) {
    Logger.log("[UNIFIED] 이전 일일마감 송장 보강: " + out.patched + "건 / " + out.files + "개 파일 (" + out.days.join(", ") + ")");
  }
  return out;
}

var _PEP_UDA_PATCH_PROP_ = "_PEP_UDA_PATCH_DATE_";

/** 이미 만들어진 일일마감 파일의 미매칭 행만 송장맵으로 채운다. */
function _pep_patchArchiveTabUnmatched_(archTab, invoiceMap, dateStr) {
  var out = { patched: 0, stillEmpty: 0, scanned: 0 };
  if (!archTab || !invoiceMap) return out;
  var lr = archTab.getLastRow();
  if (lr < 2) return out;
  var lc = Math.max(archTab.getLastColumn(), 1);
  var all = archTab.getRange(1, 1, lr, lc).getDisplayValues();
  var cols = _pep_mapArchiveMatchCols_(all[0]);
  for (var ri = 1; ri < all.length; ri++) {
    if (String(all[ri][0] || "").indexOf("합계") !== -1) continue;
    out.scanned++;
    var src = String(all[ri][cols.src] || "").trim();
    var inv = String(all[ri][cols.inv] || "").trim();
    if (inv && _pep_normInvoiceNo_(inv)) continue;
    if (src && src !== "미매칭") continue;
    var matchKey = _pep_deriveMatchKeyFromArchiveRow_(all[ri], cols);
    if (!matchKey) { out.stillEmpty++; continue; }
    var itemNm = cols.item >= 0 ? all[ri][cols.item] : "";
    var invInfo = _pep_resolveRowInvoice_(invoiceMap, {
      uid: matchKey,
      name: cols.name >= 0 ? _pep_normRecipName_(all[ri][cols.name]) : "",
      phone: cols.phone >= 0 ? all[ri][cols.phone] : "",
      addr: cols.addr >= 0 ? all[ri][cols.addr] : "",
      item: itemNm,
      orderDate: dateStr
    });
    if (!invInfo || !invInfo.inv) { out.stillEmpty++; continue; }
    if (_pep_qtyOverMax_(cols.qty >= 0 ? all[ri][cols.qty] : "", itemNm, invInfo.inv)) {
      out.stillEmpty++;
      continue;
    }
    all[ri][cols.inv] = invInfo.inv;
    all[ri][cols.src] = invInfo.source || "대리공급";
    if (cols.carrier >= 0 && !String(all[ri][cols.carrier] || "").trim()) {
      all[ri][cols.carrier] = _pep_carrierForArchiveRow_(
        invInfo, all[ri][cols.src],
        cols.jShop >= 0 ? all[ri][cols.jShop] : "",
        cols.code >= 0 ? all[ri][cols.code] : "");
    }
    out.patched++;
  }
  if (out.patched > 0) {
    archTab.getRange(1, 1, all.length, lc).setValues(all);
    SpreadsheetApp.flush();
  }
  return out;
}

/**
 * 지정일 일일마감 파일의 미매칭만 다시 채운다.
 * 송장맵은 새로 만든다 — 마감 때 시간초과로 빠졌던 전용/발주 마감탭을 포함한다.
 */
function _pep_fillUnmatchedArchiveDay_(dateStr) {
  var out = { patched: 0, stillEmpty: 0, scanned: 0, keys: 0, error: "" };
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    out.error = "날짜 형식 오류";
    return out;
  }
  var fileName = _UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")";
  var archSs = _unified_findExistingArchiveSs_(fileName);
  if (!archSs) {
    out.error = "파일 없음: " + fileName;
    return out;
  }
  var archTab = archSs.getSheetByName("일일마감") || archSs.getSheets()[0];
  if (!archTab || archTab.getLastRow() < 2) {
    out.error = "일일마감 탭이 비어 있습니다";
    return out;
  }
  var stat = { lotte: 0, weekly: 0, ledger: 0, temp: 0, hub: 0, keys: 0, errors: [], skipPartnerArchives: true };
  var invoiceMap = (typeof _puv_buildInvoiceMap_ === "function")
    ? _puv_buildInvoiceMap_(stat)
    : {};
  out.keys = stat.keys || Object.keys(invoiceMap).length;
  var patch = _pep_patchArchiveTabUnmatched_(archTab, invoiceMap, dateStr);
  out.patched = patch.patched;
  out.stillEmpty = patch.stillEmpty;
  out.scanned = patch.scanned;
  if (stat.errors && stat.errors.length) {
    out.error = stat.errors.slice(0, 3).join(" / ");
  }
  Logger.log("[UNIFIED] 지정일 미매칭 재채움 " + dateStr +
    " 키=" + out.keys + " 채움=" + out.patched + " 남은미매칭=" + out.stillEmpty);
  return out;
}

function _pep_scheduleUnmatchedPatch_(dateStr) {
  if (!dateStr) return;
  try {
    PropertiesService.getScriptProperties().setProperty(_PEP_UDA_PATCH_PROP_, dateStr);
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "_pep_patchUnmatchedArchiveScheduled_") {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    ScriptApp.newTrigger("_pep_patchUnmatchedArchiveScheduled_")
      .timeBased().after(15 * 1000).create();
    Logger.log("[UNIFIED] 미매칭 재채움 예약: " + dateStr);
  } catch (e) {
    Logger.log("[UNIFIED] 미매칭 재채움 예약 실패: " + e.message);
  }
}

function _pep_patchUnmatchedArchiveScheduled_() {
  var dateStr = "";
  try {
    dateStr = PropertiesService.getScriptProperties().getProperty(_PEP_UDA_PATCH_PROP_) || "";
    PropertiesService.getScriptProperties().deleteProperty(_PEP_UDA_PATCH_PROP_);
  } catch (e) {}
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "_pep_patchUnmatchedArchiveScheduled_") {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
  } catch (eT) {}
  if (!dateStr) return;
  var dates = String(dateStr).split(",");
  var patched = 0, remain = 0, errs = [];
  for (var i = 0; i < dates.length; i++) {
    var d = String(dates[i] || "").trim();
    if (!d) continue;
    var one = _pep_fillUnmatchedArchiveDay_(d);
    patched += one.patched || 0;
    remain += one.stillEmpty || 0;
    if (one.error) errs.push(d + ": " + one.error);
  }
  Logger.log("[UNIFIED] 미매칭 재채움 자동실행: 채움=" + patched + " 남은=" + remain);
  try {
    var items = [
      { label: "✅ 채움", value: patched + "건" },
      { label: "⏳ 남은 미매칭", value: remain + "건" }
    ];
    if (errs.length) items.push({ label: "⚠", value: errs.join(" / ").substring(0, 200) });
    _chat_sendCard_("📋 일일마감 미매칭 재채움", dateStr, items);
  } catch (_) {}
}

/** [메뉴] 지정일 일일마감만 송장 재매칭 (롯데·1주출고 우선) */
function partnerFillUnmatchedArchiveForDate() {
  var ui = SpreadsheetApp.getUi();
  var now = new Date();
  var def = new Date(now.getTime());
  if (def.getDay() === 0) def.setDate(def.getDate() - 2);
  else if (def.getDay() === 6) def.setDate(def.getDate() - 1);
  else if (now.getHours() < 6) def.setDate(def.getDate() - 1);
  var defStr = Utilities.formatDate(def, "Asia/Seoul", "yyyy-MM-dd");
  var resp = ui.prompt(
    "지정일 송장 재매칭",
    "이미 있는 일일마감 파일만 고칩니다. 파일을 새로 만들지 않습니다.\n" +
      "롯데·1주출고 송장맵으로 비어 있는 칸을 채웁니다.\n\n날짜 yyyy-MM-dd\n기본: " + defStr,
    ui.ButtonSet.OK_CANCEL
  );
  if (!resp || resp.getSelectedButton() !== ui.Button.OK) return;
  var dateStr = String(resp.getResponseText() || "").trim() || defStr;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    ui.alert("날짜 형식이 아닙니다. yyyy-MM-dd 로 입력하세요.");
    return;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    ui.alert("다른 작업이 실행 중입니다. 잠시 후 다시 시도하세요.");
    return;
  }
  try {
    var out = _par_run_(false, 1, dateStr);
    ui.alert(out.msg);
  } finally {
    lock.releaseLock();
  }
}

/** 헤더 배열에서 택배사 열 위치. 없으면 -1 */
function _pep_findCarrierIdx_(hdr) {
  if (!hdr) return -1;
  for (var i = 0; i < hdr.length; i++) {
    if (/^택배사$|^배송사$|^운송사$/.test(String(hdr[i] || "").replace(/\s/g, ""))) return i;
  }
  return -1;
}

/**
 * 옛 레이아웃 마감 탭에 택배사 열을 **운송장번호 앞**에 끼워 넣는다.
 *
 * 맨 끝에 붙이면 「출처 = 마지막 열, 운송장번호 = 끝에서 두 번째」를 위치로
 * 가정하는 다섯 곳이 조용히 한 칸씩 틀어진다. 앞에 끼우면 그 가정이 그대로 산다.
 *
 * @return {number} 삽입한 0-based 인덱스. 못 넣었으면 -1
 */
function _pep_insertCarrierColumnInto_(archTab, oldHdr) {
  var invIdx = -1;
  for (var i = 0; i < oldHdr.length; i++) {
    var h = String(oldHdr[i] || "").replace(/\s/g, "");
    if (/운송장번호|송장번호/.test(h) && !/반품/.test(h)) { invIdx = i; break; }
  }
  if (invIdx < 0) return -1;
  try {
    archTab.insertColumnBefore(invIdx + 1);
    archTab.getRange(1, invIdx + 1)
      .setValue("택배사")
      .setBackground("#1a237e").setFontColor("white")
      .setFontWeight("bold").setFontSize(10)
      .setHorizontalAlignment("center");
    SpreadsheetApp.flush();
    Logger.log("[UNIFIED_ARCHIVE] 마감 탭에 택배사 열 삽입 (" +
      archTab.getParent().getName() + ", " + (invIdx + 1) + "번째)");
    return invIdx;
  } catch (eIns) {
    Logger.log("[UNIFIED_ARCHIVE] 택배사 열 삽입 실패: " + eIns.message);
    return -1;
  }
}

/**
 * 새 행(택배사 포함)을 이미 있는 일일마감 탭에 맞춘다.
 *
 * 세 갈래다.
 *   ① 탭이 비었다 → 새 헤더를 그대로 쓴다. 할 일 없음.
 *   ② 기존 헤더에 택배사가 있다 → 이미 새 레이아웃. 할 일 없음.
 *   ③ 기존 헤더가 옛 레이아웃 → 운송장번호 앞에 열을 끼워 넣고 헤더를 고친다.
 *      기존 행의 택배사 칸은 빈다(웹앱이 출처로 추론하는 종전 동작).
 *      운송장번호를 못 찾아 끼워 넣지 못하면 새 행에서 택배사를 떼어낸다.
 *
 * @return {{headers: Array, rows: Array}} 기록에 쓸 헤더·행
 */
function _pep_fitArchiveCarrierColumn_(archTab, headers, rows) {
  var newCarrierIdx = _pep_findCarrierIdx_(headers);
  if (newCarrierIdx < 0) return { headers: headers, rows: rows }; // 택배사 없는 호출

  var lastRow = archTab.getLastRow();
  var lastCol = archTab.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: headers, rows: rows }; // ①

  var oldHdr;
  try { oldHdr = archTab.getRange(1, 1, 1, lastCol).getDisplayValues()[0]; }
  catch (eH) { return { headers: headers, rows: rows }; }

  if (_pep_findCarrierIdx_(oldHdr) >= 0) return { headers: headers, rows: rows }; // ②

  // ③ 옛 레이아웃 — 운송장번호 앞에 열을 끼워 넣는다
  if (_pep_insertCarrierColumnInto_(archTab, oldHdr) >= 0) {
    return { headers: headers, rows: rows };
  }

  // 끼워 넣지 못했다 — 택배사를 떼고 옛 레이아웃으로 맞춘다
  var outHdr = [];
  for (var hi = 0; hi < headers.length; hi++) {
    if (hi !== newCarrierIdx) outHdr.push(headers[hi]);
  }
  var outRows = [];
  for (var ri = 0; ri < rows.length; ri++) {
    var r = [];
    for (var ci = 0; ci < rows[ri].length; ci++) {
      if (ci !== newCarrierIdx) r.push(rows[ri][ci]);
    }
    outRows.push(r);
  }
  return { headers: outHdr, rows: outRows };
}

/**
 * 일일마감 파일에 매칭 행 일괄 추가 (주문일별 분리 기록용)
 * @return {{ written: number, tabName: string }}
 */
function _pep_appendArchiveRows_(ss, dateStr, headers, rows, detail) {
  var out = { written: 0, tabName: _UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")" };
  if (!rows || !rows.length || !headers || !headers.length) return out;

  var archSs = _unified_getOrCreateArchiveSs_(ss, out.tabName);
  var archTab = archSs.getSheetByName("일일마감") || archSs.getSheets()[0];
  if (archTab.getLastRow() === 0 && archTab.getName() !== "일일마감") {
    try { archTab.setName("일일마감"); } catch (eN) {}
  }

  // ★ 2026-08-27: 택배사 열 도입 이행 처리.
  //   같은 날 파일이 이미 옛 헤더(택배사 없음)로 만들어져 있으면, 새 행은 한 열 더
  //   길다. 그대로 붙이면 택배사가 운송장번호 칸에, 운송장번호가 출처 칸에 들어가
  //   조용히 어긋난다. 열을 끼워 맞추거나, 못 맞추면 택배사를 떼고 옛 레이아웃으로
  //   쓴다. 어긋난 채로 기록하는 것보다 택배사 한 칸을 포기하는 편이 안전하다.
  var fit = _pep_fitArchiveCarrierColumn_(archTab, headers, rows);
  headers = fit.headers;
  rows = fit.rows;

  var nextRow = archTab.getLastRow() + 1;
  if (nextRow < 2) nextRow = 1;
  var colCount = headers.length;

  if (nextRow <= 1) {
    archTab.getRange(1, 1, 1, colCount).setValues([headers]);
    archTab.getRange(1, 1, 1, colCount)
      .setBackground("#1a237e").setFontColor("white")
      .setFontWeight("bold").setFontSize(10)
      .setHorizontalAlignment("center");
    archTab.setFrozenRows(1);
    nextRow = 2;
  }

  var archPhoneIdxs = _pep_detectPhoneColumns_(headers);
  if (archPhoneIdxs.indexOf(13) === -1 && colCount > 13) archPhoneIdxs.push(13);
  for (var ari = 0; ari < rows.length; ari++) {
    for (var api = 0; api < archPhoneIdxs.length; api++) {
      var pCol = archPhoneIdxs[api];
      if (pCol >= rows[ari].length) continue;
      rows[ari][pCol] = _pep_fixPhoneLeadingZero_(rows[ari][pCol]);
    }
  }
  for (var apfi = 0; apfi < archPhoneIdxs.length; apfi++) {
    archTab.getRange(nextRow, archPhoneIdxs[apfi] + 1, rows.length, 1).setNumberFormat("@");
  }
  archTab.getRange(nextRow, colCount - 1, rows.length, 1)
    .setNumberFormat("@")
    .setWrap(true);

  archTab.getRange(nextRow, 1, rows.length, colCount).setValues(rows);

  for (var ri = 0; ri < rows.length; ri++) {
    var source = String(rows[ri][colCount - 1] || "").trim();
    var bgColor = "#e8f5e9";
    if (source === "롯데") bgColor = "#e3f2fd";
    else if (source === "1주출고") bgColor = "#bbdefb";
    else if (source === "합포장") bgColor = "#c8e6c9";
    else if (source === "대리판매") bgColor = "#fff9c4";
    else if (source === "로젠") bgColor = "#e8eaf6";
    else if (source === "로젠(전화)") bgColor = "#e1f5fe";
    else if (source === "이름+전화") bgColor = "#e0f7fa";
    else if (source === "미매칭") bgColor = "#fff3e0";
    else if (source === "기타") bgColor = "#f3e5f5";
    archTab.getRange(nextRow + ri, 1, 1, colCount).setBackground(bgColor);
  }

  out.written = rows.length;

  try {
    var sumRow = [];
    for (var sci = 0; sci < colCount; sci++) sumRow.push("");
    var gSum = 0, jSum = 0;
    for (var gi = 0; gi < rows.length; gi++) {
      gSum += Number(rows[gi][6]) || 0;
      jSum += Number(rows[gi][9]) || 0;
    }
    sumRow[6] = gSum;
    sumRow[9] = jSum;
    var srcIdx = colCount - 1;
    sumRow[srcIdx] = "롯데:" + (detail.lotte || 0) +
      " 대리판매:" + (detail.hub || 0) +
      " 대리공급:" + (detail.supply || 0) +
      " 이름+전화:" + (detail.namePhone || 0) +
      " 미매칭:" + (detail.noInvoice || 0) + "건";
    sumRow[0] = "★ 합계 (" + rows.length + "건)";
    var sumRowNum = nextRow + rows.length;
    archTab.getRange(sumRowNum, 1, 1, colCount).setValues([sumRow]);
    archTab.getRange(sumRowNum, 1, 1, colCount)
      .setBackground("#37474f").setFontColor("white")
      .setFontWeight("bold").setFontSize(11);
    archTab.getRange(sumRowNum, 7, 1, 1).setNumberFormat("#,##0");
    archTab.getRange(sumRowNum, 10, 1, 1).setNumberFormat("#,##0");
  } catch (eSum) {
    Logger.log("[UNIFIED_ARCHIVE] 합계 행 추가 오류(" + dateStr + "): " + eSum.message);
  }

  return out;
}

/**
 * 1주출고 탭 — 최근 7일 택배 출고 이력 → 일일마감 송장맵 보조
 * G=운송장번호, I=주문번호, L=수취인명 (당일 롯데탭에 없는 익일·지연 발송 보강)
 */
function _pep_loadWeeklyShipInvoiceMap_(invoiceMap, result) {
  var out = { read: 0, primary: 0, name: 0 };
  if (!invoiceMap) return out;
  try {
    var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
    var wsTab = _pt_getSheetByGid(invSS, _PT_WEEKLY_SHIP_GID);
    if (!wsTab || wsTab.getLastRow() < 2) {
      Logger.log("[UNIFIED] 1주출고 탭 없음/비어있음 (GID " + _PT_WEEKLY_SHIP_GID + ")");
      return out;
    }
    var lr = wsTab.getLastRow();
    var lc = Math.max(wsTab.getLastColumn(), 12);
    var all = wsTab.getRange(1, 1, lr, lc).getDisplayValues();
    var hdrIdx = _pep_findLotteHeaderRow_(all);
    var cols = {
      name: _PT_WEEKLY_SHIP_FIXED_COL.name,
      invoice: _PT_WEEKLY_SHIP_FIXED_COL.invoice,
      uid: _PT_WEEKLY_SHIP_FIXED_COL.uid,
      phone: _PT_WEEKLY_SHIP_FIXED_COL.phone,
      addr: -1,
      item: -1,
      date: -1
    };
    // 롯데 기본값(J=주문번호)으로 I열을 덮지 않는다. 헤더에 그 칸이 있을 때만 옮긴다.
    var resolved = _pep_resolveLotteCols_(all[hdrIdx]);
    var det = resolved.detected || {};
    if (det.invoice) cols.invoice = resolved.invoice;
    if (det.uid) cols.uid = resolved.uid;
    if (det.name) cols.name = resolved.name;
    if (det.phone) cols.phone = resolved.phone;
    if (det.addr) cols.addr = resolved.addr;
    if (det.item) cols.item = resolved.item;
    if (det.date) cols.date = resolved.date;
    var dataStart = hdrIdx + 1;
    if (_pep_countInvoiceCol_(all, dataStart, cols.invoice) === 0) {
      dataStart = 1;
    }
    var srcLabel = "1주출고";
    for (var i = dataStart; i < all.length; i++) {
      if (String(all[i][0] || "").indexOf("합계") !== -1) continue;
      var hdrCell = String(all[i][cols.invoice] || "").replace(/\s/g, "");
      if (/운송장번호|송장번호/.test(hdrCell)) continue;
      var ordNo = String(all[i][cols.uid] || "").trim();
      var invNo = _pep_normInvoiceNo_(all[i][cols.invoice]);
      if (!invNo) continue;
      out.read++;
      var wsPicked = (cols.date >= 0) ? _pep_ymdNum_(all[i][cols.date]) : 0;
      if (ordNo) {
        var useSrc = (invoiceMap[ordNo] && invoiceMap[ordNo].source === "롯데") ? "롯데" : srcLabel;
        if (useSrc === srcLabel) out.primary++;
        _pep_addInvoiceMap_(invoiceMap, ordNo, invNo, useSrc, "", wsPicked);
      }
      var wsName = _pep_normRecipName_(all[i][cols.name]);
      if (wsName) {
        _pep_addNamePhoneInvoiceKeys_(
          invoiceMap, all[i][cols.name],
          cols.phone >= 0 ? all[i][cols.phone] : "",
          invNo, srcLabel,
          {
            addr: cols.addr >= 0 ? all[i][cols.addr] : "",
            item: cols.item >= 0 ? all[i][cols.item] : "",
            picked: wsPicked,
            stat: _pep_keyStat_(srcLabel)
          }
        );
        out.name++;
      }
    }
    Logger.log("[UNIFIED] 1주출고 송장맵: 송장행=" + out.read +
      " 주문번호=" + out.primary +
      " 수취인=" + out.name +
      " 합계키=" + Object.keys(invoiceMap).length + "건");
  } catch (e) {
    Logger.log("[UNIFIED] 1주출고 송장맵 오류: " + e.message);
  }
  if (result && result.detail) {
    result.detail.weeklyRead = out.read;
    result.detail.weeklyPrimary = out.primary;
  }
  return out;
}

/**
 * 롯데 송장탭 실제 1~3행 헤더/샘플을 읽어, 코드가 가정한 F/G/J와 맞는지 확인
 */
function partnerInspectLotteInvoiceColumns() {
  var ss = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
  var tab = _pt_getSheetByGid(ss, _PT_SECONDARY_INVOICE_GID);
  if (!tab) return { error: "롯데 탭 없음 GID " + _PT_SECONDARY_INVOICE_GID };

  function colLetter_(idx) {
    var n = idx + 1, s = "";
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  function sample_(vals, idx) {
    if (idx < 0) return "";
    var a = vals[1] ? String(vals[1][idx] || "").substring(0, 40) : "";
    var b = vals[2] ? String(vals[2][idx] || "").substring(0, 40) : "";
    return a + (b ? " | " + b : "");
  }

  var lc = Math.max(tab.getLastColumn(), 1);
  var lr = tab.getLastRow();
  var scanRows = Math.min(Math.max(lr, 1), 3);
  var vals = tab.getRange(1, 1, scanRows, lc).getDisplayValues();
  var hdr = vals[0] || [];
  var resolved = _pep_resolveLotteCols_(hdr);
  var headerList = [];
  for (var c = 0; c < hdr.length; c++) {
    var h = String(hdr[c] || "").trim();
    if (!h) continue;
    headerList.push(colLetter_(c) + "(" + c + ")=" + h);
  }
  var result = {
    tabName: tab.getName(),
    gid: String(tab.getSheetId()),
    lastRow: lr,
    lastCol: lc,
    assumed: { name: "F", invoice: "G", uid: "J", item: "AC", phone: "없음" },
    row1_FGJ_AC: {
      F: hdr[5] || "",
      G: hdr[6] || "",
      J: hdr[9] || "",
      AC: hdr[28] || ""
    },
    row1_sample_FGJ: {
      F: sample_(vals, 5),
      G: sample_(vals, 6),
      J: sample_(vals, 9)
    },
    headerScan: {
      name: colLetter_(resolved.name) + " [" + (hdr[resolved.name] || "") + "] " + sample_(vals, resolved.name),
      invoice: colLetter_(resolved.invoice) + " [" + (hdr[resolved.invoice] || "") + "] " + sample_(vals, resolved.invoice),
      uid: colLetter_(resolved.uid) + " [" + (hdr[resolved.uid] || "") + "] " + sample_(vals, resolved.uid),
      phone: resolved.phone >= 0
        ? colLetter_(resolved.phone) + " [" + (hdr[resolved.phone] || "") + "]"
        : "없음"
    },
    headers: headerList
  };
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(
      "롯데 송장탭 열 확인",
      "탭: " + result.tabName + " (GID " + result.gid + ")\n" +
        "코드 가정: 이름=F / 송장=G / 고유ID=J\n\n" +
        "실제 1행 F=[" + result.row1_FGJ_AC.F + "]\n" +
        "실제 1행 G=[" + result.row1_FGJ_AC.G + "]\n" +
        "실제 1행 J=[" + result.row1_FGJ_AC.J + "]\n\n" +
        "헤더스캔 이름: " + result.headerScan.name + "\n" +
        "헤더스캔 송장: " + result.headerScan.invoice + "\n" +
        "헤더스캔 고유ID: " + result.headerScan.uid + "\n\n" +
        headerList.slice(0, 20).join("\n"),
      ui.ButtonSet.OK
    );
  } catch (eUi) {}
  Logger.log("[LOTTE_COLS] " + JSON.stringify(result));
  return result;
}

/** 열 인덱스 → A, B, … */
function _pep_colLetter_(idx) {
  var n = Number(idx) + 1, s = "";
  if (!(n > 0)) return "?";
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 롯데탭 상단 8행 중 헤더 행 찾기 (1행이 제목이면 2행 헤더를 씀) */
function _pep_findLotteHeaderRow_(rows) {
  var best = 0, bestScore = -1;
  var n = Math.min((rows && rows.length) || 0, 8);
  for (var r = 0; r < n; r++) {
    var score = 0;
    var row = rows[r] || [];
    for (var c = 0; c < row.length; c++) {
      var h = String(row[c] || "").replace(/\s/g, "");
      if (!h) continue;
      if (/^\d{8,}$/.test(h)) { score -= 2; continue; }
      if (/운송장번호|^송장번호$/.test(h) && !/반품|재출력|원송장/.test(h)) score += 6;
      if (/사방넷주문번호|고객주문번호|^주문번호$/.test(h)) score += 4;
      if (/수하인명|수취인명|받는사람/.test(h)) score += 3;
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/**
 * 롯데 송장탭 헤더에서 열 위치 확정
 * 기본값 F=수취인 G=운송장 J=주문번호. 헤더가 있으면 우선순위 높은 열을 먼저 채택(나중 열로 덮지 않음)
 */
function _pep_resolveLotteCols_(headerRow) {
  var col = { name: 5, invoice: 6, uid: 9, phone: -1, addr: -1, item: -1, date: 3 };
  if (typeof _PT_LOTTE_FIXED_COL !== "undefined") {
    if (_PT_LOTTE_FIXED_COL.name >= 0) col.name = _PT_LOTTE_FIXED_COL.name;
    if (_PT_LOTTE_FIXED_COL.invoice >= 0) col.invoice = _PT_LOTTE_FIXED_COL.invoice;
    if (_PT_LOTTE_FIXED_COL.uid >= 0) col.uid = _PT_LOTTE_FIXED_COL.uid;
    col.phone = _PT_LOTTE_FIXED_COL.phone;
    // 롯데탭 상품명은 AC열로 고정돼 있다. 헤더 탐지가 실패해도 이 값을 쓴다.
    if (_PT_LOTTE_FIXED_COL.item >= 0) col.item = _PT_LOTTE_FIXED_COL.item;
    if (_PT_LOTTE_FIXED_COL.date >= 0) col.date = _PT_LOTTE_FIXED_COL.date;
  }
  col.detected = {
    invoice: false, uid: false, name: false, phone: false,
    addr: false, item: false, date: false
  };
  if (!headerRow || !headerRow.length) return col;
  var invC = -1, uidC = -1, nameC = -1, phoneC = -1, addrC = -1, itemC = -1, dateC = -1;
  var invPri = 99, uidPri = 99, namePri = 99, addrPri = 99, itemPri = 99;
  for (var c = 0; c < headerRow.length; c++) {
    var h = String(headerRow[c] || "").replace(/\s/g, "");
    if (!h) continue;
    if (!/반품|재출력|원송장/.test(h)) {
      var ip = 99;
      if (h === "운송장번호") ip = 1;
      else if (h === "송장번호") ip = 2;
      else if (/운송장번호/.test(h)) ip = 3;
      else if (/송장번호/.test(h)) ip = 4;
      if (ip < invPri) { invPri = ip; invC = c; }
    }
    var up = 99;
    if (/사방넷주문번호/.test(h)) up = 1;
    else if (/고객주문번호/.test(h)) up = 2;
    else if (h === "주문번호") up = 3;
    else if (/고유아이디|고유ID/.test(h)) up = 4;
    else if (/주문번호/.test(h) && !/원주문|상품주문/.test(h)) up = 5;
    if (up < uidPri) { uidPri = up; uidC = c; }
    var np = 99;
    if (h === "수하인명" || h === "수취인명") np = 1;
    else if ((h === "받는사람" || h === "받는분") && !/주소|전화/.test(h)) np = 2;
    else if (/수취인|수하인/.test(h) && !/주소|전화|코드|송하인/.test(h)) np = 3;
    else if (h === "명") np = 4;
    if (np < namePri) { namePri = np; nameC = c; }
    if (phoneC < 0 && /전화|휴대폰|핸드폰|연락처/.test(h) && !/송하인|보내는|발송/.test(h)) phoneC = c;
    // ★ 2026-08-25: 주소 열 — 수하인 주소 우선, 송하인·우편번호·배송메시지 제외
    if (!/송하인|보내는|발송|우편|zip/i.test(h) && /주소/.test(h) && !/배송메/.test(h)) {
      var ap = 99;
      if (/수하인주소|수취인주소|받는분주소|받는사람주소/.test(h)) ap = 1;
      else if (/배송지주소|도착지주소/.test(h)) ap = 2;
      else if (h === "주소") ap = 3;
      else ap = 4;
      if (ap < addrPri) { addrPri = ap; addrC = c; }
    }
    // ★ 2026-08-26: 품목명 열 — 한 사람의 여러 주문을 행 단위로 구분하는 데 쓴다.
    //   코드·수량·옵션만 있는 열은 품목명이 아니므로 제외한다.
    if (!/코드|번호|수량|단가|금액|옵션/.test(h)) {
      var tp = 99;
      if (h === "품목명" || h === "상품명" || h === "제품명") tp = 1;
      else if (/품목명|상품명|제품명|물품명/.test(h)) tp = 2;
      else if (h === "품명" || h === "내품명") tp = 3;
      else if (/품명/.test(h)) tp = 4;
      if (tp < itemPri) { itemPri = tp; itemC = c; }
    }
    if (dateC < 0 && /집하일자|집하일/.test(h) && !/예정/.test(h)) dateC = c;
  }
  if (invC >= 0) col.invoice = invC;
  if (uidC >= 0) col.uid = uidC;
  if (nameC >= 0) col.name = nameC;
  if (phoneC >= 0) col.phone = phoneC;
  if (addrC >= 0) col.addr = addrC;
  if (itemC >= 0) col.item = itemC;
  if (dateC >= 0) col.date = dateC;
  col.detected = {
    invoice: invC >= 0, uid: uidC >= 0, name: nameC >= 0, phone: phoneC >= 0,
    addr: addrC >= 0, item: itemC >= 0, date: dateC >= 0
  };
  return col;
}

function _pep_countFilledCol_(rows, start, idx) {
  var n = 0;
  if (idx < 0 || !rows) return 0;
  for (var i = start; i < rows.length; i++) {
    if (String((rows[i] && rows[i][idx]) || "").trim()) n++;
  }
  return n;
}

function _pep_countInvoiceCol_(rows, start, idx) {
  var n = 0;
  if (idx < 0 || !rows) return 0;
  for (var i = start; i < rows.length; i++) {
    if (_pep_normInvoiceNo_((rows[i] && rows[i][idx]) || "")) n++;
  }
  return n;
}

/** 판매현황 사방넷 주문번호(고유ID). 전화주문·생성UID·한글 비주문 제외 */
function _pep_isSabangnetSnapKey_(key) {
  var k = String(key || "").trim();
  if (!k) return false;
  if (k.indexOf("TEL:") === 0 || k.indexOf("FB:") === 0) return false;
  k = k.replace(/#\d+$/, "");
  if (typeof _po_isGeneratedUid_ === "function" && _po_isGeneratedUid_(k)) return false;
  if (/[\uAC00-\uD7AF]/.test(k)) return false;
  return true;
}

function _pep_mergeInvCells_(a, b) {
  var set = {};
  var out = [];
  var parts = _pep_splitInvNos_(a).concat(_pep_splitInvNos_(b));
  for (var i = 0; i < parts.length; i++) {
    if (set[parts[i]]) continue;
    set[parts[i]] = true;
    out.push(parts[i]);
  }
  return out.join("\n");
}

function _pep_alreadyArchivedInv_(existPair, matchKey, invCell) {
  var invs = _pep_splitInvNos_(invCell);
  if (!invs.length) return false;
  var oid = String(matchKey || "").replace(/#\d+$/, "");
  for (var i = 0; i < invs.length; i++) {
    var inv = invs[i];
    if (existPair[matchKey + "|" + inv] || (oid && existPair[oid + "|" + inv])) continue;
    return false;
  }
  return true;
}

function _pep_markArchivedInv_(existPair, matchKey, invCell) {
  var invs = _pep_splitInvNos_(invCell);
  var oid = String(matchKey || "").replace(/#\d+$/, "");
  for (var i = 0; i < invs.length; i++) {
    existPair[matchKey + "|" + invs[i]] = true;
    if (oid) existPair[oid + "|" + invs[i]] = true;
  }
}

/** 일일마감 6분 한도 — 파일 쓰기 전에 끊기 위한 예산(ms) */
var _PEP_UDA_BUDGET_MS_ = 4.5 * 60 * 1000;

function _pep_udaElapsed_(started) {
  return new Date().getTime() - (started || 0);
}

/**
 * 협력업체 파일을 한 번만 열어 전용마감+발주마감을 같이 송장맵에 넣는다.
 * 예전에는 두 함수가 파일을 각각 전부 열어서 일일마감이 6분을 넘기고
 * 파일 생성 전에 죽었다.
 */
function _pep_addAllPartnerArchivesToInvoiceMap_(invoiceMap, throughDateStr, started) {
  var out = {
    exclusiveArchiveRead: 0,
    exclusiveArchiveFiles: 0,
    orderArchiveRead: 0,
    orderArchiveFiles: 0,
    timedOut: false,
    opened: 0,
    remain: 0,
    errors: []
  };
  if (!invoiceMap) return out;
  var files = [];
  try { files = _pt_listFiles() || []; }
  catch (eList) { out.errors.push("파일 목록: " + eList.message); return out; }

  for (var fi = 0; fi < files.length; fi++) {
    if (started && _pep_udaElapsed_(started) > _PEP_UDA_BUDGET_MS_) {
      out.timedOut = true;
      out.remain = files.length - fi;
      Logger.log("[UNIFIED] 협력업체 마감탭 스캔 시간예산 초과 → 남은 " +
        out.remain + "개 파일은 다음 실행에서 보강");
      break;
    }
    var vendor = String(files[fi].name || "").replace("[협력업체] ", "").trim();
    var ss;
    try { ss = SpreadsheetApp.openById(files[fi].id); }
    catch (eOpen) { out.errors.push(vendor + " 열기 실패: " + eOpen.message); continue; }
    out.opened++;

    if (typeof _pea_ingestExclusiveArchiveSs_ === "function") {
      var ex = _pea_ingestExclusiveArchiveSs_(ss, invoiceMap, throughDateStr, vendor);
      out.exclusiveArchiveRead += ex.read || 0;
      out.exclusiveArchiveFiles += ex.files || 0;
      if (ex.errors && ex.errors.length) out.errors = out.errors.concat(ex.errors);
    }
    if (typeof _pms_ingestOrderArchiveSs_ === "function") {
      var ord = _pms_ingestOrderArchiveSs_(ss, invoiceMap, throughDateStr, vendor);
      out.orderArchiveRead += ord.read || 0;
      out.orderArchiveFiles += ord.files || 0;
      if (ord.errors && ord.errors.length) out.errors = out.errors.concat(ord.errors);
    }
  }
  Logger.log("[UNIFIED] 협력업체 마감탭(1회 오픈): 전용=" +
    out.exclusiveArchiveRead + "건/" + out.exclusiveArchiveFiles +
    "파일 발주=" + out.orderArchiveRead + "건/" + out.orderArchiveFiles +
    "파일 오픈=" + out.opened + "/" + files.length +
    (out.timedOut ? " (시간예산초과 남은 " + out.remain + ")" : "") +
    (out.errors.length ? " 오류=" + out.errors.length : ""));
  return out;
}

/**
 * 통합 일일 마감 — 예전과 같은 두 단계만 한다.
 * 1단계: 판매현황을 그대로 가져와, 고유ID 있는 주문부터 송장 매칭 → 고유ID 없는 행 매칭
 * 2단계: 바로 이전 일일마감 파일의 미매칭만 오늘 송장맵으로 기입
 * @return {Object} { archived, tabName, detail, error }
 */
function _pep_archiveUnifiedDaily_(targetDateStr) {
  // ★ 2026-06-25: 대리공급/대리판매 별도 수집 제거 → 스냅샷+송장매칭 단일 포맷
  // ★ 2026-06-29: targetDateStr 파라미터 추가 — 전달 시 해당 날짜로 저장 (자동실행→전날 매출일)
  var result = {
    archived: 0, tabName: "", error: "",
    detail: { matched: 0, lozen: 0, lozenPhone: 0, lotte: 0, supply: 0, hub: 0, skipped: 0, noInvoice: 0, namePhone: 0, lotteRead: 0, lotteCols: "", hubRead: 0, backfill: 0, backfillDate: "", uidMatched: 0, noUidMatched: 0, weeklyRead: 0, weeklyPrimary: 0, combinedPack: 0, skippedEmptyDays: [], tempArchiveRead: 0, ledgerAppended: 0, ledgerRead: 0, exclusiveArchiveRead: 0, exclusiveArchiveFiles: 0 }
  };

  try {
    var udaStarted = new Date().getTime();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    // ★ 2026-06-29: archiveDate = 전달된 날짜 or 당일
    var archiveDate = targetDateStr || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    var matchedRows = [];   // ★ 스냅샷 매칭 결과 (판매현황 C~Q + 운송장번호 + 출처)
    var matchedByDate = {}; // ★ 주문일(스냅샷 A열)별 → 해당 날짜 일일마감 파일에 기록
    var matchedHeaders = []; // ★ 헤더
    // ★ 2026-06-24: 스냅샷 기반 매칭 — 판매현황 직접 읽기 대신 스냅샷에서 미매칭 행 처리
    // ── ⓪ 송장원장 갱신 (★ 2026-08-25) ──
    //   마감이 대리공급_임시기록을 비우기 전에, 마감탭·아카이브에 남은 송장을 원장에 누적한다.
    //   송장맵 구축보다 먼저 돌려 이번 회차부터 바로 반영되게 한다.
    try {
      if (typeof _pil_refresh_ === "function") {
        // 마감탭은 아래 협력업체 1회 스캔이 읽는다. 여기서 또 열면 6분을 넘긴다.
        var ledgerStat = _pil_refresh_({ skipArchives: true });
        result.detail.ledgerAppended = ledgerStat.appended || 0;
      }
    } catch (eLedger) {
      Logger.log("[UNIFIED] 송장원장 갱신 오류: " + eLedger.message);
    }

    // ── ① 송장맵 구축 (롯데 + 1주출고 + 허브 + 임시기록 + 송장원장. 로젠 입력탭은 사용하지 않음) ──
    var invoiceMap = {}; // { 매칭키(주문번호/사방넷ID/NAME:/NP:): { inv, source } }

    // (a) ★ 2026-08-07: 롯데 송장맵 (주) — J열(주문번호=사방넷/고유ID) → G열(운송장번호)
    // ★ 2026-08-20: 같은 주문번호·같은 수취인의 송장을 덮어쓰지 않고 누적
    // ★ 2026-08-20: 고유ID 없는 건은 수취인명(+전화가 있으면 전화)으로 매칭. 로젠탭은 쓰지 않음.
    try {
      var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
      var lotteSrcTab = _pt_getSheetByGid(invSS, _PT_SECONDARY_INVOICE_GID);
      if (lotteSrcTab && lotteSrcTab.getLastRow() >= 2) {
        var ltLr = lotteSrcTab.getLastRow();
        var ltLc = Math.max(lotteSrcTab.getLastColumn(), 29);
        // 주문번호가 긴 숫자면 getValues가 지수로 깨져 매칭이 전부 실패함 → 화면값 사용
        var ltAll = lotteSrcTab.getRange(1, 1, ltLr, ltLc).getDisplayValues();
        var hdrIdx = _pep_findLotteHeaderRow_(ltAll);
        var ltCols = _pep_resolveLotteCols_(ltAll[hdrIdx]);
        var dataStart = hdrIdx + 1;
        if (_pep_countInvoiceCol_(ltAll, dataStart, ltCols.invoice) === 0) {
          ltCols = { name: 5, invoice: 6, uid: 9, phone: -1, addr: -1, item: 28, date: 3 };
          dataStart = (hdrIdx === 0) ? 1 : hdrIdx + 1;
          if (_pep_countInvoiceCol_(ltAll, dataStart, 6) === 0 && _pep_countInvoiceCol_(ltAll, 1, 6) > 0) {
            dataStart = 1;
          }
        }
        var _uidIdx = ltCols.uid;
        var _invIdx = ltCols.invoice;
        var _nameIdx = ltCols.name;
        var _phoneIdx = ltCols.phone;
        var _ltPrimary = 0, _ltName = 0, _ltPhone = 0, _ltInvRows = 0;
        for (var lti = dataStart; lti < ltAll.length; lti++) {
          var ltOrdNo = String(ltAll[lti][_uidIdx] || "").trim();
          var ltInvNo = _pep_normInvoiceNo_(ltAll[lti][_invIdx]);
          if (!ltInvNo) continue;
          _ltInvRows++;
          var ltPicked = (ltCols.date >= 0) ? _pep_ymdNum_(ltAll[lti][ltCols.date]) : 0;
          if (ltOrdNo) {
            _pep_addInvoiceMap_(invoiceMap, ltOrdNo, ltInvNo, "롯데", "", ltPicked);
            _ltPrimary++;
          }
          var ltPhone = (_phoneIdx >= 0) ? ltAll[lti][_phoneIdx] : "";
          if (ltPhone) _ltPhone++;
          _pep_addNamePhoneInvoiceKeys_(invoiceMap, ltAll[lti][_nameIdx], ltPhone, ltInvNo, "롯데",
            {
              addr: (ltCols.addr >= 0) ? ltAll[lti][ltCols.addr] : "",
              item: (ltCols.item >= 0) ? ltAll[lti][ltCols.item] : "",
              picked: ltPicked,
              stat: _pep_keyStat_("롯데")
            });
          if (_pep_normRecipName_(ltAll[lti][_nameIdx])) _ltName++;
        }
        result.detail.lotteRead = _ltInvRows;
        result.detail.lotteCols =
          "송장=" + _pep_colLetter_(_invIdx) +
          " 주문번호=" + _pep_colLetter_(_uidIdx) +
          " 이름=" + _pep_colLetter_(_nameIdx) +
          " 헤더행=" + (hdrIdx + 1);
        Logger.log("[UNIFIED] 롯데 송장맵: 송장행=" + _ltInvRows +
          " 주문번호=" + _ltPrimary +
          " 수취인명=" + _ltName +
          " " + result.detail.lotteCols +
          " 합계키=" + Object.keys(invoiceMap).length + "건");
      } else {
        Logger.log("[UNIFIED] 롯데 송장탭 없음/비어있음 (GID " + _PT_SECONDARY_INVOICE_GID + ")");
      }
    } catch (eLT) {
      Logger.log("[UNIFIED] 롯데 송장맵 오류: " + eLT.message);
    }

    // (a3) ★ 2026-08-24: 1주출고 — 최근 7일 택배 출고 이력 (지연·익일 발송 보강)
    try {
      _pep_loadWeeklyShipInvoiceMap_(invoiceMap, result);
    } catch (eWs) {
      Logger.log("[UNIFIED] 1주출고 송장맵 오류: " + eWs.message);
    }

    // (a2) 로젠 입력_로젠주문실적 — 일일마감 송장 소스로 사용하지 않음 (자사출고=롯데)

    // (b) 대리공급 송장맵: 대리공급_임시기록 P열(주문번호) → X열(송장번호)
    try {
      var tempSS = typeof _po_openTempSheetSs_ === "function"
        ? _po_openTempSheetSs_()
        : ss;
      var tempTab = _po_getNonPartnerTempTab_(tempSS);
      if (tempTab && tempTab.getLastRow() >= 2) {
        var tLr = tempTab.getLastRow();
        var tLc = Math.max(tempTab.getLastColumn(), _PO_TEMP_INV_COL_ + 1);
        var tData = tempTab.getRange(2, 1, tLr - 1, tLc).getDisplayValues();
        var tAdded = _po_addTempRowsToInvoiceMap_(invoiceMap, tData, "대리공급", 0);
        Logger.log("[UNIFIED] 대리공급 임시기록 송장맵: " + tAdded + "건, 합계키=" + Object.keys(invoiceMap).length);
      }
      // (b1) ★ 2026-08-24: 마감 시 삭제된 임시기록 보관탭 — 익일·지연 발송 송장 보강
      var archTab = typeof _po_getTempArchiveTab_ === "function" ? _po_getTempArchiveTab_(tempSS) : null;
      if (archTab && archTab.getLastRow() >= 2) {
        var aLr = archTab.getLastRow();
        var aLc = Math.max(archTab.getLastColumn(), _PO_TEMP_INV_COL_ + _PO_TEMP_ARCHIVE_COL_OFFSET_ + 1);
        var aData = archTab.getRange(2, 1, aLr - 1, aLc).getDisplayValues();
        var aAdded = _po_addTempRowsToInvoiceMap_(invoiceMap, aData, "대리공급(보관)", _PO_TEMP_ARCHIVE_COL_OFFSET_);
        result.detail.tempArchiveRead = aAdded;
        Logger.log("[UNIFIED] 임시기록_보관 송장맵: " + aAdded + "건");
      }
    } catch (eTM) {
      Logger.log("[UNIFIED] 대리공급 송장맵 오류: " + eTM.message);
    }

    // 전 업체 전용/발주 마감탭 스캔은 본체에서 하지 않는다.
    // 열면 6분을 넘기고 1단계 파일이 안 만들어진다. 송장은 롯데·임시기록·허브에서 붙이고,
    // 못 붙인 건 내일 2단계(바로 이전 일일마감)에서 채운다.

    // (b1d) 허브 월별 아카이브 — 허브에서 빠진 대리판매 송장
    try {
      if (typeof _ha_addHubArchiveToInvoiceMap_ === "function") {
        var haArch = _ha_addHubArchiveToInvoiceMap_(invoiceMap, archiveDate);
        result.detail.hubArchiveRead = haArch.read || 0;
      }
    } catch (eHa) {
      Logger.log("[UNIFIED] 허브아카이브 송장맵 오류: " + eHa.message);
    }

    // (b2) 협력업체_발주허브 — C열(고유ID) → N열(송장번호). 대리판매·협력 출고 (롯데와 무관)
    try {
      var hubTab = ss.getSheetByName(typeof _PO_HUB_SHEET_NAME !== "undefined" ? _PO_HUB_SHEET_NAME : "협력업체_발주허브");
      if (hubTab && hubTab.getLastRow() >= 2) {
        var hubLc = Math.max(hubTab.getLastColumn(), 15);
        var hubData = hubTab.getRange(2, 1, hubTab.getLastRow() - 1, hubLc).getDisplayValues();
        var _hubPrimary = 0, _hubInvRows = 0;
        for (var hbi = 0; hbi < hubData.length; hbi++) {
          var hUid = String(hubData[hbi][2] || "").trim();
          var hInv = String(hubData[hbi][13] || "").trim();
          if (typeof _po_hasRealInvoice_ === "function" && !_po_hasRealInvoice_(hInv)) continue;
          if (!hInv) continue;
          _hubInvRows++;
          // ★ 2026-08-27: 발주업체(B열)의 택배사를 송장과 함께 싣는다.
          //   출처는 "대리판매" 뿐이어서 택배사를 알려주지 않는다. 업체가 자기
          //   택배사로 보내므로 `업체_택배사` 표가 유일한 근거다. 여기서 실어두면
          //   일일마감 택배사 열이 그대로 쓰고, 웹앱이 해당 택배사 조회로 연결한다.
          var hCarrier = _pep_carrierForVendor_(hubData[hbi][1]);
          if (hUid && !(invoiceMap[hUid] && invoiceMap[hUid].source === "롯데")) {
            _pep_addInvoiceMap_(invoiceMap, hUid, hInv, "대리판매", hCarrier);
            _hubPrimary++;
          }
          // ph UID(대리공급 Push)와 ds UID(허브) 불일치 시 교차 조회
          if (typeof _pt_deriveHubRowPepUid_ === "function") {
            try {
              var hPepUid = _pt_deriveHubRowPepUid_(hubData[hbi]);
              if (hPepUid && hPepUid !== hUid &&
                  !(invoiceMap[hPepUid] && invoiceMap[hPepUid].source === "롯데")) {
                _pep_addInvoiceMap_(invoiceMap, hPepUid, hInv, "대리판매", hCarrier);
              }
            } catch (ePepUid) {}
          }
          _pep_addNamePhoneInvoiceKeys_(
            invoiceMap,
            hubData[hbi][7],
            hubData[hbi][8],
            hInv,
            "대리판매",
            {
              skipName: true,
              addr: hubData[hbi][9],
              item: hubData[hbi][5],
              carrier: hCarrier,
              stat: _pep_keyStat_("대리판매")
            }
          );
        }
        result.detail.hubRead = _hubInvRows;
        Logger.log("[UNIFIED] 허브 송장맵: 송장행=" + _hubInvRows +
          " 고유ID=" + _hubPrimary +
          " 합계키=" + Object.keys(invoiceMap).length + "건");
      } else {
        Logger.log("[UNIFIED] 협력업체_발주허브 없음/비어있음");
      }
    } catch (eHub) {
      Logger.log("[UNIFIED] 허브 송장맵 오류: " + eHub.message);
    }

    // (b3) ★ 2026-08-25: 송장원장 — 마감으로 임시기록에서 사라진 대리공급 송장 복구
    try {
      if (typeof _pil_addToInvoiceMap_ === "function") {
        var ledgerRead = _pil_addToInvoiceMap_(invoiceMap);
        result.detail.ledgerRead = ledgerRead;
        Logger.log("[UNIFIED] 송장원장 송장맵: " + ledgerRead + "건, 합계키=" + Object.keys(invoiceMap).length);
      }
    } catch (eLg) {
      Logger.log("[UNIFIED] 송장원장 송장맵 오류: " + eLg.message);
    }

    // (c) 합배송 탭 — 사방넷 UID/수취인 송장 보강 (롯데 J열이 비어 있는 합포장 행 보완)
    try {
      var hapSS = SpreadsheetApp.openById(_PT_COMBINED_INVOICE_SHEET_ID);
      var hapTab = typeof _pt_getSheetByGid === "function"
        ? _pt_getSheetByGid(hapSS, _PT_COMBINED_INVOICE_SHEET_GID)
        : null;
      if (!hapTab && hapSS) hapTab = hapSS.getSheetByName("합배송") || hapSS.getSheetByName("합배송 전용");
      if (hapTab && hapTab.getLastRow() >= 2) {
        var hapLc = Math.max(hapTab.getLastColumn(), 17);
        var hapData = hapTab.getRange(1, 1, hapTab.getLastRow(), hapLc).getValues();
        var hapHdr = hapData[0];
        var hUid = -1, hInv = -1, hName = -1, hPhone = -1, hAddr = -1, hItem = -1;
        for (var hc = 0; hc < hapHdr.length; hc++) {
          var hh = String(hapHdr[hc] || "").replace(/\s/g, "");
          if (!hh) continue;
          if (hUid < 0 && /사방넷주문번호|고유아이디|고유ID|주문번호/i.test(hh)) hUid = hc;
          if (hInv < 0 && /송장|운송장/.test(hh) && !/반품/.test(hh)) hInv = hc;
          if (hName < 0 && /수취인|수령인|받는사람|받는분|고객명|이름|성명/.test(hh) && !/주소|전화|코드/.test(hh)) hName = hc;
          if (hPhone < 0 && /전화|휴대폰|핸드폰|연락처/.test(hh) && !/주소/.test(hh)) hPhone = hc;
          if (hAddr < 0 && /주소/.test(hh) && !/배송메|우편|보내는|송하인/.test(hh)) hAddr = hc;
          if (hItem < 0 && /품목명|상품명|제품명|품명/.test(hh) && !/코드|수량|옵션/.test(hh)) hItem = hc;
        }
        var hapAdded = 0;
        for (var hi = 1; hi < hapData.length; hi++) {
          var hu = hUid >= 0 ? String(hapData[hi][hUid] || "").trim() : "";
          var hv = hInv >= 0 ? String(hapData[hi][hInv] || "").trim() : "";
          var hn = hName >= 0 ? hapData[hi][hName] : "";
          var hp = hPhone >= 0 ? hapData[hi][hPhone] : "";
          if (hu && hv) {
            var hapSrc = (invoiceMap[hu] && invoiceMap[hu].source) ? invoiceMap[hu].source : "합배송";
            _pep_addInvoiceMap_(invoiceMap, hu, hv, hapSrc);
            hapAdded++;
          }
          if (hv) {
            _pep_addNamePhoneInvoiceKeys_(invoiceMap, hn, hp, hv, "합배송",
              {
                addr: hAddr >= 0 ? hapData[hi][hAddr] : "",
                item: hItem >= 0 ? hapData[hi][hItem] : "",
                stat: _pep_keyStat_("합배송")
              });
          }
        }
        Logger.log("[UNIFIED] 합배송 송장맵 보강: " + hapAdded + "건");
      }
    } catch (eHap) {
      Logger.log("[UNIFIED] 합배송 송장맵 오류: " + eHap.message);
    }

    // (d) 3-3_병합 — 이름+전화 폴백 (일일마감 전용. 송장수집은 사용하지 않음)
    //     롯데탭에 전화번호가 없어 고유ID 없는 주문은 여기서 맞춘다.
    try {
      var npTab = null;
      try {
        var npInvSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
        npTab = _pt_getSheetByGid(npInvSS, _PT_NAME_PHONE_FALLBACK_GID);
      } catch (eNpInv) {}
      if (!npTab) {
        try {
          var npCombSS = SpreadsheetApp.openById(_PT_COMBINED_INVOICE_SHEET_ID);
          npTab = _pt_getSheetByGid(npCombSS, _PT_NAME_PHONE_FALLBACK_GID);
        } catch (eNpComb) {}
      }
      if (npTab && npTab.getLastRow() >= 2) {
        var npLc = Math.max(npTab.getLastColumn(), 4);
        var npData = npTab.getRange(1, 1, npTab.getLastRow(), npLc).getValues();
        // ★ 2026-08-25: 주소 열이 있으면 동명이인 구분에 쓴다 (없으면 무시)
        // ★ 2026-08-26: 품목명 열이 있으면 한 사람의 여러 주문을 구분하는 데 쓴다
        var npAddrIdx = -1, npItemIdx = -1;
        for (var nhc = 0; nhc < npLc; nhc++) {
          var nhh = String(npData[0][nhc] || "").replace(/\s/g, "");
          if (!nhh) continue;
          if (npAddrIdx < 0 && /주소/.test(nhh) && !/배송메|우편|보내는|송하인/.test(nhh)) npAddrIdx = nhc;
          if (npItemIdx < 0 && /품목명|상품명|제품명|품명/.test(nhh) && !/코드|수량|옵션/.test(nhh)) npItemIdx = nhc;
        }
        var npAdded = 0;
        for (var npi = 1; npi < npData.length; npi++) {
          var npName = npData[npi][0];
          var npPhone = npData[npi][1];
          var npInv = String(npData[npi][3] || "").trim();
          if (!npInv) continue;
          _pep_addNamePhoneInvoiceKeys_(invoiceMap, npName, npPhone, npInv, "롯데",
            {
              addr: npAddrIdx >= 0 ? npData[npi][npAddrIdx] : "",
              item: npItemIdx >= 0 ? npData[npi][npItemIdx] : "",
              stat: _pep_keyStat_("3-3_병합")
            });
          npAdded++;
        }
        Logger.log("[UNIFIED] 3-3_병합 이름+전화 송장맵: " + npAdded + "건");
      } else {
        Logger.log("[UNIFIED] 3-3_병합 탭 없음/비어있음 (GID " + _PT_NAME_PHONE_FALLBACK_GID + ")");
      }
    } catch (eNp) {
      Logger.log("[UNIFIED] 3-3_병합 송장맵 오류: " + eNp.message);
    }

    // 2단계(이전 일일마감 미매칭)는 1단계 파일을 쓴 뒤에 한다.

    // ── 1단계: 판매현황 → 스냅샷 추가 + 송장 매칭 ──
    // ★ 2026-06-26: 항상 판매현황을 읽어 스냅샷에 새 행 추가 (기존 미발송분과 합침)
    var snapTab = ss.getSheetByName(_SNAPSHOT_TAB_NAME_);
    try {
      var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
      var snapResult = _pep_saveSnapshotToHub_(srcSS, archiveDate);
      Logger.log("[UNIFIED] 판매현황→스냅샷: saved=" + snapResult.saved +
        " skipped=" + snapResult.skipped +
        (snapResult.error ? " error=" + snapResult.error : ""));
      // 스냅샷 탭 갱신 (신규 생성되었을 수 있음)
      snapTab = ss.getSheetByName(_SNAPSHOT_TAB_NAME_);
    } catch (eSnap) {
      Logger.log("[UNIFIED] 판매현황 읽기 실패: " + eSnap.message +
        " → 기존 스냅샷(미발송분)으로 진행");
    }

    if (snapTab && snapTab.getLastRow() >= 2) {
      var snapLr = snapTab.getLastRow();
      var snapLc = snapTab.getLastColumn();
      var snapData = snapTab.getRange(2, 1, snapLr - 1, snapLc).getValues();
      // 스냅샷 구조: A(0)=날짜, B(1)=매칭키, C~Q(2~16)=판매현황15열, R(17)=상태

      var statusCol = snapLc; // 1-based 마지막 열 (상태열)
      var _matchCount_ = 0, _skipAlready_ = 0, _skipNoInv_ = 0, _multiInv_ = 0;
      var _lozenCount_ = 0, _lozenPhoneCount_ = 0, _lotteCount_ = 0, _supplyCount_ = 0, _hubCount_ = 0;
      var _namePhoneCount_ = 0;
      var _carrierFilled_ = 0; // 택배사 열이 채워진 건수 — 웹앱 택배조회 링크의 근거
      var _carrierVia_ = {};   // 무엇을 근거로 판정했나 (송장맵/출처/업체명/출고지…)

      // ★ 중복 방지: 날짜별 (주문번호+송장) — 송장만으로 합배송 추가주문을 건너뛰지 않음
      var existPairCache = {};
      function _getExistPair_(dateKey) {
        if (!existPairCache[dateKey]) existPairCache[dateKey] = _pep_loadArchiveExistPair_(dateKey);
        return existPairCache[dateKey];
      }
      function _pushMatchedRow_(dateKey, row) {
        matchedRows.push(row);
        if (!matchedByDate[dateKey]) matchedByDate[dateKey] = [];
        matchedByDate[dateKey].push(row);
      }

      // 헤더 구성: 스냅샷의 C~Q 헤더 + 택배사 + 운송장번호 + 출처
      //
      // ★ 2026-08-27: 택배사를 **운송장번호 바로 앞**에 넣는다. 끝에 붙이지 않는다.
      //   코드 전반이 "출처 = 마지막 열, 운송장번호 = 끝에서 두 번째" 를 위치로
      //   가정한다 (`_pep_mapArchiveMatchCols_`·`_puv_mapDailyCols_` 의
      //   hdr.length-2/-1 폴백, `_cs_isSnapshotDailyArchiveHeader_` 의 마지막 두 열
      //   검사, 이 함수의 배경색·합계행 인덱스). 앞에 끼워 넣으면 그 가정이 전부
      //   그대로 성립한다. 맨 끝에 붙이면 다섯 곳이 조용히 한 칸씩 틀어진다.
      matchedHeaders = [];
      var snapHdr = snapTab.getRange(1, 1, 1, snapLc).getValues()[0];
      for (var shi = 2; shi < snapLc - 1; shi++) { // 2~(lastCol-2) = 판매현황 C~Q 헤더
        matchedHeaders.push(String(snapHdr[shi] || "").trim() || ("열" + (shi - 1)));
      }
      matchedHeaders.push("택배사");
      matchedHeaders.push("운송장번호");
      matchedHeaders.push("출처");

      var SNAP_O = 14; // 스냅샷 수하인(판매현황 O)
      var SNAP_P = 15; // 스냅샷 전화(판매현황 P)
      var SNAP_ITEM = -1;
      var SNAP_ADDR = -1; // ★ 2026-08-25: 주소 — 고유ID 없는 건의 동명이인 구분용
      var SNAP_CODE = -1; // ★ 2026-08-27: 품목코드 — 출고지 조회용 (평택=롯데 / 대리발송=업체)
      var SNAP_QTY = -1;  // ★ 2026-08-28: 수량 — 송장 개수 상한 (아래 안전장치)
      for (var shi2 = 2; shi2 < snapLc - 1; shi2++) {
        var hh2 = String(snapHdr[shi2] || "").replace(/\s/g, "");
        if (!hh2) continue;
        if (SNAP_QTY < 0 && /^수량$/.test(hh2)) SNAP_QTY = shi2;
        if (SNAP_ITEM < 0 && /품목명|상품명|제품명|품명/.test(hh2)) SNAP_ITEM = shi2;
        if (SNAP_ADDR < 0 && /주소/.test(hh2) && !/배송메|우편/.test(hh2)) SNAP_ADDR = shi2;
        // 판매처 상품코드·옵션코드가 아니라 이카운트 품목코드여야 한다.
        // 상품정보 탭이 그 코드로만 출고지를 답한다.
        if (SNAP_CODE < 0 && /^(품목코드|이카운트코드|물품코드)$/.test(hh2)) SNAP_CODE = shi2;
      }
      if (SNAP_CODE < 0) {
        for (var shi3 = 2; shi3 < snapLc - 1; shi3++) {
          var hh3 = String(snapHdr[shi3] || "").replace(/\s/g, "");
          if (/품목코드|이카운트코드/.test(hh3)) { SNAP_CODE = shi3; break; }
        }
      }
      if (SNAP_ITEM < 0) SNAP_ITEM = 4;
      Logger.log("[UNIFIED] 스냅샷 열: 품목=" + SNAP_ITEM + " 주소=" + SNAP_ADDR +
        " 품목코드=" + SNAP_CODE + " 수량=" + SNAP_QTY);
      var workItems = [];

      for (var si = 0; si < snapData.length; si++) {
        var snapStatus = String(snapData[si][snapLc - 1] || "").trim();
        if (snapStatus === _SNAPSHOT_STATUS_MATCHED_) {
          _skipAlready_++;
          continue;
        }

        var matchKey = String(snapData[si][1] || "").trim(); // B열: 매칭키
        if (!matchKey) continue;
        var snapDate = _pep_normSnapDate_(snapData[si][0], archiveDate);

        var _NON_ORDER_KEYWORDS_ = ["반품", "반품비", "제주도서산간", "제주도서", "도서산간", "추가배송비"];
        var _isNonOrder_ = false;
        for (var nk = 0; nk < _NON_ORDER_KEYWORDS_.length; nk++) {
          if (matchKey.indexOf(_NON_ORDER_KEYWORDS_[nk]) !== -1) { _isNonOrder_ = true; break; }
        }
        if (!_isNonOrder_) {
          var dVal = String(snapData[si][3] || "").trim();
          if (dVal.indexOf("[샘플]") !== -1) _isNonOrder_ = true;
        }
        if (_isNonOrder_) {
          workItems.push({ si: si, matchKey: matchKey, snapDate: snapDate, kind: "other", inv: "", source: "기타" });
          continue;
        }

        var recipName = _pep_normRecipName_(snapData[si][SNAP_O]);
        if (!recipName && matchKey.indexOf("TEL:") !== 0 && matchKey.indexOf("FB:") !== 0 &&
            /[\uAC00-\uD7AF]/.test(matchKey)) {
          recipName = _pep_normRecipName_(matchKey);
        }
        var snapPhone = snapData[si][SNAP_P];
        if ((!snapPhone || !String(snapPhone).replace(/[^0-9]/g, "")) && matchKey.indexOf("TEL:") === 0) {
          snapPhone = matchKey.replace(/^TEL:/, "").replace(/#\d+$/, "");
        }
        var phoneTail = _pep_phoneTail_(snapPhone);
        var snapAddr = SNAP_ADDR >= 0 ? snapData[si][SNAP_ADDR] : "";
        var snapItem = SNAP_ITEM >= 0 ? snapData[si][SNAP_ITEM] : "";

        workItems.push({
          si: si,
          matchKey: matchKey,
          snapDate: snapDate,
          itemName: String(snapData[si][SNAP_ITEM] || "").trim(),
          kind: _pep_isSabangnetSnapKey_(matchKey) ? "sabang" : "other-order",
          recipName: recipName,
          phoneTail: phoneTail,
          snapPhone: snapPhone,
          snapAddr: snapAddr,
          snapItem: snapItem,
          uidCell: matchKey || (SNAP_O >= 0 ? snapData[si][SNAP_O] : ""),
          usedNamePhone: false,
          inv: "",
          source: "",
          carrier: "",
          lag: 0
        });
      }

      function _pep_applyInvToWorkItem_(it, invInfo, viaBox) {
        if (!invInfo || !invInfo.inv) return false;
        it.usedNamePhone = !!(viaBox && viaBox.via && viaBox.via !== "UID" && viaBox.via !== "UID미매칭");
        it.inv = invInfo.inv;
        it.source = invInfo.source || "";
        it.carrier = invInfo.carrier || "";
        it.lag = invInfo.lag || 0;
        return true;
      }

      var _uidTried_ = 0, _uidHit_ = 0, _noUidTried_ = 0, _noUidHit_ = 0;
      // 1단계 가: 고유아이디 있는 주문부터 송장 매칭
      for (var wi1 = 0; wi1 < workItems.length; wi1++) {
        var it1 = workItems[wi1];
        if (it1.kind === "other") continue;
        if (!_pep_isRealUid_(it1.uidCell || it1.matchKey)) continue;
        _uidTried_++;
        var via1 = {};
        var hit1 = _pep_resolveRowInvoice_(invoiceMap, {
          uid: it1.uidCell || it1.matchKey,
          name: it1.recipName,
          phone: it1.snapPhone,
          addr: it1.snapAddr,
          item: it1.snapItem,
          orderDate: it1.snapDate
        }, via1);
        if (_pep_applyInvToWorkItem_(it1, hit1, via1)) _uidHit_++;
      }
      // 1단계 나: 고유아이디 없는 행 송장 매칭
      for (var wi2 = 0; wi2 < workItems.length; wi2++) {
        var it2 = workItems[wi2];
        if (it2.kind === "other") continue;
        if (_pep_isRealUid_(it2.uidCell || it2.matchKey)) continue;
        _noUidTried_++;
        var via2 = {};
        var hit2 = _pep_resolveRowInvoice_(invoiceMap, {
          uid: it2.uidCell || it2.matchKey,
          name: it2.recipName,
          phone: it2.snapPhone,
          addr: it2.snapAddr,
          item: it2.snapItem,
          orderDate: it2.snapDate
        }, via2);
        if (_pep_applyInvToWorkItem_(it2, hit2, via2)) _noUidHit_++;
      }
      result.detail.uidMatched = _uidHit_;
      result.detail.noUidMatched = _noUidHit_;
      Logger.log("[UNIFIED] 1단계 매칭: 고유ID " + _uidHit_ + "/" + _uidTried_ +
        " 고유ID없음 " + _noUidHit_ + "/" + _noUidTried_);

      // ★ 같은 수취인(+전화)+주문일 그룹 — 합포장·소분은 동일 송장 전파
      var sabangGroups = {};
      for (var wi = 0; wi < workItems.length; wi++) {
        var it0 = workItems[wi];
        if (it0.kind === "other" || !it0.recipName) continue;
        var gk = (it0.snapDate || archiveDate) + "|" + it0.recipName + "|" + (it0.phoneTail || "");
        if (!sabangGroups[gk]) sabangGroups[gk] = [];
        sabangGroups[gk].push(it0);
      }
      var _sabangGroupFilled_ = 0;
      var _combinedPackCount_ = 0;
      var _ambigGroupSkipped_ = 0; // 그룹 안에 서로 다른 송장이 섞여 전파를 포기한 그룹 수
      var _qtyBlocked_ = 0;        // 송장 개수가 수량을 넘어 미매칭으로 돌린 행 수
      for (var sgk in sabangGroups) {
        if (!sabangGroups.hasOwnProperty(sgk)) continue;
        var grp = sabangGroups[sgk];
        var mergedInv = "";
        var mergedSrc = "";
        var isPackGrp = grp.length >= 2;
        for (var gsi = 0; gsi < grp.length; gsi++) {
          if (_pep_isCombinedPackItem_(grp[gsi].itemName)) { isPackGrp = true; }
        }

        // ★ 2026-08-28: `NAME:` · `NP:` 로 송장맵을 직접 뒤지던 두 블록을 없앴다.
        //   그 키는 사람만 가리켜 **그 사람의 다른 주문 송장까지** 끌어왔다.
        //   대리발송처럼 수취인·전화·주소가 업체 자기 것인 건에서는 한 사람 밑에
        //   수십 건이 쌓여 있어, 수량 1개 행에 송장 수십 개가 붙었다.
        //   그룹 병합은 이제 **구성원이 각자 찾아온 송장**만 합친다.
        var mergedCarrier = "";
        for (var gi = 0; gi < grp.length; gi++) {
          mergedInv = _pep_mergeInvCells_(mergedInv, grp[gi].inv);
          if (!mergedSrc && grp[gi].source) mergedSrc = grp[gi].source;
          // 같은 송장을 나눠 쓰는 그룹이므로 택배사도 하나다 — 아는 놈에게서 가져온다
          if (!mergedCarrier && grp[gi].carrier) mergedCarrier = grp[gi].carrier;
        }
        if (!mergedInv) continue;

        // ★ 이 그룹 병합이 존재하는 이유는 **합포장** 하나다 —
        //   여러 품목이 한 송장으로 나가는 경우. 그래서 전파는 송장이 하나일 때만 한다.
        //   서로 다른 송장이 섞였다면 합포장이 아니라 **키 충돌**이다. 그때 전파하면
        //   각 행이 남의 송장까지 받아 간다. 각자 찾아온 것을 그대로 두는 편이 맞다.
        if (_pep_splitInvNos_(mergedInv).length !== 1) {
          _ambigGroupSkipped_++;
          continue;
        }

        for (var gj = 0; gj < grp.length; gj++) {
          var before = grp[gj].inv;
          grp[gj].inv = mergedInv;
          if (isPackGrp) {
            grp[gj].source = "합포장";
          } else if (!grp[gj].source) {
            grp[gj].source = mergedSrc || "롯데";
          }
          if (!grp[gj].carrier && mergedCarrier) grp[gj].carrier = mergedCarrier;
          if (!before && mergedInv && grp[gj].kind !== "sabang") grp[gj].usedNamePhone = true;
          if (before !== mergedInv) _sabangGroupFilled_++;
          if (isPackGrp && mergedInv) _combinedPackCount_++;
        }
      }

      for (var wj = 0; wj < workItems.length; wj++) {
        var item = workItems[wj];
        var rowDate = item.snapDate || archiveDate;
        if (item.kind === "other") {
          var nonRow = [];
          for (var nci = 2; nci < snapLc - 1; nci++) { nonRow.push(snapData[item.si][nci]); }
          nonRow.push(""); // 택배사 — 주문 행이 아니므로 판정하지 않는다
          nonRow.push("");
          nonRow.push("기타");
          _pushMatchedRow_(rowDate, nonRow);
          _matchCount_++;
          snapTab.getRange(item.si + 2, statusCol).setValue(_SNAPSHOT_STATUS_MATCHED_);
          continue;
        }

        // ★ 2026-08-28: 마지막 관문 — 송장 개수가 이 주문이 만들 수 있는 최대
        //   장수를 넘으면 붙이지 않는다. 위 조회·전파를 다 통과해도 여기서 걸린다.
        //
        //   상한은 `_par_slotSpec_` 한 곳에만 정의돼 있다. **여기서 수량을 직접
        //   비교하면 안 된다** — 품목명에 「세트」가 있으면 뚜껑·몸통이 따로 나가
        //   1개 주문에 송장 2장이 정상이라, 수량으로 자르면 멀쩡한 세트가 통째로
        //   미매칭이 된다. 비세트도 박스가 쪼개지면 2N 까지 정상이다.
        if (item.inv && SNAP_QTY >= 0 && _pep_qtyOverMax_(snapData[item.si][SNAP_QTY], item.itemName, item.inv)) {
          var slot = typeof _par_slotSpec_ === "function"
            ? _par_slotSpec_(snapData[item.si][SNAP_QTY], item.itemName)
            : { qty: "", max: 0, set: false };
          var invN = _pep_splitInvNos_(item.inv).length;
          if (_qtyBlocked_ < 5) {
            Logger.log("[UNIFIED] 수량초과 송장 차단: 키=[" + item.matchKey + "] " +
              (slot.set ? "세트 " : "") + "수량=" + slot.qty + " 최대=" + slot.max +
              "장인데 송장=" + invN + "장 → 미매칭");
          }
          _qtyBlocked_++;
          item.inv = "";
          item.source = "";
        }

        if (!item.inv) {
          var existPairNI = _getExistPair_(rowDate);
          if (existPairNI[item.matchKey + "|__NOINV__"]) {
            snapTab.getRange(item.si + 2, statusCol).setValue(_SNAPSHOT_STATUS_UNMATCHED_);
            _skipAlready_++;
            continue;
          }
          existPairNI[item.matchKey + "|__NOINV__"] = true;
          var noInvRow = [];
          for (var nci2 = 2; nci2 < snapLc - 1; nci2++) { noInvRow.push(snapData[item.si][nci2]); }
          noInvRow.push(""); // 택배사 — 송장이 없으면 조회할 것도 없다
          noInvRow.push("");
          noInvRow.push("미매칭");
          _pushMatchedRow_(rowDate, noInvRow);
          _skipNoInv_++;
          _matchCount_++;
          snapTab.getRange(item.si + 2, statusCol).setValue(_SNAPSHOT_STATUS_UNMATCHED_);
          continue;
        }

        var existPair = _getExistPair_(rowDate);
        if (_pep_alreadyArchivedInv_(existPair, item.matchKey, item.inv)) {
          _skipAlready_++;
          snapTab.getRange(item.si + 2, statusCol).setValue(_SNAPSHOT_STATUS_MATCHED_);
          continue;
        }
        _pep_markArchivedInv_(existPair, item.matchKey, item.inv);

        var outRow = [];
        for (var ci = 2; ci < snapLc - 1; ci++) {
          outRow.push(snapData[item.si][ci]);
        }
        // 택배사 — 송장맵 → 출처 → 업체명 → 품목코드(출고지) 순. 여기서 확정해
        // 기록하므로 이후 통합조회·웹앱은 다시 계산하지 않고 이 값을 읽어 쓴다.
        var rowCode = SNAP_CODE >= 0 ? snapData[item.si][SNAP_CODE] : "";
        var _viaBox_ = {};
        var rowCarrier = _pep_carrierForArchiveRow_(item, item.source, "", rowCode, _viaBox_);
        if (rowCarrier) {
          _carrierFilled_++;
          _carrierVia_[_viaBox_.via] = (_carrierVia_[_viaBox_.via] || 0) + 1;
        }
        outRow.push(rowCarrier);
        outRow.push(item.inv);
        outRow.push(item.source);
        _pushMatchedRow_(rowDate, outRow);

        if (_pep_splitInvNos_(item.inv).length > 1) _multiInv_++;

        if (item.usedNamePhone || item.source === "이름+전화") _namePhoneCount_++;
        if (item.source === "롯데" || item.source === "1주출고") _lotteCount_++;
        else if (item.source === "합포장") { /* 합포장은 롯데 계열 */ _lotteCount_++; }
        else if (item.source === "대리판매") _hubCount_++;
        else if (item.source === "로젠") _lozenCount_++;
        else if (item.source === "로젠(전화)") _lozenPhoneCount_++;
        else if (item.source !== "이름+전화") _supplyCount_++;

        snapTab.getRange(item.si + 2, statusCol).setValue(_SNAPSHOT_STATUS_MATCHED_);
        _matchCount_++;

        if (_matchCount_ <= 3) {
          Logger.log("[UNIFIED] 스냅샷 매칭[" + _matchCount_ + "] 키=[" + item.matchKey +
            "] → 송장=[" + String(item.inv).replace(/\n/g, ",") + "] 출처=" + item.source);
        }
      }

      result.detail.matched = matchedRows.length;
      result.detail.lotte = _lotteCount_;
      result.detail.lozen = _lotteCount_;
      result.detail.lozenPhone = _lozenPhoneCount_;
      result.detail.lozenFallback = _lozenCount_;
      result.detail.hub = _hubCount_;
      result.detail.supply = _supplyCount_;
      result.detail.skipped = _skipAlready_;
      result.detail.noInvoice = _skipNoInv_;
      result.detail.multiInvoice = _multiInv_;
      result.detail.namePhone = _namePhoneCount_;
      result.detail.combinedPack = _combinedPackCount_ || 0;
      // 같은 수취인·전화 그룹인데 송장이 서로 달라 전파를 포기한 수.
      // 대리발송처럼 수취인이 업체 자기 자신이면 여기가 크게 잡힌다 — 정상이다.
      result.detail.ambiguousGroup = _ambigGroupSkipped_ || 0;
      result.detail.qtyBlocked = _qtyBlocked_ || 0;
      result.detail.carrierFilled = _carrierFilled_;
      var _viaKeys_ = Object.keys(_carrierVia_);
      var _viaTxt_ = _viaKeys_.map(function (k) { return k + ":" + _carrierVia_[k]; }).join(" ");
      result.detail.carrierVia = _viaTxt_;
      Logger.log("[UNIFIED] 택배사 열: " + _carrierFilled_ + "/" + _matchCount_ +
        "건 판정" + (_viaTxt_ ? " [근거 " + _viaTxt_ + "]" : "") + ". 빈칸은 업체 택배사 미등록이다 — " +
        "'💼 협력업체 관리 → 🚚 업체 택배사 표 생성/점검' 확인.");
      Logger.log("[UNIFIED] 스냅샷 매칭 결과: 매칭=" + _matchCount_ +
        " (롯데:" + _lotteCount_ + " 대리판매:" + _hubCount_ + " 대리공급:" + _supplyCount_ +
        " 로젠폴백:" + _lozenCount_ +
        " 로젠(전화):" + _lozenPhoneCount_ +
        " 이름+전화:" + _namePhoneCount_ +
        " 미매칭:" + _skipNoInv_ + ")" +
        " 이미완료=" + _skipAlready_ +
        " 사방넷복수송장=" + _multiInv_ +
        " 그룹보강=" + _sabangGroupFilled_ +
        " 합포장=" + (_combinedPackCount_ || 0) +
        " 그룹모호보류=" + (_ambigGroupSkipped_ || 0) +
        " 수량초과차단=" + (_qtyBlocked_ || 0) +
        " → 최종=" + matchedRows.length + "건");

      SpreadsheetApp.flush();
    } else {
      Logger.log("[UNIFIED] 판매현황_스냅샷 없음 (즉석 생성도 실패)");
      result.error = "스냅샷 데이터 없음 \u2014 대리공급 Push를 먼저 실행하거나, 판매현황 데이터가 있는지 확인해주세요.";
      return result;
    }

    // ★ 2026-06-25: 대리공급/대리판매 별도 수집 제거 — 스냅샷+송장매칭으로 통합
    // 판매현황 = 전체 주문이므로 별도 수집 불필요

    // ── 1단계 파일 기록: 판매현황 그대로 (미매칭 포함, 송장 없어도 파일 생성) ──
    var dateKeys = Object.keys(matchedByDate);
    if (matchedRows.length > 0) {
      if (dateKeys.length === 0) {
        matchedByDate[archiveDate] = matchedRows.slice();
        dateKeys = [archiveDate];
      }
      var tabNames = [];
      for (var dki = 0; dki < dateKeys.length; dki++) {
        var dKey = dateKeys[dki];
        var batchRows = matchedByDate[dKey];
        if (!batchRows || !batchRows.length) continue;
        var appendResult = _pep_appendArchiveRows_(ss, dKey, matchedHeaders, batchRows, result.detail);
        result.archived += appendResult.written;
        tabNames.push(appendResult.tabName);
      }
      result.tabName = tabNames.join(", ");
      SpreadsheetApp.flush();
    } else {
      result.archived = 0;
      Logger.log("[UNIFIED_ARCHIVE] 1단계 신규 행 없음 (이미 처리됐거나 판매현황 비어 있음)");
    }

    // ── 2단계: 바로 이전 일일마감의 미매칭만 오늘 송장맵으로 기입 ──
    try {
      var step2Before = archiveDate;
      if (dateKeys.length) {
        dateKeys.sort();
        step2Before = dateKeys[0];
      }
      var bfResult = _pep_backfillPreviousArchive_(invoiceMap, step2Before);
      result.detail.backfill = bfResult.patched || 0;
      result.detail.backfillDate = bfResult.date || "";
    } catch (eBf) {
      Logger.log("[UNIFIED] 2단계 이전마감 보강 오류: " + eBf.message);
    }

    // ★ 2026-07-04: DB 동기화 — daily_archive 테이블
    try {
      if (matchedRows.length > 0 && matchedHeaders.length > 0) {
        // 헤더 기반 열 인덱스 매핑 (동적 헤더 대응)
        var _hMap_ = {};
        for (var _hi_ = 0; _hi_ < matchedHeaders.length; _hi_++) {
          _hMap_[String(matchedHeaders[_hi_]).trim()] = _hi_;
        }

        var dbRows = matchedRows.map(function(row) {
          // 열 이름으로 접근 (인덱스 하드코딩 방지)
          var getVal = function(names) {
            for (var ni = 0; ni < names.length; ni++) {
              if (_hMap_[names[ni]] !== undefined) return String(row[_hMap_[names[ni]]] || "").trim();
            }
            return "";
          };
          return {
            source: getVal(["출처"]),
            recorded_at: nowStr,
            order_no: getVal(["주문번호", "사방넷주문번호"]),
            invoice_no: getVal(["운송장번호"]),
            recipient: getVal(["수취인명", "수취인", "거래처명"]),
            phone: getVal(["전화번호", "전화"]),
            mobile: getVal(["휴대폰", "핸드폰"]),
            address: getVal(["주소", "배송지", "배송지주소"]),
            ecount_code: getVal(["품목코드", "이카운트코드"]),
            item_name: getVal(["품목명", "상품명"]),
            qty: parseInt(getVal(["수량"])) || 0,
            delivery_msg: getVal(["배송메시지", "배송메세지"]),
            vendor_or_seller: getVal(["판매처", "업체명"]),
            shipping_fee: parseFloat(getVal(["배송비", "단품배송비"])) || 0,
            note: getVal(["비고", "적요"]),
            vendor_name: getVal(["출처"]),  // 출처를 vendor로도 사용
            order_type: getVal(["출처"]),
            unit_price: parseFloat(getVal(["판매단가", "단가"])) || 0,
            settle_amount: parseFloat(getVal(["정산금액", "금액"])) || 0
          };
        });

        _sb_syncDailyArchive_(dbRows);
        Logger.log("[UNIFIED_ARCHIVE] DB 동기화 완료: " + dbRows.length + "건");
      }
    } catch (eDb) {
      Logger.log("[UNIFIED_ARCHIVE] DB 동기화 오류: " + eDb.message);
    }

    Logger.log("[UNIFIED_ARCHIVE] 소요 " + Math.round(_pep_udaElapsed_(udaStarted) / 1000) + "초");
    Logger.log("[UNIFIED_ARCHIVE] " + result.tabName + " (구글드라이브 시트) → 매칭:" + result.detail.matched +
      " (롯데:" + (result.detail.lotte || result.detail.lozen || 0) +
      " 대리판매:" + (result.detail.hub || 0) +
      " 로젠폴백:" + (result.detail.lozenFallback || 0) +
      " 대리공급:" + result.detail.supply +
      " 이름+전화:" + (result.detail.namePhone || 0) + ")" +
      " 미매칭:" + result.detail.noInvoice +
      " 이전마감보강:" + (result.detail.backfill || 0) +
      " = 합계:" + result.archived + "건");

    // ★ 2026-06-24: 스냅샷 정리 (매칭완료 삭제 + 7일 초과 만료)
    try {
      var cleanResult = _pep_cleanupSnapshot_();
      result.snapCleaned = cleanResult.cleaned;
      result.snapExpired = cleanResult.expired;
      Logger.log("[UNIFIED_ARCHIVE] 스냅샷 정리: 매칭완료삭제=" + cleanResult.cleaned +
        " 7일초과=" + cleanResult.expired);
    } catch (eClean) {
      Logger.log("[UNIFIED_ARCHIVE] 스냅샷 정리 오류: " + eClean.message);
    }

    // ★ 2026-06-25: 사방넷_송장매칭 탭 초기화 (일괄 마감이동 제거에 따른 대체)
    try {
      var _srcSS_ = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
      var _unmatchedTab_ = _po_getSabangnetMatchTab_(_srcSS_);
      if (_unmatchedTab_ && _unmatchedTab_.getLastRow() >= 2) {
        _unmatchedTab_
          .getRange(2, 1, _unmatchedTab_.getLastRow() - 1, _unmatchedTab_.getLastColumn())
          .clearContent();
        Logger.log("[UNIFIED_ARCHIVE] 사방넷_송장매칭 탭 초기화 완료");
        result.unmatchedTabCleared = true;
      }
    } catch (eCleanUnmatched) {
      Logger.log("[UNIFIED_ARCHIVE] 사방넷_송장매칭 탭 초기화 오류: " + eCleanUnmatched.message);
    }

  } catch (e) {
    result.error = e.message;
    Logger.log("[UNIFIED_ARCHIVE] 오류: " + e.message);
  }

  return result;
}

// ═════════════════════════════════════════════
//  일일마감 구글드라이브 시트 관리 헬퍼
// ═════════════════════════════════════════════

var _UNIFIED_ARCHIVE_SS_PREFIX_ = "UNIFIED_DAILY_SS_ID_";
var _UNIFIED_ARCHIVE_FOLDER_PROP_ = "UNIFIED_DAILY_ARCHIVE_FOLDER_ID";

// 일일마감 파일을 모아 둘 하위폴더 이름 (상위 폴더 안에 만든다)
var _UNIFIED_DAILY_SUBFOLDER_ = "일일마감";

/**
 * 살아 있는 드라이브 파일인가.
 * isTrashed() 만으로는 부족하다 — 폴더 getFilesByName 이 휴지통 파일을
 * 주고, 휴지통인데 isTrashed()=false 인 경우가 있다. 부모 없는 파일은 휴지통.
 */
function _unified_isLiveArchiveFile_(file, folder) {
  if (!file) return false;
  try {
    if (file.isTrashed()) return false;
  } catch (eTr) {
    return false;
  }
  // folder 는 폴더 하나 또는 폴더 배열을 받는다.
  // 배열인 이유 — 저장 위치를 「일일마감」 하위폴더로 옮기면서도
  // 예전 상위폴더에 있는 기존 파일을 계속 찾아 써야 하기 때문이다.
  var list = (folder && typeof folder.length === "number") ? folder : (folder ? [folder] : []);
  var wanted = {}, wantCount = 0;
  for (var w = 0; w < list.length; w++) {
    try {
      if (list[w]) { wanted[list[w].getId()] = true; wantCount++; }
    } catch (eW) {}
  }

  var parentCount = 0;
  var inFolder = !wantCount;
  try {
    var parents = file.getParents();
    while (parents.hasNext()) {
      parentCount++;
      var p = parents.next();
      if (wantCount && wanted[p.getId()]) inFolder = true;
    }
  } catch (ePar) {
    return false;
  }
  if (parentCount === 0) return false;
  if (wantCount && !inFolder) return false;
  return true;
}

/** trashed=false 검색. getFilesByName 보다 휴지통을 정확히 뺀다. */
function _unified_searchLiveArchiveFile_(fileName, folder) {
  var safe = String(fileName || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  var q = 'title = "' + safe + '" and mimeType = "application/vnd.google-apps.spreadsheet" and trashed = false';
  try {
    var it = DriveApp.searchFiles(q);
    while (it.hasNext()) {
      var f = it.next();
      if (_unified_isLiveArchiveFile_(f, folder)) return f;
    }
  } catch (e) {
    Logger.log("[UNIFIED] searchFiles 실패: " + e.message);
  }
  return null;
}

/**
 * 기존 일일마감 시트 파일 찾기 (없으면 null)
 * ★ 2026-06-20: 휴지통에 있는 파일은 무시 (openById는 휴지통 파일도 열림)
 * ★ 2026-08-30: isTrashed() 단독 실패 대비 — 부모 없음/폴더 밖/trashed=false 검색
 * @param {string} fileName 파일명
 * @return {Spreadsheet|null}
 */
function _unified_findExistingArchiveSs_(fileName) {
  var props = PropertiesService.getScriptProperties();
  var propKey = _UNIFIED_ARCHIVE_SS_PREFIX_ + fileName;
  var folder = _unified_archiveFolderCandidates_();

  var cachedId = props.getProperty(propKey);
  if (cachedId) {
    try {
      var cachedFile = DriveApp.getFileById(cachedId);
      if (_unified_isLiveArchiveFile_(cachedFile, folder)) {
        return SpreadsheetApp.openById(cachedId);
      }
      Logger.log("[UNIFIED] 캐시된 파일이 휴지통/폴더밖 → 캐시 삭제: " + fileName);
      props.deleteProperty(propKey);
    } catch (e) {
      props.deleteProperty(propKey);
    }
  }

  var live = folder.length ? _unified_searchLiveArchiveFile_(fileName, folder) : null;
  if (live) {
    props.setProperty(propKey, live.getId());
    return SpreadsheetApp.openById(live.getId());
  }

  // 하위폴더 → 상위폴더 순으로 뒤진다.
  var skippedTrash = 0;
  for (var fi = 0; fi < folder.length; fi++) {
    var files = folder[fi].getFilesByName(fileName);
    while (files.hasNext()) {
      var file = files.next();
      if (!_unified_isLiveArchiveFile_(file, folder)) {
        skippedTrash++;
        continue;
      }
      props.setProperty(propKey, file.getId());
      return SpreadsheetApp.openById(file.getId());
    }
  }
  if (skippedTrash) {
    Logger.log("[UNIFIED] 휴지통/고아 파일 " + skippedTrash + "개 스킵: " + fileName);
  }
  return null;
}

/**
 * 일일마감 시트 파일 가져오기 (없으면 구글드라이브에 새로 생성)
 * ★ 2026-06-20: deprecated addFile/removeFile → moveTo() 전환
 * @param {Spreadsheet} ss 현재 시트 (폴더 폴백용)
 * @param {string} fileName 파일명
 * @return {Spreadsheet}
 */
function _unified_getOrCreateArchiveSs_(ss, fileName) {
  var existing = _unified_findExistingArchiveSs_(fileName);
  if (existing) return existing;

  // 새 시트 생성
  var newSs = SpreadsheetApp.create(fileName);
  // 새 파일은 「일일마감」 하위폴더에 만든다.
  var folder = _unified_dailyCloseFolder_(ss);

  // ★ moveTo()로 폴더 이동 (deprecated addFile/removeFile 대체)
  var newFile = DriveApp.getFileById(newSs.getId());
  try {
    newFile.moveTo(folder);
  } catch (eMoveNew) {
    // moveTo 미지원 환경 폴백 (오래된 런타임)
    Logger.log("[UNIFIED] moveTo 실패, addFile 폴백 시도: " + eMoveNew.message);
    try {
      folder.addFile(newFile);
      // ★ removeFile은 호출하지 않음 (파일 삭제 위험)
    } catch (eAdd) {
      Logger.log("[UNIFIED] 폴더 이동 실패 (루트에 생성됨): " + eAdd.message);
    }
  }

  // ID 캐싱
  var props = PropertiesService.getScriptProperties();
  props.setProperty(_UNIFIED_ARCHIVE_SS_PREFIX_ + fileName, newSs.getId());

  Logger.log("[UNIFIED] 새 시트 생성: " + fileName + " (ID=" + newSs.getId() + ", 폴더=" + folder.getName() + ")");
  return newSs;
}

/**
 * 일일마감 아카이브 저장 폴더 결정
 * 우선순위: 전용 속성 → HUB 아카이브 폴더 → 현재 시트 부모 폴더
 * @param {Spreadsheet=} ss 현재 시트 (폴백용)
 * @return {Folder}
 */
/** 상위 폴더 안에서 이름이 같은 하위폴더를 찾고, 없으면 만든다. */
function _unified_getOrCreateSubFolder_(parent, name) {
  if (!parent) return null;
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    var f = it.next();
    var trashed = false;
    try { trashed = f.isTrashed(); } catch (eT) { trashed = false; }
    if (!trashed) return f;
  }
  return parent.createFolder(name);
}

/** 일일마감 파일을 새로 만들 폴더 — 상위 폴더 안의 「일일마감」 */
function _unified_dailyCloseFolder_(ss) {
  var base = _unified_resolveArchiveFolder_(ss);
  var sub = null;
  try {
    sub = _unified_getOrCreateSubFolder_(base, _UNIFIED_DAILY_SUBFOLDER_);
  } catch (eS) {
    Logger.log("[UNIFIED] 일일마감 하위폴더 생성 실패, 상위 폴더에 저장: " + eS.message);
  }
  return sub || base;
}

/**
 * 일일마감 파일을 찾을 폴더 후보.
 *   [0] 새 저장 위치인 「일일마감」 하위폴더
 *   [1] 예전 저장 위치인 상위 폴더
 * 상위 폴더를 빼면 안 된다. 빼는 순간 기존 파일을 못 찾아
 * 같은 이름으로 새로 만들고 하루치가 둘로 갈라진다.
 */
function _unified_archiveFolderCandidates_(ss) {
  var out = [];
  var base = null;
  try { base = _unified_resolveArchiveFolder_(ss); } catch (eB) { return out; }
  try {
    var sub = _unified_getOrCreateSubFolder_(base, _UNIFIED_DAILY_SUBFOLDER_);
    if (sub) out.push(sub);
  } catch (eS) {}
  if (base) out.push(base);
  return out;
}

function _unified_resolveArchiveFolder_(ss) {
  var props = PropertiesService.getScriptProperties();

  // 1) 전용 폴더 ID
  var folderId = String(props.getProperty(_UNIFIED_ARCHIVE_FOLDER_PROP_) || "").trim();
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }

  // 2) HUB 아카이브 폴더 (hubOrderArchive.gs와 공유)
  if (typeof HUB_ARCHIVE_DEFAULT_FOLDER_ID !== "undefined" && HUB_ARCHIVE_DEFAULT_FOLDER_ID) {
    try { return DriveApp.getFolderById(HUB_ARCHIVE_DEFAULT_FOLDER_ID); } catch (e) {}
  }

  // 3) 현재 시트 부모 폴더 폴백
  if (ss) {
    var file = DriveApp.getFileById(ss.getId());
    var parents = file.getParents();
    if (parents && parents.hasNext()) return parents.next();
  }

  throw new Error("일일마감 아카이브 폴더를 찾을 수 없습니다. 스크립트 속성에 " + _UNIFIED_ARCHIVE_FOLDER_PROP_ + "를 설정하세요.");
}

/**
 * 기존 일일마감 파일을 「일일마감」 하위폴더로 모은다. (일회성 정리)
 *
 * 저장 위치를 하위폴더로 바꾼 뒤, 그 전에 만들어진 파일은 상위 폴더에 남는다.
 * 조회는 두 곳을 다 뒤지므로 안 옮겨도 동작한다. 상위 폴더를 정리하는 용도다.
 *
 * moveTo 는 복사가 아니라 이동이라 파일 ID 가 그대로다.
 * 따라서 스크립트 속성에 캐싱해 둔 ID 도 그대로 유효하다.
 *
 * 6분 한도로 한 번에 다 못 옮길 수 있다. 남으면 다시 실행하면 된다.
 */
function partnerMoveDailyCloseFilesToSubFolder() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();

  var base = null, sub = null;
  try {
    base = _unified_resolveArchiveFolder_(ss);
    sub = _unified_getOrCreateSubFolder_(base, _UNIFIED_DAILY_SUBFOLDER_);
  } catch (e) {
    ui.alert("일일마감 폴더 정리", "폴더를 찾지 못했습니다.\n" + e.message, ui.ButtonSet.OK);
    return;
  }
  if (!sub) {
    ui.alert("일일마감 폴더 정리", "하위폴더를 만들지 못했습니다.", ui.ButtonSet.OK);
    return;
  }
  var subId = sub.getId();

  // 훑을 곳 — 상위 폴더 + 레거시 배포 폴더
  var scan = [base];
  if (typeof ORDER_TARGET_FOLDER_ID_LEGACY !== "undefined" && ORDER_TARGET_FOLDER_ID_LEGACY) {
    try {
      var legacy = DriveApp.getFolderById(ORDER_TARGET_FOLDER_ID_LEGACY);
      if (legacy.getId() !== base.getId()) scan.push(legacy);
    } catch (eL) {}
  }

  var targets = [];
  for (var s = 0; s < scan.length; s++) {
    if (scan[s].getId() === subId) continue;
    var it = scan[s].getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (String(f.getName() || "").indexOf(_UNIFIED_ARCHIVE_PREFIX_) !== 0) continue;
      targets.push(f);
    }
  }

  if (!targets.length) {
    ui.alert(
      "일일마감 폴더 정리",
      "옮길 파일이 없습니다.\n이미 「" + _UNIFIED_DAILY_SUBFOLDER_ + "」 안에 있습니다.",
      ui.ButtonSet.OK
    );
    return;
  }

  var ans = ui.alert(
    "일일마감 폴더 정리",
    targets.length + "개를 「" + _UNIFIED_DAILY_SUBFOLDER_ + "」 폴더로 옮깁니다.\n\n" +
      "이동이라 사본이 생기지 않고 파일 ID 도 그대로입니다.\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var started = new Date().getTime();
  var moved = 0, failed = 0, errs = [];
  for (var i = 0; i < targets.length; i++) {
    if (new Date().getTime() - started > 4.5 * 60 * 1000) break;
    try {
      targets[i].moveTo(sub);
      moved++;
    } catch (eM) {
      failed++;
      if (errs.length < 3) errs.push(targets[i].getName() + ": " + eM.message);
    }
  }
  var left = targets.length - moved - failed;

  ui.alert(
    "일일마감 폴더 정리",
    "옮김: " + moved + "개\n" +
      (failed ? "실패: " + failed + "개\n" : "") +
      (left ? "남음: " + left + "개 — 시간 한도로 멈췄습니다. 다시 실행하세요.\n" : "") +
      (errs.length ? "\n" + errs.join("\n") : ""),
    ui.ButtonSet.OK
  );
  Logger.log("[UNIFIED] 일일마감 이동: " + moved + "개 (실패 " + failed + ", 남음 " + left + ")");
}
