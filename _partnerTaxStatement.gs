/**
 * ┌──────────────────────────────────────────┐
 * │  [협력업체] 거래명세표 발행  v1.0         │
 * │  파일: _partnerTaxStatement.gs           │
 * └──────────────────────────────────────────┘
 *
 * 팩투유 → 협력업체 **발행**용 거래명세표.
 *
 * 「명세서 정리」(_partnerStatement*.gs) 와 헷갈리지 말 것.
 *   · 명세서 정리 = 공급사가 **우리에게 보낸** 명세를 받아 대사한다.
 *   · 거래명세표  = 우리가 협력업체에게 **보낼** 명세를 만든다.   ← 이 파일
 *
 * 원천 (협력업체 파일)
 *   · 「(YYYY년 M월) 발주 마감」      대리판매  헤더 4행 / 데이터 5행
 *   · 「(YYYY년 M월) 전용발주 마감」  대리공급  헤더 1행 / 데이터 2행
 *   · 「발주 및 송장조회」·「전용양식」  아직 마감 전 — 구간 발행에서만, 송장 있는 행만
 *
 * 발행 단위 — 셋 다 _pts_issueWithPack_ 한 곳으로 모인다
 *   · 월 단위     partnerIssueTaxStatementHere / …All   (마감탭 전체)
 *   · 날짜 구간   partnerIssueTaxStatementByDateRange   (+ 품목명·코드 필터)
 *   · 선택 행     partnerIssueTaxStatementFromSelection (활성 탭에서 고른 행)
 *
 * 산출
 *   ① 협력업체 파일 「거래명세표」 인쇄 탭 (A4 세로, A~H 8열)
 *   ② PDF  — Drive 「거래명세표 / YYYY-MM」 폴더
 *   ③ 메일 — 거래처 탭 수신메일로 PDF 첨부 발송
 *
 * ★ 금액 규칙 — 마감탭 요약(_pms_applyFormulas_)과 **같은 식**을 쓴다.
 *   품목 금액 : 취소·반품 체크 행 제외, 줄금액은 _pms_resolveArchiveLineAmount_
 *   가산 항목 : 반품배송비 · 도서산간배송비 · 기타정산 (취소행 포함 전 행 합)
 *   그래서 명세표 총합계 = 마감탭 「🏷️ 최종 정산금액」 이 된다.
 *   이 등식이 깨지면 둘 중 하나가 잘못된 것이다. 먼저 사전점검을 돌려라.
 */

// ═══════════════════════════════════════════
//  상수
// ═══════════════════════════════════════════
var _PTS_VER_ = "v1.0";

var _PTS_TAB_ISSUER = "거래명세표_공급자";     // 허브
var _PTS_TAB_VENDOR = "거래명세표_거래처";     // 허브
var _PTS_TAB_LOG    = "거래명세표_발행이력";   // 허브
var _PTS_TAB_OUT    = "거래명세표";            // 협력업체 파일

var _PTS_COLS        = 8;    // A~H
var _PTS_VAT_RATE    = 0.1;
var _PTS_ROOT_FOLDER = "거래명세표";
var _PTS_HEADER_BG   = "#1f4e78";
var _PTS_ITEM_ROW    = 13;   // 품목 표 헤더 행
var _PTS_TIME_BUDGET_MS_ = 4.5 * 60 * 1000;
var _PTS_DONE_KEY_   = "_PTS_DONE_";  // + yyyy-MM

var _PTS_ITEM_HEADERS_ = [
  "일자", "품목코드", "품 목 명", "규격", "수량", "단가", "공급가액", "세액",
];

var _PTS_VENDOR_HEADERS_ = [
  "발행", "파일명", "파일ID", "거래처명", "등록번호", "대표자",
  "사업장주소", "업태", "종목", "담당자", "수신메일(콤마)", "원천", "비고",
  "거래처코드",   // 이카운트 CUST_CD — 사업자정보 자동 매칭 키
];

var _PTS_LOG_HEADERS_ = [
  "시각", "대상월", "거래처명", "건수", "공급가액", "세액", "합계", "PDF", "메일", "비고",
];

/**
 * 공급자 설정 — [라벨, 기본값]. 값은 라벨로 찾는다 (행 번호에 기대지 않는다).
 * 기본값은 사업자등록증(585-88-00931, 2019-12-04 발급) · IBK 통장 기준.
 * 시트에 이미 값이 있으면 건드리지 않는다 — 여기는 어디까지나 초기값이다.
 */
var _PTS_ISSUER_ROWS_ = [
  ["등록번호", "585-88-00931"],
  ["상호(법인명)", "주식회사 팩투유"],
  ["대표자", "박상식"],
  ["사업장주소", "경기도 고양시 일산동구 고봉로678번길 41(설문동)"],
  ["업태", "도매 및 소매업"],
  ["종목", "일회용기"],
  ["전화", ""],
  ["팩스", ""],
  ["담당자", ""],
  ["담당자 메일", ""],
  ["입금계좌", "IBK기업은행 458-050724-01-018 (예금주: 주식회사 팩투유)"],
  ["", ""],
  ["VAT 기준", "포함"],
  ["품목 표시", "품목별합산"],
  ["PDF 폴더ID", ""],
  ["메일 제목", "[팩투유] {거래처명} {대상월} 거래명세표"],
  ["메일 본문",
    "안녕하세요, {거래처명} 담당자님.\n\n" +
    "{대상월} 거래명세표를 첨부로 보내드립니다.\n" +
    "합계 {합계}원 (공급가액 {공급가액} / 세액 {세액} / {건수}건)\n\n" +
    "확인 후 회신 부탁드립니다.\n감사합니다.\n\n주식회사 팩투유"],
  ["발신자 표시이름", "주식회사 팩투유"],
  ["숨은참조(BCC)", ""],
];


// ═══════════════════════════════════════════
//  ① 허브 설정 탭
// ═══════════════════════════════════════════

/** 허브에 공급자·거래처·발행이력 탭을 만든다 (있으면 유지) */
function partnerCreateTaxStatementTabs() {
  var ui = SpreadsheetApp.getUi();
  var hub = _pts_hub_();
  var made = _pts_ensureHubTabs_(hub);
  try { hub.setActiveSheet(hub.getSheetByName(_PTS_TAB_ISSUER)); } catch (e) {}
  // 탭은 **허브 파일**에 생긴다. 지금 보고 있는 시트가 아니다 —
  // 이걸 안 적어 두면 빈 시트를 뒤지게 된다. 파일명과 주소를 같이 알려 준다.
  ui.alert(
    "거래명세표 설정",
    "📁 파일: " + hub.getName() + "\n" +
      hub.getUrl() + "\n\n" +
      (made.length ? "생성한 탭: " + made.join(", ") : "탭은 이미 모두 있습니다.") +
      (made.filled ? "\n빈 칸 " + made.filled + "개를 기본값으로 채웠습니다." : "") +
      "\n\n① 위 파일의 「" + _PTS_TAB_ISSUER + "」 탭 B열\n" +
      "   → 공급자 정보는 사업자등록증 기준으로 채워 두었습니다.\n" +
      "   → 전화·팩스·담당자만 직접 입력하세요.\n\n" +
      "② 「" + _PTS_TAB_VENDOR + "」 탭\n" +
      "   → 「🔄 거래처 목록 동기화」 실행 후 업체별 등록번호·수신메일 입력",
    ui.ButtonSet.OK,
  );
}

function _pts_ensureHubTabs_(hub) {
  var made = [];
  made.filled = 0;
  var issuer = hub.getSheetByName(_PTS_TAB_ISSUER);
  // 탭은 있는데 비어 있는 경우가 있다 — 앞선 실행이 탭을 만든 직후 죽으면 그렇게 남는다.
  // 그때 라벨만 덧붙이면 제목·서식 없는 반쪽짜리가 되므로 통째로 다시 그린다.
  if (issuer && issuer.getLastRow() < 2) {
    _pts_initIssuerTab_(issuer);
    made.push(_PTS_TAB_ISSUER + "(재작성)");
  } else if (!issuer) {
    issuer = hub.insertSheet(_PTS_TAB_ISSUER);
    _pts_initIssuerTab_(issuer);
    made.push(_PTS_TAB_ISSUER);
  } else {
    var rep = _pts_repairIssuerTab_(issuer);
    made.filled = rep.filled + rep.added;
  }
  try { issuer.setTabColor("#1f4e78"); } catch (e) {}

  var vend = hub.getSheetByName(_PTS_TAB_VENDOR);
  if (vend && vend.getLastRow() >= 1) {
    // 열이 늘어난 버전으로 올라온 경우 헤더를 넓혀 준다 (데이터는 그대로)
    if (vend.getMaxColumns() < _PTS_VENDOR_HEADERS_.length) {
      vend.insertColumnsAfter(vend.getMaxColumns(),
        _PTS_VENDOR_HEADERS_.length - vend.getMaxColumns());
    }
    var curHdr = vend.getRange(1, 1, 1, _PTS_VENDOR_HEADERS_.length).getValues()[0];
    var needHdr = false;
    for (var h = 0; h < _PTS_VENDOR_HEADERS_.length; h++) {
      if (String(curHdr[h] || "").trim() !== _PTS_VENDOR_HEADERS_[h]) { needHdr = true; break; }
    }
    if (needHdr) _pts_writeHeaderRow_(vend, _PTS_VENDOR_HEADERS_, _PTS_HEADER_BG);
  } else if (vend) {
    _pts_writeHeaderRow_(vend, _PTS_VENDOR_HEADERS_, _PTS_HEADER_BG);
  } else if (!vend) {
    vend = hub.insertSheet(_PTS_TAB_VENDOR);
    _pts_writeHeaderRow_(vend, _PTS_VENDOR_HEADERS_, _PTS_HEADER_BG);
    vend.setColumnWidth(1, 46);
    vend.setColumnWidth(2, 220);
    vend.setColumnWidth(3, 60);
    vend.setColumnWidth(4, 150);
    vend.setColumnWidth(7, 240);
    vend.setColumnWidth(11, 220);
    made.push(_PTS_TAB_VENDOR);
  }
  try { vend.setTabColor("#2e7d32"); } catch (e) {}

  var log = hub.getSheetByName(_PTS_TAB_LOG);
  if (log && log.getLastRow() < 1) {
    _pts_writeHeaderRow_(log, _PTS_LOG_HEADERS_, "#37474f");
  } else if (!log) {
    log = hub.insertSheet(_PTS_TAB_LOG);
    _pts_writeHeaderRow_(log, _PTS_LOG_HEADERS_, "#37474f");
    made.push(_PTS_TAB_LOG);
  }
  try { log.setTabColor("#37474f"); } catch (e) {}

  return made;
}

function _pts_initIssuerTab_(tab) {
  tab.clear();
  tab.getRange(1, 1, 1, 2).merge()
    .setValue("거래명세표 — 공급자(팩투유) 정보 · " + _PTS_VER_)
    .setBackground(_PTS_HEADER_BG).setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(12);

  var rows = _PTS_ISSUER_ROWS_.map(function (r) { return [r[0], r[1]]; });
  tab.getRange(2, 1, rows.length, 2).setValues(rows);
  tab.getRange(2, 1, rows.length, 1).setFontWeight("bold");
  tab.getRange(2, 2, rows.length, 1).setWrap(true).setVerticalAlignment("top");
  tab.setColumnWidth(1, 160);
  tab.setColumnWidth(2, 460);
  tab.setFrozenRows(1);

  _pts_noteByLabel_(tab, "등록번호",
    "사업자등록증 (법인사업자) · 법인등록번호 285011-0372370 · 개업 2018-01-11");
  _pts_noteByLabel_(tab, "업태",
    "사업자등록증 등재 업태\n· 도매 및 소매업\n· 제조업\n· 도매 및 소매업\n" +
    "명세표에는 한 줄만 찍힌다. 거래 성격에 맞는 것으로 바꿔 쓴다.");
  _pts_noteByLabel_(tab, "종목",
    "사업자등록증 등재 종목\n· 일회용기\n· 포장용 플라스틱 성형용기 제조업\n· 전자상거래업");
  _pts_noteByLabel_(tab, "VAT 기준",
    "포함 = 마감탭 정산금액이 VAT 포함가. 공급가액=round(금액/1.1), 세액=금액-공급가액\n" +
    "별도 = 마감탭 금액이 공급가액. 세액=round(금액×0.1)");
  _pts_noteByLabel_(tab, "품목 표시",
    "품목별합산 = 같은 품목·단가를 한 줄로 합산 (기본)\n일자별상세 = 마감 행 그대로");
  _pts_noteByLabel_(tab, "PDF 폴더ID",
    "비워두면 내 드라이브에 「거래명세표」 폴더를 만들고 여기에 ID를 적어 둔다.");
  _pts_noteByLabel_(tab, "메일 본문",
    "치환 토큰: {거래처명} {대상월} {합계} {공급가액} {세액} {건수} {문서번호}");
}

/**
 * 라벨이 빠져 있으면 덧붙이고, **빈 칸만** 기본값으로 채운다.
 * 운영자가 적어 둔 값은 절대 덮지 않는다 — 여기서 덮으면 손으로 고친 주소·계좌가 매번 되돌아간다.
 * @return {{added:number, filled:number}}
 */
function _pts_repairIssuerTab_(tab) {
  var last = Math.max(tab.getLastRow(), 1);
  var rowOf = {};
  var blank = {};
  if (last >= 2) {
    var vals = tab.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      var lab = String(vals[i][0] || "").trim();
      if (!lab) continue;
      rowOf[lab] = i + 2;
      if (String(vals[i][1] == null ? "" : vals[i][1]).trim() === "") blank[lab] = true;
    }
  }

  var add = [];
  var filled = 0;
  for (var k = 0; k < _PTS_ISSUER_ROWS_.length; k++) {
    var label = _PTS_ISSUER_ROWS_[k][0];
    var def = _PTS_ISSUER_ROWS_[k][1];
    if (!label) continue;
    if (!rowOf[label]) { add.push([label, def]); continue; }
    if (def && blank[label]) {
      tab.getRange(rowOf[label], 2).setValue(def);
      filled++;
    }
  }
  if (add.length) {
    tab.getRange(last + 1, 1, add.length, 2).setValues(add);
    tab.getRange(last + 1, 1, add.length, 1).setFontWeight("bold");
  }
  return { added: add.length, filled: filled };
}

function _pts_noteByLabel_(tab, label, note) {
  var r = _pts_issuerRowOf_(tab, label);
  if (r > 0) { try { tab.getRange(r, 2).setNote(note); } catch (e) {} }
}

function _pts_issuerRowOf_(tab, label) {
  var last = tab.getLastRow();
  if (last < 2) return -1;
  var vals = tab.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim() === label) return i + 2;
  }
  return -1;
}

function _pts_writeHeaderRow_(tab, headers, color) {
  tab.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold")
    .setBackground(color || _PTS_HEADER_BG)
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");
  tab.setFrozenRows(1);
}

function _pts_hub_() {
  return _pt_getHubSS(_PT.HUB_ID);
}

/** 공급자 설정 읽기 → {등록번호:…, "VAT 기준":…} 형태의 라벨 맵 */
function _pts_readIssuer_() {
  var hub = _pts_hub_();
  var tab = hub.getSheetByName(_PTS_TAB_ISSUER);
  if (!tab) {
    throw new Error("허브에 「" + _PTS_TAB_ISSUER + "」탭이 없습니다. 먼저 ① 설정 탭 생성을 실행하세요.");
  }
  var last = tab.getLastRow();
  var out = {};
  if (last >= 2) {
    var vals = tab.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      var k = String(vals[i][0] || "").trim();
      if (k) out[k] = String(vals[i][1] == null ? "" : vals[i][1]).trim();
    }
  }
  if (!out["VAT 기준"]) out["VAT 기준"] = "포함";
  if (!out["품목 표시"]) out["품목 표시"] = "품목별합산";
  return out;
}


// ═══════════════════════════════════════════
//  ② 거래처 목록 동기화
// ═══════════════════════════════════════════

/**
 * [협력업체] 폴더의 파일 목록을 거래처 탭에 채운다.
 * 이미 있는 행은 **덮어쓰지 않는다** — 손으로 넣은 사업자정보·메일이 날아가면 안 된다.
 * 파일명이 바뀐 경우만 파일명 열을 갱신한다.
 */
function partnerSyncTaxStatementVendors() {
  var ui = SpreadsheetApp.getUi();
  var st = _pts_syncVendors_();
  try { _pts_hub_().setActiveSheet(_pts_hub_().getSheetByName(_PTS_TAB_VENDOR)); } catch (e) {}
  ui.alert(
    "거래처 동기화",
    "폴더 파일 " + st.files + "건\n" +
      "추가 " + st.added + " · 파일명 갱신 " + st.renamed + "\n\n" +
      "등록번호·대표자·주소·수신메일은 직접 채워 주세요.\n" +
      "「발행」 체크가 꺼진 거래처는 일괄 발행에서 빠집니다.",
    ui.ButtonSet.OK,
  );
}

/** 동기화 알맹이 — UI 없이 돈다. 메뉴와 고르기 화면이 같이 쓴다 */
function _pts_syncVendors_() {
  var hub = _pts_hub_();
  _pts_ensureHubTabs_(hub);
  var tab = hub.getSheetByName(_PTS_TAB_VENDOR);

  var files = _pt_listFiles(true);
  var last = tab.getLastRow();
  var rowById = {};
  if (last >= 2) {
    var cur = tab.getRange(2, 1, last - 1, _PTS_VENDOR_HEADERS_.length).getValues();
    for (var i = 0; i < cur.length; i++) {
      var id = String(cur[i][2] || "").trim();
      if (id) rowById[id] = i + 2;
    }
  }

  var added = 0;
  var renamed = 0;
  var appendRows = [];
  for (var f = 0; f < files.length; f++) {
    var file = files[f];
    var name = file.name.replace(_PT.PREFIX, "").trim();
    var r = rowById[file.id];
    if (r) {
      if (String(tab.getRange(r, 2).getValue() || "").trim() !== file.name) {
        tab.getRange(r, 2).setValue(file.name);
        renamed++;
      }
      continue;
    }
    appendRows.push([
      true, file.name, file.id, name, "", "", "", "", "", "", "", "자동", "", "",
    ]);
    added++;
  }
  if (appendRows.length) {
    var start = Math.max(tab.getLastRow(), 1) + 1;
    tab.getRange(start, 1, appendRows.length, _PTS_VENDOR_HEADERS_.length)
      .setValues(appendRows);
    tab.getRange(start, 1, appendRows.length, 1).insertCheckboxes();
  }
  return { files: files.length, added: added, renamed: renamed };
}

/** 거래처 탭 → 객체 배열 */
function _pts_readVendors_() {
  var hub = _pts_hub_();
  var tab = hub.getSheetByName(_PTS_TAB_VENDOR);
  if (!tab) {
    throw new Error("허브에 「" + _PTS_TAB_VENDOR + "」탭이 없습니다. 먼저 ① 설정 탭 생성을 실행하세요.");
  }
  var last = tab.getLastRow();
  if (last < 2) return [];
  var vals = tab.getRange(2, 1, last - 1, _PTS_VENDOR_HEADERS_.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    var id = String(v[2] || "").trim();
    if (!id) continue;
    out.push({
      row: i + 2,
      issue: v[0] === true || String(v[0]).toUpperCase() === "TRUE",
      fileName: String(v[1] || "").trim(),
      fileId: id,
      name: String(v[3] || "").trim(),
      bizNo: String(v[4] || "").trim(),
      ceo: String(v[5] || "").trim(),
      addr: String(v[6] || "").trim(),
      biz1: String(v[7] || "").trim(),
      biz2: String(v[8] || "").trim(),
      contact: String(v[9] || "").trim(),
      emails: String(v[10] || "").trim(),
      source: String(v[11] || "자동").trim() || "자동",
      memo: String(v[12] || "").trim(),
      custCd: String(v[13] || "").trim(),
    });
  }
  return out;
}


// ═══════════════════════════════════════════
//  ③ 마감탭 → 명세 줄 수집
// ═══════════════════════════════════════════

/** "yyyy-MM" → {yyyy, m, ym} */
function _pts_parseMonth_(ym) {
  var m = String(ym || "").match(/^(\d{4})[-\/.]?(\d{1,2})$/);
  if (!m) throw new Error("대상월 형식이 잘못됐습니다: " + ym + " (yyyy-MM)");
  var mm = parseInt(m[2], 10);
  if (!(mm >= 1 && mm <= 12)) throw new Error("대상월 형식이 잘못됐습니다: " + ym);
  return { yyyy: m[1], m: mm, ym: m[1] + "-" + (mm < 10 ? "0" + mm : String(mm)) };
}

/** 기본 대상월 = 전월 (명세표는 지난달 마감분을 끊는다) */
function _pts_defaultMonth_() {
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM");
}

function _pts_archiveSpecs_(ym, source) {
  var p = _pts_parseMonth_(ym);
  var sale = { name: "(" + p.yyyy + "년 " + p.m + "월) 발주 마감", headerRow: 4, kind: "대리판매" };
  var excl = { name: "(" + p.yyyy + "년 " + p.m + "월) 전용발주 마감", headerRow: 1, kind: "대리공급" };
  if (source === "발주마감") return [sale];
  if (source === "전용발주마감") return [excl];
  return [sale, excl];
}

/** 헤더 배열에서 가산항목·취소반품 열 인덱스 (0-based, 없으면 -1) */
function _pts_extraColIdx_(hdr) {
  var idx = {
    cancel: -1, ret: -1, retFee: -1, islandFee: -1, etcFee: -1, spec: -1,
  };
  for (var c = 0; c < hdr.length; c++) {
    var h = String(hdr[c] == null ? "" : hdr[c]).replace(/\s/g, "");
    if (!h) continue;
    if (h === "취소") idx.cancel = c;
    else if (h === "반품") idx.ret = c;
    else if (h === "반품배송비") idx.retFee = c;
    else if (h === "도서산간배송비") idx.islandFee = c;
    else if (h === "기타정산") idx.etcFee = c;
    else if (idx.spec === -1 && h.indexOf("규격") !== -1) idx.spec = c;
  }
  return idx;
}

function _pts_isChecked_(v) {
  return v === true || String(v).toUpperCase() === "TRUE";
}

function _pts_newAcc_() {
  return {
    lines: [], tabs: [], skipped: 0, noInvoice: 0,
    extraSum: { "반품배송비": 0, "도서산간배송비": 0, "기타정산": 0 },
  };
}

/** 누적기 → 명세 pack (가산항목을 줄로 세운다) */
function _pts_finishAcc_(acc) {
  var out = {
    lines: acc.lines, extras: [], tabs: acc.tabs,
    skipped: acc.skipped, noInvoice: acc.noInvoice,
  };
  var keys = ["반품배송비", "도서산간배송비", "기타정산"];
  for (var k = 0; k < keys.length; k++) {
    var amt = Math.round(acc.extraSum[keys[k]]);
    if (amt === 0) continue;
    out.extras.push({
      date: "", dateNum: 0, code: "", name: keys[k], spec: "",
      qty: 1, amount: amt, unit: amt, kind: "정산",
    });
  }
  return out;
}

/**
 * 헤더 행을 찾는다. 힌트를 먼저 보고, 아니면 1~6행을 훑는다.
 * 「발주 마감」은 4행, 「전용발주 마감」·「발주 및 송장조회」·「전용양식」은 1행이지만
 * 업체마다 양식이 조금씩 달라 고정값만 믿으면 조용히 빈 명세가 나온다.
 */
function _pts_resolveHeaderRow_(tab, hint, lastCol) {
  var lastRow = tab.getLastRow();
  var tries = [];
  if (hint > 0) tries.push(hint);
  for (var i = 1; i <= 6; i++) if (tries.indexOf(i) === -1) tries.push(i);
  for (var t = 0; t < tries.length; t++) {
    var r = tries[t];
    if (r >= lastRow) continue;
    var hdr = tab.getRange(r, 1, 1, lastCol).getValues()[0];
    var m = _pt_buildOrderTabColumnMap(hdr);
    var hasItem = m.item !== -1 || m.itemAlt !== -1 || m.code !== -1;
    if (hasItem && (m.qty !== -1 || m.unitPrice !== -1)) return r;
  }
  return hint > 0 ? hint : 1;
}

function _pts_kindOfTab_(name) {
  return String(name || "").indexOf("전용") !== -1 ? "대리공급" : "대리판매";
}

/**
 * 탭 하나를 훑어 acc 에 명세 줄을 쌓는다.
 * @param {Object} filter {rowSet:{시트행:true}, fromNum, toNum, needInvoice} — 전부 선택사항
 * @return {number} 담은 줄 수
 */
function _pts_scanTab_(tab, headerRowHint, kind, filter, acc) {
  filter = filter || {};
  var lastRow = tab.getLastRow();
  var lastCol = tab.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return 0;

  var headerRow = _pts_resolveHeaderRow_(tab, headerRowHint, lastCol);
  if (lastRow <= headerRow) return 0;

  var hdr = tab.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  var cMap = _pt_buildOrderTabColumnMap(hdr);
  var ex = _pts_extraColIdx_(hdr);
  var priceHeader = cMap.unitPrice !== -1 ? hdr[cMap.unitPrice] : "";
  var data = tab.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

  var rows = 0;
  for (var r = 0; r < data.length; r++) {
    var sheetRow = headerRow + 1 + r;
    var row = data[r];
    if (filter.rowSet && !filter.rowSet[sheetRow]) continue;

    var dateStr = "";
    if (cMap.date !== -1) dateStr = _pms_parseDateStr_(row[cMap.date]) || "";
    if (filter.fromNum || filter.toNum) {
      if (!dateStr) continue;
      var dNum = parseInt(dateStr, 10);
      if (filter.fromNum && dNum < filter.fromNum) continue;
      if (filter.toNum && dNum > filter.toNum) continue;
    }

    // 가산 항목은 취소·반품 행도 포함해 전부 더한다 (마감탭 요약 수식과 동일)
    if (ex.retFee !== -1) acc.extraSum["반품배송비"] += _pms_toNumber_(row[ex.retFee]);
    if (ex.islandFee !== -1) acc.extraSum["도서산간배송비"] += _pms_toNumber_(row[ex.islandFee]);
    if (ex.etcFee !== -1) acc.extraSum["기타정산"] += _pms_toNumber_(row[ex.etcFee]);

    if (ex.cancel !== -1 && _pts_isChecked_(row[ex.cancel])) { acc.skipped++; continue; }
    if (ex.ret !== -1 && _pts_isChecked_(row[ex.ret])) { acc.skipped++; continue; }

    // 발주 및 송장조회처럼 아직 안 나간 행이 섞인 탭은 송장 있는 행만 센다
    if (filter.needInvoice && cMap.invoice !== -1) {
      if (!String(row[cMap.invoice] || "").trim()) { acc.noInvoice++; continue; }
    }

    var name = "";
    if (cMap.item !== -1) name = String(row[cMap.item] || "").trim();
    if (!name && cMap.itemAlt !== -1) name = String(row[cMap.itemAlt] || "").trim();
    var code = cMap.code !== -1 ? String(row[cMap.code] || "").trim() : "";
    if (!name && !code) continue;
    if (filter.itemQuery && !_pts_matchItem_(filter.itemQuery, name, code)) continue;

    var qty = cMap.qty !== -1 ? _pms_toNumber_(row[cMap.qty]) : 0;
    var rawPrice = cMap.unitPrice !== -1 ? row[cMap.unitPrice] : "";
    var res = _pms_resolveArchiveLineAmount_(rawPrice, qty, priceHeader, 0);
    if (!(res.amount > 0)) continue;
    if (!(qty > 0)) qty = 1;

    acc.lines.push({
      date: dateStr ? dateStr.substring(4, 6) + "/" + dateStr.substring(6, 8) : "",
      dateNum: dateStr ? parseInt(dateStr, 10) : 0,
      srcTab: tab.getName(),   // 골라 발행할 때 되짚을 출처
      srcRow: sheetRow,
      code: code,
      name: name || code,
      spec: ex.spec !== -1 ? String(row[ex.spec] || "").trim() : "",
      qty: qty,
      amount: res.amount,
      unit: Math.round((res.amount / qty) * 100) / 100,
      kind: kind,
    });
    rows++;
  }
  acc.tabs.push(tab.getName() + " (" + rows + "행)");
  return rows;
}

/**
 * 협력업체 파일 1개에서 **대상월 마감탭** 명세 줄을 모은다.
 * @return {{lines:Array, extras:Array, tabs:Array, skipped:number}}
 */
function _pts_collectLines_(ss, ym, source) {
  var specs = _pts_archiveSpecs_(ym, source);
  var acc = _pts_newAcc_();
  for (var s = 0; s < specs.length; s++) {
    var tab = ss.getSheetByName(specs[s].name);
    if (!tab) continue;
    _pts_scanTab_(tab, specs[s].headerRow, specs[s].kind, {}, acc);
  }
  return _pts_finishAcc_(acc);
}

/** 활성 탭에서 **선택한 행**만 모은다 */
function _pts_collectFromSelection_(tab, ranges) {
  var acc = _pts_newAcc_();
  var rowSet = {};
  var picked = 0;
  for (var i = 0; i < ranges.length; i++) {
    var st = ranges[i].getRow();
    var n = ranges[i].getNumRows();
    for (var r = st; r < st + n; r++) {
      if (!rowSet[r]) { rowSet[r] = true; picked++; }
    }
  }
  _pts_scanTab_(tab, 0, _pts_kindOfTab_(tab.getName()), { rowSet: rowSet }, acc);
  var out = _pts_finishAcc_(acc);
  out.selectedRows = picked;
  return out;
}

/**
 * 날짜 구간으로 모은다. tabNames 가 비면 구간에 걸리는 마감탭 + 라이브 탭을 훑는다.
 * @param {Array} itemQuery 품목명·코드 부분일치 문자열 배열 (비우면 전 품목)
 */
function _pts_collectByRange_(ss, fromNum, toNum, tabNames, itemQuery) {
  var acc = _pts_newAcc_();
  var names = tabNames && tabNames.length ? tabNames : _pts_rangeTabNames_(ss, fromNum, toNum);
  for (var i = 0; i < names.length; i++) {
    var tab = ss.getSheetByName(names[i]);
    if (!tab) continue;
    var live = names[i].indexOf("마감") === -1;   // 발주 및 송장조회 · 전용양식
    _pts_scanTab_(
      tab,
      names[i].indexOf("전용발주 마감") !== -1 ? 1 : (names[i].indexOf("발주 마감") !== -1 ? 4 : 1),
      _pts_kindOfTab_(names[i]),
      { fromNum: fromNum, toNum: toNum, needInvoice: live, itemQuery: itemQuery },
      acc,
    );
  }
  return _pts_finishAcc_(acc);
}

/** "봉투, BX100" → ["봉투","bx100"] (소문자·공백제거). 비면 null */
function _pts_parseItemQuery_(raw) {
  var parts = String(raw || "").split(/[,;\n]+/)
    .map(function (s) { return String(s).replace(/\s+/g, "").toLowerCase(); })
    .filter(function (s) { return s.length > 0; });
  return parts.length ? parts : null;
}

function _pts_matchItem_(query, name, code) {
  if (!query) return true;
  var hay = (String(name || "") + " " + String(code || "")).replace(/\s+/g, "").toLowerCase();
  for (var i = 0; i < query.length; i++) {
    if (hay.indexOf(query[i]) !== -1) return true;
  }
  return false;
}

/** 구간에 걸치는 마감탭 이름 + 아직 마감 전인 라이브 탭 */
function _pts_rangeTabNames_(ss, fromNum, toNum) {
  var out = [];
  var y = Math.floor(fromNum / 10000);
  var m = Math.floor((fromNum % 10000) / 100);
  var ey = Math.floor(toNum / 10000);
  var em = Math.floor((toNum % 10000) / 100);
  var guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 60) {
    out.push("(" + y + "년 " + m + "월) 발주 마감");
    out.push("(" + y + "년 " + m + "월) 전용발주 마감");
    m++;
    if (m > 12) { m = 1; y++; }
  }
  out.push(_PMS_ORDER_TAB);   // 발주 및 송장조회 — 아직 마감 안 된 건
  out.push("전용양식");
  var seen = {};
  return out.filter(function (n) {
    if (seen[n] || !ss.getSheetByName(n)) return false;
    seen[n] = true;
    return true;
  });
}

/** 품목별 합산 — 같은 (코드·품목명·규격·단가) 를 한 줄로 */
function _pts_aggregate_(lines) {
  var map = {};
  var order = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var key = [l.code, l.name, l.spec, l.unit].join("");
    if (!map[key]) {
      map[key] = {
        date: "", code: l.code, name: l.name, spec: l.spec,
        qty: 0, amount: 0, unit: l.unit, kind: l.kind,
      };
      order.push(key);
    }
    map[key].qty += l.qty;
    map[key].amount += l.amount;
  }
  var out = [];
  for (var o = 0; o < order.length; o++) out.push(map[order[o]]);
  out.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name));
  });
  return out;
}

/** 줄 금액 → 공급가액·세액 (VAT 기준에 따라) */
function _pts_splitVat_(amount, vatMode) {
  var amt = Math.round(_pms_toNumber_(amount));
  if (vatMode === "별도") {
    var vat = Math.round(amt * _PTS_VAT_RATE);
    return { supply: amt, vat: vat, total: amt + vat };
  }
  var supply = Math.round(amt / (1 + _PTS_VAT_RATE));
  return { supply: supply, vat: amt - supply, total: amt };
}

/** 줄별 반올림 값을 그대로 더한다 — 표의 세로 합과 요약이 어긋나면 안 된다 */
function _pts_totals_(items, vatMode) {
  var supply = 0;
  var vat = 0;
  for (var i = 0; i < items.length; i++) {
    var sv = _pts_splitVat_(items[i].amount, vatMode);
    supply += sv.supply;
    vat += sv.vat;
  }
  return { supply: supply, vat: vat, total: supply + vat };
}


// ═══════════════════════════════════════════
//  ④ 인쇄 탭 렌더링
// ═══════════════════════════════════════════

/**
 * 협력업체 파일에 「거래명세표」 탭을 그린다.
 * @return {{rows:number, supply:number, vat:number, total:number, docNo:string, tab:Object}}
 */
function _pts_render_(ss, issuer, vendor, ym, pack) {
  var p = _pts_parseMonth_(ym);
  var vatMode = issuer["VAT 기준"] === "별도" ? "별도" : "포함";
  var detail = pack.forceDetail === true || issuer["품목 표시"] === "일자별상세";

  var goods = detail ? pack.lines.slice(0) : _pts_aggregate_(pack.lines);
  if (detail) {
    goods.sort(function (a, b) { return (a.dateNum || 0) - (b.dateNum || 0); });
  }
  var items = goods.concat(pack.extras);

  var docNo = "P2U-" + p.yyyy + (p.m < 10 ? "0" + p.m : String(p.m)) +
    (pack.docTag ? "-" + pack.docTag : "") + "-" + _pts_docSuffix_(vendor);

  var tab = ss.getSheetByName(_PTS_TAB_OUT);
  if (!tab) tab = ss.insertSheet(_PTS_TAB_OUT);
  _pts_unmergeAll_(tab);
  tab.clear();
  try { tab.clearNotes(); } catch (e) {}
  try { tab.setTabColor("#1f4e78"); } catch (e) {}

  // 필요한 열·행 확보
  if (tab.getMaxColumns() < _PTS_COLS) {
    tab.insertColumnsAfter(tab.getMaxColumns(), _PTS_COLS - tab.getMaxColumns());
  }
  var needRows = _PTS_ITEM_ROW + items.length + 12;
  if (tab.getMaxRows() < needRows) {
    tab.insertRowsAfter(tab.getMaxRows(), needRows - tab.getMaxRows());
  }

  var W = [70, 92, 210, 70, 55, 78, 92, 82]; // A~H ≈ 749px — A4 세로에 맞는 폭
  for (var c = 0; c < W.length; c++) tab.setColumnWidth(c + 1, W[c]);

  // ── 제목 ──
  tab.getRange(1, 1, 1, _PTS_COLS).merge()
    .setValue("거 래 명 세 표")
    .setFontSize(22).setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  tab.setRowHeight(1, 44);
  tab.getRange(2, 1, 1, _PTS_COLS).merge()
    .setValue("(공급받는자 보관용)")
    .setFontSize(9).setFontColor("#666666")
    .setHorizontalAlignment("center");
  tab.setRowHeight(3, 8);

  // ── 공급자 / 공급받는자 ──
  var head = [
    ["등록번호", issuer["등록번호"], "등록번호", vendor.bizNo],
    ["상호(법인명)", issuer["상호(법인명)"], "상호(법인명)", vendor.name],
    ["대표자", issuer["대표자"], "대표자", vendor.ceo],
    ["사업장주소", issuer["사업장주소"], "사업장주소", vendor.addr],
    ["업태 / 종목", _pts_join_(issuer["업태"], issuer["종목"]), "업태 / 종목", _pts_join_(vendor.biz1, vendor.biz2)],
  ];
  tab.getRange(4, 1, head.length, 1).merge()
    .setValue("공\n급\n자").setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBackground("#eef3f9");
  tab.getRange(4, 5, head.length, 1).merge()
    .setValue("공급받는자").setFontWeight("bold").setWrap(true)
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBackground("#eef3f9");

  for (var i = 0; i < head.length; i++) {
    var r = 4 + i;
    tab.getRange(r, 2).setValue(head[i][0]);
    tab.getRange(r, 3, 1, 2).merge().setValue(head[i][1]);
    tab.getRange(r, 6).setValue(head[i][2]);
    tab.getRange(r, 7, 1, 2).merge().setValue(head[i][3]);
    tab.setRowHeight(r, 22);
  }
  tab.getRange(4, 2, head.length, 1).setBackground("#f7f9fc").setFontWeight("bold");
  tab.getRange(4, 6, head.length, 1).setBackground("#f7f9fc").setFontWeight("bold");
  tab.getRange(4, 1, head.length, _PTS_COLS)
    .setBorder(true, true, true, true, true, true)
    .setFontSize(9).setVerticalAlignment("middle");
  tab.getRange(4, 3, head.length, 2).setWrap(true);
  tab.getRange(4, 7, head.length, 2).setWrap(true);
  tab.setRowHeight(9, 8);

  // ── 요약 ──
  var totals = _pts_totals_(items, vatMode);
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  tab.getRange(10, 1).setValue("작성일자");
  tab.getRange(10, 2).setValue(today);
  tab.getRange(10, 3).setValue("공급가액");
  tab.getRange(10, 4).setValue(totals.supply);
  tab.getRange(10, 5).setValue("세액");
  tab.getRange(10, 6).setValue(totals.vat);
  tab.getRange(10, 7).setValue("합계금액");
  tab.getRange(10, 8).setValue(totals.total);

  tab.getRange(11, 1).setValue("문서번호");
  tab.getRange(11, 2).setValue(docNo);
  tab.getRange(11, 3).setValue("거래기간");
  tab.getRange(11, 4).setValue(pack.periodLabel || (p.yyyy + "년 " + p.m + "월"));
  tab.getRange(11, 5).setValue("건수");
  tab.getRange(11, 6).setValue(items.length);
  tab.getRange(11, 7).setValue("VAT 기준");
  tab.getRange(11, 8).setValue(vatMode);

  tab.getRange(10, 1, 2, _PTS_COLS)
    .setBorder(true, true, true, true, true, true)
    .setFontSize(9).setVerticalAlignment("middle");
  tab.getRange(10, 1, 2, 1).setBackground("#f7f9fc").setFontWeight("bold");
  tab.getRange(10, 3, 2, 1).setBackground("#f7f9fc").setFontWeight("bold");
  tab.getRange(10, 5, 2, 1).setBackground("#f7f9fc").setFontWeight("bold");
  tab.getRange(10, 7, 2, 1).setBackground("#f7f9fc").setFontWeight("bold");
  tab.getRange(10, 4).setNumberFormat("#,##0");
  tab.getRange(10, 6).setNumberFormat("#,##0");
  tab.getRange(10, 8).setNumberFormat("#,##0").setFontWeight("bold").setFontColor("#c62828");
  tab.setRowHeight(10, 22);
  tab.setRowHeight(11, 22);
  tab.setRowHeight(12, 8);

  // ── 품목 표 ──
  var hr = _PTS_ITEM_ROW;
  tab.getRange(hr, 1, 1, _PTS_COLS).setValues([_PTS_ITEM_HEADERS_])
    .setBackground(_PTS_HEADER_BG).setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(9)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  tab.setRowHeight(hr, 24);

  var body = [];
  for (var n = 0; n < items.length; n++) {
    var it = items[n];
    var sv = _pts_splitVat_(it.amount, vatMode);
    body.push([
      it.date, it.code, it.name, it.spec, it.qty, it.unit, sv.supply, sv.vat,
    ]);
  }
  if (body.length) {
    tab.getRange(hr + 1, 1, body.length, _PTS_COLS).setValues(body);
    tab.getRange(hr + 1, 1, body.length, _PTS_COLS)
      .setFontSize(9).setVerticalAlignment("middle")
      .setBorder(true, true, true, true, true, true);
    tab.getRange(hr + 1, 1, body.length, 2).setHorizontalAlignment("center");
    tab.getRange(hr + 1, 3, body.length, 1).setWrap(true);
    tab.getRange(hr + 1, 5, body.length, 1).setNumberFormat("#,##0").setHorizontalAlignment("right");
    tab.getRange(hr + 1, 6, body.length, 3).setNumberFormat("#,##0").setHorizontalAlignment("right");
  } else {
    tab.getRange(hr + 1, 1, 1, _PTS_COLS).merge()
      .setValue("해당 월에 마감된 거래가 없습니다.")
      .setHorizontalAlignment("center").setFontColor("#c62828");
  }

  // ── 합계 ──
  var sumRow = hr + Math.max(body.length, 1) + 1;
  tab.getRange(sumRow, 1, 1, 6).merge()
    .setValue("합 계").setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  tab.getRange(sumRow, 7).setValue(totals.supply);
  tab.getRange(sumRow, 8).setValue(totals.vat);
  tab.getRange(sumRow, 7, 1, 2).setNumberFormat("#,##0")
    .setFontWeight("bold").setHorizontalAlignment("right");
  tab.getRange(sumRow, 1, 1, _PTS_COLS)
    .setBackground("#eef3f9").setFontSize(10)
    .setBorder(true, true, true, true, true, true);
  tab.setRowHeight(sumRow, 24);

  var totRow = sumRow + 1;
  tab.getRange(totRow, 1, 1, 6).merge()
    .setValue("총 합 계 (공급가액 + 세액)").setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  tab.getRange(totRow, 7, 1, 2).merge().setValue(totals.total)
    .setNumberFormat("#,##0").setFontWeight("bold").setFontSize(12)
    .setFontColor("#c62828").setHorizontalAlignment("right");
  tab.getRange(totRow, 1, 1, _PTS_COLS)
    .setBackground("#e8f0fa")
    .setBorder(true, true, true, true, true, true);
  tab.setRowHeight(totRow, 28);

  // ── 하단 ──
  var footRow = totRow + 2;
  tab.getRange(footRow, 1).setValue("입금계좌").setFontWeight("bold").setFontSize(9);
  tab.getRange(footRow, 2, 1, 3).merge().setValue(issuer["입금계좌"]).setFontSize(9);
  tab.getRange(footRow, 5).setValue("담당자").setFontWeight("bold").setFontSize(9);
  tab.getRange(footRow, 6, 1, 3).merge()
    .setValue(_pts_join_(issuer["담당자"], issuer["전화"])).setFontSize(9);

  tab.getRange(footRow + 1, 1, 1, _PTS_COLS).merge()
    .setValue("· 위와 같이 거래명세를 통지합니다.   · 내역에 이의가 있으면 수령 후 7일 이내에 연락 주십시오.")
    .setFontSize(8).setFontColor("#666666");
  tab.getRange(footRow + 2, 1, 1, _PTS_COLS).merge()
    .setValue("생성 " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") +
      " · 원천 " + (pack.tabs.join(" + ") || "없음") +
      (pack.skipped ? " · 취소반품 제외 " + pack.skipped + "행" : "") +
      (pack.noInvoice ? " · 송장미발행 제외 " + pack.noInvoice + "행" : ""))
    .setFontSize(7).setFontColor("#999999");

  try { tab.setFrozenRows(0); } catch (e) {}
  try { tab.getRange(1, 1, footRow + 2, _PTS_COLS).setFontFamily("맑은 고딕"); } catch (e) {}

  return {
    rows: items.length,
    supply: totals.supply,
    vat: totals.vat,
    total: totals.total,
    docNo: docNo,
    tab: tab,
  };
}

function _pts_join_(a, b) {
  a = String(a || "").trim();
  b = String(b || "").trim();
  if (a && b) return a + " / " + b;
  return a || b;
}

function _pts_docSuffix_(vendor) {
  var s = String(vendor.name || vendor.fileName || "").replace(/[^0-9A-Za-z가-힣]/g, "");
  return s.substring(0, 8) || "V";
}

function _pts_unmergeAll_(tab) {
  try {
    var merged = tab.getRange(1, 1, tab.getMaxRows(), tab.getMaxColumns()).getMergedRanges();
    for (var i = 0; i < merged.length; i++) merged[i].breakApart();
  } catch (e) {}
}


// ═══════════════════════════════════════════
//  ⑤ PDF · 메일
// ═══════════════════════════════════════════

/** 대상월 PDF 폴더 (없으면 만든다). 루트 폴더ID는 설정에 되써 준다 */
function _pts_pdfFolder_(issuer, ym) {
  var rootId = String(issuer["PDF 폴더ID"] || "").trim();
  var root = null;
  if (rootId) {
    try { root = DriveApp.getFolderById(rootId); } catch (e) { root = null; }
  }
  if (!root) {
    var it = DriveApp.getFoldersByName(_PTS_ROOT_FOLDER);
    root = it.hasNext() ? it.next() : DriveApp.createFolder(_PTS_ROOT_FOLDER);
    try {
      var hub = _pts_hub_();
      var tab = hub.getSheetByName(_PTS_TAB_ISSUER);
      var r = _pts_issuerRowOf_(tab, "PDF 폴더ID");
      if (r > 0) tab.getRange(r, 2).setValue(root.getId());
    } catch (e2) {}
  }
  var sub = root.getFoldersByName(ym);
  return sub.hasNext() ? sub.next() : root.createFolder(ym);
}

/** 「거래명세표」 탭만 A4 세로 PDF 로 뽑는다 */
function _pts_exportPdf_(ss, tab, fileName, folder) {
  var url = "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export" +
    "?format=pdf&size=A4&portrait=true&fitw=true" +
    "&sheetnames=false&printtitle=false&pagenumbers=false" +
    "&gridlines=false&fzr=false&horizontal_alignment=CENTER" +
    "&top_margin=0.5&bottom_margin=0.5&left_margin=0.4&right_margin=0.4" +
    "&gid=" + tab.getSheetId();

  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("PDF 내보내기 실패 (HTTP " + res.getResponseCode() + ")");
  }
  var blob = res.getBlob().setName(fileName + ".pdf");

  // 같은 이름이 있으면 갈아끼운다 — 재발행 시 같은 달 PDF 가 쌓이면 어느 게 최신인지 모른다
  var old = folder.getFilesByName(fileName + ".pdf");
  while (old.hasNext()) { try { old.next().setTrashed(true); } catch (e) {} }
  return folder.createFile(blob);
}

function _pts_fillTokens_(text, ctx) {
  return String(text || "")
    .replace(/\{거래처명\}/g, ctx.vendorName)
    .replace(/\{대상월\}/g, ctx.ymLabel)
    .replace(/\{합계\}/g, ctx.total)
    .replace(/\{공급가액\}/g, ctx.supply)
    .replace(/\{세액\}/g, ctx.vat)
    .replace(/\{건수\}/g, ctx.rows)
    .replace(/\{문서번호\}/g, ctx.docNo);
}

function _pts_comma_(n) {
  return String(Math.round(_pms_toNumber_(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function _pts_sendMail_(issuer, vendor, ym, result, pdfFile) {
  var to = String(vendor.emails || "")
    .split(/[,;\s]+/)
    .filter(function (s) { return s.indexOf("@") !== -1; })
    .join(",");
  if (!to) return { sent: false, note: "수신메일 없음" };

  var p = _pts_parseMonth_(ym);
  var ctx = {
    vendorName: vendor.name || vendor.fileName,
    ymLabel: p.yyyy + "년 " + p.m + "월",
    total: _pts_comma_(result.total),
    supply: _pts_comma_(result.supply),
    vat: _pts_comma_(result.vat),
    rows: String(result.rows),
    docNo: result.docNo,
  };
  var subject = _pts_fillTokens_(issuer["메일 제목"] || "[팩투유] {거래처명} {대상월} 거래명세표", ctx);
  var body = _pts_fillTokens_(issuer["메일 본문"] || "", ctx);

  var opts = { attachments: [pdfFile.getAs("application/pdf")] };
  if (issuer["발신자 표시이름"]) opts.name = issuer["발신자 표시이름"];
  if (issuer["숨은참조(BCC)"]) opts.bcc = issuer["숨은참조(BCC)"];
  GmailApp.sendEmail(to, subject, body, opts);
  return { sent: true, note: to };
}


// ═══════════════════════════════════════════
//  ⑥ 발행
// ═══════════════════════════════════════════

/**
 * 협력업체 1건 발행.
 * @param {Object} opts {pdf:boolean, mail:boolean}
 */
function _pts_issueOne_(vendor, ym, issuer, opts) {
  var ss = SpreadsheetApp.openById(vendor.fileId);
  var pack = _pts_collectLines_(ss, ym, vendor.source);
  return _pts_issueWithPack_(ss, vendor, ym, issuer, pack, opts);
}

/**
 * 이미 모아 둔 pack 으로 탭을 그리고 PDF·메일까지 간다.
 * 월 단위 / 선택행 / 날짜구간이 모두 이 한 곳을 지난다 — 산출물이 갈라지면 안 된다.
 */
function _pts_issueWithPack_(ss, vendor, ym, issuer, pack, opts) {
  var result = _pts_render_(ss, issuer, vendor, ym, pack);
  SpreadsheetApp.flush();

  result.pdfUrl = "";
  result.mailNote = "";
  if (opts.pdf || opts.mail) {
    var p = _pts_parseMonth_(ym);
    var folder = _pts_pdfFolder_(issuer, p.ym);
    var fname = "거래명세표_" + p.ym + (pack.docTag ? "_" + pack.docTag : "") + "_" +
      String(vendor.name || vendor.fileName).replace(/[\\\/:*?"<>|]/g, "");
    var pdf = _pts_exportPdf_(ss, result.tab, fname, folder);
    result.pdfUrl = pdf.getUrl();
    if (opts.mail) {
      var m = _pts_sendMail_(issuer, vendor, ym, result, pdf);
      result.mailNote = m.sent ? "발송 " + m.note : "미발송(" + m.note + ")";
    }
  }
  return result;
}

/** 현재 열려 있는 협력업체 파일 1건 발행 (탭만 / 탭+PDF) */
function partnerIssueTaxStatementHere() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var issuer, vendors;
  try {
    issuer = _pts_readIssuer_();
    vendors = _pts_readVendors_();
  } catch (e) {
    ui.alert("거래명세표", e.message, ui.ButtonSet.OK);
    return;
  }

  var target = _pts_resolveTarget_(ui, vendors);
  if (!target) return;
  ss = target.ss;
  var vendor = target.vendor;

  var ym = _pts_askMonth_(ui);
  if (!ym) return;

  var mode = ui.alert(
    "거래명세표 발행",
    vendor.name + " · " + ym + "\n\n" +
      "[예] 탭 + PDF 저장\n[아니오] 탭만 생성\n[취소] 중단",
    ui.ButtonSet.YES_NO_CANCEL,
  );
  if (mode !== ui.Button.YES && mode !== ui.Button.NO) return;

  try {
    var r = _pts_issueOne_(vendor, ym, issuer, { pdf: mode === ui.Button.YES, mail: false });
    _pts_log_(ym, vendor, r, "수동");
    try { ss.setActiveSheet(r.tab); } catch (e3) {}
    ui.alert(
      "발행 완료",
      vendor.name + " · " + ym + "\n\n" +
        "품목 " + r.rows + "줄\n" +
        "공급가액 " + _pts_comma_(r.supply) + "\n" +
        "세액 " + _pts_comma_(r.vat) + "\n" +
        "합계 " + _pts_comma_(r.total) + "\n" +
        (r.pdfUrl ? "\nPDF: " + r.pdfUrl : ""),
      ui.ButtonSet.OK,
    );
  } catch (e4) {
    ui.alert("발행 실패", e4.message, ui.ButtonSet.OK);
  }
}

/** 전체 거래처 일괄 발행 (「발행」 체크된 것만) */
function partnerIssueTaxStatementsAll() {
  var ui = SpreadsheetApp.getUi();
  var issuer, vendors;
  try {
    issuer = _pts_readIssuer_();
    vendors = _pts_readVendors_();
  } catch (e) {
    ui.alert("거래명세표", e.message, ui.ButtonSet.OK);
    return;
  }
  var targets = vendors.filter(function (v) { return v.issue; });
  if (!targets.length) {
    ui.alert("거래명세표", "「발행」이 체크된 거래처가 없습니다.", ui.ButtonSet.OK);
    return;
  }

  var ym = _pts_askMonth_(ui);
  if (!ym) return;

  var withMail = ui.alert(
    "메일 발송",
    "PDF 를 거래처 수신메일로 발송할까요?\n\n" +
      "[예] PDF 저장 + 메일 발송\n[아니오] PDF 저장만 (메일 없음)\n[취소] 중단",
    ui.ButtonSet.YES_NO_CANCEL,
  );
  if (withMail !== ui.Button.YES && withMail !== ui.Button.NO) return;
  var doMail = withMail === ui.Button.YES;

  if (doMail) {
    var noMail = targets.filter(function (v) { return v.emails.indexOf("@") === -1; });
    var quota = 0;
    try { quota = MailApp.getRemainingDailyQuota(); } catch (e5) {}
    if (ui.alert(
      "최종 확인",
      "대상 " + targets.length + "개사 · " + ym + "\n" +
        (noMail.length ? "수신메일 없는 거래처 " + noMail.length + "곳은 PDF만 저장됩니다.\n" : "") +
        "남은 메일 발송 한도: " + quota + "\n\n" +
        "거래처로 실제 메일이 나갑니다. 계속할까요?",
      ui.ButtonSet.YES_NO,
    ) !== ui.Button.YES) return;
  }

  var doneKey = _PTS_DONE_KEY_ + _pts_parseMonth_(ym).ym + (doMail ? "_M" : "_P");
  var done = {};
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(doneKey);
    if (raw) done = JSON.parse(raw);
  } catch (e6) {}

  var t0 = new Date().getTime();
  var ok = 0, fail = 0, skip = 0, left = 0;
  var errs = [];

  for (var i = 0; i < targets.length; i++) {
    var v = targets[i];
    if (done[v.fileId]) { skip++; continue; }
    if (new Date().getTime() - t0 > _PTS_TIME_BUDGET_MS_) { left = targets.length - i; break; }
    try {
      var r = _pts_issueOne_(v, ym, issuer, { pdf: true, mail: doMail });
      _pts_log_(ym, v, r, doMail ? "일괄+메일" : "일괄");
      done[v.fileId] = 1;
      ok++;
    } catch (e7) {
      fail++;
      if (errs.length < 8) errs.push(v.name + ": " + e7.message);
      _pts_log_(ym, v, null, "실패 — " + e7.message);
    }
  }

  try {
    PropertiesService.getScriptProperties().setProperty(doneKey, JSON.stringify(done));
  } catch (e8) {}

  ui.alert(
    "일괄 발행 " + (left ? "중단 (시간 초과)" : "완료"),
    ym + "\n성공 " + ok + " · 실패 " + fail + " · 이미처리 " + skip +
      (left ? "\n남음 " + left + "건 — 같은 메뉴를 다시 실행하면 이어서 처리합니다." : "") +
      (errs.length ? "\n\n" + errs.join("\n") : ""),
    ui.ButtonSet.OK,
  );
}

/** 이어서 처리 기록 초기화 — 같은 달을 처음부터 다시 돌릴 때 */
function partnerResetTaxStatementProgress() {
  var ui = SpreadsheetApp.getUi();
  var ym = _pts_askMonth_(ui);
  if (!ym) return;
  var base = _PTS_DONE_KEY_ + _pts_parseMonth_(ym).ym;
  try {
    var props = PropertiesService.getScriptProperties();
    props.deleteProperty(base + "_M");
    props.deleteProperty(base + "_P");
  } catch (e) {}
  ui.alert("초기화", ym + " 진행기록을 지웠습니다.", ui.ButtonSet.OK);
}

function _pts_askMonth_(ui) {
  var res = ui.prompt(
    "대상월",
    "거래명세표를 끊을 달을 yyyy-MM 으로 입력하세요.\n(비우면 " + _pts_defaultMonth_() + ")",
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return "";
  var v = String(res.getResponseText() || "").trim() || _pts_defaultMonth_();
  try {
    return _pts_parseMonth_(v).ym;
  } catch (e) {
    ui.alert("대상월", e.message, ui.ButtonSet.OK);
    return "";
  }
}

function _pts_log_(ym, vendor, r, note) {
  try {
    var hub = _pts_hub_();
    var tab = hub.getSheetByName(_PTS_TAB_LOG);
    if (!tab) return;
    tab.appendRow([
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
      ym,
      vendor ? (vendor.name || vendor.fileName) : "",
      r ? r.rows : "",
      r ? r.supply : "",
      r ? r.vat : "",
      r ? r.total : "",
      r ? (r.pdfUrl || "") : "",
      r ? (r.mailNote || "") : "",
      note || "",
    ]);
  } catch (e) {}
}


// ═══════════════════════════════════════════
//  ⑦ 사전점검 (읽기만 한다)
// ═══════════════════════════════════════════

/**
 * 발행 전에 무엇이 비었는지 본다. 쓰지 않는다.
 * 마감탭 유무 · 줄수 · 금액 · 사업자정보 · 수신메일을 훑는다.
 */
function partnerDiagnoseTaxStatement() {
  var ui = SpreadsheetApp.getUi();
  var issuer, vendors;
  try {
    issuer = _pts_readIssuer_();
    vendors = _pts_readVendors_();
  } catch (e) {
    ui.alert("거래명세표 사전점검", e.message, ui.ButtonSet.OK);
    return;
  }
  var ym = _pts_askMonth_(ui);
  if (!ym) return;

  var vatMode = issuer["VAT 기준"] === "별도" ? "별도" : "포함";
  var missIssuer = [];
  var need = ["등록번호", "상호(법인명)", "대표자", "사업장주소"];
  for (var i = 0; i < need.length; i++) {
    if (!issuer[need[i]]) missIssuer.push(need[i]);
  }

  var targets = vendors.filter(function (v) { return v.issue; });
  var lines = [];
  var noTab = 0, noMail = 0, noBiz = 0, sumAll = 0, checked = 0;
  var t0 = new Date().getTime();

  for (var k = 0; k < targets.length; k++) {
    if (new Date().getTime() - t0 > _PTS_TIME_BUDGET_MS_) break;
    var v = targets[k];
    checked++;
    var row = "· " + (v.name || v.fileName);
    try {
      var ss = SpreadsheetApp.openById(v.fileId);
      var pack = _pts_collectLines_(ss, ym, v.source);
      if (!pack.tabs.length) {
        noTab++;
        row += " — ⚠️ 마감탭 없음";
      } else {
        var items = _pts_aggregate_(pack.lines).concat(pack.extras);
        var tt = _pts_totals_(items, vatMode);
        sumAll += tt.total;
        row += " — " + items.length + "줄 / " + _pts_comma_(tt.total) + "원";
      }
    } catch (e2) {
      row += " — ❌ " + e2.message;
    }
    if (!v.bizNo) { noBiz++; row += " · 등록번호없음"; }
    if (v.emails.indexOf("@") === -1) { noMail++; row += " · 메일없음"; }
    if (lines.length < 30) lines.push(row);
  }

  ui.alert(
    "거래명세표 사전점검 · " + ym,
    "공급자 정보 " + (missIssuer.length ? "⚠️ 누락: " + missIssuer.join(", ") : "✅ 정상") + "\n" +
      "VAT 기준 " + vatMode + " · 품목 표시 " + issuer["품목 표시"] + "\n\n" +
      "발행대상 " + targets.length + "개사 (점검 " + checked + ")\n" +
      "마감탭 없음 " + noTab + " · 등록번호 없음 " + noBiz + " · 수신메일 없음 " + noMail + "\n" +
      "합계 예상 " + _pts_comma_(sumAll) + "원\n\n" +
      lines.join("\n") +
      (targets.length > checked ? "\n… 시간 관계로 " + (targets.length - checked) + "개사 미점검" : ""),
    ui.ButtonSet.OK,
  );
}


// ═══════════════════════════════════════════
//  ⑧ 선택 행 · 날짜 구간 발행
//
//  월 단위로 끊는 게 기본이지만, 실무에서는 「이 몇 건만」·「이 날짜부터
//  저 날짜까지」로 끊어 달라는 요청이 온다. 원천 탭에서 바로 뽑는다.
//    · 발주 및 송장조회 / 전용양식 → 아직 마감 전 건 (송장 있는 행만 센다)
//    · (YYYY년 M월) 발주 마감 / 전용발주 마감 → 마감된 건
// ═══════════════════════════════════════════

/** 활성 파일에 대응하는 거래처. 거래처 탭에 없으면 파일 정보로 임시 구성한다 */
function _pts_vendorForActive_(ss, vendors) {
  for (var i = 0; i < vendors.length; i++) {
    if (vendors[i].fileId === ss.getId()) return vendors[i];
  }
  // 사업자정보 칸은 비게 된다 — 거래처 탭에 채워 두면 다음부터 자동으로 들어온다
  var nm = "";
  try {
    nm = String(ss.getSheetByName(_PT_DEPLOY_LOCAL_SETTINGS_TAB_NAME)
      .getRange(_PT_DEPLOY_LOCAL_VENDOR_NAME_CELL).getDisplayValue() || "").trim();
  } catch (e) {}
  return {
    fileId: ss.getId(), fileName: ss.getName(),
    name: nm || ss.getName().replace(_PT.PREFIX, "").trim(),
    bizNo: "", ceo: "", addr: "", biz1: "", biz2: "",
    contact: "", emails: "", source: "자동",
  };
}

/**
 * 발행 대상 파일을 정한다.
 *
 * 이 스크립트 메뉴는 마스터 시트에 붙어 있고, 원천 탭(발주 및 송장조회·마감탭)은
 * 협력업체 파일 안에 있다. 그래서 활성 파일이 협력업체 파일이 아니면 거래처를
 * 물어보고 그 파일을 연다.
 * @return {{ss:Object, vendor:Object}|null}
 */
function _pts_resolveTarget_(ui, vendors) {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  for (var i = 0; i < vendors.length; i++) {
    if (vendors[i].fileId === active.getId()) {
      return { ss: active, vendor: vendors[i] };
    }
  }
  if (!vendors.length) {
    ui.alert("거래명세표", "거래처 목록이 비어 있습니다. 「🔄 거래처 목록 동기화」를 먼저 실행하세요.", ui.ButtonSet.OK);
    return null;
  }

  var res = ui.prompt(
    "거래처 선택",
    "명세표를 뽑을 협력업체 이름의 일부를 입력하세요.\n(예: 부원, 뉴파츠, 준테크)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  var q = String(res.getResponseText() || "").replace(/\s+/g, "").toLowerCase();
  if (!q) return null;

  var hits = vendors.filter(function (v) {
    var hay = (v.name + " " + v.fileName).replace(/\s+/g, "").toLowerCase();
    return hay.indexOf(q) !== -1;
  });
  if (!hits.length) {
    ui.alert("거래처 선택", "「" + res.getResponseText() + "」와 맞는 거래처가 없습니다.", ui.ButtonSet.OK);
    return null;
  }
  if (hits.length > 1) {
    var names = hits.slice(0, 20).map(function (v, i2) { return (i2 + 1) + ". " + v.name; });
    ui.alert(
      "거래처 선택",
      hits.length + "곳이 걸립니다. 더 구체적으로 입력하세요.\n\n" + names.join("\n"),
      ui.ButtonSet.OK,
    );
    return null;
  }
  try {
    return { ss: SpreadsheetApp.openById(hits[0].fileId), vendor: hits[0] };
  } catch (e) {
    ui.alert("거래처 선택", hits[0].name + " 파일을 열 수 없습니다: " + e.message, ui.ButtonSet.OK);
    return null;
  }
}

/** "20260819" 또는 "2026-08-19" → 20260819 (숫자). 실패 시 0 */
function _pts_ymdNum_(s) {
  var d = String(s || "").replace(/[^0-9]/g, "");
  if (d.length !== 8) return 0;
  var n = parseInt(d, 10);
  var y = Math.floor(n / 10000);
  var m = Math.floor((n % 10000) / 100);
  var dd = n % 100;
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || dd < 1 || dd > 31) return 0;
  return n;
}

function _pts_fmtYmd_(n) {
  var s = String(n);
  return s.substring(0, 4) + "-" + s.substring(4, 6) + "-" + s.substring(6, 8);
}

/**
 * 현재 탭에서 **선택한 행**으로 거래명세표를 만든다.
 * 발주 및 송장조회 · 전용양식 · 마감탭 어디서든 된다.
 */
function partnerIssueTaxStatementFromSelection() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var issuer, vendors;
  try {
    issuer = _pts_readIssuer_();
    vendors = _pts_readVendors_();
  } catch (e) {
    ui.alert("거래명세표", e.message, ui.ButtonSet.OK);
    return;
  }

  var tab = ss.getActiveSheet();
  if (tab.getName() === _PTS_TAB_OUT) {
    ui.alert("거래명세표", "「거래명세표」 탭 자체에서는 뽑을 수 없습니다.\n발주 및 송장조회 · 전용양식 · 마감탭에서 행을 선택하세요.", ui.ButtonSet.OK);
    return;
  }

  var ranges = [];
  try { ranges = ss.getActiveRangeList().getRanges(); } catch (e2) {}
  if (!ranges.length) {
    try { ranges = [ss.getActiveRange()]; } catch (e3) {}
  }
  if (!ranges.length) {
    ui.alert("거래명세표", "행을 먼저 선택하세요. (Ctrl 로 떨어진 행도 함께 고를 수 있습니다)", ui.ButtonSet.OK);
    return;
  }

  var pack;
  try {
    pack = _pts_collectFromSelection_(tab, ranges);
  } catch (e4) {
    ui.alert("거래명세표", e4.message, ui.ButtonSet.OK);
    return;
  }
  if (!pack.lines.length && !pack.extras.length) {
    ui.alert(
      "거래명세표",
      "선택한 " + pack.selectedRows + "행에서 금액이 있는 품목을 찾지 못했습니다.\n" +
        "헤더 행이 아니라 데이터 행을 선택했는지, 단가·수량이 채워져 있는지 확인하세요." +
        (pack.skipped ? "\n(취소·반품 " + pack.skipped + "행 제외됨)" : ""),
      ui.ButtonSet.OK,
    );
    return;
  }

  var vendor = _pts_vendorForActive_(ss, vendors);
  var range = _pts_lineDateRange_(pack.lines);
  var ym = range.ym || _pts_defaultMonth_();
  pack.forceDetail = true;
  pack.docTag = "SEL";
  pack.periodLabel = range.label || (tab.getName() + " 선택분");

  var tt = _pts_totals_(
    _pts_previewItems_(pack, issuer),
    issuer["VAT 기준"] === "별도" ? "별도" : "포함",
  );
  var go = ui.alert(
    "선택분 거래명세표",
    tab.getName() + " · 선택 " + pack.selectedRows + "행\n" +
      "품목 " + pack.lines.length + "줄 · 기간 " + pack.periodLabel + "\n" +
      "합계 " + _pts_comma_(tt.total) + "원\n\n" +
      "[예] 탭 + PDF 저장\n[아니오] 탭만 생성\n[취소] 중단",
    ui.ButtonSet.YES_NO_CANCEL,
  );
  if (go !== ui.Button.YES && go !== ui.Button.NO) return;

  try {
    var r = _pts_issueWithPack_(ss, vendor, ym, issuer, pack, { pdf: go === ui.Button.YES, mail: false });
    _pts_log_(ym, vendor, r, "선택분 " + pack.selectedRows + "행 · " + tab.getName());
    try { ss.setActiveSheet(r.tab); } catch (e5) {}
    ui.alert(
      "발행 완료",
      vendor.name + "\n기간 " + pack.periodLabel + "\n\n" +
        "품목 " + r.rows + "줄\n합계 " + _pts_comma_(r.total) + "원" +
        (r.pdfUrl ? "\n\nPDF: " + r.pdfUrl : ""),
      ui.ButtonSet.OK,
    );
  } catch (e6) {
    ui.alert("발행 실패", e6.message, ui.ButtonSet.OK);
  }
}

/**
 * **날짜 구간**으로 거래명세표를 만든다.
 * 구간에 걸치는 마감탭 + 발주 및 송장조회 + 전용양식을 모두 훑는다.
 */
function partnerIssueTaxStatementByDateRange() {
  var ui = SpreadsheetApp.getUi();
  var issuer, vendors;
  try {
    issuer = _pts_readIssuer_();
    vendors = _pts_readVendors_();
  } catch (e) {
    ui.alert("거래명세표", e.message, ui.ButtonSet.OK);
    return;
  }

  var target = _pts_resolveTarget_(ui, vendors);
  if (!target) return;
  var ss = target.ss;
  var vendor = target.vendor;

  var res = ui.prompt(
    "날짜 구간 · " + vendor.name,
    "시작일과 종료일을 입력하세요.\n예) 2026-08-01 ~ 2026-08-15  또는  20260801 20260815",
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var parts = String(res.getResponseText() || "").split(/[~,\s]+/).filter(function (s) { return s; });
  var fromNum = _pts_ymdNum_(parts[0]);
  var toNum = _pts_ymdNum_(parts[1] || parts[0]);
  if (!fromNum || !toNum) {
    ui.alert("날짜 구간", "날짜를 읽지 못했습니다. yyyy-MM-dd 두 개로 입력하세요.", ui.ButtonSet.OK);
    return;
  }
  if (fromNum > toNum) { var t = fromNum; fromNum = toNum; toNum = t; }

  var qRes = ui.prompt(
    "품목 선택 (선택사항)",
    "특정 품목만 뽑으려면 품목명·코드의 일부를 콤마로 나눠 입력하세요.\n" +
      "예) 사각용기, BX100\n\n비워 두면 구간의 전 품목을 넣습니다.",
    ui.ButtonSet.OK_CANCEL,
  );
  if (qRes.getSelectedButton() !== ui.Button.OK) return;
  var itemQuery = _pts_parseItemQuery_(qRes.getResponseText());

  var pack;
  try {
    pack = _pts_collectByRange_(ss, fromNum, toNum, null, itemQuery);
  } catch (e2) {
    ui.alert("거래명세표", e2.message, ui.ButtonSet.OK);
    return;
  }
  if (!pack.lines.length && !pack.extras.length) {
    ui.alert(
      "거래명세표",
      vendor.name + " · " + _pts_fmtYmd_(fromNum) + " ~ " + _pts_fmtYmd_(toNum) +
        " 구간에 금액이 있는 품목이 없습니다.\n\n" +
        "훑은 탭: " + (pack.tabs.join(", ") || "없음") +
        (itemQuery ? "\n품목 필터: " + itemQuery.join(", ") : "") +
        (pack.noInvoice ? "\n송장 미발행 " + pack.noInvoice + "행 제외" : "") +
        (pack.skipped ? "\n취소·반품 " + pack.skipped + "행 제외" : ""),
      ui.ButtonSet.OK,
    );
    return;
  }

  var ym = String(Math.floor(fromNum / 10000)) + "-" +
    ("0" + Math.floor((fromNum % 10000) / 100)).slice(-2);
  pack.forceDetail = true;
  pack.docTag = "R" + String(fromNum).substring(4) + String(toNum).substring(4);
  pack.periodLabel = _pts_fmtYmd_(fromNum) + " ~ " + _pts_fmtYmd_(toNum);

  var tt = _pts_totals_(
    _pts_previewItems_(pack, issuer),
    issuer["VAT 기준"] === "별도" ? "별도" : "포함",
  );
  var go = ui.alert(
    "구간 거래명세표 · " + vendor.name,
    pack.periodLabel + "\n" +
      "품목 " + pack.lines.length + "줄 · 합계 " + _pts_comma_(tt.total) + "원\n" +
      "원천 " + pack.tabs.join(", ") + "\n" +
      (itemQuery ? "품목 필터 " + itemQuery.join(", ") + "\n" : "") +
      (pack.noInvoice ? "송장 미발행 " + pack.noInvoice + "행 제외\n" : "") +
      "\n[예] 탭 + PDF 저장\n[아니오] 탭만 생성\n[취소] 중단",
    ui.ButtonSet.YES_NO_CANCEL,
  );
  if (go !== ui.Button.YES && go !== ui.Button.NO) return;

  try {
    var r = _pts_issueWithPack_(ss, vendor, ym, issuer, pack, { pdf: go === ui.Button.YES, mail: false });
    _pts_log_(ym, vendor, r,
      "구간 " + pack.periodLabel + (itemQuery ? " · 품목 " + itemQuery.join("/") : ""));
    try { ss.setActiveSheet(r.tab); } catch (e3) {}
    ui.alert(
      "발행 완료",
      vendor.name + "\n기간 " + pack.periodLabel + "\n\n" +
        "품목 " + r.rows + "줄\n합계 " + _pts_comma_(r.total) + "원" +
        (r.pdfUrl ? "\n\nPDF: " + r.pdfUrl : ""),
      ui.ButtonSet.OK,
    );
  } catch (e4) {
    ui.alert("발행 실패", e4.message, ui.ButtonSet.OK);
  }
}

/** 확인 대화상자에 보여 줄 합계용 — 실제 렌더와 같은 집계 규칙을 쓴다 */
function _pts_previewItems_(pack, issuer) {
  var detail = pack.forceDetail === true || issuer["품목 표시"] === "일자별상세";
  var goods = detail ? pack.lines.slice(0) : _pts_aggregate_(pack.lines);
  return goods.concat(pack.extras);
}

/** 줄들의 날짜 범위 → {ym, label} */
function _pts_lineDateRange_(lines) {
  var min = 0;
  var max = 0;
  for (var i = 0; i < lines.length; i++) {
    var n = lines[i].dateNum || 0;
    if (!n) continue;
    if (!min || n < min) min = n;
    if (n > max) max = n;
  }
  if (!min) return { ym: "", label: "" };
  var ym = String(Math.floor(min / 10000)) + "-" +
    ("0" + Math.floor((min % 10000) / 100)).slice(-2);
  var label = min === max
    ? _pts_fmtYmd_(min)
    : _pts_fmtYmd_(min) + " ~ " + _pts_fmtYmd_(max);
  return { ym: ym, label: label };
}


// ═══════════════════════════════════════════
//  ⑨ 마감탭 골라 발행 — 화면에서 체크박스로 고른다
//
//  원천(마감탭)은 협력업체 파일 안에 있고 이 메뉴는 마스터 시트에 뜬다.
//  다른 파일의 행을 마우스로 클릭할 방법은 없으니, 그 파일 내용을 이 화면으로
//  **불러와서** 고르게 한다. 업체 시트에 메뉴를 심지 않는 이유이기도 하다 —
//  심으면 업체 담당자에게도 발행 버튼이 보인다.
//
//  google.script.run 으로 부르는 함수는 밑줄 접두어를 쓰지 않는다 (ptsPicker*).
// ═══════════════════════════════════════════

/** 메뉴 — 고르기 화면 열기 */
function partnerOpenTaxStatementPicker() {
  var html = HtmlService.createHtmlOutputFromFile("taxStatementPicker")
    .setWidth(1080)
    .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, "🧾 마감탭에서 골라 거래명세표 발행");
}

/** 화면 초기 데이터 — 거래처 목록 + 기본 대상월 */
function ptsPickerInit() {
  var vendors = _pts_readVendors_();
  return JSON.stringify({
    month: _pts_defaultMonth_(),
    vendors: vendors.map(function (v) {
      return { id: v.fileId, name: v.name || v.fileName, mail: v.emails, biz: v.bizNo };
    }),
  });
}

/** 화면에서 거래처 목록 동기화 — 알림창 없이 돌고 새 목록을 돌려준다 */
function ptsPickerSyncVendors() {
  var st = _pts_syncVendors_();
  var vendors = _pts_readVendors_();
  return JSON.stringify({
    added: st.added, files: st.files, renamed: st.renamed,
    vendors: vendors.map(function (v) {
      return { id: v.fileId, name: v.name || v.fileName, mail: v.emails, biz: v.bizNo };
    }),
  });
}

/**
 * 대상월 줄 목록을 불러온다.
 * @param {string} fileId 협력업체 파일
 * @param {string} ym     yyyy-MM
 * @param {boolean} includeLive 마감 전(발주 및 송장조회·전용양식)도 포함할지
 */
function ptsPickerLoad(fileId, ym, includeLive) {
  var p = _pts_parseMonth_(ym);
  var ss = SpreadsheetApp.openById(fileId);
  var acc = _pts_newAcc_();

  var specs = _pts_archiveSpecs_(p.ym, "자동");
  for (var s = 0; s < specs.length; s++) {
    var tab = ss.getSheetByName(specs[s].name);
    if (!tab) continue;
    _pts_scanTab_(tab, specs[s].headerRow, specs[s].kind, {}, acc);
  }

  if (includeLive) {
    // 마감 전 탭은 그 달 날짜 + 송장 있는 행만 — 마감 조건과 같게 맞춘다
    var from = parseInt(p.yyyy + ("0" + p.m).slice(-2) + "01", 10);
    var to = parseInt(p.yyyy + ("0" + p.m).slice(-2) + "31", 10);
    var liveNames = [_PMS_ORDER_TAB, "전용양식"];
    for (var i = 0; i < liveNames.length; i++) {
      var lt = ss.getSheetByName(liveNames[i]);
      if (!lt) continue;
      _pts_scanTab_(lt, 1, _pts_kindOfTab_(liveNames[i]),
        { fromNum: from, toNum: to, needInvoice: true }, acc);
    }
  }

  var pack = _pts_finishAcc_(acc);
  return JSON.stringify({
    tabs: pack.tabs,
    skipped: pack.skipped,
    noInvoice: pack.noInvoice,
    extras: pack.extras.map(function (e) { return { n: e.name, a: e.amount }; }),
    rows: pack.lines.map(function (l) {
      return {
        k: l.srcTab + "|" + l.srcRow,
        t: l.srcTab, d: l.date, c: l.code, n: l.name,
        s: l.spec, q: l.qty, u: l.unit, a: l.amount,
      };
    }),
  });
}

/** 고른 줄(키 배열)만으로 명세 pack 을 만든다 */
function _pts_collectByKeys_(ss, keys) {
  var byTab = {};
  for (var i = 0; i < keys.length; i++) {
    var cut = String(keys[i]).lastIndexOf("|");
    if (cut < 1) continue;
    var tabName = String(keys[i]).substring(0, cut);
    var row = parseInt(String(keys[i]).substring(cut + 1), 10);
    if (!row) continue;
    if (!byTab[tabName]) byTab[tabName] = {};
    byTab[tabName][row] = true;
  }
  var acc = _pts_newAcc_();
  for (var name in byTab) {
    if (!byTab.hasOwnProperty(name)) continue;
    var tab = ss.getSheetByName(name);
    if (!tab) continue;
    var hint = name.indexOf("전용발주 마감") !== -1 ? 1
      : (name.indexOf("발주 마감") !== -1 ? 4 : 1);
    _pts_scanTab_(tab, hint, _pts_kindOfTab_(name), { rowSet: byTab[name] }, acc);
  }
  return _pts_finishAcc_(acc);
}

/**
 * 고른 줄로 발행한다.
 * @param {string} keysJson 선택한 키 배열 JSON
 * @param {boolean} wantPdf PDF 까지 뽑을지
 */
function ptsPickerIssue(fileId, ym, keysJson, wantPdf) {
  var keys = JSON.parse(keysJson || "[]");
  if (!keys.length) throw new Error("고른 줄이 없습니다.");

  var issuer = _pts_readIssuer_();
  var vendors = _pts_readVendors_();
  var vendor = null;
  for (var i = 0; i < vendors.length; i++) {
    if (vendors[i].fileId === fileId) { vendor = vendors[i]; break; }
  }
  if (!vendor) throw new Error("거래처 탭에서 이 파일을 찾지 못했습니다. 「거래처 목록 동기화」를 실행하세요.");

  var ss = SpreadsheetApp.openById(fileId);
  var pack = _pts_collectByKeys_(ss, keys);
  if (!pack.lines.length && !pack.extras.length) {
    throw new Error("고른 줄에서 금액이 있는 품목을 찾지 못했습니다.");
  }

  var range = _pts_lineDateRange_(pack.lines);
  pack.forceDetail = true;
  pack.docTag = "PICK";
  pack.periodLabel = range.label || _pts_parseMonth_(ym).ym;

  var r = _pts_issueWithPack_(ss, vendor, range.ym || ym, issuer, pack,
    { pdf: wantPdf === true, mail: false });
  _pts_log_(range.ym || ym, vendor, r, "골라발행 " + keys.length + "행");

  return JSON.stringify({
    name: vendor.name,
    period: pack.periodLabel,
    rows: r.rows,
    supply: r.supply,
    vat: r.vat,
    total: r.total,
    pdfUrl: r.pdfUrl,
    docNo: r.docNo,
    sheetUrl: ss.getUrl() + "#gid=" + r.tab.getSheetId(),
  });
}


// ═══════════════════════════════════════════
//  ⑩ 거래처 사업자정보 채우기 — 손입력 줄이기
//
//  협력업체 40여 곳의 등록번호·대표자·주소를 손으로 넣는 건 실수가 나기 쉽다.
//  이미 갖고 있는 데이터에서 끌어온다.
//
//    1) CUST_CD  : 협력업체 파일 「설정」 B6 (배포 때부터 관리하던 값)
//    2) 사업자정보: 이카운트 거래처 마스터 (세금계산서를 끊으려면 거기 있어야 한다)
//
//  이카운트 거래처 조회 엔드포인트 이름이 계정/버전마다 달라
//  먼저 partnerProbeEcountCustomers 로 **어느 경로가 열려 있는지** 확인한 뒤
//  partnerFillVendorInfoFromEcount 로 채운다.
//
//  두 함수 모두 **빈 칸만** 채운다. 손으로 고쳐 둔 값은 덮지 않는다.
// ═══════════════════════════════════════════

/** 탐색할 거래처 조회 경로 후보 — 계정에 따라 열려 있는 것이 다르다 */
var _PTS_EC_CUST_PATHS_ = [
  "AccountBasic/GetBasicCust",
  "AccountBasic/GetBasicCustList",
  "AccountBasic/GetBasicCustomer",
  "CustBasic/GetBasicCust",
  "InventoryBasic/GetBasicCust",
];

/** 확인된 경로를 저장해 두는 스크립트 속성 키 */
var _PTS_EC_PATH_PROP_ = "PTS_ECOUNT_CUST_PATH";

/** 이카운트 로그인 — ecount.gs 의 존/로그인 헬퍼를 그대로 쓴다 */
function _pts_ecLogin_() {
  var zone = verifyZoneAPI();
  var sessionData = login(zone);
  var sid = "";
  try { sid = sessionData.Data.Datas.SESSION_ID; } catch (e) {}
  if (!sid) {
    throw new Error("이카운트 로그인 실패 — 「이카운트 작업 → 🔐 계정설정」에서 회사코드·사용자ID·API키를 확인하세요.");
  }
  return { zone: zone, sid: sid };
}

/** 거래처 목록 1회 호출 */
function _pts_ecCallCust_(auth, path) {
  var url = "https://oapi" + auth.zone + ".ecount.com/OAPI/V2/" + path +
    "?SESSION_ID=" + encodeURIComponent(auth.sid);
  var res = fetchWithRetry(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ "CUST": "" }),
    headers: { "Accept": "application/json", "Expect": "" },
    muteHttpExceptions: true,
  }, 2);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var data = null;
  try { data = JSON.parse(text); } catch (e) {}
  var rows = [];
  try {
    if (data && data.Data && data.Data.Result) rows = data.Data.Result;
  } catch (e2) {}
  return {
    path: path, http: code,
    status: data && data.Status ? String(data.Status) : "",
    rows: rows,
    raw: String(text || "").substring(0, 300),
  };
}

/**
 * [진단] 이카운트 거래처 조회가 되는지, 어떤 필드가 오는지 본다. 쓰지 않는다.
 * 성공한 경로는 스크립트 속성에 저장해 다음 실행에서 바로 쓴다.
 */
function partnerProbeEcountCustomers() {
  var ui = SpreadsheetApp.getUi();
  var auth;
  try {
    auth = _pts_ecLogin_();
  } catch (e) {
    ui.alert("이카운트 거래처 조회 진단", e.message, ui.ButtonSet.OK);
    return;
  }

  var lines = [];
  var hit = null;
  for (var i = 0; i < _PTS_EC_CUST_PATHS_.length; i++) {
    var r;
    try {
      r = _pts_ecCallCust_(auth, _PTS_EC_CUST_PATHS_[i]);
    } catch (e2) {
      lines.push("❌ " + _PTS_EC_CUST_PATHS_[i] + " — " + e2.message);
      continue;
    }
    if (r.status === "200" && r.rows.length) {
      lines.push("✅ " + r.path + " — " + r.rows.length + "건");
      if (!hit) hit = r;
    } else {
      lines.push("· " + r.path + " — HTTP " + r.http +
        (r.status ? " / Status " + r.status : "") +
        " " + r.raw.replace(/\s+/g, " ").substring(0, 90));
    }
  }

  var detail = "";
  if (hit) {
    try {
      PropertiesService.getScriptProperties().setProperty(_PTS_EC_PATH_PROP_, hit.path);
    } catch (e3) {}
    var keys = Object.keys(hit.rows[0] || {});
    var map = _pts_ecFieldMap_(keys);
    detail =
      "\n\n▶ 쓸 수 있는 경로: " + hit.path + " (저장함)\n" +
      "응답 필드 " + keys.length + "개:\n" + keys.join(", ").substring(0, 700) +
      "\n\n자동 인식 결과\n" +
      "· 거래처코드: " + (map.code || "❌ 못 찾음") + "\n" +
      "· 거래처명:   " + (map.name || "❌") + "\n" +
      "· 등록번호:   " + (map.bizNo || "❌") + "\n" +
      "· 대표자:     " + (map.ceo || "❌") + "\n" +
      "· 주소:       " + (map.addr || "❌") + "\n" +
      "· 업태/종목:  " + (map.biz1 || "❌") + " / " + (map.biz2 || "❌") + "\n" +
      "· 메일:       " + (map.email || "❌");
  } else {
    detail = "\n\n열려 있는 경로를 못 찾았습니다.\n" +
      "이카운트 ERP > OAPI설정에서 거래처 조회 API 사용 권한을 확인하세요.\n" +
      "권한이 없으면 사업자정보는 손으로 넣거나 사업자등록증 사본으로 채워야 합니다.";
  }

  ui.alert("이카운트 거래처 조회 진단", lines.join("\n") + detail, ui.ButtonSet.OK);
}

/**
 * 응답 필드명을 우리 항목으로 매핑한다.
 * 이카운트 필드명이 계정마다 조금씩 달라 이름 패턴으로 잡는다.
 */
function _pts_ecFieldMap_(keys) {
  var out = { code: "", name: "", bizNo: "", ceo: "", addr: "", biz1: "", biz2: "", email: "" };
  function pick(slot, re, avoid) {
    if (out[slot]) return;
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i]);
      if (avoid && avoid.test(k)) continue;
      if (re.test(k)) { out[slot] = k; return; }
    }
  }
  pick("bizNo", /BUSINESS_?NO|BIZ_?NO|REG_?NO|사업자/i);
  pick("ceo", /BOSS|CEO|REPRE|PRESIDENT|대표/i);
  pick("addr", /ADDR|주소/i);
  pick("biz1", /UPTAE|BUSINESS_?TYPE|업태/i);
  pick("biz2", /JONGMOK|BUSINESS_?ITEM|종목/i);
  pick("email", /E_?MAIL|EMAIL/i);
  pick("code", /^CUST$|^CUST_?CD$|거래처코드/i);
  pick("name", /CUST_?DES|CUST_?NAME|거래처명|상호/i);
  return out;
}

function _pts_ecVal_(row, key) {
  if (!key) return "";
  var v = row[key];
  return String(v == null ? "" : v).trim();
}

/**
 * 협력업체 파일 「설정」 B5/B6 에서 거래처명·CUST_CD 를 읽어 거래처 탭에 채운다.
 * 파일을 하나씩 열어야 해서 느리다 — 시간 예산에서 끊고, 다시 실행하면 이어서 간다.
 */
function partnerFillVendorCustCodes() {
  var ui = SpreadsheetApp.getUi();
  var hub = _pts_hub_();
  _pts_ensureHubTabs_(hub);
  var tab = hub.getSheetByName(_PTS_TAB_VENDOR);
  var vendors = _pts_readVendors_();
  if (!vendors.length) {
    ui.alert("거래처코드 채우기", "거래처 목록이 비어 있습니다. 먼저 동기화하세요.", ui.ButtonSet.OK);
    return;
  }

  var codeCol = _PTS_VENDOR_HEADERS_.indexOf("거래처코드") + 1;
  var t0 = new Date().getTime();
  var done = 0, skip = 0, fail = 0, left = 0;

  for (var i = 0; i < vendors.length; i++) {
    var v = vendors[i];
    if (v.custCd) { skip++; continue; }
    if (new Date().getTime() - t0 > _PTS_TIME_BUDGET_MS_) { left = vendors.length - i; break; }
    try {
      var ss = SpreadsheetApp.openById(v.fileId);
      var st = ss.getSheetByName(_PT_DEPLOY_LOCAL_SETTINGS_TAB_NAME);
      if (!st) { fail++; continue; }
      var cust = String(st.getRange(_PT_DEPLOY_LOCAL_CUST_CODE_CELL).getDisplayValue() || "").trim();
      var nm = String(st.getRange(_PT_DEPLOY_LOCAL_VENDOR_NAME_CELL).getDisplayValue() || "").trim();
      if (cust) { tab.getRange(v.row, codeCol).setValue(cust); done++; }
      if (nm && !v.name) tab.getRange(v.row, 4).setValue(nm);
    } catch (e) {
      fail++;
    }
  }

  ui.alert(
    "거래처코드 채우기 " + (left ? "중단 (시간 초과)" : "완료"),
    "채움 " + done + " · 이미있음 " + skip + " · 실패 " + fail +
      (left ? "\n남음 " + left + "건 — 다시 실행하면 이어서 처리합니다." : "") +
      "\n\n다음: 「🏢 이카운트에서 사업자정보 채우기」",
    ui.ButtonSet.OK,
  );
}

/**
 * 이카운트 거래처 마스터에서 등록번호·대표자·주소·업태·종목을 끌어와
 * 거래처 탭의 **빈 칸만** 채운다.
 * 매칭: CUST_CD 우선 → 없으면 거래처명 정확일치 → 부분일치(1건일 때만)
 */
function partnerFillVendorInfoFromEcount() {
  var ui = SpreadsheetApp.getUi();
  var path = "";
  try {
    path = String(PropertiesService.getScriptProperties()
      .getProperty(_PTS_EC_PATH_PROP_) || "").trim();
  } catch (e) {}
  if (!path) {
    ui.alert(
      "이카운트에서 채우기",
      "먼저 「🧪 이카운트 거래처 조회 진단」을 실행해 쓸 수 있는 경로를 확인하세요.",
      ui.ButtonSet.OK,
    );
    return;
  }

  var auth, res;
  try {
    auth = _pts_ecLogin_();
    res = _pts_ecCallCust_(auth, path);
  } catch (e2) {
    ui.alert("이카운트에서 채우기", e2.message, ui.ButtonSet.OK);
    return;
  }
  if (res.status !== "200" || !res.rows.length) {
    ui.alert("이카운트에서 채우기",
      "거래처를 못 받았습니다. (HTTP " + res.http + " / Status " + res.status + ")\n" + res.raw,
      ui.ButtonSet.OK);
    return;
  }

  var fm = _pts_ecFieldMap_(Object.keys(res.rows[0] || {}));
  if (!fm.bizNo) {
    ui.alert("이카운트에서 채우기",
      "응답에 사업자등록번호로 볼 만한 필드가 없습니다.\n진단 화면의 필드 목록을 확인해 주세요.",
      ui.ButtonSet.OK);
    return;
  }

  // 코드·이름으로 찾을 수 있게 색인
  var byCode = {}, byName = {}, all = [];
  for (var i = 0; i < res.rows.length; i++) {
    var row = res.rows[i];
    var rec = {
      code: _pts_ecVal_(row, fm.code),
      name: _pts_ecVal_(row, fm.name),
      bizNo: _pts_ecVal_(row, fm.bizNo),
      ceo: _pts_ecVal_(row, fm.ceo),
      addr: _pts_ecVal_(row, fm.addr),
      biz1: _pts_ecVal_(row, fm.biz1),
      biz2: _pts_ecVal_(row, fm.biz2),
      email: _pts_ecVal_(row, fm.email),
    };
    if (rec.code) byCode[rec.code] = rec;
    if (rec.name) byName[rec.name.replace(/\s+/g, "")] = rec;
    all.push(rec);
  }

  var hub = _pts_hub_();
  var tab = hub.getSheetByName(_PTS_TAB_VENDOR);
  var vendors = _pts_readVendors_();
  var filled = 0, matched = 0, noMatch = [];

  for (var v2 = 0; v2 < vendors.length; v2++) {
    var v = vendors[v2];
    var rec2 = null;
    if (v.custCd && byCode[v.custCd]) rec2 = byCode[v.custCd];
    if (!rec2 && v.name) {
      var key = v.name.replace(/\s+/g, "");
      if (byName[key]) rec2 = byName[key];
    }
    if (!rec2 && v.name) {
      var q = v.name.replace(/\s+/g, "");
      var hits = all.filter(function (r) {
        return r.name && r.name.replace(/\s+/g, "").indexOf(q) !== -1;
      });
      if (hits.length === 1) rec2 = hits[0];   // 여럿이면 손대지 않는다
    }
    if (!rec2) { noMatch.push(v.name || v.fileName); continue; }
    matched++;

    // 빈 칸만 채운다
    var plan = [
      { col: 5, cur: v.bizNo, val: rec2.bizNo },
      { col: 6, cur: v.ceo, val: rec2.ceo },
      { col: 7, cur: v.addr, val: rec2.addr },
      { col: 8, cur: v.biz1, val: rec2.biz1 },
      { col: 9, cur: v.biz2, val: rec2.biz2 },
      { col: 11, cur: v.emails, val: rec2.email },
    ];
    for (var p = 0; p < plan.length; p++) {
      if (!plan[p].cur && plan[p].val) {
        tab.getRange(v.row, plan[p].col).setValue(plan[p].val);
        filled++;
      }
    }
  }

  try { hub.setActiveSheet(tab); } catch (e3) {}
  ui.alert(
    "이카운트에서 채우기 완료",
    "이카운트 거래처 " + res.rows.length + "건\n" +
      "매칭 " + matched + "곳 · 채운 칸 " + filled + "개\n" +
      (noMatch.length
        ? "\n매칭 실패 " + noMatch.length + "곳 (손으로 넣어야 합니다):\n" +
          noMatch.slice(0, 15).join(", ")
        : ""),
    ui.ButtonSet.OK,
  );
}
