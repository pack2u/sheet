/**
 * ══════════════════════════════════════════════════════════════
 *  롯데 회수(반품) 접수
 *  ★ 2026-09-08 신규
 *
 *  여태 반품대장은 「반품이 있었다」는 **기록**일 뿐이었고, 실제 회수 접수는
 *  사람이 롯데 ALPS 화면에서 따로 했다. 그래서 대장 929건 중 반품송장이
 *  적힌 것이 **5건**뿐이고 「수거입력처」의 94%가 비어 있었다.
 *
 *  여기서 접수까지 보내고, 롯데가 채번한 반품송장을 그대로 대장에 적는다.
 *
 *  규격: 롯데택배_OpenAPI_규격.md §3.3 — 출고와 반품이 같은 API 다.
 *        POST /api/pid/cus/714a/apiSndOut · ustRtgSctCd "02" 가 반품.
 *
 *  ── 사장님이 정해 주신 것 (2026-09-08) ─────────────────────────
 *    송하인   주문 고객 (주문 정보에서 자동)
 *    운임     신용  → fareSctCd "03"
 *    박스크기 기본값 우선 → _LRT_BOX_DEFAULT_
 *    집하요청 다음 영업일
 *    확인창   필수 · 하단에 접수자(로그인 이름) 표시
 *
 *  ★ 받는 주소는 코드에 안 박는다 ★
 *    실제로 기사가 찾아가는 주소다. 코드에 박아 두면 창고가 바뀌었을 때
 *    배포를 해야 하고, 그 사이 물건이 엉뚱한 데로 간다.
 *    **스크립트 속성**에 두고, 없으면 접수 자체를 막는다.
 *      설정:  csLotteReturnSetTo('{"name":"…","tel":"…","zip":"…","addr":"…"}')
 *      확인:  csLotteReturnConfig()
 * ══════════════════════════════════════════════════════════════
 */

/** 거래처코드 (6자리 택배코드). 운영 기준 — 규격 문서 §2 참고. */
var _LRT_CUST_CD_ = "348782";

/** 출고반품구분 — 02 가 반품이다. 01 을 보내면 **출고가 나간다.** */
var _LRT_SCT_RETURN_ = "02";

/** 운임구분 03 = 신용. 사장님 지시 (2026-09-08). */
var _LRT_FARE_CREDIT_ = "03";

/** 오더구분 1 = 일반. 내부 확인용이고 프로세스는 안 바뀐다. */
var _LRT_ORD_SCT_ = "1";

/** 박스크기 기본값. A~F 중 하나여야 한다. */
var _LRT_BOX_DEFAULT_ = "C";

/** 받는 곳(우리) 설정을 담는 속성 이름 */
var _LRT_TO_PROP_ = "LOTTE_RETURN_TO";

/** 임시공휴일을 더 넣는 속성 (yyyyMMdd 를 쉼표로) */
var _LRT_HOLIDAY_PROP_ = "LOTTE_EXTRA_HOLIDAYS";

/**
 * 고정 공휴일.
 * ★ 허브(_partnerHelpers.gs)에도 같은 표가 있다 ★
 *   프로젝트가 달라 함수를 못 부른다. 두 벌인 것을 알고 둔다 —
 *   여기 쓰임은 「집하요청일을 하루 미룬다」뿐이라 하루 어긋나도 사고가 아니고,
 *   허브를 부르려고 웹앱 왕복을 넣는 편이 더 잘 깨진다.
 *   연말에 다음 해를 더할 때 양쪽을 같이 본다.
 */
var _LRT_HOLIDAYS_ = {
  "20260101": 1, "20260216": 1, "20260217": 1, "20260218": 1,
  "20260301": 1, "20260302": 1, "20260505": 1, "20260524": 1, "20260525": 1,
  "20260606": 1, "20260717": 1, "20260815": 1,
  "20260924": 1, "20260925": 1, "20260926": 1,
  "20261003": 1, "20261009": 1, "20261225": 1
};

/** 받는 곳 설정을 읽는다. 없거나 모자라면 null. */
function _lrt_to_() {
  var raw = "";
  try {
    raw = PropertiesService.getScriptProperties().getProperty(_LRT_TO_PROP_) || "";
  } catch (e) { return null; }
  if (!raw) return null;
  var o;
  try { o = JSON.parse(raw); } catch (e) { return null; }
  if (!o) return null;
  var need = ["name", "tel", "zip", "addr"];
  for (var i = 0; i < need.length; i++) {
    if (!String(o[need[i]] || "").trim()) return null;
  }
  return {
    name: String(o.name).trim(),
    tel: String(o.tel).trim(),
    zip: String(o.zip).replace(/[^0-9]/g, ""),
    addr: String(o.addr).trim()
  };
}

/**
 * 회수 접수를 쓸 수 있는 상태인가. 화면이 단추를 보일지 정할 때 부른다.
 * ★ 받는 주소가 없으면 아예 안 보여준다 ★ — 눌렀다가 실패하는 것보다 낫다.
 */
function csLotteReturnReady() {
  var to = _lrt_to_();
  return {
    ready: !!to,
    to: to ? { name: to.name, addr: to.addr } : null,
    reason: to ? "" : "받는 곳(창고)이 설정되지 않았습니다. 관리자에게 csLotteReturnSetTo 실행을 요청하세요."
  };
}

/**
 * 편집기에서 한 번 실행해 받는 곳을 정한다.
 *
 * ★ 우편번호는 안 적어도 된다 ★
 *   비워 두면 롯데 주소정제(csLotteRefineAddress)로 채운다. 사람이 우편번호를
 *   찾아 오는 수고를 덜고, **주소와 어긋난 우편번호가 들어가는 것**도 막는다.
 *   정제가 실패하면 그때는 적어 달라고 말한다 — 몰래 빈 채로 두지 않는다.
 */
function csLotteReturnSetTo(json) {
  if (!json) {
    return "사용법 (우편번호는 비워도 됩니다 — 주소로 찾아 넣습니다):\n" +
      "csLotteReturnSetTo('{\"name\":\"주식회사 팩투유\",\"tel\":\"031-923-7795\"," +
      "\"addr\":\"경기 평택시 포승읍 석정리 369\"}')";
  }
  var o;
  try { o = typeof json === "string" ? JSON.parse(json) : json; }
  catch (e) { return "JSON 을 못 읽었습니다: " + e.message; }
  o = o || {};

  var addr = String(o.addr || "").trim();
  var zip = String(o.zip || "").replace(/[^0-9]/g, "");
  var note = "";

  if (!zip && addr) {
    var ref = csLotteRefineAddress({ address: addr, name: o.name, tel: o.tel });
    if (ref && ref.ok && ref.zipNo) {
      zip = String(ref.zipNo).replace(/[^0-9]/g, "");
      note = "\n  (우편번호는 롯데 주소정제로 찾았습니다" +
        (ref.branchNm ? " · 담당 " + ref.branchNm : "") + ")";
      /* 배송불가 지역이면 회수도 못 온다. 설정 단계에서 말해 준다 —
         접수를 눌렀을 때 알게 되면 이미 늦다. */
      if (!ref.deliverable) note += "\n  ⚠ 배송불가 안내: " + ref.dlvMsg;
    } else {
      return "우편번호를 못 찾았습니다 (" + ((ref && ref.error) || "주소정제 실패") + ").\n" +
        "zip 을 직접 넣어 다시 실행해 주세요.";
    }
  }

  o.zip = zip;
  o.addr = addr;
  PropertiesService.getScriptProperties()
    .setProperty(_LRT_TO_PROP_, JSON.stringify(o));
  var chk = _lrt_to_();
  if (!chk) return "네 칸(name·tel·zip·addr)이 모두 있어야 합니다. 지금 값: " + JSON.stringify(o);
  return "받는 곳 설정됨\n" +
    "  이름  " + chk.name + "\n  전화  " + chk.tel + "\n" +
    "  우편  " + chk.zip + "\n  주소  " + chk.addr + note;
}

/** 지금 설정을 사람이 읽는 형태로 */
function csLotteReturnConfig() {
  var to = _lrt_to_();
  var L = ["── 롯데 회수 접수 설정 ──",
    "거래처코드  " + _LRT_CUST_CD_,
    "운임        신용(" + _LRT_FARE_CREDIT_ + ")",
    "박스 기본   " + _LRT_BOX_DEFAULT_,
    ""];
  if (!to) {
    L.push("★ 받는 곳이 없습니다 — 접수 단추가 안 나옵니다.");
    L.push("  csLotteReturnSetTo('{\"name\":…,\"tel\":…,\"zip\":…,\"addr\":…}') 로 넣으세요.");
  } else {
    L.push("받는 곳  " + to.name + " / " + to.tel);
    L.push("         (" + to.zip + ") " + to.addr);
  }
  L.push("");
  L.push("다음 영업일  " + _lrt_nextBusinessDay_());
  var out = L.join("\n");
  Logger.log(out);
  return out;
}

/** yyyyMMdd 가 쉬는 날인가 — 토·일 + 공휴일표 + 임시공휴일 속성 */
function _lrt_isOff_(d) {
  var day = d.getDay();
  if (day === 0 || day === 6) return true;
  var ymd = Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd");
  if (_LRT_HOLIDAYS_[ymd]) return true;
  try {
    var extra = PropertiesService.getScriptProperties()
      .getProperty(_LRT_HOLIDAY_PROP_) || "";
    if (extra && extra.indexOf(ymd) !== -1) return true;
  } catch (e) { /* 속성을 못 읽어도 주말 판단은 살아 있다 */ }
  return false;
}

/**
 * 다음 영업일 (yyyyMMdd). 사장님 지시 — 집하요청일은 다음 영업일.
 * 오늘이 금요일이면 월요일, 연휴면 연휴 다음 날.
 * 열흘을 넘겨 못 찾으면 그냥 내일을 준다 — 접수를 막느니 하루 어긋나는 편이 낫다.
 */
function _lrt_nextBusinessDay_(from) {
  var d = from ? new Date(from.getTime()) : new Date();
  for (var i = 0; i < 10; i++) {
    d.setDate(d.getDate() + 1);
    if (!_lrt_isOff_(d)) return Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd");
  }
  var t = from ? new Date(from.getTime()) : new Date();
  t.setDate(t.getDate() + 1);
  return Utilities.formatDate(t, "Asia/Seoul", "yyyyMMdd");
}

/**
 * 회수 접수 한 건.
 *
 * @param {Object} p {name, phone, zip, addr, item, qty, orderNo, orglInvNo, memo, boxType}
 *   name·phone·zip·addr 는 **고객**(보내는 사람) 것이다.
 * @return {{ok:boolean, invoice:string, error:string, pickReqYmd:string}}
 */
function csLotteReturnPickup(p) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return { ok: false, error: "권한이 없습니다." };
  p = p || {};

  var to = _lrt_to_();
  if (!to) {
    return { ok: false, error: "받는 곳(창고)이 설정되지 않았습니다. csLotteReturnSetTo 를 먼저 실행하세요." };
  }

  /* 보내는 사람 = 고객. 이 넷이 없으면 기사가 못 간다.
     ★ 지어내지 않는다 ★ 주소가 비었는데 접수하면 기사가 헛걸음한다. */
  var miss = [];
  if (!String(p.name || "").trim()) miss.push("고객명");
  if (!String(p.phone || "").trim()) miss.push("전화");
  if (!String(p.zip || "").replace(/[^0-9]/g, "")) miss.push("우편번호");
  if (!String(p.addr || "").trim()) miss.push("주소");
  if (miss.length) {
    return { ok: false, error: "고객 " + miss.join("·") + " 이(가) 없어 접수할 수 없습니다." };
  }

  var pickYmd = _lrt_nextBusinessDay_();
  var box = String(p.boxType || _LRT_BOX_DEFAULT_).toUpperCase();
  if (!/^[A-F]$/.test(box)) box = _LRT_BOX_DEFAULT_;

  var one = {
    jobCustCd: _LRT_CUST_CD_,
    ustRtgSctCd: _LRT_SCT_RETURN_,   // 02 = 반품
    ordSct: _LRT_ORD_SCT_,
    fareSctCd: _LRT_FARE_CREDIT_,    // 03 = 신용
    ordNo: String(p.orderNo || "").trim() ||
           ("RT" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss")),
    // invNo 는 비워 보낸다 — 롯데가 채번해 돌려준다
    orglInvNo: String(p.orglInvNo || "").replace(/[^0-9]/g, "").slice(0, 12),

    // 보내는 사람 = 고객
    snperNm: String(p.name).trim(),
    snperTel: String(p.phone).trim(),
    snperCpno: String(p.phone).trim(),
    snperZipcd: String(p.zip).replace(/[^0-9]/g, ""),
    snperAdr: String(p.addr).trim(),

    // 받는 사람 = 우리
    acperNm: to.name,
    acperTel: to.tel,
    acperZipcd: to.zip,
    acperAdr: to.addr,

    boxTypCd: box,
    gdsNm: String(p.item || "반품").trim().slice(0, 750),
    ispdQty: parseInt(String(p.qty || "1").replace(/[^0-9]/g, ""), 10) || 1,
    dlvMsgCont: String(p.memo || "").trim().slice(0, 200),
    pickReqYmd: pickYmd
  };

  var res = _lotte_call_("post", "/api/pid/cus/714a/apiSndOut", { snd_list: [one] });
  if (!res.ok) return { ok: false, error: res.error || "접수 실패", pickReqYmd: pickYmd };

  var j = res.json || {};
  var list = j.rtn_list || [];
  var r0 = list[0] || {};
  if (String(r0.rtnCd || "") !== "S") {
    return {
      ok: false,
      error: String(r0.rtnMsg || j.message || "접수 거부"),
      pickReqYmd: pickYmd
    };
  }
  return {
    ok: true,
    invoice: String(r0.invNo || "").trim(),
    ordNo: one.ordNo,
    pickReqYmd: pickYmd,
    error: ""
  };
}
