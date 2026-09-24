# 로젠택배 OPEN API 연동 레퍼런스 (전체)

> 출처: https://openapihome.ilogen.com — LOGEN API Developers
> API Docs 전 문서(19종) 원문 기준 정리 · 조사일 2026-09-15

---

## 1. 기본 규격

| 항목 | 내용 |
|---|---|
| 방식 | RESTful, HTTPS 전 구간 |
| 포맷 | JSON (요청/응답 모두 `JSONObject`) |
| 메서드 | GET/POST 지원. **업무 API는 전부 POST**, GET은 송장출력 팝업뿐 |
| 개발계 | `https://topenapi.ilogen.com` |
| 운영계 | `https://openapi.ilogen.com` |
| 공통 경로 | `/lrm02b-edi/edi/{apiName}` |

### 헤더

```
secretKey: {발급받은 인증키}
Content-Type: application/json
```

### 인증

1. **호출자 IP 검증** — 사전 등록된 IP만 허용
2. **인증키 검증** — 유효기간 최대 2년

실패 시 `401 Unauthorized`.

- 발급 경로: `이용안내 > 신청등록/현황, 인증키발급/현황`
- **상위 거래처 기준**으로만 발급
- **최대 3개** — 개수 제한이 아니라 **유효기간 내 무중단 교체(로테이션)용 슬롯**
  → `secretKey`는 환경변수로 분리 + **만료 알림 필수**.
  2년 뒤 조용히 401 나면서 출고가 멈추는 게 가장 흔한 사고
- ⚠️ IP 화이트리스트이므로 **고정 IP(NAT Gateway) 필수**. 서버리스/동적 IP면 프록시 필요

### 이용 절차

1. 화주사 회원가입 → **시스템연동신청서** 제출
2. `API 신청 정보 등록` + **TEST Key** 발급
3. 개발계에서 개발·테스트
4. **Live Key** 신청 → 본사 정보전략팀이 서버 IP 방화벽 허용 + 검수 → 오픈 승인

소요: 계약지점 회신 1~2일(이메일). 문의: webmaster@ilogen.com

---

## 2. 공통 식별자 · 응답 규약

### 식별자

| 값 | 길이 | 설명 |
|---|---|---|
| `userId` | 8 | **연동업체코드**. ⚠️ **연동업체코드가 아닌 경우 거래처코드를 입력** |
| `custCd` | 8 | **거래처코드**(화주사). 계약·운임이 여기 붙음 |

테스트값: `userId=10358007`, `custCd=20179999`

### 공통 응답

```json
{
  "sttsCd": "SUCCESS",
  "sttsMsg": "총2건 - 처리결과 : 2건 처리 중 1건 성공",
  "data": [ { "...": "...", "resultCd": "TRUE", "resultMsg": null } ]
}
```

- `sttsCd`: `SUCCESS` / `PARTIAL SUCCESS` / `FAIL`
- **건별 성패는 `resultCd`로 판단.** `sttsCd`만 보면 부분 실패를 통째로 놓침 ← 최대 버그 포인트

### ⚠️ `resultCd` 규약이 API마다 다름

공통 파서를 하나로 짜면 깨지는 지점.

| 성공값 | 해당 API |
|---|---|
| `TRUE` / `FALSE` | `contractTotalInfo`, `registerOrderData`, `inquirySlipNoMulti`, 화물추적 2종, 반품 전 API, `custExtraFare`, `getSlipNo`, `getVtelNoSaveM`, `slipPrintM` |
| **`SUCCESS` / `FAIL`** | **`contPickFares`, `contRtnFares`** |
| **`SUCCESS` / `FALSE`** (문서 표기 그대로) | **`integratedInquiry`** ← 2026.03.19 "오기입 수정" 이력 있음에도 여전히 혼재 |

성공 시 `resultMsg`도 `null`인 API와 `""`인 API가 섞여 있음.

> **권장 파서**: `resultCd`를 `TRUE`/`SUCCESS` 양쪽 다 성공으로 인정하고,
> 빈값 판정은 `null`과 `""`를 함께 처리.

### 응답 중첩 패턴

`data[]` = 요청 키 단위, `data1[]` = 그 키에 딸린 결과 목록.

| API | `data[]` | `data1[]` |
|---|---|---|
| `inquiryCargoTrackingMulti` | 운송장번호 | 스캔 이력 |
| `contPickFares` / `contRtnFares` | 거래처·운임타입 | 박스타입별 운임 |
| `inquirySlipNoMulti` | 주문번호 | 운송장번호 |
| `inquiryReturnStateMulti` | 원운송장번호 | 반품 접수건 |
| `getSlipNo` | 채번 범위 | 운송장번호 |

⚠️ `data1[]`이 **배열**인 곳에서 단일값으로 받으면 누락 발생(다박스·재출력 등).

---

## 3. API 전체 목록 (19종)

### 거래처 계약
| API | Endpoint |
|---|---|
| 거래처 계약정보 통합조회 | `contractTotalInfo` |
| 운임구분별 계약운임 조회 | `contPickFares` |

### 자체 시스템 송장출력
| API | Endpoint |
|---|---|
| 송장번호 채번 | `getSlipNo` |
| 전화번호 안심번호 제공 | `getVtelNoSaveM` |
| 송장 출력정보 통합조회 | `integratedInquiry` |
| 송장 출력 주문 정보 등록 | `slipPrintM` |

### iLOGEN 주문등록
| API | Endpoint |
|---|---|
| 주문 정보 일괄 등록 | `registerOrderData` |
| 출력 송장번호 조회 | `inquirySlipNoMulti` |
| 로젠 외부 운송장 출력 팝업 | `outSlipPrintPop` (GET) |

### 반품
| API | Endpoint |
|---|---|
| 반품 접수 등록 | `registReturnRequest` |
| 반품 집하지점 및 운임 조회 | `reverseChkInfoMulti` |
| 반품 계약 운임 조회 | `contRtnFares` |
| 반품 요청 상태·송장번호 조회 (접수번호) | `inquiryReserveStateMulti` |
| 반품 요청 상태·송장번호 조회 (주문번호) | `inquiryReserveStateFixTakeNo` |
| 반품접수 정보 조회 (원송장번호) | `inquiryReturnStateMulti` |
| 반품 취소 등록 | `cancelReserveState` |

### 화물추적
| API | Endpoint |
|---|---|
| 화물추적 조회(전체 이력) | `inquiryCargoTrackingMulti` |
| 최종 화물추적 조회 | `inquiryCargoTrackingMultiLast` |

### 기타
| API | Endpoint |
|---|---|
| 물품금액에 따른 할증운임 조회 | `custExtraFare` |

---

## 4. 출고 경로 두 가지 (설계 결정)

### 경로 A — iLOGEN 주문등록 (로젠 팝업 출력)

```
registerOrderData  →  outSlipPrintPop (사람이 팝업에서 출력)  →  inquirySlipNoMulti (폴링으로 송장번호 회수)
```

- 구현 간단. 라벨 디자인·프린터 신경 안 써도 됨
- ⚠️ **팝업이 접수일자(`takeDt`) 단위** — 특정 주문만 골라 출력하기 어려움
- ⚠️ **운송장번호가 비동기로 생김**. 등록 응답에 송장번호 없음.
  실제 출력이 일어난 뒤에야 `inquirySlipNoMulti`로 회수 가능 → 폴링 설계 필요

### 경로 B — 자체 시스템 송장출력

```
getSlipNo (번호 선점)  →  integratedInquiry (주소→지점/분류코드)  →  [custExtraFare]  →  slipPrintM (출력결과 통보)
```

- **운송장번호를 먼저 손에 쥐고 시작** → 주문-송장 매핑이 동기적으로 끝남
- 라벨 디자인·프린터 직접 제어 가능
- ⚠️ 제주/연륙도서/산간 구분과 분류코드 인쇄 로직을 직접 구현해야 함

> **판단 기준**: 운송장번호를 시스템에 자동 기록해야 하면 **B**.
> 사람이 로젠 화면에서 출력하는 운영이 이미 있으면 **A + 폴링**.

---

## 5. 경로 A 상세

### 5.1 주문 정보 일괄 등록 — `registerOrderData`

> "로젠시스템의 **주문등록출력(복수건)** 화면에서 출력하기 위한 주문데이터를 전송한다."
> (2025.08.11 최초 / **2026.01.12 `addOpt` 추가**)

```json
{
  "userId": "10358007",
  "data": [{
    "custCd": "20179999", "takeDt": "20250304",
    "slipNo": "", "fixTakeNo": "1310004628001012",
    "sndCustNm": "이순신",
    "sndCustAddr": "서울시 강남구 대치동 포스코센터 서관 10F",
    "sndTelNo": "0234150001", "sndCellNo": "01012345678",
    "rcvCustNm": "홍길도",
    "rcvCustAddr": "충남 부여군 은산면 내지리 123-1",
    "rcvTelNo": "050212345678", "rcvCellNo": "01012348765",
    "fareTy": "030", "boxTyCd": "WS001",
    "qty": 2, "dlvFare": 6000, "extraFare": 0,
    "goodsNm": "달력", "goodsAmt": 5000, "inQty": 1,
    "goodsOpt": "칼라 : 레드", "addOpt": "선물 포장", "sndMsg": "문 앞"
  }]
}
```

| 필드 | 타입/길이 | 필수 | 내용 | 비고 |
|---|---|---|---|---|
| `custCd` | S8 | Y | 거래처코드 | |
| `takeDt` | S8 | Y | 접수일자 | |
| `slipNo` | S11 | N | 운송장번호 | ⚠️ **공백으로 전송** |
| `fixTakeNo` | S100 | P | 주문번호 | **외부송장출력팝업 사용 시 필수** |
| `sndCustNm` | S50 | Y | 송하인명 | |
| `sndZipCd` | S5 | N | 송하인우편번호 | ⚠️ **영문주소일 때만 사용** |
| `sndCustAddr` | S1000 | Y | 송하인주소(전체) | 국내는 전체주소 한 덩어리 |
| `sndTelNo`/`sndCellNo` | S50 | 택1 | 송하인 연락처 | |
| `rcvCustNm` | S50 | Y | 수하인명 | |
| `rcvZipCd` | S5 | N | 수하인우편번호 | ⚠️ **영문주소일 때만** |
| `rcvCustAddr` | S1000 | Y | 수하인주소(전체) | |
| `rcvTelNo`/`rcvCellNo` | S50 | 택1 | 수하인 연락처 | 안심번호 그대로 투입 가능 |
| `fareTy` | S3 | Y | 운임타입코드 | `010`/`020`/`030`/`040` |
| `boxTyCd` | S5 | N | 박스타입코드 | `WS001`, `AS080` 등 |
| `qty` | I | Y | 수량 | |
| `dlvFare` | I7 | Y | 택배운임 | |
| `extraFare` | I7 | N | 할증운임 | `custExtraFare`로 산출 |
| `goodsNm` | S1000 | N | 물품명 | |
| `goodsAmt` | I7 | N | 물품금액 | |
| `inQty` | I3 | N | 내품수량 | |
| `goodsOpt` | S1000 | N | 물품옵션 | |
| `addOpt` | S1000 | N | 추가옵션 | 2026.01.12 추가 |
| `sndMsg` | S500 | N | 배송메세지 | |

**합포장 필드군** — ⚠️ **`#` 구분자 문자열**(배열 아님). 예: `mrgInQty: "1#1#1#1########"`

| 필드 | 길이 | 내용 |
|---|---|---|
| `mrgYn` | 1 | 합포장여부 `Y`/`N` |
| `mrgInQty` | 200 | 내품수량 |
| `mrgItemCd` | 2000 | 품목코드 |
| `mrgItemNm` | 4000 | 품목명 |
| `mrgItemOpt` | 2000 | 품목옵션 |
| `mrgGoodsAmt` | 1000 | 상품금액 |
| `mrgAddOpt` | 2000 | 추가옵션 |

> 예시의 `#` 개수가 품목 수보다 많음 → 빈 슬롯 포함 고정 길이로 추정. 개발계 검증 필요.
> **품목명에 `#`가 들어가면 깨지므로 이스케이프 필수.**

**응답** — `data[]`: `fixTakeNo`, `resultCd`(TRUE/FALSE), `resultMsg`
⚠️ **운송장번호가 없음.** → `inquirySlipNoMulti` 별도 호출 필요

### 5.2 출력 송장번호 조회 — `inquirySlipNoMulti`

> "주문등록 후 로젠시스템에서 **출력한** 송장번호를 주문번호로 조회한다."

**요청**: `userId`, `data[].custCd`(Y), `data[].fixTakeNo`(Y, S100)

**응답**
```json
{
  "sttsCd": "PARTIAL SUCCESS",
  "sttsMsg": "총2건 - 처리결과 : 2건 처리 중 1건 성공",
  "data": [{
    "fixTakeNo": "2004052720343091",
    "data1": [{ "slipNo": "", "delYn": "N" }],
    "resultCd": "FALSE",
    "resultMsg": "유효한 주문번호가 없습니다."
  }]
}
```

| 필드 | 타입/길이 | 필수 | 내용 |
|---|---|---|---|
| `data[].fixTakeNo` | S100 | Y | 주문번호 |
| `data1[].slipNo` | S11 | **N** | 운송장번호 |
| `data1[].delYn` | S1 | N | 삭제여부 `Y`/`N` |

**⚠️ 함정 3가지**

1. **타이밍 갭** — 실제 출력이 일어나야 번호가 생김. 등록 직후 호출하면 `유효한 주문번호가 없습니다.`
   (`slipNo` 필수가 `N`인 이유) → **폴링 또는 출력 이후 배치**
2. **`data1[]`이 배열** — `qty > 1` 다박스면 송장 N장
3. **`delYn = "N"` 필터 필수** — 삭제/재출력된 구 송장도 함께 내려옴

> 문서의 **정상 예시 자체가 `PARTIAL SUCCESS` + `resultCd: FALSE`** — 부분 실패가 일상적인 API

### 5.3 로젠 외부 운송장 출력 팝업 — `outSlipPrintPop` (GET)

`registerOrderData` **선행 필수**.

```
{base}/lrm02b-edi/edi/outSlipPrintPop?userId=11111111&custCd=11111111&takeDt=20250501
```

| 파라미터 | 길이 | 필수 |
|---|---|---|
| `userId` | 8 | Y |
| `custCd` | 8 | Y |
| `takeDt` | 8 | Y |

출력: `returnURL` — 팝업 화면이 생성됨.

---

## 6. 경로 B 상세

### 6.1 송장번호 채번 — `getSlipNo`

**요청**: `userId`, `data[].slipQty` (Integer, 기본 1 / **최대 9999**, 초과 시 별도 요청)

**응답**: `data.startSlipNo`, `data.closeSlipNo`, `data1[].slipNo`, `resultCd`

> ⚠️ 문서 예시가 `startSlipNo: 10000000850`, `closeSlipNo: 10000000835` 로 **시작 > 종료**.
> 오기로 보이나, 범위를 신뢰하지 말고 **`data1[].slipNo` 목록을 실제 소스로 쓸 것.**

### 6.2 송장 출력정보 통합조회 — `integratedInquiry`

> "배송지점, 도착점 코드, 제주/산간/연륙도서지역 여부, 관내배송여부 등
> **자체 시스템 송장 출력 시 필요한 정보를 통합 조회**한다." (2026.03.19 resultCd 오기입 수정)

**요청**: `userId`, `data[].custCd`(Y), `data[].addr`(Y, S1000)

**응답 `data[]`**

| 필드 | 타입/길이 | 내용 | 예시 |
|---|---|---|---|
| `branCd` | S4 | 지점코드 | `216` |
| `dongNm` | S50 | 동명 | `상도1동` |
| `classCd` | S4 | **분류코드** | `G4-216` |
| `zipCd` | S5 | 우편번호 | `06912` |
| `jejuRegYn` | S1 | 제주지역여부 | `N` |
| `shipYn` | S1 | 연륙도서여부 | `N` |
| `montYn` | S1 | 산간여부 | `N` |
| `salesNm` | S20 | 영업소명 | `상도영업소` |
| `branShareYn` | S1 | 공용지점여부 | `N` |
| `tmlNm` | S10 | 터미널명 | `원주TM` |

> ⚠️ **문서상 길이와 예시가 안 맞음**: `classCd`는 길이 4인데 예시가 `G4-216`(6자).
> 파싱 시 길이 제한을 신뢰하지 말 것.

### 6.3 송장 출력 주문 정보 등록 — `slipPrintM`

> "출력된 송장(주문) 정보를 전송한다."
> (2025.08.11 최초 / **2026.04.29 제주운임 착불 시 필수 제외 — 제주운임 정액제 시행**)

| 필드 | 타입/길이 | 필수 | 내용 | 비고 |
|---|---|---|---|---|
| `printYn` | S1 | Y | 출력여부 | **`Y` = 자체출력** |
| `slipNo` | S11 | Y | 운송장번호 | ⚠️ **재발행 시 신규 채번 필수** |
| `slipTy` | S3 | P | 주문구분 | 없으면 기본 `100` |
| `orgnSlipNo` | S11 | N | 원운송장번호 | **사용안함** |
| `custCd` | S8 | Y | 거래처코드 | |
| `sndCustNm` | S50 | Y | 송하인명 | |
| `sndTelNo`/`sndCellNo` | S50 | 택1 | 송하인 연락처 | |
| `sndZipCd` | S5 | P | 송하인우편번호 | 영문주소일 때만 |
| `sndCustAddr1` | S500 | Y | 송하인주소1 | |
| `sndCustAddr2` | S500 | **Y** | 송하인주소2 | ⚠️ 필수인데 **예시는 빈값** → 빈 문자열로 전송 |
| `rcvCustNm` | S50 | Y | 수하인명 | |
| `rcvTelNo`/`rcvCellNo` | S50 | 택1 | 수하인 연락처 | |
| `rcvZipCd` | S5 | P | 수하인우편번호 | 영문주소일 때만 |
| `rcvCustAddr1` | S500 | Y | 수하인주소1 | |
| `rcvCustAddr2` | S500 | **Y** | 수하인주소2 | ⚠️ 위와 동일 |
| `fareTy` | S3 | Y | 운임타입코드 | `010`~`040` |
| `qty` | I | Y | 수량 | **1 고정** |
| `rcvBranCd` | **S3** | Y | **배송점코드** | ⚠️ `integratedInquiry`의 `branCd`는 S4 — 길이 불일치 |
| `goodsNm` | S1000 | N | 물품명 | |
| `dlvFare` | I7 | Y | 택배운임 | |
| `extraFare` | I7 | Y | 할증운임 | 기본값 0 |
| `goodsAmt` | I7 | Y | 물품금액 | 기본값 0 |
| `jejuAmtTy` | S3 | N | 제주운임유형 | 제주지역 시 운임타입코드와 동일 |
| `jejuAmt` | I7 | N | 제주운임 | |
| `shipYn` | S1 | N | 연륙도서여부 | `Y`/`N` |
| `shipFare` | I7 | N | 연륙도서운임 | |
| `montFare` | I22 | N | 산간운임 | |
| `takeDt` | S8 | Y | 접수일자 | |
| `remarks` | S1000 | N | 비고 | |
| `fixTakeNo` | S100 | N | 주문번호 | |
| `wt` | I3 | P | 중량 | 조건부 필수 |

**응답**: `data.slipNo`, `resultCd`(TRUE/FALSE), `resultMsg`(성공 시 `""`)

> `integratedInquiry`의 `jejuRegYn`/`shipYn`/`montYn` 결과를 받아
> `jejuAmt`/`shipFare`/`montFare`를 채우는 흐름. **지역 할증 계산 책임이 호출자에게 있음.**

### 6.4 안심번호 제공 — `getVtelNoSaveM`

> "수하인 전화번호에 대해 안심번호를 제공한다."

**요청** — 2단 중첩

| 필드 | 타입/길이 | 필수 | 내용 |
|---|---|---|---|
| `userId` | S8 | Y | 연동업체코드 |
| `data.takeDt` | S8 | Y | 접수일자 |
| `data1[].slipNo` | S11 | Y | 운송장번호 |
| `data1[].telNo` | S50 | 택1 | 전화번호 |
| `data1[].cellNo` | S50 | 택1 | 휴대폰번호 |

**응답**: `data[].slipNo`, `data[].virTelNo` (S22, **`0503-1234-5678` 하이픈 포함**)

> ⚠️ 안심번호는 **운송장번호가 이미 있어야** 발급됨(`slipNo` 필수).
> → 채번 → 안심번호 → `slipPrintM` 순서. 라벨에 안심번호를 찍으려면 이 순서를 지켜야 함.
> 반환 포맷에 하이픈이 있으므로 다른 API에 넣을 때 제거 여부 검증 필요.

---

## 7. 화물추적

### 7.1 전체 이력 — `inquiryCargoTrackingMulti`

**요청**: `userId`, `data[].slipNo` (S11, 하이픈 없이 숫자만)

**응답**: `data[].slipNo` + `data1[]` 이력 배열

| 필드 | 타입/길이 | 내용 |
|---|---|---|
| `scanDt` | S8 | 스캔일자 `20240501` |
| `scanTm` | S6 | 스캔시각 `113536` |
| `statNm` | S100 | **화물상태(한글 문자열)** `배송완료` |
| `branCd`/`branNm` | S4/S20 | 지점 |
| `oppBranCd`/`oppBranNm` | S3/S20 | 상대지점 |
| `salesCd`/`salesNm` | S8/S20 | 영업소 |
| `sndBranNm` | S20 | 배송지점명 |
| `rcvBranNm` | S20 | 수하인지점명 |
| `acptorTyNm` | S100 | 인수자구분명 `현관/문앞` |

### 7.2 최종 상태만 — `inquiryCargoTrackingMultiLast`

동일 요청. 응답은 **`data1[]` 없이 `data[]`에 평탄하게** 최종 1건.
`salesCellNo`(영업소전화번호 `010-1234-5678`)가 추가로 옴 — 고객 문의 대응에 유용.

> **상태 폴링은 7.2를, 상세 이력 화면은 7.1을** 쓰는 게 맞음.

> ⚠️ **화물상태에 코드가 없음.** `statNm` 한글 문자열뿐.
> 내부 상태 매핑 시 문자열 테이블이 필요하고 로젠이 표현을 바꾸면 조용히 깨짐.
> **매핑 실패 시 원문을 로깅하고 "알 수 없음"으로 흘리는 방어 코드 필수.**

---

## 8. 반품

### 8.1 반품 접수 등록 — `registReturnRequest`

> (2025.08.11 최초 / **2026.04.29 `fareTy` 신용(030)·본사신용(040) 제외**)

| 필드 | 타입/길이 | 필수 | 내용 | 비고 |
|---|---|---|---|---|
| `orgnSlipNo` | S11 | P | 원운송장번호 | 없으면 `fixTakeNo`+`custCd` 필수 |
| `fixTakeNo` | S100 | P | 주문번호 | 원송장 없으면 필수 |
| `custCd` | S8 | P | 거래처코드 | 원송장 없으면 필수 |
| `sndCustNm` | S50 | Y | 송하인명 | 반품에서는 **반품 보내는 고객** |
| `sndTelNo`/`sndCellNo` | S50 | 택1 | 송하인 연락처 | |
| `sndCustAddr1` | S500 | Y | 송하인주소1 | 기본주소에 전체주소 입력 가능 |
| `sndCustAddr2` | S500 | N | 송하인주소2 | |
| `rcvCustNm` | S50 | Y | 수하인명 | 반품에서는 **화주사** |
| `rcvTelNo`/`rcvCellNo` | S50 | 택1 | 수하인 연락처 | |
| `rcvCustAddr1` | S500 | Y | 수하인주소1 | |
| `rcvCustAddr2` | S500 | N | 수하인주소2 | |
| `qty` | I | Y | 수량 | **1 고정** |
| `fareTy` | S3 | Y | 운임타입코드 | ⚠️ **`010`/`020`만** |
| `dlvFare` | I7 | Y | 택배운임 | ⚠️ **`null` 또는 `0` 불가** |
| `goodsNm` | S1000 | N | 물품명 | |
| `sndMsg` | S500 | N | 배송메세지 | |

**응답**: `data[].takeNo` (**접수번호 S12**), `fixTakeNo`, `resultCd`, `resultMsg`

> 이후 모든 반품 조회·취소의 키는 **`takeNo`(접수번호)**. 반드시 저장할 것.

### 8.2 반품 조회 3종 — 키가 다름

| API | 조회 키 | 반환 |
|---|---|---|
| `inquiryReserveStateMulti` | `custCd` + **`takeNo`** | `resvStat`, `slipNo`, `delayCd`, `procDt` |
| `inquiryReserveStateFixTakeNo` | `custCd` + **`fixTakeNo`** | 위 + `takeNo` |
| `inquiryReturnStateMulti` | `custCd` + **`orgnSlipNo`** | `data1[]`: `takeNo`, `slipNo`, **`resvStatNm`**(명칭) |

> ⚠️ `inquiryReturnStateMulti`만 상태를 **코드가 아니라 한글 명칭(`resvStatNm`)** 으로 반환.
> 나머지 둘은 코드(`resvStat`). 혼용 주의.

### 8.3 반품 취소 — `cancelReserveState`

**요청**: `userId`, `data[].custCd`, `data[].takeNo`
**응답**: `takeNo`, `resvStat` = **`030`(취소)**

> ⚠️ **상태코드 불일치**: 조회 API의 코드표는 `20 = 접수취소`인데,
> 취소 API 응답은 `030`을 반환. 자릿수(2자리 vs 3자리)도 다름.
> **취소 응답값을 상태 코드표와 같은 테이블로 매핑하면 안 됨.** 개발계 검증 필요.

### 8.4 반품 운임 조회 2종

| API | 요청 | 반환 |
|---|---|---|
| `reverseChkInfoMulti` | `custCd` + `orgnSlipNo` | `dlvBranCd`(**반품 시 집하지점**), `branNm`, `fareTy`, `fareTyNm`, `dlvFare` |
| `contRtnFares` | `orgnSlipNo` + `fareTy` | `data1[]`: 박스타입별 `dlvFare` |

`reverseChkInfoMulti`가 원송장 기준으로 **집하지점과 운임을 한 번에** 주므로 접수 전 검증용으로 적합.

---

## 9. 할증운임 조회 — `custExtraFare`

> "물품금액, 택배운임에 따른 할증운임을 조회한다.
> (**주문 정보 일괄 등록, 송장 출력 주문 정보 등록 사용 시 조회**)" — 두 경로 모두에서 사용

**요청**: `userId`, `data[]`: `custCd`(Y), `fareTy`(Y), `qty`(N, 고정), `goodsAmt`(N), `dlvFare`(N)

**응답**: `custCd`, `fareTy`, `goodsAmt`, `dlvFare`, **`extraFare`**

예시: 물품금액 15,000,000 / 택배운임 45,000 → **할증운임 42,750**

> 고가 물품의 할증을 자체 계산하지 말고 **반드시 이 API로 산출**해서 `extraFare`에 넣을 것.

---

## 10. 코드표

### 운임타입코드 `fareTy`

| 코드 | 의미 |
|---|---|
| `010` | 선불 |
| `020` | 착불 |
| `030` | 신용 |
| `040` | 본사신용 |

⚠️ **반품(`registReturnRequest`)은 `010`/`020`만** (2026.04.29 변경)

### 반품 요청상태 `resvStat`

| 코드 | 의미 |
|---|---|
| `10` | 접수완료 |
| `20` | 접수취소 |
| `30` | 집하지시 |
| `40` | 집하완료 |
| `50` | 미집하 |
| `60` | 기타 |

⚠️ 취소 API 응답만 `030` 반환 — 8.3 참고

### 반품 미집하사유 `delayCd`

| 코드 | 사유 |
|---|---|
| `10` | 타택배사반송 |
| `20` | 고객장기부재 |
| `21` | 고객연락불가 |
| `22` | 고객방문희망일 |
| `23` | 안심번호(전화연결불가) |
| `30` | 반품이중등록 |
| `40` | 오등록 |
| `50` | 반품취소 |
| `60` | 사전반품완료 |
| `70` | 고객과의 약속 |
| `80` | 집하물품없음 |
| `90` | 집하금지품목 |
| `99` | 기타 |

### 박스타입코드 `boxTyCd`

**고정 코드표 없음.** 거래처 계약에 따라 다르므로 `contPickFares`(반품은 `contRtnFares`)로
조회해서 캐싱하는 것이 사실상의 코드표. 예: `AS080`=극소1, `WS001`

### 화물상태

**코드 없음.** `statNm` 한글 문자열만. 7장 주의사항 참고.

---

## 11. 계약 조회

### 11.1 거래처 계약정보 통합조회 — `contractTotalInfo`

**요청**: `userId`, `data[].custCd`

| 응답 필드 | 타입/길이 | 내용 | 예시 |
|---|---|---|---|
| `pickSalesCd` | S8 | 집하영업소코드 | `33610000` |
| `pickSalesNm` | S20 | 집하영업소명 | `수지 기본(050-6113-0000)` |
| `pickBranCd` | S4 | 집하지점코드 | `336` |
| `pickBranNm` | S20 | 집하지점명 | `동수지` |
| `fareTy` | S3 | 운임타입코드 | `040` |
| `fareTyNm` | S20 | 운임타입명 | `본사신용` |
| `useYn` | S1 | 사용여부 | `Y`/`N` |

**활용**
- `fareTy`를 받아오면 **주문 등록 시 운임타입 하드코딩 불필요**
- `useYn = "N"` → 접수 불가. **대량 등록 전 사전 검증용**
- `pickSalesNm`에 전화번호가 괄호로 붙어옴 → 영업소명만 쓰려면 파싱 필요
- 자주 안 바뀜 → **캐싱 후 일 1회 갱신**

### 11.2 계약운임 조회 — `contPickFares`

**요청**: `userId`, `data[]`: `custCd`(Y) + `fareTy`(**Y**)
**응답**: `data1[]` — `boxTyCd`, `boxTyNm`, `custNm`, `dlvFare`

- `fareTy`가 필수 → `contractTotalInfo` → `contPickFares` 순서가 자연스러움
- 착불·선불 혼용 거래처는 **타입별로 각각 조회**해야 전체 운임표 확보
- ⚠️ 이 API는 `resultCd`가 최상위 + `SUCCESS`/`FAIL` (2장 참고)

---

## 12. 구현 전 체크리스트

- [ ] **고정 IP 확보** — 인증키만으로는 호출 불가
- [ ] `secretKey` 환경변수 분리 + **만료일 알림**(최대 2년, 3개 로테이션)
- [ ] 출고 경로 **A / B 결정** (4장)
- [ ] **부분 성공 처리** — `data[].resultCd` 단위 재시도/로깅
- [ ] `resultCd` 값 체계 **API별 분기** (`TRUE`/`SUCCESS` 혼재)
- [ ] `data1[]` **배열로 수신** (다박스·재출력 누락 방지)
- [ ] `fixTakeNo` **고유 발번 규칙** — 응답 매칭·반품 조회의 키
- [ ] 반품 `takeNo` **영속 저장** — 조회·취소의 유일 키
- [ ] `statNm` 한글 매핑 테이블 + **미매핑 원문 로깅**
- [ ] 운임/박스타입 **캐싱 전략** (`contPickFares`)
- [ ] 합포장 `#` 구분자 **이스케이프**
- [ ] 국내 주소는 **우편번호 미사용**, 전체주소 한 덩어리

---

## 13. 참고 링크

- 개발자 포털: https://openapihome.ilogen.com/
- 이용절차: `/lsy06f-api-service/pages/guide/apply-process.html`
- 인증 가이드: `/lsy06f-api-service/pages/dev-guide/token-usage.html`
- API Docs: `/lsy06f-api-service/pages/api-docs/contract-info.html`
- 로젠 오픈API 안내: https://www.ilogen.com/web/enterprise/openAPI
