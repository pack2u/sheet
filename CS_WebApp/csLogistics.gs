/**
 * ══════════════════════════════════════════════════════════════
 *  물류팀 — 반품 입고 사진 촬영·업로드 (전용 화면)
 *  파일: csLogistics.gs   화면: logistics.html   경로: ?page=logistics
 *
 *  ★ 왜 따로 만들었나 ★
 *    CS 워크스페이스(home.html)는 263KB 짜리 상담 도구다. 창고에서 폰으로
 *    하루치를 연속 촬영하는 작업에는 맞지 않는다.
 *    반품 입고 스캔(return_intake.html)은 사진을 저장하지 않는다.
 *
 *  ★ 카메라 ★
 *    Apps Script 웹앱은 camera 권한이 없는 샌드박스 iframe 안에서 돈다.
 *    getUserMedia 는 어떤 코드를 써도 열리지 않는다.
 *    그래서 이 화면은 input[type=file][capture=environment] 하나만 쓴다.
 *    (기존 화면의 "이 화면에서 카메라 켜기" 버튼이 안 되던 이유가 이것이다)
 *
 *  ★ 송장 파손 대응 — 이 파일의 핵심 ★
 *    현장 송장은 자주 찢기거나 지워진다. 완전일치만 보면 대부분 실패한다.
 *    실패했을 때 새 행을 만들면 기존 건과 중복이 생긴다. 그래서 3단계로 나눈다.
 *
 *      확정 sure    바코드/체크섬 + 완전일치 1건 → 자동 입고 처리
 *      후보 maybe   뒤 4~8자리·수취인명·전화뒤4 → 사람이 탭해서 확정
 *      미상 none    아무것도 못 읽음            → 사진만 적재
 *
 *    어느 단계든 입고대장에는 반드시 한 줄 남는다. 사진은 잃지 않는다.
 *    반품대장(SSOT)은 확정이거나 사람이 고른 경우에만 건드린다.
 * ══════════════════════════════════════════════════════════════
 */

var _CSL_INTAKE_TAB_PREFIX_ = "입고_"; // 입고_yyyyMM (반품관리대장 안)
var _CSL_MAX_FILES_ = 5;
var _CSL_MAX_BYTES_ = 18 * 1024 * 1024;
var _CSL_TAIL_MIN_ = 4; // 부분일치 최소 자릿수
var _CSL_LOOKBACK_ = 60; // 반품 후보 조회 일수

var _CSL_HEADERS_ = [
  "일시", "담당자", "신뢰도", "인식경로", "송장번호", "원문",
  "매칭탭", "매칭행", "수취인", "품목", "처리결과", "사진", "비고"
];

// ── 공통 ────────────────────────────────────────────────
function _csl_now_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
}

function _csl_ymd_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

function _csl_digits_(v) {
  return String(v == null ? "" : v).replace(/[^0-9]/g, "");
}

function _csl_norm_(v) {
  return String(v == null ? "" : v).replace(/\s/g, "").toLowerCase();
}

/**
 * 송장번호처럼 보이는가.
 *
 * ★ 안심번호 함정 ★
 *   라벨에는 안심번호(0504-XXXX-XXXX · 0502-XXXX-XXXX)가 크게 인쇄돼 있고,
 *   하이픈까지 포함해 송장번호와 형식이 완전히 같다(12자리 NNNN-NNNN-NNNN).
 *   OCR 이 이걸 집으면 매칭이 통째로 어긋난다.
 *
 *   실제 라벨 16건을 전수 확인한 결과 송장번호는 전부 2 로 시작하고,
 *   안심번호·전화번호는 전부 0 으로 시작한다. 앞자리로 가른다.
 */
function _csl_looksLikeInvoice_(d) {
  var s = String(d || "");
  if (s.length < _CSL_TAIL_MIN_) return false;
  if (s.charAt(0) === "0") return false; // 안심번호·전화번호
  return true;
}

/** 입고대장 탭 — 반품관리대장 안에 월별로 둔다 */
function _csl_ensureIntakeTab_() {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var name = _CSL_INTAKE_TAB_PREFIX_ +
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMM");
  var tab = ss.getSheetByName(name);
  if (!tab) {
    tab = ss.insertSheet(name);
    tab.getRange(1, 1, 1, _CSL_HEADERS_.length)
      .setValues([_CSL_HEADERS_])
      .setBackground("#252525").setFontColor("#f0f0f0")
      .setFontWeight("bold").setHorizontalAlignment("center");
    tab.setFrozenRows(1);
    tab.setColumnWidth(1, 150);  // 일시
    tab.setColumnWidth(6, 220);  // 원문
    tab.setColumnWidth(12, 260); // 사진
    // 송장번호·원문은 앞자리 0 이 죽지 않게 텍스트로 잠근다
    tab.getRange(2, 5, tab.getMaxRows() - 1, 2).setNumberFormat("@");
  }
  return tab;
}

// ── 매칭 ────────────────────────────────────────────────
/**
 * 파손 송장 대응 다중 신호 매칭.
 * @param {string} raw    스캔/OCR 원문
 * @param {Object} fields OCR 이 뽑은 { recipientName, phone, ... }
 * @return {{tier:string, digits:string, checksumOk:boolean, matches:Array, note:string}}
 */
function csLogisticsMatch(raw, fields) {
  fields = fields || {};
  var parsed = csParseCourierBarcode(raw || "");
  var digits = (parsed.ok && parsed.digits) ? parsed.digits : _csl_digits_(raw);
  var checksumOk = !!parsed.checksumOk;

  // ★ 반품회수 라벨에는 번호가 둘이다 ★
  //   「운송장번호」 = 이번 회수분, 「원송장번호」 = 최초 출고분.
  //   대장에는 둘 중 어느 쪽이 적혀 있을지 모르므로 다 후보로 둔다.
  var cands = [];
  function pushCand(v, kind) {
    var d = _csl_digits_(v);
    if (!_csl_looksLikeInvoice_(d)) return; // 안심번호·전화번호 배제
    for (var q = 0; q < cands.length; q++) if (cands[q].d === d) return;
    cands.push({ d: d, kind: kind });
  }
  pushCand(digits, "스캔");
  pushCand(fields.returnInvoiceNumber, "운송장번호");
  pushCand(fields.originalInvoiceNumber, "원송장번호");
  pushCand(fields.invoiceNumber, "OCR");
  // 대표 표기값 — 후보 중 가장 긴 것.
  // 후보가 하나도 없는데 원문이 안심번호였다면 비운다.
  // 그걸 송장번호랍시고 대장에 적어두면 나중에 더 헷갈린다.
  if (cands.length) {
    digits = cands[0].d;
    for (var q2 = 1; q2 < cands.length; q2++) {
      if (cands[q2].d.length > digits.length) digits = cands[q2].d;
    }
  } else if (!_csl_looksLikeInvoice_(digits)) {
    digits = "";
  }

  var rows = [];
  try {
    rows = _cs_loadReturnLedgerCases_(_CSL_LOOKBACK_, true, false) || [];
  } catch (e) {
    return {
      tier: "none", digits: digits, checksumOk: checksumOk,
      matches: [], note: "대장 조회 실패: " + e.message
    };
  }

  var hits = {}, out = [];
  function add(c, via, score) {
    var k = c.tab + "|" + c.row;
    if (hits[k]) {
      if (score > hits[k].score) { hits[k].matchVia = via; hits[k].score = score; }
      return;
    }
    hits[k] = {
      tab: c.tab, row: c.row, name: c.name, item: c.item, phone: c.phone,
      status: c.status, invoice: c.invoice, returnInvoice: c.returnInvoice,
      matchVia: via, score: score
    };
    out.push(hits[k]);
  }

  var i, c, k;

  // ① 완전일치 — 후보 번호를 반품송장/원송장 양쪽에 대본다
  for (k = 0; k < cands.length; k++) {
    var cd = cands[k].d;
    if (cd.length < 8) continue;
    for (i = 0; i < rows.length; i++) {
      c = rows[i];
      if (c.returnInvDigits && c.returnInvDigits === cd) add(c, cands[k].kind + " → 반품송장 일치", 100);
    }
    for (i = 0; i < rows.length; i++) {
      c = rows[i];
      if (c.invDigits && c.invDigits === cd) add(c, cands[k].kind + " → 원송장 일치", 95);
    }
  }

  // ② 부분일치 — 뒤에서부터. 파손은 보통 앞이나 가운데가 날아간다.
  //    긴 자리에서 걸리면 더 짧게 내려가지 않는다(오검출 방지).
  if (!out.length) {
    var tails = [8, 7, 6, 5, 4];
    for (var t = 0; t < tails.length && !out.length; t++) {
      var n = tails[t];
      for (k = 0; k < cands.length; k++) {
        var cd2 = cands[k].d;
        if (cd2.length < n) continue;
        var tail = cd2.slice(-n);
        for (i = 0; i < rows.length; i++) {
          c = rows[i];
          if (c.returnInvDigits && c.returnInvDigits.slice(-n) === tail) {
            add(c, cands[k].kind + " 뒤" + n + "자리", 60 + n);
          } else if (c.invDigits && c.invDigits.slice(-n) === tail) {
            add(c, cands[k].kind + " 뒤" + n + "자리(원송장)", 50 + n);
          }
        }
      }
    }
  }

  // ③ 이름·전화
  //    ★ 반품회수 라벨은 받는 분이 회수처(팩투유)다. 실제 고객은 보내는 분이다.
  //      recipientName 을 쓰면 전부 "팩투유"로 잡혀 쓸모가 없다.
  var nm = _csl_norm_(fields.senderName || fields.name || fields.recipientName || "");
  var ph = _csl_digits_(fields.senderPhone || fields.phone || "");
  if (nm.length >= 2) {
    for (i = 0; i < rows.length; i++) {
      c = rows[i];
      if (_csl_norm_(c.name) && _csl_norm_(c.name) === nm) add(c, "수취인명 일치", 40);
    }
  }
  if (ph.length >= 4) {
    var p4 = ph.slice(-4);
    for (i = 0; i < rows.length; i++) {
      c = rows[i];
      if (_csl_digits_(c.phone).slice(-4) === p4) add(c, "전화 뒤4자리", 35);
    }
  }

  out.sort(function (a, b) { return b.score - a.score; });

  // 등급 판정 — 자동 처리는 확신할 때만.
  //  ★ 2026-08-31 정정 ★
  //    종전 주석: "체크섬은 실제 라벨 8건이 전부 실패하니 신뢰 조건에서 뺀다."
  //    → 규칙이 안 맞았던 게 아니라 csValidateLotteChecksum_ 구현이 틀렸던 것이다.
  //      (자릿수 합 mod 7 로 계산하고 있었다. 실제 규칙은 11자리 정수 mod 7.)
  //      정정 후 실제 라벨 9건 전부 통과한다.
  //
  //    다만 등급 판정은 **아직 그대로 둔다.** 여기를 건드리면 반품 자동 처리
  //    비율이 바뀌므로, 정정된 checksumOk 가 현장에서 어떻게 찍히는지
  //    입고대장 C열(신뢰도)로 얼마간 지켜본 뒤 조정한다.
  //    지금은 종전대로 "완전일치 1건 + 10자리 이상"만 자동 처리한다.
  var tier = "none", note = "";
  if (out.length === 1 && out[0].score >= 95 && digits.length >= 10) {
    tier = "sure";
  } else if (out.length) {
    tier = "maybe";
    note = out.length + "건 후보";
  } else if (digits.length >= _CSL_TAIL_MIN_) {
    note = "번호는 읽었으나 대장에 일치 없음";
  } else {
    note = "번호를 읽지 못함";
  }

  return {
    tier: tier, digits: digits, checksumOk: checksumOk,
    matches: out.slice(0, 8), note: note
  };
}

/**
 * 대장에서 **글자로** 찾는다 — 이름·전화·송장 아무거나.
 * ★ 2026-09-07 신규
 *
 * csLogisticsMatch 는 「사진에서 읽은 값」으로 찾는다. 그래서 찾으려면
 * 일단 찍어야 했다. 그런데 물류팀의 실제 순서는 반대다 —
 * **대장에서 그 건을 먼저 찾고, 거기에 사진을 붙인다.**
 *
 * 이름은 부분일치로 본다. 검색창에 전체 이름을 정확히 치게 하면
 * 그냥 안 쓰게 된다. 매칭용(csLogisticsMatch)은 완전일치 그대로 둔다 —
 * 그쪽은 자동 처리로 이어지므로 느슨하면 위험하다.
 *
 * 돌려주는 모양은 csLogisticsMatch 와 같다. 화면이 같은 코드로 그린다.
 */
/** 라벨의 가림 문자. 택배사마다 다르게 쓴다. */
var _CSL_MASK_RE_ = /[*＊○◯ㅇ·・∙xX]/;

/**
 * 「김*동」처럼 가려진 이름을 자리 대조 패턴으로 바꾼다.
 *
 * 택배 송장은 개인정보 때문에 이름 가운데를 가린다. 반품대장에는 전체 이름이
 * 들어 있으므로, 가린 자리는 아무 글자로 보고 나머지 자리가 같으면 후보로 올린다.
 *
 * **글자 수가 같아야 한다.** 「김*동」은 세 글자 이름만 본다.
 * 느슨하게 풀면 김씨가 전부 걸려 고르는 것이 더 오래 걸린다.
 *
 * @returns {RegExp|null} 가림 문자가 없으면 null
 */
function _csl_maskPattern_(nm) {
  var t = String(nm == null ? "" : nm);
  if (t.length < 2 || t.length > 8) return null;
  if (!_CSL_MASK_RE_.test(t)) return null;
  var re = "";
  for (var i = 0; i < t.length; i++) {
    var ch = t.charAt(i);
    re += _CSL_MASK_RE_.test(ch) ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  try { return new RegExp("^" + re + "$"); } catch (e) { return null; }
}

/**
 * 대장에서 **글자로** 찾는다 — 이름·전화·송장 아무거나, 섞어서도.
 * ★ 2026-09-07 신규
 *
 * csLogisticsMatch 는 「사진에서 읽은 값」으로 찾는다. 그래서 찾으려면 일단
 * 찍어야 했다. 그런데 물류팀의 실제 순서는 반대다 —
 * **대장에서 그 건을 먼저 찾고, 거기에 사진을 붙인다.**
 *
 * ★ 라벨 이름은 가려져 있다 ★
 *   택배 송장에는 「김*동」처럼 나온다. 그대로 찾으면 하나도 안 걸린다.
 *   가림 문자가 보이면 자리 대조로 바꿔서 찾는다.
 *
 * ★ 가장 확실한 건 「이름 + 전화 뒤4」를 같이 치는 것 ★
 *   라벨에는 전화도 가려져 있지만 **뒤 4자리는 대개 보인다.**
 *   둘을 같이 주면 한 건으로 좁혀진다. 그래서 둘 다 맞으면 점수를 제일 높게 준다.
 *
 * 이름 부분일치를 허용한다. 검색창에 전체 이름을 정확히 치게 하면 그냥 안 쓴다.
 * 매칭용(csLogisticsMatch)은 완전일치 그대로 둔다 — 그쪽은 자동 처리로
 * 이어지므로 느슨하면 위험하다.
 *
 * 돌려주는 모양은 csLogisticsMatch 와 같다. 화면이 같은 코드로 그린다.
 */
function csLogisticsSearch(q) {
  q = String(q == null ? "" : q).trim();
  var empty = { tier: "none", digits: "", checksumOk: false, matches: [] };
  if (q.length < 2) {
    empty.note = "두 글자 이상 입력하세요";
    return empty;
  }

  /* 「김*동 1234」처럼 섞어 칠 수 있게 글자와 숫자를 나눈다.
     숫자는 4자리 이상 덩어리만 본다 — 이름에 붙은 한두 자리는 뜻이 없다. */
  var digitRun = (q.match(/\d{4,}/g) || []).sort(function (x, y) { return y.length - x.length; });
  var d = digitRun.length ? digitRun[0] : "";
  var nmRaw = q.replace(/\d{4,}/g, " ");
  var nm = _csl_norm_(nmRaw);
  var maskRe = _csl_maskPattern_(nm);
  var hasName = nm.length >= 2;

  var rows = [];
  try {
    rows = _cs_loadReturnLedgerCases_(_CSL_LOOKBACK_, true, false) || [];
  } catch (e) {
    empty.note = "대장 조회 실패: " + e.message;
    return empty;
  }

  var hits = {}, out = [];
  function add(c, via, score) {
    var k = c.tab + "|" + c.row;
    if (hits[k]) {
      if (score > hits[k].score) { hits[k].matchVia = via; hits[k].score = score; }
      return;
    }
    hits[k] = {
      tab: c.tab, row: c.row, name: c.name, item: c.item, phone: c.phone,
      status: c.status, invoice: c.invoice, returnInvoice: c.returnInvoice,
      matchVia: via, score: score
    };
    out.push(hits[k]);
  }

  for (var i = 0; i < rows.length; i++) {
    var c = rows[i];
    var cn = _csl_norm_(c.name);
    var ph = _csl_digits_(c.phone);
    var rv = c.returnInvDigits || "";
    var ov = c.invDigits || "";

    /* 이름이 맞는가 — 가려졌으면 자리 대조, 아니면 부분일치 */
    var nameHit = "";
    if (hasName && cn) {
      if (maskRe) { if (maskRe.test(cn)) nameHit = "가린 이름"; }
      else if (cn === nm) nameHit = "이름 일치";
      else if (cn.indexOf(nm) !== -1) nameHit = "이름 포함";
    }

    /* 숫자가 맞는가 — 송장 뒤자리 · 전화 뒤4 */
    var numHit = "";
    if (d.length >= _CSL_TAIL_MIN_) {
      if (rv && rv.slice(-d.length) === d) numHit = "반품송장 뒤" + d.length + "자리";
      else if (ov && ov.slice(-d.length) === d) numHit = "원송장 뒤" + d.length + "자리";
      else if (ph && ph.slice(-4) === d.slice(-4)) numHit = "전화 뒤4자리";
      else if (ph && d.length >= 6 && ph.indexOf(d) !== -1) numHit = "전화 포함";
    }

    /* 둘 다 주고 둘 다 맞으면 사실상 확정이다 */
    if (nameHit && numHit) { add(c, nameHit + " + " + numHit, 100); continue; }

    /* 둘 다 줬는데 한쪽만 맞으면 올리지 않는다 —
       조건을 더 준 사람에게 더 넓은 결과를 주는 건 말이 안 된다. */
    if (hasName && d.length >= _CSL_TAIL_MIN_) continue;

    if (numHit) {
      add(c, numHit,
        numHit.indexOf("반품송장") === 0 ? 95 :
        numHit.indexOf("원송장") === 0 ? 90 : 70);
      continue;
    }
    if (nameHit) {
      add(c, nameHit,
        nameHit === "이름 일치" ? 80 :
        nameHit === "가린 이름" ? 75 : 60);
      continue;
    }
    if (hasName && !maskRe && _csl_norm_(c.item).indexOf(nm) !== -1) add(c, "품목 포함", 40);
  }

  out.sort(function (a2, b2) { return b2.score - a2.score; });

  /* 검색은 하나만 걸려도 **자동 처리하지 않는다.**
     사람이 친 글자로 찾은 것이라 오타 한 글자면 남의 건이 걸린다.
     반드시 눌러서 고르게 한다(tier=maybe). */
  var note;
  if (out.length) {
    note = out.length + "건 찾음 — 해당 건을 누르세요";
  } else if (maskRe) {
    note = "못 찾았습니다. 가린 이름은 글자 수가 같아야 합니다 (김*동 = 세 글자). " +
           "전화 뒤 4자리를 같이 쳐 보세요.";
  } else {
    note = "대장에서 못 찾았습니다 (최근 " + _CSL_LOOKBACK_ + "일)";
  }

  return {
    tier: out.length ? "maybe" : "none",
    digits: d.length >= 8 ? d : "",
    checksumOk: false,
    matches: out.slice(0, 12),
    note: note
  };
}
// ── 적재 ────────────────────────────────────────────────
/**
 * 사진 + 인식결과 저장.
 * 입고대장에는 항상 남기고, 반품대장은 확정(또는 사람이 고른 건)일 때만 건드린다.
 */
function csLogisticsSubmit(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};

  var staff = String(payload.staff || "").trim() || "물류";
  var raw = String(payload.raw || "").trim();
  var digits = _csl_digits_(payload.invoice || raw);
  var via = String(payload.via || "").trim(); // detector | qrlib | ocr | manual
  var tier = String(payload.tier || "none").trim();
  var photos = payload.photos || [];
  var pick = payload.pick || null; // 사람이 고른 {tab,row,name,item}
  var memo = String(payload.memo || "").trim();

  if (!photos.length) return { ok: false, error: "사진이 없습니다." };
  if (photos.length > _CSL_MAX_FILES_) {
    return { ok: false, error: "한 번에 " + _CSL_MAX_FILES_ + "장까지 올릴 수 있습니다." };
  }

  /* ══════════════════════════════════════════════════════════════
     1) 사진 저장

     ★ 파일은 «회사 계정»이 만든다 ★  (2026-09-15)
       이 웹앱은 «접속한 사람» 권한으로 돈다. 여기서 바로 만들면 소유자가
       «찍은 물류팀원»이 된다. 반품 첨부가 2026-09-10 에 그 일을 겪었다 —
       2주치 사진이 전부 직원 개인 지메일 소유였고, 그 사람이 계정을
       정리하면 대장의 링크가 통째로 죽는다.
       csAttach 는 그때 고쳤는데 이 화면은 남아 있었다. 같게 맞춘다.

     ★ 보관소가 안 되면 옛 방식으로 간다 ★
       물류팀은 물건을 손에 든 채로 찍는다. 여기서 막히면 일이 멈춘다.
       다만 «개인 드라이브로 떨어졌다»는 사실은 반드시 화면에 말한다 —
       조용히 성공하면 그 사람 용량이 찰 때까지 아무도 모른다.
     ══════════════════════════════════════════════════════════════ */
  var links = [], totalBytes = 0;
  var fsWarn = "";
  //  폴더는 «뒷길»이다 — 보관소가 실패했을 때만 연다
  var _folder = null;
  var 폴더 = function () {
    if (!_folder) _folder = _cs_attFolder_();
    return _folder;
  };
  try {
    var stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i] || {};
      if (!p.dataB64) continue;
      var bytes = Utilities.base64Decode(String(p.dataB64));
      totalBytes += bytes.length;
      if (totalBytes > _CSL_MAX_BYTES_) {
        return { ok: false, error: "사진 용량이 큽니다. 장수를 줄여 주세요." };
      }
      var mime = String(p.mimeType || "image/jpeg");
      var base = "입고_" + stamp + "_" + (digits || "무번호") + "_" + (i + 1) +
        _cs_attExt_(mime, p.name);

      var put = csFileStorePut("intake", bytes, mime, base);
      if (put.ok) { links.push(put.url); continue; }

      Logger.log("[CSL] 보관소 실패 → 예전 방식으로 올립니다: " + put.error);
      if (!fsWarn) fsWarn = String(put.error || "보관소를 쓰지 못했습니다");
      var f;
      try {
        f = 폴더().createFile(Utilities.newBlob(bytes, mime, base));
      } catch (eMake) {
        /*  개인 드라이브까지 막혔다 — 두 까닭을 «둘 다» 말한다.
            「용량초과」만 보면 사진을 줄이려 들지만 진짜 문제는 보관소다. */
        return {
          ok: false,
          error: [
            "사진을 올리지 못했습니다.", "",
            "① 파일보관소: " + fsWarn,
            "② 개인 드라이브: " + ((eMake && eMake.message) || eMake), "",
            "보관소가 되면 개인 드라이브를 안 씁니다.",
            "관리자에게 이 두 줄을 그대로 알려 주세요."
          ].join(String.fromCharCode(10))
        };
      }
      try {
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (eS) {
        Logger.log("[CSL] 공유 설정 실패: " + eS.message);
      }
      links.push(f.getUrl());
    }
  } catch (eUp) {
    return { ok: false, error: "사진 저장 실패: " + eUp.message };
  }
  if (!links.length) return { ok: false, error: "사진 데이터가 비어 있습니다." };

  // 2) 반품대장 연동 — 확정이거나 사람이 고른 경우만.
  //    매칭 실패 시 새 행을 만들지 않는다. 파손 송장이 중복 행을 만드는 걸 막는다.
  var target = (pick && pick.tab && pick.row) ? pick : null;
  if (!target && tier === "sure" && payload.sureMatch && payload.sureMatch.tab) {
    target = payload.sureMatch;
  }

  var result = "", mTab = "", mRow = "", mName = "", mItem = "";
  if (target) {
    mTab = target.tab;
    mRow = target.row;
    mName = target.name || "";
    mItem = target.item || "";
    try {
      // 사진 링크를 같이 넘긴다 — 반품 카드 상담이력에서 바로 열어볼 수 있어야 한다
      var r = _cs_intakeExistingReturn_(
        target.tab, parseInt(target.row, 10), digits || raw, staff,
        (pick ? "물류-확인" : "물류-자동") + (via ? "/" + via : ""),
        links
      );
      result = (r && r.ok)
        ? (_CS_RI_STATUS_INTAKE_ + " 처리 · 사진 " + links.length + "장")
        : ("연동 실패: " + ((r && r.error) || "알 수 없음"));
    } catch (eI) {
      result = "연동 실패: " + eI.message;
    }
  } else {
    result = (tier === "none") ? "사진만 적재 (번호 미상)" : "사진만 적재 (확인 대기)";
  }

  // 3) 입고대장 한 줄 — 어떤 경우에도 남긴다
  try {
    var tab = _csl_ensureIntakeTab_();
    tab.appendRow([
      _csl_now_(), staff,
      tier === "sure" ? "확정" : (tier === "maybe" ? "후보" : "미상"),
      via, digits, raw, mTab, mRow, mName, mItem, result, links.join("\n"), memo
    ]);
    var last = tab.getLastRow();
    tab.getRange(last, 5, 1, 2).setNumberFormat("@"); // 송장번호·원문 텍스트 유지
  } catch (eL) {
    return {
      ok: false,
      error: "입고대장 기록 실패 (사진은 저장됨): " + eL.message,
      photos: links
    };
  }

  return {
    ok: true, photos: links, result: result,
    /*  성공해도 «개인 드라이브로 떨어졌으면» 말한다 — 조용히 넘어가면
        그 사람 용량이 차서 멈출 때까지 아무도 모른다 (2026-09-11 반품첨부). */
    message: links.length + "장 저장 · " + result +
      (fsWarn ? "  ※ 파일보관소를 못 써서 개인 드라이브에 올렸습니다 — " + fsWarn : "")
  };
}

/**
 * 오늘 올린 목록 + 요약.
 * PC 화면은 촬영보다 현황을 먼저 보므로 집계까지 같이 돌려준다.
 * (호출을 나누면 느린 Drive 왕복이 두 번이 된다)
 */
function csLogisticsToday() {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;

  // 진행 중 반품 = 앞으로 입고될 수 있는 건. 캐시를 타므로 부담이 적다.
  var pending = -1;
  try {
    pending = (_cs_loadReturnLedgerCases_(_CSL_LOOKBACK_, true, false) || []).length;
  } catch (eP) {}

  try {
    var tab = _csl_ensureIntakeTab_();
    var lr = tab.getLastRow();
    if (lr < 2) {
      return { ok: true, rows: [], summary: { total: 0, sure: 0, maybe: 0, none: 0, pending: pending } };
    }
    var vals = tab.getRange(2, 1, lr - 1, _CSL_HEADERS_.length).getDisplayValues();
    var today = _csl_ymd_(), out = [];
    var sum = { total: 0, sure: 0, maybe: 0, none: 0, pending: pending };

    // 집계는 오늘치 전부를 세고, 목록만 최근 60건으로 자른다.
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0] || "").indexOf(today) !== 0) continue;
      var tier = String(vals[i][2] || "").trim();
      sum.total++;
      if (tier === "확정") sum.sure++;
      else if (tier === "후보") sum.maybe++;
      else sum.none++;

      if (out.length < 60) {
        out.push({
          time: String(vals[i][0]).slice(11, 16),
          staff: vals[i][1], tier: tier, via: vals[i][3],
          invoice: vals[i][4], name: vals[i][8], item: vals[i][9],
          result: vals[i][10], photo: String(vals[i][11] || "").split("\n")[0]
        });
      }
    }
    return { ok: true, rows: out, summary: sum, tab: tab.getName() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 설정 점검 — 스크립트 편집기에서 실행 */
function csDiagnoseLogistics() {
  var out = [];
  try {
    var tab = _csl_ensureIntakeTab_();
    out.push("입고대장 탭: " + tab.getName() + " (" + Math.max(0, tab.getLastRow() - 1) + "행)");
  } catch (e) { out.push("입고대장 실패: " + e.message); }
  try {
    out.push("사진 폴더: " + _cs_attFolder_().getName());
  } catch (e) { out.push("사진 폴더 실패: " + e.message); }
  try {
    var rows = _cs_loadReturnLedgerCases_(_CSL_LOOKBACK_, true, false) || [];
    out.push("진행 중 반품: " + rows.length + "건 (매칭 후보군)");
  } catch (e) { out.push("반품대장 실패: " + e.message); }
  try {
    out.push("Gemini OCR 키: " + (_cs_getGeminiKey_() ? "설정됨" : "없음 — OCR 단계 건너뜀"));
  } catch (e) { out.push("Gemini 키 확인 실패: " + e.message); }
  Logger.log(out.join("\n"));
  return out.join("\n");
}
