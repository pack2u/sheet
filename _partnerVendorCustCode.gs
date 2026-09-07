/**
 * ══════════════════════════════════════════════════════════════
 *  [구매입력] 업체 → 거래처코드 최후 폴백
 *  파일: _partnerVendorCustCode.gs
 *  2026-09-07
 *
 *  ★ 왜 만들었나 ★
 *    일자별 구매입력 파일을 열어 보니 거래처코드 칸이 비어 나가고 있었다.
 *    비어 있으면 이카운트에 못 올리니 사람이 매일 손으로 채웠고,
 *    그러다 셀을 끌어 채워 코드가 한 줄씩 증가하는 사고가 났다
 *    (2026-09-03 아주팩: 6928601646 → 647 → 648 …).
 *    없는 거래처로 올라갈 뻔했다.
 *
 *    손으로 채울 일이 없어지면 그 사고도 없어진다. 그래서 여기서 메운다.
 *
 *  ★ 왜 코드에 표를 두나 — 원래는 탭이 SSOT 다 ★
 *    이 프로젝트 원칙은 「운영 SSOT 는 탭, 코드는 폴백」이다
 *    (_PEP_VENDOR_NAME_ 주석 참고). 그래서 먼저 「업체_택배사」 탭에서
 *    거래처코드 열을 찾아 쓰고, 없을 때만 아래 표를 쓴다.
 *    탭에 열을 하나 만들어 채우면 이 표는 저절로 안 쓰이게 된다.
 *
 *  ★ 아래 값의 출처 ★
 *    운영자가 직접 고쳐 둔 일자별 구매입력 파일에서 읽었다
 *    (2026-09-01 ~ 09-04). 즉 사람이 확인한 값이다.
 *    다만 내가 만든 값이 아니므로, 틀린 것이 있으면 여기를 고치거나
 *    「업체_택배사」 탭에 열을 만들어 덮으면 된다.
 *
 *  ★ 빈칸만 채운다 ★
 *    정상 경로(설정 B6 → 매핑탭 → 거래처정보)가 값을 찾으면 그걸 쓴다.
 *    여기는 그 뒤에만 끼어든다. 멀쩡한 값을 덮지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

/** 접두 → 거래처코드 (폴백). 하이픈이 있는 것은 그대로 둔다 — 이카운트 등록 형태다. */
var _PVC_FALLBACK_ = {
  AJ: "6928601646",   // 아주팩
  AP: "689-87-00032", // 올팩
  BW: "2310159489",   // 부원
  HR: "108-88-03537", // 뉴파츠
  HU: "4978603205",   // 후아코리아
  IW: "7788602139",   // 인터웍스
  JM: "3090923989",   // 제이엠
  KR: "1258631688",   // 코라마
  LG: "101-86-45056", // 로엔그린
  NK: "1388195228",   // 냅킨코리아
  OC: "129-39-54485", // 부엉이커피
  TY: "4308600321",   // 태양
  YS: "4846200318",   // 와이에스
};

var _PVC_CACHE_ = null;

/**
 * 「업체_택배사」 탭에 거래처코드 열이 있으면 읽는다.
 * 머리글에 「거래처코드」·「CUST」가 들어간 열을 찾는다. 없으면 폴백만 쓴다.
 */
function _pvc_load_() {
  if (_PVC_CACHE_) return _PVC_CACHE_;
  var out = { byPfx: {}, byName: {}, fromTab: 0, fromCode: 0 };

  try {
    var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
    var tab = hub.getSheetByName("업체_택배사");
    if (tab && tab.getLastRow() >= 2) {
      var lc = Math.max(tab.getLastColumn(), 2);
      var data = tab.getRange(1, 1, tab.getLastRow(), lc).getDisplayValues();
      var hdr = data[0] || [];
      var cdCol = -1;
      for (var c = 0; c < hdr.length; c++) {
        var h = String(hdr[c] || "").replace(/\s/g, "").toUpperCase();
        if (h.indexOf("거래처코드") !== -1 || h.indexOf("CUST") !== -1) { cdCol = c; break; }
      }
      if (cdCol >= 0) {
        for (var r = 1; r < data.length; r++) {
          var pfx = String(data[r][0] || "").trim().toUpperCase();
          var nm = String(data[r][1] || "").trim();
          var cd = String(data[r][cdCol] || "").trim();
          if (!cd) continue;
          if (pfx && !out.byPfx[pfx]) { out.byPfx[pfx] = cd; out.fromTab++; }
          if (nm) {
            var k = (typeof _epx_norm_ === "function") ? _epx_norm_(nm) : nm;
            if (k && !out.byName[k]) out.byName[k] = cd;
          }
        }
      }
    }
  } catch (e) {
    Logger.log("[PVC] 「업체_택배사」 읽기 실패: " + e.message);
  }

  // 탭에 없는 접두만 코드 폴백으로 메운다. 탭이 늘 이긴다.
  for (var p in _PVC_FALLBACK_) {
    if (!out.byPfx[p]) { out.byPfx[p] = _PVC_FALLBACK_[p]; out.fromCode++; }
  }

  _PVC_CACHE_ = out;
  return out;
}

/**
 * 접두 또는 업체명으로 거래처코드를 찾는다.
 * 정상 경로가 실패했을 때만 부르는 최후 폴백이다.
 *
 * @param pfx      업체 접두 (HR·BW …). 없으면 "" 가능
 * @param vendorNm 업체명. 접두가 없을 때 쓴다
 * @return 거래처코드. 못 찾으면 ""
 */
function _pvc_codeFor_(pfx, vendorNm) {
  var m = _pvc_load_();
  var p = String(pfx || "").trim().toUpperCase();
  if (p && m.byPfx[p]) return m.byPfx[p];

  var nm = String(vendorNm || "").trim();
  if (!nm) return "";
  var key = (typeof _epx_norm_ === "function") ? _epx_norm_(nm) : nm;
  if (key && m.byName[key]) return m.byName[key];

  // 업체명 → 접두 (「업체_택배사」/코드표의 이름 대조)
  try {
    var names = (typeof _PEP_VENDOR_NAME_ !== "undefined") ? _PEP_VENDOR_NAME_ : {};
    for (var k in names) {
      var kn = (typeof _epx_norm_ === "function") ? _epx_norm_(names[k]) : names[k];
      if (kn && key && (kn === key || key.indexOf(kn) !== -1 || kn.indexOf(key) !== -1)) {
        if (m.byPfx[k]) return m.byPfx[k];
      }
    }
  } catch (e2) {}
  return "";
}

/** [메뉴] 업체별 거래처코드가 어떻게 풀리는지 본다 — 읽기 전용 */
function partnerDiagnoseVendorCustCode() {
  var m = _pvc_load_();
  var L = ["═══ 업체 거래처코드 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), "",
    "「업체_택배사」 탭에서 " + m.fromTab + "개 · 코드 폴백 " + m.fromCode + "개", ""];
  if (!m.fromTab) {
    L.push("※ 「업체_택배사」 탭에 거래처코드 열이 없습니다.");
    L.push("   머리글에 「거래처코드」가 든 열을 만들어 채우면 코드를 안 고쳐도 됩니다.");
    L.push("");
  }
  var names = (typeof _PEP_VENDOR_NAME_ !== "undefined") ? _PEP_VENDOR_NAME_ : {};
  var keys = Object.keys(m.byPfx).sort();
  for (var i = 0; i < keys.length; i++) {
    L.push("  " + keys[i] + "  " + String(names[keys[i]] || "").padEnd(8) + "  " + m.byPfx[keys[i]]);
  }
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("업체 거래처코드", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return text;
}
