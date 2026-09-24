/**
 * 명세서 올리기 — CS 웹앱은 **넘기기만** 한다.
 * 2026-09-08
 *
 *   node _csstatement_test.js
 *
 * > "v2와 기존 웹앱이도 넣고싶어"
 *
 * ★ 이 시험이 지키는 것 ★
 *   기존 웹앱에도 입구를 냈지만 **여기서 명세서를 읽으면 안 된다.**
 *   판독 규칙이 두 벌이 되면 같은 명세서가 화면마다 다른 숫자로 읽히고,
 *   정산에서 그것보다 나쁜 일은 없다. 그래서 「여기에 판독기가 없다」를
 *   말로 적어 두지 않고 **시험이 확인한다.**
 */
const fs = require("fs");
const gs = fs.readFileSync(__dirname + "/csStatement.gs", "utf8");
const html = fs.readFileSync(__dirname + "/statement.html", "utf8");
const code = fs.readFileSync(__dirname + "/Code.gs", "utf8");
const secrets = fs.existsSync(__dirname + "/_secrets.gs")
  ? fs.readFileSync(__dirname + "/_secrets.gs", "utf8") : "";

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  OK " + name); }
  else { fail++; console.log("  NG " + name + (got !== undefined ? "  → " + got : "")); }
};

console.log("\n[1] ★ 여기서 명세서를 읽지 않는다 ★");
/* 판독은 v2 한 곳에서만. 여기에 프롬프트나 Gemini 호출이 생기면
   그 순간 규칙이 두 벌이 된다. */
ok("Gemini 를 부르지 않는다", !/generativelanguage|gemini/i.test(gs));
ok("판독 프롬프트가 없다", !/거래명세표|공급가액 합계/.test(gs));
ok("엑셀을 뜯지 않는다", !/XLSX|SpreadsheetApp\.openById/.test(gs));
ok("하는 일은 넘기는 것뿐 (UrlFetchApp)", gs.indexOf("UrlFetchApp.fetch") > -1);

console.log("\n[2] ★ v2 서비스 키를 여기 두지 않는다 ★");
/* 서비스 키는 RLS 를 통째로 우회한다. 명세서를 넣으려고 고객 개인정보까지
   열어 줄 이유가 없다. 이 경로만 여는 표를 쓴다. */
ok("표로 인증한다", /x-ingest-token/.test(gs));
ok("v2 서비스 키를 안 읽는다",
   !/SUPABASE_SERVICE_ROLE|V2_SERVICE/.test(gs));
ok("표는 _secrets 또는 스크립트 속성에서", /V2_INGEST_TOKEN/.test(gs));
ok("★ 표를 오류 메시지에 안 싣는다 ★",
   !/\+ *tok\b|tok *\+/.test(gs.replace(/"x-ingest-token": tok/, "")));

console.log("\n[3] 설정이 없으면 조용히 실패하지 않는다");
ok("쓸 수 있는지 화면이 물어본다", gs.indexOf("function csStatementReady") > -1);
ok("없으면 이유를 말한다", /표\(V2_INGEST_TOKEN\)가 없습니다/.test(gs));
ok("화면이 그 이유를 띄운다", /csStatementReady\(\)/.test(html) && html.indexOf('id="off"') > -1);
ok("표가 없으면 못 보내게 막는다", /if \(!READY \|\| BUSY/.test(html));
ok("편집기 확인용도 있다", gs.indexOf("function csStatementSelfTest") > -1);

console.log("\n[4] 세 가지 길을 다 연다 (사장님 요청)");
/* "붙여넣기, 드레그엔 드롭으로 붙여 넣으면" — 셋 중 하나만 되면 안 쓰게 된다 */
ok("끌어다 놓기", /addEventListener\('drop'/.test(html) || /'drop'/.test(html));
ok("★ 붙여넣기는 창 전체에서 받는다 ★",
   /window\.addEventListener\('paste'/.test(html));
ok("눌러서 고르기", html.indexOf('id="pick"') > -1);
ok("폰에서도 고를 수 있다 (accept 에 image)", /accept="[^"]*image\/\*/.test(html));
ok("엑셀·PDF 도 받는다", /accept="[^"]*\.xlsx[^"]*\.pdf/.test(html));

console.log("\n[5] 한 개씩 보낸다");
/* PDF 를 AI 가 읽는 데 몇십 초가 걸린다. 한꺼번에 보내면 구글 쪽에서 먼저 끊긴다. */
ok("차례로 보낸다", /function step\(\)/.test(html));
ok("몇 개째인지 보여준다", /보내는 중… \(' \+ \(i \+ 1\)/.test(html));
ok("실패해도 다음 것을 보낸다", /withFailureHandler[\s\S]{0,200}i\+\+; step\(\)/.test(html));

console.log("\n[6] 결과를 사람이 읽을 수 있게");
ok("이미 올린 것은 그렇다고 말한다", /이미 올린 명세서입니다/.test(html) && /duplicate/.test(gs));
ok("★ 합계가 안 맞으면 눈에 띄게 ★", /합계가 안 맞습니다/.test(html));
ok("바로 열어 볼 수 있다 (viewUrl)", /viewUrl/.test(gs) && /viewUrl/.test(html));
ok("v2 정산 화면으로 가는 길", /\/settlement/.test(html));
ok("이름은 그대로 안 넣는다 (esc)", /function esc\(/.test(html) && /esc\(f\.name\)|esc\(name\)/.test(html));

console.log("\n[7] 권한 · 크기");
ok("접근제어를 통과해야 한다", /_cs_ac_guard_\(\)/.test(gs));
ok("빈 파일을 안 보낸다", /빈 파일입니다/.test(gs));
ok("너무 크면 미리 막는다 (20MB)", /_CST_MAX_BYTES_ = 20 \* 1024 \* 1024/.test(gs));
ok("v2 쪽 한도와 같은 값", /20MB 까지/.test(gs) && /20MB 까지/.test(html));

console.log("\n[8] 화면이 실제로 연결돼 있다");
ok("Code.gs 에 page=statement 가 있다", /case "statement":/.test(code));
ok("statement.html 을 연다", /file = "statement"/.test(code));
ok("제목이 붙는다", /title = "명세서 올리기"/.test(code));

console.log("\n[9] 표가 실제로 설정돼 있다");
if (!secrets) {
  console.log("  -- _secrets.gs 가 없어 건너뜁니다 (다른 PC 에서는 정상)");
} else {
  ok("V2_INGEST_TOKEN 이 들어 있다", /var V2_INGEST_TOKEN = "[^"]{16,}"/.test(secrets));
  ok("V2_URL 이 들어 있다", /var V2_URL = "https:\/\//.test(secrets));
  ok("★ 표가 코드 파일에 안 새어 있다 ★",
     !/V2_INGEST_TOKEN\s*=\s*"[^"]{16,}"/.test(gs));
}

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
