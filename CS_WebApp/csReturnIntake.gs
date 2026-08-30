/**
 * 반품 현장 입고 — 반품송장 스캔 → 반품관리대장 처리상태 "반품입고"
 * SSOT: 반품관리대장 (csOrderSearch.gs)
 */

function _cs_normalizeInvDigits_(raw) {
  return String(raw || "").replace(/[^0-9]/g, "");
}

function _cs_returnInvMatchesCase_(caseRow, digits) {
  if (!digits || digits.length < 8) return null;
  if (caseRow.returnInvDigits && caseRow.returnInvDigits === digits) {
    return { via: "return_invoice_notice" };
  }
  var fromNotice = _cs_parseReturnInvFromNotice_(caseRow.notice || "").replace(/[^0-9]/g, "");
  if (fromNotice && fromNotice === digits) {
    return { via: "return_invoice_notice" };
  }
  if (caseRow.invDigits && caseRow.invDigits === digits) {
    return { via: "original_invoice_warn" };
  }
  return null;
}

/**
 * 반품송장 번호로 입고 대상 검색 (최근 N일, 기본 진행 중만)
 */
function csFindReturnIntakeMatches(returnInvoice, opt) {
  opt = opt || {};
  var parsed = csParseCourierBarcode(returnInvoice);
  var digits = parsed.ok ? parsed.digits : _cs_normalizeInvDigits_(returnInvoice);
  if (digits.length < 8) {
    return { ok: false, error: "반품송장 8자리 이상 입력하세요." };
  }

  var days = opt.days || 60;
  var includeDone = !!opt.includeDone;
  var refresh = !!opt.refresh;
  var rows = _cs_loadReturnLedgerCases_(days, !includeDone, refresh);

  var matches = [];
  for (var i = 0; i < rows.length; i++) {
    var c = rows[i];
    var m = _cs_returnInvMatchesCase_(c, digits);
    if (!m) continue;
    matches.push({
      tab: c.tab,
      row: c.row,
      name: c.name,
      item: c.item,
      status: c.status,
      invoice: c.invoice,
      returnInvoice: c.returnInvoice || _cs_parseReturnInvFromNotice_(c.notice),
      matchVia: m.via,
      active: c.active,
      alreadyIntake: String(c.status || "").replace(/\s/g, "") === "반품입고"
    });
  }

  return {
    ok: true,
    returnInvoice: String(returnInvoice || "").trim(),
    digits: digits,
    matches: matches,
    count: matches.length
  };
}

/**
 * 반품송장 스캔 처리
 * - 1건 매칭: 반품입고 + 비고 이력
 * - 다건: needPick
 * - 0건: 신규 행 (현장입고) + 반품입고
 */
function csProcessReturnIntake(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var returnInv = String(payload.returnInvoice || "").trim();
  var staff = String(payload.staff || "현장").trim();

  var parsed = csParseCourierBarcode(returnInv);
  if (parsed.ok && parsed.invoice) {
    returnInv = parsed.invoice;
  }

  var digits = _cs_normalizeInvDigits_(returnInv);
  if (digits.length < 8) {
    return { ok: false, error: "반품송장 8자리 이상 필요합니다." };
  }

  var tab = String(payload.tab || "").trim();
  var row = parseInt(payload.row, 10);
  if (tab && row > 0) {
    return _cs_intakeExistingReturn_(tab, row, returnInv, staff, payload.matchVia || "manual_pick");
  }

  var found = csFindReturnIntakeMatches(returnInv, { days: 60, includeDone: false, refresh: true });
  if (!found.ok) return found;

  if (found.count === 1) {
    var m = found.matches[0];
    return _cs_intakeExistingReturn_(m.tab, m.row, returnInv, staff, m.matchVia);
  }

  if (found.count > 1) {
    return {
      ok: false,
      needPick: true,
      matches: found.matches,
      returnInvoice: returnInv,
      message: found.count + "건이 매칭됩니다. 해당 건을 선택하세요."
    };
  }

  return _cs_intakeCreateNewReturn_(returnInv, staff, payload);
}

function _cs_intakeExistingReturn_(tabName, rowNum, returnInv, staff, matchVia) {
  try {
    var ctx = _cs_openReturnLedgerRow_(tabName, rowNum);
    var notice = ctx.col.notice >= 0 ? String(ctx.row[ctx.col.notice] || "").trim() : "";
    var digits = _cs_normalizeInvDigits_(returnInv);
    var formatted = _cs_formatLedgerInvoice_(returnInv);

    // 반품송장은 전용 열이 있으면 그 열에 쓴다. 열이 없는 과거 탭에서만 비고에 남긴다.
    if (ctx.col.returnInvoice >= 0) {
      var cur = String(ctx.row[ctx.col.returnInvoice] || "").replace(/[^0-9]/g, "");
      if (cur !== digits) {
        ctx.tab.getRange(rowNum, ctx.col.returnInvoice + 1).setValue(formatted);
      }
    } else {
      var hasRetInv = false;
      if (_cs_parseReturnInvFromNotice_(notice).replace(/[^0-9]/g, "") === digits) hasRetInv = true;
      if (notice.indexOf(digits) >= 0) hasRetInv = true;

      if (!hasRetInv && ctx.col.notice >= 0) {
        notice = _cs_appendNoticeLine_(notice, "반품송장: " + formatted);
        ctx.tab.getRange(rowNum, ctx.col.notice + 1).setValue(notice);
      }
    }

    var consult = appendReturnConsultation({
      tab: tabName,
      row: rowNum,
      text: "현장입고 스캔 · " + formatted + (matchVia === "original_invoice_warn" ? " (원송장 일치)" : ""),
      staff: staff
    });
    if (!consult.ok) return consult;

    var statusRes = updateReturnLedgerStatus({
      tab: tabName,
      row: rowNum,
      status: "반품입고",
      staff: staff
    });
    if (!statusRes.ok) return statusRes;

    var name = ctx.col.name >= 0 ? String(ctx.row[ctx.col.name] || "").trim() : "";
    var item = ctx.col.item >= 0 ? String(ctx.row[ctx.col.item] || "").trim() : "";
    return {
      ok: true,
      action: "updated",
      tab: tabName,
      row: rowNum,
      name: name,
      item: item,
      status: "반품입고",
      matchVia: matchVia || "",
      returnInvoice: formatted,
      message: tabName + " " + rowNum + "행 · 반품입고 처리"
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function _cs_intakeCreateNewReturn_(returnInv, staff, payload) {
  payload = payload || {};
  var formatted = _cs_formatLedgerInvoice_(returnInv);
  var orderHint = null;

  if (typeof lookupByInvoice === "function") {
    try { orderHint = lookupByInvoice(returnInv); } catch (eL) {}
  }

  var data = {
    staff: staff,
    type: "현장입고",
    status: "반품입고",
    // 반품송장은 전용 열로 들어간다. 열이 없는 탭이면 submitReturnLedger 가 비고로 돌린다.
    returnInvoice: formatted,
    memo: "현장 스캔 신규 접수",
    force: true
  };

  if (orderHint && orderHint.found) {
    data.name = orderHint.recipientName || "";
    data.phone = orderHint.recipientPhone || "";
    data.item = orderHint.productName || "";
    data.qty = orderHint.quantity || "";
    data.vendor = orderHint.vendor || "";
    data.invoice = orderHint.invoiceNumber || "";
    data.orderHintSource = orderHint.source || "";
  }

  if (payload.name) data.name = String(payload.name).trim();
  if (payload.item) data.item = String(payload.item).trim();
  if (payload.phone) data.phone = String(payload.phone).trim();

  var res = submitReturnLedger(data);
  if (!res.success) {
    return {
      ok: false,
      error: res.error || "반품대장 기록 실패",
      duplicate: !!res.duplicate,
      existingRow: res.existingRow
    };
  }

  var statusRes = updateReturnLedgerStatus({
    tab: res.sheet,
    row: res.row,
    status: "반품입고",
    staff: staff
  });
  if (!statusRes.ok) {
    return {
      ok: true,
      action: "created_partial",
      tab: res.sheet,
      row: res.row,
      warning: "행은 생성됐으나 상태 변경 실패: " + statusRes.error,
      message: res.message
    };
  }

  return {
    ok: true,
    action: "created",
    tab: res.sheet,
    row: res.row,
    name: data.name || "",
    item: data.item || "",
    status: "반품입고",
    returnInvoice: formatted,
    orderHint: orderHint && orderHint.found ? {
      source: orderHint.source,
      name: orderHint.recipientName,
      item: orderHint.productName
    } : null,
    message: res.message + " · 반품입고"
  };
}

/** 진단 — 반품송장 샘플 매칭 점검 */
function csDiagnoseReturnIntake(sampleInvoice) {
  var inv = sampleInvoice || "12345678901";
  var found = csFindReturnIntakeMatches(inv, { days: 60, includeDone: true, refresh: true });
  return {
    ok: found.ok,
    sample: inv,
    count: found.count,
    matches: (found.matches || []).slice(0, 5),
    error: found.error || ""
  };
}
