// ==========================================
// [이카운트 품목수정 업로드 가공기 - 100% 이름 동기화 버전]
// ==========================================

function setupEcountFilterSheet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = "UP 품목 검색";
  
  var targetTab = ss.getSheetByName(sheetName);
  if (targetTab) {
     var msg = ui.alert("안내", "이미 '" + sheetName + "' 탭이 존재합니다. 창을 비우고 초기화하시겠습니까?", ui.ButtonSet.YES_NO);
     if(msg !== ui.Button.YES) return;
     targetTab.clear();
  } else {
     targetTab = ss.insertSheet(sheetName);
  }
  
  // 1. 업로드 표준 27열 헤더 고정
  var headers = [[
    "품목코드", "품목명", "품목구분", "세트여부", "재고수량관리", "검색창내용", "출고지", "상태",
    "당수량(분자)", "당수량(분모)", "안전재고수량", "구매처", "입고단가", "입고단가 VAT포함여부",
    "출고단가", "출고단가 VAT포함여부", "세트구성및배송비", "묶음배송비", "상품사이즈", "상품용량",
    "박스사이즈", "쇼핑몰상품명", "단품배송비", "최저가", "배민판매가", "포장가격", "이카운트연동여부"
  ]];
  
  // 2. UI 세팅 (1~3행 각 열별 필터링 구역 세팅)
  var totalCols = headers[0].length;
  
  targetTab.getRange(1, 1, 3, totalCols).setBackground("#fff2cc"); 
  targetTab.getRange(1, 1, 1, totalCols).setBackground("#d9ead3"); 
  targetTab.getRange(2, 1, 1, totalCols).setBackground("#f4cccc"); 
  targetTab.getRange(3, 1, 1, totalCols).setBackground("#cfe2f3"); 
  
  // 3. 헤더 셋업 (4행)
  targetTab.getRange(4, 1, 1, totalCols).setValues(headers)
           .setBackground("#4a86e8").setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
           
  targetTab.getRange("A1").setNote("🟩 [포함 단어 필터]\n이 열(Column)에 포함되어야 할 글자를 적으세요. 콤마(,)로 여러 개 기재 가능.");
  targetTab.getRange("A2").setNote("🚫 [제외 단어 필터]\n이 열(Column)에서 나오면 안 되는 글자를 적으세요. 콤마(,)로 여러 개 기재 가능.");
  targetTab.getRange("A3").setNote("📏 [숫자 범위 필터]\n숫자일 경우 범위를 적으세요. 예: 10~50, >100, <50, 0");
  
  targetTab.setFrozenRows(4); 
  targetTab.setColumnWidths(1, totalCols, 120); 
  targetTab.setColumnWidth(1, 200); 
  
  ui.alert("✅ [각 열별 다이나믹 필터] 양식이 생성되었습니다!\n1~3행의 빈칸에 각 열(조건)에 맞는 필터값을 적고 메뉴에서 조회해보세요.");
}

function runEcountItemFilter() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var filterTab = ss.getSheetByName("UP 품목 검색");
    if (!filterTab) return ui.alert("⚠️ 'UP 품목 검색' 시트가 없습니다.");

    var canonicalHeaders = [
      "품목코드", "품목명", "품목구분", "세트여부", "재고수량관리", "검색창내용", "출고지", "상태",
      "당수량(분자)", "당수량(분모)", "안전재고수량", "구매처", "입고단가", "입고단가 VAT포함여부",
      "출고단가", "출고단가 VAT포함여부", "세트구성및배송비", "묶음배송비", "상품사이즈", "상품용량",
      "박스사이즈", "쇼핑몰상품명", "단품배송비", "최저가", "배민판매가", "포장가격", "이카운트연동여부"
    ];
    var lc = canonicalHeaders.length;
    var targetHeaders = canonicalHeaders.slice();
    filterTab.getRange(4, 1, 1, lc).setValues([targetHeaders]);

    var filtersIncludeRow = filterTab.getRange(1, 1, 1, lc).getValues()[0];
    var filtersExcludeRow = filterTab.getRange(2, 1, 1, lc).getValues()[0];
    var filtersNumberRow  = filterTab.getRange(3, 1, 1, lc).getValues()[0];

    function normalizeFilterCell(v) {
      var s = String(v == null ? "" : v).trim();
      if (!s) return "";
      if (s === "-" || s === "—" || s === "▼" || s === "▽" || s === "전체") return "";
      if (!/[0-9A-Za-z가-힣]/.test(s)) return "";
      return s;
    }

    var normalizedInclude = [];
    var normalizedExclude = [];
    var normalizedNumber = [];
    var activeFilters = [];
    for (var fi = 0; fi < lc; fi++) {
      var iVal = normalizeFilterCell(filtersIncludeRow[fi]);
      var eVal = normalizeFilterCell(filtersExcludeRow[fi]);
      var nVal = normalizeFilterCell(filtersNumberRow[fi]);
      normalizedInclude.push(iVal);
      normalizedExclude.push(eVal);
      normalizedNumber.push(nVal);
      if (iVal !== "") activeFilters.push("포함:" + targetHeaders[fi] + "=" + iVal);
      if (eVal !== "") activeFilters.push("제외:" + targetHeaders[fi] + "=" + eVal);
      if (nVal !== "") activeFilters.push("숫자:" + targetHeaders[fi] + "=" + nVal);
    }
    var hasAnyFilter = activeFilters.length > 0;

    function normalizeHeader(v) {
      return String(v || "")
        .toUpperCase()
        .replace(/\s/g, "")
        .replace(/\(.*\)/g, "")
        .replace(/\[.*\]/g, "")
        .replace(/[^0-9A-Z가-힣_]/g, "");
    }

    function getHeaderAliases(normHeader) {
      var aliasMap = {
        "품목코드": ["이카운트코드", "상품코드", "PROD_CD"],
        "이카운트코드": ["품목코드", "상품코드", "PROD_CD"],
        "상품코드": ["품목코드", "이카운트코드", "PROD_CD"],
        "품목명": ["상품명", "품명", "PROD_DES"],
        "상품명": ["품목명", "품명", "PROD_DES"],
        "품목구분": ["품목분류", "분류", "CLASS_CD1", "CLASSCD1"],
        "세트여부": ["SET_FLAG", "SETFLAG"],
        "검색창내용": ["검색내용", "CONT6"],
        "입고단가": ["IN_PRICE", "INPRICE"],
        "출고단가": ["OUT_PRICE", "OUTPRICE"],
        "입고단가VAT포함여부": ["입고단가부가세", "IN_VAT_YN", "INVATYN"],
        "출고단가VAT포함여부": ["출고단가부가세", "OUT_VAT_YN", "OUTVATYN"]
      };
      return aliasMap[normHeader] || [];
    }

    function colLetterToIndex(letter) {
      var s = String(letter || "").toUpperCase().trim();
      if (!/^[A-Z]+$/.test(s)) return -1;
      var n = 0;
      for (var i = 0; i < s.length; i++) {
        n = n * 26 + (s.charCodeAt(i) - 64);
      }
      return n - 1;
    }

    var masterTab = ss.getSheetByName("상품정보");
    if (!masterTab) return ui.alert("⚠️ '상품정보' DB를 찾을 수 없습니다.");
    var masterData = masterTab.getDataRange().getValues();
    if (!masterData || masterData.length === 0) return ui.alert("⚠️ '상품정보' 시트에 데이터가 없습니다.");

    var mHeaders = [];
    var dataStartRow = 1;
    // 상품정보 표준 구조 우선: 5행 헤더 / 6행부터 데이터
    if (masterData.length >= 5) {
      var row5Norm = (masterData[4] || []).map(function(v){ return String(v || "").replace(/\s/g, "").toUpperCase(); });
      var row5HasCode = false;
      for (var r5 = 0; r5 < row5Norm.length; r5++) {
        if (row5Norm[r5].indexOf("품목코드") !== -1 || row5Norm[r5].indexOf("이카운트코드") !== -1 || row5Norm[r5].indexOf("PROD_CD") !== -1) {
          row5HasCode = true;
          break;
        }
      }
      if (row5HasCode) {
        mHeaders = masterData[4];
        dataStartRow = 5;
      }
    }
    var scanRows = Math.min(30, masterData.length);
    var bestRowIdx = -1;
    var bestValidCount = -1;

    function countNonEmpty(arr) {
      var cnt = 0;
      for (var x = 0; x < arr.length; x++) {
        if (String(arr[x] || "").trim() !== "") cnt++;
      }
      return cnt;
    }

    for (var i = 0; i < scanRows && mHeaders.length === 0; i++) {
      var row = masterData[i] || [];
      var validCount = countNonEmpty(row);
      if (validCount > bestValidCount) {
        bestValidCount = validCount;
        bestRowIdx = i;
      }

      var rowNorm = row.map(function(v){ return String(v || "").replace(/\s/g, "").toUpperCase(); });
      var hasCodeHeader = false;
      var hasNameLike = false;
      for (var c = 0; c < rowNorm.length; c++) {
        var h = rowNorm[c];
        if (!h) continue;
        if (h.indexOf("이카운트코드") !== -1 || h.indexOf("품목코드") !== -1 || h.indexOf("상품코드") !== -1 || h.indexOf("PROD_CD") !== -1) hasCodeHeader = true;
        if (h.indexOf("품목명") !== -1 || h.indexOf("상품명") !== -1 || h.indexOf("상태") !== -1 || h.indexOf("출고지") !== -1) hasNameLike = true;
      }
      if (hasCodeHeader && (hasNameLike || validCount >= 3)) {
        mHeaders = row;
        dataStartRow = i + 1;
        break;
      }
    }
    if (mHeaders.length === 0) {
      if (bestRowIdx === -1) return ui.alert("⚠️ '상품정보'에서 헤더 행을 찾을 수 없습니다.");
      mHeaders = masterData[bestRowIdx];
      dataStartRow = bestRowIdx + 1;
    }

    // 1) 동기화매핑 시트 우선 적용 (이미지 기준 정답 매핑)
    var idxMapByCol = [];
    var unmappedHeaders = [];
    var normalizedMasterHeaders = [];
    for (var nh = 0; nh < mHeaders.length; nh++) normalizedMasterHeaders.push(normalizeHeader(mHeaders[nh]));
    var masterNumeratorCol = -1;
    var masterDenominatorCol = -1;
    for (var mh2 = 0; mh2 < normalizedMasterHeaders.length; mh2++) {
      var mhName = normalizedMasterHeaders[mh2];
      if (masterNumeratorCol === -1 && (
        mhName.indexOf("당수량분자") !== -1 ||
        mhName.indexOf("수량분자") !== -1 ||
        mhName.indexOf("EXCH_RATE") !== -1 ||
        mhName.indexOf("EXCHRATE") !== -1
      )) {
        masterNumeratorCol = mh2;
      }
      if (masterDenominatorCol === -1 && (
        mhName.indexOf("당수량분모") !== -1 ||
        mhName.indexOf("수량분모") !== -1 ||
        mhName.indexOf("DENO_RATE") !== -1 ||
        mhName.indexOf("DENORATE") !== -1
      )) {
        masterDenominatorCol = mh2;
      }
    }

    var mappingByKorean = {}; // "항목명" -> 상품정보 열 인덱스
    var mappingByVar = {};    // "이카운트 변수" -> 상품정보 열 인덱스
    var mappingSheet = ss.getSheetByName("동기화매핑");
    if (mappingSheet) {
      var mapData = mappingSheet.getDataRange().getValues();
      for (var mr = 1; mr < mapData.length; mr++) {
        var ecVar = normalizeHeader(mapData[mr][0]);   // 이카운트 변수
        var koName = normalizeHeader(mapData[mr][1]);  // 이카운트 항목명
        var tCol = colLetterToIndex(mapData[mr][2]);   // 상품정보 타겟열
        if (tCol >= 0) {
          if (koName) mappingByKorean[koName] = tCol;
          if (ecVar) mappingByVar[ecVar] = tCol;
        }
      }
    }

    // canonicalHeaders 기준 이카운트 변수 연결표 (이미지 매핑표 기준)
    var headerToEcVar = {
      "품목코드": "PROD_CD",
      "품목명": "PROD_DES",
      "품목구분": "CLASS_CD1",
      "세트여부": "SET_FLAG",
      "재고수량관리": "BAL_QTY",
      "검색창내용": "CONT6",
      "출고지": "CLASS_CD2",
      "상태": "CLASS_CD3",
      "당수량(분자)": "EXCH_RATE",
      "당수량(분모)": "DENO_RATE",
      "안전재고수량": "SAFE_QTY",
      "구매처": "CUST",
      "입고단가": "IN_PRICE",
      "입고단가 VAT포함여부": "IN_VAT_YN",
      "출고단가": "OUT_PRICE",
      "출고단가 VAT포함여부": "OUT_VAT_YN",
      "세트구성및배송비": "CONT1",
      "묶음배송비": "CONT2",
      "상품사이즈": "CONT3",
      "상품용량": "CONT4",
      "박스사이즈": "CONT5",
      "쇼핑몰상품명": "CONT6",
      "단품배송비": "NO_USER1",
      "최저가": "NO_USER3",
      "배민판매가": "NO_USER4",
      "포장가격": "NO_USER10",
      "이카운트연동여부": "LINK_YN"
    };

    for (var tc = 0; tc < targetHeaders.length; tc++) {
      var tHeadNorm = normalizeHeader(targetHeaders[tc]);
      var mappedIdx = -1;

      // 1순위: 동기화매핑(한글 항목명)
      if (mappingByKorean[tHeadNorm] !== undefined) {
        mappedIdx = mappingByKorean[tHeadNorm];
      }
      // 2순위: 동기화매핑(이카운트 변수)
      if (mappedIdx === -1) {
        var ecVar = normalizeHeader(headerToEcVar[targetHeaders[tc]] || "");
        if (ecVar && mappingByVar[ecVar] !== undefined) mappedIdx = mappingByVar[ecVar];
      }
      // 3순위: 헤더명 직접 매칭
      if (mappedIdx === -1) {
        for (var m = 0; m < normalizedMasterHeaders.length; m++) {
          var mHeadName = normalizedMasterHeaders[m];
          if (mHeadName === tHeadNorm) { mappedIdx = m; break; }
          if (
            tHeadNorm.length >= 2 &&
            mHeadName.length >= 2 &&
            (mHeadName.indexOf(tHeadNorm) !== -1 || tHeadNorm.indexOf(mHeadName) !== -1)
          ) {
            mappedIdx = m; break;
          }
        }
      }
      // 4순위: 별칭
      if (mappedIdx === -1) {
        var aliases = getHeaderAliases(tHeadNorm);
        for (var a = 0; a < aliases.length; a++) {
          var aliasNorm = normalizeHeader(aliases[a]);
          for (var am = 0; am < normalizedMasterHeaders.length; am++) {
            if (normalizedMasterHeaders[am] === aliasNorm) { mappedIdx = am; break; }
          }
          if (mappedIdx !== -1) break;
        }
      }

      if (mappedIdx === -1) unmappedHeaders.push(String(targetHeaders[tc] || ""));
      idxMapByCol.push(mappedIdx);
    }

    // 코드열은 품목코드 컬럼의 매핑 인덱스를 사용
    var masterCodeCol = idxMapByCol[0];
    if (masterCodeCol === -1) {
      for (var mh = 0; mh < normalizedMasterHeaders.length; mh++) {
        var mhNorm = normalizedMasterHeaders[mh];
        if (mhNorm.indexOf("이카운트코드") !== -1 || mhNorm.indexOf("품목코드") !== -1 || mhNorm.indexOf("상품코드") !== -1 || mhNorm.indexOf("PROD_CD") !== -1) {
          masterCodeCol = mh;
          break;
        }
      }
    }
    if (masterCodeCol === -1) return ui.alert("⚠️ 코드열(품목코드) 매핑에 실패했습니다.");

    // 보조 소스: '품목등록,변경'에서 코드 기준으로 누락 열 보강
    var uploadByCode = {};
    var uploadHeaderIdx = {};
    var uploadCodeIdx = -1;
    var uploadTab = ss.getSheetByName("품목등록,변경");
    if (uploadTab && uploadTab.getLastRow() >= 2) {
      var uploadLc = uploadTab.getLastColumn();
      var uploadRows = uploadTab.getRange(1, 1, uploadTab.getLastRow(), uploadLc).getValues();
      var uploadHeaders = uploadRows[0] || [];
      for (var uh = 0; uh < uploadHeaders.length; uh++) {
        var uhNorm = normalizeHeader(uploadHeaders[uh]);
        if (uhNorm) uploadHeaderIdx[uhNorm] = uh;
        if (uploadCodeIdx === -1 && (uhNorm === "품목코드" || uhNorm === "이카운트코드" || uhNorm === "상품코드" || uhNorm === "PROD_CD")) {
          uploadCodeIdx = uh;
        }
      }
      if (uploadCodeIdx !== -1) {
        for (var ur = 1; ur < uploadRows.length; ur++) {
          var uCode = String(uploadRows[ur][uploadCodeIdx] || "").trim();
          if (uCode && uploadByCode[uCode] === undefined) uploadByCode[uCode] = uploadRows[ur];
        }
      }
    }

    // 분자/분모 + 재고수량관리 전용 소스: '이카운트-품목정보' 탭
    // A=코드, D=분자, E=분모, Y=BAL_FLAG(재고수량관리)
    var ecountRateByCode = {};
    var ecItemTab = ss.getSheetByName("이카운트-품목정보");
    if (ecItemTab && ecItemTab.getLastRow() >= 2) {
      var ecLast = ecItemTab.getLastRow();
      var ecRows = ecItemTab.getRange(2, 1, ecLast - 1, 25).getValues(); // A:Y
      for (var er = 0; er < ecRows.length; er++) {
        var ecCode = String(ecRows[er][0] || "").trim();
        if (!ecCode) continue;
        if (!ecountRateByCode[ecCode]) {
          ecountRateByCode[ecCode] = {
            exch: ecRows[er][3], // D
            deno: ecRows[er][4], // E
            balFlag: ecRows[er][24] // Y
          };
        }
      }
    }

    // 상품정보 미매핑 열에 대해 업로드 시트 헤더 매핑을 선반영
    var uploadIdxByCol = [];
    for (var uc = 0; uc < lc; uc++) {
      uploadIdxByCol.push(-1);
      if (idxMapByCol[uc] !== -1) continue;
      var targetNorm = normalizeHeader(targetHeaders[uc]);
      var ecVarNorm = normalizeHeader(headerToEcVar[targetHeaders[uc]] || "");
      if (uploadHeaderIdx[targetNorm] !== undefined) uploadIdxByCol[uc] = uploadHeaderIdx[targetNorm];
      else if (ecVarNorm && uploadHeaderIdx[ecVarNorm] !== undefined) uploadIdxByCol[uc] = uploadHeaderIdx[ecVarNorm];
    }

    var masterByCode = {};
    var matchedCodes = [];
    var matchedCodeSet = {};

    for (var r = dataStartRow; r < masterData.length; r++) {
      var rowData = masterData[r];
      var codeVal = String(rowData[masterCodeCol] || "").trim();
      if (!codeVal) continue;
      if (!masterByCode[codeVal]) masterByCode[codeVal] = rowData;

      var passedAll = true;
      for (var col = 0; col < lc; col++) {
        var mIdx = idxMapByCol[col];
        var myValStr = mIdx === -1 ? "" : String(rowData[mIdx] || "").trim();

        var incStr = normalizedInclude[col];
        if (incStr !== "") {
          var incArr = incStr.split(",").map(function(s){ return s.trim().toUpperCase(); }).filter(function(s){ return s !== ""; });
          var passedInc = false;
          for (var k = 0; k < incArr.length; k++) {
            if (myValStr.toUpperCase().indexOf(incArr[k]) !== -1) { passedInc = true; break; }
          }
          if (!passedInc) { passedAll = false; break; }
        }

        var excStr = normalizedExclude[col];
        if (excStr !== "") {
          var excArr = excStr.split(",").map(function(s){ return s.trim().toUpperCase(); }).filter(function(s){ return s !== ""; });
          var hitExc = false;
          for (var e = 0; e < excArr.length; e++) {
            if (myValStr.toUpperCase().indexOf(excArr[e]) !== -1) { hitExc = true; break; }
          }
          if (hitExc) { passedAll = false; break; }
        }

        var numStr = normalizedNumber[col];
        if (numStr !== "") {
          var myNum = parseFloat(myValStr.replace(/,/g, ""));
          if (isNaN(myNum)) { passedAll = false; break; }
          if (numStr.indexOf("~") !== -1) {
            var parts = numStr.split("~");
            var min = parseFloat(parts[0]);
            var max = parseFloat(parts[1]);
            if (isNaN(min)) min = -Number.MAX_VALUE;
            if (isNaN(max)) max = Number.MAX_VALUE;
            if (myNum < min || myNum > max) { passedAll = false; break; }
          } else if (numStr.indexOf(">") !== -1) {
            var gt = parseFloat(numStr.replace(">", ""));
            if (isNaN(gt) || myNum <= gt) { passedAll = false; break; }
          } else if (numStr.indexOf("<") !== -1) {
            var lt = parseFloat(numStr.replace("<", ""));
            if (isNaN(lt) || myNum >= lt) { passedAll = false; break; }
          } else {
            var eq = parseFloat(numStr);
            if (isNaN(eq) || myNum !== eq) { passedAll = false; break; }
          }
        }
      }

      if (passedAll && !matchedCodeSet[codeVal]) {
        matchedCodeSet[codeVal] = true;
        matchedCodes.push(codeVal);
      }
    }

    // 조건이 아예 없으면 전체 코드 보유 행을 통과 처리
    if (!hasAnyFilter && matchedCodes.length === 0) {
      for (var key in masterByCode) {
        if (Object.prototype.hasOwnProperty.call(masterByCode, key)) matchedCodes.push(key);
      }
    }

    var finalOutput = [];
    for (var mc = 0; mc < matchedCodes.length; mc++) {
      var code = matchedCodes[mc];
      var srcRow = masterByCode[code];
      if (!srcRow) continue;
      var outRow = [];
      for (var oc = 0; oc < lc; oc++) {
        var srcIdx = idxMapByCol[oc];
        // 안정 모드: 매핑 인덱스값만 사용 (열 위치 강제 복사 금지)
        var outVal = srcIdx === -1 ? "" : srcRow[srcIdx];
        var hName = targetHeaders[oc];

        // 예외 1) 검색창내용은 항상 빈값 유지 (중복 주입 방지)
        if (hName === "검색창내용") {
          outVal = "";
        }

        // 예외 1-1) 안전재고수량은 상품정보 H열(인덱스 7) 고정
        if (hName === "안전재고수량") {
          outVal = (srcRow.length > 7) ? srcRow[7] : outVal;
        }

        // 예외 1-2) 재고수량관리는 이카운트-품목정보 Y열(BAL_FLAG) 우선
        if (hName === "재고수량관리") {
          if (ecountRateByCode[code] && ecountRateByCode[code].balFlag !== "" && ecountRateByCode[code].balFlag !== null) {
            outVal = ecountRateByCode[code].balFlag;
          }
        }

        // 예외 2) 당수량(분자/분모)는 상품정보 헤더 기반으로 우선 사용
        if (hName === "당수량(분자)") {
          if (ecountRateByCode[code] && ecountRateByCode[code].exch !== "" && ecountRateByCode[code].exch !== null) outVal = ecountRateByCode[code].exch;
          else outVal = "";
        } else if (hName === "당수량(분모)") {
          if (ecountRateByCode[code] && ecountRateByCode[code].deno !== "" && ecountRateByCode[code].deno !== null) outVal = ecountRateByCode[code].deno;
          else outVal = "";
        }

        // srcIdx 미매핑 열만 품목등록,변경 보조값 사용
        if (
          (outVal === "" || outVal === null) &&
          srcIdx === -1 &&
          uploadByCode[code] &&
          hName !== "검색창내용" &&
          hName !== "당수량(분자)" &&
          hName !== "당수량(분모)"
        ) {
          var uIdx2 = uploadIdxByCol[oc];
          if (uIdx2 !== -1) outVal = uploadByCode[code][uIdx2];
        }

        outRow.push(outVal);
      }
      finalOutput.push(outRow);
    }

    if (finalOutput.length === 0) {
      var filterHint = activeFilters.length > 0
        ? ("\n- 활성필터 샘플: " + activeFilters.slice(0, 4).join(" | ") + (activeFilters.length > 4 ? " ..." : ""))
        : "\n- 활성필터: 없음(전체 조회 모드)";
      ui.alert("⚠️ 조건에 맞는 품목이 없습니다.\n- 코드보유 행수: " + Object.keys(masterByCode).length + "\n- 조건 통과 코드수: 0" + filterHint);
      return;
    }

    var maxR = filterTab.getMaxRows();
    if (maxR > 4) filterTab.getRange(5, 1, maxR - 4, lc).clearContent();
    filterTab.getRange(5, 1, finalOutput.length, lc).setValues(finalOutput);

    var trulyUnmapped = [];
    for (var uc2 = 0; uc2 < lc; uc2++) {
      if (idxMapByCol[uc2] === -1 && uploadIdxByCol[uc2] === -1) {
        trulyUnmapped.push(String(targetHeaders[uc2] || ""));
      }
    }
    var mappedCols = lc - trulyUnmapped.length;
    var diagMsg = "✅ 검색 완료!\n총 " + finalOutput.length + "개의 품목을 가져왔습니다.\n";
    diagMsg += "- 매핑 성공 열: " + mappedCols + " / " + lc + "\n";
    diagMsg += "- 열배치 방식: 동기화매핑 우선 + 보조매핑\n";
    if (trulyUnmapped.length > 0) {
      var sample = trulyUnmapped.slice(0, 8).join(", ");
      if (trulyUnmapped.length > 8) sample += " ...";
      diagMsg += "- 미매핑 열(" + trulyUnmapped.length + "): " + sample + "\n";
      diagMsg += "※ 미매핑 열은 가져오기 성공이어도 빈칸으로 출력됩니다.";
    } else {
      diagMsg += "- 모든 열 매핑 성공";
    }
    ui.alert(diagMsg);
  } catch (e) {
    ui.alert("🚨 필터 조건 조회 중 오류가 발생했습니다.\n" + e.message + "\n\n'UP 품목 검색' 시트를 다시 생성 후 재시도해 주세요.");
  }
}

function resetEcountFilterTopRows() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("UP 품목 검색");
  if (!sheet) {
    ui.alert("⚠️ 'UP 품목 검색' 시트가 없습니다.\n먼저 '1️⃣ 양식 생성'을 실행해 주세요.");
    return;
  }

  var headers = [[
    "품목코드", "품목명", "품목구분", "세트여부", "재고수량관리", "검색창내용", "출고지", "상태",
    "당수량(분자)", "당수량(분모)", "안전재고수량", "구매처", "입고단가", "입고단가 VAT포함여부",
    "출고단가", "출고단가 VAT포함여부", "세트구성및배송비", "묶음배송비", "상품사이즈", "상품용량",
    "박스사이즈", "쇼핑몰상품명", "단품배송비", "최저가", "배민판매가", "포장가격", "이카운트연동여부"
  ]];
  var totalCols = headers[0].length;

  // 1~3행: 조건값만 비우고 서식/색상 유지 복원
  sheet.getRange(1, 1, 3, totalCols).clearContent();
  sheet.getRange(1, 1, 1, totalCols).setBackground("#d9ead3");
  sheet.getRange(2, 1, 1, totalCols).setBackground("#f4cccc");
  sheet.getRange(3, 1, 1, totalCols).setBackground("#cfe2f3");

  // 4행: 표준 헤더 재적용
  sheet.getRange(4, 1, 1, totalCols)
    .setValues(headers)
    .setBackground("#4a86e8")
    .setFontColor("white")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  sheet.getRange("A1").setNote("🟩 [포함 단어 필터]\n이 열(Column)에 포함되어야 할 글자를 적으세요. 콤마(,)로 여러 개 기재 가능.");
  sheet.getRange("A2").setNote("🚫 [제외 단어 필터]\n이 열(Column)에서 나오면 안 되는 글자를 적으세요. 콤마(,)로 여러 개 기재 가능.");
  sheet.getRange("A3").setNote("📏 [숫자 범위 필터]\n숫자일 경우 범위를 적으세요. 예: 10~50, >100, <50, 0");

  sheet.setFrozenRows(4);
  sheet.setColumnWidths(1, totalCols, 120);
  sheet.setColumnWidth(1, 200);

  ui.alert("✅ 상단 1~4행이 표준 업로드 순서로 재정렬/초기화되었습니다.\n(5행 이하 데이터는 유지)");
}
