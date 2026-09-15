-- 세트분리 V2 · Supabase 스키마
-- 이 파일은 node/_genschema.mjs 가 시트 헤더에서 생성한다. 직접 고치지 말 것.
-- 생성 기준 core.js 2.0.0
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
  run_key text,                     -- 회차키
  line_id text,                     -- 라인ID
  order_uid text,                   -- 고유ID
  uid_source text,                  -- 주문번호출처
  ran_at timestamptz,               -- 실행시각
  route text,                       -- 경로
  hold_reason text,                 -- 보류사유
  origin text,                      -- 출고지
  seq text,                         -- 순번
  slip_no text,                     -- 일자-No.
  src_item_code text,               -- 원본품목코드
  item_code text,                   -- 품목코드
  item_name text,                   -- 품목명
  print_name text,                  -- 출력품목명
  box_qty numeric,                  -- 택배박스수량
  order_qty numeric,                -- 주문수량
  bom_qty numeric,                  -- 소요량
  qty numeric,                      -- 수량
  merge_cond text,                  -- 조건ID
  merge_group text,                 -- 합포장그룹
  merge_lead boolean,               -- 합포장대표
  ship_fee numeric,                 -- 배송비
  ship_fee_calc text,               -- 배송비산출
  short_qty numeric,                -- 부족수량
  island_zone text,                 -- 도서권역
  zipcode text,                     -- 우편번호
  island_by text,                   -- 도서판정
  addr_override text,               -- 주소변경
  orig_recipient text,              -- 원받는분
  orig_addr text,                   -- 원주소
  orig_phone text,                  -- 원연락처
  recipient text,                   -- 거래처명
  phone text,                       -- 전화
  mobile text,                      -- 모바일
  addr text,                        -- 주소1
  ship_memo text,                   -- 배송메시지
  amount numeric,                   -- 합계
  note text,                        -- 적요
  order_no text,                    -- 사방넷주문번호
  sender text,                      -- 보내는분
  sender_phone text,                -- 보내는분전화
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
