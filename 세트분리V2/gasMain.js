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
    .addItem('🩺 카카오 진단', 'ss_카카오진단')
    .addSeparator()
    .addItem('✅ 보류 조치 반영', 'ss_보류조치반영')
    .addItem('🔎 보류 조치 진단', 'ss_보류조치진단')
    .addItem('🔎 합배송 진단', 'ss_합배송진단')
    .addItem('🔁 송장 전파 (롯데 → 사방넷)', 'ss_송장전파')
    .addItem('📊 사방넷 대량등록 엑셀 저장', 'ss_사방넷엑셀저장')
    .addItem('🕵️ 중복발주 의심 점검', 'ss_중복점검')
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
  ssio_sheet(SSIO_TABS.비배송, SS_NONSHIP_HEADER);
  ssio_sheet(SSIO_TABS.사방넷송장, SS_INVOICE_HEADER);
  ssio_sheet(SSIO_TABS.사방넷등록, SS_REG_HEADER);
  ssio_styleHeader(ssio_ss().getSheetByName(SSIO_TABS.비배송), SS_NONSHIP_HEADER.length, { bg: '#4a4a4a' });
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
  ssio_sheet(SSIO_TABS.중복의심, SS_DUP_HEADER);
  ssio_sheet(SSIO_TABS.수동조치, SS_MANUAL_HEADER);
  ssio_sheet(SSIO_TABS.업체, SS_VENDOR_HEADER);
  ssm_seedVendors();

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

  // 누적 탭은 열이 늘어나면 헤더가 어긋난다. 확인해서 맞춘다.
  var moved = [];
  var mv1 = ssio_migrateHeader(SSIO_TABS.원장, SS_LEDGER_HEADER); if (mv1) moved.push(mv1);
  var mv2 = ssio_migrateHeader(SSIO_TABS.실행이력, SS_RUNLOG_HEADER); if (mv2) moved.push(mv2);
  var mv3 = ssio_migrateHeader(SSIO_TABS.수동조치, SS_MANUAL_HEADER); if (mv3) moved.push(mv3);
  var mv4 = ssio_migrateHeader(SSIO_TABS.회차, SS_ROUND_HEADER); if (mv4) moved.push(mv4);

  ss_탭정렬();
  var msg = '설치 완료 (' + ((new Date().getTime() - t0) / 1000).toFixed(1) + '초)';
  if (moved.length) {
    ssio_alert(msg + String.fromCharCode(10) + String.fromCharCode(10) +
      '열 구성이 바뀐 누적 탭을 옮기고 새로 시작합니다. 옛 자료는 그대로 남아 있습니다.' +
      String.fromCharCode(10) + '  ' + moved.join(String.fromCharCode(10) + '  '));
  } else {
    ssio_toast(msg);
  }
}

function ss_탭정렬() {
  var order = [SSIO_TABS.입력].concat(SSIO_TABS.출력).concat([
    SSIO_TABS.합배송, SSIO_TABS.사방넷송장, SSIO_TABS.사방넷등록, SSIO_TABS.비배송, SSIO_TABS.보류, SSIO_TABS.경고, SSIO_TABS.요약,
    SSIO_TABS.합배송조건, SSIO_TABS.분리예외, SSIO_TABS.업체, SSIO_TABS.수동조치, SSIO_TABS.도서산간사전,
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

/** 보류 탭에 적은 조치만 반영해 다시 계산한다 (원천을 다시 읽지 않아 회차가 그대로다) */
function ss_보류조치반영() { return ss_실행({ mirrorOnly: true }); }

function ss_실행(opts) {
  opts = opts || {};
  var t0 = new Date().getTime();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) { ssio_alert('다른 실행이 진행 중입니다.'); return; }

  var 단계 = '시작';
  try {
    단계 = '설정 읽기';
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
      전화주문_고유ID: cfgRaw['전화주문_고유ID'] || SS_DEFAULT_CONFIG.전화주문_고유ID,
      재고부족_자동대리발송: cfgRaw['재고부족_자동대리발송'] || SS_DEFAULT_CONFIG.재고부족_자동대리발송,
      비배송_품목패턴: cfgRaw['비배송_품목패턴'] || SS_DEFAULT_CONFIG.비배송_품목패턴,
      합포장_최대건수: cfgRaw['합포장_최대건수'] || SS_DEFAULT_CONFIG.합포장_최대건수
    };

    var sales;
    try {
      sales = opts.mirrorOnly
        ? { grid: ssio_values(SSIO_TABS.입력), 원천: '이 시트 (조치 반영)', 행: 0 }
        : ssm_readSales(cfgRaw);
    } catch (e) {
      ssio_alert('판매현황을 읽지 못했습니다.\n\n' + e.message);
      return;
    }
    var grid = sales.grid;
    if (grid.length < 2) { ssio_alert('판매현황이 비어 있습니다. (' + sales.원천 + ')'); return; }

    // 재고는 실행 시점 값이어야 한다 (구 시트의 IMPORTRANGE 와 같은 신선도)
    var pre = ssm_refreshBeforeRun(cfgRaw);

    // 지난 회차 「보류」 탭에 사람이 적어 넣은 조치를 먼저 걷어 온다.
    // 보류 탭은 곧 다시 쓰이므로 여기서 안 걷으면 입력이 사라진다.
    // 실행이 도중에 멈추면 출력 탭에 이전 회차 내용이 그대로 남는다.
    // 그걸 새 결과로 오해하지 않도록 시작 시점에 「진행 중」을 박아 둔다.
    ssio_write(SSIO_TABS.요약, SS_SUMMARY_HEADER, [
      ['상태', '⏳ 진행 중 — 아직 끝나지 않았습니다'],
      ['시작', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')],
      ['주의', '이 표시가 남아 있으면 출력 탭은 이전 회차 내용입니다']
    ], { bg: '#7a5b12' });

    단계 = '협력업체 표';
    ssm_seedVendors();
    // 회차를 먼저 정한다. 조치가 「어느 회차의 것인지」 묶여야
    // 되는 것부터 차례로 처리해도 앞서 반영한 건이 되돌아가지 않는다.
    단계 = '회차 확정';
    var 지문 = ssFingerprint(ssNormalize(grid, cfg, []));
    var 회차 = ss_회차확정(지문, grid.length);
    var runKey = 회차.key;

    단계 = '보류 조치 걷기';
    var 걷은조치 = ssm_captureManual(runKey);

    단계 = '마스터 읽기';
    var masters = ssm_load(runKey);
    if (!Object.keys(masters.items).length) {
      ssio_alert('품목 마스터가 비어 있습니다. 먼저 「① 마스터 새로고침」을 실행하세요.');
      return;
    }

    단계 = '계산';
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
    var 재시도일 = ssz_shouldRetryToday;   // 참조만 (아래 조건에서 호출)
    var zr = { filled: 0, island: 0, failed: [], noKey: false, tried: 0 };
    if (added || ssz_hasPending() || ssz_permanentCount() > 0) {
      zr = ssz_fillDictionary(ssNum(cfgRaw['우편번호_최대조회']) || 300, ssz_shouldRetryToday());
      if (zr.noKey) {
        재실행 = '카카오 API 키 없음 — 조회 안 함';
        ssWarn(res.warnings, '오류', 'ZIP_NOKEY', '',
          '카카오 API 키가 없어 우편번호를 구하지 못했습니다. 메뉴 → 🔑 카카오 API 키 설정');
      } else if (zr.filled) {
        masters = ssm_load(runKey);
        res = ssRun(grid, masters, cfg);
        재실행 = '신규 주소 ' + zr.filled + '건 우편번호 조회 후 재계산 (도서산간 ' + zr.island + ')';
      }
      if (!zr.noKey && !zr.filled && !zr.tried) {
        재실행 = '조회할 신규 주소 없음';
      } else if (!zr.noKey && zr.tried && !zr.filled) {
        재실행 = '신규 주소 ' + zr.tried + '건 조회했으나 전부 실패';
      }
      if (zr.stopped) {
        재실행 = '우편번호 조회 중단 — ' + zr.stopped;
        ssWarn(res.warnings, '오류', 'ZIP_BLOCKED', zr.stopped,
          '카카오 호출이 막혀 도서산간 판정을 못 했습니다. 키가 맞는지, 스크립트 권한을 다시 승인했는지 확인하세요.');
      }
      if (zr.failed && zr.failed.length) {
        var rsn = [];
        for (var rk in zr.reasons) if (Object.prototype.hasOwnProperty.call(zr.reasons, rk)) rsn.push(rk + '×' + zr.reasons[rk]);
        ssWarn(res.warnings, '주의', 'ZIP_FAIL_REASON', rsn.join(' / '), '우편번호 조회 실패 사유별 건수');
        ssWarn(res.warnings, '주의', 'ZIP_FAIL', zr.failed.slice(0, 3).join(' / '),
          '카카오가 못 찾은 주소 ' + zr.failed.length + '건. 「도서산간_주소사전」에 직접 입력하면 다음 회차부터 반영됩니다.');
      }
    }

    var now = new Date();
    var at = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    var 지운행 = ss_원장회차삭제(runKey);   // 같은 회차 기록은 항상 갈아 끼운다

    // 출력 탭
    for (var i = 0; i < SSIO_TABS.출력.length; i++) {
      var name = SSIO_TABS.출력[i];
      var bucket = res.buckets[name] || [];
      if (name === SS_ROUTE.LOTTE_ISLAND || name === SS_ROUTE.LOTTE_ISLAND_CONSIGN) {
        ssio_write(name, SS_ISLAND_HEADER, bucket.map(ssIslandRow), { bg: '#4a3a6b' });
      } else if (name === SS_ROUTE.PARTNER) {
        ssio_write(name, SS_PARTNER_HEADER, bucket.map(ssPartnerRow), { bg: '#3a5a3a' });
      } else {
        ssio_write(name, SS_OUT_HEADER, bucket.map(ssOutRow));
      }
    }
    // 확인용 뷰 — 대표행은 롯데택배 등에 그대로 있고 여기에도 함께 보인다
    ssio_write(SSIO_TABS.합배송, SS_MERGED_HEADER,
      (res.합배송뷰 || []).map(ssMergedRow), { bg: '#2c4f6b' });

    var nonship = res.buckets[SS_ROUTE.NONSHIP] || [];
    ssio_write(SSIO_TABS.비배송, SS_NONSHIP_HEADER, nonship.map(ssNonshipRow), { bg: '#4a4a4a' });
    var 비배송금액 = 0;
    for (var ns = 0; ns < nonship.length; ns++) 비배송금액 += ssNum(nonship[ns].합계);

    // 사방넷 대량 송장등록용 — 동봉 주문이 대표를 따라가도록 미리 엮어 둔다
    ssio_write(SSIO_TABS.사방넷송장, SS_INVOICE_HEADER, ssInvoiceRows(res.units), { bg: '#2c4f6b' });

    var holdRows = (res.buckets[SS_ROUTE.HOLD] || []).map(ssHoldRow);
    var holdSh = ssio_write(SSIO_TABS.보류, SS_HOLD_HEADER, holdRows, { bg: '#7a2e22' });
    ss_보류입력꾸미기(holdSh, holdRows.length);

    // 경고
    ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,
      res.warnings.map(function (w) { return [w.level, w.code, w.target, w.msg]; }), { bg: '#7a5b12' });

    // 이력
    단계 = '원장 적재';
    ssio_migrateHeader(SSIO_TABS.원장, SS_LEDGER_HEADER);
    ssio_migrateHeader(SSIO_TABS.실행이력, SS_RUNLOG_HEADER);
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
      ['상태', '✅ 완료'],
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
      ['  사전 조회대기 / 영구실패', ssz_pendingCount() + ' / ' + ssz_permanentCount()],
      ['마스터 · 품목 / 재고 / BOM',
        Object.keys(masters.items).length + ' / ' + Object.keys(masters.stock).length + ' / ' + Object.keys(masters.bom).length],
      ['마스터 · 합배송조건 코드 / 배송비규칙',
        Object.keys(masters.cond).length + ' / ' + Object.keys(masters.feeRules).length],
      ['마스터 · 도서산간 우편번호 / 주소사전',
        Object.keys(masters.islandZips).length + ' / ' + Object.keys(masters.addrZip).length],
      ['실행전 마스터갱신', pre.mode],
      ['재고 기준시각', ssm_stampOf('재고') || '(모름)'],
      ['품목정보 기준시각', ssm_stampOf('품목정보') || '(모름)']
    ];
    for (var b = 0; b < SSIO_TABS.출력.length; b++) {
      sum.push([SSIO_TABS.출력[b], res.stats['탭_' + SSIO_TABS.출력[b]]]);
    }
    sum.push(['합배송 확인용 (대표+동봉)', (res.합배송뷰 || []).length +
      '행 · 박스 ' + ((res.합배송뷰 || []).length - res.stats.합포장흡수) + '개']);
    sum.push(['합포장 동봉 (대표와 같은 송장)', res.stats.합포장흡수]);
    sum.push([SSIO_TABS.비배송 + ' (매출 집계용)', nonship.length + '행 · ' + 비배송금액.toLocaleString() + '원']);
    sum.push([SSIO_TABS.보류, res.stats.보류]);
    sum.push(['경고', res.warnings.length]);
    var 적용조치 = ssm_stampManual(res.units, runKey);

    단계 = '중복 점검';
    var dup = ss_중복점검(true);
    if (dup.cross) {
      ssWarn(res.warnings, '오류', 'DUP_CROSS', String(dup.cross) + '그룹',
        '회차 간 중복 의심이 있습니다. 오전에 출고한 건이 다시 올라왔을 수 있습니다. 「중복의심」 탭 확인.');
      ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,
        res.warnings.map(function (w) { return [w.level, w.code, w.target, w.msg]; }), { bg: '#7a5b12' });
    }
    sum.push(['중복의심 그룹 (회차간)', dup.groups + ' (' + dup.cross + ')']);
    var 유효조치 = 0;
    for (var ok in masters.override) if (Object.prototype.hasOwnProperty.call(masters.override, ok)) 유효조치++;
    sum.push(['수동조치 · 걷음 / 이 회차 유효 / 적용', 걷은조치 + ' / ' + 유효조치 + ' / ' + 적용조치]);
    sum.push(['재고부족 자동대리발송(설정)', cfgRaw['재고부족_자동대리발송'] || '(미설정)']);

    // 대리발송이 왜 그리로 갔는지 — 재고 부족인가, 사람이 지정한 것인가
    var pb = res.buckets[SS_ROUTE.PARTNER] || [];
    var 재고부족 = 0, 수동지정 = 0, 업체별 = {};
    for (var pi = 0; pi < pb.length; pi++) {
      if (pb[pi].수동조치) 수동지정++; else 재고부족++;
      var vk = pb[pi].업체코드 || '(미상)';
      업체별[vk] = (업체별[vk] || 0) + 1;
    }
    sum.push(['대리발송 · 재고부족 / 수동지정', 재고부족 + ' / ' + 수동지정]);
    var vlist = [];
    for (var vv in 업체별) if (Object.prototype.hasOwnProperty.call(업체별, vv)) vlist.push(vv + ' ' + 업체별[vv]);
    vlist.sort();
    sum.push(['대리발송 · 업체별', vlist.join(' · ')]);
    // 어떤 지정이 라인과 안 맞았는지 짚어 준다
    var 매칭 = {};
    for (var mu = 0; mu < res.units.length; mu++) {
      if (res.units[mu].수동조치) 매칭[ssText(res.units[mu].고유ID) + '|' + ssText(res.units[mu].원본코드)] = true;
    }
    var 미매칭 = [];
    for (var mk in masters.override) {
      if (Object.prototype.hasOwnProperty.call(masters.override, mk) && !매칭[mk]) 미매칭.push(mk);
    }
    if (미매칭.length) {
      ssWarn(res.warnings, '오류', 'MANUAL_KEY_MISS', 미매칭.slice(0, 5).join(' / '),
        '수동조치 ' + 미매칭.length + '건이 어느 주문과도 맞지 않습니다. 「수동조치」 탭의 고유ID·원본코드를 확인하세요.');
    }
    if (걷은조치 > 0 && 적용조치 === 0) {
      ssWarn(res.warnings, '오류', 'MANUAL_NOT_APPLIED', String(걷은조치) + '건',
        '보류 탭에서 조치를 걷었는데 하나도 반영되지 않았습니다. 「수동조치」 탭의 등록일·고유ID·원본코드를 확인하세요.');
      ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,
        res.warnings.map(function (w) { return [w.level, w.code, w.target, w.msg]; }), { bg: '#7a5b12' });
    }

        ssio_write(SSIO_TABS.요약, SS_SUMMARY_HEADER, sum);

    var 대표 = (res.합배송뷰 || []).length - res.stats.합포장흡수;
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
      '  합배송 ' + 대표 + '박스 · 동봉 ' + res.stats.합포장흡수 + '행 (모두 출력 탭에 포함)\n' +
      '  비배송 ' + nonship.length + '행 (적립금·배송비 등, 매출엔 포함)' + String.fromCharCode(10) +
      '  보류(미발송) ' + res.stats.보류 +
      (res.stats.보류 ? '   ← 우편번호: ' + (재실행 || '해당 없음') : '') + '\n\n' +
      '경고 ' + res.warnings.length + '건' +
      (dup.cross ? '   ⚠ 회차간 중복의심 ' + dup.cross + '그룹' : '') + '\n' +
      '재고 기준 ' + (ssm_stampOf('재고') || '모름');
    ssio_alert(msg + (res.stats.보류 ? '\n\n※ 「보류(미발송)」 탭을 반드시 확인하세요. 사유가 적혀 있습니다.' : ''));
  } catch (e) {
    try {
      ssio_write(SSIO_TABS.요약, SS_SUMMARY_HEADER, [
        ['상태', '❌ 실패 — 출력 탭은 이전 회차 내용입니다'],
        ['멈춘 단계', 단계],
        ['내용', String(e && e.message ? e.message : e).slice(0, 400)],
        ['시각', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')]
      ], { bg: '#7a2e22' });
    } catch (e2) {}
    ssio_alert('세트분리 실행 중 오류' + String.fromCharCode(10) + String.fromCharCode(10) +
      '단계 : ' + 단계 + String.fromCharCode(10) +
      '내용 : ' + e.message + String.fromCharCode(10) + String.fromCharCode(10) +
      '이 단계에서 멈췄습니다. 앞 단계 결과는 시트에 남아 있습니다.');
    throw e;
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
    var off = (vn === SS_ROUTE.LOTTE_ISLAND || vn === SS_ROUTE.LOTTE_ISLAND_CONSIGN
      || vn === SS_ROUTE.PARTNER) ? 3 : 0;
    tabs.push({ name: vn, seq: 2 + off, code: 4 + off });
  }
  // 합배송은 확인용 뷰라 합계·중복 검사에서 뺀다 (대표행이 출력 탭에도 있다)
  tabs.push({ name: SSIO_TABS.비배송, seq: 2, code: 4 });
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
    // 고정 행 아래 한 줄은 남아 있어야 한다. 전부 지우는 상황이면 내용만 비운다.
    var frozen = sh.getFrozenRows() || 1;
    if (sh.getMaxRows() - count <= frozen) {
      ssio_clearBody(sh);
    } else {
      sh.deleteRows(first + 2, count);   // 연속 블록 — 보통 이 경우다
    }
    return count;
  }
  var all = sh.getRange(2, 1, sh.getLastRow() - 1, SS_LEDGER_HEADER.length).getValues();
  var keep = [];
  for (var j = 0; j < all.length; j++) if (ssText(all[j][0]) !== 회차키) keep.push(all[j]);
  ssio_clearBody(sh);
  if (keep.length) sh.getRange(2, 1, keep.length, SS_LEDGER_HEADER.length).setValues(keep);
  return count;
}

/* ── 중복발주 의심 ─────────────────────────────────────── */

/**
 * 오늘 원장을 훑어 중복 의심 건을 뽑는다.
 *
 * 회차를 쌓아 두니까 가능해진 점검이다 — 오전에 올린 주문이 오후 판매현황에
 * 또 들어오면 이중 출고가 된다. 구 시스템은 판매현황이 매번 지워져 비교할 대상이 없었다.
 *
 * 등급 규칙은 상품정보 시트의 _partnerDupWatch.gs 와 같다.
 */
function ss_중복점검(quiet) {
  var sh = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!sh || sh.getLastRow() < 2) {
    if (!quiet) ssio_alert('원장이 비어 있습니다. 먼저 세트분리를 실행하세요.');
    return { groups: 0, rows: 0, cross: 0 };
  }

  // 원장은 「그 시트에 적힌 헤더」로 읽는다.
  // 코드 상수로 읽으면 열이 추가된 뒤 옛 행과 어긋나 엉뚱한 값이 들어온다.
  var cols = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, cols).getValues()[0];
  var idx = {};
  for (var h = 0; h < head.length; h++) {
    var hn = ssText(head[h]);
    if (hn && idx[hn] === undefined) idx[hn] = h;
  }
  var need = ['회차키', '고유ID', '원본품목코드', '품목명', '경로', '거래처명', '주소1', '수량', '합계'];
  for (var n = 0; n < need.length; n++) {
    if (idx[need[n]] === undefined) {
      if (!quiet) ssio_alert('원장 헤더에 「' + need[n] + '」 열이 없습니다.' + String.fromCharCode(10) +
        '「🛠 시트 설치 / 복구」로 원장을 갱신한 뒤 다시 실행하세요.');
      return { groups: 0, rows: 0, cross: 0, 주문라인: 0 };
    }
  }

  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd');
  var all = sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues();
  var rows = [];
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (ssText(r[idx['회차키']]).indexOf(today) !== 0) continue;   // 오늘 회차만
    rows.push({
      회차: ssText(r[idx['회차키']]),
      고유ID: ssText(r[idx['고유ID']]),
      원본코드: ssText(r[idx['원본품목코드']]),
      품목명: ssText(r[idx['품목명']]),
      경로: ssText(r[idx['경로']]),
      받는분: ssText(r[idx['거래처명']]),
      전화: ssText(r[idx['전화']]),
      모바일: ssText(r[idx['모바일']]),
      주소: ssText(r[idx['주소1']]),
      수량: ssNum(r[idx['수량']]),
      금액: ssNum(r[idx['합계']])
    });
  }

  var found = ssFindDuplicates(rows);
  var out = ssDupRows(found);
  var tab = ssio_write(SSIO_TABS.중복의심, SS_DUP_HEADER, out, { bg: '#6b3a2c' });
  if (out.length) {
    tab.getRange(2, 1, out.length, 1).insertCheckboxes();
    // 회차 간 건을 눈에 띄게
    for (var g = 0; g < out.length; g++) {
      if (out[g][4] === '회차간') tab.getRange(g + 2, 1, 1, SS_DUP_HEADER.length).setBackground('#fdecea');
    }
  }

  var cross = 0;
  for (var k = 0; k < found.groups.length; k++) if (found.groups[k].회차간) cross++;
  var res = { groups: found.groups.length, rows: out.length, cross: cross, 주문라인: found.records.length };

  if (!quiet) {
    var msg = '중복발주 의심 점검 (' + today + ')\n\n' +
      '  · 오늘 주문라인 : ' + res.주문라인 + '건\n' +
      '  · 의심 그룹 : ' + res.groups + '건 (그중 회차 간 ' + res.cross + '건)\n' +
      '  · 표시 행 : ' + res.rows + '\n\n';
    msg += res.cross
      ? '⚠ 회차 간 중복이 있습니다. 오전에 이미 출고한 건이 오후에 다시 올라왔을 수 있습니다.\n「중복의심」 탭을 확인하세요.'
      : (res.groups ? '회차 간 중복은 없습니다. 같은 회차 안 반복 주문일 수 있으니 탭에서 확인하세요.'
                    : '의심 건이 없습니다.');
    ssio_alert(msg);
  }
  return res;
}

/**
 * 보류 탭의 입력 3칸을 쓰기 편하게 만든다.
 * 조치·업체코드는 드롭다운이라 오타로 반영이 안 되는 일이 없다.
 */
function ss_보류입력꾸미기(sh, rows) {
  var cA = SS_HOLD_HEADER.indexOf('조치') + 1;
  var cM = SS_HOLD_HEADER.indexOf('메모') + 1;
  if (cA < 1) return;

  var last = Math.max(rows, 1);
  sh.getRange(2, cA, last, 2).clearDataValidations();

  var codes = [];
  var vd = ssio_body(SSIO_TABS.업체);
  for (var i = 0; i < vd.length; i++) { var v = ssText(vd[i][0]).toUpperCase(); if (v) codes.push(v); }
  codes.sort();

  sh.getRange(1, cA, 1, 2).setBackground('#1f3d3a').setNote(
    '이 칸 하나로 정합니다.' + "\\n" + "\\n" +
    '  발송        자체 출고 (보류 해제)' + "\\n" +
    '  업체코드    그 업체로 대리발송  예) JH, HP' + "\\n" +
    '  비워 둠     그대로 보류' + "\\n" + "\\n" +
    'U열 상세를 지워도 해소된 것으로 보고 발송합니다.' + "\\n" +
    '등록된 업체코드 : ' + codes.join(', ') + "\\n" + "\\n" +
    '적은 뒤 메뉴 → ✅ 보류 조치 반영' + "\\n" +
    '조치는 그 회차(같은 판매현황) 동안 유지되므로 나눠서 반영해도 됩니다.');

  sh.setColumnWidth(cA, 110);
  sh.setColumnWidth(cM, 260);
}

/**
 * 보류 탭에 적은 조치가 왜 안 먹는지 한 줄씩 짚어 준다.
 * 실행하지 않고 「지금 보이는 대로」 읽어 판단 과정을 그대로 보여 준다.
 */
function ss_보류조치진단() {
  var hold = ssio_ss().getSheetByName(SSIO_TABS.보류);
  if (!hold || hold.getLastRow() < 2) return ssio_alert('보류 탭이 비어 있습니다.');

  var idx = {};
  for (var h = 0; h < SS_HOLD_HEADER.length; h++) idx[SS_HOLD_HEADER[h]] = h;
  var v = hold.getRange(2, 1, hold.getLastRow() - 1, SS_HOLD_HEADER.length).getValues();

  var vendors = {}, codes = [];
  var vd = ssio_body(SSIO_TABS.업체);
  for (var q = 0; q < vd.length; q++) {
    var vc = ssText(vd[q][0]).toUpperCase();
    if (vc) { vendors[vc] = ssText(vd[q][1]); codes.push(vc); }
  }
  codes.sort();

  var L = [], 입력 = 0;
  for (var i = 0; i < v.length && L.length < 12; i++) {
    var 적은값 = ssText(v[i][idx['조치']]);
    var 사유 = ssText(v[i][idx['보류사유']]);
    var 상세 = ssText(v[i][idx['상세']]);
    var uid = ssText(v[i][idx['사방넷주문번호']]);
    var code = ssText(v[i][idx['품목코드']]);
    if (!적은값 && 상세) continue;
    입력++;

    var up = 적은값.toUpperCase();
    var 판정 = '', 문제 = [];
    if (적은값 === '발송') 판정 = '발송 (자체 출고)';
    else if (적은값 === '대리발송') 판정 = '대리발송 · 업체는 품목명에서 추론';
    else if (up && vendors[up]) 판정 = '대리발송 → ' + up + ' ' + vendors[up];
    else if (적은값) { 판정 = '대리발송 시도'; 문제.push('「' + 적은값 + '」 는 등록된 업체코드가 아님'); }
    else if (사유 && !상세) 판정 = '발송 (상세를 지움)';
    else 판정 = '없음 — 반영되지 않습니다';

    if (!uid) 문제.push('사방넷주문번호(P열)가 비어 어느 주문인지 알 수 없음');

    L.push('행 ' + (i + 2) + ' · ' + code + '  [' + uid + ']' +
      "\\n" + '    적은 값 : ' + (적은값 || '(비움)') + '   상세 : ' + (상세 || '(비움)') +
      "\\n" + '    판정   : ' + 판정 +
      (문제.length ? "\\n" + '    ⚠ ' + 문제.join(' / ') : ''));
  }

  return ssio_alert('보류 조치 진단' + "\\n" + "\\n" +
    '보류 ' + v.length + '행 중 입력된 줄 ' + 입력 + '개' + "\\n" +
    '등록된 업체코드 : ' + codes.join(', ') + "\\n" + "\\n" +
    (L.length ? L.join("\\n" + "\\n") : '입력된 줄이 없습니다.') +
    "\\n" + "\\n" + '문제가 없으면 메뉴 → ✅ 보류 조치 반영');
}

/* ── 송장 회수 · 사방넷 등록용 ─────────────────────────── */



/** 사방넷 대량 송장등록에 그대로 붙여넣는 두 열 */
var SS_REG_HEADER = ['주문번호', '운송장번호', '택배사'];

/**
 * 거래관리시스템송장 롯데 탭과 대리공급_임시기록을 직접 읽어 「사방넷송장」의 운송장번호를 채운다.
 *
 * 롯데에는 합포장 대표만 올라가므로 송장번호도 대표 주문번호로만 돌아온다.
 * 동봉 주문은 대표를 따라가게 해 같은 번호를 넣는다 — 그래야 사방넷에서 빠지는 게 없다.
 */
function ss_송장전파() {
  var inv = ssio_ss().getSheetByName(SSIO_TABS.사방넷송장);
  if (!inv || inv.getLastRow() < 2) {
    return ssio_alert('「사방넷송장」 탭이 비어 있습니다. 세트분리를 먼저 실행하세요.');
  }
  var NL = String.fromCharCode(10);
  var cfg = ssio_config();

  // ── 1a) 거래관리시스템송장 롯데 탭 → { 주문번호: 운송장번호 } ──
  //    5️⃣ 송장수집이 채워 두는 곳이라 붙여넣기가 필요 없다.
  //    허브와 같은 기준: J열 주문번호(=사방넷/고유ID) · G열 운송장번호.
  //    헤더 이름으로 먼저 찾고, 못 찾으면 그 고정 위치를 쓴다.
  var lotte = {}, lotteErr = '';
  try {
    var lId = ssText(cfg['롯데송장시트ID']) || '1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs';
    var lGid = ssNum(cfg['롯데송장탭GID']) || 1575029201;
    var lSS = SpreadsheetApp.openById(lId);
    var lTab = null, shs = lSS.getSheets();
    for (var si = 0; si < shs.length; si++) {
      if (shs[si].getSheetId() === lGid) { lTab = shs[si]; break; }
    }
    if (!lTab) throw new Error('GID ' + lGid + ' 탭을 찾지 못했습니다 (' + lSS.getName() + ')');
    if (lTab.getLastRow() >= 2) {
      var lrc = lTab.getLastColumn();
      var lrh = lTab.getRange(1, 1, 1, lrc).getDisplayValues()[0].map(function (x) {
        return ssText(x).replace(/\s/g, '');
      });
      var ci = -1, cw = -1;
      for (var h = 0; h < lrh.length; h++) {
        if (ci < 0 && (lrh[h] === '주문번호' || lrh[h] === '고객주문번호')) ci = h;
        if (cw < 0 && (lrh[h] === '운송장번호' || lrh[h] === '송장번호')) cw = h;
      }
      if (ci < 0) ci = 9;   // J
      if (cw < 0) cw = 6;   // G
      var rv = lTab.getRange(2, 1, lTab.getLastRow() - 1, Math.max(ci, cw) + 1).getDisplayValues();
      for (var r = 0; r < rv.length; r++) {
        var o = ssText(rv[r][ci]), w = ssText(rv[r][cw]);
        if (!o || !w) continue;
        if (o.indexOf('주문번호') >= 0 || w.indexOf('운송장') >= 0) continue;
        lotte[o] = w;
      }
    }
  } catch (eL) {
    lotteErr = String(eL.message || eL);
  }

  // ── 1b) 대리공급_임시기록 → 협력업체가 보낸 건의 송장 ──
  // 상품정보 시트에 살고, P열 사방넷주문번호 · V열 택배사 · X열 송장번호다.
  var temp = {}, tempErr = '';
  var tRes = ssm_openOptional(cfg['이카운트시트ID'],
    cfg['대리공급_임시기록탭'] || '대리공급_임시기록', '상품정보');
  if (tRes.ok) {
    for (var t = 1; t < tRes.values.length; t++) {
      var tu = ssText(tRes.values[t][15]);
      var tw = ssText(tRes.values[t][23]);
      if (tu && tw) temp[tu] = { w: tw, c: ssText(tRes.values[t][21]) || '' };
    }
  } else {
    tempErr = tRes.why;
  }

  if (lotteErr && tempErr) {
    return ssio_alert('송장 원천을 하나도 읽지 못했습니다.' + NL + NL +
      '롯데 송장탭: ' + lotteErr + NL + '임시기록: ' + tempErr);
  }

  // 통합 조회 — 롯데가 먼저, 없으면 임시기록
  function find(uid) {
    if (lotte[uid]) return { w: lotte[uid], c: '롯데택배', src: '롯데' };
    if (temp[uid]) return { w: temp[uid].w, c: temp[uid].c, src: '대리공급' };
    return null;
  }

  // ── 2) 사방넷송장 채우기 — 직접 매칭, 동봉은 대표의 번호를 그대로 ──
  var iCar = SS_INVOICE_HEADER.indexOf('택배사');
  var n = inv.getLastRow() - 1;
  var v = inv.getRange(2, 1, n, SS_INVOICE_HEADER.length).getValues();
  var 롯데직접 = 0, 대리공급건 = 0, 전파 = 0, 미매칭 = 0;
  for (var i = 0; i < n; i++) {
    var 주문 = ssText(v[i][0]);
    var 대표 = ssText(v[i][4]);
    var direct = find(주문);
    var hit = direct || (대표 ? find(대표) : null);
    if (hit) {
      v[i][5] = hit.w;
      if (iCar >= 0) v[i][iCar] = hit.c;
      if (direct) { if (hit.src === '롯데') 롯데직접++; else 대리공급건++; }
      else 전파++;
      continue;
    }
    v[i][5] = '';
    if (iCar >= 0) v[i][iCar] = '';
    if (주문) 미매칭++;
  }
  inv.getRange(2, 1, n, SS_INVOICE_HEADER.length).setValues(v);

  // ── 3) 원장에도 기록 — 일일마감·대시보드는 여기서 주문번호별 송장을 읽는다 ──
  ssio_migrateHeader(SSIO_TABS.원장, SS_LEDGER_HEADER);
  var 원장직접 = 0, 원장전파 = 0;
  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (lg && lg.getLastRow() > 1) {
    var lcols = lg.getLastColumn();
    var lhead = lg.getRange(1, 1, 1, lcols).getValues()[0];
    var li = {};
    for (var q = 0; q < lhead.length; q++) {
      var ln = ssText(lhead[q]);
      if (ln && li[ln] === undefined) li[ln] = q;
    }
    if (li['고유ID'] !== undefined && li['운송장번호'] !== undefined) {
      var lv = lg.getRange(2, 1, lg.getLastRow() - 1, lcols).getValues();

      var groupInv = {};
      for (var a = 0; a < lv.length; a++) {
        var uid = ssText(lv[a][li['고유ID']]);
        if (!ssText(lv[a][li['운송장번호']])) {
          var hit2 = find(uid);
          if (hit2) {
            lv[a][li['운송장번호']] = hit2.w;
            if (li['송장매칭'] !== undefined) {
              lv[a][li['송장매칭']] = hit2.src === '롯데' ? '롯데 직접' : '대리공급';
            }
            원장직접++;
          }
        }
        var grp = li['합포장그룹'] !== undefined ? ssText(lv[a][li['합포장그룹']]) : '';
        var isRep = li['합포장대표'] !== undefined && ssText(lv[a][li['합포장대표']]) === 'Y';
        var wRep = ssText(lv[a][li['운송장번호']]);
        if (grp && isRep && wRep) groupInv[grp] = wRep;
      }
      for (var b = 0; b < lv.length; b++) {
        if (ssText(lv[b][li['운송장번호']])) continue;
        var g2 = li['합포장그룹'] !== undefined ? ssText(lv[b][li['합포장그룹']]) : '';
        if (g2 && groupInv[g2]) {
          lv[b][li['운송장번호']] = groupInv[g2];
          if (li['송장매칭'] !== undefined) lv[b][li['송장매칭']] = '합포장 전파';
          원장전파++;
        }
      }
      lg.getRange(2, 1, lv.length, lcols).setValues(lv);
    }
  }

  // ── 4) 사방넷 대량등록용 — 주문번호당 한 줄, 전화주문 제외 ──
  var iSrc = SS_INVOICE_HEADER.indexOf('주문출처');
  var iReg = SS_INVOICE_HEADER.indexOf('사방넷등록');
  var invByUid = {}, carByUid = {}, conflicts = [];
  for (var c2 = 0; c2 < n; c2++) {
    var uid2 = ssText(v[c2][0]);
    var w3 = ssText(v[c2][5]);
    if (!uid2 || !w3) continue;
    if (invByUid[uid2] === undefined) {
      invByUid[uid2] = w3;
      carByUid[uid2] = iCar >= 0 ? ssText(v[c2][iCar]) : '';
    } else if (invByUid[uid2] !== w3 && conflicts.length < 8) {
      // 한 주문의 품목이 서로 다른 박스·업체로 갈린 경우 — 사방넷엔 첫 번째만 들어간다
      conflicts.push(uid2 + ' → ' + invByUid[uid2] + ' / ' + w3);
    }
  }
  var regRows = [], 전화건 = 0, 무송장 = 0;
  for (var d = 0; d < n; d++) {
    if (iSrc >= 0 && ssText(v[d][iSrc]) === '자동발급' && ssText(v[d][5])) 전화건++;
    if (iReg < 0 || ssText(v[d][iReg]) !== 'Y') continue;
    var uid3 = ssText(v[d][0]);
    if (!invByUid[uid3]) { 무송장++; continue; }
    regRows.push([uid3, invByUid[uid3], carByUid[uid3] || '']);
  }
  ssio_write(SSIO_TABS.사방넷등록, SS_REG_HEADER, regRows, { bg: '#2c4f6b' });

  var msg = '송장 전파 완료' + NL + NL +
    '  · 롯데 송장탭 ' + Object.keys(lotte).length + '건 / 대리공급 임시기록 ' + Object.keys(temp).length + '건' + NL +
    '  · 사방넷송장 · 롯데 ' + 롯데직접 + ' / 대리공급 ' + 대리공급건 +
    ' / 합포장 전파 ' + 전파 + ' / 미매칭 ' + 미매칭 + NL +
    '  · 원장 기록 · 직접 ' + 원장직접 + ' / 합포장 전파 ' + 원장전파 + NL +
    '  · 사방넷등록 ' + regRows.length + '건 (전화주문 ' + 전화건 + '건 제외' +
    (무송장 ? ' · 송장 없는 주문 ' + 무송장 + '건 대기' : '') + ')';
  if (lotteErr) {
    msg += NL + NL + '⚠ 롯데 송장탭을 읽지 못했습니다 — 임시기록만으로 매칭했습니다.' + NL + '  ' + lotteErr;
  }
  if (tempErr) {
    msg += NL + NL + '⚠ 대리공급 임시기록을 읽지 못했습니다 — 롯데만으로 매칭했습니다.' + NL + '  ' + tempErr;
  }
  if (conflicts.length) {
    msg += NL + NL + '⚠ 한 주문번호에 송장이 두 개 이상 (첫 번째만 등록됩니다):' + NL +
      '  ' + conflicts.join(NL + '  ');
  }
  msg += NL + NL + '「사방넷등록」 확인 후 「📊 사방넷 대량등록 엑셀 저장」을 실행하세요.';
  return ssio_alert(msg);
}

/**
 * 합포장이 왜 그렇게 묶였는지 짚어 준다.
 *
 * 묶음은 「출고지 + 받는분·주소·보내는분 + 조건ID」로 정해진다.
 * 한 사람 주문이 여러 박스로 갈렸다면 대개 조건ID가 갈린 것이다 —
 * 「합배송조건」 표에 그 품목들이 서로 다른 조건으로 등록돼 있다는 뜻이다.
 */
function ss_합배송진단() {
  var sh = ssio_ss().getSheetByName(SSIO_TABS.합배송);
  if (!sh || sh.getLastRow() < 2) return ssio_alert('합배송 탭이 비어 있습니다. 세트분리를 먼저 실행하세요.');

  var idx = {};
  for (var h = 0; h < SS_MERGED_HEADER.length; h++) idx[SS_MERGED_HEADER[h]] = h;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, SS_MERGED_HEADER.length).getValues();

  // 배송지(받는분·주소) 단위로 다시 묶어, 그 안에서 조건ID가 몇 갈래인지 본다
  var byAddr = {};
  for (var i = 0; i < v.length; i++) {
    var 받는분 = ssText(v[i][idx['거래처명']]);
    var 주소 = ssText(v[i][idx['주소1']]);
    var k = 받는분 + ' ♦ ' + 주소;
    (byAddr[k] || (byAddr[k] = [])).push({
      조건: ssText(v[i][idx['조건ID']]) || '(없음)',
      코드: ssText(v[i][idx['품목코드']]),
      품목: ssText(v[i][idx['품목명']]),
      구분: ssText(v[i][idx['구분']])
    });
  }

  var L = [], 갈린곳 = 0;
  var keys = [];
  for (var kk in byAddr) if (Object.prototype.hasOwnProperty.call(byAddr, kk)) keys.push(kk);
  keys.sort(function (a, b) { return byAddr[b].length - byAddr[a].length; });

  for (var q = 0; q < keys.length; q++) {
    var rows = byAddr[keys[q]];
    var conds = {};
    for (var r = 0; r < rows.length; r++) conds[rows[r].조건] = (conds[rows[r].조건] || 0) + 1;
    var names = [];
    for (var cn in conds) if (Object.prototype.hasOwnProperty.call(conds, cn)) names.push(cn);
    if (names.length > 1) 갈린곳++;
    if (L.length >= 6) continue;

    var body = [];
    for (var n = 0; n < names.length; n++) {
      var items = [];
      for (var s = 0; s < rows.length; s++) if (rows[s].조건 === names[n]) items.push(rows[s].코드);
      body.push('    [' + names[n] + '] ' + conds[names[n]] + '건 · ' + items.slice(0, 8).join(', '));
    }
    L.push(keys[q].slice(0, 60) + '  — ' + rows.length + '건 / 박스 ' + names.length + '개' +
      String.fromCharCode(10) + body.join(String.fromCharCode(10)));
  }

  return ssio_alert('합배송 진단' + String.fromCharCode(10) + String.fromCharCode(10) +
    '배송지 ' + keys.length + '곳 · 그중 조건이 갈려 여러 박스가 된 곳 ' + 갈린곳 + '곳' + String.fromCharCode(10) +
    String.fromCharCode(10) + L.join(String.fromCharCode(10) + String.fromCharCode(10)) +
    String.fromCharCode(10) + String.fromCharCode(10) +
    '한 박스로 묶으려면 「합배송조건」 탭에서 그 품목들을 같은 조건ID로 맞추세요.');
}
