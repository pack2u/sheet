/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 반품관리대장 읽기·쓰기
 *
 *  CS 웹앱 csOrderSearch.gs 의 열 매핑 규칙을 그대로 복제했다.
 *  두 프로젝트가 분리되어 있어 코드를 공유할 수 없다.
 *  ★ 반품대장 헤더나 열 규칙이 바뀌면 이 파일도 같이 고쳐야 한다.
 *
 *  표준 레이아웃
 *    A 처리상태(헤더 무관, 강제)  B 반품접수날짜  C 접수자  D 업체명
 *    E 반품신청자                 F 연락처       G 수거입력처
 *    H 상품명                     I 수량         J 원송장번호
 *    K 교환/반품 구분             M 반품비       N 고객요청·비고(이력)
 * ══════════════════════════════════════════════════════════════
 */

// ── 헤더·열 매핑 (CS 웹앱과 동일 규칙) ─────────────────────────

function prpFindHeaderRow_(values) {
  var n = Math.min(values.length, 40);
  for (var i = 0; i < n; i++) {
    var row = values[i] || [];
    var joined = "";
    var hits = 0;
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] || "").replace(/\s/g, "");
      if (!cell) continue;
      joined += cell + "|";
      if (/반품접수날짜|접수날짜|접수일자/.test(cell)) hits++;
      if (cell === "접수자") hits++;
      if (/원송장번호|원송장/.test(cell)) hits++;
      if (/상품명|품목명/.test(cell) && !/코드/.test(cell)) hits++;
    }
    if (hits >= 2) return i;
    if (/반품접수날짜|접수날짜/.test(joined)) return i;
  }
  return -1;
}

function prpMapCols_(header) {
  var col = {
    date: -1, staff: -1, vendor: -1, name: -1, phone: -1, phone2: -1, phone2Name: -1,
    pickup: -1, item: -1, qty: -1, invoice: -1, type: -1, fee: -1, status: -1, notice: -1,
    returnInvoice: -1,
    /* 반품사유 — 대장 L열. type(K열 구분)과 «다른» 칸이다.
       CS_WebApp/csOrderSearch.gs 의 같은 표와 «쌍»이다.
       한쪽만 고치면 또 어긋난다 — 아래 type 주석이 겪은 그 일이다. */
    reason: -1,
    /* 귀책 — 아직 대장에 없는 열이다 (2026-09-30). 그때까지는 비고에
       「귀책: 판매자 (오배송)」으로 남는다. 시트에 「귀책」 열을 만들면
       코드를 안 고쳐도 여기로 잡힌다. CS웹앱 쪽과 «쌍»이다. */
    fault: -1,
    /* 고유ID — «원래 주문»의 고유ID (2026-10-04).
       하나의 번호로 주문·송장·반품을 다 찾으려면 같은 번호가 대장에도 있어야
       한다. CS웹앱 csOrderSearch 와 «쌍»이다. */
    uid: -1
  };
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (col.date < 0 && /반품접수날짜|접수날짜|접수일자/.test(h)) col.date = i;
    else if (col.staff < 0 && h === "접수자") col.staff = i;
    /* ★ 2026-09-09: 「주문지」를 더한다 ★
       9월 탭(202609)에서 D열 머리글이 「업체명」 → 「주문지」로 바뀌었다.
       뜻은 그대로다 — 그 칸에는 예나 지금이나 「법인/쿠팡」·「대리발송-리바이」
       처럼 **주문이 어디서 왔나**가 들어간다. 이름만 그 뜻에 맞게 고친 것이다.

       그런데 이 정규식이 「주문지」를 몰라 col.vendor 가 -1 이 되었고,
       prpApi.gs 가 「업체명 열을 찾지 못해 접수할 수 없습니다」로 막았다.
       **협력업체가 반품 접수를 아예 못 했다** (당장드림, 2026-09-09 신고).

       ★ 시트를 되돌리지 않는다 ★
         「주문지」가 그 칸을 더 잘 부르는 말이다. 팀이 고친 것을 코드 편하자고
         되돌리면 다음 사람이 또 고치고 또 깨진다. 코드가 두 이름을 다 안다. */
    /*  ★ 10월부터 「거래처」로 적는다 ★  (2026-10-04)
        CS 웹앱은 10/01 에 이 낱말을 받았는데 포털만 빠졌다. 그래서 202610
        탭에서 col.vendor 가 -1 이 되고,
          · 목록은 return [] — 업체 화면에 10월 반품이 «하나도» 안 보인다
          · 한 건 열기·사진·문의는 「업체명 열을 찾지 못했습니다」로 막힌다
        9월에 「주문지」로 당한 것과 글자 하나 다르지 않은 일이다.
        조용히 닫히므로 업체는 「아직 접수 안 됐나」로 읽는다.  */
    else if (col.vendor < 0 && /업체명|주문지|판매처|발주업체|^거래처$/.test(h)) col.vendor = i;
    else if (col.name < 0 && /반품신청자|수취인명|수취인|받는분/.test(h) && !/전화|주소/.test(h)) col.name = i;
    /* ★ 2026-09-09: 연락처를 둘로 나눈다 ★
       고유아이디로 불러오면 주문에 적힌 번호가 딸려 오는데, 그게
       안심번호(0504-…)인 경우가 많다. 안심번호는 배송이 끝나면 끊긴다 —
       회수 기사가 걸면 안 받는 번호가 된다.
       그래서 실제 번호를 적을 자리를 하나 더 연다.

       대장에는 「추가연락처」 열이 진작부터 있었다(F열). 포털만 안 쓰고 있었다.
       CS 웹앱도 v2 이관(colMap.js phone2)도 이미 이 열을 안다.

       ★ 「추가」를 먼저 걸러야 한다 ★
         /연락처/ 는 「추가연락처」에도 걸린다. 순서에 기대면 언젠가
         열 순서가 바뀌는 날 추가연락처가 주 연락처 자리로 들어간다. */
    /* ★ 실번호의 «주인 이름» ★  (2026-09-11)
       > "주문자와 상담자가 다른경우가 있어"
       대장에 열을 새로 만들었다(9탭 전부, 맨 뒤).

       ★ 「이름」을 먼저 걸러야 한다 ★
         /실번호/ 는 「실번호 이름」에도 걸린다. 이 줄이 위에 있어야
         이름 열이 번호 열 자리를 뺏지 않는다 — 그러면 회수 기사에게
         전화번호 대신 사람 이름을 건네게 된다.
       CS 웹앱 _cs_mapReturnLedgerCols_ 와 «같은 규칙»이다. */
    else if (col.phone2Name < 0 && /(실번호|추가연락처|연락처)(이름|성함)|상담자|통화자/.test(h)) col.phone2Name = i;
    else if (col.phone2 < 0 && /추가연락처|추가전화|비상연락|실번호/.test(h)) col.phone2 = i;
    else if (col.phone < 0 && /연락처|전화|휴대폰/.test(h) && !/주소|추가/.test(h)) col.phone = i;
    /* ★ 2026-09-10: 「회수신청」을 더한다 ★
       9월 탭(202609)의 M열 머리글이 「수거입력처」 → 「회수신청」 이다.
       그래서 접수창에서 고른 수거 택배사(CJ대한통운 등)가 **아무 데도 안 적혔다.**
       업체는 골랐으니 적힌 줄 알고, CS 는 빈칸을 보고 안 골랐다고 안다.
       (당장드림 260910 내허쉬·방혜희 두 건 실측 — M 이 비어 있었다)
       ★ 반품비를 뺏지 않는다 ★  「회수신청」은 여기서 먼저 잡히므로 아래
         col.fee 로 안 내려간다. 전에 이 열의 「자동회수」가 반품비로 들어간
         적이 있는데(M열 폴백), 그 사고가 다시 날 길을 막는 셈이다. */
    else if (col.pickup < 0 && /수거입력처|회수신청|수거택배|회수택배|수거요청/.test(h)) col.pickup = i;
    else if (col.item < 0 && /상품명|품목명/.test(h) && !/코드/.test(h)) col.item = i;
    else if (col.qty < 0 && (h === "수량" || h.indexOf("수량") === 0)) col.qty = i;
    else if (col.invoice < 0 && /원송장|송장번호/.test(h) && !/회수|재발송|반품송장/.test(h)) col.invoice = i;
    else if (col.returnInvoice < 0 && /반품송장|회수송장/.test(h)) col.returnInvoice = i;
    else if (col.uid < 0 && /^고유ID$|^고유아이디$|^UID$/i.test(h)) col.uid = i;
    /* ★ 2026-09-10: CS 웹앱과 낱말을 맞춘다 ★
       9월 탭의 L열은 「재출고/단순/오주문입력/오배송」 이라 /교환.?반품/ 로는
       안 걸렸다. 접수창에서 고른 「단순반품」이 조용히 버려지고 있었다.
       CS_WebApp/csOrderSearch.gs 는 9/4 에 이미 고쳤는데 여기만 안 고쳐졌다 —
       같은 규칙이 두 파일에 따로 적혀 있어서 그렇다. **쌍으로 고친다.** */
    /* ★ 반품사유(L열)를 «따로» 읽는다 ★  (2026-09-18)
       > "업체 반품 현황에도 같이 적용해줘"

       아래 type 정규식에 「반품사유」가 들어 있지만, K열이 먼저 type 을
       채우고 나면 else-if 라 L열이 통째로 버려진다. 그래서 대장에 적힌
       사유가 CS 화면에도 업체 화면에도 안 나왔다 — 조용히.

       ★ type 보다 «앞»에 둔다 ★ 뒤에 두면 또 같은 일이 난다.
       ★ CS웹앱과 «같은 규칙»이다 — 쌍으로 고친다 ★ */
    /* ★ 귀책을 사유보다 «앞»에 둔다 ★ 뒤에 두면 「반품귀책사유」 같은
       머리글이 사유에 먼저 걸려 귀책이 통째로 버려진다. */
    else if (col.fault < 0 && /^귀책$|귀책구분|^책임$|책임구분|과실구분/.test(h)) col.fault = i;
    /*  「발생원인」을 더한다 (2026-10-01) — 협의된 배열의 사유 칸 이름이다.
        한 칸에 「판매자귀책 / 오배송」으로 적힌다(prpParseCause_ 로 가른다).
        CS웹앱이 9/30 에 넣었고(csOrderSearch col.reason) 여기만 빠져 있었다 —
        그래서 업체 화면에 사유·귀책이 통째로 안 나왔다. 조용히.  */
    else if (col.reason < 0 && /^반품사유$|^사유$|반품이유|교환반품사유|^발생원인$/.test(h)) col.reason = i;
    /*  ★ 「재출고」 한 낱말로는 못 찾는다 ★  (2026-10-04)
        10월 탭에 「재출고상품」·「재출고배송비」가 따로 생겼다. 둘 다 /재출고/ 에
        걸려 앞선 「재출고상품」(V)이 구분 자리를 차지했다 — 업체 화면의 「구분」에
        다시 보낼 물건 이름이 떴다. 슬래시가 붙은 것만 받는다.
        (CS 쪽은 reship·reshipFee 를 type «앞»에 두어 막았다. 포털에는 그 둘을
         읽는 자리가 아직 없으므로 여기서 좁힌다.)  */
    else if (col.type < 0 && /교환.?반품|반품구분|반품유형|처리구분|반품사유|재출고\/|오주문입력/.test(h)) col.type = i;
    /* 2026-09-09: 「환불비용」을 더한다. 9월 탭 머리글이 「반품/환불비용」인데
       가운데 「/」 때문에 「반품비」로 안 걸렸다. CS 웹앱은 9/4 에 이미 넣었고
       (csOrderSearch.gs 2257행) 여기만 안 고쳐져 있었다. */
    else if (col.fee < 0 && /반품비|반품운임|반품배송비|환불비용/.test(h)) col.fee = i;
    else if (col.notice < 0 && /고객요청|유의사항|비고/.test(h)) col.notice = i;
    /*  상태값을 «머리글 이름»으로 찾는다 (2026-10-01) — 아래 폴백 설명 참조 */
    /*  ★ 「처리상태」를 상태로 읽지 않는다 ★  (2026-10-04 — CS 웹앱과 쌍)
        옛 탭(202604~08) N열 「처리상태」에 실제로 든 것은 이카운트 반영이다
        (「이카운트ok」). 상태로 읽으면 업체 화면에 상태가 「이카운트ok」로 뜬다.
        CS 는 그날 고쳤는데 포털이 빠져 있었다 — 같은 대장을 두 화면이 다르게
        읽고 있었다. 옛 탭의 상태는 A열 폴백이 집는다.  */
    else if (col.status < 0 && /^상태값$|^상태$|^진행상태$/.test(h)) col.status = i;
  }
  /*  ★ A열을 상태로 «못 박지» 않는다 ★  (2026-10-01)
        전에는 무조건 col.status = 0 이었다. 10월 탭이 A 를 「반품접수날짜」로
        쓰자 CS웹앱 쪽에서 날짜 위에 상태를 덮어 7줄이 접수날짜를 잃었다.
        포털은 읽기만 하지만, 틀린 칸을 읽으면 업체 화면에 날짜가 상태로 보인다.

        머리글로 찾지 못했을 때만 A 를 쓴다 — 그것도 «A 를 아무도 안 가져갔을
        때»만. 옛 탭(상태 머리글이 비어 있다)은 그대로 돌고, 머리글이 다른 탭은
        조용히 틀리지 않는다.
        ★ CS웹앱 _cs_mapReturnLedgerCols_ 와 같은 규칙이다 — 쌍으로 고친다 ★  */
  if (col.status < 0) {
    var _A임자 = "";
    for (var _ck in col) {
      if (Object.prototype.hasOwnProperty.call(col, _ck) &&
          _ck !== "status" && col[_ck] === 0) { _A임자 = _ck; break; }
    }
    col.status = _A임자 ? -1 : 0;
  }
  /* M열 = 반품비 폴백.
     ★ 2026-09-09: **머리글이 비었거나 옛 문구일 때만** 쓴다 ★
       전에는 무조건 M 을 금액으로 읽었다. 9월에 열이 한 칸 밀려 M 이
       「회수신청」이 되자 「자동회수」 같은 글자가 반품비로 들어왔다.
       업체 화면의 「반품비 합계」가 0원으로 나오던 것이 이것이다 —
       조용히 틀려서 업체는 금액이 안 적힌 줄 알았다.

       옛 탭(202604~07)은 머리글이 「선출고/입고검수후출고」인데 칸에는
       실제로 반품비가 적혀 있다. 그 경우는 계속 읽어야 한다.

     CS 웹앱이 9/4 에 같은 판단을 했다 (csOrderSearch.gs 2270행).
     두 앱이 같은 대장을 읽으니 규칙도 같아야 한다 — 다르면 업체 화면과
     CS 화면이 다른 금액을 말한다. */
  if (col.fee < 0) {
    var mHdr = String(header[12] || "").replace(/\s/g, "");
    if (!mHdr || /선출고|입고검수후출고/.test(mHdr)) col.fee = 12;
  }
  return col;
}

// ── 값 포맷 (CS 웹앱과 동일) ──────────────────────────────────

function prpFormatFee_(v) {
  if (v === null || v === undefined || v === "") return "";
  var s = String(v).trim();
  if (!s || s === "-") return "";
  if (/원/.test(s)) return s;
  if (!/^-?[\d,]+(\.\d+)?$/.test(s)) return s;
  var n = parseFloat(s.replace(/,/g, ""));
  if (isNaN(n)) return s;
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
}

function prpFeeNumber_(v) {
  var s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function prpFormatPhone_(raw) {
  var d = prpDigits_(raw);
  if (d.length === 11) return d.substring(0, 3) + "-" + d.substring(3, 7) + "-" + d.substring(7);
  if (d.length === 10) return d.substring(0, 3) + "-" + d.substring(3, 6) + "-" + d.substring(6);
  return String(raw || "").trim();
}

function prpFormatInvoice_(raw) {
  var s = String(raw || "").trim();
  var parts = s.match(/\d{10,14}/g);
  if (parts && parts.length) {
    var d = parts[0];
    if (d.length === 12) return d.substring(0, 4) + "-" + d.substring(4, 8) + "-" + d.substring(8);
    return d;
  }
  var dAll = prpDigits_(s);
  if (dAll.length === 12) return dAll.substring(0, 4) + "-" + dAll.substring(4, 8) + "-" + dAll.substring(8);
  return s || dAll;
}

function prpYmdFromCell_(raw) {
  var s = String(raw || "").trim();
  var m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return "20" + m[1] + m[2] + m[3];
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return m[1] + ("0" + m[2]).slice(-2) + ("0" + m[3]).slice(-2);
  return "";
}

/**
 * 비고에 남은 「귀책: 판매자 (오배송)」에서 귀책만 꺼낸다.  (2026-09-30)
 *
 * 대장에 「귀책」 열이 생기기 전까지의 길이다. 열이 생기면 읽는 쪽이 열을
 * 먼저 보므로 이 함수는 저절로 안 쓰인다. 반품송장이 걸어온 길과 같다.
 * CS_WebApp/csOrderSearch.gs 의 _cs_faultFromNotice_ 와 «쌍»이다 —
 * 적는 글자 모양이 하나니 읽는 것도 하나여야 한다.
 *
 * @return {string} "구매자" | "판매자" | ""
 */
/**
 * 비고에 남은 표시에서 사유를 꺼낸다.  (2026-09-30)
 *
 * ★ 대장에 사유 열이 «없다» ★
 *   202609 탭 실측 — 쓰이는 폭 21칸에 「반품사유」가 없다.
 *   12번째가 「재출고/단순/오주문입력/오배송」(유형)이고 그 옆은 회수신청이다.
 *   2026-09-18 에 「대장 L열에 반품사유가 있다」고 알고 고쳤는데 L열은
 *   유형이었다. 그래서 사유는 그때부터 한 번도 안 적혔고 카드에도 안 떴다.
 *
 *   반품송장·환불계좌가 걸어온 길을 사유도 탄다 — 비고에 적고 비고에서 읽는다.
 *   시트에 「반품사유」 열을 만들면 읽는 쪽이 열을 먼저 보므로 이 함수는
 *   저절로 안 쓰인다.
 *
 * 두 가지 모양을 받는다 —
 *   「귀책: 판매자 (오배송)」  귀책과 사유를 둘 다 담은 줄
 *   「사유: 제품불량」        귀책이 없을 때
 *
 * @return {string} 사유 낱말, 없으면 ""
 */
function prpReasonFromNotice_(notice) {
  var s = String(notice == null ? "" : notice);
  if (!s) return "";
  var m = s.match(/귀책\s*[:：]\s*(?:구매자|판매자)\s*\(([^)]{1,20})\)/);
  if (m) return String(m[1]).trim();
  m = s.match(/(?:^|[\s·.])사유\s*[:：]\s*([^\s·.,()]{1,20})/);
  return m ? String(m[1]).trim() : "";
}

function prpFaultFromNotice_(notice) {
  var s = String(notice == null ? "" : notice);
  if (!s) return "";
  var m = s.match(/귀책\s*[:：]\s*(구매자|판매자)/);
  return m ? m[1] : "";
}

/**
 * 「판매자귀책 / 오배송」 한 칸을 귀책과 사유로 가른다.  (2026-10-01)
 *
 * ★ CS웹앱 _cs_parseCause_ 와 «같은 규칙»이다 — 쌍으로 고친다 ★
 *   협의된 배열(「202609의 테스트 시트」)은 「발생원인」 한 칸에 둘을 함께
 *   적는다. 두 앱이 같은 대장을 읽으니 가르는 법도 같아야 한다 —
 *   다르면 업체 화면과 CS 화면이 다른 말을 한다.
 *
 * 「/」가 없으면 통째로 사유다. 앞이 귀책 낱말이 아니어도 통째로 사유다
 * (「오배송> 재출고 되는 건가요?」 같은 줄이 실제로 있다).
 */
function prpParseCause_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return { 귀책: "", 사유: "" };
  var i = s.indexOf("/");
  if (i < 0) return { 귀책: "", 사유: s };
  var 앞 = s.slice(0, i).trim(), 뒤 = s.slice(i + 1).trim();
  var m = 앞.replace(/\s/g, "").match(/^(구매자|판매자)귀책$/);
  if (!m) return { 귀책: "", 사유: s };
  return { 귀책: m[1], 사유: 뒤 };
}

/**
 * 「판매자」 + 「오배송」 → 「판매자귀책 / 오배송」  (2026-10-01)
 * CS웹앱 _cs_makeCause_ 와 «같은 글자 모양»이다. 다르면 같은 칸에 두 모양이
 * 섞여 읽는 쪽이 한쪽을 못 가른다.
 */
function prpMakeCause_(귀책, 사유) {
  var f = String(귀책 || "").trim(), r = String(사유 || "").trim();
  if (!r) return "";
  return f ? f + "귀책 / " + r : r;
}

/**
 * 비고에 남긴 「재출고: 몸통 1」에서 «다시 보내는 것»을 되읽는다. (2026-10-02)
 *
 * 반품대장의 상품명 칸은 «돌려받는 것»이다. 세트가 뚜껑만 나가면 우리가
 * 몸통을 다시 보내는데, 협의된 배열에 그 칸이 없어 비고에 남긴다.
 *
 * ★ 줄 끝까지 받는다 ★ 품목명에는 띄어쓰기·괄호·숫자가 섞인다 —
 *   낱말 하나로 끊으면 「220파이 감자탕 중 백색 몸통 1」이 「220파이」가 된다.
 *
 * ★ CS웹앱 `_cs_reshipFromNotice_` 와 «같은 규칙» ★ 쌍으로 고친다.
 *
 * @return {string} 재출고 상품, 없으면 ""
 */
function prpReshipFromNotice_(notice) {
  var s = String(notice == null ? "" : notice);
  if (!s) return "";
  var m = s.match(/(?:^|[\n·])\s*재출고\s*[:：]\s*([^\n]{1,80})/);
  return m ? String(m[1]).trim() : "";
}

/**
 * 비고에 남긴 「구분: 교환」에서 교환반품구분을 되읽는다.  (2026-10-01)
 *
 * 협의된 배열에는 교환반품구분 칸이 없다. CS웹앱이 비고에 「구분: …」으로
 * 남기므로(csOrderSearch.submitReturnLedger) 포털도 같은 자리에서 읽어야
 * 업체 화면에 보인다. CS웹앱 _cs_typeFromNotice_ 와 같은 규칙이다.
 */
function prpTypeFromNotice_(notice) {
  var s = String(notice == null ? "" : notice);
  if (!s) return "";
  var m = s.match(/(?:^|[\s·.])구분\s*[:：]\s*([^\s·.,()]{1,20})/);
  return m ? String(m[1]).trim() : "";
}

function prpParseReturnInvFromNotice_(text) {
  var s = String(text || "");
  var m = s.match(/반품송장\s*[:：]\s*([0-9\-]+)/i);
  if (m) return String(m[1] || "").trim();
  m = s.match(/회수송장\s*[:：]\s*([0-9\-]+)/i);
  if (m) return String(m[1] || "").trim();
  return "";
}

function prpIsDoneMark_(v) {
  var raw = String(v == null ? "" : v).trim();
  if (!raw) return false;
  var s = raw.replace(/\s/g, "");
  if (s === "완료" || s.indexOf("완료") === 0) return true;
  if (/이카운트\s*ok/i.test(raw)) return true;
  return false;
}

function prpRowHasData_(row, col) {
  if (!row) return false;
  var keys = [col.date, col.name, col.item, col.phone, col.invoice, col.status];
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] < 0) continue;
    var v = String(row[keys[i]] || "").trim();
    if (v && v !== "-") return true;
  }
  return false;
}

// ── 월별 탭 ───────────────────────────────────────────────────

function prpIsMonthName_(name) {
  return /^\d{6}$/.test(String(name || "").trim());
}

function prpMonthsToScan_(days) {
  days = days || PRP_DEFAULT_DAYS;
  var months = Math.max(2, Math.ceil(days / 28) + 1);
  var out = [];
  var d = prpNow_();
  for (var i = 0; i < months; i++) {
    var mk = Utilities.formatDate(d, "Asia/Seoul", "yyyyMM");
    if (out.indexOf(mk) < 0) out.push(mk);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/**
 * 접수용 당월 탭.
 * 업체 접수가 그 달 첫 기록일 수 있으므로 탭 생성 로직도 CS 와 동일하게 갖춘다.
 */
function prpGetWriteTab_(ss) {
  var monthKey = Utilities.formatDate(prpNow_(), "Asia/Seoul", "yyyyMM");
  var tab = ss.getSheetByName(monthKey);
  if (tab) return tab;

  var sheets = ss.getSheets();
  var monthTabs = [];
  for (var i = 0; i < sheets.length; i++) {
    if (prpIsMonthName_(sheets[i].getName())) monthTabs.push({ name: sheets[i].getName(), tab: sheets[i] });
  }
  monthTabs.sort(function (a, b) { return b.name.localeCompare(a.name); });

  var template = null;
  for (var j = 0; j < monthTabs.length; j++) {
    if (monthTabs[j].name < monthKey) { template = monthTabs[j].tab; break; }
  }
  if (!template && monthTabs.length) template = monthTabs[0].tab;
  if (!template) {
    for (var g = 0; g < sheets.length; g++) {
      if (sheets[g].getSheetId() === PRP_LEDGER_GID) { template = sheets[g]; break; }
    }
  }
  if (!template) return null;

  tab = template.copyTo(ss);
  tab.setName(monthKey);
  try { ss.setActiveSheet(tab); ss.moveActiveSheet(0); } catch (e) {}

  // 복사본의 데이터 행만 비운다 (열 구조·서식 유지)
  var lastCol = Math.max(tab.getLastColumn(), 15);
  var scan = Math.max(tab.getLastRow(), 40);
  var values = tab.getRange(1, 1, scan, lastCol).getDisplayValues();
  var headerIdx = prpFindHeaderRow_(values);
  if (headerIdx >= 0) {
    var dataStart = headerIdx + 2;
    var lr = tab.getLastRow();
    if (lr >= dataStart) tab.getRange(dataStart, 1, lr - dataStart + 1, lastCol).clearContent();
  }
  return tab;
}

// ── 공개 타임라인 ─────────────────────────────────────────────

/**
 * N열 비고를 업체에게 보여줄 이력으로 가공한다.
 *
 * 공개 기준은 PRP_PUBLIC_TIMELINE_KINDS 와 PRP_INTERNAL_MARK_ 두 개다.
 * 기본이 공개이고, 숨기려면 CS 가 `[내부]` 를 붙인다 (prpConfig.gs 참고).
 *
 * 사진은 CS 가 올린 것도 공개한다 — 본문에 URL 이 들어 있어 그대로 링크가 된다.
 * 업체 본인이 남긴 문의는 작성자 태그("업체:{업체명}")로 구분해 "우리 문의"로 낸다.
 *
 * 담당자 실명은 어떤 경우에도 내보내지 않는다. `who` 는 항상 역할 이름이다.
 */
function prpPublicTimeline_(notice, status, staff, date, type, vendorName) {
  var events = [];
  var lines = String(notice || "").split(/\n/);
  var mineTag = PRP_STAFF_PREFIX + String(vendorName || "").trim();
  var allow = PRP_PUBLIC_TIMELINE_KINDS || [];

  for (var i = 0; i < lines.length; i++) {
    var ln = String(lines[i] || "").trim();
    if (!ln) continue;
    if (/^반품송장\s*[:：]|^회수송장\s*[:：]/.test(ln)) continue; // meta — 별도 필드로 이미 나간다

    var m = ln.match(/^\[(\d{6})\s+(\d{1,2}:\d{2})\s+([^\]]+)\]\s*(.*)$/);
    if (!m) continue; // 형식 없는 옛 메모 — 무엇이 섞였는지 몰라 공개하지 않는다

    var who = String(m[3] || "").trim();
    var body = String(m[4] || "").trim();
    var isMine = (who === mineTag);

    // 업체 본인 글에는 내부 표시가 적용되지 않는다 (자기가 쓴 것이다)
    if (!isMine && PRP_INTERNAL_MARK_.test(body)) continue;

    if (/^상태→/.test(body)) {
      if (allow.indexOf("status") < 0) continue;
      events.push({
        kind: "status",
        date: m[1], time: m[2],
        who: "CS팀",
        text: body.replace(/^상태→/, "").trim(),
        sortKey: prpSortKey_(m[1], m[2])
      });
      continue;
    }

    if (isMine) {
      events.push({
        kind: "mine",
        date: m[1], time: m[2],
        who: "우리 문의",
        text: body,
        sortKey: prpSortKey_(m[1], m[2])
      });
      continue;
    }

    // 사진 첨부 — CS앱(csAttach)과 포털(prpAttach)이 같은 문구로 남긴다.
    // 현장입고 — 물류팀이 물건을 받고 찍은 사진 (2026-09-29).
    //   ★ CS 웹앱 csOrderSearch._cs_isPhotoLine_ 과 «같은 규칙»이다 ★
    var isIntake = /^현장입고/.test(body);
    var isPhoto = /^(사진\s*첨부|현장입고)/.test(body) && /https?:\/\//.test(body);
    var kind = isPhoto ? "photo" : "consult";
    if (allow.indexOf(kind) < 0) continue;

    events.push({
      kind: kind,
      date: m[1], time: m[2],
      who: isPhoto ? (isIntake ? "입고 사진" : "CS팀 사진") : "CS팀",
      text: body,
      sortKey: prpSortKey_(m[1], m[2])
    });
  }

  if (date && PRP_PUBLIC_TIMELINE_KINDS.indexOf("access") >= 0) {
    var openedBy = String(staff || "").indexOf(PRP_STAFF_PREFIX) === 0 ? "우리 접수" : "CS팀 접수";
    events.push({
      kind: "access",
      date: date, time: "",
      who: openedBy,
      text: "반품 접수" + (type ? " · " + type : ""),
      sortKey: prpSortKeyFromYmd_(date)
    });
  }

  events.sort(function (a, b) {
    return String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
  });
  return events;
}

function prpSortKey_(yymmdd, hm) {
  var ymd = prpYmdFromCell_(yymmdd);
  if (!ymd) return "000000000000";
  var t = String(hm || "00:00").replace(/[^0-9]/g, "");
  while (t.length < 4) t += "0";
  return ymd + t.substring(0, 4);
}

function prpSortKeyFromYmd_(yymmdd) {
  var ymd = prpYmdFromCell_(yymmdd);
  return ymd ? (ymd + "0000") : "000000000000";
}

// ── 업체별 조회 ───────────────────────────────────────────────

/** 이 행이 요청한 업체 것인지 — 정규화 키 + 별칭으로 판정 */
function prpRowBelongsTo_(vendorCell, sess) {
  var k = prpVendorKey_(vendorCell);
  if (!k) return false;
  if (k === sess.key) return true;
  var al = sess.aliases || [];
  for (var i = 0; i < al.length; i++) {
    if (k === al[i]) return true;
  }
  return false;
}

/**
 * 탭 하나에서 이 업체 건만 카드로 만든다.
 * 마스킹은 여기서 끝낸다 — 이 함수를 통과한 객체만 클라이언트로 나간다.
 */
function prpReadTabCases_(tab, tabName, cutoffYmd, sess) {
  if (!tab) return [];
  var lastCol = Math.max(tab.getLastColumn(), 15);
  var lastRow = tab.getLastRow();
  if (lastRow < 5) return [];

  var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headerIdx = prpFindHeaderRow_(values);
  if (headerIdx < 0) return [];

  var col = prpMapCols_(values[headerIdx]);
  if (col.vendor < 0) return []; // 업체 열이 없으면 격리 불가 — 아무것도 내보내지 않는다

  var out = [];
  for (var ri = headerIdx + 1; ri < values.length; ri++) {
    var row = values[ri];
    if (!prpRowHasData_(row, col)) continue;
    if (!prpRowBelongsTo_(row[col.vendor], sess)) continue;

    var dateYmd = prpYmdFromCell_(col.date >= 0 ? row[col.date] : "");
    if (cutoffYmd && dateYmd && dateYmd < cutoffYmd) continue;

    /*  ★ row[0] 이 아니라 col.status 를 본다 ★  (2026-10-01)
        A열을 상태로 못 박고 있었다. 10월 탭이 A 를 「반품접수날짜」로 쓰면
        업체 화면의 상태 자리에 날짜가 찍힌다. 칸을 못 찾으면 빈 값 —
        아래에서 「접수」로 보인다. 틀린 칸을 읽는 것보다 모르는 게 낫다.  */
    var status = col.status >= 0 ? String(row[col.status] || "").trim() : "";
    var notice = col.notice >= 0 ? String(row[col.notice] || "").trim() : "";
    var staffVal = col.staff >= 0 ? String(row[col.staff] || "").trim() : "";
    var dateVal = col.date >= 0 ? String(row[col.date] || "").trim() : "";
    //  칸이 없으면 비고의 「구분: …」에서 되읽는다 (협의된 배열, 2026-10-01)
    var typeVal = col.type >= 0
      ? String(row[col.type] || "").trim()
      : prpTypeFromNotice_(notice);
    /*  ★ 한 칸에 담긴 번호와 택배사를 가른다 ★  (2026-10-04)
        10월 머리글이 「원송장번호 / 택배사」·「반품송장번호 / 택배사」다.
        업체 화면은 번호로 배송조회 주소를 만든다 — 칸을 그대로 흘려보내면
        주소에 「/ CJ대한통운」이 붙어 조회가 안 된다.
        ★ CS 웹앱 csOrderSearch 와 같은 가름이다 — 쌍으로 고친다 ★  */
    var 원송장칸 = prpSplitLedgerInvoice_(col.invoice >= 0 ? row[col.invoice] : "");
    var invRaw = 원송장칸.번호;
    var 반품칸 = prpSplitLedgerInvoice_(col.returnInvoice >= 0 ? row[col.returnInvoice] : "");

    out.push({
      tab: tabName,
      row: ri + 1,
      date: dateVal,
      dateYmd: dateYmd,
      // 접수자 실명은 내보내지 않는다. 누가 접수했는지만 구분되면 충분하다.
      openedBy: staffVal.indexOf(PRP_STAFF_PREFIX) === 0 ? "우리" : "CS팀",
      name: col.name >= 0 ? String(row[col.name] || "").trim() : "",
      phone: col.phone >= 0 ? prpFormatPhone_(row[col.phone]) : "",
      //  실 전화번호 (추가연락처). 안심번호만 보이면 회수 기사가 못 건다.
      phone2: col.phone2 >= 0 ? prpFormatPhone_(row[col.phone2]) : "",
      //  그 번호의 주인. 주문자와 통화 상대가 다를 때 적힌다.
      phone2Name: col.phone2Name >= 0 ? String(row[col.phone2Name] || "").trim() : "",
      item: col.item >= 0 ? String(row[col.item] || "").trim() : "",
      qty: col.qty >= 0 ? String(row[col.qty] || "").trim() : "",
      invoice: invRaw,
      invDigits: prpDigits_(invRaw),
      // 전용 열 우선, 없으면 과거 방식(N열 비고)에서 읽는다
      returnInvoice: 반품칸.번호 || prpParseReturnInvFromNotice_(notice),
      /*  택배사 — 원송장은 «보낸» 택배사, 반품송장은 «수거하는» 택배사다.
          업체 화면이 배송조회 주소를 고르는 데 쓴다.  */
      carrier: 원송장칸.택배사,
      returnCarrier: 반품칸.택배사,
      type: typeVal,
      /*  다시 보내는 것 (2026-10-02) — 상품명은 «돌려받는 것»이다.
          대리발송 업체에게는 자기가 보낼 물건이라 더 중요하다.
          CS웹앱 _cs_reshipFromNotice_ 와 같은 규칙이다 — 쌍으로 고친다. */
      reship: prpReshipFromNotice_(notice),
      /*  구분(type)은 «어떻게 처리하나», 사유(reason)는 «왜 보냈나».
          업체도 자기 건이 왜 반품인지 알아야 다음에 안 그런다. */
      /*  사유 — 협의된 배열은 「발생원인」 한 칸에 «귀책 / 사유»로 적는다.
          열이 아예 없는 옛 탭(9월까지)은 비고 표시에서 되읽는다. (2026-10-01)
          ★ CS웹앱 csOrderSearch 와 같은 차례다 — 쌍으로 고친다 ★  */
      reason: col.reason >= 0
        ? prpParseCause_(row[col.reason]).사유
        : prpReasonFromNotice_(notice),
      /*  귀책 — 찾는 차례가 셋이다 (2026-10-01)
            ① 「귀책」 전용 열이 있으면 그것
            ② 「발생원인」 칸의 «앞»부분          (협의된 배열)
            ③ 비고의 「귀책: 판매자 (…)」 표시    (9월까지의 길)  */
      fault: col.fault >= 0
        ? String(row[col.fault] || "").trim()
        : (col.reason >= 0 && prpParseCause_(row[col.reason]).귀책) ||
          prpFaultFromNotice_(notice),
      status: status || "접수",
      /*  ★ 수거 택배사 — 칸이 없으면 반품송장 칸에서 ★  (2026-10-04)
          업체 화면이 이 값으로 배송조회 주소를 고르고 카드에 「수거 CJ」로 보인다.
          10월 탭에는 「회수신청」 칸이 없어 늘 빈칸이었다 — 업체가 접수창에서
          고른 택배사가 어디에도 안 남았다는 뜻이다(2026-09-10 과 같은 일).  */
      pickup: (col.pickup >= 0 ? String(row[col.pickup] || "").trim() : "") ||
        반품칸.택배사 || 원송장칸.택배사,
      fee: col.fee >= 0 ? prpFormatFee_(row[col.fee]) : "",
      feeNum: col.fee >= 0 ? prpFeeNumber_(row[col.fee]) : 0,
      done: prpIsDoneMark_(status),
      timeline: prpPublicTimeline_(notice, status, staffVal, dateVal, typeVal, sess.vendor),
      sortKey: (dateYmd || "00000000") + "_" + String(100000 - ri)
    });
  }
  return out;
}

/** 업체별 캐시 — 다른 업체 데이터가 같은 키에 섞이지 않게 업체키를 반드시 넣는다 */
function prpLoadVendorCases_(sess, days, refresh) {
  days = days || PRP_DEFAULT_DAYS;
  var cache = CacheService.getScriptCache();
  var ck = PRP_CACHE_VER + "_v_" + sess.key + "_" + days;

  if (!refresh) {
    try {
      var hit = cache.get(ck);
      if (hit) return JSON.parse(hit) || [];
    } catch (e) {}
  }

  var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
  var monthKeys = prpMonthsToScan_(days);
  var cutoffYmd = prpDaysAgoYmd_(days);
  var all = [];

  for (var mi = 0; mi < monthKeys.length; mi++) {
    var tab = ss.getSheetByName(monthKeys[mi]);
    if (!tab) continue;
    var chunk = prpReadTabCases_(tab, monthKeys[mi], cutoffYmd, sess);
    for (var ci = 0; ci < chunk.length; ci++) all.push(chunk[ci]);
  }

  all.sort(function (a, b) {
    return String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
  });

  try { cache.put(ck, JSON.stringify(all), PRP_CACHE_TTL); } catch (e) {}
  return all;
}

function prpInvalidateVendorCache_(vendorKey) {
  var cache = CacheService.getScriptCache();
  var spans = [30, 90, 180, 365, PRP_DEFAULT_DAYS];
  for (var i = 0; i < spans.length; i++) {
    try { cache.remove(PRP_CACHE_VER + "_v_" + vendorKey + "_" + spans[i]); } catch (e) {}
  }
}

// ── 행 접근 (쓰기 전 소유 검증) ───────────────────────────────

/**
 * 업체가 특정 행을 건드리려 할 때, 그 행이 정말 그 업체 것인지 확인한다.
 * 클라이언트가 tab/row 를 임의로 바꿔 보낼 수 있으므로 반드시 서버에서 검증한다.
 */
function prpOpenOwnedRow_(sess, tabName, rowNum) {
  var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
  var tab = ss.getSheetByName(String(tabName || "").trim());
  if (!tab) throw new Error("탭을 찾을 수 없습니다.");
  rowNum = parseInt(rowNum, 10);
  if (!(rowNum > 0)) throw new Error("행 번호가 잘못되었습니다.");

  var lastCol = Math.max(tab.getLastColumn(), 15);
  var headerScan = tab.getRange(1, 1, Math.min(Math.max(tab.getLastRow(), rowNum), 40), lastCol).getDisplayValues();
  var headerIdx = prpFindHeaderRow_(headerScan);
  if (headerIdx < 0) throw new Error("반품대장 헤더를 찾지 못했습니다.");

  var col = prpMapCols_(headerScan[headerIdx]);
  if (col.vendor < 0) throw new Error("업체명 열을 찾지 못했습니다.");

  var row = tab.getRange(rowNum, 1, 1, lastCol).getDisplayValues()[0];
  if (!prpRowBelongsTo_(row[col.vendor], sess)) {
    prpLog_(sess.vendor, "거부", "타 업체 행 접근 시도 " + tabName + " " + rowNum + "행");
    throw new Error("이 건에 대한 권한이 없습니다.");
  }
  return { tab: tab, col: col, rowNum: rowNum, row: row, lastCol: lastCol };
}

function prpAppendNoticeLine_(existing, line) {
  var s = String(existing || "").trim();
  return s ? (s + "\n" + line) : line;
}

/*  ★ CS 웹앱에서 옮겨 온 짝이다 ★  (2026-10-04)
    두 GAS 프로젝트는 코드를 나눠 쓸 수 없어 복사한다. 손으로 고치면 갈라지고,
    갈라지면 같은 칸을 한쪽은 「번호 / 택배사」로 다른 쪽은 통째로 번호로 읽는다.
    _prpinvcarrier_test.js 가 두 쪽을 «글자까지» 맞대 본다 — 한쪽만 고치면 울린다.
    주인은 CS_WebApp/csOrderSearch.gs 다.  */
var _PRP_INV_CARRIER_SEP_ = " / ";

function prpSplitLedgerInvoice_(cell) {
  var s = String(cell == null ? "" : cell).trim();
  if (!s) return { 번호: "", 택배사: "" };
  var at = s.lastIndexOf("/");
  if (at < 0) return { 번호: s, 택배사: "" };

  var 뒤 = s.slice(at + 1).trim();
  var 앞 = s.slice(0, at).trim();
  /*  ★ 택배사인지 «확인»하고 가른다 ★
      「4466/5170/4219」처럼 빗금으로 끊어 적은 번호도 있고, 9월 탭의
      「재출고/단순/오주문입력/오배송」이 송장 칸에 잘못 들어온 줄도 있다.
      택배사 이름은 짧고 숫자가 길게 들어가지 않는다. 아니면 통째로 번호다 —
      멀쩡한 번호를 쪼개는 쪽이 택배사를 못 읽는 쪽보다 나쁘다.  */
  //  「446651704219 / 」처럼 뒤가 비면 빗금만 떼고 번호로 본다
  if (!뒤) return { 번호: 앞 || s, 택배사: "" };
  /*  ★ 번호 없이 택배사만 적힌 칸 ★  (2026-10-04)
      수거를 접수할 때는 «어느 택배사가 가는지»를 먼저 알고 번호는 나중에 나온다.
      그때 「/ CJ대한통운」으로 적어 둔다 — 숫자를 뽑으면 빈 값이라
      입고 스캔·중복 검사는 「번호 없음」으로 여태처럼 읽는다.  */
  if (!앞) {
    if (뒤.length > 12 || /\d{4,}/.test(뒤)) return { 번호: s, 택배사: "" };
    return { 번호: "", 택배사: 뒤 };
  }
  /*  ★ 앞에 «진짜 송장번호»가 있을 때만 택배사로 본다 ★
      이것이 없으면 「재출고/단순/오주문입력/오배송」의 「오배송」이 택배사가 되고
      「4466/5170/4219」의 「4219」도 택배사가 된다. 둘 다 실제로 있는 줄이다.
      송장번호는 8자리 이상 숫자 덩어리다 — 그게 앞에 있어야 가른다.  */
  if (!/\d{8,}/.test(앞.replace(/[^0-9]/g, ""))) return { 번호: s, 택배사: "" };
  if (뒤.length > 12) return { 번호: s, 택배사: "" };
  if (/\d{4,}/.test(뒤)) return { 번호: s, 택배사: "" };
  return { 번호: 앞, 택배사: 뒤 };
}

/**
 * 번호와 택배사를 한 칸으로 합친다. 택배사가 없으면 번호만.
 * 번호가 없으면 빈 칸이다 — 택배사만 남기면 숫자를 뽑는 쪽이 빈 송장으로 읽는다.
 */
function prpLedgerInvoiceCell_(번호, 택배사) {
  var n = String(번호 == null ? "" : 번호).trim();
  var c = String(택배사 == null ? "" : 택배사).replace(/\s+/g, " ").trim();
  if (c.length > 12 || /\d{4,}/.test(c)) c = "";   //  택배사로 볼 수 없는 값은 버린다
  /*  ★ 번호가 없어도 택배사는 남긴다 ★  (2026-10-04)
      수거 접수는 택배사를 먼저 알고 번호를 나중에 받는다. 그때 버리면
      누가 수거하는지가 사라지고, 나중에 번호가 들어와도 되살릴 길이 없다.  */
  if (!n) return c ? _PRP_INV_CARRIER_SEP_.replace(/^\s+/, "") + c : "";
  if (!c) return n;
  //  이미 붙어 있으면 두 번 붙이지 않는다
  if (prpSplitLedgerInvoice_(n).택배사) return n;
  if (c.length > 12 || /\d{4,}/.test(c)) return n;   //  택배사로 볼 수 없는 값은 안 적는다
  return n + _PRP_INV_CARRIER_SEP_ + c;
}

/**
 * 이미 적힌 칸의 번호만 갈아 쓴다 — 택배사는 그대로 둔다.
 * 수거 접수·입고 스캔이 번호를 덮어쓸 때 택배사를 지우지 않게 한다.
 * 새 번호가 비어도 택배사는 남긴다 — 번호를 지운 것이 택배사를 지운 뜻은 아니다.
 */
function prpLedgerInvoiceReplaceNo_(옛칸, 새번호) {
  var 옛 = prpSplitLedgerInvoice_(옛칸);
  return prpLedgerInvoiceCell_(새번호, 옛.택배사);
}
