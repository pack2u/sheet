/**
 * [협력업체] Google Chat 알림 시스템
 * 파일: _partnerChatNotify.gs
 *
 * 주요 이벤트 발생 시 Google Chat 스페이스로 자동 알림 전송
 * Webhook 방식 (별도 인증 불필요)
 */

var _CHAT_WEBHOOK_URL_ =
  "https://chat.googleapis.com/v1/spaces/AAQA-mgg-f0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=6eJY5mRml0dM-bYOS3BvlAGC_Jk0Eaiz7K1Ds7bIS1I";

// ══════════════════════════════════════════════
//  핵심: 메시지 전송
// ══════════════════════════════════════════════

/**
 * Google Chat으로 텍스트 메시지 전송
 * @param {string} text - 전송할 메시지 (마크다운 지원)
 */
function _chat_sendText_(text) {
  if (!_CHAT_WEBHOOK_URL_) return;
  try {
    UrlFetchApp.fetch(_CHAT_WEBHOOK_URL_, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log("[CHAT] 전송 실패: " + e.message);
  }
}

/**
 * Google Chat으로 카드 메시지 전송
 * @param {string} title - 카드 제목
 * @param {string} subtitle - 부제목 (시간 등)
 * @param {Array} keyValues - [{label, value}] 배열
 * @param {string} [footerText] - 하단 텍스트
 */
function _chat_sendCard_(title, subtitle, keyValues, footerText) {
  if (!_CHAT_WEBHOOK_URL_) return;
  try {
    var widgets = [];
    for (var i = 0; i < keyValues.length; i++) {
      widgets.push({
        decoratedText: {
          topLabel: keyValues[i].label,
          text: String(keyValues[i].value),
        },
      });
    }
    if (footerText) {
      widgets.push({
        decoratedText: {
          topLabel: "",
          text: "<font color=\"#999999\">" + footerText + "</font>",
        },
      });
    }
    var card = {
      cardsV2: [
        {
          cardId: "notify_" + Date.now(),
          card: {
            header: {
              title: title,
              subtitle: subtitle,
            },
            sections: [{ widgets: widgets }],
          },
        },
      ],
    };
    UrlFetchApp.fetch(_CHAT_WEBHOOK_URL_, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      payload: JSON.stringify(card),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log("[CHAT] 카드 전송 실패: " + e.message);
  }
}

// ══════════════════════════════════════════════
//  이벤트별 알림 함수
// ══════════════════════════════════════════════

/** 발주 수집 완료 알림 */
function _chat_notifyCollectOrders_(newCount, skipped, errors) {
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var kv = [
    { label: "✅ 신규 수집", value: newCount + "건" },
    { label: "⏭ 스킵", value: skipped + "건" },
  ];
  if (errors && errors.length > 0) {
    kv.push({ label: "❌ 오류", value: errors.length + "건" });
  }
  _chat_sendCard_("📦 발주 수집 완료", now, kv);
}

/** 대리발주 Push 완료 알림 */
function _chat_notifyExclusivePush_(pushed, pushedByPfx, skipTotal, errors) {
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var kv = [{ label: "✅ Push", value: pushed + "건" }];
  // 업체별 상세
  var pfxKeys = Object.keys(pushedByPfx || {}).sort(function (a, b) {
    return (pushedByPfx[b] || 0) - (pushedByPfx[a] || 0);
  });
  if (pfxKeys.length > 0) {
    var detail = pfxKeys
      .map(function (k) {
        return k + " " + pushedByPfx[k];
      })
      .join(", ");
    kv.push({ label: "📋 업체별", value: detail });
  }
  if (skipTotal > 0) {
    kv.push({ label: "⏭ 스킵", value: skipTotal + "건" });
  }
  if (errors && errors.length > 0) {
    kv.push({
      label: "❌ 오류",
      value: errors.slice(0, 3).join("\n"),
    });
  }
  _chat_sendCard_("📋 대리발주 Push 완료", now, kv);
}

/** 마감 이동 완료 알림 */
function _chat_notifyArchive_(moved, kept, tabsCleared, uidCleared) {
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  _chat_sendCard_("📁 전용발주 마감 이동", now, [
    { label: "📦 이동", value: moved + "행" },
    { label: "🔵 잔류", value: kept + "행" },
    { label: "📋 처리 탭", value: tabsCleared + "개" },
    { label: "🔄 UID 초기화", value: uidCleared + "건" },
  ]);
}

/** 송장 수집 완료 알림 */
function _chat_notifyInvoiceFetch_(matched, unmatched) {
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  _chat_sendCard_("📬 송장 수집 완료", now, [
    { label: "✅ 매칭", value: matched + "건" },
    { label: "⚠ 미매칭", value: unmatched + "건" },
  ]);
}

/** 임시기록 Push 완료 알림 */
function _chat_notifyTempPush_(pushed, pushedByPfx, skipTotal) {
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  var kv = [{ label: "✅ Push", value: pushed + "건" }];
  var pfxKeys = Object.keys(pushedByPfx || {});
  if (pfxKeys.length > 0) {
    var detail = pfxKeys
      .map(function (k) {
        return k + " " + pushedByPfx[k];
      })
      .join(", ");
    kv.push({ label: "📋 업체별", value: detail });
  }
  if (skipTotal > 0) {
    kv.push({ label: "⏭ 스킵", value: skipTotal + "건" });
  }
  _chat_sendCard_("📋 임시기록 Push 완료", now, kv);
}

/** 테스트 전송 */
function chatNotifyTest() {
  _chat_sendCard_(
    "🔔 알림 테스트",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
    [
      { label: "상태", value: "✅ 연결 정상" },
      { label: "시스템", value: "Pack2U 협력업체 관리" },
    ],
    "이 메시지가 보이면 Google Chat 알림이 정상 작동합니다."
  );
  SpreadsheetApp.getUi().alert("✅ 테스트 메시지를 전송했습니다.\nGoogle Chat을 확인하세요.");
}
