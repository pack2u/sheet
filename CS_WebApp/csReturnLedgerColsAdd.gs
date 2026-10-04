/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장 — 빠진 열을 더한다  (달 탭마다, 여러 번 돌려도 탈 없다)
 *
 *  > "㉰로 가자" → "다해줘"
 *
 *  ★★ 2026-10-04 — 넷에서 «하나»로 줄였다 ★★
 *    처음에 교환반품구분 · 귀책 · 반품/환불비용 · 입고확인요청 넷을 더하게
 *    적었다. 돌리기 전에 시트를 세어 보니 셋은 «이미 다른 칸이 받고 있었다».
 *    그대로 더하면 한 값에 주인이 둘이 된다 — CS 는 한쪽에 적고 v2 는
 *    다른 쪽을 읽는다. 오류는 안 난다. 그냥 안 맞는다.
 *
 *      교환반품구분  → 10/01 협의안이 «일부러 없앤» 칸이다.
 *                      v2 가 DROPPED_IN_SPEC 으로 못 박아 두고, 값은 비고의
 *                      「구분: 교환」으로 받는다 (csOrderSearch.submitReturnLedger).
 *      귀책          → 협의안에서 「발생원인」 한 칸으로 합쳐졌다
 *                      (「판매자귀책 / 오배송」). v2 가 그 칸을 갈라 읽는다.
 *      반품/환불비용 → 이미 「반품비」가 있다 (202610 Y열).
 *                      이름만 다른 같은 돈이다.
 *
 *    남은 하나, 입고확인요청은 «정말 없다». v2 에 담을 자리(intake_req)도 있고
 *    머리글도 안다. 그래서 그것만 더한다.
 *
 *  ★ 어디에 끼우나 ★
 *    맨 뒤에 붙인다 — CS 가 물류에게 남기는 쪽지라 읽는 자리가 따로 있다
 *    (물류 입고 화면). 가운데 끼우면 남의 열을 가른다.
 *
 *  ★ 본(本) 탭에도 더한다 ★
 *    달 탭은 「202609의 테스트 시트」를 베껴 태어난다
 *    (csReturnMonthTab._cs_newReturnTabFromSpec_). 본에 칸이 없으면
 *    11월 탭이 또 이 칸 없이 태어나고, 같은 일을 다시 해야 한다.
 *
 *  ★ 끼우면 그 열에 걸린 «규칙»도 따라간다 ★
 *    2026-10-01 에 A 앞에 열을 끼웠더니 상태 드롭다운이 B 로 따라가 날짜
 *    쓰기를 막았다. 여기서는 더하는 자리가 드롭다운(A)보다 «뒤»라 A 는 안 밀린다.
 *    그래도 끝나고 한 번 확인해 준다.
 *
 *  ★ 이미 있으면 안 더한다 ★
 *    머리글을 보고 없는 것만 더한다. 여러 번 돌려도 같다.
 *
 *  돌리는 법
 *    csAddReturnLedgerColsAll         — 최근 3달 + 본(本) 탭  ★ 이것을 쓴다 ★
 *    csAddReturnLedgerCols            — 이번 달 탭만
 * ══════════════════════════════════════════════════════════════
 */

/*  더할 열 — 머리글, 어느 열 «뒤»에 끼울지, 못 찾으면 맨 뒤
    차례가 뜻이다: 사유(발생원인) 다음에 「무엇을·누구 탓·얼마」가 온다.  */
var _CS_RET_ADD_COLS_ = [
  { 이름: "입고확인요청", 뒤에: null, 설명: "CS → 물류. 박스 열 때 볼 것" },
];

/*  ★ 뺀 셋을 지우지 않고 적어 둔다 ★  (2026-10-04)
    「왜 안 더하나」가 코드에 없으면, 다음 사람이 빠진 줄 알고 다시 넣는다.
    그러면 한 값에 주인이 둘이 되고, 그 사고는 조용하다.             */
var _CS_RET_ADD_COLS_안더함_ = [
  { 이름: "교환반품구분", 왜: "10/01 협의안이 일부러 없앴다. 값은 비고의 「구분: 교환」으로 온다 (v2 DROPPED_IN_SPEC)" },
  { 이름: "귀책", 왜: "협의안에서 「발생원인」 한 칸으로 합쳐졌다 — 「판매자귀책 / 오배송」. v2 가 갈라 읽는다" },
  { 이름: "반품/환불비용", 왜: "이미 「반품비」가 있다 (202610 Y열). 이름만 다른 같은 돈이다" },
];

/** 머리글 한 줄에서 그 이름이 몇 번째인지 (0기준, 없으면 -1) */
function _cs_colIdxByName_(head, re) {
  for (var i = 0; i < head.length; i++) {
    var h = String(head[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (re instanceof RegExp ? re.test(h) : h === re) return i;
  }
  return -1;
}

/**
 * 달 탭 하나에 빠진 열을 더한다.
 * @return {{더함: string[], 이미: string[], 왜: string}}
 */
function _cs_addReturnColsTo_(tab) {
  var out = { 더함: [], 이미: [], 왜: "" };
  if (!tab) { out.왜 = "탭이 없습니다"; return out; }

  for (var n = 0; n < _CS_RET_ADD_COLS_.length; n++) {
    var 할것 = _CS_RET_ADD_COLS_[n];

    //  머리글은 «매번» 다시 읽는다 — 앞 차례에서 열이 밀렸을 수 있다
    var lastCol = Math.max(tab.getLastColumn(), 15);
    var scan = Math.max(Math.min(tab.getLastRow(), 40), 12);
    var values = tab.getRange(1, 1, scan, lastCol).getDisplayValues();
    var hi = _cs_findReturnHeaderRow_(values);
    if (hi < 0) { out.왜 = "머리글 줄(「반품접수날짜」)을 못 찾았습니다"; return out; }
    var head = values[hi];

    if (_cs_colIdxByName_(head, 할것.이름) >= 0) { out.이미.push(할것.이름); continue; }

    var 자리;
    if (할것.뒤에) {
      var 앞 = _cs_colIdxByName_(head, 할것.뒤에);
      //  기댄 열이 없으면 맨 뒤로 — 짐작해서 가운데 끼우면 남의 열을 가른다
      자리 = 앞 >= 0 ? 앞 + 1 : lastCol;
    } else {
      자리 = lastCol;
    }

    if (자리 >= lastCol) { tab.insertColumnAfter(lastCol); 자리 = lastCol; }
    else tab.insertColumnBefore(자리 + 1);

    tab.getRange(hi + 1, 자리 + 1).setValue(할것.이름);
    out.더함.push(할것.이름 + "(" + (자리 + 1) + "열)");
    SpreadsheetApp.flush();
  }
  return out;
}

/** 이번 달 탭에 빠진 열을 더한다 */
function csAddReturnLedgerCols() {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var k = _cs_returnLedgerMonthKey_();
  return _csAddColsLog_([k], ss);
}

/**
 * 최근 달 탭 전부 + «본(本) 탭». (기본 3달)
 *
 * ★ 본 탭을 같이 한다 ★ 달 탭은 본을 베껴 태어난다
 * (csReturnMonthTab._cs_newReturnTabFromSpec_). 본에 칸이 없으면 다음 달
 * 탭이 또 그 칸 없이 태어나고, 같은 일을 다시 해야 한다.
 * 본에는 머리글만 생긴다 — 자료는 베낄 때 지워진다.
 */
function csAddReturnLedgerColsAll(months) {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var n = months || 3;
  var 달 = [];
  for (var i = 0; i < n; i++) {
    var d = new Date();
    d.setMonth(d.getMonth() - i);
    달.push(_cs_returnLedgerMonthKey_(d));
  }
  //  본 탭 이름은 csReturnMonthTab.gs 한 곳에서만 정한다 — 두 곳에 적으면 갈라진다
  var 본 = typeof _CS_RETURN_SPEC_TAB_ === "string" ? _CS_RETURN_SPEC_TAB_ : "";
  if (본 && 달.indexOf(본) < 0) 달.push(본);
  return _csAddColsLog_(달, ss);
}

function _csAddColsLog_(달들, ss) {
  var 줄 = ["■ 반품관리대장 — 빠진 열 더하기", ""];
  for (var i = 0; i < 달들.length; i++) {
    var k = 달들[i];
    var tab = ss.getSheetByName(k);
    if (!tab) { 줄.push("· " + k + " — 탭이 없습니다"); continue; }
    var r = _cs_addReturnColsTo_(tab);
    if (r.왜) { 줄.push("★ " + k + " — " + r.왜); continue; }
    줄.push("· " + k +
      (r.더함.length ? "  ✅ 더함: " + r.더함.join(", ") : "") +
      (r.이미.length ? "  (이미 있음: " + r.이미.join(", ") + ")" : "") +
      (!r.더함.length && !r.이미.length ? "  변화 없음" : ""));
  }
  줄.push("");
  줄.push("더하는 열과 뜻 —");
  for (var j = 0; j < _CS_RET_ADD_COLS_.length; j++) {
    줄.push("  " + _CS_RET_ADD_COLS_[j].이름.padEnd(14) + _CS_RET_ADD_COLS_[j].설명);
  }
  /*  ★ 안 더하는 것도 말한다 ★ 조용히 빼면 「왜 셋이 안 생겼지」가 되고,
      다음 사람이 다시 넣어 한 값에 주인이 둘이 된다.                 */
  줄.push("");
  줄.push("일부러 «안» 더하는 열 —");
  for (var k2 = 0; k2 < _CS_RET_ADD_COLS_안더함_.length; k2++) {
    줄.push("  " + _CS_RET_ADD_COLS_안더함_[k2].이름.padEnd(14) + _CS_RET_ADD_COLS_안더함_[k2].왜);
  }
  줄.push("");
  줄.push("※ 상태 드롭다운(A열)이 그대로인지 한 번 보세요 — 더하는 자리가 A 보다 뒤라");
  줄.push("   밀리지 않아야 맞습니다.");
  try { csInvalidateReturnLedgerCache_(); } catch (e) {}
  var 글 = 줄.join("\n");
  Logger.log(글);
  return 글;
}
