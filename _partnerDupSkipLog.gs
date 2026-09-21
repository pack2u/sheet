/**
 * ══════════════════════════════════════════════════════════════
 *  [협력업체] 중복으로 걸린 줄을 한 곳에 세워 둔다
 *  파일: _partnerDupSkipLog.gs
 *
 *   > "중복으로 주문수집에서 뺀것들만 따로 보이게 해줘 체크하고 직접 확인 조치하게"
 *   > "아니 주문수집에서 빼지는 말고 지금처럼 경고만 날려줘..."
 *   > "고유아이디가 둘이면 중복이니 빼는게 맞아.."
 *
 *  왜 필요한가
 *    주문 수집은 두 겹으로 중복을 막는다 (_partnerOrders.gs).
 *      ① 고유ID가 이미 허브에 있다
 *      ② 수취인+전화끝4+품목코드가 허브에 이미 그만큼 있다
 *    ★ 2026-09-18 ★ 둘이 하는 일이 갈렸다.
 *      ① 은 여전히 «뺀다» — 같은 고유ID가 둘이면 송장이 어느 줄인지 못 고른다
 *      ② 는 이제 «태운다»  — 재주문일 수 있다. 못 받는 것보다 두 줄이 낫다
 *
 *    빠지는 쪽(①)이 위험하다 —
 *    업체가 줄을 «복사»해 새 주문을 만들면 고유ID까지 따라온다.
 *    그러면 새 주문인데 «중복»으로 빠지고, 아무 데도 안 남는다.
 *    사장님이 겪으신 「한두 건씩 수집이 안 된다」의 유력한 경로다.
 *
 *    여태는 수동 실행 때 뜨는 알림 글에 15줄만 실렸다.
 *    자동 수집(09:30·13:00·15:00)에서는 통째로 사라졌다.
 *
 *  그래서 둔다
 *    · 수집할 때마다 이 탭에 쌓는다 (자동·수동 가리지 않고)
 *    · 짝이 되는 «허브 줄 번호»를 같이 적는다 — 같은 주문인지 바로 갈린다
 *    · 사람이 조치를 고르면 그대로 «실행»한다
 *        「새 주문 — 다시 수집」 → 업체 파일의 그 줄 고유ID를 비운다
 *                                  다음 수집에 저절로 들어온다
 *        「진짜 중복 — 무시」     → 확인 체크만 남기고 둔다
 *
 *  ★ 찾기만 하고 끝내지 않는다 ★
 *    > "계속 오류값 찾아내는 메뉴만 만들고 다시 작업하게 만들고"
 *    고유ID를 손으로 지우러 파일을 열게 하지 않는다. 여기서 지운다.
 * ══════════════════════════════════════════════════════════════
 */

var _DSE_TAB_ = "중복의심_수집";
var _DSE_HEADERS_ = [
  "확인", "구분", "조치", "수집시각", "업체파일", "탭", "행",
  "수취인", "전화번호", "품목코드", "품목명", "수량",
  "고유ID", "까닭", "허브 짝줄", "처리결과", "파일ID",
];

/* ★ 구분 — 이 줄이 «없는» 것인지 «있는» 것인지 ★  (2026-09-18)
     둘은 할 일이 정반대다. 뭉쳐 놓으면 사람이 매번 다시 따져야 한다. */
var _PO_DUP_OUT_ = "⛔ 빠짐(고유ID 겹침)";
var _PO_DUP_IN_ = "⚠ 들어옴(중복의심)";
/*  ★ 걷었다 — ID 만 새로 줬다 ★  (2026-09-21)
    업체가 줄을 복사해 고유ID 가 겹친 것. 여태는 통째로 버렸는데 이제 걷는다.
    할 일이 없는 줄이지만 «업체에 말해 줘야» 하므로 남긴다. */
var _PO_DUP_NEWID_ = "🆕 걷음(ID 새로 발급)";

/** 며칠까지 남길지 */
var _DSE_KEEP_DAYS_ = 30;

var _DSE_ACT_NONE_ = "(고르세요)";
var _DSE_ACT_RECOLLECT_ = "새 주문 — 다시 수집";
var _DSE_ACT_IGNORE_ = "진짜 중복 — 무시";

var _DSE_TZ_ = "Asia/Seoul";

// ─────────────────────────────────────────────────────
//  탭
// ─────────────────────────────────────────────────────

function _dse_tab_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_DSE_TAB_);
  if (tab) return tab;
  tab = ss.insertSheet(_DSE_TAB_);
  tab.getRange(1, 1, 1, _DSE_HEADERS_.length).setValues([_DSE_HEADERS_]);
  tab.getRange("1:1")
    .setBackground("#7a4f01").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center");
  tab.setFrozenRows(1);
  try { tab.setTabColor("#f5a623"); } catch (e) {}
  /*  고유ID·품목코드·전화는 선행 0 이 날아가면 다시 못 찾는다.
      ★ 열을 글자로 박지 않는다 ★ 헤더가 하나 늘면 조용히 어긋난다. */
  try {
    _DSE_TEXT_COLS_.forEach(function (nm) {
      var c = _dse_col_(nm);
      if (c) tab.getRange(2, c, tab.getMaxRows() - 1, 1).setNumberFormat("@");
    });
  } catch (eF) {}
  tab.setColumnWidth(_dse_col_("구분"), 150);
  tab.setColumnWidth(_dse_col_("조치"), 150);
  tab.setColumnWidth(_dse_col_("업체파일"), 220);
  tab.setColumnWidth(_dse_col_("까닭"), 300);
  tab.setColumnWidth(_dse_col_("처리결과"), 260);
  try { tab.hideColumns(_dse_col_("파일ID")); } catch (eH) {}   // 기계가 쓰는 칸
  return tab;
}

/** 선행 0 이 날아가면 다시 못 찾는 칸들 */
var _DSE_TEXT_COLS_ = ["수집시각", "행", "전화번호", "품목코드", "고유ID", "허브 짝줄"];

/** 열 번호(1-base) — 헤더 이름이 바뀌어도 코드가 안 깨지게 */
function _dse_col_(name) {
  var i = _DSE_HEADERS_.indexOf(name);
  return i < 0 ? 0 : i + 1;
}

// ─────────────────────────────────────────────────────
//  1) 수집이 부를 자리
// ─────────────────────────────────────────────────────

/**
 * 이번 수집에서 중복으로 뺀 줄을 탭에 쌓는다.
 * 수집을 «막지 않는다» — 여기서 터져도 수집은 그대로 끝난다.
 *
 * @param {Array} 건너뛴  _partnerOrders.gs 의 _건너뛴_ 배열
 * @return {number} 적은 줄 수
 */
function _dse_record_(건너뛴) {
  if (!건너뛴 || !건너뛴.length) return 0;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return 0;
  var tab = _dse_tab_(ss);

  var at = Utilities.formatDate(new Date(), _DSE_TZ_, "yyyy-MM-dd HH:mm:ss");

  /* ★ 같은 줄을 회차마다 또 쌓지 않는다 ★
     수집은 하루 세 번 돈다. 업체가 그 줄을 안 고치면 세 번 다 걸린다.
     같은 (파일·탭·행·고유ID)가 이미 «미처리»로 있으면 건너뛴다 —
     쌓이기만 하면 이 탭도 결국 안 보게 된다. */
  var 이미 = {};
  var last = tab.getLastRow();
  if (last >= 2) {
    var cAct = _dse_col_("조치"), cChk = _dse_col_("확인");
    var old = tab.getRange(2, 1, last - 1, _DSE_HEADERS_.length).getDisplayValues();
    var oldChk = tab.getRange(2, cChk, last - 1, 1).getValues();
    for (var i = 0; i < old.length; i++) {
      var 끝났나 = oldChk[i][0] === true ||
        String(old[i][cAct - 1] || "").trim() === _DSE_ACT_IGNORE_;
      if (끝났나) continue;   // 끝난 줄이면 다시 뜨는 게 맞다 (또 걸렸다는 뜻)
      이미[_dse_key_(old[i][_dse_col_("업체파일") - 1], old[i][_dse_col_("탭") - 1],
        old[i][_dse_col_("행") - 1], old[i][_dse_col_("고유ID") - 1])] = true;
    }
  }

  var rows = [];
  for (var k = 0; k < 건너뛴.length; k++) {
    var x = 건너뛴[k];
    var key = _dse_key_(x.업체, x.탭, x.행, x.uid);
    if (이미[key]) continue;
    이미[key] = true;
    rows.push([
      false, String(x.구분 || _PO_DUP_OUT_), _DSE_ACT_NONE_, at,
      String(x.업체 || ""), String(x.탭 || ""), String(x.행 || ""),
      String(x.수취인 || ""), String(x.전화 || ""), String(x.품목 || ""),
      String(x.품목명 || ""), String(x.수량 || ""),
      String(x.uid || ""), String(x.까닭 || ""),
      String(x.짝행 || ""), "", String(x.파일ID || ""),
    ]);
  }
  if (!rows.length) return 0;

  var start = tab.getLastRow() + 1;
  for (var tc = 0; tc < _DSE_TEXT_COLS_.length; tc++) {
    var tcc = _dse_col_(_DSE_TEXT_COLS_[tc]);
    if (tcc) tab.getRange(start, tcc, rows.length, 1).setNumberFormat("@");
  }
  tab.getRange(start, 1, rows.length, _DSE_HEADERS_.length).setValues(rows);
  tab.getRange(start, _dse_col_("확인"), rows.length, 1).insertCheckboxes();

  //  조치는 «고르는» 칸이다. 오타로 안 먹는 일이 없게 목록으로 못 박는다.
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([_DSE_ACT_NONE_, _DSE_ACT_RECOLLECT_, _DSE_ACT_IGNORE_], true)
    .setAllowInvalid(false).build();
  tab.getRange(start, _dse_col_("조치"), rows.length, 1).setDataValidation(rule);

  /*  ★ «없는 줄»과 «있는 줄»을 색으로 가른다 ★
        ⛔ 빠짐   — 주문이 허브에 없다. 되살려야 한다 (붉은 기)
        ⚠ 들어옴 — 주문은 있다. 진짜 중복이면 지우면 된다 (노란 기)  */
  for (var rr = 0; rr < rows.length; rr++) {
    var 구분 = String(rows[rr][_dse_col_("구분") - 1]);
    tab.getRange(start + rr, 2, 1, _DSE_HEADERS_.length - 1)
      .setBackground(구분 === _PO_DUP_IN_ ? "#fffbe6" : "#fdecea");
  }

  try { _dse_trim_(tab); } catch (eT) {}
  return rows.length;
}

function _dse_key_(파일, 탭, 행, uid) {
  return [String(파일 || "").trim(), String(탭 || "").trim(),
    String(행 || "").trim(), String(uid || "").trim()].join("♦");
}

/** 오래된 줄 정리 — 확인 끝난 것부터 */
function _dse_trim_(tab) {
  var last = tab.getLastRow();
  if (last < 2) return 0;
  var cAt = _dse_col_("수집시각");
  var vals = tab.getRange(2, cAt, last - 1, 1).getDisplayValues();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - _DSE_KEEP_DAYS_);
  var cutoffKey = Utilities.formatDate(cutoff, _DSE_TZ_, "yyyy-MM-dd");

  var drop = 0;
  for (var i = 0; i < vals.length; i++) {
    var s = String(vals[i][0] || "").trim();
    if (!s) break;
    if (s.substring(0, 10) >= cutoffKey) break;   // 쌓인 차례 = 시간 차례
    drop++;
  }
  if (drop > 0) tab.deleteRows(2, drop);
  return drop;
}

// ─────────────────────────────────────────────────────
//  2) 조치를 «실행»한다
// ─────────────────────────────────────────────────────

/**
 * 「새 주문 — 다시 수집」으로 고른 줄을 실제로 되살린다.
 *
 * 하는 일은 하나다 — 업체 파일 그 줄의 «고유ID 칸을 비운다».
 * 그러면 다음 수집이 새 고유ID를 발급해 정상으로 들어온다.
 *
 * ★ 남의 자료를 고치는 일이다. 그래서 세 가지를 먼저 확인한다 ★
 *   ① 그 파일·탭·행이 아직 있는가
 *   ② 그 줄의 고유ID가 «적힌 그것»과 같은가 (업체가 이미 바꿨을 수 있다)
 *   ③ 수취인·품목코드가 아직 같은가 (업체가 줄을 지우고 밀었을 수 있다)
 * 하나라도 어긋나면 «안 건드리고» 왜 안 했는지 적는다.
 */
function partnerDupSkipRetry() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (eU) {}
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(_DSE_TAB_);
  if (!tab || tab.getLastRow() < 2) {
    if (ui) ui.alert("「" + _DSE_TAB_ + "」 탭에 줄이 없습니다.");
    return { ok: true, done: 0, skip: 0 };
  }

  var last = tab.getLastRow();
  var all = tab.getRange(2, 1, last - 1, _DSE_HEADERS_.length).getValues();
  var cAct = _dse_col_("조치") - 1, cFid = _dse_col_("파일ID") - 1;
  var cTab = _dse_col_("탭") - 1, cRow = _dse_col_("행") - 1;
  var cUid = _dse_col_("고유ID") - 1, cName = _dse_col_("수취인") - 1;
  var cCode = _dse_col_("품목코드") - 1, cRes = _dse_col_("처리결과") - 1;
  var cChk = _dse_col_("확인") - 1, cFile = _dse_col_("업체파일") - 1;

  var cKind = _dse_col_("구분") - 1;
  var 고른것 = [], 이미들어옴 = 0;
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][cAct] || "").trim() !== _DSE_ACT_RECOLLECT_) continue;
    if (String(all[i][cRes] || "").trim().indexOf("고유ID 지움") === 0) continue;
    /* ★ 「들어옴」 줄은 되살릴 것이 없다 ★  (2026-09-18)
       그 주문은 이미 허브에 있다. 여기서 고유ID를 비우면 다음 수집에
       «또 한 줄»이 들어온다 — 막으려던 이중출고를 내가 만드는 꼴이다. */
    if (String(all[i][cKind] || "").trim() === _PO_DUP_IN_) {
      all[i][cRes] = "✋ 이 줄은 이미 허브에 들어와 있습니다 — 되살릴 것이 없습니다. " +
        "진짜 중복이면 허브에서 그 줄을 지우세요.";
      이미들어옴++;
      continue;
    }
    고른것.push(i);
  }
  if (이미들어옴) {
    tab.getRange(2, 1, all.length, _DSE_HEADERS_.length).setValues(all);
  }
  if (!고른것.length) {
    if (ui) {
      ui.alert(
        "되살릴 줄이 없습니다." +
        (이미들어옴 ? "\n(이미 허브에 들어온 줄 " + 이미들어옴 + "건은 건너뛰었습니다)" : "") +
        "\n\n" +
        "「" + _DSE_TAB_ + "」 탭 C열(조치)에서\n" +
        "「" + _DSE_ACT_RECOLLECT_ + "」 를 고른 뒤 다시 누르세요.\n" +
        "되살릴 수 있는 것은 «⛔ 빠짐(고유ID 겹침)» 줄뿐입니다."
      );
    }
    return { ok: true, done: 0, skip: 0 };
  }

  var 열린파일 = {};
  var done = 0, 어긋남 = 0, 못열음 = 0;
  var 자세히 = [];
  var 시작 = Date.now(), 예산 = 4 * 60 * 1000, 멈춤 = "";

  for (var g = 0; g < 고른것.length; g++) {
    if (Date.now() - 시작 > 예산) {
      멈춤 = "시간이 모자라 " + g + "건까지만 했습니다. 다시 누르면 이어서 합니다.";
      break;
    }
    var ri = 고른것[g];
    var row = all[ri];
    var fid = String(row[cFid] || "").trim();
    var tabName = String(row[cTab] || "").trim();
    var rowNo = parseInt(row[cRow], 10);
    var uid = String(row[cUid] || "").trim();

    if (!fid || !tabName || !(rowNo >= 2)) {
      all[ri][cRes] = "✋ 파일·탭·행 정보가 모자랍니다 (옛 줄)";
      못열음++;
      continue;
    }

    var vs;
    try {
      vs = 열린파일[fid] || (열린파일[fid] = SpreadsheetApp.openById(fid));
    } catch (eOpen) {
      all[ri][cRes] = "✋ 파일을 못 엽니다 — " + eOpen.message;
      못열음++;
      continue;
    }
    var vt = vs.getSheetByName(tabName);
    if (!vt) {
      all[ri][cRes] = "✋ 「" + tabName + "」 탭이 없습니다 (이름이 바뀐 듯)";
      못열음++;
      continue;
    }
    if (rowNo > vt.getLastRow()) {
      all[ri][cRes] = "✋ " + rowNo + "행이 없습니다 (줄이 지워진 듯)";
      어긋남++;
      continue;
    }

    var lc = Math.max(vt.getLastColumn(), 14);
    var hdr = vt.getRange(1, 1, 1, lc).getValues()[0];
    var cm = _po_buildColMap(hdr);
    if (cm.uniqueId === -1) {
      all[ri][cRes] = "✋ 그 탭에 고유ID 칸이 없습니다";
      어긋남++;
      continue;
    }

    var cur = vt.getRange(rowNo, 1, 1, lc).getValues()[0];
    var curUid = String(cur[cm.uniqueId] || "").trim();
    var curName = cm.recipient !== -1 ? String(cur[cm.recipient] || "").trim() : "";
    var curCode = cm.code !== -1 ? String(cur[cm.code] || "").trim() : "";

    /* ★ 적힌 것과 지금이 다르면 손대지 않는다 ★
       업체가 그 사이 줄을 고쳤거나 지웠으면, 여기서 비우는 칸은
       «엉뚱한 주문»의 고유ID다. 그 줄이 통째로 다시 들어오게 된다. */
    if (uid && curUid !== uid) {
      all[ri][cRes] = "✋ 고유ID가 바뀌었습니다 (적힌 " + uid + " ≠ 지금 " +
        (curUid || "빈칸") + ") — 손대지 않았습니다";
      어긋남++;
      continue;
    }
    var 적힌이름 = String(row[cName] || "").trim();
    var 적힌코드 = String(row[cCode] || "").trim();
    if (적힌이름 && curName && curName !== 적힌이름) {
      all[ri][cRes] = "✋ 수취인이 다릅니다 (적힌 " + 적힌이름 + " ≠ 지금 " +
        curName + ") — 줄이 밀린 듯합니다";
      어긋남++;
      continue;
    }
    if (적힌코드 && curCode && _po_normalizeCode(curCode) !== _po_normalizeCode(적힌코드)) {
      all[ri][cRes] = "✋ 품목코드가 다릅니다 (적힌 " + 적힌코드 + " ≠ 지금 " +
        curCode + ") — 줄이 밀린 듯합니다";
      어긋남++;
      continue;
    }

    try {
      vt.getRange(rowNo, cm.uniqueId + 1).setValue("");
      all[ri][cRes] = "✅ 고유ID 지움 (" +
        Utilities.formatDate(new Date(), _DSE_TZ_, "MM-dd HH:mm") +
        ") — 다음 수집에 들어옵니다";
      all[ri][cChk] = true;
      done++;
      자세히.push("  " + String(row[cFile] || "") + " " + tabName + " R" + rowNo +
        "  " + 적힌이름 + " / " + 적힌코드);
    } catch (eW) {
      all[ri][cRes] = "✋ 못 지웠습니다 — " + eW.message;
      어긋남++;
    }
  }

  tab.getRange(2, 1, all.length, _DSE_HEADERS_.length).setValues(all);
  SpreadsheetApp.flush();

  var lines = [];
  lines.push("↷ 수집제외 되살리기");
  lines.push("");
  lines.push("- 고른 줄   : " + 고른것.length + "건");
  lines.push("- 되살림    : " + done + "건 (고유ID 를 비웠습니다)");
  if (어긋남) lines.push("- 안 건드림 : " + 어긋남 + "건 (지금 자료와 어긋남)");
  if (못열음) lines.push("- 못 열음   : " + 못열음 + "건");
  if (이미들어옴) lines.push("- 이미 들어옴 : " + 이미들어옴 + "건 (허브에 있는 줄이라 건너뜀)");
  if (멈춤) { lines.push(""); lines.push("※ " + 멈춤); }
  /* ★ 숫자가 맞는지 스스로 본다 ★ 안 맞으면 그 표 전체를 못 믿는다 */
  var 셈합 = done + 어긋남 + 못열음;
  if (!멈춤 && 셈합 !== 고른것.length) {
    lines.push("");
    lines.push("⚠ 숫자가 안 맞습니다 (" + 셈합 + " ≠ " + 고른것.length + "). " +
      "처리결과 칸을 직접 보세요.");
  }
  if (done) {
    lines.push("");
    lines.push("되살린 줄:");
    lines.push(자세히.slice(0, 15).join("\n"));
    lines.push("");
    lines.push("★ 지금 발주 수집을 한 번 돌리면 이 줄들이 허브에 들어옵니다.");
  }
  if (어긋남 || 못열음) {
    lines.push("");
    lines.push("안 건드린 줄은 O열(처리결과)에 까닭이 적혀 있습니다.");
  }

  var msg = lines.join("\n");
  Logger.log(msg);
  if (ui) ui.alert(msg);
  return { ok: true, done: done, skip: 어긋남 + 못열음, message: msg };
}

/** 메뉴: 탭 열기 */
function partnerDupSkipOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = _dse_tab_(ss);
  ss.setActiveSheet(tab);
  var n = Math.max(tab.getLastRow() - 1, 0);
  try {
    SpreadsheetApp.getUi().alert(
      "「" + _DSE_TAB_ + "」 — 중복으로 걸린 줄 " + n + "건\n\n" +
      "B열「구분」이 두 가지입니다. 할 일이 정반대입니다.\n\n" +
      "  " + _PO_DUP_OUT_ + "\n" +
      "    그 주문이 허브에 «없습니다». 업체가 줄을 복사하면 고유ID까지\n" +
      "    따라옵니다 — 새 주문인데 안 들어온 것입니다.\n" +
      "    → C열에서 「" + _DSE_ACT_RECOLLECT_ + "」 를 고르고\n" +
      "      메뉴 「↷ 고른 줄 되살리기」 → 발주 수집 한 번.\n\n" +
      "  " + _PO_DUP_IN_ + "\n" +
      "    그 주문은 허브에 «있습니다». 재주문일 수 있어 안 뺐습니다.\n" +
      "    → 진짜 중복이면 허브에서 그 줄을 지우세요. 여기서는 확인만 찍습니다.\n\n" +
      "「허브 짝줄」의 허브 행을 열어 보면 같은 주문인지 바로 갈립니다."
    );
  } catch (e) {}
}
