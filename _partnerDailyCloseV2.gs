/**
 * ══════════════════════════════════════════════════════════════
 *  일일마감 — v2 가 셈하고 GAS 가 「일일마감_(날짜)」 파일에 적는다
 *  파일: _partnerDailyCloseV2.gs        2026-10-21
 *
 *  > 사장님: "일일마감도 v2로 넘길 준비 해줘"
 *
 *  ★ 왜 GAS 가 적나 ★  v2 서비스 계정은 드라이브에 새 파일을 못 만든다(저장 용량 0).
 *    파일은 CS·사람이 연다 — 계속 같은 자리, 같은 모양으로 만들어야 한다.
 *    그래서 «무엇을 적을지»는 v2(lib/setsplit/daily-close-v2.ts), «적는 손»은 여기.
 *
 *  ★ 스위치 ★  v2 app_flags daily_close.owner (시트 | v2). 20:00 _pep_unifiedDailyArchiveScheduled_ 가 묻는다.
 *    v2 면: ① v2 에 「다시 만들어」(POST) ② 오늘 파일 — v2 줄을 _pep_appendArchiveRows_ 로 적는다
 *           (이미 있는 줄은 그 함수가 거른다 · 서식·합계 줄도 같다)
 *           ③ 지난 7영업일 — 파일이 있으면 송장이 빈 줄만 v2 값으로 채운다(GAS 「소급 보강」과 같은 일),
 *              파일이 없으면 v2 줄로 만든다(GAS 「미생성 과거」와 같은 일)
 *    v2 가 실패하면 위로 던진다 — 부르는 쪽이 예전 GAS 마감으로 넘어간다.
 *  ★ 안 하는 것 ★  판매현황_임시기록 스냅샷(매칭이 v2 로 갔다) · v1 Supabase daily_archive(v2 는 파일을 당겨 간다) ·
 *    세트분리 사방넷_송장매칭 비우기(세트분리 시트 은퇴).
 * ══════════════════════════════════════════════════════════════
 */
var _DCV2_BACK_DAYS_ = 7;
var _DCV2_NUM_COLS_ = [2, 6, 9, 10];   // 수량 · 합계 · 단품배송비 · 묶음배송비 — v2 는 「62,400」 글자로 준다

function _dcv2_call_(method, query) {
  var tok = (typeof _psm_token_ === "function") ? _psm_token_() : "";
  var base = (typeof _psm_v2url_ === "function") ? _psm_v2url_() : "https://pack2u-partner.vercel.app";
  if (!tok) throw new Error("V2_INGEST_TOKEN 없음");
  var opt = { method: method, headers: { "x-ingest-token": tok }, muteHttpExceptions: true };
  if (method === "post") { opt.contentType = "application/json"; opt.payload = "{}"; }
  var res = UrlFetchApp.fetch(base + "/api/setsplit/daily-close" + (query || ""), opt);
  var code = res.getResponseCode();
  if (code !== 200) throw new Error("v2 일일마감 " + method + " HTTP " + code + " " + res.getContentText().slice(0, 200));
  var j = JSON.parse(res.getContentText());
  if (!j.ok) throw new Error("v2 일일마감: " + (j.error || "실패"));
  return j;
}

/** 숫자 칸은 숫자로 — 합계 줄이 Number() 로 더한다 */
function _dcv2_numberize_(rows) {
  for (var i = 0; i < rows.length; i++) {
    for (var c = 0; c < _DCV2_NUM_COLS_.length; c++) {
      var k = _DCV2_NUM_COLS_[c], v = String(rows[i][k] == null ? "" : rows[i][k]).trim();
      if (/^-?[\d,]+(\.\d+)?$/.test(v)) rows[i][k] = Number(v.split(",").join(""));
    }
  }
  return rows;
}

/** 앞 15칸 열쇠 — 쉼표·공백 차이는 같은 것으로 (파일은 숫자를 «62400» 으로, v2 는 «62,400» 으로 갖고 있다) */
function _dcv2_key_(row) {
  var out = [];
  for (var c = 0; c < 15; c++) out.push(String(row[c] == null ? "" : row[c]).split(",").join("").replace(/\s+/g, ""));
  return out.join("|");
}

/** 지난 날 파일 — 송장이 빈 줄만 v2 값으로 */
function _dcv2_patchDay_(dateStr, v2rows, 미리보기) {
  var arch = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
  if (!arch) return null;
  var tab = arch.getSheetByName("일일마감") || arch.getSheets()[0];
  var lr = tab.getLastRow(), lc = tab.getLastColumn();
  if (lr < 2) return { 채움: 0 };
  var data = tab.getRange(1, 1, lr, lc).getDisplayValues();
  var h = data[0].map(function (x) { return String(x || "").replace(/\s/g, ""); });
  var cInv = h.indexOf("운송장번호"), cSrc = h.indexOf("출처"), cCar = h.indexOf("택배사");
  if (cInv < 0 || cSrc < 0) return { 채움: 0, 못함: "운송장번호·출처 칸을 못 찾음" };
  var 큐 = {};
  for (var i = 0; i < v2rows.length; i++) {
    if (!String(v2rows[i][16] || "").trim()) continue;   // v2 도 송장이 없는 줄
    var k = _dcv2_key_(v2rows[i]);
    (큐[k] = 큐[k] || []).push(v2rows[i]);
  }
  var inv = tab.getRange(2, cInv + 1, lr - 1, 1).getValues();
  var src = tab.getRange(2, cSrc + 1, lr - 1, 1).getValues();
  var car = cCar >= 0 ? tab.getRange(2, cCar + 1, lr - 1, 1).getValues() : null;
  var 채움 = 0;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0] || "").indexOf("★ 합계") === 0) continue;
    if (String(inv[r - 1][0] || "").trim()) continue;
    var s = String(src[r - 1][0] || "").trim();
    if (s && s !== "미매칭") continue;
    var q = 큐[_dcv2_key_(data[r])];
    if (!q || !q.length) continue;
    var v = q.shift();
    inv[r - 1][0] = String(v[16]);
    src[r - 1][0] = String(v[17] || "");
    if (car && !String(car[r - 1][0] || "").trim()) car[r - 1][0] = String(v[15] || "");
    채움++;
  }
  if (채움 && !미리보기) {
    tab.getRange(2, cInv + 1, lr - 1, 1).setNumberFormat("@").setValues(inv);
    tab.getRange(2, cSrc + 1, lr - 1, 1).setValues(src);
    if (car) tab.getRange(2, cCar + 1, lr - 1, 1).setValues(car);
    SpreadsheetApp.flush();
  }
  return { 채움: 채움 };
}

/** 20:00 — v2 가 주인일 때 마감 한 판 */
function _pep_dailyCloseFromV2_() {
  var out = { 만든날: [], 채운날: [], 적음: 0, 채움: 0, 오류: [] };
  _dcv2_call_("post");   // v2 가 지난 7일 + 오늘을 다시 만든다(17초 안팎)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var now = new Date();
  for (var d = 0, 본 = 0; 본 <= _DCV2_BACK_DAYS_ && d <= 14; d++) {
    var dateStr = Utilities.formatDate(new Date(now.getTime() - d * 86400000), "Asia/Seoul", "yyyy-MM-dd");
    if (d > 0 && typeof _pt_isNonBusinessDate_ === "function" && _pt_isNonBusinessDate_(dateStr)) continue;
    본++;
    try {
      var j = _dcv2_call_("get", "?날=" + dateStr);
      var rows = _dcv2_numberize_(j.줄 || []);
      if (!rows.length) continue;
      var 있음 = d === 0 ? null : _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
      if (d === 0 || !있음) {
        var ar = _pep_appendArchiveRows_(ss, dateStr, j.머리, rows, {});
        if (ar.written) { out.적음 += ar.written; out.만든날.push(dateStr + " " + ar.written + "줄" + (ar.skippedDup ? "(이미 " + ar.skippedDup + ")" : "")); }
      } else {
        var p = _dcv2_patchDay_(dateStr, rows);
        if (p && p.채움) { out.채움 += p.채움; out.채운날.push(dateStr + " " + p.채움 + "줄"); }
        if (p && p.못함) out.오류.push(dateStr + ": " + p.못함);
      }
    } catch (e) {
      out.오류.push(dateStr + ": " + (e && e.message ? e.message : e));
    }
  }
  Logger.log("[일일마감 v2] " + JSON.stringify(out));
  return out;
}

/**
 * 편집기에서 — 미리보기. 시트에 아무것도 안 쓰고, 스위치를 v2 로 켜면 무엇이 적히고 채워질지 센다.
 *   v2 에 다시 만들게(POST) 한 번은 한다(v2 표만 바뀐다).
 */
function partnerDailyCloseV2DryRun() {
  _dcv2_call_("post");
  var now = new Date(), L = [];
  for (var d = 0, 본 = 0; 본 <= _DCV2_BACK_DAYS_ && d <= 14; d++) {
    var dateStr = Utilities.formatDate(new Date(now.getTime() - d * 86400000), "Asia/Seoul", "yyyy-MM-dd");
    if (d > 0 && _pt_isNonBusinessDate_(dateStr)) continue;
    본++;
    var rows = _dcv2_numberize_(_dcv2_call_("get", "?날=" + dateStr).줄 || []);
    var 있음 = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
    if (!있음) { L.push(dateStr + ": 파일 없음 → v2 " + rows.length + "줄로 만든다"); continue; }
    var p = _dcv2_patchDay_(dateStr, rows, true);
    L.push(dateStr + ": v2 " + rows.length + "줄 · " + (d === 0 ? "오늘(없는 줄만 붙임) · " : "") + "빈 송장 채울 줄 " + (p ? p.채움 : 0) + (p && p.못함 ? " · " + p.못함 : ""));
  }
  var msg = "일일마감 v2 미리보기 (시트에 안 씀)\n" + L.join("\n");
  Logger.log(msg);
  return msg;
}

/** 편집기에서 — 지금 일일마감 주인 */
function partnerDailyCloseOwnerCheck() {
  var o = _pt_v2Owner_("/api/setsplit/daily-close");
  Logger.log("일일마감 주인: " + o);
  return o;
}
