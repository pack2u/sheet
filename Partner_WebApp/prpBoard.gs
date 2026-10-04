/**
 * ══════════════════════════════════════════════════════════════
 *  업체 문의 → CS 커뮤니티 보드
 *
 *  업체가 포털에서 문의를 남기면 반품대장 비고(N열)에만 쌓였다. CS가 그 건을
 *  열어보지 않으면 문의가 온 줄 몰랐다. 그래서 CS 커뮤니티 보드에도 카드를 만든다.
 *
 *  보드는 CS 웹앱이 만든 것이지만 저장 위치가 **반품대장과 같은 파일**의
 *  `CS_커뮤니티보드` 탭이라, 별개 프로젝트인 포털도 그 시트에 바로 쓸 수 있다.
 *  (프로젝트가 달라 CS 함수를 호출할 방법은 없다.)
 *
 *  ★ 열은 위치가 아니라 **헤더명으로** 찾는다.
 *    CS가 보드에 열을 추가해도 따라오게 하려는 것이다. 위치로 박아두면
 *    CS쪽 한 줄 변경에 조용히 어긋나고, 그때 증상은 "카드가 이상한 칸에 쓰인다" 다.
 *
 *  ★ 여기서 던지는 예외가 문의 자체를 막아서는 안 된다.
 *    보드 기록은 부가 기능이다. 실패하면 사실만 남기고 문의는 성공시킨다.
 * ══════════════════════════════════════════════════════════════
 */

var PRP_BOARD_TAB = "CS_커뮤니티보드";
/** CS쪽 옛 탭명 — 아직 이름이 안 바뀐 파일도 이어서 쓴다 */
var PRP_BOARD_TAB_LEGACY = "CS_전달보드";
var PRP_BOARD_LOCK_MS = 10000;

/** CS csHandoffBoard.gs 의 값과 같아야 한다 */
var PRP_BOARD_STATUS_OPEN = "진행";
var PRP_BOARD_SRCKEY_HEADER = "출처키";

/**
 * 업체 문의 카드의 중요도.
 * `긴급` 으로 올리면 업체 문의가 늘 최상단을 차지해 CS 자체 긴급 건을 가린다.
 * `주의` 가 적당하다 — 일반보다는 위, 긴급보다는 아래.
 */
var PRP_BOARD_LEVEL = "주의";

/** 헤더명 → 열 인덱스. 못 찾은 것은 -1 */
function prpBoardCols_(header) {
  var col = {
    id: -1, at: -1, author: -1, level: -1, title: -1, body: -1,
    link: -1, notes: -1, read: -1, status: -1, srcKey: -1
  };
  var want = {
    "카드ID": "id", "등록일시": "at", "작성자": "author", "중요도": "level",
    "제목": "title", "내용": "body", "연결": "link", "전달내역": "notes",
    "읽음": "read", "상태": "status"
  };
  want[PRP_BOARD_SRCKEY_HEADER] = "srcKey";

  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || "").replace(/\s/g, "");
    if (h && want[h] && col[want[h]] < 0) col[want[h]] = i;
  }
  return col;
}

/** 반품 한 건을 가리키는 키 — 같은 건의 두 번째 문의를 같은 카드에 쌓기 위한 것 */
function prpBoardSrcKey_(tabName, rowNum) {
  return "반품:" + String(tabName || "").trim() + ":" + String(rowNum || "").trim();
}

function prpBoardStamp_(who) {
  return "[" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd HH:mm") +
    " " + String(who || "업체").trim() + "]";
}

/** 보드 탭. 없으면 null — 포털이 만들지 않는다 (스키마 주인은 CS다) */
function prpBoardTab_() {
  var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
  return ss.getSheetByName(PRP_BOARD_TAB) ||
    ss.getSheetByName(PRP_BOARD_TAB_LEGACY) || null;
}

/**
 * 출처키 열이 없으면 맨 끝에 만든다.
 *
 * CS 앱이 이 열을 포함한 버전으로 배포되기 전이거나, 옛 탭을 이어 쓰는 경우다.
 * 이 열이 없으면 같은 건의 두 번째 문의가 카드를 새로 만들어 보드가 금방 넘친다.
 * 맨 끝에만 붙이므로 CS쪽 열 위치 가정을 건드리지 않는다.
 */
function prpBoardEnsureSrcKeyCol_(tab, col) {
  if (col.srcKey >= 0) return col;
  var target = tab.getLastColumn() + 1;
  if (tab.getMaxColumns() < target) {
    tab.insertColumnsAfter(tab.getMaxColumns(), target - tab.getMaxColumns());
  }
  tab.getRange(1, target).setValue(PRP_BOARD_SRCKEY_HEADER);
  col.srcKey = target - 1;
  return col;
}

/**
 * 업체 문의를 보드에 남긴다.
 *
 * 같은 반품 건에 진행 중인 카드가 있으면 **그 카드의 전달내역에 쌓고 읽음을 비운다**
 * (모든 담당자에게 다시 NEW 로 뜬다). 없으면 새 카드를 만든다.
 *
 * @return {Object} {ok, mode:"new"|"append"|"skip", id, error}
 */
function prpPostInquiryToBoard_(info) {
  info = info || {};
  var vendor = String(info.vendor || "").trim();
  var text = String(info.text || "").trim();
  if (!vendor || !text) return { ok: false, mode: "skip", error: "업체명·내용이 필요합니다." };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(PRP_BOARD_LOCK_MS)) {
    return { ok: false, mode: "skip", error: "보드가 잠겨 있습니다." };
  }
  try {
    var tab = prpBoardTab_();
    if (!tab) return { ok: false, mode: "skip", error: "보드 탭이 없습니다." };

    var lastCol = Math.max(tab.getLastColumn(), 13);
    var header = tab.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    var col = prpBoardCols_(header);
    if (col.id < 0 || col.title < 0 || col.status < 0) {
      return { ok: false, mode: "skip", error: "보드 헤더를 알아볼 수 없습니다." };
    }
    col = prpBoardEnsureSrcKeyCol_(tab, col);
    lastCol = Math.max(lastCol, col.srcKey + 1);

    var srcKey = prpBoardSrcKey_(info.tab, info.row);
    var who = PRP_STAFF_PREFIX + vendor; // "업체:{업체명}"
    var line = prpBoardStamp_(who) + " 문의. " + text;

    // ── 진행 중인 같은 건 카드 찾기 ──
    var lastRow = tab.getLastRow();
    if (lastRow >= 2) {
      var keys = tab.getRange(2, col.srcKey + 1, lastRow - 1, 1).getDisplayValues();
      var sts = tab.getRange(2, col.status + 1, lastRow - 1, 1).getDisplayValues();
      for (var i = keys.length - 1; i >= 0; i--) { // 최근 카드부터
        if (String(keys[i][0] || "").trim() !== srcKey) continue;
        var st = String(sts[i][0] || "").trim() || PRP_BOARD_STATUS_OPEN;
        if (st !== PRP_BOARD_STATUS_OPEN) continue; // 완료된 카드는 되살리지 않는다
        var r = i + 2;
        if (col.notes >= 0) {
          var cur = String(tab.getRange(r, col.notes + 1).getDisplayValue() || "").replace(/\s+$/, "");
          tab.getRange(r, col.notes + 1).setValue(cur ? (cur + "\n" + line) : line);
        }
        // 읽음을 비워 모든 담당자에게 다시 NEW 로 띄운다
        if (col.read >= 0) tab.getRange(r, col.read + 1).setValue("");
        var id = col.id >= 0 ? String(tab.getRange(r, col.id + 1).getDisplayValue() || "").trim() : "";
        return { ok: true, mode: "append", id: id };
      }
    }

    // ── 새 카드 ──
    var newId = "HB" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMddHHmmss") +
      "-" + Math.floor(Math.random() * 900 + 100);
    var row = [];
    for (var c = 0; c < lastCol; c++) row[c] = "";
    row[col.id] = newId;
    if (col.at >= 0) row[col.at] = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    if (col.author >= 0) row[col.author] = who;
    if (col.level >= 0) row[col.level] = PRP_BOARD_LEVEL;
    row[col.title] = "[업체문의] " + vendor +
      (info.name ? " · " + info.name : "") +
      (info.item ? " · " + info.item : "");
    if (col.body >= 0) {
      var body = [text, ""];
      body.push("― 반품대장 " + String(info.tab || "") + " " + String(info.row || "") + "행");
      if (info.status) body.push("― 처리상태 " + info.status);
      if (info.invoice) body.push("― 원송장 " + info.invoice);
      if (info.returnInvoice) body.push("― 반품송장 " + info.returnInvoice);
      row[col.body] = body.join("\n");
    }
    // 연결은 주문 검색 쿼리로 그대로 쓰인다 — 검색어만 넣는다 (키를 섞지 않는다)
    if (col.link >= 0) row[col.link] = String(info.invoice || info.name || "").trim();
    if (col.read >= 0) row[col.read] = ""; // 아직 아무도 안 읽었다
    row[col.status] = PRP_BOARD_STATUS_OPEN;
    row[col.srcKey] = srcKey;

    tab.getRange(tab.getLastRow() + 1, 1, 1, lastCol).setValues([row]);
    return { ok: true, mode: "new", id: newId };
  } catch (e) {
    return { ok: false, mode: "skip", error: String((e && e.message) || e) };
  } finally {
    try { lock.releaseLock(); } catch (eL) {}
  }
}
