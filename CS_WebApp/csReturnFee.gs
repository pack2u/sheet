/**
 * ══════════════════════════════════════════════════════════════
 *  반품비 — 도서·제주 추가운임 + 박스비
 *  ★ 2026-09-08 신규
 *
 *  > "롯데 데이타를 기준으로 책정하게 해주고 반품시에는 +1000(박스비용)원을"
 *  > "제주도 항공료 3000원 / 우도면, 추자면 항공료외 도선추가"
 *
 *  ★ 표는 한 곳에만 둔다 ★
 *    롯데 도선료 63행은 **세트분리(뉴) 시트의 `도서산간_도선료` 탭**이 원본이다.
 *    여기로 베껴 오지 않고 그때그때 읽는다. 두 벌이면 요율이 오를 때 한쪽만
 *    고쳐지고, 그 차이는 **돈으로 나타난다.**
 *
 *  ★ 판정 함수는 어쩔 수 없이 두 벌이다 ★
 *    원본은 세트분리V2/core.js 의 ssFerryMatch 다. Apps Script 프로젝트가
 *    달라 함수를 못 부른다(라이브러리를 걸면 배포가 서로 묶인다).
 *    그래서 **_csreturnfee_test.js 가 두 구현을 같은 주소로 돌려 비교한다.**
 *    베낀 것을 감추지 않고, 어긋나면 시험이 깨지게 해 둔다.
 * ══════════════════════════════════════════════════════════════
 */

/** 세트분리(뉴) 시트 — 도선료 표의 원본 */
var _CRF_SHEET_ID_ = "1JuwZjorbBG7tOa92xfAy07eUV-r2j2P8bpbYrgCDAwo";
var _CRF_TAB_ = "도서산간_도선료";

/** 요율 — core.js 의 SS_AIR_FEE_JEJU · SS_RETURN_BOX_FEE 와 같은 값이어야 한다 */
var _CRF_AIR_JEJU_ = 3000;
var _CRF_BOX_ = 1000;

/** 표를 자주 읽지 않는다. 하루에 몇 번 바뀔 값이 아니다. */
var _CRF_CACHE_SEC_ = 6 * 3600;
var _CRF_CACHE_KEY_ = "crf_ferry_v1";

/**
 * 도선료 표를 읽는다. 못 읽으면 빈 배열 —
 * ★ 표가 없다고 접수를 막지는 않는다 ★ 그때는 박스비만 붙는다.
 */
function _crf_ferry_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(_CRF_CACHE_KEY_);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* 캐시가 죽어도 아래에서 읽는다 */ }

  var out = [];
  try {
    var ss = SpreadsheetApp.openById(_CRF_SHEET_ID_);
    var tab = ss.getSheetByName(_CRF_TAB_);
    if (tab && tab.getLastRow() > 1) {
      var v = tab.getRange(1, 1, tab.getLastRow(), 6).getDisplayValues();
      // 헤더: 시도 · 시군구 · 읍면동 · 리조건 · 도선료 · 권역
      for (var i = 1; i < v.length; i++) {
        var 시군 = String(v[i][1] || "").trim();
        var 읍면동 = String(v[i][2] || "").trim();
        if (!시군 || !읍면동) continue;
        out.push({
          시군: 시군,
          읍면동: 읍면동,
          리: String(v[i][3] || "").split("|").map(function (x) { return x.trim(); })
               .filter(function (x) { return x; }),
          료: parseInt(String(v[i][4] || "0").replace(/[^0-9]/g, ""), 10) || 0,
          권역: String(v[i][5] || "도서").trim()
        });
      }
    }
  } catch (e) {
    Logger.log("[반품비] 도선료 표를 못 읽었습니다: " + e.message);
    return [];
  }

  try { cache.put(_CRF_CACHE_KEY_, JSON.stringify(out), _CRF_CACHE_SEC_); } catch (e) {}
  return out;
}

/**
 * 주소에 맞는 도선료 행.
 * ★ 세트분리V2/core.js 의 ssFerryMatch 를 옮긴 것 ★ 고치면 양쪽을 같이 고친다.
 *
 * 시군구와 읍면동이 둘 다 주소에 있어야 한다. 읍면동만 보면 「남면」처럼
 * 여러 시군에 있는 이름이 엉뚱한 곳을 잡는다.
 * 리조건이 있으면 그 리까지 있어야 확정이다 — 그 읍·면 전체가 대상은 아니다.
 */
function _crf_match_(addr, ferry) {
  if (!addr || !ferry || !ferry.length) return null;
  for (var i = 0; i < ferry.length; i++) {
    var f = ferry[i];
    if (!f.시군 || !f.읍면동) continue;
    if (addr.indexOf(f.시군) < 0) continue;
    if (addr.indexOf(f.읍면동) < 0) continue;
    if (f.리 && f.리.length) {
      var hit = false;
      for (var j = 0; j < f.리.length; j++) {
        // 「매화리1구~3구」 같은 표기는 앞의 리 이름만 본다
        var ri = String(f.리[j] || "").split(/[0-9(]/)[0].trim();
        if (ri && addr.indexOf(ri) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
    }
    return { 권역: f.권역 || "도서", 료: f.료 || 0, 읍면동: f.읍면동 };
  }
  return null;
}

/** 제주인가 — 도선료표에 없는 본섬은 주소 글자로 본다 */
function _crf_isJeju_(addr, hit) {
  if (hit && hit.권역 === "제주") return true;
  return /제주(특별자치도|시|도)|서귀포/.test(String(addr || ""));
}

/**
 * 반품비를 계산한다. 화면이 「반품비」 칸을 미리 채울 때 부른다.
 *
 * ★ 항공료와 도선료는 더한다 ★
 *   제주 본섬은 항공료만, 우도·추자는 항공료 + 배편 삯이다.
 *   비행기로 제주까지 간 뒤 배로 한 번 더 나간다.
 *
 * ★ 박스비는 늘 붙는다 ★
 *   반품은 상자를 새로 써야 한다. 육지도 0 이 아니다.
 *
 * @return {{ok:boolean, 합계:number, 항공료:number, 도선료:number,
 *           박스비:number, 권역:string, 근거:string}}
 */
function csReturnFeeFor(addr) {
  var a = String(addr || "").trim();
  var ferry = _crf_ferry_();
  var hit = _crf_match_(a, ferry);
  var 도선료 = hit ? (hit.료 || 0) : 0;
  var 항공료 = _crf_isJeju_(a, hit) ? _CRF_AIR_JEJU_ : 0;
  var 권역 = hit ? hit.권역 : (항공료 ? "제주" : "");

  var 근거 = [];
  if (항공료) 근거.push("제주 항공 " + 항공료.toLocaleString());
  if (도선료) 근거.push((hit ? hit.읍면동 + " " : "") + "도선 " + 도선료.toLocaleString());
  근거.push("박스 " + _CRF_BOX_.toLocaleString());

  return {
    ok: true,
    합계: 항공료 + 도선료 + _CRF_BOX_,
    항공료: 항공료,
    도선료: 도선료,
    박스비: _CRF_BOX_,
    권역: 권역,
    표없음: !ferry.length,
    근거: 근거.join(" + ")
  };
}

/** 편집기에서 확인용 — 표가 읽히는지, 몇 행인지 */
function csReturnFeeSelfTest() {
  var ferry = _crf_ferry_();
  var L = ["── 반품비 ──", "도선료 표 " + ferry.length + "행 (원본: 세트분리 " + _CRF_TAB_ + ")", ""];
  var 표본 = [
    "서울 강남구 테헤란로 1",
    "경남 통영시 욕지면 동항리 100",
    "경남 통영시 산양읍 삼덕리 5",
    "제주특별자치도 제주시 노형동 1",
    "제주특별자치도 제주시 우도면 연평리 1",
    "제주특별자치도 제주시 추자면 대서리 1"
  ];
  for (var i = 0; i < 표본.length; i++) {
    var r = csReturnFeeFor(표본[i]);
    L.push(표본[i]);
    L.push("   " + r.합계.toLocaleString() + "원  (" + r.근거 + ")");
  }
  var out = L.join("\n");
  Logger.log(out);
  return out;
}
