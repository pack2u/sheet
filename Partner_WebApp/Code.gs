/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 반품 포털 — 진입점
 *
 *  링크 형식
 *    {exec}?v={업체명}&t={토큰}
 *
 *  토큰이 맞으면 세션키를 심어 포털을 렌더한다.
 *  토큰이 없거나 틀리면 안내 페이지를 준다 (업체명은 노출하지 않는다).
 * ══════════════════════════════════════════════════════════════
 */

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var token = String(p.t || p.token || "").trim();
  var vendorHint = String(p.v || p.vendor || "").trim();

  if (!token) {
    return prpNoticePage_(
      "접속 링크가 필요합니다",
      "운영팀에서 받은 전용 링크로 접속해 주세요. 링크 없이 이 주소만으로는 열 수 없습니다."
    );
  }

  var account = prpResolveByToken_(token, vendorHint);

  if (!account) {
    prpLog_(vendorHint || "(미상)", "인증실패", "토큰 불일치");
    return prpNoticePage_(
      "링크가 유효하지 않습니다",
      "링크가 만료되었거나 재발급되었을 수 있습니다. 운영팀에 새 링크를 요청해 주세요."
    );
  }
  if (account.blocked) {
    prpLog_(account.vendor, "인증차단", "비활성 계정");
    return prpNoticePage_(
      "접속이 중지된 계정입니다",
      "운영팀에 문의해 주세요."
    );
  }

  var sid = prpIssueSession_(account);
  if (!sid) {
    return prpNoticePage_("일시적인 오류", "잠시 후 다시 시도해 주세요.");
  }

  /*  ★ 덮기 전 값을 받아 둔다 ★  (2026-09-18)
      「지난번에 본 뒤로 새로 생긴 것」을 가리는 기준이다.
      여기서 안 받으면 아래 화면에서는 이미 «방금»으로 덮여 있다. */
  /*  ★ 「보기만」 하는 진입 ★  (2026-09-20)
      운영팀이 업체 화면을 확인할 때는 최근접속을 건드리지 않는다.
      건드리면 업체 화면에서 「새로 온 것」 표시가 그 자리에서 지워진다 —
      우리가 본 탓에 업체가 못 보게 되는 일은 없어야 한다.
      토큰은 그대로 검사하므로 이 표시가 문을 여는 열쇠가 되지는 않는다.  */
  var 보기만 = /^(1|true|y|yes)$/i.test(String(p.peek || ""));
  var 지난접속 = 보기만 ? prpPeekLastSeen_(account) : prpTouchAccount_(account);
  prpLog_(
    account.vendor,
    보기만 ? "미리보기" : "접속",
    보기만 ? "포털 진입 (최근접속 안 건드림)" : "포털 진입"
  );

  var tpl = HtmlService.createTemplateFromFile("portal");
  tpl.sid = sid;
  tpl.vendorName = account.vendor;
  tpl.version = PRP_VERSION;
  // ★ 2026-08-27: script 블록 안에는 반드시 이 값을 <?!= ?> 로 넣는다.
  //   `<?= JSON.stringify(x) ?>` 는 script 안에서도 이스케이프되어 따옴표가
  //   값 안으로 들어간다 (SID 가 `"s123"` 이 되어 세션 조회가 항상 실패했다).
  tpl.sidJson = prpJsonForScript_(sid);
  tpl.vendorJson = prpJsonForScript_(account.vendor);
  //  지난번 접속 시각 — 화면이 「그 뒤로 새로 온 소식」을 가린다
  tpl.lastSeenJson = prpJsonForScript_(지난접속 || "");

  return tpl.evaluate()
    .setTitle(account.vendor + " 반품 현황 · Pack2U")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * script 블록 안에 그대로 붙일 JSON 리터럴.
 *
 * `<?!= ?>` (force-print) 로 넣어야 하므로 이스케이프가 없다.
 * 그래서 `</script>` 로 블록이 끊기지 않게 `<` 를 `\u003c` 로 바꿔 둔다.
 * 값은 운영자가 넣은 업체명·서버가 만든 세션키뿐이지만, 여기서 막아 두는 편이 안전하다.
 */
function prpJsonForScript_(v) {
  return JSON.stringify(v == null ? "" : v)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** 인증 실패·안내 페이지 — 어떤 업체가 있는지 단서를 주지 않는다 */
function prpNoticePage_(title, body) {
  var h = [];
  h.push('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">');
  h.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  h.push('<title>Pack2U 협력업체 반품 포털</title>');
  h.push(include("prpFavicon"));
  h.push('<style>');
  h.push('body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;');
  h.push('background:#0f1117;color:#e8eaf0;font-family:-apple-system,BlinkMacSystemFont,');
  h.push('"Segoe UI","Noto Sans KR",sans-serif;padding:24px}');
  h.push('.box{max-width:420px;text-align:center}');
  h.push('.ico{font-size:44px;margin-bottom:14px}');
  h.push('h1{font-size:18px;margin:0 0 12px;font-weight:700}');
  h.push('p{font-size:13.5px;line-height:1.7;color:#9aa0b4;margin:0}');
  h.push('</style></head><body><div class="box">');
  h.push('<div class="ico">&#128274;</div>');
  h.push('<h1>' + prpEsc_(title) + '</h1>');
  h.push('<p>' + prpEsc_(body) + '</p>');
  h.push('</div></body></html>');

  return HtmlService.createHtmlOutput(h.join("\n"))
    .setTitle("Pack2U 협력업체 반품 포털")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0");
}

/** 배포 URL 확인용 — 허브에서 링크를 만들 때 쓴다 */
function prpGetExecUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * 최초 1회 실행. 계정·첨부·로그 탭을 만들고 권한 동의를 받는다.
 * 스크립트 편집기에서 직접 실행한다.
 */
function prpSetup() {
  prpEnsureAccountTab_();
  prpEnsureAttachTab_();
  prpEnsureLogTab_();
  var url = "";
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  Logger.log("[PRP] 준비 완료. 탭 3개 생성/확인.");
  Logger.log("[PRP] exec URL: " + (url || "(웹앱 배포 후 확인)"));
  return url;
}
