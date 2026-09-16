/**
 * ══════════════════════════════════════════════════════════════
 *  송장 소유권 점검 — 한 송장이 여러 주문에 붙었는지 찾는다
 *  파일: _partnerInvoiceOwnerDiag.gs
 *
 *  왜 필요한가
 *    송장맵의 키는 사람만 가리킨다(이름·전화·주소). 날짜가 키에 없다.
 *    그래서 재구매 고객은 과거 출고분과 새 주문이 같은 키를 공유한다.
 *
 *    「일일마감 송장 재매칭」의 `신규` 판정은 비어 있던 행에 송장을 채우는데,
 *    그 송장이 이미 다른 주문의 것인지 확인하지 않는다
 *    (`_par_decideRow_` → curList.length === 0 분기).
 *    파일 안에서 송장이 사라지는 것만 막고(고아보류), 붙이는 쪽은 검증이 없다.
 *
 *    허브 수집(`partnerFetchInvoices`)도 같은 약점이 있다. 재사용을 막는
 *    `globalUsedInvoices` 를 **현재 허브 N열**로만 채우기 때문에, 출고 후
 *    아카이브로 빠져나간 과거 주문의 송장은 '비어 있는 것'으로 보인다.
 *
 *  그래서 이 진단은 고치지 않고 '증거'만 모은다.
 *    한 송장번호를 여러 주문이 자기 것이라 주장하는 상황을 찾아
 *    누가 진짜 주인인지(가장 이른 주문), 누가 가져다 붙인 것인지 보여준다.
 *
 *  읽는 곳 (전부 읽기 전용)
 *    · 송장원장            — 송장번호·고유ID·수취인·전화·주문일
 *    · 일일마감_(날짜)     — 운송장번호·주문번호·수취인·품목 (최근 N일)
 *    · 협력업체_발주허브   — N열 송장·고유ID·주문일자·수취인
 *    · 일일마감_송장재매칭 — 재매칭이 채운 행 표시 (판정 신규/분리)
 *
 *  결과: `송장소유권_점검` 탭. A열 체크박스로 확인 여부를 관리한다.
 * ══════════════════════════════════════════════════════════════
 */

var _IOD_TAB_ = "송장소유권_점검";
var _IOD_DEFAULT_DAYS_ = 14;

/** 마지막 점검 결과 — 밤에 도는 쪽이 읽는다 */
var _IOD_LAST_ = null;
var _IOD_TIME_BUDGET_MS_ = 4.5 * 60 * 1000;
var _IOD_TZ_ = "Asia/Seoul";

/** 같은 사람이라도 주문일이 이만큼 벌어지면 과거 송장 유용으로 본다 */
var _IOD_STALE_GAP_DAYS_ = 2;

/** 리포트가 너무 커지는 것을 막는다 (그룹 수) */
var _IOD_MAX_GROUPS_ = 400;

var _IOD_HEADERS_ = [
  "확인",       // A: 체크박스
  "그룹",       // B
  "등급",       // C
  "사유",       // D
  "송장번호",   // E
  "주인추정",   // F: ★ = 가장 이른 주문
  "위치",       // G: 송장원장 / 일일마감_날짜 / 허브
  "출처",       // H
  "주문번호",   // I
  "수취인",     // J
  "전화",       // K
  "품목명",     // L
  "주문일",     // M
  "날짜차이",   // N: 주인추정 대비 며칠 뒤
  "재매칭기록", // O: 재매칭 도구가 채운 행인지
  "행",         // P
];

// ─────────────────────────────────────────────────────
//  유틸
// ─────────────────────────────────────────────────────

function _iod_dateKey_(d) {
  return Utilities.formatDate(d, _IOD_TZ_, "yyyy-MM-dd");
}

/** 여러 표기의 날짜 문자열/Date → Date (없으면 null) */
function _iod_toDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v == null ? "" : v).trim();
  if (!s) return null;
  var m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) {
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  var m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) {
    return new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10));
  }
  return null;
}

function _iod_dayDiff_(a, b) {
  if (!a || !b) return "";
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * 이 주장이 가리키는 '주문'의 정체.
 * 고유ID 가 있으면 그것이 정답이다. 없으면 사람+품목+날짜로 대신한다.
 */
function _iod_orderIdentity_(c) {
  if (c.oid) return "U|" + c.oid;
  return "F|" + c.nameKey + "|" + c.itemKey + "|" + (c.dateStr || "");
}

// ─────────────────────────────────────────────────────
//  소유권 주장 수집
// ─────────────────────────────────────────────────────

/**
 * 주장 하나를 등록한다.
 * @param {Object} reg  송장번호 → 주장 배열
 */
function _iod_claim_(reg, inv, c) {
  inv = _pep_normInvoiceNo_(inv);
  if (!inv) return;
  if (!reg[inv]) reg[inv] = [];
  c.nameKey = _pep_normRecipName_(c.name);
  c.itemKey = _pep_itemKey_(c.item);
  c.date = _iod_toDate_(c.dateStr);
  reg[inv].push(c);
}

/** 송장원장 — 송장번호(C)·고유ID(D)·수취인(E)·전화(F)·주문일(G)·품목(H) */
function _iod_collectLedger_(reg, stat) {
  try {
    var tab = _pil_openLedgerSs_().getSheetByName(_PIL_TAB_NAME_);
    if (!tab || tab.getLastRow() < 2) {
      stat.notes.push("송장원장 탭이 비어 있습니다 — 📒 송장원장 갱신 먼저 실행하면 판정이 정확해집니다.");
      return;
    }
    var cols = Math.min(_PIL_HEADERS_.length, tab.getMaxColumns());
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, cols).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var invs = _pep_splitInvNos_(data[i][2]);
      for (var k = 0; k < invs.length; k++) {
        _iod_claim_(reg, invs[k], {
          where: "송장원장",
          src: String(data[i][1] || "").trim(),
          oid: String(data[i][3] || "").trim(),
          name: data[i][4] || "",
          phone: data[i][5] || "",
          dateStr: String(data[i][6] || "").trim() || String(data[i][0] || "").trim(),
          item: data[i][7] || "",
          /*  ★ 「합배송이라고 적혀 있는가」 ★  (2026-09-16)
              허브 12=적요 · 14=상태. 둘 중 하나에 합배송·합포장이 적혀 있으면
              한 상자로 나간 것이 «사실»이다. 적혀 있지 않으면 짐작하지 않는다. */
          mark: String(data[i][12] || "") + " " + String(data[i][14] || ""),
          row: i + 2,
        });
        stat.ledger++;
      }
    }
  } catch (e) {
    stat.notes.push("송장원장 읽기 실패: " + String(e.message || e));
  }
}

/** 최근 N일 일일마감 파일 */
function _iod_collectArchives_(reg, days, stat, started) {
  var today = new Date();
  for (var d = 1; d <= days; d++) {
    if (new Date().getTime() - started > _IOD_TIME_BUDGET_MS_) {
      stat.stopped = "시간 예산 초과 — 일일마감 " + d + "일차에서 중단. 기간을 줄여 실행하세요.";
      return;
    }
    var dt = new Date(today.getTime());
    dt.setDate(dt.getDate() - d);
    var dateStr = _iod_dateKey_(dt);

    try {
      var ss = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
      if (!ss) continue;
      var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
      if (!tab || tab.getLastRow() < 2) continue;

      var lc = Math.max(tab.getLastColumn(), 1);
      var all = tab.getRange(1, 1, tab.getLastRow(), lc).getDisplayValues();
      var cols = _pep_mapArchiveMatchCols_(all[0]);
      stat.files++;

      for (var ri = 1; ri < all.length; ri++) {
        if (String(all[ri][0] || "").indexOf("합계") !== -1) continue;
        var invs = _pep_splitInvNos_(all[ri][cols.inv]);
        if (!invs.length) continue;
        for (var k2 = 0; k2 < invs.length; k2++) {
          _iod_claim_(reg, invs[k2], {
            where: "일일마감_" + dateStr,
            src: cols.src >= 0 ? String(all[ri][cols.src] || "").trim() : "",
            oid: cols.oid >= 0 ? String(all[ri][cols.oid] || "").trim() : "",
            name: cols.name >= 0 ? all[ri][cols.name] : "",
            phone: cols.phone >= 0 ? all[ri][cols.phone] : "",
            item: cols.item >= 0 ? all[ri][cols.item] : "",
            dateStr: dateStr,
            /*  마감 표의 적요. 합배송·합포장·세트(몸통/뚜껑)가 여기 적힌다
                (2026-09-15 «적요에 다 적는다» 작업). */
            mark: _iod_markOf_(all[0], all[ri]),
            row: ri + 1,
            archDate: dateStr,
          });
          stat.archive++;
        }
      }
    } catch (e) {
      stat.notes.push(dateStr + " 읽기 실패: " + String(e.message || e));
    }
  }
}

/** 협력업체_발주허브 — 고유ID(C)·주문일자(D)·품목명(F)·수취인(H)·전화(I)·송장(N) */
/**
 * 그 줄에 「합배송」이라고 적혀 있나 — 적요 칸을 이름으로 찾아 읽는다.
 *
 * 자리로 박지 않는다. 마감 표는 판매현황 C~Q 를 그대로 쓰는데 회차마다
 * 칸이 늘거나 줄 수 있다. 오늘 하루 종일 고친 병이 전부 「자리로 박은 것」이었다.
 */
function _iod_markOf_(hdr, row) {
  if (!hdr || !row) return "";
  var out = [];
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || "").replace(/[ 	]/g, "");
    if (!h) continue;
    if (/^적요$|^비고$|^메모$|^상태$/.test(h)) out.push(String(row[i] || ""));
  }
  return out.join(" ");
}

function _iod_collectHub_(reg, stat) {
  try {
    var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_PO_HUB_SHEET_NAME);
    if (!tab || tab.getLastRow() < 2) return;
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, 15).getValues();
    for (var i = 0; i < data.length; i++) {
      var raw = String(data[i][13] || "").trim();
      if (!_po_hasRealInvoice_(raw)) continue;
      var invs = _pep_splitInvNos_(raw);
      for (var k = 0; k < invs.length; k++) {
        _iod_claim_(reg, invs[k], {
          where: "허브",
          src: String(data[i][1] || "").trim(),
          oid: String(data[i][2] || "").trim(),
          name: data[i][7] || "",
          phone: data[i][8] || "",
          item: data[i][5] || "",
          dateStr: String(data[i][3] || "").trim(),
          row: i + 2,
        });
        stat.hub++;
      }
    }
  } catch (e) {
    stat.notes.push("허브 읽기 실패: " + String(e.message || e));
  }
}

/**
 * 재매칭 도구가 채운 송장 표시.
 * `일일마감_송장재매칭` 탭의 판정 신규/분리 행에서 (마감일, 행, 새송장) 을 뽑는다.
 * @return {Object} "마감일|행|송장" → 판정
 */
function _iod_refixIndex_(stat) {
  var idx = {};
  try {
    var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_PAR_TAB_NAME_);
    if (!tab || tab.getLastRow() < 2) return idx;
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, _PAR_HEADERS_.length).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var verdict = String(data[i][1] || "").trim();
      if (verdict !== "신규" && verdict !== "분리") continue;
      var dateStr = String(data[i][2] || "").trim();
      var row = String(data[i][3] || "").trim();
      var invs = _pep_splitInvNos_(data[i][10]);
      for (var k = 0; k < invs.length; k++) {
        idx["일일마감_" + dateStr + "|" + row + "|" + invs[k]] = verdict;
      }
      stat.refix++;
    }
  } catch (e) {
    stat.notes.push("재매칭 리포트 읽기 실패: " + String(e.message || e));
  }
  return idx;
}

// ─────────────────────────────────────────────────────
//  판정
// ─────────────────────────────────────────────────────

/**
 * 송장 하나에 걸린 주장들을 보고 충돌인지 판단한다.
 *
 * 같은 주문이 여러 곳(원장·마감·허브)에 기록된 것은 정상이다.
 * 문제는 '서로 다른 주문'이 같은 송장을 자기 것이라 하는 경우다.
 *
 * @return {?{grade:string, reason:string, owner:Object}}
 */
function _iod_judge_(claims) {
  var idSet = {};
  var ids = [];
  for (var i = 0; i < claims.length; i++) {
    var id = _iod_orderIdentity_(claims[i]);
    if (!idSet[id]) { idSet[id] = true; ids.push(id); }
  }
  if (ids.length < 2) return null;   // 같은 주문이 여러 곳에 적힌 것 — 정상

  // 주인 추정 — 주문일이 가장 이른 주장. 날짜가 없으면 판정 근거가 약하다.
  var owner = null;
  for (var o = 0; o < claims.length; o++) {
    if (!claims[o].date) continue;
    if (!owner || claims[o].date.getTime() < owner.date.getTime()) owner = claims[o];
  }

  // 사람이 다르면 볼 것도 없다.
  // 단, 이름이 비어 있는 주장은 비교에서 뺀다 — 수취인명을 안 남기는 원천이
  // 섞이면 '이름없음'이 별개 사람으로 잡혀 정상 건까지 확실로 올라간다.
  var nameSet = {};
  var names = [];
  var noName = 0;
  for (var n = 0; n < claims.length; n++) {
    var nk = claims[n].nameKey;
    if (!nk) { noName++; continue; }
    if (!nameSet[nk]) { nameSet[nk] = true; names.push(nk); }
  }
  if (names.length > 1) {
    return {
      grade: "🔴 확실",
      reason: "수취인이 다른 " + names.length + "개 주문에 같은 송장 (" + names.join(" / ") + ")",
      owner: owner,
    };
  }
  var noNameNote = noName > 0 ? " · 수취인명 없는 기록 " + noName + "건 포함" : "";

  // 같은 사람 — 주문일이 벌어져 있으면 과거 주문 송장을 가져다 붙인 것이다
  var maxGap = 0;
  if (owner) {
    for (var g = 0; g < claims.length; g++) {
      if (!claims[g].date) continue;
      var diff = _iod_dayDiff_(owner.date, claims[g].date);
      if (diff > maxGap) maxGap = diff;
    }
  }
  if (maxGap >= _IOD_STALE_GAP_DAYS_) {
    return {
      grade: "🔴 확실",
      reason: "같은 수취인의 서로 다른 주문 " + ids.length + "건에 같은 송장 · 주문일 " +
        maxGap + "일 차 — 과거 주문 송장을 가져다 붙인 것으로 보입니다" + noNameNote,
      owner: owner,
    };
  }

  /*  ══════════════════════════════════════════════════════════════
      ★ 합배송인지 «짐작»하지 않는다 ★  (2026-09-16)

      처음엔 「같은 사람 · 같은 날이면 합배송이겠지」로 정상 처리하려 했다.
      사장님이 바로잡아 주셨다 —

      > "합배송만의 문제가 아니고 개별 주문건에도 문제라"

      맞는 말이다. 개별 주문 둘에 같은 송장이 붙어도 「같은 사람·같은 날」로
      보인다. 그걸 정상이라 하면 진짜 사고를 내 손으로 덮는 것이다.
      오늘 하루 고친 것이 전부 «짐작으로 값을 만드는» 병이었는데, 여기서
      같은 짓을 할 뻔했다.

      ★ 적혀 있으면 정상, 없으면 의심 ★
        합배송으로 나간 줄에는 그렇게 «적힌다» — 허브 적요·상태, 마감 적요.
        (2026-09-15 「적요에 합배송·합포장·세트를 다 적는다」 작업)
        적혀 있으면 한 상자로 나간 것이 사실이다. 없으면 모르는 것이고,
        모르는 것은 의심으로 둔다.

      > "우리만 거짓말쟁이 되고 전화 상담만 과도하게 받는 중이야"
        틀린 송장이 나가면 고객은 없는 상자를 기다리다 전화한다.
        의심을 줄이자고 정상으로 눌러 두면 그 전화가 계속 온다.
      ══════════════════════════════════════════════════════════════ */
  var 합배송적힘 = false;
  for (var mk = 0; mk < claims.length; mk++) {
    var 글 = String(claims[mk].mark || "").replace(/[ 	]/g, "");
    if (글.indexOf("합배송") !== -1 || 글.indexOf("합포장") !== -1) { 합배송적힘 = true; break; }
  }
  if (합배송적힘) {
    return {
      grade: "🟢 합배송",
      reason: "같은 수취인의 주문 " + ids.length + "건이 같은 송장 · 합배송이라고 «적혀» 있습니다" +
        (maxGap > 0 ? " · 주문일 " + maxGap + "일 차" : "") + noNameNote,
      owner: owner,
    };
  }

  return {
    grade: "🟡 의심",
    reason: "같은 수취인의 주문 " + ids.length + "건에 같은 송장" +
      (maxGap > 0 ? " · 주문일 " + maxGap + "일 차" : " · 같은 날") +
      " — 합배송이라는 표시가 «없습니다». 개별 주문이라면 한쪽은 남의 송장입니다" + noNameNote,
    owner: owner,
  };
}

// ─────────────────────────────────────────────────────
//  리포트
// ─────────────────────────────────────────────────────

/** 이전 실행에서 체크된 항목 (송장번호 + 위치 + 행 기준) */
function _iod_readCheckedKeys_(ss) {
  var checked = {};
  var tab = ss.getSheetByName(_IOD_TAB_);
  if (!tab || tab.getLastRow() < 2) return checked;
  var data = tab.getRange(2, 1, tab.getLastRow() - 1, _IOD_HEADERS_.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] !== true) continue;
    checked[
      String(data[i][4] || "").trim() + "|" +
      String(data[i][6] || "").trim() + "|" +
      String(data[i][15] || "").trim()
    ] = true;
  }
  return checked;
}

function _iod_recKey_(inv, c) {
  return inv + "|" + c.where + "|" + c.row;
}

function _iod_writeReport_(ss, groups, meta) {
  var tab = ss.getSheetByName(_IOD_TAB_);
  if (!tab) tab = ss.insertSheet(_IOD_TAB_);
  var checked = _iod_readCheckedKeys_(ss);
  var colCount = _IOD_HEADERS_.length;
  var prevLastRow = tab.getLastRow();

  tab.clearContents();
  try {
    var old = tab.getRange(2, 1, Math.max(prevLastRow - 1, 1), colCount);
    old.clearDataValidations();
    old.setBackground(null);
  } catch (e) {}

  tab.getRange(1, 1, 1, colCount).setValues([_IOD_HEADERS_]);
  tab.getRange("1:1")
    .setBackground("#7f1d1d").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.setFrozenRows(1);

  var rows = [];
  var bounds = [];
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    bounds.push({ start: rows.length, count: g.claims.length, grade: g.grade });
    for (var ci = 0; ci < g.claims.length; ci++) {
      var c = g.claims[ci];
      var isOwner = g.owner && c === g.owner;
      var gap = (g.owner && c.date) ? _iod_dayDiff_(g.owner.date, c.date) : "";
      rows.push([
        checked[_iod_recKey_(g.inv, c)] === true,
        gi + 1,
        g.grade,
        g.reason,
        g.inv,
        isOwner ? "★ 주인추정" : "",
        c.where,
        c.src,
        c.oid,
        String(c.name || ""),
        String(c.phone || ""),
        String(c.item || ""),
        c.dateStr || "",
        gap === "" ? "" : gap,
        c.refix || "",
        c.row,
      ]);
    }
  }

  if (rows.length) {
    // 서식을 먼저 — 송장·전화·주문일의 선행 0 과 원문 표기를 지킨다
    var textCols = [5, 9, 11, 13];
    for (var tc = 0; tc < textCols.length; tc++) {
      tab.getRange(2, textCols[tc], rows.length, 1).setNumberFormat("@");
    }
    tab.getRange(2, 1, rows.length, colCount).setValues(rows);
    tab.getRange(2, 1, rows.length, 1).insertCheckboxes();

    for (var bi = 0; bi < bounds.length; bi++) {
      var b = bounds[bi];
      var bg = b.grade.indexOf("확실") !== -1
        ? (bi % 2 === 0 ? "#fdecea" : "#ffffff")
        : (bi % 2 === 0 ? "#fff8e1" : "#ffffff");
      tab.getRange(2 + b.start, 2, b.count, colCount - 1).setBackground(bg);
    }
  }

  var tailEnd = Math.max(tab.getLastRow(), prevLastRow);
  var newLast = rows.length > 0 ? rows.length + 1 : 1;
  if (tailEnd > newLast) {
    tab.getRange(newLast + 1, 1, tailEnd - newLast, colCount).clearContent();
  }

  try {
    tab.getRange(1, 2).setNote(
      "읽기 전용 진단이다. 아무것도 고치지 않는다.\n\n" +
      "한 송장번호를 서로 다른 주문이 자기 것이라 주장하는 경우만 남긴다.\n" +
      "같은 주문이 원장·마감·허브에 각각 적힌 것은 정상이므로 제외한다.\n\n" +
      "★ 주인추정 = 주문일이 가장 이른 주장. 나머지가 가져다 붙인 쪽이다.\n" +
      "날짜차이 = 주인추정 대비 며칠 뒤 주문인지.\n" +
      "재매칭기록 = 「일일마감 송장 재매칭」이 그 행에 채운 것(신규/분리).\n" +
      "  이 열이 채워져 있으면 재매칭이 남의 송장을 붙인 것이다.\n\n" +
      "🔴 확실 — 수취인이 다르거나, 같은 사람이라도 주문일이 " +
        _IOD_STALE_GAP_DAYS_ + "일 이상 벌어짐\n" +
      "🟡 의심 — 같은 사람 같은 날 — 분할 출고일 수 있음\n\n" +
      "점검 " + meta.at + " · " + meta.from + " ~ " + meta.to
    );
  } catch (eN) {}

  try { tab.autoResizeColumns(2, colCount - 1); } catch (eR) {}
  tab.setColumnWidth(1, 44);
  tab.setColumnWidth(4, 320);
  tab.setColumnWidth(12, 200);
  return rows.length;
}

// ─────────────────────────────────────────────────────
//  본체
// ─────────────────────────────────────────────────────

/**
 * 송장 소유권 충돌 진단.
 * @param {number=} days 일일마감을 며칠까지 볼지 (기본 14)
 */
function partnerDiagnoseInvoiceOwnership(days) {
  var started = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  days = days || _IOD_DEFAULT_DAYS_;

  var stat = {
    ledger: 0, archive: 0, hub: 0, files: 0, refix: 0,
    notes: [], stopped: "",
  };

  var reg = {};
  _iod_collectLedger_(reg, stat);
  _iod_collectHub_(reg, stat);
  _iod_collectArchives_(reg, days, stat, started);

  var refixIdx = _iod_refixIndex_(stat);

  // 판정
  var groups = [];
  var counts = { sure: 0, doubt: 0, merged: 0, byRefix: 0 };
  var invList = Object.keys(reg);
  for (var i = 0; i < invList.length; i++) {
    var inv = invList[i];
    var claims = reg[inv];
    if (claims.length < 2) continue;

    var verdict = _iod_judge_(claims);
    if (!verdict) continue;
    /*  ★ 합배송은 «정상»이다 — 세기만 하고 목록에 안 넣는다 ★  (2026-09-16)
        목록에 넣으면 2천 줄이 쌓여 그 속의 진짜 몇 건이 묻힌다.
        숫자는 보여 준다 — 「안 보고 있다」가 아니라 「보고 정상이라 했다」다. */
    if (verdict.grade === "🟢 합배송") { counts.merged++; continue; }

    var touchedByRefix = false;
    for (var c = 0; c < claims.length; c++) {
      var hit = refixIdx[claims[c].where + "|" + claims[c].row + "|" + inv];
      if (hit) {
        claims[c].refix = hit;
        touchedByRefix = true;
      }
    }
    if (touchedByRefix) counts.byRefix++;

    // 주인추정 먼저, 그다음 주문일 순으로 읽기 편하게 정렬
    claims.sort(function (a, b) {
      if (a === verdict.owner) return -1;
      if (b === verdict.owner) return 1;
      var ta = a.date ? a.date.getTime() : 0;
      var tb = b.date ? b.date.getTime() : 0;
      return ta - tb;
    });

    groups.push({
      inv: inv,
      grade: verdict.grade,
      reason: verdict.reason,
      owner: verdict.owner,
      claims: claims,
      refixed: touchedByRefix,
    });
    if (verdict.grade.indexOf("확실") !== -1) counts.sure++; else counts.doubt++;
  }

  // 재매칭이 건드린 것 → 확실 → 의심 순
  groups.sort(function (a, b) {
    if (a.refixed !== b.refixed) return a.refixed ? -1 : 1;
    var ga = a.grade.indexOf("확실") !== -1 ? 0 : 1;
    var gb = b.grade.indexOf("확실") !== -1 ? 0 : 1;
    if (ga !== gb) return ga - gb;
    return b.claims.length - a.claims.length;
  });

  var truncated = 0;
  if (groups.length > _IOD_MAX_GROUPS_) {
    truncated = groups.length - _IOD_MAX_GROUPS_;
    groups = groups.slice(0, _IOD_MAX_GROUPS_);
  }

  var today = new Date();
  var fromDt = new Date(today.getTime());
  fromDt.setDate(fromDt.getDate() - days);
  var meta = {
    at: Utilities.formatDate(new Date(), _IOD_TZ_, "yyyy-MM-dd HH:mm"),
    from: _iod_dateKey_(fromDt),
    to: _iod_dateKey_(new Date(today.getTime() - 86400000)),
  };
  var written = _iod_writeReport_(ss, groups, meta);

  var lines = [];
  lines.push("🔍 송장 소유권 점검 (읽기 전용 — 아무것도 고치지 않았습니다)");
  lines.push("");
  lines.push("기간: " + meta.from + " ~ " + meta.to + " (일일마감 " + stat.files + "개)");
  lines.push("수집한 소유권 주장: 송장원장 " + stat.ledger + " · 허브 " + stat.hub +
    " · 일일마감 " + stat.archive + "건");
  lines.push("서로 다른 송장번호: " + invList.length + "개");
  lines.push("");
  lines.push("── 충돌 ──");
  lines.push("  🔴 확실: " + counts.sure + "건");
  lines.push("  🟡 의심: " + counts.doubt + "건");
  lines.push("  🟢 합배송(정상): " + counts.merged + "건 — 같은 사람이 한 상자로 받은 것");
  if (!counts.sure && !counts.doubt) {
    lines.push("");
    lines.push("★ 남의 송장이 붙은 것으로 보이는 건은 없습니다.");
  }
  lines.push("  그중 「일일마감 송장 재매칭」이 채운 것: " + counts.byRefix + "건");

  if (counts.byRefix > 0) {
    lines.push("");
    lines.push("※ 재매칭이 남의 송장을 붙인 건이 " + counts.byRefix + "건 있습니다.");
    lines.push("  " + _IOD_TAB_ + " 탭 O열(재매칭기록)이 채워진 행이 그것입니다.");
    lines.push("  되돌릴 근거는 '" + _PAR_TAB_NAME_ + "' 탭 J열(기존송장)에 있습니다.");
  } else if (stat.refix === 0) {
    lines.push("");
    lines.push("※ '" + _PAR_TAB_NAME_ + "' 탭이 없거나 비어 있어 재매칭 기록을 대조하지 못했습니다.");
    lines.push("  재매칭 미리보기를 먼저 실행하면 어느 행을 채웠는지까지 짚어냅니다.");
  }

  if (counts.sure + counts.doubt === 0) {
    lines.push("");
    lines.push("충돌이 없습니다. 한 송장이 두 주문에 걸친 흔적은 찾지 못했습니다.");
  }

  if (truncated > 0) {
    lines.push("");
    lines.push("⚠ 충돌이 많아 상위 " + _IOD_MAX_GROUPS_ + "건만 적었습니다 (나머지 " +
      truncated + "건 생략). 기간을 줄여 다시 실행하세요.");
  }
  if (stat.stopped) {
    lines.push("");
    lines.push("⏱ " + stat.stopped);
  }
  if (stat.notes.length) {
    lines.push("");
    lines.push("참고:");
    for (var n = 0; n < stat.notes.length && n < 6; n++) {
      lines.push("  · " + stat.notes[n]);
    }
  }

  lines.push("");
  lines.push("상세 " + written + "행은 '" + _IOD_TAB_ + "' 탭을 확인하세요.");

  var msg = lines.join("\n");
  /*  ★ 셈을 남겨 둔다 ★  (2026-09-16)
      밤에 스스로 도는 쪽(_iod_nightly_)이 「찾았나」를 알아야 한다.
      돌려주는 것은 사람이 읽는 글이라, 그 글을 다시 뜯어 세면 문구를
      바꿀 때마다 조용히 틀린다. 숫자는 숫자로 남긴다.  */
  _IOD_LAST_ = { sure: counts.sure, doubt: counts.doubt, merged: counts.merged,
                 groups: groups.length, at: new Date().getTime() };
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/** 메뉴: 기간 지정 점검 */
function partnerDiagnoseInvoiceOwnershipForDays() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    "송장 소유권 점검 — 기간 지정",
    "일일마감을 며칠까지 볼까요? (숫자만, 기본 " + _IOD_DEFAULT_DAYS_ + ")\n" +
      "기간이 길면 시간이 초과될 수 있습니다.",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var n = parseInt(String(resp.getResponseText() || "").replace(/[^0-9]/g, ""), 10);
  if (!(n >= 1 && n <= 60)) {
    ui.alert("1 ~ 60 사이의 숫자를 입력하세요.");
    return;
  }
  partnerDiagnoseInvoiceOwnership(n);
}

/**
 * ══════════════════════════════════════════════════════════════
 *  송장을 걷은 «직후»에 본다 — 「남의 송장이 붙었나」
 *  2026-09-16
 *
 *  > "사방넷 송장대량등록 도 오류가 많은듯.. 다른 주문번호에 송장이 붙어 버리네.."
 *  > "현재 이래저래 시스템의 오류가 너무 많아 신뢰가 없네.."
 *
 *  ★ 코드를 고치는 것만으로는 부족하다 ★
 *    오늘 「다른 주문번호에 송장이 붙는」 길을 셋 막았다(배포의 고유ID 겹침,
 *    업체가 복사한 줄, 사방넷 대량등록의 합포장 열쇠). 그런데 그 셋을 막았다고
 *    넷째가 없다고 말할 수는 없다. 코드마다 그물을 놓는 것은 «아는 구멍»에만
 *    듣는다.
 *
 *    이 점검은 다르다. 까닭을 묻지 않고 «결과»를 본다 — 한 송장이 여러 주문에
 *    붙어 있는데 합포장이 아니면 무언가 틀린 것이다. 어느 코드가 그랬든 걸린다.
 *
 *  ★ 사람이 눌러야만 도는 것은 없는 것과 같다 ★
 *    이 도구는 메뉴에 있었다. 그런데 「남의 송장이 붙었을까」를 의심해야만
 *    누른다 — 의심하지 않으면 영영 안 누른다.
 *
 *  ★ «송장을 걷은 직후»에 돈다 — 밤이 아니다 ★
 *    > "오늘 주문건의 송장 입력은 3시 5시쯤에 해야되는데..
 *    >  밤에 검증을 한다는건 말이 안되"
 *
 *    처음엔 21:30 밤일에 붙였다가 되돌렸다. 밤에 알아봐야 이미 업체 시트에도
 *    사방넷에도 나간 뒤다. 16:40 수집이 끝나면 바로 돌려서, 16:50 배포까지
 *    십 분 사이에 사람이 손쓸 수 있게 한다.
 *    (배포 자체도 나가기 직전에 한 번 더 막는다 —
 *     _partnerOrders.gs 의 _po_sameInvoiceDifferentOrders_)
 *
 *  ★ 찾았을 때만 말한다 ★
 *    날마다 「이상 없음」이 오면 사람은 곧 안 보게 된다. 🔴 확실이 있을 때만
 *    알린다. 의심(🟡)은 오탐이 섞이므로 알리지 않고 로그에만 남긴다.
 * ══════════════════════════════════════════════════════════════
 */
function _iod_afterFetch_() {
  /*  7일만 본다. 14일은 마감 파일을 그만큼 열어 밤일을 밀어낸다.
      그날 생긴 것은 그날 밤에 잡히므로 7일이면 넉넉하다. */
  var msg = "";
  try {
    msg = partnerDiagnoseInvoiceOwnership(7);
  } catch (e) {
    Logger.log("[송장소유권] 점검 실패(무시): " + (e && e.message ? e.message : e));
    return;
  }

  var r = _IOD_LAST_ || { sure: 0, doubt: 0, groups: 0 };
  Logger.log("[송장소유권] 확실 " + r.sure + " · 의심 " + r.doubt + " · 묶음 " + r.groups);
  if (!r.sure) return;                 // 찾았을 때만 말한다

  try {
    _chat_sendCard_("🧭 남의 송장이 붙은 것 같습니다",
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
      [
        { label: "🔴 확실", value: r.sure + "건" },
        { label: "🟡 의심", value: r.doubt + "건" },
        { label: "무엇을 보나", value: "한 송장이 여러 주문에 붙었는데 합포장이 아닌 것" },
        { label: "어디서 보나", value: "협력업체 관리 → 🧭 송장 매칭 점검 → 송장 소유권 점검" }
      ]);
  } catch (eC) {}
}

