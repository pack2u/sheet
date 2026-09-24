# 로젠택배 Open API — CS웹앱 적용계획

> 작성 2026-09-15 · 규격 원문은 `로젠택배_OpenAPI_규격.md`
> 기존 롯데 연동(`csLotte.gs`)과 같은 자리·같은 방식으로 붙인다.

---

## 0. 배경

2026-09-11 자사출고 택배사를 **로젠으로 바꿨다**(`_partnerHelpers.gs:197`).
그래서 그 이후 자사출고 송장은 `입력_로젠주문실적` 탭으로 들어오는데,
**CS웹앱의 배송조회는 아직 롯데 API뿐이다**(`csLotte.gs`).
로젠 송장은 CS 화면에서 추적이 안 된다. 이걸 메우는 게 이 작업이다.

자사출고 송장 자릿수로 택배사가 갈린다 — **롯데 12자리 / 로젠 11자리**
(`_partnerOrders.gs:4728`). 이 분기가 이미 있으므로 조회 라우팅에 그대로 쓴다.

---

## 1. ★ 먼저 풀어야 할 막힘 — 고정 IP

**로젠은 IP 화이트리스트를 쓴다.** 등록된 IP에서 온 호출만 받고, 아니면 `401`.

> 인증방식
> 1. 호출자 IP 주소 체크 : 업체 등록된 IP 주소를 검증
> 2. 인증키 체크 : 발급된 인증키의 유효성 검사

**CS웹앱은 Apps Script다. `UrlFetchApp` 의 발신 IP는 구글 공용 대역이고 고정이 아니다.**
호출할 때마다 바뀌므로 등록 자체가 불가능하다.

롯데는 이 문제가 없었다. `Authorization: IgtAK <키>` 헤더만 보고 IP는 안 본다.
그래서 `csLotte.gs` 를 그대로 베끼면 **로젠은 401만 떨어진다.**

### 선택지

| 안 | 내용 | 비용 | 판단 |
|---|---|---|---|
| **A. 로젠에 면제 요청** | IP 검증 없이 인증키만으로 허용해 달라고 요청 | 0원 | **먼저 물어볼 것.** 되면 가장 깔끔 |
| **B. Cloud Run + Cloud NAT** | 구글 클라우드에 프록시. Cloud NAT로 **고정 송신 IP** 확보 | 월 1~2만원대 | 같은 구글 생태계, GAS에서 부르기 쉬움 |
| **C. 소형 VPS** | 저가 VPS에 프록시 1개 | 월 5천~1만원 | 가장 저렴. 서버 1대 관리 부담 |
| **D. 사무실 회선** | 사무실 고정 IP + 내부 PC에 프록시 | 0원 | 회선이 고정 IP여야 하고, PC가 꺼지면 죽음 |

**권고: A를 먼저 문의하고, 안 되면 B.**
A는 이메일 한 통이고 리드타임 안에 답이 온다. 신청서 낼 때 같이 물어보면 시간이 안 든다.

> 기존 `pack2u-partner.vercel.app`(V2)과 Supabase는 **둘 다 고정 송신 IP가 아니다.**
> 여기에 얹는 건 답이 안 된다.

### 프록시를 세울 경우 구조

```
[CS웹앱 home.html]
   └ google.script.run → [csLogen.gs]
        └ UrlFetchApp → [프록시 (고정 IP + secretKey 보관)]
             └ → [로젠 OPEN API]
```

프록시는 얇게 간다. **로젠 응답을 그대로 통과**시키고 정규화는 `csLogen.gs` 에서 한다.
프록시에 로직을 넣으면 배포처가 둘로 갈려 유지보수가 나빠진다.
프록시 인증은 기존 `CS_FILESTORE_TOKEN` 방식(공유 토큰 헤더)을 그대로 쓴다.

---

## 2. 파일 배치 — 기존 관례 그대로

| 새 파일 | 대응하는 기존 파일 | 내용 |
|---|---|---|
| `csLogen.gs` | `csLotte.gs` | 호출 래퍼, 쿼터, 캐시, 상태 정규화 |
| `csLogenReturn.gs` | `csLotteReturn.gs` | 반품 접수·조회·취소 |
| `_cslogen_test.js` | `_cslotte_test.js` | 로컬 Node 검증 (clasp push 제외) |
| `로젠택배_OpenAPI_규격.md` | `롯데택배_OpenAPI_규격.md` | 규격 원문 정리 |

**키는 `_secrets.gs` 에만 둔다.**

```js
// ── 로젠택배 Open API ──────────────────────
//  포털: https://openapihome.ilogen.com
//  개발계 https://topenapi.ilogen.com / 운영계 https://openapi.ilogen.com
//  헤더: secretKey: <키>   ★ IP 화이트리스트 병행 — 프록시 경유 필수
var LOGEN_SECRET_KEY_DEV  = "";
var LOGEN_SECRET_KEY_PROD = "";
var LOGEN_USER_ID = "30556066";   // 연동업체코드가 없으면 거래처코드를 넣는다 ★담당자 확인 중
var LOGEN_CUST_CD = "30556066";   // 거래처코드 — 주식회사 팩투유
var LOGEN_PROXY_URL   = "";
var LOGEN_PROXY_TOKEN = "";
```

> **거래처코드 `30556066`** (주식회사 팩투유) — 2026-09-15 확인.
> `userId` 도 같은 값을 쓰는 게 맞는지는 담당자 회신 대기 중(문의메일 3번).
> 별도 연동업체코드가 발급되면 `LOGEN_USER_ID` 만 그 값으로 교체한다.

> ⚠️ `_secrets.gs` 는 `.claspignore` 에 **넣지 말 것**.
> 넣으면 clasp push 가 서버 파일을 지운다(2026-09-08 사고 이력).
> push 전 `_secrets_guard_test.js` 로 값 온전성 확인하는 기존 절차 그대로.

---

## 3. 쓸 API (19종 중 7종)

| 용도 | API | 우선순위 |
|---|---|---|
| 배송 최종상태 | `inquiryCargoTrackingMultiLast` | **P0** |
| 배송 전체이력 | `inquiryCargoTrackingMulti` | **P0** |
| 주문번호 → 송장번호 | `inquirySlipNoMulti` | P1 |
| 반품 접수 | `registReturnRequest` | P1 |
| 반품 상태 (원송장) | `inquiryReturnStateMulti` | P1 |
| 반품 취소 | `cancelReserveState` | P1 |
| 반품 집하지점·운임 | `reverseChkInfoMulti` | P2 |

출고 계열(`registerOrderData`, `slipPrintM`, `getSlipNo`, `outSlipPrintPop`)은 **범위 밖**.
자사출고 송장은 이미 `입력_로젠주문실적` 탭으로 들어오고 있다.

---

## 4. `csLogen.gs` 설계

### 4.1 롯데에서 배운 것을 그대로 적용

`csLotte.gs` 머리말의 교훈이 로젠에도 **그대로, 더 강하게** 적용된다.

> 담당자가 준 코드표에 없는 코드가 온다 (…) 그래서 표보다 응답의 `godsStatNm` 을 우선한다.

**로젠은 아예 코드가 없다.** `statNm` 한글 문자열만 온다(`배송완료` 등).
→ 롯데에서 "표보다 응답 이름 우선"으로 이미 정착시킨 방식이 **로젠에서는 유일한 방법**이다.

```js
// 로젠은 코드가 없다. statNm 문자열이 전부다.
// 내부 상태는 '완료 여부' 판정에만 쓰고, 화면에는 statNm 원문을 그대로 보여준다.
var _LOGEN_DONE_WORDS_ = ["배송완료"];   // 관측되는 대로 늘린다
// 매핑 실패는 죽이지 않는다 — 원문 노출 + WARN 로깅
```

### 4.2 쿼터·캐시

로젠은 **공개된 일일 쿼터 문구가 없다.** 롯데(10,000/일)처럼 명시된 상한을 못 찾았다.
→ 상한을 모른다고 마음 놓고 부르면 안 된다. **롯데와 같은 방식으로 세고 캐시한다.**

| 항목 | 값 | 근거 |
|---|---|---|
| 일일 카운터 | ScriptProperties `LOGEN_QUOTA_yyyyMMdd` | 롯데와 동일 패턴 |
| 소프트 캡 | 우선 9,000 | 롯데 기준 답습. 실제 상한 확인되면 조정 |
| 캐시 (진행중) | CacheService 30분 (`_LOGEN_CACHE_SEC_ = 1800`) | 롯데와 동일 |
| 캐시 (배송완료) | **6시간** (`_LOGEN_CACHE_DONE_SEC_ = 21600`) | 종결 상태는 안 바뀜 |

> ⚠️ **"영구 캐시"는 안 된다.** CacheService 의 최대 만료가 **21600초(6시간)** 다.
> 그 이상 두려면 시트나 ScriptProperties 에 따로 쌓아야 하는데,
> 조회량을 모르는 지금 단계에서 벌일 일은 아니다. 호출량이 문제가 되면 그때 붙인다.

> 신청 시 **일일 호출 상한을 반드시 물어볼 것.** 문서에 없다.

### 4.3 배치 호출

로젠 추적 API는 `data[]` 배열 입력이다. **목록 화면에서 N건을 한 번에** 부른다.
건별 루프는 GAS 6분 실행 제한에 걸린다.

### 4.4 응답 파싱 — 로젠 고유의 함정

`csLotte.gs` 에 없던 처리가 필요하다.

```js
// 1) 건별 성패는 data[].resultCd 로 본다. sttsCd 만 보면 부분실패를 놓친다.
// 2) resultCd 값 체계가 API마다 다르다:
//      TRUE/FALSE  — 추적·반품·주문
//      SUCCESS/FAIL — contPickFares, contRtnFares
//      SUCCESS/FALSE — integratedInquiry (문서 표기 그대로)
//    → 성공값 화이트리스트로 판정한다.
// 3) 성공 시 resultMsg 가 null 인 API와 "" 인 API가 섞여 있다.
// 4) data1[] 은 항상 배열로 받는다. 다박스면 송장이 N장이다.
```

---

## 5. 화면 적용

### 5.1 배송조회 라우팅 (`home.html` / `csOrderSearch.gs`)

송장 자릿수 분기가 이미 있다(`_partnerOrders.gs:4728`). 그대로 쓴다.

```
송장번호 입력
  ├ 12자리 → 롯데  (csLotte.gs)      기존
  └ 11자리 → 로젠  (csLogen.gs)      신규
```

**두 택배사 응답을 같은 모양으로 맞춰서** 화면은 한 벌만 쓴다.

```js
// 공통 형태
{ carrier, slipNo, statusText, statusDone, scanAt, branNm, salesNm, salesTel, history[] }
```

- 롯데: `godsStatNm` → `statusText`, 코드 `41` → `statusDone`
- 로젠: `statNm` → `statusText`, `배송완료` 포함 → `statusDone`

### 5.2 영업소 전화번호를 크게 노출

로젠 `inquiryCargoTrackingMultiLast` 에만 있는 **`salesCellNo`**(영업소 전화번호).
상담원이 영업소로 바로 연결할 수 있어 CS 체감이 가장 큰 필드다.
전체이력 API에는 없으니 **최종조회를 반드시 같이 부른다.**

### 5.3 반품 (`csReturnIntake.gs` / `csLotteReturn.gs` 옆)

```
원송장번호
  → reverseChkInfoMulti (집하지점·운임 확인)
  → 상담원 확인
  → registReturnRequest
  → takeNo(접수번호) 를 반품대장에 저장  ★필수
```

- **`takeNo` 없으면 이후 조회·취소가 불가능하다.** `csReturnLedgerSchema.gs` 에 열 추가
- 반품 `fareTy` 는 **`010`/`020`만** (2026.04.29 로젠 변경). UI 선택지에서 신용 계열 제외
- `dlvFare` 에 `0`·`null` 불가
- 미집하(`resvStat=50`)면 `delayCd` 를 한글 사유로 변환해 노출 (코드표는 규격서 10장)

---

## 6. 단계

### Phase 0 — 신청 (리드타임 있음, 지금 시작)

- [ ] 시스템연동신청서 제출 → **TEST Key** (계약지점 회신 1~2일)
- [ ] **★ IP 검증 면제 가능한지 문의** (§1-A) — 안 되면 프록시 착수
- [ ] **일일 호출 상한 문의** (문서에 없음)
- [ ] `userId`(연동업체코드) / `custCd`(거래처코드) 확보
- [ ] 자사가 연동업체가 아니면 `userId` 에 거래처코드를 넣어야 함 — 확인

### Phase 1 — 배송조회

- [x] `csLogen.gs` — 호출 래퍼, 쿼터, 캐시, 응답 정규화  (2026-09-15)
- [x] `csTrack.gs` — 송장 자릿수 라우팅 (11 로젠 / 12 롯데)  (2026-09-15)
- [x] 롯데·로젠 응답 형태 통일 → 화면 한 벌  (2026-09-15)
- [x] `_cslogen_test.js` — 21개 통과 (문서 예시 기준)  (2026-09-15)
- [ ] **인증키 발급** ← 여기서 막혀 있다
- [ ] (필요 시) 중계 서버 구축 + 고정 IP 등록
- [ ] 개발계 실호출로 `_cslogen_test.js` FIXTURE 교체
- [ ] `home.html` 한 줄 교체 — `.csLotteTrack(inv, {})` → `.csTrack(inv, {})` (8746행)
- [ ] `isLotteTrack()` 을 «자사출고면 true» 로 완화 — 지금은 로젠 건에 「상태」 버튼이 안 뜬다

### Phase 2 — 반품

- [ ] `csLogenReturn.gs`
- [ ] 반품대장 `takeNo` 열 추가
- [ ] 미집하 사유 노출

### Phase 3 — 운영

- [ ] `secretKey` 만료 알림 (최대 2년, 3개 로테이션 슬롯)
- [ ] 미매핑 `statNm` 알림 — **기존 `_chat_sendCard_` 밤 알림에 얹는다**
      (새 메뉴 만들지 않는다 / 실행을 부탁하지 않는다)
- [ ] 쿼터 소진 경고도 같은 자리에

---

## 7. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| **IP 화이트리스트** | 연동 자체가 불가 | §1 — 최우선 확인 |
| **인증키 2년 만료** | 전 기능 401 | 만료 90일 전 알림 |
| **프록시 단일 장애점** | 배송조회 정지 | 캐시 폴백 + "조회 지연" 배지 |
| `statNm` 표현 변경 | 상태 오표시 | 원문 폴백 + 미매핑 로깅 (롯데에서 겪은 그 문제) |
| 쿼터 미상 | 갑작스런 차단 | 보수적 소프트 캡, 완료건 영구 캐시 |
| 로젠 문서 변경 | 조용한 오동작 | 각 문서에 수정이력 있음. 분기별 확인 |

> 로젠 문서는 최근 1년간 변경이 잦았다 —
> 2026.01.12 `addOpt` 추가 / 2026.03.19 `resultCd` 오기 수정 /
> 2026.04.29 반품 운임타입 축소·제주운임 정액제.

---

## 8. 확인 필요

1. ~~로젠 거래처코드~~ → **`30556066`** 확인 완료 (2026-09-15)
2. **IP 면제 vs 프록시** — 로젠 회신에 달림 (최우선)
3. CS에서 **송장 재발행**까지 하는지 (한다면 출고 API가 범위에 들어옴)
4. 프록시를 세운다면 **어디에** (Cloud Run / VPS / 사무실 회선)
