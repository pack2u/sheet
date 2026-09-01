/**
 * ══════════════════════════════════════════════════════════════
 *  통합조회 행 손실 진단 — 어디서 몇 건이 사라지는지 단계별로 잰다
 *  파일: _puvDiagnoseRowLoss.gs
 *
 *  증상: 어제 일일마감은 800건대인데 CS 웹앱 색인은 131건.
 *        CS는 통합조회 탭 하나만 읽으므로, 잃는 지점은
 *        "일일마감 파일 → 수집 → 중복제거 → 기록" 사이 어딘가다.
 *
 *  이 진단은 고치지 않는다. 재기만 한다.
 *  스크립트 편집기에서 puvDiagnoseRowLoss() 실행 → 로그 확인.
 * ══════════════════════════════════════════════════════════════
 */

function puvDiagnoseRowLoss() {
  var L = [];
  function say(s) { L.push(s); }

  say("═══ 통합조회 행 손실 진단 ═══");
  say("실행: " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"));
  say("");

  // ── 1. 통합조회 탭 현황 ─────────────────────────────
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PUV_TAB_NAME_);
  if (!tab) {
    say("★ 통합조회 탭이 없습니다: " + _PUV_TAB_NAME_);
  } else {
    var lr = tab.getLastRow();
    say("[1] 통합조회 탭: " + Math.max(0, lr - 1) + "행");
    if (lr > 1) {
      var uvDate = tab.getRange(2, 1, lr - 1, 1).getDisplayValues();
      var uvUpd = tab.getRange(2, 18, lr - 1, 1).getDisplayValues();
      var byDate = {};
      for (var i = 0; i < uvDate.length; i++) {
        var d = String(uvDate[i][0] || "(빈칸)").trim() || "(빈칸)";
        byDate[d] = (byDate[d] || 0) + 1;
      }
      var keys = Object.keys(byDate).sort().reverse();
      say("    갱신일시(첫 행): " + String(uvUpd[0][0] || "(없음)"));
      say("    날짜별 건수:");
      for (var k = 0; k < Math.min(keys.length, 20); k++) {
        say("      " + keys[k] + "  " + byDate[keys[k]] + "건");
      }
      if (keys.length > 20) say("      … 외 " + (keys.length - 20) + "개 날짜");
    }
  }
  say("");

  // ── 2. 어제 일일마감 파일 단독 분석 ──────────────────
  var y = new Date();
  y.setDate(y.getDate() - 1);
  var yStr = Utilities.formatDate(y, "Asia/Seoul", "yyyy-MM-dd");
  say("[2] 어제(" + yStr + ") 일일마감 파일");

  var dailySs = null;
  try {
    dailySs = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + yStr + ")");
  } catch (e) {
    say("    ★ 파일 찾기 실패: " + e.message);
  }

  if (!dailySs) {
    say("    ★ 파일을 못 찾았습니다 — 이것만으로도 원인입니다.");
  } else {
    var dTab = dailySs.getSheetByName("일일마감") || dailySs.getSheets()[0];
    var all = dTab.getRange(1, 1, dTab.getLastRow(),
      Math.max(dTab.getLastColumn(), 2)).getDisplayValues();
    say("    파일: " + dailySs.getName() + " / 탭: " + dTab.getName());
    say("    원본 행(헤더 제외): " + (all.length - 1) + "행");

    var c = _puv_mapDailyCols_(all[0]);
    say("    열 매핑:");
    var names = ["date", "oid", "name", "item", "qty", "inv", "phone", "vendor", "src"];
    for (var n = 0; n < names.length; n++) {
      var idx = c[names[n]];
      say("      " + names[n] + " = " + (idx >= 0 ? idx + " (" + all[0][idx] + ")" : "★ 없음"));
    }

    // 수집 필터 통과 → 중복제거 키 분포
    var passed = 0, skippedSum = 0, skippedEmpty = 0;
    var keyCount = {};
    var collapsed = [];
    for (var r = 1; r < all.length; r++) {
      if (String(all[r][0] || "").indexOf("합계") !== -1) { skippedSum++; continue; }
      var row = all[r];
      var nm = _puv_pick_(row, c.name);
      var it = _puv_pick_(row, c.item);
      var oid = _puv_pick_(row, c.oid);
      if (!nm && !it && !oid) { skippedEmpty++; continue; }
      passed++;
      var o = {
        date: _puv_pick_(row, c.date) || yStr,
        oid: oid, name: nm, item: it, phone: _puv_pick_(row, c.phone)
      };
      var key = _puv_dedupKey_(o);
      if (keyCount[key]) {
        keyCount[key]++;
        if (collapsed.length < 12) collapsed.push(key);
      } else {
        keyCount[key] = 1;
      }
    }
    var distinct = Object.keys(keyCount).length;
    say("");
    say("    합계행 제외:     " + skippedSum + "건");
    say("    빈행 제외:       " + skippedEmpty + "건");
    say("    수집 통과:       " + passed + "건");
    say("    중복제거 후:     " + distinct + "건");
    say("    ★ 중복제거로 사라짐: " + (passed - distinct) + "건");
    if (collapsed.length) {
      say("    겹친 키 예시:");
      for (var cc = 0; cc < collapsed.length; cc++) {
        say("      [" + keyCount[collapsed[cc]] + "건] " + collapsed[cc]);
      }
    }
  }
  say("");

  // ── 3. 전체 수집 시뮬레이션 (실제 재생성과 같은 경로) ──
  say("[3] 15일치 수집 시뮬레이션 (기록은 하지 않음)");
  var started = new Date().getTime();
  var stat = {
    lotte: 0, weekly: 0, temp: 0, hub: 0, ledger: 0, keys: 0,
    daily: 0, snapshot: 0, hubRows: 0, tempRows: 0,
    rows: 0, matched: 0, unmatched: 0, byPath: {}, timedOut: false, errors: []
  };
  var orders = [];
  try {
    _puv_collectDaily_(orders, stat, started);
    say("    일일마감 수집: " + stat.daily + "건 (" +
      Math.round((new Date().getTime() - started) / 1000) + "초)" +
      (stat.timedOut ? "  ★ 시간초과로 중단" : ""));

    var beforeSnap = orders.length;
    _puv_collectSnapshot_(orders, stat);
    say("    판매현황_임시기록: +" + (orders.length - beforeSnap) + "건");

    var fromDt = new Date();
    fromDt.setDate(fromDt.getDate() - _PUV_DAYS_);
    var fromDate = Utilities.formatDate(fromDt, "Asia/Seoul", "yyyy-MM-dd");

    var beforeHub = orders.length;
    _puv_collectHub_(orders, stat, fromDate);
    say("    허브: +" + (orders.length - beforeHub) + "건");

    var beforeTemp = orders.length;
    _puv_collectTemp_(orders, stat, fromDate);
    say("    임시기록: +" + (orders.length - beforeTemp) + "건");

    say("    ─────────────────────────");
    say("    수집 합계: " + orders.length + "건");

    var best = {}, order = [];
    for (var q = 0; q < orders.length; q++) {
      var key2 = _puv_dedupKey_(orders[q]);
      if (!best[key2]) { best[key2] = orders[q]; order.push(key2); }
    }
    say("    중복제거 후: " + order.length + "건");
    say("    ★ 중복제거로 사라짐: " + (orders.length - order.length) + "건");
    say("");
    say("    현재 통합조회 탭: " + _puv_existingRowCount_() + "행");
    if (stat.timedOut && _puv_existingRowCount_() > order.length) {
      say("    → 시간초과 + 기존이 더 많음 = 기록 생략됨 (기존 유지)");
    }
    if (stat.errors.length) {
      say("    수집 오류 " + stat.errors.length + "건:");
      for (var e2 = 0; e2 < Math.min(stat.errors.length, 8); e2++) {
        say("      " + stat.errors[e2]);
      }
    }
  } catch (eX) {
    say("    ★ 시뮬레이션 실패: " + eX.message);
  }

  var text = L.join("\n");
  Logger.log(text);
  try {
    SpreadsheetApp.getUi().alert("통합조회 진단", text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (eU) {}
  return text;
}
