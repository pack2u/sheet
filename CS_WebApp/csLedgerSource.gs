/**
 * ══════════════════════════════════════════════════════════════
 *  주문라인원장을 어디서 읽나 — 세트분리 시트 ↔ v2 창구   (2026-10-21 · 3단계-3)
 *
 *  > 사장님: "3단계도 진행해줘" — 세트분리 시트를 멈추려면 CS웹앱이 원장을 v2 에서 읽어야 한다.
 *
 *  스크립트 속성 「원장원천」
 *    (없음·sheet)  지금처럼 세트분리 시트 「주문라인원장」
 *    v2            v2 /api/setsplit/ledger (ss_ledger) — 같은 머리글·같은 행 차례·글자(getDisplayValues 와 같은 꼴)
 *                   10/21 끝 8,000줄 48칸 맞대기: 다름 0
 *  ★ v2 를 못 부르면 시트로 물러선다 ★ (시트를 끄기 전까지) — 그 사실은 로그에 남긴다.
 *
 *  쓰는 곳: csLogenShipSlips · csLogenOutStale · csLogenPickupCheck · csLogenZoneCache · csLogenShipRegister
 * ══════════════════════════════════════════════════════════════
 */
function _cs_ledgerSource_() {
  var m = "";
  try { m = String(PropertiesService.getScriptProperties().getProperty("원장원천") || "").trim(); } catch (e) {}
  return m === "v2" ? "v2" : "sheet";
}

/**
 * 머리글 + 끝에서 n 줄.
 * @return {{head: string[], rows: string[][], 원천: string}}  rows 는 시트 차례(위→아래)
 */
function _cs_ledgerTail_(n) {
  if (_cs_ledgerSource_() === "v2") {
    try {
      var url = _cs_v2_url_(), tok = _cs_v2_token_();
      if (!url || !tok) throw new Error("V2_URL · V2_INGEST_TOKEN 이 없습니다");
      var res = UrlFetchApp.fetch(url + "/api/setsplit/ledger?tail=" + Number(n), {
        method: "get", headers: { "x-ingest-token": tok }, muteHttpExceptions: true
      });
      var j = null;
      try { j = JSON.parse(res.getContentText()); } catch (e1) {}
      if (res.getResponseCode() !== 200 || !j || j.ok !== true) {
        throw new Error("HTTP " + res.getResponseCode() + " " + String((j && (j.error || j.why)) || "").slice(0, 120));
      }
      return { head: j.머리 || [], rows: j.몸통 || [], 원천: "v2" };
    } catch (e) {
      Logger.log("[원장원천] v2 를 못 읽어 시트로 물러섭니다 — " + (e && e.message ? e.message : e));
    }
  }
  var ss = SpreadsheetApp.openById(_CS_LEDGER_SS_ID_);
  var tab = ss.getSheetByName("주문라인원장");
  if (!tab) throw new Error("「주문라인원장」 탭이 없습니다");
  var lastRow = tab.getLastRow();
  if (lastRow < 2) return { head: [], rows: [], 원천: "sheet" };
  var lastCol = tab.getLastColumn();
  var head = tab.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var from = Math.max(2, lastRow - Number(n) + 1);
  var rows = tab.getRange(from, 1, lastRow - from + 1, lastCol).getDisplayValues();
  return { head: head, rows: rows, 원천: "sheet" };
}

/** 편집기에서 ▶ — 두 원천의 끝 n 줄이 같은지 (원장원천 을 v2 로 바꾸기 전에) */
function csLedgerSourceCheck() {
  var 옛 = PropertiesService.getScriptProperties().getProperty("원장원천");
  var p = PropertiesService.getScriptProperties();
  p.setProperty("원장원천", "sheet"); var a = _cs_ledgerTail_(3000);
  p.setProperty("원장원천", "v2");    var b = _cs_ledgerTail_(3000);
  if (옛) p.setProperty("원장원천", 옛); else p.deleteProperty("원장원천");
  var 다름 = 0, 예 = [];
  var n = Math.min(a.rows.length, b.rows.length);
  for (var k = 0; k < n; k++) {
    var x = a.rows[a.rows.length - n + k], y = b.rows[b.rows.length - n + k];
    for (var c = 0; c < 48; c++) {
      if (String(x[c] == null ? "" : x[c]) !== String(y[c] == null ? "" : y[c])) { 다름++; if (예.length < 5) 예.push(k + " 칸" + c + " 시트=" + x[c] + " v2=" + y[c]); break; }
    }
  }
  var 글 = "시트 " + a.rows.length + "줄(" + a.원천 + ") · v2 " + b.rows.length + "줄(" + b.원천 + ") · 다른 줄 " + 다름 + (예.length ? "\n" + 예.join("\n") : "");
  Logger.log(글);
  return 글;
}

/** 원천 바꾸기 — 편집기에서 ▶ */
function csLedgerSourceV2() { PropertiesService.getScriptProperties().setProperty("원장원천", "v2"); Logger.log("원장원천 = " + _cs_ledgerSource_()); }
function csLedgerSourceSheet() { PropertiesService.getScriptProperties().deleteProperty("원장원천"); Logger.log("원장원천 = " + _cs_ledgerSource_()); }
