/**
 * ══════════════════════════════════════════════════════════════
 *  [협력업체] 명세서 — PDF·이미지 첨부를 AI 로 읽는다
 *  파일: _partnerStatementVision.gs
 *  2026-09-07
 *
 *  ★ 왜 필요한가 ★
 *    실제로 받는 명세서 첨부가 엑셀이 아니었다.
 *      (주)로엔그린          → BIZMAIL_....JPG        (웹캐시 비즈메일)
 *      주식회사준테크피에스와이 → ..._거래명세표.pdf     (매직빌)
 *    기존 파서는 xlsx·xls·텍스트만 읽어서 이 둘은 통째로 건너뛴다.
 *    읽지 못하면 자동화에 아무 의미가 없다.
 *
 *  ★ 어떻게 ★
 *    Gemini 에 첨부를 그대로 넘겨 표를 JSON 으로 받는다.
 *    CS 웹앱의 ocrInvoiceImage() 가 같은 방식으로 이미 돌고 있다 —
 *    새로 증명할 게 아니라 검증된 경로를 한 번 더 쓰는 것이다.
 *
 *  ★ 출력을 왜 행렬로 돌려주나 ★
 *    「명세서_원본」에 그대로 붙일 수 있는 모양으로 낸다.
 *    그러면 그 뒤는 손댈 게 없다 — 기존 ② 파싱 → ③ 비교(구매입력 대조 포함)가
 *    엑셀로 받은 명세서와 똑같이 흘러간다. 읽는 방법만 하나 늘리는 것이다.
 *
 *  ★ 조심한 것 ★
 *    · 숫자를 지어내지 않게 한다. 안 보이면 빈칸으로 두라고 명시한다.
 *      명세서는 돈이 걸린 문서다. 그럴듯한 값이 실제 값보다 나쁘다.
 *    · 합계를 따로 받아 라인 합과 비교한다. 어긋나면 표시해 사람이 본다.
 *    · 한 번 읽은 첨부는 캐시한다. 같은 메일을 두 번 읽어 돈을 두 번 쓰지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

var _PSTMTVIS_MODEL_ = "gemini-3.6-flash";

/** 이 확장자만 AI 로 넘긴다 */
var _PSTMTVIS_MIME_ = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** 「명세서_원본」에 넣을 머리글 — GENERIC 프로필이 읽는 이름과 맞춘다 */
var _PSTMTVIS_HEADERS_ = [
  "일자", "품목명", "규격", "수량", "단가", "공급가액", "부가세", "비고",
];

/**
 * 허브 키. geminiChat.gs 는 전역을 바로 쓰지만, 키가 없을 때
 * 파일 로드 자체가 죽으면 다른 기능까지 같이 멈춘다. 감싸서 읽는다.
 */
function _pstmtvis_key_() {
  if (typeof GEMINI_API_KEY !== "undefined" && GEMINI_API_KEY) return String(GEMINI_API_KEY);
  try {
    var k = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (k) return String(k);
  } catch (e) {}
  return "";
}

/** 파일명으로 MIME 을 정한다. Gmail 첨부는 대개 application/octet-stream 으로 온다. */
function _pstmtvis_mimeOf_(fileName, blobType) {
  var m = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)\s*$/);
  if (m && _PSTMTVIS_MIME_[m[1]]) return _PSTMTVIS_MIME_[m[1]];
  var bt = String(blobType || "").toLowerCase();
  if (bt.indexOf("pdf") !== -1) return "application/pdf";
  if (bt.indexOf("image/") === 0) return bt;
  return "";
}

/** AI 로 읽을 수 있는 첨부인가 */
function _pstmtvis_canRead_(fileName, blobType) {
  return !!_pstmtvis_mimeOf_(fileName, blobType);
}

/**
 * 첨부 하나를 읽어 「명세서_원본」용 행렬로 돌려준다.
 *
 * @param blob      첨부 Blob
 * @param fileName  파일명 (MIME 판정용)
 * @return {ok, rows[][], meta{vendor,bizNo,date,supply,vat,total,lineSum,mismatch}, error}
 */
function _pstmtvis_read_(blob, fileName) {
  var out = { ok: false, rows: [], meta: {}, error: "" };

  var key = _pstmtvis_key_();
  if (!key) {
    out.error = "Gemini API 키가 없습니다 (_secrets.gs 또는 스크립트 속성 GEMINI_API_KEY)";
    return out;
  }
  var mime = _pstmtvis_mimeOf_(fileName, blob && blob.getContentType && blob.getContentType());
  if (!mime) {
    out.error = "AI 가 읽을 수 없는 형식: " + fileName;
    return out;
  }

  var prompt =
    "이것은 거래명세표(거래명세서)입니다. 표를 읽어 JSON 만 출력하세요. 다른 말은 쓰지 마세요.\n\n" +
    "★ 가장 중요한 규칙 ★\n" +
    "- 문서에 보이지 않는 값은 절대 지어내지 마세요. 안 보이면 빈 문자열 \"\" 로 두세요.\n" +
    "- 숫자는 쉼표를 빼고 숫자만 적으세요. 금액에 원 같은 단위를 붙이지 마세요.\n" +
    "- 표에 있는 품목 줄만 넣으세요. 합계·소계·전잔액 줄은 lines 에 넣지 말고 totals 에 넣으세요.\n" +
    "- 줄 수를 임의로 줄이거나 합치지 마세요. 표에 보이는 그대로 한 줄씩 넣으세요.\n" +
    // 실측: 준테크 「09/07 JH 신5칸도시락세트(200SET)」, 로엔그린 「09/07 핫컵 12oz…」
    //   날짜가 품목명 앞에 붙어 온다. 그대로 두면 품목 매칭이 실패한다.
    "- 품목명 앞에 09/07 같은 날짜가 붙어 있으면 date 로 옮기고 itemName 에서 빼세요.\n" +
    // 실측: 로엔그린은 「단위 1000 / 수량 1」 — 단위가 묶음 크기다. 수량 칸만 쓴다.
    "- 「단위」 칸(SET·box·1000 등)은 수량이 아닙니다. qty 에는 「수량」 칸 값만 넣으세요.\n" +
    // 실측: 로엔그린 비고에 수취인 이름(안효제·임승만)이 들어온다. 같은 품목을
    //   이것으로만 구분하므로 반드시 살려야 한다.
    "- 「비고」 칸은 사람 이름 등이 들어옵니다. 빠뜨리지 말고 note 에 그대로 넣으세요.\n" +
    // 실측: 로엔그린 명세서에 「택배비」가 품목 줄로 들어온다. 품목이 아니지만 청구분이다.
    "- 「택배비」 같은 비용 줄도 품목 줄로 취급해 lines 에 넣으세요.\n" +
    "- 공급자(발행회사)와 공급받는자를 헷갈리지 마세요. vendor·bizNo 는 **공급자** 것입니다.\n\n" +
    "{\n" +
    "  \"vendor\": \"공급자(발행회사) 상호\",\n" +
    "  \"bizNo\": \"공급자 사업자등록번호 (숫자 10자리, 하이픈 제외)\",\n" +
    "  \"date\": \"작성일자 (yyyy-MM-dd)\",\n" +
    "  \"lines\": [\n" +
    "    {\n" +
    "      \"date\": \"그 줄의 일자 (없으면 \\\"\\\")\",\n" +
    "      \"itemName\": \"품목명\",\n" +
    "      \"spec\": \"규격\",\n" +
    "      \"qty\": \"수량 (숫자)\",\n" +
    "      \"unitPrice\": \"단가 (숫자)\",\n" +
    "      \"supplyAmt\": \"공급가액 (숫자)\",\n" +
    "      \"vatAmt\": \"부가세 (숫자)\",\n" +
    "      \"note\": \"적요/비고\"\n" +
    "    }\n" +
    "  ],\n" +
    "  \"totals\": { \"supply\": \"공급가액 합계\", \"vat\": \"세액 합계\", \"total\": \"합계금액\" }\n" +
    "}";

  var payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType: mime, data: Utilities.base64Encode(blob.getBytes()) } },
      ],
    }],
    // 명세서는 숫자를 옮기는 일이다. 창의성이 낄 자리가 없다.
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };

  var res;
  try {
    res = UrlFetchApp.fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        _PSTMTVIS_MODEL_ + ":generateContent?key=" + key,
      {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );
  } catch (eF) {
    out.error = "호출 실패: " + eF.message;
    return out;
  }

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    out.error = "HTTP " + code + " " + String(body).substring(0, 200);
    return out;
  }

  var text = "";
  try {
    var j = JSON.parse(body);
    text = j.candidates[0].content.parts[0].text;
  } catch (eP) {
    out.error = "응답 해석 실패: " + String(body).substring(0, 200);
    return out;
  }

  var data;
  try {
    // responseMimeType 을 줘도 모델이 ```json 울타리를 붙이는 경우가 있다
    data = JSON.parse(String(text).replace(/^\s*```(json)?/i, "").replace(/```\s*$/, "").trim());
  } catch (eJ) {
    out.error = "JSON 아님: " + String(text).substring(0, 200);
    return out;
  }

  var lines = (data && data.lines) || [];
  if (!lines.length) {
    out.error = "표에서 품목 줄을 찾지 못했습니다";
    return out;
  }

  var rows = [_PSTMTVIS_HEADERS_.slice()];
  var lineSum = 0;
  var dropped = 0;
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i] || {};
    var sup = _pstmtvis_num_(ln.supplyAmt);
    var qv = _pstmtvis_num_(ln.qty);

    // ★ 수량 0 · 금액 0 인 줄은 거래가 아니다 (2026-09-07) ★
    //   인터웍스 명세서를 보니 취급 품목을 매번 전부 찍고 실제 거래분에만
    //   수량이 있다. 7줄 중 3줄만 실제 거래였다.
    //   그대로 넣으면 비교표가 "구매입력 없음" 으로 뒤덮여 진짜 문제가 묻힌다.
    //   단가는 있어도 수량·금액이 둘 다 0 이면 카탈로그 줄이다.
    if (qv === 0 && sup === 0) { dropped++; continue; }

    lineSum += sup;
    rows.push([
      String(ln.date || data.date || ""),
      String(ln.itemName || ""),
      String(ln.spec || ""),
      qv,
      _pstmtvis_num_(ln.unitPrice),
      sup,
      _pstmtvis_num_(ln.vatAmt),
      String(ln.note || ""),
    ]);
  }

  var totals = (data && data.totals) || {};
  var declared = _pstmtvis_num_(totals.supply);
  out.meta = {
    vendor: String(data.vendor || ""),
    bizNo: String(data.bizNo || "").replace(/[^\d]/g, ""),
    date: String(data.date || ""),
    supply: declared,
    vat: _pstmtvis_num_(totals.vat),
    total: _pstmtvis_num_(totals.total),
    lineSum: lineSum,
    dropped: dropped, // 수량·금액 0 인 카탈로그 줄
    // 라인 합과 문서 합계가 다르면 줄을 빠뜨렸거나 잘못 읽은 것이다.
    // 조용히 넘기면 안 되는 신호라 그대로 실어 보낸다.
    mismatch: !!(declared && Math.abs(declared - lineSum) > 1),
  };
  // 머리글만 남았다 = 실제 거래 줄이 하나도 없다.
  // 카탈로그만 찍힌 명세서이거나 판독이 어긋난 것이다. 넣지 않는다.
  if (rows.length < 2) {
    out.error = "실제 거래 줄이 없습니다 (수량·금액 0 인 줄만 " + dropped + "개)";
    return out;
  }

  out.rows = rows;
  out.ok = true;
  return out;
}

function _pstmtvis_num_(v) {
  if (typeof v === "number" && !isNaN(v)) return v;
  var s = String(v == null ? "" : v).replace(/,/g, "").replace(/[^\d.\-]/g, "").trim();
  if (!s) return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ───────────────────────────────────────────────────────────
//  단독 시험
// ───────────────────────────────────────────────────────────

/**
 * [메뉴] 안 읽힌 명세서 첨부 하나를 AI 로 시험 삼아 읽어 본다.
 * 아무것도 쓰지 않는다 — 읽히는지만 본다.
 */
function partnerTestStatementVision() {
  var L = ["═══ 명세서 AI 판독 시험 ═══", ""];
  try {
    if (!_pstmtvis_key_()) {
      L.push("★ Gemini API 키가 없습니다.");
      return _pstmtvis_show_(L);
    }
    var threads = GmailApp.search(_PSTMT_GMAIL_SEARCH_BASE_, 0, 10);
    var done = 0;
    for (var t = 0; t < threads.length && done < 2; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length && done < 2; m++) {
        var atts = msgs[m].getAttachments();
        for (var a = 0; a < atts.length && done < 2; a++) {
          var nm = atts[a].getName();
          if (!_pstmtvis_canRead_(nm, atts[a].getContentType())) continue;

          L.push("[" + nm + "]");
          var t0 = new Date().getTime();
          var r = _pstmtvis_read_(atts[a], nm);
          var secs = Math.round((new Date().getTime() - t0) / 1000);
          if (!r.ok) {
            L.push("  ★ " + r.error + "  (" + secs + "초)");
          } else {
            L.push("  공급자: " + r.meta.vendor + "  사업자 " + (r.meta.bizNo || "(없음)"));
            L.push("  작성일: " + r.meta.date + "  · 거래 " + (r.rows.length - 1) + "줄" +
              (r.meta.dropped ? " (카탈로그 " + r.meta.dropped + "줄 제외)" : "") +
              "  (" + secs + "초)");
            L.push("  합계 " + r.meta.supply + " / 라인합 " + r.meta.lineSum +
              (r.meta.mismatch ? "  ★ 불일치" : "  ✔"));
            for (var k = 1; k < Math.min(r.rows.length, 4); k++) {
              L.push("    " + r.rows[k].slice(0, 6).join(" | "));
            }
          }
          L.push("");
          done++;
        }
      }
    }
    if (!done) L.push("읽을 만한 PDF·이미지 첨부를 못 찾았습니다.");
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _pstmtvis_show_(L);
}

function _pstmtvis_show_(L) {
  var text = L.join("\n");
  Logger.log(text);
  try {
    SpreadsheetApp.getUi().alert("명세서 AI 판독", text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
  return text;
}
