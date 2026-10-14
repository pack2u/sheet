/*  ═══════════════════════════════════════════════════════════════
    거래명세표_거래처 — 명세서에서 읽은 사업자정보를 «빈 칸만» 채운다
    ───────────────────────────────────────────────────────────────
    2026-10-14

    > "V2정산에 들어가면 명세서 캡쳐해서 들어가있는 이미지가 있어
    >  거기서 업체별로 확인하면 업체 정보들이 다 있어"
    > "①로 진행해줘"

    v2 의 구글 서비스계정은 ★읽기 전용★ 이라 시트에 못 쓴다.
    그래서 읽은 값을 여기에 적어 두고, 쓰는 일은 GAS 가 한다.

    출처는 Supabase statement-src 에 쌓인 거래명세서 ★이미지★ 다.
    시트의 「거래처코드」 칸에 이미 들어 있던 등록번호 11건과
    대조해 11/11 일치를 확인했고, 손으로 채워 두신 세 곳
    (올팩코리아·준테크·코라마)의 대표자도 3/3 맞았다.

    ★ 비워 둔 칸은 «모른다»는 뜻이다 ★ — 추측으로 메우지 않는다.
      · 로엔그린 대표자 … 「김수창」계열로 보이나 받침이 법인도장에
        가려 확정 못 했다. 비운다.
      · 업태·종목이 없는 명세서 양식이 있다. 그 칸도 비운다.
    ═══════════════════════════════════════════════════════════════ */

var _PVI_VER_ = "거래처정보 2026-10-14";
var _PVI_NOTE_ = "명세서 판독 2026-10-14";

/*  칸 차례 — 거래명세표_거래처 머리글과 같다
    5 등록번호 · 6 대표자 · 7 사업장주소 · 8 업태 · 9 종목 · 10 담당자 · 11 수신메일 · 13 비고  */
var _PVI_COL_ = { 등록번호: 5, 대표자: 6, 주소: 7, 업태: 8, 종목: 9, 담당자: 10, 메일: 11, 비고: 13 };

var _PVI_DATA_ = [
  {
    이름: "태양", 등록번호: "430-86-00321", 대표자: "오병옥",
    주소: "경기도 양주시 은현면 화합로691번길 232-32",
    업태: "제조업 도소매", 종목: "플라스틱사출진공성형",
  },
  {
    /*  대표자는 비운다 — 도장에 가려 확정 못 했다  */
    이름: "로엔그린", 등록번호: "101-86-45056", 대표자: "",
    주소: "경기도 김포시 하성면 애기봉로 750 (원산리) 404-3",
    업태: "제조업,도소매,도매", 종목: "용기,포장지,기계,잡화류,무역",
    메일: "lohengrin7@naver.com",
  },
  {
    이름: "아주팩", 등록번호: "692-86-01646", 대표자: "문사업",
    주소: "경기도 화성시 장안면 매바위로366번길 33-2",
  },
  {
    /*  대표자 — 명세서 도장 아래 인쇄 글자와 이카운트 발신자가 같다  */
    이름: "인터웍스", 등록번호: "778-86-02139", 대표자: "정찬모",
    주소: "경기도 파주시 하우4길 16 (상지석동)",
    담당자: "정찬모",
  },
  {
    이름: "제이엠", 등록번호: "260-86-00474", 대표자: "장중렬",
    주소: "충청북도 진천군 이월면 월촌2길 64",
    업태: "제조업,도소매", 종목: "합성수지,건축자재",
  },
  {
    이름: "부원", 등록번호: "231-01-59489", 대표자: "김분례",
    주소: "경기도 포천시 소흘읍 응골길 9",
  },
  {
    이름: "부엉이커피", 등록번호: "129-39-54485", 대표자: "문종범",
    주소: "경기도 성남시 중원구 갈마치로 302 우림5차 B동 1803호",
    업태: "식품제조가공업", 종목: "커피",
  },
  {
    이름: "후아코리아", 등록번호: "497-86-03205", 대표자: "최규청",
    주소: "경기 고양시 덕양구 향동로 217, DMC데시앙 KA913호",
    업태: "제조,도소매,서비스", 종목: "종이박스,친환경포장재,디자인",
  },
  /*  아래 셋은 사장님이 이미 손으로 채워 두셨다.
      그래도 적어 둔다 — 「빈 칸만」이라 덮지 않고, 나중에 줄이 비면 채운다.  */
  {
    이름: "올팩코리아", 등록번호: "689-87-00032", 대표자: "박정숙",
    주소: "경기도 김포시 하성면 하성로 311",
    업태: "제조업", 종목: "포장재, 비닐류제품",
    메일: "allpack7@naver.com",
  },
  {
    이름: "코라마", 등록번호: "125-86-31688", 대표자: "박진호",
    주소: "경기도 화성시 주석로 962-15",
    업태: "도소매 제조업", 종목: "목제품, 일회용품",
  },
  {
    이름: "준테크", 등록번호: "243-86-01181", 대표자: "이윤일",
    주소: "경기도 김포시 통진읍 하성로357번길 192 사무동",
    업태: "합성수지", 종목: "제조업",
  },
];


/*  이름 씻기 — (주)·주식회사·띄어쓰기·점을 떼고 견준다  */
function _pvi_wash_(s) {
  return String(s == null ? "" : s)
    .replace(/\(주\)|㈜|주식회사|주\)/g, "")
    .replace(/[\s·.\-_(),]/g, "")
    .toLowerCase();
}

function _pvi_s_(x) { return String(x == null ? "" : x).trim(); }


/*  시트 줄을 이름으로 찾는다.
    ★ 똑 떨어지는 짝이 하나일 때만 ★ 손댄다 — 여럿이면 비켜선다.
    (「준테크」 ⊂ 「주식회사준테크피에스와이」 같은 경우를 위해 품기도 본다)  */
function _pvi_findRow_(키, 줄들) {
  var 꼭맞음 = [], 품음 = [];
  for (var i = 0; i < 줄들.length; i++) {
    var n = 줄들[i].씻은이름;
    if (!n) continue;
    if (n === 키) 꼭맞음.push(줄들[i]);
    else if (n.indexOf(키) >= 0 || 키.indexOf(n) >= 0) 품음.push(줄들[i]);
  }
  if (꼭맞음.length === 1) return { 줄: 꼭맞음[0] };
  if (꼭맞음.length > 1) return { 여럿: 꼭맞음 };
  if (품음.length === 1) return { 줄: 품음[0] };
  if (품음.length > 1) return { 여럿: 품음 };
  return {};
}


function _pvi_readRows_() {
  var hub = _pts_hub_();
  var tab = hub.getSheetByName(_PTS_TAB_VENDOR);
  if (!tab) {
    throw new Error("허브에 「" + _PTS_TAB_VENDOR + "」 탭이 없습니다.");
  }
  var last = tab.getLastRow();
  if (last < 2) return { tab: tab, 줄들: [] };
  var 폭 = Math.max(_PTS_VENDOR_HEADERS_.length, tab.getLastColumn());
  var vals = tab.getRange(2, 1, last - 1, 폭).getValues();
  var 줄들 = [];
  for (var i = 0; i < vals.length; i++) {
    var 이름 = _pvi_s_(vals[i][3]);
    if (!이름) continue;
    줄들.push({ row: i + 2, 이름: 이름, 씻은이름: _pvi_wash_(이름), 칸: vals[i] });
  }
  return { tab: tab, 줄들: 줄들 };
}


/*  ───────────────────────────────────────────────
    고갱이 — 정말=false 면 아무것도 안 바꾸고 둘러만 본다
    ─────────────────────────────────────────────── */
function _pvi_run_(정말) {
  var 읽음 = _pvi_readRows_();
  var tab = 읽음.tab, 줄들 = 읽음.줄들;

  var 적을것 = [], 못찾음 = [], 헷갈림 = [], 이미찬것 = [];

  for (var d = 0; d < _PVI_DATA_.length; d++) {
    var rec = _PVI_DATA_[d];
    var 찾음 = _pvi_findRow_(_pvi_wash_(rec.이름), 줄들);
    if (찾음.여럿) {
      헷갈림.push(rec.이름 + " → " + 찾음.여럿.map(function (x) { return x.이름; }).join(" / "));
      continue;
    }
    if (!찾음.줄) { 못찾음.push(rec.이름); continue; }
    var 줄 = 찾음.줄;

    var 짝 = [
      ["등록번호", rec.등록번호], ["대표자", rec.대표자], ["주소", rec.주소],
      ["업태", rec.업태], ["종목", rec.종목], ["담당자", rec.담당자], ["메일", rec.메일],
    ];
    var 이줄 = [], 그냥둠 = 0;
    for (var p = 0; p < 짝.length; p++) {
      var 칸이름 = 짝[p][0], 새값 = _pvi_s_(짝[p][1]);
      if (!새값) continue;                                  // 모르는 것은 안 적는다
      var col = _PVI_COL_[칸이름];
      var 지금 = _pvi_s_(줄.칸[col - 1]);
      if (지금) { 그냥둠++; continue; }                      // ★ 빈 칸만 ★
      이줄.push({ col: col, 칸이름: 칸이름, 값: 새값 });
    }
    if (!이줄.length) { 이미찬것.push(줄.이름 + " (" + 그냥둠 + "칸 이미 있음)"); continue; }
    적을것.push({ row: 줄.row, 이름: 줄.이름, 칸들: 이줄, 그냥둠: 그냥둠 });
  }

  if (정말) {
    for (var a = 0; a < 적을것.length; a++) {
      var t = 적을것[a];
      for (var b = 0; b < t.칸들.length; b++) {
        tab.getRange(t.row, t.칸들[b].col).setValue(t.칸들[b].값);
      }
      if (!_pvi_s_(줄들_비고_(줄들, t.row))) {
        tab.getRange(t.row, _PVI_COL_.비고).setValue(_PVI_NOTE_);
      }
    }
    SpreadsheetApp.flush();
  }

  return { 적을것: 적을것, 못찾음: 못찾음, 헷갈림: 헷갈림, 이미찬것: 이미찬것, tab: tab };
}

function 줄들_비고_(줄들, row) {
  for (var i = 0; i < 줄들.length; i++) {
    if (줄들[i].row === row) return 줄들[i].칸[_PVI_COL_.비고 - 1];
  }
  return "";
}


function _pvi_report_(r, 정말) {
  var 칸수 = 0;
  for (var i = 0; i < r.적을것.length; i++) 칸수 += r.적을것[i].칸들.length;

  var 글 = (정말 ? "✅ 채웠습니다" : "🧪 둘러만 봤습니다 — 아무것도 안 바꿨습니다") + "\n" +
    "거래처 " + r.적을것.length + "곳 · 칸 " + 칸수 + "개" + (정말 ? "" : " (채울 수 있음)") + "\n\n";

  for (var a = 0; a < r.적을것.length; a++) {
    var t = r.적을것[a];
    글 += "  " + t.row + "행 " + t.이름 + " — " +
      t.칸들.map(function (c) { return c.칸이름; }).join(" · ") +
      (t.그냥둠 ? "   (이미 있는 " + t.그냥둠 + "칸은 그대로)" : "") + "\n";
  }
  if (r.이미찬것.length) 글 += "\n이미 다 차 있어 손대지 않음:\n  " + r.이미찬것.join("\n  ") + "\n";
  if (r.못찾음.length) 글 += "\n시트에서 못 찾은 거래처: " + r.못찾음.join(", ") + "\n";
  if (r.헷갈림.length) 글 += "\n★ 짝이 여럿이라 비켜섰습니다 ★\n  " + r.헷갈림.join("\n  ") + "\n";

  글 += "\n비워 둔 칸은 «모른다»는 뜻입니다 — 로엔그린 대표자는\n" +
    "법인도장에 가려 확정하지 못해 비웠습니다.";
  return 글;
}


/*  ───────── 메뉴에서 부르는 둘 ───────── */

function partnerPreviewVendorInfoFromStatements() {
  var r = _pvi_run_(false);
  SpreadsheetApp.getUi().alert(
    "거래처 정보 — 어떻게 채워지나 · " + _PVI_VER_,
    _pvi_report_(r, false), SpreadsheetApp.getUi().ButtonSet.OK);
}

function partnerFillVendorInfoFromStatements() {
  var ui = SpreadsheetApp.getUi();
  var 미리 = _pvi_run_(false);
  var 칸수 = 0;
  for (var i = 0; i < 미리.적을것.length; i++) 칸수 += 미리.적을것[i].칸들.length;
  if (!칸수) {
    ui.alert("거래처 정보 채우기", "채울 빈 칸이 없습니다.\n\n" + _pvi_report_(미리, false), ui.ButtonSet.OK);
    return;
  }
  var 답 = ui.alert("거래처 정보 채우기 · " + _PVI_VER_,
    "거래처 " + 미리.적을것.length + "곳의 빈 칸 " + 칸수 + "개를 채웁니다.\n" +
    "이미 적혀 있는 값은 덮지 않습니다.\n\n채울까요?", ui.ButtonSet.YES_NO);
  if (답 !== ui.Button.YES) return;

  var r = _pvi_run_(true);
  try { _pts_hub_().setActiveSheet(r.tab); } catch (e) {}
  ui.alert("거래처 정보 채우기", _pvi_report_(r, true), ui.ButtonSet.OK);
}
