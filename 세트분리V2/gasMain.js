/**
 * gasMain.js — 메뉴 · 설치 · 실행
 *
 * 운영 순서
 *   1) 마스터 새로고침   (하루 1회 또는 품목/재고가 바뀐 뒤)
 *   2) 판매현황 붙여넣기 (이카운트 판매현황 엑셀 그대로)
 *   3) 세트분리 실행     (한 번에 전 구간 계산 + 출력 + 이력 적재)
 */

var SS_SUMMARY_HEADER = ['항목', '값'];
/* ★ 머리글에 «택배사 이름»을 쓰지 않는다 ★  (2026-09-11)
     여기 '롯데택배' 가 박혀 있었다. 택배사를 로젠으로 바꾸자 머리글이
     달라졌고, ssio_migrateHeader 가 «다른 표»로 보고 탭을 통째로
     실행이력_구버전_… 으로 밀어낸 뒤 빈 탭을 새로 만들었다.
     그날 오전 1차가 현재 탭에서 사라져 보였다.

     머리글은 «무엇을 세는 칸인가»를 적는 자리지 «지금 어느 택배사인가»가
     아니다. 자사출고로 적으면 택배사를 또 바꿔도 흔들리지 않는다.
     (migrateHeader 도 이름만 바뀐 것은 안 밀어내게 고쳤지만, 애초에
      흔들릴 이름을 안 쓰는 것이 먼저다.) */
/*  ★★ 누적 탭의 머리글에서 «칸을 빼지 않는다» ★★  (2026-09-16)

    오늘 동네배송을 지우면서 여기서도 「동네배송」 칸을 뺐다(16→15).
    그런데 ssio_migrateHeader 는 «칸이 줄면» 탭 이름을 실행이력_구버전_…
    으로 바꾸고 빈 탭을 새로 만든다. 자리가 어긋난 채로 옮기면 엉뚱한
    칸에 값이 들어가기 때문이다 — 그 판단은 옳다.

    문제는 «지난 기록이 사라져 보인다»는 것이다. 2026-09-11 에 같은 일이
    있었다: 「오전 1차(10:05)가 현재 실행이력에서 사라져 보였다 — 자료는
    옛 탭에 있지만, 이어서 읽는 코드는 옛 탭을 안 본다. 그게 더 나쁘다.」

    그래서 칸을 되돌린다. 동네배송은 이제 안 쓰지만 «자리»는 남긴다 —
    늘 0 이 들어간다. 죽은 칸 하나의 값보다 이어지는 기록이 훨씬 비싸다.
    칸을 정말 빼야 할 날이 오면 ssio_migrateHeader 에 «칸 빼기»를 먼저
    가르쳐야 한다. 지금은 그럴 값어치가 없다. */
var SS_RUNLOG_HEADER = ['회차키', '실행시각', '입력행', '분해행', '합포장흡수', '출력행',
  '자사출고', '도서산간', '도서산간(위탁)', '동네배송', '대리발송', '합배송', '보류', '경고', '소요(초)', '버전'];

function onOpen() {
  var ui = SpreadsheetApp.getUi();

  /* ★ 위에는 하루에 실제로 누르는 것만 ★
     스물한 개가 한 줄로 늘어서 있으니 매일 쓰는 것을 눈으로 찾아야 했다.
     나머지는 넷으로 묶어 접는다 — 자료 준비 · 송장 매칭 · 점검 · 설정. */
  ui.createMenu('🧩 세트분리 V2')
    .addItem('▶ 세트분리 실행', 'ss_실행')
    .addItem('🔂 세트분리 재실행 (회차 그대로)', 'ss_재실행')
    .addItem('✅ 조치 적용 (보류 → 발송·대리발송)', 'ss_보류조치반영')
    .addSeparator()

    .addItem('🔁 송장 전파 (자사출고 → 사방넷)', 'ss_송장전파')
    .addItem('📊 사방넷 송장대량등록', 'ss_사방넷엑셀저장')
    .addItem('📋 일일마감 (원장 → 마감표)', 'ss_일일마감')
    .addSeparator()

    .addSubMenu(ui.createMenu('📦 자료 준비')
      .addItem('판매현황 비우기', 'ss_판매현황비우기')
      .addItem('판매현황 원천 확인', 'ss_판매현황원천')
      .addItem('🧩 그날 판매현황 메우기 (원장에서)', 'ss_그날판매현황메우기')
      .addItem('📮 우편번호 자동조회 (카카오)', 'ss_우편번호채우기'))

    .addSubMenu(ui.createMenu('🔗 송장 매칭')
      .addItem('🔍 미매칭 점검 (주문은 있는데 송장 없음)', 'ss_미매칭점검')
      .addItem('🧭 고아 송장 점검 (송장은 있는데 주문 없음)', 'ss_고아송장점검')
      .addSeparator()
      .addItem('🧩 미매칭 메꾸기 (후보 찾기)', 'ss_미매칭메꾸기')
      .addItem('✅ 메꾸기 반영 (확인 Y 만)', 'ss_메꾸기반영')
      .addSeparator()
      .addItem('⏰ 아침 재매칭 트리거 설치 (1회)', 'ss_아침재매칭트리거설치')
      /*  ★ 이것이 «메뉴에 없었다» ★  (2026-09-16)
          아침 재매칭은 있는데 기초 데이터만 빠져 있었다. 그래서 아무도
          누른 적이 없고, 17:00 전파·미매칭·고아송장·메꾸기가 한 번도
          안 돌았다. 그날 769줄이 빈 채로 저녁까지 남은 까닭이다.  */
      .addItem('⏰ 기초 데이터 트리거 설치 (1회 · 17:00)', 'ss_기초데이터트리거설치'))

    .addSubMenu(ui.createMenu('🔎 점검 · 진단')
      .addItem('보류 조치 진단', 'ss_보류조치진단')
      .addItem('📋 대리발송품목 진단 (왜 안 빠졌나)', 'ss_대리품목진단')
      /*  ★ 2026-09-18 ★ 「뚜껑이 세 개 나갔다」를 눈으로 보는 자리.
          쪼개기는 한 겹만 하므로, 더 나갔다면 BOM 자료가 그렇게 생긴 것이다. */
      .addItem('🔍 BOM 진단 (구성품이 몇 개 나가나)', 'ss_BOM진단')
      .addItem('🔎 같은 주문에 같은 품목이 두 줄', 'ss_중복품목진단')
      .addItem('합배송 진단', 'ss_합배송진단')
      .addItem('사방넷 진단 (저장 안 함)', 'ss_사방넷진단')
      .addItem('중복발주 의심 점검', 'ss_중복점검')
      .addItem('검증 (행수 대조)', 'ss_검증')
      .addItem('☁ 이 회차를 v2 에 올리기 (속도·정확도 맞대기)', 'ss_v2지금보내기'))

    .addSubMenu(ui.createMenu('⚙ 설정 · 설치')
      .addItem('🔑 카카오 API 키 설정', 'ss_카카오키설정')
      .addItem('🩺 카카오 진단', 'ss_카카오진단')
      .addItem('🧹 합배송조건 정리 / 검증', 'ss_합배송조건정리')
      /* 실행이 알아서 다시 읽으므로 평소엔 누를 일이 없다.
         마스터가 깨졌을 때 손으로 되돌리는 자리로 남긴다. */
      .addItem('🔄 마스터 새로고침 (평소엔 불필요)', 'ss_마스터새로고침')
      .addItem('🏝 도서산간 목록 심기 (1회)', 'ss_도서산간심기')
      .addItem('🛠 시트 설치 / 복구', 'ss_설치'))

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
  ssio_sheet(SSIO_TABS.대리발송품목, SSM_PARTNER_ITEM_HEADER);
  ssio_sheet(SSIO_TABS.도서산간시군, SSM_ISL_KW_HEADER);
  ssio_sheet(SSIO_TABS.도서산간우편, SSM_ISL_ZIP_HEADER);
  ssio_sheet(SSIO_TABS.도선료, SS_FERRY_HEADER);
  ssio_sheet(SSIO_TABS.도서산간사전, SSM_ISL_DICT_HEADER);

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
  var order = [SSIO_TABS.입력, SSIO_TABS.입력아이디].concat(SSIO_TABS.출력).concat([
    //  내보낸 사본은 출력 탭 바로 뒤에 둔다 — 견줘 볼 일이 많다
    SSIO_TABS.출력사본,
    SSIO_TABS.합배송, SSIO_TABS.사방넷송장, SSIO_TABS.사방넷등록, SSIO_TABS.비배송, SSIO_TABS.보류, SSIO_TABS.경고, SSIO_TABS.요약,
    SSIO_TABS.합배송조건, SSIO_TABS.분리예외, SSIO_TABS.대리발송품목, SSIO_TABS.업체, SSIO_TABS.수동조치, SSIO_TABS.도서산간사전,
    SSIO_TABS.설정,
    SSIO_TABS.M품목, SSIO_TABS.M배송비, SSIO_TABS.M재고, SSIO_TABS.MBOM,
    SSIO_TABS.도서산간시군, SSIO_TABS.도서산간우편,
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
/**
 * 조치 적용 — 보류 탭에 적은 조치를 반영하고, 나갈 한 장을 탭에 담는다.
 *
 * > "세트분리시 조치적용시 시트가 로젠송장출력을 누른 상태로 바뀌게 해줘"
 * > "조치사항을 눈으로 확인하는게 더 나아"
 *
 * 여태 조치를 적용한 뒤 「로젠 송장출력」을 따로 눌러야 했다. 두 단추가
 * 늘 붙어 다니는데 나눠 둘 까닭이 없다. 적용하면 바로 그 탭이 열린다 —
 * 조치한 것이 제대로 빠졌는지 그 자리에서 눈으로 본다.
 *
 * 탭 만들기가 실패해도 조치 적용은 이미 끝났다. 그 사실을 덮지 않는다.
 */
function ss_보류조치반영() {
  var r = ss_실행({ mirrorOnly: true });
  try {
    ss_로젠출력탭();
  } catch (e) {
    ssio_alert('조치는 적용했습니다.' + String.fromCharCode(10) +
      '「' + SSIO_TABS.출력사본 + '」 탭 만들기는 실패했습니다: ' +
      (e && e.message ? e.message : e));
  }
  return r;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  🔂 세트분리 재실행 — 회차를 올리지 않는다
 *  2026-09-16
 *
 *  > "세트분리 메뉴에 세트분리 재실행을 만들어 회차가 늘어나는 부분을
 *  >  없애는게 좋겠어 같은 판매현황 재실행으로 회차 추가없이 재실행으로
 *  >  할경우 쓸수 있도록.."
 *
 *  ★ 왜 회차가 늘었나 ★
 *    회차는 판매현황 «내용의 지문»으로 가른다. 글자 하나라도 다르면 다른
 *    회차다. 그런데 세트분리는 돌면서 판매현황 O열에 전화주문 고유아이디를
 *    적는다. 그러고 다시 돌리면 지문이 달라져 «새 회차»가 된다.
 *    사람 눈에는 같은 판매현황인데 1차가 2차가 되어 버린다.
 *
 *  ★ 회차가 늘면 무엇이 문제인가 ★
 *    원장·실행이력·그날 판매현황·합배송이 전부 회차로 묶인다. 없던 2차가
 *    생기면 사방넷 대량등록도 일일마감도 그 2차를 실제 출고분으로 친다.
 *    송장 배포와 정산이 거기서 어긋난다.
 *
 *  ★ 언제 쓰나 ★
 *    같은 판매현황을 다시 돌릴 때만. 새 판매현황을 붙여넣었으면 ▶ 세트분리
 *    실행을 쓴다 — 그건 «다른 회차»가 맞다.
 *
 *  ★ 무엇을 하나 ★
 *    마지막 회차를 그대로 쓰고, 그 줄의 지문만 이번 내용으로 갈아 끼운다.
 *    원장의 그 회차분은 늘 그렇듯 통째로 갈아 끼워진다(ss_원장회차삭제).
 * ══════════════════════════════════════════════════════════════
 */
function ss_재실행() {
  var 마지막 = ss_마지막회차_();
  if (!마지막) {
    ssio_alert('아직 회차가 없습니다.' + String.fromCharCode(10) + String.fromCharCode(10) +
      '처음 한 번은 ▶ 세트분리 실행으로 돌려야 합니다.');
    return;
  }
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  if (ui) {
    var nl2 = String.fromCharCode(10);
    var ans = ui.alert('🔂 세트분리 재실행',
      '회차를 «올리지 않고» 다시 돌립니다.' + nl2 + nl2 +
      '  · 쓰는 회차 : ' + 마지막.key + nl2 +
      '  · 그 회차의 원장·출력은 이번 결과로 갈아 끼워집니다' + nl2 + nl2 +
      '새 판매현황을 붙여넣었다면 이걸 쓰면 안 됩니다 —' + nl2 +
      '그건 ▶ 세트분리 실행으로 돌려야 «다른 회차»가 됩니다.' + nl2 + nl2 +
      '계속할까요?', ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
  }
  return ss_실행({ 회차유지: 마지막.key });
}

/**
 * 가장 최근 회차 한 줄. 없으면 null.
 * 회차 탭은 아래로 쌓이므로 맨 끝이 가장 최근이다.
 */
function ss_마지막회차_() {
  var rows = ssio_body(SSIO_TABS.회차);
  for (var i = rows.length - 1; i >= 0; i--) {
    var k = ssText(rows[i][0]);
    if (k) return { key: k, 행: i + 2, no: ssNum(rows[i][3]) };
  }
  return null;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  구간 시계 — 어디서 시간을 쓰는지 «재서» 말한다
 *  2026-09-16
 *
 *  > "재실행 했을떄 속도가 72초로 나왔어"
 *
 *  ★ 짐작으로 고치지 않는다 ★
 *    우편번호 조회를 묶음으로 바꿔 크게 줄였지만, 재실행에는 새 주소가
 *    없으니 그 길은 애초에 타지도 않는다. 72초가 어디서 났는지 모르는 채
 *    여기저기 손보면 엉뚱한 데를 고치고 멀쩡한 데를 망가뜨린다.
 *
 *    그래서 «재는 것»을 먼저 붙인다. 요약 탭에 오래 걸린 구간부터 적는다.
 *    다음 실행 한 번이면 어디를 고칠지 사람도 나도 안다.
 *
 *  단계 이름을 그대로 쓴다 — 실패했을 때 「어느 단계에서 멈췄나」를 말하는
 *  그 이름이다. 두 벌로 관리하면 언젠가 어긋난다.
 * ══════════════════════════════════════════════════════════════
 */
var SS_STEP = { 이름: '', at: 0, 목록: [] };

/** 돌던 구간을 닫고 새 구간을 연다. 단계 이름을 그대로 돌려준다. */
function ss단계_(새이름) {
  var now = new Date().getTime();
  if (SS_STEP.이름 && SS_STEP.at) SS_STEP.목록.push([SS_STEP.이름, now - SS_STEP.at]);
  SS_STEP.이름 = 새이름;
  SS_STEP.at = now;
  return 새이름;
}

/** 시계를 처음부터 다시 */
function ss시계비우기_() { SS_STEP = { 이름: '', at: 0, 목록: [] }; }

/**
 * 오래 걸린 구간부터 요약 행으로.
 * 0.2초 밑은 안 적는다 — 스무 줄이 늘어서면 정작 큰 놈이 안 보인다.
 */
function ss시계표_() {
  ss단계_('');                       // 마지막 구간 닫기
  var 목 = SS_STEP.목록.slice();
  목.sort(function (a, b) { return b[1] - a[1]; });
  var out = [];
  for (var i = 0; i < 목.length; i++) {
    if (목[i][1] < 200) continue;
    out.push(['  · ' + 목[i][0], (목[i][1] / 1000).toFixed(1) + '초']);
  }
  return out;
}

function ss_실행(opts) {
  opts = opts || {};
  var t0 = new Date().getTime();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) { ssio_alert('다른 실행이 진행 중입니다.'); return; }

  ss시계비우기_();
  var 단계 = ss단계_('시작');
  try {
    단계 = ss단계_('설정 읽기');
    var cfgRaw = ssio_config();
    var cfg = {
      자사출고지접두: cfgRaw['자사출고지접두'] || SS_DEFAULT_CONFIG.자사출고지접두,
      합배송출고지: cfgRaw['합배송출고지'] || SS_DEFAULT_CONFIG.합배송출고지,
      위탁출고지: cfgRaw['위탁출고지'] || SS_DEFAULT_CONFIG.위탁출고지,
      허용상태: cfgRaw['허용상태'] || SS_DEFAULT_CONFIG.허용상태,
      보내는주소: cfgRaw['보내는주소'] || SS_DEFAULT_CONFIG.보내는주소,
      대표전화: cfgRaw['대표전화'] || SS_DEFAULT_CONFIG.대표전화,
      도서산간_미확인: cfgRaw['도서산간_미확인'] || SS_DEFAULT_CONFIG.도서산간_미확인,
      도서산간_판정: cfgRaw['도서산간_판정'] || SS_DEFAULT_CONFIG.도서산간_판정,
      전화주문_고유ID: cfgRaw['전화주문_고유ID'] || SS_DEFAULT_CONFIG.전화주문_고유ID,
      재고부족_자동대리발송: cfgRaw['재고부족_자동대리발송'] || SS_DEFAULT_CONFIG.재고부족_자동대리발송,
      비배송_품목패턴: cfgRaw['비배송_품목패턴'] || SS_DEFAULT_CONFIG.비배송_품목패턴,
      합포장_최대건수: cfgRaw['합포장_최대건수'] || SS_DEFAULT_CONFIG.합포장_최대건수
    };

    단계 = ss단계_('판매현황 읽기');
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
    단계 = ss단계_('재고 새로고침');
    /*  ★ 재실행·조치 적용은 마스터를 다시 안 당긴다 ★  (2026-09-16)
        > "재실행 했을떄 속도가 72초로 나왔어"

        ssm_refreshBeforeRun 은 «외부 이카운트 시트»를 열어 품목·재고·BOM·
        도서산간을 통째로 다시 받아 각 마스터 탭에 쓴다. 새 판매현황을 돌릴
        때는 맞다 — 재고는 실행 시점 값이어야 한다.

        그런데 🔂 재실행과 ✅ 조치 적용은 «방금 돌린 그 회차»를 다시 그리는
        일이다. 몇 분 전에 받아 둔 값이 그대로 있는데 또 받는다.

        ★ 속도만의 문제가 아니다 ★
          그 사이 이카운트 재고가 줄면 같은 회차인데 판정이 달라진다 —
          1차에서 자사출고였던 줄이 조치 한 번 반영하고 나니 재고부족으로
          대리발송이 되어 있는 식이다. 같은 회차는 같은 잣대로 봐야 한다.

        새 재고로 다시 보고 싶으면 ▶ 세트분리 실행을 쓴다 (늘 당겨 온다).
        재고가 오래됐으면 아래 STOCK_STALE 경고가 그대로 뜬다. */
    var 갱신건너뜀 = !!(opts.회차유지 || opts.mirrorOnly);
    var pre = 갱신건너뜀
      ? { mode: '건너뜀 (재실행 — 직전 값 그대로. 새 재고로 보려면 ▶ 세트분리 실행)',
          report: [], warnings: [] }
      : ssm_refreshBeforeRun(cfgRaw);

    // 지난 회차 「보류」 탭에 사람이 적어 넣은 조치를 먼저 걷어 온다.
    // 보류 탭은 곧 다시 쓰이므로 여기서 안 걷으면 입력이 사라진다.
    // 실행이 도중에 멈추면 출력 탭에 이전 회차 내용이 그대로 남는다.
    // 그걸 새 결과로 오해하지 않도록 시작 시점에 「진행 중」을 박아 둔다.
    ssio_write(SSIO_TABS.요약, SS_SUMMARY_HEADER, [
      ['상태', '⏳ 진행 중 — 아직 끝나지 않았습니다'],
      ['시작', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')],
      ['주의', '이 표시가 남아 있으면 출력 탭은 이전 회차 내용입니다']
    ], { bg: '#7a5b12' });

    단계 = ss단계_('협력업체 표');
    ssm_seedVendors();
    // 회차를 먼저 정한다. 조치가 「어느 회차의 것인지」 묶여야
    // 되는 것부터 차례로 처리해도 앞서 반영한 건이 되돌아가지 않는다.
    단계 = ss단계_('회차 확정');
    var 지문 = ssFingerprint(ssNormalize(grid, cfg, []));
    /*  🔂 재실행이면 마지막 회차를 그대로 쓴다 (2026-09-16).
        판매현황 O열에 고유아이디를 적고 나면 지문이 달라져 새 회차가 되는데,
        사람 눈에는 같은 판매현황이다. 그 헛 회차를 만들지 않는다. */
    var 회차 = opts.회차유지
      ? ss_회차유지확정(opts.회차유지, 지문, grid.length)
      : ss_회차확정(지문, grid.length);
    var runKey = 회차.key;

    단계 = ss단계_('보류 조치 걷기');
    var 걷은조치 = ssm_captureManual(runKey);

    단계 = ss단계_('마스터 읽기');
    var masters = ssm_load(runKey);
    if (!Object.keys(masters.items).length) {
      ssio_alert('품목 마스터가 비어 있습니다. 먼저 「① 마스터 새로고침」을 실행하세요.');
      return;
    }

    단계 = ss단계_('계산');
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
    단계 = ss단계_('우편번호 조회');
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
        /*  ★ 통째로 다시 읽지 않는다 ★  (2026-09-16 — 속도)
            우편번호를 새로 구했으니 도서산간 판정이 달라져 한 번 더 계산한다.
            하지만 그 사이 바뀐 것은 「도서산간_주소사전」 하나뿐이다.
            예전에는 여기서 ssm_load 로 열세 탭을 다시 읽었다. */
        ssm_reloadAddrZip(masters);
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
    단계 = ss단계_('원장 회차 비우기');
    var 지운행 = ss_원장회차삭제(runKey);   // 같은 회차 기록은 항상 갈아 끼운다

    // 판매현황 O열「주문자명(사방넷)」에 전화주문 고유아이디를 채운다.
    // 사방넷·대리판매는 이미 「이름/ID」로 들어오므로 전화주문만 같은 형식으로 맞춘다.
    // 그러면 O열 하나로 전 주문이 통일되고, 송장매칭·일일마감이 이 열만 보면 된다.
    단계 = ss단계_('판매현황 O열 쓰기');
    var 아이디채움 = ss_판매현황아이디채움(res.idCells);

    /*  ★ 그날치를 회차별로 이어 쌓는다 — 「0914판매현황」 ★  (2026-09-14)
        「판매현황_고유아이디」는 회차마다 덮어쓰므로 오전 건을 나중에 되짚을
        데가 없었다. 일일마감·송장매칭·사방넷 대량등록이 하루를 통째로 볼 수
        있어야 한다. 실패해도 실행은 계속한다 — 곁다리다. */
    var 그날쌓음 = 0;
    try {
    단계 = ss단계_('그날 판매현황 쌓기');
      그날쌓음 = ss_그날판매현황쌓기(runKey);
    } catch (eD) {
      ssWarn(res.warnings, '주의', 'DAILY_SALES_TAB', String(eD && eD.message ? eD.message : eD),
        '그날 판매현황 탭을 못 만들었습니다. 실행 자체는 끝났습니다.');
    }

    /* ★ 도서산간 「조치」는 같은 회차 안에서 살아남아야 한다 ★  (2026-09-14)
       > "도서산간 발송처리했는데 조치를 취해서 계속뜨네"

       ✅ 조치 적용은 ss_실행(mirrorOnly) 이라 출력 탭을 통째로 다시 쓴다.
       그때 도서산간에 적어 둔 「발송」이 같이 지워져서, 보류 조치를 한 번
       반영할 때마다 도서산간을 처음부터 다시 체크해야 했다. 미발송 건은
       하나씩 풀리는 것이라 반영을 여러 번 하는데, 그때마다 지워진다.

       ★ 회차가 바뀌면 안 지킨다 ★
         새 판매현황이면 「전에 봤으니 됐겠지」가 되면 안 된다. 보류 조치가
         회차 안에서만 유효한 것과 같은 규칙이다. */
    var 섬조치 = 회차.재실행 ? ss_섬조치걷기_() : {};

    // 출력 탭
    /*  ★ 나가기 직전에 한 번 본다 ★  (2026-09-15)
        받는분·주소·연락처·품목명·수량 — 송장 한 장이 되기 위한 최소다.
        여기서 못 잡으면 그 줄은 그대로 출력 탭에 앉고, 아무도 모른 채
        송장이 나간다. 어제 주소가 그렇게 87% 빠졌다. */
    단계 = ss단계_('출고 점검');
    var 출고빔 = ss출고점검(res.buckets, res.warnings);

    단계 = ss단계_('출력 탭 쓰기');
    for (var i = 0; i < SSIO_TABS.출력.length; i++) {
      var name = SSIO_TABS.출력[i];
      var bucket = res.buckets[name] || [];
      if (name === SS_ROUTE.LOTTE_ISLAND || name === SS_ROUTE.LOTTE_ISLAND_CONSIGN) {
        ssio_write(name, SS_ISLAND_HEADER,
          ss_섬조치되돌리기_(bucket.map(ssIslandRow), 섬조치), { bg: '#4a3a6b' });
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
    단계 = ss단계_('원장 적재');
    ssio_migrateHeader(SSIO_TABS.원장, SS_LEDGER_HEADER);
    ssio_migrateHeader(SSIO_TABS.실행이력, SS_RUNLOG_HEADER);
    var ledger = res.units.map(function (u) { return ssLedgerRow(u, runKey, at); });
    ssio_append(SSIO_TABS.원장, SS_LEDGER_HEADER, ledger);   // 회차당 한 벌만 남는다

    var sec = ((new Date().getTime() - t0) / 1000);
    ssio_append(SSIO_TABS.실행이력, SS_RUNLOG_HEADER, [[
      runKey, at, res.stats.입력행, res.stats.분해행, res.stats.합포장흡수, res.stats.출력행,
      res.stats['탭_' + SS_ROUTE.LOTTE], res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND],
      res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND_CONSIGN],
      0,   // 동네배송 — 쓰지 않는 칸. 자리를 지키려고 0 을 넣는다(위 주석)
      res.stats['탭_' + SS_ROUTE.PARTNER], res.stats['탭_' + SS_ROUTE.MERGED],
      res.stats.보류, res.warnings.length,
      sec.toFixed(1), SS_VERSION
    ]]);

    //  사전 건수는 한 번만 읽는다 — 따로 세면 같은 탭을 두 번 읽는다 (2026-09-16)
    var 사전수 = ssz_dictCounts();
    // 요약
    var sum = [
      ['상태', '✅ 완료'],
      ['회차키', runKey],
      ['회차 구분', 회차.회차유지
        ? '🔂 재실행 (회차 그대로) — 원장 ' + 지운행 + '행 교체'
        : (회차.재실행 ? '재실행 — 원장 ' + 지운행 + '행 교체' : '신규 ' + 회차.no + '회차')],
      ['실행시각', at],
      ['판매현황 원천', sales.원천], ['소요(초)', sec.toFixed(1)],
      ['전화주문 고유ID 부여', 아이디채움 + '건 (판매현황 O열)'],
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
      ['  사전 조회대기 / 영구실패', 사전수.대기 + ' / ' + 사전수.영구],
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
    /*  ★ 막은 것은 «맨 앞»에 세운다 ★  (2026-09-21)
        재출고를 막았다는 것은 「판매현황에 지난 회차가 딸려왔다」는 말이다.
        그건 이 회차에서 제일 먼저 알아야 할 일이다 — 경고 탭에만 적으면
        9/15 처럼 629줄이 조용히 두 번 계산된다. */
    var 막은줄 = 0;
    for (var rb = 0; rb < res.units.length; rb++) {
      if (res.units[rb].보류사유 === '이미출고') 막은줄++;
    }
    if (막은줄) {
      sum.push(['★★ 이미 나간 줄이라 막음',
        막은줄 + '행 — 「보류(미발송)」 탭에 사유가 있습니다. 판매현황에 지난 회차가 딸려온 듯합니다']);
    }
    /*  ★ 빠진 칸은 «실행요약 맨 앞줄»에 세운다 ★  (2026-09-15)
        경고 탭에만 적으면 사람이 안 연다. 어제 주소 87% 가 그렇게 지나갔다.
        나갈 줄에 받는분·주소·연락처·품목명·수량이 빈 것이 하나라도 있으면
        여기서 먼저 눈에 걸린다. 없으면 이 줄 자체가 안 뜬다. */
    var 빔글 = [];
    for (var bk in 출고빔) {
      if (Object.prototype.hasOwnProperty.call(출고빔, bk)) 빔글.push(bk + ' ' + 출고빔[bk]);
    }
    if (빔글.length) sum.push(['★★ 나갈 줄에 빠진 칸', 빔글.join(' · ') + '  — 경고 탭에 순번이 있습니다']);
    /*  ★ 「대리발송품목」은 저절로 안 꺼진다 — 사람이 지워야 꺼진다 ★  (2026-09-15)
        그러니 매 회차 «무엇이 걸렸는지»를 눈앞에 둔다. 그중 재고가 다시
        찬 것은 따로 표시한다 — 그게 지울 때가 됐다는 신호다. */
    var 예외셈 = {};
    for (var pk = 0; pk < res.units.length; pk++) {
      var pu = res.units[pk];
      if (!pu.대리품목적용) continue;
      예외셈[pu.대리품목적용] = (예외셈[pu.대리품목적용] || 0) + 1;
    }
    var 예외글 = [];
    for (var pc2 in 예외셈) {
      if (!Object.prototype.hasOwnProperty.call(예외셈, pc2)) continue;
      예외글.push(pc2 + ' ' + 예외셈[pc2] + '건');
    }
    if (예외글.length) {
      sum.push(['대리발송품목으로 뺀 건', 예외글.join(' · ') +
        '  — 입고되면 「대리발송품목」 탭에서 그 줄을 지우세요']);
    }
    var 적용조치 = ssm_stampManual(res.units, runKey);

    단계 = ss단계_('중복 점검');
    var dup = ss_중복점검(true);
    /*  ★ 「연속으로 이어진 것」은 따로, 더 크게 말한다 ★  (2026-09-14)
        여러 줄이 지난 회차와 같은 차례로 이어졌다면 그건 재주문이 아니라
        붙여넣기 범위가 겹친 것이다. 그대로 두면 «이미 나간 것»이 또 나간다.
        그냥 「중복 의심」에 섞어 두면 날마다 뜨는 의심들 속에 묻힌다. */
    if (dup.이어짐) {
      ssWarn(res.warnings, '오류', 'DUP_RUN',
        dup.이어짐 + '덩이 ' + dup.이어짐줄 + '줄',
        '이전 회차와 연속으로 같은 줄이 있습니다 — 판매현황에 지난 회차가 딸려온 듯합니다. ' +
        '「중복의심」 탭 맨 위 묶음을 보고 지운 뒤 다시 실행하세요.');
    }
    if (dup.cross) {
      ssWarn(res.warnings, '오류', 'DUP_CROSS', String(dup.cross) + '그룹',
        '회차 간 중복 의심이 있습니다. 오전에 출고한 건이 다시 올라왔을 수 있습니다. 「중복의심」 탭 확인.');
    }
    if (dup.이어짐 || dup.cross) {
      ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,
        res.warnings.map(function (w) { return [w.level, w.code, w.target, w.msg]; }), { bg: '#7a5b12' });
    }
    if (그날쌓음) {
      /*  ★ 회차별로 갈라 보여 준다 ★  (2026-09-16)
      > "이게 쌓이니까 검증이 맞게 되는지 확인이 어렵네"

      「1차 120 · 2차 +45 · 3차 +30」처럼 읽힌다 — 2차에 «새로» 들어온 것이
      45건이라는 뜻이다. 그 숫자를 이카운트에서 새로 뜬 주문 수와 맞대 보면
      제대로 쌓였는지 그 자리에서 안다. 합계만 보면 많은지 적은지밖에 모른다. */
      var _탭글_ = (SS_DAILY_복원결과_ && SS_DAILY_복원결과_.총줄)
        ? (SS_DAILY_복원결과_.총줄 + '행')
        : (그날쌓음 + '행');
      if (SS_DAILY_복원결과_ && SS_DAILY_복원결과_.회차글) {
        _탭글_ += '   (' + SS_DAILY_복원결과_.회차글 + ')';
      }
      sum.push([runKey.substring(2, 6) + '판매현황 탭', _탭글_]);
      /*  회차마다 그날 «전체»를 붙여넣으므로 앞 회차 줄이 딸려온다.
          그것을 몇 줄 걸렀는지 보여 준다 — 조용히 버리면 「왜 줄이 적지」가 된다. */
      if (SS_DAILY_복원결과_ && SS_DAILY_복원결과_.겹쳐버림) {
        sum.push(['  ↷ 앞 회차와 겹쳐 버린 줄',
          SS_DAILY_복원결과_.겹쳐버림 + '행 (전체분을 붙여넣어 딸려온 것)']);
      }
    }
    if (SS_DAILY_복원결과_ && SS_DAILY_복원결과_.줄수) {
      /*  되살렸다는 사실은 «반드시» 눈에 보여야 한다. 원장에서 온 줄은 판매현황
          몇 칸이 비어 있고, 그게 정상이라는 걸 아는 사람만 알면 안 된다. */
      sum.push(['  └ 원장에서 되살림',
        SS_DAILY_복원결과_.줄수 + '행 · 회차 ' + SS_DAILY_복원결과_.회차들.join(', ') +
        ' (배송비 3칸·상호·주문서/사방넷 칸은 원장에 안 남아 빕니다)']);
    }
    sum.push(['중복의심 그룹 (회차간)', dup.groups + ' (' + dup.cross + ')']);
    if (dup.이어짐) {
      sum.push(['★ 이전 회차와 연속 일치', dup.이어짐 + '덩이 ' + dup.이어짐줄 + '줄']);
    }
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

    /*  ★ 어디서 시간을 썼는지 적는다 ★  (2026-09-16)
        > "재실행 했을떄 속도가 72초로 나왔어"

        오래 걸린 구간부터 적는다. 0.2초 밑은 빼서 큰 놈이 묻히지 않게 한다.
        「소요(초)」는 원장을 적재한 시점 값이라 중복점검 뒤가 빠져 있었다 —
        사람이 체감하는 시간과 달라 헷갈린다. 전체 시간을 따로 적는다. */
    var 총초 = (new Date().getTime() - t0) / 1000;
    sum.push(['소요(초) · 전체', 총초.toFixed(1) + '초  (위 「소요(초)」는 원장 적재까지)']);
    var 시계 = ss시계표_();
    if (시계.length) {
      sum.push(['⏱ 오래 걸린 구간', 시계.length + '개 (0.2초 넘는 것만)']);
      for (var tk = 0; tk < 시계.length; tk++) sum.push(시계[tk]);
    }
    ssio_write(SSIO_TABS.요약, SS_SUMMARY_HEADER, sum);

    /*  ★ 이 회차를 v2 로 올린다 ★  (2026-09-21 · gasV2.js)
        판매현황은 다음 회차에 덮어쓰므로 «지금» 아니면 짝을 맞출 수 없다.
        예약만 하고 지나간다 — 사람을 기다리게 하지 않는다. */
    var v2예약 = ss_v2_예약_(runKey);
    if (v2예약) sum.push(['v2 올리기', v2예약]);
    if (v2예약) ssio_write(SSIO_TABS.요약, SS_SUMMARY_HEADER, sum);

    var 대표 = (res.합배송뷰 || []).length - res.stats.합포장흡수;
    /*  사람이 견주는 숫자는 «누른 뒤 뜰 때까지»다. 원장 적재까지만 센 값을
        보여 주면 「72초라더니 왜 40초라 하나」가 된다 (2026-09-16). */
    var 구간글 = '';
    for (var tg = 0; tg < 시계.length && tg < 3; tg++) {
      구간글 += '\n   ' + 시계[tg][0].replace('  · ', '') + ' ' + 시계[tg][1];
    }
    var msg = '세트분리 완료 · ' + 총초.toFixed(1) + '초' +
      (구간글 ? '   (오래 걸린 곳:' + 구간글 + ')' : '') + '\n' +
      '회차 ' + runKey + (회차.재실행 ? '  (재실행 — 원장 ' + 지운행 + '행 교체)' : '  (신규)') + '\n\n' +
      '입력 ' + res.stats.입력행 + '행 → 분해 ' + res.stats.분해행 + '행\n' +
      '실제 송장 ' + res.stats.송장건수 + '건   (탭 합계 ' + res.stats.출력행 +
      ' = 분해행 ' + (res.stats.분해행 === res.stats.출력행 ? '✔' : '✘') + ')\n\n' +
      '  ' + SS_ROUTE.LOTTE + ' ' + res.stats['탭_' + SS_ROUTE.LOTTE] + '\n' +
      '  도서산간 ' + res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND] + ss_권역요약(res) +
      ' · 도서산간(위탁) ' + res.stats['탭_' + SS_ROUTE.LOTTE_ISLAND_CONSIGN] +
      '  대리발송 ' + res.stats['탭_' + SS_ROUTE.PARTNER] + '\n' +
      '  합배송 ' + 대표 + '박스 · 동봉 ' + res.stats.합포장흡수 + '행 (모두 출력 탭에 포함)\n' +
      '  비배송 ' + nonship.length + '행 (적립금·배송비 등, 매출엔 포함)' + String.fromCharCode(10) +
      '  보류(미발송) ' + res.stats.보류 +
      (res.stats.보류 ? '   ← 우편번호: ' + (재실행 || '해당 없음') : '') + '\n\n' +
      (막은줄 ? '  ★ 그중 ' + 막은줄 + '행은 «이미 나간 줄»이라 막았습니다\n' : '') +
      '\n' +
      '경고 ' + res.warnings.length + '건' +
      (dup.cross ? '   ⚠ 회차간 중복의심 ' + dup.cross + '그룹' : '') + '\n' +
      '재고 기준 ' + (ssm_stampOf('재고') || '모름');
    ssio_alert(msg +
      /*  막은 것이 있으면 «그것부터» 말한다. 보류 안내보다 앞이다 —
          판매현황에 지난 회차가 딸려왔다는 뜻이라 붙여넣기를 다시 봐야 한다. */
      (막은줄
        ? '\n\n★ ' + 막은줄 + '행이 이미 나간 줄이라 출력 탭에서 뺐습니다.' +
          '\n   판매현황에 지난 회차가 딸려왔는지 먼저 확인하세요.' +
          '\n   정말 다시 보내야 하면 「보류(미발송)」 탭에서 조치하면 됩니다.'
        : '') +
      (res.stats.보류 ? '\n\n※ 「보류(미발송)」 탭을 반드시 확인하세요. 사유가 적혀 있습니다.' : ''));
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
/**
 * 도서산간 두 탭에서 「조치」를 걷는다.  { 순번|품목코드 : 적은값 }
 *
 * ★ 순번 + 품목코드로 잡는다 ★
 *   순번은 판매현황 한 줄에 하나뿐이고(ssNormalize 가 중복을 막는다),
 *   세트가 쪼개지면 품목코드가 갈린다. 고유ID 는 세트 두 줄이 같아서 못 쓴다.
 *
 * ★ 자리는 이름으로 찾는다 ★ SS_ISLAND_HEADER 앞에 네 칸이 더 있다.
 */
function ss_섬조치걷기_() {
  var out = {};
  var 탭들 = [SS_ROUTE.LOTTE_ISLAND, SS_ROUTE.LOTTE_ISLAND_CONSIGN];
  var iSeq = SS_ISLAND_HEADER.indexOf('순번');
  var iCode = SS_ISLAND_HEADER.indexOf('품목코드');
  var iAct = SS_ISLAND_HEADER.indexOf('조치');
  if (iSeq < 0 || iCode < 0 || iAct < 0) return out;
  for (var t = 0; t < 탭들.length; t++) {
    try {
      var sh = ssio_ss().getSheetByName(탭들[t]);
      if (!sh || sh.getLastRow() < 2) continue;
      var w = Math.max(sh.getLastColumn(), SS_ISLAND_HEADER.length);
      var v = sh.getRange(2, 1, sh.getLastRow() - 1, w).getDisplayValues();
      for (var r = 0; r < v.length; r++) {
        var a = ssText(v[r][iAct]);
        if (!a) continue;
        var k = ssText(v[r][iSeq]) + '|' + ssText(v[r][iCode]);
        if (k !== '|') out[k] = a;
      }
    } catch (e) {
      //  못 읽어도 실행은 계속한다. 조치를 한 번 더 적는 수고일 뿐이다.
    }
  }
  return out;
}

/** 걷어 둔 조치를 같은 줄에 되돌린다. 없으면 빈칸 그대로. */
function ss_섬조치되돌리기_(rows, 섬조치) {
  if (!섬조치) return rows;
  var iSeq = SS_ISLAND_HEADER.indexOf('순번');
  var iCode = SS_ISLAND_HEADER.indexOf('품목코드');
  var iAct = SS_ISLAND_HEADER.indexOf('조치');
  if (iSeq < 0 || iCode < 0 || iAct < 0) return rows;
  for (var i = 0; i < rows.length; i++) {
    var k = ssText(rows[i][iSeq]) + '|' + ssText(rows[i][iCode]);
    if (섬조치[k]) rows[i][iAct] = 섬조치[k];
  }
  return rows;
}

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

/**
 * 회차키(YYMMDD-N)가 며칠 전 것인가. 못 읽으면 0.
 * 「1~7일은 기다리는 중, 20일 넘으면 사람이 봐야 한다」를 가르는 자다.
 */
/**
 * 이미 있는 회차를 «그대로 쓰되» 지문만 이번 내용으로 갈아 끼운다.
 *
 * 지문을 갱신하는 까닭: 다음에 또 같은 내용으로 ▶ 세트분리 실행을 눌러도
 * 이 회차에 붙게 하려는 것이다. 안 갈아 끼우면 다음 실행이 새 회차를 판다.
 *
 * 회차키가 표에 없으면(사람이 지웠다면) 평소대로 판정한다 —
 * 없는 회차에 억지로 쌓으면 원장과 회차표가 어긋난다.
 */
function ss_회차유지확정(회차키, 지문, 입력행) {
  var sh = ssio_sheet(SSIO_TABS.회차, SS_ROUND_HEADER);
  var rows = ssio_body(SSIO_TABS.회차);
  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  for (var i = 0; i < rows.length; i++) {
    if (ssText(rows[i][0]) !== ssText(회차키)) continue;
    sh.getRange(i + 2, 2, 1, 1).setValues([[지문]]);
    sh.getRange(i + 2, 5, 1, 4).setValues([[입력행, ssText(rows[i][5]) || now, now, ssNum(rows[i][7]) + 1]]);
    return { key: ssText(rows[i][0]), no: ssNum(rows[i][3]), 재실행: true, 회차유지: true };
  }
  //  없는 회차를 가리켰다 — 평소대로 판정한다
  return ss_회차확정(지문, 입력행);
}

function ss_회차나이_(회차키) {
  var k = ssText(회차키);
  if (!/^[0-9]{6}-/.test(k)) return 0;
  var y = 2000 + parseInt(k.substring(0, 2), 10);
  var m = parseInt(k.substring(2, 4), 10) - 1;
  var d = parseInt(k.substring(4, 6), 10);
  var 그날 = new Date(y, m, d);
  if (isNaN(그날.getTime())) return 0;
  var 오늘 = new Date();
  var 일 = Math.floor((오늘.getTime() - 그날.getTime()) / 86400000);
  return 일 > 0 ? 일 : 0;
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

  /*  ★ 「주문번호출처」 칸이 없으면 말한다 ★  (2026-09-16)
      이 칸이 있어야 사방넷 건과 전화주문을 갈라 본다. 없으면 옛 판정으로
      돌아가 사방넷 건이 다시 중복 의심으로 올라온다 — 그런데 «조용히» 그렇다.
      need 에 넣어 막지는 않는다. 중복점검은 곁다리라 이걸로 못 돌게 하면
      손해가 더 크다. 대신 결과에 적어 사람이 원장을 갱신하게 한다. */
  var 출처칸있음 = idx['주문번호출처'] !== undefined;

  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd');

  /* ★ 어제까지 본다 ★  (2026-09-14)
     > "회차별 중복감지를 전날까지 확장을 시켜줘"

     여태 «오늘 회차»만 담았다. 그래서 어제 것이 판매현황에 딸려 들어와도
     견줄 상대가 없어 통째로 지나갔다 — 오류도 경고도 없이.
     날마다 쌓이는 표라 넓게 잡을 이유는 없다. 기본 2일(오늘+어제)이고,
     연휴 뒤처럼 더 봐야 하면 설정 「중복점검_대상일수」를 올린다. */
  var 볼일수 = ssNum(ssio_config()['중복점검_대상일수']);
  if (!(볼일수 >= 1)) 볼일수 = 2;
  var 볼날 = {};
  for (var d = 0; d < 볼일수; d++) {
    볼날[Utilities.formatDate(new Date(new Date().getTime() - d * 86400000),
      'Asia/Seoul', 'yyMMdd')] = true;
  }

  var all = sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues();
  var rows = [];
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (!볼날[ssText(r[idx['회차키']]).substring(0, 6)]) continue;
    rows.push({
      회차: ssText(r[idx['회차키']]),
      고유ID: ssText(r[idx['고유ID']]),
      /*  사방넷이 준 번호인가, 우리가 만든 것인가.
         중복 판정이 이 둘을 다르게 다룬다 (2026-09-16). */
      주문번호출처: 출처칸있음 ? ssText(r[idx['주문번호출처']]) : '',
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

  /*  ★ 오늘이 안 낀 묶음은 버린다 ★
      어제 것끼리 겹친 건 어제 이미 본 이야기다. 창을 넓힌 값으로 지난 회차의
      묶음까지 매번 다시 띄우면, 정작 오늘 것이 그 속에 묻힌다. */
  var 오늘낌 = function (G) {
    for (var m = 0; m < G.members.length; m++) {
      if (ssText(found.records[G.members[m]].회차).substring(0, 6) === today) return true;
    }
    return false;
  };
  found.groups = found.groups.filter(오늘낌);

  /*  ★ «연속 블록»은 따로 찾는다 ★
      한 줄씩 보면 정상 재주문과 구분이 안 된다. 붙여넣기 범위가 겹쳐
      딸려온 것은 여러 줄이 지난 회차와 같은 차례로 이어진다. */
  var 이어짐 = ssDupRunGroups(found.records, today, 2);
  found.groups = 이어짐.concat(found.groups);

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
  var 이어짐줄 = 0;
  for (var k2 = 0; k2 < 이어짐.length; k2++) 이어짐줄 += 이어짐[k2].길이;
  /*  사방넷 건과 전화주문이 각각 몇 줄이었나 — 갈라 본 것이 맞는지 눈으로 확인한다 */
  var 사방넷줄 = 0, 전화줄 = 0;
  for (var s1 = 0; s1 < found.records.length; s1++) {
    if (ssText(found.records[s1].주문번호출처) === SS_ORDNO_SRC.사방넷) 사방넷줄++;
    else 전화줄++;
  }
  var res = { groups: found.groups.length, rows: out.length, cross: cross,
    주문라인: found.records.length, 이어짐: 이어짐.length, 이어짐줄: 이어짐줄,
    사방넷: 사방넷줄, 전화: 전화줄, 출처칸: 출처칸있음 };

  if (!quiet) {
    var msg = '중복발주 의심 점검 (' + today + ')\n\n' +
      '  · 견준 회차 : 최근 ' + 볼일수 + '일 (오늘 포함)\n' +
      '  · 주문라인 : ' + res.주문라인 + '건  (사방넷 ' + res.사방넷 + ' · 전화주문 ' + res.전화 + ')\n' +
      '  · 의심 그룹 : ' + res.groups + '건 (그중 회차 간 ' + res.cross + '건)\n' +
      '  · 표시 행 : ' + res.rows + '\n';
    if (res.이어짐) {
      msg += '  · ★ 이전 회차와 «연속으로» 같은 묶음 : ' + res.이어짐 + '덩이 ' +
        res.이어짐줄 + '줄\n';
    }
    /*  사방넷은 주문번호가 다르면 다른 주문이다 — 이어짐 검사에서 아예 뺀다.
        그 사실을 화면에도 적어 둔다. 「왜 안 잡히지」를 묻지 않게. */
    msg += '  · 이어짐 검사 대상 : 전화주문만 (사방넷은 주문번호가 다르면 다른 건)\n';
    if (!res.출처칸) {
      msg += '\n⚠ 원장에 「주문번호출처」 칸이 없어 사방넷·전화주문을 못 가렸습니다.\n' +
        '   「🛠 시트 설치 / 복구」를 한 번 돌리면 칸이 생깁니다.\n';
    }
    msg += '\n';
    msg += res.이어짐
      ? '⚠ 여러 줄이 이전 회차와 «같은 차례로» 이어집니다.\n' +
        '   판매현황을 붙여넣을 때 지난 회차 범위가 같이 딸려온 모양입니다.\n' +
        '   「중복의심」 탭 맨 위 묶음을 보고, 딸려온 줄을 판매현황에서 지운 뒤\n' +
        '   다시 실행하세요.'
      : (res.cross
        ? '⚠ 회차 간 중복이 있습니다. 오전에 이미 출고한 건이 오후에 다시 올라왔을 수 있습니다.\n「중복의심」 탭을 확인하세요.'
        : (res.groups ? '회차 간 중복은 없습니다. 같은 회차 안 반복 주문일 수 있으니 탭에서 확인하세요.'
                      : '의심 건이 없습니다.'));
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
    '이 칸 하나로 정합니다.' + String.fromCharCode(10) + String.fromCharCode(10) +
    '  발송        자체 출고 (보류 해제)' + String.fromCharCode(10) +
    '  업체코드    그 업체로 대리발송  예) JH, HP' + String.fromCharCode(10) +
    '  비워 둠     그대로 보류' + String.fromCharCode(10) + String.fromCharCode(10) +
    'U열 상세를 지워도 해소된 것으로 보고 발송합니다.' + String.fromCharCode(10) +
    '등록된 업체코드 : ' + codes.join(', ') + String.fromCharCode(10) + String.fromCharCode(10) +
    '적은 뒤 메뉴 → ✅ 보류 조치 반영' + String.fromCharCode(10) +
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
      String.fromCharCode(10) + '    적은 값 : ' + (적은값 || '(비움)') + '   상세 : ' + (상세 || '(비움)') +
      String.fromCharCode(10) + '    판정   : ' + 판정 +
      (문제.length ? String.fromCharCode(10) + '    ⚠ ' + 문제.join(' / ') : ''));
  }

  return ssio_alert('보류 조치 진단' + String.fromCharCode(10) + String.fromCharCode(10) +
    '보류 ' + v.length + '행 중 입력된 줄 ' + 입력 + '개' + String.fromCharCode(10) +
    '등록된 업체코드 : ' + codes.join(', ') + String.fromCharCode(10) + String.fromCharCode(10) +
    (L.length ? L.join(String.fromCharCode(10) + String.fromCharCode(10)) : '입력된 줄이 없습니다.') +
    String.fromCharCode(10) + String.fromCharCode(10) + '문제가 없으면 메뉴 → ✅ 보류 조치 반영');
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  📋 대리발송품목 진단 — 적어 둔 품목이 «어디서» 빠졌는가
 *
 *  > "우리 재고가 있어.. 하지만 대리발송으로 넘기고 싶을때 대리발송품목을
 *  >  만드는건데.. 지금 세트분리에서 대리발송으로 분리가 안되고
 *  >  그냥 로젠출력으로 넘어가네.. 확인해줘"
 *
 *  짐작으로 답하지 않는다. 마지막 회차 «원장»에 그 줄이 어디로 갔는지
 *  이미 적혀 있다. 그것을 읽어서 말한다.
 *
 *  갈리는 자리는 넷뿐이다 —
 *    ① 표를 아예 못 읽는다      (탭 없음 · 머리글 없이 첫 줄부터 적음)
 *    ② 코드가 안 맞는다          (부호·공백·전각 차이)
 *    ③ 수동조치가 이긴다         (보류 탭에서 「발송」으로 뒤집은 건)
 *    ④ 맞는데도 안 갔다          (그러면 그것이 결함이다 — 그대로 말한다)
 * ═══════════════════════════════════════════════════════════════
 */
function ss_대리품목진단() {
  var NL = String.fromCharCode(10);
  var 줄 = [];

  /* ── ① 표를 읽는다 ───────────────────────────────────── */
  var sh = ssio_ss().getSheetByName(SSIO_TABS.대리발송품목);
  if (!sh) {
    return ssio_alert('「대리발송품목」 탭이 없습니다.' + NL + NL +
      '메뉴 → ⚙ 설정 · 설치 → 🛠 시트 설치 / 복구 를 한 번 누르면 만들어집니다.');
  }
  var lr = sh.getLastRow();
  var raw = lr > 0
    ? sh.getRange(1, 1, lr, Math.max(sh.getLastColumn(), 3)).getValues()
    : [];

  /*  ★ 머리글이 없으면 첫 줄이 «먹힌다» ★
      이 표는 첫 줄을 머리글로 보고 건너뛴다. 사람이 머리글 없이 코드부터
      적으면 그 한 줄이 통째로 읽히지 않는다. 조용히. */
  var 머리 = raw.length ? ssText(raw[0][0]) : '';
  if (머리 && 머리 !== SSM_PARTNER_ITEM_HEADER[0]) {
    줄.push('★ 첫 줄(A1)이 「' + SSM_PARTNER_ITEM_HEADER[0] + '」 가 아니라 「' + 머리 + '」 입니다.');
    줄.push('   이 표는 첫 줄을 «머리글»로 보고 건너뜁니다 — 그 줄은 지금 읽히지 않습니다.');
    줄.push('   1행에  ' + SSM_PARTNER_ITEM_HEADER.join(' / ') + '  을 넣고 코드는 2행부터 적어 주세요.');
    줄.push('');
  }

  var 표 = [], 표코드 = {};
  for (var r = 1; r < raw.length; r++) {
    var c = ssText(raw[r][0]).toUpperCase();
    if (!c) continue;
    var e = { 코드: c, 업체: ssText(raw[r][1]).toUpperCase(), 행: r + 1 };
    표.push(e);
    표코드[c] = e;
  }

  if (!표.length) {
    줄.push('표에 적힌 품목이 «0개» 입니다. 2행부터 이카운트코드를 적어 주세요.');
    return ssio_alert('📋 대리발송품목 진단' + NL + NL + 줄.join(NL));
  }

  var vendors = {};
  var vd = ssio_body(SSIO_TABS.업체);
  for (var q = 0; q < vd.length; q++) {
    var vc0 = ssText(vd[q][0]).toUpperCase();
    if (vc0) vendors[vc0] = ssText(vd[q][1]);
  }

  줄.push('표에 적힌 품목 : ' + 표.length + '개');
  for (var t = 0; t < 표.length && t < 10; t++) {
    줄.push('   ' + 표[t].코드 +
      (표[t].업체 ? '  →  ' + 표[t].업체 + ' ' + (vendors[표[t].업체] || '(업체표에 없음)') : '  (업체코드 없음)'));
  }
  if (표.length > 10) 줄.push('   … 외 ' + (표.length - 10) + '개');
  줄.push('');

  /* ── ② 마지막 회차 원장을 읽는다 ─────────────────────── */
  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!lg || lg.getLastRow() < 2) {
    줄.push('원장이 비어 있습니다 — 세트분리를 한 번 실행한 뒤에 다시 눌러 주세요.');
    return ssio_alert('📋 대리발송품목 진단' + NL + NL + 줄.join(NL));
  }
  var lc = lg.getLastColumn();
  var lhead = lg.getRange(1, 1, 1, lc).getValues()[0];
  var li = {};
  for (var h = 0; h < lhead.length; h++) {
    var hn = ssText(lhead[h]);
    if (hn && li[hn] === undefined) li[hn] = h;
  }
  var 필요 = ['회차키', '경로', '원본품목코드', '품목코드', '순번', '고유ID'];
  var 없는칸 = [];
  for (var n = 0; n < 필요.length; n++) if (li[필요[n]] === undefined) 없는칸.push(필요[n]);
  if (없는칸.length) {
    줄.push('원장에서 칸을 못 찾았습니다 : ' + 없는칸.join(', '));
    줄.push('메뉴 → 🛠 시트 설치 / 복구 로 머리글을 맞춰 주세요.');
    return ssio_alert('📋 대리발송품목 진단' + NL + NL + 줄.join(NL));
  }

  var lv = lg.getRange(2, 1, lg.getLastRow() - 1, lc).getValues();
  var 마지막회차 = ssText(lv[lv.length - 1][li['회차키']]);
  var 회차행 = [];
  for (var y = 0; y < lv.length; y++) {
    if (ssText(lv[y][li['회차키']]) === 마지막회차) 회차행.push(lv[y]);
  }
  줄.push('마지막 회차 : ' + 마지막회차 + '  (' + 회차행.length + '줄)');
  줄.push('');

  /* ── ③ 수동조치에서 「발송」으로 뒤집은 건 ───────────── */
  var 뒤집힘 = {};
  var mb = ssio_body(SSIO_TABS.수동조치);
  for (var m = 0; m < mb.length; m++) {
    if (ssText(mb[m][3]) !== '발송') continue;
    /*  ★ 사람이 «적은» 것인가, 기계가 «짐작한» 것인가 ★  (2026-09-17)
        ssm_captureManual 에는 이런 길이 있다 —
          상세(사유 내용)를 지웠으면 해소된 것으로 보고 조치를 「발송」으로 적는다.
        아무도 발송이라 치지 않아도 발송이 박힌다. 그 둘을 뭉뚱그려
        「사람 손이 이깁니다」라고 하면 진단이 거짓말을 하는 셈이다. */
    뒤집힘[ssText(mb[m][1]) + '|' + ssText(mb[m][2]).toUpperCase()] = {
      메모: ssText(mb[m][5]),
      등록회차: ssText(mb[m][6]),
      등록시각: ssText(mb[m][7])
    };
  }

  /* ── ④ 표의 코드가 이 회차에 나왔는가 ───────────────── */
  var 만난줄 = [], 경로셈 = {}, 딴데간것 = [];
  for (var z = 0; z < 회차행.length; z++) {
    var row = 회차행[z];
    var oc = ssText(row[li['원본품목코드']]).toUpperCase();
    var ic = ssText(row[li['품목코드']]).toUpperCase();
    var hit = 표코드[oc] || 표코드[ic];
    if (!hit) continue;
    var 경로 = ssText(row[li['경로']]);
    만난줄.push(row);
    경로셈[경로] = (경로셈[경로] || 0) + 1;
    if (경로 === SS_ROUTE.PARTNER) continue;
    var uid = ssText(row[li['고유ID']]);
    var ov = 뒤집힘[uid + '|' + oc];
    var 왜;
    if (ov) {
      var 짐작 = ov.메모 && ov.메모.indexOf('상세 지움') >= 0;
      왜 = 짐작
        ? '★ 아무도 「발송」이라 적지 않았습니다 — «상세를 지워서» 기계가 발송으로 «짐작»한 건입니다'
        : '보류 탭에서 사람이 「발송」이라 «적은» 건입니다';
      왜 += NL + '      수동조치 탭 · 등록회차 ' + (ov.등록회차 || '(없음)') +
        ' · 메모 ' + (ov.메모 ? '「' + ov.메모 + '」' : '(비어 있음)');
    } else if (경로 === SS_ROUTE.NONSHIP) {
      왜 = '비배송으로 빠졌습니다';
    } else if (경로 === SS_ROUTE.HOLD) {
      왜 = '보류 : ' + ssText(row[li['보류사유']]);
    } else {
      왜 = '★ 코드는 맞는데 대리발송으로 안 갔습니다 — 결함입니다';
    }
    /*  세트는 한 순번이 여러 줄로 쪼개진다. 순번만 적으면 같은 줄이
        두 번 찍힌 것처럼 보인다 — 라인ID 로 갈라 준다. */
    딴데간것.push('   ' + ssText(row[li['라인ID']] || row[li['순번']]) +
      '  ' + (oc === ic ? oc : oc + '→' + ic) +
      '  [' + 경로 + ']' + NL + '      ' + 왜);
  }

  if (!만난줄.length) {
    줄.push('★ 이 회차에서 그 코드를 «한 줄도» 만나지 못했습니다.');
    줄.push('');
    /*  ★ 느슨하게 맞춰 본다 ★
        부호·공백·전각만 다른 코드는 사람 눈에 같아 보인다.
        「없다」고만 하면 사람은 표가 왜 안 먹는지 영영 모른다. */
    var 느슨 = {};
    for (var w = 0; w < 회차행.length; w++) {
      var a1 = ssText(회차행[w][li['원본품목코드']]).toUpperCase();
      var a2 = ssText(회차행[w][li['품목코드']]).toUpperCase();
      if (a1) 느슨[ss_코드압축_(a1)] = a1;
      if (a2) 느슨[ss_코드압축_(a2)] = a2;
    }
    var 후보 = [];
    for (var b = 0; b < 표.length; b++) {
      var 짝 = 느슨[ss_코드압축_(표[b].코드)];
      if (짝 && 짝 !== 표[b].코드) 후보.push('   표 「' + 표[b].코드 + '」  ↔  판매현황 「' + 짝 + '」');
    }
    if (후보.length) {
      줄.push('부호·공백만 다른 코드를 찾았습니다 — 이것이 원인입니다 :');
      줄 = 줄.concat(후보.slice(0, 8));
      줄.push('');
      줄.push('표의 코드를 판매현황과 «똑같이» 맞춰 주세요.');
    } else {
      줄.push('비슷한 코드도 없습니다. 둘 중 하나입니다 —');
      줄.push('   · 이 회차 판매현황에 그 품목 주문이 아예 없었다');
      줄.push('   · 표에 적은 것이 이카운트코드가 아니라 품목명이다');
    }
    return ssio_alert('📋 대리발송품목 진단' + NL + NL + 줄.join(NL));
  }

  var 경로글 = [];
  for (var k in 경로셈) if (Object.prototype.hasOwnProperty.call(경로셈, k)) 경로글.push(k + ' ' + 경로셈[k]);
  줄.push('그 코드를 만난 줄 : ' + 만난줄.length + '건');
  줄.push('   ' + 경로글.join('  ·  '));
  줄.push('');
  if (!딴데간것.length) {
    줄.push('✅ 전부 대리발송으로 갔습니다. 표는 제대로 돌고 있습니다.');
  } else {
    줄.push('대리발송으로 안 간 줄 ' + 딴데간것.length + '건 —');
    줄 = 줄.concat(딴데간것.slice(0, 8));
    if (딴데간것.length > 8) 줄.push('   … 외 ' + (딴데간것.length - 8) + '건');
  }

  return ssio_alert('📋 대리발송품목 진단' + NL + NL + 줄.join(NL));
}

/** 코드를 느슨하게 견주기 — 영문·숫자만 남긴다 (정규식을 쓰지 않는다) */
function ss_코드압축_(s) {
  var out = '';
  var t = ssText(s).toUpperCase();
  for (var i = 0; i < t.length; i++) {
    var c = t.charAt(i);
    if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z')) out += c;
  }
  return out;
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
// 송장 셀 파싱용 — 공백·쉼표·슬래시·줄바꿈으로 쪼개고, 숫자만 남은 토큰을 송장으로 본다
var ssInvSplitRe_ = new RegExp("[" + String.fromCharCode(92) + "s,/]+");
var ssDigitsRe_ = new RegExp("^[0-9]+$");

/**
 * 칸에서 운송장번호를 **전부** 뽑는다.
 * 한 칸에 여러 장이 쉼표·공백·줄바꿈으로 붙어 오는 일이 흔하다.
 * 9자리 미만은 송장이 아니다(메모·수량이 섞여 온다).
 */
/**
 * 한 칸의 글자 → 송장번호들.
 *
 * ★ 하이픈은 «구분자가 아니다» ★  (2026-09-16)
 *   여태 숫자가 아닌 글자를 모두 구분자로 봤다(split(/[^0-9]+/)).
 *   그런데 로젠은 송장을 「451-6945-9705」 처럼 찍는다. 그러면
 *   451 · 6945 · 9705 세 토막이 되고 전부 9자리 미만이라 «다 버려진다».
 *
 *   실제로 그랬다 — 전파가 로젠 탭 816줄을 읽고도 표가 비어 있었고
 *   (「원천 · 롯데 0」) 자사출고 송장이 한 건도 안 붙었다.
 *   오류는 안 났다. 읽은 줄 수만 세고 있어서 816 으로 보였다.
 *
 *   진짜 구분자는 줄바꿈·공백·쉼표·세미콜론·/·| 다 — 한 칸에 송장이
 *   여러 장일 때 그것들로 이어 적는다. 그 규칙은 gasBulk 의
 *   SSB_INV_SPLIT 에 이미 있다. 여기에 또 적지 않는다.
 *   토막마다 숫자만 남겨 9자리 이상이면 송장으로 본다.
 */
function ssInvAll_(raw) {
  var out = [], seen = {};
  var toks = String(raw == null ? '' : raw).split(SSB_INV_SPLIT);
  for (var i = 0; i < toks.length; i++) {
    var d = String(toks[i]).replace(new RegExp('[^0-9]', 'g'), '');
    if (!d || d.length < 9 || seen[d]) continue;
    seen[d] = true;
    out.push(d);
  }
  return out;
}

/**
 * 주문번호 → 송장들. 덮지 않고 **모은다.**
 * 여기가 이번 고침의 핵심이다 — 예전에는 map[key] = w 라 마지막 1장만 남았다.
 */
function ssInvPut_(map, key, raw, carrier) {
  if (!key) return;
  var got = ssInvAll_(raw);
  if (!got.length) return;
  var cur = map[key] || { list: [], c: '' };
  for (var i = 0; i < got.length; i++) {
    if (cur.list.indexOf(got[i]) === -1) cur.list.push(got[i]);
  }
  if (!cur.c && carrier) cur.c = carrier;
  map[key] = cur;
}

/** 화면·원장에 적을 꼴 — 공백으로 잇는다. 일일마감·CS 검색이 읽는 형식이다. */
function ssInvJoin_(entry) {
  return entry && entry.list ? entry.list.join(' ') : '';
}
function ss_송장전파() {
  var inv = ssio_ss().getSheetByName(SSIO_TABS.사방넷송장);
  if (!inv || inv.getLastRow() < 2) {
    return ssio_alert('「사방넷송장」 탭이 비어 있습니다. 세트분리를 먼저 실행하세요.');
  }
  var NL = String.fromCharCode(10);
  var cfg = ssio_config();

  /* ── 1a) 자사출고 송장 — «탭이 곧 택배사다» ────────────────────
     5️⃣ 송장수집이 채워 두는 곳이라 붙여넣기가 필요 없다.

     ★ 2026-09-11: 로젠으로 바꿨다 ★
       > "거래관리대장송장의 입력_로젠주문실적에서 송장번호를 불러와야되"

       종전에는 롯데 탭만 읽으면서 택배사만 「로젠택배」로 적고 있었다 —
       이름이 거짓말을 하는 상태였다. 이제 탭에서 온 이름을 그대로 쓴다.

     ★ 두 탭을 다 읽는다 ★
       9/10 까지는 롯데 탭, 9/11 부터는 로젠 탭. 한쪽만 보면 갈아탄 날
       앞뒤가 조용히 빠진다. 같은 주문번호가 양쪽에 있으면 «먼저 읽은 쪽»이
       택배사를 갖는데, 로젠을 앞에 둬서 지금 것이 이기게 한다.

     칸은 머리글 이름으로 먼저 찾고, 못 찾으면 탭마다 정해진 자리를 쓴다. */
  var lotte = {}, lotteErr = '';
  /*  ★ 로젠 탭에는 머리글이 «없다» ★  (2026-09-15)
      > "⚠ 자사출고 송장탭을 읽지 못했습니다 — 임시기록만으로 매칭했습니다"
      > "로젠: 「주문번호」·「운송장번호」 머리글을 못 찾았습니다"

      실제 전파 결과가 그렇게 나왔다. 탭이 「집하」 양식이라 1행부터 바로
      자료고, ssb_findHeader 가 못 찾으면 여기서 throw 로 그 원천을 버렸다.
      그래서 자사출고 송장이 «0건»이고 미매칭이 571 로 남았다.

      예비 자리도 옛 44칸 양식(uid:18·inv:3)이라 살릴 수도 없었다.
      실제 양식에 맞추고, 머리글을 못 찾으면 이 자리로 읽는다.
      대량등록(gasBulk 자사탭)과 «같은 값»이다 — 두 군데가 다르면
      한쪽만 고쳐지고 또 조용히 갈린다. */
  var 자사원천 = [
    { 이름: '로젠', 택배사: '로젠택배',
      gid: ssNum(cfg['로젠송장탭GID']) || 548505068, uid: 9, inv: 10 },
    /*  ★ 롯데는 «예비»다 ★  (2026-09-16)
        > "롯데는 이제 사용을 안해.. 예비로 넣어놨을뿐이야."
        2026-09-10 까지의 옛 건이 여기 있고, 새로 쌓이지는 않는다.
        못 읽어도 사고가 아니다 — 경고로 올리지 않는다. */
    { 이름: '롯데', 택배사: '롯데택배', 예비: true,
      gid: ssNum(cfg['롯데송장탭GID']) || 1575029201, uid: 8, inv: 6 },
  ];
  var 읽은탭 = [];
  for (var oi = 0; oi < 자사원천.length; oi++) {
    var o편 = 자사원천[oi];
    try {
      var lId = ssText(cfg['롯데송장시트ID']) || '1KIBSmjpMVKLGoAkbrcKyTr4LOflszwS_xtMzmRuvYWs';
      var lSS = SpreadsheetApp.openById(lId);
      var lTab = null, shs = lSS.getSheets();
      for (var si = 0; si < shs.length; si++) {
        if (shs[si].getSheetId() === o편.gid) { lTab = shs[si]; break; }
      }
      if (!lTab) throw new Error('GID ' + o편.gid + ' 탭을 찾지 못했습니다 (' + lSS.getName() + ')');
      /* 머리글을 «찾는다» — 1행에 있다고 믿지 않는다.
         로젠 탭은 1행이 제목이고 머리글은 2행이다. 규칙은 gasBulk 의
         ssb_findHeader 한 곳에 있다 — 두 곳에 적으면 또 갈라진다. */
      var H = ssb_findHeader(lTab);
      var 머리없음 = !H.row;
      if (머리없음) {
        /*  포기하지 않는다 — 머리글이 없는 양식이 실제로 있다(로젠 집하).
            적어 둔 자리로 읽되 «자리로 읽었다»고 반드시 말한다. */
        if (!(o편.uid >= 0 && o편.inv >= 0)) {
          throw new Error('머리글도 예비 자리도 없습니다');
        }
        H = { row: 0, uid: o편.uid, inv: o편.inv };
      }
      var ci = H.uid, cw = H.inv;
      var rv = lTab.getRange(H.row + 1, 1, lTab.getLastRow() - H.row,
        Math.max(ci, cw) + 1).getDisplayValues();
      var n편 = 0;
      for (var r = 0; r < rv.length; r++) {
        var o = ssText(rv[r][ci]), w = ssText(rv[r][cw]);
        if (!o || !w) continue;
        if (o.indexOf('주문번호') >= 0 || w.indexOf('운송장') >= 0) continue;
        //  같은 주문번호가 또 오면 **덮지 말고 더한다** (20박스 주문이 있다)
        ssInvPut_(lotte, o, w, o편.택배사);
        n편++;
      }
      읽은탭.push(o편.이름 + ' ' + n편 + '줄(' +
        (머리없음 ? '머리글 없음 → 자리로' : '머리글 ' + H.row + '행') +
        ' · 주문 ' + ssb_col(ci) + ' · 송장 ' + ssb_col(cw) + ')');
    } catch (eL) {
      /*  한 탭이 안 읽혀도 나머지는 읽는다.
          ★ 예비 탭(롯데)이 안 읽히는 건 사고가 아니다 ★
            새로 안 쌓이는 탭이라 비어 있는 게 정상이다. 경고로 올리면
            «진짜 사고»인 로젠 실패가 그 옆에 묻힌다. 말은 하되 조용히. */
      var 줄 = o편.이름 + ': ' + String(eL.message || eL);
      if (o편.예비) {
        읽은탭.push(o편.이름 + ' 못 읽음(예비 탭이라 건너뜀)');
      } else {
        lotteErr = (lotteErr ? lotteErr + ' / ' : '') + 줄;
      }
    }
  }
  //  한 탭이라도 읽혔으면 실패가 아니다
  if (읽은탭.length) lotteErr = '';

  // ── 1b) 대리공급_임시기록 → 협력업체가 보낸 건의 송장 ──
  // 상품정보 시트에 살고, P열 사방넷주문번호 · V열 택배사 · X열 송장번호다.
  var temp = {}, tempErr = '';
  var tRes = ssm_openOptional(cfg['이카운트시트ID'],
    cfg['대리공급_임시기록탭'] || '대리공급_임시기록', '상품정보');
  if (tRes.ok) {
    for (var t = 1; t < tRes.values.length; t++) {
      var tu = ssText(tRes.values[t][15]);
      var tw = ssText(tRes.values[t][23]);
      if (tu && tw) ssInvPut_(temp, tu, tw, ssText(tRes.values[t][21]) || '');
    }
  } else {
    tempErr = tRes.why;
  }

  // ── 1c) 협력업체_발주허브 → 대리판매 건의 송장 (C열 UID · N열 송장번호) ──
  // 대리공급은 임시기록에, 대리판매는 발주허브에 송장이 붙는다. 둘 다 상품정보 시트다.
  var hub = {}, hubErr = '';
  var hRes = ssm_openOptional(cfg['이카운트시트ID'],
    cfg['발주허브탭'] || '협력업체_발주허브', '상품정보');
  if (hRes.ok) {
    // 업체 접두 → 택배사명 (업체_택배사 A열 → C열)
    var pfxCarrier = {};
    try {
      var vc = SpreadsheetApp.openById(cfg['이카운트시트ID']).getSheetByName('업체_택배사');
      if (vc && vc.getLastRow() >= 2) {
        var vcv = vc.getRange(2, 1, vc.getLastRow() - 1, 3).getDisplayValues();
        for (var p = 0; p < vcv.length; p++) {
          var pf = ssText(vcv[p][0]).toUpperCase();
          var cr = ssText(vcv[p][2]);
          if (pf && cr) pfxCarrier[pf] = cr;
        }
      }
    } catch (ePc) {}
    for (var hh = 1; hh < hRes.values.length; hh++) {
      var hu = ssText(hRes.values[hh][2]);
      var hwRaw = ssText(hRes.values[hh][13]);
      if (!hu || !hwRaw) continue;
      // 셀에 송장이 여러 개거나 메모가 섞일 수 있다 — 숫자 9자리 이상인 첫 토큰만 쓴다
      var hw = '';
      var toks = hwRaw.split(ssInvSplitRe_);
      for (var tk = 0; tk < toks.length; tk++) {
        var d = ssText(toks[tk]).split('-').join('');
        if (d.length >= 9 && ssDigitsRe_.test(d)) { hw = d; break; }
      }
      if (!hw) continue;
      var hv = ssText(hRes.values[hh][1]).toUpperCase();
      ssInvPut_(hub, hu, hwRaw, pfxCarrier[hv] || '');
    }
  } else {
    hubErr = hRes.why;
  }

  if (lotteErr && tempErr && hubErr) {
    return ssio_alert('송장 원천을 하나도 읽지 못했습니다.' + NL + NL +
      '자사출고 송장탭: ' + lotteErr + NL + '임시기록: ' + tempErr + NL + '발주허브: ' + hubErr);
  }

  // 통합 조회 — 롯데가 먼저, 없으면 임시기록
  /* 송장이 여러 장이면 공백으로 이어 준다. 한 장만 주면 CS 가 나머지 박스를
     조회할 수 없다 — 실측에서 74장이 그렇게 사라지고 있었다. */
  function find(uid) {
    //  택배사는 «읽은 탭»이 알려 준 것을 그대로 쓴다 — 박아 두면 또 거짓말이 된다
    if (lotte[uid]) return { w: ssInvJoin_(lotte[uid]), c: lotte[uid].c || '로젠택배', src: '자사' };
    if (temp[uid]) return { w: ssInvJoin_(temp[uid]), c: temp[uid].c, src: '대리공급' };
    if (hub[uid]) return { w: ssInvJoin_(hub[uid]), c: hub[uid].c, src: '대리판매' };
    return null;
  }

  // ── 2) 사방넷송장 채우기 — 직접 매칭, 동봉은 대표의 번호를 그대로 ──
  var iCar = SS_INVOICE_HEADER.indexOf('택배사');
  var n = inv.getLastRow() - 1;
  var v = inv.getRange(2, 1, n, SS_INVOICE_HEADER.length).getValues();
  var 롯데직접 = 0, 대리공급건 = 0, 대리판매건 = 0, 전파 = 0, 미매칭 = 0, 전화미매칭 = 0;
  var 미매칭목록 = [];
  for (var i = 0; i < n; i++) {
    var 주문 = ssText(v[i][0]);
    var 대표 = ssText(v[i][4]);
    var direct = find(주문);
    var hit = direct || (대표 ? find(대표) : null);
    if (hit) {
      v[i][5] = hit.w;
      if (iCar >= 0) v[i][iCar] = hit.c;
      if (direct) {
        if (hit.src === '자사') 롯데직접++;
        else if (hit.src === '대리공급') 대리공급건++;
        else 대리판매건++;
      }
      else 전파++;
      continue;
    }
    v[i][5] = '';
    if (iCar >= 0) v[i][iCar] = '';
    if (주문) {
      // 전화주문(P-ID)은 구 세트분리로 출고되는 동안 롯데에 그 번호가 없다.
      // 진짜 미매칭과 섞이면 노이즈라 따로 센다. V2 실운영 후엔 자연히 매칭된다.
      if (ssText(v[i][9]) === '자동발급') {
        전화미매칭++;
      } else {
        미매칭++;
        if (미매칭목록.length < 15) {
          미매칭목록.push(주문 + '  ' + ssText(v[i][7]).slice(0, 10) + '  ' +
            ssText(v[i][6]) + '  ' + ssText(v[i][8]).slice(0, 24));
        }
      }
    }
  }
  inv.getRange(2, 1, n, SS_INVOICE_HEADER.length).setValues(v);

  // ── 3) 원장에도 기록 — 일일마감·대시보드는 여기서 주문번호별 송장을 읽는다 ──
  ssio_migrateHeader(SSIO_TABS.원장, SS_LEDGER_HEADER);
  var 원장직접 = 0, 원장전파 = 0, 원장기채움 = 0;
  /*  ★ 아직 송장을 못 받은 주문 — 그게 「대기 명부」다 ★  (2026-09-15)
      > "품절이나 재고부족으로 1~7일, 최대 20일(주문인쇄 제작등)의 경우가 있어."
      > "빠져있는 데이타만 따로 모아서 … 주문날짜와 고유아이디만 찾아 삽입하면"

      맞는 설계다. 그리고 그 명부는 «이미 있다» — 원장에서 운송장번호가
      빈 줄이 정확히 그것이다. 회차키가 날짜(YYMMDD-N)를 갖고 있으니
      주문날짜도 거기 있다. 새 표를 만들면 또 하나의 원천이 될 뿐이다.

      전파는 이미 매일 원장 «전체»를 훑어 빈 줄을 채운다. 20일 전 주문도
      원장에 있으면 오늘 채워진다. 그러니 마감이 지난 마감 파일을 14일치
      다시 여는 일은 «중복»이다 — 그게 오래 걸리는 까닭이다.

      지우기 전에 먼저 보여 준다: 아직 못 받은 게 몇 건이고 며칠짜리인지.
      1~7일은 기다리는 중, 20일 넘으면 사람이 봐야 할 건이다. */
  var 대기 = { d7: 0, d20: 0, 초과: 0, 총: 0, 가장오래: 0, 오래된예: [] };
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

      var groupInv = {}, groupCar = {};
      for (var a = 0; a < lv.length; a++) {
        var uid = ssText(lv[a][li['고유ID']]);
        if (ssText(lv[a][li['운송장번호']])) 원장기채움++;
        if (!ssText(lv[a][li['운송장번호']])) {
          var hit2 = find(uid);
          if (!hit2) {
            /*  아직 송장이 없다. 회차키 앞 6자리가 주문날짜(YYMMDD)다. */
            var rk대기 = li['회차키'] !== undefined ? ssText(lv[a][li['회차키']]) : '';
            var 며칠 = ss_회차나이_(rk대기);
            대기.총++;
            if (며칠 > 대기.가장오래) 대기.가장오래 = 며칠;
            if (며칠 <= 7) 대기.d7++;
            else if (며칠 <= 20) 대기.d20++;
            else {
              대기.초과++;
              if (대기.오래된예.length < 5) {
                대기.오래된예.push(rk대기 + ' ' + uid + ' (' + 며칠 + '일)');
              }
            }
          }
          if (hit2) {
            lv[a][li['운송장번호']] = hit2.w;
            //  택배사도 같이 — 읽는 쪽이 자릿수로 짐작할 일이 없어진다
            if (li['택배사'] !== undefined) lv[a][li['택배사']] = hit2.c || '';
            if (li['송장매칭'] !== undefined) {
              /* 「자사 직접」 — 종전에는 「롯데 직접」이었다. 옛 원장 줄에는
                 그 글자가 남아 있으므로 읽는 쪽(gasBulk)이 둘 다 받는다. */
              lv[a][li['송장매칭']] = hit2.src === '자사' ? '자사 직접' : hit2.src;
            }
            원장직접++;
          }
        }
        var grp = li['합포장그룹'] !== undefined ? ssText(lv[a][li['합포장그룹']]) : '';
        var isRep = li['합포장대표'] !== undefined && ssText(lv[a][li['합포장대표']]) === 'Y';
        var wRep = ssText(lv[a][li['운송장번호']]);
        if (grp && isRep && wRep) {
          groupInv[grp] = wRep;
          groupCar[grp] = li['택배사'] !== undefined ? ssText(lv[a][li['택배사']]) : '';
        }
      }
      for (var b = 0; b < lv.length; b++) {
        if (ssText(lv[b][li['운송장번호']])) continue;
        var g2 = li['합포장그룹'] !== undefined ? ssText(lv[b][li['합포장그룹']]) : '';
        if (g2 && groupInv[g2]) {
          lv[b][li['운송장번호']] = groupInv[g2];
          if (li['택배사'] !== undefined) lv[b][li['택배사']] = groupCar[g2] || '';
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
      invByUid[uid2] = w3;   // 첫 값 (뒤에서 ssInvAll_ 로 다시 편다)
      carByUid[uid2] = iCar >= 0 ? ssText(v[c2][iCar]) : '';
    } else if (invByUid[uid2] !== w3 && conflicts.length < 8) {
      // 한 주문의 품목이 서로 다른 박스·업체로 갈린 경우 — 사방넷엔 첫 번째만 들어간다
      conflicts.push(uid2 + ' → ' + invByUid[uid2] + ' / ' + w3);
    }
  }
  // 등록 자격은 여기서 다시 판정한다.
  // 「사방넷등록」 열은 세트분리 때 찍힌 값이라, 판정 규칙을 고치거나 원천을 늘려도
  // 세트분리를 다시 돌리기 전까지 낡은 값이 남는다. 전파 시점의 규칙이 기준이다.
  var regRows = [], 전화건 = 0, 무송장 = 0;
  var seenReg = {}, 회차사방넷 = {};
  for (var d = 0; d < n; d++) {
    var uid3 = ssText(v[d][0]);
    if (iSrc >= 0 && ssText(v[d][iSrc]) === '자동발급' && ssText(v[d][5])) 전화건++;
    if (!ssIsSabangnetUid(uid3)) continue;
    회차사방넷[uid3] = true;
    if (seenReg[uid3]) continue;          // 주문번호당 한 줄
    seenReg[uid3] = true;
    if (!invByUid[uid3]) { 무송장++; continue; }
    /* ★ 사방넷은 주문번호당 송장을 **하나만** 받는다 ★  (사장님 확인 2026-09-09)
       한 주문이 20박스로 나가도 사방넷에 올리는 것은 대표 송장 한 장이다.
       여러 줄로 올리면 시스템이 안 받는다.
       ★ 원장은 반대다 ★ 거기에는 스무 장이 다 들어가야 CS 가 택배조회를 한다.
       그래서 원장은 공백으로 이어 적고, 여기서는 첫 장만 꺼내 쓴다. */
    var invsOne = ssInvAll_(invByUid[uid3]);
    var 대표송장 = invsOne.length ? invsOne[0] : ssText(invByUid[uid3]);
    if (대표송장) regRows.push([uid3, 대표송장, carByUid[uid3] || '']);
  }
  ssio_write(SSIO_TABS.사방넷등록, SS_REG_HEADER, regRows, { bg: '#2c4f6b' });

  /*  ★ 「롯데」라고 부르지 않는다 ★  (2026-09-16)
      > "롯데는 이제 사용을 안해.. 예비로 넣어놨을뿐이야."

      2026-09-11 에 자사출고를 로젠으로 바꿨는데 화면은 계속 「롯데」라고
      불렀다. 그래서 「원천 · 롯데 0」을 보고도 그게 «자사출고가 0건»이라는
      뜻인지, «안 쓰는 롯데 탭이 비었다»는 뜻인지 가릴 수가 없었다.
      실제로 그 줄을 놓고 한참을 헤맸다. 이름이 틀리면 숫자가 일을 못 한다.

      읽은 탭별 건수는 아래 「자사출고 송장탭」 줄에 이미 있다 —
      거기서 로젠·롯데가 각각 몇 줄인지 보인다. 여기는 합계를 말한다. */
  var msg = '송장 전파 완료' + NL + NL +
    '  · 원천 · 자사출고 ' + Object.keys(lotte).length + ' / 임시기록 ' + Object.keys(temp).length +
    ' / 발주허브 ' + Object.keys(hub).length + NL +
    '  · 사방넷송장 · 자사출고 ' + 롯데직접 + ' / 대리공급 ' + 대리공급건 + ' / 대리판매 ' + 대리판매건 +
    ' / 합포장 전파 ' + 전파 + ' / 미매칭 ' + 미매칭 +
    (전화미매칭 ? ' (+전화주문 ' + 전화미매칭 + ')' : '') + NL +
    '  · 원장 기록 · 신규 ' + (원장직접 + 원장전파) +
    ' · 이미 채워짐 ' + 원장기채움 + NL +
    /*  ★ 대기 명부 ★ 아직 송장을 못 받은 주문. 이것이 「빠져 있는 데이타」다. */
    (대기.총
      ? '📭 아직 송장 없음 ' + 대기.총 + '건' +
        '  (1~7일 ' + 대기.d7 + ' · 8~20일 ' + 대기.d20 +
        (대기.초과 ? ' · ★20일 넘음 ' + 대기.초과 : '') + ')' + NL +
        (대기.초과
          ? '   20일 넘은 건: ' + 대기.오래된예.join(' / ') + NL +
            '   — 품절·제작 대기가 아니면 사람이 봐야 할 건입니다.' + NL
          : '')
      : '📭 아직 송장 없음: 없습니다' + NL) +
    '  · 사방넷등록 ' + regRows.length + '건' +
    ' / 이 회차 사방넷 주문 ' + Object.keys(회차사방넷).length + '건' +
    (무송장 ? ' · 송장 없음 ' + 무송장 : '') +
    (전화건 ? ' · 전화주문 ' + 전화건 + ' 제외' : '') + NL +
    '    (이 회차 판매현황에 있는 주문만 등록 대상입니다 — 하루 전체는 허브 메뉴)';
  if (미매칭목록.length) {
    msg += NL + NL + '[미매칭 — 아직 송장이 안 붙은 주문]' + NL +
      '  주문번호 · 받는분 · 경로 · 품목' + NL +
      '  ' + 미매칭목록.join(NL + '  ');
    msg += NL + '  → 대리발송 건이면 5️⃣ 송장 수집 후 다시 전파하면 채워집니다.';
  }
  if (전화미매칭) {
    msg += NL + NL + '※ 전화주문 ' + 전화미매칭 + '건은 매칭 대기입니다.' + NL +
      '  구 세트분리로 출고되는 동안은 롯데에 P-ID 가 없어 못 맞습니다 — 병행 운영 중엔 정상.' + NL +
      '  V2 롯데택배 탭으로 업로드를 시작하면 자동으로 매칭됩니다.';
  }
  if (lotteErr) {
    msg += NL + NL + '⚠ 자사출고 송장탭을 읽지 못했습니다 — 임시기록만으로 매칭했습니다.' + NL + '  ' + lotteErr;
  }
  if (hubErr) {
    msg += NL + NL + '⚠ 발주허브를 읽지 못했습니다 — 대리판매 송장이 빠졌습니다.' + NL + '  ' + hubErr;
  }
  if (tempErr) {
    msg += NL + NL + '⚠ 대리공급 임시기록을 읽지 못했습니다 — 자사출고만으로 매칭했습니다.' + NL + '  ' + tempErr;
  }
  if (conflicts.length) {
    msg += NL + NL + '⚠ 한 주문번호에 송장이 두 개 이상 (첫 번째만 등록됩니다):' + NL +
      '  ' + conflicts.join(NL + '  ');
  }
  /* 어느 탭에서 몇 줄을 읽었는지 적는다.  (2026-09-11)
     로젠으로 갈아탄 날에 「로젠 0줄」이 보이면 그 자리에서 안다 —
     안 보이면 송장이 안 붙은 뒤에야 거꾸로 찾아야 한다. */
  if (읽은탭 && 읽은탭.length) {
    msg += NL + NL + '자사출고 송장탭: ' + 읽은탭.join(' · ');
  }
  /*  ★ 손으로 누르고 있다면 그 자리에서 말한다 ★  (2026-09-16)
      > "자동으로 되야지 매번 사람이 다 눌러줄꺼면 자동화를 왜하는지"
      전파는 17:00 에 저절로 돌아야 한다. 트리거가 없으면 그 말을 여기서
      한다 — 사람이 실제로 마주치는 자리가 여기라서다.  */
  var 걸렸나 = (typeof ss_기초트리거있나_ === 'function') ? ss_기초트리거있나_() : null;
  if (걸렸나 === false) {
    msg += NL + NL + '⚠ 17:00 자동 전파 트리거가 «걸려 있지 않습니다».' + NL +
      '  이 전파는 날마다 저절로 돌아야 합니다. 손으로 누르지 않으면' + NL +
      '  송장이 빈 채로 저녁을 넘기고, 그날 실적탭은 다음 회차에 덮어써집니다.' + NL +
      '  🔗 송장 매칭 → ⏰ 기초 데이터 트리거 설치 를 한 번 눌러 주세요.';
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

/**
 * 판매현황 O열「주문자명(사방넷)」에 전화주문 고유아이디를 써넣는다.
 *
 * 쓰는 곳은 이 시트의 「판매현황」 탭(원천 미러)이다. 팀이 붙여넣는 원천 시트는
 * 건드리지 않는다 — 다음 붙여넣기에서 열이 밀려 어긋나면 그게 더 위험하다.
 * 미러는 매 회차 다시 쓰이지만 고유ID 는 내용에서 계산되므로 같은 값이 다시 나온다.
 *
 * cells: [{ 행: 0기준 원본 행번호, 값: 이름/ID }]
 */
function ss_판매현황아이디채움(cells) {
  /* ★ 2026-09-09: 붙여넣는 칸을 건드리지 않는다 ★
     > "맨앞텝(판매현황)에 판매현황을 복붙하고 … 판매현황_고유아이디 라는
     >  텝으로 … 시트내에서 다 처리되면 좋겠어"

     전에는 판매현황 탭의 O열에 직접 아이디를 적었다. 그러면
     붙여넣는 칸과 결과가 한 탭에 섞여, 다음 회차에 지우고 붙이기 전까지
     옛 아이디가 남아 있는다. 사람이 그걸 보고 이미 처리된 줄로 오해한다.

     이제 판매현황은 **읽기만** 하고, 아이디를 채운 사본을 따로 낸다.
     회차마다 덮어쓴다 (사장님 확인) — 지난 회차는 「주문라인원장」·「회차」에
     이미 남아 있다.

     아이디가 하나도 없어도 사본은 만든다. 그래야 「이번 회차엔 전화주문이
     없었다」와 「기능이 안 돌았다」가 구분된다. */
  var src = ssio_ss().getSheetByName(SSIO_TABS.입력);
  if (!src || src.getLastRow() < 2) return 0;

  var col = SS_SALES_COLS.indexOf('주문자명(사방넷)') + 1;   // 1-기준
  if (col < 1) col = 15;   // O열

  var grid = src.getDataRange().getValues();
  var width = 0;
  for (var g = 0; g < grid.length; g++) if (grid[g].length > width) width = grid[g].length;
  if (width < col) width = col;
  for (var g2 = 0; g2 < grid.length; g2++) {
    while (grid[g2].length < width) grid[g2].push('');
  }

  var n = 0;
  for (var i = 0; i < (cells || []).length; i++) {
    var r = cells[i].행;                 // 0-기준 (판매현황 그리드 기준)
    if (r < 0 || r >= grid.length) continue;
    //  이미 값이 있으면 손대지 않는다 — 사방넷 주문번호를 덮으면 안 된다
    if (ssText(grid[r][col - 1])) continue;
    grid[r][col - 1] = cells[i].값;
    n++;
  }

  var out = ssio_sheet(SSIO_TABS.입력아이디, grid[0]);
  ssio_clearBody(out);
  if (out.getMaxColumns() < width) out.insertColumnsAfter(out.getMaxColumns(), width - out.getMaxColumns());
  if (out.getMaxRows() < grid.length) out.insertRowsAfter(out.getMaxRows(), grid.length - out.getMaxRows() + 10);
  out.getRange(1, 1, grid.length, width).setValues(grid);
  return n;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  그날치 판매현황을 «회차별로 이어» 한 탭에 쌓는다 — 「0914판매현황」
 *  2026-09-14
 *
 *  > "판매현황(고유아이디 붙은것) 회차별로 합쳐서 일일마감, 송장매칭,
 *  >  사방넷 대량등록에 사용될수 있게 0914판매현황 이런식으로 텝이 생성"
 *
 *  ★ 「판매현황_고유아이디」는 회차마다 덮어쓴다 ★
 *    하루에 오전·오후 두 번 돌리면 마지막 것만 남는다. 그래서 오전 건을
 *    나중에 되짚을 데가 없었다. 여기는 «이어 붙인다».
 *
 *  ★ 같은 회차를 다시 돌리면 그 회차 줄만 갈아 끼운다 ★
 *    원장과 같은 손버릇이다. 맨 뒤에 회차키 한 칸을 두는 이유가 그것이다 —
 *    그게 없으면 무엇을 지우고 무엇을 남길지 알 수가 없다.
 *
 *  ★ 이레 지난 탭은 지운다 ★  (사장님 선택)
 *    날마다 하나씩 늘면 한 달에 서른 개다. 원장에 같은 내용이 다 남아 있으므로
 *    여기 것은 「요즘 것을 손에 들고 보는」 용도다. 날짜는 탭 이름이 아니라
 *    회차키에서 읽는다 — 이름의 MMDD 만 보면 연말에 해를 넘기며 꼬인다.
 *
 *  @param runKey 회차키 (yyMMdd-N)
 *  @return {number} 이번에 쌓은 줄 수
 * ══════════════════════════════════════════════════════════════
 */
/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 빠진 회차는 「주문라인원장」에서 되살린다 ★
 *  2026-09-14
 *
 *  > "이전 판매현황은 어디서 가져오지?"
 *
 *  판매현황이 남는 데는 셋뿐인데, 둘은 하루를 못 넘긴다.
 *    ① 「판매현황」            — 사람이 회차마다 지우고 붙인다.      없다.
 *    ② 「판매현황_고유아이디」  — 회차마다 덮어쓴다. 마지막 것뿐.    없다.
 *    ③ 「주문라인원장」        — 회차키를 달고 전부 쌓인다.      ★ 여기뿐 ★
 *
 *  그래서 이 탭이 「제 몸에 남은 것」에만 기대면, 한 번 빠진 회차는 영영 못
 *  돌아온다. 오늘 오전 네 회차가 그랬다 — 이 기능이 오후에 생겼으니까.
 *  고쳐도 과거가 안 돌아오는 고침은 반쪽이다. 이제는 돌 때마다 원장을 보고
 *  「빠진 회차」를 스스로 메운다.
 *
 *  ★ 원장은 판매현황이 아니다 ★
 *    세트가 구성품으로 쪼개져 있으므로 순번으로 도로 뭉친다. 그리고 판매현황
 *    스무 칸 중 몇 칸은 원장에 아예 안 남는다.
 *      · 세트구성및배송비 · 단품배송비 · 묶음배송비  — 계산에 쓰고 버린다
 *      · 전화번호(사방넷) · 추가문자형7 · 주문서 세 칸 — 주소1 로 합쳐진다
 *      · 거래처명(상호)                              — 원장은 받는분만 남긴다
 *    빈 칸을 채운 척하지 않는다. 되살린 줄에는 「자료출처 = 원장복원」을 찍어
 *    빈칸이 「원래 비어 있던 것」인지 「못 되살린 것」인지 헷갈리지 않게 한다.
 *
 *  ★ 주소는 원주소를 먼저 본다 ★
 *    적요로 배송지를 갈아 끼운 건은 원장에 「원주소」로 원래 값이 남는다.
 *    그게 판매현황에 있던 그 값이다. 없으면 주소1 을 쓴다 — 사방넷·주문서
 *    건은 판매현황에서 다른 칸에 있었으므로, 되살린 것은 제자리가 아니다.
 *    그래도 주소를 버리는 것보다는 낫다. 표식이 그 사정을 말해 준다.
 * ══════════════════════════════════════════════════════════════
 */
/** 마지막 쌓기에서 원장으로 되살린 결과. 실행요약이 읽는다. */
var SS_DAILY_복원결과_ = { 줄수: 0, 회차들: [] };
var SS_DAILY_SRC_COL = '자료출처';
var SS_DAILY_SRC_PASTE = '판매현황';
var SS_DAILY_SRC_LEDGER = '원장복원';

/** 판매현황 칸 ← 원장 칸. 이름 대 이름으로만 옮긴다. */
var SS_DAILY_FROM_LEDGER = {
  '순번': '순번',
  '일자-No.': '일자-No.',
  '품목코드': '원본품목코드',
  '수량': '주문수량',
  '전화': '전화',
  '모바일': '모바일',
  '합계': '합계',
  '적요': '적요',
  '거래처명': '거래처명'
};

/**
 * 원장에서 「그날·빠진 회차」의 판매현황 줄을 되살린다.
 *
 * @param 원장그리드 원장 전체 (머리글 포함)
 * @param 날앞       yyMMdd
 * @param 있는키     이미 탭에 있는 회차키 {키: true}
 * @param head       목표 머리글 (맨 뒤가 회차키)
 * @return {{rows: Array, 회차들: Array}}
 */
function ss_원장에서그날복원_(원장그리드, 날앞, 있는키, head) {
  var 빈답 = { rows: [], 회차들: [] };
  if (!원장그리드 || 원장그리드.length < 2) return 빈답;

  var lh = 원장그리드[0], L = {};
  for (var i = 0; i < lh.length; i++) {
    var n = ssText(lh[i]);
    if (n && L[n] === undefined) L[n] = i;
  }
  if (L['회차키'] === undefined || L['순번'] === undefined) return 빈답;

  var 새자리 = {};
  for (var h = 0; h < head.length; h++) {
    var hn = ssText(head[h]);
    if (hn && 새자리[hn] === undefined) 새자리[hn] = h;
  }

  /* ★ 원본 품목명은 «품목 마스터»에 있다 ★  (2026-09-15)
     > "일일 마감에 품목명이 빠진것들이 있는데 이유가..?"

     처음 판에서는 세트가 쪼개진 줄의 품목명을 «비웠다». 원장에 남는 품목명은
     구성품 이름이라 판매현황의 그것이 아니고, 틀린 이름을 적느니 비우는 게
     낫다고 봤다. 그 판단 자체는 맞지만, 한 걸음을 덜 갔다 —
     「M품목」 탭이 원본품목코드의 이름을 그대로 들고 있다.

     비워 둔 값은 마감까지 그대로 흘러가 사람이 무슨 물건인지 못 읽는다.
     모르는 것은 비우되, 알 수 있는 것을 비워 두면 안 된다. */
  var 품목이름 = {};
  try {
    var mSh = ssio_ss().getSheetByName(SSIO_TABS.M품목);
    if (mSh && mSh.getLastRow() > 1) {
      var mv = mSh.getRange(2, 1, mSh.getLastRow() - 1, 2).getDisplayValues();
      for (var m = 0; m < mv.length; m++) {
        var mc = ssText(mv[m][0]);
        if (mc && 품목이름[mc] === undefined) 품목이름[mc] = ssText(mv[m][1]);
      }
    }
  } catch (eM) {
    //  마스터를 못 읽어도 되살리기는 계속한다 — 이름만 빈다
  }

  var 뭉침 = {}, 차례 = [], 본회차 = {};
  for (var r = 1; r < 원장그리드.length; r++) {
    var row = 원장그리드[r];
    var rk = ssText(row[L['회차키']]);
    if (rk.substring(0, 6) !== 날앞) continue;
    if (있는키 && 있는키[rk]) continue;
    var 순번 = ssText(row[L['순번']]);
    if (!순번) continue;
    var key = rk + '|' + 순번;
    if (뭉침[key]) { 뭉침[key].줄수++; continue; }   // 세트 구성품은 첫 줄만
    뭉침[key] = { rk: rk, row: row, 줄수: 1 };
    차례.push(key);
    본회차[rk] = true;
  }

  var out = [];
  for (var c = 0; c < 차례.length; c++) {
    var it = 뭉침[차례[c]];
    var src = it.row;
    var got = function (name) {
      var ci = L[name];
      return ci === undefined ? '' : src[ci];
    };

    var line = [];
    for (var z = 0; z < head.length; z++) line.push('');

    for (var 판 in SS_DAILY_FROM_LEDGER) {
      if (!Object.prototype.hasOwnProperty.call(SS_DAILY_FROM_LEDGER, 판)) continue;
      if (새자리[판] === undefined) continue;
      line[새자리[판]] = got(SS_DAILY_FROM_LEDGER[판]);
    }

    /*  품목명 — 찾는 차례가 있다.
          ① 「M품목」에서 원본품목코드로 찾은 이름 — 판매현황에 있던 바로 그 이름
          ② 세트가 «안 쪼개진» 줄이면 원장의 품목명 (①과 같은 값이다)
          ③ 둘 다 없으면 비운다
        쪼개진 줄의 원장 품목명은 «구성품» 이름이라 쓰면 안 된다.
        모르는 것은 비우되, 알 수 있는 것을 비워 두면 안 된다. */
    if (새자리['품목명'] !== undefined) {
      var 원코드 = ssText(got('원본품목코드'));
      var 이름 = 원코드 ? ssText(품목이름[원코드]) : '';
      if (!이름 && it.줄수 === 1 && ssText(got('라인ID')) === ssText(got('순번'))) {
        이름 = ssText(got('품목명'));
      }
      line[새자리['품목명']] = 이름;
    }

    //  주소는 원주소(적요로 바뀌기 전)를 먼저 본다
    if (새자리['주소1'] !== undefined) {
      line[새자리['주소1']] = ssText(got('원주소')) || got('주소1');
    }

    /*  O열 「주문자명(사방넷)」은 이 탭을 읽는 쪽이 전부 보는 칸이다.
        원장에는 이름과 고유ID 가 따로 있으니 같은 모양으로 다시 붙인다. */
    if (새자리['주문자명(사방넷)'] !== undefined) {
      var 누구 = ssText(got('거래처명'));   // 원장의 이 칸은 받는분이다
      var 아이디 = ssText(got('고유ID'));
      line[새자리['주문자명(사방넷)']] = 아이디 ? (누구 ? 누구 + '/' + 아이디 : 아이디) : 누구;
    }

    if (새자리[SS_DAILY_SRC_COL] !== undefined) line[새자리[SS_DAILY_SRC_COL]] = SS_DAILY_SRC_LEDGER;
    line[head.length - 1] = it.rk;
    out.push(line);
  }

  var 회차들 = [];
  for (var k2 in 본회차) if (Object.prototype.hasOwnProperty.call(본회차, k2)) 회차들.push(k2);
  회차들.sort();
  return { rows: out, 회차들: 회차들 };
}

var SS_DAILY_KEEP_DAYS = 7;
var SS_DAILY_SUFFIX = '판매현황';

/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 나가기 직전 점검 — 송장이 될 수 없는 줄을 잡는다 ★
 *  2026-09-15
 *
 *  > "세트분리, 상품정보등에서 품목, 주소등 중요사항들이 빠지는 경우가
 *  >  있는지 다시 한번 체크해줘."
 *
 *  찾아보니 그물은 «주소 하나»뿐이었다 (ADDR_EMPTY). 받는분이 비어도,
 *  전화가 둘 다 비어도, 품목명이 비어도 아무 말 없이 출력 탭으로 갔다.
 *  그 넷은 «송장 한 장이 되기 위한 최소»다. 하나라도 비면 그 건은 못 간다.
 *
 *  ★ 나갈 줄만 본다 ★
 *    비배송·보류는 물건이 안 나가므로 비어 있어도 사고가 아니다.
 *    res.buckets 의 출력 탭 것만 센다.
 *
 *  ★ 주소와 달리 «한 건»부터 말한다 ★
 *    ADDR_EMPTY 는 「다섯 줄 넘고 20% 이상」일 때만 말한다. 주소는 비배송·
 *    적립금처럼 원래 빈 줄이 늘 섞이기 때문이다.
 *    그런데 여기는 이미 «나가는 줄»만 남은 뒤다. 나가는 줄에 받는분이 없으면
 *    그건 한 건이라도 사고다. 늘 뜨는 경고가 아니라 «날 일이 없는» 경고다.
 *
 *  ★ 순번을 같이 적는다 ★
 *    「3건 빠졌습니다」만으로는 탭을 눈으로 훑어야 한다. 어느 줄인지 적는다.
 * ══════════════════════════════════════════════════════════════
 */
var SS_SHIP_MUST = [
  { 이름: '받는분', 봄: function (u) { return ssText(u.받는분); },
    왜: '송장에 받는 사람 이름이 없으면 택배가 못 갑니다.' },
  { 이름: '주소', 봄: function (u) { return ssText(u.주소1); },
    왜: '주소 없이 송장을 만들면 그 건은 배송이 안 됩니다.' },
  { 이름: '연락처', 봄: function (u) { return ssText(u.모바일) || ssText(u.전화); },
    왜: '전화·모바일이 둘 다 비었습니다. 택배사가 연락할 데가 없습니다.' },
  { 이름: '품목명', 봄: function (u) { return ssText(u.출력품목명) || ssText(u.품목명); },
    왜: '품목명이 없으면 창고에서 무엇을 담을지 모릅니다.' },
  { 이름: '수량', 봄: function (u) { return ssNum(u.수량) > 0 ? '1' : ''; },
    왜: '수량이 0 이거나 비었습니다.' }
];

/**
 * 출고 직전 점검.
 *
 * @param buckets  res.buckets — 경로별 줄
 * @param warnings 경고 담는 곳
 * @return {object} 칸이름 → 빠진 건수
 */
function ss출고점검(buckets, warnings) {
  var 셈 = {};
  if (!buckets) return 셈;

  //  나가는 줄만 모은다 — 비배송·보류는 물건이 안 나간다
  var 나갈것 = [];
  for (var i = 0; i < SSIO_TABS.출력.length; i++) {
    var b = buckets[SSIO_TABS.출력[i]] || [];
    for (var j = 0; j < b.length; j++) 나갈것.push(b[j]);
  }
  if (!나갈것.length) return 셈;

  for (var m = 0; m < SS_SHIP_MUST.length; m++) {
    var 칸 = SS_SHIP_MUST[m];
    var 빈줄 = [];
    for (var r = 0; r < 나갈것.length; r++) {
      if (칸.봄(나갈것[r])) continue;
      if (빈줄.length < 8) {
        빈줄.push(ssText(나갈것[r].순번) + (ssText(나갈것[r].받는분)
          ? '(' + ssText(나갈것[r].받는분).slice(0, 8) + ')' : ''));
      }
      셈[칸.이름] = (셈[칸.이름] || 0) + 1;
    }
    if (!셈[칸.이름]) continue;
    ssWarn(warnings, '오류', 'SHIP_MISSING_' + m,
      칸.이름 + ' 없음 ' + 셈[칸.이름] + '/' + 나갈것.length + '줄',
      칸.왜 + '  순번: ' + 빈줄.join(' · ') +
      (셈[칸.이름] > 빈줄.length ? ' 외 ' + (셈[칸.이름] - 빈줄.length) + '건' : ''));
  }
  return 셈;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  겹친 줄을 거르고 회차별로 센다
 *  2026-09-16
 *
 *  > "1차 1,2차 1,2,3차 이렇게 쌓이는거 같은데.."
 *  > "결국 1차 주문자는 검색하면 3번이 나와.. 2차 주문자는 2번이.. 3차는 1번이.."
 *
 *  ★ 왜 그렇게 쌓였나 ★
 *    쌓기(ss_그날판매현황쌓기)는 「판매현황에 올라온 것 = 이번 회차분」이라
 *    여기고 통째로 더한다. 그런데 실제 운영은 회차마다 «그날 전체»를 넣는다 —
 *
 *    > "판매현황을 전체분을 안넣으면 마지막 차수 판매현황 내용의 송장만
 *    >  들어오더라구"
 *
 *      1차 : 1차분           → 탭에 1차분
 *      2차 : 1차+2차분       → 1차분(회차1) + 1차·2차분(회차2)
 *      3차 : 1차+2차+3차분   → 거기에 1·2·3차분(회차3)까지
 *
 *    1차 주문이 세 벌, 2차 주문이 두 벌. 그 탭을 그대로 읽는 일일마감에
 *    같은 주문이 두 번·세 번 들어갔다 (9/15 마감의 70줄 = 35건 × 2).
 *
 *  ★ 붙여넣기 방식을 바꾸라고 하지 않는다 ★
 *    전체분을 넣는 데는 까닭이 있다(그래야 지난 차수 송장이 붙는다).
 *    운영을 코드에 맞추는 것이 아니라 코드가 운영을 받아야 한다.
 *
 *  ★ 같은 줄이면 «먼저 온 회차»의 것으로 둔다 ★
 *    부르기 전에 회차키로 줄을 세워 둔다. 그러면 앞에서부터 보며 처음 본
 *    줄만 남길 때 그 주문이 «실제로 들어온 회차»에 남는다.
 *    열쇠는 맨 뒤 둘(출처·회차키)을 «뺀» 나머지 전부 — 그 둘은 이 탭이
 *    붙이는 이름표지 주문의 내용이 아니다.
 *
 *  ★ 한 곳에만 둔다 ★
 *    쌓기와 메우기가 같은 규칙을 써야 한다. 두 벌로 두면 한쪽만 고치는
 *    날이 온다 — 오늘 하루에만 그런 일을 세 번 봤다.
 *
 *  @return {{rows:Array, 버림:number, 회차글:string}}
 * ══════════════════════════════════════════════════════════════
 */
function ss_그날겹침거르기_(all, head) {
  var 겹쳐버림 = 0;
  {
  var 본것 = {}, 남길것 = [];
  for (var dd = 0; dd < all.length; dd++) {
    var 조각 = [];
    for (var dc = 0; dc < head.length - 2; dc++) {
      조각.push(ssText(all[dd][dc]));
    }
    var 열쇠 = 조각.join('|');
    if (열쇠.replace(/[|]/g, '') === '') { 남길것.push(all[dd]); continue; }   // 빈 줄은 그냥 둔다
    if (본것[열쇠]) { 겹쳐버림++; continue; }
    본것[열쇠] = true;
    남길것.push(all[dd]);
  }
  all = 남길것;
  }

  /*  ★ 회차별로 몇 줄인지 세어 둔다 ★  (2026-09-16)

    > "이게 쌓이니까 검증이 맞게 되는지 확인이 어렵네.. 방법이 없을까?"

    거르고 나면 각 주문은 «처음 들어온 회차»에 한 줄씩 있다. 그러니
    회차별 건수를 세면 「1차 120 · 2차 +45 · 3차 +30」처럼 읽힌다 —
    2차에 새로 들어온 것이 45건이라는 뜻이다. 그 숫자가 이카운트에서
    새로 뜬 주문 수와 맞으면 제대로 쌓인 것이다.

    합계만 보여 주면 「많은지 적은지」밖에 모른다. 회차별로 갈라야
    어느 회차가 빠졌는지 한눈에 보인다.  */
  var 회차별 = [], 회차셈 = {};
  for (var tc = 0; tc < all.length; tc++) {
  var tk = ssText(all[tc][head.length - 1]);
  if (!tk) continue;
  if (회차셈[tk] === undefined) { 회차셈[tk] = 0; 회차별.push(tk); }
  회차셈[tk]++;
  }
  회차별.sort();
  var 회차글 = [];
  for (var tg = 0; tg < 회차별.length; tg++) {
  //  회차키 260915-2 에서 뒤의 «2»만 보인다
  var 번호 = 회차별[tg].split('-')[1] || 회차별[tg];
  회차글.push(번호 + '차 ' + (tg === 0 ? '' : '+') + 회차셈[회차별[tg]]);
  }

  return { rows: all, 버림: 겹쳐버림, 회차글: 회차글.join(' · ') };
}

function ss_그날판매현황쌓기(runKey) {
  var rk = ssText(runKey);
  if (!/^[0-9]{6}-[0-9]+$/.test(rk)) return 0;

  var src = ssio_ss().getSheetByName(SSIO_TABS.입력아이디);
  if (!src || src.getLastRow() < 2) return 0;
  var grid = src.getDataRange().getValues();

  /* ★ 머리글은 «찾아야» 한다 — 첫 줄이 아니다 ★  (2026-09-14)
     이카운트 판매현황은 맨 위에 「회사명 : 주식회사 팩투유 / 2026/09/14 ~ …」
     같은 머리말이 붙어 온다. 진짜 칸 이름(순번·품목코드…)은 그 아래에 있다.
     첫 줄을 머리글로 삼으면 이름이 하나도 안 맞아, 원장에서 되살린 줄이
     «회차키만 있고 나머지는 전부 빈» 꼴이 된다 — 오늘 실제로 그랬다.
     세트분리 본체는 처음부터 ssFindSalesHeader 로 찾고 있었다. 여기만 안 했다. */
  var found = ssFindSalesHeader(grid);
  if (!found) return 0;
  var 머리줄 = found.headerRow;
  var width = 0;
  for (var w0 = 머리줄; w0 < grid.length; w0++) {
    if (grid[w0] && grid[w0].length > width) width = grid[w0].length;
  }
  var 머리 = grid[머리줄].slice(0, width);
  while (머리.length < width) 머리.push('');

  var 이름 = rk.substring(2, 6) + SS_DAILY_SUFFIX;   // 260914-1 → 0914판매현황
  var head = 머리.concat([SS_DAILY_SRC_COL, '회차키']);
  var sh = ssio_sheet(이름, head);

  /* ★ 옛 줄을 «머리글을 갈아 끼우기 전»에 읽는다 ★  (2026-09-14 고침)
     처음엔 머리글부터 새로 쓰고, 옛 줄의 회차키를 «맨 뒤 자리»로 읽었다.
     판매현황 열 수는 회차마다 달라질 수 있다 — getDataRange 는 자료가
     뻗은 만큼만 준다. 그러면 맨 뒤가 회차키가 아니어서 빈칸으로 읽히고,
     `if (!k) continue` 가 그 줄을 «조용히» 버렸다. 오전 회차가 통째로
     사라지고 마지막 것만 남는다 — 오늘 실제로 그랬다.

     자리가 아니라 이름으로 찾는다. 오늘 하루 종일 고친 그 병이다. */
  var 옛머리 = [], 옛키자리 = -1, 옛폭 = 0;
  if (sh.getLastRow() >= 1) {
    옛폭 = Math.max(sh.getLastColumn(), head.length);
    옛머리 = sh.getRange(1, 1, 1, 옛폭).getValues()[0];
    for (var h0 = 옛머리.length - 1; h0 >= 0; h0--) {
      if (ssText(옛머리[h0]) === '회차키') { 옛키자리 = h0; break; }
    }
  }

  /* ★ 옛 머리글이 «진짜 머리글»일 때만 옛 줄을 믿는다 ★  (2026-09-14)
     이 탭이 한동안 첫 줄(회사명 머리말)을 머리글로 쓰고 있었다. 그런 탭의
     옛 줄을 이름으로 옮겨 담으면 맞는 이름이 하나도 없어 «전부 빈 줄»이 된다.
     그럴 때는 옛 줄을 버린다 — 버려도 괜찮다. 그 회차는 원장에 그대로 있고,
     바로 아래에서 되살린다. 반쯤 살아 있는 줄보다 되살린 줄이 낫다. */
  var 옛머리쓸만 = false;
  for (var v0 = 0; v0 < 옛머리.length; v0++) {
    if (ssText(옛머리[v0]) === '순번') { 옛머리쓸만 = true; break; }
  }

  var keep = [];
  if (sh.getLastRow() > 1 && 옛키자리 >= 0 && 옛머리쓸만) {
    /*  옛 줄은 «옛 머리글 이름»을 보고 새 자리로 옮겨 담는다.
        열이 하나 늘거나 줄어도 값이 어긋나지 않는다. */
    var 새자리 = {};
    for (var n0 = 0; n0 < head.length; n0++) {
      var hn = ssText(head[n0]);
      if (hn && 새자리[hn] === undefined) 새자리[hn] = n0;
    }
    var oldRows = sh.getRange(2, 1, sh.getLastRow() - 1, 옛폭).getValues();
    for (var o = 0; o < oldRows.length; o++) {
      var k = ssText(oldRows[o][옛키자리]);
      if (!k) continue;                 // 회차키가 없는 줄은 원장 줄이 아니다
      if (k === rk) continue;           // 이번 회차 것은 새로 쓴다
      var moved = [];
      for (var m0 = 0; m0 < head.length; m0++) moved.push('');
      for (var c0 = 0; c0 < 옛머리.length; c0++) {
        var cn = ssText(옛머리[c0]);
        if (!cn || 새자리[cn] === undefined) continue;
        moved[새자리[cn]] = oldRows[o][c0];
      }
      moved[head.length - 1] = k;       // 회차키는 늘 맨 뒤
      keep.push(moved);
    }
  }

  //  머리글은 옛 줄을 다 읽은 «뒤»에 갈아 끼운다
  if (sh.getMaxColumns() < head.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, head.length).setValues([head]);

  var add = [];
  for (var g = 머리줄 + 1; g < grid.length; g++) {
    var row = (grid[g] || []).slice(0, width);
    var 빔 = true;
    for (var c = 0; c < row.length; c++) if (ssText(row[c])) { 빔 = false; break; }
    if (빔) continue;
    while (row.length < width) row.push('');
    add.push(row.concat([SS_DAILY_SRC_PASTE, rk]));
  }


  /* ★ 빠진 회차는 원장에서 메운다 ★  (2026-09-14)
     이 탭이 «제 몸에 남은 것»에만 기대면, 한 번 빠진 회차는 영영 못 돌아온다.
     원장에 회차키가 있는데 여기 없으면 그건 잃어버린 것이다. 되살린다.
     실패해도 이번 회차 쌓기는 계속한다 — 곁다리가 본줄기를 막으면 안 된다. */
  SS_DAILY_복원결과_ = { 줄수: 0, 회차들: [] };
  var 되살림 = [], 되살린회차 = [];
  try {
    var 있는키 = {};
    있는키[rk] = true;                    // 이번 회차는 방금 새로 쓴다
    for (var kk = 0; kk < keep.length; kk++) {
      var kv = ssText(keep[kk][head.length - 1]);
      if (kv) 있는키[kv] = true;
    }
    var lgSh = ssio_ss().getSheetByName(SSIO_TABS.원장);
    if (lgSh && lgSh.getLastRow() > 1) {
      var 복원 = ss_원장에서그날복원_(lgSh.getDataRange().getValues(), rk.substring(0, 6), 있는키, head);
      되살림 = 복원.rows;
      되살린회차 = 복원.회차들;
    }
  } catch (eR) {
    되살림 = [];
  }

  //  하루가 «시간 순»으로 읽히도록 회차키로 줄 세운다
  var all = 되살림.concat(keep).concat(add);
  all.sort(function (x, y) {
    var a1 = ssText(x[head.length - 1]), b1 = ssText(y[head.length - 1]);
    return a1 < b1 ? -1 : a1 > b1 ? 1 : 0;
  });
  /*  겹친 줄을 거르고 회차별로 센다 — 규칙은 ss_그날겹침거르기_ 한 곳에 있다 */
  var _거른_ = ss_그날겹침거르기_(all, head);
  all = _거른_.rows;
  var 겹쳐버림 = _거른_.버림;
  var 회차글 = _거른_.회차글;

  ssio_clearBody(sh);
  if (sh.getMaxColumns() < head.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
  }
  if (all.length) {
    if (sh.getMaxRows() < all.length + 1) {
      sh.insertRowsAfter(sh.getMaxRows(), all.length + 1 - sh.getMaxRows() + 10);
    }
    sh.getRange(2, 1, all.length, head.length).setValues(all);
  }
  ssio_styleHeader(sh, head.length, { bg: '#2c4f6b' });

  ss_옛판매현황탭정리(rk);
  SS_DAILY_복원결과_ = { 줄수: 되살림.length, 회차들: 되살린회차,
    겹쳐버림: 겹쳐버림, 회차글: 회차글.join(' · '), 총줄: all.length };
  return add.length;
}


/**
 * ══════════════════════════════════════════════════════════════
 *  지금 당장 「그날 판매현황」을 원장으로 메운다
 *  2026-09-14
 *
 *  자동 복원은 세트분리를 돌 때만 걸린다. 오늘 오전 회차처럼 «이미 지나간»
 *  것을 지금 보고 싶을 때가 있다. 세트분리를 한 번 더 돌리는 건 답이 아니다 —
 *  출력 탭이 다 바뀌고, 회차가 하나 더 생긴다.
 *
 *  읽기만 한다. 원장은 안 건드리고, 그날 탭에 빠진 회차만 보태 넣는다.
 * ══════════════════════════════════════════════════════════════
 */
function ss_그날판매현황메우기(날앞) {
  var ui = SpreadsheetApp.getUi();
  var 오늘 = ssText(날앞);

  /* ★ 지난 날짜도 메운다 ★  (2026-09-14)
     > "허브에서는 구 세트분리 판매현황을 읽는거 아니야?"

     맞는 말이었고, 그것이 사고의 나머지 절반이었다. 9/11~9/13 사이 허브는
     «구»를 보는데 사장님은 «뉴»에 붙여넣고 계셨다 — 그 사흘 마감이 2건·29건
     이다. 오늘 소스를 뉴로 옮겨 앞은 풀렸지만, 그날 마감은 여전히 비어 있다.

     그날 주문은 원장에 그대로 있다. 날짜만 받으면 「0911판매현황」을 만들 수
     있고, 허브 마감을 그 날짜로 다시 돌리면 복구된다.

     ★ 비워 두면 오늘이다 ★ 날마다 쓰는 길은 묻지 않고 지나가야 한다. */
  if (!오늘) {
    var 답 = ui.prompt('그날 판매현황 메우기',
      '어느 날짜를 메울까요?\n\n' +
      '  · 비워 두고 확인 → 오늘\n' +
      '  · 「260911」 처럼 yyMMdd 여섯 자리\n\n' +
      '원장에서 그 날짜 회차를 찾아 「MMDD판매현황」 탭을 세웁니다.\n' +
      '원장은 읽기만 하고, 출력 탭은 건드리지 않습니다.',
      ui.ButtonSet.OK_CANCEL);
    if (답.getSelectedButton() !== ui.Button.OK) return;
    오늘 = ssText(답.getResponseText()).split(' ').join('');
  }
  if (!오늘) 오늘 = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd');
  if (!/^[0-9]{6}$/.test(오늘)) {
    ui.alert('날짜는 yyMMdd 여섯 자리로 적어 주세요 (예: 260911).\n\n받은 값: ' + 오늘);
    return;
  }
  var 이름 = 오늘.substring(2) + SS_DAILY_SUFFIX;

  var lgSh = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!lgSh || lgSh.getLastRow() < 2) {
    ui.alert('「' + SSIO_TABS.원장 + '」이 비어 있습니다. 되살릴 데가 없습니다.');
    return;
  }

  /*  머리글은 「판매현황_고유아이디」에서 «찾아» 온다.
      그 탭이 이 하루의 칸 생김새를 그대로 들고 있다. */
  var idSh = ssio_ss().getSheetByName(SSIO_TABS.입력아이디);
  if (!idSh || idSh.getLastRow() < 2) {
    ui.alert('「' + SSIO_TABS.입력아이디 + '」이 비어 있어 머리글을 가져올 데가 없습니다.');
    return;
  }
  var idGrid = idSh.getDataRange().getValues();
  var idFound = ssFindSalesHeader(idGrid);
  if (!idFound) {
    ui.alert('「' + SSIO_TABS.입력아이디 + '」에서 머리글 줄(순번·품목코드)을 못 찾았습니다.');
    return;
  }
  var 머리줄 = idFound.headerRow;
  var width = 0;
  for (var w = 머리줄; w < idGrid.length; w++) {
    if (idGrid[w] && idGrid[w].length > width) width = idGrid[w].length;
  }
  var 머리 = idGrid[머리줄].slice(0, width);
  while (머리.length < width) 머리.push('');
  var head = 머리.concat([SS_DAILY_SRC_COL, '회차키']);

  var 순번자리 = -1;
  for (var p = 0; p < head.length; p++) if (ssText(head[p]) === '순번') { 순번자리 = p; break; }

  var sh = ssio_ss().getSheetByName(이름);
  var 살린줄 = [], 있는키 = {}, 버린줄 = 0;

  if (sh && sh.getLastRow() > 1) {
    var 옛폭 = Math.max(sh.getLastColumn(), head.length);
    var 옛머리 = sh.getRange(1, 1, 1, 옛폭).getValues()[0];

    var 옛키자리 = -1;
    for (var h = 옛머리.length - 1; h >= 0; h--) {
      if (ssText(옛머리[h]) === '회차키') { 옛키자리 = h; break; }
    }
    /*  회차키 칸조차 못 찾으면 어느 줄이 어느 회차인지 알 수가 없다.
        옛 줄은 통째로 버리고 원장으로 다시 세운다. */
    if (옛키자리 >= 0) {
      var 옛머리쓸만 = false;
      for (var v = 0; v < 옛머리.length; v++) {
        if (ssText(옛머리[v]) === '순번') { 옛머리쓸만 = true; break; }
      }
      var 새자리 = {};
      for (var n = 0; n < head.length; n++) {
        var hn = ssText(head[n]);
        if (hn && 새자리[hn] === undefined) 새자리[hn] = n;
      }

      var body = sh.getRange(2, 1, sh.getLastRow() - 1, 옛폭).getValues();
      for (var b = 0; b < body.length; b++) {
        var k = ssText(body[b][옛키자리]);
        if (!k) continue;

        var moved = [];
        for (var z = 0; z < head.length; z++) moved.push('');

        if (옛머리쓸만) {
          //  이름 대 이름으로 옮긴다 — 칸이 늘거나 줄어도 안 어긋난다
          for (var c = 0; c < 옛머리.length; c++) {
            var cn = ssText(옛머리[c]);
            if (!cn || 새자리[cn] === undefined) continue;
            moved[새자리[cn]] = body[b][c];
          }
        } else {
          /* ★ 머리글이 회사명 머리말인 탭 ★
             이름으로는 옮길 수가 없다. 그런데 이 탭의 줄은 판매현황을 «그대로»
             복사해 넣은 것이라 칸 «자리»는 맞다. 같은 이카운트 내보내기니까.
             그러니 자리로 옮긴다 — 이름을 모를 때만 쓰는 마지막 수단이다. */
          var 끝 = Math.min(옛키자리, head.length - 2);
          for (var c2 = 0; c2 < 끝; c2++) moved[c2] = body[b][c2];
        }

        /*  ★ 빈 껍데기는 버린다 ★
            지난번 되살리기가 자리를 못 찾아 «회차키만 있고 나머지는 빈» 줄을
            잔뜩 남겼다. 그런 줄을 그대로 두면 그 회차가 「이미 있다」고 세어져
            영영 안 메워진다. 순번이 숫자가 아니면 자료가 아니다. */
        if (순번자리 >= 0 && !/^[0-9]+$/.test(ssText(moved[순번자리]))) { 버린줄++; continue; }

        moved[head.length - 1] = k;
        if (!ssText(moved[head.length - 2])) moved[head.length - 2] = SS_DAILY_SRC_PASTE;
        살린줄.push(moved);
        있는키[k] = true;
      }
    }
  }

  /*  마지막 회차는 원장보다 「판매현황_고유아이디」가 온전하다 — 스무 칸이 다 있다.
      그 회차가 탭에서 사라졌으면 여기서 도로 채운다.

      ★ 지난 날짜를 메울 때는 «절대» 이 길로 오면 안 된다 ★  (2026-09-14)
        「판매현황_고유아이디」에는 «오늘» 것이 들어 있다. 지난 날짜를 메우면서
        이 줄들을 가져오면, 오늘 주문이 9/11 회차키를 달고 그날 마감에 섞인다.
        마감은 돈이 걸린 기록이다. 남의 날짜에 오늘 주문을 넣느니 그 회차는
        원장에서만 되살리는 편이 백 번 낫다. */
  var 진짜오늘 = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd');
  var 마지막키 = '', 큰번호 = 0;
  var 회차줄 = (오늘 === 진짜오늘) ? ssio_body(SSIO_TABS.회차) : [];
  for (var r = 0; r < 회차줄.length; r++) {
    if (ssText(회차줄[r][2]).replace(/-/g, '').slice(-6) !== 오늘 &&
        ssText(회차줄[r][0]).substring(0, 6) !== 오늘) continue;
    var no = ssNum(회차줄[r][3]);
    if (no >= 큰번호) { 큰번호 = no; 마지막키 = ssText(회차줄[r][0]); }
  }
  var 붙임 = [];
  if (마지막키 && !있는키[마지막키]) {
    for (var g = 머리줄 + 1; g < idGrid.length; g++) {
      var row = (idGrid[g] || []).slice(0, width);
      while (row.length < width) row.push('');
      if (순번자리 >= 0 && !/^[0-9]+$/.test(ssText(row[순번자리]))) continue;
      붙임.push(row.concat([SS_DAILY_SRC_PASTE, 마지막키]));
    }
    if (붙임.length) 있는키[마지막키] = true;
  }

  var 복원 = ss_원장에서그날복원_(lgSh.getDataRange().getValues(), 오늘, 있는키, head);

  var all = 살린줄.concat(붙임).concat(복원.rows);
  if (!all.length) {
    ui.alert('메울 것이 없습니다.\n\n' +
      '원장에 ' + 오늘 + ' 회차가 없고, 「' + SSIO_TABS.입력아이디 + '」에도 쓸 줄이 없습니다.');
    return;
  }
  all.sort(function (x, y) {
    var a1 = ssText(x[head.length - 1]), b1 = ssText(y[head.length - 1]);
    return a1 < b1 ? -1 : a1 > b1 ? 1 : 0;
  });

  /*  ★ 메우기도 같은 거르기를 탄다 ★  (2026-09-16)
      쌓기만 고치고 여기를 두면, 메우기를 돌린 날만 다시 세 벌이 된다.
      규칙은 ss_그날겹침거르기_ 한 곳에 있다.  */
  var _거른2_ = ss_그날겹침거르기_(all, head);
  var 겹쳐버림2 = _거른2_.버림;
  all = _거른2_.rows;

  sh = ssio_sheet(이름, head);
  ssio_clearBody(sh);
  if (sh.getMaxColumns() < head.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
  }
  if (sh.getMaxRows() < all.length + 1) {
    sh.insertRowsAfter(sh.getMaxRows(), all.length + 1 - sh.getMaxRows() + 10);
  }
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  ssio_textFormat(sh, head, all.length);
  sh.getRange(2, 1, all.length, head.length).setValues(all);
  ssio_styleHeader(sh, head.length, { bg: '#2c4f6b' });

  var 회차본 = {};
  for (var q = 0; q < all.length; q++) 회차본[ssText(all[q][head.length - 1])] = (회차본[ssText(all[q][head.length - 1])] || 0) + 1;
  var 줄글 = [];
  for (var kk in 회차본) if (Object.prototype.hasOwnProperty.call(회차본, kk)) 줄글.push(kk + ' ' + 회차본[kk] + '행');
  줄글.sort();

  ui.alert('「' + 이름 + '」을 다시 세웠습니다.\n\n' +
    (오늘 === 진짜오늘 ? '' : '★ 지난 날짜라 「' + SSIO_TABS.입력아이디 + '」는 안 썼습니다 — 원장에서만 되살렸습니다.\n\n') +
    줄글.join('\n') + '\n' +
    (겹쳐버림2 ? '↷ 앞 회차와 겹쳐 버린 줄 ' + 겹쳐버림2 + '행\n' : '') +
    '───────────────\n' +
    '합계 ' + all.length + '행\n\n' +
    (복원.rows.length
      ? '★ 원장에서 되살린 회차 : ' + 복원.회차들.join(', ') + ' (' + 복원.rows.length + '행)\n' +
        '  「' + SS_DAILY_SRC_COL + '」 칸이 「' + SS_DAILY_SRC_LEDGER + '」인 줄입니다.\n' +
        '  배송비 3칸 · 상호 · 주문서/사방넷 칸은 원장에 안 남아 비어 있습니다 —\n' +
        '  원래 비어 있던 것이 아니라 되살릴 수 없는 칸입니다.\n'
      : '원장에서 되살릴 회차는 없었습니다 (다 들어 있습니다).\n') +
    (버린줄 ? '\n빈 껍데기 ' + 버린줄 + '행은 버렸습니다 (회차키만 있고 자료가 없던 줄).' : ''));
}


var SS_CLOSE_SUFFIX = '마감';
var SS_CLOSE_MISS_SUFFIX = '_미매칭';
var SS_CLOSE_WAIT_SUFFIX = '_업체대기';

/**
 * ══════════════════════════════════════════════════════════════
 *  일일마감 — 원장이 그날 하루다
 *  2026-09-14
 *
 *  > "일일 마감 미매칭건이 열라 많아…
 *  >  세트분리에서 일일 마감을 만들어 실행해보자."
 *
 *  ★ 허브 일일마감이 왜 반을 놓쳤나 ★
 *    _pep_archiveUnifiedDaily_ 는 송장을 「롯데 탭」에서 가져온다. 소스 표에
 *    로젠은 usedByDaily:false 로 적혀 있다 — 자사출고를 롯데로 못박아 둔
 *    시절의 글이다. 9월 11일에 로젠으로 갈아탔으니 그날부터 주 송장원이
 *    통째로 비었다. 「롯데 송장 4건 · 미매칭 475건」이 그 숫자다.
 *    고장난 것이 아니라 «옛 사실»을 믿고 있는 것이다. 오늘 하루 종일 고친
 *    네 가지와 똑같은 병이고, 이것이 다섯 번째다.
 *
 *  ★ 왜 세트분리가 하면 나은가 ★
 *    ① 원장에는 이미 운송장번호가 붙어 있다. ss_송장전파 가 로젠·롯데 두
 *       탭을 다 읽고, 발주허브·대리공급 임시기록까지 읽어 채운다.
 *       즉 «매칭이 이미 끝난 자료»다. 여기서 또 맞출 일이 없다.
 *    ② 합포장 동봉은 대표 송장을 물려받아 있다.
 *    ③ 고유ID 가 처음부터 한 줄에 하나다. 이름·전화로 더듬을 일이 없다.
 *
 *    그래서 이 마감은 «맞추는 일»이 아니라 «옮겨 적는 일»이다.
 *    맞추는 데서 지는 싸움을, 맞출 필요가 없는 자리로 옮긴다.
 *
 *  ★ 칸은 허브 것과 똑같이 낸다 ★
 *    _UNIFIED_HEADERS_ 19칸 그대로다. CS 웹앱 검색과 v2 가 이미 이 모양을
 *    읽는다. 새 모양을 만들면 읽는 쪽을 다 고쳐야 한다.
 *
 *  ★ 아무것도 쓰지 않는다 ★
 *    원장도 출력 탭도 안 건드린다. 읽어서 두 탭에 적을 뿐이다.
 *    몇 번을 돌려도 달라지는 것은 그 두 탭뿐이다.
 * ══════════════════════════════════════════════════════════════
 */
var SS_CLOSE_HEADER = [
  '출처', '기록일시', '주문번호', '운송장번호', '수취인명', '전화번호', '휴대폰',
  '주소', '품목코드', '품목명', '수량', '배송메시지', '업체/판매처', '운임/배송비',
  '비고', '발주업체', '주문유형', '단가', '정산금액'
];

/** 마감에 안 담는 경로 — 나간 물건이 아니다 */
var SS_CLOSE_SKIP_ROUTES = [SS_ROUTE.NONSHIP, SS_ROUTE.HOLD];

/**
 * 원장 한 줄 → 마감 한 줄 (19칸).
 *
 * @param g   이름으로 칸을 읽는 함수
 * @param at  기록일시
 */
function ss_마감줄_(g, at) {
  var inv = ssText(g('운송장번호'));
  var 경로 = ssText(g('경로'));
  var 업체 = ssText(g('조치업체'));
  if (!업체 && 경로 === SS_ROUTE.PARTNER) 업체 = ssText(g('출고지'));

  /*  출처는 「어디서 나갔나」다. 대리발송이면 업체, 자사출고면 택배사.
      원장에 택배사 칸이 없으므로 송장 자릿수로 가린다 — 그 규칙은
      ssb_ownCode 한 곳에 있다. 여기 또 적으면 언젠가 둘이 갈라진다. */
  var 출처;
  if (경로 === SS_ROUTE.PARTNER) {
    출처 = '대리공급' + (업체 ? '(' + 업체 + ')' : '');
  } else if (inv) {
    출처 = (ssb_ownCode(inv) === SSB_LOTTE_CODE) ? '롯데' : '로젠';
  } else {
    출처 = '자사출고';
  }

  return [
    출처,
    at,
    ssText(g('고유ID')),
    inv,
    ssText(g('거래처명')),          // 원장의 이 칸은 «받는분»이다
    ssText(g('전화')),
    ssText(g('모바일')),
    ssText(g('주소1')),
    ssText(g('품목코드')),
    ssText(g('출력품목명')) || ssText(g('품목명')),
    ssNum(g('수량')),
    ssText(g('배송메시지')),
    ssText(g('보내는분')),
    ssNum(g('배송비')),
    ssText(g('적요')),
    업체,
    경로,
    '', ''                          // 단가·정산금액은 원장이 모른다
  ];
}

/**
 * 그날 마감을 만든다.
 *
 * @param 날앞  yyMMdd. 없으면 오늘
 * @param 조용  true 면 화면을 안 띄운다 (트리거용)
 * @return {object} 센 것
 */
function ss_일일마감(날앞, 조용) {
  var 오늘 = ssText(날앞) || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd');
  var at = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  var NL = String.fromCharCode(10);

  var lg = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!lg || lg.getLastRow() < 2) {
    if (!조용) ssio_alert('「' + SSIO_TABS.원장 + '」이 비어 있습니다.');
    return { 총: 0, 매칭: 0, 미매칭: 0 };
  }

  var cols = lg.getLastColumn();
  var head = lg.getRange(1, 1, 1, cols).getValues()[0];
  var ix = {};
  for (var h = 0; h < head.length; h++) {
    var hn = ssText(head[h]);
    if (hn && ix[hn] === undefined) ix[hn] = h;
  }

  /*  ★ 자리로 넘겨짚지 않는다 ★
      없는 칸은 «없다»고 말하고 멈춘다. 조용히 빈칸을 읽으면 마감이
      「미매칭 475건」 같은 거짓 숫자를 내놓는다 — 그게 오늘의 문제다. */
  var 없는칸 = [], 꼭필요 = ['회차키', '고유ID', '운송장번호', '경로', '품목코드', '수량'];
  for (var q = 0; q < 꼭필요.length; q++) if (ix[꼭필요[q]] === undefined) 없는칸.push(꼭필요[q]);
  if (없는칸.length) {
    if (!조용) ssio_alert('원장에 「' + 없는칸.join('」·「') + '」 칸이 없습니다.' + NL +
      '메뉴 「🛠 시트 설치 / 복구」를 한 번 돌리세요.');
    return { 총: 0, 매칭: 0, 미매칭: 0, 오류: '칸없음' };
  }

  var 늦은회차 = ss_마감늦은회차_(오늘);

  var lv = lg.getRange(2, 1, lg.getLastRow() - 1, cols).getValues();
  var rows = [], 미매칭 = [], 대기 = [];
  var 센다 = { 총: 0, 매칭: 0, 미매칭: 0, 대기: 0, 제외: 0 };
  var 경로별 = {}, 출처별 = {}, 회차별 = {};

  for (var r = 0; r < lv.length; r++) {
    var v = lv[r];
    var rk = ssText(v[ix['회차키']]);
    if (rk.substring(0, 6) !== 오늘) continue;

    var 경로 = ssText(v[ix['경로']]);
    if (SS_CLOSE_SKIP_ROUTES.indexOf(경로) >= 0) { 센다.제외++; continue; }

    var g = ss_마감읽기_(v, ix);
    var 줄 = ss_마감줄_(g, at);
    rows.push(줄);
    센다.총++;

    회차별[rk] = (회차별[rk] || 0) + 1;
    if (!경로별[경로]) 경로별[경로] = { 총: 0, 매칭: 0, 대기: 0 };
    경로별[경로].총++;

    if (ssText(줄[3])) {
      센다.매칭++;
      경로별[경로].매칭++;
      출처별[줄[0]] = (출처별[줄[0]] || 0) + 1;
      continue;
    }

    /* ★ 「아직 안 온 것」과 「사라진 것」을 가른다 ★  (2026-09-14)
       > "3차 오후3시 발주건들은 대리공급업체에서 송장번호를 다음날 기입하게 되
       >  택배마감시간이 지나서"

       늦은 회차의 대리발송 건은 오늘 송장이 없는 것이 «정상»이다. 업체가
       내일 아침에 적는다. 그걸 미매칭으로 세면 매칭률이 매일 저녁 거짓으로
       낮게 나오고, 사람은 곧 그 숫자를 안 보게 된다 — 숫자가 못 믿을 것이
       되는 순간 그 숫자로 사고를 잡을 수 없다.

       반대로 «이른 회차»의 대리발송이 비어 있으면 그건 진짜 미매칭이다.
       오늘 왔어야 할 것이 안 온 것이다. */
    if (경로 === SS_ROUTE.PARTNER && 늦은회차[rk]) {
      센다.대기++;
      경로별[경로].대기++;
      줄[14] = ssText(줄[14]);
      대기.push(줄);
    } else {
      센다.미매칭++;
      미매칭.push(줄);
    }
  }

  var 이름 = 오늘.substring(2) + SS_CLOSE_SUFFIX;
  ssio_write(이름, SS_CLOSE_HEADER, rows, { bg: '#1f4e78' });
  ssio_write(이름 + SS_CLOSE_MISS_SUFFIX, SS_CLOSE_HEADER, 미매칭, { bg: '#7a2e22' });
  ssio_write(이름 + SS_CLOSE_WAIT_SUFFIX, SS_CLOSE_HEADER, 대기, { bg: '#7a5b12' });

  /* ★ 매칭률의 분모에서 「대기」를 뺀다 ★
     오늘 받을 수 없는 것을 못 받았다고 세면 안 된다. 대신 뺀 사실과 그
     건수를 «같은 줄에» 적어, 숨긴 것이 아니라 갈라 놓은 것임을 보인다. */
  var 볼수있음 = 센다.총 - 센다.대기;
  var 율 = 볼수있음 > 0 ? Math.round((센다.매칭 / 볼수있음) * 1000) / 10 : 0;
  var 전체율 = 센다.총 ? Math.round((센다.매칭 / 센다.총) * 1000) / 10 : 0;

  var L = [];
  L.push('📋 일일마감 ' + 오늘 + '  —  「' + 이름 + '」');
  L.push('');
  L.push('  마감 줄   : ' + 센다.총 + '건' + (센다.제외 ? '   (비배송·보류 ' + 센다.제외 + '건 제외)' : ''));
  L.push('  송장 붙음 : ' + 센다.매칭 + '건');
  L.push('  미매칭    : ' + 센다.미매칭 + '건');
  if (센다.대기) {
    L.push('  업체 대기 : ' + 센다.대기 + '건   (늦은 회차 대리발송 — 내일 업체가 적습니다)');
  }
  L.push('  ★ 매칭률  : ' + 율 + '%' +
    (센다.대기 ? '   (대기 ' + 센다.대기 + '건 뺀 ' + 볼수있음 + '건 기준 · 전체로는 ' + 전체율 + '%)' : ''));

  var rkList = ss_마감키_(회차별);
  if (rkList.length) {
    var 회차글 = [];
    for (var k2 = 0; k2 < rkList.length; k2++) 회차글.push(rkList[k2] + ' ' + 회차별[rkList[k2]] + '건');
    L.push('');
    L.push('  회차 : ' + 회차글.join(' · '));
  }

  L.push('');
  L.push('  ── 경로별 ──────────────────');
  var pk = ss_마감키_(경로별);
  for (var k4 = 0; k4 < pk.length; k4++) {
    var p = 경로별[pk[k4]];
    var 볼수 = p.총 - p.대기;
    var pr = 볼수 > 0 ? Math.round((p.매칭 / 볼수) * 1000) / 10 : 0;
    L.push('  ' + pk[k4] + ' : ' + p.매칭 + ' / ' + 볼수 + '  (' + pr + '%)' +
      (p.대기 ? '   + 대기 ' + p.대기 : ''));
  }

  var sk = ss_마감키_(출처별);
  if (sk.length) {
    var 출처글 = [];
    for (var k6 = 0; k6 < sk.length; k6++) 출처글.push(sk[k6] + ' ' + 출처별[sk[k6]]);
    L.push('');
    L.push('  송장 출처 : ' + 출처글.join(' · '));
  }

  if (센다.미매칭) {
    L.push('');
    L.push('  ⚠ 미매칭 ' + 센다.미매칭 + '건은 「' + 이름 + SS_CLOSE_MISS_SUFFIX + '」 탭에 있습니다.');
    L.push('     ① 「🔁 송장 전파」를 먼저 돌려 보세요 — 그 사이 들어온 송장이 붙습니다.');
    L.push('     ② 그래도 남으면 「🧩 미매칭 메꾸기」로 후보를 찾습니다.');
  }
  if (센다.대기) {
    L.push('');
    L.push('  ⏳ 업체 대기 ' + 센다.대기 + '건은 「' + 이름 + SS_CLOSE_WAIT_SUFFIX + '」 탭에 있습니다.');
    L.push('     늦은 회차 대리발송입니다 — 택배 마감이 지나 업체가 내일 송장을 적습니다.');
    L.push('     내일 「🔁 송장 전파」 뒤에 이 마감을 다시 돌리면 채워집니다.');
  }

  Logger.log(L.join(NL));
  if (!조용) ssio_alert(L.join(NL));
  센다.율 = 율;
  센다.탭 = 이름;
  return 센다;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 「택배 마감 뒤」 회차를 가린다 ★
 *  2026-09-14
 *
 *  > "3차 오후3시 발주건들은 대리공급업체에서 송장번호를 다음날 기입하게 되..
 *  >  택배마감시간이 지나서"
 *
 *  원장에는 이 사정이 안 적혀 있다. 적혀 있는 것은 회차키뿐이고, 회차가
 *  «몇 시에» 돌았는지는 「회차」 탭의 최초실행에 있다. 그걸 본다.
 *
 *  ★ 회차 번호로 가리지 않는다 ★
 *    「3차부터」로 못박으면 회차를 네 번 돌린 날 2차가 오후가 되고, 두 번만
 *    돌린 날 3차가 아예 없다. 세는 방식이 그날 사정에 따라 달라지면 그
 *    숫자로는 아무것도 못 잡는다. 시각으로 가른다.
 *
 *  ★ 모르면 늦은 것으로 안 본다 ★
 *    회차 탭을 못 읽으면 빈 표를 준다 — 그러면 모두 미매칭으로 잡힌다.
 *    조용히 「대기」로 넘겨 사고를 숨기는 것보다, 시끄럽게 틀리는 편이 낫다.
 * ══════════════════════════════════════════════════════════════
 */
function ss_마감늦은회차_(날앞) {
  var 늦음 = {};
  try {
    var cfg = ssio_config();
    var 기준 = ssText(cfg['마감_업체송장_기준시각']) || '14:00';
    var mm = 기준.split(':');
    var 기준분 = (ssNum(mm[0]) * 60) + ssNum(mm[1] || 0);

    var sh = ssio_ss().getSheetByName(SSIO_TABS.회차);
    if (!sh || sh.getLastRow() < 2) return 늦음;
    var hd = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var ci = {};
    for (var h = 0; h < hd.length; h++) {
      var n = ssText(hd[h]);
      if (n && ci[n] === undefined) ci[n] = h;
    }
    if (ci['회차키'] === undefined || ci['최초실행'] === undefined) return 늦음;

    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    for (var r = 0; r < rows.length; r++) {
      var rk = ssText(rows[r][ci['회차키']]);
      if (rk.substring(0, 6) !== 날앞) continue;
      var t = rows[r][ci['최초실행']];
      var 분 = -1;
      if (t instanceof Date) {
        분 = (t.getHours() * 60) + t.getMinutes();
      } else {
        //  「2026-09-14 15:02:11」 같은 글자에서 시:분만 집는다
        var g = ssText(t).match(new RegExp('([0-9]{1,2}):([0-9]{2})'));
        if (g) 분 = (ssNum(g[1]) * 60) + ssNum(g[2]);
      }
      if (분 >= 기준분) 늦음[rk] = true;
    }
  } catch (e) {
    //  모르면 «늦지 않은 것»으로 둔다 — 사고를 숨기는 쪽으로 기울지 않는다
    Logger.log('[마감] 회차 시각을 못 읽음: ' + (e && e.message ? e.message : e));
  }
  return 늦음;
}

/** 원장 한 줄을 «이름»으로 읽는 함수를 만든다 */
function ss_마감읽기_(row, ix) {
  return function (name) {
    var c = ix[name];
    return c === undefined ? '' : row[c];
  };
}

/** 객체의 열쇠를 정렬해 돌려준다 */
function ss_마감키_(o) {
  var out = [];
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out.push(k);
  out.sort();
  return out;
}

/**
 * 이레 지난 「MMDD판매현황」 탭을 지운다.
 *
 * ★ 날짜는 «회차키»에서 읽는다 ★
 *   탭 이름의 MMDD 만 보면 해를 넘길 때 0102 가 1230 보다 «작아» 보여
 *   엉뚱한 것을 지운다. 탭 안의 회차키는 yyMMdd 라 그런 일이 없다.
 *   회차키를 못 읽으면 «안 지운다» — 모르면 두는 편이 낫다.
 */
function ss_옛판매현황탭정리(오늘회차키) {
  var 오늘 = ssText(오늘회차키).substring(0, 6);
  if (!/^[0-9]{6}$/.test(오늘)) return 0;
  var 기준 = new Date(2000 + Number(오늘.substring(0, 2)),
    Number(오늘.substring(2, 4)) - 1, Number(오늘.substring(4, 6)));
  var 지운다 = [];
  var shs = ssio_ss().getSheets();
  for (var i = 0; i < shs.length; i++) {
    var nm = shs[i].getName();
    if (!/^[0-9]{4}판매현황$/.test(nm)) continue;
    if (shs[i].getLastRow() < 2) continue;
    //  회차키는 맨 뒤 칸이다
    var lc = shs[i].getLastColumn();
    var k = ssText(shs[i].getRange(2, lc).getDisplayValue());
    var yy = k.substring(0, 6);
    if (!/^[0-9]{6}$/.test(yy)) continue;   // 모르면 안 지운다
    var d = new Date(2000 + Number(yy.substring(0, 2)),
      Number(yy.substring(2, 4)) - 1, Number(yy.substring(4, 6)));
    var 며칠 = Math.round((기준.getTime() - d.getTime()) / 86400000);
    if (며칠 > SS_DAILY_KEEP_DAYS) 지운다.push(shs[i]);
  }
  for (var z = 0; z < 지운다.length; z++) {
    try { ssio_ss().deleteSheet(지운다[z]); } catch (e) {}
  }
  return 지운다.length;
}
/**
 * ══════════════════════════════════════════════════════════════
 *  🔍 BOM 진단 — 「뚜껑이 세 개 나갔다」 를 눈으로 본다
 *
 *   > "세트메뉴에서 세트분리한거중에 몸통, 뚜껑 분리되고 뚜껑이 또
 *   >  분리가 되서 뚜껑이 3개가 나가는 상황이 벌어졌어...
 *   >  특정품목 JHMINIJJIMB00002만 그런거 같아"
 *
 *  쪼개는 코드(ssExplode)는 «한 번만» 쪼갠다. 되풀이해 쪼개는 길이
 *  아예 없다. 그러니 셋이 나갔다면 BOM 자료가 그렇게 생긴 것이다.
 *  자료를 그대로 펼쳐 보여 준다 — 어림짐작을 없앤다.
 * ══════════════════════════════════════════════════════════════
 */
function ss_BOM진단() {
  var NL = String.fromCharCode(10);
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  var 코드 = '';
  if (ui) {
    var r = ui.prompt('🔍 BOM 진단',
      '들여다볼 품목코드를 넣으세요.' + NL +
      '(비워 두면 «수상한 것 전부»를 훑습니다)',
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    코드 = ssText(r.getResponseText()).toUpperCase();
  }

  var sh = ssio_ss().getSheetByName(SSIO_TABS.MBOM);
  if (!sh || sh.getLastRow() < 2) {
    return ssio_alert('「' + SSIO_TABS.MBOM + '」 탭이 비어 있습니다.' + NL +
      '먼저 마스터 새로고침을 한 번 돌리세요.');
  }
  var raw = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();

  //  세트코드 → 구성품 줄
  var map = {}, 세트명 = {};
  for (var i = 0; i < raw.length; i++) {
    var sc = ssText(raw[i][0]).toUpperCase();
    var comp = ssText(raw[i][2]).toUpperCase();
    if (!sc || !comp) continue;
    세트명[sc] = ssText(raw[i][1]);
    (map[sc] || (map[sc] = [])).push({
      행: i + 2, code: comp, qty: ssNum(raw[i][3]) || 1, 원문수량: raw[i][3],
    });
  }

  var 줄 = [];
  줄.push('🔍 BOM 진단');
  줄.push('');

  /** 한 세트코드를 펼쳐 적는다 */
  function 펼치기(sc) {
    var parts = map[sc];
    줄.push('── ' + sc + '  「' + (세트명[sc] || '(이름없음)') + '」');
    if (!parts) {
      줄.push('   BOM 에 없습니다 — 쪼개지 않고 그대로 나갑니다.');
      줄.push('');
      return;
    }
    줄.push('   구성품 ' + parts.length + '줄:');
    var 합 = {}, 자기참조 = 0;
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      var 꼬리 = '';
      if (p.code === sc) { 꼬리 = '   ★ 자기 자신입니다 (이러면 안 됩니다)'; 자기참조++; }
      else if (map[p.code]) 꼬리 = '   ★ 이 구성품도 BOM 에 «세트»로 있습니다';
      줄.push('     M_BOM ' + p.행 + '행 :  ' + p.code + '  × ' + p.qty + 꼬리);
      합[p.code] = (합[p.code] || 0) + p.qty;
    }
    //  ★ 같은 구성품이 여러 줄이면 그만큼 «더» 나간다 ★
    var 겹침 = [];
    for (var c in 합) {
      if (!Object.prototype.hasOwnProperty.call(합, c)) continue;
      var n = 0;
      for (var j = 0; j < parts.length; j++) if (parts[j].code === c) n++;
      if (n > 1) 겹침.push(c + ' — ' + n + '줄, 합쳐서 ' + 합[c] + '개');
    }
    줄.push('');
    줄.push('   이 세트 1개를 주문하면 실제로 나가는 것:');
    for (var c2 in 합) {
      if (!Object.prototype.hasOwnProperty.call(합, c2)) continue;
      줄.push('     ' + c2 + '  ' + 합[c2] + '개' + (합[c2] > 1 ? '   ← 여기를 보세요' : ''));
    }
    if (겹침.length) {
      줄.push('');
      줄.push('   ★ 같은 구성품이 여러 줄로 들어 있습니다 ★');
      for (var g = 0; g < 겹침.length; g++) 줄.push('     ' + 겹침[g]);
      줄.push('   이카운트 BOM 에 줄이 겹쳐 들어간 것입니다. 그만큼 더 나갑니다.');
    }
    if (자기참조) {
      줄.push('');
      줄.push('   ★ 자기 자신을 구성품으로 갖고 있습니다 — 이카운트 BOM 을 고쳐야 합니다.');
    }
    줄.push('');
  }

  if (코드) {
    펼치기(코드);

    /*  ★ 거꾸로도 찾는다 ★  (2026-09-18)
        「뚜껑이 세 개」의 다른 길 — 한 뚜껑을 여러 세트가 나눠 쓰면,
        그 세트들을 함께 주문한 사람에게는 뚜껑이 세트 수만큼 나간다.
        그건 «맞는» 것일 수도, 세트 등록이 잘못된 것일 수도 있다.
        어느 쪽인지는 이 목록을 봐야 안다. */
    var 쓰는세트 = [];
    for (var rs in map) {
      if (!Object.prototype.hasOwnProperty.call(map, rs)) continue;
      if (rs === 코드) continue;
      var pp = map[rs];
      for (var pz = 0; pz < pp.length; pz++) {
        if (pp[pz].code === 코드) {
          쓰는세트.push(rs + '  x' + pp[pz].qty + '  ' + (세트명[rs] || ''));
          break;
        }
      }
    }
    줄.push('-- 이 코드를 «구성품으로 쓰는» 세트 : ' + 쓰는세트.length + '개');
    if (쓰는세트.length) {
      for (var w = 0; w < Math.min(쓰는세트.length, 25); w++) 줄.push('     ' + 쓰는세트[w]);
      if (쓰는세트.length > 25) 줄.push('     ... 그 밖 ' + (쓰는세트.length - 25) + '개');
      줄.push('');
      줄.push('   ★ 이 세트들을 «한 사람이 함께» 주문하면 이 코드가 그만큼 나갑니다.');
      줄.push('     세 개가 나갔다면, 그 주문에 이 목록의 세트가 셋 있었는지 보세요.');
    } else {
      줄.push('     (없음 — 이 코드는 다른 세트에 안 들어갑니다)');
    }
    줄.push('');
    //  그 구성품들이 또 세트인지도 한 겹 더 본다
    var ps = map[코드] || [];
    for (var q = 0; q < ps.length; q++) {
      if (map[ps[q].code]) {
        줄.push('   ↳ 구성품 「' + ps[q].code + '」 를 한 겹 더 폅니다:');
        펼치기(ps[q].code);
      }
    }
  } else {
    /*  ★ 수상한 것만 추린다 ★ 전부 적으면 아무도 안 읽는다 */
    var 겹친세트 = [], 자기참조세트 = [], 다단계 = [];
    for (var sc2 in map) {
      if (!Object.prototype.hasOwnProperty.call(map, sc2)) continue;
      var ps2 = map[sc2], 본것 = {}, 겹 = false, 자 = false, 다 = false;
      for (var z = 0; z < ps2.length; z++) {
        var cc = ps2[z].code;
        if (본것[cc]) 겹 = true;
        본것[cc] = true;
        if (cc === sc2) 자 = true;
        if (map[cc]) 다 = true;
      }
      if (겹) 겹친세트.push(sc2);
      if (자) 자기참조세트.push(sc2);
      if (다) 다단계.push(sc2);
    }
    줄.push('세트 ' + Object.keys(map).length + '개를 훑었습니다.');
    줄.push('');
    줄.push('★ 같은 구성품이 여러 줄인 세트 : ' + 겹친세트.length + '개');
    줄.push('   ' + (겹친세트.slice(0, 20).join(', ') || '없음'));
    줄.push('');
    줄.push('★ 자기 자신을 구성품으로 가진 세트 : ' + 자기참조세트.length + '개');
    줄.push('   ' + (자기참조세트.slice(0, 20).join(', ') || '없음'));
    줄.push('');
    줄.push('구성품이 또 세트인 것(다단계) : ' + 다단계.length + '개');
    줄.push('   ' + (다단계.slice(0, 20).join(', ') || '없음'));
    줄.push('');
    줄.push('※ 쪼개기는 «한 겹»만 합니다. 다단계라도 더 쪼개지지는 않지만,');
    줄.push('   그 구성품을 그대로 내보내게 되니 BOM 을 손봐야 할 수 있습니다.');
  }

  ssio_alert(줄.join(NL));
  return 줄.join(NL);
}

/**
 * ══════════════════════════════════════════════════════════════
 *  🔎 같은 주문에 같은 품목이 두 줄 — 원장에서 찾아낸다
 *
 *   > "내가 보기에 뚜껑만이 세트분리되고 또한번 되었어..
 *   >  그러다보니 1개가 2개가 된거야"
 *
 *  짐작을 두 번 틀렸다. BOM 은 깨끗했고, 뚜껑은 BOM 에 있지도 않았다.
 *  그러니 자료에서 «실제로 그렇게 된 줄»을 찾아야 한다.
 *
 *  한 고유ID 안에 같은 품목코드가 두 줄 이상이면 그 사람은 그 물건을
 *  그만큼 받는다. 라인ID 를 같이 적으므로 «어디서 생긴 줄인지»가 보인다 —
 *    같은 순번에서 나왔으면 (예: 12-1, 12-2)  → 한 세트가 쪼개진 것
 *    다른 순번에서 나왔으면 (예: 12-2, 15-2)  → 두 주문 줄이 겹친 것
 * ══════════════════════════════════════════════════════════════
 */
function ss_중복품목진단() {
  var NL = String.fromCharCode(10);
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  /*  ★ 날짜로도 찾게 한다 ★  (2026-09-18)
      > "회차가 아니라 17일건이야"
      사람은 회차키(260917-2)를 외우지 않는다. 날짜로 찾는다.
      한 칸에 날짜든 품목코드든 넣으면 알아서 가른다 —
      칸을 둘로 만들면 무엇을 어디 넣어야 하는지부터 헷갈린다. */
  var 코드필터 = '', 날짜필터 = '';
  if (ui) {
    var r = ui.prompt('🔎 같은 주문에 같은 품목이 두 줄',
      '날짜나 품목코드를 넣으세요.' + NL +
      '  날짜 예 :  9/17   0917   2026-09-17' + NL +
      '  품목 예 :  JHMINIJJIM90005' + NL +
      '(둘 다 걸려면 빈칸으로 띄어 함께 넣으세요. 비워 두면 전부)',
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var 낱말 = ssText(r.getResponseText()).split(/\s+/);
    for (var t = 0; t < 낱말.length; t++) {
      var w = ssText(낱말[t]);
      if (!w) continue;
      var d = ss_날짜키_(w);
      if (d) 날짜필터 = d; else 코드필터 = w.toUpperCase();
    }
  }

  var sh = ssio_ss().getSheetByName(SSIO_TABS.원장);
  if (!sh || sh.getLastRow() < 2) {
    return ssio_alert('「' + SSIO_TABS.원장 + '」 탭이 비어 있습니다.');
  }
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = {};
  for (var h = 0; h < head.length; h++) col[ssText(head[h])] = h;
  var 필요 = ['회차키', '라인ID', '고유ID', '품목코드', '수량', '경로', '순번', '원본품목코드'];
  var 없는칸 = [];
  for (var n = 0; n < 필요.length; n++) if (col[필요[n]] === undefined) 없는칸.push(필요[n]);
  if (없는칸.length) {
    return ssio_alert('원장에서 칸을 못 찾았습니다: ' + 없는칸.join(', ') + NL +
      '(머리글: ' + head.slice(0, 20).join(' / ') + ')');
  }

  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();

  /*  ★ 회차를 «가르되» 전부 본다 ★  (2026-09-18)
      > "지금이 아니라 이전꺼라.."

      처음엔 최근 회차만 봤다. 사고는 지난 회차에 났으니 그러면 못 찾는다.
      그렇다고 회차를 뭉개면 지난 회차의 같은 주문이 «중복»으로 보인다 —
      그건 중복이 아니다. 그래서 회차키를 묶음 열쇠에 «넣고» 전부 훑는다. */
  var 묶음 = {};
  var 훑음 = 0;
  var 회차목록 = {};
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var rk = ssText(row[col['회차키']]);
    var uid = ssText(row[col['고유ID']]);
    var code = ssText(row[col['품목코드']]).toUpperCase();
    if (!uid || !code) continue;
    if (코드필터 && code !== 코드필터) continue;
    /*  회차키는 YYMMDD-차수 꼴이다 (예: 260917-2).
        실행시각이 있는 회차도 있으니 둘 다 본다 — 하나만 보면
        옛 회차가 통째로 빠진다. */
    if (날짜필터) {
      var 때 = ssText(row[col['실행시각']] === undefined ? '' : row[col['실행시각']]);
      var 맞나 = (rk.indexOf(날짜필터) === 0) ||
        (때.replace(/[^0-9]/g, '').indexOf(날짜필터.length === 6 ? '20' + 날짜필터 : 날짜필터) >= 0);
      if (!맞나) continue;
    }
    회차목록[rk] = true;
    훑음++;
    var key = rk + String.fromCharCode(9679) + uid + String.fromCharCode(9679) + code;
    (묶음[key] || (묶음[key] = [])).push({
      라인ID: ssText(row[col['라인ID']]),
      순번: ssText(row[col['순번']]),
      수량: ssNum(row[col['수량']]),
      경로: ssText(row[col['경로']]),
      원본: ssText(row[col['원본품목코드']]),
    });
  }

  var 겹친것 = [];
  for (var k in 묶음) {
    if (!Object.prototype.hasOwnProperty.call(묶음, k)) continue;
    if (묶음[k].length > 1) 겹친것.push([k, 묶음[k]]);
  }
  //  최근 회차가 위로 오게 (사고가 언제 것인지 모를 때 훑기 좋다)
  겹친것.sort(function (a, b) {
    var ra = a[0].split(String.fromCharCode(9679))[0];
    var rb = b[0].split(String.fromCharCode(9679))[0];
    if (ra !== rb) return ra < rb ? 1 : -1;
    return b[1].length - a[1].length;
  });

  var 회차수 = Object.keys(회차목록).length;
  var 줄 = [];
  줄.push('🔎 같은 주문에 같은 품목이 두 줄');
  줄.push('');
  줄.push('훑은 줄 ' + 훑음 + '   회차 ' + 회차수 + '개 (원장에 쌓인 것 전부)');
  if (코드필터) 줄.push('품목 : ' + 코드필터);
  줄.push('');
  if (!겹친것.length) {
    줄.push('겹친 줄이 없습니다.');
    줄.push('');
    줄.push('※ 원장에 남아 있는 «모든» 회차를 봤습니다.');
    줄.push('   그래도 없다면, 그 줄은 원장에 안 남았거나 (원장 이전의 회차)');
    줄.push('   출력 탭에서 사람이 손으로 고친 것일 수 있습니다.');
    return ssio_alert(줄.join(NL));
  }

  /*  ★ 회차별로 몇 건인지 먼저 적는다 ★
      사고가 «어느 회차»에 몰려 있는지가 한눈에 보여야 한다. */
  var 회차별 = {};
  for (var c = 0; c < 겹친것.length; c++) {
    var rk2 = 겹친것[c][0].split(String.fromCharCode(9679))[0];
    회차별[rk2] = (회차별[rk2] || 0) + 1;
  }
  var 회차키들 = Object.keys(회차별).sort().reverse();
  줄.push('★ 겹친 주문 ' + 겹친것.length + '건 — 회차별');
  for (var rr = 0; rr < Math.min(회차키들.length, 12); rr++) {
    줄.push('   ' + (회차키들[rr] || '(회차없음)') + '  :  ' + 회차별[회차키들[rr]] + '건');
  }
  if (회차키들.length > 12) 줄.push('   ... 그 밖 ' + (회차키들.length - 12) + '개 회차');
  줄.push('');

  var 같은순번 = 0, 다른순번 = 0;
  for (var g = 0; g < 겹친것.length; g++) {
    var ls0 = 겹친것[g][1];
    var 순번들0 = {};
    for (var m0 = 0; m0 < ls0.length; m0++) 순번들0[ls0[m0].순번] = true;
    if (Object.keys(순번들0).length === 1) 같은순번++; else 다른순번++;
  }
  줄.push('한 주문줄이 쪼개진 것 : ' + 같은순번 + '건   ← 이것이 «쪼개기 탈»이다');
  줄.push('서로 다른 주문줄     : ' + 다른순번 + '건   ← 세트를 둘 이상 시킨 것');
  줄.push('');

  /*  ★ 「한 주문줄이 쪼개진 것」을 먼저 보인다 ★
      그것만이 코드 탈이다. 나머지는 사람이 판단할 일이라 뒤로 민다. */
  var 보인수 = 0;
  for (var pass2 = 0; pass2 < 2 && 보인수 < 15; pass2++) {
    for (var g2 = 0; g2 < 겹친것.length && 보인수 < 15; g2++) {
      var uidcode = 겹친것[g2][0].split(String.fromCharCode(9679));
      var ls = 겹친것[g2][1];
      var 순번들 = {};
      for (var m = 0; m < ls.length; m++) 순번들[ls[m].순번] = true;
      var 한순번 = Object.keys(순번들).length === 1;
      if (pass2 === 0 ? !한순번 : 한순번) continue;
      보인수++;
      var 합 = 0;
      for (var m2 = 0; m2 < ls.length; m2++) 합 += ls[m2].수량;
      줄.push('  [' + uidcode[0] + ']  ' + uidcode[1] + '   ' + uidcode[2] +
        '   ' + ls.length + '줄, 합 ' + 합 + '개' +
        (한순번 ? '   ★ 한 주문줄이 쪼개진 것' : '   (서로 다른 주문줄)'));
      for (var m3 = 0; m3 < ls.length; m3++) {
        줄.push('      라인 ' + ls[m3].라인ID + ' (순번 ' + ls[m3].순번 + ')  ' +
          ls[m3].수량 + '개  ' + ls[m3].경로 + '  원본 ' + ls[m3].원본);
      }
    }
  }
  if (겹친것.length > 보인수) 줄.push('  ... 그 밖 ' + (겹친것.length - 보인수) + '건');
  줄.push('');
  줄.push('※ 「서로 다른 주문줄」이면 그 사람이 세트를 둘 이상 시킨 것입니다.');
  줄.push('   같은 뚜껑을 쓰는 세트가 24개나 되니, 두 가지를 시키면');
  줄.push('   뚜껑이 두 줄로 나갑니다 — 그게 맞는지는 사람이 정해야 합니다.');

  ssio_alert(줄.join(NL));
  return 줄.join(NL);
}

/**
 * 사람이 적은 날짜를 회차키 앞자리(YYMMDD)로 바꾼다.
 *   9/17 · 09-17 · 0917 · 260917 · 2026-09-17 · 20260917  → '260917'
 * 날짜가 아니면 빈 문자열. 그래야 부르는 쪽이 «품목코드로구나» 할 수 있다.
 *
 * ★ 올해로 본다 ★ 달·일만 적었으면 올해다. 지난해 것을 보려면
 *   여섯 자리(260917)로 적으면 된다.
 */
function ss_날짜키_(s) {
  var d = ssText(s).replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.length === 8) return d.substring(2);              // 20260917 → 260917
  if (d.length === 6) return d;                           // 260917
  if (d.length === 4) {                                   // 0917 (또는 9/17)
    var yy = String(new Date().getFullYear()).substring(2);
    return yy + d;
  }
  if (d.length === 3) {                                   // 9/17 → 917
    var yy2 = String(new Date().getFullYear()).substring(2);
    return yy2 + '0' + d;
  }
  return '';
}
