/**
 * ══════════════════════════════════════════════════════════════
 *  업체가 «직접» 반품 접수를 요청한다
 *
 *  > 사장님: "업체가 직접 반품접수 하는거 진행하라고 전해줘"   (2026-10-07)
 *
 *  ★ 포털은 접수하지 않는다. «요청»만 남긴다 ★
 *    실제 로젠·롯데 호출은 CS웹앱이 한다(csLotteReturnPickupFromCard ·
 *    _lgr_pickupMany_). 그 로직은 주소 되짚기 · 운임 조회 · 박스별 접수 ·
 *    대장 기록까지 백 줄이 넘는다. 포털에 복사하면 **같은 것이 두 군데**가 되고,
 *    고칠 때 한쪽만 고치면 조용히 갈린다([[one-value-one-owner]]).
 *
 *    그래서 여기서는 대장 비고에 «요청 줄»만 적는다. CS웹앱의 시간 트리거가
 *    그 줄을 보고 실제로 접수한다.
 *
 *  ★ 요청 줄은 «업체에게 보이는 모양»으로 적는다 ★
 *    prpPublicTimeline_ 은 [yyMMdd HH:mm 작성자] 꼴이 아니면 아예 안 내보낸다.
 *    업체가 누른 흔적을 제 화면에서 못 보면 **눌렸는지 몰라 또 누른다** —
 *    그러면 접수가 두 번 나가고 기사가 두 번 온다.
 *
 *  ★ 두 번 눌러도 한 번만 나간다 ★
 *    이미 요청이 있거나 이미 접수된 건이면 거절한다. 화면도 단추를 감추지만
 *    화면만 믿지 않는다 — 새로고침 전에 두 번 누르는 일이 실제로 생긴다.
 * ══════════════════════════════════════════════════════════════
 */

/** 요청 줄에 붙이는 말. CS웹앱이 이것으로 찾는다 — 양쪽이 같아야 한다. */
var PRP_PICKUP_MARK_ = "반품접수 요청";

/**
 * 이미 처리됐다고 볼 흔적 — CS웹앱이 «실제로 적는 글자»와 같아야 한다.
 *   「반품접수 완료 …」 · 「반품접수 실패 — …」   csPickupRequests.gs 가 적는다
 *   「회수접수 · 원송장 … → 반품송장 …」          csLotteReturn.gs 가 적는다
 * 한쪽만 고치면 단추가 다시 나와 **접수가 두 번 나간다.**
 *
 * 실패한 건도 「처리됨」으로 본다 — 다시 눌러도 같은 이유로 또 실패할 것이고,
 * 사유가 업체 화면에 보이므로 사람이 봐야 할 자리다.
 */
var PRP_PICKUP_DONE_RE_ = /반품접수\s*(완료|실패)|회수접수\s*·|로젠접수\s*\d{10,}/;

/**
 * 챗 알림이 이 프로젝트에 심겨 있나.
 *
 * 값은 읽지 않는다 — «있는지 없는지»만 본다. 그 webhook 주소는 git 이력에 노출돼
 * 재발급 대기 중인 것이라, 어디에도 흘리지 않는다.
 */
function prpChatReady_() {
  try {
    return !!(PropertiesService.getScriptProperties()
      .getProperty(PRP_CHAT_WEBHOOK_PROP) || "");
  } catch (e) { return false; }
}

/**
 * 챗 알림이 제대로 심겼는지 «한 번에» 본다 — 편집기에서 손으로 돌린다.
 *
 * ★ 왜 ★  (2026-10-08)
 *   prpNotifyChat_ 은 속성이 비면 «조용히» 돌아선다. 그래서 주소를 심고도
 *   되는지 알 길이 없었다 — 업체가 누를 때까지 기다려야 했다.
 *   실제로 비어 있는 것을 2026-10-08 에야 알았다(대장 36행 「[내부] 챗 알림 미설정」).
 *
 *   이 함수는 **실제로 한 줄 보내 본다.** 챗에 글이 뜨면 끝난 것이다.
 *
 * ★ 주소는 안 보여 준다 ★ 로그에 찍히면 그 로그가 또 새는 자리가 된다.
 *   있는지·보냈는지만 말한다.
 */
function prpCheckChat() {
  var 있나 = prpChatReady_();
  if (!있나) {
    var 글0 = "★ 아직 비어 있습니다.\n\n" +
      "프로젝트 설정 → 스크립트 속성에 아래를 넣고 저장한 뒤 다시 돌려 주세요.\n" +
      "  속성  " + PRP_CHAT_WEBHOOK_PROP + "\n" +
      "  값    구글 챗 웹훅 주소 (https://chat.googleapis.com/... 로 시작합니다)";
    Logger.log(글0);
    return 글0;
  }

  var 때 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  try {
    prpNotifyChat_("업체 포털 알림 시험", "팩투유",
      때 + " 에 보낸 시험 글입니다. 이 글이 보이면 알림이 살아 있습니다.");
  } catch (e) {
    var 글1 = "★ 주소는 있는데 보내다 막혔습니다 — " + e.message;
    Logger.log(글1); return 글1;
  }

  var 글 = "✅ 주소가 심겨 있고, 시험 글을 보냈습니다 (" + 때 + ").\n\n" +
    "챗 스페이스에 「업체 포털 알림 시험」 이 떴으면 끝난 것입니다.\n" +
    "안 떴으면 주소가 다른 스페이스 것이거나 웹훅이 지워진 것입니다.";
  Logger.log(글);
  return 글;
}

/**
 * 이 줄이 지금 «요청할 수 있는» 상태인가.
 *
 * @return {{can:boolean, why:string}}  can=false 면 why 를 업체에게 보여준다
 */
function prpPickupState_(row, col) {
  var notice = String(col.notice >= 0 ? row[col.notice] || "" : "");

  //  이미 반품송장이 있으면 접수가 끝난 건이다
  var ret = "";
  if (col.returnInvoice >= 0) {
    try { ret = prpSplitLedgerInvoice_(row[col.returnInvoice]).번호 || ""; }
    catch (e) { ret = String(row[col.returnInvoice] || "").trim(); }
  }
  if (ret) return { can: false, why: "이미 회수 송장이 나왔습니다." };
  if (PRP_PICKUP_DONE_RE_.test(notice)) return { can: false, why: "이미 접수된 건입니다." };
  if (notice.indexOf(PRP_PICKUP_MARK_) !== -1) {
    return { can: false, why: "이미 접수를 요청하셨습니다. 잠시 뒤 회수 송장이 붙습니다." };
  }

  //  원송장이 없으면 어디서 가져올지 모른다
  var inv = "";
  if (col.invoice >= 0) {
    try { inv = prpSplitLedgerInvoice_(row[col.invoice]).번호 || ""; }
    catch (e) { inv = String(row[col.invoice] || "").trim(); }
  }
  if (!String(inv).replace(/[^0-9]/g, "")) {
    return { can: false, why: "원송장 번호가 없어 접수할 수 없습니다. 팩투유에 알려 주세요." };
  }

  return { can: true, why: "" };
}

/**
 * 업체가 「반품접수」를 누름 — 요청만 남긴다.
 *
 * @param {string} sid
 * @param {{tab:string, row:number}} payload
 */
function prpRequestPickup(sid, payload) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  payload = payload || {};

  try {
    var ctx = prpOpenOwnedRow_(g.sess, payload.tab, payload.row);
    if (ctx.col.notice < 0) return { ok: false, error: "비고 열을 찾지 못했습니다." };

    /*  ★ 화면만 믿지 않는다 ★ 새로고침 전에 두 번 누르는 일이 실제로 생긴다.
        여기서 한 번 더 본다 — 두 번 나가면 기사가 두 번 온다. */
    var st = prpPickupState_(ctx.row, ctx.col);
    if (!st.can) return { ok: false, error: st.why };

    /*  ★ 「언제쯤 되는지」를 같이 적는다 ★
        실제 접수는 CS웹앱이 1시간마다 한다. 업체 눈에는 「눌렀는데 아무 일도
        없는」 시간이라, 얼마나 기다리면 되는지 적어 두지 않으면 또 누른다. */
    var notice = String(ctx.row[ctx.col.notice] || "").trim();
    notice = prpAppendNoticeLine_(notice,
      prpStamp_(PRP_STAFF_PREFIX + g.sess.vendor) + " " + PRP_PICKUP_MARK_ +
      ". 1시간 안에 접수됩니다.");
    ctx.tab.getRange(ctx.rowNum, ctx.col.notice + 1).setValue(notice);

    prpInvalidateVendorCache_(g.sess.key);
    prpLog_(g.sess.vendor, "반품접수요청", payload.tab + " " + payload.row + "행");

    /*  CS 에게도 알린다. 비고에만 쌓이면 그 건을 열어 보지 않는 한 모른다 —
        접수는 트리거가 하지만, 사람도 알고 있어야 한다. 실패해도 요청은 살린다. */
    try {
      prpNotifyChat_("업체 반품접수 요청", g.sess.vendor,
        (ctx.col.name >= 0 ? String(ctx.row[ctx.col.name] || "").trim() : "") + " · " +
        (ctx.col.item >= 0 ? String(ctx.row[ctx.col.item] || "").trim() : ""));
    } catch (e) {}

    /*  ★ 알림이 «조용히» 안 나갔을 때를 드러낸다 ★
        prpNotifyChat_ 은 webhook 속성이 비면 아무 말 없이 돌아선다. 포털은 CS웹앱과
        다른 프로젝트라 속성이 따로다 — 비어 있어도 여기서는 멀쩡해 보인다.
        그러면 「요청만 쌓이고 아무도 모르는」 자리가 그대로 되살아난다.

        그 상태를 비고에 한 줄 남긴다. [내부] 로 시작하므로 prpPublicTimeline_ 이
        걸러 내고 업체 화면에는 안 보인다 — CS 가 그 줄에서 보게 된다.
        접수 자체는 1시간 트리거가 하므로 이 줄이 있어도 일은 그대로 진행된다. */
    try {
      if (!prpChatReady_()) {
        var n2 = String(ctx.tab.getRange(ctx.rowNum, ctx.col.notice + 1).getDisplayValue() || "");
        ctx.tab.getRange(ctx.rowNum, ctx.col.notice + 1).setValue(
          prpAppendNoticeLine_(n2,
            "[내부] 챗 알림 미설정 — 포털 스크립트 속성 " + PRP_CHAT_WEBHOOK_PROP + " 가 비어 있습니다"));
      }
    } catch (e) {}

    return { ok: true,
      message: "접수를 요청했습니다. 회수 송장이 붙으면 여기에 보입니다." };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
