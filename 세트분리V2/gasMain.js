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
  '롯데택배', '도서산간', '도서산간(위탁)', '동네배송', '대리발송', '보류', '경고', '소요(초)', '버전'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧩 세트분리 V2')
    .addItem('▶ 세트분리 실행', 'ss_실행')
    .addSeparator()
    .addItem('① 마스터 새로고침', 'ss_마스터새로고침')
    .addItem('② 판매현황 비우기', 'ss_판매현황비우기')
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
    ssio_sheet(SSIO_TABS.출력[i], SS_OUT_HEADER);
    ssio_styleHeader(ssio_ss().getSheetByName(SSIO_TABS.출력[i]), SS_OUT_HEADER.length);
  }
  ssio_sheet(SSIO_TABS.보류, SS_HOLD_HEADER);
  ssio_styleHeader(ssio_ss().getSheetByName(SSIO_TABS.보류), SS_HOLD_HEADER.length, { bg: '#7a2e22' });
  ssio_sheet(SSIO_TABS.경고, SS_WARN_HEADER);
  ssio_styleHeader(ssio_ss().getSheetByName(SSIO_TABS.경고), SS_WARN_HEADER.length, { bg: '#7a5b12' });
  ssio_sheet(SSIO_TABS.요약, SS_SUMMARY_HEADER);
  ssio_sheet(SSIO_TABS.원장, SS_LEDGER_HEADER);
  ssio_sheet(SSIO_TABS.실행이력, SS_RUNLOG_HEADER);

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
    SSIO_TABS.보류, SSIO_TABS.경고, SSIO_TABS.요약,
    SSIO_TABS.합배송조건, SSIO_TABS.분리예외, SSIO_TABS.도서산간사전,
    SSIO_TABS.설정,
    SSIO_TABS.M품목, SSIO_TABS.M배송비, SSIO_TABS.M재고, SSIO_TABS.MBOM,
    SSIO_TABS.도서산간시군, SSIO_TABS.도서산간우편, SSIO_TABS.동네배송,
    SSIO_TABS.원장, SSIO_TABS.실행이력
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
  var ui = SpreadsheetApp.getUi();
  try {
    var r = ssm_refreshAll();
    var lines = r.report.map(function (x) { return '  · ' + x[0] + ' : ' + x[1] + '행'; }).join('\n');
    if (r.warnings.length) {
      ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,
        r.warnings.map(function (w) { return [w[0], w[1], w[2], w[3]]; }), { bg: '#7a5b12' });
    }
    ui.alert('마스터 새로고침 완료 (' + ((new Date().getTime() - t0) / 1000).toFixed(1) + '초)\n\n' +
      lines + '\n\n경고 ' + r.warnings.length + '건' +
      (r.warnings.length ? ' — 「경고」 탭을 확인하세요.' : ''));
  } catch (e) {
    ui.alert('마스터 새로고침 실패\n\n' + e.message +
      '\n\n※ 실패한 채로 실행하면 안 됩니다. 이전 마스터가 그대로 남아 있습니다.');
    throw e;
  }
}

function ss_판매현황비우기() {
  var sh = ssio_sheet(SSIO_TABS.입력, SS_SALES_COLS);
  ssio_clearBody(sh);
  ssio_toast('판매현황을 비웠습니다. 이카운트 판매현황을 2행부터 붙여넣으세요.');
}

/* ── 실행 ─────────────────────────────────────────────── */

function ss_실행() {
  var t0 = new Date().getTime();
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) { ui.alert('다른 실행이 진행 중입니다.'); return; }

  try {
    var cfgRaw = ssio_config();
    var cfg = {
      자사출고지접두: cfgRaw['자사출고지접두'] || SS_DEFAULT_CONFIG.자사출고지접두,
      합배송출고지: cfgRaw['합배송출고지'] || SS_DEFAULT_CONFIG.합배송출고지,
      위탁출고지: cfgRaw['위탁출고지'] || SS_DEFAULT_CONFIG.위탁출고지,
      허용상태: cfgRaw['허용상태'] || SS_DEFAULT_CONFIG.허용상태,
      보내는주소: cfgRaw['보내는주소'] || SS_DEFAULT_CONFIG.보내는주소,
      대표전화: cfgRaw['대표전화'] || SS_DEFAULT_CONFIG.대표전화,
      도서산간_미확인: cfgRaw['도서산간_미확인'] || SS_DEFAULT_CONFIG.도서산간_미확인
    };

    var grid = ssio_values(SSIO_TABS.입력);
    if (grid.length < 2) { ui.alert('판매현황 탭이 비어 있습니다.'); return; }

    var masters = ssm_load();
    if (!Object.keys(masters.items).length) {
      ui.alert('품목 마스터가 비어 있습니다. 먼저 「① 마스터 새로고침」을 실행하세요.');
      return;
    }

    var res = ssRun(grid, masters, cfg);

    var now = new Date();
    var runKey = Utilities.formatDate(now, 'Asia/Seoul', 'yyMMdd-HHmm');
    var at = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');

    // 출력 탭
    for (var i = 0; i < SSIO_TABS.출력.length; i++) {
      var name = SSIO_TABS.출력[i];
      var rows = (res.buckets[name] || []).map(ssOutRow);
      ssio_write(name, SS_OUT_HEADER, rows);
    }
    var holdRows = (res.buckets[SS_ROUTE.HOLD] || []).map(function (u) {
      return ssOutRow(u).concat([u.보류사유, u.보류상세]);
    });
    ssio_write(SSIO_TABS.보류, SS_HOLD_HEADER, holdRows, { bg: '#7a2e22' });

    // 도서산간 후보 주소를 사전에 추가
    var added = ssm_addIslandCandidates(res.units, masters);
    if (added) {
      ssWarn(res.warnings, '주의', 'ISLAND_NEW', '',
        '도서산간 후보 주소 ' + added + '건을 「도서산간_주소사전」에 추가했습니다. 우편번호를 채운 뒤 다시 실행하세요.');
    }

    // 경고
    ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,
      res.warnings.map(function (w) { return [w.level, w.code, w.target, w.msg]; }), { bg: '#7a5b12' });

    // 이력
    var ledger = res.units.map(function (u) { return ssLedgerRow(u, runKey, at); });
    ssio_append(SSIO_TABS.원장, SS_LEDGER_HEADER, ledger);

    var sec = ((new Date().getTime() - t0) / 1000);
    ssio_append(SSIO_TABS.실행이력, SS_RUNLOG_HEADER, [[
      runKey, at, res.stats.입력행, res.stats.분해행, res.stats.합포장흡수, res.stats.출력행,
      res.stats['탭_' + SS_ROUTE.LOTTE], res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND],
      res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND_CONSIGN], res.stats['탭_' + SS_ROUTE.LOTTE_LOCAL],
      res.stats['탭_' + SS_ROUTE.PARTNER], res.stats.보류, res.warnings.length,
      sec.toFixed(1), SS_VERSION
    ]]);

    // 요약
    var sum = [
      ['회차키', runKey], ['실행시각', at], ['소요(초)', sec.toFixed(1)],
      ['입력행(판매현황)', res.stats.입력행],
      ['세트분해 후 행', res.stats.분해행],
      ['합포장으로 흡수된 행', res.stats.합포장흡수],
      ['출력 행 합계', res.stats.출력행],
      ['검증 · 분해 = 출력 + 흡수', (res.stats.분해행 === res.stats.출력행 + res.stats.합포장흡수) ? 'OK' : '불일치!']
    ];
    for (var b = 0; b < SSIO_TABS.출력.length; b++) {
      sum.push([SSIO_TABS.출력[b], res.stats['탭_' + SSIO_TABS.출력[b]]]);
    }
    sum.push([SSIO_TABS.보류, res.stats.보류]);
    sum.push(['경고', res.warnings.length]);
    ssio_write(SSIO_TABS.요약, SS_SUMMARY_HEADER, sum);

    var msg = '세트분리 완료 · ' + sec.toFixed(1) + '초\n\n' +
      '입력 ' + res.stats.입력행 + '행 → 분해 ' + res.stats.분해행 + '행\n' +
      '출력 ' + res.stats.출력행 + '행 (합포장 흡수 ' + res.stats.합포장흡수 + '행)\n' +
      '  롯데택배 ' + res.stats['탭_' + SS_ROUTE.LOTTE] +
      ' · 도서산간 ' + res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND] +
      ' · 도서산간(위탁) ' + res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND_CONSIGN] +
      ' · 동네배송 ' + res.stats['탭_' + SS_ROUTE.LOTTE_LOCAL] +
      ' · 대리발송 ' + res.stats['탭_' + SS_ROUTE.PARTNER] + '\n' +
      '보류 ' + res.stats.보류 + '행 · 경고 ' + res.warnings.length + '건';
    ui.alert(msg + (res.stats.보류 ? '\n\n※ 「보류」 탭을 반드시 확인하세요. 사유가 적혀 있습니다.' : ''));
  } finally {
    lock.releaseLock();
  }
}

/* ── 검증 ─────────────────────────────────────────────── */

function ss_검증() {
  var ss = ssio_ss();
  var lines = [];
  var 입력 = Math.max(0, (ss.getSheetByName(SSIO_TABS.입력) || { getLastRow: function () { return 0; } }).getLastRow() - 2);
  var 합계 = 0;
  var names = SSIO_TABS.출력.concat([SSIO_TABS.보류]);
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    var n = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
    합계 += n;
    lines.push('  ' + names[i] + ' : ' + n);
  }
  // 출력 탭 사이 중복 (같은 라인이 두 탭에 있는지)
  var seen = {}, dup = 0;
  for (var j = 0; j < SSIO_TABS.출력.length; j++) {
    var s2 = ss.getSheetByName(SSIO_TABS.출력[j]);
    if (!s2 || s2.getLastRow() < 2) continue;
    var v = s2.getRange(2, 2, s2.getLastRow() - 1, 3).getValues(); // 순번, 일자, 품목코드
    for (var k = 0; k < v.length; k++) {
      var key = ssText(v[k][0]) + '|' + ssText(v[k][2]);
      if (seen[key]) dup++; else seen[key] = true;
    }
  }
  SpreadsheetApp.getUi().alert(
    '검증 결과\n\n판매현황 데이터행 ≈ ' + 입력 + '\n출력+보류 합계 = ' + 합계 + '\n\n' +
    lines.join('\n') + '\n\n출력 탭 간 중복 라인 : ' + dup + (dup ? '  ← 문제!' : '  (정상)'));
}
