/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장에 「실번호 이름」 열을 만든다
 *  파일: _partnerReturnPhone2Col.gs
 *  ★ 2026-09-11 신규 · 한 번 돌리고 끝나는 일
 *
 *  > "실번호에 이름 넣는 칸도 만들어줘... 주문자와 상담자가 다른경우가 있어"
 *  > "실번호 이름 열 만들어줘"
 *
 *  ★ 왜 «맨 뒤»에 붙이나 ★
 *    가운데 끼우면 뒤 열이 한 칸씩 밀린다. 대장 코드에는 아직 «위치로 읽는»
 *    자리가 둘 남아 있다 —
 *      csOrderSearch.gs  col.fee = 12   (M열 반품비 폴백)
 *      csOrderSearch.gs  col.type = 10  (K열 유형 폴백)
 *    머리글을 못 찾는 옛 탭에서 이 둘이 쓰인다. 열을 끼우면 그 탭들이
 *    조용히 엉뚱한 칸을 읽는다 — 반품비 자리에 날짜가 들어오는 식이다.
 *    2026-09 에 열이 하나 밀려서 실제로 그 사고가 났다.
 *
 *    세트분리의 「조치」 열을 맨 뒤에 둔 것과 같은 판단이다.
 *    읽는 쪽은 전부 머리글로 찾으니 «뒤»여도 아무 문제가 없다.
 *
 *  ★ 두 번 돌려도 안 늘어난다 ★
 *    이미 있는 탭은 건너뛴다. 이름이 조금 달라도(상담자·통화자 등)
 *    CS 웹앱이 찾는 규칙과 «같은 규칙»으로 본다 — 한쪽만 알면 열은 생겼는데
 *    아무도 안 읽는 일이 생긴다.
 *
 *  ★ 여기는 트리거를 안 건다 ★
 *    한 번 돌리는 일이다. 시트 프로젝트 트리거는 이미 20/20 이다.
 *    _partnerWebAppAPI.gs 의 action=run 문으로만 부른다.
 * ══════════════════════════════════════════════════════════════
 */

/** 반품관리대장. _partnerReturnsV2Mirror.gs _PRV_LEDGER_ID_ 와 같은 파일이다. */
var _RPC_LEDGER_ID_ = "1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU";

/** 새로 붙일 머리글. CS 웹앱 정규식이 첫 번째로 맞히는 이름을 쓴다. */
var _RPC_HEADER_ = "실번호 이름";

/**
 * CS 웹앱 _cs_mapReturnLedgerCols_ 와 «같은 규칙».
 * 저쪽이 이 열로 인정하는 머리글이면 새로 만들지 않는다.
 */
function _rpc_isNameHeader_(h) {
  var s = String(h || "").replace(/[ \t]/g, "");
  if (!s) return false;
  return /(실번호|추가연락처|연락처)(이름|성함)/.test(s) || /상담자|통화자/.test(s);
}

/** 「반품접수날짜」가 있는 줄이 머리글 줄이다 (CS 웹앱과 같은 기준) */
function _rpc_findHeaderRow_(values) {
  for (var r = 0; r < Math.min(values.length, 40); r++) {
    for (var c = 0; c < values[r].length; c++) {
      var s = String(values[r][c] || "").replace(/[ \t]/g, "");
      if (/반품접수날짜|접수날짜|접수일자/.test(s)) return r;
    }
  }
  return -1;
}

/** 월 탭인가 — 202604 처럼 6자리 */
function _rpc_isMonthTab_(name) {
  return /^20[0-9]{4}$/.test(String(name || "").trim());
}

/**
 * 대장의 모든 월 탭에 「실번호 이름」 열을 맨 뒤로 붙인다.
 *
 * @param {boolean} dryRun  true 면 «무엇을 할지»만 돌려주고 안 고친다
 */
function partnerAddReturnPhone2NameColumn(dryRun) {
  var ss = SpreadsheetApp.openById(_RPC_LEDGER_ID_);
  var sheets = ss.getSheets();
  var out = { dryRun: !!dryRun, added: [], skipped: [], problems: [] };

  for (var i = 0; i < sheets.length; i++) {
    var tab = sheets[i];
    var name = tab.getName();

    /* 월 탭과 템플릿만 손댄다. 다른 탭(설명·집계 등)은 모양이 달라
       머리글 줄을 잘못 짚을 수 있다. */
    if (!_rpc_isMonthTab_(name) && String(name).indexOf("템플릿") < 0) {
      out.skipped.push(name + " (월 탭 아님)");
      continue;
    }

    try {
      var lastCol = Math.max(tab.getLastColumn(), 1);
      var scan = Math.min(Math.max(tab.getLastRow(), 1), 40);
      var values = tab.getRange(1, 1, scan, lastCol).getDisplayValues();
      var hr = _rpc_findHeaderRow_(values);
      if (hr < 0) {
        out.problems.push(name + ": 머리글 줄(반품접수날짜)을 못 찾음");
        continue;
      }

      var header = values[hr];
      var already = -1;
      for (var c = 0; c < header.length; c++) {
        if (_rpc_isNameHeader_(header[c])) { already = c; break; }
      }
      if (already >= 0) {
        out.skipped.push(name + ": 이미 있음 (" + _rpc_colLetter_(already) + "열 「" +
          String(header[already]).trim() + "」)");
        continue;
      }

      /* ★ 맨 뒤 ★ — 가운데 끼우면 위치로 읽는 자리들이 어긋난다 */
      var newCol = lastCol + 1;
      if (!dryRun) {
        tab.getRange(hr + 1, newCol).setValue(_RPC_HEADER_);
        /* 머리글 줄의 모양을 옆 칸에서 그대로 가져온다 —
           새 칸만 허옇게 남으면 사람이 「임시로 적어 둔 것」으로 본다. */
        try {
          tab.getRange(hr + 1, lastCol).copyTo(
            tab.getRange(hr + 1, newCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
          tab.getRange(hr + 1, newCol).setValue(_RPC_HEADER_);
        } catch (eFmt) {}
      }
      out.added.push(name + " → " + _rpc_colLetter_(newCol - 1) + "열");

    } catch (e) {
      out.problems.push(name + ": " + e.message);
    }
  }

  out.message = (dryRun ? "[미리보기] " : "") +
    "붙임 " + out.added.length + " · 건너뜀 " + out.skipped.length +
    (out.problems.length ? " · 문제 " + out.problems.length : "");
  Logger.log("[실번호이름열] " + out.message);
  return out;
}

/** 0 → A, 25 → Z, 26 → AA */
function _rpc_colLetter_(idx) {
  var n = idx + 1, s = "";
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 미리보기 — 무엇을 할지만 본다 */
function partnerPreviewReturnPhone2NameColumn() {
  return partnerAddReturnPhone2NameColumn(true);
}

/* ══════════════════════════════════════════════════════════════
 *  겹쳐 있는 「반품송장번호」 열 치우기
 *  ★ 2026-09-11 · 한 번 돌리고 끝나는 일
 *
 *  > "뒤쪽 빈 반품송장번호 열 지워줘"
 *
 *  ★ 「다 지우기」가 아니다 ★
 *    아홉 탭을 다 세어 보니 겹친 탭은 202609 «하나»뿐이고, 나머지 여덟은
 *    뒤쪽 것이 그 탭의 «유일한» 반품송장번호였다. 눈에 보이는 대로
 *    뒤쪽 것을 다 지웠으면 여덟 탭이 통째로 깨진다.
 *    그래서 «두 개 이상인 탭»에서 «뒤엣것»만 본다.
 *
 *  ★ 비었을 때만 지운다 ★
 *    코드는 먼저 나오는 열을 읽는다. 그래서 뒤엣칸에 누가 적어 뒀다면
 *    그 값은 «여태 아무도 안 읽은 값»이다 — 지우면 영영 없어진다.
 *    한 칸이라도 차 있으면 지우지 않고 알린다.
 *
 *  ★ 지우면 뒤가 당겨진다 ★
 *    「실번호 이름」이 한 칸 앞으로 온다. 읽는 쪽은 전부 머리글로 찾으니
 *    괜찮다. 위치로 읽는 자리(K열 유형·M열 반품비)는 이 칸보다 앞이라
 *    영향이 없다 — 그래서 «뒤엣것»만 지우는 것이 중요하다.
 * ══════════════════════════════════════════════════════════════ */

function _rpc_isRetInvHeader_(h) {
  var s = String(h || "").replace(/[ \t]/g, "");
  if (!s) return false;
  return /반품송장|회수송장/.test(s);
}

/**
 * @param {boolean} dryRun  true 면 무엇을 지울지만 돌려주고 안 고친다
 */
function partnerDropDupReturnInvoiceColumn(dryRun) {
  var ss = SpreadsheetApp.openById(_RPC_LEDGER_ID_);
  var sheets = ss.getSheets();
  var out = { dryRun: !!dryRun, dropped: [], kept: [], skipped: [], problems: [] };

  for (var i = 0; i < sheets.length; i++) {
    var tab = sheets[i];
    var name = tab.getName();
    if (!_rpc_isMonthTab_(name) && String(name).indexOf("템플릿") < 0) continue;

    try {
      var lastCol = Math.max(tab.getLastColumn(), 1);
      var lastRow = Math.max(tab.getLastRow(), 1);
      var scan = Math.min(lastRow, 40);
      var values = tab.getRange(1, 1, scan, lastCol).getDisplayValues();
      var hr = _rpc_findHeaderRow_(values);
      if (hr < 0) { out.problems.push(name + ": 머리글 줄을 못 찾음"); continue; }

      var header = values[hr];
      var hits = [];
      for (var c = 0; c < header.length; c++) if (_rpc_isRetInvHeader_(header[c])) hits.push(c);

      if (hits.length < 2) {
        out.skipped.push(name + ": 하나뿐 (" + (hits.length ? _rpc_colLetter_(hits[0]) + "열" : "없음") + ")");
        continue;
      }

      /* 뒤엣것만 본다. 앞엣것이 코드가 읽는 열이라 건드리면 안 된다. */
      var dup = hits[hits.length - 1];

      /* 값이 한 칸이라도 있으면 안 지운다 */
      var 찬칸 = [];
      if (lastRow > hr + 1) {
        var col = tab.getRange(hr + 2, dup + 1, lastRow - hr - 1, 1).getDisplayValues();
        for (var r = 0; r < col.length; r++) {
          if (String(col[r][0] || "").trim()) 찬칸.push(hr + 2 + r);
          if (찬칸.length >= 5) break;
        }
      }
      if (찬칸.length) {
        out.kept.push(name + ": " + _rpc_colLetter_(dup) + "열에 값이 있어 안 지움 (행 " +
          찬칸.join(", ") + (찬칸.length >= 5 ? " …" : "") + ")");
        continue;
      }

      if (!dryRun) tab.deleteColumn(dup + 1);
      out.dropped.push(name + ": " + _rpc_colLetter_(dup) + "열 지움 (앞엣것 " +
        _rpc_colLetter_(hits[0]) + "열은 그대로)");

    } catch (e) {
      out.problems.push(name + ": " + e.message);
    }
  }

  out.message = (dryRun ? "[미리보기] " : "") +
    "지움 " + out.dropped.length + " · 값 있어 남김 " + out.kept.length +
    " · 하나뿐이라 건너뜀 " + out.skipped.length +
    (out.problems.length ? " · 문제 " + out.problems.length : "");
  Logger.log("[겹친송장열] " + out.message);
  return out;
}

/** 미리보기 — 무엇을 지울지만 본다 */
function partnerPreviewDupReturnInvoiceColumn() {
  return partnerDropDupReturnInvoiceColumn(true);
}
