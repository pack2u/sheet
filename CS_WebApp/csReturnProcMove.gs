/**
 * ══════════════════════════════════════════════════════════════
 *  진행 카드를 «다른 반품 건»으로 옮긴다
 *  파일: csReturnProcMove.gs      2026-10-06
 *
 *  > "반품텝에서 반품카드의 내용(내부 카드를 드래그앤 드롭으로 다른카드로
 *  >  이동할수 있게 해줘..최종적으로 확인버튼을 눌러야 이동되게.)
 *  >  다른 카드의 내용을 들어와서 옯겨야 할경우가 있어"
 *
 *  ★ 왜 필요한가 ★
 *    물류가 사진을 엉뚱한 건에 붙이거나, 같은 손님의 두 건이 섞인다.
 *    여태는 지우고 다시 쓰는 수밖에 없었다 — 사진은 다시 못 붙인다.
 *
 *  ★ 무엇이 움직이나 ★
 *    진행 카드는 반품대장 비고 칸의 «한 줄»이다. 옮기기는
 *      ① 보낸 줄에서 그 줄을 빼고
 *      ② 받는 줄의 비고 끝에 붙이고
 *      ③ 양쪽에 「어디서/어디로」 한 줄씩 남긴다
 *    이 셋이 다 되어야 옮긴 것이다.
 *
 *  ★ 터지면 되돌린다 ★
 *    ②에서 터지면 ①만 된 채로 끝난다 — 줄이 «사라진다». 사진이 달린
 *    줄이면 그것으로 끝이다. 그래서 받는 쪽을 «먼저» 쓰고, 보낸 쪽을
 *    지우다 터지면 받는 쪽을 되돌린다.
 *
 *  ★ 흔적을 양쪽에 남긴다 ★  (사장님이 고르신 길)
 *    > "양쪽에 한 줄씩 남긴다"
 *    나중에 「이 사진 왜 여기 있지?」를 되짚을 수 있어야 한다.
 *    줄이 둘 늘지만, 못 되짚는 것보다 낫다.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * @param {{from:{tab:string,row:number}, to:{tab:string,row:number},
 *          raw:string, lineIndex:number=, kind:string=, staff:string}} p
 */
function moveReturnTimelineEvent(p) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  p = p || {};
  var 보낸곳 = p.from || {}, 받는곳 = p.to || {};
  var fTab = String(보낸곳.tab || "").trim(), fRow = parseInt(보낸곳.row, 10);
  var tTab = String(받는곳.tab || "").trim(), tRow = parseInt(받는곳.row, 10);
  var raw = String(p.raw || "").trim();
  var kind = String(p.kind || "").trim();
  var staff = String(p.staff || "").trim();

  if (!fTab || !(fRow > 0) || !tTab || !(tRow > 0)) return { ok: false, error: "어느 건에서 어느 건으로인지 모릅니다." };
  if (!staff) return { ok: false, error: "담당자를 먼저 선택하세요." };
  if (!raw) return { ok: false, error: "옮길 줄을 못 찾았습니다." };
  if (kind === "access") return { ok: false, error: "접수 카드는 옮길 수 없습니다 — 그 건 자체를 가리킵니다." };
  if (fTab === tTab && fRow === tRow) return { ok: false, error: "같은 건입니다." };

  /*  ★ getDocumentLock 이 아니다 ★  (2026-10-06)
      CS 웹앱은 문서에 붙은 스크립트가 아니라 «독립» 스크립트다. 거기서
      getDocumentLock() 은 null 을 돌려주고, 그걸 바로 쓰면
      「Cannot read properties of null (reading tryLock)」으로 터진다.
      이 프로젝트의 다른 자리는 전부 getScriptLock() 을 쓴다 — 거기에 맞춘다.  */
  var lock = LockService.getScriptLock();
  if (lock && !lock.tryLock(20000)) {
    return { ok: false, error: "다른 작업이 대장을 쓰고 있습니다. 잠시 뒤 다시 하세요." };
  }

  var 되돌릴것 = null;
  try {
    /* ── ① 양쪽을 연다. 받는 쪽이 멀쩡한지 «먼저» 본다 ── */
    var f = _cs_openReturnLedgerRow_(fTab, fRow);
    var t = _cs_openReturnLedgerRow_(tTab, tRow);
    if (f.col.notice < 0 || t.col.notice < 0) return { ok: false, error: "비고 열을 찾지 못했습니다." };

    var fNotice = String(f.row[f.col.notice] || "").trim();
    var tNotice = String(t.row[t.col.notice] || "").trim();
    if (!fNotice) return { ok: false, error: "보내는 건의 비고가 비어 있습니다." };

    /* ── ② 옮길 줄을 «찾아만» 둔다. 아직 안 지운다 ── */
    var 줄들 = fNotice.split(/\n/);
    var 자리 = -1;
    var li = p.lineIndex;
    if (li !== undefined && li !== null && li !== "") {
      var n = parseInt(li, 10);
      if (!isNaN(n) && n >= 0 && n < 줄들.length && String(줄들[n] || "").trim()) 자리 = n;
    }
    if (자리 < 0) {
      var 견줄것 = _cs_normNoticeLine_(raw);
      for (var i = 0; i < 줄들.length; i++) {
        if (_cs_normNoticeLine_(줄들[i]) === 견줄것) { 자리 = i; break; }
      }
    }
    if (자리 < 0) return { ok: false, error: "대장에서 그 줄을 못 찾았습니다. 새로고침 후 다시 하세요." };
    var 옮길줄 = String(줄들[자리]).trim();

    var 보낸표 = _cs_returnMoveTag_(f, fTab, fRow);
    var 받는표 = _cs_returnMoveTag_(t, tTab, tRow);
    var 도장 = _cs_ledgerStamp_(staff);

    /*  ★ 되돌리기 ★  (2026-10-06)
        > "언두 기능 없을까?"
        되돌릴 때는 흔적을 «새로 남기지 않고», 처음 옮길 때 적은 두 줄을 지운다.
        「옮겼다 되돌렸다」가 비고에 쌓이면 읽을 수가 없다 — 되돌린 자리는
        아무 일도 없던 것처럼 깨끗해야 다음에 또 안 헷갈린다.
        지울 줄은 «글자 그대로» 받는다 — 짐작해서 지우면 남의 줄을 지운다.  */
    var 되돌리기 = p.undo || null;
    var 지울보낸쪽 = 되돌리기 ? String(되돌리기.dropFrom || "").trim() : "";
    var 지울받는쪽 = 되돌리기 ? String(되돌리기.dropTo || "").trim() : "";

    /* ── ③ 받는 쪽을 «먼저» 쓴다 ──
           여기서 터지면 아무것도 안 바뀐 것이다. 보낸 쪽은 아직 그대로다. */
    var 받는줄들 = tNotice ? tNotice.split(/\n/) : [];
    if (지울받는쪽) 받는줄들 = _cs_dropNoticeLine_(받는줄들, 지울받는쪽);
    var tNew = _cs_appendNoticeLine_(받는줄들.join("\n").trim(), 옮길줄);
    var 받은흔적 = "";
    if (!되돌리기) {
      /*  「카드이동:」으로 적는다 — 화면이 meta 로 걸러 카드를 안 만든다.
          대괄호 머리로 적으면 제일 새 카드가 되어 사진을 옆으로 민다. */
      받은흔적 = "카드이동: " + 도장 + " ← " + 보낸표 + " 에서 옮겨옴";
      tNew = _cs_appendNoticeLine_(tNew, 받은흔적);
    }
    tNew = tNew.replace(/\n{3,}/g, "\n\n").trim();
    t.tab.getRange(tRow, t.col.notice + 1).setValue(tNew);
    되돌릴것 = { tab: t.tab, row: tRow, col: t.col.notice + 1, 값: tNotice };

    /*  ★ 입고 사진이 가면 상태도 따라간다 ★  (2026-10-07)
        > "입고 검수 사진이 올라오면 입고검수까지 진행되었다라는걸 표현하는거야"

        사진이 거기 있다는 것은 그 건이 입고검수까지 갔다는 뜻이다. 사진만 옮기고
        상태를 두면 「사진은 있는데 아직 접수」인 줄이 생긴다 — 보는 사람이 또 묻는다.

        ★ 끝난 건은 안 건드린다 ★ 환불까지 마치고 닫은 건에 입고검수를 찍으면
          끝난 건이 다시 열린다. 현장입고(csReturnIntake)가 쓰는 그 판정을 그대로 쓴다.
        ★ 상태→ 줄은 안 남긴다 ★ 남기면 그 줄이 «제일 새것»이 되어 사진 카드를
          옆으로 민다. 바뀐 사실은 아래 「카드이동」 흔적에 적는다(화면엔 안 뜬다).  */
    var 상태바꿈 = null;
    var 입고사진인가 = false;
    try {
      var 몸 = String(옮길줄).replace(/^\[[^\]]*\]\s*/, "");
      입고사진인가 = (typeof _cs_isPhotoLine_ === "function") && _cs_isPhotoLine_(몸);
    } catch (e0) {}
    if (입고사진인가 && !되돌리기 && t.col.status >= 0) {
      var 받는상태 = String(t.row[t.col.status] || "").trim();
      var 끝났나 = false;
      try { 끝났나 = _cs_isReturnLedgerDone_(받는상태, t.row); } catch (e1) {}
      if (!끝났나 && 받는상태 !== _CS_RI_STATUS_INTAKE_) {
        t.tab.getRange(tRow, t.col.status + 1).setValue(_CS_RI_STATUS_INTAKE_);
        상태바꿈 = { 앞: 받는상태, 뒤: _CS_RI_STATUS_INTAKE_ };
      }
    }
    /*  되돌릴 때는 그때 바꾼 상태를 도로 돌린다 — 반쪽짜리 되돌리기는 더 헷갈린다 */
    if (되돌리기 && 되돌리기.restoreStatus !== undefined && f.col.status >= 0) {
      try { f.tab.getRange(fRow, f.col.status + 1).setValue(String(되돌리기.restoreStatus || "")); } catch (e2) {}
    }

    /* ── ④ 보낸 쪽에서 빼고 흔적을 남긴다 ──
           터지면 ③을 되돌린다 — 줄이 두 곳에 남는 것이 사라지는 것보다 낫다. */
    줄들.splice(자리, 1);
    if (지울보낸쪽) 줄들 = _cs_dropNoticeLine_(줄들, 지울보낸쪽);
    var fNew = 줄들.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    var 보낸흔적 = "";
    if (!되돌리기) {
      보낸흔적 = "카드이동: " + 도장 + " → " + 받는표 + " 로 옮김: " + _cs_shortLine_(옮길줄) +
        (상태바꿈 ? " (받는 건 상태 " + (상태바꿈.앞 || "빈칸") + " → " + 상태바꿈.뒤 + ")" : "");
      fNew = _cs_appendNoticeLine_(fNew, 보낸흔적);
    }
    f.tab.getRange(fRow, f.col.notice + 1).setValue(fNew);
    되돌릴것 = null;   // 여기까지 왔으면 되돌릴 일이 없다

    csInvalidateReturnLedgerCache_();

    return {
      ok: true,
      undone: !!되돌리기,
      message: (되돌리기 ? "되돌렸습니다 — " : "옮겼습니다 — ") + 보낸표 + " → " + 받는표,
      /*  화면이 「되돌리기」를 걸 수 있게, 이번에 적은 흔적 두 줄을 그대로 돌려준다.
          짐작해서 지우지 않게 하려는 것이다.                                */
      흔적: { 보낸쪽: 보낸흔적, 받는쪽: 받은흔적 },
      /*  되돌릴 때 상태까지 돌리라고 «바꾸기 전» 값을 돌려준다.
          안 돌리면 「되돌렸는데 상태만 입고검수」인 줄이 남는다.          */
      상태바꿈: 상태바꿈,
      from: { tab: fTab, row: fRow, notice: fNew, timeline: _cs_returnTimelineOf_(f, fNew) },
      to: { tab: tTab, row: tRow, notice: tNew, timeline: _cs_returnTimelineOf_(t, tNew) }
    };
  } catch (e) {
    if (되돌릴것) {
      try { 되돌릴것.tab.getRange(되돌릴것.row, 되돌릴것.col).setValue(되돌릴것.값); }
      catch (e2) {
        return { ok: false, error: "옮기다 터졌고 되돌리기도 실패했습니다 — 두 건의 비고를 손으로 봐 주세요: " +
          (e.message || e) + " / " + (e2.message || e2) };
      }
    }
    return { ok: false, error: (e.message || String(e)) };
  } finally {
    try { if (lock) lock.releaseLock(); } catch (e3) {}
  }
}

/**
 * 흔적 한 줄을 지운다 — 되돌릴 때만 쓴다.  (2026-10-06)
 * «글자 그대로» 맞는 줄 하나만 지운다. 짐작해서 지우면 남의 줄을 지운다.
 * 같은 글자가 여럿이면 맨 뒤의 것 — 방금 적은 것이 맨 뒤다.
 */
function _cs_dropNoticeLine_(줄들, 지울줄) {
  var 견줄것 = _cs_normNoticeLine_(지울줄);
  if (!견줄것) return 줄들;
  for (var i = 줄들.length - 1; i >= 0; i--) {
    if (_cs_normNoticeLine_(줄들[i]) === 견줄것) { 줄들.splice(i, 1); return 줄들; }
  }
  return 줄들;   // 못 찾으면 그냥 둔다 — 못 지운 흔적이 지워진 줄보다 낫다
}

/** 「김○○ 10/02행」처럼 사람이 알아볼 표. 고유ID 가 있으면 그게 제일 또렷하다 */
function _cs_returnMoveTag_(ctx, tabName, rowNum) {
  var uid = ctx.col.uid >= 0 ? String(ctx.row[ctx.col.uid] || "").trim() : "";
  if (uid) return uid;
  var name = ctx.col.name >= 0 ? String(ctx.row[ctx.col.name] || "").trim() : "";
  return (name || "이름없음") + "(" + tabName + " " + rowNum + "행)";
}

/** 흔적 줄에 넣을 짧은 미리보기 — 긴 줄을 통째로 또 적으면 비고가 두 배가 된다 */
function _cs_shortLine_(s) {
  var t = String(s || "").trim().replace(/\s+/g, " ");
  return t.length > 40 ? t.substring(0, 40) + "…" : t;
}

/** 화면이 바로 다시 그리도록 경과를 만들어 돌려준다 (삭제 쪽과 같은 잣대) */
function _cs_returnTimelineOf_(ctx, notice) {
  var status = ctx.col.status >= 0 ? String(ctx.row[ctx.col.status] || "").trim() : "";
  var staffVal = ctx.col.staff >= 0 ? String(ctx.row[ctx.col.staff] || "").trim() : "";
  var dateVal = ctx.col.date >= 0 ? String(ctx.row[ctx.col.date] || "").trim() : "";
  var typeVal = ctx.col.type >= 0
    ? String(ctx.row[ctx.col.type] || "").trim()
    : _cs_typeFromNotice_(notice);
  return _cs_parseReturnTimeline_(notice, status, staffVal, dateVal, typeVal);
}
