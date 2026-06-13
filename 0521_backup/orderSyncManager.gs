// 구글 스크립트 기반 발주(주문) 취합 및 송장 연동 시스템
// ORDER_TARGET_FOLDER_ID, ORDER_TARGET_FOLDER_ID_LEGACY 는 _partnerHelpers.gs 로 이식됨

/** 웹 이관·운영 대비: 월마감/당월탭 배치의 마지막 성공·오류 기록 */
const ARCHIVE_LAST_SUCCESS_AT_KEY = "ARCHIVE_LAST_SUCCESS_AT";
const ARCHIVE_LAST_ERROR_AT_KEY = "ARCHIVE_LAST_ERROR_AT";
const ARCHIVE_LAST_ERROR_CODE_KEY = "ARCHIVE_LAST_ERROR_CODE";
// AUTOMATION_EVENT_LOG_SHEET 상수 및 관련 함수는 _partnerHelpers.gs 로 이식됨
/** priceManager.gs와 동일 키 (건강 요약 UI용) */
const VUH_LAST_OK_KEY = "VENDOR_UPDATE_LAST_SUCCESS_AT";
const VUH_LAST_ERR_AT_KEY = "VENDOR_UPDATE_LAST_ERROR_AT";
const VUH_LAST_ERR_CODE_KEY = "VENDOR_UPDATE_LAST_ERROR_CODE";

function setArchiveScriptHealth_(ok, errorCode) {
  var props = PropertiesService.getScriptProperties();
  var nowIso = Utilities.formatDate(
    new Date(),
    "Asia/Seoul",
    "yyyy-MM-dd HH:mm:ss",
  );
  if (ok) {
    props.setProperty(ARCHIVE_LAST_SUCCESS_AT_KEY, nowIso);
    props.deleteProperty(ARCHIVE_LAST_ERROR_AT_KEY);
    props.deleteProperty(ARCHIVE_LAST_ERROR_CODE_KEY);
  } else {
    props.setProperty(ARCHIVE_LAST_ERROR_AT_KEY, nowIso);
    props.setProperty(ARCHIVE_LAST_ERROR_CODE_KEY, errorCode || "UNKNOWN");
  }
}

// getOrCreateAutomationEventLogSheet_ 및 appendAutomationEventLog_ 는
// _partnerHelpers.gs 로 이식됨 — 이 위치에서 삭제

/**
 * 배포 시트 순차 업데이트 + 월마감/당월탭 작업의 마지막 실행 시각·코드를 한 번에 표시합니다.
 */
function showAutomationHealthSummary() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var a =
    "【배포 시트 순차 업데이트】\n" +
    "· 최종 성공: " +
    (props.getProperty(VUH_LAST_OK_KEY) || "-") +
    "\n" +
    "· 마지막 오류 시각: " +
    (props.getProperty(VUH_LAST_ERR_AT_KEY) || "-") +
    "\n" +
    "· 마지막 오류 코드: " +
    (props.getProperty(VUH_LAST_ERR_CODE_KEY) || "-") +
    "\n\n" +
    "【월마감·당월 빈 탭 배치】\n" +
    "· 최종 성공: " +
    (props.getProperty(ARCHIVE_LAST_SUCCESS_AT_KEY) || "-") +
    "\n" +
    "· 마지막 오류 시각: " +
    (props.getProperty(ARCHIVE_LAST_ERROR_AT_KEY) || "-") +
    "\n" +
    "· 마지막 오류 코드: " +
    (props.getProperty(ARCHIVE_LAST_ERROR_CODE_KEY) || "-") +
    "\n\n" +
    "※ 로그 탭: 「업데이트실행로그」「" +
    AUTOMATION_EVENT_LOG_SHEET +
    "」";
  ui.alert("📋 자동화 마지막 실행 상태", a, ui.ButtonSet.OK);
}

function getOrderHubTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("통합 발주 DB");
  if (!sheet) {
    sheet = ss.insertSheet("통합 발주 DB");
    sheet
      .getRange("A1:P1")
      .setValues([
        [
          "수집일시",
          "발주업체",
          "발주고유ID",
          "거래처명",
          "주문일자(YYYYMMDD)",
          "품목코드",
          "품목명",
          "수량",
          "수취인",
          "수취인전화번호",
          "수취인주소",
          "배송메시지",
          "적요",
          "택배사",
          "송장번호",
          "확정단가",
        ],
      ]);
    sheet
      .getRange("A1:P1")
      .setBackground("#38761d")
      .setFontColor("white")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }
  // 확정단가(P열) 가격 표시 형식 통일
  try {
    sheet.getRange("P2:P").setNumberFormat("#,##0");
  } catch (eFmt) {}
  return sheet;
}

function backfillMissingOrderDatesOnTabData_(fullData, cMap, todayYmd) {
  if (!fullData || fullData.length <= 1 || !cMap || cMap.date === -1) return 0;
  var changed = 0;
  var today =
    todayYmd || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  for (var r = 1; r < fullData.length; r++) {
    var row = fullData[r];
    var orderDate = row[cMap.date];
    var stAddrCol = resolveShipToAddressColumn_(cMap);
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
      row[cMap.date] = today;
      changed++;
    }
  }
  return changed;
}

function forEachVendorDeployFile_(fileHandler) {
  var folderIds = [ORDER_TARGET_FOLDER_ID, ORDER_TARGET_FOLDER_ID_LEGACY];
  var seen = {};
  for (var i = 0; i < folderIds.length; i++) {
    var fid = String(folderIds[i] || "").trim();
    if (!fid || seen["FOLDER:" + fid]) continue;
    seen["FOLDER:" + fid] = true;

    var folder;
    try {
      folder = DriveApp.getFolderById(fid);
    } catch (eFolder) {
      continue;
    }

    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (!isVendorDeployFileName_(file.getName())) continue;
      var k = file.getId();
      if (seen[k]) continue;
      seen[k] = true;
      fileHandler(file);
    }
  }
}

function isBlockedByItemStatusForOrder_(rawStatus) {
  var s = String(rawStatus || "").replace(/\s/g, "");
  if (!s) return false;
  // "품절+7"은 판매중으로 간주 (경고 제외)
  if (s.indexOf("품절+7") !== -1) return false;
  return s.indexOf("품절") !== -1 || s.indexOf("단종") !== -1;
}

function isVendorDeployFileName_(name) {
  var n = String(name || "");
  return (
    n.indexOf("[독립 배포]") !== -1 ||
    n.indexOf("[독립배포]") !== -1 ||
    n.indexOf("독립 배포") !== -1 ||
    n.indexOf("독립배포") !== -1
  );
}

function normalizeDeployVendorName_(name) {
  return String(name || "")
    .replace(/\[독립\s*배포\]/g, "")
    .trim();
}

function buildLegacyOrderKey_(vendorName, orderDate, itemCode, phoneRaw) {
  var v = normalizeDeployVendorName_(vendorName);
  var dateStr = "";
  if (orderDate instanceof Date) {
    dateStr = Utilities.formatDate(orderDate, "Asia/Seoul", "MMdd");
  } else {
    var raw = String(orderDate || "").replace(/[^0-9]/g, "");
    if (raw.length >= 8) dateStr = raw.substring(4, 8);
    else if (raw.length >= 4) dateStr = raw.substring(raw.length - 4);
    else dateStr = raw;
  }
  var code = String(itemCode || "").trim();
  var p = String(phoneRaw || "").replace(/[^0-9]/g, "");
  var shortPhone = p.substring(Math.max(0, p.length - 4));
  return v + "-" + dateStr + "-" + code + "-" + shortPhone;
}

var COMBINED_SHIPMENT_STATUS_PREFIX_ = "합배송-대표송장참조";
var COMBINED_SHIPMENT_MIN_SCORE_ = 0;
// 참조행(비대표) 자동 합배송 판정은 더 엄격하게 적용해 오매칭을 방지한다.
var COMBINED_SHIPMENT_REFERENCE_MIN_SCORE_ = 100;

function normalizeHubRecipientPhoneKey_(name, phoneRaw) {
  var n = String(name || "").trim();
  var p = String(phoneRaw || "").replace(/[^0-9]/g, "");
  var shortP = p.length >= 4 ? p.substring(p.length - 4) : p;
  return n + "_" + shortP;
}

function normalizeStatusCompact_(status) {
  return String(status || "").replace(/\s/g, "");
}

function isTerminalOrderStatus_(status) {
  var s = normalizeStatusCompact_(status);
  if (!s) return false;
  return (
    s.indexOf("취소") !== -1 ||
    s.indexOf("품절") !== -1 ||
    s.indexOf("반품") !== -1
  );
}

function isCombinedShipmentReferenceStatus_(status) {
  var s = normalizeStatusCompact_(status);
  if (!s) return false;
  if (s.indexOf(COMBINED_SHIPMENT_STATUS_PREFIX_) === 0) return true;
  return s.indexOf("합배송") === 0;
}

function buildCombinedShipmentReferenceStatus_(representativeUid, invoice) {
  var inv = String(invoice || "").trim();
  if (inv) return "합배송(" + inv + ")";
  return "합배송(송장대기)";
}

/** 허브 H열 수량 → 필요 송장 개수(비합배송 분리배송 가정). 품목명에 '세트'면 수량×2. */
function parsePositiveIntFromHubQty_(rawQty) {
  if (rawQty === "" || rawQty == null) return 1;
  var n = Number(rawQty);
  if (!isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function getRequiredParcelSlotsForHubRow_(hubRow) {
  var qty = parsePositiveIntFromHubQty_(hubRow && hubRow[7]);
  var name = String((hubRow && hubRow[6]) || "");
  if (/세트/i.test(name)) qty *= 2;
  qty = Math.max(1, qty);
  if (qty > 50) qty = 50;
  return qty;
}

/**
 * 후보 중 미사용 송장을 need개까지 행 품목에 맞춰 고른다(매 회차 best 1건).
 */
function pickInvoicesForHubRow_(candidates, hubRow, need, globalUsedInvoices) {
  var itemName = String(hubRow && hubRow[6] ? hubRow[6] : "");
  var picked = [];
  for (var n = 0; n < need; n++) {
    var best = null;
    for (var cc = 0; cc < candidates.length; cc++) {
      var cand = candidates[cc];
      if (!cand || !cand.inv || globalUsedInvoices[cand.inv]) continue;
      var score = scoreInvoiceCandidateForItem_(cand.detail, itemName);
      if (score < COMBINED_SHIPMENT_MIN_SCORE_) continue;
      if (!best || score > best.score) {
        best = { inv: cand.inv, score: score, detail: cand.detail };
      }
    }
    if (!best) break;
    globalUsedInvoices[best.inv] = true;
    picked.push(best.inv);
  }
  return picked;
}

function findDetailForInvoiceInCandidates_(candidates, inv) {
  var iv = String(inv || "").trim();
  for (var i = 0; i < candidates.length; i++) {
    if (String((candidates[i] && candidates[i].inv) || "").trim() === iv) {
      return String(candidates[i].detail || "").trim();
    }
  }
  return "";
}

function rowHasUnusedInvoiceCandidate_(cands, used) {
  for (var ui = 0; ui < cands.length; ui++) {
    if (cands[ui].inv && !used[cands[ui].inv]) return true;
  }
  return false;
}

function parseInvoiceLinesFromMatchedRows_(matchedArr, globalUsedInvoices) {
  var out = [];
  var seen = {};
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
      if (seen[iv]) continue;
      seen[iv] = true;
      out.push({ inv: iv, detail: dt });
    }
  }
  return out;
}

function scoreInvoiceCandidateForItem_(detail, itemName) {
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

function shouldAutoMarkCombinedReference_(
  hubRow,
  representativeUid,
  representativeDetail,
) {
  var rowUid = String(hubRow && hubRow[2] ? hubRow[2] : "").trim();
  var repUid = String(representativeUid || "").trim();
  if (rowUid && repUid && rowUid === repUid) return true;

  var detail = String(representativeDetail || "").trim();
  if (!detail) return false;
  var itemName = String(hubRow && hubRow[6] ? hubRow[6] : "");
  var score = scoreInvoiceCandidateForItem_(detail, itemName);
  return score >= COMBINED_SHIPMENT_REFERENCE_MIN_SCORE_;
}

function toComparableOrderDateValue_(rawDate) {
  if (rawDate instanceof Date) return rawDate.getTime();
  var raw = String(rawDate || "").replace(/[^0-9]/g, "");
  if (!raw) return 9999999999999;
  if (raw.length >= 8) return parseInt(raw.substring(0, 8), 10);
  return parseInt(raw, 10);
}

function fillMissingOrderDatesForAllVendors() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    "🗓️ 독립배포 주문일자 즉시 보정",
    "독립배포 시트 전체를 스캔하여,\n입력된 주문행(C/D/수량/주소 등)이 있는데 주문일자(B열)가 비어있는 행을 오늘 날짜로 채웁니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (ans !== ui.Button.YES) return;

  var changedRows = 0;
  var changedFiles = 0;
  var scannedFiles = 0;
  var todayYmd = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");

  forEachVendorDeployFile_(function (file) {
    scannedFiles++;
    var ss;
    try {
      ss = SpreadsheetApp.openById(file.getId());
    } catch (eOpen) {
      return;
    }

    var fileChanged = 0;
    var tabs = ss.getSheets();
    for (var i = 0; i < tabs.length; i++) {
      var tName = tabs[i].getName();
      if (
        tName.indexOf("단가조회") !== -1 ||
        tName.indexOf("뷰어") !== -1 ||
        tName.indexOf("마감") !== -1
      )
        continue;
      var lr = tabs[i].getLastRow();
      var lc = tabs[i].getMaxColumns();
      if (lr <= 1) continue;
      var fullData = tabs[i].getRange(1, 1, lr, lc).getValues();
      var cMap = buildOrderTabColumnMap_(fullData[0]);
      if (cMap.date === -1) continue;
      var changed = backfillMissingOrderDatesOnTabData_(
        fullData,
        cMap,
        todayYmd,
      );
      if (changed > 0) {
        var colVals = [];
        for (var r = 1; r < fullData.length; r++)
          colVals.push([fullData[r][cMap.date]]);
        tabs[i]
          .getRange(2, cMap.date + 1, colVals.length, 1)
          .setValues(colVals);
        fileChanged += changed;
      }
    }

    if (fileChanged > 0) {
      changedFiles++;
      changedRows += fileChanged;
    }
  });

  ui.alert(
    "✅ 주문일자 즉시 보정 완료\n\n" +
      "스캔 파일: " +
      scannedFiles +
      "개\n" +
      "변경 파일: " +
      changedFiles +
      "개\n" +
      "보정 행수: " +
      changedRows +
      "건",
  );
}

// 판매업체의 발주 데이터를 허브로 취합 (오전 8시/오후 2시)
function pullOrdersFromVendors() {
  var ui = SpreadsheetApp.getUi();
  var hubSheet = getOrderHubTab();

  // 기존에 이미 취합된 고유ID 목록을 가져옵니다 (중복 방지)
  var lastRow = hubSheet.getLastRow();
  var existingIds = {};
  var existingKeySet = {}; // 이름+전화+품목 기반 중복 체크
  if (lastRow > 1) {
    var hubAllData = hubSheet.getRange(2, 1, lastRow - 1, 16).getValues();
    for (var i = 0; i < hubAllData.length; i++) {
      if (hubAllData[i][2]) existingIds[hubAllData[i][2]] = true; // C: 고유ID
      // 기존 전화번호 선행 0 복원
      var existPhone = String(hubAllData[i][9] || "").trim(); // J: 수취인전화번호
      if (/^\d{9,10}$/.test(existPhone) && existPhone.charAt(0) !== "0") {
        hubSheet.getRange(i + 2, 10).setValue("0" + existPhone);
      }
      // 중복 체크용 키: 수취인(I) + 전화뒤4(J) + 품목코드(F)
      var eName = String(hubAllData[i][8] || "").trim();
      var ePhoneDigits = String(hubAllData[i][9] || "").replace(/[^0-9]/g, "");
      var eShort =
        ePhoneDigits.length >= 4
          ? ePhoneDigits.substring(ePhoneDigits.length - 4)
          : ePhoneDigits;
      var eCode = String(hubAllData[i][5] || "").trim();
      if (eName && eCode) {
        existingKeySet[eName + "_" + eShort + "_" + eCode] = true;
      }
    }
  }

  var newOrders = [];
  var deferredStatusWrites_ = []; // ★ 허브 수집 성공 후 "접수완료" 역기록용 deferred 큐
  var skippedMissingReceiverInfo = 0;
  var skippedByStatus = 0; // 상태값 제외(품절임박 등)
  var now = new Date();
  var timeStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

  forEachVendorDeployFile_(function (file) {
    if (isVendorDeployFileName_(file.getName())) {
      var vendorName = normalizeDeployVendorName_(file.getName());
      var ss;
      try {
        ss = SpreadsheetApp.openById(file.getId());
      } catch (e) {
        return;
      }

      // 1. 단가조회 탭 캐싱 (업체별 실시간 단가 스냅샷)
      //    ※ 일반 배포는 "업체명 뷰어", 소비자 DC 배포는 "업체명 단가조회"라서
      //      엄격한 getSheetByName("단가조회") 대신 fuzzy 매칭 헬퍼 사용.
      var priceMap = {};
      var codeByItemName = {};
      var priceTab =
        typeof findViewerSheet_ === "function"
          ? findViewerSheet_(ss)
          : ss.getSheetByName("단가조회");
      if (priceTab) {
        var lrPrice = priceTab.getLastRow();
        if (lrPrice >= 3) {
          // A:G (상태,출고지,코드,품목명,재고,현재가,최종단가)
          var pData = priceTab.getRange(3, 1, lrPrice - 2, 7).getValues();
          for (var p = 0; p < pData.length; p++) {
            var pStatus = String(pData[p][0] || "").trim(); // A열 상태
            var pCode = String(pData[p][2]).replace(/\s/g, ""); // C열 코드
            var pName = String(pData[p][3] || "").trim(); // D열 품목명
            var pVal = pData[p][6]; // G열 최종단가
            if (pCode) {
              priceMap[pCode] = {
                price: pVal,
                itemStatus: pStatus,
                itemName: pName, // 이카운트 기준 품목명 (SET/세트 구분용)
              };
              if (pName && !codeByItemName[pName])
                codeByItemName[pName] = pCode;
            }
          }
        }
      }

      // 2번, 3번 발주 탭 모두 동적 감지 (단가조회·뷰어·마감·전용양식·설정 탭 제외)
      var orderTabs = [];
      var allTabs = ss.getSheets();
      for (var t = 0; t < allTabs.length; t++) {
        var tName = allTabs[t].getName();
        if (
          tName.indexOf("단가조회") === -1 &&
          tName.indexOf("뷰어") === -1 &&
          tName.indexOf("마감") === -1 &&
          tName.indexOf("전용양식") === -1 &&
          tName.indexOf("설정") === -1
        ) {
          orderTabs.push(allTabs[t]);
        }
      }

      // 단가조회(뷰어) 탭 확보 — A1/L1 spill 수식의 참조 대상
      var viewerTabForHeal = null;
      for (var tv = 0; tv < allTabs.length; tv++) {
        var tn = allTabs[tv].getName();
        if (tn.indexOf("단가조회") !== -1 || tn.indexOf("뷰어") !== -1) {
          viewerTabForHeal = allTabs[tv];
          break;
        }
      }

      for (var t = 0; t < orderTabs.length; t++) {
        var orderTab = orderTabs[t];
        var lr = orderTab.getLastRow();
        var lc = orderTab.getMaxColumns();
        if (lr <= 1) continue;

        // A1/L1 spill 수식 self-heal (사용자 붙여넣기/삭제로 깨졌을 때 주기적으로 복구)
        try {
          if (
            viewerTabForHeal &&
            typeof healOrderSpillFormulas_ === "function"
          ) {
            healOrderSpillFormulas_(orderTab, viewerTabForHeal.getName());
          }
        } catch (eHeal) {}

        var fullData = orderTab.getRange(1, 1, lr, lc).getValues();
        var headers = fullData[0];
        var cMap = buildOrderTabColumnMap_(headers);
        if (cMap.date === -1 || cMap.code === -1) continue; // 발주 양식이 아닌 경우 패스 (필수 헤더 누락)

        // 주문일자 자동채움은 메모리에 반영만 해두고 루프 끝에서 일괄 setValues (P3 최적화)
        var dateFillChanged = false;
        var codeFillChanged = false;
        var idFillChanged = false;
        var statusFillChanged = false;
        var changedByBackfill = backfillMissingOrderDatesOnTabData_(
          fullData,
          cMap,
        );
        if (changedByBackfill > 0) dateFillChanged = true;

        for (var r = 1; r < fullData.length; r++) {
          // Row 2부터
          var orderDate = fullData[r][cMap.date];
          var itemCode = fullData[r][cMap.code];
          var itemName =
            cMap.item !== -1 ? String(fullData[r][cMap.item] || "").trim() : "";
          var phone = cMap.phone !== -1 ? fullData[r][cMap.phone] : "";
          // 전화번호가 숫자로 인식되어 선행 0이 빠진 경우 복원
          // 예: 1012345678 → 01012345678, 31-1234-5678 → 031-1234-5678
          var phoneStr = String(phone || "").trim();
          if (/^\d{9,10}$/.test(phoneStr) && phoneStr.charAt(0) !== "0") {
            phoneStr = "0" + phoneStr;
          }
          // 품목명만 입력된 행도 수집되도록 품목코드 자동 보정
          if (
            (!itemCode || String(itemCode).trim() === "") &&
            itemName &&
            codeByItemName[itemName]
          ) {
            itemCode = codeByItemName[itemName];
            fullData[r][cMap.code] = itemCode;
            codeFillChanged = true;
          }

          if (
            !itemCode ||
            String(itemCode).indexOf("상품없음") !== -1 ||
            String(itemCode) === ""
          )
            continue;

          // 거래처명(A열)은 발주탭 A2의 ARRAYFORMULA(단가조회!$AA$1 참조)가 자동 처리하므로
          // 여기서 값으로 박아 수식을 깨뜨리지 않는다. (이전 버전의 "@당장" 오기입 원인)
          // fullData[r][cMap.client]는 현재 스냅샷일 뿐이며, 수집(newOrders)에는 아래 resolvedClient를 사용한다.
          var resolvedClient =
            cMap.client !== -1 ? fullData[r][cMap.client] : "";
          if (!resolvedClient) {
            // 수식 결과가 아직 비어있더라도 허브 수집에서만 파일명 기반 업체명을 임시로 사용
            resolvedClient = vendorName;
          }

          var strPhone = phoneStr.replace(/[^0-9]/g, "");
          var shortPhone = strPhone.substring(strPhone.length - 4);
          var recipientVal =
            cMap.recipient !== -1
              ? String(fullData[r][cMap.recipient] || "").trim()
              : "";
          var addrCol = resolveShipToAddressColumn_(cMap);
          var addrVal =
            addrCol !== -1 ? String(fullData[r][addrCol] || "").trim() : "";
          var phoneVal = phoneStr;

          // 필수 입력값 누락 시 수집 제외:
          // 수취인 / 전화번호 / 주소 중 하나라도 비어있으면 허브로 올리지 않음
          if (!recipientVal || !phoneVal || !addrVal) {
            skippedMissingReceiverInfo++;
            continue;
          }

          var iData = priceMap[String(itemCode).replace(/\s/g, "")] || {
            price: "",
            stock: 99999,
          };

          // 템플릿의 하드코딩된 단가 및 ID를 1순위로 채택 (없을 시 기존 생성방식으로 백업)
          var hardcodedPrice =
            cMap.unitPrice !== -1 && fullData[r][cMap.unitPrice] !== ""
              ? fullData[r][cMap.unitPrice]
              : iData.price;
          var unitPrice = hardcodedPrice;

          var hardcodedId =
            cMap.uniqueId !== -1 && fullData[r][cMap.uniqueId] !== ""
              ? String(fullData[r][cMap.uniqueId])
              : "";
          var dateStr =
            orderDate instanceof Date
              ? Utilities.formatDate(orderDate, "Asia/Seoul", "MMdd")
              : String(orderDate);

          // 같은 고객/같은 품목을 여러 번 주문해도 각 "행"이 다른 주문으로 수집되도록
          // 고유ID가 비어 있으면 행 단위 신규 ID를 발급하고 시트에 저장한다.
          var uniqueId = hardcodedId;
          if (!uniqueId) {
            uniqueId =
              Utilities.formatDate(new Date(), "Asia/Seoul", "MMdd") +
              "-" +
              (r + 1) +
              "-" +
              Utilities.getUuid().substring(0, 4);
            if (cMap.uniqueId !== -1) {
              fullData[r][cMap.uniqueId] = uniqueId;
              idFillChanged = true;
            }
          }

          var rawStatus =
            cMap.status !== -1
              ? String(fullData[r][cMap.status] || "").trim()
              : "";
          var statusCompact = rawStatus.replace(/\s/g, "");

          // ★ 수집 제외 상태: 품절임박 (재고 부족 예고 상태 — 발주 접수 불가)
          if (statusCompact.indexOf("품절임박") !== -1) {
            skippedByStatus++;
            continue;
          }
          var wasStockWarning =
            statusCompact.indexOf("재고부족") !== -1 ||
            statusCompact.indexOf("🚨재고부족") !== -1 ||
            statusCompact.indexOf("🚨품절") !== -1 ||
            statusCompact.indexOf("🚨단종") !== -1;
          var currentStatus =
            statusCompact.indexOf("취소") !== -1 ||
            statusCompact.indexOf("품절") !== -1 ||
            statusCompact.indexOf("발송완료") !== -1
              ? rawStatus
              : "접수완료";

          // 품절/단종 상태 갱신 (경고성 상태만 즉시 기입, "접수완료"는 허브 수집 후 deferred로)
          if (
            currentStatus === "접수완료" ||
            currentStatus === "접수 대기" ||
            currentStatus === "재고부족" ||
            currentStatus === "🚨재고부족" ||
            currentStatus === "🚨품절" ||
            currentStatus === "🚨단종"
          ) {
            if (isBlockedByItemStatusForOrder_(iData.itemStatus)) {
              var itemStat = String(iData.itemStatus || "").replace(/\s/g, "");
              if (itemStat.indexOf("단종") !== -1) {
                currentStatus = "🚨단종";
              } else {
                currentStatus = "🚨품절";
              }
            } else if (wasStockWarning || !rawStatus) {
              // ★ rawStatus가 비어있으면 즉시 기입하지 않음 — 허브 수집 성공 후 deferred로 처리
              currentStatus = "접수완료";
            }
          }

          // ★ 경고 상태(품절/단종/확인필요)만 즉시 기입, "접수완료"는 허브 성공 후 역기록
          var isWarningStatus = currentStatus.indexOf("🚨") !== -1 || currentStatus.indexOf("🔴") !== -1;
          if (isWarningStatus &&
            cMap.status !== -1 &&
            String(fullData[r][cMap.status] || "").trim() !== currentStatus
          ) {
            fullData[r][cMap.status] = currentStatus;
            statusFillChanged = true;
          }
          // "접수완료"는 허브 배치 후 deferred 큐에만 넣음 (아래 newOrders에서 작동)
          if (!isWarningStatus && cMap.status !== -1 &&
              String(fullData[r][cMap.status] || "").trim() !== currentStatus) {
            deferredStatusWrites_.push({
              tab: orderTab,
              row: r + 1,
              col: cMap.status + 1,
              status: currentStatus
            });
          }

          // 이름+전화+품목 기반 중복 체크
          var dupKey =
            recipientVal + "_" + shortPhone + "_" + String(itemCode).trim();
          if (!existingIds[uniqueId] && !existingKeySet[dupKey]) {
            // 주문일자를 문자열 YYYYMMDD로 정규화 (숫자가 날짜시리얼로 오해석되는 버그 방지)
            var orderDateStr;
            if (orderDate instanceof Date) {
              orderDateStr = Utilities.formatDate(
                orderDate,
                "Asia/Seoul",
                "yyyyMMdd",
              );
            } else {
              orderDateStr = String(orderDate || "").replace(/[^0-9]/g, "");
              if (orderDateStr.length > 8)
                orderDateStr = orderDateStr.substring(0, 8);
            }
            newOrders.push([
              timeStr, // 수집일시
              vendorName, // 발주업체 (파일명 기반 식별자)
              uniqueId, // 발주고유ID
              resolvedClient, // 거래처명 (수식 결과 or 파일명 fallback)
              orderDateStr, // 주문일자 (문자열 YYYYMMDD)
              itemCode, // 품목코드
              // 이카운트코드 기준 품목명 우선 (SET/세트 구분 정확성 보장)
              iData.itemName ||
                (cMap.item !== -1 ? fullData[r][cMap.item] : ""), // 품목명
              cMap.qty !== -1 ? fullData[r][cMap.qty] : "", // 수량
              cMap.recipient !== -1 ? fullData[r][cMap.recipient] : "", // 수취인
              phoneStr, // 수취인전화번호 (선행0 복원됨)
              addrCol !== -1 ? fullData[r][addrCol] : "", // 수취인주소
              cMap.msg !== -1 ? fullData[r][cMap.msg] : "", // 배송메시지
              currentStatus, // 적요 (재고부족 반영됨)
              "", // 택배사
              cMap.invoice !== -1 ? fullData[r][cMap.invoice] : "", // 송장번호
              unitPrice, // P: 확정단가 (영구 동결)
            ]);
            existingIds[uniqueId] = true;
            existingKeySet[dupKey] = true;
          }
        }

        // 주문일자 자동채움 배치 반영: 변경이 있으면 날짜 열 2행~끝 1회 setValues
        if (dateFillChanged && cMap.date !== -1) {
          var dRows = fullData.length - 1;
          if (dRows > 0) {
            var dateVals = [];
            for (var rd = 1; rd < fullData.length; rd++)
              dateVals.push([fullData[rd][cMap.date]]);
            orderTab.getRange(2, cMap.date + 1, dRows, 1).setValues(dateVals);
          }
        }
        if (codeFillChanged && cMap.code !== -1) {
          var cRows = fullData.length - 1;
          if (cRows > 0) {
            var codeVals = [];
            for (var rc = 1; rc < fullData.length; rc++)
              codeVals.push([fullData[rc][cMap.code]]);
            orderTab.getRange(2, cMap.code + 1, cRows, 1).setValues(codeVals);
          }
        }
        if (idFillChanged && cMap.uniqueId !== -1) {
          var iRows = fullData.length - 1;
          if (iRows > 0) {
            var idVals = [];
            for (var ri2 = 1; ri2 < fullData.length; ri2++)
              idVals.push([fullData[ri2][cMap.uniqueId]]);
            orderTab.getRange(2, cMap.uniqueId + 1, iRows, 1).setValues(idVals);
          }
        }
        if (statusFillChanged && cMap.status !== -1) {
          var sRows = fullData.length - 1;
          if (sRows > 0) {
            var statusVals2 = [];
            for (var rs2 = 1; rs2 < fullData.length; rs2++)
              statusVals2.push([fullData[rs2][cMap.status]]);
            orderTab
              .getRange(2, cMap.status + 1, sRows, 1)
              .setValues(statusVals2);
          }
        }
      }
    }
  });

  if (newOrders.length > 0) {
    var startRow = hubSheet.getLastRow() + 1;
    hubSheet.getRange(startRow, 1, newOrders.length, 16).setValues(newOrders);
    // 이번에 쓴 확정단가 구간(P열)도 천단위 콤마 표시
    try {
      hubSheet
        .getRange(startRow, 16, newOrders.length, 1)
        .setNumberFormat("#,##0");
    } catch (eFmtWrite) {}

    // 수집 배치별 교차 색상 (흰색 ↔ 옅은 회색)
    try {
      var COLOR_WHITE = "#ffffff";
      var COLOR_GRAY = "#f3f3f3";
      var prevColor = COLOR_WHITE;
      if (startRow > 2) {
        prevColor = hubSheet.getRange(startRow - 1, 1).getBackground();
      }
      var batchColor = prevColor === COLOR_GRAY ? COLOR_WHITE : COLOR_GRAY;
      hubSheet
        .getRange(startRow, 1, newOrders.length, 16)
        .setBackground(batchColor);
    } catch (eColor) {}
    SpreadsheetApp.flush();

    // \u2605 \ud5c8\ube0c \uae30\ub85d \uc131\uacf5 \u2192 \uc5c5\uccb4 \uc2dc\ud2b8\uc5d0 \"\uc811\uc218\uc644\ub8cc\" \uc5ed\uae30\ub85d (deferred)
    // newOrders\uc5d0\ub294 [0]\ucc98\uc5d0 uid\uac00 \uc5c6\uc9c0\ub9cc, \ub514\ud37c\ub4dc \ud050\ub97c \uc0ac\uc6a9
    if (typeof deferredStatusWrites_ !== "undefined" && deferredStatusWrites_.length > 0) {
      for (var dsi = 0; dsi < deferredStatusWrites_.length; dsi++) {
        try {
          var ds = deferredStatusWrites_[dsi];
          ds.tab.getRange(ds.row, ds.col).setValue(ds.status);
        } catch(eDs) {}
      }
      SpreadsheetApp.flush();
    }

    try {
      if (typeof rebuildSalesStatusPasteSheet_ === "function") {
        rebuildSalesStatusPasteSheet_(hubSheet.getParent(), { silent: true });
      }
    } catch (ePasteHub) {}
    var msg =
      "✅ " + newOrders.length + "건의 신규 발주 데이터가 취합되었습니다.";
    if (skippedMissingReceiverInfo > 0) {
      msg +=
        "\n⚠ 수취인/전화번호/주소 누락으로 제외: " +
        skippedMissingReceiverInfo +
        "건";
    }
    if (skippedByStatus > 0) {
      msg += "\n⚠ 품절임박 상태로 제외: " + skippedByStatus + "건";
    }
    ui.alert(msg);
  } else {
    var emptyMsg = "ℹ️ 새로 추가된 발주 건이 없습니다.";
    if (skippedMissingReceiverInfo > 0) {
      emptyMsg +=
        "\n⚠ 수취인/전화번호/주소 누락으로 제외: " +
        skippedMissingReceiverInfo +
        "건";
    }
    if (skippedByStatus > 0) {
      emptyMsg += "\n⚠ 품절임박 상태로 제외: " + skippedByStatus + "건";
    }
    ui.alert(emptyMsg);
  }
}

// 송장/상태 변경본을 각 뷰어로 쏘아주기 (푸시)
function pushInvoicesToVendors() {
  var ui = SpreadsheetApp.getUi();
  var msg = ui.alert(
    "🔄 송장 푸시",
    "현재 통합 발주 DB에 입력된 [택배사] 및 [송장번호]를 각 배포 시트에 덮어쓰기 하시겠습니까?",
    ui.ButtonSet.YES_NO,
  );
  if (msg !== ui.Button.YES) return;

  var hubSheet = getOrderHubTab();
  var hubLr = hubSheet.getLastRow();
  if (hubLr <= 1) return ui.alert("데이터 없음.");

  var hubData = hubSheet.getRange(2, 2, hubLr - 1, 14).getValues();
  // 배열 0~13. 0:발주업체, 1:고유ID, ... 11:적요/상태(M열/13), 13:송장번호(O열/15)

  // 업체별로 데이터 그룹화
  var vendorMap = {};
  for (var i = 0; i < hubData.length; i++) {
    var vName = normalizeDeployVendorName_(hubData[i][0]);
    var uid = hubData[i][1];
    var legacyKey = buildLegacyOrderKey_(
      vName,
      hubData[i][3],
      hubData[i][4],
      hubData[i][8],
    );
    var status = hubData[i][11]; // M열(적요)
    var invoice = hubData[i][13]; // O열(송장번호)
    if (!vName || (!uid && !legacyKey)) continue;
    if (!vendorMap[vName]) vendorMap[vName] = {};
    if (uid) vendorMap[vName][uid] = { status: status, invoice: invoice };
    if (legacyKey)
      vendorMap[vName][legacyKey] = { status: status, invoice: invoice };
  }

  var pushCount = 0;

  forEachVendorDeployFile_(function (file) {
    if (isVendorDeployFileName_(file.getName())) {
      var vendorName = normalizeDeployVendorName_(file.getName());
      if (!vendorMap[vendorName]) return;

      var ss;
      try {
        ss = SpreadsheetApp.openById(file.getId());
      } catch (e) {
        return;
      }
      // 송장 푸시(수정)는 2번 탭(발주 및 송장조회) 에만 반영합니다.
      // (3번 탭은 외부에서 =IMPORTRANGE 로 '불러오기'만 하는 전용 탭이므로, 시스템이 값을 덮어쓰면 수식이 깨짐)
      var orderTabs = [];
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (orderTab) {
        orderTabs.push(orderTab);
      }

      var pushedToVendor = false;

      for (var t = 0; t < orderTabs.length; t++) {
        var orderTab = orderTabs[t];
        var lr = orderTab.getLastRow();
        var lc = orderTab.getMaxColumns();
        if (lr <= 1) continue;

        var fullData = orderTab.getRange(1, 1, lr, lc).getValues();
        var headers = fullData[0];
        var cMap = buildOrderTabColumnMap_(headers);
        if (cMap.date === -1 || cMap.code === -1) continue; // 필수 정보 누락된 양식은 패스

        // 변경분은 fullData(메모리)에만 먼저 반영하고, 루프 종료 후 '열 단위'로 1회만 setValues.
        // (과거: 변경된 셀마다 setValue 호출 → 건수 × 파일 × 2열 = 수백~수천 API 호출)
        // (현재: 변경된 열만 (마지막행-1)행 × 1열 블록 setValues 1회, 열 2개면 최대 2회)
        var hasChanged = false;
        var statusChanged = false;
        var invoiceChanged = false;

        for (var r = 1; r < fullData.length; r++) {
          var orderDate = fullData[r][cMap.date];
          var itemCode = fullData[r][cMap.code];
          var phone = cMap.phone !== -1 ? fullData[r][cMap.phone] : "";
          var phoneStr2 = String(phone || "").trim();
          if (/^\d{9,10}$/.test(phoneStr2) && phoneStr2.charAt(0) !== "0") {
            phoneStr2 = "0" + phoneStr2;
          }

          if (!orderDate || !itemCode) continue;

          var strPhone = phoneStr2.replace(/[^0-9]/g, "");
          var shortPhone = strPhone.substring(strPhone.length - 4);
          var dateStr =
            orderDate instanceof Date
              ? Utilities.formatDate(orderDate, "Asia/Seoul", "MMdd")
              : String(orderDate);

          // pull 시 하드코딩 ID가 있으면 그 값 우선(허브 매핑과 동일 방식)
          var hardcodedId =
            cMap.uniqueId !== -1 && fullData[r][cMap.uniqueId] !== ""
              ? String(fullData[r][cMap.uniqueId])
              : "";
          var uniqueId =
            hardcodedId ||
            vendorName + "-" + dateStr + "-" + itemCode + "-" + shortPhone;
          var legacyKey = buildLegacyOrderKey_(
            vendorName,
            orderDate,
            itemCode,
            phone,
          );

          var match =
            vendorMap[vendorName][uniqueId] || vendorMap[vendorName][legacyKey];
          if (match) {
            var currentStatus =
              cMap.status !== -1 ? fullData[r][cMap.status] : null;
            var currentInvoice =
              cMap.invoice !== -1 ? fullData[r][cMap.invoice] : null;
            var isCombinedRef = isCombinedShipmentReferenceStatus_(
              match.status,
            );

            if (cMap.status !== -1 && currentStatus !== match.status) {
              fullData[r][cMap.status] = match.status;
              statusChanged = true;
              hasChanged = true;
            }
            // 합배송 비대표행(참조상태)은 송장 열 덮어쓰기를 금지한다.
            if (
              cMap.invoice !== -1 &&
              !isCombinedRef &&
              String(currentInvoice) !== String(match.invoice)
            ) {
              fullData[r][cMap.invoice] = String(match.invoice);
              invoiceChanged = true;
              hasChanged = true;
            }
          }
        }

        // 배치 쓰기: 변경된 열만 2행~끝까지 한 번에 기록
        var dataRows = fullData.length - 1;
        if (statusChanged && cMap.status !== -1 && dataRows > 0) {
          var statusVals = [];
          for (var rs = 1; rs < fullData.length; rs++)
            statusVals.push([fullData[rs][cMap.status]]);
          orderTab
            .getRange(2, cMap.status + 1, dataRows, 1)
            .setValues(statusVals);
        }
        if (invoiceChanged && cMap.invoice !== -1 && dataRows > 0) {
          var invoiceVals = [];
          for (var ri = 1; ri < fullData.length; ri++)
            invoiceVals.push([fullData[ri][cMap.invoice]]);
          orderTab
            .getRange(2, cMap.invoice + 1, dataRows, 1)
            .setValues(invoiceVals);
        }

        if (hasChanged) {
          pushedToVendor = true;
        }

        // 정렬 기능 (주문일자 기준 내림차순)
        if (cMap.date !== -1 && orderTab.getLastRow() > 1) {
          orderTab
            .getRange(2, 1, orderTab.getLastRow() - 1, lc)
            .sort([{ column: cMap.date + 1, ascending: false }]);
        }
      }

      if (pushedToVendor) {
        pushCount++;
        SpreadsheetApp.flush();
      }
    }
  });

  ui.alert(
    "✅ " +
      pushCount +
      "개 업체의 뷰어 시트에 송장/상태값이 성공적으로 반영(동기화)되었습니다.",
  );
}

// -------------------------------------------------------------
// [신규] 외부 시스템 연동 파트
// -------------------------------------------------------------

const SUPPLIER_SHEET_ID = "1CH-OXyC-u57PCDzU7u7b-qCPMMUMlQK17iDlFx1XgjQ"; // 1번 링크 (공급업체 발주서)
/** 이카운트코드 → 해당 업체 품목명(대리발송 별칭). gid 미일치 시 탭명 폴백 */
const PROXY_SUPPLIER_ITEM_ALIAS_TAB_GID = 311425781;
const PROXY_SUPPLIER_ITEM_ALIAS_TAB_NAME_FALLBACK = "대리발송";
const INVOICE_SHEET_ID = "1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs"; // 2번 링크 (최종 송장 취합)
/** 동일 스프레드시트(INVOICE_SHEET_ID) 내 보조 탭 — 기본 탭에 없으면 여기서 추가 매칭 */
const INVOICE_SHEET_FALLBACK_GID = 548505068;
const COMBINED_INVOICE_SHEET_ID =
  "1vWdJgmbW_Gwm_2b1pP8mVBxpfYBbUiAduSwkStXxs0Y"; // 합배송 전용
const COMBINED_INVOICE_SHEET_GID = 1403770726; // 합배송 전용 탭 gid
/**
 * [독립배포 발주 탭 역할 — 운영 개념]
 * - 「발주 및 송장조회」: 판매처(배포 업체)가 우리에게 넣는 주문(우리 쪽 입고·통합 수집·송장 푸시의 기본 탭).
 * - 「… 전용양식」: 우리가 받은 주문 중 자체 출고가 아니라 타 공급처에 재발주하는 경로. 공급처 출고·송장 회수는 그 업체 흐름으로 맞춘다.
 * 대리공급 풀 → 배포 반영(`pushProxySupplierOrdersToDeploySheets`)은 「… 전용양식」탭에 값으로 채운다.
 * 라우팅 접두는 업체별대리발송.xlsx 의 `LEFT(품목코드,2)` 와 동일(공백 제거 후 맨 앞 2글자).
 * 품목 표시명·업체코드 매핑은 허브 「누적품목매핑」 우선, 공급 시트 「대리발송」은 보조 병합.
 */
const PROXY_ORDER_POOL_SPREADSHEET_ID = COMBINED_INVOICE_SHEET_ID;
const PROXY_ORDER_SOURCE_TAB_GID = 1981160530;
/**
 * 대리공급 매핑(품목접두·업체코드 → 배포 시트 URL/ID) 읽는 위치.
 * 비우면 실행 중인 허브(활성 스프레드시트)의 「대리공급업체코드」 탭만 사용한다.
 * 값을 넣으면 해당 파일의 PROXY_SUPPLIER_MAP_TAB_GID 탭만 읽고, 허브 탭은 무시된다.
 */
const PROXY_SUPPLIER_MAP_SPREADSHEET_ID = "";
const PROXY_SUPPLIER_MAP_TAB_GID = 332885961;
/** 허브(현재 스프레드시트) 폴백 매핑 탭명 — 외부 매핑 ID가 비어 있을 때만 사용 */
const PROXY_SUPPLIER_MAP_SHEET_NAME = "대리공급업체코드";
/** 비우면 배포 파일 안 이름이 「… 전용양식」으로 끝나는 탭만 사용(시트 생성 시 업체양식 지정한 경우) */
const PROXY_ORDER_VENDOR_FORMAT_TAB_SUFFIX = " 전용양식";
/** 대리공급 풀→전용양식 푸시 시 거래처코드 열에 넣을 고정값(접두 2자 → 이카운트 거래처코드). */
var PROXY_PUSH_FIXED_CLIENT_CODE_BY_PREFIX = {
  NP: "5858800931",
  HR: "5858800931",
};
/**
 * 전용양식 「주소1」열: 출고지(업체 측 주소). 접두별 — NP(뉴파츠) 등. 비어 있으면 해당 열은 건드리지 않음(수동 입력).
 * @type {Object<string,string>}
 */
var PROXY_PUSH_VENDOR_ADDR1_BY_PREFIX = { NP: "", HR: "" };
/** 전용양식 순번 열 최소값(기존 행이 더 크면 그다음 번호 사용). */
var PROXY_PUSH_SEQ_MIN_START_ = 300;
/**
 * 대리발송 시트 수령인(거래처명) 원천 열: 1-based M열 = 0-based 12.
 * (헤더명 불일치해도 이 열 값을 수령인 맵에 넣는다.)
 */
var PROXY_ALIAS_RECIPIENT_COL_0BASED_ = 12;
/**
 * 헤더에서 수령인 열을 못 찾을 때 전용양식 기본 열(0-based). 예: NP 뉴파츠 R열=18→17.
 */
var PROXY_PUSH_RECIPIENT_COL_0BASED_FALLBACK_BY_PREFIX = { NP: 17, HR: 17 };

/**
 * 허브(통합 스프레드시트) 「누적품목매핑」: 팩투유 품목코드→업체 표시 품목명·코드 SSOT.
 * 대리공급 풀→전용양식 시 여기를 우선 적용하고, 없으면 공급 마스터 「대리발송」 탭을 보조로 합친다.
 */
var HUB_VENDOR_ITEM_MAPPING_SHEET_NAME = "누적품목매핑";
/**
 * 허브 활성 파일에 위 이름 탭이 없을 때 사용할 외부 스프레드시트·gid(운영 매핑 파일).
 * 비우면 허브 탭만 검색.
 */
var HUB_VENDOR_ITEM_MAPPING_EXTERNAL_SPREADSHEET_ID =
  "1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE";
var HUB_VENDOR_ITEM_MAPPING_EXTERNAL_TAB_GID = 379869843;

/** 허브 「업체전용양식마스터」— 배포 생성 시 「맞춤양식명」과 매칭되는 전용양식 1행 헤더. */
var VENDOR_EXCLUSIVE_TEMPLATE_MASTER_SHEET_NAME = "업체전용양식마스터";

/**
 * 업체별대리발송.xlsx 의 「양식변환발주처목록」+ 각 업체 탭 1행 기준으로 채움.
 * 엑셀을 바꾼 뒤 워크스페이스에서 `python _extract_embed_headers.py` 로 이 블록을 재생성할 수 있음.
 */
var EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_ = [
  {
    label: "올팩",
    prefix: "AP",
    headerCsv:
      "송장번호|적요|보내는사람(지정)|전화번호1(지정)|전화번호2(지정)|우편번호(지정)|주소(지정)|받는사람|전화번호1|전화번호2|우편번호|주소|상품명1|상품상세1|수량(A타입)|배송메시지|운임구분|운임|운송장번호",
  },
  {
    label: "아주팩",
    prefix: "AJ",
    headerCsv:
      "송장번호|적요|보내는분 성명|보내는분 전화번호|보내는분 주소(전체, 분할)|받는분 성명|받는분 전화번호|받는분 주소(전체, 분할)|품목명|박스수량|박스타입|배송메세지1",
  },
  {
    label: "코라마",
    prefix: "KR",
    headerCsv:
      "송장번호|적요|받으시는 분|받는분총주소|받으시는 분 전화|받는분핸드폰|품번|품목명|수량|특기사항|보내시는 분|보내시는 분 전화|지불조건",
  },
  {
    label: "태양",
    prefix: "TY",
    headerCsv:
      "송장번호|적요|고객명|수하인주소|수하인번호|박스수량|택배운임(합계)|운임구분|품목명|배송메세지|송하인명|송하인주소|송하인번호",
  },
  {
    label: "팩시스",
    prefix: "PS",
    headerCsv:
      "주문번호|받는사람|전화번호1|전화번호2|우편번호|주소|상품명1|상품상세1|수량(A타입)|배송메시지|운임구분|운임|운송장번호|송하인명|송하인전화번호|송하인주소",
  },
  {
    label: "제이씨",
    prefix: "JC",
    headerCsv:
      "월/일 (필수입력)|거래처명(주문번호) (필수입력)|품목명 (필수입력)|수량 (필수입력)|수령인 (필수입력)|수령인연락처 (필수입력)|배송지주소 (필수입력)|적요(배송메시지)|보내는분성명 (고정)|보내는분전화번호 (고정)|보내는분주소(전체, 분할) (고정)",
  },
  {
    label: "하나팩",
    prefix: "HP",
    headerCsv:
      "송장번호|적요|보내는사람|전화번호|보내는사람주소|상품명|수량|받는사람|연락처|주소|배송메시지",
  },
  {
    label: "뉴파츠_NEW",
    prefix: "HR",
    headerCsv:
      "송장번호|적요|일자|순번|거래처코드|거래처명|담당자|출하창고|거래유형|통화|환율|참조|결제조건|유효기간|납기일자|검색창내용|배송방식|수령인|수령인연락처|배송지주소|적요(배송메시지)|변환품목코드|변환품목명|규격|수량|단가|금액1|외화금액|공급가액|부가세|납기일자|적요",
  },
  {
    label: "부원",
    prefix: "BW",
    headerCsv:
      "송장번호|적요|받는사람|전화번호|주소|우편번호|상품명|수량|배송메세지|보내는사람|주소|전화",
  },
  {
    label: "부엉이커피",
    prefix: "OC",
    headerCsv:
      "송장번호|적요|받는사람|전화번호|주소|우편번호|상품명|수량|배송메세지|보내는사람|주소|전화",
  },
  {
    label: "지에스",
    prefix: "GS",
    headerCsv:
      "송장번호|적요|순번|일자-No.|품목코드|품목명|택배박스수량|판매수량|전화|모바일|주소1|배송메시지|합계|거래처명|단품배송비|적요|사방넷주문번호|보내는분|보내는분전화|보내는주소(팩투유)",
  },
  {
    label: "그린우드",
    prefix: "GW",
    headerCsv:
      "송장번호|적요|순번|일자-No.|품목코드|품목명|택배박스수량|판매수량|전화|모바일|주소1|배송메시지|합계|거래처명|단품배송비|적요|사방넷주문번호|보내는분|보내는분전화|보내는주소(팩투유)",
  },
  {
    label: "냅킨코리아",
    prefix: "NK",
    headerCsv:
      "송장번호|적요|받는사람|전화번호|주소|우편번호|상품명|수량|배송메세지|보내는사람|주소|전화",
  },
  {
    label: "인터웍스",
    prefix: "IW",
    headerCsv:
      "송장번호|적요|받는사람|전화번호|주소|우편번호|상품명|박스타입|수량|배송메세지|보내는사람|주소|전화",
  },
  {
    label: "후아코리아",
    prefix: "HU",
    headerCsv:
      "송장번호|적요|받는분(필수)|받는분전화번호|휴대폰번호(필수입력)|받는분주소(전체, 분할)필수입력|품목(필수)|배송메세지1|택배수량(필수입력)|운임구분 (신용/착불) 필수입력|운임|보내는분성명(필수)|보내는분전화번호(필수)",
  },
  {
    label: "선우",
    prefix: "SW",
    headerCsv:
      "송장번호|적요|사용안함|보내는분성명|보내는분전화번호|보내는분기타연락처|보내는분우편번호|보내는분주소(전체, 분할)|받는분성명|받는분전화번호|받는분기타연락처|받는분우편번호|받는분주소(전체, 분할)|품목명|내품명|박스수량|배송메세지1|박스타입|운임구분",
  },
  {
    label: "로엔그린",
    prefix: "LG",
    headerCsv:
      "송장번호|보내는사람(지정)|전화번호1(지정)|전화번호2(지정)|우편번호(지정)|주소(지정)|받는사람|전화번호1|전화번호2|우편번호|주소|상품명1|상품상세1|수량(A타입)|배송메시지|운임구분 신용.선불.착불|운임|운송장번호|운송장번호",
  },
];

/**
 * ── 업체별 직접 열 매핑 (Direct Column Map) ──────────────────────────
 * 자동 헤더 매핑(buildOrderTabColumnMap_) 대신, 업체 접두별로
 * 타겟 열 번호를 직접 지정한다. 모든 인덱스는 0-based (A=0, B=1, …).
 *
 * sourceToTarget[].sourceCol: 소스 풀 탭의 0-based 열 번호.
 *   예) M열 = 12, I열 = 8
 *
 * A·B열(송장번호·적요)은 업체가 직접 기입하므로 시스템이 건드리지 않는다.
 */
var VENDOR_DIRECT_COLUMN_MAP_ = {
  HR: {
    // 뉴파츠
    totalCols: 32,
    dateCol: 2, // C: 해당날짜 (자동 yyyy-MM-dd)
    seqCol: 3, // D: 순번 300번부터 (자동 증가)
    seqMinStart: 300,
    fixedValues: {
      4: "5858800931", // E: 거래처코드 (고정)
      16: "택배", // Q: 배송방식 (고정)
    },
    // F(5)~P(15): 비움
    sourceToTarget: [
      { sourceCol: 12, targetCol: 17, label: "M(거래처명)→R(수령인)" },
      { sourceCol: 8, targetCol: 18, label: "I(모바일)→S(수령인연락처)" },
      { sourceCol: 9, targetCol: 19, label: "J(주소1)→T(배송지주소)" },
      {
        sourceCol: 10,
        targetCol: 20,
        label: "K(배송메세지)→U(적요/배송메시지)",
      },
      { sourceCol: 6, targetCol: 24, label: "G(수량)→Y(수량)" },
    ],
    vendorSkuCol: 21, // V: 변환품목코드
    vendorNameCol: 22, // W: 변환품목명
    // X(23), Z(25)~: 비움
  },
  NK: {
    // 냅킨코리아
    // 전용양식: 송장번호(A)|적요(B)|받는사람(C)|전화번호(D)|주소(E)|우편번호(F)|(빈)(G)|상품명(H)|수량(I)|배송메세지(J)|보내는사람(K)|정산단가(L)|전화(M)
    totalCols: 13,
    sourceToTarget: [
      { sourceCol: 8, targetCol: 2, label: "I(수취인)→C(받는사람)" },
      { sourceCol: 9, targetCol: 3, label: "J(수취인전화)→D(전화번호)" },
      { sourceCol: 10, targetCol: 4, label: "K(수취인주소)→E(주소)" },
      { sourceCol: 6, targetCol: 7, label: "G(품목명)→H(상품명)" },
      { sourceCol: 7, targetCol: 8, label: "H(수량)→I(수량)" },
      { sourceCol: 11, targetCol: 9, label: "L(배송메시지)→J(배송메세지)" },
      { sourceCol: 16, targetCol: 10, label: "Q(보내는분)→K(보내는사람)" },
      { sourceCol: 15, targetCol: 11, label: "P(확정단가)→L(정산단가)" },
      { sourceCol: 17, targetCol: 12, label: "R(보내는분전화)→M(전화)" },
    ],
    vendorSkuCol: 7, // H(상품명) 위치에 변환 품목명 오버라이드
  },
  GW: {
    // 그린우드
    totalCols: 20,
    seqCol: 2, // C: 순번 (자동 증가)
    dateCol: 3, // D: 날짜 (자동 yyyy-MM-dd)
    // A(0): 송장번호 (업체 입력), B(1): 적요 (업체 입력)
    // M(12)합계, O(14)단품배송비, P(15)적요, Q(16)사방넷주문번호: 비움
    sourceToTarget: [
      { sourceCol: 4, targetCol: 5, label: "E(품목명)→F(품목명)" },
      { sourceCol: 5, targetCol: 6, label: "F(택배박스수량)→G(택배박스수량)" },
      { sourceCol: 6, targetCol: 7, label: "G(수량)→H(판매수량)" },
      { sourceCol: 7, targetCol: 8, label: "H(전화)→I(전화)" },
      { sourceCol: 8, targetCol: 9, label: "I(모바일)→J(모바일)" },
      { sourceCol: 9, targetCol: 10, label: "J(주소1)→K(주소1)" },
      { sourceCol: 10, targetCol: 11, label: "K(배송메세지)→L(배송메시지)" },
      { sourceCol: 12, targetCol: 13, label: "M(거래처명)→N(거래처명)" },
      { sourceCol: 16, targetCol: 17, label: "Q(보내는분)→R(보내는분)" },
      {
        sourceCol: 17,
        targetCol: 18,
        label: "R(보내는분전화)→S(보내는분전화)",
      },
      { sourceCol: 18, targetCol: 19, label: "S(보내는분주소)→T(보내는주소)" },
    ],
    vendorSkuCol: 4, // E: 변환품목코드
  },
  TY: {
    // 태양
    totalCols: 23,
    // A(0): 송장번호 (업체 입력), B(1): 적요 (업체 입력)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(고객명)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(수하인주소)" },
      { sourceCol: 8, targetCol: 5, label: "I(모바일)→F(수하인번호)" },
      { sourceCol: 6, targetCol: 7, label: "G(수량)→H(박스수량)" },
      { sourceCol: 4, targetCol: 10, label: "E(품목명)→K(품목명)" },
      { sourceCol: 10, targetCol: 12, label: "K(배송메세지)→M(배송메세지)" },
      { sourceCol: 16, targetCol: 20, label: "Q(보내는분)→U(송하인명)" },
      { sourceCol: 18, targetCol: 21, label: "S(보내는분주소)→V(송하인주소)" },
      { sourceCol: 17, targetCol: 22, label: "R(보내는분전화)→W(송하인번호)" },
    ],
  },
  AJ: {
    // 아주팩
    totalCols: 12,
    // A(0): 송장번호 (업체 입력), B(1): 적요 (업체 입력)
    // K(10): 비움
    sourceToTarget: [
      { sourceCol: 16, targetCol: 2, label: "Q(보내는분)→C(보내는분성명)" },
      {
        sourceCol: 17,
        targetCol: 3,
        label: "R(보내는분전화)→D(보내는분전화번호)",
      },
      { sourceCol: 18, targetCol: 4, label: "S(보내는분주소)→E(보내는분주소)" },
      { sourceCol: 12, targetCol: 5, label: "M(거래처명)→F(받는분성명)" },
      { sourceCol: 8, targetCol: 6, label: "I(모바일)→G(받는분전화번호)" },
      { sourceCol: 9, targetCol: 7, label: "J(주소1)→H(받는분주소)" },
      { sourceCol: 4, targetCol: 8, label: "E(품목명)→I(품목명)" },
      { sourceCol: 6, targetCol: 9, label: "G(수량)→J(박스수량)" },
      { sourceCol: 10, targetCol: 11, label: "K(배송메세지)→L(배송메세지1)" },
    ],
  },
  BW: {
    // 부원
    totalCols: 12,
    // A(0): 송장번호, B(1): 적요 — 업체 입력
    // F(5)우편번호, G(6): 비움
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(주소)" },
      { sourceCol: 4, targetCol: 7, label: "E(품목명)→H(상품명)" },
      { sourceCol: 6, targetCol: 8, label: "G(수량)→I(수량)" },
      { sourceCol: 10, targetCol: 9, label: "K(배송메세지)→J(배송메세지)" },
      { sourceCol: 16, targetCol: 10, label: "Q(보내는분)→K(보내는사람)" },
      { sourceCol: 18, targetCol: 11, label: "S(보내는분주소)→L(주소)" },
      { sourceCol: 17, targetCol: 12, label: "R(보내는분전화)→M(전화)" },
    ],
  },
  KR: {
    // 코라마
    totalCols: 13,
    // A(0): 송장번호, B(1): 적요 — 업체 입력
    // M(12)지불조건: 비움
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받으시는분)" },
      { sourceCol: 9, targetCol: 3, label: "J(주소1)→D(받는분총주소)" },
      { sourceCol: 8, targetCol: 4, label: "I(모바일)→E(받으시는분전화)" },
      { sourceCol: 8, targetCol: 5, label: "I(모바일)→F(받는분핸드폰)" },
      { sourceCol: 3, targetCol: 6, label: "D(품목코드)→G(품번)" },
      { sourceCol: 4, targetCol: 7, label: "E(품목명)→H(품목명)" },
      { sourceCol: 6, targetCol: 8, label: "G(수량)→I(수량)" },
      { sourceCol: 10, targetCol: 9, label: "K(배송메세지)→J(특기사항)" },
      { sourceCol: 16, targetCol: 10, label: "Q(보내는분)→K(보내시는분)" },
      {
        sourceCol: 17,
        targetCol: 11,
        label: "R(보내는분전화)→L(보내시는분전화)",
      },
    ],
  },
  HU: {
    // 후아코리아
    totalCols: 13,
    // A(0): 송장번호, B(1): 적요 — 업체 입력
    // D(3)받는분전화번호, H(7)배송메세지1: 비움
    fixedValues: {
      9: "신용", // J: 운임구분 (고정)
    },
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는분)" },
      { sourceCol: 8, targetCol: 4, label: "I(모바일)→E(휴대폰번호)" },
      { sourceCol: 9, targetCol: 5, label: "J(주소1)→F(받는분주소)" },
      { sourceCol: 4, targetCol: 6, label: "E(품목명)→G(품목)" },
      { sourceCol: 6, targetCol: 8, label: "G(수량)→I(택배수량)" },
      { sourceCol: 13, targetCol: 10, label: "N(단품배송비)→K(운임)" },
      { sourceCol: 16, targetCol: 11, label: "Q(보내는분)→L(보내는분성명)" },
      {
        sourceCol: 17,
        targetCol: 12,
        label: "R(보내는분전화)→M(보내는분전화번호)",
      },
    ],
  },
  IW: {
    // 인터웍스
    totalCols: 13,
    // A(0): 송장번호, B(1): 적요 — 업체 입력
    // F(5)우편번호, H(7)박스타입: 비움
    phoneTargetCols: [3, 12], // D(전화번호), M(전화)
    sourceToTarget: [
      { sourceCol: 12, targetCol: 2, label: "M(거래처명)→C(받는사람)" },
      { sourceCol: 8, targetCol: 3, label: "I(모바일)→D(전화번호)" },
      { sourceCol: 9, targetCol: 4, label: "J(주소1)→E(주소)" },
      { sourceCol: 4, targetCol: 6, label: "E(품목명)→G(상품명)" },
      { sourceCol: 6, targetCol: 8, label: "G(수량)→I(수량)" },
      { sourceCol: 10, targetCol: 9, label: "K(배송메세지)→J(배송메세지)" },
      { sourceCol: 16, targetCol: 10, label: "Q(보내는분)→K(보내는사람)" },
      { sourceCol: 18, targetCol: 11, label: "S(보내는분주소)→L(주소)" },
      { sourceCol: 17, targetCol: 12, label: "R(보내는분전화)→M(전화)" },
    ],
  },
};

function getSheetByGid_(ss, gid) {
  if (!ss || !gid) return null;
  var target = parseInt(gid, 10);
  if (!(target > 0)) return null;
  var tabs = ss.getSheets();
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getSheetId() === target) return tabs[i];
  }
  return null;
}

function getProxySupplierItemAliasSheet_() {
  var ss = SpreadsheetApp.openById(SUPPLIER_SHEET_ID);
  var tab = getSheetByGid_(ss, PROXY_SUPPLIER_ITEM_ALIAS_TAB_GID);
  if (!tab && PROXY_SUPPLIER_ITEM_ALIAS_TAB_NAME_FALLBACK) {
    tab = ss.getSheetByName(PROXY_SUPPLIER_ITEM_ALIAS_TAB_NAME_FALLBACK);
  }
  return tab;
}

function normProxyAliasHeader_(v) {
  return String(v == null ? "" : v).replace(/\s/g, "");
}

/**
 * 공급사 마스터 「대리발송」 탭: 이카운트(허브) 코드 → 업체 품목명.
 * 접두 열이 있으면 (접두,코드) 복합키 우선, 없으면 코드만으로 조회.
 * 거래처명 열(운전 M열): 풀 수취인 대신 전용양식 수령인(R 등)에 넣을 표시명.
 */
function loadProxySupplierEcountItemNameMap_() {
  var byPfxCode = {};
  var byCode = {};
  var byPfxSku = {};
  var byCodeSku = {};
  var byPfxCodeRecipient = {};
  var byCodeRecipient = {};
  var byCodeRoutePrefix = {};
  var out = {
    byPfxCode: byPfxCode,
    byCode: byCode,
    byPfxSku: byPfxSku,
    byCodeSku: byCodeSku,
    byPfxCodeRecipient: byPfxCodeRecipient,
    byCodeRecipient: byCodeRecipient,
    byCodeRoutePrefix: byCodeRoutePrefix,
    rows: 0,
    err: "",
  };
  try {
    var tab = getProxySupplierItemAliasSheet_();
    if (!tab) {
      out.err = "별칭 탭 없음(gid·이름)";
      return out;
    }
    var lr = tab.getLastRow();
    var lc = tab.getLastColumn();
    if (lr < 2 || lc < 1) return out;
    var data = tab.getRange(1, 1, lr, lc).getValues();
    var headers = data[0];
    var pfxIx = -1;
    var codeIx = -1;
    var nameIx = -1;
    var skuIx = -1;
    var c;
    for (c = 0; c < headers.length; c++) {
      var hn = normProxyAliasHeader_(headers[c]);
      if (!hn) continue;
      if (pfxIx === -1 && hn.match(/접두|PREFIX|2자|업체접두/)) pfxIx = c;
      if (codeIx === -1) {
        if (hn.indexOf("이카운트") !== -1 && hn.indexOf("코드") !== -1)
          codeIx = c;
        else if (
          (hn.indexOf("품목코드") !== -1 || hn.indexOf("상품코드") !== -1) &&
          hn.indexOf("업체") === -1 &&
          hn.indexOf("공급") === -1 &&
          hn.indexOf("대리") === -1
        ) {
          codeIx = c;
        }
      }
    }
    for (c = 0; c < headers.length; c++) {
      var hn0 = normProxyAliasHeader_(headers[c]);
      if (!hn0 || c === codeIx) continue;
      if (
        hn0.match(/품목명|상품명/) &&
        hn0.indexOf("이카운트") === -1 &&
        hn0.match(/공급|업체|대리|별칭|매칭/)
      ) {
        nameIx = c;
        break;
      }
    }
    if (nameIx === -1) {
      for (c = 0; c < headers.length; c++) {
        var hn1 = normProxyAliasHeader_(headers[c]);
        if (!hn1 || c === codeIx) continue;
        if (hn1.match(/품목명|상품명/) && hn1.indexOf("이카운트") === -1) {
          nameIx = c;
          break;
        }
      }
    }
    for (c = 0; c < headers.length; c++) {
      var hsk = normProxyAliasHeader_(headers[c]);
      if (!hsk || c === codeIx || c === nameIx) continue;
      if (
        hsk.match(/업체|공급|대리/) &&
        (hsk.indexOf("상품코드") !== -1 || hsk.indexOf("품목코드") !== -1) &&
        hsk.indexOf("이카운트") === -1
      ) {
        skuIx = c;
        break;
      }
    }
    var recipientIx = lc >= 13 ? PROXY_ALIAS_RECIPIENT_COL_0BASED_ : -1;
    if (recipientIx < 0 || recipientIx === codeIx) {
      recipientIx = -1;
      for (c = 0; c < headers.length; c++) {
        if (c === codeIx) continue;
        var hrn = normProxyAliasHeader_(headers[c]);
        if (!hrn) continue;
        if (
          hrn === "거래처명" ||
          (hrn.indexOf("거래처명") !== -1 && hrn.indexOf("코드") === -1)
        ) {
          recipientIx = c;
          break;
        }
      }
    }
    if (codeIx === -1) {
      out.err = "별칭 시트: 이카운트/품목코드 열 없음";
      return out;
    }
    if (nameIx === -1) {
      out.err = "별칭 시트: 업체 품목명 열 없음";
      return out;
    }
    var r;
    for (r = 1; r < data.length; r++) {
      var rawCode = String(data[r][codeIx] == null ? "" : data[r][codeIx])
        .replace(/\s/g, "")
        .trim();
      if (!rawCode) continue;
      var ucode = rawCode.toUpperCase();
      var rawPfx = "";
      var pfx2 = "";
      if (pfxIx !== -1) {
        rawPfx = String(data[r][pfxIx] == null ? "" : data[r][pfxIx])
          .trim()
          .toUpperCase()
          .replace(/\s/g, "");
        pfx2 =
          rawPfx.length >= 2
            ? rawPfx.substring(0, 2)
            : extractProxySupplierRoutePrefixExcel_(rawCode);
      } else {
        pfx2 = extractProxySupplierRoutePrefixExcel_(rawCode) || "";
      }
      var rawRecv =
        recipientIx >= 0
          ? String(
              data[r][recipientIx] == null ? "" : data[r][recipientIx],
            ).trim()
          : "";
      if (rawRecv) {
        byCodeRecipient[ucode] = rawRecv;
        if (pfx2.length >= 2) byPfxCodeRecipient[pfx2 + "\t" + ucode] = rawRecv;
      }

      var rawName = String(
        data[r][nameIx] == null ? "" : data[r][nameIx],
      ).trim();
      if (!rawName) continue;

      out.rows++;
      byCode[ucode] = rawName;
      var rawSku =
        skuIx >= 0
          ? String(data[r][skuIx] == null ? "" : data[r][skuIx]).trim()
          : "";
      if (rawSku) {
        byCodeSku[ucode] = rawSku;
      }
      if (pfx2.length >= 2) {
        byPfxCode[pfx2 + "\t" + ucode] = rawName;
        if (rawSku) byPfxSku[pfx2 + "\t" + ucode] = rawSku;
        byCodeRoutePrefix[ucode] = pfx2.substring(0, 2).toUpperCase();
      }
    }
  } catch (e0) {
    out.err = String(e0.message || e0);
  }
  return out;
}

/** 헤더 공백 제거 — 매핑 탭 공통 */
function normHubMappingHeader_(v) {
  return String(v == null ? "" : v).replace(/\s/g, "");
}

/**
 * 허브 「누적품목매핑」탭 로드. 열 예: 팩투유상품코드, 팩투유상품명, 업체상품명, 업체상품코드, (선택)업체접두.
 * 반환 형식은 loadProxySupplierEcountItemNameMap_ 과 동일(대리공급 푸시에서 병합).
 */
function loadHubVendorItemMappingForProxy_(hubSs) {
  var byPfxCode = {};
  var byCode = {};
  var byPfxSku = {};
  var byCodeSku = {};
  var byPfxCodeRecipient = {};
  var byCodeRecipient = {};
  var byCodeRoutePrefix = {};
  var out = {
    byPfxCode: byPfxCode,
    byCode: byCode,
    byPfxSku: byPfxSku,
    byCodeSku: byCodeSku,
    byPfxCodeRecipient: byPfxCodeRecipient,
    byCodeRecipient: byCodeRecipient,
    byCodeRoutePrefix: byCodeRoutePrefix,
    rows: 0,
    err: "",
  };
  if (!hubSs) {
    out.err = "허브 스프레드시트 없음";
    return out;
  }
  try {
    var tab = hubSs
      ? hubSs.getSheetByName(HUB_VENDOR_ITEM_MAPPING_SHEET_NAME)
      : null;
    var extId = String(
      HUB_VENDOR_ITEM_MAPPING_EXTERNAL_SPREADSHEET_ID || "",
    ).trim();
    if (!tab && extId) {
      var extSs = SpreadsheetApp.openById(extId);
      tab = getSheetByGid_(extSs, HUB_VENDOR_ITEM_MAPPING_EXTERNAL_TAB_GID);
      if (!tab) tab = extSs.getSheetByName(HUB_VENDOR_ITEM_MAPPING_SHEET_NAME);
    }
    if (!tab) {
      out.err =
        "탭 없음 「" +
        HUB_VENDOR_ITEM_MAPPING_SHEET_NAME +
        "」(허브 또는 외부 gid)";
      return out;
    }
    var lr = tab.getLastRow();
    var lc = tab.getLastColumn();
    if (lr < 2 || lc < 1) return out;
    var data = tab.getRange(1, 1, lr, lc).getValues();
    var headers = data[0];
    var codeIx = -1;
    var nameIx = -1;
    var skuIx = -1;
    var pfxIx = -1;
    var c;
    var hn;
    for (c = 0; c < headers.length; c++) {
      hn = normHubMappingHeader_(headers[c]);
      if (!hn) continue;
      if (pfxIx === -1 && hn.match(/업체접두|^접두|PREFIX|2자접두|품목접두/)) {
        pfxIx = c;
      }
      if (codeIx === -1) {
        if (hn.indexOf("팩투유") !== -1 && hn.indexOf("코드") !== -1)
          codeIx = c;
        else if (hn.indexOf("이카운트") !== -1 && hn.indexOf("코드") !== -1)
          codeIx = c;
        else if (
          (hn.indexOf("품목코드") !== -1 || hn.indexOf("상품코드") !== -1) &&
          hn.indexOf("업체") === -1
        ) {
          codeIx = c;
        }
      }
    }
    for (c = 0; c < headers.length; c++) {
      hn = normHubMappingHeader_(headers[c]);
      if (!hn || c === codeIx) continue;
      if (
        hn.match(/업체상품명|업체품목명/) ||
        (hn.indexOf("업체") !== -1 &&
          hn.match(/품목명|상품명/) &&
          hn.indexOf("팩투유") === -1 &&
          hn.indexOf("이카운트") === -1)
      ) {
        nameIx = c;
        break;
      }
    }
    for (c = 0; c < headers.length; c++) {
      hn = normHubMappingHeader_(headers[c]);
      if (!hn || c === codeIx || c === nameIx) continue;
      if (
        hn.match(/업체상품코드|업체품목코드/) ||
        (hn.indexOf("업체") !== -1 &&
          hn.indexOf("코드") !== -1 &&
          hn.indexOf("팩투유") === -1 &&
          hn.indexOf("이카운트") === -1)
      ) {
        skuIx = c;
        break;
      }
    }
    if (codeIx === -1) {
      out.err = "누적품목매핑: 팩투유/이카운트·품목코드 열 없음";
      return out;
    }
    if (nameIx === -1) {
      out.err = "누적품목매핑: 업체상품명 열 없음";
      return out;
    }
    var r;
    for (r = 1; r < data.length; r++) {
      var rawCode = String(data[r][codeIx] == null ? "" : data[r][codeIx])
        .replace(/\s/g, "")
        .trim();
      if (!rawCode) continue;
      var ucode = rawCode.toUpperCase();
      var rawPfx = "";
      var pfx2 = "";
      if (pfxIx !== -1) {
        rawPfx = String(data[r][pfxIx] == null ? "" : data[r][pfxIx])
          .trim()
          .toUpperCase()
          .replace(/\s/g, "");
        pfx2 =
          rawPfx.length >= 2
            ? rawPfx.substring(0, 2)
            : extractProxySupplierRoutePrefixExcel_(rawCode);
      } else {
        pfx2 = extractProxySupplierRoutePrefixExcel_(rawCode) || "";
      }
      var rawName = String(
        data[r][nameIx] == null ? "" : data[r][nameIx],
      ).trim();
      if (!rawName) continue;
      out.rows++;
      byCode[ucode] = rawName;
      var rawSku =
        skuIx >= 0
          ? String(data[r][skuIx] == null ? "" : data[r][skuIx]).trim()
          : "";
      if (rawSku) {
        byCodeSku[ucode] = rawSku;
      }
      if (pfx2.length >= 2) {
        byPfxCode[pfx2 + "\t" + ucode] = rawName;
        if (rawSku) byPfxSku[pfx2 + "\t" + ucode] = rawSku;
        out.byCodeRoutePrefix[ucode] = pfx2.substring(0, 2).toUpperCase();
      }
    }
  } catch (eHub) {
    out.err = String(eHub.message || eHub);
  }
  return out;
}

/** 보조 맵 위에 허브 매핑 행을 덮어씀(동일 키는 허브 우선). */
function overlayProxyAliasBundle_(base, hubOverlay) {
  if (!base || !hubOverlay || hubOverlay.rows === 0) return base;
  function mergeObj(dst, src) {
    if (!src || !dst) return;
    var k;
    for (k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k];
    }
  }
  mergeObj(base.byCode, hubOverlay.byCode);
  mergeObj(base.byPfxCode, hubOverlay.byPfxCode);
  mergeObj(base.byCodeSku, hubOverlay.byCodeSku);
  mergeObj(base.byPfxSku, hubOverlay.byPfxSku);
  mergeObj(base.byCodeRecipient, hubOverlay.byCodeRecipient);
  mergeObj(base.byPfxCodeRecipient, hubOverlay.byPfxCodeRecipient);
  if (!base.byCodeRoutePrefix) base.byCodeRoutePrefix = {};
  mergeObj(base.byCodeRoutePrefix, hubOverlay.byCodeRoutePrefix || {});
  base.rows = (base.rows || 0) + hubOverlay.rows;
  return base;
}

/** 공급 「대리발송」 + 허브 「누적품목매핑」(허브 우선). */
function loadMergedProxyItemAliasBundle_(hubSs) {
  var ext = loadProxySupplierEcountItemNameMap_();
  var hub = loadHubVendorItemMappingForProxy_(hubSs);
  overlayProxyAliasBundle_(ext, hub);
  if ((hub.rows || 0) > 0 && ext.err) ext.err = "";
  return ext;
}

function resolveProxyItemNameForDeploy_(itemCode, pfx, aliasMap) {
  var code = String(itemCode || "")
    .replace(/\s/g, "")
    .trim();
  if (!code || !aliasMap) return "";
  var u = code.toUpperCase();
  if (
    aliasMap.byPfxCode &&
    pfx &&
    String(pfx).length >= 2 &&
    aliasMap.byPfxCode[String(pfx).substring(0, 2).toUpperCase() + "\t" + u]
  ) {
    return aliasMap.byPfxCode[
      String(pfx).substring(0, 2).toUpperCase() + "\t" + u
    ];
  }
  if (aliasMap.byCode && aliasMap.byCode[u]) return aliasMap.byCode[u];
  return "";
}

function resolveProxyVendorSkuForDeploy_(itemCode, pfx, aliasMap) {
  var code = String(itemCode || "")
    .replace(/\s/g, "")
    .trim();
  if (!code || !aliasMap) return "";
  var u = code.toUpperCase();
  var p2 =
    pfx && String(pfx).length >= 2
      ? String(pfx).substring(0, 2).toUpperCase()
      : "";
  if (aliasMap.byPfxSku && p2 && aliasMap.byPfxSku[p2 + "\t" + u]) {
    return aliasMap.byPfxSku[p2 + "\t" + u];
  }
  if (aliasMap.byCodeSku && aliasMap.byCodeSku[u]) return aliasMap.byCodeSku[u];
  return "";
}

/** 대리발송 거래처명 열 → 전용양식 수령인 표기 */
function resolveProxyRecipientFromAlias_(itemCode, pfx, aliasMap) {
  var code = String(itemCode || "")
    .replace(/\s/g, "")
    .trim();
  if (!code || !aliasMap) return "";
  var u = code.toUpperCase();
  if (
    aliasMap.byPfxCodeRecipient &&
    pfx &&
    String(pfx).length >= 2 &&
    aliasMap.byPfxCodeRecipient[
      String(pfx).substring(0, 2).toUpperCase() + "\t" + u
    ]
  ) {
    return aliasMap.byPfxCodeRecipient[
      String(pfx).substring(0, 2).toUpperCase() + "\t" + u
    ];
  }
  if (aliasMap.byCodeRecipient && aliasMap.byCodeRecipient[u]) {
    return aliasMap.byCodeRecipient[u];
  }
  return "";
}

/**
 * 전용양식 헤더 행(표시값)에서 수령인·수취인 열 인덱스. buildOrderTabColumnMap_에 없는 표기 보강.
 */
function findRecipientColumnIndexInDisplayHeaders_(headers) {
  if (!headers || !headers.length) return -1;
  var c;
  for (c = 0; c < headers.length; c++) {
    var h = String(headers[c] == null ? "" : headers[c]).replace(/\s/g, "");
    if (!h) continue;
    if (h.indexOf("적요") !== -1) continue;
    if (
      h.indexOf("수령인") !== -1 ||
      h.indexOf("수취인") !== -1 ||
      h.indexOf("고객명") !== -1 ||
      h.indexOf("받으시는") !== -1
    )
      return c;
    if (h.indexOf("받는사람") !== -1 || h.indexOf("받는분") !== -1) return c;
    if (h.indexOf("수하인") !== -1 || h.indexOf("수령자") !== -1) return c;
  }
  return -1;
}

/** 스프레드시트 ID 또는 전체 URL에서 ID만 추출 (유효하지 않으면 빈 문자열) */
function normalizeSpreadsheetIdFromInput_(raw) {
  var s = String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!s) return "";
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{25,60}$/.test(s)) return s;
  return "";
}

/**
 * 품목코드에서 알파벳만 골라 앞 2자(대문자).
 * 과거 라우팅용. 현재 대리공급 풀·매핑은 `LEFT(TRIM(code),2)`와 동일한
 * `extractProxySupplierRoutePrefixExcel_` 을 쓴다(업체별대리발송.xlsx 기준).
 */
function extractProxySupplierPrefixFromItemCode_(rawCode) {
  var s = String(rawCode || "")
    .trim()
    .toUpperCase();
  var letters = s.replace(/[^A-Z]/g, "");
  if (letters.length >= 2) return letters.substring(0, 2);
  if (s.length >= 2) return s.substring(0, 2).toUpperCase();
  return "";
}

/**
 * 업체별대리발송.xlsx · 구글시트 `LEFT('판매중'!E:E,2)` 와 동일:
 * 공백 제거 후 대문자 문자열의 맨 앞 2글자.
 */
function extractProxySupplierRoutePrefixExcel_(rawCode) {
  var s = String(rawCode || "")
    .replace(/\s/g, "")
    .toUpperCase();
  if (s.length < 2) return "";
  return s.substring(0, 2);
}

/** 대리공급 매핑 시트 — 헤더명·열 순서가 들쭉날쭉해도 URL/ID 열을 찾기 위한 패턴 */
var PROXY_MAP_FILE_HEADER_RE_ =
  /배포시트|배포파일|파일\s*ID|스프레드시트|Spreadsheet|독립배포|문서\s*링크|구글시트|시트주소|시트\s*ID|docs\.google|^URL$|링크/i;
/** 이 헤더 열은 업체명 등 표시용이므로 스프레드시트 ID 열로 쓰지 않음(잘못된 openById 방지) */
var PROXY_MAP_SKIP_AS_FILE_HEADER_RE_ =
  /업체명|거래처명|상호|표시명|별칭|법인명|배포처명|사업자|업체\s*한글|메모|비고/i;
/** 이카운트 품목코드와 동일한 「앞 2자」 라우팅 키 열만 찾는다. 독립배포 설정의 거래처코드(CUST_CD) 헤더는 제외한다. */
var PROXY_MAP_CODE_HEADER_RE_ =
  /품목접두|^접두$|^접두|PREFIX|2자|매칭키|프리픽스|이카운트.*접두|품목코드.*접두/i;
var PROXY_MAP_TAB_HEADER_RE_ = /발주탭|시트명|탭명|대상탭|발주시트/i;

function proxyMapNormHeaders_(headers) {
  var out = [];
  for (var i = 0; i < headers.length; i++) {
    out.push(String(headers[i] == null ? "" : headers[i]).replace(/\s/g, ""));
  }
  return out;
}

/** 접두·파일·탭 열 제외, 거래처명(설정 B5 매칭) 추정 열 */
function findProxyMapVendorNameColumnIx_(hn, nCol, codeIx, fileIx, tabIx) {
  var c;
  for (c = 0; c < nCol; c++) {
    if (c === codeIx || c === fileIx || c === tabIx) continue;
    var h = hn[c];
    if (!h) continue;
    if (h.match(/거래처명|업체명|배포처|설정|상호|표시명|업체\s*한글/))
      return c;
  }
  for (c = 0; c < nCol; c++) {
    if (c === codeIx || c === fileIx || c === tabIx) continue;
    return c;
  }
  return -1;
}

/** 데이터 행에서 해당 열에 스프레드시트 ID/URL이 하나라도 있으면 true */
function columnHasSpreadsheetIdInData_(
  dataRows,
  colIndex,
  maxDataRowExclusive,
) {
  if (!dataRows || colIndex < 0 || dataRows.length < 2) return false;
  var lim = Math.min(dataRows.length, maxDataRowExclusive);
  var r;
  for (r = 1; r < lim; r++) {
    var cell =
      dataRows[r][colIndex] == null ? "" : String(dataRows[r][colIndex]).trim();
    if (normalizeSpreadsheetIdFromInput_(cell)) return true;
  }
  return false;
}

/** 매핑 시트의 업체명 ↔ 독립배포 `설정!B5` 거래처명 매칭용(공백·대리발송- 접두 정리). */
function normalizeProxyMapVendorLabelForMatch_(raw) {
  var s =
    typeof sanitizeVendorText_ === "function"
      ? sanitizeVendorText_(raw)
      : String(raw || "")
          .replace(/\s+/g, " ")
          .trim();
  if (!s) return "";
  s = s
    .replace(/^대리발송[-–_\s]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/** 매핑 행의 거래처명으로 배포 파일 ID 찾기(sanitize·접두 제거·괄호/별칭 변형 순서로 시도). */
function resolveProxyFileIdFromVendorName_(nameRaw, byName) {
  if (!nameRaw || !byName) return "";
  var candidates = [];
  function pushCand(v) {
    if (!v) return;
    if (candidates.indexOf(v) === -1) candidates.push(v);
  }
  if (typeof sanitizeVendorText_ === "function") {
    pushCand(sanitizeVendorText_(nameRaw));
  } else {
    pushCand(String(nameRaw).trim());
  }
  pushCand(normalizeProxyMapVendorLabelForMatch_(nameRaw));
  if (typeof buildVendorCandidateKeys_ === "function") {
    var extras = buildVendorCandidateKeys_(nameRaw);
    var ei;
    for (ei = 0; ei < extras.length; ei++) {
      pushCand(extras[ei]);
    }
  }
  var i;
  for (i = 0; i < candidates.length; i++) {
    if (byName[candidates[i]]) return byName[candidates[i]];
  }
  return "";
}

/**
 * 발주 대상 폴더의 독립배포 파일마다 `설정` 탭 B5(거래처명)를 읽어 키→파일ID 맵 구축.
 */
function buildProxyVendorNameIndexFromDeploySettings_() {
  var byName = {};
  var collisions = [];
  var count = 0;
  if (typeof forEachVendorDeployFile_ !== "function") {
    return { byName: byName, collisions: collisions, count: 0 };
  }
  forEachVendorDeployFile_(function (file) {
    var fid = file.getId();
    var dss;
    try {
      dss = SpreadsheetApp.openById(fid);
    } catch (eOpen) {
      return;
    }
    count++;
    var vendorRaw = "";
    if (typeof readLocalVendorIdentityFromSettings_ === "function") {
      var loc = readLocalVendorIdentityFromSettings_(dss);
      vendorRaw = loc.vendorName || "";
    } else {
      var st = dss.getSheetByName("설정");
      if (st) vendorRaw = String(st.getRange("B5").getValue() || "").trim();
    }
    if (!vendorRaw) return;
    var keys = [];
    var k1 =
      typeof sanitizeVendorText_ === "function"
        ? sanitizeVendorText_(vendorRaw)
        : String(vendorRaw).trim();
    if (k1) keys.push(k1);
    var k2 = normalizeProxyMapVendorLabelForMatch_(vendorRaw);
    if (k2 && keys.indexOf(k2) === -1) keys.push(k2);
    if (typeof buildVendorCandidateKeys_ === "function") {
      var extraKeys = buildVendorCandidateKeys_(vendorRaw);
      var ek;
      for (ek = 0; ek < extraKeys.length; ek++) {
        if (extraKeys[ek] && keys.indexOf(extraKeys[ek]) === -1)
          keys.push(extraKeys[ek]);
      }
    }
    var ki;
    for (ki = 0; ki < keys.length; ki++) {
      var key = keys[ki];
      if (byName[key] && byName[key] !== fid) {
        if (collisions.indexOf(key) === -1) collisions.push(key);
      }
      byName[key] = fid;
    }
  });
  return { byName: byName, collisions: collisions, count: count };
}

/**
 * 권장 레이아웃:
 *   A 품목접두(이카운트 품목코드와 동일한 영문 앞 2자 · 예 AJ KR TY)
 *   B 거래처명(각 독립배포 설정!B5 와 동일)
 *   C 배포 스프레드시트 URL 전체 또는 ID(#gid=… 포함 링크도 가능 · 스크립트는 파일 ID만 사용)
 *   발주탭명 열은 헤더에 발주탭·탭명 등이 있으면 인식.
 * 독립배포 「거래처코드」만 적은 열은 라우팅에 쓰이지 않음 → 두지 않는 것을 권장.
 * C 가 비어 있으면 B 거래처명으로 폴더 내 배포 파일을 찾는다.
 * 접두 열이 A가 아닐 때: 위 패턴 헤더가 있는 열을 접두로 본다.
 * 2열만: A|B URL 또는 A|B 거래처명
 */
function detectProxySupplierMapColumns_(headers, dataRows) {
  var nCol = headers.length;
  var codeIx = -1;
  var fileIx = -1;
  var tabIx = -1;
  var c;
  var r;
  var hn = proxyMapNormHeaders_(headers);
  var scanLimit = Math.min(dataRows ? dataRows.length : 0, 30);

  var explicitCodeIx = -1;
  var explicitTabIx = -1;
  for (c = 0; c < nCol; c++) {
    if (explicitCodeIx === -1 && hn[c].match(PROXY_MAP_CODE_HEADER_RE_))
      explicitCodeIx = c;
    if (explicitTabIx === -1 && hn[c].match(PROXY_MAP_TAB_HEADER_RE_))
      explicitTabIx = c;
  }

  if (nCol >= 3) {
    var cHasUrl = columnHasSpreadsheetIdInData_(dataRows, 2, scanLimit);
    var cHeaderSaysFile =
      hn[2] && String(hn[2]).match(PROXY_MAP_FILE_HEADER_RE_);
    if (cHasUrl || cHeaderSaysFile) {
      var codeIxUse = explicitCodeIx >= 0 ? explicitCodeIx : 0;
      var tabIxUse = explicitTabIx >= 0 ? explicitTabIx : -1;
      var nameIxUse = findProxyMapVendorNameColumnIx_(
        hn,
        nCol,
        codeIxUse,
        2,
        tabIxUse,
      );
      if (nameIxUse < 0) nameIxUse = codeIxUse === 0 ? 1 : 0;
      return {
        codeIx: codeIxUse,
        fileIx: 2,
        nameIx: nameIxUse,
        tabIx: tabIxUse,
      };
    }
    var codeIxUse2 = explicitCodeIx >= 0 ? explicitCodeIx : 0;
    var tabIxUse2 = explicitTabIx >= 0 ? explicitTabIx : -1;
    var nameIxUse2 = findProxyMapVendorNameColumnIx_(
      hn,
      nCol,
      codeIxUse2,
      -1,
      tabIxUse2,
    );
    return {
      codeIx: codeIxUse2,
      fileIx: -1,
      nameIx: nameIxUse2 >= 0 ? nameIxUse2 : 1,
      tabIx:
        tabIxUse2 >= 0
          ? tabIxUse2
          : nCol >= 4 && hn[3] && String(hn[3]).match(PROXY_MAP_TAB_HEADER_RE_)
            ? 3
            : -1,
    };
  }
  if (nCol === 2) {
    var bUrl = columnHasSpreadsheetIdInData_(dataRows, 1, scanLimit);
    var bHead = hn[1] && String(hn[1]).match(PROXY_MAP_FILE_HEADER_RE_);
    if (bUrl || bHead) {
      return { codeIx: 0, fileIx: 1, nameIx: -1, tabIx: -1 };
    }
    return { codeIx: 0, fileIx: -1, nameIx: 1, tabIx: -1 };
  }

  for (c = 0; c < nCol; c++) {
    if (codeIx === -1 && hn[c].match(PROXY_MAP_CODE_HEADER_RE_)) codeIx = c;
    if (tabIx === -1 && hn[c].match(PROXY_MAP_TAB_HEADER_RE_)) tabIx = c;
  }
  if (codeIx === -1) codeIx = 0;

  for (c = 0; c < nCol; c++) {
    if (c === codeIx || c === tabIx) continue;
    var hnF = hn[c];
    if (hnF.match(PROXY_MAP_SKIP_AS_FILE_HEADER_RE_)) continue;
    if (hnF.match(PROXY_MAP_FILE_HEADER_RE_)) {
      fileIx = c;
      break;
    }
  }

  if ((fileIx === -1 || fileIx === codeIx) && dataRows && dataRows.length > 1) {
    var maxR = Math.min(dataRows.length, 15);
    outer: for (c = 0; c < nCol; c++) {
      if (c === codeIx || c === tabIx) continue;
      if (hn[c].match(PROXY_MAP_SKIP_AS_FILE_HEADER_RE_)) continue;
      for (r = 1; r < maxR; r++) {
        var cell = dataRows[r][c] == null ? "" : String(dataRows[r][c]).trim();
        if (normalizeSpreadsheetIdFromInput_(cell)) {
          fileIx = c;
          break outer;
        }
      }
    }
  }

  var nameIx = -1;
  if (codeIx === 0 && fileIx === 2) nameIx = 1;
  else if (codeIx === 0 && fileIx === -1 && nCol >= 2) nameIx = 1;

  return { codeIx: codeIx, fileIx: fileIx, tabIx: tabIx, nameIx: nameIx };
}

function buildProxySupplierDeployMap_(mapSheet) {
  var byPrefix = {};
  var diag = { dataRows: 0, mappedKeys: 0, errors: [], col: null };
  var lr = mapSheet.getLastRow();
  if (lr < 2) {
    diag.errors.push("매핑 시트에 데이터가 없습니다.");
    return { byPrefix: byPrefix, diag: diag };
  }
  var lc = mapSheet.getLastColumn();
  var data = mapSheet.getRange(1, 1, lr, lc).getValues();
  var headers = data[0];
  var col = detectProxySupplierMapColumns_(headers, data);
  diag.col = col;
  var codeIx = col.codeIx;
  var fileIx = col.fileIx;
  var tabIx = col.tabIx;
  var nCol = headers.length;
  var nameIx = col.nameIx != null ? col.nameIx : -1;
  if (
    nameIx < 0 &&
    codeIx === 0 &&
    (fileIx === -1 || fileIx === 2) &&
    nCol >= 2
  ) {
    nameIx = 1;
  }

  if (fileIx >= 0 && fileIx === codeIx) {
    diag.errors.push("배포 열이 접두 열과 겹칩니다. 열·헤더를 확인하세요.");
    return { byPrefix: byPrefix, diag: diag };
  }

  var vendorIdx = buildProxyVendorNameIndexFromDeploySettings_();
  var hasUrlCol = fileIx >= 0;
  var canResolveName =
    nameIx >= 0 && vendorIdx.byName && Object.keys(vendorIdx.byName).length > 0;

  if (!hasUrlCol && !canResolveName) {
    diag.errors.push(
      "배포 URL 열이 없고, 독립배포 폴더의 `설정!B5`(거래처명) 색인으로도 파일을 찾지 못했습니다.\n" +
        "· 매핑 B열은 각 독립배포 시트 **설정 탭 B5와 동일한 거래처명**으로 맞추세요.\n" +
        "· 색인 대상: 발주 대상 폴더의 독립배포 파일만(현재 " +
        vendorIdx.count +
        "개 스캔, 거래처명 키 " +
        Object.keys(vendorIdx.byName).length +
        "개).",
    );
    return { byPrefix: byPrefix, diag: diag };
  }

  if (vendorIdx.collisions.length) {
    diag.errors.push(
      "주의: 설정 B5가 같은 이름인 배포 파일이 있어 나중 파일이 우선합니다 — " +
        vendorIdx.collisions.slice(0, 6).join(", "),
    );
  }

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rawCode = String(row[codeIx] == null ? "" : row[codeIx])
      .trim()
      .toUpperCase()
      .replace(/\s/g, "");
    var fidRaw =
      fileIx >= 0 ? String(row[fileIx] == null ? "" : row[fileIx]).trim() : "";
    var nameRaw =
      nameIx >= 0 ? String(row[nameIx] == null ? "" : row[nameIx]).trim() : "";
    var tabName =
      tabIx !== -1 ? String(row[tabIx] == null ? "" : row[tabIx]).trim() : "";
    if (!rawCode && !fidRaw && !nameRaw) continue;
    diag.dataRows++;
    if (!rawCode || rawCode.length < 2) {
      diag.errors.push("매핑 " + (r + 1) + "행: 업체코드(2자) 없음");
      continue;
    }
    var pfx = extractProxySupplierRoutePrefixExcel_(rawCode);
    if (pfx.length < 2) {
      diag.errors.push(
        "매핑 " +
          (r + 1) +
          "행: 업체코드에서 접두 2자를 만들 수 없습니다(엑셀과 동일하게 코드 맨 앞 2글자).",
      );
      continue;
    }
    if (!/[A-Z]/.test(pfx)) {
      diag.errors.push(
        "매핑 " +
          (r + 1) +
          "행: 접두 「" +
          rawCode +
          "」에 영문이 없습니다. **품목접두 열**(보통 A열)에는 풀 품목코드와 동일한 **영문 2자**(예 AJ, TY)만 넣습니다. 거래처명·배포 URL 열과 바뀌지 않았는지 확인하세요. 「" +
          (nameRaw || "") +
          "」 등 업체명은 **B열**·C URL은 C열에 두세요.",
      );
      continue;
    }
    var fid = normalizeSpreadsheetIdFromInput_(fidRaw);
    if (!fid && nameRaw) {
      fid = resolveProxyFileIdFromVendorName_(nameRaw, vendorIdx.byName);
    }
    if (!fid) {
      diag.errors.push(
        "매핑 " +
          (r + 1) +
          "행: 배포 URL이 비었고, 설정 B5와 맞는 거래처명도 없음 — 「" +
          (nameRaw || fidRaw || "(빈칸)") +
          "」",
      );
      continue;
    }
    byPrefix[pfx] = {
      fileId: fid,
      tabName: tabName,
    };
    diag.mappedKeys++;
  }
  return { byPrefix: byPrefix, diag: diag };
}

function collectUniqueIdsFromDeployOrderTab_(orderTab) {
  var ids = {};
  var lr = orderTab.getLastRow();
  if (lr < 2) return ids;
  var lc = orderTab.getLastColumn();
  var headers = orderTab.getRange(1, 1, 1, lc).getValues()[0];
  var cMap = buildOrderTabColumnMap_(headers);
  if (cMap.uniqueId === -1) return ids;
  var col = cMap.uniqueId + 1;
  var vals = orderTab.getRange(2, col, lr - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var u = String(vals[i][0] || "").trim();
    if (u) ids[u] = true;
  }
  return ids;
}

/**
 * 소스 시트 헤더에서 '이미 반영됨' 표시 열 (있으면)
 */
function findProxySourceDoneColumnIndex_(headers) {
  for (var c = 0; c < headers.length; c++) {
    var hn = String(headers[c] == null ? "" : headers[c]).replace(/\s/g, "");
    if (hn.match(/배포반영|독립배포반영|PUSH|전송완료/)) return c;
  }
  return -1;
}

function parseOrderDateToYmd_(orderDate) {
  if (orderDate instanceof Date) {
    return Utilities.formatDate(orderDate, "Asia/Seoul", "yyyyMMdd");
  }
  var raw = String(orderDate || "").replace(/[^0-9]/g, "");
  if (raw.length >= 8) return raw.substring(0, 8);
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
}

/** 대리공급 푸시: 전용양식(이카운트) 일자 표시 yyyy-MM-dd */
function formatProxyDeployOrderDateDashed_(orderDate) {
  var ymd = parseOrderDateToYmd_(orderDate);
  if (!ymd || String(ymd).length !== 8) return String(ymd || "");
  var s = String(ymd);
  return s.substring(0, 4) + "-" + s.substring(4, 6) + "-" + s.substring(6, 8);
}

/**
 * 전용양식 순번 열: 기존 데이터 최댓값+1 과 최소시작(300) 중 큰 값.
 */
function computeProxyNextSeqStart_(orderTab, seqCol, minStart) {
  var min0 = minStart > 0 ? minStart : 300;
  if (!orderTab || seqCol < 0) return min0;
  var lr = orderTab.getLastRow();
  if (lr < 2) return min0;
  var col = seqCol + 1;
  var vals = orderTab.getRange(2, col, lr - 1, 1).getValues();
  var maxN = 0;
  var i;
  for (i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (v === "" || v == null) continue;
    var n =
      typeof v === "number" && !isNaN(v)
        ? v
        : parseInt(String(v).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n > maxN) maxN = n;
  }
  return Math.max(min0, maxN + 1);
}

/**
 * 시트 생성 시 공급사 양식명을 넣어 만든 「{이름} 전용양식」탭을 찾는다. 없으면 null.
 * 복수면 **헤더(주문일자·품목코드 등) 인식되는 탭**을 우선하고, 없으면 이름순 첫 탭.
 */
function findVendorExclusiveOrderFormatTab_(deploySs) {
  if (!deploySs) return null;
  var sheets = deploySs.getSheets();
  var candidates = [];
  var suf = PROXY_ORDER_VENDOR_FORMAT_TAB_SUFFIX;
  for (var i = 0; i < sheets.length; i++) {
    var n = String(sheets[i].getName() || "");
    if (n.indexOf("마감") !== -1) continue;
    if (n.length >= suf.length && n.substring(n.length - suf.length) === suf) {
      candidates.push(sheets[i]);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(function (a, b) {
    return String(a.getName()).localeCompare(String(b.getName()), "ko");
  });
  if (candidates.length === 1) return candidates[0];
  var k;
  for (k = 0; k < candidates.length; k++) {
    if (resolveOrderTabColumnMapForProxyPush_(candidates[k]))
      return candidates[k];
  }
  return candidates[0];
}

/**
 * @param {string} explicitTabName 매핑 열 값(비우면 전용양식 탭만)
 */
function resolveProxyOrderTargetSheet_(deploySs, explicitTabName) {
  var ex = String(explicitTabName || "").trim();
  if (ex) {
    var t = deploySs.getSheetByName(ex);
    return t || null;
  }
  return findVendorExclusiveOrderFormatTab_(deploySs);
}

function isVendorExclusiveOrderFormatTab_(sheet) {
  if (!sheet) return false;
  var n = String(sheet.getName() || "");
  var suf = PROXY_ORDER_VENDOR_FORMAT_TAB_SUFFIX;
  return n.length >= suf.length && n.substring(n.length - suf.length) === suf;
}

function getProxySupplierMapSheet_(hubSs) {
  var extId = String(PROXY_SUPPLIER_MAP_SPREADSHEET_ID || "").trim();
  if (!extId) {
    return hubSs.getSheetByName(PROXY_SUPPLIER_MAP_SHEET_NAME);
  }
  var mapSs = SpreadsheetApp.openById(extId);
  return getSheetByGid_(mapSs, PROXY_SUPPLIER_MAP_TAB_GID);
}

/**
 * 대리공급 발주 풀(gid 탭) → 매핑(외부 시트 gid 또는 허브 대리공급업체코드) → 독립배포 「… 전용양식」탭에 행 추가.
 * 매핑에 발주탭명을 적은 경우에만 해당 이름 탭 사용.
 * A/L spill heal은 발주 메인 탭 전용이므로 전용양식에서는 호출하지 않음.
 * @param {Object} [opts] - { silent: boolean } silent=true 이면 UI 없이 자동 실행 (트리거용).
 */
function pushProxySupplierOrdersToDeploySheets(opts) {
  opts = opts || {};
  var isSilent = !!opts.silent;
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (eUi) {}
  var hubSs = SpreadsheetApp.getActiveSpreadsheet();
  var mapSrcHint = String(PROXY_SUPPLIER_MAP_SPREADSHEET_ID || "").trim()
    ? "\n매핑: 시트 " +
      PROXY_SUPPLIER_MAP_SPREADSHEET_ID +
      " (gid " +
      PROXY_SUPPLIER_MAP_TAB_GID +
      ")."
    : "\n매핑: 허브 「" + PROXY_SUPPLIER_MAP_SHEET_NAME + "」.";
  if (!isSilent && ui) {
    var ans = ui.alert(
      "대리공급 풀 → 재발주(전용양식)",
      "「발주 및 송장조회」= 우리에게 들어온 주문.\n" +
        "「… 전용양식」= 그중 자체출고가 아니라 타업체에 재발주·해당처 송장회수용.\n\n" +
        "지금 작업은 풀(gid " +
        PROXY_ORDER_SOURCE_TAB_GID +
        ") → 매핑 → 각 배포의 전용양식 탭에 넣습니다." +
        "\n품목 표시명은 허브 「누적품목매핑」 우선 → 공급 「대리발송」 보조입니다." +
        mapSrcHint +
        "\n계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (ans !== ui.Button.YES) return;
  }

  var mapSheet;
  try {
    mapSheet = getProxySupplierMapSheet_(hubSs);
  } catch (eMap) {
    var mapErrMsg =
      "❌ 대리공급 매핑 파일을 열 수 없습니다: " +
      (eMap.message || eMap) +
      "\n실행 계정에 해당 스프레드시트 보기 권한이 있는지 확인하세요.";
    if (!isSilent && ui) ui.alert(mapErrMsg);
    try {
      Logger.log("[PROXY_PUSH] " + mapErrMsg);
    } catch (_) {}
    return;
  }
  if (!mapSheet) {
    var noMapMsg = "";
    if (String(PROXY_SUPPLIER_MAP_SPREADSHEET_ID || "").trim()) {
      noMapMsg =
        "❌ 매핑 파일에서 gid=" +
        PROXY_SUPPLIER_MAP_TAB_GID +
        " 인 탭을 찾을 수 없습니다.";
    } else {
      noMapMsg =
        "❌ 허브에 「" + PROXY_SUPPLIER_MAP_SHEET_NAME + "」 탭이 없습니다.";
    }
    if (!isSilent && ui) ui.alert(noMapMsg);
    try {
      Logger.log("[PROXY_PUSH] " + noMapMsg);
    } catch (_) {}
    return;
  }

  var mapBuilt = buildProxySupplierDeployMap_(mapSheet);
  var byPrefix = mapBuilt.byPrefix;
  var prefixKeys = Object.keys(byPrefix);
  var mapLocLine = "";
  try {
    var mParent = mapSheet.getParent();
    mapLocLine =
      "📍 매핑 출처: 「" +
      mParent.getName() +
      "」 / 탭 「" +
      mapSheet.getName() +
      "」 — 등록 접두 " +
      prefixKeys.length +
      "개";
    if (prefixKeys.length > 0) {
      var pkSorted = prefixKeys.slice().sort();
      mapLocLine +=
        ": " +
        pkSorted.slice(0, 24).join(", ") +
        (pkSorted.length > 24 ? " …" : "");
    }
    if (String(PROXY_SUPPLIER_MAP_SPREADSHEET_ID || "").trim()) {
      mapLocLine +=
        "\n(PROXY_SUPPLIER_MAP_SPREADSHEET_ID 가 설정되어 있어 허브 「대리공급업체코드」가 아닌 위 파일만 사용합니다.)";
    }
  } catch (eML) {}

  if (prefixKeys.length === 0) {
    var colHint = "";
    if (mapBuilt.diag.col) {
      var ci = mapBuilt.diag.col;
      var fileColDisp =
        ci.fileIx >= 0
          ? String(ci.fileIx + 1)
          : "없음(B열=설정!B5 로 파일 찾기)";
      colHint =
        "\n\n열 인식: 접두=" +
        (ci.codeIx + 1) +
        "열, 배포 URL=" +
        fileColDisp +
        (ci.nameIx != null && ci.nameIx >= 0
          ? ", 거래처명=" + (ci.nameIx + 1) + "열"
          : "") +
        (ci.tabIx !== -1 ? ", 발주탭=" + (ci.tabIx + 1) + "열" : "") +
        "\n· B열은 각 독립배포 **설정 탭 B5(거래처명)** 와 같은 문구를 넣으면 URL 없이 매핑됩니다." +
        "\n· C열에는 배포 스프레드시트 **전체 URL**(gid 포함) 또는 파일 ID.\n" +
        "· 품목접두는 이카운트 품목코드와 같은 **영문 앞 2자**(독립배포 거래처코드와 다름).";
    }
    var noPfxMsg =
      "❌ 매핑에서 등록된 접두가 없습니다.\n" +
      (mapLocLine ? mapLocLine + "\n\n" : "") +
      mapBuilt.diag.errors.slice(0, 8).join("\n") +
      colHint +
      "\n\n※ 매칭 규칙: 매핑 시트의 업체코드(영문 접두)는 풀 탭 품목코드와 같은 2자여야 합니다.";
    if (!isSilent && ui) ui.alert(noPfxMsg);
    try {
      Logger.log("[PROXY_PUSH] " + noPfxMsg);
    } catch (_) {}
    return;
  }

  var poolSs;
  try {
    poolSs = SpreadsheetApp.openById(PROXY_ORDER_POOL_SPREADSHEET_ID);
  } catch (eOpen) {
    var openMsg =
      "❌ 발주 풀 파일을 열 수 없습니다: " + (eOpen.message || eOpen);
    if (!isSilent && ui) ui.alert(openMsg);
    try {
      Logger.log("[PROXY_PUSH] " + openMsg);
    } catch (_) {}
    return;
  }

  var srcTab = getSheetByGid_(poolSs, PROXY_ORDER_SOURCE_TAB_GID);
  if (!srcTab) {
    var gidMsg =
      "❌ gid=" + PROXY_ORDER_SOURCE_TAB_GID + " 탭을 찾을 수 없습니다.";
    if (!isSilent && ui) ui.alert(gidMsg);
    try {
      Logger.log("[PROXY_PUSH] " + gidMsg);
    } catch (_) {}
    return;
  }

  var srcLr = srcTab.getLastRow();
  var srcLc = srcTab.getLastColumn();
  if (srcLr < 2 || srcLc < 1) {
    if (!isSilent && ui) ui.alert("ℹ️ 발주 풀 탭에 데이터가 없습니다.");
    return;
  }

  var srcData = srcTab.getRange(1, 1, srcLr, srcLc).getValues();
  var srcHeaders = srcData[0];
  var cMap = buildOrderTabColumnMap_(srcHeaders);
  var doneCol = findProxySourceDoneColumnIndex_(srcHeaders);

  if (cMap.code === -1 || cMap.date === -1) {
    var hdrMsg =
      "❌ 풀 탭 헤더에 품목코드·주문일자 열이 필요합니다. 앞 10열: " +
      srcHeaders.slice(0, 10).join(" | ");
    if (!isSilent && ui) ui.alert(hdrMsg);
    try {
      Logger.log("[PROXY_PUSH] " + hdrMsg);
    } catch (_) {}
    return;
  }

  var pushed = 0;
  var skippedDone = 0;
  var skippedDup = 0;
  var skippedPrefix = 0;
  var errors = [];
  var lastProxyDeployColumnDigest = "";
  var cacheIds = {};
  var cacheSs = {};
  /** cacheKey → { cMap, lc } | { _bad: true } — 업체별 발주 탭 헤더 매핑 1회만 계산 */
  var cacheProxyDeployHdr_ = {};

  var aliasBundle = loadMergedProxyItemAliasBundle_(hubSs);
  var aliasNameHits = 0;
  var aliasSkuHits = 0;
  var aliasRecipientHits = 0;

  for (var r = 1; r < srcData.length; r++) {
    var row = srcData[r];
    if (doneCol !== -1 && String(row[doneCol] || "").trim() === "Y") {
      skippedDone++;
      continue;
    }

    var itemCode = String(row[cMap.code] || "").replace(/\s/g, "");
    if (!itemCode) continue;

    var uItem = itemCode.toUpperCase();
    var pfx = extractProxySupplierRoutePrefixExcel_(itemCode);
    var route = pfx.length >= 2 ? byPrefix[pfx] : null;
    if (
      (!route || pfx.length < 2) &&
      aliasBundle.byCodeRoutePrefix &&
      aliasBundle.byCodeRoutePrefix[uItem]
    ) {
      var rp = String(aliasBundle.byCodeRoutePrefix[uItem] || "").trim();
      if (rp.length >= 2) {
        pfx = rp.substring(0, 2).toUpperCase();
        route = byPrefix[pfx];
      }
    }

    if (!pfx || pfx.length < 2) {
      skippedPrefix++;
      errors.push(
        "행 " +
          (r + 1) +
          ": 접두 미결정 (" +
          itemCode +
          ") — 품목코드 맨 앞 2글자가 접두가 되지 않으면 「누적품목매핑」 업체접두 열로 보정하세요.",
      );
      continue;
    }

    if (!route) {
      skippedPrefix++;
      errors.push(
        "행 " +
          (r + 1) +
          ": 미등록 접두 " +
          pfx +
          " (" +
          itemCode +
          ") — 「대리공급업체코드」에 동일 접두(A열)·배포 URL 행을 추가하세요.",
      );
      continue;
    }

    var recipient =
      cMap.recipient !== -1 ? String(row[cMap.recipient] || "").trim() : "";
    var aliasRecipient = resolveProxyRecipientFromAlias_(
      itemCode,
      pfx,
      aliasBundle,
    );
    var usedAliasRecipient = false;
    if (aliasRecipient) {
      recipient = aliasRecipient;
      usedAliasRecipient = true;
    }
    var phoneVal = "";
    if (cMap.mobile !== -1) phoneVal = String(row[cMap.mobile] || "").trim();
    if (!phoneVal && cMap.phone !== -1)
      phoneVal = String(row[cMap.phone] || "").trim();
    var addrVal = "";
    if (cMap.addrRecv !== -1) addrVal = String(row[cMap.addrRecv] || "").trim();
    if (!addrVal && cMap.addr !== -1)
      addrVal = String(row[cMap.addr] || "").trim();
    if (cMap.recipient === -1) {
      if (!recipient) recipient = "-";
    }

    var orderDateYmd = parseOrderDateToYmd_(row[cMap.date]);
    var orderDateDashed = formatProxyDeployOrderDateDashed_(row[cMap.date]);
    var itemName = cMap.item !== -1 ? String(row[cMap.item] || "").trim() : "";
    var vendorAliasName = resolveProxyItemNameForDeploy_(
      itemCode,
      pfx,
      aliasBundle,
    );
    var displayItemName = vendorAliasName || itemName || "";
    var vendorAliasSku = resolveProxyVendorSkuForDeploy_(
      itemCode,
      pfx,
      aliasBundle,
    );
    var qtyVal = cMap.qty !== -1 ? row[cMap.qty] : 1;
    var lineTotalVal = "";
    if (
      cMap.lineTotal !== -1 &&
      row[cMap.lineTotal] !== "" &&
      row[cMap.lineTotal] != null
    ) {
      lineTotalVal = row[cMap.lineTotal];
    }
    var msgVal = cMap.msg !== -1 ? String(row[cMap.msg] || "").trim() : "";
    var invVal =
      cMap.invoice !== -1 ? String(row[cMap.invoice] || "").trim() : "";

    var uid = "";
    if (cMap.uniqueId !== -1 && row[cMap.uniqueId]) {
      uid = String(row[cMap.uniqueId]).trim();
    }
    if (!uid) {
      uid =
        "PS-" +
        pfx +
        "-" +
        orderDateYmd +
        "-" +
        (r + 1) +
        "-" +
        Utilities.getUuid().substring(0, 8);
    }

    var cacheKey =
      route.fileId +
      "\t" +
      (String(route.tabName || "").trim() || "__EXCLUSIVE__");

    if (!cacheIds[cacheKey]) {
      var dss;
      try {
        dss = SpreadsheetApp.openById(route.fileId);
      } catch (eD) {
        errors.push(
          "파일 열기 실패 " +
            route.fileId +
            ": " +
            (eD.message || eD) +
            (String(route.fileId || "").indexOf(" ") !== -1 ||
            /[\uAC00-\uD7A3]/.test(String(route.fileId || ""))
              ? "\n→ **매핑 시트**(외부 gid 탭 또는 허브 대리공급업체코드)에서 스프레드시트 **URL 또는 ID 열**이 업체명 열과 바뀌지 않았는지 확인하세요."
              : ""),
        );
        cacheIds[cacheKey] = { _bad: true };
        continue;
      }
      var oTab = resolveProxyOrderTargetSheet_(dss, route.tabName);
      if (!oTab) {
        errors.push(
          "「… 전용양식」 없음 또는 매핑 탭명 불일치: " + route.fileId,
        );
        cacheIds[cacheKey] = { _bad: true };
        continue;
      }
      cacheSs[cacheKey] = {
        dss: dss,
        orderTab: oTab,
        _spillHealed: false,
        nextSeq: null,
      };
      cacheIds[cacheKey] = collectUniqueIdsFromDeployOrderTab_(oTab);
    }
    if (cacheIds[cacheKey]._bad) continue;
    if (cacheIds[cacheKey][uid]) {
      skippedDup++;
      if (doneCol !== -1) srcTab.getRange(r + 1, doneCol + 1).setValue("Y");
      continue;
    }

    var entry = cacheSs[cacheKey];
    var dss = entry.dss;
    var orderTab = entry.orderTab;

    if (!entry._spillHealed) {
      var viewerTabForHeal =
        typeof findViewerSheet_ === "function" ? findViewerSheet_(dss) : null;
      try {
        if (
          viewerTabForHeal &&
          typeof healOrderSpillFormulas_ === "function" &&
          !isVendorExclusiveOrderFormatTab_(orderTab)
        ) {
          healOrderSpillFormulas_(orderTab, viewerTabForHeal.getName());
        }
      } catch (eH) {}
      entry._spillHealed = true;
    }

    // ── 직접 열 매핑 모드: VENDOR_DIRECT_COLUMN_MAP_ 에 접두가 있으면 사용 ──
    var directMap = VENDOR_DIRECT_COLUMN_MAP_[pfx];
    if (directMap) {
      var dmTotalCols = directMap.totalCols || 32;

      // 순번 초기화 (캐시, 최초 1회)
      if (directMap.seqCol != null && entry.nextSeq == null) {
        entry.nextSeq = computeProxyNextSeqStart_(
          orderTab,
          directMap.seqCol,
          directMap.seqMinStart || 300,
        );
      }

      var nextRow = orderTab.getLastRow() + 1;
      if (nextRow < 2) nextRow = 2;
      var outRow = [];
      for (var dc = 0; dc < dmTotalCols; dc++) outRow.push("");

      // 날짜 (자동)
      if (directMap.dateCol != null)
        outRow[directMap.dateCol] = orderDateDashed;
      // 순번 (자동 증가)
      if (directMap.seqCol != null) {
        outRow[directMap.seqCol] = entry.nextSeq;
        entry.nextSeq++;
      }
      // 고정값
      if (directMap.fixedValues) {
        var fKeys = Object.keys(directMap.fixedValues);
        for (var fk = 0; fk < fKeys.length; fk++) {
          outRow[parseInt(fKeys[fk], 10)] = directMap.fixedValues[fKeys[fk]];
        }
      }
      // 소스 → 타겟 직접 매핑
      if (directMap.sourceToTarget) {
        for (var st = 0; st < directMap.sourceToTarget.length; st++) {
          var stm = directMap.sourceToTarget[st];
          var srcVal = stm.sourceCol < row.length ? row[stm.sourceCol] : "";
          outRow[stm.targetCol] = srcVal != null ? srcVal : "";
        }
      }
      // 변환 품목코드 / 품목명
      if (directMap.vendorSkuCol != null) {
        outRow[directMap.vendorSkuCol] = vendorAliasSku || itemCode || "";
      }
      if (directMap.vendorNameCol != null) {
        outRow[directMap.vendorNameCol] =
          vendorAliasName || displayItemName || "";
      }

      orderTab.getRange(nextRow, 1, 1, dmTotalCols).setValues([outRow]);
      cacheIds[cacheKey][uid] = true;
      pushed++;
      lastProxyDeployColumnDigest =
        "[직접매핑:" +
        pfx +
        "] " +
        (directMap.sourceToTarget || [])
          .map(function (m) {
            return m.label;
          })
          .join(", ");
      if (vendorAliasName) aliasNameHits++;
      if (vendorAliasSku) aliasSkuHits++;
      if (usedAliasRecipient) aliasRecipientHits++;
      if (doneCol !== -1) srcTab.getRange(r + 1, doneCol + 1).setValue("Y");
      continue;
    }

    // ── 직접 매핑 미등록 접두사는 스킵 (아직 시트가 없는 업체) ──
    if (!directMap) {
      skippedPrefix++;
      continue;
    }

    // ── 기존 자동 헤더 매핑 모드 ──
    if (!cacheProxyDeployHdr_[cacheKey]) {
      var resolvedHdr = resolveOrderTabColumnMapForProxyPush_(orderTab);
      if (!resolvedHdr) {
        var snip = "";
        try {
          var lcc2 = Math.max(Math.min(orderTab.getLastColumn(), 16), 6);
          snip = orderTab
            .getRange(1, 1, 1, lcc2)
            .getDisplayValues()[0]
            .join(" | ");
        } catch (eSn2) {}
        errors.push(
          route.fileId +
            " 발주 탭 헤더 오류 「" +
            orderTab.getName() +
            "」 1행 앞: " +
            snip +
            "\n→ 품목코드·품목명 등 입력 대상 열과 주문일·받는분·주소·전화 중 일부가 **데이터 시작 전 15행 안**에 없습니다. " +
            "표 제목 아래 헤더 행을 두거나, 매핑에 **발주탭명**으로 정확한 「… 전용양식」 이름을 적으세요.",
        );
        cacheProxyDeployHdr_[cacheKey] = { _bad: true };
        continue;
      }
      var hdrDisp = orderTab
        .getRange(resolvedHdr.headerRow, 1, 1, resolvedHdr.lc)
        .getDisplayValues()[0];
      var recipFb = findRecipientColumnIndexInDisplayHeaders_(hdrDisp);
      var vmCol = resolvedHdr.cMap.voucherMemo;
      if (vmCol !== -1 && recipFb === vmCol) recipFb = -1;
      cacheProxyDeployHdr_[cacheKey] = {
        cMap: resolvedHdr.cMap,
        lc: resolvedHdr.lc,
        recipFallback: recipFb,
      };
    }
    if (cacheProxyDeployHdr_[cacheKey]._bad) continue;

    var cMapT = cacheProxyDeployHdr_[cacheKey].cMap;
    var lc = cacheProxyDeployHdr_[cacheKey].lc;

    var nextRow = orderTab.getLastRow() + 1;
    if (nextRow < 2) nextRow = 2;
    var outRow = [];
    for (var c = 0; c < lc; c++) outRow.push("");
    if (cMapT.date !== -1) outRow[cMapT.date] = orderDateDashed;
    if (cMapT.code !== -1) outRow[cMapT.code] = itemCode;
    var hasItemAlt = cMapT.itemAlt !== -1;
    if (cMapT.item !== -1) {
      if (cMapT.code === -1 && itemCode) {
        outRow[cMapT.item] = displayItemName
          ? String(itemCode) + " " + String(displayItemName)
          : String(itemCode);
      } else if (hasItemAlt) {
        outRow[cMapT.item] = itemName;
      } else {
        outRow[cMapT.item] = displayItemName;
      }
    }
    if (hasItemAlt) {
      outRow[cMapT.itemAlt] = vendorAliasName || itemName || "";
    }
    if (cMapT.vendorSku !== -1 && vendorAliasSku) {
      outRow[cMapT.vendorSku] = vendorAliasSku;
    }
    if (cMapT.qty !== -1) outRow[cMapT.qty] = qtyVal;
    if (cMapT.lineTotal !== -1 && lineTotalVal !== "" && lineTotalVal != null) {
      outRow[cMapT.lineTotal] = lineTotalVal;
    }
    var fixedClient = PROXY_PUSH_FIXED_CLIENT_CODE_BY_PREFIX[pfx];
    if (fixedClient && cMapT.clientCode !== -1)
      outRow[cMapT.clientCode] = fixedClient;
    if (cMapT.shipMethod !== -1) outRow[cMapT.shipMethod] = "택배";
    if (cMapT.seq !== -1) {
      if (entry.nextSeq == null) {
        entry.nextSeq = computeProxyNextSeqStart_(
          orderTab,
          cMapT.seq,
          PROXY_PUSH_SEQ_MIN_START_,
        );
      }
      outRow[cMapT.seq] = entry.nextSeq;
      entry.nextSeq++;
    }
    var recipCol = cMapT.recipient;
    if (cMapT.voucherMemo !== -1 && recipCol === cMapT.voucherMemo) {
      recipCol = -1;
    }
    if (recipCol < 0) recipCol = cacheProxyDeployHdr_[cacheKey].recipFallback;
    if (cMapT.voucherMemo !== -1 && recipCol === cMapT.voucherMemo) {
      recipCol = -1;
    }
    if (
      recipCol < 0 &&
      PROXY_PUSH_RECIPIENT_COL_0BASED_FALLBACK_BY_PREFIX[pfx] != null
    ) {
      var recipFb = PROXY_PUSH_RECIPIENT_COL_0BASED_FALLBACK_BY_PREFIX[pfx];
      if (cMapT.voucherMemo === -1 || recipFb !== cMapT.voucherMemo) {
        recipCol = recipFb;
      }
    }
    if (cMapT.voucherMemo !== -1 && recipCol === cMapT.voucherMemo) {
      recipCol = -1;
    }
    var recipVal = String(recipient || "").trim();
    if (aliasRecipient) recipVal = aliasRecipient;
    if (recipCol >= 0 && recipVal) outRow[recipCol] = recipVal;
    if (cMapT.mobile !== -1 && phoneVal) outRow[cMapT.mobile] = phoneVal;
    else if (cMapT.phone !== -1 && phoneVal) outRow[cMapT.phone] = phoneVal;
    if (cMapT.addr1 !== -1) {
      var addr1Fix = PROXY_PUSH_VENDOR_ADDR1_BY_PREFIX[pfx];
      if (addr1Fix) outRow[cMapT.addr1] = addr1Fix;
    }
    if (cMapT.addrRecv !== -1 && addrVal) outRow[cMapT.addrRecv] = addrVal;
    else if (
      cMapT.addr !== -1 &&
      addrVal &&
      cMapT.addr !== cMapT.addrSender &&
      cMapT.addr !== cMapT.addr1
    ) {
      outRow[cMapT.addr] = addrVal;
    }
    if (cMapT.msg !== -1 && msgVal) outRow[cMapT.msg] = msgVal;
    if (
      cMapT.status !== -1 &&
      (cMapT.voucherMemo === -1 || cMapT.status !== cMapT.voucherMemo)
    ) {
      outRow[cMapT.status] = "접수완료";
    }
    if (cMapT.invoice !== -1 && invVal) outRow[cMapT.invoice] = invVal;
    if (
      cMapT.uniqueId !== -1 &&
      (cMapT.voucherMemo === -1 || cMapT.uniqueId !== cMapT.voucherMemo)
    ) {
      outRow[cMapT.uniqueId] = uid;
    }

    if (cMapT.voucherMemo !== -1) outRow[cMapT.voucherMemo] = "";

    orderTab.getRange(nextRow, 1, 1, lc).setValues([outRow]);
    cacheIds[cacheKey][uid] = true;
    pushed++;
    lastProxyDeployColumnDigest = formatProxyDeployColumnDigest_(cMapT);
    if (vendorAliasName) aliasNameHits++;
    if (vendorAliasSku) aliasSkuHits++;
    if (usedAliasRecipient) aliasRecipientHits++;
    if (doneCol !== -1) srcTab.getRange(r + 1, doneCol + 1).setValue("Y");
  }

  SpreadsheetApp.flush();

  try {
    appendAutomationEventLog_({
      jobType: "PROXY_SUPPLIER_PUSH",
      ok: errors.length === 0,
      code: pushed > 0 ? "OK" : "NO_PUSH",
      message:
        "pushed=" +
        pushed +
        ",skipDone=" +
        skippedDone +
        ",skipDup=" +
        skippedDup +
        ",skipPfx=" +
        skippedPrefix,
    });
  } catch (eLog) {}

  var msg =
    "✅ 반영 " +
    pushed +
    "건\n" +
    "건너뜀(이미Y): " +
    skippedDone +
    " · 중복고유ID: " +
    skippedDup +
    " · 접두/미매칭: " +
    skippedPrefix;
  if (mapLocLine) msg += "\n\n" + mapLocLine;
  if (lastProxyDeployColumnDigest && pushed > 0) {
    msg +=
      "\n\n📎 반영 탭 기준 열 매핑: " +
      lastProxyDeployColumnDigest +
      "\n(헤더 표기가 다르면 「업체전용양식마스터」 열 이름을 표준 헤더에 맞추거나 알려 주세요.)";
  }
  var hubMapOnly = loadHubVendorItemMappingForProxy_(hubSs);
  if (hubMapOnly.err && hubMapOnly.rows === 0) {
    msg +=
      "\n\nℹ️ 허브 「누적품목매핑」 " +
      hubMapOnly.err +
      " — 업체별 표시 품목명은 공급 「대리발송」만 사용 중입니다.";
  }
  if (aliasBundle.err && aliasBundle.rows === 0) {
    msg += "\nℹ️ 대리발송 별칭 탭: " + aliasBundle.err;
  }
  if (aliasNameHits > 0) {
    msg +=
      "\n업체 품목명(별칭): " +
      aliasNameHits +
      "건 (전용양식에 실제 반영된 행만 집계)";
  }
  if (aliasSkuHits > 0) {
    msg +=
      "\n업체 상품코드(별칭): " +
      aliasSkuHits +
      "건 (전용양식에 실제 반영된 행만 집계)";
  }
  if (aliasRecipientHits > 0) {
    msg +=
      "\n수령인(대리발송 거래처명): " +
      aliasRecipientHits +
      "건 (전용양식에 실제 반영된 행만 집계)";
  }
  if (errors.length > 0) {
    msg += "\n\n⚠ 샘플 오류:\n" + errors.slice(0, 8).join("\n");
  }
  msg +=
    "\n\n💡 통합 DB에는 「발주 통합 수집」에서 발주 탭·전용양식 탭을 함께 읽을 수 있습니다.";
  if (!isSilent && ui) {
    ui.alert(msg);
  }
  try {
    Logger.log("[PROXY_PUSH] " + msg.replace(/\n/g, " | "));
  } catch (_) {}
}

// ─── 대리공급 발주 → 전용양식 자동 푸시 (5분 트리거) ───────────────────

/** 트리거에서 호출되는 silent 래퍼. UI 없이 자동 실행. */
function pushProxySupplierOrdersToDeploySheetsSilent_() {
  try {
    pushProxySupplierOrdersToDeploySheets({ silent: true });
  } catch (e) {
    try {
      Logger.log("[PROXY_PUSH_TRIGGER_ERROR] " + String(e.message || e));
      appendAutomationEventLog_({
        jobType: "PROXY_SUPPLIER_PUSH_TRIGGER",
        ok: false,
        code: "TRIGGER_ERROR",
        message: String(e.message || e),
      });
    } catch (_) {}
  }
}

var PROXY_PUSH_TRIGGER_FUNC_NAME_ =
  "pushProxySupplierOrdersToDeploySheetsSilent_";
var PROXY_PUSH_TRIGGER_INTERVAL_MINUTES_ = 3;

/**
 * 대리공급 → 전용양식 자동 푸시 트리거 설정 (5분 간격).
 * 메뉴: 📦 발주/송장 관리 → 📤 대리·공급 발주 → ⏰ 자동 푸시 켜기
 */
function adminSetupProxyPushAutoTrigger_() {
  var ui = SpreadsheetApp.getUi();
  // 기존 트리거 제거
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === PROXY_PUSH_TRIGGER_FUNC_NAME_) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  // 새 트리거 등록
  ScriptApp.newTrigger(PROXY_PUSH_TRIGGER_FUNC_NAME_)
    .timeBased()
    .everyMinutes(PROXY_PUSH_TRIGGER_INTERVAL_MINUTES_)
    .create();
  ui.alert(
    "✅ 대리공급 → 전용양식 자동 푸시가 " +
      PROXY_PUSH_TRIGGER_INTERVAL_MINUTES_ +
      "분 간격으로 설정되었습니다." +
      (removed > 0 ? "\n(기존 트리거 " + removed + "개 교체)" : "") +
      "\n\n발주 풀에 새 데이터가 들어오면 약 " +
      PROXY_PUSH_TRIGGER_INTERVAL_MINUTES_ +
      "분 내에 각 업체 전용양식 탭에 자동 반영됩니다." +
      "\n\n끄려면: 📤 대리·공급 발주 → ⏰ 자동 푸시 끄기",
  );
}

/**
 * 대리공급 → 전용양식 자동 푸시 트리거 해제.
 * 메뉴: 📦 발주/송장 관리 → 📤 대리·공급 발주 → ⏰ 자동 푸시 끄기
 */
function adminRemoveProxyPushAutoTrigger_() {
  var ui = SpreadsheetApp.getUi();
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === PROXY_PUSH_TRIGGER_FUNC_NAME_) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  if (removed > 0) {
    ui.alert(
      "✅ 대리공급 → 전용양식 자동 푸시 트리거가 해제되었습니다. (" +
        removed +
        "개 삭제)\n\n수동 메뉴(대리공급 발주 → 독립배포 전용양식)는 그대로 사용 가능합니다.",
    );
  } else {
    ui.alert("ℹ️ 등록된 자동 푸시 트리거가 없습니다.");
  }
}

/** 허브에 누적품목매핑 탭·헤더 생성(비어 있는 경우). */
function ensureHubVendorItemMappingSheet_() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = HUB_VENDOR_ITEM_MAPPING_SHEET_NAME;
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  var headers = [
    "팩투유상품코드",
    "팩투유상품명",
    "업체상품명",
    "업체상품코드",
    "단가",
    "부가세",
    "업체접두",
  ];
  var top = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var i;
  var hasHeader = false;
  for (i = 0; i < headers.length; i++) {
    if (String(top[i] || "").replace(/\s/g, "")) {
      hasHeader = true;
      break;
    }
  }
  if (!hasHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setBackground("#38761d")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    sh.setFrozenRows(1);
  }
  ui.alert(
    "✅ 「" +
      name +
      "」 탭을 확인했습니다.\n\n" +
      "· 엑셀/구 시트에서 매핑 본문을 붙여 넣으세요.\n" +
      "· 대리공급 풀→전용양식 반영 시 이 탭 값이 업체 품목명·코드로 우선 적용됩니다.\n" +
      "· 배포 파일에 별도 매핑 탭이 필요하면 허브에서 범위를 직접 복사해 두세요.",
  );
}

function normVendorExclusiveTemplateKey_(v) {
  return String(v == null ? "" : v)
    .replace(/\s/g, "")
    .toLowerCase();
}

/** 셀 하나에 | 또는 탭으로 구분된 전용양식 헤더 목록 */
function parseVendorExclusiveHeaderCsv_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return [];
  var parts = s.indexOf("|") !== -1 ? s.split("|") : s.split(/\t/);
  var out = [];
  var i;
  for (i = 0; i < parts.length; i++) {
    var p = String(parts[i]).trim();
    if (p) out.push(p);
  }
  return out;
}

function resolveVendorExclusiveTemplateColumns_(headerRow) {
  var nameIx = -1;
  var csvIx = -1;
  var c;
  for (c = 0; c < headerRow.length; c++) {
    var hn = normHubMappingHeader_(headerRow[c]);
    if (!hn) continue;
    if (hn.match(/^맞춤양식명$|^양식명$|^전용양식키$/)) nameIx = c;
    else if (hn.match(/헤더CSV|전용양식헤더|헤더목록|^헤더$/)) csvIx = c;
  }
  if (nameIx === -1) nameIx = 0;
  if (csvIx === -1) csvIx = headerRow.length >= 3 ? 2 : 1;
  return { nameIx: nameIx, csvIx: csvIx };
}

/** 맞춤양식명 일치 시 코드 내장 목록에서 헤더 배열 */
function loadVendorExclusiveTemplateHeadersFromEmbedded_(supplierFormatName) {
  var rows = EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_;
  if (!rows || !rows.length) return null;
  var want = normVendorExclusiveTemplateKey_(supplierFormatName);
  if (!want) return null;
  var ri;
  for (ri = 0; ri < rows.length; ri++) {
    var er = rows[ri];
    if (!er || typeof er !== "object") continue;
    var label = String(er.label || "").trim();
    if (!label || normVendorExclusiveTemplateKey_(label) !== want) continue;
    var headers = parseVendorExclusiveHeaderCsv_(er.headerCsv);
    if (headers.length) return headers;
  }
  return null;
}

/**
 * 허브 「업체전용양식마스터」에서 맞춤양식명과 같은 행의 헤더 목록.
 * 코드 내장(EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_)이 있으면 시트보다 우선.
 * @returns {string[]|null} 없으면 null (호출측에서 기본 헤더 사용)
 */
function loadVendorExclusiveTemplateHeadersFromHub_(hubSs, supplierFormatName) {
  if (!hubSs || !String(supplierFormatName || "").trim()) return null;
  var fromEmb =
    loadVendorExclusiveTemplateHeadersFromEmbedded_(supplierFormatName);
  if (fromEmb && fromEmb.length) return fromEmb;
  var sh = hubSs.getSheetByName(VENDOR_EXCLUSIVE_TEMPLATE_MASTER_SHEET_NAME);
  if (!sh) return null;
  var lr = sh.getLastRow();
  var lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) return null;
  var data = sh.getRange(1, 1, lr, lc).getValues();
  var meta = resolveVendorExclusiveTemplateColumns_(data[0]);
  var want = normVendorExclusiveTemplateKey_(supplierFormatName);
  var r;
  for (r = 1; r < data.length; r++) {
    var row = data[r];
    var nm = normVendorExclusiveTemplateKey_(row[meta.nameIx]);
    if (!nm || nm !== want) continue;
    var csv = row[meta.csvIx];
    var headers = parseVendorExclusiveHeaderCsv_(csv);
    if (headers.length) return headers;
  }
  return null;
}

/** 업체전용양식마스터 2행 — 병합 셀로 인한 setValues 행 불일치 방지 */
function writeExclusiveMasterSampleRow2_(sheet, sampleRow) {
  sheet.getRange(2, 1).setValue(sampleRow[0]);
  sheet.getRange(2, 2).setValue(sampleRow[1]);
  sheet.getRange(2, 3).setValue(sampleRow[2]);
}

/**
 * 허브 「대리공급업체코드」에 있는 업체를 「업체전용양식마스터」에 한 줄씩 반영한다.
 * · 맞춤양식명: 발주탭/탭명 열에 값이 있으면 그 값, 없으면 거래처명 열
 * · 품목접두: 매핑의 접두(2자)와 동일
 * · 전용양식헤더CSV: 비어 있는 신규 행에만 defaultCsv 채움(기존 행은 덮어쓰지 않음)
 */
function syncVendorExclusiveMasterRowsFromProxyMap_(
  hubSs,
  masterSh,
  defaultCsv,
) {
  var out = { added: 0, scanned: 0 };
  var mapSh = hubSs.getSheetByName(PROXY_SUPPLIER_MAP_SHEET_NAME);
  if (!mapSh || mapSh.getLastRow() < 2) return out;

  var lr = mapSh.getLastRow();
  var lc = mapSh.getLastColumn();
  var data = mapSh.getRange(1, 1, lr, lc).getValues();
  var col = detectProxySupplierMapColumns_(data[0], data);
  var codeIx = col.codeIx;
  var fileIx = col.fileIx;
  var tabIx = col.tabIx;
  var nCol = data[0].length;
  var nameIx = col.nameIx != null ? col.nameIx : -1;
  if (
    nameIx < 0 &&
    codeIx === 0 &&
    (fileIx === -1 || fileIx === 2) &&
    nCol >= 2
  ) {
    nameIx = 1;
  }

  var masterLr = masterSh.getLastRow();
  var existingKeys = {};
  if (masterLr >= 2) {
    var md = masterSh.getRange(2, 1, masterLr, 1).getValues();
    var i;
    for (i = 0; i < md.length; i++) {
      var k = normVendorExclusiveTemplateKey_(md[i][0]);
      if (k) existingKeys[k] = true;
    }
  }

  var newRows = [];
  var r;
  for (r = 1; r < data.length; r++) {
    var row = data[r];
    var rawCode = String(row[codeIx] == null ? "" : row[codeIx])
      .trim()
      .toUpperCase()
      .replace(/\s/g, "");
    var nameRaw =
      nameIx >= 0 ? String(row[nameIx] == null ? "" : row[nameIx]).trim() : "";
    var tabName =
      tabIx !== -1 ? String(row[tabIx] == null ? "" : row[tabIx]).trim() : "";
    if (!rawCode && !nameRaw && !tabName) continue;
    out.scanned++;
    if (!rawCode || rawCode.length < 2) continue;
    var pfx = extractProxySupplierRoutePrefixExcel_(rawCode);
    if (pfx.length < 2) continue;
    var label = tabName || nameRaw;
    if (!label) continue;
    var key = normVendorExclusiveTemplateKey_(label);
    if (!key) continue;
    if (existingKeys[key]) continue;
    existingKeys[key] = true;
    newRows.push([label, pfx, defaultCsv]);
    out.added++;
  }

  if (newRows.length) {
    var start = masterSh.getLastRow() + 1;
    masterSh
      .getRange(start, 1, start + newRows.length - 1, 3)
      .setValues(newRows);
  }
  return out;
}

function buildVendorExclusiveMasterKeyToRow_(masterSh) {
  var map = {};
  var lr = masterSh.getLastRow();
  if (lr < 2) return map;
  var names = masterSh.getRange(2, 1, lr, 1).getDisplayValues();
  var i;
  for (i = 0; i < names.length; i++) {
    var k = normVendorExclusiveTemplateKey_(names[i][0]);
    if (!k || map[k]) continue;
    map[k] = i + 2;
  }
  return map;
}

/** 코드 내장 행 → 업체전용양식마스터 반영(동일 맞춤양식명이면 C열·접두 갱신). */
function applyEmbeddedVendorExclusiveMasterRows_(masterSh) {
  var out = { applied: 0, updated: 0, added: 0 };
  var rows = EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_;
  if (!rows || !rows.length) return out;
  var keyToRow = buildVendorExclusiveMasterKeyToRow_(masterSh);
  var ri;
  for (ri = 0; ri < rows.length; ri++) {
    var er = rows[ri];
    if (!er || typeof er !== "object") continue;
    var label = String(er.label || "").trim();
    var csv = String(er.headerCsv || "").trim();
    var pfx = String(er.prefix || "").trim();
    if (!label || !csv) continue;
    var nk = normVendorExclusiveTemplateKey_(label);
    if (!nk) continue;
    var hit = keyToRow[nk];
    if (hit) {
      masterSh.getRange(hit, 3).setValue(csv);
      if (pfx) masterSh.getRange(hit, 2).setValue(pfx);
      out.updated++;
    } else {
      var start = masterSh.getLastRow() + 1;
      masterSh.getRange(start, 1).setValue(label);
      masterSh.getRange(start, 2).setValue(pfx);
      masterSh.getRange(start, 3).setValue(csv);
      keyToRow[nk] = start;
      out.added++;
    }
    out.applied++;
  }
  return out;
}

/** 초기 예시 행·대리공급 기본 CSV용 — 내장 목록 첫 행 우선 */
function getDefaultVendorExclusiveSampleRowForBootstrap_() {
  var rows = EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_;
  if (rows && rows.length > 0) {
    var r = rows[0];
    var lab = String(r.label || "").trim();
    var pfx = String(r.prefix || "").trim();
    var csv = String(r.headerCsv || "").trim();
    if (lab && csv) return [lab, pfx, csv];
  }
  return [
    "태양",
    "TY",
    "거래처명|주문일자(YYYYMMDD)|이카운트코드|품목명|수량|수취인|수취인전화번호|수취인주소|배송메시지|적요|송장번호|정산금액|고유ID",
  ];
}

/** 허브에 업체전용양식 마스터 탭·예시 행 생성 */
function ensureVendorExclusiveTemplateMasterSheet_() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = VENDOR_EXCLUSIVE_TEMPLATE_MASTER_SHEET_NAME;
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  var HEADER_ROW = [
    "맞춤양식명",
    "품목접두(참고)",
    "전용양식헤더CSV(| 또는 탭 구분)",
  ];
  var SAMPLE_ROW = getDefaultVendorExclusiveSampleRowForBootstrap_();

  var top = sh.getRange(1, 1, 1, 3).getValues()[0];
  var topAllBlank =
    !String(top[0] || "").trim() &&
    !String(top[1] || "").trim() &&
    !String(top[2] || "").trim();
  var hnA = normHubMappingHeader_(top[0]);
  var headerOk = !!hnA && !!hnA.match(/^맞춤양식명$|^양식명$|^전용양식키$/);

  // 6-4는 '탭 준비': 1행이 비었거나 규격 헤더가 아니면 1~2행을 자동 채움. 규격 헤더만 있고 2행이 비면 예시 행만 넣음.
  var needHeaderBlock = topAllBlank || !headerOk;
  if (needHeaderBlock) {
    try {
      sh.getRange(1, 1, 3, 3).clear();
    } catch (eClr) {}
    try {
      sh.getRange(1, 1, 1, 3).setValues([HEADER_ROW]);
      writeExclusiveMasterSampleRow2_(sh, SAMPLE_ROW);
    } catch (eSet) {
      ui.alert(
        "❌ 「" +
          name +
          "」 1~2행 기록 실패: " +
          String(eSet && eSet.message ? eSet.message : eSet) +
          "\n\nA1:C3 병합을 해제한 뒤 다시 실행해 주세요.",
      );
      return;
    }
    sh.getRange(1, 1, 1, 3)
      .setBackground("#674ea7")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
  } else {
    var r2 =
      sh.getLastRow() >= 2
        ? sh.getRange(2, 1, 2, 3).getValues()[0]
        : ["", "", ""];
    var r2AllBlank =
      !String(r2[0] || "").trim() &&
      !String(r2[1] || "").trim() &&
      !String(r2[2] || "").trim();
    if (r2AllBlank) {
      try {
        try {
          sh.getRange(2, 1, 3, 3).clear();
        } catch (eClr2) {}
        writeExclusiveMasterSampleRow2_(sh, SAMPLE_ROW);
      } catch (e2) {
        ui.alert(
          "❌ 예시 행(2행) 기록 실패: " +
            String(e2 && e2.message ? e2.message : e2),
        );
        return;
      }
    }
    sh.getRange(1, 1, 1, 3)
      .setBackground("#674ea7")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
  }

  sh.setFrozenRows(1);
  try {
    sh.autoResizeColumns(1, 3);
  } catch (eAuto) {}

  var syncHint = "";
  try {
    var syn = syncVendorExclusiveMasterRowsFromProxyMap_(ss, sh, SAMPLE_ROW[2]);
    if (syn.added > 0) {
      syncHint =
        "\n\n「대리공급업체코드」에서 아직 마스터에 없던 맞춤양식명 " +
        syn.added +
        "건을 행으로 추가했습니다. 전용양식헤더CSV는 공통 예시이므로 업체별로 고치세요.";
    }
  } catch (eSyn) {
    syncHint =
      "\n\n대리공급 매핑 동기화 실패: " +
      String(eSyn && eSyn.message ? eSyn.message : eSyn);
  }

  try {
    var emb = applyEmbeddedVendorExclusiveMasterRows_(sh);
    if (emb.updated || emb.added) {
      syncHint +=
        "\n\n코드 목록(EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_) 반영: 갱신 " +
        emb.updated +
        "건, 신규 " +
        emb.added +
        "건.";
    }
  } catch (eEmb) {
    syncHint +=
      "\n\n내장 양식 반영 오류: " +
      String(eEmb && eEmb.message ? eEmb.message : eEmb);
  }

  ui.alert(
    "✅ 「" +
      name +
      "」 탭을 확인했습니다." +
      syncHint +
      "\n\n" +
      "· 「4) 업체 배포시트 만들기」에서 입력하는 맞춤양식명과 맞춤양식명 열을 동일하게 적습니다.\n" +
      "· 업체 헤더는 orderSyncManager.gs 의 EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_ 에 적습니다(PC 엑셀 1행을 `|` 로만 이어 넣음). 6-4 실행 시 시트로 반영됩니다.\n" +
      "· 반드시 대리공급 푸시가 인식할 주문일자·품목코드(또는 이카운트코드) 헤더가 포함되어야 합니다.",
  );
}

/**
 * 송장 취합 탭 1개를 스캔해 invoiceMap 에 병합한다.
 * @returns {boolean} 데이터 행이 있어 스캔 시도가 이뤄졌으면 true (foundAnyTab 용)
 */
function ingestInvoiceSheetTabIntoMap_(
  invTab,
  invoiceMap,
  labelForLog,
  scannedLogs,
) {
  if (!invTab) {
    scannedLogs.push("[" + labelForLog + "] 탭 없음");
    return false;
  }
  var lr = invTab.getLastRow();
  if (lr <= 1) {
    scannedLogs.push("[" + labelForLog + "] 데이터가 비어있습니다.");
    return false;
  }

  var lc = invTab.getLastColumn();
  var invData = invTab.getRange(1, 1, lr, lc).getValues();
  var headers = invData[0];

  var nameIdx = -1,
    phoneIdx = -1,
    invoiceIdx = -1,
    uidIdx = -1,
    itemIdx = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c]).replace(/\s/g, "");
    if (nameIdx === -1 && h.match(/이름|고객명|수취인|받는분|받는사람|수하인/))
      nameIdx = c;
    if (
      phoneIdx === -1 &&
      h.match(/연락처|전화번호|모바일|핸드폰|휴대폰|수하인전화|받는전화|전화/)
    )
      phoneIdx = c;
    if (invoiceIdx === -1 && h.match(/송장|운송장|바코드|택배번호/))
      invoiceIdx = c;
    if (uidIdx === -1 && h.match(/일자|주문번호|적요|배송메시지/)) uidIdx = c;
    if (itemIdx === -1 && h.match(/상품|품목|상세|내용/)) itemIdx = c;
  }

  // 병합 헤더 대응: 1행에서 주요 열을 못 찾으면 2행도 검색
  if ((invoiceIdx === -1 || phoneIdx === -1) && invData.length > 1) {
    var row2 = invData[1];
    for (var c2 = 0; c2 < row2.length; c2++) {
      var h2 = String(row2[c2]).replace(/\s/g, "");
      if (!h2) continue;
      if (
        nameIdx === -1 &&
        h2.match(/이름|고객명|수취인|받는분|받는사람|수하인|^명$/)
      )
        nameIdx = c2;
      if (
        phoneIdx === -1 &&
        h2.match(/연락처|전화번호|모바일|핸드폰|휴대폰|전화/)
      )
        phoneIdx = c2;
      if (invoiceIdx === -1 && h2.match(/송장|운송장|바코드|택배번호/))
        invoiceIdx = c2;
      if (uidIdx === -1 && h2.match(/일자|주문번호|적요/)) uidIdx = c2;
      if (itemIdx === -1 && h2.match(/상품|품목|상세|내용/)) itemIdx = c2;
    }
    // 2행이 헤더면 데이터는 3행부터 → 1행(헤더행) 제거 후 재구성
    if (invoiceIdx !== -1) {
      invData = invData.slice(1); // 2행을 새 헤더로, 3행~이 데이터
    }
  }

  if (invoiceIdx === -1) {
    scannedLogs.push(
      "[" +
        labelForLog +
        "] '송장' 관련 열 찾기 실패. 실제 헤더: " +
        headers.slice(0, 10).join(", "),
    );
    return true;
  }

  var matchedRows = 0;
  for (var i = 1; i < invData.length; i++) {
    var invNum = String(invData[i][invoiceIdx]).trim();
    if (!invNum) continue;

    var key = "";
    var n = nameIdx !== -1 ? String(invData[i][nameIdx]).trim() : "";
    var rawPhone = phoneIdx !== -1 ? String(invData[i][phoneIdx]) : "";
    var p = rawPhone.replace(/[^0-9]/g, "");
    var shortP = p.length >= 4 ? p.substring(p.length - 4) : p;

    // 이름+전화 키를 항상 기본 키로 사용
    key = n + "_" + shortP;

    if (key && key.length > 2) {
      var detailBlock = "";
      if (itemIdx !== -1) detailBlock = String(invData[i][itemIdx]);
      else if (invoiceIdx > 0) detailBlock = String(invData[i][invoiceIdx - 1]);

      var invEntry = { invRaw: invNum, detailRaw: detailBlock };
      if (!invoiceMap[key]) invoiceMap[key] = [];
      invoiceMap[key].push(invEntry);
      matchedRows++;

      // UID가 있으면 추가 키로도 등록 (UID 기반 매칭도 가능하게)
      if (uidIdx !== -1 && invData[i][uidIdx]) {
        var uidKey = String(invData[i][uidIdx]).trim();
        if (uidKey && uidKey !== key && uidKey.length > 2) {
          if (!invoiceMap[uidKey]) invoiceMap[uidKey] = [];
          invoiceMap[uidKey].push(invEntry);
        }
      }

      // 이름 + 전화 앞7자리 보조키 (전화번호 뒤자리가 다르거나 마스킹된 경우 대응)
      if (n && p.length >= 7) {
        var prefixKey = n + "_P" + p.substring(0, 7);
        if (!invoiceMap[prefixKey]) invoiceMap[prefixKey] = [];
        invoiceMap[prefixKey].push(invEntry);
      }
    }
  }
  scannedLogs.push(
    "[" +
      labelForLog +
      "] 송장 " +
      matchedRows +
      "건 인식 성공 (이름 위치:" +
      nameIdx +
      " / 연락처 위치:" +
      phoneIdx +
      " / 송장 위치:" +
      invoiceIdx +
      ")",
  );
  return true;
}

// 허브 데이터를 공급업체 시트(판매중 탭)로 밀어넣기
function pushOrdersToSupplier() {
  var ui = SpreadsheetApp.getUi();
  var msg = ui.alert(
    "출고 전송",
    "허브에 수집된 신규 주문들을 [공급업체 발주서(판매중)] 시트로 일괄 전송하시겠습니까?",
    ui.ButtonSet.YES_NO,
  );
  if (msg !== ui.Button.YES) return;

  try {
    var supSS = SpreadsheetApp.openById(SUPPLIER_SHEET_ID);
    var targetTab = supSS.getSheetByName("판매중");
    if (!targetTab)
      return ui.alert("공급업체 시트에 '판매중' 탭을 찾을 수 없습니다.");

    var hubSheet = getOrderHubTab();
    var lastCol = hubSheet.getLastColumn();
    // Q열(17)을 '공급사 전송 여부' 방어 열로 사용
    if (lastCol < 17) {
      hubSheet
        .getRange(1, 17)
        .setValue("공급사전송여부")
        .setBackground("#38761d")
        .setFontColor("white")
        .setFontWeight("bold");
    }

    var lr = hubSheet.getLastRow();
    if (lr <= 1) return ui.alert("전송할 발주 데이터가 없습니다.");

    // A:Q 데이터 가져오기 (총 17열)
    var hubData = hubSheet.getRange(2, 1, lr - 1, 17).getValues();
    var toPush = [];
    var rowUpdates = []; // 전송 성공 기록용

    for (var i = 0; i < hubData.length; i++) {
      var isSent = hubData[i][16]; // Q열 (인덱스 16)
      if (isSent === "O") continue; // 이미 보낸 건 패스

      var rowToSup = new Array(20).fill(""); // 넉넉히 T열까지

      // 허브: C(고유ID-2), D(거래처명-3), F(품목코드-5), G(품목명-6), H(수량-7), I(수취인-8), J(연락처-9), K(주소-10), L(배송메시지-11), N(택배사-13)
      rowToSup[2] = hubData[i][13] || "발주접수"; // C: 상태 (기존 택배사 위치)
      rowToSup[3] = hubData[i][5]; // D: 품목코드
      rowToSup[4] = hubData[i][6]; // E: 품목명
      rowToSup[6] = hubData[i][7]; // G: 판매수량

      rowToSup[8] = hubData[i][9]; // I: 연락처

      rowToSup[9] = hubData[i][10]; // J: 주소

      rowToSup[10] =
        "수취인: " +
        hubData[i][8] +
        (hubData[i][11] ? " / " + hubData[i][11] : ""); // K: 배송메시지에 수취인 합침
      rowToSup[12] = hubData[i][3]; // M: 거래처명

      // O: 적요 (우리의 고유 ID 숨겨두기 - 송장 회수 시 필수)
      rowToSup[14] = hubData[i][2]; // O: 적요

      toPush.push(rowToSup);
      rowUpdates.push(i + 2); // 실제 허브 시트 행 번호
    }

    if (toPush.length > 0) {
      targetTab
        .getRange(
          targetTab.getLastRow() + 1,
          1,
          toPush.length,
          toPush[0].length,
        )
        .setValues(toPush);

      // 보낸 기록 업데이트
      for (var r = 0; r < rowUpdates.length; r++) {
        hubSheet.getRange(rowUpdates[r], 17).setValue("O"); // Q열 표기
      }
      ui.alert(
        "✅ " +
          toPush.length +
          "건의 주문이 공급업체 시트로 성공적으로 전송되었습니다.",
      );
    } else {
      ui.alert("ℹ️ 새로 전송할 신규 주문이 없습니다. (모두 전송됨)");
    }
  } catch (e) {
    ui.alert(
      "🚨 에러: " +
        e.message +
        "\n(공급업체 시트 접근 권한이 없거나 아이디가 잘못되었을 수 있습니다.)",
    );
  }
}

// 허브에서 수정한 수취인/연락처/주소/배송메시지를
// 공급업체 시트(판매중)에 고유ID(O열) 기준으로 재동기화
function syncSupplierAddressChangesByUniqueId() {
  var ui = SpreadsheetApp.getUi();
  var go = ui.alert(
    "주소 변경 동기화",
    "통합 발주 DB의 최신 수취정보(수취인/연락처/주소/배송메시지)를\n" +
      "공급업체 시트 [판매중]에 고유ID 기준으로 반영합니다.\n\n" +
      "계속할까요?",
    ui.ButtonSet.YES_NO,
  );
  if (go !== ui.Button.YES) return;

  try {
    var hubSheet = getOrderHubTab();
    var hubLr = hubSheet.getLastRow();
    if (hubLr <= 1) {
      ui.alert("통합 발주 DB 데이터가 없습니다.");
      return;
    }

    // A:Q (17열) 읽기
    var hubData = hubSheet
      .getRange(2, 1, hubLr - 1, Math.max(17, hubSheet.getLastColumn()))
      .getValues();
    var hubByUid = {};
    var hubCount = 0;
    for (var i = 0; i < hubData.length; i++) {
      var uid = String(hubData[i][2] || "").trim(); // C: 발주고유ID
      if (!uid) continue;
      var sentFlag = String(hubData[i][16] || "").trim(); // Q: 공급사전송여부
      if (sentFlag !== "O") continue; // 아직 공급사로 안 보낸 건 스킵
      hubByUid[uid] = {
        recipient: String(hubData[i][8] || "").trim(), // I: 수취인
        phone: String(hubData[i][9] || "").trim(), // J: 수취인전화
        addr: String(hubData[i][10] || "").trim(), // K: 수취인주소
        msg: String(hubData[i][11] || "").trim(), // L: 배송메시지
      };
      hubCount++;
    }
    if (hubCount === 0) {
      ui.alert(
        "공급사 전송완료(O) 상태의 주문이 없어 동기화할 대상이 없습니다.",
      );
      return;
    }

    var supSS = SpreadsheetApp.openById(SUPPLIER_SHEET_ID);
    var targetTab = supSS.getSheetByName("판매중");
    if (!targetTab) {
      ui.alert("공급업체 시트에 '판매중' 탭을 찾을 수 없습니다.");
      return;
    }

    var supLr = targetTab.getLastRow();
    if (supLr <= 1) {
      ui.alert("공급업체 '판매중' 탭 데이터가 없습니다.");
      return;
    }

    // A:T (20열) 읽기 - 기존 pushOrdersToSupplier 작성 포맷 유지
    var supData = targetTab.getRange(2, 1, supLr - 1, 20).getValues();
    var changedRows = 0;
    for (var r = 0; r < supData.length; r++) {
      var uid2 = String(supData[r][14] || "").trim(); // O열: 고유ID
      if (!uid2 || !hubByUid[uid2]) continue;

      var src = hubByUid[uid2];
      var newPhone = src.phone;
      var newAddr = src.addr;
      var newMsg =
        "수취인: " + src.recipient + (src.msg ? " / " + src.msg : "");

      var isChanged = false;
      if (String(supData[r][8] || "").trim() !== newPhone) {
        // I열
        supData[r][8] = newPhone;
        isChanged = true;
      }
      if (String(supData[r][9] || "").trim() !== newAddr) {
        // J열
        supData[r][9] = newAddr;
        isChanged = true;
      }
      if (String(supData[r][10] || "").trim() !== newMsg) {
        // K열
        supData[r][10] = newMsg;
        isChanged = true;
      }
      if (isChanged) changedRows++;
    }

    if (changedRows > 0) {
      targetTab.getRange(2, 1, supData.length, 20).setValues(supData);
      SpreadsheetApp.flush();
    }

    ui.alert(
      "✅ 주소 변경 동기화 완료\n\n" +
        "- 허브 대상 UID: " +
        hubCount +
        "건\n" +
        "- 공급사 반영 행: " +
        changedRows +
        "건",
    );
  } catch (e) {
    ui.alert("🚨 주소 변경 동기화 실패: " + (e && e.message ? e.message : e));
  }
}

// 송장 취합 시트에서 허브로 송장 번호 당겨오기
function fetchInvoicesFromSupplier() {
  var ui = SpreadsheetApp.getUi();
  var msg = ui.alert(
    "송장 회수",
    "송장 취합 시트[최종데이터취합]에서 송장번호를 허브로 당겨오시겠습니까?",
    ui.ButtonSet.YES_NO,
  );
  if (msg !== ui.Button.YES) return;

  try {
    var invSS = SpreadsheetApp.openById(INVOICE_SHEET_ID);

    // 꼬임 방지: 3-3_병합 जैसी 원본 데이터 시트에서도 직접 당겨올 수 있도록 대상 탭에 추가
    var targetTabs = [
      "3-3_병합",
      "최종데이터취합",
      "대리발송데이터 묶음",
      "로젠출력",
      "입력_세트분리시트",
    ];
    var invoiceMap = {};
    var foundAnyTab = false;
    var scannedLogs = []; // 디버깅 및 분석용 로그

    for (var t = 0; t < targetTabs.length; t++) {
      var invTab = invSS.getSheetByName(targetTabs[t]);
      if (!invTab) continue;
      if (
        ingestInvoiceSheetTabIntoMap_(
          invTab,
          invoiceMap,
          targetTabs[t],
          scannedLogs,
        )
      ) {
        foundAnyTab = true;
      }
    }

    try {
      var fbTab = getSheetByGid_(invSS, INVOICE_SHEET_FALLBACK_GID);
      if (
        ingestInvoiceSheetTabIntoMap_(
          fbTab,
          invoiceMap,
          "송장보조(gid:" + INVOICE_SHEET_FALLBACK_GID + ")",
          scannedLogs,
        )
      ) {
        foundAnyTab = true;
      }
    } catch (eFb) {
      scannedLogs.push(
        "[송장보조 gid:" +
          INVOICE_SHEET_FALLBACK_GID +
          "] 읽기 실패: " +
          String(eFb && eFb.message ? eFb.message : eFb),
      );
    }

    // 합배송 전용 시트에서 UID 기반 송장을 추가로 흡수한다.
    // - 합배송은 오매칭 방지를 위해 UID가 있는 행만 채택
    // - 동일 UID는 이 소스 값으로 최신 덮어쓰기(정답 소스 우선)
    try {
      var combinedSS = SpreadsheetApp.openById(COMBINED_INVOICE_SHEET_ID);
      var combinedTab = getSheetByGid_(combinedSS, COMBINED_INVOICE_SHEET_GID);
      if (combinedTab) {
        var clr = combinedTab.getLastRow();
        var clc = combinedTab.getLastColumn();
        if (clr > 1 && clc > 0) {
          var cData = combinedTab.getRange(1, 1, clr, clc).getValues();
          var cHeaders = cData[0];
          var cInvoiceIdx = -1;
          var cUidIdx = -1;
          var cItemIdx = -1;
          for (var cc = 0; cc < cHeaders.length; cc++) {
            var ch = String(cHeaders[cc] || "").replace(/\s/g, "");
            if (cInvoiceIdx === -1 && ch.match(/송장|운송장|바코드|택배번호/))
              cInvoiceIdx = cc;
            if (
              cUidIdx === -1 &&
              ch.match(/고유ID|주문번호|일자|적요|배송메시지/)
            )
              cUidIdx = cc;
            if (cItemIdx === -1 && ch.match(/상품|품목|상세|내용/))
              cItemIdx = cc;
          }
          var combinedCount = 0;
          if (cInvoiceIdx !== -1 && cUidIdx !== -1) {
            for (var cr = 1; cr < cData.length; cr++) {
              var cInv = String(cData[cr][cInvoiceIdx] || "").trim();
              var cUid = String(cData[cr][cUidIdx] || "").trim();
              if (!cInv || !cUid) continue;
              var cDetail =
                cItemIdx !== -1 ? String(cData[cr][cItemIdx] || "") : "";
              invoiceMap[cUid] = [{ invRaw: cInv, detailRaw: cDetail }];
              combinedCount++;
            }
            scannedLogs.push(
              "[합배송전용] UID기준 송장 " +
                combinedCount +
                "건 반영 (gid:" +
                COMBINED_INVOICE_SHEET_GID +
                ")",
            );
          } else {
            scannedLogs.push(
              "[합배송전용] 헤더 탐지 실패(invoiceIdx=" +
                cInvoiceIdx +
                ", uidIdx=" +
                cUidIdx +
                ")",
            );
          }
        } else {
          scannedLogs.push("[합배송전용] 데이터가 비어있습니다.");
        }
      } else {
        scannedLogs.push(
          "[합배송전용] gid=" +
            COMBINED_INVOICE_SHEET_GID +
            " 탭을 찾지 못했습니다.",
        );
      }
    } catch (eCombined) {
      scannedLogs.push(
        "[합배송전용] 읽기 실패: " +
          String(
            eCombined && eCombined.message ? eCombined.message : eCombined,
          ),
      );
    }

    if (!foundAnyTab)
      return ui.alert(
        "송장 시트 안에 '최종데이터취합' 또는 '로젠출력' 탭을 찾을 수 없습니다.\n[상세 정보]\n" +
          scannedLogs.join("\n"),
      );

    var hubSheet = getOrderHubTab();
    var hubLr = hubSheet.getLastRow();
    if (hubLr <= 1) return ui.alert("허브에 발주 데이터가 없습니다.");

    var hubData = hubSheet.getRange(2, 1, hubLr - 1, 15).getValues();

    // 허브 시트 순회하며 합배송 규칙(대표행 송장 + 비대표 참조상태) 적용
    var updates = [];
    var globalUsedInvoices = {}; // 이미 배정된 송장 추적
    var diag = {
      groups: 0,
      assignedRows: 0,
      referenceRows: 0,
      manualLockedGroups: 0,
      lowConfidenceSkips: 0,
      noCandidateGroups: 0,
    };
    var groups = {};
    for (var r = 0; r < hubData.length; r++) {
      var gKey = normalizeHubRecipientPhoneKey_(hubData[r][8], hubData[r][9]);
      if (!gKey || gKey === "_") continue;
      if (!groups[gKey]) groups[gKey] = [];
      groups[gKey].push(r);

      // 보조키 (이름 + 전화 앞7자리) — *마스킹 송장시트와 매칭용
      var fullP = String(hubData[r][9] || "").replace(/[^0-9]/g, "");

      if (fullP.length >= 7) {
        var hubName = String(hubData[r][8] || "").trim();
        var pKey = hubName + "_P" + fullP.substring(0, 7);
        if (!groups[pKey]) groups[pKey] = [];
        groups[pKey].push(r);

        // 이름 첫글자 보조키 (송*희 등 마스킹 이름 대응)
        if (hubName.length > 0) {
          var firstCharKey = hubName.charAt(0) + "_P" + fullP.substring(0, 7);
          if (!groups[firstCharKey]) groups[firstCharKey] = [];
          groups[firstCharKey].push(r);
        }
      }
    }

    for (var groupKey in groups) {
      var groupRows = groups[groupKey];
      if (!groupRows || groupRows.length === 0) continue;
      diag.groups++;

      var manualRepresentativeIdx = -1;
      for (var gr = 0; gr < groupRows.length; gr++) {
        var ridx = groupRows[gr];
        if (String(hubData[ridx][14] || "").trim() !== "") {
          manualRepresentativeIdx = ridx;
          break;
        }
      }

      // 사람이 먼저 송장을 넣은 그룹은 자동 재분배 금지 (수동 우선)
      if (manualRepresentativeIdx !== -1) {
        diag.manualLockedGroups++;
        var lockUid = String(hubData[manualRepresentativeIdx][2] || "").trim();
        var lockDetail = "";
        if (lockUid && invoiceMap[lockUid]) {
          var lockParsed = parseInvoiceLinesFromMatchedRows_(
            invoiceMap[lockUid],
            null,
          );
          if (lockParsed.length > 0)
            lockDetail = String(lockParsed[0].detail || "");
        }
        for (var gl = 0; gl < groupRows.length; gl++) {
          var lidx = groupRows[gl];
          if (lidx === manualRepresentativeIdx) continue;
          if (String(hubData[lidx][14] || "").trim() !== "") continue;
          if (isTerminalOrderStatus_(hubData[lidx][12])) continue;
          if (
            !shouldAutoMarkCombinedReference_(
              hubData[lidx],
              lockUid,
              lockDetail,
            )
          )
            continue;
          var lockInvoice = String(
            hubData[manualRepresentativeIdx][14] || "",
          ).trim();
          var lockStatus = buildCombinedShipmentReferenceStatus_(
            lockUid,
            lockInvoice,
          );
          if (String(hubData[lidx][12] || "") !== lockStatus) {
            hubData[lidx][12] = lockStatus;
            updates.push({
              row: lidx + 2,
              status: lockStatus,
              inv: null,
              writeInvoice: false,
            });
            diag.referenceRows++;
          }
        }
        // 수동잠금 그룹이라도 송장 없는 행은 아래 매칭 로직에서 계속 배정
      }

      var mergedMatched = [];
      for (var gx = 0; gx < groupRows.length; gx++) {
        var rowIdx = groupRows[gx];
        var uidKey = String(hubData[rowIdx][2] || "").trim();
        if (uidKey && invoiceMap[uidKey]) {
          mergedMatched = mergedMatched.concat(invoiceMap[uidKey]);
        }
        if (invoiceMap[groupKey]) {
          mergedMatched = mergedMatched.concat(invoiceMap[groupKey]);
        }
      }
      if (mergedMatched.length === 0) {
        diag.noCandidateGroups++;
        continue;
      }

      var parsedCandidates = parseInvoiceLinesFromMatchedRows_(
        mergedMatched,
        globalUsedInvoices,
      );
      if (parsedCandidates.length === 0) {
        diag.noCandidateGroups++;
        continue;
      }

      var eligibleRows = [];
      for (var ge = 0; ge < groupRows.length; ge++) {
        var eIdx = groupRows[ge];
        if (String(hubData[eIdx][14] || "").trim() !== "") continue;
        if (isTerminalOrderStatus_(hubData[eIdx][12])) continue;
        eligibleRows.push(eIdx);
      }
      if (eligibleRows.length === 0) continue;

      eligibleRows.sort(function (a, b) {
        var da = toComparableOrderDateValue_(hubData[a][4]);
        var db = toComparableOrderDateValue_(hubData[b][4]);
        if (da !== db) return da - db;
        return a - b;
      });

      var assignedRepInfo = [];
      for (var er = 0; er < eligibleRows.length; er++) {
        var repIdx = eligibleRows[er];
        var needSlots = getRequiredParcelSlotsForHubRow_(hubData[repIdx]);
        if (
          needSlots >= 1 &&
          rowHasUnusedInvoiceCandidate_(parsedCandidates, globalUsedInvoices)
        ) {
          var bestProbe = null;
          var itemNameProbe = String(hubData[repIdx][6] || "");
          for (var pc = 0; pc < parsedCandidates.length; pc++) {
            var candP = parsedCandidates[pc];
            if (!candP || !candP.inv || globalUsedInvoices[candP.inv]) continue;
            var sc = scoreInvoiceCandidateForItem_(candP.detail, itemNameProbe);
            if (!bestProbe || sc > bestProbe.score) bestProbe = { score: sc };
          }
          if (!bestProbe || bestProbe.score < COMBINED_SHIPMENT_MIN_SCORE_) {
            diag.lowConfidenceSkips++;
            continue;
          }
        }
        var pickedInvs = pickInvoicesForHubRow_(
          parsedCandidates,
          hubData[repIdx],
          needSlots,
          globalUsedInvoices,
        );
        if (pickedInvs.length === 0) continue;
        var invCell = pickedInvs.join("\n");
        var firstDetail = findDetailForInvoiceInCandidates_(
          parsedCandidates,
          pickedInvs[0],
        );
        hubData[repIdx][12] = "발송완료";
        hubData[repIdx][14] = invCell;
        updates.push({
          row: repIdx + 2,
          status: "발송완료",
          inv: invCell,
          writeInvoice: true,
        });
        assignedRepInfo.push({
          idx: repIdx,
          uid: String(hubData[repIdx][2] || "").trim(),
          inv: invCell,
          detail: firstDetail,
        });
        diag.assignedRows++;
      }

      if (assignedRepInfo.length === 0) continue;
      var repSet = {};
      for (var ai = 0; ai < assignedRepInfo.length; ai++) {
        repSet[assignedRepInfo[ai].idx] = true;
      }
      for (var rr = 0; rr < eligibleRows.length; rr++) {
        var otherIdx = eligibleRows[rr];
        if (repSet[otherIdx]) continue;
        if (String(hubData[otherIdx][14] || "").trim() !== "") continue;
        var pickedRef = null;
        for (var pi = 0; pi < assignedRepInfo.length; pi++) {
          if (
            shouldAutoMarkCombinedReference_(
              hubData[otherIdx],
              assignedRepInfo[pi].uid,
              assignedRepInfo[pi].detail,
            )
          ) {
            pickedRef = assignedRepInfo[pi];
            break;
          }
        }
        if (!pickedRef) continue;
        var repInvoice = "";
        for (var ri = 0; ri < groupRows.length; ri++) {
          if (
            String(hubData[groupRows[ri]][2] || "").trim() === pickedRef.uid
          ) {
            repInvoice = String(hubData[groupRows[ri]][14] || "").trim();
            break;
          }
        }
        var refStatus = buildCombinedShipmentReferenceStatus_(
          pickedRef.uid,
          repInvoice,
        );
        if (String(hubData[otherIdx][12] || "") !== refStatus) {
          hubData[otherIdx][12] = refStatus;
          updates.push({
            row: otherIdx + 2,
            status: refStatus,
            inv: null,
            writeInvoice: false,
          });
          diag.referenceRows++;
        }
      }
    }

    // ── 2차 폴백 매칭: 이름으로 invoiceMap 검색 → 주소 앞부분 확인 ──
    // 그룹 키 매칭으로 못 찾은 행에 대해 이름만으로 넓게 검색
    var fallbackCount = 0;
    // invoiceMap 키에서 이름 → 엔트리 역 인덱스 구축
    var nameIndex = {};
    for (var mk in invoiceMap) {
      if (!invoiceMap.hasOwnProperty(mk)) continue;
      var underPos = mk.indexOf("_");
      var mName = underPos > 0 ? mk.substring(0, underPos) : mk;
      if (!mName || mName.length < 2) continue;
      if (!nameIndex[mName]) nameIndex[mName] = [];
      for (var me = 0; me < invoiceMap[mk].length; me++) {
        var entry = invoiceMap[mk][me];
        if (!entry || !entry.invRaw || globalUsedInvoices[entry.invRaw])
          continue;
        nameIndex[mName].push(entry);
      }
    }

    for (var fr = 0; fr < hubData.length; fr++) {
      if (String(hubData[fr][14] || "").trim() !== "") continue; // 이미 송장 있음
      if (isTerminalOrderStatus_(hubData[fr][12])) continue;
      var fbName = String(hubData[fr][8] || "").trim();
      if (!fbName || fbName.length < 2) continue;
      var fbCands = nameIndex[fbName];
      if (!fbCands || fbCands.length === 0) continue;

      // 주소 앞 10자로 교차 검증
      var hubAddr = String(hubData[fr][10] || "")
        .replace(/\s/g, "")
        .substring(0, 10);
      var bestInv = null;
      for (var fc = 0; fc < fbCands.length; fc++) {
        var cand = fbCands[fc];
        if (!cand || !cand.invRaw || globalUsedInvoices[cand.invRaw]) continue;
        // 주소 검증 없이 이름 일치만으로도 매칭 (주소 있으면 보너스)
        bestInv = cand;
        break;
      }
      if (bestInv && bestInv.invRaw) {
        globalUsedInvoices[bestInv.invRaw] = true;
        hubData[fr][12] = "발송완료";
        hubData[fr][14] = bestInv.invRaw;
        updates.push({
          row: fr + 2,
          status: "발송완료",
          inv: bestInv.invRaw,
          writeInvoice: true,
        });
        diag.assignedRows++;
        fallbackCount++;
      }
    }
    if (fallbackCount > 0) {
      scannedLogs.push(
        "[폴백매칭] 이름 기반 추가 " + fallbackCount + "건 배정",
      );
    }

    if (updates.length > 0) {
      for (var k = 0; k < updates.length; k++) {
        hubSheet.getRange(updates[k].row, 13).setValue(updates[k].status); // M열(13) 적요/상태 열에 기록
        if (updates[k].writeInvoice) {
          hubSheet.getRange(updates[k].row, 15).setValue(updates[k].inv); // O열(15) 송장번호 열에 기록
        }
      }
      SpreadsheetApp.flush();
      var mergeSummary =
        "[합배송 처리 요약]\n" +
        "- 그룹수: " +
        diag.groups +
        "\n" +
        "- 대표행 송장기입: " +
        diag.assignedRows +
        "건\n" +
        "- 비대표행 참조상태: " +
        diag.referenceRows +
        "건\n" +
        "- 수동잠금 그룹: " +
        diag.manualLockedGroups +
        "개\n" +
        "- 저신뢰 스킵: " +
        diag.lowConfidenceSkips +
        "건\n" +
        "- 후보없음 그룹: " +
        diag.noCandidateGroups +
        "개";
      appendAutomationEventLog_({
        jobType: "FETCH_INVOICE_COMBINED",
        ok: true,
        code: "",
        message:
          "updates=" +
          updates.length +
          ", groups=" +
          diag.groups +
          ", assigned=" +
          diag.assignedRows +
          ", ref=" +
          diag.referenceRows +
          ", manualLock=" +
          diag.manualLockedGroups +
          ", lowConfidence=" +
          diag.lowConfidenceSkips +
          ", noCandidate=" +
          diag.noCandidateGroups,
      });
      ui.alert(
        "✅ " +
          updates.length +
          "건의 송장/상태가 허브에 반영되었습니다.\n\n" +
          mergeSummary +
          "\n\n[스캔 로그]\n" +
          scannedLogs.join("\n"),
      );
    } else {
      appendAutomationEventLog_({
        jobType: "FETCH_INVOICE_COMBINED",
        ok: true,
        code: "NO_UPDATES",
        message:
          "updates=0, groups=" +
          diag.groups +
          ", manualLock=" +
          diag.manualLockedGroups +
          ", lowConfidence=" +
          diag.lowConfidenceSkips +
          ", noCandidate=" +
          diag.noCandidateGroups,
      });
      // 미매칭 진단: 허브에서 송장 비어있는 행과 invoiceMap 키 샘플 표시
      var unmatchedSamples = [];
      for (var ur = 0; ur < Math.min(hubData.length, 500); ur++) {
        if (String(hubData[ur][14] || "").trim() !== "") continue;
        if (isTerminalOrderStatus_(hubData[ur][12])) continue;
        var uName = String(hubData[ur][8] || "").trim();
        var uPhone = String(hubData[ur][9] || "").replace(/[^0-9]/g, "");
        var uShort =
          uPhone.length >= 4 ? uPhone.substring(uPhone.length - 4) : uPhone;
        var uKey = uName + "_" + uShort;
        var uP7 =
          uPhone.length >= 7 ? uName + "_P" + uPhone.substring(0, 7) : "";
        var found = invoiceMap[uKey]
          ? "기본✅"
          : uP7 && invoiceMap[uP7]
            ? "앞7✅"
            : "❌없음";
        unmatchedSamples.push(uName + "/" + uShort + "→" + found);
        if (unmatchedSamples.length >= 5) break;
      }
      var diagMsg =
        "\n\n[미매칭 진단]\n" +
        "- 그룹수: " +
        diag.groups +
        "\n" +
        "- 수동잠금: " +
        diag.manualLockedGroups +
        "\n" +
        "- 저신뢰스킵: " +
        diag.lowConfidenceSkips +
        "\n" +
        "- 후보없음: " +
        diag.noCandidateGroups +
        "\n" +
        "- invoiceMap 키 수: " +
        Object.keys(invoiceMap).length +
        "\n" +
        "- 송장 미할당 행 샘플:\n  " +
        (unmatchedSamples.length > 0
          ? unmatchedSamples.join("\n  ")
          : "(모두 할당됨)");
      ui.alert(
        "새로 매칭할 송장번호가 없거나 매칭 이름/연락처가 다릅니다.\n\n[스캔 로그]\n" +
          scannedLogs.join("\n") +
          diagMsg +
          "\n\n💡 송장 시트(로젠출력 등)의 헤더 이름이 정상인지, 허브의 주문자와 일치하는지 확인해 주세요.",
      );
    }
  } catch (e) {
    appendAutomationEventLog_({
      jobType: "FETCH_INVOICE_COMBINED",
      ok: false,
      code: "RUNTIME_EXCEPTION",
      message: String(e && e.message ? e.message : e),
    });
    ui.alert(
      "🚨 에러: " +
        e.message +
        "\n(송장 취합 시트 접근 권한 문제일 수 있습니다.)",
    );
  }
}

// -------------------------------------------------------------
// [신규] 과거 발주 내역 월마감 (아카이빙) 파트
// -------------------------------------------------------------
var ARCH_MONTH_SUMMARY_MARKER = "📊 월별 마감 요약";
var ARCH_MONTH_HEADER_ROW = 4;
var ARCH_MONTH_DATA_START = 5;
var ARCH_MONTH_KEY_CELL = "AZ1";
var ARCH_MONTH_KEY_PREFIX = "ARCHIVE_MONTH:";

function columnToLetter_(col) {
  var s = "";
  var n = col;
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function detectQtyPriceColsForArchive_(headers) {
  var cMap = buildOrderTabColumnMap_(headers);
  var qty = cMap.qty >= 0 ? cMap.qty + 1 : -1;
  var price = cMap.unitPrice >= 0 ? cMap.unitPrice + 1 : -1;
  if (qty > 0 && price > 0) return { qty: qty, price: price };
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] == null ? "" : headers[c]).replace(/\s/g, "");
    if (qty <= 0 && h.indexOf("수량") !== -1) qty = c + 1;
    if (
      price <= 0 &&
      (h.indexOf("정산단가") !== -1 ||
        h.indexOf("확정단가") !== -1 ||
        h.indexOf("정산금액") !== -1)
    )
      price = c + 1;
  }
  return { qty: qty, price: price };
}

function buildExtendedArchiveHeaders_(headers, lc) {
  var row = [];
  for (var c = 0; c < lc; c++) {
    row.push(c < headers.length ? headers[c] : "");
  }
  var names = row.map(function (x) {
    return String(x).trim();
  });
  if (names.indexOf("취소") === -1) row.push("취소");
  if (names.indexOf("반품") === -1) row.push("반품");
  return row;
}

function padArchiveRowToLength_(row, extLc, sourceLc) {
  var out = [];
  for (var i = 0; i < extLc; i++) {
    if (i < sourceLc) {
      out.push(i < row.length ? row[i] : "");
    } else {
      out.push(false);
    }
  }
  return out;
}

function clearArchiveTabProtections_(sheet) {
  try {
    var ps = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var i = 0; i < ps.length; i++) ps[i].remove();
    var pr = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    for (var j = 0; j < pr.length; j++) pr[j].remove();
  } catch (e) {}
}

function applyArchiveMonthSummaryFormulas_(
  archTab,
  dateCol1,
  qtyCol1,
  priceCol1,
  cancelCol1,
  returnCol1,
) {
  var dL = columnToLetter_(dateCol1);
  var qL = columnToLetter_(qtyCol1);
  var pL = columnToLetter_(priceCol1);
  var cL = columnToLetter_(cancelCol1);
  var rL = columnToLetter_(returnCol1);
  var dr = String(ARCH_MONTH_DATA_START);

  var dOpen = dL + dr + ":" + dL;
  var qOpen = qL + dr + ":" + qL;
  var pOpen = pL + dr + ":" + pL;
  var cOpen = cL + dr + ":" + cL;
  var rOpen = rL + dr + ":" + rL;

  // N()은 텍스트 수량·단가를 0으로 만듦 → IFERROR(1*범위,0)으로 숫자 동작에 가깝게
  var qCoerce = "IFERROR(1*(" + qOpen + "),0)";
  var pCoerce = "IFERROR(1*(" + pOpen + "),0)";

  // L열이 이미 단가×수량인 정산금액이면 SUM으로 직접 합산, 아니면 기존 SUMPRODUCT 유지
  var isTotalCol = false;
  try {
    var hdrCell = archTab.getRange(ARCH_MONTH_HEADER_ROW, priceCol1).getValue();
    isTotalCol = String(hdrCell).replace(/\s/g, "").indexOf("정산금액") !== -1;
  } catch (_) {}

  var sumAll, sumNet;
  if (isTotalCol) {
    // 정산금액 = 단가×수량 → SUM만
    sumAll = "=IFERROR(SUMPRODUCT((" + dOpen + '<>"")*(' + pCoerce + ")),0)";
    sumNet =
      "=IFERROR(SUMPRODUCT((" +
      dOpen +
      '<>"")*(' +
      cOpen +
      "<>TRUE)*(" +
      rOpen +
      "<>TRUE)*(" +
      pCoerce +
      ")),0)";
  } else {
    // 기존 정산단가 = 1개 단가 → SUMPRODUCT(수량×단가)
    sumAll =
      "=IFERROR(SUMPRODUCT((" +
      dOpen +
      '<>"")*(' +
      qCoerce +
      ")*(" +
      pCoerce +
      ")),0)";
    sumNet =
      "=IFERROR(SUMPRODUCT((" +
      dOpen +
      '<>"")*(' +
      cOpen +
      "<>TRUE)*(" +
      rOpen +
      "<>TRUE)*(" +
      qCoerce +
      ")*(" +
      pCoerce +
      ")),0)";
  }
  var cntAll = "=IFERROR(COUNTIF(" + dOpen + ',"<>"),0)';
  var cntNet =
    "=IFERROR(SUMPRODUCT((" +
    dOpen +
    '<>"")*(' +
    cOpen +
    "<>TRUE)*(" +
    rOpen +
    "<>TRUE)),0)";

  archTab
    .getRange(2, 1)
    .setValue(isTotalCol ? "전체 정산금액 합계" : "전체 금액 합계(수량×단가)");
  archTab.getRange(2, 2).setFormula(sumAll).setNumberFormat("#,##0");
  archTab.getRange(2, 3).setValue("전체 건수(일자 있음)");
  archTab.getRange(2, 4).setFormula(cntAll).setNumberFormat("#,##0");

  archTab.getRange(3, 1).setValue("취소·반품 제외 금액");
  archTab.getRange(3, 2).setFormula(sumNet).setNumberFormat("#,##0");
  archTab.getRange(3, 3).setValue("취소·반품 제외 건수");
  archTab.getRange(3, 4).setFormula(cntNet).setNumberFormat("#,##0");

  archTab
    .getRange(2, 1, 3, 4)
    .setBackground("#f3f3f3")
    .setBorder(true, true, true, true, true, true);
}

function applyArchiveMonthProtection_(archTab, cancelCol1, returnCol1) {
  clearArchiveTabProtections_(archTab);
  try {
    var maxRows = archTab.getMaxRows();
    var numRows = Math.max(1, maxRows - ARCH_MONTH_DATA_START + 1);
    var numCols = Math.max(1, returnCol1 - cancelCol1 + 1);
    var p = archTab.protect().setDescription("월별 마감(취소·반품 열만 편집)");
    var un = archTab.getRange(
      ARCH_MONTH_DATA_START,
      cancelCol1,
      numRows,
      numCols,
    );
    p.setUnprotectedRanges([un]);
    p.setWarningOnly(false);
  } catch (e) {}
}

function layoutArchiveMonthSheet_(
  archTab,
  extHeaders,
  orderCols,
  dateCol1,
  firstHeaderCell,
  isNewBlankSheet,
) {
  var extLc = extHeaders.length;
  var cancelCol1 = extLc - 1;
  var returnCol1 = extLc;
  var topLeft = String(archTab.getRange(1, 1).getValue()).trim();
  var fh = String(firstHeaderCell).trim();

  if (!isNewBlankSheet && topLeft === fh) {
    archTab.insertRowsBefore(1, 3);
  }

  try {
    archTab.getRange(1, 1, 1, 12).breakApart();
  } catch (e1) {}

  archTab
    .getRange(1, 1, 1, 6)
    .merge()
    .setValue(ARCH_MONTH_SUMMARY_MARKER)
    .setBackground("#666666")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  var headerRowNum = ARCH_MONTH_HEADER_ROW;

  archTab
    .getRange(headerRowNum, 1, 1, extLc)
    .setValues([extHeaders])
    .setBackground("#999999")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  archTab.setFrozenRows(headerRowNum);

  if (orderCols.qty > 0 && orderCols.price > 0) {
    applyArchiveMonthSummaryFormulas_(
      archTab,
      dateCol1,
      orderCols.qty,
      orderCols.price,
      cancelCol1,
      returnCol1,
    );
  } else {
    archTab.getRange(2, 1, 3, 4).clearContent().setBackground("#f3f3f3");
    archTab
      .getRange(2, 1)
      .setValue(
        "※ 수량/정산금액 열을 찾지 못해 합계를 넣지 못했습니다. 헤더명을 확인하세요.",
      );
  }

  applyArchiveMonthProtection_(archTab, cancelCol1, returnCol1);
}

function isArchiveMonthTabName_(name) {
  return /^\(\d{4}년 \d{1,2}월\) 발주 마감$/.test(String(name).trim());
}

function buildArchiveMonthKey_(yyyy, mm) {
  var m = String(mm);
  if (m.length < 2) m = "0" + m;
  return ARCH_MONTH_KEY_PREFIX + String(yyyy) + "-" + m;
}

function setArchiveMonthKey_(sheet, monthKey) {
  if (!monthKey) return;
  try {
    sheet
      .getRange(ARCH_MONTH_KEY_CELL)
      .setValue(monthKey)
      .setFontColor("white");
  } catch (e) {}
}

function findArchiveMonthSheetByKey_(ss, monthKey) {
  if (!monthKey) return null;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    try {
      var key = String(
        sh.getRange(ARCH_MONTH_KEY_CELL).getValue() || "",
      ).trim();
      if (key === monthKey) return sh;
    } catch (e) {}
  }
  return null;
}

function parseArchiveTabYearMonthFromName_(tabName) {
  var m = String(tabName || "").match(/^\((\d{4})년 (\d{1,2})월\) 발주 마감$/);
  if (!m) return null;
  return { yyyy: m[1], mm: parseInt(m[2], 10) };
}

/**
 * 발주 및 송장조회 탭의 1행 헤더 배열에서 각 역할별 컬럼 인덱스(0-based)를 찾아 돌려준다.
 * 못 찾은 역할은 -1.
 *
 * ⚠ 이전에는 이 로직이 pullOrdersFromVendors / pushInvoicesToVendors /
 *    archivePastOrders / diagnoseArchiveCandidates / getArchiveContextFromOrderTab_
 *    다섯 곳에 조금씩 다르게 복제되어 있었음. 헤더 문구가 바뀔 때마다 5곳을 동시에
 *    고쳐야 했고, 실제로 '주문일자' 헤더 누락이 한 곳에서만 처리되어 전체 월마감이
 *    실패하는 사고의 원인이 되었다. 이를 막기 위해 단일 헬퍼로 통합한다.
 *
 * else-if 구조로 설계한 이유:
 *  - '주소'와 '수취인' 같이 서로 다른 역할 헤더가 부분 포함 관계를 가질 수 있어
 *    먼저 매칭된 역할이 이기도록 해야 오매핑을 줄일 수 있다.
 */
function resolveShipToAddressColumn_(cMap) {
  if (!cMap) return -1;
  if (cMap.addrRecv !== -1) return cMap.addrRecv;
  return cMap.addr;
}

function buildOrderTabColumnMap_(headers) {
  var cMap = {
    date: -1,
    code: -1,
    vendorSku: -1,
    phone: -1,
    mobile: -1,
    client: -1,
    clientCode: -1,
    item: -1,
    /** 업체별대리발송 「변환상품명」 등 — 있으면 별칭·표시명 우선 배치 */
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
    /** 주문 금액·합계(운임·단품배송비 제외) */
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
      h.indexOf("주문날짜") !== -1 ||
      h.indexOf("발주일") !== -1 ||
      /월\/일/.test(h) ||
      /일자[-._]?No\.?/i.test(h) ||
      /일자.*No/i.test(h) ||
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
    )
      cMap.item = c;
    else if (h.indexOf("순번") !== -1) {
      if (cMap.seq === -1) cMap.seq = c;
    } else if (h.indexOf("배송방식") !== -1) {
      if (cMap.shipMethod === -1) cMap.shipMethod = c;
    } else if (
      h.indexOf("박스수량") !== -1 ||
      h.indexOf("택배수량") !== -1 ||
      h.indexOf("택배박스수량") !== -1 ||
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
    )
      cMap.msg = c;
    else if (h.indexOf("송장") !== -1 || h.indexOf("운송장") !== -1)
      cMap.invoice = c;
    else if (h.indexOf("적요") !== -1) {
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
      h.indexOf("택배운임") === -1 &&
      h.indexOf("배송비") === -1 &&
      h.indexOf("단품배송비") === -1
    ) {
      if (cMap.lineTotal === -1) cMap.lineTotal = c;
    } else if (h.indexOf("고유ID") !== -1) cMap.uniqueId = c;
    else if (h.indexOf("주소1") !== -1) {
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
      h.indexOf("송하인") === -1 &&
      h.indexOf("보내시는") === -1
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
      h.indexOf("보내시는") === -1 &&
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
  if (cMap.status === -1 && cMap.voucherMemo !== -1) {
    cMap.status = cMap.voucherMemo;
  }
  return cMap;
}

/**
 * 대리공급 풀→전용양식 푸시 전용 cMap 보정.
 * 통합 빌더는 「상태」 헤더가 없으면 적요 열을 status에 병합하는데, 푸시 시 적요에는 글자를 넣지 않는다.
 */
function normalizeColumnMapForProxyPush_(cMap) {
  if (!cMap) return cMap;
  if (cMap.voucherMemo !== -1 && cMap.status === cMap.voucherMemo) {
    cMap.status = -1;
  }
  return cMap;
}

/** 전용양식에 실제 매핑된 열 요약(푸시 직후 운영 확인용). */
function formatProxyDeployColumnDigest_(cMap) {
  if (!cMap) return "";
  var parts = [];
  function push(ix, label) {
    if (ix !== -1) parts.push(label + (ix + 1));
  }
  push(cMap.date, "일자");
  push(cMap.seq, "순번");
  push(cMap.code, "품목코드");
  push(cMap.item, "품목명");
  push(cMap.itemAlt, "변환품목명");
  push(cMap.vendorSku, "업체코드열");
  push(cMap.qty, "수량");
  push(cMap.lineTotal, "합계");
  push(cMap.recipient, "수령인");
  push(cMap.mobile, "모바일");
  push(cMap.phone, "전화");
  push(cMap.addrRecv, "받는주소");
  push(cMap.addr, "주소");
  push(cMap.msg, "배송메모");
  return parts.join(", ");
}

/** 이카운트코드 전용 열이 없어도(품목명만 있는 양식) 푸시 가능 — 날짜 없는 엑셀형 헤더 포함 */
function proxyDeployHeaderRowHasMinimumRoles_(cMap) {
  if (!cMap) return false;
  if (cMap.code === -1 && cMap.item === -1) return false;
  return (
    cMap.date !== -1 ||
    cMap.seq !== -1 ||
    cMap.recipient !== -1 ||
    cMap.addrRecv !== -1 ||
    cMap.addr !== -1 ||
    cMap.phone !== -1 ||
    cMap.mobile !== -1 ||
    cMap.qty !== -1 ||
    cMap.msg !== -1 ||
    cMap.invoice !== -1 ||
    cMap.client !== -1 ||
    cMap.clientCode !== -1 ||
    cMap.vendorSku !== -1 ||
    cMap.shipMethod !== -1 ||
    cMap.unitPrice !== -1 ||
    cMap.lineTotal !== -1
  );
}

/**
 * 대리공급 푸시용: 대상 발주 탭에서 날짜·코드 열 탐지.
 * 제목 행만 있는 경우 등 1행이 비어 있으면 2~5행도 본다. 표시값(getDisplayValues)로 spill 헤더 인식.
 */
function resolveOrderTabColumnMapForProxyPush_(orderTab) {
  if (!orderTab) return null;
  var lc = Math.max(orderTab.getLastColumn(), 13);
  if (lc > 56) lc = 56;
  var lastR = Math.max(orderTab.getLastRow(), 1);
  var maxHr = Math.min(lastR, 22);
  var r;
  for (r = 1; r <= maxHr; r++) {
    var headers = orderTab.getRange(r, 1, 1, lc).getDisplayValues()[0];
    var cMap = normalizeColumnMapForProxyPush_(
      buildOrderTabColumnMap_(headers),
    );
    if (proxyDeployHeaderRowHasMinimumRoles_(cMap)) {
      return { cMap: cMap, headerRow: r, lc: lc };
    }
  }
  return null;
}

function getArchiveContextFromOrderTab_(orderTab) {
  var lr = orderTab.getLastRow();
  var lc = orderTab.getMaxColumns();
  if (lr < 1) return null;
  var headers = orderTab.getRange(1, 1, 1, lc).getValues()[0];
  var cMap = buildOrderTabColumnMap_(headers);
  if (cMap.date === -1) return null;
  var orderCols = detectQtyPriceColsForArchive_(headers);
  var extHeaders = buildExtendedArchiveHeaders_(headers, lc);
  return {
    lc: lc,
    orderCols: orderCols,
    extHeaders: extHeaders,
    extLc: extHeaders.length,
    dateCol1: cMap.date + 1,
    firstHeaderCell: headers[0],
  };
}

function getCurrentMonthArchiveTabName_() {
  var now = new Date();
  var yyyy = Utilities.formatDate(now, "Asia/Seoul", "yyyy");
  var mm = parseInt(Utilities.formatDate(now, "Asia/Seoul", "M"), 10);
  return "(" + yyyy + "년 " + mm + "월) 발주 마감";
}

function getCurrentMonthArchiveKey_() {
  var now = new Date();
  var yyyy = Utilities.formatDate(now, "Asia/Seoul", "yyyy");
  var mm = parseInt(Utilities.formatDate(now, "Asia/Seoul", "M"), 10);
  return buildArchiveMonthKey_(yyyy, mm);
}

function padExistingArchiveDataRows_(archTab, extLc, cancelCol1, returnCol1) {
  var lr = archTab.getLastRow();
  if (lr < ARCH_MONTH_DATA_START) return;
  var lastCol = archTab.getLastColumn();
  var maxRead = Math.max(lastCol, extLc);
  for (var r = ARCH_MONTH_DATA_START; r <= lr; r++) {
    var row = archTab.getRange(r, 1, 1, maxRead).getValues()[0];
    while (row.length < extLc) row.push("");
    if (row.length > extLc) row = row.slice(0, extLc);
    if (row[cancelCol1 - 1] === "" || row[cancelCol1 - 1] === null) {
      row[cancelCol1 - 1] = false;
    }
    if (row[returnCol1 - 1] === "" || row[returnCol1 - 1] === null) {
      row[returnCol1 - 1] = false;
    }
    archTab.getRange(r, 1, 1, extLc).setValues([row]);
  }
}

function ensureArchiveCheckboxColumnsOnDataRows_(
  archTab,
  cancelCol1,
  returnCol1,
) {
  var lr = archTab.getLastRow();
  if (lr < ARCH_MONTH_DATA_START) return;
  var rowCount = lr - ARCH_MONTH_DATA_START + 1;
  var colCount = Math.max(1, returnCol1 - cancelCol1 + 1);
  var dv = archTab
    .getRange(ARCH_MONTH_DATA_START, cancelCol1, rowCount, colCount)
    .getDataValidations();
  for (var i = 0; i < dv.length; i++) {
    var r = ARCH_MONTH_DATA_START + i;
    var need = false;
    for (var j = 0; j < dv[i].length; j++) {
      var cellDv = dv[i][j];
      if (!cellDv) {
        need = true;
        break;
      }
      try {
        if (
          cellDv.getCriteriaType() !==
          SpreadsheetApp.DataValidationCriteria.CHECKBOX
        ) {
          need = true;
          break;
        }
      } catch (e2) {
        need = true;
        break;
      }
    }
    if (need) {
      archTab.getRange(r, cancelCol1, 1, colCount).clearDataValidations();
      archTab.getRange(r, cancelCol1, 1, colCount).setValue(false);
      archTab.getRange(r, cancelCol1, 1, colCount).insertCheckboxes();
    }
  }
}

function repairAllVendorArchiveMonthTabs() {
  var ui = SpreadsheetApp.getUi();
  if (
    ui.alert(
      "🔧 기존 월별 마감 탭 보정",
      "모든 독립 배포 시트에서 이름이\n「(연도년 월월) 발주 마감」형태인 탭을 찾아,\n상단 요약·4행 헤더·취소·반품 열·합계 수식·보호·체크박스를 최신 형식으로 맞춥니다.\n\n※ 「발주 및 송장조회」1행 헤더(주문일자 등)가 정상일 때만 해당 파일이 처리됩니다.\n\n계속할까요?",
      ui.ButtonSet.YES_NO,
    ) !== ui.Button.YES
  ) {
    return;
  }
  var fileCount = 0;
  var tabCount = 0;
  forEachVendorDeployFile_(function (file) {
    var ss;
    try {
      ss = SpreadsheetApp.openById(file.getId());
    } catch (e) {
      return;
    }
    var orderTab = ss.getSheetByName("발주 및 송장조회");
    if (!orderTab) return;
    var ctx = getArchiveContextFromOrderTab_(orderTab);
    if (!ctx) return;
    var sheets = ss.getSheets();
    var touched = false;
    for (var s = 0; s < sheets.length; s++) {
      var sh = sheets[s];
      if (!isArchiveMonthTabName_(sh.getName())) continue;
      var cancelCol1 = ctx.extLc - 1;
      var returnCol1 = ctx.extLc;
      layoutArchiveMonthSheet_(
        sh,
        ctx.extHeaders,
        ctx.orderCols,
        ctx.dateCol1,
        ctx.firstHeaderCell,
        false,
      );
      padExistingArchiveDataRows_(sh, ctx.extLc, cancelCol1, returnCol1);
      ensureArchiveCheckboxColumnsOnDataRows_(sh, cancelCol1, returnCol1);
      applyArchiveMonthProtection_(sh, cancelCol1, returnCol1);
      tabCount++;
      touched = true;
    }
    if (touched) {
      fileCount++;
      SpreadsheetApp.flush();
    }
  });
  ui.alert(
    "✅ 보정 완료\n처리한 배포 파일: " +
      fileCount +
      "개\n보정한 월마감 탭: " +
      tabCount +
      "개",
  );
}

function ensureCurrentMonthArchiveTabForAllVendors() {
  return ensureCurrentMonthArchiveTabForAllVendorsCore_(false);
}

function ensureCurrentMonthArchiveTabForVendorFileId(fileId, silent) {
  silent = !!silent;
  if (!fileId) return { created: false, skipped: true, reason: "no_file_id" };
  var tabName = getCurrentMonthArchiveTabName_();
  var monthKey = getCurrentMonthArchiveKey_();
  var ss;
  try {
    ss = SpreadsheetApp.openById(fileId);
  } catch (e) {
    return { created: false, skipped: true, reason: "open_fail" };
  }
  var orderTab = ss.getSheetByName("발주 및 송장조회");
  if (!orderTab)
    return { created: false, skipped: true, reason: "no_order_tab" };
  var ctx = getArchiveContextFromOrderTab_(orderTab);
  if (!ctx) return { created: false, skipped: true, reason: "invalid_header" };
  var existingByName = ss.getSheetByName(tabName);
  var existingByKey = findArchiveMonthSheetByKey_(ss, monthKey);
  var existing = existingByName || existingByKey;
  if (existing) {
    // 기존 탭도 레이아웃/체크박스가 깨졌을 수 있으므로 즉시 자가복구
    var cancelCol1 = ctx.extLc - 1;
    var returnCol1 = ctx.extLc;
    layoutArchiveMonthSheet_(
      existing,
      ctx.extHeaders,
      ctx.orderCols,
      ctx.dateCol1,
      ctx.firstHeaderCell,
      false,
    );
    padExistingArchiveDataRows_(existing, ctx.extLc, cancelCol1, returnCol1);
    ensureArchiveCheckboxColumnsOnDataRows_(existing, cancelCol1, returnCol1);
    applyArchiveMonthProtection_(existing, cancelCol1, returnCol1);
    setArchiveMonthKey_(existing, monthKey);
    return { created: false, skipped: true, reason: "already_exists" };
  }
  var archTab = ss.insertSheet(tabName);
  layoutArchiveMonthSheet_(
    archTab,
    ctx.extHeaders,
    ctx.orderCols,
    ctx.dateCol1,
    ctx.firstHeaderCell,
    true,
  );
  setArchiveMonthKey_(archTab, monthKey);
  SpreadsheetApp.flush();
  if (!silent) {
    try {
      SpreadsheetApp.getUi().alert("생성 완료: " + tabName);
    } catch (e2) {}
  }
  return { created: true, skipped: false, reason: "created" };
}

function ensureCurrentMonthArchiveTabForAllVendorsCore_(silent) {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e0) {}
  var tabName = getCurrentMonthArchiveTabName_();
  var monthKey = getCurrentMonthArchiveKey_();
  if (!silent && ui) {
    if (
      ui.alert(
        "📅 당월 마감 탭 준비",
        "모든 독립 배포 시트에 아래 이름의 탭이 없으면\n빈 껍데기(요약·4행 헤더·합계 수식·보호만)를 만듭니다.\n\n「" +
          tabName +
          "」\n\n계속할까요?",
        ui.ButtonSet.YES_NO,
      ) !== ui.Button.YES
    ) {
      return;
    }
  }
  var created = 0;
  var skipped = 0;
  var skippedNoOrder = 0;
  var openFail = 0;
  var openFailNames = [];
  forEachVendorDeployFile_(function (file) {
    var ss;
    try {
      ss = SpreadsheetApp.openById(file.getId());
    } catch (e1) {
      openFail++;
      openFailNames.push(file.getName());
      try {
        Logger.log(
          "[ENSURE_MONTH_TAB_OPEN_FAIL] " +
            file.getName() +
            " : " +
            (e1 && e1.message ? e1.message : e1),
        );
      } catch (_) {}
      return;
    }
    var orderTab = ss.getSheetByName("발주 및 송장조회");
    if (!orderTab) {
      skippedNoOrder++;
      return;
    }
    var ctx = getArchiveContextFromOrderTab_(orderTab);
    if (!ctx) {
      skippedNoOrder++;
      return;
    }
    var existingByName = ss.getSheetByName(tabName);
    var existingByKey = findArchiveMonthSheetByKey_(ss, monthKey);
    var existing = existingByName || existingByKey;
    if (existing) {
      // 이미 있는 당월 탭도 점검/복구를 수행해 체크박스 누락을 방지
      var cancelCol1 = ctx.extLc - 1;
      var returnCol1 = ctx.extLc;
      layoutArchiveMonthSheet_(
        existing,
        ctx.extHeaders,
        ctx.orderCols,
        ctx.dateCol1,
        ctx.firstHeaderCell,
        false,
      );
      padExistingArchiveDataRows_(existing, ctx.extLc, cancelCol1, returnCol1);
      ensureArchiveCheckboxColumnsOnDataRows_(existing, cancelCol1, returnCol1);
      applyArchiveMonthProtection_(existing, cancelCol1, returnCol1);
      setArchiveMonthKey_(existing, monthKey);
      skipped++;
      return;
    }
    var archTab = ss.insertSheet(tabName);
    layoutArchiveMonthSheet_(
      archTab,
      ctx.extHeaders,
      ctx.orderCols,
      ctx.dateCol1,
      ctx.firstHeaderCell,
      true,
    );
    setArchiveMonthKey_(archTab, monthKey);
    created++;
    SpreadsheetApp.flush();
  });
  if (!silent && ui) {
    ui.alert(
      "✅ 당월 마감 탭 준비 완료\n\n신규 생성: " +
        created +
        "개\n이미 탭 있음: " +
        skipped +
        "개\n발주 탭 없음·헤더 불가: " +
        skippedNoOrder +
        "개\n열기 실패: " +
        openFail +
        "개" +
        (openFail > 0
          ? "\n (" +
            openFailNames.slice(0, 3).join(", ") +
            (openFailNames.length > 3 ? "…" : "") +
            ")"
          : ""),
    );
  }

  appendAutomationEventLog_({
    jobType: "ENSURE_MONTH_TAB_ALL",
    ok: openFail === 0,
    code: openFail > 0 ? "PARTIAL_OPEN_FAIL" : "",
    message:
      "신규생성 " +
      created +
      " · 기존탭유지 " +
      skipped +
      " · 발주탭없음등 " +
      skippedNoOrder +
      " · 열기실패 " +
      openFail +
      (silent ? " (silent)" : ""),
  });
  if (openFail > 0) {
    setArchiveScriptHealth_(false, "PARTIAL_OPEN_FAIL");
  } else {
    setArchiveScriptHealth_(true);
  }
  return {
    created: created,
    skipped: skipped,
    skippedNoOrder: skippedNoOrder,
    openFail: openFail,
  };
}

var MONTHLY_ARCHIVE_SHELL_HANDLER = "runMonthlyArchiveTabShellScheduled";

function runMonthlyArchiveTabShellScheduled() {
  var dayStr = Utilities.formatDate(new Date(), "Asia/Seoul", "d");
  if (dayStr !== "1") return;
  try {
    ensureCurrentMonthArchiveTabForAllVendorsCore_(true);
  } catch (e) {
    setArchiveScriptHealth_(false, "RUNTIME_EXCEPTION");
    appendAutomationEventLog_({
      jobType: "MONTHLY_SHELL_TAB",
      ok: false,
      code: "RUNTIME_EXCEPTION",
      message: String(e && e.message ? e.message : e),
    });
  }
}

function installMonthlyArchiveShellTrigger() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === MONTHLY_ARCHIVE_SHELL_HANDLER) {
      ui.alert("✅ 이미 매월 1일 당월 마감 탭 자동 생성이 켜져 있습니다.");
      return;
    }
  }
  ScriptApp.newTrigger(MONTHLY_ARCHIVE_SHELL_HANDLER)
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();
  ui.alert(
    "예약 완료: 매일 오전 8시에 실행되며, 서울 기준 달력 1일에만 당월 빈 마감 탭을 만듭니다.",
  );
}

function removeMonthlyArchiveShellTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === MONTHLY_ARCHIVE_SHELL_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
      n++;
    }
  }
  try {
    SpreadsheetApp.getUi().alert("자동 생성 예약을 " + n + "건 해제했습니다.");
  } catch (e2) {}
}

function archivePastOrders() {
  // UI 호출이 아닐 수도 있으므로 (Trigger)
  var isManual = false;
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
    isManual = true;
  } catch (e) {}

  if (isManual && ui) {
    var msg = ui.alert(
      "📁 스마트 일일 발주 마감 (수동 실행)",
      "모든 배포 시트에서 '오늘 이전' 발주이면서 '송장이 나왔거나 취소된 완료건'들만\n해당 월별 마감 탭으로 싹 치워버립니다.\n\n(아직 송장이 없는 녀석은 눈치 보며 메인 탭에 악착같이 남습니다!)\n\n지금 청소할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (msg !== ui.Button.YES) return;
  }

  var lock = null;
  if (typeof acquireAutomationScriptLock_ === "function") {
    lock = acquireAutomationScriptLock_("ARCHIVE_PAST_ORDERS", 45000);
  } else {
    try {
      var fallbackLock = LockService.getScriptLock();
      if (fallbackLock.tryLock(45000)) lock = fallbackLock;
    } catch (eLock) {}
  }
  if (!lock) {
    if (isManual && ui) {
      ui.alert(
        "⏳ 다른 자동화 작업이 실행 중이라 월마감 작업을 잠시 건너뜁니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    return;
  }

  try {
    var archiveCount = 0;

    var now = new Date();
    var todayStr = Utilities.formatDate(now, "Asia/Seoul", "yyyyMMdd");
    var todayNum = parseInt(todayStr, 10);

    var openFailCount = 0;
    var openFailNames = [];
    var noOrderTabCount = 0;

    try {
      forEachVendorDeployFile_(function (file) {
        var ss;
        try {
          ss = SpreadsheetApp.openById(file.getId());
        } catch (e) {
          openFailCount++;
          openFailNames.push(file.getName());
          try {
            Logger.log(
              "[ARCHIVE_OPEN_FAIL] " +
                file.getName() +
                " : " +
                (e && e.message ? e.message : e),
            );
          } catch (_) {}
          return;
        }
        var orderTab = ss.getSheetByName("발주 및 송장조회");
        if (!orderTab) {
          noOrderTabCount++;
          return;
        }

        var lr = orderTab.getLastRow();
        var lc = orderTab.getMaxColumns();
        if (lr <= 1) return;

        var fullData = orderTab.getRange(1, 1, lr, lc).getValues();
        var headers = fullData[0];
        var cMap = buildOrderTabColumnMap_(headers);
        if (cMap.date === -1) return; // 발주 양식이 아닌 경우 패스

        var orderCols = detectQtyPriceColsForArchive_(headers);
        var extHeaders = buildExtendedArchiveHeaders_(headers, lc);
        var extLc = extHeaders.length;
        var dateCol1 = cMap.date + 1;
        var firstHeaderCell = headers[0];

        var keepData = [];
        var archiveDataByMonth = {};

        for (var r = 1; r < fullData.length; r++) {
          var rowData = fullData[r];
          var orderDate = rowData[cMap.date];

          if (!orderDate) {
            keepData.push(rowData);
            continue;
          }

          var dateStr = "";
          if (orderDate instanceof Date) {
            dateStr = Utilities.formatDate(orderDate, "Asia/Seoul", "yyyyMMdd");
          } else {
            dateStr = String(orderDate).replace(/[^0-9]/g, "");
          }

          if (dateStr.length >= 8) {
            var dNum = parseInt(dateStr.substring(0, 8), 10);
            var isPast = dNum < todayNum; // "오늘(today)"보다 과거의 주문인지 판별

            // 1. 상태가 "완료" 인지 확인 (송장번호 존재 or 취소/품절 처리)
            var isDone = false;
            var statusVal =
              cMap.status !== -1
                ? String(rowData[cMap.status]).replace(/\s/g, "")
                : "";
            var invoiceVal =
              cMap.invoice !== -1 ? String(rowData[cMap.invoice]).trim() : "";

            if (
              invoiceVal !== "" ||
              statusVal.indexOf("취소") !== -1 ||
              statusVal.indexOf("품절") !== -1 ||
              statusVal.indexOf("발송완료") !== -1
            ) {
              isDone = true;
            }

            // 2. 스마트 조건부 분류
            if (isPast && isDone) {
              var yyyy = dateStr.substring(0, 4);
              var mm = parseInt(dateStr.substring(4, 6), 10);
              var tabName = "(" + yyyy + "년 " + mm + "월) 발주 마감";

              if (!archiveDataByMonth[tabName])
                archiveDataByMonth[tabName] = [];
              archiveDataByMonth[tabName].push(rowData);
            } else {
              // 과거일자라도 아직 미처리(송장X, 취소X)면 끈질기게 보전
              // 당일 주문도 당연히 보전
              keepData.push(rowData);
            }
          } else {
            keepData.push(rowData);
          }
        }

        var hasArchived = false;

        // 분류된 데이터가 있다면 해당하는 각각의 X월 마감 탭으로 밀어넣기
        for (var tabName in archiveDataByMonth) {
          var arr = archiveDataByMonth[tabName];
          if (arr.length > 0) {
            hasArchived = true;
            var ym = parseArchiveTabYearMonthFromName_(tabName);
            var monthKey = ym ? buildArchiveMonthKey_(ym.yyyy, ym.mm) : "";
            var archTab = ss.getSheetByName(tabName);
            if (!archTab && monthKey) {
              archTab = findArchiveMonthSheetByKey_(ss, monthKey);
            }
            if (!archTab) {
              archTab = findArchiveMonthSheetByKey_(ss, monthKey);
              if (!archTab) {
                archTab = ss.insertSheet(tabName);
              }
            }
            var isNewBlank = archTab.getLastRow() < 1;
            layoutArchiveMonthSheet_(
              archTab,
              extHeaders,
              orderCols,
              dateCol1,
              firstHeaderCell,
              isNewBlank,
            );
            setArchiveMonthKey_(archTab, monthKey);
            // 기존 행의 체크박스가 누락된 경우를 먼저 복구
            ensureArchiveCheckboxColumnsOnDataRows_(archTab, extLc - 1, extLc);
            var padded = [];
            for (var pi = 0; pi < arr.length; pi++) {
              padded.push(padArchiveRowToLength_(arr[pi], extLc, lc));
            }
            var nextRow = archTab.getLastRow() + 1;
            if (nextRow < ARCH_MONTH_DATA_START) {
              nextRow = ARCH_MONTH_DATA_START;
            }
            archTab
              .getRange(nextRow, 1, padded.length, extLc)
              .setValues(padded)
              .setVerticalAlignment("middle");
            var cancelCol1 = extLc - 1;
            var returnCol1 = extLc;
            var checkColCount = returnCol1 - cancelCol1 + 1; // 취소/반품 2열
            archTab
              .getRange(nextRow, cancelCol1, padded.length, checkColCount)
              .clearDataValidations();
            archTab
              .getRange(nextRow, cancelCol1, padded.length, checkColCount)
              .setValue(false);
            archTab
              .getRange(nextRow, cancelCol1, padded.length, checkColCount)
              .insertCheckboxes();
            applyArchiveMonthProtection_(archTab, cancelCol1, returnCol1);
          }
        }

        if (hasArchived) {
          // 🚨 [중요] A열(거래처명)과 L열(정산단가)은 A1/L1의 spill 수식 결과이므로
          //   setValues로 값을 박으면 spill 수식이 #REF! 로 깨진다.
          //   → clearContent로만 비우고, 나머지 B~K / M 열만 값 복원한다.
          orderTab.getRange(2, 1, orderTab.getMaxRows() - 1, lc).clearContent();
          if (keepData.length > 0) {
            // B~K열 (index 1~10, 10개 컬럼)
            var bkCount = Math.min(10, lc - 1);
            if (bkCount > 0) {
              var bkData = [];
              for (var kki = 0; kki < keepData.length; kki++) {
                bkData.push(keepData[kki].slice(1, 1 + bkCount));
              }
              orderTab
                .getRange(2, 2, keepData.length, bkCount)
                .setValues(bkData);
            }
            // M열 (index 12) 이후 — 고유ID/비고 등 spill이 아닌 뒷열
            if (lc >= 13) {
              var tailWidth = lc - 12;
              var tailData = [];
              for (var tti = 0; tti < keepData.length; tti++) {
                var tailRow = keepData[tti].slice(12, 12 + tailWidth);
                while (tailRow.length < tailWidth) tailRow.push("");
                tailData.push(tailRow);
              }
              orderTab
                .getRange(2, 13, keepData.length, tailWidth)
                .setValues(tailData);
            }

            // 보존된 주문 건들 최신순 정렬 — spill 열(A, L)은 정렬 대상에서 제외
            if (keepData.length > 1) {
              // B~K 정렬 (10열), 그리고 M~끝 정렬은 sort 대상에서 A,L 컬럼만 빼면 되므로
              // B열부터 K열까지만 정렬한다. M열 이후는 고유ID이므로 정렬 영향이 거의 없다.
              orderTab
                .getRange(2, 2, keepData.length, Math.min(10, lc - 1))
                .sort([{ column: cMap.date + 1, ascending: false }]);
            }
          }

          // 5단계 직후 L1/A1 spill이 혹시 깨져있다면 즉시 복구
          try {
            var viewerTabForHeal2 = null;
            var allT2 = ss.getSheets();
            for (var vtt = 0; vtt < allT2.length; vtt++) {
              var tn2 = allT2[vtt].getName();
              if (
                tn2.indexOf("단가조회") !== -1 ||
                tn2.indexOf("뷰어") !== -1
              ) {
                viewerTabForHeal2 = allT2[vtt];
                break;
              }
            }
            if (
              viewerTabForHeal2 &&
              typeof healOrderSpillFormulas_ === "function"
            ) {
              healOrderSpillFormulas_(orderTab, viewerTabForHeal2.getName());
            }
          } catch (eHealArch) {}

          archiveCount++;
          SpreadsheetApp.flush();
        }
      });

      try {
        // 통합 발주 DB도 같은 기준(오늘 이전 완료건)으로 함께 정리
        if (typeof archiveHubIntegratedOrdersScheduled === "function") {
          archiveHubIntegratedOrdersScheduled();
        }
      } catch (hubArchiveErr) {
        appendAutomationEventLog_({
          jobType: "HUB_ARCHIVE",
          ok: false,
          code: "CHAINED_FROM_ARCHIVE_PAST_ORDERS_FAIL",
          message: String(
            hubArchiveErr && hubArchiveErr.message
              ? hubArchiveErr.message
              : hubArchiveErr,
          ),
        });
      }

      var partialFailMsg = "";
      if (openFailCount > 0 || noOrderTabCount > 0) {
        partialFailMsg =
          " | 열기실패: " +
          openFailCount +
          (openFailCount > 0
            ? "(" +
              openFailNames.slice(0, 3).join(", ") +
              (openFailNames.length > 3 ? "…" : "") +
              ")"
            : "") +
          " | 발주탭없음: " +
          noOrderTabCount;
      }
      appendAutomationEventLog_({
        jobType: "ARCHIVE_PAST_ORDERS",
        ok: openFailCount === 0,
        code: openFailCount > 0 ? "PARTIAL_OPEN_FAIL" : "",
        message: "마감이동 발생 업체(파일) 수 " + archiveCount + partialFailMsg,
      });
      if (openFailCount > 0) {
        setArchiveScriptHealth_(false, "PARTIAL_OPEN_FAIL");
      } else {
        setArchiveScriptHealth_(true);
      }
    } catch (archErr) {
      setArchiveScriptHealth_(false, "RUNTIME_EXCEPTION");
      appendAutomationEventLog_({
        jobType: "ARCHIVE_PAST_ORDERS",
        ok: false,
        code: "RUNTIME_EXCEPTION",
        message: String(archErr && archErr.message ? archErr.message : archErr),
      });
      if (isManual && ui) {
        try {
          ui.alert(
            "❌ 월마감(아카이브) 처리 중 오류:\n" +
              (archErr.message || archErr),
          );
        } catch (eAlert) {}
      }
      return;
    }

    if (isManual && ui) {
      if (archiveCount > 0) {
        ui.alert(
          "✅ " +
            archiveCount +
            "개 업체의 배포 시트가 쾌적하게 청소되었습니다!\n송장 및 처리가 안끝난 애들은 메인 탭에 징그럽게 살아있습니다!",
        );
      } else {
        ui.alert(
          "ℹ️ 청소할 완료건(과거 일자)이 현재 배포 시트들에 없습니다. 아주 깨끗한 상태입니다.",
        );
      }
    }
  } finally {
    if (typeof releaseAutomationScriptLock_ === "function") {
      releaseAutomationScriptLock_(lock);
    } else {
      try {
        lock.releaseLock();
      } catch (eUnlock) {}
    }
  }
}

// -------------------------------------------------------------
// 시간 주도형 트리거(자동 청소기) 설치 및 해제 스크립트
// -------------------------------------------------------------
function installDailyArchiveTrigger() {
  var ui = SpreadsheetApp.getUi();
  // 중복 설치 방지
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "archivePastOrders") {
      ui.alert("✅ 이미 '자동 청소기(트리거)'가 설치되어 돌아가고 있습니다!");
      return;
    }
  }

  ScriptApp.newTrigger("archivePastOrders")
    .timeBased()
    .atHour(2)
    .nearMinute(40) // runDailyEcountBatch(2:10)과 충돌 방지
    .everyDays(1)
    .create();

  ui.alert(
    "🚀 자동 청소기가 성공적으로 가동되었습니다!\n\n이제 신경 끄셔도 됩니다. 매일 새벽 2시40분마다 로봇이 조용히 깨어나 '송장이 박힌 묵은 주문'들만 쏙쏙 뽑아다가 월별 탭으로 치워둡니다.",
  );
}

// -------------------------------------------------------------
// [신규] 경영자 전용 실시간 BI 대시보드 탭 자동 구축
// -------------------------------------------------------------
function buildManagerDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dashTab = ss.getSheetByName("📊 경영자 대시보드");

  if (dashTab) {
    SpreadsheetApp.getUi().alert(
      "✅ 이미 '📊 경영자 대시보드' 탭이 존재합니다!",
    );
    ss.setActiveSheet(dashTab);
    return;
  }

  // 첫 번째 위치에 탭 생성
  dashTab = ss.insertSheet("📊 경영자 대시보드", 0);

  // 깔끔한 배경색 및 틀 세팅
  dashTab.getRange("A1:H100").setBackground("#f3f3f3");

  // 제목 섹션
  dashTab
    .getRange("A1:G2")
    .merge()
    .setValue("🏆 실시간 경영자 통합 대시보드")
    .setBackground("#1155cc")
    .setFontColor("white")
    .setFontSize(18)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // 1. 오늘의 종합 실적 (A4:C8)
  dashTab
    .getRange("A4:D4")
    .merge()
    .setValue("📈 오늘 접수된 영업 실적")
    .setBackground("#d9d2e9")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  dashTab.getRange("A5").setValue("오늘총매출액(예상):");
  dashTab
    .getRange("B5:D5")
    .merge()
    .setFormula(
      "=IFERROR(SUMPRODUCT(('통합 발주 DB'!E:E>=TODAY())*('통합 발주 DB'!H:H)*('통합 발주 DB'!P:P)), 0)",
    )
    .setNumberFormat('#,##0"원"')
    .setFontSize(14)
    .setFontColor("#cc0000")
    .setFontWeight("bold");
  dashTab.getRange("A6").setValue("오늘주문건수:");
  dashTab
    .getRange("B6:D6")
    .merge()
    .setFormula("=COUNTIFS('통합 발주 DB'!E:E, \">=\"&TODAY())")
    .setNumberFormat('#,##0"건"');
  dashTab.getRange("A7").setValue("발송완료수:");
  dashTab
    .getRange("B7:D7")
    .merge()
    .setFormula(
      "=COUNTIFS('통합 발주 DB'!E:E, \">=\"&TODAY(), '통합 발주 DB'!M:M, \"발송완료\")",
    )
    .setNumberFormat('#,##0"건"');
  dashTab.getRange("A8").setValue("재고부족(대기)건수:");
  dashTab
    .getRange("B8:D8")
    .merge()
    .setFormula("=COUNTIFS('통합 발주 DB'!M:M, \"*재고부족*\")")
    .setNumberFormat('#,##0"건"')
    .setFontColor("#cc0000")
    .setFontWeight("bold");

  dashTab
    .getRange("A5:D8")
    .setBackground("white")
    .setBorder(true, true, true, true, true, true);

  // 2. 우수 벤더 랭킹 (F4:H15)
  dashTab
    .getRange("F4:H4")
    .merge()
    .setValue("🏅 이달의 VIP 거래처 랭킹 (발주수량 기준 VENDOR)")
    .setBackground("#fff2cc")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  dashTab
    .getRange("F5")
    .setFormula(
      "=QUERY('통합 발주 DB'!B:H, \"SELECT B, SUM(H) WHERE B IS NOT NULL GROUP BY B ORDER BY SUM(H) DESC LIMIT 10 LABEL B 'VIP 벤더명', SUM(H) '누적 발주수량'\", 1)",
    );
  dashTab
    .getRange("F5:G15")
    .setBackground("white")
    .setBorder(true, true, true, true, true, true);

  // 3. 베스트셀러 품목 랭킹 (A11:D25)
  dashTab
    .getRange("A11:D11")
    .merge()
    .setValue("🔥 실시간 베스트셀러 품목 TOP 15")
    .setBackground("#d9ead3")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  dashTab
    .getRange("A12")
    .setFormula(
      "=QUERY('통합 발주 DB'!F:H, \"SELECT F, G, SUM(H) WHERE F IS NOT NULL GROUP BY F, G ORDER BY SUM(H) DESC LIMIT 15 LABEL F '품목코드', G '품목명', SUM(H) '판매수량'\", 1)",
    );
  dashTab
    .getRange("A12:C26")
    .setBackground("white")
    .setBorder(true, true, true, true, true, true);

  // 컬럼 너비 조정
  dashTab.setColumnWidth(1, 150);
  dashTab.setColumnWidth(2, 100);
  dashTab.setColumnWidth(3, 100);
  dashTab.setColumnWidth(4, 100);
  dashTab.setColumnWidth(5, 40); // 여백
  dashTab.setColumnWidth(6, 150);
  dashTab.setColumnWidth(7, 100);

  ss.setActiveSheet(dashTab);
  SpreadsheetApp.getUi().alert(
    "📊 경영자 대시보드 생성이 완료되었습니다!\n이 시트는 엑셀 쿼리(QUERY) 함수로 구축되어 자동 갱신됩니다.",
  );
}

// =============================================================================
// 🔍 5단계 아카이브 진단 — "왜 넘어가지 않는지" 행별로 찍어주는 함수
// =============================================================================
function diagnoseArchiveCandidates() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (eUi) {
    ui = null;
  }

  var now = new Date();
  var todayStr = Utilities.formatDate(now, "Asia/Seoul", "yyyyMMdd");
  var todayNum = parseInt(todayStr, 10);

  var lines = [];
  lines.push("=== 5단계 아카이브 진단 ===");
  lines.push("오늘 날짜 기준: " + todayStr);
  lines.push(
    "아카이브 조건: 주문일자 < 오늘 AND (송장있음 OR 상태에 취소/품절/발송완료)",
  );
  lines.push("");

  var fileCount = 0;
  var totalRows = 0;
  var totalCandidates = 0;
  var totalSkippedPast = 0;
  var totalSkippedDone = 0;
  var totalEmptyDate = 0;

  forEachVendorDeployFile_(function (file) {
    fileCount++;

    var ss;
    try {
      ss = SpreadsheetApp.openById(file.getId());
    } catch (eOpen) {
      lines.push("❌ [" + file.getName() + "] 열기 실패: " + eOpen.message);
      return;
    }
    var orderTab = ss.getSheetByName("발주 및 송장조회");
    if (!orderTab) {
      lines.push("❌ [" + file.getName() + "] '발주 및 송장조회' 탭 없음");
      return;
    }

    var lr = orderTab.getLastRow();
    var lc = orderTab.getMaxColumns();
    if (lr <= 1) return;

    var fullData = orderTab.getRange(1, 1, lr, lc).getValues();
    var headers = fullData[0];
    var cMap = buildOrderTabColumnMap_(headers);

    if (cMap.date === -1) {
      lines.push(
        "⚠ [" + file.getName() + "] 주문일자 헤더를 탐지 못함 → 파일 전체 skip",
      );
      lines.push("   현재 헤더: " + headers.slice(0, 14).join(" | "));
      return;
    }

    var fileRows = fullData.length - 1;
    totalRows += fileRows;
    var fileCandidates = 0;
    var filePast = 0;
    var fileDone = 0;
    var fileEmpty = 0;
    var samplesNotMoved = [];

    for (var r = 1; r < fullData.length; r++) {
      var rowData = fullData[r];
      var orderDate = rowData[cMap.date];
      var statusVal =
        cMap.status !== -1
          ? String(rowData[cMap.status]).replace(/\s/g, "")
          : "";
      var invoiceVal =
        cMap.invoice !== -1 ? String(rowData[cMap.invoice]).trim() : "";

      if (!orderDate) {
        fileEmpty++;
        continue;
      }

      var dateStr = "";
      if (orderDate instanceof Date) {
        dateStr = Utilities.formatDate(orderDate, "Asia/Seoul", "yyyyMMdd");
      } else {
        dateStr = String(orderDate).replace(/[^0-9]/g, "");
      }

      if (dateStr.length < 8) {
        fileEmpty++;
        continue;
      }

      var dNum = parseInt(dateStr.substring(0, 8), 10);
      var isPast = dNum < todayNum;
      var isDone =
        invoiceVal !== "" ||
        statusVal.indexOf("취소") !== -1 ||
        statusVal.indexOf("품절") !== -1 ||
        statusVal.indexOf("발송완료") !== -1;

      if (isPast && isDone) {
        fileCandidates++;
      } else if (!isPast && isDone) {
        filePast++; // 오늘/미래 주문이라 보류
        if (samplesNotMoved.length < 3) {
          samplesNotMoved.push(
            "행" +
              (r + 1) +
              ": 날짜=" +
              dateStr +
              " (오늘 이후), 송장='" +
              invoiceVal +
              "', 상태='" +
              statusVal +
              "' → 미이동사유: 오늘/미래",
          );
        }
      } else if (isPast && !isDone) {
        fileDone++; // 과거 주문인데 완료 상태 아님
        if (samplesNotMoved.length < 3) {
          samplesNotMoved.push(
            "행" +
              (r + 1) +
              ": 날짜=" +
              dateStr +
              " (과거), 송장='" +
              invoiceVal +
              "', 상태='" +
              statusVal +
              "' → 미이동사유: 송장/완료상태 없음",
          );
        }
      }
    }

    totalCandidates += fileCandidates;
    totalSkippedPast += filePast;
    totalSkippedDone += fileDone;
    totalEmptyDate += fileEmpty;

    lines.push("📄 " + file.getName());
    lines.push(
      "   cMap  : date=" +
        cMap.date +
        ", status=" +
        cMap.status +
        ", invoice=" +
        cMap.invoice,
    );
    lines.push(
      "   행수  : " +
        fileRows +
        " / 이동대상: " +
        fileCandidates +
        " / 오늘미래: " +
        filePast +
        " / 완료안됨: " +
        fileDone +
        " / 일자없음: " +
        fileEmpty,
    );
    if (samplesNotMoved.length) {
      for (var si = 0; si < samplesNotMoved.length; si++) {
        lines.push("   · " + samplesNotMoved[si]);
      }
    }
    lines.push("");
  });

  lines.push("─────────────────────────────");
  lines.push("총 파일: " + fileCount + " / 총 행: " + totalRows);
  lines.push("이동대상 총합  : " + totalCandidates);
  lines.push("오늘/미래 스킵: " + totalSkippedPast);
  lines.push("완료상태 없음 : " + totalSkippedDone);
  lines.push("일자 비어있음 : " + totalEmptyDate);
  lines.push("");
  lines.push("💡 이동대상이 0이라면:");
  lines.push(
    "   - 과거 주문 중 송장이 이미 적혀있는 행 또는 상태가 '발송완료/취소/품절'인 행이 없는 상태.",
  );
  lines.push(
    "   - K열(송장번호)이 비어있거나 J열(적요/상태)이 '접수 대기'로만 남아있으면 아카이브 대상이 아님.",
  );

  var out = lines.join("\n");
  Logger.log(out);
  try {
    console.log(out);
  } catch (eC) {}
  if (ui) ui.alert("5단계 아카이브 진단 (로그에도 동일 기록)\n\n" + out);
}

// -------------------------------------------------------------
// [신규] 발주 및 송장조회 1행 헤더 자동 보정
// - A열(거래처명) / L열(정산단가)은 spill 수식이 자체 헤더를 만드므로 건드리지 않음
// - B~J, K, M의 '일반 텍스트 헤더' 중 비어있거나 다른 값이 들어간 셀만 정상 헤더로 복원
// -------------------------------------------------------------
var ORDER_TAB_CANONICAL_HEADERS = [
  "거래처명", // A  (spill — 건드리지 않음)
  "주문일자(YYYYMMDD)", // B
  "품목코드", // C
  "품목명", // D
  "수량", // E
  "수취인", // F
  "수취인전화번호", // G
  "수취인주소", // H
  "배송메시지", // I
  "적요", // J
  "송장번호", // K
  "정산금액", // L  (spill — 건드리지 않음)
  "고유ID", // M
];

function repairOrderTabHeadersForSheet_(orderTab) {
  if (!orderTab) return { fixed: 0, fixedCols: [] };
  var totalCols = ORDER_TAB_CANONICAL_HEADERS.length; // 13
  var maxCol = orderTab.getMaxColumns();
  if (maxCol < totalCols) {
    try {
      orderTab.insertColumnsAfter(maxCol, totalCols - maxCol);
    } catch (eIns) {}
  }
  var range = orderTab.getRange(1, 1, 1, totalCols);
  var current = range.getValues()[0];
  var fixedCols = [];
  for (var c = 0; c < totalCols; c++) {
    // A(0)·L(11)은 spill 수식이라 값 덮지 않음
    if (c === 0 || c === 11) continue;
    var have = String(current[c] == null ? "" : current[c]).trim();
    var want = ORDER_TAB_CANONICAL_HEADERS[c];
    if (have !== want) {
      orderTab.getRange(1, c + 1).setValue(want);
      fixedCols.push(columnToLetter_(c + 1) + "1=" + want);
    }
  }
  if (fixedCols.length > 0) {
    try {
      orderTab
        .getRange(1, 1, 1, totalCols)
        .setBackground("#4a86e8")
        .setFontColor("white")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
      orderTab.getRange("J1:K1").setBackground("#38761d");
    } catch (eStyle) {}
  }
  return { fixed: fixedCols.length, fixedCols: fixedCols };
}

function repairAllVendorOrderTabHeaders() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (eUi) {
    ui = null;
  }
  if (ui) {
    var go = ui.alert(
      "🧩 '발주 및 송장조회' 1행 헤더 자동 보정",
      "모든 [독립 배포] 시트의 '발주 및 송장조회' 탭 1행을 점검하여,\n" +
        "비어있거나 틀어진 헤더(B~J, K, M)를 정상값으로 복원합니다.\n" +
        "A1(거래처명)·L1(정산단가)은 spill 수식이라 건드리지 않습니다.\n\n" +
        "계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (go !== ui.Button.YES) return;
  }
  var fileScanned = 0;
  var fileRepaired = 0;
  var totalFixedCells = 0;
  var report = [];
  forEachVendorDeployFile_(function (file) {
    fileScanned++;
    var ss;
    try {
      ss = SpreadsheetApp.openById(file.getId());
    } catch (eOpen) {
      report.push(
        "❌ [" + file.getName() + "] 열기 실패: " + (eOpen.message || eOpen),
      );
      return;
    }
    var orderTab = ss.getSheetByName("발주 및 송장조회");
    if (!orderTab) {
      report.push("⚠ [" + file.getName() + "] 발주 및 송장조회 탭 없음");
      return;
    }
    try {
      var res = repairOrderTabHeadersForSheet_(orderTab);
      if (res.fixed > 0) {
        fileRepaired++;
        totalFixedCells += res.fixed;
        report.push(
          "🔧 [" +
            file.getName() +
            "] 복원 " +
            res.fixed +
            "개 → " +
            res.fixedCols.join(", "),
        );
        SpreadsheetApp.flush();
      }
    } catch (eRep) {
      report.push(
        "❌ [" + file.getName() + "] 복원 중 오류: " + (eRep.message || eRep),
      );
    }
  });
  var header =
    "✅ 완료\n" +
    "점검 파일: " +
    fileScanned +
    "개\n" +
    "복원 발생 파일: " +
    fileRepaired +
    "개\n" +
    "복원한 헤더 셀 합계: " +
    totalFixedCells +
    "개";
  var out = header + (report.length ? "\n\n" + report.join("\n") : "");
  Logger.log(out);
  if (ui) ui.alert(out);
}

// ─── 전용양식 헤더 업데이트 & 직접 매핑 진단 ──────────────────────────

/**
 * 모든 독립배포 시트의 「… 전용양식」탭 1행 헤더를
 * EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_ 정의에 맞춰 업데이트한다.
 * 메뉴에서 수동 호출용.
 */
function repairVendorExclusiveFormatHeaders() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    ui = null;
  }
  if (ui) {
    var go = ui.alert(
      "🔧 전용양식 헤더 업데이트",
      "모든 독립배포 시트의 '전용양식' 탭 1행을 EMBEDDED 정의에 맞춰 업데이트합니다.\n계속할까요?",
      ui.ButtonSet.YES_NO,
    );
    if (go !== ui.Button.YES) return;
  }

  // prefix → headerCsv 맵 생성
  var pfxHeaderMap = {};
  for (var i = 0; i < EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_.length; i++) {
    var row = EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_[i];
    pfxHeaderMap[row.label] = row.headerCsv;
  }

  var report = [];
  var fixed = 0;
  forEachVendorDeployFile_(function (file) {
    var ss;
    try {
      ss = SpreadsheetApp.openById(file.getId());
    } catch (e) {
      return;
    }
    var sheets = ss.getSheets();
    var suf = PROXY_ORDER_VENDOR_FORMAT_TAB_SUFFIX;
    for (var s = 0; s < sheets.length; s++) {
      var name = String(sheets[s].getName() || "");
      if (name.length < suf.length) continue;
      if (name.substring(name.length - suf.length) !== suf) continue;

      // 양식명 추출: "뉴파츠_NEW 전용양식" → "뉴파츠_NEW"
      var label = name.substring(0, name.length - suf.length).trim();
      var csvStr = pfxHeaderMap[label];
      if (!csvStr) {
        report.push(
          "⚠ [" +
            file.getName() +
            "] 탭 '" +
            name +
            "': EMBEDDED에 '" +
            label +
            "' 없음",
        );
        continue;
      }

      var headers = csvStr.split("|");
      var tab = sheets[s];
      var maxCol = tab.getMaxColumns();
      if (maxCol < headers.length) {
        try {
          tab.insertColumnsAfter(maxCol, headers.length - maxCol);
        } catch (e) {}
      }
      tab.getRange(1, 1, 1, headers.length).setValues([headers]);
      try {
        tab
          .getRange(1, 1, 1, headers.length)
          .setBackground("#4a86e8")
          .setFontColor("white")
          .setFontWeight("bold")
          .setHorizontalAlignment("center");
      } catch (e) {}
      fixed++;
      report.push(
        "✅ [" +
          file.getName() +
          "] '" +
          name +
          "' → " +
          headers.length +
          "열 헤더 적용",
      );
      SpreadsheetApp.flush();
    }
  });

  var msg =
    "전용양식 헤더 업데이트 완료: " + fixed + "개 탭\n\n" + report.join("\n");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

/**
 * 직접 매핑 진단: 소스 풀 헤더와 HR 접두 행의 실제 값을 확인한다.
 * 메뉴에서 수동 호출해서 데이터 흐름을 점검.
 */
function diagnoseDirectColumnMapping() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    ui = null;
  }
  var hubSs = SpreadsheetApp.getActiveSpreadsheet();
  var msg = "=== 직접 매핑 진단 ===";

  // 1. 소스 풀 탭 확인
  try {
    var poolSs = SpreadsheetApp.openById(PROXY_ORDER_POOL_SPREADSHEET_ID);
    var srcTab = getSheetByGid_(poolSs, PROXY_ORDER_SOURCE_TAB_GID);
    if (!srcTab) {
      msg += "\n❌ 소스 풀 탭(gid=" + PROXY_ORDER_SOURCE_TAB_GID + ") 없음";
    } else {
      var srcLr = srcTab.getLastRow();
      var srcLc = srcTab.getLastColumn();
      var srcHeaders = srcTab
        .getRange(1, 1, 1, Math.min(srcLc, 26))
        .getDisplayValues()[0];
      msg +=
        "\n\n📋 소스 풀 탭: '" +
        srcTab.getName() +
        "' (" +
        srcLr +
        "행 × " +
        srcLc +
        "열)";
      msg += "\n헤더: ";
      for (var c = 0; c < srcHeaders.length; c++) {
        msg +=
          "\n  " + columnToLetter_(c + 1) + "(" + c + "): " + srcHeaders[c];
      }

      // HR 접두 행 샘플 찾기
      if (srcLr >= 2) {
        var srcData = srcTab
          .getRange(1, 1, Math.min(srcLr, 20), srcLc)
          .getValues();
        var cMap = buildOrderTabColumnMap_(srcData[0]);
        var doneCol = findProxySourceDoneColumnIndex_(srcData[0]);
        msg += "\n\n🔍 cMap.code=" + cMap.code + ", cMap.date=" + cMap.date;
        msg += "\n   doneCol=" + doneCol;

        var hrSample = null;
        for (var r = 1; r < srcData.length; r++) {
          var code = String(srcData[r][cMap.code] || "").replace(/\s/g, "");
          var pfx = extractProxySupplierRoutePrefixExcel_(code);
          if (pfx === "HR") {
            var done =
              doneCol !== -1 ? String(srcData[r][doneCol] || "").trim() : "";
            msg += "\n\n📌 HR 샘플 행 " + (r + 1) + " (done=" + done + "):";
            for (var sc = 0; sc < Math.min(srcData[r].length, 15); sc++) {
              msg += "\n  " + columnToLetter_(sc + 1) + ": " + srcData[r][sc];
            }
            hrSample = srcData[r];
            break;
          }
        }
        if (!hrSample) msg += "\n\n⚠ 소스 풀에서 HR 접두 데이터를 찾을 수 없음";
      }
    }
  } catch (e) {
    msg += "\n❌ 소스 풀 열기 실패: " + (e.message || e);
  }

  // 2. 매핑 확인
  try {
    var mapSheet = getProxySupplierMapSheet_(hubSs);
    if (!mapSheet) {
      msg += "\n\n❌ 매핑 시트 없음";
    } else {
      var mapBuilt = buildProxySupplierDeployMap_(mapSheet);
      var hrRoute = mapBuilt.byPrefix["HR"];
      if (!hrRoute) {
        msg +=
          "\n\n❌ 매핑에 HR 접두 등록 없음. 등록된 접두: " +
          Object.keys(mapBuilt.byPrefix).join(", ");
      } else {
        msg += "\n\n✅ HR 매핑: fileId=" + hrRoute.fileId;
        msg += ", tabName=" + (hrRoute.tabName || "(자동: 전용양식 탭)");

        // 타겟 파일/탭 확인
        try {
          var dss = SpreadsheetApp.openById(hrRoute.fileId);
          var oTab = resolveProxyOrderTargetSheet_(dss, hrRoute.tabName);
          if (!oTab) {
            msg += "\n❌ 전용양식 탭을 찾을 수 없음!";
            var allTabs = dss.getSheets().map(function (s) {
              return s.getName();
            });
            msg += "\n   파일 내 탭 목록: " + allTabs.join(", ");
          } else {
            msg +=
              "\n✅ 타겟 탭: '" +
              oTab.getName() +
              "' (" +
              oTab.getLastRow() +
              "행)";
            var tHeaders = oTab
              .getRange(1, 1, 1, Math.min(oTab.getLastColumn(), 26))
              .getDisplayValues()[0];
            msg += "\n   현재 헤더: ";
            for (var tc = 0; tc < tHeaders.length; tc++) {
              msg +=
                "\n   " +
                columnToLetter_(tc + 1) +
                "(" +
                tc +
                "): " +
                tHeaders[tc];
            }
          }
        } catch (eT) {
          msg += "\n❌ 타겟 파일 열기 실패: " + (eT.message || eT);
        }
      }
    }
  } catch (eM) {
    msg += "\n❌ 매핑 확인 실패: " + (eM.message || eM);
  }

  // 3. 직접 매핑 설정 확인
  var dm = VENDOR_DIRECT_COLUMN_MAP_["HR"];
  if (dm) {
    msg += "\n\n✅ VENDOR_DIRECT_COLUMN_MAP_[HR] 설정됨";
    msg +=
      "\n   totalCols=" +
      dm.totalCols +
      ", dateCol=" +
      dm.dateCol +
      ", seqCol=" +
      dm.seqCol;
    msg +=
      "\n   sourceToTarget: " +
      (dm.sourceToTarget || [])
        .map(function (m) {
          return m.label;
        })
        .join(", ");
  } else {
    msg += "\n\n❌ VENDOR_DIRECT_COLUMN_MAP_[HR] 설정 없음!";
  }

  Logger.log(msg);
  if (ui) ui.alert(msg);
}
