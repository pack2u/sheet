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
/*  이카운트코드 한 줄이면 그 품목은 늘 대리발송이다.
    업체코드는 비워도 된다 — 푸시가 품목 앞 두 글자로도 업체를 가린다. */
var SSM_PARTNER_ITEM_HEADER = ['이카운트코드', '업체코드', '사유'];
var SSM_ISL_KW_HEADER = ['시/군', '권역', '확정'];
var SSM_ISL_ZIP_HEADER = ['우편번호', '권역'];
var SSM_ISL_DICT_HEADER = ['정규주소', '우편번호', '권역', '최초확인', '메모'];

function ssm_open(id, tab, label) {
  // 열기뿐 아니라 읽기까지 감싼다.
  // 구글은 열 때는 통과시키고 실제로 값을 읽을 때 권한 오류를 내는 경우가 있어,
  // 그러면 「요청한 문서를 액세스할 권한이 없습니다」 만 덩그러니 남고 어느 시트인지 알 수 없다.
  var where = label + ' / ' + tab + ' (ID: ' + id + ')';
  try {
    var ss = SpreadsheetApp.openById(id);
    var sh = ss.getSheetByName(tab);
    if (!sh) throw new Error('「' + tab + '」 탭이 없습니다.');
    if (sh.getLastRow() < 2) throw new Error('데이터가 없습니다 (' + sh.getLastRow() + '행).');
    return sh.getDataRange().getValues();
  } catch (e) {
    throw new Error(where + ' — ' + e.message);
  }
}

/**
 * 없어도 실행은 되는 원천용. 실패하면 던지지 않고 사유를 돌려준다.
 * 이카운트(품목·재고·BOM)는 필수라 ssm_open 을 그대로 쓰고,
 * 도서산간은 이걸 써서 "못 읽었다"와 "0건이다"를 구분한다.
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
 * 실행 직전 갱신 — **늘 전부 읽는다.** 고를 것이 없다.  (2026-09-10)
 *
 * > "이전 시트에서는 임포트로 자동으로 불러오게 되있었는데 굳이 설정을
 * >  누르는 불편함을 감수해야 할까? 안누르면 오류가 발생하는데"
 *
 * 전에는 「실행전_마스터갱신」 으로 범위를 골랐다. 빠르라고 만든 손잡이인데
 * 안 돌려 놓으면 조용히 틀렸다 — 신상품이 들어온 날 「재고만」이면 그 주문이
 * 품목누락으로 보류에 빠진다. 구 시트는 IMPORTRANGE 라 그런 일이 없었다.
 * 사람이 기억해야만 맞는 구조는 언젠가 틀린다. 골라야 할 일을 없앴다.
 *
 * 읽다가 실패해도 멈추지 않는다 — 직전 값으로 계산하고 경고를 남긴다.
 * 발주 직전에 마스터 하나 때문에 통째로 못 도는 것이 더 나쁘다.
 *   재고만(기본) · 재고+품목 · 전체 · 안함
 */
function ssm_refreshBeforeRun(cfg) {
  var t0 = Date.now();
  try {
    var r = ssm_refreshAll();
    //  얼마나 걸리는지 남긴다. 느려지면 «읽는 것»을 빠르게 하지,
    //  사람에게 고르게 하지 않는다 — 그러려면 시간을 알아야 한다.
    return { mode: '전체 (자동 · ' + Math.round((Date.now() - t0) / 1000) + '초)',
             report: r.report, warnings: r.warnings };
  } catch (e) {
    return { mode: '전체 (실패 — 직전 값으로 계산)', report: [], warnings: [
      ['오류', 'PRERUN_REFRESH', '전체',
       '실행 전 마스터 갱신에 실패해 직전 값으로 계산합니다. ' + e.message]
    ] };
  }
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

  // 도선료 표는 롯데가 준 파일을 사람이 심어 두는 것이라 원천에서 당겨오지 않는다.
  // 요금이 바뀌면 「도서산간 목록 심기」를 다시 돌리거나 탭에서 직접 고친다.
  report.push(['도서산간 도선료', ssm_localRows(SSIO_TABS.도선료) + '행 (수동 관리)']);

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

  /*  ★ 동네배송을 지웠다 ★  (2026-09-15)
      > "동네배송관련 시스템은 삭제해줘.. 시간만 더 걸리는거 같아.."

      설정이 이미 「중단」이라 분류는 안 하고 있었는데, 그래도 매 실행마다
      바깥 시트를 열어 보고 탭을 비우고 숨기는 일을 했다. 안 쓰는 길에
      시간을 쓰고 있었다. 원천 시트·탭·경고·출력 탭까지 한 번에 뺀다. */

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
function ssm_load(회차키) {
  var M = {
    items: {}, stock: {}, bom: {}, splitExcept: {},
    cond: {}, condCodes: {}, feeRules: {},
    islandKeywords: [], islandZips: {}, addrZip: {}, ferry: []
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


  M.vendors = {};
  ssm_업체심기_();
  var vd = ssio_body(SSIO_TABS.업체);
  for (var v2 = 0; v2 < vd.length; v2++) {
    var vc = ssText(vd[v2][0]).toUpperCase();
    if (vc) M.vendors[vc] = ssText(vd[v2][1]) || vc;
  }
  /*  ★ 늘 대리발송으로 보낼 품목 ★
      주문마다 「조치」를 적는 대신, 품목 하나를 표에 적어 두면 그 품목은
      매 회차 저절로 빠진다. 사람이 회차마다 같은 손질을 반복하지 않는다. */
  M.partnerItems = {};
  //  탭이 없으면 만들어 둔다 — 설치를 따로 돌릴 일이 없게
  ssio_sheet(SSIO_TABS.대리발송품목, SSM_PARTNER_ITEM_HEADER);
  var pi = ssio_body(SSIO_TABS.대리발송품목);
  for (var p2 = 0; p2 < pi.length; p2++) {
    var pc = ssText(pi[p2][0]).toUpperCase();
    if (!pc) continue;
    M.partnerItems[pc] = {
      코드: pc,
      업체코드: ssText(pi[p2][1]).toUpperCase(),
      사유: ssText(pi[p2][2])
    };
  }

  M.override = ssm_loadManual(ssio_config(), 회차키);

  M.ferry = ssm_ferryRows();   // 롯데 도선료 표 (주소 문자열로 확정)

  /* 이미 나간 줄 — core.js ssBlockReship 이 이걸 보고 재출고를 막는다 */
  M.기출고 = ssm_loadShipped(회차키);

  return M;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 지난 회차에 «이미 나간» 줄을 걷는다 ★   2026-09-21
 *
 *  > "중복출고부터 고쳐줘.. 회차별 중복출고가 이전에 문제가 많았는데"
 *
 *  원장에서 (고유ID + 원본품목코드) → 그 줄이 나갔던 회차키 를 만든다.
 *  core.js `ssBlockReship` 이 이 표를 보고 같은 줄을 보류로 세운다.
 *
 *  ★ 지금 회차는 뺀다 ★
 *    회차유지 재실행은 원장의 그 회차를 통째로 갈아 끼운다. 자기 자신을
 *    보고 막으면 재실행이 통째로 보류가 된다.
 *
 *  ★ 보류·비배송은 «안 나간 것»이다 ★
 *    1차에 재고부족으로 보류된 줄이 2차에 나가는 것은 정상이다.
 *
 *  ★ 며칠치를 보나 ★
 *    설정 「중복점검_대상일수」를 같이 쓴다(기본 2 = 오늘+어제). 막는 것과
 *    세는 것이 «같은 창»을 봐야 한다 — 다르면 「경고는 뜨는데 안 막힌다」가
 *    생기고, 그게 제일 설명하기 어렵다.
 *
 *  ★ 원장은 시트에 적힌 머리글로 읽는다 ★
 *    코드 상수로 읽으면 열이 하나 늘어난 뒤 옛 행과 어긋나 엉뚱한 칸을 집는다.
 * ══════════════════════════════════════════════════════════════
 */
function ssm_loadShipped(회차키) {
  var 표 = {};
  try {
    var sh = ssio_ss().getSheetByName(SSIO_TABS.원장);
    if (!sh || sh.getLastRow() < 2) return 표;

    var cols = sh.getLastColumn();
    var head = sh.getRange(1, 1, 1, cols).getValues()[0];
    var idx = {};
    for (var h = 0; h < head.length; h++) {
      var hn = ssText(head[h]);
      if (hn && idx[hn] === undefined) idx[hn] = h;
    }
    var need = ['회차키', '고유ID', '원본품목코드', '경로'];
    for (var n = 0; n < need.length; n++) {
      if (idx[need[n]] === undefined) {
        /*  못 읽으면 «막지 않는다». 빈 표를 돌려주면 여태처럼 경고만 남는다.
            읽다 만 표로 막으면 멀쩡한 주문이 보류로 떨어진다 — 그게 더 나쁘다. */
        Logger.log('[기출고] 원장에 「' + need[n] + '」 열이 없어 재출고 차단을 건너뜁니다');
        return 표;
      }
    }

    var 볼일수 = ssNum(ssio_config()['중복점검_대상일수']);
    if (!(볼일수 >= 1)) 볼일수 = 2;
    var 볼날 = {};
    for (var d = 0; d < 볼일수; d++) {
      볼날[Utilities.formatDate(new Date(new Date().getTime() - d * 86400000),
        'Asia/Seoul', 'yyMMdd')] = true;
    }

    /*  ★ 필요한 칸까지만 읽는다 ★  (2026-09-21)
        원장은 47열이고 하루 세 회차씩 쌓여 이미 5,000줄이다. 통째로 읽으면
        23만 칸이고, 그걸 «매 실행마다» 한 번 더 읽는 셈이 된다.
        여기서 보는 것은 회차키(A)·고유ID(C)·경로(F)·원본품목코드(K) 넷뿐이라
        K열까지만 읽으면 된다 — 4분의 1이다.
        자리로 박지 않고 머리글에서 구한 자리의 «가장 오른쪽»을 쓴다.
        열이 하나 끼어들어도 따라간다. */
    var 끝칸 = 0;
    for (var nn = 0; nn < need.length; nn++) {
      if (idx[need[nn]] + 1 > 끝칸) 끝칸 = idx[need[nn]] + 1;
    }
    if (끝칸 > cols) 끝칸 = cols;

    var 지금 = ssText(회차키);
    var all = sh.getRange(2, 1, sh.getLastRow() - 1, 끝칸).getValues();
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      var rk = ssText(r[idx['회차키']]);
      if (!rk || rk === 지금) continue;                 // 자기 자신은 안 본다
      if (!볼날[rk.substring(0, 6)]) continue;          // 창 밖은 안 본다
      var 경로 = ssText(r[idx['경로']]);
      if (!경로 || 경로 === SS_ROUTE.HOLD || 경로 === SS_ROUTE.NONSHIP) continue;
      var uid = ssText(r[idx['고유ID']]);
      var code = ssText(r[idx['원본품목코드']]);
      if (!uid || !code) continue;
      var k = uid + '\u0000' + code;
      if (표[k] === undefined) 표[k] = rk;              // 가장 먼저 나간 회차를 적는다
    }
  } catch (e) {
    //  곁다리다. 못 걷으면 안 막는다 — 세트분리 자체는 돌아야 한다.
    Logger.log('[기출고] 걷기 실패(차단 안 함): ' + (e && e.message ? e.message : e));
    return {};
  }
  return 표;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  전화주문 번호표의 «기억»  —  2026-09-22
 *
 *  > "그냥 사방넷처럼 하자"   > "날짜 자채가 새로운 넘버링인데"
 *
 *  전화주문 ID 는 p0922000001 처럼 그날의 번호표다. 번호는 다시 «계산»할 수
 *  없다 — 판매현황을 하루 두 번 통째로 다시 받으므로, 같은 주문에 아까 준
 *  번호를 그대로 돌려주려면 어딘가에 적혀 있어야 한다. 그게 원장이다.
 *
 *  원장에는 씨앗을 되살릴 칸이 다 있다:
 *    일자-No. · 원받는분 / 거래처명(= 받는분) · 원연락처 / 모바일 / 전화
 *    원주소 / 주소1 · 원본품목코드 · 주문수량
 *  ssOrderSeed 로 같은 씨앗을 다시 만들어 ID 를 찾는다 — 판정과 발급이
 *  «같은 함수»를 보게 해서 둘이 갈라지지 않게 한다.
 *
 *  ★ 못 읽어도 멈추지 않는다 ★
 *    빈 기억을 돌려주면 core 가 옛 해시로 떨어진다. 세트분리는 돌아간다.
 * ══════════════════════════════════════════════════════════════
 */
/*  창을 두지 않는다. 창 밖에 있는 주문은 «아직 ID 가 없는 주문»으로 보여
    새 번호를 받고, 그 순간 그 주문의 ID 가 바뀐다. ssm_loadShipped 도 원장을
    통째로 읽는다 — 쓸 칸까지만 읽으므로 한 번 더 읽는 값은 크지 않다. */

function ssm_loadPhoneIds() {
  var 기억 = { 표: {}, 다음: {}, 읽음: 0, 왜: '' };
  try {
    var sh = ssio_ss().getSheetByName(SSIO_TABS.원장);
    if (!sh || sh.getLastRow() < 2) { 기억.왜 = '원장이 비어 있습니다'; return 기억; }

    var cols = sh.getLastColumn();
    var head = sh.getRange(1, 1, 1, cols).getValues()[0];
    var idx = {};
    for (var h = 0; h < head.length; h++) {
      var hn = ssText(head[h]);
      if (hn && idx[hn] === undefined) idx[hn] = h;
    }
    var need = ['고유ID', '일자-No.', '원본품목코드', '주문수량',
      '원받는분', '원주소', '원연락처', '거래처명', '전화', '모바일', '주소1'];
    for (var n = 0; n < need.length; n++) {
      if (idx[need[n]] === undefined) {
        기억.왜 = '원장에 「' + need[n] + '」 열이 없습니다';
        return 기억;
      }
    }

    //  쓸 칸까지만 읽는다 (ssm_loadShipped 와 같은 수법)
    var 끝칸 = 0;
    for (var nn = 0; nn < need.length; nn++) {
      if (idx[need[nn]] + 1 > 끝칸) 끝칸 = idx[need[nn]] + 1;
    }
    if (끝칸 > cols) 끝칸 = cols;

    var all = sh.getRange(2, 1, sh.getLastRow() - 1, 끝칸).getValues();

    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      var uid = ssText(r[idx['고유ID']]);
      /*  전화주문이 발급받은 ID 를 모두 담는다.
            새 모양  p0921000047
            옛 모양  0921-PH-a3f19 · 260902-PH-a3f19   ← 지난 주문이 그대로 남으려면
                                                        이것도 기억에 있어야 한다
          사방넷 주문번호(숫자만)는 여기 안 온다 — 그건 애초에 발급을 안 한다. */
      var m = uid.match(/^p(\d{4})(\d{6})$/);
      if (!m && uid.indexOf('-PH-') < 0) continue;

      /*  ★ 전화는 반드시 ssPhoneFix 를 거친다 ★  (2026-09-22)
          씨앗을 만들 때(ssNormalize) 전화·모바일은 ssPhoneFix 로 앞 0 을 되살린
          값이었다. 그런데 원장 칸은 숫자로 저장되는 일이 잦아 앞 0 이 없다
          — 그대로 읽으면 «다른 씨앗»이 되어 그 주문의 번호를 못 찾는다.
          실제 원장 1,027줄로 재 보니 이 손질 하나로 어긋남이 159 → 10 으로 줄었다
          (남은 10 은 전부 비배송 — 적립금·할인액·추가운임이라 송장이 없다). */
      var 씨앗 = ssOrderSeed({
        일자: r[idx['일자-No.']],
        원받는분: r[idx['원받는분']],
        받는분: r[idx['거래처명']],          // 원장의 「거래처명」 칸에 받는분이 들어간다
        원연락처: ssPhoneFix(r[idx['원연락처']]),
        모바일: ssPhoneFix(r[idx['모바일']]),
        전화: ssPhoneFix(r[idx['전화']]),
        원주소1: r[idx['원주소']],
        주소1: r[idx['주소1']],
        원본코드: r[idx['원본품목코드']],
        주문수량: r[idx['주문수량']]
      });

      /*  씨앗 하나에 번호가 여럿일 수 있다 — 같은 사람이 같은 것을 두 줄로
          적은 경우다. 또 한 주문줄이 세트로 갈리면 원장에 여러 줄이 되는데
          그 줄들은 «같은 ID» 라 여기서 한 번만 담긴다. */
      var 목록 = 기억.표[씨앗] || (기억.표[씨앗] = []);
      if (목록.indexOf(uid) < 0) { 목록.push(uid); 기억.읽음++; }
      //  그날 어디까지 나갔는지도 같이 센다 — 다음 번호는 그 다음부터
      if (m) {
        var 날 = m[1], 번 = parseInt(m[2], 10);
        if (!(기억.다음[날] > 번)) 기억.다음[날] = 번 + 1;
      }
    }
    /*  한 씨앗에 ID 가 둘 이상이면 차례를 정해 둔다 — 첫 줄이 늘 같은 ID 를
        받아야 하기 때문이다. 원장 줄 차례는 회차마다 흔들릴 수 있으므로
        «ID 값»으로 세운다. 한 번 매겨진 ID 는 안 바뀌니 이것이 가장 단단하다. */
    for (var k in 기억.표) {
      if (Object.prototype.hasOwnProperty.call(기억.표, k)) 기억.표[k].sort();
    }
  } catch (e) {
    //  곁다리다. 못 읽으면 core 가 옛 해시로 떨어진다 — 세트분리는 돌아야 한다.
    기억.왜 = (e && e.message) ? e.message : String(e);
    Logger.log('[전화ID] 기억 읽기 실패(해시로 떨어짐): ' + 기억.왜);
    return { 표: {}, 다음: {}, 읽음: 0, 왜: 기억.왜 };
  }
  return 기억;
}
/**
 * ★ 주소사전만 다시 읽는다 ★  (2026-09-16)
 *
 * > "세트분리 속도 개선해주고"
 *
 * 우편번호를 새로 구하고 나면 도서산간 판정이 달라지므로 한 번 더 계산한다.
 * 그때 예전에는 ssm_load 를 통째로 다시 불렀다 — 품목·재고·BOM·배송비·업체·
 * 합배송조건·도서산간 세 탭·대리발송품목·수동조치까지 «열세 탭»을 다시 읽었다.
 *
 * 그런데 그 사이에 바뀐 것은 「도서산간_주소사전」 하나뿐이다
 * (ssz_fillDictionary 는 그 탭에만 쓴다). 나머지 열두 탭은 읽으나 마나 같다.
 *
 * 시트 한 번 읽기가 결코 싸지 않다. 사전은 영구 캐시라 날마다 길어지기도 한다.
 */
function ssm_reloadAddrZip(masters) {
  var m = masters || {};
  m.addrZip = {};
  var dc = ssio_body(SSIO_TABS.도서산간사전);
  for (var y = 0; y < dc.length; y++) {
    var a = ssText(dc[y][0]); if (!a) continue;
    var zip = ssText(dc[y][1]); if (zip) m.addrZip[a] = zip;
  }
  return m;
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
 * ★ 이 시트의 「판매현황」 탭만 읽는다 ★  (2026-09-10)
 *   전에는 설정에 시트 ID 를 적으면 바깥 시트에서 읽어 이 탭에 **덮어썼다.**
 *   9/9 에 기본값을 「이 시트」로 바꿨지만, 설정 탭에 남아 있던 옛 ID 가
 *   그대로 이겼다 — ssio_config() 는 이미 있는 값을 안 건드린다.
 *   그래서 붙여넣어 둔 것이 지워지고 딴 자료로 돌 뻔했다.
 *
 *   > "그냥 붙여넣기 한다고했자나.. 쓰려다가 꼬일뻔 했자나"
 *
 *   기본값을 바꾸는 것으로는 안 된다. 길 자체를 없앤다.
 *   바깥 시트가 다시 필요해지면 그때 «새로» 만든다 — 꺼져 있는 스위치를
 *   남겨 두면 언젠가 저 혼자 켜져 있다.
 * 비추는 이유는 두 가지 — 무엇을 계산했는지 눈으로 확인할 수 있고, 원천이 나중에 바뀌어도
 * 이 회차에 쓴 자료가 시트에 남는다.
 *
 * IMPORTRANGE 가 아니라 실행 시점 openById 다. 못 읽으면 조용히 빈 값이 되는 대신 멈춘다.
 */
function ssm_readSales(cfg) {
  return { grid: ssio_values(SSIO_TABS.입력), 원천: '이 시트', 행: 0 };
}

/** 입력 탭을 비운다 (붙여넣기 전에). 이 시트의 판매현황 탭만 건드린다. */
function ssm_clearSales(cfg) {
  ssio_clearBody(ssio_sheet(SSIO_TABS.입력, SS_SALES_COLS));
  return '이 시트의 판매현황 탭';
}

/* ── 수동조치 · 협력업체 ───────────────────────────────── */

var SSM_VENDOR_SEED = [
  ['NK', '냅킨코리아'], ['TY', '태양효성'], ['KR', '코라마'], ['HP', '하나팩'],
  ['WD', '월드유명'], ['AP', '올팩코리아'], ['GD', '성우포장'], ['GW', '그린우드'],
  ['BW', '부원'], ['IW', '인터웍스'], ['HR', '허브로스팅'], ['HU', '후아코리아'],
  ['LG', '로엔그린'], ['AJ', '아주팩'], ['OC', '부엉이'], ['YS', '와이에스'],
  ['SW', '선우'], ['JH', '준테크'], ['BF', '준테크'], ['NS', '준테크'],
  //  허브 푸시가 JH·BF·NS 를 JT 로 환산해 쓴다. 사람이 JT 라고 적는 게 자연스럽다.
  ['JT', '준테크'],
  ['JM', '제이엠']
];

/**
 * 협력업체 표에 시드 목록 중 빠진 코드만 채워 넣는다.
 * 사람이 적은 행은 절대 건드리지 않는다 — 이름을 고쳤거나 새 코드를 추가했어도 그대로 둔다.
 * (예전엔 탭이 비어 있을 때만 채워서, 시드에 JM을 추가해도 기존 시트에 반영되지 않았다)
 */
function ssm_seedVendors() {
  var sh = ssio_sheet(SSIO_TABS.업체, SS_VENDOR_HEADER);
  var have = {};
  var body = ssio_body(SSIO_TABS.업체);
  for (var i = 0; i < body.length; i++) {
    var c = ssText(body[i][0]).toUpperCase();
    if (c) have[c] = true;
  }
  var add = [];
  for (var s = 0; s < SSM_VENDOR_SEED.length; s++) {
    if (!have[SSM_VENDOR_SEED[s][0]]) add.push(SSM_VENDOR_SEED[s]);
  }
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 2).setValues(add);
  return add.length;
}

/**
 * 보류 탭에 사람이 적어 넣은 조치를 「수동조치」 탭에 옮겨 담는다.
 * 보류 탭은 실행할 때마다 다시 쓰이므로, 쓰기 전에 먼저 걷어와야 입력이 살아남는다.
 *
 * @return {number} 새로 담은 건수
 */
function ssm_captureManual(회차키) {
  var hold = ssio_ss().getSheetByName(SSIO_TABS.보류);
  if (!hold || hold.getLastRow() < 2) return 0;

  var idx = {};
  for (var h = 0; h < SS_HOLD_HEADER.length; h++) idx[SS_HOLD_HEADER[h]] = h;
  var v = hold.getRange(2, 1, hold.getLastRow() - 1, SS_HOLD_HEADER.length).getValues();

  // 보류 탭에는 원본코드가 없다. 원장에서 (고유ID, 품목코드) → 원본코드를 찾는다.
  // 원장은 「그 시트에 적힌 헤더」로 읽는다. 코드 상수로 읽으면 열이 늘어난 뒤 어긋난다.
  var back = {}, byUid = {};
  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (lg && lg.getLastRow() > 1) {
    var lcols = lg.getLastColumn();
    var lhead = lg.getRange(1, 1, 1, lcols).getValues()[0];
    var li = {};
    for (var q = 0; q < lhead.length; q++) {
      var ln = ssText(lhead[q]);
      if (ln && li[ln] === undefined) li[ln] = q;
    }
    if (li['고유ID'] !== undefined && li['품목코드'] !== undefined && li['원본품목코드'] !== undefined) {
      var lv = lg.getRange(2, 1, lg.getLastRow() - 1, lcols).getValues();
      for (var r = 0; r < lv.length; r++) {
        var _u = ssText(lv[r][li['고유ID']]);
        var _o = ssText(lv[r][li['원본품목코드']]);
        back[_u + '|' + ssText(lv[r][li['품목코드']])] = _o;
        /*  ★ 코드를 고치면 back 이 안 맞는다 ★  (2026-09-14)
            사람이 보류 탭에서 품목코드를 올바른 것으로 고치면 (고유ID|새코드)
            조합이 원장에 없다. 그러면 원본코드를 못 찾아 키가 어긋나고,
            **조치 자체가 통째로 무시된다.** 고친 사람은 이유를 알 길이 없다.
            그래서 고유ID 만으로도 원본코드를 찾을 수 있게 따로 모아 둔다.
            한 주문에 품목이 여럿이면 어느 줄인지 모르므로 그때는 안 쓴다. */
        /*  ★ 「출력품목명」도 같이 들고 온다 ★  (2026-10-01)
            보류 탭 품목명 칸에 적히는 것은 «출력이름»이다
            (ssHoldRow → ssOutRow → `출력품목명 || ssDisplayName(u)` — 판매처가 붙는다).
            그런데 아래에서 되읽을 때는 원장의 «품목명»(판매처 없음)과 견주었다.
            두 모양이 같을 수가 없으니 사람이 손도 안 댔는데 늘
            「이름을 고쳤다」가 되고, 그 이름이 새이름으로 잡혀 돌아왔다.
            그래서 두 가지가 났다 —
              ① 쪼개진 세트의 «모든» 구성품 줄에 한 이름이 먹혀
                 2026-09-28 오은수 건에 뚜껑 4개가 나갔다
              ② ssDisplayName 이 판매처를 또 붙여
                 「---법인/배민상회---법인/배민상회」 가 됐다 (원장 34줄, 9/15~)
            견주는 모양을 맞춘다 — 같은 것끼리 견주어야 «안 고쳤다»가 나온다.  */
        if (_u) (byUid[_u] || (byUid[_u] = [])).push({
          원본: _o, 코드: ssText(lv[r][li['품목코드']]),
          이름: li['품목명'] !== undefined ? ssText(lv[r][li['품목명']]) : '',
          출력이름: li['출력품목명'] !== undefined ? ssText(lv[r][li['출력품목명']]) : '' });
      }
    }
  }

  var vendors = {};
  var vd = ssio_body(SSIO_TABS.업체);
  for (var vi = 0; vi < vd.length; vi++) {
    var vc = ssText(vd[vi][0]).toUpperCase();
    if (vc) vendors[vc] = ssText(vd[vi][1]);
  }

  var sh = ssio_sheet(SSIO_TABS.수동조치, SS_MANUAL_HEADER);
  /*  ★ 머리글이 짧으면 늘린다 ★  (2026-09-28)
      ssio_sheet 는 «빈 시트»에만 머리글을 쓴다. 이미 쓰던 탭에는 칸이 11개뿐이라,
      늘어난 칸에 값이 들어가도 머리에 이름이 없어 사람이 무슨 값인지 모른다. */
  try {
    if (sh.getLastColumn() < SS_MANUAL_HEADER.length) {
      sh.getRange(1, 1, 1, SS_MANUAL_HEADER.length).setValues([SS_MANUAL_HEADER]);
    }
  } catch (eH) {}
  // 같은 줄에 대한 기록이 이미 있으면 「새로 넣지 않고 고쳐 쓴다」.
  // 예전에는 건너뛰었는데, 그러면 JT 로 한 번 잘못 적은 뒤에는 무엇을 적어도 반영되지 않았다.
  var at = {};
  var body = ssio_body(SSIO_TABS.수동조치);
  for (var b = 0; b < body.length; b++) {
    at[ssm_dateKey(body[b][0]) + '|' + ssText(body[b][1]) + '|' + ssText(body[b][2])] = b;
  }

  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  //  addAt : 이번 실행에서 «새로 담기로 한» 줄의 자리 (수동조치 탭에는 아직 없다)
  //  명시한키 : 사람이 조치 칸에 직접 적은 열쇠 (짐작이 이것을 못 덮게 한다)
  var add = [], addAt = {}, 명시한키 = {}, updated = 0, 바뀐코드못품 = [];
  var 못알아들음 = [];
  for (var i = 0; i < v.length; i++) {
    var 적은값 = ssText(v[i][idx['조치']]);
    var 사유 = ssText(v[i][idx['보류사유']]);
    var 상세 = ssText(v[i][idx['상세']]);
    var 메모 = ssText(v[i][idx['메모']]);

    /*  ★ 「메모」 칸에 주소를 적으면 그 주소로 보낸다 ★  (2026-09-28)
        > "미발송으로 빠져서 확인을 하고 주소라고 적으면 주소로 적용되면 좋겠어"

        ★ 왜 「조치」 칸이 아닌가 ★
          조치 칸은 이미 꽉 찼다 — 아무 글자나 적으면 「미등록 업체코드」로 보고
          대리발송으로 돌린다. 거기에 주소를 적으면 엉뚱한 업체로 간다.
          메모 칸은 지금 아무 뜻도 없는 자유 칸이라 부딪히는 것이 없다.

        ★ 읽는 함수는 적요와 «같은 것»이다 ★
          ssParseAddrOverride 하나만 쓴다. 「배송지 …」 형식도 그대로 먹고,
          주소만 적어도 먹는다. 문법이 둘로 갈리지 않는다. */
    var 메모주소 = 메모 ? ssParseAddrOverride(메모) : null;

    /*  조치 칸 하나로 뜻이 갈린다.
          「발송」          → 자체 출고 (보류 해제)
          등록된 업체코드   → 그 업체로 대리발송
          「대리발송」       → 업체는 품목명에서 추론
          「보류」·비워 둠   → 그대로 보류
          그 밖의 말        → ★ 그대로 보류 + 못 알아들었다고 말해 준다

        ★ 모르는 말을 업체코드로 «받지 않는다» ★  (2026-09-28)
        > "일부러 보류라고 적었는데도 넘어가는"

          여태는 모르는 글자를 전부 「미등록 업체코드」로 보고 대리발송으로
          돌렸다. 「보류」라고 적은 것이 «보내라»는 뜻이 된 셈이다. 게다가 그 말이
          우연히 등록된 두 글자 코드와 같으면 그 업체로 그냥 나간다.
          못 알아들은 말은 아무 일도 하지 않는 것이 맞다 — 세워 둔 줄을 푸는 쪽으로
          짐작하면 안 된다. 짐작이 틀리면 물건이 나가 버려 되돌릴 수 없다.  */
    var 조치 = '', 업체 = '';
    var up = 적은값.toUpperCase();
    var 뜻모름 = false;
    var _민 = ssNorm(적은값).split(' ').join('').toUpperCase();
    var 세우기 = false;
    for (var kw = 0; kw < SS_HOLD_KEEP_WORDS.length; kw++) {
      if (_민 === ssNorm(SS_HOLD_KEEP_WORDS[kw]).split(' ').join('').toUpperCase()) { 세우기 = true; break; }
    }
    if (세우기) { /* 그대로 보류 — 아무것도 하지 않는다 */ }
    else if (적은값 === '발송') 조치 = '발송';
    else if (적은값 === '대리발송') 조치 = '대리발송';
    else if (up && vendors[up]) { 조치 = '대리발송'; 업체 = up; }
    else if (적은값) 뜻모름 = true;      // ★ 그대로 보류. 업체코드로 받지 않는다
    //  메모에 주소를 적었으면 조치 칸이 비어 있어도 「보내라」는 뜻이다.
    //  사람이 조치 칸에 따로 적었으면 그것이 이긴다 — 위에서 이미 정해졌다.
    if (!조치 && 메모주소) 조치 = '발송';

    // 상세(사유 내용)를 지웠으면 그 사유가 해소된 것으로 보고 발송한다.
    // 보류사유가 붙는 행은 상세가 항상 채워지므로, 비었다는 건 사람이 지웠다는 뜻이다.
    if (!조치 && 사유 && !상세) { 조치 = '발송'; if (!메모) 메모 = '상세 지움 → 해소'; }

    /*  못 알아들은 말은 «그대로 보류»다. 다만 조용히 두지 않는다 —
        적은 사람은 왜 안 먹는지 알 길이 없다. */
    if (뜻모름) {
      못알아들음.push(ssText(v[i][idx['사방넷주문번호']]) + ' : 「' + 적은값.slice(0, 16) + '」');
      continue;
    }
    if (조치 !== '발송' && 조치 !== '대리발송') continue;
    var uid = ssText(v[i][idx['사방넷주문번호']]);
    var code = ssText(v[i][idx['품목코드']]);
    var 이름 = ssText(v[i][idx['품목명']]);
    if (!uid) continue;

    /*  ★ 사람이 코드를 고쳤는가 ★
        조치를 거는 열쇠는 (고유ID + 원본코드)다. 코드를 고치면 그 열쇠를
        원장에서 되찾아야 하는데, 세트가 두 줄로 쪼개져 있으면 고유ID 도
        순번도 같아서 어느 줄인지 기계가 못 정한다. 그런 줄이 흔하다.

        그래서 2026-09-14 부터 보류 탭 맨 뒤에 «원본코드»를 적어 둔다.
        그 칸이 있으면 그것이 답이다 — 코드를 어떻게 고쳐도 안 깨진다.
        옛 보류 탭에는 그 칸이 없으므로 아래 옛 길도 남겨 둔다. */
    var 적힌원본 = idx['원본코드'] !== undefined ? ssText(v[i][idx['원본코드']]) : '';
    var 원본 = 적힌원본 || back[uid + '|' + code];
    var 새코드 = '', 새이름 = '';
    if (적힌원본) {
      //  열쇠가 적혀 있다 — 코드·이름이 원장과 다르면 그게 곧 «고친 것»이다
      /*  ★ «첫 줄»과 견주면 안 된다 ★  (2026-09-18)
          > "뚜껑만이 세트분리되고 또한번 되었어.. 1개가 2개가 된거야"

          세트가 쪼개지면 같은 원본을 가진 줄이 여럿이다 (몸통, 뚜껑).
          여기서 첫 줄만 집어 견주면, 뚜껑 줄을 보류에서 조치할 때
          «뚜껑 코드 ≠ 몸통 코드» 라서 「사람이 코드를 고쳤다」고 잘못 본다.
          아무도 안 고쳤는데 새코드가 생기고, 그 새코드가 아래
          ssApplyManualEdits 에서 그 주문의 «모든» 구성품 줄에 걸린다.
          → 몸통이 뚜껑이 되어 뚜껑 2개 · 몸통 0개가 나간다.
            2026-09-17 회차 260917-1 에서 실제로 두 건 그렇게 나갔다.

          고침: 같은 원본을 가진 줄 «전부»와 견준다. 그중 하나라도
          코드가 같으면 «안 고친 것»이다. */
      var 원줄 = null, 코드그대로 = false, 이름그대로 = false;
      var LL = byUid[uid] || [];
      for (var lj = 0; lj < LL.length; lj++) {
        if (LL[lj].원본 !== 적힌원본) continue;
        if (!원줄) 원줄 = LL[lj];
        if (code && LL[lj].코드 === code) { 코드그대로 = true; 원줄 = LL[lj]; }
        /*  ★ 두 모양 다 본다 ★  보류 탭은 출력이름을 보여 주고,
            원장은 품목명과 출력품목명을 둘 다 들고 있다. 어느 쪽과든 같으면
            «사람이 안 고친 것»이다. (2026-10-01)  */
        if (이름 && (LL[lj].이름 === 이름 || LL[lj].출력이름 === 이름)) 이름그대로 = true;
      }
      if (code && code !== 적힌원본 && !코드그대로) 새코드 = code;
      if (이름 && !이름그대로) 새이름 = 이름;
    } else if (원본 === undefined) {
      var 줄들 = byUid[uid] || [];
      if (줄들.length === 1) {
        원본 = 줄들[0].원본;
        새코드 = code;
        if (이름 && 이름 !== 줄들[0].이름 && 이름 !== 줄들[0].출력이름) 새이름 = 이름;
      } else {
        원본 = code;   // 예전 그대로 — 아래에서 키가 안 맞아 조용히 빠진다
        if (줄들.length > 1) {
          바뀐코드못품.push(uid + ' → ' + code + ' (그 주문에 품목 ' + 줄들.length + '개)');
        }
      }
    } else {
      //  코드는 그대로고 이름만 고쳤을 수 있다
      var 원이름 = '', 원출력이름 = '';
      var L0 = byUid[uid] || [];
      for (var li2 = 0; li2 < L0.length; li2++) {
        if (L0[li2].원본 !== 원본) continue;
        원이름 = L0[li2].이름; 원출력이름 = L0[li2].출력이름; break;
      }
      //  두 모양 다 본다 (2026-10-01) — 보류 탭은 출력이름을 보여 준다
      if (이름 && 원이름 && 이름 !== 원이름 && 이름 !== 원출력이름) 새이름 = 이름;
    }
    //  메모에서 읽은 배송지 — 아무것도 못 읽었으면 넷 다 빈 값이다
    var 새주소 = 메모주소 ? ssText(메모주소.addr) : '';
    var 새받는분 = 메모주소 ? ssText(메모주소.name) : '';
    var 새전화 = 메모주소 ? ssText(메모주소.tel) : '';
    var 새모바일 = 메모주소 ? ssText(메모주소.mobile) : '';

    var k = today + '|' + uid + '|' + 원본;

    /*  ★ 같은 열쇠가 이 실행 안에서 두 번 나온다 ★  (2026-09-17)
        세트는 보류 탭에 여러 줄로 쪼개져 놓인다. 쪼개진 줄들은 «원본코드가
        같으므로» (고유ID + 원본코드) 열쇠가 겹친다 — 흔한 일이다.

        예전에는 두 번째 줄에서 아직 «시트에 없는» 줄 번호를 읽으러 가
        「Cannot read properties of undefined (reading '3')」로
        세트분리가 통째로 멈췄다. 사장님이 실제로 겪으셨다.

        그리고 겹친 두 줄은 뜻이 다를 수 있다 —
          · 한 줄은 사람이 조치 칸에 «적은» 것
          · 다른 한 줄은 상세를 지워 «해소로 짐작한» 것
        사람이 적은 것이 언제나 이긴다. 짐작이 사람 손을 덮으면 안 된다.  */
    var 명시 = !!적은값;
    if (명시한키[k] && !명시) continue;
    if (명시) 명시한키[k] = true;

    if (addAt[k] !== undefined) {
      //  아직 시트에 안 쓴 줄이다 — 시트를 읽지 말고 그 줄을 고쳐 쓴다
      var a0 = add[addAt[k]];
      a0[3] = 조치; a0[4] = 업체; a0[5] = 메모;
      a0[6] = 회차키 || ''; a0[7] = now; a0[9] = 새코드; a0[10] = 새이름;
      a0[11] = 새주소; a0[12] = 새받는분; a0[13] = 새전화; a0[14] = 새모바일;
      a0[15] = 적은값;
      continue;
    }

    if (at[k] !== undefined) {
      var b0 = at[k];
      var 옛조치 = ssText(body[b0][3]);
      var 옛업체 = ssText(body[b0][4]).toUpperCase();
      var 옛회차 = ssText(body[b0][6]);
      var 옛새코드 = ssText(body[b0][9]);
      var 옛새이름 = ssText(body[b0][10]);
      var 옛새주소 = ssText(body[b0][11]);
      // 값도 회차도 그대로면 손댈 것이 없다. 하나라도 다르면 새 값으로 되살린다.
      //  주소도 견준다 — 메모를 고쳤는데 그대로면 사람은 왜 안 먹는지 모른다.
      if (옛조치 === 조치 && 옛업체 === 업체 && 옛회차 === (회차키 || '') &&
          옛새코드 === 새코드 && 옛새이름 === 새이름 && 옛새주소 === 새주소) continue;
      sh.getRange(b0 + 2, 4, 1, 13).setValues([[조치, 업체, 메모, 회차키 || '', now, '',
        새코드, 새이름, 새주소, 새받는분, 새전화, 새모바일, 적은값]]);
      updated++;
      continue;
    }
    addAt[k] = add.length;
    /*  ★ 적은 말을 그대로 남긴다 ★  (2026-09-28)
        「왜 발송이 됐지」를 되짚을 길이 없었다. 걷힌 «결과»만 남고 사람이 적은
        «말»은 회차마다 덮어써지는 보류 탭에만 있었다. 그래서 원문을 적어 둔다. */
    add.push([today, uid, 원본, 조치, 업체, 메모, 회차키 || '', now, '', 새코드, 새이름,
      새주소, 새받는분, 새전화, 새모바일, 적은값]);
  }
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, SS_MANUAL_HEADER.length).setValues(add);
  /*  ★ 못 건 것은 «조용히» 두지 않는다 ★
      한 주문에 품목이 여럿인데 코드를 고치면 어느 줄인지 기계가 못 정한다.
      그때 아무 말도 안 하면 사람은 고쳤는데 안 먹는 이유를 영영 모른다. */
  if (못알아들음.length) {
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        '조치 칸의 말을 못 알아들어 «그대로 보류»했습니다 (' + 못알아들음.length + '건)' +
        String.fromCharCode(10) + 못알아들음.slice(0, 3).join(String.fromCharCode(10)) +
        String.fromCharCode(10) + '보낼 것은 「발송」, 세워 둘 것은 「보류」 또는 빈칸입니다.',
        '조치 칸', 15);
    } catch (eU) {}
  }
  if (바뀐코드못품.length) {
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        '코드를 고쳤지만 어느 줄인지 정할 수 없었습니다 (' + 바뀐코드못품.length + '건)' +
        String.fromCharCode(10) + 바뀐코드못품.slice(0, 3).join(String.fromCharCode(10)) +
        String.fromCharCode(10) + '한 주문에 품목이 여럿입니다 — 코드는 그대로 두고 조치만 적어 주세요.',
        '수동조치', 12);
    } catch (eT) {}
  }
  return add.length + updated;
}

/**
 * 날짜 칸을 'yyyy-MM-dd' 로 통일한다.
 * 시트는 문자열로 적어 넣어도 날짜 값으로 바꿔 저장할 때가 있어서,
 * 읽을 때 Date 일 수도 있고 '2026/09/02' 일 수도 있고 '2026-09-02' 일 수도 있다.
 */
function ssm_dateKey(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';

  /*  ★ 정규식을 쓰지 않는다 ★  (2026-09-17)
      여기 있던 자는 /^(\d{4})-(\d{1,2})-(\d{1,2})/ 였는데 어느 사이엔가
      백슬래시가 먹혀 \d 가 맨 d 로 남아 있었다.
      「숫자 네 개」를 찾던 자가 「d 네 개」를 찾는 자가 된 것이다.
      어떤 날짜에도 안 맞으니 «맞추기를 통째로 건너뛰고» 있었다.

      그래서 2026.9.2 는 2026-9-2 로 남고, 시스템이 쓰는 2026-09-02 와
      다른 열쇠가 된다. 같은 줄인데 다른 줄로 보여 조치가 새로 담긴다.
      터지지 않는다 — 조용히 어긋난다. 그래서 정규식을 아예 걷어낸다.  */
  var 조각 = [], cur = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c >= '0' && c <= '9') { cur += c; continue; }
    if (cur) { 조각.push(cur); cur = ''; }
  }
  if (cur) 조각.push(cur);

  //  20260917 처럼 붙여 쓴 것 — 토막이 하나뿐이면 갈라 본다
  if (조각.length === 1 && 조각[0].length === 8) {
    조각 = [조각[0].substring(0, 4), 조각[0].substring(4, 6), 조각[0].substring(6, 8)];
  }

  /*  ★ 모르겠으면 손대지 않는다 ★
      해가 네 자리가 아니거나 토막이 모자라면 «적힌 그대로» 돌려준다.
      짐작해서 바꾸면 틀린 열쇠가 되고, 틀린 열쇠는 빈 열쇠보다 나쁘다.  */
  if (조각.length < 3) return s;
  var y = 조각[0], mo = 조각[1], d = 조각[2];
  if (y.length !== 4 || !mo.length || mo.length > 2 || !d.length || d.length > 2) return s;
  var mN = Number(mo), dN = Number(d);
  if (mN < 1 || mN > 12 || dN < 1 || dN > 31) return s;

  var p = function (x) { return (x.length < 2 ? '0' : '') + x; };
  return y + '-' + p(mo) + '-' + p(d);
}

/** 유효한 수동조치만 골라 {고유ID|원본코드: {조치, 업체코드}} 로 만든다 */
function ssm_loadManual(cfg, 회차키) {
  // 조치는 「그 회차 안에서」 유효하다.
  //
  // 미발송 건은 여기저기 연락해 가며 하나씩 풀린다.
  // 되는 것부터 반영하고 나머지를 나중에 처리하는데,
  // 반영할 때마다 전체를 다시 계산하므로 앞서 처리한 건도 함께 다시 판정된다.
  // 그래서 회차가 바뀌기 전까지는 이미 내린 조치가 계속 살아 있어야 한다.
  // 새 판매현황이 들어와 회차가 바뀌면 그때 전부 무효가 된다.
  var out = {};
  if (!회차키) return out;
  var body = ssio_body(SSIO_TABS.수동조치);
  for (var i = 0; i < body.length; i++) {
    if (ssText(body[i][6]) !== 회차키) continue;      // 등록회차가 다르면 무효
    var uid = ssText(body[i][1]), code = ssText(body[i][2]);
    var 조치 = ssText(body[i][3]);
    if (!uid || (조치 !== '발송' && 조치 !== '대리발송')) continue;
    out[uid + '|' + code] = {
      조치: 조치,
      업체코드: ssText(body[i][4]).toUpperCase(),
      메모: ssText(body[i][5]),
      새코드: ssText(body[i][9]),
      새이름: ssText(body[i][10]),
      새주소: ssText(body[i][11]),
      새받는분: ssText(body[i][12]),
      새전화: ssText(body[i][13]),
      새모바일: ssText(body[i][14])
    };
  }
  return out;
}

/** 적용된 수동조치에 이번 회차를 기록해 둔다 */
function ssm_stampManual(units, 회차키) {
  var sh = ssio_ss().getSheetByName(SSIO_TABS.수동조치);
  if (!sh || sh.getLastRow() < 2) return 0;
  var used = {};
  for (var i = 0; i < units.length; i++) {
    // 결과를 바꾼 것만 소진시킨다. 업체코드가 틀려 보류에 남은 건은 다시 쓸 수 있어야 한다.
    if (units[i].수동조치적용) used[ssText(units[i].고유ID) + '|' + ssText(units[i].원본코드)] = true;
  }
  var n = sh.getLastRow() - 1;
  var v = sh.getRange(2, 2, n, 8).getValues();   // 고유ID … 최근적용회차
  var changed = false, cnt = 0;
  for (var r = 0; r < v.length; r++) {
    var k = ssText(v[r][0]) + '|' + ssText(v[r][1]);
    if (!used[k]) continue;
    cnt++;
    if (ssText(v[r][7]) !== 회차키) { v[r][7] = 회차키; changed = true; }
  }
  if (changed) sh.getRange(2, 2, n, 8).setValues(v);
  return cnt;
}

/** 「도서산간_도선료」 탭 → core 가 쓰는 모양으로 */
/*  ★ 대리발송업체 새로 등록 ★  (2026-09-28)

    > "업체등록이 되있는지 확인해줘  코드는 GS"   "업으면 등록해줘"
    > "이 업체도 추가해줘.. 삼일...코드는SI"

    ★ 왜 이 표가 중요한가 ★
      품목코드 앞 두 글자로 업체를 가린다(ssVendorOf). 여기 없는 코드로 대리발송이
      걸리면 「업체코드확인」으로 «보류»된다 — 나가야 할 것이 안 나간다.
      GS 접두 품목이 251개, SI 가 20개(실링기계)인데 둘 다 표에 없었다.

    ★ 표의 주인은 시트다 ★
      없을 때만 넣는다. 사장님이 이름을 고치시면 그 값이 이긴다.
      다 들어가고 나면(며칠 뒤) 이 표를 비운다.

    업체 시트
      지에스 18bp2Gd4lzdNBN6NQNGKkv36qQQWg3SgclYZLTEt09L8
      삼일   1NuBrK5q1QH7Xhre4Caqf6kk_6wk8xo2FVPedBLR8oPs
*/
var SS_SEED_업체 = [
  ['GS', '지에스'],
  ['SI', '삼일'],
];

/** 업체코드가 표에 없으면 넣는다. 있으면 아무것도 안 한다. */
function ssm_업체심기_() {
  try {
    var sh = ssio_ss().getSheetByName(SSIO_TABS.업체);
    if (!sh) return 0;
    var body = ssio_body(SSIO_TABS.업체);
    var 있다 = {};
    for (var i = 0; i < body.length; i++) {
      var c = ssText(body[i][0]).toUpperCase();
      if (c) 있다[c] = true;
    }
    var 넣을것 = [];
    for (var s = 0; s < SS_SEED_업체.length; s++) {
      if (있다[SS_SEED_업체[s][0]]) continue;
      넣을것.push(SS_SEED_업체[s]);
    }
    if (!넣을것.length) return 0;
    var 끝 = Math.max(sh.getLastRow(), 1);
    if (sh.getMaxRows() < 끝 + 넣을것.length) sh.insertRowsAfter(sh.getMaxRows(), 넣을것.length + 10);
    sh.getRange(끝 + 1, 1, 넣을것.length, 2).setValues(넣을것);
    Logger.log('[업체 심기] ' + 넣을것.map(function (r) { return r[0] + ' ' + r[1]; }).join(' · '));
    return 넣을것.length;
  } catch (e) {
    Logger.log('[업체 심기] 실패: ' + String(e && e.message ? e.message : e));
    return 0;
  }
}

/*  ★ 강원 산간 55곳 ★  (2026-09-28)

    로젠이 준 「산간지역 세부 list(260801)」 그대로다. 표에 없으면 한 번만 심는다.

    ★ 금액은 3,000 으로 적어 두고 통일 5,000 이 덮는다 ★
      > "평균 5000원으로 일괄적용"
      > "반품의 경우 비용이 너무 많이들어서 평균비용으로 처리하는거야"
      3,000 은 로젠이 실제로 받는 값이다. 설정 「도선료_통일금액」을 비우면
      그 진짜 값이 나오게 남겨 둔다 — 지우면 되돌릴 자료가 없어진다.

    ★ 경로는 «일반 로젠» 이다 ★
      > "1로 해야되"
      산간은 배가 아니라 차로 간다. 도서산간 탭에 섞으면 출고하는 사람이
      「배 타는 건」과 구별을 못 한다. core.js 의 도선료표 갈래에서 갈린다.

    ★ 원본 오타 둘을 바로잡았다 ★
      「강원 영원군 남면」  → 영월군 (제주운임표에도 영월군으로 나온다)
      「양구군 국토중앙면」 → 국토정중앙면 (정식 이름. 주소에 그렇게 찍힌다)
*/
var SS_SEED_산간 = [
  ['강원', '양양군', '서면', '', 3000, '산간'],
  ['강원', '횡성군', '공근면', '', 3000, '산간'],
  ['강원', '양양군', '손양면', '', 3000, '산간'],
  ['강원', '횡성군', '둔내면', '', 3000, '산간'],
  ['강원', '양양군', '현북면', '', 3000, '산간'],
  ['강원', '횡성군', '서원면', '', 3000, '산간'],
  ['강원', '영월군', '김삿갓면', '', 3000, '산간'],
  ['강원', '횡성군', '안흥면', '', 3000, '산간'],
  ['강원', '영월군', '남면', '', 3000, '산간'],
  ['강원', '정선군', '남면', '', 3000, '산간'],
  ['강원', '영월군', '무릉도원면', '', 3000, '산간'],
  ['강원', '정선군', '동면', '', 3000, '산간'],
  ['강원', '영월군', '북면', '', 3000, '산간'],
  ['강원', '정선군', '북면', '', 3000, '산간'],
  ['강원', '영월군', '서면', '', 3000, '산간'],
  ['강원', '정선군', '북평면', '', 3000, '산간'],
  ['강원', '영월군', '수주면', '', 3000, '산간'],
  ['강원', '정선군', '여량면', '', 3000, '산간'],
  ['강원', '영월군', '주천면', '', 3000, '산간'],
  ['강원', '정선군', '임계면', '', 3000, '산간'],
  ['강원', '영월군', '중동면', '', 3000, '산간'],
  ['강원', '정선군', '화암면', '', 3000, '산간'],
  ['강원', '영월군', '하동면', '', 3000, '산간'],
  ['강원', '고성군', '죽왕면', '', 3000, '산간'],
  ['강원', '영월군', '한반도면', '', 3000, '산간'],
  ['강원', '고성군', '토성면', '', 3000, '산간'],
  ['강원', '홍천군', '남면', '남노일리', 3000, '산간'],
  ['강원', '고성군', '현내면', '', 3000, '산간'],
  ['강원', '홍천군', '내면', '', 3000, '산간'],
  ['강원', '철원군', '근남면', '', 3000, '산간'],
  ['강원', '홍천군', '내촌면', '', 3000, '산간'],
  ['강원', '철원군', '근북면', '', 3000, '산간'],
  ['강원', '홍천군', '두촌면', '괘석리', 3000, '산간'],
  ['강원', '철원군', '서면', '', 3000, '산간'],
  ['강원', '홍천군', '북방면', '북방리', 3000, '산간'],
  ['강원', '양구군', '국토정중앙면', '', 3000, '산간'],
  ['강원', '홍천군', '북방면', '장항리', 3000, '산간'],
  ['강원', '양구군', '방산면', '', 3000, '산간'],
  ['강원', '홍천군', '서면', '', 3000, '산간'],
  ['강원', '양구군', '동면', '', 3000, '산간'],
  ['강원', '홍천군', '서석면', '', 3000, '산간'],
  ['강원', '양구군', '해안면', '', 3000, '산간'],
  ['강원', '홍천군', '화촌면', '군업리', 3000, '산간'],
  ['강원', '평창군', '대관령면', '', 3000, '산간'],
  ['강원', '평창군', '방림면', '', 3000, '산간'],
  ['강원', '평창군', '용평면', '', 3000, '산간'],
  ['강원', '화천군', '사내면', '', 3000, '산간'],
  ['강원', '화천군', '상서면', '', 3000, '산간'],
  ['강원', '화천군', '하남면', '', 3000, '산간'],
  ['강원', '인제군', '기린면', '', 3000, '산간'],
  ['강원', '인제군', '북면', '용대리', 3000, '산간'],
  ['강원', '인제군', '북면', '월학리', 3000, '산간'],
  ['강원', '인제군', '북면', '한계리', 3000, '산간'],
  ['강원', '인제군', '상남면', '', 3000, '산간'],
  ['강원', '인제군', '서화면', '', 3000, '산간'],
];

/**
 * 산간 줄이 도선료 표에 없으면 심는다. 있으면 아무것도 안 한다.
 * 표의 «주인»은 여전히 시트다 — 사장님이 고치시면 그 값이 이긴다.
 */
/*  ★ 강원 산간 우편번호 249개 ★  (2026-09-28)

    로젠 「제주운임표」의 강원 구간을 개별 번호로 편 것이다.

    ★ 왜 우편번호도 필요한가 ★
      도선료표는 읍·면 이름으로 잡는데, 로젠은 「인제군 북면 «용대리·월학리·한계리»」
      처럼 면 안의 특정 리만 산간으로 친다. 도로명 주소에는 리가 안 찍힌다 —
      「인제군 북면 금강로 751」로는 어느 리인지 알 수 없다.
      그 주문의 우편번호가 24609 였고, 그것이 월학리 구간이다. 번호가 푼다.

    ★ 옮겨 적은 것이 맞는지 맞대 봤다 ★
      실제로 새던 8건의 우편번호(24609·24154·24600·25351·25166·26145·25316·24706)가
      모두 구간 안에 들었다.
*/
var SS_SEED_산간우편 = [
  '24052', '24056', '24057', '24058', '24059', '24060', '24061', '24062', '24063', '24064',
  '24065', '24100', '24101', '24102', '24103', '24104', '24105', '24106', '24107', '24108',
  '24122', '24131', '24140', '24141', '24142', '24143', '24144', '24145', '24146', '24147',
  '24148', '24149', '24150', '24151', '24152', '24153', '24154', '24155', '24156', '24157',
  '24158', '24159', '24160', '24161', '24500', '24501', '24502', '24503', '24504', '24505',
  '24506', '24507', '24508', '24509', '24510', '24511', '24517', '24551', '24552', '24553',
  '24554', '24555', '24556', '24557', '24558', '24559', '24560', '24561', '24562', '24563',
  '24564', '24600', '24601', '24602', '24603', '24604', '24605', '24606', '24607', '24609',
  '24610', '24611', '24620', '24653', '24654', '24655', '24656', '24657', '24658', '24659',
  '24660', '24661', '24662', '24663', '24664', '24665', '24666', '24667', '24701', '24702',
  '24703', '24704', '24705', '24706', '24707', '24710', '24743', '24744', '24745', '24746',
  '24747', '24748', '24749', '24750', '24751', '24752', '24753', '24754', '24755', '24756',
  '24757', '24758', '24759', '24760', '24761', '24762', '24763', '24764', '24765', '24766',
  '24767', '24768', '24769', '24770', '25100', '25101', '25102', '25103', '25104', '25105',
  '25113', '25116', '25159', '25160', '25161', '25162', '25163', '25165', '25166', '25167',
  '25168', '25169', '25170', '25171', '25200', '25201', '25202', '25203', '25204', '25205',
  '25206', '25207', '25208', '25209', '25260', '25261', '25262', '25263', '25264', '25265',
  '25266', '25267', '25268', '25269', '25270', '25271', '25312', '25313', '25314', '25315',
  '25316', '25317', '25339', '25340', '25341', '25342', '25343', '25344', '25345', '25346',
  '25347', '25348', '25349', '25350', '25351', '25352', '25353', '25364', '25365', '25366',
  '26100', '26101', '26102', '26103', '26104', '26105', '26106', '26107', '26108', '26109',
  '26110', '26111', '26112', '26113', '26114', '26115', '26116', '26117', '26118', '26143',
  '26144', '26145', '26146', '26147', '26148', '26200', '26201', '26202', '26203', '26204',
  '26205', '26206', '26207', '26208', '26209', '26210', '26211', '26212', '26213', '26214',
  '26215', '26216', '26217', '26218', '26219', '26220', '26245', '26246', '26247',
];

/**
 * 산간 우편번호가 표에 없으면 심는다. 권역은 「산간」이다.
 * 도서로 심으면 도서산간 탭으로 새 버린다 — 산간은 일반 로젠으로 간다.
 */
function ssm_산간우편심기_() {
  try {
    var sh = ssio_ss().getSheetByName(SSIO_TABS.도서산간우편);
    if (!sh) return 0;
    var body = ssio_body(SSIO_TABS.도서산간우편);
    var 있다 = {};
    for (var i = 0; i < body.length; i++) {
      var z = ssText(body[i][0]);
      if (z) 있다[z] = true;
    }
    var 넣을것 = [];
    for (var s = 0; s < SS_SEED_산간우편.length; s++) {
      if (있다[SS_SEED_산간우편[s]]) continue;
      넣을것.push([SS_SEED_산간우편[s], '산간']);
    }
    if (!넣을것.length) return 0;
    var 끝 = Math.max(sh.getLastRow(), 1);
    if (sh.getMaxRows() < 끝 + 넣을것.length) sh.insertRowsAfter(sh.getMaxRows(), 넣을것.length + 50);
    sh.getRange(끝 + 1, 1, 넣을것.length, 2).setValues(넣을것);
    Logger.log('[산간 우편번호 심기] ' + 넣을것.length + '개 넣었습니다');
    return 넣을것.length;
  } catch (e) {
    Logger.log('[산간 우편번호 심기] 실패: ' + String(e && e.message ? e.message : e));
    return 0;
  }
}

function ssm_산간심기_() {
  ssm_산간우편심기_();
  try {
    var sh = ssio_ss().getSheetByName(SSIO_TABS.도선료);
    if (!sh) return 0;
    var body = ssio_body(SSIO_TABS.도선료);
    var 있다 = {};
    for (var i = 0; i < body.length; i++) {
      있다[ssText(body[i][0]) + '|' + ssText(body[i][1]) + '|' +
        ssText(body[i][2]) + '|' + ssText(body[i][3])] = true;
    }
    var 넣을것 = [];
    for (var s = 0; s < SS_SEED_산간.length; s++) {
      var r = SS_SEED_산간[s];
      if (있다[r[0] + '|' + r[1] + '|' + r[2] + '|' + r[3]]) continue;
      넣을것.push(r);
    }
    if (!넣을것.length) return 0;
    var 끝 = Math.max(sh.getLastRow(), 1);
    if (sh.getMaxRows() < 끝 + 넣을것.length) sh.insertRowsAfter(sh.getMaxRows(), 넣을것.length + 20);
    sh.getRange(끝 + 1, 1, 넣을것.length, 6).setValues(넣을것);
    Logger.log('[산간 심기] ' + 넣을것.length + '줄 넣었습니다');
    return 넣을것.length;
  } catch (e) {
    //  못 심어도 실행은 계속한다 — 산간 추가운임을 못 받을 뿐이다
    Logger.log('[산간 심기] 실패: ' + String(e && e.message ? e.message : e));
    return 0;
  }
}

function ssm_ferryRows() {
  ssm_산간심기_();
  var out = [];
  var body = ssio_body(SSIO_TABS.도선료);
  for (var i = 0; i < body.length; i++) {
    var 읍면동 = ssText(body[i][2]);
    if (!읍면동) continue;
    var 리raw = ssText(body[i][3]);
    out.push({
      시도: ssText(body[i][0]),
      시군: ssText(body[i][1]),
      읍면동: 읍면동,
      리: 리raw ? 리raw.split(String.fromCharCode(124)) : [],
      료: ssNum(body[i][4]),
      권역: ssText(body[i][5]) || '도서'
    });
  }
  return out;
}
/* ══════════════════════════════════════════════════════════════
 *  판매현황은 이 시트에서만 읽는다 — 확인용
 *  ★ 2026-09-09 · 2026-09-10 바깥 시트 길을 없앰
 *
 *  > "이 시트 안으로 옮겨줘"  (9/9)
 *  > "그냥 붙여넣기 한다고했자나.. 쓰려다가 꼬일뻔 했자나"  (9/10)
 *
 *  ★ 9/9 에 왜 안 옮겨졌나 ★
 *    그때는 «바꾸는 메뉴»를 만들고 코드 기본값도 「이 시트」로 바꿨다.
 *    그런데 ssio_config() 는 이미 있는 설정 값을 안 건드린다 — 그래야
 *    사람이 정한 값이 안 날아간다. 그래서 설정 탭에 남아 있던 옛 시트 ID 가
 *    그대로 이겼고, 오늘도 바깥 시트를 읽어 판매현황 탭을 덮어썼다.
 *    **기본값을 바꾸고 스위치를 만드는 것으로는 안 된다.** 길을 없앴다.
 *
 *  이제 이 함수는 어디서 읽는지 보여 주기만 하고, 설정에 남은 옛 줄을 치운다.
 * ══════════════════════════════════════════════════════════════ */

/**
 * 판매현황이 어디서 오는지 보여 준다. **이 시트뿐이다.**
 *
 * 바꾸는 기능은 없앴다(2026-09-10). 대신 설정 탭에 남아 있는 옛 줄을
 * 여기서 치운다 — 값이 남아 있으면 다음에 또 이 자리를 의심하게 된다.
 */
function ss_판매현황원천() {
  var NL = String.fromCharCode(10);
  var 이탭 = ssio_ss().getSheetByName(SSIO_TABS.입력);
  var 이탭행 = 이탭 ? Math.max(0, 이탭.getLastRow() - 1) : 0;
  var 치움 = _sssrc_retireOldSource_();

  return ssio_alert('판매현황은 **이 시트**에서만 읽습니다.' + NL + NL +
    '  탭 「' + SSIO_TABS.입력 + '」  현재 ' + 이탭행 + '행' + NL + NL +
    '이카운트 판매현황을 그 탭에 붙여넣고 「▶ 세트분리 실행」 을 누르세요.' + NL +
    '바깥 시트에서 가져오는 길은 없앴습니다 (2026-09-10).' +
    (치움 ? NL + NL + '설정에 남아 있던 옛 원천 줄을 치웠습니다:' + NL + '  ' + 치움 : ''));
}

/**
 * 설정 탭에 남아 있는 「판매현황_원천시트ID / _원천탭」의 값을 비우고
 * 「안 씁니다」로 적어 둔다. 줄 자체는 안 지운다 — 옛 주소를 남겨 두면
 * 나중에 "그 시트가 뭐였지" 를 다시 찾을 수 있다.
 *
 * @return {string} 치운 내용 (없으면 '')
 */
function _sssrc_retireOldSource_() {
  var sh = ssio_ss().getSheetByName(SSIO_TABS.설정);
  if (!sh) return '';
  var last = sh.getLastRow();
  if (last < 2) return '';
  var rows = sh.getRange(2, 1, last - 1, 3).getValues();
  var 자국 = [];
  for (var i = 0; i < rows.length; i++) {
    var k = ssText(rows[i][0]);
    if (k !== '판매현황_원천시트ID' && k !== '판매현황_원천탭') continue;
    var v = ssText(rows[i][1]);
    if (!v) continue;
    sh.getRange(i + 2, 2).setValue('');
    sh.getRange(i + 2, 3).setValue('안 씁니다 — 판매현황은 이 시트 탭만 읽습니다 ' +
      '(2026-09-10 없앰 · 옛 값 ' + v + ')');
    자국.push(k + ' = ' + v);
  }
  return 자국.join(' · ');
}
