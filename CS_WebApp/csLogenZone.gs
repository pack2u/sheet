/**
 * ══════════════════════════════════════════════════════════════
 *  도서산간 조회 — 로젠에게 직접 묻는다
 *  규격: 로젠택배_OpenAPI_규격.md §6.2 `integratedInquiry`
 *
 *  ★ 왜 묻나 ★
 *    지금은 「도서산간_우편번호」 표를 **손으로** 관리한다. 그런데 섬은
 *    군 단위로 갈리지 않는다 — 2026-10-07 에 확인했다:
 *        강화 읍내    아님
 *        강화 교동도  섬   ← 같은 군인데 다르다
 *        강화 석모도  섬
 *        태안 안면도  아님 (다리가 놓였다)
 *    우편번호 표로 이걸 따라가려면 섬 하나 들어올 때마다 손으로 넣어야 하고,
 *    빠뜨리면 조용히 틀린다. 실제로 다섯 곳이 「판단 대기」로 쌓여 있었다.
 *
 *    **로젠이 실제로 과금하는 기준**을 그대로 묻는 편이 정확하다.
 *
 *  ★ 지금은 «보기»만 한다 ★  (2026-10-07)
 *    세트분리의 도서산간 판정은 **아직 안 바꿨다.**
 *    출력 탭 열은 롯데와의 약속이고([[setsplit-exists-for-lotte-label-print]]),
 *    도선료 5,000원 통일도 따로 정한 것이다([[ferry-fee-flat-5000]]).
 *    먼저 눈으로 견주어 보고, 지금 표와 어디가 다른지 쌓인 뒤에 손댄다.
 *
 *  화면: ?page=zone   (zone.html)
 * ══════════════════════════════════════════════════════════════
 */

/** 한 번에 물을 수 있는 주소 수 — 로젠 권장(1회 10건 내외)과 같다 */
var _LZN_MAX_ = 10;

/**
 * 주소 여러 개의 도서산간 여부를 묻는다.
 *
 * @param {Array<string>} addrs
 * @return {{ok:boolean, rows:Array, error:string}}
 *         rows[] = {addr, zip, bran, classCd, jeju, ship, mont, zone, fee, error}
 */
function csLogenZoneLookup(addrs) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return { ok: false, rows: [], error: "권한이 없습니다." };

  var list = [];
  var src = addrs || [];
  for (var i = 0; i < src.length && list.length < _LZN_MAX_; i++) {
    var a = String(src[i] || "").trim();
    if (a) list.push(a);
  }
  if (!list.length) return { ok: false, rows: [], error: "주소를 한 줄 이상 넣어 주세요." };

  var body = { userId: _logen_userId_(), data: [] };
  for (var k = 0; k < list.length; k++) {
    body.data.push({ custCd: _logen_custCd_(), addr: list[k] });
  }

  var r = _logen_call_("integratedInquiry", body);
  if (!r.ok) return { ok: false, rows: [], error: r.error };

  var rows = _logen_arr_(r.json && r.json.data);
  var out = [];

  for (var n = 0; n < list.length; n++) {
    var d = rows[n] || null;
    if (!d) {
      out.push({ addr: list[n], error: "응답에 없습니다" });
      continue;
    }
    /*  ★ 이 API 는 resultCd 가 「SUCCESS / FALSE」로 적혀 있다 ★ (규격 0장)
        다른 API 의 TRUE/FALSE 와 섞여 있어 화이트리스트로 본다. */
    if (d.resultCd != null && !_logen_ok_(d.resultCd)) {
      out.push({ addr: list[n], error: String(d.resultMsg || "조회 실패") });
      continue;
    }

    var jeju = String(d.jejuRegYn || "") === "Y";
    var ship = String(d.shipYn || "") === "Y";
    var mont = String(d.montYn || "") === "Y";

    out.push({
      addr: String(d.addr || list[n]),
      zip: String(d.zipCd || ""),
      dong: String(d.dongNm || ""),
      bran: String(d.branNm || ""),
      classCd: String(d.classCd || ""),
      sales: String(d.salesNm || ""),
      tml: String(d.tmlNm || ""),
      jeju: jeju, ship: ship, mont: mont,
      zone: _lzn_label_(jeju, ship, mont),
      error: ""
    });
  }
  return { ok: true, rows: out, error: "" };
}

/** 세 깃발을 사람이 읽는 한 마디로 */
function _lzn_label_(jeju, ship, mont) {
  var w = [];
  if (jeju) w.push("제주");
  if (ship) w.push("연륙도서");
  if (mont) w.push("산간");
  return w.length ? w.join(" · ") : "일반";
}

/*  ★ 우리 표와 «견주는» 기능은 아직 안 만들었다 ★  (2026-10-07)
    세트분리가 도서산간을 어떻게 판정하는지 아직 안 읽었다. 함수 이름을 짐작해
    죽은 코드를 두면 나중에 「되는 줄 알았는데 안 되는」 것이 된다.
    먼저 눈으로 견주고, 바꿀 때 그 자리를 찾아 붙인다.  */
