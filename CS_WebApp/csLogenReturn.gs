/**
 * ══════════════════════════════════════════════════════════════
 *  로젠택배 회수(반품) 접수
 *  규격: 로젠택배_OpenAPI_규격.md §8   호출 래퍼: csLogen.gs
 *  ★ 2026-09-16 신규
 *
 *  > "로젠 회수 접수 규격 확인해서 붙여줘"
 *
 *  ★ 아직 «못 돈다» — 키가 없다 ★
 *    _secrets.gs 의 LOGEN_SECRET_KEY_DEV/PROD 가 비어 있다.
 *    시스템연동신청서 제출 전이고, IP 화이트리스트 면제도 답을 못 받았다
 *    (csLogen.gs 머리말 · 로젠_담당자_문의메일_초안.md).
 *
 *    그래도 지금 붙여 두는 까닭: 키가 오는 날 값만 넣으면 바로 돈다.
 *    그리고 «왜 안 되는지»를 화면이 말하게 하려면 코드가 있어야 한다 —
 *    단추가 그냥 없으면 사람은 기능이 없는 줄 안다.
 *
 *  ★ 롯데와 다른 점 셋 ★  (규격 §8.1)
 *    ① 운임을 «반드시» 넣어야 한다. dlvFare 는 null·0 이 안 된다.
 *       그래서 접수 전에 reverseChkInfoMulti 로 원송장 기준 운임을 받아 쓴다.
 *       지어내서 넣으면 안 된다 — 돈이 걸린 값이다.
 *    ② fareTy 는 010·020 만 된다. 2026-04-29 에 신용(030)·본사신용(040)이
 *       빠졌다. 조회가 그 밖의 값을 주면 접수하지 않고 사람에게 묻는다.
 *    ③ qty 는 1 고정이다. 박스가 여럿이면 «건마다» 접수한다.
 *
 *  ★ takeNo 를 반드시 남긴다 ★  (규격 §8.1 끝)
 *    이후 조회·취소의 키가 전부 takeNo 다. 안 적어 두면 접수는 됐는데
 *    상태를 못 보고 취소도 못 한다.
 *
 *  ★ 송하인 = 고객, 수하인 = 우리 ★
 *    반품은 방향이 반대다. 규격에도 「반품에서는 송하인 = 반품 보내는 고객,
 *    수하인 = 화주사」라고 적혀 있다. 여기서 뒤집으면 기사가 우리 창고로
 *    물건을 가지러 간다.
 * ══════════════════════════════════════════════════════════════
 */

/** 회수지(화주사) 설정은 롯데와 «같은 것»을 쓴다 — 창고가 둘일 리 없다 */
function _lgr_to_() {
  return (typeof _lrt_to_ === "function") ? _lrt_to_() : null;
}

/**
 * 지금 로젠 회수 접수를 쓸 수 있나.
 *
 * 화면이 단추를 내기 전에 묻는다. 못 쓰면 «왜»를 같이 준다 —
 * 단추가 그냥 없으면 사람은 기능이 없는 줄 안다.
 */
function csLogenReturnReady() {
  var to = _lgr_to_();

  /*  ★ 2026-10-07: 중계기를 거치면 GAS 에 키가 없다 ★
      로젠은 등록된 공인 IP 에서 온 호출만 받는데 Apps Script 는 고정 IP 가 없다.
      그래서 siot.com 중계기가 대신 부르고, **인증키는 중계기에만** 둔다
      (csLogen.gs 머리말 · _logen_call_ 의 proxy 갈래).
      여기서 _logen_key_() 로 「키가 있나」를 물으면 늘 「없다」가 나와
      **단추가 영영 안 나온다.** 실제로 그랬다 — 배포 @411 에서 칸이 안 떴다.

      그래서 «중계기 주소가 있으면 그것을 준비된 것으로» 본다.
      중계기 쪽 키가 틀렸는지는 눌러 봐야 안다 — 그때는 로젠이 401 로 답한다. */
  /*  ★ typeof 로 감싼다 ★  _lgr_to_ 와 같은 까닭이다.
      _logen_proxyUrl_ 은 csLogen.gs 에 있다. 운영에서는 늘 같이 올라가지만,
      이 파일만 떼어 돌리는 시험(_cslogenret_test.js)에서는 없다 —
      감싸지 않으면 거기서 터진다. 실제로 터뜨렸다(2026-10-07). */
  var 중계 = (typeof _logen_proxyUrl_ === "function") ? _logen_proxyUrl_() : "";
  var key = "";
  if (!중계) {
    try { key = _logen_key_(); } catch (e) { key = ""; }
  }

  if (!중계 && !key) {
    return { ready: false, to: null,
      reason: "로젠을 부를 길이 없습니다. _secrets.gs 의 LOGEN_PROXY_URL(중계기) 또는 " +
              "LOGEN_SECRET_KEY_PROD(직접 호출) 중 하나를 채워 주세요." };
  }
  if (!to) {
    return { ready: false, to: null,
      reason: "받는 곳(창고)이 설정되지 않았습니다. 관리자에게 csLotteReturnSetTo 실행을 요청하세요." };
  }
  return { ready: true, to: { name: to.name, addr: to.addr }, reason: "" };
}

/**
 * 접수 전 확인 — 이 원송장을 회수할 수 있나, 운임은 얼마인가.
 *   `reverseChkInfoMulti` (규격 §8.4)
 *
 * 원송장 기준으로 «집하지점과 운임을 한 번에» 준다. 규격서도 접수 전
 * 검증용으로 적합하다고 적어 두었다.
 *
 * ★ 운임을 여기서 받아야 하는 까닭 ★
 *   registReturnRequest 의 dlvFare 는 null·0 이 안 된다. 그렇다고
 *   아무 숫자나 넣으면 돈이 틀어진다. 로젠이 말하는 값을 그대로 쓴다.
 *
 * @return {{ok, fareTy, fareTyNm, dlvFare, branCd, branNm, error}}
 */
function csLogenReturnCheck(orgnSlipNo) {
  var inv = _logen_digits_(orgnSlipNo);
  if (!inv) return { ok: false, error: "원송장번호가 없습니다." };

  var r = _logen_call_("reverseChkInfoMulti", {
    userId: _logen_userId_(),
    data: [{ custCd: _logen_custCd_(), orgnSlipNo: inv }]
  });
  if (!r.ok) return { ok: false, error: r.error };

  var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
  if (!rows.length) {
    return { ok: false, error: "로젠이 이 송장의 회수 정보를 주지 않았습니다 (" + inv + ")" };
  }
  var d = rows[0] || {};
  if (!_logen_ok_(d.resultCd)) {
    return { ok: false, error: String(d.resultMsg || "회수 조회 실패") };
  }

  var fareTy = String(d.fareTy == null ? "" : d.fareTy).trim();
  var fare = parseInt(String(d.dlvFare == null ? "" : d.dlvFare).replace(/[^0-9]/g, ""), 10);

  return {
    ok: true,
    fareTy: fareTy,
    fareTyNm: String(d.fareTyNm || ""),
    dlvFare: isNaN(fare) ? 0 : fare,
    branCd: String(d.dlvBranCd || ""),
    branNm: String(d.branNm || ""),
    error: ""
  };
}

/**
 * 접수해도 되는 운임인가.
 *
 * ★ 010·020 만 된다 ★  (규격 §8.1 · 2026-04-29 개정)
 *   신용(030)·본사신용(040)이 빠졌다. 그 밖의 값이 오면 접수하지 않고
 *   사람에게 묻는다 — 몰래 010 으로 바꿔 넣으면 운임이 엉뚱한 데로 간다.
 *
 * ★ 운임 0 도 막는다 ★
 *   dlvFare 는 null·0 이 안 된다고 규격에 못 박혀 있다. 0 인 채로 보내면
 *   로젠이 거절하는데, 그 거절을 여기서 미리 알아채는 편이 낫다.
 */
function _lgr_fareOk_(chk) {
  if (!chk || !chk.ok) return "회수 정보를 못 받았습니다.";
  if (chk.fareTy !== "010" && chk.fareTy !== "020") {
    return "이 건의 운임타입이 " + (chk.fareTy || "(없음)") +
      (chk.fareTyNm ? "(" + chk.fareTyNm + ")" : "") +
      " 입니다. 로젠 반품 접수는 010·020 만 받습니다 — 담당자에게 확인해 주세요.";
  }
  if (!(chk.dlvFare > 0)) {
    return "회수 운임이 0 으로 옵니다. 로젠은 운임 0 인 반품을 안 받습니다 — 담당자에게 확인해 주세요.";
  }
  return "";
}

/**
 * 반품 «계약» 운임을 받는다 — contRtnFares (규격 §8.4).
 *
 * 못 받으면 0 을 준다. 그때는 reverseChkInfoMulti 의 값을 그대로 쓴다 —
 * 접수를 막느니 틀릴 수 있는 값으로라도 보내 보는 편이 낫다. 틀리면 로젠이
 * 거절하고 그 사유가 사람에게 그대로 보인다.
 *
 * 박스타입이 여럿 오면 «가장 싼 것»을 쓴다. 지금 계약에는 ZW001 하나뿐이다.
 */
function _lgr_contractFare_(orgnSlipNo, fareTy) {
  try {
    var r = _logen_call_("contRtnFares", {
      userId: _logen_userId_(),
      data: [{ orgnSlipNo: String(orgnSlipNo), fareTy: String(fareTy || "010") }]
    });
    if (!r.ok) return 0;
    var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
    var best = 0;
    for (var i = 0; i < rows.length; i++) {
      var inner = _logen_arr_(rows[i] && rows[i].data1);
      for (var j = 0; j < inner.length; j++) {
        var f = parseInt(String((inner[j] || {}).dlvFare == null ? "" : inner[j].dlvFare)
                  .replace(/[^0-9]/g, ""), 10);
        if (f > 0 && (best === 0 || f < best)) best = f;
      }
    }
    return best;
  } catch (e) { return 0; }
}

/**
 * 회수 접수 — `registReturnRequest` (규격 §8.1)
 *
 * @param p {orgnSlipNo, name, tel, addr, addr2, goodsNm, msg, staff}
 *          name·tel·addr 는 «반품을 보내는 고객»이다 (송하인).
 *          받는 곳(화주사)은 설정에서 가져온다 (수하인).
 *
 * @return {{ok, takeNo, fixTakeNo, fare, error}}
 */
function csLogenReturnRegister(p) {
  p = p || {};
  var inv = _logen_digits_(p.orgnSlipNo);
  if (!inv) return { ok: false, error: "원송장번호가 없습니다." };

  var ready = csLogenReturnReady();
  if (!ready.ready) return { ok: false, error: ready.reason };
  var to = _lgr_to_();

  var 이름 = String(p.name || "").trim();
  var 전화 = String(p.tel || "").trim();
  var 주소 = String(p.addr || "").trim();
  if (!이름 || !전화 || !주소) {
    /*  세 칸이 다 있어야 기사가 찾아간다. 하나라도 비면 접수하지 않는다 —
        「접수됐다」고 해 놓고 아무도 안 가는 것이 제일 나쁘다. */
    return { ok: false, error: "보내는 분 이름·연락처·주소가 다 있어야 접수됩니다. " +
      "(받은 값: " + (이름 || "이름없음") + " / " + (전화 || "연락처없음") + " / " +
      (주소 || "주소없음") + ")" };
  }

  //  ① 운임을 먼저 받는다 — 지어내지 않는다
  var chk = csLogenReturnCheck(inv);
  var 왜 = _lgr_fareOk_(chk);
  if (왜) return { ok: false, error: 왜, check: chk };

  /*  ★ 운임은 «반품 계약 운임» 이어야 한다 ★  (2026-10-08 실측으로 고침)
      reverseChkInfoMulti 의 dlvFare 는 «그 지점의 배송운임» 이고 지점마다 다르다 —
      서동작 2,400 · 남강서 2,500 · 서김포 4,000. 그런데 반품 계약 운임은 2,500
      하나다(contRtnFares · ZW001).

      계약에 없는 운임을 적어 보내면 로젠이 통째로 거절한다. 그런데 돌려주는 말이
      **「거래처계약정보 조회 오류 ( 거래처코드 : 348782 )」** 라 운임 이야기가
      한마디도 없다. 그 번호는 우리 거래처코드(30556066)도 아니다 — 엉뚱한 데를
      보게 만드는 말이다. 실제로 그랬다:
        45311894913 · 2,400 → 거래처계약정보 조회 오류
        45311894913 · 2,500 → 정상 접수 (takeNo 261008109134)

      2,500짜리 지점에서만 우연히 되고 있었다. 지점마다 다르니 조용히 반이 실패한다. */
  var 계약운임 = _lgr_contractFare_(inv, chk.fareTy);
  var 지점운임 = chk.dlvFare;
  if (계약운임 > 0) chk.dlvFare = 계약운임;

  //  ② 접수
  var r = _logen_call_("registReturnRequest", {
    userId: _logen_userId_(),
    data: [{
      custCd: _logen_custCd_(),
      orgnSlipNo: inv,
      /*  ★ 방향이 반대다 ★  송하인 = 반품 보내는 고객, 수하인 = 화주사(우리).
          뒤집으면 기사가 우리 창고로 물건을 가지러 간다. */
      sndCustNm: 이름.substring(0, 50),
      sndCellNo: 전화.substring(0, 50),
      sndCustAddr1: 주소.substring(0, 500),
      sndCustAddr2: String(p.addr2 || "").substring(0, 500),
      rcvCustNm: String(to.name || "").substring(0, 50),
      rcvTelNo: String(to.tel || "").substring(0, 50),
      rcvCustAddr1: String(to.addr || "").substring(0, 500),
      qty: 1,                       // ★ 규격상 1 고정. 박스가 여럿이면 건마다 접수한다
      fareTy: chk.fareTy,           // ★ 010·020 만 — 위에서 걸렀다
      dlvFare: chk.dlvFare,         // ★ null·0 불가 — 위에서 걸렀다
      goodsNm: String(p.goodsNm || "").substring(0, 1000),
      sndMsg: String(p.msg || "").substring(0, 500)
    }]
  });
  if (!r.ok) return { ok: false, error: r.error, check: chk };

  var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
  var d = rows[0] || {};
  if (!_logen_ok_(d.resultCd)) {
    /*  ★ 무엇을 보냈는지 같이 적는다 ★  (2026-10-08)
        로젠이 돌려주는 말이 「거래처계약정보 조회 오류 ( 거래처코드 : 348782 )」 처럼
        원인과 동떨어져 있다. 그 말만 보면 계약이 끊겼나, 남의 송장인가를 의심하게
        된다 — 실제로는 운임이 계약과 달라서였다. 보낸 값을 적어 두면 다음엔
        한눈에 갈린다. 고치고도 또 같은 화면을 보며 헤맸다. */
    var 덧 = " [보낸 운임 " + chk.dlvFare + "원" +
      (계약운임 > 0 ? " · 계약 " + 계약운임 : " · 계약운임 못 받음") +
      (지점운임 !== chk.dlvFare ? " · 지점 " + 지점운임 : "") +
      " · 타입 " + chk.fareTy + "]";
    return { ok: false, error: String(d.resultMsg || "접수 실패") + 덧, check: chk };
  }

  var takeNo = String(d.takeNo || "").trim();
  if (!takeNo) {
    /*  접수는 됐는데 번호를 못 받았다. 조회도 취소도 못 하는 상태다 —
        「됐다」고 하면 안 된다. 사람이 로젠에 직접 물어야 한다. */
    return { ok: false, check: chk,
      error: "접수 응답에 접수번호(takeNo)가 없습니다. 로젠에 확인이 필요합니다." };
  }

  return {
    ok: true,
    takeNo: takeNo,
    fixTakeNo: String(d.fixTakeNo || ""),
    fare: chk.dlvFare,
    branNm: chk.branNm,
    error: ""
  };
}

/**
 * 접수 상태 조회 — 원송장으로 (규격 §8.2 `inquiryReturnStateMulti`)
 *
 * ★ 이것만 상태를 «한글 명칭»(resvStatNm)으로 준다 ★
 *   나머지 둘은 코드(resvStat)다. 규격서가 「혼용 주의」라 적어 두었다.
 *   로젠은 화물상태에도 코드가 없다 — 이름을 그대로 흘린다(csLogen.gs 와 같은 방침).
 */
function csLogenReturnState(orgnSlipNo) {
  var inv = _logen_digits_(orgnSlipNo);
  if (!inv) return { ok: false, error: "원송장번호가 없습니다." };

  var r = _logen_call_("inquiryReturnStateMulti", {
    userId: _logen_userId_(),
    data: [{ custCd: _logen_custCd_(), orgnSlipNo: inv }]
  });
  if (!r.ok) return { ok: false, error: r.error };

  var rows = _logen_arr_(r.json && (r.json.data1 || r.json.data));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      takeNo: String(rows[i].takeNo || ""),
      slipNo: String(rows[i].slipNo || ""),
      stat: String(rows[i].resvStatNm || "")      // ★ 명칭이다. 코드가 아니다
    });
  }
  return { ok: true, rows: out, error: "" };
}

/**
 * 접수 취소 — `cancelReserveState` (규격 §8.3)
 *
 * ★ 응답 코드를 상태 코드표로 읽지 말 것 ★
 *   조회 코드표는 「20 = 접수취소」인데 취소 응답은 「030」을 준다.
 *   자릿수도 다르다. 규격서가 못 박아 둔 함정이라 여기서는 코드를 해석하지
 *   않고 «성공 여부»만 본다.
 */
function csLogenReturnCancel(takeNo) {
  var t = String(takeNo || "").trim();
  if (!t) return { ok: false, error: "접수번호(takeNo)가 없습니다." };

  var r = _logen_call_("cancelReserveState", {
    userId: _logen_userId_(),
    data: [{ custCd: _logen_custCd_(), takeNo: t }]
  });
  if (!r.ok) return { ok: false, error: r.error };

  var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
  var d = rows[0] || {};
  if (!_logen_ok_(d.resultCd)) {
    return { ok: false, error: String(d.resultMsg || "취소 실패") };
  }
  return { ok: true, takeNo: String(d.takeNo || t), error: "" };
}

/**
 * 편집기에서 한 번 눌러 보는 점검.
 * 키가 없으면 «키가 없다»고 말한다 — 호출해 보고 401 을 받는 것보다 낫다.
 */
function csLogenReturnPing(testInvoice) {
  var L = ["── 로젠 회수 접수 점검 ──"];
  var ready = csLogenReturnReady();
  L.push("쓸 수 있나 : " + (ready.ready ? "예" : "아니오"));
  if (!ready.ready) {
    L.push("왜        : " + ready.reason);
  } else {
    L.push("받는 곳   : " + ready.to.name + " / " + ready.to.addr);
    var inv = _logen_digits_(testInvoice);
    if (inv) {
      var c = csLogenReturnCheck(inv);
      L.push("");
      L.push("시험 송장 : " + inv);
      if (c.ok) {
        L.push("  집하지점 : " + (c.branNm || "-") + " (" + (c.branCd || "-") + ")");
        L.push("  운임타입 : " + c.fareTy + " " + (c.fareTyNm || ""));
        L.push("  회수운임 : " + c.dlvFare + "원");
        var 왜 = _lgr_fareOk_(c);
        L.push("  접수가능 : " + (왜 ? "아니오 — " + 왜 : "예"));
      } else {
        L.push("  ★ " + c.error);
      }
    } else {
      L.push("(송장번호를 넣어 부르면 그 건의 운임까지 봅니다)");
    }
  }
  var msg = L.join(String.fromCharCode(10));
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  박스 여럿을 접수하고 «롯데와 같은 모양»으로 돌려준다
 *  2026-09-16
 *
 *  csLotteReturnPickupFromCard 가 이 결과를 그대로 받아 대장에 적는다.
 *  모양이 다르면 그쪽을 또 갈라야 한다 — 그래서 여기서 맞춘다.
 *
 *    { ok, results:[{ok, orglInvNo, invoice, error}], invoices:[], pickReqYmd, error }
 *
 *  ★ qty 는 1 고정이다 ★  (규격 §8.1)
 *    그래서 박스가 여럿이면 «건마다» 접수한다. 한 번에 보내면 한 박스만 온다.
 *
 *  ★ 하나가 실패해도 나머지는 접수한다 ★
 *    두 박스 중 하나가 막혔다고 나머지까지 안 보내면, 사람이 다시 눌러야
 *    하는데 그때는 먼저 것이 「이미 접수」로 막힌다. 건별로 결과를 남긴다.
 * ══════════════════════════════════════════════════════════════
 */
function _lgr_pickupMany_(p) {
  p = p || {};
  var origs = p.orglInvNos || [];
  var out = { ok: false, results: [], invoices: [], takeNos: [], pickReqYmd: "", error: "" };
  if (!origs.length) { out.error = "접수할 원송장이 없습니다."; return out; }

  /*  집하일자는 로젠이 정한다. 우리가 지어내지 않는다 —
      화면에는 「오늘 넣었다」는 뜻으로 오늘 날짜를 적어 둔다. */
  out.pickReqYmd = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  var 된것 = 0;
  for (var i = 0; i < origs.length; i++) {
    var r = csLogenReturnRegister({
      orgnSlipNo: origs[i],
      name: p.name, tel: p.phone, addr: p.addr,
      goodsNm: p.item, msg: p.memo
    });
    if (r.ok) {
      된것++;
      /*  ★ 로젠은 접수 순간 반품송장을 «안 준다» ★
          응답은 takeNo(접수번호)뿐이고, 송장번호(slipNo)는 나중에
          inquiryReturnStateMulti 로 나온다(규격 §8.2).

          ★ takeNo 를 «반품송장» 자리에 넣지 않는다 ★  (2026-10-07)
            takeNo 는 12자리 숫자다 — **롯데 송장도 12자리**라 대장에 섞이면
            나중에 송장으로 오인된다. 대장은 세 앱이 읽는다([[return-ledger-tab-spec]]) —
            한 번 오염되면 번진다.
            그래서 **송장 자리는 비워 두고** takeNo 는 따로 돌려준다.
            화면이 그것을 «비고»에 적는다 — 규격의 「칸이 없으면 비고로 흘린다」 그대로다. */
      out.results.push({
        ok: true, orglInvNo: origs[i],
        invoice: String(r.slipNo || ""),
        takeNo: r.takeNo, error: ""
      });
      if (r.slipNo) out.invoices.push(String(r.slipNo));
      out.takeNos.push(String(r.takeNo));
    } else {
      out.results.push({ ok: false, orglInvNo: origs[i], invoice: "", error: r.error });
    }
  }

  out.ok = 된것 > 0;
  if (된것 < origs.length) {
    var 실패 = [];
    for (var k = 0; k < out.results.length; k++) {
      if (!out.results[k].ok) 실패.push(out.results[k].orglInvNo + " — " + out.results[k].error);
    }
    out.error = 실패.join(" · ");
  }
  return out;
}


/**
 * 화면이 부르는 자리 — 회수 접수(박스 여럿).
 *
 * ★ csLotteReturnPickup 과 «같은 모양»으로 돌려준다 ★
 *   화면(lrtConfirm)이 한 벌로 다루려면 모양이 같아야 한다.
 *   다만 **로젠은 invoices 가 빈 채로 온다** — 접수 순간 송장이 없다.
 *   대신 takeNos 가 찬다. 화면은 그것을 보고 성공을 판정한다.
 *
 * @param p {name, phone, addr, item, memo, orglInvNos:[원송장…]}
 * @return {{ok, results, invoices, takeNos, pickReqYmd, error}}
 */
function csLogenReturnPickup(p) {
  return _lgr_pickupMany_(p);
}
