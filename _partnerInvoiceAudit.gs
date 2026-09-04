/**
 * ══════════════════════════════════════════════════════════════
 *  송장 매칭 감사 — 어느 소스가 실제로 일하고, 미매칭이 얼마나 쌓이나
 *  파일: _partnerInvoiceAudit.gs
 *
 *  "이 소스 빼도 되나"를 감으로 정하지 않으려고 만든다.
 *  느슨한 소스(이름+전화)를 빼면 미매칭이 늘고, 그대로 두면 엉뚱한 송장이
 *  붙는다. 둘 다 손해라서 숫자를 보고 정해야 한다.
 *
 *  읽기만 한다. 고치지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

/** 최근 며칠치 일일마감을 훑을지 */
var _PIA_SCAN_DAYS_ = 14;

/**
 * [메뉴/편집기] 송장 매칭 감사
 * 파일: _partnerInvoiceAudit.gs
 */
function partnerAuditInvoiceMatching() {
  var L = ["═══ 송장 매칭 감사 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];

  // ── A. 최근 N일 일일마감의 실제 결과 ──
  L.push("[A] 최근 " + _PIA_SCAN_DAYS_ + "일 일일마감 — 출처별 결과");
  L.push("    (출처는 송장이 어디서 왔는지를 그대로 적은 값이다)");
  var grand = {}, grandRows = 0, grandNoInv = 0;
  var perDay = [];
  var today = new Date();
  for (var d = 1; d <= _PIA_SCAN_DAYS_; d++) {
    var dt = new Date(today.getTime());
    dt.setDate(dt.getDate() - d);
    var ds = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
    try {
      var ss = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + ds + ")");
      if (!ss) continue;
      var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
      var lr = tab.getLastRow();
      if (lr < 2) continue;
      var lc = tab.getLastColumn();
      var all = tab.getRange(1, 1, lr, lc).getDisplayValues();
      var hdr = all[0];
      var invCol = -1, srcCol = -1;
      for (var h = 0; h < hdr.length; h++) {
        var hh = String(hdr[h] || "").replace(/\s/g, "");
        if (invCol < 0 && /운송장번호|송장번호/.test(hh)) invCol = h;
        if (srcCol < 0 && hh === "출처") srcCol = h;
      }
      if (invCol < 0) invCol = lc - 2;
      if (srcCol < 0) srcCol = lc - 1;

      var dayNo = 0, dayRows = 0;
      for (var r = 1; r < all.length; r++) {
        // 일일마감 파일 맨 아래 합계·요약 행은 데이터가 아니다.
        // 출처 칸에 "롯데:664 대리공급:103 …" 같은 요약 문자열이 들어 있어
        // 그대로 세면 출처 목록이 지저분해지고 미매칭 수도 부풀려진다.
        if (String(all[r][0] || "").indexOf("합계") !== -1) continue;
        if (String(all[r][srcCol] || "").indexOf("미매칭:") !== -1) continue;
        var src = String(all[r][srcCol] || "").trim() || "(빈칸)";
        var inv = String(all[r][invCol] || "").trim();
        if (!src && !inv && !String(all[r][1] || "").trim()) continue;
        dayRows++;
        grand[src] = (grand[src] || 0) + 1;
        if (!inv) { dayNo++; }
      }
      grandRows += dayRows;
      grandNoInv += dayNo;
      perDay.push({ date: ds, rows: dayRows, noInv: dayNo });
    } catch (eD) {
      L.push("    ★ " + ds + ": " + eD.message);
    }
  }

  if (!grandRows) {
    L.push("    최근 " + _PIA_SCAN_DAYS_ + "일 일일마감 파일을 찾지 못했습니다.");
  } else {
    var keys = Object.keys(grand).sort(function (a, b) { return grand[b] - grand[a]; });
    for (var k = 0; k < keys.length; k++) {
      var pct = Math.round(grand[keys[k]] / grandRows * 1000) / 10;
      L.push("      " + _pia_pad_(keys[k], 12) + " " + _pia_padL_(grand[keys[k]], 6) + "건  " + pct + "%");
    }
    L.push("      ─────────────────────────");
    L.push("      " + _pia_pad_("합계", 12) + " " + _pia_padL_(grandRows, 6) + "건");
    L.push("      송장 없는 행: " + grandNoInv + "건 (" +
      Math.round(grandNoInv / grandRows * 1000) / 10 + "%)");
  }
  L.push("");

  // ── B. 날짜별 미매칭 — 소급 보강을 며칠치까지 돌려야 하나 ──
  L.push("[B] 날짜별 송장 없는 행 — 소급 보강 범위 판단용");
  if (!perDay.length) {
    L.push("    파일 없음");
  } else {
    var stale = 0;
    for (var p = 0; p < perDay.length; p++) {
      var e = perDay[p];
      var mark = (p >= 1 && e.noInv > 0) ? "  ← 직전 1일 보강 범위 밖" : "";
      if (p >= 1) stale += e.noInv;
      L.push("      " + e.date + "  " + _pia_padL_(e.rows, 5) + "행 중 송장없음 " +
        _pia_padL_(e.noInv, 4) + mark);
    }
    L.push("");
    L.push("    ★ 지금 구조는 '직전 마감 파일 1개'만 채웁니다.");
    L.push("      그보다 오래된 미매칭 누적: " + stale + "건");
    L.push("      → 이 수가 크면 소급 보강 범위를 늘릴 값어치가 있습니다.");
  }
  L.push("");

  // ── C. 송장맵 소스별 키 수 ──
  L.push("[C] 송장맵 소스별 키 수 (원천을 다시 읽습니다 — 1~2분)");
  try {
    var stat = { lotte: 0, weekly: 0, temp: 0, hub: 0, ledger: 0, keys: 0,
      exclusive: 0, orderArchive: 0, hubArchive: 0, errors: [] };
    _puv_buildInvoiceMap_(stat);
    var rows = [
      ["롯데 송장탭", stat.lotte], ["1주출고(7일)", stat.weekly],
      ["대리공급 임시기록", stat.temp], ["협력업체_발주허브", stat.hub],
      ["송장원장", stat.ledger], ["전용마감", stat.exclusive || 0],
      ["발주마감", stat.orderArchive || 0], ["허브아카이브", stat.hubArchive || 0]
    ];
    rows.sort(function (a, b) { return b[1] - a[1]; });
    for (var s = 0; s < rows.length; s++) {
      L.push("      " + _pia_pad_(rows[s][0], 18) + " " + _pia_padL_(rows[s][1], 7));
    }
    L.push("      ─────────────────────────");
    L.push("      " + _pia_pad_("총 키", 18) + " " + _pia_padL_(stat.keys, 7));
    if (stat.errors && stat.errors.length) {
      L.push("      오류 " + stat.errors.length + "건: " + stat.errors.slice(0, 3).join(" / "));
    }
  } catch (eC) {
    L.push("    ★ 송장맵 구축 실패: " + eC.message);
  }

  L.push("");
  L.push("※ [A]의 '합포장'이 많으면 합배송 탭이 실제로 일하고 있다는 뜻입니다.");
  L.push("※ [C]의 키 수가 0인 소스는 지금 아무 일도 안 하고 있는 것입니다.");

  return _pia_out_(L, "송장 매칭 감사");
}

/**
 * [메뉴/편집기] 최근 N일 일일마감 미매칭 재매칭
 *
 * 지금 마감은 '직전 파일 1개'만 채운다. 송장이 이틀 넘게 늦게 들어오면
 * 그 건은 영영 미매칭으로 남는다. 이 함수가 그 뒤를 훑는다.
 *
 * 마감 본체에 넣지 않은 이유: 파일 N개를 여는 만큼 마감이 길어지고,
 * 마감은 이미 6분 한도를 신경 쓰며 돌고 있다. 따로 돌리는 편이 안전하다.
 *
 * @param {number=} optDays 기본 14
 * 파일: _partnerInvoiceAudit.gs
 */
function partnerBackfillRecentArchives(optDays) {
  var days = parseInt(optDays, 10) || _PEP_BACKFILL_DAYS_ || 14;
  var L = ["═══ 미매칭 소급 보강 (최근 " + days + "일) ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];
  try {
    L.push("송장맵을 만드는 중… (원천 전체를 읽습니다)");
    var stat = { lotte: 0, weekly: 0, temp: 0, hub: 0, ledger: 0, keys: 0, errors: [] };
    var map = _puv_buildInvoiceMap_(stat);
    L.push("  송장키 " + stat.keys + "개");
    L.push("");

    var out = _pep_backfillRecentArchives_(map, days);
    L.push("훑은 파일: " + out.files + "개");
    L.push("검사한 행: " + out.scanned + "행");
    L.push("★ 새로 채운 송장: " + out.patched + "건");
    if (out.days && out.days.length) {
      L.push("");
      L.push("날짜별:");
      for (var i = 0; i < out.days.length; i++) L.push("  " + out.days[i]);
    }
    if (!out.patched) {
      L.push("");
      L.push("채울 것이 없었습니다. 미매칭이 남아 있다면 송장 자체가");
      L.push("아직 어느 원천에도 안 들어온 것입니다.");
    }
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _pia_out_(L, "미매칭 소급 보강");
}

function _pia_pad_(s, n) {
  s = String(s);
  while (s.length < n) s += " ";
  return s;
}

function _pia_padL_(s, n) {
  s = String(s);
  while (s.length < n) s = " " + s;
  return s;
}

function _pia_out_(L, title) {
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert(title, text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  남은 미매칭의 성격 분석
 *
 *  소급 보강으로 회수되지 않은 건은 "매칭 로직이 못 찾은 것"이 아니라
 *  "송장이 어느 원천에도 없는 것"일 가능성이 높다. 그렇다면 코드로
 *  고칠 문제가 아니라 현장에서 고칠 문제다 — 어느 판매처·어느 품목에
 *  몰려 있는지 보면 어디를 손봐야 할지 드러난다.
 *
 *  읽기만 한다.
 *  파일: _partnerInvoiceAudit.gs
 * ══════════════════════════════════════════════════════════════
 */
/**
 * 품목코드·품목명 → 상품정보 상태값 맵. 실행 1회분만 캐시한다.
 * ★ 2026-09-02 신규
 *
 * 미매칭(송장 없는 행)의 성격을 가를 때 쓴다. 품목이 품절이면 송장 매칭이
 * 실패한 게 아니라 애초에 물건이 안 나갔을 가능성이 크다. 둘은 손쓸 곳이
 * 전혀 다르다 — 전자는 매칭을 고치고, 후자는 주문을 취소하거나 발송해야 한다.
 */
var _PIA_STATUS_MAP_ = null;

function _pia_itemStatusMap_() {
  if (_PIA_STATUS_MAP_) return _PIA_STATUS_MAP_;
  var map = { byCode: {}, byName: {}, rows: 0, error: "" };

  try {
    var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("상품정보");
    if (!tab) {
      map.error = "'상품정보' 탭 없음";
      _PIA_STATUS_MAP_ = map;
      return map;
    }
    var vals = tab.getDataRange().getDisplayValues();

    // 헤더 행을 찾는다 — 상품정보는 5행 헤더/6행 데이터가 표준이지만 확정하지 않는다
    var hdrRow = -1, cCode = -1, cName = -1, cStat = -1;
    for (var r = 0; r < Math.min(vals.length, 12); r++) {
      var row = vals[r] || [];
      var code = -1, name = -1, stat = -1;
      for (var c = 0; c < row.length; c++) {
        var h = String(row[c] || "").replace(/\s/g, "");
        if (code < 0 && /품목코드|이카운트코드|PROD_CD/i.test(h)) code = c;
        if (name < 0 && /품목명|상품명/.test(h) && !/코드/.test(h)) name = c;
        if (stat < 0 && h === "상태") stat = c;
      }
      if (code >= 0 && stat >= 0) { hdrRow = r; cCode = code; cName = name; cStat = stat; break; }
    }
    if (hdrRow < 0) {
      map.error = "상품정보에서 품목코드/상태 헤더를 찾지 못함";
      _PIA_STATUS_MAP_ = map;
      return map;
    }

    for (var i = hdrRow + 1; i < vals.length; i++) {
      var v = vals[i] || [];
      var st = String(v[cStat] || "").trim();
      if (!st) continue;
      var cd = String(v[cCode] || "").trim().toUpperCase();
      if (cd) { map.byCode[cd] = st; map.rows++; }
      if (cName >= 0) {
        var nm = String(v[cName] || "").replace(/\s/g, "");
        if (nm && !map.byName[nm]) map.byName[nm] = st;
      }
    }
  } catch (e) {
    map.error = e.message;
  }

  _PIA_STATUS_MAP_ = map;
  return map;
}

/**
 * 이 상태값이면 물건이 안 나갔을 수 있다.
 * "품절+7"은 7일 뒤 입고라 판매중으로 본다 — 기존 orderSyncManager 판정과 같다.
 */
function _pia_isNoShipStatus_(st) {
  var s = String(st || "");
  if (!s) return "";
  if (s.indexOf("품절+") !== -1) return "";
  if (s.indexOf("품절") !== -1) return "품절";
  if (s.indexOf("단종") !== -1) return "단종";
  return "";
}

function partnerAnalyzeUnmatched(optDays) {
  var days = parseInt(optDays, 10) || _PIA_SCAN_DAYS_;
  var L = ["═══ 남은 미매칭 성격 분석 (최근 " + days + "일) ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];
  try {
    var byShop = {}, byItemKind = {}, bySrc = {}, total = 0, files = 0;
    var samples = [];
    var noShipSamples = [], noShipTotal = 0;   // 품절·단종 → 미발송 의심
    var today = new Date();

    // 송장이 원래 없는 줄들 — 이건 미매칭이 아니라 정상이다
    var NO_PARCEL = ["할인", "추가운임", "도서산간", "배송비", "반품", "적립", "쿠폰"];

    for (var d = 1; d <= days; d++) {
      var dt = new Date(today.getTime());
      dt.setDate(dt.getDate() - d);
      var ds = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");
      var ss = _unified_findExistingArchiveSs_(_UNIFIED_ARCHIVE_PREFIX_ + "(" + ds + ")");
      if (!ss) continue;
      var tab = ss.getSheetByName("일일마감") || ss.getSheets()[0];
      var lr = tab.getLastRow();
      if (lr < 2) continue;
      files++;
      var lc = tab.getLastColumn();
      var all = tab.getRange(1, 1, lr, lc).getDisplayValues();
      var hdr = all[0];

      var cInv = -1, cSrc = -1, cShop = -1, cItem = -1, cMemo = -1, cCode = -1;
      for (var h = 0; h < hdr.length; h++) {
        var hh = String(hdr[h] || "").replace(/\s/g, "");
        if (cInv < 0 && /운송장번호|송장번호/.test(hh)) cInv = h;
        if (cSrc < 0 && hh === "출처") cSrc = h;
        if (cShop < 0 && /거래처명|업체|판매처/.test(hh)) cShop = h;
        if (cItem < 0 && /품목명|상품명/.test(hh) && !/코드/.test(hh)) cItem = h;
        if (cMemo < 0 && /적요/.test(hh)) cMemo = h;
        if (cCode < 0 && /품목코드|이카운트코드/.test(hh)) cCode = h;
      }
      // 일일마감 표준 양식은 A=품목코드다. 헤더로 못 찾으면 그걸로 본다.
      if (cCode < 0) cCode = 0;
      if (cInv < 0) cInv = lc - 2;
      if (cSrc < 0) cSrc = lc - 1;

      for (var r = 1; r < all.length; r++) {
        if (String(all[r][0] || "").indexOf("합계") !== -1) continue;
        if (String(all[r][cSrc] || "").indexOf("미매칭:") !== -1) continue;
        if (String(all[r][cInv] || "").trim()) continue;   // 송장 있음 → 대상 아님
        var item = cItem >= 0 ? String(all[r][cItem] || "").trim() : "";
        var shop = cShop >= 0 ? String(all[r][cShop] || "").trim() : "";
        var memo = cMemo >= 0 ? String(all[r][cMemo] || "").trim() : "";
        if (!item && !shop) continue;
        total++;

        var src = String(all[r][cSrc] || "").trim() || "(빈칸)";
        bySrc[src] = (bySrc[src] || 0) + 1;

        // 판매처는 "법인/배민상회" 처럼 앞부분이 유형이다 — 그대로 센다
        var shopKey = shop.substring(0, 24) || "(빈칸)";
        byShop[shopKey] = (byShop[shopKey] || 0) + 1;

        // 품목 성격
        var kind = "일반 품목";
        for (var nk = 0; nk < NO_PARCEL.length; nk++) {
          if (item.indexOf(NO_PARCEL[nk]) !== -1) { kind = "택배 아님(" + NO_PARCEL[nk] + ")"; break; }
        }
        if (kind === "일반 품목") {
          /* ★ 2026-09-02: 상태값이 품절/단종이면 「미발송 의심」으로 가른다.
             송장이 안 붙은 게 매칭 실패가 아니라 물건이 안 나간 것일 수 있다.
             손쓸 곳이 다르다 — 매칭을 고칠 게 아니라 발송하거나 취소해야 한다.
             샘플·방문수령보다 먼저 본다. 이쪽이 훨씬 급하다. */
          var smap = _pia_itemStatusMap_();
          var code = cCode >= 0 ? String(all[r][cCode] || "").trim().toUpperCase() : "";
          var st = (code && smap.byCode[code]) ||
            smap.byName[item.replace(/\s/g, "")] || "";
          var noShip = _pia_isNoShipStatus_(st);
          if (noShip) {
            kind = "미발송 의심(" + noShip + ")";
            if (noShipSamples.length < 20) {
              noShipSamples.push(ds + "  [" + st + "] " +
                shop.substring(0, 16) + " · " + item.substring(0, 24) +
                (code ? " (" + code + ")" : ""));
            }
            noShipTotal++;
          } else if (item.indexOf("샘플") !== -1) kind = "샘플";
          else if (/방문수령|방문|직접/.test(memo)) kind = "방문수령(적요)";
        }
        byItemKind[kind] = (byItemKind[kind] || 0) + 1;

        if (kind === "일반 품목" && samples.length < 12) {
          samples.push(ds + "  " + shop.substring(0, 18) + " · " + item.substring(0, 26));
        }
      }
    }

    L.push("파일 " + files + "개 · 송장 없는 행 " + total + "건");

    /* 미발송 의심을 맨 위에 세운다. 나머지 통계는 "왜 안 붙었나"를 보는
       참고자료지만 이건 지금 손봐야 하는 건이다 — 물건이 안 나갔을 수 있다. */
    var smap0 = _pia_itemStatusMap_();
    L.push("");
    if (smap0.error) {
      L.push("⚠️ 미발송 의심 판정 불가 — 상품정보 상태값을 못 읽었습니다: " + smap0.error);
    } else if (noShipTotal) {
      L.push("🚨 미발송 의심 " + noShipTotal + "건 — 품목 상태가 품절/단종인데 송장이 없습니다");
      L.push("   송장 매칭 문제가 아니라 물건이 안 나갔을 수 있습니다.");
      L.push("   발송할지 취소할지 확인이 필요합니다.");
      for (var ns = 0; ns < noShipSamples.length; ns++) L.push("   · " + noShipSamples[ns]);
      if (noShipTotal > noShipSamples.length) {
        L.push("   … 외 " + (noShipTotal - noShipSamples.length) + "건");
      }
    } else {
      L.push("✅ 미발송 의심 없음 — 송장 없는 행 중 품절/단종 품목은 없습니다 (상품정보 " +
        smap0.rows + "행 대조)");
    }

    L.push("");
    L.push("[1] 품목 성격별 — 애초에 송장이 없는 줄이 섞여 있는가");
    L.push(_pia_rank_(byItemKind, total, 10));
    L.push("");
    L.push("[2] 출처별");
    L.push(_pia_rank_(bySrc, total, 10));
    L.push("");
    L.push("[3] 판매처별 상위 15 — 여기 몰려 있으면 그 경로를 손봐야 한다");
    L.push(_pia_rank_(byShop, total, 15));
    if (samples.length) {
      L.push("");
      L.push("[4] '일반 품목'인데 송장 없는 예시 (진짜 문제인 것들)");
      for (var s = 0; s < samples.length; s++) L.push("      " + samples[s]);
    }
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _pia_out_(L, "미매칭 성격 분석");
}

function _pia_rank_(obj, total, topN) {
  var keys = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; });
  var out = [];
  for (var i = 0; i < Math.min(keys.length, topN); i++) {
    var pct = total ? Math.round(obj[keys[i]] / total * 1000) / 10 : 0;
    out.push("      " + _pia_pad_(keys[i], 26) + " " + _pia_padL_(obj[keys[i]], 6) + "건  " + pct + "%");
  }
  if (keys.length > topN) out.push("      … 외 " + (keys.length - topN) + "종");
  return out.join("\n");
}
