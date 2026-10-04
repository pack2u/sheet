/**
 * 임시기록 택배사 — 자사출고가 롯데로 찍히던 것
 *
 *  > "임시기록에 우리 자사출고들이 택배사가 롯데로 들어가는데
 *  >  로젠으로 들어가게 해줘"
 *
 *  ★ 왜 롯데가 찍혔나 ★
 *    임시기록 V열(택배사)을 정할 때 «송장을 어디서 걷었나»를 버리고
 *    W열 업체prefix 부터 봤다. 그 접두는 «그 물건이 누구 상품인가»일 뿐
 *    «누가 부쳤나»가 아니다. 우리가 자사출고한 냅킨코리아(NK) 물건에
 *    「업체_택배사」 표의 NK=롯데택배가 그대로 찍혔다.
 *
 *    허브 줄은 진작 출처를 보고 있었다(_po_carrierFromPicked_).
 *    임시기록만 그 길이 끊겨 있었다.
 *
 * 실행: node _tempcarrier_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

function extractFrom(file, decl, openCh, closeCh) {
  const src = fs.readFileSync(file, "utf8");
  const at = src.indexOf(decl);
  if (at < 0) throw new Error("못 찾음: " + decl + " (" + file + ")");
  const open = src.indexOf(openCh, at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error("닫는 기호 없음: " + decl);
}
const fnFrom = (file, name) => extractFrom(file, "function " + name + "(", "{", "}");

const O = "_partnerOrders.gs";
const P = "_partnerExclusivePush.gs";
const orders = fs.readFileSync(O, "utf8");

const ctx = {
  Logger: { log() {} },
  console,
};
vm.createContext(ctx);
vm.runInContext(
  [
    "var _PO_TEMP_UID_COL_ = 15;",
    "var _PO_TEMP_CARRIER_COL_ = 21;",
    "var _PO_TEMP_PFX_COL_ = 22;",
    "var _PO_TEMP_INV_COL_ = 23;",
    "function _pt_allowSingleFieldMatch_() { return false; }",
    fnFrom(O, "_po_invKey_"),
    fnFrom(O, "_po_claimInvoice_"),
    fnFrom(O, "_po_claimInvoiceMulti_"),
    fnFrom(O, "_po_isExclusiveFormSrc_"),
    fnFrom(O, "_po_pickUnusedInvoice_"),
    fnFrom(O, "_po_resolveTempTabInvoice_"),
    fnFrom(P, "_pep_carrierFromSource_"),
  ].join("\n\n"),
  ctx,
);

/* ── [1] 고른 송장이 «어디서 왔는지»를 말하는가 ─────────── */
console.log("\n[1] 송장을 고를 때 출처를 같이 내놓는가");
{
  const found = [{ invRaw: "123456789012", src: "★최우선(로젠주문실적)" }];
  const out = {};
  const inv = ctx._po_pickUnusedInvoice_(found, {}, "U1", null, out);
  eq("송장은 그대로", inv, "123456789012");
  eq("★ 출처가 따라 나온다", out.src, "★최우선(로젠주문실적)");
}
{
  //  outSrc 를 안 줘도 종전처럼 돈다
  const inv = ctx._po_pickUnusedInvoice_([{ invRaw: "9", src: "롯데택배" }], {}, "U1");
  eq("★ 그릇을 안 줘도 안 터진다", inv, "9");
}
{
  //  이미 남이 쓴 송장이면 빈 값 — 출처도 안 남긴다
  const used = {};
  ctx._po_claimInvoice_(used, "777", "다른주문");
  const out = {};
  eq("남의 송장은 안 준다", ctx._po_pickUnusedInvoice_([{ invRaw: "777", src: "롯데택배" }], used, "U1", null, out), "");
  eq("★ 못 골랐으면 출처도 없다", out.src === undefined, "true");
}

/* ── [2] 임시기록 풀이가 출처를 밖으로 넘기는가 ─────────── */
console.log("\n[2] 임시기록 한 줄을 풀 때");
const 임시줄 = (uid, pfx) => {
  const r = new Array(26).fill("");
  r[3] = "NK0001";           // D열 품목코드 (냅킨코리아 상품)
  r[12] = "홍길동";           // M열 거래처명
  r[15] = uid;               // P열 사방넷주문번호
  r[22] = pfx || "NK";       // W열 업체prefix
  return r;
};
{
  const map = { U7: [{ invRaw: "500011112222", src: "★최우선(로젠주문실적)" }] };
  const out = {};
  const inv = ctx._po_resolveTempTabInvoice_(임시줄("U7"), map, {}, {}, "U7", out);
  eq("송장을 찾는다", inv, "500011112222");
  eq("★ 로젠 실적탭에서 왔다고 말한다", out.src, "★최우선(로젠주문실적)");
}
{
  const map = { U8: [{ invRaw: "600011112222", src: "롯데택배" }] };
  const out = {};
  ctx._po_resolveTempTabInvoice_(임시줄("U8"), map, {}, {}, "U8", out);
  eq("★ 롯데 탭에서 온 것도 그대로 말한다", out.src, "롯데택배");
}
{
  //  업체 전용양식에서 온 것
  const map = { U9: [{ invRaw: "700011112222", src: "NK/전용양식" }] };
  const out = {};
  ctx._po_resolveTempTabInvoice_(임시줄("U9"), map, {}, {}, "U9", out);
  eq("★ 업체 전용양식 출처도 그대로", out.src, "NK/전용양식");
}

/* ── [3] 출처 → 택배사 ──────────────────────────────────── */
console.log("\n[3] 출처가 택배사를 말해 주는가");
{
  eq("★ 로젠 실적탭 → 로젠택배",
    ctx._pep_carrierFromSource_("★최우선(로젠주문실적)"), "로젠택배");
  eq("롯데 탭 → 롯데택배", ctx._pep_carrierFromSource_("롯데택배"), "롯데택배");
  eq("★ 업체 전용양식은 택배사를 «모른다»", ctx._pep_carrierFromSource_("NK/전용양식"), "");
  eq("「대리공급」도 모른다", ctx._pep_carrierFromSource_("대리공급"), "");
  eq("합배송전용도 모른다", ctx._pep_carrierFromSource_("합배송전용"), "");
}

/* ── [4] 자사출고 한 줄이 끝까지 로젠으로 가는가 ────────── */
console.log("\n[4] 우리가 부친 냅킨코리아(NK) 물건 한 줄");
{
  //  V열을 채우는 규칙을 그대로 옮겨 본다 — 출처가 먼저, 없으면 행 기반
  function V열값(src, 행기반폴백) {
    let tc = "";
    if (src) tc = ctx._pep_carrierFromSource_(src);
    if (!tc) tc = 행기반폴백;
    return tc;
  }
  //  행 기반 폴백은 W열 NK → 「업체_택배사」 표 → 롯데택배 다
  eq("★ 로젠 실적탭에서 걷힌 줄은 로젠택배",
    V열값("★최우선(로젠주문실적)", "롯데택배"), "로젠택배");
  eq("★ 업체가 부친 줄은 여태처럼 업체 택배사",
    V열값("NK/전용양식", "롯데택배"), "롯데택배");
  eq("출처를 모르면 여태처럼 행 기반",
    V열값("", "롯데택배"), "롯데택배");
}

/* ── [5] 배선이 실제로 그렇게 되어 있는가 ───────────────── */
console.log("\n[5] 코드에 그 길이 나 있는가");
{
  ok("★ 고르는 자가 outSrc 를 받는다",
    orders.indexOf("function _po_pickUnusedInvoice_(found, usedInvSet, owner, srcOk, outSrc)") >= 0);
  ok("★ 임시기록 풀이가 outSrc 를 받는다",
    orders.indexOf("function _po_resolveTempTabInvoice_(row, invoiceMap, hubInvoiceByKey, usedInvSet, owner, outSrc)") >= 0);
  ok("★ 부르는 쪽이 그릇을 준다", orders.indexOf("var _srcOut = {};") >= 0);
  ok("★ updates 에 출처가 실린다", orders.indexOf("src: _srcOut.src || \"\"") >= 0);
  ok("★ 2차 폴백도 출처를 싣는다", orders.indexOf("src: String((hit && hit.source) || \"\")") >= 0);

  //  출처 판정이 «행 기반 폴백보다 앞»에 서야 한다. 뒤면 아무 소용이 없다.
  const 앞 = orders.indexOf("_pep_carrierFromSource_(updates[ui].src)");
  const 뒤 = orders.indexOf("if (!_tc) _tc = _po_carrierForTempRow_(tempData[idx]);");
  ok("★ 출처가 행 기반보다 앞에 선다", 앞 > 0 && 뒤 > 0 && 앞 < 뒤);

  //  W열만 보던 옛 줄이 남아 있으면 안 된다
  ok("★ 옛 줄(출처를 안 보던 것)이 없다",
    orders.indexOf("var _tc = _po_carrierForTempRow_(tempData[idx]);") < 0);
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
