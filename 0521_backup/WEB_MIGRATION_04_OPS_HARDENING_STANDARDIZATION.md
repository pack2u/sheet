# Pack2U 운영 표준화(메타/로그/에러코드) 적용 계획

## 1. 목적
- 현재 시트 자동화에서 분산된 메타/알림 문자열을 웹 이관 가능한 표준 이벤트 체계로 정리한다.
- 장애 원인 파악 시간(MTTR)을 줄이고 자동 리포팅 기반을 만든다.

## 2. 메타 표준 스펙

## 2.1 배포시트 메타
- `AA1`: 업체명 표시값
- `AB1`: `CUST_CD` (식별 기준)
- `AC1`: 배포시트 파일 ID
- `AD1`: 시트 스키마 버전
- `AE1`: 배포 타입(`standard|consumer`)
- `AF1`: 소비자 할인율(5/8/10)
- `AG1`: 공지 스크립트 설치 마크

## 2.2 월마감 메타
- `AZ1`: `ARCHIVE_MONTH:YYYY-MM`
- 탭명 변경 여부와 무관하게 월탭 식별에 사용

## 2.3 운영 커서/성능 메타 (ScriptProperties)
- `VENDOR_UPDATE_CURSOR_INDEX`
- `VENDOR_UPDATE_AVG_MS_PER_FILE`
- 구현됨: `VENDOR_UPDATE_LAST_SUCCESS_AT`, `VENDOR_UPDATE_LAST_ERROR_AT`, `VENDOR_UPDATE_LAST_ERROR_CODE` (배포 시트 순차 업데이트)
- 구현됨: `ARCHIVE_LAST_SUCCESS_AT`, `ARCHIVE_LAST_ERROR_AT`, `ARCHIVE_LAST_ERROR_CODE` (월마감 이동·당월 빈 탭 배치)

## 3. 로그 표준

## 3.1 실행 로그 시트
- 시트명: `업데이트실행로그`
- 필드:
  - 실행시각, 실행모드, runLimit, 대상탐색, 업데이트성공, 일반, 소비자, 구버전메타, 메타갱신, DC율보정, CUST_CD동기화, 이어처리필요, 오류건수, **에러코드**, 메시지
- 시트명: `자동화실행로그` (월마감 아카이브·당월 빈 탭 등 허브 로컬 배치)
- 필드: 실행시각, 작업유형, 성공, 에러코드, 메시지

## 3.2 이벤트 로그 규격(웹 이관용 JSON)
- `event_code`
- `severity` (`INFO|WARN|ERROR|FATAL`)
- `entity_type` (`vendor|order|invoice|settlement|upload`)
- `entity_key` (`cust_cd`, `order_line_uuid` 등)
- `source` (`sheet|script|web`)
- `message`
- `context_json`
- `occurred_at`

## 4. 에러코드 체계 (권장)
- 매핑/식별
  - `MAP_MISSING_CUSTCD`
  - `MAP_FILEID_CONFLICT`
  - `MAP_VENDOR_AMBIGUOUS`
- 동기화/브리지
  - `BRIDGE_CURSOR_INVALID`
  - `BRIDGE_CONFLICT_DETECTED`
  - `BRIDGE_WRITEBACK_FAIL`
- 업로드
  - `UPLOAD_VALIDATION_FAIL`
  - `UPLOAD_RETRY_EXCEEDED`
  - `UPLOAD_IDEMPOTENCY_CONFLICT`
- 월마감
  - `ARCHIVE_MONTH_TAB_MISSING`
  - `ARCHIVE_MONTH_KEY_CONFLICT`
  - `ARCHIVE_LAYOUT_INVALID`
- 시트/권한
  - `SHEET_ACCESS_DENIED`
  - `SHEET_QUOTA_EXCEEDED`
  - `SCRIPT_TRIGGER_DUPLICATED`

## 5. 적용 순서
1. 신규 코드부터 문자열 알림에 `event_code` 병기
2. 핵심 함수(`updateAllVendorSheets`, `archivePastOrders`, 업로드 함수)에 코드 적용
3. 에러코드-운영조치 매핑표 작성
4. 주간 리포트에 코드별 건수 자동 집계

## 6. 운영 조치 매트릭스(요약)
- `MAP_*`: 매핑 시트 확인 후 6단계/6-1 재실행
- `BRIDGE_*`: 커서 리셋/재동기화/충돌 큐 처리
- `UPLOAD_*`: 재시도 큐/수동 재전송/원천 데이터 검증
- `ARCHIVE_*`: 5-1 보정/5-2 생성/메타키 재기록

## 7. 완료 조건
- 핵심 배치 함수 80% 이상이 표준 에러코드 출력
- 실행 로그 시트 2주치 누락 없이 적재
- 코드별 대응 절차 문서화 완료(SOP 반영)
