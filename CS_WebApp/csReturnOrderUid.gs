/**
 * ══════════════════════════════════════════════════════════════
 *  반품대장 고유ID = «원래 주문의» 고유ID
 *  파일: csReturnOrderUid.gs   (2026-10-04)
 *
 *  > "주문건의 고유아이디를 넣어 달라고한건데. 반품관련 고유아이디를 따로
 *  >  만드는거로 착각한듯... 고유아이디로 주문, 송장, 반품유무등을 한번에
 *  >  찾을수 있게 하려는거야"
 *  > "웹앱에서 주문송장조회를 통해 주문건을 확인하고 바로 반품대장기록을
 *  >  통해 흘러가는 시스템으로"
 *
 *  ★ 바로잡는 것 ★
 *    2026-10-02 에 이 칸을 「반품 제 번호」(r1002000003)로 읽고 새 번호를
 *    매기기 시작했다(csReturnUid.gs). 뜻은 그게 아니었다. 고유ID 는 «주문»의
 *    번호다 — 하나로 주문·송장·반품을 다 찾으려면 같은 번호가 세 곳에 있어야
 *    한다. 반품에 따로 번호를 지으면 오히려 끊긴다.
 *
 *  ★ 흐름 ★
 *    주문송장조회 → 주문 찾음 → 「반품대장 기록」 → 그 주문의 고유ID 가
 *    대장에 그대로 따라 들어간다. 기록 단추는 이미 orderNo 를 보내고 있었다 —
 *    서버가 그걸 버리고 r 번호를 짓던 것을 고쳤다 (submitReturnLedger).
 *
 *  ★ 지난 반품은 «찾아서» 넣는다 ★  (이 파일의 두 함수)
 *    원송장번호로 주문 원장(주문라인원장 → 일일마감)을 찾는다 — CS 주문검색이
 *    쓰는 바로 그 색인(_cs_loadSearchIndex_)이다. 새 색인을 만들지 않는다.
 *
 *    ★ 정확하게 ★  틀린 고유ID 는 빈칸보다 나쁘다 — 다른 주문을 가리키며
 *    맞는 척한다. 그래서
 *      · 송장으로 찾은 주문의 고유ID 가 «하나»면 넣는다
 *      · 둘 이상(합포장 — 한 상자에 주문 여럿)이면 수취인·상품명으로 좁히고,
 *        그래도 둘 이상이면 넣지 않고 알린다
 *      · 송장이 없으면 넣지 않는다 — 이름·전화로 이어 붙이는 것은 2026-09-16 에
 *        통합조회를 버린 바로 그 까닭이다
 *      · 사람이 적은 값은 건드리지 않는다. 시험으로 들어간 r 번호만 덮는다
 *
 *  돌리는 법 — 편집기에서 ▶ 실행 → Ctrl+Enter 로 로그
 *    ① csReturnOrderUid_미리보기   무엇을 넣을지 «본다». 안 바꾼다.
 *    ② csReturnOrderUidFill        확실한 것만 넣는다. 두 번 돌려도 탈 없다.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * 채울 달 — 2026-10 부터 지금 달까지.
 *
 * > "10월부터 적용해주면되 이전꺼는 쉽지 않아"
 *
 * 9·8월도 미리보기로 돌려 봤는데 대부분 못 찾았다 — 주문 원장이 최근 회차만
 * 들고 있어 그 달 송장이 거의 없고(9월 275줄 중 찾음 46), 송장이 빈 줄도 많다.
 * 그 이전은 손으로 맞추는 쪽이 낫다는 사장님 판단이다.
 * 10월부터는 주문송장조회 → 반품대장 기록이 번호를 같이 싣는다. 이 함수는 그
 * 흐름을 안 거치고 들어온 줄(반품탭에서 직접 적은 것)을 메우는 데 쓴다.
 */
var _CS_ROU_FROM_ = "202610";

/** 대장에 있는 달 탭 중 _CS_ROU_FROM_ 부터 — 새것이 앞 */
function _cs_rou_탭들_(ss) {
  var out = [];
  var 탭 = ss.getSheets();
  for (var i = 0; i < 탭.length; i++) {
    var 이름 = 탭[i].getName();
    if (/^[0-9]{6}$/.test(이름) && 이름 >= _CS_ROU_FROM_) out.push(이름);
  }
  return out.sort().reverse();
}

/**
 * 주문 원장을 얼마나 거슬러 볼까 (오늘부터, 일).
 * 반품은 주문 뒤 몇 주 지나 온다. 가장 오래된 탭의 1일보다 두 달 앞까지 본다.
 * 원장(파일 1개)을 쓰면 싸고, 일일마감으로 떨어지면 날마다 파일을 연다.
 */
function _cs_rou_보는날수_(탭들) {
  var 가장옛 = 탭들.slice().sort()[0];
  var y = Number(가장옛.slice(0, 4)), m = Number(가장옛.slice(4, 6));
  var 시작 = new Date(y, m - 1 - 2, 1);           //  그 달보다 두 달 앞 1일
  var 일 = Math.ceil((Date.now() - 시작.getTime()) / 86400000) + 1;
  return Math.max(30, Math.min(일, 200));
}

/**
 * 주문의 고유ID 를 다듬는다.  「김미화/2157237902#2」 → 「2157237902」
 *
 * ★ 허브 _pep_uidFromOrdererCell_ 과 같은 규칙이다 ★  (프로젝트가 달라 못 부른다)
 *   마지막 「/」(또는 「／」) 뒤가 고유ID. 「#n」·「|코드」·「_S숫자」 꼬리는 뗀다.
 *   CS 의 _cs_orderNoFromName_ 는 「|」로도 잘라 「…|ABC」 에서 «코드»를 준다 —
 *   고유ID 로는 쓸 수 없다. 그래서 따로 둔다. 시험이 두 벌을 맞대 본다.
 */
function _cs_orderUid_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  var 끝 = Math.max(s.lastIndexOf("/"), s.lastIndexOf("／"));
  if (끝 >= 0) s = s.slice(끝 + 1);
  //  칸 안 공백까지 지운다 — 포털 prpUidFromCell_ 와 같게. 번호에 공백은 없다.
  s = s.split(" ").join("").split(String.fromCharCode(9)).join("");
  s = s.replace(/#\d+$/, "");
  var 막대 = s.indexOf("|");
  if (막대 > 0) s = s.slice(0, 막대);
  s = s.replace(/_S\d+$/, "");
  return s.trim();
}

/**
 * 시험으로 들어간 반품 번호인가 — 「r1002000003」.
 * 이것만 덮는다. 다른 값은 사람이 적은 것일 수 있으니 안 건드린다.
 */
function _cs_rou_시험번호인가_(v) {
  return /^r\d{10}$/.test(String(v || "").trim());
}

/** ① 미리보기 — 아무것도 안 쓴다 */
function csReturnOrderUid_미리보기() { return _cs_rou_run_(true); }

/** ② 넣기 — 확실한 것만 */
function csReturnOrderUidFill() { return _cs_rou_run_(false); }

function _cs_rou_run_(보기만) {
  var 시작 = Date.now();
  var 말 = ["■ 반품대장 고유ID ← 원래 주문의 고유ID — " + (보기만 ? "미리보기 (안 바꿈)" : "넣기"), ""];

  /*  주문 색인 — CS 주문검색이 쓰는 그것. 송장 → 고유ID 를 들고 있다. */
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var 탭들 = _cs_rou_탭들_(ss);
  if (!탭들.length) {
    Logger.log("채울 달 탭이 없습니다 (" + _CS_ROU_FROM_ + " 부터)");
    return "채울 달 탭 없음";
  }
  var 날수 = _cs_rou_보는날수_(탭들);
  말.push("  채울 달 " + 탭들.join(", "));
  var pack = _cs_loadSearchIndex_(날수, false);
  var 주문들 = (pack && pack.rows) || [];
  말.push("  주문 색인 " + 주문들.length + "줄 · 최근 " + 날수 + "일 · 근거 " +
    (pack && pack.indexSource === "ledger" ? "주문라인원장" : "일일마감 파일"));
  if (pack && pack.missingDays && pack.missingDays.length) {
    말.push("  (일일마감이 없는 날 " + pack.missingDays.length + "일 — 그날 주문은 못 찾습니다)");
  }
  var 색인 = _cs_rou_송장색인_(주문들);

  var 합 = { 찾음: 0, 겹침: 0, 못찾음: 0, 송장없음: 0, 이미: 0, 넣음: 0 };
  var 자세히 = [];

  for (var t = 0; t < 탭들.length; t++) {
    var 이름 = 탭들[t];
    var 탭 = ss.getSheetByName(이름);
    if (!탭) { 말.push("  · " + 이름 + " — 탭이 없습니다"); continue; }
    var 읽음 = _cs_rou_읽기_(탭);
    if (읽음.왜) { 말.push("  · " + 이름 + " — " + 읽음.왜 + " (건너뜀)"); continue; }

    var 결과 = _cs_rou_맞추기_(읽음.줄들, 색인);
    합.찾음 += 결과.채울것.length;
    합.겹침 += 결과.겹침.length;
    합.못찾음 += 결과.못찾음.length;
    합.송장없음 += 결과.송장없음.length;
    합.이미 += 결과.이미;

    var 넣은수 = 0;
    if (!보기만 && 결과.채울것.length) 넣은수 = _cs_rou_쓰기_(탭, 읽음, 결과.채울것);
    합.넣음 += 넣은수;

    말.push("  · " + 이름 + "  " + 읽음.줄들.length + "줄 — 찾음 " + 결과.채울것.length +
      " · 후보여럿 " + 결과.겹침.length + " · 못찾음 " + 결과.못찾음.length +
      " · 송장없음 " + 결과.송장없음.length + " · 이미 있음 " + 결과.이미 +
      (보기만 ? "" : "  → " + 넣은수 + "줄 넣음"));

    결과.채울것.slice(0, 8).forEach(function (x) {
      자세히.push("  " + 이름 + " " + x.행 + "행  " + x.요약 + "  →  " + x.uid +
        (x.덮음 ? "   (시험번호 " + x.덮음 + " 덮음)" : "") + "   [" + x.근거 + "]");
    });
    결과.겹침.forEach(function (x) {
      자세히.push("  ⚠ " + 이름 + " " + x.행 + "행  " + x.요약 + "  — 후보 " + x.후보.join(", "));
    });
    결과.송장없음.forEach(function (x) {
      자세히.push("  ✋ " + 이름 + " " + x.행 + "행  " + x.요약 + "  — 원송장이 비어 있음 (손으로 적어 주세요)");
    });
    결과.못찾음.forEach(function (x) {
      자세히.push("  ❌ " + 이름 + " " + x.행 + "행  " + x.요약 + "  — 원장에 이 송장이 없음");
    });
  }

  말.push("");
  말.push("  합계  찾음 " + 합.찾음 + " · 후보여럿 " + 합.겹침 + " · 못찾음 " + 합.못찾음 +
    " · 송장없음 " + 합.송장없음 + " · 이미 있음 " + 합.이미 +
    (보기만 ? "" : " · 넣음 " + 합.넣음));
  if (자세히.length) { 말.push(""); 말 = 말.concat(자세히.slice(0, 120)); }
  if (자세히.length > 120) 말.push("  … 외 " + (자세히.length - 120) + "줄");
  말.push("");
  말.push("  " + Math.round((Date.now() - 시작) / 1000) + "초");
  var 글 = 말.join("\n");
  Logger.log(글);
  return 글;
}

/** 송장 숫자 → 그 송장을 가진 주문들. 칸에 송장이 여럿이면 각각 따로 건다 */
function _cs_rou_송장색인_(주문들) {
  var 색인 = {};
  for (var i = 0; i < 주문들.length; i++) {
    var o = 주문들[i];
    var uid = _cs_orderUid_(o.orderNo);
    if (!uid) continue;
    var 송장들 = String(o.invDigits || "").split(/\s+/);
    for (var k = 0; k < 송장들.length; k++) {
      var d = String(송장들[k] || "").replace(/[^0-9]/g, "");
      if (d.length < 8) continue;
      (색인[d] = 색인[d] || []).push({
        uid: uid,
        이름: String(o.name || "").replace(/\s/g, ""),
        상품: _cs_rou_상품_(o.item),
      });
    }
  }
  return 색인;
}

/** 달 탭 하나 읽기 — 머리글 «이름»으로 */
function _cs_rou_읽기_(탭) {
  var 끝행 = 탭.getLastRow();
  if (끝행 < 2) return { 왜: "비어 있습니다" };
  var 값 = 탭.getRange(1, 1, 끝행, Math.max(탭.getLastColumn(), 15)).getDisplayValues();
  var hi = _cs_findReturnHeaderRow_(값);
  if (hi < 0) return { 왜: "머리글을 못 찾았습니다" };
  var col = _cs_mapReturnLedgerCols_(값[hi]);
  if (col.uid < 0) return { 왜: "고유ID 칸이 없습니다" };

  var 줄들 = [];
  for (var r = hi + 1; r < 값.length; r++) {
    var row = 값[r];
    var g = function (i) { return i >= 0 ? String(row[i] == null ? "" : row[i]).trim() : ""; };
    var 송장칸 = g(col.invoice);
    var 번호 = (typeof _cs_splitLedgerInvoice_ === "function")
      ? _cs_splitLedgerInvoice_(송장칸).번호 : 송장칸;
    var 수취인 = g(col.name), 상품 = g(col.item);
    if (!번호 && !수취인 && !상품) continue;           //  빈 줄
    줄들.push({
      행: r + 1,
      uid: g(col.uid),
      송장들: (String(번호).match(/\d[\d-]{6,}\d/g) || [])
        .map(function (x) { return x.replace(/[^0-9]/g, ""); })
        .filter(function (x) { return x.length >= 8; }),
      이름: 수취인.replace(/\s/g, ""),
      상품: _cs_rou_상품_(상품),
      요약: [g(col.date), 수취인, 상품.slice(0, 16)].filter(Boolean).join(" · "),
    });
  }
  return { 줄들: 줄들, col: col, 머리행: hi, 왜: "" };
}

/**
 * 상품명 견주기 — 띄어쓰기와 «판매 채널 꼬리»만 뗀다.
 * 「…1000개---법인/스마트스토어」 의 꼬리는 어디서 팔렸나이지 무엇이 반품됐나가
 * 아니다. 「---뚜껑만」·「---소분」은 다른 상품이라 남긴다.
 */
function _cs_rou_상품_(v) {
  var s = String(v || "");
  var 꼬리 = s.lastIndexOf("---");
  if (꼬리 >= 0 && /^(법인|개인)\//.test(s.slice(꼬리 + 3).replace(/\s/g, ""))) {
    s = s.slice(0, 꼬리);
  }
  return s.replace(/\s/g, "");
}

/**
 * 맞추기 — 순수 함수. 시험이 직접 부른다.
 * @return {{채울것, 겹침, 못찾음, 송장없음, 이미}}
 */
function _cs_rou_맞추기_(줄들, 색인) {
  var 채울것 = [], 겹침 = [], 못찾음 = [], 송장없음 = [], 이미 = 0;

  for (var i = 0; i < 줄들.length; i++) {
    var r = 줄들[i];
    //  사람이 적은 값은 안 건드린다. 시험 r 번호만 덮는다.
    if (r.uid && !_cs_rou_시험번호인가_(r.uid)) { 이미++; continue; }
    if (!r.송장들.length) { 송장없음.push(r); continue; }

    //  그 줄의 송장들로 찾은 주문들
    var 후보 = [];
    for (var k = 0; k < r.송장들.length; k++) {
      var hit = 색인[r.송장들[k]] || [];
      for (var h = 0; h < hit.length; h++) 후보.push(hit[h]);
    }
    if (!후보.length) { 못찾음.push(r); continue; }

    var 고른 = _cs_rou_좁히기_(r, 후보);
    if (고른.uid) {
      채울것.push({ 행: r.행, uid: 고른.uid, 근거: 고른.근거, 요약: r.요약,
                   덮음: _cs_rou_시험번호인가_(r.uid) ? r.uid : "" });
    } else {
      겹침.push({ 행: r.행, 요약: r.요약, 후보: 고른.후보 });
    }
  }
  return { 채울것: 채울것, 겹침: 겹침, 못찾음: 못찾음, 송장없음: 송장없음, 이미: 이미 };
}

/**
 * 송장으로 찾은 주문들 중 «하나»를 고른다.
 *
 * 송장 하나에 주문이 하나면 끝이다 — 송장은 상자 하나를 가리킨다.
 * 합포장이면 한 상자에 주문이 여럿이다. 그때는 반품된 «상품»과 «수취인»으로
 * 좁힌다. 그래도 둘 이상이면 고르지 않는다 — 기계가 모른다.
 */
function _cs_rou_좁히기_(r, 후보) {
  var 고유 = function (list) {
    var m = {}, out = [];
    list.forEach(function (c) { if (!m[c.uid]) { m[c.uid] = 1; out.push(c.uid); } });
    return out;
  };
  var 다 = 고유(후보);
  if (다.length === 1) return { uid: 다[0], 근거: "송장" };

  var 상품맞음 = 후보.filter(function (c) { return r.상품 && c.상품 && c.상품 === r.상품; });
  var u1 = 고유(상품맞음);
  if (u1.length === 1) return { uid: u1[0], 근거: "송장+상품" };

  var 둘다 = (상품맞음.length ? 상품맞음 : 후보)
    .filter(function (c) { return r.이름 && c.이름 && c.이름 === r.이름; });
  var u2 = 고유(둘다);
  if (u2.length === 1) return { uid: u2[0], 근거: 상품맞음.length ? "송장+상품+수취인" : "송장+수취인" };

  return { uid: "", 후보: 다.slice(0, 5) };
}

/** 고유ID 칸 하나만 읽어 고칠 자리만 바꾸고 한 번에 쓴다. 다른 칸은 손대지 않는다 */
function _cs_rou_쓰기_(탭, 읽음, 채울것) {
  var 칸 = 읽음.col.uid + 1;
  var 첫행 = 읽음.머리행 + 2;
  var 끝행 = 탭.getLastRow();
  if (끝행 < 첫행) return 0;
  var 범위 = 탭.getRange(첫행, 칸, 끝행 - 첫행 + 1, 1);
  var 값 = 범위.getValues();
  var 쓴수 = 0;
  for (var i = 0; i < 채울것.length; i++) {
    var k = 채울것[i].행 - 첫행;
    if (k < 0 || k >= 값.length) continue;
    var 지금 = String(값[k][0] || "").trim();
    //  그 사이 사람이 적었으면 덮지 않는다 (빈칸이거나 시험 번호일 때만)
    if (지금 && !_cs_rou_시험번호인가_(지금)) continue;
    값[k][0] = 채울것[i].uid;
    쓴수++;
  }
  //  앞자리 0 이 사는 번호가 있다 — 숫자로 바뀌지 않게 글자로 잠근다
  try { 범위.setNumberFormat("@"); } catch (e) {}
  범위.setValues(값);
  SpreadsheetApp.flush();
  try { csInvalidateReturnLedgerCache_(); } catch (e2) {}
  return 쓴수;
}
