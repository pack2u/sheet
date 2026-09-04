/**
 * ══════════════════════════════════════════════════════════════
 *  일과 체크리스트 — 시각별로 꼭 해야 할 일
 *  파일: csDailyChecklist.gs   표시: home.html 대시보드 하단
 *
 *  예정 시각 10분 전부터 카드가 뜨고, 체크하면 그날은 사라진다.
 *
 *  ★ 팀 공용이다 ★
 *    한 사람이 체크하면 모두에게서 사라진다. 사방넷 세트분리를 두 사람이
 *    각각 할 일은 아니라서, 개인별로 나누면 "누가 했나"를 매번 물어야 한다.
 *
 *  ★ 지난 건도 계속 띄운다 ★
 *    시각이 지났는데 미체크면 숨기지 않고 빨갛게 표시한다.
 *    숨기면 그날 빠뜨린 걸 아무도 모른 채 넘어간다.
 *
 *  ★ 기록은 시트에 ★
 *    스크립트 속성에 넣으면 이력이 안 남는다. 나중에 "그날 3차 세트분리
 *    했나?"를 되짚으려면 누가 언제 체크했는지가 있어야 한다.
 * ══════════════════════════════════════════════════════════════
 */

/** 몇 분 전부터 카드를 띄울지 */
var _CSD_LEAD_MIN_ = 10;

var _CSD_TAB_PREFIX_ = "일과체크_"; // 일과체크_yyyyMM (반품관리대장 안)

var _CSD_HEADERS_ = ["일자", "항목ID", "예정시각", "항목", "체크시각", "체크한사람"];

/**
 * 하루 일과 — 허브(상품정보 시트) `_ALL_SCHEDULED_TRIGGERS_` 와 짝이다.
 * 한쪽만 바꾸면 사람이 확인하는 시각과 시스템이 도는 시각이 어긋난다.
 *
 * ★ 확인 항목은 트리거보다 10분 뒤에 둔다 ★
 *   "푸시 확인"은 트리거가 돌았는지 보는 일이다. 트리거와 같은 시각에
 *   두면 아직 시작 전이거나 도는 중이라 멀쩡한 것도 "안 됐다"로 보인다.
 *   (GAS 시간 트리거는 지정 시각에서 ±15분까지 흔들린다.)
 *
 *      트리거              →  체크 항목        간격
 *   ─────────────────────────────────────────────────
 *      08:00 발주 수집      →  세트분리 1차     09:00
 *      09:20 대리공급 Push  →  푸시 확인 1차    09:30   ← 확인, +10분
 *      13:00 발주 수집      →  세트분리 2차     13:30
 *      13:50 대리공급 Push  →  푸시 확인 2차    14:00   ← 확인, +10분
 *      15:00 발주 수집      →  세트분리 3차     15:20
 *      15:40 대리공급 Push  →  푸시 확인 3차    15:50   ← 확인, +10분
 *      16:00 냅킨 Gmail     →  롯데 송장입력    16:00
 *
 * ★ 세트분리는 "푸시 20분 전"이 상한이다 ★
 *   수집이 끝난 뒤에 해야 하니 늦을수록 좋지만, 대리공급 Push 트리거보다
 *   먼저 끝나야 한다. 안 그러면 분리 안 된 세트가 그대로 푸시된다.
 *   2차는 수집~푸시 사이가 50분, 3차는 40분뿐이라 더는 못 민다.
 *   Push 트리거 시각을 옮기지 않는 한 이 표의 값이 한계다.
 *
 * id 는 기록에 남으므로 바꾸지 말 것 —
 * 바꾸면 지난 기록과 이어지지 않아 "안 한 것"으로 보인다.
 */
var _CSD_TASKS_ = [
  { id: "T0800", h: 9,  m: 0,  label: "사방넷 판매현황 및 세트분리 (1차)" },
  { id: "T0920", h: 9,  m: 30, label: "대리공급 푸시 확인 (1차)" },
  { id: "T1300", h: 13, m: 30, label: "사방넷 판매현황 및 세트분리 (2차)" },
  { id: "T1350", h: 14, m: 0,  label: "대리공급 푸시 확인 (2차)" },
  { id: "T1500", h: 15, m: 20, label: "사방넷 판매현황 및 세트분리 (3차)" },
  { id: "T1540", h: 15, m: 50, label: "대리공급 푸시 확인 (3차)" },
  { id: "T1600", h: 16, m: 0,  label: "롯데택배 전체 송장입력 및 전체 판매현황입력" },
];

// ── 공통 ────────────────────────────────────────────────
function _csd_ymd_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

function _csd_hhmm_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm");
}

/** 자정부터 흐른 분 — 서울 기준. 브라우저 시계가 달라도 여기가 기준이다 */
function _csd_nowMin_() {
  var h = parseInt(Utilities.formatDate(new Date(), "Asia/Seoul", "H"), 10);
  var m = parseInt(Utilities.formatDate(new Date(), "Asia/Seoul", "m"), 10);
  return h * 60 + m;
}

function _csd_due_(t) {
  return ("0" + t.h).slice(-2) + ":" + ("0" + t.m).slice(-2);
}

/** 월별 기록 탭 — 없으면 헤더까지 만들어 반환 */
function _csd_tab_() {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var name = _CSD_TAB_PREFIX_ +
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMM");
  var tab = ss.getSheetByName(name);
  if (!tab) {
    tab = ss.insertSheet(name);
    tab.getRange(1, 1, 1, _CSD_HEADERS_.length)
      .setValues([_CSD_HEADERS_])
      .setBackground("#252525").setFontColor("#f0f0f0")
      .setFontWeight("bold").setHorizontalAlignment("center");
    tab.setFrozenRows(1);
    tab.setColumnWidth(1, 100);
    tab.setColumnWidth(4, 300);
  }
  return tab;
}

/** 오늘 체크된 항목 — { 항목ID: {at, by} } */
function _csd_todayChecks_(tab) {
  var out = {};
  var lr = tab.getLastRow();
  if (lr < 2) return out;
  var vals = tab.getRange(2, 1, lr - 1, _CSD_HEADERS_.length).getDisplayValues();
  var today = _csd_ymd_();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim() !== today) continue;
    var id = String(vals[i][1] || "").trim();
    if (!id) continue;
    out[id] = { at: String(vals[i][4] || "").trim(), by: String(vals[i][5] || "").trim() };
  }
  return out;
}

// ── 조회 ────────────────────────────────────────────────
/**
 * 오늘 일과와 체크 상태.
 * 화면에 띄울지(due-10분 지났는지)는 클라이언트가 nowMin 으로 판단한다.
 * 서버 시계를 같이 넘겨야 브라우저 시간대가 달라도 어긋나지 않는다.
 */
function csListDailyChecks() {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  try {
    var tab = _csd_tab_();
    var checks = _csd_todayChecks_(tab);
    var nowMin = _csd_nowMin_();

    var tasks = [];
    for (var i = 0; i < _CSD_TASKS_.length; i++) {
      var t = _CSD_TASKS_[i];
      var c = checks[t.id];
      tasks.push({
        id: t.id,
        due: _csd_due_(t),
        dueMin: t.h * 60 + t.m,
        label: t.label,
        checked: !!c,
        at: c ? c.at : "",
        by: c ? c.by : ""
      });
    }
    return {
      ok: true, ymd: _csd_ymd_(), now: _csd_hhmm_(),
      nowMin: nowMin, leadMin: _CSD_LEAD_MIN_, tasks: tasks
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 체크 / 해제 ─────────────────────────────────────────
/** 체크 — 같은 날 같은 항목은 한 번만 남는다 */
function csCheckDailyTask(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var id = String(payload.id || "").trim();
  var staff = String(payload.staff || "").trim() || "CS";
  if (!id) return { ok: false, error: "항목이 지정되지 않았습니다." };

  var task = null;
  for (var i = 0; i < _CSD_TASKS_.length; i++) {
    if (_CSD_TASKS_[i].id === id) { task = _CSD_TASKS_[i]; break; }
  }
  if (!task) return { ok: false, error: "모르는 항목입니다: " + id };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) {
    return { ok: false, error: "다른 담당자가 체크 중입니다. 잠시 후 다시 시도하세요." };
  }
  try {
    var tab = _csd_tab_();
    var checks = _csd_todayChecks_(tab);
    if (checks[id]) {
      // 이미 누가 했다 — 덮어쓰지 않고 그대로 알린다
      return { ok: true, already: true, by: checks[id].by, at: checks[id].at,
        message: checks[id].by + " 이미 완료 (" + checks[id].at + ")" };
    }
    tab.appendRow([_csd_ymd_(), id, _csd_due_(task), task.label, _csd_hhmm_(), staff]);
    return { ok: true, already: false, message: "완료 처리했습니다." };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (eL) {}
  }
}

/** 체크 해제 — 잘못 눌렀을 때. 오늘 기록만 지운다 */
function csUncheckDailyTask(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var id = String(payload.id || "").trim();
  if (!id) return { ok: false, error: "항목이 지정되지 않았습니다." };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false, error: "잠시 후 다시 시도하세요." };
  try {
    var tab = _csd_tab_();
    var lr = tab.getLastRow();
    if (lr < 2) return { ok: true, removed: 0 };
    var vals = tab.getRange(2, 1, lr - 1, 2).getDisplayValues();
    var today = _csd_ymd_();
    var removed = 0;
    // 뒤에서부터 지운다 — 앞에서 지우면 행 번호가 밀린다
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0] || "").trim() !== today) continue;
      if (String(vals[i][1] || "").trim() !== id) continue;
      tab.deleteRow(i + 2);
      removed++;
    }
    return { ok: true, removed: removed, message: "체크를 해제했습니다." };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (eL) {}
  }
}

/** 설정 점검 — 스크립트 편집기에서 실행 */
function csDiagnoseDailyChecklist() {
  var out = [];
  try {
    var tab = _csd_tab_();
    out.push("기록 탭: " + tab.getName() + " (" + Math.max(0, tab.getLastRow() - 1) + "행)");
  } catch (e) { out.push("★ 탭 실패: " + e.message); }
  try {
    var r = csListDailyChecks();
    if (!r.ok) { out.push("★ 조회 실패: " + r.error); }
    else {
      out.push("서버 시각: " + r.now + " (" + r.nowMin + "분) · " + r.leadMin + "분 전부터 표시");
      out.push("");
      for (var i = 0; i < r.tasks.length; i++) {
        var t = r.tasks[i];
        var show = r.nowMin >= (t.dueMin - r.leadMin);
        out.push("  " + t.due + "  " + (t.checked ? "✔ " + t.by + " " + t.at : (show ? "표시중" : "대기")) +
          "  " + t.label);
      }
    }
  } catch (e2) { out.push("★ " + e2.message); }
  Logger.log(out.join("\n"));
  return out.join("\n");
}
