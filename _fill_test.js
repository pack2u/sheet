/**
 * 늦게 온 송장을 «빈 칸에만» 채운다
 *
 *  > "당분간은 미매칭부분에도 들어올 송장이 있으면 송장이 들어오게 해야되"
 *  > "나, 7일...."      (나 = 송장 전파 때 · 7일)
 *
 *  같은 날 소급 보강을 통째로 지웠다. 지우라고 하신 까닭은
 *  «지금 코드로는 제대로 못 고치니까»였다. 그러니 되살리되 좁게 해야 한다.
 *
 *  ★ 지켜야 할 것 ★
 *    · 마감(20:00) 안에서 안 돈다 — 6분을 나눠 쓰지 않는다
 *    · 송장맵은 «송장원장 하나»로만 — 파일을 더 열지 않는다
 *    · 고유ID 로만 — 이름·전화로 더듬지 않는다
 *    · «빈 칸»만 — 이미 든 것은 절대 안 건드린다
 *    · 기준일 이전은 안 연다
 *    · 채운 건수를 말한다
 *
 * 실행: node _fill_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}
function grab(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const 코드만 = (s) => s.split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const fill = fs.readFileSync("_partnerInvoiceFill.gs", "utf8");
const pep = fs.readFileSync("_partnerExclusivePush.gs", "utf8");

console.log("\n[1] ★ 7일 · 기준일 이전은 안 연다");
{
  check("★ 7일", /var _PIF_DAYS_ = 7;/.test(fill), true);
  const 몸 = 코드만(grab(fill, "partnerFillBlankInvoices"));
  check("★ 기준일을 본다", 몸.indexOf("_pep_afterStart_(dateStr)") >= 0, true);
  check("★ 안 본 날을 센다", 몸.indexOf("out.skippedOld++") >= 0, true);
  check("★ 오늘(d=0)부터 본다", /for \(var d = 0; d <= days/.test(몸), true);
}

console.log("\n[2] ★ 송장맵은 «송장원장 하나»로만");
{
  const 몸 = 코드만(grab(fill, "partnerFillBlankInvoices"));
  check("★ 원장에서 만든다", 몸.indexOf("_pil_addToInvoiceMap_(map)") >= 0, true);
  check("★ 로젠 실적탭을 안 연다", 몸.indexOf("_pep_loadOwnCarrierInvoices_") < 0, true);
  check("★ 허브를 안 연다", 몸.indexOf("_PO_HUB_SHEET_NAME") < 0, true);
  check("★ 원장이 비면 그렇게 말하고 그만둔다",
    몸.indexOf("송장원장이 비어 있습니다") >= 0, true);
}

console.log("\n[3] ★ «빈 칸»만 채운다 — 이미 든 것은 안 건드린다");
{
  const 몸 = 코드만(grab(fill, "_pif_fillOneDay_"));
  check("★ 이미 송장이 있으면 건너뛴다",
    /if \(cur && _pep_normInvoiceNo_\(cur\)\) continue;/.test(몸), true);
  check("★ 칸을 통째로 다시 쓰지 않는다", 몸.indexOf("setValues(") < 0, true);
  check("★ 바뀐 줄만 한 칸씩 쓴다", 몸.indexOf("setValue(f.inv)") >= 0, true);
  check("★ 출처가 든 자리는 안 덮는다",
    /if \(srcIdx >= 0 && !String\(all\[f\.row - 1\]\[srcIdx\]/.test(몸), true);
}

console.log("\n[4] ★ 고유ID 로만 — 이름·전화로 더듬지 않는다");
{
  const 몸 = 코드만(grab(fill, "_pif_fillOneDay_"));
  check("★ 진짜 고유ID 인지 본다", 몸.indexOf("_pep_isRealUid_(key)") >= 0, true);
  check("★ UID 로 맞은 것만 쓴다", /if \(어떻게\.via !== "UID"\) continue;/.test(몸), true);
  check("이름·전화 키를 안 만든다", 몸.indexOf("_pep_addNamePhoneInvoiceKeys_") < 0, true);
}

console.log("\n[5] ★ 마감(20:00)이 아니라 17:00 에 돈다");
{
  const evening = fs.readFileSync("_ecountPurchaseDaily.gs", "utf8");
  check("★ 17:00 함수가 부른다", evening.indexOf("_pif_scheduled_()") >= 0, true);
  check("★ 실패해도 저녁 일이 끝난다",
    /log\.push\("늦은 송장 채우기 실패: " \+ e3\.message\)/.test(evening), true);
  check("★ 마감 본체는 안 부른다", pep.indexOf("_pif_scheduled_") < 0, true);
  check("★ 마감 본체가 채우기를 안 부른다", pep.indexOf("partnerFillBlankInvoices") < 0, true);
}

console.log("\n[6] ★ 조용히 고치지 않는다");
{
  const 몸 = 코드만(grab(fill, "_pif_scheduled_"));
  check("★ 채웠으면 말한다", 몸.indexOf("r.patched > 0") >= 0, true);
  check("★ 못 읽었어도 말한다", 몸.indexOf("r.notes && r.notes.length > 0") >= 0, true);
  check("★ 0건이고 탈 없으면 조용하다", /if \(!말할까\) return;/.test(몸), true);
  check("★ 돌지 못했으면 그것도 말한다",
    몸.indexOf("«돌지 못했습니다»") >= 0, true);
}

console.log("\n[7] 손으로도 돌릴 수 있다");
{
  const menu = fs.readFileSync("_partnerMenu.gs", "utf8");
  check("메뉴에 있다", menu.indexOf("partnerFillBlankInvoicesMenu") >= 0, true);
  check("함수가 있다", fill.indexOf("function partnerFillBlankInvoicesMenu") >= 0, true);
}

console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
