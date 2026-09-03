/**
 * gasBulk.js — 사방넷 송장대량등록. 허브 `_po_rebuildSabangnetBulkUpload_` 의 포팅이다.
 *
 * 회차 하나가 아니라 원천을 직접 훑어 (주문번호, 송장) 쌍을 전부 뽑는다.
 * 세트분리 한 회차의 결과만 고르면 하루치가 안 나온다.
 *
 * 원천 넷 (허브와 같은 순서·같은 우선순위):
 *   1. 대리공급_임시기록   상품정보  P=주문번호 X=송장 W=업체prefix
 *   2. 협력업체_발주허브   상품정보  C=주문번호 N=송장  B=업체
 *   3. 롯데 자사출고       거래관리  J=주문번호 G=송장  → 코드 002 고정
 *   4. 주문라인원장        오늘 전체 회차 — 전파가 채운 운송장번호 (합포장 동봉 포함)
 *
 * 규칙도 허브와 같다:
 *   - 한 셀에 송장이 여러 개일 수 있다 (줄바꿈·쉼표·세미콜론) → 전부 행으로 편다
 *   - "재고확인 후 판단" 류 placeholder 는 송장이 아니다
 *   - 주문번호|송장 조합으로 중복 제거 (원천이 겹쳐도 안전)
 *   - 시스템 발급 ID(MMdd-xx- / YYMMDD-PH-)는 사방넷이 모르므로 제외
 *   - 택배사코드를 못 찾으면 그 행은 빠지고 skipNoCode 로 보고
 */

var SSB_HEADERS = ['주문번호', '송장번호', '', '', '택배사코드'];
var SSB_LOTTE_CODE = '002';
/** 한 셀 안의 송장 구분자 — 줄바꿈·쉼표·세미콜론 */
var SSB_INV_SPLIT = new RegExp('[' + String.fromCharCode(92) + 'r' +
  String.fromCharCode(92) + 'n,;]+');

/** 여러 표기를 YYYYMMDD 로 통일한다. "2026/09/02 -11" · "2026-09-02" · "20260902" */
var SSB_DATE_RE = new RegExp('([0-9]{4})[^0-9]{0,3}([0-9]{1,2})[^0-9]{0,3}([0-9]{1,2})');
var SSB_DATE_RE2 = new RegExp('^([0-9]{1,2})[^0-9]([0-9]{1,2})' + String.fromCharCode(36));
function ssb_pad2(x) { return x.length < 2 ? '0' + x : x; }
function ssb_dateKey(v) {
  var s = ssText(v);
  if (!s) return '';
  var y = '', mo = '', d = '';
  var g = s.match(SSB_DATE_RE);
  if (g) { y = g[1]; mo = g[2]; d = g[3]; }
  else {
    // 연도 없는 "09/03" 류 — 올해로 본다
    var g2 = s.match(SSB_DATE_RE2);
    if (!g2) return '';
    y = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy');
    mo = g2[1]; d = g2[2];
  }
  // 송장번호를 날짜로 오인하지 않도록 범위를 본다
  var mn = parseInt(mo, 10), dn = parseInt(d, 10);
  if (!(mn >= 1 && mn <= 12) || !(dn >= 1 && dn <= 31)) return '';
  return y + ssb_pad2(mo) + ssb_pad2(d);
}

/** 대상일 집합. 「대량등록_대상일수」 가 '전체' 면 null(필터 없음) */
function ssb_allowedDates(cfg) {
  var raw = ssText(cfg['대량등록_대상일수']);
  if (raw === '전체' || raw === '0') return null;
  var days = ssNum(raw);
  if (!(days > 0)) days = 1;
  var out = {}, base = new Date();
  for (var i = 0; i < days; i++) {
    out[Utilities.formatDate(new Date(base.getTime() - i * 86400000),
      'Asia/Seoul', 'yyyyMMdd')] = true;
  }
  return out;
}

/** 택배사 코드 표 — 상품정보 「업체_택배사」 (A=업체prefix B=업체명 C=택배사 D=코드) */
function ssb_carrierTable() {
  var t = { byPfx: {}, byLabel: {}, code: {} };
  var fallback = { 'CJ대한통운': '001', '롯데택배': '002', '로젠택배': '007', '대신택배': '037' };
  for (var k in fallback) {
    if (Object.prototype.hasOwnProperty.call(fallback, k)) t.code[k] = fallback[k];
  }
  try {
    var cfg = ssio_config();
    var tab = SpreadsheetApp.openById(cfg['이카운트시트ID']).getSheetByName('업체_택배사');
    if (tab && tab.getLastRow() >= 2) {
      var v = tab.getRange(2, 1, tab.getLastRow() - 1, 4).getDisplayValues();
      for (var i = 0; i < v.length; i++) {
        var pfx = ssText(v[i][0]).toUpperCase();
        var label = ssText(v[i][1]).split(' ').join('');
        var carrier = ssText(v[i][2]);
        var code = ssText(v[i][3]);
        if (!carrier) continue;
        if (pfx) t.byPfx[pfx] = carrier;
        if (label) t.byLabel[label] = carrier;
        if (code) t.code[carrier] = code;
      }
    }
  } catch (e) {
    Logger.log('[SSB] 업체_택배사 못 읽음, 폴백 사용: ' + e.message);
  }
  return t;
}

/** 업체 힌트(prefix 또는 업체명) → 사방넷 택배사코드 */
function ssb_codeForVendor(t, hint) {
  var h = ssText(hint);
  if (!h) return '';
  var up = h.toUpperCase();
  var carrier = t.byPfx[up] || t.byPfx[up.substring(0, 2)] ||
    t.byLabel[h.split(' ').join('')] || '';
  if (!carrier) return '';
  return t.code[carrier] || '';
}

/** placeholder 는 송장이 아니다 (허브 _po_isInvPlaceholder_ 와 같은 판정) */
function ssb_isPlaceholder(v) {
  var s = ssText(v).split(' ').join('');
  if (!s) return false;
  return s.indexOf('재고확인') !== -1 && s.indexOf('판단') !== -1;
}

/** 한 셀의 송장을 여러 행으로 편다. 중복은 주문번호|송장 으로 막는다. */
function ssb_addRows(rows, seen, orderNo, invCell, code, res, uidSeen) {
  var o = ssText(orderNo);
  var c = ssText(code);
  if (!o || !c) return 0;
  if (!ssIsSabangnetUid(o)) { res.skipGen++; return 0; }
  if (uidSeen) uidSeen[o] = true;
  var parts = ssText(invCell).split(SSB_INV_SPLIT);
  var added = 0;
  for (var i = 0; i < parts.length; i++) {
    var inv = ssText(parts[i]);
    if (!inv || ssb_isPlaceholder(inv)) continue;
    var bare = inv.split(' ').join('');
    if (bare.indexOf('운송장') !== -1 || bare.indexOf('송장번호') !== -1) continue;
    var key = o + '|' + inv;
    if (seen[key]) continue;
    seen[key] = true;
    rows.push([o, inv, '', '', c]);
    res.byCode[c] = (res.byCode[c] || 0) + 1;
    added++;
  }
  return added;
}

function ssb_noCode(res, name) {
  var n = ssText(name) || '(업체없음)';
  res.skipNoCode++;
  res.noCodeNames[n] = (res.noCodeNames[n] || 0) + 1;
}

/**
 * 원천 네 곳을 훑어 (주문번호, 송장) 행을 모은다.
 * 저장과 진단이 같은 함수를 쓰므로 두 결과가 어긋날 수 없다.
 */
function ssb_collect() {
  var cfg = ssio_config();
  var t = ssb_carrierTable();
  var rows = [], seen = {};
  var res = { skipNoCode: 0, skipGen: 0, byCode: {}, noCodeNames: {} };
  var n1 = 0, n2 = 0, n3 = 0, n4 = 0;
  var errs = [];
  var scan = { s1: 0, s2: 0, s3: 0, s4: 0 };
  var uidSeen = {};
  // 원천 표는 여러 날치가 쌓여 있다. 지난 날짜 주문을 사방넷에 다시 올리면
  // 이미 처리된 건이라 「건별 미매칭」으로 거부된다. 대상일만 남긴다.
  var allowed = ssb_allowedDates(cfg);
  res.skipOld = 0; res.noDate = 0; res.byDate = {};

  // ── 1. 대리공급_임시기록 (P=15 주문번호 · X=23 송장 · W=22 업체prefix) ──
  var r1 = ssm_openOptional(cfg['이카운트시트ID'],
    cfg['대리공급_임시기록탭'] || '대리공급_임시기록', '상품정보');
  if (r1.ok) {
    for (var i = 1; i < r1.values.length; i++) {
      var uid = ssText(r1.values[i][15]);
      var invc = ssText(r1.values[i][23]);
      if (!uid || !invc) continue;
      if (!ssb_keepDate(r1.values[i][2], allowed, res)) continue;
      var pfx = ssText(r1.values[i][22]);
      if (!pfx) pfx = ssText(r1.values[i][3]).substring(0, 2);   // D열 품목코드 앞 두 글자
      var code = ssb_codeForVendor(t, pfx);
      if (!code) { if (ssIsSabangnetUid(uid)) ssb_noCode(res, pfx); continue; }
      scan.s1++; n1 += ssb_addRows(rows, seen, uid, invc, code, res, uidSeen);
    }
  } else { errs.push('임시기록: ' + r1.why); }

  // ── 2. 협력업체_발주허브 (C=2 주문번호 · N=13 송장 · B=1 업체) ──
  var r2 = ssm_openOptional(cfg['이카운트시트ID'],
    cfg['발주허브탭'] || '협력업체_발주허브', '상품정보');
  if (r2.ok) {
    for (var j = 1; j < r2.values.length; j++) {
      var uid2 = ssText(r2.values[j][2]);
      var inv2 = ssText(r2.values[j][13]);
      if (!uid2 || !inv2) continue;
      if (!ssb_keepDate(r2.values[j][3], allowed, res)) continue;
      var vendor = ssText(r2.values[j][1]);
      var code2 = ssb_codeForVendor(t, vendor);
      if (!code2) { if (ssIsSabangnetUid(uid2)) ssb_noCode(res, vendor); continue; }
      scan.s2++; n2 += ssb_addRows(rows, seen, uid2, inv2, code2, res, uidSeen);
    }
  } else { errs.push('발주허브: ' + r2.why); }

  // ── 3. 롯데 자사출고 — 거래관리시스템송장 (J=9 주문번호 · G=6 송장) ──
  try {
    var lId = ssText(cfg['롯데송장시트ID']) || '1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs';
    var lGid = ssNum(cfg['롯데송장탭GID']) || 1575029201;
    var lSS = SpreadsheetApp.openById(lId);
    var lTab = null, shs = lSS.getSheets();
    for (var s = 0; s < shs.length; s++) {
      if (shs[s].getSheetId() === lGid) { lTab = shs[s]; break; }
    }
    if (!lTab) throw new Error('GID ' + lGid + ' 탭 없음');
    if (lTab.getLastRow() >= 2) {
      var lwid = Math.max(lTab.getLastColumn(), 10);
      // 집하일자 열은 헤더로 찾는다. 못 찾으면 허브가 쓰는 고정 위치(D열)로.
      var lhd = lTab.getRange(1, 1, 1, lwid).getDisplayValues()[0];
      var dCol = -1;
      for (var dh = 0; dh < lhd.length; dh++) {
        var hn = ssText(lhd[dh]).split(' ').join('');
        if (hn.indexOf('집하일') >= 0 || hn.indexOf('발송일') >= 0 ||
            hn.indexOf('출고일') >= 0 || hn.indexOf('등록일') >= 0) { dCol = dh; break; }
      }
      if (dCol < 0) dCol = 3;
      res.lotteCols = [];
      var probe = lTab.getRange(2, 1, Math.min(4, lTab.getLastRow() - 1), lwid)
        .getDisplayValues();
      for (var lc = 0; lc < Math.min(lwid, 16); lc++) {
        var sample = '';
        for (var pr = 0; pr < probe.length; pr++) {
          if (ssText(probe[pr][lc])) { sample = ssText(probe[pr][lc]); break; }
        }
        res.lotteCols.push(lc + ':' + (ssText(lhd[lc]) || '(무제)') +
          ' = ' + (sample.length > 16 ? sample.substring(0, 16) : sample || '(빈칸)') +
          (lc === dCol ? '   ← 날짜열로 선택됨' : ''));
      }
      var lv = lTab.getRange(2, 1, lTab.getLastRow() - 1, lwid).getDisplayValues();
      for (var k = 0; k < lv.length; k++) {
        if (!ssText(lv[k][9]) || !ssText(lv[k][6])) continue;
        if (!ssb_keepDate(lv[k][dCol], allowed, res)) continue;
        scan.s3++;
        n3 += ssb_addRows(rows, seen, lv[k][9], lv[k][6], SSB_LOTTE_CODE, res, uidSeen);
      }
    }
  } catch (eL) { errs.push('롯데 송장탭: ' + String(eL.message || eL)); }

  // ── 4. 주문라인원장 — 오늘 전체 회차 (전파가 채운 운송장번호, 합포장 동봉 포함) ──
  //    회차키는 YYMMDD-N 이라 앞 6자리로 오늘치만 고른다.
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd');
  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (lg && lg.getLastRow() > 1) {
    var lc = lg.getLastColumn();
    var lh = lg.getRange(1, 1, 1, lc).getValues()[0];
    var ix = {};
    for (var q = 0; q < lh.length; q++) {
      var hn = ssText(lh[q]);
      if (hn && ix[hn] === undefined) ix[hn] = q;
    }
    if (ix['고유ID'] !== undefined && ix['운송장번호'] !== undefined) {
      var gv = lg.getRange(2, 1, lg.getLastRow() - 1, lc).getDisplayValues();
      for (var g = 0; g < gv.length; g++) {
        var rk = ix['회차키'] !== undefined ? ssText(gv[g][ix['회차키']]) : '';
        if (rk && rk.substring(0, 6) !== today) continue;   // 오늘 회차만
        var uid4 = ssText(gv[g][ix['고유ID']]);
        var inv4 = ssText(gv[g][ix['운송장번호']]);
        if (!uid4 || !inv4) continue;
        // 원장이 유일하게 보태는 건 「합포장 동봉」이다. 동봉 주문은 자기 번호로
        // 롯데에 올라간 적이 없어 롯데탭에 없지만, 대표의 송장을 그대로 써야 한다.
        // 대리공급·대리판매 건은 이미 원천 1·2 에서 잡히므로 여기서는 건너뛴다(오류 아님).
        var m4 = ix['송장매칭'] !== undefined ? ssText(gv[g][ix['송장매칭']]) : '';
        if (m4 !== '롯데 직접' && m4 !== '합포장 전파') continue;
        var code4 = SSB_LOTTE_CODE;
        scan.s4++; n4 += ssb_addRows(rows, seen, uid4, inv4, code4, res, uidSeen);
      }
    }
  }

  var uidCount = 0;
  for (var uk in uidSeen) if (Object.prototype.hasOwnProperty.call(uidSeen, uk)) uidCount++;
  return { rows: rows, res: res, errs: errs, scan: scan, uidCount: uidCount,
    allowed: allowed,
    n1: n1, n2: n2, n3: n3, n4: n4 };
}

function ss_사방넷엑셀저장() {
  var NL = String.fromCharCode(10);
  var C = ssb_collect();
  var rows = C.rows, res = C.res, errs = C.errs;
  var n1 = C.n1, n2 = C.n2, n3 = C.n3, n4 = C.n4;
  if (!rows.length) {
    return ssio_alert('저장할 자료가 없습니다.' + NL + NL +
      (errs.length ? errs.join(NL) : '원천 네 곳 모두에서 송장을 찾지 못했습니다.'));
  }

  // ── 엑셀로 내보내 드라이브에 저장 (허브와 같은 형식·같은 폴더 규칙) ──
  var ymd = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss');
  var fileName = '사방넷_송장대량등록_' + ymd + '.xlsx';
  var tmp = SpreadsheetApp.create('tmp_sabang_bulk_' + ymd);
  var dest = tmp.getSheets()[0];
  dest.setName('사방넷_송장대량등록');
  var all = [SSB_HEADERS].concat(rows);
  dest.getRange(1, 1, all.length, 5).setNumberFormat('@');
  dest.getRange(1, 1, all.length, 5).setValues(all);
  dest.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1f4e78').setFontColor('white');
  SpreadsheetApp.flush();

  var blob = null, xerr = '';
  try {
    var resp = UrlFetchApp.fetch(
      'https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200 && resp.getBlob().getBytes().length > 64) {
      blob = resp.getBlob().setName(fileName).setContentType(MimeType.MICROSOFT_EXCEL);
    } else { xerr = 'HTTP ' + resp.getResponseCode(); }
  } catch (e2) { xerr = e2.message; }

  var fileUrl = '', fileId = '';
  if (blob) {
    var parent = null;
    try {
      var ps = DriveApp.getFileById(ssio_ss().getId()).getParents();
      if (ps.hasNext()) parent = ps.next();
    } catch (e3) {}
    if (!parent) parent = DriveApp.getRootFolder();
    var it = parent.getFoldersByName('사방넷_송장대량등록');
    var folder = it.hasNext() ? it.next() : parent.createFolder('사방넷_송장대량등록');
    var f = folder.createFile(blob);
    fileUrl = f.getUrl(); fileId = f.getId();
    try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e4) {}
  }

  // 확인용으로 시트에도 남긴다
  ssio_write(SSIO_TABS.사방넷등록, SSB_HEADERS, rows, { bg: '#2c4f6b' });

  var codeLines = [];
  for (var c in res.byCode) if (Object.prototype.hasOwnProperty.call(res.byCode, c)) {
    codeLines.push('      코드 ' + c + ' : ' + res.byCode[c] + '건');
  }
  var msg = '사방넷 송장대량등록' + NL + NL +
    '  · 저장 행 : ' + rows.length + '건' + NL + codeLines.join(NL) + NL +
    '  · 원천 · 임시기록 ' + n1 + ' / 발주허브 ' + n2 +
    ' / 롯데자사 ' + n3 + ' / 원장(오늘) ' + n4 + NL +
    '    (중복은 주문번호+송장 기준으로 이미 뺀 숫자입니다)';
  if (res.skipOld) {
    msg += NL + '  · 대상일 아닌 지난 주문 제외 : ' + res.skipOld + '건' +
      (res.noDate ? ' (날짜 못 읽은 행 ' + res.noDate + '건은 포함)' : '');
  }
  if (res.skipGen) {
    msg += NL + '  · 사방넷 번호가 아닌 ID 제외 : ' + res.skipGen + '건 (전화주문·발주수집 발급)';
  }
  if (res.skipNoCode) {
    var ncl = [];
    for (var nc in res.noCodeNames) if (Object.prototype.hasOwnProperty.call(res.noCodeNames, nc)) {
      ncl.push(nc + ' ' + res.noCodeNames[nc]);
    }
    msg += NL + '  · 택배사코드 미지정 제외 : ' + res.skipNoCode + '건 (' + ncl.join(', ') + ')' + NL +
      '    → 상품정보 「업체_택배사」 탭 D열에 코드를 채우면 포함됩니다.';
  }
  if (errs.length) msg += NL + NL + '⚠ 못 읽은 원천:' + NL + '  ' + errs.join(NL + '  ');

  if (!blob) return ssio_alert(msg + NL + NL + '⚠ 엑셀 내보내기 실패 (' + xerr + ')');

  try {
    var dl = 'https://drive.google.com/uc?export=download&id=' + fileId;
    var html = HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:8px 4px">' +
      '<p style="margin:0 0 6px"><b>' + fileName + '</b></p>' +
      '<p style="margin:0 0 14px;color:#555">' + rows.length + '행 · 임시기록 ' + n1 +
      ' / 발주허브 ' + n2 + ' / 롯데자사 ' + n3 + ' / 원장 ' + n4 + '</p>' +
      '<p style="margin:0">' +
      '<a href="' + dl + '" target="_blank" style="display:inline-block;background:#1f4e78;' +
      'color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:bold">' +
      '⬇ 엑셀 다운로드</a>&nbsp;&nbsp;' +
      '<a href="' + fileUrl + '" target="_blank" style="color:#1f4e78">드라이브에서 열기</a>' +
      '</p></div>').setWidth(470).setHeight(160);
    SpreadsheetApp.getUi().showModalDialog(html, '사방넷 송장대량등록');
    return;
  } catch (eUi) {
    return ssio_alert(msg + NL + NL +
      '다운로드: https://drive.google.com/uc?export=download&id=' + fileId);
  }
}

/**
 * 🔎 사방넷 진단 — 아무것도 쓰지 않고 숫자만 센다.
 * 저장과 같은 ssb_collect() 를 쓰므로 여기 숫자가 곧 저장될 내용이다.
 */
function ss_사방넷진단() {
  var NL = String.fromCharCode(10);
  var C = ssb_collect();
  var byUid = {};
  for (var i = 0; i < C.rows.length; i++) {
    var u = C.rows[i][0];
    (byUid[u] || (byUid[u] = [])).push(C.rows[i][1]);
  }
  var multi = [];
  for (var k in byUid) {
    if (!Object.prototype.hasOwnProperty.call(byUid, k)) continue;
    if (byUid[k].length > 1 && multi.length < 8) multi.push(k + ' → ' + byUid[k].join(', '));
  }
  var codeLines = [];
  for (var c in C.res.byCode) {
    if (Object.prototype.hasOwnProperty.call(C.res.byCode, c)) {
      codeLines.push('      코드 ' + c + ' : ' + C.res.byCode[c] + '행');
    }
  }
  var msg = '사방넷 송장대량등록 진단 (저장하지 않음)' + NL + NL +
    '  · 사방넷 주문번호 : ' + C.uidCount + '건' + NL +
    '  · 나올 행 수      : ' + C.rows.length + '행' + NL + codeLines.join(NL) + NL + NL +
    '  [원천별 · 스캔 → 채택]' + NL +
    '    임시기록   ' + C.scan.s1 + ' → ' + C.n1 + NL +
    '    발주허브   ' + C.scan.s2 + ' → ' + C.n2 + NL +
    '    롯데자사   ' + C.scan.s3 + ' → ' + C.n3 + NL +
    '    원장(오늘) ' + C.scan.s4 + ' → ' + C.n4 + NL +
    '    ※ 채택이 적은 건 앞 원천에서 이미 잡힌 중복입니다.' + NL + NL +
    '  · 사방넷 번호 아닌 ID 제외 : ' + C.res.skipGen + '건' + NL +
    '  · 대상일 아닌 지난 주문 제외 : ' + C.res.skipOld + '건' +
    (C.res.noDate ? ' · 날짜 못 읽어 포함한 행 ' + C.res.noDate + '건' +
      (C.res.noDateSamples && C.res.noDateSamples.length
        ? ' 예: ' + C.res.noDateSamples.join(' / ') : '') : '');
  var dks = [];
  for (var dk in C.res.byDate) {
    if (Object.prototype.hasOwnProperty.call(C.res.byDate, dk)) dks.push(dk);
  }
  dks.sort();
  if (dks.length) {
    var tailD = dks.slice(-7).map(function (d) {
      return '    ' + d + ' : ' + C.res.byDate[d] + '행' +
        (C.allowed && C.allowed[d] ? '   ← 대상일' : '');
    });
    msg += NL + NL + '  [원천 날짜 분포 · 최근 7일]' + NL + tailD.join(NL);
  }
  if (C.res.skipNoCode) {
    var ncl = [];
    for (var nc in C.res.noCodeNames) {
      if (Object.prototype.hasOwnProperty.call(C.res.noCodeNames, nc)) {
        ncl.push(nc + ' ' + C.res.noCodeNames[nc]);
      }
    }
    msg += NL + '  · 택배사코드 미지정 제외   : ' + C.res.skipNoCode + '건 (' + ncl.join(', ') + ')';
  }
  if (multi.length) {
    msg += NL + NL + '  [한 주문에 송장 2개 이상]' + NL + '    ' + multi.join(NL + '    ');
  }
  if (C.res.lotteCols && C.res.lotteCols.length) {
    msg += NL + NL + '  [롯데 송장탭 열 — 앞 16개]' + NL +
      '    ' + C.res.lotteCols.join(NL + '    ');
  }
  if (C.errs.length) msg += NL + NL + '⚠ 못 읽은 원천:' + NL + '  ' + C.errs.join(NL + '  ');
  return ssio_alert(msg);
}

/** 대상일이면 true. 날짜를 못 읽은 행은 남긴다 (조용히 버리지 않는다) */
function ssb_keepDate(cell, allowed, res) {
  if (!allowed) return true;
  var k = ssb_dateKey(cell);
  if (!k) {
    res.noDate++;
    if (!res.noDateSamples) res.noDateSamples = [];
    if (res.noDateSamples.length < 3) res.noDateSamples.push(ssText(cell) || '(빈칸)');
    return true;
  }
  res.byDate[k] = (res.byDate[k] || 0) + 1;
  if (allowed[k]) return true;
  res.skipOld++;
  return false;
}
