/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 인증
 *
 *  흐름
 *    1. 운영자가 업체별 토큰을 발급한다 (허브 메뉴).
 *    2. 업체는 {exec}?v={업체키}&t={토큰} 링크로 들어온다.
 *    3. doGet 이 토큰을 검증하고, 원문 토큰 대신 짧은 세션키를 화면에 심는다.
 *    4. 이후 모든 서버 호출은 세션키만 받는다. 업체명은 서버가 세션에서 정한다.
 *       클라이언트가 보낸 업체명은 절대 신뢰하지 않는다.
 *
 *  세션이 만료되면 클라이언트는 원본 URL 로 새로고침해 재발급받는다.
 *  브라우저에 링크가 남아 있으므로 업체 입장에서는 그냥 새로고침이다.
 * ══════════════════════════════════════════════════════════════
 */

/** 계정 탭 열 (0-index) */
var PRP_AC = {
  vendor: 0,   // A 업체명 — 반품대장 D열 표기와 같게 (SSOT)
  prefix: 1,   // B 접두 (HR, NK …)
  alias: 2,    // C 별칭 — 반품대장 D열 표기 변형, 쉼표 구분
  token: 3,    // D 접속 토큰
  active: 4,   // E 활성 (TRUE/FALSE)
  lastSeen: 5, // F 최근 접속
  hits: 6,     // G 누적 접속수
  memo: 7      // H 메모
};

var PRP_AC_HEADER = [
  "업체명", "접두", "별칭(쉼표구분)", "접속토큰", "활성", "최근접속", "접속수", "메모"
];

/** 계정 탭 확보 — 없으면 헤더까지 만들어 준다 */
function prpEnsureAccountTab_() {
  var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
  var tab = ss.getSheetByName(PRP_ACCOUNT_TAB);
  if (tab) return tab;

  tab = ss.insertSheet(PRP_ACCOUNT_TAB);
  tab.getRange(1, 1, 1, PRP_AC_HEADER.length).setValues([PRP_AC_HEADER])
    .setFontWeight("bold").setBackground("#f1f3f4");
  tab.setFrozenRows(1);
  tab.getRange(1, 4).setNote("토큰은 링크에 실리는 비밀값입니다. 유출되면 회전(재발급)하세요.");
  tab.setColumnWidth(1, 160);
  tab.setColumnWidth(3, 200);
  tab.setColumnWidth(4, 280);
  tab.setColumnWidth(8, 240);
  return tab;
}

/**
 * 계정 목록 읽기.
 * 토큰 비교 때문에 호출이 잦으므로 캐시한다. 계정 변경 시 prpInvalidateAccounts_ 호출.
 */
function prpLoadAccounts_(refresh) {
  var cache = CacheService.getScriptCache();
  var ck = PRP_CACHE_VER + "_accounts";
  if (!refresh) {
    try {
      var hit = cache.get(ck);
      if (hit) return JSON.parse(hit) || [];
    } catch (e) {}
  }

  var tab = prpEnsureAccountTab_();
  var lastRow = tab.getLastRow();
  if (lastRow < 2) return [];

  var values = tab.getRange(2, 1, lastRow - 1, PRP_AC_HEADER.length).getDisplayValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var vendor = String(r[PRP_AC.vendor] || "").trim();
    var token = String(r[PRP_AC.token] || "").trim();
    if (!vendor || !token) continue;

    var activeRaw = String(r[PRP_AC.active] || "").trim().toUpperCase();
    var active = !(activeRaw === "FALSE" || activeRaw === "N" || activeRaw === "0" || activeRaw === "비활성");

    var aliases = String(r[PRP_AC.alias] || "").split(/[,;]/)
      .map(function (s) { return prpVendorKey_(s); })
      .filter(function (s) { return !!s; });

    var prefix = String(r[PRP_AC.prefix] || "").trim().toUpperCase();
    if (prefix && PRP_VENDOR_LABELS[prefix]) {
      var lab = prpVendorKey_(PRP_VENDOR_LABELS[prefix]);
      if (lab && aliases.indexOf(lab) < 0) aliases.push(lab);
    }

    out.push({
      row: i + 2,
      vendor: vendor,
      key: prpVendorKey_(vendor),
      prefix: prefix,
      aliases: aliases,
      token: token,
      active: active
    });
  }

  try { cache.put(ck, JSON.stringify(out), 300); } catch (e) {}
  return out;
}

function prpInvalidateAccounts_() {
  try { CacheService.getScriptCache().remove(PRP_CACHE_VER + "_accounts"); } catch (e) {}
}

/**
 * 토큰 검증. 업체키(v)는 힌트로만 쓰고 실제 판정은 토큰으로 한다.
 * 토큰만 맞으면 통과시키므로, v 를 틀리게 넣어도 자기 업체로 들어온다.
 */
function prpResolveByToken_(token, vendorHint) {
  var t = String(token || "").trim();
  if (!t || t.length < 16) return null;

  var accounts = prpLoadAccounts_(false);
  var hintKey = prpVendorKey_(vendorHint);
  var found = null;

  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].token !== t) continue;
    // 같은 토큰이 여러 업체에 들어가는 실수 대비 — 힌트가 맞는 쪽을 우선
    if (!found) found = accounts[i];
    if (hintKey && accounts[i].key === hintKey) { found = accounts[i]; break; }
  }
  if (!found) return null;
  if (!found.active) return { blocked: true, vendor: found.vendor };
  return found;
}

// ── 세션 ──────────────────────────────────────────────────────

/**
 * 세션 발급. 원문 토큰을 클라이언트 코드에 남기지 않기 위한 교환 단계다.
 * 캐시에만 두므로 만료되면 사라지고, 그때는 원본 링크로 재발급한다.
 */
function prpIssueSession_(account) {
  var sid = "s" + Utilities.getUuid().replace(/-/g, "");
  var payload = {
    vendor: account.vendor,
    key: account.key,
    prefix: account.prefix,
    aliases: account.aliases,
    at: prpNow_().getTime()
  };
  try {
    CacheService.getScriptCache().put("prp_sess_" + sid, JSON.stringify(payload), PRP_SESSION_TTL);
  } catch (e) {
    return "";
  }
  return sid;
}

/**
 * 세션 → 업체. 모든 API 함수의 첫 줄에서 부른다.
 * 실패 시 null 을 주고, 호출자는 authExpired 를 내려보내야 한다.
 */
function prpSession_(sid) {
  var s = String(sid || "").trim();
  if (!s) return null;
  try {
    var raw = CacheService.getScriptCache().get("prp_sess_" + s);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (!o || !o.vendor) return null;
    return o;
  } catch (e) {
    return null;
  }
}

/** API 공통 가드 — 통과하면 세션 객체, 막히면 에러 응답 객체 */
function prpGuard_(sid) {
  var sess = prpSession_(sid);
  if (!sess) {
    return { _deny: { ok: false, authExpired: true, error: "접속이 만료되었습니다. 화면을 새로고침해 주세요." } };
  }
  return { sess: sess };
}

// ── 접속 로그 ─────────────────────────────────────────────────

function prpEnsureLogTab_() {
  var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
  var tab = ss.getSheetByName(PRP_LOG_TAB);
  if (tab) return tab;
  tab = ss.insertSheet(PRP_LOG_TAB);
  tab.getRange(1, 1, 1, 4).setValues([["시각", "업체명", "동작", "상세"]])
    .setFontWeight("bold").setBackground("#f1f3f4");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 150);
  tab.setColumnWidth(4, 360);
  return tab;
}

/**
 * 로그는 실패해도 본 기능을 막지 않는다.
 * 로그 때문에 업체가 화면을 못 보는 상황이 더 나쁘다.
 */
function prpLog_(vendor, action, detail) {
  try {
    var tab = prpEnsureLogTab_();
    tab.appendRow([
      prpToday_("yyyy-MM-dd HH:mm:ss"),
      String(vendor || ""),
      String(action || ""),
      String(detail || "").substring(0, 500)
    ]);
  } catch (e) {
    Logger.log("[PRP] 로그 기록 실패: " + e.message);
  }
}

/** 계정 탭의 최근접속·접속수 갱신 */
function prpTouchAccount_(account) {
  try {
    var tab = prpEnsureAccountTab_();
    tab.getRange(account.row, PRP_AC.lastSeen + 1).setValue(prpToday_("yyyy-MM-dd HH:mm"));
    var cur = parseInt(tab.getRange(account.row, PRP_AC.hits + 1).getDisplayValue(), 10) || 0;
    tab.getRange(account.row, PRP_AC.hits + 1).setValue(cur + 1);
  } catch (e) {
    Logger.log("[PRP] 접속 기록 실패: " + e.message);
  }
}
