/**
 * 아주팩 송장 — 당일 메일만 보는가
 *
 *  > "당일 이메일만 검사를 해야지"
 *
 *  ★ 날짜를 두 번 거른다 ★
 *    ① 검색어 after:오늘
 *    ② 메일 한 통씩 날짜 — 한 스레드에 어제 메일이 같이 들어 있으면
 *       검색은 통과하고 메시지 루프가 그것까지 읽는다.
 *    ①만 있으면 ②의 구멍이 안 보인다. 그래서 둘 다 깨 본다.
 *
 * 실행: node _gmajday_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
const 소스 = fs.readFileSync(path.join(__dirname, "_partnerGmailInvoiceAJ.gs"), "utf8");

const 오늘 = new Date("2026-10-14T06:00:00Z");   // 서울 15:00
const 어제 = new Date("2026-10-13T06:00:00Z");

function 메일(날, 이름) {
  return {
    getFrom: () => "아주팩 <hspack2020@naver.com>",
    getDate: () => 날,
    getAttachments: () => [{
      getName: () => "택배송장_주식회사 팩투유.xlsx",
      copyBlob() { return { __이름: 이름 }; },
    }],
  };
}

function 틀(글, 메일들) {
  const 본것 = { query: "", 읽은엑셀: [] };
  const ctx = {
    console, Logger: { log() {} },
    Utilities: {
      /*  진짜 서울 시각으로 찍는다 — 이 시험의 핵심이 날짜라서 흉내 내면 뜻이 없다  */
      formatDate: (d) => {
        const s = new Date(d.getTime() + 9 * 3600 * 1000).toISOString();
        return s.slice(0, 4) + "/" + s.slice(5, 7) + "/" + s.slice(8, 10);
      },
    },
    GmailApp: {
      search: (q) => { 본것.query = q; return [{ getMessages: () => 메일들, addLabel() {} }]; },
      getUserLabelByName: () => null,
      createLabel: () => ({ addToThread() {} }),
    },
    SpreadsheetApp: { flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    __본것: 본것,
  };
  vm.createContext(ctx);
  vm.runInContext(글, ctx);
  /*  엑셀 읽기와 전용양식 찾기는 이 시험의 몫이 아니다 — 여기서 멈춘다.
      멈추기 직전까지 «몇 통을 읽었나»만 본다.  */
  vm.runInContext(
    "_gma_readXlsxFirstSheet_ = function (b) { __본것.읽은엑셀.push(b.__이름); return []; };" +
    "_gma_findAJExclusiveTab_ = function () { return null; };", ctx);
  const r = ctx._gma_processAJInvoiceMails_({ manual: false, dryRun: true });
  return { r: r, 본것: 본것 };
}

function 재보기(글) {
  const 운것 = [];
  try {
    const a = 틀(글 === undefined ? 소스 : 글, [메일(오늘, "오늘"), 메일(어제, "어제")]);
    if (!/after:2026\/10\/14/.test(a.본것.query)) 운것.push("①검색어가after:오늘");
    if (/newer_than/.test(a.본것.query)) 운것.push("①옛날수가남음");
    if (a.r.mailCount !== 1) 운것.push("②오늘것만센다(" + a.r.mailCount + ")");
    if (a.r.skippedOld !== 1) 운것.push("②어제것을건너뛴다(" + a.r.skippedOld + ")");
    if (a.본것.읽은엑셀.join() !== "오늘") 운것.push("②어제엑셀을읽음(" + a.본것.읽은엑셀.join() + ")");

    //  오늘 것만 있으면 그대로 다 읽는다
    const b = 틀(글 === undefined ? 소스 : 글, [메일(오늘, "오늘")]);
    if (b.r.mailCount !== 1) 운것.push("③오늘것은읽는다");
    if (b.r.skippedOld !== 0) 운것.push("③괜히건너뜀");

    //  어제 것만 있으면 한 통도 안 읽는다
    const c = 틀(글 === undefined ? 소스 : 글, [메일(어제, "어제")]);
    if (c.r.mailCount !== 0) 운것.push("④어제만있으면0건");
    if (c.본것.읽은엑셀.length !== 0) 운것.push("④어제엑셀을읽음");
  } catch (e) {
    운것.push("터짐:" + e.message);
  }
  return 운것;
}

console.log("─ 아주팩 송장 — 당일만 ─\n");
const 운것 = 재보기();
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) pass = 9;
console.log(fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과");

console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const 깨기 = [
  ["당일만 끄기", (s) => s.replace("var _GMA_TODAY_ONLY_ = true;", "var _GMA_TODAY_ONLY_ = false;")],
  ["검색어만 옛날로 (메일별 날짜는 남김)", (s) => s.replace(
    '(_GMA_TODAY_ONLY_ ? "after:" + 오늘 : "newer_than:" + _GMA_LOOKBACK_DAYS + "d")',
    '("newer_than:" + _GMA_LOOKBACK_DAYS + "d")')],
  ["★ 메일별 날짜 확인만 뺀다 (검색어는 그대로) ★", (s) => s.replace(
    /if \(_GMA_TODAY_ONLY_\) \{\s*\n\s*var 온날[\s\S]*?\n      \}/, "")],
];

let 안움 = 0;
for (const [이름, f] of 깨기) {
  const 깬것 = f(소스);
  if (깬것 === 소스) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운 = 재보기(깬것);
  if (운.length) console.log("  ✔ 울었다 [" + 운.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(fail || 안움 ? 1 : 0);
