/**
 * ══════════════════════════════════════════════════════════════
 *  [협력업체] 명세서 — 업체 판별 (본문 기준 + 발신처 학습)
 *  파일: _partnerStatementVendorId.gs
 *  2026-09-07
 *
 *  ★ 왜 본문으로 가리나 ★
 *    Gmail 수집은 원래 업체를 구분하지 않았다. 첨부 있는 메일을 전부
 *    가져와 **현재 시트**에 넣고 처리 라벨을 붙인다. 그래서 업체별로
 *    돌리면 먼저 도는 업체가 남의 명세서까지 가져간다.
 *
 *    발신 주소로 가르는 방법도 있지만 담당자가 바뀌면 끊긴다.
 *    명세서에 적힌 사업자번호·상호·거래처코드는 안 바뀐다.
 *    그래서 본문을 먼저 보고, 발신 주소는 학습해서 빨라지는 용도로만 쓴다.
 *
 *  ★ 판별 순서 ★
 *    ② 사업자등록번호 10자리      — 가장 확실
 *    ③ 거래처코드(CUST_CD)
 *    ④ 상호/업체명 포함 매칭
 *    ① 학습표(발신주소 → 업체)   — 본문으로 못 가렸을 때의 구제책
 *
 *    ②~④ 로 확정되면 발신 주소를 학습표에 적는다.
 *    며칠 지나면 새 담당자·양식 변경에도 발신 주소로 붙는다.
 *
 *  ★ 왜 학습표가 ① 인데 마지막에 보나 ★
 *    학습이 한 번 틀리면 계속 틀린다. 본문에 확실한 근거가 있으면
 *    그쪽이 이겨야 한다. 학습은 본문이 안 읽힐 때만 쓴다.
 *
 *  ★ 업체 사전의 출처 ★
 *    · 각 협력업체 파일 「설정」 B5(거래처명) · B6(거래처코드)
 *    · 허브 「업체_택배사」 (A 접두 | B 업체명)  ← SSOT
 *    · 허브 「거래처정보」 (A 거래처코드 | B 거래처명, 사업자번호 열이 있으면 함께)
 *
 *    사전은 허브 「명세서_업체사전」 탭에 적어 둔다. 사람이 고칠 수 있고,
 *    파일 17개를 매번 여는 비용(6분 제한)을 피한다.
 * ══════════════════════════════════════════════════════════════
 */

var _PSTMTV_DIR_TAB_ = "명세서_업체사전";
var _PSTMTV_LEARN_TAB_ = "명세서_발신학습";

/**
 * 사업자등록번호.
 *
 * ★ 두 벌로 나눈 이유 (2026-09-07) ★
 *   실제 명세서에 이런 게 있다 —
 *     승인번호 : 20260907-09071925815281971
 *   경계 없이 10자리를 찾으면 저 숫자 덩어리 **안에서** 잘라 잡는다.
 *   그게 어느 업체 사업자번호와 우연히 겹치면 남의 파일로 들어간다.
 *
 *   그래서 하이픈이 있는 형태(3-2-5)를 먼저 본다. 문서의 「등록번호」 칸은
 *   늘 이 모양이다(243-86-01181, 101-86-45056 — 실측).
 *   그걸로 못 찾았을 때만 하이픈 없는 10자리를 보되, 앞뒤가 숫자가 아닌
 *   것만 인정한다.
 */
var _PSTMTV_BIZNO_HYPHEN_RE_ = /(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})/g;
var _PSTMTV_BIZNO_BARE_RE_ = /(?:^|[^\d])(\d{3})(\d{2})(\d{5})(?![\d])/g;

/** 표기 흔들림 흡수 — ㈜·(주)·공백·특수문자를 걷어낸다 */
function _pstmtv_norm_(v) {
  return String(v == null ? "" : v)
    .replace(/㈜|주식회사|유한회사/g, "")
    .replace(/[\s\-_.,·|/()\[\]]/g, "")
    .toUpperCase();
}

/** 사업자번호 10자리만 남긴다 */
function _pstmtv_normBizNo_(v) {
  var s = String(v == null ? "" : v).replace(/[^\d]/g, "");
  return s.length === 10 ? s : "";
}

/**
 * ★ 전자문서 중계사 도메인 — 여기서 온 주소는 학습하지 않는다 (2026-09-07) ★
 *
 *   실제 받은 메일을 확인해 보니 발신 주소가 업체 것이 아니었다.
 *     (주)로엔그린          → no-reply@webcash.co.kr   (웹캐시 비즈메일)
 *     주식회사준테크피에스와이 → joontech2018@magicbill.co.kr (매직빌)
 *
 *   webcash 의 no-reply 주소는 **여러 업체가 함께 쓴다**. 이걸 로엔그린으로
 *   학습하면 다음에 다른 업체가 같은 경로로 보낼 때 그 업체 명세서가
 *   로엔그린 파일로 들어간다. 충돌 감지가 있긴 하지만 그건 사후에 알려줄 뿐이고,
 *   그 사이 한 번은 잘못 들어간다.
 *
 *   중계사를 거치는 건은 본문·제목에 상호가 또렷하게 찍히므로 학습이 필요 없다.
 *   학습은 업체가 자기 주소로 직접 보내는 경우에만 값이 있다.
 */
var _PSTMTV_RELAY_DOMAINS_ = [
  "webcash.co.kr",     // 웹캐시 비즈메일  (확인함)
  "magicbill.co.kr",   // 매직빌          (확인함)
  "barobill.co.kr",
  "smartbill.co.kr",
  "hometax.go.kr",
  "bill36524.com",
];

/** 중계사 발신인가 — 맞으면 학습하지 않는다 */
function _pstmtv_isRelay_(addr) {
  var a = String(addr || "").toLowerCase();
  if (!a) return false;
  for (var i = 0; i < _PSTMTV_RELAY_DOMAINS_.length; i++) {
    if (a.indexOf("@") !== -1 && a.split("@")[1].indexOf(_PSTMTV_RELAY_DOMAINS_[i]) !== -1) {
      return true;
    }
  }
  return false;
}

/** "홍길동 <a@b.com>" → "a@b.com" */
function _pstmtv_addrOf_(from) {
  var s = String(from || "");
  var m = s.match(/<([^>]+)>/);
  return String(m ? m[1] : s).trim().toLowerCase();
}

// ───────────────────────────────────────────────────────────
//  업체 사전
// ───────────────────────────────────────────────────────────

/**
 * 사전을 새로 만든다. 협력업체 파일을 전부 열기 때문에 느리다(1~2분).
 * 하루 한 번이면 충분해서 탭에 적어 두고 이후엔 읽기만 한다.
 */
function _pstmtv_rebuildDirectory_() {
  var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var out = { rows: [], warn: [] };

  // 1) 접두 → 업체명 (SSOT: 업체_택배사, 없으면 코드 폴백)
  var byPfxName = {};
  try {
    var ct = hub.getSheetByName("업체_택배사");
    if (ct && ct.getLastRow() >= 2) {
      var cdata = ct.getRange(2, 1, ct.getLastRow() - 1, 2).getDisplayValues();
      for (var i = 0; i < cdata.length; i++) {
        var pf = String(cdata[i][0] || "").trim().toUpperCase();
        var nm = String(cdata[i][1] || "").trim();
        if (pf && nm) byPfxName[pf] = nm;
      }
    }
  } catch (e2) {
    out.warn.push("「업체_택배사」 읽기 실패: " + e2.message);
  }
  try {
    if (typeof _PEP_VENDOR_NAME_ !== "undefined") {
      for (var k in _PEP_VENDOR_NAME_) {
        if (!byPfxName[k]) byPfxName[k] = _PEP_VENDOR_NAME_[k];
      }
    }
  } catch (e3) {}

  // 2) 거래처정보 — 거래처명 → 코드, 그리고 사업자번호 열이 있으면 같이
  var custByName = {}, bizByName = {}, bizCol = -1;
  try {
    var it = hub.getSheetByName("거래처정보");
    if (it && it.getLastRow() >= 2) {
      var lastC = Math.min(it.getLastColumn(), 12);
      var idata = it.getRange(1, 1, it.getLastRow(), lastC).getDisplayValues();
      // 사업자번호 열을 머리글로 찾는다 — 없으면 이름 매칭만으로 간다
      for (var hr = 0; hr < Math.min(idata.length, 5) && bizCol < 0; hr++) {
        for (var hc = 0; hc < lastC; hc++) {
          var h = _pstmtv_norm_(idata[hr][hc]);
          if (h.indexOf("사업자") !== -1 || h === "BIZNO" || h.indexOf("등록번호") !== -1) {
            bizCol = hc;
            break;
          }
        }
      }
      for (var r = 0; r < idata.length; r++) {
        var cdv = String(idata[r][0] || "").trim();
        var nmv = _pstmtv_norm_(idata[r][1]);
        if (!cdv || !nmv || cdv === "거래처코드") continue;
        if (!custByName[nmv]) custByName[nmv] = cdv;
        if (bizCol >= 0) {
          var bz = _pstmtv_normBizNo_(idata[r][bizCol]);
          if (bz && !bizByName[nmv]) bizByName[nmv] = bz;
        }
      }
    }
  } catch (e4) {
    out.warn.push("「거래처정보」 읽기 실패: " + e4.message);
  }
  if (bizCol < 0) {
    out.warn.push("「거래처정보」에 사업자번호 열이 없습니다 — 상호/코드 매칭만 씁니다.");
    out.warn.push("  머리글에 '사업자' 가 든 열을 추가하면 판별이 훨씬 확실해집니다.");
  }

  // 3) 협력업체 파일 — 설정 B5/B6
  var files = [];
  try {
    files = _pt_listFiles();
  } catch (e5) {
    out.warn.push("협력업체 파일 목록 실패: " + e5.message);
  }
  var prefixToFile = {};
  try {
    prefixToFile = _pep_buildPrefixToFileMap_(files);
  } catch (e6) {
    out.warn.push("파일 매핑 실패: " + e6.message);
  }

  for (var pfx in byPfxName) {
    var name = byPfxName[pfx];
    var fi = prefixToFile[pfx] || null;
    var setNm = "", setCd = "";
    if (fi && fi.id) {
      try {
        var vss = SpreadsheetApp.openById(fi.id);
        var st = vss.getSheetByName("설정");
        if (st) {
          setNm = String(st.getRange("B5").getValue() || "").trim();

          // ★ 거래처코드는 두 방향으로 망가진다 (2026-09-07) ★
          //   getValue()        → 셀이 숫자면 앞자리 0 이 없다
          //   getDisplayValue() → 열이 좁으면 "2.5488E+09" 로 준다.
          //                       이건 이미 정밀도를 잃은 값이라 되돌릴 수 없다
          //                       (2.5488E+09 → 2548800000, 뒤 네 자리가 날아간다).
          //
          //   그래서 어느 쪽을 쓸지는 **셀의 자료형**으로 정한다.
          //     숫자 셀 → 앞자리 0 이 애초에 없다. 원값이 정확하다.
          //     텍스트 셀 → 표시값이 원본 그대로다. 앞자리 0 이 살아 있다.
          //   한쪽만 쓰면 반드시 한쪽이 깨진다.
          var c = st.getRange("B6");
          var rawCd = c.getValue();
          var clean = (typeof _epx_cleanCustCd_ === "function")
            ? _epx_cleanCustCd_
            : function (v) { return String(v == null ? "" : v).trim(); };
          if (typeof rawCd === "number" && isFinite(rawCd)) {
            setCd = String(Math.round(rawCd));
          } else {
            setCd = clean(c.getDisplayValue()) || clean(rawCd);
          }
          // 거래처명이 코드칸과 같으면 코드로 인정하지 않는다(설정 검증식과 동일 취지)
          if (setCd && setNm && setCd === setNm) setCd = "";
        }
      } catch (eo) {
        out.warn.push("[" + name + "] 파일 열기 실패: " + eo.message);
      }
    }

    var key = _pstmtv_norm_(setNm || name);
    var key2 = _pstmtv_norm_(name);
    var custCd = setCd || custByName[key] || custByName[key2] || "";
    var bizNo = bizByName[key] || bizByName[key2] || "";

    // 별칭: 업체명·설정명·파일명을 다 넣는다. 명세서 상호 표기가 제각각이다.
    var alias = {};
    var cand = [name, setNm];
    if (fi) cand.push(String(fi.name || "").replace(/^\[협력업체\][_\s]*/, "").trim());
    for (var ci = 0; ci < cand.length; ci++) {
      var an = _pstmtv_norm_(cand[ci]);
      if (an && an.length >= 2) alias[an] = 1;
    }

    out.rows.push([
      pfx,
      name,
      setNm,
      custCd,
      bizNo,
      fi ? fi.id : "",
      fi ? fi.name : "",
      Object.keys(alias).join(" | "),
    ]);
  }

  out.rows.sort(function (a, b) {
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return out;
}

/** 사전을 허브 탭에 적는다 */
function _pstmtv_writeDirectory_(built) {
  var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var tab = hub.getSheetByName(_PSTMTV_DIR_TAB_);
  if (!tab) tab = hub.insertSheet(_PSTMTV_DIR_TAB_);
  tab.clear();
  var head = ["접두", "업체명", "설정B5", "거래처코드", "사업자번호", "파일ID", "파일명", "별칭(판별용)"];
  tab
    .getRange(1, 1, 1, head.length)
    .setValues([head])
    .setFontWeight("bold")
    .setBackground("#f1f3f4");

  // ★ 앞자리 0 을 지키려면 값을 넣기 전에 텍스트로 잠가야 한다 (2026-09-07) ★
  //   시트는 "0123456789" 를 숫자 123456789 로 삼킨다. 거래처코드·사업자번호가
  //   0 으로 시작하면 한 자리가 날아가고, 그 코드로는 아무것도 못 찾는다.
  //   이 프로젝트가 구매입력에서 같은 함정을 이미 겪었다(_EPX_TEXT_COLS_).
  //
  //   ★ flush 를 try 안에서 부른다 ★
  //     GAS 는 서식 적용을 미뤄 뒀다가 나중에 던진다. try 밖에서 터지면
  //     사전 만들기가 통째로 죽는다. 오늘 푸시에서 겪은 것과 같은 함정이다.
  var _lockRows_ = Math.max(built.rows.length, 1);
  try {
    tab.getRange(2, 4, _lockRows_, 2).setNumberFormat("@"); // D 거래처코드 · E 사업자번호
    SpreadsheetApp.flush();
  } catch (eFmt) {
    // 열 유형이 걸린 열에는 서식을 못 준다. 그때는 값 앞에 작은따옴표로 잠근다.
    Logger.log("[PSTMTV] 텍스트 서식 실패, 따옴표로 대체: " + eFmt.message);
    for (var q = 0; q < built.rows.length; q++) {
      if (built.rows[q][3] && String(built.rows[q][3]).charAt(0) === "0") {
        built.rows[q][3] = "'" + built.rows[q][3];
      }
      if (built.rows[q][4] && String(built.rows[q][4]).charAt(0) === "0") {
        built.rows[q][4] = "'" + built.rows[q][4];
      }
    }
  }

  if (built.rows.length) {
    tab.getRange(2, 1, built.rows.length, head.length).setValues(built.rows);
  }
  tab.setFrozenRows(1);
  try {
    tab.autoResizeColumns(1, head.length);
  } catch (e) {}
  return tab;
}

/** 탭에서 사전을 읽어 판별용 색인으로 만든다 */
function _pstmtv_loadDirectory_() {
  var dir = { byBiz: {}, byCust: {}, byAlias: {}, byPfx: {}, count: 0 };
  var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var tab = hub.getSheetByName(_PSTMTV_DIR_TAB_);
  if (!tab || tab.getLastRow() < 2) return dir;

  var data = tab.getRange(2, 1, tab.getLastRow() - 1, 8).getDisplayValues();
  for (var i = 0; i < data.length; i++) {
    var pfx = String(data[i][0] || "").trim().toUpperCase();
    if (!pfx) continue;
    var e = {
      pfx: pfx,
      name: data[i][1] || "",
      setNm: data[i][2] || "",
      custCd: String(data[i][3] || "").trim(),
      bizNo: _pstmtv_normBizNo_(data[i][4]),
      fileId: String(data[i][5] || "").trim(),
      fileName: data[i][6] || "",
    };
    dir.byPfx[pfx] = e;
    dir.count++;
    if (e.bizNo) dir.byBiz[e.bizNo] = e;
    if (e.custCd) dir.byCust[e.custCd] = e;
    var al = String(data[i][7] || "").split("|");
    for (var ai = 0; ai < al.length; ai++) {
      var n = _pstmtv_norm_(al[ai]);
      if (n && n.length >= 2 && !dir.byAlias[n]) dir.byAlias[n] = e;
    }
  }
  return dir;
}

// ───────────────────────────────────────────────────────────
//  발신처 학습표
// ───────────────────────────────────────────────────────────

function _pstmtv_ensureLearnTab_() {
  var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
  var tab = hub.getSheetByName(_PSTMTV_LEARN_TAB_);
  if (!tab) {
    tab = hub.insertSheet(_PSTMTV_LEARN_TAB_);
    var head = ["발신주소", "접두", "업체명", "확정근거", "적중", "최초", "최근", "메모"];
    tab
      .getRange(1, 1, 1, head.length)
      .setValues([head])
      .setFontWeight("bold")
      .setBackground("#f1f3f4");
    tab.setFrozenRows(1);
  }
  return tab;
}

function _pstmtv_loadLearn_() {
  var map = {};
  var tab = _pstmtv_ensureLearnTab_();
  if (tab.getLastRow() < 2) return map;
  var d = tab.getRange(2, 1, tab.getLastRow() - 1, 8).getDisplayValues();
  for (var i = 0; i < d.length; i++) {
    var addr = String(d[i][0] || "").trim().toLowerCase();
    var pfx = String(d[i][1] || "").trim().toUpperCase();
    if (!addr || !pfx) continue;
    map[addr] = {
      pfx: pfx,
      name: d[i][2] || "",
      hits: parseInt(d[i][4], 10) || 0,
      row: i + 2,
    };
  }
  return map;
}

/**
 * 학습표에 적는다. 이미 있으면 적중 수와 최근 날짜만 올린다.
 *
 * ★ 다른 업체로 바뀌면 덮어쓰지 않는다 ★
 *   한 주소에서 두 업체가 오는 경우(대행 발송, 그룹사)가 실제로 있다.
 *   덮어쓰면 조용히 오배정된다. 메모에 남기고 사람이 판단하게 둔다.
 */
function _pstmtv_learn_(addr, pfx, name, basis) {
  addr = String(addr || "").trim().toLowerCase();
  if (!addr || !pfx) return;
  // 중계사 주소는 여러 업체가 공유한다 — 학습하면 남의 명세서를 끌어온다
  if (_pstmtv_isRelay_(addr)) return;
  var tab = _pstmtv_ensureLearnTab_();
  var cur = _pstmtv_loadLearn_();
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  if (cur[addr]) {
    var r = cur[addr].row;
    if (cur[addr].pfx !== pfx) {
      var memo = tab.getRange(r, 8).getDisplayValue();
      var mark = "충돌:" + pfx + "(" + today + ")";
      if (memo.indexOf(mark) === -1) {
        tab.getRange(r, 8).setValue((memo ? memo + " / " : "") + mark);
        tab.getRange(r, 1, 1, 8).setBackground("#fff3cd"); // 사람이 봐야 할 줄
      }
      return;
    }
    tab.getRange(r, 5).setValue(cur[addr].hits + 1);
    tab.getRange(r, 7).setValue(today);
    return;
  }
  tab.appendRow([addr, pfx, name, basis, 1, today, today, ""]);
}

// ───────────────────────────────────────────────────────────
//  판별
// ───────────────────────────────────────────────────────────

/**
 * 메일 한 통에서 업체를 가린다.
 *
 * @param ctx   {from, subject, fileName, text} — text 는 첨부에서 읽은 본문
 * @param dir   _pstmtv_loadDirectory_() 결과
 * @param learn _pstmtv_loadLearn_() 결과
 * @return {pfx, name, basis, confident, addr} — 못 가리면 pfx 가 ""
 */
function _pstmtv_identify_(ctx, dir, learn) {
  var addr = _pstmtv_addrOf_(ctx.from);
  var text = String(ctx.text || "");
  var hay = _pstmtv_norm_(text + " " + (ctx.subject || "") + " " + (ctx.fileName || ""));

  // ② 사업자등록번호 — 가장 확실하다.
  //    하이픈 있는 형태를 먼저, 못 찾으면 하이픈 없는 형태를 본다.
  var res = [_PSTMTV_BIZNO_HYPHEN_RE_, _PSTMTV_BIZNO_BARE_RE_];
  for (var ri = 0; ri < res.length; ri++) {
    res[ri].lastIndex = 0;
    var m;
    while ((m = res[ri].exec(text)) !== null) {
      var bz = m[1] + m[2] + m[3];
      if (dir.byBiz[bz]) {
        var e2 = dir.byBiz[bz];
        return {
          pfx: e2.pfx, name: e2.name,
          basis: "사업자번호 " + bz + (ri ? "(무하이픈)" : ""),
          confident: true, addr: addr,
        };
      }
    }
  }

  // ③ 거래처코드 — 짧은 코드는 우연히 걸릴 수 있어 4자 이상만 본다
  for (var cc in dir.byCust) {
    if (cc.length >= 4 && hay.indexOf(_pstmtv_norm_(cc)) !== -1) {
      var e3 = dir.byCust[cc];
      return {
        pfx: e3.pfx, name: e3.name,
        basis: "거래처코드 " + cc, confident: true, addr: addr,
      };
    }
  }

  // ④ 상호/업체명 — 긴 별칭부터 본다
  //    "팩" 같은 짧은 조각이 먼저 걸리면 엉뚱한 업체로 간다
  var aliases = Object.keys(dir.byAlias).sort(function (a, b) {
    return b.length - a.length;
  });
  for (var ai = 0; ai < aliases.length; ai++) {
    if (aliases[ai].length >= 2 && hay.indexOf(aliases[ai]) !== -1) {
      var e4 = dir.byAlias[aliases[ai]];
      return {
        pfx: e4.pfx, name: e4.name,
        basis: "상호 " + aliases[ai], confident: true, addr: addr,
      };
    }
  }

  // ① 학습표 — 본문으로 못 가렸을 때의 구제책
  //    중계사 주소는 여러 업체가 공유하므로 학습값이 있어도 쓰지 않는다
  //    (가드를 넣기 전에 들어간 줄이 남아 있을 수 있다)
  if (addr && learn[addr] && !_pstmtv_isRelay_(addr)) {
    var l = learn[addr];
    return {
      pfx: l.pfx, name: l.name,
      basis: "학습(" + addr + " 적중" + l.hits + ")",
      confident: l.hits >= 2, addr: addr,
    };
  }

  return { pfx: "", name: "", basis: "판별 실패", confident: false, addr: addr };
}

// ───────────────────────────────────────────────────────────
//  메뉴
// ───────────────────────────────────────────────────────────

/** [메뉴] 업체 사전 새로 만들기 — 협력업체 파일을 다 열어 1~2분 걸린다 */
function partnerRebuildStatementDirectory() {
  var t0 = new Date().getTime();
  var built = _pstmtv_rebuildDirectory_();
  _pstmtv_writeDirectory_(built);

  var noCd = 0, noBiz = 0, noFile = 0;
  for (var i = 0; i < built.rows.length; i++) {
    if (!built.rows[i][3]) noCd++;
    if (!built.rows[i][4]) noBiz++;
    if (!built.rows[i][5]) noFile++;
  }

  var L = [
    "═══ 명세서 업체 사전 ═══",
    "",
    "업체 " + built.rows.length + "곳 · " +
      Math.round((new Date().getTime() - t0) / 1000) + "초",
    "",
    "거래처코드 없음 " + noCd +
      " · 사업자번호 없음 " + noBiz +
      " · 파일 못찾음 " + noFile,
    "",
  ];
  if (built.warn.length) {
    L.push("[확인]");
    for (var w = 0; w < built.warn.length; w++) L.push("  " + built.warn[w]);
    L.push("");
  }
  L.push("「" + _PSTMTV_DIR_TAB_ + "」 탭에 적었습니다. 직접 고쳐도 됩니다.");
  L.push("별칭 열에 명세서에 찍히는 상호를 추가하면 판별이 좋아집니다.");

  var text = L.join("\n");
  Logger.log(text);
  try {
    SpreadsheetApp.getUi().alert("업체 사전", text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
  return text;
}
