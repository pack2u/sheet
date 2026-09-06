/**
 * ══════════════════════════════════════════════════════════════
 *  통합조회 — 하루치만 채워 넣기
 *  ★ 2026-09-07 신규
 *
 *  왜 만드나
 *    야간 재생성(22:45)이 5분 예산을 넘기면 **기록을 통째로 포기하고** 기존 탭을
 *    그대로 둔다(_puv_rebuild_ 의 안전장치). 「조금 낡았지만 온전한 것」이
 *    「최신이지만 빠진 것」보다 낫다는 판단이고, 그 판단은 맞다.
 *
 *    문제는 그다음이다. 지금까지는 **전체 재생성을 다시 돌리는 것**밖에 방법이
 *    없었는데, 그건 같은 이유로 또 시간초과가 난다. 그래서 하루가 통째로 빈 채로
 *    남는다 (2026-09-01, 2026-09-04).
 *
 *    이 함수는 **그 하루만** 채운다. 파일 하나만 열므로 몇 초면 끝난다.
 *
 *  왜 싸게 되나
 *    일일마감 파일에는 **송장이 이미 확정돼 적혀 있다**. 그래서 비싼 송장맵
 *    (_puv_buildInvoiceMap_ — 롯데 시트 전체를 읽는다)을 만들 필요가 없다.
 *    전체 재생성이 매번 송장을 다시 조회하는 것은 늦게 도착한 송장을 반영하려는
 *    것인데, 하루 메꾸기는 그게 목적이 아니다.
 *
 *  한계 — 이걸 알고 써야 한다
 *    · 일일마감에 아직 안 들어간 건(허브·임시기록)은 안 들어온다.
 *      그건 CS 앱이 실시간 오버레이로 이미 덮고 있다.
 *    · 송장은 마감이 적어 둔 값을 그대로 쓴다. 그 뒤에 도착한 송장은
 *      다음 전체 재생성 때 붙는다.
 *    → **응급 조치다.** 정상 경로는 야간 재생성이다.
 *
 *  여러 번 돌려도 안전하다. 같은 날 것을 지우고 다시 넣는다.
 * ══════════════════════════════════════════════════════════════
 */

/** 통합조회 A열(주문일)·K열(주문번호)·E열(품목명) 로 중복 키를 만든다 */
function _puvpd_rowKey_(row) {
  var date = String(row[0] || "").trim();
  var oid = String(row[10] || "").trim();
  var item = String(row[4] || "").trim();
  if (oid) return date + "|O|" + oid + "|" + item;
  return date + "|N|" + _pep_normRecipName_(row[3]) + "|"
    + _pep_phoneDigits_(row[2]) + "|" + item;
}

/**
 * 하루치 일일마감을 읽어 통합조회에 채운다.
 * @param {string} dateStr "2026-09-04"
 */
function puvPatchUnifiedDay(dateStr) {
  dateStr = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    var msg = "날짜 형식이 yyyy-MM-dd 여야 합니다: " + dateStr;
    Logger.log(msg);
    return { ok: false, error: msg };
  }

  var out = { ok: false, date: dateStr, read: 0, added: 0, replaced: 0 };

  var src;
  try {
    src = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
  } catch (e) {
    out.error = "일일마감 파일을 찾다 실패: " + e.message;
    Logger.log(JSON.stringify(out));
    return out;
  }
  if (!src) {
    out.error = "일일마감_(" + dateStr + ") 파일이 없습니다";
    Logger.log(JSON.stringify(out));
    return out;
  }
  out.file = src.getName();

  var tabSrc = src.getSheetByName("일일마감") || src.getSheets()[0];
  if (!tabSrc || tabSrc.getLastRow() < 2) {
    out.error = "일일마감 파일이 비어 있습니다";
    Logger.log(JSON.stringify(out));
    return out;
  }

  var all = tabSrc.getRange(1, 1, tabSrc.getLastRow(),
    Math.max(tabSrc.getLastColumn(), 2)).getDisplayValues();
  var c = _puv_mapDailyCols_(all[0]);

  /* 일일마감이 적어 둔 송장을 그대로 쓴다.
     전체 재생성의 「기존유지」 경로와 같은 판단이다. */
  var nowStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var fresh = [];
  var seen = {};

  for (var r = 1; r < all.length; r++) {
    var row = all[r];
    if (String(row[0] || "").indexOf("합계") !== -1) continue;

    var rec = {
      date: _puv_pick_(row, c.date) || dateStr,
      origin: "daily",
      existingInv: _puv_pick_(row, c.inv),
      existingSrc: _puv_pick_(row, c.src),
      oid: _puv_pick_(row, c.oid),
      name: _puv_pick_(row, c.name),
      item: _puv_pick_(row, c.item),
      phone: _puv_pick_(row, c.phone) || _puv_pick_(row, c.phone2),
      code: _puv_pick_(row, c.code),
      qty: _puv_pick_(row, c.qty),
      addr: _puv_pick_(row, c.addr),
      shipMsg: _puv_pick_(row, c.shipMsg),
      vendor: _puv_pick_(row, c.vendor),
      existingCarrier: _puv_pick_(row, c.carrier),
    };
    if (!rec.name && !rec.item && !rec.oid) continue;
    out.read++;

    var key = _puv_dedupKey_(rec);
    if (seen[key]) continue;   // 파일 안 중복은 첫 줄만
    seen[key] = true;

    var inv = "", srcName = "", path = "없음";
    var keep = _pep_normInvoiceNo_(rec.existingInv);
    if (keep) {
      if (typeof _pep_qtyOverMax_ === "function" &&
          _pep_qtyOverMax_(rec.qty, rec.item, rec.existingInv)) {
        path = "수량초과";
      } else {
        inv = _pep_splitInvNos_(rec.existingInv).join("\n");
        srcName = rec.existingSrc || "기존";
        path = "기존유지";
      }
    }

    fresh.push([
      rec.date || "", inv, rec.phone || "", rec.name || "",
      rec.item || "", rec.code || "", rec.qty || "",
      rec.addr || "", rec.shipMsg || "",
      inv ? (srcName || "") : "미매칭",
      rec.oid || "", rec.vendor || "",
      _puv_carrier_(srcName, rec.vendor, rec.existingCarrier), "",
      "daily", path,
      _pep_isCombinedPackItem_(rec.item) ? "Y" : "",
      nowStr,
    ]);
  }

  if (!fresh.length) {
    out.error = "채울 줄이 없습니다";
    Logger.log(JSON.stringify(out));
    return out;
  }

  /* 통합조회에서 같은 건을 걷어내고 새로 넣는다.
     날짜 열로 지우지 않는다 — 마감일과 주문일이 다른 줄이 섞여 있어
     날짜로 지우면 엉뚱한 줄까지 사라진다. 중복 키로 정확히 짚는다. */
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PUV_TAB_NAME_);
  if (!tab) {
    out.error = "통합조회 탭이 없습니다. 전체 재생성을 먼저 하세요.";
    Logger.log(JSON.stringify(out));
    return out;
  }

  var freshKeys = {};
  for (var f = 0; f < fresh.length; f++) freshKeys[_puvpd_rowKey_(fresh[f])] = true;

  var lr = tab.getLastRow();
  var kept = [];
  if (lr >= 2) {
    var cur = tab.getRange(2, 1, lr - 1, _PUV_HEADERS_.length).getDisplayValues();
    for (var i = 0; i < cur.length; i++) {
      var line = cur[i];
      var any = false;
      for (var z = 0; z < line.length; z++) { if (String(line[z] || "").trim()) { any = true; break; } }
      if (!any) continue;
      if (freshKeys[_puvpd_rowKey_(line)]) { out.replaced++; continue; }
      kept.push(line);
    }
  }
  out.kept = kept.length;

  var merged = kept.concat(fresh);
  out.added = fresh.length;
  out.total = merged.length;

  /* 주문일 내림차순으로 정리해 둔다. 전체 재생성 결과와 같은 모양이어야
     사람이 봤을 때 「덧붙인 티」가 안 난다. */
  merged.sort(function (a, b) {
    return String(b[0] || "").localeCompare(String(a[0] || ""));
  });

  if (lr >= 2) tab.getRange(2, 1, lr - 1, tab.getMaxColumns()).clearContent();
  tab.getRange(2, 1, merged.length, _PUV_HEADERS_.length).setValues(merged);
  SpreadsheetApp.flush();

  out.ok = true;
  out.message = dateStr + " — 읽음 " + out.read + " · 넣음 " + out.added +
    " · 덮어씀 " + out.replaced + " · 총 " + out.total + "행";
  Logger.log(JSON.stringify(out));
  return out;
}

/** [메뉴] 날짜를 물어보고 그 하루만 채운다 */
function partnerPatchUnifiedDayPrompt() {
  var ui = SpreadsheetApp.getUi();
  var def = Utilities.formatDate(
    new Date(new Date().getTime() - 86400000), "Asia/Seoul", "yyyy-MM-dd");
  var res = ui.prompt(
    "통합조회 — 하루치 채우기",
    "일일마감에서 읽어 그 하루만 채웁니다.\n" +
    "전체 재생성보다 훨씬 빠르고, 여러 번 돌려도 안전합니다.\n\n" +
    "날짜 (yyyy-MM-dd)",
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var d = String(res.getResponseText() || "").trim() || def;

  var r = puvPatchUnifiedDay(d);
  ui.alert(r.ok ? "채우기 완료" : "채우지 못했습니다",
    r.ok ? r.message : (r.error || "알 수 없는 오류"), ui.ButtonSet.OK);
}

/** 어제치 — 편집기에서 인자 없이 실행할 때 */
function puvPatchUnifiedYesterday() {
  return puvPatchUnifiedDay(
    Utilities.formatDate(new Date(new Date().getTime() - 86400000),
      "Asia/Seoul", "yyyy-MM-dd"));
}
