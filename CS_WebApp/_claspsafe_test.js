/**
 * clasp 가 «올릴» 파일에 node 전용 문법이 섞이지 않았나
 *
 *  ★ 2026-10-14 사고 ★
 *    _csretfault_break.js 는 node 로만 돌리는 시험 도구인데 이름이
 *    .claspignore 의 「*_test.js」에 안 걸려 Apps Script 로 올라갔다.
 *    GAS 에는 require 가 없어 «웹앱 전체»가 이 한 줄에서 멈췄다 —
 *      ReferenceError: require is not defined('_csretfault_break' 파일, 4행)
 *    한 파일이 못 열리면 그 프로젝트의 모든 함수가 안 돈다. 문법 오류가
 *    아니라 로드 중 오류라 push 도 조용히 성공한다.
 *
 *  그래서 «올라갈 목록»을 직접 만들어 본다 — 이름 규칙에 기대지 않고,
 *  정말 올라가는 파일만 골라 node 전용 낱말이 있는지 읽는다.
 *
 * 실행: node _claspsafe_test.js
 */
const fs = require("fs"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; } else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "\n       " + 덧)); }
}

const 여기 = __dirname;

/*  .claspignore 를 읽어 «올라가지 않을 것»을 가린다.
    글롭 전부를 흉내 내지 않는다 — 이 파일에 실제로 쓰인 꼴만 다룬다.  */
function 무시규칙() {
  let 글 = "";
  try { 글 = fs.readFileSync(path.join(여기, ".claspignore"), "utf8"); } catch (e) { return []; }
  return 글.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l[0] !== "#")
    .map((pat) => {
      const re = pat
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\//g, "(?:.*/)?")
        .replace(/\*/g, "[^/]*");
      return new RegExp("^" + re + "$");
    });
}

const 무시 = 무시규칙();
const 올라갈것 = fs.readdirSync(여기)
  .filter((f) => /\.(js|gs|html|json)$/i.test(f))
  .filter((f) => !무시.some((re) => re.test(f)));

ok("올라갈 파일을 찾았다", 올라갈것.length > 10, 올라갈것.length + "개");

/*  GAS 에 없는 것들. 글자가 보이기만 해도 막는다 — 주석 속이라도 헷갈리게
    두지 않는다. 정말 주석에 쓰고 싶으면 낱말을 쪼개 적는다.  */
const 금지 = [
  { 이름: "require(", 재기: /(^|[^.\w])require\s*\(/ },
  { 이름: "module.exports", 재기: /module\s*\.\s*exports/ },
  { 이름: "process.argv", 재기: /process\s*\.\s*argv/ },
  { 이름: "process.exit", 재기: /process\s*\.\s*exit/ },
  { 이름: "__dirname", 재기: /__dirname/ },
  { 이름: "__filename", 재기: /__filename/ },
];

const 걸린것 = [];
올라갈것.forEach((f) => {
  //  html 안의 <script> 는 브라우저에서 돈다 — GAS 로드와 무관하다
  if (/\.html$/i.test(f) || /\.json$/i.test(f)) return;
  let 글 = "";
  try { 글 = fs.readFileSync(path.join(여기, f), "utf8"); } catch (e) { return; }
  금지.forEach((g) => {
    if (g.재기.test(글)) {
      const 줄 = 글.split(/\r?\n/).findIndex((l) => g.재기.test(l)) + 1;
      걸린것.push(f + " " + 줄 + "행 — " + g.이름);
    }
  });
});

ok("올라갈 파일에 node 전용 문법이 없다", 걸린것.length === 0,
  걸린것.join("\n       ") + "\n       → 이름을 «…_test.js» 로 바꾸거나 .claspignore 에 넣으세요.\n" +
  "       GAS 에는 require 가 없습니다. 한 파일이 못 열리면 웹앱 전체가 멈춥니다.");

/*  이번에 당한 그 파일이 정말 걸러지는지 못 박아 둔다  */
ok("_csretfault_break_test.js 는 안 올라간다",
  올라갈것.indexOf("_csretfault_break_test.js") < 0);
ok("…_test.js 는 하나도 안 올라간다",
  올라갈것.filter((f) => /_test\.js$/.test(f)).length === 0,
  올라갈것.filter((f) => /_test\.js$/.test(f)).join(" · "));
/*  ★ 거꾸로도 본다 ★ 규칙이 너무 넓어 진짜 코드까지 빼 버리면 서버에서
    그 파일이 «지워진다» (.claspignore 에 적힌 _secrets.gs 사고가 그것이다).  */
["csOrderSearch.gs", "home.html", "Code.gs", "_secrets.gs"].forEach((f) => {
  if (!fs.existsSync(path.join(여기, f))) return;
  ok(f + " 는 올라간다", 올라갈것.indexOf(f) >= 0);
});

console.log(fail ? "✘ " + fail + "개 틀림 / " + pass + "개 맞음" : "✔ " + pass + "가지 다 통과");
process.exit(fail ? 1 : 0);
