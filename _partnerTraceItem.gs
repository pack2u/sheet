/**
 * ══════════════════════════════════════════════════════════════
 *  품목 추적 — 이 건이 왜 송장을 못 받고 일일마감에서 빠지는가
 *  파일: _partnerTraceItem.gs
 *
 *  샘플 건(이카운트코드 SAMPLE·품목명 "샘플신청" 등)이 송장 매칭도 안 되고
 *  일일마감에서도 빠진다는 제보에서 출발했다. 원인을 짐작하지 않고
 *  단계별로 실제 값을 찍어 본다.
 *
 *  훑는 순서는 실제 처리 순서와 같다:
 *    판매현황_임시기록 → 기타 판정 → 송장맵 조회 → 일일마감 존재 여부
 *
 *  읽기만 한다. 고치지 않는다.
 *  스크립트 편집기에서 partnerTraceItem() 실행 (기본 검색어 "샘플").
 * ══════════════════════════════════════════════════════════════
 */

/** 판매현황_임시기록 고정 열 — _pep_archiveUnifiedDaily_ 와 같은 규칙 */
var _PTI_SNAP_NAME_ = 14; // O 수하인
var _PTI_SNAP_PHONE_ = 15; // P 전화

/**
 * @param {string=} optKeyword 품목명/코드/매칭키에서 찾을 말. 기본 "샘플"
 * @param {number=} optLimit 최대 몇 건까지 자세히 볼지. 기본 15
 */
function partnerTraceItem(optKeyword, optLimit) {
  var kw = String(optKeyword || "샘플").trim();
  var limit = parseInt(optLimit, 10) || 15;
  var L = ["═══ 품목 추적: \"" + kw + "\" ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ── 1. 판매현황_임시기록에서 대상 행 찾기 ──
    var snap = ss.getSheetByName(_SNAPSHOT_TAB_NAME_);
    if (!snap) { L.push("★ " + _SNAPSHOT_TAB_NAME_ + " 탭 없음"); return _pti_out_(L); }
    var sLr = snap.getLastRow();
    if (sLr < 2) { L.push(_SNAPSHOT_TAB_NAME_ + " 비어 있음"); return _pti_out_(L); }
    var sLc = snap.getLastColumn();
    var hdr = snap.getRange(1, 1, 1, sLc).getDisplayValues()[0];
    var sData = snap.getRange(2, 1, sLr - 1, sLc).getDisplayValues();

    // 품목명 열 위치 (본 처리와 같은 방식)
    var itemCol = -1;
    for (var h = 2; h < sLc - 1; h++) {
      if (itemCol < 0 && /품목명|상품명|제품명|품명/.test(String(hdr[h] || ""))) itemCol = h;
    }
    if (itemCol < 0) itemCol = 4;
    L.push("판매현황_임시기록 " + sData.length + "행 · 품목명 열 = " +
      _pti_colLetter_(itemCol + 1) + "(" + (hdr[itemCol] || "") + ")");

    var hits = [];
    for (var i = 0; i < sData.length; i++) {
      var joined = [sData[i][1], sData[i][3], sData[i][itemCol]].join(" ");
      if (joined.toUpperCase().indexOf(kw.toUpperCase()) === -1) continue;
      hits.push({
        row: i + 2,
        date: String(sData[i][0] || "").trim(),
        matchKey: String(sData[i][1] || "").trim(),
        dVal: String(sData[i][3] || "").trim(),
        item: String(sData[i][itemCol] || "").trim(),
        name: String(sData[i][_PTI_SNAP_NAME_] || "").trim(),
        phone: String(sData[i][_PTI_SNAP_PHONE_] || "").trim()
      });
    }
    L.push("→ \"" + kw + "\" 포함 " + hits.length + "건");
    L.push("");

    if (!hits.length) {
      L.push("판매현황_임시기록에 해당 건이 없습니다.");
      L.push("※ 매칭이 끝난 건은 이 탭에서 지워집니다. 오늘 미매칭 건만 남습니다.");
      return _pti_out_(L);
    }

    // ── 2. 기타(비주문) 판정 — 여기 걸리면 송장 매칭을 아예 안 한다 ──
    var NON_ORDER = ["반품", "반품비", "제주도서산간", "제주도서", "도서산간", "추가배송비"];
    var otherCnt = 0;
    for (var a = 0; a < hits.length; a++) {
      var isOther = false, why = "";
      for (var nk = 0; nk < NON_ORDER.length; nk++) {
        if (hits[a].matchKey.indexOf(NON_ORDER[nk]) !== -1) { isOther = true; why = NON_ORDER[nk]; break; }
      }
      if (!isOther && hits[a].dVal.indexOf("[샘플]") !== -1) { isOther = true; why = "[샘플] 표시"; }
      hits[a].isOther = isOther;
      hits[a].otherWhy = why;
      if (isOther) otherCnt++;
    }
    L.push("[1] 기타(비주문) 판정 — 걸리면 송장 매칭을 건너뜁니다");
    L.push("    기타로 빠짐: " + otherCnt + "건 / 주문으로 처리: " + (hits.length - otherCnt) + "건");
    L.push("");

    // ── 3. 송장맵 조회 ──
    L.push("[2] 송장맵 조회 (원천 전체를 다시 읽습니다 — 시간이 걸립니다)");
    var stat = { lotte: 0, weekly: 0, temp: 0, hub: 0, ledger: 0, keys: 0, errors: [] };
    var map = _puv_buildInvoiceMap_(stat);
    L.push("    송장키 " + stat.keys + "개 (롯데 " + stat.lotte + ", 1주출고 " + stat.weekly +
      ", 원장 " + stat.ledger + ", 임시 " + stat.temp + ", 허브 " + stat.hub + ")");
    L.push("");

    L.push("[3] 건별 추적 (최대 " + limit + "건)");
    var noInv = 0;
    for (var b = 0; b < Math.min(hits.length, limit); b++) {
      var t = hits[b];
      L.push("  ─────────────────────────────");
      L.push("  " + (t.name || "(이름없음)") + " · " + (t.item || "(품목없음)") +
        "  [" + _SNAPSHOT_TAB_NAME_ + " " + t.row + "행]");
      L.push("      매칭키: " + (t.matchKey || "(없음)"));
      L.push("      전화  : " + (t.phone || "(없음)"));
      if (t.isOther) {
        L.push("      → ★ 기타로 분류됨 (" + t.otherWhy + ") — 송장을 붙이지 않습니다");
        noInv++;
        continue;
      }
      var via = {};
      var res = null;
      try {
        res = _pep_resolveRowInvoice_(map, {
          uid: t.matchKey, name: t.name, phone: t.phone,
          addr: "", item: t.item, orderDate: t.date
        }, via);
      } catch (eR) {
        L.push("      → ★ 조회 오류: " + eR.message);
        continue;
      }
      if (res && res.inv) {
        L.push("      → ✔ 송장 " + res.inv + "  (경로: " + (via.via || "?") + ")");
      } else {
        noInv++;
        L.push("      → ★ 송장 못 찾음 (경로: " + (via.via || "이름전화 실패") + ")");
      }
    }
    if (hits.length > limit) L.push("  … 외 " + (hits.length - limit) + "건");

    L.push("");
    L.push("[요약] " + hits.length + "건 중 송장 없음 " + noInv + "건");
    if (otherCnt) {
      L.push("");
      L.push("※ 기타로 빠진 건은 설계상 송장을 붙이지 않습니다.");
      L.push("  샘플도 실제로 택배로 나간다면 이 규칙이 맞지 않는 것입니다.");
    }
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _pti_out_(L);
}

function _pti_colLetter_(n) {
  var s = "";
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

function _pti_out_(L) {
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("품목 추적", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}

/**
 * 일일마감 파일에서 특정 말이 든 행을 뽑아 본다 — "정말 빠졌는가" 확인용.
 * @param {string=} optKeyword 기본 "샘플"
 * @param {string=} optDateStr yyyy-MM-dd. 비우면 어제
 */
function partnerTraceItemInDailyClose(optKeyword, optDateStr) {
  var kw = String(optKeyword || "샘플").trim();
  var L = ["═══ 일일마감 확인: \"" + kw + "\" ═══"];
  try {
    var d = String(optDateStr || "").trim();
    if (!d) {
      var y = new Date(); y.setDate(y.getDate() - 1);
      d = Utilities.formatDate(y, "Asia/Seoul", "yyyy-MM-dd");
    }
    L.push("대상: " + _UNIFIED_ARCHIVE_PREFIX_ + "(" + d + ")");
    L.push("");

    var ss = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + d + ")");
    if (!ss) { L.push("★ 파일을 못 찾았습니다."); return _pti_out_(L); }
    var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
    var lr = tab.getLastRow();
    if (lr < 2) { L.push("데이터 없음"); return _pti_out_(L); }
    var lc = tab.getLastColumn();
    var all = tab.getRange(1, 1, lr, lc).getDisplayValues();
    var hdr = all[0];

    var invCol = -1, srcCol = -1;
    for (var h = 0; h < hdr.length; h++) {
      var hh = String(hdr[h] || "").replace(/\s/g, "");
      if (invCol < 0 && /운송장번호|송장번호/.test(hh)) invCol = h;
      if (srcCol < 0 && hh === "출처") srcCol = h;
    }

    var found = 0, withInv = 0;
    for (var r = 1; r < all.length; r++) {
      if (all[r].join(" ").toUpperCase().indexOf(kw.toUpperCase()) === -1) continue;
      found++;
      var inv = invCol >= 0 ? String(all[r][invCol] || "").trim() : "";
      if (inv) withInv++;
      if (found <= 30) {
        L.push("  " + (inv ? "✔ " + inv : "★ 송장없음") +
          "  " + String(all[r][1] || "").substring(0, 22) +
          " · " + String(all[r][7] || "").substring(0, 18) +
          (srcCol >= 0 ? " · " + all[r][srcCol] : "") + "  (" + (r + 1) + "행)");
      }
    }
    if (found > 30) L.push("  … 외 " + (found - 30) + "건");
    L.push("");
    L.push(found
      ? "총 " + found + "건 · 송장 있음 " + withInv + " / 없음 " + (found - withInv)
      : "★ 일일마감에 \"" + kw + "\" 가 한 건도 없습니다 — 기록 단계에서 빠진 것입니다.");
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _pti_out_(L);
}

/**
 * ══════════════════════════════════════════════════════════════
 *  샘플 합포장 보강 — 같은 수취인의 송장을 샘플 줄에도 붙인다
 *  파일: _partnerTraceItem.gs  (일일마감 _pep_archiveUnifiedDaily_ 에서 호출)
 *
 *  샘플은 단독으로 나가는 일이 드물다. 본 주문 상자에 같이 담겨 나가므로
 *  송장번호가 같다. 그런데 샘플 줄은 사방넷 주문번호가 따로 없거나
 *  롯데탭에 안 잡혀서 매칭에 실패하는 일이 잦다.
 *
 *  그래서 매칭이 끝난 뒤, 송장이 빈 샘플 줄에 대해
 *  같은 날 · 같은 수취인 · 같은 전화 인 줄의 송장을 그대로 옮겨 적는다.
 *
 *  ★ 같은 수취인이 없으면 아무것도 하지 않는다 ★
 *    단독 발송 샘플에 남의 송장을 붙이면 조회가 엉뚱한 상자를 가리킨다.
 *    미매칭으로 남겨 두는 편이 눈에 띄고 안전하다.
 *
 *  행 구조 (matchedHeaders 와 짝):
 *    0 품목코드 · 1 품목명 · 3 전화 · 4 모바일 · 7 거래처명(수취인)
 *    15 택배사 · 16 운송장번호 · 17 출처
 * ══════════════════════════════════════════════════════════════
 */
var _PSF_ITEM_ = 1, _PSF_PHONE_ = 3, _PSF_MOBILE_ = 4, _PSF_NAME_ = 7;
var _PSF_CARRIER_ = 15, _PSF_INV_ = 16, _PSF_SRC_ = 17;

function _psf_isSampleItem_(v) {
  var s = String(v == null ? "" : v).replace(/^\s+/, "");
  return s.indexOf("[샘플]") === 0 || s.indexOf("샘플") === 0;
}

function _psf_key_(row) {
  var name = String(row[_PSF_NAME_] || "").replace(/\s/g, "").trim();
  var ph = String(row[_PSF_PHONE_] || "").replace(/[^0-9]/g, "");
  if (!ph) ph = String(row[_PSF_MOBILE_] || "").replace(/[^0-9]/g, "");
  if (!name && !ph) return "";
  return name + "|" + ph;
}

/**
 * @param {Array[]} rows 한 날짜분 일일마감 행
 * @return {number} 채운 건수
 */
function pepFillSampleCombinedInvoice(rows) {
  if (!rows || !rows.length) return 0;

  // 송장이 있는 줄의 수취인키 → {inv, carrier}
  var donor = {};
  for (var i = 0; i < rows.length; i++) {
    var inv = String(rows[i][_PSF_INV_] || "").trim();
    if (!inv) continue;
    if (_psf_isSampleItem_(rows[i][_PSF_ITEM_])) continue; // 샘플끼리는 주고받지 않는다
    var k = _psf_key_(rows[i]);
    if (!k || donor[k]) continue;
    donor[k] = { inv: inv, carrier: String(rows[i][_PSF_CARRIER_] || "").trim() };
  }

  var filled = 0;
  for (var r = 0; r < rows.length; r++) {
    if (String(rows[r][_PSF_INV_] || "").trim()) continue;      // 이미 송장 있음
    if (!_psf_isSampleItem_(rows[r][_PSF_ITEM_])) continue;      // 샘플 줄만
    var k2 = _psf_key_(rows[r]);
    if (!k2 || !donor[k2]) continue;                             // 같은 수취인 없음 → 그대로 둔다
    rows[r][_PSF_INV_] = donor[k2].inv;
    if (!String(rows[r][_PSF_CARRIER_] || "").trim() && donor[k2].carrier) {
      rows[r][_PSF_CARRIER_] = donor[k2].carrier;
    }
    rows[r][_PSF_SRC_] = "합포장";
    filled++;
  }
  if (filled) Logger.log("[UNIFIED] 샘플 합포장 보강: " + filled + "건");
  return filled;
}
