/**
 * ══════════════════════════════════════════════════════════════
 *  사방넷 API 3.0 — 허브가 부르는 자리
 *  파일: sabangApi.gs
 *  2026-10-12
 *
 *  ★ 여기는 «말을 거는» 일만 한다 ★
 *    토큰 발급도, 서명도, IP 도 중계기(_sabang_relay/sabang.php)가 한다.
 *    GAS 는 BCrypt 가 없고 발신 IP 가 유동이라 사방넷을 직접 못 부른다.
 *    로젠(csLogen.gs → _logen_relay/relay.php)과 «같은 꼴» 이다.
 *
 *  ★ 응답을 해석하지 않는다 ★
 *    사방넷이 준 것을 그대로 돌려준다. 뜻을 붙이는 일은 부르는 쪽이 한다.
 *    여기에 뜻을 넣으면 같은 응답을 두 곳에서 다르게 읽게 된다
 *    ([[one-value-one-owner]]).
 *
 *  ★ 응답은 data 로 감싸여 온다 ★
 *    문서에는 「공통 래퍼 없이 리소스 직접 반환」이라고 돼 있지만 실제는
 *      { code, message, data: { … } }
 *    다 (2026-10-12 실측 · _docs/사방넷_API3.0_규격.md 0장).
 *    문서대로 짰으면 파서가 전부 깨졌다. _sab_data_ 가 그 껍질을 벗긴다.
 *
 *  설정 — _secrets.gs 또는 스크립트 속성
 *    SABANG_RELAY_URL     https://siot.com/pack2u/sabang/sabang.php
 *    SABANG_PROXY_TOKEN   중계기 sabang_config.php 의 token 과 «같은 값»
 * ══════════════════════════════════════════════════════════════
 */

/** 샌드박스가 기본이다 — 운영계는 부르는 쪽이 «일부러» 지정한다 */
var _SAB_ENV_DEFAULT_ = "SANDBOX";

/** 중계기 응답을 기다리는 시간(ms). 사방넷 게이트웨이가 10초다 */
var _SAB_TIMEOUT_MS_ = 30000;

function _sab_url_() {
  var u = "";
  try { if (typeof SABANG_RELAY_URL !== "undefined" && SABANG_RELAY_URL) u = String(SABANG_RELAY_URL); } catch (e) {}
  if (!u) {
    try { u = PropertiesService.getScriptProperties().getProperty("SABANG_RELAY_URL") || ""; } catch (e) {}
  }
  return u.replace(/\/+$/, "");
}

function _sab_token_() {
  try { if (typeof SABANG_PROXY_TOKEN !== "undefined" && SABANG_PROXY_TOKEN) return String(SABANG_PROXY_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("SABANG_PROXY_TOKEN") || ""; } catch (e) {}
  return "";
}

/**
 * 중계기를 통해 사방넷을 부른다.
 *
 * ★ 조용히 빈손을 돌려주지 않는다 ★
 *   못 부른 것과 「없다」는 다르다. 실패는 ok:false 와 말로 돌려준다.
 *
 * @param {string} method  GET · POST
 * @param {string} path    /v3/sb/waybill 같은 경로
 * @param {Object} body    보낼 것 (없으면 null)
 * @param {string} env     SANDBOX · PRODUCTION
 * @return {{ok:boolean, status:number, code:string, message:string, data:Object, raw:string}}
 */
function sabCall(method, path, body, env) {
  var url = _sab_url_(), tok = _sab_token_();
  if (!url) return _sab_fail_("SABANG_RELAY_URL 이 없습니다 (_secrets.gs 또는 스크립트 속성).");
  if (!tok) return _sab_fail_("SABANG_PROXY_TOKEN 이 없습니다 (_secrets.gs 또는 스크립트 속성).");

  var req = {
    method: String(method || "GET").toUpperCase(),
    path: String(path || ""),
    env: String(env || _SAB_ENV_DEFAULT_).toUpperCase(),
  };
  if (body !== undefined && body !== null) req.body = body;

  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { "X-Proxy-Token": tok },
      payload: JSON.stringify(req),
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true,
    });
  } catch (e) {
    return _sab_fail_("중계기를 못 불렀습니다 — " + (e && e.message ? e.message : e));
  }

  var status = res.getResponseCode();
  var raw = res.getContentText();
  var j = null;
  try { j = JSON.parse(raw); } catch (eP) {}

  if (!j) {
    return {
      ok: false, status: status, code: "SAB_BAD_JSON",
      message: "응답을 JSON 으로 못 읽었습니다: " + raw.slice(0, 200),
      data: null, raw: raw,
    };
  }

  /*  ★ 200 이어도 실패일 수 있다 ★
      206 은 «부분 성공»이다. 성공으로 보고 넘기면 실패 건이 조용히 사라진다.
      여기서는 ok 를 2xx 로만 매기고, 206 의 뜻은 부르는 쪽이 results 로 가른다. */
  return {
    ok: status >= 200 && status < 300,
    status: status,
    code: String(j.code == null ? "" : j.code),
    message: String(j.message || ""),
    data: _sab_data_(j),
    raw: raw,
  };
}

/**
 * 껍질을 벗긴다 — { code, message, data:{…} } 의 data.
 *
 * 중계기 자신이 낸 오류에는 data 가 없다. 그때는 null 이다.
 */
function _sab_data_(j) {
  if (!j) return null;
  return Object.prototype.hasOwnProperty.call(j, "data") ? j.data : null;
}

function _sab_fail_(말) {
  return { ok: false, status: 0, code: "SAB_CONFIG", message: 말, data: null, raw: "" };
}

// ══════════════════════════════════════════════════════════════
//  운송장 저장/수정 — 1단계
// ══════════════════════════════════════════════════════════════

/**
 * 운송장을 사방넷에 올린다.
 *
 * @param {Array<{sbOrderNo, deliveryCompanyCode, wayBillNo, hopeDeliveryDate?}>} 줄들
 * @param {Object} opt  { env, forceUpdateYn }
 * @return {{ok, 총, 성공, 실패, 실패줄:Array, message, status}}
 *
 * ★ 실패 건을 «돌려준다» ★
 *   206 부분성공이면 results 에 건별 결과가 온다 —
 *     { sbOrderNo, status(boolean), errorMessage }
 *   실패한 것만 골라 돌려주어, 부르는 쪽이 보류·알림으로 보낼 수 있게 한다.
 *
 * ★ 조용히 다시 보내지 않는다 ★  (2026-10-12)
 *   errorMessage 는 코드가 아니라 «문장»이다. 샌드박스는 성공만 돌려주어
 *   실패 문장이 어떻게 생겼는지 아직 못 봤다. 어떤 실패는 다시 보내도 되고
 *   (일시 오류), 어떤 것은 안 된다(이미 쇼핑몰 송신·강제완료).
 *   가릴 근거가 생기기 전까지 재시도는 «사람이» 정한다.
 */
function sabPutWaybills(줄들, opt) {
  opt = opt || {};
  var list = [];
  for (var i = 0; i < (줄들 || []).length; i++) {
    var r = 줄들[i] || {};
    var 주문 = String(r.sbOrderNo == null ? "" : r.sbOrderNo).trim();
    var 송장 = String(r.wayBillNo == null ? "" : r.wayBillNo).trim();
    var 택배 = String(r.deliveryCompanyCode == null ? "" : r.deliveryCompanyCode).trim();
    if (!주문 || !송장 || !택배) continue;    // 셋 중 하나라도 비면 보내지 않는다

    /*  ★ 우리가 만든 UID 는 사방넷이 모른다 ★
        PH-(전화주문)·ds-(발주수집)·p…·d… 가 섞이면 그 줄이 튕기고
        결국 사람이 건별로 손대게 된다. 보내기 전에 여기서 막는다 —
        _sabanguid_test.js 가 지키는 그 규칙이다. */
    if (typeof _po_isGeneratedUid_ === "function" && _po_isGeneratedUid_(주문)) continue;

    var 한줄 = { sbOrderNo: 주문, deliveryCompanyCode: 택배, wayBillNo: 송장 };
    if (r.hopeDeliveryDate) 한줄.hopeDeliveryDate = String(r.hopeDeliveryDate).trim();
    list.push(한줄);
  }

  if (!list.length) {
    return { ok: false, 총: 0, 성공: 0, 실패: 0, 실패줄: [],
             message: "보낼 줄이 없습니다 (빈칸·우리 UID 를 걸러낸 뒤).", status: 0 };
  }

  var res = sabCall("POST", "/v3/sb/waybill", {
    forceUpdateYn: opt.forceUpdateYn === "Y" ? "Y" : "N",
    waybillList: list,
  }, opt.env);

  if (!res.ok) {
    return { ok: false, 총: list.length, 성공: 0, 실패: list.length, 실패줄: [],
             message: res.message || ("실패 " + res.status), status: res.status };
  }

  var d = res.data || {};
  var 결과 = d.results || [];
  var 실패줄 = [];
  for (var k = 0; k < 결과.length; k++) {
    if (결과[k] && 결과[k].status === true) continue;
    실패줄.push({
      sbOrderNo: String((결과[k] && 결과[k].sbOrderNo) || ""),
      말: String((결과[k] && 결과[k].errorMessage) || "(사유 없음)"),
    });
  }

  return {
    ok: 실패줄.length === 0,
    총: d.totalCount != null ? d.totalCount : list.length,
    성공: d.successCount != null ? d.successCount : 0,
    실패: d.failCount != null ? d.failCount : 실패줄.length,
    실패줄: 실패줄,
    message: res.message,
    status: res.status,
  };
}

// ══════════════════════════════════════════════════════════════
//  진단 — 사람이 메뉴에서 누른다
// ══════════════════════════════════════════════════════════════

/**
 * 중계기와 사방넷이 살아 있는지 본다. 아무것도 바꾸지 않는다.
 *
 * 쇼핑몰 목록을 부른다 — 읽기 전용이고, 성공하면 몰 코드까지 눈으로 확인된다.
 */
function sabPing() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  var 글 = ["■ 사방넷 연결 점검", ""];

  var url = _sab_url_();
  글.push("중계기 : " + (url || "★ 없음"));
  글.push("토큰   : " + (_sab_token_() ? "있음" : "★ 없음"));
  글.push("");

  if (!url || !_sab_token_()) {
    글.push("_secrets.gs 에 SABANG_RELAY_URL · SABANG_PROXY_TOKEN 을 넣으세요.");
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }

  var res = sabCall("GET", "/v3/sb/mall/SHOP", null, "SANDBOX");
  글.push("GET /v3/sb/mall/SHOP  (샌드박스)");
  글.push("  HTTP " + res.status + "  " + (res.code ? "[" + res.code + "] " : "") + res.message);

  if (res.ok && res.data) {
    var ms = res.data.malls || [];
    글.push("  몰 " + (res.data.totalCount != null ? res.data.totalCount : ms.length) + "개");
    for (var i = 0; i < Math.min(ms.length, 8); i++) {
      글.push("    " + ms[i].shopCode + "  " + ms[i].shopName);
    }
    if (ms.length > 8) 글.push("    … 그 외 " + (ms.length - 8) + "개");
    글.push("");
    글.push("연결 정상입니다.");
  } else {
    글.push("");
    글.push("★ 실패 — 중계기 또는 사방넷 쪽을 보세요.");
    글.push("   RELAY_TOKEN_FAILED 에 AUTH_008/009 가 붙으면 그 서버 IP 가");
    글.push("   사방넷 「연동 설정」에 등록돼 있는지 확인하세요.");
  }

  if (ui) ui.alert(글.join("\n"));
  return 글.join("\n");
}
