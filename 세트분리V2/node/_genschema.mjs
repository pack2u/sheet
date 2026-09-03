/**
 * 지금 시트 헤더에서 Supabase 스키마를 뽑는다.
 * 손으로 옮겨 적으면 반드시 어긋나므로 코드에서 생성한다.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

const MAP = {
  '회차키': ['run_key', 'text'], '라인ID': ['line_id', 'text'], '고유ID': ['order_uid', 'text'],
  '주문번호출처': ['uid_source', 'text'], '실행시각': ['ran_at', 'timestamptz'], '경로': ['route', 'text'],
  '보류사유': ['hold_reason', 'text'], '출고지': ['origin', 'text'], '순번': ['seq', 'text'],
  '일자-No.': ['slip_no', 'text'], '원본품목코드': ['src_item_code', 'text'], '품목코드': ['item_code', 'text'],
  '품목명': ['item_name', 'text'], '출력품목명': ['print_name', 'text'], '택배박스수량': ['box_qty', 'numeric'],
  '주문수량': ['order_qty', 'numeric'], '소요량': ['bom_qty', 'numeric'], '수량': ['qty', 'numeric'],
  '조건ID': ['merge_cond', 'text'], '합포장그룹': ['merge_group', 'text'], '합포장대표': ['merge_lead', 'boolean'],
  '배송비': ['ship_fee', 'numeric'], '배송비산출': ['ship_fee_calc', 'text'], '부족수량': ['short_qty', 'numeric'],
  '도서권역': ['island_zone', 'text'], '우편번호': ['zipcode', 'text'], '도서판정': ['island_by', 'text'],
  '주소변경': ['addr_override', 'text'], '원받는분': ['orig_recipient', 'text'], '원주소': ['orig_addr', 'text'],
  '원연락처': ['orig_phone', 'text'], '거래처명': ['recipient', 'text'], '전화': ['phone', 'text'],
  '모바일': ['mobile', 'text'], '주소1': ['addr', 'text'], '배송메시지': ['ship_memo', 'text'],
  '합계': ['amount', 'numeric'], '적요': ['note', 'text'], '사방넷주문번호': ['order_no', 'text'],
  '보내는분': ['sender', 'text'], '보내는분전화': ['sender_phone', 'text']
};

const miss = C.SS_LEDGER_HEADER.filter((h) => !MAP[h]);
if (miss.length) { console.error('매핑 없는 열: ' + miss.join(', ')); process.exit(1); }

const cols = C.SS_LEDGER_HEADER.map((h) => {
  const [n, t] = MAP[h];
  return `  ${(n + ' ' + t + ',').padEnd(34)}-- ${h}`;
}).join("\n");

const sql = `-- 세트분리 V2 · Supabase 스키마
-- 이 파일은 node/_genschema.mjs 가 시트 헤더에서 생성한다. 직접 고치지 말 것.
-- 생성 기준 core.js ${C.SS_VERSION}
--
-- 원장(order_lines)이 중심이다. 시트의 「주문라인원장」과 열이 1:1로 대응한다.
-- 회차키 + 라인ID 가 자연키다 — 같은 회차를 다시 계산하면 그 회차 행만 교체한다.

create table if not exists runs (
  run_key      text primary key,      -- 260902-1
  fingerprint  text not null,         -- 판매현황 지문. 같으면 같은 회차다
  run_date     date not null,
  round_no     int  not null,
  input_rows   int,
  first_run_at timestamptz default now(),
  last_run_at  timestamptz default now(),
  run_count    int  default 1
);

create table if not exists order_lines (
${cols}
  invoice_no       text,        -- 롯데 운송장번호 (송장 회수 시 채움)
  invoice_at       timestamptz,
  primary key (run_key, line_id)
);

create index if not exists order_lines_uid   on order_lines (order_uid);
create index if not exists order_lines_route on order_lines (route);
create index if not exists order_lines_date  on order_lines (ran_at);
create index if not exists order_lines_group on order_lines (merge_group);

-- 사람이 보류를 되살린 기록
create table if not exists manual_actions (
  id           bigserial primary key,
  acted_on     date not null,
  order_uid    text not null,
  src_item_code text not null,
  action       text not null check (action in ('발송','대리발송')),
  vendor_code  text,
  memo         text,
  run_key      text,
  created_at   timestamptz default now(),
  applied_run  text,
  unique (acted_on, order_uid, src_item_code)
);

-- 주소 → 우편번호 영구 캐시 (카카오 조회 결과)
create table if not exists addr_zip (
  addr       text primary key,
  zipcode    text,
  zone       text,             -- 제주 / 도서
  confirmed  date,
  memo       text
);

-- 마스터
create table if not exists items (
  item_code text primary key, item_name text, status text, origin text,
  unit_fee numeric, fee_rule_raw text, updated_at timestamptz default now()
);
create table if not exists stock (
  item_code text primary key, qty numeric, updated_at timestamptz default now()
);
create table if not exists bom (
  set_code text, set_name text, part_code text, part_qty numeric,
  primary key (set_code, part_code)
);
create table if not exists fee_rules (
  item_code text, qty int, fee numeric, full_box boolean, src text,
  primary key (item_code, qty)
);
create table if not exists merge_conditions (
  cond_id text, item_code text, primary key (cond_id, item_code)
);
create table if not exists split_exceptions (item_code text primary key, reason text);
create table if not exists vendors (vendor_code text primary key, vendor_name text);
create table if not exists island_zips (zipcode text primary key, zone text);
create table if not exists island_keywords (
  keyword text primary key, zone text, confirmed boolean default false
);

-- 실행마다 남는 경고
create table if not exists run_warnings (
  id bigserial primary key,
  run_key text references runs(run_key) on delete cascade,
  level text, code text, target text, message text,
  created_at timestamptz default now()
);
`;
writeFileSync('supabase_schema.sql', sql);
console.log('supabase_schema.sql 생성 · order_lines ' + C.SS_LEDGER_HEADER.length + '열');
