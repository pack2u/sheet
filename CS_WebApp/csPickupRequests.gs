/**
 * ══════════════════════════════════════════════════════════════
 *  업체가 요청한 반품 접수를 «실제로» 보낸다
 *
 *  > 사장님: "업체가 직접 반품접수 하는거 진행"  ·  "1시간이면 충분해, 기존거에 얹어줘"
 *
 *  ★ 길은 둘로 나뉘어 있다 ★
 *    업체 포털(Partner_WebApp/prpPickup.gs)은 **요청만** 적는다 —
 *    대장 비고에 「[yyMMdd HH:mm 업체:이름] 반품접수 요청.」 한 줄.
 *    실제 로젠·롯데 호출은 **여기**가 한다.
 *
 *    왜 나눴나 — 접수 로직(주소 되짚기·운임 조회·박스별 접수·대장 기록)은
 *    csLotteReturnPickupFromCard 에 있고 백 줄이 넘는다. 포털에 복사하면
 *    같은 것이 두 군데가 되고, 고칠 때 한쪽만 고치면 조용히 갈린다
 *    ([[one-value-one-owner]]). 포털은 별도 Apps Script 프로젝트라 그 함수를
 *    직접 못 부른다 — 그래서 «대장»을 사이에 두고 주고받는다.
 *
 *  ★ 1시간마다 돈다 ★
 *    새 트리거를 걸지 않고 csLogenSlipFill 의 1시간 트리거에 얹었다
 *    (csReturnHourlyJob). 차례가 중요하다 —
 *      ① 요청을 접수한다 (여기)  → takeNo 가 생긴다
 *      ② 송장을 채운다           → 그 자리에서 송장까지 붙는 날도 있다
 *
 *  ★ 실패해도 «요청 줄»을 그냥 두지 않는다 ★
 *    그대로 두면 다음 시간에 또 보내고, 또 실패하고, 업체는 영영 모른다.
 *    결과를 반드시 한 줄 적는다 — 성공이든 실패든. 업체 화면에도 보이게
 *    [yyMMdd HH:mm CS] 꼴로 찍는다(포털 prpPublicTimeline_ 이 그 모양만 내보낸다).
 * ══════════════════════════════════════════════════════════════
 */

/** 포털이 적는 요청 표시 — Partner_WebApp/prpPickup.gs 의 PRP_PICKUP_MARK_ 와 «같아야» 한다 */
var _CPR_REQ_MARK_ = "반품접수 요청";

/**
 * «밖에서 볼 수 있는» 자리 — 반품관리대장의 점검 탭.
 *
 * ★ 왜 Logger.log 로는 모자란가 ★  (2026-10-07)
 *   이 일감은 사람 없이 1시간마다 돈다. 그런데 남는 것이 Logger.log 뿐이라
 *   «돌았는지·무엇이 바뀌었는지»를 보려면 매번 편집기를 열어야 한다.
 *   묻는 사람도, 답하는 사람도 그때마다 사장님을 불러야 한다.
 *
 *   특히 트리거가 옛 이름에서 옮겨 탔는지는 «일이 도는 것»으로 가려지지 않는다 —
 *   옛 트리거도 송장 채우기는 똑같이 한다. 바뀌어야 비로소 도는 것은 요청 접수뿐인데,
 *   요청이 없으면 그것도 아무 일을 안 한다. 밤새 멀쩡해 보여도 안 바뀌었을 수 있다.
 *   그래서 «지금 걸린 트리거 이름»을 그대로 적는다. 짐작하지 않게.
 *
 * ★ 달 탭으로 안 읽힌다 ★ 달 탭은 /^\d{6}$/ 로만 고른다(_cs_isReturnLedgerMonthName_).
 * ★ 쌓이지 않는다 ★ 항목마다 한 줄이고 제자리에 덮어쓴다.
 */
var _CPR_OPS_TAB_ = "_운영점검";

function _cpr_ops_(ss, 항목, 값) {
  try {
    var tab = ss.getSheetByName(_CPR_OPS_TAB_);
    if (!tab) {
      tab = ss.insertSheet(_CPR_OPS_TAB_);
      tab.getRange(1, 1, 1, 3).setValues([["항목", "값", "적힌 때"]]);
      tab.getRange("1:1").setBackground("#1f2937").setFontColor("white")
        .setFontWeight("bold");
      tab.setFrozenRows(1);
      tab.setColumnWidth(1, 150);
      tab.setColumnWidth(2, 520);
      tab.setColumnWidth(3, 120);
      //  맨 뒤로 보낸다 — 매일 쓰는 달 탭을 가리지 않게
      try { ss.setActiveSheet(tab); ss.moveActiveSheet(ss.getNumSheets()); } catch (e) {}
    }
    /*  ★ «어느 판»이 적었는지 같이 남긴다 ★  (2026-10-09)
        고친 것을 올리고 다음 런을 봤는데 옛 글이 적혀 있었다. 서버 파일을 당겨
        보니 새 코드였다 — 그래서 「올라갔나 안 올라갔나」를 20분 동안 짐작으로
        따졌다. 짐작할 일이 아니다. 적은 쪽이 자기 판 번호를 적으면 끝난다.

        v452 라 적혀 있는데 글이 옛것이면 v452 자체가 옛것이라는 뜻이고,
        v451 이라 적혀 있으면 그 런이 밀기 전에 돌았다는 뜻이다.
        둘은 고칠 자리가 완전히 다르다.                                     */
    var 판 = "";
    try { 판 = " v" + CS_BUILD_; } catch (e) { 판 = " v?"; }
    var 때 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd HH:mm") + 판;
    var last = tab.getLastRow();
    var 이름들 = last >= 2
      ? tab.getRange(2, 1, last - 1, 1).getDisplayValues() : [];
    for (var i = 0; i < 이름들.length; i++) {
      if (String(이름들[i][0]).trim() === 항목) {
        tab.getRange(i + 2, 2, 1, 2).setValues([[String(값), 때]]);
        return;
      }
    }
    tab.appendRow([항목, String(값), 때]);
  } catch (e) { /* 적지 못해도 제 일은 한다 */ }
}

/** 지금 «실제로» 걸려 있는 트리거 이름들 — 짐작하지 않고 그대로 적는다 */
/**
 * ★ 일감 «전체»가 쓸 시간 — 이 값의 주인은 여기 하나다 ★  (2026-10-09)
 *
 *   ─ 무슨 일이 있었나 ─
 *   `_운영점검` 에서 「출고 송장 받아오기」가 16:12, 그 다음 단계인 「출고 지연
 *   점검」이 16:41 로 찍혔다. 한 런 안에서 **29분**이다. 그리고 그 뒤 단계들
 *   (도서·산간 · 계약)과 맨 끝의 「돌았습니다」는 **15:33 에 그대로 멈춰 있었다.**
 *   트리거는 셋뿐이고 겹친 것도 없다(_cpr_triggerNames_ 는 중복을 숨기지 않는다).
 *   그러니 런이 둘이 아니라, **한 런이 벽에 부딪혀 끝까지 못 간 것**이다.
 *
 *   ─ 왜 그랬나 ─
 *   여섯 단계가 «각자» 2분 30초씩 제 예산을 들고 있다
 *   (_LOGEN_TIME_BUDGET_MS_ · _LSF_BUDGET_MS_). 저마다 「나 혼자 돈다」고 믿는다.
 *   **일감 전체의 시간을 가진 주인이 없었다** — [[one-value-one-owner]] 가
 *   값이 아니라 «시간»에서 깨진 경우다. 여섯이 다 제 몫을 쓰면 15분이고,
 *   거기에 달 탭 훑기와 원장 8,000줄 읽기가 더 붙는다.
 *
 *   ─ 어떻게 하나 ─
 *   이 예산을 넘겼으면 **뒤쪽 단계를 건너뛰고** 끝까지 간다. 건너뛴 것은
 *   반드시 적는다 — 조용히 빠지면 「돌았습니다」가 거짓말이 된다.
 *   뒤쪽 둘(도서·산간 · 계약)은 코드 머리말이 이미 «급하지 않다»고 적어 둔 것들이다.
 *
 *   25분이다. 이 계정의 벽은 30분으로 보이므로(위 29분이 실측) 5분을 남긴다.
 */
var _CPR_JOB_BUDGET_MS_ = 1500000;

/** 예산을 넘겼나 */
function _cpr_overBudget_(시작) {
  return (new Date().getTime() - 시작) > _CPR_JOB_BUDGET_MS_;
}

/**
 * 한 단계가 끝날 때마다 «지금까지의 걸음»을 적는다.
 *
 * ★ 끝에 한 번만 적으면 안 된다 ★ 벽에 부딪혀 죽으면 그 한 번이 영영 안 온다.
 *   그게 바로 위의 일이 한 시간 동안 안 보였던 까닭이다. 단계마다 적어야
 *   «어디까지 갔고 무엇이 오래 걸렸는지»가 시체에 남는다.
 *   [[edit-scripts-save-each-step]] 와 같은 이야기다.
 *
 * @return {number} 다음 단계의 출발 시각
 */
function _cpr_step_(ss, 걸음, 이름, t0, 시작) {
  var 이제 = new Date().getTime();
  걸음.push(이름 + " " + Math.round((이제 - t0) / 1000) + "초");
  if (ss) {
    try {
      _cpr_ops_(ss, "일감 걸음", 걸음.join(" · ") +
        " · 합 " + Math.round((이제 - 시작) / 1000) + "초");
    } catch (e) { /* 적지 못해도 일감은 간다 */ }
  }
  return 이제;
}

function _cpr_triggerNames_() {
  try {
    var all = ScriptApp.getProjectTriggers();
    var 이름 = [];
    for (var i = 0; i < all.length; i++) 이름.push(all[i].getHandlerFunction());
    이름.sort();
    return 이름.length ? 이름.join(" · ") : "(없음)";
  } catch (e) { return "못 읽음: " + e.message; }
}

/** 이미 처리했다고 볼 흔적 */
var _CPR_DONE_RE_ = /반품접수\s*(완료|실패)|회수접수\s*·/;

/** 한 번에 처리할 줄 수. 되돌리기 어려운 일이라 적게 잡는다. */
var _CPR_MAX_ = 20;

/** 며칠치까지 본다 */
var _CPR_DAYS_ = 14;

/**
 * 1시간마다 도는 일 — 요청 접수 → 송장 채우기.
 *
 * ★ 트리거는 이 함수를 부른다 ★ (csInstallLogenSlipFillTrigger 가 건다)
 *   차례를 바꾸지 말 것. 접수가 먼저여야 그 자리에서 송장까지 붙는다.
 */
function csReturnHourlyJob() {
  var L = [];

  /*  ★ 걸음을 단계마다 남긴다 ★ 끝에 한 번만 적으면, 벽에 부딪혀 죽는 날은
      아무것도 안 남는다 — 실제로 한 시간을 그렇게 잃었다 (_cpr_step_ 머리말). */
  var 시작 = new Date().getTime();
  var 걸음 = [];
  var ss2 = null;
  try { ss2 = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_); } catch (e) {}
  var t = 시작;

  try { L.push(csProcessPickupRequests()); }
  catch (e) { L.push("요청 접수 실패: " + e.message); }
  t = _cpr_step_(ss2, 걸음, "요청접수", t, 시작);
  /*  기존트리거아님 — 여기서 부르는 것은 트리거가 «직접» 부른 것이 아니다.
      그 표를 안 주면 csLogenFillReturnSlips 가 옛 트리거를 찾느라 한 번 더
      훑는다(csLogenSlipFill.gs 머리말). 일은 같지만 헛걸음이다. */
  try { L.push(csLogenFillReturnSlips({ 기존트리거아님: true })); }
  catch (e) { L.push("송장 채우기 실패: " + e.message); }
  t = _cpr_step_(ss2, 걸음, "송장채우기", t, 시작);

  /*  ★ 출고 송장 받아오기 ★  (2026-10-08)
      사람이 로젠 실적을 「입력_로젠주문실적」 탭에 붙여넣던 일을 대신한다.
      ★ 출고 지연 점검보다 «먼저» 둔다 ★ 송장이 붙어야 추적할 것이 생긴다. */
  try { var 송장 = csLogenCollectShipSlips(); if (송장) L.push(송장); }
  catch (e) { L.push("출고 송장 받아오기 실패: " + e.message); }
  t = _cpr_step_(ss2, 걸음, "출고송장", t, 시작);

  /*  ★ 출고 지연 — 하루치를 나눠 본다 ★  (2026-10-08)
      csOutboundStaleCheck 안에서 어디까지 봤는지를 적어 둔다. 오늘 몫이
      끝났으면 빈 글을 돌려주므로 여기서는 붙이지 않는다. */
  try { var 출고 = csOutboundStaleCheck(); if (출고) L.push(출고); }
  catch (e) { L.push("출고 지연 점검 실패: " + e.message); }
  t = _cpr_step_(ss2, 걸음, "지연점검", t, 시작);

  /*  ★ 집하 누락 점검 ★  (2026-10-10)
      > "실제 집하가 되었는지 확인이 되면 좋을꺼 같아"

      지연 점검과 묻는 것이 다르다 — 저쪽은 「가다가 멈췄나」, 이쪽은
      「애초에 실려 갔나」다. 송장은 찍혔는데 로젠에 스캔이 아예 없으면
      박스가 아직 우리 창고에 있다는 뜻이다.

      ★ 예산 검문 «앞»에 둔다 ★ 뒤에 두면 바쁜 날 조용히 접힌다.
      고객은 송장번호를 받아 기다리고 있으므로 내일 아침으로 밀 일이 아니다.
      한 회차에 400건만 묻고 어디까지 봤는지 적어 두므로 한 걸음이 가볍다.
      (csLogenPickupCheck.gs)                                             */
  try { var 집하 = csLogenPickupCheck(); if (집하) L.push(집하); }
  catch (e) { L.push("집하 누락 점검 실패: " + e.message); }
  t = _cpr_step_(ss2, 걸음, "집하점검", t, 시작);

  /*  ★ 도서·산간 외우기 ★  (2026-10-09)
      로젠에게 «이 지역이 섬이냐»를 물어 세트분리 시트의 표에 적어 둔다.
      세트분리는 그 표를 읽기만 한다 — 회차 중에 부르면 6분 한도를 넘는다.
      하루 새로 생기는 지역이 200~350곳이라 한 시간에 조금씩이면 넉넉하다. */
  /*  ★ 예산을 넘겼으면 여기서 접는다 ★ 조용히 빠지지 않는다 — 건너뛴 것을
      적어 둬야 「돌았습니다」가 거짓말이 안 된다. 이 둘은 머리말이 이미
      «급하지 않다»고 적어 둔 단계다. 내일 아침이 아니라 다음 시간에 돈다. */
  if (_cpr_overBudget_(시작)) {
    걸음.push("도서·산간·계약 건너뜀(시간 " +
              Math.round(_CPR_JOB_BUDGET_MS_ / 60000) + "분 넘김)");
    L.push("도서·산간 외우기와 계약 점검은 시간이 모자라 건너뜁니다 — 다음 시간에 봅니다");
    _cpr_step_(ss2, 걸음, "접음", t, 시작);
  } else {
    try { var 권역 = csLogenZoneLearn(); if (권역) L.push(권역); }
    catch (e) { L.push("도서·산간 외우기 실패: " + e.message); }
    t = _cpr_step_(ss2, 걸음, "도서산간", t, 시작);

  /*  ★ 계약 만료 감시 — 하루 한 번 ★  (2026-10-08)
      맨 뒤에 둔다. 2026-10-02 처럼 계약이 끊기면 위의 조회들이 먼저 실패해
      그 자체로 드러난다. 여기는 «끊기기 전에» 알자고 두는 것이라 급하지 않다. */
    try { var 계약 = csLogenContractWatch(); if (계약) L.push(계약); }
    catch (e) { L.push("계약 점검 실패: " + e.message); }
    t = _cpr_step_(ss2, 걸음, "계약점검", t, 시작);
  }
  var 글 = L.join("\n\n");

  /*  ★ 돌았다는 것을 «읽히는 자리»에 남긴다 ★
      Logger.log 는 편집기를 열어야 보인다. 이 일감은 사람 없이 도는 것이라
      그러면 「돌았나」를 물을 때마다 사람을 불러야 한다.
      트리거 이름은 짐작하지 않고 지금 걸린 것을 그대로 적는다 — 옛 이름이
      남아 있으면 여기서 바로 드러난다.                                */
  try {
    if (!ss2) ss2 = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
    /*  ★ 「돌았습니다」에 «끝까지 갔다»는 뜻을 담는다 ★ 이 줄이 안 적히면
        중간에 죽은 것이고, 「일감 걸음」 줄이 어디까지 갔는지 말해 준다. */
    _cpr_ops_(ss2, "반품 1시간 일감",
      "끝까지 돌았습니다 · " + Math.round((new Date().getTime() - 시작) / 1000) + "초");
    _cpr_ops_(ss2, "지금 걸린 트리거", _cpr_triggerNames_());
  } catch (e) {}

  Logger.log(글);
  return 글;
}

/**
 * 대장을 훑어 «업체가 요청한» 줄을 찾아 실제로 접수한다.
 *
 * @param {Object} opt {days, dry}  dry=true 면 보내지 않고 보기만
 */
function csProcessPickupRequests(opt) {
  opt = opt || {};
  var days = opt.days > 0 ? opt.days : _CPR_DAYS_;
  var dry = !!opt.dry;
  var L = ["── 업체 반품접수 요청 처리 ──"];

  var ss;
  try { ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_); }
  catch (e) { var m = "NG 반품대장을 못 열었습니다: " + e.message; Logger.log(m); return m; }

  var 기준 = new Date();
  기준.setDate(기준.getDate() - days);

  //  ① 요청 줄을 모은다
  var 할것 = [];
  var 탭들 = _cs_listReturnLedgerMonthTabs_(ss);
  for (var t = 0; t < 탭들.length && 할것.length < _CPR_MAX_; t++) {
    var tab = ss.getSheetByName(탭들[t]);
    if (!tab) continue;
    var lastRow = tab.getLastRow();
    if (lastRow < 2) continue;
    var lastCol = Math.max(tab.getLastColumn(), 15);

    var scan = tab.getRange(1, 1, Math.min(lastRow, 40), lastCol).getDisplayValues();
    var hIdx = _cs_findReturnHeaderRow_(scan);
    if (hIdx < 0) continue;
    var col = _cs_mapReturnLedgerCols_(scan[hIdx]);
    if (col.notice < 0) continue;

    var 값 = tab.getRange(hIdx + 2, 1, lastRow - (hIdx + 1), lastCol).getDisplayValues();
    for (var i = 0; i < 값.length; i++) {
      var notice = String(값[i][col.notice] || "");
      if (notice.indexOf(_CPR_REQ_MARK_) === -1) continue;   // 요청이 없다
      if (_CPR_DONE_RE_.test(notice)) continue;              // 이미 처리했다

      if (col.date >= 0) {
        var d = _cpr_date_(값[i][col.date]);
        if (d && d < 기준) continue;
      }
      할것.push({ tabName: 탭들[t], tab: tab, rowNum: hIdx + 2 + i, col: col,
                  name: col.name >= 0 ? String(값[i][col.name] || "").trim() : "" });
      if (할것.length >= _CPR_MAX_) break;
    }
  }

  if (!할것.length) { var 끝0 = L.concat(["요청이 없습니다."]).join("\n"); Logger.log(끝0); return 끝0; }
  L.push("요청 " + 할것.length + "건");

  //  ② 하나씩 접수한다 — 되돌리기 어려운 일이라 건별로 결과를 남긴다
  var 됨 = 0, 안됨 = 0;
  for (var k = 0; k < 할것.length; k++) {
    var it = 할것[k];
    var 어디 = it.tabName + "!" + it.rowNum + (it.name ? "  " + it.name : "");

    if (dry) { L.push("  (연습) " + 어디); 됨++; continue; }

    var res = null, 왜 = "";
    try {
      res = csLotteReturnPickupFromCard({ tab: it.tabName, row: it.rowNum });
    } catch (e) { 왜 = e.message; }

    var 성공 = !!(res && res.ok && ((res.invoices && res.invoices.length) ||
                                    (res.takeNos && res.takeNos.length)));
    if (!왜 && !성공) 왜 = (res && res.error) || "원인 미상";

    /*  ★ 결과를 «반드시» 적는다 ★
        안 적으면 다음 시간에 또 보내고, 또 실패하고, 업체는 영영 모른다.
        [yyMMdd HH:mm CS] 꼴이라야 포털 타임라인에 나간다. */
    var 줄 = 성공
      ? (_CPR_REQ_MARK_.replace("요청", "완료") + "." +
         (res.takeNos && res.takeNos.length ? " 접수번호 " + res.takeNos.join(" ") : "") +
         (res.invoices && res.invoices.length ? " 반품송장 " + res.invoices.join(" ") : ""))
      : ("반품접수 실패 — " + 왜);
    /*  ★ 성공했으면 지난 실패 줄부터 결말을 붙인다 ★ 순서가 중요하다 —
        먼저 고쳐 놓고 그 위에 성공 줄을 더해야, 성공 줄에도 꼬리가 안 붙는다. */
    if (성공) {
      try {
        _cpr_resolveFailCell_(it.tab, it.rowNum, it.col.notice,
          (res.takeNos && res.takeNos.length) ? res.takeNos[0] : "");
      } catch (e) {}
    }
    try { _cpr_note_(it.tab, it.rowNum, it.col.notice, 줄); } catch (e) {}

    if (성공) { 됨++; L.push("  " + 어디 + " → " + 줄); }
    else { 안됨++; L.push("  ★ " + 어디 + " — " + 왜); }
  }

  L.push("");
  L.push("접수 " + 됨 + " · 실패 " + 안됨);
  try { _cpr_ops_(ss, "업체 반품접수 요청", "접수 " + 됨 + " · 실패 " + 안됨); } catch (e) {}
  if (안됨) L.push("★ 실패한 건은 사람이 봐야 합니다 — 업체 화면에도 그 사유가 보입니다");
  var 끝 = L.join("\n");
  Logger.log(끝);
  return 끝;
}

/** 비고에 한 줄 더한다 — 업체도 보게 [yyMMdd HH:mm CS] 를 찍는다 */
function _cpr_note_(tab, rowNum, noticeCol, body) {
  if (noticeCol < 0) return;
  var cell = tab.getRange(rowNum, noticeCol + 1);
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd HH:mm");
  var 줄 = "[" + now + " CS] " + body;
  cell.setValue(_cs_appendNoticeLine_(String(cell.getDisplayValue() || ""), 줄));
}

/**
 * ★ 지난 「반품접수 실패」 줄을 «해결됨»으로 고쳐 적는다 ★  (2026-10-08)
 *
 * ★ 왜 ★
 *   비고는 쌓이기만 한다. 그래서 한 번 실패하면, 나중에 접수가 되어도
 *   실패 줄이 그대로 남는다. CS 카드도 업체 화면도 그 줄을 그대로 보여 준다 —
 *   **둘 다 「실패했다」고 믿는다.**
 *   실제로 그랬다: 2026-10-08 10:12 에 운임 때문에 실패한 건이, 고쳐서 접수된
 *   뒤에도 「거래처계약정보 조회 오류」로 보였다. 사람이 다시 누르면 중복
 *   접수가 나갈 수도 있었다.
 *
 * ★ 지우지 않는다 ★
 *   무슨 일이 있었는지는 남아야 한다. 왜 한 번 실패했는지가 나중에 쓸모 있다.
 *   그래서 그 줄 «뒤에» 결말을 붙인다 — 읽으면 지금 상태를 안다.
 *     [261008 10:12 CS] 반품접수 실패 — … → 해결됨 (접수 261008109134)
 *
 * ★ 이미 붙은 줄은 다시 안 붙인다 ★ 1시간마다 도는 일이라 안 그러면 꼬리가 쌓인다.
 *
 * @return {string} 고친 비고. 고칠 게 없으면 들어온 그대로 (그때는 안 적는다)
 */
function _cpr_resolveFailLines_(notice, 접수번호) {
  var s = String(notice == null ? "" : notice);
  if (!s) return s;
  if (s.indexOf("접수 실패") === -1) return s;

  var 꼬리 = " → 해결됨" + (접수번호 ? " (접수 " + 접수번호 + ")" : "");
  var 줄들 = s.split("\n");
  var 고침 = 0;
  for (var i = 0; i < 줄들.length; i++) {
    if (줄들[i].indexOf("접수 실패") === -1) continue;
    if (줄들[i].indexOf("→ 해결됨") !== -1) continue;   // 이미 붙었다
    줄들[i] = 줄들[i] + 꼬리;
    고침++;
  }
  return 고침 ? 줄들.join("\n") : s;
}

/**
 * 비고에서 실패 줄을 해결됨으로 고치고, 바뀌었을 때만 적는다.
 * 안 바뀌었는데 적으면 1시간마다 시트를 쓸데없이 건드린다.
 */
function _cpr_resolveFailCell_(tab, rowNum, noticeCol, 접수번호) {
  if (noticeCol < 0) return false;
  try {
    var cell = tab.getRange(rowNum, noticeCol + 1);
    var 전 = String(cell.getDisplayValue() || "");
    var 후 = _cpr_resolveFailLines_(전, 접수번호);
    if (후 === 전) return false;
    cell.setValue(후);
    return true;
  } catch (e) { return false; }
}

/** 대장의 날짜 글자 → Date. 못 읽으면 null (그때는 거르지 않는다) */
function _cpr_date_(v) {
  var s = String(v || "").trim();
  if (!s) return null;
  var m = s.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  if (!m) return null;
  var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}
