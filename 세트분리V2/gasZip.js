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
 * 주소 → 우편번호 5자리. 못 찾으면 "".
 * 1차 주소검색 → 2차 행정구역명 정규화 후 재시도 → 3차 키워드검색으로 도로명 얻어 재시도
 */
function ssz_zipOf(address, apiKey) {
  var addr = ssText(address);
  if (!addr) return { zip: '', err: '주소가 비어 있음' };
  if (!apiKey) return { zip: '', err: 'API 키 없음' };
  var lastErr = '';

  function tryAddr(q) {
    var r;
    try {
      r = UrlFetchApp.fetch(
        'https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(q),
        { headers: { Authorization: 'KakaoAK ' + apiKey }, muteHttpExceptions: true });
    } catch (ex) {
      // 권한 부족(script.external_request)이면 여기로 온다. 절대 삼키지 않는다.
      lastErr = '외부요청 불가: ' + ex.message;
      return null;
    }
    var code = r.getResponseCode();
    if (code !== 200) {
      lastErr = 'HTTP ' + code + ' ' + r.getContentText().slice(0, 80);
      return null;
    }
    var j;
    try { j = JSON.parse(r.getContentText()); }
    catch (ex2) { lastErr = '응답 파싱 실패'; return null; }
    if (j.documents && j.documents.length) {
      var d = j.documents[0];
      if (d.road_address && d.road_address.zone_no) return d.road_address.zone_no;
      if (d.address && d.address.zip_code) return d.address.zip_code;
      lastErr = '우편번호 없는 결과';
      return null;
    }
    lastErr = '검색 결과 없음';
    return null;
  }

  var hit = tryAddr(addr);
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
  var base = ssText(addr).replace(/([^)]*)/g, ' ').replace(/s+/g, ' ').trim();
  function add(s) {
    s = ssText(s);
    if (s && s !== addr && !seen[s]) { seen[s] = true; out.push(s); }
  }
  add(base);

  // 도로명 + 건물번호까지만  (…로/길 12 또는 12-3)
  var road = base.match(/^(.*?(?:로|길)s*[0-9]+(?:-[0-9]+)?)(?:s|$)/);
  if (road) add(road[1]);

  // 지번형  (…동/리 123 또는 123-4)
  var jibun = base.match(/^(.*?(?:동|리|가)s*[0-9]+(?:-[0-9]+)?)(?:s|$)/);
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
  for (var r = 0; r < v.length && out.tried < cap; r++) {
    var addr = ssText(v[r][0]);
    if (!addr || ssText(v[r][1])) continue;
    if (!retryFailed && ssz_isPermanentFail(v[r][4])) continue; // 주소 자체 문제만 건너뛴다
    out.tried++;
    var got = ssz_zipOf(addr, apiKey);
    Utilities.sleep(120); // 카카오 rate limit 보호
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

/** 사전에 조회 대기 중인 행이 남아 있나 (영구 실패는 제외) */
function ssz_hasPending() {
  return ssz_pendingCount() > 0;
}

/** 대기 건수와 영구 실패 건수 */
function ssz_pendingCount() {
  var body = ssio_body(SSIO_TABS.도서산간사전);
  var n = 0;
  for (var i = 0; i < body.length; i++) {
    if (!ssText(body[i][0]) || ssText(body[i][1])) continue;
    if (ssz_isPermanentFail(body[i][4])) continue;
    n++;
  }
  return n;
}

function ssz_permanentCount() {
  var body = ssio_body(SSIO_TABS.도서산간사전);
  var n = 0;
  for (var i = 0; i < body.length; i++) {
    if (ssText(body[i][0]) && !ssText(body[i][1]) && ssz_isPermanentFail(body[i][4])) n++;
  }
  return n;
}

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
