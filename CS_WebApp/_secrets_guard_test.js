/**
 * _secrets.gs 온전성 검사 — **clasp push 전에 반드시 돌린다.**
 *
 * ★ 왜 필요한가 — 두 번 데었다 ★
 *   2026-09-02  로컬 _secrets.gs 가 빈 파일(2바이트)이 됐다.
 *               그 상태로 push 했으면 서버의 모든 키가 날아갔다.
 *   2026-09-08  그게 무서워 _secrets.gs 를 .claspignore 에 넣었더니,
 *               clasp 가 **서버에서 그 파일을 지웠다.** clasp push 는
 *               "올리지 않는다" 가 아니라 로컬 목록으로 서버를 동기화한다.
 *               Gemini·허브 연동이 끊겼다.
 *
 *   결론: _secrets.gs 는 push 대상으로 두되, **비었거나 값이 빠진 채로**
 *         나가지 않게 여기서 막는다.
 *
 * 실행: node _secrets_guard_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");

/** 서버에 반드시 있어야 하는 값. 하나라도 비면 그 기능이 죽는다. */
const REQUIRED = [
  ["GEMINI_API_KEY", "CS 화면의 AI 기능"],
  ["SUPABASE_SERVICE_KEY", "v2 연동"],
  ["HUB_WEBAPP_URL", "허브 호출"],
  ["LOTTE_API_KEY_PROD", "배송조회(롯데 화물추적)"],
];

/** 있어도 되고 없어도 되는 값 */
const OPTIONAL = [
  ["LOTTE_API_KEY_DEV", "롯데 개발 환경 (지금은 안 씀)"],
  // 로젠 — 2026-09-15 자리만 만들어 뒀다. 인증키 발급 전이라 비어 있는 게 정상이다.
  // 키를 받고 운영에 올린 뒤에는 LOGEN_SECRET_KEY_PROD 를 REQUIRED 로 올릴 것.
  ["LOGEN_SECRET_KEY_DEV", "배송조회(로젠) 개발계 — 발급 대기"],
  ["LOGEN_SECRET_KEY_PROD", "배송조회(로젠) 운영 — 발급 대기"],
  ["LOGEN_USER_ID", "로젠 연동업체코드"],
  ["LOGEN_CUST_CD", "로젠 거래처코드"],
  ["LOGEN_PROXY_URL", "로젠 중계 서버 (IP 면제되면 불필요)"],
  ["LOGEN_PROXY_TOKEN", "로젠 중계 서버 토큰"],
];

let src;
try {
  src = fs.readFileSync("_secrets.gs", "utf8");
} catch (e) {
  console.log("NG  _secrets.gs 를 읽지 못했습니다 — " + e.message);
  console.log("    이대로 push 하면 서버의 _secrets.gs 가 삭제됩니다. 중단하세요.");
  process.exit(1);
}

if (src.trim().length < 50) {
  console.log("NG  _secrets.gs 가 사실상 비어 있습니다 (" + src.length + " bytes).");
  console.log("    이대로 push 하면 서버 값이 전부 지워집니다. 중단하세요.");
  process.exit(1);
}

let fail = 0;
function check(name, why, required) {
  const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*"([^"]*)"'));
  const val = m ? m[1] : null;
  if (val === null) {
    console.log((required ? "  NG " : "  -- ") + name.padEnd(22) + " 선언 없음   (" + why + ")");
    if (required) fail++;
    return;
  }
  if (!val) {
    console.log((required ? "  NG " : "  -- ") + name.padEnd(22) + " 값이 빔     (" + why + ")");
    if (required) fail++;
    return;
  }
  console.log("  OK " + name.padEnd(22) + " " + String(val.length).padStart(4) + "자   (" + why + ")");
}

console.log("_secrets.gs 검사 (" + src.length + " bytes)\n");
REQUIRED.forEach(([n, w]) => check(n, w, true));
OPTIONAL.forEach(([n, w]) => check(n, w, false));

// 키가 코드 파일로 새어 나갔는지도 같이 본다. 한 번 실제로 csLotte.gs 에 붙었다.
const leaked = fs
  .readdirSync(".")
  .filter((f) => /\.(gs|html)$/.test(f) && f !== "_secrets.gs")
  .filter((f) => /eyJhbGciOiJIUzI1NiJ9|AIzaSy|sb_secret|service_role/.test(fs.readFileSync(f, "utf8")));

console.log("");
if (leaked.length) {
  console.log("NG  키가 다른 파일에 들어 있습니다: " + leaked.join(", "));
  console.log("    이 파일들은 git 에 올라갑니다. 지우고 _secrets.gs 로 옮기세요.");
  fail++;
} else {
  console.log("  OK 다른 .gs/.html 에 키가 새어 나가지 않았습니다");
}

console.log("");
if (fail) {
  console.log("★ " + fail + "건 문제. clasp push 하지 마세요.");
  process.exit(1);
}
console.log("통과 — push 해도 됩니다.");
