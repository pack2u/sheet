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
 *    v2 가 실패하면 위로 던진다 — 부르는 쪽은 알리고 멈춘다(2026-10-28 부터 · 예전 GAS 마감으로 안 넘어간다).
 *    다음 20:00 이 지난 7영업일의 없는 파일을 v2 줄로 만든다. 급하면 메뉴 「통합 일일마감 (수동)」.
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

/**
 * 일일마감 주인 — "v2" · "시트" · "모름"(v2 에 못 물음)   (2026-10-28)
 *   _pt_v2Owner_ 는 못 물으면 «시트»라고 답한다. 일일마감은 그러면 안 된다 — v2 가 잠깐 안 받은 날
 *   은퇴한 시트 마감이 돌아 그날 파일을 옛 셈으로 만든다. 지난 날 파일은 v2 가 빈 송장만 채우므로
 *   그 옛 셈 줄이 영영 남는다. 못 물었으면 «모름»으로 따로 답하고, 부르는 쪽이 멈춘다.
 */
function _dcv2_owner_() {
  try {
    return String(_dcv2_call_("get").주인 || "시트");
  } catch (e) {
    Logger.log("[일일마감 주인] 못 물음: " + (e && e.message ? e.message : e));
    return "모름";
  }
}

/**
 * 하루치 — v2 줄을 파일에 적는다. 20:00 과 메뉴(재처리)가 같은 이 함수를 쓴다.
 *   오늘이거나 파일이 없으면: v2 줄로 적는다(이미 있는 줄은 _pep_appendArchiveRows_ 가 거른다)
 *   지난 날 파일이 있으면: 송장이 빈 줄만 v2 값으로 채운다
 */
function _dcv2_closeDay_(ss, dateStr, 오늘, out) {
  var j = _dcv2_call_("get", "?날=" + dateStr);
  var rows = _dcv2_numberize_(j.줄 || []);
  if (!rows.length) return;
  var 있음 = 오늘 ? null : _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")");
  if (오늘 || !있음) {
    var ar = _pep_appendArchiveRows_(ss, dateStr, j.머리, rows, {});
    if (ar.written) { out.적음 += ar.written; out.만든날.push(dateStr + " " + ar.written + "줄" + (ar.skippedDup ? "(이미 " + ar.skippedDup + ")" : "")); }
    else if (ar.skippedDup) out.만든날.push(dateStr + " 새 줄 없음(이미 " + ar.skippedDup + ")");
  } else {
    var p = _dcv2_patchDay_(dateStr, rows);
    if (p && p.채움) { out.채움 += p.채움; out.채운날.push(dateStr + " " + p.채움 + "줄"); }
    if (p && p.못함) out.오류.push(dateStr + ": " + p.못함);
  }
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
      _dcv2_closeDay_(ss, dateStr, d === 0, out);
    } catch (e) {
      out.오류.push(dateStr + ": " + (e && e.message ? e.message : e));
    }
  }
  Logger.log("[일일마감 v2] " + JSON.stringify(out));
  return out;
}

/**
 * 메뉴 「재처리 (날짜 지정)」 — v2 가 주인일 때 그 하루만   (2026-10-28)
 *   v2 에 그날까지 다시 만들게 하고(일수 = 오늘부터 그날까지, 21일까지) 20:00 과 같은 규칙으로 적는다.
 */
function _dcv2_closeOneDate_(dateStr) {
  var 오늘 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  var 일수 = Math.round((new Date(오늘 + "T00:00:00Z").getTime() - new Date(dateStr + "T00:00:00Z").getTime()) / 86400000) + 1;
  if (일수 < 1) throw new Error("앞날은 마감할 수 없습니다: " + dateStr);
  if (일수 > 21) throw new Error("v2 는 21일 전까지만 다시 만듭니다: " + dateStr);
  var tok = (typeof _psm_token_ === "function") ? _psm_token_() : "";
  var base = (typeof _psm_v2url_ === "function") ? _psm_v2url_() : "https://pack2u-partner.vercel.app";
  var res = UrlFetchApp.fetch(base + "/api/setsplit/daily-close", {
    method: "post", contentType: "application/json", payload: JSON.stringify({ 일수: 일수 }),
    headers: { "x-ingest-token": tok }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("v2 일일마감 post HTTP " + res.getResponseCode() + " " + res.getContentText().slice(0, 200));
  var jp = JSON.parse(res.getContentText());
  if (!jp.ok) throw new Error("v2 일일마감: " + (jp.error || "실패"));
  var out ={ 만든날: [], 채운날: [], 적음: 0, 채움: 0, 오류: [] };
  _dcv2_closeDay_(SpreadsheetApp.getActiveSpreadsheet(), dateStr, dateStr === 오늘, out);
  return out;
}

/** 편집기에서 — 지금 일일마감 주인 */
function partnerDailyCloseOwnerCheck() {
  var o = _dcv2_owner_();
  Logger.log("일일마감 주인: " + o);
  return o;
}
