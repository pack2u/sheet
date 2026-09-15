/**
 * _secrets.gs 의 값을 «파일 맨 위»에서 읽지 못하게 막는다
 *
 *  > "그리고 챗알림 안옴... 확인해줘"   (2026-09-16)
 *
 *  Apps Script 는 프로젝트의 모든 .gs 를 «파일 이름 차례대로» 한 번 훑으며
 *  맨 위(함수 밖) 코드를 실행한다. 그러니 _secrets.gs 보다 이름이 앞선
 *  파일이 맨 위에서 그 값을 읽으면, 그때는 아직 값이 담기지 않았다.
 *  typeof 로 감싸도 "undefined" 가 나온다 — 오류 없이 «빈 값»이 박힌다.
 *
 *  실제로 _partnerChatNotify.gs (p < s) 가 이 덫에 걸려, 9/14 에 웹훅을
 *  _secrets.gs 로 옮긴 그날부터 Chat 알림이 한 통도 안 나갔다.
 *  보내는 함수마다 맨 앞에 if (!주소) return 이 있어 «조용히» 멈췄다.
 *
 *  ★ 이름 차례에 기대지 않는다 ★
 *    지금은 _secrets 뒤에 오는 파일이라 우연히 멀쩡할 수도 있다. 그러나
 *    파일 이름은 바뀐다. 아예 «맨 위에서 읽는 것» 자체를 막는다.
 *    읽어야 하면 함수 안에서 읽는다 (_chat_url_() 처럼).
 *
 * 실행: node _secretstoplevel_test.js
 */
const fs = require("fs");
const path = require("path");

const 줄나눔 = /\r?\n/;

let pass = 0, fail = 0;
function check(label, ok, 덧붙임) {
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + (ok ? "" : "   " + (덧붙임 || "")));
}

/** _secrets.gs 가 내놓는 이름들 — 파일이 있으면 거기서 읽고, 없으면 아는 것으로 */
function 비밀이름들(뿌리) {
  const p = path.join(뿌리, "_secrets.gs");
  if (fs.existsSync(p)) {
    const 이름 = [];
    for (const 줄 of fs.readFileSync(p, "utf8").split(줄나눔)) {
      const m = 줄.match(/^\s*var\s+([A-Z0-9_]+)\s*=/);
      if (m) 이름.push(m[1]);          // ★ 값은 읽지 않는다. 이름만 본다 ★
    }
    if (이름.length) return 이름;
  }
  return ["GEMINI_API_KEY", "SUPABASE_SERVICE_KEY", "HUB_WEBAPP_URL",
          "V2_URL", "V2_INGEST_TOKEN", "CHAT_WEBHOOK_URL"];
}

/**
 * 주석과 문자열을 한 번에 걷어낸다.
 *
 * 따로 하면 틀린다 — 주석을 먼저 지우면 "https://…" 의 두 빗금이 주석으로
 * 보여 줄이 잘리고, 문자열을 먼저 지우면 주석 속 따옴표에 물린다.
 * 그래서 «한 글자씩» 한 번만 훑는다.
 *
 * 이게 필요한 까닭: priceManager.gs 처럼 코드를 문자열로 조립하는 파일에는
 * "function x() {" 같은 중괄호가 문자열 안에 들어 있다. 그걸 세면 깊이가
 * 어긋나 함수 «안»의 줄을 맨 위라고 잘못 짚는다. 실제로 그렇게 헛것을 잡았다.
 */
function 껍데기만(원본줄들) {
  const 밖 = [];
  let 블록 = false;
  for (let 줄 of 원본줄들) {
    let 나감 = "", 따옴 = "";
    for (let i = 0; i < 줄.length; i++) {
      const ch = 줄[i], 다음 = 줄[i + 1];
      if (블록) { if (ch === "*" && 다음 === "/") { 블록 = false; i++; } continue; }
      if (따옴) {
        if (ch === "\\") { i++; continue; }
        if (ch === 따옴) 따옴 = "";
        continue;
      }
      if (ch === "/" && 다음 === "*") { 블록 = true; i++; continue; }
      if (ch === "/" && 다음 === "/") break;            // 줄 끝까지 주석
      if (ch === '"' || ch === "'" || ch === "`") { 따옴 = ch; continue; }
      나감 += ch;
    }
    밖.push(나감);
  }
  return 밖;
}

/** 함수 밖(중괄호 깊이 0)에서 그 이름을 쓰는 줄을 찾는다 */
function 맨위에서읽는곳(파일, 이름들) {
  const 원본 = fs.readFileSync(파일, "utf8").split(줄나눔);
  const 줄 = 껍데기만(원본);
  const 걸림 = [];
  let 깊이 = 0;
  for (let i = 0; i < 줄.length; i++) {
    if (깊이 === 0) {
      for (const s of 이름들) {
        if (new RegExp("\\b" + s + "\\b").test(줄[i])) {
          걸림.push((i + 1) + "행 " + s + " — " + 원본[i].trim().slice(0, 70));
          break;
        }
      }
    }
    for (const ch of 줄[i]) { if (ch === "{") 깊이++; else if (ch === "}") 깊이--; }
    if (깊이 < 0) 깊이 = 0;
  }
  return 걸림;
}

/**
 * clasp 이 안 올리는 폴더는 볼 것이 없다.
 * 그 파일들은 프로젝트에 들어가지도 않으니 _secrets 와 마주칠 일이 없다.
 */
function 빼는폴더들(뿌리) {
  const 뺄것 = {};
  const p = path.join(뿌리, ".claspignore");
  if (!fs.existsSync(p)) return 뺄것;
  for (const 줄 of fs.readFileSync(p, "utf8").split(줄나눔)) {
    const t = 줄.trim();
    if (!t || t[0] === "#") continue;
    const m = t.match(/^(.+)\/\*\*$/);   // "이름/**" 꼴만
    if (m) 뺄것[m[1]] = true;
  }
  return 뺄것;
}

function 훑기(뿌리, 뺄것, 모음) {
  for (const e of fs.readdirSync(뿌리, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (/node_modules|scratch/i.test(e.name)) continue;
    const f = path.join(뿌리, e.name);
    if (e.isDirectory()) {
      if (뺄것[e.name]) continue;                                    // clasp 이 안 올린다
      if (fs.existsSync(path.join(f, ".clasp.json"))) continue;      // 다른 프로젝트다
      훑기(f, 뺄것, 모음); continue;
    }
    if (!/\.gs$/.test(e.name)) continue;
    if (e.name === "_secrets.gs") continue;   // 값을 «담는» 곳이니 당연히 맨 위다
    모음.push(f);
  }
  return 모음;
}

const 뿌리 = __dirname;
const 이름들 = 비밀이름들(뿌리);
const 파일들 = 훑기(뿌리, 빼는폴더들(뿌리), []);
console.log("비밀 이름 " + 이름들.length + "개 · .gs " + 파일들.length + "개를 봅니다");

let 걸린파일 = 0;
for (const f of 파일들) {
  const 걸림 = 맨위에서읽는곳(f, 이름들);
  if (걸림.length) {
    걸린파일++;
    check(path.relative(뿌리, f) + " 는 함수 밖에서 비밀값을 읽는다", false, 걸림.join(" / "));
  }
}
check("함수 밖에서 비밀값을 읽는 파일이 없다", 걸린파일 === 0);

/* 고친 자리가 그대로 있는지 — 되돌아가면 알림이 또 조용히 죽는다 */
const chat = path.join(뿌리, "_partnerChatNotify.gs");
if (fs.existsSync(chat)) {
  const t = fs.readFileSync(chat, "utf8");
  check("챗 알림은 보낼 때 주소를 읽는다 (_chat_url_)", t.indexOf("function _chat_url_(") >= 0);
  const 밖 = 껍데기만(t.split(줄나눔)).join(" ");
  check("옛 _CHAT_WEBHOOK_URL_ 상수는 안 남아 있다", 밖.indexOf("_CHAT_WEBHOOK_URL_") < 0);
}

console.log("");
console.log(fail === 0 ? "✅ 통과 " + pass + "건" : "❌ 실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);