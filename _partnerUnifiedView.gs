/**
 * 통합조회 — 주문+송장 조인 결과를 매일 밤 "전부 다시 계산"해서 단일 탭에 쓴다.
 * 파일: _partnerUnifiedView.gs
 *
 * ★ 설계 원칙: 패치가 아니라 재생성 ★
 *   기존 구조는 22:00에 한 번 매칭한 결과를 날짜별 일일마감 파일에 굳히고,
 *   송장이 늦게 오면 그 파일을 찾아가 고쳐 썼다(소급 보강). 그래서
 *     · 보강 창(14일)을 넘긴 건은 영구히 미매칭으로 남고
 *     · 매칭 로직을 고쳐도 과거 건에 소급되지 않았다.
 *
 *   이 모듈은 매 실행마다 통합조회 탭을 통째로 버리고 다시 만든다.
 *   따라서 늦게 도착한 송장도, 개선된 매칭 로직도 자동으로 전체에 반영된다.
 *   통합조회는 언제든 삭제해도 되는 파생 데이터다. 원천은 건드리지 않는다.
 *
 * ★ CS는 이 탭 하나만 읽는다 ★
 *   기존에는 일일마감 14개 파일 + 허브 + 임시기록 + 보관을 열어야 했다(최대 17회).
 *   고정 스키마 단일 탭이므로 CS는 스프레드시트 1개만 열면 된다.
 */

var _PUV_TAB_NAME_ = "통합조회";
var _PUV_DAYS_ = 14;
var _PUV_TIME_BUDGET_MS_ = 300000; // 5분. GAS 6분 제한 대비 여유
var _PUV_MAX_ROWS_ = 30000;

/**
 * 급감 방어 — 결과가 기존 탭의 절반도 안 되면 덮지 않는다.
 *
 * ★ 왜 필요한가 (2026-09-01) ★
 *   기존 방어는 "시간초과일 때만" 덮어쓰기를 막았다. 그런데 시간초과가
 *   아니면서 수집이 거의 안 된 회차가 7,800행짜리 탭을 131행으로 조용히
 *   덮었고, CS 웹앱이 하루 종일 주문을 못 찾았다. 아무도 몰랐다.
 *   14일 창은 하루가 지나도 13일이 겹친다. 절반이 사라졌다면 정상이 아니다.
 */
/**
 * 22:45 재생성이 만든 송장맵. 바로 뒤 소급 보강이 그대로 다시 쓴다.
 * 다시 만들면 1~2분이 더 들고, 22:45~23:00(마감 정리) 사이가 그만큼 좁아진다.
 */
var _PUV_LAST_INVOICE_MAP_ = null;

var _PUV_SHRINK_MIN_ = 500;    // 기존이 이보다 적으면 판정하지 않는다 (최초 구축·복구 중)
var _PUV_SHRINK_RATIO_ = 0.5;  // 기존의 50% 미만이면 의심

/** 고정 스키마 — 열 위치가 CS와의 계약이다. 임의로 순서를 바꾸지 않는다. */
var _PUV_HEADERS_ = [
  "주문일",       // A(0)
  "송장번호",     // B(1)
  "전화",         // C(2)
  "수취인",       // D(3)
  "품목명",       // E(4)
  "이카운트코드", // F(5)
  "수량",         // G(6)
  "주소",         // H(7)
  "배송메시지",   // I(8)
  "출처",         // J(9)  롯데/대리공급/대리판매/합포장/미매칭 …
  "주문번호",     // K(10) 사방넷 주문번호 또는 고유ID
  "업체",         // L(11)
  "택배사",       // M(12)
  "상태",         // N(13)
  "원천",         // O(14) daily / snapshot / hub / temp / temp_archive
  "매칭경로",     // P(15) UID / 이름전화 / 기존유지 / 없음
  "합포장",       // Q(16)
  "갱신일시",     // R(17)
];

// ═══════════════════════════════════════════
//  송장맵 — 일일마감과 같은 소스, 같은 키 규칙
// ═══════════════════════════════════════════

/**
 * 조회용 송장맵. 일일마감(_pep_archiveUnifiedDaily_)과 동일한 소스·키 규칙을 쓴다.
 * 로젠 입력탭은 일일마감이 쓰지 않으므로 여기서도 쓰지 않는다(출처 일관성).
 */
function _puv_buildInvoiceMap_(stat) {
  var map = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 롯데 (주 소스)
  try {
    var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
    var lt = _pt_getSheetByGid(invSS, _PT_SECONDARY_INVOICE_GID);
    if (lt && lt.getLastRow() >= 2) {
      var all = lt.getRange(1, 1, lt.getLastRow(), Math.max(lt.getLastColumn(), 29)).getDisplayValues();
      var hi = _pep_findLotteHeaderRow_(all);
      var cols = _pep_resolveLotteCols_(all[hi]);
      var start = hi + 1;
      if (_pep_countInvoiceCol_(all, start, cols.invoice) === 0) {
        // ★ 2026-08-27: item 을 -1 로 두면 안 된다.
        //   롯데탭은 전화·주소가 없어 이름+상품명(NI:) 이 유일한 조합키다.
        //   단일 필드 매칭을 끈 뒤로는 item 이 없으면 롯데 송장이 이름·전화
        //   경로에서 통째로 사라진다. 상품명은 AC열로 고정돼 있다.
        cols = { name: 5, invoice: 6, uid: 9, phone: -1, addr: -1, item: 28, date: 3 };
        start = (hi === 0) ? 1 : hi + 1;
        if (_pep_countInvoiceCol_(all, start, 6) === 0 && _pep_countInvoiceCol_(all, 1, 6) > 0) start = 1;
      }
      for (var i = start; i < all.length; i++) {
        var inv = _pep_normInvoiceNo_(all[i][cols.invoice]);
        if (!inv) continue;
        var uid = String(all[i][cols.uid] || "").trim();
        var picked = (cols.date >= 0) ? _pep_ymdNum_(all[i][cols.date]) : 0;
        if (uid) _pep_addInvoiceMap_(map, uid, inv, "롯데", "", picked);
        _pep_addNamePhoneInvoiceKeys_(map, all[i][cols.name],
          cols.phone >= 0 ? all[i][cols.phone] : "", inv, "롯데",
          {
            addr: cols.addr >= 0 ? all[i][cols.addr] : "",
            item: cols.item >= 0 ? all[i][cols.item] : "",
            picked: picked,
            stat: _pep_keyStat_("롯데")
          });
        stat.lotte++;
      }
    }
  } catch (e) { stat.errors.push("롯데: " + e.message); }

  // 1주출고
  try {
    var ws = _pep_loadWeeklyShipInvoiceMap_(map, { detail: {} });
    stat.weekly = (ws && ws.read) || 0;
  } catch (e) { stat.errors.push("1주출고: " + e.message); }

  // 송장원장 (마감으로 사라진 대리공급 송장)
  try {
    if (typeof _pil_addToInvoiceMap_ === "function") stat.ledger = _pil_addToInvoiceMap_(map);
  } catch (e) { stat.errors.push("송장원장: " + e.message); }

  // 전용마감+발주마감 — 재매칭은 건너뛴다. 열면 4~6분을 써서 28일 파일도 못 본다.
  try {
    if (!stat.skipPartnerArchives && typeof _pep_addAllPartnerArchivesToInvoiceMap_ === "function") {
      var through = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
      var pa = _pep_addAllPartnerArchivesToInvoiceMap_(map, through, new Date().getTime());
      stat.exclusive = pa.exclusiveArchiveRead || 0;
      stat.orderArchive = pa.orderArchiveRead || 0;
    }
  } catch (e) { stat.errors.push("협력업체마감: " + e.message); }

  // 허브 월별 아카이브 — 허브에서 빠진 대리판매 송장
  try {
    if (typeof _ha_addHubArchiveToInvoiceMap_ === "function") {
      var throughHa = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
      var ha = _ha_addHubArchiveToInvoiceMap_(map, throughHa);
      stat.hubArchive = (ha && ha.read) || 0;
    }
  } catch (e) { stat.errors.push("허브아카이브: " + e.message); }

  // 대리공급_임시기록 + 보관
  try {
    var tempSS = typeof _po_openTempSheetSs_ === "function" ? _po_openTempSheetSs_() : ss;
    var tt = _po_getNonPartnerTempTab_(tempSS);
    if (tt && tt.getLastRow() >= 2) {
      var tData = tt.getRange(2, 1, tt.getLastRow() - 1,
        Math.max(tt.getLastColumn(), _PO_TEMP_INV_COL_ + 1)).getDisplayValues();
      stat.temp += _po_addTempRowsToInvoiceMap_(map, tData, "대리공급", 0);
    }
    var at = typeof _po_getTempArchiveTab_ === "function" ? _po_getTempArchiveTab_(tempSS) : null;
    var off = typeof _PO_TEMP_ARCHIVE_COL_OFFSET_ !== "undefined" ? _PO_TEMP_ARCHIVE_COL_OFFSET_ : 2;
    if (at && at.getLastRow() >= 2) {
      var aData = at.getRange(2, 1, at.getLastRow() - 1,
        Math.max(at.getLastColumn(), _PO_TEMP_INV_COL_ + off + 1)).getDisplayValues();
      stat.temp += _po_addTempRowsToInvoiceMap_(map, aData, "대리공급(보관)", off);
    }
  } catch (e) { stat.errors.push("임시기록: " + e.message); }

  // 협력업체_발주허브
  try {
    var hubName = typeof _PO_HUB_SHEET_NAME !== "undefined" ? _PO_HUB_SHEET_NAME : "협력업체_발주허브";
    var hub = ss.getSheetByName(hubName);
    if (hub && hub.getLastRow() >= 2) {
      var hData = hub.getRange(2, 1, hub.getLastRow() - 1, Math.max(hub.getLastColumn(), 15)).getDisplayValues();
      for (var h = 0; h < hData.length; h++) {
        var hInv = String(hData[h][13] || "").trim();
        if (!hInv) continue;
        if (typeof _po_hasRealInvoice_ === "function" && !_po_hasRealInvoice_(hInv)) continue;
        var hUid = String(hData[h][2] || "").trim();
        // ★ 2026-08-27: 발주업체(B열)의 택배사를 송장과 함께 싣는다.
        //   출처 "대리판매" 만으로는 택배사를 알 수 없다.
        var hCr = typeof _pep_carrierForVendor_ === "function"
          ? _pep_carrierForVendor_(hData[h][1]) : "";
        if (hUid && !(map[hUid] && map[hUid].source === "롯데")) {
          _pep_addInvoiceMap_(map, hUid, hInv, "대리판매", hCr);
        }
        if (typeof _pt_deriveHubRowPepUid_ === "function") {
          try {
            var pep = _pt_deriveHubRowPepUid_(hData[h]);
            if (pep && pep !== hUid && !(map[pep] && map[pep].source === "롯데")) {
              _pep_addInvoiceMap_(map, pep, hInv, "대리판매", hCr);
            }
          } catch (_) {}
        }
        _pep_addNamePhoneInvoiceKeys_(map, hData[h][7], hData[h][8], hInv, "대리판매",
          {
            skipName: true, addr: hData[h][9], item: hData[h][5],
            carrier: hCr,
            stat: _pep_keyStat_("대리판매")
          });
        stat.hub++;
      }
    }
  } catch (e) { stat.errors.push("허브: " + e.message); }

  stat.keys = Object.keys(map).length;
  return map;
}

// ═══════════════════════════════════════════
//  주문 행 수집
// ═══════════════════════════════════════════

/**
 * 일일마감 파일 헤더 → 열 인덱스.
 * 운영 이력상 세 가지 레이아웃이 존재하므로 헤더로 판별한다.
 * (CS_WebApp/csOrderSearch.gs의 _cs_mapArchiveHeaders_ 와 같은 판별 규칙)
 */
function _puv_mapDailyCols_(hdr) {
  var m = {
    inv: -1, phone: -1, phone2: -1, name: -1, code: -1, item: -1, qty: -1,
    addr: -1, shipMsg: -1, src: -1, oid: -1, vendor: -1, date: -1, carrier: -1,
  };
  if (!hdr || !hdr.length) return m;

  var h0 = String(hdr[0] || "").replace(/\s/g, "");
  var h1 = String(hdr[1] || "").replace(/\s/g, "");

  // 운영 양식: A=품목코드, B=품목명, C=수량
  if (/품목코드|이카운트코드|물품코드/.test(h0) && /품목명|상품명|물품명/.test(h1)) {
    m.code = 0; m.item = 1; m.qty = 2;
  }
  // 통합 고정 레이아웃 (_UNIFIED_HEADERS_)
  if (h0 === "출처") {
    m.src = 0; m.oid = 2; m.inv = 3; m.name = 4;
    m.phone = 5; m.phone2 = 6; m.addr = 7;
    m.code = 8; m.item = 9; m.qty = 10; m.shipMsg = 11; m.vendor = 15;
    return m;
  }

  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (/보내는|송하인/.test(h)) continue;
    if (m.inv < 0 && /운송장번호|송장번호/.test(h) && !/반품/.test(h)) m.inv = i;
    if (m.src < 0 && h === "출처") m.src = i;
    // 일일마감이 기록한 택배사. "택배박스" 부분일치를 배제하려고 완전일치만 본다
    if (m.carrier < 0 && /^택배사$|^배송사$|^운송사$/.test(h)) m.carrier = i;
    if (m.name < 0 && /주문자명|수하인|수취인|받는사람|받는분|고객명/.test(h) && !/주소|전화|번호/.test(h)) m.name = i;
    if (/전화|휴대폰|핸드폰|연락처|모바일/.test(h)) {
      if (m.phone < 0) m.phone = i; else if (m.phone2 < 0) m.phone2 = i;
    }
    if (m.item < 0 && /품목명|상품명|물품명/.test(h) && !/코드/.test(h)) m.item = i;
    if (m.code < 0 && /이카운트코드|품목코드|물품코드|상품코드/.test(h)) m.code = i;
    if (m.qty < 0 && /수량/.test(h) && !/합계|박스/.test(h)) m.qty = i;
    if (m.oid < 0 && /주문번호|사방넷|고유ID/i.test(h)) m.oid = i;
    if (m.vendor < 0 && /발주업체|거래처명|업체명|판매처/.test(h)) m.vendor = i;
    if (m.date < 0 && /주문일|일자|발송일|매출일/.test(h)) m.date = i;
    if (m.shipMsg < 0 && /배송메시지|배송메세지|배송메모/.test(h)) m.shipMsg = i;
    if (m.addr < 0 && /주소/.test(h) && !/배송메시지|배송메세지|배송비|운임/.test(h)) m.addr = i;
  }
  if (m.inv < 0 && hdr.length >= 2) m.inv = hdr.length - 2;
  if (m.src < 0 && hdr.length >= 1) m.src = hdr.length - 1;
  if (m.addr < 0 && hdr.length > 7) m.addr = 7;
  return m;
}

function _puv_pick_(row, idx) {
  return idx >= 0 && idx < row.length ? String(row[idx] == null ? "" : row[idx]).trim() : "";
}

/** 일일마감 14일치 — 주문 사실의 주 저장소 */
function _puv_collectDaily_(out, stat, started) {
  var today = new Date();
  for (var d = 0; d <= _PUV_DAYS_; d++) {
    if (new Date().getTime() - started > _PUV_TIME_BUDGET_MS_) { stat.timedOut = true; return; }
    var dt = new Date(today.getTime());
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
    try {
      var ss = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
      if (!ss) continue;
      var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
      if (!tab || tab.getLastRow() < 2) continue;
      var all = tab.getRange(1, 1, tab.getLastRow(), Math.max(tab.getLastColumn(), 2)).getDisplayValues();
      var c = _puv_mapDailyCols_(all[0]);
      for (var r = 1; r < all.length; r++) {
        if (String(all[r][0] || "").indexOf("합계") !== -1) continue;
        var row = all[r];
        var name = _puv_pick_(row, c.name);
        var item = _puv_pick_(row, c.item);
        var oid = _puv_pick_(row, c.oid);
        if (!name && !item && !oid) continue;
        out.push({
          date: _puv_pick_(row, c.date) || dateStr,
          origin: "daily",
          existingInv: _puv_pick_(row, c.inv),
          existingSrc: _puv_pick_(row, c.src),
          oid: oid, name: name, item: item,
          phone: _puv_pick_(row, c.phone) || _puv_pick_(row, c.phone2),
          code: _puv_pick_(row, c.code),
          qty: _puv_pick_(row, c.qty),
          addr: _puv_pick_(row, c.addr),
          shipMsg: _puv_pick_(row, c.shipMsg),
          vendor: _puv_pick_(row, c.vendor),
          // 일일마감이 확정해 적어 둔 택배사. 통합조회는 이 값을 우선한다.
          existingCarrier: _puv_pick_(row, c.carrier),
        });
        stat.daily++;
      }
    } catch (e) { stat.errors.push(dateStr + ": " + e.message); }
  }
}

/** 판매현황_임시기록 — 아직 일일마감 파일에 못 들어간 대기 건 */
function _puv_collectSnapshot_(out, stat) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var snap = ss.getSheetByName(_SNAPSHOT_TAB_NAME_);
    if (!snap || snap.getLastRow() < 2) return;
    var lc = snap.getLastColumn();
    var hdr = snap.getRange(1, 1, 1, lc).getValues()[0];
    var data = snap.getRange(2, 1, snap.getLastRow() - 1, lc).getDisplayValues();

    // 스냅샷 구조: A(0)=날짜, B(1)=매칭키, C~Q(2~16)=판매현황 15열, 마지막=상태
    // 수하인은 O(14), 전화는 P(15) — _pep_archiveUnifiedDaily_ 의 SNAP_O/SNAP_P 와 같다
    var itemIdx = -1, codeIdx = -1, addrIdx = -1, msgIdx = -1, qtyIdx = -1;
    for (var h = 2; h < lc - 1; h++) {
      var hh = String(hdr[h] || "").replace(/\s/g, "");
      if (itemIdx < 0 && /품목명|상품명|품명/.test(hh)) itemIdx = h;
      if (codeIdx < 0 && /품목코드|이카운트코드/.test(hh)) codeIdx = h;
      if (qtyIdx < 0 && /수량/.test(hh) && !/합계|박스/.test(hh)) qtyIdx = h;
      if (addrIdx < 0 && /주소/.test(hh) && !/배송메/.test(hh)) addrIdx = h;
      if (msgIdx < 0 && /배송메시지|배송메세지/.test(hh)) msgIdx = h;
    }
    for (var i = 0; i < data.length; i++) {
      var mk = String(data[i][1] || "").trim();
      var nm = String(data[i][14] || "").trim();
      if (!mk && !nm) continue;
      out.push({
        date: _puv_normDate_(data[i][0]),
        origin: "snapshot",
        existingInv: "", existingSrc: "",
        oid: mk, name: nm,
        item: itemIdx >= 0 ? String(data[i][itemIdx] || "").trim() : "",
        phone: String(data[i][15] || "").trim(),
        code: codeIdx >= 0 ? String(data[i][codeIdx] || "").trim() : "",
        qty: qtyIdx >= 0 ? String(data[i][qtyIdx] || "").trim() : "",
        addr: addrIdx >= 0 ? String(data[i][addrIdx] || "").trim() : "",
        shipMsg: msgIdx >= 0 ? String(data[i][msgIdx] || "").trim() : "",
        vendor: "",
        status: String(data[i][lc - 1] || "").trim(),
      });
      stat.snapshot++;
    }
  } catch (e) { stat.errors.push("스냅샷: " + e.message); }
}

/** 협력업체_발주허브 — 아직 마감되지 않은 대리판매·협력 건 */
function _puv_collectHub_(out, stat, fromDate) {
  try {
    var hubName = typeof _PO_HUB_SHEET_NAME !== "undefined" ? _PO_HUB_SHEET_NAME : "협력업체_발주허브";
    var hub = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(hubName);
    if (!hub || hub.getLastRow() < 2) return;
    var data = hub.getRange(2, 1, hub.getLastRow() - 1, Math.max(hub.getLastColumn(), 15)).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var od = _puv_normDate_(data[i][3]);
      if (od && fromDate && od < fromDate) continue;
      var uid = String(data[i][2] || "").trim();
      if (!uid && !String(data[i][7] || "").trim()) continue;
      out.push({
        date: od, origin: "hub",
        existingInv: String(data[i][13] || "").trim(),
        existingSrc: "대리판매",
        oid: uid, name: String(data[i][7] || "").trim(),
        item: String(data[i][5] || "").trim(),
        phone: String(data[i][8] || "").trim(),
        code: String(data[i][4] || "").trim(),
        qty: String(data[i][6] || "").trim(),
        addr: String(data[i][9] || "").trim(),
        shipMsg: String(data[i][10] || "").trim(),
        vendor: String(data[i][1] || "").trim(),
        status: String(data[i][14] || "").trim(),
      });
      stat.hubRows++;
    }
  } catch (e) { stat.errors.push("허브주문: " + e.message); }
}

/** 대리공급_임시기록 + 보관 — 대리공급 건 */
function _puv_collectTemp_(out, stat, fromDate) {
  var off = typeof _PO_TEMP_ARCHIVE_COL_OFFSET_ !== "undefined" ? _PO_TEMP_ARCHIVE_COL_OFFSET_ : 2;
  var ss = typeof _po_openTempSheetSs_ === "function" ? _po_openTempSheetSs_() : SpreadsheetApp.getActiveSpreadsheet();

  function read(label, tab, o) {
    if (!tab || tab.getLastRow() < 2) return;
    var lc = Math.max(tab.getLastColumn(), _PO_TEMP_INV_COL_ + o + 1);
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, lc).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var od = _puv_normDate_(data[i][2 + o]);
      if (od && fromDate && od < fromDate) continue;
      var uid = String(data[i][_PO_TEMP_UID_COL_ + o] || "").trim();
      var nm = String(data[i][12 + o] || "").trim();
      if (!uid && !nm) continue;
      out.push({
        date: od, origin: label,
        existingInv: String(data[i][_PO_TEMP_INV_COL_ + o] || "").trim(),
        existingSrc: "대리공급",
        oid: uid, name: nm,
        item: String(data[i][4 + o] || "").trim(),
        phone: String(data[i][7 + o] || data[i][8 + o] || "").trim(),
        code: String(data[i][3 + o] || "").trim(),
        qty: String(data[i][6 + o] || "").trim(),
        addr: String(data[i][9 + o] || "").trim(),
        shipMsg: String(data[i][10 + o] || "").trim(),
        vendor: _puv_vendorLabel_(data[i][22 + o]),
        status: String(data[i][_PO_TEMP_STATUS_COL_ + o] || "").trim(),
      });
      stat.tempRows++;
    }
  }
  try { read("temp", _po_getNonPartnerTempTab_(ss), 0); }
  catch (e) { stat.errors.push("임시기록주문: " + e.message); }
  try { read("temp_archive", _po_getTempArchiveTab_(ss), off); }
  catch (e) { stat.errors.push("보관주문: " + e.message); }
}

/** 임시기록 W열은 업체prefix(JT/SW…) — 운영자가 읽을 수 있는 업체명으로 바꾼다 */
function _puv_vendorLabel_(prefix) {
  var p = String(prefix || "").trim().toUpperCase();
  if (!p) return "";
  if (typeof _pep_resolvePrefixAlias_ === "function") p = _pep_resolvePrefixAlias_(p);
  if (typeof _PEP_VENDOR_LABELS_ !== "undefined" && _PEP_VENDOR_LABELS_[p]) {
    return _PEP_VENDOR_LABELS_[p];
  }
  return p;
}

function _puv_normDate_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  var compact = s.replace(/[^0-9]/g, "");
  if (compact.length >= 8) {
    return compact.slice(0, 4) + "-" + compact.slice(4, 6) + "-" + compact.slice(6, 8);
  }
  var m = s.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
  if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  return "";
}

// ═══════════════════════════════════════════
//  재생성
// ═══════════════════════════════════════════

/**
 * 통합조회 전체 재생성.
 * @return {Object} 통계
 */
function _puv_rebuild_(opt) {
  opt = opt || {};
  var started = new Date().getTime();
  var stat = {
    lotte: 0, weekly: 0, temp: 0, hub: 0, ledger: 0, keys: 0,
    daily: 0, snapshot: 0, hubRows: 0, tempRows: 0,
    rows: 0, matched: 0, unmatched: 0,
    byPath: {}, timedOut: false, errors: [],
  };

  try {
    var invoiceMap = _puv_buildInvoiceMap_(stat);
    _PUV_LAST_INVOICE_MAP_ = invoiceMap; // 소급 보강이 재사용

    var fromDt = new Date();
    fromDt.setDate(fromDt.getDate() - _PUV_DAYS_);
    var fromDate = Utilities.formatDate(fromDt, "Asia/Seoul", "yyyy-MM-dd");

    var orders = [];
    _puv_collectDaily_(orders, stat, started);
    _puv_collectSnapshot_(orders, stat);
    _puv_collectHub_(orders, stat, fromDate);
    _puv_collectTemp_(orders, stat, fromDate);

    // 중복 정리 — 같은 주문일·주문번호·품목·수량이면 1건. 송장 있는 쪽을 남긴다.
    var best = {};
    var order = [];
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      var key = _puv_dedupKey_(o);
      if (!best[key]) { best[key] = o; order.push(key); continue; }
      var prev = best[key];
      var prevHas = !!_pep_normInvoiceNo_(prev.existingInv);
      var curHas = !!_pep_normInvoiceNo_(o.existingInv);
      // daily 우선(정산 기록), 그다음 송장 보유
      if ((curHas && !prevHas) || (prev.origin !== "daily" && o.origin === "daily")) best[key] = o;
    }

    var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var rows = [];
    for (var k = 0; k < order.length && rows.length < _PUV_MAX_ROWS_; k++) {
      var rec = best[order[k]];
      var res = _puv_resolveInvoice_(rec, invoiceMap);
      stat.byPath[res.path] = (stat.byPath[res.path] || 0) + 1;
      if (res.inv) stat.matched++; else stat.unmatched++;
      rows.push([
        rec.date || "", res.inv, rec.phone || "", rec.name || "",
        rec.item || "", rec.code || "", rec.qty || "",
        rec.addr || "", rec.shipMsg || "",
        res.inv ? (res.src || "") : "미매칭",
        rec.oid || "", rec.vendor || "",
        _puv_carrier_(res.src, rec.vendor, rec.existingCarrier || res.carrier), rec.status || "",
        rec.origin, res.path,
        _pep_isCombinedPackItem_(rec.item) ? "Y" : "",
        nowStr,
      ]);
    }
    stat.rows = rows.length;
    var existing = _puv_existingRowCount_();
    stat.existingRows = existing;

    // 덮어쓰면 안 되는 두 경우. CS 입장에서 "조금 낡았지만 온전한 것"이
    // "최신이지만 빠진 것"보다 낫다.
    //   1) 시간 초과로 일부만 모았다
    //   2) 시간 초과가 아닌데도 결과가 기존의 절반도 안 된다
    stat.shrinkGuard = existing >= _PUV_SHRINK_MIN_ &&
      rows.length < existing * _PUV_SHRINK_RATIO_;
    var block = !opt.force &&
      ((stat.timedOut && existing > rows.length) || stat.shrinkGuard);

    if (block) {
      stat.skippedWrite = true;
      Logger.log("[UNIFIED_VIEW] " + (stat.timedOut ? "시간초과" : "결과 급감") +
        " → 기록 생략 (기존 " + existing + "행 유지, 이번 " + rows.length + "행)");
      // 로그만 남기면 아무도 안 본다. 급감은 사람에게 알린다.
      if (stat.shrinkGuard) {
        try {
          _chat_sendText_("⚠️ 통합조회 재생성을 중단했습니다\n" +
            "이번 결과 " + rows.length + "행 · 기존 " + existing + "행 (절반 미만)\n" +
            "기존 탭을 그대로 두었습니다. 일일마감 수집 " + stat.daily + "건.\n" +
            "점검: puvDiagnoseRowLoss() — 파일 _puvDiagnoseRowLoss.gs");
        } catch (eN) {}
      }
    } else {
      _puv_write_(rows);
    }
  } catch (e) {
    stat.errors.push(String(e.message || e));
    Logger.log("[UNIFIED_VIEW] 오류: " + e.message);
  }

  Logger.log("[UNIFIED_VIEW] 행=" + stat.rows + " 매칭=" + stat.matched +
    " 미매칭=" + stat.unmatched + " 송장키=" + stat.keys +
    (stat.timedOut ? " (시간초과)" : "") +
    (stat.errors.length ? " 오류=" + stat.errors.length : ""));
  return stat;
}

function _puv_baseKey_(oid) {
  return String(oid || "").trim().replace(/#\d+$/, "");
}

/**
 * 중복 정리 키.
 * 주문번호는 #N 접미사를 남긴 채로 쓴다. 합배송은 같은 주문에 #1·#2로 여러 줄을
 * 만들기 때문에, 접미사를 떼면 별개 주문 줄이 하나로 합쳐져 데이터가 사라진다.
 * 중복이 남는 것보다 줄이 사라지는 것이 훨씬 위험하다.
 */
function _puv_dedupKey_(o) {
  var oid = String(o.oid || "").trim();
  if (oid) return (o.date || "") + "|O|" + oid + "|" + (o.item || "");
  return (o.date || "") + "|N|" + _pep_normRecipName_(o.name) + "|"
    + _pep_phoneDigits_(o.phone) + "|" + (o.item || "");
}

/**
 * 송장 확정. 재생성이므로 매번 원천에서 다시 조회한다.
 * 조회가 실패하면 기존 일일마감에 적혀 있던 송장을 살린다(데이터 후퇴 방지).
 */
function _puv_resolveInvoice_(rec, map) {
  var base = _puv_baseKey_(rec.oid);
  var name = _pep_normRecipName_(rec.name);
  if (!name && base && /[\uAC00-\uD7AF]/.test(base)) name = _pep_normRecipName_(base);
  var phone = rec.phone;
  if (!phone && base.indexOf("TEL:") === 0) phone = base.replace(/^TEL:/, "");

  var via = {};
  var info = _pep_resolveRowInvoice_(map, {
    uid: base || rec.name,
    name: name,
    phone: phone,
    addr: rec.addr,
    item: rec.item,
    orderDate: rec.date
  }, via);
  if (info && info.inv) {
    if (typeof _pep_qtyOverMax_ === "function" && _pep_qtyOverMax_(rec.qty, rec.item, info.inv)) {
      return { inv: "", src: "", carrier: "", path: "수량초과" };
    }
    var path = via.via === "UID" ? "UID" : (via.via === "UID미매칭" ? "UID미매칭" : "이름전화");
    var cr = info.carrier || "";
    if (typeof _pep_carrierWithLag_ === "function") cr = _pep_carrierWithLag_(cr, info.lag);
    return { inv: info.inv, src: info.source, carrier: cr, path: path };
  }

  // ★ 2026-08-28: 여기 있던 `map["NAME:" + name]` 폴백을 없앴다.
  //   이름 하나만 맞으면 걸리는 키라 사다리에서 이미 뺀 것인데, 이 줄이 사다리를
  //   건너뛰고 직접 집었다. 대리발송처럼 수취인이 업체 자기 자신이면 그 키에
  //   업체의 모든 주문 송장이 쌓여 있어, 수량 1개 행이 수십 개를 받아 갔다.

  var keep = _pep_normInvoiceNo_(rec.existingInv);
  if (keep) {
    if (typeof _pep_qtyOverMax_ === "function" && _pep_qtyOverMax_(rec.qty, rec.item, rec.existingInv)) {
      return { inv: "", src: "", carrier: "", path: "수량초과" };
    }
    return {
      inv: _pep_splitInvNos_(rec.existingInv).join("\n"),
      src: rec.existingSrc || "기존", carrier: "", path: "기존유지",
    };
  }
  return { inv: "", src: "", carrier: "", path: "없음" };
}

/**
 * 택배사 판정. 출처가 택배사를 알려주면 그것이 사실이므로 우선한다.
 * 출처가 업체 전용양식이면 택배사 정보가 없으므로 업체 기본 택배사로 채운다.
 * ★ 2026-08-26: vendor 인자 추가 — 전용양식 업체(부엉이커피 등)가 빈칸으로 나가지 않게 한다.
 * ★ 2026-08-27: existing 인자 추가 — 일일마감이 이미 확정해 적어 둔 값이 가장 정확하다.
 *   마감 시점에는 발주업체를 알지만(허브 B열), 통합조회가 마감을 다시 읽을 때는
 *   그 열에 판매처(쿠팡·네이버)가 들어 있어 업체 택배사 조회가 실패한다.
 *   그래서 여기서 재산정으로 덮지 않고 마감이 적어 둔 값을 그대로 쓴다.
 */
function _puv_carrier_(src, vendor, existing) {
  var kept = String(existing || "").trim();
  if (kept) return kept;
  var fromSrc = _puv_carrierFromSource_(src);
  if (fromSrc) return fromSrc;
  if (vendor && typeof _pep_carrierForVendor_ === "function") {
    return _pep_carrierForVendor_(vendor);
  }
  return "";
}

/** 판정 기준은 `_pep_carrierFromSource_` 한 곳에 둔다 — 갈리면 마감과 조회가 달라진다 */
function _puv_carrierFromSource_(src) {
  if (typeof _pep_carrierFromSource_ === "function") return _pep_carrierFromSource_(src);
  var s = String(src || "");
  if (!s) return "";
  if (s.indexOf("로젠") >= 0) return "로젠택배";
  if (s.indexOf("한진") >= 0) return "한진택배";
  if (s.indexOf("우체국") >= 0) return "우체국";
  if (s.indexOf("대신") >= 0) return "대신택배";
  if (s === "롯데" || s === "합포장" || s === "1주출고" || s.indexOf("롯데") >= 0) return "롯데택배";
  return "";
}

function _puv_existingRowCount_() {
  try {
    var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_PUV_TAB_NAME_);
    return tab ? Math.max(tab.getLastRow() - 1, 0) : 0;
  } catch (e) {
    return 0;
  }
}

/** 전체 교체 기록 — 파생 데이터이므로 통째로 다시 쓴다 */
function _puv_write_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PUV_TAB_NAME_);
  if (!tab) {
    tab = ss.insertSheet(_PUV_TAB_NAME_);
    tab.setFrozenRows(1);
  }
  if (tab.getMaxColumns() < _PUV_HEADERS_.length) {
    tab.insertColumnsAfter(tab.getMaxColumns(), _PUV_HEADERS_.length - tab.getMaxColumns());
  }
  var oldLr = tab.getLastRow();
  if (oldLr >= 2) {
    tab.getRange(2, 1, oldLr - 1, tab.getMaxColumns()).clearContent();
  }
  tab.getRange(1, 1, 1, _PUV_HEADERS_.length).setValues([_PUV_HEADERS_])
    .setFontWeight("bold").setBackground("#1a237e").setFontColor("#ffffff");
  if (rows.length) {
    tab.getRange(2, 1, rows.length, _PUV_HEADERS_.length).setValues(rows);
  }
  SpreadsheetApp.flush();
}

// ═══════════════════════════════════════════
//  진입점
// ═══════════════════════════════════════════

function _puv_summaryText_(stat) {
  var lines = [];
  lines.push("통합조회 행: " + stat.rows + "건");
  lines.push("  매칭: " + stat.matched + "건 / 미매칭: " + stat.unmatched + "건");
  lines.push("");
  lines.push("── 매칭 경로 ──");
  var pk = Object.keys(stat.byPath).sort(function (a, b) { return stat.byPath[b] - stat.byPath[a]; });
  for (var i = 0; i < pk.length; i++) lines.push("  " + pk[i] + ": " + stat.byPath[pk[i]] + "건");
  lines.push("");
  lines.push("── 주문 수집 ──");
  lines.push("  일일마감: " + stat.daily + " / 스냅샷: " + stat.snapshot +
    " / 허브: " + stat.hubRows + " / 임시기록: " + stat.tempRows);
  lines.push("");
  lines.push("── 송장맵 ──");
  lines.push("  키 " + stat.keys + "개 (롯데 " + stat.lotte + ", 1주출고 " + stat.weekly +
    ", 원장 " + stat.ledger + ", 전용마감 " + (stat.exclusive || 0) +
    ", 발주마감 " + (stat.orderArchive || 0) +
    ", 허브아카이브 " + (stat.hubArchive || 0) +
    ", 임시 " + stat.temp + ", 허브 " + stat.hub + ")");
  if (stat.timedOut) {
    lines.push("", stat.skippedWrite
      ? "⏳ 시간 제한으로 일부만 모았습니다 → 기존 통합조회를 그대로 유지했습니다."
      : "⏳ 시간 제한으로 일부만 처리했습니다. 다시 실행해 주세요.");
  }
  if (stat.errors.length) {
    lines.push("", "── 오류 ──");
    for (var e = 0; e < Math.min(stat.errors.length, 8); e++) lines.push("  " + stat.errors[e]);
  }
  return lines.join("\n");
}

/** 메뉴 — 수동 재생성 */
function partnerRebuildUnifiedView() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  var stat = _puv_rebuild_({});

  // 급감 방어에 걸렸다 — 수동 실행이니 사람에게 묻고 결정한다.
  // 자동 실행이라면 물어볼 상대가 없어 그냥 기존을 지킨다.
  if (stat.shrinkGuard && stat.skippedWrite && ui) {
    var ask = ui.alert("통합조회 — 결과가 급감했습니다",
      "이번 수집 " + stat.rows + "행 · 기존 탭 " + stat.existingRows + "행 (절반 미만)\n" +
      "일일마감 수집 " + stat.daily + "건\n\n" +
      "기존 탭을 그대로 두었습니다.\n" +
      "그래도 이번 결과로 덮어쓸까요?",
      ui.ButtonSet.YES_NO);
    if (ask === ui.Button.YES) stat = _puv_rebuild_({ force: true });
  }

  var text = _puv_summaryText_(stat);
  Logger.log("[UNIFIED_VIEW]\n" + text);
  if (ui) {
    ui.alert(stat.skippedWrite ? "통합조회 — 기록 생략 (기존 유지)" : "통합조회 재생성 완료",
      text + "\n\n탭: " + _PUV_TAB_NAME_, ui.ButtonSet.OK);
  }
  return stat;
}

/**
 * 야간 자동 재생성 (22:45).
 * 일일마감(22:00) 이후, 마감 정리(23:00·23:30)가 임시기록을 비우기 전에 돌려야 한다.
 */
function _puv_rebuildScheduled_() {
  if (typeof _pt_isWeekendBlackout_ === "function" && _pt_isWeekendBlackout_()) {
    Logger.log("[BLACKOUT] 주말 차단 → 통합조회 재생성 스킵");
    return;
  }
  var _startedAt_ = new Date().getTime();
  try {
    var stat = _puv_rebuild_({});
    Logger.log("[UNIFIED_VIEW 22:45] 재생성 완료 — 행=" + stat.rows +
      " 매칭=" + stat.matched + " 미매칭=" + stat.unmatched);

    // ── 이어서 미매칭 소급 보강 ──
    //   마감은 "직전 파일 1개"만 채운다. 이틀 넘게 늦게 들어온 송장은
    //   영영 미매칭으로 남아 있었다(2026-09-01 감사: 1,702건 누적).
    //   여기서 도는 이유: 방금 만든 송장맵을 그대로 쓸 수 있어 공짜에 가깝다.
    //
    //   ★ 날짜 수를 7일로 줄인 이유 ★
    //     GAS 실행은 6분에서 잘린다. 재생성이 이미 최대 5분을 쓸 수 있으므로
    //     남은 시간에 파일 14개를 여는 건 무리다. 매일 도니 7일이면 충분하고,
    //     더 거슬러 올라갈 일이 생기면 메뉴에서 14일로 수동 실행하면 된다.
    try {
      var _elapsed_ = new Date().getTime() - _startedAt_;
      // 재생성이 오래 끌었으면 보강을 건너뛴다. GAS 는 6분에서 실행을 자르는데,
      // 그때 잘리면 보강이 파일을 반만 고친 채로 끝난다 — 그게 제일 나쁘다.
      if (_elapsed_ > 210000) {
        Logger.log("[UNIFIED_VIEW 22:45] 재생성에 " + Math.round(_elapsed_ / 1000) +
          "초 — 남은 시간이 부족해 소급 보강 건너뜀 (메뉴에서 수동 실행하세요)");
      } else if (_PUV_LAST_INVOICE_MAP_) {
        var _bf_ = _pep_backfillRecentArchives_(_PUV_LAST_INVOICE_MAP_, 7);
        Logger.log("[UNIFIED_VIEW 22:45] 소급 보강 — 채움=" + _bf_.patched +
          " 파일=" + _bf_.files + (_bf_.days.length ? " (" + _bf_.days.join(", ") + ")" : ""));
      } else {
        Logger.log("[UNIFIED_VIEW 22:45] 송장맵이 없어 소급 보강 건너뜀");
      }
    } catch (eBf) {
      // 보강이 실패해도 통합조회 재생성은 이미 끝났다. 여기서 예외를 올리면 안 된다.
      Logger.log("[UNIFIED_VIEW 22:45] 소급 보강 실패: " + eBf.message);
    }
  } catch (e) {
    Logger.log("[UNIFIED_VIEW 22:45] 실패: " + e.message);
  }
}

// 트리거는 _partnerWebApp.gs 의 _ALL_SCHEDULED_TRIGGERS_ 에 등록되어 있다(22:45).
// 여기서 개별 설치하면 setupAllScheduledTriggers 가 전체 삭제할 때 같이 지워진다.
