/**
 * ══════════════════════════════════════════════════════════════
 *  일일 거래명세표 — 매일 15:40 자동 발송
 *  파일: _partnerDailyStatement.gs      2026-10-06
 *
 *  > "내일부터는 3시 40분에 자동 발송되게해줘.. 주문내역이 있을떄만."
 *
 *  ★ 무엇을 보내나 ★
 *    그날 «주문일자»가 오늘인 줄로 거래명세표를 만들어 업체 수신메일로 보낸다.
 *    구간 발행(_pts_collectByRange_)과 «같은 길»을 쓴다 — 길을 두 벌 두면
 *    한쪽만 고쳐져서 손으로 뽑은 것과 자동으로 나간 것이 달라진다.
 *
 *  ★ 안 보내는 경우 ★
 *    · 「매일발송」이 꺼진 거래처            (칸을 안 켜면 아무 일도 안 난다)
 *    · 「발행」이 꺼진 거래처
 *    · 수신메일이 없는 거래처               (보낼 데가 없다)
 *    · 그날 줄이 하나도 없는 거래처         ("주문내역이 있을떄만")
 *    · 오늘 이미 보낸 거래처                 (아래 «두 번 안 보낸다»)
 *
 *  ★ 두 번 안 보낸다 ★
 *    트리거는 생각보다 쉽게 두 번 돈다(재시도·사람이 손으로 또 누름).
 *    업체에게 같은 명세서가 두 통 가면 「무엇이 맞나」를 전화로 물어야 한다.
 *    그래서 보내기 전에 «오늘 그 거래처에 보낸 기록»을 발행이력에서 찾는다.
 *    기록이 있으면 건너뛴다. 정말 다시 보내려면 메뉴로 손수 뽑으면 된다.
 *
 *  ★ 조용히 끝나지 않는다 ★
 *    보낸 곳·건너뛴 곳·터진 곳을 다 모아 구글 챗으로 알린다.
 *    자동으로 도는 일이 조용하면 안 도는 것과 구별이 안 된다.
 *
 *  돌리는 법
 *    메뉴 「📮 일일 명세서 지금 보내기」      — 손으로 한 번
 *    메뉴 「⏰ 일일 명세서 트리거 설치 (15:40)」 — 하루 한 번 자동
 * ══════════════════════════════════════════════════════════════
 */

var _PDS_TRIGGER_FN_ = "partnerDailyStatementRun";
var _PDS_HOUR_ = 15;   // 15:40 — 구글은 «그 시간대 안» 아무 때나 돈다(15:00~16:00)
var _PDS_MIN_ = 40;

/** 메뉴: 📮 일일 명세서 지금 보내기 */
function partnerSendDailyStatements() {
  var r = partnerDailyStatementRun();
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert("📮 일일 거래명세표", r.글, ui.ButtonSet.OK);
  } catch (e) {}
  return r.글;
}

/** 트리거가 부르는 자리 */
function partnerDailyStatementRun() {
  var out = { 보냄: [], 건너뜀: [], 터짐: [], 글: "" };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    out.글 = "다른 작업이 돌고 있어 건너뜁니다.";
    Logger.log("[일일명세표] " + out.글);
    return out;
  }

  try {
    var issuer, vendors;
    try {
      issuer = _pts_readIssuer_();
      vendors = _pts_readVendors_();
    } catch (e) {
      out.글 = "설정을 못 읽었습니다: " + (e.message || e);
      Logger.log("[일일명세표] " + out.글);
      return out;
    }

    var 오늘 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
    var 오늘표시 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    var ymd = Number(오늘);
    var ym = 오늘표시.substring(0, 7);
    var 보낸기록 = _pds_sentToday_(오늘표시);

    for (var i = 0; i < vendors.length; i++) {
      var v = vendors[i];
      var 이름 = v.name || v.fileName;

      if (!v.daily) continue;                       // 매일발송 꺼짐 — 조용히 넘어간다
      if (!v.issue) { out.건너뜀.push(이름 + " (발행 꺼짐)"); continue; }
      if (String(v.emails || "").indexOf("@") === -1) {
        out.건너뜀.push(이름 + " (수신메일 없음)"); continue;
      }
      if (보낸기록[이름]) { out.건너뜀.push(이름 + " (오늘 이미 보냄)"); continue; }

      try {
        var r1 = _pds_one_(issuer, v, ymd, ym);
        if (r1.보냄) out.보냄.push(이름 + " " + r1.줄 + "줄 · " + _pts_comma_(r1.합계) + "원 → " + r1.받는곳);
        else out.건너뜀.push(이름 + " (" + r1.까닭 + ")");
      } catch (e2) {
        out.터짐.push(이름 + " — " + (e2 && e2.message ? e2.message : e2));
      }
    }

    out.글 = _pds_report_(오늘표시, out);
    Logger.log("[일일명세표] " + out.글);
    _pds_tell_(out);
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** 거래처 한 곳 — 오늘 줄이 있으면 만들어 보낸다 */
function _pds_one_(issuer, vendor, ymd, ym) {
  var ss;
  try { ss = SpreadsheetApp.openById(vendor.fileId); }
  catch (e) { throw new Error("업체 파일을 못 열었습니다: " + (e.message || e)); }

  var pack = _pts_collectByRange_(ss, ymd, ymd, null, null);
  if (!pack.lines.length && !pack.extras.length) {
    //  "주문내역이 있을떄만" — 없으면 탭도 안 건드리고 메일도 안 보낸다
    return { 보냄: false, 까닭: "오늘 줄 없음" };
  }

  pack.docTag = "R" + String(ymd).substring(4) + String(ymd).substring(4);
  pack.fromNum = ymd;
  pack.toNum = ymd;
  pack.periodLabel = _pts_shortPeriod_(ymd, ymd);

  var r = _pts_issueWithPack_(ss, vendor, ym, issuer, pack, { pdf: true, mail: true });
  _pts_log_(ym, vendor, r, "일일 " + pack.periodLabel);

  return {
    보냄: !!(r.mailNote && r.mailNote.indexOf("발송") === 0),
    까닭: r.mailNote || "메일 안 나감",
    줄: r.rows, 합계: r.total, 받는곳: String(r.mailNote || "").replace(/^발송 /, ""),
  };
}

/**
 * 오늘 이미 보낸 거래처 — 발행이력에서 찾는다.
 * 「메일」 칸이 「발송…」으로 시작하는 줄만 센다. PDF 만 만든 줄은 보낸 것이 아니다.
 */
function _pds_sentToday_(오늘표시) {
  var 본것 = {};
  try {
    var tab = _pts_hub_().getSheetByName(_PTS_TAB_LOG);
    if (!tab) return 본것;
    var lr = tab.getLastRow();
    if (lr < 2) return 본것;
    //  뒤에서 300줄만 본다 — 이력이 길어져도 느려지지 않게
    var from = Math.max(2, lr - 299);
    var vals = tab.getRange(from, 1, lr - from + 1, _PTS_LOG_HEADERS_.length).getDisplayValues();
    for (var i = 0; i < vals.length; i++) {
      var 시각 = String(vals[i][0] || "");
      if (시각.substring(0, 10) !== 오늘표시) continue;
      var 메일 = String(vals[i][8] || "");
      if (메일.indexOf("발송") !== 0) continue;
      var 이름 = String(vals[i][2] || "").trim();
      if (이름) 본것[이름] = true;
    }
  } catch (e) {
    Logger.log("[일일명세표] 발행이력을 못 읽어 중복 검사를 건너뜁니다: " + (e.message || e));
  }
  return 본것;
}

function _pds_report_(오늘표시, out) {
  var L = ["일일 거래명세표 · " + 오늘표시];
  L.push("");
  L.push("보냄   " + out.보냄.length + "곳");
  out.보냄.forEach(function (x) { L.push("   · " + x); });
  if (out.건너뜀.length) {
    L.push("");
    L.push("건너뜀 " + out.건너뜀.length + "곳");
    out.건너뜀.slice(0, 20).forEach(function (x) { L.push("   · " + x); });
  }
  if (out.터짐.length) {
    L.push("");
    L.push("★ 터짐 " + out.터짐.length + "곳 ★");
    out.터짐.forEach(function (x) { L.push("   · " + x); });
  }
  if (!out.보냄.length && !out.터짐.length) {
    L.push("");
    L.push("보낼 것이 없었습니다.");
  }
  return L.join("\n");
}

/** 구글 챗으로도 알린다 — 보낸 것이 있거나 터진 것이 있을 때만 */
function _pds_tell_(out) {
  if (!out.보냄.length && !out.터짐.length) return;
  try {
    if (typeof _chat_sendText_ === "function") {
      _chat_sendText_("📮 " + out.글 + (out.터짐.length ? "\n\n★ 터진 곳을 봐 주세요 ★" : ""));
    }
  } catch (e) {}
}

/* ── 트리거 ────────────────────────────────────────────── */

/** 메뉴: ⏰ 일일 명세서 트리거 설치 (15:40) */
function partnerInstallDailyStatementTrigger() {
  var 지움 = _pds_dropTriggers_();
  var 말;
  try {
    ScriptApp.newTrigger(_PDS_TRIGGER_FN_)
      .timeBased().atHour(_PDS_HOUR_).nearMinute(_PDS_MIN_).everyDays(1).create();
    말 = "⏰ 설치했습니다 — 매일 " + _PDS_HOUR_ + ":" + _PDS_MIN_ + " 쯤 돕니다." +
      (지움 ? "\n(옛 트리거 " + 지움 + "개를 치웠습니다)" : "") +
      "\n\n★ 구글은 「그 시간대 안」 아무 때나 돌립니다 — " + _PDS_HOUR_ + ":00~" +
      (_PDS_HOUR_ + 1) + ":00 사이입니다. 분 단위로 못 박지는 못합니다." +
      "\n\n보낼 거래처는 「거래명세표_거래처」 탭의 «매일발송» 칸을 켠 곳뿐입니다.";
  } catch (e) {
    말 = "★ 트리거를 못 걸었습니다: " + (e.message || e) +
      "\n\n트리거 자리가 찼을 수 있습니다(스무 개까지). 안 쓰는 것을 지우고 다시 하세요.";
  }
  Logger.log("[일일명세표] " + 말);
  try { SpreadsheetApp.getUi().alert("일일 거래명세표 트리거", 말, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e2) {}
  return 말;
}

/** 메뉴: ⏹ 일일 명세서 트리거 해제 */
function partnerRemoveDailyStatementTrigger() {
  var 지움 = _pds_dropTriggers_();
  var 말 = 지움 ? "⏹ 트리거 " + 지움 + "개를 지웠습니다. 이제 자동 발송은 안 합니다."
                : "걸려 있는 트리거가 없습니다.";
  Logger.log("[일일명세표] " + 말);
  try { SpreadsheetApp.getUi().alert("일일 거래명세표 트리거", 말, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return 말;
}

/** 내가 건 것만 지운다 — 남의 트리거는 안 건드린다 */
function _pds_dropTriggers_() {
  var n = 0;
  try {
    var all = ScriptApp.getProjectTriggers();
    for (var i = 0; i < all.length; i++) {
      if (all[i].getHandlerFunction() === _PDS_TRIGGER_FN_) { ScriptApp.deleteTrigger(all[i]); n++; }
    }
  } catch (e) { Logger.log("[일일명세표] 트리거 정리 실패: " + (e.message || e)); }
  return n;
}
