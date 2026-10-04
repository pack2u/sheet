/**
 * ══════════════════════════════════════════════════════════════
 *  임시기록 → 전용양식 Push 예행 점검
 *  파일: _partnerTempPushDiag.gs
 *  대상 함수: partnerPushFromTempTabToExclusive (_partnerExclusivePush.gs)
 *
 *  "Push 가 안 되는 것 같다"는 제보에서 출발했다. 그 함수는 다섯 가지
 *  이유로 행을 건너뛰는데, 요약에는 건수만 나오고 **어느 행이 왜** 빠졌는지는
 *  나오지 않는다. 그래서 이 도구가 행별로 판정을 찍는다.
 *
 *  판정 순서는 본 함수와 같다:
 *    빈 행 → Y열 Push완료 → 접두 판정 → 업체 등록 → 파일 존재 → UID 중복
 *
 *  ★ 아무것도 쓰지 않는다 ★
 *    본 함수는 W열 접두 되쓰기·UID 되쓰기·헤더 보정을 하지만 여기서는 안 한다.
 *    "왜 안 되나"를 보려다 상태를 바꾸면 다음 실행 결과가 달라진다.
 * ══════════════════════════════════════════════════════════════
 */

function partnerDiagnoseTempPush() {
  var L = ["═══ 임시기록 → 전용양식 Push 예행 점검 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tempTab = ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
    if (!tempTab) { L.push("★ 「" + _PEP_NON_PARTNER_TEMP_TAB_NAME_ + "」 탭 없음"); return _ptd_out_(L); }
    var lr = tempTab.getLastRow();
    if (lr < 2) { L.push("임시기록이 비어 있습니다."); return _ptd_out_(L); }
    var lc = Math.max(tempTab.getLastColumn(), 25);
    var srcAll = tempTab.getRange(1, 1, lr, lc).getDisplayValues();
    L.push("임시기록 " + (srcAll.length - 1) + "행");

    // 업체 파일 목록 → 접두 매핑 (본 함수와 같은 근거)
    var prefixToFile = {};
    try {
      var files = _pt_listFiles();
      for (var fi = 0; fi < files.length; fi++) {
        var nm = String(files[fi].name || "");
        for (var p in _PEP_VENDOR_DIRECT_MAP_) {
          if (prefixToFile[p]) continue;
          var vn = (typeof _PEP_VENDOR_NAME_ !== "undefined") ? _PEP_VENDOR_NAME_[p] : "";
          if (nm.toUpperCase().indexOf(p) !== -1 || (vn && nm.indexOf(vn) !== -1)) {
            prefixToFile[p] = files[fi];
          }
        }
      }
    } catch (eL) { L.push("★ 업체 목록 실패: " + eL.message); }
    L.push("업체 파일 매핑: " + Object.keys(prefixToFile).length + "개 접두");
    L.push("");

    var uidCache = {};   // pfx → { uid: true }  전용양식 AX열
    function loadUids(pfx) {
      if (uidCache[pfx]) return uidCache[pfx];
      var set = {};
      try {
        var vss = SpreadsheetApp.openById(prefixToFile[pfx].id);
        var ftab = _peo_findFormTab_(vss);
        if (ftab && ftab.getLastRow() >= 2) {
          var col = ftab.getRange(2, 50, ftab.getLastRow() - 1, 1).getDisplayValues();
          for (var i = 0; i < col.length; i++) {
            var v = String(col[i][0] || "").trim();
            if (v) set[v] = true;
          }
        }
      } catch (eU) {}
      uidCache[pfx] = set;
      return set;
    }

    var cnt = { ok: 0, done: 0, noPfx: 0, noMap: 0, noFile: 0, dup: 0 };
    var lines = [];
    for (var ri = 1; ri < srcAll.length; ri++) {
      var row = srcAll[ri];
      var rawCode = String(row[_PEP_CODE_COL] || "").trim();
      var rawName = String(row[_PEP_ITEM_COL] || "").trim();
      if (!rawCode && !rawName) continue;

      var who = (String(row[12] || "").trim() || "(수취인없음)").substring(0, 14) +
        " · " + (rawName || rawCode).substring(0, 22);
      var tag = "";

      var yStatus = String(row[24] || "").replace(/\s/g, "");
      if (yStatus.indexOf("Push완료") !== -1) {
        cnt.done++; tag = "이미완료(Y열=" + String(row[24] || "").trim() + ")";
      } else {
        var pfx = _pep_normalizeTempVendorPrefix_(row[22]);
        if (!pfx) {
          var codePfx = rawCode.length >= 2 ? _pep_resolvePrefixAlias_(rawCode.substring(0, 2)) : "";
          var namePfx = "";
          var m = rawName.replace(/^[^a-zA-Z]*/, "").match(/^([a-zA-Z]{2})/);
          if (m) namePfx = _pep_resolvePrefixAlias_(m[1]);
          if (codePfx && _PEP_VENDOR_DIRECT_MAP_[codePfx]) pfx = codePfx;
          else if (namePfx && _PEP_VENDOR_DIRECT_MAP_[namePfx]) pfx = namePfx;
          else if (codePfx) pfx = codePfx;
          else if (namePfx) pfx = namePfx;
        }
        if (!pfx) { cnt.noPfx++; tag = "★ 접두 못 정함 (W열 비었고 코드·품목명에서도 못 읽음)"; }
        else if (!_PEP_VENDOR_DIRECT_MAP_[pfx]) { cnt.noMap++; tag = "★ 미등록 업체 (" + pfx + ")"; }
        else if (!prefixToFile[pfx]) { cnt.noFile++; tag = "★ 업체 파일 없음 (" + pfx + ")"; }
        else {
          var uid = String(row[15] || "").trim();
          var willMake = !uid;
          if (!uid) {
            try {
              uid = _pep_deriveDeterministicUid_(row,
                Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"));
            } catch (eD) { uid = ""; }
          }
          if (uid && loadUids(pfx)[uid]) {
            cnt.dup++;
            tag = "★ UID 중복 — 전용양식에 이미 있음 (" + pfx + " / " + uid + ")";
          } else {
            cnt.ok++;
            tag = "✔ Push 대상 (" + pfx + " / UID " + uid +
              (willMake ? " ← 새로 생성됨" : " ← P열 기존값") + ")";
          }
        }
      }
      if (lines.length < 40) lines.push("  " + (ri + 1) + "행  " + who + "\n        " + tag);
    }

    L.push("[판정]");
    L.push("      ✔ Push 대상        " + cnt.ok + "건");
    L.push("      이미완료(Y열)      " + cnt.done + "건");
    L.push("      ★ UID 중복         " + cnt.dup + "건");
    L.push("      ★ 접두 못 정함     " + cnt.noPfx + "건");
    L.push("      ★ 미등록 업체      " + cnt.noMap + "건");
    L.push("      ★ 업체 파일 없음   " + cnt.noFile + "건");
    L.push("");
    L.push("[행별]");
    for (var i2 = 0; i2 < lines.length; i2++) L.push(lines[i2]);
    if (cnt.ok === 0) {
      L.push("");
      L.push("★ Push 대상이 한 건도 없습니다.");
      L.push("  위 사유 중 무엇에 걸렸는지 보고 그 칸을 고치세요.");
      L.push("  · 접두 못 정함 → 임시기록 W열에 업체 접두(AP·BW·JT…)를 적으세요.");
      L.push("  · UID 중복    → 이미 전용양식에 있는 건입니다. 정말 다시 보내려면");
      L.push("                  임시기록 P열(고유ID)을 비우고 다시 실행하세요.");
      L.push("  · 이미완료    → Y열에 'Push완료'가 있습니다. 비우면 다시 대상이 됩니다.");
    }
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _ptd_out_(L);
}

function _ptd_out_(L) {
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("임시기록 Push 예행 점검", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}
