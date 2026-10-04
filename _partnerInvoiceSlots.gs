/**
 * ══════════════════════════════════════════════════════════════
 *  한 주문이 가질 수 있는 송장 «장수»
 *  파일: _partnerInvoiceSlots.gs
 *
 *  2026-09-16 에 「지난 기록을 살리는」 도구들을 지우면서, 그 안에 섞여
 *  있던 이 셋만 꺼내 왔다. 이것은 과거를 고치는 코드가 아니라
 *  «한 주문에 송장이 몇 장이면 정상인가»를 세는 코드다 —
 *  수집·조회·진단이 오늘 것에도 그대로 쓴다.
 *
 *  쓰는 곳: _partnerExclusivePush.gs · _partnerUidRecogDiag.gs ·
 *          CS_WebApp/csOrderSearch.gs
 * ══════════════════════════════════════════════════════════════
 */

/** 수량 문자열 → 최소 1 이상의 정수 */
function _par_qtyNum_(qty) {
  var n = parseInt(String(qty == null ? "" : qty).replace(/[^0-9]/g, ""), 10);
  return (isNaN(n) || n < 1) ? 1 : n;
}

/**
 * 품목명에 '세트'가 있으면 뚜껑+몸통이 따로 나가므로 1개당 송장 2장이 정상이다.
 * ★ 2026-08-26: 세트를 이름으로 구분한다. 종전에는 모든 품목에 2배를 허용해
 *   세트가 아닌 품목의 오배정까지 '정상 분할'로 통과시키고, 반대로 세트인데
 *   송장이 겹치면 1장으로 좁혀 구성품 하나를 떼어냈다.
 */
function _par_isSetItem_(item) {
  return /세트/i.test(String(item == null ? "" : item));
}

/**
 * 이 행이 정상적으로 가질 수 있는 송장 개수.
 *   세트  : 구성품이 따로 나가 2N이 기본. 한 박스로 합쳐 나가면 N.
 *   비세트: N이 기본. 박스가 쪼개지면 2N.
 */
function _par_slotSpec_(qty, item) {
  var n = _par_qtyNum_(qty);
  var set = _par_isSetItem_(item);
  return { qty: n, min: n, max: n * 2, expect: set ? n * 2 : n, set: set };
}
