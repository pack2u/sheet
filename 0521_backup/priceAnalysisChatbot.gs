/**
 * 상품정보 전용 분석·수정 챗봇 엔진
 * 파일: priceAnalysisChatbot.gs  (구 productChatbot.gs → HTML 파일명 충돌 방지로 이름 변경)
 * HTML: productChatbot.html
 */

var _BOT_SHEET   = '상품정보';
var _BOT_HDR_ROW = 4;
var _BOT_DAT_ROW = 6;

/* ── 사이드바 열기 ── */
function openProductChatbot() {
  var html = HtmlService.createHtmlOutputFromFile('productChatbot')
    .setTitle('📊 상품정보 챗봇').setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

/* ── HTML → GAS 메인 진입점 ── */
function botQuery(msg) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_BOT_SHEET);
    if (!sh) return txt('❌ 상품정보 탭 없음');
    var cm = buildColMap_(sh);
    var it = detectIntent_(msg);
    if (it.type === 'PRICE_DIFF')  return handlePriceDiff_(sh, cm, it);
    if (it.type === 'MARGIN')      return handleMargin_(sh, cm, it);
    if (it.type === 'EMPTY')       return handleEmpty_(sh, cm, it);
    if (it.type === 'SEARCH')      return handleSearch_(sh, cm, it);
    if (it.type === 'STATUS')      return handleStatus_(sh, cm, it);
    if (it.type === 'INVENTORY')   return handleInventory_(sh, cm, it);
    if (it.type === 'VALIDATE')    return handleValidate_(sh, cm, it);
    if (it.type === 'SUMMARY')     return handleSummary_(sh, cm, it);
    if (it.type === 'BULK_EDIT')   return handleBulkEdit_(sh, cm, it);
    if (it.type === 'EDIT')        return handleEdit_(sh, cm, it);
    return callGemini_(msg, sh, cm);
  } catch(e) { return txt('❌ ' + e.message); }
}

/* ── 일괄 수정 실행 (HTML confirm 후 호출) ── */
function botBulkEdit(changesJson) {
  try {
    var changes = JSON.parse(changesJson);
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_BOT_SHEET);
    var applied = 0;
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i];
      sh.getRange(c.row, c.col).setValue(c.newVal);
      applied++;
    }
    SpreadsheetApp.flush();
    return txt('✅ 일괄 수정 완료: ' + applied + '건 반영됨');
  } catch(e) { return txt('❌ 일괄 수정 오류: ' + e.message); }
}


/* ── 셀 수정 (HTML confirm 후 호출) ── */
function botEdit(rowNum, colNum, newVal) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(_BOT_SHEET);
    var old = sh.getRange(rowNum, colNum).getValue();
    sh.getRange(rowNum, colNum).setValue(newVal);
    return txt('✅ ' + rowNum + '행 ' + colNum + '열: ' + old + ' → ' + newVal + ' 수정 완료');
  } catch(e) { return txt('❌ ' + e.message); }
}

/* ── 컬럼맵 ── */
function buildColMap_(sh) {
  var hdrs = sh.getRange(_BOT_HDR_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var m = {}, cnt = {};
  for (var i = 0; i < hdrs.length; i++) {
    var h = String(hdrs[i]||'').trim();
    if (!h) continue;
    cnt[h] = (cnt[h]||0) + 1;
    var key = cnt[h] > 1 ? h + '_' + cnt[h] : h;
    m[key] = i + 1;
    m['_r' + (i+1)] = key;
  }
  return m;
}

/* ── 데이터 읽기 ── */
function readData_(sh) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < _BOT_DAT_ROW) return [];
  return sh.getRange(_BOT_DAT_ROW, 1, lr - _BOT_DAT_ROW + 1, lc).getValues();
}

/* ── 키 컬럼 인덱스 (0-based) ── */
function keys_(cm) {
  function f(ns) {
    for (var i=0;i<ns.length;i++) if(cm[ns[i]]!==undefined) return cm[ns[i]]-1;
    return -1;
  }
  return {
    st:  f(['상태','판매상태']),
    nm:  f(['이카운트상품명 / 옵션명','이카운트상품명','상품명','품목명']),
    cd:  f(['이카운트코드','품목코드','상품코드']),
    vd:  f(['구매처','공급처']),
    ot:  f(['출고지']),
    sk:  f(['재고수량','재고']),
    uc:  f(['개당매입가','매입가','원가','입고단가']),
    op:  f(['개당판매가','오프라인판매가','오프라인 판매가']),
    sp:  f(['판매가','자사몰판매가','자사몰 판매가']),
    sp2: f(['판매가_2','쿠팡판매가']),
    fe:  f(['수수료']),
    mg:  f(['마진율']),
    mg2: f(['마진율_2'])
  };
}

/* ── 의도 감지 ── */
function detectIntent_(text) {
  var t = text.replace(/\s/g,'').toLowerCase();
  var it = { type:'UNKNOWN', raw:text, p:{} };
  var pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
  var thr = pct ? parseFloat(pct[1])/100 : null;

  // ── 다중 코드 추출 (영대소문자+숫자 5글자 이상) ──
  var allCodes = text.match(/[A-Z][A-Z0-9]{4,}/gi) || [];
  allCodes = allCodes.map(function(c){ return c.toUpperCase(); });
  if (allCodes.length === 1) it.p.code = allCodes[0];
  if (allCodes.length > 1)  it.p.codes = allCodes; // 다중 코드

  // ── 일괄 수정 트리거 (수정/변경/바꿔/올려줘/내려줘/맞춰줘/인상/인하) ──
  if (t.match(/수정|변경|바꿔|업데이트|올려줘|내려줘|맞춰줘|인상|인하/)) {
    var isBulk =
      (it.p.codes && it.p.codes.length > 1) || // 다중 코드 → 무조건 일괄
      t.match(/일괄|모두|전부|전체/) ||
      t.match(/미만.*(?:올려|내려|인상|인하|수정|맞춰)/) ||
      t.match(/이상.*(?:올려|내려|인상|인하|수정|맞춰)/) ||
      t.match(/(?:올려줘|내려줘|인상|인하)/) ||
      t.match(/마진.*(?:로|으로).*맞춰/) ||
      t.match(/맞춰줘/);

    if (isBulk) {
      it.type = 'BULK_EDIT';

      // ① 마진 목표 역산: "마진 30%로 맞춰줘" → 판매가 = 매입가/(1-0.30)
      var marginTargetMatch = text.match(/마진\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:로|으로)?\s*맞춰/);
      if (marginTargetMatch) {
        it.p.targetMargin = parseFloat(marginTargetMatch[1]) / 100;
        it.p.col = '판매가'; // 마진 역산 → 판매가 자동
      }

      // ② % 조정: "5% 올려줘" / "10% 내려줘"
      var adjMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s*(올려|내려|인상|인하)/);
      if (adjMatch && !it.p.targetMargin) {
        it.p.adjPct = parseFloat(adjMatch[1]) / 100 * (adjMatch[2].match(/내려|인하/) ? -1 : 1);
      }

      // ③ 고정값: "90000으로"
      var fixMatch = text.match(/([0-9,]+)\s*(?:원)?\s*으로\s*(?:설정|변경|수정|일괄)?/);
      if (fixMatch && !adjMatch && !it.p.targetMargin)
        it.p.fixVal = parseFloat(fixMatch[1].replace(/,/g,''));

      // ④ 수정 컬럼 (targetMargin은 이미 판매가로 고정)
      if (!it.p.col) {
        if (t.indexOf('판매가')!==-1) it.p.col='판매가';
        else if (t.indexOf('매입가')!==-1) it.p.col='개당매입가';
        else if (t.indexOf('재고')!==-1) it.p.col='재고수량';
        else if (t.indexOf('상태')!==-1) it.p.col='상태';
      }
      // 상태 고정값
      var stMatch = text.match(/(판매중|품절|단종품|재고까지만)\s*(?:으로|로)/);
      if (stMatch) { it.p.col='상태'; it.p.fixVal=stMatch[1]; }

      // ⑤ 필터 조건
      if (it.p.codes && it.p.codes.length > 1) {
        it.p.filter = 'CODE_LIST'; // 다중 코드 → 코드 목록 필터
      } else if (t.match(/마진.*미만|미만.*마진/)) {
        it.p.filter='MARGIN_LT'; it.p.filterThr=thr||0.15;
      } else if (t.match(/마진.*이상|이상.*마진/)) {
        it.p.filter='MARGIN_GT'; it.p.filterThr=thr||0.30;
      } else if (t.match(/재고.*0|재고없|재고부족/)) {
        it.p.filter='STOCK_ZERO';
      } else if (t.match(/판매가.*0|판매가없|판매가미입력/)) {
        it.p.filter='PRICE_ZERO';
      } else if (t.match(/단종/)) {
        it.p.filter='STATUS_EQ'; it.p.filterVal='단종품';
      } else if (t.match(/품절/)) {
        it.p.filter='STATUS_EQ'; it.p.filterVal='품절';
      } else if (t.match(/판매중/)) {
        it.p.filter='STATUS_EQ'; it.p.filterVal='판매중';
      }
      return it;
    }
    // ── 단일 수정 ──
    it.type = 'EDIT';
    var vm = text.match(/([0-9,]+)\s*(?:원|으로|로)/);
    if (vm) it.p.val = parseFloat(vm[1].replace(/,/g,''));
    if (t.indexOf('판매가')!==-1) it.p.col='판매가';
    else if (t.indexOf('매입가')!==-1) it.p.col='개당매입가';
    else if (t.indexOf('재고')!==-1) it.p.col='재고수량';
    return it;
  }
  if (t.match(/가격|단가|판매가|열.*비교|비교.*열/) && t.match(/차이|비교|다른|확인/)) {
    it.type='PRICE_DIFF'; it.p.thr=thr||0.20;
    if(t.indexOf('쿠팡')!==-1) it.p.plat='쿠팡';
    else if(t.indexOf('오프라인')!==-1) it.p.plat='오프라인';
    // ★ "W열과 BN열" 처럼 열 알파벳 직접 지정 감지
    var colMatch = it.raw.match(/([A-Z]{1,3})열.*?([A-Z]{1,3})열/i);
    if (colMatch) {
      it.p.colA = colMatch[1].toUpperCase();
      it.p.colB = colMatch[2].toUpperCase();
    }
    return it;
  }
  if (t.match(/마진|수익|이익/)) { it.type='MARGIN'; it.p.thr=thr||0.15; return it; }
  if (t.match(/빈|없는|미입력|누락|비어/)) { it.type='EMPTY'; return it; }
  if (t.match(/찾아|검색|조회|알려줘/)) { it.type='SEARCH'; return it; }
  if (t.match(/재고/)) { it.type='INVENTORY'; return it; }
  if (t.match(/상태|단종|품절/)) {
    it.type='STATUS';
    if(t.indexOf('단종')!==-1) it.p.st='단종품';
    else if(t.indexOf('판매중')!==-1) it.p.st='판매중';
    return it;
  }
  if (t.match(/검증|점검|확인해|이상한/)) { it.type='VALIDATE'; return it; }
  if (t.match(/요약|현황|통계|전체/)) { it.type='SUMMARY'; return it; }
  return it;
}

/* ── 핸들러: 가격 차이 ── */
function handlePriceDiff_(sh, cm, it) {
  var data = readData_(sh), ks = keys_(cm), thr = it.p.thr||0.20;
  var colA, colB, labelA, labelB;
  // ★ 열 알파벳 직접 지정 우선 (예: "W열과 BN열 비교")
  if (it.p.colA && it.p.colB) {
    colA = colLetterToIdx_(it.p.colA);
    colB = colLetterToIdx_(it.p.colB);
    labelA = it.p.colA + '열';
    labelB = it.p.colB + '열';
  } else {
    colA = ks.sp;
    colB = (it.p.plat==='쿠팡' && ks.sp2!==-1) ? ks.sp2 : ks.op;
    labelA = '자사몰';
    labelB = it.p.plat||'오프라인';
  }
  if (colA < 0 || colB < 0) return txt('열을 찾을 수 없습니다. (colA:'+colA+', colB:'+colB+')');
  var rows = [];
  data.forEach(function(r,i) {
    var st=String(r[ks.st]||'').trim();
    if(!st||st==='단종품') return;
    var pA=parseFloat(r[colA])||0, pB=parseFloat(r[colB])||0;
    if(pA<=0||pB<=0) return;
    var d=(pB-pA)/pA;
    if(Math.abs(d)>=thr) rows.push([
      String(r[ks.cd]||''), String(r[ks.nm]||'').slice(0,18),
      pA.toLocaleString(), pB.toLocaleString(),
      (d>0?'🟡+':'🔴')+Math.round(d*100)+'%',
      i+_BOT_DAT_ROW
    ]);
  });
  if(!rows.length) return txt('✅ '+Math.round(thr*100)+'% 이상 차이 없음');
  rows.sort(function(a,b){
    var na=parseFloat(String(a[4]).replace(/[^0-9.\-]/g,''))||0;
    var nb=parseFloat(String(b[4]).replace(/[^0-9.\-]/g,''))||0;
    return Math.abs(nb)-Math.abs(na);
  });
  return tbl('단가 비교 ('+labelA+' vs '+labelB+', >='+Math.round(thr*100)+'%)',
    ['품목코드','품목명',labelA,labelB,'차이율'], rows);
}

/* ── 핸들러: 마진율 ── */
function handleMargin_(sh, cm, it) {
  var data=readData_(sh), ks=keys_(cm), thr=it.p.thr||0.15;
  var rows=[];
  data.forEach(function(r,i) {
    var st=String(r[ks.st]||'').trim();
    if(!st||st==='단종품') return;
    var raw=r[ks.mg]; var mg;
    if(typeof raw==='number') mg=raw;
    else mg=parseFloat(String(raw||'').replace('%',''))/100;
    if(isNaN(mg)||mg<=0) {
      var p=parseFloat(r[ks.sp])||0, c=parseFloat(r[ks.uc])||0;
      if(p>0&&c>0) mg=(p-c)/p; else return;
    }
    if(mg<thr) rows.push([
      String(r[ks.cd]||''), String(r[ks.nm]||'').slice(0,18),
      (parseFloat(r[ks.sp])||0).toLocaleString(),
      (parseFloat(r[ks.uc])||0).toLocaleString(),
      Math.round(mg*100)+'%', i+_BOT_DAT_ROW
    ]);
  });
  if(!rows.length) return txt('✅ 마진율 '+Math.round(thr*100)+'% 미만 없음');
  rows.sort(function(a,b){ return parseFloat(a[4])-parseFloat(b[4]); });
  return tbl('마진율 낮은 품목 (<'+Math.round(thr*100)+'%)',['품목코드','품목명','판매가','원가','마진율'],rows);
}

/* ── 핸들러: 빈값 ── */
function handleEmpty_(sh, cm, it) {
  var data=readData_(sh), ks=keys_(cm);
  var chk=[
    {l:'판매가',i:ks.sp},{l:'매입가',i:ks.uc},
    {l:'품목코드',i:ks.cd},{l:'재고수량',i:ks.sk}
  ];
  var rows=[];
  data.forEach(function(r,i) {
    var st=String(r[ks.st]||'').trim();
    if(!st||st==='단종품') return;
    var emp=chk.filter(function(c){ return c.i>=0&&(r[c.i]===''||r[c.i]===0||r[c.i]===null); })
               .map(function(c){ return c.l; });
    if(emp.length) rows.push([
      String(r[ks.cd]||'(없음)'), String(r[ks.nm]||'').slice(0,18),
      emp.join(', '), i+_BOT_DAT_ROW
    ]);
  });
  if(!rows.length) return txt('✅ 미입력 항목 없음');
  return tbl('미입력 품목',['품목코드','품목명','비어있는 항목'],rows);
}

/* ── 핸들러: 검색 ── */
function handleSearch_(sh, cm, it) {
  var data=readData_(sh), ks=keys_(cm);
  var sc=(it.p.code||'').toUpperCase(), sk=it.p.keyword||'';
  var kw = it.raw.replace(/찾아줘|검색|조회|알려줘|에\s*대해|정보/g,'').trim();
  if(!sc&&!sk) sk=kw;
  var found=null;
  for(var i=0;i<data.length;i++) {
    var cd=String(data[i][ks.cd]||'').toUpperCase();
    var nm=String(data[i][ks.nm]||'');
    if(sc&&cd.indexOf(sc)!==-1){found={r:data[i],rn:i+_BOT_DAT_ROW};break;}
    if(sk&&nm.indexOf(sk)!==-1){found={r:data[i],rn:i+_BOT_DAT_ROW};break;}
  }
  if(!found) return txt('검색 결과 없음: ' + (sc||sk));
  var r=found.r;
  var info=[
    ['상태',r[ks.st]],['품목코드',r[ks.cd]],['품목명',r[ks.nm]],
    ['출고지',r[ks.ot]],['구매처',r[ks.vd]],['재고수량',r[ks.sk]],
    ['개당매입가',r[ks.uc]],['오프라인 판매가',r[ks.op]],
    ['자사몰 판매가',r[ks.sp]],['마진율',r[ks.mg]]
  ].filter(function(x){return x[0]&&(x[1]!==''&&x[1]!==null&&x[1]!==undefined);})
   .map(function(x){return {k:x[0],v:String(x[1])||'-'};});
  return JSON.stringify({type:'DETAIL',rowNum:found.rn,code:String(r[ks.cd]||''),info:info});
}

/* ── 핸들러: 상태 ── */
function handleStatus_(sh, cm, it) {
  var data=readData_(sh), ks=keys_(cm);
  var filter=it.p.st||'';
  var cnt={}, rows=[];
  data.forEach(function(r,i) {
    var st=String(r[ks.st]||'').trim(); if(!st) return;
    cnt[st]=(cnt[st]||0)+1;
    if(filter&&st===filter) rows.push([
      String(r[ks.cd]||''), String(r[ks.nm]||'').slice(0,20),
      st, i+_BOT_DAT_ROW
    ]);
  });
  if(filter&&rows.length) return tbl(filter+' 목록',['품목코드','품목명','상태'],rows);
  var lines=['📊 상태별 현황\n'];
  Object.keys(cnt).forEach(function(k){ lines.push('• '+k+': '+cnt[k]+'건'); });
  return txt(lines.join('\n'));
}

/* ── 핸들러: 재고 ── */
function handleInventory_(sh, cm, it) {
  var data=readData_(sh), ks=keys_(cm);
  var rows=[];
  data.forEach(function(r,i) {
    var st=String(r[ks.st]||'').trim();
    if(!st||st==='단종품') return;
    var sk=parseFloat(r[ks.sk])||0;
    if(sk<=0) rows.push([
      String(r[ks.cd]||''), String(r[ks.nm]||'').slice(0,20),
      sk, i+_BOT_DAT_ROW
    ]);
  });
  if(!rows.length) return txt('✅ 재고 0 품목 없음');
  return tbl('재고 0 품목',['품목코드','품목명','재고'],rows);
}

/* ── 핸들러: 전체 검증 ── */
function handleValidate_(sh, cm, it) {
  var data=readData_(sh), ks=keys_(cm);
  var issues=[];
  data.forEach(function(r,i) {
    var st=String(r[ks.st]||'').trim(); if(!st||st==='단종품') return;
    var cd=String(r[ks.cd]||'').trim();
    var nm=String(r[ks.nm]||'').trim();
    var sp=parseFloat(r[ks.sp])||0, uc=parseFloat(r[ks.uc])||0;
    if(!cd) issues.push([nm.slice(0,20),'품목코드 없음',i+_BOT_DAT_ROW]);
    else if(sp<=0) issues.push([cd,'판매가 0 또는 미입력',i+_BOT_DAT_ROW]);
    else if(uc<=0) issues.push([cd,'매입가 0 또는 미입력',i+_BOT_DAT_ROW]);
    else if(sp<uc) issues.push([cd,'판매가('+sp+') < 원가('+uc+')',i+_BOT_DAT_ROW]);
    else {
      var mg=(sp-uc)/sp;
      if(mg<0.05) issues.push([cd,'마진율 '+Math.round(mg*100)+'% (5% 미만)',i+_BOT_DAT_ROW]);
    }
    var op=parseFloat(r[ks.op])||0, sp2=parseFloat(r[ks.sp2])||0;
    if(sp>0&&op>0&&Math.abs((op-sp)/sp)>=0.30) issues.push([cd,'오프라인·온라인 가격차 30%+',i+_BOT_DAT_ROW]);
    if(sp>0&&sp2>0&&Math.abs((sp2-sp)/sp)>=0.30) issues.push([cd,'쿠팡·자사몰 가격차 30%+',i+_BOT_DAT_ROW]);
  });
  if(!issues.length) return txt('✅ 전체 검증 이상 없음');
  return tbl('검증 이슈 ('+issues.length+'건)',['품목','이슈'],
    issues.map(function(x){return [x[0],x[1],x[2]];}));
}

/* ── 핸들러: 요약 ── */
function handleSummary_(sh, cm, it) {
  var data=readData_(sh), ks=keys_(cm);
  var total=0,selling=0,disc=0,noPrice=0,noCode=0,lowMargin=0;
  data.forEach(function(r) {
    var st=String(r[ks.st]||'').trim(); if(!st) return;
    total++;
    if(st==='판매중') selling++;
    if(st==='단종품') disc++;
    if(!String(r[ks.cd]||'').trim()) noCode++;
    var sp=parseFloat(r[ks.sp])||0; if(sp<=0) noPrice++;
    var uc=parseFloat(r[ks.uc])||0;
    if(sp>0&&uc>0&&(sp-uc)/sp<0.15) lowMargin++;
  });
  return txt([
    '📊 상품정보 전체 현황',
    '총 품목: '+total+'개',
    '• 판매중: '+selling+'개',
    '• 단종품: '+disc+'개',
    '• 코드 없음: '+noCode+'개',
    '• 판매가 미입력: '+noPrice+'개',
    '• 마진 15% 미만: '+lowMargin+'개',
    '',
    '더 자세한 내용은 구체적으로 질문해 주세요.',
    '예) "마진 10% 미만 찾아줘", "판매가 비어있는 것"'
  ].join('\n'));
}

/* ── 핸들러: 일괄 수정 ── */
function handleBulkEdit_(sh, cm, it) {
  var data = readData_(sh), ks = keys_(cm);
  var col = it.p.col || '판매가';
  var colIdx = cm[col]; // 1-based
  if (!colIdx) return txt('수정할 컬럼을 찾을 수 없음: ' + col);

  // ── 조건 필터링 ──
  var filtered = [];
  data.forEach(function(r, i) {
    var st = String(r[ks.st]||'').trim();
    if (!st) return;
    var sp = parseFloat(r[ks.sp])||0;
    var uc = parseFloat(r[ks.uc])||0;
    var skv = parseFloat(r[ks.sk])||0;
    var mg = (sp>0&&uc>0) ? (sp-uc)/sp : 0;
    var pass = false;
    var f = it.p.filter || 'ALL';
    // CODE_LIST 필터: 지정한 코드만 처리
    if (f === 'CODE_LIST') {
      var codeSet = {};
      (it.p.codes||[]).forEach(function(c){ codeSet[c]=true; });
      pass = !!codeSet[String(r[ks.cd]||'').toUpperCase()];
    }
    if (f === 'ALL')       pass = (st !== '단종품');
    if (f === 'MARGIN_LT') pass = (st !== '단종품') && mg > 0 && mg < (it.p.filterThr||0.15);
    if (f === 'MARGIN_GT') pass = (st !== '단종품') && mg >= (it.p.filterThr||0.30);
    if (f === 'STOCK_ZERO') pass = (st !== '단종품') && skv <= 0;
    if (f === 'PRICE_ZERO') pass = (st !== '단종품') && sp <= 0;
    if (f === 'STATUS_EQ') pass = (st === it.p.filterVal);
    if (!pass) return;

    var curVal = r[colIdx-1];
    var curNum = parseFloat(curVal) || 0;
    var newVal;

    // 마진 목표 역산: 판매가 = 매입가 / (1 - 목표마진)
    if (it.p.targetMargin !== undefined) {
      var cost = parseFloat(r[ks.uc]) || 0;
      if (cost <= 0) return; // 매입가 없으면 계산 불가
      if (it.p.targetMargin >= 1) return; // 마진 100% 이상 불가
      newVal = Math.round(cost / (1 - it.p.targetMargin));
    } else if (it.p.adjPct !== undefined && it.p.adjPct !== null) {
      if (curNum <= 0) return;
      newVal = Math.round(curNum * (1 + it.p.adjPct));
    } else if (it.p.fixVal !== undefined) {
      newVal = it.p.fixVal;
    } else {
      return; // 계산 불가 행 스킵
    }
    filtered.push({
      row: i + _BOT_DAT_ROW,
      col: colIdx,
      code: String(r[ks.cd]||''),
      name: String(r[ks.nm]||'').slice(0,16),
      curVal: typeof curVal === 'number' ? curVal.toLocaleString() : String(curVal),
      newVal: newVal
    });
  });

  if (!filtered.length) return txt('조건에 맞는 수정 대상이 없습니다.');
  if (filtered.length > 200) return txt('대상이 너무 많습니다(' + filtered.length + '건). 조건을 더 구체적으로 입력해주세요.');

  // 미리보기 테이블용 rows (표시용)
  var previewRows = filtered.map(function(x) {
    return [x.code, x.name, x.curVal, typeof x.newVal==='number' ? x.newVal.toLocaleString() : x.newVal];
  });

  // changes payload
  var changes = filtered.map(function(x) { return {row:x.row, col:x.col, newVal:x.newVal}; });

  // 라벨 결정
  var adjLabel;
  if (it.p.targetMargin !== undefined) {
    adjLabel = '목표마진 ' + Math.round(it.p.targetMargin*100) + '%';
  } else if (it.p.adjPct !== undefined) {
    adjLabel = (it.p.adjPct > 0 ? '+' : '') + Math.round(it.p.adjPct*100) + '%';
  } else {
    adjLabel = String(it.p.fixVal);
  }

  var filterLabel = (it.p.filter === 'CODE_LIST')
    ? '지정 ' + it.p.codes.length + '개 코드'
    : (it.p.filter || '전체');

  return JSON.stringify({
    type: 'BULK_EDIT_CONFIRM',
    title: '[' + col + '] 일괄 수정 미리보기 — ' + filterLabel + ' / ' + adjLabel,
    cols: ['품목코드','품목명','현재값','변경 후'],
    rows: previewRows.slice(0, 30),
    total: filtered.length,
    changes: changes  // ★ JSON.stringify 하지 않음 — 클라이언트에서 직접 전달
  });
}

/* ── 핸들러: 단일 수정 ── */

function handleEdit_(sh, cm, it) {
  var code=(it.p.code||'').toUpperCase();
  var col=it.p.col||''; var val=it.p.val;
  if(!code) return txt('품목코드를 포함해 주세요. 예) JHCRJJIM0001 판매가 85000으로 수정');
  if(!col)  return txt('수정할 항목을 명시해 주세요. (판매가/매입가/재고수량)');
  if(val===undefined||val===null) return txt('수정값을 숫자로 입력해 주세요. 예) 85000으로');

  var data=readData_(sh), ks=keys_(cm);
  var colIdx=cm[col]||cm['개당매입가'];
  var found=null;
  for(var i=0;i<data.length;i++) {
    if(String(data[i][ks.cd]||'').toUpperCase()===code) {
      found={rowNum:i+_BOT_DAT_ROW, oldVal:data[i][colIdx-1]};
      break;
    }
  }
  if(!found) return txt(code+' 품목을 찾을 수 없음');
  return JSON.stringify({
    type:'EDIT_CONFIRM',
    msg: code+' 의 ['+col+']\n'+found.oldVal+' → '+val+'\n으로 수정할까요?',
    rowNum: found.rowNum, colNum: colIdx, newVal: val
  });
}

/* ── Gemini API 연동 ── */
function callGemini_(msg, sh, cm) {
  try {
    var data=readData_(sh), ks=keys_(cm);
    var ctx='상품정보 시트 데이터 샘플(최대50행):\n품목코드|품목명|상태|판매가|원가|마진율\n';
    var cnt=0;
    for(var i=0;i<data.length&&cnt<50;i++) {
      var st=String(data[i][ks.st]||'').trim(); if(!st) continue;
      ctx+=String(data[i][ks.cd]||'')+' | '+String(data[i][ks.nm]||'').slice(0,15)+
           ' | '+st+' | '+(parseFloat(data[i][ks.sp])||0)+
           ' | '+(parseFloat(data[i][ks.uc])||0)+'\n';
      cnt++;
    }
    var url='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='+GEMINI_API_KEY;
    var prompt='당신은 Pack2U 상품정보 분석 전문가입니다.\n아래 데이터를 참고하여 질문에 답하세요.\n\n'+ctx+'\n\n질문: '+msg;
    var res=UrlFetchApp.fetch(url,{
      method:'post',contentType:'application/json',
      payload:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.3}}),
      muteHttpExceptions:true
    });
    var j=JSON.parse(res.getContentText());
    if(j.error) return txt('AI 오류: '+j.error.message);
    return txt(j.candidates[0].content.parts[0].text);
  } catch(e) { return txt('AI 연결 오류: '+e.message); }
}

/* ── 헬퍼: 텍스트 응답 ── */
function txt(msg) { return JSON.stringify({type:'TEXT',msg:msg}); }

/* ── 헬퍼: 테이블 응답 ── */
function tbl(title, cols, rows) {
  return JSON.stringify({type:'TABLE',title:title,cols:cols,rows:rows.slice(0,30),total:rows.length});
}

/* ── 헬퍼: 열 알파벳 → 0-based 인덱스 (A=0, B=1, ..., W=22, BN=65) ── */
function colLetterToIdx_(letter) {
  var L = String(letter||'').toUpperCase().replace(/열/g,'').trim();
  if (!L) return -1;
  var col = 0;
  for (var i = 0; i < L.length; i++) {
    col = col * 26 + (L.charCodeAt(i) - 64);
  }
  return col - 1; // 0-based
}
