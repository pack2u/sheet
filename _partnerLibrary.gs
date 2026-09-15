// ═══════════════════════════════════════════════════════════════════
// [Pack2U] 협력업체 라이브러리 — 공개 API
// ───────────────────────────────────────────────────────────────────
// ★ 2026-07-03: 라이브러리 패턴 전환
//   업체 시트 onEdit → Pack2U.p2u_partnerOnEdit(e) 1줄로 호출
//   이후 코드 수정은 clasp push만 하면 전체 업체에 즉시 반영
//   스크립트 재설치 불필요!
//
// ★ 2026-07-07: 성능 개선
//   - onOpen 캐시 프리워밍: 시트 열 때 codeMap 미리 구축
//   - 캐시 TTL 90분: 콜드 스타트 최소화
//   - _data 탭 기반 IMPORTRANGE 통합 (단가조회 속도 개선)
//
// ★ 함수 접두어: p2u_ (기존 함수명 충돌 방지)
// ═══════════════════════════════════════════════════════════════════

// ── 내부 유틸 (외부에서 호출 불가) ──

function _p2uLib_cleanCode_(str) {
  if (!str) return '';
  return String(str)
    .replace(/\u00a0/g, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(/\s/g, '')
    .toUpperCase();
}

/** onOpen 프리웜 캐시에서 codeMap 로드 (없으면 뷰어 탭에서 즉시 구축) */
function _p2uLib_loadCodeMap_(ss) {
  var sc = CacheService.getScriptCache();
  var cKey = 'P2U_VM_' + String(ss.getId()).substring(0, 12);
  try {
    var metaRaw = sc.get(cKey + '_M');
    if (metaRaw) {
      var meta = JSON.parse(metaRaw);
      var parts = [];
      for (var i = 0; i < (meta.c || 0); i++) {
        var p = sc.get(cKey + '_' + i);
        if (p == null) { parts = null; break; }
        parts.push(p);
      }
      if (parts && parts.length === meta.c) return JSON.parse(parts.join(''));
    }
  } catch (_) {}

  var codeMap = {};
  try {
    var viewer = _p2uLib_findViewer_(ss);
    if (!viewer) return codeMap;
    var vLr = viewer.getLastRow();
    if (vLr < 3) return codeMap;
    var vData = viewer.getRange(3, 1, vLr - 2, 7).getValues();
    for (var vi = 0; vi < vData.length; vi++) {
      var mc = _p2uLib_cleanCode_(vData[vi][2]);
      if (mc && mc.indexOf('#') === -1) {
        codeMap[mc] = { n: vData[vi][3], s: vData[vi][0], p: vData[vi][6] };
      }
    }
    // 캐시 저장 (다음 입력 빠르게)
    try {
      var json = JSON.stringify(codeMap);
      var max = 90000;
      var chunks = Math.ceil(json.length / max);
      var put = {};
      for (var ci = 0; ci < chunks; ci++) put[cKey + '_' + ci] = json.substr(ci * max, max);
      put[cKey + '_M'] = JSON.stringify({ c: chunks });
      sc.putAll(put, 5400);
    } catch (_) {}
  } catch (_) {}
  return codeMap;
}

function _p2uLib_statusFromStock_(st) {
  var s = String(st || '').replace(/\s/g, '');
  if (!s || s === '-' || s.indexOf('#') === 0) return '';
  if (s.indexOf('단종') !== -1) return '🚨단종';
  if (s.indexOf('품절') !== -1 && s.indexOf('품절+7') === -1) return '🚨품절';
  if (s.indexOf('재고까지만') !== -1) return '⚠재고까지만';
  return '';
}

function _p2uLib_findViewer_(ss) {
  var names = ['단가조회', '팩투유 단가조회', '뷰어'];
  for (var ni = 0; ni < names.length; ni++) {
    var t = ss.getSheetByName(names[ni]);
    if (t) return t;
  }
  var allTabs = ss.getSheets();
  for (var ti = 0; ti < allTabs.length; ti++) {
    var tn = allTabs[ti].getName();
    if (tn.indexOf('마감') !== -1 || tn.indexOf('발주') !== -1 ||
        tn.indexOf('설정') !== -1 || tn.indexOf('검색') !== -1 ||
        tn.indexOf('취소') !== -1) continue;
    if (tn.indexOf('단가') !== -1 || tn.indexOf('뷰어') !== -1 ||
        tn.indexOf('팩투유') !== -1) return allTabs[ti];
  }
  // ★ 2026-07-17 (H8): 폴백 allTabs[0] 폐기 — 엉뚱한 탭 clear 방지 (_pt_findViewerSheet와 동일 정책)
  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  ★ 공개 API: 업체 시트 onEdit 핸들러
//  ★ 2026-07-16: 실시간 자동입력/차단 제거
//    → 칸마다 toast·되돌리기로 시트 지연 발생
//    → 품목명/단가 채움은 발주 수집 직전 1회(_po_refreshAutofillBeforeCollect_)
//  ★ 2026-07-20: D/L 무음 복원만 부활 (운영자 확정)
//    발주탭 D(품목명)/L(정산금액)은 D1/L1 스필 수식이 표시를 담당.
//    엑셀 다품목 복붙에 품목명·단가 값이 함께 들어오면 스필이 막혀 #REF!가 되므로,
//    편집 범위와 겹치는 D/L 값만 조용히 걷어냄 (토스트·알림·차단창 일절 없음).
//    → 스필이 즉시 재계산되어 코드 기준 품목명·단가가 수초 내 표시됨.
// ═══════════════════════════════════════════════════════════════════
/**
 * 발주 및 송장조회 — 「자동」 열에 손으로 쓴 값을 걷어내 스필 수식을 되살린다.
 *
 * ★ 왜 열 전체가 사라지나 ★  (2026-09-14)
 *   > "업체들이 자꾸 품목명에 붙여넣기를 한다던가 텍스트를 쓰려고해..
 *      그럴떄 위쪽에 품목명이 다 사라져.. 단가도 같은 문제"
 *
 *   D1 에 =ARRAYFORMULA(...) 가 있어 D2 아래로 «펼쳐집니다». 그런데 업체가
 *   D5 에 한 글자라도 쓰면 펼칠 자리가 막혀 수식이 통째로 «#REF!» 가 되고
 *   **그 위 줄까지 전부 사라집니다.** 한 칸 때문에 열 하나가 날아갑니다.
 *
 *   그래서 들어온 값을 즉시 걷어내면 수식이 다시 펼쳐진다 — 이 함수의 일이다.
 *
 * ★ 자동 열은 넷인데 둘만 보고 있었다 ★  (2026-09-14 고침)
 *   A 거래처명(자동) · D 품목명(자동) · L 정산금액(자동) · N 상태(자동)
 *   종전에는 D·L 만 봤다. A·N 에 붙여넣으면 그 열은 사라진 채로 남았다.
 *   헤더 정의(_PT_ORDER_TAB_HEADERS_)도 「수식 주입(A/D/L/N)」이라 적혀 있다.
 *
 * ★ 조용히 지우면 업체가 또 붙여넣는다 ★  (2026-09-14 고침)
 *   여태 말없이 걷어냈다. 업체 눈에는 「썼는데 사라졌다」로만 보이니
 *   다시 쓰고, 또 사라지고, 결국 전화가 온다.
 *   무엇을 왜 걷어냈는지 toast 로 알린다. 걷어낸 게 없으면 조용하다.
 */
function p2u_partnerOnEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== "발주 및 송장조회") return;

    var startRow = e.range.getRow();
    var endRow = startRow + e.range.getNumRows() - 1;
    var startCol = e.range.getColumn();
    var endCol = startCol + e.range.getNumColumns() - 1;

    // 데이터 영역(2행~)과 겹치지 않으면 종료
    if (endRow < 2) return;
    if (startRow < 2) startRow = 2;

    /* 헤더에 「(자동)」이라고 적힌 열 «전부».
       _PT_ORDER_TAB_HEADERS_ 와 짝이다 — 열이 밀리면 여기도 밀린다.
       (_spillguard_test.js 가 둘이 같은지 지킨다)

       여섯 중 지금 스필 수식이 들어가는 것은 A·D·L·N 넷이고
       B(주문일자)·M(고유ID)는 스크립트가 값으로 채운다. 그래도 여섯을
       다 적어 둔다 — 아래에서 «1행이 ARRAYFORMULA 일 때만» 손대므로
       값으로 채우는 열은 저절로 건너뛴다. 나중에 어느 열이 수식으로
       바뀌어도 여기를 안 고쳐도 된다. */
    var 자동열 = [
      { c: 1, a1: "A1", 이름: "거래처명" },
      { c: 2, a1: "B1", 이름: "주문일자" },
      { c: 4, a1: "D1", 이름: "품목명" },
      { c: 12, a1: "L1", 이름: "정산금액" },
      { c: 13, a1: "M1", 이름: "고유ID" },
      { c: 14, a1: "N1", 이름: "상태" },
    ];

    var n = endRow - startRow + 1;
    var 걷어낸것 = [];
    for (var k = 0; k < 자동열.length; k++) {
      var col = 자동열[k];
      if (!(startCol <= col.c && endCol >= col.c)) continue;
      //  1행이 스필 수식일 때만 손댄다 (값으로 굳혀 쓰는 파일은 안 건드린다)
      var f = "";
      try { f = String(sheet.getRange(col.a1).getFormula() || ""); } catch (_) {}
      if (f.indexOf("ARRAYFORMULA") === -1) continue;

      var rng = sheet.getRange(startRow, col.c, n, 1);
      var vals = rng.getValues();
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0] || "") !== "") {
          rng.clearContent();
          걷어낸것.push(col.이름);
          break;
        }
      }
    }

    if (!걷어낸것.length) return;
    SpreadsheetApp.flush();

    /*  왜 사라졌는지 말해 준다. 이 말이 없으면 업체는 같은 일을 되풀이한다.
        toast 는 실패해도 걷어내기는 이미 끝났으므로 삼킨다. */
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        걷어낸것.join(" · ") + " 칸은 이카운트코드(C열)로 자동 채워집니다.\n" +
        "여기에 직접 쓰면 열 전체가 사라져서, 방금 쓰신 값을 걷어냈습니다.\n" +
        "C열에 코드를 넣으시면 자동으로 채워집니다.",
        "자동으로 채워지는 칸입니다", 8);
    } catch (_) {}
  } catch (_) {}
}


// ═══════════════════════════════════════════════════════════════════
//  ★ 공개 API: 업체 시트 onOpen 핸들러
// ═══════════════════════════════════════════════════════════════════
function p2u_partnerOnOpen() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ★ 2026-07-06: 단가조회(뷰어) 탭 #REF! 자동 복구
    try {
      var viewer = _p2uLib_findViewer_(ss);
      if (viewer) {
        var a3Val = String(viewer.getRange('A3').getDisplayValue() || '');
        if (a3Val.indexOf('#REF') !== -1 || a3Val.indexOf('#오류') !== -1) {
          var vLr = Math.max(viewer.getLastRow(), 4);
          if (vLr >= 4) {
            var clearRows = vLr - 3;
            try { viewer.getRange(4, 1, clearRows, 2).clearContent(); } catch(ec1) {}
            try { viewer.getRange(4, 4, clearRows, 7).clearContent(); } catch(ec2) {}
            SpreadsheetApp.flush();
          }
        }
      }
    } catch(eRefRepair) {}

    // ★ 2026-07-20: 발주탭 D/L 스필 막힘(#REF!) 무음 복구 (1계층 백필)
    //   onEdit(0계층)이 이벤트 유실 등으로 못 걷어낸 값을 시트 열 때 정리
    try {
      var otDL = ss.getSheetByName('발주 및 송장조회');
      if (otDL) {
        var d1fDL = String(otDL.getRange('D1').getFormula() || '');
        var l1fDL = String(otDL.getRange('L1').getFormula() || '');
        var dBlockedDL = d1fDL.indexOf('ARRAYFORMULA') !== -1 &&
          String(otDL.getRange('D1').getDisplayValue() || '').indexOf('#REF') !== -1;
        var lBlockedDL = l1fDL.indexOf('ARRAYFORMULA') !== -1 &&
          String(otDL.getRange('L1').getDisplayValue() || '').indexOf('#REF') !== -1;
        if (dBlockedDL || lBlockedDL) {
          var spillEndDL = 500;
          try {
            var mDL = (dBlockedDL ? d1fDL : l1fDL).match(/C2:C(\d+)/);
            if (mDL) spillEndDL = parseInt(mDL[1], 10);
          } catch(_) {}
          if (dBlockedDL) otDL.getRange(2, 4, spillEndDL - 1, 1).clearContent();
          if (lBlockedDL) otDL.getRange(2, 12, spillEndDL - 1, 1).clearContent();
          SpreadsheetApp.flush();
        }
      }
    } catch(eDLHeal) {}

    // ★ 2026-07-07: 캐시 프리워밍 — onOpen 시 codeMap 미리 구축
    try {
      var viewerPW = viewer || _p2uLib_findViewer_(ss);
      if (viewerPW) {
        var vLrPW = viewerPW.getLastRow();
        if (vLrPW >= 3) {
          var vDataPW = viewerPW.getRange(3, 1, vLrPW - 2, 7).getValues();
          var codeMapPW = {};
          for (var vi = 0; vi < vDataPW.length; vi++) {
            var mc = _p2uLib_cleanCode_(vDataPW[vi][2]);
            if (mc && mc.indexOf('#') === -1) {
              codeMapPW[mc] = { n: vDataPW[vi][3], s: vDataPW[vi][0], p: vDataPW[vi][6] };
            }
          }
          var ssIdPW = ss.getId();
          var cKeyPW = 'P2U_VM_' + ssIdPW.substring(0, 12);
          var scPW = CacheService.getScriptCache();
          var jsonPW = JSON.stringify(codeMapPW);
          var maxPW = 90000;
          var chunksPW = Math.ceil(jsonPW.length / maxPW);
          var putPW = {};
          for (var ci = 0; ci < chunksPW; ci++) putPW[cKeyPW + '_' + ci] = jsonPW.substr(ci * maxPW, maxPW);
          var vnPW = '';
          try {
            var stPW = ss.getSheetByName('설정');
            if (stPW) vnPW = String(stPW.getRange('B5').getValue() || '').trim();
          } catch(eVnPW) {}
          putPW[cKeyPW + '_M'] = JSON.stringify({c: chunksPW, vn: vnPW});
          scPW.putAll(putPW, 5400); // 90분
        }
      }
    } catch(ePrewarm) {}

    var notice = ss.getSheets()[0].getRange('Y1').getValue();
    var msg = String(notice || '').trim();
    if (msg && msg.charAt(0) !== '(' && msg.charAt(0) !== '#') {
      var html = HtmlService.createHtmlOutput(
        '<div style="font-family:Apple SD Gothic Neo,Arial,sans-serif;padding:24px;">' +
        '<div style="font-size:15px;font-weight:bold;color:#c07616;margin-bottom:14px;">' +
        '🔔 공지사항</div>' +
        '<div style="font-size:13px;line-height:1.9;white-space:pre-wrap;">' + msg + '</div>' +
        '</div>'
      ).setWidth(440).setHeight(230);
      SpreadsheetApp.getUi().showModelessDialog(html, '🔔 Pack2U 공지사항');
    }
  } catch(e) {}
  
  // 메뉴 등록
  try {
    SpreadsheetApp.getUi()
      .createMenu('🔍 상품 검색')
      .addItem('상품명으로 코드 검색', 'openProductSearchSidebar')
      .addToUi();
  } catch(eMenu2) {}
  try {
    SpreadsheetApp.getActiveSpreadsheet()
      .addMenu('📬 송장 매칭', [
        { name: '카카오 송장번호 입력', functionName: 'openInvoiceMatchSidebarLocal' }
      ]);
  } catch(eMenu3) {}
  try {
    SpreadsheetApp.getUi()
      .createMenu('🗄️ DB 단가')
      .addItem('🔍 DB 품목 검색', 'dbPriceSearch')
      .addItem('🔄 DB 단가 새로고침', 'dbPriceRefresh')
      .addItem('⚙️ 모드 전환 (기존/DB)', 'dbToggleMode')
      .addToUi();
  } catch(eMenu4) {}
}

// ═══════════════════════════════════════════════════════════════════
//  ★ 공개 API: 송장 매칭 사이드바 (2026-07-06 라이브러리 전환)
// ═══════════════════════════════════════════════════════════════════

function p2u_openInvoiceMatchSidebar() {
  try {
    var htmlStr = _getInvoiceMatchHtmlSimple_();
    var html = HtmlService.createHtmlOutput(htmlStr)
      .setTitle("📬 카카오 송장 매칭")
      .setWidth(400);
    SpreadsheetApp.getUi().showSidebar(html);
  } catch (e) {
    SpreadsheetApp.getUi().alert("오류: " + e.message);
  }
}

function p2u_parseAndMatchInvoiceText(rawText) {
  return parseAndMatchInvoiceTextLocal(rawText);
}

function p2u_applyInvoiceMatches(matchesJson) {
  return applyInvoiceMatchesLocal(matchesJson);
}

function p2u_parseAndMatchInvoiceImage(base64Data) {
  return parseAndMatchInvoiceImageLocal(base64Data);
}

/**
 * ★ 2026-07-09: 전용양식 미발주 다운로드용 라이브러리 공개 API 래퍼
 */
function p2u_getExclusiveFormDataForDownload() {
  return getExclusiveFormDataForDownloadLocal();
}

/**
 * ★ 2026-08-03: 비교검증 시트 로컬 메뉴용 공개 API
 * (각 [검증] 시트 바운드 스크립트 → Pack2U.partnerCompare*)
 */
function p2u_compareCollectOnActive() {
  return partnerCompareCollectOnActive();
}
function p2u_compareRunOnActive() {
  return partnerCompareRunOnActive();
}
function p2u_compareApplyEcountFixOnActive() {
  return partnerCompareApplyEcountFixOnActive();
}

/** ★ 2026-08-04: 롯데택배 배송비 비교시트 로컬 메뉴 */
function p2u_lotteShipCompareOnActive() {
  return partnerLotteShipCompareOnActive();
}
