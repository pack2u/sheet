/**
 * gasMasters.js — 외부 스프레드시트에서 마스터를 당겨와 로컬 탭에 적재한다.
 *
 * IMPORTRANGE 를 쓰지 않는다. 실패하면 예외를 던져 "값이 비었다"와 구분되게 한다.
 * (구 시트의 무성 실패 — 임포트가 끊겨도 "도서산간 아님"으로 보이던 문제)
 */

var SSM_ITEM_HEADER = ['품목코드', '품목명', '상태', '출고지', '단품배송비', '배송비규칙원문'];
var SSM_STOCK_HEADER = ['품목코드', '가용수량'];
var SSM_BOM_HEADER = ['세트코드', '세트명', '구성품코드', '소요량'];
var SSM_COND_HEADER = ['조건ID', '품목코드', '품목명(참고)'];
var SSM_EXCEPT_HEADER = ['품목코드', '사유'];
var SSM_ISL_KW_HEADER = ['시/군'];
var SSM_ISL_ZIP_HEADER = ['우편번호'];
var SSM_ISL_DICT_HEADER = ['정규주소', '우편번호', '도서산간', '최초확인', '메모'];
var SSM_LOCAL_HEADER = ['정규주소', '동네', '일자'];

function ssm_open(id, tab, label) {
  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { throw new Error(label + ' 스프레드시트를 열 수 없습니다 (ID: ' + id + '). 공유 권한을 확인하세요. — ' + e.message); }
  var sh = ss.getSheetByName(tab);
  if (!sh) throw new Error(label + ' 시트에 「' + tab + '」 탭이 없습니다.');
  if (sh.getLastRow() < 2) throw new Error(label + ' 「' + tab + '」 탭에 데이터가 없습니다 (' + sh.getLastRow() + '행).');
  return sh.getDataRange().getValues();
}

/**
 * 전체 마스터 새로고침. 각 단계의 행수를 리포트로 돌려준다.
 */
function ssm_refreshAll() {
  var cfg = ssio_config();
  var report = [];
  var warn = [];

  // 1) 상태 / 출고지 코드표
  var statusMap = {}, originMap = {};
  var st = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_상태탭'], '이카운트');
  for (var i = 1; i < st.length; i++) if (ssText(st[i][0])) statusMap[ssText(st[i][0])] = ssText(st[i][1]);
  var og = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_출고지탭'], '이카운트');
  for (var j = 1; j < og.length; j++) if (ssText(og[j][0])) originMap[ssText(og[j][0])] = ssText(og[j][1]);
  report.push(['상태코드', st.length - 1]);
  report.push(['출고지코드', og.length - 1]);

  // 2) 품목정보 (+ 배송비규칙 전개)
  var it = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_품목정보탭'], '이카운트');
  var items = [], feeRows = [], badFee = [];
  for (var k = 1; k < it.length; k++) {
    var r = it[k];
    var code = ssText(r[0]);
    if (!code) continue;
    var statusCode = ssText(r[2]);
    var originCode = ssText(r[17]);
    var status = statusMap[statusCode];
    var origin = originMap[originCode];
    if (status === undefined) {
      status = statusCode;
      warn.push(['주의', 'STATUS_CODE', code, '상태코드 ' + statusCode + ' 가 상태표에 없습니다.']);
    }
    if (origin === undefined) {
      origin = originCode;
      warn.push(['주의', 'ORIGIN_CODE', code, '출고지코드 ' + originCode + ' 가 출고지표에 없습니다.']);
    }
    var raw = ssText(r[9]);
    items.push([code, ssText(r[1]), status, origin, ssNum(r[14]), raw]);
    var parsed = ssParseFeeRule(code, raw);
    for (var f = 0; f < parsed.rows.length; f++) {
      var p = parsed.rows[f];
      feeRows.push([p.code, p.qty, p.fee, p.fullBox ? 'Y' : '', p.src]);
    }
    for (var b = 0; b < parsed.bad.length; b++) {
      badFee.push(['오류', 'FEE_PARSE', code, '배송비 규칙을 해석하지 못했습니다: 「' + parsed.bad[b] + '」']);
    }
  }
  ssio_write(SSIO_TABS.M품목, SSM_ITEM_HEADER, items);
  ssio_write(SSIO_TABS.M배송비, SS_FEE_RULE_HEADER, feeRows);
  report.push(['품목정보', items.length]);
  report.push(['배송비규칙(전개)', feeRows.length]);
  report.push(['배송비규칙 해석실패', badFee.length]);
  warn = warn.concat(badFee);

  // 3) 재고
  var sk = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_재고탭'], '이카운트');
  var stock = [];
  for (var s = 1; s < sk.length; s++) if (ssText(sk[s][0])) stock.push([ssText(sk[s][0]), ssNum(sk[s][1])]);
  ssio_write(SSIO_TABS.M재고, SSM_STOCK_HEADER, stock);
  report.push(['재고', stock.length]);

  // 4) BOM
  var bm = ssm_open(cfg['이카운트시트ID'], cfg['이카운트_BOM탭'], '이카운트');
  var bom = [];
  for (var m = 1; m < bm.length; m++) {
    var setCode = ssText(bm[m][0]);
    var comp = ssText(bm[m][4]);
    if (!setCode || !comp) continue;
    bom.push([setCode, ssText(bm[m][1]), comp, ssNum(bm[m][7]) || 1]);
  }
  ssio_write(SSIO_TABS.MBOM, SSM_BOM_HEADER, bom);
  report.push(['BOM', bom.length]);

  // 5) 도서산간 시/군 · 우편번호
  var kw = ssm_open(cfg['도서산간시트ID'], cfg['도서산간_시군탭'], '도서산간');
  var kws = [];
  for (var w = 1; w < kw.length; w++) { var v = ssText(kw[w][1]); if (v) kws.push([v]); }
  ssio_write(SSIO_TABS.도서산간시군, SSM_ISL_KW_HEADER, kws);
  var zp = ssm_open(cfg['도서산간시트ID'], cfg['도서산간_우편번호탭'], '도서산간');
  var zips = [];
  for (var z = 1; z < zp.length; z++) { var q = ssText(zp[z][0]); if (q) zips.push([q]); }
  ssio_write(SSIO_TABS.도서산간우편, SSM_ISL_ZIP_HEADER, zips);
  report.push(['도서산간 시/군', kws.length]);
  report.push(['도서산간 우편번호', zips.length]);

  // 6) 금일 동네배송
  var lo = ssm_open(cfg['동네배송시트ID'], cfg['동네배송_탭'], '동네배송');
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var locals = [], seenL = {};
  for (var l = 1; l < lo.length; l++) {
    var d = lo[l][2];
    var ds = (d instanceof Date) ? Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd') : ssText(d);
    if (ds.indexOf(today) !== 0) continue;
    var a = ssNormAddr(lo[l][8]);
    if (!a || seenL[a]) continue;
    seenL[a] = true;
    locals.push([a, ssText(lo[l][1]), today]);
  }
  ssio_write(SSIO_TABS.동네배송, SSM_LOCAL_HEADER, locals);
  report.push(['금일 동네배송', locals.length]);

  return { report: report, warnings: warn };
}

/**
 * 로컬 마스터 탭 → core.js 가 쓰는 자료구조
 */
function ssm_load() {
  var M = {
    items: {}, stock: {}, bom: {}, splitExcept: {},
    cond: {}, condCodes: {}, feeRules: {},
    islandKeywords: [], islandZips: {}, addrZip: {}, localAddrs: {}
  };

  var it = ssio_body(SSIO_TABS.M품목);
  for (var i = 0; i < it.length; i++) {
    var c = ssText(it[i][0]); if (!c) continue;
    M.items[c] = {
      name: ssText(it[i][1]), status: ssText(it[i][2]), origin: ssText(it[i][3]),
      unitFee: ssNum(it[i][4]), feeRuleRaw: ssText(it[i][5])
    };
  }

  var sk = ssio_body(SSIO_TABS.M재고);
  for (var s = 0; s < sk.length; s++) { var sc = ssText(sk[s][0]); if (sc) M.stock[sc] = ssNum(sk[s][1]); }

  var bm = ssio_body(SSIO_TABS.MBOM);
  var setName = {};
  for (var b = 0; b < bm.length; b++) {
    var setCode = ssText(bm[b][0]), comp = ssText(bm[b][2]);
    if (!setCode || !comp) continue;
    setName[setCode] = ssText(bm[b][1]);
    (M.bom[setCode] || (M.bom[setCode] = [])).push({ code: comp, qty: ssNum(bm[b][3]) || 1 });
  }
  // 구 시트 규칙 계승 — 세트명에 "소분"이 들어가면 분해하지 않는다
  for (var key in M.bom) {
    if (!Object.prototype.hasOwnProperty.call(M.bom, key)) continue;
    if (/소분/.test(setName[key] || '')) M.splitExcept[key] = true;
  }
  var ex = ssio_body(SSIO_TABS.분리예외);
  for (var e = 0; e < ex.length; e++) { var ec = ssText(ex[e][0]); if (ec) M.splitExcept[ec] = true; }

  var fr = ssio_body(SSIO_TABS.M배송비);
  for (var f = 0; f < fr.length; f++) {
    var fc = ssText(fr[f][0]); if (!fc) continue;
    var q = String(ssNum(fr[f][1]));
    (M.feeRules[fc] || (M.feeRules[fc] = {}))[q] = { fee: ssNum(fr[f][2]), fullBox: ssText(fr[f][3]) === 'Y' };
  }

  var cd = ssio_body(SSIO_TABS.합배송조건);
  for (var d = 0; d < cd.length; d++) {
    var cond = ssText(cd[d][0]), code = ssText(cd[d][1]);
    if (!cond || !code) continue;
    var arr = M.cond[code] || (M.cond[code] = []);
    if (arr.indexOf(cond) < 0) arr.push(cond);
    (M.condCodes[cond] || (M.condCodes[cond] = {}))[code] = true;
  }

  var kw = ssio_body(SSIO_TABS.도서산간시군);
  for (var k = 0; k < kw.length; k++) { var kv = ssText(kw[k][0]); if (kv) M.islandKeywords.push(kv); }
  var zp = ssio_body(SSIO_TABS.도서산간우편);
  for (var z = 0; z < zp.length; z++) { var zv = ssText(zp[z][0]); if (zv) M.islandZips[zv] = true; }

  var dc = ssio_body(SSIO_TABS.도서산간사전);
  for (var y = 0; y < dc.length; y++) {
    var a = ssText(dc[y][0]); if (!a) continue;
    var zip = ssText(dc[y][1]); if (zip) M.addrZip[a] = zip;
  }

  var lo = ssio_body(SSIO_TABS.동네배송);
  for (var l = 0; l < lo.length; l++) { var la = ssText(lo[l][0]); if (la) M.localAddrs[la] = true; }

  return M;
}

/**
 * 이번 실행에서 나온 도서산간 후보 주소를 사전 탭에 추가한다(우편번호는 비워 둔 채).
 * 사람이 한 번 채워 넣으면 그 주소는 다시 물어보지 않는다.
 */
function ssm_addIslandCandidates(units, masters) {
  var sh = ssio_sheet(SSIO_TABS.도서산간사전, SSM_ISL_DICT_HEADER);
  var have = masters.addrZip || {};
  var existing = {};
  var body = ssio_body(SSIO_TABS.도서산간사전);
  for (var i = 0; i < body.length; i++) existing[ssText(body[i][0])] = true;

  var add = [], seen = {};
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  for (var j = 0; j < units.length; j++) {
    var u = units[j];
    if (u.보류사유 !== '도서산간미확인') continue;
    var a = u.정규주소;
    if (!a || existing[a] || seen[a] || have[a]) continue;
    seen[a] = true;
    add.push([a, '', '', today, '우편번호를 입력하세요']);
  }
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, SSM_ISL_DICT_HEADER.length).setValues(add);
  return add.length;
}
