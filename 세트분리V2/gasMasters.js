/**
 * gasMasters.js — 외부 스프레드시트에서 마스터를 당겨와 로컬 탭에 적재한다.
 *
 * IMPORTRANGE 를 쓰지 않는다. 실패하면 예외를 던져 "값이 비었다"와 구분되게 한다.
 * (구 시트의 무성 실패 — 임포트가 끊겨도 "도서산간 아님"으로 보이던 문제)
 */

var SSM_ITEM_HEADER = ['품목코드', '품목명', '상태', '출고지', '단품배송비', '배송비규칙원문'];
var SSM_STOCK_HEADER = ['품목코드', '가용수량'];
var SSM_BOM_HEADER = ['세트코드', '세트명', '구성품코드', '소요량'];
var SSM_COND_HEADER = ['조건ID', '품목코드', '품목명(참고)', '비고'];
var SSM_EXCEPT_HEADER = ['품목코드', '사유'];
var SSM_ISL_KW_HEADER = ['시/군', '권역', '확정'];
var SSM_ISL_ZIP_HEADER = ['우편번호', '권역'];
var SSM_ISL_DICT_HEADER = ['정규주소', '우편번호', '권역', '최초확인', '메모'];
var SSM_LOCAL_HEADER = ['정규주소', '동네', '일자'];

function ssm_open(id, tab, label) {
  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { throw new Error(label + ' 스프레드시트를 열 수 없습니다 (ID: ' + id + '). 공유 권한을 확인하세요. — ' + e.message); }
  var sh = ss.getSheetByName(tab);
  if (!sh) throw new Error(label + ' 시트에 「' + tab + '」 탭이 없습니다.');
  if (sh.getLastRow() < 2) throw new Error(label + ' 「' + tab + '」 탭에 데이터가 없습니다 (' + sh.getLastRow() + '행).');
  return sh.getDataRange().getValues();
}

/**
 * 없어도 실행은 되는 원천용. 실패하면 던지지 않고 사유를 돌려준다.
 * 이카운트(품목·재고·BOM)는 필수라 ssm_open 을 그대로 쓰고,
 * 도서산간·동네배송은 이걸 써서 "못 읽었다"와 "0건이다"를 구분한다.
 */
function ssm_openOptional(id, tab, label) {
  if (!ssText(id) || !ssText(tab)) return { ok: false, why: label + ' 원천이 설정 탭에 비어 있습니다.' };
  try { return { ok: true, values: ssm_open(id, tab, label) }; }
  catch (e) { return { ok: false, why: e.message }; }
}

/** 로컬 탭에 이미 들어 있는 데이터 행 수 */
function ssm_localRows(tabName) {
  var sh = ssio_ss().getSheetByName(tabName);
  return sh ? Math.max(0, sh.getLastRow() - 1) : 0;
}

/**
 * 동네배송이 중단이면 관련 탭 2개를 숨긴다. 「사용」으로 되돌리면 다시 보인다.
 * 지우지 않으므로 언제든 설정 한 줄로 복구된다.
 */
function ssm_setLocalTabVisible(show) {
  var ss = ssio_ss();
  var names = [SSIO_TABS.동네배송, '롯데택배-동네배송'];
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    if (!sh) continue;
    try { if (show) sh.showSheet(); else sh.hideSheet(); } catch (e) {}
  }
}


/* ── 조각 갱신 — 실행 때마다 다시 읽을 수 있게 따로 뺐다 ─────── */

/** 상태·출고지 코드표 */
function ssm_codeMaps(cfg, report) {
  var statusMap = {}, originMap = {};
  var st = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_상태탭'], '이카운트');
  for (var i = 1; i < st.length; i++) if (ssText(st[i][0])) statusMap[ssText(st[i][0])] = ssText(st[i][1]);
  var og = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_출고지탭'], '이카운트');
  for (var j = 1; j < og.length; j++) if (ssText(og[j][0])) originMap[ssText(og[j][0])] = ssText(og[j][1]);
  if (report) {
    report.push(['상태코드', st.length - 1]);
    report.push(['출고지코드', og.length - 1]);
  }
  return { status: statusMap, origin: originMap };
}

/** 품목정보 + 배송비규칙 전개 (상태·출고지·단품배송비가 여기서 온다) */
function ssm_refreshItems(cfg, report, warn) {
  report = report || []; warn = warn || [];
  var maps = ssm_codeMaps(cfg, report);
  var it = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_품목정보탭'], '이카운트');
  var items = [], feeRows = [], badFee = [];
  for (var k = 1; k < it.length; k++) {
    var r = it[k];
    var code = ssText(r[0]);
    if (!code) continue;
    var statusCode = ssText(r[2]);
    var originCode = ssText(r[17]);
    var status = maps.status[statusCode];
    var origin = maps.origin[originCode];
    if (status === undefined) {
      status = statusCode;
      warn.push(['주의', 'STATUS_CODE', code, '상태코드 ' + statusCode + ' 가 상태표에 없습니다.']);
    }
    if (origin === undefined) {
      origin = originCode;
      warn.push(['주의', 'ORIGIN_CODE', code, '출고지코드 ' + originCode + ' 가 출고지표에 없습니다.']);
    }
    var raw = ssText(r[9]);
    items.push([code, ssText(r[1]), status, origin, ssNum(r[14]), raw]);
    var parsed = ssParseFeeRule(code, raw);
    for (var f = 0; f < parsed.rows.length; f++) {
      var p = parsed.rows[f];
      feeRows.push([p.code, p.qty, p.fee, p.fullBox ? 'Y' : '', p.src]);
    }
    for (var b = 0; b < parsed.bad.length; b++) {
      badFee.push(['오류', 'FEE_PARSE', code, '배송비 규칙을 해석하지 못했습니다: 「' + parsed.bad[b] + '」']);
    }
  }
  ssio_write(SSIO_TABS.M품목, SSM_ITEM_HEADER, items);
  ssio_write(SSIO_TABS.M배송비, SS_FEE_RULE_HEADER, feeRows);
  report.push(['품목정보', items.length]);
  report.push(['배송비규칙(전개)', feeRows.length]);
  report.push(['배송비규칙 해석실패', badFee.length]);
  for (var w = 0; w < badFee.length; w++) warn.push(badFee[w]);
  ssm_stamp('품목정보');
  return items.length;
}

/**
 * 재고 — 하루에도 여러 번 바뀐다.
 * 구 시트는 IMPORTRANGE 라 원천이 바뀌면 자동으로 따라왔다.
 * V2 는 실행 시점에 이 함수를 다시 불러 같은 신선도를 유지한다.
 */
function ssm_refreshStock(cfg, report, warn) {
  report = report || [];
  var sk = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_재고탭'], '이카운트');
  var stock = [];
  for (var s = 1; s < sk.length; s++) if (ssText(sk[s][0])) stock.push([ssText(sk[s][0]), ssNum(sk[s][1])]);
  ssio_write(SSIO_TABS.M재고, SSM_STOCK_HEADER, stock);
  report.push(['재고', stock.length]);
  ssm_stamp('재고');
  return stock.length;
}

/** 마스터별 마지막 갱신 시각 기록/조회 */
function ssm_stamp(name) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      'MASTER_TS_' + name,
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'));
  } catch (e) {}
}

function ssm_stampOf(name) {
  try { return PropertiesService.getScriptProperties().getProperty('MASTER_TS_' + name) || ''; }
  catch (e) { return ''; }
}

/** 갱신 시각이 몇 시간 지났는지 (모르면 -1) */
function ssm_stampAgeHours(name) {
  var s = ssm_stampOf(name);
  if (!s) return -1;
  var p = s.replace(/-/g, '/');
  var t = new Date(p).getTime();
  if (!t) return -1;
  return (new Date().getTime() - t) / 3600000;
}

/**
 * 실행 직전 갱신. 설정 「실행전_마스터갱신」 에 따라 범위가 달라진다.
 *   재고만(기본) · 재고+품목 · 전체 · 안함
 */
function ssm_refreshBeforeRun(cfg) {
  var mode = ssText(cfg['실행전_마스터갱신']) || '재고만';
  var report = [], warn = [];
  if (mode === '안함') return { mode: mode, report: report, warnings: warn };
  try {
    if (mode === '전체') {
      var r = ssm_refreshAll();
      return { mode: mode, report: r.report, warnings: r.warnings };
    }
    if (mode === '재고+품목') ssm_refreshItems(cfg, report, warn);
    ssm_refreshStock(cfg, report, warn);
  } catch (e) {
    warn.push(['오류', 'PRERUN_REFRESH', mode,
      '실행 전 마스터 갱신에 실패해 직전 값으로 계산합니다. ' + e.message]);
  }
  return { mode: mode, report: report, warnings: warn };
}

/**
 * 전체 마스터 새로고침. 각 단계의 행수를 리포트로 돌려준다.
 */
function ssm_refreshAll() {
  var cfg = ssio_config();
  var report = [];
  var warn = [];

  ssm_refreshItems(cfg, report, warn);
  ssm_refreshStock(cfg, report, warn);

  // 4) BOM
  var bm = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_BOM탭'], '이카운트');
  var bom = [];
  for (var m = 1; m < bm.length; m++) {
    var setCode = ssText(bm[m][0]);
    var comp = ssText(bm[m][4]);
    if (!setCode || !comp) continue;
    bom.push([setCode, ssText(bm[m][1]), comp, ssNum(bm[m][7]) || 1]);
  }
  ssio_write(SSIO_TABS.MBOM, SSM_BOM_HEADER, bom);
  report.push(['BOM', bom.length]);

  // 5) 도서산간 시/군 · 우편번호 — 원천이 없어도 로컬 탭을 그대로 쓴다
  var kwRes = ssm_openOptional(cfg['도서산간시트ID'], cfg['도서산간_시군탭'], '도서산간');
  if (kwRes.ok) {
    // 권역·확정 열은 사람이 관리하는 값이라 원천으로 덮어쓰지 않는다
    var kwKeep = {};
    var kwOld = ssio_body(SSIO_TABS.도서산간시군);
    for (var ko = 0; ko < kwOld.length; ko++) {
      var kk = ssText(kwOld[ko][0]);
      if (kk) kwKeep[kk] = [ssText(kwOld[ko][1]), ssText(kwOld[ko][2])];
    }
    var kws = [];
    for (var w = 1; w < kwRes.values.length; w++) {
      var v = ssText(kwRes.values[w][1]);
      if (!v) continue;
      var keep = kwKeep[v] || ['', ''];
      kws.push([v, keep[0] || ssm_guessZone(v), keep[1]]);
    }
    ssio_write(SSIO_TABS.도서산간시군, SSM_ISL_KW_HEADER, kws);
    report.push(['도서산간 시/군', kws.length]);
  } else {
    var kwHave = ssm_localRows(SSIO_TABS.도서산간시군);
    report.push(['도서산간 시/군', '건너뜀 — 기존 ' + kwHave + '행 유지']);
    warn.push([kwHave ? '주의' : '오류', 'ISLAND_SRC', cfg['도서산간_시군탭'],
      kwHave ? '원천을 못 읽어 기존 목록을 그대로 씁니다. ' + kwRes.why
             : '원천도 못 읽고 로컬 목록도 비었습니다. 「도서산간 목록 심기」를 실행하세요. ' + kwRes.why]);
  }

  var zpRes = ssm_openOptional(cfg['도서산간시트ID'], cfg['도서산간_우편번호탭'], '도서산간');
  if (zpRes.ok) {
    var zips = [];
    for (var z = 1; z < zpRes.values.length; z++) {
      var q = ssText(zpRes.values[z][0]);
      if (/^[0-9]{5}$/.test(q)) zips.push([q, ssm_zoneOfZip(q)]);
    }
    ssio_write(SSIO_TABS.도서산간우편, SSM_ISL_ZIP_HEADER, zips);
    report.push(['도서산간 우편번호', zips.length]);
  } else {
    var zpHave = ssm_localRows(SSIO_TABS.도서산간우편);
    report.push(['도서산간 우편번호', '건너뜀 — 기존 ' + zpHave + '행 유지']);
    if (!zpHave) {
      warn.push(['오류', 'ISLAND_SRC', cfg['도서산간_우편번호탭'],
        '도서산간 우편번호가 비었습니다. 「도서산간 목록 심기」를 실행하세요. ' + zpRes.why]);
    }
  }

  // 6) 금일 동네배송 — 설정에서 「중단」이면 통째로 건너뛴다 (경고도 안 낸다)
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var 동네사용 = (ssText(cfg['동네배송_사용']) === '사용');
  if (!동네사용) {
    ssio_write(SSIO_TABS.동네배송, SSM_LOCAL_HEADER, []);
    ssm_setLocalTabVisible(false);
    report.push(['금일 동네배송', '중단 (설정)']);
    // 7) 합배송조건 표 정리 + 검증 (구 시트에서 붙여넣은 #REF! 수식을 값으로 덮어쓴다)
  var tc = ssm_tidyCond();
  report.push(['합배송조건', tc.rows]);
  report.push(['  조건 수', tc.conds]);
  if (tc.missing.length) {
    warn.push(['오류', 'COND_CODE', tc.missing.slice(0, 5).join(', '),
      '합배송조건에 품목정보에 없는 코드가 ' + tc.missing.length + '건 있습니다. 「합배송조건」 D열 비고를 보세요.']);
  }
  if (tc.dup.length) {
    warn.push(['주의', 'COND_DUP', String(tc.dup.length) + '건',
      '두 개 이상 조건에 걸친 코드가 있습니다. 배송키 묶음 안에서 전용 코드가 많은 조건으로 자동 결정됩니다.']);
  }

  return { report: report, warnings: warn };
  }
  ssm_setLocalTabVisible(true);

  var loRes = ssm_openOptional(cfg['동네배송시트ID'], cfg['동네배송_탭'], '동네배송');
  if (loRes.ok) {
    var lo = loRes.values;
    var locals = [], seenL = {}, newest = '';
    for (var l = 1; l < lo.length; l++) {
      var d = lo[l][2];
      var ds = (d instanceof Date) ? Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd') : ssText(d);
      if (ds > newest) newest = ds;
      if (ds.indexOf(today) !== 0) continue;
      var a = ssNormAddr(lo[l][8]);
      if (!a || seenL[a]) continue;
      seenL[a] = true;
      locals.push([a, ssText(lo[l][1]), today]);
    }
    ssio_write(SSIO_TABS.동네배송, SSM_LOCAL_HEADER, locals);
    report.push(['금일 동네배송', locals.length]);
    if (!locals.length) {
      warn.push(['주의', 'LOCAL_STALE', cfg['동네배송_탭'],
        '오늘(' + today + ') 동네배송 자료가 없습니다. 원천의 최신 일자는 ' + (newest || '없음') +
        ' 입니다. 동네배송 건은 전부 일반 롯데 출고로 나갑니다.']);
    }
  } else {
    ssio_write(SSIO_TABS.동네배송, SSM_LOCAL_HEADER, []);
    report.push(['금일 동네배송', '건너뜀 — 원천 접근 불가']);
    warn.push(['주의', 'LOCAL_SRC', cfg['동네배송_탭'],
      '동네배송 원천을 못 읽어 동네배송 분류를 건너뜁니다. 해당 건은 일반 롯데 출고로 나갑니다. ' + loRes.why]);
  }

  // 7) 합배송조건 표 정리 + 검증 (구 시트에서 붙여넣은 #REF! 수식을 값으로 덮어쓴다)
  var tc = ssm_tidyCond();
  report.push(['합배송조건', tc.rows]);
  report.push(['  조건 수', tc.conds]);
  if (tc.missing.length) {
    warn.push(['오류', 'COND_CODE', tc.missing.slice(0, 5).join(', '),
      '합배송조건에 품목정보에 없는 코드가 ' + tc.missing.length + '건 있습니다. 「합배송조건」 D열 비고를 보세요.']);
  }
  if (tc.dup.length) {
    warn.push(['주의', 'COND_DUP', String(tc.dup.length) + '건',
      '두 개 이상 조건에 걸친 코드가 있습니다. 배송키 묶음 안에서 전용 코드가 많은 조건으로 자동 결정됩니다.']);
  }

  return { report: report, warnings: warn };
}

/**
 * 로컬 마스터 탭 → core.js 가 쓰는 자료구조
 */
function ssm_load() {
  var M = {
    items: {}, stock: {}, bom: {}, splitExcept: {},
    cond: {}, condCodes: {}, feeRules: {},
    islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {}
  };

  var it = ssio_body(SSIO_TABS.M품목);
  for (var i = 0; i < it.length; i++) {
    var c = ssText(it[i][0]); if (!c) continue;
    M.items[c] = {
      name: ssText(it[i][1]), status: ssText(it[i][2]), origin: ssText(it[i][3]),
      unitFee: ssNum(it[i][4]), feeRuleRaw: ssText(it[i][5])
    };
  }

  var sk = ssio_body(SSIO_TABS.M재고);
  for (var s = 0; s < sk.length; s++) { var sc = ssText(sk[s][0]); if (sc) M.stock[sc] = ssNum(sk[s][1]); }

  var bm = ssio_body(SSIO_TABS.MBOM);
  var setName = {};
  for (var b = 0; b < bm.length; b++) {
    var setCode = ssText(bm[b][0]), comp = ssText(bm[b][2]);
    if (!setCode || !comp) continue;
    setName[setCode] = ssText(bm[b][1]);
    (M.bom[setCode] || (M.bom[setCode] = [])).push({ code: comp, qty: ssNum(bm[b][3]) || 1 });
  }
  // 구 시트 규칙 계승 — 세트명에 "소분"이 들어가면 분해하지 않는다
  for (var key in M.bom) {
    if (!Object.prototype.hasOwnProperty.call(M.bom, key)) continue;
    if (/소분/.test(setName[key] || '')) M.splitExcept[key] = true;
  }
  var ex = ssio_body(SSIO_TABS.분리예외);
  for (var e = 0; e < ex.length; e++) { var ec = ssText(ex[e][0]); if (ec) M.splitExcept[ec] = true; }

  var fr = ssio_body(SSIO_TABS.M배송비);
  for (var f = 0; f < fr.length; f++) {
    var fc = ssText(fr[f][0]); if (!fc) continue;
    var q = String(ssNum(fr[f][1]));
    (M.feeRules[fc] || (M.feeRules[fc] = {}))[q] = { fee: ssNum(fr[f][2]), fullBox: ssText(fr[f][3]) === 'Y' };
  }

  var cd = ssio_body(SSIO_TABS.합배송조건);
  for (var d = 0; d < cd.length; d++) {
    var cond = ssText(cd[d][0]), code = ssText(cd[d][1]);
    if (!cond || !code) continue;
    var arr = M.cond[code] || (M.cond[code] = []);
    if (arr.indexOf(cond) < 0) arr.push(cond);
    (M.condCodes[cond] || (M.condCodes[cond] = {}))[code] = true;
  }

  var kw = ssio_body(SSIO_TABS.도서산간시군);
  for (var k = 0; k < kw.length; k++) {
    var kv = ssText(kw[k][0]);
    if (!kv) continue;
    M.islandKeywords.push({ kw: kv, zone: ssText(kw[k][1]) || ' 도서'.trim(), confirm: ssText(kw[k][2]) === 'Y' });
  }
  var zp = ssio_body(SSIO_TABS.도서산간우편);
  for (var z = 0; z < zp.length; z++) {
    var zv = ssText(zp[z][0]);
    if (zv) M.islandZips[zv] = ssText(zp[z][1]) || '도서';
  }

  var dc = ssio_body(SSIO_TABS.도서산간사전);
  for (var y = 0; y < dc.length; y++) {
    var a = ssText(dc[y][0]); if (!a) continue;
    var zip = ssText(dc[y][1]); if (zip) M.addrZip[a] = zip;
  }

  var lo = ssio_body(SSIO_TABS.동네배송);
  for (var l = 0; l < lo.length; l++) { var la = ssText(lo[l][0]); if (la) M.localAddrs[la] = true; }

  return M;
}

/**
 * 롯데로 나가는 주소 중 사전에 없는 것을 전부 추가한다 (우편번호는 비운 채).
 *
 * 예전에는 「도서산간 후보」만 넣었다. 그런데 후보 판정을 도시 이름으로 하다 보니
 * 여수·목포·군산 같은 육지 도시가 통째로 후보가 되어 보류가 쏟아졌다.
 * 이제는 주소마다 우편번호를 한 번씩만 구해 두고, 판정은 우편번호로만 한다.
 * 사전은 영구 캐시라 같은 주소를 두 번 조회하지 않는다.
 */
function ssm_addAddresses(units, masters, limit) {
  var sh = ssio_sheet(SSIO_TABS.도서산간사전, SSM_ISL_DICT_HEADER);
  var have = masters.addrZip || {};
  var existing = {};
  var body = ssio_body(SSIO_TABS.도서산간사전);
  for (var i = 0; i < body.length; i++) existing[ssText(body[i][0])] = true;

  var 대상 = {};
  대상[SS_ROUTE.LOTTE] = true;
  대상[SS_ROUTE.LOTTE_ISLAND] = true;
  대상[SS_ROUTE.LOTTE_ISLAND_CONSIGN] = true;
  대상[SS_ROUTE.LOTTE_LOCAL] = true;
  대상[SS_ROUTE.MERGED] = true;

  var add = [], seen = {};
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var cap = limit > 0 ? limit : 300;
  for (var j = 0; j < units.length && add.length < cap; j++) {
    var u = units[j];
    if (!대상[u.route] && u.보류사유 !== '도서산간미확인') continue;
    var a = u.정규주소;
    if (!a || existing[a] || seen[a] || have[a]) continue;
    seen[a] = true;
    add.push([a, '', '', today, '우편번호 조회 대기']);
  }
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, SSM_ISL_DICT_HEADER.length).setValues(add);
  return add.length;
}

/**
 * 롯데 요금 구분에 맞춘 권역 추정.
 * 제주(63xxx)는 「제주연계」 정액, 나머지 도서는 도선료·산간료 대상이다.
 * 목록에 산간(내륙 오지)은 없어 기본값을 「도서」로 둔다. 필요하면 탭에서 직접 고친다.
 */
function ssm_zoneOfZip(zip) {
  var z = ssText(zip);
  return (z.length === 5 && z.charAt(0) === '6' && z.charAt(1) === '3') ? '제주' : '도서';
}

function ssm_guessZone(kw) {
  return /제주|서귀포/.test(ssText(kw)) ? '제주' : '도서';
}

/* ── 합배송조건 탭 정리 ───────────────────────────────── */

/**
 * 합배송조건 탭의 C(품목명)·D(비고)를 값으로 채우고 E:F에 조건별 품목수를 쓴다.
 *
 * 구 시트에서 그대로 복사해 오면 C열에 IMPORT이카운트품목정보 를 보는 수식이 따라와
 * 신 시트에서는 #REF! 가 된다. 여기서 수식을 값으로 덮어써 없앤다.
 * 겸사겸사 이 표 자체를 검증한다 — 품목정보에 없는 코드, 두 조건에 걸친 코드.
 */
function ssm_tidyCond() {
  var sh = ssio_sheet(SSIO_TABS.합배송조건, SSM_COND_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return { rows: 0, missing: [], dup: [], conds: 0 };

  sh.getRange(1, 1, 1, SSM_COND_HEADER.length).setValues([SSM_COND_HEADER]);
  var ab = sh.getRange(2, 1, last - 1, 2).getValues();

  var items = {};
  var body = ssio_body(SSIO_TABS.M품목);
  for (var i = 0; i < body.length; i++) {
    var c = ssText(body[i][0]);
    if (c) items[c] = ssText(body[i][1]);
  }

  // 코드가 몇 개의 조건에 걸려 있는지 먼저 센다
  var owners = {}, condCount = {}, order = [];
  for (var j = 0; j < ab.length; j++) {
    var cond = ssText(ab[j][0]), code = ssText(ab[j][1]);
    if (!cond || !code) continue;
    var set = owners[code] || (owners[code] = {});
    set[cond] = true;
    if (condCount[cond] === undefined) { condCount[cond] = 0; order.push(cond); }
    condCount[cond]++;
  }

  var nameCol = [], noteCol = [], missing = [], dup = {}, blank = 0;
  for (var k = 0; k < ab.length; k++) {
    var cond2 = ssText(ab[k][0]), code2 = ssText(ab[k][1]);
    if (!cond2 || !code2) { nameCol.push(['']); noteCol.push(['']); blank++; continue; }
    var nm = items[code2];
    var note = '';
    if (nm === undefined) {
      nm = '';
      note = '품목정보에 없는 코드';
      if (missing.indexOf(code2) < 0) missing.push(code2);
    }
    var n = 0, list = [];
    for (var c2 in owners[code2]) if (Object.prototype.hasOwnProperty.call(owners[code2], c2)) { n++; list.push(c2); }
    if (n > 1) {
      note = (note ? note + ' / ' : '') + '조건 ' + n + '개 중복: ' + list.sort().join(', ');
      dup[code2] = list.sort().join(', ');
    }
    nameCol.push([nm]);
    noteCol.push([note]);
  }

  sh.getRange(2, 3, nameCol.length, 1).setValues(nameCol);
  sh.getRange(2, 4, noteCol.length, 1).setValues(noteCol);

  // E:F 조건별 품목수 (구 시트의 참고용 통계와 같은 자리)
  var stats = [];
  order.sort(function (a, b) { return condCount[b] - condCount[a]; });
  for (var s = 0; s < order.length; s++) stats.push([order[s], condCount[order[s]]]);
  var eLast = Math.min(Math.max(sh.getLastRow(), stats.length + 4), sh.getMaxRows() - 1);
  if (eLast > 0) sh.getRange(2, 5, eLast, 2).clearContent();
  sh.getRange(2, 5, 1, 2).setValues([['조건ID', '품목수']]);
  if (stats.length) sh.getRange(3, 5, stats.length, 2).setValues(stats);

  ssio_styleHeader(sh, SSM_COND_HEADER.length);
  sh.getRange(2, 5, 1, 2).setBackground('#e8eeed').setFontWeight('bold');

  var dupList = [];
  for (var d in dup) if (Object.prototype.hasOwnProperty.call(dup, d)) dupList.push(d + ' → ' + dup[d]);
  return { rows: ab.length - blank, missing: missing, dup: dupList, conds: order.length };
}

/** 메뉴에서 직접 부를 때 */
function ss_합배송조건정리() {
  var r = ssm_tidyCond();
  var msg = '합배송조건 정리 완료\n\n' +
    '  · 행 : ' + r.rows + '\n' +
    '  · 조건 : ' + r.conds + '개\n' +
    '  · 품목정보에 없는 코드 : ' + r.missing.length + '건\n' +
    '  · 두 개 이상 조건에 걸친 코드 : ' + r.dup.length + '건';
  if (r.missing.length) msg += '\n\n[없는 코드]\n  ' + r.missing.slice(0, 15).join('\n  ');
  if (r.dup.length) msg += '\n\n[중복 코드]\n  ' + r.dup.slice(0, 15).join('\n  ');
  msg += '\n\n※ 중복 코드는 배송키 묶음 안에서 전용 코드가 많은 조건으로 자동 결정됩니다.';
  return ssio_alert(msg);
}

/* ── 판매현황 입력 ─────────────────────────────────────── */

/**
 * 판매현황을 읽어 온다.
 *
 * 「판매현황_원천시트ID」가 있으면 그 시트에서 읽고, 이 시트의 판매현황 탭에 그대로 비춘다.
 * 비추는 이유는 두 가지 — 무엇을 계산했는지 눈으로 확인할 수 있고, 원천이 나중에 바뀌어도
 * 이 회차에 쓴 자료가 시트에 남는다.
 *
 * IMPORTRANGE 가 아니라 실행 시점 openById 다. 못 읽으면 조용히 빈 값이 되는 대신 멈춘다.
 */
function ssm_readSales(cfg) {
  var srcId = ssText(cfg['판매현황_원천시트ID']);
  if (!srcId) {
    return { grid: ssio_values(SSIO_TABS.입력), 원천: '이 시트', 행: 0 };
  }

  var ss;
  try { ss = SpreadsheetApp.openById(srcId); }
  catch (e) {
    throw new Error('판매현황 입력 시트를 열 수 없습니다 (ID: ' + srcId + ').\n' +
      '공유 권한을 확인하거나 「설정」의 판매현황_원천시트ID 를 비우고 이 시트에 직접 붙여넣으세요.\n' + e.message);
  }

  var tabName = ssText(cfg['판매현황_원천탭']) || '판매현황';
  var sh = ss.getSheetByName(tabName) || ss.getSheets()[0];
  if (!sh) throw new Error('판매현황 입력 시트에 탭이 없습니다.');
  if (sh.getLastRow() < 2) {
    throw new Error('판매현황 입력 시트 「' + ss.getName() + ' / ' + sh.getName() + '」 가 비어 있습니다.\n' +
      '이카운트 판매현황을 붙여넣은 뒤 다시 실행하세요.');
  }

  var grid = sh.getDataRange().getValues();

  // 이 시트에 그대로 비춰 둔다
  var mirror = ssio_sheet(SSIO_TABS.입력, SS_SALES_COLS);
  ssio_clearBody(mirror);
  var cols = 0;
  for (var r = 0; r < grid.length; r++) if (grid[r].length > cols) cols = grid[r].length;
  if (cols > mirror.getMaxColumns()) mirror.insertColumnsAfter(mirror.getMaxColumns(), cols - mirror.getMaxColumns());
  if (grid.length > mirror.getMaxRows()) mirror.insertRowsAfter(mirror.getMaxRows(), grid.length - mirror.getMaxRows() + 10);
  var padded = [];
  for (var g = 0; g < grid.length; g++) {
    var row = grid[g].slice();
    while (row.length < cols) row.push('');
    padded.push(row);
  }
  mirror.getRange(1, 1, padded.length, cols).setValues(padded);

  return { grid: grid, 원천: ss.getName() + ' / ' + sh.getName(), 행: grid.length };
}

/** 입력 시트를 비운다 (붙여넣기 전에) */
function ssm_clearSales(cfg) {
  var srcId = ssText(cfg['판매현황_원천시트ID']);
  if (!srcId) {
    ssio_clearBody(ssio_sheet(SSIO_TABS.입력, SS_SALES_COLS));
    return '이 시트의 판매현황 탭';
  }
  var ss = SpreadsheetApp.openById(srcId);
  var sh = ss.getSheetByName(ssText(cfg['판매현황_원천탭']) || '판매현황') || ss.getSheets()[0];
  if (sh.getLastRow() > 0) sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearContent();
  return ss.getName() + ' / ' + sh.getName();
}

/** 입력 시트 준비 — 탭 이름을 맞추고 링크를 알려준다 */
function ss_입력시트준비() {
  var cfg = ssio_config();
  var srcId = ssText(cfg['판매현황_원천시트ID']);
  if (!srcId) return ssio_alert('「설정」의 판매현황_원천시트ID 가 비어 있습니다.\n이 시트의 판매현황 탭에 직접 붙여넣는 방식입니다.');
  var ss = SpreadsheetApp.openById(srcId);
  var want = ssText(cfg['판매현황_원천탭']) || '판매현황';
  var sh = ss.getSheetByName(want);
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName(want);
  }
  sh.setFrozenRows(2);
  return ssio_alert('판매현황 입력 시트 준비 완료\n\n' +
    '  ' + ss.getName() + ' / ' + sh.getName() + '\n' +
    '  ' + ss.getUrl() + '\n\n' +
    '이카운트 판매현황 엑셀을 1행부터 그대로 붙여넣으세요.\n' +
    '(1행 회사명, 2행 헤더인 원본 그대로도 됩니다)');
}
