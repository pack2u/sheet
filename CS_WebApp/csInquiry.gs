/**
 * ══════════════════════════════════════════════════════════════
 *  CS 문의 — v2 에 저장한다 (시트 아님)
 *
 *  > "CS_커뮤니티보드에서 불러오는게 아니고 이건 별도로 저장해줘
 *  >  시트말고 바르셀 데이타로.."
 *
 *  ★ 왜 시트가 아닌가 ★
 *    시트는 열 자리가 밀리고, 사람이 손으로 고치면 코드가 모른다.
 *    문의는 처음부터 우리 자료다 — 들여올 원본이 따로 없다.
 *
 *  ★ 왜 보드가 아닌가 ★
 *    보드(CS_커뮤니티보드)는 «오늘 넘길 일»이 사는 곳이고, 문의는
 *    거래처와 상품에 매인 일이다. 섞으면 둘 다 흐려진다.
 *
 *  ★ GAS 는 Supabase 를 직접 못 부른다 ★
 *    UrlFetchApp 의 UA 가 Mozilla 라 401 로 막힌다. v2 가 문을 내주고
 *    (/api/cs-inquiry) 여기서는 그 문으로만 간다.
 *
 *  ★ 사진은 파일을 안 보낸다 ★
 *    CS 웹앱이 이미 올리는 길이 있다(csAttach / v2 files/upload).
 *    여기서는 «링크만» [{name,url}] 로 담는다.
 *
 *  저장은 v2 cs_inquiries 표 (sql/74).
 * ══════════════════════════════════════════════════════════════
 */

var _CSQ_PATH_ = "/api/cs-inquiry";

/** v2 주소 — _secrets.gs 의 V2_URL 한 곳에서 온다 */
function _csq_url_() {
  var u = "";
  try { if (typeof V2_URL !== "undefined" && V2_URL) u = String(V2_URL); } catch (e) {}
  if (!u) {
    try { u = PropertiesService.getScriptProperties().getProperty("V2_URL") || ""; } catch (e) {}
  }
  return u.replace(/\/+$/, "");
}

/** 문을 여는 토큰 — 명세서·미러와 «같은» 것이다 */
function _csq_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || ""; } catch (e) {}
  return "";
}

/**
 * v2 문을 두드린다.
 *
 * ★ 조용히 빈 목록을 돌려주지 않는다 ★
 *   못 읽은 것과 없는 것은 다르다. 빈 화면만 보여 주면 「문의가 없구나」
 *   하고 넘어간다 — 실제로는 토큰이 빠졌을 수 있다.
 */
function _csq_call_(method, path, payload) {
  var url = _csq_url_(), token = _csq_token_();
  if (!url || !token) {
    return { ok: false, error: "v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)" };
  }
  var opt = {
    method: method,
    headers: { "x-ingest-token": token },
    muteHttpExceptions: true,
  };
  if (payload) {
    opt.contentType = "application/json";
    opt.payload = JSON.stringify(payload);
  }
  var res;
  try {
    res = UrlFetchApp.fetch(url + path, opt);
  } catch (e) {
    return { ok: false, error: "v2 에 못 닿았습니다: " + String((e && e.message) || e).substring(0, 160) };
  }
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    return { ok: false, error: "v2 " + code + " " + text.substring(0, 160) };
  }
  try { return JSON.parse(text); }
  catch (e2) { return { ok: false, error: "v2 답을 못 읽었습니다: " + text.substring(0, 120) }; }
}

/**
 * 문의 목록.
 * 진행 건 + «후처리요청이 남은» 완료 건을 준다 — 문의는 끝났어도
 * 「다음 주문 때 채워 보내기」는 아직 안 끝났다.
 */
function csListInquiries(opts) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  opts = opts || {};
  var q = _CSQ_PATH_ + "?limit=" + (parseInt(opts.limit, 10) > 0 ? parseInt(opts.limit, 10) : 200);
  if (opts.includeDone) q += "&done=1";
  return _csq_call_("get", q, null);
}

/**
 * 새로 올리거나 고친다.
 * @param {{id:string=, vendor:string, item:string, body:string,
 *          followup:string=, photos:Array=, staff:string}} p
 */
function csSaveInquiry(p) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  p = p || {};
  var staff = String(p.staff || "").trim();
  if (!staff) return { ok: false, error: "담당자를 먼저 선택하세요." };
  return _csq_call_("post", _CSQ_PATH_, {
    action: "save",
    id: p.id || "",
    staff: staff,
    vendor: p.vendor || "",
    item: p.item || "",
    body: p.body || "",
    followup: p.followup || "",
    photos: p.photos || [],
  });
}

/** 후처리요청만 고친다 — 문의가 끝나도 남는 칸이다 */
function csSetInquiryFollowup(p) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  p = p || {};
  if (!p.id) return { ok: false, error: "어느 문의인지 알 수 없습니다" };
  return _csq_call_("post", _CSQ_PATH_, {
    action: "followup", id: p.id, text: p.text || "", staff: p.staff || "CS",
  });
}

/**
 * 처리완료 — ★ 지우는 게 아니다 ★
 * 상태만 「완료」로 바꾼다. 줄은 남고 화면에서만 빠진다.
 */
function csCompleteInquiry(p) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  p = p || {};
  if (!p.id) return { ok: false, error: "어느 문의인지 알 수 없습니다" };
  return _csq_call_("post", _CSQ_PATH_, {
    action: "done", id: p.id, staff: p.staff || "CS",
  });
}

/** 되돌리기 — 잘못 눌렀을 때 */
function csReopenInquiry(p) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  p = p || {};
  if (!p.id) return { ok: false, error: "어느 문의인지 알 수 없습니다" };
  return _csq_call_("post", _CSQ_PATH_, {
    action: "reopen", id: p.id, staff: p.staff || "CS",
  });
}

/**
 * 문이 열려 있나 — 편집기에서 ▶ 실행해 보는 점검.
 * 자료는 안 건드린다.
 */
function csDiagnoseInquiry() {
  var 줄 = ["■ CS 문의 — v2 문 점검", ""];
  var url = _csq_url_(), token = _csq_token_();
  줄.push("v2 주소  " + (url || "★ 없음"));
  줄.push("토큰     " + (token ? "있음 (" + token.length + "자)" : "★ 없음"));
  if (!url || !token) {
    줄.push("");
    줄.push("_secrets.gs 의 V2_URL · V2_INGEST_TOKEN 을 보세요.");
    Logger.log(줄.join("\n"));
    return 줄.join("\n");
  }
  var r = csListInquiries({ limit: 5 });
  줄.push("");
  if (!r || !r.ok) {
    줄.push("★ 못 읽었습니다 — " + ((r && r.error) || "까닭 모름"));
  } else {
    줄.push("✅ 읽었습니다 — 지금 " + (r.rows || []).length + "건");
    (r.rows || []).slice(0, 5).forEach(function (x) {
      줄.push("   · " + (x.vendor || "(거래처 없음)") + " · " + (x.item || "-") +
        " · " + (x.status || "") + (x.followup ? "  [후처리]" : ""));
    });
  }
  Logger.log(줄.join("\n"));
  return 줄.join("\n");
}
