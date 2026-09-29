# 이카운트 일반전표 API — 규격 원문 정리

> 2026-09-29 이카운트 API 매뉴얼(로그인 필요) 「회계API → 일반전표」 에서 옮김.
> 입금확인 4단계(이카운트 반영)가 이것을 쓴다 — `dpMatch.gs` `dpBuildJournal` · `dpEcount.gs`.

## 요청

| 항목 | 값 |
|---|---|
| 호출 | POST · `application/json` |
| 테스트 | `https://sboapi{ZONE}.ecount.com/OAPI/V2/GeneralJournal/SaveGeneralJournal?SESSION_ID={SESSION_ID}` |
| 운영 | `https://oapi{ZONE}.ecount.com/OAPI/V2/GeneralJournal/SaveGeneralJournal?SESSION_ID={SESSION_ID}` |

★ 매뉴얼 경고: «ERP 입력화면 양식에 추가된 항목만 입력된다. 양식필수 항목은 회사코드별로 다르다.»
→ 실제로 한 건 넣어 보고 거래처원장에 어떻게 잡히는지 확인한 뒤에 켠다.

`{"GeneralJournalList":[{"BulkDatas":{…}}, …]}` — BulkDatas 한 줄 = 전표의 한 줄(계정 하나).
**같은 `UPLOAD_SER_NO` 끼리 한 장의 전표**가 된다.

| 변수 | 이름 | 자릿수 | 필수 | 설명 |
|---|---|---|---|---|
| UPLOAD_SER_NO | 순번 | SMALLINT(4) | Y | 같은 전표로 묶을 줄은 같은 번호 |
| TRX_DATE | 일자 | STRING(8) | | YYYYMMDD. 없으면 오늘 |
| ACCT_DOC_NO | 회계전표No. | STRING(30) | | |
| SLIP_GUBUN | 구분 | STRING(1) | | 출금 1 · 입금 2 · **차변 3 · 대변 4** |
| SITE | 부서 | STRING(50) | | 코드 또는 이름 |
| PJT_CD | 프로젝트 | STRING(50) | | |
| GYE_CODE | 계정코드 | STRING(100) | Y | 코드(최대 8자) 또는 이름 |
| CUST_D | 거래처코드 | STRING(30) | | 코드만 주면 이름 자동 |
| CUST_NAME | 거래처명 | STRING(100) | | 이름만 주면 일치하는 거래처 코드 자동 |
| DR_AMT | 금액 | NUMERIC(15,2) | | 대차구분에 따라 차변/대변에 들어간다 |
| TAX_AMT | 외화금액 | NUMERIC(15,2) | | |
| ACC101_EXCHANGE_RATE | 환율 | NUMERIC(14,4) | | |
| REMARKS_CD | 적요코드 | STRING(2) | | |
| REMARKS_DES | 적요 | STRING(200) | | |
| ITEM1_CD ~ ITEM3_CD | 추가항목(코드형) | STRING(30) | | |
| ITEM4 ~ ITEM5 | 추가항목(문자형) | STRING(100) | | |
| ITEM6 ~ ITEM7 | 추가항목(숫자형) | STRING(16) | | |
| ITEM8 | 추가항목(일자형) | STRING(8) | | YYYYMMDD |

## 응답

| 변수 | 설명 |
|---|---|
| Status | "200" 정상 |
| Error / Errors | 오류 (Code · Message · MessageDetail) |
| Data.SuccessCnt / FailCnt | 성공·실패 건수 (전표 단위) |
| Data.ResultDetails | `[{IsSuccess, TotalError:"[전표묶음0] OK", Errors:[{ColCd, Message}]}]` |
| Data.SlipNos | 만들어진 일반전표 번호 `["20210627-3", …]` (실패면 빈 배열) |
| Data.QUANTITY_INFO | 시간당 연속 오류 30 · 1시간 30,000 · 1일 100,000 |
| Data.TRACE_ID | 오류 추적 번호 |

실패 예: `ResultDetails: [{IsSuccess:false, TotalError:"거래처", Errors:[{ColCd:"CUST_D", Message:"거래처"}]}]`, `SlipNos: []`

## 입금확인에서 넣는 모양

입금 1건 = 전표 1장 (같은 UPLOAD_SER_NO 두 줄)

| 줄 | SLIP_GUBUN | GYE_CODE | CUST_D | DR_AMT | REMARKS_DES |
|---|---|---|---|---|---|
| 1 | 3 차변 | 보통예금(IBK 입금 통장) | | 입금액 | `입금 {입금자} · {주문번호} · DP{고유번호 지문}` |
| 2 | 4 대변 | 외상매출금 | 거래처코드 | 입금액 | 같음 |

- 「입금(2)」 구분은 상대 계정이 현금으로 잡혀 쓰지 않는다 — 돈은 통장으로 들어왔다.
- 적요의 `DP…` 지문으로 이카운트에서 어느 입금에서 온 전표인지 찾는다 (중복 확인용).
