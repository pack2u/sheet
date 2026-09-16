/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장 → v2 밤 미러
 *  파일: _partnerReturnsV2Mirror.gs
 *  ★ 2026-09-09 신규
 *
 *  > "2번으로 해줘"  (매일 밤 미러를 붙인다)
 *
 *  ★ 왜 있나 ★
 *    v2 의 반품대장은 2026-09-07 에 한 번 옮겨 놓은 스냅샷이었고, 그 뒤로
 *    아무것도 안 따라와 9/4 에서 멈춰 있었다 — 시트 26줄 vs v2 17줄.
 *    협력업체가 포털로 접수해도 v2 에는 안 나타났다.
 *
 *  ★ 여기서는 아무것도 해석하지 않는다 ★
 *    탭 이름과 **시트에 보이는 값** 그대로 보낸다. 머리글이 몇 번째 줄인지,
 *    어느 열이 무엇인지, 업체명·날짜·금액을 어떻게 읽는지 — 판단은 전부
 *    v2 가 한다 (app/src/lib/returns-ingest/).
 *
 *    이렇게 나눈 이유가 있다. 대장 머리글은 사람이 계속 고친다 —
 *    9월에도 D열이 「업체명」 → 「주문지」로 바뀌고 H열이 하나 끼어들었다.
 *    양쪽에 규칙이 있으면 한쪽이 늦게 고쳐지고, **늦은 쪽이 조용히 틀린다.**
 *    실제로 그 일로 협력업체가 반품 접수를 못 했다.
 *
 *  ★ getDisplayValues 를 쓴다 ★
 *    getValues 를 쓰면 날짜가 Date 객체가 되고 송장 앞자리 0 이 사라진다.
 *    보이는 그대로가 원문이다.
 *
 *  ★ 절대 원래 흐름을 막지 않는다 ★
 *    미러가 실패해도 대장은 이미 적혔다. 여기서 예외를 올리면
 *    「따라가려고 붙인 것」이 운영을 죽인다. 전부 삼키고 로그만 남긴다.
 *    _partnerSupabaseV2Mirror.gs 와 같은 판단이다.
 *
 *  ★ 끄는 법 ★
 *    스크립트 속성 RETURNS_MIRROR = off  → 즉시 멈춘다. 코드를 안 고쳐도 된다.
 * ══════════════════════════════════════════════════════════════
 */

/** 반품관리대장. CS 웹앱 _CS_RETURN_LEDGER_ID_ · 포털 PRP_LEDGER_ID 와 같은 파일이다. */
var _PRV_LEDGER_ID_ = "1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU";

var _PRV_OFF_PROP_ = "RETURNS_MIRROR";
var _PRV_PATH_ = "/api/returns/ingest";

/**
 * 매일 밤 보낼 개월 수. 2 = 이번 달 + 지난달.
 * 옛 달은 안 바뀐다. 매일 3천 줄을 보내면 시간만 쓰고, 6분 제한에 걸리면
 * 그날 미러가 통째로 빠진다. 지난달을 같이 보내는 것은 월초에 전달 건이
 * 뒤늦게 고쳐지기 때문이다.
 */
var _PRV_MONTHS_ = 2;

/** 한 번에 보낼 줄 수. v2 쪽 MAX_ROWS(5000)와 맞춘다. */
var _PRV_MAX_ROWS_ = 5000;

function _prv_enabled_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(_PRV_OFF_PROP_);
    if (String(v || "").toLowerCase() === "off") {
      Logger.log("[반품미러] 속성 " + _PRV_OFF_PROP_ + "=off — 건너뜁니다");
      return false;
    }
  } catch (e) {}
  return true;
}

/** v2 주소. _secrets.gs 의 V2_URL 한 곳에서 온다. */
function _prv_url_() {
  var u = "";
  try { if (typeof V2_URL !== "undefined" && V2_URL) u = String(V2_URL); } catch (e) {}
  if (!u) {
    try { u = PropertiesService.getScriptProperties().getProperty("V2_URL") || ""; } catch (e) {}
  }
  return u.replace(/\/+$/, "");
}

/** 문을 여는 토큰. 명세서 받기와 같은 것을 쓴다. */
function _prv_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || ""; } catch (e) {}
  return "";
}

/**
 * 최근 몇 달치 반품대장을 v2 로 보낸다.
 *
 * @param {number=} months 기본 _PRV_MONTHS_
 * @returns {{ok:boolean, sent:number, saved:number, msg:string}}
 */
function partnerMirrorReturnsToV2(months) {
  if (!_prv_enabled_()) return { ok: true, sent: 0, saved: 0, msg: "꺼져 있음" };

  var url = _prv_url_();
  var token = _prv_token_();
  if (!url || !token) {
    Logger.log("[반품미러] v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)");
    return { ok: false, sent: 0, saved: 0, msg: "설정 없음" };
  }

  var tabs;
  try {
    tabs = _prv_readTabs_(months || _PRV_MONTHS_);
  } catch (e) {
    Logger.log("[반품미러] 대장을 못 읽었습니다: " + (e && e.message ? e.message : e));
    return { ok: false, sent: 0, saved: 0, msg: "읽기 실패" };
  }

  var total = 0;
  for (var i = 0; i < tabs.length; i++) total += Math.max(0, tabs[i].values.length - 1);
  if (!total) {
    Logger.log("[반품미러] 보낼 줄이 없습니다");
    return { ok: true, sent: 0, saved: 0, msg: "보낼 것 없음" };
  }

  var groups = _prv_split_(tabs, _PRV_MAX_ROWS_);
  var saved = 0, errs = [];

  for (var g = 0; g < groups.length; g++) {
    var res;
    try {
      res = UrlFetchApp.fetch(url + _PRV_PATH_, {
        method: "post",
        contentType: "application/json",
        headers: { "x-ingest-token": token },
        payload: JSON.stringify({
          exportedAt: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
          tabs: groups[g],
        }),
        muteHttpExceptions: true,
      });
    } catch (eF) {
      errs.push(String(eF.message || eF).substring(0, 160));
      continue;
    }
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code < 200 || code >= 300) {
      errs.push(code + " " + text.substring(0, 160));
      continue;
    }
    try {
      var j = JSON.parse(text);
      saved += Number(j.saved || 0);
      /* v2 가 「이 값 못 읽었다」를 돌려준다. 조용히 버리지 않고 남긴다 —
         시트 머리글이 또 바뀌면 여기가 먼저 안다. */
      if (j.problems && j.problems["열"] && j.problems["열"].length) {
        Logger.log("[반품미러] ★ 열 문제 ★ " + JSON.stringify(j.problems["열"]).substring(0, 400));
      }
      if (j.guessed && j.guessed.length) {
        Logger.log("[반품미러] ★ 머리글을 못 찾은 탭 ★ " + j.guessed.join(" / "));
      }
    } catch (eJ) {
      errs.push("응답을 못 읽음: " + text.substring(0, 120));
    }
  }

  var msg = "보냄 " + total + "줄 · 저장 " + saved + "줄" +
    (errs.length ? " · 오류 " + errs.length + "건" : "");
  Logger.log("[반품미러] " + msg + (errs.length ? " — " + errs[0] : ""));
  return { ok: !errs.length, sent: total, saved: saved, msg: msg };
}

/**
 * 전체를 다시 민다. 손으로 부를 때만 쓴다.
 * 대장을 통째로 손봤거나 v2 를 비우고 다시 채울 때.
 */
function partnerMirrorReturnsAll() {
  var r = partnerMirrorReturnsToV2(24);
  try {
    SpreadsheetApp.getUi().alert("반품대장 → v2 전체 미러\n\n" + r.msg);
  } catch (e) {}
  return r;
}

/**
 * ★ 이 트리거 하나만 건다 ★
 *
 * 「⏰ 통합 자동 트리거 설치」는 **시간 트리거를 전부 지우고 다시 깐다.**
 * 미러 하나 붙이자고 스무 개를 다시 까는 것은 위험하다 — 그 사이에 마감이
 * 돌면 빠진다. 그래서 이것만 거는 길을 따로 둔다.
 *
 * 여러 번 눌러도 안전하다. 이미 걸려 있으면 지우고 다시 건다 —
 * 같은 트리거가 둘이면 미러가 두 번 돌고, 로그가 두 배가 된다.
 *
 * 실행: Apps Script 편집기에서 이 함수를 골라 ▶ 실행.
 */
function partnerInstallReturnsMirrorTrigger() {
  var removed = 0;
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "_prv_scheduled_") {
      ScriptApp.deleteTrigger(all[i]);
      removed++;
    }
  }

  ScriptApp.newTrigger("_prv_scheduled_")
    .timeBased().everyDays(1).atHour(21).nearMinute(30).create();

  var msg = "반품대장 → v2 미러 트리거를 걸었습니다.\n\n" +
    "  매일 21:30 (통합조회 재생성 21:00 뒤, 대리판매 마감 22:00 앞)\n" +
    (removed ? "  이전 것 " + removed + "개는 지웠습니다 (중복 방지)\n" : "") +
    "\n지금 한 번 돌려 보려면 partnerMirrorReturnsAll 을 실행하세요.";
  Logger.log("[반품미러] " + msg.replace(/\n/g, " "));
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { ok: true, removed: removed, msg: msg };
}

/** 지금 걸려 있는지 확인만 한다 (아무것도 안 바꾼다). */
function partnerCheckReturnsMirrorTrigger() {
  var found = [];
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "_prv_scheduled_") found.push(all[i].getUniqueId());
  }
  var msg = found.length
    ? "미러 트리거가 " + found.length + "개 걸려 있습니다."
    : "미러 트리거가 없습니다 — partnerInstallReturnsMirrorTrigger 를 실행하세요.";
  Logger.log("[반품미러] " + msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { count: found.length, msg: msg };
}

/** 트리거가 부르는 자리. 예외를 절대 밖으로 내보내지 않는다. */
/**
 * ══════════════════════════════════════════════════════════════
 *  밤 v2 미러 — 반품대장 + 커뮤니티 보드를 «한 트리거»에서
 *  2026-09-16
 *
 *  > "트리거 총합: 20 / 20개 제한  트리거 꽉참.. 마감 제대로 안됨"
 *  > "이 두개 합치면 좋을듯"
 *
 *  트리거 20개가 꽉 차면 «1분 뒤 저절로 이어집니다» 가 한 번도 안 걸린다.
 *  마감·월정산·재매칭·푸시의 이어달리기가 전부 죽는다 — 그게 지금 상태다.
 *
 *  반품(21:30)과 보드(21:40)는 10분 차이고 하는 일이 같다(시트 → v2).
 *  하나로 묶으면 자리가 하나 빈다. 순서도 이 편이 맞다 — 반품이 먼저,
 *  보드가 뒤. 앞이 실패해도 뒤는 돈다.
 *
 *  ★ 보드 미러 트리거는 이제 «스케줄 외»가 아니다 ★
 *    여태 _pt_ensureMirrorTriggers_ 가 따로 걸어서 트리거 점검이
 *    「⚠ 스케줄 외」로 잡았다. 부르는 자리를 여기로 옮겨 그 경고도 없앤다.
 * ══════════════════════════════════════════════════════════════
 */
function _prv_scheduled_() {
  //  하나가 실패해도 나머지는 돈다 — 미러는 곁다리다
  try {
    partnerMirrorReturnsToV2(_PRV_MONTHS_);
  } catch (e) {
    Logger.log("[반품미러] 예기치 못한 오류(무시): " + (e && e.message ? e.message : e));
  }
  try {
    if (typeof partnerMirrorBoardToV2 === "function") partnerMirrorBoardToV2();
  } catch (e2) {
    Logger.log("[보드미러] 예기치 못한 오류(무시): " + (e2 && e2.message ? e2.message : e2));
  }
  /*  ★ 2026-09-16: 구매입력 미러도 여기로 합친다 (22:10 → 21:30) ★
      > "이 두개 합치면 좋을듯"

      트리거가 20/20 으로 꽉 차 「1분 뒤 저절로 이어집니다」가 한 번도 안 걸렸다.
      v2 로 미는 일이 셋(반품·보드·구매입력)이나 따로 자리를 쓰고 있었다.
      셋 다 시트를 읽어 v2 에 POST 하는 같은 일이고, 서로 기다릴 것이 없다.

      21:30 에 돌려도 되는 까닭: 구매입력변환 탭은 17:00 저녁 배치
      (runEveningPurchaseAndSync → _ecountPurchaseFromExclusive.gs)가 채우고,
      22:00·23:00 마감은 그 탭을 건드리지 않는다. 21:30 이면 그날 것이 다 있다. */
  try {
    if (typeof partnerMirrorPurchaseToV2 === "function") partnerMirrorPurchaseToV2();
  } catch (e3) {
    Logger.log("[구매입력미러] 예기치 못한 오류(무시): " + (e3 && e3.message ? e3.message : e3));
  }
}

/**
 * 월별 탭을 **있는 그대로** 읽는다.
 * 자르는 것도 고르는 것도 안 한다 — 판단은 v2 가 한다.
 */
function _prv_readTabs_(months) {
  var ss = SpreadsheetApp.openById(_PRV_LEDGER_ID_);
  var sheets = ss.getSheets();

  var monthNames = [];
  for (var i = 0; i < sheets.length; i++) {
    var nm = sheets[i].getName();
    if (/^\d{6}$/.test(nm)) monthNames.push(nm);
  }
  monthNames.sort();
  var recent = monthNames.slice(Math.max(0, monthNames.length - months));

  var out = [];
  for (var t = 0; t < recent.length; t++) {
    var tab = ss.getSheetByName(recent[t]);
    if (!tab) continue;
    var lastRow = tab.getLastRow();
    var lastCol = tab.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;
    out.push({
      tab: recent[t],
      //  보이는 그대로. getValues 를 쓰면 날짜가 Date 가 되고 송장 앞 0 이 날아간다.
      values: tab.getRange(1, 1, lastRow, lastCol).getDisplayValues(),
    });
  }
  return out;
}

/** 탭들을 줄 수 한도에 맞춰 묶는다. 한 탭은 쪼개지 않는다. */
function _prv_split_(tabs, maxRows) {
  var groups = [];
  var cur = [], n = 0;
  for (var i = 0; i < tabs.length; i++) {
    var cnt = tabs[i].values.length;
    if (cur.length && n + cnt > maxRows) { groups.push(cur); cur = []; n = 0; }
    cur.push(tabs[i]);
    n += cnt;
  }
  if (cur.length) groups.push(cur);
  return groups;
}
