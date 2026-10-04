/**
 * ══════════════════════════════════════════════════════════════
 *  세트분리 → v2 올리기   (2026-09-21)
 *
 *  > "지금 세트분리(뉴)를 v2에 심어줘..속도 와 정확도 테스트를 할수 있게"
 *  > "자동으로 되야지 매번 사람이 다 눌러줄꺼면 자동화를 왜하는지"
 *
 *  ★ 왜 «실행 직후»여야 하는가 ★
 *    판매현황 탭은 그때그때 새로 붙여넣어 덮어쓴다. 밤에 크론이 와서
 *    당겨가면 **그 회차의 판매현황은 이미 없다** — 원장은 260921-1 인데
 *    입력은 260922-1 것이 되어, 맞대기가 통째로 어긋난다.
 *    (9/21 260917-1 로 실제로 겪음 — 138 대 257, 겹치는 줄 0)
 *    그래서 세트분리가 끝난 «그 자리»에서 v2 에게 당겨가라고 이른다.
 *
 *  ★ 시트를 기다리게 하지 않는다 ★
 *    v2 는 시트 열세 탭을 다시 읽으므로 수십 초가 걸린다. 사람이 그걸
 *    기다릴 이유가 없다. 1회용 트리거(.after)로 넘기고 실행은 그냥 끝난다.
 *    트리거는 제 손으로 지운다 — 자리가 쌓이면 다른 트리거가 못 산다.
 *
 *  ★ 곁다리다 ★
 *    여기서 무엇이 잘못돼도 세트분리는 이미 끝난 것이다. 절대 던지지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

var SS_V2_FN_ = 'ss_v2보내기';
var SS_V2_PROP_ = 'SS_V2_PENDING_RUNKEY';
var SS_V2_TAB_ = 'v2올리기기록';
var SS_V2_HEADER_ = ['시각', '회차', '결과', 'HTTP', '걸린초', '입력줄', '원장줄', '내용'];

/*  ★ 값은 함수 안에서 읽는다 ★  (2026-09-19 챗알림이 이틀 죽은 이유)
    GAS 는 파일을 이름 차례로 맨 위부터 돌린다. _secrets 가 아직 안 돌았으면
    파일 맨 위에서 읽은 값은 «늘 빈 값»이고, 그 뒤로 아무 소리 없이 안 간다. */
function _ss_v2_url_() {
  try { if (typeof V2_URL !== 'undefined' && V2_URL) return String(V2_URL).replace(/[/]+$/, ''); } catch (e) {}
  return '';
}
function _ss_v2_token_() {
  try { if (typeof V2_INGEST_TOKEN !== 'undefined' && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  return '';
}

/** 켜고 끄기 — 스크립트 속성 V2_PULL = off 면 안 보낸다 */
function _ss_v2_켜짐_() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty('V2_PULL') || '').toLowerCase() !== 'off';
  } catch (e) { return true; }
}

/**
 * 세트분리가 끝난 자리에서 부른다. 예약만 하고 곧장 돌아온다.
 * 절대 던지지 않는다 — 여기서 멈추면 다 끝난 실행이 실패로 보인다.
 */
function ss_v2_예약_(runKey) {
  try {
    if (!_ss_v2_켜짐_()) return '';
    if (!_ss_v2_url_() || !_ss_v2_token_()) return 'v2 주소·표가 없어 안 보냄';
    PropertiesService.getScriptProperties().setProperty(SS_V2_PROP_, String(runKey || ''));
    _ss_v2_트리거정리_();
    ScriptApp.newTrigger(SS_V2_FN_).timeBased().after(5 * 1000).create();
    return '예약됨 (5초 뒤)';
  } catch (e) {
    return '예약 실패 — ' + String(e && e.message ? e.message : e);
  }
}

/** 이 일을 위해 만든 1회용 트리거를 전부 지운다 */
function _ss_v2_트리거정리_() {
  var n = 0;
  try {
    var ts = ScriptApp.getProjectTriggers();
    for (var i = 0; i < ts.length; i++) {
      if (ts[i].getHandlerFunction() === SS_V2_FN_) { ScriptApp.deleteTrigger(ts[i]); n++; }
    }
  } catch (e) {}
  return n;
}

/** 트리거가 부르는 자리. 사람이 눌러도 된다 (그때는 화면에 결과를 띄운다) */
function ss_v2보내기() {
  _ss_v2_트리거정리_();   // 내 일은 내가 치운다. 남기면 자리만 먹는다
  var runKey = '';
  try { runKey = PropertiesService.getScriptProperties().getProperty(SS_V2_PROP_) || ''; } catch (e) {}
  return _ss_v2_당겨오기_(runKey);
}

/** 메뉴에서 지금 바로 — 마지막 회차를 v2 에 올리고 결과를 띄운다 */
function ss_v2지금보내기() {
  var runKey = '';
  try { runKey = PropertiesService.getScriptProperties().getProperty(SS_V2_PROP_) || ''; } catch (e) {}
  var r = _ss_v2_당겨오기_(runKey);
  return ssio_alert(r.글);
}

/**
 * v2 에게 «네가 시트를 읽어 담아라» 라고 이른다.
 *   GET {V2_URL}/api/setsplit/pull?회차=260921-1   (x-ingest-token)
 *
 * ★ 왜 v2 가 읽는가 ★ 시트 읽기가 OIDC 라 Vercel 안에서만 된다.
 *   여기서 자료를 밀어 넣으려면 판매현황을 통째로 실어 보내야 하는데
 *   GAS 요청 크기에 걸린다. 부르는 쪽이 가벼운 편이 맞다.
 */
function _ss_v2_당겨오기_(runKey) {
  var t0 = new Date().getTime();
  var at = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  var base = _ss_v2_url_(), token = _ss_v2_token_();
  if (!base || !token) {
    return _ss_v2_기록_(at, runKey, '건너뜀', '', 0, '', '', 'v2 주소 또는 표가 없습니다 (_secrets.gs)');
  }
  var url = base + '/api/setsplit/pull' + (runKey ? '?회차=' + encodeURIComponent(runKey) : '');
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'x-ingest-token': token },
      muteHttpExceptions: true,
      followRedirects: true
    });
    var code = res.getResponseCode();
    var body = res.getContentText() || '';
    var 초 = ((new Date().getTime() - t0) / 1000).toFixed(1);
    var j = null;
    try { j = JSON.parse(body); } catch (e) {}
    if (code === 200 && j && j.ok) {
      /*  어긋난 표가 있으면 «성공»이라 부르지 않는다 — 숫자가 다른데
          초록불이 켜지면 아무도 안 본다 (2026-09-17 결함 다섯의 교훈). */
      var 어긋 = (j.어긋남 || []).length;
      return _ss_v2_기록_(at, j.회차 || runKey, 어긋 ? '⚠ 어긋남 ' + 어긋 : '✅ 올림',
        code, 초, j.입력줄, j.원장줄,
        어긋 ? (j.어긋남 || []).slice(0, 3).join(' / ') : '시트와 DB 가 같습니다');
    }
    var 왜 = (j && (j.error || j.why)) ? String(j.error || j.why) : body.slice(0, 300);
    return _ss_v2_기록_(at, runKey, '❌ 실패', code, 초, '', '', 왜.slice(0, 400));
  } catch (e) {
    var 초2 = ((new Date().getTime() - t0) / 1000).toFixed(1);
    return _ss_v2_기록_(at, runKey, '❌ 못 부름', '', 초2, '', '', String(e && e.message ? e.message : e).slice(0, 400));
  }
}

/** 한 줄 남긴다. 아무도 안 보고 있어도 나중에 되짚을 데가 있어야 한다. */
function _ss_v2_기록_(at, runKey, 결과, code, 초, 입력줄, 원장줄, 내용) {
  var 글 = 'v2 올리기 · ' + 결과 + '\n' +
    '회차 ' + (runKey || '(마지막)') + '   ' + 초 + '초' +
    (입력줄 ? '\n입력 ' + 입력줄 + '줄 · 원장 ' + 원장줄 + '줄' : '') +
    '\n' + 내용;
  try {
    ssio_append(SS_V2_TAB_, SS_V2_HEADER_, [[at, runKey, 결과, code, 초, 입력줄, 원장줄, 내용]]);
    var sh = ssio_ss().getSheetByName(SS_V2_TAB_);
    if (sh && !sh.isSheetHidden() && sh.getLastRow() <= 2) {
      ssio_styleHeader(sh, SS_V2_HEADER_.length, { bg: '#2c4f6b' });
      sh.hideSheet();   // 곁다리 기록이다. 탭 목록을 어지럽히지 않는다
    }
  } catch (e) {}
  try { Logger.log(글); } catch (e) {}
  return { 결과: 결과, 글: 글, code: code, 초: 초 };
}
