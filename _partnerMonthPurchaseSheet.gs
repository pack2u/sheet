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
 *    하루치 파일(_ecountPurchaseDaily.gs)이 매일 17시 30분에 생기고,
 *    _partnerVendorPurchaseExport.gs 는 「업체 × 하루」로 탭을 갈라 둔다 —
 *    탭 하나가 한 번의 붙여넣기 단위라는 생각이다. 그래서 한 달치를 넣으려면
 *    파일을 서른 번 오가야 했다. 한 시트로 모아 낸다.
 *
 *    ★ 짚어 둘 것 ★  이카운트가 한 번에 받는 단위가 정말 「업체 하루치」라면
 *      이 시트를 통째로 넣을 수는 없다. 그때도 헛일은 아니다 —
 *      일자·업체 차례로 정렬해 두었으므로 위에서부터 묶음대로 잘라 넣으면 되고,
 *      「요약」 탭의 입력완료 칸으로 어디까지 넣었는지 짚을 수 있다.
 *
 *  ★ 근거는 «하루치 파일» 이다 — 변환 탭을 다시 돌리지 않는다 ★
 *
 *    > "구매입력 시트를 보면 단가가 다 나와있어"
 *
 *    변환기는 변환하는 «그 시점의» 상품정보 W열(매입가)을 읽는다. 그래서 지난
 *    달을 지금 다시 변환하면 그 사이 바뀐 단가가 들어간다 — 2026-10-02 에
 *    부원 단가가 내려갔으므로(_bwNewPurchaseW.gs) 9월분을 다시 변환하면
 *    9월에 실제로 산 값이 아닌 숫자가 박힌다. 조용히 틀리는 쪽이다.
 *
 *    하루치 파일은 «그날» 만들어졌으니 그날 단가가 박혀 있다. 그것을 모은다.
 *    옛 달을 낼 때도 안전하고, 변환 탭이 다른 달로 덮여 있어도 된다.
 *    (하루치 파일이 하나도 없는 달은 변환 탭으로 떨어진다 — 그때는 그렇게 말한다.)
 *
 *  ★ 「쉬는 날」과 「빠진 날」을 가른다 ★
 *
 *    > "토일은 없고.. 추석 연휴 23~27일까지는 없어"
 *
 *    달의 모든 날을 훑어 파일이 없으면 「빠졌다」고 하면, 9월에 토·일 여덟 날과
 *    추석이 한꺼번에 뜬다. 열네 날이 빨갛게 뜨는 알림은 아무도 안 읽는다 —
 *    그러면 정말 빠진 하루도 같이 묻힌다. 시끄러운 알림은 없는 알림이다.
 *
 *    날을 셋으로 가른다
 *      쉬는 날    토·일·공휴일        — 세지 않는다 (_pt_isNonBusinessDate_)
 *      거래 없음  파일은 있고 행이 0  — 그날 매입이 없었다는 «기록»이다
 *      빠진 날    파일이 아예 없다    — 하루치가 안 돌았다. 이것만 알린다
 *
 *    자체 휴무일(9/23 처럼 공휴일은 아닌데 쉰 날)은 Script Property
 *    _PT_EXTRA_HOLIDAYS_ 에 yyyyMMdd 를 쉼표로 넣으면 같이 빠진다 —
 *    이미 모든 자동 트리거가 보는 자리라 새 체계를 만들지 않는다.
 *  ★ 순번은 «업체 × 일자»마다 1 부터 ★
 *    하루치 파일의 순번은 그 하루 기준이고, 변환 탭 순번은 월 전체 기준이다.
 *    전표 한 장은 「그 업체의 그날」이므로 묶음마다 1 부터 다시 매긴다 —
 *    그래야 한 시트로 넣어도 낱장으로 넣은 것과 같은 모양이 된다.
 *
 *  ★ 조용히 버리지 않는다 ★
 *    변환이 실패한 행(AA열 변환상태)과 코드가 빈 행을 그대로 올리면 이카운트에
 *    쓰레기가 들어간다. 그렇다고 빼 버리면 「왜 금액이 모자라나」가 된다.
 *    그래서 「확인 필요」 탭으로 옮기고, 읽은 수 = 올린 수 + 확인 수 를 센다.
 *
 *  ★ 원본을 건드리지 않는다 ★  하루치 파일·변환 탭에서 읽기만 한다.
 * ══════════════════════════════════════════════════════════════
 */

var _PMS_PREFIX_ = "구매입력_";

/** [메뉴] 한 달 전체 구매입력을 한 시트로 */
function partnerBuildMonthPurchaseSheet() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { return "UI 없음"; }

  var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var folder = _epd_purchaseFolder_(hub);

  /* ── 하루치 파일이 어느 달에 몇 개 있나 ──────────────────
      파일 «이름»만 본다. 내용을 열지 않으니 달을 고르기 전에 비용이 거의 없다. */
  /*  ★ 폴더는 한 번만 훑는다 ★  (2026-10-04)
      전에는 달 목록을 만들 때 한 번, 모을 때 또 한 번 훑었다. 「구매입력」
      폴더에는 하루치가 몇 달치 쌓여 있어 그 한 번이 공짜가 아니다. */
  var 하루치 = _pms_하루치파일_(folder);     // "2026-09-22" → 파일 id
  var 날들 = Object.keys(하루치).map(function (k) { return k.split("-").join(""); }).sort();
  var 달별 = {}, 달차례 = [];
  for (var i = 0; i < 날들.length; i++) {
    var ym = 날들[i].slice(0, 4) + "-" + 날들[i].slice(4, 6);
    if (!달별[ym]) { 달별[ym] = 0; 달차례.push(ym); }
    달별[ym]++;
  }
  달차례.sort();

  var 안내 = [];
  var 많은달 = "", 많은수 = -1;
  for (var m = 0; m < 달차례.length; m++) {
    안내.push("  " + 달차례[m] + "  하루치 " + 달별[달차례[m]] + "개");
    if (달별[달차례[m]] >= 많은수) { 많은수 = 달별[달차례[m]]; 많은달 = 달차례[m]; }
  }
  if (!안내.length) 안내.push("  (하루치 파일이 없습니다 — 변환 탭을 씁니다)");

  var rs = ui.prompt(
    "한 달 전체 구매입력 (한 시트)",
    "어느 달을 낼까요?  예) 2026-09\n\n" +
    "「구매입력」 폴더의 하루치 파일:\n" + 안내.join("\n") +
    "\n\n비워 두면 " + (많은달 || "(없음)") + " 로 합니다." +
    "\n\n※ 하루치 파일에는 «그날 단가»가 박혀 있습니다.\n" +
    "   변환을 다시 돌리지 않으므로 지난 달도 그때 값으로 나옵니다.",
    ui.ButtonSet.OK_CANCEL
  );
  if (rs.getSelectedButton() !== ui.Button.OK) return "취소";
  var 고른달 = String(rs.getResponseText() || "").trim() || 많은달;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(고른달)) {
    ui.alert("달을 못 읽었습니다", "2026-09 꼴로 적어 주세요.", ui.ButtonSet.OK);
    return "달 모양 오류";
  }

  /* ── 모은다 ─────────────────────────────────────────────── */
  var 모음 = 달별[고른달]
    ? _pms_하루치에서모으기_(하루치, 고른달)
    : _pms_변환탭에서모으기_(hub, 고른달);

  if (모음.왜) {
    ui.alert("못 만들었습니다", 모음.왜, ui.ButtonSet.OK);
    return 모음.왜;
  }

  var 올릴것 = [], 확인할것 = [];
  for (var r = 0; r < 모음.줄들.length; r++) {
    var 한줄 = 모음.줄들[r];
    var 왜 = _pms_왜못올리나_(한줄.값, 한줄.상태);
    if (왜) 확인할것.push([왜, 한줄.어디].concat(한줄.값));
    else 올릴것.push(한줄.값);
  }
  var 읽은수 = 올릴것.length + 확인할것.length;
  if (!읽은수) {
    ui.alert("없음", 고른달 + " 행을 못 찾았습니다.", ui.ButtonSet.OK);
    return "0행";
  }
  if (!올릴것.length) {
    ui.alert("올릴 것이 없습니다",
      고른달 + " 의 " + 확인할것.length + "행이 모두 확인 대상입니다.\n" +
      "「확인 필요」 탭의 사유를 보세요.", ui.ButtonSet.OK);
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
        오도록 변환기가 매겨 둔 차례다. 숫자로 견준다(글자로 하면 10 이 2 앞). */
    return _pve_num_(a[1]) - _pve_num_(b[1]);
  });

  /*  ★ 순번을 묶음마다 1 부터 ★  (머리말 참고) */
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
  본탭.getRange(2, 14, 올릴것.length, 6).setNumberFormat("#,##0");
  본탭.setFrozenRows(1);
  본탭.setColumnWidth(4, 200);
  본탭.setColumnWidth(12, 260);

  /* ── ② 요약 — 어디까지 넣었나 짚어 가며 쓴다 ── */
  var 합 = _pms_요약_(ss, 올릴것, 모음);

  /* ── ③ 확인 필요 — 빼놓지 않았다는 것을 보이는 자리 ── */
  if (확인할것.length) {
    var 확인탭 = ss.insertSheet("확인 필요");
    _pms_머리글_(확인탭, ["왜", "어디서"].concat(_EPX_HEADERS_));
    확인탭.getRange(2, 1, 확인할것.length, 확인할것[0].length).setValues(확인할것);
    확인탭.setFrozenRows(1);
    try { 확인탭.autoResizeColumns(1, 2); } catch (eA) {}
  }

  /*  ★ 세어 본다 ★  읽은 수 = 올린 수 + 확인 수. 어긋나면 어디서 흘렸다는 뜻이다.
      금액이 걸린 일이라 「아마 맞을 것」으로 두지 않는다. */
  var 셈맞나 = (올릴것.length + 확인할것.length) === 읽은수;

  var 줄바꿈 = String.fromCharCode(10);
  var 말 = 고른달 + " 구매입력 — 한 시트\n\n" +
    "근거: " + 모음.근거 + "\n" +
    //  쉬는 날은 세지 않는다. 「거래 없음」과 「파일 없음」은 뜻이 다르다.
    (모음.쉰날
      ? "쉬는 날 " + 모음.쉰날 + "일은 셈에서 뺐습니다 (토·일·공휴일)" + 줄바꿈
      : "") +
    (모음.거래없음.length
      ? "거래 없는 날 " + 모음.거래없음.length + "일 — " +
        모음.거래없음.slice(0, 8).join(", ") +
        (모음.거래없음.length > 8 ? " …" : "") + 줄바꿈
      : "") +
    (모음.빠진날.length
      ? "★ 하루치 파일이 «아예 없는» 날 " + 모음.빠진날.length + "일 — " +
        모음.빠진날.slice(0, 10).join(", ") +
        (모음.빠진날.length > 10 ? " …" : "") + 줄바꿈 +
        "   그날이 영업일이었다면 매입이 빠진 것입니다." + 줄바꿈 +
        "   자체 휴무일이면 _PT_EXTRA_HOLIDAYS_ 속성에 넣어 주세요." + 줄바꿈
      : "") +
    "\n올릴 행 " + 올릴것.length + "행 · 전표 묶음 " + 묶음수 + "개(업체×일자)\n" +
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
//  근거 모으기
// ───────────────────────────────────────────────────────────

/**
 * 「구매입력」 폴더의 하루치 파일 — "2026-09-22" → 파일 id.
 *
 * 이름만 본다. 파일을 열지 않는다 — 달을 고르기 전에 서른 개를 여는 것은
 * 6분 한도를 그냥 버리는 일이다.
 * 내가 내는 파일(구매입력_2026-09_전체)은 괄호가 없어 안 걸린다.
 * 같은 날이 둘이면 뒤엣것만 남는다 — 둘 다 세면 금액이 두 배가 된다.
 */
function _pms_하루치파일_(folder) {
  var out = {};
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    /*  ★ 정규식을 쓰지 않는다 ★  (2026-10-04)
        처음엔 /^구매입력_((d{4}-d{2}-d{2}))$/ 로 썼는데 역슬래시가 빠져
        「d{4}」 라는 «글자»를 찾고 있었다. 그래서 하루치를 하나도 못 찾고
        변환 탭으로 떨어져 「그 달로 변환을 먼저 돌리세요」가 떴다.
        글자 자르기로 바꾸고, 날짜인지는 이미 있는 가름(_pms_ymd8_)에 맡긴다 —
        한 군데서만 날짜를 가르면 이런 일이 한 번만 난다.  */
    var 이름 = String(f.getName());
    var 머리 = _PMS_PREFIX_ + "(";
    if (이름.indexOf(머리) !== 0) continue;
    if (이름.charAt(이름.length - 1) !== ")") continue;
    var 안 = 이름.slice(머리.length, 이름.length - 1);
    var d8 = _pms_ymd8_(안);
    if (!d8) continue;                       //  날짜가 아니면 넘긴다
    //  열쇠는 늘 같은 모양으로 — 「2026-9-2」처럼 적힌 파일도 한자리에 모인다
    out[d8.slice(0, 4) + "-" + d8.slice(4, 6) + "-" + d8.slice(6, 8)] = f.getId();
  }
  return out;
}

/**
 * 하루치 파일들을 모은다 — 그날 단가가 박힌 것이다.
 *
 *  ★ 왜 Sheets API 를 직접 부르나 ★  (2026-10-04)
 *
 *    > "시간이 너무 오래걸린다"
 *
 *    처음에는 날마다 SpreadsheetApp.openById 로 열어 읽었다. 한 달이면 서른
 *    번이고, 그 한 번이 «문서 모델을 통째로 세우는» 일이라 몇 초씩 걸린다.
 *    서른 번을 차례로 하면 1~2분, 재수 없으면 6분 한도에 걸린다.
 *    6분에 걸리면 아무것도 안 나온다 — 느린 것보다 나쁘다.
 *
 *    값만 필요하므로 문서 모델이 필요 없다. values.get 한 번이면 된다.
 *    게다가 UrlFetchApp.fetchAll 은 여러 요청을 «한꺼번에» 보낸다 —
 *    서른 번을 차례로 기다리는 대신 한 번 기다린다.
 *    쓰는 열쇠는 그 스크립트의 것(ScriptApp.getOAuthToken)이라 새 비밀이 없고,
 *    appsscript.json 에 spreadsheets · script.external_request 가 이미 있다.
 *
 *    ★ 실패한 파일은 옛 길로 한 번 더 본다 ★  탭 이름이 다르거나 권한이
 *      걸린 파일이 있을 수 있다. 그 하나 때문에 한 달이 비면 안 된다.
 *
 * @return {{줄들:Array, 근거:string, 빠진날:string[], 거래없음:string[], 쉰날:number, 왜:string}}
 */
function _pms_하루치에서모으기_(하루치, 고른달) {
  var 줄들 = [], 본날 = [], 행있던날 = [];
  var 끝일 = _pms_달끝일_(고른달);

  //  그 달 것만 골라 날짜 차례로
  var 일차례 = [];
  for (var 키 in 하루치) {
    if (!Object.prototype.hasOwnProperty.call(하루치, 키)) continue;
    if (키.slice(0, 7) !== 고른달) continue;
    일차례.push(키);
  }
  일차례.sort();

  var 받은것 = _pms_값읽기한꺼번에_(일차례, 하루치);

  for (var i = 0; i < 일차례.length; i++) {
    var 그날 = 일차례[i];
    var dd = 그날.slice(8, 10);
    본날.push(dd);
    var 값 = 받은것[그날];
    if (값 === null) {
      //  한꺼번에 읽기가 안 된 파일 — 옛 길로 한 번 더 본다
      값 = _pms_값읽기한개_(하루치[그날]);
    }
    if (!값 || !값.length) continue;      //  머리글만 있는 날 (거래 없음)
    var 앞수 = 줄들.length;
    _pms_값담기_(값, 줄들, 그날, 고른달);
    if (줄들.length > 앞수) 행있던날.push(dd);
  }

  /*  날을 셋으로 가른다 (머리말 참고). 쉬는 날은 세지 않는다 —
      시끄러운 알림은 정말 빠진 하루까지 묻는다. */
  var 빠진날 = [], 거래없음 = [], 쉰날 = 0;
  for (var d = 1; d <= 끝일; d++) {
    var dd2 = ("0" + d).slice(-2);
    var 날 = 고른달 + "-" + dd2;
    if (_pms_쉬는날_(날)) { 쉰날++; continue; }
    if (본날.indexOf(dd2) === -1) 빠진날.push(날);
    else if (행있던날.indexOf(dd2) === -1) 거래없음.push(날);
  }

  return {
    줄들: 줄들,
    근거: "하루치 파일 " + 일차례.length + "개 (그날 단가 그대로)",
    빠진날: 빠진날,
    거래없음: 거래없음,
    쉰날: 쉰날,
    왜: 줄들.length ? "" :
      고른달 + " 하루치 파일에 행이 없습니다." + String.fromCharCode(10) +
      "「📤 당일 구매입력 시트 만들기」 가 그 달에 돌았는지 보세요.",
  };
}

/** 읽을 칸 — A2 부터 AA(변환상태) 까지. 한 번에 받아 두고 잘라 쓴다 */
var _PMS_RANGE_ = "A2:AA";

/**
 * 여러 파일의 값을 «한꺼번에» 받는다.  "2026-09-22" → 줄 배열 (못 받으면 null)
 *
 * fetchAll 은 한 번에 보내는 수가 많으면 오히려 느려지고 쿼터에 걸린다.
 * 서른씩 끊어 보낸다 — 한 달이면 한두 번에 끝난다.
 */
function _pms_값읽기한꺼번에_(일차례, 하루치) {
  var out = {};
  var 열쇠;
  try {
    열쇠 = ScriptApp.getOAuthToken();
  } catch (eT) {
    Logger.log("[PMS] 토큰 못 받음 — 옛 길로 갑니다: " + eT.message);
    for (var z = 0; z < 일차례.length; z++) out[일차례[z]] = null;
    return out;
  }

  var 칸 = encodeURIComponent("'" + _EPX_OUT_TAB_ + "'!" + _PMS_RANGE_);
  for (var s = 0; s < 일차례.length; s += 30) {
    var 묶음 = 일차례.slice(s, s + 30);
    var 요청 = [];
    for (var k = 0; k < 묶음.length; k++) {
      요청.push({
        url: "https://sheets.googleapis.com/v4/spreadsheets/" + 하루치[묶음[k]] +
             "/values/" + 칸 + "?valueRenderOption=FORMATTED_VALUE",
        headers: { Authorization: "Bearer " + 열쇠 },
        muteHttpExceptions: true,   //  한 파일이 막혀도 나머지를 받는다
      });
    }
    var 답 = [];
    try {
      답 = UrlFetchApp.fetchAll(요청);
    } catch (eF) {
      Logger.log("[PMS] fetchAll 실패 — 그 묶음은 옛 길로: " + eF.message);
      for (var m0 = 0; m0 < 묶음.length; m0++) out[묶음[m0]] = null;
      continue;
    }
    for (var r = 0; r < 묶음.length; r++) {
      var 한답 = 답[r];
      if (!한답 || 한답.getResponseCode() !== 200) {
        Logger.log("[PMS] " + 묶음[r] + " 응답 " +
          (한답 ? 한답.getResponseCode() : "없음") + " — 옛 길로");
        out[묶음[r]] = null;
        continue;
      }
      try {
        var 몸 = JSON.parse(한답.getContentText());
        out[묶음[r]] = 몸.values || [];      //  머리글만 있으면 values 가 없다
      } catch (eJ) {
        out[묶음[r]] = null;
      }
    }
  }
  return out;
}

/** 한 파일만 옛 길로 읽는다 — 한꺼번에 읽기가 안 된 것을 건지는 자리 */
function _pms_값읽기한개_(id) {
  try {
    var ss = SpreadsheetApp.openById(id);
    var tab = ss.getSheetByName(_EPX_OUT_TAB_) || ss.getSheets()[0];
    if (!tab || tab.getLastRow() < 2) return [];
    return tab.getRange(2, 1, tab.getLastRow() - 1, _EPX_DIAG_START_COL_)
      .getDisplayValues();
  } catch (e) {
    Logger.log("[PMS] 한 개 읽기도 실패: " + e.message);
    return [];
  }
}

/**
 * 받은 값을 담는다. A~Y 가 업로드 칸이고 AA 가 변환상태다.
 *
 * ★ 짧은 줄이 온다 ★  Sheets API 는 오른쪽 빈 칸을 잘라서 준다. 그래서
 *   줄 길이가 제각각이다 — 그대로 쓰면 값[18](금액)이 undefined 가 되어
 *   금액 0 으로 읽힌다. 스물다섯 칸으로 채워 놓고 쓴다.
 */
function _pms_값담기_(값, 모을곳, 어디, 고른달) {
  for (var r = 0; r < 값.length; r++) {
    var 한줄 = 값[r] || [];
    //  빈 줄 건너뛰기 — 하루치 파일은 지웠다 쓴 자리가 남는다
    if (!String(한줄[0] || "").trim() && !String(한줄[10] || "").trim()) continue;
    if (_pms_ym_(한줄[0]) !== 고른달) continue;
    var 상태 = String(한줄[_EPX_DIAG_START_COL_ - 1] || "");   // AA
    var 값줄 = 한줄.slice(0, _EPX_HEADERS_.length);
    while (값줄.length < _EPX_HEADERS_.length) 값줄.push("");
    모을곳.push({ 값: 값줄, 상태: 상태, 어디: 어디 });
  }
}

/**
 * 하루치 파일이 없는 달 — 변환 탭으로 떨어진다.
 *
 * ★ 이 길은 단가가 «오늘» 값일 수 있다 ★  변환기는 변환하는 그 시점의
 *   상품정보 W열을 읽는다. 그래서 알려 주고 쓴다.
 */
function _pms_변환탭에서모으기_(hub, 고른달) {
  var src = hub.getSheetByName(_EPX_OUT_TAB_);
  if (!src || src.getLastRow() < 2) {
    return {
      줄들: [], 근거: "", 빠진날: [], 거래없음: [], 쉰날: 0,
      왜: "하루치 파일도 없고 「" + _EPX_OUT_TAB_ + "」 탭도 비어 있습니다.\n" +
          "「🧾 전용마감 → 구매입력 변환」 을 먼저 돌리세요.",
    };
  }
  var 줄들 = [];
  _pms_탭에서담기_(src, 줄들, _EPX_OUT_TAB_ + " 탭", 고른달);
  return {
    줄들: 줄들,
    근거: "변환 탭 (★ 단가는 변환한 시점의 값입니다)",
    빠진날: [], 거래없음: [], 쉰날: 0,
    왜: 줄들.length ? "" :
      고른달 + " 행이 「" + _EPX_OUT_TAB_ + "」 탭에 없습니다.\n" +
      "그 달로 변환을 먼저 돌리세요.",
  };
}

/** 탭 하나에서 그 달 행만 담는다. 변환상태(AA)도 같이 들고 온다. */
function _pms_탭에서담기_(tab, 모을곳, 어디, 고른달) {
  var 끝줄 = tab.getLastRow();
  if (끝줄 < 2) return;
  var 값 = tab.getRange(2, 1, 끝줄 - 1, _EPX_HEADERS_.length).getDisplayValues();
  /*  진단열(AA~)은 업로드 대상 A:Y 밖에 있다. 탭이 좁아 아예 없을 수도 있으니
      실패해도 넘어간다 — 변환상태를 못 읽으면 「빈칸」으로 보고 그냥 올린다. */
  var 상태 = [];
  try {
    상태 = tab.getRange(2, _EPX_DIAG_START_COL_, 끝줄 - 1, 1).getDisplayValues();
  } catch (eD) {
    Logger.log("[PMS] " + 어디 + " 진단열 못 읽음: " + eD.message);
  }
  for (var r = 0; r < 값.length; r++) {
    //  빈 줄 건너뛰기 — 하루치 파일은 지웠다 쓴 자리가 남는다
    if (!String(값[r][0] || "").trim() && !String(값[r][10] || "").trim()) continue;
    if (_pms_ym_(값[r][0]) !== 고른달) continue;
    모을곳.push({ 값: 값[r], 상태: 상태[r] ? 상태[r][0] : "", 어디: 어디 });
  }
}

// ───────────────────────────────────────────────────────────
//  날짜 · 판정
// ───────────────────────────────────────────────────────────

/**
 * 일자 칸 → 「yyyymmdd」 여덟 자리. 못 읽으면 "".
 *
 * ★ 숫자만 뽑아 자르면 안 된다 ★  (2026-10-04 시험이 잡았다)
 *   「2026/9/30」 처럼 한 자리 달이면 숫자만 뽑아 4·2·2 로 자르는 순간 달이
 *   「93」 이 되어 통째로 못 읽는다. 그 행은 「일자를 못 읽음」으로 확인 탭에
 *   가고, 사람은 멀쩡한 줄이 왜 빠졌나 보게 된다.
 *
 *   변환기는 yyyyMMdd 로 적고 A열을 텍스트로 잠근다. 그래서 평소엔 여덟
 *   자리가 온다. 그래도 서식은 풀린다 — 이 묶음의 코드가 그 걱정을 여러 군데
 *   적어 두었다. 서식이 풀린 날짜 칸은 한국 로케일에서 「2026. 9. 30」으로
 *   보인다. 가름을 느슨하게 두면 그날 금액이 조용히 빠진다.
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
 * 그 날이 쉬는 날인가 — 토·일 · 공휴일 · 임시공휴일.
 *
 * ★ 표를 새로 만들지 않는다 ★  허브에 이미 _pt_isNonBusinessDate_ 가 있고
 *   (_partnerHelpers.gs) 그것이 공휴일표와 _PT_EXTRA_HOLIDAYS_ 속성을 본다.
 *   같은 프로젝트이므로 그냥 부른다. 표가 두 벌이 되면 한 벌만 고쳐지고,
 *   그러면 어느 쪽이 맞는지 아무도 모른다.
 *
 *   그 함수가 없을 때(파일이 빠졌을 때)는 토·일만 보고 넘어간다 —
 *   공휴일을 못 가려 「빠진 날」로 뜨는 쪽이, 아예 멈추는 쪽보다 낫다.
 */
function _pms_쉬는날_(그날) {
  if (typeof _pt_isNonBusinessDate_ === "function") {
    try { return !!_pt_isNonBusinessDate_(그날); } catch (e) { /* 아래로 */ }
  }
  var s = String(그날 || "").replace(/[^0-9]/g, "");
  if (s.length !== 8) return false;
  var dow = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1,
                     Number(s.slice(6, 8))).getDay();
  return dow === 0 || dow === 6;
}

/** "2026-09" 의 마지막 날 (30·31·28·29) */
function _pms_달끝일_(ym) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return 31;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

/**
 * 이 행을 그대로 올려도 되나. 올려도 되면 "" 를 돌려준다.
 *
 * ★ 변환상태는 합격/불합격이 아니다 ★  (2026-10-04 — 이것 때문에 한 번 망쳤다)
 *
 *   처음에 「OK·정상·빈칸이 아니면 막는다」로 썼다. 그런데 그 칸은 «어디서 온
 *   값인가»를 적는 자리다. 하루치 파일의 일반 품목행은 거의 다
 *   「임시기록 D열」 이다 — 그래서 품목행이 통째로 「확인 필요」로 빠지고
 *   택배비 집계행만 남은 시트가 나왔다. 사장님이 「품목명이 다 똑같은데?」로
 *   잡아 주셨다. 조용히 빠진 것이 아니라 «눈에 보이게» 틀려서 다행이었다.
 *
 *   실제로 쓰이는 값들 (_ecountPurchaseDaily.gs:219~272 ·
 *    _ecountPurchaseFromExclusive.gs:1082~1136)
 *     정상  ""  ·  OK  ·  임시기록 D열  ·  꼬리제거  ·  우리품목명
 *           우리품목명·꼬리제거  ·  중복해소(상품정보 실재)  ·  중복해소(대리발송)
 *     집계  집계-택배비                        ← 멀쩡한 매입 줄이다
 *     실패  ⚠ 로 시작하는 모든 것
 *           ⚠ 상품정보 미등록 · ⚠ W열 매입가 0/공란 · ⚠ 업체접두 미등록
 *           ⚠ 매핑 중복 · ⚠ HUB 누적품목매핑 미등록
 *
 *   ★ 그래서 «실패 표시»만 막는다 ★  아는 실패만 막고 모르는 것은 통과시킨다.
 *   거꾸로 하면(아는 성공만 통과) 낱말이 하나 늘 때마다 멀쩡한 줄이 빠지고,
 *   그걸 알아채는 길은 사람이 시트를 보고 「이상하다」 하는 것뿐이다.
 *   ⚠ 는 변환기가 스스로 쓰는 표시라 낱말이 늘어도 바뀌지 않는다.
 *
 *   빠뜨려도 뒤에 그물이 둘 더 있다 — 품목코드 없음 · 금액 0.
 */
function _pms_왜못올리나_(줄, 변환상태) {
  var st = String(변환상태 || "").trim();
  //  변환기가 스스로 붙이는 실패 표시. 이것만 막는다.
  if (st.indexOf("⚠") !== -1) return "변환상태: " + st;
  if (!_pms_ym_(줄[0])) return "일자를 못 읽음";
  if (!String(줄[2] || "").trim()) return "거래처코드 없음";
  if (!String(줄[10] || "").trim()) return "품목코드 없음";
  //  금액이 0 이면 넣을 것이 없다. 0원 매입을 전표로 만들면 나중에 못 찾는다.
  if (_pve_num_(줄[18]) === 0) {
    return st.indexOf("집계") === 0 ? "집계행인데 금액 0" : "금액 0";
  }
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
function _pms_요약_(ss, 올릴것, 모음) {
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
  탭.getRange(2, 4, 줄들.length, 4).setNumberFormat("#,##0");
  탭.getRange(줄들.length + 1, 1, 1, 머리.length)
    .setFontWeight("bold").setBackground("#f1f3f4");
  탭.setFrozenRows(1);

  /*  근거와 빠진 날을 시트에도 적는다 — 창을 닫으면 사라지는 말이라
      나중에 이 파일만 보는 사람은 무엇으로 만든 것인지 모른다. */
  var 적을것 = [["근거", 모음.근거]];
  if (모음.쉰날) {
    적을것.push(["쉬는 날", 모음.쉰날 + "일 (토·일·공휴일) — 셈에서 뺐습니다"]);
  }
  if (모음.거래없음 && 모음.거래없음.length) {
    //  파일은 있고 행이 0 — 「그날 매입이 없었다」는 기록이다. 빠진 것이 아니다.
    적을것.push(["거래 없는 날", 모음.거래없음.join(", ")]);
  }
  if (모음.빠진날.length) {
    적을것.push(["★ 하루치 파일이 없는 날", 모음.빠진날.join(", ")]);
    적을것.push(["", "영업일이었다면 그날 매입이 이 시트에 없습니다."]);
  }
  탭.getRange(줄들.length + 3, 1, 적을것.length, 2).setValues(적을것);
  탭.getRange(줄들.length + 3, 1, 적을것.length, 1).setFontWeight("bold");

  try { 탭.autoResizeColumns(1, 머리.length); } catch (e) {}
  return 합;
}
