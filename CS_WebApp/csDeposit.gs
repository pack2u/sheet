/**
 * ══════════════════════════════════════════════════════════════
 *  대시보드 「오늘 입금」 — 입금수신(DepositInbox)에서 읽어 온다
 *  ★ 2026-09-29 신규 · 적용계획: 입금확인_CS웹앱_적용계획.md
 *
 *  > "우선 웹앱에 입금 내용카드가 뜨게해줘..지금 일정 뜨는걸 삭제하고 그위치에
 *  >  뜨게해줘..10개정도까지 보이게해주고 더보기를 클릭해 당일 내용을 확인할수 있게 해줘.."
 *  > "챗봇 권한없어도 볼수있게 해줘.. 아직 챗봇을 모르는직원들이 있어"
 *
 *  ★ 입금대장을 직접 열지 않는다 ★
 *    이 웹앱은 «접속한 사람» 권한으로 돈다. 대장을 직접 열려면 직원마다 시트를
 *    공유해야 하고, 그러면 잔액까지 다 보인다. 대장은 pack2u 에게만 두고,
 *    입금수신 웹앱에 «읽기 전용 열쇠»로 물어본다. 돌아오는 것에 잔액은 없다.
 *
 *  ★ 볼 수 있는 사람 = CS웹앱에 들어올 수 있는 사람 ★
 *    구글챗 「입금알림」 방에 없어도 된다. 따로 권한을 두지 않는다.
 *
 *  ★ 20초 캐시 ★
 *    화면이 1분마다 다시 묻고 여러 명이 동시에 연다. 매번 대장까지 가지 않게
 *    스크립트 캐시에 잠깐 둔다. 새 입금이 뜨는 데 최대 20초 늦을 수 있다.
 *
 *  설정은 _secrets.gs (저장소에 안 들어간다):
 *    CS_DEPOSIT_URL    입금수신 웹앱 주소
 *    CS_DEPOSIT_TOKEN  읽기 전용 열쇠 — DepositInbox/_secrets.gs 의 DP_CS_TOKEN 과 같은 값
 * ══════════════════════════════════════════════════════════════
 */

var _CS_DEP_CACHE_SEC_ = 20;

/** 비밀값은 «부를 때» 읽는다 (9/16 챗 알림 사고 — 파일 맨 위에서 읽으면 비어 있다) */
function _cs_dep_cfg_() {
  var url = "", tok = "";
  try { if (typeof CS_DEPOSIT_URL !== "undefined" && CS_DEPOSIT_URL) url = String(CS_DEPOSIT_URL); } catch (e) {}
  try { if (typeof CS_DEPOSIT_TOKEN !== "undefined" && CS_DEPOSIT_TOKEN) tok = String(CS_DEPOSIT_TOKEN); } catch (e) {}
  return { url: url, token: tok };
}

/**
 * 하루치 입금 (대시보드·더보기 공용).
 * @param {string} date   "yyyy-MM-dd" — 비우면 오늘
 * @param {number} limit  대시보드는 10, 더보기는 0(전부)
 * @return {{ok, date, total, sum, unparsed, rows[], error?}}
 */
function csDepositList(date, limit) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  var day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date)
    : Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  var lim = Math.max(0, Number(limit) || 0);

  var cache = null, ck = "csdep:" + day + ":" + lim;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache) {
    try {
      var hit = cache.get(ck);
      if (hit) return JSON.parse(hit);
    } catch (e) {}
  }
  var out = _cs_dep_call_({ action: "list", date: day, limit: lim });
  if (out.ok && cache) {
    try { cache.put(ck, JSON.stringify(out), _CS_DEP_CACHE_SEC_); } catch (e) {}
  }
  return out;
}

/** 입금수신에 한 번 묻는다 — 모든 동작이 같은 길로 간다 */
function _cs_dep_call_(payload) {
  var cfg = _cs_dep_cfg_();
  if (!cfg.url || !cfg.token) {
    return { ok: false, error: "입금수신 연결 설정이 없습니다 (_secrets.gs CS_DEPOSIT_URL · CS_DEPOSIT_TOKEN)" };
  }
  payload.token = cfg.token;
  try {
    var res = UrlFetchApp.fetch(cfg.url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      followRedirects: true,
      payload: JSON.stringify(payload)
    });
    var code = res.getResponseCode();
    var out;
    try { out = JSON.parse(res.getContentText()); } catch (eJ) {
      return { ok: false, error: "입금수신 응답을 읽지 못했습니다 (HTTP " + code + ")" };
    }
    if (!out || !out.ok) return { ok: false, error: (out && out.error) || ("HTTP " + code) };
    return out;
  } catch (err) {
    return { ok: false, error: "입금수신에 닿지 못했습니다 — " + String((err && err.message) || err) };
  }
}

/** 손질한 뒤에는 오늘 목록 캐시를 지운다 — 누른 사람이 20초 동안 옛 판정을 보지 않게 */
function _cs_dep_bust_() {
  try {
    var day = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    CacheService.getScriptCache().removeAll(["csdep:" + day + ":10", "csdep:" + day + ":0"]);
  } catch (e) {}
}

/** 누가 했는지 — 지정·제외에 남긴다 */
function _cs_dep_by_() {
  try { var c = _cs_ac_check_(); return c.name || c.email || ""; } catch (e) { return ""; }
}

// ══════════════════════════════════════════════
//  주문서 매칭 (2026-09-29)
//  > "이제 주문서 매칭 진행해줘"
//  엑셀은 브라우저가 읽어 «보이는 값 2차원 배열»로 넘긴다. 해석은 입금수신(dpMatch.gs)이 한다 —
//  규칙이 두 곳에 있으면 늦게 고친 쪽이 조용히 틀린다.
// ══════════════════════════════════════════════

/** 이카운트 「주문서조회」 엑셀 올리기 */
function csDepositOrdersUpload(rows) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  if (!rows || !rows.length) return { ok: false, error: "엑셀에서 읽은 줄이 없습니다" };
  var out = _cs_dep_call_({ action: "orders_upload", rows: rows });
  _cs_dep_bust_();
  return out;
}

/** 입금 한 건의 상세와 고를 만한 주문들 */
function csDepositDetail(key) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  return _cs_dep_call_({ action: "detail", key: String(key || "") });
}

/** 남은 주문 찾기 (거래처명 · 금액 · 주문번호) */
function csDepositSearch(q) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  return _cs_dep_call_({ action: "orders_search", q: String(q || "") });
}

/** 이 입금은 이 주문(들)의 것 — remember 면 입금자 → 거래처를 기억한다 */
function csDepositAssign(key, orders, remember) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  var out = _cs_dep_call_({ action: "assign", key: String(key || ""), orders: orders || [],
                            remember: !!remember, by: _cs_dep_by_() });
  _cs_dep_bust_();
  return out;
}

/** 주문 입금이 아님 (개인 송금 · 환불 반환 등) */
function csDepositExclude(key) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  var out = _cs_dep_call_({ action: "exclude", key: String(key || ""), by: _cs_dep_by_() });
  _cs_dep_bust_();
  return out;
}

/** 사람이 정한 것을 걷고 자동 판정으로 되돌린다 */
function csDepositUnassign(key) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  var out = _cs_dep_call_({ action: "unassign", key: String(key || ""), by: _cs_dep_by_() });
  _cs_dep_bust_();
  return out;
}
