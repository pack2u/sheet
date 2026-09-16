/**
 * 없는 변수에 쓰고 있지 않나
 *
 *  > "❌ 대리공급 Push 에러  오류 result is not defined"   (2026-09-16)
 *
 *  _pep_pushCore_ 안에 「result.detail.pushMissing = _빈칸셈_;」이 있었다.
 *  그 함수에는 result 가 없다 — 다른 함수의 모양을 그대로 가져다 붙인 것이다.
 *  try 밖이라 거기서 그대로 터졌고, 전용양식 쓰기 «뒤»가 통째로 건너뛰어졌다
 *  (원본 대조 · 요약 · 전용양식 → DB 동기화).
 *
 *  ★ 왜 하루에 세 번씩 터지는데 아무도 몰랐나 ★
 *    같은 날(9/15) 챗 알림이 죽어 있었다. 오류가 나가는 길이 막혀 있었다.
 *
 *  ★ node --check 로는 못 잡는다 ★
 *    문법은 멀쩡하다. 전역일 수도 있으니 자바스크립트가 뭐라 안 한다.
 *    실제로 돌 때만 터진다 — 그게 하필 밤 트리거 안이면 며칠을 간다.
 *
 *  ★ 좁게 본다 ★
 *    「NAME.무엇 = 」 꼴로 «쓰는» 자리만 본다. 읽기까지 보면 거짓 경고가
 *    쏟아져 아무도 안 보게 된다 (2026-09-16 에 한 번 겪었다).
 *    쓰는 자리는 거의 틀림없이 그 함수가 만든 것이어야 한다.
 *
 * 실행: node _undefvar_test.js
 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(label, ok, 덧붙임) {
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + (ok ? "" : "   " + (덧붙임 || "")));
}

/** 자바스크립트·Apps Script 가 그냥 주는 이름들 */
const 바깥것 = new Set([
  "SpreadsheetApp", "DriveApp", "GmailApp", "UrlFetchApp", "Utilities", "Logger",
  "PropertiesService", "CacheService", "LockService", "ScriptApp", "Session",
  "HtmlService", "ContentService", "CalendarApp", "DocumentApp", "FormApp",
  "MailApp", "Charts", "XmlService", "Maps", "Drive", "Sheets", "console",
  "JSON", "Math", "Object", "Array", "String", "Number", "Date", "RegExp",
  "Error", "Map", "Set", "Promise", "globalThis", "module", "exports",
  "this", "self", "window", "document", "google", "e", "err",
]);

/** 주석과 문자열을 한 번에 걷어낸다 — 한 글자씩 한 번만 훑는다 */
function 껍데기만(줄들) {
  const 밖 = [];
  let 블록 = false;
  for (const 줄 of 줄들) {
    let 나감 = "", 따옴 = "";
    for (let i = 0; i < 줄.length; i++) {
      const ch = 줄[i], 다음 = 줄[i + 1];
      if (블록) { if (ch === "*" && 다음 === "/") { 블록 = false; i++; } continue; }
      if (따옴) {
        if (ch === "\\\\") { i++; continue; }
        if (ch === 따옴) 따옴 = "";
        continue;
      }
      if (ch === "/" && 다음 === "*") { 블록 = true; i++; continue; }
      if (ch === "/" && 다음 === "/") break;
      if (ch === '"' || ch === "'" || ch === "`") { 따옴 = ch; continue; }
      나감 += ch;
    }
    밖.push(나감);
  }
  return 밖;
}

/** 맨 위 함수들을 통째로 떼어 낸다 (중괄호 짝) */
function 함수들(코드) {
  const out = [];
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm;
  let m;
  while ((m = re.exec(코드))) {
    let d = 0, i = m.index + m[0].length - 1;
    for (; i < 코드.length; i++) {
      if (코드[i] === "{") d++;
      else if (코드[i] === "}") { d--; if (d === 0) break; }
    }
    out.push({ name: m[1], args: m[2], at: m.index, body: 코드.slice(m.index, i + 1) });
  }
  return out;
}

/** 이 함수 안에서 «만들어지는» 이름들 (안쪽 함수 것까지 다 친다) */
function 제것(fn) {
  const s = new Set();
  for (const a of fn.args.split(",")) { const t = a.trim(); if (t) s.add(t); }
  for (const m of fn.body.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  //  var a = 1, b = 2;  의 b 도 만들어진 이름이다
  for (const m of fn.body.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=/g)) s.add(m[1]);
  for (const m of fn.body.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  //  이름이 있든 없든 안쪽 함수의 매개변수는 그 함수가 만든 것이다
  for (const m of fn.body.matchAll(/\bfunction\s*(?:[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) {
    for (const a of m[1].split(",")) { const t = a.trim(); if (t) s.add(t); }
  }
  for (const m of fn.body.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of fn.body.matchAll(/\bfor\s*\(\s*(?:var|let|const)?\s*([A-Za-z_$][\w$]*)\s+(?:in|of)\b/g)) s.add(m[1]);
  return s;
}

function 훑기(뿌리, 뺄것, 모음) {
  for (const e of fs.readdirSync(뿌리, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (/node_modules|scratch|backup/i.test(e.name)) continue;
    const f = path.join(뿌리, e.name);
    if (e.isDirectory()) {
      if (뺄것[e.name]) continue;
      훑기(f, 뺄것, 모음);
      continue;
    }
    if (/\.gs$/.test(e.name)) 모음.push(f);
  }
  return 모음;
}

/** clasp 이 안 올리는 폴더는 볼 것이 없다 */
function 빼는폴더들(뿌리) {
  const 뺄것 = {};
  const p = path.join(뿌리, ".claspignore");
  if (!fs.existsSync(p)) return 뺄것;
  for (const 줄 of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = 줄.trim();
    if (!t || t[0] === "#") continue;
    const m = t.match(/^(.+)\/\*\*$/);
    if (m) 뺄것[m[1]] = true;
  }
  return 뺄것;
}

const 뿌리 = __dirname;
//  다른 GAS 프로젝트도 같이 본다 — 같은 실수가 거기서도 난다
const 볼폴더 = [뿌리];
for (const d of ["CS_WebApp", "Partner_WebApp", "세트분리V2"]) {
  const p = path.join(뿌리, d);
  if (fs.existsSync(p)) 볼폴더.push(p);
}

//  어느 파일에서든 맨 위에 선언된 이름은 어디서 써도 된다
const 전역 = new Set();
const 파일들 = [];
for (const d of 볼폴더) {
  for (const f of 훑기(d, 빼는폴더들(d), [])) {
    if (파일들.indexOf(f) < 0) 파일들.push(f);
  }
}
for (const f of 파일들) {
  const 코드 = 껍데기만(fs.readFileSync(f, "utf8").split(/\r?\n/)).join("\n");
  for (const m of 코드.matchAll(/^(?:var|let|const)\s+([A-Za-z_$][\w$]*)/gm)) 전역.add(m[1]);
  for (const m of 코드.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) 전역.add(m[1]);
}

console.log("파일 " + 파일들.length + "개 · 전역 이름 " + 전역.size + "개");

const 걸림 = [];
for (const f of 파일들) {
  const 코드 = 껍데기만(fs.readFileSync(f, "utf8").split(/\r?\n/)).join("\n");
  for (const fn of 함수들(코드)) {
    const 내것 = 제것(fn);
    /*  「NAME.무엇 = 」 꼴로 «쓰는» 자리만 본다 (읽기는 안 본다 — 거짓 경고가 쏟아진다) */
    for (const m of fn.body.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*\s*(?:\.\s*[A-Za-z_$][\w$]*\s*)*=[^=]/g)) {
      const n = m[2];
      if (내것.has(n) || 전역.has(n) || 바깥것.has(n)) continue;
      if (/^[0-9]/.test(n)) continue;
      /*  줄번호는 맞은 «그 자리»에서 센다. 이름만 보고 처음 나오는 줄을 집으면
          엉뚱한 데를 가리켜, 고치러 갔다가 못 찾고 돌아온다. */
      const 앞 = 코드.slice(0, fn.at + m.index);
      const 줄번호 = (앞.match(/\n/g) || []).length;
      걸림.push(path.relative(뿌리, f) + (줄번호 >= 0 ? ":" + (줄번호 + 1) : "") +
        "  " + fn.name + "() 에 없는 " + n);
    }
  }
}

for (const g of 걸림) check(g, false, "그 함수가 만든 적 없는 것에 쓰고 있다");
check("없는 변수에 쓰는 곳이 없다", 걸림.length === 0, 걸림.length + "곳");

console.log("");
console.log(fail === 0 ? "✅ 통과 " + pass + "건" : "❌ 실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
