/**
 * ══════════════════════════════════════════════════════════════
 *  출고 주문을 로젠에 «등록»한다 — 복붙 한 번을 없앤다
 *  파일: csLogenShipRegister.gs
 *
 *  > 사장님: "주문 등록 (③)부터 해줘"   (2026-10-15)
 *
 *  지금은 사람이 세트분리 「로젠택배_출력」 탭을 복사해 로젠 화면에 붙여넣고
 *  거기서 라벨을 뽑는다. 이 파일은 그 «붙여넣기»를 registerOrderData 로 대신한다.
 *  라벨은 그대로 로젠 화면에서 뽑는다(경로 A). 송장번호 회수는 이미 돌고 있다
 *  (csLogenShipSlips.gs · inquirySlipNoMulti).
 *
 *  ★ 경로 A 는 세 걸음이고 둘이 이미 깔려 있다 ★
 *      registerOrderData  →  outSlipPrintPop  →  inquirySlipNoMulti
 *        (이 파일)            (사람이 로젠 화면)      (이미 돈다)
 *
 *  ★★ 취소 API 가 없다 ★★
 *    잘못 보내면 로젠에 «전화»해야 한다. 그래서 이 파일의 기본값은
 *    **보내지 않고 보여주기**다. 실제로 보내려면 {보냄:true} 를 손으로 준다.
 *    그리고 1시간 일감(csReturnHourlyJob)에 **일부러 안 붙였다.**
 *    사람이 눈으로 훑는 단계가 지금 복붙 전의 유일한 안전장치이고,
 *    그것을 없애면서 자동으로 보내기까지 하면 안전망이 둘 다 사라진다.
 *
 *  ─── 2026-10-15 에 실측으로 정한 것들 ───
 *
 *  ★ fixTakeNo 는 «송장키» 다 ★  (사방넷주문번호가 아니다)
 *    261015-1 회차 172줄 중 **38개 주문이 세트로 쪼개져** 있었다. 쪼개진 줄은
 *    사방넷주문번호가 같고 송장키가 `2168210706_S1` · `_S2` 로 갈린다.
 *    사방넷주문번호로 보내면 그 38개가 겹쳐 로젠이 가릴 수 없고, 송장 회수
 *    (csLogenShipSlips.gs)가 «송장키»로 묻기 때문에 영영 짝이 안 맞는다.
 *    [[logen-order-key-is-songjangkey]] · [[one-value-one-owner]]
 *
 *  ★ dlvFare 는 «계약 운임»이다 — 원장 「배송비」가 아니다 ★
 *    원장 「배송비」(= 출력 탭 「단품배송비」)는 2,200~4,000 으로 줄마다 다르다.
 *    그건 **우리가 매기는 배송비**고, 로젠에 신고하는 운임이 아니다.
 *    계약 운임은 contPickFares 가 준다 — 2026-10-15 실측 **ZW001 선불 2,200원**
 *    (착불 2,500원). 규격서 실측 기록:
 *      「계약에 없는 운임을 registReturnRequest 에 보내면 **통째로 거절**된다」
 *    이름에 끌려 3,600 을 넣으면 전건이 거절된다. 그래서 **물어서 쓴다.**
 *    못 물으면 **보내지 않는다** — 짐작한 운임을 보내지 않는다.
 *
 *  ★ boxTyCd 는 ZW001 ★ contPickFares 가 박스타입을 «한 줄»만 돌려준다.
 *    계약에 그것뿐이라는 뜻이다. 늘면 그 API 가 먼저 알려 준다.
 *
 *  ★ goodsAmt 는 아직 대표님 몫이다 ★
 *    규격상 필수가 아니다(N). 「물품금액을 무엇으로 신고하나」는 보상 한도·할증과
 *    엮이는 계약 이야기라 내가 정할 수 없다. 그래서 **기본은 안 보낸다.**
 *    정해지면 _LSR_GOODS_AMT_ 한 값만 고치면 된다 — 코드를 다시 안 짠다.
 * ══════════════════════════════════════════════════════════════
 */

/** 운임타입 — 010 선불. 우리가 운임을 낸다 */
var _LSR_FARE_TY_ = "010";

/** 박스타입 — contPickFares 가 한 줄만 돌려준다(2026-10-15 실측) */
var _LSR_BOX_TY_ = "ZW001";

/** 송하인 주소 — 출력 탭 172줄이 모두 이 한 값이었다 */
var _LSR_SND_ADDR_ = "경기도 평택시 포승읍 성해홍원로 91 팩투유";

/**
 * 물품금액을 무엇으로 신고하나.
 *
 * ★ 대표님 확인 대기 ★ 규격상 필수가 아니라 기본은 «안 보낸다».
 *   "" (빈 글)  → 안 보낸다 (지금)
 *   "합계"      → 원장 「합계」 칸을 보낸다
 *   숫자        → 모든 건에 그 값을 보낸다
 */
var _LSR_GOODS_AMT_ = "";

/** 한 번에 등록할 줄 수 — 10건씩 2초니 100건이면 20초쯤 */
var _LSR_PER_RUN_ = 100;

/** 「등록함」을 적어 두는 속성 이름머리 — 회차마다 하나 */
var _LSR_DONE_PROP_ = "LSR_DONE_";

/** 그 칸의 글자 한도 (속성 한 칸이 9KB) */
var _LSR_DONE_MAX_ = 8000;

/* ────────────────────────────────────────────────────────────────────
   들어오는 문
   ──────────────────────────────────────────────────────────────────── */

/**
 * 한 회차의 출고 주문을 로젠에 등록한다.
 *
 * @param {Object} opt
 *   회차 {string}  어느 회차인가. 없으면 원장의 «마지막» 회차
 *   보냄 {boolean} ★ true 일 때만 실제로 보낸다 ★ 기본은 보여주기만
 *   한도 {number}  이번에 볼 줄 수 (기본 _LSR_PER_RUN_)
 * @return {string} 사람이 읽는 보고
 */
function csLogenRegisterShipOrders(opt) {
  opt = opt || {};
  var 보냄 = opt["보냄"] === true;          // ★ 기본은 «안 보낸다» ★
  var 한도 = opt["한도"] > 0 ? opt["한도"] : _LSR_PER_RUN_;

  var L = ["── 출고 주문 등록 " + (보냄 ? "(실제로 보냅니다)" : "(연습 — 보내지 않습니다)") + " ──"];

  /*  ① 계약 운임을 «물어서» 쥔다. 못 물으면 여기서 멈춘다 —
      짐작한 운임을 보내면 통째로 거절된다. */
  var 운임 = _lsr_contractFare_();
  if (!(운임 > 0)) {
    var m = "★ 계약 운임을 못 물었습니다 — 보내지 않았습니다. " +
            "(contPickFares · fareTy " + _LSR_FARE_TY_ + " · boxTyCd " + _LSR_BOX_TY_ + ")";
    L.push(m); Logger.log(L.join("\n")); return L.join("\n");
  }
  L.push("계약 운임 " + 운임 + "원 (contPickFares · " + _LSR_BOX_TY_ + " · " + _LSR_FARE_TY_ + ")");

  //  ② 원장에서 그 회차의 로젠 줄을 모은다
  var 모음;
  try { 모음 = _lsr_collect_(opt["회차"], 한도); }
  catch (e) { var m2 = "NG 원장을 못 읽었습니다: " + e.message; Logger.log(m2); return m2; }

  L.push("회차 " + 모음.회차 + " · 로젠 " + 모음.로젠 + "줄 · 보낼 것 " + 모음.줄.length +
         (모음.송장있음 ? " · 송장이 이미 있어 건너뜀 " + 모음.송장있음 : "") +
         (모음.등록함 ? " · 이미 등록해 건너뜀 " + 모음.등록함 : "") +
         (모음.빈칸 ? " · ★ 칸이 비어 건너뜀 " + 모음.빈칸 : ""));

  if (모음.빈칸모습.length) {
    L.push("★ 비어서 건너뛴 줄 (사람이 봐야 합니다):");
    for (var b = 0; b < 모음.빈칸모습.length && b < 20; b++) L.push("   · " + 모음.빈칸모습[b]);
  }

  if (!모음.줄.length) {
    L.push("보낼 것이 없습니다.");
    _lsr_note_(모음.회차 + " · 보낼 것 0" + (보냄 ? "" : " (연습)"));
    Logger.log(L.join("\n")); return L.join("\n");
  }

  //  ③ 보낼 모양으로 만든다
  var 짐 = [];
  for (var i = 0; i < 모음.줄.length; i++) 짐.push(_lsr_payload_(모음.줄[i], 모음.회차, 운임));

  if (!보냄) {
    /*  ★ 연습이면 «첫 줄을 그대로» 보여 준다 ★ 무엇이 나갈지 눈으로 보지 않고
        보내는 일이 없게 한다. 취소 API 가 없으니 이것이 마지막 검문이다. */
    L.push("");
    L.push("첫 줄이 이렇게 나갑니다 (" + 짐.length + "건 중 1건):");
    L.push(JSON.stringify(짐[0], null, 1));
    L.push("");
    L.push("실제로 보내려면 csLogenRegisterShipOrders({ 보냄: true }) 로 부르세요.");
    _lsr_note_(모음.회차 + " · 연습 " + 짐.length + "건 (안 보냈습니다)");
    Logger.log(L.join("\n")); return L.join("\n");
  }

  //  ④ 보낸다 — 10건씩 2초
  var 됨 = 0, 안됨 = 0, 된키 = [];
  var 시작 = new Date().getTime();
  for (var s = 0; s < 짐.length; s += _LOGEN_BATCH_SIZE_) {
    if (s > 0) {
      if ((new Date().getTime() - 시작) > _LOGEN_TIME_BUDGET_MS_) {
        L.push("★ 시간이 모자라 " + (짐.length - s) + "건은 다음에 보냅니다");
        break;
      }
      try { Utilities.sleep(_LOGEN_BATCH_DELAY_MS_); } catch (e) {}
    }
    var chunk = 짐.slice(s, s + _LOGEN_BATCH_SIZE_);
    var r = _logen_call_("registerOrderData", { userId: _logen_userId_(), data: chunk });
    if (!r.ok) {
      안됨 += chunk.length;
      L.push("   호출 실패 " + chunk.length + "건: " + r.error);
      continue;
    }
    var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
    var 본것 = {};
    for (var k = 0; k < rows.length; k++) {
      var d = rows[k] || {};
      var key = String(d.fixTakeNo == null ? "" : d.fixTakeNo).trim();
      if (key) 본것[key] = true;
      if (_logen_ok_(d.resultCd)) { 됨++; if (key) 된키.push(key); }
      else {
        안됨++;
        L.push("   · " + (key || "(번호 없음)") + " — " +
               (_logen_blank_(d.resultMsg) ? "등록 실패" : String(d.resultMsg)));
      }
    }
    /*  ★ 응답에 안 실려 온 것을 «됨»으로 세지 않는다 ★
        모르는 것과 된 것은 다르다. [[dont-overwrite-what-you-couldnt-read]] */
    for (var m3 = 0; m3 < chunk.length; m3++) {
      if (!본것[chunk[m3].fixTakeNo]) {
        안됨++;
        L.push("   · " + chunk[m3].fixTakeNo + " — 응답에 없습니다 (됨으로 세지 않습니다)");
      }
    }
  }

  //  ⑤ 된 것만 「등록함」에 적는다 — 다시 돌려도 두 번 안 보낸다
  if (된키.length) _lsr_markDone_(모음.회차, 된키);

  L.push("");
  L.push("등록 " + 됨 + " · 실패 " + 안됨);
  if (됨) {
    L.push("이제 로젠 화면에서 라벨을 뽑으세요. 송장번호는 「출고 송장 받아오기」가" +
           " 1시간 일감에서 저절로 가져옵니다(csLogenShipSlips.gs).");
  }
  _lsr_note_(모음.회차 + " · 등록 " + 됨 + " · 실패 " + 안됨);
  Logger.log(L.join("\n"));
  return L.join("\n");
}

/** 손으로 돌려 보는 용 — 무엇이 나갈지만 본다 */
function csLogenRegisterShipPreview() {
  return csLogenRegisterShipOrders({ 보냄: false });
}

/* ────────────────────────────────────────────────────────────────────
   계약 운임
   ──────────────────────────────────────────────────────────────────── */

/**
 * 출고 계약 운임을 로젠에 묻는다 — contPickFares.
 *
 * ★ 이 값의 주인은 로젠 계약이다 ★ 코드에 숫자로 박으면 계약이 바뀌는 날
 *   조용히 전건이 거절된다. 그래서 묻고, 한 실행에 한 번만 외운다
 *   ([[gas-service-calls-in-loops]]).
 *
 * @return {number} 운임. 못 물었으면 0
 */
var _LSR_FARE_CACHE_ = 0;

function _lsr_contractFare_() {
  if (_LSR_FARE_CACHE_ > 0) return _LSR_FARE_CACHE_;
  try {
    var r = _logen_call_("contPickFares", {
      userId: _logen_userId_(),
      data: [{ custCd: _logen_custCd_(), fareTy: _LSR_FARE_TY_ }]
    });
    /*  ★ 이 API 에는 resultCd 가 «없다» ★ 규격서 2장 — sttsCd 만 온다.
        resultCd 하나로 성공을 판정하면 여기서 깨진다. */
    if (!r.ok) return 0;
    var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
    for (var i = 0; i < rows.length; i++) {
      var inner = _logen_arr_(rows[i] && rows[i].data1);
      var 볼것 = inner.length ? inner : [rows[i]];
      for (var j = 0; j < 볼것.length; j++) {
        var x = 볼것[j] || {};
        if (String(x.boxTyCd || "").trim() &&
            String(x.boxTyCd).trim() !== _LSR_BOX_TY_) continue;
        var f = parseInt(String(x.dlvFare == null ? "" : x.dlvFare).replace(/[^0-9]/g, ""), 10);
        if (f > 0) { _LSR_FARE_CACHE_ = f; return f; }
      }
    }
  } catch (e) { /* 못 물었다 */ }
  return 0;
}

/* ────────────────────────────────────────────────────────────────────
   원장에서 모으기
   ──────────────────────────────────────────────────────────────────── */

/**
 * 원장에서 그 회차의 로젠 줄을 모은다.
 *
 * ★ 건너뛰는 세 가지 ★
 *   ① 운송장번호가 이미 있다 → 벌써 나간 건이다
 *   ② 「등록함」에 적혀 있다  → 이번 회차에 이미 보냈다 (두 번 보내지 않는다)
 *   ③ 필수 칸이 비었다      → 지어내지 않는다. 사람이 봐야 한다
 */
function _lsr_collect_(회차, 한도) {
  var ss = SpreadsheetApp.openById(_CS_LEDGER_SS_ID_);
  var tab = ss.getSheetByName("주문라인원장");
  if (!tab) throw new Error("「주문라인원장」 탭이 없습니다");

  var lastRow = tab.getLastRow();
  if (lastRow < 2) return { 회차: "", 로젠: 0, 줄: [], 송장있음: 0, 등록함: 0, 빈칸: 0, 빈칸모습: [] };
  var lastCol = tab.getLastColumn();

  var head = tab.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var c = {};
  for (var h = 0; h < head.length; h++) {
    var nm = String(head[h] || "").trim();
    if (nm === "회차키") c.round = h;
    else if (nm === "경로") c.path = h;
    else if (nm === "택배사") c.carrier = h;
    else if (nm === "송장키") c.key = h;
    else if (nm === "운송장번호") c.inv = h;
    else if (nm === "거래처명") c.rcvNm = h;
    else if (nm === "주소1") c.rcvAddr = h;
    else if (nm === "전화") c.tel = h;
    else if (nm === "모바일") c.cell = h;
    else if (nm === "보내는분") c.sndNm = h;
    else if (nm === "보내는분전화") c.sndTel = h;
    else if (nm === "택배박스수량") c.box = h;
    else if (nm === "수량") c.qty = h;
    else if (nm === "출력품목명") c.goods = h;
    else if (nm === "배송메시지") c.msg = h;
    else if (nm === "합계") c.sum = h;
    else if (nm === "도선료") c.ferry = h;
  }
  if (c.key == null) throw new Error("「송장키」 열을 못 찾았습니다");
  if (c.round == null) throw new Error("「회차키」 열을 못 찾았습니다");

  var from = Math.max(2, lastRow - 8000 + 1);
  var 값 = tab.getRange(from, 1, lastRow - from + 1, lastCol).getDisplayValues();

  //  회차를 안 주면 «마지막» 회차
  var 그회차 = String(회차 || "").trim();
  if (!그회차) {
    for (var z = 값.length - 1; z >= 0; z--) {
      var rk = String(값[z][c.round] || "").trim();
      if (rk) { 그회차 = rk; break; }
    }
  }

  var 이미 = _lsr_doneSet_(그회차);
  var out = [], 로젠 = 0, 송장있음 = 0, 등록함 = 0, 빈칸 = 0, 빈칸모습 = [];

  for (var i = 0; i < 값.length; i++) {
    var r = 값[i];
    if (String(r[c.round] || "").trim() !== 그회차) continue;

    /*  갓 돌린 회차는 택배사가 비어 「경로」를 봐야 한다 — csLogenShipSlips.gs 와
        같은 자를 쓴다. 여기서 다시 짜면 둘이 갈라진다. */
    if (!_ls_isLogenRow_(c.path != null ? r[c.path] : "",
                         c.carrier != null ? r[c.carrier] : "")) continue;
    로젠++;

    var key = String(r[c.key] || "").trim();
    if (!key) { 빈칸++; 빈칸모습.push("(송장키 없음) " + String(r[c.rcvNm] || "")); continue; }
    if (String(r[c.inv] || "").replace(/[^0-9]/g, "")) { 송장있음++; continue; }
    if (이미[key]) { 등록함++; continue; }

    var 한줄 = {
      key: key,
      rcvNm: String(r[c.rcvNm] || "").trim(),
      rcvAddr: String(r[c.rcvAddr] || "").trim(),
      tel: String(r[c.tel] || "").trim(),
      cell: String(r[c.cell] || "").trim(),
      sndNm: String(r[c.sndNm] || "").trim(),
      sndTel: String(r[c.sndTel] || "").trim(),
      box: parseInt(String(r[c.box] || "0").replace(/[^0-9]/g, ""), 10) || 0,
      qty: parseInt(String(r[c.qty] || "0").replace(/[^0-9]/g, ""), 10) || 0,
      goods: String(r[c.goods] || "").trim(),
      msg: String(r[c.msg] || "").trim(),
      sum: parseInt(String(r[c.sum] || "0").replace(/[^0-9]/g, ""), 10) || 0,
      ferry: parseInt(String(r[c.ferry] || "0").replace(/[^0-9]/g, ""), 10) || 0
    };

    /*  ★ 필수 칸이 비면 지어내지 않는다 ★ 이름·주소·연락처는 로젠이 필수로
        받는 것이고, 비워 보내면 그 건만 거절되거나 더 나쁘게 엉뚱한 데로 간다.
        2026-10-15 실측에서는 172줄 모두 채워져 있었다 — 그래도 울타리를 둔다. */
    var 없는것 = [];
    if (!한줄.rcvNm) 없는것.push("거래처명");
    if (!한줄.rcvAddr) 없는것.push("주소1");
    if (!한줄.tel && !한줄.cell) 없는것.push("전화·모바일");
    if (!한줄.sndNm) 없는것.push("보내는분");
    if (한줄.box < 1) 없는것.push("택배박스수량");
    if (없는것.length) {
      빈칸++;
      빈칸모습.push(key + " — " + 없는것.join("·") + " 없음");
      continue;
    }

    out.push(한줄);
    if (out.length >= 한도) break;
  }

  return { 회차: 그회차, 로젠: 로젠, 줄: out,
           송장있음: 송장있음, 등록함: 등록함, 빈칸: 빈칸, 빈칸모습: 빈칸모습 };
}

/* ────────────────────────────────────────────────────────────────────
   보낼 모양
   ──────────────────────────────────────────────────────────────────── */

/**
 * 한 줄을 registerOrderData 가 받는 모양으로.
 *
 * ★ slipNo 는 «공백»으로 보낸다 ★ 규격 5.1 — 우리가 번호를 정하지 않는다.
 * ★ fixTakeNo 는 송장키 ★ 이 파일 머리말의 까닭을 보라.
 */
function _lsr_payload_(x, 회차, 운임) {
  var p = {
    custCd: _logen_custCd_(),
    takeDt: _lsr_takeDt_(회차),
    slipNo: "",
    fixTakeNo: x.key,
    sndCustNm: x.sndNm,
    sndCustAddr: _LSR_SND_ADDR_,
    rcvCustNm: x.rcvNm,
    rcvCustAddr: x.rcvAddr,
    fareTy: _LSR_FARE_TY_,
    boxTyCd: _LSR_BOX_TY_,
    qty: x.box,
    dlvFare: 운임,
    goodsNm: x.goods,
    inQty: x.qty > 0 ? x.qty : 1
  };
  if (x.sndTel) p.sndTelNo = x.sndTel;

  /*  ★ 같은 번호를 두 칸에 넣지 않는다 ★ 규격은 「택1」이다(둘 중 하나면 된다).
      2026-10-15 실측에서 원장 「전화」와 「모바일」이 같은 값인 줄이 흔했다.
      그대로 보내면 라벨에 같은 번호가 두 번 찍힐 수 있다 — 보내는 값은
      적을수록 틀릴 데가 적다. 모바일을 먼저 쓰고, 전화는 «다를 때만» 더한다. */
  if (x.cell) p.rcvCellNo = x.cell;
  if (x.tel && _lsr_digits_(x.tel) !== _lsr_digits_(x.cell)) p.rcvTelNo = x.tel;
  if (x.msg) p.sndMsg = x.msg;
  if (x.ferry > 0) p.extraFare = x.ferry;

  /*  ★ 물품금액은 대표님이 정하실 때까지 안 보낸다 ★ 규격상 필수가 아니다.
      정해지면 _LSR_GOODS_AMT_ 한 값만 고친다 — 코드를 다시 안 짠다. */
  var g = String(_LSR_GOODS_AMT_ || "").trim();
  if (g === "합계") { if (x.sum > 0) p.goodsAmt = x.sum; }
  else if (/^[0-9]+$/.test(g)) { p.goodsAmt = parseInt(g, 10); }

  return p;
}

/** 번호에서 숫자만 — 「010-6462-3938」과 「01064623938」을 같게 본다 */
function _lsr_digits_(v) {
  return String(v == null ? "" : v).replace(/[^0-9]/g, "");
}

/** 회차키 「261015-1」 → 접수일자 「20261015」 */
function _lsr_takeDt_(회차) {
  var m = String(회차 || "").trim().match(/^(\d{2})(\d{2})(\d{2})/);
  if (!m) return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  return "20" + m[1] + m[2] + m[3];
}

/* ────────────────────────────────────────────────────────────────────
   「등록함」 적어 두기 — 두 번 보내지 않는다
   ──────────────────────────────────────────────────────────────────── */

/** 그 회차에 이미 등록한 송장키 표 */
function _lsr_doneSet_(회차) {
  var out = {};
  try {
    var raw = PropertiesService.getScriptProperties()
      .getProperty(_LSR_DONE_PROP_ + 회차) || "";
    var a = raw.split("|");
    for (var i = 0; i < a.length; i++) { var k = a[i].trim(); if (k) out[k] = true; }
  } catch (e) {}
  return out;
}

/**
 * 등록한 송장키를 덧붙여 적는다.
 *
 * ★ 적는 순간에 다시 읽는다 ★ 두 실행이 겹치면 한쪽이 상대가 적은 것을 지운다.
 *   보내는 일은 돌이킬 수 없으니, 적는 쪽이 조금 비싸도 다시 읽는다.
 */
function _lsr_markDone_(회차, 키들) {
  try {
    var P = PropertiesService.getScriptProperties();
    var 이름 = _LSR_DONE_PROP_ + 회차;
    var 지금 = P.getProperty(이름) || "";
    var 있는것 = _lsr_doneSet_(회차);
    var 더할것 = [];
    for (var i = 0; i < 키들.length; i++) {
      var k = String(키들[i] || "").trim();
      if (k && !있는것[k]) { 있는것[k] = true; 더할것.push(k); }
    }
    if (!더할것.length) return;
    var s = (지금 ? 지금 + "|" : "") + 더할것.join("|");
    /*  한도를 넘으면 «앞»을 버린다. 버려진 것은 운송장번호가 붙어 걸러지므로
        두 번 보내는 사고로 이어지지 않는다 — 다만 적어 둔다. */
    while (s.length > _LSR_DONE_MAX_) {
      var i2 = s.indexOf("|");
      if (i2 < 0) break;
      s = s.slice(i2 + 1);
    }
    P.setProperty(이름, s);
  } catch (e) { /* 못 적어도 운송장번호가 다음 울타리다 */ }
}

/** 운영점검 「출고 주문 등록」 한 줄 */
function _lsr_note_(글) {
  try {
    _cpr_ops_(SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_), "출고 주문 등록", 글);
  } catch (e) {}
}
