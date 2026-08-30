/**
 * 보조키(이름·전화앞7·주소·품목) 매칭 진단 — 읽기 전용
 *
 * 고유ID가 없는 건은 이름+전화+주소+품목 보조키로 송장을 찾는다.
 * 이 진단은 세 가지를 눈으로 확인해준다:
 *   1) 각 송장 소스가 전화·주소·품목명을 실제로 제공하는지 (열 해석 결과 + 마스킹 비율)
 *   2) 주소·품목 키를 추가하면 지금 미매칭인 건 중 몇 건이 새로 맞는지
 *   3) 한 사람이 여러 건 주문해 송장이 여러 개 묶여 오던 건이 품목키로 몇 건 갈라지는지
 *
 * 운영 데이터는 쓰지 않는다. 결과 탭만 생성/갱신한다.
 */

var _PAK_TAB_NAME_ = "보조키_매칭진단";
var _PAK_MAX_ROWS_ = 3000;

var _PAK_HEADERS_ = [
  "진단일시",   // A
  "구분",       // B: 소스열 / 신규매칭 / 품목키분리 / 다중송장잔존 / 여전히미매칭
  "대상",       // C: 소스명 또는 주문일
  "수취인",     // D
  "전화",       // E
  "주소키",     // F
  "품목키",     // G
  "맞은키",     // H: NPI / NAI / NPA / NP7 / NA / NI / NAME(롯데) / NP / TEL / NAME
  "송장",       // I
  "송장출처",   // J
  "비고",       // K
];

// ═══════════════════════════════════════════
//  소스별 열 해석 점검
// ═══════════════════════════════════════════

/**
 * 각 송장 소스에서 이름·전화·주소 열이 잡히는지, 값이 실제로 채워져 있는지 본다.
 * 롯데처럼 개인정보를 안 주는 탭은 여기서 "전화 열 없음"으로 드러난다.
 */
function _pak_probeSources_() {
  var out = [];

  function push(src, info) {
    out.push({
      src: src,
      state: info.state || "",
      nameCol: info.nameCol,
      phoneCol: info.phoneCol,
      addrCol: info.addrCol,
      itemCol: typeof info.itemCol === "number" ? info.itemCol : -1,
      rows: info.rows || 0,
      withPhone: info.withPhone || 0,
      masked: info.masked || 0,
      withAddr: info.withAddr || 0,
      withItem: info.withItem || 0,
      sampleAddrKey: info.sampleAddrKey || "",
      sampleItemKey: info.sampleItemKey || "",
      samplePhone: info.samplePhone || "",
    });
  }

  /** 고정/해석된 열 인덱스로 표본 집계 */
  function scan(src, tab, cols, startRow) {
    var itemCol = typeof cols.item === "number" ? cols.item : -1;
    if (!tab) { push(src, { state: "탭없음", nameCol: -1, phoneCol: -1, addrCol: -1, itemCol: -1 }); return; }
    var lr = tab.getLastRow();
    if (lr < startRow + 1) { push(src, { state: "빈탭", nameCol: -1, phoneCol: -1, addrCol: -1, itemCol: -1 }); return; }
    var need = Math.max(cols.name, cols.phone, cols.addr, itemCol, 0) + 1;
    var lc = Math.max(tab.getLastColumn(), need);
    var data = tab.getRange(startRow + 1, 1, Math.min(lr - startRow, _PAK_MAX_ROWS_), lc).getDisplayValues();
    var acc = {
      state: "읽음", nameCol: cols.name, phoneCol: cols.phone, addrCol: cols.addr, itemCol: itemCol,
      rows: data.length, withPhone: 0, masked: 0, withAddr: 0, withItem: 0,
      sampleAddrKey: "", sampleItemKey: "", samplePhone: ""
    };
    for (var i = 0; i < data.length; i++) {
      if (cols.phone >= 0) {
        var ph = data[i][cols.phone];
        if (String(ph || "").replace(/[^0-9]/g, "")) {
          acc.withPhone++;
          if (_pep_isMaskedPhone_(ph)) acc.masked++;
          if (!acc.samplePhone) acc.samplePhone = String(ph);
        }
      }
      if (cols.addr >= 0) {
        var ak = _pep_addrKey_(data[i][cols.addr]);
        if (ak) {
          acc.withAddr++;
          if (!acc.sampleAddrKey) acc.sampleAddrKey = ak;
        }
      }
      if (itemCol >= 0) {
        var ik = _pep_itemKey_(data[i][itemCol]);
        if (ik) {
          acc.withItem++;
          if (!acc.sampleItemKey) acc.sampleItemKey = ik;
        }
      }
    }
    push(src, acc);
  }

  // ── 롯데 · 1주출고 (헤더 해석 — 전화·주소 열이 생겼는지 확인) ──
  try {
    var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);

    var lt = _pt_getSheetByGid(invSS, _PT_SECONDARY_INVOICE_GID);
    if (lt && lt.getLastRow() >= 2) {
      var ltAll = lt.getRange(1, 1, Math.min(lt.getLastRow(), 5), lt.getLastColumn()).getDisplayValues();
      var ltHi = _pep_findLotteHeaderRow_(ltAll);
      var ltCols = _pep_resolveLotteCols_(ltAll[ltHi]);
      scan("롯데", lt,
        { name: ltCols.name, phone: ltCols.phone, addr: ltCols.addr, item: ltCols.item }, ltHi + 1);
    } else {
      push("롯데", { state: "탭없음/빈탭", nameCol: -1, phoneCol: -1, addrCol: -1, itemCol: -1 });
    }

    var ws = _pt_getSheetByGid(invSS, _PT_WEEKLY_SHIP_GID);
    if (ws && ws.getLastRow() >= 2) {
      var wsAll = ws.getRange(1, 1, Math.min(ws.getLastRow(), 5), ws.getLastColumn()).getDisplayValues();
      var wsHi = _pep_findLotteHeaderRow_(wsAll);
      var wsR = _pep_resolveLotteCols_(wsAll[wsHi]);
      scan("1주출고", ws, {
        name: wsR.name >= 0 ? wsR.name : _PT_WEEKLY_SHIP_FIXED_COL.name,
        phone: wsR.phone, addr: wsR.addr, item: wsR.item
      }, wsHi + 1);
    } else {
      push("1주출고", { state: "탭없음/빈탭", nameCol: -1, phoneCol: -1, addrCol: -1, itemCol: -1 });
    }

    var npT = _pt_getSheetByGid(invSS, _PT_NAME_PHONE_FALLBACK_GID);
    scan("3-3_병합", npT, { name: 0, phone: 1, addr: -1, item: -1 }, 1);
  } catch (e) {
    push("롯데계열", { state: "오류: " + e.message, nameCol: -1, phoneCol: -1, addrCol: -1, itemCol: -1 });
  }

  // ── 대리공급_임시기록 + 보관 ──
  try {
    var tempSS = typeof _po_openTempSheetSs_ === "function"
      ? _po_openTempSheetSs_() : SpreadsheetApp.getActiveSpreadsheet();
    scan("대리공급_임시기록", _po_getNonPartnerTempTab_(tempSS),
      { name: 12, phone: 7, addr: 9, item: 4 }, 1);
    var off = typeof _PO_TEMP_ARCHIVE_COL_OFFSET_ !== "undefined" ? _PO_TEMP_ARCHIVE_COL_OFFSET_ : 2;
    var aTab = typeof _po_getTempArchiveTab_ === "function" ? _po_getTempArchiveTab_(tempSS) : null;
    scan("임시기록_보관", aTab, { name: 12 + off, phone: 7 + off, addr: 9 + off, item: 4 + off }, 1);
  } catch (e) {
    push("임시기록", { state: "오류: " + e.message, nameCol: -1, phoneCol: -1, addrCol: -1, itemCol: -1 });
  }

  // ── 발주허브 ──
  try {
    var hubName = typeof _PO_HUB_SHEET_NAME !== "undefined" ? _PO_HUB_SHEET_NAME : "협력업체_발주허브";
    scan("발주허브", SpreadsheetApp.getActiveSpreadsheet().getSheetByName(hubName),
      { name: 7, phone: 8, addr: 9, item: 5 }, 1);
  } catch (e) {
    push("발주허브", { state: "오류: " + e.message, nameCol: -1, phoneCol: -1, addrCol: -1, itemCol: -1 });
  }

  // ── 송장원장 (주소 열 없음 — 구조상 한계를 드러내려고 포함) ──
  try {
    scan("송장원장", _pil_openLedgerSs_().getSheetByName(_PIL_TAB_NAME_),
      { name: 4, phone: 5, addr: -1, item: 7 }, 1);
  } catch (e) {
    push("송장원장", { state: "오류: " + e.message, nameCol: -1, phoneCol: -1, addrCol: -1, itemCol: -1 });
  }

  return out;
}

// ═══════════════════════════════════════════
//  주소 키 추가 효과 측정
// ═══════════════════════════════════════════

/** 스냅샷에서 아직 매칭완료가 아닌 행 (이름·전화·주소) */
function _pak_collectPendingSnapshot_() {
  var rows = [];
  try {
    var snap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_SNAPSHOT_TAB_NAME_);
    if (!snap || snap.getLastRow() < 2) return rows;
    var lc = snap.getLastColumn();
    var hdr = snap.getRange(1, 1, 1, lc).getValues()[0];
    var data = snap.getRange(2, 1, snap.getLastRow() - 1, lc).getDisplayValues();

    var addrIdx = -1, itemIdx = -1;
    for (var h = 2; h < lc - 1; h++) {
      var hh = String(hdr[h] || "").replace(/\s/g, "");
      if (!hh) continue;
      if (addrIdx < 0 && /주소/.test(hh) && !/배송메|우편/.test(hh)) addrIdx = h;
      if (itemIdx < 0 && /품목명|상품명|품명/.test(hh)) itemIdx = h;
    }
    for (var i = 0; i < data.length && rows.length < _PAK_MAX_ROWS_; i++) {
      if (String(data[i][lc - 1] || "").trim() === _SNAPSHOT_STATUS_MATCHED_) continue;
      var mk = String(data[i][1] || "").trim();
      if (!mk) continue;
      rows.push({
        target: String(data[i][0] || "").trim() || "스냅샷",
        matchKey: mk,
        name: data[i][14],
        phone: data[i][15],
        addr: addrIdx >= 0 ? data[i][addrIdx] : "",
        item: itemIdx >= 0 ? data[i][itemIdx] : "",
      });
    }
    if (addrIdx < 0) rows.addrMissing = true;
  } catch (e) {}
  return rows;
}

/**
 * 세 단계를 비교한다.
 *   ① 이름+전화만            (주소·품목 키가 없던 시절)
 *   ② 이름+전화+주소         (2026-08-25)
 *   ③ 이름+전화+주소+품목    (2026-08-26)
 *
 * 품목키의 목적은 매칭 건수를 늘리는 게 아니라 송장을 하나로 확정하는 것이다.
 * 한 사람이 여러 건을 주문하면 사람만 가리키는 키에 송장이 여러 개 쌓여
 * 그 사람의 모든 행이 같은 목록을 받아갔다. 그래서 "다중→단일" 전환 건수를 센다.
 */
function _pak_measure_(map, pending) {
  var res = {
    total: pending.length,
    before: 0, addrOnly: 0, after: 0,
    multiBefore: 0, multiAfter: 0,
    gained: [], split: [], multiLeft: [], stillNo: [], viaCount: {},
  };
  for (var i = 0; i < pending.length; i++) {
    var r = pending[i];
    // 고유ID로 이미 맞는 건은 보조키 대상이 아니다
    var byUid = _pep_lookupInvoiceMap_(map, r.matchKey);
    if (byUid && byUid.inv) continue;

    var oldHit = _pep_lookupNamePhoneInvoice_(map, r.name, r.phone, "", "");
    var aVia = {};
    var addrHit = _pep_lookupNamePhoneInvoice_(map, r.name, r.phone, r.addr, "", aVia);
    var via = {};
    var newHit = _pep_lookupNamePhoneInvoice_(map, r.name, r.phone, r.addr, r.item, via);

    if (oldHit && oldHit.inv) res.before++;
    if (addrHit && addrHit.inv) res.addrOnly++;

    var nAddr = _pep_invCount_(addrHit);
    var nNew = _pep_invCount_(newHit);
    if (nAddr > 1) res.multiBefore++;
    if (nNew > 1) res.multiAfter++;

    if (newHit && newHit.inv) {
      res.after++;
      res.viaCount[via.via || "?"] = (res.viaCount[via.via || "?"] || 0) + 1;
      if (!oldHit || !oldHit.inv) {
        res.gained.push({ r: r, inv: newHit.inv, src: newHit.source, via: via.via || "" });
      }
      // 품목키로 여러 송장이 하나로 갈라진 건 — 사용자가 지적한 그 증상
      if (nAddr > 1 && nNew === 1) {
        res.split.push({
          r: r, inv: newHit.inv, src: newHit.source, via: via.via || "",
          was: addrHit.inv, wasVia: aVia.via || "",
        });
      }
      if (nNew > 1) {
        res.multiLeft.push({ r: r, inv: newHit.inv, src: newHit.source, via: via.via || "" });
      }
    } else {
      res.stillNo.push({ r: r });
    }
  }
  return res;
}

// ═══════════════════════════════════════════
//  결과 탭
// ═══════════════════════════════════════════

function _pak_writeTab_(probe, measure) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PAK_TAB_NAME_);
  if (!tab) tab = ss.insertSheet(_PAK_TAB_NAME_);
  tab.clear();

  tab.getRange(1, 1, 1, _PAK_HEADERS_.length).setValues([_PAK_HEADERS_])
    .setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
  tab.setFrozenRows(1);

  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var rows = [];

  for (var i = 0; i < probe.length; i++) {
    var p = probe[i];
    rows.push([
      now, "소스열", p.src, "", p.samplePhone, p.sampleAddrKey, p.sampleItemKey, "", "", "",
      p.state +
      " / 이름열=" + p.nameCol + " 전화열=" + p.phoneCol +
      " 주소열=" + p.addrCol + " 품목열=" + p.itemCol +
      " / 표본=" + p.rows +
      " 전화있음=" + p.withPhone + "(마스킹 " + p.masked + ")" +
      " 주소있음=" + p.withAddr +
      " 품목있음=" + p.withItem
    ]);
  }

  for (var g = 0; g < measure.gained.length; g++) {
    var it = measure.gained[g];
    rows.push([
      now, "신규매칭", it.r.target,
      _pep_normRecipName_(it.r.name), String(it.r.phone || ""),
      _pep_addrKey_(it.r.addr), _pep_itemKey_(it.r.item), it.via, it.inv, it.src || "",
      "주소·품목 키 추가로 새로 매칭됨 / 품목=" + (it.r.item || "")
    ]);
  }

  for (var sp = 0; sp < measure.split.length; sp++) {
    var it2 = measure.split[sp];
    rows.push([
      now, "품목키분리", it2.r.target,
      _pep_normRecipName_(it2.r.name), String(it2.r.phone || ""),
      _pep_addrKey_(it2.r.addr), _pep_itemKey_(it2.r.item), it2.via, it2.inv, it2.src || "",
      "품목키 전: " + it2.wasVia + "로 송장 " + _pep_splitInvNos_(it2.was).length +
      "개가 함께 붙었다 → " + String(it2.was).replace(/\n/g, ", ")
    ]);
  }

  for (var ml = 0; ml < measure.multiLeft.length; ml++) {
    var it3 = measure.multiLeft[ml];
    rows.push([
      now, "다중송장잔존", it3.r.target,
      _pep_normRecipName_(it3.r.name), String(it3.r.phone || ""),
      _pep_addrKey_(it3.r.addr), _pep_itemKey_(it3.r.item), it3.via,
      String(it3.inv).replace(/\n/g, ", "), it3.src || "",
      "송장이 하나로 확정되지 않음 — 같은 사람이 같은 품목을 여러 번 주문했거나 품목명이 원천과 다름"
    ]);
  }

  for (var s = 0; s < measure.stillNo.length; s++) {
    var sn = measure.stillNo[s];
    rows.push([
      now, "여전히미매칭", sn.r.target,
      _pep_normRecipName_(sn.r.name), String(sn.r.phone || ""),
      _pep_addrKey_(sn.r.addr), _pep_itemKey_(sn.r.item), "", "", "",
      "보조키로도 송장 없음 (출고 전이거나 송장 자체 미수집)"
    ]);
  }

  if (rows.length) {
    tab.getRange(2, 1, rows.length, _PAK_HEADERS_.length).setValues(rows);
  }
  tab.setColumnWidth(6, 160);
  tab.setColumnWidth(7, 140);
  tab.setColumnWidth(11, 520);
  return rows.length;
}

// ═══════════════════════════════════════════
//  진입점
// ═══════════════════════════════════════════

function partnerDiagnoseAuxKeys() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  _pep_keyStatReset_();

  var probe = _pak_probeSources_();

  var stat = { lotte: 0, weekly: 0, ledger: 0, temp: 0, hub: 0, snapshot: 0, keys: 0, errors: [] };
  var map = _puv_buildInvoiceMap_(stat);

  var pending = _pak_collectPendingSnapshot_();
  var measure = _pak_measure_(map, pending);
  var written = _pak_writeTab_(probe, measure);

  // 소스별 보조키 등록 현황
  var ksLines = [];
  var ks = _PEP_KEYSTAT_ || {};
  for (var k in ks) {
    if (!ks.hasOwnProperty(k)) continue;
    ksLines.push("  · " + k + ": 행 " + ks[k].rows +
      " / 이름 " + ks[k].name +
      " / 전화7 " + ks[k].np7 +
      " / 주소 " + ks[k].na +
      " / 이름+전화7+주소 " + ks[k].npa +
      " / 품목 " + (ks[k].ni || 0) +
      (ks[k].masked ? " (마스킹 " + ks[k].masked + ")" : ""));
  }

  var viaLines = [];
  for (var v in measure.viaCount) {
    if (measure.viaCount.hasOwnProperty(v)) {
      viaLines.push("  · " + v + ": " + measure.viaCount[v] + "건");
    }
  }

  var msg =
    "🔎 보조키 매칭 진단 완료\n\n" +
    "송장맵 키: " + stat.keys + "개\n" +
    "(롯데 " + stat.lotte + " / 1주출고 " + stat.weekly +
    " / 원장 " + stat.ledger + " / 임시기록 " + stat.temp + " / 허브 " + stat.hub + ")\n\n" +
    "── 소스별 보조키 등록 ──\n" +
    (ksLines.length ? ksLines.join("\n") : "  (없음)") + "\n\n" +
    "── 보조키 추가 효과 (고유ID 미매칭 건) ──\n" +
    "  대상: " + measure.total + "건\n" +
    "  이름+전화만: " + measure.before + "건\n" +
    "  +주소: " + measure.addrOnly + "건\n" +
    "  +품목: " + measure.after + "건\n" +
    "  ▶ 새로 매칭: " + measure.gained.length + "건\n" +
    "  여전히 미매칭: " + measure.stillNo.length + "건\n\n" +
    "── 송장 다중배정 (한 사람 여러 주문) ──\n" +
    "  품목키 전 다중송장: " + measure.multiBefore + "건\n" +
    "  품목키 후 다중송장: " + measure.multiAfter + "건\n" +
    "  ▶ 하나로 갈라짐: " + measure.split.length + "건\n" +
    (measure.multiLeft.length
      ? "  ⚠ 아직 다중: " + measure.multiLeft.length + "건 (같은 품목 재주문 또는 품목명 불일치)\n\n"
      : "\n") +
    (viaLines.length ? "── 맞은 키 종류 ──\n" + viaLines.join("\n") + "\n\n" : "") +
    (stat.errors.length ? "⚠ " + stat.errors.slice(0, 3).join(" / ") + "\n\n" : "") +
    "상세 " + written + "행은 '" + _PAK_TAB_NAME_ + "' 탭을 확인하세요.";

  if (ui) ui.alert(msg);
  Logger.log(msg);
  return msg;
}
