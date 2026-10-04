/**
 * 발주 고유ID — 난수가 아니라 «그날의 번호표»   d0922000001
 *
 *  > "그냥 사방넷처럼 하자..걍 숫자로도 수백만개의 고유아이디를 적용하는데"
 *  > "날짜 자채가 새로운 넘버링인데.."
 *  > "전화주문은 p로 시작 대리판매는 d로 시작.. 뒤 여섯자리는 동일"
 *
 *  난수는 확률게임이다. 뒷자리 넉 자(65,536가지)로 하루 184건을 뽑으면
 *  그날 겹칠 확률이 22.7% — 나흘에 한 번꼴이었고, 겹친 줄은 «조용히» 빠졌다.
 *  날짜는 이미 윗자리 카운터이므로 아랫자리도 세면 겹침이 구조적으로 없다.
 *
 * 실행: node _pouid_test.js
 */
const fs = require("fs"), path = require("path"), vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "_partnerOrders.gs"), "utf8");
const 토막 = [
  src.match(/var _PO_UID_SERIAL_ = \{[^}]*\};/)[0],
  src.match(/function _po_newUid_\(taken\) \{[\s\S]*?\n\}/)[0],
  src.match(/function _po_isGeneratedUid_\(uid\) \{[\s\S]*?\n\}/)[0],
].join("\n");

let 오늘 = "20260922";
const box = vm.createContext({
  //  formatDate 는 부르는 쪽이 준 무늬대로 돌려준다 (yyyyMMdd · MMdd)
  Utilities: {
    formatDate: (d, tz, 무늬) => (무늬 === "MMdd" ? 오늘.substring(4) : 오늘),
    //  옛 갈래는 난수를 쓴다 — 시늉만 내면 «번호표가 아님»을 못 가린다
    getUuid: () => Math.random().toString(16).slice(2, 10) + "-abcd",
  },
  console: console,
});
vm.runInContext(토막, box);
const 뽑기 = (taken) => vm.runInContext("_po_newUid_", box)(taken);
const 발급인가 = (u) => vm.runInContext("_po_isGeneratedUid_", box)(u);
const 되감기 = () => vm.runInContext("_PO_UID_SERIAL_ = { 날: '', 다음: 0 };", box);

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

console.log("\n① 빈 허브 — 1번부터");
되감기();
{
  const a = 뽑기({}), b = 뽑기({}), c = 뽑기({});
  console.log("   " + [a, b, c].join("   "));
  ok("d0922000001 로 시작", a === "d0922000001", a);
  ok("1씩 오른다", b === "d0922000002" && c === "d0922000003");
}

console.log("\n② 이미 오늘 것이 있으면 그 다음부터");
되감기();
{
  const 허브 = { "d0922000001": true, "d0922000047": true, "d0922000012": true };
  const a = 뽑기(허브);
  console.log("   제일 큰 000047 다음 → " + a);
  ok("가장 큰 번호 + 1", a === "d0922000048", a);
}

console.log("\n③ 옛 난수 ID 가 섞여 있어도 헷갈리지 않는다");
되감기();
{
  //  0922-ds-816c07 은 16진수다. 십진수로 세어 816 으로 읽으면 틀린다.
  const 허브 = { "0922-ds-b1d1": true, "0922-ds-816c07": true, "d0922000005": true };
  const a = 뽑기(허브);
  console.log("   " + a);
  ok("숫자 여섯 자만 센다", a === "d0922000006", a);
}

console.log("\n④ 어제 번호는 안 센다 (날짜가 윗자리다)");
되감기();
{
  const 허브 = { "d0921000900": true, "d0922000003": true };
  ok("어제 900번이 오늘에 안 딸려온다", 뽑기(허브) === "d0922000004");
}

console.log("\n⑤ 허브엔 없고 업체 시트에만 있던 번호는 건너뛴다");
되감기();
{
  const 허브 = { "d0922000002": true };
  const a = 뽑기(허브);
  const 허브2 = Object.assign({}, 허브); 허브2["d0922000004"] = true;
  const b = 뽑기(허브2);
  console.log("   " + a + "   " + b);
  ok("쓰인 번호를 뛰어넘는다", a === "d0922000003" && b === "d0922000005", a + " , " + b);
}

console.log("\n⑥ 하루 1,000건을 뽑아도 하나도 안 겹친다 (난수면 100% 겹쳤다)");
되감기();
{
  const 본것 = {}; let 겹침 = 0, 마지막 = "";
  for (let i = 0; i < 1000; i++) {
    마지막 = 뽑기({});
    if (본것[마지막]) 겹침++; 본것[마지막] = true;
  }
  ok("1,000건 겹침 0", 겹침 === 0, "겹침 " + 겹침 + "건");
  ok("마지막이 001000", 마지막 === "d0922001000", 마지막);
}

console.log("\n⑦ 날이 바뀌면 다시 1번부터");
{
  오늘 = "20260923";
  ok("d0923000001", 뽑기({}) === "d0923000001");
}

console.log("\n⑧ 시스템이 발급한 ID 로 알아본다 (옛 모양도 계속 알아본다)");
{
  ok("d0922000001", 발급인가("d0922000001") === true);
  ok("p0922000001", 발급인가("p0922000001") === true);
  ok("0921-ds-b1d1", 발급인가("0921-ds-b1d1") === true);
  ok("0921-PH-816c07", 발급인가("0921-PH-816c07") === true);
  ok("260902-PH-a3f19", 발급인가("260902-PH-a3f19") === true);
  ok("2163979121 (사방넷)", 발급인가("2163979121") === false);
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
