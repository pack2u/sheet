/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 송장 사진 글자 인식 (선택 기능)
 *
 *  업체가 접수할 때 송장을 찍으면 바코드를 먼저 읽고(클라이언트),
 *  바코드가 접혔거나 지워져 실패하면 여기로 넘어와 인쇄된 숫자를 읽는다.
 *
 *  Gemini 키는 스크립트 속성 GEMINI_API_KEY 에 넣는다.
 *  키가 없으면 이 단계는 조용히 건너간다 — 바코드 인식과 직접 입력은 그대로 된다.
 * ══════════════════════════════════════════════════════════════
 */

function prpGeminiKey_() {
  try {
    return PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";
  } catch (e) {
    return "";
  }
}

/**
 * 사진에서 송장번호를 읽는다.
 * @param {string} base64Data 리사이즈된 JPEG base64 (dataURL 접두 제외)
 * @param {string} mimeType
 * @return {{ok:boolean, invoice:string, error:string}}
 */
function prpOcrImageForScan(base64Data, mimeType) {
  try {
    if (!base64Data) return { ok: false, error: "이미지가 비어 있습니다." };

    var apiKey = prpGeminiKey_();
    if (!apiKey) return { ok: false, error: "글자 인식이 설정되지 않았습니다. 송장번호를 직접 입력해 주세요." };

    var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=" + apiKey;
    var prompt =
      "이 택배 송장 이미지에서 송장번호만 찾아 JSON 으로 출력하세요.\n" +
      "다른 텍스트는 절대 포함하지 마세요. 찾을 수 없으면 빈 문자열로 두세요.\n" +
      '{"invoiceNumber":"숫자만"}';

    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || "image/jpeg", data: base64Data } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 }
      }),
      muteHttpExceptions: true,
      headers: { "Expect": "" }
    });

    var json = JSON.parse(res.getContentText());
    if (json.error) return { ok: false, error: "인식 서버 오류: " + json.error.message };

    var text = "";
    try { text = json.candidates[0].content.parts[0].text; } catch (eT) {}
    var m = String(text || "").match(/\{[\s\S]*\}/);
    var inv = "";
    if (m) {
      try { inv = prpDigits_(JSON.parse(m[0]).invoiceNumber); } catch (eJ) {}
    }
    if (!inv) inv = prpPickInvoiceLikeDigits_(text);

    return {
      ok: inv.length >= 8,
      invoice: inv,
      error: inv.length >= 8 ? "" : "사진에서 송장번호를 찾지 못했습니다."
    };
  } catch (e) {
    return { ok: false, error: "글자 인식 오류: " + e.message };
  }
}

/** 전화번호를 걸러내고 송장번호 형태(10~14자리)만 고른다 */
function prpPickInvoiceLikeDigits_(s) {
  var groups = String(s || "").match(/[0-9][0-9\-\s]{8,}[0-9]/g) || [];
  var best = "";
  for (var i = 0; i < groups.length; i++) {
    var d = prpDigits_(groups[i]);
    if (d.length < 10 || d.length > 14) continue;
    if (/^01[0-9]{8,9}$/.test(d)) continue;
    if (/^0[2-6][0-9]{7,9}$/.test(d)) continue;
    if (d.length > best.length) best = d;
  }
  return best;
}
