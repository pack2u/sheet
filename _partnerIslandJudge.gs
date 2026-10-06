/**
 * ══════════════════════════════════════════════════════════════
 *  도서산간 «주소» 판정 — 발주 수집 때, 판매현황 전에 (대리판매 허브 주문만)
 *  파일: _partnerIslandJudge.gs   2026-10-05
 *
 *  > "판매현황전에 확인하자는거야..세트분리 전에 대리판매업체들것만.."
 *  > "세트분리(뉴)에 로젠택배 도서산간이 연동되있어 이부분과 연동시켜줘"
 *
 *  ★ 왜 원장(세트분리 결과)만으로는 안 되나 ★
 *    세트분리는 이카운트 «판매현황»을 받아 돈다. 그러니 원장에 「도서산간」이
 *    적히는 것은 판매입력이 이미 올라간 뒤다. 판매현황 «전에» 알려면
 *    허브 주소를 지금 보고 정해야 한다.
 *
 *  ★ 판정은 세트분리(뉴)와 «같은 자료·같은 순서» ★
 *    자료: 세트분리(뉴) 시트의 「도서산간_도선료」·「도서산간_우편번호」·
 *          「도서산간_시군」·「도서산간_주소사전」 — 사람이 거기서 관리한다.
 *          허브에 따로 목록을 두지 않는다(두 벌이 되면 갈라진다).
 *    순서: core.js ssRoute 의 도서 갈래와 같다.
 *      ① 도선료표 — 시군·읍면동(·리) 이 주소 앞머리에 있으면 섬 (산간 포함)
 *      ② 우편번호 — 있으면 그것만으로 끝 (목록에 있으면 섬, 없으면 일반)
 *      ③ 우편번호를 못 구했을 때만 지역명 — 「확정」 Y 인 것만 섬,
 *         후보만 걸리면 «미확인» 으로 남긴다(돈을 붙이지 않고 알린다)
 *    세 도우미(주소 다듬기·앞머리·도선료표 맞추기)는 core.js 를 옮겨 왔다 —
 *    _islandjudge_test.js 가 core.js 와 같은 답을 내는지 맞대 본다.
 *
 *  ★ 우편번호 ★
 *    세트분리 「도서산간_주소사전」 → 허브 우편번호 캐시 → 카카오(묶어서 한꺼번에).
 *
 *  ★ 어느 줄을 보나 ★
 *    허브에서 판매현황에 아직 안 올라간 줄(P열 빈칸) 중 「도서산간판정」 칸이 빈 것.
 *    한 번 본 줄은 판정을 적어 두므로 다시 묻지 않는다.
 *    이미 올라간 옛 줄은 세트분리 원장(_trigger_islandShipping_)이 뒤에서 받친다.
 * ══════════════════════════════════════════════════════════════
 */

var _ISJ_JUDGE_HEADER_ = "도서산간판정";
var _ISJ_TABS_ = { 도선료: "도서산간_도선료", 우편: "도서산간_우편번호", 시군: "도서산간_시군", 사전: "도서산간_주소사전" };
var _ISJ_KAKAO_BATCH_ = 30;
var _ISJ_SLOW_RETRY_MAX_ = 15;   // 첫판에 못 맞힌 주소를 하나씩 더 묻는 상한
var _ISJ_MAX_ROWS_ = 300;        // 한 번에 보는 줄 상한 (첫날 쌓인 옛 줄 때문에 수집이 끊기지 않게)

/** 허브 마지막 주문 행 — C열(고유ID) 기준. 2,000행 제한 없이 끝까지 본다 */
function _isj_lastRow_(hubTab) {
  var lr = hubTab.getLastRow();
  if (lr < 2) return 1;
  var c = hubTab.getRange(2, 3, lr - 1, 1).getDisplayValues();
  for (var i = c.length - 1; i >= 0; i--) if (String(c[i][0] || "").trim()) return i + 2;
  return 1;
}

/* ── core.js 에서 옮긴 것 (ssNormAddr · ssAddrRegion · ssFerryMatch) ───────── */

function _isj_text_(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** = ssNormAddr */
function _isj_normAddr_(v) {
  var s = _isj_text_(v);
  var i = s.indexOf("\n.(");
  if (i >= 0) s = s.slice(0, i);
  return s.replace(/\s+/g, " ").trim();
}

/** = ssAddrRegion — 행정구역 부분(도로명·번지 앞)만. 상호의 「제주」에 안 걸리게 */
function _isj_addrRegion_(addr) {
  var s = _isj_text_(addr).replace(/\s+/g, " ").trim();
  if (!s) return "";
  var 끝 = s.length;
  var m = s.match(/[가-힣0-9]+(로|길)\s*\d/);
  if (m && m.index >= 0) 끝 = Math.min(끝, m.index + m[0].length);
  var 조각 = s.split(" ");
  if (조각.length >= 3) 끝 = Math.min(끝, 조각.slice(0, 3).join(" ").length);
  if (끝 < 6) 끝 = Math.min(s.length, 12);
  return s.slice(0, 끝);
}

/** = ssFerryMatch */
function _isj_ferryMatch_(addr, ferry) {
  if (!addr || !ferry || !ferry.length) return null;
  var 앞머리 = _isj_addrRegion_(addr);
  for (var i = 0; i < ferry.length; i++) {
    var f = ferry[i];
    if (!f.시군 || !f.읍면동) continue;
    if (앞머리.indexOf(f.시군) < 0) continue;
    if (앞머리.indexOf(f.읍면동) < 0) continue;
    if (f.리 && f.리.length) {
      var hit = false;
      for (var j = 0; j < f.리.length; j++) {
        var ri = _isj_text_(f.리[j]).split(/[0-9(]/)[0].trim();
        if (ri && addr.indexOf(ri) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
    }
    return { 권역: f.권역 || "도서", 료: f.료 || 0, 읍면동: f.읍면동 };
  }
  return null;
}

/* ── 판정 ─────────────────────────────────────────────────── */

/**
 * 순수 — 주소 하나를 판정한다. 시험이 직접 부른다.
 * @param M {ferry:[], zips:{우편번호:권역}, kws:[{kw,zone,confirm}]}
 * @param zip 구한 우편번호 ("" 이면 못 구함)
 * @return {{섬:boolean, 미확인:boolean, 권역:string, 판정:string}}
 */
function _isj_judge_(addr, zip, M) {
  var fh = _isj_ferryMatch_(addr, M.ferry);
  if (fh) {
    var 산간 = _isj_text_(fh.권역) === "산간";
    return { 섬: true, 미확인: false, 권역: fh.권역, 판정: 산간 ? "산간(도선료표)" : "도선료표" };
  }
  if (zip) {
    var z = M.zips[zip];
    if (z) return { 섬: true, 미확인: false, 권역: z, 판정: z === "산간" ? "산간(우편번호)" : "우편번호" };
    return { 섬: false, 미확인: false, 권역: "", 판정: "일반" };
  }
  var 앞머리 = _isj_addrRegion_(addr), 후보 = "";
  for (var k = 0; k < M.kws.length; k++) {
    var w = M.kws[k];
    if (!w || !w.kw || 앞머리.indexOf(w.kw) < 0) continue;
    if (w.confirm) return { 섬: true, 미확인: false, 권역: w.zone || "도서", 판정: "지역확정" };
    후보 = 후보 || w.kw;
  }
  if (후보) return { 섬: false, 미확인: true, 권역: "", 판정: "미확인(" + 후보 + ")" };
  return { 섬: false, 미확인: false, 권역: "", 판정: "일반(우편번호 없음)" };
}

/** 판정 칸에 적는 말 */
function _isj_label_(j, zip) {
  if (j.섬) return "섬 · " + j.권역 + " · " + j.판정 + (zip ? " " + zip : "");
  if (j.미확인) return "미확인 · " + j.판정.replace(/^미확인/, "").replace(/^\(|\)$/g, "") + " · 우편번호 못 찾음";
  return j.판정 + (zip ? " · " + zip : "");
}

/* ── 세트분리(뉴) 자료 ─────────────────────────────────────── */

function _isj_body_(ss, name) {
  var t = ss.getSheetByName(name);
  if (!t || t.getLastRow() < 2) return [];
  return t.getRange(2, 1, t.getLastRow() - 1, Math.max(t.getLastColumn(), 1)).getValues();
}

/** 세트분리(뉴) 도서산간 자료 네 가지 — 순수하게 바꾸는 부분은 _isj_mastersFrom_ */
function _isj_loadMasters_() {
  var ss = SpreadsheetApp.openById(_ISLAND_SS_ID_);
  return _isj_mastersFrom_(
    _isj_body_(ss, _ISJ_TABS_.도선료), _isj_body_(ss, _ISJ_TABS_.우편),
    _isj_body_(ss, _ISJ_TABS_.시군), _isj_body_(ss, _ISJ_TABS_.사전));
}

/** 순수 — 탭 몸통 → 판정 자료 (gasMasters.js ssm_ferryRows·islandZips·islandKeywords·addrZip 와 같은 모양) */
function _isj_mastersFrom_(ferryRows, zipRows, kwRows, dictRows) {
  var M = { ferry: [], zips: {}, kws: [], dict: {} };
  for (var i = 0; i < ferryRows.length; i++) {
    var 읍면동 = _isj_text_(ferryRows[i][2]);
    if (!읍면동) continue;
    var 리raw = _isj_text_(ferryRows[i][3]);
    M.ferry.push({
      시도: _isj_text_(ferryRows[i][0]), 시군: _isj_text_(ferryRows[i][1]), 읍면동: 읍면동,
      리: 리raw ? 리raw.split("|") : [], 료: Number(ferryRows[i][4]) || 0,
      권역: _isj_text_(ferryRows[i][5]) || "도서"
    });
  }
  for (var z = 0; z < zipRows.length; z++) {
    var zv = _isj_text_(zipRows[z][0]);
    if (zv) M.zips[zv] = _isj_text_(zipRows[z][1]) || "도서";
  }
  for (var k = 0; k < kwRows.length; k++) {
    var kv = _isj_text_(kwRows[k][0]);
    if (kv) M.kws.push({ kw: kv, zone: _isj_text_(kwRows[k][1]) || "도서", confirm: _isj_text_(kwRows[k][2]) === "Y" });
  }
  for (var d = 0; d < dictRows.length; d++) {
    var a = _isj_text_(dictRows[d][0]), dz = _isj_text_(dictRows[d][1]);
    if (a && dz) M.dict[a] = dz;
  }
  return M;
}

/* ── 우편번호 구하기 ───────────────────────────────────────── */

/** 주소들 → {주소: 우편번호}. 사전 → 캐시 → 카카오(첫판 묶음) → 못 맞힌 것 몇 개만 하나씩 */
function _isj_zipsFor_(addrs, dict) {
  var out = {}, 물을 = [];
  var cache = typeof _pep_zipCacheLoad_ === "function" ? _pep_zipCacheLoad_() : {};
  addrs.forEach(function (a) {
    if (dict[a]) out[a] = dict[a];
    else if (cache[a]) out[a] = cache[a];
    else 물을.push(a);
  });
  if (!물을.length) return out;

  var key = typeof _pep_getKakaoApiKey_ === "function" ? _pep_getKakaoApiKey_() : "";
  if (!key) return out;
  var 못 = [];
  for (var i = 0; i < 물을.length; i += _ISJ_KAKAO_BATCH_) {
    var part = 물을.slice(i, i + _ISJ_KAKAO_BATCH_);
    var res;
    try {
      res = UrlFetchApp.fetchAll(part.map(function (q) {
        return {
          url: "https://dapi.kakao.com/v2/local/search/address.json?query=" + encodeURIComponent(q),
          headers: { Authorization: "KakaoAK " + key }, muteHttpExceptions: true
        };
      }));
    } catch (e) {
      Logger.log("[도서산간 판정] 카카오 묶음 실패: " + e.message);
      return out;
    }
    for (var j = 0; j < part.length; j++) {
      var zip = "";
      try {
        if (res[j].getResponseCode() === 200) {
          var doc = (JSON.parse(res[j].getContentText()).documents || [])[0];
          if (doc) zip = (doc.road_address && doc.road_address.zone_no) || (doc.address && doc.address.zip_code) || "";
        }
      } catch (e2) {}
      if (zip) {
        out[part[j]] = zip;
        cache[part[j]] = zip;
        if (typeof _PEP_ZIP_CACHE_DIRTY_ !== "undefined") _PEP_ZIP_CACHE_DIRTY_ = true;
      } else {
        못.push(part[j]);
      }
    }
    if (i + _ISJ_KAKAO_BATCH_ < 물을.length) Utilities.sleep(80);
  }
  //  첫판에 못 맞힌 것 — 정규화·키워드검색으로 하나씩 (느리니 몇 개만)
  for (var k = 0; k < 못.length && k < _ISJ_SLOW_RETRY_MAX_; k++) {
    var z2 = typeof _pep_getZipCodeCached_ === "function" ? _pep_getZipCodeCached_(못[k]) : "";
    if (z2) out[못[k]] = z2;
  }
  try { if (typeof _pep_zipCacheSave_ === "function") _pep_zipCacheSave_(); } catch (e3) {}
  return out;
}

/* ── 허브에 적용 ───────────────────────────────────────────── */

/** 메뉴: 🏝️ 도서산간 주소 판정 (판매현황 전) */
function partnerJudgeIslandByAddress() {
  var r = _island_judgeHubByAddress_();
  var ui = SpreadsheetApp.getUi();
  ui.alert("🏝️ 도서산간 주소 판정", r.글, ui.ButtonSet.OK);
}

/**
 * 발주 수집 안에서 부른다(판매현황 갱신 앞). 곁다리 — 실패해도 수집은 간다.
 * @return {{섬:number, 일반:number, 미확인:number, 본:number, 글:string}}
 */
function _island_judgeHubByAddress_() {
  var 결과 = { 섬: 0, 일반: 0, 미확인: 0, 본: 0, 업체: 0, 글: "" };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { 결과.글 = "다른 작업 중이라 건너뜀"; return 결과; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hubTab = ss.getSheetByName(_PO_HUB_SHEET_NAME);
    if (!hubTab || hubTab.getLastRow() < 2) { 결과.글 = "허브가 비었습니다"; return 결과; }

    var feeCol = _island_ensureHubFeeCol_(hubTab);
    var lc = hubTab.getLastColumn();
    var hdr = hubTab.getRange(1, 1, 1, lc).getDisplayValues()[0];
    var judgeCol = _isj_judgeCol_(hubTab, hdr);

    /*  ★ 옛 조건부 서식을 걷는다 ★  (2026-10-06)
        칠하기를 «직접»으로 옮겼다. 옛 규칙이 남아 있으면 직접 칠한 것을
        덮어, 고쳐도 금액 칸만 보라색으로 보인다. 한 값에 주인은 하나다. */
    _island_dropOurConditionalRule_(hubTab, feeCol);
    var lr = _isj_lastRow_(hubTab);
    if (lr < 2) { 결과.글 = "허브에 주문이 없습니다"; return 결과; }
    var n = lr - 1;
    var data = hubTab.getRange(2, 1, n, Math.max(16, lc)).getValues();
    var feeVals = hubTab.getRange(2, feeCol, n, 1).getValues();
    var judgeVals = hubTab.getRange(2, judgeCol, n, 1).getValues();

    var c = _isj_hubCols_(hdr);
    var 볼 = [];
    for (var r = 0; r < n; r++) {
      if (_isj_text_(judgeVals[r][0])) continue;                              // 이미 봄
      var p = _isj_text_(data[r][15]);
      if (p) continue;                                                         // 판매현황에 이미 올라감 → 원장이 받친다
      var st = String(data[r][c.status] || "").replace(/\s/g, "");
      if (st.indexOf("취소") !== -1 || st.indexOf("반품") !== -1 || st.indexOf("불용") !== -1) continue;
      var addr = _isj_normAddr_(data[r][c.addr]);
      if (!addr || !_isj_text_(data[r][c.uid])) continue;
      if ((Number(feeVals[r][0]) || 0) > 0) { judgeVals[r][0] = "금액 있음"; continue; }
      볼.push({ r: r, addr: addr });
    }
    //  한 번에 너무 많이 묻지 않는다 — 새것(아래쪽)부터. 남은 줄은 판정 칸이 비어 있어 다음에 본다
    var 남김 = 0;
    if (볼.length > _ISJ_MAX_ROWS_) { 남김 = 볼.length - _ISJ_MAX_ROWS_; 볼 = 볼.slice(볼.length - _ISJ_MAX_ROWS_); }
    결과.본 = 볼.length;
    결과.남김 = 남김;
    if (!볼.length) {
      //  「금액 있음」만 적힌 경우도 있다 — 그건 남긴다
      hubTab.getRange(2, judgeCol, n, 1).setValues(judgeVals);
      결과.글 = "새로 볼 주문이 없습니다";
      return 결과;
    }

    var M = _isj_loadMasters_();
    //  도선료표로 끝나는 주소는 우편번호를 안 묻는다 (세트분리와 같은 순서)
    var 물을 = {}, 목록 = [];
    볼.forEach(function (x) {
      if (!_isj_ferryMatch_(x.addr, M.ferry) && !물을[x.addr]) { 물을[x.addr] = 1; 목록.push(x.addr); }
    });
    var zips = _isj_zipsFor_(목록, M.dict);

    var 섬uid = {}, feeByUid = {}, 업체 = {}, 칠할 = [], 미확인줄 = [];
    볼.forEach(function (x) {
      var zip = zips[x.addr] || "";
      var j = _isj_judge_(x.addr, zip, M);
      judgeVals[x.r][0] = _isj_label_(j, zip);
      if (j.섬) {
        var row = data[x.r];
        var fee = _island_lineFee_(row[c.item]);
        feeVals[x.r][0] = fee;
        칠할.push(_island_colToLetter_(feeCol) + (x.r + 2));
        var uid = _island_uidKey_(row[c.uid]);
        섬uid[uid] = { 권역: j.권역, 경로: "주소판정" };
        feeByUid[uid] = fee;
        var vn = _isj_text_(row[1]);
        if (vn) 업체[vn] = true;
        결과.섬++;
      } else if (j.미확인) {
        결과.미확인++;
        미확인줄.push((x.r + 2) + "행 " + _isj_text_(data[x.r][1]) + " · " + x.addr.slice(0, 30));
      } else {
        결과.일반++;
      }
    });

    hubTab.getRange(2, judgeCol, n, 1).setValues(judgeVals);
    if (칠할.length) {
      hubTab.getRange(2, feeCol, n, 1).setValues(feeVals);
      hubTab.getRangeList(칠할).setNumberFormat("#,##0").setFontColor(_ISLAND_FONT_COLOR)
        .setFontWeight("bold");
    }
    /*  ★ 금액이 있는 줄은 «다 다시» 칠한다 ★  (2026-10-06)
        새로 붙은 줄만 칠하면 전에 붙은 줄이 영영 안 바뀐다 — 그래서
        허브와 업체 시트가 갈렸다. 새로 칠할 게 없는 날에도 돈다.      */
    결과.칠함 = _island_paintIslandRows_(hubTab, feeCol, feeVals);
    SpreadsheetApp.flush();

    /*  ★ 금액이 «이미» 붙어 있는 업체도 한 번 들른다 ★  (2026-10-06)

        > "발주허브는 되는데 업체 발주 시트에는 안되"

        업체 시트는 「그 시트에 금액을 새로 쓸 때」만 열렸다. 그런데 금액이
        이미 적힌 줄은 위에서 「금액 있음」으로 걸러져 업체 목록에 안 들어간다.
        그래서 좁은 범위로 한 번 걸린 업체 시트는 영영 안 넓어졌다 —
        허브만 고쳐졌고 업체 시트가 남은 까닭이 이것이다.

        들러도 금액은 안 바뀐다(이미 있는 줄은 건너뛴다). 줄 전체 칠하기
        규칙만 지금 모양으로 갈아 끼운다.                                 */
    for (var fr = 0; fr < n; fr++) {
      if (!((Number(feeVals[fr][0]) || 0) > 0)) continue;
      var vn2 = _isj_text_(data[fr][1]);
      if (vn2) 업체[vn2] = true;
    }

    var 업체들 = Object.keys(업체);
    if (업체들.length) {
      var pr = _island_applyToPartnerSheets_(섬uid, 업체들, feeByUid);
      결과.업체 = pr.applied;
    }

    결과.글 = "판매현황 전 주문 " + 결과.본 + "줄을 세트분리(뉴) 도서산간 자료로 봤습니다\n" +
      "  섬·산간 " + 결과.섬 + "줄 (허브·업체 시트에 금액, 보라색)\n" +
      "  일반 " + 결과.일반 + "줄\n" +
      "  미확인 " + 결과.미확인 + "줄 (우편번호를 못 구했고 지역명이 후보뿐 — 금액 안 붙임)" +
      (남김 ? "\n  이번에 못 본 옛 줄 " + 남김 + "개 — 다음 실행에서 봅니다" : "") +
      (미확인줄.length ? "\n    " + 미확인줄.slice(0, 10).join("\n    ") : "");
    if (결과.미확인 && typeof _chat_sendText_ === "function") {
      try { _chat_sendText_("🏝️ 도서산간 미확인 " + 결과.미확인 + "줄 — 허브 「도서산간판정」 칸을 확인해 주세요\n" + 미확인줄.slice(0, 10).join("\n")); } catch (eC) {}
    }
    Logger.log("[도서산간 판정] " + 결과.글);
    return 결과;
  } catch (e) {
    결과.글 = "오류: " + e.message;
    Logger.log("[도서산간 판정] " + 결과.글);
    return 결과;
  } finally {
    lock.releaseLock();
  }
}

/** 허브 열 — 머리글로 찾고 못 찾으면 늘 쓰던 자리 */
function _isj_hubCols_(hdr) {
  var c = { uid: 2, item: 5, addr: 9, status: 14 };
  var u = _island_findUidCol0_(hdr); if (u >= 0) c.uid = u;
  var it = _island_findItemCol0_(hdr); if (it >= 0) c.item = it;
  var st = _island_findStatusCol0_(hdr); if (st >= 0) c.status = st;
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || "").replace(/\s/g, "");
    if (h.indexOf("주소") !== -1 && h.indexOf("송하인") === -1 && h.indexOf("보내는") === -1) { c.addr = i; break; }
  }
  return c;
}

/** 허브 「도서산간판정」 칸 — 없으면 맨 뒤에 만든다 */
function _isj_judgeCol_(hubTab, hdr) {
  for (var i = 0; i < hdr.length; i++) if (String(hdr[i] || "").replace(/\s/g, "") === _ISJ_JUDGE_HEADER_) return i + 1;
  var col = hubTab.getLastColumn() + 1;
  if (hubTab.getMaxColumns() < col) hubTab.insertColumnsAfter(hubTab.getMaxColumns(), col - hubTab.getMaxColumns());
  hubTab.getRange(1, col).setValue(_ISJ_JUDGE_HEADER_)
    .setBackground(_ISLAND_HEADER_BG).setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
  hubTab.setColumnWidth(col, 220);
  return col;
}

/* ══════════════════════════════════════════════════════════════
   수집이 시간을 다 써서 «건너뛴» 도서산간을 뒤이어 한다
   2026-10-06

   > "상품정보시트 발주 수집시 자동으로 도서산간이 안먹은거 같은데"

   ★ 실제로 안 먹었다 ★
     2026-10-06 09:30 회차가 09:35:58 에 끝났다 — 약 6분, GAS 한도에
     거의 닿았다. 수집은 「이미 4분을 썼으면 도서산간을 건너뛴다」로
     되어 있다(뒤의 판매현황 갱신을 지키려고). 그래서 101줄이 판정 없이
     남았고, 「도서산간판정」 칸도 아예 안 생겼다 — 그 칸은 판정이 돌 때
     만들어지기 때문이다.

   ★ 받침이 없었다 ★
     자동 판매현황 갱신(silent)은 「바로 앞에서 이미 했다」고 보고 판정을
     안 한다. 그러니 수집이 늘 4분을 넘기는 동안은 «자동으로는 영영»
     안 붙는다. 사람이 메뉴를 눌러야만 붙었다 — 그걸 아무도 모른다.

   ★ 그래서 이어달린다 ★
     건너뛴 그 자리에서 일회성 트리거를 걸어, 판정만 제 6분을 가지고 돈다.
     이 저장소가 이미 쓰는 방식이고(_PEP_RESUME_KINDS_), 자리 압박까지
     그쪽이 다룬다 — 같은 체계에 등록해 쓴다.

   ★ 깃발을 쓰는 까닭 ★
     그 체계는 「커서가 없으면 다 쓴 트리거」로 보고 치운다. 깃발이 없으면
     내 «살아 있는» 이어달리기가 남의 자리 확보에 치워질 수 있다.
     걸 때 세우고, 돌면 지운다.
   ══════════════════════════════════════════════════════════════ */

var _ISJ_CATCHUP_FN_   = "partnerIslandCatchUp_";
var _ISJ_CATCHUP_FLAG_ = "_ISJ_CATCHUP_PENDING";

/** 내가 건 일회성 트리거만 지운다 — 남의 것은 안 건드린다 */
function _isj_dropCatchUpTriggers_() {
  var k = 0;
  try {
    var all = ScriptApp.getProjectTriggers();
    for (var i = 0; i < all.length; i++) {
      if (all[i].getHandlerFunction() === _ISJ_CATCHUP_FN_) { ScriptApp.deleteTrigger(all[i]); k++; }
    }
  } catch (e) { Logger.log("[ISLAND] 이어달리기 정리 실패: " + e.message); }
  return k;
}

/**
 * 조금 뒤에 판정만 다시 한다.
 *
 * @param {number=} delayMs 기본 90초 — 수집이 끝나고 잠금이 풀릴 만큼
 * @return {{ok:boolean, why:string}}
 */
function _isj_scheduleCatchUp_(delayMs) {
  var out = { ok: false, why: "" };
  var props = null;
  try { props = PropertiesService.getScriptProperties(); } catch (e) {}
  //  ★ 깃발을 «먼저» 세운다 ★ 걸고 나서 세우면 그 사이에 남이 치울 수 있다
  if (props) { try { props.setProperty(_ISJ_CATCHUP_FLAG_, String(new Date().getTime())); } catch (e) {} }
  _isj_dropCatchUpTriggers_();

  function 걸기() {
    ScriptApp.newTrigger(_ISJ_CATCHUP_FN_).timeBased().after(delayMs || 90 * 1000).create();
  }
  try { 걸기(); out.ok = true; return out; }
  catch (e1) { out.why = String(e1 && e1.message ? e1.message : e1); }

  //  자리가 없을 때가 대부분이다 — 다 쓴 일회성 트리거를 치우고 한 번 더
  var 치움 = 0;
  try { if (typeof _pep_sweepDeadResumeTriggers_ === "function") 치움 = _pep_sweepDeadResumeTriggers_(); } catch (e) {}
  if (치움 > 0) {
    try { 걸기(); out.ok = true; out.why = ""; return out; }
    catch (e2) { out.why = String(e2 && e2.message ? e2.message : e2); }
  }

  /*  ★ 못 걸었으면 «말한다» ★ 조용히 넘어가면 오늘 일이 그대로 되풀이된다.
      깃발을 지워 둔다 — 안 지우면 남의 자리 확보가 내 것을 「살아 있다」고
      보고 못 치운다.                                                    */
  if (props) { try { props.deleteProperty(_ISJ_CATCHUP_FLAG_); } catch (e) {} }
  Logger.log("[ISLAND] 이어달리기를 못 걸었습니다 (치운 것 " + 치움 + "개): " + out.why +
    " — 메뉴 「🏝️ 도서산간 주소 판정 (판매현황 전)」을 손으로 눌러 주세요");
  try {
    if (typeof _chat_sendText_ === "function") {
      _chat_sendText_("🏝️ 도서산간 판정을 이번 회차에 못 했고 이어달리기도 못 걸었습니다.\n" +
        "메뉴 「🏝️ 도서산간 주소 판정 (판매현황 전)」을 눌러 주세요.");
    }
  } catch (e) {}
  return out;
}

/** 일회성 트리거가 부르는 것 — 판정과 원장 받침을 제 6분으로 돈다 */
function partnerIslandCatchUp_() {
  //  깃발을 먼저 지운다 — 여기서 터져도 트리거가 「살아 있는 것」으로 남지 않게
  try { PropertiesService.getScriptProperties().deleteProperty(_ISJ_CATCHUP_FLAG_); } catch (e) {}
  _isj_dropCatchUpTriggers_();

  var 글 = [];
  try {
    var r = _island_judgeHubByAddress_();
    글.push("판정 — 본 " + (r && r.본 != null ? r.본 : "?") +
      " · 섬 " + (r && r.섬 != null ? r.섬 : "?") +
      " · 일반 " + (r && r.일반 != null ? r.일반 : "?") +
      " · 미확인 " + (r && r.미확인 != null ? r.미확인 : "?") +
      (r && r.글 ? " (" + r.글 + ")" : ""));
  } catch (e) { 글.push("판정 실패: " + (e.message || e)); }

  try {
    if (typeof _trigger_islandShipping_ === "function") { _trigger_islandShipping_(); 글.push("원장 받침 돌렸습니다"); }
  } catch (e) { 글.push("원장 받침 실패: " + (e.message || e)); }

  var 말 = "[ISLAND_CATCHUP] " + 글.join(" · ");
  Logger.log(말);
  return 말;
}
