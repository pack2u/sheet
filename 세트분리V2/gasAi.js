/**
 * ══════════════════════════════════════════════════════════════
 *  적요를 AI 에게 한 번 더 물어본다  —  2026-09-22
 *
 *  > "ai가 첨부되면 속도면에서는 마이너스인가?"   "그곳에서 조치도 가능한가?"
 *
 *  ★ 규칙이 주인이고 AI 는 «못 읽은 것»만 본다 ★
 *    ssParseAddrOverride 가 생김새로 읽는다. 그것이 배송지의 주인이다.
 *    AI 는 그 뒤에 남은 것만 보고 «제안»할 뿐, 아무것도 덮어쓰지 않는다.
 *
 *    왜 안 덮어쓰나 — 판매현황은 하루 두 번 통째로 다시 읽힌다. AI 는 같은 글에
 *    어제와 다른 답을 낼 수 있어서, 덮어쓰게 두면 주소가 회차마다 흔들린다.
 *    아침에 나간 송장과 어긋나는 것은 그런 식으로 생긴다.
 *
 *  ★ 세트분리를 한 톨도 늦추지 않는다 ★
 *    실행이 «끝난 뒤» 5초 뒤에 따로 깨어난다 (gasV2.js 와 같은 수법).
 *    여기서 실패해도 세트분리는 이미 끝나 있다.
 *    남은 적요는 하루 서너 건이고, 34건이라도 한 통에 묶어 한 번만 부른다.
 *
 *  ★ 사람이 누르는 자리 ★
 *    「적요확인」 탭에 적요 · 지금 값 · AI 가 읽은 것을 «나란히» 놓는다.
 *    AI 말만 보여 주면 판단할 근거가 없다. 조치는 보류 탭과 같은 얼개다.
 *
 *  끄려면 — 스크립트 속성  MEMO_AI = off
 * ══════════════════════════════════════════════════════════════
 */

var SS_AI_FN_ = 'ss_적요AI읽기';
var SS_AI_PROP_ = 'SS_AI_PENDING_RUNKEY';
var SS_AI_MODEL_ = 'gemini-3.6-flash';   // CS웹앱이 송장 사진에 쓰는 것과 같다
var SS_AI_MAX_ = 60;                     // 한 번에 물어볼 최대 건수

var SS_AI_HEADER = [
  '회차키', '고유ID', '순번', '거래처명', '적요',
  '지금 주소', '지금 전화',
  'AI 판단', 'AI 가게이름', 'AI 전화(F)', 'AI 휴대(G)', 'AI 주소', 'AI 까닭',
  '조치', '걷은때'
];

/** 조치 칸에 넣을 수 있는 말. 보류 탭과 같은 얼개다. */
var SS_AI_ACTIONS = ['', '이대로 적용', '미발송', '아님'];

/*  ★ 값은 함수 «안»에서 읽는다 ★
    GAS 는 파일을 이름 차례로 맨 위부터 돌린다. _secrets 가 아직 안 돌았으면
    파일 맨 위에서 읽은 값은 늘 빈 값이고, 그 뒤로 아무 소리 없이 안 간다. */
function _ss_ai_key_() {
  try { if (typeof GEMINI_API_KEY !== 'undefined' && GEMINI_API_KEY) return String(GEMINI_API_KEY); } catch (e) {}
  try {
    return String(PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '');
  } catch (e2) { return ''; }
}

function _ss_ai_켜짐_() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty('MEMO_AI') || '').toLowerCase() !== 'off';
  } catch (e) { return true; }
}

/**
 * 세트분리가 끝난 자리에서 부른다. 예약만 하고 곧장 돌아온다.
 * 절대 던지지 않는다 — 여기서 멈추면 다 끝난 실행이 실패로 보인다.
 */
function ss_적요AI_예약_(runKey) {
  try {
    if (!_ss_ai_켜짐_()) return '';
    if (!_ss_ai_key_()) return 'Gemini 키가 없어 안 물어봄';
    PropertiesService.getScriptProperties().setProperty(SS_AI_PROP_, String(runKey || ''));
    _ss_ai_트리거정리_();
    ScriptApp.newTrigger(SS_AI_FN_).timeBased().after(5 * 1000).create();
    return '예약됨 (5초 뒤)';
  } catch (e) {
    return '예약 실패 — ' + String(e && e.message ? e.message : e);
  }
}

/** 이 일을 위해 만든 1회용 트리거를 전부 지운다 */
function _ss_ai_트리거정리_() {
  var n = 0;
  try {
    var ts = ScriptApp.getProjectTriggers();
    for (var i = 0; i < ts.length; i++) {
      if (ts[i].getHandlerFunction() === SS_AI_FN_) { ScriptApp.deleteTrigger(ts[i]); n++; }
    }
  } catch (e) {}
  return n;
}

/* ══════════════════════════════════════════════════════════════
   깨어나서 하는 일
   ══════════════════════════════════════════════════════════════ */
function ss_적요AI읽기() {
  _ss_ai_트리거정리_();
  var runKey = '';
  try {
    runKey = String(PropertiesService.getScriptProperties().getProperty(SS_AI_PROP_) || '');
  } catch (e) {}

  try {
    var 물어볼것 = _ss_ai_남은적요_(runKey);
    if (!물어볼것.length) { Logger.log('[적요AI] 물어볼 것이 없습니다'); return; }
    if (물어볼것.length > SS_AI_MAX_) 물어볼것 = 물어볼것.slice(0, SS_AI_MAX_);

    var 답 = _ss_ai_물어보기_(물어볼것);
    if (!답) { Logger.log('[적요AI] 답을 못 받았습니다'); return; }

    var 적은줄 = _ss_ai_탭에쌓기_(물어볼것, 답);
    Logger.log('[적요AI] ' + runKey + ' — 물어본 것 ' + 물어볼것.length + ' · 적은 줄 ' + 적은줄);
  } catch (e) {
    //  곁다리다. 여기서 터져도 세트분리는 이미 끝나 있다.
    Logger.log('[적요AI] 실패: ' + String(e && e.message ? e.message : e));
  }
}

/**
 * 규칙이 «못 읽은» 적요만 모은다.
 * 이미 적요확인 탭에 올라간 고유ID 는 건너뛴다 — 조치를 적어 둔 줄을 지우면 안 된다.
 */
function _ss_ai_남은적요_(runKey) {
  var 나온것 = [];
  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!lg || lg.getLastRow() < 2) return 나온것;

  var cols = lg.getLastColumn();
  var head = lg.getRange(1, 1, 1, cols).getValues()[0];
  var li = {};
  for (var h = 0; h < head.length; h++) {
    var hn = ssText(head[h]);
    if (hn && li[hn] === undefined) li[hn] = h;
  }
  var 있어야 = ['회차키', '고유ID', '순번', '거래처명', '적요', '주소1', '모바일', '전화', '주문번호출처', '경로'];
  for (var n = 0; n < 있어야.length; n++) if (li[있어야[n]] === undefined) return 나온것;

  var 이미 = _ss_ai_탭에있는ID_();
  var v = lg.getRange(2, 1, lg.getLastRow() - 1, cols).getValues();
  var 본것 = {};
  for (var r = 0; r < v.length; r++) {
    if (runKey && ssText(v[r][li['회차키']]) !== runKey) continue;
    if (ssText(v[r][li['주문번호출처']]) !== '자동발급') continue;     // 전화주문만
    var uid = ssText(v[r][li['고유ID']]);
    if (!uid || 본것[uid] || 이미[uid]) continue;
    var memo = ssText(v[r][li['적요']]);
    if (!memo) continue;
    //  규칙이 이미 읽은 것은 안 묻는다 — 주인은 규칙이다
    if (ssParseAddrOverride(memo)) continue;
    본것[uid] = true;
    나온것.push({
      회차키: ssText(v[r][li['회차키']]),
      고유ID: uid,
      순번: ssText(v[r][li['순번']]),
      거래처명: ssText(v[r][li['거래처명']]),
      적요: memo,
      주소: ssText(v[r][li['주소1']]),
      전화: ssText(v[r][li['모바일']]) || ssText(v[r][li['전화']])
    });
  }
  return 나온것;
}

/** 적요확인 탭에 이미 올라간 고유ID */
function _ss_ai_탭에있는ID_() {
  var 표 = {};
  try {
    var sh = ssio_ss().getSheetByName(SSIO_TABS.적요확인);
    if (!sh || sh.getLastRow() < 2) return 표;
    var c = SS_AI_HEADER.indexOf('고유ID') + 1;
    var v = sh.getRange(2, c, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < v.length; i++) {
      var u = ssText(v[i][0]);
      if (u) 표[u] = true;
    }
  } catch (e) {}
  return 표;
}

/* ══════════════════════════════════════════════════════════════
   물어보기 — 한 통에 묶는다
   ══════════════════════════════════════════════════════════════ */
function _ss_ai_물어보기_(줄들) {
  var key = _ss_ai_key_();
  if (!key) return null;

  var 목록 = [];
  for (var i = 0; i < 줄들.length; i++) {
    목록.push('[' + i + '] ' + 줄들[i].적요.replace(/[\r\n]+/g, ' ⏎ '));
  }

  var prompt = [
    '팩투유(포장용기 도매)의 전화주문 「적요」를 읽는 일입니다.',
    '전화주문은 본사 계정으로 들어와 주소 칸에 본사 주소가 박혀 있습니다.',
    '실제로 물건이 갈 곳은 적요에 적혀 있을 때가 있습니다.',
    '',
    '적요마다 다음 중 하나로 판단하세요.',
    '  "배송지"  — 물건을 보낼 곳(주소)이 적혀 있다',
    '  "미발송"  — 이 주문은 안 나간다는 뜻이다',
    '              (이미 나갔다 · 손님이 가지러 온다 · 취소 · 누락 · 수거 등)',
    '  "아님"    — 배송지도 미발송도 아니다 (품목 이야기 · 품절 · 금액 · 요청사항)',
    '',
    '★ 조심할 것 ★',
    '- 「09/15 출고」처럼 «그날 내보내라»는 뜻은 미발송이 «아닙니다». 이미 나갔다는 말만 미발송입니다.',
    '- 품목명·규격·수량 목록은 전부 "아님" 입니다. 「BF 195파이 냉면」 같은 것은 주소가 아닙니다.',
    '- 금액(70700원)을 우편번호로 읽지 마세요.',
    '- 확실하지 않으면 "아님" 을 고르세요. 틀린 주소로 보내는 것이 안 보내는 것보다 나쁩니다.',
    '',
    '배송지일 때만 아래를 채웁니다. 없으면 빈 문자열로 두세요.',
    '  name   가게이름·지점명·받는 사람 (25자 이내)',
    '  tel    유선 전화 (02·031·044 등으로 시작). 하이픈 넣어 주세요',
    '  mobile 휴대 전화 (010 등으로 시작). 하이픈 넣어 주세요',
    '  addr   주소. 우편번호·가게이름은 빼고 «주소만»',
    '  why    왜 그렇게 봤는지 한 줄 (20자 이내)',
    '',
    'JSON 배열만 답하세요. 설명·머리말·코드펜스 없이 배열 하나만.',
    '[{"i":0,"kind":"배송지","name":"","tel":"","mobile":"","addr":"","why":""}]',
    '',
    '── 적요 ──',
    목록.join('\n')
  ].join('\n');

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    SS_AI_MODEL_ + ':generateContent?key=' + encodeURIComponent(key);
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    })
  });

  var code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('[적요AI] HTTP ' + code + ' — ' + res.getContentText().slice(0, 300));
    return null;
  }

  var 글 = '';
  try {
    var j = JSON.parse(res.getContentText());
    글 = j.candidates[0].content.parts[0].text;
  } catch (e) {
    Logger.log('[적요AI] 답을 못 풀었습니다: ' + String(e));
    return null;
  }

  //  코드펜스를 씌워 보내는 일이 있다 — 벗겨 낸다
  글 = String(글).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    var arr = JSON.parse(글);
    return Array.isArray(arr) ? arr : null;
  } catch (e2) {
    Logger.log('[적요AI] JSON 이 아닙니다: ' + 글.slice(0, 200));
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   적요확인 탭에 쌓는다 — 덮어쓰지 않는다 (조치를 적어 둔 줄이 있다)
   ══════════════════════════════════════════════════════════════ */
function _ss_ai_탭에쌓기_(줄들, 답) {
  var 답표 = {};
  for (var a = 0; a < 답.length; a++) {
    var i = Number(답[a] && 답[a].i);
    if (i >= 0 && i < 줄들.length) 답표[i] = 답[a];
  }

  var rows = [];
  for (var k = 0; k < 줄들.length; k++) {
    var L = 줄들[k], r = 답표[k] || {};
    var 판단 = ssText(r.kind) || '아님';
    rows.push([
      L.회차키, L.고유ID, L.순번, L.거래처명, L.적요,
      L.주소, L.전화,
      판단, ssText(r.name), ssText(r.tel), ssText(r.mobile), ssText(r.addr), ssText(r.why),
      '', ''
    ]);
  }
  if (!rows.length) return 0;

  var sh = ssio_sheet(SSIO_TABS.적요확인, SS_AI_HEADER);
  var 끝 = Math.max(sh.getLastRow(), 1);
  if (sh.getMaxRows() < 끝 + rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 20);
  sh.getRange(끝 + 1, 1, rows.length, SS_AI_HEADER.length).setValues(rows);

  //  조치 칸에 고르개를 단다 — 손으로 적으면 오타가 난다
  try {
    var c조치 = SS_AI_HEADER.indexOf('조치') + 1;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(SS_AI_ACTIONS, true).setAllowInvalid(false).build();
    sh.getRange(끝 + 1, c조치, rows.length, 1).setDataValidation(rule);
  } catch (e) {}

  return rows.length;
}

/* ══════════════════════════════════════════════════════════════
   조치 걷기 — 세트분리가 «시작할 때» 부른다
   보류 탭(ssm_captureManual)과 같은 얼개다.
   ══════════════════════════════════════════════════════════════ */
function ssm_captureMemoActions() {
  var 표 = {};
  try {
    var sh = ssio_ss().getSheetByName(SSIO_TABS.적요확인);
    if (!sh || sh.getLastRow() < 2) return 표;

    var v = sh.getRange(2, 1, sh.getLastRow() - 1, SS_AI_HEADER.length).getValues();
    var c = {};
    for (var h = 0; h < SS_AI_HEADER.length; h++) c[SS_AI_HEADER[h]] = h;

    var 때 = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM-dd HH:mm');
    var 걷은줄 = [];
    for (var i = 0; i < v.length; i++) {
      var 조치 = ssText(v[i][c['조치']]);
      if (!조치) continue;
      var uid = ssText(v[i][c['고유ID']]);
      if (!uid) continue;
      표[uid] = {
        조치: 조치,
        이름: ssText(v[i][c['AI 가게이름']]),
        전화: ssText(v[i][c['AI 전화(F)']]),
        휴대: ssText(v[i][c['AI 휴대(G)']]),
        주소: ssText(v[i][c['AI 주소']])
      };
      if (!ssText(v[i][c['걷은때']])) 걷은줄.push(i + 2);
    }

    /*  «걷은때»를 적어 둔다. 언제부터 먹었는지 사람이 알아야 하고,
        이 표시가 있어야 「적었는데 왜 안 되지」를 가릴 수 있다. */
    var c때 = c['걷은때'] + 1;
    for (var g = 0; g < 걷은줄.length; g++) sh.getRange(걷은줄[g], c때).setValue(때);
  } catch (e) {
    //  곁다리다. 못 걷어도 세트분리는 돌아야 한다.
    Logger.log('[적요AI] 조치 걷기 실패(건너뜀): ' + String(e && e.message ? e.message : e));
    return {};
  }
  return 표;
}
