/**
 * ══════════════════════════════════════════════════════════════
 *  선제 연락 명단 — 전화가 «오기 전에» 우리가 먼저 건다
 *  파일: _partnerInvoiceCallList.gs
 *
 *  왜 만드나
 *    > "우리만 거짓말쟁이 되고 전화 상담만 과도하게 받는 중이야"
 *
 *    남의 송장이 붙으면 고객은 조회창에서 남의 배송을 본다. 「배송완료」라고
 *    적혀 있는데 상자는 안 왔다. 그 상태로 기다리다 전화가 온다. 그때는
 *    이미 우리가 거짓말을 한 뒤다.
 *
 *    🧭 송장 소유권 점검은 그 건들을 «찾아» 준다. 다만 찾은 것은 송장 기준의
 *    묶음이라, 그대로는 전화를 걸 수 없다. 사람 기준으로 다시 묶어야
 *    수화기를 들 수 있다.
 *
 *  무엇을 하나
 *    `송장소유권_점검` 탭을 읽어 «사람» 단위로 접는다.
 *    한 사람이 여러 건에 걸려 있으면 한 줄로 모은다 — 전화는 한 번이면 된다.
 *
 *  ★ 짐작한 것을 사실처럼 적지 않는다 ★
 *    점검의 「주인추정」은 «주문일이 가장 이르다»는 것뿐이다. 그것으로
 *    누구 상자인지 단정할 수 없다. 그래서 명단에는 이 송장이 몇 개의 주문에
 *    붙어 있는지만 적고, 통화에서 «무엇을 확인할지»를 적어 둔다.
 *
 *  읽기 전용. 아무것도 고치지 않는다.
 * ══════════════════════════════════════════════════════════════
 */

var _ICL_TAB_ = "선제연락_명단";

var _ICL_HEADERS_ = [
  "연락완료",   // A: 체크박스
  "급함",       // B: 🔴 / 🟡
  "고객명",     // C
  "전화",       // D
  "건수",       // E: 이 사람이 걸린 송장 수
  "송장번호",   // F
  "품목",       // G
  "주문일",     // H
  "무슨 일인가",            // I
  "통화에서 확인할 것",      // J
  "같은 송장을 쓴 다른 주문", // K
  "어디",       // L: 위치 · 행
];

/**
 * 점검 탭의 칸을 «이름으로» 찾는다.
 * 자리로 박지 않는다 — _IOD_HEADERS_ 는 앞으로도 늘어날 수 있다.
 */
function _icl_mapCols_(hdr) {
  var 찾을것 = {
    grade: /^등급$/, reason: /^사유$/, inv: /^송장번호$/, owner: /^주인추정$/,
    where: /^위치$/, oid: /^주문번호$/, name: /^수취인$/, phone: /^전화$/,
    item: /^품목명$/, date: /^주문일$/, row: /^행$/, group: /^그룹$/
  };
  var m = {};
  for (var k in 찾을것) if (찾을것.hasOwnProperty(k)) m[k] = -1;
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || "").replace(/[ \t]/g, "");
    if (!h) continue;
    for (var k2 in 찾을것) {
      if (!찾을것.hasOwnProperty(k2)) continue;
      if (m[k2] < 0 && 찾을것[k2].test(h)) m[k2] = i;
    }
  }
  return m;
}

/** 전화번호에서 숫자만 — 같은 사람인지 가리는 데 쓴다 */
function _icl_phoneKey_(v) {
  return String(v == null ? "" : v).replace(/[^0-9]/g, "");
}

/**
 * 무슨 일이 난 것인가 — 점검이 «적어 놓은 사유»만 보고 고른다.
 * 짐작으로 문장을 만들지 않는다.
 */
function _icl_what_(grade, reason) {
  var r = String(reason || "");
  if (r.indexOf("수취인이 다른") !== -1) {
    return "이 송장이 다른 분 주문에도 붙어 있습니다 — 한쪽은 상자를 못 받습니다";
  }
  if (r.indexOf("과거 주문 송장") !== -1) {
    return "지난 주문의 송장이 이번 주문에 붙었습니다 — 조회하면 «배송완료»로 보입니다";
  }
  if (String(grade || "").indexOf("의심") !== -1) {
    return "주문 여럿에 같은 송장 · 합배송이라는 표시가 없습니다 — 한 상자가 안 갔을 수 있습니다";
  }
  return "한 송장이 여러 주문에 붙어 있습니다";
}

/** 통화에서 무엇을 확인할까 */
function _icl_ask_(grade, reason) {
  var r = String(reason || "");
  if (r.indexOf("수취인이 다른") !== -1) {
    return "상자를 받으셨는지 · 송장으로 조회했을 때 다른 분 배송이 보이지는 않는지";
  }
  if (r.indexOf("과거 주문 송장") !== -1) {
    return "이번 주문이 실제로 도착했는지 (조회에는 지난번 배송이 보일 수 있습니다)";
  }
  if (String(grade || "").indexOf("의심") !== -1) {
    return "한 상자로 받으셨는지 · 따로 시키신 것이 아직 안 왔는지";
  }
  return "상자가 실제로 도착했는지 · 조회 내용과 맞는지";
}

/**
 * 선제 연락 명단을 만든다.
 * @param {boolean=} 의심도  🟡 의심까지 담을지 (기본 담는다)
 */
function partnerBuildInvoiceCallList(의심도) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName(_IOD_TAB_);
  if (!src || src.getLastRow() < 2) {
    var 없다 = "'" + _IOD_TAB_ + "' 탭이 없습니다." +
      "\n\n먼저 🧭 송장 소유권 점검을 한 번 돌려 주세요.";
    try { SpreadsheetApp.getUi().alert(없다); } catch (e) {}
    return 없다;
  }
  if (의심도 === undefined) 의심도 = true;

  var all = src.getRange(1, 1, src.getLastRow(), src.getLastColumn()).getDisplayValues();
  var c = _icl_mapCols_(all[0]);
  if (c.grade < 0 || c.inv < 0 || c.name < 0) {
    var 못읽음 = "'" + _IOD_TAB_ + "' 탭의 머리글을 못 읽었습니다 (등급·송장번호·수취인)." +
      "\n점검을 다시 돌리면 머리글이 새로 깔립니다.";
    try { SpreadsheetApp.getUi().alert(못읽음); } catch (e2) {}
    return 못읽음;
  }

  /*  ── 1) 묶음별로 모은다 ──────────────────────────────────
      명단의 단위는 «사람»이지만, 「같은 송장을 쓴 다른 주문」을 적으려면
      묶음을 먼저 알아야 한다.  */
  var 묶음 = {};
  var 순서묶음 = [];
  for (var r = 1; r < all.length; r++) {
    var g = c.group >= 0 ? String(all[r][c.group] || "").trim() : "";
    var inv = String(all[r][c.inv] || "").trim();
    var key = g || inv;
    if (!key) continue;
    if (!묶음[key]) { 묶음[key] = []; 순서묶음.push(key); }
    묶음[key].push({
      grade: String(all[r][c.grade] || "").trim(),
      reason: c.reason >= 0 ? String(all[r][c.reason] || "").trim() : "",
      inv: inv,
      where: c.where >= 0 ? String(all[r][c.where] || "").trim() : "",
      name: String(all[r][c.name] || "").trim(),
      phone: c.phone >= 0 ? String(all[r][c.phone] || "").trim() : "",
      item: c.item >= 0 ? String(all[r][c.item] || "").trim() : "",
      date: c.date >= 0 ? String(all[r][c.date] || "").trim() : "",
      row: c.row >= 0 ? String(all[r][c.row] || "").trim() : ""
    });
  }

  /*  ── 2) 사람 단위로 접는다 ─────────────────────────────
      한 사람이 세 건에 걸려 있어도 전화는 한 번이다.
      이름+전화가 열쇠. 전화가 없으면 이름만으로 — 동명이인이 합쳐질 수는
      있지만 그건 «합치는» 쪽이라 빠뜨리지는 않는다.  */
  var 사람 = {};
  var 순서 = [];
  var 담음 = 0, 건너뜀 = 0;

  for (var gi = 0; gi < 순서묶음.length; gi++) {
    var 줄들 = 묶음[순서묶음[gi]];
    var 등급 = 줄들.length ? 줄들[0].grade : "";
    var 확실 = 등급.indexOf("확실") !== -1;
    if (!확실 && !의심도) { 건너뜀 += 줄들.length; continue; }

    for (var i = 0; i < 줄들.length; i++) {
      var d = 줄들[i];
      if (!d.name) { 건너뜀++; continue; }   // 누구인지 모르면 전화를 못 건다

      /*  같은 묶음의 «다른» 주문을 적어 둔다.
          통화 중에 「그럼 이건 누구 겁니까」가 바로 나오기 때문이다.  */
      var 남들 = [];
      for (var j = 0; j < 줄들.length; j++) {
        if (j === i) continue;
        var o = 줄들[j];
        var t = (o.name || "이름없음") + (o.item ? " · " + o.item : "") +
          (o.date ? " · " + o.date : "");
        if (남들.indexOf(t) === -1) 남들.push(t);
      }

      var pk = _icl_phoneKey_(d.phone);
      var 열쇠 = d.name + "|" + (pk || "전화없음");
      if (!사람[열쇠]) {
        사람[열쇠] = {
          급함: 확실 ? "🔴" : "🟡",
          name: d.name, phone: d.phone,
          invs: [], items: [], dates: [], whats: [], asks: [], others: [], wheres: []
        };
        순서.push(열쇠);
      }
      var p = 사람[열쇠];
      if (확실) p.급함 = "🔴";            // 하나라도 확실이면 그 사람은 확실이다
      if (d.inv && p.invs.indexOf(d.inv) === -1) p.invs.push(d.inv);
      if (d.item && p.items.indexOf(d.item) === -1) p.items.push(d.item);
      if (d.date && p.dates.indexOf(d.date) === -1) p.dates.push(d.date);

      var w = _icl_what_(등급, d.reason);
      if (p.whats.indexOf(w) === -1) p.whats.push(w);
      var a = _icl_ask_(등급, d.reason);
      if (p.asks.indexOf(a) === -1) p.asks.push(a);
      for (var n = 0; n < 남들.length; n++) {
        if (p.others.indexOf(남들[n]) === -1) p.others.push(남들[n]);
      }
      var 자리 = d.where + (d.row ? " " + d.row + "행" : "");
      if (자리 && p.wheres.indexOf(자리) === -1) p.wheres.push(자리);
      담음++;
    }
  }

  /*  ── 3) 줄로 편다 ─────────────────────────────────────
      🔴 먼저, 그 안에서는 주문일이 «최근»인 것 먼저.
      오늘 나간 상자가 내일 전화가 된다.  */
  var rows = [];
  for (var s2 = 0; s2 < 순서.length; s2++) {
    var q = 사람[순서[s2]];
    q.최근 = q.dates.length ? q.dates.slice().sort().pop() : "";
    rows.push(q);
  }
  rows.sort(function (a2, b2) {
    if (a2.급함 !== b2.급함) return a2.급함 === "🔴" ? -1 : 1;
    if (a2.최근 !== b2.최근) return a2.최근 < b2.최근 ? 1 : -1;
    return a2.name < b2.name ? -1 : 1;
  });

  var out = [];
  var 확실수 = 0;
  for (var z = 0; z < rows.length; z++) {
    var q2 = rows[z];
    if (q2.급함 === "🔴") 확실수++;
    out.push([
      false,
      q2.급함,
      q2.name,
      q2.phone,
      q2.invs.length,
      q2.invs.join("\n"),
      q2.items.join("\n"),
      q2.dates.join("\n"),
      q2.whats.join("\n"),
      q2.asks.join("\n"),
      q2.others.slice(0, 6).join("\n") +
        (q2.others.length > 6 ? "\n… 외 " + (q2.others.length - 6) + "건" : ""),
      q2.wheres.slice(0, 6).join("\n")
    ]);
  }

  _icl_write_(ss, out);

  var lines = [];
  lines.push("📞 선제 연락 명단 (읽기 전용 — 아무것도 고치지 않았습니다)");
  lines.push("");
  lines.push("전화할 사람: " + rows.length + "명");
  lines.push("  🔴 먼저: " + 확실수 + "명 — 상자가 남에게 갔거나 지난 송장이 붙은 건");
  lines.push("  🟡 확인: " + (rows.length - 확실수) + "명 — 합배송 표시가 없는 건");
  lines.push("");
  lines.push("걸린 주장 " + 담음 + "건을 사람 단위로 접었습니다.");
  if (건너뜀) lines.push("이름이 없어 전화를 못 거는 " + 건너뜀 + "건은 뺐습니다.");
  lines.push("");
  lines.push("★ 「주인추정」은 주문일이 가장 이르다는 뜻일 뿐, 누구 상자인지는");
  lines.push("  단정하지 않았습니다. 통화에서 확인할 것을 J열에 적어 두었습니다.");
  lines.push("");
  lines.push("'" + _ICL_TAB_ + "' 탭 A열에 체크하며 진행하세요.");

  var msg = lines.join("\n");
  try { SpreadsheetApp.getUi().alert(msg); } catch (eU) {}
  return msg;
}

/** 🔴 만 담은 명단 — 오늘 안에 다 걸어야 할 때 */
function partnerBuildInvoiceCallListSureOnly() {
  return partnerBuildInvoiceCallList(false);
}

function _icl_write_(ss, rows) {
  var tab = ss.getSheetByName(_ICL_TAB_);
  if (!tab) tab = ss.insertSheet(_ICL_TAB_);
  tab.clear();
  try { tab.clearConditionalFormatRules(); } catch (e) {}

  var cols = _ICL_HEADERS_.length;
  tab.getRange(1, 1, 1, cols).setValues([_ICL_HEADERS_])
    .setFontWeight("bold").setBackground("#FDB813");
  tab.setFrozenRows(1);

  if (rows.length) {
    tab.getRange(2, 1, rows.length, cols).setValues(rows)
      .setVerticalAlignment("top").setWrap(true);
    tab.getRange(2, 1, rows.length, 1).insertCheckboxes();
  }

  var 너비 = [60, 50, 90, 110, 50, 130, 160, 95, 300, 280, 220, 150];
  for (var w = 0; w < 너비.length; w++) tab.setColumnWidth(w + 1, 너비[w]);

  /*  🔴 줄을 연분홍으로 — 위에서부터 훑을 때 어디까지가 급한지 보인다  */
  if (rows.length) {
    try {
      var rule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$B2="🔴"')
        .setBackground("#FCE8E6")
        .setRanges([tab.getRange(2, 1, rows.length, cols)])
        .build();
      tab.setConditionalFormatRules([rule]);
    } catch (eC) {}
  }

  try {
    tab.getRange(1, 1).setNote(
      "선제 연락 명단 · " +
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") + "\n" +
      "🧭 송장 소유권 점검 결과를 사람 단위로 접은 것입니다."
    );
  } catch (eN) {}
}
