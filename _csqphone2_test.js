/**
 * After CS — 거래처를 모르면 전화번호라도 뜨게
 *
 *  > "에프터 cs 에서 거래처없음이 뜨는데 업체나 전화번호가 뜨게 해줘"
 *
 *  바이토 통화가 자동으로 만드는 CS 문의는 vendor 를 customer 로 채우는데,
 *  전화표에 없고 contact_name 도 비면 ★null★ 이 되어 화면에 「(거래처 없음)」만
 *  떴다. 누구 전화였는지 알 길이 아예 없었다. 번호라도 적는다.
 *
 *  ★ 전화꼴은 «모르는 꼴이면 손대지 않는다» ★ 숫자를 임의로 끊으면 되걸 때
 *    틀린 번호가 된다. 보기 좋게 하려다 못 쓰게 만들지 않는다.
 *
 * 실행: node _csqphone2_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let fail = 0, pass = 0;
const 자리 = {
  fu: "D:/Pack2U_협력업체시스템_v2/app/src/lib/byto-call-followup.ts",
  home: path.join(__dirname, "CS_WebApp", "home.html"),
};
const 읽기 = (k) => { try { return fs.readFileSync(자리[k], "utf8"); } catch (e) { return ""; } };

/*  전화꼴을 ★진짜 돌린다★ — TS 에서 그 함수만 떼어 JS 로 돌린다. */
function 전화꼴만(글) {
  const i = 글.indexOf("export function 전화꼴(");
  if (i < 0) return null;
  let d = 0, seen = false, end = i;
  for (let k = i; k < 글.length; k++) {
    if (글[k] === "{") { d++; seen = true; }
    else if (글[k] === "}") { d--; if (seen && d === 0) { end = k + 1; break; } }
  }
  const js = 글.slice(i, end)
    .replace("export function", "function")
    .replace(/\(raw: string\): string/, "(raw)")
    .replace(/: string/g, "");
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(js + "\n;this.전화꼴 = 전화꼴;", ctx);
  return ctx.전화꼴;
}

function 재보기(고침) {
  고침 = 고침 || {};
  const g = (k) => (고침[k] !== undefined ? 고침[k] : 읽기(k));
  const 운것 = [];
  try {
    const fu = g("fu");

    /* ① 거래처를 모르면 번호를 넣는다 */
    if (!/const 보일이름 = customer \|\| \(번호다움 \? "📞 " \+ 전화꼴\(phone\) : ""\) \|\| null;/.test(fu))
      운것.push("①모르면번호를넣음");
    /*  ★ 번호다운 번호일 때만 ★ 통화기록에 「98」 같은 토막이 섞여 온다.
        「📞 98」로 띄우면 번호인 줄 알고 되걸게 된다.  */
    //  9자리 이상 ★또는★ 1588·1600 꼴 8자리 대표번호
    if (!/const 번호다움 = 숫자만\.length >= 9 \|\| \/\^1\[5-9\]/.test(fu))
      운것.push("①번호다움잣대");
    if (!/vendor: 보일이름,/.test(fu)) 운것.push("①그값을vendor에");
    //  ★ 이름이 있으면 이름이 먼저다 ★ 번호가 이름을 덮으면 안 된다
    if (/벤더|vendor: \(phone/.test(fu)) 운것.push("①번호가이름을덮음");

    /* ② 전화꼴 — 진짜 돌려서 본다 */
    const f = 전화꼴만(fu);
    if (!f) 운것.push("②전화꼴을못찾음");
    else {
      const 쌍 = [
        ["01012345678", "010-1234-5678"],
        ["010-1234-5678", "010-1234-5678"],
        ["0212345678", "02-1234-5678"],
        ["0311234567", "031-123-4567"],
        //  ★ 1588·1600 대표번호는 8자리다 — 실물에서 16009879 를 놓쳤다 (2026-10-19)
        ["16009879", "1600-9879"],
        ["1588-1234", "1588-1234"],
      ];
      for (const [넣은것, 바람] of 쌍) {
        if (f(넣은것) !== 바람) 운것.push("②" + 넣은것 + "→" + f(넣은것) + "(바람 " + 바람 + ")");
      }
      /*  ★ 모르는 꼴은 손대지 않는다 ★ 임의로 끊으면 되걸 때 틀린 번호가 된다  */
      const 모르는것 = ["1588", "", "+821012345678", "내선 203"];   // 1588 네 자리는 번호가 아니다
      for (const x of 모르는것) {
        const out = f(x);
        if (out !== String(x).trim()) 운것.push("②모르는꼴을건드림(" + x + "→" + out + ")");
      }
    }

    /* ③ 화면은 번호도 거래처도 없을 때만 「(거래처 없음)」 */
    {
      const h = g("home");
      if (!/esc\(c\.vendor \|\| '\(거래처 없음\)'\)/.test(h)) 운것.push("③마지막기댈곳");
    }
  } catch (e) {
    운것.push("터짐:" + e.message);
  }
  return 운것;
}

console.log("─ After CS — 거래처 없으면 전화번호 ─\n");
const 운것 = 재보기();
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) pass = 12;
console.log(fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과");

console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const FU = 읽기("fu"), H = 읽기("home");
const 깨기 = [
  ["옛 모양으로 — 모르면 null", { fu: FU.replace(/const 보일이름 = [^;]+;/, "const 보일이름 = customer || null;") }],
  ["★ 짧은 토막도 번호인 양 띄운다 ★", { fu: FU.replace(/const 번호다움 = [^;]+;/, "const 번호다움 = !!phone;") }],
  /*  1588·1600·1899 는 8자리 대표번호다. 자릿수만으로 가르면 이것을 잃는다 —
      되메우기 미리보기에서 16009879 가 「번호가 짧음」으로 빠져 알았다.  */
  ["대표번호(1600)를 잃는다", { fu: FU.replace(/if \(\/\^1\[5-9\][\s\S]{0,80}?\n/, "") }],
  ["★ 번호가 이름을 덮는다 ★", { fu: FU.replace(/const 보일이름 = [^;]+;/, 'const 보일이름 = (phone ? "📞 " + 전화꼴(phone) : "") || customer || null;') }],
  ["★ 모르는 꼴도 임의로 끊는다 ★", { fu: FU.replace('return String(raw ?? "").trim();', 'return d.replace(/^(\\d{3})(\\d{3,4})(\\d{4})$/, "$1-$2-$3") || d;') }],
  ["서울 번호를 휴대폰처럼 끊는다", { fu: FU.replace(/if \(\/\^02\\d\{7,8\}\$\/\.test\(d\)\)[^\n]*\n/, "") }],
  ["화면의 마지막 기댈 곳을 없앤다", { home: H.replace("esc(c.vendor || '(거래처 없음)')", "esc(c.vendor)") }],
];

let 안움 = 0;
for (const [이름, 고침] of 깨기) {
  if (!Object.keys(고침).some((k) => 고침[k] !== 읽기(k))) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운 = 재보기(고침);
  if (운.length) console.log("  ✔ 울었다 [" + 운.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(fail || 안움 ? 1 : 0);
