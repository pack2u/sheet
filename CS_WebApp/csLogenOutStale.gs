/**
 * ══════════════════════════════════════════════════════════════
 *  2일 넘게 «도착 안 한» 출고를 찾아낸다
 *  파일: csLogenOutStale.gs
 *
 *  > 사장님: "택배가 당일 5~6시쯤 실고 가면 로젠택배는 다음날 95%는 도착을 하거든.."
 *  > 사장님: "2틀이상 안움직이는건 찾아내면 아주 굿이지"
 *
 *  다음날 95% 도착이면 **2일이 지나도 배송완료가 아니면 이미 사고다.**
 *  여태 아무도 안 봤다 — 고객이 전화해야 알았다.
 *
 *  ★ 실측이 설계를 정했다 (2026-10-08) ★
 *    처음에는 「2~7일 창을 하루 한 번 통째로」 물으려 했다. 원장을 세어 보니
 *    그 창에 **1,898건**이었다. 10건씩 190번 · 2초 간격이면 380초 —
 *    **Apps Script 6분 한도를 넘는다.** 윗한도로 잘라도 더 나쁘다:
 *    오래된 것부터 물으면 6·7일치(813건)만 계속 돌고 **막 2일을 넘긴 건에는
 *    영영 못 닿는다.** 정작 손쓸 수 있는 것이 그쪽인데.
 *
 *  ★ 그래서 «그날 치»를 «나눠서» 본다 ★
 *      · 한 번에 보는 것은 **2일 전 하루치**뿐이다 (그 날짜 = 코호트).
 *        하루 약 1,000건. 7일을 훑지 않는다.
 *      · 1시간 일감이 돌 때마다 그중 _OST_PER_RUN_ 건씩 앞으로 나간다.
 *        어디까지 봤는지는 속성에 적어 둔다. 9시간쯤이면 하루치를 다 본다.
 *      · 한 송장은 **한 번만** 묻는다. 로젠을 두드리지 않는다.
 *
 *  ★ 늑대야 소리를 하지 않는다 ★
 *    아침에 「배송출고」라 잡아 둔 건이 낮에 도착할 수 있다. 그대로 두면
 *    카드가 틀린 채로 남는다. 그래서 올리기 직전에 **이미 잡아 둔 것들을
 *    다시 물어** 도착한 것은 뺀다. 그 수는 적어서(5% 안팎) 부담이 없다.
 *
 *  ★ 반품과 자리를 나눈다 ★
 *    반품 지연은 csLogenStale.gs 가 본다. 여기는 나간 물건이 안 닿는 것이다.
 *    다른 일이고 보는 사람도 다르다. 한 장에 섞으면 둘 다 안 읽힌다.
 *
 *  ★ 로젠 호출은 다시 짜지 않는다 ★
 *    csLogenTrackMany 가 중복 제거·캐시·10건씩·쉬어가기·시간예산을 이미 한다
 *    ([[one-value-one-owner]]).
 * ══════════════════════════════════════════════════════════════
 */

/** 며칠 전 하루치를 보나 — 「다음날 도착」이 보통이라 2일이면 이미 늦다 */
var _OST_FROM_DAYS_ = 2;

/** 1시간 일감 한 번에 몇 건까지 묻나. 12번 호출 · 2초 간격이면 25초쯤 */
var _OST_PER_RUN_ = 120;

/** 공지에 담아 둘 멈춤 건 윗한도. 이보다 많으면 사고지 지연이 아니다 */
var _OST_KEEP_ = 80;

/** 원장에서 뒤에서 몇 줄까지 훑나 (회차 순으로 쌓이니 최근은 아래에 있다) */
var _OST_SCAN_ROWS_ = 8000;

/** 그 카드를 알아보는 표 — 반품 것과 «달라야» 한다 */
var _OST_SRCKEY_ = "자동점검:로젠출고지연";

/** 한 카드에 몇 줄까지 */
var _OST_SHOW_ = 20;

/**
 * 1시간마다 조금씩 — 2일 전 하루치 중 아직 안 본 몫을 묻고, 공지를 갱신한다.
 *
 * @param {Object} opt { dry:boolean, 처음부터:boolean }
 * @return {string} 할 일이 없으면 빈 글 (일감 보고가 지저분해지지 않게)
 */
function csOutboundStaleCheck(opt) {
  opt = opt || {};
  var P = PropertiesService.getScriptProperties();
  var 코호트 = _ost_cohortKey_();

  /*  ★ 날이 바뀌면 처음부터 ★ 어제 치는 끝났고 오늘은 새 하루치를 본다. */
  if (opt["처음부터"] || P.getProperty("OST_COHORT") !== 코호트) {
    P.setProperty("OST_COHORT", 코호트);
    P.setProperty("OST_IDX", "0");
    P.setProperty("OST_FOUND", "[]");
  }

  var 목록;
  try { 목록 = _ost_collect_(코호트); }
  catch (e) { var m = "NG 원장을 못 읽었습니다: " + e.message; Logger.log(m); return m; }

  var idx = parseInt(P.getProperty("OST_IDX") || "0", 10) || 0;
  var 잡은것 = _ost_loadFound_(P);

  if (opt.dry) {
    return "── 출고 지연 점검 (연습) ──\n" + 코호트 + " 치 " + 목록.length +
           "건 · 본 것 " + idx + "건 · 잡아 둔 것 " + 잡은것.length + "건";
  }

  if (idx >= 목록.length) return "";   // 이 코호트는 다 봤다 — 내일 또

  var L = ["── 출고 지연 점검 (" + 코호트 + " 치 " + 목록.length + "건 중 " +
           (idx + 1) + "번째부터) ──"];

  var 조각 = 목록.slice(idx, idx + _OST_PER_RUN_);
  var 송장 = [];
  for (var i = 0; i < 조각.length; i++) 송장.push(조각[i].inv);

  var 결과 = csLogenTrackMany(송장);
  var 도착 = 0, 못물음 = 0;
  for (var k = 0; k < 조각.length; k++) {
    var it = 조각[k], r = 결과[it.inv];
    if (!r || !r.ok) { 못물음++; continue; }
    /*  ★ 「도착했나」는 csLogen 이 판정해 준다 ★ delivered 를 믿는다.
        여기서 상태 글자를 다시 뜯어보면 판정이 두 군데가 된다. */
    if (r.delivered) { 도착++; continue; }
    잡은것.push(_ost_mark_(it, r));
  }

  idx += 조각.length;
  P.setProperty("OST_IDX", String(idx));

  /*  ★ 늑대야 소리를 않는다 ★ 아까 잡아 둔 것이 그새 도착했을 수 있다.
      올리기 전에 다시 물어 도착한 것은 뺀다. 수가 적어 부담이 없다. */
  잡은것 = _ost_dropArrived_(잡은것);
  P.setProperty("OST_FOUND", JSON.stringify(잡은것.slice(0, _OST_KEEP_)));

  L.push("물음 " + 조각.length + " · 도착 " + 도착 + " · 멈춤 " + 잡은것.length +
         (못물음 ? " · 못 물음 " + 못물음 : ""));
  if (idx < 목록.length) L.push("남은 " + (목록.length - idx) + "건은 다음 시간에 봅니다");

  L.push(_ost_report_(잡은것, idx >= 목록.length));

  var 끝 = L.join("\n");
  Logger.log(끝);
  try {
    _cpr_ops_(SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_), "출고 지연 점검",
      코호트 + " 치 " + idx + "/" + 목록.length + "건 봄 · 멈춤 " + 잡은것.length);
  } catch (e) {}
  return 끝;
}

/** 멈춘 것 한 건을 공지에 쓸 모양으로 */
function _ost_mark_(it, r) {
  return {
    inv: it.inv, 이름: it.name, 주문: it.order, 며칠: it.days,
    상태: String(r.statusName || "").trim() || "이력 없음",
    영업소: String(r.branch || "").trim(),
    마지막: String(r.lastAt || "").trim()
  };
}

/**
 * 잡아 둔 것 중 «그새 도착한» 것을 뺀다.
 * 캐시가 있으므로 같은 시간 안에서는 로젠을 다시 두드리지 않는다.
 */
function _ost_dropArrived_(잡은것) {
  if (!잡은것.length) return 잡은것;
  var 송장 = [];
  for (var i = 0; i < 잡은것.length; i++) 송장.push(잡은것[i].inv);
  var r;
  try { r = csLogenTrackMany(송장); } catch (e) { return 잡은것; }

  var 남김 = [], 본것 = {};
  for (var k = 0; k < 잡은것.length; k++) {
    var it = 잡은것[k];
    if (본것[it.inv]) continue;          // 같은 송장이 두 번 들어가지 않게
    본것[it.inv] = true;
    var t = r[it.inv];
    if (t && t.ok && t.delivered) continue;   // 도착했다 — 뺀다
    if (t && t.ok) {                           // 상태가 바뀌었으면 갱신
      it.상태 = String(t.statusName || it.상태).trim();
      it.영업소 = String(t.branch || it.영업소).trim();
      it.마지막 = String(t.lastAt || it.마지막).trim();
    }
    남김.push(it);
  }
  return 남김;
}

/** 속성에서 잡아 둔 것을 읽는다. 깨져 있으면 빈 것으로 시작한다 */
function _ost_loadFound_(P) {
  try {
    var v = JSON.parse(P.getProperty("OST_FOUND") || "[]");
    return Object.prototype.toString.call(v) === "[object Array]" ? v : [];
  } catch (e) { return []; }
}

/** 멈춘 것들을 공지 띠에 올린다 (없으면 내린다) */
function _ost_report_(잡은것, 다봤나) {
  if (!잡은것.length) {
    //  ★ 다 보기 전에는 카드를 내리지 않는다 ★ 아직 안 본 몫이 남아 있는데
    //    「없음」으로 닫으면, 오후에 다시 뜨는 깜빡임이 된다.
    return 다봤나 ? _stale_close_(_OST_SRCKEY_, "멈춘 출고 없음") : "아직 멈춘 것 없음";
  }

  잡은것.sort(function (a, b) { return (b.며칠 || 0) - (a.며칠 || 0); });

  var 제목 = "로젠 출고 " + 잡은것.length + "건이 " + _OST_FROM_DAYS_ + "일 넘게 도착하지 않았습니다";
  var 줄 = [];
  for (var i = 0; i < 잡은것.length && i < _OST_SHOW_; i++) {
    var s = 잡은것[i];
    /*  영업소를 같이 적는다 — CS 가 제일 많이 하는 것이 「영업소에 바로 전화」다.
        송장만 있으면 그 번호를 또 찾아야 한다. */
    줄.push("· " + _ost_pretty_(s.inv) +
      (s.이름 ? "  " + s.이름 : "") +
      "  —  " + s.며칠 + "일째 · " + s.상태 +
      (s.영업소 ? " · " + s.영업소 : "") +
      (s.마지막 ? " · 마지막 " + s.마지막 : "") +
      (s.주문 ? "  (" + s.주문 + ")" : ""));
  }
  if (잡은것.length > _OST_SHOW_) 줄.push("… 외 " + (잡은것.length - _OST_SHOW_) + "건");
  줄.push("");
  줄.push("로젠은 보통 다음날 도착합니다. " + _OST_FROM_DAYS_ + "일이 지났으면 확인이 필요합니다.");
  줄.push(다봤나 ? "(오늘 치는 다 봤습니다.)" : "(아직 보는 중입니다 — 더 늘 수 있습니다.)");
  줄.push("도착하면 그 줄은 저절로 빠지고, 다 도착하면 카드가 닫힙니다.");

  return _stale_publish_(_OST_SRCKEY_, 제목, 줄.join("\n"), 잡은것.length);
}

/** 보기 좋게 끊는다 — 로젠 11자리는 2-4-5 로 읽는다 */
function _ost_pretty_(d) {
  var s = String(d || "");
  return s.length === 11 ? s.slice(0, 2) + "-" + s.slice(2, 6) + "-" + s.slice(6) : s;
}

/** 지금 볼 코호트 = _OST_FROM_DAYS_ 일 전 날짜 「yyMMdd」 */
function _ost_cohortKey_() {
  var d = new Date();
  d.setDate(d.getDate() - _OST_FROM_DAYS_);
  return Utilities.formatDate(d, "Asia/Seoul", "yyMMdd");
}

/**
 * 그 날짜(코호트)에 나간 로젠 송장을 모은다.
 *
 * ★ 송장 하나에 줄이 여럿일 수 있다 ★ 합포장이면 여러 주문이 한 송장으로 나간다.
 *   송장 기준으로 묶는다 — 안 묶으면 같은 것을 여러 번 묻는다.
 *
 * ★ 차례가 늘 같아야 한다 ★ 어디까지 봤는지를 «번호»로 적어 두기 때문이다.
 *   차례가 흔들리면 어떤 건은 두 번 묻고 어떤 건은 영영 안 묻는다.
 *   그래서 송장번호로 정렬해 못 박는다.
 */
function _ost_collect_(코호트) {
  var ss = SpreadsheetApp.openById(_CS_LEDGER_SS_ID_);
  var tab = ss.getSheetByName("주문라인원장");
  if (!tab) throw new Error("「주문라인원장」 탭이 없습니다");

  var lastRow = tab.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = tab.getLastColumn();

  var head = tab.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var c = {};
  for (var h = 0; h < head.length; h++) {
    var nm = String(head[h] || "").trim();
    if (nm === "회차키") c.round = h;
    else if (nm === "운송장번호") c.inv = h;
    else if (nm === "택배사") c.carrier = h;
    else if (nm === "거래처명") c.name = h;
    else if (nm === "사방넷주문번호") c.order = h;
  }
  if (c.inv == null || c.round == null) throw new Error("운송장번호·회차키 열을 못 찾았습니다");

  //  최근 것만 본다 — 원장은 회차 순으로 쌓이니 아래가 최근이다
  var from = Math.max(2, lastRow - _OST_SCAN_ROWS_ + 1);
  var 값 = tab.getRange(from, 1, lastRow - from + 1, lastCol).getDisplayValues();

  var 본것 = {}, out = [];
  for (var i = 0; i < 값.length; i++) {
    var r = 값[i];

    //  그날 회차만 — 회차키는 「261006-3」 꼴이다
    if (String(r[c.round] || "").trim().indexOf(코호트) !== 0) continue;
    //  로젠 건만
    if (c.carrier != null && String(r[c.carrier] || "").indexOf("로젠") === -1) continue;

    var d = String(r[c.inv] || "").replace(/[^0-9]/g, "");
    if (d.length !== 11) continue;          // 로젠 송장이 아니다
    if (본것[d]) continue;                   // 합포장 — 한 번만 묻는다
    본것[d] = true;

    out.push({ inv: d, days: _OST_FROM_DAYS_,
               name: c.name != null ? String(r[c.name] || "").trim() : "",
               order: c.order != null ? String(r[c.order] || "").trim() : "" });
  }

  //  ★ 차례를 못 박는다 ★ 번호로 어디까지 봤는지를 적어 두기 때문이다
  out.sort(function (a, b) { return a.inv < b.inv ? -1 : (a.inv > b.inv ? 1 : 0); });
  return out;
}

/** 손으로 돌려 보는 용 — 무엇을 볼지만 보고 묻지는 않는다 */
function csOutboundStalePreview() {
  var 글 = csOutboundStaleCheck({ dry: true });
  Logger.log(글);
  return 글;
}
