/**
 * [협력업체] 도서산간 추가배송비 시스템  v2.2
 * 파일: _partnerIslandShipping.gs
 *
 * ★ v2.2 (2026-07-16):
 *   - 허브/업체 열을 헤더명「도서산간배송비」로 동적 탐지 (Q=17 고정 버그 수정)
 *   - 발주탭 ARRAYFORMULA 스필로 getLastRow() 부풀림 → C열 기준 실데이터 행만 처리
 *   - UID 정규화 + 소스 P열 외 인접열 폴백
 *   - 매칭 0건 시 진단 메시지 강화
 */

// ═══════════════════════════════════════════
//  상수
// ═══════════════════════════════════════════
var _ISLAND_FEE_PER_QTY   = 5000;
var _ISLAND_BG_COLOR      = "#e8d5f5";
var _ISLAND_FONT_COLOR    = "#4a148c";
var _ISLAND_HEADER_BG     = "#7b1fa2";

var _ISLAND_SOURCE_SHEET_ID = "1vWdJgmbW_Gwm_2b1pP8mVBxpfYBbUiAduSwkStXxs0Y";
var _ISLAND_SOURCE_TAB_GID  = 1971071523;

/** 허브: 상태(O=15) 다음 열(P=16) 기본 — 예전 Q=17 고정을 폐기 */
var _ISLAND_HUB_COL_FALLBACK     = 16;
/** 업체 발주탭: O=15 도서산간배송비 */
var _ISLAND_PARTNER_COL_FALLBACK = 15;

// ═══════════════════════════════════════════
//  메뉴 진입점
// ═══════════════════════════════════════════

function partnerCheckIslandShipping() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    ui.alert("⚠ 다른 작업 진행 중. 잠시 후 다시 시도해주세요.");
    return;
  }
  try {
    _island_core_(ui);
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════
//  핵심 로직
// ═══════════════════════════════════════════

function _island_core_(ui) {
  var t0 = Date.now();

  var uidBoxMap = _island_loadIslandUidBoxMap_();
  if (!uidBoxMap || Object.keys(uidBoxMap).length === 0) {
    ui.alert(
      "ℹ️ 세트분리(뉴) 주문라인원장에서 도서산간 주문을 찾지 못했습니다.\n\n" +
      "확인:\n" +
      "1) 세트분리(뉴)를 돌렸는지 (원장에 로젠택배-도서산간 경로가 있어야 합니다)\n" +
      "2) 세트분리(뉴) 시트 접근 권한"
    );
    return;
  }

  var totalIslandUids = Object.keys(uidBoxMap).length;

  var hubResult = _island_applyToHub_(uidBoxMap, { reconcile: true });

  var partnerResult = { applied: 0, skipped: 0, files: 0, errors: [], unmatchedHint: "" };
  if (hubResult.vendorNames && hubResult.vendorNames.length > 0) {
    partnerResult = _island_applyToPartnerSheets_(uidBoxMap, hubResult.vendorNames, hubResult.feeByUid);
  }

  var elapsed = Math.round((Date.now() - t0) / 1000);
  var feeColLabel = hubResult.feeCol || _ISLAND_HUB_COL_FALLBACK;

  var msg = "🏝️ 도서산간 추가배송비 적용 완료 (" + elapsed + "초)\n" +
    "═══════════════════════════════\n" +
    "세트분리(뉴) 도서산간 고유ID: " + totalIslandUids + "건 (줄마다 5,000 · 세트 10,000)\n" +
    "허브 매칭: " + hubResult.matched + "건 (열=" + feeColLabel + ")\n\n" +
    "── 허브 도서산간배송비 ──\n" +
    "  적용: " + hubResult.applied + "건 / 이미있음: " + hubResult.skipped + "건\n\n" +
    "── 업체 발주탭 (" + (hubResult.vendorNames ? hubResult.vendorNames.length : 0) + "개 업체) ──\n" +
    "  적용: " + partnerResult.applied + "건 / 이미있음: " + partnerResult.skipped + "건";

  if (hubResult.matched === 0) {
    msg += "\n\n⚠ 허브에서 UID 매칭 0건입니다.\n" +
      "도서산간 탭 UID ↔ 허브 C열(고유ID) 형식이 같은지 확인하세요.\n" +
      "샘플 UID: " + Object.keys(uidBoxMap).slice(0, 3).join(", ");
  }

  if (hubResult.errors.length > 0 || partnerResult.errors.length > 0) {
    msg += "\n\n⚠ 오류:\n" + hubResult.errors.concat(partnerResult.errors).slice(0, 8).join("\n");
  }

  ui.alert("도서산간 추가배송비", msg.substring(0, 4500), ui.ButtonSet.OK);
}

// ═══════════════════════════════════════════
//  도서산간 탭 로드
// ═══════════════════════════════════════════

function _island_normUid_(raw) {
  return String(raw || "")
    .replace(/\u00a0/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s/g, "")
    .trim();
}

/**
 * ══════════════════════════════════════════════════════════════
 *  ★ v3 (2026-10-05) 세트분리(뉴) 로젠 도서산간과 연동 ★
 *
 *  > "발주 수집때 제주도서산간을 인식해서 건당..5000원.. 세트상품일경우 10000원"
 *  > "세트분리(뉴)에 로젠택배 도서산간이 연동되있어 이부분과 연동시켜줘"
 *
 *  ① 누가 도서산간인가 — 세트분리(뉴) 「주문라인원장」이 정한다.
 *     세트분리는 도선료표·우편번호·확정 지역명으로 섬을 가려 「로젠택배-도서산간」
 *     (대리발송이면 「…(위탁배송)」)으로 보낸다. 산간은 배가 아니라서 일반 로젠으로
 *     가지만 추가운임은 붙는다(도서권역=산간) — 그것도 센다.
 *     사람이 도서산간 탭 조치에 「발송」을 적어 일반으로 뺀 건은 경로가 로젠택배로
 *     바뀌어 원장에 다시 적힌다 → 같은 고유ID 의 «마지막» 기록을 따른다.
 *     예전 원천(옛 세트분리 「도서산간」 탭)은 더 안 읽는다.
 *  ② 얼마인가 — 주문 줄마다 5,000원. 품목명에 한글 「세트」가 있으면 10,000원
 *     (몸통·뚜껑이 따로 나간다). 영문 SET 은 한 박스라 5,000원.
 *     수량·박스 수와 상관없다. 예전 「박스×수량×5,000」은 버렸다.
 *     이미 금액이 들어 있는 줄은 그대로 둔다(예전 규칙으로 들어간 것 포함).
 * ══════════════════════════════════════════════════════════════
 */
var _ISLAND_SS_ID_          = "1JuwZjorbBG7tOa92xfAy07eUV-r2j2P8bpbYrgCDAwo";   // 세트분리(뉴)
var _ISLAND_LEDGER_TAB_     = "주문라인원장";
var _ISLAND_LEDGER_TAIL_    = 40000;   // 원장 끝에서 이만큼만 본다 (석 달 남짓)
var _ISLAND_FEE_LINE_       = 5000;
var _ISLAND_FEE_SET_        = 10000;

/** 순수 — 원장(받침)이 이 허브 줄에 «새로» 금액을 붙여도 되나: 판매현황 전(P 빈칸) · 주소 판정 전 */
function _island_ledgerMayCharge_(hubRow, judgeCol0) {
  if (String(hubRow[15] || "").trim()) return false;
  if (judgeCol0 >= 0 && String(hubRow[judgeCol0] || "").trim()) return false;
  return true;
}

/** 주문 줄 하나의 도서산간비 — 한글 「세트」면 10,000, 아니면 5,000 */
/**
 * 세트 상품인가 — 도서산간비가 갈리는 «한 곳»의 판정.  (2026-10-06)
 *
 * ★ 한글 「세트」만이다 ★ 영문 「SET」은 한 박스로 나가는 완제품이라 한 줄
 *   값(5,000)이고, 한글 「세트」는 몸통+뚜껑처럼 여러 박스가 따로 나가
 *   택배비가 두 번 든다(10,000).
 *   > "한글 세트만 적용 영문 set는 한박스로 나가는것들이야"
 *
 * ★ 왜 함수로 떼어 두나 ★
 *   금액(5,000/10,000)과 이카운트 품목코드(OUT00001/OUT000011)가 «같은
 *   판정»으로 갈려야 한다. 두 곳에 각각 적으면 한쪽만 고쳐져 금액은
 *   10,000인데 코드는 OUT00001 로 올라가는 날이 온다 — 그건 조용하다.
 */
function _island_isSetItem_(itemName) {
  return String(itemName == null ? "" : itemName).indexOf("세트") !== -1;
}

function _island_lineFee_(itemName) {
  return _island_isSetItem_(itemName) ? _ISLAND_FEE_SET_ : _ISLAND_FEE_LINE_;
}

/**
 * 고유ID 열쇠 — 「수취인/0901-ds-4581」·「d0930000044_S2」·「…#2」·「…|코드」를 같은 번호로.
 * (CS _cs_orderUid_ · 허브 _pep_uidFromOrdererCell_ 와 같은 규칙)
 */
function _island_uidKey_(raw) {
  var s = _island_normUid_(raw);
  var cut = Math.max(s.lastIndexOf("/"), s.lastIndexOf("／"));
  if (cut >= 0) s = s.slice(cut + 1);
  s = s.replace(/#\d+$/, "");
  var bar = s.indexOf("|");
  if (bar >= 0) s = s.slice(0, bar);
  return s.replace(/_S\d+$/i, "");
}

/**
 * 순수 — 원장 머리글·줄들에서 «지금» 도서산간인 고유ID 를 고른다. 시험이 직접 부른다.
 * @return {Object} { 고유ID: { 권역, 경로 } }
 */
function _island_pickFromLedger_(header, rows) {
  function col(name) {
    for (var i = 0; i < header.length; i++) if (String(header[i]).replace(/\s/g, "") === name) return i;
    return -1;
  }
  var cUid = col("고유ID"), cRoute = col("경로"), cZone = col("도서권역");
  if (cUid < 0 || cRoute < 0) return {};
  var last = {};
  for (var r = 0; r < rows.length; r++) {
    var uid = _island_uidKey_(rows[r][cUid]);
    if (!uid) continue;
    var route = String(rows[r][cRoute] || "").trim();
    var zone = cZone >= 0 ? String(rows[r][cZone] || "").trim() : "";
    var 섬 = route.indexOf("도서산간") !== -1 || zone === "산간";
    last[uid] = 섬 ? { 권역: zone || "도서", 경로: route } : null;   //  나중 기록이 이긴다
  }
  var out = {};
  for (var k in last) if (last[k]) out[k] = last[k];
  return out;
}

/** 세트분리(뉴) 주문라인원장 → { 고유ID: {권역, 경로} } */
function _island_loadIslandUidBoxMap_() {
  try {
    var ss = SpreadsheetApp.openById(_ISLAND_SS_ID_);
    var tab = ss.getSheetByName(_ISLAND_LEDGER_TAB_);
    if (!tab) { Logger.log("[도서산간] 세트분리(뉴)에 " + _ISLAND_LEDGER_TAB_ + " 탭 없음"); return null; }
    var lr = tab.getLastRow(), lc = tab.getLastColumn();
    if (lr < 2) return null;
    var header = tab.getRange(1, 1, 1, lc).getValues()[0];
    var 시작 = Math.max(2, lr - _ISLAND_LEDGER_TAIL_ + 1);
    //  필요한 세 칸만 읽는다 (원장은 50칸이 넘는다)
    var 이름들 = ["고유ID", "경로", "도서권역"], 칸들 = [];
    for (var n = 0; n < 이름들.length; n++) {
      var at = -1;
      for (var h = 0; h < header.length; h++) if (String(header[h]).replace(/\s/g, "") === 이름들[n]) { at = h; break; }
      칸들.push(at);
    }
    if (칸들[0] < 0 || 칸들[1] < 0) { Logger.log("[도서산간] 원장 머리글에 고유ID·경로가 없음"); return null; }
    var 세로 = 칸들.map(function (c) {
      return c < 0 ? null : tab.getRange(시작, c + 1, lr - 시작 + 1, 1).getValues();
    });
    var rows = [];
    for (var i = 0; i < lr - 시작 + 1; i++) {
      rows.push([세로[0][i][0], 세로[1][i][0], 세로[2] ? 세로[2][i][0] : ""]);
    }
    var map = _island_pickFromLedger_(이름들, rows);
    Logger.log("[도서산간] 세트분리(뉴) 원장 " + rows.length + "줄 → 도서산간 고유ID " + Object.keys(map).length + "건");
    return Object.keys(map).length ? map : null;
  } catch (e) {
    Logger.log("[도서산간] 세트분리(뉴) 원장 읽기 실패: " + e.message);
    return null;
  }
}

/** (옛) 옛 세트분리 「도서산간」 탭 — 더 안 쓴다. 되돌릴 때를 위해 남긴다 */
function _island_loadOldIslandTab_() {
  try {
    var ss = SpreadsheetApp.openById(_ISLAND_SOURCE_SHEET_ID);
    var tab = _pt_getSheetByGid(ss, _ISLAND_SOURCE_TAB_GID);
    if (!tab) {
      Logger.log("[도서산간] GID 탭 없음: " + _ISLAND_SOURCE_TAB_GID);
      return null;
    }
    var lr = tab.getLastRow();
    var lc = tab.getLastColumn();
    if (lr < 2) return null;

    // P열(16) 우선, 비면 O~R(15~18)에서 UID 형태 열 탐색
    var tryCols = [16, 15, 17, 18, 14];
    var map = {};
    var usedCol = 0;

    for (var ti = 0; ti < tryCols.length; ti++) {
      var col = tryCols[ti];
      if (lc < col) continue;
      var numRows = lr - 1;
      if (numRows < 1) continue;
      var data = tab.getRange(2, col, numRows, 1).getDisplayValues();
      var tmp = {};
      var hits = 0;
      for (var i = 0; i < data.length; i++) {
        var uid = _island_normUid_(data[i][0]);
        if (!uid) continue;
        // UID 형태: 숫자/하이픈 조합 (너무 짧은 한글 헤더 제외)
        if (uid.length < 4) continue;
        if (/^[가-힣]+$/.test(uid)) continue;
        tmp[uid] = (tmp[uid] || 0) + 1;
        hits++;
      }
      if (hits > 0) {
        map = tmp;
        usedCol = col;
        break;
      }
    }

    Logger.log("[도서산간] 소스 열=" + usedCol + ", UID=" + Object.keys(map).length + "건");
    return Object.keys(map).length ? map : null;
  } catch (e) {
    Logger.log("[도서산간] 소스 로드 실패: " + e.message);
    return null;
  }
}

// ═══════════════════════════════════════════
//  열 탐지 유틸
// ═══════════════════════════════════════════

/** 헤더 행에서 「도서산간」포함 열 찾기 (1-based). 없으면 0 */
function _island_findFeeCol1_(headers) {
  if (!headers || !headers.length) return 0;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "");
    //  표지 열(도서산간 판매갱신)·판정 열(도서산간판정)은 금액 열이 아니다
    if (h.indexOf("도서산간") !== -1 && h.indexOf("판매갱신") === -1 && h.indexOf("판정") === -1) return i + 1;
  }
  return 0;
}

function _island_findStatusCol0_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h === "상태" || h === "상태(자동)" || h.indexOf("status") !== -1) return i;
  }
  return -1;
}

function _island_findUidCol0_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h.indexOf("고유id") !== -1 || h.indexOf("uniqueid") !== -1 || h === "uid") return i;
  }
  // 폴백: 업체 발주탭 M열(12), 허브 C열(2)
  return -1;
}

function _island_findQtyCol0_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "").toLowerCase();
    if (h === "수량" || h.indexOf("박스수량") !== -1 || h.indexOf("판매수량") !== -1 ||
        h.indexOf("택배수량") !== -1 || h.indexOf("택배박스수량") !== -1) return i;
  }
  return -1;
}

/** 품목명 열 (0-based) — 「품목명」·「상품명」. 「출력품목명」은 아니다. 없으면 -1 */
function _island_findItemCol0_(headers) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").replace(/\s/g, "");
    if (h.indexOf("출력") !== -1) continue;
    if (h.indexOf("품목명") !== -1 || h.indexOf("상품명") !== -1) return i;
  }
  return -1;
}

/** ARRAYFORMULA 스필로 lastRow가 부풀어 있을 때 C열(코드) 기준 실데이터 끝행 */
function _island_findLastDataRow_(tab, codeCol1) {
  var lr = tab.getLastRow();
  if (lr < 2) return 1;
  var maxScan = Math.min(lr, 2000);
  var col = codeCol1 || 3;
  var vals = tab.getRange(2, col, maxScan - 1, 1).getDisplayValues();
  var last = 1;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim()) last = i + 2;
  }
  return last;
}

// ═══════════════════════════════════════════
//  허브 적용
// ═══════════════════════════════════════════

/** opts.reconcile: 이미 금액이 있는 줄의 업체도 업체 시트를 맞춰 본다 (메뉴에서만 — 느리다) */
function _island_applyToHub_(uidBoxMap, opts) {
  opts = opts || {};
  var result = {
    applied: 0, skipped: 0, matched: 0, errors: [], vendorNames: [], feeCol: 0,
    feeByUid: {}   //  업체 시트가 허브와 «같은 금액»을 쓰게 넘긴다
  };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
    if (!hubTab || hubTab.getLastRow() < 2) return result;

    var feeCol = _island_ensureHubFeeCol_(hubTab);
    result.feeCol = feeCol;

    var hubLr = _island_findLastDataRow_(hubTab, 5); // E=이카운트코드 (또는 C=고유ID)
    if (hubLr < 2) hubLr = hubTab.getLastRow();
    // C열(고유ID) 기준으로 다시
    hubLr = Math.max(hubLr, _island_findLastDataRow_(hubTab, 3));
    if (hubLr < 2) return result;

    var readCols = Math.max(hubTab.getLastColumn(), feeCol, 15);
    var numRows = hubLr - 1;
    var hubData = hubTab.getRange(2, 1, numRows, readCols).getValues();
    var headers = hubTab.getRange(1, 1, 1, readCols).getDisplayValues()[0];

    var uidCol0 = _island_findUidCol0_(headers);
    if (uidCol0 < 0) uidCol0 = 2; // C열
    var statusCol0 = _island_findStatusCol0_(headers);
    if (statusCol0 < 0) statusCol0 = 14; // O열
    var itemCol0 = _island_findItemCol0_(headers);
    if (itemCol0 < 0) itemCol0 = 5; // F열 품목명
    var judgeCol0 = -1;
    for (var jh = 0; jh < headers.length; jh++) {
      if (String(headers[jh] || "").replace(/\s/g, "") === "도서산간판정") { judgeCol0 = jh; break; }
    }

    var feeArr = [];
    for (var i = 0; i < hubData.length; i++) {
      feeArr.push([hubData[i][feeCol - 1]]);
    }

    var vendorSet = {};
    var changedRows = [];

    for (var r = 0; r < hubData.length; r++) {
      var uid = _island_uidKey_(hubData[r][uidCol0]);
      if (!uid || !uidBoxMap[uid]) continue;

      result.matched++;

      var existing = Number(hubData[r][feeCol - 1]) || 0;
      if (existing > 0) {
        result.skipped++;
        var vn0 = String(hubData[r][1] || "").trim();
        if (vn0 && opts.reconcile) vendorSet[vn0] = true;
        result.feeByUid[uid] = existing;   //  업체 시트도 허브와 같은 금액으로
        continue;
      }

      //  ★ 2026-10-05 원장은 «받침»일 뿐 — 새 금액은 판매현황 전·주소 판정 전인 줄에만
      //    · 판매현황에 이미 올라간 줄(P열): 옛 주문에 소급해 붙이면 이미 마감한 달
      //      (9월 등)에 이카운트 OUT00001 만 뒤늦게 생긴다. 업체 시트에는 줄이 없다.
      //    · 주소 판정을 한 줄(도서산간판정): 그쪽이 주인이다. 세트분리는 이제
      //      대리판매를 패스하므로 원장에 남은 옛 「도서산간」 기록이 이길 이유가 없다.
      if (!_island_ledgerMayCharge_(hubData[r], judgeCol0)) continue;

      var status = statusCol0 >= 0 ? String(hubData[r][statusCol0] || "").replace(/\s/g, "") : "";
      if (status.indexOf("취소") !== -1 || status.indexOf("반품") !== -1 || status.indexOf("불용") !== -1) continue;
      //  ★ v3: 주문 줄마다 5,000 · 한글 「세트」 10,000 (수량·박스·합배송과 상관없이)
      var fee = _island_lineFee_(hubData[r][itemCol0]);
      result.feeByUid[uid] = fee;

      feeArr[r][0] = fee;
      changedRows.push(_island_colToLetter_(feeCol) + (r + 2));
      result.applied++;

      var vendorName = String(hubData[r][1] || "").trim();
      if (vendorName) vendorSet[vendorName] = true;
    }

    if (changedRows.length > 0) {
      hubTab.getRange(2, feeCol, feeArr.length, 1).setValues(feeArr);
      hubTab.getRangeList(changedRows)
        .setNumberFormat("#,##0")
        .setFontColor(_ISLAND_FONT_COLOR)
        .setFontWeight("bold")
        .setBackground(_ISLAND_BG_COLOR);
      _island_addConditionalFormatRule_(hubTab, "A2:" + _island_colToLetter_(feeCol) + "5000", feeCol);
      SpreadsheetApp.flush();
    }

    for (var vn in vendorSet) result.vendorNames.push(vn);

  } catch (e) {
    result.errors.push("[허브] " + e.message);
  }

  return result;
}

/** 허브에 도서산간배송비 열 확보 → 1-based 열번호 */
function _island_ensureHubFeeCol_(hubTab) {
  var lc = Math.max(hubTab.getLastColumn(), 15);
  var headers = hubTab.getRange(1, 1, 1, lc).getDisplayValues()[0];
  var found = _island_findFeeCol1_(headers);
  if (found > 0) return found;

  // 상태 열 다음(기본 P=16)
  var status0 = _island_findStatusCol0_(headers);
  var target = status0 >= 0 ? status0 + 2 : _ISLAND_HUB_COL_FALLBACK; // 1-based = index+2 for next col... 
  // status0 is 0-based → status col 1-based = status0+1 → next = status0+2
  if (status0 >= 0) target = status0 + 2;
  else target = _ISLAND_HUB_COL_FALLBACK;

  var maxCol = hubTab.getLastColumn();
  if (maxCol < target) {
    hubTab.insertColumnsAfter(maxCol, target - maxCol);
  }
  hubTab.getRange(1, target)
    .setValue("도서산간배송비")
    .setBackground(_ISLAND_HEADER_BG)
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  hubTab.setColumnWidth(target, 120);
  return target;
}

// ═══════════════════════════════════════════
//  업체 시트 적용
// ═══════════════════════════════════════════

function _island_applyToPartnerSheets_(uidBoxMap, vendorNames, feeByUid) {
  var result = { applied: 0, skipped: 0, files: 0, errors: [] };
  feeByUid = feeByUid || {};

  var files = _pt_listFiles();
  if (!files || !files.length) return result;

  var targetFiles = [];
  for (var fi = 0; fi < files.length; fi++) {
    var fn = files[fi].name.replace("[협력업체] ", "").replace("[협력업체]_", "");
    for (var vi = 0; vi < vendorNames.length; vi++) {
      if (fn.indexOf(vendorNames[vi]) !== -1 ||
          vendorNames[vi].indexOf(fn.split(" ")[0]) !== -1) {
        targetFiles.push(files[fi]);
        break;
      }
    }
  }
  if (targetFiles.length === 0) targetFiles = files;

  for (var f = 0; f < targetFiles.length; f++) {
    try {
      var ss = SpreadsheetApp.openById(targetFiles[f].id);
      var orderTab = ss.getSheetByName("발주 및 송장조회");
      if (!orderTab || orderTab.getLastRow() < 2) continue;

      var feeCol = _island_ensurePartnerFeeCol_(orderTab);
      var dataLr = _island_findLastDataRow_(orderTab, 3); // C=이카운트코드
      if (dataLr < 2) continue;

      var readCols = Math.max(orderTab.getLastColumn(), feeCol, 15);
      var numRows = dataLr - 1;
      var data = orderTab.getRange(2, 1, numRows, readCols).getValues();
      var headers = orderTab.getRange(1, 1, 1, readCols).getDisplayValues()[0];

      var uidColIdx = _island_findUidCol0_(headers);
      if (uidColIdx < 0) uidColIdx = 12; // M열 폴백
      var statusColIdx = _island_findStatusCol0_(headers);

      var oColArr = [];
      for (var i = 0; i < data.length; i++) {
        oColArr.push([data[i][feeCol - 1]]);
      }

      var changedRows = [];

      for (var r = 0; r < data.length; r++) {
        var uid = _island_uidKey_(data[r][uidColIdx]);
        if (!uid || !uidBoxMap[uid]) continue;

        var existing = Number(data[r][feeCol - 1]) || 0;
        if (existing > 0) { result.skipped++; continue; }

        var status = statusColIdx !== -1 ? String(data[r][statusColIdx] || "").replace(/\s/g, "") : "";
        if (status.indexOf("취소") !== -1 || status.indexOf("반품") !== -1 || status.indexOf("불용") !== -1) continue;
        //  ★ v3: 허브가 정한 금액만 — 허브가 안 붙인 줄(이미 판매현황에 올라갔거나
        //    주소 판정이 일반이라 한 줄)은 업체 시트에도 안 붙인다. 업체 시트(월마감 정산)와
        //    이카운트 OUT00001 이 늘 같이 간다.
        var fee = feeByUid[uid];
        if (!fee) continue;

        oColArr[r][0] = fee;
        changedRows.push(_island_colToLetter_(feeCol) + (r + 2));
      }

      if (changedRows.length > 0) {
        orderTab.getRange(2, feeCol, oColArr.length, 1).setValues(oColArr);
        orderTab.getRangeList(changedRows)
          .setNumberFormat("#,##0")
          .setFontColor(_ISLAND_FONT_COLOR)
          .setFontWeight("bold");
        _island_addConditionalFormatRule_(
          orderTab,
          "A2:" + _island_colToLetter_(feeCol) + "5000",
          feeCol
        );
        result.files++;
        result.applied += changedRows.length;
      }

      SpreadsheetApp.flush();

    } catch (e) {
      result.errors.push("[" + targetFiles[f].name.replace("[협력업체] ", "") + "] " + e.message);
    }
  }

  return result;
}

function _island_ensurePartnerFeeCol_(orderTab) {
  var lc = Math.max(orderTab.getLastColumn(), 14);
  var headers = orderTab.getRange(1, 1, 1, lc).getDisplayValues()[0];
  var found = _island_findFeeCol1_(headers);
  if (found > 0) return found;

  var target = _ISLAND_PARTNER_COL_FALLBACK; // O=15
  var maxCol = orderTab.getLastColumn();
  if (maxCol < target) {
    orderTab.insertColumnsAfter(maxCol, target - maxCol);
  }
  var h = String(orderTab.getRange(1, target).getDisplayValue() || "").trim();
  if (!h || h.indexOf("도서산간") === -1) {
    orderTab.getRange(1, target)
      .setValue("도서산간배송비")
      .setBackground(_ISLAND_HEADER_BG)
      .setFontColor("white")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    orderTab.setColumnWidth(target, 120);
  }
  return target;
}

// 하위 호환 별칭
function _island_ensureHubHeader_(hubTab) { _island_ensureHubFeeCol_(hubTab); }
function _island_ensurePartnerHeader_(orderTab) { _island_ensurePartnerFeeCol_(orderTab); }
function _island_findUidCol_(headers) { return _island_findUidCol0_(headers); }
function _island_findStatusCol_(headers) { return _island_findStatusCol0_(headers); }
function _island_findQtyCol_(headers) { return _island_findQtyCol0_(headers); }

// ═══════════════════════════════════════════
//  조건부서식
// ═══════════════════════════════════════════

function _island_addConditionalFormatRule_(tab, rangeA1, feeCol) {
  try {
    var colLetter = _island_colToLetter_(feeCol);
    var formula = '=AND($' + colLetter + '2<>"", $' + colLetter + '2>0)';

    /*  ★ 줄 «전체»를 칠한다 ★  (2026-10-06)

        > "현재 도서산간비만 보라색인데 행 전체가 보라색으로 수정해줘"

        여태 범위를 「A2:<도서산간비 칸>5000」으로 걸어, 그 칸 «뒤»의 열
        (택배사 등)은 안 칠해졌다. 눈으로는 금액 칸만 보라색으로 보인다.
        범위를 부르는 쪽이 정하면 자리마다 또 어긋나므로, 여기서 그 시트의
        «지금 쓰는 너비»로 다시 잡는다 — 열이 늘어도 따라간다.
        (받은 rangeA1 은 그 시트에 규칙이 없을 때의 대비값으로만 쓴다.)   */
    var 끝열 = 0;
    try { 끝열 = tab.getLastColumn(); } catch (e0) {}
    if (끝열 < feeCol) 끝열 = feeCol;
    var 범위 = 끝열 > 0 ? ("A2:" + _island_colToLetter_(끝열) + "5000") : rangeA1;

    /*  ★ 옛 규칙은 «갈아 끼운다» ★
        전에는 「같은 칸을 보는 규칙이 있으면 그냥 돌아간다」였다. 그래서
        범위가 좁던 옛 규칙이 남아 있는 시트는 고쳐도 영영 안 넓어졌다 —
        이 글을 쓰는 지금 허브가 그 상태다. 떼고 새로 넣는다.
        우리가 만든 것만 고른다(같은 칸 + >0) — 사람이 걸어 둔 규칙은 안 건드린다. */
    var 남길것 = [];
    var 있던것 = tab.getConditionalFormatRules() || [];
    for (var i = 0; i < 있던것.length; i++) {
      var 우리것 = false;
      var bc = 있던것[i].getBooleanCondition();
      if (bc) {
        var v = bc.getCriteriaValues();
        if (v && v.length > 0 && String(v[0]).indexOf("$" + colLetter + "2") !== -1 &&
            String(v[0]).indexOf(">0") !== -1) 우리것 = true;
      }
      if (!우리것) 남길것.push(있던것[i]);
    }

    남길것.unshift(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(formula)
        .setBackground(_ISLAND_BG_COLOR)
        .setRanges([tab.getRange(범위)])
        .build()
    );
    tab.setConditionalFormatRules(남길것);
  } catch (e) {}
}

function _island_colToLetter_(col) {
  var s = "";
  while (col > 0) { col--; s = String.fromCharCode(65 + (col % 26)) + s; col = Math.floor(col / 26); }
  return s;
}
