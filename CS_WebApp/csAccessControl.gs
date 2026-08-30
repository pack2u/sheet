/**
 * CS 웹앱 접근 제어 (구글 로그인 + 허용 계정 목록)
 * ★ 2026-08-25 신규
 *
 * 전제: appsscript.json 이 아래와 같아야 신원 확인이 동작한다.
 *   webapp.access   = "ANYONE"          (구글 로그인 필수)
 *   webapp.executeAs = "USER_ACCESSING" (접속자 권한으로 실행)
 *
 * executeAs 가 USER_DEPLOYING 이면 Session.getActiveUser().getEmail() 이
 * 배포자와 다른 도메인의 방문자에게 빈 문자열을 돌려준다. 허용 목록에
 * gmail.com 계정이 섞여 있으므로 USER_ACCESSING 이 아니면 제한이 걸리지 않는다.
 */

/** 기본 허용 계정. 배포 없이 늘리려면 스크립트 속성 CS_ALLOWED_EMAILS(쉼표 구분)를 쓴다 */
var _CS_AC_DEFAULT_ALLOWED_ = [
  "pack2you6974@gmail.com",
  "pack2u@pack2u.co.kr",
  "gimdongbin5@gmail.com",
  "jskim721210@gmail.com",
  "polo115419@gmail.com",
  "siot5ta@gmail.com",
];

var _CS_AC_PROP_ = "CS_ALLOWED_EMAILS";

/**
 * 앱 안에서 쓸 계정 표시 이름.
 * 구글 계정 프로필 이름과 무관하게 여기 값이 우선한다.
 * 배포 없이 바꾸려면 스크립트 속성 CS_ACCOUNT_NAMES 에
 * "이메일=이름, 이메일=이름" 형식으로 넣는다.
 */
var _CS_AC_DEFAULT_NAMES_ = {
  "pack2u@pack2u.co.kr": "팩투유",
};

var _CS_AC_NAME_PROP_ = "CS_ACCOUNT_NAMES";

/** 접속자 권한으로 실행돼야 접근 가능한 파일들 — 점검 도구가 이 목록을 훑는다 */
function _cs_ac_requiredResources_() {
  return [
    { kind: "sheet", id: _CS_RETURN_LEDGER_ID_, need: "편집", what: "반품관리대장 · CS 커뮤니티 보드" },
    { kind: "sheet", id: _cs_getCSSheetId_(), need: "편집", what: "CS목록 (CS 접수)" },
    { kind: "sheet", id: _CS_MAIN_SHEET_ID, need: "보기", what: "통합조회 · 허브 · 재고" },
    { kind: "sheet", id: _CS_MANUAL_SS_ID_, need: "보기", what: "CS 매뉴얼 DB" },
    { kind: "folder", id: _CS_DAILY_FOLDER_IDS_[0], need: "보기", what: "일일마감 보관 폴더 1" },
    { kind: "folder", id: _CS_DAILY_FOLDER_IDS_[1], need: "보기", what: "일일마감 보관 폴더 2" },
  ];
}

function _cs_ac_norm_(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

/** 허용 목록 (스크립트 속성이 있으면 그것을 우선) */
function _cs_ac_allowed_() {
  var raw = "";
  try {
    raw = String(PropertiesService.getScriptProperties().getProperty(_CS_AC_PROP_) || "").trim();
  } catch (eP) {}

  var list = [];
  if (raw) {
    var parts = raw.split(/[,\s;]+/);
    for (var i = 0; i < parts.length; i++) {
      var one = _cs_ac_norm_(parts[i]);
      if (one && one.indexOf("@") > 0 && list.indexOf(one) === -1) list.push(one);
    }
  }
  if (!list.length) {
    for (var d = 0; d < _CS_AC_DEFAULT_ALLOWED_.length; d++) {
      list.push(_cs_ac_norm_(_CS_AC_DEFAULT_ALLOWED_[d]));
    }
  }
  return list;
}

/** 기본값에 스크립트 속성을 덮어쓴 이메일→표시이름 맵 */
function _cs_ac_nameMap_() {
  var map = {};
  for (var k in _CS_AC_DEFAULT_NAMES_) {
    if (Object.prototype.hasOwnProperty.call(_CS_AC_DEFAULT_NAMES_, k)) {
      map[_cs_ac_norm_(k)] = String(_CS_AC_DEFAULT_NAMES_[k]).trim();
    }
  }

  var raw = "";
  try {
    raw = String(PropertiesService.getScriptProperties().getProperty(_CS_AC_NAME_PROP_) || "").trim();
  } catch (eP) {}
  if (raw) {
    var parts = raw.split(/[,;\n]+/);
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv.length < 2) continue;
      var em = _cs_ac_norm_(kv[0]);
      var nm = String(kv[1]).trim();
      if (em && nm) map[em] = nm;
    }
  }
  return map;
}

/** 이메일에 대응하는 앱 표시 이름. 지정이 없으면 빈 문자열 */
function _cs_ac_displayName_(email) {
  var me = _cs_ac_norm_(email);
  if (!me) return "";
  return String(_cs_ac_nameMap_()[me] || "").trim();
}

/**
 * 지정된 표시 이름 전체.
 * 담당자 목록에 넣어야 누가 읽었는지 집계가 모두에게 같게 보인다.
 */
function _cs_ac_allDisplayNames_() {
  var map = _cs_ac_nameMap_();
  var out = [];
  for (var em in map) {
    if (!Object.prototype.hasOwnProperty.call(map, em)) continue;
    if (map[em] && out.indexOf(map[em]) === -1) out.push(map[em]);
  }
  return out;
}

/** 지금 접속한 사람의 이메일. USER_ACCESSING 이 아니면 빈 문자열이 나올 수 있다 */
function _cs_ac_userEmail_() {
  var email = "";
  try { email = _cs_ac_norm_(Session.getActiveUser().getEmail()); } catch (e1) {}
  if (!email) {
    // USER_ACCESSING 에서는 실행 주체 == 접속자라 이 값도 같다
    try { email = _cs_ac_norm_(Session.getEffectiveUser().getEmail()); } catch (e2) {}
  }
  return email;
}

/**
 * 접근 판정
 * @return {{allowed:boolean, email:string, name:string, reason:string}}
 */
function _cs_ac_check_() {
  var email = _cs_ac_userEmail_();
  if (!email) {
    return {
      allowed: false, email: "", name: "",
      reason: "로그인 계정을 확인할 수 없습니다. 구글 계정으로 로그인한 뒤 다시 열어주세요.",
    };
  }
  var allowed = _cs_ac_allowed_();
  if (allowed.indexOf(email) === -1) {
    return {
      allowed: false, email: email, name: "",
      reason: "접근이 허용되지 않은 계정입니다.",
    };
  }
  return {
    allowed: true, email: email, name: _cs_ac_displayName_(email), reason: "",
  };
}

/**
 * 쓰기 함수용 가드. 통과하면 null, 막히면 에러 객체를 돌려준다.
 * 이 프로젝트는 {ok:...} 와 {success:...} 두 규약이 섞여 있어 둘 다 채운다.
 */
function _cs_ac_guard_() {
  var chk = _cs_ac_check_();
  if (chk.allowed) return null;
  return {
    ok: false,
    success: false,
    denied: true,
    error: chk.reason + (chk.email ? " (" + chk.email + ")" : ""),
  };
}

/** 프런트에서 현재 로그인 계정을 표시하려고 호출 */
function csWhoAmI() {
  var chk = _cs_ac_check_();
  return { ok: chk.allowed, email: chk.email, name: chk.name, reason: chk.reason };
}

// ─────────────────────────────────────────────────────
//  차단 화면
// ─────────────────────────────────────────────────────

function _cs_ac_denyPage_(chk) {
  var email = String(chk.email || "");
  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var html =
    '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>접근 권한 없음</title>' +
    (typeof include === "function" ? include("csFavicon") : "") +
    '<style>' +
    'body{margin:0;background:#0f1117;color:#f0f0f5;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}' +
    '.box{max-width:420px;width:100%;background:#222533;border:1px solid rgba(255,255,255,.07);' +
    'border-radius:16px;padding:28px 24px;text-align:center}' +
    '.ic{font-size:40px;margin-bottom:12px}' +
    'h1{font-size:18px;margin:0 0 10px}' +
    'p{font-size:14px;line-height:1.6;color:#8b8fa3;margin:0 0 8px}' +
    '.me{display:inline-block;margin:12px 0;padding:7px 12px;border-radius:8px;' +
    'background:#1a1d28;color:#9cc7f0;font-size:13px;word-break:break-all}' +
    '.hint{font-size:12px;color:#5c6078;margin-top:16px;line-height:1.6}' +
    'a{color:#9cc7f0}' +
    '</style></head><body><div class="box">' +
    '<div class="ic">🔒</div>' +
    "<h1>접근 권한이 없습니다</h1>" +
    "<p>" + esc(chk.reason) + "</p>" +
    (email ? '<div class="me">' + esc(email) + "</div>" : "") +
    '<p class="hint">허용된 계정으로 로그인해야 합니다.<br>' +
    "여러 구글 계정을 쓰신다면 브라우저에서 계정을 바꾼 뒤 다시 열어주세요.<br><br>" +
    "권한이 필요하면 관리자에게 위 주소를 알려주세요." +
    "</p></div></body></html>";

  var denyOut = HtmlService.createHtmlOutput(html)
    .setTitle("접근 권한 없음")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0");
  if (typeof _cs_withFavicon_ === "function") return _cs_withFavicon_(denyOut);
  return denyOut;
}

// ─────────────────────────────────────────────────────
//  허용 계정 관리
//
//  주의: 스크립트 속성 CS_ALLOWED_EMAILS 가 설정돼 있으면 _cs_ac_allowed_() 는
//  코드의 기본 목록을 아예 무시한다. 즉 속성이 있는 상태에서 기본 목록에만
//  계정을 추가하면 아무 효과가 없다. 아래 두 함수로 어느 쪽이 살아있는지
//  확인하고 필요하면 속성에 반영한다.
// ─────────────────────────────────────────────────────

/** 지금 실제로 적용되는 허용 목록과 그 출처를 보여준다 */
function csShowAllowedEmails() {
  var raw = "";
  try {
    raw = String(PropertiesService.getScriptProperties().getProperty(_CS_AC_PROP_) || "").trim();
  } catch (eP) {}

  var effective = _cs_ac_allowed_();
  var out = [];
  out.push("═══ CS 웹앱 허용 계정 ═══");
  out.push("적용 출처: " + (raw ? "스크립트 속성 " + _CS_AC_PROP_ + " (코드 기본 목록 무시됨)" : "코드 기본 목록"));
  out.push("");
  out.push("적용 중 " + effective.length + "개:");
  effective.forEach(function (e) { out.push("  · " + e); });

  if (raw) {
    var missing = [];
    _CS_AC_DEFAULT_ALLOWED_.forEach(function (d) {
      if (effective.indexOf(_cs_ac_norm_(d)) === -1) missing.push(_cs_ac_norm_(d));
    });
    if (missing.length) {
      out.push("");
      out.push("⚠ 코드 기본 목록에는 있는데 적용되지 않는 계정 " + missing.length + "개:");
      missing.forEach(function (m) { out.push("  · " + m); });
      out.push("");
      out.push("→ csSyncAllowedEmailsProperty() 를 실행하면 속성에 합쳐집니다.");
    }
  }

  var text = out.join("\n");
  Logger.log(text);
  return text;
}

/**
 * 코드 기본 목록에만 있는 계정을 스크립트 속성에 합친다.
 * 속성이 없으면 아무것도 하지 않는다 (그 경우 기본 목록이 이미 적용된다).
 * 속성에서 의도적으로 뺀 계정도 되살아나므로 실행 결과를 확인할 것.
 */
function csSyncAllowedEmailsProperty() {
  var props = PropertiesService.getScriptProperties();
  var raw = String(props.getProperty(_CS_AC_PROP_) || "").trim();

  if (!raw) {
    var msg0 = "스크립트 속성 " + _CS_AC_PROP_ + " 가 없습니다.\n" +
      "코드 기본 목록이 그대로 적용되므로 할 일이 없습니다.";
    Logger.log(msg0);
    return msg0;
  }

  var list = [];
  raw.split(/[,\s;]+/).forEach(function (p) {
    var one = _cs_ac_norm_(p);
    if (one && one.indexOf("@") > 0 && list.indexOf(one) === -1) list.push(one);
  });

  var added = [];
  _CS_AC_DEFAULT_ALLOWED_.forEach(function (d) {
    var one = _cs_ac_norm_(d);
    if (one && list.indexOf(one) === -1) { list.push(one); added.push(one); }
  });

  if (!added.length) {
    var msg1 = "추가할 계정이 없습니다. 속성에 이미 " + list.length + "개가 모두 있습니다.";
    Logger.log(msg1);
    return msg1;
  }

  props.setProperty(_CS_AC_PROP_, list.join(","));
  var msg2 = added.length + "개 계정을 " + _CS_AC_PROP_ + " 에 추가했습니다:\n" +
    added.map(function (a) { return "  · " + a; }).join("\n") +
    "\n\n현재 " + list.length + "개:\n" + list.join(", ");
  Logger.log(msg2);
  return msg2;
}

// ─────────────────────────────────────────────────────
//  점검 도구
// ─────────────────────────────────────────────────────

/**
 * 접근 설정 점검. 허용 계정별로 필수 파일 권한이 있는지 표로 확인한다.
 * USER_ACCESSING 으로 바꾼 뒤 누가 막히는지 미리 알아내는 용도.
 *
 * Apps Script 편집기에서 실행하고 실행 로그를 보면 된다.
 */
function csDiagnoseAccess() {
  var out = [];
  var allowed = _cs_ac_allowed_();

  out.push("═══ CS 웹앱 접근 점검 ═══");
  out.push("실행 계정(getEffectiveUser): " + (function () {
    try { return Session.getEffectiveUser().getEmail() || "(불명)"; } catch (e) { return "(오류)"; }
  })());
  out.push("접속 계정(getActiveUser)  : " + (_cs_ac_userEmail_() || "(빈 값 — executeAs 확인 필요)"));
  out.push("허용 계정 " + allowed.length + "개:");
  for (var a = 0; a < allowed.length; a++) out.push("  · " + allowed[a]);
  out.push("");

  var res = _cs_ac_requiredResources_();
  var problems = [];

  for (var r = 0; r < res.length; r++) {
    var item = res[r];
    out.push("── " + item.what + " (" + item.need + ") ──");
    out.push("   id: " + item.id);

    var file = null;
    try {
      file = DriveApp.getFileById(item.id);
    } catch (eF) {
      try { file = DriveApp.getFolderById(item.id); } catch (eF2) { file = null; }
    }
    if (!file) {
      out.push("   ⛔ 접근 불가 — 실행 계정이 이 파일을 열 수 없습니다");
      problems.push(item.what + ": 실행 계정이 열 수 없음");
      out.push("");
      continue;
    }

    var editors = {};
    var viewers = {};
    var ownerEmail = "";
    try {
      var ow = file.getOwner();
      ownerEmail = _cs_ac_norm_(ow && ow.getEmail ? ow.getEmail() : "");
    } catch (eO) {}
    try {
      var eds = file.getEditors();
      for (var i = 0; i < eds.length; i++) editors[_cs_ac_norm_(eds[i].getEmail())] = true;
    } catch (eE) { out.push("   (편집자 목록 조회 불가 — 공유드라이브일 수 있음)"); }
    try {
      var vws = file.getViewers();
      for (var v = 0; v < vws.length; v++) viewers[_cs_ac_norm_(vws[v].getEmail())] = true;
    } catch (eV) {}

    out.push("   소유자: " + (ownerEmail || "(불명/공유드라이브)"));
    for (var k = 0; k < allowed.length; k++) {
      var who = allowed[k];
      var isOwner = (who === ownerEmail);
      var canEdit = isOwner || !!editors[who];
      var canView = canEdit || !!viewers[who];
      var ok = (item.need === "편집") ? canEdit : canView;
      var mark = ok ? "✅" : "⛔";
      var role = isOwner ? "소유자" : (canEdit ? "편집자" : (canView ? "열람자" : "권한없음"));
      out.push("   " + mark + " " + who + " — " + role);
      if (!ok) problems.push(item.what + " (" + item.need + "): " + who);
    }
    out.push("");
  }

  out.push("═══ 결과 ═══");
  if (!problems.length) {
    out.push("✅ 모든 허용 계정이 필요한 권한을 가지고 있습니다.");
  } else {
    out.push("⛔ 보완 필요 " + problems.length + "건:");
    for (var p = 0; p < problems.length; p++) out.push("  · " + problems[p]);
    out.push("");
    out.push("※ 공유드라이브에 있는 파일은 개별 편집자 목록이 안 보일 수 있습니다.");
    out.push("  그 경우 실제로는 접근 가능할 수 있으니 해당 계정으로 직접 열어 확인하세요.");
  }

  var text = out.join("\n");
  Logger.log(text);
  return text;
}
