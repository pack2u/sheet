/**
 * ══════════════════════════════════════════════════════════════
 *  엑셀 발주 표시 — 같은 건을 오전·오후 두 번 발주하지 않도록
 *  파일: _partnerExcelOrderMark.gs
 *  화면: 메뉴 [📬 송장매칭/엑셀저장] 사이드바 (invoiceMatchSidebar.html)
 *
 *  ★ 왜 필요한가 ★
 *    엑셀 다운로드는 "A열 송장번호가 비어 있으면 미발주"로 판단했다.
 *    그런데 송장은 오후 늦게(16시 이후) 들어온다. 그래서 오전에 이미
 *    엑셀로 내보내 발주한 건이 오후 다운로드에도 그대로 다시 나왔다.
 *    송장이 늦다는 이유만으로 같은 주문을 두 번 발주하게 된다.
 *
 *  ★ 왜 AW열인가 ★
 *    전용양식은 업체마다 열 구성이 다르다. 공통은 앞 두 열(A=송장번호,
 *    B=이슈)과 AX열(50, 고유ID)뿐이다. 업체 양식 중 가장 넓은 것이
 *    뉴파츠 32열이므로 33~49열은 전 업체 공통으로 비어 있다.
 *    고유ID 바로 왼쪽인 AW(49)에 표시를 남긴다.
 *
 *  ★ 왜 전용양식에 남기나 (허브 기록이 아니라) ★
 *    전용양식 행은 송장이 찍혀 마감으로 이동하기 전까지 그대로 남는다
 *    (_pea_decideRow_ — 파일 _partnerExclusiveArchive.gs).
 *    표시가 행과 같이 살고 같이 사라지므로 따로 청소할 것이 없다.
 *
 *  ※ 주의: 메뉴 [오후 재Push (전용양식 초기화)] 는 2행 이하를 통째로
 *    지운다. 그걸 쓰면 표시도 같이 사라진다 — 그 메뉴 자체가
 *    "이미 발주된 내용이 다시 들어간다"고 경고하는 물건이므로,
 *    평상시 오후 발주에는 쓰지 말 것.
 * ══════════════════════════════════════════════════════════════
 */

/** AW열(49) — 엑셀 발주 표시. 업체 양식 최대폭(32) 과 고유ID(AX,50) 사이 */
var _PEO_MARK_COL_ = 49;
var _PEO_MARK_HEADER_ = "엑셀발주";

/** 전용양식 탭 찾기 — 다운로드·표시·해제가 같은 규칙을 써야 한다 */
function _peo_findFormTab_(ss) {
  var tabs = ss.getSheets();
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getName().indexOf("전용양식") !== -1) return tabs[i];
  }
  return null;
}

/** 표시 열 머리글 — 사람이 시트를 열었을 때 무슨 열인지 알아야 한다 */
function _peo_ensureMarkHeader_(tab) {
  try {
    var cur = String(tab.getRange(1, _PEO_MARK_COL_).getValue() || "").trim();
    if (cur === _PEO_MARK_HEADER_) return;
    tab.getRange(1, _PEO_MARK_COL_)
      .setValue(_PEO_MARK_HEADER_)
      .setFontWeight("bold")
      .setBackground("#fff3cd")
      .setNote("엑셀로 내보낸 시각. 이 값이 있으면 다운로드 목록에서 제외된다.\n" +
        "해제하려면 사이드바의 [발주표시 해제] 를 쓰세요.");
  } catch (e) {}
}

/**
 * 내보낸 행에 시각을 찍는다.
 * 저장이 실제로 끝난 뒤에만 부른다 — 저장 취소한 건을 발주됨으로 남기면
 * 그 주문은 아무도 발주하지 않은 채 사라진다.
 *
 * @param {string} fileId 업체 시트 ID
 * @param {number[]} rowNumbers 전용양식 시트 행번호 (1-based)
 * @param {string=} fileName 만든 엑셀 파일명 (메모용)
 */
function markExclusiveFormExported(fileId, rowNumbers, fileName) {
  try {
    if (!rowNumbers || !rowNumbers.length) return { ok: true, marked: 0 };
    var ss = SpreadsheetApp.openById(fileId);
    var tab = _peo_findFormTab_(ss);
    if (!tab) return { ok: false, error: "전용양식 탭을 찾을 수 없습니다." };

    _peo_ensureMarkHeader_(tab);

    var lr = tab.getLastRow();
    if (lr < 2) return { ok: true, marked: 0 };

    // 한 번 읽고 한 번 쓴다 — 행마다 setValue 하면 수십 건에 수십 초 걸린다
    var rng = tab.getRange(2, _PEO_MARK_COL_, lr - 1, 1);
    var cur = rng.getValues();
    var stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var marked = 0;
    for (var i = 0; i < rowNumbers.length; i++) {
      var idx = parseInt(rowNumbers[i], 10) - 2; // 시트 행번호 → 배열 인덱스
      if (idx < 0 || idx >= cur.length) continue;
      if (String(cur[idx][0] || "").trim()) continue; // 이미 표시됨 — 최초 시각을 지킨다
      cur[idx][0] = stamp;
      marked++;
    }
    rng.setValues(cur);
    SpreadsheetApp.flush();

    Logger.log("[EXCEL_MARK] " + ss.getName() + " " + marked + "건 표시 (" +
      (fileName || "-") + ")");
    return { ok: true, marked: marked, stamp: stamp };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 표시 해제 — 엑셀을 잘못 받았거나 발주를 취소했을 때.
 * @param {string} fileId 업체 시트 ID
 * @param {string=} onlyStampPrefix 지정하면 그 값으로 시작하는 표시만 해제
 *                                  (예: "2026-09-01" → 오늘 것만)
 */
function clearExclusiveFormExportMarks(fileId, onlyStampPrefix) {
  try {
    var ss = SpreadsheetApp.openById(fileId);
    var tab = _peo_findFormTab_(ss);
    if (!tab) return { ok: false, error: "전용양식 탭을 찾을 수 없습니다." };

    var lr = tab.getLastRow();
    if (lr < 2) return { ok: true, cleared: 0 };

    var pfx = String(onlyStampPrefix || "").trim();
    var rng = tab.getRange(2, _PEO_MARK_COL_, lr - 1, 1);
    var cur = rng.getValues();
    var cleared = 0;
    for (var i = 0; i < cur.length; i++) {
      var v = String(cur[i][0] || "").trim();
      if (!v) continue;
      if (pfx && v.indexOf(pfx) !== 0) continue;
      cur[i][0] = "";
      cleared++;
    }
    if (cleared) {
      rng.setValues(cur);
      SpreadsheetApp.flush();
    }
    Logger.log("[EXCEL_MARK] " + ss.getName() + " 표시 해제 " + cleared + "건" +
      (pfx ? " (" + pfx + ")" : " (전체)"));
    return { ok: true, cleared: cleared };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 점검 — 업체별로 표시 몇 건인지. 스크립트 편집기에서 실행.
 * 파일: _partnerExcelOrderMark.gs
 */
function partnerDiagnoseExcelOrderMarks() {
  var L = ["═══ 엑셀 발주 표시 현황 ═══",
    "표시 열: AW(" + _PEO_MARK_COL_ + ") · 오늘 " +
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd"), ""];
  var files = [];
  try { files = _pt_listFiles(); } catch (e) { L.push("★ 업체 목록 실패: " + e.message); }

  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var tab = _peo_findFormTab_(ss);
      var nm = files[fi].name.replace("[협력업체] ", "");
      if (!tab) { L.push("  " + nm + " — 전용양식 없음"); continue; }
      var lr = tab.getLastRow();
      if (lr < 2) { L.push("  " + nm + " — 데이터 없음"); continue; }
      var marks = tab.getRange(2, _PEO_MARK_COL_, lr - 1, 1).getValues();
      var invs = tab.getRange(2, 1, lr - 1, 1).getValues();
      var m = 0, mToday = 0, waiting = 0;
      for (var i = 0; i < marks.length; i++) {
        var v = String(marks[i][0] || "").trim();
        var hasInv = String(invs[i][0] || "").trim();
        if (v) { m++; if (v.indexOf(today) === 0) mToday++; }
        if (!v && !hasInv) waiting++;
      }
      L.push("  " + nm + " — 전체 " + (lr - 1) + "행 · 발주표시 " + m +
        "건(오늘 " + mToday + ") · 미발주 대기 " + waiting + "건");
    } catch (eF) {
      L.push("  ★ " + files[fi].name + ": " + eF.message);
    }
  }
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("엑셀 발주 표시", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  잘못 찍힌 회차 도장 청소 (2026-09-01)
 *
 *  첫 도장 형식이 "0901-1" 이었는데, 구글시트가 이걸 날짜로 읽어
 *  연도 0901 짜리 Date 로 바꿔 버렸다. 전용양식 이슈칸과 임시기록
 *  이슈칸에 "Tue Mar 01 0901 00:00:00 GMT+0827" 같은 값이 남았다.
 *
 *  형식은 "0901-1차" 로 고쳤지만 이미 적힌 쓰레기는 지워야 한다.
 *  업체가 쓴 진짜 이슈는 건드리지 않는다 — 연도 09xx 날짜만 지운다.
 * ══════════════════════════════════════════════════════════════
 */
function partnerCleanBadPushStamps() {
  var BAD = /^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+0\d{3}\s/;
  var L = ["═══ 잘못 찍힌 회차 도장 청소 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];
  var total = 0;

  function sweep(tab, col, label) {
    if (!tab || col < 1) return;
    var lr = tab.getLastRow();
    if (lr < 2) return;
    var rng = tab.getRange(2, col, lr - 1, 1);
    var vals = rng.getValues();
    var hit = 0;
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i][0];
      if (v instanceof Date) {
        // 연도가 09xx 면 도장이 삼켜진 것. 진짜 날짜는 20xx 다.
        if (v.getFullYear() < 1900) { vals[i][0] = ""; hit++; }
        continue;
      }
      if (BAD.test(String(v || "").trim())) { vals[i][0] = ""; hit++; }
    }
    if (hit) { rng.setValues(vals); total += hit; }
    L.push("  " + (hit ? "정리 " + hit + "건" : "이상 없음") + "  " + label);
  }

  // 1) 업체 전용양식 — 머리글이 "이슈"인 열
  try {
    var files = _pt_listFiles();
    for (var fi = 0; fi < files.length; fi++) {
      try {
        var ss = SpreadsheetApp.openById(files[fi].id);
        var tab = _peo_findFormTab_(ss);
        if (!tab) continue;
        var hdr = tab.getRange(1, 1, 1, Math.max(tab.getLastColumn(), 2)).getDisplayValues()[0];
        var col = -1;
        for (var h = 0; h < hdr.length; h++) {
          if (String(hdr[h] || "").replace(/\s/g, "") === "이슈") { col = h + 1; break; }
        }
        if (col < 1) { L.push("  건너뜀 (이슈 열 없음)  " + files[fi].name.replace("[협력업체] ", "")); continue; }
        sweep(tab, col, files[fi].name.replace("[협력업체] ", ""));
      } catch (eF) {
        L.push("  ★ " + files[fi].name + ": " + eF.message);
      }
    }
  } catch (eL) { L.push("★ 업체 목록 실패: " + eL.message); }

  // 2) 임시기록 이슈 열 (Z, 26번째)
  try {
    var hub = SpreadsheetApp.getActiveSpreadsheet();
    var tTab = hub.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
    sweep(tTab, 26, "대리공급_임시기록 (이슈)");
  } catch (eT) { L.push("★ 임시기록: " + eT.message); }

  L.push("");
  L.push(total ? "총 " + total + "건 정리했습니다." : "정리할 것이 없습니다.");
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("회차 도장 청소", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}
