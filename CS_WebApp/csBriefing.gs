/**
 * ══════════════════════════════════════════════════════════════
 *  새벽 브리핑 — v2 가 담은 것을 시트로 쓰고 커뮤니티에 올린다
 *  2026-10-09
 *
 *  > "전날 브리핑 시트를 만들어주면 좋겠어.. 브리핑이 완성되면 cs웹앱
 *  >  커뮤니티에 만든 시트링크를 올려주면 매일 확인할수 있게"
 *
 *  ★ 왜 여기서 시트를 만드나 ★
 *    v2 의 구글 권한은 «읽기 전용»이다(spreadsheets.readonly). 그래서 v2 는
 *    읽고 따져서 briefings 표에 담기만 하고, 시트로 옮겨 적는 일은 여기서 한다.
 *    v2 권한을 넓히면 v2 가 모든 시트를 고칠 수 있게 된다 — 그 대가가 더 크다.
 *
 *  ★ 한 파일에 탭을 쌓는다 ★
 *    날마다 새 파일을 만들면 드라이브에 1년에 365개가 쌓이고 링크도 날마다 다르다.
 *    한 파일 안에 「1009」 같은 탭을 더한다 — 지난 것을 옆 탭에서 바로 본다.
 *    오래된 탭은 스스로 걷는다(기본 60장).
 *
 *  ★ 두 번 올리지 않는다 ★
 *    같은 날 두 번 돌아도 커뮤니티 글은 한 번만 쓴다. v2 의 「올린때」를 본다.
 *    날마다 같은 글이 두 장씩 쌓이면 보드가 금세 못 쓰게 된다.
 *
 *  ★ 못 받으면 «조용히» 넘어가지 않는다 ★
 *    v2 가 안 뜨거나 브리핑이 없으면 그 사실을 보드에 적는다.
 *    아무 글도 없는 아침은 「어제 조용했구나」로 읽힌다 — 그게 제일 나쁘다.
 * ══════════════════════════════════════════════════════════════
 */

var _CB_FILE_PROP_ = "BRIEFING_SS_ID";      // 브리핑 파일 ID (스크립트 속성)
var _CB_FILE_NAME_ = "팩투유 새벽 브리핑";
var _CB_KEEP_TABS_ = 60;                    // 남겨 둘 날짜 탭 수
var _CB_BOARD_ = "cs";                      // 올릴 커뮤니티 보드

/** v2 에서 그날 브리핑을 받아 온다 */
function _cb_fetch_(날) {
  var url = _csq_url_(), token = _csq_token_();
  if (!url || !token) return { ok: false, error: "v2 주소나 토큰이 없습니다 (_secrets.gs)" };
  var u = url.replace(/\/+$/, "") + "/api/briefing?" +
    "%EB%82%A0=" + encodeURIComponent(날);     // 날=
  try {
    var res = UrlFetchApp.fetch(u, {
      method: "get",
      headers: { "x-ingest-token": token },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var txt = res.getContentText();
    if (code !== 200) return { ok: false, error: "v2 HTTP " + code + " — " + txt.substring(0, 300) };
    var j = JSON.parse(txt);
    if (!j || !j.ok) return { ok: false, error: (j && j.why) || "v2 가 ok 를 안 줬습니다" };
    return { ok: true, 브리핑: j.브리핑 };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 브리핑 파일을 찾거나 만든다 */
function _cb_file_() {
  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty(_CB_FILE_PROP_) || "").trim();
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* 지워졌으면 새로 만든다 */ }
  }
  var ss = SpreadsheetApp.create(_CB_FILE_NAME_);
  props.setProperty(_CB_FILE_PROP_, ss.getId());
  /*  링크를 아는 사람은 볼 수 있게 — 커뮤니티에 올린 링크를 팀이 바로 연다.
      안 열리면 「링크 달라」가 다시 온다. 자료는 사내 집계라 이 정도가 맞다. */
  try {
    DriveApp.getFileById(ss.getId())
      .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (eS) { Logger.log("[BRIEF] 공유 설정 실패: " + eS.message); }
  return ss;
}

/** 「1009」 꼴 탭 이름 */
function _cb_tabName_(날) {
  var m = String(날 || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[2] + m[3]) : String(날).replace(/[^0-9]/g, "").slice(-4);
}

/** 브리핑 한 장을 탭에 적는다 */
function _cb_write_(ss, b) {
  var name = _cb_tabName_(b.날짜);
  var old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);          // 다시 돌리면 그날 것을 새로 쓴다
  var tab = ss.insertSheet(name, 0);

  var 줄 = [];
  줄.push(["■ 팩투유 새벽 브리핑", b.날짜, "", ""]);
  줄.push(["만든때", b.만든때 || "", "걸린초", b.걸린초 || ""]);
  줄.push(["상태", b.상태 || "", "", ""]);
  줄.push([(b.요약 && b.요약.한줄) || "", "", "", ""]);
  줄.push(["", "", "", ""]);

  줄.push(["갈래", "상태", "건수", "한마디"]);
  var 항목 = b.항목 || [];
  for (var i = 0; i < 항목.length; i++) {
    줄.push([항목[i].갈래, 항목[i].상태, 항목[i].건수, 항목[i].한마디]);
  }
  줄.push(["", "", "", ""]);

  /*  낱낱이 — 숫자만 보면 「그래서 어느 건인데」가 된다. 줄을 그대로 적는다. */
  줄.push(["── 낱낱이 ──", "", "", ""]);
  for (i = 0; i < 항목.length; i++) {
    var ls = 항목[i].줄 || [];
    if (!ls.length) continue;
    줄.push(["[" + 항목[i].상태 + "] " + 항목[i].갈래, "", "", ""]);
    for (var j = 0; j < ls.length; j++) 줄.push(["", String(ls[j]), "", ""]);
  }
  줄.push(["", "", "", ""]);

  var 장 = b.장부 || {};
  줄.push(["── 장부 (어제) ──", "", "", ""]);
  줄.push(["매입 합", 장.매입합 || 0, "건수", 장.건수 || 0]);
  줄.push(["도서산간비", 장.도서산간비 || 0, "", ""]);
  줄.push(["메모", 장.메모 || "", "", ""]);
  var 업 = 장.업체별 || [];
  if (업.length) {
    줄.push(["", "", "", ""]);
    줄.push(["업체", "금액", "건수", ""]);
    for (i = 0; i < 업.length; i++) 줄.push([업[i].업체, 업[i].금액, 업[i].건수, ""]);
  }
  줄.push(["", "", "", ""]);

  var 제 = b.제안 || [];
  줄.push(["── 이렇게 하시면 ──", "", "", ""]);
  if (!제.length) 줄.push(["", "따로 드릴 말씀이 없습니다 — 어제는 조용했습니다.", "", ""]);
  for (i = 0; i < 제.length; i++) 줄.push(["", String(제[i]), "", ""]);

  tab.getRange(1, 1, 줄.length, 4).setValues(줄);
  tab.getRange(1, 1, 1, 4).setFontWeight("bold").setFontSize(13);
  tab.getRange(6, 1, 1, 4).setBackground("#1f4e79").setFontColor("white").setFontWeight("bold");
  tab.setColumnWidth(1, 150);
  tab.setColumnWidth(2, 520);
  tab.setColumnWidth(4, 420);
  tab.setFrozenRows(1);

  //  오래된 탭 걷기 — 날짜 꼴 탭만 본다(다른 탭은 안 건드린다)
  try {
    var all = ss.getSheets().filter(function (s) { return /^\d{4}$/.test(s.getName()); });
    if (all.length > _CB_KEEP_TABS_) {
      all.sort(function (a, b2) { return a.getName() < b2.getName() ? -1 : 1; });
      for (i = 0; i < all.length - _CB_KEEP_TABS_; i++) ss.deleteSheet(all[i]);
    }
  } catch (eD) { Logger.log("[BRIEF] 옛 탭 정리 실패: " + eD.message); }

  var gid = tab.getSheetId();
  return ss.getUrl() + "#gid=" + gid;
}

/** 커뮤니티에 글 한 장 */
function _cb_post_(b, url) {
  var 요약 = (b.요약 && b.요약.한줄) || "";
  var 항목 = b.항목 || [];
  var 몸 = [요약, ""];
  for (var i = 0; i < 항목.length; i++) {
    if (항목[i].상태 === "이상없음") continue;
    몸.push("[" + 항목[i].상태 + "] " + 항목[i].갈래 + " — " + 항목[i].한마디);
  }
  if (몸.length === 2) 몸.push("어제는 눈에 띄는 것이 없었습니다.");
  var 장 = b.장부 || {};
  몸.push("");
  몸.push("어제 매입 " + Number(장.매입합 || 0).toLocaleString() + "원 · " + (장.건수 || 0) + "건");
  몸.push("");
  몸.push("자세한 것은 시트에서 보세요 ▶ " + url);

  /*  ★ 「공지」로 올린다 ★ 이 보드는 공지가 맨 위에 선다.
      아침에 제일 먼저 봐야 할 글이라 그 자리가 맞다.                      */
  return csCreateHandoffCard({
    board: _CB_BOARD_,
    level: "공지",
    staff: "자동",
    title: "📋 새벽 브리핑 " + b.날짜 + (b.상태 === "됨" ? "" : " (" + b.상태 + ")"),
    body: 몸.join("\n"),
    link: url,
  });
}

/* ═══════════════════════════════════════════════════════════
   바깥에서 부르는 것
   ═══════════════════════════════════════════════════════════ */

/** 트리거가 부른다 — 새벽 3시 반 */
function csBriefingRun() { return _cb_run_(""); }

/** 메뉴/편집기에서 날을 찍어 돌릴 때 */
function csBriefingRunFor(날) { return _cb_run_(날); }

function _cb_run_(날) {
  //  어제 (한국)
  if (!날) {
    var d = new Date(Date.now() - 24 * 3600 * 1000);
    날 = Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd");
  }
  var got = _cb_fetch_(날);

  /*  ★ 아직 만들 때가 «안 됐으면» 겁주지 않는다 ★  (2026-10-10)
      v2 크론은 새벽 3시에 돈다. 그 전에 손으로 돌리면 브리핑이 아직 없는 것이
      당연한데, 첫날 그것을 「★ 못 받았습니다」로 적어 보드에 주의 글이 올라갔다.
      없는 것과 «아직인 것»은 다르다. 섞으면 진짜 사고 때 그 글을 흘려 보낸다.
      3시 전이고 「없다」는 답이면 조용히 끝낸다.                            */
  if (!got.ok && /브리핑이 없습니다/.test(String(got.error || ""))) {
    var 시 = Number(Utilities.formatDate(new Date(), "Asia/Seoul", "H"));
    if (시 < 3) {
      var 이른 = "아직 만들 때가 안 됐습니다 — v2 크론이 새벽 3시에 만듭니다. (지금 " + 시 + "시)";
      Logger.log(이른);
      return 이른;
    }
  }

  if (!got.ok) {
    /*  ★ 못 받았다는 것도 말한다 ★ 아무 글 없는 아침은 「조용했구나」로 읽힌다. */
    var 글 = "v2 에서 브리핑을 못 받았습니다 — " + got.error +
      "\n\n브리핑이 안 돌았거나 v2 가 안 뜬 것입니다. 어제 상황은 «모르는» 상태입니다.";
    try {
      csCreateHandoffCard({
        board: _CB_BOARD_, level: "주의", staff: "자동",
        title: "⚠ 새벽 브리핑을 못 받았습니다 " + 날, body: 글,
      });
    } catch (e) { Logger.log("[BRIEF] 알림 글도 실패: " + e.message); }
    Logger.log(글);
    return 글;
  }

  var b = got.브리핑;
  if (b.올린때) {
    var 말 = "이미 올렸습니다 (" + b.올린때 + ") — 두 번 올리지 않습니다.";
    Logger.log(말);
    return 말;
  }

  var ss = _cb_file_();
  var url = _cb_write_(ss, b);
  var posted = _cb_post_(b, url);

  //  v2 에 「시트 만들었고 올렸다」를 적어 둔다 — 두 번 올리지 않으려고
  try {
    _csq_call_("post", "/api/briefing", { 날: b.날짜, 시트url: url, 올림: true });
  } catch (e) { Logger.log("[BRIEF] v2 에 표시 실패: " + e.message); }

  var 끝 = "✅ 브리핑 " + b.날짜 + " — 시트에 쓰고 커뮤니티에 올렸습니다.\n" + url +
    (posted && posted.ok ? "" : "\n★ 커뮤니티 글은 실패했습니다: " + ((posted && posted.error) || ""));
  Logger.log(끝);
  return 끝;
}

/** 트리거 걸기 — 새벽 3시 반 (v2 크론이 3시에 돈 뒤) */
function csInstallBriefingTrigger() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "csBriefingRun") ScriptApp.deleteTrigger(all[i]);
  }
  ScriptApp.newTrigger("csBriefingRun").timeBased().atHour(3).nearMinute(30).everyDays(1).create();
  var 말 = "✅ 새벽 브리핑 트리거를 걸었습니다 (03:30).\n" +
    "v2 크론이 03:00 에 돌고, 그 결과를 30분 뒤에 가져옵니다.\n" +
    "트리거 " + ScriptApp.getProjectTriggers().length + "개";
  Logger.log(말);
  return 말;
}

function csRemoveBriefingTrigger() {
  var all = ScriptApp.getProjectTriggers(), n = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "csBriefingRun") { ScriptApp.deleteTrigger(all[i]); n++; }
  }
  return "트리거 " + n + "개를 걷었습니다.";
}
