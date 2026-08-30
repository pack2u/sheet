/**
 * [Pack2U] 전용발주 마감 → 이카운트 구매입력 변환기
 * 파일: _ecountPurchaseFromExclusive.gs
 *
 * ★ 흐름 ★
 *   각 협력업체 파일의 「(YYYY년 M월) 전용발주 마감」탭
 *     → 설정 B5/B6 에서 거래처명·거래처코드 획득
 *     → 업체상품명/업체상품코드 를 HUB「누적품목매핑」으로 역변환 → 이카운트코드
 *     → 이카운트코드로 「상품정보」 W열(매입가, VAT포함) 조회 → 단가
 *     → 금액 = 단가 × 수량, 공급가액 = ROUND(금액/1.1), 부가세 = 금액 - 공급가액
 *     → 허브(상품정보시트) 「이카운트-구매입력변환」탭에 기록
 *     → 「업체 × 일자」 세트마다 하단에 택배비(상품정보 O열) 집계행 삽입
 *
 * ★ 주의 ★
 *   전용양식 헤더는 업체마다 전부 다르다(태양=박스수량, 코라마=수량, 올팩=수량(A타입) …).
 *   따라서 고정 열 인덱스를 쓰지 않고 헤더명 키워드로 해석한다.
 *   해석 실패 행은 버리지 않고 AA열(변환상태)에 사유를 남긴다.
 */

// ── 탭 이름 ──────────────────────────────────────────────
var _EPX_OUT_TAB_        = "이카운트-구매입력변환";
var _EPX_MAP_TAB_        = "누적품목매핑";
var _EPX_PRODUCT_TAB_    = "상품정보";
var _EPX_CUST_TAB_       = "거래처정보";
var _EPX_ARCHIVE_SUFFIX_ = "전용발주 마감";

// ── 상품정보 레이아웃 (헤더 4행 / 데이터 6행~, 0-based 열) ──
var _EPX_PI_HEADER_ROW_ = 4;
var _EPX_PI_DATA_ROW_   = 6;
var _EPX_PI_C_NAME_ = 2;  // C 이카운트상품명
var _EPX_PI_C_CODE_ = 4;  // E 이카운트코드
var _EPX_PI_C_SIZE_ = 8;  // I 사이즈 → 규격
var _EPX_PI_C_SHIP_ = 14; // O 배송비
var _EPX_PI_C_BUY_  = 22; // W 매입가 (VAT 포함)
var _EPX_PI_LAST_C_ = 23; // W까지만 읽는다 (상품정보는 40열 이상이라 전폭 읽기 금지)

// ── 업체 설정 탭 ──
var _EPX_SET_TAB_       = "설정";
var _EPX_SET_NAME_CELL_ = "B5"; // 거래처명
var _EPX_SET_CUST_CELL_ = "B6"; // 거래처코드(CUST_CD)

// ── 구매입력 양식 25열 (A~Y) ──
var _EPX_HEADERS_ = [
  "일자", "순번", "거래처코드", "거래처명", "담당자", "입고창고", "거래유형", "통화", "환율", "전잔",
  "품목코드", "품목명", "규격", "수량", "단가", "외화금액", "공급가액", "부가세", "금액", "적요",
  "구매거래처", "발송택배사", "송장번호", "부대비용", "결과"
];
// 진단열 (AA~AC) — 업로드 대상 A:X 밖에 두어 붙여넣기를 방해하지 않는다
var _EPX_DIAG_START_COL_ = 27; // AA
var _EPX_DIAG_HEADERS_   = ["변환상태", "원본품목명", "업체파일", "배송비(O열)", "택배사"];
var _EPX_DIAG_SHIP_IDX_  = 3;  // 진단열 내 배송비 위치 (finalize의 택배비 집계 근거)

var _EPX_VAT_DIVISOR_ = 1.1;

// 택배비 집계행에 찍는 이카운트 품목코드
var _EPX_SHIP_ITEM_CODE_ = "LGTB00001";

// ── 매핑 기준 소스: 통합 관리 HUB 의 「누적품목매핑」 탭 (gid 고정) ──
//   ★ 유일한 기준. 상품정보 시트에도 동명 탭이 있으나 내용이 갈라져 있어 쓰지 않는다.
//   A=팩투유상품코드 B=팩투유상품명 C=업체상품명 D=업체상품코드 E=단가 F=부가세 G=VAT포함가
var _EPX_HUB_FALLBACK_ID_  = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";
var _EPX_HUB_FALLBACK_GID_ = 1023073346;

// ── 연속 실행(6분 한도 회피) ──
var _EPX_CURSOR_KEY_ = "_EPX_CURSOR_STATE";
var _EPX_MAX_MS_     = 4.5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════
//  메뉴 진입점
// ═══════════════════════════════════════════════════════════

/** 🧾 전용마감 → 이카운트 구매입력 변환 */
function buildEcountPurchaseFromExclusiveOwner() {
  var ui = SpreadsheetApp.getUi();

  if (typeof isAdminUser_ === "function" && !isAdminUser_()) {
    ui.alert("권한 없음", "이 시트의 편집 권한자만 실행할 수 있습니다.", ui.ButtonSet.OK);
    return;
  }

  var state = _epx_loadCursor_();
  var ym;

  if (state && state.ym) {
    var cont = ui.alert(
      "이어서 실행",
      "중단된 변환이 있습니다.\n\n대상: " + state.ym +
        "\n진행: " + state.idx + "번째 파일까지 완료\n\n" +
        "[예] 이어서 진행   [아니오] 처음부터 새로 시작",
      ui.ButtonSet.YES_NO_CANCEL
    );
    if (cont === ui.Button.CANCEL) return;
    if (cont === ui.Button.YES) {
      ym = state.ym;
    } else {
      _epx_clearCursor_();
      state = null;
    }
  }

  if (!ym) {
    var def = _epx_defaultYm_();
    var rs = ui.prompt(
      "전용마감 → 구매입력 변환",
      "변환할 년월을 YYYY-MM 형식으로 입력하세요.\n(예: " + def + ")\n\n" +
        "해당 월의 「(YYYY년 M월) 전용발주 마감」탭을 가진\n모든 협력업체 파일을 읽습니다.",
      ui.ButtonSet.OK_CANCEL
    );
    if (rs.getSelectedButton() !== ui.Button.OK) return;
    ym = String(rs.getResponseText() || "").trim() || def;
    if (!/^\d{4}-\d{1,2}$/.test(ym)) {
      ui.alert("형식 오류", "YYYY-MM 형식으로 입력해주세요. (예: 2026-08)", ui.ButtonSet.OK);
      return;
    }
    state = null;
  }

  var res;
  try {
    res = _epx_run_(ym, state);
  } catch (e) {
    ui.alert("변환 오류", String(e && e.message ? e.message : e), ui.ButtonSet.OK);
    return;
  }

  ui.alert(res.title, res.message, ui.ButtonSet.OK);
}

/**
 * 🔍 매핑 소스 진단
 * 기준 소스인 HUB 「누적품목매핑」에서 어떤 열을 코드/조회키로 인식했는지 보여준다.
 * 변환 전에 이걸로 먼저 확인할 것.
 */
function diagnoseEcountPurchaseAliasOwner() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];

  lines.push("기준 소스: HUB " + _EPX_HUB_FALLBACK_ID_.substring(0, 12) + "…  gid=" + _EPX_HUB_FALLBACK_GID_);
  lines.push("(상품정보 시트의 동명 탭은 사용하지 않습니다)");
  lines.push("");

  var m;
  try {
    var map = _epx_loadAliasMap_();
    m = map.meta;

    if (!m.ok) {
      lines.push("✗ 읽기 실패: " + (m.error || "원인 미상"));
      ui.alert("🔍 매핑 소스 진단", lines.join("\n"), ui.ButtonSet.OK);
      return;
    }

    lines.push("① 탭 인식");
    lines.push("   탭명: " + m.tab);
    lines.push("   유효 행수: " + map.count);
    lines.push("   헤더: " + m.headers.slice(0, 10).join(" | "));
    lines.push("");
    lines.push("② 열 판별 결과");
    lines.push("   ▶ 품목코드(결과값): " + m.cols.code);
    lines.push("   ▶ 조회키 · 업체상품코드: " + m.cols.vendorCode);
    lines.push("   ▶ 조회키 · 업체상품명  : " + m.cols.vendorName);
    lines.push("   ▶ 조회키 · 팩투유상품명: " + m.cols.packName);
    lines.push("");
    lines.push("③ 조회 가능 키 수");
    lines.push("   업체상품코드/코드자체: " + Object.keys(map.byVendorCode).length);
    lines.push("   업체상품명: " + Object.keys(map.byVendorName).length);
    lines.push("   팩투유상품명: " + Object.keys(map.byPackName).length);

    var ambKeys = Object.keys(map.ambiguous);
    lines.push("");
    lines.push("④ 중복(모호) — 자동 결정하지 않고 ⚠ 로 남김: " + ambKeys.length + "건");
    for (var ai = 0; ai < Math.min(ambKeys.length, 15); ai++) {
      var a = map.ambiguous[ambKeys[ai]];
      lines.push("   · " + String(a.raw).substring(0, 32) + "  →  " + a.codes.join(" / "));
    }
    if (ambKeys.length > 15) lines.push("   … 외 " + (ambKeys.length - 15) + "건");
  } catch (e) {
    lines.push("✗ " + String(e && e.message ? e.message : e));
  }

  lines.push("");
  lines.push("※ ② 의 열 판별이 엉뚱하면 알려주세요. 규칙을 고정하겠습니다.");

  ui.alert("🔍 매핑 소스 진단", lines.join("\n"), ui.ButtonSet.OK);
}

/**
 * 📋 변환 실패 사유 리포트
 * 「이카운트-구매입력변환」탭에서 품목코드가 비어 있는 행을 사유별로 묶어
 * 「변환실패_사유」탭에 적는다. 무엇을 고쳐야 하는지 바로 보이게 하는 용도.
 */
function reportEcountPurchaseFailuresOwner() {
  var ui = SpreadsheetApp.getUi();
  var hub = SpreadsheetApp.getActiveSpreadsheet();

  var src = hub.getSheetByName(_EPX_OUT_TAB_);
  if (!src || src.getLastRow() < 2) {
    ui.alert("먼저 변환을 실행하세요", "「" + _EPX_OUT_TAB_ + "」탭에 데이터가 없습니다.", ui.ButtonSet.OK);
    return;
  }

  var lr = src.getLastRow();
  var main = src.getRange(2, 1, lr - 1, _EPX_HEADERS_.length).getValues();
  var diag = src.getRange(2, _EPX_DIAG_START_COL_, lr - 1, _EPX_DIAG_HEADERS_.length).getValues();

  var groups = {}, total = 0, failed = 0;
  for (var i = 0; i < main.length; i++) {
    var st = String(diag[i][0] || "");
    if (!String(main[i][0] || "").trim()) continue;
    if (st.indexOf("집계") === 0) continue;
    total++;

    var hasCode = String(main[i][10] || "").trim() !== "";
    if (hasCode && st.indexOf("⚠") === -1) continue;
    failed++;

    // 사유는 코드 부분만 남겨 묶는다 ("⚠ 매핑 중복: A / B" → "⚠ 매핑 중복")
    var reason = st.split(":")[0].trim() || (hasCode ? "기타" : "⚠ 코드 없음");
    if (!groups[reason]) groups[reason] = { n: 0, rows: [] };
    groups[reason].n++;
    if (groups[reason].rows.length < 200) {
      groups[reason].rows.push([
        reason, st, String(diag[i][1] || ""), String(main[i][3] || ""),
        String(diag[i][2] || ""), String(main[i][0] || ""), main[i][13]
      ]);
    }
  }

  // ── 결과 탭 ──
  var out = hub.getSheetByName("변환실패_사유");
  if (!out) out = hub.insertSheet("변환실패_사유");
  out.clear();

  var HDR = ["사유", "상세", "원본품목명", "거래처명", "업체파일", "일자", "수량"];
  var body = [];
  var keys = Object.keys(groups).sort(function (a, b) { return groups[b].n - groups[a].n; });
  for (var k = 0; k < keys.length; k++) {
    body.push(["── " + keys[k] + " : " + groups[keys[k]].n + "건 ──", "", "", "", "", "", ""]);
    var rows = groups[keys[k]].rows;
    for (var r = 0; r < rows.length; r++) body.push(rows[r]);
    if (groups[keys[k]].n > rows.length) {
      body.push(["", "… 외 " + (groups[keys[k]].n - rows.length) + "건 생략", "", "", "", "", ""]);
    }
    body.push(["", "", "", "", "", "", ""]);
  }

  out.getRange(1, 1, 1, HDR.length).setValues([HDR])
    .setBackground("#1f4e78").setFontColor("#ffffff").setFontWeight("bold");
  out.setFrozenRows(1);
  if (body.length) {
    if (out.getMaxRows() < body.length + 2) out.insertRowsAfter(out.getMaxRows(), body.length + 2 - out.getMaxRows());
    out.getRange(2, 1, body.length, HDR.length).setValues(body);
  }
  out.setColumnWidth(1, 210); out.setColumnWidth(2, 260); out.setColumnWidth(3, 300);

  var msg = "전체 품목행: " + total + "건" + "\n" +
            "코드 미입력/경고: " + failed + "건" + "\n" +
            "─────────────────────" + "\n";
  for (var m = 0; m < keys.length; m++) msg += keys[m] + " : " + groups[keys[m]].n + "건" + "\n";
  if (!keys.length) msg += "실패 없음 ✅" + "\n";
  msg += "\n" + "상세는 「변환실패_사유」탭에 적었습니다.";

  ui.alert("📋 변환 실패 사유", msg, ui.ButtonSet.OK);
}

/**
 * 🧾 미등록 코드 목록
 * HUB 누적품목매핑이 가리키는 코드 중 상품정보에 없는 것을 모아
 * 「미등록코드_목록」탭에 적는다. 상품정보/이카운트에 등록할 대상 명세.
 *
 * 같은 업체상품명을 쓰는 "짝 코드"가 상품정보에 있으면 참고용으로 함께 보여준다.
 * (예: AJBC80004 미등록 ↔ AJBC20003 등록됨, 매입가 41,580)
 */
function reportEcountMissingCodesOwner() {
  var ui = SpreadsheetApp.getUi();
  var hub = SpreadsheetApp.getActiveSpreadsheet();

  var tab = _epx_getHubMapTab_();
  if (!tab) { ui.alert("HUB 누적품목매핑 탭을 찾지 못했습니다."); return; }

  var prodMap = _epx_loadProductMap_(hub);
  if (!prodMap.count) { ui.alert("상품정보 탭을 읽지 못했습니다."); return; }

  var data = tab.getRange(1, 1, tab.getLastRow(), tab.getLastColumn()).getValues();
  var hdr = data[0];
  var cCode = 0, cPack = 1, cVend = 2, cVCode = 3;
  for (var h = 0; h < hdr.length; h++) {
    var s = String(hdr[h] || "").replace(/\s/g, "").toLowerCase();
    if ((s.indexOf("팩투유") !== -1 || s.indexOf("이카운트") !== -1) && s.indexOf("코드") !== -1) cCode = h;
    else if ((s.indexOf("팩투유") !== -1 || s.indexOf("이카운트") !== -1) && s.indexOf("상품명") !== -1) cPack = h;
    else if (s.indexOf("업체") !== -1 && s.indexOf("코드") !== -1) cVCode = h;
    else if (s.indexOf("업체") !== -1 && s.indexOf("상품명") !== -1) cVend = h;
  }

  // 업체상품명 → 그 이름을 쓰는 코드들 (짝 찾기용)
  var byVend = {};
  for (var r1 = 1; r1 < data.length; r1++) {
    var k = _epx_norm_(data[r1][cVend]);
    if (!k) continue;
    if (!byVend[k]) byVend[k] = [];
    byVend[k].push(String(data[r1][cCode] || "").trim());
  }

  var body = [], seen = {}, proxyMiss = 0;
  for (var r = 1; r < data.length; r++) {
    var code = String(data[r][cCode] || "").trim();
    if (!code || seen[code]) continue;
    if (prodMap.byCode[code]) continue;   // 등록돼 있으면 대상 아님
    seen[code] = true;

    var pack = String(data[r][cPack] || "");
    var vend = String(data[r][cVend] || "");
    var isProxy = pack.indexOf("대리발송") !== -1;
    if (isProxy) proxyMiss++;

    // 짝 코드 — 같은 업체상품명을 쓰면서 상품정보에 등록된 코드
    var mate = "", mateBuy = "", mateShip = "";
    var sibs = byVend[_epx_norm_(vend)] || [];
    for (var s2 = 0; s2 < sibs.length; s2++) {
      if (sibs[s2] === code) continue;
      var p = prodMap.byCode[sibs[s2]];
      if (p) { mate = sibs[s2]; mateBuy = p.buy; mateShip = p.ship; break; }
    }

    body.push([
      code, isProxy ? "대리발송용" : "", pack, vend,
      String(data[r][cVCode] || ""), mate, mateBuy, mateShip,
      mate ? "짝 코드 참고" : "짝 없음 — 개별 확인 필요"
    ]);
  }

  body.sort(function (a, b) {
    if (a[1] !== b[1]) return a[1] ? -1 : 1;   // 대리발송용 먼저
    return String(a[0]).localeCompare(String(b[0]));
  });

  var out = hub.getSheetByName("미등록코드_목록");
  if (!out) out = hub.insertSheet("미등록코드_목록");
  out.clear();
  var HDR = ["미등록 코드", "구분", "팩투유상품명", "업체상품명", "업체상품코드",
             "짝 코드", "짝 매입가(W)", "짝 배송비(O)", "비고"];
  out.getRange(1, 1, 1, HDR.length).setValues([HDR])
    .setBackground("#1f4e78").setFontColor("#ffffff").setFontWeight("bold");
  out.setFrozenRows(1);
  if (body.length) {
    if (out.getMaxRows() < body.length + 2) out.insertRowsAfter(out.getMaxRows(), body.length + 2 - out.getMaxRows());
    out.getRange(2, 1, body.length, HDR.length).setValues(body);
    out.getRange(2, 7, body.length, 2).setNumberFormat("#,##0");
  }
  out.setColumnWidth(3, 300); out.setColumnWidth(4, 240);

  ui.alert(
    "🧾 미등록 코드 목록",
    "HUB 누적품목매핑 코드 중 상품정보에 없는 것" + "\n" +
    "─────────────────────" + "\n" +
    "전체: " + body.length + "건" + "\n" +
    "그중 (대리발송용): " + proxyMiss + "건" + "\n" + "\n" +
    "「미등록코드_목록」탭에 적었습니다." + "\n" +
    "짝 코드가 있으면 그 매입가를 참고해 등록하시면 됩니다.",
    ui.ButtonSet.OK
  );
}

/** 기본 대상 월 = 지난달 */
function _epx_defaultYm_() {
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
}

// ═══════════════════════════════════════════════════════════
//  본체
// ═══════════════════════════════════════════════════════════

function _epx_run_(ym, resumeState) {
  var startMs = Date.now();
  var hub = SpreadsheetApp.getActiveSpreadsheet();

  var parts = ym.split("-");
  var yyyy = parseInt(parts[0], 10);
  var mm = parseInt(parts[1], 10);
  var tabName = "(" + yyyy + "년 " + mm + "월) " + _EPX_ARCHIVE_SUFFIX_;

  // ── 마스터 3종 로드 (허브에서 1회만) ──
  var aliasMap = _epx_loadAliasMap_();
  var prodMap  = _epx_loadProductMap_(hub);
  var maps = {
    custMap:      _epx_loadCustMap_(hub),
    vendorMaster: _epx_loadVendorMasterMap_(hub),
    carrier:      _epx_loadCarrierMap_(hub)
  };

  if (!aliasMap.count) {
    throw new Error(
      "HUB 「누적품목매핑」을 읽지 못했습니다.\ngid=" + _EPX_HUB_FALLBACK_GID_ +
      " / " + (aliasMap.meta.error || "원인 미상") +
      "\n\n메뉴의 「🔍 변환 매핑 소스 진단」을 먼저 실행해보세요."
    );
  }
  if (!prodMap.count) {
    throw new Error("「" + _EPX_PRODUCT_TAB_ + "」탭을 찾을 수 없거나 데이터가 없습니다.");
  }

  var files = _pt_listFiles();
  if (!files || !files.length) throw new Error("협력업체 파일 목록을 가져오지 못했습니다.");

  var outTab = _epx_ensureOutTab_(hub, !resumeState);

  var startIdx = resumeState ? resumeState.idx : 0;
  var stats = resumeState
    ? resumeState.stats
    : { files: 0, hit: 0, rows: 0, noCode: 0, noPrice: 0, noQty: 0, noTab: 0, noCust: 0 };
  var warnings = resumeState ? (resumeState.warnings || []) : [];

  var pending = [];
  var i = startIdx;
  var timedOut = false;

  for (; i < files.length; i++) {
    if (Date.now() - startMs > _EPX_MAX_MS_) { timedOut = true; break; }

    var fileInfo = files[i];
    var vss;
    try {
      vss = SpreadsheetApp.openById(fileInfo.id); // ★ 파일당 1회만
    } catch (eOpen) {
      warnings.push("[" + fileInfo.name + "] 파일 열기 실패: " + eOpen.message);
      continue;
    }

    var archTab = vss.getSheetByName(tabName);
    if (!archTab) {
      // 탭명이 바뀐 경우 AZ1 키로 폴백
      try {
        if (typeof _pea_findTabByKey_ === "function") {
          archTab = _pea_findTabByKey_(vss, _PEA_KEY_PREFIX + tabName);
        }
      } catch (eKey) {}
    }
    if (!archTab || archTab.getLastRow() < 2) { stats.noTab++; continue; }

    // ── 거래처명 / 거래처코드 ──
    var ident = _epx_readVendorIdentity_(vss, fileInfo, maps);
    var vendorCarrier = _epx_carrierOf_(maps.carrier, ident.custNm, fileInfo.name);
    if (!ident.custCd) {
      stats.noCust++;
      warnings.push("[" + fileInfo.name + "] 거래처코드 없음 — 설정 탭 " + _EPX_SET_CUST_CELL_ + " 확인 필요");
    }

    // ── 마감탭 읽기 ──
    var lr = archTab.getLastRow();
    var lc = archTab.getLastColumn();
    var data = archTab.getRange(1, 1, lr, lc).getValues();
    var headers = data[0];
    var cols = _epx_resolveColumns_(headers);

    if (cols.itemName < 0 && cols.itemCode < 0) {
      warnings.push("[" + fileInfo.name + "] 품목명/품목코드 열을 찾지 못함 → 건너뜀");
      continue;
    }
    if (cols.qty < 0) {
      warnings.push("[" + fileInfo.name + "] 수량 열을 찾지 못함 → 수량 1로 처리");
    }

    stats.files++;
    var fileRows = 0;

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var rawName = cols.itemName >= 0 ? String(row[cols.itemName] || "").trim() : "";
      var rawCode = cols.itemCode >= 0 ? String(row[cols.itemCode] || "").trim() : "";
      if (!rawName && !rawCode) continue;

      var qty = cols.qty >= 0 ? _epx_num_(row[cols.qty]) : 1;
      if (!qty) { stats.noQty++; qty = 0; }

      var dateStr = _epx_resolveDate_(row, cols, yyyy, mm);

      // ── 역변환: 업체상품코드 → 업체상품명 → 팩투유(이카운트)코드 ──
      var lookup = _epx_reverseLookup_(aliasMap, prodMap, rawCode, rawName);
      var ecCode = lookup.code;
      var status = lookup.status;

      var prod = ecCode ? prodMap.byCode[ecCode] : null;
      if (!ecCode) {
        stats.noCode++;
      } else if (!prod) {
        status = aliasMap.isProxy[ecCode]
          ? "⚠ 대리발송용 코드 상품정보 미등록: " + ecCode
          : "⚠ 상품정보 미등록: " + ecCode;
        stats.noPrice++;
      }

      var unit = prod ? _epx_num_(prod.buy) : 0;
      if (prod && !unit) { status = status || "⚠ W열 매입가 0/공란"; stats.noPrice++; }

      var amount = Math.round(unit * qty);           // 금액 = 단가(VAT포함) × 수량
      var supply = Math.round(amount / _EPX_VAT_DIVISOR_); // 공급가액
      var vat    = amount - supply;                   // 부가세

      pending.push({
        date:    dateStr,
        custCd:  ident.custCd,
        custNm:  ident.custNm,
        code:    ecCode,
        name:    prod ? prod.name : rawName,
        spec:    prod ? prod.spec : "",
        qty:     qty,
        unit:    unit,
        supply:  supply,
        vat:     vat,
        amount:  amount,
        ship:    prod ? _epx_num_(prod.ship) : 0,
        memo:    "",
        buyer:   cols.receiver >= 0 ? String(row[cols.receiver] || "").trim() : "",
        carrier: vendorCarrier,
        invoice: cols.invoice >= 0 ? String(row[cols.invoice] || "").trim() : "",
        status:  status || "OK",
        rawName: rawName || rawCode,
        file:    fileInfo.name
      });
      fileRows++;
    }

    stats.rows += fileRows;
    if (fileRows) stats.hit++;
  }

  // ── 수집분 임시 기록 (중단되어도 유실 없음) ──
  if (pending.length) _epx_appendRaw_(outTab, pending);

  if (timedOut) {
    _epx_saveCursor_({ ym: ym, idx: i, stats: stats, warnings: warnings.slice(0, 50) });
    return {
      title: "⏸ 일시 중단 (시간 한도)",
      message:
        "처리한 파일: " + i + " / " + files.length + "\n" +
        "누적 수집 행: " + stats.rows + "건\n\n" +
        "6분 한도 회피를 위해 중단했습니다.\n" +
        "같은 메뉴를 다시 실행하고 [예]를 누르면 이어서 진행합니다."
    };
  }

  // ── 전부 처리 완료 → 정렬 + 순번 + 택배비 집계 ──
  _epx_clearCursor_();
  var fin = _epx_finalize_(outTab);

  var msg =
    "대상 월: " + ym + "\n" +
    "탭: " + _EPX_OUT_TAB_ + "\n" +
    "매핑 기준: HUB 「" + aliasMap.meta.tab + "」 " + aliasMap.count + "행\n" +
    "─────────────────────\n" +
    "읽은 업체 파일: " + stats.files + "개 (데이터 있음 " + stats.hit + "개)\n" +
    "변환 품목 행: " + stats.rows + "건\n" +
    "택배비 집계 행: " + fin.shipRows + "건\n" +
    "─────────────────────\n" +
    "⚠ 코드 미매칭: " + stats.noCode + "건\n" +
    "⚠ 매입가 없음: " + stats.noPrice + "건\n" +
    "⚠ 수량 공란: " + stats.noQty + "건\n" +
    "⚠ 마감탭 없음: " + stats.noTab + "개 파일\n" +
    "⚠ 거래처코드 없음: " + stats.noCust + "개 파일";

  if (warnings.length) {
    msg += "\n\n[상세]\n" + warnings.slice(0, 12).join("\n");
    if (warnings.length > 12) msg += "\n… 외 " + (warnings.length - 12) + "건";
  }
  msg += "\n\n※ 업로드 전 AA열(변환상태)에서 ⚠ 표시 행을 먼저 정리하세요.";

  return { title: "✅ 변환 완료", message: msg };
}

// ═══════════════════════════════════════════════════════════
//  마스터 로드
// ═══════════════════════════════════════════════════════════

/**
 * 「누적품목매핑」 역변환 맵 — 기준 소스는 통합 관리 HUB 의 탭 하나뿐이다.
 *
 *   HUB (1qRIEw…) gid=1023073346 「누적품목매핑」
 *   A=팩투유상품코드  B=팩투유상품명  C=업체상품명  D=업체상품코드  E=단가  F=부가세  G=VAT포함가
 *
 * 상품정보 시트에도 같은 이름의 탭이 있지만 내용이 갈라져 있어 읽지 않는다.
 * 열 위치는 헤더명으로 판별한다 — 열 순서가 바뀌어도 견디게 하기 위함.
 * 같은 키가 서로 다른 코드로 등록되면 임의로 고르지 않고 ambiguous 로 남긴다.
 */
function _epx_loadAliasMap_() {
  var out = {
    byVendorCode: {}, byVendorName: {}, byPackName: {},
    isProxy: {}, ambiguous: {}, count: 0, proxyWins: 0,
    meta: { ok: false, tab: "", headers: [], cols: {} }
  };

  var tab = _epx_getHubMapTab_();
  if (!tab) { out.meta.error = "gid=" + _EPX_HUB_FALLBACK_GID_ + " 탭을 찾을 수 없음"; return out; }

  out.meta.tab = tab.getName();
  var lr = tab.getLastRow(), lc = tab.getLastColumn();
  if (lr < 2) { out.meta.error = "데이터 없음"; return out; }

  var data = tab.getRange(1, 1, lr, lc).getValues();
  var hdr = data[0];
  for (var h = 0; h < hdr.length; h++) out.meta.headers.push(String(hdr[h] || ""));

  // ── 열 판별 ──
  var cCode = -1, cPackName = -1, cVendorName = -1, cVendorCode = -1;
  for (var c = 0; c < hdr.length; c++) {
    var s = String(hdr[c] || "").replace(/\s/g, "").toLowerCase();
    if (!s) continue;
    if (cCode === -1 && (s.indexOf("팩투유") !== -1 || s.indexOf("이카운트") !== -1) && s.indexOf("코드") !== -1) cCode = c;
    else if (cPackName === -1 && (s.indexOf("팩투유") !== -1 || s.indexOf("이카운트") !== -1) && (s.indexOf("상품명") !== -1 || s.indexOf("품목명") !== -1)) cPackName = c;
    else if (cVendorCode === -1 && s.indexOf("업체") !== -1 && s.indexOf("코드") !== -1) cVendorCode = c;
    else if (cVendorName === -1 && s.indexOf("업체") !== -1 && (s.indexOf("상품명") !== -1 || s.indexOf("품목명") !== -1)) cVendorName = c;
  }
  if (cCode === -1) cCode = 0; // A열이 품목코드
  out.meta.cols = {
    code:       out.meta.headers[cCode] || "(A열)",
    packName:   cPackName   >= 0 ? out.meta.headers[cPackName]   : "(없음)",
    vendorName: cVendorName >= 0 ? out.meta.headers[cVendorName] : "(없음)",
    vendorCode: cVendorCode >= 0 ? out.meta.headers[cVendorCode] : "(없음)"
  };

  function put(bucket, key, code, raw) {
    if (!key || !code) return;
    var amb = out.ambiguous[key];
    if (amb) {
      if (amb.codes.indexOf(code) === -1) amb.codes.push(code);
      delete bucket[key];            // 확정 전까지 어느 버킷에서도 답하지 않는다
      return;
    }
    if (bucket[key] && bucket[key] !== code) {
      // ★ 같은 이름에 코드가 둘이면 「(대리발송)」이 붙은 쪽을 쓴다.
      var prevProxy = !!out.isProxy[bucket[key]];
      var curProxy  = !!out.isProxy[code];
      if (curProxy && !prevProxy) { bucket[key] = code; return; }
      if (prevProxy && !curProxy) { return; }
      // 판단 불가 → 후보만 모아두고 버킷에서 뺀다.
      //   임의로 첫 코드를 돌려주면 조용히 틀린 전표가 만들어진다.
      out.ambiguous[key] = { codes: [bucket[key], code], raw: String(raw || key) };
      delete bucket[key];
      return;
    }
    bucket[key] = code;
  }

  for (var r = 1; r < data.length; r++) {
    var code = String(data[r][cCode] || "").trim();
    if (!code) continue;

    // 「(대리발송)」이 붙은 행의 코드를 우선 코드로 표시해 둔다 (충돌 해소용)
    var packNm = cPackName >= 0 ? String(data[r][cPackName] || "") : "";
    if (packNm.indexOf("대리발송") !== -1 || code.indexOf("대리발송") !== -1) out.isProxy[code] = true;

    // 코드 자체도 조회키 — 마감탭에 이미 이카운트코드가 들어있는 양식(뉴파츠 등) 대비
    put(out.byVendorCode, _epx_norm_(code), code, code);
    if (cVendorCode >= 0) put(out.byVendorCode, _epx_norm_(data[r][cVendorCode]), code, data[r][cVendorCode]);
    // ★ 색인은 원문 그대로. "----뚜껑만" 처럼 품목을 구분하는 꼬리를 잘라내면
    //   서로 다른 코드가 같은 키로 뭉개져 매핑 중복이 된다.
    //   쇼핑몰 꼬리(---배민 등) 흡수는 조회할 때 2차 시도로 처리한다.
    if (cVendorName >= 0) put(out.byVendorName, _epx_norm_(data[r][cVendorName]), code, data[r][cVendorName]);
    if (cPackName   >= 0) put(out.byPackName,   _epx_norm_(packNm), code, packNm);
    out.count++;
  }
  out.meta.ok = true;
  return out;
}

/** HUB 의 누적품목매핑 탭 (gid 고정) */
function _epx_getHubMapTab_() {
  var ss = SpreadsheetApp.openById(_EPX_HUB_FALLBACK_ID_);
  if (typeof _pt_getSheetByGid === "function") {
    var t = _pt_getSheetByGid(ss, _EPX_HUB_FALLBACK_GID_);
    if (t) return t;
  }
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === _EPX_HUB_FALLBACK_GID_) return sheets[i];
  }
  return null;
}

/** 「상품정보」 코드 → {품목명, 규격, 배송비O, 매입가W} */
function _epx_loadProductMap_(hub) {
  var out = { byCode: {}, byName: {}, count: 0 };
  var tab = hub.getSheetByName(_EPX_PRODUCT_TAB_);
  if (!tab) return out;

  var lr = tab.getLastRow();
  if (lr < _EPX_PI_DATA_ROW_) return out;

  var rows = tab
    .getRange(_EPX_PI_DATA_ROW_, 1, lr - _EPX_PI_DATA_ROW_ + 1, _EPX_PI_LAST_C_)
    .getValues();

  for (var i = 0; i < rows.length; i++) {
    var code = _epx_padCode_(rows[i][_EPX_PI_C_CODE_]);
    if (!code) continue;
    var nm = String(rows[i][_EPX_PI_C_NAME_] || "").trim();
    if (!out.byCode[code]) {
      out.byCode[code] = {
        name: nm,
        spec: String(rows[i][_EPX_PI_C_SIZE_] || "").trim(),
        ship: rows[i][_EPX_PI_C_SHIP_],
        buy:  rows[i][_EPX_PI_C_BUY_]
      };
      out.count++;
    }
    // 우리 품목명(이카운트상품명) → 코드. 마감탭에 우리 품목명이 그대로 들어온 경우 대비.
    var key = _epx_norm_(nm);
    if (key && !out.byName[key]) out.byName[key] = code;
  }
  return out;
}

/**
 * 거래처코드 마스터 — 상품정보「업체등급단가매핑」
 *   A=거래처명  B=거래처코드(CUST_CD)  D=배포시트ID
 * 배포시트ID 로 파일을 직접 맞출 수 있어 이름 표기 차이에 흔들리지 않는다.
 */
function _epx_loadVendorMasterMap_(hub) {
  var out = { byFileId: {}, byName: {}, count: 0 };
  var tab = hub.getSheetByName(VENDOR_CUST_MAP_SHEET_NAME);
  if (!tab || tab.getLastRow() < 2) return out;

  var data = tab.getRange(1, 1, tab.getLastRow(), 4).getDisplayValues();
  for (var i = 1; i < data.length; i++) {
    var nm = String(data[i][0] || "").trim();
    var cd = _epx_cleanCustCd_(data[i][1]);
    var fid = String(data[i][3] || "").trim();
    if (!cd) continue;
    var rec = { custCd: cd, custNm: nm };
    if (fid && !out.byFileId[fid]) out.byFileId[fid] = rec;
    var key = _epx_norm_(nm);
    if (key && !out.byName[key]) out.byName[key] = rec;
    out.count++;
  }
  return out;
}

/** 거래처코드 정리 — 숫자 셀이 "4216400626.0" 으로 읽히는 것을 되돌린다 */
function _epx_cleanCustCd_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (/^\d+\.0+$/.test(s)) s = s.split(".")[0];
  else if (/^\d+\.\d+e\+?\d+$/i.test(s)) {
    var n = Number(s);
    if (isFinite(n)) s = String(Math.round(n));
  }
  return s;
}

/** 「거래처정보」 거래처명 → 거래처코드 (최후 폴백) */
function _epx_loadCustMap_(hub) {
  var out = { byName: {}, count: 0 };
  var tab = hub.getSheetByName(_EPX_CUST_TAB_);
  if (!tab || tab.getLastRow() < 3) return out;

  var data = tab.getRange(1, 1, tab.getLastRow(), 2).getDisplayValues();
  for (var i = 0; i < data.length; i++) {
    var cd = String(data[i][0] || "").trim();
    var nm = _epx_norm_(data[i][1]);
    if (!cd || !nm || cd === "거래처코드") continue;
    if (!out.byName[nm]) { out.byName[nm] = cd; out.count++; }
  }
  return out;
}

/**
 * 업체 → 택배사. 상품정보「업체_택배사」탭이 SSOT.
 *   접두 | 업체명 | 택배사 | 사방넷코드 | 비고
 * 기존 _pep_loadVendorCarrierTable_ 를 그대로 쓰고, 없으면 직접 읽는다.
 */
function _epx_loadCarrierMap_(hub) {
  var out = { byLabel: {}, byPfx: {}, count: 0 };
  try {
    if (typeof _pep_loadVendorCarrierTable_ === "function") {
      var t = _pep_loadVendorCarrierTable_();
      if (t && t.rows) {
        out.byLabel = t.byLabel || {};
        out.byPfx = t.byPfx || {};
        out.count = t.rows;
        return out;
      }
    }
  } catch (e) {}

  try {
    var tab = hub.getSheetByName("업체_택배사");
    if (!tab || tab.getLastRow() < 2) return out;
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, 3).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var pfx = String(data[i][0] || "").trim().toUpperCase();
      var label = String(data[i][1] || "").replace(/\s/g, "");
      var carrier = String(data[i][2] || "").trim();
      if (!carrier) continue;
      if (pfx) out.byPfx[pfx] = carrier;
      if (label) out.byLabel[label] = carrier;
      out.count++;
    }
  } catch (e2) {}
  return out;
}

/** 업체명/파일명 → 택배사 */
function _epx_carrierOf_(carrierMap, custNm, fileName) {
  var cands = [custNm, fileName];
  for (var i = 0; i < cands.length; i++) {
    var raw = String(cands[i] || "").replace(/^\[협력업체\][_\s]*/, "");
    var key = raw.replace(/\s/g, "");
    if (key && carrierMap.byLabel[key]) return carrierMap.byLabel[key];
  }
  // 부분일치 (표기 차이 흡수)
  var norm = _epx_norm_(custNm);
  if (norm) {
    for (var k in carrierMap.byLabel) {
      var nk = _epx_norm_(k);
      if (!nk) continue;
      if (norm.indexOf(nk) !== -1 || nk.indexOf(norm) !== -1) return carrierMap.byLabel[k];
    }
  }
  return "";
}

// ═══════════════════════════════════════════════════════════
//  업체 시트 해석
// ═══════════════════════════════════════════════════════════

/**
 * 거래처명/거래처코드 결정
 *   ① 설정 탭 B5/B6
 *   ② 업체등급단가매핑 — 배포시트ID(파일ID) 직접 매칭  ← 가장 확실
 *   ③ 업체등급단가매핑 — 거래처명
 *   ④ 거래처정보 — 거래처명
 */
function _epx_readVendorIdentity_(vss, fileInfo, maps) {
  var custNm = "", custCd = "", src = "";
  var fileName = fileInfo && fileInfo.name ? fileInfo.name : String(fileInfo || "");
  var fileId = fileInfo && fileInfo.id ? fileInfo.id : "";

  try {
    var setTab = vss.getSheetByName(_EPX_SET_TAB_);
    if (setTab) {
      custNm = String(setTab.getRange(_EPX_SET_NAME_CELL_).getValue() || "").trim();
      custCd = _epx_cleanCustCd_(setTab.getRange(_EPX_SET_CUST_CELL_).getValue());
      if (custCd) src = "설정B6";
    }
  } catch (e) {}

  // 거래처명이 코드칸과 같은 값이면 코드로 인정하지 않는다(설정 검증식과 동일 취지)
  if (custCd && custNm && custCd === custNm) { custCd = ""; src = ""; }

  var vm = maps.vendorMaster;
  if (!custCd && fileId && vm.byFileId[fileId]) {
    custCd = vm.byFileId[fileId].custCd;
    if (!custNm) custNm = vm.byFileId[fileId].custNm;
    src = "매핑탭(파일ID)";
  }
  if (!custNm) {
    custNm = String(fileName || "")
      .replace(/^\[협력업체\][_\s]*/, "")
      .replace(/\.(xlsx?|gsheet)$/i, "")
      .trim();
  }
  if (!custCd && custNm) {
    var byName = vm.byName[_epx_norm_(custNm)];
    if (byName) { custCd = byName.custCd; src = "매핑탭(거래처명)"; }
  }
  if (!custCd && custNm) {
    var c4 = maps.custMap.byName[_epx_norm_(custNm)];
    if (c4) { custCd = c4; src = "거래처정보"; }
  }
  return { custNm: custNm, custCd: custCd, src: src };
}

/**
 * 전용양식 헤더 → 열 인덱스 해석
 * 업체마다 헤더가 달라 우선순위 키워드 목록으로 찾는다.
 */
function _epx_resolveColumns_(headers) {
  var h = [];
  for (var i = 0; i < headers.length; i++) {
    h.push(String(headers[i] || "").replace(/\s/g, "").toLowerCase());
  }

  function find(cands, excludes) {
    // 1차: 완전일치
    for (var c = 0; c < cands.length; c++) {
      for (var i = 0; i < h.length; i++) {
        if (h[i] === cands[c]) return i;
      }
    }
    // 2차: 부분일치 (제외어 회피)
    for (var c2 = 0; c2 < cands.length; c2++) {
      for (var j = 0; j < h.length; j++) {
        if (!h[j] || h[j].indexOf(cands[c2]) === -1) continue;
        var bad = false;
        for (var e = 0; excludes && e < excludes.length; e++) {
          if (h[j].indexOf(excludes[e]) !== -1) { bad = true; break; }
        }
        if (!bad) return j;
      }
    }
    return -1;
  }

  return {
    // 지에스는 택배박스수량 + 판매수량 둘 다 존재 → 판매수량 우선
    qty:      find(["판매수량", "수량", "수량(a타입)", "박스수량", "택배박스수량"], null),
    itemName: find(["품목명", "상품명1", "상품명", "품명"], ["상세", "쇼핑몰"]),
    itemCode: find(["품목코드", "업체상품코드", "상품코드", "품번"], null),
    date:     find(["일자", "월/일", "주문일", "발주일", "일자-no."], ["이동일시"]),
    invoice:  find(["송장번호", "운송장번호"], null),
    carrier:  find(["택배사", "운임구분", "배송방식"], null),
    receiver: find(["수령인", "받는사람", "받으시는분", "고객명", "수하인", "받는분성명"], ["연락처", "전화", "주소"]),
    moved:    find(["이동일시"], null),
    uid:      50 // 마감탭 = [이동일시] + 전용양식 → AX(49) 가 50으로 밀림
  };
}

/** 행의 일자 결정: 일자열 → 고유ID(yyyymmdd) → 이동일시 → 해당 월 1일 */
function _epx_resolveDate_(row, cols, yyyy, mm) {
  var cands = [];
  if (cols.date >= 0) cands.push(row[cols.date]);
  if (row.length > cols.uid) cands.push(row[cols.uid]);
  if (cols.moved >= 0) cands.push(row[cols.moved]);

  for (var i = 0; i < cands.length; i++) {
    var d = _epx_toYmd_(cands[i], yyyy, mm);
    if (d) return d;
  }
  return String(yyyy) + ("0" + mm).slice(-2) + "01";
}

/** 다양한 표기를 yyyymmdd 문자열로. 실패 시 "" */
function _epx_toYmd_(val, yyyy, mm) {
  if (val === null || val === undefined || val === "") return "";

  if (Object.prototype.toString.call(val) === "[object Date]") {
    if (isNaN(val.getTime())) return "";
    return Utilities.formatDate(val, "Asia/Seoul", "yyyyMMdd");
  }

  var s = String(val).trim();
  if (!s) return "";

  var m = s.match(/(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) m = s.match(/(20\d{2})(\d{2})(\d{2})/);
  if (m) {
    var mo = parseInt(m[2], 10), dd = parseInt(m[3], 10);
    if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
      return m[1] + ("0" + mo).slice(-2) + ("0" + dd).slice(-2);
    }
  }

  // "8/15", "08-15" 같은 월/일 표기 → 대상 연도 보정
  var md = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (md) {
    var mo2 = parseInt(md[1], 10), dd2 = parseInt(md[2], 10);
    if (mo2 >= 1 && mo2 <= 12 && dd2 >= 1 && dd2 <= 31) {
      return String(yyyy) + ("0" + mo2).slice(-2) + ("0" + dd2).slice(-2);
    }
  }
  return "";
}

/**
 * 이카운트코드 역추적
 *
 * 조회 순서 (앞에서 맞으면 끝)
 *   ① 업체상품코드 / 코드 자체
 *   ② 업체상품명(원문)  → ③ 팩투유상품명(원문)
 *   ④ 업체상품명(쇼핑몰 꼬리 제거) → ⑤ 팩투유상품명(꼬리 제거)
 *   ⑥ 우리 품목명(상품정보 C열) — 원문 → 꼬리 제거
 *   ⑦ 마감탭 품목코드가 이미 이카운트코드인 경우(뉴파츠 등)
 *
 * ★ 원문을 먼저 본다. "…360개----뚜껑만" 과 "…360개----뚜껑만(신형)" 처럼
 *   꼬리가 품목을 구분하는 경우가 있어, 꼬리 제거를 먼저 하면 서로 다른 코드가 뭉개진다.
 *   꼬리 제거는 원문으로 못 찾았을 때만 쓴다(제이엠 "---배민" 대응).
 *
 * 중복(모호) 판정은 마지막에만 돌려준다 — 다른 경로로 찾을 수 있으면 그쪽이 우선.
 */
function _epx_reverseLookup_(aliasMap, prodMap, rawCode, rawName) {
  var keyCode  = _epx_norm_(rawCode);
  var keyName  = _epx_norm_(rawName);
  var cleaned  = _epx_cleanItemName_(rawName);
  var keyClean = _epx_norm_(cleaned);
  if (keyClean === keyName) keyClean = ""; // 꼬리가 없으면 2차 시도 불필요

  var ambHit = null;
  function amb(k) { if (k && aliasMap.ambiguous[k] && !ambHit) ambHit = aliasMap.ambiguous[k]; }

  // ① 코드
  if (keyCode && aliasMap.byVendorCode[keyCode]) return { code: aliasMap.byVendorCode[keyCode], status: "" };
  amb(keyCode);

  // ②③ 이름 — 원문
  if (keyName) {
    if (aliasMap.byVendorName[keyName]) return { code: aliasMap.byVendorName[keyName], status: "" };
    if (aliasMap.byPackName[keyName])   return { code: aliasMap.byPackName[keyName],   status: "" };
    amb(keyName);
  }

  // ④⑤ 이름 — 쇼핑몰 꼬리 제거 후
  if (keyClean) {
    if (aliasMap.byVendorName[keyClean]) return { code: aliasMap.byVendorName[keyClean], status: "꼬리제거" };
    if (aliasMap.byPackName[keyClean])   return { code: aliasMap.byPackName[keyClean],   status: "꼬리제거" };
    amb(keyClean);
  }

  // ⑥ 우리 품목명 (상품정보 이카운트상품명)
  if (prodMap && prodMap.byName) {
    if (keyName  && prodMap.byName[keyName])  return { code: prodMap.byName[keyName],  status: "우리품목명" };
    if (keyClean && prodMap.byName[keyClean]) return { code: prodMap.byName[keyClean], status: "우리품목명·꼬리제거" };
  }

  // ⑦ 마감탭 품목코드가 이미 이카운트코드인 경우 — 상품정보에 실재할 때만 인정
  if (rawCode) {
    var padded = _epx_padCode_(rawCode);
    if (padded && prodMap && prodMap.byCode && prodMap.byCode[padded]) {
      return { code: padded, status: "" };
    }
  }

  // ⑧ 중복 후보 해소
  //    매핑 탭에 폐기된 구 코드가 남아 부딪히는 경우가 있다.
  //    (예: 포크 1매 (100P)/백색 → TYSL000389(폐기) vs TYFORK00006(현행))
  //    상품정보에 실재하는 코드만 남기면 대부분 하나로 좁혀진다.
  if (ambHit) {
    var live = [];
    for (var i = 0; i < ambHit.codes.length; i++) {
      var cd = ambHit.codes[i];
      if (prodMap && prodMap.byCode && prodMap.byCode[cd]) live.push(cd);
    }
    if (live.length === 1) {
      return { code: live[0], status: "중복해소(상품정보 실재)" };
    }
    if (live.length > 1) {
      // 실재 코드가 둘 이상이면 「(대리발송)」 쪽을 쓴다
      var proxies = [];
      for (var j = 0; j < live.length; j++) if (aliasMap.isProxy[live[j]]) proxies.push(live[j]);
      if (proxies.length === 1) return { code: proxies[0], status: "중복해소(대리발송)" };
      return { code: "", status: "⚠ 매핑 중복(실재 " + live.length + "건): " + live.slice(0, 3).join(" / ") };
    }
    return { code: "", status: "⚠ 매핑 중복(상품정보에 없음): " + ambHit.codes.slice(0, 3).join(" / ") };
  }

  return { code: "", status: "⚠ HUB 누적품목매핑 미등록" };
}

// ═══════════════════════════════════════════════════════════
//  출력 탭
// ═══════════════════════════════════════════════════════════

function _epx_ensureOutTab_(hub, reset) {
  var tab = hub.getSheetByName(_EPX_OUT_TAB_);
  if (!tab) {
    tab = hub.insertSheet(_EPX_OUT_TAB_);
    reset = true;
  }
  // AA~AD(진단열)까지 쓰려면 최소 30열 필요 — 새 시트 기본 26열
  var needCols = _EPX_DIAG_START_COL_ + _EPX_DIAG_HEADERS_.length - 1;
  if (tab.getMaxColumns() < needCols) {
    tab.insertColumnsAfter(tab.getMaxColumns(), needCols - tab.getMaxColumns());
  }

  if (reset) {
    tab.clear();
    tab.getRange(1, 1, 1, _EPX_HEADERS_.length)
      .setValues([_EPX_HEADERS_])
      .setBackground("#1f4e78").setFontColor("#ffffff")
      .setFontWeight("bold").setHorizontalAlignment("center");
    tab.getRange(1, _EPX_DIAG_START_COL_, 1, _EPX_DIAG_HEADERS_.length)
      .setValues([_EPX_DIAG_HEADERS_])
      .setBackground("#7f7f7f").setFontColor("#ffffff")
      .setFontWeight("bold").setHorizontalAlignment("center");
    tab.setFrozenRows(1);
    tab.setColumnWidth(12, 260); // 품목명
    tab.setColumnWidth(4, 200);  // 거래처명
  }
  return tab;
}

/** 수집분을 그대로 덧붙인다 (중단 대비). 정렬·순번·택배비는 finalize에서 */
function _epx_appendRaw_(tab, recs) {
  var main = [], diag = [];
  for (var i = 0; i < recs.length; i++) {
    main.push(_epx_toMainRow_(recs[i]));
    diag.push([recs[i].status, recs[i].rawName, recs[i].file, recs[i].ship, recs[i].carrier]);
  }
  var start = Math.max(tab.getLastRow() + 1, 2);
  var need = start + main.length;
  if (tab.getMaxRows() < need) tab.insertRowsAfter(tab.getMaxRows(), need - tab.getMaxRows());
  tab.getRange(start, 1, main.length, _EPX_HEADERS_.length).setValues(main);
  tab.getRange(start, _EPX_DIAG_START_COL_, diag.length, _EPX_DIAG_HEADERS_.length).setValues(diag);
}

/** 레코드 → 25열 배열 */
function _epx_toMainRow_(r) {
  return [
    r.date,        // A 일자
    "",            // B 순번 (finalize에서 채움)
    r.custCd,      // C 거래처코드
    r.custNm,      // D 거래처명
    "",            // E 담당자
    "",            // F 입고창고
    "",            // G 거래유형
    "",            // H 통화
    "",            // I 환율
    "",            // J 전잔
    r.code,        // K 품목코드
    r.name,        // L 품목명
    r.spec,        // M 규격
    r.qty,         // N 수량
    r.unit,        // O 단가 (W열 매입가, VAT 포함)
    "",            // P 외화금액
    r.supply,      // Q 공급가액
    r.vat,         // R 부가세
    r.amount,      // S 금액
    r.memo,        // T 적요
    r.buyer,       // U 구매거래처 (수취인)
    r.carrier,     // V 발송택배사
    r.invoice,     // W 송장번호
    "",            // X 부대비용
    ""             // Y 결과 (이카운트 업로드 결과용 — 비워둠)
  ];
}

/**
 * 정렬(일자→거래처→품목) + 순번 부여 + 「일자 × 업체」 단위 택배비 집계행 삽입
 *
 * 출력 단위 = 「한 업체의 하루치」 세트. 업체별로 끊어서 일일 입력할 수 있게 배열한다.
 *   업체A / 20260813 주문행 …
 *   업체A / 20260813 택배비   (상품정보 O열 값이 같은 것끼리 묶음)
 *   업체A / 20260813 택배비 합계   ← 여기까지가 한 번에 입력하는 단위
 *   업체A / 20260815 주문행 …
 *   업체A / 20260815 택배비 합계
 *   업체B / 20260813 주문행 …
 */
function _epx_finalize_(tab) {
  var lr = tab.getLastRow();
  if (lr < 2) return { shipRows: 0 };

  var main = tab.getRange(2, 1, lr - 1, _EPX_HEADERS_.length).getValues();
  var diag = tab.getRange(2, _EPX_DIAG_START_COL_, lr - 1, _EPX_DIAG_HEADERS_.length).getValues();

  // 집계행은 재계산 대상에서 제외 (재실행 대비)
  var recs = [];
  for (var i = 0; i < main.length; i++) {
    if (String(diag[i][0] || "").indexOf("집계") !== -1) continue;
    if (!String(main[i][0] || "").trim()) continue;
    recs.push({ main: main[i], diag: diag[i] });
  }

  // 정렬: 업체 → 일자 → 품목코드
  //   업체가 상위 구분이라 한 업체를 골라 날짜별로 끊어 입력할 수 있다.
  //   (일자 우선으로 바꾸려면 아래 두 비교를 맞바꾸면 된다)
  recs.sort(function (a, b) {
    var c = String(a.main[2]).localeCompare(String(b.main[2])); // 거래처코드
    if (c) return c;
    var n = String(a.main[3]).localeCompare(String(b.main[3])); // 거래처명 (코드 공란 대비)
    if (n) return n;
    var d = String(a.main[0]).localeCompare(String(b.main[0])); // 일자
    if (d) return d;
    return String(a.main[10]).localeCompare(String(b.main[10]));
  });

  // 택배비 집계용: "거래처|업체명|일자" → 배송비값 → 건수 (+ 업체 택배사)
  var _EPX_DIAG_CARRIER_IDX_ = 4;
  var shipBySet = {}, setInfo = {};
  for (var s = 0; s < recs.length; s++) {
    var sKey = String(recs[s].main[2]) + "|" + String(recs[s].main[3]) + "|" + String(recs[s].main[0]);
    if (!setInfo[sKey]) {
      setInfo[sKey] = {
        date: String(recs[s].main[0]), cd: String(recs[s].main[2]),
        nm: String(recs[s].main[3]), carrier: ""
      };
    }
    if (!setInfo[sKey].carrier) {
      setInfo[sKey].carrier = String(recs[s].diag[_EPX_DIAG_CARRIER_IDX_] || "").trim();
    }
    if (!String(recs[s].main[10] || "")) continue; // 코드 미매칭 행은 배송비 산정 불가
    var fee = Math.round(_epx_num_(recs[s].diag[_EPX_DIAG_SHIP_IDX_]));
    if (!fee) continue;
    if (!shipBySet[sKey]) shipBySet[sKey] = {};
    shipBySet[sKey][fee] = (shipBySet[sKey][fee] || 0) + 1;
  }

  var outMain = [], outDiag = [];
  var seq = {}, shipRows = 0;
  var prevSet = null;

  /** 한 업체의 하루치 택배비 블록 — 적요에는 그 업체의 택배사명이 들어간다 */
  function flushShip(setKey) {
    if (!setKey || !shipBySet[setKey]) return;
    var info = setInfo[setKey];
    var fees = Object.keys(shipBySet[setKey]).map(Number).sort(function (a, b) { return a - b; });

    for (var f = 0; f < fees.length; f++) {
      var fee = fees[f];
      var cnt = shipBySet[setKey][fee];
      var amt = fee * cnt;
      var sup = Math.round(amt / _EPX_VAT_DIVISOR_);
      outMain.push([
        info.date, "", info.cd, info.nm, "", "", "", "", "", "",
        _EPX_SHIP_ITEM_CODE_,                                   // K 품목코드
        "[택배비] " + _epx_comma_(fee) + "원 × " + cnt + "건",   // L 품목명
        "",
        cnt, fee, "", sup, amt - sup, amt,
        info.carrier,                                            // T 적요 = 업체 택배사
        "", "", "", "", ""
      ]);
      outDiag.push(["집계-택배비", "상품정보 O열 " + fee, "", fee, info.carrier]);
      shipRows++;
    }
  }

  for (var k = 0; k < recs.length; k++) {
    var row = recs[k].main.slice();
    var key = String(row[2]) + "|" + String(row[3]) + "|" + String(row[0]); // 거래처 + 일자

    // 일자나 업체가 바뀌면 직전 세트의 택배비를 먼저 닫는다
    if (prevSet !== null && key !== prevSet) flushShip(prevSet);
    prevSet = key;

    seq[key] = (seq[key] || 0) + 1;
    row[1] = seq[key]; // 순번 = 같은 일자+거래처 묶음 내 일련번호

    outMain.push(row);
    outDiag.push(recs[k].diag);
  }
  flushShip(prevSet);

  // 재기록 — 집계행이 늘어난 만큼 시트 행/열을 먼저 확보
  var needRows = Math.max(lr - 1, outMain.length) + 1;
  if (tab.getMaxRows() < needRows + 1) {
    tab.insertRowsAfter(tab.getMaxRows(), needRows + 1 - tab.getMaxRows());
  }
  var needCols = _EPX_DIAG_START_COL_ + _EPX_DIAG_HEADERS_.length - 1;
  if (tab.getMaxColumns() < needCols) {
    tab.insertColumnsAfter(tab.getMaxColumns(), needCols - tab.getMaxColumns());
  }

  var clearRows = Math.max(lr - 1, outMain.length);
  tab.getRange(2, 1, clearRows, _EPX_HEADERS_.length).clearContent().setBackground(null).setFontWeight("normal");
  tab.getRange(2, _EPX_DIAG_START_COL_, clearRows, _EPX_DIAG_HEADERS_.length).clearContent();

  if (outMain.length) {
    tab.getRange(2, 1, outMain.length, _EPX_HEADERS_.length).setValues(outMain);
    tab.getRange(2, _EPX_DIAG_START_COL_, outDiag.length, _EPX_DIAG_HEADERS_.length).setValues(outDiag);

    // 숫자 서식
    tab.getRange(2, 14, outMain.length, 1).setNumberFormat("#,##0");      // 수량
    tab.getRange(2, 15, outMain.length, 5).setNumberFormat("#,##0");      // 단가~금액
    tab.getRange(2, 1, outMain.length, 1).setNumberFormat("@");           // 일자 문자열 유지

    // 집계행 음영
    for (var v = 0; v < outDiag.length; v++) {
      if (String(outDiag[v][0]).indexOf("집계") === 0) {
        tab.getRange(v + 2, 1, 1, _EPX_HEADERS_.length)
          .setBackground("#fff2cc")
          .setFontWeight("normal");
      }
    }
  }
  return { shipRows: shipRows };
}

// ═══════════════════════════════════════════════════════════
//  커서 / 유틸
// ═══════════════════════════════════════════════════════════

function _epx_saveCursor_(state) {
  try {
    PropertiesService.getScriptProperties().setProperty(_EPX_CURSOR_KEY_, JSON.stringify(state));
  } catch (e) {}
}

function _epx_loadCursor_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(_EPX_CURSOR_KEY_);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _epx_clearCursor_() {
  try { PropertiesService.getScriptProperties().deleteProperty(_EPX_CURSOR_KEY_); } catch (e) {}
}

/**
 * 품목명 정리 — "상품명--- 배민" 처럼 뒤에 붙는 판매쇼핑몰 표기를 잘라낸다.
 * (제이엠 전용양식에서 발생. 기존 Push 로직도 같은 규칙을 쓴다)
 */
function _epx_cleanItemName_(v) {
  var s = String(v == null ? "" : v);
  var i = s.indexOf("---");
  if (i !== -1) s = s.substring(0, i);
  return s.trim();
}

/** 비교용 정규화: 공백/특수문자 제거 + 소문자 */
function _epx_norm_(v) {
  return String(v == null ? "" : v)
    .replace(/[\s​-‍﻿]/g, "")
    .replace(/[()\[\]{}·,]/g, "")
    .toLowerCase()
    .trim();
}

function _epx_num_(v) {
  if (v === null || v === undefined || v === "") return 0;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function _epx_padCode_(v) {
  var s = String(v == null ? "" : v).replace(/[\s​-‍﻿]/g, "").trim();
  if (!s) return "";
  if (typeof padEcountCode_ === "function") return padEcountCode_(s);
  return s;
}

function _epx_comma_(n) {
  return String(Math.round(_epx_num_(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
