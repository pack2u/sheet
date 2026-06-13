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
    var hRange = hubTab.getRange("A2:Q5000");
    var rules = [];
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=ISNUMBER(SEARCH("품절", $O2))')
        .setBackground("#f4cccc")
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
    var existing = hubTab.getConditionalFormatRules() || [];
    hubTab.setConditionalFormatRules(rules.concat(existing));
  } catch (e) {}
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
/**
 * @param {boolean} [opt_noWriteBack] - true이면 허브 수집은 하되 업체시트에 "접수완료" 역기록 안 함
 *   (자동 트리거 전용)
 */
function partnerCollectOrders(opt_noWriteBack) {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}

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

  for (var fi = 0; fi < files.length; fi++) {
    var file = files[fi];
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

      var allTabs = ss.getSheets();
      for (var ti = 0; ti < allTabs.length; ti++) {
        var tabName = allTabs[ti].getName();
        if (!_po_isOrderTab(tabName)) continue;

        // ★ 2차 안전장치: 전용양식 헤더 감지 → 전용양식 데이터 수집 차단
        //   전용양식 탭에만 존재하는 특징적 헤더 조합을 감지하여 스킵
        var tab = allTabs[ti];
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
        // ★ =FALSE 유효성 검사 정리 (setValues 충돌 방지)
        try { _pt_cleanupStrayValidations_(tab); } catch (eCV) {}

        // ★ "상태(자동)" 열 누락 시 자동 보수 (14열=N열)
        if (cMap.status === -1) {
          try {
            var expectedStatusCol = data[0].length; // 마지막 열 다음
            // 기본 헤더 14열(N열) 위치에 넣기 (0-based=13)
            if (expectedStatusCol <= 13) expectedStatusCol = 13;
            tab
              .getRange(1, expectedStatusCol + 1)
              .setValue("상태(자동)")
              .setBackground("#1f4e78")
              .setFontColor("white")
              .setFontWeight("bold");
            // data 재로드
            lc = Math.max(tab.getLastColumn(), expectedStatusCol + 1);
            data = tab.getRange(1, 1, lr, lc).getValues();
            cMap = _po_buildColMap(data[0]);
            Logger.log(
              "[COLLECT] 상태(자동) 열 자동 추가: " +
                file.name +
                " / " +
                tabName,
            );
          } catch (eStatus) {}
        }

        // 날짜·코드 모두 없어도 품목명/수량/수취인 중 하나라도 있으면 수집 시도
        var hasMinFields =
          cMap.item !== -1 || cMap.qty !== -1 || cMap.recipient !== -1;
        if (cMap.date === -1 && cMap.code === -1 && !hasMinFields) continue;

        // ── spill 수식 자동복구 ──
        if (viewerTabForHeal) {
          try {
            _pt_healOrderSpillFormulas(tab, viewerTabForHeal.getName());
          } catch (eH) {}
        }

        // ── 주문일자 자동채움 ──
        var dateFillChanged = false;
        var codeFillChanged = false;
        var idFillChanged = false;
        var statusFillChanged = false;
        if (cMap.date !== -1) {
          var filled = _pt_backfillMissingOrderDates(data, cMap);
          if (filled > 0) dateFillChanged = true;
        }

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

          // ★ 필수 필드 검증 — 원본 값 기준 (backfill 값이 아닌 실제 입력 값으로 체크)
          //   backfill로 이전 행 정보가 이어져도, 실제 입력이 없으면 미완으로 판정
          var qty = cMap.qty !== -1 ? data[r][cMap.qty] : "";
          var qtyStr = String(qty || "").trim();
          var missingFields = [];
          if (!_origRecipient) missingFields.push("\uc218\ucde8\uc778");
          if (!_origPhone)  missingFields.push("\uc804\ud654\ubc88\ud638");
          if (!_origAddr)       missingFields.push("\uc8fc\uc18c");
          if (!qtyStr || qtyStr === "0") missingFields.push("\uc218\ub7c9");
          if (missingFields.length > 0) {
            if (cMap.status !== -1) {
              var missingMsg = "\u26a0\ufe0f\uc785\ub825\ubbf8\uc644(" + missingFields.join(",") + ")";
              if (String(data[r][cMap.status] || "").trim() !== missingMsg) {
                data[r][cMap.status] = missingMsg;
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

          // ★ 수집 제외 상태: 품절임박 (재고 부족 예고 상태 — 발주 접수 불가)
          if (stCompact.indexOf("품절임박") !== -1) {
            skippedByStatusFlag++;
            skipped++;
            continue;
          }

          var wasStockWarn =
            stCompact.indexOf("재고부족") !== -1 ||
            stCompact.indexOf("🚨") !== -1;
          var status =
            stCompact.indexOf("취소") !== -1 ||
            stCompact.indexOf("발송완료") !== -1
              ? rawSt
              : "접수완료";

          if (priceMap[code]) {
            var ps = priceMap[code].status.replace(/\s/g, "");
            if (ps.indexOf("단종") !== -1) status = "🚨단종";
            else if (ps.indexOf("품절") !== -1 && ps.indexOf("품절+7") === -1)
              status = "🚨품절";
            else if (wasStockWarn) status = "접수완료"; // 재고 복구 시 초기화
          }
          if (noCodeWarning) status = "🔴코드확인필요";
          // 코드오류: 코드가 있지만 뷰어(단가조회)에 없는 경우 — 취소/발송완료는 유지
          if (
            codeNotInViewer &&
            stCompact.indexOf("취소") === -1 &&
            stCompact.indexOf("발송완료") === -1
          ) {
            status = "🚨코드오류";
          }

          // ★ 상태는 업체 시트에 아직 쓰지 않음 → 허브 수집 성공 후 기록
          // 품절/단종/코드확인필요는 즉시 기록 (수집 여부와 무관한 경고)
          var isWarningStatus =
            status.indexOf("🚨") !== -1 || status.indexOf("🔴") !== -1;
          if (isWarningStatus && cMap.status !== -1 && rawSt !== status) {
            data[r][cMap.status] = status;
            statusFillChanged = true;
          }

          // 품절, 단종 등 경고 상태인 경우 허브로 수집하지 않고 스킵
          if (isWarningStatus) {
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
            "",
            status,
          ]);

          // ★ 허브 수집 성공 후 업체 시트에 "접수완료"를 기록하기 위한 deferred 큐
          if (!isWarningStatus && cMap.status !== -1 && rawSt !== status) {
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
          if (statusFillChanged && cMap.status !== -1) {
            var sVals = [];
            for (var rs = 1; rs < data.length; rs++)
              sVals.push([data[rs][cMap.status]]);
            tab.getRange(2, cMap.status + 1, batchRows, 1).setValues(sVals);
          }
        }
      } // end tabs
    } catch (e) {
      errors.push(file.name + ": " + e.message);
    }
  } // end files

  // ── 허브에 신규 발주 일괄 추가 ──
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

  var msg =
    "📦 발주 수집 완료\n- 파일: " +
    files.length +
    "개\n- 신규: " +
    newOrders.length +
    "건\n- 스킵: " +
    skipped +
    "건" +
    (skippedByStatusFlag > 0
      ? "\n  ⚠ 품절임박 상태로 제외: " + skippedByStatusFlag + "건"
      : "") +
    (skippedByCodeErr > 0
      ? "\n  ⚠ 코드오류(뷰어 미등록) 제외: " +
        skippedByCodeErr +
        "건 — 발주탭 적요에 🚨코드오류 기재됨"
      : "") +
    (skippedByMissing > 0
      ? "\n  ⚠ 필수정보 미입력 제외: " + skippedByMissing + "건 (수취인/전화/주소/수량)"
      : "") +
    (errors.length ? "\n- 오류:\n" + errors.join("\n") : "");
  Logger.log(msg);
  // ★ Google Chat 알림
  try { _chat_notifyCollectOrders_(newOrders.length, skipped, errors); } catch (eChat) {}
  if (ui) ui.alert(msg);
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

  // 일괄 업데이트
  for (var i = 0; i < priceUpdates.length; i++) {
    hubTab
      .getRange(priceUpdates[i].row, PRICE_COL)
      .setValue(priceUpdates[i].val);
  }
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
 * ★ 적요(M열)에 이미 내용이 있는 행은 송장수집 패스
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
  try {
    var pFiles = _pt_listFiles();
    for (var pfi = 0; pfi < pFiles.length; pfi++) {
      try {
        var pss = SpreadsheetApp.openById(pFiles[pfi].id);
        var ptabs = pss.getSheets();
        for (var pti = 0; pti < ptabs.length; pti++) {
          var ptName = ptabs[pti].getName();
          // ★ 전용양식 탭만 대상 (발주탭·뷰어·단가조회·설정·마감 등 제외)
          // 발주탭, 뷰어탭, 단가조회, 설정, 마감 탭은 확실하게 제외
          if (
            ptName.indexOf("발주 및 송장조회") !== -1 ||
            ptName.indexOf("뷰어") !== -1 ||
            ptName.indexOf("단가조회") !== -1 ||
            ptName.indexOf("설정") !== -1 ||
            ptName.indexOf("마감") !== -1
          ) {
            continue;
          }
          // 그 외에 '전용양식' 또는 '송장' 또는 '양식'이 포함되어 있으면 수집 대상으로 판단
          if (
            ptName.indexOf("전용양식") === -1 &&
            ptName.indexOf("송장") === -1 &&
            ptName.indexOf("양식") === -1
          ) {
            continue;
          }
          var ptab = ptabs[pti];
          var ptLr = ptab.getLastRow();
          if (ptLr <= 1) continue;
          var ptLc = Math.max(ptab.getLastColumn(), 50); // AX열(50) 고유ID 포함 보장
          // ★ 데이터 1회만 읽기 → invoiceMap 인제스트 + 비협력업체 수집 공유
          var ptData = ptab.getRange(1, 1, ptLr, ptLc).getValues();
          var vendorLabelForLog =
            pFiles[pfi].name.replace("[협력업체] ", "") + "/" + ptName;
          var vendorN = pFiles[pfi].name.replace("[협력업체] ", "").trim();
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
            pFiles[pfi].name +
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
  var hubData = hubTab
    .getRange(2, 1, hubLr - 1, _PO_HUB_HEADERS.length)
    .getValues();
  var matched = 0,
    alreadyHas = 0,
    noMatch = 0;
  var writeUpdates = []; // {row, inv, status, writeInvoice}
  var globalUsedInvoices = {};
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
    if (String(hubData[_hr][13] || "").trim()) continue; // 이미 입력된 행 스킵
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
    if (existingInv0) {
      alreadyHas++;
      continue;
    }
    if (isTerminalOrderStatus_(String(hubData[r][14] || ""))) continue;
    if (String(hubData[r][14] || "").trim() === "발송완료") continue;
    // ★ 적요(M열=12)에 내용이 있으면 송장수집 패스
    var existingMemo0 = String(hubData[r][12] || "").trim();
    if (existingMemo0) continue;

    var hubUid = String(hubData[r][2] || "").trim();
    if (!hubUid) continue; // 고유ID 없으면 이 패스에서 스킵 (name+phone으로 넘김)

    // invoiceMap에서 고유ID로 직접 조회
    if (invoiceMap[hubUid]) {
      var uidCandidates = parseInvoiceLinesFromMatchedRows_(
        invoiceMap[hubUid],
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
              hubUid +
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
                hubUid +
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
      for (var ci = 0; ci < cGrpRows.length; ci++) {
        var cInv = String(hubData[cGrpRows[ci]][13] || "").trim();
        if (cInv) { sourceInv = cInv; break; }
      }
      if (!sourceInv) continue; // 그룹 내 송장 없음

      // 송장 없는 행에 동일 송장 복사 → 합배송
      for (var ci2 = 0; ci2 < cGrpRows.length; ci2++) {
        var ridx = cGrpRows[ci2];
        var existInv = String(hubData[ridx][13] || "").trim();
        if (existInv) continue;
        if (isTerminalOrderStatus_(String(hubData[ridx][14] || ""))) continue;

        hubData[ridx][13] = sourceInv;
        writeUpdates.push({
          row: ridx + 2,
          inv: sourceInv,
          status: "합배송",
          writeInvoice: true,
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
    if (existingInv) continue; // 이미 송장 있음
    if (isTerminalOrderStatus_(String(hubData[r][14] || ""))) continue;
    var st = String(hubData[r][14] || "").trim();
    if (st === "발송완료") continue;
    // ★ 적요(M열=12)에 내용이 있으면 송장수집 패스
    var existingMemoG = String(hubData[r][12] || "").trim();
    if (existingMemoG) continue;

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
      writeUpdates.push({
        row: repIdx + 2,
        inv: invCell,
        setDetail: detailCell,
        status: "발송완료",
        writeInvoice: true,
      });
      assignedRep.push({
        idx: repIdx,
        uid: String(hubData[repIdx][2] || "").trim(),
        inv: invCell,
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
        if (String(hubData[otherIdx][13] || "").trim()) continue;
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
        });
      }
    }
  }

  // ── [2차] 미매칭 그룹 재검색: 전화번호 단독만 허용 (이름 단독 매칭 제거) ──
  // ★ 같은 이름이 여러 주문이 있을 때 오매칭 방지를 위해 이름 단독 매칭 완전 제거
  var pass2Matched = 0;
  for (var ug = 0; ug < unmatchedGroups.length; ug++) {
    var uGroup = unmatchedGroups[ug];
    var uRows = uGroup.rows;

    var mergedMatched2 = [];
    for (var gx2 = 0; gx2 < uRows.length; gx2++) {
      var ri2 = uRows[gx2];
      var ph2 = String(hubData[ri2][8] || "").replace(/[^0-9]/g, "");

      // 전화번호 단독 (유일하게 허용되는 2차 매칭)
      if (ph2.length >= 8) {
        var phKey2 = "PH_" + ph2;
        if (invoiceMap[phKey2])
          mergedMatched2 = mergedMatched2.concat(invoiceMap[phKey2]);
      }
      // ★ 이름 단독 매칭 완전 제거 — 동명이인 오매칭 방지
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
      writeUpdates.push({
        row: ri2b + 2,
        inv: inv2,
        setDetail: detailCell2,
        status: "발송완료",
        writeInvoice: true,
      });
      assigned2.push({
        idx: ri2b,
        uid: String(hubData[ri2b][2] || "").trim(),
        inv: inv2,
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
        if (String(hubData[oi2][13] || "").trim()) continue;
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
        });
      }
    }
  }
  scannedLogs.push("2차 재검색 매칭: " + pass2Matched + "건");

  // ── ★ 성능최적화: 허브 일괄 쓰기 (배치) ──
  // 기존: 매 건마다 setValue(송장) + setValue(상태) + setValue(적요) = 행당 2~3 API 호출
  // 개선: hubData 배열에 사전 반영 → setValues() 1회 일괄 쓰기
  var hubChanged = false;
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
    } catch (eW) {}
  }
  if (hubChanged) {
    // ★ 변경된 행만 M(적요)/N(송장번호)/O(상태) 개별 업데이트
    //   전체 setValues는 허브에 잘못 설정된 유효성 검사와 충돌 가능하므로 제거
    for (var wi2 = 0; wi2 < writeUpdates.length; wi2++) {
      var upd2 = writeUpdates[wi2];
      var hubIdx2 = upd2.row - 2;
      if (hubIdx2 < 0 || hubIdx2 >= hubData.length) continue;
      try {
        if (upd2.writeInvoice) {
          hubTab.getRange(upd2.row, 14).setValue(hubData[hubIdx2][13]);  // N열: 송장번호
        }
        if (upd2.status) {
          hubTab.getRange(upd2.row, 15).setValue(hubData[hubIdx2][14]);  // O열: 상태
        }
        var memoVal = String(hubData[hubIdx2][12] || "").trim();
        if (memoVal) {
          hubTab.getRange(upd2.row, 13).setValue(memoVal);  // M열: 적요
        }
      } catch (eW2) {}
    }
    SpreadsheetApp.flush();
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
              srcTab.getRange(sr + 1, srcInvCol + 1).setValue(inv);
              proxyWriteCount++;
            }
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
    _po_checkNonPartnerTempTabMatches_(invoiceMap, scannedLogs, hubInvoiceByKey);
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
    (unmatchedCollectCount > 0
      ? "- 비협력업체 수집: " + unmatchedCollectCount + "건\n"
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

  // 허브 데이터 (헤더 인덱스: 고유ID=2, 송장번호=13, 상태=14)
  var hubData = hubTab
    .getRange(2, 1, lastRow - 1, _PO_HUB_HEADERS.length)
    .getValues();

  // ★ 폐기송장 목록 로드 → 배포 시 폐기 송장 제외
  var voidSet = _po_loadVoidInvoiceSet_();

  // 배포 대상:
  //   ① 송장번호 있는 행 → 송장 + 발송완료 상태 + 적요 배포
  //   ② 송장번호 없어도 적요에 내용 있는 행 → 적요만 배포 (상태 변경 없음)
  // 예외: 취소/불용/반품/폐기 상태 제외, 폐기송장 목록에 있는 송장 제외
  var pendingByUid = {};
  for (var i = 0; i < hubData.length; i++) {
    var uid = String(hubData[i][2] || "").trim();
    var invoice = String(hubData[i][13] || "").trim();
    var status = String(hubData[i][14] || "").trim();
    var hubMemo = String(hubData[i][12] || "").trim(); // M열=적요
    if (!uid) continue;
    if (!invoice && !hubMemo) continue; // 송장도 적요도 없으면 스킵
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
      invoice: invoice,         // 빈 문자열이면 송장 없음
      status: status,
      hubRow: i + 2,
      hubMemo: hubMemo,
      memoOnly: !invoice,       // 적요만 배포하는 경우 (상태 변경 없음)
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
      var allTabs = ss.getSheets();

      for (var ti = 0; ti < allTabs.length; ti++) {
        var tabName = allTabs[ti].getName();
        if (!_po_isOrderTab(tabName)) continue;

        var tab = allTabs[ti];
        var lr = tab.getLastRow();
        if (lr <= 1) continue;
        var lc = Math.max(tab.getLastColumn(), 14);
        var data = tab.getRange(1, 1, lr, lc).getValues();
        var cMap = _po_buildColMap(data[0]);
        // ★ =FALSE 유효성 검사 정리 (setValues 충돌 방지)
        try { _pt_cleanupStrayValidations_(tab); } catch (eCV) {}

        // ★ "상태(자동)" 열 누락 시 자동 보수
        if (cMap.status === -1) {
          try {
            var stCol = data[0].length <= 13 ? 13 : data[0].length;
            tab
              .getRange(1, stCol + 1)
              .setValue("상태(자동)")
              .setBackground("#1f4e78")
              .setFontColor("white")
              .setFontWeight("bold");
            lc = Math.max(tab.getLastColumn(), stCol + 1);
            data = tab.getRange(1, 1, lr, lc).getValues();
            cMap = _po_buildColMap(data[0]);
          } catch (e) {}
        }

        if (cMap.uniqueId === -1) continue;

        var invCol = _po_findInvoiceCol(data[0]);
        var tabChanged = false;
        var cellUpdates = []; // ★ 개별 셀 업데이트 목록 {row, col, value}

        for (var r = 1; r < data.length; r++) {
          var rowUid = String(data[r][cMap.uniqueId] || "").trim();
          if (!rowUid || !pendingByUid[rowUid]) continue;

          var p = pendingByUid[rowUid];
          var curInv =
            invCol !== -1 ? String(data[r][invCol] || "").trim() : "";
          var curSt =
            cMap.status !== -1 ? String(data[r][cMap.status] || "").trim() : "";

          if (p.memoOnly) {
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
            if (!stSame && cMap.status !== -1) {
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
            hubStatusRows.push(p.hubRow);
            pushed++;
          }
        }
        // ★ 변경된 셀만 개별 기록 — ARRAYFORMULA(D열 품목명, A열 거래처명, L열 단가) 보호
        if (tabChanged && cellUpdates.length > 0) {
          for (var cu = 0; cu < cellUpdates.length; cu++) {
            tab.getRange(cellUpdates[cu].row, cellUpdates[cu].col).setValue(cellUpdates[cu].value);
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
  var defaultH = [
    "거래처명(자동)",
    "주문일자(자동)",
    "이카운트코드",
    "품목명",
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
      var cMap = _po_buildColMap(curHeaders);
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

      // ★ 항상 1행 헤더 덮어쓰기 (단순 텍스트 변경도 반영)
      ot.getRange(1, 1, 1, defaultH.length).setValues([defaultH]);
      ot.getRange("1:1")
        .setBackground("#1f4e78")
        .setFontColor("white")
        .setFontWeight("bold");
      ot.setFrozenRows(1);

      // spill 수식 재연결 (A열=거래처명, L열=정산금액)
      try {
        var viewerTab = null;
        var tabs = ss.getSheets();
        for (var ti = 0; ti < tabs.length; ti++) {
          if (tabs[ti].getName().indexOf("뷰어") !== -1) {
            viewerTab = tabs[ti];
            break;
          }
        }
        if (viewerTab && typeof _pt_injectOrderSpillFormulas === "function") {
          _pt_injectOrderSpillFormulas(ot, viewerTab.getName());
        }
      } catch (eSpill) {}
      _pt_applyOrderTabDesign(ot);
      results.push(
        files[i].name +
          ": ✅ 헤더 갱신" +
          (needForceRepair ? " (전용양식→표준 강제복구)" : ""),
      );
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
  var aFixed = 0,
    lFixed = 0,
    aa1Fixed = 0,
    skipped = 0,
    errors = [];

  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var ot = ss.getSheetByName("발주 및 송장조회");
      if (!ot) {
        skipped++;
        continue;
      }

      // L열 헤더 보정 (기존 "정산금액" → "단가")
      var lHeader = String(ot.getRange(1, 12).getValue() || "").trim();
      if (lHeader === "정산금액") {
        ot.getRange(1, 12).setValue("단가");
      }

      // ★ AA1 거래처명 수식 보정 (단가조회/뷰어 탭)
      var viewerTab = _pt_findViewerSheet(ss);
      var viewerName = viewerTab ? viewerTab.getName() : "단가조회";
      try {
        if (viewerTab) {
          var aa1F = String(viewerTab.getRange("AA1").getFormula() || "");
          var aa1V = String(viewerTab.getRange("AA1").getValue() || "").trim();
          // AA1 수식이 없거나 #REF! 에러인 경우 → 설정탭 B5 참조로 재설정
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

      // A열 + L열 스필 수식 heal (파괴 감지 → 자동 재생성)
      var result = _pt_healOrderSpillFormulas(ot, viewerName);
      if (result.aFixed) aFixed++;
      if (result.lFixed) lFixed++;
      if (!result.aFixed && !result.lFixed) skipped++;
    } catch (e) {
      errors.push(files[i].name + ": " + e.message);
    }
  }

  var msg =
    "🔄 발주탭 스필 수식 복구 완료\n" +
    "- A열(거래처명) 수정: " +
    aFixed +
    "개\n" +
    "- L열(단가) 수정: " +
    lFixed +
    "개\n" +
    "- AA1(뷰어 거래처명) 보정: " +
    aa1Fixed +
    "개\n" +
    "- 이미 정상: " +
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
/** ★ 자동 트리거: 허브 수집만 하고 "접수완료" 역기록 안 함 (opt_noWriteBack=true) */
function partnerCollectOrdersSilent_() {
  // ① 발주 수집 (협력업체 발주탭 → 허브) — 업체시트에 "접수완료" 역기록 안 함
  try {
    partnerCollectOrders(true); // noWriteBack=true
  } catch (e) {
    try {
      Logger.log("[PARTNER_COLLECT_TRIGGER_ERR] " + String(e.message || e));
    } catch (_) {}
  }
  // ② 대리발주 Push (프로퍼티 ON일 때만 실행)
  try {
    var pepEnabled =
      PropertiesService.getScriptProperties().getProperty("PEP_AUTO_PUSH") ||
      "OFF";
    if (
      pepEnabled === "ON" &&
      typeof partnerPushOrdersToExclusiveFormsSilent_ === "function"
    ) {
      partnerPushOrdersToExclusiveFormsSilent_();
    }
  } catch (e) {
    try {
      Logger.log("[PARTNER_EXCL_PUSH_TRIGGER_ERR] " + String(e.message || e));
    } catch (_) {}
  }
  // ③ 폐기송장 적용 (폐기송장 탭에 등록된 송장번호를 허브에서 자동 제거)
  try {
    if (typeof partnerApplyVoidedInvoicesSilent_ === "function")
      partnerApplyVoidedInvoicesSilent_();
  } catch (e) {
    try {
      Logger.log("[VOID_INVOICE_TRIGGER_ERR] " + String(e.message || e));
    } catch (_) {}
  }
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
      hubTab.getRange(1, 16).setValue("이카운트 업 완료 여부")
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
    var ecountUpRaw = String(row[15] || "").trim(); // P열 (이카운트 업 완료 여부)

    // 이미 이카운트 업 완료된 건 제외
    if (ecountUpRaw === "이카운트 업 완료") {
      skipCount++;
      _po_countReason_(skipReasons, "이미 이카운트 업됨");
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
  if (hubPUpdates.length > 0) {
    for (var ui2 = 0; ui2 < hubPUpdates.length; ui2++) {
      hubTab.getRange(hubPUpdates[ui2], 16).setValue("이카운트 업 완료");
    }
    SpreadsheetApp.flush();
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
// ─────────────────────────────────────────────────────
function _po_buildVendorCustCdMap_() {
  var map = {};

  // ① 협력업체 파일의 설정탭에서 직접 읽기 (가장 정확)
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
        map[vName] = entry;
        var norm = vName.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
        if (norm && norm !== vName) map[norm] = entry;
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

  // ③ 협력업체 파일 설정탭 추가 정규화 키 보강
  //    (① 에서 정확 매칭 실패 시 더 넓은 정규화 키로 재시도)
  //    독립배포 forEachVendorDeployFile_ 의존 제거 — 협력업체 _pt_listFiles() 기반으로 대체
  try {
    var files3 = _pt_listFiles();
    for (var f3i = 0; f3i < files3.length; f3i++) {
      try {
        var pss3 = SpreadsheetApp.openById(files3[f3i].id);
        var st3 = pss3.getSheetByName("설정");
        if (!st3) continue;
        var vName3 = String(st3.getRange("B5").getValue() || "").trim();
        var vCust3 = String(st3.getRange("B6").getDisplayValue() || "").trim();
        if (!vName3 || !vCust3) continue;
        var entry3 = { custCd: vCust3, groupName: "" };
        // 이미 등록된 키는 덮어쓰지 않음
        if (!map[vName3]) map[vName3] = entry3;
        // 공백·특수문자 제거 정규화 키
        var norm3a = vName3.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
        if (norm3a && !map[norm3a]) map[norm3a] = entry3;
        // 법인 표현 제거 정규화 키 (주식회사, (주), ㈜ 등)
        var norm3b = vName3
          .replace(/주식회사|유한회사|농업회사법인/gi, "")
          .replace(/\(주\)|㈜/gi, "")
          .replace(/[^가-힣a-zA-Z0-9]/g, "")
          .toLowerCase()
          .trim();
        if (norm3b && !map[norm3b]) map[norm3b] = entry3;
        // 파일명 기반 레이블도 키로 등록 (수집 당시 파일명으로 저장된 허브 데이터 대응)
        var fileLabel3 = files3[f3i].name
          .replace("[협력업체] ", "")
          .replace(/\s*\(소비자용\).*$/, "")
          .trim();
        if (fileLabel3 && !map[fileLabel3]) map[fileLabel3] = entry3;
        var normFile3 = fileLabel3.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
        if (normFile3 && !map[normFile3]) map[normFile3] = entry3;
      } catch (e3) {}
    }
  } catch (e3o) {}

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
  // ★ 허브: 변경된 행만 M(적요)/N(송장번호)/O(상태) 개별 업데이트
  //   전체 setValues는 다른 열의 유효성 검사와 충돌할 수 있으므로 제거
  if (cleared > 0) {
    for (var ci = 0; ci < clearedRows.length; ci++) {
      var rowIdx = clearedRows[ci];
      var rowNum = rowIdx + 2;
      hubTab.getRange(rowNum, 13).setValue(hubData[rowIdx][12]).setFontColor("#cc0000");  // M열: 적요 (빨간색)
      hubTab.getRange(rowNum, 14).setValue(hubData[rowIdx][13]);  // N열: 송장번호
      hubTab.getRange(rowNum, 15).setValue(hubData[rowIdx][14]).setFontColor("#cc0000");  // O열: 상태 (빨간색)
    }
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
          for (var or2 = 1; or2 < otData.length; or2++) {
            var otInv = String(otData[or2][otInvCol] || "").trim();
            if (!otInv) continue;
            if (_po_isVoidedInvoice_(otInv, voidSet)) {
              ot.getRange(or2 + 1, otInvCol + 1).setValue("");
              if (otCmap.status !== -1) {
                var otSt = String(otData[or2][otCmap.status] || "").trim();
                if (otSt === "발송완료" || otSt.indexOf("합배송") !== -1) {
                  ot.getRange(or2 + 1, otCmap.status + 1).setValue("폐기처리").setFontColor("#cc0000");
                }
              }
              if (otCmap.note !== -1) {
                var otNote = String(otData[or2][otCmap.note] || "").trim();
                var otMark = "🗑️폐기(" + otInv + ")";
                ot.getRange(or2 + 1, otCmap.note + 1).setValue(
                  otNote ? otNote + "\n" + otMark : otMark
                ).setFontColor("#cc0000");
              }
              partnerCleared++;
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
//  비협력업체 미매칭 송장 → 별도 탭에 수집
//  전용양식 탭에서 허브 미매칭 송장을 추출하여
//  거래관리시스템 시트에 통합 형식으로 기록
// ═══════════════════════════════════════════

var _PO_UNMATCHED_TAB_NAME = "사방넷_송장매칭";
// 입력_로젠주문실적 원본 양식 헤더 (37열)
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
  "우편번호", // K열: 실제 데이터=우편번호
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
  "물품명", // W열: 실제 데이터=물품명(품목명)
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
// 열 인덱스 상수 (0-based) — 로젠주문실적 양식
var _UM_COL_INV = 5; // F열: 운송장번호
var _UM_COL_NAME = 9; // J열: 명(수취인)
var _UM_COL_ADDR = 11; // L열: 주소
var _UM_COL_TEL = 12; // M열: 전화번호
var _UM_COL_MOB = 13; // N열: 휴대폰
var _UM_COL_QTY = 14; // O열: 수량
var _UM_COL_ICODE = 21; // V열: 물품코드
var _UM_COL_INAME = 22; // W열: 물품명(품목명) — 실제 데이터 위치
var _UM_COL_ZIP = 10; // K열: 우편번호 — 실제 데이터 위치
var _UM_COL_MSG = 26; // AA열: 배송메세지
var _UM_COL_SEND_NAME = 27; // AB열: 명(보내는사람)
var _UM_COL_SEND_ADDR = 28; // AC열: 주소(보내는사람)
var _UM_COL_SEND_TEL = 29; // AD열: 전화(보내는사람);

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
var _PO_TEMP_INV_COL_ = 23; // X열: 송장번호
var _PO_TEMP_STATUS_COL_ = 24; // Y열: 진행상태

/** 대리공급_임시기록(신규) → 대리발송_임시기록(구명) 순으로 탭 조회 */
function _po_getNonPartnerTempTab_(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
  if (!tab) tab = ss.getSheetByName("대리발송_임시기록");
  return tab;
}

/** 허브 송장 매칭 결과 → UID/복합키 맵 (소스탭·임시기록 역기록용) */
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
    if (hUid2) hubInvoiceByKey["UID:" + hUid2] = upd2.inv;
    if (hCode2 && hName2) {
      hubInvoiceByKey[hCode2 + "|" + hName2 + "|" + hPhone2] = upd2.inv;
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
function _po_resolveTempTabInvoice_(row, invoiceMap, hubInvoiceByKey) {
  hubInvoiceByKey = hubInvoiceByKey || {};
  invoiceMap = invoiceMap || {};
  var tUid = String(row[_PO_TEMP_UID_COL_] || "").trim();
  if (tUid && hubInvoiceByKey["UID:" + tUid]) return hubInvoiceByKey["UID:" + tUid];
  if (tUid && invoiceMap[tUid]) {
    var inv = _po_pickInvoiceFromMapCandidates_(invoiceMap[tUid]);
    if (inv) return inv;
  }
  var tCode = String(row[3] || "").trim();
  var tName = String(row[12] || "").trim();
  var tPhone = String(row[8] || row[7] || "").replace(/[^0-9]/g, "");
  if (tCode && tName && hubInvoiceByKey[tCode + "|" + tName + "|" + tPhone]) {
    return hubInvoiceByKey[tCode + "|" + tName + "|" + tPhone];
  }
  if (tName) {
    var shortP =
      tPhone.length >= 4 ? tPhone.substring(tPhone.length - 4) : tPhone;
    var npKey = tName + "_" + shortP;
    inv = _po_pickInvoiceFromMapCandidates_(invoiceMap[npKey]);
    if (inv) return inv;
    var nNorm = tName.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, "");
    var normKey = nNorm + "_" + shortP;
    if (normKey !== npKey) {
      inv = _po_pickInvoiceFromMapCandidates_(invoiceMap[normKey]);
      if (inv) return inv;
    }
  }
  return "";
}

/** 초기화 시 송장번호(X열) 있는 행만 제거, 미매칭 행은 유지 */
function _po_clearTempTabInvoicedRowsOnly_(tempTab) {
  if (!tempTab || tempTab.getLastRow() < 2) return { cleared: 0, kept: 0 };
  var lr = tempTab.getLastRow();
  var lc = Math.max(tempTab.getLastColumn(), _PO_TEMP_STATUS_COL_ + 1);
  var data = tempTab.getRange(2, 1, lr - 1, lc).getValues();
  var keepRows = [];
  var cleared = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][_PO_TEMP_INV_COL_] || "").trim()) cleared++;
    else keepRows.push(data[i]);
  }
  tempTab.getRange(2, 1, lr - 1, lc).clearContent();
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
function _po_checkNonPartnerTempTabMatches_(invoiceMap, scannedLogs, hubInvoiceByKey) {
  var tempTab = _po_getNonPartnerTempTab_(SpreadsheetApp.getActiveSpreadsheet());
  if (!tempTab || tempTab.getLastRow() < 2) {
    scannedLogs.push("[비협력임시탭] 데이터 없음 스킵");
    return;
  }
  var tempLr = tempTab.getLastRow();
  var tempLc = Math.max(tempTab.getLastColumn(), _PO_TEMP_STATUS_COL_ + 1);
  var tempData = tempTab.getRange(2, 1, tempLr - 1, tempLc).getValues();
  var totalNp = 0,
    alreadyHas = 0,
    newlyMatched = 0,
    noMatchNp = 0;
  var updates = [];
  for (var ti = 0; ti < tempData.length; ti++) {
    var tUid = String(tempData[ti][_PO_TEMP_UID_COL_] || "").trim();
    if (!tUid) continue;
    totalNp++;
    if (String(tempData[ti][_PO_TEMP_INV_COL_] || "").trim()) {
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
    );
    if (bestInv) {
      updates.push({ row: ti + 2, inv: bestInv, updateStatusOnly: false });
      newlyMatched++;
    } else {
      noMatchNp++;
    }
  }
  var invoiceGreen = "#d9ead3"; // 연한 녹색
  for (var ui = 0; ui < updates.length; ui++) {
    var uRow = updates[ui].row;
    if (updates[ui].updateStatusOnly) {
      tempTab.getRange(uRow, _PO_TEMP_STATUS_COL_ + 1).setValue("송장수집");
    } else {
      tempTab.getRange(uRow, _PO_TEMP_INV_COL_ + 1).setValue(updates[ui].inv);
      tempTab.getRange(uRow, _PO_TEMP_STATUS_COL_ + 1).setValue("송장수집");
    }
    // ★ 송장번호 있는 행 전체 녹색 배경
    try {
      tempTab.getRange(uRow, 1, 1, tempLc).setBackground(invoiceGreen);
    } catch (eBg) {}
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
 *   사방넷_송장매칭 탭(로젠주문실적 37열 양식)으로 변환 출력
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

  // 사방넷_송장매칭 탭 열기 / 없으면 생성
  var targetSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var targetTab = targetSS.getSheetByName(_PO_UNMATCHED_TAB_NAME);
  if (!targetTab) {
    targetTab = targetSS.insertSheet(_PO_UNMATCHED_TAB_NAME);
    targetTab.getRange(1, 1, 1, _PO_UNMATCHED_HEADERS.length).setValues([_PO_UNMATCHED_HEADERS]);
    targetTab.getRange("1:1")
      .setBackground("#1f4e78").setFontColor("white")
      .setFontWeight("bold").setHorizontalAlignment("center");
    targetTab.setFrozenRows(1);
    scannedLogs.push("[임시탭→비협력] '" + _PO_UNMATCHED_TAB_NAME + "' 탭 신규 생성");
  }

  // 기존 운송장번호 중복 Set
  var existingInvSet = {};
  if (targetTab.getLastRow() >= 2) {
    var existData = targetTab.getRange(2, _UM_COL_INV + 1, targetTab.getLastRow() - 1, 1).getValues();
    for (var ei = 0; ei < existData.length; ei++) {
      var eInv = String(existData[ei][0] || "").trim();
      if (eInv) {
        existingInvSet[eInv] = true;
        existingInvSet[eInv.replace(/[^0-9]/g, "")] = true;
      }
    }
  }

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

    var outRow = [];
    for (var oi = 0; oi < _PO_UNMATCHED_HEADERS.length; oi++) outRow.push("");

    outRow[_UM_COL_INV]       = inv;       // F(5): 운송장번호
    outRow[_UM_COL_NAME]      = recName;   // J(9): 명(수취인)
    outRow[_UM_COL_ADDR]      = recAddr;   // L(11): 주소
    outRow[_UM_COL_TEL]       = recTel || recMob;  // M(12): 전화번호 (유선 우선, 없으면 모바일)
    outRow[_UM_COL_MOB]       = recMob || recTel;  // N(13): 휴대폰 (모바일 우선, 없으면 유선)
    outRow[_UM_COL_QTY]       = qty;       // O(14): 수량
    outRow[_UM_COL_ICODE]     = itemCode;  // V(21): 물품코드
    outRow[_UM_COL_INAME]     = itemName;  // K(10): 물품명 (기존 W열에서 변경)
    outRow[_UM_COL_MSG]       = msg;       // AA(26): 배송메세지
    outRow[_UM_COL_SEND_NAME] = pfxLabel;  // AB(27): 송하인명(업체prefix)
    outRow[2]                 = today;     // C(2): 접수일자
    outRow[4]                 = uid;       // E(4): 주문번호 = 고유ID(사방넷주문번호)

    newRows.push(outRow);
    existingInvSet[inv] = true;
    existingInvSet[invDigits] = true;
    written++;
  }

  if (newRows.length > 0) {
    var writeStart = targetTab.getLastRow() + 1;
    targetTab.getRange(writeStart, _UM_COL_TEL + 1, newRows.length, 1).setNumberFormat("@");
    targetTab.getRange(writeStart, _UM_COL_MOB + 1, newRows.length, 1).setNumberFormat("@");
    targetTab.getRange(writeStart, 1, newRows.length, _PO_UNMATCHED_HEADERS.length).setValues(newRows);
    SpreadsheetApp.flush();
  }

  // ★ 디버그: 임시탭 열 수와 첫 3건 P열(15) 값 출력
  var _dbgSamples_ = [];
  for (var _di_ = 0; _di_ < Math.min(tempData.length, 3); _di_++) {
    _dbgSamples_.push("R" + (_di_+2) + ":P(15)=[" + String(tempData[_di_][15] || "(빈)") + "] X(23)=[" + String(tempData[_di_][23] || "(빈)") + "]");
  }
  scannedLogs.push("★ [임시탭→비협력] tempLc=" + tempLc + " 행=" + tempData.length + " 샘플=" + _dbgSamples_.join(" | "));

  scannedLogs.push("★ [임시탭→비협력] 기록: " + written + "건 / 중복스킵: " + skipped + "건 / 송장없음: " + noInv + "건");

  // ★ 보정: 기존 사방넷_송장매칭 행 중 E열(주문번호)이 비어있으면 임시탭 P열 값으로 채움
  try {
    if (targetTab.getLastRow() >= 2) {
      // 임시탭 송장번호 → P열(UID) 매핑 생성
      var invToUid = {};
      for (var bi = 0; bi < tempData.length; bi++) {
        var bInv = String(tempData[bi][23] || "").trim();
        var bUid = String(tempData[bi][15] || "").trim();
        if (bInv && bUid) {
          var bDigits = bInv.replace(/[^0-9]/g, "");
          invToUid[bInv] = bUid;
          invToUid[bDigits] = bUid;
        }
      }
      // 사방넷_송장매칭 E열(4) + F열(5=송장번호) 읽기
      var tgtLr = targetTab.getLastRow();
      var tgtData = targetTab.getRange(2, 5, tgtLr - 1, 2).getValues(); // E~F열
      var backfilled = 0;
      for (var bj = 0; bj < tgtData.length; bj++) {
        var curE = String(tgtData[bj][0] || "").trim(); // E열(주문번호)
        if (curE) continue; // 이미 있으면 스킵
        var curF = String(tgtData[bj][1] || "").trim(); // F열(운송장번호)
        if (!curF) continue;
        var curFDigits = curF.replace(/[^0-9]/g, "");
        var matchUid = invToUid[curF] || invToUid[curFDigits] || "";
        if (matchUid) {
          targetTab.getRange(bj + 2, 5).setValue(matchUid); // E열(5번째 열)
          backfilled++;
        }
      }
      if (backfilled > 0) {
        SpreadsheetApp.flush();
        scannedLogs.push("★ [E열 보정] 기존 행 " + backfilled + "건에 주문번호(사방넷번호) 보정 완료");
      }
    }
  } catch (eBackfill) {
    scannedLogs.push("[E열 보정 오류] " + String(eBackfill.message || eBackfill));
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

  // ② 대상 시트에 탭 생성/열기
  var targetSS = SpreadsheetApp.openById(_PEP_SOURCE_SHEET_ID);
  var targetTab = targetSS.getSheetByName(_PO_UNMATCHED_TAB_NAME);
  if (targetTab) {
    var existingHeader = String(
      targetTab.getRange("A1").getValue() || "",
    ).trim();
    if (existingHeader !== _PO_UNMATCHED_HEADERS[0]) {
      scannedLogs.push(
        "[사방넷주문] 기존 탭 헤더 불일치('" +
          existingHeader +
          "'), 삭제 후 재생성",
      );
      targetSS.deleteSheet(targetTab);
      targetTab = null;
    }
  }
  if (!targetTab) {
    targetTab = targetSS.insertSheet(_PO_UNMATCHED_TAB_NAME);
    targetTab
      .getRange(1, 1, 1, _PO_UNMATCHED_HEADERS.length)
      .setValues([_PO_UNMATCHED_HEADERS]);
    targetTab
      .getRange("1:1")
      .setBackground("#1f4e78")
      .setFontColor("white")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    targetTab.setFrozenRows(1);
    targetTab.setColumnWidth(1, 130);
    targetTab.setColumnWidth(2, 100);
    targetTab.setColumnWidth(3, 130);
    targetTab.setColumnWidth(4, 120);
    targetTab.setColumnWidth(5, 80);
    targetTab.setColumnWidth(6, 120);
    targetTab.setColumnWidth(7, 200);
    targetTab.setColumnWidth(8, 50);
    targetTab.setColumnWidth(9, 250);
    targetTab.setColumnWidth(10, 160);
    scannedLogs.push(
      "[사방넷주문] '" + _PO_UNMATCHED_TAB_NAME + "' 탭 신규 생성",
    );
  }

  // ③ 기존 송장번호 중복 Set
  var existingInvSet = {};
  if (targetTab.getLastRow() >= 2) {
    var existData = targetTab
      .getRange(2, _UM_COL_INV + 1, targetTab.getLastRow() - 1, 1)
      .getValues();
    for (var ei = 0; ei < existData.length; ei++) {
      var eInv = String(existData[ei][0] || "").trim();
      if (eInv) {
        existingInvSet[eInv] = true;
        existingInvSet[eInv.replace(/[^0-9]/g, "")] = true;
      }
    }
  }

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

        // 로젠주문실적 양식 37열 행 생성
        var outRow = [];
        for (var oi = 0; oi < _PO_UNMATCHED_HEADERS.length; oi++)
          outRow.push("");
        var parsedPhone =
          phoneIdx >= 0 ? String(row[phoneIdx] || "").trim() : "";

        outRow[_UM_COL_INV] = inv; // F: 운송장번호
        outRow[_UM_COL_NAME] =
          nameIdx >= 0 ? String(row[nameIdx] || "").trim() : ""; // J: 명(수취인)
        outRow[_UM_COL_ADDR] =
          addrIdx >= 0 ? String(row[addrIdx] || "").trim() : ""; // L: 주소
        outRow[_UM_COL_TEL] = parsedPhone; // M: 전화번호
        outRow[_UM_COL_MOB] = parsedPhone; // N: 휴대폰
        outRow[_UM_COL_QTY] = qtyIdx >= 0 ? row[qtyIdx] || "" : ""; // O: 수량
        outRow[_UM_COL_ICODE] =
          itemCodeIdx >= 0 ? String(row[itemCodeIdx] || "").trim() : ""; // V: 물품코드
        outRow[_UM_COL_INAME] =
          itemIdx >= 0 ? String(row[itemIdx] || "").trim() : ""; // K: 물품명 (기존 W열에서 변경)
        outRow[_UM_COL_MSG] =
          msgIdx >= 0 ? String(row[msgIdx] || "").trim() : ""; // AA: 배송메세지
        outRow[_UM_COL_SEND_NAME] =
          sendNameIdx >= 0 && String(row[sendNameIdx] || "").trim()
            ? String(row[sendNameIdx] || "").trim()
            : vendorName; // AB: 송하인명 — 전용양식 보내는사람/거래처명 우선, 없으면 업체명
        outRow[_UM_COL_SEND_ADDR] =
          sendAddrIdx >= 0 ? String(row[sendAddrIdx] || "").trim() : ""; // AC: 보내는사람주소

        var parsedSendPhone =
          sendPhoneIdx >= 0 ? String(row[sendPhoneIdx] || "").trim() : "";
        outRow[_UM_COL_SEND_TEL] = parsedSendPhone; // AD: 송하인전화
        outRow[2] = today; // C: 접수일자 (수집일시 대용)
        // ★ E열(4): 주문번호 = 사방넷주문번호 (적요 폴백 제거 — 적요가 E열에 들어가는 문제 방지)
        var orderNum = sabangnetIdx >= 0 ? String(row[sabangnetIdx] || "").trim() : "";
        outRow[4] = orderNum;
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
    var targetRange = targetTab.getRange(
      writeStartRow,
      1,
      newRows.length,
      _PO_UNMATCHED_HEADERS.length,
    );

    // 전화번호 열(M, N, AD) 텍스트 포맷 강제 설정
    targetTab
      .getRange(writeStartRow, _UM_COL_TEL + 1, newRows.length, 1)
      .setNumberFormat("@");
    targetTab
      .getRange(writeStartRow, _UM_COL_MOB + 1, newRows.length, 1)
      .setNumberFormat("@");
    targetTab
      .getRange(writeStartRow, _UM_COL_SEND_TEL + 1, newRows.length, 1)
      .setNumberFormat("@");

    targetRange.setValues(newRows);
    scannedLogs.push(
      "★ 사방넷주문 송장 수집: " +
        newRows.length +
        "건 → " +
        _PO_UNMATCHED_TAB_NAME +
        " 탭",
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

