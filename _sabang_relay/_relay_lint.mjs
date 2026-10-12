/**
 * ══════════════════════════════════════════════════════════════
 *  중계기(PHP) 검사 — 파서가 «통과시키는» 실수를 잡는다
 *
 *    node _sabang_relay/_relay_lint.mjs
 *
 *  ★ 왜 있나 ★  (2026-10-12)
 *    이 PC 에 php 가 없어 `php -l` 을 못 돌린다. php-parser 로 문법은 봤는데
 *    «통과»라고 나왔다. 그런데 거기 isset(ALLOWED[$key]) 가 있었다 —
 *    PHP 는 상수 배열에 isset() 을 쓰면
 *        Cannot use isset() on the result of an expression
 *    으로 «죽는다». 문법은 맞고 뜻이 틀린 것이라 파서가 못 잡는다.
 *
 *    서버에 올려서 500 을 보고 알아내면, 그때는 이미 배포한 뒤다.
 *    여기서 먼저 잡는다.
 *
 *  ★ 문법 검사도 같이 한다 ★
 *    php-parser 가 있으면 쓰고, 없으면 그 부분만 건너뛴다(검사가 아예 안 도는 것보다 낫다).
 * ══════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const 파일들 = fs.readdirSync(here).filter((f) => f.endsWith(".php")).map((f) => path.join(here, f));

if (!파일들.length) { console.log("검사할 .php 가 없습니다."); process.exit(0); }

/*  ★ 자리를 「줄 번호」로 돌려준다 ★  「3072번째 글자」로는 못 찾아간다. */
function 줄번호(src, idx) { return src.slice(0, idx).split("\n").length; }

/**
 * 주석을 «빈칸으로» 바꾼다 — 지우지 않고 같은 길이로 둔다.
 *
 * ★ 왜 빈칸인가 ★  글자 수가 그대로여야 줄 번호가 안 어긋난다.
 *
 * ★ 왜 필요한가 ★  (2026-10-12 — 이 검사기를 만들자마자 겪었다)
 *   isset(상수[…]) 을 금지하는 규칙을 넣었더니, 그 금지를 «설명한 주석»을
 *   잡아 왔다. 거짓 경보가 한 번 나면 다음부터 아무도 이 검사를 안 본다.
 *   문자열 안쪽도 같은 이유로 비운다.
 */
function 주석빼기(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "*") {               // /* … */
      const e = src.indexOf("*/", i + 2);
      const 끝 = e < 0 ? n : e + 2;
      out += src.slice(i, 끝).replace(/[^\n]/g, " ");
      i = 끝; continue;
    }
    if ((c === "/" && c2 === "/") || c === "#") { // // … · # …
      let e = src.indexOf("\n", i);
      if (e < 0) e = n;
      out += " ".repeat(e - i);
      i = e; continue;
    }
    if (c === "'" || c === '"') {                 // 문자열
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, n);
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * 뜻이 틀린 자리들. 하나씩 겪은 것만 넣는다 —
 * 겪지 않은 규칙을 넣으면 거짓 경보가 늘고, 그러면 아무도 이 검사를 안 본다.
 */
const 규칙 = [
  {
    이름: "상수 배열에 isset()",
    무늬: /isset\s*\(\s*[A-Z_][A-Z0-9_]*\s*\[/g,
    왜: "PHP 는 상수 배열에 isset() 을 못 쓴다 — Cannot use isset() on the result of an expression",
    대신: "array_key_exists($키, 상수) 를 쓴다",
  },
  {
    이름: "함수 호출 결과에 isset()",
    무늬: /isset\s*\(\s*[a-z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*\[/g,
    왜: "isset() 은 변수에만 쓴다. 호출 결과에 쓰면 같은 오류로 죽는다",
    대신: "결과를 변수에 받아 두고 isset() 하거나 array_key_exists 를 쓴다",
  },
  {
    이름: "설정 파일이 저장소에 올라갈 모양",
    무늬: /^(?!.*sample).*_config\.php$/,
    파일이름검사: true,
    왜: "시크릿이 든 설정은 .gitignore 에 있어야 한다",
    대신: "견본(*_config.sample.php)만 올린다",
  },
];

let 터진것 = 0;

for (const f of 파일들) {
  const 이름 = path.basename(f);
  const 원본 = fs.readFileSync(f, "utf8");
  const src = 주석빼기(원본);   // 주석·문자열을 비운 판으로 본다 (줄 번호는 그대로)
  const 본 = [];

  for (const r of 규칙) {
    if (r.파일이름검사) {
      if (r.무늬.test(이름)) 본.push({ r, 줄: 0, 글: 이름 });
      continue;
    }
    r.무늬.lastIndex = 0;
    let m;
    while ((m = r.무늬.exec(src)) !== null) {
      본.push({ r, 줄: 줄번호(src, m.index), 글: m[0].replace(/\s+/g, " ") });
    }
  }

  if (!본.length) { console.log("✅ " + 이름); continue; }
  터진것 += 본.length;
  console.log("❌ " + 이름);
  for (const h of 본) {
    console.log("   " + (h.줄 ? h.줄 + "행  " : "") + h.글);
    console.log("      왜   : " + h.r.왜);
    console.log("      대신 : " + h.r.대신);
  }
}

/* 문법 검사 — php-parser 가 있을 때만 */
try {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const engine = require("php-parser");
  const parser = new engine({ parser: { extractDoc: false } });
  for (const f of 파일들) {
    try { parser.parseCode(fs.readFileSync(f, "utf8"), f); }
    catch (e) { 터진것++; console.log("❌ 문법 " + path.basename(f) + " — " + e.message); }
  }
  console.log("\n(문법 검사: php-parser 로 " + 파일들.length + "개)");
} catch (_) {
  console.log("\n(문법 검사 건너뜀 — php-parser 가 없습니다. npm i php-parser)");
}

console.log(터진것 ? "\n★ " + 터진것 + "곳" : "\n문제 없습니다.");
process.exit(터진것 ? 1 : 0);
