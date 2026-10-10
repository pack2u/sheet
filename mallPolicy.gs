/**
 * ══════════════════════════════════════════════════════════════
 *  쇼핑몰별 수수료 · 가격정책  —  시트 설치 / 복구
 *  파일: mallPolicy.gs
 *  2026-10-10
 *
 *  > 사장님: "몰별 수수료는 정리해두는 시트나 엑셀을 만들어 두면 좋을꺼 같네"
 *  > 사장님: "수수료는 다 오픈되있어서 니가 찾을수 있을꺼 같은데"
 *
 *  ★ 왜 엑셀이 아니라 시트인가 ★
 *    가격 계산기는 Apps Script 다. 엑셀로 두면 사람이 다시 올려야 하고,
 *    올린 것과 쓰는 것이 갈라진다. 스크립트가 읽는 자리에 바로 둔다.
 *
 *  ★ 값이 두 벌이면 돈이 틀린다 ★
 *    요율이 오를 때 한쪽만 고쳐지고, 그 차이는 가격으로 나간다.
 *    여기가 유일한 원본이다 ([[one-value-one-owner]]).
 *
 *  ★ 수수료율을 세 겹으로 둔다 ★
 *      참고   공개 자료에서 찾은 값. 출처·조사일을 같이 적는다. 믿고 쓰면 안 된다.
 *      확인   판매자센터에서 직접 본 값. 넣으면 참고값을 대체한다.
 *      실효   정산서로 역산한 값. 가장 정확하다.
 *    적용수수료율 = 실효 > 확인+결제+쿠폰 > 참고+결제+쿠폰
 *    정확도가 올라갈 때마다 저절로 좋은 값을 쓴다. 옛 값은 지우지 않는다 —
 *    나중에 「왜 그 가격이었나」를 되짚을 수 있어야 한다.
 *
 *  ★ 찾아보니 출처마다 값이 달랐다 ★  (2026-10-09 조사)
 *    쿠팡 생활용품 수수료가 자료마다 7.8% · 8% · 10% 로 갈렸다.
 *    그래서 «공식 자료에서 확인된 것만» 참고값에 넣었다.
 *      쿠팡    공식 카테고리별 요율표 → 생활용품 7.8% · 주방용품 10.8%
 *      네이버  2025-06 개편 → 판매수수료 3.003%(일반유입·VAT포함)
 *      11번가  7~13% «범위만» 확인 → 비워 둔다
 *      지마켓  4~15%(통상 6.5~10%) «범위만» 확인 → 비워 둔다
 *    범위는 요율이 아니다. 비워 두고 비고에 범위를 적는 편이 낫다 —
 *    가운뎃값을 넣으면 그것이 확인된 값처럼 보인다.
 *
 *  ★ 추측값을 넣지 않는다 ★
 *    돈이 걸린 표다. 그럴듯한 값이 실제 값보다 나쁘다
 *    (_partnerStatementVision.gs 와 같은 손버릇).
 *
 *  쓰는 차례
 *    ① 🏪 쇼핑몰정책 시트 설치 / 복구
 *    ② 「쇼핑몰정책」에 운영 중인 몰을 모두 적는다 (쓰지 않는 몰은 사용=N)
 *    ③ 판매자센터에서 우리 카테고리 요율을 확인해 「확인수수료율」에 넣는다
 *    ④ 정산서를 받으면 「실효수수료_역산」에 월별로 한 줄 추가한다
 * ══════════════════════════════════════════════════════════════
 */

var _MP_TAB_POLICY_ = "쇼핑몰정책";
var _MP_TAB_EFF_    = "실효수수료_역산";
var _MP_TAB_PREVIEW_ = "가격계산_미리보기";

/** 몰 칸 수 — 14개 이상이라 여유를 둔다 */
var _MP_FIRST_ROW_ = 4;    // 3행은 예시
var _MP_ROWS_      = 18;

var _MP_PCT_ = "0.000%";
var _MP_WON_ = "#,##0";

/* 색 — 재무모델 관례를 따른다 */
var _MP_C_HEAD_  = "#252525";
var _MP_C_IN_    = "#FFFF00";   // 사람이 넣는 칸
var _MP_C_REF_   = "#FFF4E0";   // 내가 찾아 넣은 미검증 참고값
var _MP_C_EX_    = "#F0F0F0";   // 예시 행
var _MP_F_IN_    = "#0000FF";
var _MP_F_REF_   = "#777777";
var _MP_F_LNK_   = "#008000";
var _MP_F_FX_    = "#000000";

/**
 * 쇼핑몰정책 열 정의.
 *
 * ★ 칸을 «중간에 끼우지 않는다» ★
 *   끼우면 그 뒤가 한 칸씩 밀려, 이미 적어 둔 값이 엉뚱한 칸에서 읽힌다.
 *   (세트분리V2 「적요확인」 탭에서 실제로 겪은 일이다.)
 *   새 칸은 「비고」 앞에 더한다.
 *
 *   종류: in=사람입력 · ref=참고값(미검증) · lnk=타탭참조 · fx=수식
 */
var _MP_COLS_ = [
  { h: "몰ID",         w:  80, k: "in",  f: null,     note: "짧은 영문 약어. 실효수수료_역산 탭과 스크립트가 이 값으로 몰을 가리킨다" },
  { h: "몰명",         w: 130, k: "in",  f: null,     note: null },
  { h: "사용",         w:  55, k: "in",  f: null,     note: "Y 만 계산에 들어간다. 쓰지 않는 몰은 N" },
  { h: "매출비중",     w:  80, k: "in",  f: _MP_PCT_, note: "상세페이지 몰별 최적화 대상을 고르는 기준. 상위 몰만 전용 버전을 만든다" },
  { h: "참고수수료율", w: 100, k: "ref", f: _MP_PCT_, note: "공개 자료에서 찾은 미검증 값. 확인 전까지 임시로만 쓴다" },
  { h: "출처",         w: 210, k: "ref", f: null,     note: null },
  { h: "조사일",       w:  85, k: "ref", f: null,     note: null },
  { h: "확인수수료율", w: 100, k: "in",  f: _MP_PCT_, note: "판매자센터에서 직접 확인한 우리 카테고리 요율. 넣으면 참고값을 대체한다" },
  { h: "결제수수료율", w: 100, k: "in",  f: _MP_PCT_, note: "판매수수료에 포함돼 있으면 0. 스마트스토어는 주문관리수수료를 여기 넣는다" },
  { h: "쿠폰부담률",   w:  90, k: "in",  f: _MP_PCT_, note: "몰 쿠폰·프로모션 중 우리 부담분의 평균 비율. 모르면 0 으로 두고 실효율로 보정한다" },
  { h: "실효수수료율", w: 100, k: "lnk", f: _MP_PCT_, note: "실효수수료_역산 탭의 평균. 정산 데이터가 쌓이면 저절로 채워진다" },
  { h: "적용수수료율", w: 100, k: "fx",  f: _MP_PCT_, note: "실효 > 확인+결제+쿠폰 > 참고+결제+쿠폰. 가격 계산이 쓰는 값" },
  { h: "몰별고정비",   w:  90, k: "in",  f: _MP_WON_, note: "건당 고정비. 몰 전용 포장·스티커 등. 없으면 0" },
  { h: "올림단위",     w:  80, k: "in",  f: _MP_WON_, note: "100 이면 백원, 1000 이면 천원 단위 올림" },
  { h: "추가할인",     w:  80, k: "in",  f: _MP_WON_, note: "이 몰만 얼마 내릴 때. 계산된 가격에서 뺀다. 없으면 0" },
  { h: "최저허용가",   w:  90, k: "in",  f: _MP_WON_, note: "이 값 밑으로는 내려가지 않는다. 가드레일이니 꼭 넣는다" },
  { h: "사방넷몰코드", w: 100, k: "in",  f: null,     note: "사방넷이 쓰는 쇼핑몰 코드. API 가입 후 확인" },
  { h: "정산주기",     w:  85, k: "in",  f: null,     note: "'월 2회' · 'D+7' 등" },
  { h: "비고",         w: 420, k: "in",  f: null,     note: null }
];

/** 실효수수료_역산 열 */
var _MP_EFF_COLS_ = [
  { h: "정산월",       w:  85, k: "in",  f: null,     note: "YYYY-MM" },
  { h: "몰ID",         w:  80, k: "in",  f: null,     note: "쇼핑몰정책 탭의 몰ID 와 «같게» 적는다 — 이 값으로 이어진다" },
  { h: "몰명",         w: 130, k: "lnk", f: null,     note: null },
  { h: "판매액",       w: 120, k: "in",  f: _MP_WON_, note: "정산 기준 총 판매액. 부가세 포함 여부를 몰마다 일관되게 적는다" },
  { h: "실입금액",     w: 120, k: "in",  f: _MP_WON_, note: "실제로 통장에 들어온 금액" },
  { h: "차감합계",     w: 110, k: "fx",  f: _MP_WON_, note: null },
  { h: "실효수수료율", w: 100, k: "fx",  f: _MP_PCT_, note: "(판매액 − 실입금액) ÷ 판매액" },
  { h: "비고",         w: 440, k: "in",  f: null,     note: "반품차감·정산보류·광고비 상계 등. 이례적인 달은 적어 두고 평균에서 빼는 것이 좋다" }
];
var _MP_EFF_FIRST_ = 4;
var _MP_EFF_ROWS_  = 60;

/**
 * 공개 자료에서 확인한 참고값.
 *
 * ★ «공식 자료»에서 확인된 것만 넣는다 ★
 *   범위만 나온 몰은 비워 두고 비고에 범위를 적는다. 가운뎃값을 넣으면
 *   그것이 확인된 값처럼 보여서, 아무도 다시 확인하지 않는다.
 */
var _MP_SEED_ = [
  {
    id: "SS", name: "스마트스토어", ref: 0.03003,
    src: "네이버 2025-06 수수료 개편", day: "2026-10-09", unit: 1000,
    memo: "판매수수료 3.003%(일반유입·VAT포함). 마케팅링크 유입은 1.001%. " +
          "+ 주문관리수수료 1.98~3.63%(국세청 신고 매출규모별 · 3억 이하 1.98%) → 「결제수수료율」 칸에 넣는다. " +
          "2차 출처라 판매자센터 확인 필요"
  },
  {
    id: "CP", name: "쿠팡", ref: 0.078,
    src: "쿠팡 공식 카테고리별 요율표", day: "2026-10-09", unit: 1000,
    memo: "생활용품 7.8% 기준. 주방용품이면 10.8% — 우리 상품이 어느 카테고리로 등록됐는지 확인할 값어치가 있다(3%p 차이). " +
          "공식표 기준일 2019-11-25 · VAT 별도 고시"
  },
  {
    id: "11ST", name: "11번가", ref: null,
    src: "", day: "", unit: 1000,
    memo: "카테고리별 7~13%(2차 출처 · 범위만 확인). 범위는 요율이 아니라 비워 둠 — " +
          "판매자센터에서 우리 카테고리 요율을 확인해 「확인수수료율」에 넣는다"
  },
  {
    id: "GM", name: "지마켓", ref: null,
    src: "", day: "", unit: 1000,
    memo: "ESM 계열. 카테고리별 4~15% · 통상 6.5~10%(2차 출처 · 범위만). " +
          "판매자센터 확인 후 「확인수수료율」에 넣는다. 옥션도 쓰시면 같은 체계라 행을 하나 더 넣으면 된다"
  }
];

// ── 메뉴 ──────────────────────────────────────────────────
/**
 * 허브 메뉴에 붙인다.
 *
 * ★ onOpen 을 새로 만들지 않는다 ★
 *   이 프로젝트에는 이미 onOpen 이 있다(menu.gs). 두 개가 되면 하나만 걸리고
 *   나머지는 조용히 사라진다 — _debug_triggers.gs 가 적어 둔 그 사고다.
 *   menu.gs 의 onOpen 이 registerPack2UMenu_ · registerPartnerMenu_ 와
 *   나란히 이 함수를 부른다. 이름도 그 둘과 같은 꼴로 맞춘다.
 */
function registerMallPolicyMenu_() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu("🏪 쇼핑몰정책")
    .addItem("🛠 시트 설치 / 복구", "mpSetupSheets")
    .addSeparator()
    .addItem("🔎 몰 찾기 (원장에서 세기)", "mpDiscoverMalls")
    .addItem("📥 찾은 몰을 쇼핑몰정책에 채우기", "mpSeedPolicyFromDiscovery")
    .addSeparator()
    .addItem("🔍 설정 점검", "mpDiagnose")
    .addToUi();
}

// ── 공통 ──────────────────────────────────────────────────
function _mp_fontFor_(kind) {
  if (kind === "in")  return _MP_F_IN_;
  if (kind === "ref") return _MP_F_REF_;
  if (kind === "lnk") return _MP_F_LNK_;
  return _MP_F_FX_;
}

function _mp_fillFor_(kind, isExample) {
  if (isExample) return _MP_C_EX_;
  if (kind === "in")  return _MP_C_IN_;
  if (kind === "ref") return _MP_C_REF_;
  return null;
}

/** 탭을 얻거나 만든다 — 있으면 지우지 않는다 */
function _mp_sheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

/** 머리글 한 줄을 깔고 폭·메모를 맞춘다 */
function _mp_header_(sh, cols, headerRow) {
  var names = cols.map(function (c) { return c.h; });
  var rng = sh.getRange(headerRow, 1, 1, names.length);
  rng.setValues([names])
     .setBackground(_MP_C_HEAD_)
     .setFontColor("#F0F0F0")
     .setFontWeight("bold")
     .setFontFamily("Arial")
     .setHorizontalAlignment("center")
     .setVerticalAlignment("middle")
     .setWrap(true);
  sh.setRowHeight(headerRow, 34);
  for (var i = 0; i < cols.length; i++) {
    sh.setColumnWidth(i + 1, cols[i].w);
    if (cols[i].note) {
      sh.getRange(headerRow, i + 1).setNote(cols[i].note);
    }
  }
  sh.setFrozenRows(headerRow);
}

/** 본문 칸의 글꼴·배경·서식을 깐다 */
function _mp_body_(sh, cols, firstRow, rowCount, exampleRow) {
  for (var i = 0; i < cols.length; i++) {
    var col = cols[i];
    for (var r = exampleRow; r < firstRow + rowCount; r++) {
      var isEx = (r === exampleRow);
      var cell = sh.getRange(r, i + 1);
      cell.setFontFamily("Arial")
          .setFontSize(10)
          .setFontColor(_mp_fontFor_(col.k))
          .setFontStyle(col.k === "ref" ? "italic" : "normal")
          .setHorizontalAlignment(col.h === "몰명" || col.h === "비고" || col.h === "출처" ? "left" : "center")
          .setBorder(true, true, true, true, true, true, "#BBBBBB", SpreadsheetApp.BorderStyle.SOLID);
      var bg = _mp_fillFor_(col.k, isEx);
      if (bg) cell.setBackground(bg);
      if (col.f) cell.setNumberFormat(col.f);
    }
  }
}

// ── ① 설치 / 복구 ─────────────────────────────────────────
/**
 * 탭 셋을 만들고 수식을 심는다.
 *
 * ★ 사람이 적은 값은 지우지 않는다 ★
 *   다시 눌러도 머리글·서식·수식만 다시 깐다. 입력 칸은 건드리지 않는다.
 *   그래서 「복구」로도 쓴다 — 수식이 깨졌을 때 다시 누르면 된다.
 */
function mpSetupSheets() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 글 = ["■ 쇼핑몰정책 시트 설치 / 복구", ""];

  // ── 쇼핑몰정책 ──
  var sh = _mp_sheet_(ss, _MP_TAB_POLICY_);
  sh.getRange(1, 1).setValue(_MP_TAB_POLICY_)
    .setFontFamily("Arial").setFontSize(13).setFontWeight("bold");
  sh.getRange(1, 5)
    .setValue("노란 칸은 사람이 · 주황 칸은 공개 자료에서 찾은 미검증 참고값")
    .setFontFamily("Arial").setFontSize(10).setFontStyle("italic").setFontColor("#555555");

  _mp_header_(sh, _MP_COLS_, 2);
  _mp_body_(sh, _MP_COLS_, _MP_FIRST_ROW_, _MP_ROWS_, 3);
  sh.setFrozenColumns(2);

  // 예시 행 — 형식만 보여 준다. 사용=N 이라 계산에 안 들어간다
  var ex = sh.getRange(3, 1, 1, _MP_COLS_.length);
  if (!String(sh.getRange(3, 1).getValue() || "").trim()) {
    sh.getRange(3, 1, 1, 10).setValues([[
      "예시", "(예시 — 형식만)", "N", 0, 0.078, "예시 출처", "2026-10-09", 0.08, 0, 0
    ]]);
    sh.getRange(3, 13, 1, 4).setValues([[0, 1000, 0, 5000]]);
    sh.getRange(3, 18).setValue("월 2회");
    sh.getRange(3, 19).setValue("사용=N 이라 계산에 안 들어갑니다. 지우지 말고 형식 참고용으로 두세요");
  }

  // 참고값 심기 — 빈 줄에만 넣는다 (사람이 적은 것을 덮지 않는다)
  var seeded = 0;
  for (var s = 0; s < _MP_SEED_.length; s++) {
    var row = _MP_FIRST_ROW_ + s;
    var cur = String(sh.getRange(row, 1).getValue() || "").trim();
    if (cur) continue;               // 이미 뭔가 적혀 있다 — 건드리지 않는다
    var d = _MP_SEED_[s];
    sh.getRange(row, 1).setValue(d.id);
    sh.getRange(row, 2).setValue(d.name);
    sh.getRange(row, 3).setValue("Y");
    if (d.ref !== null) {
      sh.getRange(row, 5).setValue(d.ref);
      sh.getRange(row, 6).setValue(d.src);
      sh.getRange(row, 7).setValue(d.day);
    }
    sh.getRange(row, 14).setValue(d.unit);
    sh.getRange(row, 19).setValue(d.memo);
    seeded++;
  }

  // 수식 — K 실효(역산 평균) · L 적용
  var kF = [], lF = [];
  for (var r = 3; r < _MP_FIRST_ROW_ + _MP_ROWS_; r++) {
    kF.push(['=IFERROR(AVERAGEIFS(' + _MP_TAB_EFF_ + '!$G:$G,' +
             _MP_TAB_EFF_ + '!$B:$B,$A' + r + ',' +
             _MP_TAB_EFF_ + '!$G:$G,">0"),"")']);
    /*  적용수수료율 — 실효 > 확인 > 참고
        N() 으로 감싸는 이유: 빈칸·글자가 섞여도 0 으로 읽혀 #VALUE! 가 안 난다.  */
    lF.push(['=IF($A' + r + '="","",' +
             'IF(N($K' + r + ')>0,$K' + r + ',' +
             'IF(N($H' + r + ')>0,$H' + r + '+N($I' + r + ')+N($J' + r + '),' +
             'IF(N($E' + r + ')>0,$E' + r + '+N($I' + r + ')+N($J' + r + '),""))))']);
  }
  sh.getRange(3, 11, kF.length, 1).setFormulas(kF);
  sh.getRange(3, 12, lF.length, 1).setFormulas(lF);

  var anchor = _MP_FIRST_ROW_ + _MP_SEED_.length;
  if (!String(sh.getRange(anchor, 19).getValue() || "").trim()) {
    sh.getRange(anchor, 19)
      .setValue("← 여기부터 나머지 몰을 적으세요 (10개 이상). 몰ID 는 영문 약어로 짧게")
      .setFontColor("#AA5500").setFontStyle("italic");
  }
  글.push("· " + _MP_TAB_POLICY_ + " — 머리글·서식·수식 완료, 참고값 " + seeded + "개 심음");

  // ── 실효수수료_역산 ──
  var ef = _mp_sheet_(ss, _MP_TAB_EFF_);
  ef.getRange(1, 1).setValue(_MP_TAB_EFF_)
    .setFontFamily("Arial").setFontSize(13).setFontWeight("bold");
  ef.getRange(1, 4)
    .setValue("정산서를 받을 때마다 한 줄 · 쇼핑몰정책이 평균을 저절로 가져간다")
    .setFontFamily("Arial").setFontSize(10).setFontStyle("italic").setFontColor("#555555");

  _mp_header_(ef, _MP_EFF_COLS_, 2);
  _mp_body_(ef, _MP_EFF_COLS_, _MP_EFF_FIRST_, _MP_EFF_ROWS_, 3);

  if (!String(ef.getRange(3, 1).getValue() || "").trim()) {
    ef.getRange(3, 1, 1, 2).setValues([["2026-09", "예시"]]);
    ef.getRange(3, 4, 1, 2).setValues([[10000000, 8800000]]);
    ef.getRange(3, 8).setValue("(예시) 몰ID 가 '예시' 라 쇼핑몰정책의 예시행에만 걸립니다");
  }

  var cF = [], dF = [], gF = [];
  for (var e = 3; e < _MP_EFF_FIRST_ + _MP_EFF_ROWS_; e++) {
    cF.push(['=IFERROR(INDEX(' + _MP_TAB_POLICY_ + '!$B:$B,MATCH($B' + e + ',' +
             _MP_TAB_POLICY_ + '!$A:$A,0)),"")']);
    dF.push(['=IF(OR($D' + e + '="",$E' + e + '=""),"",$D' + e + '-$E' + e + ')']);
    /*  분모를 지킨다 — 판매액이 0 이면 #DIV/0! 이 뜨고, 그 오류가 쇼핑몰정책의
        평균까지 번져 적용수수료율이 통째로 깨진다.  */
    gF.push(['=IF(OR($D' + e + '="",$E' + e + '="",N($D' + e + ')=0),"",' +
             '($D' + e + '-$E' + e + ')/$D' + e + ')']);
  }
  ef.getRange(3, 3, cF.length, 1).setFormulas(cF);
  ef.getRange(3, 6, dF.length, 1).setFormulas(dF);
  ef.getRange(3, 7, gF.length, 1).setFormulas(gF);
  글.push("· " + _MP_TAB_EFF_ + " — 머리글·서식·수식 완료");

  // ── 가격계산_미리보기 ──
  mpBuildPreview_(ss);
  글.push("· " + _MP_TAB_PREVIEW_ + " — 공식 심음");

  글.push("");
  글.push("다음에 할 일");
  글.push("  ① 「" + _MP_TAB_POLICY_ + "」에 운영 중인 몰을 모두 적으세요 (14개 이상)");
  글.push("  ② 판매자센터에서 우리 카테고리 요율을 확인해 「확인수수료율」에 넣으세요");
  글.push("     11번가·지마켓은 범위만 확인돼 비워 두었습니다");
  글.push("  ③ 「최저허용가」를 꼭 넣으세요 — 가드레일입니다");
  글.push("");
  글.push("주황 칸은 제가 공개 자료에서 찾은 «미검증» 값입니다.");
  글.push("쿠팡 생활용품 요율이 자료마다 7.8%·8%·10% 로 갈려서, 공식표 값만 넣었습니다.");

  if (ui) ui.alert(글.join("\n"));
  return 글.join("\n");
}

/**
 * 가격계산_미리보기 — 공식이 맞는지 눈으로 보는 자리.
 *
 * ★ 여기서 전송하지 않는다 ★
 *   실제 전송은 스크립트가 한다. 이 탭은 「공식이 이런 값을 낸다」를
 *   사람이 확인하는 데만 쓴다. 두 곳에서 계산하면 값이 갈라진다.
 */
function mpBuildPreview_(ss) {
  var sh = _mp_sheet_(ss, _MP_TAB_PREVIEW_);

  sh.getRange(1, 1).setValue(_MP_TAB_PREVIEW_)
    .setFontFamily("Arial").setFontSize(13).setFontWeight("bold");
  sh.getRange(1, 4).setValue("공식 확인용 · 실제 전송은 스크립트가 한다")
    .setFontFamily("Arial").setFontSize(10).setFontStyle("italic").setFontColor("#555555");

  sh.getRange(3, 1).setValue("목표마진").setFontWeight("bold").setFontFamily("Arial");
  var mg = sh.getRange(3, 2);
  if (mg.getValue() === "" || mg.getValue() === null) mg.setValue(0.30);
  mg.setBackground(_MP_C_IN_).setFontColor(_MP_F_IN_)
    .setNumberFormat("0.0%").setFontFamily("Arial")
    .setNote("몰 공통 목표마진. 이 한 칸만 바꾸면 전 몰 가격이 다시 계산된다")
    .setBorder(true, true, true, true, false, false);
  sh.getRange(3, 3).setValue("← 이 칸만 바꾸면 아래가 전부 다시 계산된다")
    .setFontFamily("Arial").setFontSize(10).setFontStyle("italic").setFontColor("#555555");

  sh.getRange(5, 1).setValue("공식").setFontWeight("bold").setFontFamily("Arial");
  sh.getRange(5, 3).setValue(
    "판매가 = MAX( CEILING( (기준원가 + 몰별고정비) ÷ (1 − 목표마진 − 적용수수료율), 올림단위 ) − 추가할인,  최저허용가 )"
  ).setFontFamily("Arial").setFontSize(10);
  sh.getRange(6, 3).setValue(
    "기준원가 = (박스입수량 × 상품원가) + 박스배송비 + 포장비      ← 마진계산기와 같은 값"
  ).setFontFamily("Arial").setFontSize(10).setFontStyle("italic").setFontColor("#555555");

  var HR = 8, P1 = 9, PN = 14;

  var head = ["품목코드", "상품명", "기준원가"];
  sh.getRange(HR, 1, 1, 3).setValues([head])
    .setBackground(_MP_C_HEAD_).setFontColor("#F0F0F0")
    .setFontWeight("bold").setFontFamily("Arial")
    .setHorizontalAlignment("center");
  sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 240); sh.setColumnWidth(3, 95);

  /*  몰 이름은 쇼핑몰정책에서 끌어온다 — 거기서 이름을 바꾸면 여기도 따라온다.
      이름으로 찾지 않고 «줄 번호»로 가리킨다. 이름 매칭은 한 글자만 달라도 깨진다.  */
  var hF = [];
  for (var n = 0; n < _MP_ROWS_; n++) {
    var pol = _MP_FIRST_ROW_ + n;
    hF.push('=IF(' + _MP_TAB_POLICY_ + '!$B' + pol + '="","",' + _MP_TAB_POLICY_ + '!$B' + pol + ')');
    sh.setColumnWidth(4 + n, 95);
  }
  sh.getRange(HR, 4, 1, _MP_ROWS_).setFormulas([hF])
    .setBackground(_MP_C_HEAD_).setFontColor("#F0F0F0")
    .setFontWeight("bold").setFontFamily("Arial")
    .setHorizontalAlignment("center").setWrap(true);
  sh.setRowHeight(HR, 34);
  sh.setFrozenRows(HR);
  sh.setFrozenColumns(3);

  // 입력 칸
  sh.getRange(P1, 1, PN, 3)
    .setBackground(_MP_C_IN_).setFontColor(_MP_F_IN_).setFontFamily("Arial").setFontSize(10)
    .setBorder(true, true, true, true, true, true, "#BBBBBB", SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(P1, 3, PN, 1).setNumberFormat(_MP_WON_);

  if (!String(sh.getRange(P1, 1).getValue() || "").trim()) {
    sh.getRange(P1, 1, 1, 3).setValues([["예시", "(예시 — 기준원가만 넣으면 몰별 가격이 나옵니다)", 3500]]);
  }

  // 가격 수식
  var grid = [];
  for (var r = P1; r < P1 + PN; r++) {
    var line = [];
    for (var m = 0; m < _MP_ROWS_; m++) {
      var p = _MP_FIRST_ROW_ + m;
      var P = _MP_TAB_POLICY_;
      /*  빈칸으로 두는 조건을 먼저 본다 — 기준원가가 없거나, 몰이 비었거나,
          사용=N 이거나, 적용수수료율이 아직 없는 몰이다.
          「0 원」으로 보이면 사람이 그것을 가격으로 읽는다.  */
      line.push(
        '=IF(OR($C' + r + '="",' + P + '!$B' + p + '="",' + P + '!$C' + p + '<>"Y",' +
        'N(' + P + '!$L' + p + ')=0),"",' +
        'IF((1-$B$3-' + P + '!$L' + p + ')<=0,"정책오류",' +
        'MAX(CEILING(($C' + r + '+N(' + P + '!$M' + p + '))/(1-$B$3-' + P + '!$L' + p + '),' +
        'IF(N(' + P + '!$N' + p + ')=0,1,' + P + '!$N' + p + '))' +
        '-N(' + P + '!$O' + p + '),N(' + P + '!$P' + p + ')))'
      );
    }
    grid.push(line);
  }
  sh.getRange(P1, 4, PN, _MP_ROWS_).setFormulas(grid)
    .setNumberFormat(_MP_WON_).setFontFamily("Arial").setFontSize(10)
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#BBBBBB", SpreadsheetApp.BorderStyle.SOLID);

  var gr = P1 + PN + 2;
  sh.getRange(gr, 1).setValue("가드레일").setFontWeight("bold").setFontFamily("Arial");
  var notes = [
    "최저허용가   계산값이 이보다 낮으면 최저허용가로 올린다 (쇼핑몰정책 P열)",
    "정책오류     (1 − 목표마진 − 적용수수료율) ≤ 0 이면 가격이 성립하지 않는다. 마진 목표나 요율을 다시 본다",
    "빈칸         적용수수료율이 아직 없는 몰이다. 참고·확인·실효 중 아무것도 없으면 계산하지 않는다",
    "원가 역전    판매가 ≤ 기준원가 인 줄은 전송 전에 스크립트가 막는다 (이 탭은 미리보기라 표시만)",
    "변동률 상한  전일 대비 ±15% 를 넘는 줄은 전송하지 않고 「가격보류」로 뺀다 (스크립트)"
  ];
  for (var i = 0; i < notes.length; i++) {
    sh.getRange(gr + 1 + i, 2).setValue(notes[i])
      .setFontFamily("Arial").setFontSize(10).setFontStyle("italic").setFontColor("#555555");
  }
  return sh;
}

// ── ② 점검 ────────────────────────────────────────────────
/**
 * 설정이 말이 되는지 본다.
 *
 * ★ 조용히 넘어가지 않는다 ★
 *   요율을 안 넣은 몰은 가격이 «빈칸»으로 나온다. 빈칸은 눈에 안 띄어서
 *   「그 몰은 가격이 안 나가고 있다」를 아무도 모른 채 지나간다.
 */
function mpDiagnose() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(_MP_TAB_POLICY_);
  var 글 = ["■ 쇼핑몰정책 점검", ""];

  if (!sh) {
    글.push("★ 「" + _MP_TAB_POLICY_ + "」 탭이 없습니다 — 「🛠 시트 설치 / 복구」를 먼저 누르세요.");
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }

  var last = _MP_FIRST_ROW_ + _MP_ROWS_ - 1;
  var vals = sh.getRange(_MP_FIRST_ROW_, 1, _MP_ROWS_, 19).getDisplayValues();
  var 수치 = sh.getRange(_MP_FIRST_ROW_, 1, _MP_ROWS_, 19).getValues();

  var 쓰는몰 = 0, 요율없음 = [], 확인안됨 = [], 하한없음 = [], 실효있음 = 0, 중복 = {};
  for (var i = 0; i < vals.length; i++) {
    var id = String(vals[i][0] || "").trim();
    var nm = String(vals[i][1] || "").trim();
    var use = String(vals[i][2] || "").trim().toUpperCase();
    if (!id && !nm) continue;
    if (id) {
      중복[id] = (중복[id] || 0) + 1;
    }
    if (use !== "Y") continue;
    쓰는몰++;
    var 적용 = Number(수치[i][11]) || 0;
    var 확인 = Number(수치[i][7]) || 0;
    var 실효 = Number(수치[i][10]) || 0;
    var 하한 = Number(수치[i][15]) || 0;
    if (적용 <= 0) 요율없음.push(nm || id);
    else if (확인 <= 0 && 실효 <= 0) 확인안됨.push(nm || id);
    if (실효 > 0) 실효있음++;
    if (하한 <= 0) 하한없음.push(nm || id);
  }

  글.push("사용 중인 몰 : " + 쓰는몰 + "개");
  글.push("실효율 확보   : " + 실효있음 + "개");
  글.push("");

  if (요율없음.length) {
    글.push("★ 요율이 없어 «가격이 안 나가는» 몰 " + 요율없음.length + "개 ★");
    글.push("   " + 요율없음.join(" · "));
    글.push("   → 참고·확인·실효 중 하나라도 넣어야 계산됩니다.");
    글.push("");
  }
  if (확인안됨.length) {
    글.push("⚠ 미검증 참고값으로 계산 중인 몰 " + 확인안됨.length + "개");
    글.push("   " + 확인안됨.join(" · "));
    글.push("   → 판매자센터 요율을 「확인수수료율」에 넣으면 대체됩니다.");
    글.push("");
  }
  if (하한없음.length) {
    글.push("⚠ 최저허용가가 비어 가드레일이 없는 몰 " + 하한없음.length + "개");
    글.push("   " + 하한없음.join(" · "));
    글.push("");
  }
  var dup = [];
  for (var k in 중복) {
    if (Object.prototype.hasOwnProperty.call(중복, k) && 중복[k] > 1) dup.push(k);
  }
  if (dup.length) {
    글.push("★ 몰ID 중복 — 실효율 평균이 섞입니다 : " + dup.join(" · "));
    글.push("");
  }

  if (!요율없음.length && !확인안됨.length && !하한없음.length && !dup.length) {
    글.push("문제 없습니다.");
  }

  if (ui) ui.alert(글.join("\n"));
  return 글.join("\n");
}

// ══════════════════════════════════════════════════════════════
//  ③ 몰 찾기 — 우리 데이터에서 «사방넷으로 거래하는 몰»을 뽑는다
//
//  > 사장님: "판매현황에 법인/쿠팡 이런식으로 주문에 구분되게 되있어..
//  >  대리판매업체들은 제외하고 전화주문도 제외하면 우리가 사방넷으로
//  >  거래하는 쇼핑몰을 다 찾을수 있을꺼야.. 주문번호만으로도 구별이 가능하지"
//
//  ★ 물어보지 않고 «세어» 본다 ★
//    몰 목록을 사람 기억으로 적으면 쓰다 만 몰이 빠지거나 없는 몰이 들어온다.
//    원장에 실제로 주문이 들어온 몰만 센다. 건수가 곧 「쓰고 있나」의 답이다.
//
//  ★ 가르는 잣대는 고유ID 다 ★  (주문번호만으로 구별된다 — 사장님 말씀대로)
//      p0921000001 · 0921-PH-…      전화주문   → 뺀다
//      d0930000044 · 0901-ds-…      대리판매   → 뺀다
//      숫자뿐                        사방넷     → 센다
//    허브의 _po_isGeneratedUid_ 를 «그대로 부른다». 같은 프로젝트라 베낄 일이 없다.
//
//  ★ 원천은 주문라인원장이다 ★
//    세트분리(뉴)의 「주문라인원장」은 누적이고 회차마다 쌓인다.
//    판매현황은 회차마다 지워져 «지난 몰»이 안 보인다 — 그래서 원장을 본다.
//
//  ★★ 몰은 «품목명 꼬리»에만 있다 ★★  (2026-10-10 고침)
//    처음에 거래처명 칸을 판매처로 읽었다가 틀렸다 —
//      > 사장님: "지금 찾은 건 주문자 이름이네.. 상품명 뒤에
//      >  ---법인/쿠팡 ...---법인/자사몰 등이 적혀있는데 쇼핑몰들이야"
//    원장의 거래처명 칸에는 «주문자 이름»이 들어 있다. 그래서 몰 목록이
//    사람 이름으로 가득 찼다.
//
//    _partnerExclusivePush.gs 에 「거래처명 칸에는 법인/배민상회 같은
//    판매처가 들어 있다」는 주석이 있는데, 그것은 «일일마감» 이야기다.
//    같은 이름의 칸이 시트마다 다른 것을 담는다 — 주석을 원장에 그대로
//    옮겨 읽은 것이 잘못이었다.
//
//    그래서 몰은 품목명 꼬리에서만 읽는다 (CS웹앱이 쓰는 그 규칙이다).
//    거래처명은 「법인/」으로 시작할 때만 거든다 — 꼬리가 떨어진 줄 대비.
//
//  ★ 열은 이름으로 찾는다 ★
//    자리로 찾으면 원장에 칸이 하나 더해지는 날 조용히 엉뚱한 값을 센다.
// ══════════════════════════════════════════════════════════════

/** 세트분리(뉴) — 주문라인원장이 사는 곳. csReturnFee.gs 가 보는 시트와 같다 */
var _MP_SS_SHEET_ID_ = "1JuwZjorbBG7tOa92xfAy07eUV-r2j2P8bpbYrgCDAwo";
var _MP_SS_LEDGER_TAB_ = "주문라인원장";
var _MP_FOUND_TAB_ = "몰찾기결과";

/** 한 번에 보는 줄 수 상한 — 6분 한도를 넘기지 않으려고 둔다 */
var _MP_SCAN_MAX_ = 60000;

/** 사방넷 건을 가리키는 「주문번호출처」 값. 세트분리V2 SS_ORDNO_SRC 와 같은 글자 */
var _MP_SRC_SABANG_ = "사방넷";

/**
 * 포장 표지 — 몰 이름이 아니다.
 *
 * ★ 베낀 것이다 ★
 *   원본은 CS웹앱 home.html 의 LEDGER_PACK_MARKS 다. Apps Script 프로젝트가
 *   달라 함수를 못 부른다. 숨기지 않고 적어 둔다 —
 *   _mpmall_test.js 가 두 구현을 같은 입력으로 돌려 견준다.
 *   어긋나면 시험이 깨진다 (csReturnFee.gs 와 같은 손버릇).
 */
var _MP_PACK_MARKS_ = ["합포장", "합배송", "소분", "몸통만", "뚜껑만"];

/**
 * 품목명 꼬리에서 «거래처로 볼 만한 것»만 남긴다. 없으면 빈 문자열.
 * 원본: home.html 의 ledgerVendorFromItem
 */
function _mp_mallFromItem_(item) {
  var s = String(item || "");
  var cut = -1;
  var a = s.indexOf("---"), b = s.indexOf("===");
  if (a >= 0 && b >= 0) cut = Math.min(a, b);
  else cut = (a >= 0) ? a : b;
  if (cut < 0) return "";
  var 꼬리들 = s.substring(cut + 3).split(/---|===/);
  for (var i = 0; i < 꼬리들.length; i++) {
    var t = String(꼬리들[i] || "").trim();
    if (!t) continue;
    var 표지 = false;
    for (var m = 0; m < _MP_PACK_MARKS_.length; m++) {
      if (t.indexOf(_MP_PACK_MARKS_[m]) !== -1) { 표지 = true; break; }
    }
    if (표지) continue;
    return t;
  }
  return "";
}

/** 몰 이름으로 볼 수 없는 값인가 — 빈칸·포장표지·대리발송 */
function _mp_notAMall_(name) {
  var t = String(name || "").trim();
  if (!t) return true;
  if (t.indexOf("대리발송") === 0) return true;   // 대리발송-당장드림/탁기선
  for (var m = 0; m < _MP_PACK_MARKS_.length; m++) {
    if (t.indexOf(_MP_PACK_MARKS_[m]) !== -1) return true;
  }
  return false;
}

/**
 * 거래처명 칸을 몰로 «거들어» 쓸 수 있나.
 *
 * ★ 원장의 거래처명은 주문자 이름이다 ★  (2026-10-10)
 *   그래서 아무 값이나 받으면 몰 목록이 사람 이름으로 찬다.
 *   「법인/」으로 시작하는 것만 받는다 — 품목명 꼬리가 떨어진 줄을 메우는 용도다.
 *   「법인/」이 없는 몰(배민상회 등)은 이 길로는 안 들어온다. 그것이 맞다 —
 *   사람 이름과 가를 길이 없으면 «모른다»로 두는 편이 낫다.
 */
function _mp_mallFromVendor_(vendor) {
  var t = String(vendor || "").trim();
  if (t.indexOf("법인/") !== 0) return "";
  if (_mp_notAMall_(t)) return "";
  return t;
}

/** 머리글 이름 → 0-기준 자리. 못 찾으면 -1 */
function _mp_colOf_(header, names) {
  for (var n = 0; n < names.length; n++) {
    for (var i = 0; i < header.length; i++) {
      if (String(header[i] || "").trim() === names[n]) return i;
    }
  }
  return -1;
}

/**
 * 「김미화/p0921000001#2」 처럼 붙어 온 것에서 고유ID 만 떼어낸다.
 * (대장·원장이 그런 모양으로 담는다 — _csorigin_test.js [5] 참고)
 */
function _mp_baseUid_(uid) {
  var u = String(uid || "").trim();
  if (u.indexOf("/") >= 0) u = u.split("/").pop();
  return u.split("#")[0].trim();
}

/**
 * 원장을 훑어 사방넷 몰을 센다.
 *
 * ★ 조용히 빈손으로 돌아오지 않는다 ★
 *   원장을 못 읽으면 「몰이 없다」가 아니라 «못 봤다»다. 그때는 멈추고 말한다.
 */
function mpDiscoverMalls() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  var 글 = ["■ 몰 찾기 — 주문라인원장에서 사방넷 몰을 센다", ""];

  var src;
  try {
    src = SpreadsheetApp.openById(_MP_SS_SHEET_ID_);
  } catch (eOpen) {
    글.push("★ 세트분리(뉴) 시트를 못 열었습니다 — " + eOpen.message);
    글.push("   권한이나 시트ID(_MP_SS_SHEET_ID_)를 확인하세요.");
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }

  var tab = src.getSheetByName(_MP_SS_LEDGER_TAB_);
  if (!tab) {
    글.push("★ 「" + _MP_SS_LEDGER_TAB_ + "」 탭이 없습니다.");
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }

  var lastRow = tab.getLastRow();
  if (lastRow < 2) {
    글.push("★ 원장이 비어 있습니다 — 세트분리를 한 번 돌린 뒤 다시 보세요.");
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }

  var header = tab.getRange(1, 1, 1, tab.getLastColumn()).getDisplayValues()[0];
  var cUid    = _mp_colOf_(header, ["고유ID", "사방넷주문번호"]);
  var cSrc    = _mp_colOf_(header, ["주문번호출처"]);
  var cVendor = _mp_colOf_(header, ["거래처명"]);
  var cItem   = _mp_colOf_(header, ["품목명", "출력품목명"]);
  var cWhen   = _mp_colOf_(header, ["실행시각"]);

  if (cUid < 0) {
    글.push("★ 원장에 「고유ID」 칸이 없습니다 — 머리글이 바뀌었는지 보세요.");
    글.push("   앞쪽 머리글: " + header.slice(0, 8).join(" · "));
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }

  var n = Math.min(lastRow - 1, _MP_SCAN_MAX_);
  var 잘림 = (lastRow - 1) > n;

  /*  칸을 하나씩 읽는다 — 원장은 40칸이 넘어 통째로 읽으면 쓸데없이 무겁다  */
  function 열(ci) {
    if (ci < 0) return null;
    return tab.getRange(2, ci + 1, n, 1).getDisplayValues();
  }
  var uids    = 열(cUid);
  var srcs    = 열(cSrc);
  var vendors = 열(cVendor);
  var items   = 열(cItem);
  var whens   = 열(cWhen);

  var 센것 = {};          // 몰명 → { 건수, 처음, 마지막, 거래처명으로, 꼬리로 }
  var 전화 = 0, 대리 = 0, 모름 = 0, 사방넷 = 0;

  for (var i = 0; i < n; i++) {
    var uid = String(uids[i][0] || "").trim();
    if (!uid) continue;

    /*  ★ 잣대는 고유ID 하나다 ★
        「주문번호출처」 칸은 «있으면» 같이 본다. 옛 줄에는 그 칸이 없어
        어긋나는 날이 있다 — 그래서 고유ID 를 주인으로 둔다.  */
    var base = _mp_baseUid_(uid);
    if (_po_isGeneratedUid_(base)) {
      if (/^[pP]/.test(base) || /-PH-/i.test(base)) 전화++;
      else 대리++;
      continue;
    }
    if (cSrc >= 0) {
      var s = String(srcs[i][0] || "").trim();
      if (s && s !== _MP_SRC_SABANG_) { 모름++; continue; }   // 「자동발급」 등
    }
    사방넷++;

    /*  ★ 품목명 꼬리가 주인이다 ★  거래처명은 「법인/」일 때만 거든다.
        순서를 뒤집었다가 몰 목록이 주문자 이름으로 찼다 (2026-10-10).  */
    var 몰 = _mp_mallFromItem_(items && items[i] ? items[i][0] : "");
    var 어디서 = "꼬리";
    if (_mp_notAMall_(몰)) {
      몰 = _mp_mallFromVendor_(vendors && vendors[i] ? vendors[i][0] : "");
      어디서 = "거래처명";
    }
    if (_mp_notAMall_(몰)) { 모름++; continue; }

    var when = String(whens && whens[i] ? whens[i][0] : "").trim().slice(0, 10);
    if (!센것[몰]) {
      센것[몰] = { 건수: 0, 처음: when, 마지막: when, 거래처명으로: 0, 꼬리로: 0 };
    }
    var rec = 센것[몰];
    rec.건수++;
    if (어디서 === "거래처명") rec.거래처명으로++; else rec.꼬리로++;
    if (when) {
      if (!rec.처음 || when < rec.처음) rec.처음 = when;
      if (!rec.마지막 || when > rec.마지막) rec.마지막 = when;
    }
  }

  var 목록 = [];
  for (var k in 센것) {
    if (Object.prototype.hasOwnProperty.call(센것, k)) {
      목록.push({ 몰: k, d: 센것[k] });
    }
  }
  목록.sort(function (a, b) { return b.d.건수 - a.d.건수; });

  var 총건 = 0;
  for (var t2 = 0; t2 < 목록.length; t2++) 총건 += 목록[t2].d.건수;

  // ── 결과 탭에 적는다 ──
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = _mp_sheet_(ss, _MP_FOUND_TAB_);
  out.clear();

  out.getRange(1, 1).setValue(_MP_FOUND_TAB_)
    .setFontFamily("Arial").setFontSize(13).setFontWeight("bold");
  out.getRange(1, 4)
    .setValue("주문라인원장 " + n + "줄에서 셈 · " +
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"))
    .setFontFamily("Arial").setFontSize(10).setFontStyle("italic").setFontColor("#555555");

  var H = ["순위", "몰명", "건수", "줄비중", "처음", "마지막", "꼬리로", "거래처명(법인/)으로", "메모"];
  out.getRange(3, 1, 1, H.length).setValues([H])
    .setBackground(_MP_C_HEAD_).setFontColor("#F0F0F0")
    .setFontWeight("bold").setFontFamily("Arial").setHorizontalAlignment("center");
  out.setFrozenRows(3);
  var ws2 = [55, 210, 85, 80, 95, 95, 110, 85, 330];
  for (var w = 0; w < ws2.length; w++) out.setColumnWidth(w + 1, ws2[w]);

  if (목록.length) {
    var rows = [];
    for (var j = 0; j < 목록.length; j++) {
      var d = 목록[j].d;
      rows.push([
        j + 1, 목록[j].몰, d.건수,
        총건 ? d.건수 / 총건 : 0,
        d.처음, d.마지막, d.꼬리로, d.거래처명으로, ""
      ]);
    }
    out.getRange(4, 1, rows.length, H.length).setValues(rows)
      .setFontFamily("Arial").setFontSize(10)
      .setBorder(true, true, true, true, true, true, "#BBBBBB", SpreadsheetApp.BorderStyle.SOLID);
    out.getRange(4, 3, rows.length, 1).setNumberFormat(_MP_WON_);
    out.getRange(4, 4, rows.length, 1).setNumberFormat("0.0%");
    out.getRange(4, 2, rows.length, 1).setHorizontalAlignment("left");
  }

  var mr2 = 4 + 목록.length + 2;
  out.getRange(mr2, 1).setValue("셈한 내역").setFontWeight("bold").setFontFamily("Arial");
  var 내역 = [
    "사방넷 줄 : " + 사방넷 + "건  → 몰 " + 목록.length + "개",
    "전화주문  : " + 전화 + "건  (고유ID p… · …-PH-…)  → 뺌",
    "대리판매  : " + 대리 + "건  (고유ID d… · …-ds-…)  → 뺌",
    "몰 모름   : " + 모름 + "건  (품목명 꼬리가 없고 거래처명도 「법인/」이 아님)",
    "",
    "★ 몰은 «품목명 꼬리»에서 읽는다 — 「…200개---법인/쿠팡」 의 뒷부분이다.",
    "   원장의 거래처명 칸에는 «주문자 이름»이 들어 있어 몰로 쓰지 않는다.",
    "   「법인/」으로 시작하는 거래처명만 거든다 (꼬리가 떨어진 줄 대비).",
    "",
    "★ 「줄비중」은 주문 «줄» 비중이다 — 매출 비중이 아니다.",
    "   쇼핑몰정책의 「매출비중」에는 정산 금액 기준으로 따로 넣으세요.",
    "   줄비중은 건수가 많은 몰을, 매출비중은 돈이 큰 몰을 가리킨다. 둘은 다르다."
  ];
  if (잘림) {
    내역.unshift("⚠ 원장이 " + (lastRow - 1) + "줄인데 앞 " + n + "줄만 봤습니다 " +
      "(_MP_SCAN_MAX_). 몰이 빠질 수 있습니다.");
  }
  for (var x = 0; x < 내역.length; x++) {
    out.getRange(mr2 + 1 + x, 2).setValue(내역[x])
      .setFontFamily("Arial").setFontSize(10).setFontStyle("italic").setFontColor("#555555");
  }

  글.push("원장 " + n + "줄을 봤습니다.");
  글.push("");
  글.push("  사방넷 " + 사방넷 + "건  →  몰 " + 목록.length + "개");
  글.push("  전화주문 " + 전화 + "건 · 대리판매 " + 대리 + "건  →  뺌");
  글.push("  몰 모름 " + 모름 + "건");
  글.push("");
  if (목록.length) {
    글.push("찾은 몰 (건수순)");
    for (var p = 0; p < Math.min(목록.length, 25); p++) {
      글.push("  " + (p + 1) + ". " + 목록[p].몰 + "   " + 목록[p].d.건수 + "건");
    }
    if (목록.length > 25) 글.push("  … 그 외 " + (목록.length - 25) + "개");
  }
  글.push("");
  글.push("「" + _MP_FOUND_TAB_ + "」 탭에 적었습니다.");
  글.push("쇼핑몰정책에 옮기려면 「📥 찾은 몰을 쇼핑몰정책에 채우기」를 누르세요.");

  if (ui) ui.alert(글.join("\n"));
  return 글.join("\n");
}

/**
 * 찾은 몰을 쇼핑몰정책의 «빈 줄»에만 채운다.
 *
 * ★ 적힌 것을 덮지 않는다 ★
 *   요율을 넣어 둔 줄을 덮으면 그 값이 조용히 사라지고, 가격이 그것을 믿는다.
 *   이미 있는 몰명은 건너뛴다.
 */
function mpSeedPolicyFromDiscovery() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  var 글 = ["■ 찾은 몰을 쇼핑몰정책에 채우기", ""];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var found = ss.getSheetByName(_MP_FOUND_TAB_);
  var pol = ss.getSheetByName(_MP_TAB_POLICY_);
  if (!found) {
    글.push("★ 「" + _MP_FOUND_TAB_ + "」 탭이 없습니다 — 먼저 「🔎 몰 찾기」를 누르세요.");
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }
  if (!pol) {
    글.push("★ 「" + _MP_TAB_POLICY_ + "」 탭이 없습니다 — 먼저 「🛠 시트 설치 / 복구」를 누르세요.");
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }

  var fl = found.getLastRow();
  if (fl < 4) {
    글.push("★ 찾은 몰이 없습니다.");
    if (ui) ui.alert(글.join("\n"));
    return 글.join("\n");
  }
  var cand = found.getRange(4, 2, fl - 3, 2).getDisplayValues();   // 몰명 · 건수

  // 이미 적힌 몰명 (예시 행까지 본다)
  var have = {};
  var cur = pol.getRange(3, 1, _MP_ROWS_ + 1, 2).getDisplayValues();
  for (var i = 0; i < cur.length; i++) {
    var nm = String(cur[i][1] || "").trim();
    if (nm) have[nm] = true;
  }

  // 빈 줄 목록을 «한 번만» 만든다 — 줄마다 getValue 를 부르면 느리다
  var 빈줄 = [];
  for (var r = 0; r < cur.length; r++) {
    var row = 3 + r;
    if (row < _MP_FIRST_ROW_) continue;
    if (!String(cur[r][0] || "").trim() && !String(cur[r][1] || "").trim()) 빈줄.push(row);
  }

  var 넣음 = 0, 건너뜀 = 0, 자리없음 = 0, 쓴자리 = 0;
  for (var c = 0; c < cand.length; c++) {
    var 몰 = String(cand[c][0] || "").trim();
    if (!몰) continue;
    if (have[몰]) { 건너뜀++; continue; }
    if (쓴자리 >= 빈줄.length) { 자리없음++; continue; }

    var 자리 = 빈줄[쓴자리++];
    pol.getRange(자리, 2).setValue(몰);
    pol.getRange(자리, 3).setValue("Y");
    pol.getRange(자리, 14).setValue(1000);
    pol.getRange(자리, 19).setValue(
      "몰 찾기로 채움 (원장 " + cand[c][1] + "건). 몰ID·요율·최저허용가를 넣으세요");
    have[몰] = true;
    넣음++;
  }

  글.push("넣음 " + 넣음 + "개 · 이미 있어 건너뜀 " + 건너뜀 + "개");
  if (자리없음) {
    글.push("");
    글.push("⚠ 자리가 없어 못 넣은 몰 " + 자리없음 + "개 — _MP_ROWS_ (" + _MP_ROWS_ + ") 를 늘려야 합니다.");
  }
  글.push("");
  글.push("★ 몰ID 는 비워 뒀습니다 — 영문 약어로 직접 넣으세요.");
  글.push("   몰ID 가 없으면 「실효수수료_역산」과 이어지지 않습니다.");

  if (ui) ui.alert(글.join("\n"));
  return 글.join("\n");
}
