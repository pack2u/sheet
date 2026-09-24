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
 *    https://docs.google.com/spreadsheets/d/1xziVmMIsQfwyDwleNmB0haRsiE5t24aMu2SHkuI_34U/edit?gid=313764416
 *    (2026-09-16 에 옮겨졌다 — 옛 곳은 1mYKKQyPL1yh… 였다)
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
 *  ★ 상품정보시트를 거치지 않는다 ★
 *    처음엔 상품정보시트 프로젝트에 미러를 얹었다가 걷어냈다 —
 *    그 시트는 이미 무리가 오고 있어서 새 일을 얹지 않기로 했다 (2026-09-11 사장님).
 *    CS 웹앱은 별개 프로젝트라 이 시트를 직접 읽어도 그쪽에 부담이 없다.
 *
 *  ★ 끝 모양은 v2 안의 게시판이다 ★
 *    이 표는 결국 v2 에서 직접 고치는 화면이 된다. 그때 이 파일은 없어지고
 *    CS 화면은 v2 를 읽는다. 지울 것을 알고 만든 것이라 얇게 만든다.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 표가 다른 파일로 옮겨졌다 ★  (2026-09-16)
 *
 *  > "시트가 올겨졌네.."
 *
 *  옛 파일: 1mYKKQyPL1yhUC9N92Co3rfeAcenje_3lgRRABxNYiug  (첫 탭 하나짜리)
 *  새 파일: 1xziVmMIsQfwyDwleNmB0haRsiE5t24aMu2SHkuI_34U  (탭이 여럿)
 *
 *  ★ 첫 탭이 아니다 ★  새 파일에는 주문·계정·협력업체 표가 같이 산다.
 *  getSheets()[0] 로 읽으면 엉뚱한 표를 품절이라고 내놓는다.
 *
 *  ★ gid 로 찾되, 못 찾으면 «머리글로» 찾는다 ★
 *    gid 는 탭을 지웠다 새로 만들면 바뀐다. 그때 조용히 빈 목록이 되면
 *    「품절 없음」으로 보여 전화받는 사람이 잘못 답한다.
 *    탭을 훑어 「품절된 상품명」이 적힌 탭을 찾는다. 그것도 없으면 «말한다».
 * ══════════════════════════════════════════════════════════════
 */
var _CSSO_SHEET_ID_ = "1xziVmMIsQfwyDwleNmB0haRsiE5t24aMu2SHkuI_34U";
var _CSSO_GID_ = 313764416;
var _CSSO_CACHE_KEY_ = "CS_STOCKOUT_V2";   // 시트가 바뀌었다 — 옛 캐시를 버린다
var _CSSO_CACHE_SEC_ = 180;

/**
 * 품절 표가 든 탭을 찾는다.
 * ① gid 로  ② 머리글이 적힌 탭으로  ③ 못 찾으면 null
 */
function _csso_findTab_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === _CSSO_GID_) return sheets[i];
  }
  /*  gid 가 바뀌었다 — 머리글로 찾는다. 첫 스무 줄 A열만 보면 된다.  */
  for (var j = 0; j < sheets.length; j++) {
    try {
      var lr = Math.min(sheets[j].getLastRow(), 40);
      if (lr < 2) continue;
      var col = sheets[j].getRange(1, 1, lr, 1).getDisplayValues();
      for (var r = 0; r < col.length; r++) {
        var f = String(col[r][0] || "").replace(/[ 	]/g, "");
        for (var h = 0; h < _CSSO_HEADS_.length; h++) {
          if (f.indexOf(_CSSO_HEADS_[h].hit) !== -1) return sheets[j];
        }
      }
    } catch (e) {}
  }
  return null;
}

/** 머리글 낱말 → 덩어리 이름 (_stockoutV2Mirror.gs 와 같은 표) */
var _CSSO_HEADS_ = [
  { key: "예상", hit: "품절예상상품명" },
  { key: "품절", hit: "품절된상품명" },
  { key: "대리공급", hit: "대리공급품절상품명" },
];

/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 여기부터는 «CS 가 안 본다» ★  (2026-09-16)
 *
 *  > "이카운트 재고관리는 없어도되"
 *
 *  같은 시트 아래쪽에 「이카운트 재고 조정」 표가 붙어 있다. 그 머리글이
 *  위 표에 없어서 kind 가 «대리공급» 인 채로 그 열여섯 줄이 통째로
 *  「대리공급 품절」에 섞여 들어갔다. 품절이 아닌 것이 품절로 보였다.
 *
 *  이 표는 재고를 맞추는 «우리 일»이지 CS 가 전화받으며 볼 것이 아니다.
 *  여기서 읽기를 멈춘다.
 * ══════════════════════════════════════════════════════════════
 */
var _CSSO_STOP_ = ["이카운트재고조정"];

/**
 * ★ D열은 덩어리마다 뜻이 다르다 ★  (2026-09-16)
 *   품절예상 → 「재고수량」  ·  품절/대리공급 → 「상태값」
 *   같은 자리라고 같은 것이 아니다. 머리글에 적힌 «이름»을 그대로 들고
 *   간다 — 시트가 이름을 바꾸면 화면도 따라간다.
 */

/**
 * 칸 하나를 글자로.
 *
 * ★ 날짜 칸이 «날짜 값»으로 들어 있다 ★
 *   시트에 「9월14일」이라고 적혀 있어도 구글이 날짜로 알아듣고 저장한 칸이
 *   있다. getValues() 는 그걸 Date 로 준다. 그대로 String() 하면
 *     Mon Sep 14 2026 00:00:00 GMT+0900 (한국 표준시)
 *   가 나온다 — 실제로 화면에 그렇게 떴다 (2026-09-11).
 *   보이던 대로 「9월 14일」로 돌려준다.
 */
function _csso_txt_(v) {
  if (v === null || v === undefined) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    if (isNaN(v.getTime())) return "";
    return Utilities.formatDate(v, "Asia/Seoul", "M월 d일");
  }
  return String(v).replace(/[ 	　]+/g, " ").trim();
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
    var sh = _csso_findTab_(SpreadsheetApp.openById(_CSSO_SHEET_ID_));
    if (!sh) throw new Error("품절 표가 든 탭을 못 찾았습니다 (gid " + _CSSO_GID_ + " · 머리글로도 못 찾음)");
    var last = sh.getLastRow();
    if (last < 2) throw new Error("줄이 없습니다");

    var data = sh.getRange(1, 1, last, 6).getValues();
    var kind = "";
    var dName = "";            // 이 덩어리의 D열 머리글 (재고수량 / 상태값)
    for (var i = 0; i < data.length; i++) {
      var c0 = _csso_txt_(data[i][0]);
      if (!c0) continue;

      var flat = c0.replace(/[ \t]/g, "");

      /*  ★ 여기부터는 안 본다 ★ 「이카운트 재고 조정」 표가 아래 붙어 있다.
          안 멈추면 그 줄들이 바로 앞 덩어리(대리공급)에 섞여 들어간다.  */
      var 멈춤 = false;
      for (var st = 0; st < _CSSO_STOP_.length; st++) {
        if (flat.indexOf(_CSSO_STOP_[st]) !== -1) { 멈춤 = true; break; }
      }
      if (멈춤) break;

      var isHead = false;
      for (var h = 0; h < _CSSO_HEADS_.length; h++) {
        if (flat.indexOf(_CSSO_HEADS_[h].hit) !== -1) {
          kind = _CSSO_HEADS_[h].key;
          dName = _csso_txt_(data[i][3]);   // 「재고수량」인지 「상태값」인지
          isHead = true;
          break;
        }
      }
      if (isHead) continue;
      if (!kind) continue;

      out.rows.push({
        kind: kind,
        name: c0,
        code: _csso_txt_(data[i][1]),   // 옵션 — 없어도 줄을 버리지 않는다
        eta: _csso_txt_(data[i][2]),
        note: _csso_txt_(data[i][3]),
        dName: dName,                   // D열이 «무엇인지». 화면이 이걸 보고 적는다
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
