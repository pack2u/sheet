// ============================================================
//  [협력업체] 카카오 송장번호 매칭 사이드바
//  ▶ 사용법: 이 파일 전체를 각 협력업체 GAS 프로젝트에
//            새 파일(InvoiceMatch.gs)로 붙여넣기
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

// ── 텍스트 파서 (하이픈 포함 송장번호 지원) ──
function _parseInvoicePairs_(text) {
  var lines = text.split(/[\r\n]+/)
    .map(function(l) { return l.replace(/\t/g, '   ').trim(); })
    .filter(function(l) { return l.length > 0; });
  var pairs = [], pending = null;
  // ★ 하이픈(-) 포함 송장번호에서 순수 숫자 추출 + 10~14자리 검증
  function _ext(raw) {
    var d = raw.replace(/[-\s]/g, '');
    return /^\d{10,14}$/.test(d) ? d : null;
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // ① "송장번호(숫자/하이픈)  이름" 형태
    var m1 = line.match(/^([\d\-]{10,20})\s{1,}(.+)$/);
    if (m1) {
      var t1 = _ext(m1[1]); var n1 = m1[2].trim();
      if (t1 && n1.length >= 1) { pairs.push({ tracking: t1, name: n1 }); pending = null; continue; }
    }
    // ② "이름  송장번호(숫자/하이픈)" 형태
    var m2 = line.match(/^(.+?)\s{1,}([\d\-]{10,20})$/);
    if (m2) {
      var t2 = _ext(m2[2]); var n2 = m2[1].trim();
      if (t2 && n2.length >= 1 && !/^[\d\-]+$/.test(n2)) { pairs.push({ tracking: t2, name: n2 }); pending = null; continue; }
    }
    // ③ 번호만 있는 줄 (하이픈 포함)
    var solo = _ext(line);
    if (solo && /^[\d\-]+$/.test(line.trim())) { pending = solo; continue; }
    // ④ 이름만 있는 줄 (앞에 번호 대기 중이면 쌍으로)
    if (line.length >= 1 && !/^[\d\-]+$/.test(line) && pending) {
      pairs.push({ tracking: pending, name: line }); pending = null;
    }
  }
  return pairs;
}

// ── 인라인 HTML 사이드바 ──
function _getInvoiceMatchHtml_() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:13px;background:#f0f2f5;display:flex;flex-direction:column;height:100vh}' +
    '.hd{background:#1a73e8;color:white;padding:12px 16px;font-size:15px;font-weight:bold;flex-shrink:0}' +
    '.sc{background:white;margin:8px 8px 0;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)}' +
    '.st{font-size:11px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}' +
    'textarea{width:100%;height:130px;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:12px;font-family:monospace;resize:none}' +
    '.btn{width:100%;padding:9px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;margin-top:8px;transition:.15s}' +
    '.bb{background:#1a73e8;color:white}.bb:hover{background:#1558b0}' +
    '.bg{background:#34a853;color:white}.bg:hover{background:#2d8f46}' +
    '.btn:disabled{background:#ccc;cursor:not-allowed}' +
    '#rs{flex:1;overflow-y:auto;display:none}' +
    '.sum{margin:8px;background:white;border-radius:8px;padding:10px 12px;font-size:12px;color:#444;box-shadow:0 1px 3px rgba(0,0,0,.1)}' +
    'table{width:100%;border-collapse:collapse;font-size:12px}' +
    'th{background:#f8f9fa;padding:6px 8px;text-align:left;font-size:11px;color:#666}' +
    'td{padding:5px 8px;border-bottom:1px solid #f0f0f0}' +
    '.ok{color:#34a853;font-weight:bold}.err{color:#ea4335;font-weight:bold}' +
    '.tr{font-size:11px;color:#555;font-family:monospace}' +
    '#toast{display:none;position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:8px 18px;border-radius:20px;font-size:12px;z-index:999}' +
    '</style></head><body>' +
    '<div class="hd">📬 카카오 송장번호 매칭</div>' +
    '<div class="sc"><div class="st">카카오 텍스트 붙여넣기</div>' +
    '<textarea id="rt" placeholder="예시:&#10;44363801252   최고갈비&#10;443-8937-1622   임병혁"></textarea>' +
    '<button class="btn bb" id="ab" onclick="analyze()">🔍 분석</button></div>' +
    '<div id="rs"><div class="sum" id="sum"></div>' +
    '<div class="sc" style="margin-bottom:8px">' +
    '<button class="btn bg" id="apb" onclick="applyAll()" style="display:none">✅ 전용양식에 반영</button>' +
    '<table><thead><tr><th>이름</th><th>송장번호</th><th>행</th><th></th></tr></thead><tbody id="mt"></tbody></table>' +
    '</div></div><div id="toast"></div>' +
    '<script>var _m=null;' +
    'function toast(msg,ms){var el=document.getElementById("toast");el.textContent=msg;el.style.display="block";setTimeout(function(){el.style.display="none"},ms||2500)}' +
    'function analyze(){' +
    'var rt=document.getElementById("rt").value.trim();if(!rt)return toast("텍스트를 붙여넣으세요",2000);' +
    'var btn=document.getElementById("ab");btn.disabled=true;btn.textContent="분석 중...";' +
    'document.getElementById("rs").style.display="none";' +
    'google.script.run' +
    '.withSuccessHandler(function(res){btn.disabled=false;btn.textContent="🔍 분석";' +
    'if(res.error){toast("❌ "+res.error,3000);return}_m=res.matches;showResults(res)})' +
    '.withFailureHandler(function(e){btn.disabled=false;btn.textContent="🔍 분석";toast("오류: "+e.message,3000)})' +
    '.parseAndMatchInvoiceTextLocal(rt)}' +
    'function showResults(res){' +
    'var ok=(res.matches||[]).filter(function(m){return m.rows&&m.rows.length>0});' +
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
    'function applyAll(){if(!_m)return;' +
    'var btn=document.getElementById("apb");btn.disabled=true;btn.textContent="반영 중...";' +
    'google.script.run' +
    '.withSuccessHandler(function(res){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast(res.msg,3000)})' +
    '.withFailureHandler(function(e){btn.disabled=false;btn.textContent="✅ 전용양식에 반영";toast("오류: "+e.message,3000)})' +
    '.applyInvoiceMatchesLocal(JSON.stringify(_m))}' +
    '<\/script></body></html>';
}
