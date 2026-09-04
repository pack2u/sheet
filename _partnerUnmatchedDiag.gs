/**
 * 일일마감 미매칭 원인 진단 (읽기 전용)
 *
 * 통합 일일마감(_pep_archiveUnifiedDaily_)이 송장을 붙이지 못한 행마다
 * "송장이 실제로 어느 소스에 있었는지"와 "어느 단계에서 키가 끊겼는지"를 판정한다.
 *
 * 일일마감의 키 사다리를 재현하는 대신, 각 소스의 원시 행(UID·송장·수취인·전화)을
 * 그대로 색인해 미매칭 행과 직접 대조한다. 그래야 "송장은 존재하는데 현재 키 구조로는
 * 도달할 수 없다"는 상황을 구분해낼 수 있다.
 *
 * 운영 데이터는 쓰지 않는다. 결과 탭만 생성/갱신한다.
 */

var _PUD_TAB_NAME_ = "일일마감_미매칭진단";
/** 소급 보강 창과 같은 기간을 훑어야 "기간초과" 판정이 의미를 갖는다 */
var _PUD_DEFAULT_DAYS_ = 14;
var _PUD_MAX_ROWS_ = 4000;
var _PUD_TIME_BUDGET_MS_ = 280000; // 약 4분40초. GAS 6분 제한 대비 여유

var _PUD_HEADERS_ = [
  "진단일시",      // A
  "입력원",        // B: 스냅샷 / 일일마감(날짜)
  "주문일",        // C
  "매칭키",        // D: 스냅샷 B열
  "키유형",        // E: 사방넷 / TEL / FB / 생성UID / 기타
  "수취인",        // F
  "전화",          // G
  "품목명",        // H
  "판정",          // I
  "원인",          // J: 원인번호 + 요약
  "후보출처",      // K: 송장이 실제로 있던 소스
  "후보UID",       // L
  "후보송장",      // M
  "상세",          // N
];

/** 일일마감이 실제로 읽는 소스인지 여부 — false면 "소스제외" 판정 근거가 된다 */
var _PUD_SOURCES_ = [
  { key: "롯데",            usedByDaily: true },
  { key: "1주출고",         usedByDaily: true },
  { key: "대리공급_임시기록", usedByDaily: true, skipsNameKey: true },
  { key: "임시기록_보관",    usedByDaily: true, skipsNameKey: true },
  { key: "송장원장",         usedByDaily: true, skipsNameKey: true },
  { key: "발주허브",         usedByDaily: true, skipsNameKey: true },
  { key: "합배송",           usedByDaily: true },
  { key: "3-3_병합",         usedByDaily: true },
  { key: "로젠",            usedByDaily: false },
  { key: "사방넷_송장매칭",  usedByDaily: false },
];

function _pud_sourceMeta_(key) {
  for (var i = 0; i < _PUD_SOURCES_.length; i++) {
    if (_PUD_SOURCES_[i].key === key) return _PUD_SOURCES_[i];
  }
  return { key: key, usedByDaily: true };
}

// ═══════════════════════════════════════════
//  정규화
// ═══════════════════════════════════════════

/** 일일마감 본체와 동일한 수취인 정규화 (엄격) */
function _pud_strictName_(name) {
  if (typeof _pep_normRecipName_ === "function") return _pep_normRecipName_(name);
  var s = String(name || "").trim();
  if (s.indexOf("/") !== -1) s = s.split("/")[0].trim();
  return s.replace(/\s+/g, "").replace(/님$/, "");
}

/**
 * 느슨한 수취인 정규화 — 엄격 정규화로는 안 맞고 이것으로 맞으면
 * 정규화 규칙 불일치가 미매칭 원인이라는 뜻이다.
 */
function _pud_looseName_(name) {
  var s = String(name || "").trim();
  if (s.indexOf("/") !== -1) s = s.split("/")[0];
  s = s.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "");
  s = s.replace(/[^0-9A-Za-z\uAC00-\uD7AF]/g, "");
  s = s.replace(/(님|씨|고객|사장|대표|귀하|께)+$/g, "");
  return s.toLowerCase();
}

function _pud_phoneDigits_(phone) {
  if (typeof _pep_phoneDigits_ === "function") return _pep_phoneDigits_(phone);
  var p = String(phone == null ? "" : phone).replace(/[^0-9]/g, "");
  if (p.length >= 10 && p.charAt(0) !== "0") p = "0" + p;
  return p;
}

function _pud_normInv_(inv) {
  if (typeof _pep_normInvoiceNo_ === "function") return _pep_normInvoiceNo_(inv);
  var d = String(inv == null ? "" : inv).replace(/[^0-9]/g, "");
  return d.length >= 8 ? d : "";
}

function _pud_baseKey_(matchKey) {
  return String(matchKey || "").trim().replace(/#\d+$/, "");
}

function _pud_keyKind_(matchKey) {
  var k = _pud_baseKey_(matchKey);
  if (!k) return "없음";
  if (k.indexOf("TEL:") === 0) return "TEL";
  if (k.indexOf("FB:") === 0) return "FB";
  if (typeof _po_isGeneratedUid_ === "function" && _po_isGeneratedUid_(k)) return "생성UID";
  if (/[\uAC00-\uD7AF]/.test(k)) return "이름";
  if (/^\d{6,}$/.test(k)) return "사방넷";
  return "기타";
}

// ═══════════════════════════════════════════
//  소스 색인
// ═══════════════════════════════════════════

/**
 * 모든 송장 소스를 원시 행 단위로 읽어 UID/이름/전화 색인을 만든다.
 * @return {{cands:Array, uid:Object, name:Object, loose:Object, phone:Object,
 *           tail4:Object, head7:Object, stat:Object, notes:Array}}
 */
function _pud_buildCandidateIndex_() {
  var idx = {
    cands: [], uid: {}, name: {}, loose: {}, phone: {}, tail4: {}, head7: {},
    stat: {}, state: {}, notes: [],
  };
  // 0건과 "탭이 아예 없음"은 원인이 전혀 다르므로 반드시 구분해서 보고한다
  for (var s0 = 0; s0 < _PUD_SOURCES_.length; s0++) {
    idx.stat[_PUD_SOURCES_[s0].key] = 0;
    idx.state[_PUD_SOURCES_[s0].key] = "미확인";
  }

  function push(src, uid, inv, name, phone) {
    var nInv = _pud_normInv_(inv);
    if (!nInv) return;
    if (typeof _po_hasRealInvoice_ === "function" && !_po_hasRealInvoice_(inv)) return;
    var c = {
      src: src,
      uid: String(uid == null ? "" : uid).trim(),
      inv: nInv,
      name: String(name == null ? "" : name).trim(),
      phone: _pud_phoneDigits_(phone),
    };
    idx.cands.push(c);
    idx.stat[src] = (idx.stat[src] || 0) + 1;

    function add(bucket, key) {
      if (!key) return;
      if (!bucket[key]) bucket[key] = [];
      bucket[key].push(c);
    }
    add(idx.uid, _pud_baseKey_(c.uid));
    add(idx.name, _pud_strictName_(c.name));
    add(idx.loose, _pud_looseName_(c.name));
    if (c.phone.length >= 8) add(idx.phone, c.phone);
    if (c.phone.length >= 4) add(idx.tail4, c.phone.substring(c.phone.length - 4));
    if (c.phone.length >= 7) add(idx.head7, c.phone.substring(0, 7));
  }

  /** 고정 열 배열 탭 읽기. phoneAlt는 전화 열이 비었을 때의 대체 열 */
  function readFixed(src, tab, cols, startRow) {
    if (!tab) { idx.state[src] = "탭없음"; return; }
    if (tab.getLastRow() < startRow + 1) { idx.state[src] = "빈탭"; return; }
    idx.state[src] = "읽음";
    var lr = tab.getLastRow();
    var alt = cols.phoneAlt == null ? -1 : cols.phoneAlt;
    var need = Math.max(cols.invoice, cols.uid, cols.name, cols.phone, alt) + 1;
    var lc = Math.max(tab.getLastColumn(), need);
    var data = tab.getRange(1, 1, lr, lc).getDisplayValues();
    for (var i = startRow; i < data.length; i++) {
      var ph = cols.phone >= 0 ? data[i][cols.phone] : "";
      if (!String(ph || "").replace(/[^0-9]/g, "") && alt >= 0) ph = data[i][alt];
      push(
        src,
        cols.uid >= 0 ? data[i][cols.uid] : "",
        cols.invoice >= 0 ? data[i][cols.invoice] : "",
        cols.name >= 0 ? data[i][cols.name] : "",
        ph
      );
    }
  }

  var invSS = null;
  try { invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID); }
  catch (e) { idx.notes.push("거래관리시스템 시트 열기 실패: " + e.message); }

  // ── 롯데 (일일마감 주 소스) ──
  if (invSS) {
    try {
      var ltTab = _pt_getSheetByGid(invSS, _PT_SECONDARY_INVOICE_GID);
      if (ltTab && ltTab.getLastRow() >= 2) {
        idx.state["롯데"] = "읽음";
        var ltAll = ltTab.getRange(1, 1, ltTab.getLastRow(), Math.max(ltTab.getLastColumn(), 10)).getDisplayValues();
        var hdrIdx = _pep_findLotteHeaderRow_(ltAll);
        var ltCols = _pep_resolveLotteCols_(ltAll[hdrIdx]);
        var start = hdrIdx + 1;
        if (_pep_countInvoiceCol_(ltAll, start, ltCols.invoice) === 0) {
          ltCols = { name: 5, invoice: 6, uid: 9, phone: -1 };
          start = (hdrIdx === 0) ? 1 : hdrIdx + 1;
          if (_pep_countInvoiceCol_(ltAll, start, 6) === 0 && _pep_countInvoiceCol_(ltAll, 1, 6) > 0) start = 1;
        }
        for (var li = start; li < ltAll.length; li++) {
          push("롯데", ltAll[li][ltCols.uid], ltAll[li][ltCols.invoice],
            ltAll[li][ltCols.name], ltCols.phone >= 0 ? ltAll[li][ltCols.phone] : "");
        }
      } else {
        idx.state["롯데"] = ltTab ? "빈탭" : "탭없음";
        idx.notes.push("롯데 송장탭 비어있음 (GID " + _PT_SECONDARY_INVOICE_GID + ")");
      }
    } catch (e) { idx.notes.push("롯데 읽기 오류: " + e.message); }

    // ── 1주출고 (보조) ──
    try {
      readFixed("1주출고", _pt_getSheetByGid(invSS, _PT_WEEKLY_SHIP_GID), _PT_WEEKLY_SHIP_FIXED_COL, 1);
    } catch (e) { idx.notes.push("1주출고 읽기 오류: " + e.message); }

    // ── 로젠 (★ 일일마감 미사용 — 송장수집은 1순위로 씀) ──
    try {
      readFixed("로젠", _pt_getSheetByGid(invSS, _PT_PRIMARY_INVOICE_GID),
        { name: 9, phone: 12, invoice: 5, uid: 4 }, 1);
    } catch (e) { idx.notes.push("로젠 읽기 오류: " + e.message); }

    // ── 3-3_병합 (이름+전화 폴백) ──
    try {
      readFixed("3-3_병합", _pt_getSheetByGid(invSS, _PT_NAME_PHONE_FALLBACK_GID),
        { name: 0, phone: 1, invoice: 3, uid: -1 }, 1);
    } catch (e) { idx.notes.push("3-3_병합 읽기 오류: " + e.message); }
  }

  // ── 대리공급_임시기록 + 보관 ──
  try {
    var tempSS = typeof _po_openTempSheetSs_ === "function"
      ? _po_openTempSheetSs_() : SpreadsheetApp.getActiveSpreadsheet();
    var tTab = _po_getNonPartnerTempTab_(tempSS);
    readFixed("대리공급_임시기록", tTab,
      { name: 12, phone: 7, phoneAlt: 8, invoice: _PO_TEMP_INV_COL_, uid: _PO_TEMP_UID_COL_ }, 1);

    var aTab = typeof _po_getTempArchiveTab_ === "function" ? _po_getTempArchiveTab_(tempSS) : null;
    var off = typeof _PO_TEMP_ARCHIVE_COL_OFFSET_ !== "undefined" ? _PO_TEMP_ARCHIVE_COL_OFFSET_ : 2;
    readFixed("임시기록_보관", aTab, {
      name: 12 + off, phone: 7 + off, phoneAlt: 8 + off,
      invoice: _PO_TEMP_INV_COL_ + off, uid: _PO_TEMP_UID_COL_ + off,
    }, 1);
  } catch (e) { idx.notes.push("임시기록 읽기 오류: " + e.message); }

  // ── 송장원장 (마감으로 사라진 송장의 영구 보관소) ──
  try {
    readFixed("송장원장", _pil_openLedgerSs_().getSheetByName(_PIL_TAB_NAME_),
      { name: 4, phone: 5, invoice: 2, uid: 3 }, 1);
  } catch (e) { idx.notes.push("송장원장 읽기 오류: " + e.message); }

  // ── 협력업체_발주허브 ──
  try {
    var hubName = typeof _PO_HUB_SHEET_NAME !== "undefined" ? _PO_HUB_SHEET_NAME : "협력업체_발주허브";
    readFixed("발주허브", SpreadsheetApp.getActiveSpreadsheet().getSheetByName(hubName),
      { name: 7, phone: 8, invoice: 13, uid: 2 }, 1);
  } catch (e) { idx.notes.push("발주허브 읽기 오류: " + e.message); }

  // ── 합배송 (헤더 탐색) ──
  try {
    var hapSS = SpreadsheetApp.openById(_PT_COMBINED_INVOICE_SHEET_ID);
    var hapTab = _pt_getSheetByGid(hapSS, _PT_COMBINED_INVOICE_SHEET_GID)
      || hapSS.getSheetByName("합배송") || hapSS.getSheetByName("합배송 전용");
    if (!hapTab || hapTab.getLastRow() < 2) {
      idx.state["합배송"] = hapTab ? "빈탭" : "탭없음";
    } else {
      idx.state["합배송"] = "읽음";
      var hapAll = hapTab.getRange(1, 1, hapTab.getLastRow(), Math.max(hapTab.getLastColumn(), 17)).getDisplayValues();
      var hc = { name: -1, phone: -1, invoice: -1, uid: -1 };
      for (var c0 = 0; c0 < hapAll[0].length; c0++) {
        var hh = String(hapAll[0][c0] || "").replace(/\s/g, "");
        if (!hh) continue;
        if (hc.uid < 0 && /사방넷주문번호|고유아이디|고유ID|주문번호/i.test(hh)) hc.uid = c0;
        if (hc.invoice < 0 && /송장|운송장/.test(hh) && !/반품/.test(hh)) hc.invoice = c0;
        if (hc.name < 0 && /수취인|수령인|받는사람|받는분|고객명|이름|성명/.test(hh) && !/주소|전화|코드/.test(hh)) hc.name = c0;
        if (hc.phone < 0 && /전화|휴대폰|핸드폰|연락처/.test(hh) && !/주소/.test(hh)) hc.phone = c0;
      }
      for (var hi = 1; hi < hapAll.length; hi++) {
        push("합배송",
          hc.uid >= 0 ? hapAll[hi][hc.uid] : "",
          hc.invoice >= 0 ? hapAll[hi][hc.invoice] : "",
          hc.name >= 0 ? hapAll[hi][hc.name] : "",
          hc.phone >= 0 ? hapAll[hi][hc.phone] : "");
      }
    }
  } catch (e) { idx.notes.push("합배송 읽기 오류: " + e.message); }

  // ── 사방넷_송장매칭 (★ 일일마감 미사용 + 마감마다 초기화됨) ──
  try {
    var sbTab = typeof _po_getSabangnetMatchTab_ === "function" ? _po_getSabangnetMatchTab_() : null;
    readFixed("사방넷_송장매칭", sbTab, { name: 5, phone: -1, invoice: 6, uid: 9 }, 1);
  } catch (e) { idx.notes.push("사방넷_송장매칭 읽기 오류: " + e.message); }

  return idx;
}

// ═══════════════════════════════════════════
//  미매칭 대상 수집
// ═══════════════════════════════════════════

/** 판매현황_임시기록에서 아직 매칭완료가 아닌 행 */
function _pud_collectSnapshotTargets_(targets, notes) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var snap = ss.getSheetByName(_SNAPSHOT_TAB_NAME_);
    if (!snap || snap.getLastRow() < 2) { notes.push("스냅샷 탭 비어있음"); return; }
    var lr = snap.getLastRow(), lc = snap.getLastColumn();
    var hdr = snap.getRange(1, 1, 1, lc).getValues()[0];
    var data = snap.getRange(2, 1, lr - 1, lc).getDisplayValues();

    var itemIdx = -1;
    for (var h = 2; h < lc - 1; h++) {
      if (/품목명|상품명|제품명|품명/.test(String(hdr[h] || "").replace(/\s/g, ""))) { itemIdx = h; break; }
    }
    if (itemIdx < 0) itemIdx = 4;

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][lc - 1] || "").trim() === _SNAPSHOT_STATUS_MATCHED_) continue;
      var mk = String(data[i][1] || "").trim();
      targets.push({
        origin: "스냅샷",
        date: String(data[i][0] || "").trim(),
        matchKey: mk,
        name: String(data[i][14] || "").trim(),
        phone: String(data[i][15] || "").trim(),
        item: String(data[i][itemIdx] || "").trim(),
      });
    }
  } catch (e) { notes.push("스냅샷 읽기 오류: " + e.message); }
}

/** 최근 N일 일일마감 파일에서 출처=미매칭 행 */
function _pud_collectArchiveTargets_(targets, notes, days) {
  var today = new Date();
  for (var d = 0; d <= days; d++) {
    var dt = new Date(today.getTime());
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
    try {
      var ss = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
      if (!ss) continue;
      var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
      if (!tab || tab.getLastRow() < 2) continue;
      var all = tab.getRange(1, 1, tab.getLastRow(), Math.max(tab.getLastColumn(), 2)).getDisplayValues();
      var cols = _pep_mapArchiveMatchCols_(all[0]);
      var itemIdx = -1;
      for (var h = 0; h < all[0].length; h++) {
        if (/품목명|상품명|제품명|품명/.test(String(all[0][h] || "").replace(/\s/g, ""))) { itemIdx = h; break; }
      }
      for (var r = 1; r < all.length; r++) {
        if (String(all[r][cols.src] || "").trim() !== "미매칭") continue;
        if (_pud_normInv_(all[r][cols.inv])) continue;
        targets.push({
          origin: "일일마감(" + dateStr + ")",
          date: dateStr,
          matchKey: _pep_deriveMatchKeyFromArchiveRow_(all[r], cols),
          name: cols.name >= 0 ? String(all[r][cols.name] || "").trim() : "",
          phone: cols.phone >= 0 ? String(all[r][cols.phone] || "").trim() : "",
          item: itemIdx >= 0 ? String(all[r][itemIdx] || "").trim() : "",
        });
      }
    } catch (e) { notes.push(dateStr + " 일일마감 읽기 오류: " + e.message); }
  }
}

// ═══════════════════════════════════════════
//  판정
// ═══════════════════════════════════════════

function _pud_dedupCands_(list) {
  var seen = {}, out = [];
  for (var i = 0; i < (list || []).length; i++) {
    var c = list[i];
    var k = c.src + "|" + c.uid + "|" + c.inv;
    if (seen[k]) continue;
    seen[k] = true;
    out.push(c);
  }
  return out;
}

function _pud_splitByDaily_(list) {
  var daily = [], other = [];
  for (var i = 0; i < (list || []).length; i++) {
    if (_pud_sourceMeta_(list[i].src).usedByDaily) daily.push(list[i]);
    else other.push(list[i]);
  }
  return { daily: daily, other: other };
}

function _pud_srcSummary_(list) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    if (seen[list[i].src]) continue;
    seen[list[i].src] = true;
    out.push(list[i].src);
  }
  return out.join(", ");
}

function _pud_invSummary_(list) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length && out.length < 4; i++) {
    if (seen[list[i].inv]) continue;
    seen[list[i].inv] = true;
    out.push(list[i].inv);
  }
  return out.join(", ");
}

function _pud_uidSummary_(list) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length && out.length < 3; i++) {
    var u = list[i].uid || "(없음)";
    if (seen[u]) continue;
    seen[u] = true;
    out.push(u);
  }
  return out.join(", ");
}

/**
 * 미매칭 행 1건의 원인 판정.
 * 원인 번호는 조사 리포트의 6개 원인과 대응한다.
 *   1 UID불일치  2 임시기록이름키없음  3 이름정규화
 *   4/6 소스제외  5 기간초과  0 송장미수집
 */
function _pud_verdict_(t, idx, backfillDays) {
  var base = _pud_baseKey_(t.matchKey);
  if (!base) {
    return {
      verdict: "키없음", cause: "— 스냅샷 매칭키 생성 실패",
      srcs: "", uids: "", invs: "",
      detail: "판매현황 O열(주문번호)·P열(전화)이 모두 비어 매칭키를 만들 수 없었습니다.",
    };
  }

  var strict = _pud_strictName_(t.name) || (/[\uAC00-\uD7AF]/.test(base) ? _pud_strictName_(base) : "");
  var loose = _pud_looseName_(t.name) || (/[\uAC00-\uD7AF]/.test(base) ? _pud_looseName_(base) : "");
  var phone = _pud_phoneDigits_(t.phone);
  if (!phone && base.indexOf("TEL:") === 0) phone = _pud_phoneDigits_(base.replace(/^TEL:/, ""));

  var ageDays = _pud_ageDays_(t.date);
  var overdue = ageDays > backfillDays;

  // ① UID 직접 일치
  var byUid = _pud_dedupCands_(idx.uid[base]);
  if (byUid.length) {
    var su = _pud_splitByDaily_(byUid);
    if (su.daily.length) {
      return {
        verdict: overdue ? "재매칭가능(기간초과)" : "재매칭가능",
        cause: overdue ? "5 소급 보강 창(" + backfillDays + "일) 초과" : "— 늦게 붙은 송장",
        srcs: _pud_srcSummary_(su.daily), uids: _pud_uidSummary_(su.daily), invs: _pud_invSummary_(su.daily),
        detail: overdue
          ? "송장이 " + _pud_srcSummary_(su.daily) + "에 있으나 주문일이 " + ageDays + "일 전이라 소급 보강 대상에서 빠집니다."
          : "UID가 그대로 일치합니다. 다음 일일마감의 소급 보강에서 채워질 건입니다.",
      };
    }
    return {
      verdict: "소스제외", cause: "4/6 일일마감이 읽지 않는 소스",
      srcs: _pud_srcSummary_(su.other), uids: _pud_uidSummary_(su.other), invs: _pud_invSummary_(su.other),
      detail: "UID가 " + _pud_srcSummary_(su.other) + "에서 일치하지만, 일일마감은 이 소스를 송장맵에 넣지 않습니다.",
    };
  }

  // ② 이름+전화 후보 수집
  var nameHits = _pud_dedupCands_(idx.name[strict]);
  var looseHits = [];
  if (loose) {
    var lh = _pud_dedupCands_(idx.loose[loose]);
    for (var i = 0; i < lh.length; i++) {
      if (_pud_strictName_(lh[i].name) !== strict) looseHits.push(lh[i]);
    }
  }
  var phoneHits = [];
  if (phone.length >= 8) phoneHits = _pud_dedupCands_(idx.phone[phone]);
  else if (phone.length >= 7) phoneHits = _pud_dedupCands_(idx.head7[phone.substring(0, 7)]);

  // ③ 이름·전화 동시 일치 → 키 스킴 문제
  var np = [];
  for (var n = 0; n < nameHits.length; n++) {
    if (!phone) continue;
    var cp = nameHits[n].phone;
    if (cp && (cp === phone || cp.substring(cp.length - 4) === phone.substring(phone.length - 4))) np.push(nameHits[n]);
  }
  if (np.length) {
    var snp = _pud_splitByDaily_(np);
    if (!snp.daily.length) {
      return {
        verdict: "소스제외", cause: "4/6 일일마감이 읽지 않는 소스",
        srcs: _pud_srcSummary_(snp.other), uids: _pud_uidSummary_(snp.other), invs: _pud_invSummary_(snp.other),
        detail: "수취인+전화가 " + _pud_srcSummary_(snp.other) + "에서 일치하지만 일일마감은 이 소스를 송장맵에 넣지 않습니다.",
      };
    }
    var pick = snp.daily;
    var uidsDiffer = false, hasUid = false;
    for (var u = 0; u < pick.length; u++) {
      if (!pick[u].uid) continue;
      hasUid = true;
      if (_pud_baseKey_(pick[u].uid) !== base) uidsDiffer = true;
    }
    if (uidsDiffer) {
      return {
        verdict: "UID불일치", cause: "1 UID 체계 불일치",
        srcs: _pud_srcSummary_(pick), uids: _pud_uidSummary_(pick), invs: _pud_invSummary_(pick),
        detail: "송장은 " + _pud_srcSummary_(pick) + "에 있고 수취인+전화도 일치하지만, 그쪽 UID("
          + _pud_uidSummary_(pick) + ")가 매칭키(" + base + ")와 달라 UID 조회가 실패했습니다.",
      };
    }
    return {
      verdict: hasUid ? "원인미상" : "소스UID없음",
      cause: hasUid ? "? 이름·전화·UID가 모두 맞는데 실패 — 개별 확인" : "1 송장 행에 UID가 없어 UID 조회 불가",
      srcs: _pud_srcSummary_(pick), uids: _pud_uidSummary_(pick), invs: _pud_invSummary_(pick),
      detail: hasUid
        ? "이 건은 자동 판정으로 설명되지 않습니다. 해당 소스 행을 직접 확인해 주세요."
        : "송장은 " + _pud_srcSummary_(pick) + "에 있으나 그 행에 UID가 비어 있어, 수취인+전화 폴백에만 의존해야 했습니다.",
    };
  }

  // ④ 느슨한 이름으로만 일치 → 정규화 규칙 불일치
  if (looseHits.length) {
    var sl = _pud_splitByDaily_(looseHits);
    var pickL = sl.daily.length ? sl.daily : sl.other;
    return {
      verdict: "이름정규화", cause: "3 수취인 정규화 규칙 불일치",
      srcs: _pud_srcSummary_(pickL), uids: _pud_uidSummary_(pickL), invs: _pud_invSummary_(pickL),
      detail: "표기를 느슨하게 맞추면 " + _pud_srcSummary_(pickL) + "의 수취인과 같은 사람입니다. "
        + "엄격 정규화 결과가 달라 키가 어긋났습니다. (진단='" + strict + "' vs 소스='" + _pud_strictName_(pickL[0].name) + "')",
    };
  }

  // ⑤ 이름만 일치 → 동명이인 / 이름키 미등록 / 전화 불일치
  if (nameHits.length) {
    var sn = _pud_splitByDaily_(nameHits);
    if (!sn.daily.length) {
      return {
        verdict: "소스제외", cause: "4/6 일일마감이 읽지 않는 소스",
        srcs: _pud_srcSummary_(sn.other), uids: _pud_uidSummary_(sn.other), invs: _pud_invSummary_(sn.other),
        detail: "수취인명이 " + _pud_srcSummary_(sn.other) + "에서 일치하지만 일일마감은 이 소스를 읽지 않습니다.",
      };
    }
    var pickN = sn.daily;
    var distinct = {};
    for (var q = 0; q < pickN.length; q++) distinct[pickN[q].inv] = true;
    var nInv = Object.keys(distinct).length;
    if (nInv > 1) {
      return {
        verdict: "동명이인", cause: "— 같은 이름에 서로 다른 송장 " + nInv + "건",
        srcs: _pud_srcSummary_(pickN), uids: _pud_uidSummary_(pickN), invs: _pud_invSummary_(pickN),
        detail: "수취인명이 같은 후보가 여러 송장을 갖고 있어 자동 확정이 위험합니다. 주소·품목으로 수동 확인이 필요합니다.",
      };
    }
    // 이름키를 등록하지 않는 소스(임시기록·보관·허브)는 NAME: 폴백 자체가 없다
    var allSkipName = true;
    for (var k2 = 0; k2 < pickN.length; k2++) {
      if (!_pud_sourceMeta_(pickN[k2].src).skipsNameKey) allSkipName = false;
    }
    if (allSkipName) {
      return {
        verdict: "이름키미등록", cause: "2 소스가 이름키를 등록하지 않음",
        srcs: _pud_srcSummary_(pickN), uids: _pud_uidSummary_(pickN), invs: _pud_invSummary_(pickN),
        detail: "송장은 " + _pud_srcSummary_(pickN) + "에 있고 수취인명도 같지만, 이 소스는 이름키(NAME:)를 "
          + "등록하지 않아(skipName) 이름 폴백이 동작할 수 없었습니다. UID와 전화도 맞지 않아 도달 경로가 없습니다.",
      };
    }
    return {
      verdict: phone ? "전화불일치" : "전화없음",
      cause: phone ? "3 전화 표기 불일치" : "— 전화가 없어 이름만으로는 확정 불가",
      srcs: _pud_srcSummary_(pickN), uids: _pud_uidSummary_(pickN), invs: _pud_invSummary_(pickN),
      detail: "수취인명은 " + _pud_srcSummary_(pickN) + "에서 일치하나 전화로 확정할 수 없습니다."
        + (phone ? " 주문 전화=" + phone + ", 소스 전화=" + (pickN[0].phone || "(없음)") : ""),
    };
  }

  // ⑥ 전화만 일치
  if (phoneHits.length) {
    var sp = _pud_splitByDaily_(phoneHits);
    var pickP = sp.daily.length ? sp.daily : sp.other;
    return {
      verdict: "이름불일치", cause: "3 전화는 같고 수취인명이 다름",
      srcs: _pud_srcSummary_(pickP), uids: _pud_uidSummary_(pickP), invs: _pud_invSummary_(pickP),
      detail: "전화가 일치하는 송장이 " + _pud_srcSummary_(pickP) + "에 있습니다. 수취인명 표기가 달라 이름키가 어긋났습니다.",
    };
  }

  // ⑦ 어느 소스에도 없음
  return {
    verdict: "송장미수집", cause: "0 어느 소스에도 송장이 없음",
    srcs: "", uids: "", invs: "",
    detail: overdue
      ? "주문일이 " + ageDays + "일 전인데도 송장이 수집되지 않았습니다. 실제 미출고 또는 택배사 데이터 미반영입니다."
      : "아직 송장이 어느 소스에도 없습니다. 출고 전이거나 택배사 취합이 반영되지 않은 상태입니다.",
  };
}

/** 주문일 → 경과일. 해석 불가 시 -1 (기간초과 판정하지 않음) */
function _pud_ageDays_(dateStr) {
  var s = _pud_normDate_(dateStr);
  if (!s) return -1;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.floor((new Date().getTime() - d.getTime()) / 86400000);
}

/** 여러 표기의 날짜를 yyyy-MM-dd로 통일 (해석 불가 시 빈 문자열) */
function _pud_normDate_(dateStr) {
  var s = String(dateStr || "").trim();
  if (!s) return "";
  var m = s.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
  if (!m) return "";
  return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
}

// ═══════════════════════════════════════════
//  본체
// ═══════════════════════════════════════════

/**
 * @param {Object} opt { days, includeSnapshot, includeArchive, backfillDays }
 * @return {Object} { total, byVerdict, rows, notes, srcStat, error }
 */
function _pud_core_(opt) {
  opt = opt || {};
  var days = opt.days > 0 ? opt.days : _PUD_DEFAULT_DAYS_;
  var backfillDays = opt.backfillDays > 0
    ? opt.backfillDays
    : (typeof _PEP_BACKFILL_DAYS_ !== "undefined" ? _PEP_BACKFILL_DAYS_ : 14);
  var started = new Date().getTime();
  var out = {
    total: 0, byVerdict: {}, byCause: {}, rows: [], notes: [],
    srcStat: {}, srcState: {}, truncated: false, error: "",
  };

  try {
    var idx = _pud_buildCandidateIndex_();
    out.srcStat = idx.stat;
    out.srcState = idx.state;
    out.notes = out.notes.concat(idx.notes);

    var targets = [];
    if (opt.includeSnapshot !== false) _pud_collectSnapshotTargets_(targets, out.notes);
    if (opt.includeArchive !== false) _pud_collectArchiveTargets_(targets, out.notes, days);

    // 같은 매칭키가 스냅샷과 일일마감 양쪽에 있으면 1건으로 본다
    var seen = {}, uniq = [];
    for (var i = 0; i < targets.length; i++) {
      var k = (_pud_normDate_(targets[i].date) || targets[i].date) + "|"
        + _pud_baseKey_(targets[i].matchKey) + "|" + targets[i].item;
      if (seen[k]) continue;
      seen[k] = true;
      uniq.push(targets[i]);
    }

    var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    for (var j = 0; j < uniq.length; j++) {
      if (out.rows.length >= _PUD_MAX_ROWS_ || new Date().getTime() - started > _PUD_TIME_BUDGET_MS_) {
        out.truncated = true;
        break;
      }
      var t = uniq[j];
      var v = _pud_verdict_(t, idx, backfillDays);
      out.byVerdict[v.verdict] = (out.byVerdict[v.verdict] || 0) + 1;
      var causeNo = String(v.cause).split(" ")[0];
      out.byCause[causeNo] = (out.byCause[causeNo] || 0) + 1;
      out.rows.push([
        nowStr, t.origin, t.date, t.matchKey, _pud_keyKind_(t.matchKey),
        t.name, t.phone, t.item,
        v.verdict, v.cause, v.srcs, v.uids, v.invs, v.detail,
      ]);
      out.total++;
    }
  } catch (e) {
    out.error = String(e.message || e);
    Logger.log("[UNMATCH_DIAG] 오류: " + out.error);
  }
  return out;
}

/** 결과 탭 생성/갱신 */
function _pud_writeReport_(report) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PUD_TAB_NAME_);
  if (!tab) {
    tab = ss.insertSheet(_PUD_TAB_NAME_);
  } else if (tab.getLastRow() >= 1) {
    tab.clear();
  }

  tab.getRange(1, 1, 1, _PUD_HEADERS_.length).setValues([_PUD_HEADERS_])
    .setFontWeight("bold").setBackground("#1a237e").setFontColor("#ffffff");
  tab.setFrozenRows(1);

  if (report.rows.length) {
    tab.getRange(2, 1, report.rows.length, _PUD_HEADERS_.length).setValues(report.rows);
  }
  for (var c = 1; c <= _PUD_HEADERS_.length; c++) {
    try { tab.autoResizeColumn(c); } catch (e) {}
  }
  try { tab.setColumnWidth(14, 480); } catch (e) {}
  return tab;
}

/** 요약 문자열 (알림·로그 공용) */
function _pud_summaryText_(report) {
  var lines = [];
  lines.push("미매칭 진단 대상: " + report.total + "건");
  if (report.truncated) lines.push("(상한 초과로 일부만 진단 — 기간을 줄여 재실행)");
  lines.push("");
  lines.push("── 판정별 ──");
  var keys = Object.keys(report.byVerdict).sort(function (a, b) {
    return report.byVerdict[b] - report.byVerdict[a];
  });
  for (var i = 0; i < keys.length; i++) {
    lines.push("  " + keys[i] + ": " + report.byVerdict[keys[i]] + "건");
  }
  lines.push("");
  lines.push("── 원인별 (대책 우선순위) ──");
  var causeLabel = {
    "0": "송장 자체가 미수집 (출고 전 / 택배사 미반영)",
    "1": "UID 체계 불일치 — 키 브리지 필요",
    "2": "소스가 이름키를 등록하지 않음 (skipName)",
    "3": "수취인·전화 정규화 불일치",
    "4/6": "일일마감이 읽지 않는 소스 (로젠 / 사방넷_송장매칭)",
    "5": "소급 보강 창 초과",
    "—": "구조 원인 아님 (정상 대기·수동 확인)",
    "?": "자동 판정 불가 — 개별 확인",
  };
  var ck = Object.keys(report.byCause).sort(function (a, b) {
    return report.byCause[b] - report.byCause[a];
  });
  for (var ci = 0; ci < ck.length; ci++) {
    lines.push("  [" + ck[ci] + "] " + (causeLabel[ck[ci]] || "기타") + ": " + report.byCause[ck[ci]] + "건");
  }
  lines.push("");
  lines.push("── 소스별 송장 행수 ──");
  for (var s = 0; s < _PUD_SOURCES_.length; s++) {
    var key = _PUD_SOURCES_[s].key;
    var n = report.srcStat[key] || 0;
    var st = (report.srcState && report.srcState[key]) || "미확인";
    lines.push("  " + key + ": " + n + "건"
      + (st === "읽음" ? "" : " [" + st + "]")
      + (_PUD_SOURCES_[s].usedByDaily ? "" : " (★ 일일마감 미사용)"));
  }
  if (report.notes.length) {
    lines.push("");
    lines.push("── 참고 ──");
    for (var n = 0; n < Math.min(report.notes.length, 8); n++) lines.push("  " + report.notes[n]);
  }
  return lines.join("\n");
}

/** 메뉴 진입점 — 최근 7일 미매칭 원인 진단 */
function partnerDiagnoseUnifiedUnmatched() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var report = _pud_core_({ days: _PUD_DEFAULT_DAYS_ });
  if (report.error) {
    var em = "미매칭 진단 실패: " + report.error;
    if (ui) ui.alert(em); else Logger.log("[UNMATCH_DIAG] " + em);
    return report;
  }

  _pud_writeReport_(report);
  var text = _pud_summaryText_(report);
  Logger.log("[UNMATCH_DIAG]\n" + text);
  if (ui) {
    ui.alert("일일마감 미매칭 진단 완료", text + "\n\n상세는 '" + _PUD_TAB_NAME_ + "' 탭을 확인하세요.", ui.ButtonSet.OK);
  }
  return report;
}
