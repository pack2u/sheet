// ============================================================
//  [협력업체] 카카오 송장번호 매칭 사이드바 (v2 — 허브 동기화)
//  ▶ 자동 주입: createViewerNoticeScript_ → "스크립트 재설치"
//  ★ 허브 _partnerExclusivePush.gs와 동일한 파서/매칭 로직
//  ★ 수정 후 clasp push → 스크립트 재설치 실행
// ============================================================

function onOpen_copy_paste() {
  // 복사하여 사용할 때는 onOpen()으로 변경하세요.
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("🤖 고객센터 챗봇")
    .addItem("채팅창 열기", "showChatbotSidebar")
    .addToUi();
  SpreadsheetApp.getActiveSpreadsheet().addMenu("📬 송장 매칭", [
    {
      name: "카카오 송장번호 입력",
      functionName: "openInvoiceMatchSidebarLocal",
    },
  ]);
}

// ★ v10: 서버 사이드 분석 방식 — .toString() 직렬화 안정성 확보
function openInvoiceMatchSidebarLocal() {
  try {
    var htmlStr = _getInvoiceMatchHtmlSimple_();
    var html = HtmlService.createHtmlOutput(htmlStr)
      .setTitle("📬 카카오 송장 매칭")
      .setWidth(400);
    SpreadsheetApp.getUi().showSidebar(html);
  } catch (e) {
    SpreadsheetApp.getUi().alert("오류: " + e.message);
  }
}

// ★ v11: 엑셀 첨부 + 이미지 AI 탭 추가 (2026-07-08)
// ★ v12: 로컬 전용양식 미발주 엑셀 다운로드 추가 (2026-07-09)
function _getInvoiceMatchHtmlSimple_() {
  var css = [
    "* { box-sizing: border-box; margin: 0; padding: 0; }",
    "body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; font-size: 13px; background: #f0f2f5; display: flex; flex-direction: column; height: 100vh; }",
    ".hd { background: #1a73e8; color: white; padding: 12px 16px; font-size: 15px; font-weight: bold; flex-shrink: 0; }",
    ".sc { background: white; margin: 8px 8px 0; border-radius: 8px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }",
    "textarea { width: 100%; height: 110px; border: 1px solid #ddd; border-radius: 6px; padding: 8px; font-size: 12px; font-family: monospace; resize: none; }",
    ".btn { width: 100%; padding: 9px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; margin-top: 8px; transition: .15s; }",
    ".bb { background: #1a73e8; color: white; } .bb:hover { background: #1558b0; }",
    ".bg { background: #34a853; color: white; } .bg:hover { background: #2d8f46; }",
    ".btn-orange { background: #f29900; color: white; } .btn-orange:hover { background: #d88a00; }",
    ".btn-green { background: #34a853; color: white; } .btn-green:hover { background: #2d8f46; }",
    ".btn-blue { background: #1a73e8; color: white; } .btn-blue:hover { background: #1558b0; }",
    ".btn:disabled { background: #ccc; cursor: not-allowed; }",
    "#rs { flex: 1; overflow-y: auto; display: none; }",
    ".sum { margin: 8px; background: white; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #444; box-shadow: 0 1px 3px rgba(0,0,0,.1); }",
    "table { width: 100%; border-collapse: collapse; font-size: 12px; }",
    "th { background: #f8f9fa; padding: 6px 8px; text-align: left; font-size: 11px; color: #666; }",
    "td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }",
    ".ok { color: #34a853; font-weight: bold; } .err { color: #ea4335; font-weight: bold; }",
    ".tr { font-size: 11px; color: #555; font-family: monospace; }",
    "#toast { display: none; position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #333; color: white; padding: 8px 18px; border-radius: 20px; font-size: 12px; z-index: 999; }",
    "/* 탭 */",
    ".tab-bar { display: flex; margin: 8px 8px 0; gap: 2px; }",
    ".tab-btn { flex: 1; padding: 8px 4px; border: none; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 12px; font-weight: bold; background: #e0e0e0; color: #666; transition: .15s; }",
    ".tab-btn.active { background: white; color: #1a73e8; box-shadow: 0 -1px 3px rgba(0,0,0,.1); }",
    ".tab-content { display: none; } .tab-content.active { display: block; }",
    "/* 이미지 드롭존 */",
    ".img-drop-zone { border: 2px dashed #ccc; padding: 16px; border-radius: 6px; background: #fafafa; text-align: center; cursor: pointer; transition: .2s; min-height: 80px; position: relative; }",
    ".img-drop-zone.dragover { background: #e8f0fe; border-color: #1a73e8; }",
    ".img-drop-zone.has-image { border-color: #34a853; background: #f6fff6; }",
    ".img-preview { max-width: 100%; max-height: 150px; border-radius: 4px; margin-top: 8px; border: 1px solid #ddd; }",
    ".img-remove { position: absolute; top: 4px; right: 4px; background: #ea4335; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 11px; line-height: 20px; }",
    "/* 다운로드 체크리스트 */",
    ".dl-item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-bottom: 1px solid #f0f0f0; font-size: 12px; cursor: pointer; transition: 0.1s; }",
    ".dl-item:hover { background: #f5f8ff; }",
    ".dl-item:last-child { border-bottom: none; }",
    ".dl-item input { flex-shrink: 0; width: 15px; height: 15px; }",
    ".dl-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".dl-bar { display: flex; gap: 4px; margin-bottom: 6px; }",
    ".dl-bar .btn { flex: 1; margin: 0; font-size: 11px; padding: 5px; }",
    "/* ★ 2026-07-24: 미매칭 수동 매칭 */",
    ".suggest-sel { width:100%; font-size:11px; padding:3px 4px; border:1px solid #f5c6cb; border-radius:4px; background:#fff; }",
    ".manual-row { background:#fff8f0; }",
    ".manual-chk { width:14px; height:14px; vertical-align:middle; cursor:pointer; }",
    ".manual-label { font-size:11px; color:#ea4335; cursor:pointer; white-space:nowrap; }"
  ].join("\n");

  var body = [
    '<div class="hd">📬 카카오 송장 매칭</div>',
    '',
    '<div class="sc">',
    '  <button class="btn btn-orange" id="dlToggleBtn" onclick="toggleDownload()">📥 미발주 엑셀 다운로드</button>',
    '</div>',
    '',
    '<!-- 다운로드 섹션 -->',
    '<div class="sc" id="downloadSection" style="display:none;">',
    '  <div style="font-size: 11px; font-weight: bold; color: #888; margin-bottom: 8px;">📥 미발주 발주 목록</div>',
    '  <div class="dl-bar">',
    '    <button class="btn btn-blue" onclick="dlSelectAll(true)">전체선택</button>',
    '    <button class="btn" style="background:#eee; color:#333;" onclick="dlSelectAll(false)">전체해제</button>',
    '  </div>',
    '  <div id="dlList" style="max-height:220px; overflow-y:auto; border:1px solid #eee; border-radius:6px;"></div>',
    '  <div id="dlSummary" style="font-size:11px; color:#888; margin-top:4px; text-align:right;"></div>',
    '  <button class="btn btn-green" onclick="downloadSelectedExcel()">📥 선택 항목 다운로드</button>',
    '  <button class="btn" style="background:#eee; color:#333; font-size:11px;" onclick="downloadAllExcel()">📦 전체 미발주 다운로드</button>',
    '</div>',
    '',
    '<!-- 입력 방식 탭 -->',
    '<div class="tab-bar">',
    '  <button class="tab-btn active" onclick="switchTab(\'text\')">📋 텍스트/엑셀</button>',
    '  <button class="tab-btn" onclick="switchTab(\'image\')">🤖 이미지 AI</button>',
    '</div>',
    '',
    '<div class="sc" style="border-radius: 0 0 8px 8px; margin-top: 0;">',
    '  <!-- 탭1: 텍스트/엑셀 -->',
    '  <div id="tab-text" class="tab-content active">',
    '    <div id="dropZone" style="margin-bottom:8px; border:2px dashed #ccc; padding:12px; border-radius:6px; background:#fafafa; text-align:center; cursor:pointer; transition:.2s;" onclick="document.getElementById(\'fileUpload\').click()">',
    '      <div style="font-size:13px; color:#555; margin-bottom:4px;">📂 엑셀 파일을 여기에 드래그 앤 드롭 하세요</div>',
    '      <div style="font-size:11px; color:#888;">또는 클릭하여 파일 선택</div>',
    '      <input type="file" id="fileUpload" accept=".xlsx,.xls,.csv" style="display:none;" onchange="handleFileUpload(event)">',
    '    </div>',
    '    <div style="font-size:10px; color:#888; margin-bottom:8px;">※ 엑셀 파일은 \'이름\', \'송장번호\' 열만 남겨두시면 인식률이 가장 높습니다.</div>',
    '    <textarea id="rt" placeholder="예시:&#10;44363801252   최고갈비&#10;443-8937-1622   임병혁&#10;(또는 위의 버튼으로 엑셀 파일을 업로드하세요)"></textarea>',
    '  </div>',
    '',
    '  <!-- 탭2: 이미지 AI -->',
    '  <div id="tab-image" class="tab-content">',
    '    <div id="imgDropZone" class="img-drop-zone" onclick="document.getElementById(\'imgUpload\').click()">',
    '      <div id="imgPlaceholder">',
    '        <div style="font-size:22px; margin-bottom:6px;">📸</div>',
    '        <div style="font-size:13px; color:#555;">이미지를 붙여넣기(Ctrl+V) 하거나</div>',
    '        <div style="font-size:13px; color:#555; margin-bottom:4px;">드래그 앤 드롭 / 클릭하여 선택</div>',
    '        <div style="font-size:11px; color:#aaa;">송장 목록 스크린샷을 넣으세요</div>',
    '      </div>',
    '      <input type="file" id="imgUpload" accept="image/*" style="display:none;" onchange="handleImageFile(event)">',
    '    </div>',
    '    <div id="imgPreviewArea" style="display:none; text-align:center; margin-top:8px; position:relative;">',
    '      <button class="img-remove" onclick="clearImage(event)">✕</button>',
    '      <img id="imgPreview" class="img-preview" src="">',
    '      <div id="ocrStatus" style="font-size:11px; color:#888; margin-top:4px;"></div>',
    '    </div>',
    '    <button class="btn bb" id="imgAnalyzeBtn" onclick="analyzeImage()" style="display:none;">🤖 AI 직접 분석</button>',
    '  </div>',
    '',
    '  <button class="btn bb" id="ab" onclick="doAnalyze()">🤖 AI 분석</button>',
    '</div>',
    '',
    '<div id="rs">',
    '  <div class="sum" id="sum"></div>',
    '  <div class="sc" style="margin-bottom:8px">',
    '    <button class="btn bg" id="apb" onclick="doApply()" style="display:none">✅ 전용양식에 반영</button>',
    '    <table><thead><tr><th>이름</th><th>품목</th><th>송장번호</th><th>행</th><th></th></tr></thead><tbody id="mt"></tbody></table>',
    '  </div>',
    '</div>',
    '<div id="toast"></div>'
  ].join("\n");

  var script = [
    "var _matchData = null, _imageBase64 = null, _dlData = null;",
    "var _unmatched = [], _remainingQueue = {}, _lastMatchedRows = {};",
    "var _recipientHeader = '', _parseMethod = '';",
    "var _qtyWarnings = [], _noInvoiceRows = [], _hasQtyCol = false;",
    "",
    "function toast(msg, ms) {",
    "  var el = document.getElementById('toast');",
    "  el.textContent = msg; el.style.display = 'block';",
    "  setTimeout(function() { el.style.display = 'none'; }, ms || 2500);",
    "}",
    "",
    "// ── 탭 전환 ──",
    "function switchTab(tabName) {",
    "  document.querySelectorAll('.tab-btn').forEach(function(btn, i) {",
    "    btn.classList.toggle('active', (tabName === 'text' && i === 0) || (tabName === 'image' && i === 1));",
    "  });",
    "  document.getElementById('tab-text').classList.toggle('active', tabName === 'text');",
    "  document.getElementById('tab-image').classList.toggle('active', tabName === 'image');",
    "}",
    "",
    "// ── 이미지 처리 ──",
    "function handleImageData(base64) {",
    "  _imageBase64 = base64;",
    "  document.getElementById('imgPreview').src = base64;",
    "  document.getElementById('imgPreviewArea').style.display = 'block';",
    "  document.getElementById('imgPlaceholder').style.display = 'none';",
    "  document.getElementById('imgDropZone').classList.add('has-image');",
    "  document.getElementById('imgAnalyzeBtn').style.display = 'block';",
    "  document.getElementById('ocrStatus').textContent = '이미지 준비 완료 — AI 직접 분석을 눌러주세요';",
    "}",
    "",
    "function clearImage(e) {",
    "  if (e) e.stopPropagation();",
    "  _imageBase64 = null;",
    "  document.getElementById('imgPreviewArea').style.display = 'none';",
    "  document.getElementById('imgPlaceholder').style.display = 'block';",
    "  document.getElementById('imgDropZone').classList.remove('has-image');",
    "  document.getElementById('imgAnalyzeBtn').style.display = 'none';",
    "}",
    "",
    "function handleImageFile(e) {",
    "  var file = e.target.files[0];",
    "  if (!file || !file.type.startsWith('image/')) return;",
    "  var reader = new FileReader();",
    "  reader.onload = function(evt) { handleImageData(evt.target.result); };",
    "  reader.readAsDataURL(file);",
    "}",
    "",
    "// Ctrl+V 붙여넣기",
    "document.addEventListener('paste', function(e) {",
    "  var cd = e.clipboardData || window.clipboardData;",
    "  if (!cd) return;",
    "  var items = cd.items;",
    "  if (items) {",
    "    for (var i = 0; i < items.length; i++) {",
    "      if (items[i].type.indexOf('image') !== -1) {",
    "        e.preventDefault();",
    "        var file = items[i].getAsFile();",
    "        var reader = new FileReader();",
    "        reader.onload = function(evt) { switchTab('image'); handleImageData(evt.target.result); };",
    "        reader.readAsDataURL(file);",
    "        return;",
    "      }",
    "    }",
    "  }",
    "});",
    "",
    "// 이미지 드래그앤드롭 + 엑셀 드래그앤드롭",
    "document.addEventListener('DOMContentLoaded', function() {",
    "  var imgZone = document.getElementById('imgDropZone');",
    "  imgZone.addEventListener('dragover', function(e) { e.preventDefault(); imgZone.classList.add('dragover'); });",
    "  imgZone.addEventListener('dragleave', function(e) { e.preventDefault(); imgZone.classList.remove('dragover'); });",
    "  imgZone.addEventListener('drop', function(e) {",
    "    e.preventDefault(); imgZone.classList.remove('dragover');",
    "    var file = e.dataTransfer.files[0];",
    "    if (file && file.type.startsWith('image/')) {",
    "      var reader = new FileReader();",
    "      reader.onload = function(evt) { handleImageData(evt.target.result); };",
    "      reader.readAsDataURL(file);",
    "    }",
    "  });",
    "",
    "  var dropZone = document.getElementById('dropZone');",
    "  dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.style.background = '#e8f0fe'; dropZone.style.borderColor = '#1a73e8'; });",
    "  dropZone.addEventListener('dragleave', function(e) { e.preventDefault(); dropZone.style.background = '#fafafa'; dropZone.style.borderColor = '#ccc'; });",
    "  dropZone.addEventListener('drop', function(e) {",
    "    e.preventDefault(); dropZone.style.background = '#fafafa'; dropZone.style.borderColor = '#ccc';",
    "    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {",
    "      var file = e.dataTransfer.files[0];",
    "      if (file && file.type.startsWith('image/')) {",
    "        var reader = new FileReader();",
    "        reader.onload = function(evt) { switchTab('image'); handleImageData(evt.target.result); };",
    "        reader.readAsDataURL(file);",
    "        toast('이미지 파일 감지 → 이미지 AI 탭으로 전환', 3000);",
    "      } else {",
    "        document.getElementById('fileUpload').files = e.dataTransfer.files;",
    "        handleFileUpload({ target: { files: e.dataTransfer.files } });",
    "      }",
    "    }",
    "  });",
    "});",
    "",
    "// ── 이미지 AI 분석 ──",
    "function analyzeImage() {",
    "  if (!_imageBase64) return toast('이미지를 먼저 붙여넣으세요.', 2000);",
    "  var btn = document.getElementById('imgAnalyzeBtn');",
    "  var status = document.getElementById('ocrStatus');",
    "  btn.disabled = true; btn.textContent = '🤖 AI 분석 중...';",
    "  status.textContent = 'Gemini AI가 이미지를 분석하고 있습니다...';",
    "  google.script.run",
    "    .withSuccessHandler(function(res) {",
    "      btn.disabled = false; btn.textContent = '🤖 AI 직접 분석';",
    "      if (res && res.error) { status.textContent = '❌ ' + res.error; toast('오류: ' + res.error, 5000); return; }",
    "      _matchData = res.matches;",
    "      status.textContent = '✅ AI 분석 완료!';",
    "      showResults(res);",
    "      toast('AI 분석 완료!', 3000);",
    "    })",
    "    .withFailureHandler(function(e) {",
    "      btn.disabled = false; btn.textContent = '🤖 AI 직접 분석';",
    "      status.textContent = '❌ 오류: ' + (e.message || e);",
    "      toast('AI 분석 오류: ' + (e.message || e), 4000);",
    "    })",
    "    .parseAndMatchInvoiceImageLocal(_imageBase64);",
    "}",
    "",
    "// ── 엑셀 파일 업로드 처리 ──",
    "function handleFileUpload(e) {",
    "  var file = e.target.files[0];",
    "  if (!file) return;",
    "  if (file.type.startsWith('image/')) {",
    "    var reader2 = new FileReader();",
    "    reader2.onload = function(evt) { switchTab('image'); handleImageData(evt.target.result); };",
    "    reader2.readAsDataURL(file);",
    "    toast('이미지 파일 감지 → 이미지 AI 탭으로 전환', 3000);",
    "    return;",
    "  }",
    "  var reader = new FileReader();",
    "  reader.onload = function(evt) {",
    "    var data = new Uint8Array(evt.target.result);",
    "    try {",
    "      var textContent = '';",
    "      if (data.length >= 2 && data[0] === 0xFF && data[1] === 0xFE) {",
    "        for (var ci = 2; ci < data.length - 1; ci += 2) {",
    "          textContent += String.fromCharCode(data[ci] | (data[ci + 1] << 8));",
    "        }",
    "      } else {",
    "        var workbook = XLSX.read(data, {type: 'array', codepage: 65001});",
    "        textContent = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]], {FS: '\\t'});",
    "      }",
    "      document.getElementById('rt').value = textContent;",
    "      toast('파일 변환 완료! AI 분석을 눌러주세요.', 3000);",
    "    } catch(err) { toast('파일 읽기 오류: ' + err.message, 4000); }",
    "  };",
    "  reader.readAsArrayBuffer(file);",
    "}",
    "",
    "// ── 텍스트 분석 ──",
    "function doAnalyze() {",
    "  var text = document.getElementById('rt').value.trim();",
    "  if (!text) return toast('텍스트를 붙여넣거나 파일을 업로드하세요.', 2000);",
    "  var btn = document.getElementById('ab');",
    "  btn.disabled = true; btn.textContent = '🤖 AI 분석 중...';",
    "  document.getElementById('rs').style.display = 'none';",
    "  google.script.run",
    "    .withSuccessHandler(function(res) {",
    "      btn.disabled = false; btn.textContent = '🤖 AI 분석';",
    "      showResults(res);",
    "    })",
    "    .withFailureHandler(function(err) {",
    "      btn.disabled = false; btn.textContent = '🤖 AI 분석';",
    "      toast('오류: ' + err, 4000);",
    "    })",
    "    .parseAndMatchInvoiceTextLocal(text);",
    "}",
    "",
    "function _escHtml(s) {",
    "  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');",
    "}",
    "function showResults(res) {",
    "  if (res && res.error) return toast('오류: ' + res.error, 4000);",
    "  _matchData = (res.matches || []).filter(function(m){ return m.rows && m.rows.length > 0; });",
    "  _unmatched = (res.unmatched || []).slice();",
    "  _remainingQueue = {};",
    "  var rq = res.remainingQueue || {};",
    "  for (var k in rq) _remainingQueue[k] = (rq[k] || []).slice();",
    "  _lastMatchedRows = {};",
    "  var lm = res.lastMatchedRows || {};",
    "  for (var lk in lm) _lastMatchedRows[lk] = lm[lk];",
    "  _recipientHeader = res.recipientHeader || '';",
    "  _parseMethod = res.parseMethod || '';",
    "  _qtyWarnings = (res.qtyWarnings || []).slice();",
    "  _noInvoiceRows = (res.noInvoiceRows || []).slice();",
    "  _hasQtyCol = !!res.hasQtyCol;",
    "  _renderMatchTable();",
    "  document.getElementById('rs').style.display = 'block';",
    "}",
    "function _remainingNameList() {",
    "  var names = [];",
    "  for (var n in _remainingQueue) {",
    "    if (_remainingQueue[n] && _remainingQueue[n].length > 0) names.push({ name: n, rowsLeft: _remainingQueue[n].length });",
    "  }",
    "  names.sort(function(a,b){ return a.name.localeCompare(b.name, 'ko'); });",
    "  return names;",
    "}",
    "// 수량 대비 송장 개수 점검 결과. 미송장 행은 반영 후 재발주 대상이 되므로 먼저 보여준다.",
    "function _qtyAuditHtml() {",
    "  var h = '';",
    "  if (_noInvoiceRows && _noInvoiceRows.length) {",
    "    var ni = _noInvoiceRows.slice(0, 12).map(function(r) {",
    "      return r.row + '행 ' + _escHtml(r.name) + (r.item ? ' · ' + _escHtml(r.item.length > 12 ? r.item.substring(0,12) + '…' : r.item) : '') + (_hasQtyCol ? ' ×' + r.qty : '');",
    "    }).join('<br>');",
    "    var more = _noInvoiceRows.length > 12 ? '<br>… 외 ' + (_noInvoiceRows.length - 12) + '행' : '';",
    "    h += '<div style=\"margin-top:8px;padding:7px 9px;border-radius:6px;background:#fdecea;border:1px solid #f5c6cb;font-size:11px;color:#a4202a;line-height:1.6;\">' +",
    "      '<b>⛔ 송장이 안 들어가는 행 ' + _noInvoiceRows.length + '개</b> — 이대로 반영하면 미송장으로 남아 <b>재발주</b>됩니다.<br>' + ni + more + '</div>';",
    "  }",
    "  if (_qtyWarnings && _qtyWarnings.length) {",
    "    var qw = _qtyWarnings.slice(0, 12).map(function(w) {",
    "      return w.row + '행 ' + _escHtml(w.name) + ' — 수량 ' + w.qty + ' / 송장 ' + w.assigned + '개 (' + w.kind + ')';",
    "    }).join('<br>');",
    "    var more2 = _qtyWarnings.length > 12 ? '<br>… 외 ' + (_qtyWarnings.length - 12) + '행' : '';",
    "    h += '<div style=\"margin-top:8px;padding:7px 9px;border-radius:6px;background:#fff4e5;border:1px solid #ffd8a8;font-size:11px;color:#8a5200;line-height:1.6;\">' +",
    "      '<b>⚠ 수량과 송장 개수가 다른 행 ' + _qtyWarnings.length + '개</b><br>' + qw + more2 + '</div>';",
    "  }",
    "  if (!_hasQtyCol && (h || (_matchData && _matchData.length))) {",
    "    h += '<div style=\"margin-top:6px;font-size:11px;color:#666;\">ℹ 이 양식에는 수량 열이 없어 행마다 송장 1개로 배분했습니다.</div>';",
    "  }",
    "  return h;",
    "}",
    "function _renderMatchTable() {",
    "  var ok = _matchData || [];",
    "  var no = _unmatched || [];",
    "  var parseInfo = _parseMethod ? ' (' + _parseMethod + ')' : '';",
    "  document.getElementById('sum').innerHTML =",
    "    '<b>수취인 열:</b> ' + _escHtml(_recipientHeader) + '&nbsp;|&nbsp;' +",
    "    '<span class=\"ok\">✅ ' + ok.length + '건</span>&nbsp;' +",
    "    '<span class=\"err\">❌ ' + no.length + '건</span>' + parseInfo +",
    "    (no.length > 0 ? '<div style=\"margin-top:6px;font-size:11px;color:#b06000;\">⚠ 미매칭은 아래 후보를 고른 뒤 체크하면 매칭됩니다</div>' : '') +",
    "    _qtyAuditHtml();",
    "  var tb = document.getElementById('mt');",
    "  tb.innerHTML = '';",
    "  for (var i = 0; i < ok.length; i++) {",
    "    var m = ok[i];",
    "    var rn = m.rows.map(function(r) { return r + 2; }).join(',');",
    "    var ns = m.name !== m.matchedName ? _escHtml(m.name) + '<span style=\"color:#aaa\">≈</span>' + _escHtml(m.matchedName) : _escHtml(m.name);",
    "    var it = m.itemName ? '<span style=\"font-size:10px;color:#666\">' + _escHtml(m.itemName.length > 15 ? m.itemName.substring(0,15) + '...' : m.itemName) + '</span>' : '';",
    "    var st = m.manual ? '<span style=\"color:#1a73e8\">✓수동</span>' : (m.append ? '<span style=\"color:#f29900\">➕추가</span>' : '<span class=\"ok\">✅</span>');",
    "    tb.innerHTML += '<tr><td>' + ns + '</td><td>' + it + '</td><td class=\"tr\">' + _escHtml(m.tracking) + '</td><td>' + rn + '</td><td>' + st + '</td></tr>';",
    "  }",
    "  var allNames = _remainingNameList();",
    "  for (var j = 0; j < no.length; j++) {",
    "    var u = no[j];",
    "    var sug = u.suggestions || [];",
    "    var opts = '<option value=\"\">후보 선택...</option>';",
    "    var seen = {};",
    "    for (var si = 0; si < sug.length; si++) {",
    "      seen[sug[si].name] = true;",
    "      var left = (_remainingQueue[sug[si].name] || []).length;",
    "      opts += '<option value=\"' + _escHtml(sug[si].name) + '\">⭐ ' + _escHtml(sug[si].name) + ' (' + (left > 0 ? left + '행' : '추가') + ')</option>';",
    "    }",
    "    if (allNames.length > 0) {",
    "      opts += '<optgroup label=\"전체 남은 수취인\">';",
    "      for (var ai = 0; ai < allNames.length; ai++) {",
    "        if (seen[allNames[ai].name]) continue;",
    "        opts += '<option value=\"' + _escHtml(allNames[ai].name) + '\">' + _escHtml(allNames[ai].name) + ' (' + allNames[ai].rowsLeft + '행)</option>';",
    "      }",
    "      opts += '</optgroup>';",
    "    }",
    "    var appendNames = [];",
    "    for (var an in _lastMatchedRows) {",
    "      if (!seen[an] && (!_remainingQueue[an] || !_remainingQueue[an].length)) appendNames.push(an);",
    "    }",
    "    if (appendNames.length > 0) {",
    "      opts += '<optgroup label=\"이미 매칭된 이름에 추가\">';",
    "      for (var api = 0; api < appendNames.length; api++) {",
    "        opts += '<option value=\"' + _escHtml(appendNames[api]) + '\">➕ ' + _escHtml(appendNames[api]) + '</option>';",
    "      }",
    "      opts += '</optgroup>';",
    "    }",
    "    tb.innerHTML += '<tr class=\"manual-row\"><td class=\"err\">' + _escHtml(u.name) + '</td><td>' +",
    "      (u.itemName ? '<span style=\"font-size:10px;color:#666\">' + _escHtml(String(u.itemName).substring(0,15)) + '</span>' : '') +",
    "      '</td><td class=\"tr\">' + _escHtml(u.tracking) + '</td><td><select class=\"suggest-sel\" id=\"sugSel' + j +",
    "      '\" onchange=\"onSuggestChange(' + j + ')\">' + opts + '</select></td><td><label class=\"manual-label\"><input type=\"checkbox\" class=\"manual-chk\" id=\"sugChk' + j +",
    "      '\" disabled onchange=\"confirmManualMatch(' + j + ')\"> 매칭</label></td></tr>';",
    "  }",
    "  document.getElementById('apb').style.display = ok.length ? 'block' : 'none';",
    "}",
    "function onSuggestChange(idx) {",
    "  var sel = document.getElementById('sugSel' + idx);",
    "  var chk = document.getElementById('sugChk' + idx);",
    "  if (!sel || !chk) return;",
    "  chk.disabled = !sel.value;",
    "  if (!sel.value) chk.checked = false;",
    "}",
    "function confirmManualMatch(idx) {",
    "  var chk = document.getElementById('sugChk' + idx);",
    "  var sel = document.getElementById('sugSel' + idx);",
    "  if (!chk || !sel || !chk.checked) return;",
    "  var selName = sel.value;",
    "  if (!selName) { chk.checked = false; return; }",
    "  var u = _unmatched[idx];",
    "  if (!u) return;",
    "  var assignedRow = null, isAppend = false;",
    "  if (_remainingQueue[selName] && _remainingQueue[selName].length > 0) {",
    "    assignedRow = _remainingQueue[selName].shift();",
    "    if (_remainingQueue[selName].length === 0) delete _remainingQueue[selName];",
    "    _lastMatchedRows[selName] = assignedRow;",
    "  } else if (_lastMatchedRows[selName] !== undefined) {",
    "    assignedRow = _lastMatchedRows[selName];",
    "    isAppend = true;",
    "  } else {",
    "    toast('선택한 이름에 남은 행이 없습니다.', 2500);",
    "    chk.checked = false;",
    "    return;",
    "  }",
    "  _matchData.push({ tracking: u.tracking, name: u.name, matchedName: selName, rows: [assignedRow], append: isAppend, itemName: u.itemName || '', manual: true });",
    "  _unmatched.splice(idx, 1);",
    "  _renderMatchTable();",
    "  toast('수동 매칭: ' + u.name + ' → ' + selName, 2000);",
    "}",
    "",
    "function doApply() {",
    "  if (!_matchData) return;",
    "  var btn = document.getElementById('apb');",
    "  btn.disabled = true; btn.textContent = '반영 중...';",
    "  google.script.run",
    "    .withSuccessHandler(function(res) {",
    "      btn.disabled = false; btn.textContent = '✅ 전용양식에 반영';",
    "      toast(res.msg, 3000);",
    "    })",
    "    .withFailureHandler(function(err) {",
    "      btn.disabled = false; btn.textContent = '✅ 전용양식에 반영';",
    "      toast('오류: ' + err, 3000);",
    "    })",
    "    .applyInvoiceMatchesLocal(JSON.stringify(_matchData));",
    "}",
    "",
    "// ── 미발주 엑셀 다운로드 (★ 2026-07-09 로컬 지원) ──",
    "function toggleDownload() {",
    "  var section = document.getElementById('downloadSection');",
    "  if (section.style.display !== 'none') {",
    "    section.style.display = 'none';",
    "    return;",
    "  }",
    "  var btn = document.getElementById('dlToggleBtn');",
    "  btn.disabled = true; btn.textContent = '📥 로딩 중...';",
    "  google.script.run",
    "    .withSuccessHandler(function(res) {",
    "      btn.disabled = false; btn.textContent = '📥 미발주 엑셀 다운로드';",
    "      if (res && res.error) return toast('오류: ' + res.error, 3000);",
    "      _dlData = res;",
    "      renderDlList(res);",
    "      section.style.display = 'block';",
    "    })",
    "    .withFailureHandler(function(err) {",
    "      btn.disabled = false; btn.textContent = '📥 미발주 엑셀 다운로드';",
    "      toast('오류: ' + err, 5000);",
    "    })",
    "    .p2u_getExclusiveFormDataForDownload();",
    "}",
    "",
    "function renderDlList(res) {",
    "  var list = document.getElementById('dlList');",
    "  if (!res.data || res.data.length === 0) {",
    "    list.innerHTML = '<div style=\"padding:16px; text-align:center; color:#888;\">미발주 건이 없습니다.</div>';",
    "    document.getElementById('dlSummary').textContent = '';",
    "    return;",
    "  }",
    "  var recipCol = -1, prodCol = -1, qtyCol = -1;",
    "  var RECIP_KW = ['받는사람','수취인','수령인','고객명'];",
    "  var PROD_KW = ['상품명','품목명','품명'];",
    "  var QTY_KW = ['수량'];",
    "  for (var hi = 0; hi < res.headers.length; hi++) {",
    "    var h = String(res.headers[hi]).replace(/\\s/g, '');",
    "    for (var rk = 0; rk < RECIP_KW.length; rk++) { if (h.indexOf(RECIP_KW[rk]) !== -1 && recipCol < 0) recipCol = hi; }",
    "    for (var pk = 0; pk < PROD_KW.length; pk++) { if (h.indexOf(PROD_KW[pk]) !== -1 && prodCol < 0) prodCol = hi; }",
    "    for (var qk = 0; qk < QTY_KW.length; qk++) { if (h.indexOf(QTY_KW[qk]) !== -1 && qtyCol < 0) qtyCol = hi; }",
    "  }",
    "  var html = '';",
    "  for (var i = 0; i < res.data.length; i++) {",
    "    var row = res.data[i];",
    "    var recip = recipCol >= 0 ? String(row[recipCol] || '').trim() : String(row[0] || '').trim();",
    "    var prod = prodCol >= 0 ? String(row[prodCol] || '').trim() : '';",
    "    var qty = qtyCol >= 0 ? String(row[qtyCol] || '').trim() : '';",
    "    if (prod.length > 18) prod = prod.substring(0, 18) + '…';",
    "    var label = recip || '(이름없음)';",
    "    if (prod) label += ' <span style=\"color:#888\">· ' + prod + '</span>';",
    "    if (qty && qty !== '0') label += ' <span style=\"color:#1a73e8\">×' + qty + '</span>';",
    "    html += '<label class=\"dl-item\"><input type=\"checkbox\" class=\"dl-cb\" data-idx=\"' + i + '\" checked onchange=\"updateDlSummary()\"> <span>' + label + '</span></label>';",
    "  }",
    "  list.innerHTML = html;",
    "  updateDlSummary();",
    "}",
    "",
    "function updateDlSummary() {",
    "  var cbs = document.querySelectorAll('.dl-cb');",
    "  var checked = 0;",
    "  for (var i = 0; i < cbs.length; i++) { if (cbs[i].checked) checked++; }",
    "  document.getElementById('dlSummary').textContent = checked + ' / ' + cbs.length + '건 선택';",
    "}",
    "",
    "function dlSelectAll(val) {",
    "  var cbs = document.querySelectorAll('.dl-cb');",
    "  for (var i = 0; i < cbs.length; i++) cbs[i].checked = val;",
    "  updateDlSummary();",
    "}",
    "",
    "function _getDlFileName() {",
    "  var d = new Date();",
    "  var ds = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');",
    "  var base = (_dlData.vendorName || '발주') + '_발주_' + ds;",
    "  var cKey = 'dlCnt_' + base;",
    "  var cnt = parseInt(localStorage.getItem(cKey) || '0', 10) + 1;",
    "  localStorage.setItem(cKey, String(cnt));",
    "  return base + (cnt > 1 ? '-' + cnt : '') + '.xlsx';",
    "}",
    "",
    "async function _saveXlsx(wb, fileName) {",
    "  var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });",
    "  var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });",
    "  if (window.showSaveFilePicker) {",
    "    try {",
    "      var handle = await window.showSaveFilePicker({",
    "        suggestedName: fileName,",
    "        types: [{ description: 'Excel 파일', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]",
    "      });",
    "      var writable = await handle.createWritable();",
    "      await writable.write(blob);",
    "      await writable.close();",
    "      return true;",
    "    } catch (e) {",
    "      if (e.name === 'AbortError') return false;",
    "    }",
    "  }",
    "  var url = URL.createObjectURL(blob);",
    "  var a = document.createElement('a');",
    "  a.href = url; a.download = fileName;",
    "  document.body.appendChild(a); a.click();",
    "  document.body.removeChild(a);",
    "  URL.revokeObjectURL(url);",
    "  return true;",
    "}",
    "",
    "async function _buildXlsx(rows) {",
    "  if (!_dlData) return 0;",
    "  var wb = XLSX.utils.book_new();",
    "  var wsData = [_dlData.headers].concat(rows);",
    "  var ws = XLSX.utils.aoa_to_sheet(wsData);",
    "  var colWidths = [];",
    "  for (var ci = 0; ci < _dlData.headers.length; ci++) {",
    "    var mx = String(_dlData.headers[ci]).length;",
    "    for (var ri = 0; ri < rows.length; ri++) {",
    "      var cl = String(rows[ri][ci] || '').length;",
    "      if (cl > mx) mx = cl;",
    "    }",
    "    colWidths.push({ wch: Math.min(Math.max(mx + 2, 8), 40) });",
    "  }",
    "  ws['!cols'] = colWidths;",
    "  XLSX.utils.book_append_sheet(wb, ws, '발주');",
    "  var fn = _getDlFileName();",
    "  var ok = await _saveXlsx(wb, fn);",
    "  return ok ? rows.length : 0;",
    "}",
    "",
    "async function downloadSelectedExcel() {",
    "  if (!_dlData || !_dlData.data || _dlData.data.length === 0) return toast('데이터가 없습니다.', 2000);",
    "  var cbs = document.querySelectorAll('.dl-cb');",
    "  var selected = [];",
    "  for (var i = 0; i < cbs.length; i++) {",
    "    if (cbs[i].checked) selected.push(_dlData.data[parseInt(cbs[i].getAttribute('data-idx'), 10)]);",
    "  }",
    "  if (selected.length === 0) return toast('선택된 항목이 없습니다.', 2000);",
    "  var cnt = await _buildXlsx(selected);",
    "  if (cnt) toast('✅ ' + cnt + '건 다운로드 완료', 3000);",
    "}",
    "",
    "async function downloadAllExcel() {",
    "  if (!_dlData || !_dlData.data || _dlData.data.length === 0) return toast('미발주 건이 없습니다.', 2000);",
    "  var cnt = await _buildXlsx(_dlData.data);",
    "  if (cnt) toast('✅ 전체 ' + cnt + '건 다운로드 완료', 3000);",
    "}"
  ].join("\n");

  return "<!DOCTYPE html><html><head><base target=\"_top\"><style>\n" + 
    css + "\n</style>" +
    "</head><body>\n" + 
    body + "\n<script>\n" + 
    script + "\n</" + "script></body></html>";
}

// ── Levenshtein 편집 거리 (퍼지 매칭용) ──
function _levenshteinLocal_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var matrix = [];
  for (var i = 0; i <= b.length; i++) matrix[i] = [i];
  for (var j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (var i2 = 1; i2 <= b.length; i2++) {
    for (var j2 = 1; j2 <= a.length; j2++) {
      if (b.charAt(i2 - 1) === a.charAt(j2 - 1)) {
        matrix[i2][j2] = matrix[i2 - 1][j2 - 1];
      } else {
        matrix[i2][j2] = Math.min(
          matrix[i2 - 1][j2 - 1] + 1,
          matrix[i2][j2 - 1] + 1,
          matrix[i2 - 1][j2] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * ★ 2026-07-24: 미매칭 이름 → 전용양식 남은 수취인 유사 후보 (수동 매칭용)
 * 자동 매칭보다 느슨한 기준 — 운영자가 고를 수 있게 top-N만 제시
 * @param {string} inputName
 * @param {Object} rowQueue  { 이름: [행idx,...] } 남은 행만
 * @param {number=} maxN 기본 3
 * @returns {Array<{name:string, rowsLeft:number, score:number}>}
 */
function _imBuildNameSuggestions_(inputName, rowQueue, maxN) {
  maxN = maxN || 3;
  var input = String(inputName || "")
    .normalize("NFC")
    .replace(/\s*님\s*$/g, "")
    .replace(/\s*\d+\s*(박스|봉지|세트|묶음|개|EA)\s*$/i, "")
    .trim();
  var inputNoSp = input.replace(/\s/g, "");
  if (!inputNoSp || !rowQueue) return [];
  var inputToks = input.split(/\s+/).filter(function (t) { return t.length >= 2; });
  var scored = [];

  for (var nm in rowQueue) {
    if (!rowQueue[nm] || rowQueue[nm].length === 0) continue;
    var sheetNoSp = String(nm).replace(/\s/g, "");
    if (!sheetNoSp) continue;
    var score = 0;

    if (sheetNoSp === inputNoSp) {
      score = 1000;
    } else {
      var sheetToks = String(nm).split(/\s+/);
      for (var ti = 0; ti < inputToks.length; ti++) {
        for (var sj = 0; sj < sheetToks.length; sj++) {
          if (inputToks[ti] === sheetToks[sj]) {
            score = Math.max(score, 800 - ti * 10);
          } else if (
            sheetToks[sj].indexOf(inputToks[ti]) !== -1 ||
            inputToks[ti].indexOf(sheetToks[sj]) !== -1
          ) {
            score = Math.max(score, 500);
          }
        }
      }
      if (sheetNoSp.indexOf(inputNoSp) !== -1 || inputNoSp.indexOf(sheetNoSp) !== -1) {
        score = Math.max(score, 600);
      }
      var maxLen = Math.max(inputNoSp.length, sheetNoSp.length);
      if (maxLen > 0) {
        var dist = _levenshteinLocal_(inputNoSp, sheetNoSp);
        var sim = 1 - dist / maxLen;
        if (sim >= 0.35) score = Math.max(score, Math.round(sim * 400));
      }
    }
    if (score > 0) {
      scored.push({ name: nm, rowsLeft: rowQueue[nm].length, score: score });
    }
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, maxN);
}

// ── 서버: 텍스트 파싱 + 전용양식 매칭 (★ v2: 허브 동기화) ──
function parseAndMatchInvoiceTextLocal(rawText) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 전용양식 탭 탐색
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) {
        exTab = tabs[ti];
        break;
      }
    }
    if (!exTab) return { error: "전용양식 탭 없음" };

    var lr = exTab.getLastRow();
    if (lr < 2) return { error: "전용양식 데이터 없음" };
    var lc = Math.max(exTab.getLastColumn(), 1);
    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];

    // 수취인 열 자동 탐지
    var KEYWORDS = [
      "받는분",
      "받는사람",
      "수령인",
      "고객명",
      "받으시는",
      "수하인",
      "수취인",
      "수취주",
      "수화주",
    ];
    var EXCLUDE_KW = ["보내는", "송하인", "발화주", "발신"];
    var recipientCol = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      var h = String(headers[hi] || "").replace(/\s/g, "");
      var excluded = false;
      for (var ei = 0; ei < EXCLUDE_KW.length; ei++) {
        if (h.indexOf(EXCLUDE_KW[ei]) !== -1) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
      for (var ki = 0; ki < KEYWORDS.length; ki++) {
        if (h.indexOf(KEYWORDS[ki]) !== -1) {
          recipientCol = hi;
          break;
        }
      }
      if (recipientCol !== -1) break;
    }
    if (recipientCol === -1)
      return {
        error: "수취인 열 없음. 헤더: " + headers.slice(0, 8).join(", "),
      };

    // ★ 상품명 열 자동 탐지
    var PRODUCT_KW = [
      "상품명",
      "품목명",
      "품명",
      "제품명",
      "상품",
      "item",
      "product",
    ];
    var productCol = -1;
    for (var phi = 0; phi < headers.length; phi++) {
      var ph = String(headers[phi] || "")
        .replace(/\s/g, "")
        .toLowerCase();
      for (var pki = 0; pki < PRODUCT_KW.length; pki++) {
        if (ph.indexOf(PRODUCT_KW[pki]) !== -1) {
          productCol = phi;
          break;
        }
      }
      if (productCol !== -1) break;
    }

    // ★ 2026-07-08: 수량 열 자동 탐지 (허브 동기화)
    var QTY_KW = ["수량","qty","quantity","갯수","개수"];
    var qtyCol = -1;
    for (var qhi = 0; qhi < headers.length; qhi++) {
      var qh = String(headers[qhi] || "").replace(/\s/g, "").toLowerCase();
      for (var qki = 0; qki < QTY_KW.length; qki++) {
        if (qh.indexOf(QTY_KW[qki]) !== -1) { qtyCol = qhi; break; }
      }
      if (qtyCol !== -1) break;
    }
    Logger.log("[송장매칭] productCol=" + productCol + ", qtyCol=" + qtyCol);

    // ★ NFC 정규화 + "님" 제거로 이름→행 큐 맵 구성
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var nameToRows = {};
    for (var ri = 0; ri < data.length; ri++) {
      var rn = String(data[ri][recipientCol] || "")
        .normalize("NFC")
        .replace(/\s*님\s*$/g, "")
        .trim();
      if (!rn) continue;
      if (!nameToRows[rn]) nameToRows[rn] = [];
      nameToRows[rn].push(ri);
    }
    var rowQueue = {};
    for (var qk in nameToRows) rowQueue[qk] = nameToRows[qk].slice();

    // ★ 2026-07-08: 슬래시 구분 다중 송장 전처리 — 모든 파서 이전에 실행
    // "이름 259421457945 / 259421457956" → "이름 259421457945\n이름 259421457956"
    rawText = rawText.replace(/^(.+?)\s+([\d\-]{10,20}(?:\s*\/\s*[\d\-]{10,20})+)\s*$/gm, function(match, name, nums) {
      var parts = nums.split(/\s*\/\s*/);
      var cleanName = name.trim();
      return parts.map(function(n) { return cleanName + " " + n.trim(); }).join("\n");
    });

    // ★ 2026-07-08: 3단계 파싱 — 1) TSV헤더 → 2) Gemini AI → 3) 정규식 (허브 동기화)
    var pairs = null;
    var parseMethod = "regex-fallback";
    // 1단계: 헤더 기반 TSV 파싱 (가장 빠르고 정확)
    pairs = _parseStructuredTSV_(rawText);
    if (pairs) {
      parseMethod = "tsv-header";
    } else {
      // 2단계: Gemini AI (비구조 텍스트)
      pairs = _parseInvoicePairsWithGemini_(rawText);
      if (pairs) {
        parseMethod = "gemini";
      } else {
        // 3단계: 정규식 폴백
        pairs = _parseInvoicePairs_(rawText);
        parseMethod = "regex-fallback";
      }
    }
    if (!pairs || pairs.length === 0)
      return { error: '인식된 쌍 없음. 형식: "송장번호   이름" (각 줄)' };
    Logger.log("[송장매칭] 파싱방식=" + parseMethod + ", 건수=" + pairs.length);

    // ★ 2026-07-08: itemName에서 송하인/택배사 패턴 제거 (허브 동기화)
    var SENDER_FILTER = /^(팩투유|주식회사\s*팩투유|\(주\)\s*팩투유|Pack2U|한진|한진택배|로젠|로젠택배|CJ대한통운|CJ택배|롯데택배|우체국택배|경동택배)$/i;
    for (var fi = 0; fi < pairs.length; fi++) {
      if (pairs[fi].itemName && SENDER_FILTER.test(pairs[fi].itemName.trim())) {
        Logger.log("[송장매칭] itemName 필터링: '" + pairs[fi].itemName + "' → 제거");
        pairs[fi].itemName = "";
      }
    }

    // ★ NFC 정규화 + 잔여 택배사 프리픽스 2차 정리
    var COURIER_PFX =
      /^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\s*[\/]\s*/i;
    for (var nfi = 0; nfi < pairs.length; nfi++) {
      if (pairs[nfi].name) {
        pairs[nfi].name = pairs[nfi].name
          .normalize("NFC")
          .replace(COURIER_PFX, "")
          .replace(/^[\s\/]+/, "")
          .replace(/\s*\d+\s*(박스|봉지|세트|묶음|개|EA)\s*$/i, "") // ★ 2026-07-24: 수량 접미 제거
          .trim();
      }
    }

    Logger.log(
      "[PARSE_RESULT] " +
        pairs.length +
        "쌍: " +
        pairs
          .map(function (p) {
            return p.name + "→" + p.tracking;
          })
          .join(", "),
    );

    // ── 5단계 매칭 — ★ 2026-07-08: 같은(이름+품목)은 같은 행에 append (허브 동기화) ──
    var matches = [],
      unmatched = [],
      lastRowForName = {};
    var nameItemRowMap = {}; // ★ "이름|품목" → 이미 매칭된 행 번호
    var rowCapacity = {};    // ★ rowIndex → { max: 수량, used: 사용량 } (수량 기반 배분)
    var overflowRows = {};   // ★ rowIndex → 수량을 넘겨 들어간 송장 수 (경고용)

    for (var pi = 0; pi < pairs.length; pi++) {
      var p = pairs[pi];
      var assignedRows = [];
      var matchedName = p.name;
      var isAppend = false;
      var queueKey = null;

      // ★ 0. 같은 (이름+품목) 조합이 이미 행에 배정되었으면
      var itemKey = p.name + "|" + (p.itemName || "").replace(/\s/g, "").toUpperCase();
      if (nameItemRowMap[itemKey] !== undefined) {
        var mapped = nameItemRowMap[itemKey];
        var cap = rowCapacity[mapped.row];

        // ★ 2026-08-25: 배분 기준은 오직 "그 행의 수량"이다.
        //   [기존 버그] 품목명이 있으면 무제한 append 했다. 그래서 같은 수취인·같은 품목이
        //   여러 행(각 수량 1)으로 나뉘어 있을 때 송장이 전부 첫 행에 쌓이고,
        //   나머지 행은 미송장으로 남아 재발주(중복 출고)가 발생했다.
        //   [수정] 여유 수량이 확인된 행에만 append 하고, 아니면 남은 행으로 보낸다.
        if (cap && cap.used < cap.max) {
          // 이 행은 아직 수량이 남았다 → 다중 박스로 보고 같은 행에 append
          cap.used++;
          assignedRows = [mapped.row];
          matchedName = mapped.matchedName || p.name;
          isAppend = true;
        } else {
          // 여유가 없다(또는 수량 열이 없어 여유를 알 수 없다).
          // 같은 이름의 다른 행이 남아 있으면 그 행으로 보낸다.
          // 미송장을 남겨 재발주가 나는 것보다, 행을 나누는 편이 안전하다.
          var fallbackQ = rowQueue[p.name] || rowQueue[mapped.matchedName || p.name];
          if (fallbackQ && fallbackQ.length > 0) {
            delete nameItemRowMap[itemKey]; // 아래 큐 탐색에서 새 행을 받는다
          } else {
            // 배정할 행이 더 없다 → 최후 수단으로 append (송장 유실 방지) + 초과 기록
            assignedRows = [mapped.row];
            matchedName = mapped.matchedName || p.name;
            isAppend = true;
            if (cap) cap.used++;
            overflowRows[mapped.row] = (overflowRows[mapped.row] || 0) + 1;
          }
        }
      }

      if (assignedRows.length === 0) {
        // ── 큐 키 찾기 (1.완전일치 → 2.공백제거 → 3.부분일치 → 4.공백+부분 → 5.유사도) ──

        // 1. 완전 일치
        if (rowQueue[p.name] && rowQueue[p.name].length > 0) {
          queueKey = p.name;
        }
        // 2. 공백 제거 후 비교
        if (!queueKey) {
          var inputNoSp = p.name.replace(/\s/g, "");
          for (var nm in rowQueue) {
            if (rowQueue[nm].length > 0 && nm.replace(/\s/g, "") === inputNoSp) {
              queueKey = nm; matchedName = nm; break;
            }
          }
        }
        // 3. 부분 문자열 포함 (3자 이상, 길이 차이 1 이하)
        if (!queueKey) {
          for (var nm2 in rowQueue) {
            if (rowQueue[nm2].length > 0) {
              var lenDiff = Math.abs(nm2.length - p.name.length);
              if (nm2.length >= 3 && p.name.length >= 3 && lenDiff <= 1) {
                if (nm2.indexOf(p.name) !== -1 || p.name.indexOf(nm2) !== -1) {
                  queueKey = nm2; matchedName = nm2; break;
                }
              }
            }
          }
        }
        // 4. 공백 제거 후 부분 포함 (3자 이상, 길이 차이 1 이하)
        if (!queueKey) {
          var inputNoSp2 = p.name.replace(/\s/g, "");
          for (var nm3 in rowQueue) {
            if (rowQueue[nm3].length > 0) {
              var sheetNoSp = nm3.replace(/\s/g, "");
              var lenDiff2 = Math.abs(sheetNoSp.length - inputNoSp2.length);
              if (sheetNoSp.length >= 3 && inputNoSp2.length >= 3 && lenDiff2 <= 1) {
                if (sheetNoSp.indexOf(inputNoSp2) !== -1 || inputNoSp2.indexOf(sheetNoSp) !== -1) {
                  queueKey = nm3; matchedName = nm3; break;
                }
              }
            }
          }
        }
        // 4.5 ★ 2026-07-24: 토큰 단위 매칭 — "햇살블루 김금자"(상호+이름)처럼
        //   붙어 나오면 각 토큰(2자 이상)을 시트 이름과 정확 대조 (뒤 토큰 우선)
        if (!queueKey && /\s/.test(p.name)) {
          var _toks = p.name.split(/\s+/).filter(function (t) { return t.length >= 2; });
          for (var _tki = _toks.length - 1; _tki >= 0 && !queueKey; _tki--) {
            var _tok = _toks[_tki];
            if (rowQueue[_tok] && rowQueue[_tok].length > 0) {
              queueKey = _tok; matchedName = _tok;
            } else {
              for (var _nmT in rowQueue) {
                if (rowQueue[_nmT].length > 0 && _nmT.replace(/\s/g, "") === _tok) {
                  queueKey = _nmT; matchedName = _nmT; break;
                }
              }
            }
          }
        }
        // 4.6 ★ 역방향: 시트 쪽이 "상호 이름"이고 입력이 이름만인 경우
        if (!queueKey) {
          var _inpTok = p.name.replace(/\s/g, "");
          if (_inpTok.length >= 2) {
            for (var _nmS in rowQueue) {
              if (rowQueue[_nmS].length === 0 || _nmS.indexOf(" ") === -1) continue;
              var _sToks = _nmS.split(/\s+/);
              for (var _ssi = 0; _ssi < _sToks.length; _ssi++) {
                if (_sToks[_ssi] === _inpTok) { queueKey = _nmS; matchedName = _nmS; break; }
              }
              if (queueKey) break;
            }
          }
        }
        // 5. 유사도 매칭
        if (!queueKey) {
          var bestKey = null, bestDist = 999;
          var inputNorm = p.name.replace(/\s/g, "");
          for (var nm4 in rowQueue) {
            if (rowQueue[nm4].length === 0) continue;
            var sheetNorm = nm4.replace(/\s/g, "");
            var maxLen = Math.max(inputNorm.length, sheetNorm.length);
            if (maxLen === 0) continue;
            var dist = _levenshteinLocal_(inputNorm, sheetNorm);
            var threshold = 0;
            if (maxLen >= 6) threshold = 2;
            else if (maxLen >= 3) threshold = 1;
            if (dist > Math.ceil(maxLen * 0.5)) threshold = -1;
            if (dist <= threshold && dist < bestDist) { bestDist = dist; bestKey = nm4; }
          }
          if (bestKey) { queueKey = bestKey; matchedName = bestKey; }
        }

        // ── 행 배정 — ★ 품목명 기반 행 선택 (허브 동기화) ──
        if (queueKey && rowQueue[queueKey] && rowQueue[queueKey].length > 0) {
          var q = rowQueue[queueKey];
          var selectedIdx = 0;

          // 품목명 매칭: pair에 itemName이 있고, 전용양식에 productCol이 있고, 큐에 2건 이상
          if (p.itemName && productCol !== -1 && q.length > 1) {
            var inputItem = String(p.itemName).toUpperCase().replace(/\s/g, "");
            var bestScore = -999, bestQIdx = 0;
            for (var qi = 0; qi < q.length; qi++) {
              var sheetItem = String(data[q[qi]][productCol] || "").toUpperCase().replace(/\s/g, "");
              if (!sheetItem) continue;
              var tokens = inputItem.match(/[A-Z0-9가-힣]+/g) || [];
              var score = 0;
              for (var tk = 0; tk < tokens.length; tk++) {
                if (sheetItem.indexOf(tokens[tk]) !== -1) score += 10;
              }
              if (sheetItem.indexOf(inputItem) !== -1 || inputItem.indexOf(sheetItem) !== -1) score += 50;
              var sizeKeys = ["바디", "캡", "뚜껑", "소", "중", "대", "특대"];
              for (var sk = 0; sk < sizeKeys.length; sk++) {
                var hasInput = inputItem.indexOf(sizeKeys[sk]) !== -1;
                var hasSheet = sheetItem.indexOf(sizeKeys[sk]) !== -1;
                if (hasInput && hasSheet) score += 100;
                else if (hasInput !== hasSheet) score -= 200;
              }
              if (score > bestScore) { bestScore = score; bestQIdx = qi; }
            }
            selectedIdx = bestQIdx;
          }

          assignedRows = [q.splice(selectedIdx, 1)[0]];
          lastRowForName[queueKey] = assignedRows[0];
          lastRowForName[p.name] = assignedRows[0];

          // ★ 이 (이름+품목)의 행 등록 + 수량 기반 용량 초기화
          nameItemRowMap[itemKey] = { row: assignedRows[0], matchedName: matchedName };
          if (qtyCol !== -1) {
            var maxQty = parseInt(data[assignedRows[0]][qtyCol], 10) || 1;
            rowCapacity[assignedRows[0]] = { max: maxQty, used: 1 };
          }
        } else if (lastRowForName[p.name] !== undefined) {
          assignedRows = [lastRowForName[p.name]];
          isAppend = true;
          _imTrackAppend_(rowCapacity, overflowRows, assignedRows[0]);
        } else {
          // lastRowForName에서 부분일치 검색 (3자 이상, 길이 차이 1 이하)
          for (var lrn in lastRowForName) {
            var lenDiff3 = Math.abs(lrn.length - p.name.length);
            if (lrn.length >= 3 && p.name.length >= 3 && lenDiff3 <= 1) {
              if (lrn.indexOf(p.name) !== -1 || p.name.indexOf(lrn) !== -1) {
                assignedRows = [lastRowForName[lrn]];
                matchedName = lrn;
                isAppend = true;
                _imTrackAppend_(rowCapacity, overflowRows, assignedRows[0]);
                break;
              }
            }
          }
        }
      }

      if (assignedRows.length > 0) {
        matches.push({
          tracking: p.tracking,
          name: p.name,
          matchedName: matchedName,
          rows: assignedRows,
          append: isAppend,
          itemName: p.itemName || "",
        });
      } else {
        unmatched.push(p);
      }
    }

    // ★ 2026-07-24: 미매칭 건에 유사 이름 후보 + 남은 수취인 큐 (수동 매칭용)
    var remainingQueue = {};
    for (var rqk in rowQueue) {
      if (rowQueue[rqk] && rowQueue[rqk].length > 0) {
        remainingQueue[rqk] = rowQueue[rqk].slice();
      }
    }
    for (var ui = 0; ui < unmatched.length; ui++) {
      unmatched[ui].suggestions = _imBuildNameSuggestions_(
        unmatched[ui].name,
        remainingQueue,
        3,
      );
    }
    var lastMatchedRows = {};
    for (var lmk in lastRowForName) {
      lastMatchedRows[lmk] = lastRowForName[lmk];
    }

    // ★ 2026-08-25: 반영 전 수량 대비 송장 개수 검증.
    //   미송장으로 남는 행을 미리 보여줘야 재발주를 막을 수 있다.
    var audit = _imAuditRowQty_(data, matches, {
      recipientCol: recipientCol, productCol: productCol, qtyCol: qtyCol,
      overflowRows: overflowRows,
    });

    return {
      matches: matches,
      unmatched: unmatched,
      recipientHeader: String(headers[recipientCol] || ""),
      total: pairs.length,
      parseMethod: parseMethod,
      remainingQueue: remainingQueue,
      lastMatchedRows: lastMatchedRows,
      qtyWarnings: audit.warnings,
      noInvoiceRows: audit.noInvoice,
      hasQtyCol: qtyCol !== -1,
      _debug_sheetNames: Object.keys(nameToRows).slice(0, 20),
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * append 시 용량 사용량을 올리고, 수량을 넘겼으면 초과로 기록한다.
 * (수량 열이 없는 양식은 용량 개념이 없어 아무것도 하지 않는다)
 */
function _imTrackAppend_(rowCapacity, overflowRows, rowIdx) {
  var cap = rowCapacity[rowIdx];
  if (!cap) return;
  if (cap.used >= cap.max) {
    overflowRows[rowIdx] = (overflowRows[rowIdx] || 0) + 1;
  }
  cap.used++;
}

/**
 * 행별 수량 대비 배정된 송장 개수를 검증한다.
 *
 * 이 점검이 필요한 이유: 송장이 한 행에 몰리면 다른 행이 미송장으로 남고,
 * 그 행은 다음 발주 때 재발주 대상이 되어 중복 출고가 난다.
 * 그래서 반영(적용) 전에 운영자가 볼 수 있어야 한다.
 *
 * @return {{warnings: Array, noInvoice: Array}}
 */
function _imAuditRowQty_(data, matches, opt) {
  var recipientCol = opt.recipientCol;
  var productCol = opt.productCol;
  var qtyCol = opt.qtyCol;
  var overflowRows = opt.overflowRows || {};

  var assigned = {};
  for (var mi = 0; mi < matches.length; mi++) {
    var rows = matches[mi].rows || [];
    for (var rj = 0; rj < rows.length; rj++) {
      assigned[rows[rj]] = (assigned[rows[rj]] || 0) + 1;
    }
  }

  var warnings = [];
  var noInvoice = [];
  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][recipientCol] || "").trim();
    if (!name) continue;
    var item = productCol !== -1 ? String(data[i][productCol] || "").trim() : "";
    var want = qtyCol !== -1 ? (parseInt(data[i][qtyCol], 10) || 1) : 1;
    var got = assigned[i] || 0;
    var existing = String(data[i][0] || "").trim(); // A열: 이미 들어있는 송장

    if (got === 0) {
      // 이번에 배정도 없고 기존 송장도 없다 → 반영 후에도 미송장 = 재발주 위험
      if (!existing) {
        noInvoice.push({ row: i + 2, name: name, item: item, qty: want });
      }
      continue;
    }
    if (got !== want) {
      warnings.push({
        row: i + 2, name: name, item: item, qty: want, assigned: got,
        kind: got > want ? "초과" : "부족",
        overflow: overflowRows[i] || 0,
      });
    }
  }
  return { warnings: warnings, noInvoice: noInvoice };
}

// ── 서버: 전용양식에 반영 ──
function applyInvoiceMatchesLocal(matchesJson) {
  try {
    var matches = JSON.parse(matchesJson);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var exTab = null;
    var tabs = ss.getSheets();
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].getName().indexOf("전용양식") !== -1) {
        exTab = tabs[ti];
        break;
      }
    }
    if (!exTab) return { msg: "❌ 전용양식 탭 없음" };

    var lr = exTab.getLastRow();
    var lc = Math.max(exTab.getLastColumn(), 1);
    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();
    var writeCount = 0;
    // 대한통운 양식: 「운송장번호」열(A열 송장번호와 별도)에도 동기
    var _cjInvCol = -1;
    for (var _hci = 0; _hci < headers.length; _hci++) {
      var _hh = String(headers[_hci] || "").replace(/\s/g, "");
      if (_hh === "운송장번호" || _hh.indexOf("운송장번호") !== -1) {
        _cjInvCol = _hci;
        break;
      }
    }

    for (var mi = 0; mi < matches.length; mi++) {
      var m = matches[mi];
      if (!m.rows) continue;
      for (var ri = 0; ri < m.rows.length; ri++) {
        var idx = m.rows[ri];
        if (idx >= 0 && idx < data.length) {
          var ex = String(data[idx][0] || "").trim();
          var tracking = String(m.tracking || "").trim();
          data[idx][0] =
            m.append && ex ? ex + "\n" + tracking : tracking;
          data[idx][1] = "발송완료";
          // ★ 2026-08-06: 대한통운 등 「운송장번호」열이 있으면 A열과 동기
          if (_cjInvCol >= 0 && tracking) {
            var exCj = String(data[idx][_cjInvCol] || "").trim();
            data[idx][_cjInvCol] =
              m.append && exCj ? exCj + "\n" + tracking : tracking;
          }
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

// ── 서버: 이미지 AI 분석 + 전용양식 매칭 (★ 2026-07-08 추가) ──
function parseAndMatchInvoiceImageLocal(base64Data) {
  try {
    // 1단계: Gemini Vision으로 이미지에서 수취인/송장/품목 추출
    var pairs = _parseInvoiceFileWithGemini_(base64Data);
    if (pairs && pairs.length > 0) {
      // 추출된 pairs를 텍스트로 변환하여 기존 parseAndMatchInvoiceTextLocal 재사용
      var textLines = pairs.map(function(p) {
        return p.tracking + "\t" + p.name + (p.itemName ? "\t" + p.itemName : "");
      });
      var result = parseAndMatchInvoiceTextLocal(textLines.join("\n"));
      if (result) result.parseMethod = "gemini-image";
      return result;
    }
    return { error: "이미지에서 송장 정보를 인식하지 못했습니다. 텍스트 붙여넣기를 시도해주세요." };
  } catch (e) {
    return { error: "이미지 분석 오류: " + e.message };
  }
}

// ══════════════════════════════════════════════════════════════
// 텍스트 파서 (★ v2: 허브 _pep_parseInvoiceNamePairs_ 동기화)
// ══════════════════════════════════════════════════════════════
function _parseInvoicePairs_(text) {
  // ★ 택배사명 제거
  var COURIER_NAMES =
    /[|｜\s]*(롯데택배|CJ대한통운|한진택배|우체국택배|로젠택배|경동택배|대신택배|일양로지스|천일택배|합동택배|건영택배|호남택배|CVSnet|GSpostbox|CJ택배|택배)/gi;

  // ★ "택배사명 / " 프리픽스 제거 ("롯데약국" 보호)
  var COURIER_PREFIX =
    /^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\s*[\/]\s*/gim;

  // ★ 거래명세서 노이즈 줄 제거
  var NOISE_LINE_PATTERNS =
    /^.*(등록번호|사업자|TEL|FAX|전화|팩스|계좌|은행|입금바랍니다|거래명세서|공급가액|부가세|합계|수량|단가|품목|규격|거래일|상\s*호|업\s*태|종\s*목|주\s*소|성\s*명).*$/gim;

  // 전처리
  var preprocessed = text
    .replace(COURIER_NAMES, "")
    .replace(COURIER_PREFIX, "")
    .replace(NOISE_LINE_PATTERNS, "");

  // ★ 2026-07-07: TSV(탭 구분) 형식 사전 감지 — 택배사 엑셀 데이터 지원
  var rawLines = preprocessed.split(/[\r\n]+/).filter(function(l) { return l.trim().length > 0; });
  var tsvCount = 0;
  for (var _ti = 0; _ti < Math.min(rawLines.length, 10); _ti++) {
    if ((rawLines[_ti].match(/\t/g) || []).length >= 3) tsvCount++;
  }
  var isTsvMode = tsvCount >= Math.min(rawLines.length, 10) * 0.6;

  if (isTsvMode) {
    // TSV 모드: 열 자동 감지 후 이름+송장+품목명 추출
    var tsvPairs = [];
    var _tsvRows = rawLines.map(function(l) { return l.split(/\t/); });
    // 헤더/열 감지: 송장번호열, 수취인열, 품목명열
    var _invCol = -1, _nameCol = -1, _itemCol = -1;
    // 1차: 첫 행이 헤더인지 확인
    if (_tsvRows.length > 0) {
      var _hdrRow = _tsvRows[0];
      for (var _hc = 0; _hc < _hdrRow.length; _hc++) {
        var _hv = String(_hdrRow[_hc]).replace(/\s/g, "");
        if (_invCol === -1 && /송장|운송장|바코드|택배번호/.test(_hv)) _invCol = _hc;
        if (_nameCol === -1 && /수취인|받는분|받는사람|수령인|고객명|이름/.test(_hv) && !/주소|전화|보내는|송하인/.test(_hv)) _nameCol = _hc;
        if (_itemCol === -1 && /품목|상품|물품|품명|제품/.test(_hv) && !/코드/.test(_hv)) _itemCol = _hc;
      }
    }
    // 2차: 헤더 없으면 데이터 샘플링
    if (_invCol === -1) {
      var _startRow = 0;
      for (var _sr = 0; _sr < Math.min(_tsvRows.length, 3); _sr++) {
        for (var _sc = 0; _sc < _tsvRows[_sr].length; _sc++) {
          var _sv = String(_tsvRows[_sr][_sc]).replace(/[-\s]/g, "");
          if (_invCol === -1 && /^\d{10,14}$/.test(_sv)) _invCol = _sc;
        }
        if (_invCol !== -1) { _startRow = _sr; break; }
      }
      // 수취인: 송장열 뒤에서 한글 2~15자 패턴
      // ★ 2026-07-07: 반복 값 열(송하인/택배사) 제외 — 고유값 많은 열 = 수취인
      if (_invCol !== -1 && _tsvRows.length > _startRow) {
        // 각 열의 고유값 수 계산
        var _colUnique = {};
        var _sampleMax = Math.min(_tsvRows.length, 15);
        for (var _uc = 0; _uc < (_tsvRows[0] || []).length; _uc++) {
          var _vals = {};
          for (var _ur = _startRow; _ur < _sampleMax; _ur++) {
            var _uv = String((_tsvRows[_ur] || [])[_uc] || "").trim();
            if (_uv) _vals[_uv] = true;
          }
          _colUnique[_uc] = Object.keys(_vals).length;
        }
        var _SENDER_PATTERN = /택배|주식회사|팩투유|Pack2U|유한|합자|법인|상사|물류|운송|공급|업체|발송/i;
        var _nameCandidates = [];
        for (var _nc = 0; _nc < _tsvRows[_startRow].length; _nc++) {
          if (_nc === _invCol) continue;
          var _nv = String(_tsvRows[_startRow][_nc]).trim();
          if (!/^[가-힣\s()（）]{2,15}$/.test(_nv.replace(/\(.*\)/, ""))) continue;
          if (/시\s|구\s|동\s|로\s|길\s/.test(_nv)) continue;
          if (_SENDER_PATTERN.test(_nv)) continue;
          var _uniqueCnt = _colUnique[_nc] || 0;
          var _dataRows = _sampleMax - _startRow;
          if (_dataRows >= 3 && _uniqueCnt <= 2) continue;
          _nameCandidates.push({ col: _nc, unique: _uniqueCnt });
        }
        if (_nameCandidates.length > 0) {
          _nameCandidates.sort(function(a, b) { return b.unique - a.unique; });
          _nameCol = _nameCandidates[0].col;
        }
        // 품목명: 용기/캡/바디/Ø/PET 등 패턴 탐색
        for (var _ic = 0; _ic < _tsvRows[_startRow].length; _ic++) {
          if (_ic === _invCol || _ic === _nameCol) continue;
          var _iv = String(_tsvRows[_startRow][_ic]).trim();
          if (_iv.length >= 2 && _iv.length <= 60 && /[가-힣]/.test(_iv) && !/시\s|구\s|동\s|로\s|길\s/.test(_iv)) {
            if (/용기|캡|바디|뚜껑|Ø|파이|PET|PP|소\(|중\(|대\(|세트|팩|박스|접시/i.test(_iv) ||
                (/[0-9]/.test(_iv) && _iv.length <= 30)) {
              _itemCol = _ic;
              break;
            }
          }
        }
      }
    }
    // TSV 파싱
    if (_invCol !== -1 && _nameCol !== -1) {
      var _dataStart = (_invCol === -1) ? 0 : 0;
      // 첫 행이 헤더면 스킵
      if (_tsvRows.length > 0) {
        var _firstInv = String(_tsvRows[0][_invCol] || "").replace(/[-\s]/g, "");
        if (!/^\d{10,14}$/.test(_firstInv)) _dataStart = 1;
      }
      for (var _di = _dataStart; _di < _tsvRows.length; _di++) {
        var _row = _tsvRows[_di];
        if (_row.length <= _invCol) continue;
        var _track = String(_row[_invCol] || "").replace(/[-\s]/g, "").trim();
        if (!/^\d{10,14}$/.test(_track)) continue;
        var _name = _nameCol >= 0 && _nameCol < _row.length ? String(_row[_nameCol] || "").replace(/\s*님\s*/g, "").trim() : "";
        var _item = _itemCol >= 0 && _itemCol < _row.length ? String(_row[_itemCol] || "").trim() : "";
        if (_name) {
          tsvPairs.push({ tracking: _track, name: _name, itemName: _item });
        }
      }
      if (tsvPairs.length > 0) return tsvPairs;
    }
  }

  var lines = preprocessed
    .split(/[\r\n]+/)
    .map(function (l) {
      return l.replace(/\t/g, "   ").trim();
    })
    .filter(function (l) {
      return l.length > 0;
    });

  var pairs = [];
  var trackingLines = [];
  var nameLines = [];
  var pairedLines = [];

  // ★ 송장번호 추출 + 사업자등록번호/전화번호 필터
  function _extractTracking(raw) {
    var trimmed = raw.trim();
    if (/^\d{3}-\d{2}-\d{5}$/.test(trimmed)) return null; // 사업자등록번호
    if (/^0\d{1,2}-\d{3,4}-\d{4}$/.test(trimmed)) return null; // 전화번호
    var digits = trimmed.replace(/[-\s]/g, "");
    if (/^\d{10,14}$/.test(digits)) return digits;
    return null;
  }

  // ★ 이름 정규화: "님", "|", "/" 제거
  function _cleanName(n) {
    return n
      .replace(/[|｜\/]/g, "")
      .replace(/\s*님\s*/g, "")
      .trim();
  }

  // ★ 이름 유효성 (한글 + 영문 + 혼합)
  function _isValidName(n) {
    if (!n || n.length < 2) return false;
    if (/^\d+$/.test(n)) return false;
    if (/^[가-힣\s]{2,15}$/.test(n)) return true; // 한글
    if (/^[A-Za-z\s]{2,30}$/.test(n)) return true; // 영문
    if (/[가-힣]/.test(n) && n.length >= 2 && n.length <= 20) return true; // 혼합
    return false;
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // ★ 0단계: 인라인 파싱 (한 줄에 "이름1 번호1 이름2 번호2...")
    var inlineMatches = line.match(/[A-Za-z가-힣\s]{2,30}\s+\d{10,14}/g);
    if (inlineMatches && inlineMatches.length >= 2) {
      for (var im = 0; im < inlineMatches.length; im++) {
        var imParts = inlineMatches[im].trim().match(/^(.+?)\s+(\d{10,14})$/);
        if (imParts) {
          var imName = _cleanName(imParts[1]);
          var imTrack = _extractTracking(imParts[2]);
          if (imTrack && _isValidName(imName)) {
            pairedLines.push({ tracking: imTrack, name: imName });
          } else if (imTrack) {
            trackingLines.push(imTrack);
          }
        }
      }
      var remainDigits = line.replace(/[A-Za-z가-힣\s]{2,30}\s+\d{10,14}/g, "");
      var extraNums = remainDigits.match(/\d{10,14}/g);
      if (extraNums) {
        for (var en = 0; en < extraNums.length; en++) {
          var et = _extractTracking(extraNums[en]);
          if (et) trackingLines.push(et);
        }
      }
      continue;
    }

    // ① 번호 + 이름
    var m1 = line.match(/^([\d\-]{10,20})\s{1,}(.+)$/);
    if (m1) {
      var t1 = _extractTracking(m1[1]);
      var n1 = _cleanName(m1[2]);
      if (t1 && _isValidName(n1)) {
        pairedLines.push({ tracking: t1, name: n1 });
        continue;
      } else if (t1) {
        trackingLines.push(t1);
        continue;
      }
    }

    // ★ ①-b 이름 + 번호1 / 번호2 / 번호3 (슬래시 구분 다중 송장)
    var mMulti = line.match(/^(.+?)\s{1,}([\d\-]{10,20}(?:\s*\/\s*[\d\-]{10,20})+)$/);
    if (mMulti) {
      var mName = _cleanName(mMulti[1]);
      var mInvoices = mMulti[2].split(/\s*\/\s*/);
      var anyMatched = false;
      for (var mi = 0; mi < mInvoices.length; mi++) {
        var mt = _extractTracking(mInvoices[mi].trim());
        if (mt && _isValidName(mName)) {
          pairedLines.push({ tracking: mt, name: mName });
          anyMatched = true;
        } else if (mt) {
          trackingLines.push(mt);
          anyMatched = true;
        }
      }
      if (anyMatched) continue;
    }

    // ② 이름 + 번호
    var m2 = line.match(/^(.+?)\s{1,}([\d\-]{10,20})$/);
    if (m2) {
      var t2 = _extractTracking(m2[2]);
      var n2 = _cleanName(m2[1]);
      if (t2 && _isValidName(n2)) {
        pairedLines.push({ tracking: t2, name: n2 });
        continue;
      } else if (t2) {
        trackingLines.push(t2);
        continue;
      }
    }

    // ③ 번호만
    var solo = _extractTracking(line);
    if (solo && /^[\d\-]+$/.test(line.trim())) {
      trackingLines.push(solo);
      continue;
    }

    // ④ 이름만
    var nameCandidates = line.split(/\s{2,}/);
    for (var ni = 0; ni < nameCandidates.length; ni++) {
      var nc = _cleanName(nameCandidates[ni]);
      if (_isValidName(nc)) {
        nameLines.push(nc);
      }
    }
  }

  // pairedLines 먼저 추가
  for (var pi2 = 0; pi2 < pairedLines.length; pi2++)
    pairs.push(pairedLines[pi2]);

  // 번호만/이름만 줄 매칭
  if (trackingLines.length > 0 && nameLines.length > 0) {
    var mc = Math.min(trackingLines.length, nameLines.length);
    for (var mi2 = 0; mi2 < mc; mi2++)
      pairs.push({ tracking: trackingLines[mi2], name: nameLines[mi2] });
  } else if (trackingLines.length > 0) {
    var pending = null;
    for (var fi = 0; fi < lines.length; fi++) {
      var fLine = lines[fi];
      var ft = _extractTracking(fLine);
      if (ft && /^[\d\-]+$/.test(fLine.trim())) {
        pending = ft;
        continue;
      }
      var fn = _cleanName(fLine);
      if (_isValidName(fn) && pending) {
        pairs.push({ tracking: pending, name: fn });
        pending = null;
      }
    }
  }
  return pairs;
}

// ── OCR API 키 반환 (사이드바 HTML 주입용) ──
// ★ 2026-06-22: PropertiesService 제거 (업체 시트 권한 문제 방지)
//   GEMINI_API_KEY는 허브(_secrets.gs)와 업체(주입)에서 항상 전역 변수로 정의됨
function _getOcrApiKey_() {
  if (typeof GEMINI_API_KEY !== "undefined") return GEMINI_API_KEY;
  return "";
}

// ── 인라인 HTML 사이드바 (텍스트/엑셀/이미지 OCR 탭) ──
function _getInvoiceMatchHtml_() {
  return (
    '<!DOCTYPE html><html><head><base target="_top"><style>' +
    "*{box-sizing:border-box;margin:0;padding:0}" +
    'body{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:13px;background:#f0f2f5;display:flex;flex-direction:column;height:100vh}' +
    ".hd{background:#1a73e8;color:white;padding:12px 16px;font-size:15px;font-weight:bold;flex-shrink:0}" +
    ".sc{background:white;margin:8px 8px 0;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)}" +
    ".st{font-size:11px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}" +
    "textarea{width:100%;height:110px;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:12px;font-family:monospace;resize:none}" +
    ".btn{width:100%;padding:9px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;margin-top:8px;transition:.15s}" +
    ".bb{background:#1a73e8;color:white}.bb:hover{background:#1558b0}" +
    ".bg{background:#34a853;color:white}.bg:hover{background:#2d8f46}" +
    ".bo{background:#f29900;color:white}.bo:hover{background:#d88a00}" +
    ".btn:disabled{background:#ccc;cursor:not-allowed}" +
    "#rs{flex:1;overflow-y:auto;display:none}" +
    ".sum{margin:8px;background:white;border-radius:8px;padding:10px 12px;font-size:12px;color:#444;box-shadow:0 1px 3px rgba(0,0,0,.1)}" +
    "table{width:100%;border-collapse:collapse;font-size:12px}" +
    "th{background:#f8f9fa;padding:6px 8px;text-align:left;font-size:11px;color:#666}" +
    "td{padding:5px 8px;border-bottom:1px solid #f0f0f0}" +
    ".ok{color:#34a853;font-weight:bold}.err{color:#ea4335;font-weight:bold}" +
    ".tr{font-size:11px;color:#555;font-family:monospace}" +
    "#toast{display:none;position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:8px 18px;border-radius:20px;font-size:12px;z-index:999}" +
    ".tab-bar{display:flex;margin:8px 8px 0;gap:2px}" +
    ".tab-btn{flex:1;padding:8px 4px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:12px;font-weight:bold;background:#e0e0e0;color:#666;transition:.15s}" +
    ".tab-btn.active{background:white;color:#1a73e8;box-shadow:0 -1px 3px rgba(0,0,0,.1)}" +
    ".tab-content{display:none}.tab-content.active{display:block}" +
    ".img-drop{border:2px dashed #ccc;padding:16px;border-radius:6px;background:#fafafa;text-align:center;cursor:pointer;transition:.2s;min-height:80px}" +
    ".img-drop.dragover{background:#e8f0fe;border-color:#1a73e8}" +
    ".img-drop.has-img{border-color:#34a853;background:#f6fff6}" +
    ".img-preview{max-width:100%;max-height:150px;border-radius:4px;margin-top:8px;border:1px solid #ddd}" +
    "</style></head><body>" +
    '<div class="hd">📬 카카오 송장번호 매칭</div>' +
    '<div class="tab-bar">' +
    '<button class="tab-btn active" onclick="switchTab(\'text\')">📋 텍스트/엑셀</button>' +
    '<button class="tab-btn" onclick="switchTab(\'image\')">🖼️ 이미지 OCR</button>' +
    "</div>" +
    '<div class="sc" style="border-radius:0 0 8px 8px;margin-top:0">' +
    '<div id="tab-text" class="tab-content active">' +
    '<div id="dropZone" style="margin-bottom:8px;border:2px dashed #ccc;padding:12px;border-radius:6px;background:#fafafa;text-align:center;cursor:pointer" onclick="document.getElementById(\'fileUpload\').click()">' +
    '<div style="font-size:13px;color:#555;margin-bottom:4px">📂 엑셀 파일을 여기에 드래그 앤 드롭</div>' +
    '<div style="font-size:11px;color:#888">또는 클릭하여 파일 선택</div>' +
    '<input type="file" id="fileUpload" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleFileUpload(event)">' +
    "</div>" +
    '<textarea id="rt" placeholder="예시:\n44363801252   최고갈비\n443-8937-1622   임병혁"></textarea>' +
    "</div>" +
    '<div id="tab-image" class="tab-content">' +
    '<div id="imgDrop" class="img-drop" onclick="document.getElementById(\'imgUpload\').click()">' +
    '<div id="imgPh"><div style="font-size:22px;margin-bottom:6px">📸</div>' +
    '<div style="font-size:13px;color:#555">이미지를 붙여넣기(Ctrl+V) 하거나</div>' +
    '<div style="font-size:13px;color:#555;margin-bottom:4px">드래그 앤 드롭 / 클릭하여 선택</div>' +
    '<div style="font-size:11px;color:#aaa">송장 목록 스크린샷을 넣으세요</div></div>' +
    '<input type="file" id="imgUpload" accept="image/*" style="display:none" onchange="handleImgFile(event)">' +
    "</div>" +
    '<div id="imgPrevArea" style="display:none;text-align:center;margin-top:8px">' +
    '<img id="imgPrev" class="img-preview">' +
    '<div id="ocrStatus" style="font-size:11px;color:#888;margin-top:4px"></div></div>' +
    '<button class="btn bo" id="ocrBtn" onclick="runOCR()" style="display:none">🔍 이미지에서 텍스트 추출</button>' +
    "</div>" +
    '<button class="btn bb" id="ab" onclick="analyze()">🔍 분석</button>' +
    "</div>" +
    '<div id="rs"><div class="sum" id="sum"></div>' +
    '<div class="sc" style="margin-bottom:8px">' +
    '<button class="btn bg" id="apb" onclick="applyAll()">✅ 전용양식에 반영</button>' +
    '<table><thead><tr><th>이름</th><th>송장번호</th><th>행</th><th></th></tr></thead><tbody id="mt"></tbody></table>' +
    '</div></div><div id="toast"></div>' +
    "<script>var _m=null,_imgB64=null;" +
    'function toast(msg,ms){var el=document.getElementById("toast");el.textContent=msg;el.style.display="block";setTimeout(function(){el.style.display="none"},ms||2500)}' +
    'function switchTab(t){document.querySelectorAll(".tab-btn").forEach(function(b,i){b.classList.toggle("active",(t==="text"&&i===0)||(t==="image"&&i===1))});' +
    'document.getElementById("tab-text").classList.toggle("active",t==="text");document.getElementById("tab-image").classList.toggle("active",t==="image")}' +
    'function handleImgData(b64){_imgB64=b64;document.getElementById("imgPrev").src=b64;document.getElementById("imgPrevArea").style.display="block";' +
    'document.getElementById("imgPh").style.display="none";document.getElementById("imgDrop").classList.add("has-img");document.getElementById("ocrBtn").style.display="block";' +
    'document.getElementById("ocrStatus").textContent="이미지 준비 완료"}' +
    'function handleImgFile(e){var f=e.target.files[0];if(!f||!f.type.startsWith("image/"))return;var r=new FileReader();r.onload=function(ev){handleImgData(ev.target.result)};r.readAsDataURL(f)}' +
    'document.addEventListener("paste",function(e){var cd=e.clipboardData||window.clipboardData;if(!cd)return;var items=cd.items;' +
    'if(items){for(var i=0;i<items.length;i++){if(items[i].type.indexOf("image")!==-1){e.preventDefault();var f=items[i].getAsFile();' +
    'var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f);return}}}});' +
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
    "if(e.dataTransfer.files&&e.dataTransfer.files.length>0){var f=e.dataTransfer.files[0];" +
    'if(f&&f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f)}' +
    'else{document.getElementById("fileUpload").files=e.dataTransfer.files;handleFileUpload({target:{files:e.dataTransfer.files}})}}})});' +
    'function runOCR(){if(!_imgB64)return toast("이미지를 먼저 붙여넣으세요",2000);' +
    'var btn=document.getElementById("ocrBtn");var st=document.getElementById("ocrStatus");' +
    'btn.disabled=true;btn.textContent="📡 OCR 처리 중...";st.textContent="Gemini Vision으로 분석 중...";' +
    'var apiKey=document.getElementById("_ocrKey").value;' +
    'if(!apiKey){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";st.textContent="❌ API 키 없음";toast("OCR API 키가 설정되지 않았습니다.",3000);return}' +
    'var mimeType="image/png";var rawB64=_imgB64;' +
    'if(_imgB64.indexOf(",")!==-1){var pp=_imgB64.split(",");var mmm=pp[0].match(/data:([^;]+)/);if(mmm)mimeType=mmm[1];rawB64=pp[1]}' +
    'var url="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key="+apiKey;' +
    'var prompt="이 이미지에서 택배 수취인(받는사람) 이름과 택배 송장번호(10~14자리 숫자)를 추출.\\n"' +
    '+"사업자등록번호,전화번호,계좌번호 제외.\\n"' +
    '+"형식: 이름 송장번호 (공백구분, 한줄에 1쌍)\\n"' +
    '+"택배사명은 이름이 아님. 님 제거. 영문이름 포함.";' +
    "var payload={contents:[{parts:[{text:prompt},{inline_data:{mime_type:mimeType,data:rawB64}}]}],generationConfig:{temperature:0.1,maxOutputTokens:8192}};" +
    'fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})' +
    ".then(function(r){return r.json()})" +
    '.then(function(json){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";' +
    'if(json.error){st.textContent="❌ 오류: "+json.error.message;toast("OCR 오류: "+json.error.message,4000);return}' +
    "var b3=String.fromCharCode(96,96,96);" +
    'var text=(json.candidates[0].content.parts[0].text||"").replace(new RegExp(b3+"[a-z]*\\\\n?","gi"),"").replace(new RegExp(b3,"g"),"").trim();' +
    'if(!text||text.length<3){st.textContent="❌ 텍스트를 인식하지 못했습니다.";toast("이미지에서 텍스트를 인식하지 못했습니다.",3000);return}' +
    'document.getElementById("rt").value=text;st.textContent="✅ "+text.split("\\n").length+"줄 추출 완료!";switchTab("text");toast("OCR 완료! 분석 버튼을 눌러주세요.",3000)})' +
    '.catch(function(e){btn.disabled=false;btn.textContent="🔍 이미지에서 텍스트 추출";st.textContent="❌ 오류: "+e.message;toast("OCR 오류: "+e.message,4000)})}' +
    "function handleFileUpload(e){var f=e.target.files[0];if(!f)return;" +
    'if(f.type.startsWith("image/")){var r=new FileReader();r.onload=function(ev){switchTab("image");handleImgData(ev.target.result)};r.readAsDataURL(f);return}' +
    'var btn=document.getElementById("ab");btn.textContent="파일 읽는 중...";btn.disabled=true;' +
    "var reader=new FileReader();reader.onload=function(evt){var data=new Uint8Array(evt.target.result);" +
    'try{var wb=XLSX.read(data,{type:"array"});document.getElementById("rt").value=XLSX.utils.sheet_to_txt(wb.Sheets[wb.SheetNames[0]]);toast("엑셀 파일 로드 완료!",3000)}' +
    'catch(err){toast("파일 읽기 오류: "+err.message,4000)}finally{btn.textContent="🔍 분석";btn.disabled=false}};reader.readAsArrayBuffer(f)}' +
    "function _levenshteinLocal_(a,b){if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;var m=[];" +
    "for(var i=0;i<=b.length;i++)m[i]=[i];for(var j=0;j<=a.length;j++)m[0][j]=j;" +
    "for(var i2=1;i2<=b.length;i2++){for(var j2=1;j2<=a.length;j2++){if(b.charAt(i2-1)===a.charAt(j2-1)){m[i2][j2]=m[i2-1][j2-1]}" +
    "else{m[i2][j2]=Math.min(m[i2-1][j2-1]+1,m[i2][j2-1]+1,m[i2-1][j2]+1)}}}return m[b.length][a.length]}" +
    "function _parseInvoicePairs_(text){var cn=/[|｜\\s]*(롯데택배|CJ대한통운|한진택배|우체국택배|로젠택배|경동택배|대신택배|일양로지스|천일택배|합동택배|건영택배|호남택배|CVSnet|GSpostbox|CJ택배|택배)/gi;" +
    "var cp=/^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\\s*[\\/]\\s*/gim;" +
    "var nl=/^.*(등록번호|사업자|TEL|FAX|전화|팩스|계좌|은행|입금바랍니다|거래명세서|공급가액|부가세|합계|수량|단가|품목|규격|거래일|상\\s*호|업\\s*태|종\\s*목|주\\s*소|성\\s*명).*$/gim;" +
    'var pp=text.replace(cn,"").replace(cp,"").replace(nl,"");' +
    'var lines=pp.split(/[\\r\\n]+/).map(function(l){return l.replace(/\\t/g,"   ").trim()}).filter(function(l){return l.length>0});' +
    "var pairs=[],tl=[],nl_arr=[],pl=[];" +
    "function exT(r){var tr=r.trim();if(/^\\d{3}-\\d{2}-\\d{5}$/.test(tr))return null;if(/^0\\d{1,2}-\\d{3,4}-\\d{4}$/.test(tr))return null;" +
    'var dg=tr.replace(/[-\\s]/g,"");if(/^\\d{10,14}$/.test(dg))return dg;return null}' +
    'function clN(n){return n.replace(/[|｜\\/]/g,"").replace(/\\s*님\\s*/g,"").trim()}' +
    "function valN(n){if(!n||n.length<2)return false;if(/^\\d+$/.test(n))return false;if(/^[가-힣\\s]{2,15}$/.test(n))return true;" +
    "if(/^[A-Za-z\\s]{2,30}$/.test(n))return true;if(/[가-힣]/.test(n)&&n.length>=2&&n.length<=20)return true;return false}" +
    "for(var i=0;i<lines.length;i++){var line=lines[i];var im=line.match(/[A-Za-z가-힣\\s]{2,30}\\s+\\d{10,14}/g);" +
    "if(im&&im.length>=2){for(var j=0;j<im.length;j++){var imp=im[j].trim().match(/^(.+?)\\s+(\\d{10,14})$/);" +
    "if(imp){var imn=clN(imp[1]),imt=exT(imp[2]);if(imt&&valN(imn)){pl.push({tracking:imt,name:imn})}else if(imt){tl.push(imt)}}}" +
    'var rd=line.replace(/[A-Za-z가-힣\\s]{2,30}\\s+\\d{10,14}/g,"");var en=rd.match(/\\d{10,14}/g);' +
    "if(en){for(var k=0;k<en.length;k++){var et=exT(en[k]);if(et)tl.push(et)}}continue}" +
    "var m1=line.match(/^([\\d\\-]{10,20})\\s{1,}(.+)$/);if(m1){var t1=exT(m1[1]),n1=clN(m1[2]);" +
    "if(t1&&valN(n1)){pl.push({tracking:t1,name:n1});continue}else if(t1){tl.push(t1);continue}}" +
    "var m2=line.match(/^(.+?)\\s{1,}([\\d\\-]{10,20})$/);if(m2){var t2=exT(m2[2]),n2=clN(m2[1]);" +
    "if(t2&&valN(n2)){pl.push({tracking:t2,name:n2});continue}else if(t2){tl.push(t2);continue}}" +
    "var mM=line.match(/^(.+?)\\s{1,}([\\d\\-]{10,20}(?:\\s*\\/\\s*[\\d\\-]{10,20})+)$/);if(mM){var mNm=clN(mM[1]),mIvs=mM[2].split(/\\s*\\/\\s*/),mOk=false;" +
    "for(var mi=0;mi<mIvs.length;mi++){var mt=exT(mIvs[mi].trim());if(mt&&valN(mNm)){pl.push({tracking:mt,name:mNm});mOk=true}else if(mt){tl.push(mt);mOk=true}}if(mOk)continue}" +
    "var sl=exT(line);if(sl&&/^[\\d\\-]+$/.test(line.trim())){tl.push(sl);continue}" +
    "var nc=line.split(/\\s{2,}/);for(var j=0;j<nc.length;j++){var ncc=clN(nc[j]);if(valN(ncc))nl_arr.push(ncc)}}" +
    "for(var j=0;j<pl.length;j++)pairs.push(pl[j]);" +
    "if(tl.length>0&&nl_arr.length>0){var mc=Math.min(tl.length,nl_arr.length);for(var j=0;j<mc;j++)pairs.push({tracking:tl[j],name:nl_arr[j]})}" +
    "else if(tl.length>0){var pd=null;for(var j=0;j<lines.length;j++){var fl=lines[j];var ft=exT(fl);" +
    "if(ft&&/^[\\d\\-]+$/.test(fl.trim())){pd=ft;continue}var fn=clN(fl);if(valN(fn)&&pd){pairs.push({tracking:pd,name:fn});pd=null}}}" +
    "return pairs}" +
    "function analyze(){" +
    'var rt=document.getElementById("rt").value.trim();if(!rt)return toast("텍스트를 붙여넣으세요.",2000);' +
    'var btn=document.getElementById("ab");btn.disabled=true;btn.textContent="분석 중...";' +
    'document.getElementById("rs").style.display="none";' +
    "try{" +
    'var nameToRows=JSON.parse(document.getElementById("_nameToRows").value||"{}");' +
    'var recipientHeader=document.getElementById("_recipientHeader").value||"";' +
    "var rowQueue={};for(var k in nameToRows){rowQueue[k]=nameToRows[k].slice()}" +
    "var pairs=_parseInvoicePairs_(rt);" +
    'if(pairs.length===0){btn.disabled=false;btn.textContent="🔍 분석";return toast("인식된 쌍 없음. 형식: \'송장번호   이름\'",3000)}' +
    "var cpf=/^(롯데|CJ|한진|우체국|로젠|경동|대신|일양|천일|합동|건영|호남)\\s*[\\/]\\s*/i;" +
    'for(var i=0;i<pairs.length;i++){if(pairs[i].name){pairs[i].name=pairs[i].name.normalize("NFC").replace(cpf,"").replace(/^[\\s\\/]+/,"").trim()}}' +
    "var matches=[],unmatched=[],lastRow={};" +
    "for(var i=0;i<pairs.length;i++){" +
    "var p=pairs[i];var assigned=[];var mName=p.name;var isAp=false;var qKey=null;" +
    "if(rowQueue[p.name]&&rowQueue[p.name].length>0){qKey=p.name}" +
    'if(!qKey){var inSp=p.name.replace(/\\s/g,"");for(var nm in rowQueue){if(rowQueue[nm].length>0&&nm.replace(/\\s/g,"")===inSp){qKey=nm;mName=nm;break}}}' +
    "if(!qKey){for(var nm in rowQueue){if(rowQueue[nm].length>0&&(nm.indexOf(p.name)!==-1||p.name.indexOf(nm)!==-1)){qKey=nm;mName=nm;break}}}" +
    'if(!qKey){var inSp=p.name.replace(/\\s/g,"");for(var nm in rowQueue){if(rowQueue[nm].length>0){var shSp=nm.replace(/\\s/g,"");if(shSp.indexOf(inSp)!==-1||inSp.indexOf(shSp)!==-1){qKey=nm;mName=nm;break}}}}' +
    'if(!qKey){var bK=null,bD=999,inN=p.name.replace(/\\s/g,"");for(var nm in rowQueue){if(rowQueue[nm].length===0)continue;' +
    'var shN=nm.replace(/\\s/g,"");var maxL=Math.max(inN.length,shN.length);if(maxL===0)continue;var ds=_levenshteinLocal_(inN,shN);' +
    "var th=Math.max(2,Math.floor(maxL*0.3));if(ds>Math.ceil(maxL*0.5))th=-1;if(ds<=th&&ds<bD){bD=ds;bK=nm}}}if(bK){qKey=bK;mName=bK}}" +
    "if(qKey&&rowQueue[qKey].length>0){assigned=[rowQueue[qKey].shift()];lastRow[qKey]=assigned[0];lastRow[p.name]=assigned[0]}" +
    "else if(lastRow[p.name]!==undefined){assigned=[lastRow[p.name]];isAp=true}" +
    "else{for(var lrn in lastRow){if(lrn.indexOf(p.name)!==-1||p.name.indexOf(lrn)!==-1){assigned=[lastRow[lrn]];mName=lrn;isAp=true;break}}}" +
    "if(assigned.length>0){matches.push({tracking:p.tracking,name:p.name,matchedName:mName,rows:assigned,append:isAp})}" +
    "else{unmatched.push(p)}}" +
    "_m=matches;" +
    "var ok=matches.filter(function(m){return m.rows&&m.rows.length>0});var no=unmatched;" +
    'document.getElementById("sum").innerHTML="<b>수취인 열:</b> "+recipientHeader+"&nbsp;|&nbsp;<span class=ok>✅ "+ok.length+"건</span>&nbsp;<span class=err>❌ "+no.length+"건</span>";' +
    'var tb=document.getElementById("mt");tb.innerHTML="";' +
    'ok.forEach(function(m){var rn=m.rows.map(function(r){return r+2}).join(",");var ns=m.name!==m.matchedName?m.name+"<span style=color:#aaa>≈</span>"+m.matchedName:m.name;' +
    'var st=m.append?"<span style=color:#f29900>➕추가</span>":"<span class=ok>✅</span>";' +
    'tb.innerHTML+="<tr><td>"+ns+"</td><td class=tr>"+m.tracking+"</td><td>"+rn+"</td><td>"+st+"</td></tr>"});' +
    'no.forEach(function(u){tb.innerHTML+="<tr><td class=err>"+u.name+"</td><td class=tr>"+u.tracking+"</td><td>-</td><td class=err>❌</td></tr>"});' +
    'document.getElementById("apb").style.display=ok.length?"block":"none";' +
    'document.getElementById("rs").style.display="block"}' +
    'catch(err){toast("분석 오류: "+err.message,4000)}finally{btn.disabled=false;btn.textContent="🔍 분석"}}' +
    'function applyAll(){if(!_m)return;var btn=document.getElementById("apb");btn.disabled=true;btn.textContent="반영 중...";' +
    'google.script.run.withSuccessHandler(function(res){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast(res.msg,3000)})' +
    '.withFailureHandler(function(err){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast("오류: "+err,3000)})' +
    ".applyInvoiceMatchesLocal(JSON.stringify(_m))}" +
    "<\\/script>" +
    '<input type="hidden" id="_ocrKey" value="__OCR_API_KEY__">' +
    '<input type="hidden" id="_ssId" value="__SPREADSHEET_ID__">' +
    '<input type="hidden" id="_recipientHeader" value="__RECIPIENT_HEADER__">' +
    '<input type="hidden" id="_nameToRows" value=\'__NAME_TO_ROWS_JSON__\'>' +
    '<script async src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"><\/script>' +
    "</body></html>"
  );
}

/**
 * ★ 2026-07-09: 전용양식 미발주 데이터 엑셀 다운로드용 (로컬 버전)
 * @return {{ headers: string[], data: Array[], vendorName: string, total: number, filtered: number }}
 */
function getExclusiveFormDataForDownloadLocal() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = ss.getSheets();
    var exTab = null;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getName().indexOf("전용양식") !== -1) {
        exTab = tabs[i]; break;
      }
    }
    if (!exTab) return { error: "전용양식 탭을 찾을 수 없습니다." };

    var lr = exTab.getLastRow();
    if (lr < 2) return { error: "전용양식에 데이터가 없습니다." };
    var lc = exTab.getLastColumn();

    var headers = exTab.getRange(1, 1, 1, lc).getValues()[0];
    var data = exTab.getRange(2, 1, lr - 1, lc).getValues();

    // A열(송장번호) 비어있고, C열 이후 데이터가 있는 행만 필터
    var filtered = [];
    for (var di = 0; di < data.length; di++) {
      var invoice = String(data[di][0] || "").trim();
      if (invoice) continue; // 송장번호 있으면 이미 발주 완료
      var hasData = false;
      for (var ci = 2; ci < data[di].length; ci++) {
        if (String(data[di][ci] || "").trim()) { hasData = true; break; }
      }
      if (hasData) filtered.push(data[di].slice(2)); // C열부터
    }

    // 거래처명
    var vendorName = "";
    try {
      var st = ss.getSheetByName("설정");
      if (st) vendorName = String(st.getRange("B5").getValue() || "").trim();
    } catch(e) {}
    if (!vendorName) vendorName = ss.getName().replace("[협력업체] ", "");

    return {
      headers: headers.slice(2).map(function(h) { return String(h || ""); }),
      data: filtered,
      vendorName: vendorName,
      total: data.length,
      filtered: filtered.length
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// [자동 주입용] 업체 시트에 주입할 InvoiceMatch 코드 반환
// ───────────────────────────────────────────────────────────────────
// ★ createViewerNoticeScript_()에서 호출하여 fileList에 포함
// ★ 수정은 위의 실제 함수들에서 하면 자동 반영됨
// ═══════════════════════════════════════════════════════════════════
function getPartnerInvoiceMatchCode_() {
  // ★ 2026-07-09: 엑셀 다운로드 로컬 래퍼 추가
  //   결과: clasp push만 하면 전체 업체에 즉시 반영!
  return [
    '// ── [Pack2U] 카카오 송장 매칭 — 라이브러리 기반 (2026-07-09) ──',
    '// ★ 코드 수정은 허브의 _partnerLibrary.gs + InvoiceMatch_협력업체용.gs에서만!',
    '',
    'function openInvoiceMatchSidebarLocal() {',
    '  Pack2U.p2u_openInvoiceMatchSidebar();',
    '}',
    '',
    'function parseAndMatchInvoiceTextLocal(rawText) {',
    '  return Pack2U.p2u_parseAndMatchInvoiceText(rawText);',
    '}',
    '',
    'function parseAndMatchInvoiceImageLocal(base64Data) {',
    '  return Pack2U.p2u_parseAndMatchInvoiceImage(base64Data);',
    '}',
    '',
    'function applyInvoiceMatchesLocal(matchesJson) {',
    '  return Pack2U.p2u_applyInvoiceMatches(matchesJson);',
    '}',
    '',
    'function getExclusiveFormDataForDownloadLocal() {',
    '  return Pack2U.p2u_getExclusiveFormDataForDownload();',
    '}',
  ].join("\n");
}




