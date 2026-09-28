/**
 * 구글챗 「입금알림」 방 — _partnerChatNotify.gs 와 같은 웹훅 방식
 * ★ 2026-09-28 신규
 *
 * ★ 방을 따로 쓴다 ★
 *   돈 정보다. CS·협력업체 방에 섞지 않고 회계 담당만 있는 방으로 보낸다.
 *   웹훅 주소는 _secrets.gs 의 DP_CHAT_WEBHOOK — 주소가 곧 글쓰기 권한이다.
 *
 * 알림이 실패해도 대장 기록은 이미 끝났다. 던지지 않고 기록만 남긴다.
 */

function _dp_chat_post_(payload) {
  var url = _dp_secret_("DP_CHAT_WEBHOOK");
  if (!url) return false;
  try {
    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 300) {
      PropertiesService.getScriptProperties().setProperty("DP_CHAT_FAIL",
        Utilities.formatDate(new Date(), "Asia/Seoul", "MM-dd HH:mm") + " · HTTP " + code);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log("[입금알림] 전송 실패: " + e.message);
    return false;
  }
}

function dpNotifyText_(text) {
  return _dp_chat_post_({ text: text });
}

function _dp_won_(n) {
  return n == null ? "-" : Number(n).toLocaleString() + "원";
}

/**
 * ★ 잔액은 챗에 안 싣는다 (2026-09-29) ★
 *   > "카드 내용에서 잔액은 표시 안되게 가능한가?"
 *   통장 잔액은 방에 있는 모든 사람에게 보인다. 잔액은 입금대장에만 두고
 *   (빠진 문자 감지에 쓴다), 챗에는 «맞는지 안 맞는지»만 말한다.
 *   은행 원문을 보여 줄 때도 잔액 숫자는 가린다.
 */
function _dp_hideBalance_(text) {
  return String(text || "").replace(/(잔액\s*:?\s*)-?[\d,]+\s*원?/g, "$1***");
}

function dpNotifyDeposit_(p, bal) {
  var rows = [
    { label: "입금자", value: p.name || "(이름 없음)" },
    { label: "금액", value: _dp_won_(p.amount) },
    { label: "거래일시", value: p.txAt },
    { label: "은행 · 계좌", value: (p.bank || "?") + " " + (p.account || "") }
  ];
  if (bal && bal.status === "불연속") {
    rows.push({ label: "⚠ 잔액 불연속",
      value: "사이에 빠진 문자가 있을 수 있습니다 — 입금대장을 확인해 주세요" });
  }
  var widgets = rows.map(function (r) {
    return { decoratedText: { topLabel: r.label, text: String(r.value) } };
  });
  _dp_chat_post_({
    cardsV2: [{
      cardId: "dp_" + Date.now(),
      card: {
        header: { title: "💰 입금 " + _dp_won_(p.amount) + " · " + (p.name || "?"), subtitle: p.txAt },
        sections: [{ widgets: widgets }]
      }
    }]
  });
}

function dpNotifyGap_(p, bal) {
  dpNotifyText_("⚠ 잔액 불연속 — " + (p.bank || "") + " " + (p.account || "") + " " + p.kind + " " +
    _dp_won_(p.amount) + " (" + p.txAt + ")\n사이에 빠진 입출금 문자가 있을 수 있습니다. 입금대장을 확인해 주세요.");
}

function dpNotifyUnparsed_(body, reason) {
  // 인증번호 등 입출금이 아닌 은행 문자도 여기로 온다. 원문은 앞부분만 보인다.
  var head = _dp_hideBalance_(String(body || "").replace(/\s+/g, " ")).slice(0, 80);
  dpNotifyText_("❓ 읽지 못한 은행 문자 (" + reason + ")\n" + head);
}
