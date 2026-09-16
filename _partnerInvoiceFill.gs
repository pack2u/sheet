/**
 * ══════════════════════════════════════════════════════════════
 *  늦게 온 송장을 «빈 칸에만» 채운다
 *  파일: _partnerInvoiceFill.gs
 *
 *  ★ 왜 다시 만드나 ★  (2026-09-16)
 *    같은 날 소급 보강을 통째로 지웠다 —
 *      > "돌리지마.. 그거한다고 시간낭비하고 오히려 엉망이 되는데..
 *      >  당일것도 못하는데 무슨.. 그거도 시간재약있는 시트에서"
 *    지우라고 하신 까닭은 «지금 코드로는 제대로 못 고치니까»였다.
 *    그리고 이렇게 정하셨다 —
 *      > "당분간은 미매칭부분에도 들어올 송장이 있으면 송장이 들어오게 해야되"
 *      > "나, 7일...."   (나 = 송장 전파 때 · 7일)
 *
 *    송장은 2~7일, 늦으면 15일까지 걸린다. 3차 세트분리에서 대리발송으로
 *    빠진 건은 출고 마감 뒤라 «반드시» 다음날 송장이 온다. 그 건들이
 *    영원히 빈칸으로 남으면 조회도 안 되고 CS가 답을 못 한다.
 *
 *  ★ 전과 무엇이 다른가 ★
 *    ① 마감(20:00) 안에서 안 돈다. 17:00 에 따로 돈다 — 마감의 6분을 안 먹는다
 *    ② 송장맵을 «송장원장 하나»로만 만든다. 파일을 더 열지 않는다
 *       (원장이 이미 임시기록·보관·전용마감·발주마감·허브아카이브를 모은다)
 *    ③ 고유ID 로만 채운다. 이름·전화로 더듬지 않는다
 *    ④ «빈 칸»만 채운다. 이미 든 것은 절대 안 건드린다
 *    ⑤ 기준일(_pep_matchStart_) 이전 파일은 열지 않는다
 *    ⑥ 채운 건수를 «말한다». 조용히 고치지 않는다
 *
 *  아무것도 지우지 않는다. 빈 칸을 채우기만 한다.
 * ══════════════════════════════════════════════════════════════
 */

/** 거슬러 보는 날 수 — 사장님이 정하신 값 */
var _PIF_DAYS_ = 7;

/** 한 번에 쓰는 데 쓸 시간 한도 (6분 앞에서 멈춘다) */
var _PIF_BUDGET_MS_ = 4 * 60 * 1000;

/**
 * 최근 N일 일일마감의 «빈 송장 칸»을 송장원장으로 채운다.
 * @param {number=} days 기본 7
 * @return {Object} { files, scanned, patched, byDay, skippedOld, notes }
 */
function partnerFillBlankInvoices(days) {
  var t0 = new Date().getTime();
  days = days || _PIF_DAYS_;
  var out = {
    files: 0, scanned: 0, patched: 0, byDay: [], skippedOld: 0,
    notes: [], stopped: ""
  };

  /*  송장맵은 «송장원장 하나»로만 만든다.
      원장이 임시기록·보관·전용마감·발주마감을 이미 모아 둔 곳이다.
      여기서 여러 원천을 또 열면 지운 것과 같은 짐이 된다.  */
  var map = {};
  var 원장행 = 0;
  try {
    원장행 = _pil_addToInvoiceMap_(map);
  } catch (e) {
    out.notes.push("송장원장을 못 읽었습니다 — " + String(e.message || e));
    return out;
  }
  if (!원장행) {
    out.notes.push("송장원장이 비어 있습니다 — 📒 송장원장 갱신을 먼저 돌려야 합니다.");
    return out;
  }
  out.ledgerRows = 원장행;

  var today = new Date();
  for (var d = 0; d <= days; d++) {
    if (new Date().getTime() - t0 > _PIF_BUDGET_MS_) {
      out.stopped = "시간이 모자라 " + d + "일차에서 멈췄습니다. 다음 실행이 이어서 봅니다.";
      break;
    }
    var dt = new Date(today.getTime());
    dt.setDate(dt.getDate() - d);
    var dateStr = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");

    /*  ★ 기준일 이전은 열지 않는다 ★ 「무너진 주」는 고치지 않는다.  */
    if (typeof _pep_afterStart_ === "function" && !_pep_afterStart_(dateStr)) {
      out.skippedOld++;
      continue;
    }

    var n = _pif_fillOneDay_(dateStr, map, out);
    if (n > 0) out.byDay.push(dateStr + ":" + n);
  }

  return out;
}

/**
 * 하루치 파일 하나.
 * @return {number} 채운 줄 수
 */
function _pif_fillOneDay_(dateStr, map, out) {
  var ss;
  try {
    ss = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
  } catch (e) {
    out.notes.push(dateStr + " 파일 찾기 실패: " + String(e.message || e));
    return 0;
  }
  if (!ss) return 0;

  var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
  if (!tab || tab.getLastRow() < 2) return 0;
  out.files++;

  var lc = Math.max(tab.getLastColumn(), 1);
  var all = tab.getRange(1, 1, tab.getLastRow(), lc).getDisplayValues();
  var cols = _pep_mapArchiveMatchCols_(all[0]);
  if (cols.inv < 0) {
    out.notes.push(dateStr + ": 운송장번호 칸을 못 찾아 건너뜁니다.");
    return 0;
  }

  /*  칸을 통째로 다시 쓰지 않는다 — 바뀐 줄만 한 칸씩 쓴다.
      통째로 쓰면 그 사이에 사람이 손댄 값을 덮는다.  */
  var 고칠것 = [];
  for (var ri = 1; ri < all.length; ri++) {
    if (String(all[ri][0] || "").indexOf("합계") !== -1) continue;
    out.scanned++;

    //  ★ 빈 칸만 ★ 이미 든 것은 절대 안 건드린다
    var cur = String(all[ri][cols.inv] || "").trim();
    if (cur && _pep_normInvoiceNo_(cur)) continue;

    //  ★ 고유ID 로만 ★ 이름·전화로 더듬지 않는다
    var key = _pep_deriveMatchKeyFromArchiveRow_(all[ri], cols);
    if (!key || (typeof _pep_isRealUid_ === "function" && !_pep_isRealUid_(key))) continue;

    var 어떻게 = {};
    var hit = _pep_resolveRowInvoice_(map, {
      uid: key,
      orderDate: cols.date >= 0 ? all[ri][cols.date] : ""
    }, 어떻게);
    if (!hit || !hit.inv) continue;
    if (어떻게.via !== "UID") continue;      // 고유ID 로 맞은 것만

    고칠것.push({
      row: ri + 1,
      inv: hit.inv,
      src: hit.source || "송장원장",
      carrier: hit.carrier || ""
    });
  }

  if (!고칠것.length) return 0;

  var srcIdx = cols.src >= 0 ? cols.src : lc - 1;
  for (var fi = 0; fi < 고칠것.length; fi++) {
    var f = 고칠것[fi];
    try {
      tab.getRange(f.row, cols.inv + 1).setValue(f.inv);
      //  출처가 비어 있던 자리(= 송장 없음)에만 적는다
      if (srcIdx >= 0 && !String(all[f.row - 1][srcIdx] || "").trim()) {
        tab.getRange(f.row, srcIdx + 1).setValue(f.src);
      }
      if (cols.carrier >= 0 && f.carrier &&
          !String(all[f.row - 1][cols.carrier] || "").trim()) {
        tab.getRange(f.row, cols.carrier + 1).setValue(f.carrier);
      }
      out.patched++;
    } catch (eW) {
      out.notes.push(dateStr + " " + f.row + "행 쓰기 실패: " + String(eW.message || eW));
    }
  }
  return 고칠것.length;
}

/**
 * 17:00 자동 실행 — 조용하지 않다.
 * 채운 것이 있으면 챗으로 말하고, 못 돌았으면 그것도 말한다.
 */
function _pif_scheduled_() {
  var r;
  try {
    r = partnerFillBlankInvoices(_PIF_DAYS_);
  } catch (e) {
    try {
      _chat_sendCard_("🚨 늦은 송장 채우기가 «돌지 못했습니다»",
        Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
        [{ label: "오류", value: String(e && e.message ? e.message : e).substring(0, 200) }]);
    } catch (_) {}
    return;
  }

  Logger.log("[FILL] 채움 " + r.patched + " / 훑음 " + r.scanned +
    " / 파일 " + r.files + (r.stopped ? " / " + r.stopped : ""));

  /*  ★ 채운 것이 없으면 조용하다 ★
      날마다 「0건」이 오면 진짜 문제가 왔을 때 그 줄도 같이 흘려 보낸다.
      다만 «못 읽었을» 때는 말한다 — 조용한 것과 구분이 안 되면 안 된다.  */
  var 말할까 = r.patched > 0 || (r.notes && r.notes.length > 0) || r.stopped;
  if (!말할까) return;

  var items = [
    { label: "✅ 채운 줄", value: r.patched + "건" },
    { label: "📖 송장원장", value: (r.ledgerRows || 0) + "행" },
    { label: "📂 본 파일", value: r.files + "개 (최근 " + _PIF_DAYS_ + "일)" }
  ];
  if (r.byDay && r.byDay.length) {
    items.push({ label: "날짜별", value: r.byDay.join(" · ") });
  }
  if (r.skippedOld) {
    var 시작 = (typeof _pep_matchStart_ === "function") ? _pep_matchStart_() : "";
    items.push({ label: "안 본 날", value: 시작 + " 이전 " + r.skippedOld + "일" });
  }
  if (r.stopped) items.push({ label: "⏱", value: r.stopped });
  if (r.notes && r.notes.length) {
    items.push({ label: "⚠", value: r.notes.slice(0, 3).join(" / ").substring(0, 300) });
  }

  try {
    _chat_sendCard_("📮 늦게 온 송장을 빈 칸에 채웠습니다",
      Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"), items);
  } catch (_) {}
}

/** [메뉴] 손으로 돌리기 */
function partnerFillBlankInvoicesMenu() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  var r = partnerFillBlankInvoices(_PIF_DAYS_);

  var L = [];
  L.push("📮 늦게 온 송장 채우기 (빈 칸만)");
  L.push("");
  L.push("채운 줄: " + r.patched + "건");
  L.push("훑은 줄: " + r.scanned + "건 · 파일 " + r.files + "개 (최근 " + _PIF_DAYS_ + "일)");
  L.push("송장원장: " + (r.ledgerRows || 0) + "행");
  if (r.byDay && r.byDay.length) L.push("날짜별: " + r.byDay.join(" · "));
  if (r.skippedOld) {
    var 시작 = (typeof _pep_matchStart_ === "function") ? _pep_matchStart_() : "";
    L.push("(" + 시작 + " 이전 " + r.skippedOld + "일치는 보지 않았습니다)");
  }
  if (r.stopped) L.push("⏱ " + r.stopped);
  if (r.notes && r.notes.length) {
    L.push("");
    L.push("참고:");
    for (var i = 0; i < r.notes.length && i < 6; i++) L.push("  · " + r.notes[i]);
  }
  L.push("");
  L.push("★ 고유ID 로 맞은 것만 채웁니다. 이름·전화로 짐작하지 않습니다.");
  L.push("★ 이미 송장이 든 칸은 건드리지 않습니다.");

  var msg = L.join("\n");
  if (ui) { try { ui.alert(msg); } catch (e2) {} }
  return msg;
}
