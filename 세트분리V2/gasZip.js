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
  if (!addr || !apiKey) return '';

  function tryAddr(q) {
    var u = 'https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(q);
    var r = UrlFetchApp.fetch(u, {
      headers: { Authorization: 'KakaoAK ' + apiKey },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return null;
    var j = JSON.parse(r.getContentText());
    if (j.documents && j.documents.length) {
      var d = j.documents[0];
      if (d.road_address && d.road_address.zone_no) return d.road_address.zone_no;
      if (d.address && d.address.zip_code) return d.address.zip_code;
    }
    return null;
  }

  try {
    var hit = tryAddr(addr);
    if (hit) return hit;

    var norm = addr;
    for (var i = 0; i < SSZ_ADDR_NORM.length; i++) norm = norm.replace(SSZ_ADDR_NORM[i][0], SSZ_ADDR_NORM[i][1]);
    if (norm !== addr) {
      hit = tryAddr(norm);
      if (hit) return hit;
    }

    var u2 = 'https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(addr);
    var r2 = UrlFetchApp.fetch(u2, {
      headers: { Authorization: 'KakaoAK ' + apiKey },
      muteHttpExceptions: true
    });
    if (r2.getResponseCode() === 200) {
      var j2 = JSON.parse(r2.getContentText());
      if (j2.documents && j2.documents.length && j2.documents[0].road_address_name) {
        return tryAddr(j2.documents[0].road_address_name) || '';
      }
    }
    return '';
  } catch (e) {
    Logger.log('[ZIP] ' + e.message);
    return '';
  }
}

/**
 * 「도서산간_주소사전」에서 우편번호가 빈 행을 카카오 API로 채운다.
 * 채운 우편번호가 도서산간 목록에 있으면 C열도 자동으로 Y 표시.
 * 이미 채워진 행은 건드리지 않는다 (사람이 확인한 값이 우선).
 *
 * @return {{tried:number, filled:number, island:number, failed:Array}}
 */
function ssz_fillDictionary(limit) {
  var apiKey = ssz_key();
  var out = { tried: 0, filled: 0, island: 0, failed: [], noKey: !apiKey };
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
    if (ssText(v[r][4]).indexOf('실패') >= 0) continue; // 이미 실패한 주소는 매번 재시도하지 않는다
    out.tried++;
    var zip = ssz_zipOf(addr, apiKey);
    Utilities.sleep(120); // 카카오 rate limit 보호
    if (!zip) { out.failed.push(addr); v[r][4] = '카카오 조회 실패 — 직접 입력하세요'; changed = true; continue; }
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

/** 사전에 우편번호가 빈 행(이전 실패 제외)이 남아 있나 */
function ssz_hasPending() {
  var body = ssio_body(SSIO_TABS.도서산간사전);
  for (var i = 0; i < body.length; i++) {
    if (ssText(body[i][0]) && !ssText(body[i][1]) && ssText(body[i][4]).indexOf('실패') < 0) return true;
  }
  return false;
}

/** 메뉴에서 직접 부를 때 */
function ss_우편번호채우기() {
  var r = ssz_fillDictionary();
  if (r.noKey) {
    return ssio_alert('카카오 API 키가 없습니다.\n\n메뉴 → 🔑 카카오 API 키 설정 에서 먼저 등록하세요.');
  }
  var msg = '우편번호 자동조회 완료\n\n' +
    '  · 빈 칸 : ' + r.tried + '건\n' +
    '  · 채움 : ' + r.filled + '건\n' +
    '  · 그중 도서산간 : ' + r.island + '건\n' +
    '  · 실패 : ' + r.failed.length + '건';
  if (r.failed.length) msg += '\n\n[실패 — 직접 입력 필요]\n  ' + r.failed.slice(0, 10).join('\n  ');
  if (r.filled) msg += '\n\n※ 「▶ 세트분리 실행」을 다시 눌러야 분류에 반영됩니다.';
  return ssio_alert(msg);
}
