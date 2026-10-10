/**
 * ══════════════════════════════════════════════════════════════
 *  로젠에게 «도서·산간이냐»를 물어 표에 외워 둔다
 *  파일: csLogenZoneCache.gs
 *
 *  > 사장님: "기존거는 죽여 놓고 API를 활용하는게 더 정확할꺼 같아" (2026-09)
 *  > 사장님: "㉮로 해줘" — API 는 «표가 놓친 섬»을 잡는 데만 쓴다 (2026-10-09)
 *
 *  ★ 왜 ★
 *    세트분리는 우편번호표와 도선료표로 섬을 가린다. 그런데 로젠은 **면·리 단위**로
 *    가른다 — 강화 읍내는 아니고 교동도·석모도는 맞는 식이다. 표로는 못 따라간다.
 *    `integratedInquiry` 가 주소를 받아 제주·연륙도서·산간을 바로 답한다.
 *
 *  ★ 세트분리가 직접 묻지 않는다 ★
 *    세트분리는 별도 프로젝트라 로젠 클라이언트를 «세 번째»로 두어야 한다.
 *    게다가 큰 회차는 1,500줄이라 다 물으면 10건씩 150번 — 6분 한도를 넘는다.
 *
 *    그래서 **여기(CS웹앱)가 묻고 표에 적고, 세트분리는 그 표를 읽기만** 한다.
 *    CS웹앱은 이미 세트분리 시트를 열고 있고 로젠 클라이언트·배치·시간예산도 있다.
 *    세트분리에서는 호출이 0 이 되어 회차가 느려지지 않는다.
 *
 *  ★ 지역키로 외운다 ★
 *    주소마다 묻는 것은 낭비다. 로젠이 가르는 단위가 「시도 시군구 읍면동(+리)」 이니
 *    거기까지를 열쇠로 삼는다. 실측(2026-10-09): 하루 새로 생기는 열쇠가 200~350개 —
 *    10건씩이면 20~35번 호출이다. 쓸수록 줄어든다.
 *
 *  ★ 열쇠 만드는 법이 «두 군데»에 있다 ★
 *    세트분리(core.js)도 같은 열쇠로 표를 찾아야 한다. 프로젝트가 달라 함수를 못
 *    부르니 두 벌이 된다. 한쪽만 고치면 표를 못 찾아 **조용히 아무 일도 안 일어난다.**
 *    그래서 _cszone_test.js 가 두 파일의 열쇠를 같은 주소로 맞대 본다.
 * ══════════════════════════════════════════════════════════════
 */

/** 외워 두는 탭 — 세트분리(뉴) 시트에 둔다. 거기서 세트분리가 읽는다 */
var _ZC_TAB_ = "도서산간_로젠";

/** 탭 머리글 — 세트분리 core.js 의 ssm_logenZoneRows 와 «같아야» 한다 */
var _ZC_HEADER_ = ["지역키", "판정", "제주", "연륙도서", "산간", "표본주소", "물은때"];

/** 한 번에 새로 물어볼 지역키 수. 하루 200~350개가 생기니 넉넉하다 */
var _ZC_MAX_ = 120;

/** 원장에서 뒤에서 몇 줄까지 훑나 */
var _ZC_SCAN_ROWS_ = 4000;

/**
 * 아직 안 물어본 지역키를 로젠에 묻고 표에 적는다.
 * csReturnHourlyJob 이 부른다.
 *
 * @param {Object} opt { max, dry }
 * @return {string} 할 일이 없으면 빈 글
 */
function csLogenZoneLearn(opt) {
  opt = opt || {};
  var 한도 = opt.max > 0 ? opt.max : _ZC_MAX_;

  var ss, tab;
  try {
    ss = SpreadsheetApp.openById(_CS_LEDGER_SS_ID_);
    tab = _zc_tab_(ss);
  } catch (e) { var m = "NG 표를 못 열었습니다: " + e.message; Logger.log(m); return m; }

  var 있는것 = _zc_existingKeys_(tab);

  var 후보;
  try { 후보 = _zc_candidates_(ss, 있는것, 한도); }
  catch (e) { var m2 = "NG 원장을 못 읽었습니다: " + e.message; Logger.log(m2); return m2; }

  if (!후보.length) {
    _zc_note_("새로 물을 지역이 없습니다 (외운 것 " + Object.keys(있는것).length + "곳)");
    return "";
  }

  if (opt.dry) {
    var 끝0 = "── 도서·산간 외우기 (연습) ──\n새 지역 " + 후보.length + "곳\n" +
      후보.slice(0, 10).map(function (x) { return "  " + x.key; }).join("\n");
    Logger.log(끝0); return 끝0;
  }

  var 답 = _zc_askMany_(후보);

  var 새줄 = [], 못물음 = 0;
  var 때 = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  for (var i = 0; i < 후보.length; i++) {
    var a = 답[후보[i].addr];
    if (!a) { 못물음++; continue; }
    새줄.push([후보[i].key, a.판정, a.제주, a.연륙도서, a.산간, 후보[i].addr, 때]);
  }

  /*  ★ 「물을 게 없었다」와 「물었는데 못 받았다」를 가른다 ★  (2026-10-10)
      여태 _운영점검 에는 「새로 외움 0곳 · 모두 514곳」만 적혔다. 그래서 두 가지가
      똑같이 보였다 —
        ① 표가 차서 물을 게 없다 (좋다)
        ② 120곳을 묻고 하나도 못 받았다 (나쁘다. 33초를 버리고 있다)
      실제는 ②였는데 한 달이 가도 알 길이 없었다. 지금 상태:
      후보가 매번 한도(120)에 꽉 차고, 새로 외우는 것은 0 이다.
      [[dont-overwrite-what-you-couldnt-read]] 와 같은 이야기 — 모르는 것과
      없는 것은 다르다. 「조용한 것은 괜찮다가 아니다.」                     */
  var 버림 = 후보.length - 새줄.length;

  if (새줄.length) {
    tab.getRange(tab.getLastRow() + 1, 1, 새줄.length, _ZC_HEADER_.length).setValues(새줄);
  }

  var 섬 = 0;
  for (var k = 0; k < 새줄.length; k++) if (새줄[k][1] !== "일반") 섬++;

  var 글 = "── 도서·산간 외우기 ──\n새로 외움 " + 새줄.length + "곳" +
    (섬 ? " (그중 도서·산간 " + 섬 + "곳)" : "") +
    (못물음 ? " · 못 물음 " + 못물음 : "");
  Logger.log(글);
  _zc_note_("새로 외움 " + 새줄.length + "곳" + (섬 ? " · 도서산간 " + 섬 : "") +
            " · 모두 " + (Object.keys(있는것).length + 새줄.length) + "곳" +
            //  ★ 버린 것을 숨기지 않는다 ★ 0 이면 안 적는다 (평소가 그렇다)
            (버림 ? " · ★ 물었는데 못 받음 " + 버림 + "/" + 후보.length : "") +
            (후보.length >= 한도 ? " · 후보 한도(" + 한도 + ")까지 찼다" : ""));
  return 글;
}

/**
 * ★ 지역키 ★ 로젠이 가르는 단위까지만 남긴다 — 「시도 시군구 읍면동(+리)」.
 *
 * 세트분리 core.js 의 ssLogenZoneKey 와 «글자 하나까지» 같아야 한다.
 * 다르면 표를 못 찾아 조용히 아무 일도 안 일어난다. _cszone_test.js 가 맞대 본다.
 */
function csLogenZoneKey(addr) {
  var t = String(addr == null ? "" : addr).trim().replace(/\s+/g, " ").split(" ");
  if (t.length < 3) return t.join(" ");
  var k = t[0] + " " + t[1] + " " + t[2];
  //  로젠은 «리» 단위로도 가른다 — 교동도·석모도처럼 같은 면 안에서 갈린다
  if (t[3] && /리$/.test(t[3])) k += " " + t[3];
  return k;
}

/** 표 — 없으면 머리글까지 만들어 준다 */
function _zc_tab_(ss) {
  var tab = ss.getSheetByName(_ZC_TAB_);
  if (tab) return tab;
  tab = ss.insertSheet(_ZC_TAB_);
  tab.getRange(1, 1, 1, _ZC_HEADER_.length).setValues([_ZC_HEADER_]);
  tab.getRange("1:1").setBackground("#1f4e78").setFontColor("white").setFontWeight("bold");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 220);
  tab.setColumnWidth(6, 320);
  try { ss.setActiveSheet(tab); ss.moveActiveSheet(ss.getNumSheets()); } catch (e) {}
  return tab;
}

/** 이미 외운 지역키 */
function _zc_existingKeys_(tab) {
  var out = {};
  var last = tab.getLastRow();
  if (last < 2) return out;
  var 값 = tab.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < 값.length; i++) {
    var k = String(값[i][0] || "").trim();
    if (k) out[k] = true;
  }
  return out;
}

/**
 * 원장에서 «아직 안 외운» 지역키를 모은다.
 * 지역키마다 주소 하나만 표본으로 쓴다 — 로젠에는 주소로 물어야 한다.
 */
function _zc_candidates_(ss, 있는것, 한도) {
  var tab = ss.getSheetByName("주문라인원장");
  if (!tab) throw new Error("「주문라인원장」 탭이 없습니다");

  var lastRow = tab.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = tab.getLastColumn();

  var head = tab.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var addrCol = -1;
  for (var h = 0; h < head.length; h++) {
    if (String(head[h] || "").trim() === "주소1") { addrCol = h; break; }
  }
  if (addrCol < 0) throw new Error("「주소1」 열을 못 찾았습니다");

  var from = Math.max(2, lastRow - _ZC_SCAN_ROWS_ + 1);
  var 값 = tab.getRange(from, addrCol + 1, lastRow - from + 1, 1).getDisplayValues();

  var 봤다 = {}, out = [];
  for (var i = 값.length - 1; i >= 0; i--) {     // 최근 것부터
    var addr = String(값[i][0] || "").trim();
    if (!addr) continue;
    var key = csLogenZoneKey(addr);
    if (!key || 봤다[key] || 있는것[key]) continue;
    봤다[key] = true;
    out.push({ key: key, addr: addr });
    if (out.length >= 한도) break;
  }
  return out;
}

/**
 * 로젠에 주소로 묻는다 — integratedInquiry (규격 §6.2).
 * 10건씩, 호출 사이를 쉬며. 그 규칙은 csLogen.gs 의 상수를 쓴다.
 *
 * @return {Object} 주소 → {판정, 제주, 연륙도서, 산간}
 */
function _zc_askMany_(items) {
  var out = {};
  var 시작 = new Date().getTime();

  for (var s = 0; s < items.length; s += _LOGEN_BATCH_SIZE_) {
    if (s > 0) {
      if ((new Date().getTime() - 시작) > _LOGEN_TIME_BUDGET_MS_) break;  // 남은 건 다음 시간에
      Utilities.sleep(_LOGEN_BATCH_DELAY_MS_);
    }
    var chunk = items.slice(s, s + _LOGEN_BATCH_SIZE_);
    var data = [];
    for (var i = 0; i < chunk.length; i++) {
      data.push({ custCd: _logen_custCd_(), addr: chunk[i].addr });
    }

    var r = _logen_call_("integratedInquiry", { userId: _logen_userId_(), data: data });
    if (!r.ok) continue;                       // 못 물었다 — 다음 시간에 또 본다

    var rows = _logen_arr_(r.json && (r.json.data || r.json.data1));
    for (var k = 0; k < rows.length; k++) {
      var d = rows[k] || {};
      /*  ★ 이 API 는 성공값이 SUCCESS 다 ★ 규격서 2장 — API 마다 다르다.
          _logen_ok_ 가 TRUE·SUCCESS 를 둘 다 참으로 본다. */
      if (d.resultCd != null && String(d.resultCd) !== "" && !_logen_ok_(d.resultCd)) continue;

      /*  ★ 응답에 «보낸 주소»가 안 실려 온다 ★
          그래서 보낸 차례로 맞춘다. 2026-10-09 실측에서 차례가 지켜졌지만
          규격이 보장하는 바가 아니다 — 한 번 어긋나면 **엉뚱한 지역을 섬으로
          외운다.** 틀린 판정은 빈칸보다 나쁘다.

          그래서 돌려준 dongNm(동·면 이름)이 보낸 주소 안에 있는지 확인한다.
          안 맞으면 그 건은 버린다 — 지어내지 않는다. 다음 시간에 또 묻는다. */
      var 보낸 = chunk[k];
      if (!보낸) continue;
      var dong = String(d.dongNm == null ? "" : d.dongNm).trim();
      if (dong && 보낸.addr.indexOf(dong) === -1) continue;   // 차례가 어긋났다
      var Y = function (v) { return String(v == null ? "" : v).trim().toUpperCase() === "Y" ? "Y" : "N"; };
      var 제주 = Y(d.jejuRegYn), 도서 = Y(d.shipYn), 산간 = Y(d.montYn);
      out[보낸.addr] = {
        판정: 제주 === "Y" ? "제주" : (도서 === "Y" ? "연륙도서" : (산간 === "Y" ? "산간" : "일반")),
        제주: 제주, 연륙도서: 도서, 산간: 산간
      };
    }
  }
  return out;
}

/** 운영점검 탭에 한 줄 — 할 일이 없을 때도 남긴다 */
function _zc_note_(글) {
  try {
    _cpr_ops_(SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_), "도서·산간 외우기", 글);
  } catch (e) {}
}

/** 손으로 돌려 보는 용 — 무엇을 물을지만 보고 묻지는 않는다 */
function csLogenZoneLearnPreview() {
  return csLogenZoneLearn({ dry: true });
}
