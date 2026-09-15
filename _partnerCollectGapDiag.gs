/**
 * ══════════════════════════════════════════════════════════════
 *  발주 수집 누락 점검 — 어떤 행이 왜 안 들어왔나
 *  파일: _partnerCollectGapDiag.gs
 *
 *  ★ 왜 필요한가 (2026-09-04) ★
 *    발주 수집은 필수 항목(수취인·전화·주소·수량)이 하나라도 비면 그 행을
 *    조용히 건너뛴다. 자동 트리거로 돌 때는 채팅 알림에 스킵 건수조차
 *    나오지 않는다. 그래서 한 건이 빠져도 아무도 모르고, 허브에 안 들어간
 *    주문은 송장 수집·배포에서도 통째로 빠진다.
 *
 *  ★ 검증이 backfill 전 원본 값을 본다 ★
 *    수집기는 "첫 행에만 수취인을 적는 관행"을 위해 윗행 값을 이어받는
 *    backfill 을 갖고 있다. 그런데 필수 항목 검증은 backfill **전** 원본을
 *    본다(_origRecipient 등). 남의 정보를 넘겨받아 엉뚱한 곳으로 보내는
 *    사고를 막으려는 의도다. 결과적으로 아랫행은 backfill 이 채워 줘도
 *    수집되지 않는다. 이 도구는 그런 행을 드러낸다.
 *
 *  읽기만 한다. 고치지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * [메뉴/편집기] 수집에서 빠진 행 찾기
 * @param {string=} optDateStr yyyy-MM-dd. 비우면 어제
 * @param {number=} optDays 그 날짜부터 며칠치. 기본 2
 */
function partnerFindUncollectedOrders(optDateStr, optDays) {
  var days = parseInt(optDays, 10) || 2;
  var base = String(optDateStr || "").trim();
  if (!base) {
    var y = new Date(); y.setDate(y.getDate() - 1);
    base = Utilities.formatDate(y, "Asia/Seoul", "yyyy-MM-dd");
  }
  var fromNum = _pcg_ymd_(base);
  var toNum = fromNum + (days - 1); // 날짜 연산은 아래서 문자열 비교로 대신한다

  var L = ["═══ 발주 수집 누락 점검 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
    "기준일: " + base + " 부터 " + days + "일", ""];

  var total = 0, files = 0;
  var byReason = {};
  try {
    var list = _pt_listFiles();
    for (var fi = 0; fi < list.length; fi++) {
      var nm = list[fi].name.replace("[협력업체] ", "");
      var hits = [];
      try {
        var ss = SpreadsheetApp.openById(list[fi].id);
        var tabs = ss.getSheets();
        for (var ti = 0; ti < tabs.length; ti++) {
          var tab = tabs[ti];
          if (!_po_isOrderTab(tab.getName())) continue;   // 수집기와 같은 판정
          var lr = tab.getLastRow();
          if (lr <= 1) continue;
          files++;
          var lc = Math.max(tab.getLastColumn(), 14);
          var data = tab.getRange(1, 1, lr, lc).getValues();
          var cMap = _po_buildColMap(data[0]);

          for (var r = 1; r < data.length; r++) {
            var row = data[r];
            var code = cMap.code !== -1 ? String(row[cMap.code] || "").trim() : "";
            var itemName = cMap.item !== -1 ? String(row[cMap.item] || "").trim() : "";
            var qtyStr = cMap.qty !== -1 ? String(row[cMap.qty] || "").trim() : "";
            if (!code && !itemName && !qtyStr) continue;        // 완전 빈 행
            if (code && code.indexOf("상품없음") !== -1) continue;

            // 날짜 범위 — 날짜 열이 없으면 전부 본다
            if (cMap.date !== -1) {
              var dNum = _pcg_ymdOf_(row[cMap.date]);
              if (dNum && (dNum < fromNum || dNum > fromNum + days * 1 - 1 + 0)) {
                // 문자열 날짜 비교가 어려운 형식은 그냥 통과시킨다 (놓치는 것보다 낫다)
                if (dNum < fromNum) continue;
              }
            }

            // ★ 수집기와 같은 규칙 — backfill 전 원본 값으로 검증 ★
            var recip = cMap.recipient !== -1 ? String(row[cMap.recipient] || "").trim() : "";
            var phone = cMap.phone !== -1 ? String(row[cMap.phone] || "").trim() : "";
            var addr = cMap.addr !== -1 ? String(row[cMap.addr] || "").trim() : "";

            var missing = [];
            if (!recip) missing.push("수취인");
            if (!phone) missing.push("전화번호");
            if (!addr) missing.push("주소");
            if (!qtyStr || qtyStr === "0") missing.push("수량");
            if (!missing.length) continue;                       // 수집됐을 행

            var key = missing.join("+");
            byReason[key] = (byReason[key] || 0) + 1;
            total++;
            if (hits.length < 8) {
              hits.push("      " + (r + 1) + "행  " +
                (itemName || code || "(품목없음)").substring(0, 24) +
                "  ×" + (qtyStr || "-") +
                "  빠진 항목: " + missing.join(", "));
            }
          }
        }
      } catch (eF) {
        L.push("  ★ " + nm + ": " + eF.message);
        continue;
      }
      if (hits.length) {
        L.push("  " + nm);
        for (var h = 0; h < hits.length; h++) L.push(hits[h]);
        L.push("");
      }
    }

    L.push("─────────────────────────");
    L.push("훑은 발주 탭: " + files + "개 · 수집에서 빠질 행: " + total + "건");
    if (total) {
      L.push("");
      L.push("빠진 항목별:");
      var ks = Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; });
      for (var k = 0; k < ks.length; k++) L.push("      " + ks[k] + " — " + byReason[ks[k]] + "건");
      L.push("");
      L.push("★ 이 행들은 허브에 안 들어갑니다. 그래서 송장 수집·배포에서도 빠집니다.");
      L.push("  업체 시트에서 빠진 칸을 채우고 발주 수집을 다시 돌리면 들어옵니다.");
    } else {
      L.push("✔ 필수 항목이 빈 행이 없습니다.");
      L.push("  그래도 누락이 있었다면 다른 이유입니다 — 중복 판정·날짜·탭 이름을 봐야 합니다.");
    }
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }

  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("발주 수집 누락 점검", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}

function _pcg_ymd_(s) {
  var d = String(s || "").replace(/[^0-9]/g, "");
  return d.length >= 8 ? parseInt(d.substring(0, 8), 10) : 0;
}

function _pcg_ymdOf_(v) {
  if (v && typeof v.getFullYear === "function" && !isNaN(v.getTime())) {
    return parseInt(Utilities.formatDate(v, "Asia/Seoul", "yyyyMMdd"), 10);
  }
  return _pcg_ymd_(v);
}
