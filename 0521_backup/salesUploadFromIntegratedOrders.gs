const SALES_PRICE_MAP_SHEET = "업체등급단가매핑";
const SALES_SETTLEMENT_PREFIX = "독립배포_정산_";
const SALES_UPLOAD_TRIGGER_HANDLER = "runIntegratedSalesUploadScheduled";
const SALES_SPLIT_SENT_COL_NAME = "판매업로드확정_분리전송";
/** 이카운트 PC: 판매현황 엑셀 업로드 양식(컬럼 순서 고정, 임의 삽입 금지) */
const SALES_STATUS_PASTE_SHEET = "이카운트-판매현황업로드용";
const SALES_STATUS_PASTE_HEADERS = [
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
const SALES_STATUS_PASTE_SOURCE_SHEET = "통합 발주 DB";
const SALES_STATUS_PASTE_TRIGGER_HANDLER = "runSalesStatusPasteRebuildScheduled_";
/** simple onEdit 스로틀(초). 연속 입력 시 재계산 남발 방지 */
const SALES_STATUS_PASTE_ONEDIT_THROTTLE_SEC = 25;
/** `통합 발주 DB` 표준 레이아웃(A~P): P열=확정단가(수집·동결 시 자동 반영, 1-based 16 → 0-based 15) */
const HUB_ORDER_DB_COL_INDEX_UNIT_PRICE_P = 15;

/** 통합 발주 DB·배포 시트 단가 셀: 숫자/문자·천단위 콤마 등 정규화 */
function parseHubNumericPrice_(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number" && !isNaN(value)) return value;
  var s = String(value)
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!s) return NaN;
  var n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function runIntegratedSalesUploadScheduled() {
  removeIntegratedSalesUploadTriggers(true);
}

function runIntegratedSalesUploadPrecheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
  var sourceRows = collectSalesSourceRows_(ss, {});
  var dedupedRows = dedupeBySourcePriority_(sourceRows);
  var mappingReady = validateVendorCustMappingForRows_(ss, dedupedRows);
  var skipLog = {};
  var bundle = buildHubPriceBundle_();
  var vendorMap = buildVendorPriceMap_(ss);

  var prepared = [];
  var validationErrors = [];
  for (var i = 0; i < dedupedRows.length; i++) {
    var normalized = normalizeAndValidateRow_(
      dedupedRows[i],
      vendorMap,
      bundle,
      skipLog,
      { ignoreUploadLog: true },
    );
    if (normalized.skipReason) validationErrors.push(normalized);
    else prepared.push(normalized);
  }

  var reasonSummary = summarizeSkipReasons_(validationErrors);
  var lines = [];
  lines.push("판매현황 탭·엑셀 복붙 사전 점검");
  lines.push("");
  lines.push("- 원천 건수: " + sourceRows.length);
  lines.push("- 중복제거 후: " + dedupedRows.length);
  lines.push("- 양식에 넣을 수 있는 행: " + prepared.length);
  lines.push("- 검증 제외: " + validationErrors.length);
  lines.push("- 매핑 준비상태: " + (mappingReady.ok ? "OK" : "미완료"));
  if (!mappingReady.ok) lines.push("  · " + mappingReady.message);
  if (!mappingReady.ok && mappingReady.missingVendors && mappingReady.missingVendors.length > 0) {
    lines.push("  · 미매핑 업체 목록: " + mappingReady.missingVendors.slice(0, 20).join(", "));
  }
  lines.push("");
  lines.push("검증 제외 사유(상위):");
  if (!reasonSummary || reasonSummary.length === 0) {
    lines.push("- 없음");
  } else {
    for (var r = 0; r < Math.min(reasonSummary.length, 8); r++) {
      lines.push("- " + reasonSummary[r].reason + ": " + reasonSummary[r].count + "건");
    }
  }
  SpreadsheetApp.getUi().alert(lines.join("\n"));
}

/** 메뉴: 『이카운트-판매현황업로드용』 수동 갱신(다이얼로그 요약 포함) */
function runRebuildSalesStatusPasteSheetManual_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
  rebuildSalesStatusPasteSheet_(ss, { silent: false });
}

function runSalesUploadVendorMappingDeepCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
  var sourceRows = collectSalesSourceRows_(ss, {});
  var dedupedRows = dedupeBySourcePriority_(sourceRows);
  var vendorMap = buildVendorPriceMap_(ss);

  var vendorSet = {};
  for (var i = 0; i < dedupedRows.length; i++) {
    var v = sanitizeVendorText_(dedupedRows[i].vendorCode || dedupedRows[i].vendorName || "");
    if (v) vendorSet[v] = true;
  }
  var vendors = Object.keys(vendorSet);
  var missing = [];
  var okCount = 0;
  for (var j = 0; j < vendors.length; j++) {
    var hit = resolveVendorMapEntry_(vendors[j], vendorMap);
    if (hit && String(hit.custCd || "").trim()) okCount++;
    else missing.push(vendors[j] + " (norm=" + normalizeVendorMapKey_(vendors[j]) + ")");
  }

  var lines = [];
  lines.push("판매현황(엑셀) 매핑 정밀 점검");
  lines.push("");
  lines.push("- 업로드 대상 업체 수: " + vendors.length);
  lines.push("- 매핑 성공: " + okCount);
  lines.push("- 매핑 실패: " + missing.length);
  lines.push("- 매핑사전 키 수: " + Object.keys(vendorMap || {}).length);
  if (missing.length > 0) {
    lines.push("");
    lines.push("미매핑 업체(상위 20):");
    for (var m = 0; m < Math.min(20, missing.length); m++) lines.push("- " + missing[m]);
  }
  SpreadsheetApp.getUi().alert(lines.join("\n"));
}

/**
 * 파일을 열 때(onOpen): 탭이 없으면 바로 만든다(헤더만).
 * 통합 발주 DB에 데이터가 있으면 같은 흐름에서 1회 조용히 rebuild(트리거·편집 없이도 동기).
 */
function ensureSalesStatusPasteSheetOnOpen_(ss) {
  if (!ss) return;
  var hub = ss.getSheetByName(SALES_STATUS_PASTE_SOURCE_SHEET);
  var hasHubData = hub && hub.getLastRow() > 1;
  var paste = ss.getSheetByName(SALES_STATUS_PASTE_SHEET);
  if (hasHubData) {
    rebuildSalesStatusPasteSheet_(ss, { silent: true });
    return;
  }
  if (!paste) {
    paste = ss.insertSheet(SALES_STATUS_PASTE_SHEET);
    paste
      .getRange(1, 1, 1, SALES_STATUS_PASTE_HEADERS.length)
      .setValues([SALES_STATUS_PASTE_HEADERS]);
    paste.setFrozenRows(1);
    try {
      paste.setTabColor("#0f9d58");
    } catch (e1) {}
  }
}

/**
 * 통합 발주 DB → 이카운트 판매현황 엑셀 업로드 양식(복붙용) 시트를 덮어쓴다.
 * 메뉴 없이 onOpen·onEdit·주기 트리거·발주수집 후 호출. opts.silent 로 UI 생략.
 */
function rebuildSalesStatusPasteSheet_(ss, opts) {
  opts = opts || {};
  var silent = !!opts.silent;
  if (!ss) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(45000)) return;
  try {
    var sourceRows = collectSalesSourceRows_(ss, {});
    var dedupedRows = dedupeBySourcePriority_(sourceRows);
    var skipLog = {};
    var bundle = buildHubPriceBundle_();
    var vendorMap = buildVendorPriceMap_(ss);

    var prepared = [];
    var validationErrors = [];
    for (var i = 0; i < dedupedRows.length; i++) {
      var normalized = normalizeAndValidateRow_(
        dedupedRows[i],
        vendorMap,
        bundle,
        skipLog,
        { ignoreUploadLog: true },
      );
      if (normalized.skipReason) validationErrors.push(normalized);
      else prepared.push(normalized);
    }

    var sh = ss.getSheetByName(SALES_STATUS_PASTE_SHEET);
    if (!sh) sh = ss.insertSheet(SALES_STATUS_PASTE_SHEET);
    sh.clearContents();
    sh.getRange(1, 1, 1, SALES_STATUS_PASTE_HEADERS.length).setValues([
      SALES_STATUS_PASTE_HEADERS,
    ]);
    sh.setFrozenRows(1);
    try {
      sh.setTabColor("#0f9d58");
    } catch (tc) {}

    var colCount = SALES_STATUS_PASTE_HEADERS.length;
    var out = [];
    for (var r = 0; r < prepared.length; r++) {
      var row = prepared[r];
      var totalAmt = Math.round(
        (parseFloat(row.qty) || 0) * (parseFloat(row.snapshotUnitPrice) || 0),
      );
      var supplyAmt = Math.round(totalAmt / 1.1);
      var vatAmt = totalAmt - supplyAmt;
      var addrNetMsg = [row.recipientAddr || "", row.deliveryMessage || ""]
        .filter(function (x) {
          return String(x || "").trim() !== "";
        })
        .join(" / ");

      var line = new Array(colCount);
      for (var c = 0; c < colCount; c++) line[c] = "";
      // SALES_STATUS_PASTE_HEADERS 순서와 동일(0-based). 운영: B,D,E,G,Q,X 는 비움, AB=생산전표생성 은 Y.
      line[0] = row.orderDate;
      line[2] = row.custCd;
      line[7] = "100";
      line[15] = row.prodCd;
      line[17] = row.qty;
      line[18] = row.snapshotUnitPrice;
      line[20] = supplyAmt;
      line[21] = vatAmt;
      line[22] = totalAmt;
      line[24] = row.recipientName || "";
      
      var ph = String(row.recipientPhone || "").trim();
      // getValues() 시 숫자형으로 인식되어 앞의 0이 날아간 경우 복원 (010 -> 10, 길이 8~10)
      if (ph.length >= 8 && ph.length <= 10 && !/^0/.test(ph)) {
        ph = "0" + ph;
      }
      line[25] = ph;

      line[26] = addrNetMsg;
      line[27] = "Y";
      out.push(line);
    }

    if (out.length > 0) {
      sh.getRange(2, 1, out.length, colCount).setValues(out);
      
      // 수량(18), 단가(19) 숫자 서식
      sh.getRange(2, 18, out.length, 1).setNumberFormat("#,##0");
      sh.getRange(2, 19, out.length, 1).setNumberFormat("#,##0");
      // 공급가액(21), 부가세(22), 금액1(23) 숫자 서식 (총 3개 열)
      sh.getRange(2, 21, out.length, 3).setNumberFormat("#,##0");

      // ★ Z열(26번째=전화번호) 선행 0 보존: 텍스트 서식 지정 후 값 재기입
      var phoneRange = sh.getRange(2, 26, out.length, 1);
      phoneRange.setNumberFormat("@");
      var phoneVals = [];
      for (var pi = 0; pi < out.length; pi++) {
        phoneVals.push([String(out[pi][25] || "")]);
      }
      phoneRange.setValues(phoneVals);
    }
    sh.autoResizeColumns(1, colCount);

    if (!silent) {
      var reasonSummary = summarizeSkipReasons_(validationErrors);
      var top = [];
      for (var k = 0; k < Math.min(reasonSummary.length, 5); k++) {
        top.push("- " + reasonSummary[k].reason + ": " + reasonSummary[k].count + "건");
      }
      SpreadsheetApp.getUi().alert(
        "판매현황 업로드용 시트 갱신\n" +
          "- 시트: " +
          SALES_STATUS_PASTE_SHEET +
          "\n- 반영 건수: " +
          prepared.length +
          "\n- 검증 제외: " +
          validationErrors.length +
          (top.length ? "\n\n제외 사유(상위):\n" + top.join("\n") : ""),
      );
    }
  } finally {
    lock.releaseLock();
  }
}

function onEditMaybeRebuildSalesStatusPaste_(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (!sh || sh.getName() !== SALES_STATUS_PASTE_SOURCE_SHEET) return;
  var ss = sh.getParent();
  if (!ss) return;
  var cache = CacheService.getDocumentCache();
  var key = "sales_paste_rebuild_ts";
  var now = Date.now();
  var prev = parseInt(cache.get(key) || "0", 10);
  if (now - prev < SALES_STATUS_PASTE_ONEDIT_THROTTLE_SEC * 1000) return;
  cache.put(key, String(now), 120);
  rebuildSalesStatusPasteSheet_(ss, { silent: true });
}

/** 시간 트리거(기본 5분): 스크립트 수집·외부 반영 등 onEdit이 없는 갱신을 흡수 */
function runSalesStatusPasteRebuildScheduled_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty("MAIN_SS_ID");
    if (id) ss = SpreadsheetApp.openById(id);
  }
  if (!ss) return;
  rebuildSalesStatusPasteSheet_(ss, { silent: true });
}

/** 중복 install 방지. 자동연동/판매업로드 예약 설치 시 함께 등록 */
function ensureSalesStatusPasteRebuildTimeTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SALES_STATUS_PASTE_TRIGGER_HANDLER) return;
  }
  ScriptApp.newTrigger(SALES_STATUS_PASTE_TRIGGER_HANDLER)
    .timeBased()
    .everyMinutes(5)
    .create();
}

function setupIntegratedSalesUploadTriggers() {
  try {
    ensureSalesStatusPasteRebuildTimeTrigger_();
  } catch (eStatusT) {}
  try {
    removeIntegratedSalesUploadTriggers(true);
  } catch (eRm) {}
  SpreadsheetApp.getUi().alert(
    "이카운트 API 자동 판매 업로드는 사용하지 않습니다.\n\n" +
      "※ 『" +
      SALES_STATUS_PASTE_SHEET +
      "』탭 자동 갱신(5분) 트리거를 켰습니다.\n" +
      "※ 예전 10시/14시 판매 API 예약은 삭제했습니다. 남은 항목이 있으면 메뉴 『레거시 판매 API 시간예약만 삭제』를 실행하세요.",
  );
}

function removeIntegratedSalesUploadTriggersForMenu_() {
  removeIntegratedSalesUploadTriggers(false);
}

function removeIntegratedSalesUploadTriggers(isSilent) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SALES_UPLOAD_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  if (!isSilent) {
    try {
      SpreadsheetApp.getUi().alert(
        "레거시 판매 API 시간 예약을 삭제했습니다.\n(이카운트 API 판매 업로드용 트리거)",
      );
    } catch (e) {}
  }
}

function collectSalesSourceRows_(ss, opts) {
  opts = opts || {};
  // 운영 원칙: 판매업로드 원천은 통합 발주 DB만 사용.
  return readIntegratedOrderRows_(ss, opts);
}

function readIntegratedOrderRows_(ss, opts) {
  var sheet = ss.getSheetByName("통합 발주 DB");
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idx = mapIndexes_(headers, {
    uniqueId: ["발주고유ID", "고유ID"],
    // 거래처명(D열) = 설정!B5(SSOT). 발주업체(B열)는 파일명 기반 식별자로 매핑 불일치 원인.
    // 거래처명 우선 → 발주업체 fallback 순서로 읽어 매핑 실패를 방지.
    vendor: ["거래처명", "발주업체"],
    orderDate: ["주문일자(YYYYMMDD)", "주문일자", "주문일"],
    prodCd: ["품목코드", "이카운트코드"],
    prodNm: ["품목명", "상품명"],
    qty: ["수량"],
    unitPrice: ["확정단가", "정산단가", "정산금액"],
    recipient: ["수취인", "주문자명", "받는분", "수령인"],
    phone: ["수취인전화번호", "전화번호", "연락처", "휴대폰", "핸드폰"],
    addr: ["수취인주소", "주소", "배송지"],
    msg: ["배송메시지", "배송요청사항", "요청사항"],
    remark: ["적요", "메모", "비고", "참고사항"],
  });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rawDate = idx.orderDate > -1 ? row[idx.orderDate] : "";
    var ymd = _formatDate(rawDate);
    if (!isWithinRange_(ymd, opts)) continue;
    var uniqueId = idx.uniqueId > -1 ? String(row[idx.uniqueId] || "").trim() : "";
    var vendor = idx.vendor > -1 ? String(row[idx.vendor] || "").trim() : "";
    var prodCd = idx.prodCd > -1 ? String(row[idx.prodCd] || "").trim() : "";
    var qty = parseFloat(idx.qty > -1 ? row[idx.qty] : 0) || 0;
    var rawHeaderPrice = idx.unitPrice > -1 ? row[idx.unitPrice] : "";
    var rawPPrice =
      row.length > HUB_ORDER_DB_COL_INDEX_UNIT_PRICE_P
        ? row[HUB_ORDER_DB_COL_INDEX_UNIT_PRICE_P]
        : "";
    var priceFromP = parseHubNumericPrice_(rawPPrice);
    var priceFromHeader = parseHubNumericPrice_(rawHeaderPrice);
    // 정산금액(합계=단가×수량) 헤더인 경우 수량으로 나눠 1개 단가 복원
    var headerLabel = idx.unitPrice > -1 ? String(headers[idx.unitPrice] || "").replace(/\s/g, "") : "";
    if (headerLabel.indexOf("정산금액") !== -1 && priceFromHeader > 0 && qty > 0) {
      priceFromHeader = Math.round(priceFromHeader / qty);
    }
    // P열 확정단가(자동 단가)를 헤더 매핑보다 우선 — 열 삽입 등으로 헤더 위치가 어긋나도 표준 P를 사용
    var unitPrice = NaN;
    if (priceFromP > 0) unitPrice = priceFromP;
    else if (priceFromHeader > 0) unitPrice = priceFromHeader;
    if (!ymd && !uniqueId && !vendor && !prodCd && qty === 0) continue;

    var lineNo = prodCd || String(r + 1);
    out.push({
      sourceType: "통합 발주 DB",
      orderNo: uniqueId || vendor + "-" + ymd,
      lineNo: lineNo,
      vendorCode: vendor,
      vendorName: vendor,
      orderDate: ymd,
      prodCd: prodCd,
      prodNm: idx.prodNm > -1 ? String(row[idx.prodNm] || "").trim() : "",
      qty: qty,
      unitPrice: isNaN(unitPrice) ? "" : unitPrice,
      orderLineKey: buildOrderLineKey_(uniqueId || vendor + "-" + ymd, lineNo, vendor),
      sourceRowIndex: r + 1,
      recipientName: idx.recipient > -1 ? String(row[idx.recipient] || "").trim() : "",
      recipientPhone: idx.phone > -1 ? String(row[idx.phone] || "").trim() : "",
      recipientAddr: idx.addr > -1 ? String(row[idx.addr] || "").trim() : "",
      deliveryMessage: idx.msg > -1 ? String(row[idx.msg] || "").trim() : "",
      remark: idx.remark > -1 ? String(row[idx.remark] || "").trim() : "",
    });
  }
  return out;
}

function dedupeBySourcePriority_(rows) {
  var map = {};
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = row.orderLineKey;
    if (!key) continue;
    if (!map[key]) {
      map[key] = row;
      out.push(row);
      continue;
    }
    if (map[key].sourceType !== "통합 발주 DB" && row.sourceType === "통합 발주 DB") {
      map[key] = row;
      for (var j = 0; j < out.length; j++) {
        if (out[j].orderLineKey === key) {
          out[j] = row;
          break;
        }
      }
    }
  }
  return out;
}

function validateVendorCustMappingForRows_(ss, rows) {
  rows = rows || [];
  var vendorNeedMap = {};
  for (var i = 0; i < rows.length; i++) {
    var vendor = String(rows[i].vendorCode || rows[i].vendorName || "").trim();
    if (vendor) vendorNeedMap[vendor] = true;
  }
  var targetVendors = Object.keys(vendorNeedMap);
  if (targetVendors.length === 0) {
    return { ok: true, missingCount: 0, missingVendors: [], message: "" };
  }

  var vendorMap = buildVendorPriceMap_(ss);
  var missing = [];
  for (var j = 0; j < targetVendors.length; j++) {
    var v = targetVendors[j];
    var matched = resolveVendorMapEntry_(v, vendorMap);
    if (!matched || !String(matched.custCd || "").trim()) {
      missing.push(v);
    }
  }

  return {
    ok: missing.length === 0,
    missingCount: missing.length,
    missingVendors: missing,
    message:
      missing.length === 0
        ? ""
        : "판매현황 복붙 대상 미매핑 업체 " +
          missing.length +
          "건: " +
          missing.slice(0, 10).join(", "),
  };
}

function normalizeAndValidateRow_(row, vendorMap, bundle, uploadedMap, normOpts) {
  normOpts = normOpts || {};
  var copy = JSON.parse(JSON.stringify(row));
  copy.skipReason = "";
  copy.custCd = resolveCustCode_(copy.vendorCode, vendorMap);
  copy.snapshotUnitPrice = resolveSnapshotUnitPrice_(copy, vendorMap, bundle);
  copy.snapshotAmount = Math.round((parseFloat(copy.qty) || 0) * (parseFloat(copy.snapshotUnitPrice) || 0));
  copy.orderDate = _formatDate(copy.orderDate);

  if (!normOpts.ignoreUploadLog && uploadedMap[copy.orderLineKey]) copy.skipReason = "이미 업로드 완료";
  else if (!copy.orderDate) copy.skipReason = "주문일자 누락";
  else if (!/^\d{8}$/.test(String(copy.orderDate || ""))) copy.skipReason = "주문일자 형식오류";
  else if (!copy.prodCd) copy.skipReason = "품목코드 누락";
  else if (!copy.vendorCode) copy.skipReason = "업체명 누락";
  else if (!copy.custCd) copy.skipReason = "거래처코드 미매핑";
  else if (!(parseFloat(copy.qty) > 0)) copy.skipReason = "수량 오류";
  else if (!(parseFloat(copy.snapshotUnitPrice) > 0)) copy.skipReason = "단가 미확정";
  return copy;
}

function summarizeSkipReasons_(rows) {
  var map = {};
  for (var i = 0; i < (rows || []).length; i++) {
    var reason = String(rows[i].skipReason || "기타").trim() || "기타";
    map[reason] = (map[reason] || 0) + 1;
  }
  var out = [];
  for (var k in map) {
    out.push({ reason: k, count: map[k] });
  }
  out.sort(function(a, b) { return b.count - a.count; });
  return out;
}

function buildVendorPriceMap_(ss) {
  var map = {};
  // 운영 원칙: 거래처명/거래처코드는 "배포시트 설정탭(B5/B6)"이 최우선 기준.
  // 매핑 시트는 설정 누락 시 보조용으로만 사용한다.
  mergeVendorMapFromDeploySettings_(map);

  var mapInfo = null;
  if (typeof resolveVendorMapSheetForRead_ === "function") {
    try {
      mapInfo = resolveVendorMapSheetForRead_(ss);
    } catch (eMap) {}
  }
  var sheet = mapInfo && mapInfo.sheet ? mapInfo.sheet : ss.getSheetByName(SALES_PRICE_MAP_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idx = mapIndexes_(headers, {
    vendor: ["거래처명", "발주업체", "업체", "업체명"],
    group: ["단가그룹", "등급", "그룹명"],
    custCd: ["거래처코드(CUST_CD)", "거래처코드", "CUST_CD"],
  });
  // 헤더 문구가 조금만 달라도(예: 거래처명(필수), CUST_CD(필수)) 잡히도록 보강 탐지
  if (idx.vendor === -1 || idx.custCd === -1) {
    for (var h = 0; h < headers.length; h++) {
      var name = String(headers[h] || "").replace(/\s/g, "");
      if (idx.vendor === -1) {
        if (
          name.indexOf("거래처명") !== -1 ||
          name.indexOf("발주업체") !== -1 ||
          name.indexOf("업체명") !== -1 ||
          name.indexOf("업체") !== -1
        ) {
          idx.vendor = h;
        }
      }
      if (idx.custCd === -1) {
        if (
          name.indexOf("CUST_CD") !== -1 ||
          name.toLowerCase().indexOf("custcd") !== -1 ||
          name.indexOf("거래처코드") !== -1
        ) {
          idx.custCd = h;
        }
      }
      if (idx.group === -1) {
        if (name.indexOf("단가그룹") !== -1 || name.indexOf("그룹명") !== -1 || name.indexOf("등급") !== -1) {
          idx.group = h;
        }
      }
    }
  }
  for (var i = 1; i < values.length; i++) {
    var vendor = idx.vendor > -1 ? sanitizeVendorText_(values[i][idx.vendor]) : "";
    if (!vendor) continue;
    var rowObj = {
      groupName: idx.group > -1 ? sanitizeVendorText_(values[i][idx.group]) : "",
      custCd: idx.custCd > -1 ? sanitizeCustCode_(values[i][idx.custCd]) : "",
    };
    if (!rowObj.custCd) continue;
    // 이미 설정탭 기준으로 잡힌 업체는 덮어쓰지 않는다.
    var existing = resolveVendorMapEntry_(vendor, map);
    if (!existing || !String(existing.custCd || "").trim()) {
      addVendorMapKey_(map, vendor, rowObj);
    }
  }
  return map;
}

function resolveCustCode_(vendorCode, vendorMap) {
  var matched = resolveVendorMapEntry_(vendorCode, vendorMap);
  if (matched && matched.custCd) return matched.custCd;
  return "";
}

function normalizeVendorMapKey_(name) {
  return sanitizeVendorText_(name)
    .replace(/주식회사|유한회사|농업회사법인|영농조합법인/gi, "")
    .replace(/\(주\)|㈜|주\./gi, "")
    .toLowerCase()
    .replace(/\[독립\s*배포\]/gi, "")
    .replace(/독립\s*배포/gi, "")
    .replace(/사방넷|온라인|공식|스토어|본사/gi, "")
    .replace(/뷰어|단가조회/gi, "")
    .replace(/[\s\[\]\(\)\-_/.,:]/g, "")
    .replace(/[^0-9a-z가-힣]/g, "")
    .trim();
}

function addVendorMapKey_(map, vendorName, rowObj) {
  if (!map || !rowObj) return;
  var candidates = buildVendorCandidateKeys_(vendorName);
  for (var i = 0; i < candidates.length; i++) {
    var raw = candidates[i];
    if (!raw) continue;
    map[raw] = rowObj;
    var norm = normalizeVendorMapKey_(raw);
    if (norm) map[norm] = rowObj;
  }
}

function resolveVendorMapEntry_(vendorCode, vendorMap) {
  if (!vendorMap) return null;
  var candidates = buildVendorCandidateKeys_(vendorCode);
  if (candidates.length === 0) return null;

  for (var i = 0; i < candidates.length; i++) {
    var key = candidates[i];
    if (vendorMap[key]) return vendorMap[key];
    var norm = normalizeVendorMapKey_(key);
    if (norm && vendorMap[norm]) return vendorMap[norm];
  }

  // 마지막 fallback: 유사 키(포함관계) 탐지
  for (var c = 0; c < candidates.length; c++) {
    var baseNorm = normalizeVendorMapKey_(candidates[c]);
    if (!baseNorm || baseNorm.length < 2) continue;
    for (var k in vendorMap) {
      if (!vendorMap.hasOwnProperty(k)) continue;
      var kn = normalizeVendorMapKey_(k);
      if (!kn || kn.length < 2) continue;
      if (baseNorm === kn || baseNorm.indexOf(kn) !== -1 || kn.indexOf(baseNorm) !== -1) {
        return vendorMap[k];
      }
    }
  }
  return null;
}

function mergeVendorMapFromDeploySettings_(map) {
  if (!map) return;
  var seenFile = {};
  if (typeof forEachVendorDeployFile_ !== "function") return;

  forEachVendorDeployFile_(function(file) {
    var fid = String(file && file.getId ? file.getId() : "");
    if (!fid || seenFile[fid]) return;
    seenFile[fid] = true;

    var dss;
    try {
      dss = SpreadsheetApp.openById(fid);
    } catch (eOpen) {
      return;
    }

    var settingsName =
      typeof DEPLOY_LOCAL_SETTINGS_TAB_NAME !== "undefined"
        ? DEPLOY_LOCAL_SETTINGS_TAB_NAME
        : "설정";
    var vendorCell =
      typeof DEPLOY_LOCAL_VENDOR_NAME_CELL !== "undefined"
        ? DEPLOY_LOCAL_VENDOR_NAME_CELL
        : "B5";
    var custCell =
      typeof DEPLOY_LOCAL_CUST_CODE_CELL !== "undefined"
        ? DEPLOY_LOCAL_CUST_CODE_CELL
        : "B6";

    var st = dss.getSheetByName(settingsName);
    if (!st) return;
    var vendor = sanitizeVendorText_(st.getRange(vendorCell).getValue());
    var custCd = sanitizeCustCode_(st.getRange(custCell).getDisplayValue());
    if (!vendor || !custCd) return;

    var rowObj = {
      groupName: "",
      custCd: custCd,
    };
    addVendorMapKey_(map, vendor, rowObj);

    // 주의: 파일명(시트명) 기반 매핑은 오매칭 원인이 되어 사용하지 않는다.
  });
}

function sanitizeVendorText_(value) {
  var s = String(value == null ? "" : value);
  if (!s) return "";
  s = s.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ");
  if (s.normalize) s = s.normalize("NFKC");
  return s.replace(/\s+/g, " ").trim();
}

function sanitizeCustCode_(value) {
  var s = String(value == null ? "" : value).replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "").trim();
  if (!s) return "";
  // 엑셀에서 숫자 코드가 "12345.0" 형태로 들어온 경우를 보정
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s;
}

function buildVendorCandidateKeys_(vendorName) {
  var base = sanitizeVendorText_(vendorName);
  if (!base) return [];
  var out = {};
  function push_(v) {
    var t = sanitizeVendorText_(v);
    if (t) out[t] = true;
  }
  push_(base);
  push_(base.replace(/\[[^\]]*\]/g, " "));
  push_(base.replace(/\([^)]*\)/g, " "));
  push_(base.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " "));
  var parts = base.split(/[\/|,]/);
  for (var i = 0; i < parts.length; i++) push_(parts[i]);
  return Object.keys(out);
}

function buildHubPriceBundle_() {
  var props = PropertiesService.getScriptProperties();
  var hubId = props.getProperty("DB_HUB_ID");
  if (!hubId) return { groupColMap: {}, itemPriceMap: {} };
  var hubSS = getHubSS(hubId);
  var hubTab = hubSS.getSheetByName("전체 그룹 단가표");
  if (!hubTab || hubTab.getLastRow() < 3) return { groupColMap: {}, itemPriceMap: {} };

  var values = hubTab.getDataRange().getValues();
  var row1 = values[0] || [];
  var groupColMap = {};
  for (var c = 6; c < row1.length; c += 5) {
    var name = String(row1[c] || "").trim();
    if (name) groupColMap[name] = c;
  }

  var itemPriceMap = {};
  for (var r = 2; r < values.length; r++) {
    var prodCd = String(values[r][2] || "").trim();
    if (!prodCd) continue;
    itemPriceMap[prodCd] = values[r];
  }
  return { groupColMap: groupColMap, itemPriceMap: itemPriceMap };
}

function resolveSnapshotUnitPrice_(row, vendorMap, bundle) {
  var direct = parseHubNumericPrice_(row.unitPrice);
  if (!isNaN(direct) && direct > 0) return direct;

  var vendorInfo = resolveVendorMapEntry_(row.vendorCode, vendorMap);
  if (!vendorInfo || !vendorInfo.groupName) return "";

  var groupCol = bundle.groupColMap[vendorInfo.groupName];
  if (groupCol === undefined) return "";
  var itemRow = bundle.itemPriceMap[String(row.prodCd || "").trim()];
  if (!itemRow) return "";
  var price = parseHubNumericPrice_(itemRow[groupCol]);
  if (isNaN(price) || price <= 0) return "";
  return price;
}

function archiveMonthlySettlementSnapshot() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeActiveSS();
  var nowYm = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMM");
  var sourceName = SALES_SETTLEMENT_PREFIX + nowYm;
  var source = ss.getSheetByName(sourceName);
  if (!source) {
    SpreadsheetApp.getUi().alert(sourceName + " 시트가 없습니다.");
    return;
  }
  var archiveName = sourceName + "_저장_" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmm");
  var copy = source.copyTo(ss).setName(archiveName);
  try {
    var p = copy.protect().setDescription("월정산 보관본");
    p.removeEditors(p.getEditors());
  } catch (e) {}
  SpreadsheetApp.getUi().alert("정산 보관본 생성: " + archiveName);
}

function mapIndexes_(headers, fields) {
  var out = {};
  for (var key in fields) out[key] = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || "").replace(/\s/g, "");
    for (var field in fields) {
      if (out[field] !== -1) continue;
      var names = fields[field];
      for (var i = 0; i < names.length; i++) {
        if (h === String(names[i]).replace(/\s/g, "")) {
          out[field] = c;
          break;
        }
      }
    }
  }
  return out;
}

function buildOrderLineKey_(orderNo, lineNo, vendorCode) {
  return String(orderNo || "").trim() + "|" + String(lineNo || "").trim() + "|" + String(vendorCode || "").trim();
}

function isWithinRange_(ymd, opts) {
  if (!ymd) return true;
  if (opts.fromDate && ymd < opts.fromDate) return false;
  if (opts.toDate && ymd > opts.toDate) return false;
  return true;
}
