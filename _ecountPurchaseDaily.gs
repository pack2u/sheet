/**
 * [Pack2U] 당일 구매입력 시트 분리 저장
 * 파일: _ecountPurchaseDaily.gs
 *
 * 「대리공급_임시기록」에서 송장번호가 찍힌 당일 행을 구매입력 양식으로 변환해
 * 「구매입력」 폴더 안에 하루치 파일로 만든다.
 *
 * 송장이 나갔다 = 실제로 출고됐다 는 뜻이라 구매입력 대상이 확정된 것이다.
 * 월 단위 전용마감 변환을 먼저 돌려둘 필요가 없다.
 *
 * 실행 경로
 *   · 메뉴   💎 Pack2U → 🛠️ 이카운트 작업 → 📤 당일 구매입력 시트 만들기
 *   · 트리거 매일 17시 (runDailyEcountPurchaseSheet)
 *
 * ★ 폴더 ★
 *   일일마감과 같은 상위 폴더를 쓴다(_unified_resolveArchiveFolder_).
 *   그 안에 「구매입력」 하위폴더를 만들어 저장한다.
 *
 * ★ 재실행 ★
 *   같은 날 다시 돌리면 새 파일을 만들지 않고 기존 파일 내용을 덮어쓴다.
 */

var _EPD_FOLDER_NAME_  = "구매입력";
var _EPD_FILE_PREFIX_  = "구매입력_";
var _EPD_TRIGGER_FN_   = "runDailyEcountPurchaseSheet";
var _EPD_TRIGGER_HOUR_ = 17;
var _EPD_TRIGGER_MIN_  = 30; // 통합 스케줄(_ALL_SCHEDULED_TRIGGERS_)과 같은 시각을 쓴다

// ── 날짜 ────────────────────────────────────────────────
/** 오늘 (변환탭 A열과 같은 yyyyMMdd) */
function _epd_todayYmd_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
}

/** 20260831 → 2026-08-31 (파일명·알림 표기용) */
function _epd_dashed_(ymd) {
  var s = String(ymd || "");
  if (!/^\d{8}$/.test(s)) return s;
  return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
}

// ── 폴더 / 파일 ─────────────────────────────────────────
/** 상위 폴더 안의 「구매입력」 하위폴더 */
function _epd_purchaseFolder_(ss) {
  if (typeof _unified_resolveArchiveFolder_ !== "function" ||
      typeof _unified_getOrCreateSubFolder_ !== "function") {
    throw new Error("폴더 헬퍼를 찾을 수 없습니다 (_partnerExclusivePush.gs 확인).");
  }
  var base = _unified_resolveArchiveFolder_(ss);
  var sub = null;
  try {
    sub = _unified_getOrCreateSubFolder_(base, _EPD_FOLDER_NAME_);
  } catch (eS) {
    Logger.log("[EPD] 구매입력 하위폴더 생성 실패, 상위 폴더에 저장: " + eS.message);
  }
  return sub || base;
}

/** 하루치 파일 — 있으면 열고 없으면 만든다 */
function _epd_getOrCreateSs_(ss, fileName) {
  var folder = _epd_purchaseFolder_(ss);

  var it = folder.getFilesByName(fileName);
  while (it.hasNext()) {
    var f = it.next();
    var trashed = false;
    try { trashed = f.isTrashed(); } catch (eT) { trashed = false; }
    if (!trashed) return SpreadsheetApp.openById(f.getId());
  }

  var newSs = SpreadsheetApp.create(fileName);
  var newFile = DriveApp.getFileById(newSs.getId());
  try {
    newFile.moveTo(folder);
  } catch (eMove) {
    Logger.log("[EPD] moveTo 실패, addFile 폴백: " + eMove.message);
    try {
      folder.addFile(newFile);
    } catch (eAdd) {
      Logger.log("[EPD] 폴더 이동 실패 (내 드라이브 루트에 생성됨): " + eAdd.message);
    }
  }
  Logger.log("[EPD] 새 파일 생성: " + fileName + " (ID=" + newSs.getId() + ")");
  return newSs;
}

// ── 원천: 대리공급_임시기록 ──────────────────────────
//   ★ 2026-08-31 변경 ★
//   전에는 「이카운트-구매입력변환」 탭에서 A열 일자가 오늘인 행을 골랐다.
//   그러면 월 단위 전용마감 변환을 먼저 돌려야 당일분이 생겨서 순서가 꼬였다.
//
//   지금은 「대리공급_임시기록」에서 **송장번호가 찍힌 행**을 바로 변환한다.
//   송장이 나갔다는 건 실제로 출고됐다는 뜻이라 구매입력 대상이 확정된 것이다.
//
//   열 해석은 CS 웹앱 _cs_loadTempRecent_ 와 같게 맞춘다. 한쪽만 바뀌면 어긋난다.
var _EPD_TEMP_TAB_ = "대리공급_임시기록";
var _EPD_C_DATE_ = 2;   // C 일자
var _EPD_C_CODE_ = 3;   // D 이카운트코드
var _EPD_C_ITEM_ = 4;   // E 품목명
var _EPD_C_QTY_ = 6;    // G 수량
var _EPD_C_NAME_ = 12;  // M 수취인 (머리글은 "거래처명"이지만 실제로는 받는 사람)
var _EPD_C_VENDOR_ = 22; // W 업체 **코드**(접두). 이름이 아니다
var _EPD_C_INV_ = 23;   // X 송장번호
var _EPD_TEMP_MIN_COLS_ = 24;

/** D열은 "OC1234 품목명" 처럼 코드 뒤에 설명이 붙기도 한다 — 첫 토큰만 쓴다 */
function _epd_codeFromCell_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  var tok = s.split(/[\s,|/·]+/)[0];
  return _epx_padCode_(tok);
}

/**
 * W열은 업체 **코드**(접두)다. 이름이 아니라 "JT" · "NS" 같은 값이다.
 * "JT1234" 처럼 뒤에 숫자가 붙어 오기도 해서 앞쪽 영문만 뽑는다.
 */
function _epd_pfxFromCell_(v) {
  var s = String(v == null ? "" : v).trim().toUpperCase();
  if (!s) return "";
  var m = s.match(/^[A-Z]+/);
  return m ? m[0] : s;
}

/**
 * 업체 접두 → 업체명.
 * 상품정보「업체_택배사」탭이 SSOT 다 (A 접두 | B 업체명 | C 택배사 …).
 * 거래처코드는 여기서 얻은 업체명을 「거래처정보」에 다시 물어 얻는다.
 */
function _epd_loadPfxNameMap_(hub) {
  var out = { byPfx: {}, count: 0, fromTab: 0, fromCode: 0 };
  try {
    var tab = hub.getSheetByName("업체_택배사");
    if (tab && tab.getLastRow() >= 2) {
      var data = tab.getRange(2, 1, tab.getLastRow() - 1, 2).getDisplayValues();
      for (var i = 0; i < data.length; i++) {
        var pfx = String(data[i][0] || "").trim().toUpperCase();
        var nm = String(data[i][1] || "").trim();
        if (pfx && nm && !out.byPfx[pfx]) { out.byPfx[pfx] = nm; out.fromTab++; }
      }
    }
  } catch (e) {}

  // 탭에 없는 접두는 코드 폴백으로 메운다.
  // 표가 아직 안 채워졌거나 신규 업체가 빠졌을 때 거래처가 통째로 빈칸이 되는 걸 막는다.
  try {
    if (typeof _PEP_VENDOR_NAME_ !== "undefined") {
      for (var k in _PEP_VENDOR_NAME_) {
        if (!out.byPfx[k]) { out.byPfx[k] = _PEP_VENDOR_NAME_[k]; out.fromCode++; }
      }
    }
  } catch (e2) {}

  out.count = out.fromTab + out.fromCode;
  return out;
}

/**
 * 업체명 → 거래처코드.
 * 완전일치가 먼저고, 안 되면 부분일치로 한 번 더 본다.
 * 「업체_택배사」와 「거래처정보」의 표기가 조금씩 달라(㈜·공백·별칭) 완전일치만
 * 보면 멀쩡한 업체가 빈칸으로 나간다.
 */
function _epd_custCdOf_(custMap, vendorNm) {
  var key = _epx_norm_(vendorNm);
  if (!key) return "";
  if (custMap.byName[key]) return custMap.byName[key];
  for (var nm in custMap.byName) {
    if (nm.indexOf(key) !== -1 || key.indexOf(nm) !== -1) return custMap.byName[nm];
  }
  return "";
}

/**
 * 임시기록에서 당일 + 송장번호 있는 행을 읽어 구매입력 행으로 바꾼다.
 * @return {{rows:Array, stats:Object, warnings:Array}}
 */
function _epd_readTemp_(ss, ymd) {
  var out = { rows: [], stats: { scanned: 0, noInv: 0, otherDay: 0, noCode: 0, noPrice: 0, noVendor: 0 }, warnings: [] };

  var tab = ss.getSheetByName(_EPD_TEMP_TAB_);
  if (!tab) {
    out.warnings.push("「" + _EPD_TEMP_TAB_ + "」 탭을 찾지 못했습니다.");
    return out;
  }
  var lr = tab.getLastRow();
  if (lr < 2) return out;

  var lc = Math.max(tab.getLastColumn(), _EPD_TEMP_MIN_COLS_);
  var data = tab.getRange(2, 1, lr - 1, lc).getDisplayValues();

  var aliasMap = _epx_loadAliasMap_();
  var prodMap = _epx_loadProductMap_(ss);
  var custMap = _epx_loadCustMap_(ss);
  var pfxMap = _epd_loadPfxNameMap_(ss);

  var yyyy = parseInt(String(ymd).slice(0, 4), 10);
  var mm = parseInt(String(ymd).slice(4, 6), 10);

  for (var i = 0; i < data.length; i++) {
    var row = data[i];

    var inv = _epx_capInvoices_(row[_EPD_C_INV_]);
    if (!inv) { out.stats.noInv++; continue; }   // 송장 없으면 아직 출고 전

    out.stats.scanned++;

    // 일자 — 비어 있으면 당일로 본다(임시기록은 당일 입력이 원칙)
    var rowYmd = _epx_toYmd_(row[_EPD_C_DATE_], yyyy, mm) || String(ymd);
    if (rowYmd !== String(ymd)) { out.stats.otherDay++; continue; }

    var rawName = String(row[_EPD_C_ITEM_] || "").trim();
    var rawCode = _epd_codeFromCell_(row[_EPD_C_CODE_]);
    if (!rawName && !rawCode) continue;

    var qty = _epx_num_(row[_EPD_C_QTY_]) || 0;

    // D열 코드가 상품정보에 실재하면 그대로 쓰고, 아니면 품목명으로 역변환한다
    var ecCode = "", status = "";
    if (rawCode && prodMap.byCode[rawCode]) {
      ecCode = rawCode;
      status = "임시기록 D열";
    } else {
      var lk = _epx_reverseLookup_(aliasMap, prodMap, rawCode, rawName);
      ecCode = lk.code;
      status = lk.status;
    }

    var prod = ecCode ? prodMap.byCode[ecCode] : null;
    if (!ecCode) {
      out.stats.noCode++;
    } else if (!prod) {
      status = "⚠ 상품정보 미등록: " + ecCode;
      out.stats.noPrice++;
    }

    var unit = prod ? _epx_num_(prod.buy) : 0;
    if (prod && !unit) { status = status || "⚠ W열 매입가 0/공란"; out.stats.noPrice++; }

    var amount = Math.round(unit * qty);
    var supply = Math.round(amount / _EPX_VAT_DIVISOR_);
    var vat = amount - supply;

    // W 는 업체 코드(접두)다. 접두 → 업체명 → 거래처코드 순으로 푼다.
    var pfx = _epd_pfxFromCell_(row[_EPD_C_VENDOR_]);
    var vendorNm = pfx ? (pfxMap.byPfx[pfx] || "") : "";
    var custCd = vendorNm ? _epd_custCdOf_(custMap, vendorNm) : "";
    if (pfx && !vendorNm) { out.stats.noVendor++; status = status || ("⚠ 업체접두 미등록: " + pfx); }

    out.rows.push({
      date: rowYmd,
      custCd: custCd,
      custNm: vendorNm,
      code: ecCode,
      name: prod ? prod.name : rawName,
      spec: prod ? prod.spec : "",
      qty: qty,
      unit: unit,
      supply: supply,
      vat: vat,
      amount: amount,
      ship: prod ? _epx_num_(prod.ship) : 0,
      memo: "",
      buyer: String(row[_EPD_C_NAME_] || "").trim(),
      carrier: "",
      invoice: inv,
      status: status || "OK",
      rawName: rawName || rawCode
    });
  }

  return out;
}

// ── 본체 ────────────────────────────────────────────────
function _epd_run_(ymd) {
  var ss = SpreadsheetApp.getActive();

  var read = _epd_readTemp_(ss, ymd);
  if (read.warnings.length) throw new Error(read.warnings.join("\n"));

  // 업체 → 일자 → 품목코드 순. 한 업체를 골라 끊어 입력할 수 있게.
  var recs = read.rows.slice();
  recs.sort(function (a, b) {
    var c = String(a.custCd).localeCompare(String(b.custCd));
    if (c) return c;
    var n = String(a.custNm).localeCompare(String(b.custNm));
    if (n) return n;
    return String(a.code).localeCompare(String(b.code));
  });

  // 택배비 집계 — 변환탭과 같은 규칙(업체×일자별, 배송비 값별 건수)
  var shipBySet = {}, setInfo = {};
  for (var s = 0; s < recs.length; s++) {
    var k = recs[s].custCd + "|" + recs[s].custNm + "|" + recs[s].date;
    if (!setInfo[k]) setInfo[k] = { date: recs[s].date, cd: recs[s].custCd, nm: recs[s].custNm };
    if (!recs[s].code) continue;
    var fee = Math.round(recs[s].ship);
    if (!fee) continue;
    if (!shipBySet[k]) shipBySet[k] = {};
    shipBySet[k][fee] = (shipBySet[k][fee] || 0) + 1;
  }

  var outMain = [], outDiag = [], shipRows = 0, prevSet = null;

  function flushShip(k) {
    if (!k || !shipBySet[k]) return;
    var info = setInfo[k];
    var fees = Object.keys(shipBySet[k]).map(Number).sort(function (a, b) { return a - b; });
    for (var f = 0; f < fees.length; f++) {
      var fee = fees[f], cnt = shipBySet[k][fee];
      var amt = fee * cnt, sup = Math.round(amt / _EPX_VAT_DIVISOR_);
      outMain.push([
        info.date, "", info.cd, info.nm, "", "", "", "", "", "",
        _EPX_SHIP_ITEM_CODE_,
        "[택배비] " + _epx_comma_(fee) + "원 × " + cnt + "건",
        "", cnt, fee, "", sup, amt - sup, amt, "", "", "", "", "", ""
      ]);
      outDiag.push(["집계-택배비", "상품정보 O열 " + fee, "", fee, ""]);
      shipRows++;
    }
  }

  for (var r = 0; r < recs.length; r++) {
    var rec = recs[r];
    var key = rec.custCd + "|" + rec.custNm + "|" + rec.date;
    if (prevSet !== null && key !== prevSet) flushShip(prevSet);
    prevSet = key;
    outMain.push(_epx_toMainRow_(rec));
    outDiag.push([rec.status, rec.rawName, _EPD_TEMP_TAB_, rec.ship, ""]);
  }
  flushShip(prevSet);

  // ── 파일 ──
  var fileName = _EPD_FILE_PREFIX_ + "(" + _epd_dashed_(ymd) + ")";
  var target = _epd_getOrCreateSs_(ss, fileName);

  var tab = target.getSheets()[0];
  if (tab.getName() !== _EPX_OUT_TAB_) tab.setName(_EPX_OUT_TAB_);
  tab.clear();

  var needCols = _EPX_DIAG_START_COL_ + _EPX_DIAG_HEADERS_.length - 1;
  if (tab.getMaxColumns() < needCols) {
    tab.insertColumnsAfter(tab.getMaxColumns(), needCols - tab.getMaxColumns());
  }

  tab.getRange(1, 1, 1, _EPX_HEADERS_.length)
    .setValues([_EPX_HEADERS_])
    .setBackground("#252525").setFontColor("#f0f0f0")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.getRange(1, _EPX_DIAG_START_COL_, 1, _EPX_DIAG_HEADERS_.length)
    .setValues([_EPX_DIAG_HEADERS_])
    .setBackground("#3a3a3a").setFontColor("#f0f0f0")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  tab.setColumnWidth(12, 260);
  tab.setColumnWidth(4, 200);

  if (outMain.length) {
    if (tab.getMaxRows() < outMain.length + 1) {
      tab.insertRowsAfter(tab.getMaxRows(), outMain.length + 1 - tab.getMaxRows());
    }

    // ★ 값보다 서식이 먼저다 — 거래처코드·품목코드의 앞자리 0 이 죽지 않게
    _epx_lockTextCols_(tab, outMain.length);

    tab.getRange(2, 1, outMain.length, _EPX_HEADERS_.length).setValues(outMain);
    tab.getRange(2, _EPX_DIAG_START_COL_, outDiag.length, _EPX_DIAG_HEADERS_.length).setValues(outDiag);

    tab.getRange(2, 14, outMain.length, 1).setNumberFormat("#,##0");
    tab.getRange(2, 15, outMain.length, 5).setNumberFormat("#,##0");

    for (var v = 0; v < outDiag.length; v++) {
      if (String(outDiag[v][0]).indexOf("집계") === 0) {
        tab.getRange(v + 2, 1, 1, _EPX_HEADERS_.length).setBackground("#fff2cc");
      }
    }
  }

  return {
    rows: recs.length,
    shipRows: shipRows,
    stats: read.stats,
    name: fileName,
    url: target.getUrl(),
    ymd: ymd
  };
}

// ── 메뉴 진입점 ─────────────────────────────────────────
function buildDailyEcountPurchaseSheetOwner() {
  var ui = SpreadsheetApp.getUi();
  try {
    var res = _epd_run_(_epd_todayYmd_());
    ui.alert(
      "당일 구매입력 시트",
      "파일: " + res.name + "\n" +
        "폴더: " + _EPD_FOLDER_NAME_ + "\n" +
        "품목 행: " + res.rows + "건 (택배비 " + res.shipRows + "행)\n" +
        "임시기록 송장 있는 행: " + res.stats.scanned + "건" +
        (res.stats.otherDay ? " · 다른 날짜 " + res.stats.otherDay + "건 제외" : "") + "\n" +
        (res.stats.noCode ? "⚠ 코드 미매칭 " + res.stats.noCode + "건\n" : "") +
        (res.stats.noPrice ? "⚠ 단가 없음 " + res.stats.noPrice + "건\n" : "") +
        (res.stats.noVendor ? "⚠ 업체접두 미등록 " + res.stats.noVendor + "건\n" : "") +
        "\n" +
        (res.rows
          ? res.url
          : "당일(" + _epd_dashed_(res.ymd) + ") 대상이 없어 빈 파일만 만들었습니다.\n" +
            "대리공급_임시기록 X열에 송장번호가 채워졌는지 확인하세요."),
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("당일 구매입력 시트 실패", e.message, ui.ButtonSet.OK);
  }
}

/**
 * 원천 점검 — 스크립트 편집기에서 실행.
 *
 * 열 매핑(C 일자 · D 코드 · E 품목 · G 수량 · M 수취인 · W 업체 · X 송장)이
 * 실제 시트와 맞는지 눈으로 확인하는 용도다. 여기가 어긋나면 변환 결과가 통째로 틀린다.
 */
function diagnoseDailyPurchaseSource() {
  var out = [];
  try {
    var ss = SpreadsheetApp.getActive();
    var tab = ss.getSheetByName(_EPD_TEMP_TAB_);
    if (!tab) {
      out.push("★ 「" + _EPD_TEMP_TAB_ + "」 탭 없음");
      Logger.log(out.join("\n"));
      return out.join("\n");
    }
    var lr = tab.getLastRow();
    out.push("탭: " + tab.getName() + " (" + Math.max(0, lr - 1) + "행)");

    // 전체 열을 그대로 찍는다 — 짐작해서 매핑하면 결과가 통째로 틀린다.
    //   실제 머리글과 실제 값이 같이 보여야 어느 열을 써야 할지 판단할 수 있다.
    var lc = Math.max(tab.getLastColumn(), _EPD_TEMP_MIN_COLS_);
    if (lr >= 1) {
      var hdr = tab.getRange(1, 1, 1, lc).getDisplayValues()[0];
      var sample = (lr >= 2) ? tab.getRange(2, 1, 1, lc).getDisplayValues()[0] : [];
      out.push("");
      out.push("전체 열 (머리글 / 2행 실제값)");
      for (var c = 0; c < lc; c++) {
        var letter = "";
        var n = c;
        do { letter = String.fromCharCode(65 + (n % 26)) + letter; n = Math.floor(n / 26) - 1; } while (n >= 0);
        var hv = String(hdr[c] || "").trim();
        var sv = String(sample[c] || "").trim();
        if (!hv && !sv) continue; // 빈 열은 건너뛴다
        out.push("  " + letter + "(" + c + ") " + (hv || "(머리글없음)") +
          (sv ? "  =  " + sv.slice(0, 40) : "  =  (빈값)"));
      }
    }

    // 날짜와 무관하게 "송장이 찍힌 행" 이 아예 있는지부터 본다.
    //   0건일 때 아직 출고 전이라 0인지, 필터가 잘못돼 0인지 구분이 안 되면
    //   엉뚱한 데를 고치게 된다.
    if (lr >= 2) {
      var allData = tab.getRange(2, 1, lr - 1, lc).getDisplayValues();
      var withInv = 0, pfxSeen = {};
      for (var a = 0; a < allData.length; a++) {
        if (String(allData[a][_EPD_C_INV_] || "").trim()) withInv++;
        var p = _epd_pfxFromCell_(allData[a][_EPD_C_VENDOR_]);
        if (p) pfxSeen[p] = (pfxSeen[p] || 0) + 1;
      }
      out.push("");
      out.push("전체 " + allData.length + "행 중 송장 찍힌 행: " + withInv + "건 (날짜 무관)");
      if (!withInv) out.push("  → 아직 출고 전이라 0건인 것이 정상입니다.");

      // 업체 접두가 「업체_택배사」 표에 다 있는지 — 없으면 거래처가 빈칸으로 나간다
      var pm = _epd_loadPfxNameMap_(ss);
      var cm = _epx_loadCustMap_(ss); // 반복문 밖에서 한 번만 읽는다
      out.push("");
      out.push("업체 접두 해석 (표 " + pm.fromTab + "행 + 코드폴백 " + pm.fromCode + "개)");
      var keys = Object.keys(pfxSeen).sort();
      for (var k = 0; k < keys.length; k++) {
        var nm = pm.byPfx[keys[k]] || "";
        var cd = nm ? _epd_custCdOf_(cm, nm) : "";
        out.push("  " + keys[k] + " (" + pfxSeen[keys[k]] + "행) → " +
          (nm ? nm + (cd ? " / 거래처코드 " + cd : " / ★ 거래처코드 없음") : "★ 표에 없음"));
      }
    }

    var ymd = _epd_todayYmd_();
    var read = _epd_readTemp_(ss, ymd);
    out.push("");
    out.push("오늘(" + _epd_dashed_(ymd) + ") 기준");
    out.push("  송장 있는 행: " + read.stats.scanned + "건");
    out.push("  다른 날짜라 제외: " + read.stats.otherDay + "건");
    out.push("  변환 대상: " + read.rows.length + "건");
    out.push("  코드 미매칭: " + read.stats.noCode + "건 · 단가 없음: " + read.stats.noPrice +
      "건 · 업체접두 미등록: " + read.stats.noVendor + "건");

    for (var i = 0; i < Math.min(3, read.rows.length); i++) {
      var r = read.rows[i];
      out.push("");
      out.push("  [" + (i + 1) + "] " + r.date + " · " + (r.custNm || "(업체없음)") +
        "(" + (r.custCd || "코드없음") + ")");
      out.push("      " + (r.code || "코드미상") + " " + r.name +
        " × " + r.qty + " @ " + _epx_comma_(r.unit) + " = " + _epx_comma_(r.amount));
      out.push("      송장 " + String(r.invoice).replace(/\n/g, ", ") + " · " + r.status);
    }
  } catch (e) {
    out.push("★ 실패: " + e.message);
  }
  Logger.log(out.join("\n"));
  return out.join("\n");
}

var _EPD_SNAP_PREFIX_ = "대리공급임시기록_";

/**
 * 임시기록 스냅샷 — 대리공급 마감(23:30)이 송장 찍힌 행을 지우기 전에 원본을 남긴다.
 *
 * ★ 왜 필요한가 ★
 *   마감은 송장이 찍힌 행을 임시기록에서 **삭제**한다. 지워진 뒤에는
 *   그날 무엇이 어떤 송장으로 나갔는지 임시기록만으로는 되짚을 수 없다.
 *   구매입력 파일은 변환 결과라서 원본 열(주소·배송메시지·사방넷주문번호 등)이 없다.
 *
 * ★ 값을 전부 텍스트로 쓴다 ★
 *   스냅샷이므로 계산이 아니라 "그때 그 화면"이 남아야 한다.
 *   숫자로 쓰면 송장번호·거래처코드의 앞자리 0 이 죽는다.
 *
 * @param {Sheet} tempTab 대리공급_임시기록 탭
 * @return {{ok:boolean, name:string, rows:number, url:string, error:string}}
 */
function epdSnapshotTempRecord(tempTab) {
  try {
    if (!tempTab) return { ok: false, error: "임시기록 탭이 없습니다." };

    var lr = tempTab.getLastRow();
    var lc = tempTab.getLastColumn();
    if (lr < 1 || lc < 1) return { ok: false, error: "임시기록이 비어 있습니다." };

    var ymd = _epd_todayYmd_();
    var fileName = _EPD_SNAP_PREFIX_ + "(" + _epd_dashed_(ymd) + ")";

    var ss = SpreadsheetApp.getActive();
    var target = _epd_getOrCreateSs_(ss, fileName); // 구매입력 폴더에 만든다

    var tab = target.getSheets()[0];
    if (tab.getName() !== "임시기록") tab.setName("임시기록");
    tab.clear();

    if (tab.getMaxRows() < lr) tab.insertRowsAfter(tab.getMaxRows(), lr - tab.getMaxRows());
    if (tab.getMaxColumns() < lc) tab.insertColumnsAfter(tab.getMaxColumns(), lc - tab.getMaxColumns());

    // 화면에 보이던 그대로 텍스트로 옮긴다
    var vals = tempTab.getRange(1, 1, lr, lc).getDisplayValues();
    tab.getRange(1, 1, lr, lc).setNumberFormat("@").setValues(vals);
    tab.getRange(1, 1, 1, lc)
      .setBackground("#252525").setFontColor("#f0f0f0").setFontWeight("bold");
    tab.setFrozenRows(1);

    Logger.log("[EPD-SNAP] " + fileName + " — " + (lr - 1) + "행 저장");
    return { ok: true, name: fileName, rows: Math.max(0, lr - 1), url: target.getUrl(), error: "" };
  } catch (e) {
    Logger.log("[EPD-SNAP] 실패: " + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * 저녁 묶음 — 당일 구매입력 생성 → Supabase DB 동기화.
 *
 * ★ 왜 묶었나 ★
 *   전에는 17:00 DB동기화 / 17:30 구매입력 으로 따로 돌았다.
 *   순서가 뒤집혀 있었고(동기화가 먼저), 구글 시간 트리거는 nearMinute 이
 *   ±15분이라 두 개가 붙거나 순서가 더 어긋날 수 있었다.
 *   하나로 묶으면 순서가 보장되고 트리거 자리도 하나 아낀다.
 *
 * ★ 앞이 실패해도 뒤는 돈다 ★
 *   구매입력이 실패했다고 DB 동기화까지 건너뛰면 그날 발주·업체 데이터가
 *   통째로 안 올라간다. 둘은 서로 의존하지 않으므로 따로 감싼다.
 */
function runEveningPurchaseAndSync() {
  var log = [];

  try {
    var res = _epd_run_(_epd_todayYmd_());
    log.push("구매입력 " + res.rows + "건 (" + res.name + ")");
  } catch (e) {
    log.push("구매입력 실패: " + e.message);
  }

  try {
    if (typeof _trigger_syncDb_ === "function") {
      _trigger_syncDb_(); // 주말 차단·에러 처리를 스스로 한다
      log.push("DB 동기화 호출");
    } else {
      log.push("DB 동기화 함수 없음");
    }
  } catch (e2) {
    log.push("DB 동기화 실패: " + e2.message);
  }

  Logger.log("[EVENING] " + log.join(" / "));
  return log.join("\n");
}

/** 트리거 진입점 — UI 를 쓰지 않는다 */
function runDailyEcountPurchaseSheet() {
  try {
    var res = _epd_run_(_epd_todayYmd_());
    Logger.log("[EPD] " + res.name + " — " + res.rows + "건");
  } catch (e) {
    Logger.log("[EPD] 실패: " + e.message);
  }
}

// ── 트리거 관리 ─────────────────────────────────────────
function _epd_removeTriggers_() {
  var all = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === _EPD_TRIGGER_FN_) {
      ScriptApp.deleteTrigger(all[i]);
      n++;
    }
  }
  return n;
}

function installDailyEcountPurchaseTrigger() {
  var ui = SpreadsheetApp.getUi();
  try {
    var removed = _epd_removeTriggers_(); // 중복 등록 방지
    ScriptApp.newTrigger(_EPD_TRIGGER_FN_)
      .timeBased().everyDays(1)
      .atHour(_EPD_TRIGGER_HOUR_).nearMinute(_EPD_TRIGGER_MIN_)
      .create();
    ui.alert(
      "트리거 등록",
      "매일 " + _EPD_TRIGGER_HOUR_ + ":" + _EPD_TRIGGER_MIN_ +
        " 에 당일 구매입력 시트를 만듭니다." +
        (removed ? "\n(기존 트리거 " + removed + "개 정리)" : "") +
        "\n\n구글 시간 트리거는 정시가 아니라 그 시간대 안에서 실행됩니다." +
        "\n\n※ 이 트리거는 「협력업체 관리 → 통합 자동 트리거 설치」에도" +
        "\n   포함돼 있습니다. 통합 설치를 쓰시면 따로 켤 필요가 없습니다.",
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("트리거 등록 실패", e.message, ui.ButtonSet.OK);
  }
}

function removeDailyEcountPurchaseTrigger() {
  var ui = SpreadsheetApp.getUi();
  try {
    var n = _epd_removeTriggers_();
    ui.alert("트리거 해제", n + "개를 제거했습니다.", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("트리거 해제 실패", e.message, ui.ButtonSet.OK);
  }
}
