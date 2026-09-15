/**
 * ══════════════════════════════════════════════════════════════
 *  커뮤니티 보드 → v2 밤 미러
 *  파일: _partnerBoardV2Mirror.gs
 *  ★ 2026-09-10 신규
 *
 *  ★ 왜 있나 ★
 *    보드는 2026-09-08 에 **사람이 한 번 손으로 내보낸 스냅샷**이었다
 *    (CS_WebApp/csBoardExport.gs 를 편집기에서 실행 → Drive JSON → migrate/loadBoard.js).
 *    그 뒤로 아무것도 안 따라와서 v2 보드가 9/8 에 멈춰 있었다.
 *    사장님이 「보드의 공지가 반영이 안 됐다」고 하신 게 이것이다 —
 *    **화면은 멀쩡했다.** 공지 규칙(두 칸 폭·파란 테두리·본문 안 접기)은
 *    이미 옮겨져 있었고, 그날 올라온 공지가 v2 에 없었을 뿐이다.
 *
 *  ★ 여기서는 아무것도 해석하지 않는다 ★
 *    머리글과 **시트에 보이는 값** 그대로 보낸다. 날짜·이름·첨부·전달내역을
 *    읽는 것은 전부 v2 가 한다 (app/src/lib/board-ingest/transform.js).
 *    보드 머리글은 사람이 계속 늘리는 자리다 — 2026-08-31 에 고객명·전화·송장·
 *    품목 넷이, 9-04 에 지목이 붙었다. 양쪽에 규칙이 있으면 한쪽이 늦게
 *    고쳐지고, **늦은 쪽이 조용히 틀린다.**
 *
 *  ★ getDisplayValues 를 쓴다 ★
 *    getValues 를 쓰면 날짜가 Date 객체가 되고 송장 앞자리 0 이 사라진다.
 *    보이는 그대로가 원문이다.
 *
 *  ★ 절대 원래 흐름을 막지 않는다 ★
 *    미러가 실패해도 보드는 이미 적혔다. 전부 삼키고 로그만 남긴다.
 *
 *  ★ 끄는 법 ★
 *    스크립트 속성 BOARD_MIRROR = off  → 즉시 멈춘다. 코드를 안 고쳐도 된다.
 * ══════════════════════════════════════════════════════════════
 */

/** 보드 탭은 반품관리대장 파일에 있다. 반품 미러(_PRV_LEDGER_ID_)와 같은 파일이다. */
var _PBV_LEDGER_ID_ = "1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU";

var _PBV_OFF_PROP_ = "BOARD_MIRROR";
var _PBV_PATH_ = "/api/board/ingest";

/**
 * 보드 목록. CS_WebApp 의 _CS_HB_BOARDS_ 와 같아야 한다.
 * 여기 적어 두는 이유: 이 파일은 상품정보시트 프로젝트에 있어서 CS 웹앱의
 * 상수를 못 본다. 보드가 늘면 **양쪽 다** 고쳐야 한다.
 */
var _PBV_BOARDS_ = [
  { key: "cs",   tab: "CS_커뮤니티보드",   legacy: "CS_전달보드", label: "CS 커뮤니티 보드" },
  { key: "logi", tab: "물류_커뮤니티보드", legacy: "",            label: "물류 커뮤니티 보드" }
];

function _pbv_enabled_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(_PBV_OFF_PROP_);
    if (String(v || "").toLowerCase() === "off") {
      Logger.log("[보드미러] 속성 " + _PBV_OFF_PROP_ + "=off — 건너뜁니다");
      return false;
    }
  } catch (e) {}
  return true;
}

/** v2 주소·토큰은 반품 미러와 같은 곳에서 온다 (_secrets.gs). */
function _pbv_url_() {
  var u = "";
  try { if (typeof V2_URL !== "undefined" && V2_URL) u = String(V2_URL); } catch (e) {}
  if (!u) {
    try { u = PropertiesService.getScriptProperties().getProperty("V2_URL") || ""; } catch (e) {}
  }
  return u.replace(/\/+$/, "");
}

function _pbv_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || ""; } catch (e) {}
  return "";
}

/**
 * 보드 두 탭을 통째로 읽는다.
 * csBoardExport.csExportBoardRaw 가 만드는 것과 **같은 모양**이다 —
 * 받는 쪽(cardsFromExport)이 그 모양을 읽으므로 바꾸면 안 된다.
 */
function _pbv_read_() {
  var ss = SpreadsheetApp.openById(_PBV_LEDGER_ID_);
  var boards = [];
  var total = 0;

  for (var i = 0; i < _PBV_BOARDS_.length; i++) {
    var conf = _PBV_BOARDS_[i];
    var tab = ss.getSheetByName(conf.tab);
    // CS 보드는 예전 이름으로 남아 있을 수 있다
    if (!tab && conf.legacy) tab = ss.getSheetByName(conf.legacy);

    if (!tab || tab.getLastRow() < 2) {
      boards.push({ board: conf.key, tab: conf.tab, label: conf.label, missing: !tab, header: [], rows: [] });
      continue;
    }

    var values = tab.getRange(1, 1, tab.getLastRow(), Math.max(tab.getLastColumn(), 2)).getDisplayValues();
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var has = false;
      for (var c = 0; c < row.length; c++) {
        if (String(row[c] || "").trim()) { has = true; break; }
      }
      if (!has) continue;                 // 빈 줄 제거일 뿐, 판단이 아니다
      rows.push({ r: r + 1, v: row });    // r = 사람이 보는 행 번호
    }

    boards.push({
      board: conf.key, tab: tab.getName(), label: conf.label,
      header: values[0], rows: rows
    });
    total += rows.length;
  }

  return { boards: boards, totalRows: total };
}

/**
 * 보드를 v2 로 보낸다.
 *
 * ★ 전부 보낸다 ★
 *   반품대장은 달마다 탭이 갈려 최근 두 달만 보내지만, 보드는 두 탭에 다 쌓이고
 *   지금 수백 줄이다. 나눠 보내면 「어디까지 보냈나」를 들고 있어야 하는데
 *   그 상태가 틀리면 조용히 빠진다. 통째로 보내고 v2 가 덮어쓰게 둔다.
 *   줄이 수천이 되면 그때 나눈다.
 *
 * @returns {{ok:boolean, sent:number, saved:number, msg:string}}
 */
function partnerMirrorBoardToV2() {
  if (!_pbv_enabled_()) return { ok: true, sent: 0, saved: 0, msg: "꺼져 있음" };

  var url = _pbv_url_();
  var token = _pbv_token_();
  if (!url || !token) {
    Logger.log("[보드미러] v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)");
    return { ok: false, sent: 0, saved: 0, msg: "설정 없음" };
  }

  var src;
  try {
    src = _pbv_read_();
  } catch (e) {
    Logger.log("[보드미러] 보드를 못 읽었습니다: " + (e && e.message ? e.message : e));
    return { ok: false, sent: 0, saved: 0, msg: "읽기 실패" };
  }

  if (!src.totalRows) {
    Logger.log("[보드미러] 보낼 줄이 없습니다");
    return { ok: true, sent: 0, saved: 0, msg: "보낼 것 없음" };
  }

  var res;
  try {
    res = UrlFetchApp.fetch(url + _PBV_PATH_, {
      method: "post",
      contentType: "application/json",
      headers: { "x-ingest-token": token },
      payload: JSON.stringify({
        source: "_partnerBoardV2Mirror.gs",
        exportedAt: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
        boards: src.boards
      }),
      muteHttpExceptions: true,
    });
  } catch (eF) {
    Logger.log("[보드미러] 보내기 실패: " + (eF && eF.message ? eF.message : eF));
    return { ok: false, sent: src.totalRows, saved: 0, msg: "보내기 실패" };
  }

  var code = res.getResponseCode();
  var body = String(res.getContentText() || "").slice(0, 500);
  if (code < 200 || code >= 300) {
    Logger.log("[보드미러] v2 가 " + code + " 로 답했습니다: " + body);
    return { ok: false, sent: src.totalRows, saved: 0, msg: "v2 " + code };
  }

  var saved = 0, notes = 0, unknown = [];
  try {
    var j = JSON.parse(body);
    saved = j.cards || 0;
    notes = j.notes || 0;
    unknown = j.unknownNames || [];
  } catch (eJ) {}

  var msg = "보낸 줄 " + src.totalRows + " · 저장 카드 " + saved + " · 전달내역 " + notes +
    (unknown.length ? " · 계정 못 찾은 이름: " + unknown.join(", ") : "");
  Logger.log("[보드미러] " + msg);
  return { ok: true, sent: src.totalRows, saved: saved, msg: msg };
}

/** 손으로 한 번 돌린다. 결과를 창으로 보여 준다. */
function partnerMirrorBoardNow() {
  var r = partnerMirrorBoardToV2();
  try {
    SpreadsheetApp.getUi().alert("커뮤니티 보드 → v2 미러\n\n" + r.msg);
  } catch (e) {}
  return r;
}

/**
 * ★ 이 트리거 하나만 건다 ★
 * 「⏰ 통합 자동 트리거 설치」는 시간 트리거를 전부 지우고 다시 깐다.
 * 미러 하나 붙이자고 스무 개를 다시 까는 것은 위험하다.
 *
 * 여러 번 눌러도 안전하다 — 이미 걸려 있으면 지우고 다시 건다.
 * 실행: Apps Script 편집기에서 이 함수를 골라 ▶ 실행.
 */
function partnerInstallBoardMirrorTrigger() {
  var removed = 0;
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "_pbv_scheduled_") {
      ScriptApp.deleteTrigger(all[i]);
      removed++;
    }
  }

  /* 21:40 — 반품대장 미러(21:30) 뒤, 대리판매 마감(22:00) 앞.
     보드는 사람이 늦게까지 적으므로 마감 직전에 한 번 더 긁는 편이 낫다. */
  ScriptApp.newTrigger("_pbv_scheduled_")
    .timeBased().everyDays(1).atHour(21).nearMinute(40).create();

  var msg = "커뮤니티 보드 → v2 미러 트리거를 걸었습니다.\n\n" +
    "  매일 21:40 (반품대장 미러 21:30 뒤, 대리판매 마감 22:00 앞)\n" +
    (removed ? "  이전 것 " + removed + "개는 지웠습니다 (중복 방지)\n" : "") +
    "\n지금 한 번 돌려 보려면 partnerMirrorBoardNow 를 실행하세요.";
  Logger.log("[보드미러] " + msg.replace(/\n/g, " "));
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { ok: true, removed: removed, msg: msg };
}

/** 지금 걸려 있는지 확인만 한다 (아무것도 안 바꾼다). */
function partnerCheckBoardMirrorTrigger() {
  var found = [];
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "_pbv_scheduled_") found.push(all[i].getUniqueId());
  }
  var msg = found.length
    ? "보드 미러 트리거가 " + found.length + "개 걸려 있습니다."
    : "보드 미러 트리거가 없습니다 — partnerInstallBoardMirrorTrigger 를 실행하세요.";
  Logger.log("[보드미러] " + msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { count: found.length, msg: msg };
}

/**
 * ══════════════════════════════════════════════════════════════
 *  밤 미러 트리거가 빠져 있으면 **스스로 건다**
 *  ★ 2026-09-10
 *
 *  ★ 왜 만드나 ★
 *    보드 미러를 9/9 에 만들어 놓고 «거는 일»을 사람에게 넘겼다. 그래서
 *    9/8 이후로 안 걸린 채 이틀이 지났고, v2 의 보드가 그동안 멈춰 있었다.
 *    만든 사람만 알고 있는 「메뉴를 한 번 눌러야 한다」는 절차는 반드시
 *    잊힌다. 잊혀도 도는 쪽으로 만든다.
 *
 *    새 미러를 붙일 때마다 이 표에 한 줄만 더하면 된다.
 *
 *  ★ 한 번 걸린 것은 다시 안 건다 ★
 *    이미 있으면 아무것도 안 한다. 매번 지웠다 다시 걸면 트리거 id 가
 *    바뀌어 실행 기록이 끊기고, 하루 두 번 도는 사고도 난다.
 *
 *  ★ 절대 밖으로 던지지 않는다 ★
 *    이건 «곁다리»다. 여기서 예외가 나서 밤 마감이 통째로 못 도는 일은
 *    있어서는 안 된다.
 *
 *  @return {Object} {건 것:[], 이미:[], 오류:[]}
 * ══════════════════════════════════════════════════════════════
 */
function _pt_ensureMirrorTriggers_() {
  var 표 = [
    { fn: "_pbv_scheduled_", h: 21, m: 40, label: "커뮤니티 보드 → v2" },
    { fn: "_prv_scheduled_", h: 21, m: 30, label: "반품대장 → v2" }
  ];
  var out = { 건것: [], 이미: [], 오류: [] };
  try {
    var have = {};
    var all = ScriptApp.getProjectTriggers();
    for (var i = 0; i < all.length; i++) have[all[i].getHandlerFunction()] = true;

    for (var t = 0; t < 표.length; t++) {
      var s = 표[t];
      if (have[s.fn]) { out.이미.push(s.label); continue; }
      try {
        ScriptApp.newTrigger(s.fn).timeBased().everyDays(1)
          .atHour(s.h).nearMinute(s.m).create();
        out.건것.push(s.label + " (" + s.h + ":" + (s.m < 10 ? "0" + s.m : s.m) + ")");
      } catch (e1) {
        out.오류.push(s.label + " — " + (e1 && e1.message ? e1.message : e1));
      }
    }

    if (out.건것.length) {
      Logger.log("[미러트리거] 빠져 있어 걸었습니다: " + out.건것.join(", "));
      /* 조용히 걸면 아무도 모른다. 걸었을 때만 알린다 — 이미 있을 때는 조용하다. */
      try {
        _chat_sendCard_("⏰ 밤 미러 트리거를 자동으로 걸었습니다",
          Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
          [{ label: "건 것", value: out.건것.join(" · ") }]);
      } catch (eC) {}
    }
  } catch (e) {
    Logger.log("[미러트리거] 점검 실패(무시): " + (e && e.message ? e.message : e));
  }
  return out;
}

/** 트리거가 부르는 자리. 예외를 절대 밖으로 내보내지 않는다. */
function _pbv_scheduled_() {
  try {
    partnerMirrorBoardToV2();
  } catch (e) {
    Logger.log("[보드미러] 예기치 못한 오류(무시): " + (e && e.message ? e.message : e));
  }
}
