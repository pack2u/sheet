/**
 * 뉴파츠 업체코드 HR ↔ NP — 네 곳이 같은 말을 하는가
 *
 *  > "협력업체 중 허브로스팅(HR)을 뉴파츠(NP)로 수정을 했어"
 *  > "이카운트에서 바꿨어 둘 다 받게 해줘"
 *
 *  ★ 대표는 HR 이다 ★ 이카운트 품목코드가 HR 이라서. 세트분리가 찍을 때만
 *    NP 로 바꾸고, 받는 쪽은 전부 NP 를 HR 로 되읽는다.
 *
 *  네 곳이 짝을 이뤄야 한다 —
 *    ① 세트분리 core.js     HR → NP 로 찍는다
 *    ② 대리공급 Push        NP → HR 로 읽는다
 *    ③ v2 받은 발주         HR 로 물으면 HR·NP 둘 다 찾는다
 *    ④ v2 시트 거울 진단    NP 줄을 「없는 접두」라고 안 한다
 *  한 곳만 고치면 그 업체 줄이 통째로 사라진다.
 *
 * 실행: node _npalias_test.js
 */
const fs = require("fs"), path = require("path");

let fail = 0, pass = 0;
const 자리 = {
  core: path.join(__dirname, "세트분리V2", "core.js"),
  push: path.join(__dirname, "_partnerExclusivePush.gs"),
  seed: path.join(__dirname, "세트분리V2", "gasMasters.js"),
  v2push: "D:/Pack2U_협력업체시스템_v2/app/src/lib/vendor-v2.ts",
  v2mirror: "D:/Pack2U_협력업체시스템_v2/app/src/lib/sheet-mirror.ts",
};
const 읽기 = (k) => { try { return fs.readFileSync(자리[k], "utf8"); } catch (e) { return ""; } };

function 재보기(고침) {
  고침 = 고침 || {};
  const g = (k) => (고침[k] !== undefined ? 고침[k] : 읽기(k));
  const 운것 = [];

  /* ① 세트분리는 HR 을 NP 로 찍는다 */
  {
    const s = g("core");
    if (!s) 운것.push("①core.js를못읽음");
    else if (!/SS_VENDOR_PREFIX_ALIAS\s*=\s*\{\s*HR:\s*['"]NP['"]/.test(s)) 운것.push("①HR→NP로찍기");
  }

  /* ② 대리공급은 NP 를 HR 로 되읽는다 */
  {
    const s = g("push");
    if (!s) 운것.push("②Push를못읽음");
    else if (!/NP:\s*"HR"/.test(s)) 운것.push("②NP→HR로되읽기");
  }

  /* ③ 씨앗은 ★NP★ 로, 이름은 「뉴파츠」
   *
   *  ★ 내가 여기서 틀렸다 (2026-10-19) ★ 「코드는 HR 그대로 두어야 환산이
   *    두 번 안 일어난다」고 생각해 ['HR','뉴파츠'] 로 뒀다. 그런데 core.js
   *    ssVendorCode_ 는 이렇게 생겼다 —
   *        if (vendors[up]) return up;              // 표에 HR 이 있으면 그대로 HR
   *        var a = SS_VENDOR_PREFIX_ALIAS[up];
   *        if (a && vendors[a]) return a;           // ★표에 없을 때만★ 별칭
   *    ssm_seedVendors 는 씨앗에 있는 코드를 매 회차 표에 되살린다. 그래서
   *    씨앗에 HR 이 있으면 「대리발송업체」 탭에 HR 줄이 다시 생기고,
   *    표의 HR 이 별칭을 이겨 ★HR→NP 환산이 아예 안 걸린다★.
   *    씨앗이 NP 면 vendors["HR"] 가 없으니 별칭이 딱 한 번 걸린다.
   *    (세트분리 방이 ddfdb0b 로 바로잡아 주었다)
   */
  {
    const s = g("seed");
    if (!s) 운것.push("③씨앗을못읽음");
    else {
      if (!/\['NP',\s*'뉴파츠'\]/.test(s)) 운것.push("③씨앗이NP뉴파츠");
      //  ★ 씨앗에 HR 이 남으면 표가 별칭을 이긴다 ★
      const 자료 = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/\['HR',/.test(자료)) 운것.push("③씨앗에HR이남음");
      if (/허브로스팅/.test(자료)) 운것.push("③자료에옛이름남음");
    }
  }

  /* ③' 별칭이 걸리려면 표에 HR 이 없어야 한다 — 그 규칙을 코드에서 확인한다 */
  {
    const c = g("core");
    if (c && !/if \(vendors\[up\]\) return up;/.test(c)) 운것.push("③'표우선규칙이바뀜");
  }

  /* ④ v2 받은 발주 — HR 로 물으면 둘 다 찾는다 */
  {
    const s = g("v2push");
    if (!s) 운것.push("④v2push를못읽음");
    else {
      const m = s.match(/const 옛prefix[^=]*=\s*\{([\s\S]*?)\};/);
      if (!m) 운것.push("④옛prefix표없음");
      else {
        const 표 = m[1];
        if (!/HR:\s*\[[^\]]*"HR"[^\]]*"NP"[^\]]*\]/.test(표)) 운것.push("④HR이둘다찾기");
        //  준테크 것을 지우지 않았나 — 같이 사는 표다
        if (!/JT:\s*\[[^\]]*"JH"[^\]]*\]/.test(표)) 운것.push("④준테크가사라짐");
      }
    }
  }

  /* ⑤ v2 시트 거울 — NP 를 「없는 접두」라고 안 한다 */
  {
    const s = g("v2mirror");
    if (!s) 운것.push("⑤v2거울을못읽음");
    else {
      if (!/같은접두[^=]*=\s*\{\s*NP:\s*"HR"\s*\}/.test(s)) 운것.push("⑤NP를HR로봄");
      if (!/v2\.get\(열쇠\)\s*\?\?\s*v2\.get\(같은접두\[열쇠\]/.test(s)) 운것.push("⑤되읽기를실제로씀");
    }
  }

  /* ⑥ ★ 방향이 엇갈리지 않았나 ★ 한쪽이 NP→HR 인데 다른 쪽도 NP→HR 이면
         세트분리가 찍은 NP 가 아무 데도 안 간다. core 는 찍는 쪽이라 HR→NP 여야 한다. */
  {
    const c = g("core"), p = g("push");
    if (c && p && /SS_VENDOR_PREFIX_ALIAS\s*=\s*\{\s*NP:/.test(c)) 운것.push("⑥core가거꾸로");
    if (c && p && /_PEP_VENDOR_PREFIX_ALIAS_[\s\S]{0,400}?HR:\s*"NP"/.test(p)) 운것.push("⑥Push가거꾸로");
  }
  return 운것;
}

console.log("─ 뉴파츠 HR ↔ NP — 네 곳이 같은 말을 하나 ─\n");
const 운것 = 재보기();
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) pass = 11;
console.log(fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과");

console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const 깨기 = [
  ["세트분리가 NP 로 안 찍는다", { core: 읽기("core").replace(/SS_VENDOR_PREFIX_ALIAS\s*=\s*\{\s*HR:\s*'NP'\s*\}/, "SS_VENDOR_PREFIX_ALIAS = {}") }],
  ["대리공급이 NP 를 못 읽는다", { push: 읽기("push").replace(/NP:\s*"HR",/, "") }],
  /*  ★ 이것이 제일 중요한 깨기다 ★ 씨앗에 HR 을 되돌리면 ssm_seedVendors 가
      매 회차 표에 HR 줄을 되살리고, 표의 HR 이 별칭을 이겨 환산이 죽는다.
      겉으로는 아무 오류도 안 난다 — 그냥 계속 HR 로 찍힐 뿐이다.  */
  ["★ 씨앗에 HR 을 되돌린다 ★", { seed: 읽기("seed").replace(/\['NP', '뉴파츠'\]/, "['HR', '뉴파츠']") }],
  ["씨앗에 옛 이름이 남는다", { seed: 읽기("seed").replace(/\['NP', '뉴파츠'\]/, "['NP', '허브로스팅']") }],
  ["표 우선 규칙이 바뀐다", { core: 읽기("core").replace("if (vendors[up]) return up;", "if (false) return up;") }],
  ["★ v2 받은 발주가 HR 만 본다 ★", { v2push: 읽기("v2push").replace(/HR:\s*\["HR",\s*"NP"\],/, "") }],
  ["v2 가 준테크를 잃는다", { v2push: 읽기("v2push").replace(/JT:\s*\["JT", "JH", "BF", "NS"\],/, "") }],
  ["v2 거울이 NP 를 모른다", { v2mirror: 읽기("v2mirror").replace(/const 같은접두[^;]*;/, "const 같은접두: Record<string, string> = {};") }],
  ["v2 거울이 되읽기를 안 쓴다", { v2mirror: 읽기("v2mirror").replace(/v2\.get\(열쇠\) \?\? v2\.get\(같은접두\[열쇠\] \?\? ""\)/, "v2.get(열쇠)") }],
  ["★ 세트분리를 거꾸로 돌린다 ★", { core: 읽기("core").replace(/SS_VENDOR_PREFIX_ALIAS\s*=\s*\{\s*HR:\s*'NP'\s*\}/, "SS_VENDOR_PREFIX_ALIAS = { NP: 'HR' }") }],
];

let 안움 = 0;
for (const [이름, 고침] of 깨기) {
  const 바뀐것 = Object.keys(고침).some((k) => 고침[k] !== 읽기(k));
  if (!바뀐것) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운 = 재보기(고침);
  if (운.length) console.log("  ✔ 울었다 [" + 운.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(fail || 안움 ? 1 : 0);
