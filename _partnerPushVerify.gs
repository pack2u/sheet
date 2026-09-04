/**
 * ══════════════════════════════════════════════════════════════
 *  푸시 착지 확인 — 임시기록에 있는데 전용양식에 없는 건 찾기
 *  파일: _partnerPushVerify.gs
 *
 *  ★ 왜 필요한가 (2026-09-01) ★
 *    Push 는 두 곳에 쓴다 — 업체 전용양식과 우리 임시기록. 그런데 이 둘은
 *    서로 다른 try 블록에서 처리된다. 업체 시트 쓰기가 실패해도 임시기록은
 *    그대로 남고, 소스 P열 고유ID도 이미 찍혀서 다음 회차에 재푸시되지 않는다.
 *    결과: 주문이 조용히 사라진다. 아무도 모른다.
 *
 *    실제로 열 서식 오류 하나가 Push 전체를 죽인 일이 있었다.
 *    그때 무엇이 빠졌는지 확인할 방법이 없었다. 그래서 만든다.
 *
 *  대조 기준은 고유ID다.
 *    임시기록 P열(15) 사방넷주문번호 = 전용양식 AX열(50) 고유ID
 *
 *  읽기만 한다. 고치지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

var _PPV_TEMP_UID_COL_ = 15;   // 임시기록 P열 (0-based)
var _PPV_FORM_UID_COL_ = 49;   // 전용양식 AX열 (0-based)
var _PPV_TEMP_ROUND_COL_ = 1;  // 임시기록 B열 회차 도장
var _PPV_TEMP_VENDOR_COL_ = 22; // 임시기록 W열 업체prefix

/**
 * [메뉴/편집기] 푸시 착지 확인
 * @param {string=} optRound "0901-2" 처럼 특정 차수만. 비우면 오늘 전체.
 */
function partnerVerifyPushLanded(optRound) {
  var L = ["═══ 푸시 착지 확인 ═══"];
  try {
    var todayMMdd = Utilities.formatDate(new Date(), "Asia/Seoul", "MMdd");
    var wantRound = String(optRound || "").trim();
    L.push(Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") +
      " · 기준: " + (wantRound || "오늘(" + todayMMdd + ") 전체 차수"));
    L.push("");

    // ── 1. 임시기록에서 대상 행 모으기 ──
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tTab = ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
    if (!tTab) { L.push("★ 임시기록 탭 없음"); return _ppv_out_(L); }
    var tLr = tTab.getLastRow();
    if (tLr < 2) { L.push("임시기록에 데이터가 없습니다."); return _ppv_out_(L); }

    var tLc = Math.max(tTab.getLastColumn(), _PPV_TEMP_VENDOR_COL_ + 1);
    var tData = tTab.getRange(2, 1, tLr - 1, tLc).getDisplayValues();

    var byVendor = {};   // prefix → { uid: {round, name, item, row} }
    var picked = 0;
    for (var i = 0; i < tData.length; i++) {
      var round = String(tData[i][_PPV_TEMP_ROUND_COL_] || "").trim();
      if (wantRound) { if (round !== wantRound) continue; }
      else if (round.indexOf(todayMMdd + "-") !== 0) continue; // 오늘 도장만
      var uid = String(tData[i][_PPV_TEMP_UID_COL_] || "").trim();
      if (!uid) continue;
      var pfx = String(tData[i][_PPV_TEMP_VENDOR_COL_] || "").trim().toUpperCase();
      if (!pfx) continue;
      if (!byVendor[pfx]) byVendor[pfx] = {};
      byVendor[pfx][uid] = {
        round: round,
        name: String(tData[i][12] || "").trim(),
        item: String(tData[i][4] || "").trim(),
        qty: String(tData[i][6] || "").trim(),
        row: i + 2
      };
      picked++;
    }

    if (!picked) {
      L.push("대상 행이 없습니다. (그 차수로 임시기록에 기록된 건이 없음)");
      L.push("※ 도장은 2026-09-01 부터 찍힙니다. 그 전 행에는 차수가 없습니다.");
      return _ppv_out_(L);
    }
    L.push("임시기록 대상: " + picked + "건 / 업체 " + Object.keys(byVendor).length + "곳");
    L.push("");

    // ── 2. 업체 전용양식 AX열과 대조 ──
    var files = _pt_listFiles();
    var missingTotal = 0;
    for (var p in byVendor) {
      var want = byVendor[p];
      var wantN = Object.keys(want).length;

      // prefix 로 업체 파일 찾기
      var target = null;
      for (var fi = 0; fi < files.length; fi++) {
        var nm = files[fi].name || "";
        if (nm.toUpperCase().indexOf(p) !== -1) { target = files[fi]; break; }
      }
      // 이름으로 못 찾으면 접두 → 업체명 표를 쓴다
      if (!target && typeof _PEP_VENDOR_NAME_ !== "undefined" && _PEP_VENDOR_NAME_[p]) {
        for (var f2 = 0; f2 < files.length; f2++) {
          if ((files[f2].name || "").indexOf(_PEP_VENDOR_NAME_[p]) !== -1) { target = files[f2]; break; }
        }
      }
      if (!target) {
        L.push("  ★ " + p + " — 업체 파일을 못 찾음 (임시기록 " + wantN + "건)");
        continue;
      }

      var have = {};
      try {
        var vss = SpreadsheetApp.openById(target.id);
        var fTab = _peo_findFormTab_(vss);
        if (!fTab) { L.push("  ★ " + p + " — 전용양식 탭 없음 (임시기록 " + wantN + "건)"); continue; }
        var fLr = fTab.getLastRow();
        if (fLr >= 2) {
          var uidCol = fTab.getRange(2, _PPV_FORM_UID_COL_ + 1, fLr - 1, 1).getDisplayValues();
          for (var u = 0; u < uidCol.length; u++) {
            var v = String(uidCol[u][0] || "").trim();
            if (v) have[v] = true;
          }
        }
      } catch (eV) {
        L.push("  ★ " + p + " — 시트 열기 실패: " + eV.message);
        continue;
      }

      var missing = [];
      for (var uid2 in want) if (!have[uid2]) missing.push(uid2);

      var label = target.name.replace("[협력업체] ", "");
      if (!missing.length) {
        L.push("  ✔ " + p + " " + label + " — " + wantN + "건 모두 착지");
      } else {
        missingTotal += missing.length;
        L.push("  ★ " + p + " " + label + " — " + wantN + "건 중 " +
          missing.length + "건이 전용양식에 없습니다:");
        for (var m = 0; m < Math.min(missing.length, 10); m++) {
          var w = want[missing[m]];
          L.push("      [" + w.round + "] " + w.name + " · " + w.item + " ×" + w.qty +
            "  (임시기록 " + w.row + "행 · UID " + missing[m] + ")");
        }
        if (missing.length > 10) L.push("      … 외 " + (missing.length - 10) + "건");
      }
    }

    L.push("");
    L.push(missingTotal
      ? "★ 총 " + missingTotal + "건이 업체 시트에 안 들어갔습니다. 다시 보내야 합니다."
      : "✔ 누락 없음 — 임시기록의 오늘 건이 전부 업체 전용양식에 있습니다.");
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _ppv_out_(L);
}

function _ppv_out_(L) {
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("푸시 착지 확인", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}
