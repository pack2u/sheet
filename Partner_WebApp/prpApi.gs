/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 클라이언트가 부르는 서버 함수
 *
 *  모든 함수는 첫 줄에서 prpGuard_(sid) 로 세션을 확인하고,
 *  업체는 세션에서만 결정한다. 클라이언트가 보낸 업체명은 무시한다.
 *
 *  업체가 할 수 있는 것
 *    조회 · 신규 접수 · 문의 남기기 · 사진 첨부
 *  업체가 할 수 없는 것
 *    상태 변경(CS 전용) · 반품비 수정(운영자 결정) · 타 업체 건 조회
 * ══════════════════════════════════════════════════════════════
 */

/** 화면 최초 로드용 — 업체명과 선택 옵션 */
function prpBootstrap(sid) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  return {
    ok: true,
    vendor: g.sess.vendor,
    version: PRP_VERSION,
    types: PRP_RETURN_TYPES,
    pickups: PRP_PICKUP_OPTS,
    pickupDefault: PRP_PICKUP_DEFAULT,   // 2026-09-18 — 처음 골라져 있을 것
    defaultDays: PRP_DEFAULT_DAYS,
    photoMax: PRP_PHOTO_MAX
  };
}

/** 내 반품 목록 + 요약 */
function prpMyReturns(sid, opt) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  opt = opt || {};

  try {
    var days = parseInt(opt.days, 10) || PRP_DEFAULT_DAYS;
    var rows = prpLoadVendorCases_(g.sess, days, !!opt.refresh);

    var active = 0, done = 0, feeSum = 0;
    var todayYmd = prpDaysAgoYmd_(0);
    var todayCount = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].done) done++; else active++;
      feeSum += rows[i].feeNum || 0;
      if (rows[i].dateYmd === todayYmd) todayCount++;
    }

    return {
      ok: true,
      vendor: g.sess.vendor,
      days: days,
      rows: rows,
      summary: {
        total: rows.length,
        active: active,
        done: done,
        today: todayCount,
        feeSum: feeSum,
        feeSumText: prpFormatFee_(feeSum)
      }
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e), rows: [] };
  }
}

/**
 * 업체 신규 반품 접수.
 * CS 웹앱 submitReturnLedger 와 같은 열에 쓰지만, 아래는 서버가 강제한다.
 *   D열 업체명  = 세션 업체 (클라이언트 값 무시)
 *   C열 접수자  = "업체:{업체명}"
 *   A열 상태    = 접수
 *   M열 반품비  = 쓰지 않는다 (운영자가 정한다)
 */
function prpSubmitReturn(sid, data) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  data = data || {};
  var sess = g.sess;

  var name = String(data.name || "").trim();
  var item = String(data.item || "").trim();
  if (!name) return { ok: false, error: "반품신청자(수취인) 이름을 입력해 주세요." };
  if (!item) return { ok: false, error: "상품명을 입력해 주세요." };

  /* ══════════════════════════════════════════════════════════════
     ★ 출처를 서버가 다시 확인한다 ★  (2026-09-20)

     > "오류로 다른 업체 물건이 삽입될수도 있으니"

     화면이 「조회해서 찾았어요」라고 보내는 말은 믿지 않는다. 조회한 뒤에
     품목칸을 고쳐 적을 수도 있고, 조회를 아예 안 하고 보낼 수도 있다.
     그 업체 배포파일만 여니, 거기서 찾혔다는 것이 곧 「이 업체 물건」이다.

     ★ 막지 않는다 ★ 막으면 업체는 전화로 돌아간다. 그건 이 앱을 만든
       까닭을 되돌리는 일이다. 대신 못 찾은 건은 «사진»을 받는다 —
       CS 가 사진 한 장으로 우리 물건인지 바로 안다.
     ══════════════════════════════════════════════════════════════ */
  var 출처 = { level: PRP_ORIGIN_UNKNOWN_, why: "확인하지 못했습니다", hit: null };
  try { 출처 = prpVerifyOrigin_(sess, data); } catch (eOrg) {}

  if (출처.level !== PRP_ORIGIN_OK_) {
    var 사진수 = parseInt(data.photoCount, 10) || 0;
    if (사진수 < 1) {
      return {
        ok: false,
        needPhoto: true,
        origin: 출처.level,
        message: (출처.level === PRP_ORIGIN_MISMATCH_
          ? "발주 마감의 상품과 다릅니다 — " + 출처.why + "."
          : "발주 마감에서 이 주문을 찾지 못했습니다 — " + 출처.why + ".") +
          "\n\n상품 사진을 한 장 이상 올려 주시면 접수됩니다. CS팀이 사진으로 확인합니다."
      };
    }
  }

  var lock = LockService.getScriptLock();
  try {
    // 두 업체가 같은 순간에 접수하면 같은 행에 겹쳐 쓸 수 있다
    lock.waitLock(20000);
  } catch (eLock) {
    return { ok: false, error: "잠시 후 다시 시도해 주세요. (다른 접수가 처리 중입니다)" };
  }

  try {
    var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
    var tab = prpGetWriteTab_(ss);
    if (!tab) return { ok: false, error: "반품관리대장 탭을 찾을 수 없습니다. 운영자에게 알려 주세요." };

    var lastCol = Math.max(tab.getLastColumn(), 15);
    var lastRow = Math.max(tab.getLastRow(), 1);
    var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    var headerIdx = prpFindHeaderRow_(values);
    if (headerIdx < 0) return { ok: false, error: "반품대장 헤더를 찾지 못했습니다. 운영자에게 알려 주세요." };

    var col = prpMapCols_(values[headerIdx]);
    if (col.vendor < 0) return { ok: false, error: "업체명 열을 찾지 못해 접수할 수 없습니다." };

    var invoice = prpFormatInvoice_(data.invoice);
    var invDigits = prpDigits_(invoice);

    // 같은 송장 중복 접수 방지 — 이 업체 건에 한해서만 본다
    if (!data.force && invDigits.length >= 8 && col.invoice >= 0) {
      for (var ri = headerIdx + 1; ri < values.length; ri++) {
        var r = values[ri];
        if (!prpRowBelongsTo_(r[col.vendor], sess)) continue;
        if (prpDigits_(r[col.invoice]) === invDigits) {
          return {
            ok: false,
            duplicate: true,
            message: "같은 송장(" + invoice + ")으로 이미 접수된 건이 있습니다. 그래도 추가할까요?"
          };
        }
      }
    }

    var row = [];
    for (var c = 0; c < lastCol; c++) row.push("");

    if (col.status >= 0) row[col.status] = PRP_INITIAL_STATUS;
    if (col.date >= 0) row[col.date] = prpToday_("yyMMdd");
    if (col.staff >= 0) row[col.staff] = PRP_STAFF_PREFIX + sess.vendor;
    if (col.vendor >= 0) row[col.vendor] = sess.vendor;
    if (col.name >= 0) row[col.name] = name;
    if (col.phone >= 0) row[col.phone] = prpFormatPhone_(data.phone);
    /* ★ 2026-09-09: 실 전화번호 ★
       고유아이디로 불러오면 주문에 적힌 번호가 딸려 오는데 안심번호(0504-…)인
       경우가 많다. 안심번호는 배송이 끝나면 끊겨서, 회수 기사가 걸면 안 받는
       번호가 된다. 업체가 아는 실제 번호를 여기 적는다.

       ★ 주 연락처를 덮지 않는다 ★
         둘 다 남긴다. 안심번호로 걸어야 하는 건도 있고, 나중에 「그때 어떤
         번호를 받았나」를 봐야 할 때가 있다. 대장의 「추가연락처」 열이 그 자리다.

       열이 없는 옛 탭이면 조용히 버리지 않고 비고에 남긴다 (아래 memo). */
    if (col.phone2 >= 0 && String(data.phone2 || "").trim()) {
      row[col.phone2] = prpFormatPhone_(data.phone2);
    }
    /* 실번호의 주인 이름. 전용 열이 있을 때만 여기서 적고,
       없으면 아래 비고에 번호와 함께 따라 붙는다 — 조용히 버리지 않는다. */
    var p2NameIn = String(data.phone2Name || "").trim().substring(0, 20);
    if (col.phone2Name >= 0 && p2NameIn) {
      row[col.phone2Name] = p2NameIn;
    }
    if (col.pickup >= 0) row[col.pickup] = String(data.pickup || "").trim();
    if (col.item >= 0) row[col.item] = item;
    if (col.qty >= 0) row[col.qty] = String(data.qty || "1").trim();
    if (col.invoice >= 0) row[col.invoice] = invoice;
    if (col.type >= 0) row[col.type] = String(data.type || "단순반품").trim();

    var memo = String(data.memo || "").replace(/\s+/g, " ").trim();
    var uid = prpUidFromCell_(data.uid);
    /* 추가연락처 열이 없는 옛 탭에서는 비고에 남긴다.
       조용히 버리면 업체는 적었는데 아무 데도 없는 번호가 된다. */
    var p2 = String(data.phone2 || "").trim();
    var p2Lost = p2 && col.phone2 < 0;
    //  이름도 적을 열이 없으면 비고로 흘린다
    var p2NameLost = p2NameIn && col.phone2Name < 0;

    /*  ★ 출처를 비고에 남긴다 ★
        대장에 열을 하나 더 만들면 CS웹앱·허브·이관 스크립트가 모두 열 번호를
        다시 세야 한다. 비고 한 줄이면 이미 그 줄을 읽는 화면들이 그대로 본다.
        글머리를 고정 문구로 둔다 — CS웹앱이 이 문구로 뱃지를 세운다.  */
    var 출처줄 = 출처.level === PRP_ORIGIN_OK_
      ? "[출처 확인됨] " + (출처.why ? 출처.why + "에서 확인" : "장부에서 확인")
      : (출처.level === PRP_ORIGIN_MISMATCH_
          ? "[출처 어긋남] " + 출처.why
          : "[출처 미확인] " + 출처.why);

    if (col.notice >= 0) {
      row[col.notice] = prpStamp_(PRP_STAFF_PREFIX + sess.vendor) +
        " 업체 포털 접수. " + 출처줄 + "." +
        (uid ? " 고유ID " + uid + "." : "") +
        (p2Lost ? " 실번호 " + prpFormatPhone_(p2) +
           (p2NameIn ? " (" + p2NameIn + ")" : "") + "." : "") +
        (!p2Lost && p2NameLost ? " 실번호 " + prpFormatPhone_(p2) +
           " (" + p2NameIn + ")." : "") +
        (memo ? " " + memo : "");
    }

    var dest = prpNextDestRow_(values, headerIdx, col);
    tab.getRange(dest, 1, 1, lastCol).setValues([row]);
    // 위 행 서식을 물려받아 대장 모양이 깨지지 않게 한다
    if (dest > headerIdx + 2) {
      try {
        tab.getRange(dest - 1, 1, 1, lastCol)
          .copyTo(tab.getRange(dest, 1, 1, lastCol), { formatOnly: true });
        tab.getRange(dest, 1, 1, lastCol).setValues([row]);
      } catch (eFmt) {}
    }

    prpInvalidateVendorCache_(sess.key);
    prpLog_(sess.vendor, "접수", tab.getName() + " " + dest + "행 · " + name + " · " + item);
    prpNotifyChat_(
      출처.level === PRP_ORIGIN_OK_ ? "새 반품 접수" : "새 반품 접수 · 출처 " + 출처.level,
      sess.vendor,
      name + " · " + item +
        (invoice ? " · 송장 " + invoice : "") +
        (uid ? " · 고유ID " + uid : "") +
        (출처.level === PRP_ORIGIN_OK_ ? "" : "\n⚠ " + 출처.why + " — 사진으로 확인해 주세요"));

    return {
      ok: true,
      tab: tab.getName(),
      row: dest,
      origin: 출처.level,
      message: 출처.level === PRP_ORIGIN_OK_
        ? "접수되었습니다. CS팀이 확인 후 상태를 갱신합니다."
        : "접수되었습니다. 발주 마감에서 주문을 못 찾아 CS팀이 사진으로 먼저 확인합니다."
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    try { lock.releaseLock(); } catch (eR) {}
  }
}

/**
 * 헤더 아래 실제 데이터의 **다음** 행 (1-기반 시트 행).
 * CS 웹앱 `_cs_mapReturnLedgerCols_` 와 같은 규칙이며 **쌍으로 고친다.**
 *
 * ★ `values` 는 0-기반, 시트 행은 1-기반 — 인덱스 i 의 시트 행은 i+1 이므로
 *   마지막 데이터 인덱스 `lastData` 의 **다음 빈 행은 lastData+2** 다.
 *   +1 을 쓰면 마지막 행을 도로 가리켜 덮어쓴다 (접수해도 한 건만 남는다).
 *
 * 검사는 `node _return_append_test.js` `[4]` 항목이 CS 쪽과 답을 맞춰 본다.
 */
function prpNextDestRow_(values, headerIdx, col) {
  var lastData = headerIdx;
  var keyCols = [col.date, col.invoice, col.name, col.item, col.phone].filter(function (c) {
    return c >= 0;
  });
  if (!keyCols.length) keyCols = [col.date, col.invoice, col.name];

  for (var i = headerIdx + 1; i < values.length; i++) {
    var row = values[i] || [];
    for (var k = 0; k < keyCols.length; k++) {
      var v = String(row[keyCols[k]] || "").trim();
      if (v && v !== "-") { lastData = i; break; }
    }
  }
  // lastData(인덱스) → 시트 행 lastData+1 → 그 다음 행 lastData+2
  return Math.max(lastData + 2, headerIdx + 2);
}

/**
 * 업체 문의 추가 — N열에 append 한다.
 * 작성자를 "업체:{업체명}"으로 찍어야 포털에서 다시 공개 대상으로 잡힌다.
 */
function prpAddInquiry(sid, payload) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  payload = payload || {};

  var text = String(payload.text || "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, error: "문의 내용을 입력해 주세요." };
  if (text.length > 500) text = text.substring(0, 500);

  try {
    var ctx = prpOpenOwnedRow_(g.sess, payload.tab, payload.row);
    if (ctx.col.notice < 0) return { ok: false, error: "비고 열을 찾지 못했습니다." };

    var notice = String(ctx.row[ctx.col.notice] || "").trim();
    notice = prpAppendNoticeLine_(notice,
      prpStamp_(PRP_STAFF_PREFIX + g.sess.vendor) + " 문의. " + text);
    ctx.tab.getRange(ctx.rowNum, ctx.col.notice + 1).setValue(notice);

    prpInvalidateVendorCache_(g.sess.key);
    prpLog_(g.sess.vendor, "문의", payload.tab + " " + payload.row + "행 · " + text.substring(0, 80));
    prpNotifyChat_("업체 문의", g.sess.vendor, text.substring(0, 200));

    // CS 커뮤니티 보드에도 카드를 남긴다. 비고에만 쌓이면 CS가 그 건을
    // 열어보지 않는 한 문의가 온 줄 모른다.
    // 보드 기록은 부가 기능이다 — 실패해도 문의는 성공시키고 사실만 로그에 남긴다.
    var board = prpPostInquiryToBoard_({
      tab: payload.tab, row: payload.row,
      vendor: g.sess.vendor, text: text,
      name: ctx.col.name >= 0 ? String(ctx.row[ctx.col.name] || "").trim() : "",
      item: ctx.col.item >= 0 ? String(ctx.row[ctx.col.item] || "").trim() : "",
      status: String(ctx.row[0] || "").trim(),
      invoice: ctx.col.invoice >= 0 ? String(ctx.row[ctx.col.invoice] || "").trim() : "",
      returnInvoice: ctx.col.returnInvoice >= 0
        ? String(ctx.row[ctx.col.returnInvoice] || "").trim() : ""
    });
    if (!board || !board.ok) {
      prpLog_(g.sess.vendor, "보드실패", (board && board.error) || "원인 미상");
    } else {
      prpLog_(g.sess.vendor, "보드기록",
        (board.mode === "append" ? "기존 카드에 추가 " : "새 카드 ") + (board.id || ""));
    }

    return { ok: true, message: "문의가 전달되었습니다." };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** 월별 반품비 집계 */
function prpFeeSummary(sid, opt) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  opt = opt || {};

  try {
    var days = parseInt(opt.days, 10) || 365;
    var rows = prpLoadVendorCases_(g.sess, days, !!opt.refresh);
    var byMonth = {};

    for (var i = 0; i < rows.length; i++) {
      var ymd = String(rows[i].dateYmd || "");
      var mk = ymd ? ymd.substring(0, 6) : "미상";
      if (!byMonth[mk]) byMonth[mk] = { month: mk, count: 0, fee: 0 };
      byMonth[mk].count++;
      byMonth[mk].fee += rows[i].feeNum || 0;
    }

    var list = Object.keys(byMonth).map(function (k) {
      var o = byMonth[k];
      o.feeText = prpFormatFee_(o.fee);
      return o;
    });
    list.sort(function (a, b) { return String(b.month).localeCompare(String(a.month)); });

    return { ok: true, months: list };
  } catch (e) {
    return { ok: false, error: e.message || String(e), months: [] };
  }
}

// ── Google Chat 알림 ─────────────────────────────────────────

/**
 * 업체 접수·문의를 CS 에 알린다.
 * CS 웹앱은 별도 프로젝트라 캐시를 지워 줄 수 없다. CS앱 반품 목록은 최대 10분
 * 뒤에 반영되므로, 즉시 인지가 필요하면 이 알림이 그 역할을 한다.
 * webhook 이 설정되어 있지 않으면 조용히 넘어간다.
 */
function prpNotifyChat_(title, vendor, detail) {
  var url = "";
  try {
    url = PropertiesService.getScriptProperties().getProperty(PRP_CHAT_WEBHOOK_PROP) || "";
  } catch (e) {}
  if (!url) return;

  try {
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      payload: JSON.stringify({
        text: "*" + title + "* — " + vendor + "\n" + detail
      }),
      muteHttpExceptions: true,
      headers: { "Expect": "" }
    });
  } catch (e) {
    Logger.log("[PRP] Chat 알림 실패: " + e.message);
  }
}
