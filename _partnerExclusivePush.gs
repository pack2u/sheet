/**
 * [협력업체] 대리공급업체 발주 → 전용양식 자동 Push  v1.1
 * 파일: _partnerExclusivePush.gs
 *
 * 흐름:
 *   이카운트 발주 탭("대리공급업체 발주") 읽기
 *   → D열 이카운트코드 앞 2자리(prefix) → _PEP_VENDOR_COL_OVERRIDES_ 적용
 *   → 품목코드/품목명 별칭 변환 (대리발송 별칭 테이블)
 *   → 협력업체 파일의 "전용양식" 탭에 Push
 *      A열(송장번호), B열(적요) = 비워둠  ← 업체가 직접 기입
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

/** 사이드바 열기 */
function openInvoiceMatchSidebar() {
  var html = HtmlService.createHtmlOutputFromFile("invoiceMatchSidebar")
    .setTitle("📬 카카오 송장 매칭")
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

/** HTML → 업체 파일 목록 반환 */
function getPartnerFileListForSidebar() {
  var files = _pt_listFiles();
  var prefixToFile = _pep_buildPrefixToFileMap_(files);
  var result = [];
  for (var pfx in prefixToFile) {
    result.push({
      id: prefixToFile[pfx].id,
      pfx: pfx,
      name: prefixToFile[pfx].name.replace("[협력업체] ", ""),
    });
  }
  result.sort(function (a, b) {
    return a.pfx.localeCompare(b.pfx);
  });
  return result;
}

/** HTML → 텍스트 파싱 + 매칭 (미리보기용, 실제 기입 없음) */
function parseAndMatchInvoiceText(fileId, rawText) {
  try {
    var ss = SpreadsheetApp.openById(fileId);
    var exTab = null;
    var allTabs = ss.getSheets();
    for (var ti = 0; ti < allTabs.length; ti++) {
      if (allTabs[ti].getName().indexOf("전용양식") !== -1) {
        exTab = allTabs[ti];
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
    var recipientCol = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      var h = String(headers[hi] || "").replace(/\s/g, "");
      for (var ki = 0; ki < KEYWORDS.length; ki++) {
        if (h.indexOf(KEYWORDS[ki]) !== -1) {
          recipientCol = hi;
          break;
        }
      }
      if (recipientCol !== -1) break;
    }
    if (recipientCol === -1) {
      return {
        error: "수취인 열 없음. 헤더: " + headers.slice(0, 8).join(", "),
      };
    }

    // ── 이름 → 행 큐 맵 (순서 보존: 위 행부터 순차 할당)
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var nameToRows = {};
    for (var ri = 0; ri < data.length; ri++) {
      var rn = String(data[ri][recipientCol] || "").trim();
      if (!rn) continue;
      if (!nameToRows[rn]) nameToRows[rn] = [];
      nameToRows[rn].push(ri);
    }
    // 큐 복사본 (소비하면서 진행 → 원본 보존)
    var rowQueue = {};
    for (var qk in nameToRows) rowQueue[qk] = nameToRows[qk].slice();

    // 파싱
    var pairs = _pep_parseInvoiceNamePairs_(rawText);
    if (pairs.length === 0)
      return { error: '인식된 쌍 없음. 형식: "송장번호   이름" (각 줄)' };

    // ── 매칭: 같은 이름이 여러 번 오면 순서대로 다른 행에 1:1 할당
    // 큐 소진 후 추가 송장이 오면 마지막 배정 행에 이어붙임(append)
    var matches = [],
      unmatched = [];
    var lastRowForName = {}; // 이름별 마지막 배정 행 인덱스

    for (var pi = 0; pi < pairs.length; pi++) {
      var p = pairs[pi];
      var assignedRow = -1;
      var matchedName = p.name;
      var isAppend = false;

      // ① 완전 일치 큐 탐색
      if (rowQueue[p.name] && rowQueue[p.name].length > 0) {
        assignedRow = rowQueue[p.name].shift();
        lastRowForName[p.name] = assignedRow;

        // ② 큐 소진 → 마지막 배정 행에 이어붙이기
      } else if (lastRowForName[p.name] !== undefined) {
        assignedRow = lastRowForName[p.name];
        matchedName = p.name;
        isAppend = true;

        // ③ 부분 일치 큐 탐색
      } else {
        for (var nm in rowQueue) {
          if (
            rowQueue[nm].length > 0 &&
            (nm.indexOf(p.name) !== -1 || p.name.indexOf(nm) !== -1)
          ) {
            matchedName = nm;
            assignedRow = rowQueue[nm].shift();
            lastRowForName[nm] = assignedRow;
            lastRowForName[p.name] = assignedRow; // 원래 이름으로도 등록
            break;
          }
        }
        // ④ 부분 일치도 큐 소진 → 마지막 배정 행 이어붙이기
        if (assignedRow === -1) {
          for (var nm2 in lastRowForName) {
            if (nm2.indexOf(p.name) !== -1 || p.name.indexOf(nm2) !== -1) {
              assignedRow = lastRowForName[nm2];
              matchedName = nm2;
              isAppend = true;
              break;
            }
          }
        }
      }

      if (assignedRow !== -1) {
        matches.push({
          tracking: p.tracking,
          name: p.name,
          matchedName: matchedName,
          rows: [assignedRow],
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
    };
  } catch (e) {
    return { error: e.message };
  }
}

/** HTML → 실제 전용양식 A열 기입 */
function applyInvoiceMatches(fileId, matchesJson) {
  try {
    var matches = JSON.parse(matchesJson);
    var ss = SpreadsheetApp.openById(fileId);
    var exTab = null;
    var allTabs = ss.getSheets();
    for (var ti = 0; ti < allTabs.length; ti++) {
      if (allTabs[ti].getName().indexOf("전용양식") !== -1) {
        exTab = allTabs[ti];
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
          var existing = String(data[idx][0] || "").trim();
          if (m.append && existing) {
            data[idx][0] = existing + "\n" + String(m.tracking); // 이어붙이기
          } else {
            data[idx][0] = String(m.tracking); // 신규 기입
          }
          data[idx][1] = "발송완료"; // B열: 적요
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
  var axVals = tab.getRange(2, 50, tab.getLastRow(), 1).getValues();
  for (var i = 0; i < axVals.length; i++) {
    var uid = _pep_normalizeAxUid_(axVals[i][0]);
    if (!uid) continue;
    counts[uid] = (counts[uid] || 0) + 1;
  }
  return counts;
}

/** 전용양식 중복 방지 키: 고유ID|품목코드 (동일 UID·다른 품목은 별도 건) */
function _pep_dedupKey_(uid, code) {
  var u = _pep_normalizeAxUid_(uid);
  var c = String(code || "").replace(/\s/g, "").trim();
  if (!u) return "";
  return c ? u + "|" + c : u;
}

/** AX(50열)+업체품목코드 열 기준 dedup 건수 (UID|코드 복합키) */
function _pep_loadExclusiveDedupCounts_(tab, directMap) {
  var counts = {};
  if (!tab || tab.getLastRow() < 2) return counts;
  var lr = tab.getLastRow();
  var skuCol0 =
    directMap && directMap.vendorSkuCol != null ? directMap.vendorSkuCol : -1;
  var readCols = Math.max(50, skuCol0 >= 0 ? skuCol0 + 1 : 50);
  var vals = tab.getRange(2, 1, lr - 1, readCols).getValues();
  for (var i = 0; i < vals.length; i++) {
    var axUid = vals[i][49];
    var axCode = skuCol0 >= 0 ? String(vals[i][skuCol0] || "").trim() : "";
    var key = _pep_dedupKey_(axUid, axCode);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
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
  var vals = tab.getRange(2, 1, tab.getLastRow(), lastCol).getValues();
  for (var i = 0; i < vals.length; i++) {
    var uid = String(vals[i][15] || "").trim();
    var code = String(vals[i][3] || "").trim();
    var name = String(vals[i][_PEP_ITEM_COL] || "").trim();
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
      // ① 팩투유상품코드로 인덱싱
      result.byPfxCode[pfx + "_" + code] = entry;
      if (!result.byCode[code]) result.byCode[code] = entry;
      // ② 업체상품코드(SKU)로도 역방향 인덱싱 ← 소스탭이 업체코드를 사용하는 경우 매칭
      if (sku) {
        var skuPfx = pfx || sku.substring(0, 2).toUpperCase();
        if (!result.byPfxCode[skuPfx + "_" + sku])
          result.byPfxCode[skuPfx + "_" + sku] = entry;
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
function partnerPushOrdersToExclusiveForms(silent) {
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

  // ★ 비협력업체 임시탭 준비 (대리공급_임시기록)
  var _hubSS_ = SpreadsheetApp.getActiveSpreadsheet();
  var _tempTab_ = _pep_ensureNonPartnerTempTab_(_hubSS_);
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

    var codePfx =
      rawCode.length >= 2 ? rawCode.substring(0, 2).toUpperCase() : "";
    var namePfx = "";
    var m = rawName.match(/([a-zA-Z]{2})/);
    if (m) namePfx = m[1].toUpperCase();

    var pfx = "";
    if (codePfx && _PEP_VENDOR_DIRECT_MAP_[codePfx]) {
      pfx = codePfx;
    } else if (namePfx && _PEP_VENDOR_DIRECT_MAP_[namePfx]) {
      pfx = namePfx;
    } else if (codePfx) {
      pfx = codePfx;
    } else if (namePfx) {
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
      if (_fpKeyT_ && _fpOccT_ <= _fpCntT_) {
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

    // ★ 전용양식 중복 방지: UID|품목코드 복합키 — 동일 UID·다른 품목은 각각 Push
    var _dedupCode_ = vendorSku || rawCode;
    var _dedupKey_ = _pep_dedupKey_(_rowUid_, _dedupCode_);
    _dedupOccurrenceInRun_[_dedupKey_] =
      (_dedupOccurrenceInRun_[_dedupKey_] || 0) + 1;
    var _dedupOccurrence_ = _dedupOccurrenceInRun_[_dedupKey_];
    var _existingDedupCount_ =
      (cache[pfx].existingDedupCounts &&
        cache[pfx].existingDedupCounts[_dedupKey_]) ||
      0;
    if (_dedupOccurrence_ <= _existingDedupCount_) {
      skipUid++;
      continue; // 이미 발주된 UID|품목 → 스킵
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
    // ★ BW(부원) 전용: 상품명(G열) = "품목명 수량개---박스수박스"
    //   예: "BW 사출 냉면 중 200개 1개---1박스"
    if (pfx === "BW" && effNameCol != null) {
      var bwName =
        outRow[effNameCol] || String(row[_PEP_ITEM_COL] || "").trim();
      var bwQty = String(row[6] || "").trim(); // G열(수량/개수)
      var bwBox = String(row[5] || "").trim(); // F열(택배박스수량)
      var bwParts = [];
      if (bwName) bwParts.push(bwName);
      if (bwQty) bwParts.push(bwQty + "개");
      var bwCombined = bwParts.join(" ");
      if (bwBox) {
        bwCombined += "---" + bwBox + "박스";
      }
      outRow[effNameCol] = bwCombined;
    }

    // HR(뉴파츠): 30열 양식에서는 택배수량 열이 없으므로 별도 복사 불필요

    // A(0) 강제 비워둠 — 송장번호는 업체 직접 기입 (전 업체 공통)
    outRow[0] = ""; // 송장번호: 업체 직접 기입
    // B(1) 적요 — 기존 용도 유지 (고유ID는 AX열에 별도 기입)
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
  "", // V(21)
  "업체prefix", // W(22) ← append
  "송장번호", // X(23) ← 수집 시 기록
  "진행상태", // Y(24) ← 발주완료 또는 송장수집 기입
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
  try {
    partnerPushOrdersToExclusiveForms(true);
  } catch (e) {
    try {
      Logger.log("[PARTNER_EXCL_PUSH_ERR] " + String(e.message || e));
    } catch (_) {}
  }
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
    var tabs = ss.getSheets();
    var tab = null;
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) {
        tab = tabs[ti];
        break;
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

    // ★ 헤더 열 수 정합성 보정: directMap.totalCols와 실제 헤더 열 수가 다르면 보정
    try {
      var expectedHeaders = _PEP_EXCLUSIVE_FORM_HEADERS_[pfx];
      if (expectedHeaders) {
        var expectedCols = expectedHeaders.length;
        var maxC = tab.getMaxColumns();
        // ★ AX열(50번째 열)에 고유ID 기록하므로 최소 50열 확보
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
    // ★ 전용양식 AX(50열)+품목코드 — UID|코드 복합키별 건수
    var existingDedupCounts = _pep_loadExclusiveDedupCounts_(tab, directMap);
    Logger.log(
      "[PEP] " + pfx +
      " 전용양식 dedup키=" + Object.keys(existingDedupCounts).length + "종 (tab.getLastRow=" + tab.getLastRow() + ")",
    );
    return {
      ss: ss,
      tab: tab,
      nextSeq: nextSeq,
      newpartsMap: newpartsMap,
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
  // AP: 올팩 — 19열
  AP: [
    "송장번호",
    "적요",
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
  // HR: 뉴파츠_NEW — A=송장번호, B=적요(공통) + C~AF=30열 이카운트 구매발주 업로드 양식 = 총 32열
  HR: [
    "송장번호",
    "적요",
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
    "적요",
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
    "적요",
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
    "적요",
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
    "적요",
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
  // BW: 부원 — 18열
  BW: [
    "송장번호",
    "적요",
    "받는사람",
    "전화번호",
    "주소",
    "우편번호",
    "상품명",
    "a 사용 X",
    "B 2570",
    "C 2920",
    "D 4170",
    "E 5170",
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
    "적요",
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
    "적요",
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
    "적요",
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
    "적요",
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

        var pfx2 = "";
        if (code.length >= 2) {
          pfx2 = code.substring(0, 2).toUpperCase();
        } else {
          var m = name.match(/([a-zA-Z]{2})/);
          if (m) pfx2 = m[1].toUpperCase();
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
};

// ─────────────────────────────────────────────────────
//  업체별 소스→전용양식 열 매핑 (orderSyncManager.gs VENDOR_DIRECT_COLUMN_MAP_ 이식)
//  directMap: Push 시 소스 행 → 전용양식 행 변환에 사용
// ─────────────────────────────────────────────────────
var _PEP_VENDOR_DIRECT_MAP_ = {
  HR: {
    // 뉴파츠 — A=송장번호, B=적요(공통) + C~AF=30열 이카운트 구매발주 업로드 = 총 32열
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
    vendorSkuCol: 7,
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
    // 부원 — 18열
    totalCols: 18,
    phoneTargetCols: [3, 17], // D(전화번호), R(전화)
    vendorNameCol: 6, // G열(상품명) — 별칭 테이블의 업체 품목명으로 덮어쓰기
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(주소)" },
      { sourceCol: 4, targetCol: 6, label: "E(품목명)→G(상품명)" },
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
  LG: {
    // 로엔그린 — 19열
    totalCols: 19,
    phoneTargetCols: [2, 7], // C(전화번호1-보내는), H(전화번호1-받는)
    sourceToTarget: [
      { sourceCol: 16, targetCol: 1, label: "Q(보내는분)→B(보내는사람)" },
      {
        sourceCol: 17,
        targetCol: 2,
        label: "R(보내는분전화)→C(전화번호1-지정)",
      },
      { sourceCol: 18, targetCol: 5, label: "S(보내는분주소)→F(주소-지정)" },
      { sourceCol: 12, targetCol: 6, label: "M(거래처명)→G(받는사람)" },
      { sourceCol: 8, targetCol: 7, label: "I(모바일)→H(전화번호1)" },
      { sourceCol: 9, targetCol: 10, label: "J(주소1)→K(주소)" },
      { sourceCol: 4, targetCol: 11, label: "E(품목명)→L(상품명1)" },
      { sourceCol: 6, targetCol: 13, label: "G(수량)→N(수량)" },
      { sourceCol: 10, targetCol: 14, label: "K(배송메세지)→O(배송메시지)" },
    ],
  },
  JM: {
    // 제이엠
    // A(0):송장번호, B(1):적요
    // C(2):수화주전화1, D(3):수화주전화2, E(4):수화주명, F(5):주소,
    // G(6):수량, H(7):품명, I(8):포장, J(9):운임구분, K(10):운송상품,
    // L(11):우편번호, M(12):도착영업소, N(13):발화주명, O(14):발화주전화번호,
    // P(15):총운임, Q(16):특기사항
    totalCols: 17,
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
  // A열(송장번호), B열(적요) 강조 — 업체 입력 영역
  tab
    .getRange("A1")
    .setValue("송장번호")
    .setBackground("#e06c75")
    .setFontColor("#ffffff");
  tab
    .getRange("B1")
    .setValue("적요")
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

  // 9) A열(송장번호) 기입
  var writeCount = 0;
  for (var wi = 0; wi < matched.length; wi++) {
    var wm = matched[wi];
    for (var wri = 0; wri < wm.rows.length; wri++) {
      data[wm.rows[wri]][0] = String(wm.tracking);
      writeCount++;
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
 * ── 텍스트 파서: (송장번호, 이름) 쌍 추출 ──
 * 10~14자리 숫자 = 송장번호, 한글/영문 텍스트 = 이름
 */
function _pep_parseInvoiceNamePairs_(text) {
  // 줄 분리
  var lines = text
    .split(/[\r\n]+/)
    .map(function (l) {
      return l.replace(/\t/g, "   ").trim();
    })
    .filter(function (l) {
      return l.length > 0;
    });

  var pairs = [];
  var pendingTracking = null; // 번호만 있는 줄이 앞에 왔을 때 대기

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // ★ 헬퍼: 하이픈 포함 송장번호에서 순수 숫자 추출 + 10~14자리 검증
    function _extractTracking(raw) {
      var digits = raw.replace(/[\-\s]/g, "");
      if (/^\d{10,14}$/.test(digits)) return digits;
      return null;
    }

    // ① 한 줄에 "송장번호(숫자/하이픈)  이름" 형태 (가장 흔한 카카오 포맷)
    var m1 = line.match(/^([\d\-]{10,20})\s{1,}(.+)$/);
    if (m1) {
      var t1 = _extractTracking(m1[1]);
      var name1 = m1[2].trim();
      if (t1 && name1.length >= 1) {
        pairs.push({ tracking: t1, name: name1 });
        pendingTracking = null;
        continue;
      }
    }

    // ② 한 줄에 "이름  송장번호(숫자/하이픈)" 형태
    var m2 = line.match(/^(.+?)\s{1,}([\d\-]{10,20})$/);
    if (m2) {
      var t2 = _extractTracking(m2[2]);
      var name2 = m2[1].trim();
      if (t2 && name2.length >= 1 && !/^[\d\-]+$/.test(name2)) {
        pairs.push({ tracking: t2, name: name2 });
        pendingTracking = null;
        continue;
      }
    }

    // ③ 번호만 있는 줄 (하이픈 포함 허용)
    var soloTracking = _extractTracking(line);
    if (soloTracking && /^[\d\-]+$/.test(line.trim())) {
      if (pendingTracking !== null) {
        // 번호가 연속으로 두 개 → 이전 번호는 미매칭으로 버림
      }
      pendingTracking = soloTracking;
      continue;
    }

    // ④ 이름만 있는 줄 (앞에 번호가 대기 중이면 쌍으로)
    var isName = line.length >= 1 && !/^[\d\-]+$/.test(line);
    if (isName) {
      if (pendingTracking !== null) {
        pairs.push({ tracking: pendingTracking, name: line });
        pendingTracking = null;
      }
      // 번호 대기 없으면 무시 (이름만 있는 줄)
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
      "🔄 오후 재Push (전체 초기화 후 재발주)",
      "▸ 전용양식 탭 데이터(2행~) 전부 삭제 — AX 기존 UID 초기화\n" +
      "▸ 소스 탭 P열(고유ID) 초기화 — 새 UID 재생성 허용\n" +
      "▸ 대리공급업체로 발주 Push 실행\n\n" +
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
  Logger.log("[AfternoonReset] 전용양식 초기화: " + clearedTabs + "탭, P열 초기화: " + pCleared + "건");

  // 3) Push 실행
  partnerPushOrdersToExclusiveForms();
}

/**
 * ── 별칭맵 진단 (메뉴 실행용) ──
 * 누적품목매핑 로드 상태, 코드 목록, 단가 확인
 */
function diagnosePepAliasMap() {
  var ui = SpreadsheetApp.getUi();
  var lines = ["📋 별칭맵 진단 결과\n"];

  // 1) HUB 연결 확인
  try {
    var props = PropertiesService.getScriptProperties();
    var hubId = props.getProperty("DB_HUB_ID");
    if (!hubId) {
      lines.push("❌ DB_HUB_ID 없음 → HUB 미연결");
    } else {
      lines.push("✅ HUB ID: " + hubId.substring(0, 20) + "...");
      var hubSS = SpreadsheetApp.openById(hubId);
      var hubTab = hubSS.getSheetByName(_PEP_HUB_ALIAS_TAB_NAME);
      if (!hubTab) {
        lines.push(
          "❌ HUB에 「" + _PEP_HUB_ALIAS_TAB_NAME + "」탭 없음 → 외부시트 폴백",
        );
      } else {
        lines.push(
          "✅ HUB 탭 발견: " +
            _PEP_HUB_ALIAS_TAB_NAME +
            " (" +
            (hubTab.getLastRow() - 1) +
            "행)",
        );
        var hdr = hubTab
          .getRange(1, 1, 1, hubTab.getLastColumn())
          .getValues()[0];
        lines.push("   헤더: " + hdr.join(" | "));

        // ★ 열 감지 현황 확인
        var colInfo = [];
        for (var ci = 0; ci < hdr.length; ci++) {
          var ch = String(hdr[ci] || "")
            .replace(/\s/g, "")
            .toLowerCase();
          if (
            ch.indexOf("포함가") !== -1 ||
            (ch.indexOf("단가") !== -1 && ch.indexOf("vat") !== -1)
          ) {
            colInfo.push("VAT포함가열=" + (ci + 1) + "열(" + hdr[ci] + ")");
          }
          if (ch === "단가") colInfo.push("단가열=" + (ci + 1) + "열");
          if (ch === "부가세") colInfo.push("부가세열=" + (ci + 1) + "열");
        }
        if (colInfo.length > 0)
          lines.push("   감지된 단가열: " + colInfo.join(", "));
        else lines.push("   ⚠️ VAT포함가/단가 열 미감지");
      }
    }
  } catch (eHub) {
    lines.push("❌ HUB 접근 오류: " + eHub.message);
  }

  // 2) 별칭맵 로드
  var aliasMap = _pep_loadAliasMap_();
  var codeKeys = Object.keys(aliasMap.byCode);
  lines.push("\n로드된 코드 수: " + codeKeys.length + "건");

  // ★ HR 코드 먼저, 없으면 전체에서
  var hrKeys = codeKeys.filter(function (k) {
    return k.substring(0, 2) === "HR";
  });
  lines.push("HR(뉴파츠) 코드: " + hrKeys.length + "건");

  var sampleKeys =
    hrKeys.length > 0 ? hrKeys.slice(0, 5) : codeKeys.slice(0, 3);
  if (sampleKeys.length > 0) {
    lines.push("\n【HR 샘플 (최대5개)】");
    for (var i = 0; i < sampleKeys.length; i++) {
      var k = sampleKeys[i];
      var e = aliasMap.byCode[k];
      var priceStatus =
        e.priceVat > 0
          ? "✅ " + e.priceVat
          : e.price > 0
            ? "⚠️ 단가만: " + e.price
            : "❌ 없음";
      lines.push(
        "  " +
          k +
          " → " +
          (e.name || "(이름없음)") +
          "\n    단가(E):" +
          (e.price || 0) +
          " 부가세(F):" +
          (e.vat || 0) +
          " VAT포함가(G):" +
          (e.priceVat || 0) +
          " " +
          priceStatus,
      );
    }
  }

  ui.alert(lines.join("\n"));
}
