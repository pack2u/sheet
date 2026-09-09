/**
 * ══════════════════════════════════════════════════════════════
 *  아침 자동 재매칭
 *  파일: 세트분리V2/gasAuto.js
 *  ★ 2026-09-09 신규
 *
 *  > "대리공급의 경우 당일 주문수집건중 3시 이후 수집건은 당일 송장번호가
 *  >  적히지 않고 다음날 오전 1시 수집분과 같이 송장이 입력되.. 그래서
 *  >  일일 마감시 전날(또는 품절로 인한 장기 미발송분) 일일마감 미매칭분에
 *  >  대해 한번더 송장을 매칭시켜야되"
 *
 *  ★ 재매칭 자체는 이미 있다 ★
 *    ss_송장전파 의 3)번 갈래가 **주문라인원장 전체**를 훑어, 운송장번호가
 *    빈 줄마다 find(고유ID) 를 다시 시도한다. 어제 것이든 지난주 품절 건이든
 *    송장이 뒤늦게 들어오면 그때 붙는다. 합포장 전파도 원장 전체에 다시 돈다.
 *
 *  ★ 그런데 자동으로 안 돌았다 ★
 *    ss_송장전파 는 **메뉴에서 사람이 눌러야만** 도는 함수였다. 트리거가 없었다.
 *    그래서 전날 3시 이후 대리공급 건은 다음날 오전 1시에 송장이 들어와도
 *    누군가 메뉴를 다시 누르기 전까지 미매칭으로 남았다.
 *    실측(회차 260908-3): 대리발송 0/15 · 전체 매칭 64.5%.
 *
 *  ★ 왜 아침 8시인가 ★
 *    대리공급 송장이 다음날 **오전 1시 수집분**과 함께 들어온다. 그 뒤라야
 *    붙는다. 세트분리를 돌리기 전에 끝나 있어야 일일마감에서 바로 쓴다.
 *
 *  ★ 화면이 없어도 된다 ★
 *    ss_송장전파 는 끝에 ssio_alert 를 부르는데, 그 함수는 getUi() 가 실패하면
 *    Logger 로 떨어진다(gasIO.js). 그래서 트리거에서 그대로 부를 수 있다.
 *
 *  ★ 실패해도 조용히 죽지 않는다 ★
 *    예외를 삼키되 로그에는 남긴다. 아침에 한 번 실패했다고 그날 일일마감이
 *    멈추면 안 되지만, 왜 안 붙었는지는 알 수 있어야 한다.
 * ══════════════════════════════════════════════════════════════
 */

/** 끄는 스위치 — 스크립트 속성 AUTO_REMATCH = off */
function _ssauto_enabled_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty('AUTO_REMATCH');
    if (v && String(v).toLowerCase() === 'off') return false;
  } catch (e) {}
  return true;
}

/**
 * 트리거가 부르는 것.
 *
 * ★ 원장이 커지는 것을 지켜본다 ★
 *   재매칭은 원장을 통째로 읽고 다시 쓴다. 지금은 몇백 줄이라 순식간이지만
 *   하루 250줄쯤 쌓이므로 몇 달 뒤에는 6분 한도가 보인다.
 *   그때 허둥대지 않게 **줄 수와 걸린 시간을 매번 남긴다.**
 *   숫자가 눈에 보이면 옮길 때를 미리 정할 수 있다.
 */
function ss_아침재매칭() {
  if (!_ssauto_enabled_()) {
    Logger.log('[아침재매칭] 꺼져 있음 (AUTO_REMATCH=off)');
    return '꺼져 있음';
  }
  var t0 = new Date().getTime();
  var 원장줄 = 0;
  try {
    var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
    원장줄 = lg ? Math.max(0, lg.getLastRow() - 1) : 0;
  } catch (e) {}

  var msg = '';
  try {
    msg = ss_송장전파();
  } catch (e) {
    var err = '[아침재매칭] 실패: ' + (e && e.message ? e.message : e);
    Logger.log(err);
    return err;
  }

  var sec = ((new Date().getTime() - t0) / 1000).toFixed(1);
  var head = '[아침재매칭] 원장 ' + 원장줄 + '줄 · ' + sec + '초';
  /* 6분 한도의 절반을 넘기면 미리 말해 둔다. 넘어가고 나서 알면 늦다 —
     그때는 이미 며칠치 재매칭이 조용히 건너뛰어진 뒤다. */
  if (Number(sec) > 180) {
    head += '  ★ 3분을 넘었습니다 — 원장이 커지고 있습니다. 재시도 범위를 줄이거나 v2 로 옮길 때입니다.';
  }
  Logger.log(head);
  Logger.log(String(msg || '').slice(0, 1500));
  return head;
}

/**
 * 아침 트리거를 단다 (하루 한 번, 8시).
 *
 * ★ 제 트리거만 지운다 ★
 *   getProjectTriggers() 를 통째로 지우면 남의 트리거까지 날아간다.
 */
function ss_아침재매칭트리거설치() {
  var all = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === 'ss_아침재매칭') {
      ScriptApp.deleteTrigger(all[i]);
      removed++;
    }
  }
  /* ★ 하루 두 번 돈다 ★  (2026-09-09 실측)
     롯데 실적 탭은 **그날 것만** 들고 있다 — 651줄이 전부 같은 집하일자였다.
     어제 것은 이미 없다. 그래서 롯데 자사출고 건은 **그날 안에** 붙여야 하고,
     못 붙이면 그 송장은 영영 사라진다.
       저녁 19:10  그날 롯데 출고분을 그날 잡는다
       아침 08:10  전날 3시 이후 대리공급분(다음날 오전 1시에 들어온다)을 잡는다
     둘은 잡는 대상이 다르다. 하나만 두면 반쪽이다. */
  ScriptApp.newTrigger('ss_아침재매칭')
    .timeBased().atHour(8).nearMinute(10).everyDays(1).create();
  ScriptApp.newTrigger('ss_아침재매칭')
    .timeBased().atHour(19).nearMinute(10).everyDays(1).create();
  var msg = '재매칭 트리거 설치됨 — 매일 08:10 · 19:10' +
    (removed ? ' (옛 트리거 ' + removed + '개 정리)' : '') +
    '\n\n대리공급 송장은 다음날 오전 1시 수집분과 함께 들어옵니다.' +
    '\n그 뒤에 돌아야 전날 3시 이후 건과 품절 장기 미발송분이 붙습니다.' +
    '\n끄려면 스크립트 속성 AUTO_REMATCH = off';
  Logger.log(msg);
  return ssio_alert(msg);
}

/**
 * 지금 원장에 **아직 안 붙은 줄**이 얼마나 되는지 본다. 아무것도 안 고친다.
 *
 * 다음날 미발송 체크에 쓸 목록이기도 하다 —
 * 며칠씩 안 붙는 줄은 품절이거나 출고가 빠진 것이다.
 */
function ss_미매칭점검() {
  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!lg || lg.getLastRow() < 2) return ssio_alert('원장이 비어 있습니다.');

  var cols = lg.getLastColumn();
  var head = lg.getRange(1, 1, 1, cols).getValues()[0];
  var ix = {};
  for (var q = 0; q < head.length; q++) {
    var n = ssText(head[q]);
    if (n && ix[n] === undefined) ix[n] = q;
  }
  if (ix['고유ID'] === undefined || ix['운송장번호'] === undefined) {
    return ssio_alert('원장에 고유ID·운송장번호 열이 없습니다.');
  }
  var g = function (row, name) {
    return ix[name] === undefined ? '' : ssText(row[ix[name]]);
  };

  var v = lg.getRange(2, 1, lg.getLastRow() - 1, cols).getValues();

  /* ★ 「무엇을 기다리는 중인가」로 가른다 ★  (2026-09-09)
     안 붙은 줄을 한 덩어리로 세면 손을 못 댄다. 기다리는 대상이 다르기 때문이다.
       업체 송장 대기(조치) — 재고 부족으로 조치에서 대리발송으로 뺀 건.
                            **롯데를 아무리 기다려도 안 온다.**
       전화주문           — 롯데에 P-ID 가 없다. V2 롯데 업로드로 전환하면 풀린다.
       롯데 송장 대기      — 자사출고. 실적이 들어오면 붙는다.
     그리고 **며칠째인가**가 제일 중요하다. 오늘 것은 정상, 이틀 넘으면 미발송이다. */
  function 갈래(row) {
    var 조치 = g(row, '조치');
    if (조치 === '대리발송') return '업체 송장 대기(조치)';
    var 경로 = g(row, '경로');
    if (경로 === '대리발송') return '업체 송장 대기';
    if (g(row, '주문번호출처') === '자동발급') return '전화주문 (롯데에 번호 없음)';
    return '롯데 송장 대기';
  }

  var 갈래별 = {}, byRun = {}, 목록 = [], 총 = 0, 안붙음 = 0;
  var runsSeen = {};
  for (var i = 0; i < v.length; i++) {
    var uid = g(v[i], '고유ID');
    if (!uid) continue;
    var route = g(v[i], '경로');
    if (route === '보류' || route === '비배송') continue;   // 애초에 출고 대상이 아니다
    총++;
    var run = g(v[i], '회차키') || '?';
    runsSeen[run] = true;
    if (g(v[i], '운송장번호')) continue;
    안붙음++;

    var k = 갈래(v[i]);
    갈래별[k] = (갈래별[k] || 0) + 1;
    byRun[run] = byRun[run] || {};
    byRun[run][k] = (byRun[run][k] || 0) + 1;

    if (목록.length < 30) {
      목록.push(run + '  ' + uid + '  ' + k +
        (g(v[i], '조치업체') ? '(' + g(v[i], '조치업체') + ')' : '') + '  ' +
        g(v[i], '거래처명').slice(0, 10) + '  ' + g(v[i], '품목명').slice(0, 20));
    }
  }

  var NL = String.fromCharCode(10);
  var runs = Object.keys(byRun).sort();
  var allRuns = Object.keys(runsSeen).sort();
  var 최신 = allRuns.length ? allRuns[allRuns.length - 1] : '';

  var msg = '원장 ' + 총 + '줄(출고 대상) 중 아직 송장이 안 붙은 줄 ' + 안붙음 + '줄' +
    '  (' + (총 ? (안붙음 * 100 / 총).toFixed(1) : '0') + '%)' + NL + NL;

  msg += '[무엇을 기다리는 중인가]' + NL;
  var ks = Object.keys(갈래별).sort();
  for (var a = 0; a < ks.length; a++) msg += '  ' + ks[a] + '  ' + 갈래별[ks[a]] + '줄' + NL;

  msg += NL + '[회차별]' + NL;
  for (var r = 0; r < runs.length; r++) {
    var parts = [];
    for (var kk in byRun[runs[r]]) {
      if (Object.prototype.hasOwnProperty.call(byRun[runs[r]], kk)) {
        parts.push(kk + ' ' + byRun[runs[r]][kk]);
      }
    }
    var 오래됨 = (runs[r] !== 최신);
    msg += '  ' + runs[r] + (오래됨 ? '  ★' : '   ') + '  ' + parts.join(' · ') + NL;
  }

  msg += NL +
    '※ ★ 표시는 최신 회차가 아닙니다 — 하루가 지났는데 아직 안 붙은 줄입니다.' + NL +
    '  「업체 송장 대기(조치)」는 재고가 없어 다른 업체로 뺀 건입니다.' + NL +
    '   롯데를 기다려도 안 옵니다 — 그 업체 송장을 수집해야 붙습니다.' + NL +
    '  「전화주문」은 롯데에 그 번호가 없어 못 맞습니다.' + NL +
    '   V2 롯데택배 탭으로 업로드를 시작하면 저절로 붙습니다.' + NL;

  if (목록.length) {
    msg += NL + '[미매칭 줄 (최대 30)]' + NL +
      '  회차 · 고유ID · 기다리는 것 · 거래처 · 품목' + NL + '  ' + 목록.join(NL + '  ');
  }
  return ssio_alert(msg);
}
/**
 * 고아 송장 점검 — **송장은 왔는데 붙일 주문이 원장에 없는 것**
 *
 * > "송장매칭시 송장번호가 남는경우 역으로 고유아이디를 일일마감에서 찾아
 *  >  매치이키는게 더 효율적일수도 있어"
 *
 * ★ 두 방향은 서로 다른 실패를 잡는다 ★
 *   정방향(ss_송장전파) : 주문은 있는데 송장이 없다 → 매일 다시 시도하면 붙는다
 *   역방향(여기)        : 송장은 있는데 주문이 없다 → 다시 시도해도 영영 안 붙는다
 *
 *   실측(2026-09-09): 고아 124건이 전부 원장보다 **번호가 새것**이었다.
 *   판매현황에 아직 안 들어온 주문의 송장이라, 다음 회차에 저절로 붙는다.
 *   그러니 지금 당장 역매칭을 붙일 이유는 없다 —
 *   **다만 며칠이 지나도 안 없어지는 고아는 다르다.** 그건 판매현황에서
 *   빠진 주문이고, 출고는 됐는데 우리 장부에 없는 것이다. 그게 제일 위험하다.
 *   그래서 「몇 건인가」가 아니라 **「며칠째인가」**를 본다.
 *
 * 아무것도 고치지 않는다. 보기만 한다.
 */
function ss_고아송장점검() {
  var cfg = ssio_config();
  var NL = String.fromCharCode(10);

  // ── 원장의 고유ID 모으기 ──
  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!lg || lg.getLastRow() < 2) return ssio_alert('원장이 비어 있습니다.');
  var lcols = lg.getLastColumn();
  var lhead = lg.getRange(1, 1, 1, lcols).getValues()[0];
  var li = {};
  for (var q = 0; q < lhead.length; q++) {
    var ln = ssText(lhead[q]);
    if (ln && li[ln] === undefined) li[ln] = q;
  }
  if (li['고유ID'] === undefined) return ssio_alert('원장에 고유ID 열이 없습니다.');
  var lv = lg.getRange(2, 1, lg.getLastRow() - 1, lcols).getValues();
  var known = {};
  for (var a = 0; a < lv.length; a++) {
    var u = ssText(lv[a][li['고유ID']]);
    if (u) known[u] = true;
  }

  // ── 롯데 실적 읽기 (ss_송장전파 와 같은 자리) ──
  var lId = ssText(cfg['롯데송장시트ID']) || '1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs';
  var lGid = ssNum(cfg['롯데송장탭GID']) || 1575029201;
  var 고아 = [], 총송장 = 0;
  try {
    var lSS = SpreadsheetApp.openById(lId);
    var lTab = null, sheets = lSS.getSheets();
    for (var s = 0; s < sheets.length; s++) if (sheets[s].getSheetId() === lGid) { lTab = sheets[s]; break; }
    if (!lTab) return ssio_alert('롯데 송장탭(GID ' + lGid + ')을 못 찾았습니다.');
    if (lTab.getLastRow() < 2) return ssio_alert('롯데 송장탭이 비어 있습니다.');

    var lrc = lTab.getLastColumn();
    var lrh = lTab.getRange(1, 1, 1, lrc).getDisplayValues()[0].map(function (x) {
      return ssText(x).replace(/\s/g, '');
    });
    var ci = -1, cw = -1, cd = -1;
    for (var h = 0; h < lrh.length; h++) {
      if (ci < 0 && (lrh[h] === '주문번호' || lrh[h] === '고객주문번호')) ci = h;
      if (cw < 0 && (lrh[h] === '운송장번호' || lrh[h] === '송장번호')) cw = h;
      /* ★ 자료등록일은 비어 있다 ★  (2026-09-09 실측 651줄 전부 빈칸)
         머리글은 있는데 값이 없다. 그것만 보면 고아가 전부 「(날짜없음)」이 되어
         **며칠째인지**를 알 수 없다 — 이 점검의 요점이 바로 그건데.
         실제로 채워지는 것은 집하일자다. 그것을 먼저 본다. */
      if (cd < 0 && (lrh[h] === '집하일자' || lrh[h] === '최초지시일자' ||
                     lrh[h] === '자료등록일' || lrh[h] === '등록일' || lrh[h] === '일자')) cd = h;
    }
    if (ci < 0) ci = 9;
    if (cw < 0) cw = 6;

    var rv = lTab.getRange(2, 1, lTab.getLastRow() - 1, lrc).getDisplayValues();
    for (var r = 0; r < rv.length; r++) {
      var o = ssText(rv[r][ci]), w = ssText(rv[r][cw]);
      if (!o || !w) continue;
      if (o.indexOf('주문번호') >= 0 || w.indexOf('운송장') >= 0) continue;
      총송장++;
      if (known[o]) continue;
      고아.push({ o: o, w: w, d: cd >= 0 ? ssText(rv[r][cd]) : '' });
    }
  } catch (e) {
    return ssio_alert('롯데 송장탭을 못 읽었습니다: ' + (e && e.message ? e.message : e));
  }

  // ── 날짜별로 묶는다. 오래된 고아가 진짜 문제다. ──
  var byDay = {};
  for (var g = 0; g < 고아.length; g++) {
    var d2 = 고아[g].d ? 고아[g].d.slice(0, 10) : '(날짜없음)';
    byDay[d2] = (byDay[d2] || 0) + 1;
  }
  var days = Object.keys(byDay).sort();

  var msg = '롯데 송장 ' + 총송장 + '건 중 원장에 짝이 없는 것 ' + 고아.length + '건' +
    '  (' + (총송장 ? (고아.length * 100 / 총송장).toFixed(1) : '0') + '%)' + NL + NL;
  if (!고아.length) {
    msg += '고아 송장이 없습니다 — 모든 송장이 원장의 주문과 짝이 맞습니다.';
    return ssio_alert(msg);
  }

  msg += '[등록일별]' + NL;
  for (var k = 0; k < days.length; k++) msg += '  ' + days[k] + '  ' + byDay[days[k]] + '건' + NL;
  msg += NL +
    '※ 오늘·어제 것은 대개 정상입니다 — 판매현황에 아직 안 들어온 주문입니다.' + NL +
    '  **이틀이 지나도 남아 있으면 판매현황에서 빠진 주문**입니다.' + NL +
    '  출고는 됐는데 우리 장부에 없는 것이라, 정산·재고가 어긋납니다.' + NL + NL +
    '[고아 송장 (최대 25)]' + NL + '  주문번호 · 운송장 · 등록일' + NL;
  for (var m = 0; m < 고아.length && m < 25; m++) {
    msg += '  ' + 고아[m].o + '  ' + 고아[m].w + '  ' + 고아[m].d + NL;
  }
  return ssio_alert(msg);
}

/* ══════════════════════════════════════════════════════════════
 *  미매칭 메꾸기 — 전화주문에 송장을 되찾아 붙인다
 *  ★ 2026-09-09
 *
 *  > "미매칭분들..전화주문이 대다수라 이름 상품명 전화번호등으로 매칭을
 *  >  시켜야 하는문제라 이부분은 시간이 걸려도 니가 매꿔주면 좋겠어"
 *
 *  ★ 왜 생겼나 ★
 *    전화주문은 구 세트분리로 출고되는 동안 롯데에 주문번호가 안 실렸다.
 *    롯데 실적의 주문번호 칸이 **비어 있는 줄이 304개**다. 그게 전화주문들이다.
 *    번호가 없으니 번호로는 못 맞춘다 — 이름·품목·박스수로 되짚어야 한다.
 *
 *  ★ 자동으로 원장에 쓰지 않는다 ★
 *    틀린 송장을 붙이는 것은 안 붙이는 것보다 **나쁘다.** 고객에게 남의 박스를
 *    알려 주게 된다. 그래서 여기서는 「메꾸기후보」 탭에 적기만 하고,
 *    사람이 확인 칸에 표시한 줄만 ss_메꾸기반영 이 원장에 쓴다.
 *
 *  ★ 박스수가 결정적이다 ★  (사장님 지적)
 *    한 고객에게 송장이 여럿인 것은 「어느 것이냐」가 아니라 **여러 박스**다.
 *    같은 걸 20개 시키면 20장이 나가고 세트면 그 두 배다.
 *    그래서 찾은 송장 수가 원장의 택배박스수량과 같으면 **전부 그 주문 것**이다.
 *
 *  ★ 샘플은 품목으로 못 맞춘다 ★  (사장님 확인)
 *    사방넷 샘플 주문은 판매현황에 실제 품목명이 있지만, **전화주문 샘플**은
 *    CS 가 「샘플 발송요청」이라고 적는다. 롯데에는 실제 품목이 찍혀 있어
 *    글자가 안 맞는다. 그런 건은 이름+박스수로만 판단한다.
 * ══════════════════════════════════════════════════════════════ */

var SS_FILL_TAB = '메꾸기후보';
var SS_FILL_HEADER = ['확인', '회차', '고유ID', '거래처', '품목', '박스수',
  '찾은송장수', '송장', '확신도', '근거'];

/** 글자 비교용 — 공백·괄호·기호를 없앤다 */
function _ssf_key_(s) {
  return String(s == null ? '' : s).replace(/[\s()\[\]{}.,\-_\/·]/g, '').toLowerCase();
}
/** 이름이 같은가. 상호가 붙었다 말았다 해서 서로 품는 것도 같은 것으로 본다. */
function _ssf_nameHit_(a, b) {
  var A = _ssf_key_(a), B = _ssf_key_(b);
  if (!A || !B || A.length < 2 || B.length < 2) return false;
  return A === B || A.indexOf(B) !== -1 || B.indexOf(A) !== -1;
}
/** 품목 열쇠 — 뒤의 수량·「몸통만/뚜껑만」은 떼고 앞부분만 본다 */
function _ssf_itemKey_(s) {
  return _ssf_key_(s).replace(/몸통만$|뚜껑만$/, '').replace(/\d+개$/, '').slice(0, 10);
}

/** 후보를 찾아 「메꾸기후보」 탭에 적는다. **원장은 안 건드린다.** */
function ss_미매칭메꾸기() {
  var NL = String.fromCharCode(10);
  var cfg = ssio_config();

  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!lg || lg.getLastRow() < 2) return ssio_alert('원장이 비어 있습니다.');
  var lc = lg.getLastColumn();
  var lh = lg.getRange(1, 1, 1, lc).getValues()[0];
  var ix = {};
  for (var q = 0; q < lh.length; q++) {
    var nm0 = ssText(lh[q]);
    if (nm0 && ix[nm0] === undefined) ix[nm0] = q;
  }
  var G = function (row, name) { return ix[name] === undefined ? '' : ssText(row[ix[name]]); };
  var lv = lg.getRange(2, 1, lg.getLastRow() - 1, lc).getValues();

  var need = {}, order = [];
  for (var i = 0; i < lv.length; i++) {
    if (G(lv[i], '주문번호출처') !== '자동발급') continue;
    var route = G(lv[i], '경로');
    if (route.indexOf('롯데') !== 0) continue;      // 대리발송은 롯데에 없다
    if (G(lv[i], '운송장번호')) continue;
    var uid = G(lv[i], '고유ID');
    if (!uid) continue;
    if (!need[uid]) {
      need[uid] = { uid: uid, run: G(lv[i], '회차키'), 거래처: G(lv[i], '거래처명'),
        받는분: G(lv[i], '원받는분'), 품목: [], 박스: 0 };
      order.push(uid);
    }
    need[uid].품목.push(G(lv[i], '출력품목명') || G(lv[i], '품목명'));
    need[uid].박스 += Number(String(G(lv[i], '택배박스수량')).replace(/[^0-9.]/g, '')) || 0;
  }
  if (!order.length) return ssio_alert('메꿀 전화주문이 없습니다 — 다 붙었습니다.');

  var lId = ssText(cfg['롯데송장시트ID']) || '1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs';
  var lGid = ssNum(cfg['롯데송장탭GID']) || 1575029201;
  var free = [];
  try {
    var lSS = SpreadsheetApp.openById(lId), tabs = lSS.getSheets(), lTab = null;
    for (var s = 0; s < tabs.length; s++) if (tabs[s].getSheetId() === lGid) { lTab = tabs[s]; break; }
    if (!lTab) return ssio_alert('롯데 송장탭(GID ' + lGid + ')을 못 찾았습니다.');
    var rc = lTab.getLastColumn();
    var rh = lTab.getRange(1, 1, 1, rc).getDisplayValues()[0].map(function (x) {
      return ssText(x).replace(/\s/g, '');
    });
    var f = function (name, dflt) { var k = rh.indexOf(name); return k >= 0 ? k : dflt; };
    var cInv = f('운송장번호', 6), cOrd = f('주문번호', 9),
        cNm = f('수하인명', 15), cIt = f('상품명', 28);
    var rv = lTab.getRange(2, 1, lTab.getLastRow() - 1, rc).getDisplayValues();
    for (var r = 0; r < rv.length; r++) {
      var inv = ssText(rv[r][cInv]);
      if (!inv || ssText(rv[r][cOrd])) continue;      // 번호가 있는 줄은 이미 붙는다
      if (inv.indexOf('운송장') >= 0) continue;
      free.push({ inv: inv, nm: ssText(rv[r][cNm]), it: ssText(rv[r][cIt]) });
    }
  } catch (e) {
    return ssio_alert('롯데 송장탭을 못 읽었습니다: ' + (e && e.message ? e.message : e));
  }
  if (!free.length) return ssio_alert('롯데 실적에 주문번호가 빈 줄이 없습니다 — 메꿀 재료가 없습니다.');

  var rows = [], 확인필요 = 0, 못찾음 = 0;
  for (var o = 0; o < order.length; o++) {
    var t = need[order[o]];
    var 박스 = Math.round(t.박스) || 1;

    var cands = [];
    for (var c = 0; c < free.length; c++) {
      if (_ssf_nameHit_(free[c].nm, t.거래처) || _ssf_nameHit_(free[c].nm, t.받는분)) cands.push(free[c]);
    }
    if (!cands.length) {
      못찾음++;
      rows.push(['', t.run, t.uid, t.거래처, t.품목[0] || '', 박스, 0, '', '', '롯데 실적에 이 이름이 없음']);
      continue;
    }

    /* 품목으로 좁힌다. 좁혀지지 않으면(전화주문 샘플처럼) 이름 후보를 그대로 쓴다 —
       그때는 박스수가 유일한 근거다. */
    var keys = [];
    for (var k2 = 0; k2 < t.품목.length; k2++) {
      var kk = _ssf_itemKey_(t.품목[k2]);
      if (kk.length >= 4 && keys.indexOf(kk) === -1) keys.push(kk);
    }
    var tight = [];
    for (var c2 = 0; c2 < cands.length; c2++) {
      var fk = _ssf_itemKey_(cands[c2].it);
      for (var k3 = 0; k3 < keys.length; k3++) {
        if (fk === keys[k3] || fk.indexOf(keys[k3].slice(0, 6)) !== -1 ||
            keys[k3].indexOf(fk.slice(0, 6)) !== -1) { tight.push(cands[c2]); break; }
      }
    }
    var use = tight.length ? tight : cands;
    var 품목맞음 = tight.length > 0;

    var invs = [], seenInv = {};
    for (var u = 0; u < use.length; u++) {
      if (!seenInv[use[u].inv]) { seenInv[use[u].inv] = true; invs.push(use[u].inv); }
    }

    var 확신, 근거;
    if (invs.length === 박스) {
      확신 = 품목맞음 ? '★★★' : '★★';
      근거 = (품목맞음 ? '이름+품목' : '이름') + ' · 박스 ' + 박스 + ' = 송장 ' + invs.length;
    } else {
      확신 = '★';
      근거 = (품목맞음 ? '이름+품목' : '이름') + ' · 박스 ' + 박스 + ' ≠ 송장 ' + invs.length + ' — 골라 주세요';
      확인필요++;
    }
    rows.push(['', t.run, t.uid, t.거래처, t.품목[0] || '', 박스, invs.length,
      invs.join(' '), 확신, 근거]);
  }

  /* 손댈 것이 위로 — ★ 가 적을수록 사람이 봐야 한다. 못 찾은 것은 맨 아래. */
  rows.sort(function (a, b) {
    var w = function (x) { return x[8] === '★' ? 0 : (x[8] === '★★' ? 1 : (x[8] === '★★★' ? 2 : 3)); };
    return w(a) - w(b);
  });

  ssio_write(SS_FILL_TAB, SS_FILL_HEADER, rows, { bg: '#6b4f2c' });

  var cnt = function (mark) {
    var k = 0;
    for (var z = 0; z < rows.length; z++) if (rows[z][8] === mark) k++;
    return k;
  };
  return ssio_alert('메꾸기 후보를 「' + SS_FILL_TAB + '」 탭에 적었습니다.' + NL + NL +
    '  대상(미매칭 전화주문)        ' + order.length + '건' + NL +
    '  ★★★ 이름+품목+박스수 일치    ' + cnt('★★★') + '건' + NL +
    '  ★★  이름+박스수 일치         ' + cnt('★★') + '건' + NL +
    '  ★   개수가 안 맞아 골라야 함  ' + 확인필요 + '건' + NL +
    '  —   롯데 실적에 이름 없음     ' + 못찾음 + '건' + NL + NL +
    '★★★·★★ 는 그대로 써도 됩니다. 확인 칸에 「Y」를 적으면 반영됩니다.' + NL +
    '★ 은 송장 칸에서 쓸 것만 남기고 나머지를 지운 뒤 「Y」를 적으세요.' + NL + NL +
    '다 표시했으면 「✅ 메꾸기 반영」을 실행하세요. 원장에만 적습니다.');
}

/**
 * 「메꾸기후보」에서 확인 칸이 표시된 줄을 원장에 쓴다.
 *
 * ★ 이미 송장이 있는 줄은 건드리지 않는다 ★
 *   그 사이에 정상 매칭이 붙었을 수 있다. 사람이 고른 값으로 덮으면
 *   맞는 것을 틀린 것으로 바꾸게 된다.
 */
function ss_메꾸기반영() {
  var NL = String.fromCharCode(10);
  var ft = ssio_ss().getSheetByName(SS_FILL_TAB);
  if (!ft || ft.getLastRow() < 2) return ssio_alert('「' + SS_FILL_TAB + '」 탭이 비어 있습니다.');
  var fv = ft.getRange(2, 1, ft.getLastRow() - 1, SS_FILL_HEADER.length).getDisplayValues();

  var want = {}, 고른수 = 0;
  for (var i = 0; i < fv.length; i++) {
    var mark = ssText(fv[i][0]).toUpperCase();
    if (mark !== 'Y' && mark !== 'O' && mark !== 'ㅇ') continue;
    var uid = ssText(fv[i][2]), inv = ssText(fv[i][7]);
    if (!uid || !inv) continue;
    want[uid] = inv;
    고른수++;
  }
  if (!고른수) return ssio_alert('확인 칸에 「Y」가 표시된 줄이 없습니다.');

  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!lg || lg.getLastRow() < 2) return ssio_alert('원장이 비어 있습니다.');
  var lc = lg.getLastColumn();
  var lh = lg.getRange(1, 1, 1, lc).getValues()[0];
  var ix = {};
  for (var q = 0; q < lh.length; q++) {
    var nm1 = ssText(lh[q]);
    if (nm1 && ix[nm1] === undefined) ix[nm1] = q;
  }
  if (ix['고유ID'] === undefined || ix['운송장번호'] === undefined) {
    return ssio_alert('원장에 고유ID·운송장번호 열이 없습니다.');
  }
  var lv = lg.getRange(2, 1, lg.getLastRow() - 1, lc).getValues();
  var 채움 = 0, 건너뜀 = 0;
  for (var r = 0; r < lv.length; r++) {
    var u = ssText(lv[r][ix['고유ID']]);
    if (!u || !want[u]) continue;
    if (ssText(lv[r][ix['운송장번호']])) { 건너뜀++; continue; }   // 이미 붙은 줄은 안 건드린다
    lv[r][ix['운송장번호']] = want[u];
    if (ix['송장매칭'] !== undefined) lv[r][ix['송장매칭']] = '되찾음(수동확인)';
    채움++;
  }
  lg.getRange(2, 1, lv.length, lc).setValues(lv);

  return ssio_alert('메꾸기 반영 완료' + NL + NL +
    '  고른 주문  ' + 고른수 + '건' + NL +
    '  채운 줄    ' + 채움 + '줄' + NL +
    (건너뜀 ? '  이미 붙어 있어 건너뛴 줄  ' + 건너뜀 + '줄' + NL : '') + NL +
    '송장매칭 칸에 「되찾음(수동확인)」으로 남습니다 — 나중에 구분할 수 있게.');
}
