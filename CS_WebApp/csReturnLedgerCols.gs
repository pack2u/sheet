/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장 열 점검 · 반품송장 열 추가
 *
 *  ★ 왜 필요한가 — 입고 스캔이 안 맞던 진짜 이유 ★
 *
 *    입고 스캔은 창고에서 회수 라벨의 「운송장번호」를 읽어 대장에서 찾는다.
 *    그러려면 그 번호가 대장에 **미리** 적혀 있어야 한다.
 *
 *    그런데 대장에 반품송장 열이 없으면 _cs_intakeExistingReturn_ 이
 *    "반품송장: xxx" 를 비고에 적는다. 그건 **입고 처리할 때** 적히는 값이라,
 *    입고를 찾는 시점에는 아직 없다. 닭이 먼저냐 달걀이 먼저냐다.
 *
 *    결과적으로 지금은 원송장으로만 매칭된다. 회수 라벨의 운송장번호로는
 *    영영 안 걸린다. 열을 만들어 회수 단계에서 채워 넣어야 풀린다.
 *
 *  ★ 열은 맨 뒤에 붙인다 ★
 *    대장은 열 위치가 아니라 **헤더명**으로 읽는다(_cs_returnLedgerCols_).
 *    중간에 끼우면 수식·필터·다른 스크립트가 밀린다. 끝에 붙이면 안전하다.
 * ══════════════════════════════════════════════════════════════
 */

/** 코드가 반품송장 열로 인정하는 헤더 — csOrderSearch.gs 의 정규식과 같아야 한다 */
var _CSRC_RETINV_RE_ = /반품송장|회수송장/;
var _CSRC_RETINV_HEADER_ = "반품송장";

/** 월별 탭 목록 (최근 N개월) */
function _csrc_monthTabs_(ss, months) {
  months = months || 6;
  var out = [];
  var d = new Date();
  for (var i = 0; i < months; i++) {
    var key = Utilities.formatDate(d, "Asia/Seoul", "yyyyMM");
    var tab = ss.getSheetByName(key);
    if (tab) out.push(tab);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/** 한 탭의 헤더에서 반품송장 열 위치 (0-based). 없으면 -1 */
function _csrc_findRetInvCol_(tab) {
  var lc = tab.getLastColumn();
  if (lc < 1) return -1;
  var hdr = tab.getRange(1, 1, 1, lc).getDisplayValues()[0];
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || "").replace(/\s/g, "");
    if (!h) continue;
    // 원송장 열이 먼저 걸리지 않게, 코드와 같은 순서로 판정한다
    if (/원송장|송장번호/.test(h) && !/회수|재발송|반품송장/.test(h)) continue;
    if (_CSRC_RETINV_RE_.test(h)) return i;
  }
  return -1;
}

/**
 * 점검 — 월별 탭마다 반품송장 열이 있는지, 채워진 비율은 얼마인지.
 * 스크립트 편집기에서 실행.
 */
function csDiagnoseReturnLedgerColumns() {
  var out = [];
  try {
    var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    out.push("대장: " + ss.getName());
    out.push("");

    var tabs = _csrc_monthTabs_(ss, 6);
    if (!tabs.length) { out.push("★ 월별 탭(yyyyMM)을 못 찾았습니다."); }

    for (var t = 0; t < tabs.length; t++) {
      var tab = tabs[t];
      var idx = _csrc_findRetInvCol_(tab);
      var lr = tab.getLastRow();
      var rows = Math.max(0, lr - 1);

      if (idx < 0) {
        out.push("  " + tab.getName() + " (" + rows + "행)  ★ 반품송장 열 없음");
        continue;
      }

      var filled = 0;
      if (lr >= 2) {
        var vals = tab.getRange(2, idx + 1, lr - 1, 1).getDisplayValues();
        for (var i = 0; i < vals.length; i++) {
          if (String(vals[i][0] || "").replace(/[^0-9]/g, "").length >= 8) filled++;
        }
      }
      var letter = _csrc_colLetter_(idx);
      out.push("  " + tab.getName() + " (" + rows + "행)  " + letter + "열 반품송장 · 채워짐 " +
        filled + "건 (" + (rows ? Math.round(filled / rows * 100) : 0) + "%)");
    }

    out.push("");
    out.push("※ 열이 없으면 회수 라벨의 운송장번호로 입고 스캔이 매칭되지 않습니다.");
    out.push("   csAddReturnInvoiceColumn() 으로 맨 뒤에 열을 추가할 수 있습니다.");
  } catch (e) {
    out.push("★ 실패: " + e.message);
  }
  Logger.log(out.join("\n"));
  return out.join("\n");
}

/**
 * 월 바뀔 때 "접수는 되는데 조회가 안 되는" 증상 추적.
 *
 * 읽기 경로(_cs_loadReturnLedgerCases_ → _cs_readReturnLedgerTabCases_)가
 * 새 달 탭에서 무엇을 보는지 단계별로 찍는다. 어느 관문에서 0이 되는지 보면
 * 원인이 바로 나온다.
 */
function csDiagnoseReturnLedgerMonth() {
  var out = [];
  try {
    var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    var mk = _cs_returnLedgerMonthKey_();
    out.push("오늘 기준 월 탭: " + mk);
    out.push("스캔 대상(30일): " + _cs_returnLedgerMonthsToScan_(30).join(", "));
    out.push("시트에 있는 월 탭: " + _cs_listReturnLedgerMonthTabs_(ss).join(", "));
    out.push("");

    var tab = ss.getSheetByName(mk);
    if (!tab) {
      out.push("★ " + mk + " 탭이 없습니다. 접수가 다른 탭에 들어갔을 수 있습니다.");
      Logger.log(out.join("\n"));
      return out.join("\n");
    }

    var lastRow = tab.getLastRow();
    var lastCol = Math.max(tab.getLastColumn(), 15);
    out.push("탭 크기: " + lastRow + "행 × " + lastCol + "열");

    // 관문 1 — 읽기 함수가 5행 미만이면 아예 포기한다
    if (lastRow < 5) {
      out.push("★ 관문1 실패: lastRow(" + lastRow + ") < 5 → 읽기 함수가 즉시 빈 배열을 돌려줍니다.");
    } else {
      out.push("관문1 통과: lastRow >= 5");
    }

    var values = tab.getRange(1, 1, Math.max(lastRow, 1), lastCol).getDisplayValues();

    // 관문 2 — 헤더 행 탐지
    var hi = _cs_findReturnHeaderRow_(values);
    if (hi < 0) {
      out.push("★ 관문2 실패: 헤더 행을 못 찾았습니다(반품접수날짜/접수자/원송장 등).");
      out.push("   1~6행 미리보기:");
      for (var p = 0; p < Math.min(6, values.length); p++) {
        out.push("     " + (p + 1) + ": " + values[p].slice(0, 8).join(" | ").slice(0, 110));
      }
      Logger.log(out.join("\n"));
      return out.join("\n");
    }
    out.push("관문2 통과: 헤더 " + (hi + 1) + "행");

    var col = _cs_mapReturnLedgerCols_(values[hi]);
    out.push("  날짜열=" + (col.date >= 0 ? _csrc_colLetter_(col.date) : "★없음") +
      " 수취인=" + (col.name >= 0 ? _csrc_colLetter_(col.name) : "★없음") +
      " 원송장=" + (col.invoice >= 0 ? _csrc_colLetter_(col.invoice) : "★없음") +
      " 반품송장=" + (col.returnInvoice >= 0 ? _csrc_colLetter_(col.returnInvoice) : "★없음"));
    out.push("");

    // 관문 3~5 — 행별로 어디서 걸러지는지 센다
    var cutoff = _cs_daysAgoYmd_(30);
    out.push("컷오프(30일 전): " + cutoff);
    var nData = 0, nCut = 0, nDone = 0, nPass = 0;
    var samples = [];
    for (var ri = hi + 1; ri < values.length; ri++) {
      var row = values[ri];
      if (!_cs_returnLedgerRowHasData_(row, col)) continue;
      nData++;
      var ymd = _cs_ledgerYmdFromCell_(col.date >= 0 ? row[col.date] : "");
      if (cutoff && ymd && ymd < cutoff) { nCut++; continue; }
      var st = String(row[0] || "").trim();
      if (_cs_isReturnLedgerDone_(st, row)) { nDone++; continue; }
      nPass++;
      if (samples.length < 3) {
        samples.push((ri + 1) + "행 · 날짜셀[" +
          (col.date >= 0 ? row[col.date] : "") + "] → 해석[" + (ymd || "★파싱실패") +
          "] · 상태[" + st + "]");
      }
    }
    out.push("데이터 행: " + nData + "건");
    out.push("  컷오프로 제외: " + nCut + "건");
    out.push("  완료라 제외: " + nDone + "건");
    out.push("  ▶ 조회에 남는 건: " + nPass + "건");
    if (samples.length) {
      out.push("");
      out.push("통과 예시");
      for (var s = 0; s < samples.length; s++) out.push("  " + samples[s]);
    }
    if (nData > 0 && nPass === 0) {
      out.push("");
      out.push("★ 데이터는 있는데 전부 걸러졌습니다. 위 제외 사유를 보세요.");
      out.push("   날짜 해석이 ★파싱실패면 날짜 형식이 원인입니다.");
    }

    // 캐시 세대
    try {
      out.push("");
      out.push("캐시 세대: " + (PropertiesService.getScriptProperties()
        .getProperty(_CS_RETURN_GEN_PROP_) || "1") + " (접수 때마다 올라감)");
    } catch (eG) {}
  } catch (e) {
    out.push("★ 실패: " + e.message);
  }
  Logger.log(out.join("\n"));
  return out.join("\n");
}

function _csrc_colLetter_(idx) {
  var s = "", n = idx;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/**
 * 반품송장 열 추가 — 열이 없는 월별 탭의 **맨 뒤**에 붙인다.
 * 기존 데이터는 건드리지 않는다. 이미 있으면 건너뛴다.
 */
function csAddReturnInvoiceColumn() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var ss, tabs, need = [];
  try {
    ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    tabs = _csrc_monthTabs_(ss, 6);
    for (var t = 0; t < tabs.length; t++) {
      if (_csrc_findRetInvCol_(tabs[t]) < 0) need.push(tabs[t]);
    }
  } catch (eOpen) {
    var m0 = "대장을 열지 못했습니다: " + eOpen.message;
    if (ui) ui.alert("반품송장 열 추가", m0, ui.ButtonSet.OK);
    return m0;
  }

  if (!need.length) {
    var m1 = "모든 월별 탭에 이미 반품송장 열이 있습니다.";
    if (ui) ui.alert("반품송장 열 추가", m1, ui.ButtonSet.OK);
    return m1;
  }

  if (ui) {
    var names = [];
    for (var i = 0; i < need.length; i++) names.push(need[i].getName());
    var ans = ui.alert(
      "반품송장 열 추가",
      need.length + "개 탭의 맨 뒤에 「" + _CSRC_RETINV_HEADER_ + "」 열을 추가합니다.\n\n" +
        names.join(", ") + "\n\n" +
        "· 맨 뒤에 붙이므로 기존 열 위치는 그대로입니다.\n" +
        "· 기존 데이터는 건드리지 않습니다.\n\n계속할까요?",
      ui.ButtonSet.YES_NO
    );
    if (ans !== ui.Button.YES) return "취소했습니다.";
  }

  var done = [], errs = [];
  for (var k = 0; k < need.length; k++) {
    try {
      var tab = need[k];
      var lc = tab.getLastColumn();
      tab.insertColumnAfter(lc);
      var c = lc + 1;
      tab.getRange(1, c).setValue(_CSRC_RETINV_HEADER_)
        .setFontWeight("bold").setBackground("#252525").setFontColor("#f0f0f0");
      // 송장번호는 앞자리 0 이 죽지 않게 텍스트로 잠근다
      tab.getRange(2, c, Math.max(1, tab.getMaxRows() - 1), 1).setNumberFormat("@");
      tab.setColumnWidth(c, 140);
      done.push(tab.getName() + " → " + _csrc_colLetter_(c - 1) + "열");
    } catch (e2) {
      errs.push(need[k].getName() + ": " + e2.message);
    }
  }

  var msg = "추가: " + done.length + "개\n" + done.join("\n") +
    (errs.length ? "\n\n실패:\n" + errs.join("\n") : "") +
    "\n\n이제 회수 단계에서 이 열에 반품송장을 적어두면\n입고 스캔이 그 번호로 매칭됩니다.";
  if (ui) ui.alert("반품송장 열 추가", msg, ui.ButtonSet.OK);
  Logger.log("[RETINV] " + msg);
  return msg;
}
