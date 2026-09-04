// ═══════════════════════════════════════════════════════════════
//  ★ 2026-07-02: 발주탭 자동 정리 (빈행 제거 + D/L열 복원)
// ═══════════════════════════════════════════════════════════════

/**
 * 메뉴: 발주탭 빈행 정리 + 단가/품목명 복원 (모든 업체)
 */
function partnerCleanupOrderTabsOwner() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "🧹 발주탭 자동 정리",
    "모든 업체의 발주 탭에서:\n" +
    "① 중간 빈행 제거\n" +
    "② 느린 스필수식 제거·보호 완화\n" +
    "③ D열(품목명) / L열(단가) 미입력분 복원\n" +
    "④ 위쪽으로 정렬\n\n계속하시겠습니까?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var files = _pt_listFiles();
  var results = [];
  var total = 0;

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var nm = ss.getName().replace("[협력업체] ", "").trim();
      var res = _pt_cleanupOrderTab_(ss);
      // ★ 2026-07-16: 빈행 정리 후 수집모드(수식제거·채움)도 적용
      var r2 = { filled: 0 };
      try { r2 = _pt_repairOrderTabCollectMode_(ss) || r2; } catch (_) {}
      if (res.cleaned > 0 || res.restored > 0 || (r2.filled > 0)) {
        results.push(
          "✅ " + nm + " — 빈행 " + res.cleaned + "건, 복원 " + res.restored +
          "건" + (r2.filled > 0 ? ", 채움 " + r2.filled : "")
        );
        total++;
      }
    } catch (e) {
      // 접근 불가 → 스킵
    }
  }

  ui.alert(
    "🧹 정리 완료",
    "처리: " + total + "/" + files.length + "건\n\n" +
    (results.length > 0 ? results.join("\n") : "정리할 항목 없음"),
    ui.ButtonSet.OK
  );
}

/**
 * 개별 업체 시트의 발주탭 정리 코어
 * @param {Spreadsheet} ss 업체 스프레드시트
 * @return {Object} { cleaned: number, restored: number }
 */
function _pt_cleanupOrderTab_(ss) {
  var ot = ss.getSheetByName("발주 및 송장조회");
  if (!ot) return { cleaned: 0, restored: 0 };

  var lastRow = ot.getLastRow();
  if (lastRow < 2) return { cleaned: 0, restored: 0 };

  var data = ot.getRange(2, 1, lastRow - 1, 14).getValues();
  var cleaned = 0;
  var restored = 0;

  // ── 1단계: 빈행 제거 + D/L열 미입력 체크 (동시) ──
  var validRows = [];
  var needRestore = false; // D/L열 복원 필요 여부
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var c = String(row[2] || "").trim();
    var d = String(row[3] || "").trim();
    var e = String(row[4] || "").trim();
    var f = String(row[5] || "").trim();
    if (!c && !d && !e && !f) {
      cleaned++;
      continue;
    }
    // C열(코드)은 있는데 D열(품목명) 또는 L열(단가)이 비어있으면 복원 필요
    if (c && (!d || !row[11] || row[11] === 0 || row[11] === "0")) {
      needRestore = true;
    }
    validRows.push(row);
  }

  // ★ 빈행도 없고 복원도 불필요하면 바로 리턴 (뷰어탭 로드 안 함!)
  if (cleaned === 0 && !needRestore) return { cleaned: 0, restored: 0 };

  // ── 2단계: D열(품목명) / L열(단가) 복원 ──
  var codeMap = {};
  if (needRestore) {
  try {
    var viewer = null;
    var sheets = ss.getSheets();
    for (var si = 0; si < sheets.length; si++) {
      var sn = sheets[si].getName();
      if (sn.indexOf("단가") !== -1 || sn.indexOf("뷰어") !== -1 || sn.indexOf("팩투유") !== -1) {
        viewer = sheets[si]; break;
      }
    }
    if (!viewer) viewer = sheets[0];
    
    var vLast = viewer.getLastRow();
    if (vLast >= 3) {
      var vData = viewer.getRange(3, 1, vLast - 2, 7).getValues();
      for (var vi = 0; vi < vData.length; vi++) {
        var code = String(vData[vi][2] || "").replace(/\s/g, "").toUpperCase();
        if (code && code.indexOf("#") === -1) {
          codeMap[code] = {
            name: String(vData[vi][3] || ""),
            price: vData[vi][6] || ""
          };
        }
      }
    }
  } catch (eViewer) {}

  // D/L열 복원
  for (var ri = 0; ri < validRows.length; ri++) {
    var row = validRows[ri];
    var code = String(row[2] || "").replace(/\s/g, "").toUpperCase();
    if (!code) continue;
    
    var entry = codeMap[code];
    if (!entry) continue;

    // D열(품목명) 비어있으면 복원
    if (!String(row[3] || "").trim() && entry.name) {
      validRows[ri][3] = entry.name;
      restored++;
    }
    // L열(단가) 비어있거나 0이면 복원
    var curPrice = row[11];
    if ((!curPrice || curPrice === 0 || curPrice === "0" || curPrice === "") && entry.price) {
      validRows[ri][11] = entry.price;
      restored++;
    }
    }
  } // needRestore 끝
  // ── 3단계: 시트에 반영 ──
  if (cleaned === 0 && restored === 0) return { cleaned: 0, restored: 0 };

  // 기존 데이터 영역 클리어 (★ 2026-07-24: 값+서식)
  if (lastRow > 1) {
    _pt_clearContentAndFormat_(ot.getRange(2, 1, lastRow - 1, 14));
  }

  // 정리된 데이터 쓰기
  if (validRows.length > 0) {
    ot.getRange(2, 1, validRows.length, 14).setValues(validRows);
  }

  return { cleaned: cleaned, restored: restored };
}


// ═══════════════════════════════════════════════════════════════
//  ★ 발주수집 전에 자동 정리 호출용 래퍼
// ═══════════════════════════════════════════════════════════════

/**
 * 단일 파일의 발주탭을 정리 (발주수집 시 호출)
 * @param {Spreadsheet} ss
 * @return {string} 결과 메시지
 */
function _pt_autoCleanupBeforeCollect_(ss) {
  try {
    var res = _pt_cleanupOrderTab_(ss);
    if (res.cleaned > 0 || res.restored > 0) {
      Logger.log("[CLEANUP] " + ss.getName() + " — 빈행 " + res.cleaned + ", 복원 " + res.restored);
    }
    return res;
  } catch (e) {
    Logger.log("[CLEANUP] 에러: " + e.message);
    return { cleaned: 0, restored: 0 };
  }
}
