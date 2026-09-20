/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 발주 넣기 (시트 발주 시스템과 연동)
 *
 *  > "이게 지금 시트 발주 시스템과 연동이 되야되.. 테스트가 필요한 부분이라..
 *  >  협력업체중 가장많은 발주와 반품이 일어나는 업체라.."
 *  > "당분간은 양쪽다 사용이 가능해야되."
 *
 *  ★ 새 길을 내지 않는다 ★
 *    업체 파일의 「발주 및 송장조회」 탭이 이미 발주 입구다. 포털은 그 탭에
 *    «행 한 줄을 더 쓰는» 또 하나의 입구일 뿐이다. 그 뒤의 수집·고유ID 발번·
 *    송장 매칭은 여태 돌던 것이 그대로 돈다. 파이프라인을 새로 만들면
 *    언젠가 한쪽만 고치게 되고, 그날 발주가 둘로 갈린다.
 *
 *  ★ 시트로 직접 넣는 길을 막지 않는다 ★
 *    업체는 여태 시트에 손으로 적어 왔다. 그 길은 그대로 둔다. 두 입구가
 *    같은 탭에 쓰므로 «맨 아래 빈 줄»을 잠금 안에서 다시 읽는다 —
 *    읽고 쓰는 사이에 사람이 한 줄 적으면 그 줄을 덮어쓴다.
 *
 *  ★ 자동 열은 건드리지 않는다 ★
 *    A 거래처명 · B 주문일자 · D 품목명 · L 정산금액 · M 고유ID · N 상태는
 *    모두 「(자동)」이다. 특히 D·L 은 스필 수식이라 값으로 쓰면 그 자리에서
 *    깨지고, 그러면 그 아래 전부가 빈칸이 된다.
 *    업체가 채우는 칸은 일곱뿐이다 — 이카운트코드·수량·수취인·전화·주소·
 *    배송메시지·적요 (그리고 택배사).
 *
 *  ★ v2 를 전제로 얇게 ★
 *    상품정보시트·세트분리·허브·임시기록·송장매칭이 v2 로 통합된다.
 *    그러니 여기에 «판단»을 쌓지 않는다. 이 파일이 하는 일은 「업체가 적은
 *    것을 그 탭에 옮겨 적는다」 하나뿐이다.
 * ══════════════════════════════════════════════════════════════
 */

var PRP_PRICE_TAB_ = "단가조회";
/*  ★ 200 ★  (2026-09-21)
    > "당장드림의 경우 많을경우 150개 주문이 들어 올경우가 있어..
    >  나머지 업체들은 대부분 10개 내외정도.."
    50 으로 막아 두면 가장 바쁜 날 세 번에 나눠 넣어야 한다. 나눠 넣으면
    중간에 무엇이 들어갔는지 사람이 세게 되고, 그게 곧 빠뜨림이다.  */
var PRP_OE_MAX_ROWS_ = 200;
var PRP_OE_ITEM_LIMIT_ = 1200;  // 품목 목록 최대

/* 업체가 채우는 칸 — 머리글로 찾는다. 열 번호를 박지 않는 까닭은
   업체마다 열이 조금씩 다르고, 앞으로도 늘 것이기 때문이다. */
function prpOeMapCols_(hdr) {
  function find(re) {
    for (var i = 0; i < (hdr || []).length; i++) {
      if (re.test(String(hdr[i] || "").replace(/\s/g, ""))) return i;
    }
    return -1;
  }
  return {
    vendor: find(/^거래처명/),
    date:   find(/^주문일자/),
    code:   find(/^이카운트코드$|^품목코드$/),
    item:   find(/^품목명/),
    qty:    find(/^수량$/),
    name:   find(/^수취인$/),
    phone:  find(/^수취인전화번호$|^수취인전화$/),
    addr:   find(/^수취인주소$|^주소$/),
    msg:    find(/^배송메시지$/),
    note:   find(/^적요$/),
    inv:    find(/^송장번호$/),
    uid:    find(/고유ID|고유아이디/),
    status: find(/^상태/),
    pickup: find(/^택배사$/)
  };
}

/** 업체가 «적는» 칸만 추린다 — 자동 열에는 한 글자도 쓰지 않는다 */
var PRP_OE_WRITABLE_ = ["code", "qty", "name", "phone", "addr", "msg", "note", "pickup"];

/**
 * 쓸 열을 «붙어 있는 덩어리»로 묶는다.
 *
 * ★ 150줄이 들어오는 날이 있다 ★  (2026-09-21)
 *   칸마다 setValue 하면 150줄 × 8칸 = 1200번이다. 6분 제한에 걸린다.
 *   자동 열(A·B·D·L·M·N)을 건너뛰면서, 붙어 있는 칸끼리는 한 번에 쓴다.
 *   당장드림 발주탭이면 C / E~J / P 세 덩어리가 되어 쓰기가 세 번으로 준다.
 *
 * @return {Array<{start:number, keys:Array<string>}>} start 는 0-기반 열 번호
 */
function _prpOeBlocks_(col) {
  var 쓸것 = [];
  for (var i = 0; i < PRP_OE_WRITABLE_.length; i++) {
    var k = PRP_OE_WRITABLE_[i];
    if (col[k] >= 0) 쓸것.push({ c: col[k], key: k });
  }
  쓸것.sort(function (a, b) { return a.c - b.c; });

  var out = [];
  for (var j = 0; j < 쓸것.length; j++) {
    var last = out.length ? out[out.length - 1] : null;
    if (last && 쓸것[j].c === last.start + last.keys.length) {
      last.keys.push(쓸것[j].key);
    } else {
      out.push({ start: 쓸것[j].c, keys: [쓸것[j].key] });
    }
  }
  return out;
}

/**
 * 발주탭에서 «사람이 적은» 마지막 줄의 다음 행.
 *
 * getLastRow() 는 못 쓴다 — A열 ARRAYFORMULA 가 빈 문자열을 500행까지
 * 뿌려 놓아서 늘 500 쯤으로 잡힌다. 자동 열(A·D·L·M·N)은 보지 않고,
 * 사람이 적는 칸만 본다.
 */
function _prpOeNextRow_(tab, col, lc) {
  var last = tab.getLastRow();
  if (last < 2) return 2;

  var keys = [col.code, col.name, col.addr, col.phone, col.inv, col.qty]
    .filter(function (c) { return c >= 0; });
  if (!keys.length) return last + 1;

  var all = tab.getRange(1, 1, last, lc).getDisplayValues();
  var 마지막 = 1;   // 1-기반 행 번호. 머리글만 있으면 1
  for (var r = 1; r < all.length; r++) {
    for (var k = 0; k < keys.length; k++) {
      var v = String(all[r][keys[k]] || "").trim();
      if (v && v !== "-") { 마지막 = r + 1; break; }
    }
  }
  return 마지막 + 1;
}

function prpOeOpenBook_(sess) {
  var fileId = prpFindVendorFileId_(sess);
  if (!fileId) return { ok: false, error: "이 업체의 배포파일을 찾지 못했습니다. 운영자에게 알려 주세요." };
  return { ok: true, ss: SpreadsheetApp.openById(fileId), fileId: fileId };
}

/* ══════════════════════════════════════════════════════════════
   ① 품목 목록 — 단가조회 탭
   업체가 이카운트코드를 외울 까닭이 없다. 재고·단가를 같이 보여 준다.
   ══════════════════════════════════════════════════════════════ */
function prpListItems(sid) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;

  try {
    var b = prpOeOpenBook_(g.sess);
    if (!b.ok) return { ok: false, error: b.error, items: [] };

    var tab = b.ss.getSheetByName(PRP_PRICE_TAB_);
    if (!tab) return { ok: false, error: "「" + PRP_PRICE_TAB_ + "」 탭이 없습니다.", items: [] };
    if (tab.getLastRow() < 2) return { ok: true, items: [] };

    var lc = Math.min(tab.getLastColumn(), 20);
    var all = tab.getRange(1, 1, Math.min(tab.getLastRow(), PRP_OE_ITEM_LIMIT_ + 5), lc).getDisplayValues();

    //  머리글 줄을 찾는다 — 위에 안내 줄이 몇 개 있을 수 있다
    var hi = 0;
    for (var i = 0; i < Math.min(all.length, 6); i++) {
      var joined = (all[i] || []).join("|").replace(/\s/g, "");
      if (/이카운트코드|품목코드/.test(joined) && /품목명/.test(joined)) { hi = i; break; }
    }
    var h = all[hi] || [];
    function col(re) {
      for (var j = 0; j < h.length; j++) {
        if (re.test(String(h[j] || "").replace(/\s/g, ""))) return j;
      }
      return -1;
    }
    var c = {
      state: col(/^상태$/),
      code: col(/^이카운트코드$|^품목코드$/),
      item: col(/^품목명$/),
      stock: col(/^재고$/),
      price: col(/^최종단가$/)
    };
    if (c.code < 0 || c.item < 0) {
      return { ok: false, error: "단가조회 탭에서 코드·품목명 열을 못 찾았습니다.", items: [] };
    }

    var out = [];
    for (var r = hi + 1; r < all.length && out.length < PRP_OE_ITEM_LIMIT_; r++) {
      var code = String(all[r][c.code] || "").trim();
      var item = String(all[r][c.item] || "").trim();
      if (!code || !item) continue;
      out.push({
        code: code,
        item: item,
        state: c.state >= 0 ? String(all[r][c.state] || "").trim() : "",
        stock: c.stock >= 0 ? String(all[r][c.stock] || "").trim() : "",
        price: c.price >= 0 ? String(all[r][c.price] || "").trim() : ""
      });
    }
    return { ok: true, items: out };
  } catch (e) {
    return { ok: false, error: e.message || String(e), items: [] };
  }
}

/* ══════════════════════════════════════════════════════════════
   ② 발주 넣기
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {string} sid
 * @param {{rows:Array, dryRun:boolean}} payload
 *   rows — [{code, qty, name, phone, addr, msg, note, pickup}]
 *   dryRun — true 면 «아무것도 쓰지 않고» 어디에 어떻게 들어가는지만 돌려준다.
 *            21일 기술 실험이 이것이다. 실물에 손대지 않고 길을 확인한다.
 */
function prpSubmitOrders(sid, payload) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  payload = payload || {};
  var dryRun = !!payload.dryRun;

  var rowsIn = payload.rows || [];
  if (!rowsIn.length) return { ok: false, error: "넣을 줄이 없습니다." };
  if (rowsIn.length > PRP_OE_MAX_ROWS_) {
    return { ok: false, error: "한 번에 " + PRP_OE_MAX_ROWS_ + "줄까지 넣을 수 있습니다." };
  }

  //  ── 받은 줄 다듬기 · 빠진 칸 잡기 ──
  var clean = [], bad = [];
  for (var i = 0; i < rowsIn.length; i++) {
    var r = rowsIn[i] || {};
    var one = {
      code:  String(r.code || "").trim(),
      qty:   String(r.qty || "").replace(/[^0-9]/g, ""),
      name:  String(r.name || "").trim(),
      phone: prpFormatPhone_(r.phone),
      addr:  String(r.addr || "").replace(/\s+/g, " ").trim(),
      msg:   String(r.msg || "").replace(/\s+/g, " ").trim(),
      note:  String(r.note || "").replace(/\s+/g, " ").trim(),
      pickup: String(r.pickup || "").trim()
    };
    var 빠진것 = [];
    if (!one.code) 빠진것.push("품목코드");
    if (!one.qty || one.qty === "0") 빠진것.push("수량");
    if (!one.name) 빠진것.push("수취인");
    if (!one.addr) 빠진것.push("주소");
    if (빠진것.length) {
      bad.push({ line: i + 1, why: 빠진것.join("·") + " 없음", row: one });
      continue;
    }
    clean.push(one);
  }
  if (!clean.length) {
    return { ok: false, error: "넣을 수 있는 줄이 없습니다.", bad: bad };
  }

  var lock = LockService.getScriptLock();
  if (!dryRun) {
    try {
      lock.waitLock(25000);
    } catch (eLock) {
      return { ok: false, error: "잠시 후 다시 시도해 주세요. (다른 발주가 처리 중입니다)" };
    }
  }

  try {
    var b = prpOeOpenBook_(g.sess);
    if (!b.ok) return { ok: false, error: b.error };

    var tab = b.ss.getSheetByName(PRP_ORDER_TAB_NAME_);
    if (!tab) return { ok: false, error: "「" + PRP_ORDER_TAB_NAME_ + "」 탭이 없습니다." };

    var lc = Math.max(tab.getLastColumn(), 16);
    var hdr = tab.getRange(1, 1, 1, lc).getDisplayValues()[0];
    var col = prpOeMapCols_(hdr);
    if (col.code < 0 || col.qty < 0 || col.name < 0 || col.addr < 0) {
      return { ok: false, error: "발주 탭에서 코드·수량·수취인·주소 열을 못 찾았습니다." };
    }

    /*  ★ getLastRow() 를 믿으면 안 된다 ★  (2026-09-21)

        A1 의 ARRAYFORMULA 가 `IF(LEN(C2:C500)+LEN(D2:D500)=0, "", …)` 라서
        A2:A500 에 «빈 문자열»이 스필된다. 빈 문자열도 값이라 getLastRow()
        가 500 으로 잡힌다. 실제 데이터는 89행 근처인데 501행에 넣겠다고
        했던 것이 이 탓이다. 그러면 90~500행이 빈 줄로 남고, 그 자리는
        수식도 안 닿아 품목명이 채워지지 않는다.

        사람이 적은 칸(코드·수취인·주소·송장)을 보고 «진짜 마지막 줄»을
        찾는다. 반품 쪽 prpNextDestRow_ 와 같은 생각이다.

        ★ 잠금 안에서 읽는다 ★ 시트로 직접 적는 길이 살아 있다. 읽고 쓰는
          사이에 사람이 한 줄 적으면 미리 재어 둔 자리는 이미 남의 줄이다.  */
    var dest = _prpOeNextRow_(tab, col, lc);

    /*  ★ 스필 범위를 확인한다 ★
        D(품목명)·L(정산금액)은 ARRAYFORMULA 로 C 열을 따라간다. 그런데 그
        범위가 「C2:C500」처럼 박혀 있다. 그 밖에 쓰면 품목명·단가가 빈칸으로
        남고, 그 상태로 수집되면 이름 없는 발주가 된다. 미리 말해 준다.  */
    var 스필경고 = "";
    try {
      var 끝 = 0;
      var cands = [];
      if (col.item >= 0) cands.push(tab.getRange(1, col.item + 1).getFormula());
      if (col.vendor >= 0) cands.push(tab.getRange(1, col.vendor + 1).getFormula());
      for (var f = 0; f < cands.length; f++) {
        var m = String(cands[f] || "").match(/[A-Z]+2:[A-Z]+(\d+)/);
        if (m) { 끝 = Math.max(끝, parseInt(m[1], 10)); }
      }
      if (끝 && dest + clean.length - 1 > 끝) {
        스필경고 = "자동 수식 범위가 " + 끝 + "행까지입니다. " +
          (dest + clean.length - 1) + "행까지 넣으면 품목명·정산금액이 " +
          "빈칸으로 남습니다 — 운영팀에 범위를 늘려 달라고 알려 주세요.";
      }
    } catch (eSpill) {}

    //  ── 쓸 값을 만든다. 자동 열은 손대지 않는다 ──
    var blocks = _prpOeBlocks_(col);
    var 미리보기 = [];
    for (var k = 0; k < clean.length; k++) {
      미리보기.push({
        row: dest + k,
        code: clean[k].code, qty: clean[k].qty, name: clean[k].name,
        phone: clean[k].phone, addr: clean[k].addr,
        msg: clean[k].msg, note: clean[k].note, pickup: clean[k].pickup
      });
    }

    if (dryRun) {
      return {
        ok: true, dryRun: true,
        tab: tab.getName(), fileId: b.fileId,
        firstRow: dest, count: clean.length,
        cols: col, header: hdr, blocks: blocks.length,
        preview: 미리보기, bad: bad, spillWarn: 스필경고,
        message: "실제로는 아무것도 쓰지 않았습니다. " + tab.getName() + " " +
          dest + "행부터 " + clean.length + "줄이 들어갈 자리입니다."
      };
    }

    /*  ★ 붙어 있는 칸끼리 한 번에 쓴다 ★
        덩어리 밖(자동 열)에는 손이 안 간다. 150줄이 들어와도 쓰기는
        덩어리 수만큼(당장드림이면 셋)이다. 칸마다 쓰면 1200번이 된다.  */
    for (var bi = 0; bi < blocks.length; bi++) {
      var blk = blocks[bi];
      var vals = [];
      for (var r = 0; r < clean.length; r++) {
        var one = [];
        for (var q = 0; q < blk.keys.length; q++) one.push(clean[r][blk.keys[q]]);
        vals.push(one);
      }
      tab.getRange(dest, blk.start + 1, vals.length, blk.keys.length).setValues(vals);
    }
    SpreadsheetApp.flush();

    prpLog_(g.sess.vendor, "발주",
      tab.getName() + " " + dest + "행부터 " + clean.length + "줄" +
      (스필경고 ? " · " + 스필경고 : ""));
    prpNotifyChat_("포털 발주", g.sess.vendor,
      clean.length + "줄 · " + tab.getName() + " " + dest + "행부터" +
      (스필경고 ? "\n⚠ " + 스필경고 : ""));

    return {
      ok: true, dryRun: false,
      tab: tab.getName(), firstRow: dest, count: clean.length,
      preview: 미리보기, bad: bad, spillWarn: 스필경고,
      message: tab.getName() + " " + dest + "행부터 " + clean.length + "줄 넣었습니다."
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    if (!dryRun) { try { lock.releaseLock(); } catch (eR) {} }
  }
}

/**
 * 방금 포털로 넣은 줄을 지운다.
 *
 * ★ 내가 넣은 것만 ★ 행 번호만 받고 지우면 남의 줄을 지울 수 있다.
 *   넣을 때 적은 값(코드·수취인·수량)이 «지금도 그대로»일 때만 지운다.
 *   그 사이 누가 고쳤으면 손대지 않는다 — 고친 사람이 있다는 뜻이다.
 */
function prpUndoOrders(sid, payload) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  payload = payload || {};
  var rows = payload.rows || [];
  if (!rows.length) return { ok: false, error: "지울 줄이 없습니다." };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); }
  catch (e) { return { ok: false, error: "잠시 후 다시 시도해 주세요." }; }

  try {
    var b = prpOeOpenBook_(g.sess);
    if (!b.ok) return { ok: false, error: b.error };
    var tab = b.ss.getSheetByName(PRP_ORDER_TAB_NAME_);
    if (!tab) return { ok: false, error: "발주 탭이 없습니다." };

    var lc = Math.max(tab.getLastColumn(), 16);
    var col = prpOeMapCols_(tab.getRange(1, 1, 1, lc).getDisplayValues()[0]);

    /*  ★ 견주기는 한 번에 읽는다 ★  (2026-09-21)
        150줄이면 한 줄씩 getRange 하는 것만 150번이다. 통째로 한 번 읽는다.  */
    var lastRow = tab.getLastRow();
    var all = lastRow > 1 ? tab.getRange(1, 1, lastRow, lc).getDisplayValues() : [];

    var 지울행 = [], 건너뜀 = [];
    for (var i = 0; i < rows.length; i++) {
      var want = rows[i];
      var n = parseInt(want.row, 10);
      if (!(n > 1) || n > lastRow) { 건너뜀.push(want.row + "행: 없음"); continue; }
      var cur = all[n - 1] || [];
      var 같나 =
        String(cur[col.code] || "").trim() === String(want.code || "").trim() &&
        String(cur[col.name] || "").trim() === String(want.name || "").trim() &&
        String(cur[col.qty] || "").replace(/[^0-9]/g, "") === String(want.qty || "").replace(/[^0-9]/g, "");
      if (!같나) { 건너뜀.push(n + "행: 내용이 바뀌어 건드리지 않았습니다"); continue; }
      //  고유ID 가 이미 붙었으면 허브가 수집해 간 것이다 — 지우면 안 된다
      if (col.uid >= 0 && String(cur[col.uid] || "").trim()) {
        건너뜀.push(n + "행: 이미 수집되어 고유ID가 붙었습니다");
        continue;
      }
      지울행.push(n);
    }

    /*  ★ 붙어 있는 행은 묶어서 지운다 ★
        포털이 넣은 줄은 대개 잇달아 있으므로 대부분 한 번에 끝난다.
        아래에서 위로 — 위에서 지우면 아래 행 번호가 밀린다.  */
    지울행.sort(function (a, c) { return c - a; });
    var 지움 = 0, j = 0;
    while (j < 지울행.length) {
      var 끝행 = 지울행[j];
      var k = j;
      while (k + 1 < 지울행.length && 지울행[k + 1] === 지울행[k] - 1) k++;
      var 시작행 = 지울행[k];
      tab.deleteRows(시작행, 끝행 - 시작행 + 1);
      지움 += (끝행 - 시작행 + 1);
      j = k + 1;
    }
    SpreadsheetApp.flush();
    prpLog_(g.sess.vendor, "발주취소", 지움 + "줄 지움" +
      (건너뜀.length ? " · 건너뜀 " + 건너뜀.length : ""));
    return { ok: true, removed: 지움, skipped: 건너뜀 };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    try { lock.releaseLock(); } catch (eR) {}
  }
}
