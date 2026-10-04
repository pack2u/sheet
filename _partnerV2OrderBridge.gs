/**
 * ══════════════════════════════════════════════════════════════
 *  v2 업체 발주 접수함 → 협력업체_발주허브
 *  ★ 2026-09-10 신규
 *
 *  > "다리까지 이어줘"
 *
 *  ★ 왜 이 다리가 필요한가 ★
 *    업체가 v2 화면(/v/order)에서 넣은 발주는 `vendor_order_requests` 에만 쌓인다.
 *    그런데 출고는 **협력업체_발주허브**를 보고 돈다 — 세트분리도, 송장수집도,
 *    마감도 전부 그 탭이다. 옮기지 않으면 업체는 넣은 줄 아는데 아무도 안 보낸다.
 *
 *  ★ 두 번 넣지 않는 것이 제일 중요하다 ★
 *    발주가 두 번 들어가면 물건이 두 번 나간다. 되돌리는 데 돈이 든다.
 *    그래서 **먼저 찜하고(claim) 나중에 넣는다.**
 *      ① v2 에 「접수인 것을 반영으로 바꾸고 그 행들을 달라」고 한다.
 *         두 번 물어도 두 번째는 0건이다 — 조건이 상태를 보고 있다.
 *      ② 찜한 것만 허브에 넣는다.
 *      ③ 넣다가 실패하면 **되돌린다** — 그래야 다음에 다시 온다.
 *
 *  ★ Supabase 를 직접 안 부른다 ★
 *    처음엔 PostgREST 를 바로 불렀다. 401 이 왔다 —
 *      "Forbidden use of secret API key in browser"
 *    UrlFetchApp 의 User-Agent 가 `Mozilla/5.0 (compatible; Google-Apps-Script…)`
 *    로 시작해서 Supabase 가 브라우저로 본다 (UA 만 바꿔 가며 확인했다).
 *    UA 를 속일 수도 있지만 그러지 않는다. secret 키가 시트 스크립트에 있는 것
 *    자체가 옳지 않다 — 편집기는 직원 여럿이 연다.
 *    그래서 키는 Vercel 에만 두고, 여기서는 미러들과 **같은 토큰**으로 문을 연다.
 *      → app/src/app/api/vendor-requests/bridge/route.ts
 *
 *  ★ 이 파일은 «한시적»이다 ★
 *    발주가 v2 안에서 끝나 허브 탭이 필요 없어지면 이 다리도 없어진다.
 *    지울 것을 알고 만든 것이라 얇게 만든다.
 * ══════════════════════════════════════════════════════════════
 */

/** v2 웹앱 주소·토큰 — 반품/보드 미러가 쓰는 것과 같다 (_secrets.gs) */
function _v2ob_url_() {
  try { if (typeof V2_URL !== "undefined" && V2_URL) return String(V2_URL).replace(/[/]+$/, ""); } catch (e) {}
  try { return (PropertiesService.getScriptProperties().getProperty("V2_URL") || "").replace(/[/]+$/, ""); } catch (e) {}
  return "";
}
function _v2ob_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || ""; } catch (e) {}
  return "";
}

var _V2OB_PATH_ = "/api/vendor-requests/bridge";

function _v2ob_ready_() {
  return !!(_v2ob_url_() && _v2ob_token_());
}

/** MMdd-ds-xxxx — 발주 수집이 쓰는 것과 같은 형식이다 (_partnerOrders.gs 1109행) */
function _v2ob_uid_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "MMdd") +
    "-ds-" + Utilities.getUuid().substring(0, 4);
}

/** 문 하나로 세 가지를 다 한다 (op: claim | unclaim | uid) */
function _v2ob_call_(payload) {
  var res = UrlFetchApp.fetch(_v2ob_url_() + _V2OB_PATH_, {
    method: "post",
    contentType: "application/json",
    headers: { "x-ingest-token": _v2ob_token_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code !== 200) {
    throw new Error("HTTP " + code + " " + String(text).substring(0, 200));
  }
  var j;
  try { j = JSON.parse(text); } catch (e) { throw new Error("응답을 못 읽었습니다: " + String(text).substring(0, 120)); }
  if (!j || j.ok !== true) throw new Error(String((j && j.error) || "알 수 없는 실패"));
  return j;
}

/** ① 찜한다 — 「접수」를 「반영」으로 바꾸면서 그 행들을 받아 온다. 이게 자물쇠다. */
function _v2ob_claim_() {
  return _v2ob_call_({ op: "claim" }).rows || [];
}

/** ③ 되돌린다 — 허브에 못 넣었으면 다음 회차에 다시 오게 한다. */
function _v2ob_unclaim_(ids) {
  if (!ids || !ids.length) return;
  try { _v2ob_call_({ op: "unclaim", ids: ids }); }
  catch (e) { Logger.log("[V2발주다리] 되돌리기 실패: " + (e && e.message ? e.message : e)); }
}

/** 찜한 행에 고유ID 를 적어 둔다. 「그 발주가 어느 주문이 됐나」를 잇는 값이다. */
function _v2ob_setUids_(pairs) {
  if (!pairs || !pairs.length) return 0;
  try { return _v2ob_call_({ op: "uid", pairs: pairs }).n || 0; }
  catch (e) { Logger.log("[V2발주다리] 고유ID 쓰기 실패: " + (e && e.message ? e.message : e)); return 0; }
}

/**
 * 다리를 건넌다.
 *
 * @return {{ok:boolean, moved:number, failed:number, msg:string}}
 */
function partnerBridgeV2Orders() {
  if (!_v2ob_ready_()) {
    var m = "v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)";
    Logger.log("[V2발주다리] " + m);
    return { ok: false, moved: 0, failed: 0, msg: m };
  }

  var claimed = [];
  try {
    claimed = _v2ob_claim_();
  } catch (e) {
    Logger.log("[V2발주다리] " + e.message);
    return { ok: false, moved: 0, failed: 0, msg: e.message };
  }

  if (!claimed.length) {
    Logger.log("[V2발주다리] 옮길 접수가 없습니다");
    return { ok: true, moved: 0, failed: 0, msg: "옮길 것 없음" };
  }

  var ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty("MAIN_SS_ID") ||
    SpreadsheetApp.getActiveSpreadsheet().getId());
  var hub = ss.getSheetByName(_PO_HUB_SHEET_NAME);
  if (!hub) {
    _v2ob_unclaim_(claimed.map(function (r) { return r.id; }));
    var m2 = "「" + _PO_HUB_SHEET_NAME + "」 탭이 없습니다 — 되돌렸습니다";
    Logger.log("[V2발주다리] " + m2);
    return { ok: false, moved: 0, failed: claimed.length, msg: m2 };
  }
  /* ★ 업체 이름은 v2 가 채워서 보낸다 ★
     이름이 비면 허브의 「발주업체」가 비고, 그러면 뒤가 통째로 안 이어진다.
     그래서 하나라도 비면 **넣지 않고 통째로 되돌린다.** */
  var 이름없음 = claimed.filter(function (r) { return !r.vendor_name; });
  if (이름없음.length) {
    _v2ob_unclaim_(claimed.map(function (x) { return x.id; }));
    var mN = "업체 이름이 비어 " + claimed.length + "건을 되돌렸습니다";
    Logger.log("[V2발주다리] " + mN);
    return { ok: false, moved: 0, failed: claimed.length, msg: mN };
  }

  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  var rows = [], uids = [];
  for (var i = 0; i < claimed.length; i++) {
    var r = claimed[i];
    var uid = _v2ob_uid_();
    uids.push({ id: r.id, uid: uid });
    rows.push([
      now,                                   // A 수집일시
      String(r.vendor_name || ""),           // B 발주업체
      uid,                                   // C 고유ID
      today,                                 // D 주문일자
      String(r.ecount_code || ""),           // E 이카운트코드
      String(r.item_name || ""),             // F 품목명
      parseInt(r.qty, 10) || 1,              // G 수량
      String(r.recipient || ""),             // H 수취인
      String(r.phone || ""),                 // I 전화번호
      String(r.address || ""),               // J 주소
      String(r.delivery_msg || ""),          // K 배송메시지
      parseFloat(r.unit_price) || 0,         // L 정산금액(단가)
      /* M 적요 — 어디서 왔는지 남긴다. 나중에 「이건 누가 넣었나」를 본다. */
      "v2 업체발주" + (r.who ? " · " + r.who : ""),
      "",                                    // N 송장번호
      /* O 상태 — 반드시 «접수완료» 여야 한다.
         감사(_partnerOrderAudit.gs 157·363·679행)가 「접수완료 / 출고가능」만
         본다. 여기에 새 낱말을 쓰면 송장이 안 붙어도 아무도 못 잡는다.
         검색발주(priceManager.gs 3743행)도 같은 이유로 접수완료를 쓴다. */
      "접수완료",
    ]);
  }

  try {
    hub.getRange(hub.getLastRow() + 1, 1, rows.length, 15).setValues(rows);
  } catch (eW) {
    _v2ob_unclaim_(claimed.map(function (x) { return x.id; }));
    var m3 = "허브에 못 넣어 되돌렸습니다: " + eW.message;
    Logger.log("[V2발주다리] " + m3);
    return { ok: false, moved: 0, failed: claimed.length, msg: m3 };
  }

  /* 고유ID 를 v2 에 적는다. 실패해도 발주는 이미 들어갔으므로 되돌리지 않는다 —
     이어 보는 값이 없을 뿐이다. 로그에는 남긴다. */
  var uidFail = uids.length - _v2ob_setUids_(uids);

  var msg = "업체발주 " + rows.length + "건을 허브로 옮겼습니다" +
    (uidFail ? " (고유ID 표시 실패 " + uidFail + "건)" : "");
  Logger.log("[V2발주다리] " + msg);

  /* 옮긴 것이 있을 때만 알린다. 매번 알리면 아무도 안 본다. */
  try {
    _chat_sendCard_("📥 업체발주 자동 반영",
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
      [{ label: "옮긴 건수", value: String(rows.length) },
       { label: "업체", value: rows.map(function (x) { return x[1]; })
          .filter(function (v, ix, a) { return a.indexOf(v) === ix; }).join(", ").substring(0, 200) }]);
  } catch (eC) {}

  return { ok: true, moved: rows.length, failed: 0, msg: msg };
}

/** 트리거가 부르는 자리. 예외를 절대 밖으로 안 낸다. */
function _v2ob_scheduled_() {
  try {
    partnerBridgeV2Orders();
  } catch (e) {
    Logger.log("[V2발주다리] 예기치 못한 오류(무시): " + (e && e.message ? e.message : e));
  }
}

/** 지금 한 번 돌린다 (메뉴). */
function partnerBridgeV2OrdersNow() {
  var r = partnerBridgeV2Orders();
  try { SpreadsheetApp.getUi().alert("업체발주 다리\n\n" + r.msg); } catch (e) {}
  return r;
}
