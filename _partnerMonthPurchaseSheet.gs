/**
 * ══════════════════════════════════════════════════════════════
 *  [구매입력] 한 달 전체를 «한 시트»로
 *  파일: _partnerMonthPurchaseSheet.gs
 *  2026-10-04
 *
 *  > "구매입력을 9월 전체 구매입력으로 하나의 시트로 만들어줘
 *  >  한번에 입력 할수 있게"
 *
 *  ★ 여태 갈라 두던 까닭 ★
 *    _partnerVendorPurchaseExport.gs 는 「업체 × 하루」로 탭을 갈라 둔다 —
 *    탭 하나가 한 번의 붙여넣기 단위라는 생각이다. 그래서 한 달치를 넣으려면
 *    탭을 수십 번 오가야 한다. 사장님이 한 번에 넣겠다고 하시니 한 시트로 낸다.
 *
 *    ★ 짚어 둘 것 ★  이카운트가 한 번에 받는 단위가 정말 「업체 하루치」라면
 *      이 시트를 통째로 넣을 수는 없다. 그때도 버리는 일은 아니다 —
 *      일자·업체 차례로 정렬해 두었으므로 위에서부터 묶음대로 잘라 넣으면 되고,
 *      「요약」 탭의 입력완료 칸으로 어디까지 넣었는지 짚을 수 있다.
 *
 *  ★ 순번은 «업체 × 일자»마다 1 부터 ★
 *    변환 탭의 순번은 월 전체 기준이다. 전표 한 장은 「그 업체의 그날」이므로,
 *    묶음마다 1 부터 다시 매긴다 — 업체별 내보내기가 날짜 탭에서 하는 것과
 *    같은 셈이다. 그래서 한 시트로 넣어도 낱장으로 넣은 것과 같은 모양이 된다.
 *
 *  ★ 조용히 버리지 않는다 ★
 *    변환이 실패한 행(AA열 변환상태)과 품목코드가 빈 행은 그대로 올리면
 *    이카운트에 쓰레기가 들어간다. 그렇다고 빼 버리면 「왜 금액이 모자라나」가
 *    된다. 그래서 「확인 필요」 탭으로 옮기고, 읽은 수 = 올린 수 + 확인 수 가
 *    맞는지 세어 알려 준다.
 *
 *  ★ 원본을 건드리지 않는다 ★
 *    변환 탭에서 읽기만 한다.
 *
 *  쓰는 순서
 *    ① 「🧾 전용마감 → 구매입력 변환」 으로 그 달을 먼저 변환한다
 *    ② 이 기능을 돌려 달을 고른다 (탭에 든 달을 먼저 보여 준다)
 *    ③ 「구매입력」 폴더에 생긴 파일의 「구매입력」 탭을 A2 부터 복사해 넣는다
 * ══════════════════════════════════════════════════════════════
 */

var _PMS_PREFIX_ = "구매입력_";

/** [메뉴] 한 달 전체 구매입력을 한 시트로 */
function partnerBuildMonthPurchaseSheet() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { return "UI 없음"; }

  var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var src = hub.getSheetByName(_EPX_OUT_TAB_);
  if (!src || src.getLastRow() < 2) {
    ui.alert("먼저 변환하세요",
      "「" + _EPX_OUT_TAB_ + "」 탭이 비어 있습니다.\n" +
      "「🧾 전용마감 → 구매입력 변환」 을 먼저 돌리세요.", ui.ButtonSet.OK);
    return "빈 탭";
  }

  var 끝줄 = src.getLastRow();
  var 본문 = src.getRange(2, 1, 끝줄 - 1, _EPX_HEADERS_.length).getDisplayValues();
  /*  진단열(AA~)은 업로드 대상 A:Y 밖에 있다. 변환상태를 보려면 따로 읽는다.
      탭이 좁아 진단열이 아예 없을 수도 있으니 실패해도 넘어간다. */
  var 상태 = [];
  try {
    상태 = src.getRange(2, _EPX_DIAG_START_COL_, 끝줄 - 1, 1).getDisplayValues();
  } catch (eD) {
    Logger.log("[PMS] 진단열 못 읽음: " + eD.message);
  }

  /* ── 어느 달이 들어 있나 ── 짐작하지 않고 보여 준다 ───────── */
  var 달별 = {}, 달차례 = [];
  for (var i = 0; i < 본문.length; i++) {
    var ym = _pms_ym_(본문[i][0]);
    if (!ym) ym = "날짜없음";
    if (!달별[ym]) { 달별[ym] = 0; 달차례.push(ym); }
    달별[ym]++;
  }
  달차례.sort();
  var 안내 = [];
  var 많은달 = "", 많은수 = -1;
  for (var m = 0; m < 달차례.length; m++) {
    안내.push("  " + 달차례[m] + "  " + 달별[달차례[m]] + "행");
    if (달차례[m] !== "날짜없음" && 달별[달차례[m]] > 많은수) {
      많은수 = 달별[달차례[m]];
      많은달 = 달차례[m];
    }
  }

  var rs = ui.prompt(
    "한 달 전체 구매입력 (한 시트)",
    "어느 달을 낼까요?  예) 2026-09\n\n" +
    "「" + _EPX_OUT_TAB_ + "」 탭에 든 달:\n" + 안내.join("\n") +
    "\n\n비워 두면 " + (많은달 || "(없음)") + " 로 합니다.",
    ui.ButtonSet.OK_CANCEL
  );
  if (rs.getSelectedButton() !== ui.Button.OK) return "취소";
  var 고른달 = String(rs.getResponseText() || "").trim() || 많은달;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(고른달)) {
    ui.alert("달을 못 읽었습니다", "2026-09 꼴로 적어 주세요.", ui.ButtonSet.OK);
    return "달 모양 오류";
  }
  if (!달별[고른달]) {
    ui.alert("그 달이 없습니다",
      고른달 + " 행이 이 탭에 없습니다.\n" +
      "「🧾 전용마감 → 구매입력 변환」 을 그 달로 먼저 돌리세요.\n\n" +
      "지금 든 달:\n" + 안내.join("\n"), ui.ButtonSet.OK);
    return "그 달 없음";
  }

  /* ── 고른 달만 갈라낸다 ─────────────────────────────────── */
  var 올릴것 = [], 확인할것 = [];
  for (var r = 0; r < 본문.length; r++) {
    if (_pms_ym_(본문[r][0]) !== 고른달) continue;
    var 줄 = 본문[r];
    var 왜 = _pms_왜못올리나_(줄, 상태[r] ? 상태[r][0] : "");
    if (왜) 확인할것.push([왜].concat(줄));
    else 올릴것.push(줄);
  }
  var 읽은수 = 올릴것.length + 확인할것.length;
  if (!읽은수) {
    ui.alert("없음", 고른달 + " 행을 못 찾았습니다.", ui.ButtonSet.OK);
    return "0행";
  }
  if (!올릴것.length) {
    ui.alert("올릴 것이 없습니다",
      고른달 + " 의 " + 확인할것.length + "행이 모두 확인 대상입니다.\n" +
      "변환 상태를 먼저 보세요.", ui.ButtonSet.OK);
    return "올릴 것 없음";
  }

  /* ── 일자 → 업체 차례로 세운다 ──────────────────────────────
      이카운트 전표 한 장은 「그 업체의 그날」이다. 그 묶음이 흩어져 있으면
      한 시트로 넣든 잘라 넣든 사람이 다시 모아야 한다. */
  올릴것.sort(function (a, b) {
    var da = _pms_숫자날짜_(a[0]), db = _pms_숫자날짜_(b[0]);
    if (da !== db) return da < db ? -1 : 1;
    var na = _pve_norm_(a[3]), nb = _pve_norm_(b[3]);
    if (na !== nb) return na < nb ? -1 : 1;
    /*  같은 묶음 안에서는 원래 순번을 지킨다 — 택배비 집계행이 묶음 끝에
        오도록 변환기가 매겨 둔 차례다. 숫자로 견준다(글자로 하면 10 이 2 앞에 온다). */
    return _pve_num_(a[1]) - _pve_num_(b[1]);
  });

  /*  ★ 순번을 묶음마다 1 부터 ★  (위 머리말 참고)
      변환 탭 순번은 월 전체 기준이라, 전표마다 1 부터가 아니면 이카운트에서
      헷갈린다. 묶음이 바뀌는 자리를 세어 다시 매긴다. */
  var 묶음수 = 0, 앞묶음 = null, 번호 = 0;
  for (var k = 0; k < 올릴것.length; k++) {
    var 열쇠 = _pms_숫자날짜_(올릴것[k][0]) + "|" + _pve_norm_(올릴것[k][3]);
    if (열쇠 !== 앞묶음) { 앞묶음 = 열쇠; 번호 = 0; 묶음수++; }
    올릴것[k] = 올릴것[k].slice();
    올릴것[k][1] = ++번호;
  }

  /* ── 파일을 만든다 ─────────────────────────────────────── */
  var 파일이름 = _PMS_PREFIX_ + 고른달 + "_전체";
  var ss = _pve_getOrCreate_(hub, 파일이름);

  //  기존 탭을 지우기 전에 새 탭을 하나 만들어 둔다 — 시트가 0개가 되면 안 된다
  var 남길것 = ss.insertSheet("_tmp_" + Date.now());
  var 옛탭 = ss.getSheets();
  for (var s = 0; s < 옛탭.length; s++) {
    if (옛탭[s].getSheetId() !== 남길것.getSheetId()) ss.deleteSheet(옛탭[s]);
  }

  /* ── ① 구매입력 — 이것 하나를 통째로 넣는다 ── */
  var 본탭 = 남길것;
  본탭.setName("구매입력");
  _pms_머리글_(본탭, _EPX_HEADERS_);
  //  앞자리 0 이 사는 열은 값 넣기 전에 텍스트로 잠근다 (A·C·K·W)
  try {
    for (var t = 0; t < _EPX_TEXT_COLS_.length; t++) {
      본탭.getRange(2, _EPX_TEXT_COLS_[t], 올릴것.length, 1).setNumberFormat("@");
    }
    SpreadsheetApp.flush();   // 서식은 미뤄졌다가 try 밖에서 터진다
  } catch (eFmt) {
    Logger.log("[PMS] 텍스트 서식 실패: " + eFmt.message);
  }
  본탭.getRange(2, 1, 올릴것.length, _EPX_HEADERS_.length).setValues(올릴것);
  본탭.setFrozenRows(1);

  /* ── ② 요약 — 어디까지 넣었나 짚어 가며 쓴다 ── */
  var 합 = _pms_요약_(ss, 올릴것);

  /* ── ③ 확인 필요 — 빼놓지 않았다는 것을 보이는 자리 ── */
  if (확인할것.length) {
    var 확인탭 = ss.insertSheet("확인 필요");
    _pms_머리글_(확인탭, ["왜"].concat(_EPX_HEADERS_));
    확인탭.getRange(2, 1, 확인할것.length, 확인할것[0].length).setValues(확인할것);
    확인탭.setFrozenRows(1);
    try { 확인탭.autoResizeColumn(1); } catch (eA) {}
  }

  /*  ★ 세어 본다 ★  읽은 수 = 올린 수 + 확인 수. 어긋나면 어디서 흘렸다는 뜻이다.
      금액이 걸린 일이라 「아마 맞을 것」으로 두지 않는다. */
  var 셈맞나 = (올릴것.length + 확인할것.length) === 읽은수;

  var 말 = 고른달 + " 구매입력 — 한 시트\n\n" +
    "올릴 행 " + 올릴것.length + "행 · 전표 묶음 " + 묶음수 + "개(업체×일자)\n" +
    "금액 합계 " + Math.round(합.금액).toLocaleString() + "원\n" +
    "  공급가액 " + Math.round(합.공급).toLocaleString() +
    " · 부가세 " + Math.round(합.부가세).toLocaleString() + "\n" +
    (확인할것.length
      ? "\n★ 확인 필요 " + 확인할것.length + "행 — 「확인 필요」 탭에 두었습니다\n" +
        "   (올리지 않았습니다. 버린 것도 아닙니다)\n"
      : "\n모두 올릴 수 있는 행입니다.\n") +
    (셈맞나 ? "" : "\n★ 셈이 안 맞습니다 — 관리자에게 알려 주세요\n") +
    "\n파일: " + 파일이름 + "\n「구매입력」 폴더에 있습니다.\n\n" +
    "「구매입력」 탭을 A2 부터 통째로 복사해 넣으세요.\n" +
    "한 번에 안 받으면 일자·업체 차례로 정렬돼 있으니 위에서부터\n" +
    "묶음대로 잘라 넣고, 「요약」 탭 입력완료 칸에 표시하세요.";
  ui.alert("만들었습니다", 말, ui.ButtonSet.OK);
  Logger.log("[PMS] " + 말);
  return ss.getUrl();
}

// ───────────────────────────────────────────────────────────

/**
 * 일자 칸 → 「yyyymmdd」 여덟 자리. 못 읽으면 "".
 *
 * ★ 숫자만 뽑아 자르면 안 된다 ★  (2026-10-04 시험이 잡았다)
 *   「2026/9/30」 처럼 한 자리 달이면 숫자만 뽑아 4·2·2 로 자르는 순간
 *   달이 「93」 이 되어 통째로 못 읽는다. 그 행은 「일자를 못 읽음」으로
 *   확인 탭에 가고, 사람은 멀쩡한 줄이 왜 빠졌나 보게 된다.
 *
 *   변환기는 yyyyMMdd 로 적고 A열을 텍스트로 잠근다. 그래서 평소엔 여덟
 *   자리가 온다. 그래도 서식은 풀린다 — 이 파일도 그 걱정을 적어 두었다.
 *   서식이 풀린 날짜 칸은 한국 로케일에서 「2026. 9. 30」 으로 보인다.
 *   가름을 느슨하게 두면 그날 금액이 조용히 빠진다.
 */
function _pms_ymd8_(v) {
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  //  여덟 자리 그대로 (변환기가 쓰는 모양)
  var m8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) return _pms_맞나_(m8[1], m8[2], m8[3]);
  //  해-달-일을 «따로» 집는다 — 구분 기호가 무엇이든, 한 자리든 두 자리든
  var ms = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/);
  if (ms) return _pms_맞나_(ms[1], ms[2], ms[3]);
  return "";
}

/** 해·달·일이 말이 되나 보고 여덟 자리로 — 아니면 "" */
function _pms_맞나_(y, m, d) {
  var Y = Number(y), M = Number(m), D = Number(d);
  if (!(Y >= 2000 && Y <= 2099)) return "";
  if (!(M >= 1 && M <= 12)) return "";
  if (!(D >= 1 && D <= 31)) return "";
  return y + ("0" + M).slice(-2) + ("0" + D).slice(-2);
}

/** 일자 칸 → "2026-09" · 못 읽으면 "" */
function _pms_ym_(v) {
  var d = _pms_ymd8_(v);
  return d ? d.slice(0, 4) + "-" + d.slice(4, 6) : "";
}

/** 정렬용 여덟 자리 — 못 읽으면 맨 뒤로 보낸다 (버리지는 않는다) */
function _pms_숫자날짜_(v) {
  return _pms_ymd8_(v) || "99999999";
}

/**
 * 이 행을 그대로 올려도 되나. 올려도 되면 "" 를 돌려준다.
 *
 * ★ 택배비 집계행은 멀쩡한 행이다 ★  품목코드 LGTB00001 로 변환기가 끼워 넣은
 *   줄이다. 수량·단가가 비어 보여도 금액이 있으면 매입이다 — 빼면 안 된다.
 */
function _pms_왜못올리나_(줄, 변환상태) {
  var st = String(변환상태 || "").trim();
  //  변환기가 사유를 남긴 행 — 「OK」·빈칸이 아니면 사람이 봐야 한다
  if (st && !/^(ok|정상|변환완료)$/i.test(st)) return "변환상태: " + st;
  if (!_pms_ym_(줄[0])) return "일자를 못 읽음";
  if (!String(줄[2] || "").trim()) return "거래처코드 없음";
  if (!String(줄[10] || "").trim()) return "품목코드 없음";
  //  금액이 0 이면 넣을 것이 없다. 0원 매입을 전표로 만들면 나중에 못 찾는다.
  if (_pve_num_(줄[18]) === 0) return "금액 0";
  return "";
}

/** 머리글 한 줄 — 색은 업체별 내보내기와 같게 둔다 */
function _pms_머리글_(탭, 머리) {
  탭.getRange(1, 1, 1, 머리.length).setValues([머리])
    .setBackground("#1f4e78").setFontColor("#ffffff")
    .setFontWeight("bold").setHorizontalAlignment("center");
}

/**
 * 요약 탭 — 「업체 × 일자」 묶음마다 한 줄.
 *
 * ★ 입력완료 칸을 둔다 ★  한 번에 안 들어가는 날이 있다. 그때 어디까지
 *   넣었는지 적을 자리가 없으면 처음부터 다시 세게 된다 — 두 번 넣는 사고가
 *   거기서 난다. 업체별 내보내기 요약 탭과 같은 생각이다.
 */
function _pms_요약_(ss, 올릴것) {
  var 묶음 = {}, 차례 = [];
  var 합 = { 수량: 0, 공급: 0, 부가세: 0, 금액: 0 };
  for (var i = 0; i < 올릴것.length; i++) {
    var 줄 = 올릴것[i];
    var 일 = _pve_dash_(_pms_숫자날짜_(줄[0]));
    var 업체 = String(줄[3] || "").trim() || "(업체명 없음)";
    var 열쇠 = 일 + "|" + 업체;
    if (!묶음[열쇠]) {
      묶음[열쇠] = { 일: 일, 업체: 업체, 행: 0, 수량: 0, 공급: 0, 부가세: 0, 금액: 0 };
      차례.push(열쇠);
    }
    var g = 묶음[열쇠];
    g.행++;
    g.수량 += _pve_num_(줄[13]);
    g.공급 += _pve_num_(줄[16]);
    g.부가세 += _pve_num_(줄[17]);
    g.금액 += _pve_num_(줄[18]);
    합.수량 += _pve_num_(줄[13]);
    합.공급 += _pve_num_(줄[16]);
    합.부가세 += _pve_num_(줄[17]);
    합.금액 += _pve_num_(줄[18]);
  }

  var 줄들 = [];
  for (var k = 0; k < 차례.length; k++) {
    var v = 묶음[차례[k]];
    줄들.push([v.일, v.업체, v.행, v.수량, v.공급, v.부가세, v.금액, ""]);
  }
  줄들.push(["합계", "", 올릴것.length, 합.수량, 합.공급, 합.부가세, 합.금액, ""]);

  var 탭 = ss.insertSheet("요약");
  var 머리 = ["일자", "업체", "행수", "수량", "공급가액", "부가세", "금액", "입력완료"];
  _pms_머리글_(탭, 머리);
  탭.getRange(2, 1, 줄들.length, 머리.length).setValues(줄들);
  탭.getRange(줄들.length + 1, 1, 1, 머리.length)
    .setFontWeight("bold").setBackground("#f1f3f4");
  탭.setFrozenRows(1);
  try { 탭.autoResizeColumns(1, 머리.length); } catch (e) {}
  return 합;
}
