/**
 * ═══════════════════════════════════════════════════════════════
 *  아주팩 Gmail 송장번호 자동수집
 *  파일: _partnerGmailInvoiceAJ.gs
 *  ★ 2026-10-14 신규
 *
 *  > "우리 협력업체 시스템의 아주팩에 송장번호를 넣어주면 되는데"
 *  > "A열에 이름과 품목 수량을 보고 넣으면 돼"
 *
 *  hspack2020@naver.com 이 매일 오후 3시쯤 보내는
 *  「택배송장_주식회사 팩투유.xlsx」 첨부를 읽어서
 *  [협력업체] 아주팩 → 「전용양식」 A열(송장번호)에 넣는다.
 *
 *  ★ 매칭 규칙 ★
 *    받는분 성명(F) 이 같아야 한다 — 이것이 기본 조건.
 *    그 위에서 품목명(I) 이 가장 비슷한 줄, 박스수량(J) 이 같으면 가산.
 *    엑셀에 전화번호가 있으면 받는분 전화번호(G) 로도 가산한다.
 *    세트 상품은 _S1/_S2 로 줄이 나뉘고 줄마다 송장이 따로 나온다 —
 *    그래서 「이름만 같으면 넣는다」로는 안 되고 품목을 반드시 본다.
 *
 *  ★ 절대 하지 않는 것 ★
 *    - 이미 송장이 있는 A열은 덮어쓰지 않는다.
 *    - 이미 시트 어딘가에 들어간 송장번호는 다시 넣지 않는다 (재실행 안전).
 *    - 애매하면 넣지 않는다. 미매칭으로 남겨 사람에게 알린다.
 *      틀린 송장이 들어가면 16:40 송장수집 → 16:50 배포로 그대로 고객에게 간다.
 *
 *  ★ 왜 Drive 변환을 안 쓰나 ★
 *    이 프로젝트 매니페스트에는 Drive 고급 서비스가 없다(dependencies 비어 있음).
 *    xlsx 는 zip 이므로 Utilities.unzip + XmlService 로 직접 읽는다.
 *    임시 파일도 안 생기고, 고급 서비스 설정에 기대지 않는다.
 *
 *  실행:
 *    자동 — 16:00 냅킨코리아 송장수집 트리거 안에서 이어서 돈다
 *           (트리거 자리를 새로 쓰지 않는다. 16:40 송장수집보다 먼저 끝난다)
 *    수동 — 메뉴 → 📧 아주팩 Gmail 송장 수집
 *    예행 — 메뉴 → 🧪 아주팩 Gmail 송장 예행 (시트에 안 쓰고 결과만 보여준다)
 * ═══════════════════════════════════════════════════════════════
 */

// ── 설정 상수 ──────────────────────────────────────────────────
var _GMA_AJ_PREFIX = "AJ";
var _GMA_SEARCH_QUERY = "from:hspack2020@naver.com 택배송장 has:attachment";
var _GMA_PROCESSED_LABEL = "P2U_아주팩송장처리완료";
var _GMA_LOOKBACK_DAYS = 2; // 날짜 경계(자정 직후 실행 등)에 안전하게

// ═════════════════════════════════════════════════════════════════
//  1. 진입점
// ═════════════════════════════════════════════════════════════════

/** 메뉴 — 실제로 A열에 기록 */
function partnerFetchInvoiceFromGmail_AJ_Manual() {
  _gma_runWithUi_(false);
}

/** 메뉴 — 예행: 시트에 쓰지 않고 무엇을 넣을지만 보여준다 */
function partnerFetchInvoiceFromGmail_AJ_Preview() {
  _gma_runWithUi_(true);
}

function _gma_runWithUi_(dryRun) {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    if (ui) ui.alert("⚠️ 다른 작업이 실행 중입니다. 잠시 후 다시 시도하세요.");
    return;
  }
  try {
    var r = _gma_processAJInvoiceMails_({ manual: true, dryRun: dryRun });
    if (ui) ui.alert(_gma_summaryText_(r, dryRun));
    _gmi_log_("AJ " + (dryRun ? "예행" : "수동") + ": " + _gma_oneLine_(r));
  } catch (e) {
    _gmi_log_("❌ AJ Gmail 송장수집 실패: " + (e.message || e));
    if (ui) ui.alert("❌ 오류 발생:\n" + (e.message || e));
  } finally {
    lock.releaseLock();
  }
}

/**
 * 트리거용 — _gmi_triggerFetchNKInvoice_ 안에서 이미 잠금을 잡은 채로 부른다.
 * 여기서 다시 잠그지 않는다.
 */
function _gma_triggerFetchAJInvoice_() {
  var r;
  try {
    r = _gma_processAJInvoiceMails_({ manual: false, dryRun: false });
  } catch (e) {
    _gmi_log_("❌ AJ Gmail 송장수집 에러: " + (e.message || e));
    try {
      _chat_sendCard_("❌ 아주팩 Gmail 송장 에러",
        Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
        [{ label: "오류", value: String(e.message || e).substring(0, 200) }]);
    } catch (_) {}
    return;
  }

  _gmi_log_("AJ 자동: " + _gma_oneLine_(r));

  // 메일이 없으면 조용히 끝낸다 (휴무일 등)
  if (r.mailCount === 0 && !r.errors.length) return;

  try {
    var timeStr = Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm");
    var icon = r.errors.length ? "❌" : (r.unmatched.length ? "⚠️" : "✅");
    var kv = [
      { label: "📧 메일", value: r.mailCount + "건" },
      { label: "🔍 엑셀에서 읽은 송장", value: r.parsedCount + "개" },
      { label: "✅ A열 입력", value: r.written.length + "건" },
    ];
    if (r.alreadyIn) kv.push({ label: "↩️ 이미 입력됨", value: r.alreadyIn + "건" });
    if (r.unmatched.length) {
      kv.push({ label: "❌ 미매칭", value: r.unmatched.length + "건" });
      kv.push({ label: "📋 미매칭 상세", value: _gma_unmatchedText_(r.unmatched, 5) });
    }
    if (r.stillEmpty.length) {
      kv.push({ label: "⬜ 아직 송장 없는 줄", value: r.stillEmpty.length + "줄 — " +
        r.stillEmpty.slice(0, 5).map(function (x) { return x.row + "행 " + x.name + "/" + x.item; }).join(", ") });
    }
    if (r.errors.length) kv.push({ label: "⚠ 오류", value: r.errors.slice(0, 3).join("; ") });
    _chat_sendCard_(icon + " 아주팩 Gmail 송장수집",
      "입력 " + r.written.length + " · 미매칭 " + r.unmatched.length + " (" + timeStr + ")", kv);
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════
//  2. 핵심 처리
// ═════════════════════════════════════════════════════════════════

/**
 * @param {{manual:boolean, dryRun:boolean}} opt
 * @return {{mailCount:number, parsedCount:number, alreadyIn:number,
 *           written:Array, unmatched:Array, errors:Array, headerInfo:Array}}
 */
function _gma_processAJInvoiceMails_(opt) {
  opt = opt || {};
  var res = {
    mailCount: 0, parsedCount: 0, alreadyIn: 0,
    written: [], unmatched: [], stillEmpty: [], errors: [], headerInfo: []
  };

  // ── 1) 메일 찾기 ──
  var query = _GMA_SEARCH_QUERY + " newer_than:" + _GMA_LOOKBACK_DAYS + "d";
  // 수동/예행은 처리완료 라벨이 붙은 것도 다시 본다 (재실행해도 안전 — 중복 입력 안 함)
  if (!opt.manual) query += " -label:" + _GMA_PROCESSED_LABEL;

  var threads;
  try {
    threads = GmailApp.search(query, 0, 20);
  } catch (e) {
    res.errors.push("Gmail 검색 실패: " + e.message);
    return res;
  }
  if (!threads || !threads.length) return res;

  // ── 2) 첨부 엑셀 읽기 ──
  var entries = [];
  for (var ti = 0; ti < threads.length; ti++) {
    var msgs = threads[ti].getMessages();
    for (var mi = 0; mi < msgs.length; mi++) {
      var msg = msgs[mi];
      if (String(msg.getFrom() || "").toLowerCase().indexOf("hspack2020") === -1) continue;
      res.mailCount++;
      var atts = msg.getAttachments() || [];
      for (var ai = 0; ai < atts.length; ai++) {
        var att = atts[ai];
        var nm = String(att.getName() || "").toLowerCase();
        if (!/\.xlsx$/.test(nm)) continue;
        try {
          var rows = _gma_readXlsxFirstSheet_(att.copyBlob());
          var parsed = _gma_parseInvoiceRows_(rows);
          res.headerInfo.push(att.getName() + " → " + parsed.headerDesc);
          for (var ei = 0; ei < parsed.entries.length; ei++) entries.push(parsed.entries[ei]);
        } catch (e) {
          res.errors.push(att.getName() + " 읽기 실패: " + e.message);
        }
      }
    }
  }

  // 같은 송장번호가 메일 두 통에 겹쳐 오면 하나만
  var seenTrk = {};
  entries = entries.filter(function (e) {
    if (seenTrk[e.tracking]) return false;
    seenTrk[e.tracking] = true;
    return true;
  });
  res.parsedCount = entries.length;
  if (!entries.length) {
    if (res.mailCount) res.errors.push("메일은 있으나 엑셀에서 송장번호를 못 읽었습니다");
    return res; // 라벨 안 붙임 — 다음 실행에서 다시 본다
  }

  // ── 3) 아주팩 전용양식 ──
  var tabInfo = _gma_findAJExclusiveTab_();
  if (!tabInfo) {
    res.errors.push("아주팩 전용양식 탭을 찾을 수 없습니다");
    return res;
  }
  var tab = tabInfo.tab;
  var lr = tab.getLastRow();
  if (lr < 2) {
    res.errors.push("전용양식에 주문 줄이 없습니다");
    return res;
  }
  var lc = Math.max(tab.getLastColumn(), 10);
  var header = tab.getRange(1, 1, 1, lc).getValues()[0];
  var col = _gma_exclusiveCols_(header);
  var colA = tab.getRange(2, 1, lr - 1, 1).getValues(); // A열만 쓴다
  var body = tab.getRange(2, 1, lr - 1, lc).getValues();

  // 이미 들어간 송장 — 재실행 안전장치
  // ★ 박스가 여러 개면 한 칸에 송장이 줄바꿈으로 여러 개 들어 있다 (마감탭 실례: 박스 4 → 송장 4줄)
  var existing = {};
  for (var r0 = 0; r0 < colA.length; r0++) {
    _gma_trackingsIn_(colA[r0][0]).forEach(function (t) { existing[t] = true; });
  }

  // 빈 A열 후보 줄
  var cands = [];
  for (var r = 0; r < body.length; r++) {
    if (_gma_trackingsIn_(colA[r][0]).length) continue;
    var nmv = _gma_normName_(body[r][col.name]);
    if (!nmv) continue;
    cands.push(_gma_makeCand_(r, body[r], col));
  }

  // ── 4) 매칭 ──
  for (var k = 0; k < entries.length; k++) {
    var e = entries[k];
    if (existing[e.tracking]) { res.alreadyIn++; continue; }

    var pick = _gma_pickRow_(e, cands);
    if (!pick.row) {
      res.unmatched.push({ name: e.rawName, item: e.rawItem, qty: e.qty, tracking: e.tracking, why: pick.why });
      continue;
    }
    _gma_assign_(pick.row, e.tracking);
    existing[e.tracking] = true;
    res.written.push({
      row: pick.row.idx + 2, tracking: e.tracking,
      name: pick.row.rawName, item: pick.row.rawItem, score: pick.score
    });
  }

  // 한 줄에 송장 여러 개면 줄바꿈으로 — 마감탭과 같은 모양
  cands.forEach(function (c) {
    if (c.got.length) colA[c.idx][0] = c.got.join("\n");
  });

  /* ★ 아직 송장이 없는 줄을 숨기지 않는다 ★
     한 박스에 몸통+뚜껑을 담으면 송장 하나가 두 줄 몫이다 (마감탭 실례 28건).
     엑셀에는 그 송장이 한 번만 오므로 한 줄은 빈다. 어느 줄에 같은 송장을
     넣을지는 박스 구성을 알아야 해서 자동으로 넣지 않고 사람에게 보여준다. */
  if (res.written.length) {
    cands.forEach(function (c) {
      if (!c.got.length) res.stillEmpty.push({ row: c.idx + 2, name: c.rawName, item: c.rawItem });
    });
  }

  // ── 5) 기록 (A열만) ──
  if (!opt.dryRun && res.written.length) {
    tab.getRange(2, 1, colA.length, 1).setNumberFormat("@").setValues(colA);
    SpreadsheetApp.flush();
  }

  // ── 6) 라벨 — 실제 실행이고 오류가 없을 때만 ──
  if (!opt.dryRun && !res.errors.length) _gma_labelThreads_(threads);

  return res;
}

/** 전용양식 한 줄 → 매칭 후보. cap = 박스수량(받을 수 있는 송장 수) */
function _gma_makeCand_(idx, row, col) {
  var qty = _gma_num_(row[col.qty]);
  return {
    idx: idx,
    name: _gma_normName_(row[col.name]),
    rawName: String(row[col.name] || "").trim(),
    phone: _gma_phoneKey_(row[col.phone]),
    item: _gma_normItem_(row[col.item]),
    rawItem: String(row[col.item] || "").trim(),
    qty: qty,
    cap: Math.max(1, Math.floor(qty) || 1),
    got: [],
    used: false
  };
}

/** 줄에 송장 하나를 배정. 박스 수만큼 차면 더는 안 받는다. */
function _gma_assign_(cand, tracking) {
  cand.got.push(tracking);
  if (cand.got.length >= cand.cap) cand.used = true;
}

/** 칸 안의 송장번호들 (줄바꿈·쉼표 구분, 10~14자리) */
function _gma_trackingsIn_(v) {
  return String(v == null ? "" : v).replace(/-/g, "").match(/\d{10,14}/g) || [];
}

/**
 * 한 송장에 맞는 줄 고르기.
 *
 *  1) 받는분(이름 또는 전화) 이 같은 줄만 본다.
 *  2) 그 사람의 줄을 「품목」별로 묶고, 엑셀 품목과 가장 닮은 품목을 고른다.
 *     ★ 박스 수가 찼다고 다음으로 닮은 품목으로 넘어가지 않는다 ★
 *       (2026-06-05 실례: 캡 줄이 차자 캡 송장이 같은 사람의 바디 줄로 갔다.
 *        「직사각6칸용기 캡」과 「직사각6칸용기 바디」는 앞이 같아 꽤 닮아 보인다.)
 *  3) 1등 품목과 2등 품목이 비슷하게 닮았으면 넣지 않는다 — 사람이 본다.
 *  4) 같은 품목 줄이 여럿이면(똑같은 주문 두 번) 박스 수가 덜 찬 줄부터.
 *     모두 찼으면 첫 줄에 덧붙인다 — 같은 사람·같은 품목이라 틀린 곳이 아니다.
 */
function _gma_pickRow_(e, cands) {
  var groups = {}, order = [];
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    var nameOk = !!(e.name && c.name && (c.name === e.name ||
      (Math.min(c.name.length, e.name.length) >= 2 &&
       (c.name.indexOf(e.name) !== -1 || e.name.indexOf(c.name) !== -1))));
    var phoneOk = !!(e.phone && c.phone && e.phone === c.phone);
    if (!nameOk && !phoneOk) continue;
    if (!groups[c.item]) { groups[c.item] = []; order.push(c.item); }
    groups[c.item].push(c);
  }
  if (!order.length) return { row: null, why: "이름·전화가 맞는 줄 없음" };

  var best = null, bestSim = -1, second = -1;
  for (var g = 0; g < order.length; g++) {
    var sim = (e.item && order[g]) ? _gma_similarity_(e.item, order[g]) : 0;
    if (sim > bestSim) { second = bestSim; bestSim = sim; best = order[g]; }
    else if (sim > second) second = sim;
  }

  if (order.length > 1) {
    if (bestSim < 0.4) return { row: null, why: "같은 사람 품목 " + order.length + "가지 중 닮은 것 없음" };
    if (bestSim < 0.95 && bestSim - second < 0.15) {
      return { row: null, why: "품목이 애매함 (" + bestSim.toFixed(2) + " vs " + second.toFixed(2) + ")" };
    }
  }

  var rowsOfItem = groups[best];
  var pick = null;
  // 같은 품목 줄이 여럿이면 엑셀 수량과 박스수량이 같은 줄을 먼저
  if (e.qty) {
    for (var q = 0; q < rowsOfItem.length; q++) {
      if (!rowsOfItem[q].used && rowsOfItem[q].qty === e.qty) { pick = rowsOfItem[q]; break; }
    }
  }
  for (var k = 0; !pick && k < rowsOfItem.length; k++) {
    if (!rowsOfItem[k].used) pick = rowsOfItem[k];
  }
  var overflow = !pick;
  if (!pick) pick = rowsOfItem[0];
  return { row: pick, score: Math.round(bestSim * 100) / 100, overflow: overflow };
}

// ═════════════════════════════════════════════════════════════════
//  3. 송장 엑셀 해석
// ═════════════════════════════════════════════════════════════════

/**
 * 머리글로 열을 찾는다. 머리글이 없거나 낯설면 값의 모양으로 송장 열을 찾는다.
 * 엑셀 형식이 바뀌어도 「송장번호 열을 못 찾았다」는 사실을 숨기지 않는다.
 */
function _gma_parseInvoiceRows_(rows) {
  var out = { entries: [], headerDesc: "" };
  if (!rows || !rows.length) { out.headerDesc = "빈 시트"; return out; }

  var KW = {
    tracking: ["운송장번호", "운송장", "송장번호", "송장", "invoice"],
    name:     ["받는분성명", "받는분", "수하인명", "수하인", "수취인", "받는사람", "수령인", "고객명"],
    phone:    ["받는분전화", "받는분휴대", "수하인전화", "수하인휴대", "수취인전화", "수취인휴대", "휴대폰", "핸드폰", "연락처"],
    item:     ["품목명", "품목", "상품명", "품명", "제품명", "내품명", "내품"],
    qty:      ["박스수량", "수량", "개수", "박스"]
  };

  // 머리글 줄: 앞 5줄 중 키워드가 가장 많이 걸리는 줄
  var hdrRow = -1, hdrHits = 0;
  for (var r = 0; r < Math.min(5, rows.length); r++) {
    var hits = 0;
    for (var c = 0; c < rows[r].length; c++) {
      var h = _gma_normHeader_(rows[r][c]);
      if (!h) continue;
      for (var key in KW) {
        if (KW[key].some(function (w) { return h.indexOf(w) !== -1; })) { hits++; break; }
      }
    }
    if (hits > hdrHits) { hdrHits = hits; hdrRow = r; }
  }

  var col = { tracking: -1, name: -1, phone: -1, item: -1, qty: -1 };
  if (hdrRow >= 0 && hdrHits >= 2) {
    var hdr = rows[hdrRow].map(_gma_normHeader_);
    // 키워드 순서가 우선순위 — 「받는분」이 「성명」보다 먼저 잡혀야 보내는분을 피한다
    ["tracking", "name", "phone", "item", "qty"].forEach(function (key) {
      for (var w = 0; w < KW[key].length && col[key] === -1; w++) {
        for (var c2 = 0; c2 < hdr.length; c2++) {
          if (!hdr[c2]) continue;
          if (key !== "phone" && /보내는|송하인|발송인/.test(hdr[c2])) continue;
          // 「받는분 주소」「받는분 전화」를 이름 열로, 「박스타입」을 수량 열로 잡지 않게
          if (key === "name" && /전화|휴대|연락|주소|우편/.test(hdr[c2])) continue;
          if (key === "qty" && /타입|종류|크기|규격/.test(hdr[c2])) continue;
          if (key === "phone" && /보내는|송하인|발송인/.test(hdr[c2])) continue;
          if (hdr[c2].indexOf(KW[key][w]) !== -1 && _gma_colFree_(col, c2)) { col[key] = c2; break; }
        }
      }
    });
  } else {
    hdrRow = -1;
  }

  // 송장 열을 못 찾았으면 10~14자리 숫자가 가장 많은 열
  if (col.tracking === -1) {
    var best = -1, bestCnt = 0, width = rows.reduce(function (m, x) { return Math.max(m, x.length); }, 0);
    for (var c3 = 0; c3 < width; c3++) {
      var cnt = 0;
      for (var r3 = 0; r3 < rows.length; r3++) if (/^\d{10,14}$/.test(_gma_digits_(rows[r3][c3]))) cnt++;
      if (cnt > bestCnt) { bestCnt = cnt; best = c3; }
    }
    col.tracking = best;
  }

  out.headerDesc = "머리글 " + (hdrRow >= 0 ? (hdrRow + 1) + "행" : "없음") +
    " · 송장=" + _gma_colName_(col.tracking) + " 이름=" + _gma_colName_(col.name) +
    " 전화=" + _gma_colName_(col.phone) + " 품목=" + _gma_colName_(col.item) +
    " 수량=" + _gma_colName_(col.qty);

  /*  ★ 못 찾았으면 «무엇을 봤는지» 말한다 ★  (2026-10-14)
      첫 예행에서 이름·전화 열을 못 찾아 23건이 전부 미매칭이 됐다. 그런데
      화면은 「이름=-」라고만 해서, 엑셀 머리글이 무슨 낱말인지 알 길이 없었다.
      낱말을 몰라 고칠 수가 없으니, 못 찾은 칸이 있으면 머리글 줄을 그대로
      보여 준다. 짐작해서 낱말을 더하지 않는다.  */
  if (hdrRow >= 0 && (col.name === -1 || col.phone === -1 || col.tracking === -1)) {
    var 본것 = [];
    for (var hc = 0; hc < rows[hdrRow].length; hc++) {
      var hw = String(rows[hdrRow][hc] == null ? "" : rows[hdrRow][hc]).trim();
      if (hw) 본것.push(_gma_colName_(hc) + "=" + hw);
    }
    if (본것.length) out.headerDesc += "\n      머리글 줄: " + 본것.join(" | ");
  }
  if (col.tracking === -1) return out;

  for (var r4 = hdrRow + 1; r4 < rows.length; r4++) {
    var row = rows[r4];
    var trk = _gma_digits_(row[col.tracking]);
    if (!/^\d{10,14}$/.test(trk)) continue;
    var rawName = col.name >= 0 ? String(row[col.name] || "").trim() : "";
    var rawItem = col.item >= 0 ? String(row[col.item] || "").trim() : "";
    out.entries.push({
      tracking: trk,
      rawName: rawName,
      name: _gma_normName_(rawName),
      phone: col.phone >= 0 ? _gma_phoneKey_(row[col.phone]) : "",
      rawItem: rawItem,
      item: _gma_normItem_(rawItem),
      qty: col.qty >= 0 ? _gma_num_(row[col.qty]) : 0
    });
  }
  return out;
}

function _gma_colFree_(col, c) {
  for (var k in col) if (col[k] === c) return false;
  return true;
}

function _gma_colName_(i) {
  if (i < 0) return "-";
  var s = "";
  i++;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/**
 * xlsx 첫 시트를 2차원 배열로. (Utilities.unzip + XmlService)
 * 공유 문자열, 인라인 문자열, 숫자 셀을 다룬다. 서식·수식은 보지 않는다.
 */
function _gma_readXlsxFirstSheet_(blob) {
  blob.setContentType("application/zip");
  var files = Utilities.unzip(blob);
  var byName = {};
  files.forEach(function (f) { byName[f.getName()] = f; });

  // 공유 문자열
  var shared = [];
  if (byName["xl/sharedStrings.xml"]) {
    var sdoc = XmlService.parse(byName["xl/sharedStrings.xml"].getDataAsString("UTF-8"));
    var sns = sdoc.getRootElement().getNamespace();
    sdoc.getRootElement().getChildren("si", sns).forEach(function (si) {
      shared.push(_gma_xmlText_(si, sns));
    });
  }

  // 첫 시트 경로 — workbook 순서를 따르되, 못 찾으면 sheet1
  var sheetPath = "xl/worksheets/sheet1.xml";
  try {
    var wb = XmlService.parse(byName["xl/workbook.xml"].getDataAsString("UTF-8")).getRootElement();
    var rels = XmlService.parse(byName["xl/_rels/workbook.xml.rels"].getDataAsString("UTF-8")).getRootElement();
    var first = wb.getChild("sheets", wb.getNamespace()).getChildren()[0];
    var rid = null;
    first.getAttributes().forEach(function (a) { if (a.getName() === "id") rid = a.getValue(); });
    rels.getChildren().forEach(function (rel) {
      if (rel.getAttribute("Id") && rel.getAttribute("Id").getValue() === rid) {
        var t = rel.getAttribute("Target").getValue().replace(/^\/?xl\//, "");
        sheetPath = "xl/" + t.replace(/^\//, "");
      }
    });
  } catch (e) {}
  if (!byName[sheetPath]) throw new Error("시트 XML 을 찾지 못함 (" + sheetPath + ")");

  var doc = XmlService.parse(byName[sheetPath].getDataAsString("UTF-8")).getRootElement();
  var ns = doc.getNamespace();
  var sheetData = doc.getChild("sheetData", ns);
  var out = [];
  sheetData.getChildren("row", ns).forEach(function (rowEl) {
    var rIdx = Number(rowEl.getAttribute("r") ? rowEl.getAttribute("r").getValue() : out.length + 1) - 1;
    var arr = [];
    rowEl.getChildren("c", ns).forEach(function (cEl) {
      var ref = cEl.getAttribute("r") ? cEl.getAttribute("r").getValue() : "";
      var ci = ref ? _gma_colIndex_(ref.replace(/\d+/g, "")) : arr.length;
      var t = cEl.getAttribute("t") ? cEl.getAttribute("t").getValue() : "";
      var val = "";
      if (t === "s") {
        var vEl = cEl.getChild("v", ns);
        val = vEl ? (shared[Number(vEl.getText())] || "") : "";
      } else if (t === "inlineStr") {
        var isEl = cEl.getChild("is", ns);
        val = isEl ? _gma_xmlText_(isEl, ns) : "";
      } else {
        var v2 = cEl.getChild("v", ns);
        val = v2 ? v2.getText() : "";
        // 송장번호가 숫자 셀로 오면 4.6343E+11 처럼 저장될 수 있다
        if (/^\d+(\.\d+)?E\+\d+$/i.test(val)) val = Number(val).toFixed(0);
      }
      arr[ci] = val;
    });
    for (var z = 0; z < arr.length; z++) if (arr[z] === undefined) arr[z] = "";
    out[rIdx] = arr;
  });
  for (var y = 0; y < out.length; y++) if (!out[y]) out[y] = [];
  return out;
}

function _gma_xmlText_(el, ns) {
  // <t> 바로 아래 또는 <r><t> 여러 조각
  var s = "";
  var t = el.getChild("t", ns);
  if (t) s += t.getText();
  el.getChildren("r", ns).forEach(function (r) {
    var rt = r.getChild("t", ns);
    if (rt) s += rt.getText();
  });
  return s;
}

function _gma_colIndex_(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

// ═════════════════════════════════════════════════════════════════
//  4. 아주팩 파일·탭
// ═════════════════════════════════════════════════════════════════

function _gma_findAJExclusiveTab_() {
  var files = _pt_listFiles();
  var map = _pep_buildPrefixToFileMap_(files);
  var f = map[_GMA_AJ_PREFIX];
  if (!f) {
    for (var i = 0; i < files.length; i++) {
      if (String(files[i].name).indexOf("아주팩") !== -1) { f = files[i]; break; }
    }
  }
  if (!f) return null;
  var ss = SpreadsheetApp.openById(f.id);
  // 정확히 「전용양식」 — 「(2026년 10월) 전용발주 마감」 같은 탭을 잡으면 안 된다
  var tab = ss.getSheetByName("전용양식");
  if (!tab) return null;
  return { tab: tab, ss: ss, file: f };
}

/**
 * 전용양식 열 위치. 머리글로 찾고, 못 찾으면 _partnerDeploy.gs 의 AJ 기본 양식 위치.
 * 송장번호|이슈|보내는분 성명|보내는분 전화번호|보내는분 주소|받는분 성명|받는분 전화번호|받는분 주소|품목명|박스수량|…
 */
function _gma_exclusiveCols_(header) {
  var col = { name: 5, phone: 6, item: 8, qty: 9 };
  for (var i = 0; i < header.length; i++) {
    var h = _gma_normHeader_(header[i]);
    if (h === "받는분성명") col.name = i;
    else if (h === "받는분전화번호") col.phone = i;
    else if (h === "품목명") col.item = i;
    else if (h === "박스수량") col.qty = i;
  }
  return col;
}

// ═════════════════════════════════════════════════════════════════
//  5. 정규화·유사도
// ═════════════════════════════════════════════════════════════════

function _gma_normHeader_(v) {
  return String(v == null ? "" : v).replace(/[\s\(\)（）\[\]·\.\-_:]/g, "").toLowerCase();
}

function _gma_normName_(v) {
  return String(v == null ? "" : v)
    .replace(/\s*[\(（][^\)）]*[\)）]\s*/g, "") // 괄호 꼬리표 제거
    .replace(/\s+/g, "")
    .trim();
}

function _gma_normItem_(v) {
  return String(v == null ? "" : v)
    .toLowerCase()
    .replace(/[øØΦφ]/g, "파이")
    .replace(/[\s\/\\\-_,·\.\(\)\[\]（）]/g, "");
}

function _gma_digits_(v) {
  return String(v == null ? "" : v).replace(/[^\d]/g, "");
}

function _gma_phoneKey_(v) {
  var d = _gma_digits_(v);
  return d.length >= 8 ? d.slice(-8) : "";
}

function _gma_num_(v) {
  var n = Number(String(v == null ? "" : v).replace(/[^\d\.]/g, ""));
  return isFinite(n) ? n : 0;
}

/** 글자 2개 묶음 겹침 비율 (Dice). 0~1 */
function _gma_similarity_(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.5 ? 0.9 : 0.6;
  }
  function grams(s) {
    var g = {};
    for (var i = 0; i < s.length - 1; i++) { var k = s.substr(i, 2); g[k] = (g[k] || 0) + 1; }
    return g;
  }
  var ga = grams(a), gb = grams(b), inter = 0, na = 0, nb = 0;
  for (var k in ga) { na += ga[k]; if (gb[k]) inter += Math.min(ga[k], gb[k]); }
  for (var k2 in gb) nb += gb[k2];
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

// ═════════════════════════════════════════════════════════════════
//  6. 기타
// ═════════════════════════════════════════════════════════════════

function _gma_labelThreads_(threads) {
  try {
    var label = GmailApp.getUserLabelByName(_GMA_PROCESSED_LABEL) || GmailApp.createLabel(_GMA_PROCESSED_LABEL);
    threads.forEach(function (t) { label.addToThread(t); });
  } catch (e) {
    Logger.log("[GMA] 라벨 부착 실패: " + e.message);
  }
}

function _gma_unmatchedText_(list, max) {
  var s = list.slice(0, max).map(function (u) {
    return (u.name || "?") + "/" + (u.item || "?") + "(" + u.tracking + ")";
  }).join(", ");
  if (list.length > max) s += " 외 " + (list.length - max) + "건";
  return s;
}

function _gma_oneLine_(r) {
  return "메일 " + r.mailCount + " · 송장 " + r.parsedCount + " · 입력 " + r.written.length +
    " · 이미 " + r.alreadyIn + " · 미매칭 " + r.unmatched.length + " · 빈 줄 " + r.stillEmpty.length +
    (r.errors.length ? " · 오류 " + r.errors.join("; ") : "");
}

function _gma_summaryText_(r, dryRun) {
  var L = [(dryRun ? "🧪 아주팩 송장 예행 (시트에 쓰지 않음)" : "📧 아주팩 Gmail 송장 수집"), ""];
  L.push("메일 " + r.mailCount + "건 · 엑셀 송장 " + r.parsedCount + "개");
  r.headerInfo.forEach(function (h) { L.push("  " + h); });
  L.push("");
  L.push((dryRun ? "넣을 것 " : "A열 입력 ") + r.written.length + "건 · 이미 입력됨 " + r.alreadyIn + "건");
  r.written.slice(0, 15).forEach(function (w) {
    L.push("  " + w.row + "행 " + w.name + " / " + w.item + " ← " + w.tracking);
  });
  if (r.written.length > 15) L.push("  … 외 " + (r.written.length - 15) + "건");
  if (r.unmatched.length) {
    L.push("");
    L.push("❌ 미매칭 " + r.unmatched.length + "건");
    r.unmatched.slice(0, 10).forEach(function (u) {
      L.push("  " + (u.name || "?") + " / " + (u.item || "?") + " (" + u.tracking + ") — " + u.why);
    });
  }
  if (r.stillEmpty.length) {
    L.push("");
    L.push("⬜ 아직 송장 없는 줄 " + r.stillEmpty.length + "개 (한 박스에 여러 품목이거나 송장 누락)");
    r.stillEmpty.slice(0, 10).forEach(function (x) { L.push("  " + x.row + "행 " + x.name + " / " + x.item); });
  }
  if (r.errors.length) { L.push(""); L.push("⚠ " + r.errors.join("\n⚠ ")); }
  if (!r.mailCount) { L.push(""); L.push("최근 " + _GMA_LOOKBACK_DAYS + "일 안에 hspack2020 송장 메일이 없습니다."); }
  return L.join("\n");
}
