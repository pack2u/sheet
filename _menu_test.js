/**
 * 로컬 검증: 메뉴가 가리키는 함수가 실제로 있는가
 *
 *  메뉴 항목은 함수를 **이름 문자열**로 가리킨다. 오타가 나거나 함수를 지우면
 *  Apps Script 는 아무 말도 하지 않다가 **직원이 그 항목을 눌렀을 때** 죽는다.
 *  그래서 배포 전에 여기서 맞춰 본다.
 *
 *  반대 방향도 본다 — 메뉴에서 뺐는데 함수만 남은 것(고아 래퍼).
 *  그 자체는 해롭지 않지만 다음 사람이 "이건 어디서 쓰나" 하고 시간을 쓴다.
 *
 * 실행: node _menu_test.js
 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(label, ok, detail) {
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? "  →  " + detail : ""));
}

// ── 프로젝트의 모든 .gs 를 읽는다 (백업·별도 프로젝트 제외) ──
const SKIP = /^(backup_2026|CS_WebApp|Partner_WebApp|node_modules|\.git)/;
const gsFiles = fs.readdirSync(".")
  .filter(f => f.endsWith(".gs") && !SKIP.test(f));

const defined = new Map(); // 함수명 → 파일
for (const f of gsFiles) {
  const text = fs.readFileSync(f, "utf8");
  const re = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(text))) {
    if (!defined.has(m[1])) defined.set(m[1], f);
  }
}

const menuSrc = fs.readFileSync("_partnerMenu.gs", "utf8");

// ── 메뉴가 부르는 함수 이름 모으기 ──
// addItem("라벨", "함수명") 의 두 번째 인자
const wired = [];
const itemRe = /\.addItem\(\s*("(?:[^"\\]|\\.)*")\s*,\s*"([^"]+)"\s*\)/g;
let mi;
while ((mi = itemRe.exec(menuSrc))) {
  wired.push({ label: JSON.parse(mi[1]), fn: mi[2] });
}

console.log("[1] 메뉴 항목이 가리키는 함수가 모두 존재한다");
console.log("      메뉴 항목 " + wired.length + "개 · 프로젝트 함수 " + defined.size + "개");
const missing = wired.filter(w => !defined.has(w.fn));
missing.forEach(w => console.log("      → 없음: " + w.fn + "   (" + w.label + ")"));
check("깨진 메뉴 항목", missing.length === 0, missing.length + "건");

console.log("\n[2] 같은 함수를 두 항목이 가리키지 않는다 (중복 등록)");
const byFn = {};
wired.forEach(w => { (byFn[w.fn] = byFn[w.fn] || []).push(w.label); });
const dupes = Object.keys(byFn).filter(k => byFn[k].length > 1);
dupes.forEach(k => console.log("      → " + k + ": " + byFn[k].join("  |  ")));
check("중복 등록", dupes.length === 0, dupes.length + "건");

console.log("\n[3] 라벨이 겹치지 않는다 (같은 이름이 두 곳에 보이면 헷갈린다)");
const byLabel = {};
wired.forEach(w => { (byLabel[w.label] = byLabel[w.label] || []).push(w.fn); });
const dupLabels = Object.keys(byLabel).filter(k => byLabel[k].length > 1);
dupLabels.forEach(k => console.log("      → \"" + k + "\": " + byLabel[k].join(", ")));
check("중복 라벨", dupLabels.length === 0, dupLabels.length + "건");

console.log("\n[4] 발주시스템 메뉴에는 매일 쓰는 것만 둔다");
const daily = menuSrc.slice(
  menuSrc.indexOf('ui.createMenu("📦 대리발송 발주시스템")'),
  menuSrc.indexOf('ui.createMenu("💼 협력업체 관리")'));
const moved = [
  ["partnerRebuildSabangnetBulkUpload", "사방넷 대량등록 탭 갱신"],
  ["partnerApplySabangnetLotteHeaders", "사방넷 열배열(롯데) 적용"],
  ["partnerDiagnoseSalesDuplicates", "중복 점검 진단"],
];
const admin = menuSrc.slice(menuSrc.indexOf('ui.createMenu("💼 협력업체 관리")'));
moved.forEach(([fn, what]) => {
  check(what + " — 발주시스템에서 빠짐", daily.indexOf(fn) < 0);
  check(what + " — 관리에 있음", admin.indexOf(fn) >= 0);
});

console.log("\n[5] 관리 메뉴는 파트별 서브메뉴로만 구성한다");
/**
 * 각 `.addItem` 이 몇 겹째 서브메뉴 안에 있는지 센다.
 *
 * 메뉴 중첩은 괄호가 아니라 **`.addSubMenu(` 메서드 체인**으로 만들어진다.
 * (`ui.createMenu("A")` 는 그 자리에서 괄호가 닫히므로 범위를 만들지 않는다.)
 * 그래서 `.addSubMenu(` 가 연 괄호가 닫힐 때까지를 한 겹으로 본다.
 *
 * 라벨에 괄호가 들어 있으므로(`① 명세서 탭 생성 (현재 파일)`) 문자열은 건너뛴다.
 * 깊이 0 = 메뉴 최상위에 낱개로 붙은 항목.
 */
function scanMenuItems(body) {
  const items = [];
  const menus = []; // {name, depth} — depth 1 = 최상위 파트
  let paren = 0;
  const subAt = []; // .addSubMenu( 가 열린 괄호 깊이들
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < body.length && body[i] !== q) { if (body[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    if (c === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    if (body.startsWith(".addSubMenu(", i)) {
      i += ".addSubMenu".length;
      paren++; subAt.push(paren); i++;
      const nm = /^\s*ui\.createMenu\("((?:[^"\\]|\\.)*)"\)/.exec(body.slice(i, i + 200));
      if (nm) menus.push({ name: nm[1], depth: subAt.length });
      continue;
    }
    if (body.startsWith(".addItem(", i)) {
      const m = /^\.addItem\(\s*"((?:[^"\\]|\\.)*)"/.exec(body.slice(i, i + 400));
      if (m) items.push({ label: m[1], depth: subAt.length });
      i += ".addItem".length;
      paren++; i++;
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")") {
      if (subAt.length && subAt[subAt.length - 1] === paren) subAt.pop();
      paren--;
    }
    i++;
  }
  return { items: items, menus: menus };
}
const scanned = scanMenuItems(admin.slice(0, admin.lastIndexOf(".addToUi()")));
const adminItems = scanned.items;
check("관리 메뉴 항목을 읽어냈다", adminItems.length > 40, adminItems.length + "개");
const loose = adminItems.filter(it => it.depth < 1);
loose.forEach(l => console.log("      → 최상위 낱개 항목: " + l.label));
check("최상위 낱개 항목", loose.length === 0, loose.length + "건");

// 파트(최상위 서브메뉴) — 사람이 읽고 이해할 단위로 갈렸는가
const parts = scanned.menus.filter(m => m.depth === 1).map(m => m.name);
parts.forEach(p => {
  const n = adminItems.filter(it => it.depth >= 1).length;
  console.log("      · " + p);
});
check("파트 수가 한눈에 들어온다 (12개 이하)", parts.length <= 12, parts.length + "개");
check("파트마다 항목이 있다", parts.length > 0 && adminItems.length >= parts.length, "");

// 파트별 항목 수 — 한 파트에 너무 많이 몰리면 다시 갈라야 한다
console.log("\n      파트별 항목 수");
let cursor = 0;
const perPart = {};
scanned.menus.forEach(m => { if (m.depth === 1) perPart[m.name] = 0; });
{
  // 항목을 순서대로 훑으며 직전 최상위 파트에 귀속시킨다
  const seq = [];
  const body = admin.slice(0, admin.lastIndexOf(".addToUi()"));
  const rx = /\.addSubMenu\(\s*ui\.createMenu\("((?:[^"\\]|\\.)*)"\)|\.addItem\(\s*"((?:[^"\\]|\\.)*)"/g;
  let x, cur = null;
  const topNames = new Set(parts);
  while ((x = rx.exec(body))) {
    if (x[1] !== undefined) { if (topNames.has(x[1])) cur = x[1]; }
    else if (cur) perPart[cur]++;
  }
}
Object.keys(perPart).forEach(k => console.log("      · " + k + " — " + perPart[k] + "개"));
const bloated = Object.keys(perPart).filter(k => perPart[k] > 16);
bloated.forEach(k => console.log("      → 너무 많음: " + k + " (" + perPart[k] + "개)"));
check("한 파트에 16개 초과 없음", bloated.length === 0, bloated.length + "건");

console.log("\n[6] 삭제한 1회성 함수가 어디에도 남아 있지 않다");
const purged = [
  "partnerMigrateFromExisting", "partnerMigrateProtectionToWarning",
  "partnerMigrateK2ToSettings", "partnerMigrateToDataTab",
  "partnerTestZipCodeLookup", "testChatWebhook", "diagnosePepAliasMap",
  "createConsumerDiscountSheet", "createConsumerDiscountSheet5",
  "createConsumerDiscountSheet8", "createConsumerDiscountSheet10",
  "createConsumerDiscountSheetCustom", "createConsumerDiscountSheetWithRate_",
  "createVendorVlookupSheet", "debugTempRecordDiagnosis", "checkStatusTab",
  "diagnosePtListFiles", "retryFailedVendorScripts", "updateAllVendorScripts",
  "debugReinstallInvoiceMatch_NewParts_BuWon", "debugInvoiceMatchInjection",
  "partnerLightenOrderTabSpeed",
];
const stillThere = [];
for (const f of gsFiles) {
  const text = fs.readFileSync(f, "utf8");
  for (const p of purged) {
    if (new RegExp("\\b" + p.replace(/\$/g, "\\$") + "\\b").test(text)) {
      stillThere.push(p + " (" + f + ")");
    }
  }
}
stillThere.forEach(s => console.log("      → 남아 있음: " + s));
check("잔재", stillThere.length === 0, stillThere.length + "건");

console.log("\n[7] 모든 .gs 파일이 문법적으로 유효하다");
const vm = require("vm");
const broken = [];
for (const f of gsFiles) {
  try { new vm.Script(fs.readFileSync(f, "utf8"), { filename: f }); }
  catch (e) { broken.push(f + " :: " + e.message); }
}
broken.forEach(b => console.log("      → " + b));
check("문법 오류", broken.length === 0, broken.length + "건");

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
