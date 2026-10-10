/**
 * ══════════════════════════════════════════════════════════════
 *  출고 송장번호를 «로젠에서 직접» 받아 온다 — 붙여넣기를 없앤다
 *  파일: csLogenShipSlips.gs
 *
 *  > 사장님: "지우고 새로 붙여.. 자동으로 채우면 붙여넣기 안해도 돼"
 *
 *  ★ 여태 ★
 *    세트분리 → 「로젠택배_출력」 탭 → 사람이 로젠에 복붙 → 로젠이 송장 발급
 *    → **사람이 실적을 받아 「입력_로젠주문실적」 탭에 붙여넣음** → 허브가 걷어
 *    일일마감·원장으로 퍼뜨림.
 *
 *    그 마지막 붙여넣기를 안 하면 송장이 영영 안 붙는다. 실제로 그랬다 —
 *    09/12 동봉 44건이 며칠씩 「로젠 송장 대기」로 떠 있었다. 오류는 한 줄도
 *    안 난다. 안 한 줄 아무도 모른다.
 *
 *  ★ 이제 ★
 *    우리 주문번호로 로젠에 묻는다(`inquirySlipNoMulti`). 2026-10-08 운영계
 *    실호출로 확인했다 — 복붙으로 올린 건도 우리 주문번호로 **찾아진다**.
 *      2166312387 → 45303211446   (화면 453-0321-1446 과 같다)
 *      d1007000098 → 45324003760  (원장 운송장번호와 같다)
 *    (반품은 안 된다. 거기는 화면이 보여 줄 때만 이어 붙인다 — 규격서 §0)
 *
 *  ★ 지우지 않는다. 없는 것만 더한다 ★
 *    사장님은 「자동으로 채우면 붙여넣기 안 해도 된다」고 하셨지만, 그만두는
 *    날까지는 두 손이 같은 탭에 쓴다. 지우고 새로 쓰면 사람이 넣은 줄이
 *    날아가고, 통째로 덮으면 우리 줄이 날아간다. **이미 있는 주문번호는
 *    건드리지 않고 없는 것만 밑에 더한다.** 그러면 어느 쪽이 먼저 쓰든 안전하고,
 *    사람이 붙여넣기를 그만두면 저절로 우리가 주인이 된다.
 *
 *  ★ 자리표는 허브 것을 따른다 ★
 *    이 탭에는 **머리글이 없다**(1행부터 자료). 자리는 _partnerHelpers.gs 의
 *    _PT_ROZEN_FIXED_COL 이 정한다 — 2026-09-15 에 시트를 직접 열어 바로잡은
 *    기록이다. 프로젝트가 달라 그 상수를 못 부르니 여기 옮겨 적되, **어디서
 *    왔는지와 무엇을 같이 고쳐야 하는지를 적어 둔다**([[one-value-one-owner]]).
 * ══════════════════════════════════════════════════════════════
 */

/** 송장 시트 — csLotte.gs 의 _CS_TRADE_INVOICE_SS_ID_ 와 같은 시트다 */
var _SSL_TAB_ = "입력_로젠주문실적";

/**
 * 칸 자리 (0부터).  ★ 허브 _PT_ROZEN_FIXED_COL 과 «같아야» 한다 ★
 * 탭 양식이 바뀌면 여기와 _partnerHelpers.gs 를 **같이** 고친다.
 * 2026-09-15 에 「집하」 양식으로 바뀌어 허브가 송장을 0건 걷은 적이 있다.
 */
var _SSL_COL_ = {
  순번: 0,    // A
  구분: 1,    // B  「집하」
  일자: 2,    // C  집하일자
  거래처코드: 7,  // H
  거래처명: 8,    // I
  주문번호: 9,    // J  ← 허브가 이것으로 붙인다
  운송장: 10,     // K  ← 451-6945-9705 꼴 (하이픈 포함)
  수하인: 14      // O
};

/** 우리가 적은 줄이라는 표 — 사람이 넣은 줄과 구별된다 */
var _SSL_MARK_ = "API";

/** 최근 며칠 치 출고를 보나 */
var _SSL_DAYS_ = 4;

/** 한 번에 물어볼 주문 수 윗한도 */
var _SSL_MAX_ = 200;

/** 원장에서 뒤에서 몇 줄까지 훑나 */
var _SSL_SCAN_ROWS_ = 8000;

/**
 * 실적 탭에서 «뒤에서» 몇 줄까지 보고 겹침을 가리나.
 *
 * ★ 사람이 붙여넣기를 그만두면 이 탭은 끝없이 자란다 ★
 *   여태는 지우고 새로 붙였으니 작았다. 이제 더하기만 하므로 하루 천 줄씩
 *   쌓인다. 해마다 25만 줄이면 시트가 버티지 못하고, 겹침을 가리려고 그 열을
 *   통째로 읽는 일도 매시간 무거워진다.
 *
 *   우리가 묻는 것은 «최근 _SSL_DAYS_ 일» 치뿐이라, 그 줄들은 반드시 탭의
 *   끝 가까이에 있다. 그래서 뒤에서 이만큼만 봐도 겹침은 다 걸린다.
 *   (탭을 솎아 내는 일은 따로 정해야 한다 — 일일마감이 며칠 치를 거슬러
 *    보는지 모르는 채로 지우면 안 된다.)
 */
var _SSL_LOOKBACK_ROWS_ = 20000;

/**
 * 로젠에서 송장번호를 받아 「입력_로젠주문실적」 탭에 더한다.
 *
 * @param {Object} opt { days, dry }
 * @return {string} 할 일이 없으면 빈 글
 */
function csLogenCollectShipSlips(opt) {
  opt = opt || {};
  var days = opt.days > 0 ? opt.days : _SSL_DAYS_;
  var dry = !!opt.dry;
  var L = ["── 출고 송장 받아오기 (최근 " + days + "일" + (dry ? " · 연습" : "") + ") ──"];

  //  ① 원장에서 «로젠으로 나간» 주문을 모은다
  var 주문;
  try { 주문 = _ssl_ordersFromLedger_(days); }
  catch (e) { var m = "NG 원장을 못 읽었습니다: " + e.message; Logger.log(m); return m; }
  /*  ★ 조용히 넘어가지 않는다 ★  (2026-10-09 · csLogenOutStale.gs 와 같은 까닭)
      할 일이 없어서 안 쓰면, 보는 사람은 「안 돈 건가?」를 알 길이 없다.
      한 줄은 남긴다. 일감 보고에는 안 붙인다 — 매시간 같은 말이 쌓이면 안 읽힌다. */
  if (!주문.length) { _ssl_note_("최근 " + days + "일에 로젠 출고가 없습니다"); return ""; }

  //  ② 실적 탭에 «이미 있는» 주문번호를 뺀다
  var tab, 있는것;
  try {
    tab = _ssl_tab_();
    있는것 = _ssl_existingOrderNos_(tab);
  } catch (e) { var m2 = "NG 실적 탭을 못 열었습니다: " + e.message; Logger.log(m2); return m2; }

  var 물을것 = [];
  for (var i = 0; i < 주문.length; i++) {
    if (있는것[주문[i].uid]) continue;
    물을것.push(주문[i]);
    if (물을것.length >= _SSL_MAX_) break;
  }
  if (!물을것.length) {
    _ssl_note_("최근 " + days + "일 " + 주문.length + "건 — 모두 이미 붙어 있습니다");
    return "";
  }

  L.push("아직 송장이 없는 주문 " + 물을것.length + "건");
  if (dry) {
    for (var d0 = 0; d0 < Math.min(물을것.length, 10); d0++) {
      L.push("  (연습) " + 물을것[d0].uid + "  " + 물을것[d0].name);
    }
    var 끝0 = L.join("\n"); Logger.log(끝0); return 끝0;
  }

  //  ③ 로젠에 묻는다 — 10건씩, 사이를 쉬며 (로젠 요청)
  var 찾음 = _ssl_askMany_(물을것);

  //  ④ 없는 것만 밑에 더한다
  var 새줄 = [], 못찾음 = 0, 지워진것 = 0;
  for (var k = 0; k < 물을것.length; k++) {
    var it = 물을것[k];
    var slips = 찾음[it.uid];
    if (!slips) { 못찾음++; continue; }
    if (!slips.length) { 지워진것++; continue; }
    for (var s = 0; s < slips.length; s++) {
      새줄.push(_ssl_row_(it, slips[s]));
    }
  }

  if (새줄.length) {
    var 시작 = tab.getLastRow() + 1;
    tab.getRange(시작, 1, 새줄.length, 새줄[0].length).setValues(새줄);
  }

  L.push("더함 " + 새줄.length + "줄 · 아직 송장 없음 " + 못찾음 +
         (지워진것 ? " · 로젠에서 지워진 건 " + 지워진것 : ""));
  if (새줄.length) {
    L.push("허브 송장 수집이 돌면 일일마감·원장까지 퍼집니다.");
  }

  var 끝 = L.join("\n");
  Logger.log(끝);
  _ssl_note_("더함 " + 새줄.length + "줄 · 대기 " + 못찾음);
  return 끝;
}

/**
 * 이 줄이 «우리가 로젠으로 보낸» 건인가.
 *
 * ★ 갓 돌린 회차는 「택배사」가 비어 있다 ★  (2026-10-08 실측)
 *   261008-1 을 보니 169줄 모두 택배사·운송장·송장매칭이 빈칸이었다.
 *   그 칸들은 나중에 송장이 붙을 때 채워진다. 「택배사」로만 거르면
 *   **오늘 회차를 통째로 건너뛴다** — 정작 송장을 받아 와야 할 그 회차를.
 *
 *   세트분리가 돌 때 정해지는 것은 「경로」다. 그것을 먼저 본다.
 *     로젠택배 · 로젠택배-도서산간(…)  → 우리가 로젠으로 보낸다
 *     대리발송 · 합포장동봉 · 보류      → 아니다 (제 송장이 없다)
 *   경로가 비어 있는 옛 줄을 위해 택배사도 같이 본다.
 */
function _ls_isLogenRow_(경로, 택배사) {
  var p = String(경로 || "").trim();
  if (p) return p.indexOf("로젠택배") === 0;
  return String(택배사 || "").indexOf("로젠") !== -1;
}

/** 운영점검 탭에 한 줄 — 할 일이 없을 때도 남긴다(그래야 돌았는지 안다) */
function _ssl_note_(글) {
  try {
    _cpr_ops_(SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_), "출고 송장 받아오기", 글);
  } catch (e) {}
}

/** 실적 탭 */
function _ssl_tab_() {
  var ss = SpreadsheetApp.openById(_CS_TRADE_INVOICE_SS_ID_);
  var tab = ss.getSheetByName(_SSL_TAB_);
  if (!tab) throw new Error("「" + _SSL_TAB_ + "」 탭이 없습니다");
  return tab;
}

/**
 * 탭에 이미 있는 주문번호.
 * ★ 머리글이 없다 ★ 1행부터 자료다 — 첫 줄을 건너뛰면 한 건을 놓친다.
 */
function _ssl_existingOrderNos_(tab) {
  var out = {};
  var last = tab.getLastRow();
  if (last < 1) return out;
  //  뒤에서만 본다 — 왜 그래도 되는지는 _SSL_LOOKBACK_ROWS_ 머리말에
  var from = Math.max(1, last - _SSL_LOOKBACK_ROWS_ + 1);
  var 값 = tab.getRange(from, _SSL_COL_.주문번호 + 1, last - from + 1, 1).getDisplayValues();
  for (var i = 0; i < 값.length; i++) {
    var v = String(값[i][0] || "").trim();
    if (v) out[v] = true;
  }
  return out;
}

/** 원장에서 로젠으로 나간 주문 (주문번호 기준으로 한 번씩) */
function _ssl_ordersFromLedger_(days) {
  var ss = SpreadsheetApp.openById(_CS_LEDGER_SS_ID_);
  var tab = ss.getSheetByName("주문라인원장");
  if (!tab) throw new Error("「주문라인원장」 탭이 없습니다");

  var lastRow = tab.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = tab.getLastColumn();

  var head = tab.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var c = {};
  for (var h = 0; h < head.length; h++) {
    var nm = String(head[h] || "").trim();
    if (nm === "회차키") c.round = h;
    else if (nm === "운송장번호") c.inv = h;
    else if (nm === "택배사") c.carrier = h;
    else if (nm === "경로") c.path = h;
    else if (nm === "거래처명") c.name = h;
    else if (nm === "사방넷주문번호") c.uid = h;
    else if (nm === "송장키") c.key = h;
  }
  if (c.key == null && c.uid == null) throw new Error("송장키·사방넷주문번호 열을 못 찾았습니다");
  if (c.round == null) throw new Error("회차키 열을 못 찾았습니다");

  var 오늘 = new Date(); 오늘.setHours(0, 0, 0, 0);
  var from = Math.max(2, lastRow - _SSL_SCAN_ROWS_ + 1);
  var 값 = tab.getRange(from, 1, lastRow - from + 1, lastCol).getDisplayValues();

  var 본것 = {}, out = [];
  for (var i = 값.length - 1; i >= 0; i--) {
    var r = 값[i];
    if (!_ls_isLogenRow_(c.path != null ? r[c.path] : "",
                         c.carrier != null ? r[c.carrier] : "")) continue;

    /*  ★ 로젠에 올라간 번호는 «송장키» 다 ★  (2026-10-08 실측)
        세트(몸통+뚜껑)는 박스마다 송장이 한 장씩 붙어야 해서 꼬리표가 붙는다 —
        2167009863 하나가 로젠에는 2167009863_S1 · _S2 로 들어간다.
        사방넷주문번호로 물으면 **「송장번호 조회 실패」** 가 온다. 실제로 그랬다:
          2167009863     → 없음
          2167009863_S1  → 45326800971, 45326800982
          2167009863_S2  → 45326800993, 45326801004
        261008-1 에서 못 찾은 21건이 «전부» 세트였다. 송장키로 물으면 다 나온다.

        ★ 그래서 주문이 아니라 «줄»마다 묻는다 ★ 세트는 한 주문이 두 줄이고
        줄마다 송장이 따로다. 주문으로 묶으면 한쪽을 잃는다. */
    var uid = String(c.key != null ? (r[c.key] || "") : "").trim();
    if (!uid) uid = String(c.uid != null ? (r[c.uid] || "") : "").trim();
    if (!uid || 본것[uid]) continue;      // 같은 송장키가 여러 줄 — 한 번만 묻는다
    본것[uid] = true;

    var 발송 = _ost_roundDate_(r[c.round]);
    if (!발송) continue;
    var 지난 = Math.floor((오늘 - 발송) / 86400000);
    if (지난 < 0 || 지난 > days) continue;

    out.push({ uid: uid, ymd: _ssl_ymd_(발송),
               name: c.name != null ? String(r[c.name] || "").trim() : "" });
  }
  return out;
}

/**
 * 로젠에 주문번호로 묻는다 — 10건씩, 호출 사이를 쉬며.
 *
 * @return {Object} uid → [송장번호 …]   (못 물은 uid 는 아예 없다)
 */
function _ssl_askMany_(items) {
  var out = {};
  var 시작 = new Date().getTime();

  for (var s = 0; s < items.length; s += _LOGEN_BATCH_SIZE_) {
    if (s > 0) {
      if ((new Date().getTime() - 시작) > _LOGEN_TIME_BUDGET_MS_) break;  // 남은 건 다음 시간에
      Utilities.sleep(_LOGEN_BATCH_DELAY_MS_);
    }
    var chunk = items.slice(s, s + _LOGEN_BATCH_SIZE_);
    var data = [];
    for (var i = 0; i < chunk.length; i++) {
      data.push({ custCd: _logen_custCd_(), fixTakeNo: chunk[i].uid });
    }

    var r = _logen_call_("inquirySlipNoMulti", { userId: _logen_userId_(), data: data });
    if (!r.ok) continue;                       // 못 물었다 — 다음 시간에 또 본다

    var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
    for (var k = 0; k < rows.length; k++) {
      var d = rows[k] || {};
      var uid = String(d.fixTakeNo || "").trim();
      if (!uid) continue;
      if (!_logen_ok_(d.resultCd)) continue;    // 아직 송장이 안 나왔다

      var 송장 = [];
      var inner = _logen_arr_(d.data1);
      for (var j = 0; j < inner.length; j++) {
        var one = inner[j] || {};
        /*  ★ 지워진 송장은 안 적는다 ★ 로젠에서 취소·삭제된 건이다.
            적으면 일일마감이 없는 송장을 쫓는다. */
        if (String(one.delYn || "").toUpperCase() === "Y") continue;
        var no = String(one.slipNo || "").replace(/[^0-9]/g, "");
        if (no) 송장.push(no);
      }
      out[uid] = 송장;      // 빈 배열이면 「있었는데 다 지워졌다」는 뜻
    }
  }
  return out;
}

/** 탭에 넣을 한 줄 — 허브가 읽는 칸만 채운다 */
function _ssl_row_(it, 송장) {
  var row = [];
  for (var i = 0; i <= _SSL_COL_.수하인; i++) row.push("");
  row[_SSL_COL_.구분] = "집하";
  row[_SSL_COL_.일자] = _ssl_dash_(it.ymd);
  row[_SSL_COL_.거래처코드] = _logen_custCd_();
  row[_SSL_COL_.거래처명] = _SSL_MARK_;        // 사람이 넣은 줄과 구별된다
  row[_SSL_COL_.주문번호] = it.uid;
  row[_SSL_COL_.운송장] = _ost_pretty_(송장);   // 451-6945-9705 꼴 (3-4-4)
  row[_SSL_COL_.수하인] = it.name;
  return row;
}

/** Date → 「yyyyMMdd」 */
function _ssl_ymd_(d) { return Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd"); }

/** 「20261008」 → 「2026-10-08」 (탭의 집하일자 모양) */
function _ssl_dash_(ymd) {
  var s = String(ymd || "");
  return s.length === 8 ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6) : s;
}

/** 손으로 돌려 보는 용 — 무엇을 물을지만 보고 적지는 않는다 */
function csLogenShipSlipsPreview() {
  var 글 = csLogenCollectShipSlips({ dry: true });
  Logger.log(글);
  return 글;
}
