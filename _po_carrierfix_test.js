/**
 * 이미 송장이 찍힌 줄의 택배사 다시 계산
 *
 *  > "송장 수집 한번 돌려볼게 이후 정기 수집시간에."
 *  > "2"  (= 송장 있는 줄을 전부 다시 계산)
 *
 *  매칭 루프는 송장이 이미 있는 줄을 건너뛴다. 맞는 동작이지만 그 바람에
 *  택배사도 같이 건너뛰어, 판정 규칙을 고쳐도 옛 줄은 틀린 채로 남았다.
 *  (아주팩 AJ158TANG00003 이 12자리 송장이라 「롯데택배」로 찍혀 있었다)
 *
 *  지켜야 할 것
 *    · 송장이 있는 줄만 다시 본다
 *    · 값이 «나온 것»만 덮는다 — 빈 판정으로 기존 값을 지우지 않는다
 *    · 같은 값이면 안 건드린다 (쓸데없는 쓰기·carrierChanged 방지)
 *
 * 실행: node _po_carrierfix_test.js
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

const src = fs.readFileSync("_partnerOrders.gs", "utf8");

//  ── 소스 안에 그 갈래가 실제로 있는지부터 ──
console.log("");
console.log("[소스] 다시 계산하는 갈래가 붙어 있는가");
check("★ 송장 있는 줄만 본다",
  src.indexOf("if (!_po_hasRealInvoice_(hubData[_ci][13])) continue;") >= 0, true);
check("★ 빈 판정이면 안 덮는다",
  src.indexOf("if (!_newCar) continue;") >= 0, true);
check("★ 출처를 아는 척하지 않는다 (빈 문자열)",
  src.indexOf('_po_carrierForHubRow_("", hubData[_ci])') >= 0, true);
check("★ 몇 건 고쳤는지 말한다",
  src.indexOf("이미 찍힌 줄 다시 계산") >= 0, true);

//  ── 그 갈래를 떼어 내 실제로 돌려 본다 ──
const i0 = src.indexOf("var _carrierFixed = 0;");
const i1 = src.indexOf("  // ★ 2026-07-09: M/N/O열 배치 쓰기", i0);
if (i0 < 0 || i1 < 0) { console.error("갈래를 못 떼어 냄"); process.exit(1); }
const 갈래 = src.slice(i0, i1);

//  N열(13)=송장번호, R열(17)=택배사, B열(1)=발주업체, E열(4)=이카운트코드
const 행 = (inv, carrier, vendor, code) => {
  const r = new Array(18).fill("");
  r[13] = inv; r[17] = carrier; r[1] = vendor; r[4] = code;
  return r;
};
//  아주팩=한진택배, 뉴파츠=로젠택배, 모르는업체=판정 불가
const 표 = { 아주팩: "한진택배", 뉴파츠: "로젠택배" };

function 돌려보기(rows) {
  const ctx = {
    hubData: rows,
    carrierChanged: false, hubChanged: false, scannedLogs: [],
    _PO_HUB_CARRIER_COL_: 17,
    _po_hasRealInvoice_: function (v) { return !!String(v || "").trim(); },
    _po_carrierForHubRow_: function (src, row) { return 표[row[1]] || ""; },
  };
  vm.createContext(ctx);
  vm.runInContext(갈래, ctx);
  return ctx;
}

console.log("");
console.log("[동작] 틀린 값을 고친다");
{
  const rows = [행("463273768403", "롯데택배", "아주팩", "AJ158TANG00003")];
  const c = 돌려보기(rows);
  check("★ 아주팩 줄의 롯데택배 → 한진택배", rows[0][17], "한진택배");
  check("고쳤다고 표시한다", c.carrierChanged, true);
  check("몇 건인지 말한다", c.scannedLogs[0].indexOf("1건 고침") >= 0, true);
}

console.log("");
console.log("[동작] 지우지 않는다");
{
  const rows = [행("45161625412", "로젠택배", "모르는업체", "ZZ0001")];
  const c = 돌려보기(rows);
  check("★ 판정이 안 되면 적힌 값을 그대로 둔다", rows[0][17], "로젠택배");
  check("건드린 게 없으면 쓰지도 않는다", c.carrierChanged, false);
}

console.log("");
console.log("[동작] 손댈 필요 없는 줄");
{
  const rows = [
    행("", "", "아주팩", "AJ158TANG00003"),              // 송장 없음
    행("45161625412", "한진택배", "아주팩", "AJ1"),       // 이미 맞음
  ];
  const c = 돌려보기(rows);
  check("★ 송장 없는 줄은 안 본다", rows[0][17], "");
  check("이미 맞은 줄은 그대로", rows[1][17], "한진택배");
  check("쓸 일이 없으면 carrierChanged 도 그대로", c.carrierChanged, false);
}

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
