/**
 * ══════════════════════════════════════════════════════════════
 *  로젠 계약이 «끊기기 전에» 안다
 *  파일: csLogenContract.gs
 *
 *  ★ 왜 ★  (2026-10-08)
 *    2026-10-02 에 로젠 API 가 통째로 막힌 적이 있다. 조회마다
 *    *"거래처 계약일자가 종료되었습니다. 관할지점으로 계약일자를 문의하세요."*
 *    가 왔다. 원인은 `contractTotalInfo` 의 **`useYn = "E"`**(Expired) —
 *    거래처 계약일자가 지난 것이었다.
 *
 *    그때는 **막히고 나서야** 알았다. 추적도 반품접수도 다 멈춘 뒤에.
 *    로젠에 문의해 계약일자를 갱신받고서야 풀렸다.
 *
 *    `useYn` 은 막히기 «전»에도 읽힌다. 하루 한 번만 보면 된다.
 *
 *  ★ 문서에 없는 값이 온다 ★
 *    규격서에는 `useYn` 이 `Y`/`N` 뿐이라고 적혀 있다. 실제로는 `E` 가 왔다.
 *    그래서 **「Y 가 아니면 이상하다」**로 본다 — 아는 값만 나쁘다고 치면
 *    다음에 또 새 값이 올 때 조용히 지나간다([[leave-no-ambiguous-branches]]).
 *
 *  ★ 사람이 보는 곳에 올린다 ★
 *    CS웹앱 맨 위 공지 띠(인수인계보드). Logger.log 에만 남기면 또
 *    막히고 나서 안다 — 그게 이 파일이 생긴 까닭이다.
 *    올리고 닫는 규칙은 csLogenStale.gs 의 _stale_publish_ · _stale_close_
 *    한 곳에만 둔다([[one-value-one-owner]]).
 * ══════════════════════════════════════════════════════════════
 */

/** 그 카드를 알아보는 표 — 지연 카드들과 «달라야» 한다 */
var _CTR_SRCKEY_ = "자동점검:로젠계약";

/** 하루 한 번만 묻는다. 자주 안 바뀌는 값이다(규격서 11.1 — 「일 1회 갱신」) */
var _CTR_DAY_PROP_ = "CTR_DAY";

/**
 * 하루 한 번 — 계약이 살아 있는지 보고, 이상하면 공지 띠에 올린다.
 * csReturnHourlyJob 이 매시간 부르지만 실제로 묻는 것은 하루 한 번이다.
 *
 * @param {Object} opt { 강제:boolean }
 * @return {string} 오늘 몫이 끝났으면 빈 글
 */
function csLogenContractWatch(opt) {
  opt = opt || {};
  var P = PropertiesService.getScriptProperties();
  var 오늘 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");

  if (!opt["강제"]) {
    if (P.getProperty(_CTR_DAY_PROP_) === 오늘) return "";
    /*  먼저 찍는다 — 중간에 터져도 하루 한 번을 지킨다. 못 물으면 내일 또 본다.
        계약 만료는 하루 늦게 알아도 늦지 않다(갱신에 며칠 걸린다). */
    P.setProperty(_CTR_DAY_PROP_, 오늘);
  }

  var r = csLogenContractInfo();
  var L = ["── 로젠 계약 점검 ──"];

  if (!r.ok) {
    /*  ★ 못 물은 것과 「계약이 끊긴 것」은 다르다 ★
        중계기가 죽었거나 그물이 끊겨도 여기로 온다. 그걸 「계약 만료」라고
        올리면 엉뚱한 데를 보게 된다. 그래서 말을 가려 적는다.
        다만 조용히 넘기지는 않는다 — 못 묻는 것 자체가 이상한 일이다. */
    L.push("★ 계약 정보를 못 읽었습니다 — " + r.error);
    L.push(_ctr_report_(null, r.error));
    var 끝0 = L.join("\n"); Logger.log(끝0);
    _ctr_note_("못 읽음 — " + r.error);
    return 끝0;
  }

  L.push("거래처   " + r.custCd + (r.branNm ? " · " + r.branNm : ""));
  L.push("집하영업소 " + (r.salesNm || "-"));
  L.push("운임타입 " + (r.fareTy || "-") + (r.fareTyNm ? " " + r.fareTyNm : ""));
  L.push("사용여부 " + r.useYn + "  " + _ctr_useYnMeans_(r.useYn));

  L.push(_ctr_report_(r, ""));
  var 끝 = L.join("\n");
  Logger.log(끝);
  _ctr_note_(r.useYn + " " + _ctr_useYnMeans_(r.useYn) +
             (r.salesNm ? " · " + r.salesNm : ""));
  return 끝;
}

/**
 * 계약정보 한 벌을 읽는다 (손으로 돌려 봐도 된다).
 * @return {{ok, useYn, fareTy, fareTyNm, branNm, salesNm, salesCd, custCd, error}}
 */
function csLogenContractInfo() {
  var cust = _logen_custCd_();
  var r = _logen_call_("contractTotalInfo", {
    userId: _logen_userId_(),
    data: [{ custCd: cust }]
  });
  if (!r.ok) return { ok: false, custCd: cust, error: r.error };

  var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
  if (!rows.length) {
    return { ok: false, custCd: cust,
             error: "로젠이 계약 정보를 주지 않았습니다 (" +
                    String((r.json && r.json.sttsMsg) || "내용 없음") + ")" };
  }
  var d = rows[0] || {};

  /*  이 API 는 resultCd 가 없을 수도 있다(규격서 2장 — API 마다 다르다).
      있으면 보고, 없으면 useYn 이 왔는지로 본다. */
  if (d.resultCd != null && String(d.resultCd) !== "" && !_logen_ok_(d.resultCd)) {
    return { ok: false, custCd: cust,
             error: String(d.resultMsg || "계약 조회 실패") };
  }

  return {
    ok: true,
    custCd: cust,
    useYn: String(d.useYn == null ? "" : d.useYn).trim().toUpperCase(),
    fareTy: String(d.fareTy == null ? "" : d.fareTy).trim(),
    fareTyNm: String(d.fareTyNm == null ? "" : d.fareTyNm).trim(),
    branNm: String(d.pickBranNm == null ? "" : d.pickBranNm).trim(),
    salesNm: String(d.pickSalesNm == null ? "" : d.pickSalesNm).trim(),
    salesCd: String(d.pickSalesCd == null ? "" : d.pickSalesCd).trim(),
    error: ""
  };
}

/**
 * 계약이 성한가.
 * ★ 「Y 가 아니면 이상하다」 ★ 아는 나쁜 값(N·E)만 집으면, 다음에 또 새 값이
 *   올 때 조용히 지나간다. 문서에 없던 E 가 실제로 왔던 자리다.
 */
function _ctr_healthy_(useYn) {
  return String(useYn || "").trim().toUpperCase() === "Y";
}

/** 그 글자가 무슨 뜻인가 — 모르는 값도 말로 돌려준다 */
function _ctr_useYnMeans_(v) {
  var s = String(v || "").trim().toUpperCase();
  if (s === "Y") return "(사용 — 정상)";
  if (s === "N") return "(미사용 — 접수 불가)";
  if (s === "E") return "(계약 종료 — Expired)";
  if (!s) return "(빈 값 — 로젠이 안 줬습니다)";
  return "(문서에 없는 값입니다)";
}

/** 공지 띠에 올리거나 내린다 */
function _ctr_report_(r, 못읽은이유) {
  if (r && _ctr_healthy_(r.useYn)) {
    return _stale_close_(_CTR_SRCKEY_, "계약 정상");
  }

  var 제목, 줄 = [];
  if (!r) {
    제목 = "로젠 계약 상태를 확인하지 못했습니다";
    줄.push("· 사유 — " + 못읽은이유);
    줄.push("");
    줄.push("계약이 끊긴 것일 수도, 중계기나 그물 문제일 수도 있습니다.");
    줄.push("CS웹앱에서 로젠 조회가 되는지 먼저 눌러 보세요.");
  } else {
    제목 = "로젠 계약이 정상이 아닙니다 (useYn = " + (r.useYn || "빈 값") + ")";
    줄.push("· 사용여부 — " + (r.useYn || "빈 값") + " " + _ctr_useYnMeans_(r.useYn));
    줄.push("· 거래처 — " + r.custCd + (r.branNm ? " · " + r.branNm : ""));
    if (r.salesNm) 줄.push("· 집하영업소 — " + r.salesNm);
    줄.push("");
    줄.push("이대로 두면 추적·반품접수가 «전부» 막힙니다. 2026-10-02 에 그랬습니다.");
    줄.push("관할지점에 계약일자를 문의하세요 — 위 집하영업소 번호로 걸면 됩니다.");
  }
  줄.push("(하루 한 번 다시 봅니다. 풀리면 이 카드는 저절로 닫힙니다.)");

  return _stale_publish_(_CTR_SRCKEY_, 제목, 줄.join("\n"), 1);
}

/** 운영점검 탭에도 한 줄 — 공지는 이상할 때만 뜨지만, 여기는 늘 남는다 */
function _ctr_note_(글) {
  try {
    _cpr_ops_(SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_), "로젠 계약", 글);
  } catch (e) {}
}
