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
var _STALE_DAYS_ = 3;   // ★ csLogenSlipFill.gs 의 _LSF_STALE_DAYS_ 와 «같아야» 한다 —
                        //   여기는 글자용, 저기는 판정용이다. 한쪽만 고치면 글과 실제가 갈린다

/** 그 카드를 알아보는 표 — 이것으로 찾아 갈아 끼운다 */
var _STALE_SRCKEY_ = "자동점검:로젠반품지연";

/** 카드 작성자 이름 — 사람 이름이 아니라는 것이 보이게 */
var _STALE_AUTHOR_ = "자동점검";

/**
 * 한 카드에 몇 줄까지.
 * ★ 자르지 않는다 ★ 카드 본문은 띠가 아니라 펼쳐서 보는 곳이다. 거기서 자르면
 *   나머지는 어디서도 볼 수가 없다(2026-10-08 · 출고 카드에서 먼저 겪었다).
 *   칸이 터지지 않게 «글자 수»로만 막는다.
 */
var _STALE_SHOW_ = 500;

/** 본문 글자 수 한도 — 시트 한 칸(5만 자)에 여유를 두고 */
var _STALE_BODY_MAX_ = 40000;

/**
 * 멈춘 건들을 공지 띠에 올린다 (없으면 내린다).
 *
 * @param {Array} 멈춘것  [{어디, 이름, takeNo, 며칠, 상태}]  csLogenFillReturnSlips 가 모은 것
 * @return {string} 사람이 읽을 한 줄
 */
/**
 * 반품 멈춘 건을 가리는 열쇠.
 *
 * ★ 여기엔 송장번호가 없다 ★ 접수 때는 송장이 아직 없기 때문이다
 *   ([[logen-return-slip-autofill]]). 접수번호가 있으면 그것이 제일 또렷하고,
 *   없으면 「202610!36」 같은 «대장 자리»가 변하지 않는 유일한 표다.
 */
function _stale_retKey_(s) {
  if (!s) return "";
  var t = String(s.takeNo == null ? "" : s.takeNo).trim();
  return t || String(s.어디 == null ? "" : s.어디).trim();
}

function csStaleReport_(멈춘것) {
  멈춘것 = 멈춘것 || [];

  /*  ★ 사람이 닫았으면 이레 묻어둔다 ★  (2026-10-10 · 사장님 「중간 길로 해줘」)
      까닭은 아래 _STALE_MUTE_DAYS_ 머리말에 있다. 이쪽이 특히 그렇다 —
      43856227041 은 2026-02-25 부터 「독촉」에 멈춰 있다. 여덟 달이다.
      닫아도 다음 런이 다시 세우니 이 카드는 아무도 끝낼 수 없었다. */
  var 열쇠들 = [];
  for (var q = 0; q < 멈춘것.length; q++) 열쇠들.push(_stale_retKey_(멈춘것[q]));
  var 새로묻음 = _stale_muteOnClose_("RET", _STALE_SRCKEY_, 열쇠들);

  var 묻힌 = _stale_muteLoad_("RET");
  var 묻힌수 = Object.keys(묻힌).length;
  if (묻힌수) {
    var 남은 = [];
    for (var w = 0; w < 멈춘것.length; w++) {
      if (!묻힌[_stale_retKey_(멈춘것[w])]) 남은.push(멈춘것[w]);
    }
    멈춘것 = 남은;
  }
  //  ★ 묻어둔 것을 숨기지 않는다 ★ 「풀렸다」와 「사람이 닫았다」는 다르다
  var 꼬리 = (새로묻음 ? " · 사람이 닫아 " + 새로묻음 + "건 " + _STALE_MUTE_DAYS_ + "일 묻어둠" : "") +
             (묻힌수 ? " · 묻어둔 것 " + 묻힌수 : "");

  if (!멈춘것.length) {
    /*  다 풀렸다 — 열려 있던 카드를 닫는다.
        안 닫으면 띠에 영영 남아 「또 그 소리」가 되고, 그러면 아무도 안 본다. */
    return _stale_close_(_STALE_SRCKEY_, "멈춘 건 없음") + 꼬리;
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
  줄들 = _stale_fitBody_(줄들, _STALE_BODY_MAX_);
  줄들.push("");
  줄들.push("로젠에 확인하세요. 접수번호로 물으면 됩니다. (주말·공휴일은 세지 않습니다.)");
  줄들.push("(이 카드는 자동으로 갱신됩니다. 다 풀리면 저절로 닫힙니다.)");
  var 본문 = 줄들.join("\n");

  return _stale_publish_(_STALE_SRCKEY_, 제목, 본문, 멈춘것.length) + 꼬리;
}

/**
 * 본문이 시트 한 칸에 들어가게 다듬는다.
 *
 * ★ 줄 수로 자르지 않는다 ★ 카드 본문은 펼쳐서 보는 곳이라, 거기서 잘린
 *   나머지는 «어디서도 볼 수가 없다». 사람이 로젠 화면을 다시 뒤져야 한다.
 *   그래서 평소에는 다 적고, 칸이 정말 터질 때만 자른다(한 칸 5만 자).
 *   자를 때는 몇 줄을 잘랐는지 반드시 말해 준다 — 모르고 넘어가면 안 된다.
 */
function _stale_fitBody_(줄들, 한도) {
  var 쓴것 = 0;
  for (var i = 0; i < 줄들.length; i++) {
    쓴것 += String(줄들[i]).length + 1;
    if (쓴것 > 한도) {
      var 남은 = 줄들.length - i;
      return 줄들.slice(0, i).concat(
        ["… 너무 길어 " + 남은 + "줄을 줄였습니다 (한 칸에 안 들어갑니다)"]);
    }
  }
  return 줄들;
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

/* ────────────────────────────────────────────────────────────────────
   사람이 닫은 것은 «이레 동안» 묻어둔다
   ──────────────────────────────────────────────────────────────────── */

/**
 * ★ 왜 이 장치가 있나 ★  (2026-10-10 · 사장님 「중간 길로 해줘」)
 *
 *   이 공지들은 「풀릴 때까지 들고 있기」다 — 사흘째 멈춘 건이 조용히 사라지면
 *   안 되기 때문이다. 그런데 **영영 안 풀리는 건**이 있다:
 *     · 아예 안 실려 간 건 (2026-10-08 치 7건 — 사장님: "오래되서 이제 처리불가")
 *     · 분실·취소된 건
 *     · 반품 「독촉」에 여덟 달 멈춘 43856227041
 *   사람이 카드를 닫아도 다음 런이 같은 줄로 새 카드를 세운다. 매시간 닫아야 하는
 *   늑대야가 되고, 그러면 **정작 새로 멈춘 건을 아무도 안 본다.**
 *
 *   ★ 그렇다고 영영 묻으면 안 된다 ★ 잘못 닫는 일이 있다. 지금은 잘못 닫아도
 *   다음 런이 다시 세워 주는데, 「닫으면 끝」으로 바꾸면 그 안전망이 사라진다.
 *
 *   그래서 가운데로 간다 — **사람이 닫으면 그때 실려 있던 송장을 이레 묻어두고,
 *   이레가 지나도 여전히 멈춰 있으면 다시 올린다.**
 *     · 진짜 끝난 건 → 일주일 조용하고, 그 사이 코호트가 지나가 대개 사라진다
 *     · 잘못 닫은 건 → 일주일 뒤 돌아온다. 늦지만 «사라지지는» 않는다
 */
var _STALE_MUTE_DAYS_ = 7;

/** 묻어둘 송장 윗한도 — 속성 한 칸이 9KB 다 */
var _STALE_MUTE_MAX_ = 300;

/** 그 칸의 글자 한도 (9KB 에 여유를 두고) */
var _STALE_MUTE_PROP_MAX_ = 8000;

/**
 * 사람이 닫은 우리 카드를 찾는다.
 *
 * ★ 「사람이」가 중요하다 ★ 우리가 닫은 것(_stale_close_ · 완료자 자동점검)은
 *   다 풀려서 닫은 것이라 묻어둘 것이 없다. 사람이 닫은 것만 뜻이 있다.
 *
 * @return {Object|null} 그 카드 줄 (id·doneBy 가 있다)
 */
function _stale_humanClosed_(srcKey) {
  try {
    var res = csListHandoffCards({});
    if (!res || !res.ok || !res.rows) return null;
    var 찾음 = null;
    for (var i = 0; i < res.rows.length; i++) {
      var r = res.rows[i];
      if (String(r.srcKey || "").trim() !== srcKey) continue;
      if (String(r.status || "").indexOf("완료") === -1) continue;
      var 닫은이 = String(r.doneBy || "").trim();
      if (!닫은이 || 닫은이 === _STALE_AUTHOR_) continue;   // 우리가 닫은 것
      //  여럿이면 가장 나중 것 — 줄은 등록 순이므로 뒤엣것이 최근이다
      찾음 = r;
    }
    return 찾음;
  } catch (e) { return null; }
}

/** 묻어둔 표를 읽는다 — 지난 것은 읽을 때 걸러낸다 */
function _stale_muteLoad_(태그) {
  var 표 = {};
  try {
    var raw = PropertiesService.getScriptProperties()
      .getProperty("STALE_MUTE_" + 태그) || "{}";
    var o = JSON.parse(raw);
    var 오늘 = _stale_ymd_(new Date());
    for (var k in o) { if (String(o[k]) > 오늘) 표[k] = String(o[k]); }
  } catch (e) {}
  return 표;
}

/** 묻어둔 표를 적는다 — 한도를 넘으면 «만료가 이른 것»부터 버린다 */
function _stale_muteSave_(태그, 표) {
  try {
    var 키들 = Object.keys(표);
    if (키들.length > _STALE_MUTE_MAX_) {
      키들.sort(function (a, b) { return 표[a] < 표[b] ? -1 : (표[a] > 표[b] ? 1 : 0); });
      var 남길 = {};
      for (var i = 키들.length - _STALE_MUTE_MAX_; i < 키들.length; i++) 남길[키들[i]] = 표[키들[i]];
      표 = 남길;
    }
    var s = JSON.stringify(표);
    while (s.length > _STALE_MUTE_PROP_MAX_) {       // 글자로도 막는다
      var ks = Object.keys(표);
      if (!ks.length) break;
      delete 표[ks[0]];
      s = JSON.stringify(표);
    }
    PropertiesService.getScriptProperties().setProperty("STALE_MUTE_" + 태그, s);
  } catch (e) { /* 못 적어도 공지는 돈다 */ }
}

/** Date → yyyyMMdd */
function _stale_ymd_(d) {
  return Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd");
}

/**
 * 사람이 카드를 닫았으면, 그때 멈춰 있던 송장들을 이레 묻어둔다.
 *
 * ★ 한 번만 한다 ★ 매 런마다 다시 묻으면 만료가 끝없이 밀려 «영영 안 뜸»이 된다.
 *   그건 사장님이 피하라고 한 바로 그것이다. 그래서 처리한 카드 id 를 적어 두고
 *   같은 카드는 두 번 보지 않는다.
 *
 * @param {string} 태그    속성 이름에 쓸 짧은 표 (OST · RET)
 * @param {string} srcKey  카드 출처키
 * @param {Array}  송장들  지금 멈춰 있는 송장 목록
 * @return {number} 이번에 새로 묻은 수 (0 이면 아무 일도 없었다)
 */
function _stale_muteOnClose_(태그, srcKey, 송장들) {
  /*  ★ 묻을 것이 없으면 보드도 안 읽는다 ★ 아래 _stale_humanClosed_ 는 보드
      시트를 통째로 읽는다. 멈춘 건이 0 인 날(평소가 그렇다)에 그걸 매시간
      둘(출고·반품) 치 읽으면, 하는 일 없이 읽기만 한다 —
      오늘 도서·산간이 33초를 그렇게 쓰고 있었다. [[gas-service-calls-in-loops]] */
  if (!(송장들 && 송장들.length)) return 0;

  var 카드 = _stale_humanClosed_(srcKey);
  if (!(카드 && 카드.id)) return 0;

  var P = PropertiesService.getScriptProperties();
  var 본것키 = "STALE_MUTE_CARD_" + 태그;
  var 본것 = "";
  try { 본것 = P.getProperty(본것키) || ""; } catch (e) {}
  if (본것 === String(카드.id)) return 0;          // 이미 처리한 카드다

  var 표 = _stale_muteLoad_(태그);
  var 만료 = new Date();
  만료.setDate(만료.getDate() + _STALE_MUTE_DAYS_);
  var 만료ymd = _stale_ymd_(만료);

  var 센것 = 0;
  for (var i = 0; i < (송장들 || []).length; i++) {
    var inv = String(송장들[i] || "").trim();
    if (!inv || 표[inv]) continue;
    표[inv] = 만료ymd;
    센것++;
  }
  _stale_muteSave_(태그, 표);
  try { P.setProperty(본것키, String(카드.id)); } catch (e) {}
  return 센것;
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
