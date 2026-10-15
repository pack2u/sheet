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

/* ══════════════════════════════════════════════════════════════
 *  전화주문 → 세트분리 다리   (2026-10-15 · v2 sql/132 · /api/setsplit/phone-lines)
 *
 *  > "내부 시스템부터 잡아 나가자" — 전화주문 → 입금 → 출고, 「v2 → 세트분리 직접」
 *
 *  판매현황을 읽은 «직후» v2 에 묻는다: 입금확인 · 아직 안 나간 전화주문.
 *    off     — 아무것도 안 한다
 *    shadow  — 「전화주문v2기록」 탭에만 적는다. 판매현황엔 안 넣는다 (직원은 이카운트로 그대로)
 *    live    — 판매현황 탭 끝에 머리글 «이름»으로 맞춰 붙인다(칸 차례를 믿지 않는다).
 *              순번은 탭의 마지막 순번 다음부터. 전화번호 앞 0 이 안 날아가게 글자 칸으로.
 *              「일자-No.」 에 V2P+주문번호 표시 — 이미 붙어 있는 주문은 다시 안 붙인다.
 *  ★ 나갔다는 확인은 «성공한 회차»에서만 ★  ss_실행 끝(v2 올리기 예약 옆)에서 보낸다.
 *    회차가 멈추면 확인을 안 보낸다 → v2 는 그 주문을 다음에 또 준다(탭에 이미 있으면 표시로 걸러진다).
 *    확인 보내기가 실패하면 속성에 남겨 두고 다음 회차 첫머리에 다시 보낸다.
 *  ★ 재실행·조치 적용은 묻지 않는다 ★  탭에 적힌 그대로 다시 돈다 — 같은 회차는 같은 자료.
 *  ★ 곁다리다 ★  절대 던지지 않는다. 여기서 실패해도 판매현황은 그대로 돈다(전화주문은 다음 회차에).
 * ══════════════════════════════════════════════════════════════ */
var SS_PHONE_TAB_ = '전화주문v2기록';
var SS_PHONE_HEADER_ = ['시각', '갈래', '회차', '거래처', '주문', '줄', '합계', '내용'];
var SS_PHONE_TAKEN_ = 'SS_PHONE_TAKEN';      // 이번 회차에 판매현황에 올라간 주문 id (JSON 배열)
var SS_PHONE_CONFIRM_ = 'SS_PHONE_CONFIRM';  // 못 보낸 확인 {회차, 주문:[]}

function _ss_phone_표시_(id) { return 'V2P' + String(id || '').replace(/-/g, '').slice(0, 12); }

function _ss_phone_기록_(갈래, 회차, 거래처, 주문, 줄, 합계, 내용) {
  try {
    var at = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    ssio_append(SS_PHONE_TAB_, SS_PHONE_HEADER_, [[at, 갈래, 회차 || '', 거래처 || '', 주문 || '', 줄 || '', 합계 || '', 내용 || '']]);
    var sh = ssio_ss().getSheetByName(SS_PHONE_TAB_);
    if (sh && sh.getLastRow() <= 2) ssio_styleHeader(sh, SS_PHONE_HEADER_.length, { bg: '#2c4f6b' });
  } catch (e) {}
}

function _ss_phone_post_(body) {
  var base = _ss_v2_url_(), token = _ss_v2_token_();
  if (!base || !token) return { ok: false, j: null, code: 0 };
  var res = UrlFetchApp.fetch(base + '/api/setsplit/phone-lines', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { 'x-ingest-token': token }, muteHttpExceptions: true, followRedirects: true
  });
  var j = null;
  try { j = JSON.parse(res.getContentText() || ''); } catch (e) {}
  return { ok: res.getResponseCode() === 200 && !!(j && j.ok), j: j, code: res.getResponseCode() };
}

/** 지난 회차에서 못 보낸 확인부터 — 다음 회차 첫머리에 */
function _ss_phone_확인다시_() {
  var p = PropertiesService.getScriptProperties();
  var raw = p.getProperty(SS_PHONE_CONFIRM_);
  if (!raw) return;
  try {
    var c = JSON.parse(raw);
    var r = _ss_phone_post_({ 회차: c.회차, 주문: c.주문 });
    if (r.ok) {
      p.deleteProperty(SS_PHONE_CONFIRM_);
      _ss_phone_기록_('확인(다시)', c.회차, '', c.주문.length + '건', '', '', '지난번 못 보낸 「나갔음」을 보냄');
    }
  } catch (e) {}
}

/**
 * 판매현황을 읽은 직후 부른다 (ss_실행). 절대 던지지 않는다.
 * @return {{mode:string, 붙임:number, 글:string}}  붙였으면(live) 부르는 쪽이 판매현황을 다시 읽는다
 */
function ss_v2_전화줄_(opts) {
  try {
    if (opts && (opts.mirrorOnly || opts.회차유지)) return { mode: '', 붙임: 0, 글: '' };
    var base = _ss_v2_url_(), token = _ss_v2_token_();
    if (!base || !token) return { mode: '', 붙임: 0, 글: '' };
    _ss_phone_확인다시_();
    var res = UrlFetchApp.fetch(base + '/api/setsplit/phone-lines', {
      method: 'get', headers: { 'x-ingest-token': token }, muteHttpExceptions: true, followRedirects: true
    });
    var code = res.getResponseCode(), j = null;
    try { j = JSON.parse(res.getContentText() || ''); } catch (e) {}
    if (code !== 200 || !j || !j.ok) {
      var 왜 = 'HTTP ' + code + ' ' + String((j && j.error) || '').slice(0, 200);
      _ss_phone_기록_('못 가져옴', '', '', '', '', '', 왜);
      return { mode: '', 붙임: 0, 글: '전화주문 v2 를 못 가져왔습니다 (' + 왜 + ') — 다음 회차에 다시' };
    }
    var 주문 = j.주문 || [], 줄 = j.줄 || [];
    if (j.mode === 'off') return { mode: 'off', 붙임: 0, 글: '' };
    if (!주문.length) {
      //  0건이어도 한 줄 — 「이 회차에 v2 에 물었다」가 탭에 보여야 한다 (10-15 2차 확인 때 증거가 없었다)
      _ss_phone_기록_('물음 · 0건', '', '', '', '', '', 'v2(' + j.mode + ') — 입금확인 · 안 나간 전화주문 없음');
      return { mode: j.mode, 붙임: 0, 글: '전화주문 v2(' + j.mode + '): 나갈 것 0' };
    }
    if (j.mode === 'shadow') {
      for (var i = 0; i < 주문.length; i++) {
        var o = 주문[i];
        _ss_phone_기록_('그림자', '', o.거래처, String(o.id).slice(0, 8), o.줄수, o.합계,
          '입금확인 — 켜면 이 회차에 나갔을 주문 (판매현황엔 안 넣음)');
      }
      return { mode: 'shadow', 붙임: 0, 글: '전화주문 v2(그림자): ' + 주문.length + '건 ' + 줄.length + '줄 — 판매현황엔 안 넣음' };
    }
    var r = _ss_phone_붙이기_(j);
    PropertiesService.getScriptProperties().setProperty(SS_PHONE_TAKEN_, JSON.stringify(r.주문));
    return {
      mode: 'live', 붙임: r.줄,
      글: '전화주문 v2: ' + r.주문.length + '건 · 새로 붙인 줄 ' + r.줄 +
        (r.건너뜀 ? ' (이미 붙어 있던 ' + r.건너뜀 + '건은 안 붙임)' : '')
    };
  } catch (e) {
    var 오류 = String(e && e.message ? e.message : e).slice(0, 200);
    _ss_phone_기록_('오류', '', '', '', '', '', 오류 + ' — 판매현황은 그대로 돌았음. 전화주문은 다음 회차에');
    return { mode: '', 붙임: 0, 글: '전화주문 v2 오류 — ' + 오류 + ' (판매현황은 그대로 돕니다)' };
  }
}

/** live — 판매현황 탭 끝에 머리글 이름으로 맞춰 붙인다 */
function _ss_phone_붙이기_(j) {
  var sh = ssio_sheet(SSIO_TABS.입력);
  var 값 = sh.getLastRow() ? sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getDisplayValues() : [];
  //  머리 줄 — 이카운트 엑셀은 위에 제목 줄이 있다. 「순번」과 「품목코드」가 같이 있는 첫 줄
  var 머리줄 = -1;
  for (var r = 0; r < Math.min(값.length, 15); r++) {
    if (값[r].indexOf('순번') >= 0 && 값[r].indexOf('품목코드') >= 0) { 머리줄 = r; break; }
  }
  var 머리;
  if (머리줄 < 0) {
    var 빈탭 = !값.some(function (row) { return row.join('') !== ''; });
    if (!빈탭) throw new Error('판매현황 머리글(순번·품목코드)을 못 찾아 전화주문을 붙이지 않았습니다');
    머리 = j.머리;
    sh.getRange(1, 1, 1, 머리.length).setValues([머리]);
    값 = [머리]; 머리줄 = 0;
  } else {
    머리 = 값[머리줄];
  }
  var 순번칸 = 머리.indexOf('순번'), 일자칸 = 머리.indexOf('일자-No.');
  var 있던 = {}, 마지막 = 0;
  for (var k = 머리줄 + 1; k < 값.length; k++) {
    var s = String(값[k][순번칸] || '').trim();
    if (/^[0-9]+$/.test(s) && Number(s) > 마지막) 마지막 = Number(s);
    var 표 = 일자칸 >= 0 ? String(값[k][일자칸] || '') : '';
    var m = 표.match(/V2P[0-9a-f]{12}/);
    if (m) 있던[m[0]] = true;
  }
  var 오늘 = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy/MM/dd');
  var 줄들 = [], 붙인주문 = [], 건너뜀 = 0, 줄i = 0;
  var 주문 = j.주문 || [], 줄 = j.줄 || [];
  for (var a = 0; a < 주문.length; a++) {
    var o = 주문[a], 표시 = _ss_phone_표시_(o.id);
    var 이것 = 줄.slice(줄i, 줄i + o.줄수);
    줄i += o.줄수;
    붙인주문.push(o.id);
    if (있던[표시]) { 건너뜀++; continue; }
    for (var b = 0; b < 이것.length; b++) {
      var c = 이것[b];
      마지막++;
      줄들.push(머리.map(function (h) {
        if (h === '순번') return String(마지막);
        if (h === '일자-No.') return 오늘 + ' -' + 표시;
        return c[h] == null ? '' : String(c[h]);
      }));
    }
    _ss_phone_기록_('붙임', '', o.거래처, String(o.id).slice(0, 8), o.줄수, o.합계,
      '판매현황 ' + (마지막 - 이것.length + 1) + '~' + 마지막 + '번');
  }
  if (줄들.length) {
    var 칸 = sh.getRange(sh.getLastRow() + 1, 1, 줄들.length, 머리.length);
    칸.setNumberFormat('@');   // 전화 010… 의 앞 0 · 합계 글자 그대로
    칸.setValues(줄들);
  }
  return { 주문: 붙인주문, 줄: 줄들.length, 건너뜀: 건너뜀 };
}

/** 회차가 끝까지 성공한 뒤 (ss_실행 끝) — 붙였던 주문을 «나갔음»으로. 절대 던지지 않는다 */
function ss_v2_전화확인_(runKey) {
  var p = PropertiesService.getScriptProperties();
  var raw = '';
  try { raw = p.getProperty(SS_PHONE_TAKEN_) || ''; } catch (e) {}
  if (!raw) return '';
  var ids = [];
  try { ids = JSON.parse(raw) || []; } catch (e) {}
  try { p.deleteProperty(SS_PHONE_TAKEN_); } catch (e) {}
  if (!ids.length) return '';
  try {
    var r = _ss_phone_post_({ 회차: runKey, 주문: ids });
    if (r.ok) {
      _ss_phone_기록_('나감', runKey, '', ids.length + '건', '', '', '적음 ' + (r.j.적음 || 0) + ' · 이미 ' + (r.j.이미 || 0));
      return '전화주문 ' + ids.length + '건 나감으로 적음';
    }
    throw new Error('HTTP ' + r.code + ' ' + String((r.j && (r.j.error || (r.j.실패 || []).join(' / '))) || '').slice(0, 200));
  } catch (e) {
    try { p.setProperty(SS_PHONE_CONFIRM_, JSON.stringify({ 회차: runKey, 주문: ids })); } catch (e2) {}
    _ss_phone_기록_('확인 실패', runKey, '', ids.length + '건', '', '',
      String(e && e.message ? e.message : e).slice(0, 300) + ' — 다음 회차에 다시 보냄');
    return '전화주문 나감 확인을 못 보냈습니다 — 다음 회차에 다시 보냅니다';
  }
}
