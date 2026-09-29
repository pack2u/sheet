/**
 * 읽기 캐시 — «바뀐 게 없으면» 시트를 다시 읽지 않는다
 * ★ 2026-09-29 신규
 *
 * > "데이타 불러오는 속도가 너무 느려"
 *   재 보니 목록 2~3.5초, 상세 3.7초 — 매번 입금대장·주문서(약 960줄)를 처음부터 읽었다.
 *   CS웹앱을 거치면 한 번 더 건너가 4~6초.
 *
 * ★ 판 번호(DP_DATA_VER) ★
 *   입금대장·주문서·별칭표를 바꾸는 모든 길(문자 수신 · 매칭 · 지정 · 올리기 · 이카운트 반영)이
 *   끝날 때 판 번호를 올린다. 캐시 열쇠에 판 번호가 들어 있으니, 바뀐 뒤에는 옛 답이 절대 안 나온다.
 *   «20초 뒤 저절로 새것» 같은 시간 캐시가 아니라서, 고친 사람이 옛 화면을 볼 일이 없다.
 *
 * ★ 실패해도 그만 ★ 캐시가 안 되면 예전처럼 시트를 읽는다. 답이 틀릴 일은 없다.
 */

var DP_CACHE_TTL_ = 6 * 60 * 60;      // 판 번호가 바뀌면 어차피 안 쓰인다 — 넉넉히
var DP_CACHE_MAX_ = 95 * 1024;        // CacheService 한 칸 한도(100KB) 아래

function dpDataVer_() {
  return _dp_prop_("DP_DATA_VER") || "0";
}

/** 무엇이든 바꿨으면 부른다 */
function dpBumpVer_() {
  // 시각만 쓰면 같은 1ms 안의 두 번째 변경이 같은 번호를 받아 옛 캐시가 나온다 (테스트에서 잡혔다) — 뒤에 난수를 붙인다
  var v = Date.now() + "." + Math.floor(Math.random() * 1e9);
  try { PropertiesService.getScriptProperties().setProperty("DP_DATA_VER", v); } catch (e) {}
}

/** 판 번호가 붙은 열쇠로 캐시 → 없으면 make() 로 만들고 넣는다 */
function dpCached_(name, make) {
  var key = "dpc:" + dpDataVer_() + ":" + name;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache) {
    try {
      var hit = cache.get(key);
      if (hit) return JSON.parse(hit);
    } catch (e) {}
  }
  var val = make();
  if (cache) {
    try {
      var s = JSON.stringify(val);
      if (s.length < DP_CACHE_MAX_) cache.put(key, s, DP_CACHE_TTL_);
    } catch (e) {}
  }
  return val;
}
