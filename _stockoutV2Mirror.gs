/**
 * ══════════════════════════════════════════════════════════════
 *  팩투유 품절상품 → v2 미러
 *  파일: _stockoutV2Mirror.gs
 *  ★ 2026-09-11 신규
 *
 *  > "웹앱 좌측 하단 … 이 내용들이 보이면 좋겠어.. 이카운트 코드는 옵션이고"
 *  > "팩투유 품절상품은 당장 내일부터 사용하고싶어"
 *
 *  원본 시트
 *    https://docs.google.com/spreadsheets/d/1mYKKQyPL1yhUC9N92Co3rfeAcenje_3lgRRABxNYiug
 *
 *  ★ 표가 «세 덩어리»다 ★
 *    한 탭 안에 머리글이 세 번 나온다 — 품절 예상 / 품절 / 대리공급 품절.
 *    줄 수가 정해져 있지 않고 사이에 빈 줄이 있다. 그래서 행 번호로 자르지
 *    않고 **머리글을 만날 때마다 덩어리를 바꾼다.**
 *    (「품절 예상 상품명」·「품절된 상품명」·「대리공급 품절 상품명」)
 *
 *  ★ 값을 해석하지 않는다 ★
 *    「입고 예정일」에 `????` · `9월14일` · `소량있다함 입고협의중` 이 섞여 있고
 *    「재고수량」에 `1` · `뚜껑재고 2개` 가 섞여 있다.
 *    날짜나 숫자로 바꾸려 들면 **적을 수 있던 말을 못 적게 된다.**
 *    글자 그대로 보낸다. 판단은 읽는 사람이 한다.
 *
 *  ★ 이카운트코드는 옵션이다 ★
 *    사장님이 그렇게 정하셨다. 비었다고 줄을 버리지 않는다.
 *
 *  ★ 0줄이면 보내지 않는다 ★
 *    시트를 못 읽어 0줄이 되는 것과 「품절이 하나도 없다」는 구분이 안 된다.
 *    v2 쪽도 0줄을 받으면 아무것도 안 지운다. 양쪽에서 막아 둔다.
 * ══════════════════════════════════════════════════════════════
 */

var _SO_SHEET_ID_ = "1mYKKQyPL1yhUC9N92Co3rfeAcenje_3lgRRABxNYiug";
var _SO_PATH_ = "/api/stockouts/ingest";

/** 머리글 낱말 → 덩어리 이름 */
var _SO_HEADS_ = [
  { key: "예상", hit: "품절예상상품명" },
  { key: "품절", hit: "품절된상품명" },
  { key: "대리공급", hit: "대리공급품절상품명" },
];

function _so_url_() {
  try { if (typeof V2_URL !== "undefined" && V2_URL) return String(V2_URL).replace(/[/]+$/, ""); } catch (e) {}
  try { return (PropertiesService.getScriptProperties().getProperty("V2_URL") || "").replace(/[/]+$/, ""); } catch (e) {}
  return "";
}
function _so_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || ""; } catch (e) {}
  return "";
}

function _so_txt_(v) {
  return String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim();
}

/** 시트를 읽어 줄 목록으로. 못 읽으면 던진다 — 조용히 0줄이 되면 안 된다. */
function _so_read_() {
  var ss = SpreadsheetApp.openById(_SO_SHEET_ID_);
  var sh = ss.getSheets()[0];
  if (!sh) throw new Error("탭이 없습니다");
  var last = sh.getLastRow();
  if (last < 2) throw new Error("줄이 없습니다 (" + last + "행)");

  var data = sh.getRange(1, 1, last, 6).getValues();
  var rows = [], kind = "";

  for (var i = 0; i < data.length; i++) {
    var c0 = _so_txt_(data[i][0]);
    if (!c0) continue;

    /* 머리글인가 — 만나면 덩어리를 바꾸고 그 줄은 건너뛴다 */
    var flat = c0.replace(/\s/g, "");
    var isHead = false;
    for (var h = 0; h < _SO_HEADS_.length; h++) {
      if (flat.indexOf(_SO_HEADS_[h].hit) !== -1) { kind = _SO_HEADS_[h].key; isHead = true; break; }
    }
    if (isHead) continue;

    /* 머리글을 아직 못 만났으면 어느 덩어리인지 모른다 — 버리지 말고 알린다 */
    if (!kind) {
      Logger.log("[품절미러] 덩어리를 모르는 줄 " + (i + 1) + "행: " + c0.substring(0, 40));
      continue;
    }

    rows.push({
      kind: kind,
      item_name: c0,
      ecount_code: _so_txt_(data[i][1]),   // 옵션
      eta: _so_txt_(data[i][2]),
      stock_note: _so_txt_(data[i][3]),
      substitute: _so_txt_(data[i][4]),
      urgent: _so_txt_(data[i][5]),
    });
  }
  return rows;
}

/**
 * 품절상품 표를 v2 로 보낸다.
 * @return {{ok:boolean, sent:number, msg:string}}
 */
function partnerMirrorStockoutsToV2() {
  if (!_so_url_() || !_so_token_()) {
    var m0 = "v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)";
    Logger.log("[품절미러] " + m0);
    return { ok: false, sent: 0, msg: m0 };
  }

  var rows;
  try {
    rows = _so_read_();
  } catch (e) {
    var m1 = "품절 시트를 못 읽었습니다: " + (e && e.message ? e.message : e);
    Logger.log("[품절미러] " + m1);
    try {
      _chat_sendCard_("❌ 품절상품 미러 — 시트를 못 읽었습니다",
        Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        [{ label: "이유", value: String(m1).substring(0, 200) }]);
    } catch (_) {}
    return { ok: false, sent: 0, msg: m1 };
  }

  if (!rows.length) {
    /* 0줄을 보내면 v2 가 통째로 비워질 뻔한다 — v2 도 막아 두지만 여기서도 막는다 */
    var m2 = "읽은 줄이 0입니다 — 보내지 않았습니다";
    Logger.log("[품절미러] " + m2);
    return { ok: false, sent: 0, msg: m2 };
  }

  var res;
  try {
    res = UrlFetchApp.fetch(_so_url_() + _SO_PATH_, {
      method: "post",
      contentType: "application/json",
      headers: { "x-ingest-token": _so_token_() },
      payload: JSON.stringify({ rows: rows }),
      muteHttpExceptions: true,
    });
  } catch (eF) {
    var m3 = "보내기 실패: " + (eF && eF.message ? eF.message : eF);
    Logger.log("[품절미러] " + m3);
    return { ok: false, sent: 0, msg: m3 };
  }

  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code !== 200) {
    var m4 = "HTTP " + code + " " + String(text).substring(0, 200);
    Logger.log("[품절미러] " + m4);
    return { ok: false, sent: 0, msg: m4 };
  }

  var j = {};
  try { j = JSON.parse(text); } catch (e2) {}
  var msg = "품절상품 " + (j.saved || 0) + "줄 보냈습니다 (지운 옛 줄 " + (j.removed || 0) + ")";
  if (j.warn) msg += " · " + j.warn;
  Logger.log("[품절미러] " + msg);

  /* 모르는 덩어리가 있으면 알린다 — 시트에 머리글이 하나 더 생겼을 수 있다 */
  try {
    var uk = j.unknownKind || {};
    var keys = Object.keys(uk);
    if (keys.length) {
      _chat_sendCard_("⚠ 품절상품 미러 — 모르는 덩어리",
        Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        keys.map(function (k) { return { label: "「" + k + "」", value: uk[k] + "줄" }; }));
    }
  } catch (_) {}

  return { ok: true, sent: j.saved || 0, msg: msg };
}

/** 트리거용 — 예외를 절대 밖으로 안 낸다 */
function _so_scheduled_() {
  try {
    partnerMirrorStockoutsToV2();
  } catch (e) {
    Logger.log("[품절미러] 예기치 못한 오류(무시): " + (e && e.message ? e.message : e));
  }
}

/** 메뉴 — 지금 한 번 보낸다 */
function partnerMirrorStockoutsNow() {
  var r = partnerMirrorStockoutsToV2();
  try { SpreadsheetApp.getUi().alert("팩투유 품절상품 → v2\n\n" + r.msg); } catch (e) {}
  return r;
}
