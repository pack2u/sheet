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

  // 1) 사진 저장 — 기존 반품 첨부 폴더를 그대로 쓴다
  var links = [], totalBytes = 0;
  try {
    var folder = _cs_attFolder_();
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
      var f = folder.createFile(Utilities.newBlob(bytes, mime, base));
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
    message: links.length + "장 저장 · " + result
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
