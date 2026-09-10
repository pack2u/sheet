/**
 * ══════════════════════════════════════════════════════════════
 *  팩투유 품절상품 — CS 화면이 읽는다
 *  파일: csStockout.gs
 *  ★ 2026-09-11 신규
 *
 *  > "웹앱 좌측 하단(주문,송장 검색 하단...현재 대시보드가 있는...)
 *     이 내용들이 보이면 좋겠어.. 이카운트 코드는 옵션이고"
 *  > "팩투유 품절상품은 당장 내일부터 사용하고싶어"
 *
 *  원본 시트
 *    https://docs.google.com/spreadsheets/d/1mYKKQyPL1yhUC9N92Co3rfeAcenje_3lgRRABxNYiug
 *
 *  ★ 전화를 받으면서 보는 자리다 ★
 *    「그거 언제 들어와요」 「대신 쓸 거 없어요」에 그 자리에서 답해야 한다.
 *    그래서 대체상품·급발송대안까지 한 줄에 같이 준다.
 *
 *  ★ 값을 해석하지 않는다 ★
 *    「입고 예정일」에 `????` · `9월14일` · `소량있다함 입고협의중` 이 섞여 있다.
 *    날짜로 바꾸려 들면 적을 수 있던 말을 못 적게 된다. 글자 그대로 준다.
 *    (`????` 만 화면에서 「미정」으로 읽어 준다 — 오류처럼 보이기 때문이다.)
 *
 *  ★ 캐시를 짧게 둔다 ★
 *    사람이 손으로 고치는 표다. 고치고 나서 한참 옛것이 보이면
 *    「안 고쳐졌네」 하고 또 고친다. 3분이면 충분하다.
 *
 *  ★ v2 와 «같은 규칙»이다 ★
 *    D:\Pack2U_상품정보sheet\_stockoutV2Mirror.gs 가 같은 시트를 같은 방식으로
 *    읽어 v2 로 보낸다. 머리글 낱말이 바뀌면 **둘 다** 고쳐야 한다.
 * ══════════════════════════════════════════════════════════════
 */

var _CSSO_SHEET_ID_ = "1mYKKQyPL1yhUC9N92Co3rfeAcenje_3lgRRABxNYiug";
var _CSSO_CACHE_KEY_ = "CS_STOCKOUT_V1";
var _CSSO_CACHE_SEC_ = 180;

/** 머리글 낱말 → 덩어리 이름 (_stockoutV2Mirror.gs 와 같은 표) */
var _CSSO_HEADS_ = [
  { key: "예상", hit: "품절예상상품명" },
  { key: "품절", hit: "품절된상품명" },
  { key: "대리공급", hit: "대리공급품절상품명" },
];

function _csso_txt_(v) {
  return String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim();
}

/**
 * 품절상품 표를 읽어 준다. 화면(home.html)이 부른다.
 *
 * @return {{ok:boolean, rows:Array, at:string, msg:string}}
 */
function csStockoutList() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}

  if (cache) {
    try {
      var hit = cache.get(_CSSO_CACHE_KEY_);
      if (hit) return JSON.parse(hit);
    } catch (e) {}
  }

  var out = { ok: false, rows: [], at: "", msg: "" };
  try {
    var sh = SpreadsheetApp.openById(_CSSO_SHEET_ID_).getSheets()[0];
    if (!sh) throw new Error("탭이 없습니다");
    var last = sh.getLastRow();
    if (last < 2) throw new Error("줄이 없습니다");

    var data = sh.getRange(1, 1, last, 6).getValues();
    var kind = "";
    for (var i = 0; i < data.length; i++) {
      var c0 = _csso_txt_(data[i][0]);
      if (!c0) continue;

      var flat = c0.replace(/\s/g, "");
      var isHead = false;
      for (var h = 0; h < _CSSO_HEADS_.length; h++) {
        if (flat.indexOf(_CSSO_HEADS_[h].hit) !== -1) { kind = _CSSO_HEADS_[h].key; isHead = true; break; }
      }
      if (isHead) continue;
      if (!kind) continue;

      out.rows.push({
        kind: kind,
        name: c0,
        code: _csso_txt_(data[i][1]),   // 옵션 — 없어도 줄을 버리지 않는다
        eta: _csso_txt_(data[i][2]),
        note: _csso_txt_(data[i][3]),
        alt: _csso_txt_(data[i][4]),
        urgent: _csso_txt_(data[i][5])
      });
    }
    out.ok = true;
    out.at = Utilities.formatDate(new Date(), "Asia/Seoul", "MM-dd HH:mm");
  } catch (e) {
    out.ok = false;
    out.msg = String(e && e.message ? e.message : e);
    /* 못 읽었으면 캐시에 넣지 않는다 — 3분 동안 「없음」이 보이면 안 된다 */
    return out;
  }

  if (cache) {
    try { cache.put(_CSSO_CACHE_KEY_, JSON.stringify(out), _CSSO_CACHE_SEC_); } catch (e) {}
  }
  return out;
}

/** 편집기에서 눈으로 확인할 때 */
function csStockoutPeek() {
  var r = csStockoutList();
  Logger.log("ok=" + r.ok + " 줄=" + r.rows.length + " " + (r.msg || ""));
  for (var i = 0; i < Math.min(5, r.rows.length); i++) {
    var x = r.rows[i];
    Logger.log("  " + x.kind + " | " + x.name + " | " + (x.code || "(코드없음)") + " | " + x.eta);
  }
  return r;
}
