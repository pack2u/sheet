/**
 * 대리발송업체 등록 — GS(지에스) · SI(삼일)
 *
 *  > "업체등록이 되있는지 확인해줘  코드는 GS"   "업으면 등록해줘"
 *  > "이 업체도 추가해줘.. 삼일...코드는SI"
 *
 *  ★ 왜 이 표가 중요한가 ★
 *    품목코드 앞 두 글자로 업체를 가린다(ssVendorOf). 이 표에 없는 코드로
 *    대리발송이 걸리면 「업체코드확인」으로 «보류»된다 — 나가야 할 것이 안 나간다.
 *    GS 접두 품목이 251개, SI 가 20개(실링기계)인데 둘 다 표에 없었다.
 *
 * 실행: node _ssvendor_test.js
 */
const fs = require("fs"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const mst = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasMasters.js"), "utf8");

console.log("\n① 넣을 업체가 적혀 있다");
{
  const 시작 = mst.indexOf("var SS_SEED_업체 = [");
  const 끝 = mst.indexOf("];", 시작);
  ok("표가 있다", 시작 >= 0 && 끝 > 시작);
  const 씨 = eval(mst.slice(시작 + "var SS_SEED_업체 = ".length, 끝 + 1));
  ok("GS 지에스", 씨.some((r) => r[0] === "GS" && r[1] === "지에스"), JSON.stringify(씨));
  ok("SI 삼일", 씨.some((r) => r[0] === "SI" && r[1] === "삼일"), JSON.stringify(씨));
  ok("코드는 대문자 두 글자다 (품목코드 앞 두 글자와 맞춘다)",
    씨.every((r) => /^[A-Z]{2}$/.test(r[0])));
  ok("업체 시트 주소를 주석에 남겨 둔다 (나중에 누가 찾을 때)",
    /18bp2Gd4/.test(mst) && /1NuBrK5q/.test(mst));
}

console.log("\n② 없을 때만 넣는다 (표의 주인은 시트다)");
{
  ok("심는 함수가 있다", /function ssm_업체심기_\(\)/.test(mst));
  ok("★ 이미 있으면 안 건드린다", /if \(있다\[SS_SEED_업체\[s\]\[0\]\]\) continue;/.test(mst));
  ok("  대소문자를 안 가린다", /ssText\(body\[i\]\[0\]\)\.toUpperCase\(\)/.test(mst));
  ok("  맨 뒤에 붙인다 (있던 줄을 안 민다)", /getRange\(끝 \+ 1, 1, 넣을것\.length, 2\)/.test(mst));
  ok("  넣은 것을 남긴다", /\[업체 심기\]/.test(mst));
  ok("  못 넣어도 실행은 계속한다", /\[업체 심기\] 실패/.test(mst));
}

console.log("\n③ 마스터를 읽을 때 심는다");
{
  ok("★ vendors 를 만들기 «전»에 심는다 (그 회차부터 먹는다)",
    /M\.vendors = \{\};[\s\S]{0,40}ssm_업체심기_\(\);[\s\S]{0,60}var vd = ssio_body\(SSIO_TABS\.업체\);/.test(mst));
  //  ssm_captureManual 쪽 vd 는 건드리지 않는다 — 거기서 심으면 조치를 걷을 때마다 쓴다
  const 심는곳 = (mst.match(/ssm_업체심기_\(\);/g) || []).length;
  ok("부르는 곳은 한 군데뿐이다", 심는곳 === 1, String(심는곳));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
