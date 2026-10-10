/**
 * ══════════════════════════════════════════════════════════════
 *  반품관리대장 — 빠진 열을 더한다  (달 탭마다, 여러 번 돌려도 탈 없다)
 *
 *  > "㉰로 가자" → "다해줘"
 *
 *  ★ 비슷한 함수가 하나 더 있다 ★  (2026-10-04)
 *    csAddReturnCols.gs 는 «다른 칸»을 더한다 —
 *      여기   교환반품구분 · 귀책 · 반품/환불비용 · 입고확인요청
 *      그쪽   재출고상품 · 재출고배송비 · 반품비     (10월 탭에 이미 다 있다)
 *    그래서 이 함수는 «아직 쓸 일이 남아» 있다 — 교환반품구분·귀책 칸이 없다.
 *    그때까지 그 두 값은 비고의 「구분: …」·「귀책: …」 줄로 흐른다.
 *
 *  ★ 10월 탭이 잃은 것 ★
 *    9월에 있던 교환반품구분(유형) · 반품/환불비용 · 회수신청 이 없어졌다.
 *    그래서 10월에 올린 카드는 «유형과 반품비가 그냥 버려진다» —
 *    반품비는 돈이고, 유형은 CS 가 무엇을 할지다.
 *    그리고 9/30 에 만든 귀책·입고확인요청 은 두 달 다 갈 곳이 없다.
 *
 *  ★ 어디에 끼우나 ★
 *    유형·귀책·반품비는 「발생원인」 바로 뒤에 둔다 — 뜻이 모여 있어야 사람이
 *    채운다. 맨 뒤에 붙이면 아무도 안 채운다.
 *    입고확인요청은 맨 뒤에 붙인다 — CS 가 물류에게 남기는 쪽지라 읽는 자리가
 *    따로 있다(물류 입고 화면).
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
 *    csAddReturnLedgerCols            — 이번 달 탭
 *    csAddReturnLedgerColsAll         — 최근 달 탭 전부 (기본 3달)
 * ══════════════════════════════════════════════════════════════
 */

/*  더할 열 — 머리글, 어느 열 «뒤»에 끼울지, 못 찾으면 맨 뒤
    차례가 뜻이다: 사유(발생원인) 다음에 「무엇을·누구 탓·얼마」가 온다.  */
var _CS_RET_ADD_COLS_ = [
  { 이름: "교환반품구분", 뒤에: /^발생원인$|^반품사유$|^사유$/, 설명: "재출고·단순반품·교환·오배송 … CS 가 무엇을 할지" },
  { 이름: "귀책", 뒤에: /^교환반품구분$/, 설명: "구매자 | 판매자 — 반품비를 누가 내나" },
  { 이름: "반품/환불비용", 뒤에: /^귀책$/, 설명: "금액. 판매자 귀책이면 비워 둔다" },
  { 이름: "입고확인요청", 뒤에: null, 설명: "CS → 물류. 박스 열 때 볼 것" },
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

/** 최근 달 탭 전부 (기본 3달) */
function csAddReturnLedgerColsAll(months) {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var n = months || 3;
  var 달 = [];
  for (var i = 0; i < n; i++) {
    var d = new Date();
    d.setMonth(d.getMonth() - i);
    달.push(_cs_returnLedgerMonthKey_(d));
  }
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
  줄.push("");
  줄.push("※ 상태 드롭다운(A열)이 그대로인지 한 번 보세요 — 더하는 자리가 A 보다 뒤라");
  줄.push("   밀리지 않아야 맞습니다.");
  try { csInvalidateReturnLedgerCache_(); } catch (e) {}
  var 글 = 줄.join("\n");
  Logger.log(글);
  return 글;
}
