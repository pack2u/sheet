/**
 * ██████████████████████████████████████████████████████████████
 *
 *  ⛔ 폐기된 시스템 (DEPRECATED) - 절대 사용/수정 금지 ⛔
 *
 *  파일명: _partnerInvoiceScript.gs
 *  용도: 업체별 독립 바운드 스크립트로 카카오 송장매칭을 배포하던 시스템
 *
 *  ★★★ 이 파일은 "독립배포 시스템"입니다 ★★★
 *  ★★★ 현재 협력업체 시스템과 완전히 별개입니다 ★★★
 *
 *  폐기 이유:
 *    1. Google Apps Script API 별도 활성화 필요 (Cloud Console)
 *    2. 권한 승인 문제 반복 발생
 *    3. 업체별 독립 바운드 스크립트 생성 시 onOpen 충돌 발생
 *    4. 중앙 사이드바 방식으로 완전 대체됨
 *
 *  현재 사용 방식 (중앙 관리):
 *    중앙 시트 메뉴 → "📬 카카오 송장매칭 (중앙 관리용)" → openInvoiceMatchSidebar()
 *    → 업체 선택 → 카카오 텍스트 붙여넣기 → 전용양식에 직접 기입
 *
 *  ⚠️ 이 파일의 함수들은 호출해도 폐기 안내만 표시됩니다.
 *  ⚠️ 새로운 기능 추가 시 이 파일에 코드를 추가하지 마세요.
 *  ⚠️ 협력업체 시스템은 createViewerNoticeScript_ (priceManager.gs) 을 사용합니다.
 *  ⚠️ _pt_buildInvoiceMatchGsCode_()는 레거시 코드이며 새 시스템에서 호출하면 안됩니다.
 *
 * ██████████████████████████████████████████████████████████████
 */


/**
 * [DEPRECATED] Script API 배포 방식 — 더 이상 사용하지 않습니다.
 * 중앙 메뉴의 "📬 카카오 송장매칭 (중앙 관리용)"을 사용하세요.
 */
function partnerInstallInvoiceMatchSidebarAll() {
  SpreadsheetApp.getUi().alert(
    '⚠️ 이 기능은 더 이상 사용하지 않습니다.\n\n' +
    '대신 메뉴에서:\n' +
    '💼 협력업체 관리 → 📦 대리발송 발주시스템(New)\n' +
    '→ 📬 카카오 송장매칭 (중앙 관리용)\n\n' +
    '을 사용하면 업체 선택 후 바로 송장 기입이 가능합니다.'
  );
}



/**
 * 협력업체 파일 1개에 송장 매칭 스크립트를 설치/갱신
 * Script API 사용 (onOpen 메뉴 + 사이드바 서버함수 + 인라인 HTML)
 */
function _pt_installInvoiceMatchScript_(ss, oauthToken) {
  var sheetId = ss.getId();
  var props = PropertiesService.getScriptProperties();
  var scriptKey = 'PARTNER_INVOICE_SCRIPT_' + sheetId;
  var savedId = String(props.getProperty(scriptKey) || '').trim();

  // ── Code.gs: onOpen(메뉴) + onEdit(기존 날짜자동입력) ──
  var codeGs = [
    'function onOpen() {',
    '  try {',
    '    SpreadsheetApp.getActiveSpreadsheet()',
    '      .addMenu("📬 송장 매칭", [',
    '        {name: "카카오 송장번호 입력", functionName: "openInvoiceMatchSidebarLocal"}',
    '      ]);',
    '  } catch(e) {}',
    '  try {',
    '    var notice = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].getRange("Y1").getValue();',
    '    var msg = String(notice || "").trim();',
    '    if (!msg || msg.charAt(0) === "(" || msg.charAt(0) === "#") return;',
    '    var html = HtmlService.createHtmlOutput(',
    '      "<div style=\\"font-family:Apple SD Gothic Neo,Arial,sans-serif;padding:24px;\\">" +',
    '      "<div style=\\"font-size:15px;font-weight:bold;color:#c07616;margin-bottom:14px;\\">📢 공지사항</div>" +',
    '      "<div style=\\"font-size:13px;line-height:1.9;white-space:pre-wrap;\\">" + msg + "</div>" +',
    '      "</div>"',
    '    ).setWidth(440).setHeight(230);',
    '    SpreadsheetApp.getUi().showModelessDialog(html, "📢 Pack2U 공지사항");',
    '  } catch(e) {}',
    '}',
    '',
    'function onEdit(e) {',
    '  try {',
    '    if (!e || !e.range) return;',
    '    var sheet = e.range.getSheet();',
    '    if (sheet.getName() !== "\ubc1c\uc8fc \ubc0f \uc1a1\uc7a5\uc870\ud68c") return;',
    '',
    '    var r = e.range;',
    '    var row = r.getRow();',
    '    var numRows = r.getNumRows();',
    '    var startCol = r.getColumn();',
    '    var numCols = r.getNumColumns();',
    '    if (row < 2 || numRows <= 0) return;',
    '    if (numRows > 500) return;',
    '',
    '    var hasC = (startCol <= 3 && startCol + numCols > 3);',
    '    var hasD = (startCol <= 4 && startCol + numCols > 4);',
    '    if (!hasC && !hasD) return;',
    '',
    '    // \ube74\uc5b4\ud0ed \ub3d9\uc801 \ud0d0\uc0c9',
    '    var ss = SpreadsheetApp.getActiveSpreadsheet();',
    '    var viewerTab = ss.getSheetByName("\ub2e8\uac00\uc870\ud68c") || ss.getSheets()[0];',
    '    if (viewerTab.getName() === "\ubc1c\uc8fc \ubc0f \uc1a1\uc7a5\uc870\ud68c") {',
    '      var allTabs = ss.getSheets();',
    '      for (var t = 0; t < allTabs.length; t++) {',
    '        var tn = allTabs[t].getName();',
    '        if (tn.indexOf("\ube74\uc5b4") !== -1 || tn.indexOf("\ub2e8\uac00") !== -1) {',
    '          viewerTab = allTabs[t]; break;',
    '        }',
    '      }',
    '    }',
    '    var vLast = viewerTab.getLastRow();',
    '    if (vLast < 4) return;',
    '    var vData = viewerTab.getRange(4, 1, vLast - 3, 7).getValues();',
    '',
    '    // B\uc5f4 \uc8fc\ubb38\uc77c\uc790 \uc790\ub3d9\uae30\uc785',
    '    try {',
    '      var bcdData = sheet.getRange(row, 2, numRows, 3).getValues();',
    '      var todayYmd = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");',
    '      var bVals = [];',
    '      var bChanged = false;',
    '      for (var bi = 0; bi < bcdData.length; bi++) {',
    '        var curB = bcdData[bi][0];',
    '        var curC = String(bcdData[bi][1] || "").trim();',
    '        var curD = String(bcdData[bi][2] || "").trim();',
    '        if ((curC || curD) && !String(curB || "").trim()) {',
    '          curB = todayYmd;',
    '          bChanged = true;',
    '        }',
    '        bVals.push([curB]);',
    '      }',
    '      if (bChanged) sheet.getRange(row, 2, numRows, 1).setValues(bVals);',
    '    } catch (eDateFill) {}',
    '',
    '    // C~J\uc5f4\ub9cc \uc77d\uc74c (0=C\ucf54\ub4dc, 1=D\ud488\ubaa9\uba85, 7=J\uc801\uc694) - D\uc5f4\uacfc L\uc5f4\uc740 ARRAYFORMULA\uac00 \uc790\ub3d9 \uccacc\uc6b0\ubbc0\ub85c onEdit\uc5d0\uc11c \uc808\ub300 \ub36e\uc5b4\uc4f0\uc9c0 \uc54a\uc74c',
    '    var editRange = sheet.getRange(row, 3, numRows, 8);',
    '    var editData = editRange.getValues();',
    '    var jVals = [];',
    '    var isChanged = false;',
    '',
    '    for (var i = 0; i < numRows; i++) {',
    '      var inputCode = String(editData[i][0]).replace(/\\s/g, "");',
    '      var inputName = String(editData[i][1]).trim();',
    '      var jNow = String(editData[i][7] || "").trim();',
    '      var jNew = jNow;',
    '',
    '      if (!inputCode && !inputName) {',
    '        jVals.push([jNow]);',
    '        continue;',
    '      }',
    '',
    '      var finalName = "";',
    '      var foundStatus = "";',
    '',
    '      if (hasC && inputCode) {',
    '        for (var v = 0; v < vData.length; v++) {',
    '          if (String(vData[v][2]).replace(/\\s/g, "") === inputCode) {',
    '            finalName  = vData[v][3];',
    '            foundStatus = vData[v][0];',
    '            break;',
    '          }',
    '        }',
    '        ',
    '        if (inputCode && !finalName) {',
    '          if (jNow.indexOf("\ucf54\ub4dc\uc624류") === -1) {',
    '            jNew = "\\uD83D\\uDEA8\ucf54\ub4dc\uc624류";',
    '          }',
    '        } else if (foundStatus && (String(foundStatus).indexOf("\ud488\uc808") !== -1 || String(foundStatus).indexOf("\ub2e8\uc885") !== -1 || String(foundStatus).indexOf("\ud488\uc808\uc784\ubc15") !== -1 || String(foundStatus).indexOf("\uc7ac\uace0\uae4c\uc9c0\ub9cc") !== -1)) {',
    '          var warn = "\\uD83D\\uDEA8 " + foundStatus;',
    '          if (jNow !== warn) {',
    '            jNew = warn;',
    '          }',
    '        } else {',
    '          if (jNow.indexOf("\\uD83D\\uDEA8") !== -1) {',
    '            jNew = "";',
    '          }',
    '        }',
    '      }',
    '      ',
    '      if (jNew !== jNow) {',
    '        isChanged = true;',
    '      }',
    '      jVals.push([jNew]);',
    '    }',
    '',
    '    if (isChanged) {',
    '      sheet.getRange(row, 10, numRows, 1).setValues(jVals);',
    '    }',
    '  } catch (err) {}',
    '}'
  ].join('\n');

  // ── InvoiceMatch.gs: 사이드바 서버함수들 ──
  var invoiceGs = _pt_buildInvoiceMatchGsCode_();

  var manifest = JSON.stringify({
    timeZone: 'Asia/Seoul',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    runtimeVersion: 'V8',
    oauthScopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.container.ui',
      'https://www.googleapis.com/auth/script.external_request'
    ]
  });

  var payload = JSON.stringify({
    files: [
      { name: 'Code', type: 'SERVER_JS', source: codeGs },
      { name: 'InvoiceMatch', type: 'SERVER_JS', source: invoiceGs },
      { name: 'appsscript', type: 'JSON', source: manifest }
    ]
  });

  function put_(sid) {
    return UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + sid + '/content', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + oauthToken, 'Content-Type': 'application/json', Expect: '' },
      payload: payload, muteHttpExceptions: true
    });
  }

  if (savedId) {
    var r = put_(savedId);
    if (r.getResponseCode() === 200) return;
    if (r.getResponseCode() === 404 || r.getResponseCode() === 410) {
      props.deleteProperty(scriptKey); savedId = '';
    }
  }

  // 새 프로젝트 생성
  var cr = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + oauthToken, 'Content-Type': 'application/json', Expect: '' },
    payload: JSON.stringify({ title: 'Pack2U 송장매칭', parentId: sheetId }),
    muteHttpExceptions: true
  });
  if (cr.getResponseCode() !== 200) throw new Error('프로젝트 생성 실패: ' + cr.getContentText());

  var newId = JSON.parse(cr.getContentText()).scriptId;
  var ur = put_(newId);
  if (ur.getResponseCode() !== 200) throw new Error('코드 주입 실패: ' + ur.getContentText());

  props.setProperty(scriptKey, newId);
}

/** InvoiceMatch.gs 소스코드 문자열 반환
 *  ★ InvoiceMatch_협력업체용.gs의 소스코드를 가져와서 Script API로 주입
 */
function _pt_buildInvoiceMatchGsCode_() {
  // InvoiceMatch_협력업체용.gs에서 정의된 함수들의 소스를 toString()으로 가져옴
  var src = '// [협력업체] 카카오 송장번호 매칭 사이드바 (자동 설치됨)\n\n';
  src += 'function openInvoiceMatchSidebarLocal(){var html=HtmlService.createHtmlOutput(_getInvoiceMatchHtml_()).setTitle("📬 카카오 송장 매칭").setWidth(400);SpreadsheetApp.getUi().showSidebar(html)}\n\n';
  src += parseAndMatchInvoiceTextLocal.toString() + '\n\n';
  src += applyInvoiceMatchesLocal.toString() + '\n\n';
  src += _parseInvoicePairs_.toString() + '\n\n';
  src += ocrImageToTextLocal.toString() + '\n\n';
  src += 'function _getInvoiceMatchHtml_(){return ' + JSON.stringify(_getInvoiceMatchHtml_()) + '}\n';
  return src;
}


/** 파트너 파일용 사이드바 HTML (이미지 OCR 탭 포함) — InvoiceMatch_협력업체용.gs와 동일 */
function _pt_buildInvoiceMatchHtml_() {
  return _getInvoiceMatchHtml_();
}


/** 권한 인증용 디버그 함수 */
function authTrigger() {
  var files = _pt_listFiles();
  Logger.log("로드된 파일 개수: " + files.length);
}

/**
 * Script API 직접 호출 진단 함수
 * ★ GAS 편집기에서 직접 실행 → 로그(Ctrl+Enter)에서 오류 확인
 * 정확한 HTTP 상태코드 + 오류 내용을 출력합니다.
 */
function diagScriptApi() {
  try {
    var token = ScriptApp.getOAuthToken();
    Logger.log("✅ OAuth 토큰 발급 성공 (앞 20자): " + token.substring(0, 20) + "...");

    // ① Script API 활성화 여부 — projects.list 호출
    var listRes = UrlFetchApp.fetch(
      "https://script.googleapis.com/v1/projects?pageSize=1",
      {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true
      }
    );
    Logger.log("① Script API projects.list 응답코드: " + listRes.getResponseCode());
    Logger.log("  응답본문: " + listRes.getContentText().substring(0, 400));

    // ② 첫 번째 협력업체 파일로 프로젝트 생성 테스트
    var files = _pt_listFiles();
    if (files.length === 0) { Logger.log("❌ 협력업체 파일 없음"); return; }
    var testFile = files[0];
    Logger.log("② 테스트 파일: " + testFile.name + " (" + testFile.id + ")");

    var crRes = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Expect: "" },
      payload: JSON.stringify({ title: "_진단테스트_삭제가능", parentId: testFile.id }),
      muteHttpExceptions: true
    });
    Logger.log("② 프로젝트 생성 응답코드: " + crRes.getResponseCode());
    Logger.log("  응답본문: " + crRes.getContentText().substring(0, 400));

    if (crRes.getResponseCode() === 200) {
      var newScriptId = JSON.parse(crRes.getContentText()).scriptId;
      Logger.log("  생성된 scriptId: " + newScriptId);

      // ③ 생성된 테스트 프로젝트에 코드 주입 테스트
      var dummyPayload = JSON.stringify({
        files: [
          { name: "Code", type: "SERVER_JS", source: "function hello() { Logger.log('test'); }" },
          { name: "appsscript", type: "JSON", source: JSON.stringify({
            timeZone: "Asia/Seoul", dependencies: {},
            exceptionLogging: "STACKDRIVER", runtimeVersion: "V8",
            oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"]
          })}
        ]
      });
      var putRes = UrlFetchApp.fetch(
        "https://script.googleapis.com/v1/projects/" + newScriptId + "/content",
        {
          method: "PUT",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Expect: "" },
          payload: dummyPayload,
          muteHttpExceptions: true
        }
      );
      Logger.log("③ 코드 주입 응답코드: " + putRes.getResponseCode());
      Logger.log("  응답본문: " + putRes.getContentText().substring(0, 400));
    }

    Logger.log("=== 진단 완료 ===");
  } catch (e) {
    Logger.log("❌ 진단 중 예외 발생: " + e.message);
  }
}

/** 구글 런타임 오류 테스트용 단순 함수 */
function simpleAuth() {
  Logger.log("Hello World");
}

/** UI 대화상자 없이 즉시 일괄 배포를 진행하는 다이렉트 함수 */
function partnerInstallInvoiceMatchSidebarAllDirect() {
  try {
    var oauthToken = ScriptApp.getOAuthToken();
    var files = _pt_listFiles();
    var prefixToFile = _pep_buildPrefixToFileMap_(files);
    var ok = [], failed = [];

    for (var pfx in prefixToFile) {
      try {
        var ss = SpreadsheetApp.openById(prefixToFile[pfx].id);
        _pt_installInvoiceMatchScript_(ss, oauthToken);
        ok.push('[' + pfx + '] ' + prefixToFile[pfx].name);
        Utilities.sleep(1000); // 구글 API 보호용 1초 지연시간 추가
      } catch(e) {
        failed.push('[' + pfx + '] ' + e.message);
      }
    }
    Logger.log('✅ 설치 성공: ' + ok.length + '개, 실패: ' + failed.length + '개');
    if (failed.length > 0) Logger.log('❌ 실패 상세: ' + failed.join('\n'));
  } catch (err) {
    Logger.log('❌ 에러 발생: ' + err.message);
  }
}