/**
 * [협력업체] Google Chat 알림 시스템
 * 파일: _partnerChatNotify.gs
 *
 * 주요 이벤트 발생 시 Google Chat 스페이스로 자동 알림 전송
 * Webhook 방식 (별도 인증 불필요)
 */

/**
 * ★ 웹훅 주소는 _secrets.gs 에 있다 ★  (2026-09-14)
 *
 *   이 파일은 깃에 올라간다. URL 안의 key·token 이 곧 «그 방에 글을 올릴
 *   권한»이라, 저장소를 읽을 수 있는 사람이면 누구나 팀 방에 글을 넣을 수
 *   있었다. CS_WebApp/_secrets_guard_test 가 그걸 잡아 줬다.
 *
 *   못 읽으면 «빈 문자열»을 준다 — 알림은 조용히 안 가고, _chat_diagnose_
 *   가 그 사실을 말한다. 여기에 값을 다시 적으면 안 된다.
 */
var _CHAT_WEBHOOK_URL_ =
  (typeof CHAT_WEBHOOK_URL === "string" && CHAT_WEBHOOK_URL) ? CHAT_WEBHOOK_URL : "";

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
/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 트리거 자리가 차 가면 «밤 알림이» 먼저 말한다 ★  (2026-09-15)
 *
 *  > "업무시간에 이런 오류 발생하면 함부로 실행을 못해.. 루틴이 있는데"
 *  > "그렇다고 또 일회성 검증 메뉴를 만들면 메뉴만 수백개..."
 *
 *  한 스크립트 프로젝트에 트리거는 20개까지다. 다 차면 백그라운드 예약이
 *  실패하고, 마감이 즉시 처리로 떨어져 6분 한도에 걸려 죽는다.
 *  2026-09-10 부터 대리판매 마감이 그렇게 막혀 있었다.
 *
 *  ★ 알아내려고 «실행»해야 한다면 그건 진단이 아니다 ★
 *    업무시간에 마감을 눌러 봐야만 알 수 있다면 못 쓴다. 루틴이 꼬인다.
 *  ★ 그렇다고 점검 메뉴를 만들지 않는다 ★
 *    메뉴가 수백 개가 된다. 찾는 것부터 일이 된다.
 *
 *  이미 밤마다 오는 알림에 «문제일 때만» 한 줄을 얹는다. 평소엔 아무 말도
 *  안 한다. 자리가 차 가면 사람이 누르지 않아도 저절로 눈에 들어온다.
 * ══════════════════════════════════════════════════════════════
 */
var _CHAT_TRIGGER_WARN_AT_ = 18;   // 20 자리 중 이만큼 차면 미리 말한다

function _chat_triggerPressure_() {
  try {
    var n = ScriptApp.getProjectTriggers().length;
    if (n < _CHAT_TRIGGER_WARN_AT_) return '';
    return '⚠ 트리거 ' + n + '/20 — 다 차면 마감의 백그라운드 예약이 막힙니다';
  } catch (e) { return ''; }
}

function _chat_sendCard_(title, subtitle, keyValues, footerText) {
  if (!_CHAT_WEBHOOK_URL_) return;
  var 압박 = _chat_triggerPressure_();
  if (압박) footerText = footerText ? (footerText + ' · ' + 압박) : 압박;
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
