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

`GET /v3/sb/order` 의 `shopCodeList` 에 넣을 값이다.

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

## 3. 아직 안 해 본 것
- [ ] `GET /v3/sb/order` — ★ `updateOrderStsYn:"N"` 없이 부르면 **신규주문이 주문확인으로 바뀐다**
- [ ] `GET /v3/sb/claim` · `GET /v3/sb/cs`
- [ ] `POST /v3/sb/product/upsert` 본문에 **재고 수량 필드**가 있는가 → 재고송신 가능 여부
- [ ] `waybill` 의 `results[]` 에 실패 사유 코드가 오는가
- [ ] 샌드박스 시크릿으로 토큰 발급 (`authMode=SANDBOX`)

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
