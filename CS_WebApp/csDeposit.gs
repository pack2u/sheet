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
  var cfg = _cs_dep_cfg_();
  if (!cfg.url || !cfg.token) {
    return { ok: false, error: "입금수신 연결 설정이 없습니다 (_secrets.gs CS_DEPOSIT_URL · CS_DEPOSIT_TOKEN)" };
  }
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

  try {
    var res = UrlFetchApp.fetch(cfg.url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      followRedirects: true,
      payload: JSON.stringify({ token: cfg.token, action: "list", date: day, limit: lim })
    });
    var code = res.getResponseCode();
    var out;
    try { out = JSON.parse(res.getContentText()); } catch (eJ) {
      return { ok: false, error: "입금수신 응답을 읽지 못했습니다 (HTTP " + code + ")" };
    }
    if (!out || !out.ok) return { ok: false, error: (out && out.error) || ("HTTP " + code) };
    if (cache) {
      try { cache.put(ck, JSON.stringify(out), _CS_DEP_CACHE_SEC_); } catch (e) {}
    }
    return out;
  } catch (err) {
    return { ok: false, error: "입금수신에 닿지 못했습니다 — " + String((err && err.message) || err) };
  }
}
