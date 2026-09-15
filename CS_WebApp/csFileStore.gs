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

/* 옛 파일보관소(별도 GAS 프로젝트)로 가던 길은 2026-09-11 에 걷어냈다.
   드라이브는 어느 계정에 붙이든 «그 사람» 용량을 쓴다 — v2 저장소로 옮겼다.
   _secrets.gs 의 CS_FILESTORE_URL·TOKEN 은 이제 안 쓴다. */

/**
 * 파일 하나를 맡긴다.
 *
 * ★ 2026-09-11: 구글 드라이브에서 «우리 쪽»으로 옮겼다 ★
 *   > "구글 드라이브 말고 우리 웹앱에 올리면 안될까?"
 *
 *   드라이브는 «사람»에게 붙은 저장소다. 접속자 권한으로 만들면 그 직원
 *   소유가 되고, 회사 계정으로 만들게 고쳤더니 이번엔 그 계정 용량에 걸렸다.
 *   누구에게 붙이든 한 사람 몫을 쓴다.
 *
 *   v2 의 저장소는 시스템 것이다. 소유자도 용량도 한 사람에게 매이지 않는다.
 *   돌려주는 모양은 그대로다(ok · fileId · url · owner) — 부르는 자리
 *   (반품·보드)를 안 고쳐도 된다.
 *
 * @param {string} kind      "return" | "board"
 * @param {Array<number>} bytes  Utilities.base64Decode 로 얻은 바이트
 * @return {{ok:boolean, fileId:string, url:string, owner:string, error:string}}
 */
function csFileStorePut(kind, bytes, mime, name) {
  var url = _cs_v2_url_(), tok = _cs_v2_token_();
  if (!url || !tok) return { ok: false, error: "v2 주소나 토큰이 없습니다 (_secrets.gs V2_URL · V2_INGEST_TOKEN)" };

  try {
    var res = UrlFetchApp.fetch(url + "/api/files/upload", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        token: tok,
        kind: kind,
        name: name,
        mimeType: mime,
        dataB64: Utilities.base64Encode(bytes)
      })
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code !== 200) return { ok: false, error: "v2 저장소 HTTP " + code + " " + text.substring(0, 200) };
    var j;
    try { j = JSON.parse(text); }
    catch (eJ) { return { ok: false, error: "v2 저장소 응답을 읽지 못했습니다: " + text.substring(0, 120) }; }
    if (!j.ok) return { ok: false, error: "v2 저장소: " + (j.error || "알 수 없는 오류") };
    return j;
  } catch (e) {
    return { ok: false, error: "v2 저장소 호출 실패: " + ((e && e.message) || e) };
  }
}

function _cs_v2_url_() {
  try { if (typeof V2_URL !== "undefined" && V2_URL) return String(V2_URL).replace(/[/]+$/, ""); } catch (e) {}
  return "";
}
function _cs_v2_token_() {
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) return String(V2_INGEST_TOKEN); } catch (e) {}
  return "";
}

/**
 * 보관소가 제대로 도는지 본다. 편집기에서 ▶ 실행.
 * 1바이트짜리 시험 파일을 올리고, **소유자가 누구로 찍히는지** 보여 준다.
 */
function csDiagnoseFileStore() {
  var out = ["파일보관소 점검", ""];
  out.push("v2 주소  " + (_cs_v2_url_() ? "있음" : "★ 없음 (_secrets.gs V2_URL)"));
  out.push("토큰     " + (_cs_v2_token_() ? "있음" : "★ 없음 (_secrets.gs V2_INGEST_TOKEN)"));
  if (_cs_v2_url_() && _cs_v2_token_()) {
    var r = csFileStorePut("board", Utilities.base64Decode(Utilities.base64Encode("ping")),
      "text/plain", "보관소점검_" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss") + ".txt");
    if (r.ok) {
      out.push("");
      out.push("올라감 ✅  소유자 " + r.owner);
      out.push("       " + r.url);
      out.push("");
      out.push(String(r.owner).indexOf("v2") >= 0
        ? "→ v2 저장소입니다. 개인 용량을 안 씁니다."
        : "→ ★ 소유자가 v2 가 아닙니다. 설정을 봐야 합니다.");
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
