/**
 * [협력업체] 유지보수 도구 v1.1
 * 파일: _partnerMaintenance.gs
 *
 * 기능:
 *  1) partnerValidateAllOrderTabHeaders()  — 발주탭 헤더 일괄 검증
 *  2) partnerFixMalformedMonthlyTabs()     — 발주마감 탭 이름 오류 자동 수정
 *
 * 설정 탭 셀 약속:
 *   설정!B4 = K2 (그룹 열 번호). 뷰어 K2 는 여기를 참조하는 수식이다.
 *   (K2 → B4 이전은 2026 상반기에 끝나 이전 도구는 제거했다.)
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
    '🎨 발주탭 상태색 재적용',
    '모든 협력업체 파일의\n"발주 및 송장조회" 탭 행 색을 갱신합니다.\n\n' +
    '접수완료→하늘  발송완료→연두\n품절→핑크  단종→회색  재고까지만→노랑\n' +
    '도서산간비(O열)→보라(해당 셀만)\n\n' +
    '· 잔류 수동 배경색 제거 후 CF 재설치\n' +
    '· 범위: 상태 스필과 동일(최대 500~1000행)\n\n계속할까요?',
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
    '발주탭 상태색 재적용 결과',
    '성공: ' + ok.length + '개 / 전체 ' + files.length + '개\n' +
    (failed.length ? '\n실패:\n' + failed.slice(0, 20).join('\n') : ''),
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
  VIEWER:  5000,   // 단가조회 ★ 2026-08-02: 허브 전체 스필과 맞춤
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
/**
 * 모든 협력업체 파일의 발주탭 상태를 진단합니다.
 *
 * ★ 2026-07-16: 수식 모드 기준
 *   - D/L: ARRAYFORMULA+XLOOKUP 필요
 *   - N: MAP+접수완료 필요
 *   - A: 값 기반 OK
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

      var issues = [];
      var dF = "", lF = "", nF = "";
      try { dF = orderTab.getRange("D1").getFormula(); } catch (e) {}
      try { lF = orderTab.getRange("L1").getFormula(); } catch (e) {}
      try { nF = orderTab.getRange("N1").getFormula(); } catch (e) {}

      if (String(dF || "").indexOf("ARRAYFORMULA") === -1 ||
          (String(dF || "").indexOf("VLOOKUP") === -1 && String(dF || "").indexOf("XLOOKUP") === -1)) {
        issues.push("D열 수식 없음");
      }
      if (String(lF || "").indexOf("ARRAYFORMULA") === -1 ||
          (String(lF || "").indexOf("VLOOKUP") === -1 && String(lF || "").indexOf("XLOOKUP") === -1)) {
        issues.push("L열 수식 없음");
      }
      if (String(nF || "").indexOf("ARRAYFORMULA") === -1 || String(nF || "").indexOf("접수완료") === -1 ||
          String(nF || "").indexOf("MAP") !== -1) {
        issues.push("N열 수식 구버전/없음");
      }

      if (issues.length === 0) {
        results.push("✅ " + name + ": 정상 (D/L/N 수식)");
        okCount++;
      } else {
        results.push("🔴 " + name + ": " + issues.join(", ") + " → 복구 3번 실행");
        errorCount++;
      }
    } catch (e) {
      results.push("❌ " + name + ": 접근 실패 (" + e.message + ")");
      errorCount++;
    }
  }

  var summary =
    "🛡️ 발주탭 진단 결과 (수식 모드)\n\n" +
    "✅ 정상: " + okCount + "개\n" +
    "🔴 복구필요: " + errorCount + "개\n" +
    "⚠️ 주의: " + warnCount + "개\n\n" +
    results.join("\n");

  Logger.log(summary);
  if (summary.length > 4000) {
    summary = summary.substring(0, 4000) + "\n\n... (전체 결과는 실행 로그에서 확인)";
  }
  ui.alert(summary);
}

// ═══════════════════════════════════════════
//  8. 발주탭 A1 수식 D2:D 참조 제거 일괄 적용
//  ★ 2026-06-16 추가 — D열 ARRAYFORMULA #REF 에러 수정
//  A1 수식의 LEN(C2:C)+LEN(D2:D)=0 → LEN(C2:C)=0 변경
//  + D열/L열 ARRAYFORMULA heal
// ═══════════════════════════════════════════

/**
 * 모든 협력업체 발주탭을 수집 직전 채움 모드로 정리합니다.
 * ★ 2026-07-16: A1 ARRAYFORMULA 재주입 대신 수식제거·빈칸채움
 */
function partnerFixAllOrderA1Formulas() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    '⚡ 발주탭 수집모드 정리',
    '모든 협력업체 「발주 및 송장조회」탭을 정리합니다.\n\n' +
    '· 느린 ARRAYFORMULA/MAP/#REF 제거\n' +
    '· 보호 완화 + 조건부서식 축소\n' +
    '· 품목명/단가 빈칸 채움\n\n계속할까요?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert('협력업체 파일 없음');

  var fixed = [], skipped = [], errors = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace('[협력업체] ', '').trim();
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var r = _pt_repairOrderTabCollectMode_(ss);
      if (!r.ok) {
        skipped.push('⏭️ ' + nm + ': ' + (r.msg || '발주탭 없음'));
      } else if (r.logs && r.logs.length && r.msg !== '이상없음') {
        fixed.push('✅ ' + nm + ' (' + r.msg + ')');
      } else {
        skipped.push('⏭️ ' + nm + ': 이미 정상');
      }
    } catch (e) {
      errors.push('❌ ' + nm + ': ' + String(e.message || '').substring(0, 40));
    }
  }

  var msg = '⚡ 발주탭 수집모드 정리 완료 (' + files.length + '개 검사)\n\n';
  if (fixed.length) msg += '수정: ' + fixed.length + '개\n' + fixed.join('\n') + '\n\n';
  if (skipped.length) msg += '스킵: ' + skipped.length + '개\n' + skipped.slice(0, 5).join('\n') + '\n\n';
  if (errors.length) msg += '오류: ' + errors.length + '개\n' + errors.join('\n');

  Logger.log(msg);
  ui.alert('발주탭 정리 결과', msg.substring(0, 4500), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  9. 뷰어(단가조회) 탭 3행 수식 종합 진단
//  ★ 2026-06-23 추가 — C열 코드 입력 시 나머지 열 미연동 문제 진단
// ═══════════════════════════════════════════

/**
 * 모든 협력업체 파일의 뷰어(단가조회) 탭 3행 ARRAYFORMULA 수식 상태를 진단합니다.
 *
 * 점검 항목:
 *  1) A3, B3, D3, E3, F3, G3, H3, I3, J3에 ARRAYFORMULA 수식이 존재하는지
 *  2) 수식 결과가 #REF!, #N/A, Loading... 등 에러 상태인지
 *  3) 4행 이하에 스필을 차단하는 수동 입력값이 있는지
 *  4) C열에 코드가 있는데 D열(품목명)이 비어있는 행이 있는지
 */
function partnerDiagnoseViewerRow3Formulas() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일이 없습니다.");

  var results = [];
  var okCount = 0, warnCount = 0, errorCount = 0;

  // 점검 대상 열: A(1), B(2), D(4), E(5), F(6), G(7), H(8), I(9), J(10)
  var checkCols = [
    { col: 1, name: "A(상태)" },
    { col: 2, name: "B(출고지)" },
    { col: 4, name: "D(품목명)" },
    { col: 5, name: "E(재고)" },
    { col: 6, name: "F(소비자가)" },
    { col: 7, name: "G(최종단가)" },
    { col: 8, name: "H(단가변동)" },
    { col: 9, name: "I(지난단가)" },
    { col: 10, name: "J(익월변동)" }
  ];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace("[협력업체] ", "").trim();
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var viewer = null;
      try { viewer = _pt_findViewerSheet(ss); } catch (e) {}
      if (!viewer) viewer = ss.getSheetByName("단가조회");
      if (!viewer) {
        results.push("⚠️ " + nm + ": 뷰어탭 없음");
        warnCount++;
        continue;
      }

      var issues = [];

      // ① 3행 수식 존재 여부 확인
      var missingFormulas = [];
      var errorFormulas = [];
      for (var ci = 0; ci < checkCols.length; ci++) {
        var cc = checkCols[ci];
        try {
          var formula = viewer.getRange(3, cc.col).getFormula();
          if (!formula) {
            missingFormulas.push(cc.name);
          } else if (formula.indexOf("ARRAYFORMULA") === -1) {
            missingFormulas.push(cc.name + "(AF없음)");
          } else {
            // 수식 결과 확인
            var val = String(viewer.getRange(3, cc.col).getDisplayValue() || "");
            if (val.indexOf("#REF") !== -1) {
              errorFormulas.push(cc.name + "=#REF!");
            } else if (val.indexOf("Loading") !== -1) {
              errorFormulas.push(cc.name + "=Loading");
            }
          }
        } catch (eF) {
          missingFormulas.push(cc.name + "(접근불가)");
        }
      }
      if (missingFormulas.length > 0) {
        issues.push("수식없음: " + missingFormulas.join(","));
      }
      if (errorFormulas.length > 0) {
        issues.push("수식에러: " + errorFormulas.join(","));
      }

      // ② 4행 이하 스필 차단 확인 (D/G열에 수동입력값 존재 여부)
      var vLast = viewer.getLastRow();
      if (vLast >= 4) {
        var spillBlocked = [];
        try {
          var d4f = viewer.getRange(4, 4).getFormula();
          var d4v = String(viewer.getRange(4, 4).getValue() || "").trim();
          // ARRAYFORMULA가 정상이면 4행에는 수식이 없고 값이 있어야 함 (스필 결과)
          // 만약 4행에 수식이 있으면 스필이 아닌 수동 입력
          if (d4f) spillBlocked.push("D4수식잔존");
        } catch (eSpill) {}
        try {
          var g4f = viewer.getRange(4, 7).getFormula();
          if (g4f) spillBlocked.push("G4수식잔존");
        } catch (eSpill2) {}
        if (spillBlocked.length > 0) {
          issues.push("스필차단: " + spillBlocked.join(","));
        }
      }

      // ③ C열 코드 있는데 D열 비어있는 행 카운트 (샘플 50행)
      var checkEnd = Math.min(vLast, 52); // 3~52행 (50행 샘플)
      if (checkEnd >= 3) {
        var sampleRows = checkEnd - 2;
        var cData = viewer.getRange(3, 3, sampleRows, 1).getValues(); // C열
        var dData = viewer.getRange(3, 4, sampleRows, 1).getValues(); // D열
        var emptyCount = 0;
        for (var si = 0; si < cData.length; si++) {
          var cVal = String(cData[si][0] || "").trim();
          var dVal = String(dData[si][0] || "").trim();
          if (cVal && (!dVal || dVal === "-" || dVal === "#REF!")) {
            emptyCount++;
          }
        }
        if (emptyCount > 0) {
          issues.push("코드O/품목X: " + emptyCount + "행 (샘플 " + sampleRows + "행)");
        }
      }

      // ④ K2 값 확인
      var K2 = "";
      try { K2 = viewer.getRange("K2").getValue(); } catch (e) {}
      if (!K2 || isNaN(parseInt(K2, 10))) {
        issues.push("K2=없음");
      }

      if (issues.length === 0) {
        results.push("✅ " + nm + " (K2=" + K2 + ")");
        okCount++;
      } else {
        results.push("🔴 " + nm + ": " + issues.join(" | "));
        errorCount++;
      }
    } catch (e) {
      results.push("❌ " + nm + ": 접근실패 (" + String(e.message || "").substring(0, 30) + ")");
      errorCount++;
    }
  }

  var summary =
    "🔍 뷰어 3행 수식 진단 결과\n\n" +
    "✅ 정상: " + okCount + "개\n" +
    "🔴 이상: " + errorCount + "개\n" +
    "⚠️ 주의: " + warnCount + "개\n\n" +
    results.join("\n");

  Logger.log(summary);
  if (summary.length > 4000) {
    summary = summary.substring(0, 4000) + "\n\n... (전체 결과는 실행 로그에서 확인)";
  }
  ui.alert("뷰어 수식 진단", summary, ui.ButtonSet.OK);
}

/**
 * 모든 업체의 뷰어 탭 3행 수식을 일괄 재적용합니다.
 * C열(이카운트코드)은 보존하고 ARRAYFORMULA 수식만 재설정합니다.
 */
function partnerRepairAllViewerRow3Formulas() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    "🔧 뷰어 3행 수식 일괄 복구",
    "모든 협력업체 파일의 단가조회 탭 3행 ARRAYFORMULA 수식을\n" +
    "일괄 재적용합니다.\n\n" +
    "★ C열(이카운트코드)은 보존됩니다.\n" +
    "★ 스필 차단 데이터(4행 이하 수동입력)도 정리됩니다.\n\n" +
    "계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var hubId = _PT.HUB_ID;
  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일이 없습니다.");

  var fixed = 0, skipped = 0, errors = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.name.replace("[협력업체] ", "").trim();
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var viewer = null;
      try { viewer = _pt_findViewerSheet(ss); } catch (e) {}
      if (!viewer) viewer = ss.getSheetByName("단가조회");
      if (!viewer) {
        skipped++;
        continue;
      }

      var K2 = parseInt(viewer.getRange("K2").getValue(), 10);
      if (!K2 || isNaN(K2)) {
        errors.push("⚠️ " + nm + ": K2 없음(스킵)");
        skipped++;
        continue;
      }

      var isConsumer = f.name.indexOf("(소비자용)") !== -1;
      var dcMul = 1;
      if (isConsumer) {
        var dcRate = _pt_parseConsumerDcRateFromName(f.name);
        dcMul = (100 - dcRate) / 100;
      } else {
        var rateFromK2 = _pt_getConsumerRateFromK2(K2);
        if (rateFromK2 > 0) {
          isConsumer = true;
          dcMul = (100 - rateFromK2) / 100;
        }
      }

      // 스필 영역 정리 + 수식 재적용
      _pt_clearSpillArea(viewer, isConsumer);
      _pt_applyRow3Formulas(viewer, hubId, isConsumer, dcMul);
      fixed++;
    } catch (e) {
      errors.push("❌ " + nm + ": " + String(e.message || "").substring(0, 40));
    }
  }

  SpreadsheetApp.flush();

  var msg =
    "🔧 뷰어 3행 수식 복구 완료\n\n" +
    "- 전체: " + files.length + "개\n" +
    "- 복구: " + fixed + "개\n" +
    "- 스킵: " + skipped + "개\n" +
    (errors.length > 0 ? "\n⚠ 오류:\n" + errors.join("\n") : "");
  Logger.log(msg);
  ui.alert("뷰어 수식 복구 결과", msg.substring(0, 4500), ui.ButtonSet.OK);
}


// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-07: 뷰어탭 이름 "단가조회"로 일괄 통일
//  + A열 ARRAYFORMULA → 값 기반 마이그레이션
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴: 뷰어탭 이름 통일 + A열 마이그레이션 (전체 업체)
 */
function partnerUnifyViewerTabNameOwner() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "📋 뷰어탭 통일 + A열 마이그레이션",
    "모든 업체 시트에서:\n" +
    "① 뷰어탭 이름 → '단가조회'로 변경\n" +
    "② A열 ARRAYFORMULA → 값 기반 전환 (표시값 보존)\n" +
    "③ 불필요한 _data 탭 삭제\n\n" +
    "계속하시겠습니까?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var renamed = 0, aMigrated = 0, dataDeleted = 0, errors = [];
  var ss0 = SpreadsheetApp.getActiveSpreadsheet();

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var fss = SpreadsheetApp.openById(files[fi].id);
      var nm = fss.getName().replace("[협력업체] ", "").trim();

      // ── ① 뷰어탭 이름 변경 ──
      var viewer = _pt_findViewerSheet(fss);
      if (viewer) {
        var vn = viewer.getName();
        if (vn !== "단가조회") {
          var existing = fss.getSheetByName("단가조회");
          if (!existing) {
            viewer.setName("단가조회");
            renamed++;
          } else if (existing.getSheetId() !== viewer.getSheetId()) {
            errors.push("⚠ " + nm + " — '단가조회' 탭 이미 존재 (스킵)");
          }
        }
      }

      // ── ② A열 값 기반 마이그레이션 ──
      var ot = fss.getSheetByName("발주 및 송장조회");
      if (ot) {
        var a1 = ot.getRange("A1");
        var a1f = a1.getFormula() || "";
        if (a1f) {
          var lr = ot.getLastRow();
          if (lr >= 2) {
            var ar = ot.getRange(2, 1, lr - 1, 1);
            var adv = ar.getDisplayValues();
            var ao = [];
            for (var ai = 0; ai < adv.length; ai++) {
              var v = adv[ai][0];
              if (v && v.indexOf("#") === 0) v = "";
              ao.push([v]);
            }
            ar.clearContent();
            ar.setValues(ao);
          }
          a1.clearContent();
          a1.setValue("거래처명(자동)");
          try {
            var stab = fss.getSheetByName("설정");
            if (stab && lr >= 2) {
              var vnm = String(stab.getRange("B5").getValue() || "").trim();
              if (vnm) {
                var aFin = ot.getRange(2, 1, lr - 1, 1).getValues();
                var cVal = ot.getRange(2, 3, lr - 1, 1).getValues();
                var filled = false;
                for (var j = 0; j < aFin.length; j++) {
                  if (!String(aFin[j][0] || "").trim() && String(cVal[j][0] || "").trim()) {
                    aFin[j][0] = vnm;
                    filled = true;
                  }
                }
                if (filled) ot.getRange(2, 1, lr - 1, 1).setValues(aFin);
              }
            }
          } catch(eFill) {}
          aMigrated++;
        }
      }

      // ── ③ _data 탭 삭제 ──
      try {
        var dataTab = fss.getSheetByName("_data");
        if (dataTab) {
          fss.deleteSheet(dataTab);
          dataDeleted++;
        }
      } catch(eDel) {}

      if (fi % 5 === 0) {
        try { ss0.toast((fi + 1) + "/" + files.length + " 처리 중...", "⏳", 3); } catch(_t) {}
      }
    } catch (e) {
      errors.push("❌ " + files[fi].name + ": " + String(e.message || "").substring(0, 60));
    }
  }

  var result =
    "📋 뷰어탭 통일 + A열 마이그레이션 완료\n\n" +
    "- 전체: " + files.length + "개\n" +
    "- 뷰어탭 이름 변경: " + renamed + "개\n" +
    "- A열 값 전환: " + aMigrated + "개\n" +
    "- _data 탭 삭제: " + dataDeleted + "개\n" +
    (errors.length > 0 ? "\n⚠ 오류/경고:\n" + errors.join("\n") : "");
  ui.alert("결과", result.substring(0, 4500), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════════════════════════
//  ★ 발주탭 수집모드 정리 — 업체 선택 후 즉시 실행 (1분 후 재시도 없음)
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴: 발주탭 수집모드 정리
 * → 복구 다이얼로그에서 업체 체크 후 바로 실행
 */
function partnerMigrateToNewArrayFormulaOwner() {
  // 잔여 1분-트리거 큐가 있으면 정리 (예전 방식 잔재)
  try { partnerForceClearCollectModeJobs_(true); } catch (_) {}
  openRepairDialog_order();
}

/** 예전 1분 연속 실행 큐/트리거 정리 (조용히 가능) */
function partnerForceClearCollectModeJobs_(silent) {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("_COLLECT_MODE_QUEUE");
  props.deleteProperty("_COLLECT_MODE_RESULTS");
  props.deleteProperty("_COLLECT_MODE_TOTAL");
  props.deleteProperty("_COLLECT_MODE_TRIGGER_ERROR");
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === "_collectMode_continueAuto_") {
      try { ScriptApp.deleteTrigger(triggers[t]); } catch (_) {}
    }
  }
  if (!silent) {
    try {
      SpreadsheetApp.getUi().alert("✅ 수집모드 백그라운드 큐/트리거를 초기화했습니다.");
    } catch (_) {}
  }
}

/** @deprecated 1분 후 연속실행 — 사용 안 함 (트리거로 남아있으면 no-op) */
function _collectMode_continueAuto_() {
  try { partnerForceClearCollectModeJobs_(true); } catch (_) {}
  Logger.log("[COLLECT_MODE] 1분후 연속실행은 폐기됨 — 업체 선택 다이얼로그를 사용하세요.");
}

// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-17 (M6): 조건부서식(CF) 중복 정리 배치
//  마감탭·허브 등에 반복 push로 누적된 동일 CF 규칙을 1개만 남기고 제거.
//  키: 범위(A1 목록) + 조건(타입/값) + 서식(배경/글꼴색) — 첫 규칙 유지(표시 결과 동일)
// ═══════════════════════════════════════════════════════════════

/** CF 규칙 식별 키 생성 */
function _pm_cfRuleKey_(rule) {
  var parts = [];
  try {
    var ranges = rule.getRanges();
    var rr = [];
    for (var i = 0; i < ranges.length; i++) rr.push(ranges[i].getA1Notation());
    rr.sort();
    parts.push(rr.join(","));
  } catch (_) { parts.push("R?"); }
  try {
    var bc = rule.getBooleanCondition();
    if (bc) {
      parts.push("B:" + String(bc.getCriteriaType()));
      try { parts.push(JSON.stringify(bc.getCriteriaValues())); } catch (_) {}
      try { parts.push("bg:" + String(bc.getBackground() || "")); } catch (_) {}
      try { parts.push("fc:" + String(bc.getFontColor() || "")); } catch (_) {}
    } else {
      parts.push("GRADIENT"); // 그라데이션 규칙은 범위 기준으로만 dedupe
    }
  } catch (_) {}
  return parts.join("|");
}

/** 시트 1개의 CF 규칙 중복 제거 — 제거된 규칙 수 반환 */
function _pm_dedupSheetCfRules_(sheet) {
  var rules;
  try { rules = sheet.getConditionalFormatRules(); } catch (_) { return 0; }
  if (!rules || rules.length <= 1) return 0;
  var seen = {};
  var kept = [];
  for (var i = 0; i < rules.length; i++) {
    var key = _pm_cfRuleKey_(rules[i]);
    if (seen[key]) continue;
    seen[key] = true;
    kept.push(rules[i]);
  }
  if (kept.length < rules.length) {
    sheet.setConditionalFormatRules(kept); // ★ 교체(set) — 누적(push) 금지 원칙
    return rules.length - kept.length;
  }
  return 0;
}

/**
 * [메뉴] CF 중복 정리 배치 — 허브 파일 + 전체 협력업체 파일
 * 시간예산 5분: 초과 시 처리 현황까지 보고하고 종료 (재실행하면 이어서 정리됨)
 */
function partnerDedupConditionalFormatsAll() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (_) {}

  var startMs = Date.now();
  var MAX_MS = 5 * 60 * 1000;
  var totalRemoved = 0;
  var filesDone = 0;
  var report = [];
  var timedOut = false;

  function dedupSpreadsheet(ss, label) {
    var removed = 0;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      removed += _pm_dedupSheetCfRules_(tabs[ti]);
    }
    if (removed > 0) report.push(label + ": " + removed + "개 제거");
    return removed;
  }

  // ① 허브(현재 파일)
  try {
    totalRemoved += dedupSpreadsheet(SpreadsheetApp.getActiveSpreadsheet(), "허브");
  } catch (eHub) {
    report.push("허브: ⚠ " + eHub.message);
  }

  // ② 협력업체 파일 전체
  var files = _pt_listFiles();
  for (var fi = 0; fi < files.length; fi++) {
    if (Date.now() - startMs > MAX_MS) { timedOut = true; break; }
    try {
      totalRemoved += dedupSpreadsheet(
        SpreadsheetApp.openById(files[fi].id), files[fi].name);
      filesDone++;
    } catch (eF) {
      report.push(files[fi].name + ": ⚠ " + eF.message);
    }
  }

  var msg =
    "🎨 조건부서식 중복 정리 완료\n" +
    "- 처리 파일: 허브 + " + filesDone + "/" + files.length + "개 업체\n" +
    "- 제거된 중복 규칙: " + totalRemoved + "개\n" +
    (timedOut ? "\n⏳ 시간예산(5분) 초과 — 재실행하면 남은 파일을 이어서 정리합니다.\n" : "") +
    (report.length > 0 ? "\n[상세]\n" + report.slice(0, 15).join("\n") : "\n(중복 규칙 없음)");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ★ 2026-07-30: 허브 조건부서식 재적용 (독립 메뉴 함수)
function partnerReapplyHubCFOwner() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (_) {}
  try {
    var hubTab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("협력업체_발주허브");
    if (!hubTab) {
      if (ui) ui.alert("❌ '협력업체_발주허브' 탭을 찾을 수 없습니다.");
      return;
    }
    _po_applyHubDesign(hubTab);
    SpreadsheetApp.flush();
    var msg = "✅ 협력업체_발주허브 조건부서식 재적용 완료\n\n" +
      "상태값별 색상:\n" +
      "  • 출고가능 → 연초록 (#c8e6c9)\n" +
      "  • 품절 → 핑크 (#f4cccc)\n" +
      "  • 품절임박 → 연주황 (#ffe0b2)\n" +
      "  • 단종 → 회색 (#d9d9d9)\n" +
      "  • 재고까지만 → 노랑 (#ffe599)\n" +
      "  • 발송완료 → 연두 (#d9ead3)\n" +
      "  • 합배송 → 연파랑 (#cfe2f3)";
    Logger.log(msg);
    if (ui) ui.alert(msg);
  } catch (e) {
    var errMsg = "❌ 허브 조건부서식 재적용 오류: " + String(e.message || e);
    Logger.log(errMsg);
    if (ui) ui.alert(errMsg);
  }
}


