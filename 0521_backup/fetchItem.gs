/**
 * [ Pack2U 프로젝트 - fetchItem_v3.gs 초경량 고속 엔진 ]
 */

function getProductInfo2() {
  getEcountAll();
}

function fetchSelectedItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();
  if (!sheet || sheet.getName() !== "상품정보") {
    ui.alert("⚠️ 선택 동기화는 [상품정보] 탭에서만 실행할 수 있습니다.");
    return;
  }
  var range = sheet.getActiveRange();
  if (!range) {
    ui.alert("⚠️ 동기화할 행 범위를 먼저 선택해주세요.");
    return;
  }
  var startRow = range.getRow();
  var numRows = range.getNumRows();
  if (startRow < 6) {
    ui.alert("⚠️ 헤더 영역(1~5행) 대신 실제 상품 행(6행 이후)을 선택해주세요.");
    return;
  }
  var headers = sheet.getRange(1, 1, 2, sheet.getLastColumn()).getValues();
  var colIdx = headers[1].indexOf("PROD_CD");
  if (colIdx === -1) colIdx = headers[0].indexOf("PROD_CD");
  if (colIdx === -1) colIdx = 4;
  var codes = sheet.getRange(startRow, colIdx + 1, numRows, 1).getValues();
  var target = [];
  var map = typeof buildTrueCodeMap === "function" ? buildTrueCodeMap(ss) : {};
  target = codes
    .map(function (r) {
      var raw = String(r[0]).replace(/[\s\u200B-\u200D\uFEFF]/g, "");
      return map[raw] || raw;
    })
    .filter(function (v) {
      return v && v !== "PROD_CD" && v !== "이카운트코드";
    });
  target = Array.from(new Set(target));
  if (target.length === 0)
    return ui.alert("⚠️ 선택한 구간에서 유효한 품목코드를 찾지 못했습니다.");
  var html = HtmlService.createTemplateFromFile("fetchProgress");
  html.targetCodes = JSON.stringify(target);
  ui.showModalDialog(
    html.evaluate().setWidth(450).setHeight(360),
    "동기화 중...",
  );
}

function initSessionForFetch() {
  try {
    var z = verifyZoneAPI();
    var res = login(z);
    if (!res || !res.Data || !res.Data.Datas) throw "로그인 실패";
    var nsid = res.Data.Datas.SESSION_ID;
    
    // Properties 전역 오염 방지 -> 개별 UUID 기반 단기 캐시 사용
    var reqId = "EC_" + Utilities.getUuid();
    CacheService.getScriptCache().put(reqId + "_ZONE", String(z), 600);
    CacheService.getScriptCache().put(reqId + "_SID", nsid, 600);
    
    return { success: true, zone: z, sessionId: nsid, reqId: reqId, isCached: false };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function processEcountBatch(batch, zone, sid) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dbS = ss.getSheetByName("이카운트-품목정보");
  var invS = ss.getSheetByName("이카운트-재고");
  if (!dbS || !invS) return { success: false, error: "시트실종" };
  var esid = encodeURIComponent(sid);
  var invM = {};
  var dbLr = dbS.getLastRow();
  var dbLc = dbS.getLastColumn();
  var dbH = dbS.getRange(1, 1, 1, dbLc).getValues()[0];
  var dbP = dbH.indexOf("PROD_CD");
  if (dbP === -1) return { success: false, error: "품목정보 탭 PROD_CD 열 없음" };
  var invLr = invS.getLastRow();
  var invLc = invS.getLastColumn();
  var invH = invS.getRange(1, 1, 1, invLc).getValues()[0];
  var invP = invH.indexOf("PROD_CD");
  if (invP === -1) return { success: false, error: "재고 탭 PROD_CD 열 없음" };

  var dbCodeToRow = {};
  if (dbLr >= 3) {
    var dbCodes = dbS.getRange(3, dbP + 1, dbLr - 2, 1).getValues();
    for (var di = 0; di < dbCodes.length; di++) {
      var dCode = String(dbCodes[di][0] || "").trim();
      if (dCode && dbCodeToRow[dCode] === undefined) dbCodeToRow[dCode] = di + 3;
    }
  }

  var invCodeToRow = {};
  if (invLr >= 3) {
    var invCodes = invS.getRange(3, invP + 1, invLr - 2, 1).getValues();
    for (var ii = 0; ii < invCodes.length; ii++) {
      var iCode = String(invCodes[ii][0] || "").trim();
      if (iCode && invCodeToRow[iCode] === undefined) invCodeToRow[iCode] = ii + 3;
    }
  }
  var iUrl =
    "https://oapi" +
    zone.toUpperCase() +
    ".ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=" +
    esid;
  var iRes = fetchWithRetry(iUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      WH_CD: "100",
      BASE_DATE: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"),
      ZERO_FLAG: "Y",
      PROD_CD: batch.join(";"),
    }),
    headers: { "Accept": "application/json", "Expect": "" },
    muteHttpExceptions: true,
  }, 3);
  if (iRes.getResponseCode() === 200) {
    var iD = JSON.parse(iRes.getContentText());
    if (iD.Data && iD.Data.Result) {
      var iL = Array.isArray(iD.Data.Result)
        ? iD.Data.Result
        : [iD.Data.Result];
      var invAppendRows = [];
      iL.forEach(function (item) {
        var cd = String(item.PROD_CD).trim();
        invM[cd] = item.BAL_QTY || item.U_BAL_QTY || 0;
        if (!cd) return;
        var nR = invH.map(function (h) {
          return item[h] !== undefined ? item[h] : "";
        });
        var existingInvRow = invCodeToRow[cd];
        if (existingInvRow) {
          invS.getRange(existingInvRow, 1, 1, invH.length).setValues([nR]);
        } else {
          invAppendRows.push(nR);
          invCodeToRow[cd] = invLr + invAppendRows.length;
        }
      });
      if (invAppendRows.length > 0) {
        invS
          .getRange(invLr + 1, 1, invAppendRows.length, invH.length)
          .setValues(invAppendRows);
      }
    }
  }
  var dbAppendRows = [];
  for (var k = 0; k < batch.length; k++) {
    var cd = batch[k];
    var pUrl =
      "https://oapi" +
      zone.toUpperCase() +
      ".ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?SESSION_ID=" +
      esid;
    var pRes = fetchWithRetry(pUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ PROD_CD: cd }),
      headers: { "Accept": "application/json", "Expect": "" },
      muteHttpExceptions: true,
    }, 3);
    if (pRes.getResponseCode() === 200) {
      var pD = JSON.parse(pRes.getContentText());
      if (pD.Data && pD.Data.Result) {
        var mP = Array.isArray(pD.Data.Result)
          ? pD.Data.Result[0]
          : pD.Data.Result;
        // [진단용 임시 코드] 응답값의 실제 Key들을 로깅
        if (mP && k === 0 && typeof console !== 'undefined') {
            console.log("=== API 응답 원본 (1번째 품목) ===");
            console.log(JSON.stringify(mP));
        }
        if (mP) {
          var currentCode = String(mP.PROD_CD || "").trim();
          if (!currentCode) continue;
          var fR = dbCodeToRow[currentCode] || -1;
          var oldRow = null;
          if (fR !== -1) oldRow = dbS.getRange(fR, 1, 1, dbH.length).getValues()[0];
          var nR = dbH.map(function (h, hIndex) {
            var oldVal = oldRow ? oldRow[hIndex] : "";
            // 🚨 [패치 3] 사장님 특명! '이카운트-품목정보' 탭에도 재고(BAL_QTY)를 무조건 합쳐야 합니다!
            if (h === "BAL_QTY" || h === "U_BAL_QTY") {
                var realInv = invM[mP.PROD_CD]; // 위에서 실시간으로 가져온 재고
                return realInv !== undefined ? realInv : (mP[h] !== undefined ? mP[h] : oldVal);
            }

            // 💡 실시간 반영(선택 동기화) 핵심: 
            // 1) 이카운트가 해당 단어를 아예 안 보냈다면(undefined), 기존 엑셀 값(oldVal) 유지!
            // 2) 이카운트가 명시적으로 빈칸("")을 보냈다면, 빈칸 덮어쓰기!
            if (mP[h] !== undefined && mP[h] !== null) {
                return mP[h];
            } else {
                return oldVal; // API 스키마에 없는 필드만 엑셀 기존 데이터 방어
            }
          });
          if (fR !== -1) {
            dbS.getRange(fR, 1, 1, dbH.length).setValues([nR]);
          } else {
            dbAppendRows.push(nR);
            dbCodeToRow[currentCode] = dbLr + dbAppendRows.length;
          }
        }
      }
    }
  }
  if (dbAppendRows.length > 0) {
    dbS
      .getRange(dbLr + 1, 1, dbAppendRows.length, dbH.length)
      .setValues(dbAppendRows);
  }
  SpreadsheetApp.flush();
  return { success: true, updatedCount: batch.length };
}

function finishFetchItemProcess(targetCodes) {
  SpreadsheetApp.flush(); // 데이터 쓰기 확정 (충분함)
  try {
    if (targetCodes && targetCodes.length && typeof moveToEcountSelectedCodes_ === "function") {
      moveToEcountSelectedCodes_(targetCodes);
    } else if (typeof moveToEcount === 'function') {
      moveToEcount(); // 폴백: 전체 동기화
    }
  } catch(e) {
    return "수집 완료! 단, 메인 시트 갱신 중 에러: " + e;
  }
  return "선택 픔목 정보 수집 및 메인 시트 갱신 완료!";
}
