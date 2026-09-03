import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

const files = ['core.js', 'gasIO.js', 'gasMasters.js', 'gasMain.js', 'gasSeed.js', 'gasZip.js', 'gasExcel.js'];
const src = Object.fromEntries(files.map((f) => [f, readFileSync('../' + f, 'utf8').toString()]));
const all = files.map((f) => src[f]).join('\n');
let bad = 0;
const chk = (ok, label, detail) => {
  if (ok) console.log('  ok   ' + label);
  else { bad++; console.log('  XX   ' + label + (detail ? '  -> ' + detail : '')); }
};

console.log('\n[1] 메뉴가 가리키는 함수가 실제로 있나');
for (const m of src['gasMain.js'].matchAll(/addItem\('([^']+)',\s*'([^']+)'\)/g)) {
  chk(all.includes('function ' + m[2] + '(') || all.includes('function ' + m[2] + ' ('), m[1] + '  ->  ' + m[2]);
}

console.log('\n[2] 헤더 길이 = 행 생성기 출력 길이');
const u = { 출고지: 'A', 순번: '1', 일자: 'd', 품목코드: 'c', 품목명: 'n', 박스수: 1, 수량: 1,
  전화: '', 모바일: '', 주소1: '', 배송메시지: '', 합계: 0, 받는분: '', 배송비: 0, 적요: '',
  사방넷주문번호: '', 보내는분: '', 보내는분전화: '', 보내는주소: '', 라인ID: 'l', 고유ID: 'g',
  주문번호출처: '', route: 'r', 보류사유: '', 원본코드: '', 주문수량: 1, 소요량: 1,
  조건ID: '', 합포장그룹: '', 합포장대표: false, 배송비산출: '', 부족수량: 0 };
chk(C.ssOutRow(u).length === C.SS_OUT_HEADER.length, 'SS_OUT_HEADER', C.ssOutRow(u).length + ' vs ' + C.SS_OUT_HEADER.length);
chk(C.ssHoldRow(u).length === C.SS_HOLD_HEADER.length, 'SS_HOLD_HEADER', C.ssHoldRow(u).length + ' vs ' + C.SS_HOLD_HEADER.length);
chk(C.ssPartnerRow(u).length === C.SS_PARTNER_HEADER.length, 'SS_PARTNER_HEADER', C.ssPartnerRow(u).length + ' vs ' + C.SS_PARTNER_HEADER.length);
chk(C.ssMergedRow(u).length === C.SS_MERGED_HEADER.length, 'SS_MERGED_HEADER', C.ssMergedRow(u).length + ' vs ' + C.SS_MERGED_HEADER.length);
chk(C.ssIslandRow(u).length === C.SS_ISLAND_HEADER.length, 'SS_ISLAND_HEADER', C.ssIslandRow(u).length + ' vs ' + C.SS_ISLAND_HEADER.length);
chk(C.ssLedgerRow(u, 'k', 'at').length === C.SS_LEDGER_HEADER.length, 'SS_LEDGER_HEADER', C.ssLedgerRow(u, 'k', 'at').length + ' vs ' + C.SS_LEDGER_HEADER.length);

console.log('\n[3] 설정 키 — 기본값 / 설정탭 / 실행 매핑 일치');
const cfgTab = [...src['gasIO.js'].matchAll(/\['([가-힣_A-Za-z0-9]+)',\s*'[^']*',\s*'/g)].map((m) => m[1]);
const mapped = [...src['gasMain.js'].matchAll(/([가-힣_A-Za-z0-9]+):\s*cfgRaw\[/g)].map((m) => m[1]);
for (const k of mapped) chk(C.SS_DEFAULT_CONFIG[k] !== undefined, '기본값에 ' + k);
for (const k of Object.keys(C.SS_DEFAULT_CONFIG)) chk(cfgTab.includes(k), '설정탭에 ' + k);

console.log('\n[4] 중복점검이 찾는 원장 열이 있나');
for (const k of ['회차키', '고유ID', '원본품목코드', '품목명', '경로', '거래처명', '전화', '모바일', '주소1', '수량', '합계']) {
  chk(C.SS_LEDGER_HEADER.includes(k), '원장 열 ' + k);
}

console.log('\n[5] 정규식 이스케이프 손상 흔적');
const marks = [String.raw`\s+`, String.raw`\d`, String.raw`[^0-9]`];
chk(src['core.js'].includes(marks[0]), 'core.js 에 \s+ 보존');
const suspicious = [...all.matchAll(/replace\(\/[a-z]\+\/g/g)].map((m) => m[0]);
chk(suspicious.length === 0, '백슬래시 유실 의심 패턴 없음', suspicious.join(' '));

console.log('\n[6] core.js 는 런타임에서 자유로운가 (Vercel/Supabase 이식성)');
{
  const banned = ['SpreadsheetApp', 'UrlFetchApp', 'PropertiesService', 'ScriptApp',
    'LockService', 'CacheService', 'Session.', 'Logger.', 'Utilities.'];
  const hit = banned.filter((b) => src['core.js'].includes(b));
  chk(hit.length === 0, 'core.js 에 GAS API 없음', hit.join(', '));
  const noGuard = src['core.js'].split('typeof module').join('');
  chk(noGuard.indexOf('require(') < 0, 'core.js 에 require 없음');
  chk(noGuard.indexOf('\nimport ') < 0, 'core.js 에 import 없음');
}

console.log('\n[7] 탭 이름 상수 중복');
const tabs = [...src['gasIO.js'].matchAll(/^\s{2}([가-힣A-Za-z0-9]+):\s*'([^']+)'/gm)].map((m) => m[2]);
const dupTab = tabs.filter((t, i) => tabs.indexOf(t) !== i);
chk(dupTab.length === 0, '탭 이름 중복 없음', dupTab.join(', '));

console.log('\n' + (bad ? '문제 ' + bad + '건' : '이상 없음'));
process.exit(bad ? 1 : 0);
