/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 반품 포털 — 운영자 관리 도구
 *
 *  포털 본체는 별도 Apps Script 프로젝트(Partner_WebApp/)에 있다.
 *  이 파일은 허브 스프레드시트 메뉴에서 계정·토큰을 관리하는 쪽이다.
 *
 *  토큰이 곧 비밀번호다 (포털이 executeAs USER_DEPLOYING 이라 방문자
 *  이메일을 알 수 없어서 이메일 기반 인증이 불가능하다).
 *  그래서 링크 전달 경로와 회전(재발급) 수단을 여기서 갖춘다.
 * ══════════════════════════════════════════════════════════════
 */

/** 포털이 쓰는 반품관리대장 — Partner_WebApp/prpConfig.gs 의 PRP_LEDGER_ID 와 같아야 한다 */
var _PRP_LEDGER_ID_ = "1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU";
var _PRP_ACCOUNT_TAB_ = "협력업체포털_계정";
var _PRP_LOG_TAB_ = "협력업체포털_로그";
var _PRP_URL_PROP_ = "PRP_WEBAPP_URL";

var _PRP_AC_HEADER_ = [
  "업체명", "접두", "별칭(쉼표구분)", "접속토큰", "활성", "최근접속", "접속수", "메모"
];

// 열 번호 (1-based, 시트 조작용)
var _PRP_C_VENDOR_ = 1, _PRP_C_PREFIX_ = 2, _PRP_C_ALIAS_ = 3, _PRP_C_TOKEN_ = 4,
    _PRP_C_ACTIVE_ = 5, _PRP_C_SEEN_ = 6, _PRP_C_HITS_ = 7, _PRP_C_MEMO_ = 8;

function _prpAccountTab_() {
  var ss = SpreadsheetApp.openById(_PRP_LEDGER_ID_);
  var tab = ss.getSheetByName(_PRP_ACCOUNT_TAB_);
  if (tab) return tab;

  tab = ss.insertSheet(_PRP_ACCOUNT_TAB_);
  tab.getRange(1, 1, 1, _PRP_AC_HEADER_.length).setValues([_PRP_AC_HEADER_])
    .setFontWeight("bold").setBackground("#f1f3f4");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 160);
  tab.setColumnWidth(3, 200);
  tab.setColumnWidth(4, 280);
  tab.setColumnWidth(8, 240);
  return tab;
}

function _prpMakeToken_() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  var seed = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  var out = "";
  for (var i = 0; i < 32; i++) {
    var n = seed.charCodeAt(i % seed.length) + Math.floor(Math.random() * 256);
    out += chars.charAt(n % chars.length);
  }
  return out;
}

function _prpVendorKey_(name) {
  return String(name || "")
    .replace(/\(주\)|\(유\)|주식회사|㈜/g, "")
    .replace(/[\s\-_.·]/g, "")
    .toLowerCase().trim();
}

function _prpPortalUrl_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(_PRP_URL_PROP_) || "";
  } catch (e) {
    return "";
  }
}

/** 포털 exec URL 등록 — Partner_WebApp 배포 후 1회 */
function partnerPortalSetUrl() {
  var ui = SpreadsheetApp.getUi();
  var cur = _prpPortalUrl_();
  var res = ui.prompt(
    "협력업체 반품 포털 URL",
    "Partner_WebApp 배포 후 받은 /exec 주소를 붙여넣으세요.\n\n현재: " + (cur || "(미설정)"),
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var url = String(res.getResponseText() || "").trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    ui.alert("주소 형식이 올바르지 않습니다.\n\nhttps://script.google.com/macros/s/…/exec 형태여야 합니다.");
    return;
  }
  PropertiesService.getScriptProperties().setProperty(_PRP_URL_PROP_, url);
  ui.alert("저장했습니다.\n\n" + url);
}

/**
 * 파일명에서 실제 업체명만 뽑는다.
 * `[협력업체] 부엉이커피 (소비자용) 5%DC` 같은 파생 파일은 같은 업체의 다른 단가표일
 * 뿐이라, 접두어·소비자용·DC율을 떼어내지 않으면 계정 탭에 유령 업체가 생긴다.
 */
function _prpVendorNameFromFileName_(rawName) {
  return String(rawName || "")
    .replace(/^\s*\[협력업체\]\s*_?\s*/, "")
    .replace(/\(\s*소비자용\s*\)/g, "")
    .replace(/\d+(\.\d+)?\s*%\s*DC/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 우리 협력업체 목록을 계정 탭으로 가져온다.
 *
 * 원천은 Drive 의 `[협력업체]` 배포 파일뿐이다 (`_pt_listFiles`).
 * 반품대장에 찍힌 다른 업체명은 우리 협력업체가 아니므로 가져오지 않는다.
 *
 * 업체명은 배포파일 `설정` 탭 B5(거래처명)를 우선한다 — 매핑 SSOT 다.
 * B5 가 비어 있으면 파일명에서 정리한 이름으로 대체한다.
 *
 * 체크박스 화면으로 필요한 업체만 골라 추가한다.
 * 이미 있는 업체는 후보에 올리지 않는다 (토큰이 날아가면 안 된다).
 */
function partnerPortalSyncVendors() {
  var ui = SpreadsheetApp.getUi();

  var vendors, counts;
  try {
    vendors = _prpCollectPartnerVendors_();
  } catch (e) {
    ui.alert("협력업체 파일 목록을 읽지 못했습니다.\n" + (e.message || e));
    return;
  }
  try {
    counts = _prpLedgerVendorCounts_(4);
  } catch (eC) {
    counts = {};
  }

  var acct = _prpAccountIndex_();
  var candidates = vendors.filter(function (v) { return !acct[v.key]; });

  if (!candidates.length) {
    ui.alert(
      "새로 추가할 업체가 없습니다.\n\n" +
      "협력업체 " + vendors.length + "개 모두 계정 탭에 있습니다.\n" +
      "계정 탭: " + _PRP_ACCOUNT_TAB_
    );
    return;
  }

  var items = candidates.map(function (v) {
    var hit = counts[v.key];
    var n = hit ? hit.count : 0;
    var meta = [];
    meta.push(n > 0
      ? '<span class="ok">반품 ' + n + "건</span>"
      : '<span class="muted">반품 0건</span>');
    if (v.source === "파일명") meta.push('<span class="warn">설정B5 비어 있음</span>');
    return {
      id: v.key,
      name: v.name,
      metaHtml: meta.join(" · "),
      // 반품 이력이 있는 업체만 미리 체크한다. 0건은 대개 계정이 필요 없다.
      checked: n > 0,
      sortHint: -n
    };
  });

  items.sort(function (a, b) {
    if (a.sortHint !== b.sortHint) return a.sortHint - b.sortHint;
    return a.name.localeCompare(b.name);
  });

  var payload = {};
  items.forEach(function (it) { payload[it.id] = it.name; });

  _prpShowPicker_({
    title: "업체 목록 동기화",
    heading: "추가할 협력업체 고르기 (" + items.length + ")",
    note: "필요한 업체만 체크하세요. <b>반품 이력이 있는 업체는 미리 체크</b>해 두었습니다.<br>" +
      "체크하지 않은 업체는 추가되지 않고, 다음 동기화 때 다시 후보로 올라옵니다.",
    items: items,
    submitLabel: "선택한 업체 추가",
    serverFn: "prpApplyVendorSelection",
    cachePayload: payload,
    danger: false
  });
}

/**
 * 체크박스 선택 결과 반영 (동기화).
 * 클라이언트가 보낸 키는 믿지 않고, 화면을 띄울 때 캐시에 저장한 후보와 교집합만 쓴다.
 */
function prpApplyVendorSelection(token, ids) {
  try {
    var payload = _prpPickerPayload_(token);
    if (!payload) {
      return { ok: false, error: "선택 목록이 만료되었습니다. 창을 닫고 다시 실행하세요." };
    }

    var acct = _prpAccountIndex_();
    var tab = _prpAccountTab_();
    var rows = [], names = [];
    var seen = {};

    (ids || []).forEach(function (id) {
      var nm = payload[id];
      if (!nm || seen[id]) return;
      if (acct[id]) return; // 그 사이에 이미 등록된 경우
      seen[id] = true;
      names.push(nm);
      rows.push([nm, "", "", "", "FALSE", "", 0, "자동 추가 — 토큰 발급 전"]);
    });

    if (!rows.length) return { ok: false, error: "추가할 업체가 없습니다." };

    tab.getRange(tab.getLastRow() + 1, 1, rows.length, _PRP_AC_HEADER_.length).setValues(rows);
    return {
      ok: true,
      count: rows.length,
      message: rows.length + "개 업체를 추가했습니다.\n\n" +
        names.map(function (n) { return "· " + n; }).join("\n") +
        "\n\n토큰 발급은 '🔑 접속 링크 발급'에서 하세요."
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * 업체 선택 → 토큰 발급(또는 회전) → 링크 표시.
 * 이미 토큰이 있으면 회전 여부를 다시 묻는다 (기존 링크가 즉시 무효가 된다).
 */
function partnerPortalIssueLink() {
  var ui = SpreadsheetApp.getUi();
  var tab = _prpAccountTab_();
  var lastRow = tab.getLastRow();

  if (lastRow < 2) {
    ui.alert("등록된 업체가 없습니다.\n먼저 '🔄 업체 목록 동기화'를 실행하세요.");
    return;
  }

  var rows = tab.getRange(2, 1, lastRow - 1, _PRP_AC_HEADER_.length).getDisplayValues();
  var list = [];
  for (var i = 0; i < rows.length; i++) {
    var nm = String(rows[i][0] || "").trim();
    if (!nm) continue;
    var hasToken = !!String(rows[i][3] || "").trim();
    list.push({ row: i + 2, name: nm, hasToken: hasToken });
  }
  if (!list.length) { ui.alert("업체명이 비어 있습니다."); return; }

  var menu = list.map(function (v, idx) {
    return (idx + 1) + ". " + v.name + (v.hasToken ? " (발급됨)" : "");
  }).join("\n");

  var pick = ui.prompt(
    "접속 링크 발급",
    "번호를 입력하세요.\n\n" + menu,
    ui.ButtonSet.OK_CANCEL
  );
  if (pick.getSelectedButton() !== ui.Button.OK) return;

  var n = parseInt(String(pick.getResponseText() || "").trim(), 10);
  if (!(n >= 1 && n <= list.length)) { ui.alert("번호가 올바르지 않습니다."); return; }
  var target = list[n - 1];

  if (target.hasToken) {
    var ans = ui.alert(
      target.name + " — 토큰 재발급",
      "이미 발급된 토큰이 있습니다.\n새로 발급하면 기존 링크는 즉시 못 쓰게 됩니다.\n\n재발급할까요?",
      ui.ButtonSet.YES_NO
    );
    if (ans !== ui.Button.YES) {
      _prpShowLink_(target.name, String(tab.getRange(target.row, _PRP_C_TOKEN_).getDisplayValue()).trim());
      return;
    }
  }

  var token = _prpMakeToken_();
  tab.getRange(target.row, _PRP_C_TOKEN_).setValue(token);
  tab.getRange(target.row, _PRP_C_ACTIVE_).setValue("TRUE");
  tab.getRange(target.row, _PRP_C_MEMO_).setValue(
    "링크 발급 " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm")
  );
  _prpShowLink_(target.name, token);
}

/** 링크를 복사할 수 있는 모달로 띄운다 (프롬프트로는 긴 URL 을 복사하기 어렵다) */
function _prpShowLink_(vendor, token) {
  var ui = SpreadsheetApp.getUi();
  var base = _prpPortalUrl_();

  if (!base) {
    ui.alert(
      "포털 URL 이 아직 등록되지 않았습니다.\n\n" +
      "'⚙️ 포털 URL 등록'을 먼저 실행하세요.\n\n" +
      "발급된 토큰: " + token
    );
    return;
  }

  var link = base + "?v=" + encodeURIComponent(vendor) + "&t=" + encodeURIComponent(token);
  var esc = function (s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  var h = [];
  h.push('<style>');
  h.push('body{font-family:-apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif;');
  h.push('padding:16px;font-size:13px;line-height:1.6;color:#202124}');
  h.push('h3{margin:0 0 4px;font-size:15px}');
  h.push('p{color:#5f6368;margin:0 0 12px;font-size:12px}');
  h.push('textarea{width:100%;height:88px;font-size:12px;padding:8px;border:1px solid #dadce0;');
  h.push('border-radius:8px;box-sizing:border-box;font-family:monospace}');
  h.push('button{margin-top:10px;padding:9px 14px;border:0;border-radius:8px;');
  h.push('background:#1a73e8;color:#fff;font-weight:600;cursor:pointer}');
  h.push('.warn{margin-top:12px;padding:10px;background:#fef7e0;border-radius:8px;');
  h.push('font-size:11.5px;color:#7c5c00}');
  h.push('</style>');
  h.push('<h3>' + esc(vendor) + ' 접속 링크</h3>');
  h.push('<p>이 링크 하나로 접속합니다. 링크가 곧 비밀번호입니다.</p>');
  h.push('<textarea id="t" readonly>' + esc(link) + '</textarea>');
  h.push('<button onclick="c()">링크 복사</button>');
  h.push('<div class="warn">외부로 유출되면 그 업체 반품 내역이 노출됩니다. ' +
    '유출이 의심되면 같은 메뉴에서 재발급하세요 (기존 링크는 즉시 무효).</div>');
  h.push('<script>');
  h.push('function c(){var t=document.getElementById("t");t.select();');
  h.push('document.execCommand("copy");alert("복사했습니다.");}');
  h.push('<' + '/script>');

  ui.showModalDialog(
    HtmlService.createHtmlOutput(h.join("\n")).setWidth(460).setHeight(330),
    "협력업체 포털 접속 링크"
  );
}

/** 업체 접속 차단 / 해제 */
function partnerPortalToggleActive() {
  var ui = SpreadsheetApp.getUi();
  var tab = _prpAccountTab_();
  var lastRow = tab.getLastRow();
  if (lastRow < 2) { ui.alert("등록된 업체가 없습니다."); return; }

  var rows = tab.getRange(2, 1, lastRow - 1, _PRP_AC_HEADER_.length).getDisplayValues();
  var list = [];
  for (var i = 0; i < rows.length; i++) {
    var nm = String(rows[i][0] || "").trim();
    if (!nm) continue;
    var act = String(rows[i][4] || "").trim().toUpperCase() !== "FALSE";
    list.push({ row: i + 2, name: nm, active: act });
  }

  var menu = list.map(function (v, idx) {
    return (idx + 1) + ". " + v.name + " — " + (v.active ? "사용 중" : "차단");
  }).join("\n");

  var pick = ui.prompt("접속 차단 / 해제", "번호를 입력하세요.\n\n" + menu, ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;

  var n = parseInt(String(pick.getResponseText() || "").trim(), 10);
  if (!(n >= 1 && n <= list.length)) { ui.alert("번호가 올바르지 않습니다."); return; }

  var t = list[n - 1];
  var next = t.active ? "FALSE" : "TRUE";
  tab.getRange(t.row, _PRP_C_ACTIVE_).setValue(next);
  ui.alert(t.name + " → " + (next === "TRUE" ? "사용 중" : "차단") + "으로 바꿨습니다." +
    "\n\n포털 캐시 때문에 최대 5분 뒤에 적용됩니다.");
}

/** 최근 접속·접수 현황 */
function partnerPortalShowActivity() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(_PRP_LEDGER_ID_);
  var log = ss.getSheetByName(_PRP_LOG_TAB_);

  if (!log || log.getLastRow() < 2) {
    ui.alert("아직 접속 기록이 없습니다.");
    return;
  }

  var lastRow = log.getLastRow();
  var take = Math.min(40, lastRow - 1);
  var rows = log.getRange(lastRow - take + 1, 1, take, 4).getDisplayValues().reverse();

  var lines = rows.map(function (r) {
    return r[0] + "  " + r[1] + "  " + r[2] + (r[3] ? "  " + r[3] : "");
  });

  var esc = function (s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var h = '<style>body{font-family:monospace;font-size:11.5px;padding:14px;line-height:1.7}' +
    'h3{font-family:sans-serif;font-size:14px;margin:0 0 10px}</style>' +
    '<h3>포털 최근 활동 ' + take + '건</h3>' +
    esc(lines.join("\n")).replace(/\n/g, "<br>");

  ui.showModalDialog(
    HtmlService.createHtmlOutput(h).setWidth(620).setHeight(460),
    "협력업체 포털 활동"
  );
}

// ══════════════════════════════════════════════════════════════
//  업체명 확인 · 계정 정리
//
//  협력업체 배포파일이 곧 포털 대상은 아니다. 공급처 전용이거나 거래가 끝난
//  업체는 계정을 만들 필요가 없다. 그래서 넣기 전에 눈으로 보고 고를 수 있어야 한다.
// ══════════════════════════════════════════════════════════════

var _PRP_PICK_CACHE_PREFIX_ = "prp_pick_";
var _PRP_PICK_TTL_SEC_ = 900; // 15분

/** 선택 후보를 캐시에 저장하고 토큰을 돌려준다 */
function _prpPickerStash_(payload) {
  var token = _prpMakeToken_();
  try {
    CacheService.getScriptCache().put(
      _PRP_PICK_CACHE_PREFIX_ + token,
      JSON.stringify(payload),
      _PRP_PICK_TTL_SEC_
    );
  } catch (e) {
    return "";
  }
  return token;
}

/** 캐시에 저장한 선택 후보 회수 */
function _prpPickerPayload_(token) {
  if (!token) return null;
  try {
    var raw = CacheService.getScriptCache().get(_PRP_PICK_CACHE_PREFIX_ + String(token));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * 체크박스 선택 화면.
 *
 * 항목이 수십 개가 되면 번호 입력은 실수하기 쉽다. 검색·전체선택과 함께
 * 체크박스로 고르게 하고, 결과 키는 서버에서 캐시와 대조해 검증한다.
 *
 * cfg: { title, heading, note, items[{id,name,metaHtml,checked}],
 *        submitLabel, serverFn, cachePayload, danger }
 */
function _prpShowPicker_(cfg) {
  var ui = SpreadsheetApp.getUi();
  var token = _prpPickerStash_(cfg.cachePayload || {});
  if (!token) {
    ui.alert("선택 목록을 준비하지 못했습니다. 잠시 후 다시 시도하세요.");
    return;
  }

  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  var rows = cfg.items.map(function (it, i) {
    return '<label class="row" data-name="' + esc(String(it.name).toLowerCase()) + '">' +
      '<input type="checkbox" value="' + esc(it.id) + '"' + (it.checked ? " checked" : "") + '>' +
      '<span class="nm">' + esc(it.name) + "</span>" +
      '<span class="meta">' + (it.metaHtml || "") + "</span>" +
      "</label>";
  }).join("");

  var accent = cfg.danger ? "#c5221f" : "#1a73e8";

  var h =
    "<style>" +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;margin:0;padding:14px 16px;color:#202124}' +
    "h3{font-size:15px;margin:0 0 6px}" +
    "p.note{color:#5f6368;font-size:11.5px;line-height:1.6;margin:0 0 12px}" +
    ".bar{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}" +
    "#q{flex:1;min-width:150px;padding:6px 9px;border:1px solid #dadce0;border-radius:6px;font-size:12px;font-family:inherit}" +
    ".mini{padding:5px 9px;border:1px solid #dadce0;background:#fff;border-radius:6px;font-size:11.5px;cursor:pointer;font-family:inherit;color:#3c4043}" +
    ".mini:hover{background:#f1f3f4}" +
    ".list{border:1px solid #e0e0e0;border-radius:8px;max-height:330px;overflow-y:auto}" +
    ".row{display:flex;align-items:center;gap:9px;padding:7px 11px;border-bottom:1px solid #f1f1f1;cursor:pointer}" +
    ".row:last-child{border-bottom:none}.row:hover{background:#f8f9fa}" +
    ".row input{width:15px;height:15px;margin:0;flex:0 0 auto;cursor:pointer}" +
    ".nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".meta{font-size:11px;color:#5f6368;flex:0 0 auto;text-align:right}" +
    ".ok{color:#137333;font-weight:600}.warn{color:#b06000;font-weight:600}.muted{color:#9aa0a6}" +
    ".foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px}" +
    "#cnt{font-size:12px;color:#5f6368}" +
    ".btns{display:flex;gap:7px}" +
    ".btn{padding:8px 15px;border:none;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}" +
    ".btn-go{background:" + accent + ";color:#fff}.btn-go:disabled{background:#dadce0;color:#80868b;cursor:default}" +
    ".btn-no{background:#fff;color:#3c4043;border:1px solid #dadce0}" +
    "#msg{margin-top:9px;font-size:12px;color:#c5221f;white-space:pre-wrap}" +
    "</style>" +
    "<h3>" + esc(cfg.heading) + "</h3>" +
    '<p class="note">' + (cfg.note || "") + "</p>" +
    '<div class="bar">' +
    '<input id="q" type="text" placeholder="업체명 검색">' +
    '<button class="mini" onclick="setAll(true)">전체 선택</button>' +
    '<button class="mini" onclick="setAll(false)">전체 해제</button>' +
    "</div>" +
    '<div class="list" id="list">' + rows + "</div>" +
    '<div class="foot"><span id="cnt"></span><span class="btns">' +
    '<button class="btn btn-no" onclick="google.script.host.close()">취소</button>' +
    '<button class="btn btn-go" id="go" onclick="submit()">' + esc(cfg.submitLabel) + "</button>" +
    "</span></div>" +
    '<div id="msg"></div>' +
    "<script>" +
    "var TOKEN=" + JSON.stringify(token) + ";" +
    "var FN=" + JSON.stringify(cfg.serverFn) + ";" +
    "var LABEL=" + JSON.stringify(cfg.submitLabel) + ";" +
    "function boxes(){return Array.prototype.slice.call(document.querySelectorAll('.row input'));}" +
    "function visibleBoxes(){return boxes().filter(function(b){return b.parentNode.style.display!=='none';});}" +
    "function sync(){var n=boxes().filter(function(b){return b.checked;}).length;" +
    "document.getElementById('cnt').textContent=n+'개 선택';" +
    "document.getElementById('go').disabled=(n===0);}" +
    "function setAll(v){visibleBoxes().forEach(function(b){b.checked=v;});sync();}" +
    "document.getElementById('list').addEventListener('change',sync);" +
    "document.getElementById('q').addEventListener('input',function(){" +
    "var q=this.value.trim().toLowerCase();" +
    "Array.prototype.slice.call(document.querySelectorAll('.row')).forEach(function(r){" +
    "r.style.display=(!q||r.getAttribute('data-name').indexOf(q)>=0)?'flex':'none';});});" +
    "function submit(){" +
    "var ids=boxes().filter(function(b){return b.checked;}).map(function(b){return b.value;});" +
    "if(!ids.length)return;" +
    "var go=document.getElementById('go');go.disabled=true;go.textContent='처리 중…';" +
    "document.getElementById('msg').textContent='';" +
    "google.script.run.withSuccessHandler(function(res){" +
    "if(res&&res.ok){document.getElementById('msg').style.color='#137333';" +
    "document.getElementById('msg').textContent=res.message||'완료';" +
    "setTimeout(function(){google.script.host.close();},1400);return;}" +
    "go.disabled=false;go.textContent=LABEL;" +
    "document.getElementById('msg').style.color='#c5221f';" +
    "document.getElementById('msg').textContent=(res&&res.error)||'실패';})" +
    ".withFailureHandler(function(err){go.disabled=false;go.textContent=LABEL;" +
    "document.getElementById('msg').style.color='#c5221f';" +
    "document.getElementById('msg').textContent=String((err&&err.message)||err);})" +
    "[FN](TOKEN,ids);}" +
    "sync();" +
    "</script>";

  ui.showModalDialog(
    HtmlService.createHtmlOutput(h).setWidth(720).setHeight(600),
    cfg.title
  );
}

/**
 * 반품대장 D열(업체명)에 실제로 쓰인 값과 건수.
 * @return {Object} { vendorKey: { label, count } }
 */
function _prpLedgerVendorCounts_(monthsBack) {
  var ss = SpreadsheetApp.openById(_PRP_LEDGER_ID_);
  var tabs = _prpMonthTabs_(ss).slice(0, monthsBack || 4);
  var seen = {};
  for (var m = 0; m < tabs.length; m++) {
    var t = tabs[m];
    var lr = t.getLastRow();
    if (lr < 5) continue;
    var vals = t.getRange(1, 4, lr, 1).getDisplayValues();
    for (var r = 0; r < vals.length; r++) {
      var v = String(vals[r][0] || "").trim();
      if (!v || v.length > 30) continue;
      if (/업체명|판매처|발주업체/.test(v)) continue;
      var k = _prpVendorKey_(v);
      if (!k) continue;
      if (!seen[k]) seen[k] = { label: v, count: 0 };
      seen[k].count++;
    }
  }
  return seen;
}

/**
 * 배포파일에서 업체명 후보를 뽑는다.
 * 설정 탭 B5(거래처명)가 매핑 SSOT라 그걸 우선하고, 비어 있으면 파일명을 정리해 쓴다.
 * 파일을 하나씩 열기 때문에 업체 수가 많으면 느리다.
 */
function _prpCollectPartnerVendors_() {
  var files = _pt_listFiles();
  var byKey = {};
  var order = [];

  for (var i = 0; i < files.length; i++) {
    var raw = String(files[i].name || "");
    var fromFile = _prpVendorNameFromFileName_(raw);
    if (!fromFile) continue;

    var b5 = "";
    try {
      if (files[i].id) {
        var st = SpreadsheetApp.openById(files[i].id).getSheetByName("설정");
        if (st) b5 = String(st.getRange("B5").getDisplayValue() || "").trim();
      }
    } catch (e) {}

    var name = b5 || fromFile;
    var key = _prpVendorKey_(name);
    if (!key) continue;

    if (!byKey[key]) {
      byKey[key] = {
        key: key,
        name: name,
        source: b5 ? "설정B5" : "파일명",
        settingB5: b5,
        files: [raw]
      };
      order.push(key);
    } else {
      byKey[key].files.push(raw);
    }
  }

  return order.map(function (k) { return byKey[k]; });
}

/** 계정 탭 현황을 vendorKey 로 색인 */
function _prpAccountIndex_() {
  var tab = _prpAccountTab_();
  var lastRow = tab.getLastRow();
  var idx = {};
  if (lastRow < 2) return idx;

  var rows = tab.getRange(2, 1, lastRow - 1, _PRP_AC_HEADER_.length).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    var nm = String(rows[i][0] || "").trim();
    if (!nm) continue;
    var info = {
      row: i + 2,
      name: nm,
      hasToken: !!String(rows[i][3] || "").trim(),
      active: String(rows[i][4] || "").trim().toUpperCase() !== "FALSE"
    };
    var k = _prpVendorKey_(nm);
    if (k) idx[k] = info;

    String(rows[i][2] || "").split(/[,;]/).forEach(function (a) {
      var ak = _prpVendorKey_(a);
      if (ak && !idx[ak]) idx[ak] = info;
    });
  }
  return idx;
}

/**
 * 업체명 목록 확인 — 읽기 전용.
 * 배포파일에서 뽑은 이름, 그 출처, 계정·토큰 상태, 반품대장 건수를 한 화면에 보여준다.
 * 이걸 보고 어느 업체가 필요 없는지 판단한 뒤 동기화에서 제외하면 된다.
 */
function partnerPortalListVendors() {
  var ui = SpreadsheetApp.getUi();

  var vendors, counts, acct;
  try {
    vendors = _prpCollectPartnerVendors_();
    counts = _prpLedgerVendorCounts_(4);
    acct = _prpAccountIndex_();
  } catch (e) {
    ui.alert("목록을 만들지 못했습니다.\n" + (e.message || e));
    return;
  }

  if (!vendors.length) {
    ui.alert("협력업체 배포파일을 찾지 못했습니다.\n\n폴더 설정(_PT.FOLDER_ID)을 확인하세요.");
    return;
  }

  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  var rowsHtml = [];
  var needAccount = 0;
  for (var i = 0; i < vendors.length; i++) {
    var v = vendors[i];
    var a = acct[v.key];
    var hit = counts[v.key];

    var acctCell = !a ? '<span class="bad">계정 없음</span>'
      : (!a.hasToken ? '<span class="warn">토큰 미발급</span>'
        : (a.active ? '<span class="ok">사용 중</span>' : '<span class="warn">차단</span>'));
    if (!a) needAccount++;

    var cntCell = hit ? String(hit.count) + "건" : '<span class="muted">0건</span>';
    var srcCell = v.source === "설정B5" ? v.source : '<span class="warn">' + v.source + "</span>";
    var extra = v.files.length > 1 ? '<span class="muted"> +' + (v.files.length - 1) + "</span>" : "";

    rowsHtml.push(
      "<tr><td>" + (i + 1) + "</td><td><b>" + esc(v.name) + "</b></td><td>" + srcCell +
      "</td><td>" + acctCell + "</td><td class=\"r\">" + cntCell +
      "</td><td class=\"muted\">" + esc(v.files[0]) + extra + "</td></tr>"
    );
  }

  // 계정 탭에만 있고 배포파일이 없는 업체 — 정리 후보
  var orphan = [];
  var vendorKeys = {};
  vendors.forEach(function (v) { vendorKeys[v.key] = true; });
  Object.keys(acct).forEach(function (k) {
    if (vendorKeys[k]) return;
    var a = acct[k];
    if (orphan.some(function (o) { return o.row === a.row; })) return;
    orphan.push(a);
  });

  var orphanHtml = "";
  if (orphan.length) {
    orphanHtml = '<h3 class="s2">배포파일이 없는 계정 (' + orphan.length + ') — 정리 후보</h3><table>' +
      '<tr><th>업체명</th><th>행</th><th>상태</th></tr>' +
      orphan.map(function (o) {
        return "<tr><td>" + esc(o.name) + "</td><td>" + o.row + "</td><td>" +
          (o.hasToken ? '<span class="warn">토큰 발급됨</span>' : '<span class="muted">토큰 없음</span>') +
          "</td></tr>";
      }).join("") + "</table>";
  }

  var h =
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;padding:14px;color:#222}' +
    'h3{font-size:14px;margin:0 0 4px}h3.s2{margin:22px 0 4px}' +
    'p.note{color:#666;font-size:11px;margin:0 0 10px;line-height:1.6}' +
    'table{border-collapse:collapse;width:100%}' +
    'th,td{border-bottom:1px solid #e3e3e3;padding:5px 7px;text-align:left;vertical-align:top}' +
    'th{background:#f6f6f6;font-size:11px;color:#555;font-weight:600}' +
    'td.r{text-align:right}' +
    '.ok{color:#137333;font-weight:600}.warn{color:#b06000;font-weight:600}' +
    '.bad{color:#c5221f;font-weight:600}.muted{color:#999}' +
    '</style>' +
    "<h3>협력업체 업체명 (" + vendors.length + ")</h3>" +
    '<p class="note">업체명은 배포파일 <b>설정 탭 B5</b>를 우선합니다. 출처가 <span class="warn">파일명</span>이면 B5가 비어 있다는 뜻이고, ' +
    '반품대장 표기와 어긋날 위험이 있습니다.<br>건수는 반품대장 최근 4개 월별 탭 기준입니다. ' +
    "계정이 필요 없는 업체는 <b>업체 목록 동기화</b>에서 번호로 제외하세요.</p>" +
    '<table><tr><th>#</th><th>업체명</th><th>출처</th><th>계정</th><th>반품</th><th>배포파일</th></tr>' +
    rowsHtml.join("") + "</table>" +
    '<p class="note" style="margin-top:10px">계정 없음: ' + needAccount + "개</p>" +
    orphanHtml;

  ui.showModalDialog(
    HtmlService.createHtmlOutput(h).setWidth(860).setHeight(600),
    "협력업체 업체명 확인"
  );
}

/**
 * 계정 탭에서 불필요한 행을 지운다.
 * 토큰이 발급된 행은 업체가 쓰고 있을 수 있어 목록에서 제외한다
 * (먼저 '🚦 접속 차단'으로 막고 나서 지우는 게 순서다).
 */
function partnerPortalRemoveAccounts() {
  var ui = SpreadsheetApp.getUi();
  var tab = _prpAccountTab_();
  var lastRow = tab.getLastRow();
  if (lastRow < 2) { ui.alert("등록된 업체가 없습니다."); return; }

  var rows = tab.getRange(2, 1, lastRow - 1, _PRP_AC_HEADER_.length).getDisplayValues();

  var counts;
  try { counts = _prpLedgerVendorCounts_(4); } catch (eC) { counts = {}; }

  // 배포파일이 남아 있는 업체는 지워도 다음 동기화에 다시 올라온다. 표시해 준다.
  var partnerKeys = {};
  try {
    var pFiles = _pt_listFiles();
    for (var p = 0; p < pFiles.length; p++) {
      var pk = _prpVendorKey_(_prpVendorNameFromFileName_(pFiles[p].name));
      if (pk) partnerKeys[pk] = true;
    }
  } catch (ePf) {}

  var items = [], payload = {}, locked = 0;
  for (var i = 0; i < rows.length; i++) {
    var nm = String(rows[i][0] || "").trim();
    if (!nm) continue;
    if (String(rows[i][3] || "").trim()) { locked++; continue; }

    var key = _prpVendorKey_(nm);
    var hit = counts[key];
    var meta = [];
    meta.push(hit && hit.count
      ? '<span class="warn">반품 ' + hit.count + "건</span>"
      : '<span class="muted">반품 0건</span>');
    meta.push(partnerKeys[key]
      ? '<span class="muted">배포파일 있음</span>'
      : '<span class="ok">배포파일 없음</span>');

    var rowNum = i + 2;
    payload[String(rowNum)] = nm;
    items.push({ id: String(rowNum), name: nm, metaHtml: meta.join(" · "), checked: false });
  }

  if (!items.length) {
    ui.alert(
      "지울 수 있는 행이 없습니다.\n\n" +
      "토큰이 발급된 업체는 여기서 지울 수 없습니다 (" + locked + "개).\n" +
      "먼저 '🚦 접속 차단 / 해제'로 막으세요."
    );
    return;
  }

  _prpShowPicker_({
    title: "계정 행 삭제",
    heading: "지울 계정 고르기 (" + items.length + ")",
    note: "체크한 행을 지웁니다. <b>되돌릴 수 없습니다.</b><br>" +
      '<span class="ok">배포파일 없음</span>은 유령 행이라 지워도 다시 안 생깁니다. ' +
      '<span class="muted">배포파일 있음</span>은 다음 동기화에 후보로 다시 올라옵니다.' +
      (locked ? "<br>토큰이 발급된 " + locked + "개는 목록에서 제외했습니다." : ""),
    items: items,
    submitLabel: "선택한 행 삭제",
    serverFn: "prpApplyAccountRemoval",
    cachePayload: payload,
    danger: true
  });
}

/** 체크박스 선택 결과 반영 (계정 행 삭제) */
function prpApplyAccountRemoval(token, ids) {
  try {
    var payload = _prpPickerPayload_(token);
    if (!payload) {
      return { ok: false, error: "선택 목록이 만료되었습니다. 창을 닫고 다시 실행하세요." };
    }

    var tab = _prpAccountTab_();
    var targets = [];
    (ids || []).forEach(function (id) {
      var nm = payload[String(id)];
      var row = parseInt(id, 10);
      if (!nm || !(row >= 2)) return;
      // 화면을 띄운 뒤 시트가 바뀌었을 수 있다. 행의 업체명과 토큰을 다시 확인한다.
      var cur = tab.getRange(row, 1, 1, _PRP_AC_HEADER_.length).getDisplayValues()[0];
      if (String(cur[0] || "").trim() !== nm) return;
      if (String(cur[3] || "").trim()) return; // 그 사이 토큰 발급됨
      targets.push({ row: row, name: nm });
    });

    if (!targets.length) {
      return { ok: false, error: "지울 행이 없습니다. 시트가 변경되었을 수 있으니 다시 실행하세요." };
    }

    // 아래에서부터 지워야 행 번호가 밀리지 않는다
    targets.sort(function (a, b) { return b.row - a.row; });
    for (var t = 0; t < targets.length; t++) tab.deleteRow(targets[t].row);

    return {
      ok: true,
      count: targets.length,
      message: targets.length + "개 행을 지웠습니다.\n\n" +
        targets.map(function (x) { return "· " + x.name; }).join("\n")
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ══════════════════════════════════════════════════════════════
//  반품대장 구조 정비
//
//  1) 반품송장번호 열 추가 — 지금까지 N열 비고에 "반품송장: …" 텍스트로만
//     들어가 있어서 필터·정렬·집계가 불가능했다. 전용 열로 뺀다.
//  2) 과거 데이터 이관 — N열의 그 텍스트를 새 열로 복사한다.
//  3) 업체명 드롭다운 — 표기가 흔들리면 포털에서 업체가 자기 건을 못 본다.
//
//  ★ 열은 반드시 맨 끝에 붙인다.
//    csOrderSearch.gs 가 A열(상태)과 M열(반품비 폴백)을 위치로 하드코딩하고
//    있어서, 중간에 삽입하면 그 두 개가 조용히 어긋난다.
// ══════════════════════════════════════════════════════════════

var _PRP_RETINV_HEADER_ = "반품송장번호";

/** 월별(yyyyMM) 탭 목록 — 최신순 */
function _prpMonthTabs_(ss) {
  var out = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (/^\d{6}$/.test(String(sheets[i].getName() || "").trim())) out.push(sheets[i]);
  }
  out.sort(function (a, b) { return b.getName().localeCompare(a.getName()); });
  return out;
}

/** 헤더 행 찾기 — csOrderSearch.gs _cs_findReturnHeaderRow_ 와 같은 규칙 */
function _prpFindHeaderRow_(values) {
  var n = Math.min(values.length, 40);
  for (var i = 0; i < n; i++) {
    var row = values[i] || [];
    var joined = "", hits = 0;
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] || "").replace(/\s/g, "");
      if (!cell) continue;
      joined += cell + "|";
      if (/반품접수날짜|접수날짜|접수일자/.test(cell)) hits++;
      if (cell === "접수자") hits++;
      if (/원송장번호|원송장/.test(cell)) hits++;
      if (/상품명|품목명/.test(cell) && !/코드/.test(cell)) hits++;
    }
    if (hits >= 2) return i;
    if (/반품접수날짜|접수날짜/.test(joined)) return i;
  }
  return -1;
}

/** 헤더 배열에서 반품송장 열 위치 (0-index, 없으면 -1) */
function _prpFindRetInvCol_(header) {
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || "").replace(/\s/g, "");
    if (h && /반품송장|회수송장/.test(h)) return i;
  }
  return -1;
}

/** 비고 열 위치 */
function _prpFindNoticeCol_(header) {
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || "").replace(/\s/g, "");
    if (h && /고객요청|유의사항|비고/.test(h)) return i;
  }
  return -1;
}

/** 비고 텍스트에서 반품송장 추출 */
function _prpRetInvFromNotice_(text) {
  var s = String(text || "");
  var m = s.match(/반품송장\s*[:：]\s*([0-9\-]+)/i);
  if (m) return String(m[1] || "").trim();
  m = s.match(/회수송장\s*[:：]\s*([0-9\-]+)/i);
  if (m) return String(m[1] || "").trim();
  return "";
}

function _prpColLetter_(n) {
  var s = "";
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * 모든 월별 탭 맨 끝에 반품송장번호 열을 만든다.
 * 이미 있는 탭은 건너뛴다. 새 월 탭은 직전 탭 복사로 생기므로 이후 자동 승계된다.
 */
function partnerPortalEnsureReturnInvoiceColumn() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(_PRP_LEDGER_ID_);
  var tabs = _prpMonthTabs_(ss);

  if (!tabs.length) { ui.alert("월별(yyyyMM) 탭을 찾지 못했습니다."); return; }

  var ok = ui.alert(
    "반품송장번호 열 추가",
    "월별 탭 " + tabs.length + "개의 맨 끝에 '" + _PRP_RETINV_HEADER_ + "' 열을 만듭니다.\n" +
    "기존 열은 이동하지 않습니다 (맨 끝에만 붙습니다).\n\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (ok !== ui.Button.YES) return;

  var added = [], skipped = [], failed = [];

  for (var t = 0; t < tabs.length; t++) {
    var tab = tabs[t];
    try {
      var lastCol = Math.max(tab.getLastColumn(), 14);
      var scan = Math.min(Math.max(tab.getLastRow(), 10), 40);
      var values = tab.getRange(1, 1, scan, lastCol).getDisplayValues();
      var headerIdx = _prpFindHeaderRow_(values);
      if (headerIdx < 0) { failed.push(tab.getName() + " (헤더 없음)"); continue; }

      if (_prpFindRetInvCol_(values[headerIdx]) >= 0) { skipped.push(tab.getName()); continue; }

      var target = lastCol + 1;
      if (tab.getMaxColumns() < target) {
        tab.insertColumnsAfter(tab.getMaxColumns(), target - tab.getMaxColumns());
      }

      var cell = tab.getRange(headerIdx + 1, target);
      // 헤더 서식은 옆 칸에서 물려받아 대장 모양을 유지한다
      try {
        tab.getRange(headerIdx + 1, target - 1).copyTo(cell, { formatOnly: true });
      } catch (eFmt) {}
      cell.setValue(_PRP_RETINV_HEADER_);
      tab.setColumnWidth(target, 130);

      added.push(tab.getName() + " (" + _prpColLetter_(target) + "열)");
    } catch (e) {
      failed.push(tab.getName() + " (" + e.message + ")");
    }
  }

  var msg = [];
  msg.push("■ 추가 (" + added.length + ")");
  msg.push(added.length ? added.join("\n") : "(없음)");
  msg.push("");
  msg.push("■ 이미 있음 (" + skipped.length + ")");
  msg.push(skipped.length ? skipped.join(", ") : "(없음)");
  if (failed.length) {
    msg.push("");
    msg.push("■ 실패 (" + failed.length + ")");
    msg.push(failed.join("\n"));
  }
  msg.push("");
  msg.push("다음: '📤 과거 반품송장 이관 (미리보기)'를 실행하세요.");

  ui.alert("반품송장번호 열 추가", msg.join("\n"), ui.ButtonSet.OK);
}

/**
 * N열 비고의 "반품송장: …" 을 전용 열로 복사한다.
 * 비고 원문은 지우지 않는다 — 그게 접수 당시 이력이고, CS앱 타임라인은
 * 그 줄을 meta 로 보고 이미 숨긴다. 지워서 얻을 게 없고 되돌릴 수도 없다.
 *
 * @param {boolean} apply true 면 실제로 쓴다
 */
function partnerPortalMigrateReturnInvoice(apply) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(_PRP_LEDGER_ID_);
  var tabs = _prpMonthTabs_(ss);
  if (!tabs.length) { ui.alert("월별 탭을 찾지 못했습니다."); return; }

  var willWrite = (apply === true);
  var report = [], totalHit = 0, totalSkip = 0, noCol = [];

  for (var t = 0; t < tabs.length; t++) {
    var tab = tabs[t];
    var lastRow = tab.getLastRow();
    var lastCol = Math.max(tab.getLastColumn(), 14);
    if (lastRow < 5) continue;

    var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    var headerIdx = _prpFindHeaderRow_(values);
    if (headerIdx < 0) continue;

    var retCol = _prpFindRetInvCol_(values[headerIdx]);
    var noticeCol = _prpFindNoticeCol_(values[headerIdx]);
    if (retCol < 0) { noCol.push(tab.getName()); continue; }
    if (noticeCol < 0) continue;

    var hit = 0, skip = 0;
    for (var r = headerIdx + 1; r < values.length; r++) {
      if (String(values[r][retCol] || "").trim()) { skip++; continue; }
      var found = _prpRetInvFromNotice_(values[r][noticeCol]);
      if (!found) continue;
      hit++;
      if (willWrite) tab.getRange(r + 1, retCol + 1).setValue(found);
    }
    totalHit += hit;
    totalSkip += skip;
    if (hit || skip) report.push(tab.getName() + " — 이관 " + hit + "건, 이미 있음 " + skip + "건");
  }

  var msg = [];
  msg.push(willWrite ? "■ 이관 완료" : "■ 미리보기 (아직 쓰지 않았습니다)");
  msg.push("");
  msg.push(report.length ? report.join("\n") : "이관할 건이 없습니다.");
  msg.push("");
  msg.push("합계: " + totalHit + "건 " + (willWrite ? "이관됨" : "이관 예정"));
  if (noCol.length) {
    msg.push("");
    msg.push("■ 반품송장 열이 없는 탭 (" + noCol.length + ") — 열 추가 먼저");
    msg.push(noCol.join(", "));
  }
  if (!willWrite && totalHit) {
    msg.push("");
    msg.push("반영하려면 '📤 과거 반품송장 이관 (반영)'을 실행하세요.");
  }

  ui.alert("과거 반품송장 이관", msg.join("\n"), ui.ButtonSet.OK);
}

function partnerPortalMigrateReturnInvoicePreview() {
  partnerPortalMigrateReturnInvoice(false);
}

function partnerPortalMigrateReturnInvoiceApply() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert(
    "과거 반품송장 이관",
    "N열 비고의 '반품송장: …' 값을 반품송장번호 열로 복사합니다.\n" +
    "비고 원문은 그대로 남깁니다 (접수 이력).\n\n반영할까요?",
    ui.ButtonSet.YES_NO
  );
  if (ok !== ui.Button.YES) return;
  partnerPortalMigrateReturnInvoice(true);
}

/**
 * 업체명 열(D)에 드롭다운을 건다.
 *
 * 목록은 **우리 협력업체(포털 계정 탭)만** 넣는다.
 * 반품대장 D열에는 협력업체가 아닌 표기도 섞여 있지만 그건 포털과 무관하므로
 * 목록에 올리지 않는다.
 *
 * 다만 입력을 차단하지는 않는다(allowInvalid=true). 반품대장은 협력업체 전용이
 * 아니라서 목록 밖 업체도 접수해야 하기 때문이다. 목록 밖 값은 경고 표시만 뜬다.
 */
function partnerPortalApplyVendorValidation() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(_PRP_LEDGER_ID_);
  var tabs = _prpMonthTabs_(ss);
  if (!tabs.length) { ui.alert("월별 탭을 찾지 못했습니다."); return; }

  var names = [], seen = {};
  var acTab = _prpAccountTab_();
  var acLast = acTab.getLastRow();
  if (acLast >= 2) {
    var acVals = acTab.getRange(2, 1, acLast - 1, 1).getDisplayValues();
    for (var i = 0; i < acVals.length; i++) {
      var nm = String(acVals[i][0] || "").trim();
      var k = _prpVendorKey_(nm);
      if (nm && k && !seen[k]) { seen[k] = true; names.push(nm); }
    }
  }

  if (!names.length) {
    ui.alert(
      "계정 탭에 업체가 없습니다.\n\n먼저 '🔄 업체 목록 동기화'를 실행하세요.\n" +
      "계정 탭: " + _PRP_ACCOUNT_TAB_
    );
    return;
  }
  names.sort();

  var ok = ui.alert(
    "업체명 드롭다운 적용",
    "협력업체 " + names.length + "개로 월별 탭 " + tabs.length + "개의 D열에 드롭다운을 설정합니다.\n\n" +
    "· 협력업체가 아닌 업체명은 목록에 넣지 않습니다\n" +
    "· 목록 밖 값도 입력은 되지만 경고 표시가 뜹니다\n" +
    "· 기존에 입력된 값은 바뀌지 않습니다\n\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (ok !== ui.Button.YES) return;

  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(names, true)
    .setAllowInvalid(true)
    .setHelpText("포털 격리는 이 값으로 판정합니다. 목록에서 고르세요.")
    .build();

  var done = [], failed = [];
  for (var s = 0; s < tabs.length; s++) {
    var tab = tabs[s];
    try {
      var lastCol2 = Math.max(tab.getLastColumn(), 14);
      var scan2 = Math.min(Math.max(tab.getLastRow(), 10), 40);
      var vals = tab.getRange(1, 1, scan2, lastCol2).getDisplayValues();
      var hIdx = _prpFindHeaderRow_(vals);
      if (hIdx < 0) { failed.push(tab.getName() + " (헤더 없음)"); continue; }

      var firstRow = hIdx + 2;
      var maxRow = tab.getMaxRows();
      if (maxRow < firstRow) { failed.push(tab.getName() + " (행 없음)"); continue; }

      tab.getRange(firstRow, 4, maxRow - firstRow + 1, 1).setDataValidation(rule);
      done.push(tab.getName());
    } catch (e) {
      failed.push(tab.getName() + " (" + e.message + ")");
    }
  }

  var msg = [];
  msg.push("적용 (" + done.length + "): " + (done.join(", ") || "(없음)"));
  if (failed.length) {
    msg.push("");
    msg.push("실패 (" + failed.length + "):");
    msg.push(failed.join("\n"));
  }
  msg.push("");
  msg.push("목록에 넣은 협력업체 (" + names.length + "):");
  msg.push(names.join(", "));

  ui.alert("업체명 드롭다운", msg.join("\n"), ui.ButtonSet.OK);
}

/**
 * 계정 설정 점검.
 * 반품대장 업체명(D열) 표기와 계정 탭 업체명이 어긋나면 업체가 자기 건을
 * 하나도 못 본다. 실제 대장 값과 맞춰 본다.
 */
function partnerPortalDiagnose() {
  var ui = SpreadsheetApp.getUi();
  var tab = _prpAccountTab_();
  var lastRow = tab.getLastRow();

  if (lastRow < 2) { ui.alert("등록된 업체가 없습니다."); return; }
  var accounts = tab.getRange(2, 1, lastRow - 1, _PRP_AC_HEADER_.length).getDisplayValues();

  var monthsBack = 4;
  var seen = _prpLedgerVendorCounts_(monthsBack);

  var okList = [], noToken = [], noMatch = [];
  var accountKeys = {};

  for (var i = 0; i < accounts.length; i++) {
    var nm = String(accounts[i][0] || "").trim();
    if (!nm) continue;
    var key = _prpVendorKey_(nm);
    accountKeys[key] = true;

    var aliasKeys = String(accounts[i][2] || "").split(/[,;]/)
      .map(_prpVendorKey_).filter(function (x) { return !!x; });
    aliasKeys.forEach(function (a) { accountKeys[a] = true; });

    var hit = seen[key];
    if (!hit) {
      for (var a = 0; a < aliasKeys.length && !hit; a++) hit = seen[aliasKeys[a]];
    }

    var hasToken = !!String(accounts[i][3] || "").trim();
    if (!hasToken) noToken.push(nm);
    if (!hit) noMatch.push(nm);
    else if (hasToken) okList.push(nm + " (" + hit.count + "건)");
  }

  // 우리 협력업체 배포파일 이름 (계정 탭과 별개 — 계정 누락을 잡기 위한 기준)
  var partnerKeys = {};
  try {
    var pFiles = _pt_listFiles();
    for (var p = 0; p < pFiles.length; p++) {
      var pk = _prpVendorKey_(_prpVendorNameFromFileName_(pFiles[p].name));
      if (pk) partnerKeys[pk] = true;
    }
  } catch (ePf) {}

  // 대장에는 있는데 계정이 없는 경우.
  // 우리 협력업체인 것만 문제로 본다. 그 외 업체는 포털 대상이 아니므로 건수만 센다.
  var unregistered = [];
  var outsideCount = 0;
  Object.keys(seen).forEach(function (k) {
    if (accountKeys[k]) return;
    if (partnerKeys[k]) unregistered.push(seen[k].label + " (" + seen[k].count + "건)");
    else outsideCount++;
  });

  var msg = [];
  msg.push("■ 정상 (" + okList.length + ")");
  msg.push(okList.length ? okList.join("\n") : "(없음)");
  msg.push("");
  msg.push("■ 토큰 미발급 (" + noToken.length + ") — 링크 발급 필요");
  msg.push(noToken.length ? noToken.join("\n") : "(없음)");
  msg.push("");
  msg.push("■ 대장에 해당 건 없음 (" + noMatch.length + ") — 업체명 표기 확인");
  msg.push(noMatch.length ? noMatch.join("\n") : "(없음)");
  msg.push("");
  msg.push("■ 협력업체인데 계정 없음 (" + unregistered.length + ") — 업체 목록 동기화 필요");
  msg.push(unregistered.length ? unregistered.join("\n") : "(없음)");
  msg.push("");
  msg.push("검사 범위: 최근 월별 탭 " + monthsBack + "개");
  msg.push("협력업체 아닌 업체 " + outsideCount + "종은 포털 대상이 아니라 제외했습니다.");

  ui.alert("협력업체 포털 점검", msg.join("\n"), ui.ButtonSet.OK);
}
