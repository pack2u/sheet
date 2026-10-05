/**
 * ══════════════════════════════════════════════════════════════
 *  도서산간 추가배송비 → 이카운트 판매입력 줄 (OUT00001)
 *  파일: _partnerIslandSales.gs   2026-10-05
 *
 *  > "도서산간의 경우 이카운트 판매 입력에도 도서산간이 붙게 해야되고
 *  >  도서산간 코드는 OUT00001로 추가되야되고.. 도서산간 판매입력시에는
 *  >  어떤 상품에 도서산간이 붙었는지 수취인과 상품명, 주소등이 붙어 줘야되고.."
 *
 *  ★ 왜 «따로» 완료 표시를 하나 ★
 *    도서산간 여부는 세트분리(뉴)가 정한다. 세트분리는 이카운트 «판매현황»을 받아서
 *    돌기 때문에, 그 주문의 판매입력이 이미 올라간 «뒤»에 섬인 것을 안다.
 *    그래서 허브 P열(판매갱신 업 완료)에 기대면 도서산간 줄은 영영 못 올라간다.
 *    허브에 「도서산간 판매갱신」 칸을 따로 두고, 금액이 있는데 그 칸이 비었으면
 *    본 주문이 이미 올라갔어도 OUT00001 한 줄을 올린다.
 *
 *  ★ 한 줄에 무엇을 싣나 ★
 *    품목코드 OUT00001 · 수량 1 · 단가 = 그 줄의 도서산간비(5,000 / 세트 10,000)
 *    적요       「도서산간 · 수취인 · 상품명(품목코드) · 주소」
 *    주문자명    수취인/고유ID   (본 주문 줄과 같은 꼴 — 고유ID 로 짝을 찾는다)
 *    전화·배송지 본 주문 줄과 같다
 * ══════════════════════════════════════════════════════════════
 */

var _PO_ISLAND_ITEM_CODE_   = "OUT00001";
var _PO_ISLAND_FLAG_HEADER_ = "도서산간 판매갱신";
var _PO_ISLAND_FLAG_DONE_   = "판매갱신 업 완료";
var _PO_ISLAND_MEMO_MAX_    = 200;   // 이카운트 적요 길이

/**
 * 순수 — 허브 한 줄(A~P)로 판매현황 업로드 한 줄을 만든다. 시험이 직접 부른다.
 *   허브: B 업체 · C 고유ID · E 코드 · F 품목명 · H 수취인 · I 전화 · J 주소 · K 배송메시지
 */
function _po_islandSaleLine_(row, fee, custCd, shipYmd, colCount) {
  var line = new Array(colCount);
  for (var c = 0; c < colCount; c++) line[c] = "";

  var total = Math.round(Number(fee) || 0);
  var supply = Math.round(total / 1.1);

  var uid = String(row[2] || "").trim();
  var code = String(row[4] || "").trim();
  var item = String(row[5] || "").trim();
  var recip = String(row[7] || "").trim();
  var phone = String(row[8] || "").trim();
  if (phone.length >= 8 && phone.length <= 10 && phone.charAt(0) !== "0") phone = "0" + phone;
  var addr = String(row[9] || "").trim();
  var msg = String(row[10] || "").trim();

  line[0] = shipYmd;                 // 출고일자
  line[2] = custCd;                  // 거래처코드
  line[7] = "100";                   // 출하창고
  line[15] = _PO_ISLAND_ITEM_CODE_;  // 품목코드
  line[17] = 1;                      // 수량
  line[18] = total;                  // 단가
  line[20] = supply;                 // 공급가액
  line[21] = total - supply;         // 부가세
  line[22] = total;                  // 금액1
  var 적요 = ["도서산간", recip, item + (code ? " (" + code + ")" : ""), addr]
    .filter(function (x) { return x; }).join(" · ");
  line[23] = 적요.length > _PO_ISLAND_MEMO_MAX_ ? 적요.slice(0, _PO_ISLAND_MEMO_MAX_) : 적요;
  line[24] = uid ? recip + "/" + uid : recip;   // 주문자명 — 본 주문 줄과 같은 꼴
  line[25] = phone;
  line[26] = [addr, msg].filter(function (x) { return x; }).join(" / ");
  line[27] = "N";                    // 생산전표생성 — 배송비 품목이라 만들지 않는다
  return line;
}

/** 순수 — 취소·반품·불용 줄인가 (상태 칸, 띄어쓰기 뺀 것) */
function _po_islandCancelLike_(stCompact) {
  return stCompact.indexOf("취소") !== -1 || stCompact.indexOf("반품") !== -1 || stCompact.indexOf("불용") !== -1;
}

var _PO_ISLAND_FLAG_BEFORE_ = "도입 전(2026-10-05)";

/**
 * 순수 — 칸을 «처음 만들 때» 한 번: 판매현황에 이미 올라간 줄 중 금액이 있는 줄은
 * 「도입 전」으로 막는다. 안 그러면 첫 갱신에 옛 도서산간 줄 전부가 OUT00001 로
 * 한꺼번에 올라간다(그 금액은 예전 방식 — 월마감 정산 — 으로 이미 받았다).
 * @return {number} 막은 줄 수
 */
function _po_islandSeedFlags_(hubData, feeVals, flagVals) {
  var n = 0;
  for (var r = 0; r < hubData.length; r++) {
    var 올라감 = String(hubData[r][15] || "").trim() !== "";
    if (올라감 && (Number(feeVals[r][0]) || 0) > 0 && !String(flagVals[r][0] || "").trim()) {
      flagVals[r][0] = _PO_ISLAND_FLAG_BEFORE_;
      n++;
    }
  }
  return n;
}

/**
 * 허브 「도서산간 판매갱신」 칸 — 없으면 맨 뒤에 만든다 (가운데 끼우면 뒤 칸이 밀린다).
 * 만들었으면 _po_islandFlagCol_.만듦 = true (호출한 쪽이 처음 한 번 막기를 한다)
 */
function _po_islandFlagCol_(hubTab, hdr) {
  _po_islandFlagCol_.만듦 = false;
  for (var i = 0; i < hdr.length; i++) {
    if (String(hdr[i] || "").replace(/\s/g, "") === _PO_ISLAND_FLAG_HEADER_.replace(/\s/g, "")) return i + 1;
  }
  _po_islandFlagCol_.만듦 = true;
  var col = hubTab.getLastColumn() + 1;
  if (hubTab.getMaxColumns() < col) hubTab.insertColumnsAfter(hubTab.getMaxColumns(), col - hubTab.getMaxColumns());
  hubTab.getRange(1, col).setValue(_PO_ISLAND_FLAG_HEADER_)
    .setBackground("#7b1fa2").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
  return col;
}
