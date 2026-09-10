/**
 * ══════════════════════════════════════════════════════════════
 *  품목 상태·재고 → v2 미러
 *  파일: _productsV2Mirror.gs
 *  ★ 2026-09-10 신규
 *
 *  > "제품명을 넣으면 검색되고 … 현재 상태가 판매중인지 품절인지 바로 확인"
 *
 *  ★ 왜 필요했나 ★
 *    v2 의 `products` 는 2026-09-08 23:26 에 한 번 부어 놓은 것이 전부였다.
 *    3,498줄 전부 updated_at 이 같은 시각이다. 시트의 상품 동기화
 *    (_sb_syncProducts_)는 **옛 프로젝트**의 products_hub 로 가고,
 *    v2 에는 그 이름의 표가 없다 — 그래서 아무것도 안 따라왔다.
 *    발주 화면이 「판매중」이라고 말할 근거가 없던 이유다.
 *
 *  ★ 열을 «이름»으로 찾는다 ★
 *    상품정보 탭의 열 위치는 코드마다 다르게 적혀 있다 —
 *    _sb_syncProducts_ 는 「A=상태 C=품목명 E=코드」, CS/Code.gs 도 그렇게,
 *    실제 머리글은 「이카운트코드 · 상태 · 출고지 · 품목명 …」 이다.
 *    어느 쪽이 맞는지 다투는 대신 **머리글 이름으로 찾고, 못 찾으면 멈춘다.**
 *    자리를 못 찾았는데 그냥 도는 것이 제일 나쁘다.
 *
 *  ★ «언제 것인가»가 숫자보다 중요하다 ★
 *    이카운트 재고는 실시간이 아니다. 아침에 사람이 실재고와 맞춘다.
 *    그래서 이 미러는 **이카운트 배치 직후에만** 돈다 — 그래야 v2 의
 *    updated_at 이 「이카운트에서 받아온 시각」과 같은 뜻이 된다.
 *    아무 때나 돌리면 시각만 새것이 되고 숫자는 옛것이 된다. 그게 제일 위험하다.
 *
 *  ★ 모르는 상태를 조용히 버리지 않는다 ★
 *    v2 의 status 는 일곱 가지만 받는다. 시트에 새 낱말이 생기면 그 줄만
 *    안 들어가는데, 그러면 「그 품목만 화면에서 사라진다」.
 *    무엇이 몇 개 걸렸는지 세어서 로그와 구글 챗에 남긴다.
 * ══════════════════════════════════════════════════════════════
 */

var _PV2_MASTER_TAB_ = "상품정보";
var _PV2_STOCK_TAB_ = "이카운트-재고";
var _PV2_PATH_ = "/api/products/ingest";
/** 한 번에 보낼 줄 수. v2 문이 1000줄까지 받는다. */
var _PV2_CHUNK_ = 500;

function _pv2_url_() {
  try { if (typeof V2_URL !== "undefined" && V2_URL) return String(V2_URL).replace(/[/]+$/, ""); } catch (e) {}
  try { return (PropertiesService.getScriptProperties().getProperty("V2_URL") || "").replace(/[/]+$/, ""); } catch (e) {}
  return "";
}
function _pv2_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  try { return PropertiesService.getScriptProperties().getProperty("V2_INGEST_TOKEN") || ""; } catch (e) {}
  return "";
}

/**
 * 머리글을 찾아 이름 → 열번호(0부터) 를 만든다.
 *
 * ★ 머리글이 한 «줄»에 다 있지 않다 ★
 *   상품정보 탭은 머리글이 1~3행에 걸쳐 있고 병합된 칸도 있다.
 *   한 줄만 보고 찾으면 「머리글을 못 찾았습니다」로 멈춘다 — 실제로 그랬다.
 *   priceManager.gs 도 1행·2행을 섞어 읽는다(1638~1650행). 같은 방식으로 한다:
 *   **열마다 위에서부터 처음 값이 있는 칸**을 그 열의 이름으로 본다.
 *
 * ★ 못 찾으면 «무엇을 봤는지» 보여 준다 ★
 *   이름만 대고 멈추면 시트를 열어 눈으로 뒤져야 한다. 본 것을 같이 준다.
 */
function _pv2_header_(tab, wanted) {
  var rows = Math.min(4, tab.getLastRow());
  if (rows < 1) return null;
  var lastCol = tab.getLastColumn();
  var head = tab.getRange(1, 1, rows, lastCol).getValues();

  /* ★ 한 열에 «1~4행 값을 모두» 후보로 둔다 ★
     「위에서 처음 값」만 보면 안 된다 — 상품정보 A1 에는 갱신 시각이
     들어 있어서(ThuSep10 2026 12:06:00…) 그걸 열 이름으로 잡았다.
     실제 「상태」는 그 아래 행에 있다. 그래서 행을 가리지 않고 다 본다. */
  var cand = [], rowOf = [];
  for (var c = 0; c < lastCol; c++) {
    var list = [], first = 0;
    for (var r = 0; r < rows; r++) {
      var t = String(head[r][c] || "").replace(/[ 	　]/g, "");
      if (t) { list.push({ v: t, r: r + 1 }); if (!first) first = r + 1; }
    }
    cand.push(list); rowOf.push(first);
  }

  var map = {}, lastHeaderRow = 1;
  for (var w = 0; w < wanted.length; w++) {
    var key = wanted[w].key, want = wanted[w].names;
    for (var c2 = 0; c2 < cand.length && map[key] === undefined; c2++) {
      for (var q = 0; q < cand[c2].length && map[key] === undefined; q++) {
        for (var n = 0; n < want.length; n++) {
          if (cand[c2][q].v === want[n]) {
            map[key] = c2;
            if (cand[c2][q].r > lastHeaderRow) lastHeaderRow = cand[c2][q].r;
            break;
          }
        }
      }
    }
  }

  for (var w2 = 0; w2 < wanted.length; w2++) {
    if (wanted[w2].required && map[wanted[w2].key] === undefined) {
      /* 본 것을 남긴다. 이게 없으면 다음 사람이 또 시트를 뒤진다. */
      map._missing = wanted[w2].key;
      var seen = [];
      for (var sc = 0; sc < cand.length; sc++)
        for (var sq = 0; sq < cand[sc].length; sq++) seen.push(cand[sc][sq].v);
      map._seen = seen.slice(0, 60).join(" · ");
      return map;
    }
  }
  map._row = lastHeaderRow;
  return map;
}

/** 열 번호를 사람이 읽는 글자로 — 로그에서 눈으로 확인하려고 */
function _pv2_col_(i) {
  if (i === undefined || i === null) return "-";
  var s = "", n = i + 1;
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** 숫자로 — 빈칸·글자는 null. 0 과 «모름» 을 가르려고 따로 둔다. */
function _pv2_num_(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(String(v).replace(/[, ]/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * 「몸통+뚜껑을 조합해 나가는 세트」인가 — 세트분리와 «같은 규칙»이다
 * (세트분리V2/core.js ssNeedsBom_).
 *
 *   숫자 바로 앞의 한글 「세트」  → 조합 세트  (1000세트 · 100 세트 · 전각 １세트)
 *   영문 「SET」                 → 한 박스 완제품, 재고를 그대로 믿는다
 *   「수저세트」·「바디세트」      → 낱말 일부. 조합이 아니다
 *
 * 두 곳에 같은 규칙이 있는 것이 마음에 걸리지만, 프로젝트가 달라 함수를
 * 나눠 쓸 수 없다. 고칠 때는 **반드시 둘 다** 고친다.
 */
function _pv2_isComboSet_(name) {
  var n = String(name || "");
  if (!n) return false;
  if (n.indexOf("샘플") !== -1) return false;
  return /[0-9０-９][ 　]*세트/.test(n);
}

/** 상품정보 탭 → { code: {item_name, status, retail_price, supplier_name, warehouse} } */
function _pv2_readMaster_(ss) {
  var tab = ss.getSheetByName(_PV2_MASTER_TAB_);
  if (!tab) throw new Error("「" + _PV2_MASTER_TAB_ + "」 탭이 없습니다");

  var map = _pv2_header_(tab, [
    /* 2026-09-10 실제 머리글을 눈으로 확인하고 맞췄다 —
       「이카운트상품명/옵션명」이 품목명이고, 재고도 이 탭에 있다. */
    { key: "code", names: ["이카운트코드", "품목코드", "코드"], required: true },
    { key: "name", names: ["이카운트상품명/옵션명", "품목명", "상품명", "품명"], required: true },
    { key: "status", names: ["상태", "판매상태", "상품상태"], required: true },
    { key: "stock", names: ["재고수량", "가용수량", "재고"], required: false },
    { key: "shopname", names: ["쇼핑몰판매상품명"], required: false },
    { key: "supplier", names: ["구매처", "구매처명"], required: false },
    { key: "warehouse", names: ["출고지"], required: false }
  ]);
  if (!map || map._missing) {
    throw new Error("「" + _PV2_MASTER_TAB_ + "」에서 «" + (map && map._missing || "머리글") +
      "» 을 못 찾았습니다. 본 머리글 → " + ((map && map._seen) || "(없음)"));
  }
  Logger.log("[품목미러] 상품정보 머리글 " + map._row + "행 · 코드=" + _pv2_col_(map.code) +
    " 품목명=" + _pv2_col_(map.name) + " 상태=" + _pv2_col_(map.status) +
    " 재고=" + _pv2_col_(map.stock) + " 출고지=" + _pv2_col_(map.warehouse) +
    " · 머리글 마지막 " + map._row + "행");

  var last = tab.getLastRow();
  if (last <= map._row) return {};
  var data = tab.getRange(map._row + 1, 1, last - map._row, tab.getLastColumn()).getValues();

  var out = {}, n = 0;
  for (var i = 0; i < data.length; i++) {
    var code = String(data[i][map.code] || "").trim();
    if (!code) continue;
    /* 머리글이 여러 줄이면 그 아래 한두 줄이 아직 부머리글일 수 있다.
       코드 칸에 「이카운트코드」 같은 낱말이 있으면 그 줄은 자료가 아니다. */
    if (/^(이카운트코드|품목코드|코드|이카운트)$/.test(code)) continue;
    var name = String(data[i][map.name] || "").trim();
    if (!name) continue;
    out[code] = {
      ecount_code: code,
      item_name: name,
      status: String(data[i][map.status] || "").trim(),
      retail_price: null,
      supplier_name: map.supplier !== undefined ? String(data[i][map.supplier] || "").trim() : null,
      warehouse: map.warehouse !== undefined ? String(data[i][map.warehouse] || "").trim() : null,
      /* ★ 조합 세트의 재고 숫자는 «뜻이 없다» ★
         몸통·뚜껑을 따로 갖고 조합해 나가므로 이카운트가 세트 재고를
         관리하지 않는다. 시트에는 0 으로 보이는데 그 0 은 품절이 아니라
         「모른다」다. 0 으로 보내면 화면이 품절이라고 말하게 된다.
         그래서 숫자를 버리고 비운다 — 화면은 「구성품으로 확인」이라 한다. */
      stock_qty: _pv2_isComboSet_(name) ? null :
        (map.stock !== undefined ? _pv2_num_(data[i][map.stock]) : null)
    };
    n++;
  }
  Logger.log("[품목미러] 상품정보 " + n + "줄");
  return out;
}

/** 이카운트-재고 탭 → { code: 수량 }. 없으면 빈 것을 준다(재고는 없어도 상태는 보낸다). */
function _pv2_readStock_(ss) {
  var tab = ss.getSheetByName(_PV2_STOCK_TAB_);
  if (!tab) {
    Logger.log("[품목미러] 「" + _PV2_STOCK_TAB_ + "」 탭이 없습니다 — 재고 없이 상태만 보냅니다");
    return {};
  }
  var map = _pv2_header_(tab, [
    { key: "code", names: ["품목코드", "이카운트코드", "코드"], required: true },
    /* ★ 「가용수량」이 먼저다 ★
       세트분리V2 의 설정이 이 탭을 «A=코드 B=가용수량» 으로 읽는다
       (세트분리V2/gasIO.js 139행). 매일 도는 쪽이 보는 이름이 맞는 이름이다. */
    { key: "qty", names: ["가용수량", "재고수량", "재고"], required: true }
  ]);
  if (!map || map._missing) {
    Logger.log("[품목미러] 재고 탭에서 «" + ((map && map._missing) || "머리글") +
      "» 을 못 찾았습니다 — 재고 없이 상태만 보냅니다. 본 머리글: " + ((map && map._seen) || "(없음)"));
    return {};
  }
  var last = tab.getLastRow();
  if (last <= map._row) return {};
  var data = tab.getRange(map._row + 1, 1, last - map._row, tab.getLastColumn()).getValues();
  var out = {}, n = 0;
  for (var i = 0; i < data.length; i++) {
    var code = String(data[i][map.code] || "").trim();
    if (!code) continue;
    var q = parseInt(String(data[i][map.qty] || "").replace(/[, ]/g, ""), 10);
    out[code] = isNaN(q) ? null : q;
    n++;
  }
  Logger.log("[품목미러] 재고 " + n + "줄 (머리글 " + map._row + "행 · 코드=" +
    _pv2_col_(map.code) + " 수량=" + _pv2_col_(map.qty) + ")");
  return out;
}

function _pv2_send_(rows) {
  var res = UrlFetchApp.fetch(_pv2_url_() + _PV2_PATH_, {
    method: "post",
    contentType: "application/json",
    headers: { "x-ingest-token": _pv2_token_() },
    payload: JSON.stringify({ rows: rows }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code !== 200) throw new Error("HTTP " + code + " " + String(text).substring(0, 200));
  var j;
  try { j = JSON.parse(text); } catch (e) { throw new Error("응답을 못 읽었습니다: " + String(text).substring(0, 120)); }
  if (!j || j.ok !== true) throw new Error(String((j && j.error) || "알 수 없는 실패"));
  return j;
}

/**
 * 품목 상태·재고를 v2 로 보낸다.
 * @return {{ok:boolean, saved:number, skipped:number, msg:string}}
 */
function partnerMirrorProductsToV2() {
  if (!_pv2_url_() || !_pv2_token_()) {
    var m0 = "v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)";
    Logger.log("[품목미러] " + m0);
    return { ok: false, saved: 0, skipped: 0, msg: m0 };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master, stock;
  try {
    master = _pv2_readMaster_(ss);
    stock = _pv2_readStock_(ss);
  } catch (e) {
    var m1 = String(e && e.message ? e.message : e);
    Logger.log("[품목미러] " + m1);
    try {
      _chat_sendCard_("❌ 품목 미러 — 시트를 못 읽었습니다",
        Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        [{ label: "이유", value: m1.substring(0, 200) }]);
    } catch (_) {}
    return { ok: false, saved: 0, skipped: 0, msg: m1 };
  }

  var rows = [], codes = Object.keys(master);
  for (var i = 0; i < codes.length; i++) {
    var r = master[codes[i]];
    if (stock[codes[i]] !== undefined) r.stock_qty = stock[codes[i]];
    rows.push(r);
  }
  if (!rows.length) {
    Logger.log("[품목미러] 보낼 줄이 없습니다");
    return { ok: true, saved: 0, skipped: 0, msg: "보낼 것 없음" };
  }

  var saved = 0, skipped = 0, noName = 0, unknown = {}, errs = [];
  for (var s = 0; s < rows.length; s += _PV2_CHUNK_) {
    var chunk = rows.slice(s, s + _PV2_CHUNK_);
    try {
      var j = _pv2_send_(chunk);
      saved += j.saved || 0;
      skipped += j.skipped || 0;
      noName += j.noName || 0;
      if (j.unknown) {
        for (var k in j.unknown) unknown[k] = (unknown[k] || 0) + j.unknown[k];
      }
    } catch (eS) {
      errs.push(String(eS.message || eS).substring(0, 160));
    }
  }

  var msg = "품목 " + saved + "줄 갱신";
  if (skipped) msg += " · 못 보낸 것 " + skipped + "줄";
  if (errs.length) msg += " · 실패 " + errs.length + "묶음";
  Logger.log("[품목미러] " + msg);

  /* 모르는 상태가 있으면 «반드시» 알린다. 그 품목만 화면에서 사라지기 때문이다. */
  var unknownKeys = Object.keys(unknown);
  if (unknownKeys.length || errs.length) {
    var lines = [];
    for (var u = 0; u < unknownKeys.length; u++) {
      lines.push({ label: "모르는 상태 「" + unknownKeys[u] + "」", value: unknown[unknownKeys[u]] + "줄" });
    }
    if (noName) lines.push({ label: "품목명이 빈 줄", value: noName + "줄" });
    if (errs.length) lines.push({ label: "오류", value: errs[0] });
    try {
      _chat_sendCard_("⚠ 품목 미러 — 확인이 필요합니다",
        Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), lines);
    } catch (_) {}
  }

  return { ok: !errs.length, saved: saved, skipped: skipped, msg: msg };
}

/** 트리거용 — 예외를 절대 밖으로 안 낸다. 이카운트 배치를 죽이면 안 된다. */
function _pv2_scheduled_() {
  try {
    partnerMirrorProductsToV2();
  } catch (e) {
    Logger.log("[품목미러] 예기치 못한 오류(무시): " + (e && e.message ? e.message : e));
  }
}

/** 메뉴 — 지금 한 번 보낸다 */
function partnerMirrorProductsNow() {
  var r = partnerMirrorProductsToV2();
  try { SpreadsheetApp.getUi().alert("품목 상태·재고 → v2\n\n" + r.msg); } catch (e) {}
  return r;
}
