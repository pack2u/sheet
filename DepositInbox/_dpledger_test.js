/* 입금대장 기록 검증 — 구글 서비스를 흉내 내어 Code.gs·dpLedger.gs 를 그대로 돌린다 (clasp push 제외)

   사용자 불만 1순위가 «두세 번 눌리면 두세 번 들어간다»였다.
   여기서는 «같은 문자가 몇 번 와도 대장은 한 줄»을 지킨다. */
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');

function makeEnv() {
  const rows = [];                       // 시트 내용 (0행 = 머리글)
  const props = {};
  const chats = [];
  const mirrors = [];
  let mirrorFail = false;
  let triggers = [];
  const cache = {};
  const ecCalls = [];
  let ecLogins = 0;
  let ecSave = () => ({ Status: '200', Data: { SuccessCnt: 1, FailCnt: 0, SlipNos: ['20260929-' + ecCalls.length] } });
  /* 진짜 시트처럼 — 「2026-09-28 23:55(:00)」 같은 글자는 날짜(Date)로 바뀌어 저장된다 (2026-09-29 실측) */
  const asCell = (v) => (typeof v === 'string' && /^d{4}-d{2}-d{2} d{2}:d{2}(:d{2})?$/.test(v)) ? new Date(v.replace(' ', 'T')) : v;
  /* 탭 하나 — 행 배열(0행 = 머리글)을 그대로 들고 있다 */
  const makeSheet = (rows) => {
    const sh = {
      getLastRow: () => rows.length,
      getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
      getRange(r, c, nr = 1, nc = 1) {
        if (typeof r === 'string') return { setNumberFormat() { return this; } };
        return {
          getValues: () => Array.from({ length: nr }, (_, i) =>
            Array.from({ length: nc }, (_, j) => ((rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
          setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (rows[r - 1 + i] = rows[r - 1 + i] || [])[c - 1 + j] = asCell(x); })); return this; },
          setValue(x) { (rows[r - 1] = rows[r - 1] || [])[c - 1] = asCell(x); return this; },
          setFontWeight() { return this; },
          createTextFinder: (txt) => ({ matchEntireCell: () => ({ findNext: () => {
            for (let i = 0; i < nr; i++) if (String((rows[r - 1 + i] || [])[c - 1]) === txt) return { getRow: () => r + i };
            return null;
          } }) }),
        };
      },
      // 진짜 시트처럼 — 「2026-09-28 23:55」 같은 글자는 날짜(Date)로 바뀌어 저장된다 (2026-09-29 실측)
      appendRow: (row) => rows.push(row.map(v =>
        (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) ? new Date(v.replace(' ', 'T')) : v)),
      setFrozenRows() {}, hideColumns() {}, setName() { return sh; }, deleteRows() {},
    };
    return sh;
  };
  const sheet = makeSheet(rows);
  const logRows = [];
  const tabs = { '입금대장': sheet };
  const tabRows = { '입금대장': rows, '수신로그': logRows };
  const ss = {
    getSheetByName: (n) => tabs[n] || null,
    getSheets: () => [sheet],
    insertSheet: (n) => { tabRows[n] = tabRows[n] || []; return (tabs[n] = makeSheet(tabRows[n])); },
    getId: () => 'SS', getUrl: () => 'url',
  };
  const ctx = {
    DP_PHONE_TOKEN: 'tok', DP_CHAT_WEBHOOK: 'https://chat', DP_ALLOWED_SENDERS: '',
    V2_URL: 'https://v2.example/', DEPOSIT_INGEST_TOKEN: 'v2tok',
    SpreadsheetApp: { openById: () => ss, create: () => ss, flush() {} },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, removeAll: (ks) => ks.forEach((k) => delete cache[k]) }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = (n) => String(n).padStart(2, '0');
        const m = { yyyy: d.getFullYear(), MM: p(d.getMonth() + 1), dd: p(d.getDate()), HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds()) };
        return String(f || 'yyyy-MM-dd HH:mm:ss').replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => m[k]);
      },
      computeDigest: (_, s) => [...crypto.createHash('md5').update(s).digest()],
      base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'),
      DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
    },
    UrlFetchApp: { fetch: (url, o) => {
      if (url === 'https://proxy.example') {
        // 고정 IP 프록시 — 이카운트 응답을 그대로 돌려준다
        const body = JSON.parse(o.payload);
        ecCalls.push(body);
        let res;
        if (body.url.endsWith('/OAPI/V2/Zone')) res = { Data: { ZONE: 'CD' } };
        else if (body.url.includes('/OAPILogin')) res = { Data: { Datas: { SESSION_ID: 'S' + (++ecLogins) } } };
        else res = ecSave(body);
        if (res instanceof Error) throw res;
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(res) };
      }
      if (url.includes('/api/deposits/ingest')) {
        if (mirrorFail) throw new Error('V2 down');
        mirrors.push({ headers: o.headers, body: JSON.parse(o.payload) });
      } else chats.push(JSON.parse(o.payload));
      return { getResponseCode: () => 200 };
    } },
    ContentService: { createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: 'json' } },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: (h) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => h }) }) }) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'test' }) },
    Logger: { log() {} },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['dpParse.gs', 'dpMatch.gs', 'Code.gs', 'dpLedger.gs', 'dpNotify.gs', 'dpWatch.gs', 'dpMirror.gs', 'dpReqLog.gs', 'dpOrders.gs', 'dpCs.gs', 'dpEcount.gs', 'dpCache.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  const post = (params) => ctx.doPost({ parameter: params, postData: { type: 'application/x-www-form-urlencoded', contents: '' } });
  return { ctx, rows, logRows, tabRows, props, chats, mirrors, post, setMirrorFail: (v) => { mirrorFail = v; },
           ecCalls, setEcSave: (fn) => { ecSave = fn; } };
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};

const SMS1 = '[Web발신]\n신한09/28 14:32\n110-***-123456\n입금     50,000\n잔액  1,230,000\n 홍길동';
const SMS2 = '[Web발신]\n신한09/28 15:10\n110-***-123456\n입금     20,000\n잔액  1,250,000\n 김철수';
const SMS_GAP = '[Web발신]\n신한09/28 16:00\n110-***-123456\n입금     10,000\n잔액  1,400,000\n 이영희';

console.log('\n[토큰]');
{
  const { post, rows } = makeEnv();
  ok('토큰이 틀리면 거절', post({ token: 'nope', action: 'sms', body: SMS1 }).ok === false);
  ok('거절되면 대장에 안 적힘', rows.length === 0);
}

console.log('\n[같은 문자는 한 줄]');
{
  const { post, rows, chats } = makeEnv();
  const a = post({ token: 'tok', action: 'sms', body: SMS1, from: '15778000' });
  const b = post({ token: 'tok', action: 'sms', body: SMS1, from: '15778000' });
  const c = post({ token: 'tok', action: 'sms', body: SMS1, from: '15778000' });
  ok('첫 번째는 기록', a.ok && a.dup === false && a.result === '입금', JSON.stringify(a));
  ok('두 번째·세 번째는 중복', b.dup === true && c.dup === true);
  ok('대장은 머리글 + 1줄', rows.length === 2, rows.length);
  ok('알림도 1번만', chats.length === 1, chats.length);
  ok('입금 상태는 「대기」', rows[1][10] === '대기', rows[1][10]);
}

console.log('\n[잔액 연속성]');
{
  const { post, rows, chats } = makeEnv();
  post({ token: 'tok', action: 'sms', body: SMS1 });
  post({ token: 'tok', action: 'sms', body: SMS2 });
  ok('이어지는 입금은 「정상」', rows[2][9] === '정상', rows[2][9]);
  post({ token: 'tok', action: 'sms', body: SMS_GAP });
  ok('건너뛴 입금은 「불연속」', String(rows[3][9]).startsWith('불연속'), rows[3][9]);
  const last = JSON.stringify(chats[chats.length - 1]);
  ok('불연속이면 알림에 경고가 붙는다', last.includes('잔액 불연속'));
}

console.log('\n[챗에 잔액을 안 싣는다]');
{
  const { post, chats } = makeEnv();
  post({ token: 'tok', action: 'sms', body: SMS1 });
  post({ token: 'tok', action: 'sms', body: SMS_GAP });
  const all = JSON.stringify(chats);
  ok('입금 카드에 잔액 숫자가 없다', !/1,?230,?000|1,?400,?000/.test(all), all.slice(0, 200));
  ok('예상 잔액도 없다', !/1,?240,?000/.test(all));
  ok('불연속 경고는 그대로 간다', all.includes('잔액 불연속'));
}
{
  const { post, chats } = makeEnv();
  post({ token: 'tok', action: 'sms', body: '[기업] 알림 잔액 12,345,678원 확인바랍니다' });
  ok('읽지 못한 문자 원문에서도 잔액을 가린다',
    chats.length === 1 && !chats[0].text.includes('12,345,678') && chats[0].text.includes('잔액 ***'), chats[0] && chats[0].text);
}

console.log('\n[늦게 온 문자]');
{
  const { post, rows } = makeEnv();
  post({ token: 'tok', action: 'sms', body: SMS2 });   // 15:10 이 먼저 도착
  post({ token: 'tok', action: 'sms', body: SMS1 });   // 14:32 가 늦게 도착
  ok('더 늦은 거래를 «직전»으로 보지 않는다', rows[2][9] === '확인불가', rows[2][9]);
}

console.log('\n[읽지 못한 문자]');
{
  const { post, rows, chats } = makeEnv();
  const r = post({ token: 'tok', action: 'sms', body: '신한은행 인증번호 [482910]' });
  post({ token: 'tok', action: 'sms', body: '신한은행 인증번호 [482910]' });
  ok('미해석으로 남긴다', r.result === '미해석' && rows[1][10] === '미해석');
  ok('같은 원문은 한 줄', rows.length === 2);
  ok('챗으로 알린다', chats.length === 1 && chats[0].text.includes('읽지 못한'));
}

console.log('\n[폰 생존 감시]');
{
  const { ctx, post, props, chats } = makeEnv();
  post({ token: 'tok', action: 'ping' });
  ok('ping 이 마지막 신호를 적는다', !!props.DP_LAST_SEEN);
  props.DP_LAST_SEEN = String(Date.now() - 90 * 60000);
  ctx.dpWatch(); ctx.dpWatch();
  ok('1시간 넘으면 끊김 알림 — 한 번만', chats.filter(c => c.text && c.text.includes('끊김')).length === 1);
  post({ token: 'tok', action: 'ping' });
  ok('돌아오면 복구 알림', chats.some(c => c.text && c.text.includes('다시 연결')));
}

console.log('\n[발신번호 거름]');
{
  const { ctx, post, rows } = makeEnv();
  ctx.DP_ALLOWED_SENDERS = '1577-8000';
  ok('다른 번호는 거절', post({ token: 'tok', action: 'sms', body: SMS1, from: '01012345678' }).ok === false);
  ok('은행 번호는 통과', post({ token: 'tok', action: 'sms', body: SMS1, from: '15778000' }).ok === true);
  ok('거절된 건 안 적힘', rows.length === 2);
}

console.log('\n[간단 방식 — 주소에 토큰, 본문은 문자 그대로]');
{
  const { ctx, rows } = makeEnv();
  const r = ctx.doPost({ parameter: { token: 'tok', action: 'sms' },
    postData: { type: 'text/plain', contents: SMS1 } });
  ok('본문 글자를 문자로 읽는다', r.ok && r.result === '입금', JSON.stringify(r));
  ok('줄바꿈이 살아 있다', rows[1] && String(rows[1][12]) === SMS1);
  const p = ctx.doPost({ parameter: { token: 'tok', action: 'ping' }, postData: { type: 'text/plain', contents: '' } });
  ok('신호(ping)도 된다', p.ok && p.action === 'ping');
}

console.log('\n[본문 앞 토큰 — MacroDroid 가 «?» 뒤를 떼는 경우]');
{
  const { ctx, rows } = makeEnv();
  const r = ctx.doPost({ parameter: {}, postData: { type: 'text/plain', contents: 'dp:tok ' + SMS1 } });
  ok('「dp:토큰 문자」 로 받는다 (동작은 기본 sms)', r.ok && r.result === '입금', JSON.stringify(r));
  ok('원문에서 토큰은 떼고 적는다', rows[1] && String(rows[1][12]) === SMS1);
  ok('토큰이 대장에 안 남는다', !JSON.stringify(rows).includes('dp:tok'));
  const bad = ctx.doPost({ parameter: {}, postData: { type: 'text/plain', contents: 'dp:nope ' + SMS2 } });
  ok('본문 토큰이 틀리면 거절', bad.ok === false && rows.length === 2);
  const nl = ctx.doPost({ parameter: {}, postData: { type: 'text/plain', contents: 'dp:tok\n' + SMS2 } });
  ok('토큰 뒤 줄바꿈이어도 된다', nl.ok && rows.length === 3);
}

console.log('\n[수신로그 — 왜 안 받았는지 남긴다]');
{
  const { ctx, rows, logRows, props, post } = makeEnv();
  props.DP_LEDGER_ID = 'SS';   // dpSetup 이 적어 둔 상태
  ctx.doPost({ parameter: { token: 'nope', action: 'sms' }, postData: { type: 'text/plain', contents: SMS1 } });
  const last = () => logRows[logRows.length - 1];
  ok('토큰이 틀려도 한 줄 남긴다', last() && last()[3] === '틀림' && String(last()[7]).startsWith('거절'), JSON.stringify(last()));
  ok('토큰 값은 안 적는다', !JSON.stringify(logRows).includes('nope'));
  const g = ctx.doGet({ parameter: { token: 'tok', action: 'sms' } });
  ok('GET 으로 오면 POST 로 바꾸라고 답한다', g.ok === false && g.error.includes('POST'));
  ok('GET 도 기록한다', last()[1] === 'GET' && last()[3] === '맞음');
  ok('주소만 열면(GET, 토큰 없음) 그냥 살아 있음', ctx.doGet({ parameter: {} }).ok === true);
  ctx.doPost({ parameter: { token: 'tok', action: 'sms' }, postData: { type: 'text/plain', contents: SMS1 } });
  ok('받아들인 요청도 기록한다', String(last()[7]).startsWith('OK 입금'), last()[7]);
  ok('대장에는 입금 1줄만 (로그와 섞이지 않는다)', rows.length === 2, rows.length);
  const before = logRows.length;
  post({ token: 'tok', action: 'ping' });
  ok('정상 신호는 로그에 안 쌓인다', logRows.length === before);
}

console.log('\n[폼 형식으로 문자만 실어 온 경우]');
{
  const { ctx, rows } = makeEnv();
  // MacroDroid 기본(폼)으로 문자 본문을 그대로 보내면, 구글은 본문을 「이름=값」으로 쪼갠다
  const r = ctx.doPost({ parameter: { token: 'tok', action: 'sms', [SMS1]: '' },
    postData: { type: 'application/x-www-form-urlencoded', contents: SMS1 } });
  ok('원래 본문을 문자로 읽는다', r.ok && r.result === '입금', JSON.stringify(r));
  ok('금액이 맞다', rows[1] && rows[1][7] === 50000);
}

console.log('\n[CS웹앱 조회 — 열쇠 두 개]');
{
  const { ctx, post } = makeEnv();
  ctx.DP_CS_TOKEN = 'cstok';
  const csPost = (o) => ctx.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(o) } });
  // 오늘(2026-09-28) 입금 12건 + 출금 1건 + 미해석 1건
  for (let i = 0; i < 12; i++) {
    const mm = String(10 + i).padStart(2, '0');
    post({ token: 'tok', action: 'sms', body: `[Web발신]\n2026/09/28\n14:${mm}\n입금 ${1000 + i}원\n잔액 ${50000 + i * 1000}원\n입금자${i}\n458***12345678\n기업` });
  }
  post({ token: 'tok', action: 'sms', body: SMS_GAP.replace('입금', '출금') });
  post({ token: 'tok', action: 'sms', body: '신한은행 인증번호 [111]' });

  const r = csPost({ token: 'cstok', action: 'list', date: '2026-09-28', limit: 10 });
  ok('CS 열쇠로 조회된다', r.ok && r.action === 'list', JSON.stringify(r).slice(0, 120));
  ok('10건만 준다', r.rows.length === 10, r.rows.length);
  ok('전체 건수는 12', r.total === 12, r.total);
  ok('합계', r.sum === Array.from({ length: 12 }, (_, i) => 1000 + i).reduce((a, b) => a + b), r.sum);
  ok('최근 것이 위', r.rows[0].time === '14:21' && r.rows[9].time === '14:12', r.rows[0].time + '..' + r.rows[9].time);
  ok('출금은 안 나온다', r.rows.every(x => x.name !== '수수료'));
  ok('잔액은 안 내보낸다', !JSON.stringify(r).includes('50000') && !JSON.stringify(r).includes('balance'));
  ok('계좌는 끝 4자리만', r.rows[0].acct === '5678', r.rows[0].acct);
  const all = csPost({ token: 'cstok', action: 'list', date: '2026-09-28' });
  ok('limit 없으면 당일 전부 (더보기)', all.rows.length === 12);
  const other = csPost({ token: 'cstok', action: 'list', date: '2026-09-27' });
  ok('다른 날은 비어 있다', other.ok && other.total === 0);

  ok('CS 열쇠로는 입금을 못 넣는다', csPost({ token: 'cstok', action: 'sms', body: SMS1 }).ok === false);
  ok('폰 열쇠로는 조회를 못 한다', post({ token: 'tok', action: 'list' }).ok === false);
  ok('틀린 열쇠는 둘 다 안 된다', csPost({ token: 'x', action: 'list' }).ok === false);
}

console.log('\n[주문서 매칭 — 올리기 · 자동 · 지정 · 제외 · 되돌리기]');
{
  const { ctx, post, rows, tabRows, chats } = makeEnv();
  ctx.DP_CS_TOKEN = 'cstok';
  const cs = (o) => ctx.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(Object.assign({ token: 'cstok' }, o)) } });
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate());
  const T = ymd(now), Y = ymd(new Date(now - 864e5));
  let bal = 1000000, mm = 0;
  const sms = (name, amount) => {
    bal += amount; mm++;
    return `[Web발신]\n${T}\n10:${p2(mm)}\n입금 ${amount.toLocaleString()}원\n잔액 ${bal.toLocaleString()}원\n${name}\n458***12345678\n기업`;
  };
  const sheetRows = [
    ['회사명 : 주식회사 팩투유', '', '', '', '', '', '', '', '', '', '', ''],
    ['주문번호', '거래처명', '거래처코드', '거래처모바일', '수령인', '담당자', '품목', '납기일자', '금액', '종결\n여부', '진행\n상태', '인쇄'],
    [Y + ' -1', '구도로통닭 역곡점 이병남', '6190464617', '', '', '', 'x', T, '68,500', '완료', '조회', '인쇄'],
    [Y + ' -2', '본가참순대 이령', '1111111111', '', '', '', 'x', T, '88,000', '진행중', '조회', '인쇄'],
    [Y + ' -3', '아주상사 김아주', '2222222222', '', '', '', 'x', T, '88,000', '진행중', '조회', '인쇄'],
    [T + ' -1', '아주상사 김아주', '2222222222', '', '', '', 'x', T, '45,000', '진행중', '조회', '인쇄'],
    [T + ' (화) 오전 9:00:00', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const up = cs({ action: 'orders_upload', rows: sheetRows });
  ok('주문서 올리기 — 4건 추가', up.ok && up.added === 4 && up.read === 4, JSON.stringify(up));
  ok('주문서 탭에 적힌다', tabRows['주문서'] && tabRows['주문서'].length === 5);
  const again = cs({ action: 'orders_upload', rows: sheetRows });
  ok('같은 파일을 또 올려도 추가 0 · 변경 0', again.added === 0 && again.updated === 0, JSON.stringify(again));

  const col = (h) => rows[0].indexOf(h);
  const rowOf = (name) => rows.find((r) => r[col('입금자')] === name);

  post({ token: 'tok', action: 'sms', body: sms('이병남', 68500) });
  ok('대표자 이름 입금 → 자동 일치', rowOf('이병남')[col('매칭결과')] === '일치', rowOf('이병남')[col('매칭결과')]);
  ok('주문번호가 적힌다', rowOf('이병남')[col('주문번호')] === Y + '-1');
  ok('챗 카드에 매칭 결과가 실린다', JSON.stringify(chats[chats.length - 1]).includes('✅ 일치'));

  post({ token: 'tok', action: 'sms', body: sms('홍길동', 88000) });
  const hk = rowOf('홍길동')[col('고유번호')];
  ok('모르는 입금자 + 같은 금액 주문 둘 → 후보', rowOf('홍길동')[col('매칭결과')] === '후보');
  const det = cs({ action: 'detail', key: hk });
  ok('상세 — 후보 주문 둘이 보인다', det.ok && det.options.filter((o) => o.tag === '후보').length === 2, JSON.stringify(det.options));
  ok('상세에 잔액이 없다', !JSON.stringify(det).includes('잔액') && !('balance' in det.deposit));

  const pin = cs({ action: 'assign', key: hk, orders: [Y + '-3'], remember: true, by: '고윤서' });
  ok('사람이 지정 → 일치(지정)', pin.ok && pin.match.result === '일치(지정)' && pin.match.cust === '아주상사 김아주', JSON.stringify(pin));
  ok('별칭표에 남는다', tabRows['별칭표'] && tabRows['별칭표'].length === 2);
  cs({ action: 'assign', key: hk, orders: [Y + '-3'], remember: true, by: '고윤서' });
  ok('같은 별칭을 또 지정해도 한 줄', tabRows['별칭표'].length === 2, tabRows['별칭표'].length);
  const rm = cs({ action: 'rematch' });
  ok('다시 판정(rematch) — 결과 집계를 돌려준다', rm.ok && rm.tally && rm.tally['일치(지정)'] >= 1, JSON.stringify(rm));
  ok('폰 열쇠로는 다시 판정 못 한다', post({ token: 'tok', action: 'rematch' }).ok === false);

  post({ token: 'tok', action: 'sms', body: sms('홍길동', 45000) });
  const second = rows.filter((r) => r[col('입금자')] === '홍길동')[1];
  ok('같은 입금자의 다음 입금은 별칭으로 바로 일치', second[col('매칭결과')] === '일치' && second[col('주문번호')] === T + '-1', second[col('매칭결과')] + ' ' + second[col('주문번호')]);

  // 몇 번을 다시 돌려도 답이 같다 — 입금누계를 «적어 두지 않는» 까닭
  const snap = () => rows.slice(1).map((r) => [r[col('매칭결과')], r[col('주문번호')], r[col('배분')]].join('|')).join('\n');
  const before = snap();
  ctx.dpMatchRun_(); ctx.dpMatchRun_(); ctx.dpMatchRun_();
  ok('매칭을 세 번 더 돌려도 그대로', snap() === before);

  // 이미 다 받은 주문은 또 안 붙는다
  post({ token: 'tok', action: 'sms', body: sms('이병남', 68500) });
  const dupPay = rows.filter((r) => r[col('입금자')] === '이병남')[1];
  ok('이미 받은 주문에 두 번 붙지 않는다', dupPay[col('매칭결과')] !== '일치', dupPay[col('매칭결과')]);

  // 제외하면 그 주문이 다시 비고, 다른 입금이 가져간다
  const firstKey = rowOf('이병남')[col('고유번호')];
  cs({ action: 'exclude', key: firstKey, by: '고윤서' });
  ok('제외', rowOf('이병남')[col('매칭결과')] === '제외');
  ok('제외하면 두 번째 입금이 그 주문과 일치', dupPay[col('매칭결과')] === '일치', dupPay[col('매칭결과')]);
  cs({ action: 'unassign', key: firstKey });
  ok('되돌리면 먼저 들어온 입금이 다시 가져간다', rowOf('이병남')[col('매칭결과')] === '일치' && dupPay[col('매칭결과')] !== '일치');

  // 이카운트에 넘어간 줄은 못 바꾼다
  rowOf('이병남')[col('상태')] = '반영완료';
  const frozen = cs({ action: 'exclude', key: firstKey });
  ok('반영완료 줄은 지정·제외 거절', frozen.ok === false && frozen.error.includes('이카운트'));
  ctx.dpMatchRun_();
  ok('반영완료 줄의 배분은 그대로 센다', dupPay[col('매칭결과')] !== '일치');

  // 찾기
  const s1 = cs({ action: 'orders_search', q: '아주' });
  ok('거래처명으로 찾기', s1.ok && s1.rows.length === 2);
  const s2 = cs({ action: 'orders_search', q: '88,000' });
  ok('금액으로 찾기', s2.rows.length === 2);

  const list = cs({ action: 'list', limit: 10 });
  ok('목록에 매칭 칸이 실린다', list.rows.some((r) => r.result === '일치(지정)' && r.cust === '아주상사 김아주'));
  ok('목록에 주문서 올린 시각', !!list.ordersAt && list.ordersCount === 4);

  const bad = cs({ action: 'orders_upload', rows: [['엉뚱한 엑셀']] });
  ok('다른 엑셀은 거절', bad.ok === false && bad.error.includes('주문서조회'));
  ok('폰 열쇠로는 주문서를 못 올린다', post({ token: 'tok', action: 'orders_upload' }).ok === false);
}

console.log('\n[여러 사람이 서로 다른 때 받은 파일을 올린다]');
{
  const { ctx, post, rows, tabRows } = makeEnv();
  ctx.DP_CS_TOKEN = 'cstok';
  const cs = (o) => ctx.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(Object.assign({ token: 'cstok' }, o)) } });
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate());
  const T = ymd(now), Y = ymd(new Date(now - 864e5)), W = ymd(new Date(now - 7 * 864e5));
  const range = `회사명 : 주식회사 팩투유 / ${W}  ~ ${T} `;
  const head = ['주문번호', '거래처명', '거래처코드', '거래처모바일', '수령인', '담당자', '품목', '납기일자', '금액', '종결\n여부', '진행\n상태', '인쇄'];
  const order = (n, name, code, amt) => [Y + ' -' + n, name, code, '', '', '', 'x', T, amt.toLocaleString(), '진행중', '조회', '인쇄'];
  const base = [];
  for (let i = 1; i <= 12; i++) base.push(order(i, '가게' + i + ' 대표' + i, 'C' + i, 10000 * i));
  const file = (hhmmss, list, withRange = true) =>
    [[withRange ? range : '회사명 : 주식회사 팩투유'], head, ...list, [`${T} (화) ${hhmmss}`]];
  const oCol = (h) => tabRows['주문서'][0].indexOf(h);
  const oRow = (n) => tabRows['주문서'].find((r) => r[0] === Y + '-' + n);

  const a = cs({ action: 'orders_upload', rows: file('오전 9:00:00', base), by: '고윤서' });
  ok('A(09:00) — 12건 새로', a.ok && a.added === 12 && a.missing === 0, JSON.stringify(a));

  // B: 전날 받아 둔 옛 파일 — 3번 금액이 옛 값
  const old = base.map((r) => r.slice()); old[2][8] = '99,999';
  const b = cs({ action: 'orders_upload', rows: file('오전 8:00:00', old), by: '강서희' });
  ok('B(08:00, 옛 파일) — 12건 모두 건너뜀', b.ok && b.stale === 12 && b.updated === 0, JSON.stringify(b));
  ok('옛 파일이 금액을 덮지 않는다', oRow(3)[oCol('금액')] === 30000, oRow(3)[oCol('금액')]);
  let list = cs({ action: 'list', limit: 10 });
  ok('「주문서 ○○ 기준」은 뒤로 가지 않는다 (09:00 · 고윤서)', /09:00/.test(String(list.ordersAt)) && list.ordersBy === '고윤서', list.ordersAt + ' ' + list.ordersBy);

  // C: 더 늦게 받은 파일 — 5번이 이카운트에서 지워졌다, 3번 금액이 바뀌었다
  const newer = base.filter((r) => r[0] !== Y + ' -5').map((r) => r.slice()); newer[2][8] = '33,000';
  const c = cs({ action: 'orders_upload', rows: file('오전 10:00:00', newer), by: '박상식' });
  ok('C(10:00) — 5번 없어짐 · 3번 바뀜', c.ok && c.missing === 1 && c.updated === 1, JSON.stringify(c));
  ok('없어진 주문은 표시만 (지우지 않는다)', oRow(5) && oRow(5)[oCol('상태')] === '없어짐');
  // 없어진 주문 금액 그대로 입금이 와도 붙지 않는다
  post({ token: 'tok', action: 'sms', body: `[Web발신]\n${T}\n11:00\n입금 50,000원\n잔액 1,050,000원\n대표5\n458***12345678\n기업` });
  const r5 = rows.find((r) => r[rows[0].indexOf('입금자')] === '대표5');
  ok('없어진 주문에는 매칭하지 않는다', r5[rows[0].indexOf('매칭결과')] !== '일치', r5[rows[0].indexOf('매칭결과')]);

  // D: 5번이 다시 보이는 파일 → 되살아난다, 입금이 그제야 붙는다
  const d = cs({ action: 'orders_upload', rows: file('오전 11:30:00', base.map((r, i) => i === 2 ? order(3, '가게3 대표3', 'C3', 33000) : r)), by: '고윤서' });
  ok('D(11:30) — 5번 되살아남', d.ok && d.revived === 1 && oRow(5)[oCol('상태')] === '', JSON.stringify(d));
  ok('되살아난 주문에 입금이 붙는다', r5[rows[0].indexOf('매칭결과')] === '일치', r5[rows[0].indexOf('매칭결과')]);

  // E: 담당자로 걸러 3건만 받은 파일 — 기간 안 9건이 «없어 보인다» → 표시하지 않는다
  const e = cs({ action: 'orders_upload', rows: file('오후 12:00:00', base.slice(0, 3)), by: '김진수' });
  ok('걸러 받은 파일 — 없어짐 표시 안 함 + 알림', e.ok && e.missing === 0 && e.warn.some((w) => w.includes('걸러')), JSON.stringify(e));
  ok('다른 주문은 멀쩡', tabRows['주문서'].slice(1).every((r) => r[oCol('상태')] !== '없어짐'));

  // F: 조회 기간이 없는 파일 — 추가·수정만, 지워진 것은 안 본다
  const f = cs({ action: 'orders_upload', rows: file('오후 1:00:00', base.slice(0, 2), false), by: '김진수' });
  ok('기간 없는 파일 — 알림만', f.ok && f.missing === 0 && f.warn.some((w) => w.includes('조회 기간')), JSON.stringify(f));

  // 올린 기록
  const up = tabRows['주문서올림'];
  ok('올린 기록 6줄 (누가 · 파일 받은 시각)', up && up.length === 7 && up[1][1] === '고윤서' && String(up[2][2]).includes('08:00'),
     up && JSON.stringify(up.slice(1, 3)));
  list = cs({ action: 'list', limit: 10 });
  ok('기준은 가장 늦은 파일 (13:00 · 김진수)', /13:00/.test(String(list.ordersAt)) && list.ordersBy === '김진수', list.ordersAt + ' ' + list.ordersBy);
}

console.log('\n[이카운트 반영 — 두 번 눌러도 한 장]');
{
  const { ctx, post, rows, props, ecCalls, setEcSave } = makeEnv();
  ctx.DP_CS_TOKEN = 'cstok';
  ctx.DP_ECOUNT_PROXY_URL = 'https://proxy.example'; ctx.DP_ECOUNT_PROXY_KEY = 'pk';
  const cs = (o) => ctx.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(Object.assign({ token: 'cstok' }, o)) } });
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const T = now.getFullYear() + '/' + p2(now.getMonth() + 1) + '/' + p2(now.getDate());
  const Y = (() => { const d = new Date(now - 864e5); return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()); })();
  cs({ action: 'orders_upload', rows: [
    ['회사명 : 주식회사 팩투유'], ['주문번호', '거래처명', '거래처코드', '거래처모바일', '수령인', '담당자', '품목', '납기일자', '금액', '종결\n여부', '진행\n상태', '인쇄'],
    [Y + ' -1', '장터순대 정명옥', '1212181120', '', '', '', 'x', T, '58,600', '진행중', '조회', '인쇄'],
    [Y + ' -2', '원막국수만두 김상원', '4016300265', '', '', '', 'x', T, '213,500', '진행중', '조회', '인쇄'],
    [Y + ' -3', '태조감자국 이호광', '5800200757', '', '', '', 'x', T, '74,500', '진행중', '조회', '인쇄'],
    [T + ' (화) 오전 9:00:00']] });
  let bal = 1000000, mm = 0;
  const sms = (name, amount) => { bal += amount; mm++;
    return `[Web발신]\n${T}\n10:${p2(mm)}\n입금 ${amount.toLocaleString()}원\n잔액 ${bal.toLocaleString()}원\n${name}\n458***12345678\n기업`; };
  post({ token: 'tok', action: 'sms', body: sms('정명옥', 58600) });
  post({ token: 'tok', action: 'sms', body: sms('김상원', 213500) });
  post({ token: 'tok', action: 'sms', body: sms('이호광', 74500) });
  post({ token: 'tok', action: 'sms', body: sms('홍길동', 9999) });            // 미확인 — 못 넘긴다
  const col = (h) => rows[0].indexOf(h);
  const rowOf = (n) => rows.find((r) => r[col('입금자')] === n);
  const keyOf = (n) => rowOf(n)[col('고유번호')];

  let r = cs({ action: 'post', keys: [keyOf('정명옥')] });
  ok('기본은 꺼짐 — 보내지 않는다', r.ok === false && r.error.includes('꺼져') && ecCalls.length === 0);
  props.DP_ECOUNT_POST = 'on';
  r = cs({ action: 'post', keys: [keyOf('정명옥')] });
  ok('설정이 비면 보내지 않는다', r.ok === false && r.error.includes('ECOUNT_COM_CODE') && ecCalls.length === 0, r.error);
  Object.assign(props, { ECOUNT_COM_CODE: '178341', ECOUNT_USER_ID: 'U', ECOUNT_API_CERT_KEY: 'K', DP_GYE_BANK: '1031', DP_GYE_AR: '1080' });
  props.DP_ECOUNT_FROM = '2000-01-01 00:00';   // 반영 시작 시각 — 이 뒤 입금만 넘긴다

  r = cs({ action: 'post', keys: [keyOf('정명옥')], by: '강서희' });
  ok('반영 → 반영완료 · 전표번호', r.ok && r.results[0].outcome === '반영완료' && rowOf('정명옥')[col('상태')] === '반영완료' && /^20260929-/.test(rowOf('정명옥')[col('전표번호')]), JSON.stringify(r));
  ok('누가 · 언제', rowOf('정명옥')[col('반영자')] === '강서희' && !!rowOf('정명옥')[col('반영시각')]);
  const save = ecCalls.find((c) => c.url.includes('SaveGeneralJournal'));
  ok('Zone → 로그인 → 전표 (고정 IP 프록시로)', ecCalls[0].url.endsWith('/Zone') && ecCalls[1].url.includes('OAPILogin') && save && save.url.startsWith('https://oapiCD.ecount.com'));
  ok('보낸 전표 — 차변 보통예금 · 대변 외상매출금(거래처)', save.payload.GeneralJournalList.length === 2 &&
     save.payload.GeneralJournalList[1].BulkDatas.CUST_D === '1212181120' && save.payload.GeneralJournalList[0].BulkDatas.GYE_CODE === '1031');

  const n1 = ecCalls.length;
  r = cs({ action: 'post', keys: [keyOf('정명옥')] });
  ok('또 눌러도 안 보낸다 (반영완료)', r.results[0].outcome === '건너뜀' && ecCalls.length === n1, JSON.stringify(r));
  r = cs({ action: 'post', keys: [keyOf('김상원'), keyOf('김상원')] });
  ok('한 번에 같은 입금을 두 번 넣어도 한 장', r.results.filter((x) => x.outcome === '반영완료').length === 1 &&
     ecCalls.filter((c) => c.url.includes('SaveGeneralJournal')).length === 2, JSON.stringify(r));
  ok('세션은 다시 로그인하지 않고 재사용', ecCalls.filter((c) => c.url.includes('OAPILogin')).length === 1);

  // 이카운트가 «안 받았다» — 대기로 되돌린다
  setEcSave(() => ({ Status: '200', Data: { SuccessCnt: 0, FailCnt: 1, SlipNos: [],
    ResultDetails: [{ IsSuccess: false, TotalError: '거래처', Errors: [{ ColCd: 'CUST_D', Message: '거래처' }] }] } }));
  r = cs({ action: 'post', keys: [keyOf('이호광')] });
  ok('거절 → 대기로 되돌림 + 까닭', r.results[0].outcome === '거절' && rowOf('이호광')[col('상태')] === '대기' &&
     rowOf('이호광')[col('반영메모')].includes('CUST_D'), JSON.stringify(r));

  // 응답이 끊겼다 — 들어갔는지 모른다
  setEcSave(() => new Error('timeout'));
  r = cs({ action: 'post', keys: [keyOf('이호광')] });
  ok('응답 끊김 → 확인필요 (다시 보내지 않는다)', r.results[0].outcome === '확인필요' && rowOf('이호광')[col('상태')] === '확인필요');
  setEcSave(() => ({ Status: '200', Data: { SuccessCnt: 1, SlipNos: ['X-1'] } }));
  const n2 = ecCalls.length;
  r = cs({ action: 'post', keys: [keyOf('이호광')] });
  ok('확인필요는 또 눌러도 안 보낸다', r.results[0].outcome === '건너뜀' && ecCalls.length === n2);
  r = cs({ action: 'post_resolve', key: keyOf('이호광'), slipNo: '20260929-99', by: '강서희' });
  ok('사람이 확인 — 이카운트에 있음 → 반영완료', r.ok && rowOf('이호광')[col('상태')] === '반영완료' && rowOf('이호광')[col('전표번호')] === '20260929-99');

  r = cs({ action: 'post', keys: [keyOf('홍길동')] });
  ok('미확인은 넘기지 않는다', r.results[0].outcome === '건너뜀' && r.results[0].message.includes('미확인'));

  // 넘어간 줄은 매칭을 다시 돌려도 그대로, 지정·제외도 거절
  const before = [col('매칭결과'), col('배분'), col('전표번호')].map((i) => rowOf('정명옥')[i]).join('|');
  cs({ action: 'rematch' });
  ok('반영완료 줄은 다시 판정해도 그대로', [col('매칭결과'), col('배분'), col('전표번호')].map((i) => rowOf('정명옥')[i]).join('|') === before);
  ok('반영완료 줄은 제외 못 한다', cs({ action: 'exclude', key: keyOf('정명옥') }).ok === false);

  const list = cs({ action: 'list', limit: 10 });
  const lr = list.rows.find((x) => x.name === '정명옥');
  ok('목록에 전표번호 · 넘길 수 있나', lr.slipNo && lr.canPost === false && list.rows.find((x) => x.name === '홍길동').canPost === false);
  ok('폰 열쇠로는 반영 못 한다', post({ token: 'tok', action: 'post', keys: [keyOf('홍길동')] }).ok === false);
}

console.log('\n[이중 입금 — 손으로 이미 넣은 것 · 시작 전 입금은 안 넘긴다]');
{
  const { ctx, post, rows, props, ecCalls } = makeEnv();
  ctx.DP_CS_TOKEN = 'cstok';
  ctx.DP_ECOUNT_PROXY_URL = 'https://proxy.example'; ctx.DP_ECOUNT_PROXY_KEY = 'pk';
  Object.assign(props, { ECOUNT_COM_CODE: 'C', ECOUNT_USER_ID: 'U', ECOUNT_API_CERT_KEY: 'K', DP_ECOUNT_POST: 'on' });
  const cs = (o) => ctx.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(Object.assign({ token: 'cstok' }, o)) } });
  const now = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const T = now.getFullYear() + '/' + p2(now.getMonth() + 1) + '/' + p2(now.getDate());
  const Td = T.replace(/\//g, '-');
  cs({ action: 'orders_upload', rows: [['회사명'], ['주문번호', '거래처명', '거래처코드', '거래처모바일', '수령인', '담당자', '품목', '납기일자', '금액'],
    [T + ' -1', '가게갑 김갑', 'A1', '', '', '', 'x', T, '10,000'], [T + ' -2', '가게을 이을', 'B1', '', '', '', 'x', T, '20,000'],
    [T + ' -3', '가게병 박병', 'C1', '', '', '', 'x', T, '30,000'], [T + ' (화) 오전 8:00:00']] });
  let bal = 500000;
  const sms = (hhmm, name, amount) => { bal += amount;
    return `[Web발신]\n${T}\n${hhmm}\n입금 ${amount.toLocaleString()}원\n잔액 ${bal.toLocaleString()}원\n${name}\n458***12345678\n기업`; };
  post({ token: 'tok', action: 'sms', body: sms('09:00', '김갑', 10000) });   // 시작 전
  post({ token: 'tok', action: 'sms', body: sms('13:00', '이을', 20000) });   // 시작 뒤
  post({ token: 'tok', action: 'sms', body: sms('13:30', '박병', 30000) });   // 시작 뒤, 누가 손으로 이미 넣음
  const col = (h) => rows[0].indexOf(h);
  const keyOf = (n) => rows.find((r) => r[col('입금자')] === n)[col('고유번호')];
  const rowOf = (n) => rows.find((r) => r[col('입금자')] === n);

  props.DP_ECOUNT_FROM = '2999-01-01 00:00';   // 속성이 코드 기본값(2026-09-30 00:00)을 이긴다
  let r = cs({ action: 'post', keys: [keyOf('이을')] });
  ok('시작 시각보다 앞선 입금은 아무것도 안 넘긴다 (속성이 기본값을 이긴다)', r.results[0].outcome === '건너뜀' && r.results[0].message.includes('시작') && ecCalls.length === 0, JSON.stringify(r));
  props.DP_ECOUNT_FROM = Td + ' 12:00';
  r = cs({ action: 'post', keys: [keyOf('김갑')] });
  ok('시작 전 입금은 안 넘긴다 (손으로 처리했을 수 있다)', r.results[0].outcome === '건너뜀' && ecCalls.length === 0, JSON.stringify(r));

  const mk = cs({ action: 'mark_manual', key: keyOf('박병'), by: '고윤서' });
  ok('「이미 이카운트에 넣었음」 → 반영완료 · 전표 「손으로」', mk.ok && rowOf('박병')[col('상태')] === '반영완료' && rowOf('박병')[col('전표번호')] === '손으로');
  r = cs({ action: 'post', keys: [keyOf('박병')] });
  ok('손으로 넣은 입금은 시스템이 또 안 넘긴다', r.results[0].outcome === '건너뜀' && ecCalls.length === 0, JSON.stringify(r));
  r = cs({ action: 'post', keys: [keyOf('이을')] });
  ok('시작 뒤 · 손으로 안 넣은 입금만 넘긴다', r.results[0].outcome === '반영완료', JSON.stringify(r));
  ok('이카운트에는 딱 한 장 갔다', ecCalls.filter((c) => c.url.includes('SaveGeneralJournal')).length === 1);

  ok('실제 전표로 넘어간 줄은 「이미 넣었음」 되돌리기 불가', cs({ action: 'mark_manual', key: keyOf('이을'), undo: true }).ok === false);
  const un = cs({ action: 'mark_manual', key: keyOf('박병'), undo: true, by: '고윤서' });
  ok('잘못 누른 「이미 넣었음」 은 되돌린다 → 대기', un.ok && rowOf('박병')[col('상태')] === '대기' && rowOf('박병')[col('전표번호')] === '');
  const det = cs({ action: 'detail', key: keyOf('김갑') });
  ok('시작 전 입금 — 반영 버튼 없음 · 「이미 넣었음」 은 가능', det.deposit.canPost === false && det.deposit.canMarkManual === true);
}

console.log('\n[오늘 + 어제 — 자정이 지나도 목록이 안 사라진다]');
{
  const { ctx, post } = makeEnv();
  ctx.DP_CS_TOKEN = 'cstok';
  const cs = (o) => ctx.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(Object.assign({ token: 'cstok' }, o)) } });
  post({ token: 'tok', action: 'sms', body: '[Web발신]\n2026/09/27\n23:50\n입금 7,000원\n잔액 1,000,000원\n엊그제\n458***12345678\n기업' });
  post({ token: 'tok', action: 'sms', body: '[Web발신]\n2026/09/28\n22:10\n입금 5,000원\n잔액 1,005,000원\n어제분\n458***12345678\n기업' });
  post({ token: 'tok', action: 'sms', body: '[Web발신]\n2026/09/29\n00:05\n입금 3,000원\n잔액 1,008,000원\n오늘분\n458***12345678\n기업' });
  const one = cs({ action: 'list', date: '2026-09-29', limit: 10 });
  ok('기본(하루)은 오늘만', one.rows.length === 1 && one.rows[0].name === '오늘분');
  const two = cs({ action: 'list', date: '2026-09-29', limit: 10, days: 2 });
  ok('days=2 — 오늘 + 어제, 최신이 위', two.rows.map((x) => x.name).join() === '오늘분,어제분', two.rows.map((x) => x.name).join());
  ok('엊그제는 안 나온다', !two.rows.some((x) => x.name === '엊그제'));
  ok('「오늘 N건」 은 오늘 것만 · 합친 건수는 따로', two.total === 1 && two.sum === 3000 && two.count === 2);
  ok('날마다 건수 · 합계', two.byDay['2026-09-28'].total === 1 && two.byDay['2026-09-28'].sum === 5000);
  ok('줄마다 날짜', two.rows[1].day === '2026-09-28');
}

console.log('\n[일반전표 API 검증 — 테스트 서버, 보낸 입금은 확인필요로 묶는다]');
{
  const { ctx, post, rows, props, ecCalls, setEcSave } = makeEnv();
  ctx.DP_CS_TOKEN = 'cstok';
  ctx.DP_ECOUNT_PROXY_URL = 'https://proxy.example'; ctx.DP_ECOUNT_PROXY_KEY = 'pk';
  Object.assign(props, { ECOUNT_COM_CODE: 'C', ECOUNT_USER_ID: 'U', ECOUNT_API_CERT_KEY: 'REAL', DP_ECOUNT_FROM: '2000-01-01 00:00' });
  const cs = (o) => ctx.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(Object.assign({ token: 'cstok' }, o)) } });
  const now = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const T = now.getFullYear() + '/' + p2(now.getMonth() + 1) + '/' + p2(now.getDate());
  cs({ action: 'orders_upload', rows: [['회사명'], ['주문번호', '거래처명', '거래처코드', '금액'], [T + ' -1', '예원 왕려려', 'W1', '44,000'], [T + ' (화) 오전 8:00:00']] });
  post({ token: 'tok', action: 'sms', body: `[Web발신]\n${T}\n09:10\n입금 44,000원\n잔액 100,000원\n왕려려(예원)\n458***12345678\n기업` });
  const col = (h) => rows[0].indexOf(h);
  const row = rows.find((r) => r[col('입금자')] === '왕려려(예원)');
  const key = row[col('고유번호')];

  let r = cs({ action: 'ec_verify', key });
  ok('테스트 인증키가 없으면 안 보낸다', r.ok === false && r.error.includes('ECOUNT_TEST_CERT_KEY') && ecCalls.length === 0);
  props.ECOUNT_TEST_CERT_KEY = 'TEST';
  setEcSave(() => ({ Status: '200', Data: { SuccessCnt: 0, FailCnt: 1, SlipNos: [],
    ResultDetails: [{ IsSuccess: false, TotalError: '양식필수', Errors: [{ ColCd: 'REMARKS_DES', Message: '필수' }] }] } }));
  r = cs({ action: 'ec_verify', key });
  ok('테스트 서버가 거절 → 대기 + 까닭 (전표 모양을 고칠 단서)', r.ok && r.kind === 'reject' && row[col('상태')] === '대기' && row[col('반영메모')].includes('REMARKS_DES'), JSON.stringify(r));
  const login = ecCalls.find((c) => c.url.includes('OAPILogin'));
  ok('테스트 서버(sboapi)에 테스트 인증키로', login.url.startsWith('https://sboapi') && login.payload.API_CERT_KEY === 'TEST');
  ok('전표도 테스트 서버로', ecCalls.some((c) => c.url.startsWith('https://sboapi') && c.url.includes('SaveGeneralJournal')));

  setEcSave(() => ({ Status: '200', Data: { SuccessCnt: 1, SlipNos: ['20260930-1'] } }));
  r = cs({ action: 'ec_verify', key });
  ok('테스트 서버가 받음 → 확인필요 (실제 장부에 생겼는지 사람이 확인)', r.kind === 'ok' && row[col('상태')] === '확인필요' && row[col('반영메모')].includes('20260930-1'), row[col('반영메모')]);
  props.DP_ECOUNT_POST = 'on';
  const n = ecCalls.length;
  r = cs({ action: 'post', keys: [key] });
  ok('확인필요로 묶인 입금은 운영으로 다시 안 보낸다', r.results[0].outcome === '건너뜀' && ecCalls.length === n);
}

console.log('\n[읽기 캐시 — 바뀐 게 없으면 다시 안 읽는다]');
{
  const { ctx, post, rows } = makeEnv();
  ctx.DP_CS_TOKEN = 'cstok';
  const cs = (o) => ctx.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(Object.assign({ token: 'cstok' }, o)) } });
  post({ token: 'tok', action: 'sms', body: SMS1 });
  const a = cs({ action: 'list', date: '2026-09-28', limit: 10 });
  const nameCol = rows[0].indexOf('입금자');
  rows[1][nameCol] = '손으로고침';                       // 시트를 손으로 고쳤다 (판 번호 안 올라감)
  const b = cs({ action: 'list', date: '2026-09-28', limit: 10 });
  ok('바뀐 게 없으면 캐시 (손으로 고친 건 아직 안 보임)', b.rows[0].name === a.rows[0].name && a.rows[0].name === '홍길동');
  const c = cs({ action: 'list', date: '2026-09-28', limit: 10, force: true });
  ok('↻ 갱신(force)은 새로 읽는다', c.rows[0].name === '손으로고침', c.rows[0].name);
  post({ token: 'tok', action: 'sms', body: SMS2 });
  const d = cs({ action: 'list', date: '2026-09-28', limit: 10 });
  ok('새 입금이 오면 곧바로 새 목록', d.total === 2, d.total);
}

console.log('\n[V2 미러]');
{
  const { post, mirrors } = makeEnv();
  post({ token: 'tok', action: 'sms', body: SMS1 });
  ok('기본은 꺼짐 — V2 로 안 보낸다', mirrors.length === 0);
}
{
  const { post, props, mirrors, rows, chats, setMirrorFail } = makeEnv();
  props.DEPOSIT_MIRROR = 'on';
  post({ token: 'tok', action: 'sms', body: SMS1, from: '15778000' });
  ok('켜면 한 번 보낸다', mirrors.length === 1, mirrors.length);
  const m = mirrors[0] || { body: { rows: [{}] }, headers: {} };
  const r = m.body.rows[0];
  ok('전용 토큰 헤더', m.headers['x-ingest-token'] === 'v2tok');
  ok('규칙 버전을 싣는다', m.body.coreVersion === '1.0.0', m.body.coreVersion);
  ok('원문을 그대로 보낸다 (V2 가 다시 읽는다)', r.body === SMS1);
  ok('고유번호가 대장과 같다', r.key === rows[1][0]);
  ok('시트 해석은 대조용으로 싣는다', r.sheet && r.sheet.amount === 50000 && r.sheet.status === '대기');
  post({ token: 'tok', action: 'sms', body: SMS1 });
  ok('중복 문자는 V2 로도 안 간다', mirrors.length === 1);
  setMirrorFail(true);
  const res = post({ token: 'tok', action: 'sms', body: SMS2 });
  ok('V2 가 죽어도 수신은 성공', res.ok === true && rows.length === 3);
  ok('V2 가 죽어도 챗 알림은 간다', chats.length === 2, chats.length);
}

console.log('\n' + pass + ' 통과 · ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
