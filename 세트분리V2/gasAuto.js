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
  ScriptApp.newTrigger('ss_아침재매칭')
    .timeBased().atHour(8).nearMinute(10).everyDays(1).create();
  var msg = '아침 재매칭 트리거 설치됨 — 매일 08:10' +
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

  var v = lg.getRange(2, 1, lg.getLastRow() - 1, cols).getValues();
  var byRun = {}, 미매칭 = [], 총 = 0, 안붙음 = 0;
  for (var i = 0; i < v.length; i++) {
    var uid = ssText(v[i][ix['고유ID']]);
    if (!uid) continue;
    var route = ix['경로'] !== undefined ? ssText(v[i][ix['경로']]) : '';
    if (route === '보류' || route === '비배송') continue;   // 애초에 출고 대상이 아니다
    총++;
    if (ssText(v[i][ix['운송장번호']])) continue;
    안붙음++;
    var run = ix['회차키'] !== undefined ? ssText(v[i][ix['회차키']]) : '?';
    byRun[run] = byRun[run] || { 안붙음: 0, 경로: {} };
    byRun[run].안붙음++;
    byRun[run].경로[route] = (byRun[run].경로[route] || 0) + 1;
    if (미매칭.length < 30) {
      미매칭.push(run + '  ' + uid + '  ' + route + '  ' +
        (ix['받는분'] !== undefined ? ssText(v[i][ix['받는분']]).slice(0, 12) : '') + '  ' +
        (ix['품목명'] !== undefined ? ssText(v[i][ix['품목명']]).slice(0, 22) : ''));
    }
  }

  var NL = String.fromCharCode(10);
  var msg = '원장 ' + 총 + '줄(출고 대상) 중 아직 송장이 안 붙은 줄 ' + 안붙음 + '줄' +
    '  (' + (총 ? (안붙음 * 100 / 총).toFixed(1) : '0') + '%)' + NL + NL + '[회차별]' + NL;
  var runs = Object.keys(byRun).sort();
  for (var r = 0; r < runs.length; r++) {
    var b = byRun[runs[r]];
    var 경로들 = [];
    for (var k in b.경로) if (Object.prototype.hasOwnProperty.call(b.경로, k)) 경로들.push(k + ' ' + b.경로[k]);
    msg += '  ' + runs[r] + '  ' + b.안붙음 + '줄   ' + 경로들.join(' · ') + NL;
  }
  /* 오래된 회차가 남아 있으면 그건 「아직 안 온 송장」이 아니라
     품절이거나 출고가 빠진 것이다. 다음날 미발송 체크가 볼 자리다. */
  if (runs.length > 2) {
    msg += NL + '※ 회차가 셋 이상 남아 있습니다. 오래된 회차는 송장 대기가 아니라' + NL +
      '  품절·미발송일 가능성이 큽니다 — 미발송 체크에서 확인하세요.';
  }
  if (미매칭.length) {
    msg += NL + NL + '[미매칭 줄 (최대 30)]' + NL + '  회차 · 고유ID · 경로 · 받는분 · 품목' + NL +
      '  ' + 미매칭.join(NL + '  ');
  }
  return ssio_alert(msg);
}
