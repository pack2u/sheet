/**
 * ══════════════════════════════════════════════════════════════
 *  배송조회 라우터 — 택배사를 갈라 알맞은 API 로 보낸다
 *
 *  ★ 왜 필요한가 ★
 *    2026-09-11 자사출고 택배사를 로젠으로 바꿨다. 그 전 건은 롯데,
 *    그 뒤 건은 로젠이라 **두 택배사가 한동안 같이 조회된다.**
 *    화면(home.html)이 택배사를 알 필요는 없다 — 여기서 갈라 주고
 *    응답 모양을 하나로 맞춘다.
 *
 *  ★ 화면은 한 벌만 쓴다 ★
 *    csLogenTrack 이 csLotteTrack 과 같은 형태로 돌려준다.
 *    home.html 의 _trkRender_ 는 그대로 두고, 부르는 이름만 바꾸면 된다.
 *
 *        google.script.run ... .csLotteTrack(inv, {})
 *                            → .csTrack(inv, {})
 *
 *  ★ 기존 함수는 건드리지 않았다 ★
 *    csLotteTrack 은 그대로 살아 있다. 라우터가 잘못 갈라도 롯데 조회는
 *    예전 경로로 계속 되고, 되돌릴 때도 한 줄만 고치면 된다.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * 운송장번호로 택배사를 가른다.
 *
 * ★ 자리수로 가르는 근거 ★
 *   _partnerOrders.gs 의 _po_ownCarrierCodeByInvoice_ 와 **같은 규칙**이다.
 *   자사출고는 롯데(12자리) 아니면 로젠(11자리) 둘뿐이고,
 *   길이가 둘 다 아니면 «지금 쓰는 택배사»(로젠)로 본다.
 *
 *   대리공급·대리판매 건은 업체로 택배사를 알기 때문에 이 길로 오지 않는다
 *   (home.html 의 isLotteTrack 이 미리 걸러 낸다).
 *
 * @param {string} invDigits 숫자만 남긴 운송장번호
 * @param {string} carrier   기록된 택배사명 (있으면 이게 가장 정확하다)
 * @return {"롯데"|"로젠"}
 */
function _trk_carrier_(invDigits, carrier) {
  // 마감 때 «업체_택배사» 표로 판정해 기록해 둔 값이 가장 정확하다
  var c = String(carrier || "").replace(/\s/g, "");
  if (c.indexOf("롯데") !== -1) return "롯데";
  if (c.indexOf("로젠") !== -1) return "로젠";

  var d = String(invDigits || "").replace(/[^0-9]/g, "");
  if (d.length === 12) return "롯데";
  return "로젠"; // 11자리와 그 밖의 것 — 지금 쓰는 택배사
}

/**
 * 배송조회 — 단건. 화면에서 이것만 부른다.
 *
 * @param {string} invoice 운송장번호
 * @param {Object} opt     { carrier:string, ordNo:string, noCache:boolean }
 * @return {Object} { ok, carrier, statusName, delivered, lastAt, history[], ... }
 */
function csTrack(invoice, opt) {
  opt = opt || {};
  var d = String(invoice || "").replace(/[^0-9]/g, "");
  if (!d && !opt.ordNo) {
    return { ok: false, error: "운송장번호가 필요합니다." };
  }

  var who = _trk_carrier_(d, opt.carrier);

  if (who === "로젠") {
    return csLogenTrack(d, opt);
  }

  // 롯데는 기존 함수를 그대로 쓴다. carrier 만 얹어 화면이 구분할 수 있게 한다.
  var r = csLotteTrack(d, opt) || {};
  if (!r.carrier) r.carrier = "롯데";
  return r;
}

/**
 * 배송조회 — 여러 건.
 *
 * ★ 택배사별로 나눠 부르는 이유 ★
 *   로젠은 한 번에 여러 송장을 넣을 수 있어 **배치 한 방**이면 끝나지만,
 *   롯데 화물추적은 단건뿐이라 루프를 돌아야 한다(csLotteTrackMany).
 *   섞어서 루프를 돌면 로젠 쪽 배치 이점을 통째로 버리게 된다.
 *
 * @param {Array<string>} invoices
 * @param {Object} opt { carrierOf: {송장:택배사} }  택배사를 아는 경우에만
 * @return {Object} { 송장번호: 결과 }
 */
function csTrackMany(invoices, opt) {
  opt = opt || {};
  var carrierOf = opt.carrierOf || {};
  var lotte = [], logen = [];
  var seen = {};

  var src = invoices || [];
  for (var i = 0; i < src.length; i++) {
    var d = String(src[i] || "").replace(/[^0-9]/g, "");
    if (!d || seen[d]) continue;
    seen[d] = true;
    if (_trk_carrier_(d, carrierOf[d]) === "로젠") logen.push(d);
    else lotte.push(d);
  }

  var out = {};

  if (logen.length) {
    var a = csLogenTrackMany(logen) || {};
    for (var k in a) out[k] = a[k];
  }

  if (lotte.length) {
    var b = csLotteTrackMany(lotte) || {};
    for (var k2 in b) {
      var v = b[k2];
      if (v && !v.carrier) v.carrier = "롯데";
      out[k2] = v;
    }
  }

  return out;
}

/**
 * 두 택배사 연동 상태를 한눈에 (진단용).
 * CS 화면이 조회를 못 할 때 어느 쪽이 막힌 건지 먼저 여기서 본다.
 */
function csTrackStatus() {
  var out = { 롯데: null, 로젠: null };
  try { out.롯데 = csLotteQuotaUsed(); } catch (e) { out.롯데 = { error: e.message }; }
  try {
    out.로젠 = csLogenQuotaUsed();
    out.로젠.env = _LOGEN_USE_PROD_ ? "운영" : "개발";
    out.로젠.proxy = _logen_proxyUrl_() ? "중계 경유" : "직접 호출";
    out.로젠.keyReady = (function () {
      try { _logen_key_(); return true; } catch (e) { return false; }
    })();
    out.로젠.seenStatuses = csLogenSeenStatuses();
  } catch (e) { out.로젠 = { error: e.message }; }
  return out;
}
