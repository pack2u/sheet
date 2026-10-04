/**
 * 협력업체 포털 — v2 보관소 사진도 썸네일로 그린다
 *
 *  > "왜 링크열기가 뜨지?"
 *
 *  ★ 무엇이 어긋나 있었나 ★
 *    CS 사진 보관소가 구글 드라이브에서 v2(Supabase)로 옮겨졌는데, 포털은
 *    드라이브 id 만 알아봤다. id 가 없으니 driveId 가 '' 를 돌려주고 그 줄은
 *    통째로 linkify 로 떨어져 「링크 열기」가 됐다.
 *    9월 대장만 봐도 보관소 374개 · 드라이브 100개 —
 *    새로 올라오는 것은 거의 다 보관소인데 업체 화면에서는 한 장도 안 보였다.
 *
 * 실행: node _prpphoto_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const html = fs.readFileSync(path.join(__dirname, "Partner_WebApp", "portal.html"), "utf8");
function 꺼내(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { d++; seen = true; }
    else if (html[k] === "}") { d--; if (seen && d === 0) return html.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const ctx = { String, Number, RegExp, encodeURIComponent, console };
vm.createContext(ctx);
["esc", "driveId", "storeUrl", "storeThumb", "photoSrc", "thumbsHtml", "linkify"]
  .forEach((n) => vm.runInContext(꺼내(n), ctx));

//  대장에 실제로 적힌 모양 그대로
const 드라이브 = "https://drive.google.com/file/d/17WxeT-JISesF_PCit3SHyZd_nBHggvgt/view?usp=drivesdk";
const 보관소 = "https://brpvenvdwlundhlstsuw.supabase.co/storage/v1/object/sign/return-photos/" +
  "2026-09-28/c343bd98-58c7-4748-8355-f58f673bde67.png?token=eyJhbGciOiJIUzUxMiJ9.abc.def" +
  "&download=%25EA%25B9%2580_1.png";

console.log("\n① 주소 하나를 «볼 수 있는 주소»로");
{
  const d = ctx.photoSrc(드라이브, 480);
  ok("드라이브 → 썸네일 주소", /drive\.google\.com\/thumbnail\?id=17WxeT/.test(d) && /sz=w480/.test(d), d);

  const s = ctx.photoSrc(보관소, 480);
  ok("★ 보관소 → 그릴 수 있는 주소가 나온다", !!s, s);
  ok("  작게 받는 길로 바꾼다", s.indexOf("/storage/v1/render/image/sign/") >= 0, s.slice(0, 80));
  ok("  너비·품질을 붙인다", /width=480/.test(s) && /quality=70/.test(s));
  ok("  토큰을 안 잃는다 (잃으면 403 이다)", s.indexOf("token=") >= 0);

  ok("★ 남의 서버 주소는 안 받는다 (<img> 로 부르면 안 된다)",
    ctx.photoSrc("https://example.com/a.png", 480) === "", ctx.photoSrc("https://example.com/a.png", 480));
  ok("  빈 값도 안 터진다", ctx.photoSrc("", 480) === "" && ctx.photoSrc(null, 480) === "");
  ok("크게보기는 1600 으로", /width=1600/.test(ctx.photoSrc(보관소, 1600)));
}

console.log("\n② 썸네일 — 보관소 사진 넉 장이 다 그려진다");
{
  const 줄 = "사진 첨부 4장. " + [보관소, 보관소, 보관소, 보관소].join(" ");
  const h = ctx.thumbsHtml(줄);
  const n = (h.match(/class="thumb"/g) || []).length;
  ok("★ 버튼 4개", n === 4, String(n));
  ok("  크게볼 주소를 싣는다", (h.match(/data-full="/g) || []).length === 4);
  ok("  원본으로 물러설 주소도 싣는다", (h.match(/data-raw="/g) || []).length === 4);
  ok("  안 되면 「사진 열기」 글자가 남는다", /사진<br>열기/.test(h));

  const 섞임 = ctx.thumbsHtml([드라이브, 보관소, "https://example.com/a.png"].join(" "));
  ok("드라이브·보관소를 같이 그리고 남의 주소는 뺀다",
    (섞임.match(/class="thumb"/g) || []).length === 2, 섞임.slice(0, 60));
  ok("사진이 없으면 빈 문자열", ctx.thumbsHtml("사진 없는 메모") === "");
}

console.log("\n③ 본문 속 링크 — 사진이면 「사진 열기」");
{
  const h = ctx.linkify("사진 첨부 4장. " + 보관소);
  ok("★ 「링크 열기」가 아니라 「사진 열기」", /사진 열기/.test(h) && !/링크 열기/.test(h), h.slice(-90));
  ok("  크게볼 주소를 싣는다", /data-full="/.test(h));
  ok("  토큰을 안 잃는다 (esc 가 & 를 &amp; 로 바꾼 것을 되돌린다)",
    /token=/.test(h) && !/&amp;amp;/.test(h));

  const d = ctx.linkify("사진 첨부. " + 드라이브);
  ok("드라이브도 「사진 열기」", /사진 열기/.test(d) && !/링크 열기/.test(d));

  const x = ctx.linkify("자세한 것은 https://example.com/guide 참고");
  ok("사진이 아닌 주소는 「링크 열기」 그대로", /링크 열기/.test(x) && !/사진 열기/.test(x));
}

console.log("\n④ 크게보기는 «주소»를 받는다");
{
  const src = 꺼내("openLightbox");
  ok("★ id 로 드라이브 주소를 다시 짓지 않는다",
    !/drive\.google\.com\/thumbnail/.test(src), src.replace(/\s+/g, " ").slice(0, 90));
  ok("  받은 주소를 그대로 쓴다", /photoFull'\)\.src = src/.test(src), src.replace(/\s+/g, " ").slice(0, 90));
  ok("  누를 때 data-full 을 넘긴다", /openLightbox\(thumb\.getAttribute\('data-full'\)\)/.test(html));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
