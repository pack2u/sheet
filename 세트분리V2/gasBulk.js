/**
 * gasBulk.js — 사방넷 송장대량등록. 허브 `_po_rebuildSabangnetBulkUpload_` 의 포팅이다.
 *
 * 회차 하나가 아니라 원천을 직접 훑어 (주문번호, 송장) 쌍을 전부 뽑는다.
 * 세트분리 한 회차의 결과만 고르면 하루치가 안 나온다.
 *
 * 원천 여섯 (허브와 같은 순서·같은 우선순위):
 *   1. 대리공급_임시기록   상품정보  P=주문번호 X=송장 W=업체prefix
 *   2. 협력업체_발주허브   상품정보  C=주문번호 N=송장  B=업체
 *   3. 자사출고            거래관리  머리글을 찾아 읽는다 → 탭이 곧 택배사
 *   4. 주문라인원장        전파가 채운 운송장번호 (대상일수를 따른다)
 *   5. 대리공급_임시기록_보관  상품정보  R=주문번호 Z=송장 Y=업체prefix — 마감이 옮긴 것
 *   6. 송장원장            상품정보  출처(전용마감:업체·발주마감:업체) + 송장 + 고유ID
 *
 * ★ 5·6 이 없으면 «마감이 먼저 돈 날» 이 통째로 빠진다 ★  (2026-09-12)
 *   마감은 송장이 찍힌 행만 골라 1·2 에서 지운다 — 올려야 할 것만 사라진다.
 *
 * 그리고 원천을 다 모은 뒤 한 단계가 더 있다:
 *   7. 합포장 전파 — 대표의 송장을 «동봉 형제의 사방넷 번호»에도 붙인다
 *
 * ★ 7 이 없으면 한 박스에 담은 열 건 중 «대표 하나»만 올라간다 ★  (2026-09-13)
 *   로젠에 올리는 건 대표뿐이라 송장도 대표에게만 온다. 사방넷 주문번호는
 *   열 건이 저마다 다르니 같은 송장을 아홉 번 더 적어 줘야 등록이 된다.
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
/**
 * ══════════════════════════════════════════════════════════════
 *  자사출고 송장탭의 «머리글 줄»을 찾는다
 *  2026-09-11
 *
 *  ★ 머리글이 1행에 있다고 믿으면 안 된다 ★
 *    입력_로젠주문실적은 1행이 제목이다 —
 *      「주문등록_출력(복수건)_출력완료(645)건」
 *    머리글은 2행이고 자료는 3행부터다.
 *    1행만 보면 이름을 못 찾아 «고정 자리»로 떨어지는데, 그 고정 자리가
 *    로젠에서는 엉뚱한 칸이라 한 줄도 안 걸렸다. 오류는 안 나고
 *    「0행」만 나온다 — 그래서 385건이 91건이 됐다.
 *
 *    롯데 탭도 머리글이 1~2행에 걸쳐 병합돼 있다. 이름으로 찾으면 둘 다 맞다.
 *
 *  @return {{row:number, head:Array, uid:number, inv:number, date:number}}
 *          row 은 1부터 센 시트 행번호. 못 찾으면 row = 0.
 */
/** 0 → A, 18 → S */
function ssb_col(i) {
  if (i < 0) return '-';
  var n = i + 1, o = '';
  while (n > 0) { var r = (n - 1) % 26; o = String.fromCharCode(65 + r) + o; n = Math.floor((n - 1) / 26); }
  return o + '(' + i + ')';
}

function ssb_findHeader(tab, 볼줄) {
  볼줄 = 볼줄 || 6;
  var lastRow = tab.getLastRow();
  if (lastRow < 2) return { row: 0, head: [], uid: -1, inv: -1, date: -1 };
  var wid = tab.getLastColumn();
  var v = tab.getRange(1, 1, Math.min(볼줄, lastRow), wid).getDisplayValues();
  for (var r = 0; r < v.length; r++) {
    var uid = -1, inv = -1, date = -1;
    for (var c = 0; c < v[r].length; c++) {
      var h = ssText(v[r][c]).split(' ').join('');
      if (!h) continue;
      if (uid < 0 && (h === '주문번호' || h === '고객주문번호')) uid = c;
      if (inv < 0 && (h === '운송장번호' || h === '송장번호')) inv = c;
      /* 날짜 — 롯데는 「집하일자」, 로젠은 그런 칸이 아예 없고
         「파일명」이 20260911.xls 처럼 날짜를 담고 있다. */
      if (date < 0 && (h.indexOf('집하일') >= 0 || h.indexOf('발송일') >= 0 ||
                       h.indexOf('출고일') >= 0 || h.indexOf('등록일') >= 0 ||
                       h === '파일명')) date = c;
    }
    //  둘 다 있어야 머리글이다. 하나만 있으면 자료 줄일 수 있다.
    if (uid >= 0 && inv >= 0) {
      return { row: r + 1, head: v[r], uid: uid, inv: inv, date: date };
    }
  }
  return { row: 0, head: [], uid: -1, inv: -1, date: -1 };
}

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
  if (seenOrd && seenOrd[o]) {
    /* 「645장인데 477줄」의 답이 여기다. 세어서 화면에 보여 주지 않으면
       볼 때마다 무엇이 없어졌는지 찾아야 한다. */
    res.skipMultiBox = (res.skipMultiBox || 0) + 1;
    return 0;
  }
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

/**
 * 합포장 동봉에게 대표의 송장을 붙인다.
 *
 * @param {Array}  rows   지금까지 모은 [주문번호, 송장, '', '', 코드] 들
 * @param {Object} 박스   합포장그룹 → { rep: 대표주문번호, kids: [동봉…] }
 * @returns {number} 새로 붙인 행 수
 *
 * 시트를 안 만진다 — 받은 것만 보고 판단한다. 그래야 시험할 수 있다.
 */
function ssb_spreadMerged(rows, seen, 박스, res, uidSeen, seenOrd) {
  var 송장of = {}, n7 = 0;
  for (var ri = 0; ri < rows.length; ri++) {
    if (송장of[rows[ri][0]] === undefined) {
      송장of[rows[ri][0]] = { inv: rows[ri][1], code: rows[ri][4] };
    }
  }
  /* ★ 동봉 형제의 «행방»을 전부 센다 ★  (2026-09-14)
       「17박스 → 39」만 찍어 놓으니, 동봉이 83명인데 39명만 붙은 날
       나머지 44명이 어디로 갔는지 화면이 답을 못 했다. 사람이 또 원장을
       손으로 열어 봐야 했다 — 이 기능이 없애려던 바로 그 수고다.
       kids = noRep + own + drop + spread 로 «반드시 맞아떨어지게» 센다. */
  res.mergeSpread = 0; res.mergeNoRep = 0; res.mergeBoxes = 0;
  res.mergeKids = 0; res.mergeOwn = 0; res.mergeDrop = 0; res.mergeNoRepBoxes = 0;
  for (var gk in 박스) {
    if (!Object.prototype.hasOwnProperty.call(박스, gk)) continue;
    var 박 = 박스[gk];
    if (!박.rep || !박.kids.length) continue;
    res.mergeBoxes++;
    var 대표송장 = 송장of[박.rep];
    /* 로젠이 아직 대표 송장을 안 줬으면 동봉도 붙일 데가 없다.
       조용히 빠지면 2026-09-12 이 그대로 되풀이된다 — 세어서 알린다. */
    res.mergeKids += 박.kids.length;
    if (!대표송장) {
      res.mergeNoRep += 박.kids.length; res.mergeNoRepBoxes++;
      if (!res.mergeNoRepByRound) res.mergeNoRepByRound = {};
      var rkk = 박.rk || '(회차없음)';
      res.mergeNoRepByRound[rkk] = (res.mergeNoRepByRound[rkk] || 0) + 박.kids.length;
      /* ★ «어느» 박스인지 말한다 ★  (2026-09-14)
         「8박스」라고만 하면 사람이 원장을 처음부터 훑어야 한다. 이 기능이
         없애려던 수고가 정확히 그것이다. 대표 주문번호를 몇 개 들려 보낸다 —
         그것으로 원장·로젠탭을 바로 찾을 수 있다. */
      if (!res.mergeNoRepSamples) res.mergeNoRepSamples = [];
      if (res.mergeNoRepSamples.length < 5) {
        res.mergeNoRepSamples.push(박.rep + '(동봉' + 박.kids.length +
          (박.rk ? ' · ' + 박.rk + '회차' : '') + ')');
      }
      continue;
    }
    for (var ki = 0; ki < 박.kids.length; ki++) {
      var 아이 = 박.kids[ki];
      if (seenOrd && seenOrd[아이]) { res.mergeOwn++; continue; }   // 제 송장으로 이미 잡혔다
      var 붙음 = ssb_addRows(rows, seen, 아이, 대표송장.inv, 대표송장.code,
        res, uidSeen, seenOrd);
      /* 붙음이 0 이면 ssb_addRows 가 걸렀다 — 사방넷 번호가 아니거나
         택배사 코드를 모르는 것이다. 어느 쪽인지는 skipGen·skipNoCode 가 센다. */
      if (!붙음) res.mergeDrop++;
      n7 += 붙음; res.mergeSpread += 붙음;
    }
  }
  return n7;
}

/**
 * 동봉 형제의 행방을 «네 줄»로 적는다. 진단과 저장이 같은 문장을 쓴다.
 *
 * ★ 왜 함수로 빼나 ★
 *   진단에는 이 표가 아예 없었고 저장에는 mergeNoRep 한 줄만 있었다.
 *   두 화면이 다른 말을 하면, 진단에서 멀쩡해 보이던 것이 저장에서 달라진다.
 *   한 곳에서 만들어 둘 다 쓰면 어긋날 수가 없다.
 */
function ssb_mergeLines(res, NL) {
  if (!res || !res.mergeKids) return '';
  var L = [];
      L.push('      붙었다              : ' + (res.mergeSpread || 0) + '명');
  if (res.mergeOwn) {
      L.push('      제 송장으로 이미 잡힘 : ' + res.mergeOwn + '명   (빠진 게 아닙니다)');
  }
  if (res.mergeNoRep) {
      L.push('    ⚠ 대표 송장이 아직 없음 : ' + res.mergeNoRep + '명' +
             ' (' + (res.mergeNoRepBoxes || 0) + '박스)   ← 이 만큼이 사방넷에서 빠집니다');
    if (res.mergeNoRepByRound) {
      var rl = [];
      for (var rr in res.mergeNoRepByRound) {
        if (Object.prototype.hasOwnProperty.call(res.mergeNoRepByRound, rr)) {
          rl.push(rr + ' ' + res.mergeNoRepByRound[rr] + '명');
        }
      }
      rl.sort();
      if (rl.length) L.push('        회차별 : ' + rl.join(' · '));
    }
    if (res.mergeNoRepSamples && res.mergeNoRepSamples.length) {
      L.push('        그 대표 주문번호 : ' + res.mergeNoRepSamples.join(' · ') +
             (res.mergeNoRepBoxes > res.mergeNoRepSamples.length ? ' …' : ''));
    }
  }
  if (res.mergeDrop) {
      L.push('    ⚠ 사방넷 번호가 아니거나 택배사 코드를 모름 : ' + res.mergeDrop + '명');
  }
  return L.join(NL) + NL;
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
  var n1 = 0, n2 = 0, n3 = 0, n4 = 0, n5 = 0, n6 = 0, n7 = 0;
  var errs = [];
  var scan = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, s6: 0 };
  /* 합포장그룹 → { rep: 대표주문번호, kids: [동봉주문번호…] }
     원장을 훑으며 채우고, 마지막에 대표의 송장을 동봉에게 붙인다(7). */
  var 박스 = {};
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
    { 이름: '로젠', gid: ssNum(cfg['로젠송장탭GID']) || 548505068, uid: 18, inv: 3, code: SSB_ROZEN_CODE },
    { 이름: '롯데', gid: ssNum(cfg['롯데송장탭GID']) || 1575029201, uid: 8, inv: 6, code: SSB_LOTTE_CODE },
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

      /* 머리글을 «찾는다». 1행에 있다고 믿지 않는다 (ssb_findHeader 설명) */
      var H = ssb_findHeader(lTab);
      if (!H.row) {
        res.자사탭.push(편.이름 + ' 머리글 못 찾음');
        errs.push('자사출고 ' + 편.이름 + ' 탭: 「주문번호」·「운송장번호」 머리글을 못 찾았습니다');
        continue;
      }
      var ci = H.uid, cw = H.inv, dCol = H.date;
      var lwid = Math.max(lTab.getLastColumn(), Math.max(ci, cw) + 1);

      /* 어느 칸을 읽었는지 남긴다 — 탭 서식이 바뀌면 여기부터 본다 */
      if (oi === 0) res.lotteCols = [];
      res.lotteCols.push(편.이름 + ' 머리글 ' + H.row + '행 · 주문번호 ' + ssb_col(ci) +
        ' · 운송장 ' + ssb_col(cw) +
        ' · 날짜 ' + (dCol >= 0 ? ssb_col(dCol) + '(' + ssText(H.head[dCol]) + ')' : '없음 → 날짜로 안 거름'));

      var lv = lTab.getRange(H.row + 1, 1, lTab.getLastRow() - H.row, lwid).getDisplayValues();
      var n편 = 0;
      for (var k = 0; k < lv.length; k++) {
        if (!ssText(lv[k][ci]) || !ssText(lv[k][cw])) continue;
        /* 날짜 칸이 없는 탭은 날짜로 거르지 않는다 — 엉뚱한 칸을 날짜로
           읽느니 다 넣고 중복 제거에 맡기는 편이 낫다. */
        if (dCol >= 0 && !ssb_keepDate(lv[k][dCol], allowed, res)) continue;
        scan.s3++;
        var n어 = ssb_addRows(rows, seen, lv[k][ci], lv[k][cw], 편.code, res, uidSeen, seenOrd);
        n3 += n어; n편 += n어;
      }
      res.자사탭.push(편.이름 + ' ' + n편 + '행');
    } catch (eL) { errs.push('자사출고 ' + 편.이름 + ' 탭: ' + String(eL.message || eL)); }
  }

  /* ── 4. 주문라인원장 — 전파가 채운 운송장번호 (합포장 동봉 포함) ──
     ★ 「오늘 회차만」이었다 ★  (2026-09-13 고침)
       회차키는 YYMMDD-N 이다. 여태 앞 6자리로 «오늘»만 골랐는데,
       로젠 송장을 밤에 받아 다음 날 아침에 저장하면 어제 회차가 통째로
       빠졌다 — 다른 원천은 전부 「대량등록_대상일수」를 따르는데
       여기만 혼자 달랐고, 그 말이 어디에도 없었다.
       이제 같은 설정을 따른다. 「전체」일 때만 최근 15일로 자른다
       (원장은 날마다 쌓이므로 두 달치를 다시 올릴 이유가 없다). */
  var 원장하한6 = Utilities.formatDate(
    new Date(new Date().getTime() - 15 * 86400000), 'Asia/Seoul', 'yyMMdd');
  var 회차볼까 = function (rk) {
    var day = ssText(rk).substring(0, 6);
    if (!day) return true;                    // 회차키가 없으면 거르지 않는다
    return allowed ? !!allowed['20' + day] : (day >= 원장하한6);
  };
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
        if (rk && !회차볼까(rk)) continue;
        var uid4 = ssText(gv[g][ix['고유ID']]);
        var inv4 = ssText(gv[g][ix['운송장번호']]);
        /* ★ 합포장 짝은 «송장이 없어도» 모은다 ★
           동봉 줄은 전파를 안 돌리면 운송장번호가 비어 있다. 아래 줄에서
           같이 걸러 버리면 짝을 영영 못 짓는다 — 7번이 이것을 쓴다. */
        if (uid4 && ix['합포장그룹'] !== undefined) {
          var grp4 = ssText(gv[g][ix['합포장그룹']]);
          if (grp4) {
            var 박4 = 박스[grp4] || (박스[grp4] = { rep: '', kids: [], rk: '' });
            /* ★ 회차를 들고 다닌다 ★  (2026-09-14)
               대표 송장이 없다고 알려도, 그게 «오늘 아직 안 온 것»인지
               «지난 회차에서 빠진 것»인지 모르면 사람이 또 원장을 찾아야 한다.
               앞의 것은 기다리면 되고 뒤의 것은 사고다 — 전혀 다른 이야기다. */
            if (!박4.rk && rk) 박4.rk = rk;
            if (ix['합포장대표'] !== undefined && ssText(gv[g][ix['합포장대표']]) === 'Y') 박4.rep = uid4;
            else 박4.kids.push(uid4);
          }
        }
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

  /* ── 5. 대리공급_임시기록_보관 — «마감이 옮겨 놓은» 대리공급 건 ──────
     ★ 마감이 먼저 돌면 1번 원천이 비어 있다 ★  (2026-09-12)
       > "사방넷 송신 엑셀에서 대리공급 마감으로 넘어간건 인식 안하지?"

       대리공급 마감(허브 _po_clearTempTabInvoicedRowsOnly_)은 «송장이 찍힌
       행»을 임시기록에서 지우고 보관탭으로 옮긴다. 지우는 조건이 「송장이
       있는 것」이라, 정작 사방넷에 올려야 할 행만 골라 사라진다.
       읽는 쪽이 원본만 보면 그 건은 오류 한 줄 없이 0건으로 빠진다.

       보관탭은 앞에 2열(보관일시·보관사유)이 더 붙었을 뿐 나머지는 같다.
       중복은 주문번호+송장으로 이미 막혀 있어 겹쳐 읽어도 안전하다.
       보관은 14일치만 남으므로 이 표가 커질 일도 없다. */
  var 보관오프셋 = 2;   // 허브 _PO_TEMP_ARCHIVE_COL_OFFSET_ 과 같은 값
  var r5 = ssm_openOptional(cfg['이카운트시트ID'],
    cfg['대리공급_보관탭'] || '대리공급_임시기록_보관', '상품정보');
  if (r5.ok) {
    for (var m = 1; m < r5.values.length; m++) {
      var uid5 = ssText(r5.values[m][15 + 보관오프셋]);
      var inv5 = ssText(r5.values[m][23 + 보관오프셋]);
      if (!uid5 || !inv5) continue;
      if (!ssb_keepDate(r5.values[m][2 + 보관오프셋], allowed, res)) continue;
      var pfx5 = ssText(r5.values[m][22 + 보관오프셋]);
      if (!pfx5) pfx5 = ssText(r5.values[m][3 + 보관오프셋]).substring(0, 2);
      var code5 = ssb_codeForVendor(t, pfx5);
      if (!code5) { if (ssIsSabangnetUid(uid5)) ssb_noCode(res, pfx5); continue; }
      scan.s5++; n5 += ssb_addRows(rows, seen, uid5, inv5, code5, res, uidSeen, seenOrd);
    }
  } else { errs.push('임시기록보관: ' + r5.why); }

  /* ── 6. 송장원장 — 마감돼 «발주허브에서 사라진» 협력업체 발주 건 ──────
     발주허브(2번)도 같은 일을 당한다. 아카이브될 때
     허브 _pea_clearHubRowsByUids_ 가 그 행을 지운다.
     다만 옮겨 간 곳이 업체 파일 여러 개 + 월별 아카이브라 여기서 직접
     훑을 수가 없다 — 열어야 할 스프레드시트가 수십 개다.

     대신 허브의 「송장원장」(_partnerInvoiceLedger.gs)이 «사라지는 것»만
     골라 60일치 누적해 둔다. 만들어 둔 이유가 바로 이것이다.

     택배사는 «출처»에서 읽는다 — 「전용마감:올팩」·「발주마감:올팩」 처럼
     업체명이 콜론 뒤에 붙는다.
       임시기록 · 임시기록보관 → 1·5 가 이미 본다 (콜론이 없다)
       허브아카이브:202609    → 업체명이 없어 택배사를 못 정한다. 세기만 한다. */
  /* ★ 송장원장만은 대상일수와 별개로 최근 15일까지만 본다 ★
     원장은 60일치다. 대상일수가 「전체」일 때 그것을 다 얹으면 이미 올라간
     두 달치가 통째로 다시 올라가고, 사방넷은 그것을 「건별 미매칭」으로
     되돌린다 — 없는 것만 못한 결과다. 마감과 저장 사이의 틈은 하루이틀이지
     두 달이 아니다. 15일은 보관탭 보존(14일)과 같은 눈금이다. */
  var 원장하한 = Utilities.formatDate(
    new Date(new Date().getTime() - 15 * 86400000), 'Asia/Seoul', 'yyyyMMdd');
  var r6 = ssm_openOptional(cfg['이카운트시트ID'],
    cfg['송장원장탭'] || '송장원장', '상품정보');
  res.ledgerNoVendor = 0;
  if (r6.ok && r6.values.length > 1) {
    var h6 = r6.values[0], i6 = {};
    for (var z = 0; z < h6.length; z++) {
      var hn6 = ssText(h6[z]);
      if (hn6 && i6[hn6] === undefined) i6[hn6] = z;
    }
    if (i6['출처'] === undefined || i6['송장번호'] === undefined || i6['고유ID'] === undefined) {
      errs.push('송장원장: 「출처·송장번호·고유ID」 머리글을 못 찾았습니다');
    } else {
      for (var y = 1; y < r6.values.length; y++) {
        var src6 = ssText(r6.values[y][i6['출처']]);
        var 콜론 = src6.indexOf(':');
        if (콜론 < 0) continue;                       // 임시기록 계열 — 1·5 가 본다
        var 종류6 = src6.substring(0, 콜론);
        var 업체6 = src6.substring(콜론 + 1);
        if (종류6 !== '전용마감' && 종류6 !== '발주마감') { res.ledgerNoVendor++; continue; }
        var uid6 = ssText(r6.values[y][i6['고유ID']]);
        var inv6 = ssText(r6.values[y][i6['송장번호']]);
        if (!uid6 || !inv6) continue;
        if (i6['주문일'] !== undefined) {
          var dk6 = ssb_dateKey(r6.values[y][i6['주문일']]);
          if (dk6 && dk6 < 원장하한) { res.skipOld++; continue; }
          if (!ssb_keepDate(r6.values[y][i6['주문일']], allowed, res)) continue;
        }
        var code6 = ssb_codeForVendor(t, 업체6);
        if (!code6) { if (ssIsSabangnetUid(uid6)) ssb_noCode(res, 업체6); continue; }
        scan.s6++; n6 += ssb_addRows(rows, seen, uid6, inv6, code6, res, uidSeen, seenOrd);
      }
    }
  } else if (!r6.ok) { errs.push('송장원장: ' + r6.why); }

  /* ── 7. 합포장 전파 — 동봉 형제에게 «대표의 송장»을 붙인다 ──────────
     ★ 「전파를 먼저 눌렀겠지」에 기대면 안 된다 ★  (2026-09-13)
       > "대표의 송장번호가 나머지 사방넷 번호에도 같이 붙어 줘야
          사방넷 번호마다 송장번호 대량등록이 가능해"
       > "송장번호도 10개 모두 대표 송장 번호로 입력시켜줘야 되는거야"

       합포장은 열 건까지 한 박스에 담아 송장 «한 장»으로 내보낸다.
       로젠에 올라가는 것은 대표 한 건뿐이라, 로젠이 돌려주는 송장도
       대표 주문번호에만 붙는다. 그런데 사방넷 주문번호는 열 건이 저마다
       다르다 — 같은 송장을 아홉 번 더 적어 줘야 등록이 된다.

       원장에 그 짝(합포장그룹·합포장대표)이 이미 있다. 「송장 전파」를
       돌리면 원장의 동봉 줄에도 송장이 채워지지만, 안 돌리면 안 채워진다.
       2026-09-12 이 정확히 그랬다 — 동봉 83줄, 송장매칭 전부 빈칸.
       대표 17건만 사방넷에 올라가고 나머지 83건이 통째로 빠졌는데
       어디에도 그 말이 없었다.

       그래서 여기서 «그 자리에서» 짝을 지어 붙인다. 전파를 돌렸든 말든
       결과가 같아진다. 겹치면 주문번호+송장이 이미 막는다.

     ★ 대표 송장을 못 찾으면 «세어서 알린다» ★
       로젠이 아직 대표 송장을 안 줬으면 동봉도 붙일 데가 없다.
       그때 조용히 빠지면 오늘 일이 그대로 되풀이된다. */
  n7 = ssb_spreadMerged(rows, seen, 박스, res, uidSeen, seenOrd);

  var uidCount = 0;
  for (var uk in uidSeen) if (Object.prototype.hasOwnProperty.call(uidSeen, uk)) uidCount++;
  return { rows: rows, res: res, errs: errs, scan: scan, uidCount: uidCount,
    allowed: allowed,
    n1: n1, n2: n2, n3: n3, n4: n4, n5: n5, n6: n6, n7: n7 };
}

function ss_사방넷엑셀저장() {
  var NL = String.fromCharCode(10);
  var C = ssb_collect();
  var rows = C.rows, res = C.res, errs = C.errs;
  var n1 = C.n1, n2 = C.n2, n3 = C.n3, n4 = C.n4, n5 = C.n5, n6 = C.n6, n7 = C.n7;
  if (!rows.length) {
    return ssio_alert('저장할 자료가 없습니다.' + NL + NL +
      (errs.length ? errs.join(NL) : '원천 여섯 곳 모두에서 송장을 찾지 못했습니다.'));
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
    '  · 저장 행 : ' + rows.length + '건' +
    (res.skipMultiBox ? '   (송장 ' + (rows.length + res.skipMultiBox) + '장 → 주문 ' +
      rows.length + '건)' : '') + NL + codeLines.join(NL) + NL +
    '  · 원천 · 임시기록 ' + n1 + ' / 발주허브 ' + n2 +
    ' / 자사출고 ' + n3 + ' / 원장 ' + n4 +
    ' / 임시기록보관 ' + n5 + ' / 송장원장 ' + n6 +
    ' / 합포장 전파 ' + n7 +
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
  if (res.mergeKids) {
    msg += NL + '  [합포장 동봉 ' + res.mergeKids + '명의 행방]' + NL +
      ssb_mergeLines(res, NL);
  }
  if (res.mergeNoRep) {
    msg += NL + '    로젠에서 그 박스의 대표 송장이 돌아온 뒤 다시 저장하세요.';
  }
  if (res.skipMultiBox) {
    msg += NL + '  · 같은 주문의 둘째 박스부터 제외 : ' + res.skipMultiBox + '장' + NL +
      '    사방넷은 주문 하나에 송장 하나만 받습니다 — 대표 한 장만 올립니다.' + NL +
      '    (원장·일일마감·CS 조회에는 스무 장이 다 들어 있습니다)';
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
    '    원장       ' + C.scan.s4 + ' → ' + C.n4 + NL +
    '    임시기록보관 ' + C.scan.s5 + ' → ' + C.n5 + '   ← 마감이 옮긴 대리공급' + NL +
    '    송장원장   ' + C.scan.s6 + ' → ' + C.n6 + '   ← 마감된 협력업체 발주' + NL +
    '    합포장 전파 ' + (C.res.mergeBoxes || 0) + '박스 → ' + C.n7 +
    '   ← 대표 송장을 동봉 형제에게' + NL +
    ssb_mergeLines(C.res, NL) +
    '    ※ 채택이 적은 건 앞 원천에서 이미 잡힌 중복입니다.' + NL + NL +
    '  · 같은 주문의 둘째 박스부터 제외 : ' + (C.res.skipMultiBox || 0) + '장  (사방넷은 주문당 송장 하나)' + NL +
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
