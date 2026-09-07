/**
 * ══════════════════════════════════════════════════════════════
 *  커뮤니티 보드 원본 내보내기 — Supabase 이관 준비
 *  ★ 2026-09-08 신규
 *
 *  왜 이렇게 하는가
 *    반품대장 때와 같다 (csReturnLedgerExport.gs). 변환 규칙은
 *    **Node 한 곳에만** 둔다 (`Pack2U_협력업체시스템_v2/migrate/`).
 *    여기서 같은 규칙을 또 쓰면 두 벌이 되고, 두 벌은 반드시 어긋난다.
 *
 *    그래서 이 파일은 **아무것도 해석하지 않는다.** 전달내역을 줄로 자르지도,
 *    「읽음」 쉼표 목록을 나누지도, 날짜를 파싱하지도 않는다.
 *    시트에 보이는 문자열을 그대로 담아 Drive 에 JSON 으로 떨군다.
 *
 *  쓰는 법
 *    편집기에서 csExportBoardRaw 를 ▶ 실행하면 Drive 에 파일이 생기고
 *    실행로그에 파일 이름과 주소가 찍힌다. 그 파일을 내려받아 넘겨 주면 된다.
 *
 *  ⚠ 이 파일에는 고객 이름·전화번호가 들어 있다.
 *     이관이 끝나면 지운다. 파일은 **본인 드라이브에만** 생긴다(공유 안 함).
 * ══════════════════════════════════════════════════════════════
 */

/**
 * 두 보드(CS·물류) 탭을 있는 그대로 JSON 으로 내보낸다.
 *
 * 완료된 카드도 같이 담는다 — 「이 건 전에 어떻게 처리했더라」를 찾는 것이
 * 보드의 쓸모 중 하나라 진행 카드만 옮기면 그게 사라진다.
 */
function csExportBoardRaw() {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);

  var out = {
    source: "CS_WebApp/csHandoffBoard.gs",
    ledgerId: _CS_RETURN_LEDGER_ID_,
    exportedAt: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
    boards: [],
  };

  var total = 0;

  for (var key in _CS_HB_BOARDS_) {
    if (!Object.prototype.hasOwnProperty.call(_CS_HB_BOARDS_, key)) continue;
    var conf = _CS_HB_BOARDS_[key];

    var tab = ss.getSheetByName(conf.tab);
    // CS 보드는 예전 이름으로 남아 있을 수 있다
    if (!tab && key === "cs") tab = ss.getSheetByName(_CS_HB_TAB_LEGACY_);

    if (!tab) {
      out.boards.push({ board: key, tab: conf.tab, missing: true, header: [], rows: [] });
      continue;
    }

    var lastRow = tab.getLastRow();
    var lastCol = Math.max(tab.getLastColumn(), _CS_HB_HEADERS_.length);
    if (lastRow < 2) {
      out.boards.push({ board: key, tab: tab.getName(), header: [], rows: [] });
      continue;
    }

    // getDisplayValues — 시트에 **보이는 대로**.
    // getValues 를 쓰면 날짜가 Date 객체가 되고 송장 앞자리 0 이 사라진다.
    var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    var header = values[0];

    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var has = false;
      for (var c = 0; c < row.length; c++) {
        if (String(row[c] || "").trim()) { has = true; break; }
      }
      if (!has) continue;          // 빈 줄 제거일 뿐, 판단이 아니다
      rows.push({ r: r + 1, v: row });   // r = 사람이 보는 행 번호
    }

    out.boards.push({
      board: key,
      tab: tab.getName(),
      label: conf.label,
      prefix: conf.prefix,
      header: header,
      rows: rows,
    });
    total += rows.length;
  }

  out.totalRows = total;

  var name = "커뮤니티보드_원본_" +
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmm") + ".json";
  var file = DriveApp.createFile(name, JSON.stringify(out), MimeType.PLAIN_TEXT);

  var msg = [
    "── 커뮤니티 보드 내보내기 ──",
    "파일  " + name,
    "주소  " + file.getUrl(),
    "",
  ];
  for (var i = 0; i < out.boards.length; i++) {
    var b = out.boards[i];
    msg.push("  " + (b.label || b.board) + "  " +
      (b.missing ? "탭 없음" : b.rows.length + "장  (" + b.tab + ")"));
  }
  msg.push("");
  msg.push("합계 " + total + "장");
  msg.push("");
  msg.push("⚠ 고객 이름·전화가 들어 있습니다. 이관이 끝나면 지우세요.");

  var text = msg.join("\n");
  Logger.log(text);
  return text;
}
