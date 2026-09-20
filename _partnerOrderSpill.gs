/**
 * ══════════════════════════════════════════════════════════════
 *  발주탭 자동 수식 — 끝을 열어 준다
 *
 *  2026-09-20. 포털 발주 넣기를 「넣어 보기」로 시험하다 드러났다.
 *
 *    > 자동 수식 범위가 500행까지입니다. 501행까지 넣으면
 *    >  품목명·정산금액이 빈칸으로 남습니다
 *
 *  지금 코드가 만드는 수식은 전부 `C2:C` 로 끝이 열려 있다
 *  (priceManager.buildOrderUnitPriceSpillFormula_ 등). 그런데 예전에 심긴
 *  수식 중에 `C2:C500` 처럼 «끝이 박힌» 것이 남아 있다. 허브도 그 경우를
 *  알고 있다 — _partnerOrders 의 스필 점검이 /C2:C(\d+)/ 를 읽는다.
 *
 *  범위가 박혀 있으면 그 행을 넘는 순간 품목명·정산금액이 빈칸이 되고,
 *  그대로 수집되면 «이름 없는 발주»가 된다. 조용한 사고다.
 *  포털로 넣든 시트에 손으로 적든 똑같이 일어난다 — 포털 때문에 생긴
 *  문제가 아니라, 포털이 먼저 보이게 해 준 문제다.
 *
 *  ★ 통째로 다시 심지 않는다 ★
 *    injectOrderSpillFormulas_ 로 갈아엎으면 그 업체가 손본 것까지 날아간다.
 *    여기서는 «박힌 끝»만 지운다. C2:C500 → C2:C. 그 밖은 한 글자도 안 건드린다.
 *
 *  ★ 다른 탭을 가리키는 범위는 손대지 않는다 ★
 *    VLOOKUP 이 '단가조회'!A2:G500 처럼 남의 탭을 볼 때가 있다. 그건 일부러
 *    묶어 둔 것일 수 있다. `!` 뒤에 오는 범위는 건너뛴다.
 * ══════════════════════════════════════════════════════════════
 */

var _POS_ORDER_TAB_ = "발주 및 송장조회";
var _POS_CELLS_ = ["A1", "D1", "L1", "N1"];   // 자동 열 머리 — 스필이 걸리는 자리

/**
 * 한 수식에서 «자기 탭» 범위의 박힌 끝만 지운다.
 * @return {string} 바꾼 수식. 바꿀 것이 없으면 원문 그대로.
 */
function _pos_openRanges_(formula) {
  var s = String(formula || "");
  if (!s) return s;
  var out = "";
  var re = /([A-Z]{1,2})(\d+):([A-Z]{1,2})(\d+)/g;
  var last = 0, m;
  while ((m = re.exec(s)) !== null) {
    var 앞 = s.substring(0, m.index);
    /*  바로 앞이 `!` 면 남의 탭 범위다 — 건드리지 않는다.
        (`'단가조회'!A2:G500` 의 A2:G500 이 여기 걸린다)  */
    var 남의탭 = /!\s*\$?$/.test(앞) || /!\s*$/.test(앞);
    out += s.substring(last, m.index);
    if (남의탭 || m[1] !== m[3] || m[2] !== "2") {
      out += m[0];            // 그대로 둔다
    } else {
      out += m[1] + "2:" + m[3];   // C2:C500 → C2:C
    }
    last = m.index + m[0].length;
  }
  out += s.substring(last);
  return out;
}

/** 발주탭 한 개를 살핀다 */
function _pos_scanTab_(tab) {
  var 결과 = [];
  for (var i = 0; i < _POS_CELLS_.length; i++) {
    var cell = _POS_CELLS_[i];
    var f = "";
    try { f = String(tab.getRange(cell).getFormula() || ""); } catch (e) { continue; }
    if (!f) continue;
    var 새것 = _pos_openRanges_(f);
    if (새것 === f) continue;
    //  박힌 끝이 몇 행이었는지 — 사람에게 말해 주려고 뽑는다
    var 끝 = 0;
    var mm = f.match(/([A-Z]{1,2})2:\1(\d+)/g) || [];
    for (var k = 0; k < mm.length; k++) {
      var n = parseInt(String(mm[k]).replace(/[^0-9]/g, "").replace(/^2/, ""), 10);
      if (n > 끝) 끝 = n;
    }
    결과.push({ cell: cell, was: f, now: 새것, end: 끝 });
  }
  return 결과;
}

/**
 * 협력업체 배포파일들의 발주탭 자동 수식 끝을 연다.
 * @param {boolean} apply  false 면 «보기만» 한다.
 */
function _pos_run_(apply) {
  var ui = SpreadsheetApp.getUi();
  var files = [];
  try {
    files = _prpListVendorFilesForSpill_();
  } catch (e) {
    ui.alert("배포파일 목록을 못 읽었습니다: " + e.message);
    return;
  }
  if (!files.length) { ui.alert("배포파일을 찾지 못했습니다."); return; }

  var 걸린것 = [], 본것 = 0, 못연것 = [];
  for (var i = 0; i < files.length; i++) {
    var ss;
    try { ss = SpreadsheetApp.openById(files[i].id); }
    catch (e) { 못연것.push(files[i].name); continue; }
    var tab = ss.getSheetByName(_POS_ORDER_TAB_);
    if (!tab) continue;
    본것++;
    var hits = _pos_scanTab_(tab);
    if (!hits.length) continue;
    걸린것.push({ name: files[i].name, tab: tab, hits: hits });
  }

  if (!걸린것.length) {
    ui.alert("발주탭 자동 수식 점검",
      본것 + "개 파일을 봤습니다.\n\n끝이 박힌 수식은 없습니다 — 모두 열려 있습니다.",
      ui.ButtonSet.OK);
    return;
  }

  var 줄 = 걸린것.map(function (v) {
    return "· " + v.name + "  —  " +
      v.hits.map(function (h) { return h.cell + " (" + (h.end || "?") + "행까지)"; }).join(", ");
  }).join("\n");

  if (!apply) {
    ui.alert("끝이 박힌 수식 " + 걸린것.length + "개 파일",
      줄 + "\n\n지금은 «보기만» 했습니다. 고치려면 같은 메뉴의\n" +
      "「끝 열기 (반영)」을 실행하세요.",
      ui.ButtonSet.OK);
    return;
  }

  var ans = ui.alert("끝 열기 — 반영",
    줄 + "\n\n위 수식의 «박힌 끝»만 지웁니다 (C2:C500 → C2:C).\n" +
    "그 밖의 내용은 한 글자도 바꾸지 않습니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;

  var 고침 = 0, 실패 = [];
  for (var v = 0; v < 걸린것.length; v++) {
    for (var h = 0; h < 걸린것[v].hits.length; h++) {
      var hit = 걸린것[v].hits[h];
      try {
        걸린것[v].tab.getRange(hit.cell).setFormula(hit.now);
        고침++;
      } catch (e) {
        실패.push(걸린것[v].name + " " + hit.cell + ": " + e.message);
      }
    }
  }
  SpreadsheetApp.flush();

  ui.alert("끝 열기 완료",
    고침 + "곳을 고쳤습니다." +
    (실패.length ? "\n\n못 고친 것:\n" + 실패.join("\n") : "") +
    "\n\n★ 확인 ★ 발주탭에서 마지막 줄 아래에 코드를 하나 적어 보시면\n" +
    "품목명·정산금액이 바로 채워져야 합니다.",
    ui.ButtonSet.OK);
}

/** 협력업체 배포파일 목록 — 포털이 쓰는 폴더와 같은 곳을 본다 */
function _prpListVendorFilesForSpill_() {
  var folders = ["1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl", "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v"];
  var seen = {}, out = [];
  for (var i = 0; i < folders.length; i++) {
    var files;
    try { files = DriveApp.getFolderById(folders[i]).getFiles(); }
    catch (e) { continue; }
    while (files.hasNext()) {
      var f = files.next();
      var nm = f.getName();
      if (nm.indexOf("[협력업체]") < 0) continue;
      var id = f.getId();
      if (seen[id]) continue;
      seen[id] = true;
      out.push({ id: id, name: nm });
    }
  }
  return out;
}

/** 메뉴 — 보기만 */
function partnerOrderSpillCheck() { _pos_run_(false); }

/** 메뉴 — 반영 */
function partnerOrderSpillOpen() { _pos_run_(true); }
