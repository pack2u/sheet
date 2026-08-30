// ═══════════════════════════════════════════════════════════════
// [Pack2U] Supabase DB 연동 헬퍼
// ───────────────────────────────────────────────────────────────
// ★ 2026-07-01: 하이브리드 모드 — 시트 + DB 양방향 동기화
// ★ 기존 시트 기능은 폴백으로 유지, DB가 우선
// ═══════════════════════════════════════════════════════════════

// ── Supabase 접속 정보 ──
var _SB_URL = "https://bmlbehjtdleshsbvxfrx.supabase.co";
var _SB_KEY = ""; // ★ _secrets.gs에서 로드

/**
 * Supabase API Key 로드 (lazy init)
 */
function _sb_getKey_() {
  if (_SB_KEY) return _SB_KEY;
  // _secrets.gs에 SUPABASE_SERVICE_KEY 정의 필요
  if (typeof SUPABASE_SERVICE_KEY !== "undefined") {
    _SB_KEY = SUPABASE_SERVICE_KEY;
  } else {
    // 폴백: 스크립트 속성에서 로드
    _SB_KEY = PropertiesService.getScriptProperties().getProperty("SUPABASE_KEY") || "";
  }
  return _SB_KEY;
}

// ═══════════════════════════════════════════════════════════════
//  공통 API 호출 함수
// ═══════════════════════════════════════════════════════════════

/**
 * Supabase GET (SELECT)
 * @param {string} table 테이블명
 * @param {string} query PostgREST 쿼리 (예: "ecount_code=eq.ABC&select=*")
 * @return {Array} 결과 배열
 */
function _sb_get_(table, query) {
  var key = _sb_getKey_();
  if (!key) { Logger.log("[SB] API Key 없음"); return []; }

  var url = _SB_URL + "/rest/v1/" + table + (query ? "?" + query : "");
  try {
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: {
        "apikey": key,
        "Authorization": "Bearer " + key
      },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
      return JSON.parse(res.getContentText());
    }
    Logger.log("[SB_GET] " + res.getResponseCode() + ": " + res.getContentText().substring(0, 200));
    return [];
  } catch (e) {
    Logger.log("[SB_GET] " + e.message);
    return [];
  }
}

/**
 * Supabase POST (INSERT/UPSERT)
 * @param {string} table 테이블명
 * @param {Array|Object} payload 데이터
 * @param {boolean} upsert true면 중복 시 업데이트
 * @return {Object} { ok: boolean, count: number, error: string }
 */
// ★ 2026-07-02: onConflict 파라미터 추가 (PostgREST UPSERT 지원)
function _sb_post_(table, payload, upsert, onConflict) {
  var key = _sb_getKey_();
  if (!key) return { ok: false, error: "API Key 없음" };

  var url = _SB_URL + "/rest/v1/" + table;
  // ★ on_conflict 쿼리 파라미터로 UPSERT 충돌 컬럼 지정
  if (upsert && onConflict) {
    url += "?on_conflict=" + onConflict;
  }
  var headers = {
    "apikey": key,
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json"
  };
  if (upsert) {
    headers["Prefer"] = "resolution=merge-duplicates";
  }

  try {
    var data = Array.isArray(payload) ? payload : [payload];
    var res = UrlFetchApp.fetch(url, {
      method: "post",
      headers: headers,
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      return { ok: true, count: data.length };
    }
    return { ok: false, error: res.getContentText().substring(0, 200) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Supabase PATCH (UPDATE)
 * @param {string} table 테이블명
 * @param {string} filter PostgREST 필터 (예: "unique_id=eq.0701-ds-ABCD")
 * @param {Object} updates 업데이트할 필드
 * @return {Object} { ok: boolean, error: string }
 */
function _sb_patch_(table, filter, updates) {
  var key = _sb_getKey_();
  if (!key) return { ok: false, error: "API Key 없음" };

  var url = _SB_URL + "/rest/v1/" + table + "?" + filter;
  try {
    var res = UrlFetchApp.fetch(url, {
      method: "patch",
      headers: {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(updates),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    return { ok: code >= 200 && code < 300, error: code >= 300 ? res.getContentText().substring(0, 200) : "" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Supabase DELETE
 * @param {string} table 테이블명
 * @param {string} filter PostgREST 필터
 */
function _sb_delete_(table, filter) {
  var key = _sb_getKey_();
  if (!key) return { ok: false, error: "API Key 없음" };

  var url = _SB_URL + "/rest/v1/" + table + "?" + filter;
  try {
    var res = UrlFetchApp.fetch(url, {
      method: "delete",
      headers: {
        "apikey": key,
        "Authorization": "Bearer " + key
      },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    return { ok: code >= 200 && code < 300 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
//  품목 동기화 (시트 → DB)
// ═══════════════════════════════════════════════════════════════

/**
 * ★ 메뉴: 상품정보 → DB 동기화
 * 현재 허브 단가 데이터를 Supabase products_hub에 UPSERT
 */
function syncProductsToDbOwner() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "📦 상품정보 → DB 동기화",
    "현재 상품정보를 Supabase DB에 동기화합니다.\n계속하시겠습니까?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var result = _sb_syncProducts_();
  ui.alert("동기화 결과", result.msg, ui.ButtonSet.OK);
}

/**
 * 상품 동기화 코어 로직
 */
function _sb_syncProducts_() {
  try {
    // 상품정보 시트에서 데이터 읽기
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ★ '상품정보' 탭에서 읽기 (허브 시트의 상품 마스터)
    var hubTab = ss.getSheetByName("상품정보");
    if (!hubTab) {
      // 폴백: 다른 이름으로 시도
      var tabs = ss.getSheets();
      for (var i = 0; i < tabs.length; i++) {
        var tn = tabs[i].getName();
        if (tn.indexOf("상품") !== -1 && tn.indexOf("정보") !== -1) {
          hubTab = tabs[i]; break;
        }
      }
    }
    if (!hubTab) return { ok: false, msg: "❌ 상품정보 탭을 찾을 수 없습니다." };

    var data = hubTab.getDataRange().getValues();
    if (data.length < 2) return { ok: false, msg: "❌ 데이터가 없습니다." };

    // 헤더에서 열 인덱스 찾기 (1행 또는 2행 모두 스캔)
    var colMap = {};
    for (var row = 0; row < Math.min(3, data.length); row++) {
      for (var h = 0; h < data[row].length; h++) {
        var hv = String(data[row][h]).trim();
        if (colMap.code === undefined && (hv.indexOf("이카운트") !== -1 || hv === "코드")) colMap.code = h;
        if (colMap.name === undefined && (hv.indexOf("품목명") !== -1 || hv.indexOf("상품명") !== -1)) colMap.name = h;
        if (colMap.status === undefined && hv === "상태") colMap.status = h;
        if (colMap.price === undefined && (hv.indexOf("소비자가") !== -1 || hv.indexOf("단가") !== -1 || hv.indexOf("가격") !== -1)) colMap.price = h;
        if (colMap.stock === undefined && hv.indexOf("재고") !== -1) colMap.stock = h;
      }
      if (colMap.code !== undefined && colMap.name !== undefined) {
        colMap.dataStart = row + 1; // 헤더 다음 행부터 데이터
        break;
      }
    }

    // 폴백: 상품정보 시트 고정 열 (A=상태, C=품목명, E=이카운트코드, G=재고, X=소비자가)
    // ★ priceManager.gs 1640~1650행 기준: r[0]=상태, r[4]=코드, r[2]=품목명, r[6]=재고, r[23]=소비자가
    if (colMap.code === undefined || colMap.name === undefined) {
      colMap = { status: 0, code: 4, name: 2, stock: 6, price: 23, dataStart: 3 };
      Logger.log("[SB] 헤더 자동탐색 실패 → 고정 열 위치 사용 (E=코드, C=품목명, 4행~)");
    }
    if (!colMap.dataStart) colMap.dataStart = 3; // 4행(index 3)부터 데이터

    // 배치 UPSERT (500건씩)
    var BATCH = 50; // ★ all_data JSONB 포함으로 배치 크기 축소
    var total = 0, errors = 0;

    // ★ 헤더 이름 배열 구성 (1~3행 중 값이 있는 것)
    var headerNames = [];
    for (var h = 0; h < data[0].length; h++) {
      var name = "";
      for (var hr = 0; hr < Math.min(3, data.length); hr++) {
        var v = String(data[hr][h] || "").trim();
        if (v && v !== "undefined") { name = v; break; }
      }
      headerNames.push(name || ("col_" + h));
    }

    for (var i = colMap.dataStart; i < data.length; i += BATCH) {
      var batch = [];
      var end = Math.min(i + BATCH, data.length);
      for (var r = i; r < end; r++) {
        var code = String(data[r][colMap.code] || "").trim();
        if (!code) continue;

        // all_data: 전체 열을 헤더명 기준 JSON으로 저장
        var allData = {};
        for (var c = 0; c < data[r].length; c++) {
          var val = data[r][c];
          if (val !== "" && val !== null && val !== undefined) {
            allData[headerNames[c]] = val;
          }
        }

        // ★ 그룹별 단가 (AG~BM, index 32~64)
        var groupPrices = {};
        for (var g = 32; g <= Math.min(64, data[r].length - 1); g++) {
          var gv = data[r][g];
          if (gv && String(gv).trim() !== "") {
            groupPrices[headerNames[g]] = gv;
          }
        }

        batch.push({
          ecount_code: code,
          item_name: String(data[r][colMap.name] || "").trim(),
          status: colMap.status !== undefined ? String(data[r][colMap.status] || "판매중").trim() : "판매중",
          base_price: colMap.price !== undefined ? parseInt(data[r][colMap.price]) || 0 : 0,
          stock_qty: colMap.stock !== undefined ? parseInt(data[r][colMap.stock]) || 0 : 0,
          warehouse: String(data[r][1] || "").trim(),
          shop_name: String(data[r][3] || "").trim(),
          supplier: String(data[r][5] || "").trim(),
          purchase_price: parseInt(data[r][22]) || 0,
          retail_price: parseInt(data[r][23]) || 0,
          hub_base_price: parseInt(data[r][65]) || 0,
          hub_future_price: parseInt(data[r][66]) || 0,
          group_prices: groupPrices,
          all_data: allData
        });
      }
      if (batch.length > 0) {
        var res = _sb_post_("products_hub", batch, true);
        if (res.ok) {
          total += batch.length;
        } else {
          // ★ 배치 실패 시 1건씩 재시도
          Logger.log("[SB] 배치 실패 (" + batch.length + "건): " + (res.error || "").substring(0, 200));
          for (var ri = 0; ri < batch.length; ri++) {
            var singleRes = _sb_post_("products_hub", [batch[ri]], true);
            if (singleRes.ok) total++;
            else {
              errors++;
              Logger.log("[SB] 개별 실패: " + batch[ri].ecount_code + " → " + (singleRes.error || "").substring(0, 100));
            }
          }
        }
      }
      if (i + BATCH < data.length) Utilities.sleep(500);
    }

    // 진단: 전체 행, 스킵, 고유코드 수 계산
    var totalRows = data.length - colMap.dataStart;
    var codeSet = {};
    var emptyCount = 0;
    for (var d = colMap.dataStart; d < data.length; d++) {
      var c = String(data[d][colMap.code] || "").trim();
      if (!c) { emptyCount++; continue; }
      codeSet[c] = (codeSet[c] || 0) + 1;
    }
    var uniqueCodes = Object.keys(codeSet).length;
    var dupCount = totalRows - emptyCount - uniqueCodes;

    return {
      ok: true,
      msg: "✅ DB 동기화 완료\n\n" +
        "• 전체 행: " + totalRows + "행\n" +
        "• 코드 비어있음: " + emptyCount + "행 (스킵)\n" +
        "• 고유 코드: " + uniqueCodes + "개\n" +
        "• 중복 코드: " + dupCount + "행\n" +
        "• DB 전송: " + total + "건\n" +
        (errors > 0 ? "• 오류 배치: " + errors + "건\n" : "") +
        "• 시간: " + Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm:ss")
    };
  } catch (e) {
    return { ok: false, msg: "❌ 오류: " + e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
//  발주 동기화 (허브 → DB)
// ═══════════════════════════════════════════════════════════════

/**
 * ★ 메뉴: 발주허브 → DB 동기화
 */
function syncOrdersToDbOwner() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "📋 발주허브 → DB 동기화",
    "협력업체_발주허브 데이터를 DB에 동기화합니다.\n계속하시겠습니까?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var result = _sb_syncOrders_();
  ui.alert("동기화 결과", result.msg, ui.ButtonSet.OK);
}

/**
 * 발주 동기화 코어 로직
 */
function _sb_syncOrders_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hub = ss.getSheetByName("협력업체_발주허브");
    if (!hub) return { ok: false, msg: "❌ 협력업체_발주허브 탭 없음" };

    var data = hub.getDataRange().getValues();
    if (data.length < 2) return { ok: false, msg: "❌ 데이터 없음" };

    // 허브 헤더: A수집일시, B발주업체, C고유ID, D주문일자, E이카운트코드,
    //           F품목명, G수량, H수취인, I전화번호, J주소, K배송메시지,
    //           L정산금액, M적요, N송장번호, O상태
    var BATCH = 500;
    var total = 0, skipped = 0;

    for (var i = 1; i < data.length; i += BATCH) {
      var batch = [];
      var end = Math.min(i + BATCH, data.length);
      for (var r = i; r < end; r++) {
        var uid = String(data[r][2] || "").trim();
        if (!uid) { skipped++; continue; }

        var orderDate = data[r][3];
        var dateStr;
        if (orderDate instanceof Date) {
          dateStr = Utilities.formatDate(orderDate, "Asia/Seoul", "yyyy-MM-dd");
        } else {
          dateStr = String(orderDate || "").trim();
          if (!dateStr || dateStr.length < 8) {
            dateStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
          }
        }

        // ★ 2026-07-02: DB 스키마 v2 컬럼명으로 통일
        batch.push({
          unique_id: uid,
          vendor_name: String(data[r][1] || "").trim(),
          order_date: dateStr,
          ecount_code: String(data[r][4] || "").trim(),
          item_name: String(data[r][5] || "").trim(),
          qty: parseInt(data[r][6]) || 1,
          recipient: String(data[r][7] || "").trim(),
          phone: String(data[r][8] || "").trim(),
          address: String(data[r][9] || "").trim(),
          message: String(data[r][10] || "").trim(),
          unit_price: parseInt(data[r][11]) || 0,
          note: String(data[r][12] || "").trim(),
          invoice_no: String(data[r][13] || "").trim(),
          status: String(data[r][14] || "접수완료").trim()
        });
      }
      if (batch.length > 0) {
        var res = _sb_post_("orders", batch, true, "unique_id");
        if (res.ok) total += batch.length;
        else Logger.log("[SB_ORDERS] UPSERT 에러: " + res.error);
      }
      if (i + BATCH < data.length) Utilities.sleep(500);
    }

    return {
      ok: true,
      msg: "✅ 발주 DB 동기화 완료\n\n" +
        "• 전송: " + total + "건\n" +
        "• 스킵 (고유ID 없음): " + skipped + "건\n" +
        "• 시간: " + Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm:ss")
    };
  } catch (e) {
    return { ok: false, msg: "❌ 오류: " + e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
//  DB에서 단가 조회 (빠른 검색)
// ═══════════════════════════════════════════════════════════════

/**
 * ★ 이카운트코드로 품목 조회 (DB 우선, 실패 시 시트 폴백)
 * @param {string} code 이카운트코드
 * @return {Object} { name, price, status } 또는 null
 */
function _sb_lookupProduct_(code) {
  if (!code) return null;
  code = String(code).trim().toUpperCase();

  // DB 조회 시도
  var results = _sb_get_("products_hub", "ecount_code=eq." + encodeURIComponent(code) + "&select=item_name,base_price,status");
  if (results && results.length > 0) {
    return {
      name: results[0].item_name,
      price: results[0].base_price,
      status: results[0].status
    };
  }

  // 폴백: 기존 시트 방식 (null 반환 시 호출측에서 처리)
  return null;
}

/**
 * ★ 품목명으로 검색 (부분검색, DB 전용)
 * @param {string} keyword 검색어
 * @param {number} limit 최대 결과 수
 * @return {Array} 검색 결과
 */
function _sb_searchProducts_(keyword, limit) {
  if (!keyword) return [];
  limit = limit || 20;
  var results = _sb_get_(
    "products_hub",
    "item_name=ilike.*" + encodeURIComponent(keyword) + "*" +
    "&select=ecount_code,item_name,base_price,status" +
    "&limit=" + limit +
    "&order=item_name"
  );
  return results || [];
}


// ═══════════════════════════════════════════════════════════════
//  DB 연결 테스트
// ═══════════════════════════════════════════════════════════════

/**
 * ★ 메뉴: DB 연결 테스트 + 각 테이블 건수 표시
 */
function testDbConnectionOwner() {
  var ui = SpreadsheetApp.getUi();
  var key = _sb_getKey_();
  if (!key) {
    ui.alert("❌ Supabase API Key가 설정되지 않았습니다.\n\n_secrets.gs에 SUPABASE_SERVICE_KEY를 정의하세요.");
    return;
  }

  var tables = ["products_hub", "orders", "invoices", "vendors", "price_history"];
  var report = "✅ DB 연결 성공!\n\nSupabase: " + _SB_URL + "\n\n📊 테이블 현황:\n";

  for (var i = 0; i < tables.length; i++) {
    try {
      var res = _sb_get_(tables[i], "select=id&limit=1&offset=0");
      // count를 위해 HEAD 요청 대신 간단히 조회
      var countRes = _sb_get_(tables[i], "select=id");
      var count = countRes ? countRes.length : 0;
      // 1000건 이상이면 실제 개수 확인 어려움 → limit 없이 조회
      if (count >= 1000) {
        report += "• " + tables[i] + ": 1,000건 이상\n";
      } else {
        report += "• " + tables[i] + ": " + count + "건\n";
      }
    } catch (e) {
      report += "• " + tables[i] + ": ❌ 오류\n";
    }
  }

  ui.alert(report);
}


// ═══════════════════════════════════════════════════════════════
//  ★ DB 빠른 검색 (품목코드/품목명)
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴: DB 품목 검색 — 코드 또는 품목명으로 즉시 검색
 */
function searchProductFromDbOwner() {
  var ui = SpreadsheetApp.getUi();
  var input = ui.prompt(
    "🔍 DB 품목 검색",
    "이카운트코드 또는 품목명 일부를 입력하세요:",
    ui.ButtonSet.OK_CANCEL
  );
  if (input.getSelectedButton() !== ui.Button.OK) return;

  var keyword = input.getResponseText().trim();
  if (!keyword) return;

  var startTime = new Date();

  // 1. 코드 정확 매칭 시도
  var byCode = _sb_get_("products_hub",
    "ecount_code=eq." + encodeURIComponent(keyword) +
    "&select=ecount_code,item_name,status,stock_qty,purchase_price,retail_price,hub_base_price,hub_future_price,warehouse,supplier"
  );

  // 2. 없으면 품목명 부분 검색
  if (!byCode || byCode.length === 0) {
    byCode = _sb_get_("products_hub",
      "item_name=ilike.*" + encodeURIComponent(keyword) + "*" +
      "&select=ecount_code,item_name,status,stock_qty,purchase_price,retail_price,hub_base_price,hub_future_price,warehouse,supplier" +
      "&limit=10&order=item_name"
    );
  }

  var elapsed = new Date() - startTime;

  if (!byCode || byCode.length === 0) {
    ui.alert("🔍 검색 결과 없음\n\n'" + keyword + "'에 해당하는 품목이 없습니다.\n⏱ 검색시간: " + elapsed + "ms");
    return;
  }

  // 결과 포맷
  var msg = "🔍 검색 결과 (" + byCode.length + "건) — ⏱ " + elapsed + "ms\n\n";
  for (var i = 0; i < byCode.length; i++) {
    var p = byCode[i];
    msg += "━━━━━━━━━━━━━━━━━━━\n";
    msg += "코드: " + p.ecount_code + "\n";
    msg += "품목: " + p.item_name + "\n";
    msg += "상태: " + (p.status || "-") + " | 재고: " + (p.stock_qty || 0) + "\n";
    msg += "매입가: " + _sb_formatNum_(p.purchase_price) + " | 소비자가: " + _sb_formatNum_(p.retail_price) + "\n";
    msg += "허브단가: " + _sb_formatNum_(p.hub_base_price) + " | 변동가: " + _sb_formatNum_(p.hub_future_price) + "\n";
    msg += "출고지: " + (p.warehouse || "-") + " | 구매처: " + (p.supplier || "-") + "\n";
  }

  ui.alert(msg);
}

/** 숫자 포맷 헬퍼 */
function _sb_formatNum_(n) {
  if (!n || n === 0) return "-";
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
}


// ═══════════════════════════════════════════════════════════════
//  ★ DB 단가 이력 조회
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴: 단가 이력 조회 — 특정 품목의 가격 변경 내역
 */
function viewPriceHistoryOwner() {
  var ui = SpreadsheetApp.getUi();
  var input = ui.prompt(
    "📊 단가 이력 조회",
    "이카운트코드를 입력하세요:",
    ui.ButtonSet.OK_CANCEL
  );
  if (input.getSelectedButton() !== ui.Button.OK) return;

  var code = input.getResponseText().trim();
  if (!code) return;

  var history = _sb_get_("price_history",
    "ecount_code=eq." + encodeURIComponent(code) +
    "&select=price_type,old_price,new_price,changed_at,changed_by" +
    "&order=changed_at.desc&limit=20"
  );

  if (!history || history.length === 0) {
    ui.alert("📊 단가 이력 없음\n\n'" + code + "' 품목의 가격 변경 기록이 없습니다.\n(다음 동기화부터 자동 기록됩니다)");
    return;
  }

  var msg = "📊 단가 이력: " + code + " (최근 20건)\n\n";
  for (var i = 0; i < history.length; i++) {
    var h = history[i];
    var date = h.changed_at ? h.changed_at.substring(0, 10) : "-";
    msg += date + " [" + h.price_type + "] ";
    msg += _sb_formatNum_(h.old_price) + " → " + _sb_formatNum_(h.new_price);
    msg += " (" + (h.changed_by || "auto") + ")\n";
  }

  ui.alert(msg);
}


// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-02: 협력업체 → DB 동기화
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴: 협력업체 → DB 동기화
 * Drive 폴더의 업체 시트 목록을 vendors 테이블에 UPSERT
 */
function syncVendorsToDbOwner() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "🏢 협력업체 → DB 동기화",
    "등록된 협력업체를 DB에 동기화합니다.\n계속하시겠습니까?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var result = _sb_syncVendors_();
  ui.alert("동기화 결과", result.msg, ui.ButtonSet.OK);
}

/**
 * 협력업체 동기화 코어 로직
 * _pt_listFiles()로 업체 시트 목록 → vendors 테이블 UPSERT
 */
function _sb_syncVendors_() {
  try {
    var files = _pt_listFiles();
    if (!files || files.length === 0) {
      return { ok: false, msg: "❌ 업체 파일을 찾을 수 없습니다" };
    }

    // ★ 2026-07-02: 허브 그룹 역매핑 (열번호 → 그룹명)
    var hubGroups = {};
    try {
      var fwdMap = _pt_getHubGroups(); // { "대리발송 5%": 32, ... }
      for (var gn in fwdMap) {
        hubGroups[String(fwdMap[gn])] = gn; // { "32": "대리발송 5%" }
      }
    } catch (eGrp) {
      Logger.log("[SB_VENDOR] 그룹 로드 실패: " + eGrp.message);
    }

    var batch = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var vendorName = f.name || "";
      try {
        var ss = SpreadsheetApp.openById(f.id);
        var settingTab = ss.getSheetByName("설정");
        if (settingTab) {
          var b5 = String(settingTab.getRange("B5").getValue() || "").trim();
          if (b5) vendorName = b5;
        }
        // 소비자용 여부
        var isConsumer = false;
        if (settingTab) {
          var c10 = String(settingTab.getRange("C10").getValue() || "").trim();
          isConsumer = (c10 === "소비자" || c10 === "consumer" || c10 === "Y");
        }
        var scriptId = "";
        if (settingTab) {
          scriptId = String(settingTab.getRange("B13").getValue() || "").trim();
        }

        // ★ 2026-07-02: 단가 그룹 & 할인율 추출
        var priceGroup = "";
        var discountRate = 0;

        // 뷰어 탭(첫 번째 시트 또는 '뷰어' 포함 시트)의 K2에서 그룹열 번호 읽기
        var viewerTab = null;
        var sheets = ss.getSheets();
        for (var si = 0; si < sheets.length; si++) {
          if (sheets[si].getName().indexOf("뷰어") !== -1) {
            viewerTab = sheets[si]; break;
          }
        }
        if (!viewerTab) viewerTab = sheets[0]; // 폴백: 첫 번째 시트

        if (viewerTab) {
          var k2Val = viewerTab.getRange("K2").getValue();
          var k2Str = String(k2Val || "").trim();
          if (k2Str && !isNaN(k2Str)) {
            var k2Num = parseInt(k2Str);
            // NNN 패턴 → 소비자 할인율
            var consumerRate = _pt_getConsumerRateFromK2(k2Num);
            if (consumerRate > 0) {
              isConsumer = true;
              discountRate = consumerRate;
              priceGroup = "소비자 " + consumerRate + "%";
            } else if (hubGroups[k2Str]) {
              // 일반 그룹 매핑
              priceGroup = hubGroups[k2Str];
            }
          }
        }

        // 파일명에서 소비자 할인율 폴백
        if (!priceGroup && f.name) {
          var fnRate = _pt_parseConsumerDcRateFromName(f.name);
          if (fnRate > 0) {
            isConsumer = true;
            discountRate = fnRate;
            priceGroup = "소비자 " + fnRate + "%";
          }
        }

        batch.push({
          name: vendorName,
          sheet_id: f.id,
          script_id: scriptId,
          is_consumer: isConsumer,
          is_active: true,
          price_group: priceGroup || null,
          discount_rate: discountRate || null
        });
      } catch (eFile) {
        Logger.log("[SB_VENDOR] " + f.name + " 읽기 실패: " + eFile.message);
        batch.push({
          name: vendorName || f.name,
          sheet_id: f.id,
          is_active: true
        });
      }

      // 30건마다 UPSERT
      if (batch.length >= 30 || i === files.length - 1) {
        if (batch.length > 0) {
          var postRes = _sb_post_("vendors", batch, true, "name");
          if (!postRes.ok) Logger.log("[SB_VENDOR] UPSERT 에러: " + postRes.error);
          batch = [];
          Utilities.sleep(500);
        }
      }
    }

    return {
      ok: true,
      msg: "✅ 협력업체 DB 동기화 완료\n\n" +
        "• 전송: " + files.length + "건\n" +
        "• 시간: " + Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm:ss")
    };
  } catch (e) {
    return { ok: false, msg: "❌ 오류: " + e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-02: 통합 DB 동기화 (발주 + 업체 한번에)
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴: 통합 DB 동기화 (발주 + 업체)
 */
function syncAllToDbOwner() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "🔄 통합 DB 동기화",
    "발주 + 업체 데이터를 DB에 동기화합니다.\n계속하시겠습니까?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var msgs = [];

  // 1) 발주 동기화
  var ordersResult = _sb_syncOrders_();
  msgs.push("[발주] " + (ordersResult.ok ? "✅" : "❌") + " " + ordersResult.msg.split("\n")[0]);

  // 2) 업체 동기화
  var vendorsResult = _sb_syncVendors_();
  msgs.push("[업체] " + (vendorsResult.ok ? "✅" : "❌") + " " + vendorsResult.msg.split("\n")[0]);

  ui.alert("🔄 통합 동기화 결과\n\n" + msgs.join("\n"));
}


// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-02: v3 동기화 — 송장/전용양식/폐기송장/취소반품/월마감
// ═══════════════════════════════════════════════════════════════

/**
 * 송장 데이터 DB 동기화 (허브 시트 → invoices 테이블)
 * 호출 시점: 송장 수집 (partnerFetchInvoices) 완료 후
 * @param {Array} invoiceRows [{unique_id, invoice_no, carrier, sender, vendor_name}]
 * @return {Object} { ok, count, error }
 */
function _sb_syncInvoices_(invoiceRows) {
  if (!invoiceRows || !invoiceRows.length) return { ok: true, count: 0 };

  var BATCH = 200;
  var total = 0;

  for (var i = 0; i < invoiceRows.length; i += BATCH) {
    var batch = invoiceRows.slice(i, i + BATCH).map(function(row) {
      return {
        unique_id: row.unique_id || null,
        invoice_no: String(row.invoice_no || "").trim(),
        carrier: row.carrier || null,
        carrier_code: row.carrier_code || null,
        sender: row.sender || null,
        vendor_name: row.vendor_name || null,
        order_unique_id: row.order_unique_id || null,
        status: row.status || "수집완료",
        matched_at: row.matched_at || new Date().toISOString()
      };
    }).filter(function(r) { return r.invoice_no; });

    if (batch.length > 0) {
      var res = _sb_post_("invoices", batch, true, "invoice_no");
      if (res.ok) total += batch.length;
      else Logger.log("[SB_INVOICES] UPSERT 에러: " + res.error);
    }
    if (i + BATCH < invoiceRows.length) Utilities.sleep(300);
  }

  Logger.log("[SB_INVOICES] 동기화 완료: " + total + "건");
  return { ok: true, count: total };
}

/**
 * 송장 매칭 결과를 orders 테이블에 반영
 * 호출 시점: 송장 수집/매칭 완료 후
 * @param {Array} matchRows [{unique_id, invoice_no}]
 */
function _sb_syncInvoiceMatch_(matchRows) {
  if (!matchRows || !matchRows.length) return { ok: true, count: 0 };

  var updated = 0;
  for (var i = 0; i < matchRows.length; i++) {
    var uid = matchRows[i].unique_id;
    var inv = matchRows[i].invoice_no;
    if (!uid || !inv) continue;

    var res = _sb_patch_("orders", "unique_id=eq." + encodeURIComponent(uid), {
      invoice_no: inv,
      status: "배송중"
    });
    if (res.ok) updated++;

    // 매칭 로그 기록
    _sb_post_("invoice_match_log", {
      invoice_no: inv,
      unique_id: uid,
      vendor_name: matchRows[i].vendor_name || null,
      match_type: matchRows[i].match_type || "auto",
      match_source: matchRows[i].match_source || "gas"
    });

    if (i % 50 === 49) Utilities.sleep(300);
  }

  Logger.log("[SB_MATCH] 매칭 반영: " + updated + "건");
  return { ok: true, count: updated };
}

/**
 * 대리공급 전용양식 데이터 DB 동기화
 * 호출 시점: 대리공급 Push 완료 후
 * @param {Array} pushRows [{vendor_name, unique_id, ecount_code, item_name, qty, recipient, phone, address, ...}]
 */
function _sb_syncExclusiveOrders_(pushRows) {
  if (!pushRows || !pushRows.length) return { ok: true, count: 0 };

  var BATCH = 200;
  var total = 0;
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  for (var i = 0; i < pushRows.length; i += BATCH) {
    var batch = pushRows.slice(i, i + BATCH).map(function(row) {
      return {
        vendor_name: row.vendor_name || "",
        unique_id: row.unique_id || null,
        push_date: today,
        ecount_code: row.ecount_code || null,
        item_name: row.item_name || null,
        qty: parseInt(row.qty) || 1,
        recipient: row.recipient || null,
        phone: row.phone || null,
        address: row.address || null,
        zipcode: row.zipcode || null,
        delivery_msg: row.delivery_msg || null,
        invoice_no: row.invoice_no || null,
        unit_price: parseFloat(row.unit_price) || 0,
        settle_amount: parseFloat(row.settle_amount) || 0,
        sender_name: row.sender_name || null,
        sender_phone: row.sender_phone || null,
        sender_address: row.sender_address || null,
        shipping_fee: parseFloat(row.shipping_fee) || 0,
        note: row.note || null,
        status: row.status || "대기",
        source: row.source || "push"
      };
    }).filter(function(r) { return r.vendor_name; });

    if (batch.length > 0) {
      var res = _sb_post_("exclusive_orders", batch, true, "unique_id");
      if (res.ok) total += batch.length;
      else Logger.log("[SB_EXCLUSIVE] UPSERT 에러: " + res.error);
    }
    if (i + BATCH < pushRows.length) Utilities.sleep(300);
  }

  Logger.log("[SB_EXCLUSIVE] 동기화 완료: " + total + "건");
  return { ok: true, count: total };
}

/**
 * 폐기송장 DB 동기화
 * 호출 시점: 폐기송장 적용 후
 * @param {Array} voidRows [{invoice_no, original_unique_id, vendor_name, reason, void_type}]
 */
function _sb_syncVoidInvoices_(voidRows) {
  if (!voidRows || !voidRows.length) return { ok: true, count: 0 };

  var batch = voidRows.map(function(row) {
    return {
      invoice_no: String(row.invoice_no || "").trim(),
      original_unique_id: row.original_unique_id || null,
      vendor_name: row.vendor_name || null,
      reason: row.reason || null,
      void_type: row.void_type || "폐기",
      status: row.status || "처리완료",
      voided_at: new Date().toISOString()
    };
  }).filter(function(r) { return r.invoice_no; });

  if (!batch.length) return { ok: true, count: 0 };

  var res = _sb_post_("void_invoices", batch, true, "invoice_no");
  Logger.log("[SB_VOID] 폐기송장 동기화: " + (res.ok ? batch.length + "건" : "에러 " + res.error));
  return { ok: res.ok, count: batch.length, error: res.error };
}

/**
 * 취소/반품 DB 동기화
 * 호출 시점: 취소/반품 수집 후
 * @param {Array} crRows [{unique_id, vendor_name, type, reason, ecount_code, item_name, qty, ...}]
 */
function _sb_syncCancelReturns_(crRows) {
  if (!crRows || !crRows.length) return { ok: true, count: 0 };

  var batch = crRows.map(function(row) {
    return {
      unique_id: row.unique_id || null,
      order_unique_id: row.order_unique_id || null,
      vendor_name: row.vendor_name || null,
      type: row.type || "취소",
      reason: row.reason || null,
      ecount_code: row.ecount_code || null,
      item_name: row.item_name || null,
      qty: parseInt(row.qty) || 1,
      recipient: row.recipient || null,
      phone: row.phone || null,
      invoice_no: row.invoice_no || null,
      status: row.status || "접수"
    };
  });

  var res = _sb_post_("cancel_returns", batch, true, "unique_id");
  Logger.log("[SB_CR] 취소/반품 동기화: " + (res.ok ? batch.length + "건" : "에러 " + res.error));
  return { ok: res.ok, count: batch.length, error: res.error };
}

/**
 * 월별 정산 DB 동기화
 * 호출 시점: 월별 마감 완료 후
 * @param {string} vendorName 업체명
 * @param {string} settleMonth 정산월 (예: "2026-07")
 * @param {number} totalOrders 주문 건수
 * @param {number} totalAmount 정산 금액
 * @param {string} settleType 대리판매/대리공급
 */
function _sb_syncSettlement_(vendorName, settleMonth, totalOrders, totalAmount, settleType) {
  var data = {
    vendor_name: vendorName,
    settle_month: settleMonth,
    total_orders: totalOrders || 0,
    total_amount: totalAmount || 0,
    status: "정산완료",
    settle_type: settleType || "대리판매",
    settled_at: new Date().toISOString()
  };

  var res = _sb_post_("settlements", data, true, "vendor_name,settle_month");
  Logger.log("[SB_SETTLE] " + vendorName + " " + settleMonth + ": " + (res.ok ? "OK" : res.error));
  return { ok: res.ok, error: res.error };
}

/**
 * 송장 배포 완료 후 orders 테이블 distributed_at 업데이트
 * @param {Array} distributedIds [{unique_id}]
 */
function _sb_markDistributed_(distributedIds) {
  if (!distributedIds || !distributedIds.length) return;

  var now = new Date().toISOString();
  var updated = 0;

  for (var i = 0; i < distributedIds.length; i++) {
    var uid = distributedIds[i].unique_id || distributedIds[i];
    if (!uid) continue;

    var res = _sb_patch_("orders", "unique_id=eq." + encodeURIComponent(uid), {
      distributed_at: now,
      status: "배송중"
    });
    if (res.ok) updated++;
    if (i % 50 === 49) Utilities.sleep(200);
  }

  Logger.log("[SB_DIST] 배포 완료 표시: " + updated + "건");
}

// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-04: 마감 데이터 DB 동기화 (GAS 마감 체계와 동일)
// ═══════════════════════════════════════════════════════════════

/**
 * 통합 일일마감 → daily_archive 테이블 동기화
 * 호출 시점: _pep_unifiedDailyArchiveScheduled_ 완료 직후
 * @param {Array<Object>} archiveRows 19열 구조의 행 배열
 *   [{source, recorded_at, order_no, invoice_no, recipient, phone, mobile,
 *     address, ecount_code, item_name, qty, delivery_msg, vendor_or_seller,
 *     shipping_fee, note, vendor_name, order_type, unit_price, settle_amount}]
 * @return {{ok: boolean, count: number, error?: string}}
 */
function _sb_syncDailyArchive_(archiveRows) {
  if (!archiveRows || !archiveRows.length) return { ok: true, count: 0 };

  var BATCH = 200;
  var total = 0;
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  for (var i = 0; i < archiveRows.length; i += BATCH) {
    var batch = archiveRows.slice(i, i + BATCH).map(function(row) {
      return {
        source: row.source || "",
        recorded_at: row.recorded_at || new Date().toISOString(),
        order_no: row.order_no || null,
        invoice_no: row.invoice_no || null,
        recipient: row.recipient || null,
        phone: row.phone || null,
        mobile: row.mobile || null,
        address: row.address || null,
        ecount_code: row.ecount_code || null,
        item_name: row.item_name || null,
        qty: parseInt(row.qty) || 0,
        delivery_msg: row.delivery_msg || null,
        vendor_or_seller: row.vendor_or_seller || null,
        shipping_fee: parseFloat(row.shipping_fee) || 0,
        note: row.note || null,
        vendor_name: row.vendor_name || null,
        order_type: row.order_type || null,
        unit_price: parseFloat(row.unit_price) || 0,
        settle_amount: parseFloat(row.settle_amount) || 0,
        archive_date: today
      };
    });

    if (batch.length > 0) {
      var res = _sb_post_("daily_archive", batch, false);
      if (res.ok) total += batch.length;
      else Logger.log("[SB_DA] 에러: " + res.error);
    }
    if (i + BATCH < archiveRows.length) Utilities.sleep(300);
  }

  Logger.log("[SB_DA] 통합 일일마감 동기화: " + total + "건");
  return { ok: true, count: total };
}

/**
 * 대리판매 월별 마감 → settle_partner_sales 테이블 동기화
 * 호출 시점: _pms_processOneFile_ 에서 마감탭에 행 이동 완료 후
 * @param {string} vendorName 업체명
 * @param {string} settleMonth 정산월 (yyyy-MM)
 * @param {Array<Object>} rows 마감 행 배열
 *   [{unique_id, order_date, ecount_code, item_name, qty, recipient, phone,
 *     address, message, unit_price, note, invoice_no, status}]
 * @return {{ok: boolean, count: number}}
 */
function _sb_syncPartnerSettle_(vendorName, settleMonth, rows) {
  if (!rows || !rows.length) return { ok: true, count: 0 };

  var BATCH = 200;
  var total = 0;

  for (var i = 0; i < rows.length; i += BATCH) {
    var batch = rows.slice(i, i + BATCH).map(function(row) {
      return {
        vendor_name: vendorName,
        settle_month: settleMonth,
        unique_id: row.unique_id || null,
        order_date: row.order_date || null,
        ecount_code: row.ecount_code || null,
        item_name: row.item_name || null,
        qty: parseInt(row.qty) || 1,
        recipient: row.recipient || null,
        phone: row.phone || null,
        address: row.address || null,
        message: row.message || null,
        unit_price: parseFloat(row.unit_price) || 0,
        note: row.note || null,
        invoice_no: row.invoice_no || null,
        status: row.status || "마감완료"
      };
    }).filter(function(r) { return r.vendor_name; });

    if (batch.length > 0) {
      var res = _sb_post_("settle_partner_sales", batch, false);
      if (res.ok) total += batch.length;
      else Logger.log("[SB_SPS] 에러: " + res.error);
    }
    if (i + BATCH < rows.length) Utilities.sleep(300);
  }

  // 정산 요약도 업데이트
  var totalAmount = 0;
  rows.forEach(function(r) { totalAmount += (parseFloat(r.unit_price) || 0) * (parseInt(r.qty) || 1); });
  _sb_syncSettlement_(vendorName, settleMonth, rows.length, totalAmount, "대리판매");

  Logger.log("[SB_SPS] 대리판매 마감 동기화: " + vendorName + " " + settleMonth + " " + total + "건");
  return { ok: true, count: total };
}

/**
 * 대리공급 월별 마감 → settle_exclusive 테이블 동기화
 * 호출 시점: _pea_processOneFile_ 에서 전용 마감탭에 행 이동 완료 후
 * @param {string} vendorName 업체명
 * @param {string} settleMonth 정산월 (yyyy-MM)
 * @param {Array<Object>} rows 마감 행 배열
 *   [{unique_id, push_date, ecount_code, item_name, qty, recipient, phone,
 *     address, delivery_msg, invoice_no, unit_price, settle_amount, shipping_fee, note, status}]
 * @return {{ok: boolean, count: number}}
 */
function _sb_syncExclusiveSettle_(vendorName, settleMonth, rows) {
  if (!rows || !rows.length) return { ok: true, count: 0 };

  var BATCH = 200;
  var total = 0;

  for (var i = 0; i < rows.length; i += BATCH) {
    var batch = rows.slice(i, i + BATCH).map(function(row) {
      return {
        vendor_name: vendorName,
        settle_month: settleMonth,
        unique_id: row.unique_id || null,
        push_date: row.push_date || null,
        ecount_code: row.ecount_code || null,
        item_name: row.item_name || null,
        qty: parseInt(row.qty) || 1,
        recipient: row.recipient || null,
        phone: row.phone || null,
        address: row.address || null,
        delivery_msg: row.delivery_msg || null,
        invoice_no: row.invoice_no || null,
        unit_price: parseFloat(row.unit_price) || 0,
        settle_amount: parseFloat(row.settle_amount) || 0,
        shipping_fee: parseFloat(row.shipping_fee) || 0,
        note: row.note || null,
        status: row.status || "마감완료"
      };
    }).filter(function(r) { return r.vendor_name; });

    if (batch.length > 0) {
      var res = _sb_post_("settle_exclusive", batch, false);
      if (res.ok) total += batch.length;
      else Logger.log("[SB_SE] 에러: " + res.error);
    }
    if (i + BATCH < rows.length) Utilities.sleep(300);
  }

  // 정산 요약도 업데이트
  var totalAmount = 0;
  rows.forEach(function(r) { totalAmount += parseFloat(r.settle_amount) || 0; });
  _sb_syncSettlement_(vendorName, settleMonth, rows.length, totalAmount, "대리공급");

  Logger.log("[SB_SE] 대리공급 마감 동기화: " + vendorName + " " + settleMonth + " " + total + "건");
  return { ok: true, count: total };
}

/**
 * 마감 완료 후 라이브 테이블에서 상태 업데이트
 * @param {string} table 'orders' or 'exclusive_orders'
 * @param {Array<string>} uniqueIds 마감된 행의 unique_id 목록
 */
function _sb_markArchived_(table, uniqueIds) {
  if (!uniqueIds || !uniqueIds.length) return;

  var now = new Date().toISOString();
  var updated = 0;
  for (var i = 0; i < uniqueIds.length; i++) {
    var uid = uniqueIds[i];
    if (!uid) continue;
    var res = _sb_patch_(table, "unique_id=eq." + encodeURIComponent(uid), {
      status: "마감완료",
      updated_at: now
    });
    if (res.ok) updated++;
    if (i % 100 === 99) Utilities.sleep(200);
  }
  Logger.log("[SB_ARCHIVE] " + table + " 마감 표시: " + updated + "/" + uniqueIds.length + "건");
}
