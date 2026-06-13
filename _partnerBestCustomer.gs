/**
 * [협력업체] 베스트 고객 TOP10 분석  v1.1
 * 파일: _partnerBestCustomer.gs
 *
 * ★ 기능: 각 업체 시트의 발주 마감탭(최근 6개월) 데이터를 분석하여
 *   주문수 / 금액 / 단골(발주주기) 기준 베스트 고객 TOP10 산출
 *   + 품목별 판매수량/금액 기준 베스트 품목 TOP10 산출
 * ★ 결과: 해당 업체 시트의 「분석데이타」탭에 기록
 * ★ 취소/반품 행 제외 (실매출 기반)
 */

// ═══════════════════════════════════════════
//  상수
// ═══════════════════════════════════════════
var _BC_TAB_NAME      = "분석데이타";
var _BC_MONTHS        = 6;         // 최근 6개월 분석
var _BC_TOP_N         = 10;
var _BC_MIN_ORDERS    = 3;         // 단골 분석 최소 주문 건수
var _BC_HEADER_ROW    = 4;         // 마감탭 헤더 행
var _BC_DATA_START    = 5;         // 마감탭 데이터 시작 행

// ═══════════════════════════════════════════
//  메뉴 진입점 (업체 선택)
// ═══════════════════════════════════════════

function partnerBestCustomerAnalysis() {
  var ui    = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일 없음");

  // 업체 선택 목록 구성
  var names = [];
  for (var i = 0; i < files.length; i++) {
    names.push((i + 1) + ". " + files[i].name.replace("[협력업체] ", ""));
  }

  var resp = ui.prompt(
    "🏆 베스트 고객 분석",
    "분석할 업체 번호를 입력하세요:\n\n" + names.join("\n") + "\n\n" +
    "(여러 업체: 쉼표 구분, 예: 1,3,5)\n(전체: all)",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var input = String(resp.getResponseText()).trim().toLowerCase();
  var targetFiles = [];

  if (input === "all" || input === "전체") {
    targetFiles = files;
  } else {
    var nums = input.split(/[,\s]+/);
    for (var n = 0; n < nums.length; n++) {
      var idx = parseInt(nums[n], 10) - 1;
      if (idx >= 0 && idx < files.length) targetFiles.push(files[idx]);
    }
  }

  if (!targetFiles.length) return ui.alert("선택된 업체가 없습니다.");

  // 분석 실행
  var results = [];
  for (var t = 0; t < targetFiles.length; t++) {
    try {
      var r = _bc_analyzePartner_(targetFiles[t]);
      results.push(r);
    } catch (e) {
      results.push({ name: targetFiles[t].name, error: e.message });
    }
  }

  // 결과 요약
  var msg = "🏆 베스트 고객 분석 완료\n\n";
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    var nm = String(r.name).replace("[협력업체] ", "");
    if (r.error) {
      msg += "❌ " + nm + ": " + r.error + "\n";
    } else {
      msg += "✅ " + nm + ": " + r.customers + "명 분석, " + r.orders + "건\n";
    }
  }
  ui.alert(msg);
}

// ═══════════════════════════════════════════
//  핵심: 단일 업체 분석
// ═══════════════════════════════════════════

function _bc_analyzePartner_(fileInfo) {
  var ss = SpreadsheetApp.openById(fileInfo.id);

  // 최근 6개월 마감탭 이름 생성
  var tabNames = _bc_recentMonthTabNames_(_BC_MONTHS);

  // 전체 마감탭에서 데이터 수집
  var allRows = [];
  for (var ti = 0; ti < tabNames.length; ti++) {
    var tab = ss.getSheetByName(tabNames[ti]);
    if (!tab) continue;

    var lr = tab.getLastRow();
    if (lr < _BC_DATA_START) continue;

    // 헤더에서 열 매핑
    var headers = tab.getRange(_BC_HEADER_ROW, 1, 1, tab.getLastColumn()).getValues()[0];
    var cMap = _bc_mapColumns_(headers);
    if (cMap.recipient === -1) continue;

    // 데이터 읽기
    var data = tab.getRange(_BC_DATA_START, 1, lr - _BC_DATA_START + 1, tab.getLastColumn()).getValues();

    for (var r = 0; r < data.length; r++) {
      var row = data[r];

      // 빈 행 스킵
      var recip = String(row[cMap.recipient] || "").trim();
      if (!recip) continue;

      // 취소/반품 제외 (실매출 기반)
      if (cMap.cancel !== -1 && row[cMap.cancel] === true) continue;
      if (cMap.returnC !== -1 && row[cMap.returnC] === true) continue;

      // 날짜 파싱
      var dateStr = cMap.date !== -1 ? _pms_parseDateStr_(row[cMap.date]) : null;

      // 전화번호 끝4자리
      var phone = String(row[cMap.phone] || "").replace(/[^0-9]/g, "");
      var phone4 = phone.length >= 4 ? phone.slice(-4) : phone;

      // 금액
      var price = cMap.price !== -1 ? (Number(row[cMap.price]) || 0) : 0;

      // 수량
      var qty = cMap.qty !== -1 ? (Number(row[cMap.qty]) || 0) : 0;

      // 품목명 / 이카운트코드
      var itemName = cMap.itemName !== -1 ? String(row[cMap.itemName] || "").trim() : "";
      var itemCode = cMap.itemCode !== -1 ? String(row[cMap.itemCode] || "").trim() : "";

      allRows.push({
        key:   recip + "_" + phone4,
        name:  recip,
        phone: phone4,
        date:  dateStr,
        price: price,
        qty:   qty,
        itemName: itemName,
        itemCode: itemCode
      });
    }
  }

  if (!allRows.length) {
    return { name: fileInfo.name, error: "마감탭 데이터 없음", customers: 0, orders: 0 };
  }

  // 고객별 집계
  var customers = _bc_aggregate_(allRows);
  var custArr   = _bc_toArray_(customers);

  // TOP10 산출
  var topOrders = _bc_topN_(custArr, "orders", _BC_TOP_N);
  var topAmount = _bc_topN_(custArr, "totalPrice", _BC_TOP_N);
  var topFreq   = _bc_topNFreq_(custArr, _BC_TOP_N, _BC_MIN_ORDERS);

  // 품목별 집계 + TOP10 산출
  var items    = _bc_aggregateItems_(allRows);
  var itemArr  = _bc_toArray_(items);
  var topItems = _bc_topN_(itemArr, "totalQty", _BC_TOP_N);

  // 결과 탭에 기록
  _bc_writeResults_(ss, topOrders, topAmount, topFreq, topItems, tabNames);

  return {
    name: fileInfo.name,
    customers: custArr.length,
    orders: allRows.length
  };
}

// ═══════════════════════════════════════════
//  최근 N개월 마감탭 이름 생성
// ═══════════════════════════════════════════

function _bc_recentMonthTabNames_(months) {
  var now   = new Date();
  var names = [];
  for (var i = 0; i < months; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var yyyy = d.getFullYear();
    var mm   = d.getMonth() + 1;
    names.push("(" + yyyy + "년 " + mm + "월) 발주 마감");
  }
  return names;
}

// ═══════════════════════════════════════════
//  마감탭 열 매핑
//  ★ 2026-06-13 통합: _pt_buildOrderTabColumnMap 위임 래퍼
//  통합 매핑에 없는 cancel/returnC만 추가 스캔
// ═══════════════════════════════════════════

function _bc_mapColumns_(headers) {
  var full = _pt_buildOrderTabColumnMap(headers);

  // 통합 매핑에 없는 필드: cancel, returnC (마감탭 전용 체크박스)
  var cancel = -1, returnC = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (cancel === -1 && h === "취소") cancel = i;
    else if (returnC === -1 && h === "반품") returnC = i;
  }

  return {
    date:      full.date,
    recipient: full.recipient,
    phone:     full.phone,
    price:     full.unitPrice,   // 정산금액/확정단가
    qty:       full.qty,
    cancel:    cancel,           // 마감탭 전용
    returnC:   returnC,          // 마감탭 전용
    itemName:  full.item,        // 품목명
    itemCode:  full.code         // 이카운트코드
  };
}

// ═══════════════════════════════════════════
//  고객별 집계
// ═══════════════════════════════════════════

function _bc_aggregate_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!map[r.key]) {
      map[r.key] = {
        name: r.name,
        phone: r.phone,
        orders: 0,
        totalQty: 0,
        totalPrice: 0,
        dates: [],
        firstDate: null,
        lastDate: null
      };
    }
    var c = map[r.key];
    c.orders++;
    c.totalQty += r.qty;
    c.totalPrice += r.price;
    if (r.date) {
      c.dates.push(r.date);
      if (!c.firstDate || r.date < c.firstDate) c.firstDate = r.date;
      if (!c.lastDate || r.date > c.lastDate)   c.lastDate  = r.date;
    }
  }
  return map;
}

function _bc_toArray_(map) {
  var arr = [];
  for (var k in map) {
    if (map.hasOwnProperty(k)) arr.push(map[k]);
  }
  return arr;
}

// ═══════════════════════════════════════════
//  품목별 집계
// ═══════════════════════════════════════════

function _bc_aggregateItems_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // 품목코드 또는 품목명으로 키 생성 (코드 우선)
    var code = r.itemCode || "";
    var name = r.itemName || "";
    if (!code && !name) continue;
    var key = code || name;

    if (!map[key]) {
      map[key] = {
        itemCode:   code,
        itemName:   name,
        totalQty:   0,
        totalPrice: 0,
        orderCount: 0,
        customers:  {}  // 고유 고객 수 카운트용
      };
    }
    var item = map[key];
    // 품목명이 비어있었으면 채우기
    if (!item.itemName && name) item.itemName = name;
    if (!item.itemCode && code) item.itemCode = code;
    item.totalQty   += r.qty;
    item.totalPrice += r.price;
    item.orderCount++;
    // 고유 고객 수
    if (r.key) item.customers[r.key] = true;
  }
  // 고유 고객 수를 숫자로 변환
  for (var k in map) {
    if (map.hasOwnProperty(k)) {
      var custKeys = map[k].customers;
      var cnt = 0;
      for (var ck in custKeys) { if (custKeys.hasOwnProperty(ck)) cnt++; }
      map[k].uniqueCustomers = cnt;
      delete map[k].customers;
    }
  }
  return map;
}

// ═══════════════════════════════════════════
//  TOP N 산출
// ═══════════════════════════════════════════

function _bc_topN_(arr, field, n) {
  var sorted = arr.slice().sort(function(a, b) { return b[field] - a[field]; });
  return sorted.slice(0, n);
}

function _bc_topNFreq_(arr, n, minOrders) {
  // 최소 주문 건수 필터 + 평균 발주 간격 + 규칙성 + 최근간격 계산
  var eligible = [];
  for (var i = 0; i < arr.length; i++) {
    var c = arr[i];
    if (c.orders < minOrders || !c.firstDate || !c.lastDate || c.firstDate === c.lastDate) continue;

    // 날짜 정렬 후 간격 배열 생성
    var sortedDates = c.dates.slice().sort();
    var intervals = [];
    for (var di = 1; di < sortedDates.length; di++) {
      var da = _bc_parseYmd_(sortedDates[di - 1]);
      var db = _bc_parseYmd_(sortedDates[di]);
      if (da && db) {
        var gap = Math.round((db - da) / (1000 * 60 * 60 * 24));
        if (gap > 0) intervals.push(gap);
      }
    }
    if (!intervals.length) continue;

    // 평균 간격
    var sum = 0;
    for (var si = 0; si < intervals.length; si++) sum += intervals[si];
    c.avgInterval = Math.round(sum / intervals.length * 10) / 10;

    // 규칙성: 변동계수(CV) — 낮을수록 규칙적
    var variance = 0;
    for (var vi = 0; vi < intervals.length; vi++) {
      variance += (intervals[vi] - c.avgInterval) * (intervals[vi] - c.avgInterval);
    }
    var stdDev = Math.sqrt(variance / intervals.length);
    var cv = c.avgInterval > 0 ? stdDev / c.avgInterval : 0;
    // 규칙성 라벨
    if (cv <= 0.3) c.regularity = "⭐ 매우규칙";
    else if (cv <= 0.6) c.regularity = "✅ 규칙";
    else if (cv <= 1.0) c.regularity = "⚠️ 불규칙";
    else c.regularity = "❌ 매우불규칙";

    // 최근 간격 (마지막 주문 사이 간격)
    c.recentInterval = intervals[intervals.length - 1];

    // 간격 상세 (각 간격 나열, 최대 8개)
    var detailArr = intervals.slice(-8).map(function(g) { return g + "일"; });
    c.intervalDetail = detailArr.join(" → ");

    // 전체 기간
    var d1 = _bc_parseYmd_(c.firstDate);
    var d2 = _bc_parseYmd_(c.lastDate);
    c.spanDays = d1 && d2 ? Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) : 0;

    eligible.push(c);
  }

  // 평균 간격이 짧을수록 단골
  eligible.sort(function(a, b) { return a.avgInterval - b.avgInterval; });
  return eligible.slice(0, n);
}

function _bc_parseYmd_(str) {
  if (!str || str.length < 8) return null;
  var y = parseInt(str.substring(0, 4), 10);
  var m = parseInt(str.substring(4, 6), 10) - 1;
  var d = parseInt(str.substring(6, 8), 10);
  return new Date(y, m, d);
}

// ═══════════════════════════════════════════
//  결과 기록 → 「분석데이타」탭
// ═══════════════════════════════════════════

function _bc_writeResults_(ss, topOrders, topAmount, topFreq, topItems, scannedTabs) {
  var tab = ss.getSheetByName(_BC_TAB_NAME);
  if (!tab) tab = ss.insertSheet(_BC_TAB_NAME);

  // 기존 내용 클리어
  tab.clear();

  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");

  // 기간 계산
  var monthNames = [];
  for (var i = scannedTabs.length - 1; i >= 0; i--) {
    var m = scannedTabs[i].match(/\((.+?)\)/);
    if (m) monthNames.push(m[1]);
  }
  var periodStr = monthNames.length ? monthNames[0] + " ~ " + monthNames[monthNames.length - 1] : "";

  var rows = [];
  var _BC_COLS_ = 8; // 단골 TOP10 확장으로 8열 사용

  // ── 1행: 제목 ──
  rows.push(["🏆 베스트 고객 & 품목 분석", "", "", "", "", ""]);
  // ── 2행: 기간 ──
  rows.push(["분석 기간: " + periodStr, "", "", "갱신일: " + now, "", ""]);
  // ── 3행: 빈 줄 ──
  rows.push(["", "", "", "", "", ""]);

  // ── 섹션 A: 주문수 TOP10 ──
  rows.push(["📊 주문수 TOP10", "", "", "", "", ""]);
  rows.push(["순위", "고객명", "전화(끝4)", "총 주문건수", "총 수량", "최근 주문일"]);
  for (var a = 0; a < topOrders.length; a++) {
    var o = topOrders[a];
    rows.push([a + 1, o.name, "'" + o.phone, o.orders, o.totalQty, o.lastDate || ""]);
  }
  for (var pad = topOrders.length; pad < _BC_TOP_N; pad++) {
    rows.push([pad + 1, "", "", "", "", ""]);
  }

  // ── 빈 줄 ──
  rows.push(["", "", "", "", "", ""]);

  // ── 섹션 B: 금액 TOP10 ──
  rows.push(["💰 금액 TOP10", "", "", "", "", ""]);
  rows.push(["순위", "고객명", "전화(끝4)", "총 정산금액", "총 주문건수", "평균 단가"]);
  for (var b = 0; b < topAmount.length; b++) {
    var am = topAmount[b];
    var avgP = am.orders > 0 ? Math.round(am.totalPrice / am.orders) : 0;
    rows.push([b + 1, am.name, "'" + am.phone, am.totalPrice, am.orders, avgP]);
  }
  for (var pad2 = topAmount.length; pad2 < _BC_TOP_N; pad2++) {
    rows.push([pad2 + 1, "", "", "", "", ""]);
  }

  // ── 빈 줄 ──
  rows.push(["", "", "", "", "", ""]);

  // ── 섹션 C: 단골 TOP10 ──
  rows.push(["📅 단골 고객 TOP10 (발주 주기)", "", "", "", "", "", "", ""]);
  rows.push(["순위", "고객명", "전화(끝4)", "평균 발주간격", "최근 간격", "규칙성", "총 주문건수", "간격 상세"]);
  for (var c = 0; c < topFreq.length; c++) {
    var fr = topFreq[c];
    rows.push([
      c + 1, fr.name, "'" + fr.phone,
      fr.avgInterval + "일",
      (fr.recentInterval || "") + "일",
      fr.regularity || "",
      fr.orders,
      fr.intervalDetail || ""
    ]);
  }
  for (var pad3 = topFreq.length; pad3 < _BC_TOP_N; pad3++) {
    rows.push([pad3 + 1, "", "", "", "", "", "", ""]);
  }

  // ── 빈 줄 ──
  rows.push(["", "", "", "", "", ""]);

  // ── 섹션 D: 베스트 품목 TOP10 ──
  rows.push(["🔥 베스트 품목 TOP10 (판매수량 기준)", "", "", "", "", "", "", ""]);
  rows.push(["순위", "품목명", "이카운트코드", "총 판매수량", "총 정산금액", "주문건수", "고유고객수", "건당 평균수량"]);
  for (var d = 0; d < topItems.length; d++) {
    var it = topItems[d];
    var avgQtyPerOrder = it.orderCount > 0 ? Math.round(it.totalQty / it.orderCount * 10) / 10 : 0;
    rows.push([
      d + 1,
      it.itemName || "",
      it.itemCode || "",
      it.totalQty,
      it.totalPrice,
      it.orderCount,
      it.uniqueCustomers || 0,
      avgQtyPerOrder
    ]);
  }
  for (var pad4 = topItems.length; pad4 < _BC_TOP_N; pad4++) {
    rows.push([pad4 + 1, "", "", "", "", "", "", ""]);
  }

  // 데이터 기록
  // 모든 행을 8열로 맞춤
  for (var ri2 = 0; ri2 < rows.length; ri2++) {
    while (rows[ri2].length < _BC_COLS_) rows[ri2].push("");
  }
  tab.getRange(1, 1, rows.length, _BC_COLS_).setValues(rows);

  // ── 스타일 적용 ──
  // 제목
  tab.getRange(1, 1, 1, _BC_COLS_).merge()
    .setBackground("#1a1a2e").setFontColor("white")
    .setFontSize(14).setFontWeight("bold").setHorizontalAlignment("center");

  // 기간/갱신일
  tab.getRange(2, 1, 1, _BC_COLS_).setBackground("#f5f5f5").setFontColor("#666666");

  // 섹션 헤더 스타일 (4개 섹션)
  var SECTION_GAP = _BC_TOP_N + 3; // 섹션 제목(1) + 헤더(1) + TOP_N 데이터(10) + 빈줄(1) = 13
  var sectionRows = [
    4,
    4 + SECTION_GAP,
    4 + SECTION_GAP * 2,
    4 + SECTION_GAP * 3
  ];
  var sectionColors = ["#1565c0", "#2e7d32", "#e65100", "#c62828"];
  var headerRows = [
    5,
    5 + SECTION_GAP,
    5 + SECTION_GAP * 2,
    5 + SECTION_GAP * 3
  ];

  for (var s = 0; s < 4; s++) {
    // 섹션 제목
    tab.getRange(sectionRows[s], 1, 1, _BC_COLS_).merge()
      .setBackground(sectionColors[s]).setFontColor("white")
      .setFontSize(11).setFontWeight("bold");

    // 컬럼 헤더
    tab.getRange(headerRows[s], 1, 1, _BC_COLS_)
      .setBackground("#eeeeee").setFontWeight("bold")
      .setHorizontalAlignment("center");

    // 데이터 영역 번호 형식
    var dataStart = headerRows[s] + 1;
    if (s === 0) {
      // 주문수: D,E열 숫자
      tab.getRange(dataStart, 4, _BC_TOP_N, 2).setNumberFormat("#,##0");
    } else if (s === 1) {
      // 금액: D,E,F열 숫자
      tab.getRange(dataStart, 4, _BC_TOP_N, 3).setNumberFormat("#,##0");
    } else if (s === 3) {
      // 베스트 품목: D,E,F,G열 숫자
      tab.getRange(dataStart, 4, _BC_TOP_N, 4).setNumberFormat("#,##0");
    }
  }

  // 열 너비
  tab.setColumnWidth(1, 50);   // 순위
  tab.setColumnWidth(2, 140);  // 고객명/품목명
  tab.setColumnWidth(3, 120);  // 전화/이카운트코드
  tab.setColumnWidth(4, 110);  // 총 주문건수/판매수량
  tab.setColumnWidth(5, 100);  // 총 수량/정산금액
  tab.setColumnWidth(6, 110);  // 규칙성/주문건수
  tab.setColumnWidth(7, 100);  // 총 주문건수/고유고객수
  tab.setColumnWidth(8, 250);  // 간격 상세/건당 평균수량

  tab.setFrozenRows(0);
  SpreadsheetApp.flush();
}
