# Pack2U 웹 전환 데이터 모델/키 정책 명세

## 1. 목적
- Google Sheets 기반 데이터를 웹 DB로 이관할 때, 식별자 충돌/중복 업로드/업체명 변경 이슈를 방지한다.
- 운영 기준 키를 `CUST_CD` 중심으로 통일하고, 파일/행 단위 추적키를 별도로 둔다.

## 2. 식별자 정책 (우선순위)
- **L1 (회계/거래 기준): `CUST_CD`**
  - 거래처 식별의 기준값.
  - 업체명은 변경 가능 표시값이며 식별키로 사용하지 않는다.
- **L2 (배포 채널 기준): `deployment_file_id`**
  - Google 배포시트 파일 ID.
  - 동일 업체라도 채널 분리 시 파일 ID로 분리 추적한다.
- **L3 (행 단위 기준): `order_line_uuid`**
  - 웹 시스템 생성 UUID.
  - 외부 업로드/재시도/정산 로그의 멱등 기준.
- **Legacy 호환키: `legacy_unique_id`**
  - 기존 시트의 `고유ID` 보존 필드.
  - 이전 데이터 역추적 및 일회성 마이그레이션 검증에 사용.

## 3. 핵심 엔터티

### 3.1 vendors (업체 마스터)
- `id` (UUID, PK)
- `cust_cd` (varchar, unique, not null)
- `display_name` (varchar, not null)
- `status` (active/inactive)
- `created_at`, `updated_at`

### 3.2 vendor_channels (배포 채널)
- `id` (UUID, PK)
- `vendor_id` (FK -> vendors.id)
- `channel_type` (standard/consumer)
- `deployment_file_id` (varchar, unique, nullable)
- `consumer_dc_rate` (int, nullable, allowed: 5/8/10)
- `sheet_schema_version` (varchar)
- `created_at`, `updated_at`

### 3.3 products (상품)
- `id` (UUID, PK)
- `item_code` (varchar, unique, not null)
- `item_name` (varchar, not null)
- `status` (정상/품절/단종/재고제한 등)
- `default_location` (varchar, nullable)
- `consumer_price` (numeric)
- `created_at`, `updated_at`

### 3.4 price_snapshots (단가 스냅샷)
- `id` (UUID, PK)
- `product_id` (FK -> products.id)
- `price_group` (varchar)
- `price_value` (numeric)
- `effective_at` (timestamp)
- `source_version` (varchar)

### 3.5 orders (주문 헤더)
- `id` (UUID, PK)
- `vendor_id` (FK -> vendors.id)
- `vendor_channel_id` (FK -> vendor_channels.id)
- `order_date` (date)
- `recipient_name`, `recipient_phone`, `recipient_addr`, `shipping_message`
- `created_at`, `updated_at`

### 3.6 order_lines (주문 라인)
- `id` (UUID, PK)
- `order_id` (FK -> orders.id)
- `order_line_uuid` (UUID, unique, not null)
- `legacy_unique_id` (varchar, nullable, indexed)
- `item_code` (varchar, indexed)
- `qty` (int)
- `unit_price_snapshot` (numeric)
- `line_status` (enum: 접수대기/발송완료/취소/품절/재고부족대기/기타)
- `invoice_no` (varchar, nullable)
- `invoice_carrier` (varchar, nullable)
- `is_cancelled` (bool)
- `is_returned` (bool)
- `created_at`, `updated_at`

### 3.7 upload_jobs / upload_results (이카운트 업로드)
- 업로드 요청/응답/실패코드/재시도 횟수/처리시간 기록
- 멱등 기준: `order_line_uuid` + `target_system` + `upload_type`

### 3.8 settlement_monthly (월정산)
- `id` (UUID, PK)
- `vendor_id`
- `year_month` (char(7), `YYYY-MM`)
- `gross_amount`, `net_amount`, `cancel_count`, `return_count`
- `snapshot_created_at`

### 3.9 audit_events (감사로그)
- `id` (UUID, PK)
- `entity_type`, `entity_id`
- `action` (create/update/delete/state_transition)
- `actor_type` (user/system/script)
- `before_json`, `after_json`
- `occurred_at`

## 4. 제약/인덱스 규칙
- unique:
  - `vendors.cust_cd`
  - `vendor_channels.deployment_file_id` (null 허용, null 제외 unique)
  - `order_lines.order_line_uuid`
- index:
  - `order_lines.legacy_unique_id`
  - `order_lines.item_code`
  - `orders.order_date`
  - `upload_results.error_code`

## 5. 동기화 키 매핑 (시트 -> 웹)
- 업체 매핑 시트(`업체등급단가매핑`) 기준:
  - `거래처명` -> `vendors.display_name`
  - `거래처코드(CUST_CD)` -> `vendors.cust_cd`
  - `배포시트ID` -> `vendor_channels.deployment_file_id`
- 배포시트 메타 기준:
  - `AA1` 업체명, `AB1` CUST_CD, `AC1` fileId, `AD~AG` 스키마/타입/DC

## 6. 충돌 처리 원칙
- 이름 충돌: 동일 업체명 다건 존재 시 **CUST_CD 우선**
- 코드 미입력: `MAP_MISSING_CUSTCD`로 차단, 웹 반영 금지
- fileId 충돌: 동일 `deployment_file_id`가 다른 `CUST_CD`와 매핑되면 `MAP_FILEID_CONFLICT`

## 7. 마이그레이션 최소 절차
1. 업체 매핑 시트에서 `CUST_CD` 누락 제거
2. 배포시트 메타(`AB1`, `AC1`) 최신화
3. 주문/업로드 로그 백필(legacy id 포함)
4. 웹 DB 적재 후 diff 검증 (건수/합계/상태)
5. 병행 운영 시작
