/**
 * ══════════════════════════════════════════════════════════════
 *  냅킨코리아·아주팩 Gmail 송장 → v2 로 나르기
 *  파일: _partnerGmailInvoiceV2.gs        2026-11-02 (v2 sql/290 · lib/mail-invoice)
 *
 *  > 사장님: "넵킨코리아와 아주팩 지메일 송장 수집은 V2에 이식되있나?" → "v2로 옮기기"
 *
 *  판독·매칭·전용양식 A열 기록은 이제 v2 가 한다. 여기는 «메일을 찾아 나르는» 일만 한다
 *  (v2 서버는 pack2u@ 사서함을 읽을 자격이 없다 — v2 12_전면이관 §2).
 *    냅킨 — 카페24 발송 알림 메일 HTML 본문
 *    아주팩 — 오늘 hspack2020 메일의 xlsx 첨부(base64)
 *
 *  ★ 주인 스위치 하나 ★  v2 app_flags mail_invoice.owner (GET /api/vendor-mail-invoices)
 *    시트: 여태처럼 _partnerGmailInvoice.gs · _partnerGmailInvoiceAJ.gs 가 A열에 적는다.
 *          같은 메일을 v2 에 «견줌»으로 보낸다 — v2 는 안 쓰고, GAS 가 넣은 자리와 같은지 남긴다.
 *    v2  : 이 파일이 나르고 v2 가 적는다. 옛 판독은 안 돈다.
 *    못 물으면 «시트» — 여태처럼 돈다(_pt_v2Owner_).
 *
 *  라벨은 여기서 붙인다(Gmail 쓰기 권한은 GAS 에만 있다). v2 가 받아 끝냈을 때만.
 * ══════════════════════════════════════════════════════════════
 */
var _GMV2_PATH_ = "/api/vendor-mail-invoices";

function _gmv2_ownerIsV2_() {
  return _pt_v2Owner_(_GMV2_PATH_) === "v2";
}

/**
 * 오늘 메일 모으기 — 옛 판독과 «같은 검색어·같은 거르기»
 * @param {string} prefix NK | AJ
 * @param {boolean} manual true 면 처리완료 라벨이 붙은 것도 (옛 수동 실행과 같다)
 * @return {{threads: GmailThread[], mails: Object[]}}
 */
function _gmv2_collect_(prefix, manual) {
  var 오늘 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy/MM/dd");
  var q, label;
  if (prefix === "NK") { q = "(" + _GMI_NK_SEARCH_QUERY + ") after:" + 오늘; label = _GMI_PROCESSED_LABEL; }
  else { q = _GMA_SEARCH_QUERY + " after:" + 오늘; label = _GMA_PROCESSED_LABEL; }
  if (!manual) q += " -label:" + label;
  var threads = GmailApp.search(q, 0, 20) || [];
  var mails = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      var from = String(m.getFrom() || "");
      if (prefix === "AJ") {
        if (from.toLowerCase().indexOf("hspack2020") === -1) return;
        //  한 스레드에 어제 메일이 같이 있으면 검색은 통과한다 — 한 통씩 날짜를 본다(_partnerGmailInvoiceAJ.gs 와 같다)
        if (Utilities.formatDate(m.getDate(), "Asia/Seoul", "yyyy/MM/dd") !== 오늘) return;
        var 첨부 = [];
        (m.getAttachments() || []).forEach(function (a) {
          if (!/\.xlsx$/i.test(String(a.getName() || ""))) return;
          첨부.push({ name: a.getName(), b64: Utilities.base64Encode(a.copyBlob().getBytes()) });
        });
        mails.push({ id: m.getId(), date: m.getDate().toISOString(), from: from, subject: m.getSubject(), 첨부: 첨부 });
      } else {
        mails.push({ id: m.getId(), date: m.getDate().toISOString(), from: from, subject: m.getSubject(), html: m.getBody() });
      }
    });
  });
  return { threads: threads, mails: mails };
}

/** v2 에 보낸다. 실패해도 던지지 않고 {ok:false,error} */
function _gmv2_post_(prefix, mails, 방식, gasWritten) {
  try {
    var tok = _psm_token_();
    if (!tok) return { ok: false, error: "V2_INGEST_TOKEN 이 없습니다" };
    var body = { prefix: prefix, mails: mails };
    if (방식) body["방식"] = 방식;
    if (gasWritten) body.gasWritten = gasWritten;
    var res = UrlFetchApp.fetch(_psm_v2url_() + _GMV2_PATH_, {
      method: "post", contentType: "application/json", headers: { "x-ingest-token": tok },
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    var j = {};
    try { j = JSON.parse(res.getContentText()); } catch (e) { j = { ok: false, error: "HTTP " + res.getResponseCode() + " " + res.getContentText().slice(0, 200) }; }
    if (res.getResponseCode() !== 200 && j.ok !== false) j.ok = false;
    return j;
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function _gmv2_label_(threads, name) {
  try {
    var label = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
    threads.forEach(function (t) { label.addToThread(t); });
  } catch (e) { Logger.log("[GMV2] 라벨 실패: " + e.message); }
}

/**
 * 주인이 v2 일 때 — 한 업체를 나르고 라벨·알림
 * @param {{manual?:boolean, 예행?:boolean, chat?:boolean}} opt
 */
function _gmv2_runOne_(prefix, opt) {
  opt = opt || {};
  var 이름 = prefix === "NK" ? "냅킨코리아" : "아주팩";
  var c = _gmv2_collect_(prefix, !!opt.manual);
  if (!c.mails.length) return { ok: true, mailCount: 0, written: [], unmatched: [], stillEmpty: [], errors: [], 쓴칸: 0 };
  var r = _gmv2_post_(prefix, c.mails, opt["예행"] ? "예행" : "쓰기");
  /*  라벨 — 냅킨은 옛날처럼 «끝나면 늘», 아주팩은 오류가 없을 때만(옛 규칙 그대로).
      v2 가 못 받았으면(ok:false) 안 붙인다 — 다음 차례에 다시 나른다. */
  if (r.ok && !opt["예행"] && (prefix === "NK" || !(r.errors || []).length)) {
    _gmv2_label_(c.threads, prefix === "NK" ? _GMI_PROCESSED_LABEL : _GMA_PROCESSED_LABEL);
  }
  if (opt.chat) {
    try {
      var t = Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm");
      if (!r.ok) {
        _chat_sendCard_("❌ " + 이름 + " Gmail 송장(v2)", t, [{ label: "오류", value: String(r.error || "").substring(0, 200) }]);
      } else {
        var um = r.unmatched || [], se = r.stillEmpty || [];
        var kv = [
          { label: "📧 메일", value: (r.mailCount || 0) + "건" },
          { label: "🔍 읽은 송장", value: (r.parsedCount || 0) + "개" },
          { label: "✅ A열 입력", value: (r.쓴칸 || 0) + "칸" },
        ];
        if (r.alreadyIn) kv.push({ label: "↩️ 이미 입력됨", value: r.alreadyIn + "건" });
        if (um.length) kv.push({ label: "❌ 미매칭 " + um.length + "건", value: um.slice(0, 5).map(function (u) { return (u.name || "?") + "/" + (u.item || "?") + "(" + u.tracking + ")"; }).join(", ") });
        if (se.length) kv.push({ label: "⬜ 아직 송장 없는 줄", value: se.length + "줄 — " + se.slice(0, 5).map(function (x) { return x.row + "행 " + x.name + "/" + x.item; }).join(", ") });
        if ((r.errors || []).length) kv.push({ label: "⚠ 오류", value: r.errors.slice(0, 3).join("; ") });
        var icon = (r.errors || []).length ? "❌" : (um.length ? "⚠️" : "✅");
        _chat_sendCard_(icon + " " + 이름 + " Gmail 송장 (v2)", "입력 " + (r.쓴칸 || 0) + " · 미매칭 " + um.length + " (" + t + ")", kv);
      }
    } catch (_) {}
  }
  return r;
}

/** 주인이 v2 일 때 16:00 트리거 — 두 업체를 따로 감싼다(한쪽이 실패해도 다른 쪽은 간다) */
function _gmv2_runAll_() {
  ["NK", "AJ"].forEach(function (p) {
    try { _gmv2_runOne_(p, { chat: true }); }
    catch (e) {
      Logger.log("[GMV2] " + p + " 에러: " + e.message);
      try { _chat_sendCard_("❌ " + (p === "NK" ? "냅킨코리아" : "아주팩") + " Gmail 송장(v2)", "", [{ label: "오류", value: String(e.message).substring(0, 200) }]); } catch (_) {}
    }
  });
}

/**
 * 주인이 시트일 때 — 옛 판독이 적은 뒤 같은 메일을 v2 에 «견줌»으로. 조용히(로그만) — 결과는 v2 mail_invoice_runs
 * @param {{mails:Object[]}} pre 옛 판독 «전에» 모은 것(같은 검색어 · 라벨 붙기 전)
 * @param {{row:number,tracking:string}[]} gasWritten 옛 판독이 넣은 자리
 */
function _gmv2_shadow_(prefix, pre, gasWritten) {
  try {
    if (!pre || !pre.mails || !pre.mails.length) return;
    var r = _gmv2_post_(prefix, pre.mails, "견줌", (gasWritten || []).map(function (w) { return { row: w.row, tracking: String(w.tracking) }; }));
    Logger.log("[GMV2 견줌] " + prefix + " " + (r.ok ? ("같음=" + r.same + " · v2 " + (r.written || []).length + " / GAS " + (gasWritten || []).length) : ("실패 " + r.error)));
  } catch (e) { Logger.log("[GMV2 견줌] " + prefix + " 에러: " + e.message); }
}

/** 편집기에서 — 지금 주인 */
function partnerGmailInvoiceOwnerCheck() {
  var o = _pt_v2Owner_(_GMV2_PATH_);
  Logger.log("냅킨·아주팩 Gmail 송장 주인: " + o);
  return o;
}
