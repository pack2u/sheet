// ============================================================
//  [협력업체] 카카오 송장번호 매칭 사이드바
//  ▶ 사용법: 이 파일 전체를 각 협력업체 GAS 프로젝트에
//            새 파일(InvoiceMatch.gs)로 붙여넣기
//  ★ Gemini Vision OCR 지원 (이미지 테이블 행 단위 추출)
// ============================================================

function onOpen_copy_paste() { // 복사하여 사용할 때는 onOpen()으로 변경하세요.
  var ui = SpreadsheetApp.getUi();
  // 기존 CS 챗봇 메뉴
  ui.createMenu('🤖 고객센터 챗봇')
    .addItem('채팅창 열기', 'showChatbotSidebar')
    .addToUi();
  // 송장 매칭 메뉴
  SpreadsheetApp.getActiveSpreadsheet()
    .addMenu('📬 송장 매칭', [
      { name: '카카오 송장번호 입력', functionName: 'openInvoiceMatchSidebarLocal' }
    ]);
}

function openInvoiceMatchSidebarLocal() {
  var html = HtmlService.createHtmlOutput(_getInvoiceMatchHtml_())
    .setTitle('📬 카카오 송장 매칭')
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ── 서버: 텍스트 파싱 + 전용양식 매칭 ──
function parseAndMatchInvoiceTextLocal(rawText) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 전용양식 탭 탐색
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf('전용양식') !== -1) { exTab = tabs[ti]; break; }
    }
    if (!exTab) return { error: '전용양식 탭 없음' };

    var lr = exTab.getLastRow();
    if (lr < 2) return { error: '전용양식 데이터 없음' };
    var lc = Math.max(exTab.getLastColumn(), 1);
    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];

    // 수취인 열 자동 탐지
    var KEYWORDS = ['받는분','받는사람','수령인','고객명','받으시는','수하인','수취인'];
    var recipientCol = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      var h = String(headers[hi] || '').replace(/\s/g, '');
      for (var ki = 0; ki < KEYWORDS.length; ki++) {
        if (h.indexOf(KEYWORDS[ki]) !== -1) { recipientCol = hi; break; }
      }
      if (recipientCol !== -1) break;
    }
    if (recipientCol === -1) return { error: '수취인 열 없음. 헤더: ' + headers.slice(0, 8).join(', ') };

    // 이름 → 행 큐 맵 구성
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var nameToRows = {};
    for (var ri = 0; ri < data.length; ri++) {
      var rn = String(data[ri][recipientCol] || '').trim();
      if (!rn) continue;
      if (!nameToRows[rn]) nameToRows[rn] = [];
      nameToRows[rn].push(ri);
    }
    var rowQueue = {};
    for (var qk in nameToRows) rowQueue[qk] = nameToRows[qk].slice();

    // 파싱
    var pairs = _parseInvoicePairs_(rawText);
    if (pairs.length === 0) return { error: '인식된 쌍 없음. 형식: 송장번호   이름' };

    // 매칭 (행 큐 방식: 같은 이름 여러 번 → 순서대로 다른 행, 큐 소진시 이어붙이기)
    var matches = [], unmatched = [], lastRowForName = {};
    for (var pi = 0; pi < pairs.length; pi++) {
      var p = pairs[pi];
      var assignedRow = -1, matchedName = p.name, isAppend = false;

      if (rowQueue[p.name] && rowQueue[p.name].length > 0) {
        assignedRow = rowQueue[p.name].shift();
        lastRowForName[p.name] = assignedRow;
      } else if (lastRowForName[p.name] !== undefined) {
        assignedRow = lastRowForName[p.name];
        isAppend = true;
      } else {
        for (var nm in rowQueue) {
          if (rowQueue[nm].length > 0 &&
              (nm.indexOf(p.name) !== -1 || p.name.indexOf(nm) !== -1)) {
            matchedName = nm;
            assignedRow = rowQueue[nm].shift();
            lastRowForName[nm] = assignedRow;
            lastRowForName[p.name] = assignedRow;
            break;
          }
        }
        if (assignedRow === -1) {
          for (var nm2 in lastRowForName) {
            if (nm2.indexOf(p.name) !== -1 || p.name.indexOf(nm2) !== -1) {
              assignedRow = lastRowForName[nm2]; matchedName = nm2; isAppend = true; break;
            }
          }
        }
      }

      if (assignedRow !== -1) {
        matches.push({ tracking: p.tracking, name: p.name, matchedName: matchedName, rows: [assignedRow], append: isAppend });
      } else {
        unmatched.push(p);
      }
    }

    return {
      matches: matches,
      unmatched: unmatched,
      recipientHeader: String(headers[recipientCol] || ''),
      total: pairs.length
    };
  } catch(e) { return { error: e.message }; }
}

// ── 서버: 전용양식에 반영 ──
function applyInvoiceMatchesLocal(matchesJson) {
  try {
    var matches = JSON.parse(matchesJson);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf('전용양식') !== -1) { exTab = tabs[ti]; break; }
    }
    if (!exTab) return { msg: '❌ 전용양식 탭 없음' };

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
          var ex = String(data[idx][0] || '').trim();
          data[idx][0] = (m.append && ex) ? ex + '\n' + String(m.tracking) : String(m.tracking);
          data[idx][1] = '발송완료';
          writeCount++;
        }
      }
    }
    exTab.getRange(2, 1, data.length, lc).setValues(data);
    SpreadsheetApp.flush();
    return { msg: '✅ ' + writeCount + '행에 송장번호 반영 완료' };
  } catch(e) { return { msg: '❌ ' + e.message }; }
}

// ── 텍스트 파서 (택배사명 제거 + 테이블 구조 복원) ──
function _parseInvoicePairs_(text) {
  // ★ 택배사명 제거
  var COURIER = /[|｜\s]*(롯데택배|CJ대한통운|한진택배|우체국택배|로젠택배|경동택배|대신택배|일양로지스|천일택배|합동택배|건영택배|호남택배|CVSnet|GSpostbox|CJ택배|택배)/gi;
  text = text.replace(COURIER, "");

  var lines = text.split(/[\r\n]+/)
    .map(function(l) { return l.replace(/\t/g, '   ').trim(); })
    .filter(function(l) { return l.length > 0; });
  var pairs = [], pending = null;
  var trackingLines = [], nameLines = [], pairedLines = [];

  function _ext(raw) {
    var d = raw.replace(/[-\s]/g, '');
    return /^\d{10,14}$/.test(d) ? d : null;
  }
  function _clean(n) {
    return n.replace(/[|｜]/g, "").replace(/\s*님\s*/g, "").trim();
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m1 = line.match(/^([\d\-]{10,20})\s{1,}(.+)$/);
    if (m1) {
      var t1 = _ext(m1[1]); var n1 = _clean(m1[2]);
      if (t1 && n1.length >= 2) { pairedLines.push({ tracking: t1, name: n1 }); continue; }
      else if (t1) { trackingLines.push(t1); continue; }
    }
    var m2 = line.match(/^(.+?)\s{1,}([\d\-]{10,20})$/);
    if (m2) {
      var t2 = _ext(m2[2]); var n2 = _clean(m2[1]);
      if (t2 && n2.length >= 2 && !/^[\d\-]+$/.test(n2)) { pairedLines.push({ tracking: t2, name: n2 }); continue; }
      else if (t2) { trackingLines.push(t2); continue; }
    }
    var solo = _ext(line);
    if (solo && /^[\d\-]+$/.test(line.trim())) { trackingLines.push(solo); continue; }
    // 이름 추출 (복수 이름 분리)
    var nameCandidates = line.split(/\s{2,}/);
    for (var ni = 0; ni < nameCandidates.length; ni++) {
      var nc = _clean(nameCandidates[ni]);
      if (nc.length >= 2 && /^[가-힣\s]{2,10}$/.test(nc)) { nameLines.push(nc); }
    }
  }

  for (var pi2 = 0; pi2 < pairedLines.length; pi2++) pairs.push(pairedLines[pi2]);

  if (trackingLines.length > 0 && nameLines.length > 0) {
    var mc = Math.min(trackingLines.length, nameLines.length);
    for (var mi2 = 0; mi2 < mc; mi2++) pairs.push({ tracking: trackingLines[mi2], name: nameLines[mi2] });
  } else if (trackingLines.length > 0) {
    pending = null;
    for (var fi = 0; fi < lines.length; fi++) {
      var fLine = lines[fi]; var ft = _ext(fLine);
      if (ft && /^[\d\-]+$/.test(fLine.trim())) { pending = ft; continue; }
      var fn = _clean(fLine);
      if (fn.length >= 2 && !/^[\d\-]+$/.test(fn) && pending) { pairs.push({ tracking: pending, name: fn }); pending = null; }
    }
  }
  return pairs;
}

// ── Gemini Vision OCR (이미지 → 이름+송장번호 추출) ──
function ocrImageToTextLocal(base64Data) {
  try {
    var mimeType = "image/png";
    var rawB64 = base64Data;
    if (base64Data.indexOf(",") !== -1) {
      var parts = base64Data.split(",");
      var mm = parts[0].match(/data:([^;]+)/);
      if (mm) mimeType = mm[1];
      rawB64 = parts[1];
    }

    // Gemini API 키 — 중앙 허브와 동일
    var apiKey = "AIzaSyA9O-Dh3SDsMSK7OVHQQ2BG9INiFcgXCB0";
    var model = "gemini-2.5-flash-lite";
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      model + ":generateContent?key=" + apiKey;

    var prompt =
      "이 이미지는 택배 송장번호 목록 테이블입니다.\n" +
      "테이블에서 **받는사람(수취인) 이름**과 **송장번호(운송장번호, 10~14자리 숫자)**를 추출해주세요.\n\n" +
      "규칙:\n" +
      "1. 반드시 테이블의 각 **행(row)**을 하나씩 읽어주세요. 열(column) 단위로 읽지 마세요.\n" +
      "2. 출력 형식: 한 줄에 '이름 송장번호' (공백으로 구분)\n" +
      "3. '보내는사람/발송인' 열은 무시하고, '받는사람/수취인/수령인' 열의 이름만 추출하세요.\n" +
      "4. 택배사명(롯데택배, CJ대한통운 등)은 출력하지 마세요.\n" +
      "5. 이름 뒤의 '님'은 제거하세요.\n" +
      "6. 다른 설명 없이 오직 '이름 송장번호' 형식만 출력하세요.\n\n" +
      "예시 출력:\n홍길동 1234567890\n김철수 9876543210";

    var payload = {
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: rawB64 } }
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    };

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var json = JSON.parse(resp.getContentText());
    if (json.error) throw new Error(json.error.message);

    var text = json.candidates[0].content.parts[0].text || "";
    text = text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
    return text || "";
  } catch (e) {
    throw new Error("이미지 분석 실패: " + e.message);
  }
}

// ── 인라인 HTML 사이드바 (이미지 OCR 탭 포함) ──
function _getInvoiceMatchHtml_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:13px;background:#f0f2f5;display:flex;flex-direction:column;height:100vh}' +
    '.hd{background:#1a73e8;color:white;padding:12px 16px;font-size:15px;font-weight:bold;flex-shrink:0}' +
    '.sc{background:white;margin:8px 8px 0;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)}' +
    '.st{font-size:11px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}' +
    'textarea{width:100%;height:110px;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:12px;font-family:monospace;resize:none}' +
    '.btn{width:100%;padding:9px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;margin-top:8px;transition:.15s}' +
    '.bb{background:#1a73e8;color:white}.bb:hover{background:#1558b0}' +
    '.bg{background:#34a853;color:white}.bg:hover{background:#2d8f46}' +
    '.bo{background:#f29900;color:white}.bo:hover{background:#d88a00}' +
    '.btn:disabled{background:#ccc;cursor:not-allowed}' +
    '#rs{flex:1;overflow-y:auto;display:none}' +
    '.sum{margin:8px;background:white;border-radius:8px;padding:10px 12px;font-size:12px;color:#444;box-shadow:0 1px 3px rgba(0,0,0,.1)}' +
    'table{width:100%;border-collapse:collapse;font-size:12px}' +
    'th{background:#f8f9fa;padding:6px 8px;text-align:left;font-size:11px;color:#666}' +
    'td{padding:5px 8px;border-bottom:1px solid #f0f0f0}' +
    '.ok{color:#34a853;font-weight:bold}.err{color:#ea4335;font-weight:bold}' +
    '.tr{font-size:11px;color:#555;font-family:monospace}' +
    '#toast{display:none;position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:8px 18px;border-radius:20px;font-size:12px;z-index:999}' +
    '.tab-bar{display:flex;margin:8px 8px 0;gap:2px}' +
    '.tab-btn{flex:1;padding:8px 4px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:12px;font-weight:bold;background:#e0e0e0;color:#666;transition:.15s}' +
    '.tab-btn.active{background:white;color:#1a73e8;box-shadow:0 -1px 3px rgba(0,0,0,.1)}' +
    '.tab-content{display:none}.tab-content.active{display:block}' +
    '.img-drop{border:2px dashed #ccc;padding:16px;border-radius:6px;background:#fafafa;text-align:center;cursor:pointer;transition:.2s;min-height:80px}' +
    '.img-drop.dragover{background:#e8f0fe;border-color:#1a73e8}' +
    '.img-drop.has-img{border-color:#34a853;background:#f6fff6}' +
    '.img-preview{max-width:100%;max-height:150px;border-radius:4px;margin-top:8px;border:1px solid #ddd}' +
    '</style><script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"><\\/script></head><body>' +
    '<div class="hd">📬 카카오 송장번호 매칭</div>' +
    '<div class="tab-bar">' +
    '<button class="tab-btn active" onclick="switchTab(\'text\')">📋 텍스트/엑셀</button>' +
    '<button class="tab-btn" onclick="switchTab(\'image\')">🖼️ 이미지 OCR</button>' +
    '</div>' +
    '<div class="sc" style="border-radius:0 0 8px 8px;margin-top:0">' +
    '<div id="tab-text" class="tab-content active">' +
    '<div id="dropZone" style="margin-bottom:8px;border:2px dashed #ccc;padding:12px;border-radius:6px;background:#fafafa;text-align:center;cursor:pointer" onclick="document.getElementById(\'fileUpload\').click()">' +
    '<div style="font-size:13px;color:#555;margin-bottom:4px">📂 엑셀 파일을 여기에 드래그 앤 드롭</div>' +
    '<div style="font-size:11px;color:#888">또는 클릭하여 파일 선택</div>' +
    '<input type="file" id="fileUpload" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleFileUpload(event)">' +
    '</div>' +
    '<textarea id="rt" placeholder="예시:\\n44363801252   최고갈비\\n443-8937-1622   임병혁"></textarea>' +
    '</div>' +
    '<div id="tab-image" class="tab-content">' +
    '<div id="imgDrop" class="img-drop" onclick="document.getElementById(\'imgUpload\').click()">' +
    '<div id="imgPh"><div style="font-size:22px;margin-bottom:6px">📸</div>' +
    '<div style="font-size:13px;color:#555">이미지를 붙여넣기(Ctrl+V) 하거나</div>' +
    '<div style="font-size:13px;color:#555;margin-bottom:4px">드래그 앤 드롭 / 클릭하여 선택</div>' +
    '<div style="font-size:11px;color:#aaa">송장 목록 스크린샷을 넣으세요</div></div>' +
    '<input type="file" id="imgUpload" accept="image/*" style="display:none" onchange="handleImgFile(event)">' +
    '</div>' +
    '<div id="imgPrevArea" style="display:none;text-align:center;margin-top:8px">' +
    '<img id="imgPrev" class="img-preview">' +
    '<div id="ocrStatus" style="font-size:11px;color:#888;margin-top:4px"></div></div>' +
    '<button class="btn bo" id="ocrBtn" onclick="runOCR()" style="display:none">🔍 이미지에서 텍스트 추출</button>' +
    '</div>' +
    '<button class="btn bb" id="ab" onclick="analyze()">🔍 분석</button>' +
    '</div>' +
    '<div id="rs"><div class="sum" id="sum"></div>' +
    '<div class="sc" style="margin-bottom:8px">' +
    '<button class="btn bg" id="apb" onclick="applyAll()">✅ 전용양식에 반영</button>' +
    '<table><thead><tr><th>이름</th><th>송장번호</th><th>행</th><th></th></tr></thead><tbody id="mt"></tbody></table>' +
    '</div></div><div id="toast"></div>' +
    '<script>var _m=null,_imgB64=null;' +
    'function toast(msg,ms){var el=document.getElementById("toast");el.textContent=msg;el.style.display="block";setTimeout(function(){el.style.display="none"},ms||2500)}' +
    'function switchTab(t){document.querySelectorAll(".tab-btn").forEach(function(b,i){b.classList.toggle("active",(t==="text"&&i===0)||(t==="image"&&i===1))});' +
    'document.getElementById("tab-text").classList.toggle("active",t==="text");document.getElementById("tab-image").classList.toggle("active",t==="image")}' +
    // 이미지 처리
    'function handleImgData(b64){_imgB64=b64;document.getElementById("imgPrev").src=b64;document.getElementById("imgPrevArea").style.display="block";' +
    'document.getElementById("imgPh").style.display="none";document.getElementById("imgDrop").classList.add("has-img");document.getElementById("ocrBtn").style.display="block";' +
    'document.getElementById("ocrStatus").textContent="이미지 준비 완료"}' +
    'function handleImgFile(e){var f=e.target.files[0];if(!f||!f.type.startsWith("image/"))return;var r=new FileReader();r.onload=function(ev){handleImgData(ev.target.result)};r.readAsDataURL(f)}' +
    // Ctrl+V 붙여넣기
    'document.addEventListener("paste",function(e){var cd=e.clipboardData||window.clipboardData;if(!cd)return;var items=cd.items;' +
    'if(items){for(var i=0;i<items.length;i++){if(items[i].type.indexOf("image")!==-1){e.preventDefault();var f=items[i].getAsFile();' +
    'var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f);return}}}});' +
    // 이미지 드래그 앤 드롭
    'document.addEventListener("DOMContentLoaded",function(){' +
    'var iz=document.getElementById("imgDrop");' +
    'iz.addEventListener("dragover",function(e){e.preventDefault();e.stopPropagation();iz.classList.add("dragover")});' +
    'iz.addEventListener("dragleave",function(e){e.preventDefault();e.stopPropagation();iz.classList.remove("dragover")});' +
    'iz.addEventListener("drop",function(e){e.preventDefault();e.stopPropagation();iz.classList.remove("dragover");' +
    'var f=e.dataTransfer.files[0];if(f&&f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){handleImgData(ev.target.result)};r.readAsDataURL(f)}});' +
    // 엑셀 드래그 앤 드롭
    'var dz=document.getElementById("dropZone");' +
    'dz.addEventListener("dragover",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#e8f0fe";dz.style.borderColor="#1a73e8"});' +
    'dz.addEventListener("dragleave",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#fafafa";dz.style.borderColor="#ccc"});' +
    'dz.addEventListener("drop",function(e){e.preventDefault();e.stopPropagation();dz.style.background="#fafafa";dz.style.borderColor="#ccc";' +
    'if(e.dataTransfer.files&&e.dataTransfer.files.length>0){var f=e.dataTransfer.files[0];' +
    'if(f&&f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f)}' +
    'else{document.getElementById("fileUpload").files=e.dataTransfer.files;handleFileUpload({target:{files:e.dataTransfer.files}})}}})});' +
    // OCR 실행
    'function runOCR(){if(!_imgB64)return toast("이미지를 먼저 붙여넣으세요",2000);' +
    'var btn=document.getElementById("ocrBtn");var st=document.getElementById("ocrStatus");' +
    'btn.disabled=true;btn.textContent="📡 OCR 처리 중...";st.textContent="Gemini Vision으로 분석 중...";' +
    'google.script.run.withSuccessHandler(function(text){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";' +
    'if(!text||text.trim().length<3){st.textContent="❌ 텍스트를 인식하지 못했습니다.";toast("이미지에서 텍스트를 인식하지 못했습니다.",3000);return}' +
    'document.getElementById("rt").value=text;st.textContent="✅ "+text.split("\\n").length+"줄 추출 완료!";switchTab("text");toast("OCR 완료! 분석 버튼을 눌러주세요.",3000)})' +
    '.withFailureHandler(function(e){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";st.textContent="❌ 오류: "+(e.message||e);toast("OCR 오류: "+(e.message||e),4000)})' +
    '.ocrImageToTextLocal(_imgB64)}' +
    // 엑셀 파일 업로드
    'function handleFileUpload(e){var f=e.target.files[0];if(!f)return;' +
    'if(f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f);return}' +
    'var btn=document.getElementById("ab");btn.textContent="파일 읽는 중...";btn.disabled=true;' +
    'var reader=new FileReader();reader.onload=function(evt){var data=new Uint8Array(evt.target.result);' +
    'try{var wb=XLSX.read(data,{type:"array"});document.getElementById("rt").value=XLSX.utils.sheet_to_txt(wb.Sheets[wb.SheetNames[0]]);toast("엑셀 파일 로드 완료!",3000)}' +
    'catch(err){toast("파일 읽기 오류: "+err.message,4000)}finally{btn.textContent="🔍 분석";btn.disabled=false}};reader.readAsArrayBuffer(f)}' +
    // 분석
    'function analyze(){var rt=document.getElementById("rt").value.trim();if(!rt)return toast("텍스트를 붙여넣으세요.",2000);' +
    'var btn=document.getElementById("ab");btn.disabled=true;btn.textContent="분석 중...";document.getElementById("rs").style.display="none";' +
    'google.script.run.withSuccessHandler(function(res){btn.disabled=false;btn.textContent="🔍 분석";' +
    'if(res.error){toast("❌ "+res.error,3000);return}_m=res.matches;showResults(res)})' +
    '.withFailureHandler(function(e){btn.disabled=false;btn.textContent="🔍 분석";toast("오류: "+e.message,3000)})' +
    '.parseAndMatchInvoiceTextLocal(rt)}' +
    // 결과 표시
    'function showResults(res){var ok=(res.matches||[]).filter(function(m){return m.rows&&m.rows.length>0});' +
    'var no=res.unmatched||[];' +
    'document.getElementById("sum").innerHTML="<b>수취인 열:</b> "+res.recipientHeader+"&nbsp;|&nbsp;<span class=ok>✅ "+ok.length+"건</span>&nbsp;<span class=err>❌ "+no.length+"건</span>";' +
    'var tb=document.getElementById("mt");tb.innerHTML="";' +
    'ok.forEach(function(m){var rn=m.rows.map(function(r){return r+2}).join(",");' +
    'var ns=m.name!==m.matchedName?m.name+"≈"+m.matchedName:m.name;' +
    'var st=m.append?"<span style=color:#f29900>➕추가</span>":"<span class=ok>✅</span>";' +
    'tb.innerHTML+="<tr><td>"+ns+"</td><td class=tr>"+m.tracking+"</td><td>"+rn+"</td><td>"+st+"</td></tr>"});' +
    'no.forEach(function(u){tb.innerHTML+="<tr><td class=err>"+u.name+"</td><td class=tr>"+u.tracking+"</td><td>-</td><td class=err>❌</td></tr>"});' +
    'document.getElementById("apb").style.display=ok.length?"block":"none";' +
    'document.getElementById("rs").style.display="block"}' +
    // 반영
    'function applyAll(){if(!_m)return;var btn=document.getElementById("apb");btn.disabled=true;btn.textContent="반영 중...";' +
    'google.script.run.withSuccessHandler(function(res){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast(res.msg,3000)})' +
    '.withFailureHandler(function(e){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast("오류: "+e.message,3000)})' +
    '.applyInvoiceMatchesLocal(JSON.stringify(_m))}' +
    '<\\/script></body></html>';
}
