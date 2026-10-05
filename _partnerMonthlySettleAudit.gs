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
 *    ⑤ 4행 고정 · 머리글 보호 · 오류값(#REF! 등)
 *    ⑥ 옛 취소·반품 줄 칠하기 규칙이 남았나
 *  ★ 2026-10-05 마감탭에서 취소·반품 칸을 뺐다 — 옛 모양 탭은 «보정하라»고만 알린다
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

/**
 * 메뉴: 🔎 월별 마감 탭 점검 — 업체·월을 골라 읽기만 한다.  ★ 2026-10-05
 *  > "금액을 추가하면 최종 정산 금액이 수정되야 되는데 안되고 있어"
 *  글자로 들어간 금액·일자 없는 줄의 금액(합계에 안 들어가는 것)도 짚는다.
 */
function partnerAuditMonthlySettleTabs() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일 없음");
  var selected = _pms_pickVendors_(ui, files,
    "🔎 월별 마감 탭 점검 — 업체 선택",
    "수식·레이아웃·요약 값을 읽기만 해서 봅니다 (안 바꿈).\n업체 번호(쉼표로 여럿) · 이름 일부 · all");
  if (selected === null) return;
  if (!selected.length) return ui.alert("선택된 업체가 없습니다.");
  var mResp = ui.prompt("🔎 월별 마감 탭 점검 — 월", "볼 월을 입력하세요 (예: 2026-09 또는 9).", ui.ButtonSet.OK_CANCEL);
  if (mResp.getSelectedButton() !== ui.Button.OK) return;
  var 월 = _pms_parseMonthPick_(mResp.getResponseText());
  if (!월 || 월.err) return ui.alert((월 && 월.err) || "월을 넣어 주세요.");
  var y = 월.y !== null ? 월.y : new Date().getFullYear();

  var 글 = _pms_auditFiles_(selected, y, 월.m, []);
  if (글.length > 3800) 글 = 글.slice(0, 3800) + "\n… (나머지는 실행 로그에)";
  ui.alert(글);
}

function _pms_auditRun_(names, y, m) {
  var files = _pt_listFiles();
  var 앞말 = [];
  var 고른 = [], 본 = {};
  names.forEach(function (n) {
    var hit = files.filter(function (f) { return _pms_vendorLabel_(f).indexOf(n) !== -1; });
    if (!hit.length) { 앞말.push("  ❓ " + n + " — 협력업체 파일을 못 찾음"); return; }
    hit.forEach(function (f) { if (!본[f.id]) { 본[f.id] = 1; 고른.push(f); } });
  });
  _pms_auditFiles_(고른, y, m, 앞말);
  return "실행 로그를 보세요";
}

/** 고른 업체들 점검 — 로그에 남기고 글을 돌려준다 */
function _pms_auditFiles_(고른, y, m, 앞말) {
  var 시작 = Date.now();
  var 말 = ["■ 월별 마감 탭 점검 — (" + y + "년 " + m + "월) 발주 마감 · 읽기만 함", ""].concat(앞말 || []);
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
  var 글 = 말.join("\n");
  Logger.log(글);
  return 글;
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
  if (!L) return { 문제: ["4행에서 칸 배치를 못 읽었고 발주 탭도 없어 기준을 못 만듦"], 요약: "" };
  //  ★ 2026-10-05 옛 모양(취소·반품 칸)은 새 기준으로 견주지 않는다 — 보정이 바꾼다
  if (L.구형) {
    return { 문제: ["옛 모양(취소·반품 칸 있음) — 「월별 마감 탭 레이아웃 보정」을 돌리면 새 모양으로 바뀝니다 " +
      "(취소·반품 기록이 있는 탭은 그대로 둡니다)"], 요약: "" };
  }
  if (L.출처 === "발주") 문제.push("4행에서 칸 배치를 못 찾음 — 발주 탭 폭으로 짐작해 견줌");
  if (L.메움.length) 문제.push("4행 머리글이 깨짐 — " + L.메움.map(function (i) { return _pms_audit_col_(i + 1) + "4"; }).join(", ") + " (보정하면 발주 탭 이름으로 메움)");
  var cMap    = L.cMap;
  var extHdr  = L.extHdr;
  var extLc   = L.extLc;
  var c = { island: L.islandC, etc: L.etcC };

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
    문제.push("4행 머리글이 다름 — " + 다른머리.slice(0, 6).join(" · ") +
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

  //  새 요약 자리: B2 건수 · D2 정산금액 · F2 도서산간 · H2 기타정산 · B3 최종
  var 보인 = { "B2": 위값[1][1], "D2": 위값[1][3], "F2": 위값[1][5], "H2": 위값[1][7], "B3": 위값[2][1] };
  var 견줄 = { "B2": 셈.전체건, "F2": 셈.도서산간, "H2": 셈.기타정산, "B3": 셈.최종 };
  if (cMap.price !== -1) 견줄["D2"] = 셈.전체금액;
  Object.keys(견줄).forEach(function (k) {
    var v = 보인[k];
    if (typeof v !== "number" || Math.abs(v - 견줄[k]) > _PMS_AMT_TOLERANCE) {
      문제.push(k + " 값이 데이터와 다름 — 시트 " + _pms_audit_fmt_(v) + " · 다시 셈 " + _pms_audit_fmt_(견줄[k]));
    }
  });
  셈.경고.forEach(function (w) { 문제.push(w); });

  //  ⑤ 고정 · 보호
  if (sh.getFrozenRows() !== _PMS_HEADER_ROW) 문제.push("고정 행이 " + sh.getFrozenRows() + " (기대 " + _PMS_HEADER_ROW + ")");
  var 범위보호 = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var 시트보호 = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (시트보호.length) 문제.push("탭 전체가 보호되어 있음 — 데이터 칸을 못 고칠 수 있음");
  if (범위보호.length !== 1) 문제.push("머리글 보호가 " + 범위보호.length + "개 (기대 1개)");

  //  ⑥ 옛 취소·반품 줄 칠하기 규칙이 남았나 (새 모양에는 없다)
  var 우리것 = (sh.getConditionalFormatRules() || []).filter(_pms_isOurRowRule_).length;
  if (우리것) 문제.push("옛 취소·반품 줄 칠하기 규칙 " + 우리것 + "개가 남음 — 보정하면 걷힘");

  var 요약 = 셈.전체건 + "줄";
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

/** 보정 코드가 넣을 수식을 그대로 받아 적는다 — 빠른 보정과 같은 것을 쓴다 */
function _pms_audit_expectedFormulas_(cMap, c) {
  return _pms_expectedSummaryFormulas_(cMap, c.island, c.etc);
}

/** 수식 견주기 — 빠른 보정과 같은 것 */
function _pms_audit_normF_(f) {
  return _pms_normF_(f);
}

/**
 * 순수 — 데이터로 요약을 다시 셈하고, 칸 밀림·글자 섞임을 찾는다.
 * 수식과 같은 뜻: 일자가 비거나 0 인 줄은 건수·금액에서 뺀다.
 */
function _pms_audit_recalc_(rows, cMap, c) {
  //  ★ 2026-10-05 새 모양 — 취소·반품 없음. 최종 = 정산금액 + 도서산간(O) + 기타정산
  var o = { 전체건: 0, 전체금액: 0, 도서산간: 0, 기타정산: 0, 최종: 0, 경고: [] };
  var 날짜아님 = 0, 날짜예 = "", 수량글 = 0, 금액글 = 0, 금액예 = "", 오류 = 0, 오류예 = "";
  var 비용글 = {}, 무일자 = { 수: 0, 합: 0, 예: "" };
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
    o.도서산간 += 수(row[c.island - 1]);
    o.기타정산 += 수(row[c.etc - 1]);
    //  ★ 2026-10-05 «금액을 넣었는데 최종이 안 바뀐다» — 글자로 들어간 금액은 SUM 이 건너뛴다
    [["도서산간배송비", c.island], ["기타정산", c.etc]].forEach(function (fc) {
      var v = row[fc[1] - 1];
      if (글자(v)) {
        var 칸 = 비용글[fc[0]] || (비용글[fc[0]] = { 수: 0, 예: "" });
        칸.수++;
        if (!칸.예) 칸.예 = _pms_audit_a1_(i + _PMS_DATA_START, fc[1]) + " 「" + v + "」";
      }
    });

    var d = cMap.date !== -1 ? row[cMap.date] : row[0];
    var 있음 = d !== "" && d !== null && d !== undefined && (cMap.date === -1 || d !== 0);
    if (!있음) {
      //  일자 없는 줄의 정산금액은 요약 수식이 세지 않는다 (B5:B<>0)
      if (cMap.price !== -1) {
        var 빈금액 = row[cMap.price];
        if ((typeof 빈금액 === "number" && 빈금액 !== 0) || 글자(빈금액)) {
          무일자.수++; 무일자.합 += 수(빈금액);
          if (!무일자.예) 무일자.예 = (i + _PMS_DATA_START) + "행 「" + 빈금액 + "」";
        }
      }
      continue;
    }
    if (cMap.date !== -1 && !(d instanceof Date) && !_pms_audit_dateLike_(d)) {
      날짜아님++; if (!날짜예) 날짜예 = (i + _PMS_DATA_START) + "행 「" + d + "」";
    }
    o.전체건++;
    if (cMap.qty !== -1 && 글자(row[cMap.qty])) 수량글++;
    if (cMap.price !== -1) {
      var p = row[cMap.price];
      if (글자(p)) { 금액글++; if (!금액예) 금액예 = (i + _PMS_DATA_START) + "행 「" + p + "」"; }
      o.전체금액 += 수(p);
    }
  }
  o.최종 = o.전체금액 + o.도서산간 + o.기타정산;

  if (날짜아님) o.경고.push("일자 칸에 날짜가 아닌 값 " + 날짜아님 + "줄 (예: " + 날짜예 + ") — 칸이 밀렸을 수 있음");
  if (수량글) o.경고.push("수량 칸에 글자 " + 수량글 + "줄");
  if (금액글) o.경고.push("금액 칸에 글자 " + 금액글 + "줄 (예: " + 금액예 + ") — 정산금액 합계에 안 들어감");
  if (오류) o.경고.push("데이터에 오류값 " + 오류 + "칸 (예: " + 오류예 + ")");
  Object.keys(비용글).forEach(function (이름) {
    o.경고.push(이름 + " 칸에 글자로 된 금액 " + 비용글[이름].수 + "칸 (예: " + 비용글[이름].예 +
      ") — 합계·최종 정산금액에 안 들어감");
  });
  if (무일자.수) {
    o.경고.push("일자가 없는 줄의 정산금액 " + 무일자.수 + "줄 (예: " + 무일자.예 +
      ") — 요약 수식이 일자 있는 줄만 세서 최종 정산금액에 안 들어감");
  }
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
