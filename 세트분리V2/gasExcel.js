/**
 * gasExcel.js — 사방넷 송장대량등록 엑셀을 이 시트에서 바로 저장한다.
 *
 * 허브(상품정보) 메뉴와 같은 형식을 쓴다:
 *   A 주문번호 · B 송장번호 · C·D 공란 · E 택배사코드
 * 파일도 같은 이름 규칙(사방넷_송장대량등록_yyyyMMdd_HHmmss.xlsx)으로
 * 이 스프레드시트가 있는 폴더 아래 「사방넷_송장대량등록」 폴더에 쌓인다.
 *
 * 원천은 「사방넷등록」 탭 — 🔁 송장 전파가 만든 (주문번호·운송장·택배사) 세 열이다.
 * 전파를 먼저 돌리지 않으면 저장할 것이 없다.
 */

var SSX_BULK_HEADERS = ['주문번호', '송장번호', '', '', '택배사코드'];

/** 탭이 없거나 비어 있을 때의 폴백 — 운영 기준은 상품정보 「업체_택배사」 탭이다 */
var SSX_CARRIER_CODE_FALLBACK = {
  'CJ대한통운': '001',
  '롯데택배': '002',
  '로젠택배': '007',
  '대신택배': '037'
};

/**
 * 택배사명 → 사방넷 코드.
 * 상품정보 「업체_택배사」 탭(C=택배사, D=코드)을 읽고, 없으면 폴백 상수를 쓴다.
 * 허브 `_pep_loadVendorCarrierTable_` 과 같은 표를 보므로 기준이 갈리지 않는다.
 */
function ssx_carrierCodes() {
  var map = {};
  for (var k in SSX_CARRIER_CODE_FALLBACK) {
    if (Object.prototype.hasOwnProperty.call(SSX_CARRIER_CODE_FALLBACK, k)) {
      map[k] = SSX_CARRIER_CODE_FALLBACK[k];
    }
  }
  try {
    var cfg = ssio_config();
    var tab = SpreadsheetApp.openById(cfg['이카운트시트ID']).getSheetByName('업체_택배사');
    if (tab && tab.getLastRow() >= 2) {
      var v = tab.getRange(2, 1, tab.getLastRow() - 1, 4).getDisplayValues();
      for (var i = 0; i < v.length; i++) {
        var carrier = ssText(v[i][2]);
        var code = ssText(v[i][3]);
        if (carrier && code) map[carrier] = code;
      }
    }
  } catch (e) {
    Logger.log('[SSX] 업체_택배사 탭을 못 읽어 폴백 코드 사용: ' + e.message);
  }
  return map;
}

function ss_사방넷엑셀저장() {
  var NL = String.fromCharCode(10);
  var reg = ssio_ss().getSheetByName(SSIO_TABS.사방넷등록);
  if (!reg || reg.getLastRow() < 2) {
    return ssio_alert('「사방넷등록」 탭이 비어 있습니다.' + NL + NL +
      '순서: 🔁 송장 전파 → 이 메뉴  (롯데 송장탭·임시기록은 자동으로 읽습니다)');
  }

  var codes = ssx_carrierCodes();
  var v = reg.getRange(2, 1, reg.getLastRow() - 1, SS_REG_HEADER.length).getDisplayValues();
  var rows = [], byCode = {}, noCode = {}, skipNoCode = 0;
  for (var i = 0; i < v.length; i++) {
    var uid = ssText(v[i][0]);
    var inv = ssText(v[i][1]);
    if (!uid || !inv) continue;
    var carrier = ssText(v[i][2]) || '롯데택배';
    var code = codes[carrier] || '';
    if (!code) {
      skipNoCode++;
      noCode[carrier] = (noCode[carrier] || 0) + 1;
      continue;
    }
    rows.push([uid, inv, '', '', code]);
    byCode[code] = (byCode[code] || 0) + 1;
  }
  if (!rows.length) {
    return ssio_alert('저장할 행이 없습니다. 「사방넷등록」에 운송장번호가 채워져 있는지 확인하세요.');
  }

  // 임시 스프레드시트에 그려서 xlsx 로 내보낸다 (허브와 같은 방식)
  var ymd = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss');
  var fileName = '사방넷_송장대량등록_' + ymd + '.xlsx';
  var tmp = SpreadsheetApp.create('tmp_sabang_bulk_' + ymd);
  var dest = tmp.getSheets()[0];
  dest.setName('사방넷_송장대량등록');
  var all = [SSX_BULK_HEADERS].concat(rows);
  dest.getRange(1, 1, all.length, 5).setNumberFormat('@');
  dest.getRange(1, 1, all.length, 5).setValues(all);
  dest.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1f4e78').setFontColor('white');
  SpreadsheetApp.flush();

  var blob = null, err = '';
  try {
    var resp = UrlFetchApp.fetch(
      'https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200 && resp.getBlob().getBytes().length > 64) {
      blob = resp.getBlob().setName(fileName).setContentType(MimeType.MICROSOFT_EXCEL);
    } else {
      err = 'HTTP ' + resp.getResponseCode();
    }
  } catch (e2) { err = e2.message; }

  var fileUrl = '';
  if (blob) {
    var parent = null;
    try {
      var parents = DriveApp.getFileById(ssio_ss().getId()).getParents();
      if (parents.hasNext()) parent = parents.next();
    } catch (e3) {}
    if (!parent) parent = DriveApp.getRootFolder();
    var it = parent.getFoldersByName('사방넷_송장대량등록');
    var folder = it.hasNext() ? it.next() : parent.createFolder('사방넷_송장대량등록');
    var file = folder.createFile(blob);
    fileUrl = file.getUrl();
    try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e4) {}
  }

  var codeLines = [];
  for (var c in byCode) if (Object.prototype.hasOwnProperty.call(byCode, c)) {
    codeLines.push('    코드 ' + c + ' : ' + byCode[c] + '건');
  }
  var msg = '사방넷 대량등록 엑셀 저장' + NL + NL +
    '  · 저장 행 : ' + rows.length + '건' + NL + codeLines.join(NL);
  if (skipNoCode) {
    var ncl = [];
    for (var nc in noCode) if (Object.prototype.hasOwnProperty.call(noCode, nc)) {
      ncl.push(nc + ' ' + noCode[nc] + '건');
    }
    msg += NL + '  · 택배사코드 미지정 제외 : ' + skipNoCode + '건 (' + ncl.join(', ') + ')' + NL +
      '    → 상품정보 「업체_택배사」 탭 D열에 코드를 채우면 포함됩니다.';
  }
  msg += NL + NL + (blob
    ? '파일: ' + fileName + NL + fileUrl
    : '⚠ 엑셀 내보내기 실패 (' + err + ') — 임시 시트가 드라이브에 남아 있습니다.');
  return ssio_alert(msg);
}
