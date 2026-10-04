/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장 원본 내보내기 — Supabase 이관 준비
 *  ★ 2026-09-06 신규
 *
 *  왜 이렇게 하는가
 *    변환 규칙(업체명 정규화·날짜·금액 파싱)은 **Node 한 곳에만** 둔다
 *    (`Pack2U_협력업체시스템_v2/migrate/`). 여기서 같은 규칙을 또 쓰면
 *    두 벌이 되고, 두 벌은 반드시 어긋난다.
 *
 *    그래서 이 파일은 **아무것도 해석하지 않는다.** 시트에 보이는 문자열을
 *    그대로 담아 Drive 에 JSON 으로 떨군다. 판단은 전부 바깥에서 한다.
 *
 *  쓰는 법
 *    csExportReturnLedgerRaw 를 실행하면 Drive 에 파일이 생기고
 *    로그에 파일 이름과 주소가 찍힌다.
 *
 *  ⚠ 이 파일에는 고객 이름·전화번호가 들어 있다.
 *     이관이 끝나면 지운다. 파일은 **본인 드라이브에만** 생긴다(공유 안 함).
 * ══════════════════════════════════════════════════════════════
 */

/** 내보낼 개월 수 기본값 — 계획서의 「최근 6개월」 */
var _CRE_MONTHS_ = 6;

/**
 * 월별 탭을 있는 그대로 JSON 으로 내보낸다.
 * @param {number=} months 최근 몇 개월 (기본 6)
 */
function csExportReturnLedgerRaw(months) {
  months = months || _CRE_MONTHS_;

  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var all = ss.getSheets();
  var monthNames = [];
  for (var i = 0; i < all.length; i++) {
    var nm = all[i].getName();
    if (/^\d{6}$/.test(nm)) monthNames.push(nm);
  }
  monthNames.sort();
  var recent = monthNames.slice(Math.max(0, monthNames.length - months));

  var out = {
    ledgerId: _CS_RETURN_LEDGER_ID_,
    exportedAt: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
    months: recent,
    tabs: [],
  };

  var totalRows = 0;
  for (var t = 0; t < recent.length; t++) {
    var tab = ss.getSheetByName(recent[t]);
    if (!tab) continue;
    var lastRow = tab.getLastRow();
    var lastCol = tab.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      out.tabs.push({ tab: recent[t], headerRow: 0, header: [], rows: [] });
      continue;
    }

    // getDisplayValues — 시트에 **보이는 대로** 가져온다.
    // getValues 를 쓰면 날짜가 Date 객체, 송장 앞자리 0 이 사라진다.
    var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    var hIdx = _cs_findReturnHeaderRow_(values);
    if (hIdx < 0) hIdx = 0;

    var header = values[hIdx];
    // 뒤쪽의 완전히 빈 열은 잘라낸다 — 파일만 커진다
    var width = header.length;
    while (width > 0) {
      var anyVal = String(header[width - 1] || "").trim();
      if (!anyVal) {
        for (var r0 = hIdx + 1; r0 < values.length && !anyVal; r0++) {
          anyVal = String(values[r0][width - 1] || "").trim();
        }
      }
      if (anyVal) break;
      width--;
    }

    var rows = [];
    for (var r = hIdx + 1; r < values.length; r++) {
      var row = values[r].slice(0, width);
      // 완전히 빈 행은 건너뛴다. 판단이 아니라 빈 줄 제거일 뿐이다.
      var has = false;
      for (var c = 0; c < row.length; c++) {
        if (String(row[c] || "").trim()) { has = true; break; }
      }
      if (!has) continue;
      rows.push({ r: r + 1, v: row });   // r = 사람이 보는 행 번호
    }

    out.tabs.push({
      tab: recent[t],
      headerRow: hIdx + 1,
      header: header.slice(0, width),
      rows: rows,
    });
    totalRows += rows.length;
  }

  out.totalRows = totalRows;

  var name = "반품대장_원본_" +
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmm") + ".json";
  var file = DriveApp.createFile(
    name,
    JSON.stringify(out),
    MimeType.PLAIN_TEXT,
  );

  var res = {
    ok: true,
    file: name,
    fileId: file.getId(),
    url: file.getUrl(),
    sizeKB: Math.round(file.getSize() / 1024),
    months: recent,
    totalRows: totalRows,
  };
  Logger.log(JSON.stringify(res));
  return res;
}

/** 최근 12개월 — 옛 양식까지 함께 옮길 때 */
function csExportReturnLedgerRawYear() {
  return csExportReturnLedgerRaw(12);
}
