/**
 * ══════════════════════════════════════════════════════════════
 *  v2 물류 입고 → 반품관리대장 다리   (2026-09-29)
 *  파일: csIntakeBridge.gs     v2 쪽: /api/intake/bridge · sql/65_intake_sheet_bridge.sql
 *
 *  > "V2 방식으로 만들고 데이타만 V2에서 시트나 웹앱으로 뿌려주면 되지 않아?"
 *
 *  물류 입고는 v2 /intake 에서 한다(카메라로 비춰 바코드를 읽는다 — 이 웹앱은
 *  카메라를 켜 둘 수 없다). v2 는 시트에 쓸 권한이 없으므로 **여기서 가져간다.**
 *  1분마다:
 *    ① claim  — 아직 시트에 안 간 입고를 받는다 (v2 가 잠근다)
 *    ② 대장에 쓴다 — _cs_intakeExistingReturn_ 그대로 (입고검수 · 사진 이력 · 반품송장 빈 칸)
 *       그래서 CS 카드·업체 포털은 지금과 똑같이 본다
 *    ③ 입고대장(입고_yyyyMM)에도 한 줄 — 못 붙은 것은 CS 「📷 입고 확인」 대기로
 *    ④ done  — 끝났다고 알린다. 실패는 v2 가 세 번까지 다시 준다
 *
 *  ★ 행 번호만 믿지 않는다 ★
 *    v2 가 아는 (탭, 행)은 밤 미러 때 번호다. 그 사이 줄이 밀렸을 수 있다.
 *    그 줄의 이름 + (원송장 · 전화 뒤4 · 반품송장 중 하나)가 맞을 때만 쓴다.
 *    안 맞으면 같은 탭에서 다시 찾고, 한 줄로 안 좁혀지면 쓰지 않고 확인 대기로 보낸다.
 *    **남의 반품에 입고검수를 찍는 것**이 여기서 제일 나쁜 일이다.
 *
 *  ★ 두 번 쓰지 않는다 ★
 *    대장에 쓴 뒤 done 이 v2 에 못 가면 10분 뒤 다시 온다. 입고대장 비고에
 *    「v2:<id>」를 남기고, 쓰기 전에 그것부터 본다.
 *
 *  설치: 편집기에서 csIntakeBridgeInstall() 을 한 번 실행 (허용 명단에 있는 계정으로)
 * ══════════════════════════════════════════════════════════════
 */

var _CIB_TAG_ = "v2:";

function _cib_post_(body) {
  var url = _cs_v2_url_(), tok = _cs_v2_token_();
  if (!url || !tok) return { ok: false, error: "v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)" };
  var res = UrlFetchApp.fetch(url + "/api/intake/bridge", {
    method: "post",
    contentType: "application/json",
    headers: { "x-ingest-token": tok },
    muteHttpExceptions: true,
    payload: JSON.stringify(body)
  });
  var code = res.getResponseCode(), text = res.getContentText();
  if (code !== 200) return { ok: false, error: "v2 HTTP " + code + " " + text.substring(0, 200) };
  try { return JSON.parse(text); } catch (e) { return { ok: false, error: "v2 응답을 읽지 못함: " + text.substring(0, 120) }; }
}

function _cib_norm_(v) { return String(v == null ? "" : v).replace(/\s/g, "").toLowerCase(); }
function _cib_digits_(v) { return String(v == null ? "" : v).replace(/[^0-9]/g, ""); }

/**
 * 시트의 한 줄이 v2 가 말한 그 반품인가.
 * 이름이 같고, 원송장 · 반품송장 · 전화 뒤4 중 하나가 같아야 한다.
 * (이름만 같은 사람은 흔하다 — 동명이인 96건을 본 적이 있다)
 */
function _cib_same_(col, row, ret) {
  var nm = _cib_norm_(ret.customer_name);
  var rn = col.name >= 0 ? _cib_norm_(row[col.name]) : "";
  if (!nm || !rn || nm !== rn) return false;
  var oi = _cib_digits_(ret.order_invoice), ri = _cib_digits_(ret.return_invoice), ph = _cib_digits_(ret.phone);
  var roi = col.invoice >= 0 ? _cib_digits_(row[col.invoice]) : "";
  var rri = col.returnInvoice >= 0 ? _cib_digits_(row[col.returnInvoice]) : "";
  var rph = col.phone >= 0 ? _cib_digits_(row[col.phone]) : "";
  if (oi && roi && oi === roi) return true;
  if (ri && rri && ri === rri) return true;
  if (ph.length >= 4 && rph.length >= 4 && ph.slice(-4) === rph.slice(-4)) return true;
  return false;
}

/** v2 가 말한 줄을 확인하고, 밀렸으면 같은 탭에서 다시 찾는다 → {tab,row} 또는 {miss:까닭} */
function _cib_locate_(ret) {
  if (!ret || !ret.src_tab || !ret.src_row) return { miss: "반품 건 미지정" };
  var ctx;
  try { ctx = _cs_openReturnLedgerRow_(String(ret.src_tab), parseInt(ret.src_row, 10)); }
  catch (e) { ctx = null; }
  if (ctx && ctx.row && _cib_same_(ctx.col, ctx.row, ret)) return { tab: String(ret.src_tab), row: parseInt(ret.src_row, 10) };
  if (!ctx || !ctx.tab) return { miss: "대장 탭 " + ret.src_tab + " 을 못 열었다" };

  var sh = ctx.tab, lr = sh.getLastRow();
  var vals = sh.getRange(1, 1, lr, Math.max(sh.getLastColumn(), 15)).getDisplayValues();
  var hits = [];
  for (var i = 0; i < vals.length; i++) if (_cib_same_(ctx.col, vals[i], ret)) hits.push(i + 1);
  if (hits.length === 1) return { tab: String(ret.src_tab), row: hits[0], moved: true };
  return { miss: hits.length ? "대장에 같은 건이 " + hits.length + "줄 — 못 정함" : "대장 행이 바뀌어 그 건을 못 찾음 (" + ret.src_tab + " " + ret.src_row + "행)" };
}

/** 최근 두 달 입고대장 비고에서 이미 쓴 v2 입고 id 들 */
function _cib_appliedIds_() {
  var seen = {};
  try {
    var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    var names = _csl_recentIntakeTabNames_();
    for (var t = 0; t < names.length; t++) {
      var tab = ss.getSheetByName(names[t]);
      if (!tab || tab.getLastRow() < 2) continue;
      var memo = tab.getRange(2, 13, tab.getLastRow() - 1, 1).getDisplayValues();
      for (var i = 0; i < memo.length; i++) {
        var m = String(memo[i][0] || "").match(/v2:([0-9a-f-]{36})/);
        if (m) seen[m[1]] = true;
      }
    }
  } catch (e) {}
  return seen;
}

/**
 * 올라온 사진에서 라벨 글자를 읽는다 — 서버(Gemini)에서.  (2026-09-30)
 * > "바코드 인식 → 이미지 업로드 → 서버에서 텍스트인식 → 입고확인에 텍스트 보여주기"
 *
 * 첫 장이 보통 라벨이다. 거기서 송장·원송장·보낸분을 하나도 못 건지면 둘째 장까지 본다
 * (물건부터 찍는 사람도 있다). 셋째부터는 안 본다 — 1분 트리거 안에 끝나야 한다.
 * 실패해도 입고는 그대로 간다. 글자는 «보여 주는 것»이지 막는 것이 아니다.
 */
function _cib_ocr_(photos) {
  var last = null;
  for (var i = 0; i < Math.min(2, (photos || []).length); i++) {
    try {
      var res = UrlFetchApp.fetch(photos[i], { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) { last = { error: "사진을 못 받음 HTTP " + res.getResponseCode() }; continue; }
      var blob = res.getBlob();
      var r = csOcrImageForScan(Utilities.base64Encode(blob.getBytes()), blob.getContentType() || "image/jpeg");
      var f = (r && r.fields) || null;
      if (f && (r.invoice || f.originalInvoiceNumber || f.senderName || f.senderPhone)) return r;
      last = r;
    } catch (e) {
      last = { error: String((e && e.message) || e) };
    }
  }
  return last;
}

function _cib_apply_(it, applied) {
  if (applied[it.id]) return { id: it.id, ok: true, note: "이미 대장에 있음 (다시 안 씀)" };
  var photos = it.photos || [];
  var staff = String(it.staff || "").trim() || "물류";
  var ret = it.ret || null;
  var loc = _cib_locate_(ret);
  var at = Utilities.formatDate(new Date(it.at), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var tail = _CIB_TAG_ + it.id + (it.memo ? " · " + it.memo : "");
  var tab = _csl_ensureIntakeTab_();
  var result, mTab = "", mRow = "", mName = "", mItem = "";

  if (loc.tab) {
    var r = _cs_intakeExistingReturn_(loc.tab, loc.row, it.invoice || "", staff, "v2/" + (it.via || ""), photos);
    if (!r || !r.ok) return { id: it.id, ok: false, note: "대장 쓰기 실패: " + ((r && r.error) || "알 수 없음") };
    if (it.memo) {
      //  「입고 확인 — 수량 맞음 · 파손 있음 / 메모: …」 는 물류 체크(v2 IntakeUploader) — 그대로 한 줄로 (2026-09-30)
      var memoLine = /^입고 확인\s*[—-]/.test(it.memo) ? it.memo : "물류 메모: " + it.memo;
      try { appendReturnConsultation({ tab: loc.tab, row: loc.row, text: memoLine, staff: staff }); } catch (eM) {}
    }
    mTab = loc.tab; mRow = loc.row; mName = r.name || ""; mItem = r.item || "";
    result = (r.alreadyDone ? "완료 건 · 사진만 추가" : _CS_RI_STATUS_INTAKE_ + " 처리") + " · 사진 " + photos.length + "장 · v2" + (loc.moved ? " (행 밀림 → 다시 찾음)" : "");
  } else {
    //  못 붙인 것은 CS 「📷 입고 확인」 대기로 — 처리결과가 「사진만 적재」로 시작해야 걸린다
    result = "사진만 적재 (확인 대기) · v2 · " + loc.miss;
  }

  //  라벨 글자 — F(원문)에 사람이 읽는 한 줄, N(글자인식)에 JSON. 입고 확인 화면이 쓴다
  var ocrPack = "";
  try { ocrPack = _csl_ocrPack_(_cib_ocr_(photos)); } catch (eO) { ocrPack = ""; }
  var ocrLine = _csl_ocrLine_(_csl_parseOcr_(ocrPack));

  tab.appendRow([
    at, staff, it.tier === "none" ? "미상" : "후보", "v2/" + (it.via || ""),
    it.invoice || "", ocrLine, mTab, mRow, mName, mItem, result, photos.join("\n"), tail, ocrPack
  ]);
  tab.getRange(tab.getLastRow(), 5, 1, 2).setNumberFormat("@");
  applied[it.id] = true;
  return { id: it.id, ok: true, note: result };
}

/**
 * 확인 대기 중인데 라벨 글자가 아직 없는 줄을 채운다 — 한 번에 조금씩.  (2026-09-30)
 * v2 다리가 생기기 전 줄, CS 웹앱 물류 화면에서 올린 줄에는 N(글자인식)이 없다.
 * F(원문)에 이미 무언가(바코드 원문)가 있으면 F 는 안 건드리고 N 만 채운다.
 */
function _cib_backfillOcr_(maxN) {
  var n = 0;
  try {
    var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    var names = _csl_recentIntakeTabNames_();
    for (var t = 0; t < names.length && n < maxN; t++) {
      var tab = ss.getSheetByName(names[t]);
      if (!tab || tab.getLastRow() < 2) continue;
      if (tab.getMaxColumns() < _CSL_HEADERS_.length) continue; // 옛 탭 — 머리글 늘리기는 _csl_ensureIntakeTab_ 몫
      var vals = _csl_readRows_(tab, 2, tab.getLastRow() - 1);
      for (var i = vals.length - 1; i >= 0 && n < maxN; i--) {
        var r = vals[i];
        if (!_csl_isPendingRow_(r) || String(r[13] || "").trim()) continue;
        var photos = String(r[11] || "").split(/\s+/).filter(function (u) { return /^https?:\/\//.test(u); });
        if (!photos.length) continue;
        var pack = _csl_ocrPack_(_cib_ocr_(photos)) || JSON.stringify({ error: "읽은 글자 없음" });
        tab.getRange(i + 2, 14).setValue(pack);
        if (!String(r[5] || "").trim()) tab.getRange(i + 2, 6).setValue(_csl_ocrLine_(_csl_parseOcr_(pack)));
        n++;
      }
    }
  } catch (e) {
    Logger.log("[CIB] 글자 채우기 실패: " + ((e && e.message) || e));
  }
  if (n) _csl_dropPendingCache_();
  return n;
}

/** 1분 트리거가 부른다. 손으로 불러도 된다 (결과를 돌려준다). */
function csIntakeBridgePull() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { ok: true, skipped: "다른 실행이 돌고 있음" };
  try {
    var claim = _cib_post_({ op: "claim", limit: 10 }); // 한 건에 글자 인식 3~5초 — 1분 안에 끝나게
    if (!claim.ok) { Logger.log("[CIB] claim 실패: " + claim.error); return claim; }
    var items = claim.items || [];
    //  새로 온 것이 없는 한가한 때에만 — 확인 대기 줄의 빠진 글자를 두 건씩 채운다
    if (!items.length) {
      try { _csl_ensureIntakeTab_(); } catch (eE) {}
      return { ok: true, n: 0, ocrFilled: _cib_backfillOcr_(2) };
    }

    var applied = _cib_appliedIds_(), results = [];
    for (var i = 0; i < items.length; i++) {
      try { results.push(_cib_apply_(items[i], applied)); }
      catch (e) { results.push({ id: items[i].id, ok: false, note: "오류: " + ((e && e.message) || e) }); }
    }
    var done = _cib_post_({ op: "done", results: results });
    try { csInvalidateReturnLedgerCache_(); } catch (eC) {}
    _csl_dropPendingCache_();
    Logger.log("[CIB] " + JSON.stringify({ n: items.length, done: done }));
    return { ok: true, n: items.length, results: results, done: done };
  } finally {
    lock.releaseLock();
  }
}

/** 편집기에서 한 번 실행 — 1분 트리거를 건다 (이미 있으면 새로 건다) */
function csIntakeBridgeInstall() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "csIntakeBridgePull") ScriptApp.deleteTrigger(all[i]);
  }
  ScriptApp.newTrigger("csIntakeBridgePull").timeBased().everyMinutes(1).create();
  var first = csIntakeBridgePull();
  var msg = "✅ v2 입고 다리 — 1분마다 돕니다. 첫 실행: " + JSON.stringify(first).substring(0, 300) +
    " · 트리거 " + ScriptApp.getProjectTriggers().length + "개";
  Logger.log(msg);
  return msg;
}

/** 끄기 */
function csIntakeBridgeUninstall() {
  var n = 0, all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "csIntakeBridgePull") { ScriptApp.deleteTrigger(all[i]); n++; }
  }
  return "트리거 " + n + "개 지움";
}
