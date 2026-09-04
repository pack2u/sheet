/**
 * 택배 송장 바코드 파싱 — 롯데(12자리 mod7) · 공통 숫자 추출
 */

function _cs_digitsOnly_(raw) {
  return String(raw || "").replace(/[^0-9]/g, "");
}

/**
 * 롯데 12자리 체크섬.
 *
 * ★ 규칙 (롯데 API Portal「운송장 채번규칙」) ★
 *   총 12자리 = 앞 11자리 일련번호 + 마지막 1자리 체크digit
 *   체크digit = 앞 11자리를 **하나의 정수로 본 값** mod 7   (0~6)
 *   예) 3030-4040-5054 → 30304040505 mod 7 = 4
 *
 * ★ 2026-08-31 정정 ★
 *   종전 구현은 "자릿수의 **합** mod 7" 이었다. 규칙이 다르다.
 *   실제 라벨 9건으로 대조하니 종전 1/9, 정정 후 9/9 통과.
 *   안심번호 6건은 정정 후에도 전부 배제된다(0/6).
 *
 *   앞자리 제약(종전 `^2`)도 뺐다. 채번규칙에 그런 제약이 없고,
 *   롯데 문서 예제는 3 으로 시작한다. 우리 라벨이 2 로 시작하는 것은
 *   영업담당자에게 받은 **대역** 때문일 뿐이라 대역이 바뀌면 깨진다.
 */
function csValidateLotteChecksum_(inv12) {
  var s = _cs_digitsOnly_(inv12);
  if (!/^\d{12}$/.test(s)) return false;
  // 11자리는 2^53 안이라 Number 로도 되지만, 자릿수 순회가 정밀도 걱정이 없다.
  var m = 0;
  for (var i = 0; i < 11; i++) m = (m * 10 + (s.charCodeAt(i) - 48)) % 7;
  return m === (s.charCodeAt(11) - 48);
}

/**
 * 스캔 원문 → 택배사·송장번호
 * @return {{ ok:boolean, courier:string, invoice:string, digits:string, checksumOk:boolean, note:string, raw:string }}
 */
function csParseCourierBarcode(raw) {
  raw = String(raw || "").trim();
  if (!raw) {
    return { ok: false, error: "빈 값", raw: raw };
  }

  var cleaned = raw
    .replace(/^\][A-Za-z0-9]{2}/, "")  // AIM ]C1 등
    .replace(/\u001d/g, "");             // GS1 FNC1

  var digits = _cs_digitsOnly_(cleaned);
  var note = "";

  // ── 롯데 12자리 판정 ──────────────────────────────────
  // 원문이 딱 12자리인 경우와 부가데이터가 섞인 경우를 다르게 다룬다.
  // 체크섬은 7가지 중 하나를 맞히는 약한 검사라, 창을 밀며 훑을 때는
  // 1/7 확률로 엉뚱한 12자리가 통과한다. 실제로 이 테스트에서 걸렸다:
  //   "3123456789012" (CJ 13자리) → 앞 12자리가 우연히 체크섬 통과
  //   "0123258131494106"          → 어긋난 창 "325813149410" 이 먼저 통과
  // 그래서 창을 밀 때는 체크섬에 더해 대역(2로 시작)까지 요구한다.
  var pick = "", checksumOk = false;

  if (digits.length === 12) {
    // 원문이 정확히 12자리 — 체크섬만으로 판정한다.
    // 앞자리를 보지 않으므로 영업담당자가 새 대역(3xxx 등)을 줘도 그대로 동작한다.
    checksumOk = csValidateLotteChecksum_(digits);
    // 체크섬이 깨져도 우리 대역이면 롯데로 본다 — OCR 오독이 섞인 파손 송장 구제.
    if (checksumOk || digits.charAt(0) === "2") pick = digits;

  } else if (digits.length > 12) {
    // GS1 부가데이터 등이 붙었다. 창을 밀되 대역 제약을 함께 건다.
    // ★ 새 대역을 받으면 이 "2" 를 함께 넓혀야 한다 ★
    for (var off = 0; off + 12 <= digits.length; off++) {
      var slice = digits.substring(off, off + 12);
      if (slice.charAt(0) !== "2") continue;
      if (csValidateLotteChecksum_(slice)) { pick = slice; checksumOk = true; break; }
      if (!pick) pick = slice; // 체크섬 실패분은 후보로만 잡아두고 계속 찾는다
    }
  }

  if (pick) {
    if (pick !== digits) note = "12자리 추출";
    return {
      ok: true,
      courier: "lotte",
      invoice: pick,
      digits: pick,
      checksumOk: checksumOk,
      note: note,
      raw: raw
    };
  }

  // CJ(3/4/6), 로젠(8~9), 한진 등 — 10~14자리
  if (digits.length >= 10 && digits.length <= 14) {
    var courier = "unknown";
    if (/^[346]/.test(digits)) courier = "cj";
    else if (/^[89]/.test(digits)) courier = "logen";
    else if (/^[45]/.test(digits)) courier = "hanjin";
    return {
      ok: true,
      courier: courier,
      invoice: digits,
      digits: digits,
      checksumOk: true,
      note: "",
      raw: raw
    };
  }

  if (digits.length >= 8) {
    return {
      ok: true,
      courier: "unknown",
      invoice: digits,
      digits: digits,
      checksumOk: false,
      note: "짧은/비표준 번호",
      raw: raw
    };
  }

  return {
    ok: false,
    error: "송장번호를 추출하지 못했습니다.",
    digits: digits,
    raw: raw
  };
}

/** 진단 — 롯데 파싱·체크섬 샘플 (에디터/scan_test용) */
function csTestCourierBarcodeParse() {
  // ★ 실제 라벨에서 읽은 값을 쓴다 ★
  //   종전 샘플(212345678905 등)은 손으로 지어낸 번호라 채번규칙을 만족하지 않았다.
  //   틀린 구현과 틀린 샘플이 서로를 통과시켜 버그가 오래 숨어 있었다.
  var samples = [
    "258131494106",          // 실제 운송장 — 체크섬 통과
    "258131494106" + "0123", // GS1 부가데이터가 붙은 경우
    "]C1258131494106",       // AIM 식별자
    "2581-3149-4106",        // 하이픈 표기
    "0504-1889-0003",        // 안심번호 — 롯데로 잡히면 안 된다
    "3123456789012",         // CJ 대역
    "812345678901"           // 로젠 대역
  ];
  var out = [];
  for (var i = 0; i < samples.length; i++) {
    out.push({ sample: samples[i], result: csParseCourierBarcode(samples[i]) });
  }
  return { ok: true, tests: out };
}
