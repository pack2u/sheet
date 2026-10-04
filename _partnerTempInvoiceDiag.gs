/**
 * 대리공급_임시기록 송장 데이터 점검 — 읽기 전용
 *
 * 이 탭의 X열(송장번호)은 세 곳에서 서로 다른 규칙으로 판정된다:
 *   - 송장 수집 : String(X).trim() 이 있으면 "이미 있음"으로 보고 건너뜀
 *   - 마감 정리 : String(X).trim() 이 있으면 보관 후 원본 삭제
 *   - 일일마감  : _po_hasRealInvoice_(X) — placeholder는 없는 것으로 봄
 * 규칙이 갈리면 송장 없는 주문이 조용히 사라진다. 그 상태를 숫자로 보여준다.
 *
 * 또한 임시기록의 송장 수집은 전화 뒷 4자리 키를 쓰기 때문에
 * 마스킹 전화(010-1234-****)를 활용하지 못한다.
 * 일일마감 송장맵(앞 7자리·주소 키 포함)으로 조회하면 몇 건이 더 붙는지 함께 센다.
 */

var _PTI_TAB_NAME_ = "임시기록_송장점검";
var _PTI_MAX_ROWS_ = 4000;

var _PTI_HEADERS_ = [
  "점검일시",   // A
  "원본",       // B: 임시기록 / 임시기록_보관
  "행",         // C: 시트 행번호
  "일자-No.",   // D
  "고유ID",     // E
  "수취인",     // F
  "전화상태",   // G: 정상 / 마스킹 / 없음
  "주소키",     // H
  "송장상태",   // I: 정상 / placeholder / 없음
  "송장",       // J
  "업체",       // K
  "대기일",     // L
  "판정",       // M
  "비고",       // N
];

/** 전화 상태 라벨 */
function _pti_phoneState_(phone) {
  var d = String(phone == null ? "" : phone).replace(/[^0-9]/g, "");
  if (!d) return "없음";
  if (_pep_isMaskedPhone_(phone)) return "마스킹";
  return "정상";
}

/** 송장 상태 라벨 */
function _pti_invState_(inv) {
  var s = String(inv == null ? "" : inv).trim();
  if (!s) return "없음";
  if (typeof _po_isInvPlaceholder_ === "function" && _po_isInvPlaceholder_(s)) return "placeholder";
  return "정상";
}

/** 임시기록/보관 탭을 공통 스키마로 읽는다 */
function _pti_readTab_(label, tab, off) {
  var out = [];
  if (!tab || tab.getLastRow() < 2) return out;
  var lc = Math.max(tab.getLastColumn(), _PO_TEMP_STATUS_COL_ + off + 1);
  var lr = Math.min(tab.getLastRow() - 1, _PTI_MAX_ROWS_);
  var data = tab.getRange(2, 1, lr, lc).getDisplayValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var uid = String(r[_PO_TEMP_UID_COL_ + off] || "").trim();
    var inv = String(r[_PO_TEMP_INV_COL_ + off] || "").trim();
    var name = String(r[12 + off] || "").trim();
    var dateNo = String(r[2 + off] || "").trim();
    // 빈 행 건너뜀
    if (!uid && !inv && !name && !dateNo) continue;
    out.push({
      label: label,
      row: i + 2,
      dateNo: dateNo,
      uid: uid,
      name: name,
      phone: r[8 + off] || r[7 + off] || "",
      addr: r[9 + off] || "",
      item: String(r[4 + off] || "").trim(),
      qty: String(r[6 + off] || "").trim(),
      inv: inv,
      // 대리공급은 타 공급처가 송장을 써준다 → 업체·진행상태가 미발행 판단 근거
      prefix: String(r[22 + off] || "").trim(),
      status: String(r[_PO_TEMP_STATUS_COL_ + off] || "").trim(),
    });
  }
  return out;
}

/** 이 일수를 넘겨 대기 중이면 공급처를 쪼아야 하는 건으로 본다 */
var _PTI_PENDING_WARN_DAYS_ = 3;

/** 업체prefix → 운영자가 읽는 업체명 */
function _pti_vendorLabel_(prefix) {
  var p = String(prefix || "").trim();
  if (!p) return "(업체미상)";
  if (typeof _puv_vendorLabel_ === "function") {
    var lbl = _puv_vendorLabel_(p);
    if (lbl) return lbl;
  }
  return p.toUpperCase();
}

/** 주문일로부터 며칠 지났는지 (판단 불가면 null) */
function _pti_waitDays_(dateNo) {
  var dn = _pti_dateNum_(dateNo);
  if (!dn) return null;
  var y = Math.floor(dn / 10000);
  var m = Math.floor((dn % 10000) / 100);
  var d = dn % 100;
  var then = new Date(y, m - 1, d);
  var now = new Date();
  var days = Math.floor((now.getTime() - then.getTime()) / 86400000);
  return days < 0 ? 0 : days;
}

/** C열 "2026/06/25-12" → yyyymmdd */
function _pti_dateNum_(dateNo) {
  var m = String(dateNo || "").match(/(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  var mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return parseInt(m[1], 10) * 10000 + mo * 100 + d;
}

function _pti_analyze_(rows, map) {
  var res = {
    total: rows.length,
    invOk: 0, invPlaceholder: 0, invNone: 0,
    phoneOk: 0, phoneMasked: 0, phoneNone: 0,
    addrOk: 0, uidNone: 0,
    dupInvoiceRows: 0, dupInvoiceKinds: 0,
    dupSameOrderRows: 0, dupSameOrderKinds: 0,
    recoverable: 0, recoverVia: {},
    pending: 0, pendingLong: 0, byVendor: {}, vendorList: [],
    staleNoInv: 0,
    detail: [],
  };

  var cutoff = _pea_cutoffNum_ ? _pea_cutoffNum_(15) : null;
  var invSeen = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var iState = _pti_invState_(r.inv);
    var pState = _pti_phoneState_(r.phone);
    var addrKey = _pep_addrKey_(r.addr);

    if (iState === "정상") res.invOk++;
    else if (iState === "placeholder") res.invPlaceholder++;
    else res.invNone++;

    if (pState === "정상") res.phoneOk++;
    else if (pState === "마스킹") res.phoneMasked++;
    else res.phoneNone++;

    if (addrKey) res.addrOk++;
    if (!r.uid) res.uidNone++;

    var verdict = "";
    var note = "";

    if (iState === "정상") {
      // 같은 송장이 여러 행에 배정됐는지
      var parts = String(r.inv).split(/[\n,\/]/);
      for (var p = 0; p < parts.length; p++) {
        var key = parts[p].trim();
        if (!key) continue;
        if (!invSeen[key]) invSeen[key] = [];
        invSeen[key].push(r);
      }
    } else {
      // 송장 없음 — 두 가지를 구분한다.
      //  (a) 송장은 어딘가 존재하는데 임시기록에 안 붙음 → 우리 매칭 문제
      //  (b) 애초에 공급처가 송장을 안 냈음 → 정상 대기. 업체를 쪼아야 하는 건
      var via = {};
      var hit = _pep_lookupNamePhoneInvoice_(map, r.name, r.phone, r.addr, r.item, via);
      if (!hit || !hit.inv) {
        var byUid = r.uid ? _pep_lookupInvoiceMap_(map, r.uid) : null;
        if (byUid && byUid.inv) { hit = byUid; via.via = "UID"; }
      }

      var waitDays = _pti_waitDays_(r.dateNo);
      var vendor = _pti_vendorLabel_(r.prefix);

      if (hit && hit.inv) {
        res.recoverable++;
        res.recoverVia[via.via || "?"] = (res.recoverVia[via.via || "?"] || 0) + 1;
        verdict = "회수가능";
        note = "일일마감 송장맵에 있음 → " + hit.inv + " (" + (hit.source || "") + ") / 키=" + (via.via || "");
      } else {
        verdict = "업체미발행";
        res.pending++;
        var vs = res.byVendor[vendor];
        if (!vs) { vs = res.byVendor[vendor] = { count: 0, maxWait: 0 }; res.vendorList.push(vendor); }
        vs.count++;
        if (waitDays != null && waitDays > vs.maxWait) vs.maxWait = waitDays;
        if (waitDays != null && waitDays >= _PTI_PENDING_WARN_DAYS_) res.pendingLong++;
        note = "공급처가 송장을 아직 안 냄 (송장맵에도 없음)" +
          " / 업체=" + vendor +
          (r.status ? " / 진행상태=" + r.status : "") +
          (waitDays != null ? " / 대기 " + waitDays + "일" : " / 주문일 불명");
      }

      var dn = _pti_dateNum_(r.dateNo);
      if (dn && cutoff && dn <= cutoff) {
        res.staleNoInv++;
        note += " / ⚠ 15일 초과 — 다음 마감정리에서 보관 후 삭제됨";
      }
    }

    if (iState === "placeholder") {
      verdict = "placeholder";
      note = "수집은 '이미 송장있음'으로 건너뛰고, 마감정리는 '송장있음'으로 삭제한다. " +
        "일일마감 송장맵은 없는 것으로 봐서 결국 송장 없이 사라진다.";
    }

    if (verdict) {
      res.detail.push({ r: r, iState: iState, pState: pState, addrKey: addrKey, verdict: verdict, note: note });
    }
  }

  // ── 중복 송장 집계 ──
  // 같은 주문(고유ID)의 여러 품목 행이 한 송장을 공유하는 건 정상이다(다품목·합포장).
  // 고유ID가 서로 다른 행에 같은 송장이 들어간 경우만 오배정이다.
  for (var k in invSeen) {
    if (!invSeen.hasOwnProperty(k)) continue;
    var grp = invSeen[k];
    if (grp.length <= 1) continue;

    var uids = {}, uidList = [];
    for (var u = 0; u < grp.length; u++) {
      var uk = grp[u].uid || "(없음)";
      if (!uids[uk]) { uids[uk] = true; uidList.push(uk); }
    }
    var sameOrder = uidList.length === 1;

    if (sameOrder) {
      res.dupSameOrderKinds++;
      res.dupSameOrderRows += grp.length;
      continue; // 정상 — 상세에 남기지 않는다
    }

    res.dupInvoiceKinds++;
    res.dupInvoiceRows += grp.length;
    for (var d2 = 0; d2 < grp.length; d2++) {
      var rr = grp[d2];
      res.detail.push({
        r: rr, iState: "정상",
        pState: _pti_phoneState_(rr.phone),
        addrKey: _pep_addrKey_(rr.addr),
        verdict: "송장오배정",
        note: "송장 " + k + " 이 서로 다른 주문 " + uidList.length + "건에 배정됨 (고유ID: " +
          uidList.join(", ") + ")",
      });
    }
  }

  return res;
}

function _pti_writeTab_(res) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PTI_TAB_NAME_);
  if (!tab) tab = ss.insertSheet(_PTI_TAB_NAME_);
  tab.clear();
  tab.getRange(1, 1, 1, _PTI_HEADERS_.length).setValues([_PTI_HEADERS_])
    .setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
  tab.setFrozenRows(1);

  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var out = [];
  for (var i = 0; i < res.detail.length; i++) {
    var d = res.detail[i];
    var wd = _pti_waitDays_(d.r.dateNo);
    out.push([
      now, d.r.label, d.r.row, d.r.dateNo, d.r.uid, d.r.name,
      d.pState, d.addrKey, d.iState, d.r.inv,
      _pti_vendorLabel_(d.r.prefix), wd == null ? "" : wd,
      d.verdict, d.note,
    ]);
  }
  if (out.length) tab.getRange(2, 1, out.length, _PTI_HEADERS_.length).setValues(out);
  tab.setColumnWidth(8, 150);
  tab.setColumnWidth(14, 560);
  return out.length;
}

function partnerDiagnoseTempInvoiceData() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var rows = [];
  var notes = [];
  try {
    var tempSS = typeof _po_openTempSheetSs_ === "function"
      ? _po_openTempSheetSs_() : SpreadsheetApp.getActiveSpreadsheet();
    rows = rows.concat(_pti_readTab_("임시기록", _po_getNonPartnerTempTab_(tempSS), 0));
    var off = typeof _PO_TEMP_ARCHIVE_COL_OFFSET_ !== "undefined" ? _PO_TEMP_ARCHIVE_COL_OFFSET_ : 2;
    var aTab = typeof _po_getTempArchiveTab_ === "function" ? _po_getTempArchiveTab_(tempSS) : null;
    rows = rows.concat(_pti_readTab_("임시기록_보관", aTab, off));
    if (!aTab) notes.push("보관탭 없음");
  } catch (e) {
    notes.push("읽기 오류: " + e.message);
  }

  _pep_keyStatReset_();
  var stat = { lotte: 0, weekly: 0, ledger: 0, temp: 0, hub: 0, keys: 0, errors: [] };
  var map = {};
  try { map = _puv_buildInvoiceMap_(stat); }
  catch (e) { notes.push("송장맵 오류: " + e.message); }

  var res = _pti_analyze_(rows, map);
  var written = _pti_writeTab_(res);

  var viaLines = [];
  for (var v in res.recoverVia) {
    if (res.recoverVia.hasOwnProperty(v)) viaLines.push("     · " + v + ": " + res.recoverVia[v] + "건");
  }

  // 대기가 오래된 업체를 위로 — 쪼아야 할 순서대로 보인다
  res.vendorList.sort(function (a, b) {
    return res.byVendor[b].maxWait - res.byVendor[a].maxWait;
  });
  var vendorLines = [];
  for (var vi = 0; vi < res.vendorList.length; vi++) {
    var vn = res.vendorList[vi];
    var vs = res.byVendor[vn];
    vendorLines.push("  · " + vn + ": " + vs.count + "건 (최장 대기 " + vs.maxWait + "일)");
  }

  var msg =
    "📋 대리공급_임시기록 송장 점검\n\n" +
    "대상 행: " + res.total + "건 (임시기록 + 보관)\n\n" +
    "── 송장 상태 ──\n" +
    "  정상: " + res.invOk + "건\n" +
    "  placeholder(재고확인후 판단): " + res.invPlaceholder + "건\n" +
    "  없음: " + res.invNone + "건\n\n" +
    "── 전화 상태 ──\n" +
    "  정상: " + res.phoneOk + " / 마스킹: " + res.phoneMasked + " / 없음: " + res.phoneNone + "\n" +
    "  주소 있음: " + res.addrOk + "건 / 고유ID 없음: " + res.uidNone + "건\n\n" +
    "── 송장 공유 ──\n" +
    "  ✅ 같은 주문의 여러 품목(정상): " + res.dupSameOrderKinds + "종 / " + res.dupSameOrderRows + "행\n" +
    "  ⛔ 서로 다른 주문에 같은 송장(오배정): " + res.dupInvoiceKinds + "종 / " + res.dupInvoiceRows + "행\n\n" +
    "── 위험 신호 ──\n" +
    "  송장없음 + 15일 초과(다음 마감에 삭제): " + res.staleNoInv + "건\n\n" +
    "── 송장없음 내역 구분 ──\n" +
    "  ⛔ 회수 가능 (송장맵엔 있는데 임시기록엔 안 붙음 = 우리 매칭 문제): " + res.recoverable + "건\n" +
    (viaLines.length ? viaLines.join("\n") + "\n" : "") +
    "  ⏳ 업체 미발행 (공급처가 송장을 아직 안 냄 = 정상 대기): " + res.pending + "건\n" +
    "     그중 " + _PTI_PENDING_WARN_DAYS_ + "일 이상 대기: " + res.pendingLong + "건\n" +
    (vendorLines.length ? "\n── 업체별 미발행 대기 ──\n" + vendorLines.join("\n") + "\n" : "") +
    "\n송장맵 키: " + stat.keys + "개\n" +
    (notes.length ? "\n⚠ " + notes.join(" / ") + "\n" : "") +
    "\n상세 " + written + "행은 '" + _PTI_TAB_NAME_ + "' 탭을 확인하세요.";

  if (ui) ui.alert(msg);
  Logger.log(msg);
  return msg;
}
