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
 *  ── 받는 곳(회수지) ─────────────────────────────────────────
 *    ★ 2026-09-08 앞서의 결정을 뒤집었다 ★
 *    처음엔 「주소는 코드에 안 박고 스크립트 속성에만 둔다, 없으면 접수를 막는다」로
 *    했다. 창고가 바뀌었을 때 배포 없이 고치려던 것이다. 그런데 그 대가로
 *    **사장님이 편집기에서 설정 함수를 세 번 실행**하셔야 했고, 세 번 다 엉뚱한
 *    함수가 돌았다. 창고는 몇 해에 한 번 바뀌고 그때는 어차피 배포가 붙는다.
 *    없는 위험을 막느라 매번 있는 수고를 시킨 셈이라 되돌린다.
 *
 *    지금:  코드에 기본값(_LRT_TO_DEFAULT_)을 둔다. 그래서 설정 없이 바로 된다.
 *           **스크립트 속성이 있으면 그쪽이 이긴다** — 창고가 바뀌면 속성만
 *           고치면 배포 없이 반영된다. 안전판은 그대로 남는다.
 *      바꾸기:  csLotteReturnSetTo('{"name":"…","tel":"…","zip":"…","addr":"…"}')
 *      되돌리기: csLotteReturnClearTo()   (기본값으로 복귀)
 *      확인:    csLotteReturnConfig()
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

/**
 * ★ 기본 회수지 — 팩투유 평택 창고 ★
 *   사장님이 준 주소: "경기도 평택시 포승읍 성해홍원로 91 팩투유" (송장에 적는 주소)
 *   우편번호 451824 는 지어낸 것이 아니라 **롯데 주소정제 API가 준 값**이다
 *   (2026-09-08 조회 · 담당 지점 「안중(대)」). 그래서 롯데가 다시 볼 때도 어긋나지 않는다.
 *   창고가 바뀌면 여기를 고치지 말고 csLotteReturnSetTo 로 속성을 넣으면 된다.
 */
var _LRT_TO_DEFAULT_ = {
  name: "팩투유",
  tel: "031-923-7795",
  zip: "451824",
  addr: "경기도 평택시 포승읍 성해홍원로 91"
};

/** 받는 곳(우리) 설정을 담는 속성 이름 — 있으면 기본값을 덮는다 */
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

/** 네 칸이 다 있는지 보고 다듬는다. 모자라면 null — 반쪽짜리는 안 쓴다. */
function _lrt_clean_(o) {
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
 * 받는 곳을 읽는다.
 * ★ 스크립트 속성이 먼저, 없으면 코드 기본값 ★
 *   속성이 깨져 있어도 기본값으로 돈다 — 회수 접수가 통째로 멈추는 것보다 낫다.
 *   어느 쪽을 썼는지는 source 로 알려 준다 (설정 화면에서 보여 준다).
 */
function _lrt_to_() {
  var raw = "";
  try {
    raw = PropertiesService.getScriptProperties().getProperty(_LRT_TO_PROP_) || "";
  } catch (e) { raw = ""; }
  if (raw) {
    var o = null;
    try { o = JSON.parse(raw); } catch (e) { o = null; }
    var got = _lrt_clean_(o);
    if (got) { got.source = "속성"; return got; }
  }
  var def = _lrt_clean_(_LRT_TO_DEFAULT_);
  if (def) def.source = "기본값";
  return def;
}

/**
 * 회수 접수를 쓸 수 있는 상태인가. 화면이 단추를 보일지 정할 때 부른다.
 * 기본 회수지가 코드에 있어 보통은 늘 준비돼 있다. 그래도 검사는 남긴다 —
 * 누군가 속성에 반쪽짜리를 넣고 기본값까지 지웠을 때 조용히 틀린 주소로
 * 나가는 것보다, 단추가 안 보이는 편이 낫다.
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

/**
 * 속성을 지워 코드 기본값(_LRT_TO_DEFAULT_)으로 되돌린다.
 * 임시로 다른 창고를 쓰다가 원래대로 돌아올 때 쓴다. 지우는 것은 이 속성 하나뿐이다.
 */
function csLotteReturnClearTo() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(_LRT_TO_PROP_);
  } catch (e) { return "속성을 못 지웠습니다: " + e.message; }
  var to = _lrt_to_();
  var L = ["기본 회수지로 되돌렸습니다"];
  if (to) {
    L.push("  " + to.name + " / " + to.tel);
    L.push("  (" + to.zip + ") " + to.addr);
  } else {
    L.push("  ★ 기본값도 비어 있습니다 — 코드를 확인하세요.");
  }
  var out = L.join("\n");
  Logger.log(out);
  return out;
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
    L.push("받는 곳  " + to.name + " / " + to.tel + "   [" + (to.source || "?") + "]");
    L.push("         (" + to.zip + ") " + to.addr);
    if (to.source === "기본값") L.push("         ※ 코드에 내장된 창고 주소입니다. 바꾸려면 csLotteReturnSetTo.");
    else L.push("         ※ 스크립트 속성이 기본값을 덮고 있습니다. csLotteReturnClearTo 로 되돌립니다.");
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
  var pZip = String(p.zip || "").replace(/[^0-9]/g, "");
  var pAddr = String(p.addr || "").trim();

  /* ★ 주문에는 우편번호가 없다 ★
     검색 결과 행(CS_ROWS)에 주소는 있어도 우편번호 칸이 아예 없다.
     그대로 두면 **모든 접수가 「우편번호 없음」으로 막힌다.**
     주소로 찾아 채운다 — 설정 때 우리 주소에 쓴 것과 같은 방법이다.
     찾아온 값은 롯데가 준 것이라 롯데가 다시 볼 때도 어긋나지 않는다. */
  var refined = null;
  if (!pZip && pAddr) {
    refined = csLotteRefineAddress({ address: pAddr, name: p.name, tel: p.phone });
    if (refined && refined.ok && refined.zipNo) {
      pZip = String(refined.zipNo).replace(/[^0-9]/g, "");
    }
  }

  var miss = [];
  if (!String(p.name || "").trim()) miss.push("고객명");
  if (!String(p.phone || "").trim()) miss.push("전화");
  if (!pAddr) miss.push("주소");
  if (!pZip) miss.push("우편번호");
  if (miss.length) {
    return {
      ok: false,
      error: "고객 " + miss.join("·") + " 이(가) 없어 접수할 수 없습니다." +
        (!pZip && pAddr && refined && refined.error
          ? " (주소로 우편번호를 못 찾았습니다: " + refined.error + ")" : "")
    };
  }

  /* 배송불가 지역이면 기사가 회수하러 못 간다. 접수를 보내기 전에 막는다 —
     보내 놓고 나중에 알면 고객에게 두 번 말해야 한다. */
  if (refined && refined.ok && !refined.deliverable) {
    return { ok: false, error: "회수 불가 지역입니다 — " + refined.dlvMsg };
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
    snperZipcd: pZip,
    snperAdr: pAddr,

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
