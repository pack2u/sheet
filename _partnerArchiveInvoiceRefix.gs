/**
 * 과거 일일마감 송장 재매칭 — 품목키 적용 소급 보정
 *
 * 배경
 *   송장맵은 「이름+전화앞7」처럼 사람만 가리키는 키에 송장을 누적한다.
 *   한 사람이 여러 건을 주문하면 그 키에 송장이 여러 개 쌓이고, 그 사람의
 *   모든 행이 같은 목록을 통째로 받아 마감에 기록됐다.
 *   2026-08-26 품목키(NPI·NAI·NI)를 넣어 앞으로는 행마다 자기 송장만 붙지만,
 *   이미 기록된 과거 마감은 그대로 남아 있다. 이 도구가 그걸 되돌린다.
 *
 * 안전장치
 *   · 미리보기(Dry-run)와 반영을 분리한다. 반영 전 반드시 미리보기를 본다.
 *   · 이미 송장 1개가 박힌 행을 다른 송장으로 바꾸지 않는다(검토필요로만 보고).
 *   · 파일에서 송장이 사라지면(고아 송장) 반영을 건너뛰고 보고한다.
 *   · 원래 값을 리포트 탭에 남긴다 — 수동 되돌리기 근거.
 */

var _PAR_TAB_NAME_ = "일일마감_송장재매칭";
var _PAR_DEFAULT_DAYS_ = 14;
var _PAR_TIME_BUDGET_MS_ = 4.5 * 60 * 1000;

var _PAR_HEADERS_ = [
  "점검일시",   // A
  "판정",       // B: 분리 / 신규 / 동일 / 수량초과 / 검토필요 / 확정불가 / 고아보류
  "마감일",     // C
  "행",         // D
  "주문번호",   // E
  "수취인",     // F
  "전화",       // G
  "품목명",     // H
  "수량",       // I
  "기존송장",   // J
  "새송장",     // K
  "맞은키",     // L
  "송장출처",   // M
  "설명",       // N
];

// ═══════════════════════════════════════════
//  판정
// ═══════════════════════════════════════════

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
 * 둘 다 허용 개수는 {N, 2N}이지만 '기대값(expect)'이 다르다.
 * 송장을 줄이는 판정은 기대값을 밑돌면 자동 반영하지 않는다.
 */
function _par_slotSpec_(qty, item) {
  var n = _par_qtyNum_(qty);
  var set = _par_isSetItem_(item);
  return { qty: n, min: n, max: n * 2, expect: set ? n * 2 : n, set: set };
}

/**
 * 행 하나의 처리 방향을 정한다.
 *
 * 운영 규칙 세 가지가 판정의 기준이다.
 *   ① 같은 품목을 수량 N개 주문 → 송장이 N개, 박스가 쪼개지면 2N개까지 정상
 *   ② 품목명에 '세트' → 뚜껑·몸통이 따로 나가 2N개가 정상
 *   ③ 같은 주문자가 서로 다른 품목 주문 → 품목마다 각자 송장
 *
 * 그래서 송장이 여러 개인 것 자체는 이상이 아니다. ①②에 해당하면 그대로 둔다.
 * 고쳐야 하는 건 ③을 어긴 경우 — 같은 송장 묶음이 여러 행에 똑같이 붙은 것.
 * 그 판단은 파일 전체를 봐야 하므로 dupShared 로 받는다.
 *
 * @param {string} cur  기존 송장 셀 값
 * @param {Object} hit  새로 조회한 송장 정보
 * @param {string} via  맞은 키 종류
 * @param {*} qty       수량
 * @param {boolean} dupShared 같은 송장이 다른 행과 겹치는지 (파일 전체 기준)
 * @param {string=} item 품목명 — '세트' 판별에 쓴다
 * @return {{verdict:string, apply:boolean, inv:string, src:string, via:string, why:string}}
 */
function _par_decideRow_(cur, hit, via, qty, dupShared, item) {
  var curList = _pep_splitInvNos_(cur);
  var newInv = (hit && hit.inv) ? hit.inv : "";
  var newList = _pep_splitInvNos_(newInv);
  var ok = _par_slotSpec_(qty, item);
  var qtyN = ok.qty;
  var setNote = ok.set ? "세트(구성품 " + ok.expect + "장 정상)" : "수량 " + qtyN;
  var out = {
    verdict: "", apply: false, inv: newInv,
    src: (hit && hit.source) || "", via: via || "", why: "",
  };

  /** 수량 규칙에 맞는 송장 개수인가 */
  function fitsQty(n) { return n === ok.min || n === ok.max; }
  /** 송장을 이 개수로 줄여도 되는가 — 기대값을 밑돌면 구성품을 잃는다 */
  function safeToNarrow(n) { return n >= ok.expect; }
  /**
   * 이 주문이 만들 수 있는 최대 장수를 넘었는가.
   * '송장 = 수량'은 성립하지 않는다 — 여러 개를 한 박스로 보내면 1장이다.
   * 그래서 모자란 건 판정할 수 없고, 넘치는 것만 확실한 이상 신호다.
   */
  function tooMany(n) { return n > ok.max; }
  /** 새 결과가 기존 송장 안에서 골라낸 것인가 */
  function subsetOfCur() {
    for (var i = 0; i < newList.length; i++) {
      if (curList.indexOf(newList[i]) < 0) return false;
    }
    return true;
  }

  // 새 송장 정보가 없으면 기존 값을 그대로 둔다.
  if (!newList.length) {
    if (!curList.length) {
      out.verdict = "미매칭";
      out.why = "송장이 아예 없음 — 아직 출고 전이거나 송장 미수집";
      return out;
    }
    if (tooMany(curList.length)) {
      out.verdict = "수량초과";
      out.why = "송장맵에서 못 찾음 + " + setNote + "인데 송장 " + curList.length +
        "장 (최대 " + ok.max + "장) — 남의 송장이 섞였을 수 있어 확인 필요";
      return out;
    }
    out.verdict = "동일";
    out.why = "송장맵에서 못 찾음 — 기존 송장번호 유지";
    return out;
  }

  // 같은 송장 묶음이면 바꿀 게 없다. 다만 개수 자체가 과한 건 여기서 잡아야 한다.
  // 조회 결과가 기존과 같으면 아래 분기들을 타지 않으므로, 수집 단계에서
  // 잘못 붙은 송장은 이 검사가 없으면 영원히 드러나지 않는다.
  if (curList.length === newList.length && subsetOfCur()) {
    if (tooMany(curList.length)) {
      out.verdict = "수량초과";
      out.why = setNote + "인데 송장 " + curList.length + "장 (최대 " + ok.max +
        "장) — 기존·조회가 같아 자동으로는 못 가름, 수집 단계부터 어긋난 것으로 보임";
      return out;
    }
    out.verdict = "동일";
    out.why = curList.length > 1
      ? "송장 " + curList.length + "장이 기존과 같음 (" + setNote + ")"
      : "기존과 같음";
    return out;
  }

  if (curList.length === 0) {
    if (newList.length === 1 || fitsQty(newList.length)) {
      // 비어 있던 행이므로 기대값보다 적어도 채우는 게 이득이다. 다만 모자란 건 적어둔다.
      out.verdict = "신규";
      out.apply = true;
      out.why = "비어 있던 송장을 채움 (" + setNote + ", 송장 " + newList.length + "개)" +
        (newList.length < ok.expect ? " — 기대 " + ok.expect + "장보다 적음, 원천 확인 권장" : "");
    } else {
      out.verdict = "확정불가";
      out.why = setNote + "에 안 맞는 송장 " + newList.length + "개 — 자동 반영 제외";
    }
    return out;
  }

  if (curList.length === 1) {
    // 이미 하나로 박힌 송장을 다른 값으로 덮지 않는다. 오배정 위험이 크다.
    out.verdict = "검토필요";
    out.why = "기존 송장 1개와 새 결과가 다름 — 자동 반영 제외, 눈으로 확인 필요";
    return out;
  }

  // ── 기존이 여러 개 ──
  // ①②에 맞고 다른 행과 겹치지도 않으면 정상 분할이다. 줄이면 송장을 잃는다.
  if (!dupShared && fitsQty(curList.length)) {
    out.verdict = "동일";
    out.why = setNote + "에 맞는 송장 " + curList.length + "개 — 정상 분할이라 그대로 둠";
    return out;
  }

  if (!subsetOfCur()) {
    out.verdict = "검토필요";
    out.why = "기존 " + curList.length + "개에 없는 송장이 나옴 — 자동 반영 제외";
    return out;
  }

  if (newList.length === 1) {
    if (!safeToNarrow(1)) {
      out.verdict = "검토필요";
      out.why = ok.set
        ? "세트인데 송장이 1개로 좁혀짐 — 뚜껑·몸통 중 하나를 잃을 수 있어 확인 필요"
        : "수량 " + qtyN + "인데 송장이 1개로 좁혀짐 — 송장이 모자랄 수 있어 확인 필요";
      return out;
    }
    out.verdict = "분리";
    out.apply = true;
    out.why = "여러 행에 함께 붙어 있던 송장을 품목명으로 이 행 것만 남김";
    return out;
  }

  if (fitsQty(newList.length) && safeToNarrow(newList.length)) {
    out.verdict = "분리";
    out.apply = true;
    out.why = "품목명으로 " + setNote + "에 맞는 송장 " + newList.length + "개만 남김";
    return out;
  }

  // 세트인데 기대값(2N)을 밑도는 결과는 줄이지 않는다.
  if (ok.set && !safeToNarrow(newList.length)) {
    out.verdict = "검토필요";
    out.why = "세트 기대 " + ok.expect + "장인데 품목키 결과가 " + newList.length +
      "장 — 구성품이 빠질 수 있어 자동 반영 제외";
    return out;
  }

  out.verdict = "확정불가";
  out.why = "품목키로도 " + newList.length + "개 (" + setNote +
    ") — 같은 품목 재주문이거나 품목명이 원천과 다름";
  return out;
}

// ═══════════════════════════════════════════
//  마감 파일 읽기
// ═══════════════════════════════════════════

/**
 * 마감 파일 한 개를 읽어 행 정보를 뽑는다. 판정은 하지 않는다.
 * @return {?Object} { dateStr, tab, all, cols, lc, metas }
 */
function _par_readDay_(dateStr, res) {
  var fileName = _UNIFIED_ARCHIVE_PREFIX_ + "(" + dateStr + ")";
  var archSs = _unified_findExistingArchiveSs_(fileName);
  if (!archSs) return null;
  var archTab = archSs.getSheetByName("일일마감") || archSs.getSheets()[0];
  if (!archTab || archTab.getLastRow() < 2) return null;
  res.files++;

  var lr = archTab.getLastRow();
  var lc = Math.max(archTab.getLastColumn(), 1);
  var all = archTab.getRange(1, 1, lr, lc).getDisplayValues();
  var cols = _pep_mapArchiveMatchCols_(all[0]);
  if (cols.item < 0) res.noItemCol.push(dateStr);

  var metas = [];
  for (var ri = 1; ri < all.length; ri++) {
    if (String(all[ri][0] || "").indexOf("합계") !== -1) continue;
    res.scanned++;
    var cur = String(all[ri][cols.inv] || "").trim();
    var nm = cols.name >= 0 ? _pep_normRecipName_(all[ri][cols.name]) : "";
    var ph = cols.phone >= 0 ? all[ri][cols.phone] : "";
    metas.push({
      ri: ri,
      dateStr: dateStr,
      cur: cur,
      invs: _pep_splitInvNos_(cur),
      name: nm,
      phone: ph,
      addr: cols.addr >= 0 ? all[ri][cols.addr] : "",
      item: cols.item >= 0 ? all[ri][cols.item] : "",
      qty: cols.qty >= 0 ? all[ri][cols.qty] : "",
      itemKey: _pep_itemKey_(cols.item >= 0 ? all[ri][cols.item] : ""),
      person: nm + "|" + _pep_phone7_(ph),
      key: _pep_deriveMatchKeyFromArchiveRow_(all[ri], cols),
    });
  }
  return { dateStr: dateStr, tab: archTab, all: all, cols: cols, lc: lc, metas: metas };
}

/**
 * 같은 송장이 여러 행에 걸쳐 있는지 표시한다.
 *
 * ★ 기간 전체를 한꺼번에 본다. 한 사람이 날짜를 달리해 두 번 주문하면 마감 파일이
 *   갈라지고, 파일 하나만 보면 각 행이 홀로 있어 보여 중복을 놓친다.
 *
 * 운영 규칙상 서로 다른 품목은 각자 송장을 갖는다. 그래서 아래 둘은 중복 신호다.
 *   · 같은 송장 묶음이 두 행 이상에 똑같이 붙어 있다
 *   · 한 송장이 품목·주문자가 다른 행에도 붙어 있다
 * 반대로 한 행이 송장을 여럿 들고 있고 다른 행과 안 겹치면 수량 분할이라 정상이다.
 */
function _par_markDupes_(days) {
  var invOwners = {}, sigCount = {}, flagged = 0;
  var i, j, k;
  for (i = 0; i < days.length; i++) {
    var ms = days[i].metas;
    for (j = 0; j < ms.length; j++) {
      var mt = ms[j];
      if (!mt.invs.length) continue;
      for (k = 0; k < mt.invs.length; k++) {
        if (!invOwners[mt.invs[k]]) invOwners[mt.invs[k]] = [];
        invOwners[mt.invs[k]].push(mt);
      }
      if (mt.invs.length > 1) {
        var sig = mt.invs.slice().sort().join("|");
        sigCount[sig] = (sigCount[sig] || 0) + 1;
      }
    }
  }
  for (i = 0; i < days.length; i++) {
    var ms2 = days[i].metas;
    for (j = 0; j < ms2.length; j++) {
      var mm = ms2[j];
      mm.dupShared = false;
      if (mm.invs.length > 1) {
        var sg = mm.invs.slice().sort().join("|");
        if (sigCount[sg] > 1) mm.dupShared = true;
      }
      if (!mm.dupShared) {
        for (k = 0; k < mm.invs.length; k++) {
          var owners = invOwners[mm.invs[k]] || [];
          for (var o = 0; o < owners.length; o++) {
            if (owners[o] === mm) continue;
            if (owners[o].itemKey !== mm.itemKey || owners[o].person !== mm.person) {
              mm.dupShared = true;
              break;
            }
          }
          if (mm.dupShared) break;
        }
      }
      if (mm.dupShared) flagged++;
    }
  }
  return flagged;
}

// ═══════════════════════════════════════════
//  마감 파일 한 개 판정·반영
// ═══════════════════════════════════════════

function _par_applyDay_(day, invoiceMap, dryRun, rows, res) {
  var dateStr = day.dateStr, all = day.all, cols = day.cols;

  // 반영 후에도 파일 안에 남아 있어야 하는 송장을 센다.
  //   before[송장] = 지금 이 파일이 들고 있는 행 수
  //   after[송장]  = 반영하면 남는 행 수
  var before = {}, after = {};
  function bump(bag, inv) {
    var list = _pep_splitInvNos_(inv);
    for (var i = 0; i < list.length; i++) bag[list[i]] = (bag[list[i]] || 0) + 1;
  }

  var plan = [];
  for (var mi = 0; mi < day.metas.length; mi++) {
    var r = day.metas[mi];
    bump(before, r.cur);

    // ★ 2026-08-27: 고유ID 가 있으면 고유ID 로만 찾는다.
    //   종전에는 UID 로 못 찾으면 이름·전화 사다리로 내려갔다. 송장맵에는 날짜가
    //   없으므로 그 사다리는 같은 고객의 과거 출고분을 후보로 들고 있고,
    //   `신규` 판정이 비어 있던 행에 그것을 채웠다. 이것이 "이전 주문건 송장을
    //   가져다 붙임"의 경로다. UID 가 있는 행은 못 찾으면 미매칭으로 남긴다.
    //
    //   매칭키가 TEL: 로 시작하면 그건 고유ID 가 없어 전화로 만든 대체키다.
    //   그 행만 이름·전화·주소·품목 조합으로 내려간다.
    var via = {};
    var hit = _pep_resolveRowInvoice_(invoiceMap, {
      uid: r.key,
      name: r.name,
      phone: r.phone,
      addr: r.addr,
      item: r.item,
      orderDate: dateStr
    }, via);

    var d = _par_decideRow_(r.cur, hit, via.via, r.qty, r.dupShared, r.item);
    if (d.verdict === "동일") {
      bump(after, r.cur);
      res.byVerdict["동일"] = (res.byVerdict["동일"] || 0) + 1;
      continue;
    }

    if (d.apply) bump(after, d.inv); else bump(after, r.cur);
    plan.push({
      ri: r.ri, cur: r.cur, d: d, name: r.name, phone: r.phone,
      item: r.item, qty: r.qty, key: r.key,
    });
  }

  // 고아 송장 검사 — 반영으로 파일에서 송장이 아예 사라지면 그 행은 손대지 않는다.
  var orphan = {};
  for (var inv in before) {
    if (!before.hasOwnProperty(inv)) continue;
    if (!after[inv]) orphan[inv] = true;
  }

  var applied = 0;
  for (var p = 0; p < plan.length; p++) {
    var it = plan[p];
    var dd = it.d;
    var lost = [];
    if (dd.apply) {
      var dropped = _pep_splitInvNos_(it.cur);
      for (var dp = 0; dp < dropped.length; dp++) {
        if (orphan[dropped[dp]]) lost.push(dropped[dp]);
      }
    }
    if (lost.length) {
      dd.apply = false;
      dd.verdict = "고아보류";
      dd.why = "떼어낼 송장 " + lost.join(", ") + " 이 이 마감에서 사라짐 — 대상 행이 없어 보류";
    }

    res.byVerdict[dd.verdict] = (res.byVerdict[dd.verdict] || 0) + 1;

    // 송장이 아예 없고 찾을 데도 없는 행은 그냥 미매칭이다.
    // 1천 건 넘게 쌓여 리포트를 덮으므로 집계만 하고 상세는 남기지 않는다.
    if (dd.verdict !== "미매칭") {
      rows.push([
        res.now, dd.verdict, dateStr, it.ri + 1,
        it.key || "", it.name || "", String(it.phone || ""), String(it.item || ""),
        String(it.qty || ""),
        String(it.cur).replace(/\n/g, ", "),
        String(dd.inv).replace(/\n/g, ", "),
        dd.via, dd.src, dd.why,
      ]);
    }

    if (dd.apply) {
      if (!dryRun) {
        all[it.ri][cols.inv] = dd.inv;
        if (dd.src) all[it.ri][cols.src] = dd.src;
      }
      applied++;
    }
  }

  if (applied > 0) {
    if (!dryRun) {
      day.tab.getRange(1, 1, all.length, day.lc).setValues(all);
      SpreadsheetApp.flush();
    }
    res.applied += applied;
    res.days.push(dateStr + ":" + applied);
  }
}

// ═══════════════════════════════════════════
//  결과 탭
// ═══════════════════════════════════════════

function _par_writeTab_(rows, dryRun) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_PAR_TAB_NAME_);
  if (!tab) tab = ss.insertSheet(_PAR_TAB_NAME_);
  tab.clear();

  tab.getRange(1, 1, 1, _PAR_HEADERS_.length).setValues([_PAR_HEADERS_])
    .setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
  tab.setFrozenRows(1);

  if (rows.length) {
    tab.getRange(2, 1, rows.length, _PAR_HEADERS_.length).setValues(rows);
  }
  tab.getRange(1, 2).setNote(
    (dryRun ? "미리보기 결과 — 아직 반영되지 않았다.\n\n" : "반영 완료 — J열 기존송장이 되돌리기 근거다.\n\n") +
    "판정 기준\n" +
    "· 같은 품목 수량 N개 → 송장 N개(또는 2N개)까지 정상\n" +
    "· 같은 주문자 다른 품목 → 품목마다 각자 송장\n\n" +
    "분리: 여러 행에 똑같이 붙어 있던 송장을 품목명으로 갈라냄 (반영 대상)\n" +
    "신규: 비어 있던 송장을 채움 (반영 대상)\n" +
    "검토필요: 기존 송장과 다른 결과, 또는 수량보다 송장이 줄어드는 경우\n" +
    "확정불가: 품목키로도 수량에 맞게 좁혀지지 않음\n" +
    "고아보류: 떼어내면 그 송장이 마감에서 사라져 보류\n\n" +
    "동일·미매칭은 건수만 집계하고 이 탭에 남기지 않는다.\n" +
    "송장 겹침 판단은 기간 전체를 한꺼번에 본다 — 같은 사람이 날짜를\n" +
    "달리해 주문하면 마감 파일이 갈라져 파일 하나만으로는 못 잡는다."
  );
  tab.setColumnWidth(8, 200);
  tab.setColumnWidth(10, 150);
  tab.setColumnWidth(11, 150);
  tab.setColumnWidth(14, 460);
  return rows.length;
}

// ═══════════════════════════════════════════
//  본체
// ═══════════════════════════════════════════

function _par_run_(dryRun, days, targetDateStr) {
  days = days || _PAR_DEFAULT_DAYS_;
  var started = new Date().getTime();
  var res = {
    now: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
    files: 0, scanned: 0, applied: 0, days: [], byVerdict: {},
    noItemCol: [], stopped: "", keys: 0, dupFlagged: 0, from: "", to: "",
  };

  if (typeof _pep_keyStatReset_ === "function") _pep_keyStatReset_();
  // 전 업체 마감탭은 열지 않는다. 열면 송장맵만 4~6분이 걸려 28일 파일을 못 본다.
  var stat = { lotte: 0, weekly: 0, ledger: 0, temp: 0, hub: 0, snapshot: 0, keys: 0, errors: [], skipPartnerArchives: true };
  var invoiceMap = _puv_buildInvoiceMap_(stat);
  res.keys = stat.keys;

  var rows = [];
  var today = new Date();

  // ── 1단계: 기간 읽기 ──
  // 오늘 파일도 본다. 매출일이 실행일 파일에 들어간 28일 분이 여기 있을 수 있다.
  var loaded = [];
  function _par_loadOne_(dateStr) {
    res.from = dateStr;
    if (!res.to) res.to = dateStr;
    try {
      var day = _par_readDay_(dateStr, res);
      if (day) loaded.push(day);
    } catch (e) {
      rows.push([res.now, "오류", dateStr, "", "", "", "", "", "", "", "", "", "",
        "읽기 실패 — " + String(e.message || e)]);
    }
  }
  if (targetDateStr && /^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
    _par_loadOne_(targetDateStr);
  } else {
    for (var d = 0; d <= days; d++) {
      if (new Date().getTime() - started > _PAR_TIME_BUDGET_MS_) {
        res.stopped = "시간 예산 초과 — 읽기 " + d + "일차에서 중단. 기간을 줄여 다시 실행하세요.";
        break;
      }
      var dt = new Date(today.getTime());
      dt.setDate(dt.getDate() - d);
      _par_loadOne_(Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd"));
    }
  }

  // ── 2단계: 기간 전체에서 송장 중복 표시 ──
  res.dupFlagged = _par_markDupes_(loaded);

  // ── 3단계: 판정·반영 ──
  for (var li = 0; li < loaded.length; li++) {
    try {
      _par_applyDay_(loaded[li], invoiceMap, dryRun, rows, res);
    } catch (e2) {
      rows.push([res.now, "오류", loaded[li].dateStr, "", "", "", "", "", "", "", "", "", "",
        "판정 실패 — " + String(e2.message || e2)]);
    }
  }

  var written = _par_writeTab_(rows, dryRun);

  var vLines = [];
  var order = ["분리", "신규", "수량초과", "검토필요", "확정불가", "고아보류", "동일", "미매칭", "오류"];
  var label = {
    "분리": "분리 (여러 행에 겹친 송장을 갈라냄)",
    "신규": "신규 (비어 있던 송장 채움)",
    "수량초과": "수량초과 (수량·세트로 낼 수 있는 최대보다 많음 — 남의 송장 의심)",
    "검토필요": "검토필요 (기존과 다른 결과 · 세트 구성품 부족)",
    "확정불가": "확정불가 (수량에 맞게 안 좁혀짐)",
    "고아보류": "고아보류 (떼어낼 송장의 주인이 없음)",
    "동일": "동일 (정상 — 손대지 않음)",
    "미매칭": "미매칭 (송장 자체가 없음 — 출고 전 등)",
  };
  for (var oi = 0; oi < order.length; oi++) {
    var k = order[oi];
    if (res.byVerdict[k]) {
      vLines.push("  · " + (label[k] || k) + ": " + res.byVerdict[k] + "건");
    }
  }
  for (var vk in res.byVerdict) {
    if (res.byVerdict.hasOwnProperty(vk) && order.indexOf(vk) < 0) {
      vLines.push("  · " + vk + ": " + res.byVerdict[vk] + "건");
    }
  }

  var msg =
    (dryRun ? "🔍 일일마감 송장 재매칭 — 미리보기\n\n" : "✅ 일일마감 송장 재매칭 — 반영 완료\n\n") +
    "기간: " + (res.from || "?") + " ~ " + (res.to || "?") +
      (targetDateStr ? " (지정일)\n" : " (오늘 포함, 최근 " + days + "일)\n") +
    "마감파일 " + res.files + "개 / 스캔 " + res.scanned + "행\n" +
    "송장맵: 롯데 " + (stat.lotte || 0) + "행 · 1주출고 " + (stat.weekly || 0) +
      "행 · 키 " + res.keys + "개 / 송장 겹침 표시: " + (res.dupFlagged || 0) + "행\n" +
    "  (허브아카이브 " + (stat.hubArchive || 0) + "건 · 송장원장 " + (stat.ledger || 0) + "건)\n\n" +
    "── 판정 ──\n" + (vLines.length ? vLines.join("\n") : "  (변경 대상 없음)") + "\n\n" +
    (dryRun
      ? "▶ 반영 예정: " + res.applied + "건 (분리 + 신규)\n"
      : "▶ 반영: " + res.applied + "건" + (res.days.length ? " (" + res.days.join(", ") + ")" : "") + "\n") +
    (res.noItemCol.length
      ? "\n⚠ 품목명 열을 못 찾은 마감: " + res.noItemCol.slice(0, 5).join(", ") +
        (res.noItemCol.length > 5 ? " 외 " + (res.noItemCol.length - 5) + "일" : "") +
        "\n   → 이 날짜는 품목키를 쓸 수 없어 종전 판정만 적용된다.\n"
      : "") +
    (stat.errors.length ? "\n⚠ 송장맵: " + stat.errors.slice(0, 3).join(" / ") + "\n" : "") +
    (res.stopped ? "\n⏱ " + res.stopped + "\n" : "") +
    "\n상세 " + written + "행은 '" + _PAR_TAB_NAME_ +
    "' 탭을 확인하세요. (동일·미매칭은 집계만, 상세 제외)" +
    (dryRun ? "\n\n반영하려면 메뉴에서 '2) 재매칭 반영'을 실행하세요." : "");

  Logger.log(msg);
  return { msg: msg, res: res };
}

// ═══════════════════════════════════════════
//  메뉴 진입점
// ═══════════════════════════════════════════

/** 1) 미리보기 — 아무것도 바꾸지 않는다 */
function partnerPreviewArchiveInvoiceRefix() {
  var out = _par_run_(true, _PAR_DEFAULT_DAYS_);
  try { SpreadsheetApp.getUi().alert(out.msg); } catch (e) {}
  return out.msg;
}

/** 2) 반영 — 미리보기에서 '분리·신규'로 판정된 행만 고친다 */
function partnerApplyArchiveInvoiceRefix() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  if (ui) {
    var ok = ui.alert(
      "일일마감 송장 재매칭 반영",
      "최근 " + _PAR_DEFAULT_DAYS_ + "일 일일마감 파일의 송장을 고칩니다.\n\n" +
      "· 여러 행에 똑같이 붙은 송장 → 품목명으로 갈라냄\n" +
      "· 비어 있던 행 → 송장 채움\n" +
      "· 수량만큼(또는 2배) 나뉜 정상 분할은 그대로 둡니다\n" +
      "· 새 송장 정보가 없으면 기존 송장번호를 유지합니다\n" +
      "· 기존 송장과 다른 결과가 나온 행은 건드리지 않습니다\n\n" +
      "먼저 '1) 재매칭 미리보기'를 확인하셨습니까?",
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return "취소";
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    var busy = "다른 작업이 실행 중입니다. 잠시 후 다시 시도하세요.";
    if (ui) ui.alert(busy);
    return busy;
  }
  try {
    var out = _par_run_(false, _PAR_DEFAULT_DAYS_);
    if (ui) ui.alert(out.msg);
    return out.msg;
  } finally {
    lock.releaseLock();
  }
}
