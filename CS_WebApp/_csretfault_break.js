/*  ★ 새로 세운 울타리를 일부러 깨 본다 ★  안 울면 울타리가 없는 것이다.
    원본은 반드시 되돌린다 — sha256 으로 확인한다.
    node _csretfault_break.js                                        2026-10-14  */
const fs = require("fs"), crypto = require("crypto"), { execSync } = require("child_process");

const 파일 = { html: __dirname + "/home.html", gs: __dirname + "/csOrderSearch.gs" };
const 원본 = { html: fs.readFileSync(파일.html), gs: fs.readFileSync(파일.gs) };
const 해시 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const 원해시 = { html: 해시(원본.html), gs: 해시(원본.gs) };

function 돌려() {
  let out = "";
  try { out = execSync("node _csretreason_test.js", { encoding: "utf8", cwd: __dirname }); }
  catch (e) { out = (e.stdout || "") + (e.stderr || ""); }
  if (/^\s*$/.test(out) || /SyntaxError|ReferenceError/.test(out)) return ["시험틀이 터졌다"];
  return (out.match(/^  ❌ .*$/gm) || []).map((l) => l.replace(/^  ❌ /, "").split("  ")[0].trim());
}

const 깨기 = [
  ["RET_FAULTS 를 다시 두 벌로", "html", (s) => s.replace(
    "var RET_FAULTS = ['', '판매자', '구매자', '택배사'];",
    "var RET_FAULTS = ['구매자', '판매자'];")],
  ["택배사 사유를 비운다", "html", (s) => s.replace(
    "택배사: ['사고', '제품파손', '분실', '배송지연', '오배송']", "택배사: []")],
  ["택배사 칸을 아예 뺀다", "html", (s) => s.replace(
    /,\s*\/\*  ★ 2026-10-14 ★[\s\S]*?택배사: \['[^\]]*\]/, "")],
  ["유형에서 「사고」를 뺀다", "html", (s) => s.replace("'파손', '사고', '기타'", "'파손', '기타'")],
  ["서버 낱말 표에서 택배사를 뺀다", "gs", (s) => s.replace(
    'var _CS_FAULT_WORDS_ = ["구매자", "판매자", "택배사"];',
    'var _CS_FAULT_WORDS_ = ["구매자", "판매자"];')],
  /*  ★ 세 자리가 다시 갈라지면 우는가 ★ — 낱말을 한 곳에서 가져가지 않고
      자기만 들고 있게 되돌린다. 이번에 실제로 그래서 사유를 못 읽었다.  */
  ["사유 읽기만 옛 낱말로 되돌린다", "gs", (s) => s.replace(
    '"귀책\\\\s*[:：]\\\\s*(?:" + _cs_faultAlt_() + ")\\\\s*\\\\(([^)]{1,20})\\\\)"',
    '"귀책\\\\s*[:：]\\\\s*(?:구매자|판매자)\\\\s*\\\\(([^)]{1,20})\\\\)"')],
  ["발생원인 읽기만 옛 낱말로 되돌린다", "gs", (s) => s.replace(
    '"^(" + _cs_faultAlt_() + ")귀책$"', '"^(구매자|판매자)귀책$"')],
];

let 안움 = 0;
console.log("─ 일부러 깨 보기 (우는 게 맞다) ─\n");
try {
  for (const [이름, 어디, f] of 깨기) {
    const 글 = 원본[어디].toString("utf8");
    const 깬것 = f(글);
    if (깬것 === 글) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
    fs.writeFileSync(파일[어디], 깬것, "utf8");
    const 운것 = 돌려();
    fs.writeFileSync(파일[어디], 원본[어디]);
    if (운것.length) console.log("  ✔ 울었다 [" + 운것.join(", ") + "] ← " + 이름);
    else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
  }
} finally {
  fs.writeFileSync(파일.html, 원본.html);
  fs.writeFileSync(파일.gs, 원본.gs);
  const 끝 = { html: 해시(fs.readFileSync(파일.html)), gs: 해시(fs.readFileSync(파일.gs)) };
  console.log("\n되돌림 — home.html " + (끝.html === 원해시.html ? "✔ 같다" : "★★ 다르다 ★★") +
    " · csOrderSearch.gs " + (끝.gs === 원해시.gs ? "✔ 같다" : "★★ 다르다 ★★"));
}
console.log(안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다");
process.exit(안움 ? 1 : 0);
