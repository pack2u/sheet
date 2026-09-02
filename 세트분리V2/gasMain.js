/**
 * gasMain.js — 메뉴 · 설치 · 실행
 *
 * 운영 순서
 *   1) 마스터 새로고침   (하루 1회 또는 품목/재고가 바뀐 뒤)
 *   2) 판매현황 붙여넣기 (이카운트 판매현황 엑셀 그대로)
 *   3) 세트분리 실행     (한 번에 전 구간 계산 + 출력 + 이력 적재)
 */

var SS_SUMMARY_HEADER = ['항목', '값'];
var SS_RUNLOG_HEADER = ['회차키', '실행시각', '입력행', '분해행', '합포장흡수', '출력행',
  '롯데택배', '도서산간', '도서산간(위탁)', '동네배송', '대리발송', '합배송', '보류', '경고', '소요(초)', '버전'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧩 세트분리 V2')
    .addItem('▶ 세트분리 실행', 'ss_실행')
    .addSeparator()
    .addItem('① 마스터 새로고침', 'ss_마스터새로고침')
    .addItem('② 판매현황 비우기', 'ss_판매현황비우기')
    .addItem('📥 판매현황 입력 시트 준비 / 링크', 'ss_입력시트준비')
    .addItem('🏝 도서산간 목록 심기 (1회)', 'ss_도서산간심기')
    .addItem('🧹 합배송조건 정리 / 검증', 'ss_합배송조건정리')
    .addSeparator()
    .addItem('📮 우편번호 자동조회 (카카오)', 'ss_우편번호채우기')
    .addItem('🔑 카카오 API 키 설정', 'ss_카카오키설정')
    .addSeparator()
    .addItem('🔍 검증 (행수 대조)', 'ss_검증')
    .addItem('🛠 시트 설치 / 복구', 'ss_설치')
    .addToUi();
}

/* ── 설치 ─────────────────────────────────────────────── */

function ss_설치() {
  var t0 = new Date().getTime();
  ssio_config(); // 설정 탭 생성 + 기본값

  ssio_sheet(SSIO_TABS.입력, SS_SALES_COLS);
  ssio_styleHeader(ssio_ss().getSheetByName(SSIO_TABS.입력), SS_SALES_COLS.length, { bg: '#3b3b3b' });

  for (var i = 0; i < SSIO_TABS.출력.length; i++) {
    var on = SSIO_TABS.출력[i];
    var isIsland = (on === SS_ROUTE.LOTTE_ISLAND || on === SS_ROUTE.LOTTE_ISLAND_CONSIGN);
    var oh = isIsland ? SS_ISLAND_HEADER : SS_OUT_HEADER;
    var osh = ssio_sheet(on, oh);
    osh.getRange(1, 1, 1, oh.length).setValues([oh]);
    ssio_styleHeader(osh, oh.length, isIsland ? { bg: '#4a3a6b' } : null);
  }
  ssio_sheet(SSIO_TABS.합배송, SS_MERGED_HEADER);
  ssio_styleHeader(ssio_ss().getSheetByName(SSIO_TABS.합배송), SS_MERGED_HEADER.length, { bg: '#2c4f6b' });
  var oldHold = ssio_ss().getSheetByName('보류');
  if (oldHold && !ssio_ss().getSheetByName(SSIO_TABS.보류)) oldHold.setName(SSIO_TABS.보류);
  ssio_sheet(SSIO_TABS.보류, SS_HOLD_HEADER);
  ssio_styleHeader(ssio_ss().getSheetByName(SSIO_TABS.보류), SS_HOLD_HEADER.length, { bg: '#7a2e22' });
  ssio_sheet(SSIO_TABS.경고, SS_WARN_HEADER);
  ssio_styleHeader(ssio_ss().getSheetByName(SSIO_TABS.경고), SS_WARN_HEADER.length, { bg: '#7a5b12' });
  ssio_sheet(SSIO_TABS.요약, SS_SUMMARY_HEADER);
  ssio_sheet(SSIO_TABS.원장, SS_LEDGER_HEADER);
  ssio_sheet(SSIO_TABS.실행이력, SS_RUNLOG_HEADER);
  ssio_sheet(SSIO_TABS.회차, SS_ROUND_HEADER);

  ssio_sheet(SSIO_TABS.M품목, SSM_ITEM_HEADER);
  ssio_sheet(SSIO_TABS.M재고, SSM_STOCK_HEADER);
  ssio_sheet(SSIO_TABS.MBOM, SSM_BOM_HEADER);
  ssio_sheet(SSIO_TABS.M배송비, SS_FEE_RULE_HEADER);
  ssio_sheet(SSIO_TABS.합배송조건, SSM_COND_HEADER);
  ssio_sheet(SSIO_TABS.분리예외, SSM_EXCEPT_HEADER);
  ssio_sheet(SSIO_TABS.도서산간시군, SSM_ISL_KW_HEADER);
  ssio_sheet(SSIO_TABS.도서산간우편, SSM_ISL_ZIP_HEADER);
  ssio_sheet(SSIO_TABS.도서산간사전, SSM_ISL_DICT_HEADER);
  ssio_sheet(SSIO_TABS.동네배송, SSM_LOCAL_HEADER);

  // 기본 시트1 정리
  var junk = ssio_ss().getSheetByName('시트1') || ssio_ss().getSheetByName('Sheet1');
  if (junk && ssio_ss().getSheets().length > 1 && junk.getLastRow() === 0) ssio_ss().deleteSheet(junk);

  ss_탭정렬();
  ssio_toast('설치 완료 (' + ((new Date().getTime() - t0) / 1000).toFixed(1) + '초)');
}

function ss_탭정렬() {
  var order = [SSIO_TABS.입력].concat(SSIO_TABS.출력).concat([
    SSIO_TABS.합배송, SSIO_TABS.보류, SSIO_TABS.경고, SSIO_TABS.요약,
    SSIO_TABS.합배송조건, SSIO_TABS.분리예외, SSIO_TABS.도서산간사전,
    SSIO_TABS.설정,
    SSIO_TABS.M품목, SSIO_TABS.M배송비, SSIO_TABS.M재고, SSIO_TABS.MBOM,
    SSIO_TABS.도서산간시군, SSIO_TABS.도서산간우편, SSIO_TABS.동네배송,
    SSIO_TABS.회차, SSIO_TABS.원장, SSIO_TABS.실행이력
  ]);
  var ss = ssio_ss();
  for (var i = 0; i < order.length; i++) {
    var sh = ss.getSheetByName(order[i]);
    if (!sh) continue;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  }
  ss.setActiveSheet(ss.getSheetByName(SSIO_TABS.입력));
}

/* ── 마스터 ───────────────────────────────────────────── */

function ss_마스터새로고침() {
  var t0 = new Date().getTime();
  try {
    var r = ssm_refreshAll();
    var lines = r.report.map(function (x) {
      return '  · ' + x[0] + ' : ' + x[1] + (typeof x[1] === 'number' ? '행' : '');
    }).join('\n');
    if (r.warnings.length) {
      ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,
        r.warnings.map(function (w) { return [w[0], w[1], w[2], w[3]]; }), { bg: '#7a5b12' });
    }
    ssio_alert('마스터 새로고침 완료 (' + ((new Date().getTime() - t0) / 1000).toFixed(1) + '초)\n\n' +
      lines + '\n\n경고 ' + r.warnings.length + '건' +
      (r.warnings.length ? ' — 「경고」 탭을 확인하세요.' : ''));
  } catch (e) {
    ssio_alert('마스터 새로고침 실패\n\n' + e.message +
      '\n\n※ 실패한 채로 실행하면 안 됩니다. 이전 마스터가 그대로 남아 있습니다.');
    throw e;
  }
}

function ss_판매현황비우기() {
  var where = ssm_clearSales(ssio_config());
  ssio_alert('판매현황을 비웠습니다.\n\n  ' + where + '\n\n이카운트 판매현황을 붙여넣은 뒤 「▶ 세트분리 실행」 하세요.');
}

/* ── 실행 ─────────────────────────────────────────────── */

function ss_실행() {
  var t0 = new Date().getTime();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) { ssio_alert('다른 실행이 진행 중입니다.'); return; }

  try {
    var cfgRaw = ssio_config();
    var cfg = {
      자사출고지접두: cfgRaw['자사출고지접두'] || SS_DEFAULT_CONFIG.자사출고지접두,
      합배송출고지: cfgRaw['합배송출고지'] || SS_DEFAULT_CONFIG.합배송출고지,
      위탁출고지: cfgRaw['위탁출고지'] || SS_DEFAULT_CONFIG.위탁출고지,
      허용상태: cfgRaw['허용상태'] || SS_DEFAULT_CONFIG.허용상태,
      보내는주소: cfgRaw['보내는주소'] || SS_DEFAULT_CONFIG.보내는주소,
      대표전화: cfgRaw['대표전화'] || SS_DEFAULT_CONFIG.대표전화,
      도서산간_미확인: cfgRaw['도서산간_미확인'] || SS_DEFAULT_CONFIG.도서산간_미확인,
      동네배송_사용: cfgRaw['동네배송_사용'] || SS_DEFAULT_CONFIG.동네배송_사용,
      도서산간_판정: cfgRaw['도서산간_판정'] || SS_DEFAULT_CONFIG.도서산간_판정,
      전화주문_고유ID: cfgRaw['전화주문_고유ID'] || SS_DEFAULT_CONFIG.전화주문_고유ID
    };

    var sales;
    try {
      sales = ssm_readSales(cfgRaw);
    } catch (e) {
      ssio_alert('판매현황을 읽지 못했습니다.\n\n' + e.message);
      return;
    }
    var grid = sales.grid;
    if (grid.length < 2) { ssio_alert('판매현황이 비어 있습니다. (' + sales.원천 + ')'); return; }

    // 재고는 실행 시점 값이어야 한다 (구 시트의 IMPORTRANGE 와 같은 신선도)
    var pre = ssm_refreshBeforeRun(cfgRaw);

    var masters = ssm_load();
    if (!Object.keys(masters.items).length) {
      ssio_alert('품목 마스터가 비어 있습니다. 먼저 「① 마스터 새로고침」을 실행하세요.');
      return;
    }

    var res = ssRun(grid, masters, cfg);

    for (var pw = 0; pw < pre.warnings.length; pw++) {
      ssWarn(res.warnings, pre.warnings[pw][0], pre.warnings[pw][1], pre.warnings[pw][2], pre.warnings[pw][3]);
    }
    var 재고나이 = ssm_stampAgeHours('재고');
    if (재고나이 > 6) {
      ssWarn(res.warnings, '주의', 'STOCK_STALE', ssm_stampOf('재고'),
        '재고 기준시각이 ' + 재고나이.toFixed(1) + '시간 전입니다. 부족수량이 실제와 다를 수 있습니다.');
    }

    // 주소마다 우편번호를 한 번씩만 구해 사전에 쌓는다.
    // 사전이 채워지면 파이프라인을 한 번 더 돌려 그 결과로 판정한다.
    var 재실행 = '';
    var added = ssm_addAddresses(res.units, masters, ssNum(cfgRaw['우편번호_최대조회']) || 300);
    var zr = { filled: 0, island: 0, failed: [], noKey: false, tried: 0 };
    if (added || ssz_hasPending()) {
      zr = ssz_fillDictionary(ssNum(cfgRaw['우편번호_최대조회']) || 300);
      if (zr.noKey) {
        재실행 = '카카오 API 키 없음 — 조회 안 함';
        ssWarn(res.warnings, '오류', 'ZIP_NOKEY', '',
          '카카오 API 키가 없어 우편번호를 구하지 못했습니다. 메뉴 → 🔑 카카오 API 키 설정');
      } else if (zr.filled) {
        masters = ssm_load();
        res = ssRun(grid, masters, cfg);
        재실행 = '신규 주소 ' + zr.filled + '건 우편번호 조회 후 재계산 (도서산간 ' + zr.island + ')';
      }
      if (!zr.noKey && !zr.filled && !zr.tried) {
        재실행 = '조회할 신규 주소 없음';
      } else if (!zr.noKey && zr.tried && !zr.filled) {
        재실행 = '신규 주소 ' + zr.tried + '건 조회했으나 전부 실패';
      }
      if (zr.failed && zr.failed.length) {
        ssWarn(res.warnings, '주의', 'ZIP_FAIL', zr.failed.slice(0, 3).join(' / '),
          '카카오가 못 찾은 주소 ' + zr.failed.length + '건. 「도서산간_주소사전」에 직접 입력하면 다음 회차부터 반영됩니다.');
      }
    }

    var now = new Date();
    var 회차 = ss_회차확정(res.stats.지문, res.stats.입력행);
    var runKey = 회차.key;
    var at = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    var 지운행 = 회차.재실행 ? ss_원장회차삭제(runKey) : 0;

    // 출력 탭
    for (var i = 0; i < SSIO_TABS.출력.length; i++) {
      var name = SSIO_TABS.출력[i];
      var bucket = res.buckets[name] || [];
      if (name === SS_ROUTE.LOTTE_ISLAND || name === SS_ROUTE.LOTTE_ISLAND_CONSIGN) {
        ssio_write(name, SS_ISLAND_HEADER, bucket.map(ssIslandRow), { bg: '#4a3a6b' });
      } else {
        ssio_write(name, SS_OUT_HEADER, bucket.map(ssOutRow));
      }
    }
    ssio_write(SSIO_TABS.합배송, SS_MERGED_HEADER,
      (res.buckets[SS_ROUTE.MERGED] || []).map(ssMergedRow), { bg: '#2c4f6b' });

    var holdRows = (res.buckets[SS_ROUTE.HOLD] || []).map(function (u) {
      return ssOutRow(u).concat([u.보류사유, u.보류상세]);
    });
    ssio_write(SSIO_TABS.보류, SS_HOLD_HEADER, holdRows, { bg: '#7a2e22' });

    // 경고
    ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,
      res.warnings.map(function (w) { return [w.level, w.code, w.target, w.msg]; }), { bg: '#7a5b12' });

    // 이력
    var ledger = res.units.map(function (u) { return ssLedgerRow(u, runKey, at); });
    ssio_append(SSIO_TABS.원장, SS_LEDGER_HEADER, ledger);   // 회차당 한 벌만 남는다

    var sec = ((new Date().getTime() - t0) / 1000);
    ssio_append(SSIO_TABS.실행이력, SS_RUNLOG_HEADER, [[
      runKey, at, res.stats.입력행, res.stats.분해행, res.stats.합포장흡수, res.stats.출력행,
      res.stats['탭_' + SS_ROUTE.LOTTE], res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND],
      res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND_CONSIGN], res.stats['탭_' + SS_ROUTE.LOTTE_LOCAL],
      res.stats['탭_' + SS_ROUTE.PARTNER], res.stats['탭_' + SS_ROUTE.MERGED],
      res.stats.보류, res.warnings.length,
      sec.toFixed(1), SS_VERSION
    ]]);

    // 요약
    var sum = [
      ['회차키', runKey],
      ['회차 구분', 회차.재실행 ? '재실행 — 원장 ' + 지운행 + '행 교체' : '신규 ' + 회차.no + '회차'],
      ['실행시각', at],
      ['판매현황 원천', sales.원천], ['소요(초)', sec.toFixed(1)],
      ['입력행(판매현황)', res.stats.입력행],
      ['세트분해 후 행', res.stats.분해행],
      ['합포장으로 흡수된 행', res.stats.합포장흡수],
      ['탭 행 합계', res.stats.출력행],
      ['검증 · 분해 = 탭 합계', (res.stats.분해행 === res.stats.출력행) ? 'OK' : '불일치!'],
      ['실제 송장 건수', res.stats.송장건수],
      ['우편번호 자동조회', 재실행 || '해당 없음'],
      ['  신규 주소 추가', added],
      ['  조회 시도 / 성공 / 실패', zr.tried + ' / ' + zr.filled + ' / ' + (zr.failed ? zr.failed.length : 0)],
      ['  카카오 키', ssz_key() ? '설정됨' : '없음  ← 도서산간 판정 불가'],
      ['실행전 마스터갱신', pre.mode],
      ['재고 기준시각', ssm_stampOf('재고') || '(모름)'],
      ['품목정보 기준시각', ssm_stampOf('품목정보') || '(모름)']
    ];
    for (var b = 0; b < SSIO_TABS.출력.length; b++) {
      sum.push([SSIO_TABS.출력[b], res.stats['탭_' + SSIO_TABS.출력[b]]]);
    }
    sum.push([SSIO_TABS.합배송 + ' (대표+동봉)', res.stats['탭_' + SS_ROUTE.MERGED]]);
    sum.push([SSIO_TABS.보류, res.stats.보류]);
    sum.push(['경고', res.warnings.length]);
    ssio_write(SSIO_TABS.요약, SS_SUMMARY_HEADER, sum);

    var 대표 = res.stats['탭_' + SS_ROUTE.MERGED] - res.stats.합포장흡수;
    var msg = '세트분리 완료 · ' + sec.toFixed(1) + '초\n' +
      '회차 ' + runKey + (회차.재실행 ? '  (재실행 — 원장 ' + 지운행 + '행 교체)' : '  (신규)') + '\n\n' +
      '입력 ' + res.stats.입력행 + '행 → 분해 ' + res.stats.분해행 + '행\n' +
      '실제 송장 ' + res.stats.송장건수 + '건   (탭 합계 ' + res.stats.출력행 +
      ' = 분해행 ' + (res.stats.분해행 === res.stats.출력행 ? '✔' : '✘') + ')\n\n' +
      '  롯데택배 ' + res.stats['탭_' + SS_ROUTE.LOTTE] + '\n' +
      '  도서산간 ' + res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND] + ss_권역요약(res) +
      ' · 도서산간(위탁) ' + res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND_CONSIGN] +
      ' · 동네배송 ' + res.stats['탭_' + SS_ROUTE.LOTTE_LOCAL] + '\n' +
      '  대리발송 ' + res.stats['탭_' + SS_ROUTE.PARTNER] + '\n' +
      '  합배송 ' + res.stats['탭_' + SS_ROUTE.MERGED] + '행 → 박스 ' + 대표 +
      '개 (대표 ' + 대표 + ' + 동봉 ' + res.stats.합포장흡수 + ')\n' +
      '  보류(미발송) ' + res.stats.보류 +
      (res.stats.보류 ? '   ← 우편번호: ' + (재실행 || '해당 없음') : '') + '\n\n' +
      '경고 ' + res.warnings.length + '건\n' +
      '재고 기준 ' + (ssm_stampOf('재고') || '모름');
    ssio_alert(msg + (res.stats.보류 ? '\n\n※ 「보류(미발송)」 탭을 반드시 확인하세요. 사유가 적혀 있습니다.' : ''));
  } finally {
    lock.releaseLock();
  }
}

/* ── 검증 ─────────────────────────────────────────────── */

function ss_검증() {
  var ss = ssio_ss();

  // 탭별 (순번, 품목코드) 열 위치 — 합배송은 앞에 3열(구분·실제경로·합포장키)이 더 있다
  var tabs = [];
  for (var i = 0; i < SSIO_TABS.출력.length; i++) {
    var vn = SSIO_TABS.출력[i];
    var off = (vn === SS_ROUTE.LOTTE_ISLAND || vn === SS_ROUTE.LOTTE_ISLAND_CONSIGN) ? 3 : 0;
    tabs.push({ name: vn, seq: 2 + off, code: 4 + off });
  }
  tabs.push({ name: SSIO_TABS.합배송, seq: 5, code: 7, merged: true });
  tabs.push({ name: SSIO_TABS.보류, seq: 2, code: 4 });

  var lines = [], 합계 = 0, 동봉 = 0, seen = {}, dup = [];

  for (var t = 0; t < tabs.length; t++) {
    var sh = ss.getSheetByName(tabs[t].name);
    var n = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
    합계 += n;
    lines.push('  ' + tabs[t].name + ' : ' + n);
    if (!sh || n === 0) continue;

    var seqCol = sh.getRange(2, tabs[t].seq, n, 1).getValues();
    var codeCol = sh.getRange(2, tabs[t].code, n, 1).getValues();
    for (var r = 0; r < n; r++) {
      var key = ssText(seqCol[r][0]) + '|' + ssText(codeCol[r][0]);
      if (key === '|') continue;
      if (seen[key]) dup.push(key + ' (' + seen[key] + ' <-> ' + tabs[t].name + ')');
      else seen[key] = tabs[t].name;
    }
    if (tabs[t].merged) {
      var kind = sh.getRange(2, 1, n, 1).getValues();
      for (var q = 0; q < n; q++) if (ssText(kind[q][0]) === '동봉') 동봉++;
    }
  }

  // 원장의 마지막 회차 분해행과 대조 — 한 행도 사라지지 않았는지 본다
  var 원장 = -1, 회차 = '';
  var lg = ss.getSheetByName(SSIO_TABS.원장);
  if (lg && lg.getLastRow() > 1) {
    var keys = lg.getRange(2, 1, lg.getLastRow() - 1, 1).getValues();
    회차 = ssText(keys[keys.length - 1][0]);
    원장 = 0;
    for (var k = 0; k < keys.length; k++) if (ssText(keys[k][0]) === 회차) 원장++;
  }

  var msg = '검증 결과\n\n' +
    '탭 합계 : ' + 합계 + '행\n' +
    '실제 송장 : ' + (합계 - 동봉) + '건  (합배송 동봉 ' + 동봉 + '행은 송장이 나가지 않음)\n';
  if (원장 >= 0) {
    msg += '원장 ' + 회차 + ' 회차 분해행 : ' + 원장 + '\n' +
      '보존 검증 : ' + (원장 === 합계 ? 'OK — 한 행도 사라지지 않았습니다' :
        '불일치! 원장 ' + 원장 + ' ≠ 탭 합계 ' + 합계) + '\n';
  }
  msg += '\n' + lines.join('\n') +
    '\n\n탭 간 중복 라인 : ' + dup.length +
    (dup.length ? '  <- 문제!\n  ' + dup.slice(0, 8).join('\n  ') : '  (정상)');

  ssio_alert(msg);
}

/** 도서산간 건의 권역 분포를 " (제주 2 · 도서 1)" 같은 꼬리표로 만든다 */
function ss_권역요약(res) {
  var z = {};
  var list = (res.buckets[SS_ROUTE.LOTTE_ISLAND] || []).concat(res.buckets[SS_ROUTE.LOTTE_ISLAND_CONSIGN] || []);
  for (var i = 0; i < list.length; i++) {
    var k = list[i].도서권역 || '미상';
    z[k] = (z[k] || 0) + 1;
  }
  var parts = [];
  for (var n in z) if (Object.prototype.hasOwnProperty.call(z, n)) parts.push(n + ' ' + z[n]);
  return parts.length ? ' (' + parts.join(' · ') + ')' : '';
}

/* ── 회차 ─────────────────────────────────────────────── */

var SS_ROUND_HEADER = ['회차키', '지문', '일자', '회차', '입력행', '최초실행', '마지막실행', '실행횟수'];

/**
 * 판매현황 지문으로 회차를 정한다.
 *   같은 지문  → 같은 회차 (재실행). 원장의 그 회차 기록을 지우고 다시 쓴다.
 *   다른 지문  → 그날의 다음 회차 (260902-1 → 260902-2)
 * 실행 버튼을 몇 번 누르든 원장에는 회차당 한 벌만 남는다.
 */
function ss_회차확정(지문, 입력행) {
  var sh = ssio_sheet(SSIO_TABS.회차, SS_ROUND_HEADER);
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd');
  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  var rows = ssio_body(SSIO_TABS.회차);

  for (var i = 0; i < rows.length; i++) {
    if (ssText(rows[i][1]) !== 지문) continue;
    sh.getRange(i + 2, 5, 1, 4).setValues([[입력행, ssText(rows[i][5]) || now, now, ssNum(rows[i][7]) + 1]]);
    return { key: ssText(rows[i][0]), no: ssNum(rows[i][3]), 재실행: true };
  }

  var n = 0;
  for (var j = 0; j < rows.length; j++) if (ssText(rows[j][2]) === today) n++;
  var no = n + 1;
  var key = today + '-' + no;
  sh.getRange(sh.getLastRow() + 1, 1, 1, SS_ROUND_HEADER.length)
    .setValues([[key, 지문, today, no, 입력행, now, now, 1]]);
  return { key: key, no: no, 재실행: false };
}

/** 원장에서 이 회차 기록을 걷어낸다 (재실행 시 중복 방지) */
function ss_원장회차삭제(회차키) {
  var sh = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!sh || sh.getLastRow() < 2) return 0;
  var keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var first = -1, last = -1, count = 0;
  for (var i = 0; i < keys.length; i++) {
    if (ssText(keys[i][0]) !== 회차키) continue;
    if (first < 0) first = i;
    last = i;
    count++;
  }
  if (!count) return 0;
  if (last - first + 1 === count) {
    sh.deleteRows(first + 2, count);   // 연속 블록 — 보통 이 경우다
    return count;
  }
  var all = sh.getRange(2, 1, sh.getLastRow() - 1, SS_LEDGER_HEADER.length).getValues();
  var keep = [];
  for (var j = 0; j < all.length; j++) if (ssText(all[j][0]) !== 회차키) keep.push(all[j]);
  ssio_clearBody(sh);
  if (keep.length) sh.getRange(2, 1, keep.length, SS_LEDGER_HEADER.length).setValues(keep);
  return count;
}
