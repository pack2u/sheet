/**
 * ══════════════════════════════════════════════════════════════
 *  바이토(CS 인터넷전화) — 콜백 대기 · 이 고객의 통화·문자
 *  2026-10-10
 *
 *  > "1단계 진행하고" — 콜백 대기 · 주문 검색에 「이 고객의 통화·문자」
 *
 *  ★ 자료는 v2 에 있다 ★
 *    바이토는 API 가 없다. CS PC 의 수집기(v2 저장소 tools/byto)가 30분마다
 *    「내보내기」를 대신 눌러 통화·문자·MMS 사진을 v2 로 올린다.
 *    여기서는 v2 문(/api/byto/cs)에 묻기만 한다. 길은 CS 문의와 같다 —
 *    _csq_call_ (csInquiry.gs) · V2_URL · V2_INGEST_TOKEN.
 *
 *  ★ 콜백 대기는 v2 가 계산한다 ★
 *    번호마다 마지막 연락이 부재중·받은 문자면 대기. 콜백하면 다음 수집 때
 *    저절로 빠진다. 「처리함」은 카톡으로 답했거나 광고 전화였을 때 누른다.
 * ══════════════════════════════════════════════════════════════
 */

var _CSB_PATH_ = "/api/byto/cs";

/** 콜백 대기 목록 — 번호마다 한 장 */
function csBytoCallbacks(opts) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  opts = opts || {};
  var days = parseInt(opts.days, 10) > 0 ? parseInt(opts.days, 10) : 3;
  return _csq_call_("get", _CSB_PATH_ + "?callbacks=1&days=" + days, null);
}

/** 그 번호의 통화·문자·사진 (최근 것부터) */
function csBytoTimeline(phone) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  var p = String(phone || "").replace(/[^0-9]/g, "");
  if (p.length < 9) return { ok: false, error: "전화번호가 짧습니다" };
  return _csq_call_("get", _CSB_PATH_ + "?phone=" + p, null);
}

/** 「처리함」 — 지금까지 온 부재중·문자를 대기에서 뺀다 */
function csBytoDone(p) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  p = p || {};
  var phone = String(p.phone || "").replace(/[^0-9]/g, "");
  if (phone.length < 9) return { ok: false, error: "전화번호가 짧습니다" };
  return _csq_call_("post", _CSB_PATH_, { action: "done", phone: phone, by: String(p.staff || "") });
}

/** ▶ 편집기에서 실행 — 주소·토큰·읽기를 한 번에 짚는다 */
function csDiagnoseByto() {
  var r = _csq_call_("get", _CSB_PATH_ + "?callbacks=1&days=3", null);
  if (!r || !r.ok) { Logger.log("실패: " + (r && r.error)); return r; }
  Logger.log("콜백 대기 " + r.cards.length + "건 · 마지막 수집 " + r.collectedAt);
  return { ok: true, cards: r.cards.length, collectedAt: r.collectedAt };
}
