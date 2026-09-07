/**
 * ══════════════════════════════════════════════════════════════
 *  [진단] 이카운트 구매 조회 API 를 찾는다 — 읽기 전용
 *  파일: _partnerEcountPurchaseProbe.gs
 *  2026-09-07
 *
 *  ★ 왜 필요한가 ★
 *    명세서 대조 상대를 「구매입력」 폴더의 일자별 파일에서 읽고 있다.
 *    그건 우리가 **올린 것**이고, 이카운트 구매조회는 **실제로 들어간 것**이다.
 *    구매조회에는 송장번호·구매거래처까지 붙어 있어 대조가 훨씬 정확해진다.
 *
 *    문제는 이 프로젝트가 지금까지 구매는 쓰기만 했다는 것이다
 *    (Purchase/SavePurchaseOrder). 읽는 경로가 어느 이름으로 열려 있는지 모른다.
 *    이카운트 OpenAPI 는 계정·버전에 따라 열려 있는 경로가 다르다.
 *
 *  ★ 그래서 짐작하지 않고 찔러 본다 ★
 *    _partnerTaxStatement.gs 의 거래처 조회가 이미 같은 방식을 쓴다
 *    (_PTS_EC_CUST_PATHS_ 후보 목록 → 되는 것 저장).
 *    같은 방식을 구매 조회에 쓴다. 새 방식을 만들지 않는다.
 *
 *  ★ 아무것도 쓰지 않는다 ★
 *    조회만 한다. 저장·수정 경로는 후보에 넣지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

/** 찔러 볼 구매 조회 경로 후보 */
var _PEPR_PATHS_ = [
  "Purchases/GetPurchasesList",
  "Purchase/GetPurchasesList",
  "Purchase/GetPurchaseList",
  "Purchases/GetListPurchases",
  "Purchase/GetListPurchase",
  "Purchase/GetPurchaseSlipList",
  "Purchase/GetListPurchaseSlip",
  "PurchasesBasic/GetPurchasesList",
];

/** 확인된 경로를 적어 두는 스크립트 속성 키 */
var _PEPR_PATH_PROP_ = "PEPR_ECOUNT_PURCHASE_PATH";

/**
 * 날짜 키 이름도 계정마다 다르다. 한 경로가 열려 있어도 키가 틀리면
 * "필수값 없음" 으로 돌아온다. 그 메시지가 곧 답이라 그대로 보여준다.
 */
var _PEPR_PAYLOADS_ = [
  { BASE_DATE_FROM: "", BASE_DATE_TO: "" },
  { PROD_DATE_FROM: "", PROD_DATE_TO: "" },
  { IO_DATE_FROM: "", IO_DATE_TO: "" },
];

function partnerProbeEcountPurchaseApi() {
  var L = ["═══ 이카운트 구매 조회 API 탐색 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];
  var tz = "Asia/Seoul";
  var to = Utilities.formatDate(new Date(), tz, "yyyyMMdd");
  var from = Utilities.formatDate(
    new Date(new Date().getTime() - 7 * 24 * 3600 * 1000), tz, "yyyyMMdd");

  var auth;
  try {
    auth = _pts_ecLogin_();
  } catch (e) {
    L.push("★ 로그인 실패: " + e.message);
    return _pepr_show_(L);
  }
  L.push("로그인 OK · zone=" + auth.zone + " · 기간 " + from + "~" + to);
  L.push("");

  var found = "";
  for (var p = 0; p < _PEPR_PATHS_.length; p++) {
    var path = _PEPR_PATHS_[p];
    var url = "https://oapi" + auth.zone + ".ecount.com/OAPI/V2/" + path +
      "?SESSION_ID=" + encodeURIComponent(auth.sid);

    for (var q = 0; q < _PEPR_PAYLOADS_.length; q++) {
      var body = {};
      var keys = Object.keys(_PEPR_PAYLOADS_[q]);
      body[keys[0]] = from;
      body[keys[1]] = to;

      var res, code = 0, text = "";
      try {
        res = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(body),
          headers: { Accept: "application/json", Expect: "" },
          muteHttpExceptions: true,
        });
        code = res.getResponseCode();
        text = res.getContentText();
      } catch (eF) {
        text = "호출 예외: " + eF.message;
      }

      var rows = -1, msg = "";
      try {
        var j = JSON.parse(text);
        if (j && j.Data && j.Data.Result) rows = j.Data.Result.length;
        msg = String((j && (j.Error && (j.Error.Message || j.Error.MessageKey))) ||
          (j && j.Status) || "").substring(0, 90);
      } catch (eJ) {
        msg = String(text).substring(0, 90);
      }

      // 404 는 경로 자체가 없는 것 — 키를 바꿔도 소용없다
      if (code === 404) {
        L.push("  " + path + "  [" + keys[0] + "] → 404 (경로 없음)");
        break;
      }
      L.push("  " + path + "  [" + keys[0] + "] → HTTP " + code +
        (rows >= 0 ? "  행 " + rows : "") + (msg ? "  " + msg : ""));

      if (code === 200 && rows >= 0) {
        found = path + "|" + keys[0];
        L.push("      ★ 열려 있습니다");
        // 실제 필드 이름을 봐야 대조에 쓸 수 있다
        try {
          var j2 = JSON.parse(text);
          if (j2.Data.Result.length) {
            L.push("      필드: " + Object.keys(j2.Data.Result[0]).slice(0, 18).join(", "));
          } else {
            L.push("      (기간 내 자료 없음 — 필드는 확인 못 함)");
          }
        } catch (e2) {}
        break;
      }
    }
    if (found) break;
  }

  L.push("");
  if (found) {
    try {
      PropertiesService.getScriptProperties().setProperty(_PEPR_PATH_PROP_, found);
      L.push("확인된 경로를 저장했습니다: " + found);
    } catch (eS) {
      L.push("경로 저장 실패(속성 한도?): " + eS.message + "  → " + found);
    }
    L.push("이 경로로 명세서 대조를 이카운트 구매조회 기준으로 바꿀 수 있습니다.");
  } else {
    L.push("★ 열려 있는 구매 조회 경로를 못 찾았습니다.");
    L.push("  위 응답 메시지를 그대로 알려 주세요 — 필요한 필드 이름이 거기 있습니다.");
    L.push("  이카운트 계정에서 OpenAPI 구매 조회 권한이 꺼져 있을 수도 있습니다.");
    L.push("  그동안은 「구매입력」 폴더의 일자별 파일로 대조합니다 (지금 방식).");
  }
  return _pepr_show_(L);
}

function _pepr_show_(L) {
  var text = L.join("\n");
  Logger.log(text);
  try {
    SpreadsheetApp.getUi().alert("이카운트 구매 조회 API", text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
  return text;
}
