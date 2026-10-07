/**
 * ══════════════════════════════════════════════════════════════
 *  도서산간 — 로젠에게도 물어보고 «맞대본다»
 *
 *  ★ 바꾸는 게 아니다. 견주는 것이다 ★  (2026-10-07)
 *    지금 판정(_partnerIslandJudge.gs)은 **손도 안 댄다.**
 *    로젠 답을 «옆 칸»에 같이 적어 두고, 며칠 돌려 다른 줄이 나오는지 본다.
 *    매일 도는 일이라 한 번에 갈아탔다가 틀리면 출고가 멈춘다.
 *    다른 것이 안 나오면 그때 기존 것을 끄고 로젠만 쓴다.
 *
 *  ★ 왜 로젠에게 묻나 ★
 *    지금은 「도선료표 → 카카오로 우편번호 → 마스터 표」 세 단계를 거친다.
 *    표에 없는 주소는 **「도서산간미확인」으로 선다** — 그 찌꺼기가 메모에
 *    「판단 대기」로 쌓여 있었다(강화·태안·사천 곤양·보성 벌교·부안).
 *
 *    로젠은 주소를 주면 **항상** 제주/연륙도서/산간을 답한다. 미확인이 없다.
 *    그리고 그것이 **로젠이 실제로 과금하는 기준** 그 자체다.
 *
 *    섬은 군 단위로 갈리지 않는다 — 2026-10-07 확인:
 *      강화 읍내 일반 · 강화 교동도 도서 · 강화 석모도 도서 · 태안 안면도 일반
 *
 *  ★ 로젠은 «섬이냐»만 답한다 ★
 *    금액도 권역도 안 준다. 도선료 5,000원 통일과 _island_lineFee_ 계산은
 *    우리 정책이라 그대로 쓴다([[ferry-fee-flat-5000]]).
 *
 *  ★ 곁다리다 ★
 *    실패해도 발주 수집도, 기존 판정도 건드리지 않는다. 조용히 넘어간다.
 *
 *  손으로 보기: partnerCompareIslandWithLogen()
 * ══════════════════════════════════════════════════════════════
 */

/** 허브에서 맞대볼 열 이름 — 없으면 맨 뒤에 만든다 */
var _ISL_COL_NAME_ = "로젠판정";

/** 한 번에 맞대볼 줄 수. 전수가 아니어도 된다 — 다른 줄만 찾으면 되는 일이다. */
var _ISL_MAX_ = 100;

/** 로젠 예절 — 1회 10건, 호출 간 2초 (담당자 요청) */
var _ISL_CHUNK_ = 10;
var _ISL_DELAY_MS_ = 2000;

/** 이 시간을 넘기면 남은 줄은 다음 차례로 미룬다 */
var _ISL_BUDGET_MS_ = 60000;   // 1분

// ── 로젠에게 묻기 ────────────────────────────────────────
/**
 * 주소 여러 개를 중계기를 거쳐 로젠에게 묻는다.
 *
 * ★ 중계기를 쓰는 까닭 ★
 *   로젠은 등록된 공인 IP 에서 온 호출만 받는다. Apps Script 는 고정 IP 가 없다
 *   (발신이 구글 대역에서 유동 배정, PTR 도 없음). 그래서 siot.com 이 대신 부른다.
 *   **인증키는 중계기에만** 있다 — 여기서는 프록시 토큰만 보낸다.
 *
 * @return {Object} { 주소: {jeju, ship, mont, zip, zone} }  못 물은 주소는 없다
 */
function _isl_askLogen_(addrs) {
  var out = {};
  var list = addrs || [];
  if (!list.length) return out;

  var url = (typeof LOGEN_PROXY_URL === "string") ? LOGEN_PROXY_URL : "";
  var token = (typeof LOGEN_PROXY_TOKEN === "string") ? LOGEN_PROXY_TOKEN : "";
  var userId = (typeof LOGEN_USER_ID === "string" && LOGEN_USER_ID) ? LOGEN_USER_ID : "30556066";
  var custCd = (typeof LOGEN_CUST_CD === "string" && LOGEN_CUST_CD) ? LOGEN_CUST_CD : "30556066";
  if (!url || !token) return out;     // 설정이 없으면 조용히 넘어간다 — 곁다리다

  var 시작 = new Date().getTime();

  for (var s = 0; s < list.length; s += _ISL_CHUNK_) {
    if (s > 0) {
      if ((new Date().getTime() - 시작) > _ISL_BUDGET_MS_) break;   // 남은 줄은 다음에
      try { Utilities.sleep(_ISL_DELAY_MS_); } catch (e) {}
    }
    var 묶음 = list.slice(s, s + _ISL_CHUNK_);
    var body = { api: "integratedInquiry", env: "prod",
                 body: { userId: userId, data: [] } };
    for (var i = 0; i < 묶음.length; i++) body.body.data.push({ custCd: custCd, addr: 묶음[i] });

    var res;
    try {
      res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json;charset=UTF-8",
        headers: { "X-Proxy-Token": token },
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
    } catch (e) { continue; }          // 한 묶음 실패해도 나머지는 계속
    if (res.getResponseCode() !== 200) continue;

    var j = null;
    try { j = JSON.parse(res.getContentText("UTF-8")); } catch (e) { continue; }
    var rows = (j && j.data) || [];
    if (!rows.length || !rows.length) continue;

    /*  ★ 응답은 보낸 차례 그대로 온다 ★ 주소로 짝을 짓지 않는다 —
        로젠이 주소를 «정제해서» 돌려주기 때문에 보낸 글자와 다를 수 있다.
        (예: "강화읍 관청리 1" → 우편번호 23030 기준 주소) */
    for (var k = 0; k < 묶음.length && k < rows.length; k++) {
      var d = rows[k] || {};
      var jeju = String(d.jejuRegYn || "") === "Y";
      var ship = String(d.shipYn || "") === "Y";
      var mont = String(d.montYn || "") === "Y";
      out[묶음[k]] = {
        jeju: jeju, ship: ship, mont: mont,
        zip: String(d.zipCd || ""),
        섬: (jeju || ship || mont),
        zone: _isl_label_(jeju, ship, mont)
      };
    }
  }
  return out;
}

/** 세 깃발을 사람이 읽는 한 마디로 */
function _isl_label_(jeju, ship, mont) {
  var w = [];
  if (jeju) w.push("제주");
  if (ship) w.push("연륙도서");
  if (mont) w.push("산간");
  return w.length ? w.join("·") : "일반";
}

// ── 허브에 맞대어 적기 ───────────────────────────────────
/**
 * 허브의 「판정」 칸과 로젠 답을 견주어 「로젠판정」 칸에 적는다.
 *
 * @param {boolean} quiet 조용히 (발주 수집 안에서 부를 때)
 * @return {{본:number, 같음:number, 다름:number, 글:string}}
 */
function partnerCompareIslandWithLogen(quiet) {
  var 결과 = { 본: 0, 같음: 0, 다름: 0, 남김: 0, 글: "" };
  var L = ["── 도서산간 맞대기 (기존 ↔ 로젠) ──"];

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { 결과.글 = "다른 작업 중이라 건너뜀"; return 결과; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
    if (!hubTab || hubTab.getLastRow() < 2) { 결과.글 = "허브가 비었습니다"; return 결과; }

    var lc = hubTab.getLastColumn();
    var hdr = hubTab.getRange(1, 1, 1, lc).getDisplayValues()[0];
    var judgeCol = _isj_judgeCol_(hubTab, hdr);
    var mineCol = _isl_ensureCol_(hubTab, hdr);
    var c = _isj_hubCols_(hdr);

    var lr = _isj_lastRow_(hubTab);
    if (lr < 2) { 결과.글 = "허브에 주문이 없습니다"; return 결과; }
    var n = lr - 1;

    var data = hubTab.getRange(2, 1, n, Math.max(16, hubTab.getLastColumn())).getValues();
    var judgeVals = hubTab.getRange(2, judgeCol, n, 1).getDisplayValues();
    var mineVals = hubTab.getRange(2, mineCol, n, 1).getValues();

    /*  기존 판정이 «이미 적힌» 줄만 본다 — 맞대는 일이라 한쪽만 있으면 의미가 없다.
        그리고 로젠 칸이 아직 빈 줄만. 한 번 적은 것은 다시 묻지 않는다. */
    var 볼 = [];
    for (var r = 0; r < n; r++) {
      if (String(mineVals[r][0] || "").trim()) continue;
      var mine = String(judgeVals[r][0] || "").trim();
      if (!mine) continue;
      var addr = _isj_normAddr_(data[r][c.addr]);
      if (!addr) continue;
      볼.push({ r: r, addr: addr, mine: mine });
    }
    if (볼.length > _ISL_MAX_) {
      결과.남김 = 볼.length - _ISL_MAX_;
      볼 = 볼.slice(볼.length - _ISL_MAX_);     // 새것(아래쪽)부터
    }
    if (!볼.length) { 결과.글 = "맞대볼 줄이 없습니다"; return 결과; }

    //  같은 주소를 두 번 묻지 않는다
    var 목록 = [], 봤 = {};
    볼.forEach(function (x) { if (!봤[x.addr]) { 봤[x.addr] = 1; 목록.push(x.addr); } });

    var 답 = _isl_askLogen_(목록);

    var 다른줄 = [];
    볼.forEach(function (x) {
      var a = 답[x.addr];
      if (!a) return;                       // 못 물은 줄은 비워 둔다 — 다음에 다시 본다
      결과.본++;
      /*  기존 판정 글자에서 「섬이냐」만 뽑는다. 우리 쪽은 「섬 · 일반 · 도서산간미확인 …」
          처럼 말이 여럿이라, 일반/미확인이 아니면 섬으로 본다. */
      var 우리섬 = !/일반/.test(x.mine) && !/미확인/.test(x.mine);
      var 같나 = (우리섬 === a.섬);
      if (같나) 결과.같음++; else 결과.다름++;

      mineVals[x.r][0] = (같나 ? "" : "★ ") + a.zone + (a.zip ? " (" + a.zip + ")" : "");
      if (!같나) {
        다른줄.push((x.r + 2) + "행  우리「" + x.mine + "」 ↔ 로젠「" + a.zone + "」  " +
                   x.addr.slice(0, 34));
      }
    });

    hubTab.getRange(2, mineCol, n, 1).setValues(mineVals);
    SpreadsheetApp.flush();

    L.push("맞대봄 " + 결과.본 + "줄 · 같음 " + 결과.같음 + " · **다름 " + 결과.다름 + "**" +
           (결과.남김 ? " · 다음에 " + 결과.남김 : ""));
    if (다른줄.length) {
      L.push("");
      L.push("다른 줄 — 어느 쪽이 맞는지 보고 정합니다:");
      for (var q = 0; q < 다른줄.length && q < 30; q++) L.push("  " + 다른줄[q]);
      if (다른줄.length > 30) L.push("  … 그 밖 " + (다른줄.length - 30) + "줄");
    }
    결과.글 = L.join("\n");
    Logger.log(결과.글);
    if (!quiet) {
      try { SpreadsheetApp.getUi().alert("🏝️ 도서산간 맞대기", 결과.글, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
    }
    return 결과;
  } catch (e) {
    결과.글 = "맞대기 실패: " + e.message;
    Logger.log(결과.글);
    return 결과;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 「로젠판정」 열이 없으면 맨 뒤에 만든다 */
function _isl_ensureCol_(hubTab, hdr) {
  for (var i = 0; i < hdr.length; i++) {
    if (String(hdr[i] || "").replace(/\s/g, "") === _ISL_COL_NAME_) return i + 1;
  }
  var col = hubTab.getLastColumn() + 1;
  hubTab.getRange(1, col).setValue(_ISL_COL_NAME_)
        .setFontWeight("bold").setHorizontalAlignment("center");
  hubTab.setColumnWidth(col, 150);
  return col;
}
