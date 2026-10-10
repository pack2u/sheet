/**
 * ══════════════════════════════════════════════════════════════
 *  달마다 따라 바뀌는 거래명세서   파일: _partnerLiveStatement.gs   (2026-10-10)
 *
 *  > "마감 양식도 거래명세서 같이 되면 좋겠어"
 *  > (고른 것) 달마다 명세서 탭 따로 — 마감표를 고치면 명세서도 바로 바뀐다
 *
 *  협력업체 파일에 「(2026년 10월) 거래명세서」 탭을 하나 둔다. 「(2026년 10월) 발주 마감」 옆이다.
 *  머리(공급자·공급받는자)는 값, 금액과 품목 줄은 «전부 수식»이다 — 마감표를 손으로 고치면
 *  명세서도 그 자리에서 바뀐다. 다시 «발행»할 필요가 없다.
 *
 *  ★ 품목 줄은 마감표 4행의 칸 «이름»으로 찾는다 ★ (마감 요약 _pms_summaryFormulas_ 와 같은 규칙)
 *    품목코드·품목명·금액 중 하나라도 있으면 한 줄 · 쉼표 섞인 글자 금액도 숫자로 읽는다.
 *    도서산간배송비·기타정산 합은 맨 아래 줄로 붙는다(0 이면 안 붙는다).
 *    그래서 명세서 합계 = 마감표 「🏷️ 최종 정산금액」. 11행에 둘을 견준 결과가 늘 보인다.
 *
 *  「거래명세표」(_partnerTaxStatement.gs)와는 다르다 — 그쪽은 버튼을 누른 «순간»을 찍어 PDF·메일로
 *  보내는 발행본이고, 이쪽은 달 내내 살아 있는 화면이다. 공급자·거래처 정보는 같은 허브 탭을 읽는다.
 *
 *  만드는 때
 *    · 밤 마감이 그 달 마감 탭에 줄을 붙일 때 — 없으면 만들고, 있으면 수식만 맞춘다 (_pls_ensure_)
 *    · 손으로: partnerRefreshMonthTabsThisMonth() — 업체 전부, 요약 수식까지 같이 맞춘다 (파일 맨 아래)
 *  다시 만들어도 된다 — 탭을 비우고 처음부터 그린다(손으로 쓴 것이 없는 탭이다).
 * ══════════════════════════════════════════════════════════════
 */
var _PLS_SUFFIX_    = "거래명세서";
var _PLS_COLS_      = 8;     // A~H — 「거래명세표」와 같은 폭
var _PLS_ITEM_ROW_  = 14;    // 품목 표 머리 · 15행부터 수식이 펼쳐진다

function _pls_tabName_(y, m) { return "(" + y + "년 " + m + "월) " + _PLS_SUFFIX_; }

/**
 * 품목 줄 수식 (15행 A칸 하나가 아래로 펼쳐진다) — 순수, 시험이 직접 부른다.
 * 어느 칸인지는 마감 탭 4행 머리글 «이름»으로 정하고, 수식은 검증된 꼴('마감'!L5:L)로 쓴다.
 * (사람이 마감 탭에 칸을 끼우면 시트가 이 참조도 따라 옮긴다. 스크립트가 바꾼 것은 밤 마감이 다시 맞춘다.)
 * @param {string} ref  마감 탭 참조 앞머리 — "'(2026년 10월) 발주 마감'!"  (같은 탭이면 "")
 * @param {string} vat  "포함" | "별도"
 * @param {Array}  hdr  마감 탭 4행 머리글
 * @param {string} 끝   범위 끝 행 — 보통 "" (열린 범위). 시험만 숫자를 준다.
 * @return {string|null}  금액 칸(정산금액)을 못 찾으면 null — 모르는 것을 0 으로 그리지 않는다
 */
function _pls_itemsFormula_(ref, vat, hdr, 끝) {
  function Lc(n) {
    var s = "", c = n;
    while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }
  function 찾기(앞) {
    for (var i = 0; i < (hdr || []).length; i++) {
      if (String(hdr[i] == null ? "" : hdr[i]).replace(/\s/g, "").indexOf(앞) === 0) return i + 1;
    }
    return 0;
  }
  var e = 끝 ? String(끝) : "";
  function R(col) { return ref + Lc(col) + _PMS_DATA_START + ":" + Lc(col) + e; }
  function 수(x) { return 'IFERROR(VALUE(SUBSTITUTE(TO_TEXT(' + x + '),",","")),0)'; }
  var price = 찾기("정산금액");
  if (!price) return null;
  var 일 = 찾기("주문일자"), 코 = 찾기("이카운트코드"), 품 = 찾기("품목명"), 량 = 찾기("수량");
  var 섬 = 찾기("도서산간"), 기 = 찾기("기타정산");
  var 빈글 = "LEFT(TO_TEXT(base),0)", 빈수 = "0*LEN(TO_TEXT(base))";
  var 공 = vat === "별도" ? "x" : "ROUND(x/1.1)";
  var 세 = vat === "별도" ? "ROUND(x*0.1)" : "x-ROUND(x/1.1)";
  function 나눔(식, 값) { return 식.split("x").join(값); }
  return "=ARRAYFORMULA(IFERROR(LET(" +
    "base," + R(price) + "," +
    "d," + (일 ? R(일) : 빈글) + "," +
    "c," + (코 ? R(코) : 빈글) + "," +
    "nm," + (품 ? R(품) : 빈글) + "," +
    "q," + (량 ? 수(R(량)) : 빈수) + "," +
    "a," + 수("base") + "," +
    "has,LEN(TO_TEXT(c))+LEN(TO_TEXT(nm))+ABS(a)," +
    'dt,IF(LEN(TO_TEXT(d))>=8,MID(TO_TEXT(d),5,2)&"/"&MID(TO_TEXT(d),7,2),TO_TEXT(d)),' +
    "unit,IF(q<>0,ROUND(a/q),a)," +
    "lines,FILTER(HSTACK(dt,c,nm,LEFT(TO_TEXT(c),0),q,unit," + 나눔(공, "a") + "," + 나눔(세, "a") + "),has>0)," +
    "isl," + (섬 ? "SUM(" + 수(R(섬)) + ")" : "0") + "," +
    "oth," + (기 ? "SUM(" + 수(R(기)) + ")" : "0") + "," +
    'ex,{"","","도서산간배송비","",1,isl,' + 나눔(공, "isl") + "," + 나눔(세, "isl") + ';' +
       '"","","기타정산","",1,oth,' + 나눔(공, "oth") + "," + 나눔(세, "oth") + "}," +
    'exf,IFERROR(FILTER(ex,CHOOSECOLS(ex,6)<>0),""),' +
    'all,IFNA(VSTACK(IFERROR(lines,""),exf),""),' +
    "FILTER(all,LEN(CHOOSECOLS(all,2)&CHOOSECOLS(all,3)&CHOOSECOLS(all,7))>0)" +
    '),""))';
}

/** 요약 칸 수식 — {"10,4": 공급가액, …}  순수 */
function _pls_summaryFormulas_(ref, vat) {
  var r0 = _PLS_ITEM_ROW_ + 1;
  var 견줄 = vat === "별도" ? "D10" : "H10";   //  별도면 마감표 금액이 곧 공급가액이다
  return {
    "10,2": "=TODAY()",
    "10,4": "=SUM(G" + r0 + ":G)",
    "10,6": "=SUM(H" + r0 + ":H)",
    "10,8": "=D10+F10",
    "11,6": '=MAX(0,COUNT(G' + r0 + ':G)-COUNTIF(C' + r0 + ':C,"도서산간배송비")-COUNTIF(C' + r0 + ':C,"기타정산"))',
    "11,8": '=IFERROR(IF(' + ref + '$A$3="🏷️ 최종 정산금액",IF(ABS(' + 견줄 + '-' + ref + '$B$3)<1,"✓ 마감표와 같음",' +
            '"⚠ 마감표 "&TEXT(' + ref + '$B$3,"#,##0")&"원과 다름"),"⚠ 마감표 요약 모양이 달라 못 견줌"),"⚠ 마감표를 못 읽음")'
  };
}

/**
 * 한 업체 파일에 그 달 명세서 탭을 (다시) 그린다.
 * @return {string} 한 줄 결과
 */
function _pls_build_(ss, y, m, issuer, vendor) {
  var 마감 = "(" + y + "년 " + m + "월) 발주 마감";
  if (!ss.getSheetByName(마감)) return "건너뜀 — 「" + 마감 + "」 탭이 없음";
  var ref = "'" + 마감.replace(/'/g, "''") + "'!";
  var vat = issuer["VAT 기준"] === "별도" ? "별도" : "포함";
  var 이름 = _pls_tabName_(y, m);
  var 마감머리 = ss.getSheetByName(마감).getRange(_PMS_HEADER_ROW, 1, 1, Math.max(ss.getSheetByName(마감).getLastColumn(), 1)).getValues()[0];
  var 품목식 = _pls_itemsFormula_(ref, vat, 마감머리, "");
  for (var hi = 0; hi + 1 < 마감머리.length; hi++) {
    if (String(마감머리[hi]).replace(/\s/g, "") === "취소" && String(마감머리[hi + 1]).replace(/\s/g, "") === "반품") {
      return "건너뜀 — 「" + 마감 + "」이 옛 모양(취소·반품 칸) — 「월별 마감 탭 레이아웃 보정」 뒤에 만든다";
    }
  }
  if (!품목식) return "건너뜀 — 「" + 마감 + "」 4행에 「정산금액」 칸이 없음(옛 모양일 수 있음)";

  var tab = ss.getSheetByName(이름);
  if (!tab) {
    //  마감 탭 바로 뒤에 둔다 — 둘을 나란히 본다
    var 자리 = ss.getSheetByName(마감).getIndex();
    tab = ss.insertSheet(이름, 자리);
  }
  try { tab.getRange(1, 1, tab.getMaxRows(), tab.getMaxColumns()).breakApart(); } catch (e) {}
  tab.clear();
  try { tab.getImages().forEach(function (g) { try { g.remove(); } catch (e) {} }); } catch (e) {}
  try { tab.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); }); } catch (e) {}
  try { tab.setTabColor("#1f4e78"); } catch (e) {}
  if (tab.getMaxColumns() > _PLS_COLS_) tab.deleteColumns(_PLS_COLS_ + 1, tab.getMaxColumns() - _PLS_COLS_);
  if (tab.getMaxColumns() < _PLS_COLS_) tab.insertColumnsAfter(tab.getMaxColumns(), _PLS_COLS_ - tab.getMaxColumns());

  var W = [52, 124, 170, 70, 44, 74, 88, 82];   //  「거래명세표」와 같다 (_pts_render_ 열 너비 주석)
  for (var c = 0; c < W.length; c++) tab.setColumnWidth(c + 1, W[c]);

  tab.getRange(1, 1, 1, _PLS_COLS_).merge().setValue("거 래 명 세 서")
    .setFontSize(22).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle");
  tab.setRowHeight(1, 44);
  tab.getRange(2, 1, 1, _PLS_COLS_).merge()
    .setValue("(공급받는자 보관용) · 「" + 마감 + "」을 따라 저절로 바뀝니다")
    .setFontSize(9).setFontColor("#666666").setHorizontalAlignment("center");
  tab.setRowHeight(3, 8);

  function 잇기(a, b) { return [a, b].filter(function (x) { return x; }).join(" / "); }
  var head = [
    ["등록번호", issuer["등록번호"] || "", "등록번호", vendor.bizNo || ""],
    ["상호(법인명)", issuer["상호(법인명)"] || "", "상호(법인명)", vendor.name || ""],
    ["대표자", issuer["대표자"] || "", "대표자", vendor.ceo || ""],
    ["사업장주소", issuer["사업장주소"] || "", "사업장주소", vendor.addr || ""],
    ["업태 / 종목", 잇기(issuer["업태"], issuer["종목"]), "업태 / 종목", 잇기(vendor.biz1, vendor.biz2)]
  ];
  tab.getRange(4, 1, head.length, 1).merge().setValue("공\n급\n자").setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground("#eef3f9");
  tab.getRange(4, 5, head.length, 1).merge().setValue("공급받는자").setFontWeight("bold").setWrap(true)
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground("#eef3f9");
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
  tab.getRange(4, 1, head.length, _PLS_COLS_).setBorder(true, true, true, true, true, true)
    .setFontSize(9).setVerticalAlignment("middle");
  tab.getRange(4, 3, head.length, 2).setWrap(true);
  tab.getRange(4, 7, head.length, 2).setWrap(true);
  tab.setRowHeight(9, 8);

  //  직인 — 「거래명세표」와 같은 자리(공급자 대표자 줄 오른쪽). 못 찍으면 로그에 남긴다
  var 직인ID = String(issuer["직인 이미지ID"] || "").trim();
  if (직인ID) {
    try {
      var 크기 = Math.max(30, Math.min(120, Number(issuer["직인 크기(px)"]) || 66));
      tab.insertImage(DriveApp.getFileById(직인ID).getBlob(), 4, 5, 2, 0).setWidth(크기).setHeight(크기);
    } catch (eSeal) { Logger.log("[거래명세서] 직인을 못 찍음: " + (eSeal && eSeal.message)); }
  }

  //  요약 — 금액은 전부 수식
  var f = _pls_summaryFormulas_(ref, vat);
  tab.getRange(10, 1).setValue("작성일자");
  tab.getRange(10, 3).setValue("공급가액");
  tab.getRange(10, 5).setValue("세액");
  tab.getRange(10, 7).setValue("합계금액");
  tab.getRange(11, 1).setValue("문서번호");
  tab.getRange(11, 2).setValue("P2U-" + y + ("0" + m).slice(-2) + "-" + String(vendor.name || ss.getName()).replace(/\s/g, ""));
  tab.getRange(11, 3).setValue("거래기간");
  tab.getRange(11, 4).setValue(y + "년 " + m + "월");
  tab.getRange(11, 5).setValue("건수");
  tab.getRange(11, 7).setValue("마감표 대조");
  Object.keys(f).forEach(function (k) {
    var rc = k.split(","); tab.getRange(+rc[0], +rc[1]).setFormula(f[k]);
  });
  tab.getRange(10, 2).setNumberFormat("yyyy-mm-dd");
  tab.getRange(10, 1, 2, _PLS_COLS_).setBorder(true, true, true, true, true, true).setFontSize(9).setVerticalAlignment("middle");
  [1, 3, 5, 7].forEach(function (col) { tab.getRange(10, col, 2, 1).setBackground("#f7f9fc").setFontWeight("bold"); });
  tab.getRange(10, 4).setNumberFormat("#,##0").setFontSize(10).setFontWeight("bold");
  tab.getRange(10, 6).setNumberFormat("#,##0").setFontSize(10).setFontWeight("bold");
  tab.getRange(10, 8).setNumberFormat("#,##0").setFontWeight("bold").setFontColor("#c62828").setFontSize(12);
  tab.getRange(11, 2).setWrap(true).setFontSize(8);
  tab.getRange(11, 8).setWrap(true).setFontSize(8);
  tab.setRowHeight(10, 22);
  tab.setRowHeight(11, 30);

  //  입금계좌 — 품목 줄이 아래로 늘어나므로 위에 둔다
  tab.getRange(12, 1).setValue("입금계좌").setFontWeight("bold").setFontSize(9).setBackground("#f7f9fc");
  tab.getRange(12, 2, 1, 3).merge().setValue(issuer["입금계좌"] || "").setFontSize(9);
  tab.getRange(12, 5).setValue("담당자").setFontWeight("bold").setFontSize(9).setBackground("#f7f9fc");
  tab.getRange(12, 6, 1, 3).merge().setValue(잇기(issuer["담당자"], issuer["전화"])).setFontSize(9);
  tab.getRange(12, 1, 1, _PLS_COLS_).setBorder(true, true, true, true, true, true).setVerticalAlignment("middle");
  tab.setRowHeight(13, 8);

  //  품목 표
  var hr = _PLS_ITEM_ROW_;
  tab.getRange(hr, 1, 1, _PLS_COLS_)
    .setValues([["일자", "품목코드", "품 목 명", "규격", "수량", "단가", "공급가액", "세액"]])
    .setBackground("#1f4e78").setFontColor("#ffffff").setFontWeight("bold").setFontSize(9)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  tab.setRowHeight(hr, 24);
  tab.getRange(hr + 1, 1).setFormula(품목식);
  var 끝 = tab.getMaxRows() - hr;
  if (끝 > 0) {
    var 몸 = tab.getRange(hr + 1, 1, 끝, _PLS_COLS_);
    몸.setFontSize(9).setVerticalAlignment("middle");
    tab.getRange(hr + 1, 1, 끝, 2).setHorizontalAlignment("center");
    tab.getRange(hr + 1, 2, 끝, 2).setWrap(true);
    tab.getRange(hr + 1, 5, 끝, 4).setNumberFormat("#,##0").setHorizontalAlignment("right");
    //  줄 수를 미리 모른다(수식이 펼쳐진다). 조건부 서식은 테두리를 못 그려서 옅은 줄무늬로 가른다
    try {
      var 줄무늬 = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied("=AND(LEN($C" + (hr + 1) + "&$G" + (hr + 1) + ")>0,ISEVEN(ROW()))")
        .setBackground("#f5f8fc").setRanges([몸]).build();
      tab.setConditionalFormatRules([줄무늬]);
    } catch (eCf) {}
  }
  tab.setFrozenRows(hr);

  //  손대지 말라는 표시만 — 막지는 않는다(경고만)
  try {
    tab.protect().setDescription("거래명세서 — 수식으로 채워집니다. 고칠 것은 「" + 마감 + "」에서")
      .setWarningOnly(true);
  } catch (e) {}
  return "만듦";
}

/** 허브의 공급자 정보 + 이 파일의 거래처 정보 (없으면 파일 이름만) */
function _pls_partiesFor_(fileId, fileName, issuer, vendors) {
  var v = null;
  for (var i = 0; i < vendors.length; i++) if (vendors[i].fileId === fileId) { v = vendors[i]; break; }
  return v || { name: String(fileName || "").replace(_PT.PREFIX, "").trim() };
}

/**
 * 밤 마감이 그 달 마감 탭에 줄을 붙인 뒤 부른다 — 실패해도 마감은 멈추지 않는다.
 *   · 명세서 탭이 없으면 만든다 (공급자·거래처 정보는 실행마다 한 번만 허브에서 읽는다)
 *   · 있으면 품목 줄 수식만 마감 탭 머리글에 맞춰 본다 — 다르면 그 한 칸만 고쳐 쓴다
 */
var _PLS_PARTIES_ = null;
function _pls_ensure_(ss, 마감탭이름) {
  try {
    var mt = String(마감탭이름).match(/^\((\d{4})년 (\d{1,2})월\) 발주 마감$/);
    if (!mt) return "";
    var y = +mt[1], m = +mt[2];
    var tab = ss.getSheetByName(_pls_tabName_(y, m));
    if (!_PLS_PARTIES_) {
      var vendors = [];
      try { vendors = _pts_readVendors_(); } catch (e) {}
      _PLS_PARTIES_ = { issuer: _pts_readIssuer_(), vendors: vendors };
    }
    var issuer = _PLS_PARTIES_.issuer;
    if (!tab) {
      return _pls_build_(ss, y, m, issuer, _pls_partiesFor_(ss.getId(), ss.getName(), issuer, _PLS_PARTIES_.vendors));
    }
    var 마감 = ss.getSheetByName(마감탭이름);
    var 머리 = 마감.getRange(_PMS_HEADER_ROW, 1, 1, Math.max(마감.getLastColumn(), 1)).getValues()[0];
    var ref = "'" + 마감탭이름.replace(/'/g, "''") + "'!";
    var 식 = _pls_itemsFormula_(ref, issuer["VAT 기준"] === "별도" ? "별도" : "포함", 머리, "");
    if (!식) return "";
    var 칸 = tab.getRange(_PLS_ITEM_ROW_ + 1, 1);
    if (String(칸.getFormula()).replace(/\s/g, "") !== 식.replace(/\s/g, "")) { 칸.setFormula(식); return "수식 고침"; }
    return "";
  } catch (e) {
    Logger.log("[거래명세서] " + 마감탭이름 + " 명세서를 못 맞춤 (마감은 그대로): " + e.message);
    return "";
  }
}

/**
 * 그 달 마감 탭 요약 수식 + 거래명세서를 업체 전부 한 번에 맞춘다 — 손으로 돌리는 것.
 *  밤 마감은 «줄을 붙인 업체»만 맞춘다. 줄이 안 붙은 업체도 지금 바로 맞추려면 이것을 돌린다.
 *  옛 모양(취소·반품 칸) 탭은 건너뛴다 — 「월별 마감 탭 레이아웃 보정」이 먼저다.
 * @param {string} 달  "2026-10" (비우면 이번 달)
 */
function partnerRefreshMonthTabs(달) {
  var ym = String(달 || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM"));
  var mt = ym.match(/^(\d{4})-(\d{1,2})$/);
  if (!mt) throw new Error("달은 2026-10 꼴로: " + ym);
  var 탭이름 = "(" + mt[1] + "년 " + +mt[2] + "월) 발주 마감";
  var files = _pt_listFiles();
  var 줄 = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    try {
      var ss = SpreadsheetApp.openById(f.id);
      var sh = ss.getSheetByName(탭이름);
      if (!sh) continue;
      var L = _pms_archiveLayout_(sh, ss.getSheetByName(_PMS_ORDER_TAB));
      if (!L) { 줄.push("✗ " + f.name + ": 칸 배치를 못 읽음"); continue; }
      if (L.구형) { 줄.push("· " + f.name + ": 옛 모양 — 건너뜀"); continue; }
      var 기대 = _pms_expectedSummaryFormulas_(L.cMap, L.islandC, L.etcC, L.extHdr);
      var 지금 = sh.getRange(2, 1, 2, 8).getFormulas();
      var 다름 = Object.keys(기대).some(function (k) {
        var rc = k.split(",");
        return _pms_normF_(지금[+rc[0] - 2][+rc[1] - 1]) !== _pms_normF_(기대[k]);
      });
      if (다름) _pms_applyFormulas_(sh, L.cMap, L.islandC, L.etcC, L.extHdr);
      var 명 = _pls_ensure_(ss, 탭이름);
      SpreadsheetApp.flush();
      var 위 = sh.getRange(2, 1, 2, 8).getDisplayValues();
      줄.push("✓ " + f.name + ": 요약 " + (다름 ? "다시 씀" : "그대로") + " · 명세서 " + (명 || "그대로") +
        " · 최종 " + 위[1][1] + " (정산 " + 위[0][3] + " + 도서산간 " + 위[0][5] + " + 기타 " + 위[0][7] + ")");
    } catch (e) {
      줄.push("✗ " + f.name + ": " + e.message);
    }
  }
  var 글 = 탭이름 + " — " + 줄.length + "곳\n" + 줄.join("\n");
  Logger.log(글);
  return 글;
}

/** 편집기에서 바로 돌리는 것 — 이번 달 */
function partnerRefreshMonthTabsThisMonth() {
  return partnerRefreshMonthTabs("");
}
