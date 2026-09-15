/**
 * 로컬 검증: 포털 script 블록의 값 주입
 *
 *  Apps Script 의 `<?= ?>` 는 script 블록 안에서도 이스케이프를 한다.
 *  `<?= JSON.stringify(sid) ?>` 는 따옴표가 값 안으로 들어가 SID 가 `"s123"` 이 되고,
 *  세션 조회가 항상 실패해 인증 만료 → 백색화면으로 떨어졌다.
 *
 *  여기서는 두 스크립틀릿의 동작을 흉내내어
 *    ① 고친 템플릿이 올바른 JS 를 만드는지
 *    ② 옛 방식이 실제로 값을 망가뜨리는지
 *  둘 다 확인한다.
 *
 * 실행: node _prp_inject_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

// ── prpJsonForScript_ 를 소스에서 가져온다 ──
const codeSrc = fs.readFileSync("Partner_WebApp/Code.gs", "utf8");
const at = codeSrc.indexOf("function prpJsonForScript_(");
if (at < 0) { console.log("prpJsonForScript_ 를 못 찾음"); process.exit(1); }
let depth = 0, end = -1;
for (let i = codeSrc.indexOf("{", at); i < codeSrc.length; i++) {
  if (codeSrc[i] === "{") depth++;
  else if (codeSrc[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
const ctx = vm.createContext({});
vm.runInContext(codeSrc.slice(at, end), ctx);

/** `<?= ?>` — 인쇄 스크립틀릿. HTML 엔티티로 이스케이프한다 */
function printScriptlet(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** script 블록 안의 텍스트는 엔티티가 해석되지 않는다 — 브라우저 동작 재현 */
function evalScriptBody(js) {
  const c = vm.createContext({});
  vm.runInContext(js, c);
  return c;
}

const SID = "s3f9c1ab24d7e4f0b8c6a5d1e2f3a4b5c";
const VENDOR = "준테크";

console.log("\n[1] 옛 방식이 왜 깨졌나 — <?= JSON.stringify(sid) ?>");
const oldLine = "var SID = " + printScriptlet(JSON.stringify(SID)) + ";";
console.log("     생성된 코드: " + oldLine);
let oldBroke = false;
try {
  evalScriptBody(oldLine);
} catch (e) {
  oldBroke = true;
  console.log("     → SyntaxError: " + e.message);
}
// 엔티티가 해석되지 않으므로 JS 문법 오류다. 즉 스크립트 전체가 안 돈다.
check("옛 방식은 JS 문법 오류를 낸다", oldBroke, true);

console.log("\n[2] 문자열 리터럴 안에 넣는 방식 — \"<?= sid ?>\" (CS앱이 쓰는 방식)");
const litLine = 'var SID = "' + printScriptlet(SID) + '";';
const litCtx = evalScriptBody(litLine);
check("따옴표 없는 값은 그대로 통과", litCtx.SID, SID);
// 다만 값에 따옴표가 있으면 엔티티가 그대로 남는다
const litBad = evalScriptBody('var V = "' + printScriptlet('아"야') + '";');
check("값에 따옴표가 있으면 엔티티가 남는다", litBad.V, "아&quot;야");

console.log("\n[3] 고친 방식 — <?!= sidJson ?> (prpJsonForScript_)");
const newSid = evalScriptBody("var SID = " + ctx.prpJsonForScript_(SID) + ";");
check("SID 그대로", newSid.SID, SID);
const newVendor = evalScriptBody("var V = " + ctx.prpJsonForScript_(VENDOR) + ";");
check("업체명 그대로 (한글)", newVendor.V, VENDOR);
const newQuote = evalScriptBody("var V = " + ctx.prpJsonForScript_('아"야') + ";");
check("따옴표 포함 값도 정확", newQuote.V, '아"야');
const newEmpty = evalScriptBody("var V = " + ctx.prpJsonForScript_(null) + ";");
check("null → 빈 문자열", newEmpty.V, "");

console.log("\n[4] </script> 로 블록이 끊기지 않는다");
const evil = '준테크</script><script>alert(1)</script>';
const lit = ctx.prpJsonForScript_(evil);
check("출력에 '<' 가 남아 있지 않다", /</.test(lit), false);
check("복원된 값은 원본과 같다", evalScriptBody("var V = " + lit + ";").V, evil);
const sep = ctx.prpJsonForScript_("a\u2028b\u2029c");
check("U+2028/2029 도 escape (옛 JS 엔진 줄바꿈 취급)", /[\u2028\u2029]/.test(sep), false);

console.log("\n[5] 템플릿에 옛 방식이 남아 있지 않은지");
const portal = fs.readFileSync("Partner_WebApp/portal.html", "utf8");
const intake = fs.readFileSync("CS_WebApp/return_intake.html", "utf8");
const badPat = /<\?=\s*JSON\.stringify/;
check("portal.html", badPat.test(portal), false);
check("return_intake.html", badPat.test(intake), false);
check("portal.html 이 sidJson 을 force-print 로 쓴다",
  /<\?!=\s*sidJson\s*\?>/.test(portal), true);
check("portal.html 이 vendorJson 을 force-print 로 쓴다",
  /<\?!=\s*vendorJson\s*\?>/.test(portal), true);

console.log("\n[6] 백색화면을 만들던 location.reload() 가 없어졌는지");
// 주석에도 그 문구를 설명으로 적어 두었으므로 주석을 걷어내고 본다
const portalCode = portal
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
check("portal.html 에 무조건 location.reload() 없음",
  /(?<!top\.)\blocation\.reload\(\)/.test(
    portalCode.replace(/window\.top\.location\.reload\(\)/g, "TOPRELOAD")), false);
check("top 프레임 새로고침 시도가 있다",
  /window\.top\.location\.reload\(\)/.test(portal), true);
check("막혔을 때 안내 함수가 있다", /function expired\(\)/.test(portal), true);

console.log("\n[7] 빈 스크립틀릿 — 주석에 스크립틀릿 문법을 쓰면 템플릿이 깨진다");
// 템플릿 엔진은 JS 주석을 모른다. 주석 안에 `<?= ?>` 를 설명으로 적으면
// 그것을 **내용이 빈 인쇄 스크립틀릿**으로 컴파일해 `output._ = ;` 를 만들고,
// evaluate() 가 "SyntaxError: Unexpected token ';'" 로 죽는다.
// 설명이 필요하면 "인쇄 스크립틀릿" 처럼 말로 쓴다.
const dirs = ["Partner_WebApp", "CS_WebApp", "."];
const seen = new Set();
const tpls = [];
for (const d of dirs) {
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith(".html")) continue;
    const p = require("path").join(d, f);
    if (seen.has(p) || p.includes("backup_")) continue;
    seen.add(p);
    tpls.push(p);
  }
}
const offenders = tpls.filter(function (p) {
  return /<\?!?=\s*\?>/.test(fs.readFileSync(p, "utf8"));
});
if (offenders.length) offenders.forEach(function (p) { console.log("      → " + p); });
check("빈 스크립틀릿이 있는 템플릿 수 (검사 " + tpls.length + "개)", offenders.length, 0);

console.log("\n[8] 카드 버튼 data-k — 타임라인 루프가 카드 키를 덮어쓰지 않는다");
// `var` 는 함수 스코프다. cardHtml() 안에서 타임라인 카운터를 k 로 쓰면
// 위에서 잡은 카드 키 k 가 숫자로 덮어써지고, c-foot 버튼의 data-k 가 숫자가 된다.
// 그러면 클릭 핸들러의 keyOf(ROWS[n]) === k 조회가 실패해
// **문의·사진 첨부 버튼이 아무 반응 없이 죽는다** (타임라인이 있는 카드만).
const portalSrc = fs.readFileSync("Partner_WebApp/portal.html", "utf8");
function grabFn(src, name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false, i = s;
  for (; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const cardCtx = { OPEN_POP: "" };
vm.createContext(cardCtx);
const stepsDecl = portalSrc.match(/^[ \t]*var\s+STEPS\s*=.*?;[ \t]*$/m);
if (!stepsDecl) { console.log("  FAIL var STEPS 를 못 찾음"); fail++; }
// TRACK 은 여러 줄 배열이라 대괄호를 맞춰 끝을 찾는다
const trackAt = portalSrc.search(/^[ \t]*var\s+TRACK\s*=\s*\[/m);
let trackDecl = "var TRACK=[];";
if (trackAt >= 0) {
  let d = 0;
  for (let i = portalSrc.indexOf("[", trackAt); i < portalSrc.length; i++) {
    if (portalSrc[i] === "[") d++;
    else if (portalSrc[i] === "]") {
      d--;
      if (d === 0) { trackDecl = portalSrc.slice(trackAt, i + 1).trim() + ";"; break; }
    }
  }
} else { console.log("  FAIL var TRACK 을 못 찾음"); fail++; }
vm.runInContext(
  [stepsDecl ? stepsDecl[0].trim() : "var STEPS=[];", trackDecl].concat(
    ["esc", "badgeClass", "keyOf", "linkify", "stepIndex", "stepsHtml",
      "driveId", "thumbsHtml", "trackUrl", "invLine", "tagClass", "cardHtml"]
      .map(function (n) { return grabFn(portalSrc, n); })
  ).join("\n"),
  cardCtx
);
const sample = {
  tab: "202608", row: 5, name: "홍길동", status: "수거중", item: "물티슈", qty: 2,
  invoice: "1234567890", returnInvoice: "9876543210", pickup: "롯데",
  date: "2026-08-27", openedBy: "CS", timeline: [
    { kind: "status", who: "CS", date: "2026-08-26", time: "10:00", text: "접수" },
    { kind: "mine", who: "업체", date: "2026-08-27", time: "09:00", text: "문의" }
  ]
};
const html = vm.runInContext("cardHtml(" + JSON.stringify(sample) + ")", cardCtx);
function dataKOf(act) {
  const m = html.match(new RegExp('data-act="' + act + '" data-k="([^"]*)"'));
  return m ? m[1] : null;
}
check("사진 첨부 버튼의 data-k", dataKOf("photo"), "202608:5");
check("문의 버튼의 data-k", dataKOf("ask"), "202608:5");
check("타임라인 2건이 모두 그려짐", (html.match(/class="ev"/g) || []).length, 2);
check("원송장·반품송장 두 줄이 링크가 된다", (html.match(/class="inv-link"/g) || []).length, 2);
check("사진 썸네일이 새 탭 링크가 아니다", /target="_blank"/.test(html.replace(/inv-link[\s\S]*?<\/a>/g, "")), false);

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
