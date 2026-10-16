/**
 * ══════════════════════════════════════════════════════════════
 *  메일로 온 거래명세서 → v2 정산 (자동)
 *  파일: _partnerStatementMailV2.gs        2026-10-16
 *
 *  > "메일 거래명세서는 작동 되고 있나? 월~금요일 공휴일제외 오후 3시30분 부터
 *  >  5시까지 확인하고 우리 대리공급업체 시트와 비교하여 다른부분 검증해줘"
 *  > "일단 메일 거래명세서 확인하고 v2정산방에 넣어 놓고 그뒤 비교분석"
 *
 *  ★ 그동안 메일 명세서는 v2 에 «안» 들어갔다 ★
 *    v2 정산에 있는 명세서는 사람이 이미지로 올린 것(image.png)뿐이었다.
 *    10/14~16 메일로 온 로엔그린·콤콤·정희화학·후아코리아 명세서는 v2 에 없었다.
 *    _partnerStatementGmail.gs 는 메일 첨부를 «시트»(명세서_원본)에 담을 뿐 v2 로 안 보낸다.
 *
 *  ★ 새 트리거를 안 만든다 ★  (트리거는 18개까지 — gas-trigger-slots-reserve-two)
 *    5분마다 도는 발주 자동 수집(_po_collectSilentCore_)이 끝에 부른다.
 *    그 수집은 이미 주말·공휴일을 쉰다(_pt_isWeekendBlackout_). 여기서는 시각만 본다.
 *
 *  ★ 한 번에 조금씩 ★  v2 가 이미지 한 장을 AI 로 읽는 데 20~60초다.
 *    한 차례에 _PSM_MAX_FILES_ 장까지만 보내고 나머지는 10분 뒤 차례로 넘긴다.
 *
 *  ★ 같은 메일을 두 번 안 보낸다 ★  다 보낸 메일에 라벨 _PSM_LABEL_ 을 붙인다.
 *    한 장이라도 실패하면 라벨을 안 붙여 다음 차례에 다시 본다. v2 도 같은 명세서를
 *    «중복»으로 가려 셈에서 뺀다(sql/94) — 사람이 먼저 이미지로 올린 것과 겹쳐도 괜찮다.
 *
 *  검색어는 _partnerStatementGmail.gs 의 _PSTMT_GMAIL_SEARCH_BASE_ 를 쓴다 — 주인은 거기 하나다.
 * ══════════════════════════════════════════════════════════════
 */
var _PSM_LABEL_ = "P2U_v2명세올림";
var _PSM_PROP_LAST_ = "_PSM_LAST_RUN_";
var _PSM_WINDOW_FROM_ = 1530;     // 15:30
var _PSM_WINDOW_TO_ = 1700;       // 17:00
var _PSM_EVERY_MIN_ = 10;         // 창 안에서 10분에 한 번
var _PSM_MAX_FILES_ = 4;          // 자동 한 차례에 보낼 장 수 (발주 수집 끝에 붙어 돈다 — 길게 잡으면 수집이 밀린다)
var _PSM_MAX_FILES_MANUAL_ = 40;  // 손으로 누를 땐 한 번에 다 (30분 한도 · 한 장 10~60초)
var _PSM_MIN_BYTES_ = 15 * 1024;  // 서명·로고 같은 작은 그림은 명세서가 아니다

/** 자동 수집이 부른다. 창 밖이거나 10분이 안 지났으면 바로 돌아간다. */
function _psm_tick_() {
  var now = new Date();
  var hhmm = parseInt(Utilities.formatDate(now, "Asia/Seoul", "HHmm"), 10);
  if (hhmm < _PSM_WINDOW_FROM_ || hhmm > _PSM_WINDOW_TO_ + 5) return null;
  if (typeof _pt_isWeekendBlackout_ === "function" && _pt_isWeekendBlackout_()) return null;
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty(_PSM_PROP_LAST_) || 0);
  if (now.getTime() - last < (_PSM_EVERY_MIN_ - 1) * 60 * 1000) return null;
  props.setProperty(_PSM_PROP_LAST_, String(now.getTime()));
  return psmSendMailStatementsToV2_(false);
}

/** 편집기·메뉴에서 바로 — 시각 창을 안 본다 */
function partnerSendMailStatementsToV2() {
  var r = psmSendMailStatementsToV2_(true);
  try { SpreadsheetApp.getUi().alert(_psm_summary_(r)); } catch (e) { Logger.log(_psm_summary_(r)); }
  return r;
}

function _psm_v2url_() {
  var u = "";
  try { if (typeof V2_URL !== "undefined" && V2_URL) u = String(V2_URL); } catch (e) {}
  if (!u) { try { u = PropertiesService.getScriptProperties().getProperty("V2_URL") || ""; } catch (e) {} }
  return (u || "https://pack2u-partner.vercel.app").replace(/\/+$/, "");
}
function _psm_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || ""; } catch (e) {}
  return "";
}

/** 명세서로 볼 첨부인가 — 메일 서비스가 JPG 를 octet-stream 으로 보내 와서 이름으로 본다 */
function _psm_isStatementFile_(name, mime, size) {
  var n = String(name || "").toLowerCase();
  var m = String(mime || "").toLowerCase();
  if (size && size < _PSM_MIN_BYTES_ && !/\.(xlsx?|pdf)$/.test(n)) return false;
  if (/\.(jpe?g|png|pdf|xlsx|xls)$/.test(n)) return true;
  return /^image\/(jpe?g|png)$|pdf|spreadsheet|ms-excel/.test(m);
}

function _psm_mimeFor_(name, mime) {
  var n = String(name || "").toLowerCase();
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  if (/\.png$/.test(n)) return "image/png";
  if (/\.pdf$/.test(n)) return "application/pdf";
  if (/\.xlsx$/.test(n)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.xls$/.test(n)) return "application/vnd.ms-excel";
  return mime || "application/octet-stream";
}

function psmSendMailStatementsToV2_(manual) {
  var out = { mails: 0, sent: 0, dup: 0, failed: 0, skipped: 0, items: [], errors: [], more: false };
  var tok = _psm_token_();
  if (!tok) { out.errors.push("V2_INGEST_TOKEN 없음 (_secrets.gs)"); return out; }
  var base = (typeof _PSTMT_GMAIL_SEARCH_BASE_ !== "undefined") ? _PSTMT_GMAIL_SEARCH_BASE_
    : "in:inbox -from:me has:attachment newer_than:14d (subject:명세서 OR subject:명세표 OR 마감)";
  //  시트 적재용 라벨(P2U_명세처리완료)은 상관없다 — v2 로 보냈는지는 우리 라벨로 본다
  var q = base.replace(/-label:\S+/g, "").replace(/newer_than:\d+d/, "newer_than:3d") +
    " -label:" + _PSM_LABEL_;
  var label = GmailApp.getUserLabelByName(_PSM_LABEL_) || GmailApp.createLabel(_PSM_LABEL_);
  var threads = GmailApp.search(q, 0, manual ? 60 : 30);
  var budget = manual ? _PSM_MAX_FILES_MANUAL_ : _PSM_MAX_FILES_;
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    var allOk = true, touched = false;
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      if (String(msg.getFrom()).indexOf("pack2u@pack2u.co.kr") !== -1) continue;
      var atts = msg.getAttachments({ includeInlineImages: false });
      for (var a = 0; a < atts.length; a++) {
        var att = atts[a];
        var nm = att.getName(), sz = att.getSize();
        if (!_psm_isStatementFile_(nm, att.getContentType(), sz)) { out.skipped++; continue; }
        if (budget <= 0) { out.more = true; allOk = false; break; }
        budget--; touched = true;
        var r = _psm_postOne_(att, tok);
        var row = { from: msg.getFrom(), subject: msg.getSubject(), file: nm, ok: r.ok,
          vendor: r.vendor || "", total: r.total || "", dup: !!r.duplicate, mismatch: !!r.mismatch,
          id: r.id || "", error: r.error || "" };
        out.items.push(row);
        if (!r.ok) { out.failed++; allOk = false; out.errors.push(nm + " — " + r.error); }
        else if (r.duplicate) out.dup++;
        else out.sent++;
      }
      if (budget <= 0 && out.more) break;
    }
    out.mails++;
    if (allOk && touched) threads[t].addLabel(label);
    else if (allOk && !touched) threads[t].addLabel(label);   // 명세서 첨부가 없던 메일 — 다시 안 본다
    if (budget <= 0 && out.more) break;
  }
  if (out.items.length) {
    try { if (typeof _chat_sendText_ === "function") _chat_sendText_(_psm_summary_(out)); } catch (eC) {}
  }
  Logger.log("[PSM] " + JSON.stringify({ mails: out.mails, sent: out.sent, dup: out.dup, failed: out.failed, more: out.more }));
  return out;
}

function _psm_postOne_(att, tok) {
  try {
    var blob = Utilities.newBlob(att.getBytes(), _psm_mimeFor_(att.getName(), att.getContentType()), att.getName());
    var res = UrlFetchApp.fetch(_psm_v2url_() + "/api/statements/ingest", {
      method: "post",
      headers: { "x-ingest-token": tok },
      payload: { file: blob },
      muteHttpExceptions: true,
      followRedirects: true,
    });
    var code = res.getResponseCode(), body = res.getContentText();
    if (code !== 200) {
      var e = ""; try { e = (JSON.parse(body) || {}).error || ""; } catch (x) {}
      return { ok: false, error: "v2 응답 " + code + (e ? " — " + e : "") };   // ★ 표는 절대 싣지 않는다
    }
    var j = JSON.parse(body), r = (j.results || [])[0] || {};
    return { ok: !!r.ok, error: r.error || "", id: r.id || "", vendor: r.vendor || "",
      duplicate: !!r.duplicate, mismatch: !!r.mismatch, total: r.total || r.doc_total || "" };
  } catch (e2) {
    return { ok: false, error: String(e2 && e2.message || e2) };
  }
}

function _psm_summary_(r) {
  var L = ["📧 메일 거래명세서 → v2 정산",
    "보냄 " + r.sent + " · 이미 있음(중복) " + r.dup + " · 실패 " + r.failed + (r.more ? " · 남은 것 다음 차례(10분)" : "")];
  for (var i = 0; i < r.items.length && i < 12; i++) {
    var it = r.items[i];
    L.push((it.ok ? (it.dup ? "↺ " : "✓ ") : "✗ ") + (it.vendor || it.subject) +
      (it.mismatch ? " ⚠합계 안 맞음" : "") + (it.ok ? "" : " — " + it.error));
  }
  if (r.errors.length && !r.items.length) L.push("⚠ " + r.errors.join(" / "));
  L.push(_psm_v2url_() + "/settlement");
  return L.join("\n");
}
