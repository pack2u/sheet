/**
 * 반품 «영상»을 세 자리가 같게 가르는가 — CS 화면 · CS 서버 · 업체 포털.
 *
 * ★ 왜 이 시험이 있나 ★  (2026-10-04)
 *   v2 물류 입고가 영상도 올린다. 가르는 규칙이 세 파일에 «따로» 적혀 있다 —
 *     CS 화면   home.html        retIsVideoUrl   → 「▶ 영상」 칸
 *     CS 서버   csReturnIntake.gs _cs_isVideoUrl_ → 대장에 「영상 1개」
 *     업체 포털 portal.html      isVideoUrl      → 「▶ 영상」 칸
 *   한 곳만 고치면 조용히 갈라진다. 그러면 CS 는 영상으로 그리고 업체는
 *   사진으로 그려 «깨진 네모»를 본다. 10/01 에 포털이 빠진 것이 정확히 그 일이다.
 *
 *   손으로 옮겨 적지 않고 세 파일에서 함수를 그대로 꺼내 쓴다 —
 *   옮겨 적으면 시험이 코드가 아니라 내 기억을 검사하게 된다.
 *
 * 실행: node Partner_WebApp/_prpvideo_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 안 올라간다)
 */
var fs = require("fs");
var path = require("path");
var 뿌리 = path.join(__dirname, "..");
var 곳 = function (p) { return path.join(뿌리, p); };

function 꺼내기(src, 이름) {
  var i = src.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 못 찾음");
  var 깊이 = 0, 시작 = src.indexOf("{", i);
  for (var k = 시작; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (!깊이) return src.substring(i, k + 1); }
  }
  throw new Error(이름 + " 끝 못 찾음");
}

var 화면 = fs.readFileSync(곳("CS_WebApp/home.html"), "utf8");
var 서버 = fs.readFileSync(곳("CS_WebApp/csReturnIntake.gs"), "utf8");
var 포털 = fs.readFileSync(곳("Partner_WebApp/portal.html"), "utf8");

eval(꺼내기(화면, "retIsVideoUrl"));
eval(꺼내기(서버, "_cs_isVideoUrl_"));
eval(꺼내기(포털, "isVideoUrl"));
eval(꺼내기(포털, "driveId"));
eval(꺼내기(포털, "storeUrl"));
eval(꺼내기(포털, "storeThumb"));
eval(꺼내기(포털, "photoSrc"));
eval(꺼내기(포털, "videoSrc"));
eval(꺼내기(포털, "attachCount"));

var 실패 = 0;
function ok(이름, 참) {
  if (!참) 실패++;
  console.log((참 ? "  " : "★ ") + 이름 + (참 ? "" : "   ← 틀림"));
}

/*  보관소(Supabase) 서명 주소 — v2 가 주는 모양 그대로 */
var 터 = "https://xxx.supabase.co/storage/v1/object/sign/cs-return/2026/10/";
var 사진1 = 터 + "a1.jpg?token=aaa";
var 사진2 = 터 + "a2.png?token=bbb";
var 영상1 = 터 + "v1.mp4?token=ccc";
var 영상2 = 터 + "v2.MOV?token=ddd";
var 드라이브 = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view";
var 남의것 = "https://trace.cjlogistics.com/next/tracking.html?wblNo=123456789012";

console.log("\n[1] ★ 세 자리가 같은 것을 영상이라 부른다");
[
  ["사진 jpg", 사진1],
  ["사진 png", 사진2],
  ["영상 mp4", 영상1],
  ["영상 MOV (큰 글자)", 영상2],
  ["영상 webm", 터 + "v.webm?token=e"],
  ["영상 3gp", 터 + "v.3gp"],
  ["물음표 없는 mp4", 터 + "v.mp4"],
  ["이름에 mp4 가 끼었을 뿐", 터 + "mp4photo.jpg?token=f"],
  ["주소 뒤에 .mp4 글자만", 터 + "a.jpg?name=x.mp4"],
  ["드라이브 보기 주소", 드라이브],
  ["남의 주소", 남의것],
  ["빈 값", ""]
].forEach(function (쌍) {
  var 이름 = 쌍[0], u = 쌍[1];
  var a = !!retIsVideoUrl(u), b = !!_cs_isVideoUrl_(u), c = !!isVideoUrl(u);
  while (이름.length < 22) 이름 += " ";
  ok(이름 + (c ? "영상" : "사진") + "   (화면 " + (a ? "영상" : "사진") +
     " · 서버 " + (b ? "영상" : "사진") + ")", a === b && b === c);
});

console.log("\n[2] ★ 영상은 «사진 주소»를 내주지 않는다");
/*  photoSrc 가 주소를 돌려주면 그 주소가 <img> 와 라이트박스로 간다.
    10/01 의 증상이 바로 그것이었다 — 「사진 열기」가 떠서 눌러도 아무것도 안 뜬다. */
ok("영상 → photoSrc 빈 값", photoSrc(영상1, 480) === "");
ok("영상 → videoSrc 주소 있음", videoSrc(영상1) === 영상1);
ok("사진 → photoSrc 주소 있음", photoSrc(사진1, 480).indexOf("render/image/sign") > 0);
ok("사진 → videoSrc 빈 값", videoSrc(사진1) === "");
ok("남의 주소 → 둘 다 빈 값", photoSrc(남의것, 480) === "" && videoSrc(남의것) === "");

console.log("\n[3] ★ 적힌 수와 보이는 수가 맞는다");
/*  대장이 적는 말(「사진 2장 · 영상 1개」)과 같은 셈이어야 한다. */
function 셈(t) { var r = attachCount(t); return r.사진 + "/" + r.영상; }
ok("사진 2 · 영상 1          → 2/1", 셈(사진1 + " " + 사진2 + " " + 영상1) === "2/1");
ok("영상만 2                 → 0/2", 셈(영상1 + " " + 영상2) === "0/2");
ok("사진 1                   → 1/0", 셈("박스 상태 " + 사진1) === "1/0");
ok("송장조회 링크는 안 센다   → 0/0", 셈("조회: " + 남의것) === "0/0");
ok("글만 있는 줄             → 0/0", 셈("수거 완료했습니다") === "0/0");

console.log("");
console.log(실패 ? "★ 틀림 " + 실패 + "건" : "세 자리가 같은 규칙을 쓴다");
process.exit(실패 ? 1 : 0);
