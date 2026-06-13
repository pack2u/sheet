/**
 * ══════════════════════════════════════════════════════════
 *  [협력업체] 카카오 송장 매칭 사이드바 — 파트너 파일 설치
 *  Script API로 각 협력업체 파일에 직접 주입
 * ══════════════════════════════════════════════════════════
 */

/** 메뉴: 모든 협력업체 파일에 송장 매칭 사이드바 설치/갱신 */
function partnerInstallInvoiceMatchSidebarAll() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert(
    '📬 카카오 송장 매칭 사이드바 설치',
    '모든 협력업체 파일에 송장 매칭 사이드바를 설치합니다.\n\n' +
    '설치 후 각 협력업체 파일에서\n' +
    '메뉴 → "📬 송장 매칭 → 카카오 송장번호 입력"\n으로 사용할 수 있습니다.\n\n계속할까요?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var oauthToken = ScriptApp.getOAuthToken();
  var files = _pt_listFiles();
  var prefixToFile = _pep_buildPrefixToFileMap_(files);
  var ok = [], failed = [];

  for (var pfx in prefixToFile) {
    try {
      var ss = SpreadsheetApp.openById(prefixToFile[pfx].id);
      _pt_installInvoiceMatchScript_(ss, oauthToken);
      ok.push('[' + pfx + '] ' + prefixToFile[pfx].name);
    } catch(e) {
      failed.push('[' + pfx + '] ' + e.message);
    }
  }

  ui.alert(
    '✅ 설치 완료\n\n' +
    '성공: ' + ok.length + '개\n' +
    (failed.length > 0 ? '실패: ' + failed.join('\n') : '')
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
    '    if (sheet.getName() !== "발주 및 송장조회") return;',
    '    var r = e.range;',
    '    var startRow = r.getRow();',
    '    var rowCount = r.getNumRows();',
    '    var startCol = r.getColumn();',
    '    var colCount = r.getNumColumns();',
    '    if (startRow < 2 || rowCount <= 0) return;',
    '    var touchesC = startCol <= 3 && startCol + colCount > 3;',
    '    var touchesD = startCol <= 4 && startCol + colCount > 4;',
    '    if (!touchesC && !touchesD) return;',
    '    if (rowCount > 1000) return;',
    '    var bcd = sheet.getRange(startRow, 2, rowCount, 3).getValues();',
    '    var todayYmd = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");',
    '    var outB = []; var changed = false;',
    '    for (var i = 0; i < bcd.length; i++) {',
    '      var b = bcd[i][0]; var c = String(bcd[i][1]||"").trim(); var d = String(bcd[i][2]||"").trim();',
    '      if ((c||d) && !String(b||"").trim()) { b = todayYmd; changed = true; }',
    '      outB.push([b]);',
    '    }',
    '    if (changed) sheet.getRange(startRow, 2, rowCount, 1).setValues(outB);',
    '  } catch(err) {}',
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

/** InvoiceMatch.gs 소스코드 문자열 반환 */
function _pt_buildInvoiceMatchGsCode_() {
  return [
    '// [협력업체] 카카오 송장번호 매칭 사이드바 (자동 설치됨)',
    '',
    'function openInvoiceMatchSidebarLocal() {',
    '  var html = HtmlService.createHtmlOutput(_getInvoiceMatchHtml_())',
    '    .setTitle("📬 카카오 송장 매칭").setWidth(400);',
    '  SpreadsheetApp.getUi().showSidebar(html);',
    '}',
    '',
    'function parseAndMatchInvoiceTextLocal(rawText) {',
    '  try {',
    '    var ss = SpreadsheetApp.getActiveSpreadsheet();',
    '    var exTab = null;',
    '    var tabs = ss.getSheets();',
    '    for (var ti = 0; ti < tabs.length; ti++) {',
    '      if (tabs[ti].getName().indexOf("전용양식") !== -1) { exTab = tabs[ti]; break; }',
    '    }',
    '    if (!exTab) return { error: "전용양식 탭 없음" };',
    '    var lr = exTab.getLastRow();',
    '    if (lr < 2) return { error: "전용양식 데이터 없음" };',
    '    var lc = Math.max(exTab.getLastColumn(), 1);',
    '    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];',
    '    var KEYWORDS = ["받는분","받는사람","수령인","고객명","받으시는","수하인","수취인"];',
    '    var recipientCol = -1;',
    '    for (var hi = 0; hi < headers.length; hi++) {',
    '      var h = String(headers[hi]||"").replace(/\\s/g,"");',
    '      for (var ki = 0; ki < KEYWORDS.length; ki++) {',
    '        if (h.indexOf(KEYWORDS[ki]) !== -1) { recipientCol = hi; break; }',
    '      }',
    '      if (recipientCol !== -1) break;',
    '    }',
    '    if (recipientCol === -1) return { error: "수취인 열 없음. 헤더: " + headers.slice(0,8).join(", ") };',
    '    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();',
    '    var nameToRows = {};',
    '    for (var ri = 0; ri < data.length; ri++) {',
    '      var rn = String(data[ri][recipientCol]||"").trim();',
    '      if (!rn) continue;',
    '      if (!nameToRows[rn]) nameToRows[rn] = [];',
    '      nameToRows[rn].push(ri);',
    '    }',
    '    var rowQueue = {};',
    '    for (var qk in nameToRows) rowQueue[qk] = nameToRows[qk].slice();',
    '    var pairs = _parseInvoicePairs_(rawText);',
    '    if (pairs.length === 0) return { error: "인식된 쌍 없음. 형식: 송장번호   이름" };',
    '    var matches = [], unmatched = [], lastRowForName = {};',
    '    for (var pi = 0; pi < pairs.length; pi++) {',
    '      var p = pairs[pi];',
    '      var assignedRow = -1, matchedName = p.name, isAppend = false;',
    '      if (rowQueue[p.name] && rowQueue[p.name].length > 0) {',
    '        assignedRow = rowQueue[p.name].shift(); lastRowForName[p.name] = assignedRow;',
    '      } else if (lastRowForName[p.name] !== undefined) {',
    '        assignedRow = lastRowForName[p.name]; isAppend = true;',
    '      } else {',
    '        for (var nm in rowQueue) {',
    '          if (rowQueue[nm].length > 0 && (nm.indexOf(p.name)!==-1||p.name.indexOf(nm)!==-1)) {',
    '            matchedName = nm; assignedRow = rowQueue[nm].shift();',
    '            lastRowForName[nm] = assignedRow; lastRowForName[p.name] = assignedRow; break;',
    '          }',
    '        }',
    '        if (assignedRow === -1) {',
    '          for (var nm2 in lastRowForName) {',
    '            if (nm2.indexOf(p.name)!==-1||p.name.indexOf(nm2)!==-1) {',
    '              assignedRow = lastRowForName[nm2]; matchedName = nm2; isAppend = true; break;',
    '            }',
    '          }',
    '        }',
    '      }',
    '      if (assignedRow !== -1) {',
    '        matches.push({ tracking: p.tracking, name: p.name, matchedName: matchedName, rows: [assignedRow], append: isAppend });',
    '      } else { unmatched.push(p); }',
    '    }',
    '    return { matches: matches, unmatched: unmatched, recipientHeader: String(headers[recipientCol]||""), total: pairs.length };',
    '  } catch(e) { return { error: e.message }; }',
    '}',
    '',
    'function applyInvoiceMatchesLocal(matchesJson) {',
    '  try {',
    '    var matches = JSON.parse(matchesJson);',
    '    var ss = SpreadsheetApp.getActiveSpreadsheet();',
    '    var exTab = null;',
    '    var tabs = ss.getSheets();',
    '    for (var ti = 0; ti < tabs.length; ti++) {',
    '      if (tabs[ti].getName().indexOf("전용양식") !== -1) { exTab = tabs[ti]; break; }',
    '    }',
    '    if (!exTab) return { msg: "❌ 전용양식 탭 없음" };',
    '    var lr = exTab.getLastRow();',
    '    var lc = Math.max(exTab.getLastColumn(), 1);',
    '    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();',
    '    var writeCount = 0;',
    '    for (var mi = 0; mi < matches.length; mi++) {',
    '      var m = matches[mi]; if (!m.rows) continue;',
    '      for (var ri = 0; ri < m.rows.length; ri++) {',
    '        var idx = m.rows[ri];',
    '        if (idx >= 0 && idx < data.length) {',
    '          var ex = String(data[idx][0]||"").trim();',
    '          data[idx][0] = (m.append && ex) ? ex + "\\n" + String(m.tracking) : String(m.tracking);',
    '          data[idx][1] = "발송완료";',
    '          writeCount++;',
    '        }',
    '      }',
    '    }',
    '    exTab.getRange(2, 1, data.length, lc).setValues(data);',
    '    SpreadsheetApp.flush();',
    '    return { msg: "✅ " + writeCount + "행에 송장번호 반영 완료" };',
    '  } catch(e) { return { msg: "❌ " + e.message }; }',
    '}',
    '',
    'function _parseInvoicePairs_(text) {',
    '  var lines = text.split(/[\\r\\n]+/).map(function(l){return l.replace(/\\t/g,"   ").trim();}).filter(function(l){return l.length>0;});',
    '  var pairs = [], pendingTracking = null;',
    '  function _ext(raw){ var d=raw.replace(/[\\-\\s]/g,""); return /^\\d{10,14}$/.test(d)?d:null; }',
    '  for (var i = 0; i < lines.length; i++) {',
    '    var line = lines[i];',
    '    var m1 = line.match(/^([\\d\\-]{10,20})\\s{1,}(.+)$/);',
    '    if (m1) { var t1=_ext(m1[1]); var n1=m1[2].trim(); if (t1&&n1.length>=1) { pairs.push({tracking:t1,name:n1}); pendingTracking=null; continue; } }',
    '    var m2 = line.match(/^(.+?)\\s{1,}([\\d\\-]{10,20})$/);',
    '    if (m2) { var t2=_ext(m2[2]); var n2=m2[1].trim(); if (t2&&n2.length>=1&&!/^[\\d\\-]+$/.test(n2)) { pairs.push({tracking:t2,name:n2}); pendingTracking=null; continue; } }',
    '    var solo=_ext(line); if (solo&&/^[\\d\\-]+$/.test(line.trim())) { pendingTracking=solo; continue; }',
    '    if (line.length>=1&&!/^[\\d\\-]+$/.test(line)) {',
    '      if (pendingTracking!==null) { pairs.push({tracking:pendingTracking,name:line}); pendingTracking=null; }',
    '    }',
    '  }',
    '  return pairs;',
    '}',
    '',
    'function _getInvoiceMatchHtml_() {',
    '  return ' + JSON.stringify(_pt_buildInvoiceMatchHtml_()),
    '}'
  ].join('\n');
}

/** 파트너 파일용 사이드바 HTML (인라인, 업체 선택 없음) */
function _pt_buildInvoiceMatchHtml_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    '* { box-sizing: border-box; margin: 0; padding: 0; }' +
    'body { font-family: "Apple SD Gothic Neo","Malgun Gothic",sans-serif; font-size: 13px; background: #f0f2f5; display: flex; flex-direction: column; height: 100vh; }' +
    '.header { background: #1a73e8; color: white; padding: 12px 16px; font-size: 15px; font-weight: bold; flex-shrink: 0; }' +
    '.section { background: white; margin: 8px 8px 0; border-radius: 8px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }' +
    '.st { font-size: 11px; font-weight: bold; color: #888; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }' +
    'textarea { width: 100%; height: 110px; border: 1px solid #ddd; border-radius: 6px; padding: 8px; font-size: 12px; font-family: monospace; resize: none; }' +
    '.btn { width: 100%; padding: 9px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; margin-top: 8px; transition: .15s; }' +
    '.bb { background: #1a73e8; color: white; } .bb:hover { background: #1558b0; }' +
    '.bg { background: #34a853; color: white; } .bg:hover { background: #2d8f46; }' +
    '.btn:disabled { background: #ccc; cursor: not-allowed; }' +
    '#rs { flex: 1; overflow-y: auto; display: none; }' +
    '.sum { margin: 8px; background: white; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #444; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }' +
    'table { width: 100%; border-collapse: collapse; font-size: 12px; }' +
    'th { background: #f8f9fa; padding: 6px 8px; text-align: left; font-size: 11px; color: #666; }' +
    'td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }' +
    '.ok { color: #34a853; font-weight: bold; } .err { color: #ea4335; font-weight: bold; }' +
    '.tr { font-size: 11px; color: #555; font-family: monospace; }' +
    '#toast { display: none; position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #333; color: white; padding: 8px 18px; border-radius: 20px; font-size: 12px; z-index: 999; }' +
    '</style><script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"><\/script></head><body>' +
    '<div class="header">📬 카카오 송장번호 매칭</div>' +
    '<div class="section"><div class="st">송장 데이터 입력 (붙여넣기 또는 엑셀 업로드)</div>' +
    '<div id="dropZone" style="margin-bottom: 8px; border: 2px dashed #ccc; padding: 12px; border-radius: 6px; background: #fafafa; text-align: center; cursor: pointer; transition: 0.2s;" onclick="document.getElementById(\'fileUpload\').click()">' +
    '<div style="font-size: 13px; color: #555; margin-bottom: 4px;">📂 엑셀 파일을 여기에 드래그 앤 드롭 하세요</div>' +
    '<div style="font-size: 11px; color: #888;">또는 클릭하여 파일 선택</div>' +
    '<input type="file" id="fileUpload" accept=".xlsx, .xls, .csv" style="display: none;" onchange="handleFileUpload(event)">' +
    '</div><div style="font-size: 10px; color: #888; margin-bottom: 8px;">※ 엑셀 파일은 \'이름\', \'송장번호\' 열만 남겨두시면 인식률이 가장 높습니다.</div>' +
    '<textarea id="rt" placeholder="예시:&#10;44363801252   최고갈비&#10;44363801263   송주용"></textarea>' +
    '<button class="btn bb" id="ab" onclick="analyze()">🔍 분석</button></div>' +
    '<div id="rs"><div class="sum" id="sum"></div>' +
    '<div class="section" style="margin-bottom:8px;">' +
    '<button class="btn bg" id="apb" onclick="applyAll()">✅ 전용양식에 반영</button>' +
    '<table><thead><tr><th>이름</th><th>송장번호</th><th>행</th><th></th></tr></thead><tbody id="mt"></tbody></table>' +
    '</div></div><div id="toast"></div>' +
    '<script>var _m=null;' +
    'function toast(msg,ms){var el=document.getElementById("toast");el.textContent=msg;el.style.display="block";setTimeout(function(){el.style.display="none";},ms||2500);}' +
    'document.addEventListener("DOMContentLoaded", function() {' +
    '  var dz = document.getElementById("dropZone");' +
    '  dz.addEventListener("dragover", function(e) { e.preventDefault(); e.stopPropagation(); dz.style.background = "#e8f0fe"; dz.style.borderColor = "#1a73e8"; });' +
    '  dz.addEventListener("dragleave", function(e) { e.preventDefault(); e.stopPropagation(); dz.style.background = "#fafafa"; dz.style.borderColor = "#ccc"; });' +
    '  dz.addEventListener("drop", function(e) {' +
    '    e.preventDefault(); e.stopPropagation(); dz.style.background = "#fafafa"; dz.style.borderColor = "#ccc";' +
    '    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {' +
    '      document.getElementById("fileUpload").files = e.dataTransfer.files;' +
    '      handleFileUpload({ target: { files: e.dataTransfer.files } });' +
    '    }' +
    '  });' +
    '});' +
    'function handleFileUpload(e) {' +
    '  var file = e.target.files[0]; if (!file) return;' +
    '  var btn = document.getElementById("ab"); btn.textContent = "파일 읽는 중..."; btn.disabled = true;' +
    '  var reader = new FileReader();' +
    '  reader.onload = function(evt) {' +
    '    var data = new Uint8Array(evt.target.result);' +
    '    try {' +
    '      var wb = XLSX.read(data, {type: "array"});' +
    '      var ws = wb.Sheets[wb.SheetNames[0]];' +
    '      document.getElementById("rt").value = XLSX.utils.sheet_to_txt(ws);' +
    '      toast("엑셀 파일 로드 완료! 분석을 눌러주세요.", 3000);' +
    '    } catch(err) { toast("파일 읽기 오류: " + err.message, 4000); }' +
    '    finally { btn.textContent = "🔍 분석"; btn.disabled = false; }' +
    '  };' +
    '  reader.readAsArrayBuffer(file);' +
    '}' +
    'function analyze(){var rt=document.getElementById("rt").value.trim();if(!rt)return toast("텍스트를 붙여넣으세요.",2000);' +
    'var btn=document.getElementById("ab");btn.disabled=true;btn.textContent="분석 중...";document.getElementById("rs").style.display="none";' +
    'google.script.run.withSuccessHandler(function(res){btn.disabled=false;btn.textContent="🔍 분석";' +
    'if(res.error){toast("❌ "+res.error,3000);return;}_m=res.matches;showResults(res);})' +
    '.withFailureHandler(function(e){btn.disabled=false;btn.textContent="🔍 분석";toast("오류: "+e.message,3000);})\n' +
    '.parseAndMatchInvoiceTextLocal(rt);}' +
    'function showResults(res){var matched=(res.matches||[]).filter(function(m){return m.rows&&m.rows.length>0;});' +
    'var unmatched=res.unmatched||[];' +
    'document.getElementById("sum").innerHTML="<b>수취인 열:</b> "+res.recipientHeader+"&nbsp;|&nbsp;<span class=ok>✅ "+matched.length+"건</span>&nbsp;<span class=err>❌ "+unmatched.length+"건</span>";' +
    'var tb=document.getElementById("mt");tb.innerHTML="";' +
    'matched.forEach(function(m){var rn=m.rows.map(function(r){return r+2;}).join(",");' +
    'var ns=m.name!==m.matchedName?m.name+"≈"+m.matchedName:m.name;' +
    'var st=m.append?"<span style=color:#f29900>➕추가</span>":"<span class=ok>✅</span>";' +
    'tb.innerHTML+="<tr><td>"+ns+"</td><td class=tr>"+m.tracking+"</td><td>"+rn+"</td><td>"+st+"</td></tr>";});' +
    'unmatched.forEach(function(u){tb.innerHTML+="<tr><td class=err>"+u.name+"</td><td class=tr>"+u.tracking+"</td><td>-</td><td class=err>❌</td></tr>";});' +
    'document.getElementById("apb").style.display=matched.length?"block":"none";' +
    'document.getElementById("rs").style.display="block";}' +
    'function applyAll(){if(!_m)return;var btn=document.getElementById("apb");btn.disabled=true;btn.textContent="반영 중...";' +
    'google.script.run.withSuccessHandler(function(res){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast(res.msg,3000);})' +
    '.withFailureHandler(function(e){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast("오류: "+e.message,3000);})\n' +
    '.applyInvoiceMatchesLocal(JSON.stringify(_m));}<\/script></body></html>';
}
