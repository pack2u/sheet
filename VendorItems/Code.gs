/**
 * ══════════════════════════════════════════════════════════════
 *  업체별 취급 품목 수집기
 *  프로젝트: P2U 업체품목수집 (별도 스크립트 프로젝트)
 *  ★ 2026-09-11 신규
 *
 *  > "업체마다 판매할수 있는제품이 달라.. 그래서 단가조회가 각 업체 시트마다
 *     있었던거야..가격과 제품수가 달라서.."
 *
 *  ★ 왜 «별도 프로젝트»인가 ★
 *    상품정보시트 프로젝트에 넣지 않는다. 거기는 이미 시간 트리거 20개로
 *    구글 한도에 닿아 있고 무리가 오고 있다 (2026-09-11 사장님).
 *    47개 시트를 도는 일은 오래 걸려서, 얹으면 밤 마감이 못 돌 수 있다.
 *    여기는 이 일만 한다.
 *
 *  ★ 업체 목록도 v2 에서 받는다 ★
 *    상품정보시트를 아예 안 본다. v2 의 vendors 에 legacy_sheet_id 가
 *    전부(47/47) 들어 있다 — 그것으로 충분하다.
 *
 *  ★ 나눠서 돈다 ★
 *    한 번에 47개를 열면 6분 제한에 걸린다. 몇 개씩 처리하고
 *    「다음은 여기부터」를 돌려준다. 부르는 쪽이 이어서 부른다.
 *
 *  ★ 0개를 «성공»이라 하지 않는다 ★
 *    탭을 못 찾은 것과 정말 품목이 없는 것은 다르다. 0개면 v2 에
 *    「못 모았다」로 적고 그 업체 표는 건드리지 않는다.
 *    표가 비면 발주 화면이 그 업체를 안 거른다(sql/57) — 비는 편이
 *    거짓으로 막는 것보다 낫지만, 「모았는데 0개」로 남으면 안 된다.
 *
 *  ★ 읽기만 한다 ★
 *    Sheets REST API 를 spreadsheets.readonly 로 부른다. 47개 «업체» 시트를
 *    여는 일이라, 버그 하나가 남의 장부를 망가뜨리는 길을 아예 막아 둔다.
 */

var VI_PATH_ = "/api/vendor-items/ingest";

/** 한 번에 볼 업체 수. 시트 하나 여는 데 2~5초쯤 걸린다. */
var VI_CHUNK_ = 6;

function vi_url_() {
  try { if (typeof V2_URL !== "undefined" && V2_URL) return String(V2_URL).replace(/[/]+$/, ""); } catch (e) {}
  return "";
}
function vi_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  return "";
}
function vi_runKey_() {
  try { if (typeof VI_RUN_KEY !== "undefined" && VI_RUN_KEY) return String(VI_RUN_KEY); } catch (e) {}
  return "";
}

/**
 * ★ 왜 SpreadsheetApp 인가 (2026-09-11) ★
 *   처음엔 Sheets REST API 를 «읽기 전용» 권한으로 부르려 했다. 47개 «업체»
 *   시트를 여는 일이라 읽기만 되는 편이 안전하기 때문이다.
 *   그런데 스크립트가 쓰는 숨은 GCP 프로젝트에 Sheets API 가 꺼져 있었고
 *   (HTTP 403 "has not been used in project 114319581234 before"),
 *   그 프로젝트는 우리가 만질 수 없다.
 *
 *   그래서 SpreadsheetApp 으로 돌아왔다. 권한이 한 칸 넓다(보기 및 관리).
 *   ★ 대신 이 파일에는 «쓰는 명령이 한 줄도 없다» ★
 *     getSheets · getName · getRange().getValues() 뿐이다.
 *     고칠 때도 이 약속을 지킨다 — 남의 장부다.
 */

/** 단가조회 탭 찾기 — _partnerLibrary.gs 의 _p2uLib_findViewer_ 와 같은 규칙 */
function vi_findViewer_(ss) {
  var want = ["단가조회", "팩투유 단가조회", "뷰어"];
  for (var i = 0; i < want.length; i++) {
    var t = ss.getSheetByName(want[i]);
    if (t) return t;
  }
  var all = ss.getSheets();
  for (var j = 0; j < all.length; j++) {
    var n = all[j].getName();
    if (n.indexOf("마감") !== -1 || n.indexOf("발주") !== -1 ||
        n.indexOf("설정") !== -1 || n.indexOf("검색") !== -1 ||
        n.indexOf("취소") !== -1) continue;
    if (n.indexOf("단가") !== -1 || n.indexOf("뷰어") !== -1 ||
        n.indexOf("팩투유") !== -1) return all[j];
  }
  /* ★ 못 찾으면 첫 탭으로 «떨어지지 않는다» ★
     엉뚱한 탭을 읽으면 엉뚱한 취급 목록이 만들어진다. 없는 것보다 나쁘다. */
  return null;
}

function vi_txt_(v) {
  if (v === null || v === undefined) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") return "";
  return String(v).replace(/[ 	　]+/g, " ").trim();
}

/**
 * 한 업체의 단가조회 탭을 읽는다.
 *
 * ★ 행·열을 «이름»으로 찾는다 ★
 *   시트마다 위에 붙은 안내 줄 수가 다르다. 당장드림은 1행 공지 · 3행 머리글 ·
 *   4행부터 자료였다. 박아 두면 시트마다 어긋난다.
 *   위 여덟 줄에서 「이카운트코드」와 「품목명」이 같이 있는 줄을 머리글로 본다.
 */
function vi_readOne_(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
  var tab = vi_findViewer_(ss);
  if (!tab) {
    return { ok: false, tab: "", rows: [], msg: "단가조회 탭을 못 찾았습니다 (" +
      ss.getSheets().map(function (x) { return x.getName(); }).slice(0, 12).join(" · ") + ")" };
  }

  var last = tab.getLastRow();
  var wide = Math.max(7, Math.min(12, tab.getLastColumn()));
  if (last < 2) return { ok: false, tab: tab.getName(), rows: [], msg: last + "행뿐입니다" };

  var head = tab.getRange(1, 1, Math.min(8, last), wide).getValues();
  var hr = -1, col = {};
  for (var r = 0; r < head.length; r++) {
    var m = {};
    for (var c = 0; c < head[r].length; c++) {
      var t = vi_txt_(head[r][c]).replace(/[ 　]/g, "");
      if (t === "이카운트코드" || t === "품목코드") m.code = c;
      else if (t === "품목명" || t === "상품명") m.name = c;
      else if (t === "상태") m.status = c;
      else if (t === "최종단가" || t === "단가" || t === "적용단가") m.price = c;
    }
    if (m.code !== undefined && m.name !== undefined) { hr = r + 1; col = m; break; }
  }
  if (hr < 0) {
    return { ok: false, tab: tab.getName(), rows: [],
      msg: "머리글(이카운트코드·품목명)을 위 여덟 줄에서 못 찾았습니다" };
  }
  if (last <= hr) {
    return { ok: false, tab: tab.getName(), rows: [], msg: "머리글 " + hr + "행 아래에 자료가 없습니다" };
  }

  var data = tab.getRange(hr + 1, 1, last - hr, wide).getValues();
  var rows = [], 이상 = 0, seen = {};
  for (var i = 0; i < data.length; i++) {
    var code = vi_txt_(data[i][col.code]);
    if (!code) continue;
    /* 코드처럼 안 생긴 것은 세어만 둔다 — 자리가 밀렸는지 알려면 필요하다 */
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/.test(code)) { 이상++; continue; }
    if (seen[code]) continue;
    seen[code] = true;
    rows.push({
      ecount_code: code,
      item_name: (col.name !== undefined ? vi_txt_(data[i][col.name]) : "") || null,
      unit_price: col.price !== undefined ? vi_txt_(data[i][col.price]) : null,
      status_note: (col.status !== undefined ? vi_txt_(data[i][col.status]) : "") || null
    });
  }

  if (!rows.length) {
    return { ok: false, tab: tab.getName(), rows: [], 이상: 이상,
      msg: "머리글 " + hr + "행 · 아래 " + (last - hr) + "줄을 훑었는데 코드가 0개 (모양 아닌 것 " + 이상 + ")" };
  }
  return { ok: true, tab: tab.getName() + " (머리글 " + hr + "행)", rows: rows, 이상: 이상 };
}

function vi_post_(payload) {
  var res = UrlFetchApp.fetch(vi_url_() + VI_PATH_, {
    method: "post",
    contentType: "application/json",
    headers: { "x-ingest-token": vi_token_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

function vi_vendors_() {
  var res = UrlFetchApp.fetch(vi_url_() + VI_PATH_, {
    method: "get",
    headers: { "x-ingest-token": vi_token_() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("업체 목록 HTTP " + res.getResponseCode() + " " + res.getContentText().substring(0, 160));
  }
  var j = JSON.parse(res.getContentText());
  if (!j || !j.ok) throw new Error("업체 목록: " + (j && j.error));
  return j.vendors || [];
}

/**
 * from 번째부터 n 곳을 모은다.
 * @return {{ok, done, from, next, total, results:Array}}
 */
function viCollect(from, n) {
  from = parseInt(from, 10) || 0;
  n = parseInt(n, 10) || VI_CHUNK_;

  if (!vi_url_() || !vi_token_()) {
    return { ok: false, msg: "V2_URL / V2_INGEST_TOKEN 이 없습니다 (_secrets.gs)" };
  }

  var vendors = vi_vendors_();
  var slice = vendors.slice(from, from + n);
  var out = [];

  for (var i = 0; i < slice.length; i++) {
    var v = slice[i];
    var one;
    try {
      one = vi_readOne_(v.legacy_sheet_id);
    } catch (e) {
      one = { ok: false, tab: "", rows: [], msg: "시트를 못 열었습니다: " + (e && e.message ? e.message : e) };
    }

    var sent;
    if (one.ok) {
      sent = vi_post_({ vendor_id: v.id, tab_name: one.tab, rows: one.rows });
    } else {
      /* 실패도 «적으러» 간다. 아무 말 없이 넘어가면 그 업체가 왜 안 걸러지는지 모른다. */
      sent = vi_post_({ vendor_id: v.id, tab_name: one.tab, failed: one.msg });
    }

    out.push({
      name: v.name,
      tab: one.tab,
      n: one.rows.length,
      이상: one.이상 || 0,
      ok: one.ok,
      msg: one.msg || "",
      http: sent.code,
      resp: sent.code === 200 ? "" : String(sent.text).substring(0, 160)
    });
  }

  var next = from + slice.length;
  return {
    ok: true,
    done: next >= vendors.length,
    from: from,
    next: next,
    total: vendors.length,
    results: out
  };
}

/**
 * 밖에서 부르는 문. 열쇠가 맞아야 돈다.
 *   ?key=…&from=0&n=6
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (!vi_runKey_() || p.key !== vi_runKey_()) {
      out = { ok: false, error: "열쇠가 맞지 않습니다" };
    } else {
      out = viCollect(p.from, p.n);
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 편집기에서 한 곳만 눈으로 볼 때 */
function viPeek() {
  var vendors = vi_vendors_();
  Logger.log("업체 " + vendors.length + "곳");
  var one = vi_readOne_(vendors[0].legacy_sheet_id);
  Logger.log(vendors[0].name + " · 탭 " + one.tab + " · " + one.rows.length + "개 · " + (one.msg || ""));
  for (var i = 0; i < Math.min(5, one.rows.length); i++) {
    Logger.log("   " + one.rows[i].ecount_code + " | " + one.rows[i].item_name + " | " + one.rows[i].unit_price);
  }
}
