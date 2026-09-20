/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 발주 및 송장조회
 *
 *  > "발주 및 송장조회 탭도 붙여줘. 중요한건 제품명 검색기능이 들어가야되고
 *  >  (특히 앞으로 가게업체의 경우).. 내용을 복붙하는 경우가 많기때문에...
 *  >  이부분도 편하게 되야되.."
 *
 *  ★ 붙여넣기가 이 화면의 기본 동작이다 ★
 *    가게업체는 제품명을 손으로 치지 않는다. 주문서·카톡·엑셀에서 «긁어»
 *    붙인다. 그렇게 붙인 글자에는 수량(× 3), 탭, 줄바꿈, 괄호 규격, 「/소분」
 *    같은 군더더기가 늘 섞여 있다. 그걸 그대로 받아 찾아 주지 않으면
 *    사람이 지우고 다듬는 일을 하게 된다 — 그럴 거면 시트를 열지.
 *
 *    그래서 두 가지를 한다.
 *      ① 한 줄에 여러 낱말이 있으면 «다 들어 있는» 건을 찾는다 (AND).
 *      ② 여러 줄을 붙이면 «줄마다 따로» 찾아 줄별로 답한다.
 *         열 줄을 붙이면 열 번 검색한 것과 같다.
 *
 *  ★ 읽기만 한다 ★ 이 파일은 업체 장부에 아무것도 쓰지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

var PRP_ORD_LIVE_LIMIT_ = 300;   // 검색어 없이 훑을 때 「발주 및 송장조회」 최대
var PRP_ORD_HIT_LIMIT_ = 20;     // 붙여넣은 한 줄당 최대
var PRP_ORD_TOTAL_LIMIT_ = 300;  // 한 번에 돌려주는 전체 최대

/**
 * 붙여넣은 글에서 찾을 낱말을 뽑는다.
 *
 * 수량·단위·구분기호는 버린다. 「JH 실링 191455-2B (21호2칸) × 2」 를 붙이면
 * 「jh · 실링 · 191455-2b · 21호2칸」 이 남는다. 수량 2 는 품목명이 아니다.
 */
function prpOrdTerms_(line) {
  var s = String(line || "")
    .replace(/[×xX]\s*\d+\s*$/, " ")        // 끝의 「× 3」
    .replace(/\b\d+\s*(개|세트|팩|박스|EA|ea)\b/g, " ")
    .replace(/[\t,;|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!s) return [];
  var raw = s.split(" ");
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i].replace(/^[\(\[\{]+|[\)\]\}]+$/g, "").toLowerCase();
    /*  한 글자짜리는 버린다 — 「1」·「소」 하나로는 아무것도 못 좁히고,
        오히려 엉뚱한 건이 무더기로 딸려 온다.  */
    if (t.length < 2) continue;
    if (out.indexOf(t) < 0) out.push(t);
    if (out.length >= 8) break;   // 한 줄에 여덟 낱말이면 충분하다
  }
  return out;
}

/** 한 줄(주문)에서 찾아볼 글자 뭉치 — 품목·수취인·송장·고유ID·적요 */
function prpOrdHaystack_(m) {
  return [m.item, m.name, m.invoice, m.uid, m.phone]
    .join(" ").toLowerCase().replace(/\s+/g, " ");
}

function prpOrdMatches_(m, terms) {
  var hay = prpOrdHaystack_(m);
  var digits = hay.replace(/[^0-9]/g, "");
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i];
    if (hay.indexOf(t) >= 0) continue;
    //  숫자만으로 붙인 낱말(송장·고유ID 조각)은 하이픈을 지우고 한 번 더 본다
    var td = t.replace(/[^0-9]/g, "");
    if (td.length >= 4 && digits.indexOf(td) >= 0) continue;
    return false;
  }
  return true;
}

/** 탭 하나를 통째로 읽어 담는다 (검색어 없이 훑을 때) */
function prpScanTabAll_(tab, source, out, limit) {
  prpScanTab_(tab, source, out, function () {
    return out.length < (limit || PRP_ORD_LIVE_LIMIT_);
  });
}

/**
 * 발주 및 송장조회.
 *
 * @param {string} sid 세션
 * @param {{q:string, scope:string}} payload
 *   q     — 검색어. 줄바꿈이 있으면 줄마다 따로 찾는다.
 *   scope — "live"(기본, 발주 및 송장조회 탭만) · "all"(마감탭까지)
 *
 * @return {{ok:boolean, groups:Array, rows:Array, scope:string}}
 *   groups — [{ q, terms, rows }]  붙여넣은 줄 하나가 한 덩어리
 *   rows   — 검색어가 없을 때의 목록
 */
function prpListOrders(sid, payload) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  payload = payload || {};

  var scope = String(payload.scope || "live") === "all" ? "all" : "live";
  var qRaw = String(payload.q || "");

  /*  붙여넣은 글을 줄로 가른다. 빈 줄·머리글로 보이는 줄은 버린다 —
      엑셀에서 긁으면 첫 줄에 「품목명」이 딸려 오는 일이 잦다.  */
  var lines = [];
  var parts = qRaw.split(/[\r\n]+/);
  for (var p = 0; p < parts.length; p++) {
    var ln = parts[p].replace(/\s+/g, " ").trim();
    if (!ln) continue;
    if (/^(품목명|상품명|수취인|송장번호|고유ID|고유아이디|수량)$/.test(ln)) continue;
    lines.push(ln);
    if (lines.length >= 30) break;   // 서른 줄이면 한 번에 볼 만큼은 된다
  }

  try {
    //  검색어가 있으면 마감탭까지 본다 — 찾으려는 사람은 기다릴 수 있다
    var 마감까지 = scope === "all" || lines.length > 0;

    var res = 마감까지
      ? prpScanVendorBook_(g.sess, function (tab, src, out) {
          prpScanTabAll_(tab, src, out, PRP_ORD_TOTAL_LIMIT_ * 4);
        })
      : prpScanLiveOnly_(g.sess);

    if (!res.ok) return res;
    var all = res.matches;

    if (!lines.length) {
      var rows = all.slice(0, PRP_ORD_TOTAL_LIMIT_);
      return {
        ok: true, scope: scope, groups: [], rows: rows,
        total: all.length, truncated: all.length > rows.length
      };
    }

    var groups = [];
    for (var i = 0; i < lines.length; i++) {
      var terms = prpOrdTerms_(lines[i]);
      var hits = [];
      if (terms.length) {
        for (var j = 0; j < all.length && hits.length < PRP_ORD_HIT_LIMIT_; j++) {
          if (prpOrdMatches_(all[j], terms)) hits.push(all[j]);
        }
      }
      groups.push({ q: lines[i], terms: terms, rows: hits });
    }
    return { ok: true, scope: scope, groups: groups, rows: [], total: all.length };
  } catch (e) {
    return { ok: false, error: e.message || String(e), groups: [], rows: [] };
  }
}

/** 「발주 및 송장조회」 탭만 — 아직 마감 안 된 건. 가볍게 여는 길 */
function prpScanLiveOnly_(sess) {
  var fileId = prpFindVendorFileId_(sess);
  if (!fileId) {
    return {
      ok: false,
      error: "이 업체의 배포파일을 찾지 못했습니다. 운영자에게 알려 주세요.",
      matches: []
    };
  }
  var ss = SpreadsheetApp.openById(fileId);
  var live = ss.getSheetByName(PRP_ORDER_TAB_NAME_);
  if (!live) {
    return { ok: true, matches: [] };
  }
  var out = [];
  prpScanTabAll_(live, PRP_ORDER_TAB_NAME_, out, PRP_ORD_LIVE_LIMIT_);
  /*  시트는 위가 오래된 것이다. 화면은 최근 것부터 본다.  */
  out.reverse();
  return { ok: true, matches: out };
}
