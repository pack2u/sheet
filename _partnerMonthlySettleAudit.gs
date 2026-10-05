/**
 * ══════════════════════════════════════════════════════════════
 *  월별 마감 탭 점검 — 수식·레이아웃이 제대로인가 (읽기만 한다)
 *  파일: _partnerMonthlySettleAudit.gs   2026-10-05
 *
 *  > "협력업체 월마감시트의 (…2609\대리판매 안에 들어있는 엑셀화일 업체들)
 *  >  수식과 레이아웃들이 제대로 되어있는지 확인 해줘"
 *
 *  ★ 무엇을 보나 ★
 *    ① 1행 제목 · 4행 머리글 — 지금 발주 탭으로 만든 머리글과 같은가
 *    ② 2~3행 요약 수식 — 보정 코드(_pms_applyFormulas_)가 넣을 수식과 같은가
 *    ③ 요약 «값» — 데이터로 다시 셈한 값과 같은가 (수식이 맞아도 값이 틀릴 수 있다:
 *       금액 칸에 글자가 하나라도 있으면 SUMPRODUCT 가 오류 → IFERROR 가 0 을 낸다)
 *    ④ 칸 밀림 — 일자 칸에 날짜, 수량·금액 칸에 숫자가 있나. 보정은 머리글을
 *       «지금» 발주 탭으로 덮으므로, 발주 탭 칸이 바뀐 뒤면 옛 데이터와 어긋난다
 *    ⑤ 취소·반품 체크박스 · 4행 고정 · 머리글 보호 · 오류값(#REF! 등)
 *    ⑥ 조건부 서식 겹침 — 레이아웃 보정은 돌 때마다 규칙 두 개를 «덧붙인다»
 *
 *  돌리는 법: 편집기에서 partnerAuditMonthlySettle_2609 ▶ 실행 → 실행 로그
 * ══════════════════════════════════════════════════════════════
 */

/**
 * 바탕화면 2609\대리판매 의 엑셀 파일 이름에서 뽑은 업체들 — 협력업체 파일 이름으로.
 *   올팩코리아 → 「올팩」, 불스떡볶이 → 「불쓰떡볶이」 (파일 이름이 이렇다)
 *   개인팩투유·인더샵(스마트스토어·쿠팡·배민상회 채널)·펀앤아이는 협력업체 시트가 없다 — 뺀다
 */
var _PMS_AUDIT_2609_ = [
  "그린우드", "뉴파츠", "당장드림", "냅킨코리아", "리바이", "밥장인",
  "불쓰떡볶이", "쉬움", "엠케이테크", "올팩", "용기창고", "준테크",
  "하나팩", "후아코리아"
];

function partnerAuditMonthlySettle_2609() {
  return _pms_auditRun_(_PMS_AUDIT_2609_, 2026, 9);
}

function _pms_auditRun_(names, y, m) {
  var 시작 = Date.now();
  var files = _pt_listFiles();
  var 말 = ["■ 월별 마감 탭 점검 — (" + y + "년 " + m + "월) 발주 마감 · 읽기만 함", ""];
  var 고른 = [], 본 = {};
  names.forEach(function (n) {
    var hit = files.filter(function (f) { return _pms_vendorLabel_(f).indexOf(n) !== -1; });
    if (!hit.length) { 말.push("  ❓ " + n + " — 협력업체 파일을 못 찾음"); return; }
    hit.forEach(function (f) { if (!본[f.id]) { 본[f.id] = 1; 고른.push(f); } });
  });

  var 좋음 = 0, 나쁨 = 0;
  for (var i = 0; i < 고른.length; i++) {
    if (Date.now() - 시작 > _PMS_REPAIR_LIMIT_MS_) {
      말.push("", "⏱ 시간이 모자라 못 본 업체: " + 고른.slice(i).map(_pms_vendorLabel_).join(", "));
      break;
    }
    var f = 고른[i], r;
    try { r = _pms_auditOne_(SpreadsheetApp.openById(f.id), y, m); }
    catch (e) { r = { 문제: ["점검 중 오류: " + e.message], 요약: "" }; }
    if (r.문제.length) {
      나쁨++;
      말.push("", "⚠ " + _pms_vendorLabel_(f) + (r.요약 ? "  (" + r.요약 + ")" : ""));
      r.문제.forEach(function (p) { 말.push("     · " + p); });
    } else {
      좋음++;
      말.push("", "✅ " + _pms_vendorLabel_(f) + "  (" + r.요약 + ")");
    }
  }
  말.push("", "합계  이상 없음 " + 좋음 + " · 손볼 것 있음 " + 나쁨 + "   " + Math.round((Date.now() - 시작) / 1000) + "초");
  Logger.log(말.join("\n"));
  return 좋음 + " ok / " + 나쁨 + " 문제";
}

/** 한 업체의 한 달 마감 탭 점검 */
function _pms_auditOne_(ss, y, m) {
  var 문제 = [];
  var 탭이름 = "(" + y + "년 " + m + "월) 발주 마감";
  var sh = ss.getSheetByName(탭이름);
  if (!sh) {
    var 있는 = ss.getSheets().map(function (t) { return t.getName(); })
      .filter(function (n) { return n.indexOf("발주 마감") !== -1; });
    return { 문제: ["마감 탭이 없음 — " + 탭이름 + "  (있는 마감 탭: " + (있는.join(", ") || "하나도 없음") + ")"], 요약: "" };
  }
  var orderTab = ss.getSheetByName(_PMS_ORDER_TAB);

  //  기준 — 보정이 쓰는 것과 똑같이: 그 마감 탭 4행의 제 배치
  var L = _pms_archiveLayout_(sh, orderTab);
  if (!L) return { 문제: ["4행에 취소·반품 칸이 없고 발주 탭도 없어 기준을 못 만듦"], 요약: "" };
  if (L.출처 === "발주") 문제.push("4행에서 「취소」「반품」 칸을 못 찾음 — 발주 탭 폭으로 짐작해 견줌");
  if (L.메움.length) 문제.push("4행 머리글이 깨짐 — " + L.메움.map(function (i) { return _pms_audit_col_(i + 1) + "4"; }).join(", ") + " (보정하면 발주 탭 이름으로 메움)");
  var cMap    = L.cMap;
  var extHdr  = L.extHdr;
  var extLc   = L.extLc;
  var c = { cancel: L.cancelC, ret: L.returnC, ship: L.shipFeeC, island: L.islandFeeC, etc: L.etcFeeC };

  var maxC = Math.max(sh.getMaxColumns(), extLc, 10);
  var 위 = sh.getRange(1, 1, _PMS_HEADER_ROW, maxC);
  var 위값 = 위.getValues(), 위식 = 위.getFormulas(), 위글 = 위.getDisplayValues();

  //  ① 제목 · 머리글
  if (String(위값[0][0]).trim() !== "📊 월별 마감 요약") 문제.push("1행 제목이 다름: 「" + 위값[0][0] + "」");
  var 다른머리 = _pms_audit_headerDiff_(위값[3], extHdr).filter(function (d) {
    //  깨진 칸(#REF!·빈칸)은 위에서 따로 알렸다
    return !L.메움.some(function (i) { return d.indexOf(_pms_audit_col_(i + 1) + ": ") === 0; });
  });
  if (다른머리.length) {
    문제.push("4행 머리글이 발주 탭과 다름 — " + 다른머리.slice(0, 6).join(" · ") +
      (다른머리.length > 6 ? " 외 " + (다른머리.length - 6) + "칸" : ""));
  }

  //  ② 요약 수식
  var 기대 = _pms_audit_expectedFormulas_(cMap, c);
  Object.keys(기대).forEach(function (k) {
    var rc = k.split(","), r = +rc[0], col = +rc[1];
    var 지금 = 위식[r - 1][col - 1];
    if (_pms_audit_normF_(지금) !== _pms_audit_normF_(기대[k])) {
      문제.push(_pms_audit_a1_(r, col) + " 수식이 " + (지금 ? "다름 — 지금 " + 지금 : "없음") + "  (기대 " + 기대[k] + ")");
    }
  });
  for (var r0 = 1; r0 <= 2; r0++) for (var c0 = 0; c0 < 10; c0++) {
    var g = String(위글[r0][c0] || "");
    if (g.charAt(0) === "#" && g.length > 1) 문제.push(_pms_audit_a1_(r0 + 1, c0 + 1) + " 오류값 " + g);
  }

  //  ③ ④ 데이터
  var lr = sh.getLastRow();
  var 줄수 = Math.max(0, lr - _PMS_DATA_START + 1);
  var 데이터 = 줄수 ? sh.getRange(_PMS_DATA_START, 1, 줄수, Math.min(extLc, sh.getMaxColumns())).getValues() : [];
  var 셈 = _pms_audit_recalc_(데이터, cMap, c);

  var 보인 = {
    "B2": 위값[1][1], "B3": 위값[2][1], "D2": 위값[1][3], "D3": 위값[2][3],
    "F2": 위값[1][5], "H2": 위값[1][7], "J2": 위값[1][9], "F3": 위값[2][5]
  };
  var 견줄 = { "B2": 셈.전체건, "B3": 셈.유효건 };
  if (cMap.price !== -1) {
    견줄["D2"] = 셈.전체금액; 견줄["D3"] = 셈.유효금액;
    견줄["F2"] = 셈.반품배송비; 견줄["H2"] = 셈.도서산간; 견줄["J2"] = 셈.기타정산; 견줄["F3"] = 셈.최종;
  }
  Object.keys(견줄).forEach(function (k) {
    var v = 보인[k];
    if (typeof v !== "number" || Math.abs(v - 견줄[k]) > _PMS_AMT_TOLERANCE) {
      문제.push(k + " 값이 데이터와 다름 — 시트 " + _pms_audit_fmt_(v) + " · 다시 셈 " + _pms_audit_fmt_(견줄[k]));
    }
  });
  셈.경고.forEach(function (w) { 문제.push(w); });

  //  ⑤ 체크박스 · 고정 · 보호
  if (줄수 && sh.getMaxColumns() >= c.ret) {
    var dv = sh.getRange(_PMS_DATA_START, c.cancel, 줄수, 2).getDataValidations();
    var CBX = SpreadsheetApp.DataValidationCriteria.CHECKBOX, 없음 = 0;
    for (var i = 0; i < dv.length; i++) {
      if (!dv[i][0] || dv[i][0].getCriteriaType() !== CBX || !dv[i][1] || dv[i][1].getCriteriaType() !== CBX) 없음++;
    }
    if (없음) 문제.push("취소·반품 칸에 체크박스가 없는 줄 " + 없음 + "줄");
  }
  if (sh.getFrozenRows() !== _PMS_HEADER_ROW) 문제.push("고정 행이 " + sh.getFrozenRows() + " (기대 " + _PMS_HEADER_ROW + ")");
  var 범위보호 = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var 시트보호 = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (시트보호.length) 문제.push("탭 전체가 보호되어 있음 — 데이터 칸을 못 고칠 수 있음");
  if (범위보호.length !== 1) 문제.push("머리글 보호가 " + 범위보호.length + "개 (기대 1개)");

  //  ⑥ 조건부 서식 겹침
  var 규칙 = sh.getConditionalFormatRules() || [];
  var 우리것 = 규칙.filter(_pms_isOurRowRule_).length;
  if (우리것 !== 2) {
    문제.push("취소·반품 줄 칠하기 규칙이 " + 우리것 + "개 (기대 2개)" +
      (우리것 > 2 ? " — 보정을 돌릴 때마다 쌓였던 것. 보정을 다시 돌리면 2개로 정리됨" : ""));
  }

  var 요약 = 셈.전체건 + "줄 · 유효 " + 셈.유효건 + "건";
  if (cMap.price !== -1) 요약 += " · 최종 " + _pms_audit_fmt_(셈.최종) + "원";
  return { 문제: 문제, 요약: 요약 };
}

/** 4행 머리글 견주기 — 다른 칸들을 「L: 지금→기대」 꼴로 */
function _pms_audit_headerDiff_(row, extHdr) {
  var out = [];
  for (var i = 0; i < extHdr.length; i++) {
    var a = String(row[i] == null ? "" : row[i]).trim();
    var b = String(extHdr[i] == null ? "" : extHdr[i]).trim();
    if (a !== b) out.push(_pms_audit_col_(i + 1) + ": 「" + a + "」→「" + b + "」");
  }
  for (var j = extHdr.length; j < row.length; j++) {
    if (String(row[j] == null ? "" : row[j]).trim()) out.push(_pms_audit_col_(j + 1) + ": 뒤에 남은 「" + row[j] + "」");
  }
  return out;
}

/** 보정 코드가 넣을 수식을 그대로 받아 적는다 — 기준을 따로 쓰지 않는다 */
function _pms_audit_expectedFormulas_(cMap, c) {
  var rec = {};
  function cell(r, col) {
    var o = {};
    ["setValue", "setNumberFormat", "setFontWeight", "setFontSize", "setFontColor", "setBackground", "setBorder"]
      .forEach(function (fn) { o[fn] = function () { return o; }; });
    o.setFormula = function (f) { rec[r + "," + col] = f; return o; };
    return o;
  }
  var 가짜 = { getRange: function (r, col) { return cell(r, col); } };
  _pms_applyFormulas_(가짜, cMap, c.cancel, c.ret, c.ship, c.island, c.etc);
  return rec;
}

/** 수식 견주기 — 띄어쓰기·대소문자는 뜻이 아니다 */
function _pms_audit_normF_(f) {
  return String(f || "").replace(/\s/g, "").toUpperCase();
}

/**
 * 순수 — 데이터로 요약을 다시 셈하고, 칸 밀림·글자 섞임을 찾는다.
 * 수식과 같은 뜻: 일자가 비거나 0 인 줄은 건수·금액에서 뺀다.
 */
function _pms_audit_recalc_(rows, cMap, c) {
  var o = { 전체건: 0, 유효건: 0, 전체금액: 0, 유효금액: 0, 반품배송비: 0, 도서산간: 0, 기타정산: 0, 최종: 0, 경고: [] };
  var 날짜아님 = 0, 날짜예 = "", 수량글 = 0, 금액글 = 0, 금액예 = "", 체크아님 = 0, 오류 = 0, 오류예 = "";
  var 오류꼴 = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|ERROR!|NUM!|NULL!)/;
  function 글자(v) {          //  숫자가 아닌 글자 (빈칸·숫자·불린·날짜는 아님)
    return !(v === "" || v == null || typeof v === "number" || typeof v === "boolean" || v instanceof Date);
  }
  function 수(v) { return typeof v === "number" ? v : 0; }
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    for (var k = 0; k < row.length; k++) {
      if (typeof row[k] === "string" && 오류꼴.test(row[k])) {
        오류++; if (!오류예) 오류예 = _pms_audit_a1_(i + _PMS_DATA_START, k + 1) + " " + row[k];
      }
    }
    o.반품배송비 += 수(row[c.ship - 1]);
    o.도서산간 += 수(row[c.island - 1]);
    o.기타정산 += 수(row[c.etc - 1]);

    var d = cMap.date !== -1 ? row[cMap.date] : row[0];
    var 있음 = d !== "" && d !== null && d !== undefined && (cMap.date === -1 || d !== 0);
    if (!있음) continue;
    if (cMap.date !== -1 && !(d instanceof Date) && !_pms_audit_dateLike_(d)) {
      날짜아님++; if (!날짜예) 날짜예 = (i + _PMS_DATA_START) + "행 「" + d + "」";
    }
    var 취소 = row[c.cancel - 1], 반품 = row[c.ret - 1];
    if ((취소 !== "" && typeof 취소 !== "boolean") || (반품 !== "" && typeof 반품 !== "boolean")) 체크아님++;
    var 유효 = 취소 !== true && 반품 !== true;
    o.전체건++;
    if (유효) o.유효건++;
    if (cMap.qty !== -1 && 글자(row[cMap.qty])) 수량글++;
    if (cMap.price !== -1) {
      var p = row[cMap.price];
      if (글자(p)) { 금액글++; if (!금액예) 금액예 = (i + _PMS_DATA_START) + "행 「" + p + "」"; }
      o.전체금액 += 수(p);
      if (유효) o.유효금액 += 수(p);
    }
  }
  o.최종 = o.유효금액 + o.반품배송비 + o.도서산간 + o.기타정산;

  if (날짜아님) o.경고.push("일자 칸에 날짜가 아닌 값 " + 날짜아님 + "줄 (예: " + 날짜예 + ") — 칸이 밀렸을 수 있음");
  if (수량글) o.경고.push("수량 칸에 글자 " + 수량글 + "줄");
  if (금액글) o.경고.push("금액 칸에 글자 " + 금액글 + "줄 (예: " + 금액예 + ") — 유효 정산금액이 0 으로 떨어질 수 있음");
  if (체크아님) o.경고.push("취소·반품 칸에 체크(참/거짓)가 아닌 값 " + 체크아님 + "줄");
  if (오류) o.경고.push("데이터에 오류값 " + 오류 + "칸 (예: " + 오류예 + ")");
  return o;
}

/** 날짜로 읽히나 — 8자리 숫자(20260901)·시리얼·「2026-09-01」 꼴 */
function _pms_audit_dateLike_(v) {
  if (typeof v === "number") return (v > 20000101 && v <= 21001231) || (v >= 38000 && v <= 62000);
  var 숫자 = String(v).replace(/[^0-9]/g, "");
  if (숫자.length < 6 || 숫자.length > 14) return false;
  return 숫자.length >= 8 ? 숫자.slice(0, 2) === "20" : true;
}

function _pms_audit_col_(n) {
  var s = "";
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function _pms_audit_a1_(r, col) { return _pms_audit_col_(col) + r; }
function _pms_audit_fmt_(v) {
  if (typeof v !== "number") return "「" + v + "」";
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
