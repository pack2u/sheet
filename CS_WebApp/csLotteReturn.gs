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
 * 회수 접수.
 *
 * ★ 2026-09-09: 원송장이 여럿이면 **그 수만큼 접수한다** ★
 *   여태 orglInvNo 를 하나만 받아 한 건만 보냈다. 그런데 확인창은
 *   원송장 두 개를 다 보여 줬다 —
 *     김순숙 / JH 샐러드 203 투명 600세트
 *     원송장 268334465991 · 268334466013  (2박스)
 *   사람은 두 박스가 다 회수된다고 믿고 눌렀는데 **한 박스만 접수됐다.**
 *   나머지 한 박스는 고객 집에 그대로 남는다. 화면이 약속한 것과
 *   실제로 한 일이 달랐다 — 조용히 물건을 잃는 종류의 오류다.
 *
 *   회수 운송장은 박스마다 하나씩 붙는다. 그러니 원송장 하나에 접수 하나다.
 *
 * ★ 한 건씩 따로 보낸다 ★
 *   snd_list 에 여럿을 담아 한 번에 보낼 수도 있지만, 그러면 rtn_list 의
 *   순서에 기대어 결과를 짝지어야 한다. **어느 박스가 실패했는지**를
 *   순서로 짐작하고 싶지 않다. 한 건씩 보내면 짝이 확실하다.
 *   반품 접수는 하루 몇 건이라 호출 수는 문제가 안 된다.
 *
 * ★ 반쯤 성공을 숨기지 않는다 ★
 *   둘 중 하나만 됐으면 그대로 돌려준다. 「실패」로 뭉뚱그리면 사람이
 *   다시 눌러 **이미 접수된 박스를 두 번 접수한다.**
 *
 * @param {Object} p {name, phone, zip, addr, item, qty, orderNo, orglInvNo, orglInvNos, memo, boxType}
 *   name·phone·zip·addr 는 **고객**(보내는 사람) 것이다.
 *   orglInvNos 가 있으면 그것을, 없으면 orglInvNo 하나를 쓴다.
 * @return {{ok:boolean, invoice:string, invoices:Array, results:Array, error:string, pickReqYmd:string}}
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

  /* 접수할 원송장들. 중복은 지운다 — 같은 박스를 두 번 부르면 기사도 헷갈리고
     회수 라벨도 두 장 나온다. 원송장을 하나도 못 받으면 빈 것 하나로 간다
     (원송장 없이 회수하는 건도 있다 — 업체가 송장을 모르는 경우). */
  var srcList = [];
  if (p.orglInvNos && p.orglInvNos.length) srcList = p.orglInvNos;
  else if (p.orglInvNo) srcList = [p.orglInvNo];

  var origs = [];
  var seen = {};
  for (var s = 0; s < srcList.length; s++) {
    var d = String(srcList[s] || "").replace(/[^0-9]/g, "").slice(0, 12);
    if (!d || seen[d]) continue;
    seen[d] = true;
    origs.push(d);
  }
  if (!origs.length) origs = [""];

  var stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss");
  var baseOrd = String(p.orderNo || "").trim() || ("RT" + stamp);

  var results = [];
  var invoices = [];
  var fails = [];

  for (var k = 0; k < origs.length; k++) {
    /* ★ 주문번호는 박스마다 달라야 한다 ★
       같은 ordNo 로 두 번 보내면 롯데가 중복으로 보고 거절하거나,
       받아 주더라도 둘이 한 건으로 묶인다. 박스 번호를 뒤에 붙인다. */
    var ordNo = origs.length > 1 ? (baseOrd + "-" + (k + 1)) : baseOrd;

    var one = {
      jobCustCd: _LRT_CUST_CD_,
      ustRtgSctCd: _LRT_SCT_RETURN_,   // 02 = 반품
      ordSct: _LRT_ORD_SCT_,
      fareSctCd: _LRT_FARE_CREDIT_,    // 03 = 신용
      ordNo: ordNo,
      // invNo 는 비워 보낸다 — 롯데가 채번해 돌려준다
      orglInvNo: origs[k],

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
      /* 박스가 여럿이면 라벨에 몇 번째인지 적는다 — 창고에서 두 박스가
         따로 도착하므로, 한 짝이 덜 왔는지 알 수 있어야 한다. */
      gdsNm: (String(p.item || "반품").trim() +
              (origs.length > 1 ? " (" + (k + 1) + "/" + origs.length + ")" : "")).slice(0, 750),
      /* ★ 수량은 박스마다 1 로 둔다 ★
         품목 수량(예: 600세트)이 두 박스에 어떻게 나뉘었는지 우리는 모른다.
         양쪽에 600 을 적으면 1200 처럼 보인다. 라벨의 수량은 박스 수를
         뜻하는 자리라, 한 박스면 1 이다. 진짜 수량은 gdsNm 과 대장에 남는다. */
      ispdQty: origs.length > 1
        ? 1
        : (parseInt(String(p.qty || "1").replace(/[^0-9]/g, ""), 10) || 1),
      dlvMsgCont: String(p.memo || "").trim().slice(0, 200),
      pickReqYmd: pickYmd
    };

    var res = _lotte_call_("post", "/api/pid/cus/714a/apiSndOut", { snd_list: [one] });
    var row = { orglInvNo: origs[k], ordNo: ordNo, ok: false, invoice: "", error: "" };

    if (!res.ok) {
      row.error = res.error || "접수 실패";
    } else {
      var j = res.json || {};
      var r0 = (j.rtn_list || [])[0] || {};
      if (String(r0.rtnCd || "") !== "S") {
        row.error = String(r0.rtnMsg || j.message || "접수 거부");
      } else {
        row.ok = true;
        row.invoice = String(r0.invNo || "").trim();
        invoices.push(row.invoice);
      }
    }
    if (!row.ok) fails.push((row.orglInvNo || "(원송장없음)") + " — " + row.error);
    results.push(row);
  }

  /* 반쯤 성공했으면 그대로 말한다. 성공한 송장을 반드시 함께 돌려줘야
     사람이 다시 눌러 같은 박스를 두 번 접수하는 일이 없다. */
  return {
    ok: fails.length === 0,
    invoice: invoices[0] || "",     // 예전 호출부 호환
    invoices: invoices,
    results: results,
    ordNo: baseOrd,
    pickReqYmd: pickYmd,
    error: fails.length
      ? (invoices.length
          ? "일부만 접수됐습니다 (" + invoices.length + "/" + origs.length + "). 실패: " + fails.join(" · ")
          : fails.join(" · "))
      : ""
  };
}

/**
 * ══════════════════════════════════════════════════════════════
 *  반품 카드에서 바로 회수 접수 — 2026-09-09
 *
 *  > "반품 카드에서 업체가 등록한거라 반품접수(롯데택배일경우만) 클릭해서
 *  >  반품접수해야 될꺼 같아. 우리가 하던 업체에서 바로 하던..
 *  >  반품 접수가 된건 표시도 되어야 할꺼 같고"
 *
 *  ★ 왜 따로 만드나 ★
 *    기존 접수는 **주문 카드**에서 시작한다. 거기에는 주소가 있다.
 *    그런데 업체가 직접 올린 반품은 주문 카드를 안 거치고 대장에 바로 꽂힌다.
 *    반품대장에는 **주소 칸이 없다.** 그래서 카드만 보고는 접수를 못 했다.
 *    여기서 원송장으로 주문을 되짚어 주소를 찾아 준다.
 *
 *  ★ 두 번 접수하지 않는다 ★
 *    반품송장이 이미 적혀 있으면 접수된 것이다. 거절한다.
 *    기사가 두 번 가고 회수 라벨이 두 장 나오는 일을 막는다.
 *
 *  ★ 접수하고 나면 대장에 바로 적는다 ★
 *    안 적으면 화면에 「접수됨」이 안 뜨고, 다음 사람이 또 누른다.
 * ══════════════════════════════════════════════════════════════
 *
 * @param {Object} p {tab, row, memo, boxType}
 */
function csLotteReturnPickupFromCard(p) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return { ok: false, error: "권한이 없습니다." };
  p = p || {};

  var ctx;
  try {
    ctx = _cs_openReturnLedgerRow_(p.tab, p.row);
  } catch (e) {
    return { ok: false, error: "대장 줄을 못 열었습니다: " + e.message };
  }
  var col = ctx.col, row = ctx.row;
  var cell = function (f) { return col[f] >= 0 ? String(row[col[f]] || "").trim() : ""; };

  // 롯데 건인가. 수거입력처가 비었으면 사람이 판단할 일이라 막지 않는다.
  var pickup = cell("pickup");
  if (pickup && pickup.replace(/\s/g, "").indexOf("롯데") === -1) {
    return { ok: false, error: "롯데택배 건이 아닙니다 (수거입력처: " + pickup + ")" };
  }

  var allOrigs = _lrt_digitsList_(cell("invoice"));
  if (!allOrigs.length) {
    return { ok: false, error: "원송장이 없어 접수할 수 없습니다 — 카드에 원송장을 먼저 넣어 주세요" };
  }

  /* ★ 어느 박스가 이미 접수됐는지 ★  (2026-09-09)
     반품송장 칸 하나로는 「어느 원송장의 회수송장인지」를 알 수 없다.
     그래서 접수할 때 비고에 짝을 적어 두고, 여기서 그것을 읽는다.
     이게 있어야 두 박스 중 하나만 접수한 뒤 나머지만 다시 접수할 수 있다. */
  var notice = cell("notice");
  var done = _lrt_doneMap_(notice);

  /* 무엇을 접수할지. only 를 주면 그것만, 안 주면 아직 안 된 것 전부.
     이미 된 것은 언제나 뺀다 — 기사가 두 번 가고 라벨이 두 장 나온다. */
  var want = (p.only && p.only.length) ? _lrt_digitsList_(p.only.join(" ")) : allOrigs;
  var origs = [], skipped = [];
  for (var w = 0; w < want.length; w++) {
    var d = want[w];
    if (allOrigs.indexOf(d) === -1) continue;       // 이 줄의 송장이 아니다
    if (done[d]) { skipped.push(d + "→" + done[d]); continue; }
    if (origs.indexOf(d) === -1) origs.push(d);
  }
  if (!origs.length) {
    return {
      ok: false, already: true,
      error: skipped.length
        ? "이미 접수된 박스입니다 — " + skipped.join(" · ")
        : "접수할 원송장이 없습니다"
    };
  }

  /* ★ 주소를 원송장으로 되짚는다 ★
     반품대장에는 주소 칸이 없다. 주문 색인에서 같은 송장을 찾아 가져온다.
     못 찾으면 지어내지 않고 그대로 말한다 — 주소 없이 접수하면 기사가 헛걸음한다. */
  var addr = "", name = cell("name"), phone = cell("phone");
  var found = null;
  try {
    var hit = csSearchOrders(origs[0], {});
    var rows = (hit && hit.results) || [];
    for (var r = 0; r < rows.length; r++) {
      if (String(rows[r].addr || "").trim()) { found = rows[r]; break; }
    }
  } catch (e) { /* 색인을 못 읽어도 아래에서 「주소 못 찾음」으로 말한다 */ }

  if (found) {
    addr = String(found.addr || "").trim();
    if (!name) name = String(found.name || "").trim();
    if (!phone) phone = String(found.phone || "").trim();
  }
  if (!addr) {
    return {
      ok: false,
      error: "원송장 " + origs[0] + " 로 주문을 못 찾아 주소를 모릅니다. " +
             "주문·송장에서 찾아 그 카드로 접수해 주세요."
    };
  }

  var res = csLotteReturnPickup({
    name: name, phone: phone, addr: addr,
    item: cell("item"), qty: cell("qty"),
    orderNo: found ? found.orderNo : "",
    orglInvNos: origs,
    memo: p.memo, boxType: p.boxType
  });

  /* 하나라도 접수됐으면 대장에 적는다. 실패한 것이 있어도 적는다 —
     적어야 다음 사람이 「이미 접수됨」을 보고 두 번 안 누른다.

     ★ 덮어쓰지 않고 뒤에 붙인다 ★
       박스를 나눠 접수할 수 있으므로, 먼저 접수한 박스의 회수송장을
       지우면 그 박스를 영영 못 찾는다. 입고 스캔도 그 번호로 매칭한다. */
  var okRows = [];
  for (var q = 0; q < res.results.length; q++) {
    if (res.results[q].ok && res.results[q].invoice) okRows.push(res.results[q]);
  }

  if (okRows.length) {
    try {
      if (col.returnInvoice >= 0) {
        var prev = _lrt_digitsList_(cell("returnInvoice"));
        for (var a = 0; a < okRows.length; a++) {
          var d2 = String(okRows[a].invoice).replace(/[^0-9]/g, "");
          if (d2 && prev.indexOf(d2) === -1) prev.push(d2);
        }
        ctx.tab.getRange(ctx.rowNum, col.returnInvoice + 1).setValue(prev.join(" "));
      }
      /* ★ 짝을 남긴다 ★ 어느 원송장의 회수송장인지 여기에만 남는다.
         사람이 읽을 수 있는 한 줄이고, 다음 접수 때 이 줄을 읽어
         「이미 된 박스」를 가려낸다. */
      if (col.notice >= 0) {
        var nx = notice;
        for (var b2 = 0; b2 < okRows.length; b2++) {
          nx = _cs_appendNoticeLine_(nx,
            "회수접수 · 원송장 " + okRows[b2].orglInvNo +
            " → 반품송장 " + okRows[b2].invoice +
            " · 집하 " + res.pickReqYmd);
        }
        ctx.tab.getRange(ctx.rowNum, col.notice + 1).setValue(nx);
      }
    } catch (e) {
      res.error = (res.error ? res.error + " · " : "") +
        "접수는 됐는데 대장에 못 적었습니다(" + e.message + ") — 반품송장 " +
        res.invoices.join(", ") + " · 손으로 적어 주세요";
      res.ok = false;
    }
  }

  res.origs = origs;
  res.skipped = skipped;
  res.usedAddr = addr;
  return res;
}

/** 문자열에서 8자리 이상 숫자만 뽑는다 (중복 제거) */
function _lrt_digitsList_(raw) {
  var parts = String(raw || "").split(/[^0-9]+/);
  var out = [], seen = {};
  for (var i = 0; i < parts.length; i++) {
    var d = parts[i];
    if (!d || d.length < 8 || seen[d]) continue;
    seen[d] = true;
    out.push(d);
  }
  return out;
}

/**
 * 비고에 남긴 짝을 읽는다 — { 원송장: 반품송장 }.
 *
 * 적는 쪽(csLotteReturnPickupFromCard)과 **같은 문장**을 본다.
 * 문구를 고치면 여기도 같이 고쳐야 한다. 그래서 정규식을 느슨하게 둔다 —
 * 「원송장 …」과 「반품송장 …」이 한 줄에 있으면 짝으로 본다.
 */
function _lrt_doneMap_(notice) {
  var map = {};
  var lines = String(notice || "").split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = /원송장\s*([0-9]{8,})[^0-9]+반품송장\s*([0-9-]{8,})/.exec(lines[i]);
    if (m) map[m[1]] = String(m[2]).replace(/[^0-9]/g, "");
  }
  return map;
}

/**
 * 이 대장 줄의 박스별 접수 상태를 알려준다 — 카드가 단추를 그릴 때 쓴다.
 * @return {{ok:boolean, boxes:Array<{orglInvNo:string, returnInvoice:string}>}}
 */
function csLotteReturnBoxState(tabName, rowNum) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return { ok: false, error: "권한이 없습니다." };
  try {
    var ctx = _cs_openReturnLedgerRow_(tabName, rowNum);
    var col = ctx.col, row = ctx.row;
    var cell = function (f) { return col[f] >= 0 ? String(row[col[f]] || "").trim() : ""; };
    var done = _lrt_doneMap_(cell("notice"));
    var origs = _lrt_digitsList_(cell("invoice"));
    var boxes = [];
    for (var i = 0; i < origs.length; i++) {
      boxes.push({ orglInvNo: origs[i], returnInvoice: done[origs[i]] || "" });
    }
    return { ok: true, boxes: boxes, returnInvoice: cell("returnInvoice") };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
