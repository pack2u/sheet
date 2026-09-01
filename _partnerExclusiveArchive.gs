/**
 * [협력업체] 전용양식 → 전용발주 마감탭 이동 시스템  v1.0
 * 파일: _partnerExclusiveArchive.gs
 *
 * ★ 핵심 흐름 ★
 *   각 협력업체 파일의 「전용양식」탭 전체 데이터를
 *   → 같은 파일 내 「(YYYY년 M월) 전용발주 마감」탭으로 이동
 *   → 전용양식 원본 행 삭제 (헤더 1행만 유지)
 *   → 소스 탭 협력Push UID 초기화 (재Push 가능 상태)
 *
 * UID 유무와 무관하게 동작합니다.
 */

var _PEA_TAB_SUFFIX    = "전용발주 마감";
var _PEA_KEY_CELL      = "AZ1";
var _PEA_KEY_PREFIX    = "PEA_MONTH:";
var _PEA_HEADER_BG     = "#1f4e78";

// ★ 2026-07-16: 연속 실행(continuation) 상수 — GAS 6분 한도 회피
var _PEA_RESUME_KEY_     = "_PEA_RESUME_STATE";     // ScriptProperties 상태 저장 키
var _PEA_RESUME_TRIGGER_ = "_pea_continueResume_";  // 재개 트리거 핸들러명
var _PEA_PENDING_KEY_    = "_PEA_PENDING_TABNAME";  // 비차단 신규 시작용 tabName 보관 키

// ══════════════════════════════════════════════
//  이동 판정 (core·미리보기·단일파일 처리 공통)
//  ★ 2026-08-25: 판정 규칙을 헬퍼로 단일화.
//    이전에는 core만 "15일 초과 강제 이동"을 수행하면서 기준일을 C~AX 전 열에서
//    "연속 8자리 숫자"로 탐색했다. 이 때문에 전화번호(01012345678)·주문번호가
//    날짜로 오인되어(0101년 23월 45일) 송장 없는 행이 15일 초과로 판정되고
//    마감탭으로 넘어갔다. 기준일은 신뢰 가능한 열에서만 읽는다.
// ══════════════════════════════════════════════

var _PEA_FORCE_MOVE_DAYS_ = 15;
var _PEA_UID_COL_IDX_     = 49; // AX열: Push가 기입하는 고유ID

/** 문자열에서 yyyymmdd 정수 추출. 실제 날짜 범위가 아니면 null */
function _pea_parseDateNum_(val) {
  var s = String(val == null ? "" : val).trim();
  if (!s) return null;
  var m = s.match(/(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/); // 2026/05/15
  if (!m) m = s.match(/(20\d{2})(\d{2})(\d{2})/);               // AP-20260707-001
  if (!m) return null;
  var mo = parseInt(m[2], 10),
      d  = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return parseInt(m[1], 10) * 10000 + mo * 100 + d;
}

/** N일 전 yyyymmdd */
function _pea_cutoffNum_(days) {
  var c = new Date();
  c.setDate(c.getDate() - days);
  return c.getFullYear() * 10000 + (c.getMonth() + 1) * 100 + c.getDate();
}

/** 헤더명이 날짜인 열 인덱스 (양식마다 위치가 달라 헤더로 찾는다) */
function _pea_dateColIdxs_(headers) {
  var out = [];
  for (var i = 0; i < (headers || []).length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (h.indexOf("일자") !== -1 || h.indexOf("집하예정") !== -1 ||
        h.indexOf("주문일") !== -1 || h.indexOf("발주일") !== -1) out.push(i);
  }
  return out;
}

/** placeholder("재고확인 후 판단" 등)는 송장 없음으로 취급 */
function _pea_hasInvoice_(v) {
  try {
    if (typeof _po_hasRealInvoice_ === "function") return _po_hasRealInvoice_(v);
  } catch (e) {}
  return String(v == null ? "" : v).trim() !== "";
}

/** 행의 기준일 — AX열 고유ID → B열 → 헤더가 날짜인 열 순. 못 찾으면 null */
function _pea_rowBaseDateNum_(row, dateColIdxs) {
  var n = null;
  if (row.length > _PEA_UID_COL_IDX_) {
    n = _pea_parseDateNum_(row[_PEA_UID_COL_IDX_]);
    if (n) return n;
  }
  n = _pea_parseDateNum_(row[1]);
  if (n) return n;
  for (var i = 0; i < (dateColIdxs || []).length; i++) {
    n = _pea_parseDateNum_(row[dateColIdxs[i]]);
    if (n) return n;
  }
  return null;
}

/**
 * 전용양식 1행의 마감 이동 여부
 * @returns {{move:boolean, reason:string}}
 *   future=예약 발주 잔류, invoice=송장 있어 이동,
 *   stale=송장 없으나 기준일 15일 초과로 강제 이동,
 *   recent=15일 이내 잔류, nodate=기준일 불명 잔류
 */
function _pea_decideRow_(row, dateColIdxs, todayNum, cutoffNum) {
  // 미래 날짜(예약 발주)만 잔류 — B열("2026/05/15-33") 기준
  var bNum = _pea_parseDateNum_(row[1]);
  if (bNum && bNum > todayNum) return { move: false, reason: "future" };

  if (_pea_hasInvoice_(row[0])) return { move: true, reason: "invoice" };

  var baseNum = _pea_rowBaseDateNum_(row, dateColIdxs);
  if (baseNum && baseNum <= cutoffNum) return { move: true, reason: "stale" };
  return { move: false, reason: baseNum ? "recent" : "nodate" };
}

// ══════════════════════════════════════════════
//  일일마감용: 전용발주 마감탭 → 송장맵
//  ★ 2026-08-27: 대리공급 송장의 원천은 전용양식 A열이다.
//    마감이동이 그 행을 마감탭으로 옮기면 임시기록·전용양식에는 더 이상 없다.
//    일일마감을 다시 돌릴 때 마감탭을 날짜까지 직접 읽지 않으면
//    오전 판매현황이 뒤늦게 들어와도 대리공급 송장을 찾지 못한다.
//    송장원장 커서는 2분 예산·증분 읽기라 이번 회차에 빠질 수 있다.
// ══════════════════════════════════════════════

/** yyyy-MM-dd → yyyymmdd. 못 읽으면 0 */
function _pea_ymdToNum_(ymd) {
  var n = _pea_parseDateNum_(ymd);
  return n || 0;
}

/** 마감탭 헤더에서 열 위치. 전용양식 앞에 「이동일시」가 붙어 있다 */
function _pea_archiveInvCols_(hdr) {
  function find(re, fromRight) {
    if (!hdr) return -1;
    if (fromRight) {
      for (var i = hdr.length - 1; i >= 0; i--) {
        if (re.test(String(hdr[i] || "").replace(/\s/g, ""))) return i;
      }
      return -1;
    }
    for (var j = 0; j < hdr.length; j++) {
      if (re.test(String(hdr[j] || "").replace(/\s/g, ""))) return j;
    }
    return -1;
  }
  var cols = {
    moved: 0,
    inv: find(/^송장번호$|^운송장번호$/, false),
    uid: find(/^고유ID$/i, true),
    sabang: find(/사방넷주문번호|^사방넷주문$/, false),
    orderer: find(/주문자명\(사방넷\)|^주문자명$/, false),
    name: find(/수취인|수령인|받는분성명|받는분|받는사람/, false),
    phone: find(/받는분전화|수취인전화|수령인연락처|받는전화|전화번호|휴대폰|연락처/, false),
    item: find(/품목명|상품명|품명/, false),
    addr: find(/주소/, false),
    date: find(/주문일|발주일|^일자/, false),
  };
  if (cols.inv < 0) cols.inv = 1; // 이동일시 + 전용양식 A열
  if (cols.uid < 0) cols.uid = Math.min(50, (hdr && hdr.length ? hdr.length : 51) - 1);
  return cols;
}

/**
 * 마감탭 행을 이 날짜까지 읽을지.
 * 이동일시가 있으면 그걸 기준으로 한다 (오늘 넘어간 26일 행을 살리는 기준).
 * 이동일시가 없으면 주문일·고유ID 날짜로 본다. 날짜를 전혀 못 읽으면 포함한다.
 */
function _pea_archiveRowOnOrBefore_(row, cols, throughNum) {
  if (!throughNum) return true;
  var n = _pea_parseDateNum_(row[cols.moved]);
  if (!n && cols.date >= 0) n = _pea_parseDateNum_(row[cols.date]);
  if (!n && cols.uid >= 0) n = _pea_parseDateNum_(row[cols.uid]);
  if (!n) return true;
  return n <= throughNum;
}

/**
 * 협력업체 「전용발주 마감」탭을 throughDate(포함)까지 읽어 invoiceMap에 넣는다.
 * @return {{read:number, files:number, skippedFuture:number, errors:string[]}}
 */
function _pea_archiveMonths_(throughDateStr) {
  var throughNum = _pea_ymdToNum_(throughDateStr);
  var months = [];
  if (throughNum) {
    var ty = Math.floor(throughNum / 10000);
    var tm = Math.floor((throughNum % 10000) / 100);
    months.push({ yyyy: ty, m: tm });
    var prev = new Date(ty, tm - 2, 1); // 전달 — 월초 마감이 전월 탭에 있을 수 있다
    months.push({ yyyy: prev.getFullYear(), m: prev.getMonth() + 1 });
  } else {
    var now = new Date();
    months.push({ yyyy: now.getFullYear(), m: now.getMonth() + 1 });
  }
  return { throughNum: throughNum, months: months };
}

/** 이미 연 협력업체 시트 1개에서 전용발주 마감탭만 송장맵에 넣는다. */
function _pea_ingestExclusiveArchiveSs_(ss, invoiceMap, throughDateStr, vendor) {
  var out = { read: 0, files: 0, skippedFuture: 0, errors: [] };
  if (!ss || !invoiceMap) return out;
  var plan = _pea_archiveMonths_(throughDateStr);
  var throughNum = plan.throughNum;
  var months = plan.months;
  vendor = String(vendor || "").trim();

  var vCarrier = "";
  try {
    var stTab = ss.getSheetByName("설정");
    var b5 = stTab ? String(stTab.getRange("B5").getValue() || "").trim() : "";
    if (typeof _pep_carrierForVendor_ === "function") {
      vCarrier = _pep_carrierForVendor_(b5 || vendor);
    }
  } catch (eCr) {}

  var suffix = _PEA_TAB_SUFFIX;
  var fileRead = 0;
  for (var mi = 0; mi < months.length; mi++) {
    var tabName = "(" + months[mi].yyyy + "년 " + months[mi].m + "월) " + suffix;
    var tab = ss.getSheetByName(tabName);
    if (!tab || tab.getLastRow() < 2) continue;
    var lc = Math.max(tab.getLastColumn(), 2);
    var all;
    try { all = tab.getRange(1, 1, tab.getLastRow(), lc).getDisplayValues(); }
    catch (eRead) { out.errors.push(vendor + "/" + tabName + ": " + eRead.message); continue; }
    var cols = _pea_archiveInvCols_(all[0]);
    for (var ri = 1; ri < all.length; ri++) {
      var row = all[ri];
      var inv = row[cols.inv];
      if (typeof _pep_normInvoiceNo_ === "function") {
        if (!_pep_normInvoiceNo_(inv) && !_pep_splitInvNos_(inv).length) continue;
      } else if (!String(inv || "").trim()) continue;
      if (!_pea_archiveRowOnOrBefore_(row, cols, throughNum)) {
        out.skippedFuture++;
        continue;
      }
      var uid = cols.uid >= 0 ? String(row[cols.uid] || "").trim() : "";
      if (uid && typeof _pep_uidFromOrdererCell_ === "function") {
        uid = _pep_uidFromOrdererCell_(uid) || uid;
      }
      if (uid && !(invoiceMap[uid] && invoiceMap[uid].source === "롯데")) {
        _pep_addInvoiceMap_(invoiceMap, uid, inv, "대리공급", vCarrier);
      }
      var sb = "";
      if (cols.sabang >= 0) sb = String(row[cols.sabang] || "").trim();
      if (!sb && cols.orderer >= 0) sb = String(row[cols.orderer] || "").trim();
      if (sb && typeof _pep_uidFromOrdererCell_ === "function") {
        sb = _pep_uidFromOrdererCell_(sb);
      }
      if (sb && sb !== uid && !(invoiceMap[sb] && invoiceMap[sb].source === "롯데")) {
        _pep_addInvoiceMap_(invoiceMap, sb, inv, "대리공급", vCarrier);
      }
      if (typeof _pep_addNamePhoneInvoiceKeys_ === "function") {
        _pep_addNamePhoneInvoiceKeys_(
          invoiceMap,
          cols.name >= 0 ? row[cols.name] : "",
          cols.phone >= 0 ? row[cols.phone] : "",
          inv,
          "대리공급",
          {
            skipName: true,
            addr: cols.addr >= 0 ? row[cols.addr] : "",
            item: cols.item >= 0 ? row[cols.item] : "",
            carrier: vCarrier,
            stat: typeof _pep_keyStat_ === "function" ? _pep_keyStat_("전용마감") : null,
          },
        );
      }
      out.read++;
      fileRead++;
    }
  }
  if (fileRead) out.files = 1;
  return out;
}

function _pea_addExclusiveArchiveToInvoiceMap_(invoiceMap, throughDateStr) {
  var out = { read: 0, files: 0, skippedFuture: 0, errors: [] };
  if (!invoiceMap) return out;

  var files = [];
  try { files = _pt_listFiles() || []; }
  catch (eList) { out.errors.push("파일 목록: " + eList.message); return out; }

  for (var fi = 0; fi < files.length; fi++) {
    var vendor = String(files[fi].name || "").replace("[협력업체] ", "").trim();
    var ss;
    try { ss = SpreadsheetApp.openById(files[fi].id); }
    catch (eOpen) { out.errors.push(vendor + " 열기 실패: " + eOpen.message); continue; }
    var one = _pea_ingestExclusiveArchiveSs_(ss, invoiceMap, throughDateStr, vendor);
    out.read += one.read;
    out.files += one.files;
    out.skippedFuture += one.skippedFuture;
    if (one.errors && one.errors.length) out.errors = out.errors.concat(one.errors);
  }
  Logger.log("[UNIFIED] 전용발주 마감탭 송장맵: " + out.read + "건 / " +
    out.files + "파일" +
    (throughDateStr ? " (~" + throughDateStr + ")" : "") +
    (out.skippedFuture ? " 미래제외=" + out.skippedFuture : "") +
    (out.errors.length ? " 오류=" + out.errors.length : ""));
  return out;
}

// ══════════════════════════════════════════════
//  공개 진입점
// ══════════════════════════════════════════════

/**
 * [수동] 전용양식 → 전용발주 마감탭 이동 + UID 초기화
 *  ★ 2026-07-16: 비차단(non-blocking) 방식.
 *  확인창(미리보기) → 백그라운드 트리거로 실제 처리 → 완료 시 Chat 알림.
 *  ★ ScriptLock을 시작 단계에서 잡지 않음 — 「다른 작업 진행 중」 오탐 방지.
 */
function partnerArchiveExclusiveForm() {
  var ui = SpreadsheetApp.getUi();

  var now     = new Date();
  var yyyy    = Utilities.formatDate(now, "Asia/Seoul", "yyyy");
  var mm      = parseInt(Utilities.formatDate(now, "Asia/Seoul", "M"), 10);
  var tabName = "(" + yyyy + "년 " + mm + "월) " + _PEA_TAB_SUFFIX;

  // ★ 이미 백그라운드 진행 중이면 재시작 여부만 확인
  var existing = _pea_loadResumeState_();
  var pending = null;
  try { pending = PropertiesService.getScriptProperties().getProperty(_PEA_PENDING_KEY_); } catch (_) {}
  if ((existing && existing.queue && existing.queue.length > 0) || pending) {
    var remain = (existing && existing.queue) ? existing.queue.length : "(시작 대기)";
    var cfBusy = ui.alert(
      "⏳ 대리공급 마감 진행 중",
      "이미 백그라운드에서 처리 중입니다.\n" +
      "남은 업체: " + remain + "\n\n" +
      "· 예 = 강제 재시작 (현재 진행 취소 후 처음부터)\n" +
      "· 아니오 = 그대로 두기 (완료 시 Chat 알림)",
      ui.ButtonSet.YES_NO
    );
    if (cfBusy !== ui.Button.YES) return;
    _pea_clearResumeState_();
    try { PropertiesService.getScriptProperties().deleteProperty(_PEA_PENDING_KEY_); } catch (_) {}
  }

  // ★ 마감 이동 전 미리보기 (이동/잔류 예상 건수 사전 스캔)
  var preview = _pea_preview_(tabName);

  var cf = ui.alert(
    "📁 전용발주 마감 이동",
    "각 협력업체 파일의 「전용양식」데이터를\n" +
    "→ 「" + tabName + "」탭으로 이동합니다.\n\n" +
    "📊 예상 결과:\n" +
    "  · 이동: " + preview.moveCount + "행\n" +
    "  · 잔류: " + preview.keepCount + "행\n" +
    "  · 대상 탭: " + preview.tabCount + "개\n" +
    (preview.staleCount > 0
      ? "  ⚠ 이동분 중 송장없음(" + _PEA_FORCE_MOVE_DAYS_ + "일 초과 강제): " +
        preview.staleCount + "행\n"
      : "") + "\n" +
    "· 전용양식 원본 행 → 삭제 (헤더 유지)\n" +
    "· 소스 탭 협력Push UID → 초기화 (재Push 가능)\n\n" +
    "▶ 확인을 누르면 백그라운드에서 처리되며,\n" +
    "   완료 시 Google Chat 알림이 전송됩니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (cf !== ui.Button.YES) return;

  // ★ 비차단: 이전 미완료 정리 → tabName 예약 → 백그라운드 트리거 시작
  _pea_clearResumeState_();
  try { PropertiesService.getScriptProperties().setProperty(_PEA_PENDING_KEY_, tabName); } catch(_) {}
  var scheduled = _pea_scheduleResume_(5 * 1000); // 5초 후 백그라운드 시작

  if (scheduled) {
    ui.alert("✅ 대리공급 마감을 시작했습니다.\n\n" +
      "백그라운드에서 처리되며, 완료되면 Google Chat 알림이 전송됩니다.\n" +
      "이 창은 닫으셔도 됩니다.\n\n" +
      "※ 다시 누르면 '진행 중' 안내가 뜹니다. 완료 Chat을 기다려 주세요.");
    return;
  }

  // ── 트리거 예약 실패 → 인라인 폴백(차단 방식) ──
  try { PropertiesService.getScriptProperties().deleteProperty(_PEA_PENDING_KEY_); } catch(_) {}
  ui.alert("⚠ 백그라운드 예약 실패 → 즉시 처리합니다.\n(업체가 많으면 시간이 걸릴 수 있습니다.)");
  var result = _pea_core_(tabName, false);

  if (result.incomplete) {
    ui.alert(
      "⏳ 전용발주 마감 진행 중\n\n" +
      "업체가 많아 나눠서 처리합니다.\n" +
      "남은 " + result.remaining + "개 업체는 1분 뒤 백그라운드에서 자동으로 이어집니다.\n" +
      "(완료 시 Google Chat 알림이 전송됩니다.)"
    );
    return;
  }

  try { _chat_notifyArchive_(result.moved, result.kept, result.tabsCleared, result.uidCleared); } catch (eChat) {}

  ui.alert(
    "✅ 전용발주 마감 이동 완료\n\n" +
    "이동: " + result.moved + "행\n" +
    (result.staleMoved > 0
      ? "  ⚠ 그중 송장없음(" + _PEA_FORCE_MOVE_DAYS_ + "일 초과 강제): " +
        result.staleMoved + "행\n"
      : "") +
    "잔류(송장없음·미완료): " + result.kept + "행\n" +
    "처리 탭: " + result.tabsCleared + "개\n" +
    "UID 초기화: " + result.uidCleared + "건\n" +
    "발주허브 정리: " + (result.hubCleared || 0) + "건\n" +
    "📋 임시기록 정리: 삭제 " + (result.tempCleared || 0) + "건, 유지 " + (result.tempKept || 0) + "건\n" +
    (result.tempSnapshot ? "💾 삭제 전 스냅샷: " + result.tempSnapshot + "\n" : "") +
    (result.errors.length > 0 ? "\n⚠ 오류:\n" + result.errors.slice(0, 5).join("\n") : "") +
    "\n\n이제 '대리발주 Push'를 실행하면 새 발주가 전용양식에 채워집니다."
  );
}



// ══════════════════════════════════════════════
//  핵심 로직
// ══════════════════════════════════════════════
function _pea_core_(tabName, silent) {
  var _startMs_ = Date.now();
  var _MAX_EXEC_MS_ = 4.5 * 60 * 1000; // ★ 2026-07-16: 배치 시간예산(6분 한도 안전마진)

  // ★ 2026-07-16: 연속 실행 — tabName 있으면 신규 시작, null이면 재개(저장 상태 사용)
  var state = _pea_loadResumeState_();
  var resuming = (tabName == null) && state && state.queue;

  if (!resuming) {
    // ── 신규 시작: 이전 미완료 상태 정리 후 초기화 ──
    _pea_clearResumeState_();
    state = {
      tabName: tabName, queue: [],
      moved: 0, kept: 0, staleMoved: 0, tabsCleared: 0, uidCleared: 0,
      tempCleared: 0, tempKept: 0, hubCleared: 0, tempSnapshot: "", errors: [],
      archivedUids: {} // ★ 2026-07-17 (H4): 이번 마감에서 이동된 전용양식 UID 누적
    };

    // ★ 시작 초기화(1회만): 임시기록 + 허브 (재개 시엔 재실행 금지)
    try {
      var hubSS = SpreadsheetApp.openById(_PT.INFO_SS_ID);
      var tempTab = _po_getNonPartnerTempTab_(hubSS);
      if (tempTab) {
        // ★ 2026-08-31: 지우기 전에 스냅샷 ★
        //   아래 _po_clearTempTabInvoicedRowsOnly_ 가 송장 찍힌 행을 삭제한다.
        //   지워지면 그날 무엇이 어떤 송장으로 나갔는지 되짚을 방법이 없다.
        //   구매입력 폴더에 「대리공급임시기록_(날짜)」로 원본을 남긴다.
        //
        //   스냅샷이 실패해도 마감은 계속 간다. 마감이 밀리는 게 더 큰 손해다.
        try {
          if (typeof epdSnapshotTempRecord === "function") {
            var snap = epdSnapshotTempRecord(tempTab);
            state.tempSnapshot = snap.ok ? snap.name : "";
            Logger.log(snap.ok
              ? "[PEA] 임시기록 스냅샷: " + snap.name + " (" + snap.rows + "행)"
              : "[PEA] 임시기록 스냅샷 실패(마감은 계속): " + snap.error);
            if (!snap.ok) state.errors.push("[임시기록스냅샷] " + snap.error);
          }
        } catch (eSnap) {
          Logger.log("[PEA] 임시기록 스냅샷 예외(마감은 계속): " + eSnap.message);
          state.errors.push("[임시기록스냅샷] " + eSnap.message);
        }

        var tempClear = _po_clearTempTabInvoicedRowsOnly_(tempTab);
        state.tempCleared = tempClear.cleared;
        state.tempKept = tempClear.kept;
        Logger.log("[PEA] 임시기록 초기화: 삭제=" + tempClear.cleared + "건, 유지=" + tempClear.kept + "건");
      }
    } catch (eTempClear) {
      state.errors.push("[임시기록초기화] " + eTempClear.message);
    }

    // ★ 2026-07-17 (H4): 시작 시 "송장 있는 행 전부 삭제" 폐기
    //   → 대리판매 미마감 건까지 지워지는 사고 방지.
    //   허브 정리는 이번 마감에서 실제 이동된 전용양식 UID와 매칭된 행만
    //   (_pea_clearHubRowsByUids_) 슬라이스 종료 시점에 수행.

    var files = _pt_listFiles();
    state.queue = files.map(function(f) { return { id: f.id, name: f.name }; });
    _pea_saveResumeState_(state);
  } else {
    tabName = state.tabName; // 재개: 저장된 tabName 복원
  }

  var result = state; // 이후 result.* 접근을 state로 통일

  // ★ 안전망: 6분 강제종료 대비 5.5분 후 재개 예약 (정상 종료 시 교체/삭제됨)
  _pea_scheduleResume_(5.5 * 60 * 1000);

  var processed = 0;
  while (state.queue.length > 0) {
    if (processed > 0 && Date.now() - _startMs_ > _MAX_EXEC_MS_) break;
    var fileInfo = state.queue.shift();
    try {
      var ss   = SpreadsheetApp.openById(fileInfo.id);
      var tabs = ss.getSheets();

      for (var ti = 0; ti < tabs.length; ti++) {
        var tabSheet = tabs[ti];
        if (tabSheet.getName().indexOf("전용양식") === -1) continue;

        var lr = tabSheet.getLastRow();
        if (lr < 2) continue; // 헤더만 있는 경우 스킵

        var lc      = tabSheet.getLastColumn();
        var headers = tabSheet.getRange(1, 1, 1, lc).getValues()[0];
        var data    = tabSheet.getRange(2, 1, lr - 1, lc).getValues();

        // ★ 2026-08-03: B열 날짜 기준 — 오늘 포함 이전 날짜 마감 (미래만 잔류)
        var today = new Date();
        today.setHours(23, 59, 59, 999); // 오늘 끝까지 포함
        var todayNum = today.getFullYear() * 10000 +
                       (today.getMonth() + 1) * 100 +
                       today.getDate();

        var cutoffNum   = _pea_cutoffNum_(_PEA_FORCE_MOVE_DAYS_);
        var dateColIdxs = _pea_dateColIdxs_(headers);

        var archiveRows = []; // 마감탭으로 이동할 행
        var keepRowIdxs = []; // 전용양식에 남길 행 인덱스 (0-based in data[])

        for (var di = 0; di < data.length; di++) {
          var decision = _pea_decideRow_(data[di], dateColIdxs, todayNum, cutoffNum);
          if (decision.move) {
            archiveRows.push(data[di]);
            if (decision.reason === "stale") result.staleMoved = (result.staleMoved || 0) + 1;
          } else {
            keepRowIdxs.push(di);
          }
        }

        if (archiveRows.length === 0) continue; // 이동할 행 없음

        // 마감 탭 취득 or 생성
        var archTab = ss.getSheetByName(tabName);
        if (!archTab) {
          var byKey = _pea_findTabByKey_(ss, _PEA_KEY_PREFIX + tabName);
          archTab   = byKey || ss.insertSheet(tabName);
        }

        // 레이아웃 (최초 1회)
        var isNew = archTab.getLastRow() < 1;
        if (isNew) {
          _pea_initArchiveTab_(archTab, headers, lc);
        }

        // 마감 탭으로 데이터 추가 (수집일시 자동 추가)
        var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
        var appendRows = archiveRows.map(function(row) {
          return [nowStr].concat(row);
        });
        var extHeaders = ["이동일시"].concat(headers);
        var extLc      = extHeaders.length;

        // ★ 항상 헤더를 최신으로 동기화 (기존 탭이더라도 전용양식 헤더 변경 시 반영)
        var maxCol = archTab.getMaxColumns();
        if (maxCol < extLc) {
          archTab.insertColumnsAfter(maxCol, extLc - maxCol);
        }
        archTab.getRange(1, 1, 1, extLc).setValues([extHeaders])
          .setBackground(_PEA_HEADER_BG).setFontColor("white")
          .setFontWeight("bold").setHorizontalAlignment("center");
        archTab.setFrozenRows(1);
        
        // 기존 탭의 낡은 헤더(초과분) 지우기
        var curMax = archTab.getMaxColumns();
        if (curMax > extLc) {
          archTab.getRange(1, extLc + 1, 1, curMax - extLc).clearContent().setBackground("#ffffff");
        }

        var nextRow = archTab.getLastRow() + 1;
        if (nextRow < 2) nextRow = 2;
        archTab.getRange(nextRow, 1, appendRows.length, extLc).setValues(appendRows);

        // 키 셀 기록
        _pea_setKey_(archTab, _PEA_KEY_PREFIX + tabName);

        // ★ 2026-06-22: 안전장치 — 마감탭 기록 성공 확인 후에만 원본 삭제
        SpreadsheetApp.flush();
        var verifyLastRow = archTab.getLastRow();
        var expectedLastRow = nextRow + appendRows.length - 1;
        if (verifyLastRow < expectedLastRow) {
          result.errors.push("[" + fileInfo.name + "/" + tabSheet.getName() + "] 마감탭 기록 검증 실패 (기대=" + expectedLastRow + " 실제=" + verifyLastRow + ") → 원본 보존");
          continue;
        }

        // 전용양식 원본에서 이동된 행 삭제
        // ★ try/catch 감싸 → 실패 시 메모리의 원본 data[] 배열로 전체 복구
        try {
          if (keepRowIdxs.length === 0) {
            // 전부 이동 → 전체 삭제 (★ 2026-07-24: 값+서식)
            _pt_clearContentAndFormat_(tabSheet.getRange(2, 1, lr - 1, lc));
          } else {
            // ★ 잔류 데이터를 clear 전에 미리 구성
            var keepRowsData = [];
            for (var ki = 0; ki < keepRowIdxs.length; ki++) {
              keepRowsData.push(data[keepRowIdxs[ki]]);
            }
            _pt_clearContentAndFormat_(tabSheet.getRange(2, 1, lr - 1, lc));
            if (keepRowsData.length > 0) {
              tabSheet.getRange(2, 1, keepRowsData.length, lc).setValues(keepRowsData);
            }
            SpreadsheetApp.flush();

            // ★ 잔류 행 복원 검증
            var restoredCount = tabSheet.getLastRow() - 1;
            if (restoredCount < keepRowsData.length) {
              // 복원 부족 → 원본 전체 복구
              _pt_clearContentAndFormat_(tabSheet.getRange(2, 1, lr - 1, lc));
              tabSheet.getRange(2, 1, data.length, lc).setValues(data);
              SpreadsheetApp.flush();
              result.errors.push("[" + fileInfo.name + "] 잔류 복원 검증 실패 → 원본 전체 복구");
              continue;
            }
          }
        } catch (eClear) {
          // ★ clear 후 setValues 실패 → 원본 전체 복구
          try {
            _pt_clearContentAndFormat_(tabSheet.getRange(2, 1, lr - 1, lc));
            tabSheet.getRange(2, 1, data.length, lc).setValues(data);
            SpreadsheetApp.flush();
          } catch (eRestore) {}
          result.errors.push("[" + fileInfo.name + "] 원본 삭제 중 오류 → 복구 시도: " + eClear.message);
          continue;
        }

        result.moved       += archiveRows.length;
        result.kept        += keepRowIdxs.length;
        result.tabsCleared += 1;

        // ★ 2026-07-17 (H4): 이동 확정 행의 AX열(50열, idx49) UID 수집
        //   → 완료 시 허브에서 이 UID 매칭 행만 삭제
        if (!state.archivedUids) state.archivedUids = {};
        for (var au = 0; au < archiveRows.length; au++) {
          var _axRaw_ = archiveRows[au].length > 49 ? archiveRows[au][49] : "";
          var _axUid_ = "";
          try { _axUid_ = _pep_normalizeAxUid_(_axRaw_); }
          catch (_) { _axUid_ = String(_axRaw_ || "").trim(); }
          _axUid_ = String(_axUid_ || "").replace(/\s/g, "");
          if (_axUid_) state.archivedUids[_axUid_] = true;
        }

        SpreadsheetApp.flush();
      }
    } catch (e) {
      result.errors.push("[" + fileInfo.name + "] " + e.message);
    }
    processed++;
    _pea_saveResumeState_(state); // 진행 상황 저장(중단 대비)
  }

  // ── 미완료: 남은 업체 있으면 재개 예약 후 반환 ──
  if (state.queue.length > 0) {
    _pea_saveResumeState_(state);
    _pea_scheduleResume_(60 * 1000);
    Logger.log("[PEA] 배치 중단 — 남은 " + state.queue.length + "개 업체, 1분 후 자동 재개");
    result.incomplete = true;
    result.remaining = state.queue.length;
    return result;
  }

  // UID 초기화 (소스 탭)
  try {
    var srcSS  = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
    var srcTab = null;
    var srcSheets = srcSS.getSheets();
    for (var si = 0; si < srcSheets.length; si++) {
      if (srcSheets[si].getSheetId() === _PEP_SOURCE_TAB_GID) { srcTab = srcSheets[si]; break; }
    }
    if (!srcTab) srcTab = srcSS.getSheetByName(_pep_getSourceTabName_());
    if (srcTab && srcTab.getLastRow() >= 2) {
      var hdr = srcTab.getRange(1, 1, 1, srcTab.getLastColumn()).getValues()[0];
      var uidCol = -1;
      for (var hi = 0; hi < hdr.length; hi++) {
        var hn = String(hdr[hi] || "").replace(/\s/g, "").toLowerCase();
        if (hn === "협력push" || hn === "pep_uid") { uidCol = hi; break; }
      }
      if (uidCol !== -1) {
        var srcLr    = srcTab.getLastRow();
        var uidVals  = srcTab.getRange(2, uidCol + 1, srcLr - 1, 1).getValues();
        var cleared  = 0;
        var blankArr = uidVals.map(function(r) {
          if (String(r[0] || "").trim()) { cleared++; return [""]; }
          return r;
        });
        srcTab.getRange(2, uidCol + 1, srcLr - 1, 1).setValues(blankArr);
        result.uidCleared = cleared;
        SpreadsheetApp.flush();
      }
    }
  } catch (eUid) {
    result.errors.push("[UID초기화] " + eUid.message);
  }

  // ★ 2026-07-17 (H4): 허브 정리 — 이번 마감에서 이동된 전용양식 UID 매칭 행만 삭제
  //   (기존 "송장 있는 행 전부 삭제"는 대리판매 미마감 건까지 지워 폐기)
  try {
    state.hubCleared = _pea_clearHubRowsByUids_(state.archivedUids || {});
  } catch (eHubClear) {
    result.errors.push("[발주허브정리] " + eHubClear.message);
  }

  // ── 전체 완료 → 상태 정리 + 완료 알림 ──
  result.incomplete = false;
  _pea_saveFinalSummary_(result);
  _pea_clearResumeState_();
  if (silent) {
    try {
      _chat_sendCard_("✅ 대리공급 마감 완료",
        Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
        [
          { label: "이동", value: result.moved + "행" },
          { label: "⚠ 송장없음 강제이동", value: (result.staleMoved || 0) + "행" },
          { label: "잔류", value: result.kept + "행" },
          { label: "처리 탭", value: result.tabsCleared + "개" },
          { label: "UID 초기화", value: result.uidCleared + "건" },
          { label: "📋 임시기록", value: "삭제 " + (result.tempCleared||0) + " / 유지 " + (result.tempKept||0) },
          { label: "💾 스냅샷", value: result.tempSnapshot || "없음" },
          { label: "⚠ 오류", value: result.errors.length + "건" }
        ]);
    } catch(_) {}
  }
  return result;
}

/**
 * ★ 2026-07-17 (H4): 허브에서 지정 UID(고유ID, C열) 매칭 행만 삭제
 * @param {Object} uidMap - { 정규화UID: true } (전용양식 AX열 기준)
 * @returns {number} 삭제된 행 수
 */
function _pea_clearHubRowsByUids_(uidMap) {
  var uidCount = 0;
  for (var k in uidMap) { uidCount++; break; }
  if (!uidCount) return 0;

  var hubSS = SpreadsheetApp.openById(_PT.HUB_ID);
  var hubTab = hubSS.getSheetByName("협력업체_발주허브");
  if (!hubTab || hubTab.getLastRow() < 2) return 0;

  var hubLr = hubTab.getLastRow();
  var hubLc = hubTab.getLastColumn();
  var hubData = hubTab.getRange(2, 1, hubLr - 1, hubLc).getValues();
  var keepHub = [];
  var removed = 0;
  for (var hr = 0; hr < hubData.length; hr++) {
    var hubUid = String(hubData[hr][2] || "").replace(/\s/g, ""); // C열=고유ID
    var norm = hubUid;
    try { norm = String(_pep_normalizeAxUid_(hubUid) || "").replace(/\s/g, ""); } catch (_) {}
    if (hubUid && (uidMap[hubUid] || uidMap[norm])) {
      removed++;
    } else {
      keepHub.push(hubData[hr]);
    }
  }
  if (removed > 0) {
    // ★ 2026-07-24: 값+서식 동시 제거
    _pt_clearContentAndFormat_(hubTab.getRange(2, 1, hubLr - 1, hubLc));
    if (keepHub.length > 0) {
      hubTab.getRange(2, 1, keepHub.length, hubLc).setValues(keepHub);
    }
    SpreadsheetApp.flush();
    Logger.log("[PEA] 발주허브 UID 매칭 정리: 삭제=" + removed + "건, 유지=" + keepHub.length + "건");
  }
  return removed;
}

// ══════════════════════════════════════════════
//  ★ 2026-07-16: 연속 실행(continuation) 인프라
// ══════════════════════════════════════════════

/** 재개/시작 트리거 핸들러 — 저장 상태 재개 또는 대기 중 신규 시작 처리
 *  ScriptLock은 짧게만 사용 → 마감 중 다른 메뉴 장시간 차단 방지. */
function _pea_continueResume_() {
  _pea_deleteResumeTriggers_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log("[PEA_RESUME] Lock 실패 → 재예약");
    _pea_scheduleResume_(60 * 1000);
    return;
  }
  var props = PropertiesService.getScriptProperties();
  var running = props.getProperty("_PEA_BATCH_RUNNING_");
  if (running && (Date.now() - Number(running)) < 6 * 60 * 1000) {
    lock.releaseLock();
    Logger.log("[PEA_RESUME] 이미 배치 실행 중 → 스킵");
    return;
  }
  props.setProperty("_PEA_BATCH_RUNNING_", String(Date.now()));
  lock.releaseLock();

  try {
    var state = _pea_loadResumeState_();
    if (state && state.queue) {
      _pea_core_(null, true);
    } else {
      var pending = props.getProperty(_PEA_PENDING_KEY_);
      if (pending) {
        try { props.deleteProperty(_PEA_PENDING_KEY_); } catch (_) {}
        _pea_core_(pending, true);
      }
    }
  } catch (e) {
    try { Logger.log("[PEA_RESUME_ERR] " + String(e.message || e)); } catch (_) {}
  } finally {
    try { props.deleteProperty("_PEA_BATCH_RUNNING_"); } catch (_) {}
  }
}

function _pea_saveResumeState_(state) {
  try { PropertiesService.getScriptProperties().setProperty(_PEA_RESUME_KEY_, JSON.stringify(state)); }
  catch(e) { Logger.log("[PEA] 상태 저장 실패: " + e.message); }
}
function _pea_loadResumeState_() {
  try {
    var s = PropertiesService.getScriptProperties().getProperty(_PEA_RESUME_KEY_);
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
}
function _pea_clearResumeState_() {
  try { PropertiesService.getScriptProperties().deleteProperty(_PEA_RESUME_KEY_); } catch(e) {}
  _pea_deleteResumeTriggers_();
}
function _pea_saveFinalSummary_(result) {
  try { PropertiesService.getScriptProperties().setProperty(_PEA_RESUME_KEY_ + "_FINAL", JSON.stringify(result)); } catch(e) {}
}
function _pea_scheduleResume_(delayMs) {
  _pea_deleteResumeTriggers_(); // 중복 방지 (안전망 트리거 포함 교체)
  try {
    ScriptApp.newTrigger(_PEA_RESUME_TRIGGER_).timeBased().after(delayMs || 60 * 1000).create();
    return true;
  } catch(e) { Logger.log("[PEA] 재개 트리거 생성 실패: " + e.message); return false; }
}
function _pea_deleteResumeTriggers_() {
  try {
    var trs = ScriptApp.getProjectTriggers();
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].getHandlerFunction() === _PEA_RESUME_TRIGGER_) {
        try { ScriptApp.deleteTrigger(trs[i]); } catch(_) {}
      }
    }
  } catch(e) {}
}

// ══════════════════════════════════════════════
//  헬퍼
// ══════════════════════════════════════════════

/**
 * ★ 2026-06-18: 단일 파일 전용마감 처리 (일괄 마감 통합 루프에서 호출)
 * @param {Spreadsheet} ss - 이미 열린 스프레드시트 객체
 * @param {string} tabName - 마감 탭 이름 (예: "(2026년 6월) 전용발주 마감")
 * @returns {{ moved: number, kept: number }}
 */
function _pea_processOneFile_(ss, tabName) {
  var result = { moved: 0, kept: 0 };
  var tabs = ss.getSheets();

  for (var ti = 0; ti < tabs.length; ti++) {
    var tabSheet = tabs[ti];
    if (tabSheet.getName().indexOf("전용양식") === -1) continue;

    var lr = tabSheet.getLastRow();
    if (lr < 2) continue;

    var lc      = tabSheet.getLastColumn();
    var headers = tabSheet.getRange(1, 1, 1, lc).getValues()[0];
    var data    = tabSheet.getRange(2, 1, lr - 1, lc).getValues();

    var today = new Date();
    today.setHours(23, 59, 59, 999);
    var todayNum = today.getFullYear() * 10000 +
                   (today.getMonth() + 1) * 100 +
                   today.getDate();

    var cutoffNum   = _pea_cutoffNum_(_PEA_FORCE_MOVE_DAYS_);
    var dateColIdxs = _pea_dateColIdxs_(headers);

    var archiveRows = [];
    var keepRowIdxs = [];

    for (var di = 0; di < data.length; di++) {
      if (_pea_decideRow_(data[di], dateColIdxs, todayNum, cutoffNum).move) {
        archiveRows.push(data[di]);
      } else {
        keepRowIdxs.push(di);
      }
    }

    if (archiveRows.length === 0) continue;

    var archTab = ss.getSheetByName(tabName);
    if (!archTab) {
      var byKey = _pea_findTabByKey_(ss, _PEA_KEY_PREFIX + tabName);
      archTab   = byKey || ss.insertSheet(tabName);
    }

    var isNew = archTab.getLastRow() < 1;
    if (isNew) {
      _pea_initArchiveTab_(archTab, headers, lc);
    }

    var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var appendRows = archiveRows.map(function(row) {
      return [nowStr].concat(row);
    });
    var extHeaders = ["이동일시"].concat(headers);
    var extLc      = extHeaders.length;

    var maxCol = archTab.getMaxColumns();
    if (maxCol < extLc) {
      archTab.insertColumnsAfter(maxCol, extLc - maxCol);
    }
    archTab.getRange(1, 1, 1, extLc).setValues([extHeaders])
      .setBackground(_PEA_HEADER_BG).setFontColor("white")
      .setFontWeight("bold").setHorizontalAlignment("center");
    archTab.setFrozenRows(1);

    var curMax = archTab.getMaxColumns();
    if (curMax > extLc) {
      archTab.getRange(1, extLc + 1, 1, curMax - extLc).clearContent().setBackground("#ffffff");
    }

    var nextRow = archTab.getLastRow() + 1;
    if (nextRow < 2) nextRow = 2;
    archTab.getRange(nextRow, 1, appendRows.length, extLc).setValues(appendRows);

    _pea_setKey_(archTab, _PEA_KEY_PREFIX + tabName);

    // ★ 2026-06-22: 안전장치 — 마감탭 기록 성공 확인 후에만 원본 삭제
    SpreadsheetApp.flush();
    var verifyLastRow = archTab.getLastRow();
    var expectedLastRow = nextRow + appendRows.length - 1;
    if (verifyLastRow < expectedLastRow) {
      // 마감탭 기록 검증 실패 → 원본 보존 (데이터 소실 방지)
      continue;
    }

    // ★ try/catch 감싸 → 실패 시 메모리의 원본 data[] 배열로 전체 복구
    try {
      if (keepRowIdxs.length === 0) {
        _pt_clearContentAndFormat_(tabSheet.getRange(2, 1, lr - 1, lc));
      } else {
        // ★ 잔류 데이터를 clear 전에 미리 구성
        var keepRowsData = [];
        for (var ki = 0; ki < keepRowIdxs.length; ki++) {
          keepRowsData.push(data[keepRowIdxs[ki]]);
        }
        _pt_clearContentAndFormat_(tabSheet.getRange(2, 1, lr - 1, lc));
        if (keepRowsData.length > 0) {
          tabSheet.getRange(2, 1, keepRowsData.length, lc).setValues(keepRowsData);
        }
        SpreadsheetApp.flush();

        // ★ 잔류 행 복원 검증
        var restoredCount = tabSheet.getLastRow() - 1;
        if (restoredCount < keepRowsData.length) {
          _pt_clearContentAndFormat_(tabSheet.getRange(2, 1, lr - 1, lc));
          tabSheet.getRange(2, 1, data.length, lc).setValues(data);
          SpreadsheetApp.flush();
          continue;
        }
      }
    } catch (eClear) {
      // ★ clear 후 setValues 실패 → 원본 전체 복구
      try {
        _pt_clearContentAndFormat_(tabSheet.getRange(2, 1, lr - 1, lc));
        tabSheet.getRange(2, 1, data.length, lc).setValues(data);
        SpreadsheetApp.flush();
      } catch (eRestore) {}
      continue;
    }

    result.moved += archiveRows.length;
    result.kept  += keepRowIdxs.length;
    SpreadsheetApp.flush();

    // ★ 2026-07-04: DB 동기화 — 전용양식 마감 상세
    try {
      // 업체명 추출
      var _vn_ = "";
      try {
        var _st_ = ss.getSheetByName("설정");
        if (_st_) _vn_ = String(_st_.getRange("B5").getValue() || "").trim();
      } catch(_) {}
      if (!_vn_) _vn_ = ss.getName().replace("[협력업체] ", "");

      // 마감 탭 이름에서 정산월 추출: "(2026년 7월) 전용 마감" → "2026-07"
      var _smM_ = tabName.match(/\((\d{4})년\s*(\d{1,2})월\)/);
      var _sm_ = _smM_ ? _smM_[1] + "-" + String(_smM_[2]).padStart(2, "0") : "";

      if (_sm_ && archiveRows.length > 0) {
        // 헤더 기반 열 인덱스 매핑
        var _colMap_ = {};
        for (var _ci_ = 0; _ci_ < headers.length; _ci_++) {
          _colMap_[String(headers[_ci_]).trim()] = _ci_;
        }
        var _getC_ = function(names) {
          for (var _ni_ = 0; _ni_ < names.length; _ni_++) {
            if (_colMap_[names[_ni_]] !== undefined) return _colMap_[names[_ni_]];
          }
          return -1;
        };

        var _dbRows_ = archiveRows.map(function(row) {
          return {
            unique_id: null,
            push_date: String(row[1] || "").trim() || null,  // B열: 날짜
            ecount_code: String(row[_getC_(["품목코드", "코드"]) >= 0 ? _getC_(["품목코드", "코드"]) : 2] || "").trim(),
            item_name: String(row[_getC_(["품목명"]) >= 0 ? _getC_(["품목명"]) : 3] || "").trim(),
            qty: parseInt(row[_getC_(["수량"]) >= 0 ? _getC_(["수량"]) : 4]) || 1,
            recipient: String(row[_getC_(["수취인명", "수령인", "수취인"]) >= 0 ? _getC_(["수취인명", "수령인", "수취인"]) : 5] || "").trim(),
            phone: String(row[_getC_(["전화번호", "수령인연락처", "연락처"]) >= 0 ? _getC_(["전화번호", "수령인연락처", "연락처"]) : 6] || "").trim(),
            address: String(row[_getC_(["주소", "배송지주소"]) >= 0 ? _getC_(["주소", "배송지주소"]) : 7] || "").trim(),
            delivery_msg: String(row[_getC_(["배송메시지", "적요"]) >= 0 ? _getC_(["배송메시지", "적요"]) : 8] || "").trim(),
            invoice_no: String(row[0] || "").trim() || null,  // A열: 송장번호
            unit_price: parseFloat(row[_getC_(["단가"]) >= 0 ? _getC_(["단가"]) : 9]) || 0,
            settle_amount: parseFloat(row[_getC_(["금액", "금액1"]) >= 0 ? _getC_(["금액", "금액1"]) : 10]) || 0,
            shipping_fee: 0,
            note: null,
            status: "마감완료"
          };
        });
        _sb_syncExclusiveSettle_(_vn_, _sm_, _dbRows_);
      }
    } catch (eDb) {
      Logger.log("[SB] 대리공급 마감 DB 동기화 오류: " + eDb.message);
    }
  }

  return result;
}

function _pea_initArchiveTab_(tab, headers, lc) {
  // 빈 탭 초기 설정 (나중에 헤더 덮어씌워질 예정)
  try { tab.setFrozenRows(1); } catch(e) {}
}

// ★ 2026-06-13 통합: 공통 _pt_setTabKey_/_pt_findTabByKey_ 위임 래퍼
function _pea_setKey_(tab, key) {
  _pt_setTabKey_(tab, key, _PEA_KEY_CELL);
}

function _pea_findTabByKey_(ss, key) {
  return _pt_findTabByKey_(ss, key, _PEA_KEY_CELL);
}

// ══════════════════════════════════════════════
//  AS 툴: 기존 모든 "전용발주 마감" 탭 헤더 동기화
// ══════════════════════════════════════════════
function partnerRepairExclusiveArchiveHeaders() {
  var ui = SpreadsheetApp.getUi();
  var cf = ui.alert(
    "🔧 마감탭 헤더 일괄 보정",
    "모든 협력업체 파일의 '전용발주 마감' 탭 헤더를 현재 '전용양식' 탭과 동일하게 맞춥니다.\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (cf !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var fixed = 0, skipped = 0, errors = [];

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      
      var formTab = typeof _pep_findExclusiveFormTab_ === "function" ? _pep_findExclusiveFormTab_(ss) : null;
      if (!formTab) {
        // Fallback if _pep_findExclusiveFormTab_ is not found
        var sheets = ss.getSheets();
        for (var idx = 0; idx < sheets.length; idx++) {
          if (sheets[idx].getName().indexOf("전용양식") !== -1) {
            formTab = sheets[idx];
            break;
          }
        }
      }
      if (!formTab) { skipped++; continue; }
      
      var lc = formTab.getLastColumn();
      if (lc < 1) { skipped++; continue; }
      var headers = formTab.getRange(1, 1, 1, lc).getValues()[0];
      var extHeaders = ["이동일시"].concat(headers);
      var extLc = extHeaders.length;

      var tabs = ss.getSheets();
      var tabFixed = false;
      for (var ti = 0; ti < tabs.length; ti++) {
        var archTab = tabs[ti];
        if (archTab.getName().indexOf(_PEA_TAB_SUFFIX) === -1) continue;

        var maxCol = archTab.getMaxColumns();
        if (maxCol < extLc) {
          archTab.insertColumnsAfter(maxCol, extLc - maxCol);
        }
        archTab.getRange(1, 1, 1, extLc).setValues([extHeaders])
          .setBackground(_PEA_HEADER_BG).setFontColor("white")
          .setFontWeight("bold").setHorizontalAlignment("center");
        archTab.setFrozenRows(1);
        
        var curMax = archTab.getMaxColumns();
        if (curMax > extLc) {
          archTab.getRange(1, extLc + 1, 1, curMax - extLc).clearContent().setBackground("#ffffff");
        }
        tabFixed = true;
      }
      if (tabFixed) {
        fixed++;
        SpreadsheetApp.flush();
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push("[" + files[fi].name + "] " + e.message);
    }
  }

  ui.alert(
    "✅ 마감탭 헤더 보정 완료\n수정: " + fixed + "파일 / 스킵: " + skipped + "파일\n" +
    (errors.length > 0 ? "\n⚠ 오류:\n" + errors.slice(0, 5).join("\n") : "")
  );
}

// ══════════════════════════════════════════════
//  미리보기: 마감 이동 전 이동/잔류 예상 건수 스캔
// ══════════════════════════════════════════════
function _pea_preview_(tabName) {
  var result = { moveCount: 0, keepCount: 0, tabCount: 0, staleCount: 0 };
  var files = _pt_listFiles();
  var today = new Date();
  today.setHours(23, 59, 59, 999);
  var todayNum = today.getFullYear() * 10000 +
                 (today.getMonth() + 1) * 100 +
                 today.getDate();
  var cutoffNum = _pea_cutoffNum_(_PEA_FORCE_MOVE_DAYS_);

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var tabs = ss.getSheets();
      for (var ti = 0; ti < tabs.length; ti++) {
        if (tabs[ti].getName().indexOf("전용양식") === -1) continue;
        var lr = tabs[ti].getLastRow();
        if (lr < 2) continue;
        result.tabCount++;
        var lc = Math.max(tabs[ti].getLastColumn(), 2);
        var dateColIdxs = _pea_dateColIdxs_(tabs[ti].getRange(1, 1, 1, lc).getValues()[0]);
        var data = tabs[ti].getRange(2, 1, lr - 1, lc).getValues();
        for (var di = 0; di < data.length; di++) {
          var decision = _pea_decideRow_(data[di], dateColIdxs, todayNum, cutoffNum);
          if (decision.move) {
            result.moveCount++;
            if (decision.reason === "stale") result.staleCount++;
          } else {
            result.keepCount++;
          }
        }
      }
    } catch (e) {}
  }
  return result;
}

// ══════════════════════════════════════════════
//  AS 도구: 전용양식 AX열(UID) 누락 진단
//  데이터가 있지만 AX열(50번째)이 비어있는 행을 업체별 집계
// ══════════════════════════════════════════════
function partnerDiagnoseExclusiveUid() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  var results = [];
  var totalData = 0, totalMissing = 0;

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var tabs = ss.getSheets();
      for (var ti = 0; ti < tabs.length; ti++) {
        if (tabs[ti].getName().indexOf("전용양식") === -1) continue;
        var lr = tabs[ti].getLastRow();
        if (lr < 2) continue;
        var maxC = tabs[ti].getMaxColumns();
        if (maxC < 50) { continue; } // AX열 없음
        var data = tabs[ti].getRange(2, 1, lr - 1, 50).getValues();
        var dataRows = 0, missing = 0;
        for (var di = 0; di < data.length; di++) {
          // 데이터 행 판별: D열(3) 또는 E열(4)에 값이 있으면 데이터 행
          var hasData = String(data[di][3] || "").trim() || String(data[di][4] || "").trim();
          if (!hasData) continue;
          dataRows++;
          var axVal = String(data[di][49] || "").trim();
          if (!axVal) missing++;
        }
        totalData += dataRows;
        totalMissing += missing;
        var pfx = files[fi].name.replace("[협력업체] ", "").replace(/\s*\(소비자용\).*$/, "").trim();
        results.push({ name: pfx, dataRows: dataRows, missing: missing });
      }
    } catch (e) {}
  }

  // HTML 팝업
  var html = '<div style="font-family:\'Segoe UI\',sans-serif;padding:16px;">';
  html += '<h2 style="margin:0 0 12px;color:#1a73e8;">🔍 전용양식 AX열(UID) 진단</h2>';
  html += '<div style="background:' + (totalMissing > 0 ? '#fff3e0' : '#e8f5e9') + ';border-radius:8px;padding:12px;margin-bottom:12px;">';
  html += '전체 데이터: <b>' + totalData + '</b>행 / UID 누락: <b style="color:' + (totalMissing > 0 ? '#e65100' : '#2e7d32') + ';">' + totalMissing + '</b>행</div>';

  html += '<table style="width:100%;border-collapse:collapse;">';
  html += '<tr style="background:#1f4e78;color:#fff;"><th style="padding:6px 10px;text-align:left;">업체</th>';
  html += '<th style="padding:6px 10px;text-align:right;">데이터</th>';
  html += '<th style="padding:6px 10px;text-align:right;">UID누락</th>';
  html += '<th style="padding:6px 10px;text-align:right;">상태</th></tr>';
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    var bg = ri % 2 === 0 ? '#f5f5f5' : '#ffffff';
    var statusIcon = r.missing === 0 ? '✅' : '⚠️';
    html += '<tr style="background:' + bg + ';">';
    html += '<td style="padding:5px 10px;">' + r.name + '</td>';
    html += '<td style="padding:5px 10px;text-align:right;">' + r.dataRows + '</td>';
    html += '<td style="padding:5px 10px;text-align:right;color:' + (r.missing > 0 ? '#e65100' : '#333') + ';font-weight:bold;">' + r.missing + '</td>';
    html += '<td style="padding:5px 10px;text-align:center;">' + statusIcon + '</td></tr>';
  }
  html += '</table></div>';

  var htmlOut = HtmlService.createHtmlOutput(html).setWidth(550).setHeight(450);
  ui.showModalDialog(htmlOut, "🔍 AX열 UID 진단");
}
