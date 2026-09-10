/**
 * ══════════════════════════════════════════════════════════════
 *  파일보관소에 맡긴다 — 파일 소유자를 «회사»로
 *  ★ 2026-09-10 신규
 *
 *  > "회사 계정의 드라이브에 저장이 되야지..."
 *
 *  ★ 무엇이 문제였나 ★
 *    이 웹앱은 «접속한 사람» 권한으로 돈다(executeAs USER_ACCESSING).
 *    누가 들어왔는지 알아야 권한을 막을 수 있으니 그건 바꿀 수 없다.
 *    그런데 구글은 **파일을 만든 사람이 곧 소유자**다. 그래서 지금까지
 *    올라간 사진이 전부 직원 개인 지메일 소유가 되어 있었다:
 *
 *      반품 사진   2주치 전부 jskim721210@gmail.com
 *      보드 첨부   폴더 자체가 rkdtjgml486@gmail.com 개인 드라이브,
 *                 안의 파일은 개인 계정 «다섯 곳»에 흩어짐
 *
 *    직원이 계정을 정리하면 반품대장의 사진 링크가 통째로 죽는다.
 *    반품비를 다툴 때 근거로 쓰는 사진이다. 게다가 개인 15GB 를 회사 일이
 *    쓰고 있어서, 그 사람 용량이 차면 **그 사람만** 못 올리게 된다.
 *
 *  ★ 어떻게 고쳤나 ★
 *    파일 만드는 일만 떼어 «팩투유 권한으로 도는 웹앱»에 맡긴다.
 *    누가 올리든 소유자는 pack2u 다. 저장 위치는 「웹앱_이미지」 폴더.
 *
 *    설정은 _secrets.gs 에 둔다 (저장소에 안 들어간다):
 *      CS_FILESTORE_URL    보관소 주소
 *      CS_FILESTORE_TOKEN  열쇠 — 보관소 쪽 _secrets.gs 와 «같은 값»
 *
 *  ★ 실패하면 조용히 옛 방식으로 돌아간다 ★
 *    보관소가 안 뜨거나 토큰이 어긋나도 **사진은 올라가야 한다.**
 *    CS 가 고객과 통화하면서 올리는 것이라, 여기서 막히면 일이 멈춘다.
 *    그때는 예전처럼 각자 계정으로 만들되 «왜 그랬는지»를 로그에 남긴다.
 *    조용히 옛날로 돌아가서 아무도 모르는 것이 제일 나쁘다.
 * ══════════════════════════════════════════════════════════════
 */

/** 보관소 주소. _secrets.gs 가 없으면 빈 값 → 옛 방식으로 간다. */
function _cs_fs_url_() {
  try { if (typeof CS_FILESTORE_URL !== "undefined" && CS_FILESTORE_URL) return String(CS_FILESTORE_URL); } catch (e) {}
  return "";
}

function _cs_fs_token_() {
  try { if (typeof CS_FILESTORE_TOKEN !== "undefined" && CS_FILESTORE_TOKEN) return String(CS_FILESTORE_TOKEN); } catch (e) {}
  return "";
}

function _cs_fs_ready_() {
  return !!(_cs_fs_url_() && _cs_fs_token_());
}

/**
 * 파일 하나를 보관소에 맡긴다.
 *
 * @param {string} kind      "return" (반품 사진) | "board" (보드 첨부)
 * @param {Array<number>} bytes  Utilities.base64Decode 로 얻은 바이트
 * @param {string} mime
 * @param {string} name
 * @return {{ok:boolean, fileId:string, url:string, owner:string, error:string}}
 *   ok:false 면 부르는 쪽이 옛 방식(직접 createFile)으로 넘어가면 된다.
 */
function csFileStorePut(kind, bytes, mime, name) {
  if (!_cs_fs_ready_()) {
    return { ok: false, error: "보관소 설정 없음 (_secrets.gs)" };
  }
  try {
    var res = UrlFetchApp.fetch(_cs_fs_url_(), {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      /* ★ 로그인한 사람의 토큰을 실어 보낸다 ★  (2026-09-10)
         보관소를 «누구나(익명)» 로 열려고 했는데 Workspace 정책이 막았다.
         그래서 «구글 계정이 있으면 됨» 으로 두고, 부르는 쪽이 신원을 실어 준다.
         받는 쪽은 그래도 pack2u 권한으로 도므로(executeAs USER_DEPLOYING)
         **파일 소유자는 여전히 회사**다. 신원은 문을 여는 데만 쓴다.
         진짜 자물쇠는 본문의 토큰이다. */
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      /* 사진 한 장이 몇 MB 라 넉넉히 준다. 기본 60초로는 큰 장에서 끊긴다. */
      payload: JSON.stringify({
        token: _cs_fs_token_(),
        kind: kind,
        name: name,
        mimeType: mime,
        dataB64: Utilities.base64Encode(bytes)
      })
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code !== 200) {
      return { ok: false, error: "보관소 HTTP " + code + " " + text.substring(0, 200) };
    }
    var j;
    try {
      j = JSON.parse(text);
    } catch (eJ) {
      /* 로그인 화면(HTML)이 오면 여기로 온다 — 배포 권한이 안 열린 것이다. */
      return { ok: false, error: "보관소 응답을 읽지 못했습니다 (권한 미승인?) " + text.substring(0, 120) };
    }
    if (!j.ok) return { ok: false, error: "보관소: " + (j.error || "알 수 없는 오류") };
    return j;
  } catch (e) {
    return { ok: false, error: "보관소 호출 실패: " + ((e && e.message) || e) };
  }
}

/**
 * 보관소가 제대로 도는지 본다. 편집기에서 ▶ 실행.
 * 1바이트짜리 시험 파일을 올리고, **소유자가 누구로 찍히는지** 보여 준다.
 */
function csDiagnoseFileStore() {
  var out = ["파일보관소 점검", ""];
  out.push("주소   " + (_cs_fs_url_() ? "있음" : "★ 없음 (_secrets.gs CS_FILESTORE_URL)"));
  out.push("토큰   " + (_cs_fs_token_() ? "있음" : "★ 없음 (_secrets.gs CS_FILESTORE_TOKEN)"));
  if (_cs_fs_ready_()) {
    var r = csFileStorePut("board", Utilities.base64Decode(Utilities.base64Encode("ping")),
      "text/plain", "보관소점검_" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss") + ".txt");
    if (r.ok) {
      out.push("");
      out.push("올라감 ✅  소유자 " + r.owner);
      out.push("       " + r.url);
      out.push("");
      out.push(String(r.owner).indexOf("@pack2u.co.kr") > 0
        ? "→ 회사 계정 소유입니다. 제대로 돌고 있습니다."
        : "→ ★ 소유자가 회사 계정이 아닙니다. 보관소 설정을 봐야 합니다.");
      out.push("(이 시험 파일은 지우셔도 됩니다)");
    } else {
      out.push("");
      out.push("실패 ★ " + r.error);
    }
  }
  var msg = out.join(String.fromCharCode(10));
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}
