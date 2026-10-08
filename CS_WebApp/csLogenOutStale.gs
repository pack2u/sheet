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

/**
 * 몇 «영업일» 지난 것을 보나 — 「다음날 도착」이 보통이라 2영업일이면 이미 늦다.
 *
 * ★ 달력 날짜로 세면 연휴마다 늑대야 소리를 한다 ★  (2026-10-08)
 *   > 사장님: "연휴 주말도 판단해서 날짜 기준을 잡아줘.. 금요일부터 연휴야.."
 *   목요일에 실은 것은 금요일에 닿는 것이 보통인데, 금·토·일이 쉬면 월요일에
 *   닿는다. 달력으로 세면 월요일 아침에 **목요일 치가 통째로 「2일째 미도착」**
 *   으로 뜬다. 한 번 그러면 그 뒤로 아무도 이 공지를 안 본다.
 *
 *   그래서 «발송일 다음부터 오늘까지의 영업일 수»로 센다.
 *     목 발송 · 월 오늘 (금토일 쉼) → 1영업일 → 아직 정상, 안 뜬다
 *     목 발송 · 화 오늘             → 2영업일 → 늦음
 */
var _OST_FROM_DAYS_ = 2;

/** 1시간 일감 한 번에 몇 건까지 묻나. 12번 호출 · 2초 간격이면 25초쯤 */
var _OST_PER_RUN_ = 120;

/**
 * 공지에 담아 둘 멈춤 건 윗한도.
 *
 * ★ 왜 한도가 있나 ★ 잡아 둔 것은 «속성»에 적어 둔다(날이 바뀌어도 남아야 하니까).
 *   Apps Script 속성 한 칸은 **9KB** 까지다. 넘으면 저장이 통째로 실패한다 —
 *   그러면 멈춘 건을 전부 잃는다. 숫자로만 막으면 한 건이 길어질 때 또 터지므로
 *   «글자 수»로도 막는다. 숫자는 넉넉히 두고 글자 수가 진짜 뚜껑이다.
 *
 *   줄여야 했으면 몇 건을 줄였는지 카드에 적는다 — 모르고 넘어가면 안 된다.
 */
var _OST_KEEP_ = 400;

/** 속성 한 칸(9KB)에 여유를 두고 */
var _OST_PROP_MAX_ = 8000;

/** 원장에서 뒤에서 몇 줄까지 훑나 (회차 순으로 쌓이니 최근은 아래에 있다) */
var _OST_SCAN_ROWS_ = 8000;

/** 그 카드를 알아보는 표 — 반품 것과 «달라야» 한다 */
var _OST_SRCKEY_ = "자동점검:로젠출고지연";

/**
 * 한 카드에 몇 줄까지.
 *
 * ★ 자르지 않는다 ★  (2026-10-08)
 *   > 사장님: "37건인데 외 17건으로 나오는데 37개 전체를 보여줘야지.."
 *   처음엔 20 줄로 잘랐다 — 「띠가 글자로 뒤덮일까」 걱정해서였다. 틀렸다.
 *   띠에 흐르는 것은 «제목»이고, 이 본문은 카드를 펼쳐서 보는 곳이다.
 *   거기서 잘라 놓으면 나머지 17건은 **어디서도 볼 수가 없다** — 로젠 화면을
 *   다시 뒤져야 한다. 그러면 이 공지를 만든 뜻이 없다.
 *
 *   대신 칸이 터지지 않게 «글자 수»로 막는다(시트 한 칸은 5만 자까지다).
 *   줄 수로 막으면 멀쩡한 날에도 자르고, 글자 수로 막으면 정말 넘칠 때만 자른다.
 */
var _OST_SHOW_ = 500;

/** 본문 글자 수 한도 — 시트 한 칸(5만 자)에 여유를 두고 */
var _OST_BODY_MAX_ = 40000;

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
  /*  ★ 날이 바뀌면 «어디까지 봤나»만 되돌린다 ★
      잡아 둔 것(OST_FOUND)은 지우지 않는다. 한 번 멈춘 건은 도착할 때까지
      공지에 남아 있어야 한다 — 오늘 치 훑기에서 빠졌다고 사라지면,
      사흘째 멈춘 건이 조용히 화면에서 없어진다. 도착하면 _ost_dropArrived_
      가 뺀다. */
  if (opt["처음부터"] || P.getProperty("OST_COHORT") !== 코호트) {
    P.setProperty("OST_COHORT", 코호트);
    P.setProperty("OST_IDX", "0");
    if (opt["처음부터"]) P.setProperty("OST_FOUND", "[]");
  }

  var 목록;
  try { 목록 = _ost_collect_(); }
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
  var 줄인수 = _ost_saveFound_(P, 잡은것);
  if (줄인수) L.push("★ 너무 많아 " + 줄인수 + "건은 적어 두지 못했습니다 (속성 한 칸이 9KB 입니다)");

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
    /*  ★ 날이 지나면 「며칠째」도 늘어야 한다 ★ 어제 잡은 것이 오늘도 2일째로
        보이면, 보는 사람이 「어제 그거네」 하고 넘긴다. 사흘째면 사흘째로 보여야
        손이 간다. 발송일을 적어 뒀으니 다시 센다. */
    if (it.ship) {
      var 발송 = _ost_ymdToDate_(it.ship);
      if (발송) it.며칠 = _ost_bizSince_(발송);
    }
    남김.push(it);
  }
  return 남김;
}

/**
 * 잡아 둔 것을 속성에 적는다. 한 칸(9KB)을 넘으면 저장이 «통째로» 실패해
 * 멈춘 건을 전부 잃으므로, 들어갈 만큼만 적고 몇 건을 줄였는지 돌려준다.
 */
function _ost_saveFound_(P, 잡은것) {
  var arr = 잡은것.slice(0, _OST_KEEP_);
  var s = JSON.stringify(arr);
  while (s.length > _OST_PROP_MAX_ && arr.length > 1) {
    arr = arr.slice(0, arr.length - Math.max(1, Math.floor(arr.length / 10)));
    s = JSON.stringify(arr);
  }
  P.setProperty("OST_FOUND", s);
  return 잡은것.length - arr.length;
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

  var 제목 = "로젠 출고 " + 잡은것.length + "건이 " + _OST_FROM_DAYS_ + "영업일 넘게 도착하지 않았습니다";
  var 줄 = [];
  for (var i = 0; i < 잡은것.length && i < _OST_SHOW_; i++) {
    var s = 잡은것[i];
    /*  영업소를 같이 적는다 — CS 가 제일 많이 하는 것이 「영업소에 바로 전화」다.
        송장만 있으면 그 번호를 또 찾아야 한다. */
    줄.push("· " + _ost_pretty_(s.inv) +
      (s.이름 ? "  " + s.이름 : "") +
      "  —  영업일 " + s.며칠 + "일째 · " + s.상태 +
      (s.영업소 ? " · " + s.영업소 : "") +
      (s.마지막 ? " · 마지막 " + s.마지막 : "") +
      (s.주문 ? "  (" + s.주문 + ")" : ""));
  }
  if (잡은것.length > _OST_SHOW_) 줄.push("… 외 " + (잡은것.length - _OST_SHOW_) + "건");
  //  칸이 터질 만큼 길면 그때만 자른다 — 자른 것은 반드시 말해 준다
  줄 = _stale_fitBody_(줄, _OST_BODY_MAX_);
  줄.push("");
  줄.push("로젠은 보통 다음날 도착합니다. " + _OST_FROM_DAYS_ +
          "영업일이 지났으면 확인이 필요합니다. (주말·공휴일은 세지 않습니다.)");
  줄.push(다봤나 ? "(오늘 치는 다 봤습니다.)" : "(아직 보는 중입니다 — 더 늘 수 있습니다.)");
  줄.push("도착하면 그 줄은 저절로 빠지고, 다 도착하면 카드가 닫힙니다.");

  return _stale_publish_(_OST_SRCKEY_, 제목, 줄.join("\n"), 잡은것.length);
}

/** 「yyyyMMdd」 → Date. 못 읽으면 null */
function _ost_ymdToDate_(s) {
  var m = String(s || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

/** Date → 「yyyyMMdd」 */
function _ost_ymd_(d) { return Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd"); }

/**
 * 보기 좋게 끊는다 — 로젠 11자리는 «3-4-4» 다.
 * 45303211446 → 453-0321-1446  (로젠 화면·실적 탭이 그렇게 적는다)
 * 2-4-5 로 끊었다가 고쳤다 — 사람이 화면과 대조할 때 안 맞아 보인다. (2026-10-08)
 */
function _ost_pretty_(d) {
  var s = String(d || "").replace(/[^0-9]/g, "");
  return s.length === 11 ? s.slice(0, 3) + "-" + s.slice(3, 7) + "-" + s.slice(7) : String(d || "");
}

/**
 * 오늘 몫을 가리는 표 — «오늘 날짜»다.
 * 코호트를 「며칠 전 그 날짜」로 잡지 않는다. 연휴가 끼면 그 날짜가 며칠씩
 * 제자리걸음을 해서 같은 날 치를 또 훑게 된다. 오늘로 잡으면 하루 한 바퀴다.
 */
function _ost_cohortKey_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd");
}

/**
 * 그 날 쉬나 — 토·일 · 공휴일 · 임시공휴일.
 *
 * ★ csLotteReturn.gs 의 _lrt_isOff_ 를 쓴다 ★ 같은 프로젝트에 이미 있는 표다.
 *   여기에 또 만들면 공휴일이 두 벌이 되고, 연말에 한쪽만 고쳐진다
 *   ([[one-value-one-owner]]). 토요일도 쉬는 것으로 본다 — 토요일 배송이
 *   되는 날도 있지만, 늦게 알리는 쪽이 헛경보보다 낫다.
 */
function _ost_isOff_(d) {
  try { return _lrt_isOff_(d); }
  catch (e) { var w = d.getDay(); return w === 0 || w === 6; }   // 표를 못 읽어도 주말은 센다
}

/**
 * 발송일 «다음»부터 오늘까지의 영업일 수.
 *   월 발송 · 화 오늘 → 1   (보통 이때 닿는다)
 *   월 발송 · 수 오늘 → 2   (늦다)
 *   목 발송 · 월 오늘 (금토일 쉼) → 1  (아직 정상)
 */
function _ost_bizSince_(발송일) {
  var 오늘 = new Date(); 오늘.setHours(0, 0, 0, 0);
  var d = new Date(발송일.getTime()); d.setHours(0, 0, 0, 0);
  var n = 0;
  for (var i = 0; i < 60; i++) {
    d.setDate(d.getDate() + 1);
    if (d > 오늘) break;
    if (!_ost_isOff_(d)) n++;
  }
  return n;
}

/** 회차키 「261006-3」 → 그날 0시의 Date. 못 읽으면 null */
function _ost_roundDate_(v) {
  var m = String(v || "").trim().match(/^(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  var d = new Date(2000 + parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
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
function _ost_collect_() {
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

    //  로젠 건만
    if (c.carrier != null && String(r[c.carrier] || "").indexOf("로젠") === -1) continue;

    var d = String(r[c.inv] || "").replace(/[^0-9]/g, "");
    if (d.length !== 11) continue;          // 로젠 송장이 아니다
    if (본것[d]) continue;                   // 합포장 — 한 번만 묻는다
    본것[d] = true;

    /*  ★ 「오늘 꼭 2영업일이 된 것」만 집는다 ★
        >= 2 로 하면 지난 날들이 계속 쌓여 하루에 수천 건을 묻게 된다.
        한 번 잡힌 건은 도착할 때까지 공지에 «남아 있으므로»(OST_FOUND),
        여기서 다시 안 집어도 사라지지 않는다. */
    var 발송 = _ost_roundDate_(r[c.round]);
    if (!발송) continue;
    if (_ost_bizSince_(발송) !== _OST_FROM_DAYS_) continue;

    out.push({ inv: d, days: _OST_FROM_DAYS_, ship: _ost_ymd_(발송),
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
