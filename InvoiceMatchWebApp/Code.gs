/**
 * Pack2U 송장 매칭 Web App v5 (iframe 방식 — 재설치 불필요)
 * ★ 2026-06-22: doGet()이 전체 UI HTML 제공 → 업체 스크립트에는 5줄만 주입
 *   → 이후 UI/로직 수정 = 이 파일만 업데이트 (업체 재설치 영원히 불필요!)
 */

var _FOLDER_ID1 = "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl";
var _FOLDER_ID2 = "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v";
var _GEMINI_API_KEY = "";
var _GEMINI_MODEL = "gemini-2.0-flash";

// ═══════════════════════════════════════════════
//  doPost: API 엔드포인트 (분석/반영)
// ═══════════════════════════════════════════════
function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var action = String(req.action || "");
    var ssId = String(req.spreadsheetId || "");

    // ★ UI 로드: 보안 검증 전에 처리 (ssId 없어도 OK)
    if (action === "ui") {
      var webAppUrl = ScriptApp.getService().getUrl();
      var html = _buildSidebarHtml_(ssId, webAppUrl);
      return ContentService.createTextOutput(html).setMimeType(ContentService.MimeType.TEXT);
    }

    if (!ssId) return _jsonResp_({ error: "spreadsheetId 누락" });
    if (!_isValidVendorSheet_(ssId)) return _jsonResp_({ error: "유효하지 않은 시트입니다." });

    switch (action) {
      case "analyze": return _jsonResp_(_geminiParseAndMatch_(ssId, String(req.text || "")));
      case "apply":   return _jsonResp_(_applyMatches_(ssId, req.matches));
      default:        return _jsonResp_({ error: "알 수 없는 액션: " + action });
    }
  } catch (err) {
    return _jsonResp_({ error: "서버 오류: " + err.message });
  }
}

// ═══════════════════════════════════════════════
//  ★ doGet: 사이드바 전체 UI HTML 제공
// ═══════════════════════════════════════════════
function doGet(e) {
  var ssId = (e && e.parameter && e.parameter.ssId) || "";
  var webAppUrl = ScriptApp.getService().getUrl();
  var html = _buildSidebarHtml_(ssId, webAppUrl);
  return HtmlService.createHtmlOutput(html)
    .setTitle('\uD83D\uDCEC 카카오 송장 매칭')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _jsonResp_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function _isValidVendorSheet_(ssId) {
  try {
    var file = DriveApp.getFileById(ssId);
    var parents = file.getParents();
    while (parents.hasNext()) {
      var fid = parents.next().getId();
      if (fid === _FOLDER_ID1 || fid === _FOLDER_ID2) return true;
    }
    return file.getName().indexOf("[협력업체]") !== -1;
  } catch (e) { return false; }
}

// ═══════════════════════════════════════════════
//  사이드바 HTML (doGet에서 직접 제공)
// ═══════════════════════════════════════════════
function _buildSidebarHtml_(ssId, webAppUrl) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:"Segoe UI",sans-serif;background:#f7f8fa;color:#222;font-size:13px}' +
    '.hd{background:linear-gradient(135deg,#1a73e8,#0d47a1);color:#fff;padding:14px 16px;font-size:16px;font-weight:700}' +
    '.sc{padding:12px}' +
    'textarea{width:100%;height:130px;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:12px;resize:vertical;font-family:inherit}' +
    'textarea:focus{border-color:#1a73e8;outline:none;box-shadow:0 0 0 2px rgba(26,115,232,.15)}' +
    '.btn{display:block;width:100%;padding:10px;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;margin-top:8px;transition:all .2s}' +
    '.bb{background:#1a73e8;color:#fff}.bb:hover{background:#1557b0}.bb:disabled{background:#bbb}' +
    '.bg{background:#34a853;color:#fff}.bg:hover{background:#2d8e47}.bg:disabled{background:#bbb}' +
    '.bo{background:#ff9800;color:#fff}.bo:hover{background:#e68900}.bo:disabled{background:#bbb}' +
    'table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}' +
    'th{background:#f1f3f4;padding:6px 4px;text-align:left;font-weight:600}' +
    'td{padding:5px 4px;border-bottom:1px solid #eee}' +
    '.ok{color:#34a853}.err{color:#d93025}.tr{font-family:monospace;font-size:10px;word-break:break-all}' +
    '#rs{display:none;margin-top:8px}.sum{padding:10px;background:#e8f0fe;border-radius:6px;margin:8px 12px;font-size:12px}' +
    '#toast{display:none;position:fixed;bottom:12px;left:12px;right:12px;background:#323232;color:#fff;padding:10px 14px;border-radius:6px;font-size:12px;z-index:999;text-align:center}' +
    '.tab-bar{display:flex;gap:0;border-bottom:2px solid #1a73e8}' +
    '.tab-btn{flex:1;padding:8px;border:none;background:#e8f0fe;cursor:pointer;font-size:12px;font-weight:600;color:#1a73e8;transition:all .2s}' +
    '.tab-btn.active{background:#1a73e8;color:#fff}.tab-btn:hover:not(.active){background:#d2e3fc}' +
    '.tab-content{display:none}.tab-content.active{display:block}' +
    '.img-drop{border:2px dashed #bbb;padding:20px;border-radius:8px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s;min-height:100px}' +
    '.img-drop.dragover,.img-drop:hover{border-color:#1a73e8;background:#e8f0fe}' +
    '.img-drop.has-img{border-color:#34a853;background:#f6fff6}' +
    '.img-preview{max-width:100%;max-height:150px;border-radius:4px;margin-top:8px;border:1px solid #ddd}' +
    '</style></head><body>' +
    '<div class="hd">\uD83D\uDCEC 카카오 송장번호 매칭</div>' +
    '<div class="tab-bar">' +
    '<button class="tab-btn active" onclick="switchTab(\'text\')">\uD83D\uDCCB 텍스트/엑셀</button>' +
    '<button class="tab-btn" onclick="switchTab(\'image\')">\uD83D\uDDBC\uFE0F 이미지 OCR</button>' +
    '</div>' +
    '<div class="sc" style="border-radius:0 0 8px 8px;margin-top:0">' +
    '<div id="tab-text" class="tab-content active">' +
    '<div id="dropZone" style="margin-bottom:8px;border:2px dashed #ccc;padding:12px;border-radius:6px;background:#fafafa;text-align:center;cursor:pointer" onclick="document.getElementById(\'fileUpload\').click()">' +
    '<div style="font-size:13px;color:#555;margin-bottom:4px">\uD83D\uDCC2 엑셀 파일을 여기에 드래그 앤 드롭</div>' +
    '<div style="font-size:11px;color:#888">또는 클릭하여 파일 선택</div>' +
    '<input type="file" id="fileUpload" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleFileUpload(event)">' +
    '</div>' +
    '<textarea id="rt" placeholder="예시:\\n44363801252   최고갈비\\n443-8937-1622   임병혁"></textarea>' +
    '</div>' +
    '<div id="tab-image" class="tab-content">' +
    '<div id="imgDrop" class="img-drop" onclick="document.getElementById(\'imgUpload\').click()">' +
    '<div id="imgPh"><div style="font-size:22px;margin-bottom:6px">\uD83D\uDCF8</div>' +
    '<div style="font-size:13px;color:#555">이미지를 붙여넣기(Ctrl+V) 하거나</div>' +
    '<div style="font-size:13px;color:#555;margin-bottom:4px">드래그 앤 드롭 / 클릭하여 선택</div>' +
    '<div style="font-size:11px;color:#aaa">송장 목록 스크린샷을 넣으세요</div></div>' +
    '<input type="file" id="imgUpload" accept="image/*" style="display:none" onchange="handleImgFile(event)">' +
    '</div>' +
    '<div id="imgPrevArea" style="display:none;text-align:center;margin-top:8px">' +
    '<img id="imgPrev" class="img-preview">' +
    '<div id="ocrStatus" style="font-size:11px;color:#888;margin-top:4px"></div></div>' +
    '<button class="btn bo" id="ocrBtn" onclick="runOCR()" style="display:none">\uD83D\uDD0D 이미지에서 텍스트 추출</button>' +
    '</div>' +
    '<button class="btn bb" id="ab" onclick="analyze()">\uD83D\uDD0D 분석</button>' +
    '</div>' +
    '<div id="rs"><div class="sum" id="sum"></div>' +
    '<div class="sc" style="margin-bottom:8px">' +
    '<button class="btn bg" id="apb" onclick="applyAll()">\u2705 전용양식에 반영</button>' +
    '<table><thead><tr><th>이름</th><th>송장번호</th><th>행</th><th></th></tr></thead><tbody id="mt"></tbody></table>' +
    '</div></div><div id="toast"></div>' +
    '<input type="hidden" id="_ssId" value="' + ssId + '">' +
    '<input type="hidden" id="_webAppUrl" value="' + webAppUrl + '">' +
    '<input type="hidden" id="_ocrKey" value="' + _GEMINI_API_KEY + '">' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>' +
    '<script>' +
    'var _m=null,_imgB64=null;' +
    // toast
    'function toast(msg,ms){var el=document.getElementById("toast");el.textContent=msg;el.style.display="block";setTimeout(function(){el.style.display="none"},ms||2500)}' +
    // switchTab
    'function switchTab(t){document.querySelectorAll(".tab-btn").forEach(function(b,i){b.classList.toggle("active",(t==="text"&&i===0)||(t==="image"&&i===1))});' +
    'document.getElementById("tab-text").classList.toggle("active",t==="text");document.getElementById("tab-image").classList.toggle("active",t==="image")}' +
    // image handling
    'function handleImgData(b64){_imgB64=b64;document.getElementById("imgPrev").src=b64;document.getElementById("imgPrevArea").style.display="block";' +
    'document.getElementById("imgPh").style.display="none";document.getElementById("imgDrop").classList.add("has-img");document.getElementById("ocrBtn").style.display="block";' +
    'document.getElementById("ocrStatus").textContent="이미지 준비 완료"}' +
    'function handleImgFile(e){var f=e.target.files[0];if(!f||!f.type.startsWith("image/"))return;var r=new FileReader();r.onload=function(ev){handleImgData(ev.target.result)};r.readAsDataURL(f)}' +
    // paste
    'document.addEventListener("paste",function(e){var cd=e.clipboardData||window.clipboardData;if(!cd)return;var items=cd.items;' +
    'if(items){for(var i=0;i<items.length;i++){if(items[i].type.indexOf("image")!==-1){e.preventDefault();var f=items[i].getAsFile();' +
    'var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f);return}}}});' +
    // drag and drop
    'document.addEventListener("DOMContentLoaded",function(){' +
    'var iz=document.getElementById("imgDrop");' +
    'iz.addEventListener("dragover",function(e){e.preventDefault();e.stopPropagation();iz.classList.add("dragover")});' +
    'iz.addEventListener("dragleave",function(e){e.preventDefault();e.stopPropagation();iz.classList.remove("dragover")});' +
    'iz.addEventListener("drop",function(e){e.preventDefault();e.stopPropagation();iz.classList.remove("dragover");' +
    'var f=e.dataTransfer.files[0];if(f&&f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){handleImgData(ev.target.result)};r.readAsDataURL(f)}});' +
    'var dz=document.getElementById("dropZone");' +
    'dz.addEventListener("dragover",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#e8f0fe";dz.style.borderColor="#1a73e8"});' +
    'dz.addEventListener("dragleave",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#fafafa";dz.style.borderColor="#ccc"});' +
    'dz.addEventListener("drop",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#fafafa";dz.style.borderColor="#ccc";' +
    'if(e.dataTransfer.files&&e.dataTransfer.files.length>0){var f=e.dataTransfer.files[0];' +
    'if(f&&f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f)}' +
    'else{document.getElementById("fileUpload").files=e.dataTransfer.files;handleFileUpload({target:{files:e.dataTransfer.files}})}}})});' +
    // OCR
    'function runOCR(){if(!_imgB64)return toast("이미지를 먼저 붙여넣으세요",2000);' +
    'var btn=document.getElementById("ocrBtn");var st=document.getElementById("ocrStatus");' +
    'btn.disabled=true;btn.textContent="📡 OCR 처리 중...";st.textContent="Gemini Vision으로 분석 중...";' +
    'var apiKey=document.getElementById("_ocrKey").value;' +
    'if(!apiKey){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";st.textContent="❌ API 키 없음";return}' +
    'var mimeType="image/png";var rawB64=_imgB64;' +
    'if(_imgB64.indexOf(",")!==-1){var pp=_imgB64.split(",");var mmm=pp[0].match(/data:([^;]+)/);if(mmm)mimeType=mmm[1];rawB64=pp[1]}' +
    'var url="https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+apiKey;' +
    'var prompt="이 이미지에서 택배 수취인(받는사람) 이름과 택배 송장번호(10~14자리 숫자)를 추출.\\n"' +
    '+"사업자등록번호,전화번호,계좌번호 제외.\\n"' +
    '+"형식: 이름 송장번호 (공백구분, 한줄에 1쌍)\\n"' +
    '+"택배사명은 이름이 아님. 님 제거. 영문이름 포함.";' +
    'var payload={contents:[{parts:[{text:prompt},{inline_data:{mime_type:mimeType,data:rawB64}}]}],generationConfig:{temperature:0.1,maxOutputTokens:2048}};' +
    'fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})' +
    '.then(function(r){return r.json()})' +
    '.then(function(json){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";' +
    'if(json.error){st.textContent="❌ 오류: "+json.error.message;return}' +
    'var b3=String.fromCharCode(96,96,96);' +
    'var text=(json.candidates[0].content.parts[0].text||"").replace(new RegExp(b3+"[a-z]*\\\\n?","gi"),"").replace(new RegExp(b3,"g"),"").trim();' +
    'if(!text||text.length<3){st.textContent="❌ 텍스트를 인식하지 못했습니다.";return}' +
    'document.getElementById("rt").value=text;st.textContent="✅ "+text.split("\\n").length+"줄 추출 완료!";switchTab("text");toast("OCR 완료! 분석 버튼을 눌러주세요.",3000)})' +
    '.catch(function(e){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";st.textContent="❌ "+e.message})}' +
    // file upload
    'function handleFileUpload(e){var f=e.target.files[0];if(!f)return;' +
    'if(f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f);return}' +
    'var btn=document.getElementById("ab");btn.textContent="파일 읽는 중...";btn.disabled=true;' +
    'var reader=new FileReader();reader.onload=function(evt){var data=new Uint8Array(evt.target.result);' +
    'try{var wb=XLSX.read(data,{type:"array"});document.getElementById("rt").value=XLSX.utils.sheet_to_txt(wb.Sheets[wb.SheetNames[0]]);toast("엑셀 파일 로드 완료!",3000)}' +
    'catch(err){toast("파일 읽기 오류: "+err.message,4000)}finally{btn.textContent="🔍 분석";btn.disabled=false}};reader.readAsArrayBuffer(f)}' +
    // callWebApp
    'function _callWebApp(action,body,onOk,onErr){' +
    'var url=document.getElementById("_webAppUrl").value;' +
    'if(!url){onErr("Web App URL 미설정");return}' +
    'var ssId=document.getElementById("_ssId").value;' +
    'body.action=action;body.spreadsheetId=ssId;' +
    'fetch(url,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(body),redirect:"follow"})' +
    '.then(function(r){return r.json()})' +
    '.then(function(res){onOk(res)})' +
    '.catch(function(e){onErr(e.message||String(e))})}' +
    // analyze
    'function analyze(){var rt=document.getElementById("rt").value.trim();if(!rt)return toast("텍스트를 붙여넣으세요.",2000);' +
    'var btn=document.getElementById("ab");btn.disabled=true;btn.textContent="분석 중...";document.getElementById("rs").style.display="none";' +
    '_callWebApp("analyze",{text:rt},function(res){btn.disabled=false;btn.textContent="🔍 분석";' +
    'if(res.error){toast("❌ "+res.error,3000);return}_m=res.matches;showResults(res)},' +
    'function(err){btn.disabled=false;btn.textContent="🔍 분석";toast("오류: "+err,3000)})}' +
    // showResults
    'function showResults(res){var ok=(res.matches||[]).filter(function(m){return m.rows&&m.rows.length>0});' +
    'var no=res.unmatched||[];' +
    'document.getElementById("sum").innerHTML="<b>수취인 열:</b> "+res.recipientHeader+"&nbsp;|&nbsp;<span class=ok>✅ "+ok.length+"건</span>&nbsp;<span class=err>❌ "+no.length+"건</span>"' +
    '+(no.length>0&&res._debug_sheetNames?"<br><span style=font-size:10px;color:#aaa>시트 이름: "+res._debug_sheetNames.join(", ")+"</span>":"")' +
    '+(res._engine?"<br><span style=font-size:10px;color:#1a73e8>엔진: "+res._engine+"</span>":"");' +
    'var tb=document.getElementById("mt");tb.innerHTML="";' +
    'ok.forEach(function(m){var rn=m.rows.map(function(r){return r+2}).join(",");' +
    'var ns=m.name!==m.matchedName?m.name+"<span style=color:#aaa>≈</span>"+m.matchedName:m.name;' +
    'var st=m.append?"<span style=color:#f29900>➕추가</span>":"<span class=ok>✅</span>";' +
    'tb.innerHTML+="<tr><td>"+ns+"</td><td class=tr>"+m.tracking+"</td><td>"+rn+"</td><td>"+st+"</td></tr>"});' +
    'no.forEach(function(u){tb.innerHTML+="<tr><td class=err>"+u.name+"</td><td class=tr>"+u.tracking+"</td><td>-</td><td class=err>❌</td></tr>"});' +
    'document.getElementById("apb").style.display=ok.length?"block":"none";' +
    'document.getElementById("rs").style.display="block"}' +
    // applyAll
    'function applyAll(){if(!_m)return;var btn=document.getElementById("apb");btn.disabled=true;btn.textContent="반영 중...";' +
    '_callWebApp("apply",{matches:_m},function(res){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast(res.msg,3000)},' +
    'function(err){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast("오류: "+err,3000)})' +
    '}' +
    '</script></body></html>';
}

// ═══════════════════════════════════════════════
//  Gemini AI 기반 분석 + 매칭
// ═══════════════════════════════════════════════
function _geminiParseAndMatch_(ssId, rawText) {
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) { exTab = tabs[ti]; break; }
    }
    if (!exTab) return { error: "전용양식 탭 없음" };

    var lr = exTab.getLastRow();
    if (lr < 2) return { error: "전용양식 데이터 없음" };
    var lc = Math.max(exTab.getLastColumn(), 1);
    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];

    var KEYWORDS = ["받는분","받는사람","수령인","고객명","받으시는","수하인","수취인"];
    var EXCLUDE_KW = ["보내는","송하인","발화주","발신"];
    var recipientCol = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      var h = String(headers[hi] || "").replace(/\s/g, "");
      var excluded = false;
      for (var ei = 0; ei < EXCLUDE_KW.length; ei++) {
        if (h.indexOf(EXCLUDE_KW[ei]) !== -1) { excluded = true; break; }
      }
      if (excluded) continue;
      for (var ki = 0; ki < KEYWORDS.length; ki++) {
        if (h.indexOf(KEYWORDS[ki]) !== -1) { recipientCol = hi; break; }
      }
      if (recipientCol !== -1) break;
    }
    if (recipientCol === -1) return { error: "수취인 열 없음. 헤더: " + headers.slice(0, 8).join(", ") };

    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var nameToRows = {};
    var recipientList = [];
    for (var ri = 0; ri < data.length; ri++) {
      var rn = String(data[ri][recipientCol] || "").normalize("NFC").replace(/\s*님\s*$/g, "").trim();
      if (!rn) continue;
      if (!nameToRows[rn]) { nameToRows[rn] = []; recipientList.push(rn); }
      nameToRows[rn].push(ri);
    }
    if (recipientList.length === 0) return { error: "시트에 수취인 데이터 없음" };

    // Gemini 호출
    var geminiResult = _callGemini_(_buildPrompt_(rawText, recipientList));
    if (geminiResult.error) {
      Logger.log("[Gemini 실패] " + geminiResult.error + " → 폴백");
      return _fallbackMatch_(rawText, nameToRows, recipientCol, headers);
    }

    // 행 매핑
    var rowQueue = {};
    for (var qk in nameToRows) rowQueue[qk] = nameToRows[qk].slice();

    var matches = [], unmatched = [];
    var lastRowForName = {};
    var pairs = geminiResult.pairs || [];

    for (var gi = 0; gi < pairs.length; gi++) {
      var gp = pairs[gi];
      var tracking = String(gp.tracking || "").replace(/[-\s]/g, "").trim();
      var matchedName = String(gp.matched_name || "").trim();
      var parsedName = String(gp.name || "").trim();
      if (!tracking) continue;

      var assignedRows = [], isAppend = false;

      if (matchedName && rowQueue[matchedName] && rowQueue[matchedName].length > 0) {
        assignedRows = [rowQueue[matchedName].shift()];
        lastRowForName[matchedName] = assignedRows[0];
        if (parsedName) lastRowForName[parsedName] = assignedRows[0];
      } else if (matchedName && lastRowForName[matchedName] !== undefined) {
        assignedRows = [lastRowForName[matchedName]]; isAppend = true;
      } else if (parsedName && lastRowForName[parsedName] !== undefined) {
        assignedRows = [lastRowForName[parsedName]]; isAppend = true;
      }

      if (assignedRows.length > 0) {
        matches.push({ tracking: tracking, name: parsedName, matchedName: matchedName || parsedName, rows: assignedRows, append: isAppend });
      } else {
        unmatched.push({ tracking: tracking, name: parsedName || "(불명)" });
      }
    }

    return { matches: matches, unmatched: unmatched, recipientHeader: String(headers[recipientCol] || ""), total: pairs.length, _debug_sheetNames: recipientList.slice(0, 20), _engine: "gemini" };
  } catch (e) {
    return { error: e.message };
  }
}

function _buildPrompt_(rawText, recipientList) {
  return [
    "너는 택배 송장 매칭 전문가야.",
    "",
    "아래 텍스트는 카카오톡/문자/엑셀 등에서 복사한 택배 송장 정보야.",
    "규칙이나 순서가 일정하지 않을 수 있어.",
    "",
    "=== 입력 텍스트 ===",
    rawText,
    "=== 끝 ===",
    "",
    "=== 시트 수취인 목록 (매칭 대상) ===",
    recipientList.join(", "),
    "=== 끝 ===",
    "",
    "작업:",
    "1. 입력 텍스트에서 모든 '송장번호(운송장번호)' + '수취인(받는사람)' 쌍을 추출해.",
    "   - 송장번호: 10~14자리 숫자 (하이픈, 공백 포함 가능)",
    "   - 수취인: 사람 이름 (2~15자, 한글 또는 영문)",
    "   - 택배사명, 전화번호, 주소, 사업자번호 등은 무시",
    "",
    "2. 추출한 수취인을 '시트 수취인 목록'에서 가장 일치하는 이름과 매칭해.",
    "   - 완전 일치, '님' 제거 후 일치, 공백 차이, 오타 등 유연하게 처리",
    "   - 매칭 불가능하면 matched_name을 빈 문자열로",
    "",
    "3. 같은 수취인에게 여러 송장이 있으면 순서대로 모두 포함해.",
    "",
    "반드시 아래 JSON 형식으로만 응답해. 설명이나 마크다운 없이 순수 JSON만:",
    '{"pairs":[{"tracking":"송장번호","name":"텍스트에서 추출한 이름","matched_name":"시트 수취인 목록에서 매칭된 이름"}]}'
  ].join("\n");
}

function _callGemini_(prompt) {
  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + _GEMINI_MODEL +
              ":generateContent?key=" + _GEMINI_API_KEY;
    var payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    };
    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return { error: "Gemini " + resp.getResponseCode() };
    var json = JSON.parse(resp.getContentText());
    var text = (json.candidates[0].content.parts[0].text || "").trim()
      .replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    return JSON.parse(text);
  } catch (e) {
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════════
//  반영
// ═══════════════════════════════════════════════
function _applyMatches_(ssId, matches) {
  try {
    if (typeof matches === "string") matches = JSON.parse(matches);
    var ss = SpreadsheetApp.openById(ssId);
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) { exTab = tabs[ti]; break; }
    }
    if (!exTab) return { msg: "❌ 전용양식 탭 없음" };
    var lr = exTab.getLastRow();
    var lc = Math.max(exTab.getLastColumn(), 1);
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var writeCount = 0;
    for (var mi = 0; mi < matches.length; mi++) {
      var m = matches[mi];
      if (!m.rows) continue;
      for (var ri = 0; ri < m.rows.length; ri++) {
        var idx = m.rows[ri];
        if (idx >= 0 && idx < data.length) {
          var ex = String(data[idx][0] || "").trim();
          data[idx][0] = m.append && ex ? ex + "\n" + String(m.tracking) : String(m.tracking);
          data[idx][1] = "발송완료";
          writeCount++;
        }
      }
    }
    exTab.getRange(2, 1, data.length, lc).setValues(data);
    SpreadsheetApp.flush();
    return { msg: "✅ " + writeCount + "행에 송장번호 반영 완료" };
  } catch (e) {
    return { msg: "❌ " + e.message };
  }
}

// ═══════════════════════════════════════════════
//  폴백: 규칙 기반 매칭
// ═══════════════════════════════════════════════
function _fallbackMatch_(rawText, nameToRows, recipientCol, headers) {
  var rowQueue = {};
  for (var qk in nameToRows) rowQueue[qk] = nameToRows[qk].slice();
  var pairs = _parsePairs_(rawText);
  if (pairs.length === 0) return { error: "인식된 쌍 없음" };
  var matches = [], unmatched = [], lastRowForName = {};
  for (var pi = 0; pi < pairs.length; pi++) {
    var p = pairs[pi], queueKey = null, matchedName = p.name, assignedRows = [], isAppend = false;
    if (rowQueue[p.name] && rowQueue[p.name].length > 0) queueKey = p.name;
    if (!queueKey) { var ns = p.name.replace(/\s/g, ""); for (var nm in rowQueue) { if (rowQueue[nm].length > 0 && nm.replace(/\s/g, "") === ns) { queueKey = nm; matchedName = nm; break; } } }
    if (!queueKey) { for (var nm2 in rowQueue) { if (rowQueue[nm2].length > 0 && (nm2.indexOf(p.name) !== -1 || p.name.indexOf(nm2) !== -1)) { queueKey = nm2; matchedName = nm2; break; } } }
    if (queueKey && rowQueue[queueKey].length > 0) { assignedRows = [rowQueue[queueKey].shift()]; lastRowForName[queueKey] = assignedRows[0]; }
    else if (lastRowForName[p.name] !== undefined) { assignedRows = [lastRowForName[p.name]]; isAppend = true; }
    if (assignedRows.length > 0) matches.push({ tracking: p.tracking, name: p.name, matchedName: matchedName, rows: assignedRows, append: isAppend });
    else unmatched.push(p);
  }
  return { matches: matches, unmatched: unmatched, recipientHeader: String(headers[recipientCol] || ""), total: pairs.length, _debug_sheetNames: Object.keys(nameToRows).slice(0, 20), _engine: "fallback" };
}

function _parsePairs_(text) {
  var lines = text.replace(/[|｜\s]*(롯데택배|CJ대한통운|한진택배|우체국택배|로젠택배|경동택배|대신택배|일양로지스|천일택배|합동택배|건영택배|호남택배|CJ택배|택배)/gi, "")
    .split(/[\r\n]+/).map(function(l){return l.replace(/\t/g,"   ").trim()}).filter(function(l){return l.length>0});
  var pairs = [], pending = null;
  function ext(r){var d=r.trim().replace(/[-\s]/g,"");return/^\d{10,14}$/.test(d)?d:null}
  function cn(n){return n.replace(/[|｜\/]/g,"").replace(/\s*님\s*/g,"").trim()}
  function ok(n){return n&&n.length>=2&&!/^\d+$/.test(n)&&(/^[가-힣\s]{2,15}$/.test(n)||/^[A-Za-z\s]{2,30}$/.test(n)||(/[가-힣]/.test(n)&&n.length<=20))}
  for(var i=0;i<lines.length;i++){var l=lines[i],pts=l.split(/\s{2,}|\t+/),t=null,n=null;
    if(pts.length>=2){for(var j=0;j<pts.length;j++){var tt=ext(pts[j]);if(tt)t=tt;else{var c=cn(pts[j]);if(ok(c))n=c}}if(t&&n){pairs.push({tracking:t,name:n});continue}}
    var m=l.match(/^(.+?)\s+(\d[\d\s-]{8,}[\d])$/)||l.match(/^(\d[\d\s-]{8,}[\d])\s+(.+)$/);
    if(m){var mt=ext(m[2]||m[1]),mn=cn(m[1]||m[2]);if(mt&&ok(mn)){pairs.push({tracking:mt,name:mn});continue}}
    var to=ext(l);if(to){pending=to;continue}
    var fn=cn(l.replace(/^[\d\s.\-\/]+/,"").trim());if(ok(fn)&&pending){pairs.push({tracking:pending,name:fn});pending=null}}
  return pairs;
}
