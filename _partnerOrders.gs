/**
 * [협력업체] New 발주 시스템  v1.1
 * 파일: _partnerOrders.gs
 * 기존 orderSyncManager.gs 완전 독립
 *
 * 포함 기능:
 *   partnerCollectOrders()   — 전체 협력업체 발주 수집 → 협력업체_발주허브
 *   partnerFetchInvoices()   — 택배사 송장 수집 → 협력업체_발주허브 매칭
 *   partnerPushInvoices()    — 허브 송장번호 → 각 협력업체 시트 배포
 *   partnerShowOrderSummary()— 발주 현황 팝업
 *   partnerRepairOrderHeaders()— 발주탭 헤더 복구
 */

var _PO_HUB_SHEET_NAME = "협력업체_발주허브";
var _PO_HUB_HEADERS = [
  "수집일시",
  "발주업체",
  "고유ID",
  "주문일자",
  "이카운트코드",
  "품목명",
  "수량",
  "수취인",
  "수취인전화번호",
  "수취인주소",
  "배송메시지",
  "정산금액",
  "적요",
  "송장번호",
  "상태",
];

// ═══════════════════════════════════════════
//  택배사 열 (2026-08-31 신설)
//
//  송장수집 시점에 "이 송장이 어느 택배사 것인가"를 같이 남긴다.
//  판정은 _partnerExclusivePush.gs 의 _pep_carrierForArchiveRow_ 를 그대로 쓴다
//  (_carrier_origin_test.js 로 검증된 엔진 — 여기서 규칙을 다시 짜지 않는다).
//
//    허브        R열(18) — 표준 15열 뒤. P=판매갱신 lock, Q=미사용이라 R 로 잡았다
//    임시기록    V열(22) — 헤더 배열의 빈칸 자리
//    업체 발주탭 P열(16) — 허브 R열을 그대로 배포 (재판정 없음)
// ═══════════════════════════════════════════
var _PO_HUB_CARRIER_COL_ = 17;        // 0-based. 허브 R열
var _PO_HUB_CARRIER_HEADER_ = "택배사";
var _PO_VENDOR_CARRIER_COL_ = 16;     // 1-based. 업체 발주탭 P열
var _PO_VENDOR_CARRIER_HEADER_ = "택배사";

/** 시트에 최소 n열을 확보한다 (없으면 뒤에 붙인다) */
function _po_ensureCols_(tab, n) {
  try {
    var maxC = tab.getMaxColumns();
    if (maxC < n) tab.insertColumnsAfter(maxC, n - maxC);
  } catch (e) {}
}

/** 허브 R열(택배사) 확보 + 헤더 보수. 읽기/쓰기 전에 한 번 부른다 */
function _po_ensureHubCarrierCol_(hubTab) {
  if (!hubTab) return;
  _po_ensureCols_(hubTab, _PO_HUB_CARRIER_COL_ + 1);
  try {
    var h = hubTab.getRange(1, _PO_HUB_CARRIER_COL_ + 1);
    if (String(h.getValue() || "").trim() !== _PO_HUB_CARRIER_HEADER_) {
      h.setValue(_PO_HUB_CARRIER_HEADER_)
        .setBackground("#1f4e78")
        .setFontColor("white")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
    }
  } catch (e) {}
}

/**
 * 허브 행의 택배사 판정.
 *   ① 송장 출처(원천 탭 이름) — 로젠주문실적/롯데택배 탭이 곧 택배사다
 *   ② 발주업체명(B열)  ③ 이카운트코드(E열) → 출고지 → 택배사
 * 근거가 없으면 빈칸. 추측해서 채우지 않는다 (틀린 택배사가 빈칸보다 나쁘다).
 */
function _po_carrierForHubRow_(srcLabel, hubRow) {
  if (typeof _pep_carrierForArchiveRow_ !== "function") return "";
  try {
    return (
      _pep_carrierForArchiveRow_(
        null,
        srcLabel || "",
        hubRow ? hubRow[1] : "", // B열: 발주업체
        hubRow ? hubRow[4] : "", // E열: 이카운트코드
      ) || ""
    );
  } catch (e) {
    return "";
  }
}

/**
 * 임시기록 행의 택배사 판정.
 * 임시기록은 전부 대리공급이라 출처가 택배사를 알려주지 않는다 —
 * W열 업체prefix(「업체_택배사」표)가 1순위, D열 품목코드→출고지가 2순위다.
 */
function _po_carrierForTempRow_(tempRow) {
  if (!tempRow || typeof _pep_carrierForArchiveRow_ !== "function") return "";
  try {
    return (
      _pep_carrierForArchiveRow_(
        null,
        "대리공급",
        tempRow[_PO_TEMP_PFX_COL_] || "", // W열: 업체prefix
        tempRow[3] || "", // D열: 품목코드
      ) || ""
    );
  } catch (e) {
    return "";
  }
}

/** picked 목록(세트 다건)에서 택배사를 하나 고른다 — 첫 유효값 */
function _po_carrierFromPicked_(pickedList, hubRow) {
  if (!pickedList || !pickedList.length) return "";
  for (var i = 0; i < pickedList.length; i++) {
    var c = _po_carrierForHubRow_(pickedList[i] && pickedList[i].src, hubRow);
    if (c) return c;
  }
  return "";
}

/** 품절임박 대기 시 허브 N열(송장번호) 안내문구 — 실제 송장으로 취급하지 않음 */
var _PO_INV_PLACEHOLDER = "재고확인후 판단";

function _po_isInvPlaceholder_(v) {
  var s = String(v == null ? "" : v).replace(/\s/g, "").trim();
  if (!s) return false;
  if (s === _PO_INV_PLACEHOLDER.replace(/\s/g, "")) return true;
  if (s.indexOf("재고확인") !== -1 && s.indexOf("판단") !== -1) return true;
  return false;
}

/** 실제 송장번호가 있는지 (placeholder는 빈 것으로 간주) */
function _po_hasRealInvoice_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return false;
  if (_po_isInvPlaceholder_(s)) return false;
  return true;
}

function _po_isStockImminentStatus_(status) {
  return String(status == null ? "" : status).replace(/\s/g, "").indexOf("품절임박") !== -1;
}

function _po_isShipApprovedStatus_(status) {
  return String(status == null ? "" : status).replace(/\s/g, "").indexOf("출고가능") !== -1;
}

/** 확정 품절(임박·품절+7 제외) */
function _po_isSoldOutConfirmStatus_(status) {
  var s = String(status == null ? "" : status).replace(/\s/g, "");
  return s.indexOf("품절") !== -1 && s.indexOf("품절임박") === -1 && s.indexOf("품절+7") === -1;
}

/**
 * 재고확인 대기(품절임박과 동일 처리)
 * — 품절임박 + 품절(상품/주문/적요). 출고가능·품절+7 제외
 */
function _po_isStockWarnReviewStatus_(status) {
  if (_po_isShipApprovedStatus_(status)) return false;
  return (
    _po_isStockImminentStatus_(status) || _po_isSoldOutConfirmStatus_(status)
  );
}

/** 허브 종료 상태 — 재검토(품절/품절임박)로 O열을 덮지 않음 */
function _po_isTerminalHubStatus_(status) {
  var s = String(status == null ? "" : status).replace(/\s/g, "");
  return (
    s.indexOf("발송완료") !== -1 ||
    s.indexOf("취소") !== -1 ||
    s.indexOf("반품") !== -1 ||
    s.indexOf("폐기") !== -1 ||
    _po_isShipApprovedStatus_(s)
    // ★ 2026-08-06: 품절은 품절임박과 동일 재검토 → terminal 아님
  );
}

// ★ 2026-08-25: 품절임박 상태열 드롭다운 기능 제거.
//   데이터 유효성 검사는 행이 아니라 셀 범위에 붙는다. 허브에서 행을 지우면 아래 행의
//   규칙이 위로 끌려올라와 무관한 새 주문 행에 남고, 목록에 없는 상태값이 막혀
//   저장이 안 되는 문제가 반복됐다. 상태는 O열에 직접 입력하고 동기화만 수행한다.
//   시트에 남은 잔여 규칙은 partnerClearHubStatusDropdowns()로 정리한다.

/** 1-based 열번호 → A1 열문자 */
function _po_colToLetter_(col) {
  var n = Number(col) || 0;
  var s = "";
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

/** 허브 헤더에서 열 찾기 (1-based). 없으면 fallback */
function _po_findHubHeaderCol_(hub, keywords, fallbackCol) {
  try {
    var lc = Math.max(hub.getLastColumn(), fallbackCol || 15);
    var headers = hub.getRange(1, 1, 1, lc).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || "").replace(/\s/g, "");
      for (var k = 0; k < keywords.length; k++) {
        if (h.indexOf(keywords[k]) !== -1) return i + 1;
      }
    }
  } catch (eH) {}
  return fallbackCol || -1;
}

/** 품절임박 UI가 남기던 상태열 주황 배경 */
var _PO_STOCK_WARN_BG_ = "#ffe0b2";

/** 허브 특정 행들의 품절임박 드롭다운·노트·주황배경 제거 */
function _po_clearStockWarnDropdownRows_(hubTab, sheetRows) {
  if (!hubTab || !sheetRows || !sheetRows.length) return;
  var statusCol = _po_findHubHeaderCol_(hubTab, ["상태"], 15);
  var letter = _po_colToLetter_(statusCol);
  var uniq = {};
  for (var i = 0; i < sheetRows.length; i++) {
    var r = sheetRows[i];
    if (r >= 2) uniq[r] = true;
  }
  var rows = Object.keys(uniq)
    .map(function (x) { return parseInt(x, 10); })
    .sort(function (a, b) { return a - b; });
  var start = -1;
  var end = -1;
  function flush() {
    if (start < 0 || end < start) return;
    try {
      var rng = hubTab.getRange(letter + start + ":" + letter + end);
      rng.clearDataValidations();
      try { rng.clearNote(); } catch (eN) {}
      // 주황 배경만 되돌린다. 다른 색은 조건부서식·행 줄무늬이므로 건드리지 않는다.
      try {
        var bgs = rng.getBackgrounds();
        for (var bi = 0; bi < bgs.length; bi++) {
          if (String(bgs[bi][0] || "").toLowerCase() === _PO_STOCK_WARN_BG_) {
            hubTab.getRange(start + bi, statusCol).setBackground(null);
          }
        }
      } catch (eBg) {}
    } catch (eC) {}
    start = -1;
    end = -1;
  }
  for (var j = 0; j < rows.length; j++) {
    var rr = rows[j];
    if (start < 0) {
      start = rr;
      end = rr;
    } else if (rr === end + 1) {
      end = rr;
    } else {
      flush();
      start = rr;
      end = rr;
    }
  }
  flush();
}

/**
 * ★ 2026-08-25: 허브 상태열에 남은 품절임박 드롭다운 잔여물 일괄 제거 (메뉴)
 * 행 삭제로 위로 끌려올라온 유효성 검사·노트·주황배경이 새 주문 저장을 막는 것을 푼다.
 */
function partnerClearHubStatusDropdowns() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hub = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hub) {
    ui.alert("⚠️ 「" + _PO_HUB_SHEET_NAME + "」 탭이 없습니다.\n파일: " + ss.getName());
    return;
  }

  var statusCol = _po_findHubHeaderCol_(hub, ["상태"], 15);
  var letter = _po_colToLetter_(statusCol);
  // 빈 행에도 규칙이 남아 있으므로 데이터 끝이 아니라 시트 최대 행까지 훑는다.
  var lastRow = Math.max(hub.getMaxRows(), 2);
  var rng = hub.getRange(letter + "2:" + letter + lastRow);

  var dvCount = 0, noteCount = 0, bgCount = 0;
  try {
    var dvs = rng.getDataValidations();
    for (var i = 0; i < dvs.length; i++) if (dvs[i][0]) dvCount++;
  } catch (eD) {}
  try {
    var notes = rng.getNotes();
    for (var n = 0; n < notes.length; n++) if (String(notes[n][0] || "").trim()) noteCount++;
  } catch (eN) {}

  rng.clearDataValidations();
  try { rng.clearNote(); } catch (eN2) {}

  // 주황 배경만 되돌린다 (연속 구간 단위로 써서 호출 수를 줄인다)
  try {
    var bgs = rng.getBackgrounds();
    var runStart = -1;
    for (var b = 0; b <= bgs.length; b++) {
      var isWarn = b < bgs.length &&
        String(bgs[b][0] || "").toLowerCase() === _PO_STOCK_WARN_BG_;
      if (isWarn) {
        if (runStart < 0) runStart = b;
        bgCount++;
      } else if (runStart >= 0) {
        hub.getRange(runStart + 2, statusCol, b - runStart, 1).setBackground(null);
        runStart = -1;
      }
    }
  } catch (eB) {}

  ui.alert(
    "🧹 허브 상태열 드롭다운 정리 완료\n\n" +
      "파일: " + ss.getName() + "\n" +
      "탭: " + hub.getName() + "\n" +
      "범위: " + letter + "2:" + letter + lastRow + "\n\n" +
      "제거한 드롭다운: " + dvCount + "개\n" +
      "제거한 셀 노트: " + noteCount + "개\n" +
      "되돌린 주황 배경: " + bgCount + "개\n\n" +
      "이제 상태는 " + letter + "열에 직접 입력하세요.\n" +
      "✅출고가능 / 🚨품절 을 입력하면 업체 발주탭에 그대로 동기화됩니다."
  );
}

/**
 * 이카운트코드 정규화: 엑셀 복사-붙여넣기 시 포함되는 보이지 않는 문자 완전 제거
 * - \s (공백, 탭, 줄바꿈)
 * - \u00A0 (Non-Breaking Space)
 * - \u200B (Zero-Width Space)
 * - \uFEFF (BOM / Zero-Width No-Break Space)
 * - \u00AD (Soft Hyphen)
 * - \u200C~\u200F (방향/결합 제어 문자)
 * - \u2028~\u2029 (줄/단락 구분자)
 */
function _po_normalizeCode(raw) {
  return String(raw || "")
    .replace(/[\s\u00A0\u200B\uFEFF\u00AD\u200C-\u200F\u2028\u2029]/g, "");
}

function _po_getHubTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!tab) {
    tab = ss.insertSheet(_PO_HUB_SHEET_NAME);
    tab.getRange(1, 1, 1, _PO_HUB_HEADERS.length).setValues([_PO_HUB_HEADERS]);
    tab
      .getRange("1:1")
      .setBackground("#1f4e78")
      .setFontColor("white")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    tab.setFrozenRows(1);
    tab.setColumnWidth(1, 130);
    tab.setColumnWidth(11, 200);
    _po_applyHubDesign(tab);
  }
  // ★ 허브에 잘못 설정된 =FALSE 데이터 유효성 검사 자동 제거
  //   (협력업체 발주탭용 보호 규칙이 허브에 실수로 적용되는 경우 대응)
  try {
    var lastCol = Math.min(tab.getLastColumn(), _PO_HUB_HEADERS.length);
    for (var col = 1; col <= lastCol; col++) {
      var testCell = tab.getRange(2, col);
      var dv = testCell.getDataValidation();
      if (dv) {
        var criteria = dv.getCriteriaType();
        if (criteria === SpreadsheetApp.DataValidationCriteria.CUSTOM_FORMULA) {
          var args = dv.getCriteriaValues();
          if (args && args.length > 0 && String(args[0]).replace(/\s/g, "") === "=FALSE") {
            tab.getRange(2, col, Math.max(tab.getLastRow() - 1, 1), 1).clearDataValidations();
            Logger.log("[HUB] " + col + "열의 잘못된 =FALSE 유효성 검사 제거");
          }
        }
      }
    }
  } catch (eClean) {}
  return tab;
}

// ═══════════════════════════════════════════
//  유틸: 협력업체_발주허브 상태별 조건부서식
//  상태열 = O열 (15번째): 품절(핑크), 단종(회색), 재고까지만(노랑),
//  발송완료(연두), 합배송(연파랑)
// ═══════════════════════════════════════════
function _po_applyHubDesign(hubTab) {
  try {
    // ★ 2026-09-02: 범위를 5000행 고정에서 시트 전체로 바꿨다 ★
    //   허브는 계속 쌓이는 탭이다. 5000행을 넘는 순간 그 아래 행에는
    //   조건부서식이 아예 없어서, 송장이 들어와도 초록으로 안 바뀐다.
    //   "전에는 됐는데 언제부터 안 된다"의 정체가 이것이다.
    //   시트가 커지면 서식도 따라 커져야 한다.
    var _hubRows_ = Math.max(hubTab.getMaxRows() - 1, 1);
    var hRange = hubTab.getRange(2, 1, _hubRows_, 17); // A2:Q(끝)
    var rules = [];
    // ★ 출고가능 → 연초록 (품절보다 먼저 = 우선 적용)
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("출고가능", $O2))')
        .setBackground("#c8e6c9")
        .setRanges([hRange])
        .build(),
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("품절", $O2))')
        .setBackground("#f4cccc")
        .setRanges([hRange])
        .build(),
    );
    // ★ 품절임박 → 연주황
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("품절임박", $O2))')
        .setBackground("#ffe0b2")
        .setRanges([hRange])
        .build(),
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("단종", $O2))')
        .setBackground("#d9d9d9")
        .setRanges([hRange])
        .build(),
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("재고까지만", $O2))')
        .setBackground("#ffe599")
        .setRanges([hRange])
        .build(),
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("발송완료", $O2))')
        .setBackground("#d9ead3")
        .setRanges([hRange])
        .build(),
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("합배송", $O2))')
        .setBackground("#cfe2f3")
        .setRanges([hRange])
        .build(),
    );
    // ★ 2026-07-30: 기존 O열($O) 참조 규칙 제거 후 새로 적용 (중복 누적 방지)
    var existing = hubTab.getConditionalFormatRules() || [];
    var kept = [];
    for (var ei = 0; ei < existing.length; ei++) {
      var formula = "";
      try {
        var boolCond = existing[ei].getBooleanCondition();
        if (boolCond) {
          var vals = boolCond.getCriteriaValues();
          formula = vals && vals.length > 0 ? String(vals[0]) : "";
        }
      } catch (eGet) {}
      // $O 열 참조 수식이면 기존 허브 상태 규칙 → 제거 대상
      if (formula && formula.indexOf("$O") !== -1) continue;
      kept.push(existing[ei]);
    }
    hubTab.setConditionalFormatRules(rules.concat(kept));
    Logger.log("[허브CF] 조건부서식 재적용 완료: " + rules.length + "개 규칙, 기존 유지 " + kept.length + "개");
  } catch (e) {
    Logger.log("[허브CF] 오류: " + String(e.message || e));
  }
}

/**
 * _po_buildColMap → _pt_buildOrderTabColumnMap 위임.
 * orderSyncManager.gs의 완전한 헤더 인식기를 사용해
 * NK/GW/TY/AJ/KR/BW/HU/HR 등 업체별 커스텀 헤더를 모두 처리.
 * (받는사람, 고객명, 수하인, 판매수량, 주소1, 박스수량, 수하인번호 등)
 */
function _po_buildColMap(headers) {
  // _pt_buildOrderTabColumnMap 은 _partnerHelpers.gs에 이식된 완전한 버전
  {
    var full = _pt_buildOrderTabColumnMap(headers);
    // _po_buildColMap 하위호환 필드 추가 (addr, memo, note)
    full.addr =
      full.addrRecv !== -1
        ? full.addrRecv
        : full.addr !== -1
          ? full.addr
          : full.addr1;
    full.memo = full.msg; // 배송메시지
    full.note = full.voucherMemo; // 적요
    return full;
  }
  // fallback: 기본 단순 매핑
  var m = {
    date: -1,
    code: -1,
    item: -1,
    qty: -1,
    recipient: -1,
    phone: -1,
    addr: -1,
    memo: -1,
    msg: -1,
    unitPrice: -1,
    uniqueId: -1,
    status: -1,
    client: -1,
    note: -1,
    addrRecv: -1,
    addr1: -1,
    mobile: -1,
    voucherMemo: -1,
  };
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "")
      .replace(/\s/g, "")
      .toLowerCase();
    if (
      h.indexOf("주문일자") !== -1 ||
      h.indexOf("날짜") !== -1 ||
      h.indexOf("발주일") !== -1
    )
      m.date = i;
    else if (
      h.indexOf("이카운트") !== -1 ||
      h.indexOf("품목코드") !== -1 ||
      h.indexOf("상품코드") !== -1 ||
      h.indexOf("품번") !== -1
    )
      m.code = i;
    else if (h.indexOf("품목명") !== -1 || h.indexOf("상품명") !== -1)
      m.item = i;
    else if (
      h.indexOf("박스수량") !== -1 ||
      h.indexOf("판매수량") !== -1 ||
      h.indexOf("택배수량") !== -1
    ) {
      if (m.qty === -1) m.qty = i;
    } else if (h.indexOf("수량") !== -1) {
      if (m.qty === -1) m.qty = i;
    } else if (
      h.indexOf("수취인") !== -1 ||
      h.indexOf("받는분") !== -1 ||
      h.indexOf("받는사람") !== -1 ||
      h.indexOf("수령인") !== -1 ||
      h.indexOf("고객명") !== -1 ||
      h.indexOf("수하인") !== -1
    )
      m.recipient = i;
    else if (h.indexOf("모바일") !== -1 || h.indexOf("휴대폰") !== -1)
      m.mobile = i;
    else if (
      h.indexOf("전화") !== -1 ||
      h.indexOf("연락처") !== -1 ||
      h.indexOf("수하인번호") !== -1
    ) {
      if (m.phone === -1) m.phone = i;
    } else if (
      h.indexOf("수취인주소") !== -1 ||
      h.indexOf("수하인주소") !== -1 ||
      h.indexOf("배송지주소") !== -1
    )
      m.addrRecv = i;
    else if (h.indexOf("주소1") !== -1) m.addr1 = i;
    else if (h.indexOf("주소") !== -1) {
      if (m.addr === -1) m.addr = i;
    } else if (
      h.indexOf("배송메시지") !== -1 ||
      h.indexOf("배송메세지") !== -1 ||
      h.indexOf("특기사항") !== -1
    ) {
      m.msg = i;
      m.memo = i;
    } else if (
      h.indexOf("정산단가") !== -1 ||
      h.indexOf("정산금액") !== -1 ||
      h.indexOf("확정단가") !== -1
    )
      m.unitPrice = i;
    else if (h.indexOf("고유id") !== -1 || h.indexOf("uniqueid") !== -1)
      m.uniqueId = i;
    else if (h.indexOf("상태") !== -1) m.status = i;
    else if (h.indexOf("거래처") !== -1 || h.indexOf("업체") !== -1)
      m.client = i;
    else if (h.indexOf("적요") !== -1) {
      m.voucherMemo = i;
      m.note = i;
    }
  }
  m.addr = m.addrRecv !== -1 ? m.addrRecv : m.addr !== -1 ? m.addr : m.addr1;
  return m;
}

// 송장번호 열 위치 탐색 (헤더에서)
function _po_findInvoiceCol(headerRow) {
  for (var c = 0; c < headerRow.length; c++) {
    var h = String(headerRow[c] || "")
      .replace(/\s/g, "")
      .toLowerCase();
    if (
      h === "송장번호" ||
      h === "운송장번호" ||
      h === "운송장" ||
      h === "송장"
    )
      return c;
  }
  return -1;
}

// 수집 대상 탭인지 판단 (뷰어/설정/마감/송장번호/전용양식/단가/취소반품 탭 제외)
function _po_isOrderTab(tabName) {
  // 화이트리스트: '발주 및 송장조회' 탭에서만 수집
  return tabName === "발주 및 송장조회";
}

/**
 * 전용양식 헤더 패턴 감지 — 탭 이름에 "전용양식"이 없어도
 * 헤더 내용으로 전용양식임을 판별하여 수집을 차단한다.
 * 전용양식 특징: (공급가액 + 부가세) 또는 (택배수량 + 거래처명 + 배송방식)
 */
function _po_looksLikeExclusiveForm_(hdrJoined) {
  // 패턴 1: 이카운트 전용양식 (공급가액 + 부가세 조합)
  var hasSupply = hdrJoined.indexOf("공급가액") !== -1;
  var hasVat = hdrJoined.indexOf("부가세") !== -1;
  if (hasSupply && hasVat) return true;

  // 패턴 2: 뉴파츠 신규 양식 (택배수량 + 거래처명 + 배송방식)
  var hasParcelQty = hdrJoined.indexOf("택배수량") !== -1;
  var hasClientName = hdrJoined.indexOf("거래처명") !== -1;
  var hasDelivery = hdrJoined.indexOf("배송방식") !== -1;
  if (hasParcelQty && hasClientName && hasDelivery) return true;

  // 패턴 3: VAT/Vat 포함 열이 있으면 전용양식
  if (hdrJoined.toLowerCase().indexOf("vat") !== -1) return true;

  return false;
}

// ═══════════════════════════════════════════
//  발주 수집 (전체 협력업체 시트 → 허브)
// ═══════════════════════════════════════════
//  ★ 2026-07-16: 발주 수집 직전 자동입력 1회 채움
//  A(거래처) D(품목명) L(단가) 빈칸만 채움 — 이미 구축된 priceMap 재사용
//  ★ 2026-07-17: B(주문일자)는 여기서 채우지 않음 — 수집 성공 행에만 수집일 기록
// ═══════════════════════════════════════════
function _po_refreshAutofillBeforeCollect_(tab, priceMap, vendorName) {
  if (!tab) return 0;
  var lr = tab.getLastRow();
  if (lr < 2) return 0;

  // ★ 2026-07-20: 열별 수식 감지 — 수식이 남아있는 열만 쓰기 스킵 (스필 파괴 방지)
  //   D/L열 값 모드 전환으로, A1이 스필이어도 D/L 값 채움은 진행해야 함
  var aHasF = false, dHasF = false, lHasF = false;
  try {
    aHasF = !!String(tab.getRange("A1").getFormula() || "");
    dHasF = !!String(tab.getRange("D1").getFormula() || "");
    lHasF = !!String(tab.getRange("L1").getFormula() || "");
  } catch (_) {}

  // ★ 2026-07-20 (3차): 수집 직전 D/L 스필 막힘 무음 해제 (2계층 백필 — 운영자 확정 무음 복원 정책)
  //   수식은 있는데 헤더가 #REF!(복붙 값이 스필 차단)이면 해당 열 값만 걷어냄.
  //   토스트·알림 없음. 수식 재주입 아님(수식은 살아있음) → "자동복구 순환" 문제와 무관.
  try {
    if (dHasF || lHasF) {
      var _spillClr_ = false;
      if (dHasF && String(tab.getRange("D1").getDisplayValue() || "").indexOf("#REF") !== -1) {
        var _dEnd_ = 500;
        try {
          var _dM_ = String(tab.getRange("D1").getFormula() || "").match(/C2:C(\d+)/);
          if (_dM_) _dEnd_ = parseInt(_dM_[1], 10);
        } catch (_) {}
        tab.getRange(2, 4, _dEnd_ - 1, 1).clearContent();
        _spillClr_ = true;
      }
      if (lHasF && String(tab.getRange("L1").getDisplayValue() || "").indexOf("#REF") !== -1) {
        var _lEnd_ = 500;
        try {
          var _lM_ = String(tab.getRange("L1").getFormula() || "").match(/C2:C(\d+)/);
          if (_lM_) _lEnd_ = parseInt(_lM_[1], 10);
        } catch (_) {}
        tab.getRange(2, 12, _lEnd_ - 1, 1).clearContent();
        _spillClr_ = true;
      }
      if (_spillClr_) SpreadsheetApp.flush();
    }
  } catch (_) {}

  // ★ 2026-07-17: B열(주문일자) 사전 채움 제거 — 수집 성공 행에만 수집일 기록
  var nRows = lr - 1;
  var block = tab.getRange(2, 1, nRows, 14).getValues();
  var filled = 0;
  var map = priceMap || {};
  var aCol = [], dCol = [], lCol = [];
  var aChanged = false, dChanged = false, lChanged = false;

  for (var i = 0; i < block.length; i++) {
    var code = _po_normalizeCode(block[i][2]);
    var aVal = block[i][0];
    var dVal = block[i][3];
    var lVal = block[i][11];

    if (!aHasF && code && vendorName && !String(aVal || "").trim()) {
      aVal = vendorName;
      aChanged = true;
      filled++;
    }

    if (code) {
      var hit = map[code];
      if (hit) {
        if (!dHasF && !String(dVal || "").trim() && hit.name) {
          dVal = hit.name;
          dChanged = true;
          filled++;
        }
        if (!lHasF && (!String(lVal || "").trim() || lVal === 0) &&
            hit.price !== "" && hit.price != null) {
          lVal = hit.price;
          lChanged = true;
          filled++;
        }
      }
    }

    aCol.push([aVal]);
    dCol.push([dVal]);
    lCol.push([lVal]);
  }

  if (aChanged) tab.getRange(2, 1, nRows, 1).setValues(aCol);
  if (dChanged) tab.getRange(2, 4, nRows, 1).setValues(dCol);
  if (lChanged) tab.getRange(2, 12, nRows, 1).setValues(lCol);
  return filled;
}

/**
 * @param {boolean} [opt_noWriteBack] - true이면 허브 수집은 하되 업체시트에 "접수완료" 역기록 안 함
 *   (자동 트리거 전용)
 */
function partnerCollectOrders(opt_noWriteBack) {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  // ★ 2026-07-02: 동시 실행 방지 — 트리거+수동+웹앱 동시 호출 시 중복 수집 방지
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    var msg = "⚠ 발주 수집이 이미 실행 중입니다. 잠시 후 다시 시도하세요.";
    if (ui) { ui.alert(msg); } else { Logger.log("[COLLECT] " + msg); }
    return;
  }

  try { // ★ lock 해제를 보장하기 위한 try-finally

  var hubTab = _po_getHubTab();
  var lastRow = hubTab.getLastRow();

  // ── 1차 중복: 고유ID / 2차 중복: 이름+전화끝4+코드 (카운트 기반) ──
  // hubWasEmpty=true이면 허브가 비어있던 상태 → 2차 중복체크 비활성화 (재수집 허용)
  var hubWasEmpty = lastRow <= 1;
  var existingIds = {};
  var existingKeyCount = {};  // ★ 수정: boolean → count — 같은 키의 주문 건수를 추적
  if (!hubWasEmpty) {
    var hubAllData = hubTab
      .getRange(2, 1, lastRow - 1, _PO_HUB_HEADERS.length)
      .getValues();
    var phoneFixNeeded = false; // ★ 성능최적화: 전화번호 수정 필요 여부 추적
    for (var ei = 0; ei < hubAllData.length; ei++) {
      if (hubAllData[ei][2]) existingIds[String(hubAllData[ei][2])] = true; // C: 고유ID
      // ★ 성능최적화: 기존 전화번호 선행 0 복원 → 배열에 사전 반영 (개별 setValue 제거)
      var ePh = String(hubAllData[ei][8] || "").trim();
      if (/^\d{9,10}$/.test(ePh) && ePh[0] !== "0") {
        hubAllData[ei][8] = "0" + ePh;
        phoneFixNeeded = true;
      }
      // 2차 키: 수취인+전화끝4+코드 (카운트 기반)
      var eName = String(hubAllData[ei][7] || "").trim();
      var ePhD = String(hubAllData[ei][8] || "").replace(/[^0-9]/g, "");
      var eShrt = ePhD.length >= 4 ? ePhD.substring(ePhD.length - 4) : ePhD;
      var eCd = String(hubAllData[ei][4] || "").trim();
      if (eName && eCd) {
        var eKey = eName + "_" + eShrt + "_" + eCd;
        existingKeyCount[eKey] = (existingKeyCount[eKey] || 0) + 1;
      }
    }
    // ★ 성능최적화: 전화번호 수정 건이 있을 때만 I열 일괄 기록
    if (phoneFixNeeded) {
      var phVals = [];
      for (var phi = 0; phi < hubAllData.length; phi++) phVals.push([hubAllData[phi][8]]);
      hubTab.getRange(2, 9, hubAllData.length, 1).setNumberFormat("@");
      hubTab.getRange(2, 9, hubAllData.length, 1).setValues(phVals);
    }
  }

  var files = _pt_listFiles();
  var newOrders = [];

  // ★ 2026-07-01: 수집 시간 최적화 (수정 시간 체크)
  var props = PropertiesService.getScriptProperties();
  var lastCollectTime = parseInt(props.getProperty("LAST_ORDER_COLLECT_TIME") || "0", 10);
  
  // 수동 실행 시 전체 수집 여부 확인 (속도 체감을 위해 기본은 스마트 수집)
  var isForce = false;
  if (ui && !opt_noWriteBack) {
    var confirmSmart = ui.alert("🔍 스마트 수집", 
      "마지막 수집 이후 변경된 파일만 빠르게 수집할까요?\n\n" +
      "(수집 시간이 5~10배 단축됩니다. '아니오'를 누르면 전체 수집합니다.)", 
      ui.ButtonSet.YES_NO);
    if (confirmSmart === ui.Button.NO) isForce = true;
  }

  var targetFiles = [];
  if (isForce || lastCollectTime === 0 || hubWasEmpty) {
    targetFiles = files;
    if (ui) try { ss.toast("전체 업체 파일을 수집합니다...", "🚀 전체 수집", 5); } catch(_){}
  } else {
    for (var i = 0; i < files.length; i++) {
      // 파일 수정 시간이 마지막 수집 시간보다 크면 수집 대상
      if (files[i].modified > lastCollectTime) {
        targetFiles.push(files[i]);
      }
    }
    if (ui) {
      if (targetFiles.length === 0) {
        ui.alert("✅ 수집할 새로운 발주가 없습니다.\n(마지막 수집 이후 변경된 파일 없음)");
        return;
      }
      try { ss.toast(targetFiles.length + "개 업체에서 변경사항을 감지했습니다.", "⚡ 스마트 수집", 5); } catch(_){}
    }
  }
  var processingFiles = targetFiles;

  var deferredStatusWrites = []; // ★ 허브 기록 성공 후 업체 시트에 쓸 상태 큐
  var timeStr = Utilities.formatDate(
    new Date(),
    "Asia/Seoul",
    "yyyy-MM-dd HH:mm:ss",
  );
  var skipped = 0,
    skippedByCodeErr = 0,
    skippedByStatusFlag = 0,
    skippedByMissing = 0,
    errors = [];

  for (var fi = 0; fi < processingFiles.length; fi++) {
    var file = processingFiles[fi];
    try {
      var ss = SpreadsheetApp.openById(file.id);

      // ── 설정탭 B5(거래처명) 우선 → 파일명 폴백 ──
      // 판매현황 갱신의 vendorMap 키가 설정 B5 기준이므로 동일하게 맞춰야 함
      var _fileVendorLabel = file.name
        .replace("[협력업체] ", "")
        .replace(/\s*\(소비자용\).*$/, "")
        .trim();
      try {
        var _settingsTab = ss.getSheetByName("설정");
        if (_settingsTab) {
          var _b5Val = String(_settingsTab.getRange("B5").getValue() || "").trim();
          if (_b5Val) _fileVendorLabel = _b5Val;
        }
      } catch (_eB5) {}

      // ── 뷰어탭 단가맵 (A:상태, C:코드, D:품목명, G:최종단가) ──
      var priceMap = {},
        codeByName = {};
      var viewerTabForHeal = null;
      try {
        var vs = _pt_findViewerSheet(ss);
        if (!vs) {
          var allSh = ss.getSheets();
          for (var si = 0; si < allSh.length; si++) {
            var sn = allSh[si].getName();
            if (sn.indexOf("뷰어") !== -1 || sn.indexOf("단가조회") !== -1) {
              vs = allSh[si];
              break;
            }
          }
        }
        if (vs) {
          viewerTabForHeal = vs;
          if (vs.getLastRow() >= 3) {
            var pData = vs.getRange(3, 1, vs.getLastRow() - 2, 7).getValues();
            for (var p = 0; p < pData.length; p++) {
              var pCode = _po_normalizeCode(pData[p][2]);
              var pName = String(pData[p][3] || "").trim();
              if (pCode) {
                priceMap[pCode] = {
                  price: pData[p][6],
                  status: String(pData[p][0] || "").trim(),
                  name: pName,
                };
                if (pName && !codeByName[pName]) codeByName[pName] = pCode;
              }
            }
          }
        }
      } catch (eV) {}

      // ★ 2026-07-16: 발주 수집 직전 — 품목명/단가/거래처/일자 1회 채움
      //   (실시간 onEdit 차단·toast 제거에 따른 대체 경로)
      var targetTab = ss.getSheetByName("발주 및 송장조회");
      if (targetTab) {
        try {
          _po_refreshAutofillBeforeCollect_(targetTab, priceMap, _fileVendorLabel);
        } catch (eAf) {
          Logger.log("[COLLECT] 자동입력 리프레시 실패: " + (eAf.message || eAf));
        }
      }
      // try { _pt_autoCleanupBeforeCollect_(ss); } catch(eClean) {}
      var collectTabs = [];
      if (targetTab) {
        collectTabs.push(targetTab);
      } else {
        // 폴백: 탭 이름이 다르거나 특수 상황일 때만 전체 탭 탐색하여 스킵 방지
        var allTabs = ss.getSheets();
        for (var ti = 0; ti < allTabs.length; ti++) {
          if (_po_isOrderTab(allTabs[ti].getName())) {
            collectTabs.push(allTabs[ti]);
          }
        }
      }

      for (var ti = 0; ti < collectTabs.length; ti++) {
        var tab = collectTabs[ti];
        var tabName = tab.getName();

        // ★ 2차 안전장치: 전용양식 헤더 감지 → 전용양식 데이터 수집 차단
        //   전용양식 탭에만 존재하는 특징적 헤더 조합을 감지하여 스킵
        var lr = tab.getLastRow();
        if (lr <= 1) continue;
        var lc = Math.max(tab.getLastColumn(), 14);
        var data = tab.getRange(1, 1, lr, lc).getValues();
        var hdrJoined = data[0]
          .map(function (h) {
            return String(h || "").replace(/\s/g, "");
          })
          .join("|");
        if (_po_looksLikeExclusiveForm_(hdrJoined)) {
          Logger.log(
            "[COLLECT] 전용양식 헤더 감지 → 스킵: " +
              file.name +
              " / " +
              tabName,
          );
          continue;
        }
        var cMap = _po_buildColMap(data[0]);

        // ★ 2026-07-20 (2차): 수집 중 자동복구(수식 재주입/값 이관) 제거 — 운영자 결정
        //   D/L 스필 수식은 유지하되 수집은 수식을 건드리지 않음.
        //   #REF! 발생 시 복구는 메뉴(업체시트 관리·복구 → 발주탭 복구)에서 수동 실행.
        // ★ 2026-06-18: 유효성 검사 정리를 발주 수집에서 제거 (성능 최적화)
        //   → 복구시스템(AS도구)에서만 실행. D/L열 값 기반 전환 완료로 충돌 없음

        // ★ 2026-08-18: N열 상태 스필(수식 모드) 가드 — partnerPushInvoices와 동일
        //   N1이 수식인데 스필이 값에 막히면 헤더가 #REF!로 읽혀 cMap.status=-1이 됨.
        //   기존 "자동 보수"가 이때 P열에 "상태(자동)" 헤더+값을 만들던 문제 수정.
        var stFormulaMode = false;
        try {
          var _stGuard_ = _pt_guardVendorOrderStatusCol_(tab, cMap);
          if (_stGuard_) stFormulaMode = !!_stGuard_.formulaMode;
          if (_stGuard_ && _stGuard_.reloaded) {
            lc = Math.max(tab.getLastColumn(), 14);
            data = tab.getRange(1, 1, lr, lc).getValues();
            cMap = _po_buildColMap(data[0]);
            _stGuard_ = _pt_guardVendorOrderStatusCol_(tab, cMap);
            if (_stGuard_) stFormulaMode = !!_stGuard_.formulaMode;
          }
        } catch (eStatus) {}

        // 날짜·코드 모두 없어도 품목명/수량/수취인 중 하나라도 있으면 수집 시도
        var hasMinFields =
          cMap.item !== -1 || cMap.qty !== -1 || cMap.recipient !== -1;
        if (cMap.date === -1 && cMap.code === -1 && !hasMinFields) continue;

        // ★ 2026-06-18: spill 수식 자동복구를 발주 수집에서 제거 (성능 최적화)
        //   → D/L열 값 기반 전환 완료(6/17)로 heal 불필요
        //   → A열(ARRAYFORMULA) heal은 복구시스템(AS도구)에서만 실행

        // ── 주문일자: 사전 채움 폐기 (2026-07-17) ──
        //   B열은 수집 성공한 행에만 수집일을 덮어씀 (아래 수집 루프에서 처리)
        //   미수집 행(입력미완·중복·차단)은 B열을 건드리지 않음
        var dateFillChanged = false;
        var codeFillChanged = false;
        var idFillChanged = false;
        var statusFillChanged = false;

        // ★ 수취인 backfill 변수 초기화 (탭마다 리셋)
        var _po_prevRecipient = "",
          _po_prevPhone = "",
          _po_prevAddr = "";

        for (var r = 1; r < data.length; r++) {
          var code =
            cMap.code !== -1 ? _po_normalizeCode(data[r][cMap.code]) : "";
          var itemName =
            cMap.item !== -1 ? String(data[r][cMap.item] || "").trim() : "";

          // 품목명으로 코드 자동 보정
          if (!code && itemName && codeByName[itemName]) {
            code = codeByName[itemName];
            if (cMap.code !== -1) {
              data[r][cMap.code] = code;
              codeFillChanged = true;
            }
          }

          // "상품없음" 코드 스킵
          if (code && String(code).indexOf("상품없음") !== -1) {
            skipped++;
            continue;
          }

          // 완전히 빈 행만 스킵 (코드·품목명·수량 모두 없음)
          var qtyCheck =
            cMap.qty !== -1 ? String(data[r][cMap.qty] || "").trim() : "";
          if (!code && !itemName && !qtyCheck) {
            // ★ 빈 행 = 주문 묶음 경계 → backfill 리셋 (다른 사람 정보 이어짐 방지)
            _po_prevRecipient = "";
            _po_prevPhone = "";
            _po_prevAddr = "";
            continue;
          }
          var noCodeWarning = !code;
          // 코드는 있지만 단가조회 뷰어에 미등록된 경우
          var codeNotInViewer = !!(code && !priceMap[code]);

          // 수취인 정보
          var recipient =
            cMap.recipient !== -1
              ? String(data[r][cMap.recipient] || "").trim()
              : "";
          var phoneRaw = "";
          if (cMap.mobile !== -1)
            phoneRaw = String(data[r][cMap.mobile] || "").trim();
          if (!phoneRaw && cMap.phone !== -1)
            phoneRaw = String(data[r][cMap.phone] || "").trim();
          if (/^\d{9,10}$/.test(phoneRaw) && phoneRaw[0] !== "0")
            phoneRaw = "0" + phoneRaw;
          var addr = "";
          if (cMap.addrRecv !== -1)
            addr = String(data[r][cMap.addrRecv] || "").trim();
          if (!addr && cMap.addr1 !== -1)
            addr = String(data[r][cMap.addr1] || "").trim();
          if (!addr && cMap.addr !== -1)
            addr = String(data[r][cMap.addr] || "").trim();

          // ★ backfill 전 원본 값 보존 (필수 필드 검증은 원본 기준)
          var _origRecipient = recipient;
          var _origPhone = phoneRaw;
          var _origAddr = addr;

          // ★ 수취인 정보 backfill: 한 사람이 여러 건 발주 시 2번째 행부터 수취인/전화/주소가
          //   비어있으면 직전 유효 값을 자동으로 이어받는다.
          //   (업체 시트에서 첫 행에만 수취인 정보를 기입하는 관행 대응)
          if (!recipient && _po_prevRecipient) recipient = _po_prevRecipient;
          if (!phoneRaw && _po_prevPhone) phoneRaw = _po_prevPhone;
          if (!addr && _po_prevAddr) addr = _po_prevAddr;
          // 유효 값 갱신 (현재 행에 값이 있으면 다음 행을 위해 저장)
          if (recipient) _po_prevRecipient = recipient;
          if (phoneRaw) _po_prevPhone = phoneRaw;
          if (addr) _po_prevAddr = addr;

          // ★ 필수 필드 검증 — 미완이면 수집만 스킵 (상태열에 "입력미완" 기록 안 함)
          //   ★ 2026-07-16: 입력미완 상태 폐기 — 완료돼도 안 사라지는 잔류 문제
          var qty = cMap.qty !== -1 ? data[r][cMap.qty] : "";
          var qtyStr = String(qty || "").trim();
          var missingFields = [];
          if (!_origRecipient) missingFields.push("수취인");
          if (!_origPhone)  missingFields.push("전화번호");
          if (!_origAddr)       missingFields.push("주소");
          if (!qtyStr || qtyStr === "0") missingFields.push("수량");
          if (missingFields.length > 0) {
            // 기존에 남아있던 "입력미완" 상태만 비움
            if (cMap.status !== -1) {
              var curSt = String(data[r][cMap.status] || "");
              if (curSt.indexOf("입력미완") !== -1) {
                data[r][cMap.status] = "";
                statusFillChanged = true;
              }
            }
            skippedByMissing++;
            skipped++;
            continue;
          }

          // 고유ID 발급
          var uid =
            cMap.uniqueId !== -1
              ? String(data[r][cMap.uniqueId] || "").trim()
              : "";
          if (!uid) {
            uid =
              Utilities.formatDate(new Date(), "Asia/Seoul", "MMdd") +
              "-ds-" +
              Utilities.getUuid().substring(0, 4);
            if (cMap.uniqueId !== -1) {
              data[r][cMap.uniqueId] = uid;
              idFillChanged = true;
            }
          }

          // ── 1차(UID) + 2차(이름+전화끝4+코드, 카운트 기반) 중복 체크 ──
          // ★ 카운트 기반: 같은 사람이 같은 제품을 N건 주문 시
          //   허브에 이미 M건 있으면 소스에서 M+1번째 건부터 신규 수집
          // 허브가 비어있었으면 2차 체크 생략 (오류 후 재수집 보장)
          var phDigits = phoneRaw.replace(/[^0-9]/g, "");
          var shortPh =
            phDigits.length >= 4
              ? phDigits.substring(phDigits.length - 4)
              : phDigits;
          var dupKey = recipient + "_" + shortPh + "_" + code;
          var isDup = existingIds[uid];
          if (!isDup && !hubWasEmpty && recipient && code) {
            // 카운트 기반 중복 체크: 허브에 이미 있는 건수 이하이면 중복
            var hubCount = existingKeyCount[dupKey] || 0;
            if (hubCount > 0) {
              // 아직 허용 잔여분이 남아있지 않으면 중복
              isDup = true;
              existingKeyCount[dupKey] = hubCount - 1; // 차감하여 다음 동일 건은 통과
            }
          }
          if (isDup) {
            skipped++;
            continue;
          }
          existingIds[uid] = true;

          // 주문일자: 소스 시트 날짜와 무관하게 항상 수집 당일 날짜 사용
          var dateStr = Utilities.formatDate(
            new Date(),
            "Asia/Seoul",
            "yyyyMMdd",
          );

          // ── 품절/단종 상태 정밀 처리 (wasStockWarning 유지) ──
          var rawSt =
            cMap.status !== -1 ? String(data[r][cMap.status] || "").trim() : "";
          var stCompact = rawSt.replace(/\s/g, "");

          // ★ 적요(M)에 품절임박을 넣는 업체 대응 — 상태열뿐 아니라 적요도 검사
          var notePeek =
            cMap.voucherMemo !== -1
              ? String(data[r][cMap.voucherMemo] || "").trim()
              : cMap.note !== -1
                ? String(data[r][cMap.note] || "").trim()
                : "";
          var memoPeek =
            cMap.msg !== -1
              ? String(data[r][cMap.msg] || "").trim()
              : cMap.memo !== -1
                ? String(data[r][cMap.memo] || "").trim()
                : "";

          // ★ 2026-06-17: 품절임박도 허브 수집 (직원이 출고가능 판단)
          // ★ 2026-08-05: 적요/배송메시지에「품절임박」이 있어도 동일 취급
          // ★ 2026-08-06: 품절도 품절임박과 동일 — 재검토(🟡품절임박)로 수집
          var isStockWarnReview =
            _po_isStockWarnReviewStatus_(stCompact) ||
            _po_isStockWarnReviewStatus_(notePeek) ||
            _po_isStockWarnReviewStatus_(memoPeek);

          var wasStockWarn =
            stCompact.indexOf("재고부족") !== -1 ||
            stCompact.indexOf("🚨") !== -1;
          var status =
            stCompact.indexOf("취소") !== -1 ||
            stCompact.indexOf("발송완료") !== -1
              ? rawSt
              : "접수완료";

          // ★ 출고가능 상태는 유지 (이미 직원이 승인한 건)
          if (stCompact.indexOf("출고가능") !== -1) {
            status = "✅출고가능";
          } else if (isStockWarnReview) {
            status = "🟡품절임박";
          }

          if (priceMap[code]) {
            var ps = priceMap[code].status.replace(/\s/g, "");
            if (ps.indexOf("단종") !== -1) status = "🚨단종";
            else if (_po_isStockWarnReviewStatus_(ps)) {
              // ★ 2026-08-06/07: 상품정보 품절·품절임박 모두 재검토(🟡품절임박)
              if (status !== "✅출고가능") status = "🟡품절임박";
            }
            else if (wasStockWarn && status !== "✅출고가능") status = "접수완료";
          }
          if (noCodeWarning) status = "🔴코드확인필요";
          if (
            codeNotInViewer &&
            stCompact.indexOf("취소") === -1 &&
            stCompact.indexOf("발송완료") === -1
          ) {
            status = "🚨코드오류";
          }

          // ★ 상태는 업체 시트에 아직 쓰지 않음 → 허브 수집 성공 후 기록
          // 단종/코드오류/코드확인필요는 즉시 기록 + 수집 제외
          // 품절/품절임박은 즉시 기록 + 수집 포함 (직원이 출고가능 전환)
          var isBlockStatus =
            status === "🚨단종" || status === "🚨코드오류" || status === "🔴코드확인필요";
          var isWarningStatus =
            status.indexOf("🚨") !== -1 || status.indexOf("🔴") !== -1 || status.indexOf("🟡") !== -1;

          if (isWarningStatus && cMap.status !== -1 && !stFormulaMode && rawSt !== status) {
            data[r][cMap.status] = status;
            statusFillChanged = true;
          }

          // ★ 단종/코드오류만 수집 제외 — 품절/품절임박은 허브로 수집됨
          if (isBlockStatus) {
            if (status === "🚨코드오류") skippedByCodeErr++;
            skipped++;
            continue;
          }


          var memo =
            cMap.msg !== -1
              ? String(data[r][cMap.msg] || "").trim()
              : cMap.memo !== -1
                ? String(data[r][cMap.memo] || "").trim()
                : "";
          var note =
            cMap.voucherMemo !== -1
              ? String(data[r][cMap.voucherMemo] || "").trim()
              : cMap.note !== -1
                ? String(data[r][cMap.note] || "").trim()
                : "";
          var price = cMap.unitPrice !== -1 ? data[r][cMap.unitPrice] : "";
          if (!price && priceMap[code]) price = priceMap[code].price;
          // ★ 개별단가 정규화: L열이 구버전(price×qty)인 경우 qty로 나눠 단위단가로 환원
          var qtyNum = parseFloat(qty) || 0;
          var priceNum = parseFloat(price) || 0;
          if (priceNum > 0 && qtyNum > 1) {
            // L열 헤더가 "정산금액"이면 이미 곱해진 값 → 단가로 환원
            // ★ 수정: headers 미정의 → data[0] 사용
            var priceHeader =
              cMap.unitPrice !== -1
                ? String(data[0][cMap.unitPrice] || "").trim()
                : "";
            if (priceHeader === "정산금액") {
              price = Math.round(priceNum / qtyNum);
            }
          }

          // ★ 2026-07-17: 수집 성공 행의 B열(주문일자) = 수집일 덮어쓰기
          //   허브 주문일자(수집일)와 업체 발주탭 B열을 항상 일치시킴
          if (cMap.date !== -1 && String(data[r][cMap.date] || "") !== dateStr) {
            data[r][cMap.date] = dateStr;
            dateFillChanged = true;
          }

          // ★ 2026-08-25: 품절임박 N열 안내문구("재고확인후 판단") 자동입력 제거.
          //   실제 송장이 아닌 값이 송장열에 남아 마감·매칭 판정을 흐렸다.
          var invCell = "";

          newOrders.push([
            timeStr,
            _fileVendorLabel,
            uid,
            dateStr,
            code,
            itemName || (priceMap[code] ? priceMap[code].name : ""),
            qty,
            recipient,
            phoneRaw,
            addr,
            memo,
            price,
            note,
            invCell,
            status,
          ]);

          // ★ 허브 수집 성공 후 업체 시트에 "접수완료"를 기록하기 위한 deferred 큐
          if (!isWarningStatus && cMap.status !== -1 && !stFormulaMode && rawSt !== status) {
            deferredStatusWrites.push({
              tab: tab,
              row: r + 1, // 1-indexed 행 번호
              col: cMap.status + 1, // 1-indexed 열 번호
              status: status,
            });
          }
        } // end rows

        // ── 배치 setValues (행별 setValue 대신 일괄 쓰기 — 성능 최적화) ──
        var batchRows = data.length - 1;
        if (batchRows > 0) {
          if (dateFillChanged && cMap.date !== -1) {
            var dVals = [];
            for (var rd = 1; rd < data.length; rd++)
              dVals.push([data[rd][cMap.date]]);
            tab.getRange(2, cMap.date + 1, batchRows, 1).setValues(dVals);
          }
          if (codeFillChanged && cMap.code !== -1) {
            var cVals = [];
            for (var rc = 1; rc < data.length; rc++)
              cVals.push([data[rc][cMap.code]]);
            tab.getRange(2, cMap.code + 1, batchRows, 1).setValues(cVals);
          }
          if (idFillChanged && cMap.uniqueId !== -1) {
            var iVals = [];
            for (var ri = 1; ri < data.length; ri++)
              iVals.push([data[ri][cMap.uniqueId]]);
            tab.getRange(2, cMap.uniqueId + 1, batchRows, 1).setValues(iVals);
          }
          // ★ 경고 상태(품절/단종/코드확인)만 즉시 기록 — "접수완료"는 허브 성공 후
          // ★ 2026-07-16: N1에 MAP/ARRAYFORMULA 있으면 값 쓰기 금지 (#REF! 스필 충돌)
          if (statusFillChanged && cMap.status !== -1 && !stFormulaMode) {
            var _stHdrF_ = "";
            try { _stHdrF_ = String(tab.getRange(1, cMap.status + 1).getFormula() || ""); } catch (_) {}
            // ★ 2026-08-18: N1 수식(임의 수식)이 살아 있으면 값 쓰기 금지 — 스필 #REF! 방지
            if (!_stHdrF_) {
              var sVals = [];
              for (var rs = 1; rs < data.length; rs++)
                sVals.push([data[rs][cMap.status]]);
              tab.getRange(2, cMap.status + 1, batchRows, 1).setValues(sVals);
            }
          }
        }
      } // end tabs
    } catch (e) {
      errors.push(file.name + ": " + e.message);
    }
  } // end files

  // ── 허브에 신규 발주 일괄 추가 ──
  if (newOrders.length > 0) {
    // ★ 2026-06-18: 최종 중복 제거 (시간초과 후 재수집 시 부분 기록 중복 방지)
    //   허브 기록 직전에 현재 허브의 고유ID를 다시 읽어 중복 건 제거
    try {
      var freshLastRow = hubTab.getLastRow();
      if (freshLastRow >= 2) {
        var freshUids = hubTab.getRange(2, 3, freshLastRow - 1, 1).getValues(); // C열=고유ID
        var freshIdSet = {};
        for (var fu = 0; fu < freshUids.length; fu++) {
          var fuid = String(freshUids[fu][0] || "").trim();
          if (fuid) freshIdSet[fuid] = true;
        }
        var dedupOrders = [];
        var dedupSeen = {};
        var dedupRemoved = 0;
        for (var di = 0; di < newOrders.length; di++) {
          var orderUid = String(newOrders[di][2] || "").trim(); // 3번째=고유ID
          if (orderUid && (freshIdSet[orderUid] || dedupSeen[orderUid])) {
            dedupRemoved++;
            continue;
          }
          if (orderUid) dedupSeen[orderUid] = true;
          dedupOrders.push(newOrders[di]);
        }
        if (dedupRemoved > 0) {
          Logger.log("[COLLECT] 최종 중복 제거: " + dedupRemoved + "건 (허브 " + Object.keys(freshIdSet).length + "건 기준)");
          newOrders = dedupOrders;
        }
      }
    } catch (eDedup) {
      Logger.log("[COLLECT] 최종 dedup 실패: " + eDedup.message);
    }
  }

  if (newOrders.length > 0) {
    var startRow = hubTab.getLastRow() + 1;
    var writeRange = hubTab.getRange(
      startRow,
      1,
      newOrders.length,
      _PO_HUB_HEADERS.length,
    );
    // 수취인전화번호(9번째 열 = I열) 텍스트 포맷 강제 설정
    hubTab.getRange(startRow, 9, newOrders.length, 1).setNumberFormat("@");
    writeRange.setValues(newOrders);
    // 교차 배경색 (배치별 흰색 ↔ 옅은 회색)
    try {
      var prevBg =
        startRow > 2
          ? hubTab.getRange(startRow - 1, 1).getBackground()
          : "#ffffff";
      var bgColor = prevBg === "#f3f3f3" ? "#ffffff" : "#f3f3f3";
      hubTab
        .getRange(startRow, 1, newOrders.length, _PO_HUB_HEADERS.length)
        .setBackground(bgColor);
    } catch (eBg) {}
    // ★ 2026-08-25: 신규 구간 품절임박 드롭다운 부착 제거.
    //   행 삭제 시 규칙이 위로 밀려 무관한 행을 막던 원인이라 상태 직접입력으로 전환했다.
    SpreadsheetApp.flush();

    // ★ 허브 기록 성공 → 업체 시트에 "접수완료" 상태 역기록
    // ★ opt_noWriteBack=true(자동 트리거)이면 역기록 안 함 — 수동 수집에서만 작동
    if (!opt_noWriteBack && deferredStatusWrites.length > 0) {
      // ★ 성능최적화: 탭별 그룹핑 → 탭당 열 데이터 1회 읽기/쓰기
      var tabGroups = {};
      for (var dsi = 0; dsi < deferredStatusWrites.length; dsi++) {
        var ds = deferredStatusWrites[dsi];
        var tKey = ds.tab.getSheetId() + "_" + ds.col;
        if (!tabGroups[tKey]) tabGroups[tKey] = { tab: ds.tab, col: ds.col, rows: [] };
        tabGroups[tKey].rows.push({ row: ds.row, status: ds.status });
      }
      for (var tgk in tabGroups) {
        var tg = tabGroups[tgk];
        try {
          // ★ N1에 수식이 있는 경우(MAP/ARRAYFORMULA)에만 스킵 — 값 기반이면 직접 역기록
          var headerCell = tg.tab.getRange(1, tg.col);
          var headerFormula = String(headerCell.getFormula() || "");
          if (headerFormula) {
            continue; // 수식이 있으면 수식에 맡김 (Spill 에러 방지)
          }
          var tgLr = tg.tab.getLastRow();
          if (tgLr < 2) continue;
          var stVals = tg.tab.getRange(2, tg.col, tgLr - 1, 1).getValues();
          for (var tgi = 0; tgi < tg.rows.length; tgi++) {
            var idx = tg.rows[tgi].row - 2;
            if (idx >= 0 && idx < stVals.length) stVals[idx][0] = tg.rows[tgi].status;
          }
          tg.tab.getRange(2, tg.col, stVals.length, 1).setValues(stVals);
        } catch (eDs) {}
      }
      SpreadsheetApp.flush();
    }
  }

  // ★ 2026-08-25: 수집 종료 시 품절·품절임박 UI 소급 제거.
  //   O열을 🟡품절임박으로 덮고 N열 안내를 채우고 드롭다운을 다시 붙이던 경로였다.

  var msg =
    "📦 발주 수집 완료\n- 대상 파일: " +
    processingFiles.length +
    "개 (전체 " + files.length + "개 중)\n- 신규: " +
    newOrders.length +
    "건\n- 스킵: " +
    skipped +
    "건" +
    (skippedByCodeErr > 0
      ? "\n  ⚠ 코드오류(뷰어 미등록) 제외: " +
        skippedByCodeErr +
        "건 — 발주탭 적요에 🚨코드오류 기재됨"
      : "") +
    (skippedByMissing > 0
      ? "\n  ⚠ 필수정보 미입력 제외: " + skippedByMissing + "건 (수취인/전화/주소/수량)"
      : "") +
    (errors.length ? "\n- 오류:\n" + errors.join("\n") : "");
  
  // ★ 2026-07-01: 마지막 수집 시간 업데이트 (다음 스마트 수집용)
  // 단, 전체 수집(isForce)이었거나 성공적으로 끝난 경우에만 업데이트 권장하지만 
  // 여기서는 단순히 현재 시간으로 갱신 (오류난 파일은 다음 수집 시 다시 감지됨 - modified가 여전히 lastCollectTime보다 클 것이므로)
  props.setProperty("LAST_ORDER_COLLECT_TIME", String(Date.now()));

  Logger.log(msg);
  // ★ Google Chat 알림
  try { _chat_notifyCollectOrders_(newOrders.length, skipped, errors); } catch (eChat) {}
  if (ui) ui.alert(msg);

  } finally {
    // ★ 2026-07-02: 락 해제 보장
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════
//  [기존 허브 데이터 보정] 단가 열 일괄 수정
//  허브의 "정산금액" 열(12번째, index 11)에
//  qty×price 형태로 저장된 기존 데이터를 개별단가로 환원
// ═══════════════════════════════════════════
function partnerFixHubUnitPrices() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var hubTab = _po_getHubTab();
  var lr = hubTab.getLastRow();
  if (lr < 2) {
    if (ui) ui.alert("허브에 데이터가 없습니다.");
    return;
  }

  // 허브 헤더: 수집일시(1) 발주업체(2) 고유ID(3) 주문일자(4)
  //            이카운트코드(5) 품목명(6) 수량(7) ... 정산금액(12) ...
  // 0-based: qty=6, price=11
  var QTY_COL = 7; // 1-based (수량)
  var PRICE_COL = 12; // 1-based (정산금액)

  var data = hubTab.getRange(2, 1, lr - 1, _PO_HUB_HEADERS.length).getValues();
  var fixed = 0;
  var priceUpdates = []; // {row, val}

  for (var r = 0; r < data.length; r++) {
    var qtyNum = parseFloat(data[r][QTY_COL - 1]) || 0;
    var priceNum = parseFloat(data[r][PRICE_COL - 1]) || 0;
    if (priceNum <= 0 || qtyNum <= 1) continue;

    // 단가가 수량×단가보다 터무니없이 크면 이미 정규화된 것으로 판단
    // 예: 수량 3, 정산금액 900 → 개별단가 300 (정상 보정 대상)
    // 예: 수량 3, 정산금액 300 → 이미 개별단가 (보정 불필요)
    var unitPrice = Math.round(priceNum / qtyNum);
    // 보정 여부 판단: 원래 값이 단가×수량인지 확인
    // (단가×수량이라면 unitPrice×qtyNum ≈ priceNum)
    var reconstructed = unitPrice * qtyNum;
    var diff = Math.abs(reconstructed - priceNum);
    if (diff <= 1) {
      // 수량으로 나누어 딱 떨어지면 → 기존 값이 총액이었을 가능성 있음
      // 추가 검증: unitPrice가 priceNum보다 작아야 보정 의미 있음
      if (unitPrice < priceNum) {
        priceUpdates.push({ row: r + 2, val: unitPrice });
        fixed++;
      }
    }
  }

  if (priceUpdates.length === 0) {
    if (ui)
      ui.alert(
        "✅ 보정 대상 데이터가 없습니다.\n(이미 개별단가로 저장되어 있거나 수량이 1인 행만 있습니다.)",
      );
    return;
  }

  // 사용자 확인
  if (ui) {
    var ans = ui.alert(
      "📋 허브 단가 보정",
      "수량×단가 형태로 저장된 행이 " +
        priceUpdates.length +
        "건 감지됐습니다.\n" +
        "개별단가로 보정하시겠습니까?\n\n" +
        "(예: 수량3 × 단가300 → 정산금액 900이면 → 300으로 수정)",
      ui.ButtonSet.YES_NO,
    );
    if (ans !== ui.Button.YES) return;
  }

  // 일괄 업데이트 — ★ 2026-07-17 (M1): 행별 setValue → 열 단위 setValues 1회
  var priceColVals = hubTab.getRange(2, PRICE_COL, lr - 1, 1).getValues();
  for (var i = 0; i < priceUpdates.length; i++) {
    var pIdx = priceUpdates[i].row - 2;
    if (pIdx >= 0 && pIdx < priceColVals.length) {
      priceColVals[pIdx][0] = priceUpdates[i].val;
    }
  }
  hubTab.getRange(2, PRICE_COL, lr - 1, 1).setValues(priceColVals);
  SpreadsheetApp.flush();

  var result = "✅ 허브 단가 보정 완료\n보정 건수: " + fixed + "건";
  Logger.log(result);
  if (ui) ui.alert(result);
}

// ═══════════════════════════════════════════
//  송장 수집 (기존 송장취합시트 → 협력업체_발주허브)
// ═══════════════════════════════════════════
/**
 * 기존 시스템과 동일한 송장 취합 스프레드시트를 읽어 협력업체_발주허브에 송장번호를 매칭 기록.
 * 매칭 우선순위: 고유ID 전용 (이름 단독 매칭 제거 — 동명이인 오매칭 방지)
 * ★ 2026-06-18: 적요(M열)에 내용이 있어도 송장 수집 진행하도록 변경
 */
function partnerFetchInvoices() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var hubTab = _po_getHubTab();
  var hubLr = hubTab.getLastRow();
  if (hubLr < 2) {
    if (ui)
      ui.alert("허브에 발주 데이터가 없습니다.\n먼저 발주 수집을 실행하세요.");
    return;
  }

  // ── 폐기송장 목록 로드 ──
  var voidSet = _po_loadVoidInvoiceSet_();
  var voidKeyCount = Object.keys(voidSet).length;

  var invoiceMap = {};
  var scannedLogs = [];
  // ★ 2026-08-26: 원천 읽기 실적·배정 근거를 이번 실행 단위로 모은다.
  //   근거를 남기지 않으면 나중에 점검해도 '근거없음'만 나온다.
  if (typeof _pt_ingestStatReset_ === "function") _pt_ingestStatReset_();
  if (typeof _pt_evStatReset_ === "function") _pt_evStatReset_();
  _po_markExecStart_(); // 2차 폴백이 남은 실행시간을 판단할 기준
  if (voidKeyCount > 0)
    scannedLogs.push("폐기송장 목록: " + voidKeyCount + "개 키 로드됨");

  // ── ★ 합배송 전용 시트: 이름+전화 키 + Q열(고유ID) 수집 ──
  var combinedShipmentKeySet = {};
  var combinedUidSet = {};  // ★ Q열 고유ID 기반 합배송 판정용
  try {
    var _csSS = SpreadsheetApp.openById(_PT_COMBINED_INVOICE_SHEET_ID);
    var _csTab = _pt_getSheetByGid(_csSS, _PT_COMBINED_INVOICE_SHEET_GID);
    if (_csTab && _csTab.getLastRow() > 1) {
      var _csLc = Math.max(_csTab.getLastColumn(), 17); // Q열(17)까지 보장
      var _csData = _csTab
        .getRange(1, 1, _csTab.getLastRow(), _csLc)
        .getValues();
      var _csHeaders = _csData[0];
      var _csNameIdx = -1,
        _csPhoneIdx = -1;
      for (var _ci = 0; _ci < _csHeaders.length; _ci++) {
        var _ch = String(_csHeaders[_ci]).replace(/\s/g, "");
        if (
          _csNameIdx === -1 &&
          _ch.match(/이름|고객명|수취인|수령인|받는분|받는사람|수하인/)
        )
          _csNameIdx = _ci;
        if (
          _csPhoneIdx === -1 &&
          _ch.match(
            /연락처|전화번호|모바일|핸드폰|휴대폰|수하인전화|받는전화|전화/,
          )
        )
          _csPhoneIdx = _ci;
      }
      if (_csNameIdx !== -1 && _csPhoneIdx !== -1) {
        for (var _cr = 1; _cr < _csData.length; _cr++) {
          var _csName = String(_csData[_cr][_csNameIdx] || "").trim();
          var _csPh = String(_csData[_cr][_csPhoneIdx] || "").replace(
            /[^0-9]/g,
            "",
          );
          var _csKey = normalizeHubRecipientPhoneKey_(_csName, _csPh);
          if (_csKey && _csKey !== "_") combinedShipmentKeySet[_csKey] = true;
        }
      }
      // ★ Q열(index 16) 고유ID 수집
      var _csUidCol = 16; // Q열 = 0-based 16
      for (var _cr2 = 1; _cr2 < _csData.length; _cr2++) {
        var _csUid = String(_csData[_cr2][_csUidCol] || "").trim();
        if (_csUid) combinedUidSet[_csUid] = true;
      }
      scannedLogs.push(
        "[합배송 전용] 이름+전화 키 " +
          Object.keys(combinedShipmentKeySet).length +
          "개, UID " + Object.keys(combinedUidSet).length + "개 로드됨",
      );
    }
  } catch (_csErr) {
    scannedLogs.push(
      "[합배송 전용 키 로드] " + String(_csErr.message || _csErr),
    );
  }

  // ── ★ [최우선] 입력_로젠주문실적 (GID: 548505068) ──
  // E열(idx4)=주문번호(고유ID), F열(idx5)=운송장번호, J열(idx9)=명(수취인)
  // M열(idx12)=전화번호, W열(idx22)=물품명
  var _ROZEN_FIXED_COL = {
    name: 9,
    phone: 12,
    invoice: 5,
    uid: 4,
    item: 22,
    icode: 21,
    qty: 14,
  };
  try {
    var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
    var primaryTab = _pt_getSheetByGid(invSS, _PT_PRIMARY_INVOICE_GID);
    if (primaryTab && primaryTab.getLastRow() > 1) {
      _pt_ingestInvoiceSheetTabIntoMap(
        primaryTab,
        invoiceMap,
        "★최우선(로젠주문실적)",
        scannedLogs,
        _ROZEN_FIXED_COL, // ★ 로젠 고정 열 인덱스 전달
      );
    } else {
      scannedLogs.push(
        "[최우선] GID " + _PT_PRIMARY_INVOICE_GID + " 탭 없음 또는 비어있음",
      );
    }
  } catch (ePri) {
    scannedLogs.push("[최우선] " + String(ePri.message || ePri));
  }

  // ── ★ 2026-07-22 / 08-07: [롯데택배] 송장 탭 (GID: 1575029201) ──
  // F열(idx5)=수취인명, G열(idx6)=운송장번호, J열(idx9)=주문번호(고유ID/사방넷)
  // AC열(idx28)=상품명(세트상세 "---몸통만" 등 포함)
  // ★ 2026-07-30: name(F열), item(AC열) 추가 — 세트 스코어링/적요 생성 정상화
  //   전화번호는 개인정보 미포함(-1)
  var _NEWCOURIER_FIXED_COL =
    typeof _PT_LOTTE_FIXED_COL !== "undefined"
      ? _PT_LOTTE_FIXED_COL
      : {
          name: 5,
          phone: -1,
          invoice: 6,
          uid: 9,
          item: 28,
          icode: -1,
          qty: -1,
        };
  try {
    var invSS2 = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
    var secondaryTab = _pt_getSheetByGid(invSS2, _PT_SECONDARY_INVOICE_GID);
    if (secondaryTab && secondaryTab.getLastRow() > 1) {
      _pt_ingestInvoiceSheetTabIntoMap(
        secondaryTab,
        invoiceMap,
        "롯데택배",
        scannedLogs,
        _NEWCOURIER_FIXED_COL,
      );
    } else {
      scannedLogs.push(
        "[롯데택배] GID " + _PT_SECONDARY_INVOICE_GID + " 탭 없음 또는 비어있음",
      );
    }
  } catch (eSec) {
    scannedLogs.push("[롯데택배] " + String(eSec.message || eSec));
  }

  // ── 합배송 전용 시트 읽기 ──
  try {
    var combSS = SpreadsheetApp.openById(_PT_COMBINED_INVOICE_SHEET_ID);
    var combTab = _pt_getSheetByGid(combSS, _PT_COMBINED_INVOICE_SHEET_GID);
    if (combTab && combTab.getLastRow() > 1) {
      _pt_ingestInvoiceSheetTabIntoMap(
        combTab,
        invoiceMap,
        "합배송전용",
        scannedLogs,
      );
    }
  } catch (eComb) {
    scannedLogs.push("[합배송] " + String(eComb.message || eComb));
  }

  var mapSize = Object.keys(invoiceMap).length;
  scannedLogs.push("중앙 송장취합 키 수: " + mapSize + "개");

  // ── 협력업체 시트 역수집: 각 파일의 전용양식탭에서 직접 기입된 송장번호 수집 ──
  // (NK: 전용양식 A열=송장번호/C=받는사람/D=전화번호, GW/TY 등 커스텀 형식 모두 지원)
  var partnerInvCount = 0;
  var _partnerTabCache = []; // ★ 데이터 캐시: 비협력업체 수집 시 재사용 (파일 재열기 방지)
  var _issueByUid = {}; // ★ 2026-07-07: 전용양식 B열 이슈 내용 수집 (UID → 이슈텍스트)
  try {
    var pFiles = _pt_listFiles(true); // ★ 2026-07-28: 강제 새로고침 — 캐시된 modified 타임스탬프로 스마트스캔 누락 방지
    // ★ 2026-07-28: Drive modified 타임스탬프 지연으로 뉴파츠 등 전용양식 수집 누락 방지
    //   협력업체 파일은 10~15개 내외이므로 항시 전체 파일 스캔 진행 (수집 속도 1~2초 유지)
    var _scanFiles = pFiles;
    scannedLogs.push("[전용양식 역수집] 전체 협력업체 시트(" + _scanFiles.length + "개) 항시 스캔 진행");
    for (var pfi = 0; pfi < _scanFiles.length; pfi++) {
      try {
        var pss = SpreadsheetApp.openById(_scanFiles[pfi].id);
        var ptabs = pss.getSheets();
        for (var pti = 0; pti < ptabs.length; pti++) {
          var ptName = ptabs[pti].getName();
          // ★ 전용양식 탭만 대상 (발주탭·뷰어·단가조회·공급가·설정·마감 등 제외)
          if (
            ptName.indexOf("발주 및 송장조회") !== -1 ||
            ptName.indexOf("뷰어") !== -1 ||
            ptName.indexOf("단가조회") !== -1 ||
            ptName.indexOf("공급가") !== -1 ||
            ptName.indexOf("단가") !== -1 ||
            ptName.indexOf("설정") !== -1 ||
            ptName.indexOf("마감") !== -1
          ) {
            continue;
          }
          // 그 외 '전용양식', '송장', '양식', '뉴파츠', 'NEW', 'HR' 포함 탭 또는 일반 탭 수집
          var isFormTab =
            ptName.indexOf("전용양식") !== -1 ||
            ptName.indexOf("송장") !== -1 ||
            ptName.indexOf("양식") !== -1 ||
            ptName.indexOf("뉴파츠") !== -1 ||
            ptName.indexOf("NEW") !== -1 ||
            ptName.indexOf("HR") !== -1;
          if (!isFormTab && ptabs.length > 2) {
            // 탭이 여러 개인데 위 키워드가 전혀 없으면 제외
            continue;
          }
          var ptab = ptabs[pti];
          var ptLr = ptab.getLastRow();
          if (ptLr <= 1) continue;
          var ptLc = Math.max(ptab.getLastColumn(), 50); // AX열(50) 고유ID 포함 보장
          // ★ 데이터 1회만 읽기 → invoiceMap 인제스트 + 비협력업체 수집 공유
          var ptData = ptab.getRange(1, 1, ptLr, ptLc).getValues();
          var vendorLabelForLog =
            _scanFiles[pfi].name.replace("[협력업체] ", "") + "/" + ptName;
          var vendorN = _scanFiles[pfi].name.replace("[협력업체] ", "").trim();
          var prevSize = Object.keys(invoiceMap).length;
          _pt_ingestInvoiceSheetTabIntoMap(
            ptab,
            invoiceMap,
            vendorLabelForLog,
            scannedLogs,
            null,
            ptData, // preloadedData 전달 → getValues() 재호출 없음
          );
          partnerInvCount += Object.keys(invoiceMap).length - prevSize;

          // ★ 2026-07-08: B열(이슈) 수집 — 송장번호가 아직 없는 행에서만
          // 전용양식 구조: A=송장번호(0), B=이슈(1), AX열(49)=고유ID
          for (var _bi = 1; _bi < ptData.length; _bi++) {
            var _bInvoice = String(ptData[_bi][0] || "").trim();
            // ★ B열에는 푸시 회차 도장(0901-1)이 먼저 찍혀 있다.
            //   도장을 떼고 남은 것만 업체가 쓴 이슈다. 안 떼면 모든 행이
            //   "이슈 있음"으로 잡혀 이슈 목록이 쓸모없어진다.
            var _bIssue = (typeof _pep_stripPushStamp_ === "function")
              ? _pep_stripPushStamp_(ptData[_bi][1])
              : String(ptData[_bi][1] || "").trim();
            if (!_bIssue || _bInvoice) continue; // 이슈 없거나 송장 이미 있으면 스킵
            // 고유ID 탐색 (AX열=49 우선, 역방향 탐색)
            var _bUid = "";
            // AX열(49) 직접 확인
            if (ptData[_bi].length > 49) {
              var _axVal = String(ptData[_bi][49] || "").trim();
              if (_axVal) _bUid = _axVal;
            }
            // AX열에 없으면 역방향 탐색 (대리공급: MMDD-ph-XXXX, 직접매핑: XX-XXXX 등)
            if (!_bUid) {
              for (var _uc = ptLc - 1; _uc >= 10; _uc--) {
                var _uVal = String(ptData[_bi][_uc] || "").trim();
                if (_uVal && /^(?:[A-Z]{2,3}[-_]|\d{4}-ph-)/.test(_uVal)) {
                  _bUid = _uVal;
                  break;
                }
              }
            }
            if (_bUid) {
              _issueByUid[_bUid] = _bIssue;
            }
          }

          // 비협력업체 수집용 캐시 저장
          _partnerTabCache.push({
            data: ptData,
            vendorName: vendorN,
            tabName: ptName,
          });
        }
      } catch (ePf) {
        scannedLogs.push(
          "[협력업체스캔] " +
            _scanFiles[pfi].name +
            ": " +
            String(ePf.message || ePf),
        );
      }
    }
  } catch (ePAll) {
    scannedLogs.push("[협력업체스캔 전체] " + String(ePAll.message || ePAll));
  }
  scannedLogs.push(
    "협력업체 전용양식 역수집 키 추가: " + partnerInvCount + "개",
  );

  var totalMapSize = Object.keys(invoiceMap).length;
  if (totalMapSize === 0) {
    if (ui)
      ui.alert(
        "송장 데이터를 불러오지 못했습니다.\n\n" + scannedLogs.join("\n"),
      );
    return;
  }
  scannedLogs.push("최종 매칭 키 수: " + totalMapSize + "개");

  // ── 폐기송장 필터링: invoiceMap에서 폐기 송장번호를 가진 엔트리 제거 ──
  var voidFilteredSet = {}; // 고유 송장번호 기준 집계
  if (voidKeyCount > 0) {
    for (var mapKey in invoiceMap) {
      var entries = invoiceMap[mapKey];
      var cleaned = [];
      for (var ei = 0; ei < entries.length; ei++) {
        var invRawVal = String(
          entries[ei].invRaw || entries[ei].invoice || "",
        ).trim();
        var isVoid =
          voidSet[invRawVal] || voidSet[invRawVal.replace(/[^0-9]/g, "")];
        if (!isVoid) {
          cleaned.push(entries[ei]);
        } else {
          voidFilteredSet[invRawVal] = true; // 고유 송장번호만 집계
        }
      }
      if (cleaned.length > 0) {
        invoiceMap[mapKey] = cleaned;
      } else {
        delete invoiceMap[mapKey];
      }
    }
    var voidFilteredCount = Object.keys(voidFilteredSet).length;
    if (voidFilteredCount > 0)
      scannedLogs.push(
        "폐기송장 필터링: " +
          voidFilteredCount +
          "개 송장 제거 (중복키 포함 처리)",
      );
  }

  // ── 허브 데이터 읽기 ──
  // ★ R열(택배사)까지 읽는다 — 배치 쓰기가 열 전체를 다시 쓰므로 기존 값이 필요하다
  _po_ensureHubCarrierCol_(hubTab);
  var hubData = hubTab
    .getRange(2, 1, hubLr - 1, _PO_HUB_CARRIER_COL_ + 1)
    .getValues();
  var matched = 0,
    alreadyHas = 0,
    noMatch = 0;
  var writeUpdates = []; // {row, inv, status, writeInvoice}
  var globalUsedInvoices = {};
  // ★ 허브에 이미 존재하는 송장번호를 globalUsedInvoices에 사전 등록
  // → 동일 이름(name+phone)으로 다른 행이 같은 송장을 중복 배정받는 버그 방지
  for (var _pri = 0; _pri < hubData.length; _pri++) {
    var _preInv = String(hubData[_pri][13] || "").trim();
    if (!_po_hasRealInvoice_(_preInv)) continue;
    var _preInvParts = _preInv.split(/[\n,;\/]+/);
    for (var _pp = 0; _pp < _preInvParts.length; _pp++) {
      var _pt = _preInvParts[_pp].trim();
      if (_pt && _po_hasRealInvoice_(_pt)) globalUsedInvoices[_pt] = true;
    }
  }
  var unmatchedDiag = []; // 미매칭 진단
  // ── [최우선] 고유ID 직접 매칭 패스 ──
  // 고유ID가 있는 허브 행은 이름/전화번호 무시하고 고유ID로 직접 매칭
  var uidMatchedSet = {}; // rowIndex → true (고유ID로 매칭 완료된 행)
  var uidMatchCount = 0;

  // ★ UID 디버깅: invoiceMap에서 우리 시스템 UID 형식(MMdd-행-uuid) 키 샘플 수집
  var uidKeySamples = [];
  for (var _mk in invoiceMap) {
    if (/^\d{4}-\d+-/.test(_mk)) { uidKeySamples.push(_mk); }
    if (uidKeySamples.length >= 5) break;
  }
  // 허브 UID 샘플 (미매칭 행만)
  var hubUidSamples = [];
  for (var _hr = 0; _hr < hubData.length && hubUidSamples.length < 5; _hr++) {
    if (String(hubData[_hr][13] || "").trim() && _po_hasRealInvoice_(hubData[_hr][13])) continue; // 이미 입력된 행 스킵
    var _hu = String(hubData[_hr][2] || "").trim();
    if (_hu) hubUidSamples.push("R" + (_hr + 2) + "=" + _hu);
  }
  scannedLogs.push(
    "UID디버그 invoiceMap키(" + uidKeySamples.length + "): " + (uidKeySamples.join(", ") || "(없음)")
  );
  scannedLogs.push(
    "UID디버그 허브UID(" + hubUidSamples.length + "): " + (hubUidSamples.join(", ") || "(없음)")
  );

  for (var r = 0; r < hubData.length; r++) {
    var existingInv0 = String(hubData[r][13] || "").trim();
    if (_po_hasRealInvoice_(existingInv0)) {
      alreadyHas++;
      continue;
    }
    if (isTerminalOrderStatus_(String(hubData[r][14] || ""))) continue;
    if (String(hubData[r][14] || "").trim() === "발송완료") continue;
    // ★ 2026-06-18: 적요(M열=12)에 내용이 있어도 송장 수집 진행 (제한 해제)

    var hubUid = String(hubData[r][2] || "").trim();
    // ★ 직접 UID 없거나 invoiceMap에 없으면 파생 UID(push 형식 MMdd-ph-XXXX) 재시도
    var _matchMapKey_ = hubUid;
    if (!_matchMapKey_ || !invoiceMap[_matchMapKey_]) {
      try {
        var _dk_ = _pt_deriveHubRowPepUid_(hubData[r]);
        if (_dk_ && invoiceMap[_dk_]) {
          _matchMapKey_ = _dk_;
          if (scannedLogs.length < 80)
            scannedLogs.push("[파생UID] R"+(r+2)+" hub=["+(hubUid||"없음")+"] → pep=["+_dk_+"]");
        }
      } catch (eDk_) {}
    }
    if (!_matchMapKey_) continue; // C열 없고 파생도 실패 → name+phone으로
    if (!invoiceMap[_matchMapKey_]) continue; // C열 있지만 모든 키 미매칭 → pass2에서 차단

    // invoiceMap에서 고유ID(직접 또는 파생)로 조회
    if (invoiceMap[_matchMapKey_]) {
      var uidCandidates = parseInvoiceLinesFromMatchedRows_(
        invoiceMap[_matchMapKey_],
        globalUsedInvoices,
      );
      if (uidCandidates.length > 0) {
        // ★ 같은 고유ID에 송장이 여러 개(세트 구성품 등)이면 전부 수집
        var needSlots0 = Math.max(_pt_getRequiredParcelSlots(hubData[r]), uidCandidates.length);
        // ★ 세트 디버그: candidates detail 확인
        if (uidCandidates.length >= 2) {
          var dbgDetails = uidCandidates
            .map(function (c, i) {
              return (
                "  [" +
                i +
                "] inv=" +
                c.inv +
                " detail=" +
                JSON.stringify(c.detail)
              );
            })
            .join("\n");
          Logger.log(
            "[세트디버그] UID=" +
              _matchMapKey_ +
              " need=" +
              needSlots0 +
              " candidates=" +
              uidCandidates.length +
              "\n" +
              dbgDetails,
          );
        }
        var pickedInvs0 = _pt_pickInvoicesForHubRow(
          uidCandidates,
          hubData[r],
          needSlots0,
          globalUsedInvoices,
        );
        if (pickedInvs0.length > 0) {
          var invCell0 = pickedInvs0
            .map(function (p) {
              return p.inv;
            })
            .join("\n");
          // ★ 세트 상세 → 적요 (예: "몸통만\n뚜껑만")
          var detailCell0 = pickedInvs0
            .map(function (p) {
              return p.setDetail || "";
            })
            .join("\n")
            .trim();
          // ★ 세트 디버그: picked 결과 확인
          if (pickedInvs0.length >= 2 || detailCell0) {
            Logger.log(
              "[세트디버그] UID=" +
                _matchMapKey_ +
                " picked=" +
                pickedInvs0.length +
                " invCell=" +
                JSON.stringify(invCell0) +
                " detailCell=" +
                JSON.stringify(detailCell0),
            );
          }
          hubData[r][13] = invCell0;
          writeUpdates.push({
            row: r + 2,
            inv: invCell0,
            setDetail: detailCell0,
            status: "발송완료",
            writeInvoice: true,
            carrier: _po_carrierFromPicked_(pickedInvs0, hubData[r]),
          });
          matched++;
          uidMatchCount++;
          uidMatchedSet[r] = true;
          continue;
        }
      }
    }
  }
  scannedLogs.push("★ 고유ID 직접 매칭: " + uidMatchCount + "건");

  // ── ★ [합배송] 고유ID 기반 합배송 처리 ──
  // 합배송 시트 Q열의 UID를 가진 허브 행을 수취인 이름으로 그룹핑
  // 같은 이름 그룹 내에서 송장 있는 행 → 없는 행에 동일 송장 복사
  var combinedUidMatched = 0;
  if (Object.keys(combinedUidSet).length > 0) {
    var combNameGroups = {}; // name → [rowIndex]
    for (var cr = 0; cr < hubData.length; cr++) {
      var cUid = String(hubData[cr][2] || "").trim();
      if (!cUid || !combinedUidSet[cUid]) continue;
      var cName = String(hubData[cr][7] || "").trim();
      if (!cName) continue;
      if (!combNameGroups[cName]) combNameGroups[cName] = [];
      combNameGroups[cName].push(cr);
    }

    for (var cGrpName in combNameGroups) {
      var cGrpRows = combNameGroups[cGrpName];
      if (cGrpRows.length < 2) continue; // 1건이면 합배송 아님

      // 그룹 내 송장 있는 행 찾기
      var sourceInv = "";
      var sourceCarrier = ""; // 합배송은 같은 송장 = 같은 택배사
      for (var ci = 0; ci < cGrpRows.length; ci++) {
        var cInv = String(hubData[cGrpRows[ci]][13] || "").trim();
        if (_po_hasRealInvoice_(cInv)) {
          sourceInv = cInv;
          sourceCarrier = String(
            hubData[cGrpRows[ci]][_PO_HUB_CARRIER_COL_] || "",
          ).trim();
          break;
        }
      }
      if (!sourceInv) continue; // 그룹 내 송장 없음

      // 송장 없는 행에 동일 송장 복사 → 합배송
      for (var ci2 = 0; ci2 < cGrpRows.length; ci2++) {
        var ridx = cGrpRows[ci2];
        var existInv = String(hubData[ridx][13] || "").trim();
        if (_po_hasRealInvoice_(existInv)) continue;
        if (isTerminalOrderStatus_(String(hubData[ridx][14] || ""))) continue;

        hubData[ridx][13] = sourceInv;
        writeUpdates.push({
          row: ridx + 2,
          inv: sourceInv,
          status: "합배송",
          writeInvoice: true,
          carrier: sourceCarrier,
        });
        matched++;
        combinedUidMatched++;
        uidMatchedSet[ridx] = true; // 2차 패스에서 스킵
      }
    }
    scannedLogs.push("★ 합배송(UID 기반): " + combinedUidMatched + "건");
  }

  // ── 수취인+전화 끝4자리로 그룹핑 (합배송 처리) ──
  // ★ 고유ID가 있는 행은 UID 매칭 전용 (이름+전화 매칭 완전 차단)
  // 고유ID로 이미 매칭된 행과 기존 송장이 있는 행은 건너뜀
  var groups = {}; // normalizedKey → [rowIndex]
  for (var r = 0; r < hubData.length; r++) {
    if (uidMatchedSet[r]) continue; // 고유ID 매칭 완료 → 스킵
    var existingInv = String(hubData[r][13] || "").trim();
    if (_po_hasRealInvoice_(existingInv)) continue; // 이미 송장 있음
    if (isTerminalOrderStatus_(String(hubData[r][14] || ""))) continue;
    var st = String(hubData[r][14] || "").trim();
    if (st === "발송완료") continue;
    // ★ 2026-06-18: 적요(M열=12)에 내용이 있어도 송장 수집 진행 (제한 해제)

    // ★ 고유ID가 있는 행은 무조건 UID 매칭 전용 (이름+전화 매칭 완전 차단)
    var hubUidForGroup = String(hubData[r][2] || "").trim();
    if (hubUidForGroup) {
      // 고유ID가 있으면 UID 매칭만 사용 → 이름+전화 매칭 차단
      noMatch++;
      if (unmatchedDiag.length < 15) {
        unmatchedDiag.push("R" + (r + 2) + " UID=" + hubUidForGroup + " → 송장 미발견 (UID 전용)");
      }
      continue;
    }
    // 고유ID 없는 행만 이름+전화 매칭 진행

    var gName = String(hubData[r][7] || "").trim();
    var gPh = String(hubData[r][8] || "").replace(/[^0-9]/g, "");
    var gKey = normalizeHubRecipientPhoneKey_(gName, gPh);
    if (!gKey || gKey === "_") {
      noMatch++;
      unmatchedDiag.push("R" + (r + 2) + " 수취인/전화 비어있음 → 키생성 불가");
      continue;
    }
    if (!groups[gKey]) groups[gKey] = [];
    groups[gKey].push(r);
  }

  // ── [1차] 그룹별 엄격 매칭 (이름+전화 조합) ──
  var unmatchedGroups = []; // 1차 미매칭 그룹 모음
  for (var groupKey in groups) {
    var groupRows = groups[groupKey];

    // 1차 후보: 이름+전화끝4 + 이름+P전화앞7 + 정규화 조합
    var mergedMatched = [];
    for (var gx = 0; gx < groupRows.length; gx++) {
      var rowIdx = groupRows[gx];
      var nm_ = String(hubData[rowIdx][7] || "").trim();
      var ph_ = String(hubData[rowIdx][8] || "").replace(/[^0-9]/g, "");
      var p7_ = nm_ && ph_.length >= 7 ? nm_ + "_P" + ph_.substring(0, 7) : "";
      var nmNorm_ = nm_.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, "");
      var shortP_ = ph_.length >= 4 ? ph_.substring(ph_.length - 4) : ph_;
      var normKey_ = nmNorm_ + "_" + shortP_;
      var normP7_ =
        nmNorm_ && ph_.length >= 7 ? nmNorm_ + "_P" + ph_.substring(0, 7) : "";

      if (invoiceMap[groupKey])
        mergedMatched = mergedMatched.concat(invoiceMap[groupKey]);
      if (p7_ && invoiceMap[p7_])
        mergedMatched = mergedMatched.concat(invoiceMap[p7_]);
      if (normKey_ !== groupKey && invoiceMap[normKey_])
        mergedMatched = mergedMatched.concat(invoiceMap[normKey_]);
      if (normP7_ && normP7_ !== p7_ && invoiceMap[normP7_])
        mergedMatched = mergedMatched.concat(invoiceMap[normP7_]);
      // ★ 고유ID(M열) → 사방넷주문번호 직접 매칭 (최우선)
      var hubUniqueId_ = String(hubData[rowIdx][12] || "").trim();
      if (hubUniqueId_ && invoiceMap[hubUniqueId_]) {
        mergedMatched = invoiceMap[hubUniqueId_].concat(mergedMatched); // 앞에 삽입
      }
    }

    if (mergedMatched.length === 0) {
      // 1차 미매칭 → 2차에서 재시도
      unmatchedGroups.push({ key: groupKey, rows: groupRows });
      continue;
    }

    // 1차 매칭 성공 → 송장 배정
    var parsedCandidates = parseInvoiceLinesFromMatchedRows_(
      mergedMatched,
      globalUsedInvoices,
    );
    if (parsedCandidates.length === 0) {
      unmatchedGroups.push({ key: groupKey, rows: groupRows });
      continue;
    }

    groupRows.sort(function (a, b) {
      return (
        toComparableOrderDateValue_(hubData[a][3]) -
        toComparableOrderDateValue_(hubData[b][3])
      );
    });
    var assignedRep = [];
    for (var er = 0; er < groupRows.length; er++) {
      var repIdx = groupRows[er];
      var needSlots = _pt_getRequiredParcelSlots(hubData[repIdx]);
      // ★ 디버깅: 수량 배정 추적
      Logger.log("[INV-ASSIGN] R" + (repIdx + 2) +
        " 품목=" + String(hubData[repIdx][5] || "").substring(0, 20) +
        " rawQty=" + String(hubData[repIdx][6]) +
        " needSlots=" + needSlots +
        " 잔여후보=" + parsedCandidates.filter(function(c) { return c && !globalUsedInvoices[c.inv]; }).length);
      var pickedInvs = _pt_pickInvoicesForHubRow(
        parsedCandidates,
        hubData[repIdx],
        needSlots,
        globalUsedInvoices,
      );
      if (pickedInvs.length === 0) {
        noMatch++;
        if (unmatchedDiag.length < 15) {
          // ★ 후보 송장 상세 진단 (사용 여부 표시)
          var candDiag = [];
          for (var cd = 0; cd < Math.min(parsedCandidates.length, 3); cd++) {
            var ci = parsedCandidates[cd];
            candDiag.push(
              ci.inv + (globalUsedInvoices[ci.inv] ? "(사용됨)" : "(미사용)")
            );
          }
          unmatchedDiag.push(
            "R" + (repIdx + 2) + " [" + String(hubData[repIdx][7] || "") +
            " / " + String(hubData[repIdx][8] || "") +
            "] 후보" + parsedCandidates.length + "건 → " +
            (candDiag.length > 0 ? candDiag.join(", ") : "전부 사용됨/스코어 미달")
          );
        }
        continue;
      }
      var invCell = pickedInvs
        .map(function (p) {
          return p.inv;
        })
        .join("\n");
      var detailCell = pickedInvs
        .map(function (p) {
          return p.setDetail || "";
        })
        .join("\n")
        .trim();
      hubData[repIdx][13] = invCell;
      var repCarrier = _po_carrierFromPicked_(pickedInvs, hubData[repIdx]);
      writeUpdates.push({
        row: repIdx + 2,
        inv: invCell,
        setDetail: detailCell,
        status: "발송완료",
        writeInvoice: true,
        carrier: repCarrier,
      });
      assignedRep.push({
        idx: repIdx,
        uid: String(hubData[repIdx][2] || "").trim(),
        inv: invCell,
        carrier: repCarrier,
      });
      matched++;
    }
    if (assignedRep.length > 0) {
      for (var rr = 0; rr < groupRows.length; rr++) {
        var otherIdx = groupRows[rr];
        var isRep = false;
        for (var ai = 0; ai < assignedRep.length; ai++) {
          if (assignedRep[ai].idx === otherIdx) {
            isRep = true;
            break;
          }
        }
        if (isRep) continue;
        if (_po_hasRealInvoice_(hubData[otherIdx][13])) continue;
        // ★ 합배송 전용 시트에 등록된 키만 합배송 처리 (오매칭 방지)
        if (!combinedShipmentKeySet[groupKey]) {
          noMatch++;
          continue;
        }
        writeUpdates.push({
          row: otherIdx + 2,
          inv: assignedRep[0].inv,
          status: "합배송",
          writeInvoice: true,
          carrier: assignedRep[0].carrier || "",
        });
      }
    }
  }

  // ── [2차] 미매칭 그룹 재검색 ──
  // ★ 2026-08-27: 전화번호 단독 매칭을 정책상 껐다.
  //   1차는 이름+전화 조합이라 두 필드가 맞아야 하지만, 2차는 전화 하나만 맞으면
  //   걸린다. 송장맵에는 날짜가 없으므로 재구매 고객은 과거 출고분과 새 주문이
  //   같은 PH_ 키를 공유한다. 그래서 이 패스가 과거 송장을 주워오는 통로였다.
  //   되돌려야 하면 스크립트 속성 INVOICE_MATCH_ALLOW_SINGLE_FIELD = true.
  //   (이름 단독은 그보다 먼저 제거됐다 — 동명이인 오매칭)
  var pass2Matched = 0;
  var allowSingle2 =
    typeof _pt_allowSingleFieldMatch_ === "function" && _pt_allowSingleFieldMatch_();
  if (!allowSingle2) {
    // 2차를 돌리지 않으므로 1차 미매칭 그룹의 행을 여기서 집계한다.
    var skipped2 = 0;
    for (var sg = 0; sg < unmatchedGroups.length; sg++) {
      skipped2 += unmatchedGroups[sg].rows.length;
      if (unmatchedDiag.length < 15) {
        var sgi = unmatchedGroups[sg].rows[0];
        unmatchedDiag.push(
          "R" + (sgi + 2) + " [" + String(hubData[sgi][7] || "").trim() + " / " +
            String(hubData[sgi][8] || "") + "] 키: " + unmatchedGroups[sg].key +
            " → 이름+전화 조합 미매칭 (전화 단독 매칭은 정책상 끔)",
        );
      }
    }
    noMatch += skipped2;
    scannedLogs.push(
      "[2차] 전화 단독 매칭 꺼짐 (정책) — 미매칭 그룹 " + unmatchedGroups.length +
        "개 / " + skipped2 + "행. 이름+전화 조합으로 못 찾은 건입니다.",
    );
    unmatchedGroups = [];
  }
  for (var ug = 0; ug < unmatchedGroups.length; ug++) {
    var uGroup = unmatchedGroups[ug];
    var uRows = uGroup.rows;

    var mergedMatched2 = [];
    for (var gx2 = 0; gx2 < uRows.length; gx2++) {
      var ri2 = uRows[gx2];
      var ph2 = String(hubData[ri2][8] || "").replace(/[^0-9]/g, "");

      if (ph2.length >= 8) {
        var phKey2 = "PH_" + ph2;
        if (invoiceMap[phKey2])
          mergedMatched2 = mergedMatched2.concat(invoiceMap[phKey2]);
      }
    }

    if (mergedMatched2.length === 0) {
      noMatch += uRows.length;
      if (unmatchedDiag.length < 15) {
        var si2 = uRows[0];
        var sNm2 = String(hubData[si2][7] || "").trim();
        var sPh2 = String(hubData[si2][8] || "");
        unmatchedDiag.push(
          "R" +
            (si2 + 2) +
            " [" +
            sNm2 +
            " / " +
            sPh2 +
            "] " +
            "키: " +
            uGroup.key +
            " → 1차+2차 모두 미매칭",
        );
      }
      continue;
    }

    // 2차 매칭 성공 → 송장 배정
    var parsed2 = parseInvoiceLinesFromMatchedRows_(
      mergedMatched2,
      globalUsedInvoices,
    );
    if (parsed2.length === 0) {
      noMatch += uRows.length;
      continue;
    }

    uRows.sort(function (a, b) {
      return (
        toComparableOrderDateValue_(hubData[a][3]) -
        toComparableOrderDateValue_(hubData[b][3])
      );
    });
    var assigned2 = [];
    for (var er2 = 0; er2 < uRows.length; er2++) {
      var ri2b = uRows[er2];
      var need2 = _pt_getRequiredParcelSlots(hubData[ri2b]);
      var picked2 = _pt_pickInvoicesForHubRow(
        parsed2,
        hubData[ri2b],
        need2,
        globalUsedInvoices,
      );
      if (picked2.length === 0) {
        noMatch++;
        if (unmatchedDiag.length < 15) {
          unmatchedDiag.push(
            "R" + (ri2b + 2) + " [" + String(hubData[ri2b][7] || "") +
            " / " + String(hubData[ri2b][8] || "") + "] 2차 후보있으나 송장배정 실패"
          );
        }
        continue;
      }
      var inv2 = picked2
        .map(function (p) {
          return p.inv;
        })
        .join("\n");
      var detailCell2 = picked2
        .map(function (p) {
          return p.setDetail || "";
        })
        .join("\n")
        .trim();
      hubData[ri2b][13] = inv2;
      var carrier2 = _po_carrierFromPicked_(picked2, hubData[ri2b]);
      writeUpdates.push({
        row: ri2b + 2,
        inv: inv2,
        setDetail: detailCell2,
        status: "발송완료",
        writeInvoice: true,
        carrier: carrier2,
      });
      assigned2.push({
        idx: ri2b,
        uid: String(hubData[ri2b][2] || "").trim(),
        inv: inv2,
        carrier: carrier2,
      });
      matched++;
      pass2Matched++;
    }
    if (assigned2.length > 0) {
      for (var rr2 = 0; rr2 < uRows.length; rr2++) {
        var oi2 = uRows[rr2];
        var isR2 = false;
        for (var ai2 = 0; ai2 < assigned2.length; ai2++) {
          if (assigned2[ai2].idx === oi2) {
            isR2 = true;
            break;
          }
        }
        if (isR2) continue;
        if (_po_hasRealInvoice_(hubData[oi2][13])) continue;
        // ★ 합배송 전용 시트에 등록된 키만 합배송 처리 (오매칭 방지)
        if (!combinedShipmentKeySet[uGroup.key]) {
          noMatch++;
          continue;
        }
        writeUpdates.push({
          row: oi2 + 2,
          inv: assigned2[0].inv,
          status: "합배송",
          writeInvoice: true,
          carrier: assigned2[0].carrier || "",
        });
      }
    }
  }
  scannedLogs.push("2차 재검색 매칭: " + pass2Matched + "건");

  // ── ★ 2026-07-09 성능최적화: 허브 M/N/O열 배치 쓰기 ──
  // 기존: 매 건마다 setValue(송장) + setValue(상태) + setValue(적요) = 행당 2~3 API 호출
  // 개선: hubData 배열에 사전 반영 → 열별 setValues() 3회 일괄 쓰기
  var hubChanged = false;
  var carrierChanged = false; // R열은 바뀐 게 있을 때만 쓴다 (setValues 1회 절약)
  for (var wi = 0; wi < writeUpdates.length; wi++) {
    var upd = writeUpdates[wi];
    var hubIdx = upd.row - 2;
    if (hubIdx < 0 || hubIdx >= hubData.length) continue;
    try {
      if (upd.writeInvoice) {
        hubData[hubIdx][13] = upd.inv; // N열(14): 송장번호
        hubChanged = true;
      }
      if (upd.status) {
        hubData[hubIdx][14] = upd.status; // O열(15): 상태
        hubChanged = true;
      }
      // ★ 적요(M열=13열) 기록
      if (upd.status === "합배송") {
        hubData[hubIdx][12] = "합발송완료";
        hubChanged = true;
      } else if (upd.setDetail) {
        hubData[hubIdx][12] = upd.setDetail;
        hubChanged = true;
      }
      // ★ 2026-08-31: R열(18) 택배사 — 판정이 된 건만 덮는다.
      //   빈 판정으로 기존 값을 지우면 재수집할수록 정보가 줄어든다.
      if (upd.carrier) {
        if (String(hubData[hubIdx][_PO_HUB_CARRIER_COL_] || "").trim() !== upd.carrier) {
          hubData[hubIdx][_PO_HUB_CARRIER_COL_] = upd.carrier;
          carrierChanged = true;
          hubChanged = true;
        }
      }
    } catch (eW) {}
  }

  // ★ 2026-07-09: 이슈 기록도 hubData에 사전 반영 (배치 쓰기에 통합)
  var _issueWritten = 0;
  if (Object.keys(_issueByUid).length > 0) {
    for (var _hi = 0; _hi < hubData.length; _hi++) {
      var _hUid2 = String(hubData[_hi][2] || "").trim();
      if (_hUid2 && _issueByUid[_hUid2]) {
        if (String(hubData[_hi][12] || "").trim() !== _issueByUid[_hUid2]) {
          hubData[_hi][12] = _issueByUid[_hUid2];
          _issueWritten++;
          hubChanged = true;
        }
      }
    }
    if (_issueWritten > 0) {
      scannedLogs.push("[이슈] 허브 M열 기록: " + _issueWritten + "건");
    }
  }

  // ★ 2026-07-09: M/N/O열 배치 쓰기 (열당 1회 setValues = 총 3회 API 호출)
  if (hubChanged) {
    var _mVals = [], _nVals = [], _oVals = [];
    for (var _bi = 0; _bi < hubData.length; _bi++) {
      _mVals.push([hubData[_bi][12]]); // M열: 적요
      _nVals.push([hubData[_bi][13]]); // N열: 송장번호
      _oVals.push([hubData[_bi][14]]); // O열: 상태
    }
    hubTab.getRange(2, 13, hubData.length, 1).setValues(_mVals);
    hubTab.getRange(2, 14, hubData.length, 1).setValues(_nVals);
    hubTab.getRange(2, 15, hubData.length, 1).setValues(_oVals);
    // ★ 2026-08-31: R열(택배사) — 판정이 바뀐 건이 있을 때만 1회 추가 쓰기
    if (carrierChanged) {
      var _rVals = [], _rFilled = 0;
      for (var _ri = 0; _ri < hubData.length; _ri++) {
        var _rv = hubData[_ri][_PO_HUB_CARRIER_COL_] || "";
        if (_rv) _rFilled++;
        _rVals.push([_rv]);
      }
      hubTab
        .getRange(2, _PO_HUB_CARRIER_COL_ + 1, hubData.length, 1)
        .setValues(_rVals);
      scannedLogs.push("[택배사] 허브 R열 기록: " + _rFilled + "건");
    }
    SpreadsheetApp.flush();
    // ★ 2026-08-25: 드롭다운은 더 이상 붙이지 않으므로, 갱신된 행에 남은 잔여 규칙을
    //   상태와 무관하게 모두 걷어낸다. 수집을 돌릴수록 과거 잔여물이 사라진다.
    try {
      var _dvClearRows = [];
      for (var _wi2 = 0; _wi2 < writeUpdates.length; _wi2++) {
        _dvClearRows.push(writeUpdates[_wi2].row);
      }
      _po_clearStockWarnDropdownRows_(hubTab, _dvClearRows);
    } catch (eDvC) {}
  }

  // 허브 매칭 송장 → UID/복합키 맵 (소스탭·임시기록 공용)
  var hubInvoiceByKey = _po_buildHubInvoiceKeyMap_(writeUpdates, hubData);

  // ── ★ 대리발송 소스 탭(V열)에 송장번호 역기록 ──
  // 허브에서 매칭 성공한 행의 고유ID → 소스 탭 U열(협력Push UID)가 아닌,
  // 소스 탭의 이카운트코드+수취인+전화번호를 기준으로 허브 행과 매칭
  var proxyWriteCount = 0;
  try {
    if (Object.keys(hubInvoiceByKey).length > 0) {
      var srcSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
      var srcTab = null;
      var srcSheets = srcSS.getSheets();
      for (var si2 = 0; si2 < srcSheets.length; si2++) {
        if (srcSheets[si2].getSheetId() === _PEP_SOURCE_TAB_GID) {
          srcTab = srcSheets[si2];
          break;
        }
      }
      if (!srcTab) srcTab = srcSS.getSheetByName(_PEP_SOURCE_TAB_NAME);

      if (srcTab && srcTab.getLastRow() >= 2) {
        var srcLr = srcTab.getLastRow();
        var srcLc = srcTab.getLastColumn();
        var srcAll2 = srcTab.getRange(1, 1, srcLr, srcLc).getValues();
        var srcHdr = srcAll2[0];

        // U열(협력Push UID) 찾기
        var srcUidCol = -1;
        for (var sh2 = 0; sh2 < srcHdr.length; sh2++) {
          var shn = String(srcHdr[sh2] || "")
            .replace(/\s/g, "")
            .toLowerCase();
          if (shn === "협력push" || shn === "pep_uid") {
            srcUidCol = sh2;
            break;
          }
        }

        // V열(송장번호) = U열 바로 옆
        if (srcUidCol >= 0) {
          var srcInvCol = srcUidCol + 1;

          // V열 헤더가 없으면 생성
          var vHeader =
            srcLc > srcInvCol ? String(srcHdr[srcInvCol] || "").trim() : "";
          if (
            !vHeader ||
            (vHeader !== "송장번호" && vHeader.indexOf("송장") === -1)
          ) {
            srcTab
              .getRange(1, srcInvCol + 1)
              .setValue("송장번호")
              .setBackground("#d5a6bd")
              .setFontWeight("bold");
          }

          // 소스 탭 D열=이카운트코드(idx3), 수취인/전화 컬럼 찾기
          var srcCodeCol = _PEP_CODE_COL; // 3 (D열, 0-based)
          var srcRecipCol = -1,
            srcPhoneCol = -1;
          for (var hd2 = 0; hd2 < srcHdr.length; hd2++) {
            var hdName = String(srcHdr[hd2] || "").replace(/\s/g, "");
            if (
              srcRecipCol === -1 &&
              hdName.match(/수취인|받는분|주문자|수령인/)
            )
              srcRecipCol = hd2;
            if (
              srcPhoneCol === -1 &&
              hdName.match(/전화|연락처|모바일|핸드폰|휴대폰/)
            )
              srcPhoneCol = hd2;
          }

          // ★ 2026-07-09 성능최적화: V열 배치 쓰기 (개별 setValue 제거)
          var srcInvVals = srcTab.getRange(2, srcInvCol + 1, srcLr - 1, 1).getValues();
          var srcInvChanged = false;
          for (var sr = 1; sr < srcAll2.length; sr++) {
            var sRow = srcAll2[sr];
            // 이미 V열에 송장번호가 있으면 스킵
            var existingV =
              srcLc > srcInvCol ? String(sRow[srcInvCol] || "").trim() : "";
            if (existingV) continue;

            // U열에 UID가 없으면 Push 안 된 행 → 스킵
            var sUid = String(sRow[srcUidCol] || "").trim();
            if (!sUid) continue;

            var inv = null;
            // ★ 0차: P열(사방넷주문번호) = 고유ID 기반 UID 매칭 (가장 정확)
            var sP15 = String(sRow[15] || "").trim(); // P열(15): 사방넷주문번호
            if (sP15 && hubInvoiceByKey["UID:" + sP15]) {
              inv = hubInvoiceByKey["UID:" + sP15];
            }
            // 1차: 복합키 매칭 (이카운트코드+수취인+전화)
            if (!inv) {
              var sCode = String(sRow[srcCodeCol] || "").trim();
              var sName =
                srcRecipCol >= 0 ? String(sRow[srcRecipCol] || "").trim() : "";
              var sPhone =
                srcPhoneCol >= 0
                  ? String(sRow[srcPhoneCol] || "").replace(/[^0-9]/g, "")
                  : "";
              if (sCode && sName) {
                var sKey = sCode + "|" + sName + "|" + sPhone;
                if (hubInvoiceByKey[sKey]) inv = hubInvoiceByKey[sKey];
              }
            }

            if (inv) {
              var srcIdx = sr - 1; // srcInvVals는 2행부터(0-indexed)
              if (srcIdx >= 0 && srcIdx < srcInvVals.length) {
                srcInvVals[srcIdx][0] = inv;
                srcInvChanged = true;
              }
              proxyWriteCount++;
            }
          }
          // ★ V열 1회 배치 쓰기
          if (srcInvChanged) {
            srcTab.getRange(2, srcInvCol + 1, srcInvVals.length, 1).setValues(srcInvVals);
          }
        }
      }
    }
    if (proxyWriteCount > 0) {
      scannedLogs.push(
        "★ 대리발송 소스 탭 V열 송장 역기록: " + proxyWriteCount + "건",
      );
      SpreadsheetApp.flush();
    }
  } catch (eProxy) {
    scannedLogs.push(
      "[대리발송 역기록 오류] " + String(eProxy.message || eProxy),
    );
  }

  // ── ★ 비협력업체 미매칭 송장 → 별도 탭에 수집 ──
  // 허브에 매칭되지 않은 송장을 입력_로젠주문실적 원본 양식 그대로 새 탭에 복사
  var unmatchedCollectCount = 0;
  try {
    unmatchedCollectCount = _po_collectUnmatchedInvoicesToSeparateTab_(
      globalUsedInvoices,
      scannedLogs,
      _partnerTabCache,
    );
  } catch (eUmc) {
    scannedLogs.push("[사방넷주문 수집 오류] " + String(eUmc.message || eUmc));
  }

  // ★ 임시탭 고유ID·허브매칭·invoiceMap 기반 X열 송장번호 기록
  try {
    _po_checkNonPartnerTempTabMatches_(invoiceMap, scannedLogs, hubInvoiceByKey, _issueByUid);
  } catch (eNp) {
    scannedLogs.push("[비협력임시탭 확인 오류] " + String(eNp.message || eNp));
  }

  // ★ 임시탭 K열 채워진 행 → 사방넷_송장매칭 탭으로 변환 출력
  var tempPushCount = 0;
  try {
    tempPushCount = _po_pushTempTabMatchedToNonPartnerSheet_(scannedLogs);
  } catch (eTp) {
    scannedLogs.push("[임시탭→비협력 오류] " + String(eTp.message || eTp));
  }

  // ★ 합배송탭 [샘플]+사방넷UID → 사방넷_송장매칭에 UID별 1행 (송장번호 동일 허용)
  var hapSampleCount = 0;
  try {
    hapSampleCount = _po_pushHapbaesongSamplesToSabangnet_(
      scannedLogs,
      invoiceMap,
      hubInvoiceByKey,
      hubData,
    );
  } catch (eHapS) {
    scannedLogs.push("[합배송샘플→사방넷 오류] " + String(eHapS.message || eHapS));
  }

  // ★ 상품정보「사방넷_송장대량등록」— A주문번호 B송장 C·D공란 E택배사코드
  var sabangBulkCount = 0;
  try {
    var bulkRes = _po_rebuildSabangnetBulkUpload_(hubData, scannedLogs);
    sabangBulkCount = bulkRes && bulkRes.written ? bulkRes.written : 0;
  } catch (eBulkHook) {
    scannedLogs.push("[사방넷대량등록 오류] " + String(eBulkHook.message || eBulkHook));
  }

  // ★ 2026-08-26: 근거·원천 실적을 결과에 같이 싣는다.
  //   "몇 건 붙었다"만 보고하면 잘못 붙은 것도 성공으로 보인다.
  var evLine = "";
  var srcLine = "";
  try {
    if (typeof _pt_evStatSummary_ === "function") evLine = _pt_evStatSummary_();
    if (typeof _pt_ingestStatSummary_ === "function") srcLine = _pt_ingestStatSummary_();
  } catch (eEv) {}

  var msg =
    "📥 송장 수집 완료\n" +
    "- 매칭 성공: " +
    matched +
    "건\n" +
    "- 이미 입력됨: " +
    alreadyHas +
    "건\n" +
    "- 미매칭: " +
    noMatch +
    "건\n" +
    (evLine ? "\n" + evLine + "\n" : "") +
    (srcLine ? "\n[원천별 읽기 실적]\n" + srcLine + "\n" : "") +
    (unmatchedCollectCount > 0
      ? "- 비협력업체 수집: " + unmatchedCollectCount + "건\n"
      : "") +
    (hapSampleCount > 0
      ? "- 합배송 [샘플] 사방넷UID: " + hapSampleCount + "건 (송장동일·행분리)\n"
      : "") +
    (sabangBulkCount > 0
      ? "- 사방넷 대량등록 탭: " + sabangBulkCount + "행 (상품정보)\n"
      : "") +
    "\n" +
    "[스캔 로그]\n" +
    scannedLogs.join("\n") +
    (unmatchedDiag.length > 0
      ? "\n\n[미매칭 상세(최대15건)]\n" + unmatchedDiag.join("\n")
      : "") +
    (matched > 0
      ? "\n\n✅ '③ 송장 배포'를 실행하면 각 협력업체 시트에 반영됩니다."
      : "");
  Logger.log(msg);

  // ★ Google Chat 알림
  try { _chat_notifyInvoiceFetch_(matched, noMatch); } catch (eChat) {}

  // ★ 2026-07-09: 스마트 스캔용 마지막 수집 시간 업데이트
  try { _invProps.setProperty("LAST_INVOICE_FETCH_TIME", String(Date.now())); } catch (eProp) {}

  // ★ 2026-07-02: DB 동기화 — 매칭된 송장 → invoices + orders
  try {
    if (writeUpdates.length > 0) {
      var dbInvoiceRows = [];
      var dbMatchRows = [];
      for (var dbi = 0; dbi < writeUpdates.length; dbi++) {
        var du = writeUpdates[dbi];
        if (!du.writeInvoice || !du.inv) continue;
        var dHubIdx = du.row - 2;
        var dUid = String(hubData[dHubIdx][2] || "").trim();
        var dVendor = String(hubData[dHubIdx][1] || "").trim();
        var invLines = String(du.inv).split("\n");
        for (var dil = 0; dil < invLines.length; dil++) {
          var dInv = invLines[dil].trim();
          if (!dInv) continue;
          dbInvoiceRows.push({ unique_id: dUid, invoice_no: dInv, vendor_name: dVendor, status: du.status || "발송완료" });
          if (dUid) dbMatchRows.push({ unique_id: dUid, invoice_no: dInv, vendor_name: dVendor, match_type: "auto", match_source: "gas" });
        }
      }
      _sb_syncInvoices_(dbInvoiceRows);
      _sb_syncInvoiceMatch_(dbMatchRows);
    }
  } catch (eDb) { Logger.log("[SB] 송장 DB 동기화 오류: " + eDb.message); }

  // ★ HTML 모달 다이얼로그로 결과 표시
  if (ui) {
    try {
      var html = _po_buildInvoiceSummaryHtml_(
        matched, alreadyHas, noMatch, unmatchedCollectCount,
        scannedLogs, unmatchedDiag
      );
      var output = HtmlService.createHtmlOutput(html)
        .setWidth(860).setHeight(720);
      ui.showModalDialog(output, "📥 송장 수집 결과");
    } catch (eHtml) {
      ui.alert(msg);
    }
  }
}

/**
 * 허브 '협력업체_발주허브'에서 송장번호가 입력된 행을 읽어
 * 고유ID 기준으로 각 협력업체 시트에 송장번호 + 상태(발송완료)를 기록.
 *
 * 사용법:
 *   1) 허브 '협력업체_발주허브' 탭에서 '송장번호' 열에 번호 입력
 *      (또는 '② 송장 수집' 실행 시 자동 매칭)
 *   2) 메뉴 → 💼 협력업체 관리 → 📦 New 발주 시스템 → 송장 배포
 */
function partnerPushInvoices() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

  var hubTab = _po_getHubTab();
  var lastRow = hubTab.getLastRow();
  if (lastRow <= 1) {
    if (ui)
      ui.alert("허브에 발주 데이터가 없습니다.\n먼저 발주 수집을 실행하세요.");
    return;
  }

  // 허브 데이터 (헤더 인덱스: 고유ID=2, 송장번호=13, 상태=14, 택배사=17)
  _po_ensureHubCarrierCol_(hubTab);
  var hubData = hubTab
    .getRange(2, 1, lastRow - 1, _PO_HUB_CARRIER_COL_ + 1)
    .getValues();

  // ★ 폐기송장 목록 로드 → 배포 시 폐기 송장 제외
  var voidSet = _po_loadVoidInvoiceSet_();

  // 배포 대상:
  //   ① 송장번호 있는 행 → 송장 + 발송완료 상태 + 적요 배포
  //   ② 송장번호 없어도 적요에 내용 있는 행 → 적요만 배포 (상태 변경 없음)
  //   ③ 출고가능 상태 → 상태 배포 (송장/적요 없어도)
  // 예외: 취소/불용/반품/폐기 상태 제외, 폐기송장 목록에 있는 송장 제외
  var pendingByUid = {};
  for (var i = 0; i < hubData.length; i++) {
    var uid = String(hubData[i][2] || "").trim();
    var invoiceRaw = String(hubData[i][13] || "").trim();
    var invoice = _po_hasRealInvoice_(invoiceRaw) ? invoiceRaw : "";
    var status = String(hubData[i][14] || "").trim();
    var hubMemo = String(hubData[i][12] || "").trim(); // M열=적요
    if (!uid) continue;
    // ★ 출고가능 상태는 송장/적요 없어도 배포 대상
    var isShipApproved = status.replace(/\s/g, "").indexOf("출고가능") !== -1;
    if (!invoice && !hubMemo && !isShipApproved) continue;
    // 취소/반품/불용/폐기 상태는 배포 제외
    var stC = status.replace(/\s/g, "");
    if (
      stC.indexOf("취소") !== -1 ||
      stC.indexOf("반품") !== -1 ||
      stC.indexOf("불용") !== -1 ||
      stC.indexOf("폐기") !== -1
    )
      continue;
    // ★ 폐기송장 목록에 있는 송장번호는 배포 제외
    if (invoice && _po_isVoidedInvoice_(invoice, voidSet)) continue;
    pendingByUid[uid] = {
      invoice: invoice,         // 빈 문자열이면 송장 없음 (placeholder 제외)
      status: status,
      hubRow: i + 2,
      hubMemo: hubMemo,
      // ★ 2026-08-31: 허브 R열을 그대로 배포한다. 업체 파일에서 재판정하지 않는다
      //   — 같은 송장이 파일마다 다른 택배사로 보이면 안 된다
      carrier: String(hubData[i][_PO_HUB_CARRIER_COL_] || "").trim(),
      memoOnly: !invoice && !isShipApproved,  // 적요만 배포 (출고가능은 상태도 배포)
      statusOnly: isShipApproved && !invoice,  // ★ 출고가능 상태만 배포
    };
  }

  var pendingCount = Object.keys(pendingByUid).length;
  if (pendingCount === 0) {
    if (ui)
      ui.alert(
        "배포할 송장이 없습니다.\n허브 '송장번호' 열에 번호를 입력한 후 실행하세요.",
      );
    return;
  }

  var files = _pt_listFiles();
  var pushed = 0,
    errors = [];
  var hubStatusRows = [];

  for (var fi = 0; fi < files.length; fi++) {
    var file = files[fi];
    try {
      var ss = SpreadsheetApp.openById(file.id);
      // ★ 2026-06-23 성능 최적화: 메인 탭 다이렉트 로드 + 폴백 구조 (스킵 방지 검증 완료)
      var targetTab = ss.getSheetByName("발주 및 송장조회");
      var collectTabs = [];
      if (targetTab) {
        collectTabs.push(targetTab);
      } else {
        // 폴백: 탭 이름이 다르거나 특수 상황일 때만 전체 탭 탐색하여 스킵 방지
        var allTabs = ss.getSheets();
        for (var ti = 0; ti < allTabs.length; ti++) {
          if (_po_isOrderTab(allTabs[ti].getName())) {
            collectTabs.push(allTabs[ti]);
          }
        }
      }

      for (var ti = 0; ti < collectTabs.length; ti++) {
        var tab = collectTabs[ti];
        var tabName = tab.getName();
        var lr = tab.getLastRow();
        if (lr <= 1) continue;
        // ★ 2026-08-31: P열(택배사)까지 읽는다 — 배치 쓰기가 data 배열을 기준으로 돈다
        _po_ensureCols_(tab, _PO_VENDOR_CARRIER_COL_);
        var lc = Math.max(tab.getLastColumn(), _PO_VENDOR_CARRIER_COL_);
        var data = tab.getRange(1, 1, lr, lc).getValues();
        var cMap = _po_buildColMap(data[0]);
        // ★ =FALSE 유효성 검사 정리 (setValues 충돌 방지)
        try { _pt_cleanupStrayValidations_(tab); } catch (eCV) {}

        // ★ 2026-07-22 / 2026-08-18: N열 상태 스필(수식 모드) 가드
        //   N1 수식(#REF! 포함)이 살아 있으면 상태 열은 N(14). P열에 새 "상태(자동)" 금지.
        var stFormulaMode = false;
        try {
          var _stGuardInv_ = _pt_guardVendorOrderStatusCol_(tab, cMap);
          if (_stGuardInv_) stFormulaMode = !!_stGuardInv_.formulaMode;
          if (_stGuardInv_ && _stGuardInv_.reloaded) {
            lc = Math.max(tab.getLastColumn(), _PO_VENDOR_CARRIER_COL_);
            data = tab.getRange(1, 1, lr, lc).getValues();
            cMap = _po_buildColMap(data[0]);
            _stGuardInv_ = _pt_guardVendorOrderStatusCol_(tab, cMap);
            if (_stGuardInv_) stFormulaMode = !!_stGuardInv_.formulaMode;
          }
        } catch (_) {}

        if (cMap.uniqueId === -1) continue;

        var invCol = _po_findInvoiceCol(data[0]);
        var tabChanged = false;
        var carrierPushed = false; // P열 헤더는 실제로 값을 쓸 때만 만든다
        var cellUpdates = []; // ★ 개별 셀 업데이트 목록 {row, col, value}

        for (var r = 1; r < data.length; r++) {
          var rowUid = String(data[r][cMap.uniqueId] || "").trim();
          if (!rowUid || !pendingByUid[rowUid]) continue;

          var p = pendingByUid[rowUid];
          var curInv =
            invCol !== -1 ? String(data[r][invCol] || "").trim() : "";
          var curSt =
            cMap.status !== -1 ? String(data[r][cMap.status] || "").trim() : "";

          if (p.statusOnly) {
            // ③ 출고가능 상태만 배포 (송장 없음)
            // ★ 2026-07-22: 수식 모드면 값 쓰기 금지 — 스필 파괴(#REF!) 방지
            //   (수식 모드에서는 상태가 K/M열 기반 자동 계산 — _po_onEditHubShipApproval_와 동일 정책)
            if (cMap.status !== -1 && !stFormulaMode && curSt !== p.status) {
              cellUpdates.push({ row: r + 1, col: cMap.status + 1, value: p.status });
              tabChanged = true;
              pushed++;
            }
          } else if (p.memoOnly) {
            // ② 적요만 배포 (송장 없음 — 상태·송장 변경 없음)
            if (p.hubMemo && cMap.note !== -1) {
              var curNoteM = String(data[r][cMap.note] || "").trim();
              if (curNoteM !== p.hubMemo) {
                cellUpdates.push({ row: r + 1, col: cMap.note + 1, value: p.hubMemo });
                tabChanged = true;
                pushed++;
              }
            }
          } else {
            // ① 송장 + 발송완료 + 적요 배포
            var invSame = invCol === -1 || curInv === p.invoice;
            var stSame = cMap.status === -1 || curSt === "발송완료";

            if (!invSame && invCol !== -1) {
              cellUpdates.push({ row: r + 1, col: invCol + 1, value: p.invoice });
              tabChanged = true;
            }
            // ★ 2026-07-22: 수식 모드면 상태 값 쓰기 금지 — K열 송장이 채워지면
            //   N열 스필이 "발송완료"를 자동 계산하므로 쓰기 불필요 + 스필 파괴 방지
            if (!stSame && cMap.status !== -1 && !stFormulaMode) {
              cellUpdates.push({ row: r + 1, col: cMap.status + 1, value: "발송완료" });
              tabChanged = true;
            }
            // 허브 적요 → 발주탭 적요 배포
            if (p.hubMemo && cMap.note !== -1) {
              var curNote = String(data[r][cMap.note] || "").trim();
              if (curNote !== p.hubMemo) {
                cellUpdates.push({ row: r + 1, col: cMap.note + 1, value: p.hubMemo });
                tabChanged = true;
              }
            }
            // ★ 2026-08-31: 허브 R열 택배사 → 발주탭 P열 배포.
            //   빈 판정으로 기존 값을 지우지 않는다 (허브가 아직 못 채운 건이 있다).
            if (p.carrier) {
              var curCarrier = String(
                data[r][_PO_VENDOR_CARRIER_COL_ - 1] || "",
              ).trim();
              if (curCarrier !== p.carrier) {
                cellUpdates.push({
                  row: r + 1,
                  col: _PO_VENDOR_CARRIER_COL_,
                  value: p.carrier,
                });
                tabChanged = true;
                carrierPushed = true;
              }
            }
            hubStatusRows.push(p.hubRow);
            pushed++;
          }
        }
        // ★ 2026-07-09 성능최적화: 열별 배치 쓰기 (개별 setValue 제거)
        //   ARRAYFORMULA 보호: D열(품목명), A열(거래처명), L열(단가)은 건드리지 않음
        //   변경된 열(송장/상태/적요)만 열 단위 setValues 1회씩 호출
        if (tabChanged && cellUpdates.length > 0) {
          // ★ 2026-08-31: P열 헤더 보수 — 배포 헤더(A~O 15열) 밖이라 여기서 만든다.
          //   "택배사" 라는 이름이 _pt_wipeVendorOrderLeftoverStatusP_ 의 면제 조건이므로
          //   헤더가 없으면 다음 수집 때 P열이 통째로 지워질 수 있다.
          if (carrierPushed) {
            try {
              var _pH = tab.getRange(1, _PO_VENDOR_CARRIER_COL_);
              if (String(_pH.getValue() || "").trim() !== _PO_VENDOR_CARRIER_HEADER_) {
                _pH.setValue(_PO_VENDOR_CARRIER_HEADER_)
                  .setBackground("#1f4e78")
                  .setFontColor("white")
                  .setFontWeight("bold");
                data[0][_PO_VENDOR_CARRIER_COL_ - 1] = _PO_VENDOR_CARRIER_HEADER_;
              }
            } catch (ePH) {}
          }
          // data 배열에 반영
          for (var cu = 0; cu < cellUpdates.length; cu++) {
            var dRow = cellUpdates[cu].row - 1; // 1-indexed → 0-indexed
            var dCol = cellUpdates[cu].col - 1;
            if (dRow >= 0 && dRow < data.length && dCol >= 0 && dCol < data[0].length) {
              data[dRow][dCol] = cellUpdates[cu].value;
            }
          }
          // 영향받은 열 식별 → 열별 배치 쓰기
          var _affCols = {};
          for (var cu2 = 0; cu2 < cellUpdates.length; cu2++) {
            _affCols[cellUpdates[cu2].col] = true;
          }
          var _batchRows = lr - 1;
          for (var _acStr in _affCols) {
            var _acInt = parseInt(_acStr, 10);
            var _colBatch = [];
            for (var _bri = 1; _bri <= _batchRows; _bri++) {
              _colBatch.push([data[_bri][_acInt - 1]]);
            }
            tab.getRange(2, _acInt, _batchRows, 1).setValues(_colBatch);
          }
          SpreadsheetApp.flush();
        }
      }
    } catch (e) {
      errors.push(file.name + ": " + e.message);
    }
  }

  // ★ 성능최적화: 허브 상태 일괄 갱신 (배치)
  if (hubStatusRows.length > 0) {
    var stColData = hubTab.getRange(2, 15, hubTab.getLastRow() - 1, 1).getValues();
    for (var hi = 0; hi < hubStatusRows.length; hi++) {
      var stIdx = hubStatusRows[hi] - 2;
      if (stIdx >= 0 && stIdx < stColData.length) {
        stColData[stIdx][0] = "발송완료";
      }
    }
    hubTab.getRange(2, 15, stColData.length, 1).setValues(stColData);
    SpreadsheetApp.flush();
  }

  // 적요만 배포된 건 수 집계
  var memoOnlyCount = Object.keys(pendingByUid).filter(function(k) {
    return pendingByUid[k].memoOnly;
  }).length;
  var invoiceCount = pendingCount - memoOnlyCount;

  var msg =
    "📬 송장 배포 완료\n" +
    "- 송장 배포: " + invoiceCount + "건\n" +
    (memoOnlyCount > 0 ? "- 적요만 전달 (송장없음): " + memoOnlyCount + "건\n" : "") +
    "- 실제 반영: " + pushed + "건\n" +
    (pushed < pendingCount
      ? "- 미매칭: " + (pendingCount - pushed) + "건 (고유ID 불일치)\n"
      : "") +
    (errors.length
      ? "\n오류 " + errors.length + "건:\n" + errors.slice(0, 5).join("\n")
      : "");
  Logger.log(msg);
  // ★ Google Chat 알림
  try {
    _chat_sendCard_("📬 송장 배포 완료",
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
      [
        { label: "✅ 송장 배포", value: invoiceCount + "건" },
        { label: "📋 실제 반영", value: pushed + "건" },
      ].concat(memoOnlyCount > 0 ? [{ label: "📝 적요만", value: memoOnlyCount + "건" }] : [])
    );
  } catch (eChat) {}
  if (ui) ui.alert(msg);
}

// ═══════════════════════════════════════════
//  발주 현황 요약
// ═══════════════════════════════════════════
function partnerShowOrderSummary() {
  var ui = SpreadsheetApp.getUi();
  var tab =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_PO_HUB_SHEET_NAME);
  if (!tab || tab.getLastRow() <= 1)
    return ui.alert("데이터 없음. 발주 수집 먼저 실행.");
  var data = tab.getRange(2, 2, tab.getLastRow() - 1, 14).getValues();
  var byVendor = {};
  for (var i = 0; i < data.length; i++) {
    var v = String(data[i][0] || "").trim(),
      st = String(data[i][13] || "").trim();
    if (!byVendor[v]) byVendor[v] = { total: 0, done: 0, cancel: 0 };
    byVendor[v].total++;
    if (st.indexOf("발송완료") !== -1) byVendor[v].done++;
    else if (st.indexOf("취소") !== -1) byVendor[v].cancel++;
  }
  var lines = ["📊 협력업체 발주 현황 (총 " + data.length + "건)\n"];
  for (var vn in byVendor) {
    var s = byVendor[vn];
    lines.push(
      vn +
        ": " +
        s.total +
        "건 (발송:" +
        s.done +
        " 취소:" +
        s.cancel +
        " 대기:" +
        (s.total - s.done - s.cancel) +
        ")",
    );
  }
  ui.alert(lines.join("\n"));
}

// ═══════════════════════════════════════════
//  발주탭 헤더 복구
// ═══════════════════════════════════════════
function partnerRepairOrderHeaders() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  var defaultH =
    typeof _PT_ORDER_TAB_HEADERS_ !== "undefined"
      ? _PT_ORDER_TAB_HEADERS_.slice()
      : [
          "거래처명(자동)",
          "주문일자(자동)",
          "이카운트코드",
          "품목명(자동)",
          "수량",
          "수취인",
          "수취인전화번호",
          "수취인주소",
          "배송메시지",
          "적요",
          "송장번호",
          "정산금액(자동)",
          "고유ID(자동)",
          "상태(자동)",
          "도서산간배송비",
        ];
  var files = _pt_listFiles(),
    results = [];
  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (!ot) {
        results.push(files[i].name + ": 발주탭없음");
        continue;
      }
      var curHeaders = ot
        .getRange(1, 1, 1, Math.max(ot.getLastColumn(), defaultH.length))
        .getValues()[0];
      // ★ 전용양식이 발주탭에 잘못 적용되거나 초과 열이 있는 경우 강제 복구
      var needForceRepair = curHeaders.length > defaultH.length;
      if (needForceRepair && ot.getMaxColumns() > defaultH.length) {
        // 초과 열 정리
        if (ot.getLastRow() > 1) {
          try {
            var extraStart = defaultH.length + 1;
            var extraWidth = ot.getMaxColumns() - defaultH.length;
            ot.getRange(
              1,
              extraStart,
              ot.getMaxRows(),
              extraWidth,
            ).clearContent();
          } catch (eClear) {}
        }
        try {
          ot.deleteColumns(
            defaultH.length + 1,
            ot.getMaxColumns() - defaultH.length,
          );
        } catch (eDel) {}
      }

      // ★ 2026-08-07: 헤더 텍스트만 덮어쓰지 않음 — 열 정상화+수식복구
      //   (주문일자/수량 누락 상태에서 setValues만 하면 코드열이 '주문일자'로 오라벨됨)
      try {
        var rFix = _pt_repairOrderTabCollectMode_(ss);
        results.push(
          files[i].name +
            ": ✅ " +
            (rFix && rFix.msg ? rFix.msg : "헤더·수식 복구") +
            (needForceRepair ? " (초과열정리)" : ""),
        );
      } catch (eSpill) {
        try {
          ot.getRange(1, 1, 1, defaultH.length).setValues([defaultH]);
          ot.getRange("1:1")
            .setBackground("#1f4e78")
            .setFontColor("white")
            .setFontWeight("bold");
          ot.setFrozenRows(1);
          _pt_applyOrderTabDesign(ot);
        } catch (_) {}
        results.push(files[i].name + ": ⚠ 폴백 헤더만 적용");
      }
    } catch (e) {
      results.push(files[i].name + ": ❌ " + e.message);
    }
  }
  var msg = "발주탭 헤더 갱신 완료:\n" + results.join("\n");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ═══════════════════════════════════════════
//  발주탭 L열 spill 수식 일괄 갱신 (구버전 → 개별단가)
//  혜더도 "정산금액" → "단가"로 함께 수정
// ═══════════════════════════════════════════
function partnerRepairOrderSpillFormulas() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  var files = _pt_listFiles();
  var repaired = 0,
    skipped = 0,
    aa1Fixed = 0,
    errors = [];

  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (!ot) {
        skipped++;
        continue;
      }

      // ★ AA1 거래처명 수식 보정 (단가조회/뷰어 탭)
      var viewerTab = _pt_findViewerSheet(ss);
      try {
        if (viewerTab) {
          var aa1F = String(viewerTab.getRange("AA1").getFormula() || "");
          var aa1V = String(viewerTab.getRange("AA1").getValue() || "").trim();
          if (
            !aa1F ||
            aa1V.indexOf("#REF") !== -1 ||
            aa1V === "" ||
            aa1V.indexOf("[매핑") !== -1
          ) {
            var settingTab = ss.getSheetByName("설정");
            if (settingTab) {
              viewerTab
                .getRange("AA1")
                .setFormula("=IFERROR('설정'!B5, \"\")")
                .setFontColor("white");
              aa1Fixed++;
            }
          }
        }
      } catch (eAA1) {}

      // ★ 2026-07-16: 수집모드 정리 (스필수식 제거 + 빈칸채움)
      var r = _pt_repairOrderTabCollectMode_(ss);
      if (r && r.ok && r.msg !== "이상없음") repaired++;
      else if (r && r.ok) skipped++;
      else skipped++;
    } catch (e) {
      errors.push(files[i].name + ": " + e.message);
    }
  }

  var msg =
    "⚡ 발주탭 수집모드 복구 완료\n" +
    "- 정리됨: " +
    repaired +
    "개\n" +
    "- AA1(뷰어 거래처명) 보정: " +
    aa1Fixed +
    "개\n" +
    "- 이미 정상/스킵: " +
    skipped +
    "개\n" +
    (errors.length ? "\n오류:\n" + errors.join("\n") : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ═══════════════════════════════════════════
//  실시간 자동 수집 트리거 (5분 간격)
// ═══════════════════════════════════════════
var _PO_TRIGGER_FUNC = "partnerCollectOrdersSilent_";
var _PO_TRIGGER_MINUTES = 5;

/** 트리거에서 호출되는 silent 래퍼 (UI 없이 자동 실행) */
/** ★ 자동 트리거: 허브 수집 + 업체시트에 "접수완료" 역기록 포함 */
/** ★ 2026-07-03: opt_noWriteBack=false로 변경 — 상태 미기록 시 조건부서식 미작동 문제 해결 */
function partnerCollectOrdersSilent_() {
  // ★ 2026-06-27: 주말 차단
  if (_pt_isWeekendBlackout_()) { Logger.log("[BLACKOUT] 주말 차단 → 발주 수집 스킵"); return; }
  var startTime = new Date();
  var collectOk = false, salesOk = false, errorMsg = "";
  // ① 발주 수집 (협력업체 발주탭 → 허브) — 업체시트에 "접수완료" 역기록 포함
  try {
    partnerCollectOrders(false); // ★ 2026-07-03: noWriteBack=false → 상태값도 함께 기록
    collectOk = true;
  } catch (e) {
    errorMsg = String(e.message || e);
    try { Logger.log("[PARTNER_COLLECT_TRIGGER_ERR] " + errorMsg); } catch (_) {}
  }
  // ② 폐기송장 적용 (폐기송장 탭에 등록된 송장번호를 허브에서 자동 제거)
  try {
    if (typeof partnerApplyVoidedInvoicesSilent_ === "function")
      partnerApplyVoidedInvoicesSilent_();
  } catch (e) {
    try { Logger.log("[VOID_INVOICE_TRIGGER_ERR] " + String(e.message || e)); } catch (_) {}
  }
  // ③ ★ 2026-07-02: 판매현황 갱신 (발주수집 후 자동 실행)
  try {
    partnerRebuildSalesUploadSheet(true); // silent=true
    salesOk = true;
    Logger.log("[SALES_REFRESH] 판매현황 갱신 완료");
  } catch (e) {
    try { Logger.log("[SALES_REFRESH_ERR] " + String(e.message || e)); } catch (_) {}
  }
  // ★ 2026-07-02: PEP_AUTO_PUSH 연쇄 호출 제거
  // Push는 별도 트리거(09:20/14:20)에서 실행 → 6분 초과 방지 + 중복 실행 방지

  // ④ Chat 알림
  var elapsed = Math.round((new Date() - startTime) / 1000);
  var now = Utilities.formatDate(startTime, "Asia/Seoul", "HH:mm");
  try {
    if (collectOk) {
      _chat_sendCard_("📦 발주 수집 완료", now, [
        { label: "판매현황 갱신", value: salesOk ? "✅" : "❌" },
        { label: "⏱ 소요시간", value: elapsed + "초" },
      ]);
    } else {
      _chat_sendCard_("❌ 발주 수집 에러", now, [
        { label: "오류", value: errorMsg.substring(0, 200) },
      ]);
    }
  } catch (_) {}
}

/** 대리발주 자동 Push ON */
function partnerEnableAutoPush() {
  PropertiesService.getScriptProperties().setProperty("PEP_AUTO_PUSH", "ON");
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    "✅ 대리발주 자동 Push: ON\n\n발주 자동 수집 트리거 실행 시 대리발주 Push도 함께 실행됩니다.",
  );
}

/** 대리발주 자동 Push OFF */
function partnerDisableAutoPush() {
  PropertiesService.getScriptProperties().setProperty("PEP_AUTO_PUSH", "OFF");
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    "⏸ 대리발주 자동 Push: OFF\n\n발주 자동 수집 트리거 실행 시 대리발주 Push는 실행되지 않습니다.\n수동으로만 Push 가능합니다.",
  );
}

/** 대리발주 자동 Push 상태 확인 */
function partnerShowAutoPushStatus() {
  var status =
    PropertiesService.getScriptProperties().getProperty("PEP_AUTO_PUSH") ||
    "OFF";
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    "📋 대리발주 자동 Push 상태: " +
      status +
      "\n\n" +
      (status === "ON"
        ? "발주 수집 트리거 실행 시 대리발주 Push도 자동 실행됩니다."
        : "대리발주 Push는 수동으로만 실행됩니다."),
  );
}

/** 자동 수집 트리거 켜기 */
function partnerSetupAutoCollectTrigger() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PO_TRIGGER_FUNC) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  ScriptApp.newTrigger(_PO_TRIGGER_FUNC)
    .timeBased()
    .everyMinutes(_PO_TRIGGER_MINUTES)
    .create();
  ui.alert(
    "✅ 협력업체 발주 자동 수집 " +
      _PO_TRIGGER_MINUTES +
      "분 간격으로 설정됨\n" +
      (removed > 0 ? "(기존 트리거 " + removed + "개 교체)\n" : "") +
      "\n전용양식·발주탭 신규 발주가 약 " +
      _PO_TRIGGER_MINUTES +
      "분 내에\n" +
      "협력업체_발주허브로 자동 수집됩니다.",
  );
}

/** 자동 수집 트리거 끄기 */
function partnerRemoveAutoCollectTrigger() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PO_TRIGGER_FUNC) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  ui.alert(
    removed > 0
      ? "✅ 자동 수집 트리거 해제 (" + removed + "개 삭제)"
      : "ℹ️ 등록된 자동 수집 트리거 없음",
  );
}

/** 자동 수집 트리거 상태 확인 */
function partnerShowAutoCollectTriggerStatus() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var found = [];
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PO_TRIGGER_FUNC) {
      found.push("  ID: " + existing[i].getUniqueId());
    }
  }
  ui.alert(
    found.length > 0
      ? "✅ 자동 수집 가동 중 (" +
          _PO_TRIGGER_MINUTES +
          "분 간격)\n" +
          found.join("\n")
      : "⏸ 자동 수집 꺼져 있음\n'⏰ 자동 수집 켜기' 메뉴를 실행하세요.",
  );
}

// ─────────────────────────────────────────────────────
//  대리발주 Push 자동 트리거 켜기/끄기
//  독립배포 adminSetupProxyPushAutoTrigger_ 대응
// ─────────────────────────────────────────────────────
var _PEP_PUSH_TRIGGER_FUNC = "partnerPushOrdersToExclusiveFormsSilent_";
var _PEP_PUSH_TRIGGER_MINUTES = 5;

/** 대리발주 Push 자동 트리거 켜기 (5분 간격) */
function partnerSetupPushAutoTrigger() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PEP_PUSH_TRIGGER_FUNC) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  ScriptApp.newTrigger(_PEP_PUSH_TRIGGER_FUNC)
    .timeBased()
    .everyMinutes(_PEP_PUSH_TRIGGER_MINUTES)
    .create();
  ui.alert(
    "✅ 대리발주 Push 자동 실행 설정\n" +
      "간격: " +
      _PEP_PUSH_TRIGGER_MINUTES +
      "분\n" +
      (removed > 0 ? "(기존 트리거 " + removed + "개 교체)\n" : "") +
      "\n대리공급업체 발주 소스 탭의 신규 발주가\n" +
      "약 " +
      _PEP_PUSH_TRIGGER_MINUTES +
      "분 내에 각 업체 전용양식으로 자동 Push됩니다.",
  );
}

/** 대리발주 Push 자동 트리거 끄기 */
function partnerRemovePushAutoTrigger() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PEP_PUSH_TRIGGER_FUNC) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  ui.alert(
    removed > 0
      ? "✅ 대리발주 Push 자동 실행 해제 (" + removed + "개 삭제)"
      : "ℹ️ 등록된 Push 트리거 없음",
  );
}

// ═══════════════════════════════════════════
//  이카운트 판매현황 업로드용 (협력업체_발주허브 전용)
//  기존 "통합 발주 DB" 연동과 완전 독립
// ═══════════════════════════════════════════

var _PO_SALES_UPLOAD_TAB = "이카운트-판매현황업로드용(협력업체)";
var _PO_SALES_UPLOAD_HEADERS = [
  "출고일자",
  "순번",
  "거래처코드",
  "거래처명",
  "결제일자",
  "담당자",
  "주문일자",
  "출하창고",
  "거래유형",
  "통화",
  "환율",
  "전미수금",
  "총미수금",
  "참고사항",
  "배송방법",
  "품목코드",
  "품목명",
  "수량",
  "단가",
  "외화금액",
  "공급가액",
  "부가세",
  "금액1",
  "적요",
  "주문자명(사방넷)",
  "전화번호(사방넷)",
  "배송지(사방넷)/배송메시지",
  "생산전표생성",
];

/**
 * 협력업체_발주허브 → 이카운트 판매현황 업로드 양식(복붙용) 시트 생성/갱신
 *
 * 흐름:
 *   1) 협력업체_발주허브 전체 발주 변환 (날짜 필터 없음)
 *   2) 발주업체 → 거래처코드(CUST_CD) 매핑 (협력업체 설정탭 B5/B6 우선)
 *   3) 이카운트 판매현황 엑셀 업로드 양식으로 변환
 *   4) '이카운트-판매현황업로드용(협력업체)' 탭에 기록
 */
function partnerRebuildSalesUploadSheet(silent) {
  var ui = null;
  if (!silent) {
    try {
      ui = SpreadsheetApp.getUi();
    } catch (e) {}
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(45000)) {
    if (ui) {
      ui.alert(
        "다른 판매현황 갱신 작업이 진행 중입니다.\n잠시 후 다시 시도하세요.",
      );
    }
    return;
  }

  try {
    partnerRebuildSalesUploadSheetCore_(ss, ui, silent);
  } finally {
    lock.releaseLock();
  }
}

function partnerRebuildSalesUploadSheetCore_(ss, ui, silent) {
  // 1) 협력업체_발주허브 읽기
  var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hubTab || hubTab.getLastRow() < 2) {
    _po_writeSalesUploadSheet_(ss, [], { silent: true });
    if (ui) {
      ui.alert(
        "협력업체_발주허브에 데이터가 없습니다.\n" +
          "판매현황 업로드용 탭은 헤더만 남기고 초기화했습니다.\n" +
          "먼저 '발주 수집'을 실행하세요.",
      );
    }
    return;
  }

  // P열 헤더가 없으면 자동 설정
  try {
    var pHeader = hubTab.getLastColumn() >= 16 ? String(hubTab.getRange(1, 16).getValue() || "").trim() : "";
    if (!pHeader) {
      hubTab.getRange(1, 16).setValue("판매갱신 업 완료 여부")
        .setBackground("#d9d9d9")
        .setFontWeight("bold");
    }
  } catch (eHdr) {}

  var hubLr = hubTab.getLastRow();
  // P열(16번째 열) 데이터를 포함하기 위해 16열까지 로드
  var hubData = hubTab
    .getRange(2, 1, hubLr - 1, 16)
    .getValues();

  // 2) 업체→거래처코드 매핑 구축
  var vendorMap = _po_buildVendorCustCdMap_();

  // 3) 허브 단가 테이블 (정산금액 미입력 시 폴백)
  var hubPriceMap = {};
  var groupCols = {};
  try {
    var priceTab = ss.getSheetByName("전체 그룹 단가표");
    if (priceTab && priceTab.getLastRow() >= 3) {
      var pAll = priceTab
        .getRange(1, 1, priceTab.getLastRow(), priceTab.getLastColumn())
        .getValues();
      for (var gc = 6; gc < pAll[0].length; gc += 5) {
        var gn = String(pAll[0][gc] || "").trim();
        if (gn) groupCols[gn] = gc;
      }
      for (var pr = 2; pr < pAll.length; pr++) {
        var pc = String(pAll[pr][2] || "").trim();
        if (pc) hubPriceMap[pc] = pAll[pr];
      }
    }
  } catch (eP) {}

  // 4) 데이터 변환 (날짜 제한 없이 전체 처리)
  var colCount = _PO_SALES_UPLOAD_HEADERS.length;
  var out = [];
  var skipCount = 0;
  var skipReasons = {};
  var noMapVendors = {};
  var hubPUpdates = []; // P열 상태 갱신을 저장할 버퍼

  for (var r = 0; r < hubData.length; r++) {
    var row = hubData[r];
    var statusRaw = String(row[14] || "").trim();
    var stCompact = statusRaw.replace(/\s/g, "");
    var ecountUpRaw = String(row[15] || "").trim(); // P열 (판매갱신 업 완료 여부)

    // 이미 판매갱신 업 완료된 건 제외 (기존 "이카운트 업 완료", "판매현황 업 완료"도 호환)
    if (ecountUpRaw === "판매갱신 업 완료" || ecountUpRaw === "이카운트 업 완료" || ecountUpRaw === "판매현황 업 완료") {
      skipCount++;
      _po_countReason_(skipReasons, "이미 판매갱신 업됨");
      continue;
    }

    // 취소/반품/불용 제외
    if (
      stCompact.indexOf("취소") !== -1 ||
      stCompact.indexOf("반품") !== -1 ||
      stCompact.indexOf("불용") !== -1
    ) {
      skipCount++;
      _po_countReason_(skipReasons, "취소/반품/불용");
      continue;
    }

    // ★ 2026-06-17: 품절/품절임박은 출고승인 전까지 이카운트 제외
    // "✅출고가능"은 통과 (출고가능에는 "품절" 문자가 없으므로 자동 통과)
    if (
      (stCompact.indexOf("품절") !== -1 && stCompact.indexOf("출고가능") === -1) ||
      stCompact.indexOf("단종") !== -1
    ) {
      skipCount++;
      _po_countReason_(skipReasons, "품절/단종 (출고미승인)");
      continue;
    }

    var vendor = String(row[1] || "").trim();
    var rawDate = row[3];
    var orderDate = "";
    if (rawDate instanceof Date) {
      orderDate = Utilities.formatDate(rawDate, "Asia/Seoul", "yyyyMMdd");
    } else {
      orderDate = String(rawDate || "").replace(/[^0-9]/g, "");
      if (orderDate.length > 8) orderDate = orderDate.substring(0, 8);
    }

    var code = String(row[4] || "").trim();
    var itemName = String(row[5] || "").trim();
    var qty = parseFloat(row[6]) || 0;
    var priceRaw = parseFloat(row[11]) || 0;

    // 빈 행 스킵
    if (!code && !itemName && qty === 0) continue;
    if (!orderDate) {
      skipCount++;
      _po_countReason_(skipReasons, "주문일자 누락");
      continue;
    }
    if (!code) {
      skipCount++;
      _po_countReason_(skipReasons, "이카운트코드 누락");
      continue;
    }
    if (qty <= 0) {
      skipCount++;
      _po_countReason_(skipReasons, "수량 0");
      continue;
    }

    // 거래처코드 조회
    var custCd = _po_resolveVendorCustCd_(vendor, vendorMap);
    if (!custCd) {
      var normVendor = vendor.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
      noMapVendors[vendor] = normVendor !== vendor ? "(정규화: " + normVendor + ")" : "";
      skipCount++;
      _po_countReason_(skipReasons, "거래처코드 미매핑");
      continue;
    }

    // 단가 결정: 허브 정산금액 → 없으면 허브 단가표 폴백
    var unitPrice = priceRaw;
    if (unitPrice <= 0 && hubPriceMap[code]) {
      var vEntry =
        vendorMap[vendor] ||
        vendorMap[vendor.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase()];
      if (
        vEntry &&
        vEntry.groupName &&
        groupCols[vEntry.groupName] !== undefined
      ) {
        var gCol = groupCols[vEntry.groupName];
        var hp = parseFloat(hubPriceMap[code][gCol]);
        if (!isNaN(hp) && hp > 0) unitPrice = hp;
      }
    }
    if (unitPrice <= 0) {
      skipCount++;
      _po_countReason_(skipReasons, "단가 미확정");
      continue;
    }

    var totalAmt = Math.round(qty * unitPrice);
    var supplyAmt = Math.round(totalAmt / 1.1);
    var vatAmt = totalAmt - supplyAmt;

    var addr = String(row[9] || "").trim();
    var msg2 = String(row[10] || "").trim();
    var addrMsg = [addr, msg2]
      .filter(function (x) {
        return x;
      })
      .join(" / ");

    var line = new Array(colCount);
    for (var c = 0; c < colCount; c++) line[c] = "";

    line[0] = orderDate; // 출고일자
    line[2] = custCd; // 거래처코드
    line[7] = "100"; // 출하창고
    line[15] = code; // 품목코드
    line[17] = qty; // 수량
    line[18] = unitPrice; // 단가
    line[20] = supplyAmt; // 공급가액
    line[21] = vatAmt; // 부가세
    line[22] = totalAmt; // 금액1
    line[23] = String(row[12] || "").trim(); // 적요 (허브 M열 → 업로드용 X열)
    var recipientName = String(row[7] || "").trim();
    var uniqueId = String(row[2] || "").trim(); // 허브 C열(인덱스2): 고유ID
    line[24] = uniqueId
      ? recipientName + "/" + uniqueId // 주문자명/고유ID
      : recipientName; // 고유ID 없으면 이름만
    var ph2 = String(row[8] || "").trim(); // 전화번호
    // getValues() 시 숫자형으로 인식되어 앞의 0이 날아간 경우 복원
    if (ph2.length >= 8 && ph2.length <= 10 && !/^0/.test(ph2)) {
      ph2 = "0" + ph2;
    }
    line[25] = ph2;
    line[26] = addrMsg; // 배송지/배송메시지
    line[27] = "Y"; // 생산전표생성

    out.push(line);
    // 반영 완료 목록에 현재 행 번호 기록 (2부터 시작하므로 r + 2)
    hubPUpdates.push(r + 2);
  }

  // 5) 시트 생성/갱신 (전량 덮어쓰기 + 잔여 행 정리)
  _po_writeSalesUploadSheet_(ss, out, { silent: silent });

  // 5-2) 반영된 행들 허브 P열에 완료 기록 기입
  // ★ 2026-07-17 (M1): 행별 setValue → P열 setValues 1회
  if (hubPUpdates.length > 0) {
    var pColVals = hubTab.getRange(2, 16, hubData.length, 1).getValues();
    for (var ui2 = 0; ui2 < hubPUpdates.length; ui2++) {
      var pRowIdx = hubPUpdates[ui2] - 2;
      if (pRowIdx >= 0 && pRowIdx < pColVals.length) {
        pColVals[pRowIdx][0] = "판매갱신 업 완료";
      }
    }
    hubTab.getRange(2, 16, hubData.length, 1).setValues(pColVals);
    SpreadsheetApp.flush();
  }

  // 5-3) 오전/오후 중복 점검용 이력 적재
  //   이 탭은 전량 재작성되고 올라간 허브 행은 P열로 잠기므로,
  //   지금 무엇이 올라갔는지 남겨두지 않으면 오후에 오전 건과 비교할 수 없다.
  try {
    _dw_appendSalesHistory_(ss, hubData, hubPUpdates);
  } catch (eDw) {
    Logger.log("[DupWatch] 갱신이력 적재 실패: " + eDw.message);
  }

  // 6) 요약
  var noMapList = Object.keys(noMapVendors);
  var reasonLines = [];
  for (var rk in skipReasons) {
    reasonLines.push("  " + rk + ": " + skipReasons[rk] + "건");
  }

  // ★ 미매핑 업체 상세 (허브 업체명 + 정규화명 표시)
  var noMapDetail = [];
  for (var nmk in noMapVendors) {
    var suffix = noMapVendors[nmk] || "";
    noMapDetail.push("  · '" + nmk + "' " + suffix);
  }

  var summaryMsg =
    "📋 협력업체 판매현황 업로드용 갱신 완료\n\n" +
    "- 탭: " +
    _PO_SALES_UPLOAD_TAB +
    "\n" +
    "- 반영: " +
    out.length +
    "건\n" +
    "- 스킵: " +
    skipCount +
    "건\n" +
    (reasonLines.length > 0 ? "\n스킵 사유:\n" + reasonLines.join("\n") : "") +
    (noMapDetail.length > 0
      ? "\n\n⚠ 거래처코드 미매핑 업체 (" + noMapDetail.length + "개):\n" +
        noMapDetail.slice(0, 15).join("\n") +
        "\n\n→ 매핑 확인 방법:\n" +
        "  1. 협력업체 파일 > 설정 탭 > B5(거래처명) / B6(거래처코드)\n" +
        "  2. 허브의 '발주업체' 이름과 설정 B5가 정확히 일치하는지 확인"
      : "");
  Logger.log(summaryMsg);
  if (ui) ui.alert(summaryMsg);
}

/**
 * 판매현황 업로드용 탭을 헤더+데이터로 전량 재작성한다.
 * clearContents만으로 남는 이전 행(복붙 시 유령 데이터)을 tail clear로 제거.
 */
function _po_writeSalesUploadSheet_(ss, out, opts) {
  opts = opts || {};
  out = out || [];
  var colCount = _PO_SALES_UPLOAD_HEADERS.length;
  var sh = ss.getSheetByName(_PO_SALES_UPLOAD_TAB);
  if (!sh) sh = ss.insertSheet(_PO_SALES_UPLOAD_TAB);

  var prevLastRow = sh.getLastRow();
  sh.clearContents();
  sh.getRange(1, 1, 1, colCount).setValues([_PO_SALES_UPLOAD_HEADERS]);
  sh.getRange("1:1")
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  sh.setFrozenRows(1);
  try {
    sh.setTabColor("#e06c75");
  } catch (e) {}

  if (out.length > 0) {
    sh.getRange(2, 1, out.length, colCount).setValues(out);
    sh.getRange(2, 18, out.length, 1).setNumberFormat("#,##0"); // 수량
    sh.getRange(2, 19, out.length, 1).setNumberFormat("#,##0"); // 단가
    sh.getRange(2, 21, out.length, 3).setNumberFormat("#,##0"); // 공급가액~금액1

    // ★ C열(3번째=거래처코드) 선행 0 보존: 텍스트 서식 지정 후 값 재기입
    var custRange = sh.getRange(2, 3, out.length, 1);
    custRange.setNumberFormat("@");
    var custVals = [];
    for (var ci = 0; ci < out.length; ci++) {
      custVals.push([String(out[ci][2] || "")]);
    }
    custRange.setValues(custVals);

    // ★ Z열(26번째=전화번호) 선행 0 보존: 텍스트 서식 지정 후 값 재기입
    var phoneRange = sh.getRange(2, 26, out.length, 1);
    phoneRange.setNumberFormat("@");
    var phoneVals = [];
    for (var pvi = 0; pvi < out.length; pvi++) {
      phoneVals.push([String(out[pvi][25] || "")]);
    }
    phoneRange.setValues(phoneVals);
  }

  // 이전보다 행 수가 줄었을 때 남는 잔여 데이터 정리 (ecount.gs 동일 패턴)
  var newLastRow = out.length > 0 ? out.length + 1 : 1;
  var tailEnd = Math.max(sh.getLastRow(), prevLastRow);
  if (tailEnd > newLastRow) {
    sh.getRange(newLastRow + 1, 1, tailEnd - newLastRow, colCount).clearContent();
  }

  sh.autoResizeColumns(1, colCount);
  if (!opts.silent) SpreadsheetApp.flush();
}

/** 메뉴 래퍼: 수동 갱신 */
function partnerRebuildSalesUploadSheetManual() {
  partnerRebuildSalesUploadSheet(false);
}

// ─────────────────────────────────────────────────────
//  헬퍼: 업체→거래처코드 매핑 구축
//  소스 우선순위: ① 협력업체 설정탭(B5/B6) → ② 업체등급단가매핑 시트
//  ★ 2026-06-26: CacheService 캐시 추가 + ①③ 루프 통합 (openById 절반 감소)
// ─────────────────────────────────────────────────────
function _po_buildVendorCustCdMap_() {
  // ★ 캐시 확인 (TTL 6시간)
  try {
    var cached = CacheService.getScriptCache().get("vendorCustCdMap");
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed && Object.keys(parsed).length > 0) {
        Logger.log("[VendorMap] 캐시 히트: " + Object.keys(parsed).length + "키");
        return parsed;
      }
    }
  } catch (eCacheRead) {}

  var map = {};

  // ① + ③ 통합: 협력업체 파일의 설정탭에서 직접 읽기 (1회 루프로 통합)
  try {
    var files = _pt_listFiles();
    for (var fi = 0; fi < files.length; fi++) {
      try {
        var pss = SpreadsheetApp.openById(files[fi].id);
        var st = pss.getSheetByName("설정");
        if (!st) continue;
        var vName = String(st.getRange("B5").getValue() || "").trim();
        var vCust = String(st.getRange("B6").getDisplayValue() || "").trim();
        if (!vName || !vCust) continue;
        var entry = { custCd: vCust, groupName: "" };
        if (!map[vName]) map[vName] = entry;
        // 기본 정규화 키
        var norm = vName.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
        if (norm && norm !== vName && !map[norm]) map[norm] = entry;
        // 법인 표현 제거 정규화 키 (주식회사, (주), ㈜ 등)
        var normCorp = vName
          .replace(/주식회사|유한회사|농업회사법인/gi, "")
          .replace(/\(주\)|㈜/gi, "")
          .replace(/[^가-힣a-zA-Z0-9]/g, "")
          .toLowerCase()
          .trim();
        if (normCorp && !map[normCorp]) map[normCorp] = entry;
        // 파일명 기반 레이블도 키로 등록
        var fileLabel = files[fi].name
          .replace("[협력업체] ", "")
          .replace(/\s*\(소비자용\).*$/, "")
          .trim();
        if (fileLabel && !map[fileLabel]) map[fileLabel] = entry;
        var normFile = fileLabel.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
        if (normFile && !map[normFile]) map[normFile] = entry;
      } catch (e) {}
    }
  } catch (e) {}

  // ② 기존 매핑사전(업체등급단가매핑) 보조 사용
  try {
    var mainSS = SpreadsheetApp.getActiveSpreadsheet();
    var mapSheet = mainSS.getSheetByName("업체등급단가매핑");
    if (mapSheet && mapSheet.getLastRow() >= 2) {
      var mData = mapSheet.getDataRange().getValues();
      var mHdr = mData[0];
      var vCol = -1,
        cCol = -1,
        gCol2 = -1;
      for (var h = 0; h < mHdr.length; h++) {
        var hn = String(mHdr[h] || "").replace(/\s/g, "");
        if (
          vCol === -1 &&
          (hn.indexOf("거래처명") !== -1 || hn.indexOf("업체") !== -1)
        )
          vCol = h;
        if (
          cCol === -1 &&
          (hn.indexOf("CUST_CD") !== -1 || hn.indexOf("거래처코드") !== -1)
        )
          cCol = h;
        if (
          gCol2 === -1 &&
          (hn.indexOf("단가그룹") !== -1 || hn.indexOf("그룹명") !== -1)
        )
          gCol2 = h;
      }
      if (vCol !== -1 && cCol !== -1) {
        for (var mr = 1; mr < mData.length; mr++) {
          var mv = String(mData[mr][vCol] || "").trim();
          var mc = String(mData[mr][cCol] || "").trim();
          if (!mv || !mc) continue;
          if (map[mv]) continue; // 설정탭 우선
          var mEntry = {
            custCd: mc,
            groupName:
              gCol2 !== -1 ? String(mData[mr][gCol2] || "").trim() : "",
          };
          map[mv] = mEntry;
          var mNorm = mv.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
          if (mNorm && mNorm !== mv && !map[mNorm]) map[mNorm] = mEntry;
        }
      }
    }
  } catch (e) {}

  // ★ 캐시 저장 (6시간 = 21600초, 최대 100KB)
  try {
    var jsonStr = JSON.stringify(map);
    if (jsonStr.length < 100000) {
      CacheService.getScriptCache().put("vendorCustCdMap", jsonStr, 21600);
      Logger.log("[VendorMap] 캐시 저장: " + Object.keys(map).length + "키, " + jsonStr.length + "bytes");
    }
  } catch (eCacheWrite) {}

  return map;
}

// ─────────────────────────────────────────────────────────────
//  진단: 거래처코드 미매핑 원인 상세 점검
//  메뉴: 💼 협력업체 관리 → 🛠️ AS/진단 → 🔍 진단·운영 → 거래처코드 매핑 진단
// ─────────────────────────────────────────────────────────────
function partnerDiagnoseCustCdMapping() {
  var ui = SpreadsheetApp.getUi();
  var lines = ["📋 거래처코드 매핑 진단\n"];

  // 1) 모든 협력업체 파일의 설정탭 B5/B6 스캔
  var files = _pt_listFiles();
  lines.push("【협력업체 파일 설정탭 B5/B6 현황】");
  var settingsMap = {}; // B5→{custCd, fileName}
  for (var fi = 0; fi < files.length; fi++) {
    try {
      var pss = SpreadsheetApp.openById(files[fi].id);
      var st = pss.getSheetByName("설정");
      var b5 = st ? String(st.getRange("B5").getValue() || "").trim() : "(설정탭없음)";
      var b6 = st ? String(st.getRange("B6").getDisplayValue() || "").trim() : "";
      var fileLabel = files[fi].name.replace("[협력업체] ", "").trim();
      var status;
      if (!st) {
        status = "⚠ 설정탭 없음";
      } else if (!b5) {
        status = "⚠ B5(거래처명) 비어있음";
      } else if (!b6) {
        status = "🚨 B6(거래처코드) 비어있음 ← 이게 원인";
      } else {
        status = "✅ B5=" + b5 + " / B6=" + b6;
        settingsMap[b5] = b6;
      }
      lines.push("  · 파일명: " + fileLabel + " → " + status);
    } catch (e) {
      lines.push("  · " + files[fi].name + " → 오류: " + e.message);
    }
  }

  // 2) 허브에 있는 발주업체명 vs 설정 B5 비교
  lines.push("\n【허브 발주업체명 vs 설정 B5 매핑 결과】");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  var hubVendors = {};
  if (hubTab && hubTab.getLastRow() >= 2) {
    var hubData = hubTab.getRange(2, 2, hubTab.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < hubData.length; r++) {
      var v = String(hubData[r][0] || "").trim();
      if (v) hubVendors[v] = (hubVendors[v] || 0) + 1;
    }
  }
  var vendorMap = _po_buildVendorCustCdMap_();
  var unmapped = [];
  for (var vn in hubVendors) {
    var cd = _po_resolveVendorCustCd_(vn, vendorMap);
    if (cd) {
      lines.push("  ✅ '" + vn + "' → " + cd + " (" + hubVendors[vn] + "건)");
    } else {
      unmapped.push(vn);
      lines.push("  🚨 '" + vn + "' → 코드없음 (" + hubVendors[vn] + "건)");
    }
  }

  if (unmapped.length > 0) {
    lines.push("\n【조치 방법】");
    lines.push("미매핑 업체(" + unmapped.length + "개)의 협력업체 파일 > 설정 탭:");
    lines.push("  - B5: 위 목록의 정확한 업체명 입력 (또는 허브와 일치하게)");
    lines.push("  - B6: 이카운트 거래처코드 입력");
    lines.push("\n또는 메뉴 → [허브 발주업체명 일괄 보정]으로");
    lines.push("설정 B5 기준으로 허브 업체명을 자동 재정규화할 수 있습니다.");
  } else {
    lines.push("\n✅ 모든 업체가 정상 매핑되어 있습니다.");
  }

  ui.alert(lines.join("\n"));
}

// ─────────────────────────────────────────────────────────────
//  소급 수정: 허브에 저장된 발주업체명을 설정 B5 기준으로 일괄 재정규화
//  (파일명 기반으로 수집된 기존 데이터 → B5 기준으로 덮어쓰기)
// ─────────────────────────────────────────────────────────────
function partnerFixHubVendorLabels() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    "허브 발주업체명 일괄 보정",
    "협력업체 파일의 설정 B5(거래처명)를 기준으로\n" +
    "허브의 발주업체명을 재정규화합니다.\n\n" +
    "파일명 기반으로 수집된 기존 데이터가 B5 값으로 교체됩니다.\n계속하시겠습니까?",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp !== ui.Button.OK) return;

  // 파일명 → B5 역매핑 구축
  var files = _pt_listFiles();
  var fileNameToB5 = {}; // "장동왕성" → "장동왕성코리아"
  var b5ToCustCd = {};
  for (var fi = 0; fi < files.length; fi++) {
    try {
      var pss = SpreadsheetApp.openById(files[fi].id);
      var st = pss.getSheetByName("설정");
      if (!st) continue;
      var b5 = String(st.getRange("B5").getValue() || "").trim();
      var b6 = String(st.getRange("B6").getDisplayValue() || "").trim();
      if (!b5) continue;
      var fileLabel = files[fi].name.replace("[협력업체] ", "").replace(/\s*\(소비자용\).*$/, "").trim();
      fileNameToB5[fileLabel] = b5;
      if (b6) b5ToCustCd[b5] = b6;
    } catch (e) {}
  }

  // 허브 발주업체(col 2) 일괄 교체
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hubTab || hubTab.getLastRow() < 2) {
    ui.alert("허브에 데이터가 없습니다.");
    return;
  }
  var lr = hubTab.getLastRow();
  var vendorVals = hubTab.getRange(2, 2, lr - 1, 1).getValues();
  var changed = 0;
  for (var r = 0; r < vendorVals.length; r++) {
    var orig = String(vendorVals[r][0] || "").trim();
    if (!orig) continue;
    var mapped = fileNameToB5[orig];
    if (mapped && mapped !== orig) {
      vendorVals[r][0] = mapped;
      changed++;
    }
  }
  if (changed === 0) {
    ui.alert("변경할 항목이 없습니다. (이미 B5 기준이거나 파일명=B5)");
    return;
  }
  hubTab.getRange(2, 2, lr - 1, 1).setValues(vendorVals);
  ui.alert("✅ " + changed + "건의 발주업체명이 설정 B5 기준으로 보정되었습니다.\n\n판매현황 갱신을 다시 실행하세요.");
}

// 업체명 → 거래처코드 조회
function _po_resolveVendorCustCd_(vendorName, vendorMap) {
  if (!vendorName || !vendorMap) return "";
  if (vendorMap[vendorName] && vendorMap[vendorName].custCd)
    return vendorMap[vendorName].custCd;
  var norm = vendorName.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
  if (norm && vendorMap[norm] && vendorMap[norm].custCd)
    return vendorMap[norm].custCd;
  if (typeof resolveVendorMapEntry_ === "function") {
    try {
      var entry = resolveVendorMapEntry_(vendorName, vendorMap);
      if (entry && entry.custCd) return entry.custCd;
    } catch (e) {}
  }
  return "";
}

// 스킵 사유 카운터
function _po_countReason_(reasons, key) {
  reasons[key] = (reasons[key] || 0) + 1;
}

// ═══════════════════════════════════════════
//  폐기송장 관리
//  "폐기송장" 탭에 등록된 송장번호는:
//   ① 송장 수집(partnerFetchInvoices) 시 매칭에서 자동 제외
//   ② 이미 허브에 입력된 경우에도 자동 제거 (송장번호 삭제 + 상태 복원)
// ═══════════════════════════════════════════

var _PO_VOID_TAB_NAME = "대리판매_폐기송장";
var _PO_VOID_TAB_NAME_LEGACY = "폐기송장"; // 구버전 호환
var _PO_VOID_HEADERS = [
  "송장번호",
  "판매처",
  "품목명",
  "수량",
  "수취인",
  "사유",
  "등록일시",
];

/** 폐기송장 탭 가져오기 (없으면 생성). 구버전 '폐기송장' 탭도 폴백 지원 */
function _po_getVoidInvoiceTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PO_VOID_TAB_NAME);
  if (!tab) tab = ss.getSheetByName(_PO_VOID_TAB_NAME_LEGACY); // 구버전 호환
  if (!tab) {
    tab = ss.insertSheet(_PO_VOID_TAB_NAME);
    tab
      .getRange(1, 1, 1, _PO_VOID_HEADERS.length)
      .setValues([_PO_VOID_HEADERS]);
    tab
      .getRange("1:1")
      .setBackground("#c0392b")
      .setFontColor("white")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    tab.setFrozenRows(1);
    tab.setColumnWidth(1, 180); // 송장번호
    tab.setColumnWidth(2, 120); // 판매처
    tab.setColumnWidth(3, 200); // 품목명
    tab.setColumnWidth(4, 60); // 수량
    tab.setColumnWidth(5, 100); // 수취인
    tab.setColumnWidth(6, 250); // 사유
    tab.setColumnWidth(7, 160); // 등록일시
    // A열 텍스트 서식 (송장번호 선행 0 보존)
    tab.getRange("A:A").setNumberFormat("@");
    SpreadsheetApp.flush();
  }
  return tab;
}

/**
 * 폐기송장 목록 로드 → Set 반환
 * 숫자 정규화: 순수 숫자만 추출 → 비교 시 하이픈·공백 무시
 */
function _po_loadVoidInvoiceSet_() {
  var voidSet = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tab = ss.getSheetByName(_PO_VOID_TAB_NAME);
    if (!tab) tab = ss.getSheetByName(_PO_VOID_TAB_NAME_LEGACY);
    if (!tab || tab.getLastRow() < 2) return voidSet;
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      var inv = String(data[i][0] || "").trim();
      if (inv) {
        voidSet[inv] = true;
        // 숫자만 추출한 키도 등록 (하이픈/공백 포함 송장번호 대응)
        var digits = inv.replace(/[^0-9]/g, "");
        if (digits) voidSet[digits] = true;
      }
    }
  } catch (e) {}
  return voidSet;
}

/** 송장번호가 폐기 목록에 있는지 확인 (줄바꿈으로 구분된 다중 송장도 검사) */
function _po_isVoidedInvoice_(invCell, voidSet) {
  if (!invCell) return false;
  var lines = String(invCell).split(/\n/);
  for (var i = 0; i < lines.length; i++) {
    var inv = lines[i].trim();
    if (!inv) continue;
    if (voidSet[inv]) return true;
    var digits = inv.replace(/[^0-9]/g, "");
    if (digits && voidSet[digits]) return true;
  }
  return false;
}

/**
 * 폐기송장 적용: 허브에서 폐기 송장번호를 가진 행의 송장번호를 삭제하고 상태를 복원
 * 수동 실행 또는 자동 트리거에서 호출
 */
function partnerApplyVoidedInvoices(silent) {
  var ui = null;
  if (!silent) {
    try {
      ui = SpreadsheetApp.getUi();
    } catch (e) {}
  }

  var voidSet = _po_loadVoidInvoiceSet_();
  var voidCount = Object.keys(voidSet).length;
  if (voidCount === 0) {
    if (ui)
      ui.alert(
        "폐기송장 탭이 없거나 비어있습니다.\n폐기송장 탭에 송장번호를 입력한 후 실행하세요.",
      );
    return;
  }

  var hubTab = _po_getHubTab();
  var hubLr = hubTab.getLastRow();
  if (hubLr < 2) {
    if (ui) ui.alert("허브에 데이터가 없습니다.");
    return;
  }

  var hubData = hubTab
    .getRange(2, 1, hubLr - 1, _PO_HUB_HEADERS.length)
    .getValues();
  var cleared = 0;
  var clearDetails = [];
  var voidedUids = []; // 폐기 처리된 행의 고유ID 목록
  var clearedRows = []; // 폐기 처리된 행 인덱스

  for (var r = 0; r < hubData.length; r++) {
    var invCell = String(hubData[r][13] || "").trim(); // N열: 송장번호
    if (!invCell) continue;

    // 줄바꿈으로 구분된 다중 송장 중 폐기 대상만 제거
    var lines = invCell.split(/\n/);
    var kept = [];
    var removedAny = false;
    for (var li = 0; li < lines.length; li++) {
      var inv = lines[li].trim();
      if (!inv) continue;
      var isVoided = voidSet[inv] || voidSet[inv.replace(/[^0-9]/g, "")];
      if (isVoided) {
        removedAny = true;
      } else {
        kept.push(inv);
      }
    }

    if (!removedAny) continue;

    var newInv = kept.join("\n");
    hubData[r][13] = newInv; // 송장번호 갱신 (빈 문자열 가능)

    // ★ 적요(M열=12)에 폐기 이력 표시
    var existMemo = String(hubData[r][12] || "").trim();
    var voidMark = "🗑️폐기(" + invCell.replace(/\n/g, ",") + ")";
    hubData[r][12] = existMemo ? existMemo + "\n" + voidMark : voidMark;

    // 송장번호가 완전히 비었으면 상태를 "폐기처리"로 표시
    if (!newInv) {
      var curStatus = String(hubData[r][14] || "").trim();
      if (curStatus === "발송완료" || curStatus.indexOf("합배송") !== -1) {
        hubData[r][14] = "폐기처리";
      }
    }

    cleared++;
    clearedRows.push(r);
    voidedUids.push(String(hubData[r][2] || "").trim());
    if (clearDetails.length < 10) {
      clearDetails.push(
        "R" +
          (r + 2) +
          " [" +
          String(hubData[r][7] || "").trim() +
          "] " +
          invCell +
          " → " +
          (newInv || "(삭제)"),
      );
    }
  }
  // ★ 2026-06-26: 배치 최적화 (개별 setValue → M/N/O 열 배치 setValues)
  //   기존: 행마다 3회 API → 30행=90회 ~15초
  //   개선: setValues 1회 + RangeList 1회 ~3초
  if (cleared > 0) {
    // ① M/N/O 열 배열 구축 (전체 행)
    var mnoVals = [];
    for (var mi = 0; mi < hubData.length; mi++) {
      mnoVals.push([hubData[mi][12], hubData[mi][13], hubData[mi][14]]);
    }
    // ② M/N/O 열 배치 쓰기 (API 1회)
    hubTab.getRange(2, 13, hubData.length, 3).setValues(mnoVals);
    // ③ 변경된 행만 빨간색 글꼴 적용 (M열, O열)
    try {
      var redA1 = [];
      for (var ci = 0; ci < clearedRows.length; ci++) {
        var rn = clearedRows[ci] + 2;
        redA1.push("M" + rn);
        redA1.push("O" + rn);
      }
      if (redA1.length > 0) {
        hubTab.getRangeList(redA1).setFontColor("#cc0000");
      }
    } catch (eRed) {}
  }
  SpreadsheetApp.flush();

  // ★ 협력업체 '발주 및 송장조회' 탭에서도 폐기 송장 삭제 + 상태 복원
  var partnerCleared = 0;
  if (cleared > 0) {
    try {
      var files = _pt_listFiles();
      for (var fi = 0; fi < files.length; fi++) {
        try {
          var ss = SpreadsheetApp.openById(files[fi].id);
          var ot = ss.getSheetByName("발주 및 송장조회");
          if (!ot || ot.getLastRow() <= 1) continue;
          var otLr = ot.getLastRow();
          var otLc = Math.max(ot.getLastColumn(), 14);
          var otData = ot.getRange(1, 1, otLr, otLc).getValues();
          var otCmap = _po_buildColMap(otData[0]);
          // ★ =FALSE 유효성 검사 정리 (setValue 충돌 방지)
          try { _pt_cleanupStrayValidations_(ot); } catch (eCV) {}
          var otInvCol = _po_findInvoiceCol(otData[0]);
          if (otInvCol === -1) continue;
          // ★ 2026-07-17 (M1): 행별 setValue 3회 → 열 단위 setValues + RangeList 색상
          var otChanged = false;
          var otRedA1 = [];
          for (var or2 = 1; or2 < otData.length; or2++) {
            var otInv = String(otData[or2][otInvCol] || "").trim();
            if (!otInv) continue;
            if (_po_isVoidedInvoice_(otInv, voidSet)) {
              otData[or2][otInvCol] = "";
              if (otCmap.status !== -1) {
                var otSt = String(otData[or2][otCmap.status] || "").trim();
                if (otSt === "발송완료" || otSt.indexOf("합배송") !== -1) {
                  otData[or2][otCmap.status] = "폐기처리";
                  otRedA1.push(ot.getRange(or2 + 1, otCmap.status + 1).getA1Notation());
                }
              }
              if (otCmap.note !== -1) {
                var otNote = String(otData[or2][otCmap.note] || "").trim();
                var otMark = "🗑️폐기(" + otInv + ")";
                otData[or2][otCmap.note] = otNote ? otNote + "\n" + otMark : otMark;
                otRedA1.push(ot.getRange(or2 + 1, otCmap.note + 1).getA1Notation());
              }
              otChanged = true;
              partnerCleared++;
            }
          }
          if (otChanged) {
            var otBatchRows = otData.length - 1;
            var otColsToWrite = [otInvCol];
            if (otCmap.status !== -1) otColsToWrite.push(otCmap.status);
            if (otCmap.note !== -1) otColsToWrite.push(otCmap.note);
            for (var oc = 0; oc < otColsToWrite.length; oc++) {
              var ocIdx = otColsToWrite[oc];
              var ocVals = [];
              for (var ov = 1; ov < otData.length; ov++) ocVals.push([otData[ov][ocIdx]]);
              ot.getRange(2, ocIdx + 1, otBatchRows, 1).setValues(ocVals);
            }
            if (otRedA1.length > 0) {
              try { ot.getRangeList(otRedA1).setFontColor("#cc0000"); } catch (eRed2) {}
            }
          }
        } catch (ePf) {}
      }
    } catch (ePAll) {}
  }

  var msg =
    "🗑️ 폐기송장 적용 완료\n" +
    "- 폐기 목록: " +
    voidCount +
    "개 키\n" +
    "- 허브에서 제거: " +
    cleared +
    "건\n" +
    "- 협력업체 발주탭 제거: " +
    partnerCleared +
    "건\n" +
    (clearDetails.length > 0
      ? "\n[상세(최대10건)]\n" + clearDetails.join("\n")
      : "") +
    (cleared === 0 ? "\n(허브에 해당 송장번호가 없습니다)" : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);

  // ★ 2026-07-02: DB 동기화 — 폐기송장 → void_invoices
  try {
    if (cleared > 0 && clearDetails.length > 0) {
      var dbVoidRows = clearDetails.map(function(detail) {
        var invMatch = detail.match(/\(([^)]+)\)/);
        return {
          invoice_no: invMatch ? invMatch[1] : detail,
          void_type: "폐기",
          status: "처리완료"
        };
      });
      _sb_syncVoidInvoices_(dbVoidRows);
    }
  } catch (eDb) { Logger.log("[SB] 폐기송장 DB 동기화 오류: " + eDb.message); }
}

/** 트리거용 무음 래퍼 */
function partnerApplyVoidedInvoicesSilent_() {
  try {
    partnerApplyVoidedInvoices(true);
  } catch (e) {
    try {
      Logger.log("[VOID_INVOICE_ERR] " + String(e.message || e));
    } catch (_) {}
  }
}

/** 폐기송장 탭 열기 (메뉴에서 실행 시 탭 생성 + 활성화) */
function partnerOpenVoidInvoiceTab() {
  var tab = _po_getVoidInvoiceTab();
  // 기존 3열 탭이면 7열로 헤더 보정
  _po_repairVoidTabHeaders_(tab);
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(tab);
  SpreadsheetApp.getUi().alert(
    "📋 폐기송장 탭\n\n" +
      "A열에 폐기할 송장번호를 입력하세요.\n" +
      "입력 즉시 판매처/품목명/수량/수취인이 자동으로 채워집니다.\n" +
      "F열(사유)은 선택 입력입니다.\n\n" +
      "입력 후:\n" +
      "• 자동 트리거 실행 시 허브에서 자동 제거됩니다.\n" +
      "• 수동으로 즉시 적용하려면 '폐기송장 적용' 메뉴를 실행하세요.",
  );
}

/**
 * 기존 폐기송장 탭(3열)을 새 구조(7열)로 보정
 * 이미 7열이면 아무 작업도 하지 않음
 */
function _po_repairVoidTabHeaders_(tab) {
  if (!tab) return;
  var curHeaders = tab
    .getRange(1, 1, 1, Math.max(tab.getLastColumn(), 1))
    .getValues()[0];
  if (curHeaders.length >= _PO_VOID_HEADERS.length) return; // 이미 확장됨

  // 기존 데이터(A=송장번호, B=사유, C=등록일시) → 새 구조로 재배치
  var lr = tab.getLastRow();
  if (lr >= 2) {
    var oldData = tab.getRange(2, 1, lr - 1, 3).getValues();
    // 기존 데이터를 새 레이아웃으로 변환: [송장번호, 판매처(빈), 품목명(빈), 수량(빈), 수취인(빈), 사유, 등록일시]
    var newData = [];
    for (var i = 0; i < oldData.length; i++) {
      newData.push([
        oldData[i][0],
        "",
        "",
        "",
        "",
        oldData[i][1],
        oldData[i][2],
      ]);
    }
    tab.getRange(2, 1, lr - 1, _PO_VOID_HEADERS.length).setValues(newData);
  }

  // 헤더 갱신
  tab.getRange(1, 1, 1, _PO_VOID_HEADERS.length).setValues([_PO_VOID_HEADERS]);
  tab
    .getRange("1:1")
    .setBackground("#c0392b")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setColumnWidth(2, 120); // 판매처
  tab.setColumnWidth(3, 200); // 품목명
  tab.setColumnWidth(4, 60); // 수량
  tab.setColumnWidth(5, 100); // 수취인
  tab.setColumnWidth(6, 250); // 사유
  tab.setColumnWidth(7, 160); // 등록일시
  SpreadsheetApp.flush();
}

// ═══════════════════════════════════════════
//  사방넷 송장 대량등록 (상품정보 시트 탭)
//  A=주문번호(고유ID) B=송장번호 C·D=공란 E=택배사코드
//  송장 수집 시 대리공급 업체별 코드 자동 기입
// ═══════════════════════════════════════════

var _PO_SABANG_BULK_TAB_NAME = "사방넷_송장대량등록";
var _PO_SABANG_BULK_HEADERS = ["주문번호", "송장번호", "", "", "택배사코드"];

/**
 * 업체 → 사방넷 대량등록 택배사코드.
 * ★ 2026-08-26: 업체별 코드표를 없애고 업체→택배사 SSOT
 * (_PEP_VENDOR_CARRIER_) + 택배사→코드(_PEP_CARRIER_SABANG_CODE_)로 산출한다.
 * 택배사를 모르거나 그 택배사의 사방넷 코드가 미지정이면 빈 문자열 →
 * 호출부(_po_addSabangBulkRow_)가 해당 행을 제외하고 "택배사코드 미지정"으로 보고한다.
 */
function _po_courierCodeForVendor_(vendorName) {
  if (typeof _pep_carrierForVendor_ !== "function") return "";
  var carrier = _pep_carrierForVendor_(vendorName);
  if (!carrier) return "";
  if (typeof _pep_sabangCodeForCarrier_ !== "function") return "";
  return _pep_sabangCodeForCarrier_(carrier);
}

function _po_getProductInfoSs_() {
  if (typeof _PT !== "undefined" && _PT.INFO_SS_ID) {
    try {
      return SpreadsheetApp.openById(_PT.INFO_SS_ID);
    } catch (eOpen) {}
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function _po_ensureSabangnetBulkTab_(ss) {
  if (!ss) ss = _po_getProductInfoSs_();
  var tab = ss.getSheetByName(_PO_SABANG_BULK_TAB_NAME);
  if (!tab) {
    tab = ss.insertSheet(_PO_SABANG_BULK_TAB_NAME);
  }
  var maxCols = tab.getMaxColumns();
  if (maxCols < 5) tab.insertColumnsAfter(maxCols, 5 - maxCols);
  tab.getRange(1, 1, 1, 5).setValues([_PO_SABANG_BULK_HEADERS]);
  tab.getRange(1, 1, 1, 2)
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.getRange(1, 3, 1, 2).setBackground("#f5f5f5").setFontColor("#9e9e9e");
  tab.getRange(1, 5)
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 180);
  tab.setColumnWidth(2, 150);
  tab.setColumnWidth(3, 40);
  tab.setColumnWidth(4, 40);
  tab.setColumnWidth(5, 100);
  tab.getRange("A:B").setNumberFormat("@");
  tab.getRange("E:E").setNumberFormat("@");
  try {
    tab.getRange("G1:I1").merge();
  } catch (eMg) {}
  tab.getRange("G1")
    .setValue("📥 엑셀 저장")
    .setBackground("#0d7377")
    .setFontColor("white")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNote("메뉴 「📥 사방넷 송장대량등록 엑셀 저장」과 같습니다.");
  tab.setColumnWidth(7, 80);
  tab.setColumnWidth(8, 80);
  tab.setColumnWidth(9, 80);
  return tab;
}

function _po_addSabangBulkRow_(rows, seen, orderNo, invCell, vendorHint, result) {
  var code = _po_courierCodeForVendor_(vendorHint);
  if (!code) {
    result.skipNoCode++;
    return 0;
  }
  return _po_addSabangBulkRowCoded_(rows, seen, orderNo, invCell, code, result);
}

function _po_addSabangBulkRowCoded_(rows, seen, orderNo, invCell, code, result) {
  orderNo = String(orderNo || "").trim();
  code = String(code || "").trim();
  if (!orderNo || !code) return 0;
  var invs = String(invCell || "").split(/[\r\n,;]+/);
  var added = 0;
  for (var k = 0; k < invs.length; k++) {
    var inv = String(invs[k] || "").trim();
    if (!inv || !_po_hasRealInvoice_(inv)) continue;
    if (/운송장|송장번호/.test(inv.replace(/\s/g, ""))) continue;
    var key = orderNo + "|" + inv;
    if (seen[key]) continue;
    seen[key] = true;
    rows.push([orderNo, inv, "", "", code]);
    result.byCode[code] = (result.byCode[code] || 0) + 1;
    added++;
  }
  return added;
}

/**
 * 대리공급_임시기록(P=사방넷주문번호, X=송장, W=업체) → 상품정보「사방넷_송장대량등록」
 * 허브 C열 생성UID(MMdd-xx-)는 사방넷 주문번호가 아니라 쓰지 않음
 */
function _po_rebuildSabangnetBulkUpload_(hubData, scannedLogs) {
  scannedLogs = scannedLogs || [];
    var result = { written: 0, skipGen: 0, skipNoCode: 0, skipNoInv: 0, tempWithInv: 0, lotteOwn: 0, matchTab: 0, byCode: {} };
    var LOTTE_CODE = "002";
  try {
    var ss = _po_getProductInfoSs_();
    var tab = _po_ensureSabangnetBulkTab_(ss);
    var rows = [];
    var seen = {};
    var uidCol = typeof _PO_TEMP_UID_COL_ !== "undefined" ? _PO_TEMP_UID_COL_ : 15;
    var invCol = typeof _PO_TEMP_INV_COL_ !== "undefined" ? _PO_TEMP_INV_COL_ : 23;

    var tempTab = typeof _po_getNonPartnerTempTab_ === "function" ? _po_getNonPartnerTempTab_(ss) : null;
    if (tempTab && tempTab.getLastRow() >= 2) {
      var tLc = Math.max(tempTab.getLastColumn(), invCol + 1);
      var tData = tempTab.getRange(2, 1, tempTab.getLastRow() - 1, tLc).getValues();
      for (var ti = 0; ti < tData.length; ti++) {
        var tUid = String(tData[ti][uidCol] || "").trim();
        var tInv = String(tData[ti][invCol] || "").trim();
        var tPfx = String(tData[ti][22] || "").trim();
        if (!tPfx) tPfx = String(tData[ti][3] || "").replace(/\s/g, "").substring(0, 2);
        if (!tUid || !_po_hasRealInvoice_(tInv)) continue;
        result.tempWithInv++;
        if (typeof _po_isGeneratedUid_ === "function" && _po_isGeneratedUid_(tUid)) {
          result.skipGen++;
          continue;
        }
        _po_addSabangBulkRow_(rows, seen, tUid, tInv, tPfx, result);
      }
    }

    if (hubData && hubData.length) {
      for (var i = 0; i < hubData.length; i++) {
        var uid = String(hubData[i][2] || "").trim();
        var vendor = String(hubData[i][1] || "").trim();
        var invCell = String(hubData[i][13] || "").trim();
        if (!uid || !_po_hasRealInvoice_(invCell)) continue;
        if (typeof _po_isGeneratedUid_ === "function" && _po_isGeneratedUid_(uid)) continue;
        _po_addSabangBulkRow_(rows, seen, uid, invCell, vendor, result);
      }
    }

    // ── 롯데 자사출고: 송장취합 롯데탭 J=사방넷주문번호 G=운송장 (대리공급과 중복은 seen으로 제외)
    try {
      var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
      var lotteTab = typeof _pt_getSheetByGid === "function"
        ? _pt_getSheetByGid(invSS, _PT_SECONDARY_INVOICE_GID)
        : null;
      if (lotteTab && lotteTab.getLastRow() >= 2) {
        var _uidIdx = (typeof _PT_LOTTE_FIXED_COL !== "undefined" && _PT_LOTTE_FIXED_COL.uid >= 0)
          ? _PT_LOTTE_FIXED_COL.uid : 9;
        var _invIdx = (typeof _PT_LOTTE_FIXED_COL !== "undefined" && _PT_LOTTE_FIXED_COL.invoice >= 0)
          ? _PT_LOTTE_FIXED_COL.invoice : 6;
        var ltLc = Math.max(lotteTab.getLastColumn(), Math.max(_uidIdx, _invIdx) + 1);
        var ltData = lotteTab.getRange(2, 1, lotteTab.getLastRow() - 1, ltLc).getDisplayValues();
        for (var lti = 0; lti < ltData.length; lti++) {
          var ltUid = String(ltData[lti][_uidIdx] || "").trim();
          var ltInv = String(ltData[lti][_invIdx] || "").trim();
          if (!ltUid || !_po_hasRealInvoice_(ltInv)) continue;
          if (typeof _po_isGeneratedUid_ === "function" && _po_isGeneratedUid_(ltUid)) continue;
          if (/주문번호/.test(ltUid.replace(/\s/g, ""))) continue;
          var nAdd = _po_addSabangBulkRowCoded_(rows, seen, ltUid, ltInv, LOTTE_CODE, result);
          if (nAdd) result.lotteOwn += nAdd;
        }
      }
    } catch (eLt) {
      scannedLogs.push("[사방넷대량등록] 롯데 자사출고 오류: " + String(eLt.message || eLt));
    }

    // ── 사방넷_송장매칭(세트분리) 보강: 합배송 샘플 등 롯데탭에 없는 사방넷 UID
    try {
      var matchSS = SpreadsheetApp.openById(
        (typeof _PEP_SOURCE_SHEET_ID !== "undefined" && _PEP_SOURCE_SHEET_ID) || _PT_COMBINED_INVOICE_SHEET_ID,
      );
      var matchTab = typeof _po_getSabangnetMatchTab_ === "function" ? _po_getSabangnetMatchTab_(matchSS) : null;
      if (matchTab && matchTab.getLastRow() >= 2) {
        var mUid = 9;
        var mInv = 6;
        try {
          var layout = _po_getSabangnetMatchLayout_(null);
          if (layout && layout.col) {
            if (layout.col.uid >= 0) mUid = layout.col.uid;
            if (layout.col.inv >= 0) mInv = layout.col.inv;
          }
        } catch (eLay) {}
        var mLc = Math.max(matchTab.getLastColumn(), Math.max(mUid, mInv) + 1);
        var mData = matchTab.getRange(2, 1, matchTab.getLastRow() - 1, mLc).getDisplayValues();
        for (var mi = 0; mi < mData.length; mi++) {
          var mu = String(mData[mi][mUid] || "").trim();
          var mv = String(mData[mi][mInv] || "").trim();
          if (!mu || !_po_hasRealInvoice_(mv)) continue;
          if (typeof _po_isGeneratedUid_ === "function" && _po_isGeneratedUid_(mu)) continue;
          var nM = _po_addSabangBulkRowCoded_(rows, seen, mu, mv, LOTTE_CODE, result);
          if (nM) result.matchTab += nM;
        }
      }
    } catch (eMt) {
      scannedLogs.push("[사방넷대량등록] 사방넷_송장매칭 보강 오류: " + String(eMt.message || eMt));
    }

    if (tab.getLastRow() >= 2) {
      tab.getRange(2, 1, tab.getLastRow() - 1, 5).clearContent();
    }
    if (rows.length) {
      tab.getRange(2, 1, rows.length, 5).setNumberFormat("@");
      tab.getRange(2, 1, rows.length, 5).setValues(rows);
      tab.getRange(2, 5, rows.length, 1).setHorizontalAlignment("center");
    }
    result.written = rows.length;
    if (rows.length) {
      try {
        var saved = _po_saveSabangnetBulkExcel_(tab, { silent: true });
        if (saved && !saved.error) {
          result.excelName = saved.name;
          result.excelUrl = saved.url;
          result.downloadUrl = saved.downloadUrl;
          result.rows = saved.rows;
          scannedLogs.push("[사방넷대량등록] 엑셀 저장 " + saved.name);
        } else if (saved && saved.error) {
          scannedLogs.push("[사방넷대량등록 엑셀] " + saved.error);
        }
      } catch (eXls) {
        scannedLogs.push("[사방넷대량등록 엑셀 오류] " + String(eXls.message || eXls));
      }
    }
    scannedLogs.push(
      "[사방넷대량등록] " +
        rows.length +
        "행 상품정보/" +
        _PO_SABANG_BULK_TAB_NAME +
        " 임시기록=" +
        result.tempWithInv +
        " 자사롯데=" +
        (result.lotteOwn || 0) +
        " 송장매칭보강=" +
        (result.matchTab || 0) +
        (result.skipGen ? " 생성UID제외=" + result.skipGen : "") +
        (result.skipNoCode ? " 코드미지정=" + result.skipNoCode : ""),
    );
  } catch (eBulk) {
    scannedLogs.push("[사방넷대량등록 오류] " + String(eBulk.message || eBulk));
    result.error = String(eBulk.message || eBulk);
  }
  return result;
}

/** 메뉴: 사방넷 송장대량등록 탭을 허브 송장 기준으로 다시 채움 */
function partnerRebuildSabangnetBulkUpload() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (eUi) {}
  var hubTab = _po_getHubTab();
  var hubLr = hubTab ? hubTab.getLastRow() : 0;
  var hubData = [];
  if (hubLr >= 2) {
    hubData = hubTab.getRange(2, 1, hubLr - 1, Math.max(hubTab.getLastColumn(), 15)).getValues();
  }
  var logs = [];
  var result = _po_rebuildSabangnetBulkUpload_(hubData, logs);
  var codeLines = [];
  if (result.byCode) {
    var names = { "001": "대한통운", "002": "롯데", "007": "로젠", "037": "대신택배" };
    for (var c in result.byCode) {
      if (!result.byCode.hasOwnProperty(c)) continue;
      codeLines.push("  " + c + "(" + (names[c] || "") + "): " + result.byCode[c] + "건");
    }
  }
  var msg =
    "탭: 상품정보 / " +
    _PO_SABANG_BULK_TAB_NAME +
    "\n기록: " +
    result.written +
    "행 (A=사방넷주문번호 B=송장 C·D공란 E=택배사코드)\n" +
    "소스: 대리공급_임시기록 " +
    (result.tempWithInv || 0) +
    "건 + 롯데자사 " +
    (result.lotteOwn || 0) +
    "건" +
    ((result.matchTab || 0) ? " + 송장매칭 " + result.matchTab + "건" : "") +
    "\n" +
    (codeLines.length ? codeLines.join("\n") + "\n" : "") +
    (result.skipGen ? "생성UID(사방넷번호 아님) 제외: " + result.skipGen + "건\n" : "") +
    (result.skipNoCode ? "택배사코드 미지정: " + result.skipNoCode + "건\n" : "") +
    (result.written === 0
      ? "\n임시기록 X열(송장번호)이 비어 있으면 5️⃣ 송장 수집을 먼저 실행하세요."
      : "") +
    (result.excelName ? "\n엑셀: " + result.excelName : "") +
    (result.error ? "\n오류: " + result.error : "");
  if (ui) ui.alert("사방넷 송장대량등록", msg, ui.ButtonSet.OK);
  if (ui && result.written > 0 && result.excelUrl) {
    _po_showSabangBulkExcelDialog_(result);
  }
  Logger.log("[SABANG_BULK] " + msg + "\n" + logs.join("\n"));
}

function _po_getSabangBulkExcelFolder_(ss) {
  var parent = null;
  try {
    var file = DriveApp.getFileById(ss.getId());
    var parents = file.getParents();
    if (parents.hasNext()) parent = parents.next();
  } catch (eP) {}
  if (!parent) parent = DriveApp.getRootFolder();
  var folderName = "사방넷_송장대량등록";
  var it = parent.getFoldersByName(folderName);
  if (it.hasNext()) return it.next();
  return parent.createFolder(folderName);
}

/**
 * 사방넷_송장대량등록 A~E만 xlsx로 구글드라이브에 저장
 */
function _po_saveSabangnetBulkExcel_(tab, opts) {
  opts = opts || {};
  if (!tab || tab.getLastRow() < 2) return { error: "저장할 자료가 없습니다." };
  var n = tab.getLastRow();
  var vals = tab.getRange(1, 1, n, 5).getDisplayValues();
  var hasData = false;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim() || String(vals[i][1] || "").trim()) {
      hasData = true;
      break;
    }
  }
  if (!hasData) return { error: "저장할 자료가 없습니다." };

  var ymd = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
  var fileName = "사방넷_송장대량등록_" + ymd + ".xlsx";
  var tmp = SpreadsheetApp.create("tmp_sabang_bulk_" + ymd);
  var tmpId = tmp.getId();
  var dest = tmp.getSheets()[0];
  dest.setName("사방넷_송장대량등록");
  dest.getRange(1, 1, n, 5).setNumberFormat("@");
  dest.getRange(1, 1, n, 5).setValues(vals);
  dest.getRange(1, 1, 1, 5)
    .setFontWeight("bold")
    .setBackground("#1f4e78")
    .setFontColor("white");
  SpreadsheetApp.flush();

  var blob = null;
  try {
    var exportUrl = "https://docs.google.com/spreadsheets/d/" + tmpId + "/export?format=xlsx";
    var resp = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
      followRedirects: true,
    });
    if (resp.getResponseCode() === 200 && resp.getBlob() && resp.getBlob().getBytes().length > 64) {
      blob = resp.getBlob().setName(fileName).setContentType(MimeType.MICROSOFT_EXCEL);
    }
  } catch (eFetch) {}

  var ss = tab.getParent();
  var folder = _po_getSabangBulkExcelFolder_(ss);
  var outFile = null;
  if (blob) {
    outFile = folder.createFile(blob);
  } else {
    var tmpFile = DriveApp.getFileById(tmpId);
    folder.addFile(tmpFile);
    try {
      DriveApp.getRootFolder().removeFile(tmpFile);
    } catch (eRm) {}
    tmpFile.setName(fileName.replace(/\.xlsx$/i, ""));
    outFile = tmpFile;
    tmpId = null;
  }
  if (tmpId) {
    try {
      DriveApp.getFileById(tmpId).setTrashed(true);
    } catch (eTrash) {}
  }

  var url = outFile.getUrl();
  var id = outFile.getId();
  try {
    tab.getRange("G1").setFormula('=HYPERLINK("' + url + '","📥 엑셀 열기")');
  } catch (eLink) {}

  return {
    name: outFile.getName(),
    url: url,
    downloadUrl: "https://drive.google.com/uc?export=download&id=" + id,
    rows: n - 1,
    id: id,
  };
}

function _po_showSabangBulkExcelDialog_(info) {
  var ui = SpreadsheetApp.getUi();
  var name = String((info && (info.excelName || info.name)) || "사방넷_송장대량등록.xlsx");
  var url = String((info && (info.excelUrl || info.url)) || "");
  var dl = String((info && info.downloadUrl) || url);
  var rows = (info && info.rows) || (info && info.written) || "";
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:\'Noto Sans KR\',sans-serif;padding:8px 10px;color:#222">' +
      '<p style="margin:0 0 10px">사방넷 대량등록용 엑셀을 저장했습니다.' +
      (rows ? " <b>" + rows + "행</b>" : "") +
      "</p>" +
      '<p style="margin:0 0 14px;word-break:break-all;font-size:12px;color:#555">' +
      name +
      "</p>" +
      '<a href="' +
      dl +
      '" target="_blank" style="display:block;text-align:center;padding:12px 10px;background:#0d7377;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">📥 엑셀 파일 다운로드</a>' +
      (url
        ? '<p style="margin:12px 0 0;text-align:center"><a href="' +
          url +
          '" target="_blank" style="color:#1f4e78">드라이브에서 열기</a></p>'
        : "") +
      "</div>",
  )
    .setWidth(380)
    .setHeight(220);
  ui.showModalDialog(html, "사방넷 송장대량등록 엑셀");
}

/** 메뉴/버튼: 사방넷_송장대량등록 탭 → xlsx 저장 */
function partnerExportSabangnetBulkExcel() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (eUi) {}
  var ss = _po_getProductInfoSs_();
  var tab = ss.getSheetByName(_PO_SABANG_BULK_TAB_NAME);
  if (!tab) tab = _po_ensureSabangnetBulkTab_(ss);
  if (tab.getLastRow() < 2) {
    if (ui) {
      ui.alert(
        "사방넷_송장대량등록",
        "탭에 자료가 없습니다.\n먼저 「📋 사방넷 송장대량등록 탭 갱신」을 실행하세요.",
        ui.ButtonSet.OK,
      );
    }
    return;
  }
  var saved = _po_saveSabangnetBulkExcel_(tab, {});
  if (saved.error) {
    if (ui) ui.alert("엑셀 저장 실패", saved.error, ui.ButtonSet.OK);
    return;
  }
  if (ui) _po_showSabangBulkExcelDialog_(saved);
}

// ═══════════════════════════════════════════
//  비협력업체 미매칭 송장 → 별도 탭에 수집
//  전용양식 탭에서 허브 미매칭 송장을 추출하여
//  거래관리시스템 시트에 통합 형식으로 기록
// ═══════════════════════════════════════════

var _PO_UNMATCHED_TAB_NAME = "사방넷_송장매칭";
// 세트분리 시트 사방넷_송장매칭 탭 GID (삭제/재생성 금지)
var _PO_UNMATCHED_TAB_GID = 595945427;
// 입력_로젠주문실적 원본 양식 헤더 (37열) — 로젠_임시기록 전용
var _PO_UNMATCHED_HEADERS = [
  "No.",
  "집배구분",
  "접수일자",
  "엑셀타입명",
  "주문번호",
  "운송장번호",
  "합포장번호",
  "집하지점",
  "배송지점",
  "명",
  "물품명", // K열: 물품명(품목명)
  "주소",
  "전화번호",
  "휴대폰",
  "수량",
  "선불",
  "착불",
  "신용",
  "본사신용",
  "산간료",
  "선착불",
  "물품코드",
  "우편번호", // W열: 우편번호
  "물품옵션",
  "추가옵션",
  "내품수량",
  "배송메세지",
  "송하인명",
  "주소",
  "송하인전화",
  "제주운임구분",
  "연륙도서지역",
  "산간지역",
  "할증운임",
  "차수",
  "묶음키",
  "재출력운송장번호",
];
// ★ 2026-08-18: 사방넷_송장매칭 = 롯데택배 송장탭(GID 1575029201) 열 배열
//   F=수취인명, G=운송장번호, J=주문번호, AC=상품명 (_PT_LOTTE_FIXED_COL)
var _UM_COL_NAME = 5; // F열: 수취인명
var _UM_COL_INV = 6; // G열: 운송장번호
var _UM_COL_UID = 9; // J열: 주문번호(사방넷/고유ID)
var _UM_COL_INAME = 28; // AC열: 상품명
var _UM_COL_ADDR = -1;
var _UM_COL_TEL = -1;
var _UM_COL_MOB = -1;
var _UM_COL_QTY = -1;
var _UM_COL_ICODE = -1;
var _UM_COL_ZIP = -1;
var _UM_COL_MSG = -1;
var _UM_COL_SEND_NAME = -1;
var _UM_COL_SEND_ADDR = -1;
var _UM_COL_SEND_TEL = -1;
var _UM_COL_DATE = -1;

var _PO_SABANG_LAYOUT_CACHE_ = null;

function _po_putUnmatched_(row, idx, val) {
  if (idx == null || idx < 0 || !row || idx >= row.length) return;
  if (val === "" || val == null) return;
  row[idx] = val;
}

function _po_lotteFallbackHeaders_() {
  var h = [];
  for (var i = 0; i < 37; i++) h.push("");
  h[_UM_COL_NAME] = "수하인명";
  h[_UM_COL_INV] = "운송장번호";
  h[_UM_COL_UID] = "주문번호";
  h[_UM_COL_INAME] = "상품명";
  return h;
}

function _po_scanUnmatchedExtraCols_(headers, col) {
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || "").replace(/\s/g, "");
    if (!h) continue;
    if (col.addr < 0 && /주소/.test(h) && !/송하인|보내는|발송/.test(h)) col.addr = c;
    if (col.tel < 0 && /(전화|연락처)/.test(h) && !/송하인|보내는|발송|휴대|모바일/.test(h)) col.tel = c;
    if (col.mob < 0 && /(휴대|모바일|휴대폰)/.test(h) && !/송하인|보내는|발송/.test(h)) col.mob = c;
    if (col.qty < 0 && /(수량|내품)/.test(h) && !/박스|운임/.test(h)) col.qty = c;
    if (col.icode < 0 && /(물품코드|품목코드|상품코드)/.test(h)) col.icode = c;
    if (col.zip < 0 && /우편번호/.test(h) && !/송하인|보내는|발송/.test(h)) col.zip = c;
    if (col.msg < 0 && /(배송메세지|배송메시지|특기사항)/.test(h)) col.msg = c;
    if (col.sendName < 0 && /(송하인명|보내는사람|발송인명|보내는분명)/.test(h) && !/주소|전화/.test(h)) col.sendName = c;
    if (col.sendAddr < 0 && /주소/.test(h) && /(송하인|보내는|발송)/.test(h)) col.sendAddr = c;
    if (col.sendTel < 0 && /(전화|연락)/.test(h) && /(송하인|보내는|발송)/.test(h)) col.sendTel = c;
    if (col.date < 0 && /(접수일자|집하일자|접수일|집하일)/.test(h) && !/배송/.test(h)) col.date = c;
  }
  if (col.iname >= 0 && col.iname < headers.length) {
    var ih = String(headers[col.iname] || "").replace(/\s/g, "");
    if (!/(상품|품목|물품|품명)/.test(ih)) {
      for (var ci = 0; ci < headers.length; ci++) {
        var nh = String(headers[ci] || "").replace(/\s/g, "");
        if (/상품명/.test(nh) && !/코드/.test(nh)) {
          col.iname = ci;
          break;
        }
      }
    }
  }
}

function _po_headerRowsEqual_(a, b) {
  var n = Math.max((a && a.length) || 0, (b && b.length) || 0);
  if (n < 1) return false;
  for (var i = 0; i < n; i++) {
    var av = String((a && a[i]) || "").replace(/\s/g, "");
    var bv = String((b && b[i]) || "").replace(/\s/g, "");
    if (av !== bv) return false;
  }
  return true;
}

function _po_readLotteHeaderRow_(lotteTab) {
  var minCols = 37;
  var lc = Math.max(lotteTab.getLastColumn(), minCols);
  var scan = Math.min(8, Math.max(lotteTab.getLastRow(), 1));
  var block = lotteTab.getRange(1, 1, scan, lc).getDisplayValues();
  var best = block[0];
  var bestScore = -1;
  for (var r = 0; r < block.length; r++) {
    var row = block[r];
    var g = String(row[6] || "").replace(/\s/g, "");
    var j = String(row[9] || "").replace(/\s/g, "");
    var f = String(row[5] || "").replace(/\s/g, "");
    var ac = String(row[28] || "").replace(/\s/g, "");
    var score = 0;
    if (/운송장|송장번호/.test(g)) score += 5;
    if (/주문번호/.test(j)) score += 3;
    if (/수하인|수취인|받는/.test(f)) score += 2;
    if (/상품명|품목명/.test(ac)) score += 2;
    if (/^\d{10,}$/.test(g)) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  var headers = (best || block[0] || []).slice();
  while (headers.length > minCols && String(headers[headers.length - 1] || "").trim() === "") {
    headers.pop();
  }
  return headers;
}

/**
 * 사방넷_송장매칭 열 배열: 송장취합 롯데탭(GID 1575029201) 헤더를 SSOT로 복사
 */
function _po_getSabangnetMatchLayout_(scannedLogs) {
  if (_PO_SABANG_LAYOUT_CACHE_) return _PO_SABANG_LAYOUT_CACHE_;
  var lotte = typeof _PT_LOTTE_FIXED_COL !== "undefined" ? _PT_LOTTE_FIXED_COL : null;
  var col = {
    name: lotte && lotte.name >= 0 ? lotte.name : _UM_COL_NAME,
    inv: lotte && lotte.invoice >= 0 ? lotte.invoice : _UM_COL_INV,
    uid: lotte && lotte.uid >= 0 ? lotte.uid : _UM_COL_UID,
    iname: lotte && lotte.item >= 0 ? lotte.item : _UM_COL_INAME,
    addr: -1,
    tel: -1,
    mob: -1,
    qty: -1,
    icode: -1,
    zip: -1,
    msg: -1,
    sendName: -1,
    sendAddr: -1,
    sendTel: -1,
    date: -1,
  };
  var headers = [];
  var source = "fallback";
  try {
    var invSS = SpreadsheetApp.openById(_PT_INVOICE_SHEET_ID);
    var lotteTab = _pt_getSheetByGid(invSS, _PT_SECONDARY_INVOICE_GID);
    if (lotteTab) {
      headers = _po_readLotteHeaderRow_(lotteTab);
      if (headers.length) {
        source = "롯데탭 GID " + _PT_SECONDARY_INVOICE_GID;
        _po_scanUnmatchedExtraCols_(headers, col);
      }
    }
  } catch (eLayout) {
    if (scannedLogs) scannedLogs.push("[사방넷매칭] 롯데 헤더 로드 오류: " + String(eLayout.message || eLayout));
  }
  if (!headers.length) headers = _po_lotteFallbackHeaders_();
  if (scannedLogs) {
    scannedLogs.push(
      "[사방넷매칭] 열배열=" + source +
        " (" + headers.length + "열, G=[" + String(headers[col.inv] || "") +
        "] J=[" + String(headers[col.uid] || "") + "])",
    );
  }
  _PO_SABANG_LAYOUT_CACHE_ = { headers: headers, col: col, source: source };
  return _PO_SABANG_LAYOUT_CACHE_;
}

function _po_isSabangnetHeaderMatch_(tab, layout) {
  if (!tab || !layout || !layout.headers || !layout.headers.length) return false;
  var n = layout.headers.length;
  _po_ensureSabangnetMatchCols_(tab, n);
  var actual = tab.getRange(1, 1, 1, n).getDisplayValues()[0];
  return _po_headerRowsEqual_(actual, layout.headers);
}

function _po_writeSabangnetHeaders_(tab, layout, scannedLogs, logPrefix) {
  var headers = layout.headers;
  _po_ensureSabangnetMatchCols_(tab, headers.length);
  var leftover = tab.getLastColumn();
  if (leftover > headers.length) {
    tab.getRange(1, headers.length + 1, 1, leftover - headers.length)
      .clearContent()
      .clearFormat();
  }
  tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  tab.getRange(1, 1, 1, headers.length)
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  if (scannedLogs) {
    scannedLogs.push(
      (logPrefix || "[사방넷매칭]") +
        " 헤더 적용 " + headers.length + "열 GID=" + tab.getSheetId() +
        " 이름=" + tab.getName() +
        " G=" + String(headers[layout.col.inv] || "") +
        " J=" + String(headers[layout.col.uid] || "") +
        " 소스=" + layout.source,
    );
  }
}

function _po_getSabangnetMatchTab_(ss) {
  if (!ss) ss = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var tab = typeof _pt_getSheetByGid === "function"
    ? _pt_getSheetByGid(ss, _PO_UNMATCHED_TAB_GID)
    : null;
  if (tab) return tab;
  return ss.getSheetByName(_PO_UNMATCHED_TAB_NAME);
}

function _po_ensureSabangnetMatchCols_(tab, n) {
  if (!tab || n < 1) return;
  var maxCols = tab.getMaxColumns();
  if (maxCols < n) tab.insertColumnsAfter(maxCols, n - maxCols);
}

function _po_ensureSabangnetMatchTab_(targetSS, layout, scannedLogs, logPrefix) {
  logPrefix = logPrefix || "[사방넷주문]";
  scannedLogs = scannedLogs || [];
  var tab = _po_getSabangnetMatchTab_(targetSS);
  if (!tab) {
    tab = targetSS.insertSheet(_PO_UNMATCHED_TAB_NAME);
    scannedLogs.push(logPrefix + " '" + _PO_UNMATCHED_TAB_NAME + "' 탭 신규 생성");
    _po_writeSabangnetHeaders_(tab, layout, scannedLogs, logPrefix);
    return tab;
  }
  if (!_po_isSabangnetHeaderMatch_(tab, layout)) {
    _po_writeSabangnetHeaders_(tab, layout, scannedLogs, logPrefix);
  }
  return tab;
}

/**
 * 세트분리 사방넷_송장매칭(GID 595945427) 1행을 롯데 송장탭 열 배열로 즉시 적용
 */
function partnerApplySabangnetLotteHeaders() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (eUi) {}
  _PO_SABANG_LAYOUT_CACHE_ = null;
  var logs = [];
  try {
    var layout = _po_getSabangnetMatchLayout_(logs);
    var ss = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
    var tab = _po_getSabangnetMatchTab_(ss);
    if (!tab) {
      tab = ss.insertSheet(_PO_UNMATCHED_TAB_NAME);
      logs.push("탭이 없어 신규 생성");
    }
    _po_writeSabangnetHeaders_(tab, layout, logs, "[열배열적용]");
    SpreadsheetApp.flush();
    var msg =
      "탭: " + tab.getName() + " (GID " + tab.getSheetId() + ")\n" +
      "열 수: " + layout.headers.length + "\n" +
      "소스: " + layout.source + "\n" +
      "G열: " + String(layout.headers[layout.col.inv] || "") + "\n" +
      "J열: " + String(layout.headers[layout.col.uid] || "") + "\n\n" +
      logs.join("\n");
    if (ui) ui.alert("사방넷_송장매칭 열 배열 적용", msg, ui.ButtonSet.OK);
    Logger.log("[SABANG_HEADERS] " + msg);
  } catch (e) {
    if (ui) ui.alert("열 배열 적용 실패", String(e.message || e), ui.ButtonSet.OK);
    throw e;
  }
}

function _po_collectExistingInvSet_(tab, invCol) {
  var existingInvSet = {};
  if (!tab || tab.getLastRow() < 2 || invCol < 0) return existingInvSet;
  var existData = tab.getRange(2, invCol + 1, tab.getLastRow() - 1, 1).getValues();
  for (var ei = 0; ei < existData.length; ei++) {
    var eInv = String(existData[ei][0] || "").trim();
    if (eInv) {
      existingInvSet[eInv] = true;
      existingInvSet[eInv.replace(/[^0-9]/g, "")] = true;
    }
  }
  return existingInvSet;
}

function _po_collectExistingUidSet_(tab, uidCol) {
  var set = {};
  if (!tab || tab.getLastRow() < 2 || uidCol < 0) return set;
  var data = tab.getRange(2, uidCol + 1, tab.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    var u = String(data[i][0] || "").trim();
    if (u) set[u] = true;
  }
  return set;
}

/** 결정론적 UID (MMDD-ph-XXXX / MMDD-ds-xxxx). 사방넷 원본 주문번호는 false */
function _po_isGeneratedUid_(uid) {
  return /^\d{4}-[A-Za-z]{2}-/.test(String(uid || "").trim());
}

function _po_isSabangnetUid_(uid) {
  var u = String(uid || "").trim();
  if (!u) return false;
  if (_po_isGeneratedUid_(u)) return false;
  return true;
}

function _po_isSampleItemName_(name) {
  return String(name || "").replace(/^\s+/, "").indexOf("[샘플]") === 0;
}

function _po_pickInvForUid_(uid, invoiceMap, hubInvoiceByKey, uidToHubInv) {
  if (!uid) return "";
  if (uidToHubInv && uidToHubInv[uid] && _po_hasRealInvoice_(uidToHubInv[uid])) {
    return String(uidToHubInv[uid]).trim();
  }
  if (hubInvoiceByKey && hubInvoiceByKey["UID:" + uid]) {
    return String(hubInvoiceByKey["UID:" + uid]).trim();
  }
  if (invoiceMap && invoiceMap[uid]) {
    var picked = _po_pickInvoiceFromMapCandidates_(invoiceMap[uid]);
    if (picked) return picked;
    var arr = invoiceMap[uid];
    for (var i = 0; i < arr.length; i++) {
      var c = String((arr[i] && (arr[i].invRaw || arr[i].inv)) || "").trim();
      if (c && _po_hasRealInvoice_(c)) return c;
    }
  }
  return "";
}

/**
 * 세트분리 합배송탭: 품목명이 [샘플]로 시작하고 고유ID가 사방넷 주문번호인 행을
 * 사방넷_송장매칭에 UID마다 1행씩 기록 (송장번호는 같아도 됨 — 사방넷 엑셀 업로드용)
 */
function _po_pushHapbaesongSamplesToSabangnet_(scannedLogs, invoiceMap, hubInvoiceByKey, hubData) {
  scannedLogs = scannedLogs || [];
  var written = 0, skipped = 0, noInv = 0, scanned = 0;
  try {
    var srcSS = SpreadsheetApp.openById(_PT_COMBINED_INVOICE_SHEET_ID || _PEP_SOURCE_SHEET_ID);
    var hapTab = _pt_getSheetByGid(srcSS, _PT_COMBINED_INVOICE_SHEET_GID);
    if (!hapTab) hapTab = srcSS.getSheetByName("합배송") || srcSS.getSheetByName("합배송 전용");
    if (!hapTab || hapTab.getLastRow() < 2) {
      scannedLogs.push("[합배송샘플→사방넷] 합배송 탭 없음/비어있음");
      return 0;
    }

    var lr = hapTab.getLastRow();
    var lc = Math.max(hapTab.getLastColumn(), 17);
    var data = hapTab.getRange(1, 1, lr, lc).getValues();
    var headers = data[0];
    var itemIdx = -1, uidIdx = -1, nameIdx = -1, phoneIdx = -1, addrIdx = -1;
    var qtyIdx = -1, codeIdx = -1, invIdx = -1;
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || "").replace(/\s/g, "");
      if (!h) continue;
      if (itemIdx < 0 && /품목명|상품명|물품명/.test(h) && !/코드/.test(h)) itemIdx = c;
      if (uidIdx < 0 && /사방넷주문번호|고유아이디|고유ID|주문번호/i.test(h)) uidIdx = c;
      if (nameIdx < 0 && /수취인|수령인|받는사람|받는분|고객명|이름|성명/.test(h) && !/주소|전화|코드/.test(h)) nameIdx = c;
      if (phoneIdx < 0 && /전화|모바일|연락처|휴대폰/.test(h) && !/보내는|송하인/.test(h)) phoneIdx = c;
      if (addrIdx < 0 && /주소/.test(h) && !/보내는|송하인/.test(h)) addrIdx = c;
      if (qtyIdx < 0 && /수량/.test(h) && !/박스/.test(h)) qtyIdx = c;
      if (codeIdx < 0 && /품목코드|상품코드/.test(h)) codeIdx = c;
      if (invIdx < 0 && /송장|운송장/.test(h) && !/반품/.test(h)) invIdx = c;
    }
    if (uidIdx < 0) uidIdx = 16; // Q열 폴백 (합배송 전용 기존 규칙)
    if (itemIdx < 0) itemIdx = 3; // D열 폴백
    if (nameIdx < 0) {
      for (var cf = 0; cf < headers.length; cf++) {
        if (/거래처명/.test(String(headers[cf] || "").replace(/\s/g, ""))) { nameIdx = cf; break; }
      }
    }

    var uidToHubInv = {};
    if (hubData && hubData.length) {
      for (var hi = 0; hi < hubData.length; hi++) {
        var hu = String(hubData[hi][2] || "").trim();
        var hinv = String(hubData[hi][13] || "").trim();
        if (hu && _po_hasRealInvoice_(hinv)) uidToHubInv[hu] = hinv;
      }
    }

    var groups = {};
    var sampleRows = [];
    for (var r = 1; r < data.length; r++) {
      var uid = String(data[r][uidIdx] || "").trim();
      if (!uid) continue;
      var itemName = itemIdx >= 0 ? String(data[r][itemIdx] || "").trim() : "";
      var recName = nameIdx >= 0 ? String(data[r][nameIdx] || "").trim() : "";
      var recPhone = phoneIdx >= 0 ? String(data[r][phoneIdx] || "").replace(/[^0-9]/g, "") : "";
      var grpKey = recName + "_" + (recPhone.length >= 4 ? recPhone.slice(-4) : recPhone);
      if (!groups[grpKey]) groups[grpKey] = [];
      var rowInv = invIdx >= 0 ? String(data[r][invIdx] || "").trim() : "";
      var resolved = rowInv && _po_hasRealInvoice_(rowInv)
        ? rowInv
        : _po_pickInvForUid_(uid, invoiceMap, hubInvoiceByKey, uidToHubInv);
      groups[grpKey].push({ uid: uid, inv: resolved });
      if (_po_isSampleItemName_(itemName) && _po_isSabangnetUid_(uid)) {
        scanned++;
        sampleRows.push({
          uid: uid,
          itemName: itemName,
          recName: recName,
          recPhone: recPhone,
          recAddr: addrIdx >= 0 ? String(data[r][addrIdx] || "").trim() : "",
          qty: qtyIdx >= 0 ? data[r][qtyIdx] : "",
          itemCode: codeIdx >= 0 ? String(data[r][codeIdx] || "").trim() : "",
          grpKey: grpKey,
          inv: resolved,
        });
      }
    }

    var groupInv = {};
    for (var gk in groups) {
      var gRows = groups[gk];
      for (var gi = 0; gi < gRows.length; gi++) {
        if (gRows[gi].inv && _po_hasRealInvoice_(gRows[gi].inv)) {
          groupInv[gk] = gRows[gi].inv;
          break;
        }
      }
    }

    var layout = _po_getSabangnetMatchLayout_(scannedLogs);
    var targetSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
    var targetTab = _po_ensureSabangnetMatchTab_(targetSS, layout, scannedLogs, "[합배송샘플→사방넷]");
    var existingUidSet = _po_collectExistingUidSet_(targetTab, layout.col.uid);
    var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var newRows = [];

    for (var si = 0; si < sampleRows.length; si++) {
      var s = sampleRows[si];
      if (existingUidSet[s.uid]) { skipped++; continue; }
      var inv = s.inv;
      if (!inv || !_po_hasRealInvoice_(inv)) inv = groupInv[s.grpKey] || "";
      if (!inv || !_po_hasRealInvoice_(inv)) { noInv++; continue; }

      newRows.push(_po_buildUnmatchedRow_(layout, {
        inv: inv,
        recName: s.recName,
        recAddr: s.recAddr,
        recTel: s.recPhone,
        recMob: s.recPhone,
        qty: s.qty,
        itemCode: s.itemCode,
        itemName: s.itemName,
        uid: s.uid,
        date: today,
      }));
      existingUidSet[s.uid] = true;
      written++;
    }

    if (newRows.length > 0) {
      var writeStart = targetTab.getLastRow() + 1;
      _po_applyUnmatchedNumberFormats_(targetTab, writeStart, newRows.length, layout);
      targetTab.getRange(writeStart, 1, newRows.length, layout.headers.length).setValues(newRows);
      SpreadsheetApp.flush();
    }
    scannedLogs.push(
      "★ [합배송샘플→사방넷] 대상=" + scanned +
        "건 / 기록=" + written +
        "건 / UID중복스킵=" + skipped +
        "건 / 송장없음=" + noInv + "건 (송장동일·UID별 행)",
    );
  } catch (eHap) {
    scannedLogs.push("[합배송샘플→사방넷 오류] " + String(eHap.message || eHap));
  }
  return written;
}

function _po_buildUnmatchedRow_(layout, f) {
  var row = [];
  for (var i = 0; i < layout.headers.length; i++) row.push("");
  var c = layout.col;
  _po_putUnmatched_(row, c.inv, f.inv);
  _po_putUnmatched_(row, c.name, f.recName);
  _po_putUnmatched_(row, c.uid, f.uid);
  _po_putUnmatched_(row, c.iname, f.itemName);
  _po_putUnmatched_(row, c.addr, f.recAddr);
  _po_putUnmatched_(row, c.tel, f.recTel || f.recMob);
  _po_putUnmatched_(row, c.mob, f.recMob || f.recTel);
  _po_putUnmatched_(row, c.qty, f.qty);
  _po_putUnmatched_(row, c.icode, f.itemCode);
  _po_putUnmatched_(row, c.zip, f.zip);
  _po_putUnmatched_(row, c.msg, f.msg);
  _po_putUnmatched_(row, c.sendName, f.sendName);
  _po_putUnmatched_(row, c.sendAddr, f.sendAddr);
  _po_putUnmatched_(row, c.sendTel, f.sendTel);
  _po_putUnmatched_(row, c.date, f.date);
  return row;
}

function _po_applyUnmatchedNumberFormats_(tab, startRow, nRows, layout) {
  if (!tab || nRows < 1) return;
  function fmt_(idx) {
    if (idx >= 0) tab.getRange(startRow, idx + 1, nRows, 1).setNumberFormat("@");
  }
  fmt_(layout.col.inv);
  fmt_(layout.col.uid);
  fmt_(layout.col.tel);
  fmt_(layout.col.mob);
  fmt_(layout.col.sendTel);
  fmt_(layout.col.zip);
}

/**
 * 전용양식 탭에서 허브에 매칭되지 않은 송장을 수집하여
 * 거래관리시스템 시트의 별도 탭에 통합 형식으로 기록
 *
 * 흐름: 대리발송 탭 → 전용양식 Push → 업체가 송장번호 입력
 *       → 송장 수집 시 허브에 미매칭된 건 = 비협력업체 건
 *
 * @param {Object} globalUsedInvoices - 허브 매칭에 사용된 송장번호 Set
 * @param {Array} scannedLogs - 로그 배열
 * @return {number} 수집된 건수
 */
var _PO_TEMP_UID_COL_ = 15; // P열: 사방넷주문번호
var _PO_TEMP_CARRIER_COL_ = 21; // V열: 택배사 (★ 2026-08-31 신설)
var _PO_TEMP_PFX_COL_ = 22; // W열: 업체prefix (택배사 판정 근거)
var _PO_TEMP_INV_COL_ = 23; // X열: 송장번호
var _PO_TEMP_STATUS_COL_ = 24; // Y열: 진행상태
var _PO_TEMP_ISSUE_COL_ = 25;  // Z열: 이슈 (★ 2026-07-08 전역 이동)
var _PO_TEMP_ARCHIVE_TAB_NAME_ = "대리공급_임시기록_보관";
var _PO_TEMP_ARCHIVE_DAYS_ = 14;
var _PO_TEMP_ARCHIVE_COL_OFFSET_ = 2; // A=보관일시, B=보관사유

/** 임시기록 SSOT — 상품정보 시트 (허브 active와 다를 수 있음) */
function _po_openTempSheetSs_() {
  try {
    if (typeof _PT !== "undefined" && _PT.INFO_SS_ID) {
      return SpreadsheetApp.openById(_PT.INFO_SS_ID);
    }
  } catch (e) {}
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** 대리공급_임시기록(신규) → 대리발송_임시기록(구명) 순으로 탭 조회 */
function _po_getNonPartnerTempTab_(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
  if (!tab) tab = ss.getSheetByName("대리발송_임시기록");
  return tab;
}

/** 허브 송장 매칭 결과 → UID/복합키 맵 (소스탭·임시기록 역기록용) */
// ★ 2026-06-19: 같은 UID에 여러 송장(세트 상품) → 줄바꿈 병합 (덮어쓰기 방지)
function _po_buildHubInvoiceKeyMap_(writeUpdates, hubData) {
  var hubInvoiceByKey = {};
  for (var ui2 = 0; ui2 < writeUpdates.length; ui2++) {
    var upd2 = writeUpdates[ui2];
    if (!upd2.writeInvoice || !upd2.inv) continue;
    var hubRow2 = upd2.row - 2;
    if (hubRow2 < 0 || hubRow2 >= hubData.length) continue;
    var hCode2 = String(hubData[hubRow2][4] || "").trim();
    var hName2 = String(hubData[hubRow2][7] || "").trim();
    var hPhone2 = String(hubData[hubRow2][8] || "").replace(/[^0-9]/g, "");
    var hUid2 = String(hubData[hubRow2][2] || "").trim();
    // ★ UID 키: 같은 UID에 여러 송장 → 줄바꿈 구분 병합 (세트 상품 대응)
    if (hUid2) {
      var uidKey = "UID:" + hUid2;
      if (hubInvoiceByKey[uidKey]) {
        var existingInvs = hubInvoiceByKey[uidKey].split("\n");
        var newInvs = upd2.inv.split("\n");
        for (var ni = 0; ni < newInvs.length; ni++) {
          var trimInv = newInvs[ni].trim();
          if (trimInv && existingInvs.indexOf(trimInv) === -1) {
            existingInvs.push(trimInv);
          }
        }
        hubInvoiceByKey[uidKey] = existingInvs.join("\n");
      } else {
        hubInvoiceByKey[uidKey] = upd2.inv;
      }
    }
    // ★ 복합키: 첫 매핑만 유지 (동명이인·동일코드 덮어쓰기 방지)
    if (hCode2 && hName2) {
      var compKey = hCode2 + "|" + hName2 + "|" + hPhone2;
      if (!hubInvoiceByKey[compKey]) {
        hubInvoiceByKey[compKey] = upd2.inv;
      }
    }
  }
  return hubInvoiceByKey;
}

function _po_pickInvoiceFromMapCandidates_(found) {
  if (!found || !found.length) return "";
  for (var fi = 0; fi < found.length; fi++) {
    var candidate = String(found[fi].invRaw || "").trim();
    if (candidate) return candidate;
  }
  return "";
}

/** 임시기록 행 → 송장번호 (허브매칭·UID·복합키·이름+전화 순) */
// ★ 2026-06-19: usedInvSet 추가 — 소비형 매칭 (동일인 다른 품목 송장 뒤바뀜 방지)
function _po_resolveTempTabInvoice_(row, invoiceMap, hubInvoiceByKey, usedInvSet, owner) {
  hubInvoiceByKey = hubInvoiceByKey || {};
  invoiceMap = invoiceMap || {};
  usedInvSet = usedInvSet || {};
  var tUid = String(row[_PO_TEMP_UID_COL_] || "").trim();
  if (!owner) owner = tUid;
  // 1. 고유ID 기반 매칭 (최우선)
  if (tUid && hubInvoiceByKey["UID:" + tUid]) {
    var hUid = hubInvoiceByKey["UID:" + tUid];
    if (_po_claimInvoiceMulti_(usedInvSet, hUid, owner)) return hUid;
  }
  if (tUid && invoiceMap[tUid]) {
    var inv = _po_pickUnusedInvoice_(invoiceMap[tUid], usedInvSet, owner);
    if (inv) return inv;
  }
  // ★ 2026-08-27: 고유ID 가 있으면 여기서 끝낸다.
  //   종전에는 고유ID 가 있어도 못 찾으면 아래 이름·전화 폴백으로 내려갔다.
  //   송장맵에는 날짜가 없으므로 그 폴백은 같은 고객의 과거 출고분을 후보로
  //   들고 있어 이전 주문 송장을 가져다 붙였다. 못 찾으면 미매칭으로 남긴다.
  if (tUid) return "";

  var tCode = String(row[3] || "").trim();
  var tName = String(row[12] || "").trim();
  var tPhone = String(row[8] || row[7] || "").replace(/[^0-9]/g, "");
  // ★ 2026-08-25: 복합키(품목코드|이름|전화)에는 고유ID가 없다. 같은 사람이 같은 품목을
  //   재주문하면 서로 다른 주문이 한 키를 공유하므로 소유권 확인 없이는 오배정이 된다.
  if (tCode && tName && hubInvoiceByKey[tCode + "|" + tName + "|" + tPhone]) {
    var hComp = hubInvoiceByKey[tCode + "|" + tName + "|" + tPhone];
    if (_po_claimInvoiceMulti_(usedInvSet, hComp, owner)) return hComp;
  }
  var shortP =
    tPhone.length >= 4 ? tPhone.substring(tPhone.length - 4) : tPhone;

  // ★ 2026-08-27: 아래 이름·전화 폴백은 전용양식 송장만 받는다.
  //   대리공급 송장의 원천은 공급처가 적는 전용양식 A열이다. 입력_롯데택배는
  //   우리가 자사출고한 건이므로 대리공급 행의 후보가 될 수 없다.
  //   종전에는 두 원천이 한 맵에 섞여 있어, 고유ID로 못 찾으면 이름만 같은
  //   자사출고 송장을 집어왔다(같은 고객이 자사출고로도 주문한 경우).
  //   고유ID가 있으면 위 1·2단계에서 이미 끝난다. 여기까지 내려온 행은
  //   전용양식에서 고유ID가 지워졌거나 아직 송장이 안 나온 경우다.
  var srcOk = _po_isExclusiveFormSrc_;

  // 3. 수취인명 + 전화끝4자리 (전용양식 출처만)
  if (tName) {
    var npKey = tName + "_" + shortP;
    inv = _po_pickUnusedInvoice_(invoiceMap[npKey], usedInvSet, owner, srcOk);
    if (inv) return inv;
    var nNorm = tName.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, "");
    var normKey = nNorm + "_" + shortP;
    if (normKey !== npKey) {
      inv = _po_pickUnusedInvoice_(invoiceMap[normKey], usedInvSet, owner, srcOk);
      if (inv) return inv;
    }
  }
  // ★ 2026-08-27: 아래 단일 필드 폴백(전화 단독·이름 단독)은 정책상 껐다.
  //   전용양식 출처로 좁혀도 재구매 고객은 과거 출고분과 새 주문이 같은
  //   PH_·NR_ 키를 공유한다(송장맵에 날짜가 없다). 되돌려야 하면 스크립트 속성
  //   INVOICE_MATCH_ALLOW_SINGLE_FIELD = true.
  if (typeof _pt_allowSingleFieldMatch_ === "function" && !_pt_allowSingleFieldMatch_()) {
    return "";
  }

  // 4. 전화번호 단독 (전용양식 출처만) — 이름 오감지 대비
  if (tPhone.length >= 8) {
    var phoneKey = "PH_" + tPhone;
    inv = _po_pickUnusedInvoice_(invoiceMap[phoneKey], usedInvSet, owner, srcOk);
    if (inv) return inv;
  }
  // 5. 수취인명 단독 (전용양식 출처만)
  //    이름만으로 자사출고 송장을 가져오는 것이 오배정의 주 경로였다.
  if (tName && tName.length >= 2) {
    var nameRawKey = "NR_" + tName;
    inv = _po_pickUnusedInvoice_(invoiceMap[nameRawKey], usedInvSet, owner, srcOk);
    if (inv) return inv;
  }
  return "";
}

/** ★ 2026-06-19: 소비형 송장 선택 — 이미 사용된 송장을 건너뛰어 동일인 다른 품목에 다른 송장 배정 */
/**
 * ★ 2026-08-25: 송장 소유권 확보.
 *   같은 주문(고유ID)의 여러 품목 행은 한 송장을 공유해도 정상이다(다품목·합포장).
 *   다른 주문이 이미 배정된 송장을 가져가는 것만 막는다.
 *   usedInvSet 값은 소유 주문의 고유ID(또는 행 토큰)를 담는다.
 * @return {boolean} 이 주문이 이 송장을 써도 되는지
 */
// ★ 2026-08-25: 2차 폴백은 송장맵을 한 번 더 만들기 때문에 무겁다.
//   Apps Script 6분 제한에 걸리면 수집 결과 쓰기까지 통째로 날아가므로 예산을 둔다.
var _PO_EXEC_T0_ = null;
var _PO_FB_BUDGET_MS_ = 240000; // 4분 경과 후에는 폴백을 건너뛴다

function _po_markExecStart_() {
  _PO_EXEC_T0_ = new Date().getTime();
}

function _po_execElapsedMs_() {
  if (!_PO_EXEC_T0_) return 0;
  return new Date().getTime() - _PO_EXEC_T0_;
}

/**
 * 소비 대장 키 — 같은 송장이 소스마다 "1234-5678-90"/"1234567890"처럼 다르게 적혀도
 * 한 송장으로 보게 만든다. 이게 없으면 표기만 달라도 중복 배정이 통과한다.
 */
function _po_invKey_(inv) {
  var s = String(inv == null ? "" : inv).trim();
  if (!s) return "";
  var d = s.replace(/[^0-9]/g, "");
  return d.length >= 8 ? d : s;
}

function _po_claimInvoice_(usedInvSet, inv, owner) {
  if (!usedInvSet) return false;
  var k = _po_invKey_(inv);
  if (!k) return false;
  var cur = usedInvSet[k];
  if (cur === undefined || cur === null || cur === "") {
    usedInvSet[k] = owner || true;
    return true;
  }
  if (cur === true) return false; // 소유자 불명 → 양보
  return String(cur) === String(owner || "");
}

/** "A\nB"처럼 여러 송장이 묶인 값 — 전부 확보 가능할 때만 사용 */
function _po_claimInvoiceMulti_(usedInvSet, invRaw, owner) {
  var parts = String(invRaw == null ? "" : invRaw).split(/[\n,\/]/);
  var any = false;
  for (var i = 0; i < parts.length; i++) {
    var c = parts[i].trim();
    if (!c) continue;
    if (!_po_claimInvoice_(usedInvSet, c, owner)) return false;
    any = true;
  }
  return any;
}

/**
 * 이 송장이 협력업체 전용양식에서 나온 것인가.
 *
 * ★ 2026-08-27: 대리공급 송장의 원천은 협력업체 파일의 「전용양식」A열이다.
 *   공급처가 직접 적어 넣고, 역수집이 그대로 읽어온다 — 매칭이 아니라 전달이다.
 *   반면 입력_롯데택배·로젠주문실적은 우리가 자사출고한 건의 송장이다.
 *   둘은 별개 세계인데 한 invoiceMap에 섞여 있어, 이름 단독 키로 자사출고 송장이
 *   대리공급 행에 붙는 일이 있었다. 출처로 갈라 그 경로를 끊는다.
 *
 * 역수집 라벨은 "<업체명>/<탭명>" 형태(예: "그린우드/전용양식")이고,
 * 중앙 원천은 "롯데택배"·"★최우선(로젠주문실적)"·"합배송전용" 처럼 슬래시가 없다.
 */
function _po_isExclusiveFormSrc_(src) {
  var s = String(src == null ? "" : src);
  if (!s) return false;
  if (s.indexOf("롯데") !== -1) return false;
  if (s.indexOf("로젠") !== -1) return false;
  if (s.indexOf("합배송") !== -1) return false;
  return s.indexOf("/") !== -1;
}

/**
 * 넓은 맵(통합조회 송장맵)에서 대리공급 행이 이름·전화로 받아도 되는 출처인가.
 *
 * 전용양식에서 나온 송장만 허용한다.
 *   대리공급 / 대리공급(보관) — 임시기록 X열. 전용양식 역수집이 채운 값이다.
 *   송장원장                — 전용발주 마감탭(과거 전용양식)에서 회수한 값이다.
 * 제외한다.
 *   롯데 / 1주출고 / 합포장  — 우리가 자사출고한 건의 송장이다.
 *   대리판매                — 허브 N열이고 그 값은 롯데에서 채워진다.
 *
 * 고유ID 일치는 이 검사를 적용하지 않는다. 고유ID는 우연히 겹치지 않는다.
 */
function _po_isProxySupplySrc_(src) {
  var s = String(src == null ? "" : src);
  if (!s) return false;
  if (s.indexOf("대리공급") !== -1) return true;
  if (s.indexOf("송장원장") !== -1) return true;
  return false;
}

/**
 * @param {Function=} srcOk 출처 필터. 주면 통과한 엔트리만 후보로 본다.
 */
function _po_pickUnusedInvoice_(found, usedInvSet, owner, srcOk) {
  if (!found || !found.length) return "";
  for (var fi = 0; fi < found.length; fi++) {
    var candidate = String(found[fi].invRaw || "").trim();
    if (!candidate) continue;
    if (srcOk && !srcOk(found[fi].src)) continue;
    if (_po_claimInvoice_(usedInvSet, candidate, owner)) return candidate;
  }
  // ★ 2026-08-25: 남은 후보가 모두 다른 주문 소유면 빈 값을 돌려준다.
  //   기존에는 "첫 번째 유효한 것"을 그대로 반환해 서로 다른 주문에 같은 송장이
  //   배정됐다(오배정). 잘못된 송장을 넣는 것보다 미배정으로 남기는 편이 안전하다.
  return "";
}

/** 임시기록 행 → 일일마감 송장맵 (P→X, colOffset=보관탭이면 2) */
function _po_addTempRowsToInvoiceMap_(invoiceMap, tData, sourceLabel, colOffset) {
  if (!invoiceMap || !tData || !tData.length) return 0;
  colOffset = colOffset || 0;
  var uidCol = _PO_TEMP_UID_COL_ + colOffset;
  var invCol = _PO_TEMP_INV_COL_ + colOffset;
  var pfxCol = _PO_TEMP_PFX_COL_ + colOffset;
  var added = 0;
  for (var ti = 0; ti < tData.length; ti++) {
    var tUid = String(tData[ti][uidCol] || "").trim();
    var tInv = String(tData[ti][invCol] || "").trim();
    if (!tInv) continue;
    if (typeof _po_hasRealInvoice_ === "function" && !_po_hasRealInvoice_(tInv)) continue;
    added++;
    // ★ 2026-08-27: W열 업체prefix → 택배사. 출처("대리공급")는 택배사를 알려주지
    //   않으므로 `업체_택배사` 표가 유일한 근거다. 일일마감 택배사 열이 이 값을 쓴다.
    var tCarrier = "";
    if (typeof _pep_carrierForVendor_ === "function") {
      tCarrier = _pep_carrierForVendor_(tData[ti][pfxCol]);
    }
    if (tUid && !(invoiceMap[tUid] && invoiceMap[tUid].source === "롯데")) {
      _pep_addInvoiceMap_(invoiceMap, tUid, tInv, sourceLabel, tCarrier);
    }
    if (typeof _pep_addNamePhoneInvoiceKeys_ === "function") {
      _pep_addNamePhoneInvoiceKeys_(
        invoiceMap,
        tData[ti][12 + colOffset],
        tData[ti][7 + colOffset] || tData[ti][8 + colOffset],
        tInv,
        sourceLabel,
        {
          skipName: true,
          addr: tData[ti][9 + colOffset],
          item: tData[ti][4 + colOffset],
          carrier: tCarrier,
          stat: typeof _pep_keyStat_ === "function" ? _pep_keyStat_(sourceLabel) : null
        }
      );
    }
  }
  return added;
}

/** 보관탭 전체 헤더 = [보관일시, 보관사유] + 임시기록 원본 헤더 */
function _po_tempArchiveHeaders_() {
  var src = (typeof _PEP_NON_PARTNER_TEMP_HEADERS_ !== "undefined")
    ? _PEP_NON_PARTNER_TEMP_HEADERS_
    : [];
  var out = ["보관일시", "보관사유"];
  for (var i = 0; i < src.length; i++) out.push(src[i] || ("열" + (i + 1)));
  while (out.length < _PO_TEMP_INV_COL_ + _PO_TEMP_ARCHIVE_COL_OFFSET_ + 1) out.push("");
  return out;
}

function _po_ensureTempArchiveTab_(ss) {
  if (!ss) ss = _po_openTempSheetSs_();
  var headers = _po_tempArchiveHeaders_();
  var tab = ss.getSheetByName(_PO_TEMP_ARCHIVE_TAB_NAME_);
  if (!tab) {
    tab = ss.insertSheet(_PO_TEMP_ARCHIVE_TAB_NAME_);
    tab.setFrozenRows(1);
  }
  // ★ 2026-08-25: 헤더를 2열만 두면 적재 폭이 어긋나 setValues가 실패한다 → 전체 폭 확보
  if (tab.getMaxColumns() < headers.length) {
    tab.insertColumnsAfter(tab.getMaxColumns(), headers.length - tab.getMaxColumns());
  }
  if (tab.getLastColumn() < headers.length) {
    tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return tab;
}

function _po_archiveTempRows_(ss, rows, reason) {
  if (!rows || !rows.length) return 0;
  var archTab = _po_ensureTempArchiveTab_(ss);
  var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var off = _PO_TEMP_ARCHIVE_COL_OFFSET_;

  // ★ 2026-08-25: 폭은 원본 행 기준으로 정한다. 보관탭의 현재 폭으로 정하면
  //   신규 생성 직후 폭이 어긋나 적재가 실패하고, 그 사이 원본이 지워져 송장이 소실된다.
  var srcWidth = _PO_TEMP_INV_COL_ + 1;
  for (var i = 0; i < rows.length; i++) srcWidth = Math.max(srcWidth, rows[i].length);
  var total = srcWidth + off;

  var out = [];
  for (i = 0; i < rows.length; i++) {
    var row = rows[i].slice();
    while (row.length < srcWidth) row.push("");
    out.push([nowStr, reason || "마감"].concat(row));
  }
  if (archTab.getMaxColumns() < total) {
    archTab.insertColumnsAfter(archTab.getMaxColumns(), total - archTab.getMaxColumns());
  }
  var start = Math.max(archTab.getLastRow() + 1, 2);
  archTab.getRange(start, 1, out.length, total).setValues(out);
  _po_trimTempArchive_(archTab);
  return out.length;
}

function _po_trimTempArchive_(archTab) {
  if (!archTab || archTab.getLastRow() < 2) return;
  var lr = archTab.getLastRow();
  var lc = archTab.getLastColumn();
  var data = archTab.getRange(2, 1, lr - 1, lc).getValues();
  var cutoff = new Date(Date.now() - _PO_TEMP_ARCHIVE_DAYS_ * 86400000);
  var keep = [];
  var removed = 0;
  for (var i = 0; i < data.length; i++) {
    var d = data[i][0];
    var dt = d instanceof Date ? d : new Date(String(d || ""));
    if (!isNaN(dt.getTime()) && dt < cutoff) { removed++; continue; }
    keep.push(data[i]);
  }
  if (removed > 0) {
    _pt_clearContentAndFormat_(archTab.getRange(2, 1, lr - 1, lc));
    if (keep.length > 0) {
      archTab.getRange(2, 1, keep.length, lc).setValues(keep);
    }
    Logger.log("[TEMP_ARCHIVE] 만료 삭제=" + removed + " 유지=" + keep.length);
  }
}

function _po_getTempArchiveTab_(ss) {
  if (!ss) ss = _po_openTempSheetSs_();
  return ss.getSheetByName(_PO_TEMP_ARCHIVE_TAB_NAME_);
}

/** 초기화 시 송장번호(X열) 있는 행만 제거, 미매칭 행은 유지 — 삭제 전 보관탭에 복사 */
function _po_clearTempTabInvoicedRowsOnly_(tempTab) {
  if (!tempTab || tempTab.getLastRow() < 2) return { cleared: 0, kept: 0 };
  var lr = tempTab.getLastRow();
  var lc = Math.max(tempTab.getLastColumn(), _PO_TEMP_STATUS_COL_ + 1);
  var data = tempTab.getRange(2, 1, lr - 1, lc).getValues();
  var keepRows = [];
  var cleared = 0;
  var archiveRows = [];

  // ★ 2026-07-07: 15일 기준 날짜 산출 (송장 없어도 오래된 행 삭제, 기존 7일→15일 변경)
  var now = new Date();
  var cutoffNum = (now.getFullYear() * 10000) +
    ((now.getMonth() + 1) * 100) +
    now.getDate() - 15; // 15일 전 날짜 숫자 (간이 계산)
  // 정확한 15일 전 계산
  var cutoff = new Date(now.getTime() - 15 * 86400000);
  cutoffNum = (cutoff.getFullYear() * 10000) +
    ((cutoff.getMonth() + 1) * 100) +
    cutoff.getDate();

  for (var i = 0; i < data.length; i++) {
    // ★ 2026-08-25: placeholder("재고확인후 판단")를 송장으로 오인하면 실제 송장이
    //   없는 행이 보관으로 옮겨지고 임시기록에서 사라진다. 일일마감과 같은 판정을 쓴다.
    var hasInvoice = _po_hasRealInvoice_(data[i][_PO_TEMP_INV_COL_]);

    // ★ C열(index 2) "일자-No." → 날짜 추출 (예: "2026/06/25-12")
    var isOld = false;
    if (!hasInvoice) {
      var cVal = String(data[i][2] || "").trim();
      var dateMatch = cVal.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
      if (dateMatch) {
        var rowDateNum = parseInt(dateMatch[1], 10) * 10000 +
          parseInt(dateMatch[2], 10) * 100 +
          parseInt(dateMatch[3], 10);
        isOld = rowDateNum <= cutoffNum;
      }
    }

    if (hasInvoice || isOld) {
      cleared++;
      archiveRows.push(data[i]);
    } else {
      keepRows.push(data[i]);
    }
  }
  if (archiveRows.length > 0) {
    try {
      var archSs = tempTab.getParent();
      var n = _po_archiveTempRows_(archSs, archiveRows, "마감정리");
      Logger.log("[TEMP_CLEAR] 임시기록 보관탭 적재: " + n + "건");
    } catch (eArch) {
      // ★ 2026-08-25: 보관에 실패했으면 절대 지우지 않는다.
      //   과거에는 실패를 삼키고 삭제를 계속해 대리공급 송장이 영구 소실됐다.
      Logger.log("[TEMP_CLEAR] 임시기록 보관 실패 → 삭제 중단: " + eArch.message);
      return {
        cleared: 0, kept: data.length,
        archiveFailed: true, error: String(eArch.message || eArch),
      };
    }
  }
  // ★ 2026-07-24: 값+서식 동시 제거 (송장 초록 배경·테두리 잔재 방지)
  _pt_clearContentAndFormat_(tempTab.getRange(2, 1, lr - 1, lc));
  if (keepRows.length > 0) {
    var padded = [];
    for (var k = 0; k < keepRows.length; k++) {
      var row = keepRows[k];
      if (row.length < lc) {
        var extended = row.slice();
        while (extended.length < lc) extended.push("");
        padded.push(extended);
      } else {
        padded.push(row);
      }
    }
    tempTab.getRange(2, 1, keepRows.length, lc).setValues(padded);
  }
  return { cleared: cleared, kept: keepRows.length };
}

// ★ 비협력업체 임시탭(대리공급_임시기록)
//   P열(사방넷주문번호) + 허브매칭 + invoiceMap으로 X열 송장번호 기록
function _po_checkNonPartnerTempTabMatches_(invoiceMap, scannedLogs, hubInvoiceByKey, issueByUid) {
  issueByUid = issueByUid || {};
  var tempTab = _po_getNonPartnerTempTab_(SpreadsheetApp.getActiveSpreadsheet());
  if (!tempTab || tempTab.getLastRow() < 2) {
    scannedLogs.push("[비협력임시탭] 데이터 없음 스킵");
    return;
  }
  var tempLr = tempTab.getLastRow();
  _po_ensureCols_(tempTab, _PO_TEMP_ISSUE_COL_ + 1); // V(택배사)·Z(이슈) 쓰기 자리 확보
  // V1 헤더 — 대리공급 Push 가 헤더행을 다시 쓰기 전에 수집이 먼저 돌 수 있다
  try {
    var _vH = tempTab.getRange(1, _PO_TEMP_CARRIER_COL_ + 1);
    if (String(_vH.getValue() || "").trim() === "") _vH.setValue("택배사");
  } catch (eVH) {}
  var tempLc = Math.max(tempTab.getLastColumn(), _PO_TEMP_ISSUE_COL_ + 1); // ★ Z열(이슈) 포함 보장
  var tempData = tempTab.getRange(2, 1, tempLr - 1, tempLc).getValues();
  var totalNp = 0,
    alreadyHas = 0,
    newlyMatched = 0,
    noMatchNp = 0;
  var updates = [];
  var unresolved = []; // 1차 매칭 실패 행 인덱스 — 2차 폴백 대상
  // ★ 2026-06-19: 소비형 매칭 — 한 번 배정된 송장은 다른 주문에서 건너뜀
  // 값은 소유 주문의 고유ID이며, 같은 주문의 다른 품목 행은 계속 공유할 수 있다.
  var usedInvSet = {};
  // ★ 2026-08-25: 기존 송장은 매칭 루프보다 먼저 전부 등록한다. 시트 아래쪽 행이
  //   이미 쓰고 있는 송장을 위쪽 행이 먼저 채가는 순서 의존 오배정을 막는다.
  for (var si = 0; si < tempData.length; si++) {
    var sUid = String(tempData[si][_PO_TEMP_UID_COL_] || "").trim();
    if (!sUid) continue;
    var sInv = tempData[si][_PO_TEMP_INV_COL_];
    if (_po_hasRealInvoice_(sInv)) _po_claimInvoiceMulti_(usedInvSet, sInv, sUid);
  }
  for (var ti = 0; ti < tempData.length; ti++) {
    var tUid = String(tempData[ti][_PO_TEMP_UID_COL_] || "").trim();
    if (!tUid) continue;
    totalNp++;
    if (_po_hasRealInvoice_(tempData[ti][_PO_TEMP_INV_COL_])) {
      alreadyHas++;
      // 이미 송장이 있으나 Y열 상태가 "송장수집"이 아닌 경우 자동 갱신 리스트에 추가
      var currentStatus = String(tempData[ti][_PO_TEMP_STATUS_COL_] || "").trim();
      if (currentStatus !== "송장수집") {
        updates.push({ row: ti + 2, inv: String(tempData[ti][_PO_TEMP_INV_COL_]), updateStatusOnly: true });
      }
      continue;
    }
    var bestInv = _po_resolveTempTabInvoice_(
      tempData[ti],
      invoiceMap,
      hubInvoiceByKey,
      usedInvSet,
      tUid,
    );
    if (bestInv) {
      updates.push({ row: ti + 2, inv: bestInv, updateStatusOnly: false });
      newlyMatched++;
    } else {
      unresolved.push(ti);
    }
  }

  // ── ★ 2026-08-25: 2차 폴백 — 일일마감 송장맵으로 재시도 ──
  // 위 1차는 로젠·롯데·합배송만 읽은 좁은 맵(배열형)을 쓴다. 송장원장·1주출고·보관 등
  // 다른 소스에 송장이 이미 있어도 1차에서는 보이지 않아 미배정으로 남았다.
  // 일일마감 맵은 주소·전화앞7자리 키(NPA/NA/NP7)까지 갖고 있어 회수율이 높다.
  var fbMatched = 0;
  var fbVia = {};
  // 이름은 같지만 자사출고 송장이라 버린 건수 — 종전에는 이게 그대로 붙었다
  var fbBlocked = 0;
  var fbBlockedEg = [];
  if (unresolved.length && _po_execElapsedMs_() > _PO_FB_BUDGET_MS_) {
    scannedLogs.push(
      "[비협력임시탭] 2차 폴백 생략 — 실행시간 " +
      Math.round(_po_execElapsedMs_() / 1000) + "초 경과 (미배정 " + unresolved.length + "건은 다음 실행에서 재시도)",
    );
  } else if (unresolved.length) {
    try {
      // 일일마감 맵에는 보관 탭 송장도 들어 있다. 보관 행의 소유권을 미리 등록하지 않으면
      // 현재 행이 이미 출고된 과거 주문의 송장을 가져갈 수 있다.
      var arcSeeded = false;
      try {
        var arcSs = typeof _po_openTempSheetSs_ === "function"
          ? _po_openTempSheetSs_() : SpreadsheetApp.getActiveSpreadsheet();
        var arcTab = _po_getTempArchiveTab_(arcSs);
        if (arcTab && arcTab.getLastRow() >= 2) {
          var aOff = _PO_TEMP_ARCHIVE_COL_OFFSET_;
          var aLc = Math.max(arcTab.getLastColumn(), _PO_TEMP_INV_COL_ + aOff + 1);
          var aData = arcTab.getRange(2, 1, arcTab.getLastRow() - 1, aLc).getValues();
          for (var ai2 = 0; ai2 < aData.length; ai2++) {
            var aUid = String(aData[ai2][_PO_TEMP_UID_COL_ + aOff] || "").trim();
            var aInv = aData[ai2][_PO_TEMP_INV_COL_ + aOff];
            if (aUid && _po_hasRealInvoice_(aInv)) _po_claimInvoiceMulti_(usedInvSet, aInv, aUid);
          }
        }
        arcSeeded = true;
      } catch (eArc) {
        scannedLogs.push("[비협력임시탭] 보관 송장 선등록 실패 — " + String(eArc.message || eArc));
      }
      // 보관 소유권을 모르는 상태로 넓은 맵을 뒤지면 과거 주문 송장을 가로챌 수 있다.
      if (!arcSeeded) throw new Error("보관 소유권 미확보 — 2차 폴백 중단");
      var fbStat = { keys: 0 };
      var fbMap = _puv_buildInvoiceMap_(fbStat);
      for (var ui2 = 0; ui2 < unresolved.length; ui2++) {
        var uti = unresolved[ui2];
        var uRow = tempData[uti];
        var uUid = String(uRow[_PO_TEMP_UID_COL_] || "").trim();
        var via = {};
        var hit = null;

        // ★ 2026-08-27: 고유ID를 먼저 본다. 종전에는 이름·전화를 먼저 조회해,
        //   고유ID가 있는 행조차 이름이 같은 자사출고 송장을 먼저 집어갔다.
        if (uUid) {
          var byUid = _pep_lookupInvoiceMap_(fbMap, uUid);
          if (byUid && byUid.inv) { hit = byUid; via.via = "UID"; }
        }

        // 고유ID로 못 찾으면 이름·전화로 내려간다. 단, 전용양식 계열 출처만 받는다.
        // 대리공급 송장의 원천은 공급처가 적는 전용양식이다. 입력_롯데택배는
        // 우리 자사출고 송장이므로 이 행의 후보가 될 수 없다.
        if (!hit || !hit.inv) {
          var npHit = _pep_lookupNamePhoneInvoice_(
            fbMap, uRow[12], uRow[8] || uRow[7], uRow[9], uRow[4], via,
          );
          if (npHit && npHit.inv) {
            if (_po_isProxySupplySrc_(npHit.source)) {
              hit = npHit;
            } else {
              fbBlocked++;
              if (fbBlockedEg.length < 5) {
                fbBlockedEg.push(
                  String(uRow[12] || "") + " — " + String(npHit.source || "?") +
                    " 송장(" + String(npHit.inv).replace(/\n/g, ",").substring(0, 24) +
                    ") 차단, 키=" + (via.via || "?"),
                );
              }
              via.via = "";
            }
          }
        }
        if (!hit || !hit.inv) continue;
        // 소유권 검사를 거쳐야 한다. 넓은 맵은 후보가 많아 검사 없이는 오배정이 늘어난다.
        if (!_po_claimInvoiceMulti_(usedInvSet, hit.inv, uUid)) continue;
        updates.push({ row: uti + 2, inv: hit.inv, updateStatusOnly: false });
        newlyMatched++;
        fbMatched++;
        var vk = via.via || "?";
        fbVia[vk] = (fbVia[vk] || 0) + 1;
      }
      if (fbMatched > 0) {
        var vparts = [];
        for (var vv in fbVia) {
          if (fbVia.hasOwnProperty(vv)) vparts.push(vv + " " + fbVia[vv]);
        }
        scannedLogs.push(
          "[비협력임시탭] 2차 폴백(일일마감 송장맵 " + (fbStat.keys || 0) + "키) 회수 " +
          fbMatched + "건 — " + vparts.join(", "),
        );
      }
      if (fbBlocked > 0) {
        scannedLogs.push(
          "[비협력임시탭] ⛔ 이름은 같지만 자사출고 송장이라 차단: " + fbBlocked + "건\n" +
            "  (대리공급 송장의 원천은 전용양식입니다. 이 건들은 공급처 미발행으로 남깁니다)\n" +
            (fbBlockedEg.length ? "  " + fbBlockedEg.join("\n  ") : ""),
        );
      }
    } catch (eFb) {
      scannedLogs.push("[비협력임시탭] 2차 폴백 오류 — " + String(eFb.message || eFb));
    }
  }
  noMatchNp += unresolved.length - fbMatched;
  // ★ 2026-06-26: 배치 처리 최적화 (개별 setValue → 배열 수정 + setValues 2회)
  var invoiceGreen = "#d9ead3"; // 연한 녹색
  if (updates.length > 0) {
    // ① 기존 X열(송장), Y열(상태), V열(택배사) 배열 구축
    var xVals = [];
    var yVals = [];
    var vVals = [];
    for (var ai = 0; ai < tempData.length; ai++) {
      xVals.push([tempData[ai][_PO_TEMP_INV_COL_] || ""]);
      yVals.push([tempData[ai][_PO_TEMP_STATUS_COL_] || ""]);
      vVals.push([tempData[ai][_PO_TEMP_CARRIER_COL_] || ""]);
    }
    // ② updates 반영
    var bgA1Ranges = [];
    var vChanged = false;
    for (var ui = 0; ui < updates.length; ui++) {
      var idx = updates[ui].row - 2; // row(1-based) → tempData index(0-based)
      if (updates[ui].updateStatusOnly) {
        yVals[idx] = ["송장수집"];
      } else {
        xVals[idx] = [updates[ui].inv];
        yVals[idx] = ["송장수집"];
      }
      // ★ 2026-08-31: V열(택배사).
      //   임시기록은 전부 대리공급이라 출처가 택배사를 알려주지 않는다.
      //   W열 업체prefix → 「업체_택배사」표가 1순위, 품목코드 → 출고지가 2순위다.
      if (String(vVals[idx][0] || "").trim() === "") {
        var _tc = _po_carrierForTempRow_(tempData[idx]);
        if (_tc) {
          vVals[idx] = [_tc];
          vChanged = true;
        }
      }
      bgA1Ranges.push(updates[ui].row + ":" + updates[ui].row);
    }
    // ③ 배치 쓰기 (API 호출 2~3회)
    tempTab.getRange(2, _PO_TEMP_INV_COL_ + 1, tempData.length, 1).setValues(xVals);
    tempTab.getRange(2, _PO_TEMP_STATUS_COL_ + 1, tempData.length, 1).setValues(yVals);
    if (vChanged) {
      tempTab
        .getRange(2, _PO_TEMP_CARRIER_COL_ + 1, tempData.length, 1)
        .setValues(vVals);
    }
    // ④ 배경색 일괄 적용
    try {
      tempTab.getRangeList(bgA1Ranges).setBackground(invoiceGreen);
    } catch (eBg) {}
  }

  // ★ 2026-07-07: Z열(25, 이슈) 배치 쓰기 — updates와 독립 실행
  // _PO_TEMP_ISSUE_COL_ = 25 → 전역 상수로 이동 완료 (3919행)
  if (Object.keys(issueByUid).length > 0 && tempData.length > 0) {
    var zVals = [];
    var _zChanged = false;
    for (var _zi = 0; _zi < tempData.length; _zi++) {
      var _zUid = String(tempData[_zi][_PO_TEMP_UID_COL_] || "").trim();
      var _zExisting = String(tempData[_zi][_PO_TEMP_ISSUE_COL_] || "").trim();
      var _zIssue = (_zUid && issueByUid[_zUid]) ? issueByUid[_zUid] : _zExisting;
      zVals.push([_zIssue]);
      if (_zIssue !== _zExisting) _zChanged = true;
    }
    if (_zChanged) {
      tempTab.getRange(2, _PO_TEMP_ISSUE_COL_ + 1, tempData.length, 1).setValues(zVals);
      scannedLogs.push("[이슈] 임시기록 Z열 기록 완료");
    }
  }

  if (updates.length > 0) SpreadsheetApp.flush();
  scannedLogs.push(
    "[비협력 임시탭] 전체: " +
      totalNp +
      "건 / 기존송장: " +
      alreadyHas +
      "건 / 신규기록: " +
      newlyMatched +
      "건 / 미매칭: " +
      noMatchNp +
      "건",
  );
}


/**
 * ★ 임시탭(대리발송_임시기록)에서 K열(송장번호)이 채워진 행을
 *   사방넷_송장매칭 탭(롯데택배 GID 1575029201 열 배열)으로 변환 출력
 *
 * 임시탭 열 구조 (새 구조 — 대리발송탭 원본 + 고유ID 선두 삽입):
 *   A(0)=고유ID | B(1)=상태 | C(2)=순번 | D(3)=일자-No. | E(4)=품목코드 | F(5)=품목명
 *   G(6)=택배박스 | H(7)=수량 | I(8)=전화 | J(9)=모바일 | K(10)=주소1
 *   L(11)=배송메시지 | M(12)=합계 | N(13)=거래처명 | O(14)=단품배송비 | P(15)=적요
 *   Q(16)=사방넷주문번호 | R(17)=보내는분 | S(18)=보내는분전화 | T(19)=보내는주소
 *   U(20)=빈칸 | V(21)=업체prefix | W(22)=송장번호 ← 수집 시 채워짐
 */
function _po_pushTempTabMatchedToNonPartnerSheet_(scannedLogs) {
  var tempTab = _po_getNonPartnerTempTab_(SpreadsheetApp.getActiveSpreadsheet());
  if (!tempTab || tempTab.getLastRow() < 2) {
    scannedLogs.push("[임시탭→비협력] 임시탭 없음 또는 비어있음");
    return 0;
  }

  var tempLr = tempTab.getLastRow();
  var tempLc = Math.max(tempTab.getLastColumn(), 23);
  var tempData = tempTab.getRange(2, 1, tempLr - 1, tempLc).getValues();

  // 사방넷_송장매칭 탭 열기 / 없으면 롯데 열배열로 생성
  var layout = _po_getSabangnetMatchLayout_(scannedLogs);
  var targetSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var targetTab = _po_ensureSabangnetMatchTab_(targetSS, layout, scannedLogs, "[임시탭→비협력]");
  var existingInvSet = _po_collectExistingInvSet_(targetTab, layout.col.inv);

  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var newRows = [];
  var written = 0, skipped = 0, noInv = 0;

  for (var ti = 0; ti < tempData.length; ti++) {
    var inv = String(tempData[ti][23] || "").trim(); // X(23): 송장번호

    if (!inv) { noInv++; continue; }

    var invDigits = inv.replace(/[^0-9]/g, "");
    if (existingInvSet[inv] || existingInvSet[invDigits]) { skipped++; continue; }

    var uid      = String(tempData[ti][15] || "").trim(); // P(15): 사방넷주문번호=고유ID (사방넷번호 또는 결정론적UID 모두 허용)

    var itemCode = String(tempData[ti][3]  || "").trim(); // D(3): 품목코드
    var itemName = String(tempData[ti][4]  || "").trim(); // E(4): 품목명
    var qty      = tempData[ti][6]  || "";                // G(6): 수량
    var recTel   = String(tempData[ti][7]  || "").trim(); // H(7): 전화(유선)
    var recMob   = String(tempData[ti][8]  || "").trim(); // I(8): 모바일
    var recAddr  = String(tempData[ti][9]  || "").trim(); // J(9): 주소1
    var msg      = String(tempData[ti][10] || "").trim(); // K(10): 배송메시지
    // ★ 수취인명: M(12)=거래처명이 소스에서 수취인 역할. 빈칸이면 Q(16)=보내는분 폴백
    var recName  = String(tempData[ti][12] || "").trim(); // M(12): 거래처명(=수취인)
    if (!recName) recName = String(tempData[ti][16] || "").trim(); // Q(16): 보내는분 폴백
    var pfxLabel = String(tempData[ti][22] || "").trim(); // W(22): 업체prefix

    var outRow = _po_buildUnmatchedRow_(layout, {
      inv: inv,
      recName: recName,
      recAddr: recAddr,
      recTel: recTel,
      recMob: recMob,
      qty: qty,
      itemCode: itemCode,
      itemName: itemName,
      msg: msg,
      sendName: pfxLabel,
      uid: uid,
      date: today,
    });

    newRows.push(outRow);
    existingInvSet[inv] = true;
    existingInvSet[invDigits] = true;
    written++;
  }

  if (newRows.length > 0) {
    var writeStart = targetTab.getLastRow() + 1;
    _po_applyUnmatchedNumberFormats_(targetTab, writeStart, newRows.length, layout);
    targetTab.getRange(writeStart, 1, newRows.length, layout.headers.length).setValues(newRows);
    SpreadsheetApp.flush();
  }

  // ★ 디버그: 임시탭 열 수와 첫 3건 P열(15) 값 출력
  var _dbgSamples_ = [];
  for (var _di_ = 0; _di_ < Math.min(tempData.length, 3); _di_++) {
    _dbgSamples_.push("R" + (_di_+2) + ":P(15)=[" + String(tempData[_di_][15] || "(빈)") + "] X(23)=[" + String(tempData[_di_][23] || "(빈)") + "]");
  }
  scannedLogs.push("★ [임시탭→비협력] tempLc=" + tempLc + " 행=" + tempData.length + " 샘플=" + _dbgSamples_.join(" | "));

  scannedLogs.push("★ [임시탭→비협력] 기록: " + written + "건 / 중복스킵: " + skipped + "건 / 송장없음: " + noInv + "건");

  // ★ 보정: 기존 사방넷_송장매칭 행 중 J열(주문번호)이 비어있으면 임시탭 P열 값으로 채움
  try {
    var uidCol = layout.col.uid;
    var invCol = layout.col.inv;
    if (targetTab.getLastRow() >= 2 && uidCol >= 0 && invCol >= 0) {
      var invToUid = {};
      for (var bi = 0; bi < tempData.length; bi++) {
        var bInv = String(tempData[bi][23] || "").trim();
        var bUid = String(tempData[bi][15] || "").trim();
        if (bInv && bUid) {
          var bDigits = bInv.replace(/[^0-9]/g, "");
          if (!invToUid[bInv]) invToUid[bInv] = bUid;
          if (!invToUid[bDigits]) invToUid[bDigits] = bUid;
        }
      }
      var tgtLr = targetTab.getLastRow();
      var readWidth = Math.max(uidCol, invCol) + 1;
      var tgtData = targetTab.getRange(2, 1, tgtLr - 1, readWidth).getValues();
      var backfilled = 0;
      var uidColOut = [];
      for (var bj = 0; bj < tgtData.length; bj++) {
        var curUid = String(tgtData[bj][uidCol] || "").trim();
        uidColOut.push([tgtData[bj][uidCol]]);
        if (curUid) continue;
        var curInv = String(tgtData[bj][invCol] || "").trim();
        if (!curInv) continue;
        var curInvDigits = curInv.replace(/[^0-9]/g, "");
        var matchUid = invToUid[curInv] || invToUid[curInvDigits] || "";
        if (matchUid) {
          uidColOut[bj][0] = matchUid;
          backfilled++;
        }
      }
      if (backfilled > 0) {
        targetTab.getRange(2, uidCol + 1, uidColOut.length, 1).setValues(uidColOut);
        SpreadsheetApp.flush();
        scannedLogs.push("★ [J열 보정] 기존 행 " + backfilled + "건에 주문번호(사방넷번호) 보정 완료");
      }
    }
  } catch (eBackfill) {
    scannedLogs.push("[J열 보정 오류] " + String(eBackfill.message || eBackfill));
  }

  return written;
}

function _po_collectUnmatchedInvoicesToSeparateTab_(
  globalUsedInvoices,
  scannedLogs,
  partnerTabCache,
) {
  // ① 허브에서 사용된 송장번호 Set
  var usedSet = {};
  for (var uKey in globalUsedInvoices) {
    usedSet[uKey] = true;
    usedSet[uKey.replace(/[^0-9]/g, "")] = true;
  }
  scannedLogs.push(
    "[사방넷주문] 허브 사용 송장: " +
      Object.keys(globalUsedInvoices).length +
      "개",
  );

  // ② 대상 시트에 탭 생성/열기 (롯데 송장탭 열 배열)
  var layout = _po_getSabangnetMatchLayout_(scannedLogs);
  var targetSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var targetTab = _po_ensureSabangnetMatchTab_(targetSS, layout, scannedLogs, "[사방넷주문]");

  // ③ 기존 송장번호 중복 Set
  var existingInvSet = _po_collectExistingInvSet_(targetTab, layout.col.inv);

  // ④ 전용양식 탭 목록 구성 — 캐시가 있으면 파일 재열기 없이 사용
  var today = Utilities.formatDate(
    new Date(),
    "Asia/Seoul",
    "yyyy-MM-dd HH:mm",
  );
  var newRows = [];
  var totalScanned = 0,
    skipUsed = 0,
    skipDup = 0,
    collected = 0;
  var filesFound = 0,
    tabsFound = 0,
    shortInv = 0;

  var tabsToScan = [];
  if (partnerTabCache && partnerTabCache.length > 0) {
    // ★ 캐시 사용: 파일 재열기 없이 이미 읽은 데이터 재사용
    filesFound = partnerTabCache.length;
    scannedLogs.push(
      "[사방넷주문] 캐시 사용: " + filesFound + "개 탭 (파일 재열기 없음)",
    );
    for (var ci = 0; ci < partnerTabCache.length; ci++) {
      tabsToScan.push({
        data: partnerTabCache[ci].data,
        vendorName: partnerTabCache[ci].vendorName,
        tabName: partnerTabCache[ci].tabName,
      });
    }
  } else {
    // 폴백: 캐시 없으면 파일 직접 스캔
    try {
      var pFiles = _pt_listFiles();
      filesFound = pFiles.length;
      scannedLogs.push("[사방넷주문] 협력업체 파일: " + filesFound + "개");
      for (var pfi = 0; pfi < pFiles.length; pfi++) {
        try {
          var pss = SpreadsheetApp.openById(pFiles[pfi].id);
          var vendorName = pFiles[pfi].name.replace("[협력업체] ", "").trim();
          var ptabs = pss.getSheets();
          for (var pti = 0; pti < ptabs.length; pti++) {
            if (ptabs[pti].getName().indexOf("전용양식") > -1) {
              var ptab = ptabs[pti];
              var ptLr = ptab.getLastRow();
              if (ptLr <= 1) continue;
              var ptLc = Math.max(ptab.getLastColumn(), 1);
              tabsToScan.push({
                data: ptab.getRange(1, 1, ptLr, ptLc).getValues(),
                vendorName: vendorName,
                tabName: ptabs[pti].getName(),
              });
            }
          }
        } catch (ePf) {
          scannedLogs.push(
            "[사방넷주문-스캔] " +
              pFiles[pfi].name +
              ": " +
              String(ePf.message || ePf).substring(0, 80),
          );
        }
      }
    } catch (ePAll) {
      scannedLogs.push("[사방넷주문-전체] " + String(ePAll.message || ePAll));
    }
  }

  // 모아진 전용양식 탭 데이터를 순회하며 미매칭 송장번호 추출
  for (var tIdx = 0; tIdx < tabsToScan.length; tIdx++) {
    try {
      var ptData = tabsToScan[tIdx].data;
      var vendorName = tabsToScan[tIdx].vendorName;
      var ptName = tabsToScan[tIdx].tabName || vendorName;
      var ptLr = ptData.length;
      if (ptLr <= 1) continue;
      tabsFound++;
      var ptHeaders = ptData[0];

      // 동적 열 감지 — fixedIdx가 있으면 고정값 사용, 없으면 헤더 감지
      var fixedIdx = tabsToScan[tIdx].fixedIdx || null;
      var invIdx = fixedIdx ? fixedIdx.inv : -1;
      var nameIdx = fixedIdx ? fixedIdx.name : -1;
      var phoneIdx = fixedIdx ? fixedIdx.phone : -1;
      var addrIdx = fixedIdx ? fixedIdx.addr : -1;
      var qtyIdx = fixedIdx ? fixedIdx.qty : -1;
      var itemIdx = fixedIdx ? fixedIdx.iname : -1;
      var itemCodeIdx = fixedIdx ? fixedIdx.icode : -1;
      var msgIdx = fixedIdx ? fixedIdx.msg : -1;
      var remarkIdx = -1,
        sendNameIdx = -1,
        sendPhoneIdx = -1,
        sendAddrIdx = -1,
        sabangnetIdx = -1; // ★ 사방넷주문번호 열

      if (!fixedIdx) {
        for (var hc = 0; hc < ptHeaders.length; hc++) {
          var hn = String(ptHeaders[hc] || "").replace(/\s/g, "");
          if (
            invIdx === -1 &&
            hn.match(/송장|운송장|바코드|택배번호/) &&
            !hn.match(/반품/)
          )
            invIdx = hc;
          if (
            nameIdx === -1 &&
            hn.match(
              /수취인명|수령인명|받는분명|받으시는분|수취인|수령인|수령자|받는사람|받는분|고객명|이름|성명|성함|주문자명|고객/,
            ) &&
            !hn.match(/주소|전화|연락|핸드|휴대|보내는|송하인|배송지|코드/)
          )
            nameIdx = hc;
          if (
            phoneIdx === -1 &&
            hn.match(
              /연락처|전화|모바일|핸드폰|휴대폰|수하인번호|수하인전화/,
            ) &&
            !hn.match(/보내는|송하인|주소/)
          )
            phoneIdx = hc;
          if (
            itemIdx === -1 &&
            hn.match(/품목|상품|물품|품명/) &&
            !hn.match(/코드/)
          )
            itemIdx = hc;
          if (itemCodeIdx === -1 && hn.match(/품목코드|물품코드|품번/))
            itemCodeIdx = hc;
          if (
            qtyIdx === -1 &&
            hn.match(/수량|판매수량/) &&
            !hn.match(/박스|내품|옵션/)
          )
            qtyIdx = hc;
          if (
            addrIdx === -1 &&
            hn.match(/주소|배송지/) &&
            !hn.match(/보내는|송하인|전화|연락/)
          )
            addrIdx = hc;
          if (msgIdx === -1 && hn.match(/배송메시지|배송메세지|특기사항/))
            msgIdx = hc;
          if (remarkIdx === -1 && hn === "적요") remarkIdx = hc;
          if (sabangnetIdx === -1 && hn.match(/사방넷주문번호|사방넷주문|사방넷번호|주문번호/)) sabangnetIdx = hc;
          if (
            sendNameIdx === -1 &&
            hn.match(
              /보내는사람|보내는분|송하인명|보내는이름|송하인|보내는분성명|거래처명|보내는사람명/,
            ) &&
            !hn.match(/주소|전화|연락|코드/)
          )
            sendNameIdx = hc;
          if (
            sendPhoneIdx === -1 &&
            hn.match(
              /보내는.*전화|보내는분.*전화|송하인.*번호|송하인.*전화|보내는.*연락|송하인번호|보내는분전화/,
            )
          )
            sendPhoneIdx = hc;
          if (sendAddrIdx === -1 && hn.match(/보내는.*주소|송하인.*주소/))
            sendAddrIdx = hc;
        }
        if (invIdx === -1) invIdx = 0; // A열 기본값
      }

      // ★ 디버그: 열 감지 결과 + 첫 3개 송장 샘플 출력
      var sampleVals = [];
      for (var si = 1; si < Math.min(ptData.length, 4); si++) {
        sampleVals.push(String(ptData[si][invIdx] || "(빈)").substring(0, 20));
      }
      var nameSample =
        nameIdx >= 0 && ptData.length > 1
          ? String(ptData[1][nameIdx] || "(빈)").substring(0, 10)
          : "(감지실패)";
      scannedLogs.push(
        "[비협력업체-탭] " +
          vendorName +
          "/" +
          ptName +
          " 행=" +
          (ptLr - 1) +
          " invIdx=" +
          invIdx +
          " nameIdx=" +
          nameIdx +
          " nameVal=" +
          nameSample +
          " 헤더=" +
          ptHeaders.slice(0, 12).map(String).join("|"),
      );

      for (var ri = 1; ri < ptData.length; ri++) {
        var row = ptData[ri];
        var inv = String(row[invIdx] || "").trim();
        if (!inv) continue;
        var invDigits = inv.replace(/[^0-9]/g, "");
        if (invDigits.length < 8) {
          shortInv++;
          continue;
        }
        totalScanned++;

        if (usedSet[inv] || usedSet[invDigits]) {
          skipUsed++;
          continue;
        }
        if (existingInvSet[inv] || existingInvSet[invDigits]) {
          skipDup++;
          continue;
        }

        // 롯데 송장탭 열 배열 행 생성
        var parsedPhone =
          phoneIdx >= 0 ? String(row[phoneIdx] || "").trim() : "";
        var parsedSendPhone =
          sendPhoneIdx >= 0 ? String(row[sendPhoneIdx] || "").trim() : "";
        var orderNum = sabangnetIdx >= 0 ? String(row[sabangnetIdx] || "").trim() : "";
        var outRow = _po_buildUnmatchedRow_(layout, {
          inv: inv,
          recName: nameIdx >= 0 ? String(row[nameIdx] || "").trim() : "",
          recAddr: addrIdx >= 0 ? String(row[addrIdx] || "").trim() : "",
          recTel: parsedPhone,
          recMob: parsedPhone,
          qty: qtyIdx >= 0 ? row[qtyIdx] || "" : "",
          itemCode: itemCodeIdx >= 0 ? String(row[itemCodeIdx] || "").trim() : "",
          itemName: itemIdx >= 0 ? String(row[itemIdx] || "").trim() : "",
          msg: msgIdx >= 0 ? String(row[msgIdx] || "").trim() : "",
          sendName:
            sendNameIdx >= 0 && String(row[sendNameIdx] || "").trim()
              ? String(row[sendNameIdx] || "").trim()
              : vendorName,
          sendAddr: sendAddrIdx >= 0 ? String(row[sendAddrIdx] || "").trim() : "",
          sendTel: parsedSendPhone,
          uid: orderNum,
          date: today,
        });
        newRows.push(outRow);
        existingInvSet[inv] = true;
        collected++;
      }
    } catch (eTabLoop) {
      scannedLogs.push(
        "[사방넷주문-탭루프] " +
          vendorName +
          ": " +
          String(eTabLoop.message || eTabLoop),
      );
    }
  }

  scannedLogs.push(
    "[사방넷주문] 파일=" +
      filesFound +
      " 탭=" +
      tabsFound +
      " 8자리미만=" +
      shortInv +
      " 스캔=" +
      totalScanned +
      " 허브사용=" +
      skipUsed +
      " 중복=" +
      skipDup +
      " → 수집=" +
      collected,
  );

  // ⑤ 일괄 쓰기
  if (newRows.length > 0) {
    var writeStartRow = targetTab.getLastRow() + 1;
    _po_applyUnmatchedNumberFormats_(targetTab, writeStartRow, newRows.length, layout);
    targetTab
      .getRange(writeStartRow, 1, newRows.length, layout.headers.length)
      .setValues(newRows);
    scannedLogs.push(
      "★ 사방넷주문 송장 수집: " +
        newRows.length +
        "건 → " +
        _PO_UNMATCHED_TAB_NAME +
        " 탭 (롯데 열배열)",
    );
  }

  return newRows.length;
}

/**
 * 폐기송장 탭 onEdit 핸들러
 * A열(송장번호) 입력 시 협력업체_발주허브에서 해당 송장번호를 찾아
 * B열(판매처), C열(품목명), D열(수량), E열(수취인)을 자동 채움
 *
 * 데이터 소스: https://docs.google.com/spreadsheets/d/1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs/
 * 허브 헤더: [수집일시, 발주업체, 고유ID, 주문일자, 이카운트코드, 품목명, 수량, 수취인, ..., 송장번호(N열=14), 상태(O열=15)]
 */
function _po_onEditVoidInvoiceAutoFill_(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var sheetName = sheet.getName();

  // ★ 2026-06-18: 출고가능 동기화도 이 installable trigger에서 처리
  //   (별도 트리거 추가 시 트리거 개수 제한 초과 → 합침)
  if (sheetName === _PO_HUB_SHEET_NAME) {
    try { _po_onEditHubShipApproval_(e); } catch(eShip) {}
    return;
  }

  if (sheetName !== _PO_VOID_TAB_NAME && sheetName !== _PO_VOID_TAB_NAME_LEGACY) return;

  var row = e.range.getRow();
  var col = e.range.getColumn();
  // A열(1열), 2행 이상만 처리
  if (col !== 1 || row < 2) return;

  var inputInv = String(e.range.getValue() || "").trim();
  if (!inputInv) return;

  // 숫자만 추출한 키도 준비 (하이픈 포함 송장번호 대응)
  var inputDigits = inputInv.replace(/[^0-9]/g, "");

  try {
    var found = false;

    // ① 거래관리시스템 시트(외부)에서 검색 (installable onEdit에서 작동)
    try {
      var EXT_SHEET_ID = "1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs";
      var EXT_GID = 548505068; // 입력_로젠주문실적 탭
      var extSS = SpreadsheetApp.openById(EXT_SHEET_ID);
      var extTab = _pt_getSheetByGid(extSS, EXT_GID);
      if (extTab && extTab.getLastRow() >= 2) {
        found = _po_searchTradeSheetForInvoice_(
          extTab,
          sheet,
          row,
          inputInv,
          inputDigits,
        );
      }
    } catch (extErr) {
      // simple onEdit에서는 외부 시트 접근 불가 → 무시
      Logger.log("[VOID_AUTOFILL_EXT] " + String(extErr.message || extErr));
    }

    // ② 외부에서 못 찾으면 현재 시트 내부 허브도 폴백 탐색
    if (!found) {
      var hubTab =
        SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
          _PO_HUB_SHEET_NAME,
        );
      if (hubTab && hubTab.getLastRow() >= 2) {
        found = _po_searchHubForInvoice_(
          hubTab,
          sheet,
          row,
          inputInv,
          inputDigits,
        );
      }
    }

    // 매칭 안 됨 → B~E에 미확인 표시
    if (!found) {
      sheet.getRange(row, 2, 1, 4).setValues([["(미확인)", "", "", ""]]);
    }

    // G열(등록일시) 자동 기입
    if (!String(sheet.getRange(row, 7).getValue() || "").trim()) {
      sheet
        .getRange(row, 7)
        .setValue(
          Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        );
    }
  } catch (err) {
    // onEdit에서 시트 접근 실패 시 조용히 무시
    Logger.log("[VOID_AUTOFILL_ERR] " + String(err.message || err));
  }
}

/**
 * 거래관리시스템 시트(입력_로젠주문실적)에서 송장번호를 검색
 * 열 매핑:
 *   F열(6, idx5) = 운송장번호 (검색 대상)
 *   AB열(28, idx27) = 판매처 → 폐기송장 B열
 *   W열(23, idx22) = 품목명 → 폐기송장 C열
 *   Z열(26, idx25) = 수량   → 폐기송장 D열
 *   J열(10, idx9)  = 수취인 → 폐기송장 E열
 * @return {boolean} 매칭 성공 여부
 */
function _po_searchTradeSheetForInvoice_(
  tradeTab,
  voidSheet,
  row,
  inputInv,
  inputDigits,
) {
  var lr = tradeTab.getLastRow();
  var lc = Math.max(tradeTab.getLastColumn(), 28); // 최소 AB열(28)까지 읽기
  var data = tradeTab.getRange(2, 1, lr - 1, lc).getValues();
  // 0-based 인덱스: F=5, J=9, W=22, Z=25, AB=27

  for (var r = 0; r < data.length; r++) {
    var invCell = String(data[r][5] || "").trim(); // F열: 운송장번호
    if (!invCell) continue;

    var invDigits = invCell.replace(/[^0-9]/g, "");
    if (invCell === inputInv || invDigits === inputDigits) {
      // 매칭됨!
      var vendor = String(data[r][27] || "").trim(); // AB열: 판매처
      var item = String(data[r][22] || "").trim(); // W열: 품목명
      var qty = data[r][25] || ""; // Z열: 수량
      var recip = String(data[r][9] || "").trim(); // J열: 수취인

      voidSheet.getRange(row, 2, 1, 4).setValues([[vendor, item, qty, recip]]);
      return true;
    }
  }
  return false;
}

/**
 * 협력업체_발주허브에서 송장번호를 검색 (폴백용)
 * @return {boolean} 매칭 성공 여부
 */
function _po_searchHubForInvoice_(
  hubTab,
  voidSheet,
  row,
  inputInv,
  inputDigits,
) {
  var hubLr = hubTab.getLastRow();
  var hubData = hubTab.getRange(2, 1, hubLr - 1, 15).getValues();
  // 허브 인덱스(0-based): 1=발주업체, 5=품목명, 6=수량, 7=수취인, 13=송장번호(N열)

  for (var r = 0; r < hubData.length; r++) {
    var hubInvCell = String(hubData[r][13] || "").trim();
    if (!hubInvCell) continue;

    // 줄바꿈으로 구분된 다중 송장번호 지원
    var invLines = hubInvCell.split(/\n/);
    for (var li = 0; li < invLines.length; li++) {
      var hInv = invLines[li].trim();
      if (!hInv) continue;
      var hDigits = hInv.replace(/[^0-9]/g, "");
      if (hInv === inputInv || hDigits === inputDigits) {
        // 매칭됨!
        var vendor = String(hubData[r][1] || "").trim(); // 발주업체
        var item = String(hubData[r][5] || "").trim(); // 품목명
        var qty = hubData[r][6] || ""; // 수량
        var recip = String(hubData[r][7] || "").trim(); // 수취인

        voidSheet
          .getRange(row, 2, 1, 4)
          .setValues([[vendor, item, qty, recip]]);
        return true;
      }
    }
  }
  return false;
}

// ═══════════════════════════════════════════
//  폐기송장 자동 조회 installable onEdit 트리거
//  simple onEdit으로는 외부 시트 접근 불가 →
//  installable 트리거를 설치하면 외부 시트도 검색 가능
// ═══════════════════════════════════════════

var _PO_VOID_AUTOFILL_TRIGGER_FUNC = "_po_onEditVoidInvoiceAutoFill_";

/** 폐기송장 자동 조회 트리거 설치 */
function partnerSetupVoidAutoFillTrigger() {
  var ui = SpreadsheetApp.getUi();
  // 기존 트리거 제거
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PO_VOID_AUTOFILL_TRIGGER_FUNC) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  // 새 트리거 생성
  ScriptApp.newTrigger(_PO_VOID_AUTOFILL_TRIGGER_FUNC)
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  ui.alert(
    "✅ 폐기송장 자동 조회 트리거 설치 완료\n\n" +
      "이제 폐기송장 탭에 송장번호를 입력하면\n" +
      "외부 허브 시트에서도 정보를 자동으로 가져옵니다.\n" +
      (removed > 0 ? "(기존 트리거 " + removed + "개 교체)" : ""),
  );
}

/** 폐기송장 자동 조회 트리거 제거 */
function partnerRemoveVoidAutoFillTrigger() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PO_VOID_AUTOFILL_TRIGGER_FUNC) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  ui.alert(
    removed > 0
      ? "✅ 폐기송장 자동 조회 트리거 해제 (" + removed + "개 삭제)"
      : "ℹ️ 등록된 자동 조회 트리거 없음",
  );
}

/**
 * 외부 시트 A열 품목코드 중복 시 핑크색 조건부 서식 적용 (1회 실행)
 * 대상: https://docs.google.com/spreadsheets/d/1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk/
 * 탭 gid: 1023073346
 */
function applyDuplicateHighlightToTradeSheet() {
  var sheetId = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";
  var gid = 1023073346;

  var ss = SpreadsheetApp.openById(sheetId);
  var tab = _pt_getSheetByGid(ss, gid);
  if (!tab) {
    SpreadsheetApp.getUi().alert("❌ gid=" + gid + " 탭을 찾을 수 없습니다.");
    return;
  }

  var lr = Math.max(tab.getLastRow(), 1000);
  var range = tab.getRange("A2:A" + lr);

  // 기존 A열 중복 관련 조건부 서식 제거 (중복 적용 방지)
  var rules = tab.getConditionalFormatRules();
  var kept = [];
  for (var i = 0; i < rules.length; i++) {
    var ranges = rules[i].getRanges();
    var isOurRule = false;
    for (var ri = 0; ri < ranges.length; ri++) {
      if (
        ranges[ri].getColumn() === 1 &&
        ranges[ri].getA1Notation().indexOf("A") === 0
      ) {
        isOurRule = true;
        break;
      }
    }
    if (!isOurRule) kept.push(rules[i]);
  }

  // 새 조건부 서식: 빈 셀 제외 + A2:A 범위만 카운트 (헤더 제외)
  // =AND(A2<>"", COUNTIF(A$2:A, A2) > 1)
  var newRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($A2<>"", COUNTIF($A$2:$A, $A2) > 1)')
    .setBackground("#FFB6C1") // 핑크(Light Pink)
    .setRanges([range])
    .build();

  kept.push(newRule);
  tab.setConditionalFormatRules(kept);

  SpreadsheetApp.getUi().alert(
    "✅ 조건부 서식 적용 완료\n\n" +
      "탭: " +
      tab.getName() +
      "\n" +
      "범위: A2:A" +
      lr +
      "\n" +
      "규칙: A열 품목코드가 중복이면 핑크색 (빈 셀 제외)",
  );
}

// ═══════════════════════════════════════════
//  송장 수집 결과 HTML 다이얼로그 빌더
// ═══════════════════════════════════════════
function _po_buildInvoiceSummaryHtml_(matched, alreadyHas, noMatch, nonPartner, logs, unmatched) {
  var h = '<style>';
  h += 'body{font-family:"Noto Sans KR",sans-serif;margin:0;padding:20px;background:#f5f7fa;color:#222;font-size:13px}';
  // 카드 (70% 축소)
  h += '.summary{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}';
  h += '.card{flex:1;min-width:90px;padding:10px 8px;border-radius:8px;text-align:center;color:#fff;font-weight:600}';
  h += '.card .num{font-size:20px;display:block;margin-bottom:1px}';
  h += '.card .lbl{font-size:10px;opacity:.85}';
  h += '.c1{background:linear-gradient(135deg,#0ea5e9,#2563eb)}.c2{background:linear-gradient(135deg,#64748b,#475569)}';
  h += '.c3{background:linear-gradient(135deg,#f59e0b,#d97706)}.c4{background:linear-gradient(135deg,#10b981,#059669)}';
  // 섹션
  h += 'h3{margin:14px 0 6px;font-size:13px;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:4px}';
  // 로그 (확대)
  h += '.log-section{background:#fff;border-radius:8px;padding:14px;margin-bottom:10px;border:1px solid #e2e8f0;max-height:420px;overflow-y:auto}';
  h += '.log-line{padding:4px 0;border-bottom:1px solid #f1f5f9;font-size:12px;line-height:1.7}';
  h += '.log-line:last-child{border:0}';
  h += '.vendor{color:#2563eb;font-weight:600}';
  // 배지
  h += '.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;margin-right:4px}';
  h += '.b-ok{background:#dcfce7;color:#166534}.b-warn{background:#fef3c7;color:#92400e}.b-err{background:#fee2e2;color:#991b1b}';
  h += '.b-info{background:#dbeafe;color:#1e40af}.b-partner{background:#ede9fe;color:#5b21b6}.b-sbn{background:#fce7f3;color:#9d174d}';
  // 미매칭
  h += '.unmatch{background:#fff;border-radius:8px;padding:12px;border:1px solid #fca5a5;max-height:300px;overflow-y:auto}';
  h += '.unmatch-row{padding:4px 0;border-bottom:1px solid #fee2e2;font-size:12px}';
  h += '.unmatch-row:last-child{border:0}';
  // 버튼
  h += '.btn{display:block;width:120px;margin:18px auto 0;padding:10px 0;background:#2563eb;color:#fff;border:0;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600}';
  h += '.btn:hover{background:#1d4ed8}';
  h += '</style>';

  // 요약 카드
  h += '<div class="summary">';
  h += '<div class="card c1"><span class="num">' + matched + '</span><span class="lbl">매칭 성공</span></div>';
  h += '<div class="card c2"><span class="num">' + alreadyHas + '</span><span class="lbl">이미 입력됨</span></div>';
  h += '<div class="card c3"><span class="num">' + noMatch + '</span><span class="lbl">미매칭</span></div>';
  if (nonPartner > 0) {
    h += '<div class="card c4"><span class="num">' + nonPartner + '</span><span class="lbl">사방넷주문 수집</span></div>';
  }
  h += '</div>';

  // 스캔 로그
  h += '<h3>📋 스캔 로그</h3><div class="log-section">';
  for (var li = 0; li < logs.length; li++) {
    var line = String(logs[li] || "");
    var badge = "";

    // 명칭 치환: 비협력업체 → 사방넷주문, 비협력 임시탭 → 대리발송 임시탭
    line = line.replace(/비협력업체/g, "사방넷주문").replace(/비협력\s*임시탭/g, "대리발송 임시탭");

    if (line.indexOf("인식 성공") !== -1) {
      // "전용양식" 텍스트 제거, 업체명만 표시
      line = line.replace(/\/전용양식/g, "").replace(/\/[^\]]*전용양식[^\]]*/g, "");
      // 송장 건수 배지
      var invCnt = (line.match(/송장\s*(\d+)건/) || [])[1] || "0";
      badge = invCnt !== "0"
        ? '<span class="badge b-ok">송장 ' + invCnt + '건</span>'
        : '<span class="badge b-warn">송장 0건</span>';
      line = line.replace(/\[([^\]]+)\]/, '<span class="vendor">$1</span>');
    } else if (line.indexOf("★") !== -1) {
      badge = '<span class="badge b-info">핵심</span>';
    } else if (line.indexOf("실패") !== -1 || line.indexOf("오류") !== -1) {
      badge = '<span class="badge b-err">오류</span>';
    } else if (line.indexOf("필터링") !== -1 || line.indexOf("폐기") !== -1) {
      badge = '<span class="badge b-warn">필터</span>';
    }
    // 사방넷주문-탭 (구 비협력업체-탭) 상세 → 직원 친화적 표시
    if (line.indexOf("사방넷주문-탭") !== -1) {
      // 원본: "[사방넷주문-탭] 올팩/올팩 전용양식 행=1 invIdx=0 nameIdx=7 nameVal=조성우 헤더=..."
      // 변환: "올팩 — 1건 스캔 완료 (첫 수취인: 조성우)"
      var vmParts = line.match(/사방넷주문-탭\]\s*(.+?)\s+행=(\d+)/);
      var vmName = line.match(/nameVal=(.+?)(?:\s+헤더=|\s*$)/);
      var vLabel = "";
      var vRows = vmParts ? vmParts[2] : "?";
      if (vmParts) {
        var vendorTabName = vmParts[1]; // "올팩/올팩 전용양식" 또는 "냅킨코리아/전용양식"
        vLabel = vendorTabName.split("/")[0]; // "/" 앞 = 업체명
      }
      var vFirst = vmName ? vmName[1].trim() : "";
      if (vFirst === "(빈)") vFirst = "";
      badge = '<span class="badge b-partner">협력업체</span>';
      line = '<span class="vendor">' + vLabel + '</span> — ' +
        vRows + '건 스캔 완료' +
        (vFirst ? ' <span style="color:#64748b">(첫 수취인: ' + vFirst + ')</span>' : '');
    }
    // 대리발송 임시탭 라인
    if (line.indexOf("대리발송 임시탭") !== -1 || line.indexOf("임시탭→") !== -1) {
      badge = '<span class="badge b-sbn">대리발송</span>';
    }

    h += '<div class="log-line">' + badge + line + '</div>';
  }
  h += '</div>';

  // 미매칭 상세
  if (unmatched && unmatched.length > 0) {
    h += '<h3>⚠️ 미매칭 상세 (' + unmatched.length + '건)</h3>';
    h += '<div class="unmatch">';
    for (var ui2 = 0; ui2 < unmatched.length; ui2++) {
      h += '<div class="unmatch-row">🔸 ' + String(unmatched[ui2] || "") + '</div>';
    }
    h += '</div>';
  }

  if (matched > 0) {
    h += '<div style="margin-top:14px;padding:10px;background:#dcfce7;border-radius:8px;text-align:center;color:#166534;font-weight:600">';
    h += '✅ \'③ 송장 배포\'를 실행하면 각 협력업체 시트에 반영됩니다.</div>';
  }

  h += '<button class="btn" onclick="google.script.host.close()">확인</button>';
  return h;
}

// ═══════════════════════════════════════════════════════════════════
//  [onEdit] 허브 상태열 → 업체 발주탭 상태 동기화
//  ★ 2026-06-17: 출고가능 동기화
//  ★ 2026-08-05: 품절 확정·다중셀
//  ★ 2026-08-25: 품절임박 드롭다운·N열 안내 부착 제거 (상태 동기화만 수행)
// ═══════════════════════════════════════════════════════════════════
function _po_onEditHubShipApproval_(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== _PO_HUB_SHEET_NAME) return;

  var statusCol = _po_findHubHeaderCol_(sheet, ["상태"], 15);
  var col = e.range.getColumn();
  var numCols = e.range.getNumColumns();
  if (col > statusCol || col + numCols - 1 < statusCol) return;

  var startRow = e.range.getRow();
  var numRows = e.range.getNumRows();
  if (startRow < 2) {
    var skip = 2 - startRow;
    if (skip >= numRows) return;
    startRow = 2;
    numRows = numRows - skip;
  }

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return;
  try {
    _po_syncHubStatusEdits_(sheet, startRow, numRows);
  } finally {
    try { lock.releaseLock(); } catch (eL) {}
  }
}

/**
 * 허브 상태열 편집 행 처리
 * - 품절임박: 발주탭 상태 동기화
 * - 출고가능/품절: 잔여 드롭다운·N열 안내 제거 + 발주탭 동기화
 */
function _po_syncHubStatusEdits_(sheet, startRow, numRows) {
  var statusCol = _po_findHubHeaderCol_(sheet, ["상태"], 15);
  var invCol = _po_findHubHeaderCol_(sheet, ["송장"], 14);
  var width = Math.max(statusCol, invCol, 15);
  var values = sheet.getRange(startRow, 1, numRows, width).getValues();
  var jobs = [];
  var clearDvRows = [];
  var clearPhRows = [];

  for (var i = 0; i < values.length; i++) {
    var sheetRow = startRow + i;
    var rawSt = String(values[i][statusCol - 1] || "").trim();
    var uid = String(values[i][2] || "").trim();
    var vendor = String(values[i][1] || "").trim();
    var inv = String(values[i][invCol - 1] || "").trim();

    var isImminent = _po_isStockImminentStatus_(rawSt);
    var isApprove = _po_isShipApprovedStatus_(rawSt);
    var isSoldOut = _po_isSoldOutConfirmStatus_(rawSt);

    // ── 품절임박: 상태만 발주탭에 동기화 ──
    // ★ 2026-08-25: 드롭다운 부착·주황배경·N열 안내·O열 강제 정규화 제거.
    //   운영자가 입력한 표기를 그대로 두고 업체 발주탭에만 반영한다.
    if (isImminent) {
      if (uid) {
        jobs.push({ row: sheetRow, uid: uid, vendor: vendor, status: rawSt });
      }
      continue;
    }

    // ── 출고가능 / 품절 확정: 잔여 드롭다운·안내 제거 + 발주탭 동기화 ──
    if (!isApprove && !isSoldOut) continue;

    var normSt = rawSt;
    if (isApprove && rawSt.indexOf("✅") === -1) {
      normSt = "✅출고가능";
      try { sheet.getRange(sheetRow, statusCol).setValue(normSt); } catch (eN) {}
    } else if (isSoldOut && rawSt.indexOf("🚨") === -1 && rawSt.indexOf("품절임박") === -1) {
      normSt = "🚨품절";
      try { sheet.getRange(sheetRow, statusCol).setValue(normSt); } catch (eN2) {}
    }

    if (_po_isInvPlaceholder_(inv)) {
      try { sheet.getRange(sheetRow, invCol).setValue(""); } catch (ePh) {}
      clearPhRows.push(sheetRow);
    }
    clearDvRows.push(sheetRow);

    if (!uid) continue;
    jobs.push({
      row: sheetRow,
      uid: uid,
      vendor: vendor,
      status: normSt,
    });
  }

  if (clearDvRows.length) {
    try { _po_clearStockWarnDropdownRows_(sheet, clearDvRows); } catch (eDv) {}
  }
  if (!jobs.length) return;

  var pushRes = _po_pushHubStatusesToVendors_(jobs);
  var synced = pushRes.synced || 0;
  var formulaSkip = pushRes.formulaSkip || 0;

  try {
    var msg =
      "상태 동기화 " + synced + "건" +
      (formulaSkip ? " / 수식모드 스킵 " + formulaSkip + "건" : "") +
      (clearPhRows.length ? " / N열 안내문구 삭제 " + clearPhRows.length + "건" : "");
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, "허브 상태동기화", 4);
  } catch (eToast) {}
}

/**
 * 허브 상태 jobs[{uid,vendor,status}] → 업체 발주탭 상태 열 동기화
 * @returns {{synced:number, formulaSkip:number}}
 */
function _po_pushHubStatusesToVendors_(jobs) {
  var result = { synced: 0, formulaSkip: 0 };
  if (!jobs || !jobs.length) return result;

  var byVendor = {};
  for (var j = 0; j < jobs.length; j++) {
    var vn = jobs[j].vendor || "_UNKNOWN_";
    if (!byVendor[vn]) byVendor[vn] = [];
    byVendor[vn].push(jobs[j]);
  }

  var files = _pt_listFiles();
  if (!files || !files.length) return result;

  for (var vnKey in byVendor) {
    if (!byVendor.hasOwnProperty(vnKey)) continue;
    var group = byVendor[vnKey];
    var uidMap = {};
    for (var g = 0; g < group.length; g++) {
      if (group[g].uid) uidMap[group[g].uid] = group[g].status;
    }

    var candidates = [];
    var rest = [];
    for (var fi = 0; fi < files.length; fi++) {
      if (vnKey !== "_UNKNOWN_" && files[fi].name.indexOf(vnKey) !== -1) {
        candidates.push(files[fi]);
      } else {
        rest.push(files[fi]);
      }
    }
    candidates = candidates.concat(rest);

    var remaining = Object.keys(uidMap).length;
    for (var ci = 0; ci < candidates.length && remaining > 0; ci++) {
      try {
        var ss = SpreadsheetApp.openById(candidates[ci].id);
        var targetTab = ss.getSheetByName("발주 및 송장조회");
        var collectTabs = [];
        if (targetTab) {
          collectTabs.push(targetTab);
        } else {
          var allTabs = ss.getSheets();
          for (var ti = 0; ti < allTabs.length; ti++) {
            if (_po_isOrderTab(allTabs[ti].getName())) collectTabs.push(allTabs[ti]);
          }
        }

        for (var t2 = 0; t2 < collectTabs.length && remaining > 0; t2++) {
          var tab = collectTabs[t2];
          var lr = tab.getLastRow();
          if (lr <= 1) continue;
          var lc = Math.max(tab.getLastColumn(), 14);
          var data = tab.getRange(1, 1, lr, lc).getValues();
          var cMap = _po_buildColMap(data[0]);
          if (cMap.uniqueId === -1 || cMap.status === -1) continue;

          var stHdrF = "";
          try { stHdrF = String(tab.getRange(1, cMap.status + 1).getFormula() || ""); } catch (_) {}
          if (stHdrF) {
            result.formulaSkip += remaining;
            remaining = 0;
            break;
          }

          for (var r = 1; r < data.length && remaining > 0; r++) {
            var rowUid = String(data[r][cMap.uniqueId] || "").trim();
            if (!rowUid || uidMap[rowUid] == null) continue;
            tab.getRange(r + 1, cMap.status + 1).setValue(uidMap[rowUid]);
            delete uidMap[rowUid];
            remaining--;
            result.synced++;
          }
        }
      } catch (eSync) {}
    }
  }
  return result;
}

var _PO_SHIP_APPROVAL_TRIGGER_FUNC = "_po_onEditHubShipApproval_";

/** 출고가능/품절 동기화 트리거 설치 */
function partnerSetupShipApprovalTrigger() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PO_SHIP_APPROVAL_TRIGGER_FUNC) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  ScriptApp.newTrigger(_PO_SHIP_APPROVAL_TRIGGER_FUNC)
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  ui.alert(
    "✅ 허브 상태 동기화 트리거 설치 완료\n\n" +
      "허브 O열에 ✅출고가능 / 🚨품절 / 🟡품절임박 을 입력하면\n" +
      "업체 발주탭 상태에 즉시 반영됩니다.\n" +
      "(드롭다운 없이 직접 입력하거나 붙여넣으면 됩니다)\n" +
      (removed > 0 ? "(기존 트리거 " + removed + "개 교체)" : "")
  );
}

/** 출고가능/품절 동기화 트리거 제거 */
function partnerRemoveShipApprovalTrigger() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === _PO_SHIP_APPROVAL_TRIGGER_FUNC) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  ui.alert(
    removed > 0
      ? "✅ 허브 상태 동기화 트리거 해제 (" + removed + "개 삭제)"
      : "ℹ️ 등록된 허브 상태 동기화 트리거 없음"
  );
}
