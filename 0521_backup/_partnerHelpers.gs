/**
 * ┌──────────────────────────────────────────┐
 * │  [협력업체] 독립 헬퍼 함수 모음           │
 * │  파일: _partnerHelpers.gs                │
 * │  기존 독립배포 코드 의존성 완전 제거용     │
 * └──────────────────────────────────────────┘
 *
 * priceManager.gs, orderSyncManager.gs, vendorCustCodeManager.gs에서
 * 필요한 함수만 _pt_ 접두사로 이식하여 협력업체 시스템을 완전 독립시킨다.
 */

// ═══════════════════════════════════════════
//  상수 (송장 시트 ID — 기존 orderSyncManager.gs에서 이식)
// ═══════════════════════════════════════════
var _PT_INVOICE_SHEET_ID = "1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs";
// ★ [최우선] 입력_로젠주문실적 — E열(주문번호=고유ID/사방넷) + F열(운송장번호)
var _PT_PRIMARY_INVOICE_GID = 548505068;
// ★ [폴백] 3-3_병합 — A열(고객명) + B열(전화번호) + D열(운송장번호) → 이름+전화 매칭
var _PT_NAME_PHONE_FALLBACK_GID = 656421383;
var _PT_COMBINED_INVOICE_SHEET_ID =
  "1vWdJgmbW_Gwm_2b1pP8mVBxpfYBbUiAduSwkStXxs0Y";
var _PT_COMBINED_INVOICE_SHEET_GID = 1403770726;
// 사방넷 전용 탭 GID (보조 소스)
var _PT_SABANGNET_GID = 1445333640;
var _PT_DEPLOY_LOCAL_SETTINGS_TAB_NAME = "설정";
var _PT_DEPLOY_LOCAL_VENDOR_NAME_CELL = "B5";
var _PT_DEPLOY_LOCAL_CUST_CODE_CELL = "B6";

// ═══════════════════════════════════════════
//  이식: normalizeSpreadsheetId_ → _pt_normalizeSpreadsheetId
// ═══════════════════════════════════════════
function _pt_normalizeSpreadsheetId(raw) {
  var s = String(raw || "").trim();
  if (!s) return "";
  var byPath = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (byPath && byPath[1]) return byPath[1];
  var byQuery = s.match(/[?&]id=([a-zA-Z0-9-_]+)/i);
  if (byQuery && byQuery[1]) return byQuery[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return s;
}

// ═══════════════════════════════════════════
//  이식: getHubSS → _pt_getHubSS
// ═══════════════════════════════════════════
function _pt_getHubSS(id) {
  id = _pt_normalizeSpreadsheetId(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!id || id === ss.getId()) return ss;
  var lastErr = null;
  var url = "https://docs.google.com/spreadsheets/d/" + id + "/edit";
  for (var i = 0; i < 3; i++) {
    try {
      var target = SpreadsheetApp.openByUrl(url);
      if (target) return target;
    } catch (e) {
      lastErr = e;
      Utilities.sleep(1500);
    }
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    var errMsg = String(lastErr ? lastErr.message : e.message);
    throw new Error("❌ 협력업체 허브 접근 실패: " + errMsg);
  }
}

// ═══════════════════════════════════════════
//  이식: buildHubGroupColumnMap_ → _pt_buildHubGroupColumnMap
// ═══════════════════════════════════════════
function _pt_buildHubGroupColumnMap(hubHeaders) {
  var out = {};
  if (!hubHeaders || !hubHeaders.length) return out;
  for (var col = 6; col < hubHeaders.length; col += 5) {
    var g = String(hubHeaders[col] || "").trim();
    if (g && !out[g]) out[g] = col + 1;
  }
  return out;
}

// ═══════════════════════════════════════════
//  K2 NNN 패턴 감지 → 소비자가 할인율 반환
//  444→4%, 555→5%, 666→6% ...
//  파일명 (소비자용) 없이도 K2만으로 소비자가 모드 판별 가능
// ═══════════════════════════════════════════
function _pt_getConsumerRateFromK2(K2) {
  var s = String(Math.round(K2 || 0));
  if (s.length === 3 && s[0] === s[1] && s[1] === s[2]) {
    return parseInt(s[0], 10); // 444→4, 555→5, ...
  }
  return 0; // 소비자가 모드 아님
}

// ═══════════════════════════════════════════
//  이식: createTemplateCopyInTargetFolder_ → _pt_createTemplateCopy
// ═══════════════════════════════════════════
function _pt_createTemplateCopy(templateId, copyName) {
  var templateFile = null;
  try {
    templateFile = DriveApp.getFileById(String(templateId || "").trim());
  } catch (eTpl) {
    throw new Error("템플릿 파일 접근 실패: " + eTpl.message);
  }
  try {
    var targetFolder = DriveApp.getFolderById(
      String(_PT.FOLDER_ID || "").trim(),
    );
    return templateFile.makeCopy(String(copyName || "").trim(), targetFolder);
  } catch (eDirectCopy) {
    try {
      var copy = templateFile.makeCopy(String(copyName || "").trim());
      try {
        var folder = DriveApp.getFolderById(String(_PT.FOLDER_ID || "").trim());
        folder.addFile(copy);
        try {
          DriveApp.getRootFolder().removeFile(copy);
        } catch (eRootDetach) {}
      } catch (eMove) {}
      return copy;
    } catch (eFallbackCopy) {
      throw new Error("템플릿 복사 실패: " + eFallbackCopy.message);
    }
  }
}

// ═══════════════════════════════════════════
//  이식: ensureDeployLocalSettingsTab_ → _pt_ensureLocalSettingsTab
// ═══════════════════════════════════════════
function _pt_ensureLocalSettingsTab(ss, defaultVendorName, defaultCustCd) {
  if (!ss) return null;
  var tab = ss.getSheetByName(_PT_DEPLOY_LOCAL_SETTINGS_TAB_NAME);
  if (!tab) tab = ss.insertSheet(_PT_DEPLOY_LOCAL_SETTINGS_TAB_NAME);
  try {
    tab.getRange("A1:B1").merge().setValue("배포 설정");
  } catch (eMerge) {}
  tab
    .getRange("A1")
    .setBackground("#1f4e78")
    .setFontColor("white")
    .setFontWeight("bold");
  tab.getRange("A2").setValue("※ 거래처명/CUST_CD는 이 탭에서 관리합니다.");
  tab.getRange("A3").setValue("파일명(자동)");
  tab.getRange("B3").setValue(ss.getName() || "");
  tab.getRange("A5").setValue("거래처명");
  tab.getRange("A6").setValue("거래처코드(CUST_CD)");
  tab.getRange("A3:A6").setFontWeight("bold");
  tab.setColumnWidth(1, 180);
  tab.setColumnWidth(2, 340);
  var curVendor = String(
    tab.getRange(_PT_DEPLOY_LOCAL_VENDOR_NAME_CELL).getValue() || "",
  ).trim();
  var curCust = String(
    tab.getRange(_PT_DEPLOY_LOCAL_CUST_CODE_CELL).getValue() || "",
  ).trim();
  if (!curVendor && String(defaultVendorName || "").trim()) {
    tab
      .getRange(_PT_DEPLOY_LOCAL_VENDOR_NAME_CELL)
      .setValue(String(defaultVendorName).trim());
  }
  if (!curCust && String(defaultCustCd || "").trim()) {
    tab
      .getRange(_PT_DEPLOY_LOCAL_CUST_CODE_CELL)
      .setValue(String(defaultCustCd).trim());
  }
  var custRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR($B6="",AND($B6<>$B5,$B6<>$B3))')
    .setAllowInvalid(true)
    .setHelpText("CUST_CD는 거래처명/파일명과 동일할 수 없습니다.")
    .build();
  tab.getRange(_PT_DEPLOY_LOCAL_CUST_CODE_CELL).setDataValidation(custRule);
  return tab;
}

// ═══════════════════════════════════════════
//  이식: ensureNoticeRowLinked_ → _pt_ensureNoticeRowLinked
// ═══════════════════════════════════════════
function _pt_ensureNoticeRowLinked(sheet, hubId) {
  sheet
    .getRange("A1")
    .setValue("📢 공지사항")
    .setBackground("#e69138")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  var noticeFormula = '=IMPORTRANGE("' + hubId + '", "설정!B1")';
  var noticeRange = sheet.getRange("B1:J1");
  try {
    noticeRange.breakApart();
    noticeRange
      .merge()
      .setFormula(noticeFormula)
      .setBackground("#fff2cc")
      .setFontColor("#7f4f00")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);
  } catch (eNoticeMerge) {
    sheet.getRange("B1").setFormula(noticeFormula);
    noticeRange
      .setBackground("#fff2cc")
      .setFontColor("#7f4f00")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);
  }
  sheet.setRowHeight(1, 50);
}

// ═══════════════════════════════════════════
//  이식: buildDeployTitleFormula_ → _pt_buildDeployTitleFormula
// ═══════════════════════════════════════════
function _pt_buildDeployTitleFormula(hubId) {
  return (
    '=IFERROR(LET(_t, IMPORTRANGE("' +
    hubId +
    '", "설정!B2"), IF(LEN(TRIM(_t&""))=0, "익월변동단가", _t)), "익월변동단가")'
  );
}

// ═══════════════════════════════════════════
//  이식: normalizeDcRateNumber_ → _pt_normalizeDcRateNumber
// ═══════════════════════════════════════════
function _pt_normalizeDcRateNumber(raw, fallback) {
  var n = typeof raw === "number" ? raw : parseFloat(String(raw || "").trim());
  if (isNaN(n)) return fallback;
  if (n < 1 || n > 10) return fallback;
  return Math.round(n * 10) / 10;
}

// ═══════════════════════════════════════════
//  이식: parseConsumerDiscountRateFromName_ → _pt_parseConsumerDcRateFromName
// ═══════════════════════════════════════════
function _pt_parseConsumerDcRateFromName(fileName) {
  var m = String(fileName || "").match(/(\d+(?:\.\d+)?)\s*%?\s*DC/i);
  if (!m || !m[1]) return 5;
  var n = parseFloat(m[1]);
  return _pt_normalizeDcRateNumber(n, 5);
}

// ═══════════════════════════════════════════
//  이식: findViewerSheet_ → _pt_findViewerSheet
// ═══════════════════════════════════════════
function _pt_findViewerSheet(ss) {
  if (!ss) return null;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = String(sheets[i].getName() || "");
    if (n.indexOf("마감") !== -1) continue;
    if (n.indexOf("단가조회") !== -1 || n.indexOf("뷰어") !== -1)
      return sheets[i];
  }
  return null;
}

// ═══════════════════════════════════════════
//  이식: getSheetByGid_ → _pt_getSheetByGid
// ═══════════════════════════════════════════
function _pt_getSheetByGid(ss, gid) {
  if (!ss || !gid) return null;
  var target = parseInt(gid, 10);
  if (!(target > 0)) return null;
  var tabs = ss.getSheets();
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getSheetId() === target) return tabs[i];
  }
  return null;
}

// ═══════════════════════════════════════════
//  이식: resolveShipToAddressColumn_ → _pt_resolveShipToAddressColumn
// ═══════════════════════════════════════════
function _pt_resolveShipToAddressColumn(cMap) {
  if (!cMap) return -1;
  if (cMap.addrRecv !== -1) return cMap.addrRecv;
  return cMap.addr;
}

// ═══════════════════════════════════════════
//  이식: Spill 수식 빌더 + inject + heal
// ═══════════════════════════════════════════
function _pt_buildOrderVendorNameSpillFormula(viewerTabName) {
  var safeName = String(viewerTabName || "단가조회").replace(/'/g, "''");
  return (
    '={"거래처명"; ARRAYFORMULA(IF(LEN(C2:C)+LEN(D2:D)=0, "", \'' +
    safeName +
    "'!$AA$1))}"
  );
}
function _pt_buildOrderUnitPriceSpillFormula(viewerTabName) {
  var safeName = String(viewerTabName || "단가조회").replace(/'/g, "''");
  // ★ 개당 단가만 표시 (수량 곱셈 제거)
  // 발주마감 이동 시 price × qty 계산은 _pms_core_ 에서 처리
  return (
    '={"단가"; ARRAYFORMULA(IF(LEN(C2:C), IFERROR(VLOOKUP(C2:C, \'' +
    safeName +
    '\'!C:G, 5, FALSE), "코드오류"), ""))}'
  );
}

/**
 * 뉴파츠공급가 탭 전용 L1 수식:
 * 뉴파츠공급가!A:C  (A=품목코드, B=품목명, C=단가(Vat포함))
 * → 단가(Vat포함)를 그대로 표시
 */
function _pt_buildNewPartsUnitPriceSpillFormula() {
  return '={"단가"; ARRAYFORMULA(IF(LEN(C2:C), IFERROR(VLOOKUP(C2:C, 뉴파츠공급가!A:C, 3, FALSE), "코드오류"), ""))}';
}
function _pt_resolveViewerTabNameForOrderSpill(orderTab, viewerTabName) {
  var fallback = String(viewerTabName || "").trim() || "단가조회";
  if (!orderTab) return fallback;
  try {
    var ss = orderTab.getParent();
    if (!ss) return fallback;
    if (fallback && ss.getSheetByName(fallback)) return fallback;
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var n = sheets[i].getName();
      if (n.indexOf("단가조회") !== -1 || n.indexOf("뷰어") !== -1) return n;
    }
  } catch (e) {}
  return fallback;
}
function _pt_injectOrderSpillFormulas(orderTab, viewerTabName) {
  if (!orderTab) return;
  // ★ 전용양식 탭에는 spill 수식을 주입하지 않음 (A열=송장번호, B열=적요)
  var tabName = "";
  try {
    tabName = orderTab.getName();
  } catch (e) {}
  if (tabName.indexOf("전용양식") !== -1) return;
  // ★ 2차: 헤더 내용으로도 전용양식 감지 (탭 이름이 다를 수 있으므로)
  try {
    var h1 = orderTab
      .getRange(1, 1, 1, Math.min(orderTab.getLastColumn(), 20))
      .getValues()[0];
    var hj = h1
      .map(function (v) {
        return String(v || "").replace(/\s/g, "");
      })
      .join("|");
    if (
      hj.indexOf("공급가액") !== -1 ||
      hj.indexOf("부가세") !== -1 ||
      hj.toLowerCase().indexOf("vat") !== -1 ||
      (hj.indexOf("택배수량") !== -1 && hj.indexOf("거래처명") !== -1)
    )
      return;
  } catch (eH) {}
  var safe = _pt_resolveViewerTabNameForOrderSpill(orderTab, viewerTabName);
  try {
    orderTab.getRange("A1:A").clearContent();
    orderTab
      .getRange("A1")
      .setFormula(_pt_buildOrderVendorNameSpillFormula(safe));
  } catch (e1) {}
  try {
    orderTab.getRange("L1:L").clearContent();
    orderTab
      .getRange("L1")
      .setFormula(_pt_buildOrderUnitPriceSpillFormula(safe));
  } catch (e2) {}
}
function _pt_healOrderSpillFormulas(orderTab, viewerTabName) {
  if (!orderTab) return { aFixed: false, lFixed: false };
  // ★ 전용양식 탭에는 spill 수식 복구 금지 (A열=송장번호, 업체 수기 입력)
  try {
    var _tn = orderTab.getName();
    if (_tn.indexOf("전용양식") !== -1) return { aFixed: false, lFixed: false };
  } catch (e) {}
  // ★ 2차: 헤더 내용으로도 전용양식 감지 (탭 이름이 다를 수 있으므로)
  try {
    var h1 = orderTab
      .getRange(1, 1, 1, Math.min(orderTab.getLastColumn(), 20))
      .getValues()[0];
    var hj = h1
      .map(function (v) {
        return String(v || "").replace(/\s/g, "");
      })
      .join("|");
    if (
      hj.indexOf("공급가액") !== -1 ||
      hj.indexOf("부가세") !== -1 ||
      hj.toLowerCase().indexOf("vat") !== -1 ||
      (hj.indexOf("택배수량") !== -1 && hj.indexOf("거래처명") !== -1)
    )
      return { aFixed: false, lFixed: false };
  } catch (eH) {}
  var safe = _pt_resolveViewerTabNameForOrderSpill(orderTab, viewerTabName);
  var out = { aFixed: false, lFixed: false };
  var sampleRows = Math.max(Math.min(orderTab.getLastRow(), 200), 2);
  var checkRows = sampleRows - 1;
  var aHasRefBelow = false,
    lHasRefBelow = false;
  try {
    var aB = orderTab.getRange(2, 1, checkRows, 1).getDisplayValues();
    for (var ai = 0; ai < aB.length; ai++) {
      if (String(aB[ai][0] || "").indexOf("#REF") !== -1) {
        aHasRefBelow = true;
        break;
      }
    }
  } catch (e) {}
  try {
    var lB = orderTab.getRange(2, 12, checkRows, 1).getDisplayValues();
    for (var li = 0; li < lB.length; li++) {
      if (String(lB[li][0] || "").indexOf("#REF") !== -1) {
        lHasRefBelow = true;
        break;
      }
    }
  } catch (e) {}
  try {
    var a1 = orderTab.getRange("A1");
    var aF = String(a1.getFormula() || "");
    var aV = String(a1.getValue() || "");
    var a2F = String(orderTab.getRange("A2").getFormula() || "");
    // ★ A2에 값(텍스트)이 있으면 spill 불가 → 파괴 판정 추가
    var a2V = !a2F
      ? String(orderTab.getRange("A2").getValue() || "").trim()
      : "";
    var a2HasValue = !!a2F || (!!a2V && aF.indexOf("ARRAYFORMULA") !== -1);
    var aBroken =
      !aF ||
      aF.indexOf("ARRAYFORMULA") === -1 ||
      aF.indexOf("$AA$1") === -1 ||
      aV.indexOf("#REF") !== -1 ||
      aHasRefBelow ||
      a2HasValue;
    if (aBroken) {
      orderTab.getRange("A1:A").clearContent();
      a1.setFormula(_pt_buildOrderVendorNameSpillFormula(safe));
      out.aFixed = true;
    }
  } catch (ea) {}
  try {
    var l1 = orderTab.getRange("L1");
    var lF = String(l1.getFormula() || "");
    var lV = String(l1.getValue() || "");
    var l2F = String(orderTab.getRange("L2").getFormula() || "");
    // ★ L2에 값(텍스트)이 있으면 spill 불가 → 파괴 판정 추가
    var l2V = !l2F
      ? String(orderTab.getRange("L2").getValue() || "").trim()
      : "";
    var l2HasValue = !!l2F || (!!l2V && lF.indexOf("ARRAYFORMULA") !== -1);
    // ★ 구버전 수식("정산금액" 헤더 + * E2:E 곱셈 포함) → broken 으로 판단하여 강제 교체
    var lIsLegacy = lF.indexOf("* E2:E") !== -1 || lF.indexOf("*E2:E") !== -1;
    // ★ 수식이 참조하는 탭명이 현재 실제 탭명과 다르면 broken
    //   예) 수식: '단가조회'!C:G  /  실제 탭: '팩투유 단가조회' → 불일치 → 재생성
    var lHasWrongTab = false;
    if (safe && lF.indexOf("VLOOKUP") !== -1) {
      // 수식 안에 safe(탭명)이 없으면 잘못된 탭을 참조 중
      lHasWrongTab = lF.indexOf(safe) === -1;
    }
    var lBroken =
      lIsLegacy ||
      lHasWrongTab ||
      !lF ||
      lF.indexOf("ARRAYFORMULA") === -1 ||
      lF.indexOf("VLOOKUP") === -1 ||
      lV.indexOf("#REF") !== -1 ||
      lHasRefBelow ||
      l2HasValue;
    if (lBroken) {
      orderTab.getRange("L1:L").clearContent();
      l1.setFormula(_pt_buildOrderUnitPriceSpillFormula(safe));
      out.lFixed = true;
    }
  } catch (el) {}
  return out;
}

// ═══════════════════════════════════════════
//  이식: backfillMissingOrderDatesOnTabData_ → _pt_backfillMissingOrderDates
// ═══════════════════════════════════════════
function _pt_backfillMissingOrderDates(fullData, cMap, todayYmd) {
  if (!fullData || fullData.length <= 1 || !cMap || cMap.date === -1) return 0;
  var changed = 0;
  var effectiveDate = todayYmd;
  if (!effectiveDate) {
    effectiveDate = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  }
  for (var r = 1; r < fullData.length; r++) {
    var row = fullData[r];
    var orderDate = row[cMap.date];
    var stAddrCol = _pt_resolveShipToAddressColumn(cMap);
    var hasOrderInput =
      (cMap.code !== -1 && String(row[cMap.code] || "").trim() !== "") ||
      (cMap.item !== -1 && String(row[cMap.item] || "").trim() !== "") ||
      (cMap.qty !== -1 && String(row[cMap.qty] || "").trim() !== "") ||
      (cMap.recipient !== -1 &&
        String(row[cMap.recipient] || "").trim() !== "") ||
      (cMap.phone !== -1 && String(row[cMap.phone] || "").trim() !== "") ||
      (stAddrCol !== -1 && String(row[stAddrCol] || "").trim() !== "") ||
      (cMap.msg !== -1 && String(row[cMap.msg] || "").trim() !== "") ||
      (cMap.invoice !== -1 && String(row[cMap.invoice] || "").trim() !== "");
    if (!hasOrderInput) continue;
    if (!orderDate || String(orderDate).trim() === "") {
      row[cMap.date] = effectiveDate;
      changed++;
    }
  }
  return changed;
}

// ═══════════════════════════════════════════
//  이식: buildOrderTabColumnMap_ → _pt_buildOrderTabColumnMap
// ═══════════════════════════════════════════
function _pt_buildOrderTabColumnMap(headers) {
  var cMap = {
    date: -1,
    code: -1,
    vendorSku: -1,
    phone: -1,
    mobile: -1,
    client: -1,
    clientCode: -1,
    item: -1,
    itemAlt: -1,
    qty: -1,
    seq: -1,
    shipMethod: -1,
    recipient: -1,
    addr: -1,
    addr1: -1,
    addrSender: -1,
    addrRecv: -1,
    msg: -1,
    status: -1,
    voucherMemo: -1,
    invoice: -1,
    unitPrice: -1,
    lineTotal: -1,
    uniqueId: -1,
  };
  if (!headers) return cMap;
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] == null ? "" : headers[c]).replace(/\s/g, "");
    if (!h) continue;
    if (
      h.indexOf("주문일자") !== -1 ||
      h.indexOf("주문일") !== -1 ||
      h.indexOf("발주일") !== -1 ||
      /월\/일/.test(h) ||
      (h.indexOf("일자") !== -1 &&
        h.indexOf("납기") === -1 &&
        h.indexOf("유효") === -1 &&
        h.indexOf("만기") === -1 &&
        (h === "일자" ||
          /YYYYMMDD|yyyyMMdd/i.test(h) ||
          h.indexOf("주문") !== -1))
    ) {
      cMap.date = c;
    } else if (
      (h.indexOf("업체") !== -1 ||
        h.indexOf("공급") !== -1 ||
        h.indexOf("대리") !== -1) &&
      (h.indexOf("상품코드") !== -1 || h.indexOf("품목코드") !== -1) &&
      h.indexOf("이카운트") === -1
    ) {
      if (cMap.vendorSku === -1) cMap.vendorSku = c;
    } else if (h.indexOf("품번") !== -1 && h.indexOf("품목명") === -1) {
      if (cMap.code === -1) cMap.code = c;
    } else if (
      h.indexOf("이카운트코드") !== -1 ||
      h.indexOf("품목코드") !== -1 ||
      h.indexOf("상품코드") !== -1 ||
      h.indexOf("검색창") !== -1 ||
      (h.indexOf("이카운트") !== -1 && h.indexOf("코드") !== -1)
    ) {
      cMap.code = c;
    } else if (h.indexOf("거래처코드") !== -1) {
      cMap.clientCode = c;
    } else if (h.indexOf("거래처명") !== -1) {
      cMap.client = c;
    } else if (h.indexOf("거래처") !== -1) {
      cMap.client = c;
    } else if (
      h.indexOf("변환상품명") !== -1 ||
      h.indexOf("변환품목명") !== -1 ||
      (h.indexOf("변환") !== -1 &&
        (h.indexOf("상품명") !== -1 || h.indexOf("품목명") !== -1))
    ) {
      if (cMap.itemAlt === -1) cMap.itemAlt = c;
    } else if (
      h.indexOf("품목명") !== -1 ||
      h.indexOf("상품명") !== -1 ||
      (h.indexOf("품목") !== -1 &&
        h.indexOf("품목코드") === -1 &&
        h.indexOf("상품코드") === -1 &&
        h.indexOf("이카운트") === -1)
    ) {
      cMap.item = c;
    } else if (h.indexOf("순번") !== -1) {
      if (cMap.seq === -1) cMap.seq = c;
    } else if (h.indexOf("배송방식") !== -1) {
      if (cMap.shipMethod === -1) cMap.shipMethod = c;
    } else if (
      h.indexOf("박스수량") !== -1 ||
      h.indexOf("택배수량") !== -1 ||
      h.indexOf("판매수량") !== -1
    ) {
      if (cMap.qty === -1) cMap.qty = c;
    } else if (
      h.indexOf("수량") !== -1 &&
      h.indexOf("택배") === -1 &&
      h.indexOf("박스") === -1
    ) {
      if (cMap.qty === -1) cMap.qty = c;
    } else if (
      h.indexOf("배송메시지") !== -1 ||
      h.indexOf("배송메세지") !== -1 ||
      h.indexOf("배송요청") !== -1 ||
      h.indexOf("특기사항") !== -1
    ) {
      cMap.msg = c;
    } else if (h.indexOf("송장") !== -1 || h.indexOf("운송장") !== -1) {
      cMap.invoice = c;
    } else if (h.indexOf("적요") !== -1) {
      if (cMap.voucherMemo === -1) cMap.voucherMemo = c;
    } else if (h.indexOf("상태") !== -1) {
      cMap.status = c;
    } else if (
      h.indexOf("정산단가") !== -1 ||
      h.indexOf("확정단가") !== -1 ||
      h.indexOf("정산금액") !== -1
    ) {
      if (cMap.unitPrice === -1) cMap.unitPrice = c;
    } else if (
      (h.indexOf("합계") !== -1 ||
        h.indexOf("주문금액") !== -1 ||
        (h.indexOf("금액") !== -1 &&
          h.indexOf("단가") === -1 &&
          h.indexOf("공급") === -1 &&
          h.indexOf("부가") === -1)) &&
      h.indexOf("운임") === -1 &&
      h.indexOf("배송비") === -1
    ) {
      if (cMap.lineTotal === -1) cMap.lineTotal = c;
    } else if (h.indexOf("고유ID") !== -1) {
      cMap.uniqueId = c;
    } else if (h.indexOf("주소1") !== -1) {
      if (cMap.addr1 === -1) cMap.addr1 = c;
    } else if (h.indexOf("보내는") !== -1 && h.indexOf("주소") !== -1) {
      if (cMap.addrSender === -1) cMap.addrSender = c;
    } else if (
      (h.indexOf("받는") !== -1 && h.indexOf("주소") !== -1) ||
      h.indexOf("수취인주소") !== -1 ||
      h.indexOf("수하인주소") !== -1 ||
      (h.indexOf("배송지") !== -1 && h.indexOf("주소") !== -1)
    ) {
      if (cMap.addrRecv === -1) cMap.addrRecv = c;
    } else if (h.indexOf("주소") !== -1) {
      if (cMap.addr === -1) cMap.addr = c;
    } else if (
      (h.indexOf("모바일") !== -1 || h.indexOf("휴대폰") !== -1) &&
      h.indexOf("보내는") === -1 &&
      h.indexOf("송하인") === -1
    ) {
      if (cMap.mobile === -1) cMap.mobile = c;
    } else if (
      (h.indexOf("연락처") !== -1 ||
        h.indexOf("전화번호") !== -1 ||
        h.indexOf("받는전화") !== -1 ||
        h.indexOf("수하인번호") !== -1 ||
        h === "전화") &&
      h.indexOf("보내는") === -1 &&
      h.indexOf("송하인") === -1 &&
      h.indexOf("(지정)") === -1 &&
      h.indexOf("(고정)") === -1
    ) {
      cMap.phone = c;
    } else if (
      h.indexOf("수취인") !== -1 ||
      h.indexOf("수령인") !== -1 ||
      h.indexOf("받는사람") !== -1 ||
      h.indexOf("받는분") !== -1 ||
      h.indexOf("고객명") !== -1 ||
      h.indexOf("받으시는") !== -1 ||
      (h.indexOf("수하인") !== -1 &&
        h.indexOf("주소") === -1 &&
        h.indexOf("번호") === -1) ||
      (h.indexOf("이름") !== -1 &&
        h.indexOf("품목") === -1 &&
        h.indexOf("상품") === -1)
    ) {
      cMap.recipient = c;
    }
  }
  // ★ 적요(voucherMemo)를 상태(status) 폴백으로 사용하지 않음
  // → 적요는 세트상세 전용, 상태는 별도 "상태(자동)" 열 전용
  return cMap;
}

// ═══════════════════════════════════════════
//  이식: ingestInvoiceSheetTabIntoMap_ → _pt_ingestInvoiceSheetTabIntoMap
// ═══════════════════════════════════════════
function _pt_ingestInvoiceSheetTabIntoMap(
  invTab,
  invoiceMap,
  labelForLog,
  scannedLogs,
  fixedColIdx, // 선택적 로젠고정형식: { name, phone, invoice, uidIdx, item, icode, qty }
  preloadedData, // 선택적: 이미 읽은 배열 데이터 (원본 시트에서 재사용 시)
) {
  if (!invTab && !preloadedData) {
    scannedLogs.push("[" + labelForLog + "] 탭 없음");
    return false;
  }
  var lr = preloadedData ? preloadedData.length : invTab.getLastRow();
  if (lr <= 1) {
    scannedLogs.push("[" + labelForLog + "] 데이터가 비어있습니다.");
    return false;
  }
  var lc = preloadedData
    ? preloadedData[0]
      ? preloadedData[0].length
      : 1
    : invTab.getLastColumn();
  var invData = preloadedData || invTab.getRange(1, 1, lr, lc).getValues();
  var headers = invData[0];
  var nameIdx = fixedColIdx ? fixedColIdx.name : -1,
    phoneIdx = fixedColIdx ? fixedColIdx.phone : -1,
    invoiceIdx = fixedColIdx ? fixedColIdx.invoice : -1,
    uidIdx = fixedColIdx ? fixedColIdx.uid : -1,
    sabangnetUidIdx = -1, // 사방넷주문번호 전용
    itemIdx = fixedColIdx ? fixedColIdx.item : -1;
  if (!fixedColIdx) {
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c]).replace(/\s/g, "");
      if (
        nameIdx === -1 &&
        h.match(
          /수취인명|수령인명|받는분명|받으시는분|수취인|수령인|수령자|받는사람|받는분|고객명|이름|성명|성함|주문자명|고객/,
        ) &&
        !h.match(/주소|전화|연락|핸드|휴대|보내는|송하인|배송지|코드/)
      )
        nameIdx = c;
      if (
        phoneIdx === -1 &&
        h.match(
          /연락처|전화|모바일|핸드폰|휴대폰|수하인전화|수하인번호|받는전화/,
        ) &&
        !h.match(/보내는|송하인|주소/)
      )
        phoneIdx = c;
      if (
        invoiceIdx === -1 &&
        h.match(/송장|운송장|바코드|택배번호/) &&
        !h.match(/반품/)
      )
        invoiceIdx = c;
      if (sabangnetUidIdx === -1 && h.match(/사방넷주문번호/))
        sabangnetUidIdx = c;
      if (
        uidIdx === -1 &&
        h.match(/사방넷주문번호|고유ID|주문번호|적요|배송메시지/)
      )
        uidIdx = c;
      if (
        itemIdx === -1 &&
        h.match(/품목|상품|물품|상세|내용/) &&
        !h.match(/코드/)
      )
        itemIdx = c;
    }
  }
  if ((invoiceIdx === -1 || phoneIdx === -1) && invData.length > 1) {
    var row2 = invData[1];
    for (var c2 = 0; c2 < row2.length; c2++) {
      var h2 = String(row2[c2]).replace(/\s/g, "");
      if (!h2) continue;
      if (
        nameIdx === -1 &&
        h2.match(
          /수취인명|수령인명|받는분명|받으시는분|수취인|수령인|수령자|받는사람|받는분|고객명|이름|성명|성함|주문자명|고객/,
        ) &&
        !h2.match(/주소|전화|연락|핸드|휴대|보내는|송하인|배송지|코드/)
      )
        nameIdx = c2;
      if (
        phoneIdx === -1 &&
        h2.match(
          /연락처|전화|모바일|핸드폰|휴대폰|수하인전화|수하인번호|받는전화/,
        ) &&
        !h2.match(/보내는|송하인|주소/)
      )
        phoneIdx = c2;
      if (
        invoiceIdx === -1 &&
        h2.match(/송장|운송장|바코드|택배번호/) &&
        !h2.match(/반품/)
      )
        invoiceIdx = c2;
      if (
        uidIdx === -1 &&
        h2.match(/사방넷주문번호|고유ID|주문번호|적요|배송메시지/)
      )
        uidIdx = c2;
      if (
        itemIdx === -1 &&
        h2.match(/품목|상품|물품|상세|내용/) &&
        !h2.match(/코드/)
      )
        itemIdx = c2;
    }
    if (invoiceIdx !== -1) invData = invData.slice(1);
  }
  if (invoiceIdx === -1) {
    // ★ 디버그: 열 감지 실패 시 헤더 출력
    Logger.log(
      "[송장스캔디버그] [" +
        labelForLog +
        "] itemIdx=" +
        itemIdx +
        " uidIdx=" +
        uidIdx +
        " invoiceIdx=" +
        invoiceIdx +
        " 헤더: " +
        headers.slice(0, 15).join(" | "),
    );
    scannedLogs.push(
      "[" +
        labelForLog +
        "] '송장' 관련 열 찾기 실패. 헤더: " +
        headers.slice(0, 10).join(", "),
    );
    return true;
  }
  var matchedRows = 0;
  // ★ 디버그: 열 감지 결과
  var itemHeader = itemIdx !== -1 ? String(headers[itemIdx]) : "(없음)";
  var sampleDetail =
    itemIdx !== -1 && invData.length > 1
      ? String(invData[1][itemIdx]).substring(0, 60)
      : "(없음)";
  Logger.log(
    "[송장스캔디버그] [" +
      labelForLog +
      "] itemIdx=" +
      itemIdx +
      "(" +
      itemHeader +
      ") uidIdx=" +
      uidIdx +
      " invoiceIdx=" +
      invoiceIdx +
      " 샘플detail=" +
      JSON.stringify(sampleDetail),
  );
  for (var i = 1; i < invData.length; i++) {
    var invNum = String(invData[i][invoiceIdx]).trim();
    if (!invNum) continue;
    var n = nameIdx !== -1 ? String(invData[i][nameIdx]).trim() : "";
    var rawPhone = phoneIdx !== -1 ? String(invData[i][phoneIdx]) : "";
    var p = rawPhone.replace(/[^0-9]/g, "");
    var shortP = p.length >= 4 ? p.substring(p.length - 4) : p;
    var key = n + "_" + shortP;

    var detailBlock = "";
    if (itemIdx !== -1) detailBlock = String(invData[i][itemIdx]);
    else if (invoiceIdx > 0) detailBlock = String(invData[i][invoiceIdx - 1]);
    var invEntry = { invRaw: invNum, detailRaw: detailBlock };

    // ★ UID 키는 이름/전화 유무와 무관하게 항상 독립 생성 (구조 버그 수정)
    var sbUidKey =
      sabangnetUidIdx !== -1
        ? String(invData[i][sabangnetUidIdx] || "").trim()
        : "";
    if (sbUidKey && sbUidKey.length > 2) {
      if (!invoiceMap[sbUidKey]) invoiceMap[sbUidKey] = [];
      invoiceMap[sbUidKey].push(invEntry);
    }
    if (uidIdx !== -1 && invData[i][uidIdx]) {
      var uidKey = String(invData[i][uidIdx]).trim();
      if (
        uidKey &&
        uidKey !== key &&
        uidKey !== sbUidKey &&
        uidKey.length > 2
      ) {
        if (!invoiceMap[uidKey]) invoiceMap[uidKey] = [];
        invoiceMap[uidKey].push(invEntry);
      }
    }

    // 이름+전화 기반 키 (이름 또는 전화가 있을 때만)
    if (key && key.length > 2) {
      if (!invoiceMap[key]) invoiceMap[key] = [];
      invoiceMap[key].push(invEntry);
      matchedRows++;
      // 전화 앞7 보조키
      if (n && p.length >= 7) {
        var prefixKey = n + "_P" + p.substring(0, 7);
        if (!invoiceMap[prefixKey]) invoiceMap[prefixKey] = [];
        invoiceMap[prefixKey].push(invEntry);
      }
      // ── 정규화 키 (한글/영문/숫자만 남김 — &, ＆, 공백, 특수문자 차이 대응) ──
      var nNorm = n.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, "");
      var normKey = nNorm + "_" + shortP;
      if (normKey !== key && normKey.length > 2) {
        if (!invoiceMap[normKey]) invoiceMap[normKey] = [];
        invoiceMap[normKey].push(invEntry);
      }
      // 공백제거 + P7 보조키
      if (nNorm && p.length >= 7) {
        var normP7 = nNorm + "_P" + p.substring(0, 7);
        if (normP7 !== prefixKey) {
          if (!invoiceMap[normP7]) invoiceMap[normP7] = [];
          invoiceMap[normP7].push(invEntry);
        }
      }
      // ── 이름 단독 키 (정규화 이름) ──
      if (nNorm && nNorm.length >= 2) {
        var nameOnlyKey = "N_" + nNorm;
        if (!invoiceMap[nameOnlyKey]) invoiceMap[nameOnlyKey] = [];
        invoiceMap[nameOnlyKey].push(invEntry);
      }
      // ── 원본 이름 단독 키 (trim만 한 원본 그대로) ──
      if (n && n.length >= 2) {
        var nameRawKey = "NR_" + n;
        if (!invoiceMap[nameRawKey]) invoiceMap[nameRawKey] = [];
        invoiceMap[nameRawKey].push(invEntry);
      }
      // ── 전화번호 단독 키 (전체 번호) ──
      if (p.length >= 8) {
        var phoneKey = "PH_" + p;
        if (!invoiceMap[phoneKey]) invoiceMap[phoneKey] = [];
        invoiceMap[phoneKey].push(invEntry);
      }
    }
  }
  var totalDataRows = invData.length - 1; // 헤더 제외 전체 행 수
  scannedLogs.push(
    "[" + labelForLog + "] 발주 " + totalDataRows + "건 / 송장 " + matchedRows + "건 인식 성공",
  );
  return true;
}

// ═══════════════════════════════════════════
//  협력업체 허브 전용: 세트 상품 슬롯 계산
//  독립배포 허브: hubRow[6]=품목명, hubRow[7]=수량
//  협력업체 허브: hubRow[5]=품목명, hubRow[6]=수량  ← 열 번호가 다름!
// ═══════════════════════════════════════════
function _pt_parsePositiveInt(rawQty) {
  if (rawQty === "" || rawQty == null) return 1;
  var n = Number(rawQty);
  if (!isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function _pt_getRequiredParcelSlots(hubRow) {
  // 협력업체 허브: index 6 = 수량, index 5 = 품목명
  var qty = _pt_parsePositiveInt(hubRow && hubRow[6]);
  var name = String((hubRow && hubRow[5]) || "");
  if (/세트/i.test(name)) qty *= 2;
  qty = Math.max(1, qty);
  if (qty > 50) qty = 50;
  return qty;
}

// ═══════════════════════════════════════════
//  협력업체 허브 전용: 송장 후보 중 best 선택
//  품목명 열 = index 5 (독립배포는 6)
// ═══════════════════════════════════════════
function _pt_scoreInvoiceCandidate(detail, itemName) {
  var dRaw = String(detail || "").toUpperCase();
  var item = String(itemName || "").toUpperCase();
  var dtTokens = dRaw.match(/[A-Z0-9가-힣]+/g) || [];
  var score = 0;
  var hasOpposite = false;
  for (var t = 0; t < dtTokens.length; t++) {
    var tk = dtTokens[t];
    if (
      tk.match(/^[A-Z][0-9]?$/) ||
      tk.match(/^[0-9]+파이$/) ||
      tk === "소" ||
      tk === "중" ||
      tk === "대" ||
      tk === "특대"
    ) {
      if (item.indexOf(tk) === -1) hasOpposite = true;
      else score += 100;
    } else if (item.indexOf(tk) !== -1) {
      score += 1;
    }
  }
  if (hasOpposite) score -= 1000;
  return score;
}

function _pt_pickInvoicesForHubRow(
  candidates,
  hubRow,
  need,
  globalUsedInvoices,
) {
  // 협력업체 허브: index 5 = 품목명
  var itemName = String(hubRow && hubRow[5] ? hubRow[5] : "");
  var picked = [];
  // ★ 후보가 1개뿐이면 스코어 필터 완화 (1:1 매칭은 무조건 배정)
  var isStrict = candidates.length > need;
  for (var n = 0; n < need; n++) {
    var best = null;
    for (var cc = 0; cc < candidates.length; cc++) {
      var cand = candidates[cc];
      if (!cand || !cand.inv || globalUsedInvoices[cand.inv]) continue;
      var score = _pt_scoreInvoiceCandidate(cand.detail, itemName);
      if (isStrict && score < 0) continue; // 다수 후보일 때만 엄격 필터
      if (!best || score > best.score) {
        best = { inv: cand.inv, score: score, detail: cand.detail };
      }
    }
    if (!best) break;
    globalUsedInvoices[best.inv] = true;
    // ★ detail에서 "---" 뒤의 세트 상세 추출 (예: "JH 300파이 소 백색 ---몸통만" → "몸통만")
    var setDetail = "";
    if (best.detail) {
      var dashIdx = best.detail.indexOf("---");
      if (dashIdx !== -1) {
        setDetail = best.detail.substring(dashIdx + 3).trim();
      }
    }
    picked.push({ inv: best.inv, setDetail: setDetail });
  }
  return picked;
}

// ═══════════════════════════════════════════
//  이식: orderSyncManager.gs → _partnerHelpers.gs
//  독립배포 시스템 삭제 대비 — _partnerOrders.gs에서 직접 호출하는 함수들
// ═══════════════════════════════════════════

/**
 * 이식: isTerminalOrderStatus_ (orderSyncManager.gs L.288)
 * 취소/품절/반품 상태인지 확인 → 송장 매칭에서 제외할 종결 상태 판별
 */
function isTerminalOrderStatus_(status) {
  var s = String(status || "").replace(/\s/g, "");
  if (!s) return false;
  return (
    s.indexOf("취소") !== -1 ||
    s.indexOf("품절") !== -1 ||
    s.indexOf("반품") !== -1
  );
}

/**
 * 이식: normalizeHubRecipientPhoneKey_ (orderSyncManager.gs L.277)
 * 수취인명 + 전화번호 끝 4자리로 그룹핑 키 생성
 */
function normalizeHubRecipientPhoneKey_(name, phoneRaw) {
  var n = String(name || "").trim();
  var p = String(phoneRaw || "").replace(/[^0-9]/g, "");
  var shortP = p.length >= 4 ? p.substring(p.length - 4) : p;
  return n + "_" + shortP;
}

/**
 * 이식: parseInvoiceLinesFromMatchedRows_ (orderSyncManager.gs L.369)
 * 매칭된 행 배열에서 미사용 송장번호 목록을 추출
 */
function parseInvoiceLinesFromMatchedRows_(matchedArr, globalUsedInvoices) {
  var out = [];
  var seen = {}; // iv → index in out[]
  for (var m = 0; m < matchedArr.length; m++) {
    var invRaw = String(matchedArr[m].invRaw || "");
    var detailRaw = String(matchedArr[m].detailRaw || "");
    var iSplit = invRaw.split(/\r?\n|,\s*/);
    var dSplit = detailRaw.split(/\r?\n/);
    var maxLen = Math.max(iSplit.length, dSplit.length);
    for (var z = 0; z < maxLen; z++) {
      var iv = String(iSplit[z] || iSplit[0] || "").trim();
      var dt = String(dSplit[z] || dSplit[0] || "").trim();
      if (!iv) continue;
      if (globalUsedInvoices && globalUsedInvoices[iv]) continue;
      if (seen[iv] != null) {
        // ★ 중복 송장: "---" 세트 상세가 있는 detail을 우선 채택
        // (로젠주문실적에서 먼저 들어온 detail보다 입력_세트분리시트의 "---" 포함 detail 우선)
        if (
          dt.indexOf("---") !== -1 &&
          out[seen[iv]].detail.indexOf("---") === -1
        ) {
          out[seen[iv]].detail = dt;
        }
        continue;
      }
      seen[iv] = out.length;
      out.push({ inv: iv, detail: dt });
    }
  }
  return out;
}

/**
 * 이식: toComparableOrderDateValue_ (orderSyncManager.gs L.433)
 * 주문일자를 비교 가능한 숫자값으로 변환 (그룹 내 발주 정렬용)
 */
function toComparableOrderDateValue_(rawDate) {
  if (rawDate instanceof Date) return rawDate.getTime();
  var raw = String(rawDate || "").replace(/[^0-9]/g, "");
  if (!raw) return 9999999999999;
  if (raw.length >= 8) return parseInt(raw.substring(0, 8), 10);
  return parseInt(raw, 10);
}

// ═══════════════════════════════════════════════════════════════
//  동기화 동시 실행 방지 락 (Sync Mutex)
//  - ScriptProperties에 락 정보를 저장해 다른 사용자의 동시 실행 차단
//  - 15분 경과 시 자동 만료 (스크립트 중단 등 예외 상황 대비)
// ═══════════════════════════════════════════════════════════════
var _SYNC_LOCK_KEY_ = "PACK2U_SYNC_LOCK";
var _SYNC_LOCK_TTL_MS_ = 15 * 60 * 1000; // 15분

/**
 * 동기화 락 획득 시도.
 * @param {string} fnLabel  메시지에 표시할 동기화 이름 (예: "이카운트 전체 동기화")
 * @returns {boolean}  true = 락 획득 성공(실행 가능), false = 다른 사용자가 진행 중
 */
function _acquireSyncLock_(fnLabel) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(_SYNC_LOCK_KEY_);
  var now = Date.now();

  if (raw) {
    try {
      var lock = JSON.parse(raw);
      var elapsed = now - (lock.since || 0);
      if (elapsed < _SYNC_LOCK_TTL_MS_) {
        // 락이 유효 — 다른 사용자가 실행 중
        var elapsedMin = Math.floor(elapsed / 60000);
        var elapsedSec = Math.floor((elapsed % 60000) / 1000);
        var msg =
          "🔒 다른 계정이 동기화 중입니다.\n\n" +
          "실행 계정: " + (lock.email || "알 수 없음") + "\n" +
          "작업 내용: " + (lock.fn || fnLabel) + "\n" +
          "시작 시각: " + new Date(lock.since).toLocaleTimeString("ko-KR") + "\n" +
          "경과 시간: " + elapsedMin + "분 " + elapsedSec + "초\n\n" +
          "잠시 후 다시 시도하거나, 15분 이상 경과 시 자동 해제됩니다.";
        try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
        return false;
      }
    } catch (e) {
      // 파싱 실패 → 잔여 락 무시
    }
  }

  // 락 없음 또는 만료 → 새 락 설정
  var email = "";
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  props.setProperty(_SYNC_LOCK_KEY_, JSON.stringify({
    email: email,
    fn: fnLabel,
    since: now
  }));
  return true;
}

/**
 * 동기화 락 해제.
 * try/finally 블록의 finally에서 반드시 호출한다.
 */
function _releaseSyncLock_() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(_SYNC_LOCK_KEY_);
  } catch (e) {}
}

/**
 * 수동으로 락을 강제 해제하는 메뉴용 함수.
 */
function adminForceReleaseSyncLock_() {
  _releaseSyncLock_();
  try {
    SpreadsheetApp.getUi().alert("✅ 동기화 락이 강제 해제되었습니다.");
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════
//  이식: orderSyncManager.gs 공유 상수
//  hubOrderArchive.gs, vendorCustCodeManager.gs 등 비독립배포 파일이 참조
// ═══════════════════════════════════════════════════════════════
var ORDER_TARGET_FOLDER_ID = "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl";
var ORDER_TARGET_FOLDER_ID_LEGACY = "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v";

// ═══════════════════════════════════════════════════════════════
//  자동화 실행 로그 (이식: orderSyncManager.gs → _partnerHelpers.gs)
//  hubOrderArchive.gs가 orderSyncManager.gs 없이 직접 호출할 수 있도록 이식
// ═══════════════════════════════════════════════════════════════
var AUTOMATION_EVENT_LOG_SHEET = "자동화실행로그";

/**
 * "자동화실행로그" 시트를 가져오거나 없으면 생성한다.
 */
function getOrCreateAutomationEventLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(AUTOMATION_EVENT_LOG_SHEET);
  var headers = ["실행시각", "작업유형", "성공", "에러코드", "메시지"];
  if (!sh) {
    sh = ss.insertSheet(AUTOMATION_EVENT_LOG_SHEET);
  }
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    var mismatch = false;
    for (var i = 0; i < headers.length; i++) {
      if (String(current[i] || "") !== headers[i]) {
        mismatch = true;
        break;
      }
    }
    if (mismatch) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sh.getRange(1, 1, 1, headers.length)
    .setBackground("#274e13")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  sh.setFrozenRows(1);
  return sh;
}

/**
 * 자동화 실행 로그 1행 추가.
 * @param {{jobType:string, ok:boolean, code:string, message:string}} p
 */
function appendAutomationEventLog_(p) {
  try {
    var sh = getOrCreateAutomationEventLogSheet_();
    var now = Utilities.formatDate(
      new Date(),
      "Asia/Seoul",
      "yyyy-MM-dd HH:mm:ss",
    );
    var row = [
      now,
      p.jobType || "",
      p.ok ? "Y" : "N",
      p.code || "",
      p.message || "",
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  } catch (e) {
    if (typeof recordAutomationLogFailure_ === "function") {
      recordAutomationLogFailure_(
        "AUTOMATION_EVENT_LOG",
        "jobType=" +
          (p && p.jobType) +
          ", ok=" +
          (p && p.ok) +
          ", code=" +
          (p && p.code) +
          ", msg=" +
          (p && p.message),
        e,
      );
      return;
    }
    try {
      Logger.log(
        "[AUTOMATION_EVENT_LOG_FAIL] " + (e && e.message ? e.message : e),
      );
    } catch (_) {}
  }
}
