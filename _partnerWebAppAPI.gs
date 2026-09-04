/**
 * [협력업체] 웹앱 API 엔드포인트
 * 파일: _partnerWebAppAPI.gs
 *
 * ★ 2026-07-01: 웹앱 대시보드 연동을 위한 JSON API
 * Next.js 웹앱에서 호출하여 허브 시트 데이터를 실시간 조회
 *
 * 배포: GAS 웹앱 > 새 배포 > 웹 앱 > "나"로 실행, "모든 사용자" 접근
 */

// ═══════════════════════════════════════════
//  doGet — 웹앱 API 라우터
// ═══════════════════════════════════════════

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "dashboard";
  var result;

  try {
    switch (action) {
      case "dashboard":
        result = _api_getDashboard_();
        break;
      case "orders":
        result = _api_getOrders_(e.parameter);
        break;
      case "vendors":
        result = _api_getVendors_();
        break;
      case "stats":
        result = _api_getStats_(e.parameter);
        break;

      // ★ 2026-07-01: DB 기반 상품 검색 API (업체 시트 단가조회용)
      case "productSearch":
        result = _api_productSearch_(e.parameter);
        break;
      case "vendorProducts":
        result = _api_vendorProducts_(e.parameter);
        break;

      // ★ 2026-07-02: 웹앱 원격 실행 API
      case "run":
        result = _api_runTask_(e.parameter);
        break;

      // ★ 2026-07-03: 전용양식 Push 미리보기
      case "exclusivePreview":
        result = _api_exclusivePreview_();
        break;

      // ★ 2026-07-06: 파트너 시트 발주 직접 조회
      case "partnerOrders":
        result = _api_partnerOrders_(e.parameter);
        break;

      default:
        result = { error: "Unknown action: " + action };
    }
  } catch (err) {
    result = { error: String(err.message || err) };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


// ═══════════════════════════════════════════
//  대시보드 — 오늘 현황 요약
// ═══════════════════════════════════════════

function _api_getDashboard_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hub = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hub) return { error: "허브 시트를 찾을 수 없습니다" };

  var data = hub.getDataRange().getValues();
  var headers = data[0];
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");

  // 컬럼 인덱스 매핑
  var colIdx = {};
  for (var h = 0; h < headers.length; h++) {
    var hName = String(headers[h]).trim();
    if (hName === "수집일시") colIdx.collected = h;
    if (hName === "발주업체") colIdx.vendor = h;
    if (hName === "고유ID") colIdx.uid = h;
    if (hName === "주문일자") colIdx.orderDate = h;
    if (hName === "이카운트코드") colIdx.code = h;
    if (hName === "품목명") colIdx.item = h;
    if (hName === "수량") colIdx.qty = h;
    if (hName === "수취인") colIdx.recipient = h;
    if (hName === "수취인전화번호") colIdx.phone = h;
    if (hName === "수취인주소") colIdx.address = h;
    if (hName === "송출메시지") colIdx.message = h;
    if (hName === "정산금액") colIdx.price = h;
    if (hName === "적요") colIdx.note = h;
    if (hName === "송장번호") colIdx.invoice = h;
    if (hName === "상태") colIdx.status = h;
  }

  var todayOrders = 0;
  var totalOrders = data.length - 1;
  var pendingInvoices = 0;
  var vendorSet = {};
  var recentOrders = [];
  var vendorCounts = {};

  for (var r = data.length - 1; r >= 1; r--) {
    var row = data[r];
    var vendor = String(row[colIdx.vendor] || "").trim();
    var status = String(row[colIdx.status] || "").trim();
    var invoice = String(row[colIdx.invoice] || "").trim();
    var collected = row[colIdx.collected];

    if (vendor) vendorSet[vendor] = true;

    // 업체별 카운트
    if (!vendorCounts[vendor]) vendorCounts[vendor] = 0;
    vendorCounts[vendor]++;

    // 오늘 발주 체크
    var orderDate = String(row[colIdx.orderDate] || "").trim();
    if (orderDate === today) todayOrders++;

    // 송장 미매칭
    if (!invoice && status !== "🚨코드오류" && status !== "🚨단종") {
      pendingInvoices++;
    }

    // 최근 50건
    if (recentOrders.length < 50) {
      recentOrders.push({
        collected_at: collected ? new Date(collected).toISOString() : "",
        vendor_name: vendor,
        unique_id: String(row[colIdx.uid] || ""),
        order_date: orderDate,
        ecount_code: String(row[colIdx.code] || ""),
        item_name: String(row[colIdx.item] || ""),
        qty: Number(row[colIdx.qty]) || 1,
        recipient: String(row[colIdx.recipient] || ""),
        phone: String(row[colIdx.phone] || ""),
        address: String(row[colIdx.address] || ""),
        message: String(row[colIdx.message] || ""),
        unit_price: Number(row[colIdx.price]) || 0,
        note: String(row[colIdx.note] || ""),
        invoice_no: invoice,
        status: status,
      });
    }
  }

  // 업체별 발주수 TOP10
  var vendorRanking = Object.keys(vendorCounts)
    .map(function (v) { return { name: v, count: vendorCounts[v] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 10);

  return {
    todayOrders: todayOrders,
    totalOrders: totalOrders,
    pendingInvoices: pendingInvoices,
    activeVendors: Object.keys(vendorSet).length,
    recentOrders: recentOrders,
    vendorRanking: vendorRanking,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════
//  발주 목록 (페이징 + 필터)
// ═══════════════════════════════════════════

function _api_getOrders_(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hub = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hub) return { error: "허브 시트를 찾을 수 없습니다" };

  var data = hub.getDataRange().getValues();
  var headers = data[0];
  var limit = Math.min(parseInt(params.limit) || 100, 500);
  var offset = parseInt(params.offset) || 0;
  var vendor = params.vendor || "";
  var status = params.status || "";
  var search = (params.search || "").toLowerCase();

  // 컬럼 인덱스
  var colIdx = {};
  for (var h = 0; h < headers.length; h++) {
    var hName = String(headers[h]).trim();
    colIdx[hName] = h;
  }

  var orders = [];
  for (var r = data.length - 1; r >= 1; r--) {
    var row = data[r];
    var vName = String(row[colIdx["발주업체"]] || "");
    var st = String(row[colIdx["상태"]] || "");

    if (vendor && vName !== vendor) continue;
    if (status && st !== status) continue;

    if (search) {
      var searchTarget = (vName + " " +
        String(row[colIdx["품목명"]] || "") + " " +
        String(row[colIdx["수취인"]] || "") + " " +
        String(row[colIdx["고유ID"]] || "")).toLowerCase();
      if (searchTarget.indexOf(search) === -1) continue;
    }

    orders.push({
      vendor_name: vName,
      unique_id: String(row[colIdx["고유ID"]] || ""),
      order_date: String(row[colIdx["주문일자"]] || ""),
      ecount_code: String(row[colIdx["이카운트코드"]] || ""),
      item_name: String(row[colIdx["품목명"]] || ""),
      qty: Number(row[colIdx["수량"]]) || 1,
      recipient: String(row[colIdx["수취인"]] || ""),
      phone: String(row[colIdx["수취인전화번호"]] || ""),
      unit_price: Number(row[colIdx["정산금액"]]) || 0,
      invoice_no: String(row[colIdx["송장번호"]] || ""),
      status: st,
    });
  }

  var total = orders.length;
  var paged = orders.slice(offset, offset + limit);

  return {
    orders: paged,
    total: total,
    limit: limit,
    offset: offset,
  };
}

// ═══════════════════════════════════════════
//  업체 목록
// ═══════════════════════════════════════════

function _api_getVendors_() {
  var files = _pt_listFiles();
  var vendors = [];

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var name = file.name
      .replace("[협력업체] ", "")
      .replace(/\s*\(소비자용\).*$/, "")
      .trim();

    vendors.push({
      name: name,
      sheet_id: file.id,
      is_consumer: file.name.indexOf("소비자용") !== -1,
      is_active: true,
    });
  }

  return { vendors: vendors, total: vendors.length };
}

// ═══════════════════════════════════════════
//  통계 (기간별)
// ═══════════════════════════════════════════

function _api_getStats_(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hub = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hub) return { error: "허브 시트를 찾을 수 없습니다" };

  var data = hub.getDataRange().getValues();
  var headers = data[0];

  var colIdx = {};
  for (var h = 0; h < headers.length; h++) {
    colIdx[String(headers[h]).trim()] = h;
  }

  var dailyCounts = {};
  var vendorTotals = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var date = String(row[colIdx["주문일자"]] || "").trim();
    var vendor = String(row[colIdx["발주업체"]] || "").trim();
    var price = Number(row[colIdx["정산금액"]]) || 0;

    if (date) {
      if (!dailyCounts[date]) dailyCounts[date] = 0;
      dailyCounts[date]++;
    }

    if (vendor) {
      if (!vendorTotals[vendor]) vendorTotals[vendor] = { count: 0, amount: 0 };
      vendorTotals[vendor].count++;
      vendorTotals[vendor].amount += price;
    }
  }

  return {
    dailyCounts: dailyCounts,
    vendorTotals: vendorTotals,
    totalRows: data.length - 1,
  };
}


// ═══════════════════════════════════════════
//  ★ DB 기반 상품 검색 API (업체 시트 단가조회용)
// ═══════════════════════════════════════════

/**
 * action=productSearch — 코드/품목명으로 DB 검색
 * 파라미터: q=검색어, limit=최대건수(기본20)
 */
function _api_productSearch_(params) {
  var q = (params && params.q) || "";
  if (!q) return { error: "검색어(q)를 입력하세요" };
  var limit = parseInt(params.limit) || 20;

  // 1. 코드 정확 매칭
  var results = _sb_get_("products_hub",
    "ecount_code=eq." + encodeURIComponent(q) +
    "&select=ecount_code,item_name,status,stock_qty,base_price,purchase_price,retail_price,hub_base_price,hub_future_price,warehouse,supplier,group_prices"
  );

  // 2. 없으면 품목명+코드 부분 검색
  if (!results || results.length === 0) {
    results = _sb_get_("products_hub",
      "or=(item_name.ilike.*" + encodeURIComponent(q) + "*,ecount_code.ilike.*" + encodeURIComponent(q) + "*)" +
      "&select=ecount_code,item_name,status,stock_qty,base_price,purchase_price,retail_price,hub_base_price,hub_future_price,warehouse,supplier,group_prices" +
      "&limit=" + limit + "&order=item_name"
    );
  }

  return { count: results ? results.length : 0, data: results || [] };
}

/**
 * action=vendorProducts — 특정 그룹의 전체 상품+단가 목록
 * 파라미터: group=그룹명, status=판매중(선택)
 * ★ 업체 시트 단가조회 탭 데이터 소스로 사용
 */
function _api_vendorProducts_(params) {
  var group = (params && params.group) || "";
  if (!group) return { error: "그룹명(group)을 입력하세요" };

  var statusFilter = (params && params.status) || "";
  var query = "select=ecount_code,item_name,status,stock_qty,hub_base_price,group_prices";
  if (statusFilter) {
    query += "&status=eq." + encodeURIComponent(statusFilter);
  }
  query += "&order=ecount_code&limit=5000";

  var all = _sb_get_("products_hub", query);
  if (!all || all.length === 0) return { count: 0, data: [] };

  // group_prices JSONB에서 해당 그룹 단가 추출
  var result = [];
  for (var i = 0; i < all.length; i++) {
    var item = all[i];
    var groupPrice = 0;

    if (item.group_prices && typeof item.group_prices === "object") {
      var keys = Object.keys(item.group_prices);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].indexOf(group) !== -1) {
          groupPrice = parseInt(item.group_prices[keys[k]]) || 0;
          break;
        }
      }
    }

    result.push({
      code: item.ecount_code,
      name: item.item_name,
      status: item.status,
      stock: item.stock_qty || 0,
      price: groupPrice || item.hub_base_price || 0
    });
  }

  return { group: group, count: result.length, data: result };
}

// ═══════════════════════════════════════════
//  ★ 2026-07-02: 웹앱 원격 실행 API
// ═══════════════════════════════════════════

/**
 * action=run — 웹앱에서 GAS 업무를 원격 실행
 * 파라미터: task=작업명, key=API 인증키
 * 
 * 지원 작업:
 *   collectOrders      — 1️⃣ 발주 수집
 *   fetchInvoices       — 5️⃣ 송장 수집
 *   pushInvoices        — 7️⃣ 송장 배포
 *   exclusivePush       — 3️⃣ 대리공급 Push
 *   syncDb              — 🔄 DB 동기화
 */
var _API_RUN_KEY_ = "pack2u_run_x7k9m2026";

function _api_runTask_(params) {
  var task = (params && params.task) || "";
  var secret = (params && params.key) || "";

  // ── 1. 인증 검증 ──
  if (secret !== _API_RUN_KEY_) {
    return { success: false, error: "인증 실패: 유효하지 않은 API 키" };
  }

  if (!task) {
    return { success: false, error: "task 파라미터가 누락되었습니다" };
  }

  // ── 2. 동시 실행 방지 (LockService) ──
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    return { success: false, error: "다른 작업이 실행 중입니다. 잠시 후 다시 시도하세요." };
  }

  var startTime = new Date();
  var result;

  try {
    // ★ 2026-07-02: 태스크별 함수 매핑
    // 웹앱(doGet)에서는 SpreadsheetApp.getActiveSpreadsheet()와
    // SpreadsheetApp.getUi()가 없으므로, toast/alert가 있는 함수는
    // noWriteBack=true 옵션으로 UI를 스킵하거나
    // try-catch로 UI 관련 에러를 무시합니다.
    var taskMap = {
      collectOrders:  { label: "발주 수집",      fn: function() { partnerCollectOrders(true); } },
      fetchInvoices:  { label: "송장 수집",      fn: function() { partnerFetchInvoices(); } },
      pushInvoices:   { label: "송장 배포",      fn: function() { partnerPushInvoices(); } },
      exclusivePush:  { label: "대리공급 Push",  fn: function() { partnerPushOrdersToExclusiveForms(); } },
      syncDb:         { label: "DB 동기화",      fn: function() { var o = _sb_syncOrders_(); var v = _sb_syncVendors_(); return { orders: o, vendors: v }; } }
    };

    var spec = taskMap[task];
    if (!spec) {
      lock.releaseLock();
      return { success: false, error: "알 수 없는 작업: " + task };
    }

    var fnResult = spec.fn();
    result = {
      success: true,
      task: spec.label,
      message: spec.label + " 완료"
    };
    if (fnResult) result.detail = fnResult;

    var elapsed = Math.round((new Date() - startTime) / 1000);
    result.elapsed = elapsed;
    result.completedAt = Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm:ss");

    // Google Chat 알림
    try {
      _chat_sendCard_("🌐 웹앱 실행: " + spec.label,
        Utilities.formatDate(startTime, "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        [{ label: "⏱ 소요시간", value: elapsed + "초" }]
      );
    } catch (eC) {}

    lock.releaseLock();
    return result;

  } catch (e) {
    var elapsed2 = Math.round((new Date() - startTime) / 1000);
    lock.releaseLock();

    // 에러 Chat 알림
    try {
      _chat_sendCard_("❌ 웹앱 실행 에러: " + task,
        Utilities.formatDate(startTime, "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        [
          { label: "⏱ 소요시간", value: elapsed2 + "초" },
          { label: "오류", value: String(e.message || e).substring(0, 200) }
        ]
      );
    } catch (eC2) {}

    return {
      success: false,
      task: task,
      error: String(e.message || e),
      elapsed: elapsed2
    };
  }
}

// ═══════════════════════════════════════════
//  ★ 2026-07-03: 전용양식 Push 미리보기 API
// ═══════════════════════════════════════════

function _api_exclusivePreview_() {
  // 1) 소스 탭 열기
  var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var srcTab = null;
  var srcSheets = srcSS.getSheets();
  for (var gsi = 0; gsi < srcSheets.length; gsi++) {
    if (srcSheets[gsi].getSheetId() === _PEP_SOURCE_TAB_GID) {
      srcTab = srcSheets[gsi];
      break;
    }
  }
  if (!srcTab) srcTab = srcSS.getSheetByName(_pep_getSourceTabName_());
  if (!srcTab || srcTab.getLastRow() < 2) {
    return { totalRows: 0, alreadyPushed: 0, vendors: {}, unmapped: { count: 0, rows: [] } };
  }

  // 2) 소스 데이터 읽기
  var srcLr = srcTab.getLastRow();
  var srcLc = Math.max(srcTab.getLastColumn(), 20);
  var srcAll = srcTab.getRange(1, 1, srcLr, srcLc).getValues();

  // UID열 찾기 (이미 Push 완료 판별)
  var uidCol = -1;
  for (var hi = 0; hi < srcAll[0].length; hi++) {
    var hn = String(srcAll[0][hi] || "").replace(/\s/g, "").toLowerCase();
    if (hn === "협력push" || hn === "pep_uid") { uidCol = hi; break; }
  }

  // _PEP_VENDOR_DIRECT_MAP_ 접근 (업체명 맵)
  var vendorMap = (typeof _PEP_VENDOR_DIRECT_MAP_ !== "undefined") ? _PEP_VENDOR_DIRECT_MAP_ : {};

  var totalRows = 0;
  var alreadyPushed = 0;
  var vendors = {};    // { prefix: { name, count, rows[] } }
  var unmapped = { count: 0, rows: [] };

  for (var ri = 1; ri < srcAll.length; ri++) {
    var row = srcAll[ri];
    var rawCode = String(row[3] || "").trim(); // D열(index 3)
    var rawName = String(row[4] || "").trim(); // E열(index 4)

    if (!rawCode && !rawName) continue; // 빈 행 스킵
    totalRows++;

    // 이미 Push 완료?
    if (uidCol !== -1 && String(row[uidCol] || "").trim()) {
      alreadyPushed++;
      continue;
    }

    // prefix 추출 (기존 로직과 동일 + 보조 접두 → 대표 접두 환산)
    var aliasFn =
      typeof _pep_resolvePrefixAlias_ === "function"
        ? _pep_resolvePrefixAlias_
        : function (v) { return String(v || "").trim().toUpperCase(); };
    var codePfx = rawCode.length >= 2 ? aliasFn(rawCode.substring(0, 2)) : "";
    var namePfx = "";
    var m = rawName.match(/([a-zA-Z]{2})/);
    if (m) namePfx = aliasFn(m[1]);

    var pfx = "";
    if (codePfx && vendorMap[codePfx]) pfx = codePfx;
    else if (namePfx && vendorMap[namePfx]) pfx = namePfx;
    else if (codePfx) pfx = codePfx;
    else if (namePfx) pfx = namePfx;

    var rowData = {
      rowIndex: ri + 1,
      code: rawCode,
      name: rawName,
      qty: parseInt(row[6]) || 0,        // G열(index 6)
      recipient: String(row[12] || ""),   // M열(index 12)
      phone: String(row[8] || ""),        // I열(index 8)
      address: String(row[9] || ""),      // J열(index 9)
      message: String(row[10] || ""),     // K열(index 10)
      prefix: pfx,
      uid: String(row[15] || "").trim(),  // P열(index 15)
      unitPrice: parseFloat(row[11]) || 0 // L열(index 11)
    };

    if (pfx && vendorMap[pfx]) {
      if (!vendors[pfx]) {
        vendors[pfx] = { name: vendorMap[pfx].vendorNameCol !== undefined ? pfx : pfx, count: 0, rows: [] };
      }
      vendors[pfx].count++;
      if (vendors[pfx].rows.length < 50) vendors[pfx].rows.push(rowData); // 최대 50행
    } else {
      unmapped.count++;
      if (unmapped.rows.length < 20) unmapped.rows.push(rowData);
    }
  }

  // 업체명 보정 (prefixToFile에서 파일 이름 추출)
  try {
    var files = _pt_listFiles();
    var pfxMap = _pep_buildPrefixToFileMap_(files);
    for (var vpfx in vendors) {
      if (pfxMap[vpfx]) {
        vendors[vpfx].name = pfxMap[vpfx].name.replace("[협력업체] ", "");
      }
    }
  } catch (e) {}

  return {
    totalRows: totalRows,
    alreadyPushed: alreadyPushed,
    vendors: vendors,
    unmapped: unmapped
  };
}

// ═══════════════════════════════════════════
//  ★ 2026-07-06: 파트너 시트 발주 직접 조회 API
// ═══════════════════════════════════════════

/**
 * action=partnerOrders — 업체 시트에서 직접 발주 데이터 읽기
 * 파라미터: vendor=업체명, limit=최대건수(기본200)
 *
 * 응답: { orders: [...], total, vendor, sheetName, fetchedAt }
 */
function _api_partnerOrders_(params) {
  var vendorName = (params && params.vendor) || "";
  if (!vendorName) return { error: "vendor 파라미터가 필요합니다" };
  var limit = parseInt(params.limit) || 200;

  // 1) 업체 시트 찾기 — _pt_listFiles() 캐시 활용
  var files = _pt_listFiles();
  var targetFile = null;

  for (var i = 0; i < files.length; i++) {
    var fname = files[i].name
      .replace("[협력업체] ", "")
      .replace(/\s*\(소비자용\).*$/, "")
      .trim();

    if (fname === vendorName) {
      targetFile = files[i];
      break;
    }
  }

  // 파일명 매칭 실패 → 설정 B5(거래처명) 기반 2차 탐색
  if (!targetFile) {
    for (var j = 0; j < files.length; j++) {
      try {
        var ss2 = SpreadsheetApp.openById(files[j].id);
        var stab = ss2.getSheetByName("설정");
        if (stab) {
          var b5 = String(stab.getRange("B5").getValue() || "").trim();
          if (b5 === vendorName) {
            targetFile = files[j];
            break;
          }
        }
      } catch (e2) { continue; }
    }
  }

  if (!targetFile) return { error: "업체를 찾을 수 없습니다: " + vendorName };

  // 2) 시트 오픈 + 발주 탭 찾기
  var ss;
  try {
    ss = SpreadsheetApp.openById(targetFile.id);
  } catch (eOpen) {
    return { error: "시트 접근 불가: " + eOpen.message };
  }

  var orderTab = ss.getSheetByName("발주 및 송장조회");
  if (!orderTab) return { error: "발주 및 송장조회 탭이 없습니다" };

  var lastRow = orderTab.getLastRow();
  if (lastRow < 2) return { orders: [], total: 0, vendor: vendorName, fetchedAt: new Date().toISOString() };

  // 3) 헤더 자동 매핑
  var lastCol = Math.max(orderTab.getLastColumn(), 15);
  var allData = orderTab.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = allData[0];

  var colMap = {};
  for (var h = 0; h < headers.length; h++) {
    var hdr = String(headers[h] || "").replace(/\s/g, "").toLowerCase();

    if (hdr.indexOf("이카운트") !== -1 || hdr === "코드" || hdr === "상품코드") colMap.code = h;
    else if (hdr.indexOf("품목명") !== -1 || hdr.indexOf("상품명") !== -1) colMap.name = h;
    else if (hdr === "수량" || hdr === "주문수량") colMap.qty = h;
    else if (hdr.indexOf("수취인") !== -1 && hdr.indexOf("전화") === -1 && hdr.indexOf("주소") === -1) colMap.recipient = h;
    else if (hdr.indexOf("전화") !== -1 || hdr.indexOf("핸드폰") !== -1 || hdr.indexOf("연락처") !== -1) colMap.phone = h;
    else if (hdr.indexOf("주소") !== -1) colMap.address = h;
    else if (hdr.indexOf("메시지") !== -1 || hdr.indexOf("메세지") !== -1 || hdr.indexOf("배송메") !== -1) colMap.message = h;
    else if (hdr.indexOf("주문일") !== -1 || hdr === "날짜" || hdr === "발주일") colMap.orderDate = h;
    else if (hdr === "송장번호" || hdr === "운송장번호" || hdr === "송장" || hdr === "운송장") colMap.invoice = h;
    else if (hdr === "상태" || hdr === "처리상태") colMap.status = h;
    else if (hdr.indexOf("단가") !== -1 || hdr.indexOf("정산") !== -1 || hdr.indexOf("금액") !== -1) colMap.price = h;
    else if (hdr.indexOf("적요") !== -1 || hdr.indexOf("비고") !== -1 || hdr.indexOf("메모") !== -1) colMap.note = h;
    else if (hdr.indexOf("고유") !== -1 || hdr === "uid") colMap.uid = h;
  }

  // 4) 데이터 수집 (역순 — 최신부터)
  var orders = [];
  for (var r = lastRow - 1; r >= 1 && orders.length < limit; r--) {
    var row = allData[r];

    var code = colMap.code !== undefined ? String(row[colMap.code] || "").trim() : "";
    var name = colMap.name !== undefined ? String(row[colMap.name] || "").trim() : "";
    if (!code && !name) continue; // 빈 행 스킵

    var orderDate = "";
    if (colMap.orderDate !== undefined) {
      var od = row[colMap.orderDate];
      if (od instanceof Date) {
        orderDate = Utilities.formatDate(od, "Asia/Seoul", "yyyy-MM-dd");
      } else {
        orderDate = String(od || "").trim();
      }
    }

    orders.push({
      unique_id: colMap.uid !== undefined ? String(row[colMap.uid] || "").trim() : "",
      order_date: orderDate,
      ecount_code: code,
      item_name: name,
      qty: colMap.qty !== undefined ? (parseInt(row[colMap.qty]) || 1) : 1,
      recipient: colMap.recipient !== undefined ? String(row[colMap.recipient] || "").trim() : "",
      phone: colMap.phone !== undefined ? String(row[colMap.phone] || "").trim() : "",
      address: colMap.address !== undefined ? String(row[colMap.address] || "").trim() : "",
      message: colMap.message !== undefined ? String(row[colMap.message] || "").trim() : "",
      invoice_no: colMap.invoice !== undefined ? String(row[colMap.invoice] || "").trim() : "",
      status: colMap.status !== undefined ? String(row[colMap.status] || "").trim() : "",
      unit_price: colMap.price !== undefined ? (parseInt(row[colMap.price]) || 0) : 0,
      note: colMap.note !== undefined ? String(row[colMap.note] || "").trim() : "",
    });
  }

  return {
    orders: orders,
    total: orders.length,
    totalRows: lastRow - 1,
    vendor: vendorName,
    sheetName: targetFile.name,
    fetchedAt: new Date().toISOString(),
  };
}
