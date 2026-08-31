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
//  주말/공휴일 차단 (모든 자동 트리거에서 사용)
// ═══════════════════════════════════════════

/**
 * ★ 2026-07-17: 한국 공휴일 테이블 (yyyyMMdd)
 * 대체공휴일 포함. 연말에 다음 해 휴일을 추가할 것.
 * 임시공휴일은 Script Properties `_PT_EXTRA_HOLIDAYS_`에
 * "20261231,20270102" 형식으로 넣으면 코드 수정 없이 반영됨.
 */
var _PT_KR_HOLIDAYS_ = {
  // ── 2026 ──
  "20260101": "신정",
  "20260216": "설날 연휴",
  "20260217": "설날",
  "20260218": "설날 연휴",
  "20260301": "삼일절",
  "20260302": "삼일절 대체공휴일",
  "20260505": "어린이날",
  "20260524": "부처님오신날",
  "20260525": "부처님오신날 대체공휴일",
  "20260603": "전국동시지방선거",
  "20260606": "현충일",
  "20260717": "제헌절", // ★ 2026년부터 공휴일 재지정 (공휴일법 개정, 2026-02-03 의결)
  "20260815": "광복절",
  "20260817": "광복절 대체공휴일",
  "20260924": "추석 연휴",
  "20260925": "추석",
  "20260926": "추석 연휴",
  "20261003": "개천절",
  "20261005": "개천절 대체공휴일",
  "20261009": "한글날",
  "20261225": "성탄절",
  // ── 2027 ──
  "20270101": "신정",
  "20270206": "설날 연휴",
  "20270207": "설날",
  "20270208": "설날 연휴",
  "20270209": "설날 대체공휴일",
  "20270301": "삼일절",
  "20270505": "어린이날",
  "20270513": "부처님오신날",
  "20270606": "현충일",
  "20270717": "제헌절",
  "20270719": "제헌절 대체공휴일", // 2027-07-17(토) → 월요일 대체
  "20270815": "광복절",
  "20270816": "광복절 대체공휴일",
  "20270914": "추석 연휴",
  "20270915": "추석",
  "20270916": "추석 연휴",
  "20271003": "개천절",
  "20271004": "개천절 대체공휴일",
  "20271009": "한글날",
  "20271011": "한글날 대체공휴일",
  "20271225": "성탄절",
  "20271227": "성탄절 대체공휴일"
};

/**
 * 지정 날짜(기본: 오늘, Asia/Seoul)가 한국 공휴일이면 휴일명, 아니면 "" 반환
 * @param {string} [ymd] - "yyyyMMdd" (생략 시 오늘)
 */
function _pt_koreanHolidayName_(ymd) {
  var key = String(ymd || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"));
  if (_PT_KR_HOLIDAYS_[key]) return _PT_KR_HOLIDAYS_[key];
  // 임시공휴일 (Script Properties, 콤마 구분)
  try {
    var extra = PropertiesService.getScriptProperties().getProperty("_PT_EXTRA_HOLIDAYS_") || "";
    if (extra && ("," + extra.replace(/\s/g, "") + ",").indexOf("," + key + ",") !== -1) {
      return "임시공휴일";
    }
  } catch (_) {}
  return "";
}

/**
 * 주말·공휴일 블랙아웃 여부 반환
 * - 토요일(6) 전체 (★ 2026-07-18: 기존 "08:30 이후"에서 전체 차단으로 변경)
 * - 일요일(7) 전체
 * - 월요일(1) 05:30 이전
 * - ★ 2026-07-17: 한국 공휴일(대체공휴일 포함) 전체 + 공휴일 다음날 05:30 이전
 */
function _pt_isWeekendBlackout_() {
  var now = new Date();
  var parts = Utilities.formatDate(now, "Asia/Seoul", "u:HH:mm:yyyyMMdd").split(":");
  var dow  = parseInt(parts[0], 10);  // 1=월, 2=화, ..., 6=토, 7=일
  var hhmm = parseInt(parts[1], 10) * 100 + parseInt(parts[2], 10);
  var ymd  = parts[3];

  if (dow === 6) return true;                // 토요일 전체
  if (dow === 7) return true;                // 일요일 전체
  if (dow === 1 && hhmm < 530) return true;  // 월요일 05:30 이전

  // 공휴일 전체 차단
  var hol = _pt_koreanHolidayName_(ymd);
  if (hol) {
    Logger.log("[BLACKOUT] 한국 공휴일(" + hol + ") → 자동 배치 차단");
    return true;
  }

  // 공휴일 다음날 05:30 이전 차단 (월요일 새벽 규칙과 동일 — 심야 배치 보호)
  if (hhmm < 530) {
    var prev = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    var prevYmd = Utilities.formatDate(prev, "Asia/Seoul", "yyyyMMdd");
    if (_pt_koreanHolidayName_(prevYmd)) return true;
  }

  return false;
}

/**
 * [메뉴] 오늘/내일 블랙아웃 상태 + 다가오는 공휴일 확인
 */
function partnerShowBlackoutStatus() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (_) {}

  var now = new Date();
  var todayYmd = Utilities.formatDate(now, "Asia/Seoul", "yyyyMMdd");
  var tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  var tomYmd = Utilities.formatDate(tomorrow, "Asia/Seoul", "yyyyMMdd");

  var todayHol = _pt_koreanHolidayName_(todayYmd);
  var tomHol = _pt_koreanHolidayName_(tomYmd);
  var blackoutNow = _pt_isWeekendBlackout_();

  // 다가오는 공휴일 5개
  var upcoming = [];
  var keys = Object.keys(_PT_KR_HOLIDAYS_).sort();
  for (var i = 0; i < keys.length && upcoming.length < 5; i++) {
    if (keys[i] >= todayYmd) {
      upcoming.push(
        keys[i].substring(0, 4) + "-" + keys[i].substring(4, 6) + "-" +
        keys[i].substring(6, 8) + " " + _PT_KR_HOLIDAYS_[keys[i]]);
    }
  }

  var extra = "";
  try { extra = PropertiesService.getScriptProperties().getProperty("_PT_EXTRA_HOLIDAYS_") || ""; } catch (_) {}

  var msg =
    "⏸ 자동 배치 블랙아웃 상태\n\n" +
    "지금 이 시각: " + (blackoutNow ? "🔴 차단 중 (자동 배치 스킵)" : "🟢 정상 (자동 배치 작동)") + "\n" +
    "오늘(" + todayYmd + "): " + (todayHol ? "🔴 공휴일 — " + todayHol : "평일/주말 규칙 적용") + "\n" +
    "내일(" + tomYmd + "): " + (tomHol ? "🔴 공휴일 — " + tomHol : "평일/주말 규칙 적용") + "\n\n" +
    "[차단 규칙]\n" +
    "· 토·일요일 전체, 월 05:30 이전\n" +
    "· 한국 공휴일(대체공휴일 포함) 전체 + 다음날 05:30 이전\n\n" +
    "[다가오는 공휴일]\n" + (upcoming.length ? upcoming.join("\n") : "(등록된 향후 휴일 없음 — 휴일표 갱신 필요)") + "\n\n" +
    "[임시공휴일 등록]\n" +
    "Script Properties `_PT_EXTRA_HOLIDAYS_`에 \"20261231,20270102\" 형식으로 추가" +
    (extra ? "\n현재 등록: " + extra : "");

  Logger.log(msg);
  if (ui) ui.alert(msg);
}

// ═══════════════════════════════════════════
//  상수 (송장 시트 ID — 기존 orderSyncManager.gs에서 이식)
// ═══════════════════════════════════════════
var _PT_INVOICE_SHEET_ID = "1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs";
// ★ [레거시] 입력_로젠주문실적 — E열(주문번호=고유ID/사방넷) + F열(운송장번호)
//   ★ 2026-08-07: 일일마감 주송장은 롯데(_PT_SECONDARY)로 전환. 로젠은 폴백·송장수집 병행용.
var _PT_PRIMARY_INVOICE_GID = 548505068;
// ★ 2026-07-22: 롯데택배 송장 탭 — G열(운송장번호) + J열(주문번호=고유ID/사방넷)
//   ★ 2026-08-07: 통합 일일마감의 주 송장 소스
var _PT_SECONDARY_INVOICE_GID = 1575029201;
/** 1주출고 — 최근 7일 택배 출고 이력 (G=운송장, I=주문번호, L=수취인). 일일마감 보조 송장 소스 */
var _PT_WEEKLY_SHIP_GID = 756254658;
var _PT_WEEKLY_SHIP_FIXED_COL = {
  name: 11,   // L 수취인명
  phone: -1,
  invoice: 6, // G 운송장번호
  uid: 8,     // I 주문번호(=사방넷/고유ID)
};
var _PT_LOTTE_FIXED_COL = {
  name: 5,    // F
  phone: -1,  // 개인정보 미포함
  invoice: 6, // G 운송장번호
  uid: 9,     // J 주문번호(=사방넷/고유ID)
  item: 28,   // AC 상품명
  date: 3,    // D 집하일자 — 주문일 이후 송장만 붙일 때 쓴다
  icode: -1,
  qty: -1,
};
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
//  송장 매칭 정책 (2026-08-27)
// ═══════════════════════════════════════════
/**
 * ① 고유ID 가 있는 행은 **고유ID 로만** 매칭한다. 못 찾으면 미매칭으로 남긴다.
 *    이름·전화로 내려가지 않는다. 그 폴백이 재구매 고객의 과거 송장을 주워왔다.
 *
 * ② 고유ID 가 없는 행만 **이름·전화번호·주소·상품명의 조합**으로 매칭한다.
 *    이름 단독·전화 단독 같은 단일 필드 매칭은 하지 않는다.
 *
 * 일일마감 고유ID 정답: M열 `주문자명(사방넷)` = `주문자명/고유아이디`.
 * 슬래시 뒤만 키로 쓴다 (`_pep_uidFromOrdererCell_`). 칸 전체를 넣으면 미스.
 * 일일마감·백필·통합조회·재매칭은 `_pep_resolveRowInvoice_` 한 함수.
 *
 * ③ 주문일과 집하일이 **둘 다** 있으면, 집하일이 주문일보다 이른 송장은 뺀다.
 *    롯데탭 D열(집하일자)을 송장맵 `_dates` 에 실어 온다. 집하일이 없는 송장은
 *    그대로 둔다 — 날짜 모른다고 미매칭으로 만들면 안 된다.
 *    주문~집하가 1일 이상이면 택배사에 `(03)` 을 붙인다. 당일은 숫자를 안 붙인다.
 *
 * 적용 지점 — 하나만 고치면 다른 경로로 새어 나간다.
 *   · `partnerFetchInvoices`        허브 수집 (1차 이름+전화 / 2차 전화단독)
 *   · `_po_resolveTempTabInvoice_`  대리공급 임시기록
 *   · `_pep_resolveRowInvoice_`     일일마감·백필·통합조회·재매칭
 *   · `_pep_lookupNamePhoneInvoice_` 고유ID 없는 행의 조합키 사다리
 *
 * ②를 되돌려야 할 만큼 매칭률이 떨어지면 스크립트 속성
 * `INVOICE_MATCH_ALLOW_SINGLE_FIELD = true` 로 단일 필드 매칭을 다시 켠다.
 * 켜면 동명이인·재구매 고객에게서 과거 송장을 다시 주워온다.
 * ①은 속성으로 못 켠다 — 고유ID 가 있는데 이름으로 찾는 것은 정책 위반이다.
 */
var _PT_MATCH_SINGLE_FIELD_PROP_ = "INVOICE_MATCH_ALLOW_SINGLE_FIELD";
var _PT_MATCH_SINGLE_CACHE_ = null;

/** 단일 필드(이름 단독·전화 단독) 매칭 허용 여부 */
function _pt_allowSingleFieldMatch_() {
  // 캐시된 boolean 일 때만 건너뛴다. `!== null` 로 재면 변수가 초기화되지 않은
  // 상황에서 undefined 를 그대로 돌려주고, 그러면 정책이 조용히 꺼진 것처럼 보인다.
  if (_PT_MATCH_SINGLE_CACHE_ === true || _PT_MATCH_SINGLE_CACHE_ === false) {
    return _PT_MATCH_SINGLE_CACHE_;
  }
  var v = "";
  try {
    v = String(
      PropertiesService.getScriptProperties().getProperty(
        _PT_MATCH_SINGLE_FIELD_PROP_,
      ) || "",
    )
      .trim()
      .toLowerCase();
  } catch (e) {}
  _PT_MATCH_SINGLE_CACHE_ = v === "true" || v === "1" || v === "y";
  return _PT_MATCH_SINGLE_CACHE_;
}

// ═══════════════════════════════════════════
//  마감·정리용 서식 초기화
// ═══════════════════════════════════════════
/**
 * ★ 2026-07-24: 마감 후 빈 칸에 배경색·테두리·폰트서식이 남아 지저분해 보이던 문제 해결
 * clearContent만 하면 값만 지워지고 셀 서식은 남음 → 값+표시서식을 함께 제거.
 * (조건부서식 규칙 자체는 유지 — 데이터 입력 시 다시 적용됨)
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 */
function _pt_clearContentAndFormat_(range) {
  if (!range) return;
  range.clearContent();
  range.clearFormat();
}

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
  // ★ 1차: 이름에 "단가조회", "뷰어", "팩투유" 포함된 탭 탐색
  for (var i = 0; i < sheets.length; i++) {
    var n = String(sheets[i].getName() || "");
    if (n.indexOf("마감") !== -1) continue;
    if (n.indexOf("발주") !== -1) continue;
    if (n.indexOf("설정") !== -1) continue;
    if (n.indexOf("검색") !== -1) continue;
    if (
      n.indexOf("단가조회") !== -1 ||
      n.indexOf("뷰어") !== -1 ||
      n.indexOf("팩투유") !== -1 ||
      n.indexOf("단가") !== -1
    )
      return sheets[i];
  }
  // ★ 2차: K2에 그룹 열번호가 있는 탭 (배포 시 K2에 설정됨)
  for (var j = 0; j < sheets.length; j++) {
    var nm = String(sheets[j].getName() || "");
    if (nm.indexOf("발주") !== -1 || nm.indexOf("설정") !== -1 || nm.indexOf("검색") !== -1 || nm.indexOf("마감") !== -1) continue;
    try {
      var k2 = parseInt(sheets[j].getRange("K2").getValue(), 10);
      if (k2 >= 7 && k2 <= 200) return sheets[j];
    } catch (e) {}
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
  // ★ 2026-06-16: D2:D 참조 제거 → D열 ARRAYFORMULA와의 순환 의존성 해소
  // D열은 C열에 의존하므로 C열만 검사해도 동일한 결과
  return (
    '={"거래처명"; ARRAYFORMULA(IF(LEN(C2:C)=0, "", \'' +
    safeName +
    "'!$AA$1))}"
  );
}
// =====================================================================
//  ★ 개별 셀 수식 빌더 (ARRAYFORMULA -> 개별 수식 전환)
//  D열(품목명), L열(단가)은 개별 수식, A열(거래처명)은 ARRAYFORMULA 유지
//
//  ★★★ 중요: 탭별 데이터 참조 구조 (혼동 주의!) ★★★
//
//  [발주 및 송장조회] 탭 (모든 업체 공통):
//    D열(품목명) -> 해당 파일의 "단가조회" 또는 "팩투유 단가조회" 탭
//    L열(단가)   -> 해당 파일의 "단가조회" 또는 "팩투유 단가조회" 탭
//    *** 아래 함수들(_pt_buildItemNameCellFormula, _pt_buildUnitPriceCellFormula)은
//        "발주 및 송장조회" 탭 전용 ***
//
//  [전용양식] 탭 (뉴파츠 등 일부 업체만 보유):
//    D열(품목명) -> "뉴파츠공급가" 탭 또는 통합 허브의 "누적품목매핑" 탭
//    L열(단가)   -> "뉴파츠공급가" 탭 또는 통합 허브의 "누적품목매핑" 탭
//    *** 업체마다 참조 소스가 다름 ***
//    *** 이 함수들은 전용양식에 사용 금지! ***
//    *** _pt_injectOrderSpillFormulas()에서 전용양식 탭은 자동 스킵됨 ***
//
//  예시) 뉴파츠:
//    "발주 및 송장조회" D/L열 -> "팩투유 단가조회" 탭 (이것이 정상!)
//    "전용양식" D/L열         -> "뉴파츠공급가" 탭 (별도 소스)
// =====================================================================

/**
 * L열 개별 셀 수식: 단가 VLOOKUP
 * ★ 대상: "발주 및 송장조회" 탭 전용
 * ★ 참조: 단가조회(또는 팩투유 단가조회) 탭의 C:G (5번째 열 = 단가)
 * ★ 전용양식 탭에는 사용 금지! (전용양식은 뉴파츠공급가 등 별도 소스 사용)
 */
function _pt_buildUnitPriceCellFormula(viewerTabName, row) {
  var sn = String(viewerTabName || "단가조회").replace(/'/g, "''");
  var cc = "TRIM(CLEAN(SUBSTITUTE(C" + row + ',CHAR(160),"")))';
  return (
    "=IF(LEN(C" +
    row +
    "),IFERROR(VLOOKUP(" +
    cc +
    ",'" +
    sn +
    '\'!C:G,5,FALSE),"코드오류"),"")'
  );
}

/**
 * D열 개별 셀 수식: 품목명 VLOOKUP
 * ★ 대상: "발주 및 송장조회" 탭 전용
 * ★ 참조: 단가조회(또는 팩투유 단가조회) 탭의 C:D (2번째 열 = 품목명)
 * ★ 전용양식 탭에는 사용 금지!
 */
function _pt_buildItemNameCellFormula(viewerTabName, row) {
  var sn = String(viewerTabName || "단가조회").replace(/'/g, "''");
  var cc = "TRIM(CLEAN(SUBSTITUTE(C" + row + ',CHAR(160),"")))';
  return (
    "=IF(LEN(C" +
    row +
    "),IFERROR(VLOOKUP(" +
    cc +
    ",'" +
    sn +
    '\'!C:D,2,FALSE),""),"")'
  );
}

/**
 * D열/L열 개별 수식을 지정 범위에 일괄 적용
 * ★ 대상: "발주 및 송장조회" 탭 전용
 * ★ 전용양식 탭에는 호출하지 말것! (전용양식은 별도 참조 소스 사용)
 */
function _pt_applyIndividualFormulas(
  orderTab,
  viewerTabName,
  startRow,
  endRow,
) {
  if (!orderTab || startRow < 2 || endRow < startRow) return 0;
  var safe = _pt_resolveViewerTabNameForOrderSpill(orderTab, viewerTabName);
  var dFormulas = [],
    lFormulas = [];
  for (var r = startRow; r <= endRow; r++) {
    dFormulas.push([_pt_buildItemNameCellFormula(safe, r)]);
    lFormulas.push([_pt_buildUnitPriceCellFormula(safe, r)]);
  }
  var count = endRow - startRow + 1;
  orderTab.getRange(startRow, 4, count, 1).setFormulas(dFormulas);
  orderTab.getRange(startRow, 12, count, 1).setFormulas(lFormulas);
  return count;
}

// ★ 하위 호환: 기존 ARRAYFORMULA 수식 빌더 (마이그레이션 감지용으로만 사용)
function _pt_buildOrderUnitPriceSpillFormula(viewerTabName) {
  var safeName = String(viewerTabName || "단가조회").replace(/'/g, "''");
  var cleanC = 'TRIM(CLEAN(SUBSTITUTE(C2:C, CHAR(160), "")))';
  return (
    '={"단가"; ARRAYFORMULA(IF(LEN(C2:C), IFERROR(VLOOKUP(' +
    cleanC +
    ", '" +
    safeName +
    '\'!C:G, 5, FALSE), "코드오류"), ""))}'
  );
}
function _pt_buildNewPartsUnitPriceSpillFormula() {
  var cleanC = 'TRIM(CLEAN(SUBSTITUTE(C2:C, CHAR(160), "")))';
  return (
    '={"단가"; ARRAYFORMULA(IF(LEN(C2:C), IFERROR(VLOOKUP(' +
    cleanC +
    ', 뉴파츠공급가!A:C, 3, FALSE), "코드오류"), ""))}'
  );
}
function _pt_buildOrderItemNameSpillFormula(viewerTabName) {
  var safeName = String(viewerTabName || "단가조회").replace(/'/g, "''");
  var cleanC = 'TRIM(CLEAN(SUBSTITUTE(C2:C, CHAR(160), "")))';
  return (
    '={"품목명(자동)"; ARRAYFORMULA(IF(LEN(C2:C), IFERROR(VLOOKUP(' +
    cleanC +
    ", '" +
    safeName +
    '\'!C:D, 2, FALSE), ""), ""))}'
  );
}
function _pt_resolveViewerTabNameForOrderSpill(orderTab, viewerTabName) {
  var fallback = String(viewerTabName || "").trim() || "단가조회";
  if (!orderTab) return fallback;
  try {
    var ss = orderTab.getParent();
    if (!ss) return fallback;
    if (fallback && ss.getSheetByName(fallback)) return fallback;
    // ★ _pt_findViewerSheet와 동일한 확장 탐색
    var found = _pt_findViewerSheet(ss);
    if (found) return found.getName();
  } catch (e) {}
  return fallback;
}

/**
 * 업체 발주탭 P열에 남은 구버전 상태 헤더/값 잔재 정리.
 * 허브(협력업체_발주허브) P열은 판매갱신 lock — 호출 금지.
 * inject / heal / collect / push 공통.
 */
function _pt_wipeVendorOrderLeftoverStatusP_(orderTab) {
  if (!orderTab) return;
  try {
    var tn = String(orderTab.getName() || "");
    if (tn.indexOf("발주허브") !== -1 || tn.indexOf("협력업체_발주") !== -1) return;
  } catch (_) { return; }
  try {
    var p1 = orderTab.getRange("P1");
    var p1f = String(p1.getFormula() || "");
    var p1v = String(p1.getValue() || "").replace(/\s/g, "");
    // ★ 2026-08-31: P열은 이제 택배사 열이다 (송장수집이 허브 R열에서 배포).
    //   이 함수의 목적은 구버전 "상태" 잔재 청소이므로, 택배사 열은 건드리지 않는다.
    //   (헤더 상수 _PT_ORDER_TAB_CARRIER_HEADER_ 와 같이 유지할 것)
    if (p1v.indexOf("택배사") !== -1) return;
    var pClear = p1f.indexOf("MAP") !== -1 || p1f.indexOf("ARRAYFORMULA") !== -1 ||
        p1v.indexOf("상태") !== -1;
    if (!pClear) {
      var pScan = orderTab.getRange(2, 16, Math.min(Math.max(orderTab.getLastRow(), 2), 120) - 1, 1).getDisplayValues();
      for (var pi = 0; pi < pScan.length; pi++) {
        var pv = String(pScan[pi][0] || "");
        if (pv.indexOf("접수완료") !== -1 || pv.indexOf("발송완료") !== -1 ||
            pv.indexOf("입력미완") !== -1 || pv.indexOf("코드확인") !== -1) {
          pClear = true;
          break;
        }
      }
    }
    if (pClear) {
      var pEnd = typeof _PT_ORDER_SPILL_ROWS_ !== "undefined" ? _PT_ORDER_SPILL_ROWS_ : 500;
      orderTab.getRange("P1:P" + pEnd).clearContent();
    }
  } catch (eP) {}
}

/**
 * 업체 발주탭 N열 상태 스필 가드 (collect / push 공통).
 * N1 수식(#REF! 포함)이 살아 있으면 status=N(14), 값 쓰기 금지, 막힌 N값 제거, P 잔재 정리.
 * 진짜 상태 열이 없으면 N에만 "상태(자동)" 헤더 보수 (뒤에 새 열 금지).
 * 허브에는 호출하지 말 것.
 */
function _pt_guardVendorOrderStatusCol_(tab, cMap) {
  var out = { formulaMode: false, reloaded: false };
  if (!tab || !cMap) return out;
  try {
    var tn = String(tab.getName() || "");
    if (tn.indexOf("발주허브") !== -1 || tn.indexOf("협력업체_발주") !== -1) return out;
  } catch (_) {}

  var n1F = "";
  try { n1F = String(tab.getRange("N1").getFormula() || ""); } catch (_) {}

  if (n1F) {
    // N1 수식이 우선 — P열에 "상태" 헤더가 있어도 status는 N
    out.formulaMode = true;
    cMap.status = 13;
    try {
      var nEnd = typeof _PT_ORDER_SPILL_ROWS_ !== "undefined" ? _PT_ORDER_SPILL_ROWS_ : 500;
      var nM = n1F.match(/C2:C(\d+)/);
      if (nM) nEnd = parseInt(nM[1], 10);
      if (String(tab.getRange("N1").getDisplayValue() || "").indexOf("#REF") !== -1) {
        if (nEnd >= 2) tab.getRange(2, 14, nEnd - 1, 1).clearContent();
        SpreadsheetApp.flush();
        out.reloaded = true;
      }
    } catch (_) {}
  } else if (cMap.status !== -1) {
    try {
      out.formulaMode = !!String(tab.getRange(1, cMap.status + 1).getFormula() || "");
    } catch (_) {}
  } else {
    // 진짜 상태 열 없음 — N열(14번째)에만 보수 (P열 등 뒤에 새 열 생성 금지)
    try {
      tab
        .getRange(1, 14)
        .setValue("상태(자동)")
        .setBackground("#1f4e78")
        .setFontColor("white")
        .setFontWeight("bold");
      cMap.status = 13;
      out.reloaded = true;
    } catch (e) {}
  }
  try { _pt_wipeVendorOrderLeftoverStatusP_(tab); } catch (_) {}
  return out;
}

function _pt_injectOrderSpillFormulas(orderTab, viewerTabName) {
  if (!orderTab) return;
  // ★★★ 전용양식 탭은 스킵! ★★★
  var tabName = "";
  try { tabName = orderTab.getName(); } catch (e) {}
  if (tabName.indexOf("전용양식") !== -1) return;
  // ★ 2차: 헤더 내용으로도 전용양식 감지
  try {
    var h1 = orderTab
      .getRange(1, 1, 1, Math.min(orderTab.getLastColumn(), 20))
      .getValues()[0];
    var hj = h1
      .map(function (v) { return String(v || "").replace(/\s/g, ""); })
      .join("|");
    if (
      hj.indexOf("공급가액") !== -1 ||
      hj.indexOf("부가세") !== -1 ||
      hj.toLowerCase().indexOf("vat") !== -1 ||
      (hj.indexOf("택배수량") !== -1 && hj.indexOf("거래처명") !== -1)
    ) return;
  } catch (eH) {}

  var safe = _pt_resolveViewerTabNameForOrderSpill(orderTab, viewerTabName);
  var sq = "'" + safe.replace(/'/g, "''") + "'";

  // ★ 2026-07-16: 수식 모드 — A/B/D/L/N 전부 1행 스필 (onEdit 제외)

  // 뷰어 AA1 = 설정!B5 (A열 거래처명 소스)
  try {
    var viewerTab = orderTab.getParent().getSheetByName(safe);
    if (viewerTab) {
      var aa1F = String(viewerTab.getRange("AA1").getFormula() || "");
      var aa1V = String(viewerTab.getRange("AA1").getDisplayValue() || "");
      if (!aa1F || aa1V.indexOf("#REF") !== -1 || aa1V.indexOf("[매핑") !== -1) {
        viewerTab.getRange("AA1").setFormula("=IFERROR('설정'!B5,\"\")").setFontColor("white");
      }
    }
  } catch (eAA) {}

  // ── A열: 거래처명 (ARRAYFORMULA ← 뷰어 AA1) ──
  try {
    orderTab.getRange("A2:A" + _PT_ORDER_SPILL_ROWS_).clearDataValidations();
    var aClr = Math.min(Math.max(orderTab.getLastRow(), 2), _PT_ORDER_SPILL_ROWS_ + 1);
    if (aClr >= 2) orderTab.getRange(2, 1, aClr - 1, 1).clearContent();
    orderTab.getRange("A1").setFormula(_pt_buildOrderVendorNameArrayFormula_(safe));
  } catch (e1) {}

  // ── B열: 주문일자 (고정값 — TODAY() 수식 금지: 마감 조건 dNum<오늘 이 깨짐) ──
  try {
    orderTab.getRange("B2:B" + _PT_ORDER_SPILL_ROWS_).clearDataValidations();
    _pt_freezeOrderDateColumn_(orderTab);
  } catch (eB) {}

  // ── D열: 품목명 (스필 수식 — 다품목 붙여넣기 즉시 표시용) ──
  //   ★ 2026-07-20 (3차): IFERROR 헤더 고정 + 자동입력 100행 (운영자 확정)
  //   기존 업체별 조정 스필 행수가 있으면 존중 (구 기본 500·비정상이면 100행 기본)
  var _dlKeepRows_ = 0;
  try {
    var _dPrevEnd_ = _pt_formulaSpillEnd_(String(orderTab.getRange("D1").getFormula() || ""));
    if (_dPrevEnd_ >= 2 && _dPrevEnd_ < _PT_ORDER_SPILL_ROWS_) _dlKeepRows_ = _dPrevEnd_;
  } catch (_) {}
  try {
    orderTab.getRange("D2:D" + _PT_ORDER_SPILL_ROWS_).clearDataValidations();
    var dClr = Math.min(Math.max(orderTab.getLastRow(), 2), _PT_ORDER_SPILL_ROWS_ + 1);
    if (dClr >= 2) orderTab.getRange(2, 4, dClr - 1, 1).clearContent();
    orderTab.getRange("D1").setFormula(_pt_buildOrderItemNameArrayFormula_(sq, _dlKeepRows_));
  } catch (eD) {}

  // ── L열: 단가/정산금액 (스필 수식) ──
  try {
    orderTab.getRange("L2:L" + _PT_ORDER_SPILL_ROWS_).clearDataValidations();
    var lClr = Math.min(Math.max(orderTab.getLastRow(), 2), _PT_ORDER_SPILL_ROWS_ + 1);
    if (lClr >= 2) orderTab.getRange(2, 12, lClr - 1, 1).clearContent();
    orderTab.getRange("L1").setFormula(_pt_buildOrderUnitPriceArrayFormula_(sq, _dlKeepRows_));
  } catch (eL) {}

  // ── N열: 상태 ──
  try {
    var nClr = Math.min(Math.max(orderTab.getLastRow(), 2), _PT_ORDER_SPILL_ROWS_ + 1);
    if (nClr >= 2) orderTab.getRange(2, 14, nClr - 1, 1).clearContent();
    orderTab.getRange("N1").setFormula(_pt_buildOrderStatusMapFormula_(sq));
  } catch (eN) {}

  // ── P열 상태 수식/값 잔재 정리 ──
  try { _pt_wipeVendorOrderLeftoverStatusP_(orderTab); } catch (eP) {}

  // ── ★ 1행 보호 (경고만) + 한 번만 flush ──
  _pt_protectOrderRow1_(orderTab);
  // ★ 2026-07-28: 수식 주입 후 상태 행색 CF 재적용 (120행 잘림·누락 규칙 복구)
  try {
    if (typeof _pt_applyOrderTabDesign === "function") {
      _pt_applyOrderTabDesign(orderTab);
    }
  } catch (_) {}
  try { SpreadsheetApp.flush(); } catch (_) {}
}

/** 발주탭 스필 계산 행 상한 (C2:C 무한열 → 순차 지연 방지) */
var _PT_ORDER_SPILL_ROWS_ = 500;
/** ★ 2026-07-20: D/L 자동입력(스필) 행 상한 — 운영자 결정 100행 (재계산 부하·복붙 충돌 범위 축소) */
var _PT_ORDER_AUTOFILL_ROWS_ = 100;
/** 단가조회 조회 행 상한 (3행 시작 — ★ 2026-08-04: 3000 → 3700) */
var _PT_VIEWER_LOOKUP_END_ = 3700;

/** D/L 수식에 박힌 스필 끝행 추출 (C2:CNNN — 없으면 0) */
function _pt_formulaSpillEnd_(formula) {
  var m = String(formula || "").match(/C2:C(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** D/L/N 수식에 박힌 단가조회 끝행 추출 (없으면 0) */
function _pt_formulaViewerLookupEnd_(formula) {
  var f = String(formula || "");
  var m = f.match(/\$C\$3:\$G\$(\d+)/);
  if (m) return parseInt(m[1], 10);
  m = f.match(/\$C\$3:\$C\$(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

/** A1 거래처명 스필 수식 */
function _pt_buildOrderVendorNameArrayFormula_(viewerTabName) {
  var safeName = String(viewerTabName || "단가조회").replace(/'/g, "''");
  var r = _PT_ORDER_SPILL_ROWS_;
  return (
    '={"거래처명(자동)"; ARRAYFORMULA(IF(LEN(C2:C' + r + ')=0, "", \'' +
    safeName +
    "'!$AA$1))}"
  );
}

/**
 * ★ 2026-07-17: B열 주문일자 = 고정값 (TODAY ARRAYFORMULA 폐기)
 * TODAY() 수식은 매일 날짜가 바뀌어 월별 마감(날짜<오늘)이 0건이 됨.
 * - 기존 TODAY/ARRAYFORMULA면 표시값을 값으로 고정
 * - 허브 고유ID→주문일자로 복구 가능 시 허브 날짜 우선
 * - C 있고 B 비면 오늘 날짜를 1회 스탬프
 */
function _pt_buildHubOrderDateByUid_() {
  var map = {};
  try {
    var candidates = [];
    try {
      var active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) candidates.push(active);
    } catch (_) {}
    if (typeof _PT !== "undefined") {
      if (_PT.HUB_ID) {
        try { candidates.push(SpreadsheetApp.openById(_PT.HUB_ID)); } catch (_) {}
      }
      if (_PT.INFO_SS_ID) {
        try { candidates.push(SpreadsheetApp.openById(_PT.INFO_SS_ID)); } catch (_) {}
      }
    }
    var hubTab = null;
    for (var ci = 0; ci < candidates.length; ci++) {
      try {
        hubTab = candidates[ci].getSheetByName("협력업체_발주허브");
        if (hubTab && hubTab.getLastRow() >= 2) break;
        hubTab = null;
      } catch (_) { hubTab = null; }
    }
    if (!hubTab) return map;
    var num = hubTab.getLastRow() - 1;
    var data = hubTab.getRange(2, 1, num, 4).getValues(); // A~D
    for (var i = 0; i < data.length; i++) {
      var uid = String(data[i][2] || "").replace(/\s/g, "").trim();
      if (!uid) continue;
      var raw = data[i][3];
      var ds = "";
      if (raw instanceof Date) {
        ds = Utilities.formatDate(raw, "Asia/Seoul", "yyyyMMdd");
      } else {
        ds = String(raw || "").replace(/[^0-9]/g, "").substring(0, 8);
      }
      if (ds.length === 8 && parseInt(ds.substring(0, 4), 10) >= 2000) map[uid] = ds;
    }
  } catch (_) {}
  return map;
}

/**
 * B열 TODAY/ARRAYFORMULA → 고정값 변환.
 * @param {Object} [hubDateByUid] 허브 UID→yyyyMMdd (배치에서 1회 구축해 전달 권장)
 * @param {boolean} [force] true면 수식 없어도 재스탬프(기본 false — 마감 성능 핵심)
 */
function _pt_freezeOrderDateColumn_(orderTab, hubDateByUid, force) {
  if (!orderTab) return 0;
  var b1 = orderTab.getRange("B1");
  var bF = String(b1.getFormula() || "");
  var hasDynFormula = bF.indexOf("TODAY") !== -1 || bF.indexOf("ARRAYFORMULA") !== -1 || bF.indexOf("{") === 0;
  // ★ 이미 고정값이면 스킵 (업체 N개 × 허브재오픈/전체재쓰기 = 마감 30분+ 원인)
  if (!hasDynFormula && !force) return 0;

  if (!hubDateByUid) {
    try { hubDateByUid = _pt_buildHubOrderDateByUid_(); } catch (_) { hubDateByUid = {}; }
  }
  var todayStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");

  var maxScan = Math.min(Math.max(orderTab.getLastRow(), 2), _PT_ORDER_SPILL_ROWS_ + 1);
  var n = maxScan - 1;
  if (n < 1) {
    try { b1.clearContent(); b1.setValue("주문일자(자동)"); } catch (_) {}
    return 0;
  }

  var cVals = orderTab.getRange(2, 3, n, 1).getDisplayValues();
  var bVals = orderTab.getRange(2, 2, n, 1).getDisplayValues();
  var mVals = orderTab.getRange(2, 13, n, 1).getDisplayValues(); // M=고유ID

  var last = 0;
  for (var i = 0; i < n; i++) {
    if (String(cVals[i][0] || "").trim()) last = i + 1;
  }

  try { b1.clearContent(); } catch (_) {}
  try { orderTab.getRange(2, 2, n, 1).clearContent(); } catch (_) {}
  try { SpreadsheetApp.flush(); } catch (_) {}
  b1.setValue("주문일자(자동)");

  if (last < 1) return 0;

  var out = [];
  var stamped = 0;
  for (var r = 0; r < last; r++) {
    var c = String(cVals[r][0] || "").trim();
    if (!c) { out.push([""]); continue; }
    var uid = String(mVals[r][0] || "").replace(/\s/g, "").trim();
    var hubD = (uid && hubDateByUid[uid]) ? hubDateByUid[uid] : "";
    var bRaw = String(bVals[r][0] || "").replace(/[^0-9]/g, "").substring(0, 8);
    var bOk = bRaw.length === 8 &&
      parseInt(bRaw.substring(0, 4), 10) >= 2000 &&
      parseInt(bRaw.substring(4, 6), 10) >= 1 &&
      parseInt(bRaw.substring(4, 6), 10) <= 12;

    var pick = "";
    if (hubD) pick = hubD;
    else if (bOk) pick = bRaw;
    else pick = todayStr;

    out.push([pick]);
    stamped++;
  }
  orderTab.getRange(2, 2, out.length, 1).setValues(out);
  return stamped;
}

/** @deprecated TODAY 수식 폐기 — 하위호환용 스텁 */
function _pt_buildOrderDateArrayFormula_() {
  return "주문일자(자동)";
}

/**
 * D1 품목명 — 유한범위 VLOOKUP (전체열 XLOOKUP×IMPORTRANGE = 열마다 3~5초)
 * ★ 2026-07-20: 자동입력 범위 100행 (운영자 결정 — 업체별 조정 행수는 inject/heal이 존중)
 *   #REF!(스필 막힘) 노출 방지는 수식이 아니라
 *   ① 헤더행 조건부서식 오류 마스크(_pt_applyOrderTabDesign)
 *   ② onEdit 무음 복원(D/L 붙은 값 즉시 걷어냄 — p2u_partnerOnEdit)으로 처리.
 *   (IFERROR는 "Array result was not expanded" #REF!를 잡지 못함 — 검증 완료)
 */
function _pt_buildOrderItemNameArrayFormula_(sq, spillRows) {
  var r = spillRows || _PT_ORDER_AUTOFILL_ROWS_;
  var ve = _PT_VIEWER_LOOKUP_END_;
  var key = 'TRIM(CLEAN(SUBSTITUTE(C2:C' + r + ',CHAR(160),"")))';
  return (
    '={"품목명(자동)"; ARRAYFORMULA(IF(C2:C' + r + '="", "", IFERROR(VLOOKUP(' + key + ', ' +
    sq + '!$C$3:$G$' + ve + ', 2, FALSE), "🚨코드오류")))}'
  );
}

/**
 * L1 정산금액 — 동일 유한범위 VLOOKUP (5열=G 최종단가)
 * ★ 2026-07-20: 자동입력 100행 (D열과 동일 정책)
 */
function _pt_buildOrderUnitPriceArrayFormula_(sq, spillRows) {
  var r = spillRows || _PT_ORDER_AUTOFILL_ROWS_;
  var ve = _PT_VIEWER_LOOKUP_END_;
  var key = 'TRIM(CLEAN(SUBSTITUTE(C2:C' + r + ',CHAR(160),"")))';
  return (
    '={"정산금액(자동)"; ARRAYFORMULA(IF(C2:C' + r + '="", "", IFERROR(VLOOKUP(' + key + ', ' +
    sq + '!$C$3:$G$' + ve + ', 5, FALSE), "")))}'
  );
}

/**
 * N1 상태 — MAP 제거 → ARRAYFORMULA (행마다 LAMBDA/XLOOKUP 재진입 방지)
 * K=송장→발송완료, M=고유ID→접수완료, 그외 뷰어 A열 상태
 */
function _pt_buildOrderStatusMapFormula_(sq) {
  var r = _PT_ORDER_SPILL_ROWS_;
  var ve = _PT_VIEWER_LOOKUP_END_;
  var key = 'TRIM(CLEAN(SUBSTITUTE(C2:C' + r + ',CHAR(160),"")))';
  return (
    '={"상태(자동)"; ARRAYFORMULA(IF(C2:C' + r + '="", "", ' +
      'IF(K2:K' + r + '<>"", "발송완료", ' +
      'IF(M2:M' + r + '<>"", "접수완료", ' +
      'LET(st, IFNA(XLOOKUP(' + key + ', ' + sq + '!$C$3:$C$' + ve + ', ' + sq + '!$A$3:$A$' + ve + '), "##NA##"), ' +
      'IF(st="##NA##", "🔴코드확인필요", ' +
      'IF(ISNUMBER(SEARCH("단종", st)), "🚨단종", ' +
      'IF(ISNUMBER(SEARCH("품절", st))*NOT(ISNUMBER(SEARCH("품절+7", st))), "🚨품절", ' +
      'IF(ISNUMBER(SEARCH("재고까지만", st)), "⚠재고까지만", ' +
      'IF((E2:E' + r + '="")+(E2:E' + r + '=0)+(F2:F' + r + '="")+(G2:G' + r + '="")+(H2:H' + r + '="")>0, "⚠️입력미완", ' +
      '""))))))))))}'
  );
}

/**
 * 스필 수식 열을 헤더 텍스트 + 고정값으로 변환 (느린 ARRAYFORMULA/#REF! 제거)
 */
function _pt_freezeSpillColumnToValues_(orderTab, col, headerText) {
  if (!orderTab || !col) return;
  var c1 = orderTab.getRange(1, col);
  var f = String(c1.getFormula() || "");
  var lr = Math.max(orderTab.getLastRow(), 2);
  if (f && (f.indexOf("ARRAYFORMULA") !== -1 || f.indexOf("MAP") !== -1 || f.indexOf("XLOOKUP") !== -1 || f.indexOf("{") === 0)) {
    if (lr >= 2) {
      var rng = orderTab.getRange(2, col, lr - 1, 1);
      // ★ 2026-07-20: getDisplayValues → getValues — 단가가 "63,300" 문자열로 고정되는 것 방지
      var disp = rng.getValues();
      var out = [];
      for (var i = 0; i < disp.length; i++) {
        var v = disp[i][0];
        if (v && String(v).indexOf("#") === 0) v = "";
        out.push([v]);
      }
      c1.clearContent();
      rng.clearContent();
      SpreadsheetApp.flush();
      rng.setValues(out);
    } else {
      c1.clearContent();
    }
  }
  c1.setValue(headerText);
  try { orderTab.getRange(2, col, Math.max(lr - 1, 1), 1).clearDataValidations(); } catch (_) {}
}

/**
 * 발주 및 송장조회 표준 헤더 (15열)
 * ★ 수식 주입(A/D/L/N)은 이 열 위치를 전제로 함 — 열 밀림 시 양식·#REF! 꼬임
 */
var _PT_ORDER_TAB_HEADERS_ = [
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

/**
 * ★ 2026-08-07: 발주탭 열 구조 정상화 (수식 주입 전 필수)
 * 증상: 주문일자/수량/고유ID 열이 빠지면 헤더·데이터가 왼쪽으로 밀리고,
 *       복구가 D/L/N 고정열에 수식만 넣어 품목명·단가·상태가 엉뚱한 열에 생김 + #REF!
 * 조치: 누락 열을 올바른 위치에 삽입 → 중복 상태/잔여 스필수식 정리 → 표준 헤더 기록
 */
function _pt_normalizeOrderTabStructure_(orderTab) {
  var out = { ok: false, inserted: [], cleared: [], msg: "" };
  if (!orderTab) {
    out.msg = "탭없음";
    return out;
  }

  var needCols = _PT_ORDER_TAB_HEADERS_.length;
  try {
    if (orderTab.getMaxColumns() < needCols) {
      orderTab.insertColumnsAfter(
        orderTab.getMaxColumns(),
        needCols - orderTab.getMaxColumns(),
      );
    }
  } catch (_) {}

  function readHdr_() {
    var lc = Math.max(orderTab.getLastColumn(), needCols);
    return orderTab
      .getRange(1, 1, 1, lc)
      .getDisplayValues()[0]
      .map(function (v) {
        return String(v || "").replace(/\s/g, "");
      });
  }
  function findHdr_(headers, pred) {
    for (var i = 0; i < headers.length; i++) {
      if (pred(headers[i] || "")) return i;
    }
    return -1;
  }
  function isCodeHdr_(h) {
    return (
      h.indexOf("이카운트코드") !== -1 ||
      (h.indexOf("이카운트") !== -1 && h.indexOf("코드") !== -1) ||
      h.indexOf("품목코드") !== -1 ||
      h.indexOf("상품코드") !== -1
    );
  }
  function isItemHdr_(h) {
    return (
      h.indexOf("품목명") !== -1 ||
      h.indexOf("상품명") !== -1 ||
      (h.indexOf("품목") !== -1 &&
        h.indexOf("코드") === -1 &&
        h.indexOf("이카운트") === -1)
    );
  }
  function isRecvHdr_(h) {
    return (
      (h.indexOf("수취인") !== -1 ||
        h.indexOf("수하인") !== -1 ||
        h.indexOf("받는사람") !== -1 ||
        h === "받는분" ||
        h === "고객명") &&
      h.indexOf("전화") === -1 &&
      h.indexOf("주소") === -1 &&
      h.indexOf("번호") === -1 &&
      h.indexOf("연락") === -1
    );
  }
  function isQtyHdr_(h) {
    return (
      h === "수량" ||
      (h.indexOf("수량") !== -1 &&
        h.indexOf("택배") === -1 &&
        h.indexOf("박스") === -1)
    );
  }
  function isPriceHdr_(h) {
    return (
      h.indexOf("정산금액") !== -1 ||
      h === "단가" ||
      h.indexOf("단가(자동)") !== -1 ||
      (h.indexOf("단가") !== -1 &&
        h.indexOf("조회") === -1 &&
        h.indexOf("등급") === -1)
    );
  }
  function clearCol_(col1based, reason) {
    try {
      var endR = Math.min(
        Math.max(orderTab.getLastRow(), 2),
        typeof _PT_ORDER_SPILL_ROWS_ !== "undefined" ? _PT_ORDER_SPILL_ROWS_ : 500,
      );
      orderTab.getRange(1, col1based, endR, 1).clearContent();
      out.cleared.push(reason);
    } catch (_) {}
  }

  // ── ① 주문일자 누락: 이카운트코드가 B열이면 B에 삽입 ──
  var headers = readHdr_();
  var dateIdx = findHdr_(headers, function (h) {
    return h.indexOf("주문일자") !== -1 || h.indexOf("주문일") !== -1;
  });
  var codeIdx = findHdr_(headers, isCodeHdr_);
  if (dateIdx === -1) {
    var dateInsertAt = 2; // 1-based B
    if (codeIdx >= 0) dateInsertAt = codeIdx + 1; // 코드 열 앞
    try {
      orderTab.insertColumnBefore(dateInsertAt);
      orderTab.getRange(1, dateInsertAt).setValue("주문일자(자동)");
      out.inserted.push("주문일자");
    } catch (eDate) {}
  }

  // ── ② 수량 누락: 품목명 뒤(수취인 앞)에 삽입 ──
  headers = readHdr_();
  var itemIdx = findHdr_(headers, isItemHdr_);
  var qtyIdx = findHdr_(headers, isQtyHdr_);
  var recvIdx = findHdr_(headers, isRecvHdr_);
  if (qtyIdx === -1) {
    try {
      if (itemIdx >= 0) {
        orderTab.insertColumnAfter(itemIdx + 1);
        orderTab.getRange(1, itemIdx + 2).setValue("수량");
        out.inserted.push("수량");
      } else if (recvIdx >= 0) {
        orderTab.insertColumnBefore(recvIdx + 1);
        orderTab.getRange(1, recvIdx + 1).setValue("수량");
        out.inserted.push("수량");
      }
    } catch (eQty) {}
  }

  // ── ③ 고유ID 누락: 상태 앞(정산금액 뒤)에 삽입 ──
  headers = readHdr_();
  var uidIdx = findHdr_(headers, function (h) {
    return h.indexOf("고유ID") !== -1 || h.indexOf("고유Id") !== -1;
  });
  var statusIdx = findHdr_(headers, function (h) {
    return h.indexOf("상태") !== -1;
  });
  var priceIdx = findHdr_(headers, isPriceHdr_);
  if (uidIdx === -1) {
    try {
      if (statusIdx >= 0) {
        orderTab.insertColumnBefore(statusIdx + 1);
        orderTab.getRange(1, statusIdx + 1).setValue("고유ID(자동)");
        out.inserted.push("고유ID");
      } else if (priceIdx >= 0) {
        orderTab.insertColumnAfter(priceIdx + 1);
        orderTab.getRange(1, priceIdx + 2).setValue("고유ID(자동)");
        out.inserted.push("고유ID");
      }
    } catch (eUid) {}
  }

  // ── ④ 도서산간 열 확보 ──
  headers = readHdr_();
  var islandIdx = findHdr_(headers, function (h) {
    return h.indexOf("도서산간") !== -1;
  });
  if (islandIdx === -1) {
    try {
      if (orderTab.getMaxColumns() < needCols) {
        orderTab.insertColumnsAfter(
          orderTab.getMaxColumns(),
          needCols - orderTab.getMaxColumns(),
        );
      }
      // 상태 열 바로 뒤에 두면 이상적 — 없으면 O열 고정
      statusIdx = findHdr_(readHdr_(), function (h) {
        return h.indexOf("상태") !== -1;
      });
      if (statusIdx >= 0 && statusIdx + 1 < needCols) {
        orderTab.getRange(1, statusIdx + 2).setValue("도서산간배송비");
      } else {
        orderTab.getRange(1, needCols).setValue("도서산간배송비");
      }
      out.inserted.push("도서산간");
    } catch (eIs) {}
  }

  // ── ⑤ 표준 위치가 아니면 헤더만 맞추지 않고, 맞으면 표준 헤더 기록 ──
  //    (열 삽입 후 code=C·item=D 등이면 안전)
  headers = readHdr_();
  var rawHeaders = orderTab
    .getRange(1, 1, 1, Math.max(orderTab.getLastColumn(), needCols))
    .getValues()[0];
  var cMap =
    typeof _pt_buildOrderTabColumnMap === "function"
      ? _pt_buildOrderTabColumnMap(rawHeaders)
      : null;
  var aligned =
    cMap &&
    cMap.code === 2 &&
    cMap.item === 3 &&
    (cMap.date === 1 || cMap.date === -1) &&
    (cMap.qty === 4 || cMap.qty === -1);

  // ── ⑥ 잘못된 열의 스필/상태 잔재 정리 (A=1,D=4,L=12,N=14만 수식 유지) ──
  var keepF = { 1: true, 4: true, 12: true, 14: true };
  var maxScanCol = Math.min(Math.max(orderTab.getLastColumn(), needCols), 25);
  for (var col = 1; col <= maxScanCol; col++) {
    if (keepF[col]) continue;
    try {
      var cf = String(orderTab.getRange(1, col).getFormula() || "");
      var cv = String(orderTab.getRange(1, col).getDisplayValue() || "").replace(
        /\s/g,
        "",
      );
      var isSpill =
        cf.indexOf("ARRAYFORMULA") !== -1 ||
        cf.indexOf("MAP") !== -1 ||
        cf.indexOf("{") === 0;
      var isDupStatus = cv.indexOf("상태") !== -1 && col !== 14;
      var isRef = String(orderTab.getRange(1, col).getDisplayValue() || "").indexOf("#REF") !== -1;
      // 데이터 행에 #REF!만 가득한 열도 정리
      if (!isSpill && !isDupStatus && !isRef) {
        try {
          var nSamp = Math.min(Math.max(orderTab.getLastRow() - 1, 0), 5);
          if (nSamp > 0) {
            var sample = orderTab.getRange(2, col, nSamp, 1).getDisplayValues();
            var refCnt = 0;
            for (var ri = 0; ri < sample.length; ri++) {
              if (String(sample[ri][0] || "").indexOf("#REF") !== -1) refCnt++;
            }
            if (sample.length > 0 && refCnt === sample.length) isRef = true;
          }
        } catch (_) {}
      }
      if (isSpill || isDupStatus || isRef) {
        clearCol_(col, (isDupStatus ? "상태@" : isRef ? "REF@" : "수식@") + col);
      }
    } catch (_) {}
  }

  // ── ⑦ 표준 헤더 기록 (열 정렬된 경우) + 스타일 ──
  if (aligned || out.inserted.length > 0) {
    // 삽입 후 재확인 — code가 C가 아니면 오라벨 위험 → 헤더 전체 덮어쓰기 스킵
    rawHeaders = orderTab
      .getRange(1, 1, 1, Math.max(orderTab.getLastColumn(), needCols))
      .getValues()[0];
    cMap =
      typeof _pt_buildOrderTabColumnMap === "function"
        ? _pt_buildOrderTabColumnMap(rawHeaders)
        : null;
    if (cMap && cMap.code === 2) {
      try {
        orderTab.getRange(1, 1, 1, needCols).setValues([_PT_ORDER_TAB_HEADERS_.slice()]);
      } catch (_) {}
    }
  }

  try {
    orderTab
      .getRange(1, 1, 1, needCols)
      .setBackground("#1f4e78")
      .setFontColor("white")
      .setFontWeight("bold");
    orderTab.setFrozenRows(1);
  } catch (_) {}

  out.ok = true;
  out.msg =
    (out.inserted.length ? "열추가:" + out.inserted.join("+") : "열OK") +
    (out.cleared.length ? ",정리:" + out.cleared.join("+") : "");
  return out;
}

/**
 * ★ 2026-07-16: 발주탭 복구 통합 (수식 모드)
 * - ★ 2026-08-07: 수식 주입 전 열 구조 정상화 (양식 꼬임 방지)
 * - D/L/N ARRAYFORMULA·MAP 재주입 (코드 입력 즉시 자동표시)
 * - A열은 값 기반 (설정 B5)
 * - onEdit 실시간 차단 없음
 */
function _pt_repairOrderTabCollectMode_(ss) {
  var out = { ok: false, logs: [], filled: 0, msg: "" };
  if (!ss) { out.msg = "ss 없음"; return out; }

  var ot = ss.getSheetByName("발주 및 송장조회");
  if (!ot) { out.msg = "발주탭 없음"; return out; }

  // ★ 2026-08-07: 열 밀림 상태에서 수식만 넣으면 탭 양식이 붕괴 → 선정상화
  try {
    var norm = _pt_normalizeOrderTabStructure_(ot);
    if (norm && norm.ok && (norm.inserted.length || norm.cleared.length)) {
      out.logs.push(norm.msg || "열정상화");
    }
  } catch (eNorm) {
    out.logs.push("열정상화실패");
  }

  var viewer = null;
  try { viewer = _pt_findViewerSheet(ss); } catch (_) {}
  if (!viewer) {
    try {
      var sheets = ss.getSheets();
      for (var si = 0; si < sheets.length; si++) {
        var sn = sheets[si].getName();
        if (sn.indexOf("단가조회") !== -1 || sn.indexOf("뷰어") !== -1) {
          viewer = sheets[si];
          break;
        }
      }
    } catch (_) {}
  }
  var viewerName = viewer ? viewer.getName() : "단가조회";

  // L열 헤더 보정 (표시명 — 수식 헤더는 inject가 덮어씀)
  try {
    var lHeader = String(ot.getRange(1, 12).getDisplayValue() || "").trim();
    if (lHeader === "정산금액" || lHeader === "단가") {
      /* inject가 정산금액(자동) 수식으로 맞춤 */ 
    }
  } catch (_) {}

  try {
    _pt_injectOrderSpillFormulas(ot, viewerName);
    out.logs.push("수식주입");
  } catch (eInj) {
    try {
      var healResult = _pt_healOrderSpillFormulas(ot, viewerName);
      if (healResult && (healResult.dFixed || healResult.lFixed || healResult.nFixed || healResult.aFixed)) {
        out.logs.push("수식복구");
      }
    } catch (eH) {
      out.logs.push("수식오류");
    }
  }

  // ★ 2026-07-20: 조건부서식 재적용 — 헤더행 #REF! 마스크 포함
  //   (스크립트 재설치·발주탭 복구 등 모든 경로에서 마스크가 함께 설치되도록 공통화)
  try {
    if (typeof _pt_applyOrderTabDesign === "function") {
      _pt_applyOrderTabDesign(ot);
      out.logs.push("서식");
    }
  } catch (_) {}

  try {
    _pt_protectOrderRow1_(ot);
  } catch (_) {}

  out.ok = true;
  out.msg = out.logs.length ? out.logs.join(", ") : "이상없음";
  return out;
}

/**
 * ★ 2026-07-16: 발주탭 1행 보호 — 강제잠금 → 경고만
 * 강제 removeEditors 보호는 셀 편집마다 권한검사로 시트 전체가 느려짐.
 * 헤더가 값 기반이므로 경고만으로 충분.
 */
function _pt_protectOrderRow1_(orderTab) {
  if (!orderTab) return;
  try {
    var prots = orderTab.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    var hasSoft = false;
    for (var pi = 0; pi < prots.length; pi++) {
      var desc = String(prots[pi].getDescription() || "");
      if (desc.indexOf("수식보호") !== -1 || desc.indexOf("헤더보호") !== -1) {
        // 강제 잠금이면 제거 후 경고로 재설정
        try {
          if (!prots[pi].isWarningOnly()) {
            prots[pi].remove();
          } else {
            hasSoft = true;
          }
        } catch (_) {
          try { prots[pi].remove(); } catch (__) {}
        }
      }
    }
    if (!hasSoft) {
      var prot = orderTab.getRange("1:1").protect()
        .setDescription("★ 1행 헤더보호 — 경고만");
      prot.setWarningOnly(true);
    }
  } catch (eProt) {}
}

/**
 * ★ 발주탭 속도 최적화 일괄 적용 (보호 완화 + 조건부서식 축소)
 * 메뉴/복구에서 호출.
 */
function _pt_lightenOrderTabSpeed_(orderTab) {
  if (!orderTab) return;
  try {
    // 1) 강제 보호 → 경고만 (또는 제거)
    var prots = orderTab.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    for (var i = 0; i < prots.length; i++) {
      try {
        if (!prots[i].isWarningOnly()) {
          var d = String(prots[i].getDescription() || "");
          // 1행/헤더/스필 관련만 완화
          if (d.indexOf("수식보호") !== -1 || d.indexOf("헤더보호") !== -1 ||
              d.indexOf("조작 방지") !== -1 || d.indexOf("정산") !== -1) {
            prots[i].remove();
          }
        }
      } catch (_) {}
    }
    _pt_protectOrderRow1_(orderTab);

    // 2) 가벼운 조건부서식 재적용
    if (typeof _pt_applyOrderTabDesign === "function") {
      _pt_applyOrderTabDesign(orderTab);
    }

    // 3) 잔여 =FALSE 유효성 제거
    try { _pt_cleanupStrayValidations_(orderTab); } catch (_) {}

    // 4) 잔류 "입력미완" — N열이 MAP 수식이면 스킵 (스필 파괴 방지)
    try {
      var n1f = String(orderTab.getRange("N1").getFormula() || "");
      if (n1f.indexOf("MAP") === -1 && n1f.indexOf("ARRAYFORMULA") === -1) {
        var lrN = orderTab.getLastRow();
        if (lrN >= 2) {
          var nCol = orderTab.getRange(2, 14, lrN - 1, 1).getValues();
          var nChg = false;
          for (var ni = 0; ni < nCol.length; ni++) {
            var ns = String(nCol[ni][0] || "");
            if (ns.indexOf("입력미완") !== -1) {
              nCol[ni][0] = "";
              nChg = true;
            }
          }
          if (nChg) orderTab.getRange(2, 14, nCol.length, 1).setValues(nCol);
        }
      }
    } catch (_) {}
  } catch (e) {}
}

/**
 * ★ ARRAYFORMULA spill 열에 데이터 유효성 검사(입력 거부) 적용
 * 직원이 수동 입력하면 경고 + 입력 차단
 */
function _pt_protectSpillColumn_(sheet, colLetter, helpText) {
  // ★ 기존 =FALSE 유효성 검사 제거 (호환성: 이전 버전에서 설정된 것 정리)
  //   onEdit SpillGuard가 수동 입력 감지 + 복구 + toast 안내를 담당하므로
  //   데이터 유효성 검사는 불필요하며 프로그래밍적 setValue와 충돌만 일으킴
  try {
    sheet
      .getRange(colLetter + "2:" + colLetter + "1000")
      .clearDataValidations();
  } catch (e) {}
}

/**
 * ★ 모든 열의 =FALSE 데이터 유효성 검사 제거
 * onEdit SpillGuard가 수동 입력 보호를 담당하므로
 * =FALSE 유효성 검사는 프로그래밍적 setValue와 충돌만 유발
 */
function _pt_cleanupStrayValidations_(sheet) {
  try {
    var lastCol = Math.min(sheet.getLastColumn(), 26); // A~Z까지만 검사
    for (var col = 1; col <= lastCol; col++) {
      // 해당 열 2행의 데이터 유효성 검사 확인
      var cell = sheet.getRange(2, col);
      var rule = cell.getDataValidation();
      if (!rule) continue;

      // =FALSE 수식 기반 검증인지 확인
      var criteria = rule.getCriteriaType();
      if (criteria === SpreadsheetApp.DataValidationCriteria.CUSTOM_FORMULA) {
        var args = rule.getCriteriaValues();
        var formula = String((args && args[0]) || "")
          .replace(/\s/g, "")
          .toUpperCase();
        if (formula === "=FALSE" || formula === "=FALSE()") {
          var colLetter = String.fromCharCode(64 + col);
          sheet
            .getRange(colLetter + "2:" + colLetter + "1000")
            .clearDataValidations();
          Logger.log(
            "[SpillGuard] " +
              sheet.getName() +
              " " +
              colLetter +
              "열 =FALSE 검증 제거",
          );
        }
      }
    }
  } catch (e) {
    Logger.log("[SpillGuard] cleanupStrayValidations 오류: " + e.message);
  }
}

// ═══════════════════════════════════════════
//  ★ Spill Guard: 협력업체 발주탭 ARRAYFORMULA 보호
//  D열(품목명), A열(업체명), L열(정산금액) 수동입력 감지 → 즉시 복구
// ═══════════════════════════════════════════

/**
 * 협력업체 파일 onEdit 트리거 핸들러
 * D/A/L열(ARRAYFORMULA spill)에 수동입력 감지 시 자동 복구
 */
function _pt_onEditSpillGuard_(e) {
  // ★ 2026-07-15: ARRAYFORMULA 수식 잠금으로 전환됨에 따라 불필요한 스크립트 트리거 삭제 및 즉시 종료 처리
  return;
}

/**
 * 모든 협력업체 파일에 Spill Guard onEdit 트리거 설치
 * ★ GAS 트리거 제한: 사용자당 프로젝트당 최대 20개
 */
function partnerInstallSpillGuards() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  var files = _pt_listFiles();
  if (!files || !files.length) {
    if (ui) ui.alert("협력업체 파일 없음");
    return;
  }

  var installed = 0,
    skipped = 0,
    errors = [];
  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);

      // 이미 설치된 트리거 확인
      var triggers = ScriptApp.getUserTriggers(ss);
      var hasGuard = false;
      for (var t = 0; t < triggers.length; t++) {
        if (triggers[t].getHandlerFunction() === "_pt_onEditSpillGuard_") {
          hasGuard = true;
          break;
        }
      }
      if (hasGuard) {
        skipped++;
        continue;
      }

      ScriptApp.newTrigger("_pt_onEditSpillGuard_")
        .forSpreadsheet(ss)
        .onEdit()
        .create();
      installed++;
    } catch (e) {
      errors.push(files[i].name.replace("[협력업체] ", "") + ": " + e.message);
    }
  }

  var msg =
    "✅ Spill Guard 트리거 설치 완료\n설치: " +
    installed +
    "개 | 기존: " +
    skipped +
    "개" +
    (errors.length > 0 ? "\n⚠ 오류: " + errors.slice(0, 3).join(", ") : "");
  Logger.log(msg);
  if (ui) ui.alert(msg);
}

/**
 * 모든 협력업체 파일에서 Spill Guard 트리거 제거
 */
function partnerRemoveSpillGuards() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {}
  var files = _pt_listFiles();
  if (!files || !files.length) return;

  var removed = 0;
  for (var i = 0; i < files.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(files[i].id);
      var triggers = ScriptApp.getUserTriggers(ss);
      for (var t = 0; t < triggers.length; t++) {
        if (triggers[t].getHandlerFunction() === "_pt_onEditSpillGuard_") {
          ScriptApp.deleteTrigger(triggers[t]);
          removed++;
        }
      }
    } catch (e) {}
  }

  var msg = "Spill Guard 트리거 제거: " + removed + "개";
  if (ui) ui.alert(msg);
}

function _pt_healOrderSpillFormulas(orderTab, viewerTabName) {
  if (!orderTab) return { aFixed: false, lFixed: false, dFixed: false };
  // ★ 전용양식 탭에는 spill 수식 복구 금지 (A열=송장번호, 업체 수기 입력)
  try {
    var _tn = orderTab.getName();
    if (_tn.indexOf("전용양식") !== -1)
      return { aFixed: false, lFixed: false, dFixed: false };
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
      return { aFixed: false, lFixed: false, dFixed: false };
  } catch (eH) {}
  var safe = _pt_resolveViewerTabNameForOrderSpill(orderTab, viewerTabName);
  var sq = "'" + safe.replace(/'/g, "''") + "'";
  var out = { aFixed: false, bFixed: false, lFixed: false, dFixed: false, nFixed: false };
  var sampleRows = Math.max(Math.min(orderTab.getLastRow(), 200), 2);
  var checkRows = sampleRows - 1;
  var aHasRefBelow = false,
    lHasRefBelow = false,
    dHasRefBelow = false;
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
    var dB = orderTab.getRange(2, 4, checkRows, 1).getDisplayValues();
    for (var di = 0; di < dB.length; di++) {
      if (String(dB[di][0] || "").indexOf("#REF") !== -1) {
        dHasRefBelow = true;
        break;
      }
    }
  } catch (e) {}
  try {
    var a1 = orderTab.getRange("A1");
    var aF = String(a1.getFormula() || "");
    var aOk = aF.indexOf("ARRAYFORMULA") !== -1 && (aF.indexOf("$AA$1") !== -1 || aF.indexOf("AA1") !== -1);
    if (!aOk || aHasRefBelow) {
      try {
        var vtA = orderTab.getParent().getSheetByName(safe);
        if (vtA) {
          var aa1F = String(vtA.getRange("AA1").getFormula() || "");
          if (!aa1F) vtA.getRange("AA1").setFormula("=IFERROR('설정'!B5,\"\")").setFontColor("white");
        }
      } catch (_) {}
      orderTab.getRange("A2:A1000").clearDataValidations();
      var aLr = orderTab.getLastRow();
      if (aLr >= 2) orderTab.getRange(2, 1, aLr - 1, 1).clearContent();
      a1.setFormula(_pt_buildOrderVendorNameArrayFormula_(safe));
      out.aFixed = true;
    }
  } catch (ea) {}
  // ── B열: 주문일자 고정값 (TODAY/ARRAYFORMULA면 즉시 값으로 복구) ──
  try {
    var b1 = orderTab.getRange("B1");
    var bF = String(b1.getFormula() || "");
    var bBroken = !bF
      ? false
      : (bF.indexOf("TODAY") !== -1 || bF.indexOf("ARRAYFORMULA") !== -1 || bF.indexOf("{") === 0);
    // 헤더가 수식이거나, C 있는데 B 빈 행이 있으면 freeze
    var needFreeze = bBroken;
    if (!needFreeze) {
      var bSample = Math.min(Math.max(orderTab.getLastRow(), 2), 80);
      var bC = orderTab.getRange(2, 3, bSample - 1, 1).getDisplayValues();
      var bB = orderTab.getRange(2, 2, bSample - 1, 1).getDisplayValues();
      for (var bi = 0; bi < bC.length; bi++) {
        if (String(bC[bi][0] || "").trim() && !String(bB[bi][0] || "").replace(/[^0-9]/g, "")) {
          needFreeze = true; break;
        }
      }
    }
    if (needFreeze) {
      orderTab.getRange("B2:B" + _PT_ORDER_SPILL_ROWS_).clearDataValidations();
      _pt_freezeOrderDateColumn_(orderTab);
      out.bFixed = true;
    }
  } catch (eb) {}
  // ── D열: ARRAYFORMULA+VLOOKUP 수식 확인/복구 ──
  //   ★ 2026-07-20: 업체별 조정 스필 행수 존중 — 2 ≤ 끝행 < 500(구 기본)이면 유지, 그외 100행 기본
  var _healKeepRows_ = 0;
  try {
    var _hPrevEnd_ = _pt_formulaSpillEnd_(String(orderTab.getRange("D1").getFormula() || ""));
    if (_hPrevEnd_ >= 2 && _hPrevEnd_ < _PT_ORDER_SPILL_ROWS_) _healKeepRows_ = _hPrevEnd_;
  } catch (_) {}
  try {
    var d1 = orderTab.getRange("D1");
    var dF = String(d1.getFormula() || "");
    var dOk = dF.indexOf("ARRAYFORMULA") !== -1 &&
      (dF.indexOf("VLOOKUP") !== -1 || dF.indexOf("XLOOKUP") !== -1);
    var dEnd = _pt_formulaViewerLookupEnd_(dF);
    // ★ 2026-07-20: 스필 막힘 감지 — 수식은 살아있는데 D1 표시가 #REF!(값이 스필 차단)
    var dBlocked = false;
    try { dBlocked = String(d1.getDisplayValue() || "").indexOf("#REF") !== -1; } catch (_) {}
    if (!dOk || dHasRefBelow || dBlocked || (dEnd > 0 && dEnd < _PT_VIEWER_LOOKUP_END_)) {
      orderTab.getRange("D2:D" + _PT_ORDER_SPILL_ROWS_).clearDataValidations();
      var dLr = orderTab.getLastRow();
      if (dLr >= 2) {
        orderTab.getRange(2, 4, Math.min(dLr - 1, _PT_ORDER_SPILL_ROWS_), 1).clearContent();
      }
      d1.setFormula(_pt_buildOrderItemNameArrayFormula_(sq, _healKeepRows_));
      out.dFixed = true;
    }
  } catch (ed) {}
  // ── L열: ARRAYFORMULA+VLOOKUP 수식 확인/복구 ──
  try {
    var l1 = orderTab.getRange("L1");
    var lF = String(l1.getFormula() || "");
    var lOk = lF.indexOf("ARRAYFORMULA") !== -1 &&
      (lF.indexOf("VLOOKUP") !== -1 || lF.indexOf("XLOOKUP") !== -1);
    var lEnd = _pt_formulaViewerLookupEnd_(lF);
    var lBlocked = false;
    try { lBlocked = String(l1.getDisplayValue() || "").indexOf("#REF") !== -1; } catch (_) {}
    if (!lOk || lHasRefBelow || lBlocked || (lEnd > 0 && lEnd < _PT_VIEWER_LOOKUP_END_)) {
      orderTab.getRange("L2:L" + _PT_ORDER_SPILL_ROWS_).clearDataValidations();
      var lLr = orderTab.getLastRow();
      if (lLr >= 2) {
        orderTab.getRange(2, 12, Math.min(lLr - 1, _PT_ORDER_SPILL_ROWS_), 1).clearContent();
      }
      l1.setFormula(_pt_buildOrderUnitPriceArrayFormula_(sq, _healKeepRows_));
      out.lFixed = true;
    }
  } catch (el) {}
  // ── 잘못된 열의 =FALSE 데이터 유효성 검사 정리 ──
  try {
    _pt_cleanupStrayValidations_(orderTab);
  } catch (eCleanup) {}
  // ── N열: ARRAYFORMULA 확인/복구 (구 MAP·Error면 재주입) ──
  try {
    var n1 = orderTab.getRange("N1");
    var nF = String(n1.getFormula() || "");
    var nDisp = "";
    try { nDisp = String(n1.getDisplayValue() || ""); } catch (_) {}
    var nOk = nF.indexOf("ARRAYFORMULA") !== -1 && nF.indexOf("접수완료") !== -1 &&
      nF.indexOf("MAP") === -1;
    var nEnd = _pt_formulaViewerLookupEnd_(nF);
    // ★ 2026-07-22: 스필 막힘(#REF!)도 복구 대상 — 송장배포 등이 N에 값을 써서 막힌 경우
    if (!nOk || /error/i.test(nDisp) || nDisp.indexOf("#REF") !== -1 ||
        (nEnd > 0 && nEnd < _PT_VIEWER_LOOKUP_END_)) {
      var nLr = orderTab.getLastRow();
      if (nLr >= 2) {
        orderTab.getRange(2, 14, Math.min(nLr - 1, _PT_ORDER_SPILL_ROWS_), 1).clearContent();
      }
      n1.setFormula(_pt_buildOrderStatusMapFormula_(sq));
      out.nFixed = true;
    }
  } catch (en) {}
  // ── P열 상태 수식/값 잔재 정리 (inject와 동일) ──
  try { _pt_wipeVendorOrderLeftoverStatusP_(orderTab); } catch (eP) {}
  _pt_protectOrderRow1_(orderTab);
  // ★ 2026-07-28: heal 후에도 상태 행색 CF 재적용
  try {
    if (typeof _pt_applyOrderTabDesign === "function") {
      _pt_applyOrderTabDesign(orderTab);
    }
  } catch (_) {}
  return out;
}


// ═══════════════════════════════════════════
//  _pt_backfillOrderDL: 발주탭 D(품목명)/L(단가) 빈 셀 역보충
// ═══════════════════════════════════════════
/**
 * 허브 행 데이터 → 대리공급 Push UID 형식(MMdd-ph-XXXX) 파생
 * _pep_deriveDeterministicUid_와 동일한 해시 알고리즘 사용.
 * 허브 C열 UID(MMdd-ds-xxxx)와 전용양식 AX열 UID(MMdd-ph-XXXX)가 다를 때
 * 이 함수로 파생 UID를 만들어 invoiceMap에서 재조회.
 *
 * hubRow 인덱스(허브 _PO_HUB_HEADERS 기준):
 *   [3]=주문일자, [4]=이카운트코드, [7]=수취인, [8]=수취인전화번호, [9]=수취인주소
 */
function _pt_deriveHubRowPepUid_(hubRow) {
  try {
    var rawDate = hubRow[3]; // D열 = 주문일자
    var dateStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
    if (rawDate) {
      var ds = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, "Asia/Seoul", "yyyyMMdd")
        : String(rawDate).replace(/[^0-9]/g, "").substring(0, 8);
      if (ds && ds.length >= 8) dateStr = ds;
    }
    var mmdd = dateStr.substring(4, 8);
    var code = String(hubRow[4] || "").replace(/\s/g, "").trim().substring(0, 12) || "X";
    var recipient = String(hubRow[7] || "").replace(/\s/g, "").trim().substring(0, 12) || "U";
    var phone = String(hubRow[8] || "").replace(/[^0-9]/g, "");
    var addr = String(hubRow[9] || "").replace(/\s/g, "").trim().substring(0, 16);
    var hashInput = dateStr + code + recipient + phone + addr;
    var CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var h = 0;
    for (var i = 0; i < hashInput.length; i++) {
      h = Math.imul(31, h) + hashInput.charCodeAt(i) | 0;
    }
    var n = Math.abs(h);
    var suffix = "";
    for (var j = 0; j < 4; j++) {
      suffix += CHARS[n % CHARS.length];
      n = Math.floor(n / CHARS.length);
    }
    return mmdd + "-ph-" + suffix;
  } catch (e) { return ""; }
}

function _pt_backfillOrderDL(orderTab, viewerTab) {
  var result = { filled: 0 };
  if (!orderTab || !viewerTab) return result;
  try {
    // ★ 2026-07-16: D1/L1에 ARRAYFORMULA 스필이 있으면 값 쓰기 금지 (#REF! 유발)
    var d1f = String(orderTab.getRange("D1").getFormula() || "");
    var l1f = String(orderTab.getRange("L1").getFormula() || "");
    if (d1f.indexOf("ARRAYFORMULA") !== -1 && l1f.indexOf("ARRAYFORMULA") !== -1) {
      return result; // 수식이 채움 → 백필 불필요
    }
    var otLr = orderTab.getLastRow();
    if (otLr < 2) return result;
    var vLast = viewerTab.getLastRow();
    if (vLast < 3) return result;
    // 뷰어 탭 데이터 → codeMap 구축
    var vData = viewerTab.getRange(3, 1, vLast - 2, 7).getValues();
    var vMap = {};
    for (var vi = 0; vi < vData.length; vi++) {
      var vCode = String(vData[vi][2] || "").replace(/\s/g, "");
      if (vCode && vCode.indexOf("#REF") === -1 && vCode.indexOf("#N/A") === -1) {
        if (!vMap[vCode]) {
          vMap[vCode] = {
            name: String(vData[vi][3] || "").trim(),
            price: vData[vi][6]  // G열 = index 6 (최종단가)
          };
        }
      }
    }
    if (Object.keys(vMap).length === 0) return result;
    // 발주탭 C/D/L 일괄 읽기
    var cVals = orderTab.getRange(2, 3, otLr - 1, 1).getValues();
    var dVals = orderTab.getRange(2, 4, otLr - 1, 1).getValues();
    var lVals = orderTab.getRange(2, 12, otLr - 1, 1).getValues();
    var dChanged = false, lChanged = false;
    var dHasSpill = d1f.indexOf("ARRAYFORMULA") !== -1;
    var lHasSpill = l1f.indexOf("ARRAYFORMULA") !== -1;
    for (var ri = 0; ri < cVals.length; ri++) {
      var code = String(cVals[ri][0] || "").replace(/\s/g, "");
      if (!code) continue;
      var dEmpty = !String(dVals[ri][0] || "").trim();
      var lEmpty = !String(lVals[ri][0] || "").toString().trim() || lVals[ri][0] === 0;
      if (!dEmpty && !lEmpty) continue;
      var match = vMap[code];
      if (match) {
        if (!dHasSpill && dEmpty && match.name) { dVals[ri][0] = match.name; dChanged = true; result.filled++; }
        if (!lHasSpill && lEmpty && match.price) { lVals[ri][0] = match.price; lChanged = true; if (!dEmpty) result.filled++; }
      }
    }
    // 배치 쓰기 (변경된 열만)
    if (dChanged) orderTab.getRange(2, 4, otLr - 1, 1).setValues(dVals);
    if (lChanged) orderTab.getRange(2, 12, otLr - 1, 1).setValues(lVals);
  } catch (eBf) {
    Logger.log("[_pt_backfillOrderDL] 에러: " + eBf.message);
  }
  return result;
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
      // ★ 2026-07-21: 첫 매칭 우선 — N열(상태(자동)) 뒤의 구버전 P열("상태") 잔재가
      //   status를 덮어써 접수완료·출고승인 기록이 P열로 새던 문제 수정
      if (cMap.status === -1) cMap.status = c;
    } else if (
      h.indexOf("정산단가") !== -1 ||
      h.indexOf("확정단가") !== -1 ||
      h.indexOf("정산금액") !== -1 ||
      // ★ 2026-08-03: "단가"/"단가(자동)" 헤더도 unitPrice 매핑
      //   (미매핑 시 마감 이동에서 수량×단가 곱셈이 스킵되어 1개분만 마감되는 사고)
      h === "단가" ||
      h.indexOf("단가(자동)") !== -1 ||
      (h.indexOf("단가") !== -1 &&
        h.indexOf("조회") === -1 &&
        h.indexOf("분석") === -1 &&
        h.indexOf("등급") === -1 &&
        h.indexOf("매핑") === -1 &&
        h.indexOf("변동") === -1)
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
// ═══════════════════════════════════════════
//  원천 읽기 신뢰성
//  수집이 원천을 못 읽으면 그 주문은 영구 미매칭이 되고, 사람이 손으로
//  채워 넣는다. 손으로 넣은 값은 근거가 없어 나중에 추적도 안 된다.
//  그래서 '읽기'가 매칭보다 먼저다.
// ═══════════════════════════════════════════

/** 이 값이 송장번호처럼 보이는가 — 숫자 9~14자리, 전화·날짜 제외 */
function _pt_looksLikeInvoiceNo_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return false;
  var d = s.replace(/[^0-9]/g, "");
  if (d.length < 9 || d.length > 14) return false;
  if (/^01[016789]/.test(d)) return false;        // 휴대폰
  if (/^0[2-6]\d/.test(d) && d.length <= 11) return false; // 지역번호 유선
  if (/^20[0-9]{2}[01][0-9][0-3][0-9]/.test(d)) return false; // 20260826… 날짜
  // 숫자 외 글자가 많으면 송장이 아니다 (품목명·주소 등)
  var nonDigit = s.replace(/[0-9\s\-]/g, "").length;
  return nonDigit <= 2;
}

/** 특정 열에 송장처럼 보이는 값이 몇 개나 있나 (표본 200행) */
function _pt_colInvoiceHits_(rows, start, idx) {
  if (!(idx >= 0)) return 0;
  var hits = 0;
  var end = Math.min(rows.length, start + 200);
  for (var r = start; r < end; r++) {
    if (rows[r] && _pt_looksLikeInvoiceNo_(rows[r][idx])) hits++;
  }
  return hits;
}

/**
 * 헤더 행 찾기. 원천마다 제목·안내문이 위에 붙어 1행이 헤더가 아닐 수 있다.
 * 일일마감은 이 처리를 하는데(_pep_findLotteHeaderRow_) 수집은 1행을 고정으로
 * 가정해, 같은 시트를 두 시스템이 다르게 읽고 있었다.
 * @return {number} 헤더 행 인덱스. 헤더로 볼 만한 행이 없으면 0
 */
function _pt_findInvoiceHeaderRow_(rows) {
  var best = 0, bestScore = 0;
  var n = Math.min((rows && rows.length) || 0, 8);
  for (var r = 0; r < n; r++) {
    var row = rows[r] || [];
    var score = 0;
    for (var c = 0; c < row.length; c++) {
      var h = String(row[c] == null ? "" : row[c]).replace(/\s/g, "");
      if (!h) continue;
      if (/^\d{6,}$/.test(h)) { score -= 3; continue; } // 데이터 행 징표
      if (/운송장|^송장번호$|택배번호/.test(h) && !/반품|재출력|원송장/.test(h)) score += 6;
      if (/사방넷주문번호|고객주문번호|고유ID|^주문번호$/i.test(h)) score += 4;
      if (/수취인|수령인|받는분|받는사람|수하인/.test(h)) score += 3;
      if (/연락처|전화|휴대폰|모바일/.test(h)) score += 2;
      if (/품목|상품명|물품명/.test(h)) score += 2;
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore > 0 ? best : 0;
}

/**
 * 헤더 이름으로 송장 열을 못 찾았을 때, 값 모양으로 찾는다.
 * 원천이 헤더를 '출력번호'·'TRACKING' 처럼 예상 밖으로 적어도 읽히게 한다.
 * @param {Object} taken 이미 다른 용도로 배정된 열 인덱스 집합
 * @return {number} 열 인덱스. 없으면 -1
 */
function _pt_detectInvoiceColByValue_(rows, start, taken) {
  var width = 0;
  var end = Math.min(rows.length, start + 200);
  for (var r = start; r < end; r++) {
    if (rows[r] && rows[r].length > width) width = rows[r].length;
  }
  var best = -1, bestHits = 0;
  for (var c = 0; c < width; c++) {
    if (taken && taken[c]) continue;
    var seen = 0, hits = 0;
    for (var r2 = start; r2 < end; r2++) {
      var v = String((rows[r2] && rows[r2][c]) || "").trim();
      if (!v) continue;
      seen++;
      if (_pt_looksLikeInvoiceNo_(v)) hits++;
    }
    // 값이 있는 행의 8할 이상이 송장 모양이어야 인정한다 (우연 일치 배제)
    if (seen >= 3 && hits >= Math.ceil(seen * 0.8) && hits > bestHits) {
      bestHits = hits;
      best = c;
    }
  }
  return best;
}

/** 원천별 읽기 실적 — 어느 원천이 몇 건을 실제로 내줬나 */
var _PT_INGEST_STAT_ = null;

function _pt_ingestStatReset_() { _PT_INGEST_STAT_ = []; }

function _pt_ingestStatPush_(rec) {
  if (!_PT_INGEST_STAT_) _PT_INGEST_STAT_ = [];
  _PT_INGEST_STAT_.push(rec);
}

/** 보고서용 — 송장을 0건 내준 원천을 앞에 세운다 */
function _pt_ingestStatSummary_() {
  if (!_PT_INGEST_STAT_ || !_PT_INGEST_STAT_.length) return "";
  var dead = [], live = [];
  for (var i = 0; i < _PT_INGEST_STAT_.length; i++) {
    var s = _PT_INGEST_STAT_[i];
    var line = "· " + s.label + ": " + s.rows + "행 → 송장 " + s.inv + "건" +
      (s.note ? " (" + s.note + ")" : "");
    if (!s.inv) dead.push(line);
    else live.push(line);
  }
  var out = [];
  if (dead.length) {
    out.push("⛔ 송장 0건인 원천 — 이 원천의 주문은 매칭될 수 없습니다");
    out = out.concat(dead);
  }
  if (live.length) {
    out.push("── 읽은 원천 ──");
    out = out.concat(live);
  }
  return out.join("\n");
}

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

  // ── ★ 2026-08-26: 헤더 행 탐지 ──
  // 종전에는 1행을 헤더로 고정했다. 제목·안내문이 위에 있는 원천은 헤더 행을
  // 데이터로, 첫 데이터 행을 헤더로 읽어 송장 0건이 됐다.
  // 헤더가 0행에 오도록 앞을 잘라내면 이후 로직은 그대로 쓸 수 있다.
  var _ingestNote_ = [];
  var _hdrRow_ = _pt_findInvoiceHeaderRow_(invData);
  if (_hdrRow_ > 0) {
    invData = invData.slice(_hdrRow_);
    _ingestNote_.push("헤더 " + (_hdrRow_ + 1) + "행");
    Logger.log(
      "[송장인제스트] [" + labelForLog + "] 헤더 행 = " + (_hdrRow_ + 1) + "행 (1행 아님)",
    );
  }

  // ── ★ 고정 열 검증 ──
  // 고정 열은 원천 서식이 바뀌면 조용히 틀린다. 지정된 송장 열에 송장처럼
  // 보이는 값이 하나도 없으면 그 가정은 이미 깨진 것이므로 헤더 탐지로 넘긴다.
  if (fixedColIdx && fixedColIdx.invoice >= 0) {
    if (_pt_colInvoiceHits_(invData, 1, fixedColIdx.invoice) === 0) {
      var _fcL_ = _pt_colLetter_(fixedColIdx.invoice + 1);
      _ingestNote_.push("고정열 " + _fcL_ + " 비어 헤더탐지 전환");
      scannedLogs.push(
        "[" + labelForLog + "] ⚠ 고정 송장열 " + _fcL_ +
          "에 송장이 없습니다 → 헤더 탐지로 전환 (원천 서식 변경 의심)",
      );
      Logger.log(
        "[송장인제스트] [" + labelForLog + "] 고정열 " + _fcL_ + " 송장 0건 → fixedColIdx 해제",
      );
      fixedColIdx = null;
    }
  }

  var headers = invData[0];
  var nameIdx = fixedColIdx ? fixedColIdx.name : -1,
    phoneIdx = fixedColIdx ? fixedColIdx.phone : -1,
    invoiceIdx = fixedColIdx ? fixedColIdx.invoice : -1,
    uidIdx = fixedColIdx ? fixedColIdx.uid : -1,
    sabangnetUidIdx = -1, // 사방넷주문번호 전용
    itemIdx = fixedColIdx ? fixedColIdx.item : -1;
  if (!fixedColIdx) {
    // ★ HR(뉴파츠) 32열 전용양식 감지 시 열 위치 강제 고정 (오늘 발생한 인제스트 오감지 원천 차단)
    var hJoined = headers.join("|");
    if (hJoined.indexOf("수령인연락처") !== -1 && hJoined.indexOf("거래처코드") !== -1) {
      invoiceIdx = 0;   // A열: 송장번호
      nameIdx = 17;     // R열: 수령인
      phoneIdx = 18;    // S열: 수령인연락처
      itemIdx = 22;     // W열: 변환품목명
      sabangnetUidIdx = 49; // AX열: 고유ID
      uidIdx = 49;      // AX열: 고유ID
      Logger.log("[" + labelForLog + "] ★ HR(뉴파츠) 전용양식 고정 열 매핑 적용 (A=송장, R=수령인, S=연락처, AX=UID)");
    } else {
    // ★ 1차 스캔: 수령인/수취인 등 진짜 수취인 키워드 우선 탐색 (거래처명에 뺏기는 현상 방지)
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c]).replace(/\s/g, "");
      if (
        nameIdx === -1 &&
        h.match(
          /수취인명|수령인명|받는분명|받으시는분|수취인|수령인|수령자|받는사람|받는분|고객명|이름|성명|성함|주문자명|고객|수화주명|수화주/,
        ) &&
        !h.match(/주소|전화|연락|핸드|휴대|보내는|송하인|배송지|코드|거래처/)
      )
        nameIdx = c;
      if (
        phoneIdx === -1 &&
        h.match(
          /연락처|전화|모바일|핸드폰|휴대폰|수하인전화|수하인번호|받는전화|수령인연락처/,
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
        h.match(/사방넷주문번호|고유아이디|고유ID|주문번호/i)
      )
        uidIdx = c;
      if (
        itemIdx === -1 &&
        h.match(/품목|상품|물품|상세|내용/) &&
        !h.match(/코드/)
      )
        itemIdx = c;
    }
    // ★ 2차 스캔: 1차에서 nameIdx를 못 찾은 경우에만 '거래처명' 폴백 검색
    if (nameIdx === -1) {
      for (var c_fallback = 0; c_fallback < headers.length; c_fallback++) {
        var h_fb = String(headers[c_fallback]).replace(/\s/g, "");
        if (h_fb.match(/거래처명/) && !h_fb.match(/코드/)) {
          nameIdx = c_fallback;
          break;
        }
      }
    }
    }
  }
  // ★ 2026-07-22: fixedColIdx 전달 시 2행 헤더 재스캔 금지
  //   (고정 열 형식에서 name/phone=-1로 두면 이 블록이 발동해 2행(데이터)을
  //    헤더로 오인 → invData.slice(1)로 데이터 첫 행이 수집에서 누락되던 버그)
  if (!fixedColIdx && (invoiceIdx === -1 || phoneIdx === -1) && invData.length > 1) {
    var row2 = invData[1];
    // ★ 2026-08-26: 2행이 헤더라고 확정된 경우에만 앞을 잘라낸다.
    //   종전에는 전화 열이 없는 원천(phoneIdx=-1)이면 1행에서 송장 열을 이미
    //   찾았어도 이 블록이 돌아 invData.slice(1) 을 실행했다. 읽기 루프는 i=1
    //   부터 도니 첫 데이터 행이 매번 조용히 사라졌다.
    var _row2IsHeader_ = false;
    for (var c2 = 0; c2 < row2.length; c2++) {
      var h2 = String(row2[c2]).replace(/\s/g, "");
      if (!h2) continue;
      if (
        nameIdx === -1 &&
        h2.match(
          /수취인명|수령인명|받는분명|받으시는분|수취인|수령인|수령자|받는사람|받는분|고객명|이름|성명|성함|주문자명|고객|거래처명|수화주명|수화주/,
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
      ) {
        invoiceIdx = c2;
        _row2IsHeader_ = true; // 2행에서 송장 열 이름을 찾았다 = 2행이 헤더다
      }
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
    if (_row2IsHeader_) {
      invData = invData.slice(1);
      headers = invData[0];
      _ingestNote_.push("헤더 2행");
    }
  }
  // ★ AX열(50번째, index 49) 강제 UID 인식 — Push 시 고유ID가 이 열에 저장됨
  // ★ 2026-07-28: 샘플 체크 범위 5→20행 확장 (마감 후 상위 행이 비어도 감지)
  //   + uidIdx 오버라이드 조건 완화 (적요/배송메시지 열보다 AX열 항상 우선)
  if (invData[0] && invData[0].length >= 50) {
    var _axHdr_ = String(invData[0][49] || "").trim();
    if (_axHdr_.match(/고유|UID|ID/i) || _axHdr_ === "") {
      // AX열에 실제 데이터가 있는지 샘플 확인 (2~20행)
      var _hasAxData_ = false;
      for (var _axCk_ = 1; _axCk_ < Math.min(invData.length, 20); _axCk_++) {
        if (String(invData[_axCk_][49] || "").trim()) {
          _hasAxData_ = true;
          break;
        }
      }
      if (_hasAxData_) {
        sabangnetUidIdx = 49;
        uidIdx = 49; // ★ 2026-07-28: AX열 데이터 확인됨 → 무조건 AX열 우선 (적요/배송메시지 열 감지 충돌 방지)
        Logger.log(
          "[송장인제스트] [" +
            labelForLog +
            "] AX열(49) 고유ID 강제 인식 (uidIdx=" +
            uidIdx +
            ")",
        );
      }
    }
  }
  // ── ★ 값 기반 송장열 탐지 ──
  // 헤더 이름이 예상 밖('출력번호'·'TRACKING' 등)이면 이름으로는 못 찾는다.
  // 이 경우 값 모양으로 찾는다. 전화·날짜는 배제하므로 오탐 위험이 낮다.
  if (invoiceIdx === -1) {
    var _taken_ = {};
    if (nameIdx >= 0) _taken_[nameIdx] = true;
    if (phoneIdx >= 0) _taken_[phoneIdx] = true;
    if (uidIdx >= 0) _taken_[uidIdx] = true;
    if (itemIdx >= 0) _taken_[itemIdx] = true;
    var _byVal_ = _pt_detectInvoiceColByValue_(invData, 1, _taken_);
    if (_byVal_ >= 0) {
      invoiceIdx = _byVal_;
      var _bvL_ = _pt_colLetter_(_byVal_ + 1);
      _ingestNote_.push("송장열 " + _bvL_ + " 값추론");
      scannedLogs.push(
        "[" + labelForLog + "] 송장 열을 헤더로 못 찾아 값으로 추정: " +
          _bvL_ + "열 [" + String(headers[_byVal_] || "(제목없음)") + "]",
      );
      Logger.log(
        "[송장인제스트] [" + labelForLog + "] 값 기반 송장열 = " + _bvL_,
      );
    }
  }

  if (invoiceIdx === -1) {
    // 열을 못 찾으면 이 원천의 주문은 전부 미매칭이 된다. 헤더를 전부 보여준다.
    var _hdrAll_ = [];
    for (var _hc_ = 0; _hc_ < headers.length; _hc_++) {
      var _hv_ = String(headers[_hc_] == null ? "" : headers[_hc_]).trim();
      if (_hv_) _hdrAll_.push(_pt_colLetter_(_hc_ + 1) + "=" + _hv_);
    }
    Logger.log(
      "[송장스캔디버그] [" + labelForLog + "] 송장열 탐지 실패. 전체 헤더: " +
        _hdrAll_.join(" | "),
    );
    scannedLogs.push(
      "[" + labelForLog + "] ⛔ 송장 열을 찾지 못했습니다 — 이 원천의 주문은 매칭 불가.\n" +
        "  헤더(" + _hdrAll_.length + "개): " + _hdrAll_.join(", "),
    );
    _pt_ingestStatPush_({
      label: labelForLog,
      rows: invData.length - 1,
      inv: 0,
      note: "송장 열 탐지 실패",
    });
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
  var invRead = 0;
  for (var i = 1; i < invData.length; i++) {
    var invNum = String(invData[i][invoiceIdx]).trim();
    if (!invNum) continue;
    // 헤더가 두 줄인 원천에서 헤더 글자가 데이터로 섞여 들어오는 것을 막는다
    if (/운송장|송장번호|택배번호/.test(invNum.replace(/\s/g, ""))) continue;
    invRead++;
    var n = nameIdx !== -1 ? String(invData[i][nameIdx]).trim() : "";
    var rawPhone = phoneIdx !== -1 ? String(invData[i][phoneIdx]) : "";
    var p = rawPhone.replace(/[^0-9]/g, "");
    var shortP = p.length >= 4 ? p.substring(p.length - 4) : p;
    var key = n + "_" + shortP;

    var detailBlock = "";
    if (itemIdx !== -1) detailBlock = String(invData[i][itemIdx]);
    else if (invoiceIdx > 0) detailBlock = String(invData[i][invoiceIdx - 1]);
    // ★ 2026-08-27: 출처를 엔트리에 남긴다.
    //   종전 엔트리는 {invRaw, detailRaw} 뿐이어서, 한 맵에 섞인 롯데 자사출고 송장과
    //   협력업체 전용양식 송장을 구분할 수 없었다. 그래서 대리공급 행이 이름 단독 키로
    //   롯데 송장을 주워가는 일이 생겼다. 전용양식 송장은 원천이므로 롯데와 섞어 쓰면 안 된다.
    var invEntry = { invRaw: invNum, detailRaw: detailBlock, src: labelForLog };

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

  // ★ 종전 로그는 이름+전화 키가 만들어진 행만 셌다(matchedRows). 그래서
  //   송장은 제대로 읽혔는데 이름·전화 열이 없는 원천이 '송장 0건'으로 보여
  //   원인을 잘못 짚게 만들었다. 읽은 송장 수와 키 수를 나눠 적는다.
  var _msg_ =
    "[" + labelForLog + "] " + totalDataRows + "행 → 송장 " + invRead +
    "건 읽음 / 이름·전화 키 " + matchedRows + "건";
  if (invRead > 0 && matchedRows === 0) {
    _msg_ += " ⚠ 키 없음 — 고유ID로만 매칭 가능";
  }
  if (invRead === 0) {
    _msg_ += " ⛔ 송장 0건 — 이 원천의 주문은 매칭 불가";
  }
  if (_ingestNote_.length) _msg_ += " (" + _ingestNote_.join(", ") + ")";
  scannedLogs.push(_msg_);

  _pt_ingestStatPush_({
    label: labelForLog,
    rows: totalDataRows,
    inv: invRead,
    keys: matchedRows,
    note: _ingestNote_.join(", "),
  });
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
  return _pt_scoreInvoiceEvidence_(detail, itemName).score;
}

/**
 * 송장 후보의 품목 근거를 점수와 함께 사실 단위로 돌려준다.
 *
 * 종전에는 점수 하나만 내보냈고, 규격 모순은 -1000 이라는 값에 섞여 있었다.
 * 그래서 호출부가 '모순'과 '근거 약함'을 구분할 수 없었고, 후보가 하나뿐이면
 * 모순된 송장까지 그대로 배정됐다. 모순은 점수가 아니라 사실이므로 따로 낸다.
 *
 * @return {{score:number, opposite:boolean, specHit:number, hasInfo:boolean}}
 *   opposite : 규격 토큰이 주문 품목에 없다 → 다른 품목의 송장이다
 *   specHit  : 규격 토큰이 맞은 횟수 (300파이·소·A1 등)
 *   hasInfo  : 비교할 detail·품목명이 있었나 (없으면 판단 자체가 불가)
 */
function _pt_scoreInvoiceEvidence_(detail, itemName) {
  var dRaw = String(detail || "").toUpperCase();
  var item = String(itemName || "").toUpperCase();
  var dtTokens = dRaw.match(/[A-Z0-9가-힣]+/g) || [];
  var score = 0;
  var hasOpposite = false;
  var specHit = 0;
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
      else {
        score += 100;
        specHit++;
      }
    } else if (item.indexOf(tk) !== -1) {
      score += 1;
    }
  }
  if (hasOpposite) score -= 1000;
  return {
    score: score,
    opposite: hasOpposite,
    specHit: specHit,
    hasInfo: !!(dtTokens.length && item),
  };
}

// ═══════════════════════════════════════════
//  송장 배정 근거 통계
//  「어떤 근거로 붙였나」를 수집 보고서에 그대로 싣기 위한 집계.
//  근거를 남기지 않으면 나중에 진단해도 '근거없음'만 나온다.
// ═══════════════════════════════════════════
var _PT_EV_STAT_ = null;

function _pt_evStatReset_() {
  _PT_EV_STAT_ = { strong: 0, plain: 0, weak: 0, blocked: 0, blockedRows: [] };
}

function _pt_evStat_() {
  if (!_PT_EV_STAT_) _pt_evStatReset_();
  return _PT_EV_STAT_;
}

/** 보고서용 요약 문장. 배정이 없으면 빈 문자열 */
function _pt_evStatSummary_() {
  var s = _PT_EV_STAT_;
  if (!s) return "";
  var total = s.strong + s.plain + s.weak;
  if (!total && !s.blocked) return "";
  var pctWeak = total ? Math.round((s.weak / total) * 100) : 0;
  var out =
    "송장 배정 근거: 강함(규격일치) " + s.strong +
    " / 보통 " + s.plain +
    " / 약함(품목근거 없음) " + s.weak + "건";
  if (total && pctWeak >= 30) out += " ⚠ 약함 " + pctWeak + "%";
  if (s.blocked) {
    out += "\n⛔ 품목 모순으로 배정 차단: " + s.blocked + "건 (다른 품목의 송장)";
    if (s.blockedRows.length) {
      out += "\n  " + s.blockedRows.slice(0, 5).join("\n  ");
    }
  }
  return out;
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
  var stat = _pt_evStat_();

  // 1단계: 후보별 품목 근거 판정 + 미사용 필터
  //
  // ★ 2026-08-26: 품목이 모순되는 후보는 여기서 버린다.
  //   종전에는 `isStrict = scored.length > need` 로, 후보가 need 이하일 때만
  //   음수 점수를 걸렀다. 그래서 후보가 하나뿐이면 규격이 다른 송장(300파이 소
  //   주문에 300파이 대 송장)도 그대로 붙었다. 송장을 못 붙이는 것보다
  //   남의 송장을 붙이는 쪽이 훨씬 나쁘다 — 고객이 다른 물건을 받는다.
  //   후보 수와 무관하게 모순은 배정하지 않는다.
  var scored = [];
  var anyPositive = false;
  var blocked = 0;
  for (var cc = 0; cc < candidates.length; cc++) {
    var cand = candidates[cc];
    if (!cand || !cand.inv || globalUsedInvoices[cand.inv]) continue;
    var ev = _pt_scoreInvoiceEvidence_(cand.detail, itemName);
    if (ev.opposite) {
      blocked++;
      continue;
    }
    if (ev.score > 0) anyPositive = true;
    scored.push({
      idx: cc, inv: cand.inv, detail: cand.detail, src: cand.src || "",
      score: ev.score, specHit: ev.specHit, hasInfo: ev.hasInfo,
    });
  }

  if (blocked) {
    stat.blocked += blocked;
    if (stat.blockedRows.length < 30) {
      stat.blockedRows.push(
        "[" + String(hubRow && hubRow[7] ? hubRow[7] : "") + "] " +
          String(itemName).substring(0, 24) + " — 규격 다른 후보 " + blocked + "건 제외",
      );
    }
  }

  // 2단계: 근거가 센 후보 우선 (동일인 2품목이면 각 행이 자기 품목 송장을 먼저 가져감)
  scored.sort(function (a, b) {
    return b.score - a.score;
  });

  for (var n = 0; n < need && scored.length > 0; n++) {
    var best = null;
    var bestIdx = -1;
    for (var si = 0; si < scored.length; si++) {
      var s = scored[si];
      if (globalUsedInvoices[s.inv]) continue; // 이미 소진됨
      best = s;
      bestIdx = si;
      break; // 이미 정렬되어 있으므로 첫 번째가 best
    }
    if (!best) break;
    globalUsedInvoices[best.inv] = true;
    // 사용된 후보를 리스트에서 제거
    if (bestIdx >= 0) scored.splice(bestIdx, 1);

    // 근거 등급 — 나중에 '왜 붙었나'를 되짚을 수 있게 남긴다
    var grade;
    if (best.specHit > 0) { grade = "강함"; stat.strong++; }
    else if (best.score > 0) { grade = "보통"; stat.plain++; }
    else { grade = "약함"; stat.weak++; }

    // ★ detail에서 "---" 뒤의 세트 상세 추출 (예: "JH 300파이 소 백색 ---몸통만" → "몸통만")
    var setDetail = "";
    if (best.detail) {
      var dashIdx = best.detail.indexOf("---");
      if (dashIdx !== -1) {
        setDetail = best.detail.substring(dashIdx + 3).trim();
      }
    }
    picked.push({
      inv: best.inv, setDetail: setDetail, src: best.src || "",
      grade: grade, score: best.score,
      // 품목 근거가 있는 후보가 있는데도 근거 없는 걸 집었다면 특히 의심스럽다
      suspect: grade === "약함" && anyPositive,
    });
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
      // src = 이 송장이 나온 원천 탭 이름. 택배사 판정의 1순위 근거다
      // (로젠주문실적 → 로젠택배, 롯데택배 탭 → 롯데택배).
      out.push({ inv: iv, detail: dt, src: String(matchedArr[m].src || "") });
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
          "실행 계정: " +
          (lock.email || "알 수 없음") +
          "\n" +
          "작업 내용: " +
          (lock.fn || fnLabel) +
          "\n" +
          "시작 시각: " +
          new Date(lock.since).toLocaleTimeString("ko-KR") +
          "\n" +
          "경과 시간: " +
          elapsedMin +
          "분 " +
          elapsedSec +
          "초\n\n" +
          "잠시 후 다시 시도하거나, 15분 이상 경과 시 자동 해제됩니다.";
        try {
          SpreadsheetApp.getUi().alert(msg);
        } catch (e) {}
        return false;
      }
    } catch (e) {
      // 파싱 실패 → 잔여 락 무시
    }
  }

  // 락 없음 또는 만료 → 새 락 설정
  var email = "";
  try {
    email = Session.getActiveUser().getEmail();
  } catch (e) {}
  props.setProperty(
    _SYNC_LOCK_KEY_,
    JSON.stringify({
      email: email,
      fn: fnLabel,
      since: now,
    }),
  );
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

// ══════════════════════════════════════════════════════════
//  [이식] 업체명·거래처코드 맵 헬퍼
//  출처: salesUploadFromIntegratedOrders.gs (독립배포 시스템 삭제 전 이식)
//  _po_resolveVendorCustCd_ 에서 typeof 가드로 호출하는 fallback 함수들
// ══════════════════════════════════════════════════════════

function sanitizeVendorText_(value) {
  var s = String(value == null ? "" : value);
  if (!s) return "";
  s = s.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ");
  if (s.normalize) s = s.normalize("NFKC");
  return s.replace(/\s+/g, " ").trim();
}

function sanitizeCustCode_(value) {
  var s = String(value == null ? "" : value)
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .trim();
  if (!s) return "";
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s;
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
      if (
        baseNorm === kn ||
        baseNorm.indexOf(kn) !== -1 ||
        kn.indexOf(baseNorm) !== -1
      ) {
        return vendorMap[k];
      }
    }
  }
  return null;
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

// ═══════════════════════════════════════════
//  공통: 탭 키 셀 관리 (마감탭 식별용)
//  ★ 2026-06-13 통합 — _pms_setKey_/_pea_setKey_ 중복 제거
// ═══════════════════════════════════════════

/**
 * 탭의 지정 셀에 식별 키를 기록 (글자색 흰색으로 숨김)
 * @param {Sheet} tab - 대상 시트
 * @param {string} key - 기록할 키 문자열
 * @param {string} [cell="AZ1"] - 키를 기록할 셀 주소
 */
function _pt_setTabKey_(tab, key, cell) {
  cell = cell || "AZ1";
  try {
    tab.getRange(cell).setValue(key).setFontColor("white");
  } catch (e) {}
}

/**
 * 스프레드시트의 모든 탭에서 지정 셀에 키 값이 일치하는 탭을 찾아 반환
 * @param {Spreadsheet} ss - 대상 스프레드시트
 * @param {string} key - 찾을 키 문자열
 * @param {string} [cell="AZ1"] - 키가 기록된 셀 주소
 * @return {Sheet|null} 일치하는 탭 또는 null
 */
function _pt_findTabByKey_(ss, key, cell) {
  cell = cell || "AZ1";
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    try {
      if (String(sheets[i].getRange(cell).getValue() || "").trim() === key)
        return sheets[i];
    } catch (e) {}
  }
  return null;
}

