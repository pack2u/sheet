/**
 * 인앱 브라우저(카카오톡 등)에서 스캔이 안 되는 문제
 *
 *  > "보통 카카오톡으로 링크를 보내. 클릭하면 카카오브라우저로 실행이
 *  >  되다보니 더 문제인거 같아"
 *
 *  이 스캔 모듈은 «팝업 창»으로 샌드박스를 벗어나 카메라를 연다.
 *  카카오·네이버·인스타 인앱 브라우저는 window.open 을 막거나 무시한다 —
 *  그러면 카메라가 아예 안 열린다. 게다가 종전 안내는 「팝업 차단을
 *  허용하세요」였는데, 카카오 안에는 그런 설정이 없다. 사람을 엉뚱한 데로 보냈다.
 *
 *  지켜야 할 것
 *    · 실제 UA 로 인앱을 알아본다
 *    · 안내가 «브라우저로 나가라»고 말해야 한다 (팝업 차단 얘기가 아니라)
 *    · 카카오는 한 번 눌러 기본 브라우저로 나간다
 *    · 일반 브라우저에서는 아무것도 안 바뀐다
 *
 * 실행: node _csinapp_test.js
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

const html = fs.readFileSync("csScanPopup.html", "utf8");
function grabFn(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { d++; seen = true; }
    else if (html[k] === "}") { d--; if (seen && d === 0) return html.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

//  실제 기기에서 찍은 UA 모양
const UA = {
  카카오안드로이드: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36 KAKAOTALK 10.4.5",
  카카오아이폰: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.4.5",
  네이버앱: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.9.2)",
  인스타: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 320.0.0",
  라인: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Line/14.5.0",
  크롬안드로이드: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36",
  사파리아이폰: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1",
};

function 판(ua) {
  const ctx = {
    navigator: { userAgent: ua },
    location: { href: "" },
    window: {},
  };
  ctx.window.open = function () { ctx._opened = true; return null; };
  vm.createContext(ctx);
  vm.runInContext([grabFn("csInAppBrowser"), grabFn("csScanPopupBlockedMsg"),
                   grabFn("csOpenInRealBrowser")].join("\n"), ctx);
  return ctx;
}

console.log("");
console.log("[알아보기] 어느 앱 안인가");
check("카카오 안드로이드", 판(UA.카카오안드로이드).csInAppBrowser(), "카카오톡");
check("카카오 아이폰", 판(UA.카카오아이폰).csInAppBrowser(), "카카오톡");
check("네이버 앱", 판(UA.네이버앱).csInAppBrowser(), "네이버 앱");
check("인스타그램", 판(UA.인스타).csInAppBrowser(), "인스타그램");
check("라인", 판(UA.라인).csInAppBrowser(), "라인");
check("★ 크롬은 인앱이 아니다", 판(UA.크롬안드로이드).csInAppBrowser(), "");
check("★ 사파리도 아니다", 판(UA.사파리아이폰).csInAppBrowser(), "");

console.log("");
console.log("[안내] 엉뚱한 데로 보내지 않는다");
{
  const m = 판(UA.카카오안드로이드).csScanPopupBlockedMsg();
  check("★ 카카오라고 이름을 대 준다", m.indexOf("카카오톡") >= 0, true);
  check("★ 「팝업 차단」 얘기를 하지 않는다", m.indexOf("팝업 차단") >= 0, false);
  check("브라우저에서 열라고 말한다", m.indexOf("브라우저에서 열기") >= 0, true);
}
{
  const m = 판(UA.크롬안드로이드).csScanPopupBlockedMsg();
  check("일반 브라우저는 종전 안내 그대로", m.indexOf("팝업 차단") >= 0, true);
}

console.log("");
console.log("[탈출] 한 번 눌러 진짜 브라우저로");
{
  const c = 판(UA.카카오안드로이드);
  c.csOpenInRealBrowser("https://script.google.com/a/macros/x/exec?page=barcode");
  check("★ 카카오는 openExternal 로 나간다",
    c.location.href.indexOf("kakaotalk://web/openExternal?url=") === 0, true);
  check("주소를 통째로 감싸 넘긴다",
    c.location.href.indexOf(encodeURIComponent("https://script.google.com")) > 0, true);
}
{
  const c = 판(UA.네이버앱);   // 안드로이드 · 카카오 아님
  c.csOpenInRealBrowser("https://script.google.com/a/macros/x/exec");
  check("★ 안드로이드는 intent:// 로 크롬을 부른다",
    c.location.href.indexOf("intent://") === 0, true);
  check("스킴·패키지를 적는다",
    c.location.href.indexOf("scheme=https;package=com.android.chrome;end") > 0, true);
  check("https:// 는 떼고 넘긴다", c.location.href.indexOf("intent://https") === 0, false);
}
{
  const c = 판(UA.인스타);     // iOS · 밖으로 보낼 방법이 없다
  const r = c.csOpenInRealBrowser("https://x/exec");
  check("iOS 인앱은 새 탭이라도 시도한다", r, true);
  check("주소를 안 주면 아무것도 안 한다", 판(UA.카카오아이폰).csOpenInRealBrowser(""), false);
}

console.log("");
console.log("[띠] 네 화면이 모두 이 모듈을 쓴다");
["barcode.html", "inventory.html", "return_intake.html", "scan_test.html"].forEach(function (f) {
  check(f + " 가 include 한다", fs.readFileSync(f, "utf8").indexOf("include('csScanPopup')") >= 0, true);
});
check("★ 띠를 세우는 코드가 이 모듈 안에 있다", html.indexOf("csInAppBanner") >= 0, true);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
