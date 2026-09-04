/**
 * ══════════════════════════════════════════════════════════════
 *  중복 발주 점검 — 같은 주문이 두 차수에 걸쳐 들어왔는가
 *  파일: _partnerDupOrderCheck.gs
 *  대상: 상품정보 시트 「대리공급_임시기록」
 *
 *  ★ 차수 도장이 생겨서 가능해진 점검이다 ★
 *    B열에 "0901-1" 처럼 회차가 찍히기 전에는, 임시기록에 같은 주문이
 *    두 줄 있어도 그게 "한 번의 푸시가 두 줄 쓴 것"인지 "오전·오후에
 *    각각 들어온 것"인지 구분할 수 없었다. 이제 구분된다.
 *
 *  ★ 왜 자동으로 막지 않고 알리기만 하나 ★
 *    같은 사람이 같은 품목을 하루에 두 번 주문하는 일은 실제로 있다
 *    (추가 주문·수량 정정). 기계가 지워 버리면 진짜 주문이 사라진다.
 *    사라진 주문은 아무도 모르지만, 중복 발주는 물건이 두 번 나가서
 *    바로 드러난다. 그래서 판단은 사람에게 남긴다.
 *
 *  ★ 판정 두 단계 ★
 *    확실 — 사방넷주문번호(P열)가 같은 줄이 2개 이상.
 *           같은 소스 주문이 두 번 푸시된 것이다. 변명의 여지가 없다.
 *    의심 — 주문번호는 다른데 수취인·전화·품목코드가 같고 차수가 다름.
 *           표기 차이로 고유ID가 갈려 중복 판정을 빠져나간 경우다.
 *           진짜 추가 주문일 수도 있으니 사람이 봐야 한다.
 * ══════════════════════════════════════════════════════════════
 */

/** 임시기록 열 (0-based) — _PEP_NON_PARTNER_TEMP_HEADERS_ 와 짝이다 */
var _PDC_C_ROUND_ = 1;    // B 회차 도장 (0901-1)
var _PDC_C_DATE_ = 2;     // C 일자-No.
var _PDC_C_CODE_ = 3;     // D 품목코드
var _PDC_C_ITEM_ = 4;     // E 품목명
var _PDC_C_QTY_ = 6;      // G 수량
var _PDC_C_PHONE_ = 7;    // H 전화
var _PDC_C_NAME_ = 12;    // M 거래처명(실제로는 수취인)
var _PDC_C_ORDERNO_ = 15; // P 사방넷주문번호
var _PDC_C_VENDOR_ = 22;  // W 업체prefix
var _PDC_C_INV_ = 23;     // X 송장번호

function _pdc_digits_(v) {
  return String(v == null ? "" : v).replace(/[^0-9]/g, "");
}

function _pdc_key_(v) {
  return String(v == null ? "" : v).replace(/\s/g, "").trim().toUpperCase();
}

/**
 * 임시기록을 훑어 중복 후보를 모은다. 읽기만 한다.
 * @return {{ok:boolean, sure:Array, maybe:Array, rows:number, error:string}}
 */
function _pdc_scan_() {
  var out = { ok: false, sure: [], maybe: [], rows: 0, error: "" };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tab = ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
    if (!tab) { out.error = "임시기록 탭을 찾을 수 없습니다."; return out; }

    var lr = tab.getLastRow();
    if (lr < 2) { out.ok = true; return out; }
    var lc = Math.max(tab.getLastColumn(), _PDC_C_INV_ + 1);
    var data = tab.getRange(2, 1, lr - 1, lc).getDisplayValues();
    out.rows = data.length;

    var byOrder = {};   // 사방넷주문번호 → [행정보]
    var byPerson = {};  // 수취인+전화+품목코드 → [행정보]

    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var name = String(r[_PDC_C_NAME_] || "").trim();
      var code = String(r[_PDC_C_CODE_] || "").trim();
      if (!name && !code) continue; // 빈 행

      var info = {
        row: i + 2,
        round: String(r[_PDC_C_ROUND_] || "").trim(),
        date: String(r[_PDC_C_DATE_] || "").trim(),
        code: code,
        item: String(r[_PDC_C_ITEM_] || "").trim(),
        qty: String(r[_PDC_C_QTY_] || "").trim(),
        name: name,
        phone: _pdc_digits_(r[_PDC_C_PHONE_]),
        orderNo: String(r[_PDC_C_ORDERNO_] || "").trim(),
        vendor: String(r[_PDC_C_VENDOR_] || "").trim(),
        inv: String(r[_PDC_C_INV_] || "").trim()
      };

      if (info.orderNo) {
        (byOrder[info.orderNo] = byOrder[info.orderNo] || []).push(info);
      }
      var pk = _pdc_key_(name) + "|" + info.phone + "|" + _pdc_key_(code);
      (byPerson[pk] = byPerson[pk] || []).push(info);
    }

    // ── 확실: 같은 사방넷주문번호가 2줄 이상 ──
    var sureRows = {};
    for (var o in byOrder) {
      var g = byOrder[o];
      if (g.length < 2) continue;
      out.sure.push({ key: o, hits: g });
      for (var s = 0; s < g.length; s++) sureRows[g[s].row] = true;
    }

    // ── 의심: 사람+품목이 같은데 주문번호가 다르고 차수도 다름 ──
    for (var p in byPerson) {
      var gp = byPerson[p];
      if (gp.length < 2) continue;
      // 확실 판정에 이미 잡힌 건은 중복해서 보고하지 않는다
      var allSure = true;
      for (var q = 0; q < gp.length; q++) { if (!sureRows[gp[q].row]) { allSure = false; break; } }
      if (allSure) continue;
      // 차수가 전부 같으면 한 번의 푸시가 만든 정상 다건일 수 있다
      var rounds = {};
      for (var w = 0; w < gp.length; w++) rounds[gp[w].round || "(없음)"] = true;
      if (Object.keys(rounds).length < 2) continue;
      out.maybe.push({ key: gp[0].name + " / " + gp[0].code, hits: gp });
    }

    out.ok = true;
    return out;
  } catch (e) {
    out.error = e.message;
    return out;
  }
}

function _pdc_lineOf_(h) {
  return "      [" + (h.round || "차수없음") + "] " + h.name +
    " · " + h.item + " ×" + h.qty +
    " · " + (h.vendor || "-") +
    (h.inv ? " · 송장 " + h.inv : " · 송장없음") +
    "  (" + h.row + "행)";
}

/**
 * [메뉴/편집기] 중복 발주 점검 — 읽기만 한다.
 * 파일: _partnerDupOrderCheck.gs
 */
function partnerCheckDuplicateOrders() {
  var res = _pdc_scan_();
  var L = ["═══ 중복 발주 점검 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") +
    " · 대리공급_임시기록 " + res.rows + "행", ""];

  if (!res.ok) {
    L.push("★ 실패: " + res.error);
  } else if (!res.sure.length && !res.maybe.length) {
    L.push("✔ 중복 의심 건이 없습니다.");
  } else {
    if (res.sure.length) {
      L.push("★ 확실 — 같은 사방넷주문번호가 두 번 들어왔습니다 (" + res.sure.length + "건)");
      for (var i = 0; i < Math.min(res.sure.length, 20); i++) {
        L.push("    주문번호 " + res.sure[i].key);
        for (var j = 0; j < res.sure[i].hits.length; j++) {
          L.push(_pdc_lineOf_(res.sure[i].hits[j]));
        }
      }
      if (res.sure.length > 20) L.push("    … 외 " + (res.sure.length - 20) + "건");
      L.push("");
    }
    if (res.maybe.length) {
      L.push("⚠ 의심 — 같은 사람·같은 품목이 다른 차수에 들어왔습니다 (" + res.maybe.length + "건)");
      L.push("   추가 주문일 수도 있으니 확인 후 판단하세요.");
      for (var m = 0; m < Math.min(res.maybe.length, 20); m++) {
        L.push("    " + res.maybe[m].key);
        for (var k = 0; k < res.maybe[m].hits.length; k++) {
          L.push(_pdc_lineOf_(res.maybe[m].hits[k]));
        }
      }
      if (res.maybe.length > 20) L.push("    … 외 " + (res.maybe.length - 20) + "건");
    }
  }

  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("중복 발주 점검", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}

/**
 * 푸시 직후 자동 점검. 확실 건이 있을 때만 알린다.
 *
 * 조용할 때 아무 말도 하지 않아야 알림이 신호로 남는다.
 * 실패해도 푸시를 막지 않는다 — 점검이 발주를 방해하면 본말전도다.
 */
function _pdc_checkAfterPush_() {
  try {
    var res = _pdc_scan_();
    if (!res.ok) { Logger.log("[DUP] 점검 실패: " + res.error); return; }
    Logger.log("[DUP] 점검 " + res.rows + "행 — 확실 " + res.sure.length +
      " / 의심 " + res.maybe.length);
    if (!res.sure.length) return;

    var lines = ["⚠️ 중복 발주 의심 " + res.sure.length + "건",
      "같은 사방넷주문번호가 두 차수에 들어왔습니다.", ""];
    for (var i = 0; i < Math.min(res.sure.length, 5); i++) {
      var g = res.sure[i].hits;
      var rounds = [];
      for (var j = 0; j < g.length; j++) rounds.push(g[j].round || "?");
      lines.push("· " + g[0].name + " / " + g[0].item +
        " — 차수 " + rounds.join(", ") + " (주문 " + res.sure[i].key + ")");
    }
    if (res.sure.length > 5) lines.push("… 외 " + (res.sure.length - 5) + "건");
    lines.push("");
    lines.push("확인: 메뉴 [🔁 중복 발주 점검] — partnerCheckDuplicateOrders");
    try { _chat_sendText_(lines.join("\n")); } catch (eC) {}
  } catch (e) {
    Logger.log("[DUP] 점검 오류: " + e.message);
  }
}
