/**
 * gasBulk.js — 사방넷 송장대량등록. 허브 `_po_rebuildSabangnetBulkUpload_` 의 포팅이다.
 *
 * 회차 하나가 아니라 원천을 직접 훑어 (주문번호, 송장) 쌍을 전부 뽑는다.
 * 세트분리 한 회차의 결과만 고르면 하루치가 안 나온다.
 *
 * 원천 넷 (허브와 같은 순서·같은 우선순위):
 *   1. 대리공급_임시기록   상품정보  P=주문번호 X=송장 W=업체prefix
 *   2. 협력업체_발주허브   상품정보  C=주문번호 N=송장  B=업체
 *   3. 자사출고            거래관리  로젠 E/F · 롯데 J/G  → 탭이 곧 택배사
 *   4. 주문라인원장        오늘 전체 회차 — 전파가 채운 운송장번호 (합포장 동봉 포함)
 *
 * 규칙도 허브와 같다:
 *   - 한 셀에 송장이 여러 개일 수 있다 (줄바꿈·쉼표·세미콜론) → 전부 행으로 편다
 *   - "재고확인 후 판단" 류 placeholder 는 송장이 아니다
 *   - 주문번호|송장 조합으로 중복 제거 (원천이 겹쳐도 안전)
 *   - 시스템 발급 ID(MMdd-ds- / MMdd-PH-)는 사방넷이 모르므로 제외
 *   - 택배사코드를 못 찾으면 그 행은 빠지고 skipNoCode 로 보고
 */

var SSB_HEADERS = ['주문번호', '송장번호', '', '', '택배사코드'];
/* ★ 자사출고 택배사 코드 ★  (2026-09-11 롯데 → 로젠)
   탭이 곧 택배사라 탭마다 제 코드를 쓴다. 「002 고정」이던 자리를 없앤다. */
var SSB_LOTTE_CODE = '002';   // 2026-09-10 까지의 옛 건
var SSB_ROZEN_CODE = '007';   // 지금 쓰는 택배사

/**
 * 자사출고 송장번호 → 택배사 코드.
 *
 * ★ 원장에는 택배사가 안 적힌다 ★
 *   원장이 보태는 건 「합포장 동봉」인데, 그 줄은 대표의 송장을 물려받을 뿐
 *   택배사 칸이 없다. 우리 자사출고는 롯데(12자리) 아니면 로젠(11자리)
 *   둘뿐이라 번호 길이로 갈린다.
 *   길이가 둘 다 아니면 «지금 택배사»로 본다 — 빈 코드를 주면 그 줄이
 *   조용히 빠지고, 사방넷에 안 올라간 송장은 아무도 못 찾는다.
 */
function ssb_ownCode(inv) {
  var d = ssText(inv).replace(new RegExp('[^0-9]', 'g'), '');
  return d.length === 12 ? SSB_LOTTE_CODE : SSB_ROZEN_CODE;
}
/** 한 셀 안의 송장 구분자 — 줄바꿈·쉼표·세미콜론 */
/* ★ 2026-09-09: 공백도 분리자다 ★
   원장·사방넷송장의 운송장번호 칸은 송장이 여러 장이면 **공백으로 이어** 적는다
   (일일마감·CS 검색이 읽는 형식과 같다). 공백을 안 가르면
   「268334484434 268334484445」가 통째로 한 장으로 읽혀 사방넷 업로드가 다 튕긴다. */
var SSB_INV_SPLIT = new RegExp('[' + String.fromCharCode(92) + 'r' +
  String.fromCharCode(92) + 'n' + String.fromCharCode(92) + 's,;/|]+');

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
  /* ★ 이름→코드 대응이라 롯데도 남는다 ★  (2026-09-11)
     탭 이름을 로젠으로 바꾸면서 여기까지 같이 바꿨다가 되돌렸다.
     지난 송장·반품에 롯데가 남아 있고, 코드표는 «그 이름이 무슨 코드인가»지
     «지금 어느 택배사를 쓰는가»가 아니다. */
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
function ssb_addRows(rows, seen, orderNo, invCell, code, res, uidSeen, seenOrd) {
  var o = ssText(orderNo);
  var c = ssText(code);
  if (!o || !c) return 0;
  if (!ssIsSabangnetUid(o)) { res.skipGen++; return 0; }
  if (uidSeen) uidSeen[o] = true;
  /* ★ 사방넷은 주문번호당 송장 하나만 받는다 ★
     한 주문이 여러 박스로 나가도 올리는 것은 대표 한 장이다.
     여기서 두 줄을 만들면 사방넷이 그 주문을 안 받는다.
     (여러 **주문번호**가 같은 송장을 나눠 갖는 합포장은 정상이고 각각 나간다 —
      막는 것은 그 반대 방향이다.)
     원장·일일마감에는 스무 장이 다 들어간다. 거기와 여기는 쓰임이 다르다. */
  if (seenOrd && seenOrd[o]) return 0;
  var parts = ssText(invCell).split(SSB_INV_SPLIT);
  for (var i = 0; i < parts.length; i++) {
    var inv = ssText(parts[i]);
    if (!inv || ssb_isPlaceholder(inv)) continue;
    var bare = inv.split(' ').join('');
    if (bare.indexOf('운송장') !== -1 || bare.indexOf('송장번호') !== -1) continue;
    var key = o + '|' + inv;
    if (seen[key]) continue;
    seen[key] = true;
    if (seenOrd) seenOrd[o] = true;
    rows.push([o, inv, '', '', c]);
    res.byCode[c] = (res.byCode[c] || 0) + 1;
    return 1;              // 첫 장만 — 사방넷 제약
  }
  return 0;
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
  /* 한 주문번호는 사방넷에 한 줄만 — 여러 원천에서 다른 송장이 와도 첫 것만 쓴다.
     (여러 주문번호가 같은 송장을 나눠 갖는 합포장·샘플은 각각 나간다 — 반대 방향이다.) */
  var seenOrd = {};
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
      scan.s1++; n1 += ssb_addRows(rows, seen, uid, invc, code, res, uidSeen, seenOrd);
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
      scan.s2++; n2 += ssb_addRows(rows, seen, uid2, inv2, code2, res, uidSeen, seenOrd);
    }
  } else { errs.push('발주허브: ' + r2.why); }

  // ── 3. 자사출고 — 거래관리시스템송장. 로젠(E=4·F=5) + 롯데(J=9·G=6) ──
  //    둘 다 읽는다. 한쪽만 보면 갈아탄 날 앞뒤가 조용히 빠진다.
  var 자사탭 = [
    { 이름: '로젠', gid: ssNum(cfg['로젠송장탭GID']) || 548505068, uid: 4, inv: 5, code: SSB_ROZEN_CODE },
    { 이름: '롯데', gid: ssNum(cfg['롯데송장탭GID']) || 1575029201, uid: 9, inv: 6, code: SSB_LOTTE_CODE },
  ];
  res.자사탭 = [];
  for (var oi = 0; oi < 자사탭.length; oi++) {
    var 편 = 자사탭[oi];
    //  한 탭이 안 읽혀도 나머지는 읽는다 — try 를 «탭마다» 둔다
    try {
      var lId = ssText(cfg['롯데송장시트ID']) || '1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs';
      var lSS = SpreadsheetApp.openById(lId);
      var lTab = null, shs = lSS.getSheets();
      for (var sx = 0; sx < shs.length; sx++) {
        if (shs[sx].getSheetId() === 편.gid) { lTab = shs[sx]; break; }
      }
      if (!lTab) throw new Error('GID ' + 편.gid + ' 탭 없음');
      if (lTab.getLastRow() < 2) { res.자사탭.push(편.이름 + ' 비었음'); continue; }

      var lwid = Math.max(lTab.getLastColumn(), Math.max(편.uid, 편.inv) + 1, 10);
      // 집하일자 열은 헤더로 찾는다. 못 찾으면 롯데가 쓰던 고정 위치(D열)로.
      var lhd = lTab.getRange(1, 1, 1, lwid).getDisplayValues()[0];
      var dCol = -1;
      for (var dh = 0; dh < lhd.length; dh++) {
        var hn = ssText(lhd[dh]).split(' ').join('');
        if (hn.indexOf('집하일') >= 0 || hn.indexOf('발송일') >= 0 ||
            hn.indexOf('출고일') >= 0 || hn.indexOf('등록일') >= 0) { dCol = dh; break; }
      }
      if (dCol < 0) dCol = 3;

      /* 어느 칸을 읽었는지 남긴다 — 탭 서식이 바뀌면 여기부터 본다.
         탭이 둘이 됐으니 이름을 붙여 구분한다. */
      if (oi === 0) res.lotteCols = [];
      var probe = lTab.getRange(2, 1, Math.min(4, lTab.getLastRow() - 1), lwid).getDisplayValues();
      for (var lc = 0; lc < Math.min(lwid, 16); lc++) {
        var sample = '';
        for (var pr = 0; pr < probe.length; pr++) {
          if (ssText(probe[pr][lc])) { sample = ssText(probe[pr][lc]); break; }
        }
        res.lotteCols.push(편.이름 + ' ' + lc + ':' + (ssText(lhd[lc]) || '(무제)') +
          ' = ' + (sample.length > 16 ? sample.substring(0, 16) : sample || '(빈칸)') +
          (lc === dCol ? '   ← 날짜열' : '') +
          (lc === 편.uid ? '   ← 주문번호' : '') +
          (lc === 편.inv ? '   ← 운송장' : ''));
      }

      var lv = lTab.getRange(2, 1, lTab.getLastRow() - 1, lwid).getDisplayValues();
      var n편 = 0;
      for (var k = 0; k < lv.length; k++) {
        if (!ssText(lv[k][편.uid]) || !ssText(lv[k][편.inv])) continue;
        if (!ssb_keepDate(lv[k][dCol], allowed, res)) continue;
        scan.s3++;
        var n어 = ssb_addRows(rows, seen, lv[k][편.uid], lv[k][편.inv], 편.code, res, uidSeen, seenOrd);
        n3 += n어; n편 += n어;
      }
      res.자사탭.push(편.이름 + ' ' + n편 + '행');
    } catch (eL) { errs.push('자사출고 ' + 편.이름 + ' 탭: ' + String(eL.message || eL)); }
  }

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
        /* 「자사 직접」이 지금 쓰는 글자다. 옛 원장 줄에는 「롯데 직접」이
           남아 있어 둘 다 받는다 — 지난 회차를 버리면 그날 것이 통째로 빠진다. */
        if (m4 !== '자사 직접' && m4 !== '롯데 직접' && m4 !== '합포장 전파') continue;
        //  원장에는 택배사 칸이 없다 — 송장 자리수로 가린다(ssb_ownCode 설명)
        var code4 = ssb_ownCode(inv4);
        scan.s4++; n4 += ssb_addRows(rows, seen, uid4, inv4, code4, res, uidSeen, seenOrd);
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
  //  «제 탭»에 남긴다 — 「사방넷등록」은 송장 전파의 것이다(gasIO 주석)
  ssio_write(SSIO_TABS.사방넷대량등록, SSB_HEADERS, rows, { bg: '#2c4f6b' });

  var codeLines = [];
  for (var c in res.byCode) if (Object.prototype.hasOwnProperty.call(res.byCode, c)) {
    codeLines.push('      코드 ' + c + ' : ' + res.byCode[c] + '건');
  }
  var msg = '사방넷 송장대량등록' + NL + NL +
    '  · 저장 행 : ' + rows.length + '건' + NL + codeLines.join(NL) + NL +
    '  · 원천 · 임시기록 ' + n1 + ' / 발주허브 ' + n2 +
    ' / 자사출고 ' + n3 + ' / 원장(오늘) ' + n4 +
    (res.자사탭 && res.자사탭.length ? '  [' + res.자사탭.join(' · ') + ']' : '') + NL +
    '    (중복은 주문번호+송장 기준으로 이미 뺀 숫자입니다)';

  /* ★ 「전파는 385건인데 저장은 91건」에 그 자리에서 답한다 ★  (2026-09-11)
       송장 전파가 만든 「사방넷등록」 탭과 견준다. 두 기능은 보는 범위가
       다르다 — 전파는 «이 회차 판매현황», 저장은 «원천 네 곳 + 대상일수».
       숫자가 다른 게 당연한데, 그 사실이 어디에도 안 적혀 있어서
       볼 때마다 이유를 찾아야 했다. */
  try {
    var regTab = ssio_ss().getSheetByName(SSIO_TABS.사방넷등록);
    var regN = regTab ? Math.max(0, regTab.getLastRow() - 1) : 0;
    if (regN) {
      msg += NL + '  · 「사방넷등록」 탭(송장 전파 결과) : ' + regN + '행' +
        (regN !== rows.length
          ? '  ← 여기와 다른 것이 정상입니다 (전파는 이 회차, 저장은 원천 네 곳 + 대상일수)'
          : '');
    }
  } catch (eReg) {}
  /* 대상일수는 «늘» 적는다. 기본이 「오늘만」이라 지난 주문이 통째로 빠지는데,
     제외된 게 하나도 없는 날에는 그 설명조차 안 나와 더 헷갈렸다. */
  var 일수 = ssText(ssio_config()['대량등록_대상일수']) || '1';
  msg += NL + '  · 대상일수 설정 : ' + 일수 +
    (일수 === '전체' || 일수 === '0' ? ' (제한 없음)'
      : 일수 === '1' ? ' (오늘 집하분만)' : ' (오늘부터 ' + 일수 + '일)') +
    '   ← 설정 탭 「대량등록_대상일수」';
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
      /* ★ 성공했을 때도 «왜 이 숫자인지»를 보여 준다 ★  (2026-09-11)
         여태 빠진 이유(대상일수·전화주문·택배사코드 미지정)는 «엑셀 저장에
         실패했을 때만» 보였다. 성공하면 건수만 떠서, 385건인 줄 알았는데
         91건이 나오면 이유를 물어볼 데가 없었다. */
      '<pre style="margin:0 0 14px;color:#555;white-space:pre-wrap;' +
      'font:12px/1.5 -apple-system,sans-serif;max-height:300px;overflow:auto">' +
      msg.split('&').join('&amp;').split('<').join('&lt;') + '</pre>' +
      '<p style="margin:0">' +
      '<a href="' + dl + '" target="_blank" style="display:inline-block;background:#1f4e78;' +
      'color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:bold">' +
      '⬇ 엑셀 다운로드</a>&nbsp;&nbsp;' +
      '<a href="' + fileUrl + '" target="_blank" style="color:#1f4e78">드라이브에서 열기</a>' +
      '</p></div>').setWidth(560).setHeight(480);
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

/* ══════════════════════════════════════════════════════════════
 *  롯데 송장출력 엑셀 — 출력 탭을 그대로 파일로
 *  ★ 2026-09-09
 *
 *  > "세트분리를 하는 이유중 하나는 미리 롯데택배 송장만 출력을 하기 위함이야..
 *  >  롯데택배 텝의 내용을 복사해서 엑셀화일을 만들어 롯데 출력으로 넘겨
 *  >  송장을 프린트 하기위함인거야"
 *
 *  여태 사람이 탭을 열어 범위를 끌어 복사하고, 새 엑셀을 만들어 붙여넣고,
 *  이름을 붙여 저장했다. 매 회차마다. 그 손을 덜어 준다.
 *
 *  ★ 손대지 않고 그대로 낸다 ★
 *    열 순서·이름은 롯데 자체출력 양식과의 약속이다(SS_OUT_HEADER 19열).
 *    여기서 고치면 업로드가 통째로 튕긴다. 보이는 그대로 옮긴다.
 *
 *  ★ 「@」 서식으로 넣는다 ★
 *    우편번호·전화·송장은 앞자리 0 이 살아 있어야 한다. 숫자로 들어가면
 *    「01012345678」이 「1012345678」이 된다 — 기사가 전화를 못 건다.
 *
 *  ★ 대리발송은 안 낸다 ★
 *    출력 탭 다섯 중 대리발송은 협력업체로 가는 것이라 롯데 출력 대상이 아니다.
 *    같이 내면 남의 물건 송장을 우리가 뽑게 된다.
 * ══════════════════════════════════════════════════════════════ */

/** 롯데로 넘길 출력 탭들 — 대리발송은 뺀다 */
function _sslp_tabs_() {
  var out = [];
  for (var i = 0; i < SSIO_TABS.출력.length; i++) {
    var n = SSIO_TABS.출력[i];
    /* ★ 이름으로 비교하지 않는다 ★  (2026-09-11 택배사 바뀜)
       전에는 indexOf('롯데') === 0 이었다. 탭 이름을 로젠으로 바꾸는 순간
       아무것도 안 걸려 «조용히 0건»이 된다. 대리발송만 빼면 되는 자리다. */
    if (n !== SS_ROUTE.PARTNER) out.push(n);
  }
  return out;
}

/**
 * 롯데택배 출력 탭들을 엑셀 한 파일로 저장한다.
 * 탭마다 시트를 하나씩 만든다 — 도서산간은 운임이 달라 따로 올리기 때문이다.
 */
function ss_롯데출력엑셀() {
  var NL = String.fromCharCode(10);
  var names = _sslp_tabs_();
  var ss = ssio_ss();

  var packs = [], 총행 = 0, 도서보류 = 0, 도서나감 = 0, 조치열없음 = [];
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    if (!sh || sh.getLastRow() < 2) continue;      // 빈 탭은 시트를 만들지 않는다
    var cols = Math.max(sh.getLastColumn(), SS_OUT_HEADER.length);
    var vals = sh.getRange(1, 1, sh.getLastRow(), cols).getDisplayValues();

    /* ★ 도서산간은 체크한 것만 내보낸다 ★  (2026-09-10)
       > "도서산간분리 된것중 체크한것만 보내야되는데 … 조치 열을 만들어서"

       도서산간은 추가운임이 붙는다. 고객이 그걸 알고 동의했는지 확인하기 전에
       내보내면 나중에 운임을 못 받거나 반품이 된다. 그래서 사람이 한 번 본다.
       보류 탭의 「조치」와 같은 손버릇을 쓴다 — 새 개념을 만들지 않는다.

       ★ 조치 열이 없으면 거르지 않는다 ★
         옛 탭에는 그 열이 없다. 없는데 걸러 버리면 **도서산간이 하나도 안 나간다.**
         발주 직전에 그런 일이 나면 그게 제일 나쁘다. 열이 있을 때만 거른다. */
    var isIsland = (names[i] === SS_ROUTE.LOTTE_ISLAND ||
                    names[i] === SS_ROUTE.LOTTE_ISLAND_CONSIGN);
    if (isIsland) {
      var actCol = -1;
      for (var h = 0; h < vals[0].length; h++) {
        if (String(vals[0][h] || '').trim() === '조치') { actCol = h; break; }
      }
      if (actCol < 0) {
        조치열없음.push(names[i]);
      } else {
        var kept = [vals[0]];
        for (var r = 1; r < vals.length; r++) {
          if (String(vals[r][actCol] || '').trim()) { kept.push(vals[r]); 도서나감++; }
          else 도서보류++;
        }
        vals = kept;
        if (vals.length < 2) continue;             // 체크된 것이 하나도 없으면 시트를 안 만든다
      }
    }

    packs.push({ name: names[i], vals: vals, rows: vals.length - 1 });
    총행 += vals.length - 1;
  }
  if (!packs.length) {
    return ssio_alert('롯데 출력 탭이 모두 비어 있습니다.' + NL +
      '먼저 「▶ 세트분리 실행」 을 하세요.');
  }

  var ymd = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss');
  var fileName = '롯데송장출력_' + ymd + '.xlsx';
  var tmp = SpreadsheetApp.create('tmp_lotte_print_' + ymd);

  for (var p = 0; p < packs.length; p++) {
    var dest = (p === 0) ? tmp.getSheets()[0] : tmp.insertSheet();
    dest.setName(packs[p].name);
    var v = packs[p].vals;
    var w = 0;
    for (var r = 0; r < v.length; r++) if (v[r].length > w) w = v[r].length;
    for (var r2 = 0; r2 < v.length; r2++) while (v[r2].length < w) v[r2].push('');
    if (dest.getMaxColumns() < w) dest.insertColumnsAfter(dest.getMaxColumns(), w - dest.getMaxColumns());
    if (dest.getMaxRows() < v.length) dest.insertRowsAfter(dest.getMaxRows(), v.length - dest.getMaxRows() + 5);
    /* 앞자리 0 이 살아 있어야 한다 — 우편번호·전화·송장 */
    dest.getRange(1, 1, v.length, w).setNumberFormat('@');
    dest.getRange(1, 1, v.length, w).setValues(v);
    dest.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#1f4e78').setFontColor('white');
  }
  SpreadsheetApp.flush();

  var blob = null, xerr = '';
  try {
    var resp = UrlFetchApp.fetch(
      'https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200 && resp.getBlob().getBytes().length > 64) {
      blob = resp.getBlob().setName(fileName).setContentType(MimeType.MICROSOFT_EXCEL);
    } else { xerr = 'HTTP ' + resp.getResponseCode(); }
  } catch (e) { xerr = e && e.message ? e.message : String(e); }

  var fileUrl = '', fileId = '';
  if (blob) {
    var parent = null;
    try {
      var ps = DriveApp.getFileById(ss.getId()).getParents();
      if (ps.hasNext()) parent = ps.next();
    } catch (e2) {}
    if (!parent) parent = DriveApp.getRootFolder();
    var it = parent.getFoldersByName('롯데송장출력');
    var folder = it.hasNext() ? it.next() : parent.createFolder('롯데송장출력');
    var f = folder.createFile(blob);
    fileUrl = f.getUrl(); fileId = f.getId();
  }
  //  임시 시트는 지운다. 안 지우면 드라이브에 회차마다 쌓인다.
  try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e3) {}

  var lines = [];
  for (var q = 0; q < packs.length; q++) lines.push('  · ' + packs[q].name + '  ' + packs[q].rows + '행');
  var msg = '롯데 송장출력 엑셀' + NL + NL + lines.join(NL) + NL +
    '  합계 ' + 총행 + '행' + NL + NL;

  /* ★ 빠진 것은 크게 알린다 ★
     조용히 빠지면 「다 나간 줄」 알고 넘어간다. 도서산간은 건수가 적어서
     더 그렇다 — 몇 건 빠진 것을 아무도 못 알아챈다. */
  if (도서보류) {
    msg = '⚠ 도서산간 ' + 도서보류 + '건은 안 실었습니다 (조치 칸이 비어 있음)' + NL +
      '   확인한 건의 「조치」 칸에 아무거나 적고 다시 누르세요.' + NL +
      (도서나감 ? '   실은 도서산간: ' + 도서나감 + '건' + NL : '') + NL + msg;
  }
  if (조치열없음.length) {
    msg = '※ ' + 조치열없음.join(', ') + ' 탭에 「조치」 열이 없어 거르지 않았습니다.' + NL +
      '   세트분리를 한 번 돌리면 열이 생깁니다.' + NL + NL + msg;
  }

  if (!blob) {
    return ssio_alert(msg + '⚠ 엑셀 내보내기 실패 (' + xerr + ')' + NL +
      '탭을 직접 복사해 쓰세요.');
  }

  var dl = 'https://drive.google.com/uc?export=download&id=' + fileId;
  try {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(
        '<div style="font-family:Malgun Gothic,sans-serif;font-size:13px;line-height:1.7">' +
        '<b>' + fileName + '</b><br>' + lines.join('<br>').split('  · ').join('· ') +
        '<br>합계 ' + 총행 + '행<br><br>' +
        '<a href="' + dl + '" target="_blank" style="font-size:15px;font-weight:bold">⬇ 엑셀 다운로드</a>' +
        '&nbsp;&nbsp;<a href="' + fileUrl + '" target="_blank">드라이브에서 열기</a>' +
        '<br><br><span style="color:#666">받은 파일을 롯데 자체출력에 올려 송장을 뽑습니다.<br>' +
        '도서산간은 운임이 달라 시트가 나뉘어 있습니다.</span></div>')
        .setWidth(520).setHeight(240), '롯데 송장출력');
    return msg + fileUrl;
  } catch (eUi) {
    return ssio_alert(msg + '저장했습니다.' + NL + '  ' + fileUrl + NL + NL + '다운로드: ' + dl);
  }
}
