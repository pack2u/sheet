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
