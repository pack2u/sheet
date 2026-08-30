/**
 * 협력업체 송장 배정 근거 점검 (읽기 전용)
 *
 * 수집 배정기(_pt_pickInvoicesForHubRow)는 후보가 필요 개수보다 많을 때만
 * 음수 점수를 걸러낸다. 그 밖의 경우에는 점수 0(근거 전무)이나 음수(규격 모순)
 * 후보도 그대로 배정한다. "모르겠으면 비워둔다"가 아니라 "제일 그럴싸한 걸 넣는다"다.
 *
 * 이 도구는 동작을 바꾸지 않는다. 이미 적힌 송장을 놓고 두 가지를 되짚는다.
 *   1) 이 수취인의 어떤 키로 이 송장에 도달할 수 있는가 → 근거 등급
 *   2) 원천에서 이 송장은 원래 누구 것인가 → 주인 대조
 *
 * 2번이 핵심이다. 원천의 주인 이름이 발주의 수취인과 다르면 그건 추정이 아니라
 * 확정된 오배정이다.
 *
 * 근거 등급(강한 것부터):
 *   A 고유ID    — 주문번호가 송장 원천에 그대로 있다. 확실.
 *   B 이름+전화 — 끝4/앞7 어느 쪽이든 이름과 전화가 함께 맞았다.
 *   C 전화단독  — 이름은 못 맞췄고 전화만 맞았다.
 *   D 이름단독  — 동명이인이면 그대로 오배정. 허브 2차 매칭은 이 키를 이미 폐기했다.
 *   X 수집원천밖 — 참고 원천(1주출고·송장원장)에만 있다. 수집 시점에 근거가 없었다.
 *   F 근거없음  — 어느 원천에서도 이 수취인으로 이 송장에 닿지 못한다.
 */

var _PCE_TAB_NAME_ = "수집_배정근거점검";
var _PCE_MAX_ORDER_ROWS_ = 12000;
var _PCE_ARCHIVE_MONTHS_ = 2; // 당월 + 전월
var _PCE_TIME_BUDGET_MS_ = 280000; // 4.7분
var _PCE_OWNER_MAX_ = 4;       // 송장 하나당 기록할 원천 주인 수 상한

// 허브/아카이브 열 (0-based) — _PO_HUB_HEADERS 순서
var _PCE_H_VENDOR = 1;
var _PCE_H_UID = 2;
var _PCE_H_DATE = 3;
var _PCE_H_ITEM = 5;
var _PCE_H_QTY = 6;
var _PCE_H_NAME = 7;
var _PCE_H_PHONE = 8;
var _PCE_H_INV = 13;

var _PCE_HEADERS_ = [
  "점검일시",     // A
  "원본",         // B
  "행",           // C
  "발주업체",     // D
  "고유ID",       // E
  "주문일자",     // F
  "수취인",       // G
  "전화상태",     // H
  "품목명",       // I
  "수량",         // J
  "송장",         // K
  "송장수",       // L
  "근거등급",     // M
  "도달키",       // N
  "품목판정",     // O
  "원천주인",     // P  ← 이 송장이 원천에서 누구 것인가
  "판정",         // Q
  "비고",         // R
];

// ═══════════════════════════════════════════════
//  정규화
// ═══════════════════════════════════════════════

/** 송장 문자열 → 정규화 키 배열. 정규화 규칙은 수집 소비대장(_po_invKey_)과 같다. */
function _pce_invKeys_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return [];
  var parts = s.split(/[\n,\/]/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (!p) continue;
    var k = typeof _po_invKey_ === "function" ? _po_invKey_(p) : p;
    if (k) out.push(k);
  }
  return out;
}

function _pce_nameNorm_(name) {
  return String(name == null ? "" : name)
    .trim()
    .replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, "");
}

/**
 * 수집 맵과 같은 키 집합을 등록한다.
 * ★ _pt_ingestInvoiceSheetTabIntoMap(_partnerHelpers.gs)의 키 생성과 같아야 한다.
 *   그쪽이 바뀌면 이 진단의 등급이 실제와 어긋난다.
 */
function _pce_addKeys_(map, name, phone, uid, inv, item) {
  var invRaw = String(inv == null ? "" : inv).trim();
  if (!invRaw) return 0;
  var entry = { invRaw: invRaw, detailRaw: String(item == null ? "" : item) };
  var added = 0;
  function put(k) {
    if (!k || k.length <= 2) return;
    if (!map[k]) map[k] = [];
    map[k].push(entry);
    added++;
  }

  var u = String(uid == null ? "" : uid).trim();
  if (u && u.length > 2) put(u);

  var n = String(name == null ? "" : name).trim();
  var p = String(phone == null ? "" : phone).replace(/[^0-9]/g, "");
  var shortP = p.length >= 4 ? p.substring(p.length - 4) : p;
  var nNorm = _pce_nameNorm_(n);

  if (n) {
    put(n + "_" + shortP);
    if (p.length >= 7) put(n + "_P" + p.substring(0, 7));
  }
  if (nNorm && nNorm !== n) {
    put(nNorm + "_" + shortP);
    if (p.length >= 7) put(nNorm + "_P" + p.substring(0, 7));
  }
  if (nNorm && nNorm.length >= 2) put("N_" + nNorm);
  if (n && n.length >= 2) put("NR_" + n);
  if (p.length >= 8) put("PH_" + p);
  return added;
}

function _pce_keyReaches_(map, key, invKey) {
  if (!key || !invKey) return false;
  var arr = map[key];
  if (!arr || !arr.length) return false;
  for (var i = 0; i < arr.length; i++) {
    var keys = _pce_invKeys_(arr[i].invRaw);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j] === invKey) return true;
    }
  }
  return false;
}

/** 이 송장에 도달하는 가장 강한 키. 수집 경로가 실제로 쓰는 키만 후보로 둔다. */
function _pce_gradeInvoice_(map, name, phone, uid, invKey) {
  var digits = String(phone == null ? "" : phone).replace(/[^0-9]/g, "");
  var shortP = digits.length >= 4 ? digits.substring(digits.length - 4) : digits;
  var nNorm = _pce_nameNorm_(name);
  var nRaw = String(name == null ? "" : name).trim();

  if (uid && _pce_keyReaches_(map, uid, invKey)) return { grade: "A", via: "고유ID" };
  if (nRaw && _pce_keyReaches_(map, nRaw + "_" + shortP, invKey)) return { grade: "B", via: "이름+전화끝4" };
  if (nNorm && _pce_keyReaches_(map, nNorm + "_" + shortP, invKey)) return { grade: "B", via: "이름정규+전화끝4" };
  if (nRaw && digits.length >= 7 && _pce_keyReaches_(map, nRaw + "_P" + digits.substring(0, 7), invKey)) {
    return { grade: "B", via: "이름+전화앞7" };
  }
  if (nNorm && digits.length >= 7 && _pce_keyReaches_(map, nNorm + "_P" + digits.substring(0, 7), invKey)) {
    return { grade: "B", via: "이름정규+전화앞7" };
  }
  if (digits.length >= 8 && _pce_keyReaches_(map, "PH_" + digits, invKey)) return { grade: "C", via: "전화단독" };
  if (nNorm && nNorm.length >= 2 && _pce_keyReaches_(map, "N_" + nNorm, invKey)) return { grade: "D", via: "이름단독(정규)" };
  if (nRaw && nRaw.length >= 2 && _pce_keyReaches_(map, "NR_" + nRaw, invKey)) return { grade: "D", via: "이름단독(원본)" };
  return { grade: "F", via: "-" };
}

/**
 * 송장 → 원천 주인 역색인.
 *
 * 맵 키에서 되짚는다. `NR_<이름>` 키에 담긴 송장은 그 이름의 것이고,
 * `PH_<전화>` 키에 담긴 송장은 그 전화의 것이다. 원천을 다시 읽지 않아도
 * 모든 원천에 대해 같은 방식으로 주인을 알 수 있다.
 */
function _pce_buildOwnerIndex_(map, label, into) {
  var idx = into || {};
  for (var k in map) {
    if (!map.hasOwnProperty(k)) continue;
    var isName = k.indexOf("NR_") === 0;
    var isPhone = k.indexOf("PH_") === 0;
    if (!isName && !isPhone) continue;
    var who = k.substring(3);
    if (!who) continue;
    var arr = map[k];
    for (var i = 0; i < arr.length; i++) {
      var detail = String(arr[i].detailRaw || "").trim();
      var invs = _pce_invKeys_(arr[i].invRaw);
      for (var j = 0; j < invs.length; j++) {
        var ik = invs[j];
        if (!idx[ik]) idx[ik] = { names: [], phones: [], item: "", src: label };
        var slot = idx[ik];
        if (!slot.item && detail) slot.item = detail;
        var list = isName ? slot.names : slot.phones;
        if (list.length < _PCE_OWNER_MAX_ && list.indexOf(who) === -1) list.push(who);
      }
    }
  }
  return idx;
}

/** 원천 주인을 사람이 읽을 문장으로. 이름이 발주 수취인과 다르면 그게 오배정 증거다. */
function _pce_ownerText_(owner) {
  if (!owner) return "";
  var parts = [];
  if (owner.names.length) parts.push(owner.names.join(", "));
  if (owner.phones.length) {
    var ph = [];
    for (var i = 0; i < owner.phones.length; i++) {
      var p = owner.phones[i];
      ph.push(p.length >= 8 ? p.substring(0, 7) + "****" : p);
    }
    parts.push(ph.join(", "));
  }
  if (owner.item) parts.push(owner.item.substring(0, 40));
  return parts.join(" / ");
}

/** 원천 주인 중 이 수취인과 이름이 맞는 사람이 있는가 */
function _pce_ownerMatchesName_(owner, name) {
  if (!owner || !owner.names.length) return true; // 판단 불가 — 오배정으로 몰지 않는다
  var target = _pce_nameNorm_(name);
  if (!target) return true;
  for (var i = 0; i < owner.names.length; i++) {
    if (_pce_nameNorm_(owner.names[i]) === target) return true;
  }
  return false;
}

function _pce_buildDetailIndex_(map, into) {
  var idx = into || {};
  for (var k in map) {
    if (!map.hasOwnProperty(k)) continue;
    var arr = map[k];
    for (var i = 0; i < arr.length; i++) {
      var detail = String(arr[i].detailRaw || "").trim();
      if (!detail) continue;
      var keys = _pce_invKeys_(arr[i].invRaw);
      for (var j = 0; j < keys.length; j++) {
        if (!idx[keys[j]]) idx[keys[j]] = detail;
      }
    }
  }
  return idx;
}

/** 품목 축 — 수집 배정기와 같은 점수 함수를 써서 배정 당시 판단을 재현한다 */
function _pce_itemVerdict_(detail, itemName) {
  if (!detail) return { label: "소스품목없음", score: null };
  if (typeof _pt_scoreInvoiceCandidate !== "function") return { label: "-", score: null };
  var sc = _pt_scoreInvoiceCandidate(detail, itemName);
  if (sc < 0) return { label: "규격모순", score: sc };
  if (sc === 0) return { label: "근거없음", score: sc };
  return { label: "일치", score: sc };
}

function _pce_colLetter_(idx) {
  if (idx == null || idx < 0) return "-";
  if (typeof _pep_colLetter_ === "function") return _pep_colLetter_(idx);
  var n = idx + 1, s = "";
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function _pce_findCol_(hdr, re) {
  if (!hdr) return -1;
  for (var i = 0; i < hdr.length; i++) {
    if (re.test(String(hdr[i] || "").replace(/\s/g, ""))) return i;
  }
  return -1;
}

// ═══════════════════════════════════════════════
//  송장 원천 읽기
// ═══════════════════════════════════════════════

/**
 * 롯데형 탭(롯데·로젠·1주출고)을 읽는다.
 *
 * ★ 수집 경로(_pt_ingestInvoiceSheetTabIntoMap)는 헤더를 1행으로 못박고
 *   getValues()로 읽는다. 일일마감 경로는 _pep_findLotteHeaderRow_로 헤더 행을
 *   찾고 getDisplayValues()로 읽는다(긴 숫자가 지수로 깨지는 것을 피하려고).
 *   여기서는 일일마감 방식으로 읽되, 수집 방식이면 몇 건이 되는지도 세서
 *   그 차이를 리포트에 드러낸다.
 */
function _pce_scanLotteLike_(tab, label, fixedCol, map, stats, collectFixed) {
  var st = {
    label: label, rows: 0, hdrRow: 0, cols: "", inv: 0, name: 0, uid: 0,
    keys: 0, fixedInv: -1, collectFixed: !!collectFixed, note: "",
  };
  if (!tab || tab.getLastRow() < 2) {
    st.note = "탭 없음 또는 비어있음";
    stats.push(st);
    return st;
  }
  var lr = tab.getLastRow();
  var lc = Math.max(tab.getLastColumn(), 30);
  var all = tab.getRange(1, 1, lr, lc).getDisplayValues();

  var hdrIdx = typeof _pep_findLotteHeaderRow_ === "function" ? _pep_findLotteHeaderRow_(all) : 0;
  var cols = typeof _pep_resolveLotteCols_ === "function"
    ? _pep_resolveLotteCols_(all[hdrIdx])
    : { name: fixedCol.name, invoice: fixedCol.invoice, uid: fixedCol.uid, phone: -1, item: -1 };
  var dataStart = hdrIdx + 1;

  if (typeof _pep_countInvoiceCol_ === "function" &&
      _pep_countInvoiceCol_(all, dataStart, cols.invoice) === 0) {
    cols = {
      name: fixedCol.name, invoice: fixedCol.invoice, uid: fixedCol.uid,
      phone: typeof fixedCol.phone === "number" ? fixedCol.phone : -1, addr: -1,
      item: typeof fixedCol.item === "number" ? fixedCol.item : -1,
    };
    dataStart = hdrIdx === 0 ? 1 : hdrIdx + 1;
    if (_pep_countInvoiceCol_(all, dataStart, cols.invoice) === 0 &&
        _pep_countInvoiceCol_(all, 1, cols.invoice) > 0) {
      dataStart = 1;
    }
    st.note = "헤더 기준 송장 0건 → 고정열 폴백";
  }

  st.hdrRow = hdrIdx + 1;
  st.cols = "송장=" + _pce_colLetter_(cols.invoice) +
    " 주문번호=" + _pce_colLetter_(cols.uid) +
    " 이름=" + _pce_colLetter_(cols.name) +
    " 품목=" + _pce_colLetter_(cols.item);

  // 수집 경로의 가정(1행 헤더 + 고정 송장열)으로 읽으면 몇 건인가.
  // 수집이 실제로 이 방식으로 읽는 원천만 비교한다.
  if (collectFixed && typeof _pep_countInvoiceCol_ === "function") {
    st.fixedInv = _pep_countInvoiceCol_(all, 1, fixedCol.invoice);
  }

  for (var i = dataStart; i < all.length; i++) {
    var r = all[i];
    st.rows++;
    var inv = typeof _pep_normInvoiceNo_ === "function"
      ? _pep_normInvoiceNo_(r[cols.invoice])
      : String(r[cols.invoice] || "").trim();
    if (!inv) continue;
    st.inv++;
    var nm = cols.name >= 0 ? r[cols.name] : "";
    var ph = cols.phone >= 0 ? r[cols.phone] : "";
    var ud = cols.uid >= 0 ? String(r[cols.uid] || "").trim() : "";
    var it = cols.item >= 0 ? r[cols.item] : "";
    if (String(nm || "").trim()) st.name++;
    if (ud) st.uid++;
    st.keys += _pce_addKeys_(map, nm, ph, ud, inv, it);
  }
  stats.push(st);
  return st;
}

/** 송장원장 — 마감으로 사라진 송장의 60일 안전망. 수집이 보는 원천은 아니다. */
function _pce_scanLedger_(map, stats) {
  var st = {
    label: "송장원장(참고)", rows: 0, hdrRow: 1,
    cols: "송장=C 고유ID=D 이름=E 전화=F 품목=H",
    inv: 0, name: 0, uid: 0, keys: 0, fixedInv: -1, collectFixed: false, note: "",
  };
  try {
    var ss = typeof _pil_openLedgerSs_ === "function" ? _pil_openLedgerSs_()
      : (typeof _po_openTempSheetSs_ === "function" ? _po_openTempSheetSs_() : null);
    var name = typeof _PIL_TAB_NAME_ !== "undefined" ? _PIL_TAB_NAME_ : "송장원장";
    var tab = ss ? ss.getSheetByName(name) : null;
    if (!tab || tab.getLastRow() < 2) {
      st.note = "탭 없음 또는 비어있음";
      stats.push(st);
      return st;
    }
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, 8).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      st.rows++;
      var inv = String(data[i][2] || "").trim();
      if (!inv) continue;
      st.inv++;
      var uid = String(data[i][3] || "").trim();
      if (uid) st.uid++;
      if (String(data[i][4] || "").trim()) st.name++;
      st.keys += _pce_addKeys_(map, data[i][4], data[i][5], uid, inv, data[i][7]);
    }
  } catch (e) {
    st.note = String(e.message || e);
  }
  stats.push(st);
  return st;
}

// ═══════════════════════════════════════════════
//  발주 행 읽기
// ═══════════════════════════════════════════════

/** 월별 허브 아카이브를 찾는다. 생성하지 않는다. */
function _pce_findArchiveSs_(yyyymm) {
  try {
    var prefix = typeof HUB_ARCHIVE_SS_ID_PREFIX !== "undefined" ? HUB_ARCHIVE_SS_ID_PREFIX : "HUB_ARCHIVE_SS_ID_";
    var cached = PropertiesService.getScriptProperties().getProperty(prefix + yyyymm);
    if (cached) {
      try { return SpreadsheetApp.openById(cached); } catch (e) {}
    }
    var namePrefix = typeof HUB_ARCHIVE_SS_NAME_PREFIX !== "undefined"
      ? HUB_ARCHIVE_SS_NAME_PREFIX : "[Pack2U 통합발주 아카이브] ";
    var it = DriveApp.getFilesByName(namePrefix + yyyymm);
    if (it.hasNext()) return SpreadsheetApp.openById(it.next().getId());
  } catch (e2) {}
  return null;
}

/** 허브 열 배열 모양으로 빈 행을 만든다 — 마감탭을 같은 스키마로 다루기 위해 */
function _pce_blankHubRow_() {
  var r = [];
  for (var i = 0; i < 15; i++) r.push("");
  return r;
}

/**
 * 업체 월 마감탭을 허브 스키마로 옮긴다.
 *
 * `발주 마감`은 발주탭 15열 구조가 그대로 온다(_PT_ORDER_TAB_HEADERS_):
 *   1=주문일자 3=품목명 4=수량 5=수취인 6=전화 10=송장 12=고유ID
 * `전용발주 마감`은 업체마다 열이 달라 헤더로 찾는다. 송장은 A열(이동일시) 다음.
 * 두 매핑 모두 _pil_readArchiveTab_(_partnerInvoiceLedger.gs)과 같은 기준을 쓴다.
 */
function _pce_readClosingTab_(tab, kind, vendor, label, out, limit) {
  if (!tab || tab.getLastRow() < 2) return 0;
  var lc = Math.max(tab.getLastColumn(), 15);
  var lr = tab.getLastRow();
  var hdr = [];
  try { hdr = tab.getRange(1, 1, 1, lc).getDisplayValues()[0]; } catch (e) {}

  var cInv, cUid, cName, cPhone, cItem, cQty, cDate;
  if (kind === "exclusive") {
    cInv = _pce_findCol_(hdr, /^송장번호$|^운송장번호$/);
    if (cInv < 0) cInv = 1;
    cUid = _pce_findCol_(hdr, /^고유ID$/i);
    if (cUid < 0) cUid = Math.min(50, lc - 1);
    cName = _pce_findCol_(hdr, /수취인|수령인|받는분|받는사람/);
    cPhone = _pce_findCol_(hdr, /받는분전화|수취인전화|수령인연락처|받는전화|전화|연락처/);
    cItem = _pce_findCol_(hdr, /품목명|상품명|품명/);
    cQty = _pce_findCol_(hdr, /수량/);
    cDate = _pce_findCol_(hdr, /주문일|일자|이동일시/);
  } else {
    cInv = 10; cUid = 12; cName = 5; cPhone = 6; cItem = 3; cQty = 4; cDate = 1;
  }

  var data = tab.getRange(1, 1, lr, lc).getDisplayValues();
  var n = 0;
  for (var i = 1; i < data.length; i++) {
    if (out.length >= limit) break;
    var raw = cInv >= 0 ? data[i][cInv] : "";
    // 헤더 잔여행·안내행을 건너뛴다. 송장으로 볼 수 있는 값이 있어야 발주 행으로 인정.
    var ok = typeof _pep_normInvoiceNo_ === "function"
      ? !!_pep_normInvoiceNo_(String(raw).split(/[\n,\/]/)[0])
      : /\d{8,}/.test(String(raw));
    if (!ok) continue;
    var r = _pce_blankHubRow_();
    r[_PCE_H_VENDOR] = vendor;
    r[_PCE_H_UID] = cUid >= 0 ? String(data[i][cUid] || "").trim() : "";
    r[_PCE_H_DATE] = cDate >= 0 ? String(data[i][cDate] || "").trim() : "";
    r[_PCE_H_ITEM] = cItem >= 0 ? String(data[i][cItem] || "").trim() : "";
    r[_PCE_H_QTY] = cQty >= 0 ? String(data[i][cQty] || "").trim() : "";
    r[_PCE_H_NAME] = cName >= 0 ? String(data[i][cName] || "").trim() : "";
    r[_PCE_H_PHONE] = cPhone >= 0 ? String(data[i][cPhone] || "").trim() : "";
    r[_PCE_H_INV] = String(raw).trim();
    out.push({ src: label, row: i + 1, r: r });
    n++;
  }
  return n;
}

/** 최근 N개월 라벨 */
function _pce_recentMonths_(n) {
  var out = [];
  var now = new Date();
  for (var i = 0; i < n; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      yyyy: d.getFullYear(),
      m: d.getMonth() + 1,
      ym: Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM"),
    });
  }
  return out;
}

// ═══════════════════════════════════════════════
//  수집 (원천 + 발주행을 한 패스로)
// ═══════════════════════════════════════════════

/**
 * 협력업체 파일은 한 번만 연다. 여는 동시에
 *   - 전용양식 탭 → 송장맵(수집 원천)
 *   - 월 마감탭   → 발주 행(과거 이력)
 * 을 함께 걷는다. 파일을 두 번 열면 시간 예산을 넘긴다.
 */
function _pce_collect_(notes, stats, t0) {
  var mapC = {}, mapR = {}, rows = [];
  var srcCount = {};

  function bump(k, n) { srcCount[k] = (srcCount[k] || 0) + n; }

  // ── 발주 행: 허브 ──
  try {
    var hubTab = _po_getHubTab();
    if (hubTab.getLastRow() >= 2) {
      var hLc = Math.max(hubTab.getLastColumn(), _PO_HUB_HEADERS.length);
      var hn = Math.min(hubTab.getLastRow() - 1, _PCE_MAX_ORDER_ROWS_);
      var hData = hubTab.getRange(2, 1, hn, hLc).getDisplayValues();
      for (var i = 0; i < hData.length; i++) rows.push({ src: "허브", row: i + 2, r: hData[i] });
      bump("허브", hData.length);
    }
  } catch (eh) {
    notes.push("[허브] " + String(eh.message || eh));
  }

  // ── 발주 행: 월별 허브 아카이브 ──
  var months = _pce_recentMonths_(_PCE_ARCHIVE_MONTHS_);
  for (var mi = 0; mi < months.length; mi++) {
    if (rows.length >= _PCE_MAX_ORDER_ROWS_) break;
    var ss = _pce_findArchiveSs_(months[mi].ym);
    if (!ss) { notes.push("허브아카이브 " + months[mi].ym + ": 파일 없음"); continue; }
    var aTab = ss.getSheetByName("발주 아카이브") || ss.getSheets()[0];
    if (!aTab || aTab.getLastRow() < 2) { notes.push("허브아카이브 " + months[mi].ym + ": 비어있음"); continue; }
    var alc = Math.max(aTab.getLastColumn(), _PO_HUB_HEADERS.length);
    var an = Math.min(aTab.getLastRow() - 1, _PCE_MAX_ORDER_ROWS_ - rows.length);
    var aData = aTab.getRange(2, 1, an, alc).getDisplayValues();
    for (var aj = 0; aj < aData.length; aj++) {
      rows.push({ src: "허브아카이브 " + months[mi].ym, row: aj + 2, r: aData[aj] });
    }
    bump("허브아카이브", aData.length);
    notes.push("허브아카이브 " + months[mi].ym + ": " + aData.length + "행");
  }

  // ── 송장 원천: 중앙 송장취합 ──
  try {
    var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
    var lotteCol = typeof _PT_LOTTE_FIXED_COL !== "undefined"
      ? _PT_LOTTE_FIXED_COL : { name: 5, phone: -1, invoice: 6, uid: 9, item: 28 };
    _pce_scanLotteLike_(_pt_getSheetByGid(invSS, _PT_SECONDARY_INVOICE_GID),
      "롯데택배", lotteCol, mapC, stats, true);

    // ★ partnerFetchInvoices의 _ROZEN_FIXED_COL과 같아야 한다
    _pce_scanLotteLike_(_pt_getSheetByGid(invSS, _PT_PRIMARY_INVOICE_GID),
      "로젠주문실적", { name: 9, phone: 12, invoice: 5, uid: 4, item: 22 }, mapC, stats, true);

    if (typeof _PT_WEEKLY_SHIP_GID !== "undefined") {
      var wCol = typeof _PT_WEEKLY_SHIP_FIXED_COL !== "undefined"
        ? _PT_WEEKLY_SHIP_FIXED_COL : { name: 11, phone: -1, invoice: 6, uid: 8 };
      _pce_scanLotteLike_(_pt_getSheetByGid(invSS, _PT_WEEKLY_SHIP_GID),
        "1주출고(참고)", wCol, mapR, stats, false);
    }
  } catch (e) {
    notes.push("[중앙송장] " + String(e.message || e));
  }

  var autoLogs = [];
  try {
    var cSS = SpreadsheetApp.openById(_PT_COMBINED_INVOICE_SHEET_ID);
    var cTab = _pt_getSheetByGid(cSS, _PT_COMBINED_INVOICE_SHEET_GID);
    if (cTab && cTab.getLastRow() > 1) {
      var before = Object.keys(mapC).length;
      _pt_ingestInvoiceSheetTabIntoMap(cTab, mapC, "합배송전용", autoLogs);
      stats.push({
        label: "합배송전용", rows: cTab.getLastRow() - 1, hdrRow: 1, cols: "자동탐지",
        inv: -1, name: -1, uid: -1, keys: Object.keys(mapC).length - before,
        fixedInv: -1, collectFixed: false, note: "",
      });
    }
  } catch (e2) {
    notes.push("[합배송] " + String(e2.message || e2));
  }

  // ── 협력업체 파일 1패스: 전용양식(송장) + 월 마감탭(발주 이력) ──
  var formTabs = 0, closeTabs = 0, skipped = 0;
  var keyBefore = Object.keys(mapC).length;
  var exSuffix = typeof _PEA_TAB_SUFFIX !== "undefined" ? _PEA_TAB_SUFFIX : "전용발주 마감";
  try {
    var files = _pt_listFiles(true);
    for (var fi = 0; fi < files.length; fi++) {
      if (new Date().getTime() - t0 > _PCE_TIME_BUDGET_MS_) {
        skipped = files.length - fi;
        notes.push("⏱ 시간 예산 초과 — 협력업체 파일 " + skipped + "개 미스캔");
        break;
      }
      var vendor = String(files[fi].name || "").replace("[협력업체] ", "").trim();
      try {
        var pss = SpreadsheetApp.openById(files[fi].id);
        var tabs = pss.getSheets();

        for (var ti = 0; ti < tabs.length; ti++) {
          var tn = tabs[ti].getName();

          // 월 마감탭 → 발주 이력
          if (tn.indexOf("마감") !== -1) {
            if (rows.length >= _PCE_MAX_ORDER_ROWS_) continue;
            var isEx = tn.indexOf(exSuffix) !== -1 || tn.indexOf("전용발주 마감") !== -1;
            var isOrd = tn.indexOf("발주 마감") !== -1 && !isEx;
            if (!isEx && !isOrd) continue;
            var got = _pce_readClosingTab_(
              tabs[ti], isEx ? "exclusive" : "order", vendor,
              (isEx ? "전용마감 " : "발주마감 ") + vendor + " " + tn,
              rows, _PCE_MAX_ORDER_ROWS_
            );
            if (got > 0) {
              closeTabs++;
              bump(isEx ? "전용발주 마감" : "발주 마감", got);
            }
            continue;
          }

          // 전용양식 → 송장 원천 (수집이 실제로 보는 곳)
          if (tn.indexOf("발주 및 송장조회") !== -1 || tn.indexOf("뷰어") !== -1 ||
              tn.indexOf("단가조회") !== -1 || tn.indexOf("공급가") !== -1 ||
              tn.indexOf("단가") !== -1 || tn.indexOf("설정") !== -1) continue;
          var isForm = tn.indexOf("전용양식") !== -1 || tn.indexOf("송장") !== -1 ||
            tn.indexOf("양식") !== -1 || tn.indexOf("뉴파츠") !== -1 ||
            tn.indexOf("NEW") !== -1 || tn.indexOf("HR") !== -1;
          if (!isForm && tabs.length > 2) continue;
          if (tabs[ti].getLastRow() <= 1) continue;
          _pt_ingestInvoiceSheetTabIntoMap(tabs[ti], mapC, vendor + "/" + tn, autoLogs);
          formTabs++;
        }
      } catch (ef) {
        notes.push("[" + vendor + "] " + String(ef.message || ef));
      }
    }
  } catch (eAll) {
    notes.push("[협력업체스캔] " + String(eAll.message || eAll));
  }
  stats.push({
    label: "협력업체 전용양식 " + formTabs + "탭", rows: -1, hdrRow: 1, cols: "자동탐지",
    inv: -1, name: -1, uid: -1, keys: Object.keys(mapC).length - keyBefore,
    fixedInv: -1, collectFixed: false,
    note: skipped ? skipped + "개 파일 미스캔" : "",
  });
  notes.push("업체 월 마감탭 " + closeTabs + "개에서 발주 이력 수집");

  _pce_scanLedger_(mapR, stats);

  for (var a = 0; a < autoLogs.length; a++) notes.push(autoLogs[a]);
  return { mapC: mapC, mapR: mapR, rows: rows, srcCount: srcCount };
}

// ═══════════════════════════════════════════════
//  판정
// ═══════════════════════════════════════════════

function _pce_analyze_(rows, mapC, mapR, detailIdx, ownerIdx) {
  var res = {
    total: 0, withInv: 0, noInv: 0, placeholder: 0,
    gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeX: 0, gradeF: 0,
    itemMatch: 0, itemNone: 0, itemConflict: 0, itemNoSrc: 0,
    qtyOver: 0, qtyUnder: 0,
    ownerMismatch: 0, ownerUnknown: 0,
    dupCrossOrder: 0, dupSameOrder: 0, normCollision: 0,
    viaCount: {}, viaList: [],
    detail: [],
  };

  var order = { A: 5, B: 4, C: 3, D: 2, X: 1, F: 0 };
  var rank = { "규격모순": 0, "근거없음": 1, "소스품목없음": 2, "-": 2, "일치": 3 };
  var invSeen = {}, rawByKey = {};

  for (var i = 0; i < rows.length; i++) {
    var rec = rows[i];
    var r = rec.r;
    var name = String(r[_PCE_H_NAME] || "").trim();
    var uid = String(r[_PCE_H_UID] || "").trim();
    var invRaw = String(r[_PCE_H_INV] || "").trim();
    var item = String(r[_PCE_H_ITEM] || "").trim();

    if (!name && !uid && !invRaw && !item) continue;
    res.total++;

    if (!invRaw) { res.noInv++; continue; }
    if (typeof _po_isInvPlaceholder_ === "function" && _po_isInvPlaceholder_(invRaw)) {
      res.placeholder++;
      continue;
    }
    if (typeof _po_hasRealInvoice_ === "function" && !_po_hasRealInvoice_(invRaw)) {
      res.noInv++;
      continue;
    }
    var invKeys = _pce_invKeys_(invRaw);
    if (!invKeys.length) { res.noInv++; continue; }
    res.withInv++;

    var rawParts = invRaw.split(/[\n,\/]/);
    for (var rp = 0; rp < rawParts.length; rp++) {
      var rpv = rawParts[rp].trim();
      if (!rpv) continue;
      var nk = typeof _po_invKey_ === "function" ? _po_invKey_(rpv) : rpv;
      if (!nk) continue;
      if (!rawByKey[nk]) rawByKey[nk] = {};
      rawByKey[nk][rpv] = true;
    }

    var worst = null, worstVia = "", vias = [];
    var itemWorst = null, itemWorstScore = null;
    var ownerTexts = [], mismatch = false, unknown = false;

    for (var vi = 0; vi < invKeys.length; vi++) {
      var ik = invKeys[vi];
      var g = _pce_gradeInvoice_(mapC, name, r[_PCE_H_PHONE], uid, ik);
      if (g.grade === "F") {
        var gr = _pce_gradeInvoice_(mapR, name, r[_PCE_H_PHONE], uid, ik);
        if (gr.grade !== "F") g = { grade: "X", via: "참고원천:" + gr.via };
      }
      vias.push(g.via);
      if (worst === null || order[g.grade] < order[worst]) {
        worst = g.grade;
        worstVia = g.via;
      }

      var own = ownerIdx[ik];
      if (own) {
        var t = _pce_ownerText_(own);
        if (t && ownerTexts.indexOf(t) === -1) ownerTexts.push(t);
        if (!_pce_ownerMatchesName_(own, name)) mismatch = true;
      } else {
        unknown = true;
      }

      var iv = _pce_itemVerdict_(detailIdx[ik] || "", item);
      if (itemWorst === null || rank[iv.label] < rank[itemWorst]) {
        itemWorst = iv.label;
        itemWorstScore = iv.score;
      }
      if (!invSeen[ik]) invSeen[ik] = [];
      invSeen[ik].push({ src: rec.src, row: rec.row, uid: uid, name: name, item: item });
    }

    if (worst === "A") res.gradeA++;
    else if (worst === "B") res.gradeB++;
    else if (worst === "C") res.gradeC++;
    else if (worst === "D") res.gradeD++;
    else if (worst === "X") res.gradeX++;
    else res.gradeF++;

    if (mismatch) res.ownerMismatch++;
    if (unknown) res.ownerUnknown++;

    if (!res.viaCount[worstVia]) { res.viaCount[worstVia] = 0; res.viaList.push(worstVia); }
    res.viaCount[worstVia]++;

    if (itemWorst === "일치") res.itemMatch++;
    else if (itemWorst === "근거없음") res.itemNone++;
    else if (itemWorst === "규격모순") res.itemConflict++;
    else res.itemNoSrc++;

    var need = typeof _pt_getRequiredParcelSlots === "function" ? _pt_getRequiredParcelSlots(r) : 1;
    var qtyNote = "";
    if (invKeys.length > need) { res.qtyOver++; qtyNote = "송장 " + invKeys.length + "개 > 필요 " + need + "개"; }
    else if (invKeys.length < need) { res.qtyUnder++; qtyNote = "송장 " + invKeys.length + "개 < 필요 " + need + "개"; }

    // 등급 A·B + 품목 일치 + 수량 정상 + 주인 일치면 볼 이유가 없다
    if ((worst === "A" || worst === "B") && itemWorst === "일치" && !qtyNote && !mismatch) continue;

    var notes2 = [];
    if (mismatch) notes2.push("⛔ 원천에서 이 송장의 주인 이름이 이 수취인과 다르다 — 오배정 확정");
    if (worst === "F" && unknown) notes2.push("어느 원천에서도 이 송장을 찾을 수 없다 — 출처 불명(수동입력 의심)");
    else if (worst === "F") notes2.push("원천에 송장은 있으나 이 수취인의 어떤 키로도 도달 못함");
    if (worst === "X") notes2.push("참고 원천(1주출고·송장원장)에만 존재 — 수집이 보는 원천에 없어 배정 근거가 없었다");
    if (worst === "D") notes2.push("이름 단독으로만 도달 — 허브 2차 매칭에서 폐기한 키. 동명이인이면 오배정");
    if (worst === "C") notes2.push("전화만 일치, 이름 불일치");
    if (itemWorst === "규격모순") notes2.push("소스 품목 규격이 주문과 어긋남(점수 " + itemWorstScore + ") — 배정기는 후보가 부족하면 이것도 넣는다");
    if (itemWorst === "근거없음") notes2.push("소스 품목과 겹치는 토큰 없음(점수 0) — 품목 근거 없이 배정");
    if (qtyNote) notes2.push(qtyNote);

    res.detail.push({
      src: rec.src, row: rec.row,
      vendor: String(r[_PCE_H_VENDOR] || "").trim(),
      uid: uid, date: String(r[_PCE_H_DATE] || "").trim(),
      name: name, phone: r[_PCE_H_PHONE], item: item,
      qty: String(r[_PCE_H_QTY] || "").trim(),
      inv: invRaw, invCount: invKeys.length,
      grade: worst, via: vias.join(" / "), itemLabel: itemWorst,
      owner: ownerTexts.join(" | "),
      verdict: mismatch ? "오배정확정"
        : worst === "F" ? "출처불명"
        : worst === "X" ? "수집원천밖"
        : itemWorst === "규격모순" ? "품목모순"
        : worst === "D" ? "이름단독"
        : worst === "C" ? "전화단독"
        : itemWorst === "근거없음" ? "품목무근거"
        : qtyNote ? "수량불일치" : "확인필요",
      note: notes2.join(" / "),
    });
  }

  for (var k in invSeen) {
    if (!invSeen.hasOwnProperty(k)) continue;
    var grp = invSeen[k];
    if (grp.length <= 1) continue;
    var uids = {}, uidList = [];
    for (var u = 0; u < grp.length; u++) {
      var uk = grp[u].uid || "(없음)";
      if (!uids[uk]) { uids[uk] = true; uidList.push(uk); }
    }
    if (uidList.length === 1) { res.dupSameOrder++; continue; }
    res.dupCrossOrder++;
    for (var d2 = 0; d2 < grp.length; d2++) {
      res.detail.push({
        src: grp[d2].src, row: grp[d2].row, vendor: "", uid: grp[d2].uid, date: "",
        name: grp[d2].name, phone: "", item: grp[d2].item, qty: "",
        inv: k, invCount: 1, grade: "-", via: "-", itemLabel: "-", owner: "",
        verdict: "동일송장오배정",
        note: "송장 " + k + " 이 서로 다른 주문 " + uidList.length + "건에 배정됨 (고유ID: " + uidList.join(", ") + ")",
      });
    }
  }

  for (var nk2 in rawByKey) {
    if (!rawByKey.hasOwnProperty(nk2)) continue;
    var forms = Object.keys(rawByKey[nk2]);
    if (forms.length <= 1) continue;
    res.normCollision++;
    res.detail.push({
      src: "", row: "", vendor: "", uid: "", date: "", name: "", phone: "",
      item: "", qty: "", inv: forms.join(" | "), invCount: forms.length,
      grade: "-", via: "-", itemLabel: "-", owner: "", verdict: "표기차이중복",
      note: "같은 송장이 서로 다른 표기로 존재. 수집 소비대장(globalUsedInvoices)은 원본 문자열을 키로 써서 이 경우 중복 배정을 막지 못한다.",
    });
  }

  return res;
}

// ═══════════════════════════════════════════════
//  리포트
// ═══════════════════════════════════════════════

function _pce_writeTab_(res, stats, srcCount, notes) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PCE_TAB_NAME_);
  if (!tab) tab = ss.insertSheet(_PCE_TAB_NAME_);
  tab.clear();
  tab.getRange(1, 1, 1, _PCE_HEADERS_.length).setValues([_PCE_HEADERS_])
    .setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
  tab.setFrozenRows(1);

  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var out = [];
  for (var i = 0; i < res.detail.length; i++) {
    var d = res.detail[i];
    var pState = "-";
    if (d.phone !== "" && d.phone != null) {
      var dg = String(d.phone).replace(/[^0-9]/g, "");
      pState = !dg ? "없음"
        : (typeof _pep_isMaskedPhone_ === "function" && _pep_isMaskedPhone_(d.phone)) ? "마스킹"
        : "정상";
    }
    out.push([
      now, d.src, d.row, d.vendor, d.uid, d.date, d.name, pState,
      d.item, d.qty, d.inv, d.invCount, d.grade, d.via, d.itemLabel,
      d.owner, d.verdict, d.note,
    ]);
  }
  if (out.length) tab.getRange(2, 1, out.length, _PCE_HEADERS_.length).setValues(out);

  var row = out.length + 3;

  tab.getRange(row, 1).setValue("발주 행 출처").setFontWeight("bold");
  row++;
  var scRows = [];
  for (var sk in srcCount) {
    if (srcCount.hasOwnProperty(sk)) scRows.push([sk, srcCount[sk]]);
  }
  if (!scRows.length) scRows.push(["(없음)", 0]);
  tab.getRange(row, 1, scRows.length, 2).setValues(scRows);
  row += scRows.length + 2;

  tab.getRange(row, 1).setValue("송장 원천별 읽기 실적").setFontWeight("bold");
  row++;
  tab.getRange(row, 1, 1, 8).setValues([[
    "원천", "데이터행", "헤더행", "열 위치", "송장있음", "이름있음", "등록키", "비고",
  ]]).setFontWeight("bold").setBackground("#dbe5f1");
  row++;
  var srows = [];
  for (var s = 0; s < stats.length; s++) {
    var st = stats[s];
    var cmp = "";
    if (st.collectFixed && st.fixedInv >= 0 && st.inv >= 0) {
      if (st.fixedInv === 0 && st.inv > 0) {
        cmp = "⛔ 수집 가정(1행 헤더·고정열)으로는 0건 — 수집이 이 원천을 못 읽고 있다";
      } else if (st.fixedInv < st.inv) {
        cmp = "⚠ 수집 가정으로는 " + st.fixedInv + "건만 읽힘 (" + (st.inv - st.fixedInv) + "건 누락)";
      } else {
        cmp = "수집 가정으로도 " + st.fixedInv + "건 — 이상 없음";
      }
    } else if (!st.collectFixed) {
      cmp = "수집 가정 비교 대상 아님";
    }
    srows.push([
      st.label,
      st.rows < 0 ? "-" : st.rows,
      st.hdrRow,
      st.cols,
      st.inv < 0 ? "-" : st.inv,
      st.name < 0 ? "-" : st.name,
      st.keys,
      (st.note ? st.note + " / " : "") + cmp,
    ]);
  }
  if (srows.length) tab.getRange(row, 1, srows.length, 8).setValues(srows);
  row += srows.length + 2;

  tab.getRange(row, 1).setValue("판정 읽는 법").setFontWeight("bold");
  row++;
  tab.getRange(row, 1, 9, 2).setValues([
    ["오배정확정", "원천에서 이 송장의 주인 이름이 발주 수취인과 다르다. 추정이 아니라 확정이다."],
    ["출처불명", "어느 원천에서도 이 송장을 못 찾는다. 수동 입력이거나 원천이 이미 지워졌다."],
    ["수집원천밖", "1주출고·송장원장에만 있다. 수집 시점에 배정 근거가 없었다."],
    ["이름단독", "이름만으로 도달. 허브 2차 매칭은 이 키를 이미 폐기했다."],
    ["전화단독", "전화만 맞고 이름은 안 맞았다."],
    ["품목모순", "소스 품목 규격이 주문과 어긋난다(음수 점수). 후보가 부족하면 배정기가 이것도 넣는다."],
    ["품목무근거", "소스 품목과 겹치는 토큰이 없다(점수 0)."],
    ["수량불일치", "수량으로 계산한 필요 송장 수와 실제 송장 수가 다르다."],
    ["표기차이중복", "같은 송장이 표기만 달라 소비대장을 우회할 수 있다."],
  ]);
  row += 11;

  tab.getRange(row, 1).setValue("주의").setFontWeight("bold");
  row++;
  tab.getRange(row, 1, 3, 2).setValues([
    ["원천이 비면", "위 '송장있음'이 0인 원천이 있으면 그만큼 출처불명이 부풀려진다. 원천을 먼저 고쳐야 한다."],
    ["리포트 기준", "등급 A·B + 품목 일치 + 수량 정상 + 주인 일치는 카운트만 하고 상세에서 뺀다."],
    ["안전", "이 도구는 아무것도 고치지 않는다. 읽기만 한다."],
  ]);
  row += 5;

  if (notes && notes.length) {
    tab.getRange(row, 1).setValue("스캔 로그").setFontWeight("bold");
    row++;
    var lg = [];
    for (var n = 0; n < Math.min(notes.length, 80); n++) lg.push([String(notes[n])]);
    if (lg.length) tab.getRange(row, 1, lg.length, 1).setValues(lg);
  }

  tab.setColumnWidth(2, 170);
  tab.setColumnWidth(9, 200);
  tab.setColumnWidth(11, 150);
  tab.setColumnWidth(14, 170);
  tab.setColumnWidth(16, 280);
  tab.setColumnWidth(18, 560);
  return out.length;
}

/**
 * 메뉴: 허브·아카이브·업체 월 마감탭에 적힌 송장의 배정 근거를 등급으로 뽑고,
 * 원천에서 그 송장의 주인이 누구인지 대조한다. 데이터는 바꾸지 않는다.
 */
function partnerDiagnoseCollectEvidence() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var t0 = new Date().getTime();
  var notes = [], stats = [];

  var col = _pce_collect_(notes, stats, t0);
  if (!col.rows.length) {
    var m0 = "허브·아카이브·업체 마감탭에서 발주 행을 찾지 못했습니다.\n\n" +
      "스캔 로그는 '" + _PCE_TAB_NAME_ + "' 탭을 확인하세요.";
    _pce_writeTab_({ detail: [] }, stats, col.srcCount, notes);
    if (ui) ui.alert(m0);
    return m0;
  }

  var keysC = Object.keys(col.mapC).length;
  var keysR = Object.keys(col.mapR).length;

  var detailIdx = _pce_buildDetailIndex_(col.mapC);
  _pce_buildDetailIndex_(col.mapR, detailIdx);
  var ownerIdx = _pce_buildOwnerIndex_(col.mapC, "수집원천");
  _pce_buildOwnerIndex_(col.mapR, "참고원천", ownerIdx);

  var res = _pce_analyze_(col.rows, col.mapC, col.mapR, detailIdx, ownerIdx);
  var written = _pce_writeTab_(res, stats, col.srcCount, notes);

  var brokenAssumption = [], deadPrimary = [], totalInv = 0;
  for (var s = 0; s < stats.length; s++) {
    var st = stats[s];
    if (st.inv > 0) totalInv += st.inv;
    if (!st.collectFixed) continue;
    if (st.fixedInv === 0 && st.inv > 0) brokenAssumption.push(st.label);
    if (st.inv === 0 && st.rows > 0) deadPrimary.push(st.label);
  }

  res.viaList.sort(function (a, b) { return res.viaCount[b] - res.viaCount[a]; });
  var viaLines = [];
  for (var v = 0; v < res.viaList.length; v++) {
    viaLines.push("  · " + res.viaList[v] + ": " + res.viaCount[res.viaList[v]] + "건");
  }

  var srcLines = [];
  for (var sk in col.srcCount) {
    if (col.srcCount.hasOwnProperty(sk)) srcLines.push("  · " + sk + ": " + col.srcCount[sk] + "행");
  }

  var weak = res.gradeC + res.gradeD + res.gradeX + res.gradeF;
  var elapsed = Math.round((new Date().getTime() - t0) / 1000);
  var pct = res.withInv ? " (" + Math.round((weak / res.withInv) * 100) + "%)" : "";
  var mmPct = res.withInv ? " (" + Math.round((res.ownerMismatch / res.withInv) * 100) + "%)" : "";
  var unreliable = totalInv === 0 || brokenAssumption.length > 0;

  var msg =
    "🔍 협력업체 송장 배정 근거 점검 (읽기 전용)\n\n" +
    "발주 행: " + res.total + "건 / 송장 있음: " + res.withInv + "건\n" +
    "송장 없음: " + res.noInv + "건 / placeholder: " + res.placeholder + "건\n" +
    (srcLines.length ? srcLines.join("\n") + "\n" : "") +
    "\n수집원천 키: " + keysC + "개 / 참고원천 키: " + keysR + "개\n" +
    "원천에서 읽은 송장: " + totalInv + "건 / 소요 " + elapsed + "초\n" +
    (unreliable
      ? "\n⛔ 판정 신뢰 불가\n" +
        (brokenAssumption.length
          ? "  · 수집이 못 읽는 원천: " + brokenAssumption.join(", ") + "\n" +
            "    헤더 탐지로는 읽히는데 수집의 1행·고정열 가정으로는 0건입니다.\n"
          : "") +
        (totalInv === 0 ? "  · 원천에서 송장을 하나도 읽지 못했습니다.\n" : "")
      : "") +
    (deadPrimary.length ? "\n⚠ 송장 0건인 원천: " + deadPrimary.join(", ") + "\n" : "") +
    "\n── 원천 주인 대조 (가장 확실한 신호) ──\n" +
    "  ⛔ 오배정 확정 (원천 주인 ≠ 수취인): " + res.ownerMismatch + "건" + mmPct + "\n" +
    "  · 원천에서 송장을 못 찾음: " + res.ownerUnknown + "건\n\n" +
    "── 근거 등급 (송장 있는 " + res.withInv + "건) ──\n" +
    "  A 고유ID: " + res.gradeA + "건 / B 이름+전화: " + res.gradeB + "건\n" +
    "  C 전화단독: " + res.gradeC + "건 / D 이름단독: " + res.gradeD + "건\n" +
    "  X 수집원천밖: " + res.gradeX + "건 / F 근거없음: " + res.gradeF + "건\n" +
    "  ⛔ 약한 근거(C+D+X+F): " + weak + "건" + pct + "\n\n" +
    "── 품목 축 ──\n" +
    "  일치: " + res.itemMatch + "건 / 근거없음(점수 0): " + res.itemNone + "건\n" +
    "  ⛔ 규격모순(음수): " + res.itemConflict + "건 / 소스품목없음: " + res.itemNoSrc + "건\n\n" +
    "── 수량 대비 송장 개수 ──\n" +
    "  초과: " + res.qtyOver + "건 / 부족: " + res.qtyUnder + "건\n\n" +
    "── 교차 점검 ──\n" +
    "  ✅ 같은 주문 다품목 공유(정상): " + res.dupSameOrder + "종\n" +
    "  ⛔ 서로 다른 주문에 같은 송장: " + res.dupCrossOrder + "종\n" +
    "  ⛔ 표기차이 중복(소비대장 우회): " + res.normCollision + "종\n" +
    (viaLines.length ? "\n── 도달 키 분포 ──\n" + viaLines.join("\n") + "\n" : "") +
    "\n상세 " + written + "행 · 원천별 읽기 실적 · 스캔 로그는 '" + _PCE_TAB_NAME_ + "' 탭에 있습니다.\n" +
    "이 도구는 데이터를 바꾸지 않습니다.";

  if (ui) ui.alert(msg);
  Logger.log(msg);
  return msg;
}
