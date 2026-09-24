/**
 * gasZip.js — 카카오 로컬 API로 주소 → 우편번호 자동 조회
 *
 * 도서산간 판정의 2단계(우편번호 확인)를 사람 손에서 떼어낸다.
 * 구현은 상품정보 시스템의 `_partnerExclusivePush.gs` 에 이미 있던 것을 그대로 옮겼다
 * (도로명 → 특별자치도 정규화 → 키워드 검색 3단 폴백).
 *
 * API 키는 코드에 두지 않는다. 「🔑 카카오 API 키 설정」 메뉴로 한 번 넣으면
 * 이 스크립트의 Script Properties 에 저장된다.
 * 상품정보 프로젝트에서 쓰던 키를 그대로 써도 된다.
 */

var SSZ_KEY_PROP = 'KAKAO_REST_API_KEY';

/** 신규 행정구역명은 카카오가 못 찾는 경우가 있어 구형명으로 한 번 더 시도한다 */
var SSZ_ADDR_NORM = [
  [/강원특별자치도/g, '강원도'],
  [/전북특별자치도/g, '전라북도'],
  [/전남특별자치도/g, '전라남도'],
  [/경북특별자치도/g, '경상북도'],
  [/충북특별자치도/g, '충청북도'],
  [/제주특별자치도/g, '제주도'],
  [/세종특별자치시/g, '세종시']
];

function ssz_key() {
  try { return PropertiesService.getScriptProperties().getProperty(SSZ_KEY_PROP) || ''; }
  catch (e) { return ''; }
}

function ss_카카오키설정() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { return ssio_alert('UI 없이는 키를 설정할 수 없습니다.'); }
  var cur = ssz_key();
  var resp = ui.prompt('🔑 카카오 REST API 키 설정',
    '현재: ' + (cur ? cur.substring(0, 8) + '…' : '(미설정)') +
    '\n\n카카오 Developers → 내 애플리케이션 → 앱 키 → REST API 키\n' +
    '상품정보 프로젝트에서 쓰던 키를 그대로 넣어도 됩니다.',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var key = resp.getResponseText().trim();
  if (!key) return ui.alert('키가 비어 있습니다.');
  PropertiesService.getScriptProperties().setProperty(SSZ_KEY_PROP, key);
  return ui.alert('저장했습니다: ' + key.substring(0, 8) + '…');
}

/**
 * 카카오 주소검색 응답 한 개를 읽는다.
 *
 * 한 개씩 부르는 길(ssz_zipOf)과 묶어 부르는 길(ssz_zipBatch_)이 결과를
 * «같은 눈»으로 읽어야 한다. 따로 적어 두면 한쪽만 고치는 일이 생긴다.
 *
 * @return {{zip:string, err:string}}
 */
function ssz_readZip_(r) {
  var code;
  try { code = r.getResponseCode(); }
  catch (e) { return { zip: '', err: '응답 없음' }; }
  if (code !== 200) {
    return { zip: '', err: 'HTTP ' + code + ' ' + String(r.getContentText()).slice(0, 80) };
  }
  var j;
  try { j = JSON.parse(r.getContentText()); }
  catch (e2) { return { zip: '', err: '응답 파싱 실패' }; }
  if (j.documents && j.documents.length) {
    var d = j.documents[0];
    if (d.road_address && d.road_address.zone_no) return { zip: d.road_address.zone_no, err: '' };
    if (d.address && d.address.zip_code) return { zip: d.address.zip_code, err: '' };
    return { zip: '', err: '우편번호 없는 결과' };
  }
  return { zip: '', err: '검색 결과 없음' };
}

/** 카카오 주소검색 요청 하나 만들기 */
function ssz_addrReq_(q, apiKey) {
  return {
    url: 'https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(q),
    headers: { Authorization: 'KakaoAK ' + apiKey },
    muteHttpExceptions: true
  };
}

/**
 * ══════════════════════════════════════════════════════════════
 *  주소 여럿을 «한꺼번에» 묻는다
 *  2026-09-16
 *
 *  > "세트분리 속도 개선해주고"
 *
 *  ★ 여기가 제일 오래 걸리던 곳이다 ★
 *    ssz_fillDictionary 는 새 주소를 한 개씩 물어보고 그때마다 120밀리초를
 *    쉬었다. 한 회차에 최대 300개를 보므로, 쉬는 시간만 36초다. 게다가
 *    카카오 왕복이 한 번에 0.2~0.3초라 그것만으로 1분이 더 든다.
 *    새 주소가 많은 날은 이 한 군데서 1~2분을 썼다.
 *
 *  ★ fetchAll 은 한 번에 나란히 간다 ★
 *    구글이 주는 묶음 호출이다. 서른 개를 나란히 보내면 왕복 한 번 값으로
 *    끝난다. 쉬는 것도 «묶음 사이»에만 짧게 둔다.
 *
 *  ★ 첫판만 묶는다 ★
 *    대부분은 첫 질문에서 맞는다. 못 맞힌 것만 예전 길(정규화 → 도로명만
 *    → 키워드검색)로 하나씩 더 물어본다. 그 길은 앞 답에 따라 다음 질문이
 *    달라져서 묶을 수가 없다.
 * ══════════════════════════════════════════════════════════════
 */
function ssz_zipBatch_(addrs, apiKey, 묶음크기) {
  var out = {};
  if (!addrs || !addrs.length || !apiKey) return out;
  var N = 묶음크기 > 0 ? 묶음크기 : 30;
  for (var i = 0; i < addrs.length; i += N) {
    var part = addrs.slice(i, i + N);
    var reqs = [];
    for (var q = 0; q < part.length; q++) reqs.push(ssz_addrReq_(part[q], apiKey));
    var res;
    try {
      res = UrlFetchApp.fetchAll(reqs);
    } catch (ex) {
      /*  권한(script.external_request)이 없으면 여기로 온다. 남은 것을 더
          두드려도 같은 결과다 — 남김없이 사유를 적고 멈춘다. */
      for (var e = i; e < addrs.length; e++) {
        out[addrs[e]] = { zip: '', err: '외부요청 불가: ' + ex.message };
      }
      return out;
    }
    for (var j = 0; j < part.length; j++) out[part[j]] = ssz_readZip_(res[j]);
    //  묶음과 묶음 사이에만 잠깐 쉰다 (카카오 rate limit 예의)
    if (i + N < addrs.length) Utilities.sleep(80);
  }
  return out;
}

/**
 * 주소 → 우편번호 5자리. 못 찾으면 "".
 * 1차 주소검색 → 2차 행정구역명 정규화 후 재시도 → 3차 키워드검색으로 도로명 얻어 재시도
 *
 * @param 첫판 묶음 조회(ssz_zipBatch_)가 이미 해 본 «1차»의 결과.
 *             주면 같은 질문을 다시 하지 않는다. 없으면 여기서 한다.
 */
function ssz_zipOf(address, apiKey, 첫판) {
  var addr = ssText(address);
  if (!addr) return { zip: '', err: '주소가 비어 있음' };
  if (!apiKey) return { zip: '', err: 'API 키 없음' };
  var lastErr = '';

  function tryAddr(q) {
    var r;
    try {
      r = UrlFetchApp.fetch(ssz_addrReq_(q, apiKey).url,
        { headers: { Authorization: 'KakaoAK ' + apiKey }, muteHttpExceptions: true });
    } catch (ex) {
      // 권한 부족(script.external_request)이면 여기로 온다. 절대 삼키지 않는다.
      lastErr = '외부요청 불가: ' + ex.message;
      return null;
    }
    var got = ssz_readZip_(r);
    if (got.zip) return got.zip;
    lastErr = got.err;
    return null;
  }

  /*  묶음 조회가 이미 물어본 답이 있으면 그대로 쓴다 (2026-09-16).
      같은 질문을 두 번 하면 묶어 부른 보람이 없다. */
  var hit = null;
  if (첫판 && typeof 첫판 === 'object') {
    if (첫판.zip) return { zip: 첫판.zip, err: '' };
    lastErr = ssText(첫판.err);
  } else {
    hit = tryAddr(addr);
  }
  if (hit) return { zip: hit, err: '' };
  if (lastErr.indexOf('외부요청 불가') === 0 || lastErr.indexOf('HTTP 401') === 0 || lastErr.indexOf('HTTP 403') === 0) {
    return { zip: '', err: lastErr };   // 키·권한 문제면 더 시도해도 소용없다
  }

  var norm = addr;
  for (var i = 0; i < SSZ_ADDR_NORM.length; i++) norm = norm.replace(SSZ_ADDR_NORM[i][0], SSZ_ADDR_NORM[i][1]);
  if (norm !== addr) {
    hit = tryAddr(norm);
    if (hit) return { zip: hit, err: '' };
  }

  // 상세주소를 떼고 도로명 본체만 남겨 다시 시도한다.
  //   "경기도 안산시 단원구 중앙대로 473 101 ( 원곡동 )" → "경기도 안산시 단원구 중앙대로 473"
  // 우편번호는 건물 단위라 호수·층·상호를 떼도 값이 달라지지 않는다.
  var cands = ssz_addrCandidates(norm);
  for (var ci = 0; ci < cands.length; ci++) {
    hit = tryAddr(cands[ci]);
    if (hit) return { zip: hit, err: '' };
  }

  try {
    var r2 = UrlFetchApp.fetch(
      'https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(addr),
      { headers: { Authorization: 'KakaoAK ' + apiKey }, muteHttpExceptions: true });
    if (r2.getResponseCode() === 200) {
      var j2 = JSON.parse(r2.getContentText());
      if (j2.documents && j2.documents.length && j2.documents[0].road_address_name) {
        hit = tryAddr(j2.documents[0].road_address_name);
        if (hit) return { zip: hit, err: '' };
      }
    }
  } catch (ex3) { lastErr = '외부요청 불가: ' + ex3.message; }

  return { zip: '', err: lastErr || '찾지 못함' };
}

/**
 * 주소에서 조회에 쓸 후보를 만든다.
 * 뒤쪽 상세(호수·층·상호·괄호 지번)를 단계적으로 떼어 낸다.
 */
function ssz_addrCandidates(addr) {
  var out = [], seen = {};
  var base = ssText(addr).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  function add(s) {
    s = ssText(s);
    if (s && s !== addr && !seen[s]) { seen[s] = true; out.push(s); }
  }
  add(base);

  // 도로명 + 건물번호까지만  (…로/길 12 또는 12-3)
  var road = base.match(/^(.*?(?:로|길)\s*[0-9]+(?:-[0-9]+)?)(?:\s|$)/);
  if (road) add(road[1]);

  // 지번형  (…동/리 123 또는 123-4)
  var jibun = base.match(/^(.*?(?:동|리|가)\s*[0-9]+(?:-[0-9]+)?)(?:\s|$)/);
  if (jibun) add(jibun[1]);

  return out;
}

/**
 * 「도서산간_주소사전」에서 우편번호가 빈 행을 카카오 API로 채운다.
 * 채운 우편번호가 도서산간 목록에 있으면 C열도 자동으로 Y 표시.
 * 이미 채워진 행은 건드리지 않는다 (사람이 확인한 값이 우선).
 *
 * @return {{tried:number, filled:number, island:number, failed:Array}}
 */
function ssz_fillDictionary(limit, retryFailed) {
  var apiKey = ssz_key();
  var out = { tried: 0, filled: 0, island: 0, failed: [], reasons: {}, noKey: !apiKey, stopped: '' };
  if (!apiKey) return out;

  var sh = ssio_sheet(SSIO_TABS.도서산간사전, SSM_ISL_DICT_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return out;

  var zips = {};
  var zl = ssio_body(SSIO_TABS.도서산간우편);
  for (var i = 0; i < zl.length; i++) {
    var zc = ssText(zl[i][0]);
    if (zc) zips[zc] = ssText(zl[i][1]) || '도서';
  }

  var rng = sh.getRange(2, 1, last - 1, SSM_ISL_DICT_HEADER.length);
  var v = rng.getValues();
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var changed = false;

  var cap = limit > 0 ? limit : 300;

  /*  ★ 물어볼 것을 먼저 «모은다» ★  (2026-09-16)
      > "세트분리 속도 개선해주고"

      예전에는 한 줄씩 카카오에 묻고 그때마다 120밀리초를 쉬었다. 최대 300건이라
      쉬는 시간만 36초, 왕복까지 합치면 1~2분을 이 한 군데서 썼다.
      이제 물어볼 주소를 먼저 다 모아 fetchAll 로 «나란히» 보낸다. */
  var 볼자리 = [], 볼주소 = [];
  for (var r0 = 0; r0 < v.length && 볼자리.length < cap; r0++) {
    var a0 = ssText(v[r0][0]);
    if (!a0 || ssText(v[r0][1])) continue;
    if (!retryFailed && ssz_isPermanentFail(v[r0][4])) continue; // 주소 자체 문제만 건너뛴다
    볼자리.push(r0);
    볼주소.push(a0);
  }
  if (!볼자리.length) return out;

  //  첫판은 한꺼번에. 대부분 여기서 맞는다.
  var 첫판 = ssz_zipBatch_(볼주소, apiKey);

  for (var k = 0; k < 볼자리.length; k++) {
    var r = 볼자리[k];
    var addr = 볼주소[k];
    out.tried++;

    /*  못 맞힌 것만 예전 길로 하나씩 더 물어본다
        (정규화 → 도로명 본체 → 키워드검색). 앞 답에 따라 다음 질문이
        달라져서 묶을 수가 없다. 쉬는 것도 여기서만 한다. */
    var 첫 = 첫판[addr];
    var got;
    if (첫 && 첫.zip) {
      got = 첫;
    } else {
      got = ssz_zipOf(addr, apiKey, 첫);
      Utilities.sleep(120); // 카카오 rate limit 보호 — 되짚는 줄만
    }

    var zip = got.zip;
    if (!zip) {
      out.failed.push(addr);
      out.reasons[got.err] = (out.reasons[got.err] || 0) + 1;
      v[r][4] = '조회 실패: ' + got.err;
      changed = true;
      // 키·권한 문제면 나머지를 두드려 봐야 소용없다. 즉시 멈춘다.
      if (got.err.indexOf('외부요청 불가') === 0 || got.err.indexOf('HTTP 401') === 0 || got.err.indexOf('HTTP 403') === 0) {
        out.stopped = got.err;
        break;
      }
      continue;
    }
    v[r][1] = zip;
    v[r][2] = zips[zip] || '';
    v[r][3] = v[r][3] || today;
    v[r][4] = '카카오 자동조회';
    changed = true;
    out.filled++;
    if (zips[zip]) out.island++;
  }
  if (changed) rng.setValues(v);
  return out;
}

/**
 * 실패를 두 종류로 나눈다.
 *   영구 — 그 주소 자체의 문제(검색 결과 없음). 다시 불러도 같다.
 *   일시 — 키·권한·네트워크. 고치면 되는 것이므로 다음 실행에서 자동 재시도한다.
 * 이 구분이 없으면 권한 한 번 잘못됐을 때 사전 전체가 영구히 막힌다.
 */
function ssz_isPermanentFail(memo) {
  var s = ssText(memo);
  if (s.indexOf('조회 실패') < 0 && s.indexOf('실패') < 0) return false;
  return s.indexOf('검색 결과 없음') >= 0 || s.indexOf('우편번호 없는 결과') >= 0 || s.indexOf('주소가 비어 있음') >= 0;
}

/**
 * 오늘 아직 「실패분 재시도」를 안 했으면 true 를 돌려주고 표시해 둔다.
 * 주소 정규화 규칙이 나아지면 어제 못 찾던 주소가 오늘 풀릴 수 있다.
 * 그렇다고 매 실행 다시 두드리면 낭비라 하루 한 번으로 잡는다.
 */
function ssz_shouldRetryToday() {
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  try {
    var p = PropertiesService.getScriptProperties();
    if (p.getProperty('ZIP_RETRY_DATE') === today) return false;
    p.setProperty('ZIP_RETRY_DATE', today);
    return true;
  } catch (e) { return false; }
}

/** 사전에 조회 대기 중인 행이 남아 있나 (영구 실패는 제외) */
/**
 * ★ 사전을 한 번만 읽는다 ★  (2026-09-16 — 속도)
 *
 * 대기 건수와 영구 실패 건수를 따로 세느라 같은 탭을 두 번 읽고 있었다.
 * 사전은 영구 캐시라 날마다 길어진다 — 읽는 값이 싸지 않다.
 * 한 번 읽어 둘 다 센다.
 *
 * @return {{대기:number, 영구:number}}
 */
function ssz_dictCounts() {
  var body = ssio_body(SSIO_TABS.도서산간사전);
  var 대기 = 0, 영구 = 0;
  for (var i = 0; i < body.length; i++) {
    if (!ssText(body[i][0])) continue;      // 주소 없는 줄
    if (ssText(body[i][1])) continue;       // 이미 채워진 줄
    if (ssz_isPermanentFail(body[i][4])) 영구++;
    else 대기++;
  }
  return { 대기: 대기, 영구: 영구 };
}

/** 사전에 조회 대기 중인 행이 남아 있나 (영구 실패는 제외) */
function ssz_hasPending() { return ssz_dictCounts().대기 > 0; }

/** 대기 건수 */
function ssz_pendingCount() { return ssz_dictCounts().대기; }

/** 영구 실패 건수 */
function ssz_permanentCount() { return ssz_dictCounts().영구; }

/** 메뉴에서 직접 부를 때 */
function ss_우편번호채우기() {
  var r = ssz_fillDictionary(2000, true);   // 메뉴로 부르면 이전 실패분까지 다시 시도한다
  if (r.noKey) {
    return ssio_alert('카카오 API 키가 없습니다.\n\n메뉴 → 🔑 카카오 API 키 설정 에서 먼저 등록하세요.');
  }
  var msg = '우편번호 자동조회 완료\n\n' +
    '  · 빈 칸 : ' + r.tried + '건\n' +
    '  · 채움 : ' + r.filled + '건\n' +
    '  · 그중 도서산간 : ' + r.island + '건\n' +
    '  · 실패 : ' + r.failed.length + '건';
  if (r.stopped) msg += '\n\n⚠ ' + r.stopped + '\n키·권한 문제라 나머지를 건너뛰었습니다.';
  var rs = [];
  for (var k in r.reasons) if (Object.prototype.hasOwnProperty.call(r.reasons, k)) rs.push(k + ' × ' + r.reasons[k]);
  if (rs.length) msg += '\n\n[실패 사유]\n  ' + rs.join('\n  ');
  if (r.filled) msg += '\n\n※ 「▶ 세트분리 실행」을 다시 눌러야 분류에 반영됩니다.';
  return ssio_alert(msg);
}

/* ── 진단 ─────────────────────────────────────────────── */

/**
 * 카카오 호출이 왜 안 되는지 한 번에 알려준다.
 * 권한 / 키 / 응답을 각각 따로 확인해 어느 단계에서 막혔는지 짚는다.
 */
function ss_카카오진단() {
  var L = [];
  var key = ssz_key();
  L.push('1) API 키 : ' + (key ? key.substring(0, 8) + '… (' + key.length + '자)' : '미설정  ← 🔑 메뉴에서 등록하세요'));

  L.push('2) 스크립트 권한 :');
  try {
    var t = ScriptApp.getOAuthToken();
    L.push('     OAuth 토큰 발급 ' + (t ? 'OK' : '실패'));
  } catch (e) {
    L.push('     토큰 실패 — ' + e.message);
  }

  L.push('3) 외부 요청 테스트 (google.com) :');
  try {
    var r0 = UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
    L.push('     HTTP ' + r0.getResponseCode() + '  → UrlFetchApp 사용 가능');
  } catch (e0) {
    L.push('     막힘 — ' + e0.message);
    L.push('');
    L.push('※ 외부 요청 권한이 없습니다.');
    L.push('   Apps Script 편집기에서 아무 함수나 한 번 실행해 권한을 다시 승인하세요.');
    L.push('   (새 권한 「외부 서비스에 연결」이 추가되었습니다)');
    return ssio_alert('카카오 진단\n\n' + L.join('\n'));
  }

  if (!key) return ssio_alert('카카오 진단\n\n' + L.join('\n'));

  var addr = '제주특별자치도 제주시 노형14길 12';
  L.push('4) 카카오 주소검색 : ' + addr);
  try {
    var r = UrlFetchApp.fetch(
      'https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(addr),
      { headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true });
    var code = r.getResponseCode();
    var body = r.getContentText();
    L.push('     HTTP ' + code);
    if (code === 200) {
      var j = JSON.parse(body);
      var n = (j.documents || []).length;
      L.push('     결과 ' + n + '건');
      if (n) {
        var d = j.documents[0];
        L.push('     우편번호 : ' + ((d.road_address && d.road_address.zone_no) || '(없음)'));
        L.push('');
        L.push('정상입니다. 「📮 우편번호 자동조회」를 실행하세요.');
      } else {
        L.push('     ← 키는 살아 있는데 이 주소를 못 찾음');
      }
    } else {
      L.push('     응답 : ' + body.slice(0, 200));
      L.push('');
      if (code === 401) L.push('※ 401 = 키가 틀렸거나 만료. 카카오 Developers에서 REST API 키를 다시 확인하세요.');
      else if (code === 403) L.push('※ 403 = 키는 맞지만 이 앱에 로컬 API 권한이 없거나 도메인/IP 제한이 걸려 있습니다.');
      else if (code === 429) L.push('※ 429 = 호출 한도 초과. 잠시 후 다시 시도하세요.');
    }
  } catch (e2) {
    L.push('     예외 — ' + e2.message);
  }
  return ssio_alert('카카오 진단\n\n' + L.join('\n'));
}
