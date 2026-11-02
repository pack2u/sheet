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
  //  동영상은 안 읽는다 (2026-10-01) — 50MB 를 받아 Gemini 에 넣으면 1분 안에 못 끝난다
  photos = (photos || []).filter(function (u) { return !_cs_isVideoUrl_(u); });
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

  /*  ★ 재검수 결과 (2026-10-02, v2 sql/74) ★
      물류가 v2 입고 화면에서 「이상 없음 / 문제 있음 / 확인 못 함」을 누른 것. 사진이 없다.
      상태·반품송장·사진은 «안 건드리고» 처리 경과(비고)에 한 줄만 — it.memo 가 그 줄이다
      (「재검수 결과 — 문제 있음 · 뚜껑 사용 흔적 (사안: 미사용확인요망)」).
      대장 「재검수사안」 칸도 그대로 둔다 — 무엇을 볼지 적는 사람의 칸이다.
      appendReturnConsultation 을 안 거치는 까닭: 트리거에서 접근 검사에 걸리면 조용히
      빠지는데, 이 줄은 «그것이 전부»라 빠지면 안 된다. 같은 일을 직접 하고 실패를 돌려준다. */
  if (it.via === "recheck") {
    if (!loc.tab) return { id: it.id, ok: false, note: "재검수 결과 — 대장에서 그 건을 못 찾음 · " + loc.miss };
    var line = String(it.memo || "").replace(/\s+/g, " ").trim();
    if (!line) return { id: it.id, ok: false, note: "재검수 결과 — 적을 글이 없음" };
    try {
      var ctx = _cs_openReturnLedgerRow_(loc.tab, loc.row);
      if (ctx.col.notice < 0) return { id: it.id, ok: false, note: "재검수 결과 — 비고 열을 못 찾음" };
      var notice = _cs_appendNoticeLine_(String(ctx.row[ctx.col.notice] || "").trim(), _cs_ledgerStamp_(staff) + " " + line);
      ctx.tab.getRange(loc.row, ctx.col.notice + 1).setValue(notice);
      try { csInvalidateReturnLedgerCache_(); } catch (eC) {}
    } catch (eR) {
      return { id: it.id, ok: false, note: "재검수 결과 쓰기 실패: " + (eR.message || eR) };
    }
    //  기록 탭에도 한 줄 — _cib_appliedIds_ 가 M열 v2:id 로 «이미 적음»을 안다 (두 번 안 쓴다)
    tab.appendRow([
      at, staff, "후보", "v2/recheck", "", "", loc.tab, loc.row,
      (ret && ret.customer_name) || "", (ret && ret.item_name) || "",
      it.result || "재검수 결과", "", tail, ""
    ]);
    applied[it.id] = true;
    return { id: it.id, ok: true, note: it.result || "재검수 결과" };
  }

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

/**
 * v2 주문·송장 「반품대장 기록」 요청 → 대장   (2026-10-27, v2 sql/226 · /api/returns/ledger-queue)
 * > 사장님: "CS 문의로 남기기랑 반품대장 기록도 옮겨줘"
 * 입고와 같은 다리를 탄다(새 트리거 없음). 적는 것은 _cs_submitReturnLedger_ — 이 웹앱 「반품대장 기록」과 같은 함수.
 * 같은 송장이 있으면 duplicate 로 돌려준다 — v2 화면이 「그래도 추가」(force)로 다시 보낸다.
 */
function _cib_ledgerQueue_() {
  var url = _cs_v2_url_(), tok = _cs_v2_token_();
  if (!url || !tok) return { ok: false, error: "v2 주소나 토큰이 없습니다" };
  var post = function (body) {
    var res = UrlFetchApp.fetch(url + "/api/returns/ledger-queue", {
      method: "post", contentType: "application/json", headers: { "x-ingest-token": tok },
      muteHttpExceptions: true, payload: JSON.stringify(body)
    });
    if (res.getResponseCode() !== 200) return { ok: false, error: "v2 HTTP " + res.getResponseCode() + " " + res.getContentText().substring(0, 200) };
    try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: "v2 응답을 읽지 못함" }; }
  };
  var claim = post({ op: "claim", limit: 5 });
  if (!claim.ok) { Logger.log("[CIB 대장] claim 실패: " + claim.error); return claim; }
  var items = claim.items || [];
  if (!items.length) return { ok: true, n: 0 };
  var results = [];
  for (var i = 0; i < items.length; i++) {
    try { results.push(_cib_ledgerOne_(items[i])); }
    catch (e) { results.push({ id: items[i].id, success: false, error: String((e && e.message) || e) }); }
  }
  var done = post({ op: "done", results: results });
  Logger.log("[CIB 대장] " + JSON.stringify({ n: items.length, results: results, done: done }).substring(0, 500));
  return { ok: true, n: items.length, results: results };
}

/**
 * 요청 한 건 — 품목이 여럿(합포장)이면 차례로, 사진은 첫 줄에.   (2026-10-28)
 * > 사장님: "사진 붙이기랑 합포장 품목 고르기도 해줘"
 * home.html submitLedgerMany 와 같은 규칙:
 *   첫 줄만 중복을 묻는다(그 요청의 force). 둘째부터는 같은 송장이라 force — 안 그러면 첫 줄 때문에 늘 「중복」이다.
 *   중간에 실패하면 거기서 멈추고 몇 건까지 들어갔는지 말한다 — 조용히 반만 들어가면 안 된다.
 *   사진은 첫 줄에만(같은 상자를 찍은 것) — 적는 건 csAttach.gs _cs_attRecord_ (이 웹앱 사진 첨부와 같은 줄 모양).
 * d.items 가 없으면 d 하나가 한 줄이다(예전 요청).
 */
/**
 * 보드 요청 한 줄 — v2 작업화면 보드(2026-10-29 작업화면 ⑨). 시트 보드가 주인이고, 밤 미러가 v2 로 다시 가져간다.
 *   board          자동 글(취소 클레임 등) — 작성자 「자동」
 *   board_create   새 카드 → 결과 ref = 시트 카드 ID (v2 가 그 카드의 src_key 를 「이관:보드:ID」로 묶는다 — 두 장 안 되게)
 *   board_note · board_edit · board_note_edit · board_note_delete · board_done · board_delete · board_mention
 * 전달 고치기·지우기는 시트의 «그 줄 전체»(raw)로 찾는다 — v2 는 시각(yyMMdd HH:mm)·작성자·본문을 보내고 여기서 그 줄을 찾는다.
 */
function _cib_board_(it, d, staff) {
  var k = String(d.kind), r;
  var who = staff || "CS";
  var 끝 = function (res, okMsg) {
    res = res || {};
    return res.ok === false ? { id: it.id, success: false, error: res.error || "보드에 못 적었습니다" }
                            : { id: it.id, success: true, message: res.message || okMsg, ref: res.id || "" };
  };
  if (k === "board") {
    r = csCreateHandoffCard({ board: d.board || "cs", level: d.level || "주의", staff: "자동",
      title: String(d.title || "").slice(0, 200), body: String(d.body || ""), link: d.link || "" });
    return 끝(r, "보드에 올렸습니다");
  }
  if (k === "board_create") {
    r = csCreateHandoffCard({ board: d.board || "cs", level: d.level || "일반", staff: who, title: d.title || "", body: d.body || "",
      link: d.link || "", custName: d.custName || "", phone: d.phone || "", invoice: d.invoice || "", item: d.item || "", to: d.to || [] });
    return 끝(r, "카드를 올렸습니다");
  }
  var ref = { board: d.board || "", id: d.id || "", staff: who };
  if (!ref.id) return { id: it.id, success: false, error: "시트 카드 ID 가 없습니다 (v2 에만 있는 카드)" };
  if (k === "board_note") { ref.text = d.text || ""; return 끝(csAddHandoffNote(ref), "전달 내용을 적었습니다"); }
  if (k === "board_edit") {
    ["title", "body", "level", "link"].forEach(function (f) { if (d[f] !== undefined && d[f] !== null) ref[f] = d[f]; });
    return 끝(csEditHandoffCard(ref), "카드를 고쳤습니다");
  }
  if (k === "board_done") return 끝(d.done ? csCompleteHandoffCard(ref) : csReopenHandoffCard(ref), d.done ? "완료로 내렸습니다" : "다시 열었습니다");
  if (k === "board_delete") return 끝(csDeleteHandoffCard(ref), "카드를 지웠습니다");
  if (k === "board_mention") { ref.to = d.to || []; return 끝(csSetHandoffMention(ref), "지목을 바꿨습니다"); }
  if (k === "board_note_edit" || k === "board_note_delete") {
    var raw = _cib_noteRaw_(ref.board, ref.id, d.at || "", d.oldBody || "");
    if (!raw) return { id: it.id, success: false, error: "시트에서 그 전달 줄을 못 찾았습니다 (이미 고쳤거나 지웠을 수 있습니다)" };
    ref.raw = raw;
    if (k === "board_note_edit") { ref.text = d.text || ""; return 끝(csEditHandoffNote(ref), "전달 내용을 고쳤습니다"); }
    return 끝(csDeleteHandoffNote(ref), "전달 내용을 지웠습니다");
  }
  return { id: it.id, success: false, error: "모르는 보드 요청: " + k };
}

/** 전달 줄 찾기 — 「[yyMMdd HH:mm 작성자] 본문」 중 시각이 같고 본문이 같은 줄 (본문은 공백을 눌러 견준다) */
function _cib_noteRaw_(board, id, at, body) {
  var b = board || _cs_hb_boardOfId_(id);
  var tab = _cs_hb_getTab_(b);
  var sheetRow = _cs_hb_findRow_(tab, id);
  if (sheetRow < 2) return "";
  var cell = String(tab.getRange(sheetRow, _CS_HB_COL_.notes + 1).getDisplayValue() || "");
  var 눌러 = function (s) { return String(s || "").replace(/\s+/g, " ").trim(); };
  var lines = cell.split(/\r?\n/), want = 눌러(body);
  var 같은글 = [];
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].trim().match(/^\[(\d{6}\s+\d{1,2}:\d{2})\s+[^\]]*\]\s*(.*)$/);
    if (!m) continue;
    //  여러 줄짜리 전달은 다음 머리 줄 전까지 이어 붙여 견준다
    var 본문 = m[2];
    for (var j = i + 1; j < lines.length && !/^\[\d{6}\s+\d{1,2}:\d{2}/.test(lines[j].trim()); j++) 본문 += " " + lines[j].trim();
    if (눌러(본문) !== want) continue;
    if (!at || 눌러(m[1]) === 눌러(at)) return lines[i].trim();
    같은글.push(lines[i].trim());
  }
  //  시각이 1분쯤 어긋난다(v2 에서 쓴 줄은 다리가 시트에 적은 때가 찍힌다) — 같은 글이 «하나뿐»이면 그 줄
  return 같은글.length === 1 ? 같은글[0] : "";
}

function _cib_ledgerOne_(it) {
  var d = it.data || {};
  var staff = String(it.staff || d.staff || "").trim();
  //  v2 작업화면 반품 카드 단추 (2026-10-29) — 새 줄이 아니라 «있는 줄»을 고친다. 이 웹앱 카드 단추와 같은 본체
  if (d.kind === "edit") return _cib_cardEdit_(it, d, staff);
  if (d.kind === "pickup") return _cib_cardPickup_(it, d, staff);
  //  v2 반품 카드 「✏ 수정」 (2026-11-02) — 이 웹앱 크게 보기 편집판(updateReturnLedgerFields)과 같은 본체
  if (d.kind === "fields") return _cib_cardFields_(it, d, staff);
  //  v2 반품 카드 「업체가 새로 올렸습니다 · 확인」 · 「입고 요청」 (2026-10-29 작업화면 ⑦) — 이 웹앱 카드와 같은 본체
  if (d.kind === "check") {
    var rc = _cs_markReturnChecked_({ tab: d.tab, row: d.row, staff: staff || "CS" }) || {};
    return rc.ok ? { id: it.id, success: true, message: rc.already ? "이미 다른 분이 확인했습니다" : "CS 확인을 적었습니다", sheet: d.tab, row: d.row }
                 : { id: it.id, success: false, error: rc.error || "확인을 못 적었습니다", sheet: d.tab, row: d.row };
  }
  if (d.kind === "intakereq") {
    var ri = _cs_setReturnIntakeReq_({ tab: d.tab, row: d.row, text: d.text || "", staff: staff || "CS" }) || {};
    return ri.ok ? { id: it.id, success: true, message: ri.message || "입고 요청을 남겼습니다", sheet: d.tab, row: d.row }
                 : { id: it.id, success: false, error: ri.error || "입고 요청을 못 남겼습니다", sheet: d.tab, row: d.row };
  }
  //  ★ 보드 — v2 작업화면에서 쓴 것을 «시트 보드»(주인)에 (2026-10-29) ★ 이 웹앱 보드 단추와 같은 함수(cs…HandoffCard)
  //    그 함수들 맨 앞 문지기는 트리거에서 늘 막힌다 — 이 실행 동안만 «믿는 부름»으로 연다
  if (/^board/.test(String(d.kind || ""))) {
    _CS_AC_TRUSTED_ = true;
    try { return _cib_board_(it, d, staff); }
    catch (eB) { return { id: it.id, success: false, error: "보드: " + ((eB && eB.message) || eB) }; }
    finally { _CS_AC_TRUSTED_ = false; }
  }
  //  v2 작업화면 「📷 입고 확인」 (2026-10-29) — 이 웹앱 lgwResolve 와 같은 본체(csLogisticsResolve)
  if (d.kind === "lgw") return _cib_lgw_(it, d, staff);
  if (d.kind === "note") {
    //  상담·메모·전화 — 이 웹앱 카드(appendReturnConsultation)와 같은 본체. 비고에 한 줄 쌓인다
    var rn = _cs_appendReturnConsultation_({ tab: d.tab, row: d.row, text: d.text || "", staff: staff || "CS" }) || {};
    return rn.ok ? { id: it.id, success: true, message: rn.message || "남겼습니다", sheet: d.tab, row: d.row }
                 : { id: it.id, success: false, error: rn.error || "대장에 못 남겼습니다", sheet: d.tab, row: d.row };
  }
  var 줄들 = Array.isArray(d.items) && d.items.length ? d.items : [{}];
  var 공통 = {};
  for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k) && k !== "items" && k !== "photos" && k !== "photoMemo") 공통[k] = d[k];
  var 적힌 = [], first = null;
  for (var n = 0; n < 줄들.length; n++) {
    var one = {};
    for (var a in 공통) one[a] = 공통[a];
    for (var b in 줄들[n]) if (Object.prototype.hasOwnProperty.call(줄들[n], b)) one[b] = 줄들[n][b];
    one.staff = staff;
    one.force = n === 0 ? !!it.force : true;
    var r = _cs_submitReturnLedger_(one) || {};
    if (n === 0 && r.duplicate && !one.force) {
      return { id: it.id, success: false, duplicate: true, message: r.message || "같은 송장이 대장에 있습니다" };
    }
    if (!r.success) {
      return { id: it.id, success: false, error: "(" + (n + 1) + "/" + 줄들.length + ") " + (r.error || r.message || "기록 실패") +
        (적힌.length ? " — " + 적힌.length + "건까지는 들어갔습니다 (" + 적힌.join(", ") + ")" : ""), sheet: first ? first.sheet : "", row: first ? first.row : null };
    }
    if (!first) first = r;
    적힌.push(r.sheet + " " + r.row + "행");
  }
  var 말 = 줄들.length > 1 ? 줄들.length + "건 기록했습니다 — " + first.sheet + " 탭 " + 적힌.map(function (x) { return x.split(" ")[1]; }).join("·") : (first.message || "");

  //  사진 — v2 가 보관소(return-photos)에 이미 올렸다. 주소만 받아 적는다
  var photos = (d.photos || []).filter(function (u) { return /^https:\/\//.test(String(u || "")); }).slice(0, 12);
  if (photos.length) {
    try {
      var ctx = _cs_openReturnLedgerRow_(first.sheet, first.row);
      var who = String(줄들[0].name || 공통.name || "").replace(/[\\/:*?"<>|\[\]\s]/g, "").substring(0, 20) || "반품";
      var saved = photos.map(function (u, ix) { return { fileName: who + "_" + first.sheet + "_" + first.row + "_v2_" + (ix + 1), url: u }; });
      _cs_attRecord_(ctx, first.sheet, first.row, staff, who, saved, d.photoMemo || "");
      말 += " · 사진 " + photos.length + "장 첨부";
    } catch (eP) {
      //  대장 줄은 들어갔다 — 실패로 돌리면 「그래도 추가」로 한 줄 더 생긴다. 성공으로 두고 사진만 못 붙었다고 말한다
      말 += " · ⚠ 사진은 못 붙였습니다: " + ((eP && eP.message) || eP) + " — CS 웹앱 반품 탭에서 붙여 주세요";
    }
  }
  return { id: it.id, success: true, message: 말, row: first.row, sheet: first.sheet, rows: 적힌 };
}

/**
 * v2 반품 카드 — 반품송장 저장 · 실번호 고침 · 완료처리 · 상태 바꾸기   (2026-10-29)
 * > 사장님: "작업화면 구조를 CS웹앱(V1)의 모양 그대로 … 기능도"
 * 이 웹앱 카드 단추(retInvSave · retPh2 · retCompleteNow)가 부르는 updateReturnLedgerStatus 본체 그대로다.
 * v2 는 대장에 못 쓰고, v2 에서 상태를 바꾸면 밤 미러가 되돌린다(v2 sql/59) — 그래서 여기로 온다.
 */
function _cib_cardEdit_(it, d, staff) {
  var r = _cs_updateReturnLedgerStatus_({
    tab: d.tab, row: d.row, status: d.status, staff: staff || "CS",
    returnInvoice: d.returnInvoice || "", phone2: d.phone2 || "", phone2Name: d.phone2Name || ""
  }) || {};
  if (!r.ok) return { id: it.id, success: false, error: r.error || "대장에 못 적었습니다", sheet: d.tab, row: d.row };
  return { id: it.id, success: true, message: r.message || "적었습니다", sheet: d.tab, row: d.row };
}

/**
 * v2 반품 카드 「✏ 수정」 — 대장 여러 칸을 한 번에   (2026-11-02)
 * > 사장님: "반품 카드 오른쪽 상단에 수정할수 있는 것들을 넣어줘(반품대장까지 갈 필요 없이)"
 * 이 웹앱 retEditSave 가 부르는 updateReturnLedgerFields 본체 그대로다 — 바뀐 칸만 적고 비고에 «앞 → 뒤».
 */
function _cib_cardFields_(it, d, staff) {
  var r = _cs_updateReturnLedgerFields_({
    tab: d.tab, row: d.row, staff: staff || "CS", fields: d.fields || {}, cause: d.cause || null
  }) || {};
  if (!r.ok) return { id: it.id, success: false, error: r.error || "대장에 못 적었습니다", sheet: d.tab, row: d.row };
  var 말 = r.changed ? r.changed + "칸 고쳤습니다" : "바뀐 칸이 없습니다";
  if (r.missing && r.missing.length) 말 += " · 이 달 탭에 없는 칸이라 못 적음: " + r.missing.join(", ");
  return { id: it.id, success: true, message: 말, sheet: d.tab, row: d.row };
}

/**
 * v2 반품 카드 「반품접수」 — 택배사에 회수 기사를 부른다   (2026-10-29)
 * 이 웹앱 카드 단추(_retPickupSend_)가 부르는 csLotteReturnPickupFromCard 본체 그대로다(로젠·롯데를 거기서 가른다).
 * ★ 두 번 나가면 기사가 두 번 온다 ★ 이 요청 줄은 한 번만 잡힌다(claim 잠금) — 실패면 다시 잡지 않게 실패로 닫는다.
 */
function _cib_cardPickup_(it, d, staff) {
  var r = _cs_returnPickupFromCard_({ tab: d.tab, row: d.row, only: d.only || null, staff: staff || "CS" }) || {};
  var 송장 = r.invoices || [], 접수 = r.takeNos || [];
  if (!송장.length && !접수.length) return { id: it.id, success: false, error: r.error || "회수 접수 실패", sheet: d.tab, row: d.row };
  var 말 = 송장.length ? "회수 접수 — 반품송장 " + 송장.join(", ") : "회수 접수 — 접수번호 " + 접수.join(", ") + " (로젠은 출력 뒤 송장이 나옵니다)";
  if (r.error) 말 += " · ⚠ " + r.error;
  return { id: it.id, success: true, message: 말, sheet: d.tab, row: d.row };
}

/**
 * v2 작업화면 「📷 입고 확인」 — 확인 대기 사진을 반품 건에 붙이거나(attach) 대상 아님으로 닫는다(dismiss)   (2026-10-29)
 * 이 웹앱 lgwResolve → csLogisticsResolve 와 같은 본체 · 같은 잠금 · 같은 「아직 대기인가」 검사.
 * ★ 붙일 줄은 v2 가 아는 (탭, 행)을 그대로 믿지 않는다 ★ _cib_locate_ 로 이름 + 원송장·반품송장·전화 뒤4 를 확인한다
 *   (밤 미러 뒤 줄이 밀렸을 수 있다 — 남의 반품에 입고검수를 찍는 것이 제일 나쁜 일이다).
 */
function _cib_lgw_(it, d, staff) {
  var p = { intakeTab: d.intakeTab, intakeRow: d.intakeRow, action: d.action, staff: staff || "CS", reason: d.reason || "" };
  if (d.action === "attach") {
    var loc = _cib_locate_(d.ret || null);
    if (!loc.tab) return { id: it.id, success: false, error: "대장에서 그 건을 못 정했습니다 — " + loc.miss };
    p.tab = loc.tab; p.row = loc.row;
  }
  var r;
  _CS_AC_TRUSTED_ = true;
  try { r = csLogisticsResolve(p) || {}; }
  catch (eL) { r = { ok: false, error: (eL && eL.message) || String(eL) }; }
  finally { _CS_AC_TRUSTED_ = false; }
  try { csIntakeWaitPushToV2(true); } catch (eP) {}
  try { csInvalidateReturnLedgerCache_(); } catch (eC) {}
  return r.ok ? { id: it.id, success: true, message: r.message || "처리했습니다", sheet: p.tab || "", row: p.row || null }
              : { id: it.id, success: false, error: r.error || "처리하지 못했습니다" };
}

/*  ★ 확인 대기 목록 → v2 (2026-10-29 작업화면 「📷 입고 확인」) ★
    목록의 주인은 이 시트(입고_yyyyMM K열)다 — 이 웹앱에서 붙여도, v2 에서 붙여도 여기 한 곳이 바뀐다.
    v2 는 시트를 못 읽으므로 csLogisticsPending 결과를 5분마다(붙이거나 새 입고가 오면 바로) 민다.
    못 읽었으면 밀지 않는다 — 빈 목록으로 덮으면 «대기 0건»으로 보인다.  */
var _CIB_WAIT_PUSH_KEY_ = "cib_wait_push_at";
var _CIB_WAIT_PUSH_EVERY_ = 5 * 60 * 1000;
function csIntakeWaitPushToV2(force) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty(_CIB_WAIT_PUSH_KEY_) || 0);
  if (!force && Date.now() - last < _CIB_WAIT_PUSH_EVERY_) return { ok: true, skipped: "아직 5분 안 됨" };
  var url = _cs_v2_url_(), tok = _cs_v2_token_();
  if (!url || !tok) return { ok: false, error: "v2 주소나 토큰이 없습니다" };
  var r;
  _CS_AC_TRUSTED_ = true;
  try { r = csLogisticsPending(true); } finally { _CS_AC_TRUSTED_ = false; }
  props.setProperty(_CIB_WAIT_PUSH_KEY_, String(Date.now()));
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || "확인 대기를 못 읽었습니다 — 밀지 않습니다" };
  var res = UrlFetchApp.fetch(url + "/api/intake/wait", {
    method: "post", contentType: "application/json", headers: { "x-ingest-token": tok },
    payload: JSON.stringify({ count: r.count, days: r.days, rows: r.rows || [] }), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log("[CIB 입고확인] v2 밀기 실패 " + res.getResponseCode() + " " + res.getContentText().substring(0, 200));
    return { ok: false, error: "v2 HTTP " + res.getResponseCode() };
  }
  return { ok: true, count: r.count };
}

/** 1분 트리거가 부른다. 손으로 불러도 된다 (결과를 돌려준다). */
function csIntakeBridgePull() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { ok: true, skipped: "다른 실행이 돌고 있음" };
  try {
    //  v2 「반품대장 기록」 요청 먼저 — 사람이 화면에서 기다린다. 실패해도 입고 다리는 그대로 돈다
    var ledgerQ = null;
    try { ledgerQ = _cib_ledgerQueue_(); } catch (eQ) { Logger.log("[CIB 대장] 오류: " + ((eQ && eQ.message) || eQ)); }
    //  처리가이드·CS사례 색인 → v2 (6시간마다 · 2026-10-29 작업화면 ⑥). 실패해도 다리는 그대로
    try { csManualPushToV2(false); } catch (eM) { Logger.log("[CIB 매뉴얼] 오류: " + ((eM && eM.message) || eM)); }
    //  입고 확인 대기 → v2 (5분마다 · 2026-10-29). 실패해도 다리는 그대로
    try { csIntakeWaitPushToV2(false); } catch (eW) { Logger.log("[CIB 입고확인] 오류: " + ((eW && eW.message) || eW)); }
    var claim = _cib_post_({ op: "claim", limit: 10, recheck: true }); // recheck: 재검수 결과 줄도 받는다 (v2 sql/74) // 한 건에 글자 인식 3~5초 — 1분 안에 끝나게
    if (!claim.ok) { Logger.log("[CIB] claim 실패: " + claim.error); return claim; }
    var items = claim.items || [];
    //  새로 온 것이 없는 한가한 때에만 — 확인 대기 줄의 빠진 글자를 두 건씩 채운다
    if (!items.length) {
      try { _csl_ensureIntakeTab_(); } catch (eE) {}
      return { ok: true, n: 0, ocrFilled: _cib_backfillOcr_(2), ledger: ledgerQ };
    }

    var applied = _cib_appliedIds_(), results = [];
    for (var i = 0; i < items.length; i++) {
      try { results.push(_cib_apply_(items[i], applied)); }
      catch (e) { results.push({ id: items[i].id, ok: false, note: "오류: " + ((e && e.message) || e) }); }
    }
    var done = _cib_post_({ op: "done", results: results });
    try { csInvalidateReturnLedgerCache_(); } catch (eC) {}
    _csl_dropPendingCache_();
    //  새 입고가 대기로 갔을 수 있다 — v2 목록도 바로
    try { csIntakeWaitPushToV2(true); } catch (eW2) {}
    Logger.log("[CIB] " + JSON.stringify({ n: items.length, done: done }));
    return { ok: true, n: items.length, results: results, done: done, ledger: ledgerQ };
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
