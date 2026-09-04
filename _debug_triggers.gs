/**
 * [운영 도구] 트리거 관리 및 고아 트리거 정리
 * - debugTriggers: Push 트리거 정리 및 상태 확인
 * - deleteOrphanTriggers: 삭제된 함수를 참조하는 고아 트리거 탐지 및 삭제
 *
 * ★ 올팩 코드오류 진단용 함수들은 원인 해결(2026-05-29) 후 제거됨
 *   원인: Pack2U 공지팝업/Pack2U 송장매칭 프로젝트의 중복 onEdit
 */

function debugTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var log = "Triggers:\n";
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    log += fn + "\n";
    if (fn === "partnerPushOrdersToExclusiveFormsSilent_" || fn === "_PEP_PUSH_TRIGGER_FUNC") {
      ScriptApp.deleteTrigger(triggers[i]);
      log += " -> Deleted!\n";
    }
  }
  PropertiesService.getScriptProperties().setProperty("PEP_AUTO_PUSH", "OFF");
  log += "Set PEP_AUTO_PUSH to OFF.\n";
  console.log(log);
}

/**
 * ★ 존재하지 않는 함수를 참조하는 고아 트리거 탐지 및 삭제
 *
 * ★ 2026-07-17 (H1): 하드코딩 화이트리스트 폐기 → 자동 생성
 *   1) _ALL_SCHEDULED_TRIGGERS_ 배열(_partnerWebApp.gs)의 모든 fn 자동 포함
 *   2) onOpen/onEdit 이벤트 핸들러 포함
 *   3) 프로젝트에 실제 정의된 함수(globalThis[fn])는 절대 삭제하지 않음
 *   → "함수가 삭제되어 존재하지 않는" 진짜 고아 트리거만 제거
 *
 * 사용법: GAS 편집기에서 이 함수 선택 후 ▶ 실행
 */
function deleteOrphanTriggers() {
  // ── 화이트리스트 자동 생성 ──
  var whitelist = { onOpen: true, onEdit: true };
  try {
    if (typeof _ALL_SCHEDULED_TRIGGERS_ !== "undefined") {
      for (var w = 0; w < _ALL_SCHEDULED_TRIGGERS_.length; w++) {
        whitelist[_ALL_SCHEDULED_TRIGGERS_[w].fn] = true;
      }
    }
  } catch (_) {}

  var triggers = ScriptApp.getProjectTriggers();
  var deleted = [], kept = [];

  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    // 프로젝트에 함수가 실제 정의돼 있으면 고아가 아님 → 유지
    var fnExists = false;
    try { fnExists = typeof globalThis[fn] === "function"; } catch (_) {}
    if (whitelist[fn] || fnExists) {
      kept.push(fn);
    } else {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted.push(fn);
    }
  }

  var msg = "=== 트리거 정리 결과 ===\n";
  msg += "화이트리스트: " + Object.keys(whitelist).length + "개 (스케줄 배열 자동 생성)\n";
  msg += (deleted.length > 0)
    ? "삭제(정의 없는 고아): " + deleted.join(", ") + "\n"
    : "삭제할 고아 트리거 없음\n";
  msg += "유지: " + (kept.length > 0 ? kept.join(", ") : "없음");
  console.log(msg);
  // ★ ui.alert 제거 — 팝업 대기로 6분 타임아웃 발생 방지
  // 결과는 GAS 편집기 실행 로그에서 확인하세요
}

/**
 * ★ 2026-06-23: 중복 이벤트 트리거 정리
 * _pt_onEditSpillGuard_ 가 7개 중복 등록되어 20개 제한 초과 문제 해결
 *
 * 동작:
 *   1) _pt_onEditSpillGuard_ → 1개만 남기고 나머지 삭제
 *   2) _po_onEditVoidInvoiceAutoFill_ → 1개 유지 (이미 1개)
 *   3) 다른 사용자(runMorningSyncStatusBatch, runDailyInventoryAdjustBatch)
 *      → 본인 소유가 아니므로 삭제 불가, 안내만 표시
 *
 * 사용법: GAS 편집기에서 이 함수 선택 후 ▶ 실행
 */
function cleanupDuplicateEventTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  
  // 이벤트 기반 트리거만 핸들러별로 그룹핑
  var eventGroups = {};
  var timeCount = 0;
  
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    var type = triggers[i].getEventType();
    
    if (type === ScriptApp.EventType.CLOCK) {
      timeCount++;
      continue;
    }
    
    // 이벤트 기반
    if (!eventGroups[fn]) eventGroups[fn] = [];
    eventGroups[fn].push(triggers[i]);
  }
  
  var deleted = 0;
  var kept = [];
  var report = [];
  
  for (var fn in eventGroups) {
    var group = eventGroups[fn];
    if (group.length > 1) {
      // 중복! 첫 번째만 유지하고 나머지 삭제
      report.push("🔧 " + fn + ": " + group.length + "개 → 1개 (삭제 " + (group.length - 1) + "개)");
      for (var j = 1; j < group.length; j++) {
        try {
          ScriptApp.deleteTrigger(group[j]);
          deleted++;
        } catch (e) {
          report.push("  ⚠ 삭제 실패: " + e.message);
        }
      }
      kept.push(fn);
    } else {
      report.push("✅ " + fn + ": 1개 (정상)");
      kept.push(fn);
    }
  }
  
  var msg = "═══ 이벤트 트리거 정리 결과 ═══\n" +
    report.join("\n") +
    "\n\n시간 기반: " + timeCount + "개 (변경 없음)" +
    "\n이벤트 기반: " + kept.length + "개 유지" +
    "\n중복 삭제: " + deleted + "개" +
    "\n\n총합: " + (timeCount + kept.length) + " / 20개 제한";
  
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert("🔧 트리거 정리", msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
}

/**
 * ══════════════════════════════════════════════════════════════
 *  설치된 트리거 점검 — 읽기 전용. 아무것도 지우지 않는다.
 *  파일: _debug_triggers.gs
 *
 *  ★ 위의 debugTriggers() 와 헷갈리지 말 것 ★
 *    그 함수는 이름과 달리 대리공급 푸시 트리거를 삭제하고
 *    PEP_AUTO_PUSH 를 OFF 로 바꾼다. 점검용이 아니다.
 *
 *  _ALL_SCHEDULED_TRIGGERS_(_partnerWebApp.gs) 와 대조해
 *  빠진 것 · 시각이 다른 것 · 목록에 없는 것을 보여준다.
 * ══════════════════════════════════════════════════════════════
 */
function triggerListSafe() {
  var L = [];
  var live = ScriptApp.getProjectTriggers();

  // 설치된 시간 트리거 수집
  var installed = {};
  var other = [];
  for (var i = 0; i < live.length; i++) {
    var t = live[i];
    var fn = t.getHandlerFunction();
    if (String(t.getEventType()) !== "CLOCK") { other.push(fn + " (" + t.getEventType() + ")"); continue; }
    (installed[fn] = installed[fn] || []).push(t.getUniqueId());
  }

  L.push("═══ 트리거 점검 (읽기 전용) ═══");
  L.push("실행: " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"));
  L.push("시간 트리거 " + (live.length - other.length) + "개 / 이벤트 " + other.length + "개 / 한도 20개");
  L.push("");

  // 기대 목록과 대조. 시각은 GAS API로 못 읽으므로 설치 여부만 본다.
  var expect = (typeof _ALL_SCHEDULED_TRIGGERS_ !== "undefined") ? _ALL_SCHEDULED_TRIGGERS_ : [];
  var missing = [];
  L.push("── 예정 일정 (_partnerWebApp.gs) ──");
  for (var e = 0; e < expect.length; e++) {
    var x = expect[e];
    var hhmm = ("0" + x.h).slice(-2) + ":" + ("0" + x.m).slice(-2);
    var n = installed[x.fn] ? installed[x.fn].length : 0;
    if (!n) missing.push(hhmm + " " + x.label + "  [" + x.fn + "]");
    L.push("  " + (n ? (n > 1 ? "▲x" + n : "✔") : "★ 없음") + "  " + hhmm + "  " + x.label);
  }

  // 목록에 없는데 설치된 것
  var known = {};
  for (var k = 0; k < expect.length; k++) known[expect[k].fn] = true;
  var extra = [];
  for (var f in installed) if (!known[f]) extra.push(f + " x" + installed[f].length);

  L.push("");
  if (missing.length) {
    L.push("★ 설치 안 된 일정 " + missing.length + "개:");
    for (var m = 0; m < missing.length; m++) L.push("    " + missing[m]);
    L.push("  → 메뉴 [⏰ 통합 자동 트리거 설치 (전체)] 를 실행하세요.");
  } else {
    L.push("✔ 예정 일정이 모두 설치되어 있습니다.");
  }
  if (extra.length) {
    L.push("");
    L.push("목록에 없는 시간 트리거 " + extra.length + "개 (수동 설치분일 수 있음):");
    for (var x2 = 0; x2 < extra.length; x2++) L.push("    " + extra[x2]);
  }
  if (other.length) {
    L.push("");
    L.push("이벤트 트리거: " + other.join(", "));
  }

  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("트리거 점검", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}
