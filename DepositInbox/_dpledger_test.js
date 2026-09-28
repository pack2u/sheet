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
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    getRange(r, c, nr = 1, nc = 1) {
      if (typeof r === 'string') return { setNumberFormat() { return this; } };
      return {
        getValues: () => Array.from({ length: nr }, (_, i) =>
          Array.from({ length: nc }, (_, j) => ((rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (rows[r - 1 + i] = rows[r - 1 + i] || [])[c - 1 + j] = x; })); return this; },
        setValue(x) { (rows[r - 1] = rows[r - 1] || [])[c - 1] = x; return this; },
        setFontWeight() { return this; },
        createTextFinder: (txt) => ({ matchEntireCell: () => ({ findNext: () => {
          for (let i = 0; i < nr; i++) if (String((rows[r - 1 + i] || [])[c - 1]) === txt) return {};
          return null;
        } }) }),
      };
    },
    // 진짜 시트처럼 — 「2026-09-28 23:55」 같은 글자는 날짜(Date)로 바뀌어 저장된다 (2026-09-29 실측)
    appendRow: (row) => rows.push(row.map(v =>
      (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) ? new Date(v.replace(' ', 'T')) : v)),
    setFrozenRows() {}, hideColumns() {}, setName() { return sheet; },
  };
  const logRows = [];
  let logSheet = null;
  const makeLogSheet = () => ({
    getRange: () => ({ setValues(v) { logRows.push(...v); return this; }, setFontWeight() { return this; } }),
    setFrozenRows() {}, appendRow: (r) => logRows.push(r.slice()), getLastRow: () => logRows.length, deleteRows() {},
  });
  const ss = {
    getSheetByName: (n) => n === '수신로그' ? logSheet : sheet,
    getSheets: () => [sheet],
    insertSheet: (n) => n === '수신로그' ? (logSheet = makeLogSheet()) : sheet,
    getId: () => 'SS', getUrl: () => 'url',
  };
  const ctx = {
    DP_PHONE_TOKEN: 'tok', DP_CHAT_WEBHOOK: 'https://chat', DP_ALLOWED_SENDERS: '',
    V2_URL: 'https://v2.example/', DEPOSIT_INGEST_TOKEN: 'v2tok',
    SpreadsheetApp: { openById: () => ss, create: () => ss },
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
  for (const f of ['dpParse.gs', 'Code.gs', 'dpLedger.gs', 'dpNotify.gs', 'dpWatch.gs', 'dpMirror.gs', 'dpReqLog.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  const post = (params) => ctx.doPost({ parameter: params, postData: { type: 'application/x-www-form-urlencoded', contents: '' } });
  return { ctx, rows, logRows, props, chats, mirrors, post, setMirrorFail: (v) => { mirrorFail = v; } };
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
