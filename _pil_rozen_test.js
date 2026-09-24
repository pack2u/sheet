/**
 * 송장원장 — 덮어써지는 로젠 자사출고를 담는가
 *
 *  > "판매현황을 전체분을 안넣으면 마지막 차수 판매현황 내용의 송장만 들어오더라구"
 *
 *  ★ 왜 마지막 차수만 들어왔나 ★
 *    「입력_로젠주문실적」 탭은 회차마다 «덮어써진다» — 그날 것만, 마지막 차수 것만.
 *    2026-09-11 에 자사출고를 로젠으로 바꾸면서 이 원천이 «사라지는 것»이 됐다.
 *    송장원장은 바로 그런 것을 담으라고 있는 모듈인데, 머리주석이
 *    「롯데·1주출고는 이미 영구 누적되므로 담지 않는다」로 서 있었고
 *    로젠은 아예 목록에 없었다. 그래서 1·2차 송장은 3차 파일이 덮는 순간
 *    영영 사라졌고, 사람이 판매현황을 «전체분» 다시 넣어 억지로 되살리고 있었다.
 *
 *  지켜야 할 것
 *    · 로젠을 «먼저» 담는다 (덮어써지기 전에)
 *    · 자리는 허브 _PT_ROZEN_FIXED_COL 과 같아야 한다
 *    · 마스킹된 전화는 담지 않는다
 *    · 한 원천이 실패해도 나머지는 담는다
 *    · 몇 건 담았는지 말한다
 *
 * 실행: node _pil_rozen_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const pil = fs.readFileSync("_partnerInvoiceLedger.gs", "utf8");
const help = fs.readFileSync("_partnerHelpers.gs", "utf8");

function 칸(본문, 시작말, name) {
  const p0 = 본문.indexOf(시작말);
  if (p0 < 0) return null;
  const 조각 = 본문.slice(p0, p0 + 1800);
  const key = name + ":";
  const p = 조각.indexOf(key);
  if (p < 0) return null;
  const t = 조각.slice(p + key.length).split(",")[0].split("//")[0].trim();
  const v = parseInt(t, 10);
  return isNaN(v) ? null : v;
}

console.log("");
console.log("[담는가] 로젠이 수집 대상에 들어왔는가");
check("★ 수확 함수가 있다", pil.indexOf("function _pil_harvestRozen_(") >= 0, true);
check("★ 로젠을 «먼저» 부른다 (덮어써지기 전에)",
  pil.indexOf("_pil_harvestRozen_(harvested, stat);") <
  pil.indexOf("_pil_harvestTemp_(harvested, stat);"), true);
check("한 원천이 실패해도 나머지는 담는다",
  pil.indexOf('catch (eRz) { stat.errors.push("로젠: " + eRz.message); }') >= 0, true);
check("머리주석이 까닭을 적고 있다",
  pil.indexOf("회차마다 «덮어써진다»") >= 0, true);

console.log("");
console.log("[한 군데] 자리는 허브와 같은 것을 쓴다");
check("★ _PT_ROZEN_FIXED_COL 을 그대로 쓴다",
  pil.indexOf("_PT_ROZEN_FIXED_COL") >= 0, true);
check("허브 자리표가 아직 J(9)", 칸(help, "var _PT_ROZEN_FIXED_COL", "uid"), 9);
check("허브 자리표가 아직 K(10)", 칸(help, "var _PT_ROZEN_FIXED_COL", "invoice"), 10);

console.log("");
console.log("[말한다] 몇 건 담았는지");
check("stat 에 자리가 있다", pil.indexOf("var stat = { rozen: 0,") >= 0, true);
check("★ 결과에 적는다", pil.indexOf("로젠 자사출고에서 읽음: ") >= 0, true);

console.log("");
console.log("[실제] 사장님 화면의 줄을 그대로 넣어 본다");
{
  const i0 = pil.indexOf("function _pil_harvestRozen_(");
  let d = 0, seen = false, i1 = -1;
  for (let k = i0; k < pil.length; k++) {
    if (pil[k] === "{") { d++; seen = true; }
    else if (pil[k] === "}") { d--; if (seen && d === 0) { i1 = k + 1; break; } }
  }
  const 몸 = pil.slice(i0, i1);

  //  2026-09-15 실제 두 줄 (머리글 없음 — 1행부터 자료)
  const 자료 = [
    ["1", "집하", "2026-09-15", "", "X", "", "X", "30556066",
     "주식회사 팩투유", "2162784744", "451-6945-9705", "",
     "동수원", "북부천", "최유찬", "14***", "경기 부천시…"],
    ["2", "집하", "2026-09-15", "", "X", "", "X", "30556066",
     "주식회사 팩투유", "0915-PH-a1715", "451-6946-0195", "",
     "동수원", "동강동", "바우네나주곰탕", "05***", "서울 강동구…"],
  ];
  const tab = {
    getLastRow: () => 자료.length,
    getLastColumn: () => 17,
    getRange: () => ({ getDisplayValues: () => 자료 }),
  };
  const ctx = {
    _PT_ROZEN_FIXED_COL: { name: 14, phone: -1, invoice: 10, uid: 9, date: 2 },
    _PT_INVOICE_SHEET_ID: "x",
    _PT_PRIMARY_INVOICE_GID: 548505068,
    SpreadsheetApp: { openById: () => ({}) },
    _pt_getSheetByGidOrName_: () => tab,
    _pil_splitInv_: (v) => {
      const t = String(v || "").trim();
      return t ? [t] : [];
    },
  };
  vm.createContext(ctx);
  vm.runInContext(몸, ctx);
  const out = [], stat = { errors: [] };
  ctx._pil_harvestRozen_(out, stat);

  check("★ 두 줄 다 담는다 (머리글 없는 탭이라 1행도 자료)", out.length, 2);
  check("사방넷 건", [out[0].uid, out[0].inv], ["2162784744", "451-6945-9705"]);
  check("★ 전화주문(P-ID) 건도 담는다", [out[1].uid, out[1].inv],
    ["0915-PH-a1715", "451-6946-0195"]);
  check("수하인", out[0].name, "최유찬");
  check("집하일자", out[0].date, "2026-09-15");
  check("★ 마스킹된 전화는 안 담는다", out[0].phone, "");
  check("몇 건인지 센다", stat.rozen, 2);
}

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
