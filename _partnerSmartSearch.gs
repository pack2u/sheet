/**
 * [협력업체] 스마트 검색 시스템  v1.0
 * 파일: _partnerSmartSearch.gs
 *
 * 고유ID / 수취인명 / 송장번호로 전체 시스템을 검색하여
 * 허브 → 발주탭 → 마감탭 → 전용양식의 이력을 추적합니다.
 *
 * ★ 2026-06-13 신규 생성
 */

// ═══════════════════════════════════════════
//  사이드바 열기
// ═══════════════════════════════════════════

/** 메뉴에서 호출: 스마트 검색 사이드바 열기 */
function partnerOpenSmartSearch() {
  var html = HtmlService.createHtmlOutputFromFile("smartSearchSidebar")
    .setTitle("🔍 스마트 검색")
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ═══════════════════════════════════════════
//  HTML → 서버: 검색 실행
// ═══════════════════════════════════════════

/**
 * HTML 사이드바에서 호출하는 메인 검색 함수
 * @param {string} query - 검색어 (고유ID, 수취인명, 송장번호)
 * @returns {{ results: Array, elapsed: number }}
 */
function partnerSmartSearch(query) {
  var startMs = new Date().getTime();
  var q = String(query || "").trim();
  if (!q) return { results: [], elapsed: 0 };

  var qLower = q.toLowerCase().replace(/\s/g, "");
  var results = [];

  // ── 1. 허브 검색 ──
  try {
    var hubResults = _ss_searchHub_(qLower, q);
    for (var i = 0; i < hubResults.length; i++) results.push(hubResults[i]);
  } catch (e) {
    Logger.log("[SmartSearch] 허브 검색 오류: " + e.message);
  }

  // ── 2. 각 업체 발주탭 + 마감탭 + 전용양식 검색 ──
  try {
    var files = _pt_listFiles();
    for (var fi = 0; fi < files.length; fi++) {
      try {
        var vendorResults = _ss_searchVendorFile_(files[fi], qLower, q);
        for (var j = 0; j < vendorResults.length; j++) results.push(vendorResults[j]);
      } catch (e2) {
        Logger.log("[SmartSearch] " + files[fi].name + " 검색 오류: " + e2.message);
      }
    }
  } catch (e3) {
    Logger.log("[SmartSearch] 파일 목록 조회 오류: " + e3.message);
  }

  // ── 3. 타임라인 빌드 (같은 UID의 결과 병합) ──
  _ss_buildTimelines_(results);

  var elapsed = Math.round((new Date().getTime() - startMs) / 1000 * 10) / 10;
  return { results: results, elapsed: elapsed };
}

// ═══════════════════════════════════════════
//  허브 검색
// ═══════════════════════════════════════════

function _ss_searchHub_(qLower, qRaw) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubTab = ss.getSheetByName("협력업체_발주허브");
  if (!hubTab) return [];

  var lr = hubTab.getLastRow();
  if (lr < 2) return [];
  var lc = hubTab.getLastColumn();
  var data = hubTab.getRange(1, 1, lr, lc).getValues();
  var headers = data[0];

  var cMap = _ss_mapHeaders_(headers);
  var out = [];

  for (var r = 1; r < data.length; r++) {
    if (_ss_rowMatches_(data[r], cMap, qLower, qRaw)) {
      out.push(_ss_buildResult_(data[r], cMap, "hub", "상품정보시트", "협력업체_발주허브"));
      if (out.length >= 50) break; // 최대 50건
    }
  }
  return out;
}

// ═══════════════════════════════════════════
//  업체 파일 검색 (발주탭 + 마감탭 + 전용양식)
// ═══════════════════════════════════════════

function _ss_searchVendorFile_(fileInfo, qLower, qRaw) {
  var ss = SpreadsheetApp.openById(fileInfo.id);
  var vendorName = String(fileInfo.name).replace("[협력업체] ", "").trim();
  var allTabs = ss.getSheets();
  var out = [];

  for (var ti = 0; ti < allTabs.length; ti++) {
    var tab = allTabs[ti];
    var tabName = tab.getName();
    var type = _ss_classifyTab_(tabName);
    if (!type) continue;

    var lr = tab.getLastRow();
    var headerRow = type === "archive" ? 4 : 1;
    if (lr < headerRow + 1) continue;

    var lc = tab.getLastColumn();
    if (lc < 3) continue;

    var data = tab.getRange(1, 1, lr, lc).getValues();
    var headers = data[headerRow - 1];
    var cMap = _ss_mapHeaders_(headers);

    var dataStart = type === "archive" ? 4 : 1; // 0-indexed
    for (var r = dataStart; r < data.length; r++) {
      if (_ss_rowMatches_(data[r], cMap, qLower, qRaw)) {
        out.push(_ss_buildResult_(data[r], cMap, type, vendorName, tabName));
        if (out.length >= 30) break; // 업체당 최대 30건
      }
    }
    if (out.length >= 30) break;
  }
  return out;
}

// ═══════════════════════════════════════════
//  탭 분류
// ═══════════════════════════════════════════

function _ss_classifyTab_(tabName) {
  if (/발주.*송장|발주.*조회/.test(tabName) && tabName.indexOf("마감") === -1) return "order";
  if (/\(\d{4}년\s?\d{1,2}월\)\s?발주\s?마감/.test(tabName)) return "archive";
  if (/전용양식|전용발주/.test(tabName) && tabName.indexOf("마감") === -1) return "exclusive";
  return null;
}

// ═══════════════════════════════════════════
//  헤더 매핑 (통합)
// ═══════════════════════════════════════════

function _ss_mapHeaders_(headers) {
  var m = {
    uid: -1, date: -1, code: -1, itemName: -1, qty: -1,
    price: -1, recipient: -1, phone: -1, address: -1,
    invoice: -1, status: -1, cancel: -1, returnC: -1, reason: -1
  };

  var KEYWORDS = {
    uid:       ["고유id", "uid", "고유번호"],
    date:      ["주문일자", "yyyymmdd", "일자", "발주일"],
    code:      ["이카운트코드", "아카운트코드", "ecount", "상품코드", "품목코드"],
    itemName:  ["품목명", "상품명", "품명"],
    qty:       ["수량", "발주수량"],
    price:     ["정산금액", "확정단가", "단가", "공급가", "금액"],
    recipient: ["수취인", "받는분", "수령인", "고객명"],
    phone:     ["전화", "연락처", "hp", "핸드폰", "수취인전화"],
    address:   ["주소", "배송지"],
    invoice:   ["송장", "운송장", "택배번호", "invoice"],
    status:    ["상태", "처리상태", "배송상태"],
    cancel:    ["취소"],
    returnC:   ["반품"],
    reason:    ["취소반품사유", "사유"]
  };

  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (!h) continue;
    for (var key in KEYWORDS) {
      if (m[key] !== -1) continue;
      var kws = KEYWORDS[key];
      for (var k = 0; k < kws.length; k++) {
        if (h.indexOf(kws[k]) !== -1) { m[key] = i; break; }
      }
    }
  }
  return m;
}

// ═══════════════════════════════════════════
//  행 매칭 (고유ID, 수취인, 송장번호)
// ═══════════════════════════════════════════

function _ss_rowMatches_(row, cMap, qLower, qRaw) {
  // 빈 행 스킵
  var hasAny = false;
  for (var i = 0; i < Math.min(row.length, 5); i++) {
    if (row[i] !== "" && row[i] !== null && row[i] !== undefined) { hasAny = true; break; }
  }
  if (!hasAny) return false;

  // 고유ID 매칭
  if (cMap.uid !== -1) {
    var uid = String(row[cMap.uid] || "").trim().toLowerCase();
    if (uid && uid.indexOf(qLower) !== -1) return true;
  }

  // 수취인명 매칭
  if (cMap.recipient !== -1) {
    var recip = String(row[cMap.recipient] || "").trim().toLowerCase().replace(/\s/g, "");
    if (recip && recip.indexOf(qLower) !== -1) return true;
  }

  // 송장번호 매칭
  if (cMap.invoice !== -1) {
    var inv = String(row[cMap.invoice] || "").trim().replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    var qClean = qRaw.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    if (inv && qClean && inv.indexOf(qClean) !== -1) return true;
  }

  // 전화번호 뒤 4자리 매칭
  if (cMap.phone !== -1 && qRaw.length === 4 && /^\d{4}$/.test(qRaw)) {
    var phone = String(row[cMap.phone] || "").replace(/[^0-9]/g, "");
    if (phone.length >= 4 && phone.slice(-4) === qRaw) return true;
  }

  return false;
}

// ═══════════════════════════════════════════
//  결과 객체 빌드
// ═══════════════════════════════════════════

function _ss_buildResult_(row, cMap, type, vendorName, tabName) {
  var dateVal = cMap.date !== -1 ? row[cMap.date] : null;
  var dateStr = "";
  if (dateVal) {
    try { dateStr = _pms_parseDateStr_(dateVal) || String(dateVal); } catch (e) { dateStr = String(dateVal); }
  }

  var cancelVal = cMap.cancel !== -1 ? row[cMap.cancel] : false;
  var returnVal = cMap.returnC !== -1 ? row[cMap.returnC] : false;

  return {
    type: type,
    uid: cMap.uid !== -1 ? String(row[cMap.uid] || "").trim() : "",
    date: dateStr,
    code: cMap.code !== -1 ? String(row[cMap.code] || "").trim() : "",
    itemName: cMap.itemName !== -1 ? String(row[cMap.itemName] || "").trim() : "",
    qty: cMap.qty !== -1 ? (Number(row[cMap.qty]) || 0) : 0,
    price: cMap.price !== -1 ? (Number(row[cMap.price]) || 0) : 0,
    recipient: cMap.recipient !== -1 ? String(row[cMap.recipient] || "").trim() : "",
    phone: cMap.phone !== -1 ? String(row[cMap.phone] || "").trim() : "",
    invoice: cMap.invoice !== -1 ? String(row[cMap.invoice] || "").trim() : "",
    status: cMap.status !== -1 ? String(row[cMap.status] || "").trim() : "",
    cancel: cancelVal === true,
    returnC: returnVal === true,
    reason: cMap.reason !== -1 ? String(row[cMap.reason] || "").trim() : "",
    vendorName: vendorName,
    tabName: tabName,
    timeline: [] // 아래 _ss_buildTimelines_에서 채워짐
  };
}

// ═══════════════════════════════════════════
//  타임라인 빌드 — 같은 UID를 가진 결과들의 이력 추적
// ═══════════════════════════════════════════

function _ss_buildTimelines_(results) {
  // UID별 그룹화
  var uidMap = {};
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (!r.uid) continue;
    if (!uidMap[r.uid]) uidMap[r.uid] = [];
    uidMap[r.uid].push(r);
  }

  // 각 그룹에 타임라인 데이터 설정
  for (var uid in uidMap) {
    if (!uidMap.hasOwnProperty(uid)) continue;
    var group = uidMap[uid];
    if (group.length < 2) continue;

    // 타입 순서: hub → order → exclusive → archive
    var typeOrder = { hub: 0, order: 1, exclusive: 2, archive: 3 };
    group.sort(function (a, b) {
      return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
    });

    var timeline = [];
    for (var g = 0; g < group.length; g++) {
      var item = group[g];
      var actionLabel = {
        hub: "📦 허브 등록",
        order: "📋 발주탭 수집",
        exclusive: "📮 전용양식 Push",
        archive: "📁 마감탭 이동"
      }[item.type] || item.type;

      timeline.push({
        date: item.date || "—",
        action: actionLabel + " (" + item.vendorName + ")"
      });

      if (item.invoice) {
        timeline.push({
          date: "",
          action: "🚚 송장입력: " + item.invoice
        });
      }
      if (item.cancel) {
        timeline.push({ date: "", action: "🚫 취소 처리" });
      }
      if (item.returnC) {
        timeline.push({ date: "", action: "↩️ 반품 처리" });
      }
    }

    // 모든 그룹 멤버에게 같은 타임라인 할당
    for (var g2 = 0; g2 < group.length; g2++) {
      group[g2].timeline = timeline;
    }
  }
}
