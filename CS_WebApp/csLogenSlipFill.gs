/**
 * ══════════════════════════════════════════════════════════════
 *  로젠 반품송장 자동 채우기 — 1시간마다
 *
 *  ★ 왜 필요한가 ★
 *    로젠은 **회수 접수 순간에 반품송장을 주지 않는다.** takeNo(접수번호)만 온다.
 *    송장은 로젠이 출력한 뒤에 생기고, 그때 `inquiryReturnStateMulti` 로 나온다
 *    (규격 §8.2 · 2026-10-07 실측 확인).
 *    그래서 접수 직후 대장의 「반품송장」 칸은 비어 있다 — 사람이 나중에
 *    로젠 화면에서 찾아 옮겨 적어야 했다. 그 일을 없앤다.
 *
 *  ★ 원송장으로 묻는다 ★
 *    접수번호(takeNo)는 비고에 글자로 적혀 있어 파싱이 불안하다.
 *    **원송장은 대장의 정식 칸**이라 그것으로 묻는다 —
 *    비고가 지워져도 저절로 복구된다.
 *
 *  ★ 안 건드리는 것 ★
 *    · 이미 반품송장이 적힌 줄은 손대지 않는다
 *    · 로젠 건이 아닌 줄(롯데·CJ…)은 보지 않는다
 *    · 취소된 접수는 송장이 없다(slipNo null) — 비워 둔다
 *    한 줄에 **한 칸만** 쓴다. 대장은 두 앱이 쓴다([[return-ledger-tab-spec]]) —
 *    넓게 쓰면 남의 작업을 덮는다.
 *
 *  ★ 로젠 호출 예절 ★  (담당자 요청 · 2026-09-28)
 *    1회 10건 이내 · 순차 동기 · 호출 간 수 초.
 *    csLogen.gs 의 _LOGEN_BATCH_* 와 같은 값을 쓴다.
 *
 *  쓰는 법
 *    설치:  csInstallLogenSlipFillTrigger()    ← 편집기에서 한 번
 *    끄기:  csUninstallLogenSlipFillTrigger()
 *    손으로: csLogenFillReturnSlips()          ← 지금 한 번 돌려 보기
 *    편집기: https://script.google.com/home/projects/1eTAUhXH2tWBqqDI-36J4QGoKcILo1vP8SKT_O7AB3Mc4aHoj66q_jRe4/edit
 * ══════════════════════════════════════════════════════════════
 */

/** 며칠치까지 거슬러 보나. 그보다 오래된 건은 어차피 송장이 이미 있거나 끝난 건이다. */
var _LSF_DAYS_ = 14;

/** 한 번 실행에서 쓸 시간 예산 — GAS 는 6분에서 잘린다 */
var _LSF_BUDGET_MS_ = 150000;   // 2분 30초

/** 접수하고 이 날수가 지나도 송장이 없으면 ★ 로 표시한다 — 사람이 로젠에 물어볼 신호 */
var _LSF_STALE_DAYS_ = 3;   // 2026-10-08 3 → 2 → 3 (사장님: "움직임이 없는 기준을 3일로")

/**
 * 대장을 훑어 «로젠 건인데 반품송장이 빈» 줄을 찾아 채운다.
 *
 * @param {Object} opt {days:number, dry:boolean}  dry=true 면 적지 않고 보기만
 * @return {string} 사람이 읽는 요약 (실행로그에도 찍는다)
 */
function csLogenFillReturnSlips(opt) {
  /*  ★ 옛 트리거가 돌면 스스로 옮겨 탄다 ★  (2026-10-07)
      2026-10-07 전에 걸어 둔 트리거는 이 함수를 바로 부른다. 그 트리거를 그냥
      두면 «업체 반품접수 요청»을 아무도 집어 가지 않는다 — 요청만 쌓이고
      업체는 영영 기다린다. 코드만 바꿔 놓고 트리거를 안 바꾸면 그렇게 된다.

      그래서 편집기를 열지 않아도 한 시간 안에 저절로 바뀌게 둔다. 트리거를
      «정하는 곳»은 그대로 csInstallLogenSlipFillTrigger 하나다 — 여기서는
      그것을 부르기만 한다([[one-value-one-owner]]).

      되돌이에 빠지지 않는다 — 설치기가 옛 이름 트리거를 지우고 새 이름으로
      다시 걸므로, 다음 번에는 이 가지에 들어오지 않는다. 설치기가 첫판을
      돌리니 이번 시간 몫도 거기서 함께 처리된다. */
  if (!(opt && opt.기존트리거아님)) {
    try {
      var 옛것 = ScriptApp.getProjectTriggers();
      for (var t = 0; t < 옛것.length; t++) {
        if (옛것[t].getHandlerFunction() === "csLogenFillReturnSlips") {
          /*  ★ 옮겨 탄 그 한 번을 «읽히는 자리»에 남긴다 ★
              이것은 한 번만 일어나고, 일어났는지는 「일이 도는 것」으로
              가려지지 않는다 — 옛 트리거도 송장 채우기는 똑같이 한다.
              여기서 안 남기면 편집기 트리거 목록을 여는 수밖에 없다. */
          try {
            _cpr_ops_(SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_),
              "트리거 옮겨탐", "csLogenFillReturnSlips → csReturnHourlyJob");
          } catch (e) {}
          var 옮김 = "옛 트리거를 csReturnHourlyJob 으로 옮겼습니다.\n\n" +
            csInstallLogenSlipFillTrigger();
          Logger.log(옮김);
          return 옮김;
        }
      }
    } catch (e) { /* 트리거를 못 읽어도 제 일은 한다 */ }
  }

  opt = opt || {};
  var days = opt.days > 0 ? opt.days : _LSF_DAYS_;
  var dry = !!opt.dry;
  var 시작 = new Date().getTime();
  var L = ["── 로젠 반품송장 자동 채우기 ──",
           "최근 " + days + "일" + (dry ? "  (연습 — 적지 않습니다)" : "")];

  var ss;
  try {
    ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  } catch (e) {
    var 못엶 = "NG 반품대장을 못 열었습니다: " + e.message;
    Logger.log(못엶); return 못엶;
  }

  var 기준 = new Date();
  기준.setDate(기준.getDate() - days);

  //  ① 채울 줄을 모은다
  var 할것 = [];          // {tabName, tab, rowNum, col, orig}
  var 탭들 = _cs_listReturnLedgerMonthTabs_(ss);
  var 열없는탭 = [];
  var 할것T = [];    // 접수번호(takeNo)로 물어야 하는 줄 — 원송장이 로젠이 아닌 건
  var 열쇠없음 = [];  // 원송장도 접수번호도 없어 조회할 길이 없는 줄

  for (var t = 0; t < 탭들.length && 할것.length < 300; t++) {
    var tab = ss.getSheetByName(탭들[t]);
    if (!tab) continue;
    var lastRow = tab.getLastRow();
    if (lastRow < 2) continue;
    var lastCol = Math.max(tab.getLastColumn(), 15);

    var scan = tab.getRange(1, 1, Math.min(lastRow, 40), lastCol).getDisplayValues();
    var hIdx = _cs_findReturnHeaderRow_(scan);
    if (hIdx < 0) continue;
    var col = _cs_mapReturnLedgerCols_(scan[hIdx]);

    /*  반품송장 열이 없으면 적을 데가 없다. 비고에 흘리지 않는다 —
        이 일은 「칸을 채우는」 일이라, 칸이 없으면 **사람에게 말하고 멈춘다.** */
    if (col.returnInvoice < 0) { 열없는탭.push(탭들[t]); continue; }
    if (col.invoice < 0) continue;

    var 값 = tab.getRange(hIdx + 2, 1, lastRow - (hIdx + 1), lastCol).getDisplayValues();
    for (var i = 0; i < 값.length; i++) {
      var row = 값[i];
      /*  ★ 「비었나」는 칸 전체가 아니라 «번호»로 본다 ★  (2026-10-08)
          이 칸은 「송장번호 / 택배사」 꼴로 쓰인다. 번호 없이 택배사만 적힌 줄이
          실제로 있었다 — 36행의 "/ 로젠택배". 칸 전체로 보면 «차 있다»로 읽혀
          그 줄은 영영 안 채워지고, 지난 실패 줄도 영영 안 고쳐진다.
          쪼개는 자는 _cs_splitLedgerInvoice_ 하나뿐이다 — 새로 짜지 않는다. */
      if (_lsf_hasInvoiceNo_(row[col.returnInvoice])) continue;   // 이미 번호가 있다

      var orig = String(row[col.invoice] || "").replace(/[^0-9]/g, "");
      if (orig.length < 8) continue;                       // 원송장이 없다

      /*  ★ 로젠 건만 ★ 수거입력처가 있으면 그것이 근거다.
          ★ 없으면 «건너뛰지 않는다» ★  (2026-10-08)
            여태 pk 가 비면 indexOf 가 -1 이라 그 줄을 통째로 건너뛰었다.
            그런데 202610 탭에는 「수거입력처」 열이 **아예 없다** —
            「원송장번호 / 택배사」와 「반품송장번호 / 택배사」 둘뿐이다.
            그래서 그 탭에서는 자동 채우기가 **한 줄도 본 적이 없다.**
            같은 전제로 반품접수도 롯데로 가고 있었다(csLotteReturn.gs 의
            _lrt_guessCarrier_ 머리말). 두 곳이 같은 자리에서 틀렸다.
            이제 근거로 가린다 — 판단하는 자는 그 함수 하나다. */
      var pk = String(col.pickup >= 0 ? row[col.pickup] : "").replace(/\s/g, "");
      if (pk) {
        if (pk.indexOf("로젠") === -1) continue;
      } else if (_lsf_guessCarrier_(row[col.returnInvoice], row[col.invoice]) !== "로젠") {
        continue;
      }

      /*  ★ 원송장이 로젠이 아닐 수 있다 — 그래도 정상이다 ★  (2026-10-07)
          > "롯데에서 수거가 안되서 로젠에 수거 요청한거야"

          처음엔 「대장이 어긋났다」고 봤는데 아니었다. 규격 §8.1 을 다시 보면
          `orgnSlipNo` 는 **조건부**다 — 「원송장 번호 없으면 주문번호·거래처코드 필수」.
          즉 **원송장 없이도 접수된다.** 롯데로 나간 건을 로젠으로 돌리는 일은
          실제 업무다(롯데가 수거를 못 갔을 때).

          그런 건은 **원송장으로 물으면 안 나온다.** 로젠이 모르는 송장이니까.
          대신 접수번호(takeNo)로 물어야 한다 — 비고에 적어 둔 그 번호다. */
      if (orig.length !== 11) {
        var 접수번호 = _lsf_takeNoFromMemo_(col.notice >= 0 ? row[col.notice] : "");
        if (접수번호) {
          할것T.push({ tabName: 탭들[t], tab: tab, rowNum: hIdx + 2 + i,
                       col: col, orig: orig, takeNo: 접수번호,
                       //  공지에 올릴 때 사람이 알아보는 칸은 수취인 이름이다
                       name: col.name >= 0 ? String(row[col.name] || "").trim() : "" });
        } else {
          열쇠없음.push(탭들[t] + "!" + (hIdx + 2 + i) + "  원송장 " + orig +
            " (" + orig.length + "자리, 로젠 송장 아님) — 비고에 접수번호가 없어 조회할 길이 없습니다");
        }
        continue;
      }

      //  너무 오래된 줄은 보지 않는다
      if (col.date >= 0) {
        var d = _lsf_date_(row[col.date]);
        if (d && d < 기준) continue;
      }

      할것.push({ tabName: 탭들[t], tab: tab, rowNum: hIdx + 2 + i, col: col, orig: orig,
                 name: col.name >= 0 ? String(row[col.name] || "").trim() : "" });
      if (할것.length >= 300) break;
    }
  }

  if (열없는탭.length) {
    L.push("★ 반품송장 열이 없는 탭: " + 열없는탭.join(", ") +
           "  — csAddReturnInvoiceColumn 으로 열을 먼저 만드세요");
  }
  if (열쇠없음.length) {
    L.push("조회할 열쇠가 없는 줄 " + 열쇠없음.length + "건 — 로젠 화면에서 직접 찾아야 합니다");
    for (var w = 0; w < 열쇠없음.length; w++) L.push("  · " + 열쇠없음[w]);
  }
  if (!할것.length && !할것T.length) {
    L.push("채울 줄이 없습니다.");
    var 끝1 = L.join("\n"); Logger.log(끝1); return 끝1;
  }
  L.push("대상 " + (할것.length + 할것T.length) + "줄" +
         (할것T.length ? "  (원송장 " + 할것.length + " · 접수번호 " + 할것T.length + ")" : ""));

  /*  ② 10건씩 끊어 순차로 묻는다 (로젠 요청)
      ★ 2026-10-07: 「아직없음」으로 뭉뚱그리지 않는다 ★
        처음엔 한 숫자로 뭉쳐 놨더니 «왜 안 채워졌는지»를 알 수가 없었다.
        셋은 뜻이 전혀 다르다 —
          접수없음 : 로젠에 그 원송장의 반품 접수가 «아예 없다» (대장만 로젠인 건)
          송장대기 : 접수는 됐는데 로젠이 아직 송장을 안 뽑았다 (기다리면 된다)
          응답없음 : 물었는데 그 줄이 응답에 안 실려 왔다 (이상 신호)
        줄마다 원송장을 같이 찍어 사람이 바로 로젠 화면에서 찾아볼 수 있게 한다. */
  var 채움 = 0, 접수없음 = 0, 송장대기 = 0, 응답없음 = 0, 취소 = 0, 실패 = 0, 남김 = 0, 오래됨 = 0;
  /*  ★ 「몇 개」가 아니라 «어느 줄»을 모은다 ★  (2026-10-08)
      여태 수만 세어 Logger.log 에 남겼다. 그래서 207 이 5일째 멈춘 것을
      우연히 알았다. 모아서 csStaleReport_ 가 공지 띠에 올린다. */
  var 멈춘것 = [];

  for (var s = 0; s < 할것.length; s += _LOGEN_BATCH_SIZE_) {
    if (s > 0 && (new Date().getTime() - 시작) > _LSF_BUDGET_MS_) {
      남김 = 할것.length - s;
      L.push("시간이 차서 " + 남김 + "줄은 다음 차례로 미룹니다.");
      break;
    }
    if (s > 0) { try { Utilities.sleep(_LOGEN_BATCH_DELAY_MS_); } catch (e) {} }

    var 묶음 = 할것.slice(s, s + _LOGEN_BATCH_SIZE_);
    var body = { userId: _logen_userId_(), data: [] };
    for (var b = 0; b < 묶음.length; b++) {
      body.data.push({ custCd: _logen_custCd_(), orgnSlipNo: 묶음[b].orig });
    }

    var r = _logen_call_("inquiryReturnStateMulti", body);
    if (!r.ok) { 실패 += 묶음.length; L.push("  호출 실패: " + r.error); continue; }

    //  원송장 → 응답 줄
    var 맵 = {};
    var rows = _logen_arr_(r.json && r.json.data);
    for (var q = 0; q < rows.length; q++) {
      var key = String(rows[q].orgnSlipNo || "").replace(/[^0-9]/g, "");
      if (key) 맵[key] = rows[q];
    }

    for (var m = 0; m < 묶음.length; m++) {
      var it = 묶음[m];
      var 어디 = it.tabName + "!" + it.rowNum + "  원송장 " + it.orig;
      var got = 맵[it.orig];

      if (!got) {
        응답없음++;
        L.push("  · " + 어디 + " — 응답에 없음");
        continue;
      }
      if (!_logen_ok_(got.resultCd)) {
        접수없음++;
        L.push("  · " + 어디 + " — 로젠에 반품 접수가 없음" +
               (got.resultMsg ? " (" + got.resultMsg + ")" : ""));
        continue;
      }

      var 접수들 = _logen_arr_(got.data1);
      var 고른 = _lsf_pickSlip_(접수들);

      if (!접수들.length) {
        접수없음++;
        L.push("  · " + 어디 + " — 로젠에 반품 접수가 없음");
        continue;
      }
      if (고른.cancelled && !고른.slipNo) {
        취소++;
        L.push("  · " + 어디 + " — 접수가 취소된 건");
        continue;
      }
      if (!고른.slipNo) {
        송장대기++;
        /*  ★ 오래 멈춘 건을 눈에 띄게 한다 ★  (2026-10-07)
            접수번호 앞 6자리가 접수일(YYMMDD)이다 — 261002111093 → 2026-10-02.
            송장은 보통 집하 전후에 나온다. 며칠이 지나도 「접수」에 멈춰 있으면
            집하를 안 갔거나 로젠이 출력을 안 한 것이다 — **사람이 물어봐야 한다.**
            실제로 그런 건이 있었다(10/02 접수가 10/07 까지 그대로). */
        /*  ★ 접수번호가 나왔으면 그 자체로 「접수됐다」는 뜻이다 ★  (2026-10-08)
            송장이 나올 때까지 기다리면, 그 사이 내내 비고에 「반품접수 실패」가
            남아 CS 와 업체가 실패로 믿는다. 접수된 것을 안 순간 고쳐 적는다.
            (처음엔 송장 적을 때만 고치게 했다가, 202610!36 이 접수 상태로
             멈춰 있어 영영 안 고쳐지는 것을 보고 여기로 옮겼다.) */
        if (고른.takeNo) {
          try { _cpr_resolveFailCell_(it.tab, it.rowNum, it.col.notice, 고른.takeNo); }
          catch (e) {}
        }
        var 며칠 = _lsf_ageFromTakeNo_(고른.takeNo);
        var 늦음 = (며칠 !== null && 며칠 >= _LSF_STALE_DAYS_);
        if (늦음) { 오래됨++; 멈춘것.push({ 어디: 어디, 이름: it.name || "",
          takeNo: 고른.takeNo || "", 며칠: 며칠, 상태: 고른.statNm || "" }); }
        L.push((늦음 ? "  ★ " : "  · ") + 어디 + " — 접수는 됐으나 송장 대기" +
               (고른.statNm ? " (" + 고른.statNm + ")" : "") +
               (고른.takeNo ? " · 접수번호 " + 고른.takeNo : "") +
               (며칠 !== null ? " · " + 며칠 + "일째" : "") +
               (늦음 ? "  ← 로젠에 확인 필요" : ""));
        continue;
      }

      if (dry) {
        L.push("  (연습) " + it.tabName + "!" + it.rowNum + "  " + it.orig + " → " + 고른.slipNo);
        채움++;
        continue;
      }
      try {
        /*  ★ 다시 한 번 비었는지 보고 적는다 ★
            모으고 나서 여기까지 오는 사이에 사람이 적었을 수 있다.
            덮어쓰면 사람이 적은 값이 조용히 사라진다. */
        var cell = it.tab.getRange(it.rowNum, it.col.returnInvoice + 1);
        if (_lsf_hasInvoiceNo_(cell.getDisplayValue())) { L.push("  · " + 어디 + " — 그 사이 사람이 적었음, 두고 감"); continue; }
        cell.setValue(고른.slipNo);
        채움++;
        /*  ★ 송장이 붙었으면 지난 「접수 실패」는 더 이상 사실이 아니다 ★
            그대로 두면 CS 카드도 업체 화면도 실패로 보인다(csPickupRequests.gs
            _cpr_resolveFailLines_ 머리말). 2026-10-08 에 실제로 그랬다. */
        try { _cpr_resolveFailCell_(it.tab, it.rowNum, it.col.notice, 고른.takeNo || ""); }
        catch (e) {}
        L.push("  " + it.tabName + "!" + it.rowNum + "  " + it.orig + " → " + 고른.slipNo);
      } catch (e) {
        실패++;
        L.push("  ★ 못 적음 " + it.tabName + "!" + it.rowNum + " — " + e.message);
      }
    }
  }

  /*  ③ 접수번호로 물어야 하는 줄 — 원송장이 로젠이 아닌 건
      (롯데가 수거를 못 가서 로젠으로 돌린 건 따위) */
  for (var u = 0; u < 할것T.length; u += _LOGEN_BATCH_SIZE_) {
    if ((new Date().getTime() - 시작) > _LSF_BUDGET_MS_) {
      남김 += 할것T.length - u;
      L.push("시간이 차서 접수번호 조회 " + (할것T.length - u) + "줄은 다음 차례로 미룹니다.");
      break;
    }
    try { Utilities.sleep(_LOGEN_BATCH_DELAY_MS_); } catch (e) {}

    var 묶음T = 할것T.slice(u, u + _LOGEN_BATCH_SIZE_);
    var bodyT = { userId: _logen_userId_(), data: [] };
    for (var c2 = 0; c2 < 묶음T.length; c2++) {
      bodyT.data.push({ custCd: _logen_custCd_(), takeNo: 묶음T[c2].takeNo });
    }

    var rT = _logen_call_("inquiryReserveStateMulti", bodyT);
    if (!rT.ok) { 실패 += 묶음T.length; L.push("  호출 실패(접수번호): " + rT.error); continue; }

    var 맵T = {};
    var rowsT = _logen_arr_(rT.json && rT.json.data);
    for (var q2 = 0; q2 < rowsT.length; q2++) {
      var k2 = String(rowsT[q2].takeNo || "").trim();
      if (k2) 맵T[k2] = rowsT[q2];
    }

    for (var n2 = 0; n2 < 묶음T.length; n2++) {
      var itT = 묶음T[n2];
      var 어디T = itT.tabName + "!" + itT.rowNum + "  접수번호 " + itT.takeNo +
                  " (원송장 " + itT.orig + ")";
      var gotT = 맵T[itT.takeNo];
      if (!gotT || !_logen_ok_(gotT.resultCd)) {
        접수없음++;
        L.push("  · " + 어디T + " — 로젠에 그 접수번호가 없음");
        continue;
      }
      var 본 = _lsf_byTakeNo_(gotT);
      if (본.cancelled && !본.slipNo) { 취소++; L.push("  · " + 어디T + " — 취소된 접수"); continue; }
      if (!본.slipNo) {
        송장대기++;
        if (itT.takeNo) {
          try { _cpr_resolveFailCell_(itT.tab, itT.rowNum, itT.col.notice, itT.takeNo); }
          catch (e) {}
        }
        var 며칠T = _lsf_ageFromTakeNo_(itT.takeNo);
        var 늦음T = (며칠T !== null && 며칠T >= _LSF_STALE_DAYS_);
        if (늦음T) { 오래됨++; 멈춘것.push({ 어디: 어디T, 이름: itT.name || "",
          takeNo: itT.takeNo || "", 며칠: 며칠T, 상태: "상태코드 " + 본.statCode }); }
        L.push((늦음T ? "  ★ " : "  · ") + 어디T + " — 송장 대기 (상태코드 " + 본.statCode + ")" +
               (며칠T !== null ? " · " + 며칠T + "일째" : "") +
               (늦음T ? "  ← 로젠에 확인 필요" : ""));
        continue;
      }
      if (dry) { L.push("  (연습) " + 어디T + " → " + 본.slipNo); 채움++; continue; }
      try {
        var cellT = itT.tab.getRange(itT.rowNum, itT.col.returnInvoice + 1);
        if (_lsf_hasInvoiceNo_(cellT.getDisplayValue())) {
          L.push("  · " + 어디T + " — 그 사이 사람이 적었음, 두고 감"); continue;
        }
        cellT.setValue(본.slipNo);
        채움++;
        try { _cpr_resolveFailCell_(itT.tab, itT.rowNum, itT.col.notice, itT.takeNo || ""); }
        catch (e) {}
        L.push("  " + 어디T + " → " + 본.slipNo);
      } catch (e) {
        실패++;
        L.push("  ★ 못 적음 " + 어디T + " — " + e.message);
      }
    }
  }

  L.push("");
  L.push("채움 " + 채움 + " · 접수없음 " + 접수없음 + " · 송장대기 " + 송장대기 +
         " · 취소건 " + 취소 + " · 응답없음 " + 응답없음 +
         " · 실패 " + 실패 + (남김 ? " · 미룸 " + 남김 : ""));
  if (오래됨) L.push("★ " + _LSF_STALE_DAYS_ + "영업일 넘게 송장이 안 나온 건 " + 오래됨 + "개 — 로젠에 확인하세요");

  /*  ★ 사람이 보는 곳에 올린다 ★  (csLogenStale.gs)
      연습(dry)이나 공지안함 일 때는 띠를 건드리지 않는다 — 손으로 돌려 보는
      것 때문에 실제 공지가 바뀌면 안 된다. */
  if (!dry && !opt["공지안함"]) {
    try { L.push(csStaleReport_(멈춘것)); }
    catch (e) { L.push("★ 공지 처리 실패: " + e.message); }
  }
  var 끝 = L.join("\n");
  Logger.log(끝);
  return 끝;
}

/**
 * 접수 여러 건 중 «쓸 송장» 하나를 고른다.
 *
 * 한 원송장에 접수가 여러 번 있을 수 있다(취소하고 다시 접수).
 * 취소된 것은 송장이 없다 — 살아 있는 것 중 송장이 붙은 마지막 것을 쓴다.
 */
function _lsf_pickSlip_(list) {
  var out = { slipNo: "", takeNo: "", statNm: "", cancelled: false };
  for (var i = 0; i < list.length; i++) {
    var nm = String(list[i].resvStatNm || "");
    var slip = String(list[i].slipNo || "").replace(/[^0-9]/g, "");
    if (nm.indexOf("취소") !== -1) { out.cancelled = true; continue; }
    out.takeNo = String(list[i].takeNo || out.takeNo);
    out.statNm = nm || out.statNm;
    if (slip) { out.slipNo = slip; out.takeNo = String(list[i].takeNo || ""); }
  }
  return out;
}

/** 대장의 날짜 글자 → Date. 못 읽으면 null (그때는 거르지 않는다) */
function _lsf_date_(v) {
  var s = String(v || "").trim();
  if (!s) return null;
  var m = s.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  if (!m) return null;
  var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

// ── 트리거 ──────────────────────────────────────────────
/**
 * 편집기에서 한 번 실행 — **1시간마다** 돌게 한다.
 *
 * ★ 트리거 자리는 넉넉하지 않다 ★  스무 자리 중 둘은 이어달리기(.after) 몫이다
 * ([[gas-trigger-slots-reserve-two]]). 그래서 설치하기 전에 남은 자리를 센다.
 */
function csInstallLogenSlipFillTrigger() {
  var all = ScriptApp.getProjectTriggers();
  var 내것 = 0;
  for (var i = 0; i < all.length; i++) {
    /*  ★ 옛 이름까지 쓸어낸다 ★  (2026-10-07)
        2026-10-07 전에는 트리거가 csLogenFillReturnSlips 를 바로 불렀다.
        그 이름만 남겨 두면 둘이 겹쳐 돌아 **송장 조회가 한 시간에 두 번** 나간다.
        로젠은 1회 10건·호출 간 수 초를 요청했으니 겹치면 안 된다.
        갈래를 남기지 않는다 — 트리거는 csReturnHourlyJob «하나»다.          */
    var h = all[i].getHandlerFunction();
    if (h === "csReturnHourlyJob" || h === "csLogenFillReturnSlips") {
      ScriptApp.deleteTrigger(all[i]); 내것++;
    }
  }
  var 남은 = all.length - 내것;
  if (남은 >= 18) {
    var 꽉 = "★ 트리거 자리가 모자랍니다 — 지금 " + 남은 + "개.\n" +
      "스무 자리 중 둘은 이어달리기(.after) 몫이라 18개까지만 씁니다.\n" +
      "안 쓰는 트리거를 먼저 지우세요.";
    Logger.log(꽉); return 꽉;
  }

  ScriptApp.newTrigger("csReturnHourlyJob").timeBased().everyHours(1).create();
  var 첫판 = csReturnHourlyJob();
  var msg = "✅ 반품 1시간 일감 — 업체 요청 접수 → 송장 채우기.\n\n" + 첫판 +
    "\n\n트리거 " + ScriptApp.getProjectTriggers().length + "개";
  Logger.log(msg);
  return msg;
}

/** 끄기 */
function csUninstallLogenSlipFillTrigger() {
  var all = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < all.length; i++) {
    var h = all[i].getHandlerFunction();
    if (h === "csReturnHourlyJob" || h === "csLogenFillReturnSlips") {
      ScriptApp.deleteTrigger(all[i]); n++;
    }
  }
  var msg = "로젠 반품송장 자동 채우기 트리거 " + n + "개를 껐습니다. " +
    "(남은 트리거 " + ScriptApp.getProjectTriggers().length + "개)";
  Logger.log(msg);
  return msg;
}

/**
 * 접수번호에서 «며칠 지났나»를 센다.
 * 접수번호 앞 6자리가 접수일(YYMMDD)이다 — 261002111093 → 2026-10-02.
 * 모양이 다르면 null (그때는 재촉하지 않는다).
 */
function _lsf_ageFromTakeNo_(takeNo) {
  var s = String(takeNo || "").replace(/[^0-9]/g, "");
  if (s.length < 6) return null;
  var y = 2000 + parseInt(s.substring(0, 2), 10);
  var m = parseInt(s.substring(2, 4), 10);
  var d = parseInt(s.substring(4, 6), 10);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  var t = new Date(y, m - 1, d);
  if (isNaN(t.getTime())) return null;
  /*  ★ 달력이 아니라 영업일로 센다 ★  (2026-10-08)
      > 사장님: "연휴 주말도 판단해서 날짜 기준을 잡아줘.. 금요일부터 연휴야.."
      금요일에 접수한 건은 토·일·연휴에 집하가 안 간다. 달력으로 세면 월요일
      아침에 금요일 치가 통째로 「2일째 멈춤」으로 뜬다. 한 번 그러면 그 뒤로
      아무도 이 공지를 안 본다.
      셈은 csLogenOutStale.gs 의 _ost_bizSince_ 한 곳에만 둔다 — 두 벌이면
      연말에 한쪽만 고쳐진다([[one-value-one-owner]]). */
  var 일;
  try { 일 = _ost_bizSince_(t); }
  catch (e) { 일 = Math.floor((new Date().getTime() - t.getTime()) / 86400000); }
  return 일 >= 0 && 일 < 400 ? 일 : null;
}

/**
 * 수거입력처가 없을 때 택배사를 근거로 가린다.
 *
 * 판단하는 자는 csLotteReturn.gs 의 _lrt_guessCarrier_ 하나다 — 여기서 새로
 * 짜지 않는다([[one-value-one-owner]]). 그것이 없으면 자릿수로 물러선다
 * (롯데 12자리 · 로젠 11자리).
 */
function _lsf_guessCarrier_(반품송장칸, 원송장칸) {
  try {
    if (typeof _lrt_guessCarrier_ === "function") {
      return _lrt_guessCarrier_(반품송장칸, 원송장칸);
    }
  } catch (e) {}
  return String(원송장칸 == null ? "" : 원송장칸).replace(/[^0-9]/g, "").length === 12
    ? "롯데" : "로젠";
}

/**
 * 그 칸에 «송장번호»가 있나. 택배사만 적힌 것은 없는 것으로 본다.
 *
 * 대장의 반품송장 칸은 「번호 / 택배사」 꼴이라 "/ 로젠택배" 처럼 번호 없이
 * 택배사만 남는 일이 있다(2026-10-08 · 202610!36). 칸이 비었는지로 보면
 * 그런 줄은 «차 있다»로 읽혀 영영 안 채워진다 — 모르는 것과 비어 있는 것은 다르다
 * ([[dont-overwrite-what-you-couldnt-read]] 의 뒤집힌 꼴이다).
 *
 * 쪼개는 자는 _cs_splitLedgerInvoice_ 한 곳이다. 없으면 숫자로 물러선다.
 */
function _lsf_hasInvoiceNo_(cell) {
  var raw = String(cell == null ? "" : cell);
  if (!raw.trim()) return false;
  try {
    if (typeof _cs_splitLedgerInvoice_ === "function") {
      return !!String(_cs_splitLedgerInvoice_(raw).번호 || "").trim();
    }
  } catch (e) { /* 아래 숫자 보기로 물러선다 */ }
  return raw.replace(/[^0-9]/g, "").length >= 8;
}

/**
 * 비고에서 로젠 접수번호(takeNo)를 꺼낸다.
 *
 * 화면(lrtConfirm)이 「로젠접수 261007105757」 꼴로 적어 둔다 —
 * takeNo 는 12자리라 「반품송장」 칸에 넣으면 롯데 송장과 구분이 안 돼
 * 비고로 흘린 값이다([[return-ledger-tab-spec]] 의 「칸이 없으면 비고로」).
 *
 * 사람이 손으로 적은 것도 집는다 — 「로젠접수번호: 261002111093」 같은 것.
 * 여럿이면 **마지막 것**을 쓴다. 다시 접수한 건이 뒤에 붙기 때문이다.
 */
function _lsf_takeNoFromMemo_(memo) {
  var s = String(memo || "");
  if (!s) return "";
  var re = /로젠\s*접수(?:번호)?\s*[:：]?\s*(\d{10,14})/g;
  var got = "", m;
  while ((m = re.exec(s)) !== null) got = m[1];
  return got;
}

/**
 * 접수번호로 묻는다 — `inquiryReserveStateMulti` (규격 §8.2)
 *
 * ★ 원송장 기준 조회와 «응답 모양이 다르다» ★
 *   원송장 기준(inquiryReturnStateMulti)은 상태를 **한글 명칭**(resvStatNm)으로 주는데
 *   이쪽은 **코드**(resvStat)로 준다. 20 이 접수취소다.
 *   규격서가 「혼용 주의」라고 못 박아 둔 그 자리다.
 *
 * @return {{slipNo, statCode, cancelled}}
 */
function _lsf_byTakeNo_(row) {
  var code = String(row.resvStat == null ? "" : row.resvStat).trim();
  var slip = String(row.slipNo || "").replace(/[^0-9]/g, "");
  return {
    slipNo: slip,
    statCode: code,
    //  20 = 접수취소 (코드표) · 030 은 취소 API 응답값이라 여기선 안 오지만 같이 본다
    cancelled: code === "20" || code === "030"
  };
}
