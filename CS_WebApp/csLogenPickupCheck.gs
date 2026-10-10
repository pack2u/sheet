/**
 * ══════════════════════════════════════════════════════════════════════
 *  로젠 집하 누락 점검  —  송장은 찍혔는데 «실제로 안 걷어간» 건
 *  2026-10-10
 *
 *  > "송장번호야 그냥 출력하면 그만인데 실제 집하가 되었는지 확인이 되면
 *  >  좋을꺼 같아"                                              — 사장님
 *
 *  ★ 출고 지연 점검(csLogenOutStale.gs)과 다른 질문이다 ★
 *    지연 점검 : 3영업일 됐는데 «아직 안 닿은» 건 → 가다가 멈췄다
 *    집하 점검 : 어제 송장을 찍었는데 «로젠에 아무 스캔도 없는» 건
 *                → 애초에 안 실려 갔다. 박스가 아직 우리 창고에 있다.
 *
 *    뒤쪽이 더 급하다. 고객은 송장번호를 받아 「발송됐다」고 알고 기다리는데
 *    물건은 그대로 있다. 지연은 로젠에 물어볼 일이지만, 집하 누락은
 *    **우리 쪽에서 박스를 찾아 다시 내보내야** 하는 일이다.
 *
 *  ★ 「스캔 없음」과 「못 물음」을 가른다 ★  (이것이 헛경보의 갈림길이다)
 *    로젠은 둘 다 ok:false 로 준다. ok 로는 못 가린다 — error 글로 가른다.
 *      "…스캔정보가 없습니다." / "조회 결과 없음"  → ★ 집하 안 됨
 *      그 밖 (한도·시간·HTTP)                      → ★ 못 물었다
 *    못 물은 것을 「집하 안 됨」으로 적으면 날마다 수백 건을 겁주게 된다.
 *    그래서 못 물은 자리에서 **멈추고**, 다음 회차가 그 자리부터 다시 묻는다.
 *
 *  ★ 하루치를 나눠 본다 ★ 하루 343~1,452건이다(2026-09-28~10-08 실측).
 *    csLogenTrackMany 는 10건마다 2초 쉬고 150초에서 끊으므로 한 번에
 *    ~750건이 윗한도다. 한 회차에 _PKC_PER_RUN_ 만큼만 묻고 어디까지
 *    봤는지를 적어 둔다 — 1시간 일감이 이어서 본다.
 *    호출 한도는 걱정 없다: 10건이 한 호출이라 9,000호출 = 90,000건이다.
 *
 *  ★ 코호트는 「오늘보다 앞선 가장 최근 회차」다 ★
 *    D-1 로 못 박으면 주말·연휴에 0건이 나와 「안 돈다」로 오해한다 —
 *    2026-10-09 는 한글날이라 로젠 회차가 아예 없었다.
 *    가장 최근 회차를 찾으면 쉬는 날이 저절로 건너뛰어진다.
 * ══════════════════════════════════════════════════════════════════════
 */

/** 한 회차에 물어볼 송장 수. 10건이 한 호출이고 호출 사이에 2초 쉰다. */
var _PKC_PER_RUN_ = 400;

/** 공지 카드 자리표. ★ 출고 지연(_OST_SRCKEY_)과 달라야 한다 ★ 섞이면 서로 덮는다 */
var _PKC_SRCKEY_ = "자동점검:로젠집하누락";

/** 어디까지 봤는지 적어 두는 자리. OST_FOUND 와 섞지 않는다 */
var _PKC_PROP_ = "PKC_STATE";

/** 속성 한 칸은 9KB 다. 넉넉히 밑으로 둔다 */
var _PKC_PROP_MAX_ = 8000;

/** 카드에 줄로 적을 최대 건수 */
var _PKC_SHOW_ = 300;

/** 원장 끝에서 몇 줄까지 훑나 (회차 며칠치) */
var _PKC_SCAN_ROWS_ = 8000;

/**
 * 한 송장이 내리 못 물어진 횟수가 이만큼이면 건너뛴다.
 * 안 두면 영영 안 풀리는 한 건이 뒤쪽 전부를 막는다.
 */
var _PKC_STUCK_MAX_ = 3;

/* ────────────────────────────────────────────────────────────────────
   판정
   ──────────────────────────────────────────────────────────────────── */

/**
 * 한 송장의 답을 「스캔됨 · 누락 · 못물음」 셋으로 가른다.
 *
 * ★ 지어내지 않는다 ★ 처음 보는 상태 이름은 «스캔됨»으로 둔다.
 *   로젠은 통보 없이 단계 이름을 늘릴 수 있다(csLogen.gs 머리말).
 *   모르는 이름을 「집하 안 됨」으로 읽으면, 이름이 하나 바뀌는 날
 *   하루치가 통째로 겁주게 된다. 무엇이든 스캔이 찍혔으면 걷어간 것이다.
 *
 * @param {Object} r csLogenTrackMany 의 한 항목
 * @return {string} "스캔됨" | "누락" | "못물음"
 */
function _pkc_judge_(r) {
  if (!r) return "못물음";                    // 응답에 아예 없었다

  if (r.ok) {
    var nm = String(r.statusName || "").trim();
    /*  _logen_buildLast_ 는 statNm 이 비면 「이력 없음」으로 채운다.
        부름은 성공했고 스캔이 없다는 뜻이라 누락이 맞다. */
    if (!nm || nm === "이력 없음") return "누락";
    return "스캔됨";
  }

  /*  ★ 로젠이 「스캔정보가 없습니다」를 ok:false 로 준다 ★  (실응답)
        sttsMsg "처리결과 0건" · resultCd "FALSE"
        resultMsg "화물추적 조회 결과 없음 - 스캔정보가 없습니다."
      이것만이 「로젠에 안 올라갔다」는 뜻이다.                          */
  var e = String(r.error || "");
  if (/스캔정보가 없습니다|조회 결과 없음|처리결과 0건/.test(e)) return "누락";

  /*  그 밖은 다 «못 물었다»다. 실제로 오는 글들:
        "호출 실패: …" · "일일 호출 한도(9000)에 도달했습니다."
        "응답을 해석하지 못했습니다 (HTTP …)"
        "한 번에 다 조회하지 못했습니다 — 나눠서 다시 눌러 주세요."
        "응답에 없습니다 (…)"
      마지막에서 둘째가 특히 흔하다 — 시간 예산에 걸려 아예 안 물은 건이다. */
  return "못물음";
}

/* ────────────────────────────────────────────────────────────────────
   코호트 모으기
   ──────────────────────────────────────────────────────────────────── */

/**
 * 원장에서 열 자리를 찾는다. 두 곳에서 똑같이 쓰므로 한 군데로 모았다.
 * ★ 한 값에 주인은 하나 ★ 열 이름을 두 군데에 적어 두면 한쪽만 고치게 된다.
 */
function _pkc_cols_(head) {
  var c = {};
  for (var h = 0; h < head.length; h++) {
    var nm = String(head[h] || "").trim();
    if (nm === "회차키") c.round = h;
    else if (nm === "운송장번호") c.inv = h;
    else if (nm === "택배사") c.carrier = h;
    else if (nm === "경로") c.path = h;
    else if (nm === "거래처명") c.name = h;
    else if (nm === "사방넷주문번호") c.order = h;
  }
  if (c.inv == null || c.round == null) {
    throw new Error("운송장번호·회차키 열을 못 찾았습니다");
  }
  return c;
}

/** 원장 끝 _PKC_SCAN_ROWS_ 줄을 한 번만 읽는다 */
function _pkc_read_() {
  var ss = SpreadsheetApp.openById(_CS_LEDGER_SS_ID_);
  var tab = ss.getSheetByName("주문라인원장");
  if (!tab) throw new Error("「주문라인원장」 탭이 없습니다");
  var lastRow = tab.getLastRow();
  if (lastRow < 2) return { c: null, 값: [] };
  var lastCol = tab.getLastColumn();
  var head = tab.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var c = _pkc_cols_(head);
  var from = Math.max(2, lastRow - _PKC_SCAN_ROWS_ + 1);
  return { c: c, 값: tab.getRange(from, 1, lastRow - from + 1, lastCol).getDisplayValues() };
}

/**
 * 그 회차날의 로젠 송장을 모은다.
 *
 * ★ 차례가 늘 같아야 한다 ★ 어디까지 봤는지를 «번호»로 적어 두기 때문이다.
 *   차례가 흔들리면 어떤 건은 두 번 묻고 어떤 건은 영영 안 묻는다.
 *   그래서 송장번호로 정렬해 못 박는다 (OST 와 같은 까닭).
 */
function _pkc_pick_(c, 값, 코호트) {
  var 본것 = {}, out = [];
  for (var j = 0; j < 값.length; j++) {
    var r = 값[j];
    if (String(r[c.round] || "").trim().substring(0, 6) !== 코호트) continue;

    /*  ★ 갓 돌린 회차는 택배사·운송장이 다 빈칸이다 ★
        정해지는 것은 「경로」뿐이다. 택배사로만 걸러내면 가장 최근 회차가
        통째로 빠진다 — 집하 점검이 보려는 바로 그 줄들이다.
        (csLogenShipSlips.gs _ls_isLogenRow_ 머리말)                      */
    if (!_ls_isLogenRow_(c.path != null ? r[c.path] : "",
                         c.carrier != null ? r[c.carrier] : "")) continue;

    /*  ★ 한 칸에 송장이 여럿일 수 있다 ★ 다박스다.
        2026-10-01 실측: 582줄 → 698송장. 칸 전체에서 숫자만 뽑으면
        22자리가 되어 그 줄이 통째로 빠진다.                              */
    var invs = _ost_splitInvoices_(r[c.inv]);
    for (var k = 0; k < invs.length; k++) {
      var inv = invs[k];
      if (본것[inv]) continue;                  // 합포장 — 한 송장에 여러 줄
      본것[inv] = true;
      out.push({
        inv: inv,
        name: c.name != null ? String(r[c.name] || "").trim() : "",
        order: c.order != null ? String(r[c.order] || "").trim() : ""
      });
    }
  }
  out.sort(function (a, b) { return a.inv < b.inv ? -1 : (a.inv > b.inv ? 1 : 0); });
  return out;
}

/**
 * 「오늘보다 앞선 가장 최근 회차」를 찾아 그날 송장을 모은다.
 * @param {string=} 못박을코호트 손으로 그날을 지정할 때 (시험용)
 * @return {{코호트: string, 목록: Array<{inv:string, name:string, order:string}>}}
 */
function _pkc_collect_(못박을코호트) {
  var 읽은것 = _pkc_read_();
  if (!읽은것.c) return { 코호트: "", 목록: [] };
  var c = 읽은것.c, 값 = 읽은것.값;

  if (못박을코호트) {
    return { 코호트: 못박을코호트, 목록: _pkc_pick_(c, 값, 못박을코호트) };
  }

  /*  회차키는 「261008-1」 꼴이라 앞 여섯 자가 날이다.
      오늘 회차는 아직 집하 전이므로 뺀다.                                */
  var 오늘 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMdd");
  var 코호트 = "";
  for (var i = 0; i < 값.length; i++) {
    var m = String(값[i][c.round] || "").trim().match(/^(\d{6})/);
    if (!m) continue;
    if (m[1] >= 오늘) continue;
    if (m[1] > 코호트) 코호트 = m[1];
  }
  if (!코호트) return { 코호트: "", 목록: [] };
  return { 코호트: 코호트, 목록: _pkc_pick_(c, 값, 코호트) };
}

/* ────────────────────────────────────────────────────────────────────
   어디까지 봤나
   ──────────────────────────────────────────────────────────────────── */

/** 속성에서 읽는다. 깨져 있으면 처음부터 시작한다 */
function _pkc_load_(P) {
  var 빈것 = { 코호트: "", idx: 0, 누락: [], 누락수: 0, 막힘: 0, 넘긴것: [] };
  try {
    var v = JSON.parse(P.getProperty(_PKC_PROP_) || "null");
    if (!v || typeof v !== "object") return 빈것;
    return {
      코호트: String(v.코호트 || ""),
      idx: Number(v.idx) || 0,
      누락: Object.prototype.toString.call(v.누락) === "[object Array]" ? v.누락 : [],
      누락수: Number(v.누락수) || 0,
      막힘: Number(v.막힘) || 0,
      넘긴것: Object.prototype.toString.call(v.넘긴것) === "[object Array]" ? v.넘긴것 : []
    };
  } catch (e) { return 빈것; }
}

/**
 * 속성에 적는다.
 * ★ 9KB 한도 ★ 누락이 많으면 줄 목록부터 잘라 낸다 — 셋수(누락수)는
 *   «언제나» 온전히 남긴다. 「몇 건인지」가 「누구인지」보다 먼저다.
 */
function _pkc_save_(P, st) {
  var 적을것 = {
    코호트: st.코호트, idx: st.idx, 누락수: st.누락수,
    막힘: st.막힘, 넘긴것: (st.넘긴것 || []).slice(0, 40), 누락: st.누락
  };
  var s = JSON.stringify(적을것);
  while (s.length > _PKC_PROP_MAX_ && 적을것.누락.length > 1) {
    적을것.누락 = 적을것.누락.slice(0,
      적을것.누락.length - Math.max(1, Math.floor(적을것.누락.length / 10)));
    s = JSON.stringify(적을것);
  }
  P.setProperty(_PKC_PROP_, s);
  st.누락 = 적을것.누락;      // 잘렸으면 이쪽도 같이 줄인다 — 카드가 없는 줄을 적지 않게
}

/* ────────────────────────────────────────────────────────────────────
   본체
   ──────────────────────────────────────────────────────────────────── */

/**
 * 집하 누락 점검 한 걸음.
 *
 * 1시간 일감(csReturnHourlyJob)이 부른다. 한 회차에 _PKC_PER_RUN_ 만큼만
 * 묻고, 코호트를 다 보면 카드를 한 번 갈아 끼우고 그 뒤로는 조용하다.
 *
 * @param {Object=} opt { 코호트: "261008" } 로 그날을 손으로 지정할 수 있다
 * @return {string} 일감 보고에 붙일 글 (붙일 것 없으면 빈 글)
 */
function csLogenPickupCheck(opt) {
  opt = opt || {};
  var P = PropertiesService.getScriptProperties();
  var st = _pkc_load_(P);

  var 모음 = _pkc_collect_(opt["코호트"] ? String(opt["코호트"]) : "");
  var 코호트 = 모음.코호트, 목록 = 모음.목록;

  if (!코호트) {
    _pkc_note_("볼 회차가 없습니다 (원장 끝 " + _PKC_SCAN_ROWS_ + "줄에 어제까지의 회차가 없습니다)");
    return "";
  }

  //  날이 바뀌었다 — 처음부터 다시 센다
  if (st.코호트 !== 코호트) {
    st = { 코호트: 코호트, idx: 0, 누락: [], 누락수: 0, 막힘: 0, 넘긴것: [] };
  }

  if (!목록.length) {
    _pkc_note_(코호트 + " 치 로젠 송장 0건 — 그날 로젠 출고가 없었습니다 (볼 것 없음)");
    _stale_close_(_PKC_SRCKEY_, "볼 것 없음");
    st.idx = 0; _pkc_save_(P, st);
    return "";
  }

  //  이미 다 봤다 — 조용히 있는다. 카드는 마지막 판으로 서 있다.
  if (st.idx >= 목록.length) {
    _pkc_note_(코호트 + " 치 " + 목록.length + "건 다 봤습니다 · 집하 안 된 것 " + st.누락수 + "건");
    return "";
  }

  var 조각 = 목록.slice(st.idx, st.idx + _PKC_PER_RUN_);
  var 송장 = [];
  for (var i = 0; i < 조각.length; i++) 송장.push(조각[i].inv);

  /*  ★ 최종만 ★ 「지금 어디 있나」만 보면 된다. 그리고 그 문에만 영업소
      전화번호(salesCellNo)가 온다 — 카드에서 바로 걸 수 있다.
      캐시표도 따로(L)라 배송조회 화면과 안 섞인다.                       */
  var 결과 = csLogenTrackMany(송장, { "최종만": true });

  /*  ★ 못 물은 자리에서 «멈춘다» ★ 넘어가면 그 건은 영영 안 묻는다.
      시간 예산에 걸린 건들은 조각의 꼬리라 멈추는 자리가 곧 다음 시작점이다. */
  var 나아감 = 0, 누락이번 = 0, 스캔이번 = 0, 못물음 = 0;
  for (var j = 0; j < 조각.length; j++) {
    var one = 조각[j];
    var 판정 = _pkc_judge_(결과[one.inv]);
    if (판정 === "못물음") { 못물음 = 조각.length - j; break; }
    나아감++;
    if (판정 === "누락") {
      누락이번++;
      st.누락수++;
      var r = 결과[one.inv] || {};
      st.누락.push({
        inv: one.inv, name: one.name, order: one.order,
        tel: String(r.branchTel || ""), br: String(r.branch || "")
      });
    } else {
      스캔이번++;
    }
  }

  if (나아감 === 0) {
    /*  한 건도 못 물었다. 한도거나 로젠이 안 받는 것이다 — 겁주지 않고
        다음 회차에 다시 묻는다. 다만 영영 안 풀리는 한 건이 뒤쪽 전부를
        막으면 안 되므로 몇 번 내리 막히면 그 한 건을 넘긴다.             */
    st.막힘++;
    var 까닭 = String((결과[조각[0].inv] || {}).error || "까닭을 모릅니다");
    if (st.막힘 >= _PKC_STUCK_MAX_) {
      st.넘긴것.push(조각[0].inv);
      st.idx++;
      st.막힘 = 0;
      _pkc_note_(코호트 + " 치 " + st.idx + "/" + 목록.length +
                 " · " + 조각[0].inv + " 을 " + _PKC_STUCK_MAX_ + "번 못 물어 넘겼습니다");
    } else {
      _pkc_note_(코호트 + " 치 " + st.idx + "/" + 목록.length +
                 " · 못 물었습니다(" + st.막힘 + "번째) — " + 까닭.slice(0, 80));
    }
    _pkc_save_(P, st);
    return "";
  }

  st.막힘 = 0;
  st.idx += 나아감;
  _pkc_save_(P, st);

  var 다봤나 = st.idx >= 목록.length;
  _pkc_report_(코호트, 목록.length, st, 다봤나);

  _pkc_note_(코호트 + " 치 " + st.idx + "/" + 목록.length +
             " · 이번 " + 나아감 + "건(스캔 " + 스캔이번 + " · 집하누락 " + 누락이번 + ")" +
             (못물음 ? " · 못 물어 멈춘 자리부터 다음 시간에" : "") +
             " · 누적 집하누락 " + st.누락수 + "건");

  //  일감 보고에는 «다 보고 찾았을 때만» 붙인다 — 매시간 같은 말이 쌓이면 안 읽힌다
  if (다봤나 && st.누락수) {
    return "★ 로젠 집하 누락 " + st.누락수 + "건 (" + 코호트 + " 치) — 공지 카드를 보세요";
  }
  return "";
}

/** 운영점검 탭에 한 줄 — 할 일이 없을 때도 남긴다(그래야 돌았는지 안다) */
function _pkc_note_(글) {
  try {
    _cpr_ops_(SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_), "집하 누락 점검", 글);
  } catch (e) {}
}

/**
 * 공지 카드를 세우거나 내린다.
 * ★ _OST_SRCKEY_ 와 다른 자리표를 쓴다 ★ 섞이면 서로 덮는다.
 */
function _pkc_report_(코호트, 전체, st, 다봤나) {
  if (!st.누락수) {
    //  다 보고 하나도 없으면 카드를 닫는다. 보는 중이면 아직 건드리지 않는다.
    if (다봤나) _stale_close_(_PKC_SRCKEY_, "집하 누락 없음");
    return "";
  }

  var 제목 = "로젠이 안 걷어간 것 같은 건 " + st.누락수 + "건 (" + 코호트 + " 치)";
  var 줄들 = [];
  줄들.push("송장은 찍혔는데 로젠에 스캔 기록이 아예 없는 건입니다.");
  줄들.push("가다가 멈춘 것이 아니라 애초에 안 실려 간 것입니다 —");
  줄들.push("박스가 아직 우리 창고에 있을 수 있습니다. 먼저 찾아보세요.");
  줄들.push("");
  줄들.push(다봤나
    ? ("※ " + 코호트 + " 치 " + 전체 + "건을 다 물어봤습니다.")
    : ("※ 아직 보는 중입니다 — " + st.idx + "/" + 전체 +
       "건까지 물어봤습니다. 숫자가 더 늘 수 있습니다."));
  if ((st.넘긴것 || []).length) {
    줄들.push("※ 몇 번 물어도 답이 안 와서 넘긴 송장 " + st.넘긴것.length +
              "건: " + st.넘긴것.slice(0, 10).join(", "));
  }
  줄들.push("");

  for (var i = 0; i < st.누락.length && i < _PKC_SHOW_; i++) {
    var x = st.누락[i];
    줄들.push("· " + x.inv +
      (x.name ? " · " + x.name : "") +
      (x.order ? " · " + x.order : "") +
      (x.br ? " · " + x.br + (x.tel ? " " + x.tel : "") : ""));
  }
  if (st.누락수 > st.누락.length) {
    줄들.push("… 외 " + (st.누락수 - st.누락.length) + "건 (자리가 모자라 줄은 못 적었습니다)");
  }
  줄들 = _stale_fitBody_(줄들, _STALE_BODY_MAX_);

  return _stale_publish_(_PKC_SRCKEY_, 제목, 줄들.join("\n"), st.누락수);
}
