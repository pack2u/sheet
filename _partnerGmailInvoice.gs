/**
 * ═══════════════════════════════════════════════════════════════
 *  냅킨코리아 Gmail 송장번호 자동수집
 *  파일: _partnerGmailInvoice.gs
 *
 *  냅킨코리아에서 pack2u@pack2u.co.kr 로 보내는 메일에서
 *  송장번호를 파싱하여 냅킨코리아 전용양식 A열(송장번호)에 자동 입력.
 *
 *  트리거: 매일 오후 3:45, 4:00, 4:15 (15분 간격 트리거 + 시간 윈도우 체크)
 *  수동:  메뉴 → 협력업체 관리 → 📦 대리발송 발주시스템
 *             → 📧 냅킨코리아 Gmail 송장 수집
 * ═══════════════════════════════════════════════════════════════
 */

// ── 설정 상수 ──────────────────────────────────────────────────
var _GMI_NK_PREFIX = "NK"; // 냅킨코리아 접두사
var _GMI_NK_LABEL = "냅킨코리아"; // _PEP_VENDOR_LABELS_ 키

// Gmail 검색 필터 — 카페24 발송 알림 (냅킨코리아)
// 발신자: no-reply@cafe24shop.com, 본문에 "냅킨코리아" 포함
var _GMI_NK_SEARCH_QUERY = "from:no-reply@cafe24shop.com 냅킨코리아";

// 처리 완료 라벨 (Gmail 내에서 중복 처리 방지)
var _GMI_PROCESSED_LABEL = "P2U_송장처리완료";

// 트리거 실행 시간 윈도우 (시:분)
var _GMI_TRIGGER_START_HOUR = 15; // 오후 3시
var _GMI_TRIGGER_START_MIN = 30; // 3시 30분부터
var _GMI_TRIGGER_END_HOUR = 16; // 오후 4시
var _GMI_TRIGGER_END_MIN = 30; // 4시 30분까지

// ═════════════════════════════════════════════════════════════════
//  1. 메인 함수 — Gmail에서 냅킨코리아 송장 수집 (자동/수동 공용)
// ═════════════════════════════════════════════════════════════════

/**
 * 냅킨코리아 Gmail 송장 자동수집 (트리거/수동 공용)
 * @param {boolean} [isManual=false] - true면 UI 알림 표시
 */
function partnerFetchInvoiceFromGmail_NK(isManual) {
  var ui = null;
  if (isManual) {
    try {
      ui = SpreadsheetApp.getUi();
    } catch (e) {}
  }

  // ── Lock 확보 (동시 실행 방지) ──
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    _gmi_log_("NK Gmail 송장수집: Lock 확보 실패 (다른 작업 실행 중)");
    if (ui) ui.alert("⚠️ 다른 작업이 실행 중입니다. 잠시 후 다시 시도하세요.");
    return;
  }

  try {
    var result = _gmi_processNKInvoiceMails_(isManual);

    // 결과 로그
    var logMsg =
      "📧 NK Gmail 송장수집 완료 — " +
      "메일: " + result.mailCount + "건, " +
      "파싱: " + result.parsedCount + "쌍, " +
      "매칭입력: " + result.matchedCount + "건, " +
      "미매칭: " + result.unmatchedCount + "건";

    if (result.errors.length > 0) {
      logMsg += "\n⚠️ 에러: " + result.errors.join("; ");
    }

    _gmi_log_(logMsg);

    if (ui) {
      var alertMsg =
        "📧 냅킨코리아 Gmail 송장 수집 완료\n\n" +
        "📬 처리 메일: " + result.mailCount + "건\n" +
        "🔍 파싱된 송장: " + result.parsedCount + "쌍\n" +
        "✅ 매칭 입력: " + result.matchedCount + "건\n" +
        "❌ 미매칭: " + result.unmatchedCount + "건";

      if (result.unmatchedDetails.length > 0) {
        alertMsg +=
          "\n\n미매칭 상세:\n" +
          result.unmatchedDetails.slice(0, 10).join("\n");
      }

      if (result.mailCount === 0) {
        alertMsg =
          "📧 냅킨코리아 Gmail 송장 수집\n\n" +
          "오늘자 미처리 메일이 없습니다.\n" +
          "(이미 처리된 메일은 '" + _GMI_PROCESSED_LABEL + "' 라벨이 붙어 제외됩니다)";
      }

      if (result.errors.length > 0) {
        alertMsg += "\n\n⚠️ 에러:\n" + result.errors.join("\n");
      }

      ui.alert(alertMsg);
    }
  } catch (e) {
    _gmi_log_("❌ NK Gmail 송장수집 실패: " + (e.message || e));
    if (ui) ui.alert("❌ 오류 발생:\n" + (e.message || e));
  } finally {
    lock.releaseLock();
  }
}

/**
 * 수동 실행용 래퍼 (메뉴에서 호출)
 */
function partnerFetchInvoiceFromGmail_NK_Manual() {
  partnerFetchInvoiceFromGmail_NK(true);
}

/**
 * 트리거 실행용 래퍼 (시간 윈도우 체크 포함)
 */
function _gmi_triggerFetchNKInvoice_() {
  var now = new Date();
  var h = now.getHours();
  var m = now.getMinutes();

  // 시간 윈도우 체크 (15:30 ~ 16:30)
  var totalMin = h * 60 + m;
  var startMin = _GMI_TRIGGER_START_HOUR * 60 + _GMI_TRIGGER_START_MIN;
  var endMin = _GMI_TRIGGER_END_HOUR * 60 + _GMI_TRIGGER_END_MIN;

  if (totalMin < startMin || totalMin > endMin) {
    // 시간 윈도우 밖이면 무시
    return;
  }

  partnerFetchInvoiceFromGmail_NK(false);
}

// ═════════════════════════════════════════════════════════════════
//  2. Gmail 처리 핵심 로직
// ═════════════════════════════════════════════════════════════════

function _gmi_processNKInvoiceMails_(isManual) {
  var result = {
    mailCount: 0,
    parsedCount: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    unmatchedDetails: [],
    errors: [],
  };

  // ── 1) Gmail에서 오늘자 냅킨코리아 메일 검색 ──
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy/MM/dd");
  var query = "(" + _GMI_NK_SEARCH_QUERY + ") after:" + today;
  // ★ 수동 실행 시에는 처리완료 라벨도 포함 (재처리 허용)
  if (!isManual) {
    query += " -label:" + _GMI_PROCESSED_LABEL;
  }

  var threads;
  try {
    threads = GmailApp.search(query, 0, 20);
  } catch (e) {
    result.errors.push("Gmail 검색 실패: " + e.message);
    return result;
  }

  if (!threads || threads.length === 0) return result;

  // ── 2) 메일 본문에서 송장번호+수취인 파싱 (카페24 형식) ──
  var allPairs = [];

  for (var ti = 0; ti < threads.length; ti++) {
    var messages = threads[ti].getMessages();
    for (var mi = 0; mi < messages.length; mi++) {
      var msg = messages[mi];
      result.mailCount++;

      // ★ 카페24 메일인지 확인 (발신자 기반)
      var fromAddr = String(msg.getFrom() || "").toLowerCase();
      var isCafe24Mail = fromAddr.indexOf("cafe24") !== -1;

      // 카페24 형식 전용 파서 (HTML에서 직접 추출)
      var cafe24Pairs = _gmi_parseCafe24ShipmentMail_(msg);
      if (cafe24Pairs.length > 0) {
        for (var cpi = 0; cpi < cafe24Pairs.length; cpi++) {
          allPairs.push(cafe24Pairs[cpi]);
        }
        // ★ 메일 읽음 처리
        try { msg.markRead(); } catch (e) {}
        continue; // 카페24 파서 성공 시 다른 파서 건너뜀
      }

      // ★ 카페24 메일인데 파서가 빈 결과 → 배송 메일이 아닌 것 (입금확인, 주문확인 등)
      // → 범용 파서 건너뜀 (전화/팩스를 송장으로 오인하는 쓰레기 방지)
      if (isCafe24Mail) {
        _gmi_log_("[GMI] 카페24 비배송 메일 스킵: " + msg.getSubject());
        try { msg.markRead(); } catch (e) {}
        continue;
      }

      // 비카페24 메일만 범용 파서 시도
      var bodyText = _gmi_extractTextFromMessage_(msg);
      if (!bodyText || bodyText.trim().length < 5) continue;

      var tableResult = _pep_parseInvoiceTableData_(bodyText);
      if (tableResult && tableResult.pairs.length > 0) {
        for (var tpi = 0; tpi < tableResult.pairs.length; tpi++) {
          allPairs.push(tableResult.pairs[tpi]);
        }
      } else {
        var textPairs = _pep_parseInvoiceNamePairs_(bodyText);
        for (var pi = 0; pi < textPairs.length; pi++) {
          allPairs.push({
            tracking: textPairs[pi].tracking,
            name: textPairs[pi].name,
            productHint: "",
          });
        }
      }

      // 첨부파일 CSV/TXT 처리
      var attachPairs = _gmi_parseAttachments_(msg);
      for (var ai = 0; ai < attachPairs.length; ai++) {
        allPairs.push(attachPairs[ai]);
      }
    }
  }

  result.parsedCount = allPairs.length;
  if (allPairs.length === 0) {
    // 파싱 결과 없어도 처리완료 라벨은 붙이지 않음 (다음 실행 시 재시도)
    _gmi_log_(
      "📧 NK Gmail: 메일 " + result.mailCount +
      "건 확인했으나 송장번호를 파싱하지 못함"
    );
    return result;
  }

  // ── 3) 냅킨코리아 전용양식 찾기 ──
  var exTabInfo;
  try {
    exTabInfo = _gmi_findNKExclusiveTab_();
  } catch (e) {
    result.errors.push("전용양식 탭 찾기 실패: " + e.message);
    return result;
  }
  if (!exTabInfo) {
    result.errors.push("냅킨코리아 전용양식 탭을 찾을 수 없습니다");
    return result;
  }

  var exTab = exTabInfo.tab;
  var lr = exTab.getLastRow();
  if (lr < 2) {
    result.errors.push("전용양식에 데이터가 없습니다");
    return result;
  }

  var lc = Math.max(exTab.getLastColumn(), 1);
  var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];

  // ── 4) 수취인 열 + 상품명 열 자동 탐색 ──
  var RECIPIENT_KEYWORDS = [
    "받는분", "받는사람", "수취인", "수령인", "고객명", "성명", "이름",
  ];
  var PRODUCT_KEYWORDS = [
    "상품명", "품목명", "품명", "제품명", "상품", "item", "product",
  ];

  var recipientCol = -1;
  var productCol = -1;
  for (var hi = 0; hi < headers.length; hi++) {
    var h = String(headers[hi] || "").replace(/\s/g, "").toLowerCase();
    if (recipientCol === -1) {
      for (var ki = 0; ki < RECIPIENT_KEYWORDS.length; ki++) {
        if (h.indexOf(RECIPIENT_KEYWORDS[ki]) !== -1) {
          recipientCol = hi;
          break;
        }
      }
    }
    if (productCol === -1) {
      for (var pki = 0; pki < PRODUCT_KEYWORDS.length; pki++) {
        if (h.indexOf(PRODUCT_KEYWORDS[pki]) !== -1) {
          productCol = hi;
          break;
        }
      }
    }
  }

  // NK 전용양식: C열(2)=받는사람, H열(7)=상품명
  if (recipientCol === -1) recipientCol = 2; // 기본값: C열
  if (productCol === -1) productCol = 7;     // 기본값: H열(상품명)

  // ── 5) 매칭 인덱스 맵 구축 (수취인 + 상품명 이중 키) ──
  var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
  var nameToRows = {};  // 수취인 기반
  var prodToRows = {};  // 상품명 기반

  for (var ri = 0; ri < data.length; ri++) {
    // 이미 송장번호가 있는 행은 제외
    var existingInvoice = String(data[ri][0] || "").trim();
    if (existingInvoice.length >= 10 && /^\d+$/.test(existingInvoice)) continue;

    var rName = String(data[ri][recipientCol] || "").trim();
    if (rName) {
      if (!nameToRows[rName]) nameToRows[rName] = [];
      nameToRows[rName].push(ri);
    }

    var pName = String(data[ri][productCol] || "").trim();
    if (pName) {
      if (!prodToRows[pName]) prodToRows[pName] = [];
      prodToRows[pName].push(ri);
    }
  }

  // ── 6) 매칭 (수취인 우선 → 상품명 보조) ──
  var matched = [];
  var unmatched = [];
  var usedRows = {}; // 이미 배정된 행 추적

  for (var pi2 = 0; pi2 < allPairs.length; pi2++) {
    var p = allPairs[pi2];
    var matchFound = false;
    var targetRow = -1;

    // 6-a) 수취인 기반 매칭 (name 필드가 있는 경우)
    if (p.name && p.name.length > 0) {
      // ① 완전 일치
      var rows = nameToRows[p.name];
      if (rows && rows.length > 0) {
        for (var r1 = 0; r1 < rows.length; r1++) {
          if (!usedRows[rows[r1]]) { targetRow = rows[r1]; break; }
        }
      }

      // ② 괄호 제거 후 부분 매치: "박진영(34A24)" ↔ "박진영"
      if (targetRow === -1) {
        var nameNoBracket = p.name.replace(/\s*[\(（][^\)）]*[\)）]\s*/g, "").trim();
        for (var nm in nameToRows) {
          var nmNoBracket = nm.replace(/\s*[\(（][^\)）]*[\)）]\s*/g, "").trim();
          if (nm.indexOf(p.name) !== -1 || p.name.indexOf(nm) !== -1 ||
              nmNoBracket === nameNoBracket ||
              nm.indexOf(nameNoBracket) !== -1 || nameNoBracket.indexOf(nmNoBracket) !== -1) {
            var nmRows = nameToRows[nm];
            for (var r2 = 0; r2 < nmRows.length; r2++) {
              if (!usedRows[nmRows[r2]]) { targetRow = nmRows[r2]; break; }
            }
            if (targetRow !== -1) break;
          }
        }
      }

      if (targetRow !== -1) {
        matched.push({ tracking: p.tracking, name: p.name, rows: [targetRow] });
        usedRows[targetRow] = true;
        matchFound = true;
      }
    }

    // 6-b) 상품명 기반 매칭 (수취인 매칭 실패 시)
    if (!matchFound && p.productHint && p.productHint.length > 0) {
      var prodHint = p.productHint.replace(/\s/g, "").toLowerCase();
      var prodRows = null;

      // 정확 매치
      for (var pk in prodToRows) {
        var pkNorm = pk.replace(/\s/g, "").toLowerCase();
        if (pkNorm.indexOf(prodHint) !== -1 || prodHint.indexOf(pkNorm) !== -1) {
          prodRows = prodToRows[pk];
          break;
        }
      }

      // 앞 10자 부분 매치
      if (!prodRows) {
        var hintShort = prodHint.substring(0, 10);
        for (var pk2 in prodToRows) {
          var pk2Norm = pk2.replace(/\s/g, "").toLowerCase();
          if (pk2Norm.substring(0, 10) === hintShort || pk2Norm.indexOf(hintShort) !== -1) {
            prodRows = prodToRows[pk2];
            break;
          }
        }
      }

      if (prodRows && prodRows.length > 0) {
        for (var pri = 0; pri < prodRows.length; pri++) {
          if (!usedRows[prodRows[pri]]) {
            var existVal2 = String(data[prodRows[pri]][0] || "").trim();
            if (existVal2.length < 10 || !/^\d+$/.test(existVal2)) {
              targetRow = prodRows[pri];
              break;
            }
          }
        }
        if (targetRow !== -1) {
          matched.push({
            tracking: p.tracking,
            name: p.productHint,
            rows: [targetRow],
          });
          usedRows[targetRow] = true;
          matchFound = true;
        }
      }
    }

    if (!matchFound) {
      unmatched.push(p);
      result.unmatchedDetails.push(
        (p.name || p.productHint || "?") + " / " + p.tracking
      );
    }
  }

  // ── 7) A열(송장번호) 입력 ──
  var writeCount = 0;
  for (var wi = 0; wi < matched.length; wi++) {
    var wm = matched[wi];
    for (var wri = 0; wri < wm.rows.length; wri++) {
      // 이미 송장번호가 있으면 스킵
      var existVal = String(data[wm.rows[wri]][0] || "").trim();
      if (existVal.length >= 10 && /^\d+$/.test(existVal)) continue;
      data[wm.rows[wri]][0] = String(wm.tracking);
      writeCount++;
    }
  }

  if (writeCount > 0) {
    exTab.getRange(2, 1, data.length, lc).setValues(data);
    SpreadsheetApp.flush();
  }

  result.matchedCount = writeCount;
  result.unmatchedCount = unmatched.length;

  // ── 8) 처리 완료 라벨 부착 (항상 — 재처리 방지) ──
  _gmi_labelThreadsAsProcessed_(threads);

  return result;
}

// ═════════════════════════════════════════════════════════════════
//  3. 유틸리티 함수
// ═════════════════════════════════════════════════════════════════

/**
 * 카페24 발송 알림 메일 전용 파서
 * HTML 본문에서 송장번호(링크 텍스트)와 상품명을 직접 추출
 *
 * 카페24 메일 구조:
 *   - "상품이 발송되었습니다" 제목
 *   - 배송사 + 송장번호 (링크 형태: <a>258773189124</a>)
 *   - 상품명: P0000EWR [노루지 간대봉투- 소 1박스 2000매 시]
 *   - 주문자: pack2u(주식회사팩투유) ← 수취인 아님!
 */
function _gmi_parseCafe24ShipmentMail_(msg) {
  var pairs = [];
  var html = msg.getBody();
  if (!html) return pairs;

  // "발송" 또는 "배송" 키워드 확인 (발송 알림 메일인지)
  if (html.indexOf("발송") === -1 && html.indexOf("배송") === -1) {
    return pairs;
  }

  // ── 송장번호 추출: <a> 태그 안의 10~14자리 숫자 ──
  var rawNumbers = [];
  var linkRegex = /<a[^>]*>\s*(\d{10,14})\s*<\/a>/gi;
  var linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    rawNumbers.push(linkMatch[1]);
  }

  // 링크에서 못 찾으면 "송장" 근처 텍스트에서 추출
  if (rawNumbers.length === 0) {
    var plainText = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ");
    var invoiceRegex = /(?:송장[^\d]{0,10}|운송장[^\d]{0,10})(\d{10,14})/g;
    var invoiceMatch;
    while ((invoiceMatch = invoiceRegex.exec(plainText)) !== null) {
      rawNumbers.push(invoiceMatch[1]);
    }
  }

  // ★ 전화/팩스 번호 필터링: 0으로 시작하는 번호는 한국 전화번호이므로 제외
  // 택배 송장번호는 보통 1~9로 시작 (CJ: 3/4/6, 롯데: 2, 한진: 4/5, 우체국: 6)
  var trackingNumbers = [];
  for (var fi = 0; fi < rawNumbers.length; fi++) {
    if (rawNumbers[fi].charAt(0) !== "0") {
      trackingNumbers.push(rawNumbers[fi]);
    }
  }

  if (trackingNumbers.length === 0) return pairs;

  // ── HTML → 텍스트 변환 (상품명/수취인 추출용) ──
  var plainForProduct = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, "\t")
    .replace(/<\/th>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");

  // ── 상품명 + P코드 추출 ──
  var productNames = [];
  var pCodes = [];

  // P코드 패턴 (P0000XXX) + 뒤따르는 상품명
  var prodCodeRegex = /(P\d{4,}\w*)\s*[\[\(]?([^\]\)\n\t]{2,50})/gi;
  var prodMatch;
  while ((prodMatch = prodCodeRegex.exec(plainForProduct)) !== null) {
    var fullProd = (prodMatch[1] + " " + prodMatch[2]).trim();
    productNames.push(fullProd);
    pCodes.push(prodMatch[1].toUpperCase()); // P코드만 별도 저장
  }

  // 상품코드 패턴이 없으면 "상품명" 헤더 다음 텍스트
  if (productNames.length === 0) {
    var lines = plainForProduct.split(/[\n\t]+/);
    var foundHeader = false;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (line.indexOf("상품명") !== -1) {
        foundHeader = true;
        continue;
      }
      if (foundHeader && line.length > 2 && !/^(수량|주문처리|배송사|총)/.test(line)) {
        productNames.push(line);
        foundHeader = false;
      }
    }
  }

  // ── 수취인 추출: HTML 원본에서 직접 정규식으로 추출 ──
  // 카페24 HTML 구조: <th>받으시는분</th><td>박진영(34A24)</td>
  //                 또는 <td>받으시는분</td><td>박진영(34A24)</td>
  var recipientName = "";

  // 방법1: HTML 원본에서 직접 추출 (가장 안정적)
  var recipHtmlPatterns = [
    /받으시는\s*분[^<]*<\/(?:th|td)>\s*<td[^>]*>\s*([^<]+)/i,
    /받는\s*분[^<]*<\/(?:th|td)>\s*<td[^>]*>\s*([^<]+)/i,
    /수취인[^<]*<\/(?:th|td)>\s*<td[^>]*>\s*([^<]+)/i,
    /수령인[^<]*<\/(?:th|td)>\s*<td[^>]*>\s*([^<]+)/i,
  ];
  for (var rpi = 0; rpi < recipHtmlPatterns.length; rpi++) {
    var rMatch = recipHtmlPatterns[rpi].exec(html);
    if (rMatch) {
      var extracted = rMatch[1].replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").trim();
      if (extracted.length >= 2) {
        recipientName = extracted;
        break;
      }
    }
  }

  // 방법2: 텍스트 토큰 방식 (HTML 정규식 실패 시 폴백)
  if (!recipientName) {
    var recipientKeywords = ["받으시는분", "받는분", "수취인", "수령인", "받으시는"];
    var recipLines = plainForProduct.split(/[\n\t]+/);
    for (var rli = 0; rli < recipLines.length; rli++) {
      var rLine = recipLines[rli].trim();
      for (var rki = 0; rki < recipientKeywords.length; rki++) {
        if (rLine.indexOf(recipientKeywords[rki]) !== -1) {
          if (rli + 1 < recipLines.length) {
            var nextVal = recipLines[rli + 1].trim();
            if (nextVal.length >= 2 && !/^(주소|일반전화|휴대전화|전화|031|02|0\d)/.test(nextVal)) {
              recipientName = nextVal;
              break;
            }
          }
          var afterKw = rLine.substring(rLine.indexOf(recipientKeywords[rki]) + recipientKeywords[rki].length).trim();
          if (afterKw.length >= 2) {
            recipientName = afterKw;
            break;
          }
        }
      }
      if (recipientName) break;
    }
  }
  // ★ 괄호 유지 — 주문자가 "박진영(34A24)" 형태로 입력하므로 그대로 매칭

  // ── 페어링: 송장번호 × (수취인 + 상품명 + P코드) ──
  for (var ti2 = 0; ti2 < trackingNumbers.length; ti2++) {
    pairs.push({
      tracking: trackingNumbers[ti2],
      name: recipientName,
      productHint: productNames[ti2] || productNames[0] || "",
      pCode: pCodes[ti2] || pCodes[0] || "",  // P코드 별도 전달
    });
  }

  Logger.log(
    "[GMI] 카페24 파싱: 송장 " + trackingNumbers.length +
    "개(필터 전 " + rawNumbers.length + "개), 상품 " + productNames.length +
    "개, P코드 " + pCodes.join(",") + ", 수취인: " + (recipientName || "(없음)")
  );

  return pairs;
}

/**
 * 메일 메시지에서 텍스트 추출 (HTML 태그 제거)
 */
function _gmi_extractTextFromMessage_(msg) {
  // 먼저 plain text 시도
  var plain = msg.getPlainBody();
  if (plain && plain.trim().length > 10) return plain;

  // HTML → 텍스트 변환
  var html = msg.getBody();
  if (!html) return "";

  // HTML 테이블을 탭 구분 텍스트로 변환 (테이블 파서 호환)
  var text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, "\t")
    .replace(/<\/th>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return text;
}

/**
 * 첨부파일(CSV/TXT/XLS)에서 송장 파싱
 */
function _gmi_parseAttachments_(msg) {
  var pairs = [];
  try {
    var attachments = msg.getAttachments();
    if (!attachments || attachments.length === 0) return pairs;

    for (var ai = 0; ai < attachments.length; ai++) {
      var att = attachments[ai];
      var name = att.getName().toLowerCase();
      var mime = att.getContentType();

      // CSV/TXT 파일만 처리
      if (
        name.indexOf(".csv") !== -1 ||
        name.indexOf(".txt") !== -1 ||
        mime.indexOf("text/") !== -1
      ) {
        var content = att.getDataAsString("UTF-8");
        if (!content || content.length < 5) {
          // EUC-KR 시도
          try {
            content = att.getDataAsString("EUC-KR");
          } catch (e) {}
        }
        if (!content) continue;

        // 테이블 파서로 시도
        var tableResult = _pep_parseInvoiceTableData_(content);
        if (tableResult && tableResult.pairs.length > 0) {
          for (var tpi = 0; tpi < tableResult.pairs.length; tpi++) {
            pairs.push(tableResult.pairs[tpi]);
          }
        } else {
          // 텍스트 파서
          var textPairs = _pep_parseInvoiceNamePairs_(content);
          for (var pi = 0; pi < textPairs.length; pi++) {
            pairs.push({
              tracking: textPairs[pi].tracking,
              name: textPairs[pi].name,
              productHint: "",
            });
          }
        }
      }
    }
  } catch (e) {
    Logger.log("[GMI] 첨부파일 파싱 에러: " + e.message);
  }
  return pairs;
}

/**
 * 냅킨코리아 전용양식 탭 찾기
 */
function _gmi_findNKExclusiveTab_() {
  var files = _pt_listFiles();
  var prefixToFile = _pep_buildPrefixToFileMap_(files);

  var nkFile = prefixToFile[_GMI_NK_PREFIX];
  if (!nkFile) {
    // 이름에 "냅킨" 포함된 파일 직접 검색
    for (var i = 0; i < files.length; i++) {
      if (files[i].name.indexOf("냅킨") !== -1) {
        nkFile = files[i];
        break;
      }
    }
  }

  if (!nkFile) return null;

  var ss = SpreadsheetApp.openById(nkFile.id);
  var allTabs = ss.getSheets();
  var exTab = null;

  for (var ti = 0; ti < allTabs.length; ti++) {
    var tn = allTabs[ti].getName();
    if (tn.indexOf("전용양식") !== -1) {
      exTab = allTabs[ti];
      break;
    }
  }

  if (!exTab) return null;
  return { tab: exTab, file: nkFile, ss: ss };
}

/**
 * 처리 완료 메일에 라벨 부착
 */
function _gmi_labelThreadsAsProcessed_(threads) {
  try {
    // 라벨 가져오기 (없으면 생성)
    var label = GmailApp.getUserLabelByName(_GMI_PROCESSED_LABEL);
    if (!label) {
      label = GmailApp.createLabel(_GMI_PROCESSED_LABEL);
    }

    for (var i = 0; i < threads.length; i++) {
      label.addToThread(threads[i]);
    }
  } catch (e) {
    Logger.log("[GMI] 라벨 부착 실패: " + e.message);
  }
}

/**
 * 실행 로그 기록 (업데이트실행로그 탭)
 */
function _gmi_log_(msg) {
  Logger.log("[GMI] " + msg);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;
    var logTab = ss.getSheetByName("업데이트실행로그");
    if (!logTab) return;
    var now = Utilities.formatDate(
      new Date(),
      "Asia/Seoul",
      "yyyy-MM-dd HH:mm:ss"
    );
    logTab.appendRow([now, "Gmail송장수집", msg]);
  } catch (e) {}
}

// ═════════════════════════════════════════════════════════════════
//  4. 트리거 관리
// ═════════════════════════════════════════════════════════════════

/**
 * 냅킨코리아 Gmail 송장수집 트리거 설치
 * 15분 간격으로 실행하되, 함수 내부에서 시간 윈도우(15:30~16:30)만 실행
 */
function partnerSetupGmailInvoiceTrigger_NK() {
  // 기존 트리거 제거
  partnerRemoveGmailInvoiceTrigger_NK();

  ScriptApp.newTrigger("_gmi_triggerFetchNKInvoice_")
    .timeBased()
    .everyMinutes(15)
    .create();

  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var msg =
    "✅ 냅킨코리아 Gmail 송장수집 트리거가 설치되었습니다.\n\n" +
    "• 실행 간격: 15분마다\n" +
    "• 활성 시간: 오후 3:30 ~ 4:30 (이 시간 외에는 자동 스킵)\n" +
    "• 예상 실행 시각: 약 3:45, 4:00, 4:15\n" +
    "• Gmail 검색 필터: " + _GMI_NK_SEARCH_QUERY;

  _gmi_log_("트리거 설치됨 — 15분 간격, 활성 윈도우 15:30~16:30");

  if (ui) ui.alert(msg);
}

/**
 * 냅킨코리아 Gmail 송장수집 트리거 제거
 */
function partnerRemoveGmailInvoiceTrigger_NK() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "_gmi_triggerFetchNKInvoice_") {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  if (removed > 0) {
    _gmi_log_("트리거 제거됨 (" + removed + "건)");
  }
}

/**
 * 냅킨코리아 Gmail 송장수집 트리거 상태 확인
 */
function partnerShowGmailInvoiceTriggerStatus_NK() {
  var triggers = ScriptApp.getProjectTriggers();
  var found = false;

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "_gmi_triggerFetchNKInvoice_") {
      found = true;
      break;
    }
  }

  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var msg = found
    ? "✅ 냅킨코리아 Gmail 송장수집 트리거 — 활성\n\n" +
      "• 실행 간격: 15분마다\n" +
      "• 활성 시간: 오후 3:30 ~ 4:30\n" +
      "• Gmail 검색: " + _GMI_NK_SEARCH_QUERY + "\n" +
      "• 처리완료 라벨: " + _GMI_PROCESSED_LABEL
    : "❌ 냅킨코리아 Gmail 송장수집 트리거 — 비활성\n\n" +
      "'트리거 설치' 메뉴를 실행하세요.";

  if (ui) ui.alert(msg);
}
