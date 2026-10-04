/**
 * ══════════════════════════════════════════════════════════════
 *  [협력업체] 오전/오후 판매현황 중복 의심 점검
 *  파일: _partnerDupWatch.gs
 *
 *  왜 필요한가
 *    판매현황을 하루에 두 번 이상 이카운트에 올린다. 오전에 올린 건과
 *    오후에 올린 건에 같은 사람·같은 품목이 섞이면 이중 출고가 된다.
 *    그런데 '이카운트-판매현황업로드용(협력업체)' 탭은 갱신할 때마다
 *    전량 재작성되고, 올라간 허브 행은 P열로 잠긴다. 즉 오후 갱신 뒤에는
 *    오전에 무엇을 올렸는지 탭에 남지 않는다.
 *
 *  그래서 두 가지를 둔다
 *    1. 판매현황_갱신이력 — 갱신할 때마다 그 회차에 올라간 건을 적재한다.
 *       (partnerRebuildSalesUploadSheetCore_ 에서 호출)
 *    2. 중복의심_점검 — 회차끼리 비교해 의심 건을 등급별로 뽑아 놓는다.
 *       운영자가 A열 체크박스로 확인 여부를 관리한다.
 *
 *  이력이 아직 없는 날은 허브 A열 수집일시를 12시 기준으로 갈라
 *  오전/오후로 비교한다. 도입 첫날부터 바로 쓸 수 있게 하려는 폴백이다.
 *
 *  기존 '🔍 중복 발주 감지'(_partnerOrderAudit.gs)와 역할이 다르다.
 *  그쪽은 업체 파일의 발주탭·전용양식 안에서 수취인+품목만 본다.
 *  이쪽은 허브/판매현황 기준으로 전화·주소·판매처까지 보고 회차를 가른다.
 * ══════════════════════════════════════════════════════════════
 */

var _DW_HISTORY_TAB = "판매현황_갱신이력";
var _DW_HISTORY_HEADERS = [
  "갱신시각", "회차", "구분", "허브행", "판매처(발주업체)", "고유ID",
  "주문일자", "품목코드", "품목명", "수량", "수취인", "전화번호", "주소",
];

var _DW_REPORT_TAB = "중복의심_점검";
var _DW_REPORT_HEADERS = [
  "확인", "그룹", "등급", "사유", "회차", "구분", "갱신시각",
  "판매처", "수취인", "전화번호", "품목코드", "품목명", "수량",
  "주소", "주문일자", "고유ID", "허브행", "송장번호", "상태",
];

/** 오전/오후 경계 시각. 스크립트 속성 DUP_WATCH_NOON_HOUR 로 바꿀 수 있다 */
var _DW_NOON_HOUR_DEFAULT = 12;

/** 이력을 며칠까지 보관할지 (그보다 오래된 행은 점검 실행 때 정리) */
var _DW_HISTORY_KEEP_DAYS = 45;

var _DW_TZ = "Asia/Seoul";

// ─────────────────────────────────────────────────────
//  설정 · 공용 유틸
// ─────────────────────────────────────────────────────

function _dw_noonHour_() {
  try {
    var raw = String(PropertiesService.getScriptProperties()
      .getProperty("DUP_WATCH_NOON_HOUR") || "").trim();
    var n = parseInt(raw, 10);
    if (n >= 1 && n <= 23) return n;
  } catch (e) {}
  return _DW_NOON_HOUR_DEFAULT;
}

function _dw_dateKey_(d) {
  return Utilities.formatDate(d, _DW_TZ, "yyyy-MM-dd");
}

/** 셀 값 → Date. 문자열/Date 둘 다 받는다 */
function _dw_toDate_(v) {
  if (v instanceof Date) return v;
  var s = String(v == null ? "" : v).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(
      parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
      parseInt(m[4] || "0", 10), parseInt(m[5] || "0", 10), parseInt(m[6] || "0", 10)
    );
  }
  var m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) {
    return new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10));
  }
  var t = new Date(s);
  return isNaN(t.getTime()) ? null : t;
}

/** 주문일자 셀 → 표시용 문자열 (yyyyMMdd 우선) */
function _dw_orderDateText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, _DW_TZ, "yyyyMMdd");
  return String(v == null ? "" : v).trim();
}

function _dw_batchLabel_(date) {
  if (!date) return "";
  return date.getHours() < _dw_noonHour_() ? "오전" : "오후";
}

function _dw_nameKey_(name) {
  return _pep_normRecipName_(name);
}

/** 취소·반품·불용 건은 중복 대상이 아니다 */
function _dw_isDeadStatus_(status) {
  var s = String(status == null ? "" : status).replace(/\s/g, "");
  if (!s) return false;
  return s.indexOf("취소") !== -1 || s.indexOf("반품") !== -1 || s.indexOf("불용") !== -1;
}

// ─────────────────────────────────────────────────────
//  탭 확보
// ─────────────────────────────────────────────────────

function _dw_historyTab_(ss) {
  var tab = ss.getSheetByName(_DW_HISTORY_TAB);
  if (tab) return tab;
  tab = ss.insertSheet(_DW_HISTORY_TAB);
  tab.getRange(1, 1, 1, _DW_HISTORY_HEADERS.length).setValues([_DW_HISTORY_HEADERS]);
  tab.getRange("1:1")
    .setBackground("#1f4e78").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 140);
  tab.setColumnWidth(13, 260);
  try { tab.setTabColor("#8e8e8e"); } catch (e) {}

  // 갱신시각을 시트가 날짜로 파싱하면 로케일 표기로 바뀌어 날짜 비교가 깨진다.
  // 품목코드·전화번호는 선행 0 이 날아간다. 네 열은 텍스트로 고정한다.
  try {
    tab.getRange("A2:A").setNumberFormat("@");    // 갱신시각
    tab.getRange("G2:G").setNumberFormat("@");    // 주문일자
    tab.getRange("H2:H").setNumberFormat("@");    // 품목코드
    tab.getRange("L2:L").setNumberFormat("@");    // 전화번호
  } catch (eFmt) {}
  return tab;
}

function _dw_reportTab_(ss) {
  var tab = ss.getSheetByName(_DW_REPORT_TAB);
  if (tab) return tab;
  tab = ss.insertSheet(_DW_REPORT_TAB);
  tab.getRange(1, 1, 1, _DW_REPORT_HEADERS.length).setValues([_DW_REPORT_HEADERS]);
  tab.getRange("1:1")
    .setBackground("#7f1d1d").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  try { tab.setTabColor("#e06c75"); } catch (e) {}
  return tab;
}

// ─────────────────────────────────────────────────────
//  1) 판매현황 갱신 이력 적재
//     partnerRebuildSalesUploadSheetCore_ 가 호출한다.
// ─────────────────────────────────────────────────────

/**
 * 이번 갱신에 올라간 허브 행을 이력에 적재한다.
 * @param {Sheet} ss 허브 스프레드시트
 * @param {Array[]} hubData 허브 2행부터의 값 (16열)
 * @param {number[]} hubRowNumbers 업로드에 포함된 실제 시트 행번호 (2-base)
 */
function _dw_appendSalesHistory_(ss, hubData, hubRowNumbers) {
  if (!hubRowNumbers || !hubRowNumbers.length) return 0;

  var now = new Date();
  var atText = Utilities.formatDate(now, _DW_TZ, "yyyy-MM-dd HH:mm:ss");
  var todayKey = _dw_dateKey_(now);
  var tab = _dw_historyTab_(ss);

  // 오늘 몇 번째 갱신인지 — 이미 적재된 갱신시각의 종류 수 + 1
  var seq = 1;
  var lastRow = tab.getLastRow();
  if (lastRow >= 2) {
    var seen = {};
    var prev = tab.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var i = 0; i < prev.length; i++) {
      var s = String(prev[i][0] || "").trim();
      if (s && s.indexOf(todayKey) === 0) seen[s] = true;
    }
    seq = Object.keys(seen).length + 1;
  }

  var label = _dw_batchLabel_(now);
  var rows = [];
  for (var r = 0; r < hubRowNumbers.length; r++) {
    var idx = hubRowNumbers[r] - 2;
    if (idx < 0 || idx >= hubData.length) continue;
    var row = hubData[idx];
    rows.push([
      atText, seq, label, hubRowNumbers[r],
      String(row[1] || "").trim(),                 // 발주업체 = 판매처
      String(row[2] || "").trim(),                 // 고유ID
      _dw_orderDateText_(row[3]),
      _po_normalizeCode(row[4]),
      String(row[5] || "").trim(),
      row[6],
      String(row[7] || "").trim(),
      String(row[8] || "").trim(),
      String(row[9] || "").trim(),
    ]);
  }
  if (!rows.length) return 0;

  // 값을 쓰기 전에 서식이 잡혀 있어야 갱신시각·코드·전화가 원문 그대로 남는다.
  // 탭 생성 시 열 전체를 텍스트로 잡아두지만, 기존 탭에도 확실히 적용한다.
  var startRow = tab.getLastRow() + 1;
  var textCols = [1, 7, 8, 12];
  for (var tc = 0; tc < textCols.length; tc++) {
    tab.getRange(startRow, textCols[tc], rows.length, 1).setNumberFormat("@");
  }
  tab.getRange(startRow, 1, rows.length, _DW_HISTORY_HEADERS.length).setValues(rows);
  return rows.length;
}

/** 오래된 이력 정리 */
function _dw_trimHistory_(ss) {
  var tab = ss.getSheetByName(_DW_HISTORY_TAB);
  if (!tab || tab.getLastRow() < 2) return 0;
  var vals = tab.getRange(2, 1, tab.getLastRow() - 1, 1).getDisplayValues();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - _DW_HISTORY_KEEP_DAYS);
  var cutoffKey = _dw_dateKey_(cutoff);

  var drop = 0;
  for (var i = 0; i < vals.length; i++) {
    var s = String(vals[i][0] || "").trim();
    if (!s) break;
    if (s.substring(0, 10) >= cutoffKey) break;   // 적재 순서 = 시간 순
    drop++;
  }
  if (drop > 0) tab.deleteRows(2, drop);
  return drop;
}

// ─────────────────────────────────────────────────────
//  2) 비교 대상 수집
// ─────────────────────────────────────────────────────

/** 이력 탭에서 해당 날짜 건 읽기 */
function _dw_readHistoryForDate_(ss, dateKey) {
  var tab = ss.getSheetByName(_DW_HISTORY_TAB);
  if (!tab || tab.getLastRow() < 2) return [];
  var vals = tab.getRange(2, 1, tab.getLastRow() - 1, _DW_HISTORY_HEADERS.length)
    .getDisplayValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    var at = String(v[0] || "").trim();
    if (at.substring(0, 10) !== dateKey) continue;
    out.push({
      at: at,
      batch: parseInt(v[1], 10) || 1,
      batchLabel: String(v[2] || "").trim(),
      hubRow: parseInt(v[3], 10) || 0,
      vendor: String(v[4] || "").trim(),
      uid: String(v[5] || "").trim(),
      orderDate: String(v[6] || "").trim(),
      code: _po_normalizeCode(v[7]),
      item: String(v[8] || "").trim(),
      qty: String(v[9] || "").trim(),
      name: String(v[10] || "").trim(),
      phone: String(v[11] || "").trim(),
      addr: String(v[12] || "").trim(),
      inv: "",
      status: "",
    });
  }
  return out;
}

/**
 * 허브에서 해당 날짜에 수집된 건 읽기.
 * 수집일시를 경계 시각으로 갈라 오전/오후를 매기고,
 * P열로 이미 판매현황에 올라간 건인지 표시한다.
 */
function _dw_readHubForDate_(ss, dateKey) {
  var tab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!tab || tab.getLastRow() < 2) return [];
  var lastCol = Math.max(tab.getLastColumn(), 15);
  var vals = tab.getRange(2, 1, tab.getLastRow() - 1, Math.min(lastCol, 16)).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var when = _dw_toDate_(row[0]);
    if (!when || _dw_dateKey_(when) !== dateKey) continue;
    if (_dw_isDeadStatus_(row[14])) continue;

    var label = _dw_batchLabel_(when);
    out.push({
      at: Utilities.formatDate(when, _DW_TZ, "yyyy-MM-dd HH:mm:ss"),
      batch: label === "오전" ? 1 : 2,
      batchLabel: label,
      hubRow: i + 2,
      vendor: String(row[1] || "").trim(),
      uid: String(row[2] || "").trim(),
      orderDate: _dw_orderDateText_(row[3]),
      code: _po_normalizeCode(row[4]),
      item: String(row[5] || "").trim(),
      qty: String(row[6] == null ? "" : row[6]).trim(),
      name: String(row[7] || "").trim(),
      phone: String(row[8] || "").trim(),
      addr: String(row[9] || "").trim(),
      inv: String(row[13] || "").trim(),
      status: String(row[14] || "").trim(),
      uploaded: String(row[15] == null ? "" : row[15]).trim() !== "",
    });
  }
  return out;
}

/** 고유ID → 현재 허브 송장·상태 (이력 건에 현재 진행 상태를 붙이려고) */
function _dw_hubStatusIndex_(ss) {
  var idx = {};
  var tab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!tab || tab.getLastRow() < 2) return idx;
  var vals = tab.getRange(2, 1, tab.getLastRow() - 1, 15).getValues();
  for (var i = 0; i < vals.length; i++) {
    var uid = String(vals[i][2] || "").trim();
    if (!uid) continue;
    idx[uid] = {
      inv: String(vals[i][13] || "").trim(),
      status: String(vals[i][14] || "").trim(),
      row: i + 2,
    };
  }
  return idx;
}

// ─────────────────────────────────────────────────────
//  3) 중복 의심 판정
// ─────────────────────────────────────────────────────

/**
 * ★ 두 건이 «같은 사람»일 수 있는가 ★  (2026-09-18)
 *
 *   > "중복의심이 너무 많은데 허브의 중복의심은 좀더 디테일하게
 *   >  확실하게 잡아내게 수정해줘"
 *
 * 여태 이름과 품목코드만 같으면 묶었다. 그래서 «동명이인»이 매번 걸렸다.
 * 전화가 둘 다 있는데 다르면 다른 사람이다. 주소도 마찬가지다.
 * 한쪽이 «비어 있는» 것은 어긋난 것이 아니다 — 모르는 것뿐이다.
 *
 * @return {string} 어긋난 까닭. 어긋난 데가 없으면 빈 문자열
 */
function _dw_conflict_(a, b) {
  var pa = _pep_phoneDigits_(a.phone), pb = _pep_phoneDigits_(b.phone);
  if (pa.length >= 10 && pb.length >= 10 && pa !== pb) return "전화가 다름";
  var aa = _pep_addrKey_(a.addr), ab = _pep_addrKey_(b.addr);
  if (aa && ab && aa !== ab) return "주소가 다름";
  return "";
}

/**
 * 한 버킷을 «서로 어긋나지 않는» 덩어리로 가른다.
 * 동명이인 셋이 한 버킷에 있으면 셋을 한 그룹으로 내지 않고 갈라 낸다.
 */
function _dw_splitByConflict_(records, members) {
  var out = [], used = {};
  for (var i = 0; i < members.length; i++) {
    if (used[members[i]]) continue;
    var cl = [members[i]];
    used[members[i]] = true;
    for (var j = i + 1; j < members.length; j++) {
      if (used[members[j]]) continue;
      var ok = true;
      for (var k = 0; k < cl.length; k++) {
        if (_dw_conflict_(records[cl[k]], records[members[j]])) { ok = false; break; }
      }
      if (ok) { cl.push(members[j]); used[members[j]] = true; }
    }
    if (cl.length >= 2) out.push(cl);
  }
  return out;
}

/**
 * 송장으로 «지금 어떤 상태인가»를 가른다.
 * 상담도 조치도 여기서 갈린다 —
 *   · 송장이 둘         → 이미 두 번 나갔다. 회수·환불 이야기다
 *   · 한쪽만 송장       → 나머지는 아직 막을 수 있다
 *   · 둘 다 송장 없음   → 지금 막으면 끝난다
 */
function _dw_invoiceNote_(records, members) {
  var seen = {}, list = [], 없음 = 0;
  for (var i = 0; i < members.length; i++) {
    var v = String(records[members[i]].inv || "");
    v = v.replace(/[^0-9A-Za-z]/g, "");
    if (!v) { 없음++; continue; }
    if (!seen[v]) { seen[v] = true; list.push(v); }
  }
  if (list.length >= 2) {
    return { note: "★ 이미 두 번 나갔습니다 (송장 " + list.length + "개)", shipped: list.length };
  }
  if (list.length === 1 && 없음 > 0) {
    return { note: "한 건만 송장 나감 — 나머지는 아직 막을 수 있음", shipped: 1 };
  }
  if (list.length === 1) return { note: "같은 송장 하나 (한 박스로 나감)", shipped: 1 };
  return { note: "아직 둘 다 안 나감 — 지금 막으면 됩니다", shipped: 0 };
}

/**
 * 등급 정의. 위에서부터 강한 일치다.
 * key 가 빈 문자열이면 그 레코드는 그 등급 판정에서 제외된다.
 *
 * ★ 2026-09-18 ★ 헛것이 나오던 자리를 셋 막았다.
 *   ① 고유ID만 보고 묶었다   → 한 주문에 품목이 여럿이면 «무조건» 걸렸다.
 *                              품목코드까지 같아야 같은 줄이다.
 *   ② 「전화 다름」을 대놓고 허용했다 → 동명이인이 매번 걸렸다.
 *                              이제 _dw_splitByConflict_ 가 갈라 낸다.
 *   ③ 주소+품목만 같으면 수취인이 달라도 냈다 → 같은 아파트·같은 회사가 다 걸렸다.
 *                              이제 «전화와 주소가 같은데 이름만 다른» 건만 낸다.
 */
function _dw_levels_() {
  return [
    {
      grade: "🔴 확실",
      reason: "같은 고유ID·같은 품목이 두 번",
      keyFn: function (r) {
        if (!r.uid || !r.code) return "";
        return "U|" + r.uid + "|" + r.code;
      },
      //  고유ID가 같으면 애초에 같은 주문이다. 전화·주소를 또 따질 일이 아니다.
      skipConflictSplit: true,
    },
    {
      grade: "🔴 확실",
      reason: "수취인+전화+품목코드 일치",
      keyFn: function (r) {
        var n = _dw_nameKey_(r.name);
        var p = _pep_phoneDigits_(r.phone);
        if (!n || !r.code || p.length < 10) return "";
        return "NP|" + n + "|" + p + "|" + r.code;
      },
      skipConflictSplit: true,   // 전화가 이미 키에 들어 있다
    },
    {
      grade: "🟡 의심",
      reason: "수취인+품목코드 일치 (한쪽 전화 없음)",
      keyFn: function (r) {
        var n = _dw_nameKey_(r.name);
        if (!n || !r.code) return "";
        return "N|" + n + "|" + r.code;
      },
    },
    {
      grade: "🟡 의심",
      reason: "전화+주소+품목 같고 수취인 이름만 다름",
      keyFn: function (r) {
        var p = _pep_phoneDigits_(r.phone);
        var a = _pep_addrKey_(r.addr);
        if (p.length < 10 || !a || !r.code) return "";
        return "PA|" + p + "|" + a + "|" + r.code;
      },
      skipConflictSplit: true,
      // 창고 한 곳으로 같은 품목을 여러 건 보내는 업체가 있다.
      // 그런 건은 중복이 아니라 정상 패턴이므로 덩어리가 크면 버린다.
      maxMembers: 5,
    },
  ];
}

/**
 * 중복 의심 그룹 찾기.
 * 상위 등급에서 이미 잡힌 조합을 하위 등급이 그대로 반복하지 않도록,
 * 구성원이 기존 그룹의 부분집합이면 버린다. 구성원이 더 늘어난 경우는
 * 새로운 정보이므로 남긴다.
 *
 * @param {Array} records
 * @return {Array} [{grade, reason, invNote, shipped, spansBatch, members}]
 */
function _dw_findSuspects_(records) {
  var levels = _dw_levels_();
  var groups = [];
  var emitted = [];   // 이미 낸 그룹의 구성원 집합
  var skippedBulk = 0;
  var splitApart = 0; // 동명이인 등으로 갈라 낸 버킷 수

  for (var li = 0; li < levels.length; li++) {
    var lv = levels[li];
    var buckets = {};
    for (var ri = 0; ri < records.length; ri++) {
      var k = lv.keyFn(records[ri]);
      if (!k) continue;
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(ri);
    }

    for (var bk in buckets) {
      var raw = buckets[bk];
      if (raw.length < 2) continue;

      /* ★ 같은 사람일 수 있는 것끼리만 묶는다 ★
         여기서 갈라 내지 않으면 동명이인이 한 그룹으로 나온다. */
      var clusters;
      if (lv.skipConflictSplit) {
        clusters = [raw];
      } else {
        clusters = _dw_splitByConflict_(records, raw);
        var 남은수 = 0;
        for (var cc = 0; cc < clusters.length; cc++) 남은수 += clusters[cc].length;
        if (남은수 !== raw.length || clusters.length > 1) splitApart++;
      }

      for (var ci = 0; ci < clusters.length; ci++) {
        var members = clusters[ci];
        if (members.length < 2) continue;
        if (lv.maxMembers && members.length > lv.maxMembers) {
          skippedBulk++;
          continue;
        }

        var isSubset = false;
        for (var ei = 0; ei < emitted.length; ei++) {
          var covered = true;
          for (var mi = 0; mi < members.length; mi++) {
            if (!emitted[ei][members[mi]]) { covered = false; break; }
          }
          if (covered) { isSubset = true; break; }
        }
        if (isSubset) continue;

        var batches = {};
        for (var mj = 0; mj < members.length; mj++) {
          batches[records[members[mj]].batch] = true;
        }
        var spans = Object.keys(batches).length > 1;
        var inv = _dw_invoiceNote_(records, members);

        /* ★ 같은 회차 안의 것은 «참고»로 내린다 ★  (2026-09-18 사장님 지시)
           이 도구는 오전↔오후 이중출고를 잡으려고 있다. 같은 회차 안의 겹침은
           업체가 같은 줄을 두 번 넣었을 수 있다는 뜻이라 보이긴 해야 하지만,
           🔴 목록을 어지럽히면 정작 볼 것을 못 본다.
           ★ 다만 송장이 둘이면 이미 두 번 나간 것이다 — 그것은 안 내린다. */
        var grade = lv.grade;
        if (!spans && inv.shipped < 2) grade = "⚪ 참고";
        if (inv.shipped >= 2) grade = "🔴 확실";

        groups.push({
          grade: grade,
          reason: lv.reason,
          invNote: inv.note,
          shipped: inv.shipped,
          spansBatch: spans,
          members: members,
        });

        var set = {};
        for (var mk = 0; mk < members.length; mk++) set[members[mk]] = true;
        emitted.push(set);
      }
    }
  }

  // 이미 나간 것 → 회차 간 → 등급 → 수취인 순. 놓치면 안 되는 것이 위로 온다.
  var order = { "🔴 확실": 0, "🟡 의심": 1, "⚪ 참고": 2 };
  groups.sort(function (a, b) {
    var sa = a.shipped >= 2 ? 0 : 1, sb = b.shipped >= 2 ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (a.spansBatch !== b.spansBatch) return a.spansBatch ? -1 : 1;
    var ga = order[a.grade] == null ? 9 : order[a.grade];
    var gb = order[b.grade] == null ? 9 : order[b.grade];
    if (ga !== gb) return ga - gb;
    var na = records[a.members[0]].name || "";
    var nb = records[b.members[0]].name || "";
    return na.localeCompare(nb);
  });
  groups.skippedBulk = skippedBulk;
  groups.splitApart = splitApart;
  return groups;
}

// ─────────────────────────────────────────────────────
//  4) 점검 시트 작성
// ─────────────────────────────────────────────────────

/** 확인 체크 상태를 다시 그려도 유지하기 위한 행 식별키 */
function _dw_recKey_(r) {
  return [r.uid, r.code, r.hubRow, _dw_nameKey_(r.name), _pep_phoneDigits_(r.phone)]
    .join("|");
}

/** 이전 실행에서 체크된 항목 기억 */
function _dw_readCheckedKeys_(ss) {
  var tab = ss.getSheetByName(_DW_REPORT_TAB);
  var checked = {};
  if (!tab || tab.getLastRow() < 2) return checked;

  var lastCol = _DW_REPORT_HEADERS.length;
  var vals = tab.getRange(2, 1, tab.getLastRow() - 1, lastCol).getValues();
  var cUid = 15, cCode = 10, cHubRow = 16, cName = 8, cPhone = 9;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] !== true) continue;
    var key = [
      String(vals[i][cUid] || "").trim(),
      _po_normalizeCode(vals[i][cCode]),
      String(vals[i][cHubRow] || "").trim(),
      _dw_nameKey_(vals[i][cName]),
      _pep_phoneDigits_(vals[i][cPhone]),
    ].join("|");
    checked[key] = true;
  }
  return checked;
}

function _dw_writeReport_(ss, records, groups, meta) {
  var tab = _dw_reportTab_(ss);
  var checked = _dw_readCheckedKeys_(ss);
  var colCount = _DW_REPORT_HEADERS.length;
  var prevLastRow = tab.getLastRow();

  tab.clearContents();
  try {
    var oldRange = tab.getRange(2, 1, Math.max(prevLastRow - 1, 1), colCount);
    oldRange.clearDataValidations();
    oldRange.setBackground(null);   // 지난 실행의 그룹 배경색 제거
  } catch (e) {}
  tab.getRange(1, 1, 1, colCount).setValues([_DW_REPORT_HEADERS]);
  tab.getRange("1:1")
    .setBackground("#7f1d1d").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.setFrozenRows(1);

  /* ★ 이미 확인한 그룹은 맨 아래로 ★  (2026-09-18 사장님 지시)
       > "중복의심이 너무 많은데"
     지운 게 아니라 «내린» 것이다. 지난 것을 늘 눈으로 다시 볼 수 있어야 한다.
     그룹의 줄이 «전부» 체크돼 있어야 확인한 것으로 본다 — 한 줄만 찍힌
     그룹은 아직 보고 있는 중이다. */
  var 남은것 = [], 확인한것 = [];
  for (var ci2 = 0; ci2 < groups.length; ci2++) {
    var gg = groups[ci2], 다찍힘 = gg.members.length > 0;
    for (var cm = 0; cm < gg.members.length; cm++) {
      if (checked[_dw_recKey_(records[gg.members[cm]])] !== true) { 다찍힘 = false; break; }
    }
    gg.confirmed = 다찍힘;
    (다찍힘 ? 확인한것 : 남은것).push(gg);
  }
  groups = 남은것.concat(확인한것);
  var 확인수 = 확인한것.length;

  var rows = [];
  var groupStarts = [];   // 그룹 경계 (배경 교대용)
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    groupStarts.push({
      start: rows.length, count: g.members.length,
      grade: g.grade, confirmed: g.confirmed === true,
    });

    // 어느 회차끼리 겹쳤는지 실제 이름으로 적는다 (오전 ↔ 오후 / 오전 ↔ 미업로드 …)
    var labelSeen = {};
    var labelList = [];
    for (var lb = 0; lb < g.members.length; lb++) {
      var lbl = records[g.members[lb]].batchLabel || "?";
      if (!labelSeen[lbl]) { labelSeen[lbl] = true; labelList.push(lbl); }
    }
    /* 사유는 «무엇이 같고 · 어디끼리 겹쳤고 · 지금 어떤 상태인가» 셋을 다 적는다.
       상태(송장)가 빠지면 어느 것을 먼저 손대야 하는지 사람이 또 뒤져야 한다. */
    var reason = g.reason + " · " +
      (g.spansBatch ? labelList.join(" ↔ ") : "같은 회차 내(" + labelList[0] + ")") +
      (g.invNote ? " · " + g.invNote : "") +
      (g.confirmed ? " · [확인함]" : "");
    for (var mi = 0; mi < g.members.length; mi++) {
      var r = records[g.members[mi]];
      rows.push([
        checked[_dw_recKey_(r)] === true,
        gi + 1,
        g.grade,
        reason,
        r.batch,
        r.batchLabel,
        r.at,
        r.vendor,
        r.name,
        r.phone,
        r.code,
        r.item,
        r.qty,
        r.addr,
        r.orderDate,
        r.uid,
        r.hubRow,
        r.inv,
        r.status,
      ]);
    }
  }

  if (rows.length) {
    // 서식을 먼저 — 갱신시각이 날짜로 파싱되거나 코드·전화·송장의 선행 0 이
    // 날아가면 다음 실행에서 체크 상태를 못 찾는다.
    var textCols = [7, 10, 11, 15, 18];   // 갱신시각·전화·품목코드·주문일자·송장
    for (var tc = 0; tc < textCols.length; tc++) {
      tab.getRange(2, textCols[tc], rows.length, 1).setNumberFormat("@");
    }
    tab.getRange(2, 1, rows.length, colCount).setValues(rows);
    tab.getRange(2, 1, rows.length, 1).insertCheckboxes();

    // 그룹마다 배경을 번갈아 칠해 짝이 눈에 들어오게 한다
    for (var si = 0; si < groupStarts.length; si++) {
      var gs = groupStarts[si];
      var bg = si % 2 === 0 ? "#fdecea" : "#ffffff";
      if (gs.grade.indexOf("의심") !== -1) bg = si % 2 === 0 ? "#fff8e1" : "#ffffff";
      if (gs.grade.indexOf("참고") !== -1) bg = si % 2 === 0 ? "#f1f3f4" : "#ffffff";
      //  확인 끝난 그룹은 한 눈에 «지나간 것»으로 보이게 회색으로 눕힌다
      var rng = tab.getRange(2 + gs.start, 2, gs.count, colCount - 1);
      if (gs.confirmed) {
        rng.setBackground("#f8f9fa").setFontColor("#9aa0a6");
      } else {
        rng.setBackground(bg).setFontColor(null);
      }
    }
  }

  var tailEnd = Math.max(tab.getLastRow(), prevLastRow);
  var newLastRow = rows.length > 0 ? rows.length + 1 : 1;
  if (tailEnd > newLastRow) {
    tab.getRange(newLastRow + 1, 1, tailEnd - newLastRow, colCount).clearContent();
  }

  // 실행 정보를 헤더 오른쪽에 남긴다 (헤더 배경이 칠해지므로 서식을 되돌린다)
  try {
    tab.getRange(1, colCount + 2)
      .setValue(
        "점검 " + meta.at + " · 대상 " + meta.dateKey +
        " · 출처 " + meta.source + " · 회차 " + meta.batchCount +
        " · 건수 " + records.length +
        (meta.skippedBulk ? " · 대량발송 패턴 제외 " + meta.skippedBulk + "건" : "")
      )
      .setBackground(null)
      .setFontColor("#666666")
      .setFontWeight("normal")
      .setHorizontalAlignment("left");
  } catch (eNote) {}

  try { tab.autoResizeColumns(2, colCount - 1); } catch (eR) {}
  tab.setColumnWidth(1, 44);
  tab.setColumnWidth(4, 240);
  tab.setColumnWidth(14, 220);
  return { rows: rows.length, confirmed: 확인수 };
}

// ─────────────────────────────────────────────────────
//  5) 실행 진입점
// ─────────────────────────────────────────────────────

/**
 * 오전/오후 판매현황 중복 의심 점검.
 * @param {string=} dateKey 'yyyy-MM-dd' (없으면 오늘)
 * @return {Object} 결과 요약
 */
function partnerCheckSalesDuplicates(dateKey, silent) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: "허브 스프레드시트를 찾을 수 없습니다." };

  dateKey = String(dateKey || "").trim() || _dw_dateKey_(new Date());

  var hist = _dw_readHistoryForDate_(ss, dateKey);
  var hubRecs = _dw_readHubForDate_(ss, dateKey);
  var records, source;

  if (hist.length) {
    // 이력 건에 현재 송장·상태를 붙인다 (이미 발송된 건인지 바로 보이게)
    var hubIdx = _dw_hubStatusIndex_(ss);
    for (var i = 0; i < hist.length; i++) {
      var hit = hubIdx[hist[i].uid];
      if (hit) {
        hist[i].inv = hit.inv;
        hist[i].status = hit.status;
      }
    }
    hist = hist.filter(function (r) { return !_dw_isDeadStatus_(r.status); });

    // 아직 판매현황에 안 올라간 건도 같이 본다.
    // 오후 업로드 '전에' 잡아야 이중 출고를 막을 수 있다.
    var inHist = {};
    for (var h = 0; h < hist.length; h++) {
      if (hist[h].uid) inHist["u" + hist[h].uid] = true;
      if (hist[h].hubRow) inHist["r" + hist[h].hubRow] = true;
    }
    var pending = [];
    for (var p = 0; p < hubRecs.length; p++) {
      var hr = hubRecs[p];
      if (hr.uploaded) continue;
      if (hr.uid && inHist["u" + hr.uid]) continue;
      if (inHist["r" + hr.hubRow]) continue;
      hr.batch = 99;
      hr.batchLabel = "미업로드";
      pending.push(hr);
    }
    records = hist.concat(pending);
    source = "판매현황_갱신이력" +
      (pending.length ? " + 미업로드 허브 " + pending.length + "건" : "");
  } else {
    records = hubRecs;
    source = "허브 수집일시(" + _dw_noonHour_() + "시 기준 오전/오후)";
  }

  var batchSet = {};
  for (var b = 0; b < records.length; b++) batchSet[records[b].batch] = true;
  var batchCount = Object.keys(batchSet).length;

  var groups = _dw_findSuspects_(records);
  var meta = {
    at: Utilities.formatDate(new Date(), _DW_TZ, "yyyy-MM-dd HH:mm"),
    dateKey: dateKey,
    source: source,
    batchCount: batchCount,
    skippedBulk: groups.skippedBulk || 0,
  };
  var written = _dw_writeReport_(ss, records, groups, meta);

  try { _dw_trimHistory_(ss); } catch (eT) {}

  var crossCount = 0;
  var sureCount = 0;
  var shippedCount = 0;   // 이미 두 번 나간 것 — 여기부터 손대야 한다
  /* 사유별로도 센다. 다음에 또 「너무 많다」가 나오면 어느 그물이 헛것을
     내는지 숫자로 바로 보인다 — 다시 코드를 뒤질 일이 없게. */
  var byReason = {};
  for (var g = 0; g < groups.length; g++) {
    if (groups[g].spansBatch) crossCount++;
    if (groups[g].grade.indexOf("확실") !== -1) sureCount++;
    if (groups[g].shipped >= 2) shippedCount++;
    var rk = groups[g].reason || "(사유없음)";
    byReason[rk] = (byReason[rk] || 0) + 1;
  }

  var res = {
    ok: true,
    dateKey: dateKey,
    source: source,
    records: records.length,
    batchCount: batchCount,
    groups: groups.length,
    crossGroups: crossCount,
    sureGroups: sureCount,
    shippedGroups: shippedCount,
    confirmedGroups: (written && written.confirmed) || 0,
    splitApart: groups.splitApart || 0,
    byReason: byReason,
    skippedBulk: meta.skippedBulk,
    rows: (written && written.rows) || 0,
    tab: _DW_REPORT_TAB,
  };
  res.message = _dw_summaryText_(res, groups, records);
  Logger.log(res.message);
  if (!silent) {
    try { SpreadsheetApp.getUi().alert(res.message); } catch (eU) {}
  }
  return res;
}

function _dw_summaryText_(res, groups, records) {
  var lines = [];
  lines.push("🔍 오전/오후 판매현황 중복 의심 점검");
  lines.push("");
  lines.push("- 대상 날짜: " + res.dateKey);
  lines.push("- 비교 출처: " + res.source);
  lines.push("- 검사 건수: " + res.records + "건 (회차 " + res.batchCount + "개)");
  lines.push("- 의심 그룹: " + res.groups + "건 (회차 간 " + res.crossGroups +
    " · 확실 " + res.sureGroups + ")");
  if (res.shippedGroups) {
    lines.push("  ★ 이미 두 번 나간 건 " + res.shippedGroups + "건 — 맨 위에 있습니다");
  }
  if (res.confirmedGroups) {
    lines.push("  · 확인 끝난 " + res.confirmedGroups + "건은 맨 아래로 내렸습니다");
  }
  lines.push("- 결과 탭: " + res.tab + " (A열 체크박스로 확인 관리)");

  /* ★ 어느 그물이 얼마나 내는지 적는다 ★  (2026-09-18)
     「너무 많다」가 다시 나올 때 코드를 또 뒤지지 않으려고 남긴다. */
  if (res.byReason) {
    var keys = [];
    for (var rk in res.byReason) {
      if (Object.prototype.hasOwnProperty.call(res.byReason, rk)) keys.push(rk);
    }
    if (keys.length) {
      keys.sort(function (a, b) { return res.byReason[b] - res.byReason[a]; });
      lines.push("");
      lines.push("무엇으로 잡혔나:");
      for (var ki = 0; ki < keys.length; ki++) {
        lines.push("  · " + keys[ki] + " — " + res.byReason[keys[ki]] + "건");
      }
    }
  }
  if (res.splitApart) {
    lines.push("");
    lines.push("※ 전화·주소가 서로 달라 «다른 사람»으로 갈라 낸 묶음 " +
      res.splitApart + "건. 여태는 동명이인도 한 그룹으로 나왔습니다.");
  }

  if (res.batchCount < 2) {
    lines.push("");
    lines.push("※ 회차가 1개뿐입니다. 오전/오후 비교는 판매현황을 두 번 이상");
    lines.push("  갱신한 날부터 가능합니다. 지금은 같은 회차 내 중복만 봅니다.");
  }
  if (res.skippedBulk) {
    lines.push("");
    lines.push("※ 같은 주소로 같은 품목이 6건 이상 몰린 " + res.skippedBulk +
      "건은 대량발송 패턴으로 보고 제외했습니다.");
  }

  if (groups.length) {
    lines.push("");
    lines.push("상위 " + Math.min(groups.length, 8) + "건:");
    for (var i = 0; i < Math.min(groups.length, 8); i++) {
      var g = groups[i];
      var r = records[g.members[0]];
      var where = [];
      for (var m = 0; m < g.members.length; m++) {
        where.push(records[g.members[m]].batchLabel + " " + records[g.members[m]].hubRow + "행");
      }
      lines.push("  " + g.grade + " " + (r.name || "(이름없음)") + " · " +
        (r.item || r.code) + " · " + where.join(" ↔ "));
    }
  }
  return lines.join("\n");
}

/** 메뉴: 오늘 기준 점검 */
function partnerCheckSalesDuplicatesOwner() {
  _owner_runWithNotify_("오전/오후 중복 점검", function () {
    partnerCheckSalesDuplicates("", false);
  });
}

/** 메뉴: 날짜 지정 점검 */
function partnerCheckSalesDuplicatesForDate() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    "오전/오후 중복 점검 — 날짜 지정",
    "점검할 날짜를 yyyy-MM-dd 로 입력하세요.\n(예: " + _dw_dateKey_(new Date()) + ")",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var key = String(resp.getResponseText() || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    ui.alert("날짜 형식이 맞지 않습니다. yyyy-MM-dd 로 입력하세요.");
    return;
  }
  partnerCheckSalesDuplicates(key, false);
}

/**
 * Push '전에' 돌리는 중복 점검.
 *
 * 오후 Push 는 이미 오전에 나간 건과 겹칠 수 있다. 나가기 전에 세어두면
 * 운영자가 전용양식을 보낸 직후 무엇을 확인해야 하는지 알 수 있다.
 *
 * Push 를 막지 않는다. 점검이 실패해도 그 사실만 알림에 적고 넘어간다.
 *
 * @return {{fields: Array, cross: number, sure: number}}
 *   fields — _owner_runWithNotify_ 완료 카드에 붙일 항목
 */
function _dw_preCheckBeforePush_() {
  var out = { fields: [], cross: 0, sure: 0 };
  try {
    var res = partnerCheckSalesDuplicates("", true);
    if (!res || !res.ok) {
      out.fields.push({
        label: "🕵️ 중복점검",
        value: "실행 실패 — Push 는 계속 진행했습니다",
      });
      return out;
    }

    out.cross = res.crossGroups;
    out.sure = res.sureGroups;

    /* ★ 이미 나간 것을 먼저 말한다 ★  (2026-09-18)
       「막을 수 있는 것」과 「이미 벌어진 것」은 할 일이 다르다.
       앞은 Push 를 멈추고 지우면 되고, 뒤는 회수·환불 이야기다. */
    if (res.shippedGroups > 0) {
      out.fields.push({
        label: "🚨 이미 두 번 나감",
        value: res.shippedGroups + "건 — 송장이 둘입니다. " + res.tab + " 탭 맨 위",
      });
    }

    if (res.crossGroups > 0) {
      out.fields.push({
        label: "🕵️ 중복의심 (회차 간)",
        value: "⚠️ " + res.crossGroups + "건" +
          (res.sureGroups > 0 ? " · 확실 " + res.sureGroups + "건" : ""),
      });
      // Push 를 막지 않으려면 alert 대신 토스트다. Push 도는 동안 화면에 남는다.
      try {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          "회차 간 중복의심 " + res.crossGroups + "건" +
            (res.sureGroups > 0 ? " (확실 " + res.sureGroups + "건)" : "") +
            " — " + res.tab + " 탭 확인. Push 는 계속 진행합니다.",
          "⚠️ 중복 점검",
          30
        );
      } catch (eToast) {}
    } else if (res.groups > 0) {
      out.fields.push({
        label: "🕵️ 중복의심",
        value: "회차 간 0건 · 같은 회차 내 " + res.groups + "건",
      });
    } else {
      out.fields.push({
        label: "🕵️ 중복점검",
        value: "의심 없음 (" + res.records + "건 검사)",
      });
    }
    out.fields.push({
      label: "  └ 점검 결과",
      value: res.tab + " 탭 · 회차 " + res.batchCount + "개 · " + res.dateKey,
    });
  } catch (e) {
    Logger.log("[DupWatch] Push 전 점검 실패: " + e.message);
    out.fields.push({
      label: "🕵️ 중복점검",
      value: "오류: " + String(e.message || e).substring(0, 80),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────
//  6) 진단
// ─────────────────────────────────────────────────────

/** 점검이 왜 아무것도 못 잡는지 확인할 때 */
function partnerDiagnoseSalesDuplicates() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = [];
  var todayKey = _dw_dateKey_(new Date());

  out.push("═══ 오전/오후 중복 점검 진단 ═══");
  out.push("오늘: " + todayKey + " · 오전/오후 경계: " + _dw_noonHour_() + "시");
  out.push("");

  var hist = ss.getSheetByName(_DW_HISTORY_TAB);
  if (!hist) {
    out.push("· " + _DW_HISTORY_TAB + " 탭 없음 — 판매현황을 한 번 갱신하면 만들어집니다.");
  } else {
    out.push("· " + _DW_HISTORY_TAB + ": 총 " + Math.max(0, hist.getLastRow() - 1) + "행");
    var todayRecs = _dw_readHistoryForDate_(ss, todayKey);
    var seq = {};
    for (var i = 0; i < todayRecs.length; i++) {
      var k = todayRecs[i].batch + "회차(" + todayRecs[i].batchLabel + ") " + todayRecs[i].at;
      seq[k] = (seq[k] || 0) + 1;
    }
    var keys = Object.keys(seq);
    out.push("  오늘 적재: " + todayRecs.length + "건 / 회차 " + keys.length + "개");
    for (var s = 0; s < keys.length; s++) out.push("    · " + keys[s] + " → " + seq[keys[s]] + "건");
    if (keys.length < 2) {
      out.push("  ⚠ 회차가 2개 미만입니다. 오전·오후 각각 판매현황을 갱신해야");
      out.push("    회차 간 비교가 됩니다. 그전까지는 허브 수집일시로 비교합니다.");
    }
  }

  out.push("");
  var hubRecs = _dw_readHubForDate_(ss, todayKey);
  var am = 0, pm = 0;
  for (var h = 0; h < hubRecs.length; h++) {
    if (hubRecs[h].batchLabel === "오전") am++; else pm++;
  }
  out.push("· 허브 폴백: 오늘 수집 " + hubRecs.length + "건 (오전 " + am + " / 오후 " + pm + ")");
  if (!hubRecs.length) {
    out.push("  ⚠ 오늘 수집된 허브 행이 없습니다. 먼저 '1️⃣ 대리판매 발주수집' 실행.");
  }

  out.push("");
  var report = ss.getSheetByName(_DW_REPORT_TAB);
  out.push("· " + _DW_REPORT_TAB + ": " +
    (report ? Math.max(0, report.getLastRow() - 1) + "행" : "탭 없음 (점검 실행 시 생성)"));

  out.push("");
  out.push("판정 기준:");
  var lv = _dw_levels_();
  for (var l = 0; l < lv.length; l++) out.push("  " + lv[l].grade + " — " + lv[l].reason);

  var text = out.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert(text); } catch (e) {}
  return text;
}
