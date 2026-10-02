/**
 * ══════════════════════════════════════════════════════════════
 *  반품 고유ID — 「r1002000003」
 *
 *  > "모든 문의 반품 발주관련된 부분에서 항상 고유아이디가 붙게해줘..
 *  >  다 연결되어 연동..찾기가 가능하고 추적가능하게"
 *
 *  ★ 있던 규칙을 늘린다 ★  (2026-09-21 결정)
 *      d1002000047   발주 수집 (허브)
 *      p1002000047   전화주문 (세트분리)
 *      r1002000003   반품          ← 여기
 *    난수가 아니라 «그날의 번호표»다. 난수 넉 자는 나흘에 한 번 겹쳤고,
 *    겹친 줄은 아무 말 없이 빠졌다. 날짜가 이미 윗자리 카운터이므로
 *    아랫자리도 카운터로 두면 겹침이 «구조적으로» 없다.
 *
 *  ★ 왜 반품에 제 번호가 있어야 하나 ★
 *    여태 반품 건은 (탭, 행)으로만 가리켰다. 줄이 한 칸 밀리면 짝이 끊긴다 —
 *    2026-10-01 에 9월 탭에서 그렇게 «유령 아홉 줄»이 생겼다.
 *    제 번호가 있으면 줄이 어디로 가든 같은 건이다.
 *
 *  ★ 날짜는 «접수날짜»를 쓴다 ★
 *    번호를 매긴 날이 아니라 그 반품이 접수된 날이다. 그래야 번호를 보고
 *    언제 건인지 안다. 접수날짜가 비어 있으면 그 탭의 1일로 둔다 —
 *    비워 두면 그 줄만 영영 못 가리킨다.
 *
 *  ★ 열은 맨 뒤에 ★
 *    중간에 끼우면 뒤 칸이 전부 밀리고, 자리가 움직이면 v2 미러가 어긋난다.
 *    대장은 머리글 «이름»으로 읽으니 맨 뒤여도 똑같이 잡힌다.
 *
 *  돌리는 법  —  편집기에서 ▶ 실행 → Ctrl+Enter 로 로그
 *    ① csReturnUid_미리보기   몇 줄에 매길지만 «본다». 안 바꾼다.
 *    ② csReturnUidFill        열을 만들고 빈 줄에 매긴다. 두 번 돌려도 탈 없다.
 *
 *  다 쓰면 ②는 지워도 된다. ★ _cs_returnUidNext_ 는 남겨야 한다 ★ —
 *  새 반품을 기록할 때 csOrderSearch 가 부른다.
 * ══════════════════════════════════════════════════════════════
 */

/** 반품 고유ID 의 표식. 발주 d · 전화주문 p 와 겹치지 않는다 */
var _CS_RUID_PFX_ = "r";
var _CS_RUID_HEADER_ = "고유ID";

/** 머리글이 고유ID 인가 — 띄어쓰기·대소문자를 봐준다 */
function _cs_isUidHeader_(h) {
  return /^고유ID$|^고유아이디$|^UID$/i.test(String(h || "").replace(/\s/g, ""));
}

/** 「261002」·「2026-10-02」·Date → 「1002」. 못 읽으면 "" */
function _cs_ruidMMDD_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Asia/Seoul", "MMdd");
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  var m = s.match(/^(\d{2})(\d{2})(\d{2})$/);              // 261002
  if (m) return m[2] + m[3];
  m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);      // 2026-10-02
  if (m) return ("0" + m[2]).slice(-2) + ("0" + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[-./](\d{1,2})$/);                 // 10/2
  if (m) return ("0" + m[1]).slice(-2) + ("0" + m[2]).slice(-2);
  return "";
}

/**
 * 그날의 다음 번호를 준다.
 *
 * @param {string} mmdd  「1002」
 * @param {Object} 쓴것  이미 쓰인 ID 들 {uid: true}. ★ 이 함수가 여기에 적어 둔다 ★
 *                        같은 실행 안에서 두 번 같은 번호를 주지 않으려면 그래야 한다.
 */
function _cs_returnUidNext_(mmdd, 쓴것) {
  var 앞 = _CS_RUID_PFX_ + mmdd;
  var 최대 = 0;
  for (var k in 쓴것) {
    if (!Object.prototype.hasOwnProperty.call(쓴것, k)) continue;
    if (String(k).indexOf(앞) !== 0) continue;
    var 꼬리 = String(k).substring(앞.length);
    if (!/^[0-9]{6}$/.test(꼬리)) continue;
    var n = parseInt(꼬리, 10);
    if (n > 최대) 최대 = n;
  }
  var uid, 다음 = 최대 + 1;
  do {
    uid = 앞 + ("00000" + 다음).slice(-6);
    다음++;
  } while (쓴것[uid]);
  쓴것[uid] = true;
  return uid;
}

/** 그 탭의 고유ID 열(0기준). 없으면 -1 */
function _cs_ruidCol_(머리) {
  for (var i = 0; i < 머리.length; i++) if (_cs_isUidHeader_(머리[i])) return i;
  return -1;
}

/** 손댈 탭 — 달 탭 전부 + 협의안 */
function _csruid_tabs_(ss) {
  var out = [];
  var 본 = null;
  try { 본 = _cs_returnLedgerSpecTab_(ss); } catch (e) {}
  if (본) out.push(본);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (/^\d{6}$/.test(String(sheets[i].getName() || "").trim())) out.push(sheets[i]);
  }
  return out;
}

/** ① 몇 줄에 매길지만 본다 */
function csReturnUid_미리보기() { return _csruid_run_(true); }

/** ② 열을 만들고 빈 줄에 매긴다 */
function csReturnUidFill() { return _csruid_run_(false); }

function _csruid_run_(미리보기만) {
  var 줄 = ["■ 반품 고유ID" + (미리보기만 ? "  (미리보기 · 안 바꿉니다)" : " 매기기"), ""];
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var 탭들 = _csruid_tabs_(ss);
  if (!탭들.length) { 줄.push("★ 손댈 탭이 없습니다."); return _csruidLog_(줄); }

  /*  ★ 먼저 «전부» 읽어 이미 쓰인 번호를 모은다 ★
      탭마다 따로 세면 같은 날짜가 두 탭에 걸쳐 있을 때 번호가 겹친다.  */
  var 쓴것 = {};
  var 모음 = [];
  for (var t = 0; t < 탭들.length; t++) {
    var tab = 탭들[t];
    var lc = Math.max(tab.getLastColumn(), 15);
    var lr = Math.max(tab.getLastRow(), 1);
    var v = tab.getRange(1, 1, lr, lc).getDisplayValues();
    var hi = _cs_findReturnHeaderRow_(v);
    if (hi < 0) { 줄.push("⏸ " + tab.getName() + " — 머리글 줄을 못 찾아 건너뜁니다."); continue; }
    var 머리 = v[hi];
    var col = _cs_mapReturnLedgerCols_(머리);
    var uidCol = _cs_ruidCol_(머리);
    if (uidCol >= 0) {
      for (var r = hi + 1; r < v.length; r++) {
        var u = String(v[r][uidCol] || "").trim();
        if (u) 쓴것[u] = true;
      }
    }
    모음.push({ tab: tab, 값: v, 머리칸: hi, 머리: 머리, col: col, uidCol: uidCol });
  }

  /* ── 탭마다 ─────────────────────────────────────────────── */
  var 총매김 = 0, 총빈날 = 0;
  for (var m = 0; m < 모음.length; m++) {
    var o = 모음[m];
    var 이름 = o.tab.getName();
    var 달 = /^\d{6}$/.test(이름) ? 이름.substring(4) + "01" : "";   // 202610 → 1001

    //  자료 줄 — 머리글 아래, 값이 있는 마지막 줄까지
    var 끝 = -1;
    for (var i2 = o.머리칸 + 1; i2 < o.값.length; i2++) {
      for (var c2 = 0; c2 < o.값[i2].length; c2++) {
        if (String(o.값[i2][c2] || "").trim()) { 끝 = i2; break; }
      }
    }
    if (끝 < 0) { 줄.push("· " + 이름 + " — 자료가 없습니다."); continue; }

    var 매길것 = [], 빈날 = 0;
    for (var r2 = o.머리칸 + 1; r2 <= 끝; r2++) {
      var 줄값 = o.값[r2];
      var 뭔가 = false;
      for (var c3 = 0; c3 < 줄값.length; c3++) {
        if (String(줄값[c3] || "").trim()) { 뭔가 = true; break; }
      }
      if (!뭔가) continue;                                    // 빈 줄은 건너뛴다
      if (o.uidCol >= 0 && String(줄값[o.uidCol] || "").trim()) continue;  // 이미 있다

      var mmdd = o.col.date >= 0 ? _cs_ruidMMDD_(줄값[o.col.date]) : "";
      if (!mmdd) { mmdd = 달; 빈날++; }                        // 접수날짜가 없다 → 그 달 1일
      if (!mmdd) continue;                                    // 협의안 탭 등 — 달도 모르면 건너뛴다
      매길것.push({ row: r2, mmdd: mmdd });
    }

    줄.push("· " + 이름 + "  (머리 " + (o.머리칸 + 1) + "행 · " +
      (끝 - o.머리칸) + "줄)" +
      (o.uidCol >= 0 ? "  고유ID " + _cs_colLetter_(o.uidCol) + "열" : "  고유ID 열 없음"));
    줄.push("   매길 줄 " + 매길것.length + (빈날 ? " · 접수날짜 없는 줄 " + 빈날 + " (그 달 1일로)" : ""));
    총매김 += 매길것.length;
    총빈날 += 빈날;
    if (미리보기만 || !매길것.length) continue;

    /* ── 열이 없으면 맨 뒤에 만든다 ─────────────────────── */
    var uidCol2 = o.uidCol;
    if (uidCol2 < 0) {
      var 폭 = o.머리.length;
      while (폭 > 0 && !String(o.머리[폭 - 1] || "").trim()) 폭--;
      var 칸 = 폭 + 1;
      if (칸 > o.tab.getMaxColumns()) {
        o.tab.insertColumnsAfter(o.tab.getMaxColumns(), 칸 - o.tab.getMaxColumns());
      }
      o.tab.getRange(o.머리칸 + 1, 칸).setValue(_CS_RUID_HEADER_).setFontWeight("bold");
      try {
        o.tab.getRange(o.머리칸 + 1, 폭).copyTo(
          o.tab.getRange(o.머리칸 + 1, 칸), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        o.tab.getRange(o.머리칸 + 1, 칸).setValue(_CS_RUID_HEADER_);
      } catch (eF) {}
      //  ★ 글로 잠근다 ★ r1002000003 을 숫자로 읽으려 들면 안 된다
      o.tab.getRange(o.머리칸 + 2, 칸, Math.max(1, o.tab.getMaxRows() - o.머리칸 - 1), 1)
        .setNumberFormat("@");
      try { o.tab.setColumnWidth(칸, 110); } catch (eW) {}
      uidCol2 = 칸 - 1;
      줄.push("   + " + _cs_colLetter_(uidCol2) + "열 ← 고유ID");
    }

    /* ── 한 번에 쓴다 ───────────────────────────────────── */
    var 처음 = 매길것[0].row, 마지막 = 매길것[매길것.length - 1].row;
    var 폭2 = 마지막 - 처음 + 1;
    var 지금 = o.tab.getRange(처음 + 1, uidCol2 + 1, 폭2, 1).getDisplayValues();
    for (var k2 = 0; k2 < 매길것.length; k2++) {
      var 자리 = 매길것[k2].row - 처음;
      if (String(지금[자리][0] || "").trim()) continue;        // 그 사이 누가 적었다 — 안 덮는다
      지금[자리][0] = _cs_returnUidNext_(매길것[k2].mmdd, 쓴것);
    }
    o.tab.getRange(처음 + 1, uidCol2 + 1, 폭2, 1).setValues(지금);
  }

  SpreadsheetApp.flush();
  줄.push("");
  if (미리보기만) {
    줄.push("모두 " + 총매김 + "줄에 매깁니다" + (총빈날 ? " (접수날짜 없는 " + 총빈날 + "줄은 그 달 1일로)" : "") + ".");
    줄.push("이대로 괜찮으면 csReturnUidFill 을 실행하세요.");
    return _csruidLog_(줄);
  }

  /* ── 나가기 직전 검문 — 빠진 줄이 없나 ─────────────────── */
  var 남은것 = 0, 봄 = 0;
  for (var z = 0; z < 모음.length; z++) {
    var tb = 모음[z].tab;
    var lc2 = Math.max(tb.getLastColumn(), 15);
    var vv = tb.getRange(1, 1, Math.max(tb.getLastRow(), 1), lc2).getDisplayValues();
    var hi2 = _cs_findReturnHeaderRow_(vv);
    if (hi2 < 0) continue;
    var uc = _cs_ruidCol_(vv[hi2]);
    if (uc < 0) continue;
    for (var y = hi2 + 1; y < vv.length; y++) {
      var 뭔가2 = false;
      for (var x = 0; x < vv[y].length; x++) {
        if (x !== uc && String(vv[y][x] || "").trim()) { 뭔가2 = true; break; }
      }
      if (!뭔가2) continue;
      봄++;
      if (!String(vv[y][uc] || "").trim()) 남은것++;
    }
  }
  줄.push("✅ " + 총매김 + "줄에 매겼습니다.");
  줄.push((남은것 ? "⏸ " : "✅ ") + "자료 " + 봄 + "줄 가운데 번호 없는 줄 " + 남은것 + "개");
  if (남은것) 줄.push("   (접수날짜도 달도 모르는 줄입니다 — 협의안 탭의 보기 줄일 수 있습니다)");
  줄.push("");
  줄.push("▶ 다음: 허브에서 partnerMirrorReturnsToV2 를 돌리면 v2 가 번호를 받습니다.");

  try { csInvalidateReturnLedgerCache_(); } catch (e) {}
  return _csruidLog_(줄);
}

function _csruidLog_(줄) {
  var 글 = 줄.join("\n");
  Logger.log(글);
  return 글;
}
