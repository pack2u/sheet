/**
 * ══════════════════════════════════════════════════════════════
 *  명세서 올리기 — v2 정산으로 넘긴다
 *  ★ 2026-09-08 신규
 *
 *  > "정산 파트를 따로 만들어서 엑셀, 이미지, pdf 등의 화일을 붙여넣기,
 *  >  드레그엔 드롭으로 붙여 넣으면"
 *  > "v2와 기존 웹앱이도 넣고싶어"
 *
 *  ★ 여기서 명세서를 읽지 않는다 ★
 *    읽는 것은 v2 한 곳에서만 한다(app/src/lib/statement). 여기서도 읽으면
 *    규칙이 두 벌이 되고, 같은 명세서가 화면마다 다른 숫자로 읽힌다.
 *    **정산에서 그것보다 나쁜 일은 없다.** 이 파일은 파일을 넘기는 일만 한다.
 *
 *  ★ 왜 v2 의 서비스 키를 안 쓰나 ★
 *    v2 의 서비스 키는 RLS 를 통째로 우회한다. 여기에 두면 그 키 하나로
 *    **v2 의 고객 개인정보까지 전부** 열린다. 명세서를 넣으려고 그걸 내줄
 *    이유가 없다. 그 경로만 여는 표(STATEMENT_INGEST_TOKEN)를 따로 받는다.
 *
 *    (이 파일에 키 이름을 그대로 적지 않는다 — _secrets_guard_test.js 가
 *     그런 글자를 찾아 push 를 막는다. 감시를 느슨하게 하느니 말을 바꾼다.)
 *
 *  ★ 설정 ★
 *    _secrets.gs 또는 스크립트 속성에 넣는다 —
 *      V2_URL            https://pack2u-partner.vercel.app
 *      V2_INGEST_TOKEN   (v2 의 STATEMENT_INGEST_TOKEN 과 같은 값)
 *    둘 다 없으면 화면이 그렇게 말한다. 조용히 실패하지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

var _CST_DEFAULT_V2_ = "https://pack2u-partner.vercel.app";
var _CST_PATH_ = "/api/statements/ingest";

/** 한 번에 받을 수 있는 크기. v2 쪽 한도와 같은 값이어야 한다. */
var _CST_MAX_BYTES_ = 20 * 1024 * 1024;

function _cst_v2url_() {
  var u = "";
  try {
    if (typeof V2_URL !== "undefined" && V2_URL) u = String(V2_URL);
  } catch (e) {}
  if (!u) {
    try {
      u = PropertiesService.getScriptProperties().getProperty("V2_URL") || "";
    } catch (e) {}
  }
  return (u || _CST_DEFAULT_V2_).replace(/\/+$/, "");
}

function _cst_token_() {
  try {
    if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN);
  } catch (e) {}
  try {
    return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || "";
  } catch (e) {}
  return "";
}

/**
 * 화면이 쓸 수 있는 상태인가.
 * ★ 표가 없으면 단추를 안 보여준다 ★ 눌렀다가 실패하는 것보다 낫다.
 */
function csStatementReady() {
  var tok = _cst_token_();
  return {
    ready: !!tok,
    url: _cst_v2url_(),
    reason: tok ? "" :
      "v2 표(V2_INGEST_TOKEN)가 없습니다. 관리자에게 스크립트 속성 설정을 요청하세요."
  };
}

/**
 * 파일 한 개를 v2 로 넘긴다.
 *
 * @param {string} name    파일 이름
 * @param {string} mime    브라우저가 준 형식
 * @param {string} b64     base64 (data: 접두어 없이)
 * @return {{ok:boolean, error:string, id:string, lines:number,
 *           vendor:string, mismatch:boolean, duplicate:boolean}}
 */
function csStatementUpload(name, mime, b64) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return { ok: false, error: "권한이 없습니다." };

  var tok = _cst_token_();
  if (!tok) return { ok: false, error: csStatementReady().reason };

  var bytes;
  try {
    bytes = Utilities.base64Decode(String(b64 || ""));
  } catch (e) {
    return { ok: false, error: "파일을 못 읽었습니다: " + e.message };
  }
  if (!bytes || !bytes.length) return { ok: false, error: "빈 파일입니다." };
  if (bytes.length > _CST_MAX_BYTES_) {
    return {
      ok: false,
      error: "너무 큽니다 (" + (bytes.length / 1048576).toFixed(1) + "MB · 20MB 까지)"
    };
  }

  var blob = Utilities.newBlob(bytes, String(mime || "application/octet-stream"),
                               String(name || "명세서"));
  var res;
  try {
    res = UrlFetchApp.fetch(_cst_v2url_() + _CST_PATH_, {
      method: "post",
      headers: { "x-ingest-token": tok },
      payload: { file: blob },
      muteHttpExceptions: true,
      // AI 가 여러 쪽짜리 PDF 를 읽으면 오래 걸린다. 기본값으로는 끊긴다.
      followRedirects: true
    });
  } catch (e) {
    return { ok: false, error: "v2 에 못 보냈습니다: " + e.message };
  }

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    /* ★ 표는 절대 로그·화면에 안 싣는다 ★ 오류에 섞여 나가면 그 순간 샌다. */
    var msg = "";
    try { msg = (JSON.parse(body) || {}).error || ""; } catch (e) {}
    return {
      ok: false,
      error: "v2 응답 " + code + (msg ? " — " + msg : "") +
             (code === 401 ? " (표가 v2 와 다릅니다)" : "")
    };
  }

  var j;
  try { j = JSON.parse(body); } catch (e) {
    return { ok: false, error: "v2 응답을 못 읽었습니다: " + String(body).substring(0, 150) };
  }
  var r = (j.results || [])[0] || {};
  return {
    ok: !!r.ok,
    error: r.error || "",
    id: r.id || "",
    lines: r.lines || 0,
    vendor: r.vendor || "",
    mismatch: !!r.mismatch,
    duplicate: !!r.duplicate,
    viewUrl: r.id ? (_cst_v2url_() + "/settlement/" + r.id) : ""
  };
}

/** 편집기에서 확인용 — 설정이 됐는지, v2 가 살아 있는지 */
function csStatementSelfTest() {
  var st = csStatementReady();
  var L = ["── 명세서 올리기 ──",
    "v2 주소   " + st.url,
    "표        " + (st.ready ? "있음" : "★ 없음 ★ " + st.reason),
    ""];
  try {
    var res = UrlFetchApp.fetch(st.url + "/api/health", { muteHttpExceptions: true });
    L.push("v2 응답  " + res.getResponseCode());
  } catch (e) {
    L.push("v2 응답  못 붙음 — " + e.message);
  }
  var out = L.join("\n");
  Logger.log(out);
  return out;
}
