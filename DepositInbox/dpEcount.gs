/**
 * ══════════════════════════════════════════════════════════════
 *  이카운트 반영 — 입금 1건을 일반전표 1장으로
 *  ★ 2026-09-29 신규 · 규격: 이카운트_일반전표_API.md · 전표 모양: dpMatch.gs dpBuildJournal
 *
 *  > "이카운트의 문제는 입금확인이 2번 3번 클릭하면 계속 된다는거야"
 *    — 이 작업을 시작한 까닭. 여기가 그걸 막는 자리다.
 *
 *  ★ 세 겹 ★
 *    1) 스크립트 잠금 — 두 사람이 동시에 눌러도 한 번에 하나
 *    2) 상태 — 「대기」 인 줄만 넘긴다. 보내기 «전에» 「반영중」 으로 바꾸고 시트에 먼저 쓴다(flush)
 *    3) 결과를 모르면 다시 보내지 않는다 — 응답이 끊기거나 애매하면 「확인필요」.
 *       사람이 이카운트에서 보고 전표번호를 적거나(있음) 「대기」 로 되돌린다(없음).
 *       이카운트가 «안 받았다»고 분명히 말한 경우에만 「대기」 로 되돌린다.
 *
 *  ★ 켜는 법 ★
 *    스크립트 속성 DP_ECOUNT_POST = on. 기본은 꺼짐 — 시험 전표로 거래처원장을 확인한 뒤 켠다.
 *    필요한 속성: ECOUNT_COM_CODE · ECOUNT_USER_ID · ECOUNT_API_CERT_KEY (허브와 같은 값)
 *               DP_GYE_BANK (보통예금 계정코드) · DP_GYE_AR (외상매출금 계정코드)
 *    프록시: _secrets.gs DP_ECOUNT_PROXY_URL · DP_ECOUNT_PROXY_KEY (허브 ecount.gs 와 같은 곳 — 고정 IP)
 * ══════════════════════════════════════════════════════════════
 */

var DP_EC_POST_HEADERS_ = ["전표번호", "반영시각", "반영자", "반영메모"];

/**
 * 계정 — 코드 대신 «이름» (매뉴얼: GYE_CODE 는 계정코드 또는 명)
 * > "그냥 보통예금이야" (2026-09-29) — 손으로 입금 처리할 때 고르는 계정 그대로.
 * 비밀이 아니니 코드에 적는다. 바꿀 일이 생기면 스크립트 속성 DP_GYE_BANK · DP_GYE_AR 이 이긴다.
 */
/**
 * 반영 시작 시각 — 이 시각 «이전» 입금은 시스템이 넘기지 않는다 (dpMatch.gs dpCanPost 머리말)
 * > "오늘 00시부터 시작하고 오늘 첫 입금으로 시험해줘" (2026-09-30)
 * 사장님이 정한 값이라 코드에 적는다. 스크립트 속성 DP_ECOUNT_FROM 이 있으면 그것이 이긴다.
 * ★ 이 값을 읽는 곳은 dpPostFrom_() 하나다 — 여러 곳에서 속성을 따로 읽으면 한쪽만 바뀐다.
 */
var DP_ECOUNT_FROM_DEFAULT_ = "2026-09-30 17:11";   // 2026-09-30 사장님이 스위치를 켠 순간 — 그 전(손으로 처리한) 입금은 안 넘긴다

function dpPostFrom_() {
  return _dp_prop_("DP_ECOUNT_FROM") || DP_ECOUNT_FROM_DEFAULT_;
}

var DP_GYE_BANK_DEFAULT_ = "보통예금";
var DP_GYE_AR_DEFAULT_ = "외상매출금";
var DP_EC_JOURNAL_PATH_ = "/OAPI/V2/GeneralJournal/SaveGeneralJournal";

function _dp_ec_cfg_() {
  var p = function (k) { return _dp_prop_(k); };
  return {
    on: String(p("DP_ECOUNT_POST")).toLowerCase() === "on",
    comCode: p("ECOUNT_COM_CODE"), userId: p("ECOUNT_USER_ID"), certKey: p("ECOUNT_API_CERT_KEY"),
    testCertKey: p("ECOUNT_TEST_CERT_KEY"),   // 일반전표 검증용 (2026-09-30)
    lanType: p("ECOUNT_LAN_TYPE") || "ko-KR",
    bankGye: p("DP_GYE_BANK") || DP_GYE_BANK_DEFAULT_, arGye: p("DP_GYE_AR") || DP_GYE_AR_DEFAULT_,
    proxyUrl: String(_dp_secret_("DP_ECOUNT_PROXY_URL") || ""), proxyKey: String(_dp_secret_("DP_ECOUNT_PROXY_KEY") || "")
  };
}

/** 빠진 설정 — 비어 있으면 보낼 수 있다 */
function _dp_ec_missing_(cfg) {
  var miss = [];
  if (!cfg.comCode) miss.push("ECOUNT_COM_CODE");
  if (!cfg.userId) miss.push("ECOUNT_USER_ID");
  if (!cfg.certKey) miss.push("ECOUNT_API_CERT_KEY");
  if (!cfg.bankGye) miss.push("DP_GYE_BANK(보통예금)");
  if (!cfg.arGye) miss.push("DP_GYE_AR(외상매출금)");
  if (!cfg.proxyUrl || !cfg.proxyKey) miss.push("DP_ECOUNT_PROXY_URL/KEY");
  return miss;
}

/** 고정 IP 프록시를 거쳐 이카운트를 부른다 → 응답 JSON (못 읽으면 던진다) */
function _dp_ec_fetch_(cfg, url, payload) {
  var res = UrlFetchApp.fetch(cfg.proxyUrl, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "X-Proxy-Key": cfg.proxyKey },
    payload: JSON.stringify({ url: url, payload: payload || {}, method: "POST" })
  });
  var text = res.getContentText();
  try { return JSON.parse(text); }
  catch (e) { throw new Error("이카운트 응답을 읽지 못함 (HTTP " + res.getResponseCode() + ") " + String(text).slice(0, 200)); }
}

/** 세션 — 20분 캐시. force 면 새로 */
/**
 * @param host  "oapi"(운영, 기본) | "sboapi"(테스트 서버 — 테스트 인증키)
 */
function _dp_ec_session_(cfg, force, host) {
  host = host || "oapi";
  var cache = CacheService.getScriptCache();
  var ck = "DP_EC_SESSION" + (host === "oapi" ? "" : "_" + host);
  if (!force) {
    var hit = cache.get(ck);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }
  var zone = _dp_prop_("ECOUNT_ZONE");
  if (!zone) {
    var z = _dp_ec_fetch_(cfg, "https://oapi.ecount.com/OAPI/V2/Zone", { COM_CODE: cfg.comCode });
    zone = z && z.Data && z.Data.ZONE;
    if (!zone) throw new Error("이카운트 Zone 을 못 받음");
    PropertiesService.getScriptProperties().setProperty("ECOUNT_ZONE", String(zone));
  }
  var key = host === "oapi" ? cfg.certKey : cfg.testCertKey;
  var lg = _dp_ec_fetch_(cfg, "https://" + host + zone + ".ecount.com/OAPI/V2/OAPILogin", {
    COM_CODE: cfg.comCode, USER_ID: cfg.userId, ZONE: zone, API_CERT_KEY: key, LAN_TYPE: cfg.lanType
  });
  var sid = lg && lg.Data && lg.Data.Datas && lg.Data.Datas.SESSION_ID;
  if (!sid) throw new Error("이카운트 로그인 실패(" + host + ") — " + ((lg && lg.Error && lg.Error.Message) || JSON.stringify(lg).slice(0, 200)));
  var s = { zone: String(zone), sid: String(sid), host: host };
  cache.put(ck, JSON.stringify(s), 20 * 60);
  return s;
}

/**
 * 일반전표 API 검증 — 테스트 서버(sboapi)로 한 번 정상 호출한다
 * ★ 2026-09-30 ★ 운영 호출이 「인증되지 않은 API입니다」 로 거절됐다.
 *   이카운트 「API인증현황」: "추가 API 개발도 테스트 인증키를 이용하여 검증 후 이용 바랍니다."
 *   검증된 API 는 품목등록 · 품목조회 · 발주서조회 · 재고현황뿐이었다.
 *
 * ★ 이중 입금을 막는다 ★
 *   테스트 서버 호출이 실제 장부에 전표를 남기는지 모른다. 그래서 보낸 뒤 그 입금을 「확인필요」 로 둔다 —
 *   사람이 이카운트를 보고 「있음(전표번호)」 · 「없음」 으로 정리하기 전에는 시스템이 다시 보내지 못한다.
 *   이카운트가 분명히 거절하면(양식 필수 칸 등) 「대기」 로 두고 까닭을 적는다 — 그 까닭으로 전표 모양을 고친다.
 */
function dpCsVerifyJournal_(key, by) {
  var cfg = _dp_ec_cfg_();
  var miss = _dp_ec_missing_(cfg);
  if (!cfg.testCertKey) miss.push("ECOUNT_TEST_CERT_KEY(테스트 인증키)");
  if (miss.length) return { ok: false, error: "설정이 비었습니다: " + miss.join(", ") };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = dpLedgerSs_(false);
    var f = ss && _dp_findRow_(ss, key);
    if (!f) return { ok: false, error: "입금을 못 찾음" };
    var c = f.c, row = f.row, sh = f.sh;
    var g = function (h) { return c[h] ? row[c[h] - 1] : ""; };
    var set = function (h, v) { if (c[h]) sh.getRange(f.rowNo, c[h]).setValue(v); };
    var d = { key: key, txAt: _dp_ts_(g("거래일시")), name: String(g("입금자")), amount: Number(g("금액")) || 0,
              orderNos: String(g("주문번호")), code: String(g("거래처코드")), result: String(g("매칭결과")), status: String(g("상태")) };
    var can = dpCanPost(d, dpPostFrom_());
    if (!can.ok) return { ok: false, error: can.reason };

    set("상태", "반영중"); set("반영시각", _dp_now_()); set("반영자", by || ""); set("반영메모", "테스트 서버 검증 호출 중");
    SpreadsheetApp.flush();
    var read, raw = null;
    try {
      var s = _dp_ec_session_(cfg, true, "sboapi");
      raw = _dp_ec_fetch_(cfg, "https://sboapi" + s.zone + ".ecount.com" + DP_EC_JOURNAL_PATH_ + "?SESSION_ID=" + encodeURIComponent(s.sid),
                          { GeneralJournalList: dpBuildJournal(d, cfg, 1) });
      read = dpReadJournalResult(raw);
    } catch (err) {
      read = { kind: "unknown", slipNo: "", message: String((err && err.message) || err) };
    }
    if (read.kind === "reject") {
      set("상태", "대기"); set("반영메모", "테스트 서버 거절: " + read.message);
    } else {
      set("상태", "확인필요");
      set("반영메모", "테스트 서버 검증 호출" + (read.slipNo ? " — 전표번호 " + read.slipNo : "") +
        " · 이카운트에 이 전표가 실제로 생겼는지 확인 후 정리 (있음=전표번호 / 없음=대기)");
    }
    dpBumpVer_();
    return { kind: read.kind, slipNo: read.slipNo, message: read.message,
             raw: raw ? JSON.stringify(raw).slice(0, 1500) : "" };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 입금 여러 건을 이카운트에 넘긴다 (CS웹앱 「이카운트 반영」).
 * 한 건씩 보낸다 — 여러 장을 한 요청에 담으면 어느 전표번호가 어느 입금인지 흐려진다.
 *
 * @return {{results: Array<{key, outcome, slipNo, message}>}}
 *   outcome: 반영완료 · 거절(대기로 되돌림) · 확인필요 · 건너뜀
 */
function dpCsPost_(keys, by, test) {
  var cfg = _dp_ec_cfg_();
  // ★ 시험 한 건 (2026-09-29) ★ 켜기 전에 실제 전표 «한 장»으로 거래처원장을 확인한다.
  //   스위치(DP_ECOUNT_POST)는 꺼 둔 채 — 직원 화면에는 버튼이 안 뜬다. 딱 한 건만 받는다.
  //   CS웹앱은 test 를 보내지 않는다 (csDeposit.gs) — 사장님이 채팅에서 허락한 시험에만 쓴다.
  var isTest = !!test && [].concat(keys || []).length === 1;
  if (!cfg.on && !isTest) return { ok: false, error: "이카운트 반영이 꺼져 있습니다 (스크립트 속성 DP_ECOUNT_POST=on)" };
  var miss = _dp_ec_missing_(cfg);
  if (miss.length) return { ok: false, error: "이카운트 설정이 비었습니다: " + miss.join(", ") };
  keys = [].concat(keys || []).map(String).filter(Boolean);
  if (!keys.length) return { ok: false, error: "넘길 입금을 고르세요" };

  var ss = dpLedgerSs_(false);
  if (!ss) return { ok: false, error: "입금대장이 없습니다" };
  var results = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = dpLedgerSheet_(ss);
    var session = null;
    keys.forEach(function (key) {
      var f = _dp_findRow_(ss, key);
      if (!f) { results.push({ key: key, outcome: "건너뜀", message: "입금을 못 찾음" }); return; }
      var c = f.c, row = f.row;
      var g = function (h) { return c[h] ? row[c[h] - 1] : ""; };
      var set = function (h, v) { if (c[h]) sh.getRange(f.rowNo, c[h]).setValue(v); };
      var d = { key: key, txAt: _dp_ts_(g("거래일시")), name: String(g("입금자")), amount: Number(g("금액")) || 0,
                orderNos: String(g("주문번호")), code: String(g("거래처코드")), result: String(g("매칭결과")),
                status: String(g("상태")) };
      var can = dpCanPost(d, dpPostFrom_());
      if (!can.ok) { results.push({ key: key, outcome: "건너뜀", message: can.reason }); return; }

      // ② 보내기 «전에» 반영중으로 — 여기서 멈춰도(시간 초과 등) 다음 사람이 또 보내지 못한다
      set("상태", "반영중"); set("반영시각", _dp_now_()); set("반영자", by || ""); set("반영메모", "");
      SpreadsheetApp.flush();

      var read;
      try {
        if (!session) session = _dp_ec_session_(cfg, false);
        var url = "https://oapi" + session.zone + ".ecount.com" + DP_EC_JOURNAL_PATH_ + "?SESSION_ID=" + encodeURIComponent(session.sid);
        var res = _dp_ec_fetch_(cfg, url, { GeneralJournalList: dpBuildJournal(d, cfg, 1) });
        read = dpReadJournalResult(res);
        // 세션 만료로 거절되면 한 번만 새로 로그인해서 다시 — «거절»이 분명할 때만
        if (read.kind === "reject" && /세션|session|로그인/i.test(read.message)) {
          session = _dp_ec_session_(cfg, true);
          url = "https://oapi" + session.zone + ".ecount.com" + DP_EC_JOURNAL_PATH_ + "?SESSION_ID=" + encodeURIComponent(session.sid);
          read = dpReadJournalResult(_dp_ec_fetch_(cfg, url, { GeneralJournalList: dpBuildJournal(d, cfg, 1) }));
        }
      } catch (err) {
        read = { kind: "unknown", slipNo: "", message: String((err && err.message) || err) };
      }

      if (read.kind === "ok") {
        set("상태", "반영완료"); set("전표번호", read.slipNo);
        results.push({ key: key, outcome: "반영완료", slipNo: read.slipNo });
      } else if (read.kind === "reject") {
        set("상태", "대기"); set("반영메모", "이카운트 거절: " + read.message);
        results.push({ key: key, outcome: "거절", message: read.message });
      } else {
        set("상태", "확인필요"); set("반영메모", "결과 모름 — 이카운트에서 확인: " + read.message);
        results.push({ key: key, outcome: "확인필요", message: read.message });
      }
      SpreadsheetApp.flush();
    });
  } finally {
    dpBumpVer_();   // 상태 · 전표번호가 바뀌었다 — 목록 캐시를 버린다
    lock.releaseLock();
  }
  return { results: results };
}

/**
 * 「확인필요」 정리 — 사람이 이카운트를 보고 알려 준다.
 * @param slipNo  이카운트에 있으면 그 전표번호 → 반영완료. 비우면 «없었다» → 대기 (다시 넘길 수 있다)
 */
function dpCsPostResolve_(key, slipNo, by) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = dpLedgerSs_(false);
    var f = ss && _dp_findRow_(ss, key);
    if (!f) return { ok: false, error: "입금을 못 찾음" };
    var sh = f.sh, c = f.c;
    if (String(f.row[c["상태"] - 1]) !== "확인필요") return { ok: false, error: "「확인필요」 인 입금만 정리합니다" };
    slipNo = String(slipNo || "").trim();
    sh.getRange(f.rowNo, c["상태"]).setValue(slipNo ? "반영완료" : "대기");
    if (c["전표번호"]) sh.getRange(f.rowNo, c["전표번호"]).setValue(slipNo);
    if (c["반영메모"]) sh.getRange(f.rowNo, c["반영메모"]).setValue(
      (slipNo ? "이카운트에 있음 — " : "이카운트에 없음 — 다시 넘길 수 있음 · ") + (by || "") + " " + _dp_now_());
    dpBumpVer_();
    return { status: slipNo ? "반영완료" : "대기" };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 「이미 이카운트에 넣었음」 — 누가 손으로(또는 이카운트 엑셀로) 이미 입력한 입금
 * ★ 2026-09-29 ★ "수동 확인건과 업로드하면 이중입금처리 되는거 아닌지.."
 *   이카운트를 읽을 수 없으니 사람이 알려 준다. 표시하면 「반영완료」 + 전표번호 「손으로」 — 시스템은 다시 넘기지 않는다.
 * @param undo  true 면 잘못 누른 것을 되돌린다 (전표번호가 「손으로」 인 줄만)
 */
var DP_MANUAL_SLIP_ = "손으로";

function dpCsMarkManual_(key, by, undo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = dpLedgerSs_(false);
    var f = ss && _dp_findRow_(ss, key);
    if (!f) return { ok: false, error: "입금을 못 찾음" };
    var sh = f.sh, c = f.c, g = function (h) { return c[h] ? String(f.row[c[h] - 1]) : ""; };
    var set = function (h, v) { if (c[h]) sh.getRange(f.rowNo, c[h]).setValue(v); };
    if (undo) {
      if (g("상태") !== "반영완료" || g("전표번호") !== DP_MANUAL_SLIP_) {
        return { ok: false, error: "「이미 넣었음」 으로 표시한 입금만 되돌립니다" };
      }
      set("상태", "대기"); set("전표번호", ""); set("반영메모", "「이미 넣었음」 되돌림 · " + (by || "") + " " + _dp_now_());
    } else {
      if (g("상태") !== "대기") return { ok: false, error: "상태가 「" + g("상태") + "」 — 대기인 입금만 표시합니다" };
      set("상태", "반영완료"); set("전표번호", DP_MANUAL_SLIP_);
      set("반영자", by || ""); set("반영시각", _dp_now_());
      set("반영메모", "이카운트에 손으로 이미 입력함 — 시스템은 넘기지 않음");
    }
    dpBumpVer_();
    return { status: undo ? "대기" : "반영완료" };
  } finally {
    lock.releaseLock();
  }
}

/** 편집기에서 ▶ — 설정 점검 (보내지 않는다). 로그인까지만 해 본다 */
function dpEcountCheck() {
  var cfg = _dp_ec_cfg_();
  var out = ["이카운트 반영 점검", "켜짐       " + (cfg.on ? "on" : "꺼짐 (DP_ECOUNT_POST)")];
  var miss = _dp_ec_missing_(cfg);
  out.push("빠진 설정  " + (miss.length ? miss.join(", ") : "없음"));
  out.push("보통예금   " + (cfg.bankGye || "-") + " · 외상매출금 " + (cfg.arGye || "-"));
  out.push("반영 시작  " + (dpPostFrom_() || "★ 없음 — 아무것도 넘기지 않음 (DP_ECOUNT_FROM)"));
  out.push("테스트 키  " + (cfg.testCertKey ? "있음" : "없음 (ECOUNT_TEST_CERT_KEY) — 일반전표 검증에 필요"));
  if (!miss.length) {
    try { var s = _dp_ec_session_(cfg, true); out.push("로그인     OK (zone " + s.zone + ")"); }
    catch (e) { out.push("로그인     ★ " + e.message); }
  }
  var msg = out.join("\n");
  Logger.log(msg);
  return msg;
}
