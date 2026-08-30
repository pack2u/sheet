/**
 * 택배 송장 바코드 파싱 — 롯데(12자리 mod7) · 공통 숫자 추출
 */

function _cs_digitsOnly_(raw) {
  return String(raw || "").replace(/[^0-9]/g, "");
}

/** 롯데 12자리 체크섬 (앞 11자리 합 mod 7 = 12번째) */
function csValidateLotteChecksum_(inv12) {
  var s = _cs_digitsOnly_(inv12);
  if (!/^2\d{11}$/.test(s)) return false;
  var sum = 0;
  for (var i = 0; i < 11; i++) sum += parseInt(s.charAt(i), 10);
  return (sum % 7) === parseInt(s.charAt(11), 10);
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

  // GS1/부가데이터 — 롯데 12자리(2로 시작) 슬라이스
  var lotteCandidates = [];
  if (/^2\d{11}$/.test(digits)) lotteCandidates.push(digits);
  if (digits.length > 12) {
    for (var off = 0; off <= digits.length - 12; off++) {
      var slice = digits.substring(off, off + 12);
      if (/^2\d{11}$/.test(slice)) lotteCandidates.push(slice);
    }
  }

  if (lotteCandidates.length) {
    var pick = lotteCandidates[0];
    for (var li = 0; li < lotteCandidates.length; li++) {
      if (csValidateLotteChecksum_(lotteCandidates[li])) {
        pick = lotteCandidates[li];
        break;
      }
    }
    if (pick !== digits) note = "12자리 추출";
    return {
      ok: true,
      courier: "lotte",
      invoice: pick,
      digits: pick,
      checksumOk: csValidateLotteChecksum_(pick),
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
  var samples = [
    "212345678905",
    "2123456789050123",
    "]C1212345678905",
    "2-123-4567-890-5",
    "3123456789012",
    "812345678901"
  ];
  var out = [];
  for (var i = 0; i < samples.length; i++) {
    out.push({ sample: samples[i], result: csParseCourierBarcode(samples[i]) });
  }
  return { ok: true, tests: out };
}
