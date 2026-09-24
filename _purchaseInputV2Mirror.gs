/**
 * ══════════════════════════════════════════════════════════════
 *  구매입력 → v2 밤 미러
 *  파일: _purchaseInputV2Mirror.gs
 *  ★ 2026-09-09 신규
 *
 *  > "명세서입력된것과 우리 구매입력 내용을 비교해서 택배비 차이 빼고는
 *  >  맞는지 비교확인 할수 있게 해줘"
 *
 *  ★ 왜 있나 ★
 *    명세서는 v2 에 쌓이는데(statements), 견줄 상대인 **구매입력은 여기 있다.**
 *    _ecountPurchaseFromExclusive.gs 가 대리발송 원장에서 이카운트 25열
 *    배열을 만들어 HUB 의 「이카운트-구매입력변환」 탭에 쓴다. 그 탭을 v2 로 민다.
 *
 *  ★ 원본(대리발송)이 아니라 「변환된 것」을 민다 ★
 *    그 탭은 **업체 품목명 → 우리 품목코드 매핑이 이미 끝난** 결과다
 *    (HUB 누적품목매핑). 원본을 밀면 그 매핑을 v2 에 다시 구현해야 하고,
 *    규칙이 두 벌이 되면 반드시 갈라진다. 갈라지면 늦게 고쳐진 쪽이
 *    조용히 틀린다 — 반품대장 머리글에서 이미 겪었다.
 *
 *  ★ 진단열(AA~)도 같이 보낸다 ★
 *    거기 「원본품목명」이 있다. **업체가 부르는 이름**이라, 명세서 줄과
 *    짝지을 때 이 열이 열쇠가 된다. 우리 품목명으로는 절대 못 맞춘다.
 *
 *  ★ getDisplayValues 를 쓴다 ★
 *    getValues 를 쓰면 일자가 Date 가 되고 품목코드·송장 앞자리 0 이 사라진다.
 *    보이는 그대로가 원문이다.
 *
 *  ★ 절대 원래 흐름을 막지 않는다 ★
 *    미러가 실패해도 구매입력 변환은 이미 끝났다. 여기서 예외를 올리면
 *    「따라가려고 붙인 것」이 운영을 죽인다. 전부 삼키고 로그만 남긴다.
 *
 *  ★ 끄는 법 ★
 *    스크립트 속성 PURCHASE_MIRROR = off  → 즉시 멈춘다.
 * ══════════════════════════════════════════════════════════════
 */

/** HUB 파일 — _ecountPurchaseFromExclusive.gs 의 _EPX_HUB_FALLBACK_ID_ 와 같다 */
var _PIV_HUB_ID_ = "1qRIEw--DcF44CqiO24C9vI74pYbN8VbqCimjNuHK5fk";

/** 구매입력 변환 결과 탭 — _EPX_OUT_TAB_ 과 같아야 한다 */
var _PIV_TAB_ = "이카운트-구매입력변환";

/** 진단열 시작 (AA) — _EPX_DIAG_START_COL_ 과 같아야 한다 */
var _PIV_DIAG_COL_ = 27;

/** 받는 곳 */
var _PIV_PATH_ = "/api/purchase/ingest";

/** 한 번에 보낼 줄 수. 크게 잡으면 6분 한도와 본문 크기에 걸린다. */
var _PIV_MAX_ROWS_ = 800;

/** 며칠치를 보낼까 — 늦게 들어온 주문이 뒤늦게 변환되는 일이 있어 넉넉히 본다 */
var _PIV_DAYS_ = 45;

function _piv_enabled_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty("PURCHASE_MIRROR");
    if (v && String(v).toLowerCase() === "off") return false;
  } catch (e) {}
  return true;
}

/** v2 주소·토큰 — 반품 미러와 같은 곳에서 온다 (_secrets.gs) */
function _piv_url_() {
  var u = "";
  try { if (typeof V2_URL !== "undefined" && V2_URL) u = String(V2_URL); } catch (e) {}
  if (!u) {
    try { u = PropertiesService.getScriptProperties().getProperty("V2_URL") || ""; } catch (e) {}
  }
  return u.replace(/\/+$/, "");
}
function _piv_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || ""; } catch (e) {}
  return "";
}

/** "20260909" · "2026-09-09" · "2026/9/9" → "2026-09-09". 못 읽으면 "" */
function _piv_ymd_(v) {
  var s = String(v == null ? "" : v).trim().replace(/\s/g, "");
  var m = /^(\d{4})[-.\/]?(\d{1,2})[-.\/]?(\d{1,2})$/.exec(s);
  if (!m) return "";
  return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
}

/**
 * 변환 탭을 읽어 보낼 줄로 만든다.
 *
 * ★ 택배비 집계행도 함께 보낸다 ★
 *   품목 대조에서는 빼야 하지만, **택배비끼리 견주려면 있어야 한다.**
 *   빼는 것은 v2 가 품목코드로 판단한다(is_shipping).
 */
function _piv_readRows_(days) {
  var ss = SpreadsheetApp.openById(_PIV_HUB_ID_);
  var tab = ss.getSheetByName(_PIV_TAB_);
  if (!tab) throw new Error("탭이 없습니다: " + _PIV_TAB_);

  var lastRow = tab.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = Math.max(tab.getLastColumn(), _PIV_DIAG_COL_ + 4);
  var vals = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();

  /* 며칠치만 보낸다. 탭에는 지난 달치가 그대로 남아 있을 수 있고,
     통째로 보내면 본문이 커져 6분 한도에 걸린다. */
  var cut = "";
  if (days > 0) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    cut = Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd");
  }

  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var ymd = _piv_ymd_(row[0]);
    if (!ymd) continue;                 // 날짜 없는 줄은 갈아 끼울 단위가 없다
    if (cut && ymd < cut) continue;

    out.push({
      ymd: ymd,
      seq: row[1],
      cust_cd: row[2],
      cust_name: row[3],
      ecount_code: row[10],
      item_name: row[11],
      spec: row[12],
      qty: row[13],
      unit_price: row[14],
      supply_amt: row[16],
      vat_amt: row[17],
      amount: row[18],
      note: row[19],
      buyer: row[20],
      carrier: row[21],
      invoice_no: row[22],
      //  진단열 AA~ : 변환상태 · 원본품목명 · 업체파일 · 배송비(O열) · 택배사
      convert_status: row[_PIV_DIAG_COL_ - 1],
      src_item_name: row[_PIV_DIAG_COL_],
      ship_fee: row[_PIV_DIAG_COL_ + 2]
    });
  }
  return out;
}

/**
 * 보낸다.
 *
 * ★ 날짜를 통째로 갈아 끼우므로 한 날짜가 여러 묶음에 걸치면 안 된다 ★
 *   v2 는 받은 날짜의 기존 줄을 지우고 넣는다. 같은 날이 두 묶음에 나뉘면
 *   **두 번째 묶음이 첫 번째를 지운다.** 그래서 날짜 경계에서만 자른다.
 *
 * @param {number=} days 기본 _PIV_DAYS_
 */
function partnerMirrorPurchaseToV2(days) {
  if (!_piv_enabled_()) return { ok: true, sent: 0, saved: 0, msg: "꺼져 있음" };

  var url = _piv_url_(), token = _piv_token_();
  if (!url || !token) {
    Logger.log("[구매입력미러] v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)");
    return { ok: false, sent: 0, saved: 0, msg: "설정 없음" };
  }

  var rows;
  try {
    rows = _piv_readRows_(days == null ? _PIV_DAYS_ : days);
  } catch (e) {
    Logger.log("[구매입력미러] 탭을 못 읽었습니다: " + (e && e.message ? e.message : e));
    return { ok: false, sent: 0, saved: 0, msg: "읽기 실패" };
  }
  if (!rows.length) {
    Logger.log("[구매입력미러] 보낼 줄이 없습니다");
    return { ok: true, sent: 0, saved: 0, msg: "보낼 것 없음" };
  }

  //  날짜 경계에서만 자른다
  rows.sort(function (a, b) { return a.ymd < b.ymd ? -1 : (a.ymd > b.ymd ? 1 : 0); });
  var groups = [], cur = [];
  for (var i = 0; i < rows.length; i++) {
    if (cur.length >= _PIV_MAX_ROWS_ && rows[i].ymd !== rows[i - 1].ymd) {
      groups.push(cur); cur = [];
    }
    cur.push(rows[i]);
  }
  if (cur.length) groups.push(cur);

  var saved = 0, errs = [];
  for (var g = 0; g < groups.length; g++) {
    var res;
    try {
      res = UrlFetchApp.fetch(url + _PIV_PATH_, {
        method: "post",
        contentType: "application/json",
        headers: { "x-ingest-token": token },
        payload: JSON.stringify({ rows: groups[g] }),
        muteHttpExceptions: true
      });
    } catch (eF) {
      errs.push(String(eF.message || eF).substring(0, 160));
      continue;
    }
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code !== 200) {
      errs.push("HTTP " + code + " " + String(text).substring(0, 160));
      continue;
    }
    var j = null;
    try { j = JSON.parse(text); } catch (eJ) {}
    if (j && j.ok) saved += (j.inserted || 0);
    else errs.push(String((j && j.error) || text).substring(0, 160));
  }

  var msg = "보냄 " + rows.length + "줄 · 저장 " + saved + "줄" +
    (errs.length ? " · 실패 " + errs.length + "묶음: " + errs.join(" | ") : "");
  Logger.log("[구매입력미러] " + msg);
  return { ok: errs.length === 0, sent: rows.length, saved: saved, msg: msg };
}

/** 트리거가 부르는 것 — 예외를 밖으로 안 낸다 */
function _piv_scheduled_() {
  try { partnerMirrorPurchaseToV2(); }
  catch (e) { Logger.log("[구매입력미러] 예외: " + (e && e.message ? e.message : e)); }
}

/**
 * 제 트리거를 «지운다». 더 이상 따로 걸지 않는다.
 *
 * ★ 2026-09-16: 22:10 자리를 21:30 반품미러로 합쳤다 ★
 *   > "이 두개 합치면 좋을듯"
 *   트리거가 20/20 으로 꽉 차서 마감·월정산·재매칭·푸시의 이어달리기
 *   (.after 트리거)가 한 번도 안 걸렸다. v2 로 미는 일이 셋이나
 *   따로 자리를 쓰고 있었기에 _prv_scheduled_ 하나로 묶었다.
 *   실제 미러는 _partnerReturnsV2Mirror.gs 의 _prv_scheduled_ 가 부른다.
 *
 *   이 함수는 옛 22:10 트리거가 남아 있는 계정을 치우는 용도로만 남긴다.
 *   두 번 눌러도 안전하다.
 */
function partnerInstallPurchaseMirrorTrigger() {
  var all = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "_piv_scheduled_") {
      ScriptApp.deleteTrigger(all[i]); removed++;
    }
  }
  var msg = removed
    ? "옛 22:10 구매입력 미러 트리거 " + removed + "개를 지웠습니다." + "\n" +
      "이제 21:30 「반품대장 + 보드 + 구매입력 → v2 미러」가 같이 돌립니다."
    : "따로 걸린 트리거가 없습니다 — 21:30 미러가 같이 돌립니다.";
  Logger.log("[구매입력미러] " + msg.split("\n").join(" "));
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/** 손으로 한 번 돌려 보고 결과를 본다 */
function partnerMirrorPurchaseNow() {
  var r = partnerMirrorPurchaseToV2();
  Logger.log(JSON.stringify(r));
  return r.msg;
}
