/**
 * ══════════════════════════════════════════════════════════════
 *  2일 넘게 «안 움직이는» 반품을 찾아낸다
 *  파일: csLogenStale.gs
 *
 *  > 사장님: "2틀이상 안움직이는건 찾아내면 아주 굿이지"
 *
 *  ★ 왜 ★
 *    202609!207 은 접수번호까지 받아 놓고 「집하영업소배정」에서 **5일째**
 *    서 있었다. 그걸 2026-10-07 에 «우연히» 알았다 — 다른 일로 로그를 읽다가.
 *    csLogenFillReturnSlips 가 세고는 있었지만 Logger.log 에만 남았고,
 *    「몇 개」였지 «어느 줄»인지도 안 알려줬다. 아무도 안 본다.
 *
 *  ★ 그래서 사람이 «이미 보는 곳»에 올린다 ★
 *    CS웹앱 맨 위 공지 띠 = 인수인계보드(csHandoffBoard.gs)다.
 *    카톡으로 또 알리게 만들지 않는다 — 앱에서 한 일이 곧 연락이다
 *    ([[the-app-is-the-message]]).
 *
 *  ★ 쌓지 않는다 ★
 *    1시간마다 도는 일감이 부른다. 매번 새 카드를 만들면 하루 24장이 쌓여
 *    정작 사람이 쓰는 카드를 덮는다. 그래서 **카드 한 장**을 두고 내용만
 *    갈아 끼운다. 다 풀리면 그 카드를 «완료»로 닫는다.
 *    누가 손으로 닫았으면 다시 열지 않는다 — 사람의 판단을 되돌리지 않는다.
 *
 *  ★ 여기서 로젠을 다시 부르지 않는다 ★
 *    csLogenFillReturnSlips 가 이미 건마다 물어봤다. 그것이 모아 준 것을
 *    받아서 «보이게» 하기만 한다. 같은 것을 두 번 묻지 않는다
 *    ([[one-value-one-owner]]).
 * ══════════════════════════════════════════════════════════════
 */

/** 며칠 멈춰 있으면 올리나 */
var _STALE_DAYS_ = 2;

/** 그 카드를 알아보는 표 — 이것으로 찾아 갈아 끼운다 */
var _STALE_SRCKEY_ = "자동점검:로젠반품지연";

/** 카드 작성자 이름 — 사람 이름이 아니라는 것이 보이게 */
var _STALE_AUTHOR_ = "자동점검";

/** 한 카드에 몇 줄까지 적나. 더 있으면 「외 n건」으로 줄인다 */
var _STALE_SHOW_ = 15;

/**
 * 멈춘 건들을 공지 띠에 올린다 (없으면 내린다).
 *
 * @param {Array} 멈춘것  [{어디, 이름, takeNo, 며칠, 상태}]  csLogenFillReturnSlips 가 모은 것
 * @return {string} 사람이 읽을 한 줄
 */
function csStaleReport_(멈춘것) {
  멈춘것 = 멈춘것 || [];

  if (!멈춘것.length) {
    /*  다 풀렸다 — 열려 있던 카드를 닫는다.
        안 닫으면 띠에 영영 남아 「또 그 소리」가 되고, 그러면 아무도 안 본다. */
    return _stale_close_(_STALE_SRCKEY_, "멈춘 건 없음");
  }

  //  오래 멈춘 것부터
  멈춘것.sort(function (a, b) { return (b.며칠 || 0) - (a.며칠 || 0); });

  var 제목 = "로젠 반품 " + 멈춘것.length + "건이 " + _STALE_DAYS_ + "영업일 넘게 멈춰 있습니다";
  var 줄들 = [];
  for (var i = 0; i < 멈춘것.length && i < _STALE_SHOW_; i++) {
    var s = 멈춘것[i];
    줄들.push("· " + s.어디 +
      (s.이름 ? "  " + s.이름 : "") +
      "  —  영업일 " + (s.며칠 == null ? "?" : s.며칠) + "일째" +
      (s.상태 ? " · " + s.상태 : "") +
      (s.takeNo ? "  (접수 " + s.takeNo + ")" : ""));
  }
  if (멈춘것.length > _STALE_SHOW_) 줄들.push("… 외 " + (멈춘것.length - _STALE_SHOW_) + "건");
  줄들.push("");
  줄들.push("로젠에 확인하세요. 접수번호로 물으면 됩니다. (주말·공휴일은 세지 않습니다.)");
  줄들.push("(이 카드는 자동으로 갱신됩니다. 다 풀리면 저절로 닫힙니다.)");
  var 본문 = 줄들.join("\n");

  return _stale_publish_(_STALE_SRCKEY_, 제목, 본문, 멈춘것.length);
}

/**
 * 공지 띠에 «한 장»을 올리거나 갈아 끼운다.
 *
 * ★ 반품·출고가 같이 쓴다 ★ srcKey 로 각자의 카드를 가린다.
 *   올리는 규칙(갈아 끼우기·안 쌓기·사람이 닫은 건 안 건드리기)은 한 곳에만 둔다 —
 *   두 벌이면 한쪽만 고쳐져 조용히 갈린다([[one-value-one-owner]]).
 */
function _stale_publish_(srcKey, 제목, 본문, 건수) {
  try {
    var 기존 = _stale_findCard_(srcKey);
    if (기존 && 기존.id) {
      //  ★ 갈아 끼운다 ★ 새로 만들면 하루에 여러 장이 쌓여 사람 카드를 덮는다
      csEditHandoffCard({ id: 기존.id, staff: _STALE_AUTHOR_,
                          title: 제목, body: 본문, level: "긴급" });
      return "공지 갱신 — " + 건수 + "건";
    }
    csCreateHandoffCard({ staff: _STALE_AUTHOR_, level: "긴급",
                          title: 제목, body: 본문, srcKey: srcKey });
    return "공지 올림 — " + 건수 + "건";
  } catch (e) {
    return "★ 공지 못 올림: " + e.message + " (" + 건수 + "건 멈춤)";
  }
}

/** 다 풀렸다 — 열려 있던 카드를 닫는다. 없으면 아무것도 안 한다. */
function _stale_close_(srcKey, 말) {
  var 기존 = _stale_findCard_(srcKey);
  if (!(기존 && 기존.id)) return 말;
  try {
    csCompleteHandoffCard({ id: 기존.id, staff: _STALE_AUTHOR_ });
    return 말 + " — 공지 내림";
  } catch (e) { return 말 + " (공지 못 내림: " + e.message + ")"; }
}

/**
 * 우리가 만든 «열려 있는» 카드를 찾는다.
 *
 * ★ 닫힌 카드는 못 본 척한다 ★ 사람이 「완료」로 닫았다는 것은 보고 처리했다는
 *   뜻이다. 거기에 다시 쓰면 사람의 판단을 되돌리는 것이 된다. 그때는 새 카드를
 *   만든다 — 새로 멈춘 건이라는 뜻이니까.
 */
function _stale_findCard_(srcKey) {
  try {
    var res = csListHandoffCards({});
    if (!res || !res.ok || !res.rows) return null;
    for (var i = 0; i < res.rows.length; i++) {
      var r = res.rows[i];
      if (String(r.srcKey || "").trim() !== srcKey) continue;
      if (String(r.status || "").indexOf("완료") !== -1) continue;
      return r;
    }
  } catch (e) {}
  return null;
}

/**
 * 손으로 돌려 보는 용 — 지금 멈춘 것이 무엇인지 글로 본다.
 * 공지는 건드리지 않는다.
 */
function csStalePreview() {
  var 글 = csLogenFillReturnSlips({ dry: true, 공지안함: true });
  Logger.log(글);
  return 글;
}
