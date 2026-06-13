# Pack2U 시트-웹 브리지 설계

## 1. 목표
- 병행 운영 기간(3~6개월) 동안 시트와 웹 간 데이터 정합성을 유지한다.
- 시트 편집/자동화 결과를 웹으로 수집하고, 웹 확정 상태를 시트에 역반영한다.

## 2. 동기화 방향

## 2.1 Inbound (시트 -> 웹)
- 대상:
  - 배포시트 `발주 및 송장조회`의 주문/상태/송장
  - `통합 발주 DB` 집계 데이터
  - `업체등급단가매핑` 마스터
- 방식:
  - 주기성 Pull(5~10분) + 변경해시 기반 증분 적재
  - 기존 Apps Script 트리거 결과를 이벤트 로그 시트에 함께 기록

## 2.2 Outbound (웹 -> 시트)
- 대상:
  - 상태 확정(취소/반품/송장확정)
  - 월마감 키/요약/보정 메타
  - 업체코드(CUST_CD) 및 매핑 정정
- 방식:
  - 웹 큐 기반 Push 작업
  - 실패 시 재시도(지수 백오프)

## 3. 권위(SoT) 규칙
- 단가/상품: 초기에는 시트 허브가 권위, 이후 웹 권위 전환
- 업체코드(CUST_CD): 항상 매핑 마스터가 권위
- 주문 상태:
  - 병행 초반: 시트 변경 우선 수용
  - 병행 후반: 웹 승인 상태 우선, 시트는 반영 채널

## 4. 충돌 규칙
- 동일 주문 라인에서 양쪽 수정 발생 시:
  1. `order_line_uuid` 동일 여부 확인
  2. `updated_at` 비교
  3. 상태 전이 우선순위 적용
     - 취소/반품 확정 > 발송완료 > 접수대기
- 충돌 발생 시 `BRIDGE_CONFLICT_DETECTED` 이벤트 생성 및 운영자 큐 적재

## 5. 증분 동기화 키
- 업체: `cust_cd`, `deployment_file_id`
- 주문: `legacy_unique_id` + `order_line_uuid`
- 월마감: `month_key (ARCHIVE_MONTH:YYYY-MM)` + 업체 키

## 6. 브리지 테이블(권장)
- `bridge_sync_cursor`
  - `source_type` (sheet/web)
  - `scope` (vendor/orders/invoice/settlement)
  - `cursor_value` (row/version/hash/time)
  - `updated_at`
- `bridge_sync_events`
  - `event_id`, `event_type`, `entity_key`, `payload_json`, `status`, `retry_count`, `created_at`
- `bridge_conflict_queue`
  - `entity_key`, `sheet_value`, `web_value`, `rule_applied`, `resolved_by`, `resolved_at`

## 7. 운영 흐름
1. `업체등급단가매핑` 동기화
2. 배포시트 주문 증분 수집
3. 웹 검증/정규화
4. 업로드/송장/정산 처리
5. 결과를 시트 역반영
6. diff 리포트 생성

## 8. 장애/복구 전략
- 장애 유형:
  - 권한 오류(IMPORTRANGE/Apps Script)
  - 쿼터 초과
  - 파일 접근 실패
- 복구:
  - 재시도 큐 + 데드레터 큐
  - `source snapshot` 보존 후 재처리
  - 복구 모드에서 읽기만 수행 후 쓰기 재개

## 9. 단계별 전환 스위치
- `bridge.read_enabled`
- `bridge.write_enabled`
- `bridge.web_wins_status`
- `bridge.block_on_missing_custcd`

## 10. 초기 구현 체크리스트
- [ ] 시트 파서 모듈(업체/주문/송장/월마감)
- [ ] 브리지 이벤트 스키마
- [ ] 충돌 규칙 엔진
- [ ] 재시도/데드레터 큐
- [ ] 일일 diff 리포트(건수, 금액, 상태)
