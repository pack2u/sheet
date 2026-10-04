/**
 * 반품 카드 수거택배사 — 모르면 롯데로 치지 않는다
 *
 *  > "CS 웹앱 반품카드에서 수거택배사가 현재 롯데로 되있는데 로젠으로 바꿔줘"
 *    (2026-09-16)
 *
 *  ★ 두 군데가 롯데로 짐작하고 있었다 ★
 *    home.html  carrierLabel()          — 맨 끝에서 «무조건» 롯데택배
 *    csOrderSearch.gs _cs_carrierFromSource_ — 「합포장」·「1주출고」을 롯데로
 *
 *  2026-09-11 에 자사출고가 로젠으로 바뀌었는데 이 둘이 그대로였다.
 *  허브(_pep_carrierFromSource_)는 9/15 에 같은 줄을 지웠다 — CS 는 별도
 *  프로젝트라 안 따라왔다. 한 군데를 고치면 같은 일을 하는 다른 군데도 봐야 한다.
 *
 *  ★ 「로젠으로 바꿔라」를 «로젠으로 박아라»로 읽지 않는다 ★
 *    출처가 로젠이면 로젠이 나온다. 대리발송이면 그 업체 택배사가 나온다.
 *    모르면 빈칸이다 — 빈칸은 네이버 조회로 받아 주고 안내문도 그에 맞게 나간다.
 *    지금 자사출고가 로젠이니 결과적으로 로젠이 뜬다. 다음에 또 갈아타도
 *    이 코드는 안 고쳐도 된다.
 *
 * 실행: node _cscarrier_test.js
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

const html = fs.readFileSync("home.html", "utf8");
const gs = fs.readFileSync("csOrderSearch.gs", "utf8");

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

const ctx = {};
vm.createContext(ctx);
vm.runInContext(grab(html, "carrierLabel") + "\n" + grab(html, "isProxySource"), ctx);
vm.runInContext(grab(gs, "_cs_carrierFromSource_"), ctx);
const 화면 = (s) => vm.runInContext("carrierLabel(" + JSON.stringify(s) + ")", ctx);
const 서버 = (s) => vm.runInContext("_cs_carrierFromSource_(" + JSON.stringify(s) + ")", ctx);

console.log("\n[1] ★ 자사출고는 로젠으로 나온다");
{
  check("화면 — 로젠", 화면("로젠"), "로젠택배");
  check("서버 — 로젠", 서버("로젠"), "로젠택배");
  check("화면 — 로젠(전화)", 화면("로젠(전화)"), "로젠택배");
  check("서버 — 입력_로젠주문실적", 서버("입력_로젠주문실적"), "로젠택배");
}

console.log("\n[2] ★ 「합포장」·「1주출고」는 택배사가 아니다");
{
  /*  둘은 «어떻게 묶였나»를 말하는 이름표다. 동봉 줄은 대표의 송장을
      물려받고, 그 대표는 택배사 탭에서 걷힌다.  */
  check("서버 — 합포장", 서버("합포장"), "");
  check("서버 — 1주출고", 서버("1주출고"), "");
}

console.log("\n[3] ★ 모르면 «빈칸» — 롯데로 짐작하지 않는다");
{
  check("화면 — 빈 출처", 화면(""), "");
  check("화면 — 처음 보는 출처", 화면("미매칭"), "");
  check("화면 — 허브", 화면("허브"), "");
  check("서버 — 빈 출처", 서버(""), "");
  check("서버 — 처음 보는 출처", 서버("미매칭"), "");
}

console.log("\n[4] 롯데라고 «적혀 있으면» 롯데다 (예비로 남아 있다)");
{
  check("화면", 화면("롯데"), "롯데택배");
  check("서버", 서버("롯데택배"), "롯데택배");
}

console.log("\n[5] 다른 택배사도 그대로");
{
  check("한진", 화면("한진"), "한진택배");
  check("CJ", 화면("CJ대한통운"), "CJ대한통운");
  check("대신", 서버("대신"), "대신택배");
  check("우체국", 서버("우체국"), "우체국");
}

console.log("\n[6] 코드에 롯데를 박아 둔 자리가 없다");
{
  const 몸 = grab(html, "carrierLabel");
  /*  「if 안의 롯데」는 맞다 — 적혀 있으면 롯데다.
      지켜야 할 것은 «맨 끝»이 빈칸이라는 것이다. 거기가 「모르면 롯데」였다. */
  var 주석없애기 = new RegExp("\\/\\*[\\s\\S]*?\\*\\/", "g");
  var 줄주석 = new RegExp("\\/\\/[^\\n]*", "g");
  const 알맹이 = 몸.replace(주석없애기, "").replace(줄주석, "").trim();
  const 마지막 = 알맹이.slice(알맹이.lastIndexOf("return"));
  check("★ 맨 끝은 빈칸이다 (모르면 롯데가 아니다)", /return '';/.test(마지막), true);

  const 서버몸 = grab(gs, "_cs_carrierFromSource_").replace(/\/\*[\s\S]*?\*\//g, "");
  check("★ 서버도 합포장·1주출고를 롯데로 안 친다",
    /합포장|1주출고/.test(서버몸), false);
  check("서버는 모르면 빈칸으로 끝난다", /return "";\s*\}$/.test(서버몸.trim()), true);
}

console.log("\n[7] 빈칸이어도 화면이 멀쩡하다");
{
  /*  택배사를 모르면 네이버가 받아 준다. 안내문도 그에 맞게 나간다.
      그러니 빈칸으로 두는 것이 안전하다 — 틀린 곳으로 보내지 않는다.  */
  check("네이버 조회가 있다", html.indexOf("function naverTrackUrl(") >= 0, true);
  check("★ 택배사를 모를 때 안내문이 따로 있다",
    html.indexOf("공급처 출고(택배사가 건마다 다를 수 있습니다)") >= 0, true);
}

console.log("\n[8] 화면의 보기글도 지금 쓰는 택배사로");
{
  check("새 반품 카드", html.indexOf('id="retNewPickup" type="text" placeholder="예: 로젠택배"') >= 0, true);
  check("★ 롯데를 보기로 들지 않는다",
    html.indexOf('placeholder="예: 롯데택배"') >= 0, false);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
