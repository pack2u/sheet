// ============================================================
//  [협력업체] 카카오 송장번호 매칭 사이드바 (v2 — 허브 동기화)
//  ▶ 자동 주입: createViewerNoticeScript_ → "스크립트 재설치"
//  ★ 허브 _partnerExclusivePush.gs와 동일한 파서/매칭 로직
//  ★ 수정 후 clasp push → 스크립트 재설치 실행
// ============================================================

function onOpen_copy_paste() {
  // 복사하여 사용할 때는 onOpen()으로 변경하세요.
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("🤖 고객센터 챗봇")
    .addItem("채팅창 열기", "showChatbotSidebar")
    .addToUi();
  SpreadsheetApp.getActiveSpreadsheet().addMenu("📬 송장 매칭", [
    {
      name: "카카오 송장번호 입력",
      functionName: "openInvoiceMatchSidebarLocal",
    },
  ]);
}

function openInvoiceMatchSidebarLocal() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var exTab = null;
    var sheets = ss.getSheets();
    for (var ti = 0; ti < sheets.length; ti++) {
      if (sheets[ti].getName().indexOf("전용양식") !== -1) {
        exTab = sheets[ti];
        break;
      }
    }
    if (!exTab) {
      SpreadsheetApp.getUi().alert("❌ 전용양식 탭을 찾을 수 없습니다.");
      return;
    }

    var lr = exTab.getLastRow();
    if (lr < 2) {
      SpreadsheetApp.getUi().alert("⚠️ 전용양식 데이터가 없습니다.");
      return;
    }
    var lc = Math.max(exTab.getLastColumn(), 1);
    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];

    // 수취인 열 자동 탐지
    var KEYWORDS = [
      "받는분",
      "받는사람",
      "수령인",
      "고객명",
      "받으시는",
      "수하인",
      "수취인",
    ];
    var EXCLUDE_KW = ["보내는", "송하인", "발화주", "발신"];
    var recipientCol = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      var h = String(headers[hi] || "").replace(/\s/g, "");
      var excluded = false;
      for (var ei = 0; ei < EXCLUDE_KW.length; ei++) {
        if (h.indexOf(EXCLUDE_KW[ei]) !== -1) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
      for (var ki = 0; ki < KEYWORDS.length; ki++) {
        if (h.indexOf(KEYWORDS[ki]) !== -1) {
          recipientCol = hi;
          break;
        }
      }
      if (recipientCol !== -1) break;
    }
    if (recipientCol === -1) {
      SpreadsheetApp.getUi().alert("❌ 수취인(받는분) 열을 찾을 수 없습니다.");
      return;
    }

    // 수취인 이름 및 행 번호 맵 구성
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var nameToRows = {};
    for (var ri = 0; ri < data.length; ri++) {
      var rn = String(data[ri][recipientCol] || "")
        .normalize("NFC")
        .replace(/\s*님\s*$/g, "")
        .trim();
      if (!rn) continue;
      if (!nameToRows[rn]) nameToRows[rn] = [];
      nameToRows[rn].push(ri); // 0-based index
    }

    var apiKey = _getOcrApiKey_();
    var recipientHeader = String(headers[recipientCol] || "");

    var htmlStr = _getInvoiceMatchHtml_()
      .replace("__OCR_API_KEY__", apiKey)
      .replace("__SPREADSHEET_ID__", ss.getId())
      .replace("__RECIPIENT_HEADER__", recipientHeader)
      .replace("__NAME_TO_ROWS_JSON__", JSON.stringify(nameToRows));

    var html = HtmlService.createHtmlOutput(htmlStr)
      .setTitle("📬 카카오 송장 매칭")
      .setWidth(400);
    SpreadsheetApp.getUi().showSidebar(html);
  } catch (e) {
    SpreadsheetApp.getUi().alert("오류: " + e.message);
  }
}

// ── Levenshtein 편집 거리 (퍼지 매칭용) ──
function _levenshteinLocal_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var matrix = [];
  for (var i = 0; i <= b.length; i++) matrix[i] = [i];
  for (var j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (var i2 = 1; i2 <= b.length; i2++) {
    for (var j2 = 1; j2 <= a.length; j2++) {
      if (b.charAt(i2 - 1) === a.charAt(j2 - 1)) {
        matrix[i2][j2] = matrix[i2 - 1][j2 - 1];
      } else {
        matrix[i2][j2] = Math.min(
          matrix[i2 - 1][j2 - 1] + 1,
          matrix[i2][j2 - 1] + 1,
          matrix[i2 - 1][j2] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// ── 서버: 텍스트 파싱 + 전용양식 매칭 (★ v2: 허브 동기화) ──
function parseAndMatchInvoiceTextLocal(rawText) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 전용양식 탭 탐색
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) {
        exTab = tabs[ti];
        break;
      }
    }
    if (!exTab) return { error: "전용양식 탭 없음" };

    var lr = exTab.getLastRow();
    if (lr < 2) return { error: "전용양식 데이터 없음" };
    var lc = Math.max(exTab.getLastColumn(), 1);
    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];

    // 수취인 열 자동 탐지
    var KEYWORDS = [
      "받는분",
      "받는사람",
      "수령인",
      "고객명",
      "받으시는",
      "수하인",
      "수취인",
    ];
    var EXCLUDE_KW = ["보내는", "송하인", "발화주", "발신"];
    var recipientCol = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      var h = String(headers[hi] || "").replace(/\s/g, "");
      var excluded = false;
      for (var ei = 0; ei < EXCLUDE_KW.length; ei++) {
        if (h.indexOf(EXCLUDE_KW[ei]) !== -1) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
      for (var ki = 0; ki < KEYWORDS.length; ki++) {
        if (h.indexOf(KEYWORDS[ki]) !== -1) {
          recipientCol = hi;
          break;
        }
      }
      if (recipientCol !== -1) break;
    }
    if (recipientCol === -1)
      return {
        error: "수취인 열 없음. 헤더: " + headers.slice(0, 8).join(", "),
      };

    // ★ 상품명 열 자동 탐지
    var PRODUCT_KW = [
      "상품명",
      "품목명",
      "품명",
      "제품명",
      "상품",
      "item",
      "product",
    ];
    var productCol = -1;
    for (var phi = 0; phi < headers.length; phi++) {
      var ph = String(headers[phi] || "")
        .replace(/\s/g, "")
        .toLowerCase();
      for (var pki = 0; pki < PRODUCT_KW.length; pki++) {
        if (ph.indexOf(PRODUCT_KW[pki]) !== -1) {
          productCol = phi;
          break;
        }
      }
      if (productCol !== -1) break;
    }

    // ★ NFC 정규화 + "님" 제거로 이름→행 큐 맵 구성
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var nameToRows = {};
    for (var ri = 0; ri < data.length; ri++) {
      var rn = String(data[ri][recipientCol] || "")
        .normalize("NFC")
        .replace(/\s*님\s*$/g, "")
        .trim();
      if (!rn) continue;
      if (!nameToRows[rn]) nameToRows[rn] = [];
      nameToRows[rn].push(ri);
    }
    var rowQueue = {};
    for (var qk in nameToRows) rowQueue[qk] = nameToRows[qk].slice();

    // 파싱
    var pairs = _parseInvoicePairs_(rawText);
    if (pairs.length === 0)
      return { error: '인식된 쌍 없음. 형식: "송장번호   이름" (각 줄)' };

    // ★ NFC 정규화 + 잔여 택배사 프리픽스 2차 정리
    var COURIER_PFX =
      /^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\s*[\/]\s*/i;
    for (var nfi = 0; nfi < pairs.length; nfi++) {
      if (pairs[nfi].name) {
        pairs[nfi].name = pairs[nfi].name
          .normalize("NFC")
          .replace(COURIER_PFX, "")
          .replace(/^[\s\/]+/, "")
          .trim();
      }
    }

    Logger.log(
      "[PARSE_RESULT] " +
        pairs.length +
        "쌍: " +
        pairs
          .map(function (p) {
            return p.name + "→" + p.tracking;
          })
          .join(", "),
    );

    // ── 5단계 매칭 (허브와 동일) ──
    var matches = [],
      unmatched = [],
      lastRowForName = {};

    for (var pi = 0; pi < pairs.length; pi++) {
      var p = pairs[pi];
      var assignedRows = [];
      var matchedName = p.name;
      var isAppend = false;

      // ── 큐 키 찾기 (1.완전일치 → 2.공백제거 → 3.부분일치 → 4.공백+부분 → 5.유사도) ──
      var queueKey = null;

      // 1. 완전 일치
      if (rowQueue[p.name] && rowQueue[p.name].length > 0) {
        queueKey = p.name;
      }
      // 2. 공백 제거 후 비교
      if (!queueKey) {
        var inputNoSp = p.name.replace(/\s/g, "");
        for (var nm in rowQueue) {
          if (rowQueue[nm].length > 0 && nm.replace(/\s/g, "") === inputNoSp) {
            queueKey = nm;
            matchedName = nm;
            break;
          }
        }
      }
      // 3. 부분 문자열 포함
      if (!queueKey) {
        for (var nm2 in rowQueue) {
          if (
            rowQueue[nm2].length > 0 &&
            (nm2.indexOf(p.name) !== -1 || p.name.indexOf(nm2) !== -1)
          ) {
            queueKey = nm2;
            matchedName = nm2;
            break;
          }
        }
      }
      // 4. 공백 제거 후 부분 포함
      if (!queueKey) {
        var inputNoSp2 = p.name.replace(/\s/g, "");
        for (var nm3 in rowQueue) {
          if (rowQueue[nm3].length > 0) {
            var sheetNoSp = nm3.replace(/\s/g, "");
            if (
              sheetNoSp.indexOf(inputNoSp2) !== -1 ||
              inputNoSp2.indexOf(sheetNoSp) !== -1
            ) {
              queueKey = nm3;
              matchedName = nm3;
              break;
            }
          }
        }
      }
      // 5. 유사도 매칭 (편집 거리 기반)
      if (!queueKey) {
        var bestKey = null,
          bestDist = 999;
        var inputNorm = p.name.replace(/\s/g, "");
        for (var nm4 in rowQueue) {
          if (rowQueue[nm4].length === 0) continue;
          var sheetNorm = nm4.replace(/\s/g, "");
          var maxLen = Math.max(inputNorm.length, sheetNorm.length);
          if (maxLen === 0) continue;
          var dist = _levenshteinLocal_(inputNorm, sheetNorm);
          var threshold = Math.max(2, Math.floor(maxLen * 0.3));
          if (dist > Math.ceil(maxLen * 0.5)) threshold = -1;
          if (dist <= threshold && dist < bestDist) {
            bestDist = dist;
            bestKey = nm4;
          }
        }
        if (bestKey) {
          queueKey = bestKey;
          matchedName = bestKey;
        }
      }

      // ── 행 배정 ──
      if (queueKey && rowQueue[queueKey] && rowQueue[queueKey].length > 0) {
        assignedRows = [rowQueue[queueKey].shift()];
        lastRowForName[queueKey] = assignedRows[0];
        lastRowForName[p.name] = assignedRows[0];
      } else if (lastRowForName[p.name] !== undefined) {
        assignedRows = [lastRowForName[p.name]];
        isAppend = true;
      } else {
        // lastRowForName에서 부분일치 검색
        for (var lrn in lastRowForName) {
          if (lrn.indexOf(p.name) !== -1 || p.name.indexOf(lrn) !== -1) {
            assignedRows = [lastRowForName[lrn]];
            matchedName = lrn;
            isAppend = true;
            break;
          }
        }
      }

      if (assignedRows.length > 0) {
        matches.push({
          tracking: p.tracking,
          name: p.name,
          matchedName: matchedName,
          rows: assignedRows,
          append: isAppend,
        });
      } else {
        unmatched.push(p);
      }
    }

    return {
      matches: matches,
      unmatched: unmatched,
      recipientHeader: String(headers[recipientCol] || ""),
      total: pairs.length,
      _debug_sheetNames: Object.keys(nameToRows).slice(0, 20),
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── 서버: 전용양식에 반영 ──
function applyInvoiceMatchesLocal(matchesJson) {
  try {
    var matches = JSON.parse(matchesJson);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) {
        exTab = tabs[ti];
        break;
      }
    }
    if (!exTab) return { msg: "❌ 전용양식 탭 없음" };

    var lr = exTab.getLastRow();
    var lc = Math.max(exTab.getLastColumn(), 1);
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var writeCount = 0;

    for (var mi = 0; mi < matches.length; mi++) {
      var m = matches[mi];
      if (!m.rows) continue;
      for (var ri = 0; ri < m.rows.length; ri++) {
        var idx = m.rows[ri];
        if (idx >= 0 && idx < data.length) {
          var ex = String(data[idx][0] || "").trim();
          data[idx][0] =
            m.append && ex
              ? ex + "\n" + String(m.tracking)
              : String(m.tracking);
          data[idx][1] = "발송완료";
          writeCount++;
        }
      }
    }
    exTab.getRange(2, 1, data.length, lc).setValues(data);
    SpreadsheetApp.flush();
    return { msg: "✅ " + writeCount + "행에 송장번호 반영 완료" };
  } catch (e) {
    return { msg: "❌ " + e.message };
  }
}

// ══════════════════════════════════════════════════════════════
// 텍스트 파서 (★ v2: 허브 _pep_parseInvoiceNamePairs_ 동기화)
// ══════════════════════════════════════════════════════════════
function _parseInvoicePairs_(text) {
  // ★ 택배사명 제거
  var COURIER_NAMES =
    /[|｜\s]*(롯데택배|CJ대한통운|한진택배|우체국택배|로젠택배|경동택배|대신택배|일양로지스|천일택배|합동택배|건영택배|호남택배|CVSnet|GSpostbox|CJ택배|택배)/gi;

  // ★ "택배사명 / " 프리픽스 제거 ("롯데약국" 보호)
  var COURIER_PREFIX =
    /^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\s*[\/]\s*/gim;

  // ★ 거래명세서 노이즈 줄 제거
  var NOISE_LINE_PATTERNS =
    /^.*(등록번호|사업자|TEL|FAX|전화|팩스|계좌|은행|입금바랍니다|거래명세서|공급가액|부가세|합계|수량|단가|품목|규격|거래일|상\s*호|업\s*태|종\s*목|주\s*소|성\s*명).*$/gim;

  // 전처리
  var preprocessed = text
    .replace(COURIER_NAMES, "")
    .replace(COURIER_PREFIX, "")
    .replace(NOISE_LINE_PATTERNS, "");

  var lines = preprocessed
    .split(/[\r\n]+/)
    .map(function (l) {
      return l.replace(/\t/g, "   ").trim();
    })
    .filter(function (l) {
      return l.length > 0;
    });

  var pairs = [];
  var trackingLines = [];
  var nameLines = [];
  var pairedLines = [];

  // ★ 송장번호 추출 + 사업자등록번호/전화번호 필터
  function _extractTracking(raw) {
    var trimmed = raw.trim();
    if (/^\d{3}-\d{2}-\d{5}$/.test(trimmed)) return null; // 사업자등록번호
    if (/^0\d{1,2}-\d{3,4}-\d{4}$/.test(trimmed)) return null; // 전화번호
    var digits = trimmed.replace(/[-\s]/g, "");
    if (/^\d{10,14}$/.test(digits)) return digits;
    return null;
  }

  // ★ 이름 정규화: "님", "|", "/" 제거
  function _cleanName(n) {
    return n
      .replace(/[|｜\/]/g, "")
      .replace(/\s*님\s*/g, "")
      .trim();
  }

  // ★ 이름 유효성 (한글 + 영문 + 혼합)
  function _isValidName(n) {
    if (!n || n.length < 2) return false;
    if (/^\d+$/.test(n)) return false;
    if (/^[가-힣\s]{2,15}$/.test(n)) return true; // 한글
    if (/^[A-Za-z\s]{2,30}$/.test(n)) return true; // 영문
    if (/[가-힣]/.test(n) && n.length >= 2 && n.length <= 20) return true; // 혼합
    return false;
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // ★ 0단계: 인라인 파싱 (한 줄에 "이름1 번호1 이름2 번호2...")
    var inlineMatches = line.match(/[A-Za-z가-힣\s]{2,30}\s+\d{10,14}/g);
    if (inlineMatches && inlineMatches.length >= 2) {
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
      var remainDigits = line.replace(/[A-Za-z가-힣\s]{2,30}\s+\d{10,14}/g, "");
      var extraNums = remainDigits.match(/\d{10,14}/g);
      if (extraNums) {
        for (var en = 0; en < extraNums.length; en++) {
          var et = _extractTracking(extraNums[en]);
          if (et) trackingLines.push(et);
        }
      }
      continue;
    }

    // ① 번호 + 이름
    var m1 = line.match(/^([\d\-]{10,20})\s{1,}(.+)$/);
    if (m1) {
      var t1 = _extractTracking(m1[1]);
      var n1 = _cleanName(m1[2]);
      if (t1 && _isValidName(n1)) {
        pairedLines.push({ tracking: t1, name: n1 });
        continue;
      } else if (t1) {
        trackingLines.push(t1);
        continue;
      }
    }

    // ② 이름 + 번호
    var m2 = line.match(/^(.+?)\s{1,}([\d\-]{10,20})$/);
    if (m2) {
      var t2 = _extractTracking(m2[2]);
      var n2 = _cleanName(m2[1]);
      if (t2 && _isValidName(n2)) {
        pairedLines.push({ tracking: t2, name: n2 });
        continue;
      } else if (t2) {
        trackingLines.push(t2);
        continue;
      }
    }

    // ③ 번호만
    var solo = _extractTracking(line);
    if (solo && /^[\d\-]+$/.test(line.trim())) {
      trackingLines.push(solo);
      continue;
    }

    // ④ 이름만
    var nameCandidates = line.split(/\s{2,}/);
    for (var ni = 0; ni < nameCandidates.length; ni++) {
      var nc = _cleanName(nameCandidates[ni]);
      if (_isValidName(nc)) {
        nameLines.push(nc);
      }
    }
  }

  // pairedLines 먼저 추가
  for (var pi2 = 0; pi2 < pairedLines.length; pi2++)
    pairs.push(pairedLines[pi2]);

  // 번호만/이름만 줄 매칭
  if (trackingLines.length > 0 && nameLines.length > 0) {
    var mc = Math.min(trackingLines.length, nameLines.length);
    for (var mi2 = 0; mi2 < mc; mi2++)
      pairs.push({ tracking: trackingLines[mi2], name: nameLines[mi2] });
  } else if (trackingLines.length > 0) {
    var pending = null;
    for (var fi = 0; fi < lines.length; fi++) {
      var fLine = lines[fi];
      var ft = _extractTracking(fLine);
      if (ft && /^[\d\-]+$/.test(fLine.trim())) {
        pending = ft;
        continue;
      }
      var fn = _cleanName(fLine);
      if (_isValidName(fn) && pending) {
        pairs.push({ tracking: pending, name: fn });
        pending = null;
      }
    }
  }
  return pairs;
}

// ── OCR API 키 반환 (사이드바 HTML 주입용) ──
// ★ 2026-06-22: PropertiesService 제거 (업체 시트 권한 문제 방지)
//   GEMINI_API_KEY는 허브(_secrets.gs)와 업체(주입)에서 항상 전역 변수로 정의됨
function _getOcrApiKey_() {
  if (typeof GEMINI_API_KEY !== "undefined") return GEMINI_API_KEY;
  return "";
}

// ── 인라인 HTML 사이드바 (텍스트/엑셀/이미지 OCR 탭) ──
function _getInvoiceMatchHtml_() {
  return (
    '<!DOCTYPE html><html><head><base target="_top"><style>' +
    "*{box-sizing:border-box;margin:0;padding:0}" +
    'body{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:13px;background:#f0f2f5;display:flex;flex-direction:column;height:100vh}' +
    ".hd{background:#1a73e8;color:white;padding:12px 16px;font-size:15px;font-weight:bold;flex-shrink:0}" +
    ".sc{background:white;margin:8px 8px 0;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)}" +
    ".st{font-size:11px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}" +
    "textarea{width:100%;height:110px;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:12px;font-family:monospace;resize:none}" +
    ".btn{width:100%;padding:9px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;margin-top:8px;transition:.15s}" +
    ".bb{background:#1a73e8;color:white}.bb:hover{background:#1558b0}" +
    ".bg{background:#34a853;color:white}.bg:hover{background:#2d8f46}" +
    ".bo{background:#f29900;color:white}.bo:hover{background:#d88a00}" +
    ".btn:disabled{background:#ccc;cursor:not-allowed}" +
    "#rs{flex:1;overflow-y:auto;display:none}" +
    ".sum{margin:8px;background:white;border-radius:8px;padding:10px 12px;font-size:12px;color:#444;box-shadow:0 1px 3px rgba(0,0,0,.1)}" +
    "table{width:100%;border-collapse:collapse;font-size:12px}" +
    "th{background:#f8f9fa;padding:6px 8px;text-align:left;font-size:11px;color:#666}" +
    "td{padding:5px 8px;border-bottom:1px solid #f0f0f0}" +
    ".ok{color:#34a853;font-weight:bold}.err{color:#ea4335;font-weight:bold}" +
    ".tr{font-size:11px;color:#555;font-family:monospace}" +
    "#toast{display:none;position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:8px 18px;border-radius:20px;font-size:12px;z-index:999}" +
    ".tab-bar{display:flex;margin:8px 8px 0;gap:2px}" +
    ".tab-btn{flex:1;padding:8px 4px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:12px;font-weight:bold;background:#e0e0e0;color:#666;transition:.15s}" +
    ".tab-btn.active{background:white;color:#1a73e8;box-shadow:0 -1px 3px rgba(0,0,0,.1)}" +
    ".tab-content{display:none}.tab-content.active{display:block}" +
    ".img-drop{border:2px dashed #ccc;padding:16px;border-radius:6px;background:#fafafa;text-align:center;cursor:pointer;transition:.2s;min-height:80px}" +
    ".img-drop.dragover{background:#e8f0fe;border-color:#1a73e8}" +
    ".img-drop.has-img{border-color:#34a853;background:#f6fff6}" +
    ".img-preview{max-width:100%;max-height:150px;border-radius:4px;margin-top:8px;border:1px solid #ddd}" +
    "</style></head><body>" +
    '<div class="hd">📬 카카오 송장번호 매칭</div>' +
    '<div class="tab-bar">' +
    '<button class="tab-btn active" onclick="switchTab(\'text\')">📋 텍스트/엑셀</button>' +
    '<button class="tab-btn" onclick="switchTab(\'image\')">🖼️ 이미지 OCR</button>' +
    "</div>" +
    '<div class="sc" style="border-radius:0 0 8px 8px;margin-top:0">' +
    '<div id="tab-text" class="tab-content active">' +
    '<div id="dropZone" style="margin-bottom:8px;border:2px dashed #ccc;padding:12px;border-radius:6px;background:#fafafa;text-align:center;cursor:pointer" onclick="document.getElementById(\'fileUpload\').click()">' +
    '<div style="font-size:13px;color:#555;margin-bottom:4px">📂 엑셀 파일을 여기에 드래그 앤 드롭</div>' +
    '<div style="font-size:11px;color:#888">또는 클릭하여 파일 선택</div>' +
    '<input type="file" id="fileUpload" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleFileUpload(event)">' +
    "</div>" +
    '<textarea id="rt" placeholder="예시:\n44363801252   최고갈비\n443-8937-1622   임병혁"></textarea>' +
    "</div>" +
    '<div id="tab-image" class="tab-content">' +
    '<div id="imgDrop" class="img-drop" onclick="document.getElementById(\'imgUpload\').click()">' +
    '<div id="imgPh"><div style="font-size:22px;margin-bottom:6px">📸</div>' +
    '<div style="font-size:13px;color:#555">이미지를 붙여넣기(Ctrl+V) 하거나</div>' +
    '<div style="font-size:13px;color:#555;margin-bottom:4px">드래그 앤 드롭 / 클릭하여 선택</div>' +
    '<div style="font-size:11px;color:#aaa">송장 목록 스크린샷을 넣으세요</div></div>' +
    '<input type="file" id="imgUpload" accept="image/*" style="display:none" onchange="handleImgFile(event)">' +
    "</div>" +
    '<div id="imgPrevArea" style="display:none;text-align:center;margin-top:8px">' +
    '<img id="imgPrev" class="img-preview">' +
    '<div id="ocrStatus" style="font-size:11px;color:#888;margin-top:4px"></div></div>' +
    '<button class="btn bo" id="ocrBtn" onclick="runOCR()" style="display:none">🔍 이미지에서 텍스트 추출</button>' +
    "</div>" +
    '<button class="btn bb" id="ab" onclick="analyze()">🔍 분석</button>' +
    "</div>" +
    '<div id="rs"><div class="sum" id="sum"></div>' +
    '<div class="sc" style="margin-bottom:8px">' +
    '<button class="btn bg" id="apb" onclick="applyAll()">✅ 전용양식에 반영</button>' +
    '<table><thead><tr><th>이름</th><th>송장번호</th><th>행</th><th></th></tr></thead><tbody id="mt"></tbody></table>' +
    '</div></div><div id="toast"></div>' +
    "<script>var _m=null,_imgB64=null;" +
    'function toast(msg,ms){var el=document.getElementById("toast");el.textContent=msg;el.style.display="block";setTimeout(function(){el.style.display="none"},ms||2500)}' +
    'function switchTab(t){document.querySelectorAll(".tab-btn").forEach(function(b,i){b.classList.toggle("active",(t==="text"&&i===0)||(t==="image"&&i===1))});' +
    'document.getElementById("tab-text").classList.toggle("active",t==="text");document.getElementById("tab-image").classList.toggle("active",t==="image")}' +
    'function handleImgData(b64){_imgB64=b64;document.getElementById("imgPrev").src=b64;document.getElementById("imgPrevArea").style.display="block";' +
    'document.getElementById("imgPh").style.display="none";document.getElementById("imgDrop").classList.add("has-img");document.getElementById("ocrBtn").style.display="block";' +
    'document.getElementById("ocrStatus").textContent="이미지 준비 완료"}' +
    'function handleImgFile(e){var f=e.target.files[0];if(!f||!f.type.startsWith("image/"))return;var r=new FileReader();r.onload=function(ev){handleImgData(ev.target.result)};r.readAsDataURL(f)}' +
    'document.addEventListener("paste",function(e){var cd=e.clipboardData||window.clipboardData;if(!cd)return;var items=cd.items;' +
    'if(items){for(var i=0;i<items.length;i++){if(items[i].type.indexOf("image")!==-1){e.preventDefault();var f=items[i].getAsFile();' +
    'var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f);return}}}});' +
    'document.addEventListener("DOMContentLoaded",function(){' +
    'var iz=document.getElementById("imgDrop");' +
    'iz.addEventListener("dragover",function(e){e.preventDefault();e.stopPropagation();iz.classList.add("dragover")});' +
    'iz.addEventListener("dragleave",function(e){e.preventDefault();e.stopPropagation();iz.classList.remove("dragover")});' +
    'iz.addEventListener("drop",function(e){e.preventDefault();e.stopPropagation();iz.classList.remove("dragover");' +
    'var f=e.dataTransfer.files[0];if(f&&f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){handleImgData(ev.target.result)};r.readAsDataURL(f)}});' +
    'var dz=document.getElementById("dropZone");' +
    'dz.addEventListener("dragover",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#e8f0fe";dz.style.borderColor="#1a73e8"});' +
    'dz.addEventListener("dragleave",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#fafafa";dz.style.borderColor="#ccc"});' +
    'dz.addEventListener("drop",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#fafafa";dz.style.borderColor="#ccc";' +
    "if(e.dataTransfer.files&&e.dataTransfer.files.length>0){var f=e.dataTransfer.files[0];" +
    'if(f&&f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f)}' +
    'else{document.getElementById("fileUpload").files=e.dataTransfer.files;handleFileUpload({target:{files:e.dataTransfer.files}})}}})});' +
    'function runOCR(){if(!_imgB64)return toast("이미지를 먼저 붙여넣으세요",2000);' +
    'var btn=document.getElementById("ocrBtn");var st=document.getElementById("ocrStatus");' +
    'btn.disabled=true;btn.textContent="📡 OCR 처리 중...";st.textContent="Gemini Vision으로 분석 중...";' +
    'var apiKey=document.getElementById("_ocrKey").value;' +
    'if(!apiKey){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";st.textContent="❌ API 키 없음";toast("OCR API 키가 설정되지 않았습니다.",3000);return}' +
    'var mimeType="image/png";var rawB64=_imgB64;' +
    'if(_imgB64.indexOf(",")!==-1){var pp=_imgB64.split(",");var mmm=pp[0].match(/data:([^;]+)/);if(mmm)mimeType=mmm[1];rawB64=pp[1]}' +
    'var url="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key="+apiKey;' +
    'var prompt="이 이미지에서 택배 수취인(받는사람) 이름과 택배 송장번호(10~14자리 숫자)를 추출.\\n"' +
    '+"사업자등록번호,전화번호,계좌번호 제외.\\n"' +
    '+"형식: 이름 송장번호 (공백구분, 한줄에 1쌍)\\n"' +
    '+"택배사명은 이름이 아님. 님 제거. 영문이름 포함.";' +
    "var payload={contents:[{parts:[{text:prompt},{inline_data:{mime_type:mimeType,data:rawB64}}]}],generationConfig:{temperature:0.1,maxOutputTokens:2048}};" +
    'fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})' +
    ".then(function(r){return r.json()})" +
    '.then(function(json){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";' +
    'if(json.error){st.textContent="❌ 오류: "+json.error.message;toast("OCR 오류: "+json.error.message,4000);return}' +
    "var b3=String.fromCharCode(96,96,96);" +
    'var text=(json.candidates[0].content.parts[0].text||"").replace(new RegExp(b3+"[a-z]*\\\\n?","gi"),"").replace(new RegExp(b3,"g"),"").trim();' +
    'if(!text||text.length<3){st.textContent="❌ 텍스트를 인식하지 못했습니다.";toast("이미지에서 텍스트를 인식하지 못했습니다.",3000);return}' +
    'document.getElementById("rt").value=text;st.textContent="✅ "+text.split("\\n").length+"줄 추출 완료!";switchTab("text");toast("OCR 완료! 분석 버튼을 눌러주세요.",3000)})' +
    '.catch(function(e){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";st.textContent="❌ 오류: "+e.message;toast("OCR 오류: "+e.message,4000)})}' +
    "function handleFileUpload(e){var f=e.target.files[0];if(!f)return;" +
    'if(f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f);return}' +
    'var btn=document.getElementById("ab");btn.textContent="파일 읽는 중...";btn.disabled=true;' +
    "var reader=new FileReader();reader.onload=function(evt){var data=new Uint8Array(evt.target.result);" +
    'try{var wb=XLSX.read(data,{type:"array"});document.getElementById("rt").value=XLSX.utils.sheet_to_txt(wb.Sheets[wb.SheetNames[0]]);toast("엑셀 파일 로드 완료!",3000)}' +
    'catch(err){toast("파일 읽기 오류: "+err.message,4000)}finally{btn.textContent="🔍 분석";btn.disabled=false}};reader.readAsArrayBuffer(f)}' +
    "function _levenshteinLocal_(a,b){if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;var m=[];" +
    "for(var i=0;i<=b.length;i++)m[i]=[i];for(var j=0;j<=a.length;j++)m[0][j]=j;" +
    "for(var i2=1;i2<=b.length;i2++){for(var j2=1;j2<=a.length;j2++){if(b.charAt(i2-1)===a.charAt(j2-1)){m[i2][j2]=m[i2-1][j2-1]}" +
    "else{m[i2][j2]=Math.min(m[i2-1][j2-1]+1,m[i2][j2-1]+1,m[i2-1][j2]+1)}}}return m[b.length][a.length]}" +
    "function _parseInvoicePairs_(text){var cn=/[|｜\\s]*(롯데택배|CJ대한통운|한진택배|우체국택배|로젠택배|경동택배|대신택배|일양로지스|천일택배|합동택배|건영택배|호남택배|CVSnet|GSpostbox|CJ택배|택배)/gi;" +
    "var cp=/^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\\s*[\\/]\\s*/gim;" +
    "var nl=/^.*(등록번호|사업자|TEL|FAX|전화|팩스|계좌|은행|입금바랍니다|거래명세서|공급가액|부가세|합계|수량|단가|품목|규격|거래일|상\\s*호|업\\s*태|종\\s*목|주\\s*소|성\\s*명).*$/gim;" +
    'var pp=text.replace(cn,"").replace(cp,"").replace(nl,"");' +
    'var lines=pp.split(/[\\r\\n]+/).map(function(l){return l.replace(/\\t/g,"   ").trim()}).filter(function(l){return l.length>0});' +
    "var pairs=[],tl=[],nl_arr=[],pl=[];" +
    "function exT(r){var tr=r.trim();if(/^\\d{3}-\\d{2}-\\d{5}$/.test(tr))return null;if(/^0\\d{1,2}-\\d{3,4}-\\d{4}$/.test(tr))return null;" +
    'var dg=tr.replace(/[-\\s]/g,"");if(/^\\d{10,14}$/.test(dg))return dg;return null}' +
    'function clN(n){return n.replace(/[|｜\\/]/g,"").replace(/\\s*님\\s*/g,"").trim()}' +
    "function valN(n){if(!n||n.length<2)return false;if(/^\\d+$/.test(n))return false;if(/^[가-힣\\s]{2,15}$/.test(n))return true;" +
    "if(/^[A-Za-z\\s]{2,30}$/.test(n))return true;if(/[가-힣]/.test(n)&&n.length>=2&&n.length<=20)return true;return false}" +
    "for(var i=0;i<lines.length;i++){var line=lines[i];var im=line.match(/[A-Za-z가-힣\\s]{2,30}\\s+\\d{10,14}/g);" +
    "if(im&&im.length>=2){for(var j=0;j<im.length;j++){var imp=im[j].trim().match(/^(.+?)\\s+(\\d{10,14})$/);" +
    "if(imp){var imn=clN(imp[1]),imt=exT(imp[2]);if(imt&&valN(imn)){pl.push({tracking:imt,name:imn})}else if(imt){tl.push(imt)}}}" +
    'var rd=line.replace(/[A-Za-z가-힣\\s]{2,30}\\s+\\d{10,14}/g,"");var en=rd.match(/\\d{10,14}/g);' +
    "if(en){for(var k=0;k<en.length;k++){var et=exT(en[k]);if(et)tl.push(et)}}continue}" +
    "var m1=line.match(/^([\\d\\-]{10,20})\\s{1,}(.+)$/);if(m1){var t1=exT(m1[1]),n1=clN(m1[2]);" +
    "if(t1&&valN(n1)){pl.push({tracking:t1,name:n1});continue}else if(t1){tl.push(t1);continue}}" +
    "var m2=line.match(/^(.+?)\\s{1,}([\\d\\-]{10,20})$/);if(m2){var t2=exT(m2[2]),n2=clN(m2[1]);" +
    "if(t2&&valN(n2)){pl.push({tracking:t2,name:n2});continue}else if(t2){tl.push(t2);continue}}" +
    "var sl=exT(line);if(sl&&/^[\\d\\-]+$/.test(line.trim())){tl.push(sl);continue}" +
    "var nc=line.split(/\\s{2,}/);for(var j=0;j<nc.length;j++){var ncc=clN(nc[j]);if(valN(ncc))nl_arr.push(ncc)}}" +
    "for(var j=0;j<pl.length;j++)pairs.push(pl[j]);" +
    "if(tl.length>0&&nl_arr.length>0){var mc=Math.min(tl.length,nl_arr.length);for(var j=0;j<mc;j++)pairs.push({tracking:tl[j],name:nl_arr[j]})}" +
    "else if(tl.length>0){var pd=null;for(var j=0;j<lines.length;j++){var fl=lines[j];var ft=exT(fl);" +
    "if(ft&&/^[\\d\\-]+$/.test(fl.trim())){pd=ft;continue}var fn=clN(fl);if(valN(fn)&&pd){pairs.push({tracking:pd,name:fn});pd=null}}}" +
    "return pairs}" +
    "function analyze(){" +
    'var rt=document.getElementById("rt").value.trim();if(!rt)return toast("텍스트를 붙여넣으세요.",2000);' +
    'var btn=document.getElementById("ab");btn.disabled=true;btn.textContent="분석 중...";' +
    'document.getElementById("rs").style.display="none";' +
    "try{" +
    'var nameToRows=JSON.parse(document.getElementById("_nameToRows").value||"{}");' +
    'var recipientHeader=document.getElementById("_recipientHeader").value||"";' +
    "var rowQueue={};for(var k in nameToRows){rowQueue[k]=nameToRows[k].slice()}" +
    "var pairs=_parseInvoicePairs_(rt);" +
    'if(pairs.length===0){btn.disabled=false;btn.textContent="🔍 분석";return toast("인식된 쌍 없음. 형식: \'송장번호   이름\'",3000)}' +
    "var cpf=/^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\\s*[\\/]\\s*/i;" +
    'for(var i=0;i<pairs.length;i++){if(pairs[i].name){pairs[i].name=pairs[i].name.normalize("NFC").replace(cpf,"").replace(/^[\\s\\/]+/,"").trim()}}' +
    "var matches=[],unmatched=[],lastRow={};" +
    "for(var i=0;i<pairs.length;i++){" +
    "var p=pairs[i];var assigned=[];var mName=p.name;var isAp=false;var qKey=null;" +
    "if(rowQueue[p.name]&&rowQueue[p.name].length>0){qKey=p.name}" +
    'if(!qKey){var inSp=p.name.replace(/\\s/g,"");for(var nm in rowQueue){if(rowQueue[nm].length>0&&nm.replace(/\\s/g,"")===inSp){qKey=nm;mName=nm;break}}}' +
    "if(!qKey){for(var nm in rowQueue){if(rowQueue[nm].length>0&&(nm.indexOf(p.name)!==-1||p.name.indexOf(nm)!==-1)){qKey=nm;mName=nm;break}}}" +
    'if(!qKey){var inSp=p.name.replace(/\\s/g,"");for(var nm in rowQueue){if(rowQueue[nm].length>0){var shSp=nm.replace(/\\s/g,"");if(shSp.indexOf(inSp)!==-1||inSp.indexOf(shSp)!==-1){qKey=nm;mName=nm;break}}}}' +
    'if(!qKey){var bK=null,bD=999,inN=p.name.replace(/\\s/g,"");for(var nm in rowQueue){if(rowQueue[nm].length===0)continue;' +
    'var shN=nm.replace(/\\s/g,"");var maxL=Math.max(inN.length,shN.length);if(maxL===0)continue;var ds=_levenshteinLocal_(inN,shN);' +
    "var th=Math.max(2,Math.floor(maxL*0.3));if(ds>Math.ceil(maxL*0.5))th=-1;if(ds<=th&&ds<bD){bD=ds;bK=nm}}}if(bK){qKey=bK;mName=bK}}" +
    "if(qKey&&rowQueue[qKey].length>0){assigned=[rowQueue[qKey].shift()];lastRow[qKey]=assigned[0];lastRow[p.name]=assigned[0]}" +
    "else if(lastRow[p.name]!==undefined){assigned=[lastRow[p.name]];isAp=true}" +
    "else{for(var lrn in lastRow){if(lrn.indexOf(p.name)!==-1||p.name.indexOf(lrn)!==-1){assigned=[lastRow[lrn]];mName=lrn;isAp=true;break}}}" +
    "if(assigned.length>0){matches.push({tracking:p.tracking,name:p.name,matchedName:mName,rows:assigned,append:isAp})}" +
    "else{unmatched.push(p)}}" +
    "_m=matches;" +
    "var ok=matches.filter(function(m){return m.rows&&m.rows.length>0});var no=unmatched;" +
    'document.getElementById("sum").innerHTML="<b>수취인 열:</b> "+recipientHeader+"&nbsp;|&nbsp;<span class=ok>✅ "+ok.length+"건</span>&nbsp;<span class=err>❌ "+no.length+"건</span>";' +
    'var tb=document.getElementById("mt");tb.innerHTML="";' +
    'ok.forEach(function(m){var rn=m.rows.map(function(r){return r+2}).join(",");var ns=m.name!==m.matchedName?m.name+"<span style=color:#aaa>≈</span>"+m.matchedName:m.name;' +
    'var st=m.append?"<span style=color:#f29900>➕추가</span>":"<span class=ok>✅</span>";' +
    'tb.innerHTML+="<tr><td>"+ns+"</td><td class=tr>"+m.tracking+"</td><td>"+rn+"</td><td>"+st+"</td></tr>"});' +
    'no.forEach(function(u){tb.innerHTML+="<tr><td class=err>"+u.name+"</td><td class=tr>"+u.tracking+"</td><td>-</td><td class=err>❌</td></tr>"});' +
    'document.getElementById("apb").style.display=ok.length?"block":"none";' +
    'document.getElementById("rs").style.display="block"}' +
    'catch(err){toast("분석 오류: "+err.message,4000)}finally{btn.disabled=false;btn.textContent="🔍 분석"}}' +
    'function applyAll(){if(!_m)return;var btn=document.getElementById("apb");btn.disabled=true;btn.textContent="반영 중...";' +
    'google.script.run.withSuccessHandler(function(res){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast(res.msg,3000)})' +
    '.withFailureHandler(function(err){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast("오류: "+err,3000)})' +
    ".applyInvoiceMatchesLocal(JSON.stringify(_m))}" +
    "<\\/script>" +
    '<input type="hidden" id="_ocrKey" value="__OCR_API_KEY__">' +
    '<input type="hidden" id="_ssId" value="__SPREADSHEET_ID__">' +
    '<input type="hidden" id="_recipientHeader" value="__RECIPIENT_HEADER__">' +
    '<input type="hidden" id="_nameToRows" value=\'__NAME_TO_ROWS_JSON__\'>' +
    '<script async src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"><\/script>' +
    "</body></html>"
  );
}

// ═══════════════════════════════════════════════════════════════════
// [자동 주입용] 업체 시트에 주입할 InvoiceMatch 코드 반환
// ───────────────────────────────────────────────────────────────────
// ★ createViewerNoticeScript_()에서 호출하여 fileList에 포함
// ★ 수정은 위의 실제 함수들에서 하면 자동 반영됨
// ═══════════════════════════════════════════════════════════════════
function getPartnerInvoiceMatchCode_() {
  // ★ 2026-06-22 v8: 로컬 하이브리드 방식
  //   분석 및 파싱은 100% 브라우저단에서 동작하여 웹앱 통신 제거
  //   반영(applyInvoiceMatchesLocal)만 서버 함수로 최소 주입

  var code =
    "// [Pack2U] \uce74\uce74\uc624 \uc1a1\uc7a5 \ub9e4\uce6d v8 (\ub85c\uceec \uD558\uc774\ube0c\ub9ac\ub4dc)\n\n" +
    applyInvoiceMatchesLocal.toString() +
    "\n\n" +
    "function openInvoiceMatchSidebarLocal() {\n" +
    "  try {\n" +
    "    var ss = SpreadsheetApp.getActiveSpreadsheet();\n" +
    "    var exTab = null;\n" +
    "    var sheets = ss.getSheets();\n" +
    "    for (var ti = 0; ti < sheets.length; ti++) {\n" +
    '      if (sheets[ti].getName().indexOf("전용양식") !== -1) { exTab = sheets[ti]; break; }\n' +
    "    }\n" +
    '    if (!exTab) { SpreadsheetApp.getUi().alert("❌ \uc804\uc6a9\uc591\uc2dd \ud0ed\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4."); return; }\n' +
    "    var lr = exTab.getLastRow();\n" +
    '    if (lr < 2) { SpreadsheetApp.getUi().alert("\u26A0\ufe0f \uc804\uc6a9\uc591\uc2dd \ub370\uc774\ud130\uac00 \uc5c6\uc2b5\ub2c8\ub2e4."); return; }\n' +
    "    var lc = Math.max(exTab.getLastColumn(), 1);\n" +
    "    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];\n" +
    '    var KEYWORDS = ["받는분","받는사람","수령인","고객명","받으시는","수하인","수취인"];\n' +
    '    var EXCLUDE_KW = ["보내는","송하인","발화주","발신"];\n' +
    "    var recipientCol = -1;\n" +
    "    for (var hi = 0; hi < headers.length; hi++) {\n" +
    '      var h = String(headers[hi] || "").replace(/\\s/g, "");\n' +
    "      var excluded = false;\n" +
    "      for (var ei = 0; ei < EXCLUDE_KW.length; ei++) {\n" +
    "        if (h.indexOf(EXCLUDE_KW[ei]) !== -1) { excluded = true; break; }\n" +
    "      }\n" +
    "      if (excluded) continue;\n" +
    "      for (var ki = 0; ki < KEYWORDS.length; ki++) {\n" +
    "        if (h.indexOf(KEYWORDS[ki]) !== -1) { recipientCol = hi; break; }\n" +
    "      }\n" +
    "      if (recipientCol !== -1) break;\n" +
    "    }\n" +
    '    if (recipientCol === -1) { SpreadsheetApp.getUi().alert("\u274c \uc218\ucde8\uc778 \uc5f4\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4."); return; }\n' +
    "    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();\n" +
    "    var nameToRows = {};\n" +
    "    for (var ri = 0; ri < data.length; ri++) {\n" +
    '      var rn = String(data[ri][recipientCol] || "").normalize("NFC").replace(/\\s*님\\s*$/g, "").trim();\n' +
    "      if (!rn) continue;\n" +
    "      if (!nameToRows[rn]) nameToRows[rn] = [];\n" +
    "      nameToRows[rn].push(ri);\n" +
    "    }\n" +
    '    var apiKey = (typeof GEMINI_API_KEY !== "undefined") ? GEMINI_API_KEY : "";\n' +
    '    var raw = HtmlService.createHtmlOutputFromFile("InvoiceMatchSidebar").getContent();\n' +
    '    raw = raw.replace("__OCR_API_KEY__", apiKey)\n' +
    '             .replace("__SPREADSHEET_ID__", ss.getId())\n' +
    '             .replace("__RECIPIENT_HEADER__", String(headers[recipientCol] || ""))\n' +
    '             .replace("__NAME_TO_ROWS_JSON__", JSON.stringify(nameToRows));\n' +
    "    var output = HtmlService.createHtmlOutput(raw)\n" +
    '      .setTitle("\uD83D\uDCEC \uCE74\uCE74\uC624 \uC1A1\uC7A5 \uB9E4\uCE6D").setWidth(400);\n' +
    "    SpreadsheetApp.getUi().showSidebar(output);\n" +
    '  } catch(e) { SpreadsheetApp.getUi().alert("\uc624\ub958: " + e.message); }\n' +
    "}\n";
  return code;
}
