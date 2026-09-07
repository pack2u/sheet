/**
 * ══════════════════════════════════════════════════════════════
 *  [협력업체] 명세서 — 우리 구매입력과 대조
 *  파일: _partnerStatementPurchase.gs
 *  2026-09-07
 *
 *  ★ 왜 허브 「이카운트-구매입력변환」 탭을 안 쓰나 ★
 *    그 탭은 변환을 새로 돌 때마다 초기화된다
 *    (_epx_ensureOutTab_(hub, !resumeState) → reset).
 *    즉 **가장 최근 실행분만** 남는다. 한 달치 명세서를 그 탭과 맞추면
 *    거의 전부 "구매입력 없음"으로 나온다. 대조 상대로 쓸 수 없다.
 *
 *  ★ 진짜 누적 기록 ★
 *    매일 17:30 「구매입력」 폴더에 「구매입력_(YYYY-MM-DD)」 파일이
 *    하나씩 만들어진다. 시트 이름은 「이카운트-구매입력변환」이고
 *    열 구성은 _EPX_HEADERS_ 와 같다. 이게 우리가 실제로 넣은 것이다.
 *
 *  ★ 대조 기준 ★
 *    ① 송장번호 — 있으면 가장 확실
 *    ② 이카운트 품목코드 + 수량
 *    ③ 이카운트 품목코드 (수량 다르면 차이로 보고)
 *
 *    명세서에는 송장번호가 없는 줄도 많다(품목 단위 청구). 그래서
 *    송장만으로는 못 맞춘다. 코드까지 내려가되, 무엇으로 맞췄는지
 *    결과에 남겨 사람이 판단할 수 있게 한다.
 * ══════════════════════════════════════════════════════════════
 */

/** _EPX_HEADERS_ 기준 0-based 열 위치 */
var _PSTMTP_C_DATE_ = 0;   // A 일자
var _PSTMTP_C_CUST_ = 2;   // C 거래처코드
var _PSTMTP_C_CODE_ = 10;  // K 품목코드
var _PSTMTP_C_NAME_ = 11;  // L 품목명
var _PSTMTP_C_QTY_ = 13;   // N 수량
var _PSTMTP_C_PRICE_ = 14; // O 단가(VAT 별도)
var _PSTMTP_C_AMT_ = 18;   // S 금액(VAT 포함)
var _PSTMTP_C_INV_ = 22;   // W 송장번호

/** 한 번에 열 파일 수 상한 — 6분 제한을 넘기지 않는다 */
var _PSTMTP_MAX_FILES_ = 40;
var _PSTMTP_MAX_MS_ = 150000;

/**
 * 해당 월의 구매입력 파일들에서 이 업체 행만 모은다.
 *
 * @param custCd   거래처코드. 비어 있으면 전부 읽는다(업체 구분 없이).
 * @param monthStr "2026-09" 또는 "202609"
 * @return {lines[], byInv{}, byCode{}, files, rows, warn[]}
 */
function _pstmt_loadPurchaseLines_(custCd, monthStr) {
  // zeroAmt: 금액 0 이라 대조에서 뺀 줄 (파레트 등 순환 자산·무상분)
  var out = { lines: [], byInv: {}, byCode: {}, files: 0, rows: 0, zeroAmt: 0, warn: [] };
  var t0 = new Date().getTime();

  var ym = String(monthStr || "").replace(/[^\d]/g, "");
  if (ym.length >= 6) ym = ym.slice(0, 4) + "-" + ym.slice(4, 6);
  else {
    ym = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM");
    out.warn.push("대상 월을 못 읽어 이번 달(" + ym + ")로 봅니다.");
  }
  var wantPrefix = _EPD_FILE_PREFIX_ + "(" + ym + "-";

  var folder;
  try {
    folder = _epd_purchaseFolder_(SpreadsheetApp.openById(_PT.INFO_SS_ID));
  } catch (eF) {
    out.warn.push("「구매입력」 폴더를 못 찾음: " + eF.message);
    return out;
  }

  var want = String(custCd || "").trim();
  var it = folder.getFiles();
  while (it.hasNext()) {
    if (out.files >= _PSTMTP_MAX_FILES_) {
      out.warn.push("파일 " + _PSTMTP_MAX_FILES_ + "개까지만 읽었습니다.");
      break;
    }
    if (new Date().getTime() - t0 > _PSTMTP_MAX_MS_) {
      out.warn.push("시간이 오래 걸려 중단했습니다 — 읽은 파일 " + out.files + "개까지만 반영됐습니다.");
      break;
    }

    var f = it.next();
    var nm;
    try {
      nm = f.getName();
    } catch (eN) {
      continue;
    }
    if (nm.indexOf(wantPrefix) !== 0) continue;

    var tab;
    try {
      var pss = SpreadsheetApp.openById(f.getId());
      tab = pss.getSheetByName(_EPX_OUT_TAB_) || pss.getSheets()[0];
    } catch (eO) {
      out.warn.push(nm + " 열기 실패: " + eO.message);
      continue;
    }
    if (!tab || tab.getLastRow() < 2) continue;
    out.files++;

    var lc = Math.min(Math.max(tab.getLastColumn(), 1), _EPX_HEADERS_.length);
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, lc).getDisplayValues();

    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      var cust = String(row[_PSTMTP_C_CUST_] || "").trim();
      if (want && cust !== want) continue;

      var code = String(row[_PSTMTP_C_CODE_] || "").trim();
      var name = String(row[_PSTMTP_C_NAME_] || "").trim();
      if (!code && !name) continue;

      // ★ 금액 0 인 줄은 명세서 대조에서 뺀다 (2026-09-07) ★
      //   파레트가 그렇다. 물건이 파레트에 실려 나가고 나중에 모아서 반납한다 —
      //   돌고 도는 자산이지 매입이 아니다. 그래서 구매입력에는 수량만 있고
      //   금액이 0 이고, 업체 거래명세서에는 아예 안 올라온다.
      //   빼지 않으면 "명세서에 없음" 으로 뜬다. 정상인 줄이 계속 경고를 낸다.
      //
      //   품목코드로 거르지 않는 이유: 파레트 품목이 늘 때마다 코드를 고쳐야 한다.
      //   「금액 0 = 청구되지 않는 줄」이 원칙이고, 무상 제공분도 같은 이유로
      //   명세서에 없으므로 같은 규칙이 맞다.
      var amt0 = _pstmt_parseNumber_(row[_PSTMTP_C_AMT_]);
      var prc0 = _pstmt_parseNumber_(row[_PSTMTP_C_PRICE_]);
      if (amt0 === 0 && prc0 === 0) { out.zeroAmt++; continue; }

      var ln = {
        date: String(row[_PSTMTP_C_DATE_] || "").trim(),
        custCd: cust,
        code: code,
        name: name,
        qty: _pstmt_parseQty_(row[_PSTMTP_C_QTY_]),
        price: _pstmt_parseNumber_(row[_PSTMTP_C_PRICE_]),
        amount: _pstmt_parseNumber_(row[_PSTMTP_C_AMT_]),
        invoices: _pstmtp_splitInvoices_(row[_PSTMTP_C_INV_]),
        file: nm,
      };
      out.lines.push(ln);
      out.rows++;

      for (var iv = 0; iv < ln.invoices.length; iv++) {
        var k = ln.invoices[iv];
        if (!out.byInv[k]) out.byInv[k] = [];
        out.byInv[k].push(ln);
      }
      if (code) {
        if (!out.byCode[code]) out.byCode[code] = [];
        out.byCode[code].push(ln);
      }
    }
  }
  return out;
}

/**
 * W열에는 송장이 여러 개 붙는다(대리발송·분할출고).
 * 구분자가 통일돼 있지 않아 숫자 덩어리만 뽑는다.
 */
function _pstmtp_splitInvoices_(v) {
  var s = String(v == null ? "" : v);
  var m = s.match(/\d{8,}/g);
  if (!m) return [];
  var seen = {}, out = [];
  for (var i = 0; i < m.length; i++) {
    if (!seen[m[i]]) { seen[m[i]] = 1; out.push(m[i]); }
  }
  return out;
}

/**
 * 명세서 한 줄을 구매입력과 맞춘다.
 *
 * @param row    파싱된 명세 줄 {invoice, qty, unitPriceIncVat, ...}
 * @param mapped 우리 품목 해석 {code, ...}
 * @param purch  _pstmt_loadPurchaseLines_ 결과
 * @return {hit, by, qty, price, amount, note}
 */
function _pstmt_matchPurchase_(row, mapped, purch) {
  var none = { hit: false, by: "", qty: "", price: "", amount: "", note: "" };
  if (!purch || !purch.rows) return none;

  // ① 송장번호
  var inv = _pstmt_normInv_(row.invoice);
  if (inv && purch.byInv[inv]) {
    var cands = purch.byInv[inv];
    // 같은 송장에 여러 품목이 붙는다 — 품목코드가 맞는 것을 고른다
    var pick = null;
    if (mapped && mapped.code) {
      for (var i = 0; i < cands.length; i++) {
        if (cands[i].code === mapped.code) { pick = cands[i]; break; }
      }
    }
    if (pick) {
      return {
        hit: true, by: "송장+코드", qty: pick.qty, price: pick.price,
        amount: pick.amount, note: "",
      };
    }
    // 코드가 안 맞으면 송장만 맞은 것이다. 수량을 그대로 믿으면 안 된다.
    return {
      hit: true, by: "송장만", qty: cands[0].qty, price: cands[0].price,
      amount: cands[0].amount, note: "PUR_CODE_DIFF",
    };
  }

  // ② 품목코드 + 수량
  if (mapped && mapped.code && purch.byCode[mapped.code]) {
    var list = purch.byCode[mapped.code];
    for (var j = 0; j < list.length; j++) {
      if (Math.abs(list[j].qty - row.qty) < 0.001) {
        return {
          hit: true, by: "코드+수량", qty: list[j].qty, price: list[j].price,
          amount: list[j].amount, note: "",
        };
      }
    }
    // ③ 코드만 — 수량이 다르다. 합계로 견줘 사람이 볼 수 있게 한다.
    var sum = 0;
    for (var k = 0; k < list.length; k++) sum += list[k].qty;
    return {
      hit: true, by: "코드만", qty: sum, price: list[0].price,
      amount: list[0].amount, note: "PUR_QTY_DIFF",
    };
  }

  return { hit: false, by: "", qty: "", price: "", amount: "", note: "NO_PURCHASE" };
}
