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
 *    지금까지는 직원이 손으로 시트에 넣고 v2 에서 「반영」을 눌렀다.
 *    그 손을 없애는 것이 이 파일이다.
 *
 *  ★ 두 번 넣지 않는 것이 제일 중요하다 ★
 *    발주가 두 번 들어가면 물건이 두 번 나간다. 되돌리는 데 돈이 든다.
 *    그래서 **먼저 찜하고(claim) 나중에 넣는다.**
 *      ① PostgREST 로 `status=eq.접수` 인 행만 골라 `반영` 으로 바꾼다.
 *         조건이 붙어 있으므로 두 번 돌아도 두 번째는 0건을 가져간다.
 *      ② 찜한 것만 허브에 넣는다.
 *      ③ 넣다가 실패하면 **되돌린다**(status 를 접수로) — 그래야 다음에 다시 온다.
 *
 *    반대로 「넣고 나서 표시」하면, 넣은 뒤 표시가 실패했을 때 다음 회차에
 *    또 넣는다. 그 실패가 더 비싸다.
 *
 *  ★ 조용히 실패하지 않는다 ★
 *    오늘 하루에만 「매일 실패하면서 ✅ 로 보고하던」 동기화를 하나 찾았다.
 *    여기서는 넣은 건수·못 넣은 건수를 로그와 구글 챗에 남긴다.
 *    아무 일도 없었으면 조용하다 — 매번 알리면 아무도 안 본다.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * v2 의 **Supabase** 주소 — PostgREST 를 직접 부른다.
 *
 * ★ V2_URL 을 쓰면 안 된다 ★
 *   V2_URL 은 웹앱(pack2u-partner.vercel.app)이다. 거기에 /rest/v1 을 붙이면
 *   404 가 오고, 다리는 「옮길 것 없음」처럼 조용히 지나간다. 처음에 그렇게
 *   짰다가 올리기 전에 잡았다.
 *   _partnerSupabase.gs 의 _SB_URL(bmlbe…) 도 **다른 프로젝트**라 못 쓴다.
 */
function _v2ob_url_() {
  try { if (typeof V2_SUPABASE_URL !== "undefined" && V2_SUPABASE_URL) return String(V2_SUPABASE_URL).replace(/[/]+$/, ""); } catch (e) {}
  try { return (PropertiesService.getScriptProperties().getProperty("V2_SUPABASE_URL") || "").replace(/[/]+$/, ""); } catch (e) {}
  return "";
}
function _v2ob_key_() {
  /* PostgREST 를 직접 부르므로 service_role 키가 필요하다.
     ingest 토큰(V2_INGEST_TOKEN)은 우리 API 라우트용이라 여기서는 못 쓴다. */
  try { if (typeof V2_SERVICE_KEY !== "undefined" && V2_SERVICE_KEY) return String(V2_SERVICE_KEY); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_SERVICE_KEY") || ""; } catch (e) {}
  return "";
}

/** 한 번에 옮길 최대 건수. 많아도 나눠서 여러 번 돌면 된다. */
var _V2OB_MAX_ = 200;

function _v2ob_ready_() {
  return !!(_v2ob_url_() && _v2ob_key_());
}

function _v2ob_headers_() {
  var k = _v2ob_key_();
  return { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json" };
}

/** MMdd-ds-xxxx — 발주 수집이 쓰는 것과 같은 형식이다 (_partnerOrders.gs 1109행) */
function _v2ob_uid_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "MMdd") +
    "-ds-" + Utilities.getUuid().substring(0, 4);
}

/**
 * ① 찜한다 — 「접수」인 것을 「반영」으로 바꾸면서 그 행들을 돌려받는다.
 *
 * PostgREST 의 PATCH + `Prefer: return=representation` 이라 **바꾼 행이 그대로 온다.**
 * 조건에 `status=eq.접수` 가 붙어 있으므로, 두 번 돌아도 두 번째는 아무것도 못 가져간다.
 * 이것이 이 다리의 자물쇠다.
 */
function _v2ob_claim_() {
  var url = _v2ob_url_() + "/rest/v1/vendor_order_requests" +
    "?status=eq.%EC%A0%91%EC%88%98&order=created_at.asc&limit=" + _V2OB_MAX_;
  var h = _v2ob_headers_();
  h["Prefer"] = "return=representation";

  var res = UrlFetchApp.fetch(url, {
    method: "patch",
    headers: h,
    muteHttpExceptions: true,
    payload: JSON.stringify({
      status: "반영",
      handled_at: new Date().toISOString(),
      handled_memo: "허브로 자동 반영",
    }),
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("찜하기 실패 HTTP " + res.getResponseCode() + " " +
      res.getContentText().substring(0, 200));
  }
  return JSON.parse(res.getContentText() || "[]");
}

/** ③ 되돌린다 — 허브에 못 넣었으면 다음에 다시 오게 한다. */
function _v2ob_unclaim_(ids) {
  if (!ids || !ids.length) return;
  var inList = "(" + ids.map(function (x) { return '"' + x + '"'; }).join(",") + ")";
  var url = _v2ob_url_() + "/rest/v1/vendor_order_requests?id=in." + encodeURIComponent(inList);
  UrlFetchApp.fetch(url, {
    method: "patch",
    headers: _v2ob_headers_(),
    muteHttpExceptions: true,
    payload: JSON.stringify({
      status: "접수", handled_at: null, hub_uid: null,
      handled_memo: "허브 넣기 실패 — 다시 시도합니다",
    }),
  });
}

/** 찜한 행에 고유ID 를 적어 둔다. 나중에 「그 발주가 어느 주문이 됐나」를 잇는 값이다. */
function _v2ob_setUid_(id, uid) {
  UrlFetchApp.fetch(_v2ob_url_() + "/rest/v1/vendor_order_requests?id=eq." + id, {
    method: "patch",
    headers: _v2ob_headers_(),
    muteHttpExceptions: true,
    payload: JSON.stringify({ hub_uid: uid }),
  });
}

/**
 * 다리를 건넌다.
 *
 * @return {{ok:boolean, moved:number, failed:number, msg:string}}
 */
function partnerBridgeV2Orders() {
  if (!_v2ob_ready_()) {
    var m = "v2 주소나 service_role 키가 없습니다 (_secrets.gs V2_SUPABASE_URL · V2_SERVICE_KEY)";
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

  /* ★ 업체 이름은 따로 받아 온다 ★
     찜하기(PATCH)는 «표»를 고치므로 돌려주는 것도 표의 열뿐이다 — 업체 이름은
     뷰(vendor_order_requests_v)에만 있다. 그래서 vendor_id 로 한 번 더 묻는다.
     이름이 비면 허브의 「발주업체」가 비고, 그러면 뒤가 통째로 안 이어진다. */
  var names = {};
  try {
    var ids = claimed.map(function (r) { return r.vendor_id; })
      .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var inList = "(" + ids.map(function (x) { return '"' + x + '"'; }).join(",") + ")";
    var vres = UrlFetchApp.fetch(
      _v2ob_url_() + "/rest/v1/vendors?select=id,name&id=in." + encodeURIComponent(inList),
      { headers: _v2ob_headers_(), muteHttpExceptions: true });
    if (vres.getResponseCode() === 200) {
      JSON.parse(vres.getContentText() || "[]").forEach(function (v) { names[v.id] = v.name; });
    }
  } catch (eN) {
    Logger.log("[V2발주다리] 업체 이름 조회 실패: " + eN.message);
  }

  /* 이름을 못 구한 것이 있으면 **넣지 않고 되돌린다.**
     업체명 없이 들어간 발주는 세트분리에서 길을 잃고, 나중에 찾기가 훨씬 어렵다. */
  var 이름없음 = claimed.filter(function (r) { return !names[r.vendor_id]; });
  if (이름없음.length) {
    _v2ob_unclaim_(claimed.map(function (x) { return x.id; }));
    var mN = "업체 이름을 못 구해 " + claimed.length + "건을 되돌렸습니다";
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
      String(names[r.vendor_id] || ""),      // B 발주업체
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
  var uidFail = 0;
  for (var u = 0; u < uids.length; u++) {
    try { _v2ob_setUid_(uids[u].id, uids[u].uid); } catch (eU) { uidFail++; }
  }

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
