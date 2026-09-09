/**
 * ══════════════════════════════════════════════════════════════
 *  롯데택배 직접조회 — 우리 일일마감에 송장이 없을 때
 *
 *  ★ 왜 필요한가 (2026-09-09 사장님 요청) ★
 *    주문·송장 검색에서 이름을 치면 카드는 나오는데 「송장 -」 인 건이 있다.
 *    물건은 나갔는데 일일마감이 송장을 못 붙인 것(미매칭)이다.
 *    그러면 CS 는 거기서 막힌다 — 송장이 없으니 「상태」 단추도 못 누른다.
 *    이 파일은 그때 **롯데에 직접 물어보는** 길을 낸다.
 *
 *  ★ 롯데 API 에는 이름으로 찾는 창구가 없다 ★
 *    화물추적(/api/pid/cus/806/custmer-view-tracking)이 받는 것은
 *    invNo(운송장번호) 아니면 ordNo(주문번호), 둘 중 하나뿐이다.
 *    (규격: 롯데택배_OpenAPI_규격.md 5장)
 *
 *    그래서 이름은 **우리 색인에서 번호로 바꾼 뒤** 롯데에 묻는다.
 *      이름 → (우리 통합조회/일일마감) → 송장번호 있으면 그것으로
 *                                    → 없으면 주문번호로
 *      → 롯데 화물추적 API
 *    송장이 없는 건에서 주문번호로 묻는 이 두 번째 갈래가 핵심이다.
 *    롯데가 그 주문번호를 알고 있으면 **송장번호를 돌려준다.**
 *    모르면 「주문번호에 대한 운송장 번호가 없습니다」라고 분명히 답한다 —
 *    한 번 눌러 보면 결판이 나므로, 눈으로 찾아 헤매는 것보다 낫다.
 *
 *  ★ 택배사를 가리지 않는다 ★
 *    카드의 「상태」 단추는 롯데 건만 부른다(쿼터를 아끼려고).
 *    여기는 사람이 **작정하고 롯데에 묻는** 자리라 그 빗장을 걸지 않는다.
 *    미매칭 건은 출처가 「미매칭」이라 택배사 추론이 아예 안 되는데,
 *    빗장을 걸면 정작 필요한 건이 전부 막힌다.
 *
 *  ★ 쿼터 ★
 *    하루 10,000건(소프트 상한 9,000). 이름 한 번에 최대 8건까지만 묻는다.
 *    동명이인이 많은 이름으로 색인 전체를 훑어 부르면 금방 는다.
 *    csLotteTrack 이 30분 캐시를 물고 있어 같은 번호는 다시 안 나간다.
 * ══════════════════════════════════════════════════════════════
 */

/** 이름 한 번에 물어볼 최대 건수 — 쿼터 보호 */
var _LOTTE_LOOKUP_MAX_ = 8;

/**
 * 웹앱 진입점. 이름이든 번호든 한 칸으로 받는다.
 *
 * CS 에게 「이건 송장번호 칸, 저건 주문번호 칸」을 구분시킬 이유가 없다.
 * 숫자만 들어오면 번호로, 그 밖에는 이름으로 본다.
 *
 * @param {string} query  이름 · 송장번호 · 주문번호
 * @param {Object=} opts  { days: 7|14 }
 * @return {{ok:boolean, kind:string, rows:Array, error:string}}
 */
function csLotteLookup(query, opts) {
  opts = opts || {};
  var q = String(query || "").trim();
  if (!q) return { ok: false, kind: "", rows: [], error: "이름이나 번호를 넣어 주세요." };

  // 하이픈·공백은 번호에 흔히 섞인다. 숫자만 남는 입력이면 번호로 본다.
  if (/^[0-9][0-9\s-]*$/.test(q)) return _lotteLookupNumber_(q);
  return _lotteLookupName_(q, opts);
}

/**
 * 번호 한 건.
 *
 * 12자리는 롯데 운송장 규격이다(규격 6장 채번규칙). 그것부터 송장으로 묻고,
 * 아니면 주문번호로 먼저 묻는다. 한쪽이 헛나가면 다른 쪽으로 한 번 더 묻는다.
 * 두 번이면 쿼터에 부담이 없고, CS 는 번호 종류를 몰라도 된다.
 */
function _lotteLookupNumber_(raw) {
  var d = String(raw).replace(/[^0-9]/g, "");
  if (d.length < 6) {
    return { ok: false, kind: "번호", rows: [], error: "번호가 너무 짧습니다." };
  }

  var order = d.length === 12 ? ["inv", "ord"] : ["ord", "inv"];
  var lastErr = "";
  for (var i = 0; i < order.length; i++) {
    var r = order[i] === "inv"
      ? csLotteTrack(d, {})
      : csLotteTrack("", { ordNo: d });
    if (r && r.ok) {
      r.askedBy = order[i] === "inv" ? "송장번호" : "주문번호";
      r.asked = d;
      return { ok: true, kind: "번호", rows: [r], error: "" };
    }
    lastErr = (r && r.error) || lastErr;
  }
  return {
    ok: false, kind: "번호", rows: [],
    error: lastErr || "롯데에서 찾지 못했습니다."
  };
}

/**
 * 이름 → 우리 색인에서 번호를 모아 → 롯데에 묻는다.
 *
 * 한 사람 앞에 송장이 여럿일 수 있다(합포장·분할발송). 송장이 하나라도
 * 있으면 그 송장들로 묻고, **하나도 없을 때만** 주문번호로 묻는다.
 * 순서가 중요하다 — 송장이 있는데 주문번호로 물으면 롯데가 다른 송장을
 * 골라 줄 수 있고, 그러면 CS 가 우리 기록과 대조할 수 없다.
 */
function _lotteLookupName_(q, opts) {
  var days = _cs_clampDays_(opts && opts.days);
  var pack;
  try {
    pack = _cs_loadSearchIndex_(days, false);
  } catch (e) {
    return {
      ok: false, kind: "이름", rows: [],
      error: "주문 색인을 못 읽었습니다 — " + e.message
    };
  }

  var rows = pack.rows || [];
  var picks = [];
  var seen = {};
  var matched = 0;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!_cs_nameMatch_(r.name, q)) continue;
    matched++;
    if (picks.length >= _LOTTE_LOOKUP_MAX_) continue;

    // 송장이 있으면 그것부터. invDigits 는 여러 장이면 공백으로 붙어 온다.
    var parts = String(r.invDigits || "").split(/\s+/);
    var used = false;
    for (var k = 0; k < parts.length; k++) {
      var d = String(parts[k] || "").replace(/[^0-9]/g, "");
      if (d.length < 8 || seen["i" + d]) continue;
      seen["i" + d] = true;
      picks.push({ by: "송장번호", inv: d, ord: "", rec: r });
      used = true;
      if (picks.length >= _LOTTE_LOOKUP_MAX_) break;
    }
    if (used) continue;

    /* ★ 이 갈래가 이 기능의 이유다 ★
       일일마감에 송장이 안 붙은 건. 주문번호로 롯데에 묻는다. */
    var uid = _cs_rowUid_(r);
    uid = String(uid || "").trim();
    if (!uid || seen["o" + uid]) continue;
    seen["o" + uid] = true;
    picks.push({ by: "주문번호", inv: "", ord: uid, rec: r });
  }

  if (!picks.length) {
    return {
      ok: false, kind: "이름", rows: [], matched: matched,
      error: matched
        ? "「" + q + "」 카드는 " + matched + "건 있는데 송장번호도 주문번호도 없습니다."
        : "최근 " + days + "일 주문에서 「" + q + "」 을(를) 못 찾았습니다."
    };
  }

  var out = [];
  for (var p = 0; p < picks.length; p++) {
    var pk = picks[p];
    var t = pk.by === "송장번호"
      ? csLotteTrack(pk.inv, {})
      : csLotteTrack("", { ordNo: pk.ord });
    t = t || { ok: false, error: "응답 없음" };
    t.askedBy = pk.by;
    t.asked = pk.inv || pk.ord;
    // 어느 카드에서 나온 번호인지 — 결과만 보면 누구 것인지 알 수 없다
    t.rec = {
      date: pk.rec.date || "",
      name: pk.rec.name || "",
      item: pk.rec.item || "",
      qty: pk.rec.qty || "",
      vendor: pk.rec.vendor || "",
      source: pk.rec.source || "",
      carrier: pk.rec.carrier || ""
    };
    out.push(t);
  }

  return {
    ok: true, kind: "이름", rows: out, error: "",
    matched: matched,
    asked: picks.length,
    // 색인에는 더 있는데 쿼터 때문에 안 물어본 건 — 화면에 밝혀야 오해가 없다
    skipped: matched > picks.length ? matched - picks.length : 0,
    days: days
  };
}
