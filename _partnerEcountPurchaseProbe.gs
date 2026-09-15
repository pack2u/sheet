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
 * ★ 후보를 더 찍지 않는다 (2026-09-07) ★
 *   위 8개가 전부 404 였다. 경로 이름은 **계정마다 다르다** —
 *   이카운트가 그 계정에 열어 준 OpenAPI 만 존재한다.
 *   그러니 밖에서 이름을 맞히는 건 운에 맡기는 일이다.
 *
 *   실제 목록은 이카운트 안에 있다:
 *     Self-Customizing → 정보관리 → API 인증키발급 (OpenAPI 안내)
 *
 *   거기서 본 이름을 아래 함수에 그대로 넣어 시험한다.
 *   되는 것이 확인되면 그때 대조를 그 경로로 옮긴다.
 */

/** [메뉴] 경로를 직접 넣어 시험한다 — 이카운트에서 확인한 이름을 그대로 */
function partnerTryEcountPath() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { return "UI 없음"; }

  var ans = ui.prompt(
    "이카운트 OpenAPI 경로 시험",
    "이카운트에서 확인한 경로를 넣으세요 (예: Purchases/GetPurchases)\n\n" +
      "Self-Customizing → 정보관리 → API 인증키발급 에서 볼 수 있습니다.\n" +
      "조회(Get) 경로만 넣으세요 — 저장(Save) 경로는 데이터를 바꿉니다.",
    ui.ButtonSet.OK_CANCEL
  );
  if (ans.getSelectedButton() !== ui.Button.OK) return "취소";
  var path = String(ans.getResponseText() || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path) return "빈 값";

  // 저장 경로를 실수로 넣는 것을 막는다. 조회 시험이 데이터를 바꾸면 안 된다.
  if (/save|delete|update|insert|remove/i.test(path)) {
    ui.alert("중단", "저장·삭제로 보이는 경로입니다:\n" + path +
      "\n\n조회(Get) 경로만 시험합니다.", ui.ButtonSet.OK);
    return "저장 경로 거부";
  }

  var L = ["═══ 경로 시험: " + path + " ═══", ""];
  var tz = "Asia/Seoul";
  var to = Utilities.formatDate(new Date(), tz, "yyyyMMdd");
  var from = Utilities.formatDate(
    new Date(new Date().getTime() - 7 * 24 * 3600 * 1000), tz, "yyyyMMdd");

  var auth;
  try { auth = _pts_ecLogin_(); }
  catch (e) { L.push("★ 로그인 실패: " + e.message); return _pepr_show_(L); }

  var url = "https://oapi" + auth.zone + ".ecount.com/OAPI/V2/" + path +
    "?SESSION_ID=" + encodeURIComponent(auth.sid);

  // 날짜 키 이름을 모르니 몇 가지로 시도하고, 빈 payload 도 한 번 던진다.
  // 빈 payload 의 에러 메시지가 필요한 필드 이름을 알려주는 경우가 많다.
  var tries = [{}];
  for (var t = 0; t < _PEPR_PAYLOADS_.length; t++) {
    var k = Object.keys(_PEPR_PAYLOADS_[t]);
    var b = {};
    b[k[0]] = from; b[k[1]] = to;
    tries.push(b);
  }

  for (var i = 0; i < tries.length; i++) {
    var label = Object.keys(tries[i]).length ? Object.keys(tries[i])[0] : "(빈 payload)";
    var code = 0, text = "";
    try {
      var res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(tries[i]),
        headers: { Accept: "application/json", Expect: "" },
        muteHttpExceptions: true,
      });
      code = res.getResponseCode();
      text = res.getContentText();
    } catch (eF) { text = "예외: " + eF.message; }

    L.push("[" + label + "] HTTP " + code);
    if (code === 404) { L.push("  경로 없음 — 이름을 다시 확인하세요."); break; }

    // 응답을 그대로 보여준다. 여기에 필요한 필드 이름이 들어 있다.
    L.push("  " + String(text).substring(0, 600));
    try {
      var j = JSON.parse(text);
      if (j && j.Data && j.Data.Result && j.Data.Result.length) {
        L.push("  ★ 자료 " + j.Data.Result.length + "건");
        L.push("  필드: " + Object.keys(j.Data.Result[0]).slice(0, 20).join(", "));
        try {
          PropertiesService.getScriptProperties()
            .setProperty(_PEPR_PATH_PROP_, path + "|" + label);
          L.push("  경로를 저장했습니다.");
        } catch (eS) { L.push("  경로 저장 실패: " + eS.message); }
        break;
      }
    } catch (eJ) {}
    L.push("");
  }
  return _pepr_show_(L);
}

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

/* ══════════════════════════════════════════════════════════════
 *  [진단] 이카운트 **판매(매출) 조회** API 를 찾는다 — 읽기 전용
 *  ★ 2026-09-09
 *
 *  > "이카운트 API로 불가능한거로 아는데 다시 한번 확인해줘..
 *  >  된다면 1번 메뉴가 필요하겠찌"
 *
 *  ★ 지금 아는 것 ★
 *    이 프로젝트가 실제로 쓰는 이카운트 경로는 일곱 개뿐이고,
 *    그중 **조회는 둘**이다.
 *        InventoryBasic/GetBasicProductsList        품목
 *        InventoryBalance/GetListInventoryBalanceStatus  재고
 *    나머지 다섯은 전부 저장(Save…)이다. **판매 조회는 없다.**
 *    구매 조회는 2026-09-07 에 여덟 이름을 찔러 봤고 전부 404 였다.
 *
 *  ★ 그래서 짐작하지 말고 찔러 본다 ★
 *    이카운트 OpenAPI 는 **계정마다 열린 경로가 다르다.** 밖에서 이름을
 *    맞히는 건 운이다. 그래도 흔한 이름 몇 개는 값이 싸니 한 번에 훑고,
 *    다 404 면 그때는 「이카운트 안의 목록을 봐야 한다」가 답이 된다.
 *
 *  ★ 아무것도 쓰지 않는다 ★
 *    Get 만 후보에 넣는다. 저장·삭제 경로는 넣지 않는다.
 * ══════════════════════════════════════════════════════════════ */

/** 찔러 볼 판매(매출) 조회 경로 후보 — 조회만 */
var _PEPS_PATHS_ = [
  "Sale/GetSaleList",
  "Sales/GetSalesList",
  "Sale/GetListSale",
  "Sales/GetListSales",
  "Sale/GetSaleSlipList",
  "Sale/GetListSaleSlip",
  "SaleBasic/GetSalesList",
  "Sale/GetSales",
  "Sales/GetSales",
  "Sale/GetListSales",
];

/**
 * 판매 조회 경로를 훑는다. 되는 것이 있으면 그 이름과 줄 수를 보여 준다.
 * 되는 것이 없으면 이카운트 안에서 목록을 보는 길을 알려 준다.
 */
function partnerProbeEcountSalesApi() {
  var L = ["═══ 이카운트 판매(매출) 조회 API 탐색 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];
  var tz = "Asia/Seoul";
  var to = Utilities.formatDate(new Date(), tz, "yyyyMMdd");
  var from = Utilities.formatDate(
    new Date(new Date().getTime() - 3 * 24 * 3600 * 1000), tz, "yyyyMMdd");

  var auth;
  try { auth = _pts_ecLogin_(); }
  catch (e) { L.push("★ 로그인 실패: " + e.message); return _pepr_show_(L); }
  L.push("로그인 OK · zone=" + auth.zone + " · 기간 " + from + "~" + to);
  L.push("");

  var found = "";
  for (var p = 0; p < _PEPS_PATHS_.length; p++) {
    var path = _PEPS_PATHS_[p];
    var url = "https://oapi" + auth.zone + ".ecount.com/OAPI/V2/" + path +
      "?SESSION_ID=" + encodeURIComponent(auth.sid);

    var best = "", bestRows = -1;
    for (var q = 0; q < _PEPR_PAYLOADS_.length; q++) {
      var body = {};
      var keys = Object.keys(_PEPR_PAYLOADS_[q]);
      body[keys[0]] = from;
      body[keys[1]] = to;

      var code = 0, text = "";
      try {
        var res = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(body),
          headers: { Accept: "application/json", Expect: "" },
          muteHttpExceptions: true
        });
        code = res.getResponseCode();
        text = res.getContentText();
      } catch (eF) { text = "호출 예외: " + eF.message; }

      var rows = -1, msg = "";
      try {
        var j = JSON.parse(text);
        if (j && j.Data && j.Data.Result) rows = j.Data.Result.length;
        msg = String((j && j.Error && (j.Error.Message || j.Error.MessageKey)) ||
          (j && j.Status) || "").substring(0, 80);
      } catch (eJ) { msg = String(text).substring(0, 80); }

      if (rows >= 0 && rows > bestRows) { bestRows = rows; best = keys.join('/'); }
      if (code !== 404 && !best) best = "HTTP " + code + " " + msg;
    }
    if (bestRows >= 0) {
      found = path;
      L.push("★ 됩니다 — " + path + "  (" + bestRows + "줄, 날짜키 " + best + ")");
    } else {
      L.push("  ✕ " + path + "  " + (best || "404"));
    }
  }

  L.push("");
  if (found) {
    L.push("판매 조회가 열려 있습니다: " + found);
    L.push("이 경로로 판매현황을 자동으로 불러올 수 있습니다.");
    L.push("응답의 열 이름을 확인한 뒤 세트분리 입력 형식에 맞추면 됩니다.");
  } else {
    L.push("★ 열려 있는 판매 조회 경로를 못 찾았습니다.");
    L.push("");
    L.push("이카운트 OpenAPI 는 **계정마다 열린 경로가 다릅니다.**");
    L.push("밖에서 이름을 맞히는 것은 여기까지가 한계입니다.");
    L.push("");
    L.push("확실한 길은 이카운트 안에 있습니다:");
    L.push("  Self-Customizing → 정보관리 → API 인증키발급 → OpenAPI 안내");
    L.push("거기 목록에 판매(매출) 조회가 있으면 그 이름을 그대로");
    L.push("「이카운트 경로 직접 시험」 에 넣어 확인하면 됩니다.");
    L.push("");
    L.push("목록에 없으면 이카운트가 그 계정에 안 열어 준 것이라,");
    L.push("지금처럼 엑셀을 내려받아 붙여넣는 것이 맞습니다.");
  }
  return _pepr_show_(L);
}
