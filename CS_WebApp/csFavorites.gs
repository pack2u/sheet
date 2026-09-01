/**
 * 상단 즐겨찾기 바 — 공용 목록
 * 파일: csFavorites.gs
 * ★ 2026-09-01 신규
 *
 * 왜 개인별이 아니라 공용인가.
 *   다섯 사람이 같은 업무를 하니 필요한 링크가 사실상 같다. 개인별로 두면
 *   새로 온 사람은 빈 바를 보고, 무엇을 넣어야 하는지도 모른다. 관리자가
 *   "이거 다들 쓰세요" 하고 밀어줄 방법도 없어진다.
 *   개인 취향의 북마크는 브라우저가 이미 잘 한다. 여기서 또 할 일이 아니다.
 *
 * 목록을 배포 없이 고치려면 스크립트 속성 CS_FAVORITES 에 JSON 배열을 넣는다.
 *   [{"icon":"📦","name":"사방넷","url":"https://..."}, ...]
 * 속성이 있으면 아래 기본 목록은 통째로 무시된다 — 허용계정(CS_ALLOWED_EMAILS)과
 * 같은 규칙이다. csShowFavorites() 로 지금 뭐가 적용 중인지 확인할 수 있다.
 */

var _CS_FAV_PROP_ = "CS_FAVORITES";

/**
 * 기본 목록.
 * 코드 안에서 ID 가 확인되는 시트만 넣었다. 사방넷·이카운트처럼 주소를
 * 확인하지 못한 것은 일부러 비워 뒀다 — 틀린 링크를 넣어 두는 쪽이 더 나쁘다.
 * 스크립트 속성으로 추가하면 된다.
 */
var _CS_FAV_DEFAULT_ = [
  {
    icon: "📊",
    name: "상품정보 시트",
    url: "https://docs.google.com/spreadsheets/d/1Lz-ykUAQBpeEnZU1T_qdJeX9d9L10h6z6qYwHQna2QE/edit",
  },
  {
    icon: "🔄",
    name: "반품관리대장",
    url: "https://docs.google.com/spreadsheets/d/1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU/edit",
  },
  {
    icon: "📖",
    name: "CS 매뉴얼 DB",
    url: "https://docs.google.com/spreadsheets/d/1LlNX-spTs-2WgWD8HEha90PYU0m7s8MqFh84vy_Fi_Q/edit",
  },
];

function _cs_fav_str_(v) {
  return String(v == null ? "" : v).trim();
}

/** 링크로 내보내도 되는 주소인가. javascript: 같은 것을 막는다 */
function _cs_fav_okUrl_(u) {
  var s = _cs_fav_str_(u);
  return s.indexOf("https://") === 0 || s.indexOf("http://") === 0;
}

/** 항목 하나를 다듬는다. 쓸 수 없으면 null */
function _cs_fav_clean_(raw) {
  if (!raw) return null;
  var url = _cs_fav_str_(raw.url);
  if (!_cs_fav_okUrl_(url)) return null;
  var name = _cs_fav_str_(raw.name) || url;
  var icon = _cs_fav_str_(raw.icon) || "🔗";
  return { icon: icon, name: name, url: url };
}

/** 지금 적용되는 목록 + 그 출처 */
function _cs_fav_list_() {
  var raw = "";
  try {
    raw = _cs_fav_str_(PropertiesService.getScriptProperties().getProperty(_CS_FAV_PROP_));
  } catch (eP) {}

  var src = _CS_FAV_DEFAULT_;
  var from = "코드 기본 목록";

  if (raw) {
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (eJ) {
      parsed = null;
    }
    // JSON 이 깨졌으면 기본 목록으로 돌아간다. 오타 하나로 바가 통째로
    // 사라지면 사람들은 기능이 죽은 줄 안다.
    if (parsed && parsed.length) {
      src = parsed;
      from = "스크립트 속성 " + _CS_FAV_PROP_;
    } else {
      from = "코드 기본 목록 (속성 " + _CS_FAV_PROP_ + " 이 비었거나 JSON 이 깨졌음)";
    }
  }

  var out = [];
  for (var i = 0; i < src.length; i++) {
    var one = _cs_fav_clean_(src[i]);
    if (one) out.push(one);
  }
  return { items: out, from: from };
}

/**
 * 프런트 진입점.
 * 실패해도 앱이 죽으면 안 된다 — 즐겨찾기는 있으면 좋은 것이지 필수가 아니다.
 * @return {{ok:boolean, items:Array}}
 */
function csGetFavorites() {
  var _acg_ = _cs_ac_guard_();
  if (_acg_) return _acg_;

  try {
    return { ok: true, items: _cs_fav_list_().items };
  } catch (e) {
    return { ok: true, items: [] };
  }
}

/** 지금 무엇이 적용 중인지 편집기에서 확인한다 */
function csShowFavorites() {
  var r = _cs_fav_list_();
  var out = [];
  out.push("═══ CS 웹앱 즐겨찾기 ═══");
  out.push("적용 출처: " + r.from);
  out.push("");
  out.push("적용 중 " + r.items.length + "개:");
  for (var i = 0; i < r.items.length; i++) {
    out.push("  " + r.items[i].icon + " " + r.items[i].name + "  →  " + r.items[i].url);
  }
  out.push("");
  out.push("바꾸려면 스크립트 속성 " + _CS_FAV_PROP_ + " 에 JSON 배열을 넣습니다:");
  out.push('[{"icon":"📦","name":"사방넷","url":"https://..."}]');

  var text = out.join("\n");
  Logger.log(text);
  return text;
}
