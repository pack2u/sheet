/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장 스키마 조사 — Supabase 이관 준비
 *  ★ 2026-09-04 신규
 *
 *  왜 필요한가
 *    코드는 헤더를 **정규식으로** 찾는다(_cs_mapReturnLedgerCols_).
 *    그래서 시트의 실제 문구가 조금만 달라도 열을 못 찾고 **조용히 비운다**.
 *    지난번 유형(K열)이 안 적히던 게 정확히 그 경우였다.
 *
 *    DB 스키마를 시트의 "짐작"으로 만들면 같은 실수가 이관 데이터에 박힌다.
 *    그래서 옮기기 전에 **실제 헤더·채움률·값 종류**를 눈으로 확인한다.
 *
 *  쓰는 법
 *    스크립트 편집기에서 csDumpReturnLedgerSchema 를 실행하고
 *    로그(Ctrl+Enter)에 찍힌 JSON 을 그대로 복사해 온다.
 *
 *  읽기 전용이다. 시트에 아무것도 쓰지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

/** 0-based 열 번호 → A, B, … AA */
function _crs_letter_(i) {
  var s = "";
  i = i + 1;
  while (i > 0) {
    var r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** 값 종류를 센다 — 너무 많으면 자른다 (열거형 후보인지 보려는 것) */
function _crs_tally_(list, cap) {
  cap = cap || 25;
  var map = {};
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    var v = String(list[i] == null ? "" : list[i]).trim();
    if (!v) continue;
    if (!Object.prototype.hasOwnProperty.call(map, v)) {
      if (n >= cap) return { tooMany: true, distinct: ">" + cap };
      map[v] = 0;
      n++;
    }
    map[v]++;
  }
  var out = [];
  for (var k in map) {
    if (Object.prototype.hasOwnProperty.call(map, k)) out.push({ v: k, n: map[k] });
  }
  out.sort(function (a, b) { return b.n - a.n; });
  return { tooMany: false, distinct: out.length, values: out };
}

/**
 * 반품관리대장 실제 구조 조사.
 * @param {number=} months 최근 몇 개월 탭을 볼지 (기본 6)
 */
function csDumpReturnLedgerSchema(months) {
  months = months || 6;

  var out = {
    ledgerId: _CS_RETURN_LEDGER_ID_,
    at: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
    tabs: [],
    // 코드가 찾는 항목들. 어느 탭에서 못 찾았는지 여기에 모은다.
    missingByField: {},
    errors: [],
  };

  var ss;
  try {
    ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  } catch (e) {
    out.errors.push("대장을 열 수 없습니다: " + String((e && e.message) || e));
    Logger.log(JSON.stringify(out));
    return out;
  }

  out.title = ss.getName();

  // 월별 탭 이름 모으기 (yyyyMM)
  var all = ss.getSheets();
  var monthNames = [];
  for (var s = 0; s < all.length; s++) {
    var nm = all[s].getName();
    if (/^\d{6}$/.test(nm)) monthNames.push(nm);
  }
  monthNames.sort();
  out.allMonthTabs = monthNames;
  out.otherTabs = [];
  for (var s2 = 0; s2 < all.length; s2++) {
    var nm2 = all[s2].getName();
    if (!/^\d{6}$/.test(nm2)) out.otherTabs.push(nm2);
  }

  var recent = monthNames.slice(Math.max(0, monthNames.length - months));

  for (var t = 0; t < recent.length; t++) {
    var tab = ss.getSheetByName(recent[t]);
    if (!tab) continue;

    var info = { tab: recent[t] };
    try {
      var lastRow = tab.getLastRow();
      var lastCol = Math.max(tab.getLastColumn(), 15);
      info.lastRow = lastRow;
      info.lastCol = lastCol;
      if (lastRow < 2) { info.note = "데이터 없음"; out.tabs.push(info); continue; }

      var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
      var hIdx = _cs_findReturnHeaderRow_(values);
      info.headerRow = hIdx + 1;   // 사람이 보는 행 번호
      if (hIdx < 0) { info.note = "헤더 행을 못 찾음"; out.tabs.push(info); continue; }

      var header = values[hIdx];
      var col = _cs_mapReturnLedgerCols_(header);

      // 실제 헤더 그대로
      info.headers = [];
      for (var c = 0; c < header.length; c++) {
        var htxt = String(header[c] || "").trim();
        if (!htxt && c >= 15) continue;   // 뒤쪽 빈 열은 생략
        info.headers.push(_crs_letter_(c) + ": " + htxt);
      }

      // 코드가 각 항목을 어느 열로 잡았나
      info.mapped = {};
      info.missing = [];
      for (var f in col) {
        if (!Object.prototype.hasOwnProperty.call(col, f)) continue;
        if (col[f] < 0) {
          info.missing.push(f);
          if (!out.missingByField[f]) out.missingByField[f] = [];
          out.missingByField[f].push(recent[t]);
        } else {
          info.mapped[f] = _crs_letter_(col[f]) + " (" +
            String(header[col[f]] || "").trim() + ")";
        }
      }

      // 데이터 행만 모은다
      var rows = [];
      for (var r = hIdx + 1; r < values.length; r++) {
        if (_cs_returnLedgerRowHasData_(values[r], col)) rows.push(values[r]);
      }
      info.dataRows = rows.length;

      // 항목별 채움률 — 비어 있는 열이 있으면 스키마에서 NOT NULL 을 걸면 안 된다
      info.fill = {};
      for (var f2 in col) {
        if (!Object.prototype.hasOwnProperty.call(col, f2) || col[f2] < 0) continue;
        var filled = 0;
        for (var r2 = 0; r2 < rows.length; r2++) {
          if (String(rows[r2][col[f2]] || "").trim()) filled++;
        }
        info.fill[f2] = rows.length ? Math.round((filled * 100) / rows.length) + "%" : "-";
      }

      // 열거형 후보 — 상태·유형·수거입력처·업체는 값 종류를 본다
      info.values = {};
      var enumFields = ["status", "type", "pickup", "vendor", "staff"];
      for (var e2 = 0; e2 < enumFields.length; e2++) {
        var ef = enumFields[e2];
        if (col[ef] < 0) continue;
        var vals = [];
        for (var r3 = 0; r3 < rows.length; r3++) vals.push(rows[r3][col[ef]]);
        info.values[ef] = _crs_tally_(vals, ef === "vendor" ? 40 : 25);
      }

      // 날짜·수량·반품비가 어떤 모양으로 들어 있나 (파싱 규칙을 정하려면 필요)
      info.samples = {};
      var sampleFields = ["date", "qty", "fee", "invoice", "returnInvoice", "phone"];
      for (var e3 = 0; e3 < sampleFields.length; e3++) {
        var sf = sampleFields[e3];
        if (col[sf] < 0) continue;
        var got = [];
        for (var r4 = 0; r4 < rows.length && got.length < 3; r4++) {
          var v4 = String(rows[r4][col[sf]] || "").trim();
          if (v4) got.push(v4);
        }
        info.samples[sf] = got;
      }
    } catch (eT) {
      info.error = String((eT && eT.message) || eT);
    }
    out.tabs.push(info);
  }

  Logger.log(JSON.stringify(out));
  return out;
}

/**
 * 최근 2개월만 — 지금 쓰는 양식을 자세히 본다.
 *
 * 편집기의 ▶ 실행은 **인자를 못 넘긴다.** 그래서 인자 없는 이름을 따로 둔다.
 * 6개월치는 로그가 잘리므로, 현행 양식만 볼 때는 이쪽을 쓴다.
 */
function csDumpReturnLedgerSchemaRecent() {
  return csDumpReturnLedgerSchema(2);
}

/** 최근 12개월 — 옛 양식까지 훑을 때. 로그가 길어 잘릴 수 있다. */
function csDumpReturnLedgerSchemaYear() {
  return csDumpReturnLedgerSchema(12);
}
