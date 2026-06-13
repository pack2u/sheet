/**
 * [협력업체] 유지보수 도구 v1.1
 * 파일: _partnerMaintenance.gs
 *
 * 기능:
 *  1) partnerValidateAllOrderTabHeaders()  — 발주탭 헤더 일괄 검증
 *  2) partnerMigrateK2ToSettings()         — K2 → 설정!B4 이전
 *  3) partnerFixMalformedMonthlyTabs()     — 발주마감 탭 이름 오류 자동 수정
 *
 * 설정 탭 셀 약속:
 *   설정!B4 = K2 (그룹 열 번호) — K2 이전 후 원본
 *
 * ※ 자동모드(C3 IMPORTRANGE) 완전 제거 — 모든 뷰어는 수동 모드 전용
 */

// ═══════════════════════════════════════════
//  공통 유틸
// ═══════════════════════════════════════════
var _PM_SETTINGS_TAB  = "설정";
var _PM_K2_CELL       = "B4";

// ═══════════════════════════════════════════
//  1. 발주탭 헤더 일괄 검증
// ═══════════════════════════════════════════
/**
 * 필수 열(주문일자, 이카운트코드, 수량, 수취인)이 인식되는지 확인.
 * _po_buildColMap 을 사용해 업체별 커스텀 헤더까지 포함하여 검사.
 */
function partnerValidateAllOrderTabHeaders() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files.length) return ui.alert("협력업체 파일 없음");

  var REQ   = ["date","code","qty","recipient"];
  var LABEL = { date:"주문일자", code:"이카운트코드", qty:"수량", recipient:"수취인" };

  var ok = [], warn = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace(_PT.PREFIX,"").trim();
    try {
      var ss  = SpreadsheetApp.openById(f.id);
      var tab = ss.getSheetByName("발주 및 송장조회");
      if (!tab) { warn.push("❌ "+nm+": 탭 없음"); continue; }

      var hdr = tab.getRange(1,1,1,Math.max(tab.getLastColumn(),10)).getValues()[0];
      var map = _po_buildColMap(hdr);
      var missing = REQ.filter(function(k){ return (map[k]===undefined||map[k]===-1); })
                       .map(function(k){ return LABEL[k]; });

      if (missing.length) {
        warn.push("⚠️ "+nm+": ["+missing.join(", ")+"] 미인식");
      } else {
        ok.push("✅ "+nm);
      }
    } catch(e) {
      warn.push("❌ "+nm+": "+String(e.message||"").substring(0,25));
    }
  }

  var msg = "발주탭 헤더 검증 — 총 "+files.length+"개\n\n";
  if (warn.length) msg += "문제 "+warn.length+"건:\n"+warn.join("\n")+"\n\n";
  msg += "정상 "+ok.length+"건:\n"+ok.join("\n");
  ui.alert("📋 발주탭 헤더 검증", msg.substring(0,4500), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  2. K2 → 설정!B4 이전
// ═══════════════════════════════════════════
/**
 * 뷰어탭 K2 (그룹 열 번호)를 설정!B4로 이전하고
 * K2 셀에 =설정!B4 참조 수식을 삽입한다 (흰 글씨로 숨김).
 * 이미 이전된 파일은 스킵.
 */
function partnerMigrateK2ToSettings() {
  var ui = SpreadsheetApp.getUi();
  var conf = ui.alert("K2 → 설정!B4 이전",
    "모든 협력업체 파일의 K2 값을 설정!B4로 이전합니다.\n" +
    "· 이미 이전된 파일은 자동 스킵\n" +
    "· K2 셀 = =설정!B4 수식 (흰 글씨)\n\n진행하시겠습니까?",
    ui.ButtonSet.YES_NO);
  if (conf !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var results = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace(_PT.PREFIX,"").trim();
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var viewer = null;
      try { viewer = _pt_findViewerSheet(ss); } catch(e) {}
      if (!viewer) viewer = ss.getSheetByName("단가조회") || ss.getSheets()[0];
      if (!viewer) { results.push("⚠️ "+nm+": 뷰어탭 없음"); continue; }

      // 이미 이전됐는지 확인
      var k2f = String(viewer.getRange("K2").getFormula()||"");
      if (k2f.indexOf("설정")!==-1 && k2f.indexOf("B4")!==-1) {
        results.push("⏭️ "+nm+": 이미 이전됨");
        continue;
      }

      var K2num = parseInt(viewer.getRange("K2").getValue(), 10);
      if (!K2num || isNaN(K2num)) { results.push("⚠️ "+nm+": K2 없음 (스킵)"); continue; }

      // 설정!B4 에 기록
      var st = ss.getSheetByName(_PM_SETTINGS_TAB);
      if (!st) { results.push("⚠️ "+nm+": 설정 탭 없음"); continue; }
      st.getRange("A4").setValue("단가 그룹 열").setFontColor("#888888").setFontSize(9);
      st.getRange(_PM_K2_CELL).setValue(K2num);

      // K2 → 참조 수식으로 교체 (흰 글씨로 숨김)
      viewer.getRange("K2")
        .setFormula("=설정!B4")
        .setFontColor("white")
        .setBackground("#1a237e");

      results.push("✅ "+nm+": K2="+K2num+" → 설정!B4");
    } catch(e) {
      results.push("❌ "+nm+": "+String(e.message||"").substring(0,30));
    }
  }

  var msg = "K2 → 설정!B4 이전 완료 ("+files.length+"개)\n\n"+results.join("\n");
  ui.alert("K2 이전 결과", msg.substring(0,4500), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  4. 발주마감 탭 잘못된 이름 자동 수정
// ═══════════════════════════════════════════
/**
 * "(YYYY년 M월) 발주 마감" 탭에서 연도가 2000 미만이거나 월이 1~12 범위를 벗어난
 * 잘못된 이름을 자동으로 탐지하고 수정 제안 또는 삭제 선택을 제공한다.
 *
 * 잘못된 예: "(0420년 26월) 발주 마감" → "(2026년 4월) 발주 마감"
 */
function partnerFixMalformedMonthlyTabs() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files.length) return ui.alert("협력업체 파일 없음");

  // "(숫자년 숫자월) 발주 마감" 패턴 파싱
  var PAT = /^\((\d+)년\s*(\d+)월\)\s*발주\s*마감$/;

  var found  = [];  // { file, ss, tabName, sheet, year, month }
  var scanned = 0;

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    try {
      var ss    = SpreadsheetApp.openById(f.id);
      var tabs  = ss.getSheets();
      for (var ti = 0; ti < tabs.length; ti++) {
        var name = tabs[ti].getName();
        var m    = PAT.exec(name);
        if (!m) continue;
        var yr = parseInt(m[1], 10);
        var mo = parseInt(m[2], 10);
        if (yr >= 2000 && yr <= 2099 && mo >= 1 && mo <= 12) continue; // 정상
        // 잘못된 이름 감지
        found.push({
          file: f.name.replace(_PT.PREFIX,"").trim(),
          ss: ss, sheet: tabs[ti], tabName: name, year: yr, month: mo
        });
      }
      scanned++;
    } catch(e) {}
  }

  if (!found.length) {
    return ui.alert("✅ 이상 없음",
      scanned+"개 파일 스캔 완료.\n잘못된 발주마감 탭이 없습니다.", ui.ButtonSet.OK);
  }

  // 탐지 목록 표시 + 수정 방법 결정
  var lines = found.map(function(r,i){
    return (i+1)+") "+r.file+"\n   탭: "+r.tabName+
      "\n   → 연도="+r.year+", 월="+r.month;
  });
  var ans = ui.alert(
    "⚠️ 잘못된 발주마감 탭 "+found.length+"건 발견",
    lines.join("\n\n").substring(0,4000)+"\n\n" +
    "[예] 자동 수정 시도  [아니오] 목록만 확인",
    ui.ButtonSet.YES_NO);

  if (ans !== ui.Button.YES) return;

  // 수정: 올바른 연도/월 추정
  var fixed = [], failed = [];
  for (var fi = 0; fi < found.length; fi++) {
    var r = found[fi];
    // 연도 복구: 4자리이지만 앞뒤 뒤집힌 경우 (예: 0420 → 2040? 아니면 0526→2026)
    // 또는 YYYYMM 이 이상하게 합쳐진 경우
    var fixedYear = r.year, fixedMonth = r.month;

    if (r.year < 2000) {
      // 가장 흔한 케이스: YYMM 형태로 합쳐진 경우 (예: 0420 → year=0420)
      // 첫 두 자리를 월로, 나머지를 연도로 시도
      var yearStr = String(r.year).padStart(4,"0");
      var tryYear  = parseInt("20"+yearStr.substring(2,4), 10);
      var tryMonth = parseInt(yearStr.substring(0,2), 10);
      if (tryYear >= 2020 && tryYear <= 2035 && tryMonth >= 1 && tryMonth <= 12) {
        fixedYear  = tryYear;
        fixedMonth = tryMonth;
      } else {
        // 복구 실패 → 현재 날짜 기반으로 명칭
        var now = new Date();
        fixedYear  = now.getFullYear();
        fixedMonth = now.getMonth()+1;
      }
    } else if (r.month < 1 || r.month > 12) {
      // 월이 이상한 경우: year는 올바를 수 있음
      var mo2 = r.month % 12 || 12;
      fixedMonth = (mo2 >= 1 && mo2 <= 12) ? mo2 : 1;
    }

    var newName = "("+fixedYear+"년 "+fixedMonth+"월) 발주 마감";
    try {
      // 중복 탭명 충돌 방지
      if (r.ss.getSheetByName(newName)) {
        failed.push(r.file+" | "+r.tabName+" → 이미 같은 이름 탭 존재");
        continue;
      }
      r.sheet.setName(newName);
      fixed.push(r.file+"\n  "+r.tabName+" → "+newName);
    } catch(e) {
      failed.push(r.file+" | "+r.tabName+" | "+String(e.message||"").substring(0,30));
    }
  }

  var result = "수정 완료 "+fixed.length+"건:\n"+fixed.join("\n");
  if (failed.length) result += "\n\n실패 "+failed.length+"건:\n"+failed.join("\n");
  ui.alert("발주마감 탭 수정 결과", result.substring(0,4500), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  5. 발주 및 송장조회 탭 조건부서식 일괄 재적용
// ═══════════════════════════════════════════
/**
 * 기존 배포된 파일에 새 조건부서식 규칙을 재적용.
 * 합배송→하늘, 접수완료→노랑, 품절→핑크, 단종→회색, 발송완료→연두
 */
function partnerReapplyOrderTabCFR() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    '📋 조건부서식 재적용',
    '모든 협력업체 파일의\n"발주 및 송장조회" 탭 조건부서식을 갱신합니다.\n\n' +
    '합배송→하늘  접수완료→노랑\n품절→핑크  단종→회색  발송완료→연두\n\n계속할까요?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var ok = [], failed = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace('[협력업체] ', '').trim();
    try {
      var ss  = SpreadsheetApp.openById(f.id);
      var tab = ss.getSheetByName('발주 및 송장조회');
      if (!tab) { failed.push('⚠️ ' + nm + ': 탭 없음'); continue; }
      _pt_applyOrderTabDesign(tab);
      ok.push('✅ ' + nm);
    } catch(e) {
      failed.push('❌ ' + nm + ': ' + String(e.message || '').substring(0, 30));
    }
  }

  ui.alert(
    '조건부서식 재적용 결과',
    '성공: ' + ok.length + '개\n' +
    (failed.length ? '실패:\n' + failed.join('\n') : ''),
    ui.ButtonSet.OK
  );
}

// ═══════════════════════════════════════════
//  6. 설정탭 B6(거래처코드) 텍스트 서식 일괄 적용
//  → 선행 0 보존 (0123456 등이 숫자 123456으로 바뀌는 현상 방지)
// ═══════════════════════════════════════════
function partnerFixCustCodeCellFormat() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    '📋 거래처코드(B6) 서식 수정',
    '모든 협력업체 파일의 설정탭 B6셀을\n' +
    '텍스트(@) 서식으로 변경합니다.\n\n' +
    '→ 거래처코드 앞의 0이 빠지는 현상을 방지합니다.\n\n계속할까요?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var ok = [], failed = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace('[협력업체] ', '').trim();
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var st = ss.getSheetByName('설정');
      if (!st) { failed.push('⚠️ ' + nm + ': 설정 탭 없음'); continue; }

      // 현재 표시 값을 읽어서 (getDisplayValue = 선행 0 유지)
      var currentVal = String(st.getRange('B6').getDisplayValue() || '').trim();

      // B6셀을 텍스트 서식으로 변경
      st.getRange('B6').setNumberFormat('@');

      // 값이 있으면 텍스트로 다시 기입 (선행 0 복원)
      if (currentVal) {
        st.getRange('B6').setValue(currentVal);
      }

      ok.push('✅ ' + nm + (currentVal ? ' (코드: ' + currentVal + ')' : ''));
    } catch (e) {
      failed.push('❌ ' + nm + ': ' + String(e.message || '').substring(0, 30));
    }
  }

  var msg = '거래처코드(B6) 서식 수정 완료\n\n' +
    '성공: ' + ok.length + '개\n' +
    (ok.length > 0 ? ok.join('\n') + '\n' : '') +
    (failed.length ? '\n실패:\n' + failed.join('\n') : '');
  ui.alert('거래처코드 서식 수정', msg.substring(0, 4500), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  7. 업체시트 탭별 행 트림
//  → ARRAYFORMULA 계산 범위 축소 + 조건부서식 범위 축소
// ═══════════════════════════════════════════
var _PM_TRIM = {
  ORDER:    250,   // 발주 및 송장조회
  EXCLUSIVE:250,   // 전용양식
  CANCEL:    70,   // 취소반품접수
  VIEWER:  3600,   // 단가조회
  SETTINGS:  30    // 설정
};

/**
 * 모든 협력업체 파일의 각 탭을 용도에 맞는 행 수로 트림합니다.
 *  · 발주/전용양식: 250행
 *  · 취소반품접수: 70행
 *  · 단가조회: 3600행
 *  · 설정: 30행
 * + 발주/전용양식 조건부서식 재적용 + O열 잔류 배경색 정리
 */
function partnerTrimOrderTabs() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    '✂️ 업체시트 탭별 행 트림',
    '모든 협력업체 파일의 각 탭을 트림합니다.\n\n' +
    '  · 발주/전용양식: ' + _PM_TRIM.ORDER + '행\n' +
    '  · 취소반품접수: ' + _PM_TRIM.CANCEL + '행\n' +
    '  · 단가조회: ' + _PM_TRIM.VIEWER + '행\n' +
    '  · 설정: ' + _PM_TRIM.SETTINGS + '행\n\n' +
    '⚠ 데이터가 있는 행은 삭제하지 않습니다.\n계속할까요?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert('협력업체 파일 없음');

  var totalTrimmed = 0, totalTabs = 0, errors = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace('[협력업체] ', '').trim();
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var sheets = ss.getSheets();

      for (var si = 0; si < sheets.length; si++) {
        var tab = sheets[si];
        var tabName = tab.getName();

        // 탭 이름별 트림 대상 행 수 결정
        var targetMax = 0;
        var isOrderTab = false;

        if (tabName === '발주 및 송장조회') {
          targetMax = _PM_TRIM.ORDER;
          isOrderTab = true;
        } else if (tabName.indexOf('전용양식') !== -1) {
          targetMax = _PM_TRIM.EXCLUSIVE;
        } else if (tabName === '취소반품접수' || tabName.indexOf('취소반품') !== -1) {
          targetMax = _PM_TRIM.CANCEL;
        } else if (tabName === '단가조회' || tabName.indexOf('단가조회') !== -1) {
          targetMax = _PM_TRIM.VIEWER;
        } else if (tabName === '설정') {
          targetMax = _PM_TRIM.SETTINGS;
        }

        if (targetMax === 0) continue; // 대상 아님

        var trimmed = _pm_trimTab_(tab, targetMax);
        if (trimmed > 0) {
          totalTrimmed += trimmed;
          totalTabs++;
        }

        // 발주 탭만 조건부서식 재적용 + O열 정리 (전용양식은 Push 교차색상만 사용)
        if (isOrderTab) {
          _pt_applyOrderTabDesign(tab);

          // ★ O열 직접 배경색 잔류 제거
          try {
            var lastR = tab.getLastRow();
            if (lastR >= 2) {
              var oRange = tab.getRange(2, 15, lastR - 1, 1);
              var oVals  = oRange.getValues();
              var resetRows = [];
              for (var ri = 0; ri < oVals.length; ri++) {
                var v = oVals[ri][0];
                if (!v || v === "" || v === 0) {
                  resetRows.push("O" + (ri + 2));
                }
              }
              if (resetRows.length > 0) {
                tab.getRangeList(resetRows).setBackground(null);
              }
            }
          } catch (eO) {}
        } else if (tabName.indexOf('전용양식') !== -1) {
          // ★ 전용양식은 조건부서식 불필요 → 기존 잔류 규칙 정리만
          try { tab.clearConditionalFormatRules(); } catch (eCfr) {}
        }
      }

      SpreadsheetApp.flush();
    } catch (e) {
      errors.push('❌ ' + nm + ': ' + String(e.message || '').substring(0, 40));
    }
  }

  var msg = '✅ 행 트림 완료\n\n' +
    '대상 탭: ' + totalTabs + '개\n' +
    '삭제된 빈 행: ' + totalTrimmed + '행';
  if (errors.length) msg += '\n\n⚠ 오류:\n' + errors.slice(0, 5).join('\n');
  ui.alert('행 트림 결과', msg, ui.ButtonSet.OK);
}

/**
 * 단일 탭의 빈 행 삭제 (데이터 행 보호)
 * @param {Sheet} tab - 대상 시트
 * @param {number} maxTarget - 목표 최대 행 수
 * @returns {number} 삭제된 행 수
 */
function _pm_trimTab_(tab, maxTarget) {
  var maxRows = tab.getMaxRows();
  if (maxRows <= maxTarget) return 0;

  var lastDataRow = tab.getLastRow();

  // 데이터가 있는 행 보호 (여유 10행)
  var targetRows = Math.max(maxTarget, lastDataRow + 10);

  if (maxRows <= targetRows) return 0;

  var deleteCount = maxRows - targetRows;
  try {
    tab.deleteRows(targetRows + 1, deleteCount);
    return deleteCount;
  } catch (e) {
    Logger.log('[트림] ' + tab.getName() + ' 삭제 실패: ' + e.message);
    return 0;
  }
}

// ═══════════════════════════════════════════
//  4. Spill Guard(onEdit) 트리거 설치 상태 진단
//  ★ 2026-06-13 추가 — 기획서 Issue #6 해결
// ═══════════════════════════════════════════

/**
 * 모든 협력업체 파일의 onEdit 트리거(Spill Guard) 설치 상태를 확인합니다.
 *
 * ★ 주의: 이 진단은 중앙 시트에서 실행되므로,
 *   협력업체 파일의 바운드 스크립트 트리거는 직접 조회할 수 없습니다.
 *   대신 각 업체 파일의 '발주 및 송장조회' 탭에서
 *   ARRAYFORMULA 수식이 정상인지(=Spill Guard가 작동하고 있는지)를 간접 진단합니다.
 */
function partnerDiagnoseSpillGuard() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일이 없습니다.");

  var results = [];
  var okCount = 0, warnCount = 0, errorCount = 0;

  for (var i = 0; i < files.length; i++) {
    var name = files[i].name.replace("[협력업체] ", "");
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (!orderTab) {
        results.push("⚠️ " + name + ": 발주탭 없음");
        warnCount++;
        continue;
      }

      // D2(품목명 ARRAYFORMULA) 수식 존재 여부 확인
      var d2Formula = "";
      try { d2Formula = orderTab.getRange("D2").getFormula(); } catch(e) {}

      // A2(업체명 ARRAYFORMULA) 수식 존재 여부 확인
      var a2Formula = "";
      try { a2Formula = orderTab.getRange("A2").getFormula(); } catch(e) {}

      // L2(정산금액 ARRAYFORMULA) 수식 존재 여부 확인
      var l2Formula = "";
      try { l2Formula = orderTab.getRange("L2").getFormula(); } catch(e) {}

      var issues = [];
      if (!d2Formula || d2Formula.indexOf("ARRAYFORMULA") === -1) issues.push("D열(품목명)");
      if (!a2Formula || a2Formula.indexOf("ARRAYFORMULA") === -1) issues.push("A열(업체명)");
      if (!l2Formula || l2Formula.indexOf("ARRAYFORMULA") === -1) issues.push("L열(정산금액)");

      if (issues.length === 0) {
        results.push("✅ " + name + ": 정상");
        okCount++;
      } else {
        results.push("🔴 " + name + ": ARRAYFORMULA 누락 → " + issues.join(", "));
        errorCount++;
      }
    } catch (e) {
      results.push("❌ " + name + ": 접근 실패 (" + e.message + ")");
      errorCount++;
    }
  }

  var summary =
    "🛡️ Spill Guard 진단 결과\n\n" +
    "✅ 정상: " + okCount + "개\n" +
    "🔴 이상: " + errorCount + "개\n" +
    "⚠️ 주의: " + warnCount + "개\n\n" +
    results.join("\n");

  // 결과가 길 수 있으므로 로그에도 기록
  Logger.log(summary);

  // 화면에 표시 (4500자 제한 대비 앞부분만)
  if (summary.length > 4000) {
    summary = summary.substring(0, 4000) + "\n\n... (전체 결과는 실행 로그에서 확인)";
  }
  ui.alert(summary);
}
