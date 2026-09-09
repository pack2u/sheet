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
 * 한 줄에서 주문번호 후보를 몇 개까지 시도할지.
 *
 * ★ 2026-09-09 실측: 우리 화물에 ordNo 는 안 걸린다 ★
 *   「송미경원장님 / 대경노인요양공동생활가정 / 2160626355」 셋 다
 *   "주문번호에 대한 운송장 번호가 없습니다" 였다.
 *   ALPS 화면이 「주문번호」로 보여 주는 값조차 API 로는 안 통한다 —
 *   주문접수 API 로 등록한 적이 없어 롯데 쪽에 그 키가 없는 것으로 보인다.
 *
 *   그래서 **1개만** 시도한다. 확실한 실패에 호출 세 번과 3초를 쓸 이유가 없다.
 *   지우지 않고 하나 남기는 이유는, 주문접수 API 를 쓰기 시작하면 그때부터
 *   통하기 때문이다. 그날 이 숫자만 올리면 된다.
 */
var _LOTTE_ORD_TRIES_ = 1;

/**
 * 롯데의 「주문번호」로 쓸 후보를 뽑는다.
 *
 * ★ 2026-09-09 ALPS 화면에서 확인한 사실 ★
 *   롯데 「화물추적(거래처용)(신)」의 주문번호 칸에 **「송미경원장님」** 이 들어 있었다.
 *   숫자가 아니라 **사방넷 주문자명**이다. 사장님이 ALPS 에서 이름으로 찾을 수
 *   있었던 이유가 이것이다 — 롯데가 이름을 검색해 주는 게 아니라, 우리가 넘긴
 *   주문번호가 애초에 이름이었다.
 *
 *   우리 주문 칸은 「기관명 /주문자명/주문번호」 꼴로 붙어 온다.
 *     대경노인요양공동생활가정 /송미경원장님/2160626355
 *   여태 맨 뒤(2160626355)만 주문번호로 썼다. 롯데가 아는 건 **가운데**다.
 *   그래서 가운데 토막부터 물어보고, 안 되면 이름·맨뒤 순으로 내려간다.
 *
 * @param {Object} rec 검색 색인의 한 줄
 * @return {Array<string>} 물어볼 순서대로
 */
function _lotte_ordCandidates_(rec) {
  var out = [];
  var seen = {};
  function add(v) {
    v = String(v == null ? "" : v).trim();
    if (!v || seen[v]) return;
    seen[v] = true;
    out.push(v);
  }

  var segs = String((rec && rec.orderNo) || "")
    .split(/[\/|／]/)
    .map(function (s) { return String(s).trim(); })
    .filter(Boolean);

  // 가운데 토막들 — 「기관명 /주문자명/주문번호」의 주문자명
  for (var i = 1; i < segs.length - 1; i++) add(segs[i]);
  // 두 토막뿐이면 앞이 이름이다 (「주문자명/주문번호」)
  if (segs.length === 2) add(segs[0]);
  add(rec && rec.name);
  // 맨 뒤(사방넷 주문번호). 롯데가 이걸 아는 건도 있을 수 있어 마지막으로 남긴다.
  if (segs.length) add(segs[segs.length - 1]);

  return out.slice(0, _LOTTE_ORD_TRIES_);
}

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

  /* ★ 검색 규칙은 화면의 검색칸과 **같은 것**을 쓴다 ★
     2026-09-09: 여기만 _cs_nameMatch_(이름 칸만 본다)를 쓰고 있었다. 그래서
     카드의 「롯데송장조회」 단추로는 되는데 — 그건 카드의 이름을 통째로 넣으니까 —
     손으로 「송미경」이라 치면 안 됐다. 그 글자는 이름 칸에 없기 때문이다.

       이름 칸 : 대경노인요양공동생활가정
       주문 칸 : 대경노인요양공동생활가정 /송미경원장님/2160626355
                                          └ 「송미경」은 여기 있다

     위쪽 검색칸(_cs_filterRows_)은 주문 칸·품목·주소까지 본다. 규칙이 둘이면
     「화면에선 나오는데 여기선 안 나온다」가 계속 생긴다. 하나로 합친다.
     점수순으로 정렬돼 오므로 제일 그럴듯한 것부터 물어보게 된다. */
  var hits = _cs_filterRows_(pack.rows || [], q);
  var picks = [];
  var seen = {};
  var matched = hits.length;

  for (var i = 0; i < hits.length && picks.length < _LOTTE_LOOKUP_MAX_; i++) {
    var r = hits[i];

    // _cs_filterRows_ 는 invDigits 를 안 돌려준다 — 송장 원문에서 직접 뽑는다
    var parts = String(r.invoice || "").split(/[\s,;\/|]+/);
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
       일일마감에 송장이 안 붙은 건. 주문번호로 롯데에 묻는다.
       그 「주문번호」가 사실은 이름이다 — _lotte_ordCandidates_ 참조. */
    var ords = _lotte_ordCandidates_(r);
    if (!ords.length || seen["o" + ords[0]]) continue;
    seen["o" + ords[0]] = true;
    picks.push({ by: "주문번호", inv: "", ords: ords, rec: r });
  }

  if (!picks.length) {
    /* ★ 색인에 없어도 롯데에는 있을 수 있다 ★
       롯데의 주문번호 칸이 곧 주문자명이므로, 친 글자를 그대로 주문번호로 물어본다.
       ALPS 화면에서 사장님이 하던 일이 사실 이것이다.
       다만 롯데는 **정확히 일치**해야 찾아 준다 — 「송미경」이 아니라
       「송미경원장님」처럼 끝까지 적어야 나온다. 그래서 안내를 같이 붙인다. */
    var direct = csLotteTrack("", { ordNo: q }) || { ok: false, error: "응답 없음" };
    if (direct.ok) {
      direct.askedBy = "주문번호";
      direct.asked = q;
      direct.rec = { name: q, item: "", date: "", qty: "", vendor: "", source: "롯데 직접", carrier: "롯데택배" };
      return { ok: true, kind: "이름", rows: [direct], error: "", matched: matched, asked: 1, skipped: 0, days: days };
    }
    return {
      ok: false, kind: "이름", rows: [], matched: matched,
      error: (matched
        ? "「" + q + "」 카드는 " + matched + "건 있는데 송장번호도 주문번호도 없습니다."
        : "최근 " + days + "일 주문에서 「" + q + "」 을(를) 못 찾았습니다.") +
        " 롯데에도 그 이름으로는 없습니다 — 롯데는 주문자명이 정확히 같아야 찾습니다(예: 송미경 → 송미경원장님)."
    };
  }

  var out = [];
  for (var p = 0; p < picks.length; p++) {
    var pk = picks[p];
    var t, tried;
    if (pk.by === "송장번호") {
      t = csLotteTrack(pk.inv, {}) || { ok: false, error: "응답 없음" };
      tried = pk.inv;
    } else {
      /* 후보를 순서대로 물어보고 **처음 맞는 것에서 멈춘다.**
         헛방도 쿼터를 먹으므로 세 개까지만 시도한다(_LOTTE_ORD_TRIES_). */
      var fails = [];
      for (var c = 0; c < pk.ords.length; c++) {
        tried = pk.ords[c];
        t = csLotteTrack("", { ordNo: tried }) || { ok: false, error: "응답 없음" };
        if (t.ok) break;
        fails.push(tried);
      }
      // 다 헛방이면 무엇 무엇을 물어봤는지 밝힌다 — 안 그러면 왜 없는지 알 수 없다
      if (t && !t.ok && fails.length > 1) {
        t.error = String(t.error || "") + " (물어본 주문번호: " + fails.join(", ") + ")";
      }
    }
    t.askedBy = pk.by;
    t.asked = tried;
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
