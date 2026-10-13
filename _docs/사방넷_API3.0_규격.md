# 사방넷 API 3.0 연동 규격 (Pack2U)

> 앱 `Pack2U-Hub` · 서비스코드 `57640` · 약정 `57640-014` (API3.0 자체개발_실버)
> 이용기간 **2026-10-12 ~ 2026-11-11** (1개월)
> 문서 원본: `사방넷-개발자센터-API문서.pdf` 247쪽 (2026-07-01) · 정리본 `2026-10-12_사방넷API3.0_실측정리.md`

---

## 0. ★ 실측 메모 — 문서와 다른 것들 (2026-10-12 운영계 실호출)

처음으로 실제 응답을 받았다. **문서를 그대로 믿으면 안 되는 지점들**이 바로 드러났다.

| 항목 | 문서 | **실제** |
|---|---|---|
| `clientCd` | **Base62 20자리** | **UUID 36자** — 개발자센터의 「앱 코드」 그대로 |
| TPS | 기본 **20** tokens/sec | **`X-RateLimit-Limit: 10`** — 절반이다 |
| 응답 포맷 | "공통 래퍼 **없이** 리소스 스키마가 직접 반환" | **`{code, message, data:{…}}`** 로 감싼다 |
| 주문 수집 메서드 | **`GET /v3/sb/order`** | **`POST` 만 받는다** — GET·PUT·PATCH·DELETE 전부 `405 GW_REQ_005` |

> ★ 응답 래퍼를 문서대로 짰으면 파서가 전부 깨졌다 ★
>   `totalCount` 는 최상위가 아니라 `data.totalCount` 다. 목록도 `data.malls` 다.
>   WMS(`/v3/sbf/**`) 쪽 문서에는 「공통 필드로 감싼다」고 돼 있는데,
>   OMS(`/v3/sb/**`) 문서에는 「감싸지 않는다」고 돼 있다. **실제는 둘 다 감싼다.**

> ★ TPS 10 은 설계를 바꾼다 ★
>   문서(20)를 믿고 동시 호출을 20으로 잡으면 절반이 429 로 튕긴다.
>   「버스트 없음」이라 유휴 시에도 쌓이지 않는다. **동시성 상한은 10 미만으로 둔다.**

**문서대로 맞았던 것** — 이쪽도 적어 둔다. 다음 사람이 어디를 의심할지 알아야 한다.

| 항목 | 확인 |
|---|---|
| `secretSign = Base64(BCrypt.hashpw("{clientCd}_{timestamp}", secret))` | ✅ 그대로 맞다 |
| 시크릿이 **bcrypt salt 형식** (`$2a$10$` + 22자) | ✅ hashpw 의 salt 자리에 그대로 넣는다 |
| JWT 수명 3시간 | ✅ `expires_in: 10800` |
| IP 화이트리스트 | ✅ 등록한 IP 에서 통과 |
| `X-Svc-Acnt-Id` = 서비스코드 | ✅ `mw57640` 로 200 |

---

## 1. 통하는 설정 (2026-10-12 실호출 성공)

```
호스트     프로덕션  https://api.sabangnet.co.kr
           샌드박스  https://sandbox.sabangnet.co.kr   (고정 응답)

clientType     SB_APP
clientCd       c889137c-45e4-45e3-b686-dc9e254b8a8b     ← 개발자센터 「앱 코드」
X-Svc-Acnt-Id  mw57640                                   ← 고객사 서비스코드
시크릿         프로덕션 / 샌드박스 «따로» (개발자센터 > 앱 > 인증 정보)
허용 IP        222.122.39.14  (중계기 · 로젠과 공용)
               14.34.200.225  (사무실 · 실측용)
```

### 토큰 발급

```
POST {host}/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
clientType=SB_APP
clientCd={앱 코드}
timestamp={Unix ms}                  ※ 서버 시각 ±5분 30초
secretSign={아래}
authMode=PRODUCTION | SANDBOX
```

```js
// 실제로 통한 서명 (Node · bcryptjs)
const hash = bcrypt.hashSync(`${clientCd}_${timestamp}`, secret);  // secret 이 곧 salt
const secretSign = Buffer.from(hash, "utf8").toString("base64");
```

응답
```json
{ "access_token": "eyJraWQiOiJzYi1k…(819자)", "token_type": "Bearer", "expires_in": 10800 }
```

JWT 안쪽 — `sub`·`client_cd` 가 모두 앱 코드다. `auth_mode` 로 환경이 박힌다.
```json
{ "sub": "c889137c-…", "client_cd": "c889137c-…", "aud": "https://api.sabangnet.co.kr",
  "iss": "https://api.sabangnet.co.kr/oauth2", "auth_mode": "PRODUCTION",
  "client_type": "SB_APP", "exp": …, "iat": …, "jti": "…" }
```

### 호출

```
Authorization: Bearer {JWT}
X-Svc-Acnt-Id: mw57640
```

### ★ Apps Script 로는 토큰을 못 받는다

`secretSign` 이 BCrypt 다. GAS `Utilities` 에는 BCrypt 가 없다(MD5·SHA·HMAC 뿐).
게다가 **미등록 IP 는 토큰 발급부터 거부**되는데 GAS 발신 IP 는 구글 대역에서 유동 배정된다.

→ **중계기(PHP)가 토큰을 받는다.** PHP 는 `password_hash($s, PASSWORD_BCRYPT)` 가 기본이고,
   `_logen_relay` 호스팅이 이미 고정 IP 를 갖고 있다. 로젠과 **같은 꼴**이다.

---

## 2. 쇼핑몰 코드 — 우리 14개 (2026-10-12 실측)

`GET /v3/sb/mall/{SHOP|CHOP|GLOBAL}` → 제휴 21 · 일반 1 · 해외 1 = **23개**

`POST /v3/sb/order` 의 `shopCodeList` 에 넣을 값이다 (문서는 GET 이라고 적었다 — 2-E).

| 우리 원장 표기 | shopCode | 사방넷 몰 이름 | 원장 건수(9/14~10/8) |
|---|---|---|---|
| 배민상회 | `shop0546` | 배민상회 | 2,372 |
| 스마트스토어 | `shop0055` | 스마트스토어 | 2,314 (법인+개인) |
| **자사몰** | **`shop0298`** | **Cafe24(신) 유튜브쇼핑** | 1,619 |
| 쿠팡 | `shop0075` | 쿠팡 | 847 |
| 지마켓 | `shop0068` | **ESM**지마켓 | 574 |
| 옥션 | `shop0067` | **ESM**옥션 | 81 |
| 11번가 | `shop0464` | 11번가 | 26 |
| 오너클랜 | `shop0120` | 오너클랜 | 51 |
| 식봄 | `shop0697` | 식봄 | 43 |
| (주)텐바이텐 | `shop0042` | 텐바이텐 | 31 |
| 도매꾹/지앤지커머스 | `shop0319` | 도매꾹 | 18 |
| 카카오톡스토어 | `shop0273` | 카카오톡스토어 | 17 |
| 롯데온 | `shop0372` | 롯데온 | 14 |
| 알리 | `shop0587` | AliExpress (제휴·해외 양쪽에 같은 코드) | 12 |

> 이름이 다른 셋을 주의한다 — 원장은 「지마켓·옥션·텐바이텐」, 사방넷은 「ESM지마켓·ESM옥션·텐바이텐」.
> **자사몰이 Cafe24 유튜브쇼핑으로 등록돼 있다** (2026-10-12 사장님 확인). 이름만 보고는 못 찾는다.

### 등록은 돼 있으나 그 기간 주문이 없던 몰 (9개)

`shop0583` 토스쇼핑 · `shop0046` 72TIME · `shop0678` 캐시딜(신) · `shop0082` 큐텐 ·
`shop0100` SSG.COM · `shop0498` 올웨이즈 · `shop0255` 우리샵

`chop0001` **전화주문** — 전화주문도 사방넷에 「일반쇼핑몰」로 등록돼 있다.

---

---

## 2-B. 운송장 저장/수정 — 실측 (2026-10-12 샌드박스)

```
POST {host}/v3/sb/waybill
Authorization: Bearer {JWT} · X-Svc-Acnt-Id: mw57640 · Content-Type: application/json

{ "forceUpdateYn": "N",
  "waybillList": [ { "sbOrderNo": 2014010837, "deliveryCompanyCode": "001",
                     "wayBillNo": 20250526172700, "hopeDeliveryDate": 20260114 } ] }
```

응답 (`HTTP 200`)
```json
{ "code": 200, "message": "OK",
  "data": { "totalCount": 1, "successCount": 1, "failCount": 0,
            "results": [ { "sbOrderNo": "2014010837", "status": true, "errorMessage": null } ] } }
```

### ★ 수용시험 S2 충족 — 건별 성공/실패를 식별할 수 있다

`results[]` 가 **주문번호 · `status`(boolean) · `errorMessage`** 를 건별로 돌려준다.
지금 엑셀 업로드는 결과를 화면으로만 보지만, API 는 **어느 주문이 왜 튕겼는지 코드가 안다.**
→ 1단계를 할 값어치가 있다.

### 우리 데이터와 그대로 맞는다 — 변환이 없다

| 사방넷 | 우리 |
|---|---|
| `sbOrderNo` | 사방넷주문번호 = **고유ID** (시스템 전역 키) |
| `deliveryCompanyCode` | `_PEP_CARRIER_SABANG_CODE_` (001 CJ · 002 롯데 · 007 로젠 · 037 대신) |
| `wayBillNo` | 운송장번호 |

`ss_사방넷엑셀저장`(세트분리V2 `gasBulk.js`)이 만드는 행이 그대로 `waybillList` 가 된다.
[_sabangone_test.js](../_sabangone_test.js)(주문번호당 송장 1개) ·
[_sabanguid_test.js](../_sabanguid_test.js)(우리 UID `PH-`·`ds-` 섞임 차단)가 그대로 지킨다.

### ★ 아직 모르는 것 — 실패 «사유»의 모양

`errorMessage` 는 **코드가 아니라 문자열**이다. 샌드박스는 성공만 돌려주므로
실패 메시지가 어떻게 생겼는지 못 봤다.

> **재시도를 문자열로 가르게 될 수 있다.** 어떤 실패는 다시 보내도 되고(일시 오류),
> 어떤 것은 안 된다(이미 쇼핑몰로 송신됨·강제완료). 모양을 보기 전에는 가르지 않는다.
> **그때까지 실패 건은 무조건 보류 + 알림**으로 둔다 — 조용히 재시도하지 않는다.

---

---

## 2-C. 중계기가 끝까지 통했다 (2026-10-12)

```
GAS(sabangApi.gs) → sabang.php @222.122.39.14 → sandbox.sabangnet.co.kr → 응답
```

`🏪 쇼핑몰정책 → 🔌 사방넷 연결 점검` 이 `HTTP 200` 과 몰 목록을 돌려줬다.

### ★ PHP crypt() 가 자바 BCrypt.hashpw 와 같은 값을 낸다

실측 전에 **유일하게 못 재던 것**이었다. Node `bcryptjs` 로는 통했지만
중계기는 PHP `crypt()` 를 쓰는데, 그 둘이 어긋나면 `AUTH_003`(서명 오류)이 난다.
이 PC 에 php 가 없어 올려 보기 전에는 알 수 없었다.
**통했다.** 서명 방식은 더 의심하지 않아도 된다.

### ★ 샌드박스는 «가짜 데이터»다 — 몰 코드를 가져다 쓰지 말 것

| | 쿠팡 | 몰 수 |
|---|---|---|
| 샌드박스 | `shop0012` | 2개 (스마트스토어·쿠팡) |
| **운영계** | **`shop0075`** | **23개** |

같은 쿠팡인데 코드가 다르다. 샌드박스는 고정 응답이라 그렇다.
**쇼핑몰정책·`shopCodeList` 에 넣을 값은 2장(운영계 실측)의 코드다.**
샌드박스 코드를 베껴 넣으면 운영계에서 아무 주문도 안 걸린다 — 오류도 안 난다.

---

---

## 2-D. 개발자센터 실측 (2026-10-12) — PDF 보다 최신이다

`https://developer.sabangnet.co.kr/docs/` (로그인 필요). PDF 는 2026-07-01 자라 **뒤처져 있다.**

### PDF 에 없던 것

| | |
|---|---|
| **SKU 상품** (2항목) | `GET /v3/sb/sku` · `POST /v3/sb/sku/upsert` |
| **주문보정** | `modify-order` |
| **워크플로우** 섹션 | `/docs/workflow/sabangnet/product` — 절차 안내 |

### ★★ 재고송신은 «된다» — 앞선 판단을 뒤집는다 ★★

`sku/upsert` 문서에는 이렇게 적혀 있다.

> **재고(quantity)는 API를 통해 직접 등록/수정할 수 없습니다**

그래서 한때 「재고송신 불가」로 적었다. **틀렸다.** 그것은 SKU 레벨 이야기고,
**상품(product) 의 옵션(단품) 레벨에는 재고가 있다.**

```jsonc
POST /v3/sb/product/upsert
{ "products": [{
    "customProductCode": "PRD-001",
    "optionInfo": {
      "stockUseYn": "Y",
      "optionEditCode": "RESET",            // ★ 아래 함정 참고
      "options": [{
        "optionDetailName": "블랙/L",
        "stockQuantity": 0,                 // ★ 가상재고수량
        "safetyStockQuantity": 0,           // 안전재고
        "optionSupplyStatusCode": "SOLD_OUT", // SALE · SOLD_OUT
        "additionalAmount": 0,              // 옵션 추가금
        "skuCode": "…", "barcode": "…"
      }]
    }
  }] }
```

→ **몰 14개 과판매 문제를 사방넷 API 로 풀 수 있다.** 재고송신이 1순위로 돌아온다.

### ★ 품절은 숫자만 0으로 해서는 «안 된다» ★

문서 원문:

> `stockQuantity`(가상재고수량)를 0으로 설정하는 것은 **재고 숫자만 0으로 만드는 것**이며,
> 옵션 공급상태가 `SALE` 이면 **여전히 판매 중 상태**입니다.
> 따라서 품절 처리 시에는 `optionSupplyStatusCode=SOLD_OUT` 과 `stockQuantity=0` 을 **함께** 설정하는 것을 권장합니다.

| 하려는 것 | 방법 |
|---|---|
| 옵션(단품) 품절 | `optionSupplyStatusCode: "SOLD_OUT"` **+** `stockQuantity: 0` |
| 상품 전체 품절 | `productSupplyStatusCode: "OUT_OF_STOCK"` |
| **몰별 품절** | **없다.** `channels-product` 에도 품절 기능이 없다 |

몰별 품절이 없는 것은 우리에게 오히려 맞다 — 재고가 바닥나면 **전 몰에서 동시에** 내려야 한다.

### ★★ optionEditCode — 하나만 고치려다 나머지를 다 지운다 ★★

| 값 | 동작 | 기존 옵션 | 옵션 1개만 보낼 때 |
|---|---|---|---|
| **`RESET`** | 매칭 기반 **부분 수정** | 유지 | 요청한 옵션만 수정 |
| `MODIFIABLE` | **전체 삭제 후 재구성** | **삭제됨** | **보낸 1개만 남고 나머지 전멸** |
| `IMMODIFIABLE` | RESET 과 같다 | 유지 | |

`RESET` 은 `optionDetailName` 으로 기존 단품을 찾아 그것만 고치고,
요청에 없는 옵션은 건드리지 않는다. 매칭 실패하면 새 옵션으로 넣는다.

> **재고 밀기에는 반드시 `RESET` 을 쓴다.**
> `MODIFIABLE` 로 품절 하나를 보내는 순간 그 상품의 다른 옵션이 모두 사라진다.
> 「한 값만 고치려다 전부 날리는」 자리다 — [[dont-overwrite-what-you-couldnt-read]] 와 같은 결이다.
> (`MODIFIABLE` 은 `stockUseYn=Y` 인 상품에는 아예 못 쓴다)

### 상품 본문 — 쓸 만한 칸

| | |
|---|---|
| 가격 | `sellingPrice`(판매가) · `consumerPrice`(소비자가) · `costPrice`(원가) · `managementCostPrice` |
| 상세 | `productDetailDescription` · `additionalDetailDescription1~3` · `imageInfo[{imageSrno, imagePath}]` |
| 고시 | `attributeInfo[{attributeClassificationCode, attributeSrno, attributeText}]` |
| 배송 | `deliveryCostCode`(FREE 등) · `deliveryCost` · `salesRegionCode` |
| 분류 | `standardCategoryCode` · `myCategoryCodeL/M/S/D` |
| 원산지 | `originName` · `foodIngredientOriginName` (「갈비/호주산,양념/국내산」) |

### ★ 정산 API 는 «없다»

개발자센터 첫 화면에 「정산 내역」이 연동 가능 데이터로 적혀 있으나,
**주문관리·창고관리 어느 쪽 목록에도 정산 API 가 없다.** 마케팅 문구다.

→ `실효수수료_역산` 탭은 **당분간 손으로 채운다.** 몰·월당 판매액·실입금액 두 숫자다.

---

## 3. 아직 안 해 본 것
- [ ] `POST /v3/sb/order` **본문 필수 칸** — 2-E 참조. 메서드는 밝혔고 칸 이름을 모른다
      ★ `updateOrderStsYn:"N"` 없이 부르면 **신규주문이 주문확인으로 바뀐다** (몸통에 싣는다)
- [ ] `GET /v3/sb/claim` · `GET /v3/sb/cs`
- [ ] `POST /v3/sb/product/upsert` 본문에 **재고 수량 필드**가 있는가 → 재고송신 가능 여부
- [ ] `waybill` 의 `results[]` 에 실패 사유 코드가 오는가
- [x] 샌드박스 시크릿으로 토큰 발급 (`authMode=SANDBOX`) — 된다 (2026-10-12)

## 4. 실측 도구

`scratchpad/sabang/` (세션 임시 — 쓸 만해지면 저장소로 옮긴다)

| 파일 | |
|---|---|
| `probe.mjs` | 토큰 발급 실측. 에러 코드별 안내. 토큰·시크릿을 통째로 안 찍는다 |
| `mall.mjs` | 쇼핑몰 목록 조회 |
| `config.json` | **시크릿이 들어간다. 저장소에 올리지 않는다** |
| `config.sample.json` | 템플릿 |

## 5. 운영 전 할 일

- [ ] **프로덕션 시크릿 재발급** — 2026-10-12 대화 기록에 노출됐다. 개발자센터 > 앱 > 인증 정보
- [ ] 실측이 끝나면 사무실 IP(`14.34.200.225`) 를 허용 목록에서 뺄지 정한다
- [ ] **자동화 서비스**(쇼핑몰 송장 자동송신) 금액·과금단위 — 아직 못 받았다

---

## 2-E. 주문 수집 — 샌드박스 실측 (2026-10-12)

> 사장님 결정: **샌드박스에서만 먼저.** 운영계 주문 엔드포인트는 열지 않았다.

### ★ 메서드는 `POST` 다. 문서(와 우리 문서)가 틀렸다 ★

서버에게 직접 물었다 — 샌드박스 `/v3/sb/order` 에 메서드를 하나씩 넣어 봤다:

| 메서드 | 응답 |
|---|---|
| `GET` | `405` · `GW_REQ_005 허용되지 않은 HTTP 메서드입니다` |
| **`POST`** | **`400 BAD_REQUEST`** ← 검사 단계까지 들어간다. 이것뿐이다 |
| `PUT` · `PATCH` · `DELETE` | `405` |

`OPTIONS` 는 `Allow` 헤더를 안 준다(모든 경로가 405). 그래서 하나씩 쳐 봤다.

> **「`GET /v3/sb/order` 를 조심해라」고 두 문서에 적어 뒀던 것을 고쳤다.**
> `updateOrderStsYn:"N"` 은 쿼리가 아니라 **몸통에** 싣는다. 위험 자체는 그대로다 —
> 안 실으면 신규주문이 주문확인으로 넘어간다.

### 응답 봉투 — 페이지 방식이다. 한 건 단위가 아니다

실패(400)에도 봉투는 온다:

```json
{ "code": 400, "message": "BAD_REQUEST",
  "data": { "page": 0, "perPage": 0, "totalItemCnt": 0, "totalPage": 0,
            "curItemCnt": 0, "hasNext": false, "hasPrev": false,
            "isFirst": true, "isLast": true, "results": [] } }
```

**상품 조회와 다르다** — 상품은 코드 하나씩만 받는데(목록·페이지 전부 400),
주문은 `page`·`perPage`·`totalPage`·`hasNext` 를 갖춘 **페이지 응답**이다.
전수를 돌려 받을 수 있다는 뜻이다.

### 게이트웨이 오류는 봉투가 또 다르다

```json
{ "requestId": "...", "code": "GW_REQ_005", "message": "...",
  "timestamp": 1791797039712, "status": 405, "path": "/v3/sb/order" }
```

`code` 가 **숫자가 아니라 문자열**이고 `data` 가 없다. 앱 오류(`{code:400,…,data:{…}}`)와
섞어 파싱하면 깨진다. **`data` 가 있나로 가른다.**

### ★ 못 알아낸 것 — 본문 필수 칸 ★

몸통을 **열한 가지**로 바꿔 넣어 봤는데 전부 같은 `400 BAD_REQUEST` 다.
어느 칸이 모자란지 **한 마디도 안 알려준다**(`results[]` 가 비어 있다).

시도한 것: 빈 몸통 · `updateOrderStsYn` 만 · `startDate`/`endDate`(`yyyyMMdd`·하이픈) ·
`startDateTime`/`endDateTime` · `orderStartDate`/`orderEndDate` · `ordStartDate`/`ordEndDate` ·
`ordDateType` · `dateType` · `searchType` · `shopCodeList` · `shopCode` · `mallCodeList` ·
`orderStatusCode(s)` · `sbOrderNo` · `sbOrderNoList` · `page`/`perPage`.

**이름을 더 찍어 보는 것은 낭비다.** 개발자센터의 주문 수집 규격(요청 본문 표)이
있어야 한다 — 로그인이 필요해 내가 못 본다. 사장님이 그 쪽을 열어 주시거나
화면을 주시면 바로 붙인다.

### 덤으로 확인된 것

`X-RateLimit-Limit: 10` — 주문 쪽에서도 **TPS 10** 이다 (문서 20).

### ★ `claim` · `cs` 도 POST 전용이다 — 중계기에 죽은 줄이 둘 있었다

같은 방법으로 물었다:

| | GET | POST |
|---|---|---|
| `/v3/sb/claim` | `405 GW_REQ_005` | `400 BAD_REQUEST` + 같은 페이지 봉투 |
| `/v3/sb/cs` | `405 GW_REQ_005` | `400 BAD_REQUEST` + 같은 페이지 봉투 |

중계기 화이트리스트에 `GET /v3/sb/claim` · `GET /v3/sb/cs` 로 적어 뒀던 것은
**한 번도 통할 수 없는 줄**이었다. 문서를 그대로 옮겨 적은 것이다.

> **POST 로 고치지 않고 닫아 뒀다.** `order` 가 부르는 것만으로 신규주문을
> 주문확인으로 바꾸는 API 였다. `claim`·`cs` 도 수집하면서 「확인」 표시를
> 남기는지 **모른다.** 모르는 채로 POST 를 열면 그 한 번이 흐름을 바꾼다.
> 개발자센터 규격에서 「읽기만 한다」를 확인한 뒤에 연다.

### 쪽 번호가 0 부터인지 1 부터인지 — ★ 아직 모른다 ★

실패 응답의 `page: 0` 은 근거가 못 된다. `perPage`·`totalPage`·`curItemCnt` 가
다 `0` 인 **안 채워진 봉투**다. 성공 응답을 한 번도 못 받았다
(order·claim·cs 가 전부 400 이고, mall·product 는 이 봉투를 안 쓴다).

> **짐작해서 박지 말 것.** 응답이 `data.page` 를 **되돌려 준다** —
> 첫 호출에서 그 값을 읽어 기준을 «알아내는» 쪽이 맞다.
> 0 을 보냈는데 `page: 1` 이 오면 1 부터인 것이다.

---

## 2-F. SKU 세팅 · 상세페이지 — 실측 (2026-10-12)

운영계 상품 한 건(`JCCR00002`·`BF105PPSET0001`)을 **칸 끝까지** 읽었다.
쓰기는 샌드박스로만 찔러 봤다.

### 상세페이지 — 칸은 있다. 그런데 ★ 한 벌뿐이다 ★

| 칸 | 실제 |
|---|---|
| `productDetailDescription` | **HTML 11,936자** 가 그대로 온다 |
| `additionalDetailDescription1` · `2` | 추가 설명 140자씩 (둘이 같은 내용이었다) |
| `imageInfo[]` | **14건** · `imageSrno` + `imagePath` (사방넷 호스팅 `pic.sabangnet.co.kr`) |

> ~~★★ 「몰별 최적화 상세페이지」는 이 API 로 안 된다 ★★~~  **← 2-G 에서 취소했다**
> 상품 한 건에 상세설명 칸이 **하나**다. 쿠팡용·스마트스토어용을 따로 둘 자리가 없다.
> 몰별로 다르게 하려면 **사방넷의 몰 전송 설정** 쪽이어야 하고, 그 API 는 아직 못 봤다.
> 앞서 「몰별 배포 가능」으로 적어 둔 것은 **근거가 없었다.**

### 판매가도 한 벌뿐이다

`sellingPrice` 19,400 · `consumerPrice` 25,000 · `costPrice` 1 · `managementCostPrice` 0

> ~~**「몰별 판매가 수정」도 이 칸으로는 안 된다.**~~  **← 2-G 에서 취소했다** (channels-product)
> 몰별 가격은 사방넷 몰 설정의 마진율·가격규칙 영역이다.

### SKU 세팅 — 구조는 있고, 지금은 안 쓰고 있다

```
optionInfo
  stockUseYn      "N"            ← 재고관리를 안 쓴다
  optionEditCode  "MODIFIABLE"   ← ★★ 읽을 때도 이 값이 온다 ★★
  options[1]
    optionName / optionDetailName  "단품" / "단품"   ← 옵션을 안 쓴다
    skuCode                        null            ← ★ 칸은 있는데 비어 있다
    abbreviationName               "JCCR00002"     ← 이카운트 품목코드 (어떤 건 null)
    barcode                        "2110408800015"
    stockQuantity                  999             ← stockUseYn=N 이라 더미
    ea / setDivisionCode           1 / "G"
    safetyStockQuantity            0
    location / optionSupplyStatusCode / optionCollectionProductCode   null / null / "-"
```

> ★★ 가장 위험한 함정 ★★
> `optionEditCode` 가 **읽을 때도 `MODIFIABLE`** 로 온다.
> 「읽어서 한 칸 고쳐 되돌려 보내기」를 하면 **그 상품의 옵션이 전멸한다.**
> 재고송신이 `optionInfo` 를 아예 안 보내는 까닭이 이것이다.

### 그 밖에 읽히는 것

`productName`(마케팅 긴 이름) · `productAbbreviation` · `prtProductName`(송장 인쇄용) ·
`productTag`(검색 키워드 10개) · `brandName` · `manufacturerName` · `originName`(031) ·
`myCategoryCodeL/M/S` · `attributeInfo[27]`(상품고시정보 017) · `productCertifications[]` ·
`deliveryCostCode`(FREE) · `taxCode`(TAXABLE) · `returnLocationNo` · `salesRegionCode` ·
`packagingExceptYn` · `productDivisionCode`(PURCHASE) · `productCode`(사방넷 내부 104088)

> `modelName` 에 **「97원」**이 들어 있다 — 개당 단가를 모델명 칸에 적어 쓰고 있다.
> 자동화가 그 칸을 건드리면 그 관용이 깨진다. **손대지 않는다.**

### ~~★ 쓰기는 아직 못 한다 — 묶음 키 이름을 모른다 ★~~  **← 2-G 에서 풀렸다. 키는 `products` 가 맞다**

`POST /v3/sb/product/upsert` 에 몸통을 보내면 건별 오류가 이렇게 온다:

```
[상품 목록] 필수 입력값입니다.
```

**키 이름을 23개 쳐 봤고 전부 같은 답이다.**
`products` · `productList` · `productInfoList` · `productInfo` · `items` · `itemList` ·
`list` · `datas` · `data` · `goodsList` · `prodList` · `prdList` · `goodsInfoList` ·
`productMasterList` · `basicProductList` · `productBasicList` · `productRegList` ·
`productUpsertList` · `upsertList` · `masterList` · `productInfos` · `goods` · `product` ·
맨 배열.

> 규격서 §2 에 `{"products": [...]}` 로 적어 뒀던 것은 **틀렸다.**
> 재고송신 설계의 보내는 모양도 같이 틀렸다. 1단계(드라이런)는 영향 없지만
> **2단계는 개발자센터의 「요청 본문」 표가 있어야 열린다.**

### ★★ 샌드박스 성공은 증거가 아니다 ★★

통하는 `waybill` 로 버릇을 확인했다:

| 보낸 것 | 응답 |
|---|---|
| 온전한 줄 | `200 status=true` |
| 줄 속 칸 하나 뺌(택배사 없이) | **`200 status=true`** |
| **빈 줄 `{}` 하나** | **`200 status=true`** |
| 키 이름 틀림 | `400 [송장 리스트] 필수 입력값입니다.` |

**빈 줄에도 성공이라고 답한다.** 샌드박스는 묶음 키만 보고 속은 안 본다.

> 그래서 재고송신 설계의 **2단계(샌드박스로 보내 보기)는 「전송 경로가 산다」만
> 증명한다.** 몸통이 맞는지는 **아무것도** 증명하지 않는다.
> 「샌드박스 통과했으니 됐다」로 운영계에 가면 안 된다.

---

## 2-G. ★ 2-F 를 바로잡는다 — 내가 두 군데 틀렸다 (2026-10-12)

### ① 「몰별은 이 API 로 안 된다」가 틀렸다

**`POST /v3/sb/channels-product` — 「채널별 상품관리 · 몰별 가격·상세」가 따로 있다.**

`2026-10-12_사방넷API3.0_실측정리.md` 의 엔드포인트 표(118~127행)에 **이미 적혀 있었다.**
나는 `GET /v3/sb/product` 응답에 상세설명 칸이 하나뿐인 것만 보고 「몰별은 안 된다」고
결론지었다. **엔드포인트 목록을 안 보고 한 결론이었다.**

그 문서 279행은 이렇게 적어 뒤 있다 — 「①몰별 판매가 · ③몰별 상세페이지가
사방넷 경로로 성립한다」. 2-F 의 「몰별 최적화 상세페이지는 안 된다」는 **취소한다.**

아직 안 떠 본 엔드포인트가 더 있다:

| | |
|---|---|
| `POST /v3/sb/channels-product` | **몰별 가격·상세** ← 이것 |
| `POST /v3/sb/additional-product` | 추가상품 |
| `POST /v3/sb/order-status` | 주문 상태변경 (취소접수·클레임) |
| `POST /v3/sb/cs/answer` | 문의 답변 저장 |
| `GET·POST /v3/sb/category` | 마이카테고리 |
| `GET /v3/sb/product-info-notice/:noticeType` | 상품정보제공고시 |

### ② 「upsert 묶음 키를 모른다」가 틀렸다 — `products` 가 맞다

★★ **오류 문장이 거짓말을 한다** ★★

```
[상품 목록] 필수 입력값입니다.
```

이 말은 「목록이 없다」가 아니다. **줄 속 필수 칸이 하나라도 모자라면 똑같이 이 말을 한다.**
그래서 키 이름을 23개나 헛짚었다. 어느 칸이 모자란지 **한 마디도 안 알려준다.**

증명 — 샌드박스 `GET /v3/sb/product` 가 돌려준 표본 객체를 **그대로** 되돌려 보냈다:

| 보낸 것 | 응답 |
|---|---|
| `{products:[{customProductCode, productSupplyStatusCode}]}` | `400 [상품 목록] 필수 입력값입니다.` |
| `{products:[ …표본 29칸 그대로… ]}` | **`200 status=true`** |

### ★ 필수 칸 16개 (한 칸씩 빼 보며 가려냈다) ★

```jsonc
POST /v3/sb/product/upsert
{ "products": [ {
    "productName":              "샘플상품",
    "customProductCode":        "MALL-PRD-001",
    "productDivisionCode":      "CONSIGN",
    "myCategoryCodeL":          "01",
    "myCategoryCodeM":          "0101",
    "myCategoryCodeS":          "010101",
    "manufacturerName":         "샘플 제조사",
    "originName":               "KR",
    "productTargetCode":        "UNISEX",
    "productSupplyStatusCode":  "IN_SUPPLY",
    "deliveryCostCode":         "FREE",
    "taxCode":                  "TAXABLE",
    "costPrice":                15000,
    "sellingPrice":             29900,
    "consumerPrice":            39900,
    "productDetailDescription": "샘플 상품 상세설명"
} ] }
```

빼도 되는 칸 11개 — `productCertifications` · `attributeInfo` · **`optionInfo`** ·
`imageInfo` · `productCode` · `packagingExceptYn` · `seasonCode` · `salesRegionCode` ·
`deliveryCost` · `managementCostPrice` · `addProductGroupId`

> ★ **`optionInfo` 가 필수가 아니다** ★ 그래서 `optionEditCode: MODIFIABLE` 함정을
> 계속 피할 수 있다. 상태만 바꿀 때 옵션을 건드릴 이유가 없다.

### 그래서 재고송신은 「읽고 나서 보낸다」

`productDetailDescription` 이 **필수**라 「상태 한 칸만 보내는 부분수정」이
샌드박스에서는 **안 통한다.** 그러니 보낼 품목을 **먼저 한 번 읽어** 16칸을 채운다 —
70건이면 `GET` 70번, TPS 10 에 **9초**다. 할 만하다.

> ★ 다만 PDF 는 「필드 누락/`null` 은 컬럼 미수정」이라고 적었다 ★
> **샌드박스 검사기가 운영계보다 엄할 수 있다.** 어느 쪽이 맞는지는 3단계에서
> 두 건으로 확인한다 — 먼저 두 칸만 보내 보고, 400 이면 16칸으로 보낸다.

### 사방넷이 내 말을 확인해 줬다 — 샌드박스는 값의 증거가 아니다

개발자센터 가이드 원문:

> 「API 응답은 실제 계정 데이터가 아닌 **미리 정의된 고정 응답**이므로,
> **응답 데이터의 값이 아닌 요청/응답 구조와 인증 흐름을 검증하는 용도로** 사용하세요.」

2-F 에 적어 둔 「샌드박스 성공은 증거가 아니다」가 공식 안내와 같다.
그리고 샌드박스 `GET /v3/sb/product` 는 **어떤 코드를 물어도** `MALL-PRD-001`
「샘플상품」을 돌려준다.

### 개발자센터 — 들어가는 길

| | |
|---|---|
| 로그인 | **https://developer.sabangnet.co.kr/auth/login** — 아이디·비밀번호 (구글 아님) |
| 문서 | `/docs/` — **로그인해야 열린다** (로그인 화면으로 넘어간다) |
| 가이드 | `/guide` — **로그인 없이 열린다** |
| 가입 | **초대 기반.** 사방넷 홈페이지 **[마이페이지 > 연동관리]** 에서 최초 개발자에게 초대 메일 발송 → 그 링크로 가입 → 최초 가입자가 **오너**, 오너가 팀원 추가 초대 |
| 앱 만들기·인증키·IP | **개발자센터 안**이다 (가이드 Step 01). 「관리자 콘솔에서 한다」고 적어 뒀던 것은 틀렸다 |
| 심사 | **앱(App)은 심사 생략** — 샌드박스 시험 끝나면 즉시 라이브 전환 |

---

## 2-H. 개발자센터 공식 문서 — 실물 (2026-10-12)

사장님이 크롬에 개발자센터를 로그인해 띄워 주셔서 `/docs/` 를 읽었다.
**짐작으로 23번 헛짚었던 것이 여기 다 적혀 있었다.**

> 문서 주소: `https://developer.sabangnet.co.kr/docs/sabangnet-api/`
> **샘플코드(공개 깃허브)**: https://github.com/sabangnet-api/sabangnet-api

### 엔드포인트 문서 쪽 (주문관리 API)

| 쪽 | 경로 |
|---|---|
| `get-product-1` | `GET /v3/sb/product` |
| **`upsert-product-list-1`** | **`POST /v3/sb/product/upsert`** |
| **`update-malls-product-1`** | **`POST /v3/sb/channels-product`** ← 몰별 |
| `get-sku-1` | `GET /v3/sb/sku` |
| **`search-orders-1`** | **`POST /v3/sb/order`** |
| `modify-order-1` · `change-order-status-1` | 주문보정 · 주문 상태변경 |
| `save-way-bill-1` | `POST /v3/sb/waybill` |
| `search-claims-1` · `search-cs-info-1` · `save-cs-answer-1` | 클레임 · 문의 · 답변 |
| `save-additional-product-list-1` · `get-all-my-categories-1` · `get-product-info-notice-1` | |

---

### ★ 주문 수집 `POST /v3/sb/order` — 빠진 필수 칸이 셋이었다

```jsonc
{
  "dateSearchCondition": 2,        // 2=주문일 · 미지정이면 수집일. 1 배송희망일 · 7 출고완료일 · 10 송장등록일 …
  "startDate": "20261011",         // yyyyMMdd 또는 yyyyMMddHHmmss (00:00:00 보정)
  "endDate":   "20261012",         // (23:59:59 보정)
  "shopCodeList": ["shop0055"],
  "orderStatusList": ["NEW_ORDER","ORDER_CONFIRM"],
  "updateOrderStsYn": "N",         // ★ 몸통에 싣는다 (쿼리가 아니다)
  "responseItems": ["SB_ORD_NO"],  // ★ REQUIRED — 받을 필드를 직접 나열
  "page": 1,                       // ★ REQUIRED · >= 1   ← 0 이 아니다
  "perPage": 100                   // ★ REQUIRED · >= 50 이고 <= 1000
}
```

> **`responseItems`·`page`·`perPage` 셋이 필수다.** 그걸 몰라 열한 가지 몸통이 전부
> 400 이었고, 오류는 「[상품 목록] 필수 입력값입니다」 꼴로 **부모만 탓했다.**

★★ 운영에 더 중요한 두 가지 ★★

| | |
|---|---|
| **확정된 주문만 조회된다** | 「확정되지 않은 신규주문은 조회 결과에 포함되지 않으므로, 조회 결과가 0건인 경우 대상 주문의 확정 여부를 먼저 확인」 → **0건을 「주문이 없다」로 읽으면 안 된다.** 자동 확정으로 바꾸려면 사방넷 고객센터 문의 |
| **조회기간이 `responseItems` 에 달렸다** | `ETC_FLD_*` 를 **하나라도** 넣으면 **60일**, 안 넣으면 **180일**. 모르고 6개월 걸면 400 |

주문상태 18종: `NEW_ORDER` → `ORDER_CONFIRM` → `DELIVERY_WAITING` → `DELIVERY_COMPLETED` ·
`DELIVERY_PENDING`(배송보류, 희망배송일 필요) · 취소 `CANCEL_RECEIPT`→`CANCEL_COMPLETED` ·
교환 `EXCHANGE_RECEIPT`→`EXCHANGE_COMPLETED`(+회수/발송 준비·완료) ·
반품 `RETURN_RECEIPT`→`RETURN_COMPLETED`(+회수 준비·완료) · `DISCARD`.

`responseItems` 100여 개 중 우리에게 쓸 것 — `SB_ORD_NO` · `SHOP_ORD_NO` · `SHOP_NM` ·
**`SHOP_LOGIN_ID`**(법인/개인 구분이 여기 있을 수 있다) · `CUSTOM_PRD_CD` · `SB_SKU_CD` ·
`SKU_CD` · `ORD_CNT` · `EA` · `PAY_TOT_AMT` · `CT_SALE_COST` · `SHOP_SUPPLY_UNIT_PRICE` ·
`RECEIVER_NM/TEL/CEL/ADDR/ZIPCODE` · `DELIVERY_MSG` · `ETC_MSG` · `ORDER_DT` ·
`WAYBILL_NO` · `PCSCP_CD` · **`SET_DIV_CD`·`SET_SPRT_DIV_CD`**(세트구분·세트분리주문구분).

---

### ★★ 몰별이 된다 — `POST /v3/sb/channels-product` ★★

> 「쇼핑몰별 상품정보(판매가, 상품명, 상세설명, 재고비율, 인증정보 등)를 등록 및 수정」
> 관련메뉴: 사방넷 > 상품관리 > **판매채널별 상품관리**

```jsonc
{ "products": [ {
    "shopCode":                  "shop0001",        // ★ 몰마다 한 줄
    "customProductCode":         "PRD001",
    "salePrice":                 15000,             // ★ 몰별 판매가
    "productName":               "반팔티셔츠",       // ★ 몰별 상품명
    "productDetailDescription":  "면 100% 반팔티셔츠", // ★★ 몰별 상세설명
    "shopMallStockRate":         50,                // ★★★ 몰별 «재고비율»
    "shopMallShippingPolicyId":  "B0000001",
    "productAttributeClassificationCode": "001",
    "productAuthorizationNumber": "CB1234567", "authorizationNumberIssueDate": 20260101,
    "authorizationDate": 20260101, "authorizationExpiryDateFrom": 20260101,
    "authorizationExpiryDateTo": 20261231,
    "authorizationOrganizationName": "한국인증기관", "authorizationSphereName": "품질인증"
} ] }
```

응답 `200` 전체성공 / **`206` 부분성공** / 400 / 500 + `results[]` 건별.

> **2-F 의 「몰별은 안 된다」는 완전히 틀렸다.** 몰별 판매가·상품명·상세설명이 다 된다.
>
> ★ `shopMallStockRate` 가 뜻밖의 수확이다 ★ 재고를 **몰마다 비율로 나눠** 내보낼 수 있다.
> 「재고 3개가 14개 몰에 3개씩」 문제에 켜고/끄기보다 나은 수가 될 수 있다 —
> 단 우리는 `stockUseYn="N"`(재고관리 안 씀)이라 적용되는지는 떠 봐야 안다.

---

### 상품 등록·수정 `POST /v3/sb/product/upsert` — 필수 16개가 맞았다

공식 문서의 `required` 표시가 **2-G 에서 샌드박스로 가려낸 16개와 같다**
(`products` · `productName` · `customProductCode` · `productDivisionCode` ·
`myCategoryCodeL/M/S` …).

> ~~그러니 「상태 한 칸만 보내는 부분수정」은 안 된다.~~  **← 2-J 에서 취소. 된다** PDF 의 「필드 누락은 컬럼
> 미수정」은 **선택 필드에만** 해당한다. 필수 16개는 늘 실어야 한다.
> → 재고송신은 **보낼 품목을 먼저 `GET` 해서** 16칸을 채워 보낸다.
> `optionInfo` 는 선택이라 빼면 되고, 그래서 `MODIFIABLE` 함정을 계속 피한다.

### SKU — 조회만 있다

`GET /v3/sb/sku?skuCode=SKU-001` — **`skuCode` 가 필수 쿼리다.**
등록·수정 API 는 목록에 없다. 우리 상품은 `optionInfo.options[].skuCode` 가
**전부 `null`** 이라 SKU 를 안 쓰고 있고, 그래서 **이 조회를 부를 열쇠조차 없다.**
SKU 세팅을 하려면 `product/upsert` 의 `optionInfo` 로 넣어야 하고,
그 길은 `optionEditCode` 함정 위에 있다.

---

## 2-I. 운영계 시크릿 재발급 확인 (2026-10-12)

| | |
|---|---|
| 새 시크릿 | 운영계 토큰 발급 **HTTP 200**(JWT 819자) · 상품 읽기도 됨 |
| **옛 시크릿** | **HTTP 401 「유효하지 않은 시크릿 서명입니다」 — 죽었다** |

노출됐던 값은 더 못 쓴다.

> ★ **새것이 되는 것만 보면 모자란다** ★
> 그것만으로는 「옛것도 아직 살아 있는」 경우를 못 가린다. 재발급이 실제로 먹었는지는
> **옛것을 일부러 써 보고 거부당하는 것으로** 확인한다.
> [[check-the-result-not-just-the-cause]]

### 다음 교체 때는 대화에 붙이지 않는다

`_sabang_relay/sabang_config.php` 의 `secretProduction` 칸에 직접 넣으면 된다
(그 파일은 `.gitignore` 에 있다). 내가 값을 안 보고도 쓴다.

### ★ 치환으로 시크릿을 넣다 파일을 깨뜨렸다 ★

bcrypt 해시는 `$2a$10$…` 로 시작한다. 그것을 `String.replace` 의 **치환 문자열**에
그대로 썼더니 —

```js
s.replace(/('secretProduction' => ')[^']*(')/, "$1" + 시크릿 + "$2")
```

**치환 문자열 안의 `$2` 가 캡처 그룹으로 먹혀** 줄이 두 벌로 늘어났고 PHP 가 깨졌다:

```
Parse Error : syntax error, unexpected 'a' (T_STRING), expecting ']' on line 46
```

`_relay_lint.mjs` 가 올라가기 전에 잡아 줬다. 함수 치환으로 고쳤다 —

```js
s.replace(/('secretProduction' => ')[^']*(')/, (_all, a, b) => a + 시크릿 + b)
```

> **bcrypt 해시를 치환값으로 쓸 때는 함수 치환을 쓴다.** 그 값에는 `$` 가 셋 있다.
> 같은 함정이 `sed` 에도 있다(`&`·`\1`).

### ★ 셸에 긴 글을 넘길 때 ★

이 2-I 를 처음 적을 때 `node -e "…"` 안에 백틱과 `$(` 가 들어 있어서
**셸이 먼저 먹었다.** 코드 조각이 통째로 빈칸이 된 문서가 커밋됐고, 다시 썼다.

> 한글·백틱·`$` 가 섞인 글은 **셸을 거치지 않고** 파일로 먼저 쓰고 붙인다.
> [[bash-korean-identifiers-break]] 와 같은 자리다.

---

## 2-J. ★★ 부분수정이 된다 — 운영계 실측 (2026-10-12) ★★

> 사장님 결정: 「값이 안 바뀌는 시험 1건」. 이미 `IN_SUPPLY` 인 품목에
> `IN_SUPPLY` 를 보냈다. 몰에 보이는 값은 하나도 안 바뀌는 시험이다.

```jsonc
POST /v3/sb/product/upsert          // 운영계
{ "products": [ { "customProductCode": "JPCR00002",
                  "productSupplyStatusCode": "IN_SUPPLY" } ] }   // ← 두 칸뿐
```

```json
HTTP 200
{ "mode": "U", "status": true, "errorMessage": null,
  "productCode": "106268", "customProductCode": "JPCR00002" }
```

**보내기 전후를 37칸 전부 견줬다 — 하나도 안 바뀌었다** (상세설명 14,853자 포함).

### 무엇이 풀렸나

| | |
|---|---|
| **필수 16칸은 «등록(I)»에만 걸린다** | 문서의 `required` 표시는 생성 기준이다. 수정(U)은 **코드 + 바꿀 칸**이면 된다 |
| **보낼 대상이 34건 → 70건** | `productTargetCode`·`myCategoryCodeS` 가 비어 있어도 상관없다 |
| **훨씬 안전해졌다** | 16칸 왕복은 상세설명 **14,853자**를 포함해 15칸을 **다시 써야** 했다. 두 칸만 보내면 **건드릴 것이 없다** |
| `mode` 가 운영계에서 쓸 만하다 | 수정은 `U`, 등록은 `I`. 샌드박스는 늘 `I` 였다 |

> ★ 2-G 의 「상태 한 칸만 보내는 부분수정은 안 된다」를 **취소한다.**
> 그 결론은 **샌드박스만 보고** 낸 것이었다. 샌드박스는 늘 등록처럼 검사하므로
> 그 질문에 답할 수 없었고, 나는 그걸 알면서도 「안 된다」로 적었다.
>
> **운영계가 답했다. 되는 쪽이다.**

---

## 2-K. ★ 주문 수집 실측 — 엑셀 808건을 그대로 덮는다 (2026-10-12) ★

> 사장님: "주문 수집부터 진행해줘 그런데 일단 병행 테스트라
>          우리가 주문 수집한것이 내일 오전에 다시 수집 되게 가능할까?"

정답지: `W:\공유폴더\팩투유_사원\사방넷주문내역\202601012*.xlsx` — 오늘 세 회차
(08:21 · 13:15 · 15:38), 25칸짜리 「주문서확인처리_택배 발주양식」. 합 808건.

### ★★ 날짜 기준을 틀리면 절반을 못 본다 ★★

| 요청 | 받은 줄 | 엑셀 808건 가운데 |
|---|---:|---|
| `dateSearchCondition: 2`(주문일) 10/12 | 271 | 271 |
| 〃 10/11~12 | 446 | 446 |
| 〃 10/10~12 | 576 | 576 |
| **미지정(수집일) 10/12** | **808** | **808 — 다 덮는다** |

**회차 엑셀은 「수집일」로 뽑힌다.** 주문일로 잡으면 전날 저녁에 들어온 주문이
빠진다 — 1차 엑셀(08:21)이 담는 것이 바로 그것이다.

> `dateSearchCondition` 을 **안 보내는 것**이 수집일 기준이다(문서: 「미지정 또는
> 유효하지 않은 값일 경우 수집일 기준」). 병행 비교는 반드시 이쪽으로 한다.

### 칸마다 — 271건으로 맞댄 결과

| 엑셀 칸 | API | 맞음 |
|---|---|---|
| 쇼핑몰 · 주문번호_쇼핑몰 · 구매자 · 받는분 | `SHOP_NM` · `SHOP_ORD_NO` · `CONSUMER_NM` · `RECEIVER_NM` | **271/271** |
| 내품수량 · 전화번호 · 핸드폰 · 수취인주소 | `ORD_CNT` · `RECEIVER_TEL` · `RECEIVER_CEL` · `RECEIVER_ADDR` | **271/271** |
| 배송메세지 | `DELIVERY_MSG` | **85/85** (나머지는 양쪽 다 빔) |
| 판매가 · 결제금액 · 배송비 | `CT_SALE_COST` · `PAY_TOT_AMT` · `CT_DELIVERY_COST` | **271/271** |
| 자체삼품코드(이카운트) | `CUSTOM_PRD_CD` | **271/271** |
| 우편번호 | `RECEIVER_ZIPCODE` | **같다** — 엑셀이 `140-55`, API 가 `14055`. 하이픈만 다르다 |
| 택배사 · 송장번호 | `PCSCP_CD` · `WAYBILL_NO` | 엑셀은 **비어 있고** API 에는 있다 — **API 가 더 최신이다** |

> 택배사·송장이 엑셀에 없는 것은 어긋남이 아니다. 엑셀은 **주문 시점**에 뽑고
> API 는 **지금**을 보여 준다. 이미 송장이 붙은 뒤다.

### ★ 「법인/개인」을 가르는 칸을 찾았다 ★

엑셀 1열 「법인/개인」(`법인배민상회`·`개인스토어팜` …)은 **몰 하나가 아니라
«몰 계정»**이다. 같은 `SHOP_ID` 에 법인·개인이 함께 있다:

| 엑셀 「법인/개인」 | `SHOP_ID` | `SHOP_NM` | **`SHOP_LOGIN_ID`** | `ACNT_REGS_SRNO` |
|---|---|---|---|---|
| 법인스토어팜 | `shop0055` | 스마트스토어 | **`ncp_1nloke_01`** | 254314 |
| **개인**스토어팜 | `shop0055` | 스마트스토어 | **`ncp_1oo61j_01`** | 5002899 |
| 법인배민상회 | shop0546 | 배민상회 | `PACK2YOU` | 5002877 |
| 법인자사몰 | shop0298 | Cafe24(신) 유튜브쇼핑 | `pack2u` | 251697 |
| 법인쿠팡 | shop0075 | 쿠팡 | `jupack2u` | 251164 |
| 법인지마켓 | shop0068 | ESM지마켓 | `jupack2u` | 253096 |

> **`SHOP_ID` 만으로는 못 가른다.** 스마트스토어가 법인·개인 둘 다 `shop0055` 다.
> 가르는 것은 **`SHOP_LOGIN_ID`** 또는 `ACNT_REGS_SRNO` 다.
> `SHOP_LOGIN_ID` 도 쿠팡·지마켓이 둘 다 `jupack2u` 라 **혼자서는 모자라다** —
> **`SHOP_ID` + `SHOP_LOGIN_ID`** 짝이 열쇠고, `ACNT_REGS_SRNO` 는 그 짝의 번호다.
>
> 그 짝 → 「법인/개인+몰」 표는 오늘 자료에서 그대로 뽑았다. 손으로 적을 것이 없다.

### ★ 아직 증명 못 한 것 — 「내일 다시 수집되나」 ★

`updateOrderStsYn: "N"` 으로만 불렀고 **상태는 하나도 안 바뀌었다.** 그런데
그것이 증거가 못 된다 — **오늘 이 시각에는 신규주문(`NEW_ORDER`)이 0건**이었다
(전부 `DELIVERY_WAITING` 49 · `ORDER_CONFIRM` 1). 바뀔 것이 없었던 것이다.

> **「안 바뀌었다」와 「바뀔 것이 없었다」는 다르다.**
> 신규주문이 있는 때 — 아침 수집 직후, 주문서확인처리 **전** — 에 다시 재야 한다.
> 그때 `NEW_ORDER` 를 N 으로 읽고 **여전히 `NEW_ORDER`** 인지 본다.

### ★ 몰 계정 20개 — 「법인/개인」은 계정번호로 가른다

엑셀 1열 「법인/개인」(`법인배민상회`·`개인스토어팜` …)은 **몰이 아니라 몰 «계정»**이다.
API 에서 그것을 가르는 열쇠는 **`ACNT_REGS_SRNO`(계정등록순번)** 하나다.

왜 다른 칸으로는 안 되나 —

| | |
|---|---|
| `SHOP_ID` 로는 못 가른다 | 스마트스토어가 **법인·개인·인더 셋 다 `shop0055`** 다 |
| `SHOP_LOGIN_ID` 로도 못 가른다 | **`jupack2u` 하나가 쿠팡·지마켓·옥션 셋**에 걸린다 |

2026-10-12 회차 808건에서 계정 **19개**가 나왔다(표는 v2 `sql/119`~`121`).
스무 번째 `법인도매꾹` 은 그날 주문이 없어 안 나왔다.

### ★★ 개인11번가 = `bebe0001` 이다 (`bebe0004` 가 아니다) ★★

한 값에 주인이 둘이던 자리다:

| 어디 | 뭐라고 했나 |
|---|---|
| 2026-10-12 구두 | 개인11번가 → `bebe0004` |
| 이카운트 거래처 목록 | `bebe0001` = 대리발송-개인/**11번가** · `bebe0004` = 대리발송-개인/**옥션** |

**실물로 가렸다.** 그 계정(`5002949`)의 그날 주문 3건을 판매현황에서 찾으니
거래처명이 **「대리발송-개인/11번가」**(261012-1 회차)였다. 사방넷 쪽 증거도 같다 —
몰 이름이 `11번가`, 몰코드가 `shop0464`(옥션은 `shop0067`).

→ **`개인11번가` = `bebe0001`** · **`bebe0004` 는 「개인/옥션」**이다. 사장님 확인도 받았다.

> 짐작으로 넣지 않고 주문번호 16건을 뽑아 판매현황과 맞댄 뒤에 넣었다.
> 나머지 넷도 같은 방법으로 확인했다 — 법인옥션2.0 → 「법인/옥션」 ·
> 법인롯데온 → 「법인/롯데온」 · 인더지마켓 → 「대리발송-인더샵/지마켓」 ·
> 법인/알리 → 「법인/알리」.

### 곁가지 — 「수집일 기준」이 또 보였다

그 16건의 주문일시는 **10-08 ~ 10-12 로 닷새에 걸쳐** 있었는데 전부 오늘 회차
엑셀에 들어 있다. 주문일 기준으로 잡았으면 **16건 중 13건이 빠졌다.**

### 옵션값(단품코드) 매핑 — 이미 돼 있다. 2,515줄에 1건 (2026-10-12 실측)

사방넷 「단품코드매핑관리」는 **쇼핑몰 옵션명 ↔ 사방넷 단품**을 잇는 작업이다.
그것이 돼 있어야 주문에 `CUSTOM_PRD_CD`(= 우리 이카운트 품목코드)가 붙는다.

나흘치(10/06·07·08·12) **2,515줄**을 떠서 셌다:

| 칸 | 차 있는 비율 | |
|---|---:|---|
| **`CUSTOM_PRD_CD`** | **100.0%** (2,514/2,515) | **매핑은 사실상 다 돼 있다** |
| `CM_SKU_NM` 확정단품명 | 99.9% | 사방넷이 이어 준 우리 단품명 (대부분 「단품」) |
| `SB_PRD_CD` · `SB_SKU_CD` | 100% · 99.9% | 상품번호 · 단품번호 |
| `BARCODE` · `SET_DIV_CD` · `EA` | 99.9% | |
| `CT_SKU_NM` 수집단품명 | **66.6%** | 쇼핑몰이 보낸 옵션 글자. **비어도 된다** — 옵션 없는 단품 상품이 많다 |
| `SKU_CD` · `UPD_CT_SKU_NM` | **0%** | 우리는 SKU 를 안 쓴다 |

매핑이 된 줄은 이렇게 생겼다 — 쇼핑몰 말이 우리 코드로 이어진다:

```
수집단품명 「12184:1500개」   → 확정단품명 「단품」 · 단품번호 0001 · JH12180003
수집단품명 「1개 1000개입」    → 확정단품명 「단품」 · 단품번호 0001 · HRGL00004
```

### ★ 빠진 1건은 상품이 아니다 ★

```
2167763466  Cafe24(신) 유튜브쇼핑  「도서산간/제주 택배비」
   수집단품명 「」 · 확정단품명 「」 · 상품번호 없음 · 쇼핑몰상품코드 2567
```

자사몰이 **배송비를 주문 한 줄로** 보낸 것이다. 매핑할 상품이 아니다 —
이카운트에서도 `OUT00001`·`OUT000011` **비용 코드**로 다루고, v2 판매현황이
이미 그 줄을 따로 만든다. `products` 표에 그 코드가 없는 것도 그 까닭이다.

> 그러니 **「매핑을 해야 한다」가 아니다. 이미 돼 있다.**
> 사람이 사방넷에서 새 상품마다 이어 두고 있어서다.

### 진짜 위험은 「지금」이 아니라 「다음」이다

새 상품·새 옵션이 생기면 **사방넷에서 매핑하기 전까지 그 주문은 코드가 안 붙는다.**
그 줄은 판매입력에 못 들어가고, 아무도 모른 채 회차에서 빠진다.

> 그래서 필요한 것은 매핑 작업이 아니라 **매핑 안 된 주문을 그 자리에서 알아채는
> 장치**다. `CUSTOM_PRD_CD` 가 빈 줄을 세어 알리면 된다 —
> 어댑터(`lib/sabang-order-api.ts` 의 `줄바꾸기`)가 이미 그 줄을 막고 까닭을 남긴다.
> 막은 건수를 회차마다 올리기만 하면 된다. **0 이 아니면 사람이 봐야 한다.**

### ★ 엔드포인트가 다섯 더 있었다 — 사이트맵에서 (2026-10-12)

문서 쪽 목록을 사이드바로 훑었을 때 열세 가지만 봤는데, **사이트맵은 로그인 없이
열린다** — `https://developer.sabangnet.co.kr/docs/sitemap.xml`. 거기 **스무 쪽**이 있다.

내가 못 봤던 것:

| 쪽 | 짐작 |
|---|---|
| **`upsert-msku-1`** | **MSKU 등록·수정** — 「단품코드 매핑」이 여기일 가능성이 크다 |
| `save-my-categories-1` | 마이카테고리 저장 |
| `get-my-categories-by-code-1` | 마이카테고리 코드로 조회 |
| `get-standard-categories-1` · `get-standard-category-by-code-1` | **표준 카테고리** |

> ★ 아직 «짐작»이다 ★ `/docs/` 는 로그인해야 열리고 세션이 만료됐다.
> 이름만 보고 「된다」고 적지 않는다 — 이 작업에서 문서를 그렇게 믿었다가
> 다섯 번 틀렸다. **열어 보고 적는다.**

> 사이드바를 훑는 것보다 **사이트맵을 먼저 보는 것**이 빠르고 빠뜨리지 않는다.

### 단품코드 매핑은 ★자동이 안 된다★ — `upsert-msku` 는 다른 것이다 (2026-10-12)

`POST /v3/sb/sku/upsert` 를 읽었다. 관련메뉴가 **「상품관리 > SKU상품관리」**다 —
**단품 마스터를 등록·수정**하는 것이지, 「상품관리 > **단품코드매핑관리**」에서 하는
**쇼핑몰 옵션명 ↔ 사방넷 단품 잇기**가 아니다.

문서 스무 쪽 어디에도 **매핑 API 가 없다.** (사이트맵 전체를 2026-10-13 에 다시 확인했다.)

> ~~매핑은 사방넷 화면에서 사람이 한다.~~ **← 2026-10-13 취소. 아래를 볼 것.**

> 덤으로 알게 된 것 — SKU upsert 안내에 **「재고(quantity)는 API 를 통해 직접
> 등록·수정할 수 없습니다」**가 적혀 있다. 재고송신을 수량이 아니라 **상태**로
> 가기로 한 판단이 여기서도 맞았다.
>
> 그리고 `groupCodes` 로 SKU-그룹 매핑은 된다(`null` 이면 그대로, 빈 배열이면 전체 해제).
> `""` 와 `null` 을 가르는 그 버릇이 여기도 있다.

나머지 넷도 이름이 분명해졌다 — `save-my-categories` · `get-my-categories-by-code` ·
`get-standard-categories` · `get-standard-category-by-code` 는 **카테고리** 쪽이다.
새 품목을 사방넷에 올릴 때 쓸 것이지 매핑과는 무관하다.

### ★★ 사방넷주문번호는 이미 세트분리까지 간다 ★★ (2026-10-12)

> 앞서 「판매현황에 사방넷주문번호가 없다」고 적었다. **틀렸다.**
> 순수 열 자리 숫자(`^\d{10}$`)로만 찾아서 0줄이 나온 것이다.
> 실제로는 **「받는분/주문번호」 꼴**로 들어 있다.

### 길 — 이미 끝까지 뚫려 있다

```
사방넷 주문          주문번호_사방넷  2167316031
   ↓  판매입력 만들 때 (lib/sabang-orders.ts 의 판매입력())
             orderer = `${받는분}/${sabang_no}`      ←  ★ 여기서 실린다
   ↓  이카운트
판매현황            「주문자명(사방넷)」 = 홍길동/2167316031
   ↓  세트분리 (core.js)
   사방넷주문번호 = ssSplit2(주문자명(사방넷), '/')[1]              (core.js:980)
   고유ID        = 사방넷주문번호 || ssMakeOrderId(…)              (core.js:1021)
   ↓
세트분리 출력        「사방넷주문번호」 칸                           (core.js:64·181)
   ↓
운송장 올리기        sbOrderNo
```

사방넷 건이 아니면(업체발주·전화주문) 그 칸이 비고, 그때는 우리가 만든
고유ID(`p0922000047` 꼴)를 쓴다 — [[unique-id-is-a-daily-serial]] 그대로다.

### 실측 — 2026-10-12 네 회차

| 회차 | 자료줄 | 번호 든 줄 | **그날 수집분과 맞음** | 번호 없는 줄 |
|---|---:|---:|---:|---:|
| A261012-2 | 541 | 538 | **538 (100%)** | 3 |
| A261012-3 | 427 | 190 | **190 (100%)** | 237 |
| A261012-4 | 164 | 79 | **79 (100%)** | 85 |
| A261012-1 | 71 | 38 | 0 | 33 |

538 + 190 + 79 = **807**. 그날 사방넷 주문이 808건이고 그중 1건은 「도서산간/제주
택배비」(상품 아님)이니 **딱 맞는다.**

1차가 0인 것은 어긋남이 아니다 — 그 회차의 입력은 **10/08 자료**였다(판매현황 머리에
`2026/10/08 ~ 2026/10/08`). 그날 번호와 맞을 리가 없다.

「번호 없는 줄」은 사방넷 건이 아닌 것 — 업체발주·전화주문이다.

> ★ `/` 를 표시로 못 쓰는 까닭이 이것이다 ★ [[memo-shipto-marker]] 에
> 「`/` 는 이미 쓰여서 표시로 못 쓴다」고 적어 뒀는데, **바로 이 자리**다.
> 「주문자명(사방넷)」이 `받는분/주문번호` 라서 `/` 가 이미 주인이 있다.

### 그래서 할 일은 「길 내기」가 아니다

길은 있다. 주문 수집을 붙일 때 지켜야 할 것은 **그 길을 그대로 쓰는 것**뿐이다 —
`판매입력()` 이 만드는 `orderer` 를 손대지 않으면 세트분리까지 저절로 이어진다.

> **내가 틀린 자리를 적어 둔다.** 「없다」를 정규식 하나로 단정했다.
> 자료를 눈으로 한 줄만 봤으면 바로 보였다 — `홍길동/2167316031`.
> [[dont-overwrite-what-you-couldnt-read]] 와 같은 자리다: **못 찾은 것과 없는 것은 다르다.**

### ★★ 자동매핑은 사방넷 «화면»에 있다 — 그리고 위험이 반대쪽이다 ★★ (2026-10-13)

> 앞서 「매핑은 사방넷 화면에서 **사람이** 한다」고 적었다. **틀렸다.**
> 사장님 확인 — **사방넷 화면에 자동매핑 기능이 있다.**
> 내가 본 것은 API 문서뿐이었는데 화면 이야기로 넘겨 적었다.
> **API 에 매핑이 없다**는 것(사이트맵 20쪽 전부 확인)과
> **화면에 자동매핑이 없다**는 것은 전혀 다른 말이다.

### 그래서 위험의 방향이 뒤집힌다

| | 전에 생각한 것 | 실제 |
|---|---|---|
| 걱정한 것 | 매핑이 안 돼 코드가 **비어** 주문이 조용히 빠진다 | **거의 없다 — 76,694줄 중 28줄(0.037%)** |
| 진짜 위험 | — | **자동매핑이 «틀리게» 이어 준다** |

> ★ 어댑터는 **빈 코드만** 막는다 ★ `sabang-order-api.ts` 의 `줄바꾸기` 도,
> 엑셀 쪽 `sabang-orders.ts:88` 도 「코드가 비었으면 그 줄을 안 넣는다」이다.
> **틀린 코드는 차 있으니 안 막힌다.** 그대로 통과해 **엉뚱한 물건이 나간다.**

### 실측 — 2026년 주문 엑셀 275개 · 76,694줄 (2026-10-13)

`tools/사방넷_자동매핑_검증.mjs` · 열쇠는 **몰 + 쇼핑몰코드 + 상품명/수량**

| | |
|---|---|
| 열쇠 가짓수 | 14,043 |
| 코드가 빈 줄 | **28 (0.037%)** |
| 한 열쇠가 두 코드 이상 | 49가지 · 357줄 (0.47%) |
| ├ **날짜가 겹침** = 같은 때에 두 코드 | **18가지 · 230줄 (0.30%)** |
| └ 날짜가 갈림 = 매핑을 바꾼 것(정상) | 31가지 · 127줄 |

겹친 것의 생김새 — **많은 쪽 + 1~2줄짜리 소수**가 전형이다. 전환이 아니라 **튄 것**이다.

```
쿠팡 7553751262  「탕용기 JH 미니탕용기 소 200세트 …」
   JHNMSET0001  20줄  03/13~06/04
   MATYG0050     2줄  04/09~04/13     ← JH 인데 MA 가 붙었다

스마트스토어 10284236707  「비장탄 … 옵션1: 소 / 옵션2: 10kg」
   HRCHA000011  20줄  01/05~07/20
   UNITED-LANGSON 1줄  02/03~02/03    ← 코드 «꼴»부터 다르다
```

`UNITED-LANGSON` 은 세 열쇠에 1~2줄씩 끼어 있다. 비장탄 숯은
`HRCHA00002`·`HRCHA00003`·`HRCHA000011` 이 옵션(대/소 · 7.5kg/10kg)을
넘나들며 섞였다.

> **다만 18가지 전부가 「틀림」은 아니다.** 쿠팡 `6570335088` 은
> `TYSL00061`(01/02~05/27) → `BWSCJW0009`(05/18~07/30) 로,
> 겹친 열흘은 **전환기**로 보인다. 소수가 1~2줄로 흩어진 것만 분명한 사고다
> — 눈으로 센 것으로 **11~13가지**다. 숫자를 더 좁히려면 사람이 봐야 한다.

### 그래서 할 일 — 「빈 칸」이 아니라 「바뀐 칸」을 막는다

지금 장치는 반대쪽을 지키고 있다. 필요한 것은 **배운 짝**이다.

1. **(몰 · 쇼핑몰코드 · 상품명) → 품목코드** 를 쌓는다. `item_aliases`(1,048줄)와 같은 방식이다.
2. 들어온 코드가 **지난번과 다르면** 그 줄을 세운다. 「처음 보는 짝」도 세운다.
3. 사람이 한 번 고르면 그때부터 자동. 바뀐 게 맞으면 「바꿈」으로 적고 넘어간다.

> 이것은 사방넷 매핑을 **대신하는 것이 아니다.** 사방넷은 사방넷대로 두고,
> **우리 쪽에 검문을 하나 더 두는 것**이다. 매핑 API 가 없으니 돌려줄 수도 없다.

### 덧 — 옵션 칸으로 가르면 헛경보가 난다

처음에 열쇠를 **(몰 · 쇼핑몰코드 · 옵션)** 으로 잡았더니 **653가지**가 흔들린다고 나왔다.
엑셀의 「옵션」 칸은 사방넷 **확정단품명**이라 거의 늘 `단품 [1]` 이고,
**진짜 옵션은 「상품명/수량」 안에** 들어 있다
(`…골라담기 06_BW 195파이 중 검정`). 열쇠를 상품명으로 바꾸니 49가지가 됐다.

> **653 을 그대로 들고 갔으면 없는 사고를 열세 배로 불려 보고할 뻔했다.**
