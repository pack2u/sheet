/**
 * ══════════════════════════════════════════════════════════════
 *  중복 발주 점검 — 같은 주문이 두 차수에 걸쳐 들어왔는가
 *  파일: _partnerDupOrderCheck.gs
 *  대상: 상품정보 시트 「대리공급_임시기록」
 *
 *  ★ 차수 도장이 생겨서 가능해진 점검이다 ★
 *    B열에 "0901-1" 처럼 회차가 찍히기 전에는, 임시기록에 같은 주문이
 *    두 줄 있어도 그게 "한 번의 푸시가 두 줄 쓴 것"인지 "오전·오후에
 *    각각 들어온 것"인지 구분할 수 없었다. 이제 구분된다.
 *
 *  ★ 왜 자동으로 막지 않고 알리기만 하나 ★
 *    같은 사람이 같은 품목을 하루에 두 번 주문하는 일은 실제로 있다
 *    (추가 주문·수량 정정). 기계가 지워 버리면 진짜 주문이 사라진다.
 *    사라진 주문은 아무도 모르지만, 중복 발주는 물건이 두 번 나가서
 *    바로 드러난다. 그래서 판단은 사람에게 남긴다.
 *
 *  ★ 판정 두 단계 ★
 *    확실 — 사방넷주문번호·품목코드·품목명이 모두 같은 줄이 2개 이상.
 *           같은 소스 주문이 두 번 푸시된 것이다. 변명의 여지가 없다.
 *           품목이 다르면 세트(몸통·뚜껑)라 중복이 아니다 — 안 잡는다.
 *    의심 — 주문번호는 다른데 수취인·전화·품목코드가 같고 차수가 다름.
 *           표기 차이로 고유ID가 갈려 중복 판정을 빠져나간 경우다.
 *           진짜 추가 주문일 수도 있으니 사람이 봐야 한다.
 * ══════════════════════════════════════════════════════════════
 */

/** 임시기록 열 (0-based) — _PEP_NON_PARTNER_TEMP_HEADERS_ 와 짝이다 */
var _PDC_C_ROUND_ = 1;    // B 회차 도장 (0901-1)
var _PDC_C_DATE_ = 2;     // C 일자-No.
var _PDC_C_CODE_ = 3;     // D 품목코드
var _PDC_C_ITEM_ = 4;     // E 품목명
var _PDC_C_QTY_ = 6;      // G 수량
var _PDC_C_PHONE_ = 7;    // H 전화
var _PDC_C_NAME_ = 12;    // M 거래처명(실제로는 수취인)
var _PDC_C_ORDERNO_ = 15; // P 사방넷주문번호
var _PDC_C_VENDOR_ = 22;  // W 업체prefix
var _PDC_C_INV_ = 23;     // X 송장번호

/* ══════════════════════════════════════════════════════════════
 *  ★ 이미 말한 건은 다시 말하지 않는다 ★  (2026-09-17)
 *
 *  > "이건 며칠전껀데 계속뜨네"
 *
 *  이 점검은 푸시가 끝날 때마다 «처음부터 다시» 세어 알렸다. 날짜도
 *  기억도 없어서, 한 번 난 「더 나간 발주」는 치울 때까지 날마다 같은
 *  얼굴로 다시 왔다.
 *
 *  ★ 왜 그냥 두면 안 되나 ★
 *    같은 경고가 날마다 오면 사람은 그 카드를 안 읽게 된다. 그러면
 *    «다음에 진짜가 왔을 때»도 같이 흘려보낸다. 경고가 스스로를 죽인다.
 *
 *  ★ 그렇다고 지우지도 않는다 ★
 *    새것이 없으면 카드를 안 띄우되, 새것이 있을 때 그 카드에
 *    「아직 안 치운 옛 건 N건」을 한 줄 붙인다. 잊히지 않는다.
 *    메뉴 [🔁 중복 발주 점검] 은 여전히 «전부» 보여 준다.
 * ══════════════════════════════════════════════════════════════ */
var _PDC_SEEN_PROP_ = "_PDC_SEEN_V1";
var _PDC_SEEN_DAYS_ = 30;   // 이만큼 지나면 다시 한 번 말한다 (영영 묻히지 않게)

/** 이미 말한 열쇠들 — { 열쇠: "yyyy-MM-dd" } */
function _pdc_loadSeen_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(_PDC_SEEN_PROP_);
    if (!raw) return {};
    var o = JSON.parse(raw);
    return (o && typeof o === "object") ? o : {};
  } catch (e) {
    Logger.log("[DUP] 말한 목록을 못 읽었습니다(무시하고 계속): " + e.message);
    return {};
  }
}

/**
 * 오래된 것을 버리고 저장한다.
 * ★ 안 버리면 속성이 9KB 한도에 걸려 «통째로» 저장이 안 된다 —
 *   그러면 어느 날부터 조용히 다시 매일 알리기 시작한다.
 */
function _pdc_saveSeen_(seen) {
  var 한도 = new Date();
  한도.setDate(한도.getDate() - _PDC_SEEN_DAYS_);
  var 한도키 = Utilities.formatDate(한도, "Asia/Seoul", "yyyy-MM-dd");
  var out = {}, 남은 = 0;
  for (var k in seen) {
    if (!Object.prototype.hasOwnProperty.call(seen, k)) continue;
    if (String(seen[k] || "") >= 한도키) { out[k] = seen[k]; 남은++; }
  }
  try {
    PropertiesService.getScriptProperties().setProperty(_PDC_SEEN_PROP_, JSON.stringify(out));
  } catch (e) {
    Logger.log("[DUP] 말한 목록 저장 실패 — 다음에 또 알릴 수 있습니다: " + e.message);
  }
  return 남은;
}

/**
 * 말할 것과 이미 말한 것을 가른다.
 * @param {Array} items  알림 후보
 * @param {Function} keyOf  항목 → 열쇠 (내용이 바뀌면 열쇠도 바뀌어야 한다)
 * @param {Object} seen  _pdc_loadSeen_() 결과 (여기에 새 열쇠를 적어 넣는다)
 * @return {{새것: Array, 옛것: number}}
 */
function _pdc_splitNew_(items, keyOf, seen) {
  var 오늘 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  var out = { 새것: [], 옛것: 0 };
  for (var i = 0; i < items.length; i++) {
    var k = keyOf(items[i]);
    if (!k) { out.새것.push(items[i]); continue; }   // 열쇠를 못 만들면 말한다
    if (seen[k]) { out.옛것++; continue; }
    seen[k] = 오늘;
    out.새것.push(items[i]);
  }
  return out;
}

function _pdc_digits_(v) {
  return String(v == null ? "" : v).replace(/[^0-9]/g, "");
}

function _pdc_key_(v) {
  return String(v == null ? "" : v).replace(/\s/g, "").trim().toUpperCase();
}

/**
 * 임시기록을 훑어 중복 후보를 모은다. 읽기만 한다.
 * @return {{ok:boolean, sure:Array, maybe:Array, rows:number, error:string}}
 */
function _pdc_scan_() {
  var out = { ok: false, sure: [], maybe: [], rows: 0, error: "" };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tab = ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_);
    if (!tab) { out.error = "임시기록 탭을 찾을 수 없습니다."; return out; }

    var lr = tab.getLastRow();
    if (lr < 2) { out.ok = true; return out; }
    var lc = Math.max(tab.getLastColumn(), _PDC_C_INV_ + 1);
    var data = tab.getRange(2, 1, lr - 1, lc).getDisplayValues();
    out.rows = data.length;

    var byOrder = {};   // 사방넷주문번호 → [행정보]
    var byPerson = {};  // 수취인+전화+품목코드 → [행정보]

    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var name = String(r[_PDC_C_NAME_] || "").trim();
      var code = String(r[_PDC_C_CODE_] || "").trim();
      if (!name && !code) continue; // 빈 행

      var info = {
        row: i + 2,
        round: String(r[_PDC_C_ROUND_] || "").trim(),
        date: String(r[_PDC_C_DATE_] || "").trim(),
        code: code,
        item: String(r[_PDC_C_ITEM_] || "").trim(),
        qty: String(r[_PDC_C_QTY_] || "").trim(),
        name: name,
        phone: _pdc_digits_(r[_PDC_C_PHONE_]),
        orderNo: String(r[_PDC_C_ORDERNO_] || "").trim(),
        vendor: String(r[_PDC_C_VENDOR_] || "").trim(),
        inv: String(r[_PDC_C_INV_] || "").trim()
      };

      // ★ 2026-09-07: 주문번호만으로 묶지 않는다 ★
      //   세트 상품은 몸통과 뚜껑이 따로 나가서, 한 주문번호에 품목이
      //   다른 줄이 여럿 생긴다. 그건 중복이 아니라 정상이다.
      //   주문번호·품목코드·품목명이 모두 같을 때만 같은 건으로 본다.
      if (info.orderNo) {
        var ok2 = info.orderNo + "|" + _pdc_key_(code) + "|" + _pdc_key_(info.item);
        (byOrder[ok2] = byOrder[ok2] || []).push(info);
      }
      var pk = _pdc_key_(name) + "|" + info.phone + "|" + _pdc_key_(code);
      (byPerson[pk] = byPerson[pk] || []).push(info);
    }

    // ── 확실: 주문번호+품목이 같은 줄이 2개 이상 (세트는 품목이 달라 안 걸린다) ──
    var sureRows = {};
    for (var o in byOrder) {
      var g = byOrder[o];
      if (g.length < 2) continue;
      out.sure.push({ key: g[0].orderNo, hits: g });
      for (var s = 0; s < g.length; s++) sureRows[g[s].row] = true;
    }

    // ── 의심: 사람+품목이 같은데 주문번호가 다르고 차수도 다름 ──
    for (var p in byPerson) {
      var gp = byPerson[p];
      if (gp.length < 2) continue;
      // 확실 판정에 이미 잡힌 건은 중복해서 보고하지 않는다
      var allSure = true;
      for (var q = 0; q < gp.length; q++) { if (!sureRows[gp[q].row]) { allSure = false; break; } }
      if (allSure) continue;
      // 차수가 전부 같으면 한 번의 푸시가 만든 정상 다건일 수 있다
      var rounds = {};
      for (var w = 0; w < gp.length; w++) rounds[gp[w].round || "(없음)"] = true;
      if (Object.keys(rounds).length < 2) continue;
      out.maybe.push({ key: gp[0].name + " / " + gp[0].code, hits: gp });
    }

    out.ok = true;
    return out;
  } catch (e) {
    out.error = e.message;
    return out;
  }
}

function _pdc_lineOf_(h) {
  return "      [" + (h.round || "차수없음") + "] " + h.name +
    " · " + h.item + " ×" + h.qty +
    " · " + (h.vendor || "-") +
    (h.inv ? " · 송장 " + h.inv : " · 송장없음") +
    "  (" + h.row + "행)";
}


/* ═══════════════════════════════════════════════════════════════
 *  전용양식 대조 — «물건이 나간 자리»를 본다  (2026-09-14)
 *
 *  > "중복검사를 통과한것도 문제네"
 *
 *  ★ 왜 여태 못 잡았나 ★
 *    위 _pdc_scan_ 은 대리공급_임시기록만 읽는다. 「확실」 판정은
 *    주문번호·품목코드·품목명이 같은 줄이 «2개 이상» 일 때인데,
 *    임시기록에 쓰는 쪽(_pep_appendToNonPartnerTempTab_)이 이미
 *    고유ID+품목코드로 접어 두 줄이 생길 수가 없다.
 *    켜질 수 없는 가지였다.
 *
 *    2026-09-10 아주팩 이지원 건이 그래서 그냥 지나갔다 —
 *    임시기록 2줄(몸통·뚜껑), 전용양식 6줄, 물건 6번.
 *    두 자리 중 «접히는 쪽»만 보고 있었다.
 *
 *  ★ 그래서 양쪽을 맞대 본다 ★
 *    기대 = 임시기록(+보관)에서 그 고유ID의 «품목코드 가짓수»
 *    실제 = 업체 파일 전용양식 AX열 + 당월·전월 마감탭의 그 고유ID 줄 수
 *    실제 > 기대 면 그만큼 더 나간 것이다.
 *
 *    세트는 몸통·뚜껑이라 기대 2, 실제 2 → 조용하다.
 *    같은 줄이 세 벌이면 기대 2, 실제 6 → 4줄 초과로 잡힌다.
 *
 *  ★ 아무것도 안 쓴다 ★
 *    _pep_initVendorCache_ 와 _pep_loadExclusiveDedupCounts_ 는 칸을
 *    만들고 수식을 지운다. 점검이 업체 파일을 고치면 안 되므로 쓰지 않고,
 *    읽기만 하는 것을 따로 둔다. 50열이 없으면 «없는 대로» 둔다.
 *
 *  ★ 임시기록에 있는 고유ID만 본다 ★
 *    임시기록+보관은 대략 14일치, 전용양식·마감탭은 당월+전월이다.
 *    범위가 달라 전체를 맞대면 옛 주문이 전부 「초과」로 뜬다.
 *    최근에 들어온 고유ID로 한정하면 그 어긋남이 사라진다.
 * ═══════════════════════════════════════════════════════════════ */

var _PDC_ARCH_OFF_ = 2;      // 보관탭 앞 두 칸 (보관일시·보관사유)
var _PDC_AX_COL_ = 50;       // 전용양식 고유ID 열 (AX)
var _PDC_BUDGET_MS_ = 90000; // 업체 파일 열기에 쓸 시간 한도

/** 전용양식 탭을 «찾기만» 한다 — 없어도 만들지 않는다 */
function _pdc_findFormTab_(ss) {
  var tab = null;
  try { tab = ss.getSheetByName("전용양식"); } catch (_) {}
  if (tab) return tab;
  try {
    var tabs = ss.getSheets();
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getName().indexOf("전용양식") !== -1) return tabs[i];
    }
  } catch (_) {}
  return null;
}

/** 전용양식 AX(50열) 고유ID별 줄 수 — 읽기만 한다 */
function _pdc_axCounts_(tab) {
  var counts = { _ok: false };
  if (!tab || tab.getLastRow() < 2) { counts._ok = true; return counts; }
  //  칸이 모자라면 «만들지 않고» 못 봤다고 말한다
  if (tab.getLastColumn() < _PDC_AX_COL_) return counts;
  try {
    var vals = tab.getRange(2, _PDC_AX_COL_, tab.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var key = _pep_dedupKey_(vals[i][0], "");
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    counts._ok = true;
  } catch (_) {}
  return counts;
}

/**
 * 임시기록 + 보관 을 훑어 고유ID별 «기대 줄 수»(품목코드 가짓수)를 만든다.
 * @return {{byPfx:Object, rows:number, archRows:number}}
 *         byPfx[업체prefix][고유ID키] = { codes:{}, info:{...} }
 */
function _pdc_expectedByVendor_(ss) {
  var byPfx = {}, rows = 0, archRows = 0;

  function 훑기(tab, off, 보관인가) {
    if (!tab || tab.getLastRow() < 2) return 0;
    var need = Math.max(_PDC_C_INV_, _PDC_C_VENDOR_, _PDC_C_ORDERNO_) + off + 1;
    var lc = Math.max(tab.getLastColumn(), need);
    var data = tab.getRange(2, 1, tab.getLastRow() - 1, lc).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var uid = String(r[_PDC_C_ORDERNO_ + off] || "").trim();
      var code = _pdc_key_(r[_PDC_C_CODE_ + off]);
      if (!uid || !code) continue;
      var key = _pep_dedupKey_(uid, "");
      if (!key) continue;
      var pfx = String(r[_PDC_C_VENDOR_ + off] || "").trim().toUpperCase();
      if (!pfx) continue;
      var box = byPfx[pfx] || (byPfx[pfx] = {});
      var ent = box[key] || (box[key] = { codes: {}, uid: uid, hits: [] });
      ent.codes[code] = true;
      if (ent.hits.length < 6) {
        ent.hits.push({
          row: i + 2, 보관: 보관인가,
          round: String(r[_PDC_C_ROUND_ + off] || "").trim(),
          date: String(r[_PDC_C_DATE_ + off] || "").trim(),
          code: code,
          item: String(r[_PDC_C_ITEM_ + off] || "").trim(),
          name: String(r[_PDC_C_NAME_ + off] || "").trim(),
          qty: String(r[_PDC_C_QTY_ + off] || "").trim(),
          vendor: pfx,
          inv: String(r[_PDC_C_INV_ + off] || "").trim(),
        });
      }
    }
    return data.length;
  }

  try { rows = 훑기(ss.getSheetByName(_PEP_NON_PARTNER_TEMP_TAB_NAME_), 0, false); } catch (_) {}
  try {
    var at = (typeof _po_getTempArchiveTab_ === "function") ? _po_getTempArchiveTab_(ss) : null;
    archRows = 훑기(at, _PDC_ARCH_OFF_, true);
  } catch (_) {}
  return { byPfx: byPfx, rows: rows, archRows: archRows };
}

/**
 * 전용양식·마감탭과 맞대 본다. 읽기만 한다.
 * @return {{ok:boolean, over:Array, vendors:number, noAx:Array, skipped:Array, error:string}}
 */
function _pdc_scanExclusive_(opt_budgetMs) {
  var out = { ok: false, over: [], vendors: 0, noAx: [], skipped: [], error: "",
    rows: 0, archRows: 0 };
  var 시작 = new Date().getTime();
  var 예산 = opt_budgetMs || _PDC_BUDGET_MS_;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var exp = _pdc_expectedByVendor_(ss);
    out.rows = exp.rows; out.archRows = exp.archRows;

    var files = [];
    try { files = _pt_listFiles() || []; }
    catch (e) { out.error = "업체 파일 목록: " + e.message; return out; }
    var map = _pep_buildPrefixToFileMap_(files);

    for (var pfx in exp.byPfx) {
      if (!Object.prototype.hasOwnProperty.call(exp.byPfx, pfx)) continue;
      if (new Date().getTime() - 시작 > 예산) { out.skipped.push(pfx); continue; }
      var fi = map[pfx];
      if (!fi) continue;               // 비협력업체 — 전용양식이 없다
      var vss = null;
      try { vss = SpreadsheetApp.openById(fi.id); } catch (e) { out.skipped.push(pfx); continue; }
      out.vendors++;

      var ax = _pdc_axCounts_(_pdc_findFormTab_(vss));
      if (!ax._ok) out.noAx.push(pfx);
      var arch = {};
      try { arch = _pep_loadArchiveDedupCounts_(vss) || {}; } catch (_) {}

      var 초과들 = _pdc_overOf_(exp.byPfx[pfx], ax, arch);
      for (var oi = 0; oi < 초과들.length; oi++) {
        초과들[oi].vendor = pfx;
        초과들[oi].파일 = String(fi.name || "").replace("[협력업체] ", "");
        out.over.push(초과들[oi]);
      }
    }
    out.over.sort(function (a, b) { return b.초과 - a.초과; });
    out.ok = true;
    return out;
  } catch (e) {
    out.error = e.message;
    return out;
  }
}

/**
 * 기대(임시기록의 품목코드 가짓수)와 실제(전용양식 + 마감탭 줄 수)를 맞댄다.
 *
 * 시트를 안 만진다 — 받은 것만 보고 센다. 그래야 시험할 수 있다.
 *
 * @param {Object} box   고유ID키 → { codes:{코드:true}, uid, hits }
 * @param {Object} ax    고유ID키 → 전용양식 줄 수
 * @param {Object} arch  고유ID키 → 마감탭 줄 수
 * @return {Array} 초과분만
 */
function _pdc_overOf_(box, ax, arch) {
  var out = [];
  if (!box) return out;
  ax = ax || {}; arch = arch || {};
  for (var key in box) {
    if (!Object.prototype.hasOwnProperty.call(box, key)) continue;
    var 기대 = 0;
    for (var c in box[key].codes) {
      if (Object.prototype.hasOwnProperty.call(box[key].codes, c)) 기대++;
    }
    /* 세트는 몸통·뚜껑이라 기대 2 · 실제 2 → 조용하다.
       같은 줄이 세 벌이면 기대 2 · 실제 6 → 4줄 초과로 잡힌다.
       실제가 기대보다 «적은» 것은 안 잡는다 — 아직 안 나갔거나
       업체가 손으로 지운 것이고, 그건 중복 발주가 아니다. */
    var 실제 = (ax[key] || 0) + (arch[key] || 0);
    if (실제 <= 기대) continue;
    out.push({ uid: box[key].uid, 기대: 기대, 실제: 실제,
      초과: 실제 - 기대, hits: box[key].hits || [] });
  }
  return out;
}

/** 전용양식 초과 한 건을 사람이 읽을 줄로 */
function _pdc_overLineOf_(o) {
  var L = ["    [" + o.vendor + "] 주문 " + o.uid +
    " — 나간 줄 " + o.실제 + " / 있어야 할 줄 " + o.기대 +
    "  → ★ " + o.초과 + "줄 더 나갔습니다"];
  for (var i = 0; i < o.hits.length; i++) {
    var h = o.hits[i];
    L.push("        " + (h.보관 ? "(보관) " : "") + "[" + (h.round || "차수없음") + "] " +
      h.name + " · " + h.item + " ×" + h.qty + " · " + h.code);
  }
  return L.join("\n");
}

/**
 * [메뉴/편집기] 중복 발주 점검 — 읽기만 한다.
 * 파일: _partnerDupOrderCheck.gs
 */
function partnerCheckDuplicateOrders() {
  var res = _pdc_scan_();
  //  «물건이 나간 자리»도 본다. 임시기록만 보면 접힌 뒤라 못 본다.
  var ex = _pdc_scanExclusive_();
  var L = ["═══ 중복 발주 점검 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") +
    " · 대리공급_임시기록 " + res.rows + "행" +
    (ex.ok ? " · 전용양식 대조 업체 " + ex.vendors + "곳" : ""), ""];

  //  ── 전용양식 대조 — 실제로 몇 줄이 나갔나 ──
  if (!ex.ok) {
    L.push("⚠ 전용양식 대조 실패: " + ex.error);
    L.push("");
  } else if (ex.over.length) {
    L.push("★★ 더 나간 발주 — 전용양식에 있어야 할 줄보다 많습니다 (" + ex.over.length + "건)");
    L.push("   임시기록은 고유ID+품목코드로 접히므로 여기서만 보입니다.");
    for (var v = 0; v < Math.min(ex.over.length, 20); v++) {
      L.push(_pdc_overLineOf_(ex.over[v]));
    }
    if (ex.over.length > 20) L.push("    … 외 " + (ex.over.length - 20) + "건");
    L.push("");
  } else {
    L.push("✔ 전용양식 대조 — 더 나간 발주 없음 (업체 " + ex.vendors + "곳)");
    L.push("");
  }
  if (ex.noAx.length) {
    L.push("※ 전용양식에 고유ID(AX) 칸이 없어 못 본 업체: " + ex.noAx.join(", "));
  }
  if (ex.skipped.length) {
    L.push("※ 시간이 모자라 못 본 업체: " + ex.skipped.join(", ") + " — 다시 실행하면 이어서 봅니다.");
  }

  if (!res.ok) {
    L.push("★ 실패: " + res.error);
  } else if (!res.sure.length && !res.maybe.length) {
    L.push("✔ 중복 의심 건이 없습니다.");
  } else {
    if (res.sure.length) {
      L.push("★ 확실 — 같은 주문번호·같은 품목이 두 번 들어왔습니다 (" + res.sure.length + "건)");
      for (var i = 0; i < Math.min(res.sure.length, 20); i++) {
        L.push("    주문번호 " + res.sure[i].key);
        for (var j = 0; j < res.sure[i].hits.length; j++) {
          L.push(_pdc_lineOf_(res.sure[i].hits[j]));
        }
      }
      if (res.sure.length > 20) L.push("    … 외 " + (res.sure.length - 20) + "건");
      L.push("");
    }
    if (res.maybe.length) {
      L.push("⚠ 의심 — 같은 사람·같은 품목이 다른 차수에 들어왔습니다 (" + res.maybe.length + "건)");
      L.push("   추가 주문일 수도 있으니 확인 후 판단하세요.");
      for (var m = 0; m < Math.min(res.maybe.length, 20); m++) {
        L.push("    " + res.maybe[m].key);
        for (var k = 0; k < res.maybe[m].hits.length; k++) {
          L.push(_pdc_lineOf_(res.maybe[m].hits[k]));
        }
      }
      if (res.maybe.length > 20) L.push("    … 외 " + (res.maybe.length - 20) + "건");
    }
  }

  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("중복 발주 점검", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}

/**
 * 푸시 직후 자동 점검. 확실 건이 있을 때만 알린다.
 *
 * 조용할 때 아무 말도 하지 않아야 알림이 신호로 남는다.
 * 실패해도 푸시를 막지 않는다 — 점검이 발주를 방해하면 본말전도다.
 */
function _pdc_checkAfterPush_() {
  try {
    var res = _pdc_scan_();
    /*  푸시 끝난 직후다. 업체 파일을 여는 값이 있으므로 시간을 넉넉히 안 준다 —
        점검이 푸시를 붙잡으면 본말전도다. 못 본 업체는 메뉴에서 다시 본다. */
    var ex = _pdc_scanExclusive_(45000);
    if (!res.ok) { Logger.log("[DUP] 점검 실패: " + res.error); return; }
    Logger.log("[DUP] 점검 " + res.rows + "행 — 확실 " + res.sure.length +
      " / 의심 " + res.maybe.length +
      " / 더 나간 발주 " + (ex.ok ? ex.over.length : "?"));

    /*  ★ 더 나간 발주가 먼저다 ★
        이건 «이미 물건이 나간» 것이라 되돌리려면 회수해야 한다.
        임시기록 쪽 의심보다 급하다. */
    /*  ★ 이미 말한 건은 다시 말하지 않는다 ★  (2026-09-17)
        > "이건 며칠전껀데 계속뜨네"
        열쇠에 «초과 줄 수»를 넣는다 — 같은 주문이라도 더 나갔으면 새 사실이다. */
    var seen = _pdc_loadSeen_();

    if (ex.ok && ex.over.length) {
      var 갈림 = _pdc_splitNew_(ex.over, function (o) {
        return "OVER|" + o.vendor + "|" + o.uid + "|" + o.초과;
      }, seen);

      if (갈림.새것.length) {
        var oL = ["🚨 더 나간 발주 " + 갈림.새것.length + "건",
          "전용양식에 있어야 할 줄보다 많이 나갔습니다 — 물건이 더 나갔을 수 있습니다.", ""];
        for (var oi = 0; oi < Math.min(갈림.새것.length, 5); oi++) {
          var o = 갈림.새것[oi];
          oL.push("· [" + o.vendor + "] " + (o.hits[0] ? o.hits[0].name : "") +
            " / 주문 " + o.uid + " — " + o.실제 + "줄 나감 (있어야 할 줄 " + o.기대 + ") ★ " + o.초과 + "줄 초과");
        }
        if (갈림.새것.length > 5) oL.push("… 외 " + (갈림.새것.length - 5) + "건");
        /*  옛 건을 «지우지는» 않는다. 새것이 있을 때 한 줄로 같이 짚어 준다 —
            그래야 안 치운 것이 잊히지 않는다. */
        if (갈림.옛것) oL.push("(전에 알린 뒤 아직 안 치운 건 " + 갈림.옛것 + "건이 더 있습니다)");
        oL.push("");
        oL.push("확인: 메뉴 [🔁 중복 발주 점검] — partnerCheckDuplicateOrders");
        try { _chat_sendText_(oL.join("\n")); } catch (eO) {}
      } else if (갈림.옛것) {
        Logger.log("[DUP] 더 나간 발주 " + 갈림.옛것 + "건 — 전부 전에 알린 것이라 조용히 넘어갑니다");
      }
    }

    var 의심갈림 = _pdc_splitNew_(res.sure, function (s) {
      var 차수 = [];
      for (var z = 0; z < s.hits.length; z++) 차수.push(s.hits[z].round || "?");
      return "DUP|" + s.key + "|" + 차수.sort().join(",");
    }, seen);

    if (의심갈림.새것.length) {
      var lines = ["⚠️ 중복 발주 의심 " + 의심갈림.새것.length + "건",
        "같은 주문번호·같은 품목이 두 차수에 들어왔습니다.", ""];
      for (var i = 0; i < Math.min(의심갈림.새것.length, 5); i++) {
        var g = 의심갈림.새것[i].hits;
        var rounds = [];
        for (var j = 0; j < g.length; j++) rounds.push(g[j].round || "?");
        lines.push("· " + g[0].name + " / " + g[0].item +
          " — 차수 " + rounds.join(", ") + " (주문 " + 의심갈림.새것[i].key + ")");
      }
      if (의심갈림.새것.length > 5) lines.push("… 외 " + (의심갈림.새것.length - 5) + "건");
      if (의심갈림.옛것) lines.push("(전에 알린 뒤 아직 안 치운 건 " + 의심갈림.옛것 + "건이 더 있습니다)");
      lines.push("");
      lines.push("확인: 메뉴 [🔁 중복 발주 점검] — partnerCheckDuplicateOrders");
      try { _chat_sendText_(lines.join("\n")); } catch (eC) {}
    } else if (의심갈림.옛것) {
      Logger.log("[DUP] 중복 의심 " + 의심갈림.옛것 + "건 — 전부 전에 알린 것이라 조용히 넘어갑니다");
    }

    //  말한 것을 적어 둔다. 오래된 것은 여기서 버려진다(30일).
    var 남은 = _pdc_saveSeen_(seen);
    Logger.log("[DUP] 말한 목록 " + 남은 + "건 보관 (" + _PDC_SEEN_DAYS_ + "일)");
  } catch (e) {
    Logger.log("[DUP] 점검 오류: " + e.message);
  }
}
