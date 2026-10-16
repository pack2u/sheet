/**
 * ══════════════════════════════════════════════════════════════
 *  명세서 메일 → v2  (다리)
 *  파일: _partnerStatementToV2.gs
 *  2026-10-16
 *
 *  > "1번 v2에서 실행하게 하면 되. 시트에서는 굳이 필요없는 부분이야"
 *  > "1,2번 만들어줘"
 *
 *  ★ 여기는 «읽지» 않는다. 나르기만 한다 ★
 *    판독·저장·중복막기·보류판정은 전부 v2 에 이미 있다
 *    (lib/statement/ingest.ts · vision.ts). 같은 일을 여기서 또 하면
 *    언젠가 둘이 갈린다. 이 파일이 하는 일은 딱 둘이다 —
 *      ① Gmail 에서 첨부를 꺼낸다
 *      ② v2 /api/statements/ingest 에 그대로 넣는다
 *
 *  ★ 왜 GAS 가 끼나 ★
 *    v2 는 Gmail 을 못 읽는다. 서비스 계정에 열려 있는 것은
 *    spreadsheets.readonly · drive.readonly 뿐이다. 메일을 읽히려면
 *    Workspace 관리자가 도메인 위임에 gmail.readonly 를 더해야 하는데,
 *    그건 문을 넓히는 일이라 나중에 정할 몫이다. 그때까지 GAS 가
 *    메일 쪽 손이 되어 준다 — 「GAS 에는 버티게 하는 것만 넣는다」.
 *
 *  ★ 검색어의 주인은 _partnerStatementGmail.gs 하나다 ★
 *    _PSTMT_GMAIL_SEARCH_BASE_ 를 그대로 읽어 쓴다. 10/14 에
 *    제목(명세서·명세표·마감)으로 고쳐 14일치 20건이 전부 진짜였다.
 *    여기에 또 적으면 한쪽만 고쳐진다.
 *
 *  ★ 라벨 ★ 성공한 메일에만 P2U_명세처리완료 를 붙인다. 그래서
 *    실패한 것은 다음 회차에 다시 온다. 중복은 v2 가 sha256 으로 막는다 —
 *    같은 파일을 두 번 보내도 두 번 안 들어간다.
 *
 *  실행:
 *    자동 — 16:00 Gmail 수집 트리거 안에서 이어서 돈다
 *           (트리거 자리를 새로 쓰지 않는다. 20개가 이미 차 있다)
 *    수동 — 메뉴 → 📄 명세서 메일 → v2 보내기
 *    예행 — 메뉴 → 🧪 명세서 메일 → v2 예행 (안 보내고 무엇이 갈지만)
 * ══════════════════════════════════════════════════════════════
 */

var _SV2_LABEL_ = "P2U_명세처리완료";   // _PSTMT_GMAIL_PROCESSED_LABEL_ 과 같은 말
var _SV2_MAX_THREADS_ = 20;             // 한 회차에 볼 스레드
var _SV2_MAX_MB_ = 20;                  // v2 가 받는 한도와 같다 (ingest route)
var _SV2_PATH_ = "/api/statements/ingest";

/*  보낼 첨부 — v2 가 읽을 수 있는 것만. 못 읽는 것을 보내면 「보류」가
    쌓이기만 한다. 판독기가 보는 갈래와 같게 둔다(vision.ts · sheet.ts).  */
var _SV2_OK_EXT_ = /\.(pdf|jpe?g|png|webp|heic|xlsx|xls|csv)$/i;

// ═════════════════════════════════════════════════════════════════
//  메뉴
// ═════════════════════════════════════════════════════════════════

/** 메뉴 — 실제로 보낸다 */
function partnerSendStatementsToV2() { _sv2_withUi_(false); }

/** 메뉴 — 예행: 안 보내고 무엇이 갈지만 보여 준다 */
function partnerPreviewStatementsToV2() { _sv2_withUi_(true); }

function _sv2_withUi_(dryRun) {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    if (ui) ui.alert("⚠️ 다른 작업이 실행 중입니다. 잠시 후 다시 시도하세요.");
    return;
  }
  try {
    var r = _sv2_run_({ dryRun: dryRun });
    if (ui) ui.alert(_sv2_text_(r, dryRun));
  } catch (e) {
    if (ui) ui.alert("❌ 오류: " + (e.message || e));
  } finally {
    lock.releaseLock();
  }
}

/**
 * 트리거용 — 16:00 Gmail 수집 안에서 이어 돈다.
 * 그쪽이 이미 잠금을 잡고 있으므로 여기서 또 잠그지 않는다.
 */
function _sv2_triggerSendStatements_() {
  var r;
  try {
    r = _sv2_run_({ dryRun: false });
  } catch (e) {
    try { _gmi_log_("❌ 명세서 → v2 실패: " + (e.message || e)); } catch (_) {}
    return;
  }
  try { _gmi_log_("명세서 → v2: " + _sv2_oneLine_(r)); } catch (_) {}

  //  보낸 것도 실패도 없으면 조용히 끝낸다 — 매일 같은 말이 쌓이면 안 읽힌다
  if (!r.보냄 && !r.실패.length) return;
  try {
    var kv = [
      { label: "📧 메일", value: r.메일수 + "건" },
      { label: "📎 보낸 첨부", value: r.보냄 + "개" },
    ];
    if (r.이미) kv.push({ label: "↩️ 이미 있던 것", value: r.이미 + "개" });
    if (r.보류) kv.push({ label: "⏸ 보류로 들어간 것", value: r.보류 + "개" });
    if (r.건너뜀.length) {
      kv.push({ label: "⬜ 안 보낸 첨부", value: r.건너뜀.slice(0, 5).join(", ") +
        (r.건너뜀.length > 5 ? " 외 " + (r.건너뜀.length - 5) : "") });
    }
    if (r.실패.length) kv.push({ label: "⚠ 실패", value: r.실패.slice(0, 3).join("; ") });
    _chat_sendCard_(
      (r.실패.length ? "⚠️" : "📄") + " 명세서 메일 → v2",
      "보냄 " + r.보냄 + " · 이미 " + r.이미 +
        " (" + Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm") + ")", kv);
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════
//  고갱이
// ═════════════════════════════════════════════════════════════════

/**
 * @param {{dryRun:boolean}} opt
 * @return {{메일수:number, 보냄:number, 이미:number, 보류:number,
 *           건너뜀:Array, 실패:Array, 자세히:Array, 검색어:string}}
 */
function _sv2_run_(opt) {
  opt = opt || {};
  var res = { 메일수: 0, 보냄: 0, 이미: 0, 보류: 0,
              건너뜀: [], 실패: [], 자세히: [], 검색어: "" };

  var url = "", token = "";
  try { url = _v2ob_url_(); token = _v2ob_token_(); } catch (e) {}
  if (!url || !token) {
    res.실패.push("v2 주소·표가 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)");
    return res;
  }

  /*  ★ 검색어는 _partnerStatementGmail.gs 것을 그대로 쓴다 ★
      여기에 또 적으면 한쪽만 고쳐진다. 그 파일이 없거나 비면 멈춘다 —
      엉뚱한 메일을 긁어 v2 에 넣느니 아무것도 안 하는 편이 낫다.  */
  if (typeof _PSTMT_GMAIL_SEARCH_BASE_ !== "string" || !_PSTMT_GMAIL_SEARCH_BASE_) {
    res.실패.push("검색어를 못 찾았습니다 (_partnerStatementGmail.gs _PSTMT_GMAIL_SEARCH_BASE_)");
    return res;
  }
  res.검색어 = _PSTMT_GMAIL_SEARCH_BASE_;

  var threads;
  try {
    threads = GmailApp.search(res.검색어, 0, _SV2_MAX_THREADS_);
  } catch (e2) {
    res.실패.push("Gmail 검색 실패: " + e2.message);
    return res;
  }
  if (!threads || !threads.length) return res;

  for (var ti = 0; ti < threads.length; ti++) {
    var thread = threads[ti];
    var msgs = thread.getMessages();
    var 이스레드성공 = 0, 이스레드실패 = 0;

    for (var mi = 0; mi < msgs.length; mi++) {
      var msg = msgs[mi];
      var atts = [];
      try { atts = msg.getAttachments() || []; } catch (eA) { atts = []; }
      if (!atts.length) continue;
      res.메일수++;

      for (var ai = 0; ai < atts.length; ai++) {
        var att = atts[ai];
        var nm = String(att.getName() || "");
        if (!_SV2_OK_EXT_.test(nm)) { res.건너뜀.push(nm); continue; }
        var size = 0;
        try { size = att.getSize(); } catch (eS) {}
        if (size > _SV2_MAX_MB_ * 1024 * 1024) {
          res.건너뜀.push(nm + "(" + Math.round(size / 1048576) + "MB)");
          continue;
        }

        if (opt.dryRun) {
          res.자세히.push({ 파일: nm, 뜻: "보낼 것", 업체: "", 왜: "" });
          res.보냄++;
          continue;
        }

        var 답 = _sv2_post_(url, token, att.copyBlob(), nm);
        if (답.ok) {
          이스레드성공++;
          if (답.duplicate) { res.이미++; res.자세히.push({ 파일: nm, 뜻: "이미 있음", 업체: 답.vendor, 왜: "" }); }
          else {
            res.보냄++;
            if (답.보류) res.보류++;
            res.자세히.push({ 파일: nm, 뜻: 답.보류 ? "보류" : "들어감", 업체: 답.vendor, 왜: 답.error || "" });
          }
        } else {
          이스레드실패++;
          res.실패.push(nm + " — " + String(답.error || "").substring(0, 90));
          res.자세히.push({ 파일: nm, 뜻: "실패", 업체: "", 왜: String(답.error || "") });
        }
      }
    }

    /*  ★ 하나라도 실패했으면 라벨을 안 붙인다 ★ 다음 회차에 다시 온다.
        같은 파일을 또 보내도 v2 가 sha256 으로 막으므로 두 번 안 들어간다.  */
    if (!opt.dryRun && 이스레드성공 > 0 && 이스레드실패 === 0) _sv2_label_(thread);
  }
  return res;
}

/** 첨부 하나를 v2 문으로. multipart 를 손으로 짓는다 — GAS 에 FormData 가 없다. */
function _sv2_post_(url, token, blob, fileName) {
  var 경계 = "----p2u" + Utilities.getUuid().replace(/-/g, "");
  var NL = String.fromCharCode(13) + String.fromCharCode(10);
  var 머리 = Utilities.newBlob(
    "--" + 경계 + NL +
    'Content-Disposition: form-data; name="file"; filename="' +
      String(fileName).replace(/"/g, "") + '"' + NL +
    "Content-Type: " + (blob.getContentType() || "application/octet-stream") + NL + NL
  ).getBytes();
  var 꼬리 = Utilities.newBlob(NL + "--" + 경계 + "--" + NL).getBytes();
  var 몸 = Utilities.newBlob(머리.concat(blob.getBytes()).concat(꼬리));

  var res;
  try {
    res = UrlFetchApp.fetch(url + _SV2_PATH_, {
      method: "post",
      contentType: "multipart/form-data; boundary=" + 경계,
      headers: { "x-ingest-token": token },
      payload: 몸.getBytes(),
      muteHttpExceptions: true,
    });
  } catch (e) {
    return { ok: false, error: "못 보냈습니다: " + (e.message || e) };
  }

  var code = res.getResponseCode();
  var 글 = res.getContentText();
  if (code !== 200) return { ok: false, error: "HTTP " + code + " " + 글.substring(0, 120) };

  var j;
  try { j = JSON.parse(글); } catch (eJ) { return { ok: false, error: "답을 못 읽었습니다: " + 글.substring(0, 120) }; }
  var one = (j && j.results && j.results[0]) || {};
  if (!one.ok) return { ok: false, error: one.error || "v2 가 못 받았습니다" };
  /*  v2 는 「읽었지만 짚을 것이 있다」를 error 로 같이 준다(보류). 실패가 아니다.  */
  return { ok: true, duplicate: !!one.duplicate, vendor: one.vendor || "",
           보류: !!one.error, error: one.error || "" };
}

function _sv2_label_(thread) {
  try {
    var lb = GmailApp.getUserLabelByName(_SV2_LABEL_) || GmailApp.createLabel(_SV2_LABEL_);
    thread.addLabel(lb);
  } catch (e) {
    Logger.log("[SV2] 라벨 못 붙임: " + e.message);
  }
}

// ═════════════════════════════════════════════════════════════════
//  말
// ═════════════════════════════════════════════════════════════════

function _sv2_oneLine_(r) {
  return "메일 " + r.메일수 + " · 보냄 " + r.보냄 + " · 이미 " + r.이미 +
    " · 보류 " + r.보류 + " · 안 보냄 " + r.건너뜀.length +
    (r.실패.length ? " · 실패 " + r.실패.length : "");
}

function _sv2_text_(r, dryRun) {
  var L = [dryRun ? "🧪 명세서 메일 → v2 예행 (안 보냅니다)" : "📄 명세서 메일 → v2", ""];
  if (r.검색어) L.push("검색: " + r.검색어);
  L.push("");
  L.push("메일 " + r.메일수 + "건 · " + (dryRun ? "보낼 것 " : "보냄 ") + r.보냄 + "개" +
    (r.이미 ? " · 이미 있던 것 " + r.이미 : "") +
    (r.보류 ? " · 보류 " + r.보류 : ""));

  if (r.자세히.length) {
    L.push("");
    for (var i = 0; i < r.자세히.length && i < 20; i++) {
      var x = r.자세히[i];
      L.push("  " + x.뜻 + "  " + x.파일 + (x.업체 ? "  [" + x.업체 + "]" : "") +
        (x.왜 ? "  — " + String(x.왜).substring(0, 70) : ""));
    }
    if (r.자세히.length > 20) L.push("  … 외 " + (r.자세히.length - 20) + "개");
  }
  if (r.건너뜀.length) {
    L.push("");
    L.push("⬜ 안 보낸 첨부 " + r.건너뜀.length + "개 (v2 가 못 읽는 갈래이거나 너무 큼)");
    L.push("  " + r.건너뜀.slice(0, 10).join(", "));
  }
  if (r.실패.length) {
    L.push("");
    L.push("⚠ 실패 " + r.실패.length + "개 — 라벨을 안 붙였으니 다음에 다시 보냅니다");
    for (var e = 0; e < r.실패.length && e < 8; e++) L.push("  " + r.실패[e]);
  }
  if (!r.메일수) {
    L.push("");
    L.push("보낼 첨부가 있는 메일이 없습니다 (라벨 「" + _SV2_LABEL_ + "」 제외).");
  }
  L.push("");
  L.push("들어간 것은 v2 /settlement 에서 봅니다. 판독·중복막기는 v2 가 합니다.");
  return L.join("\n");
}
