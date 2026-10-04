/**
 * 보드 첨부 — 올린 사진을 «다시 볼 수 있는가»
 *
 *  > "cs웹앱에 이미지를 올리니까 구글 드라이브로 올라가나봐..
 *  >  다시보려면 이미지를 못보내.. 이미지업로드 확인해줘"   (2026-09-16)
 *
 *  ★ 무엇이 어긋나 있었나 ★
 *    2026-09-10 부터 파일은 드라이브가 아니라 v2 저장소로 올라간다.
 *    그런데 _cs_hb_parseAtt_ 는 fileId 를 «드라이브 파일 ID»로 알고
 *    주소를 만들고 있었다 —
 *
 *        https://drive.google.com/thumbnail?id=2026-09-16/uuid.jpg
 *
 *    그런 파일은 드라이브에 없다. 올라가긴 했는데 다시 볼 수가 없다.
 *    반품 쪽은 9/14 에 같은 사고를 고쳤는데(retPhotoItems) 보드는 그대로였다.
 *
 *  지켜야 할 것
 *    · v2 주소를 «받아 적는다» — ID 로 만들어 내는 것은 드라이브일 때만 된다
 *    · 옛 드라이브 파일은 예전처럼 ID 로 주소를 만든다 (같이 깨지면 안 된다)
 *    · 주소 없는 v2 경로는 «잃었다»고 밝힌다 — 깨진 그림을 말없이 보이지 않는다
 *    · 칸을 맨 뒤에 붙인다 — 다섯 칸짜리 옛 줄이 그대로 읽혀야 한다
 *
 * 실행: node _cshbatt_test.js
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

const src = fs.readFileSync("csHandoffBoard.gs", "utf8");
function grab(name) {
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
vm.runInContext(
  ["_cs_hb_attSafe_", "_cs_hb_parseAtt_", "_cs_hb_attToLines_",
   "_cs_hb_isStorePath_", "_cs_hb_storeThumb_"].map(grab).join("\n"), ctx);

const parse = (raw) => vm.runInContext("_cs_hb_parseAtt_(" + JSON.stringify(raw) + ")", ctx);
const toLines = (list) => vm.runInContext("_cs_hb_attToLines_(" + JSON.stringify(list) + ")", ctx);

const V2URL = "https://brpvenvdwlundhlstsuw.supabase.co/storage/v1/object/sign/" +
  "board-files/2026-09-16/abc-123.jpg?token=eyJhbGciOi&download=%EC%82%AC%EC%A7%84.jpg";
const V2PATH = "2026-09-16/abc-123.jpg";
const DRIVEID = "1AbCdEfGhIjKlMnOpQrStUvWxYz01234";

console.log("\n[1] v2 에 올린 새 사진 — 받아 적은 주소를 쓴다");
{
  const a = parse([V2PATH, "사진.jpg", "image/jpeg", "260916 10:00", "김담당", V2URL].join("|"))[0];
  check("사진으로 본다", a.isImage, true);
  check("잃지 않았다", a.lost, false);
  check("★ 드라이브 주소가 아니다", /drive\.google\.com/.test(a.thumbUrl), false);
  check("★ 작게 받는 주소로 바꾼다",
    a.thumbUrl.indexOf("/storage/v1/render/image/sign/") >= 0, true);
  check("폭을 지정한다", a.thumbUrl.indexOf("width=200") >= 0, true);
  check("크게 보기는 2048", a.bigUrl.indexOf("width=2048") >= 0, true);
  check("★ 원본은 받아 적은 그대로", a.viewUrl, V2URL);
  check("서명 토큰이 살아 있다", a.viewUrl.indexOf("token=") >= 0, true);
}

console.log("\n[2] 드라이브에 있는 옛 파일 — 예전처럼 ID 로 만든다");
{
  const a = parse([DRIVEID, "옛사진.jpg", "image/jpeg", "260901 09:00", "박담당"].join("|"))[0];
  check("사진으로 본다", a.isImage, true);
  check("잃지 않았다", a.lost, false);
  check("★ 드라이브 썸네일", a.thumbUrl,
    "https://drive.google.com/thumbnail?id=" + DRIVEID + "&sz=w200");
  check("★ 크게 보기도 드라이브", a.bigUrl,
    "https://drive.google.com/thumbnail?id=" + DRIVEID + "&sz=w2048");
  check("원본은 드라이브 페이지", a.viewUrl,
    "https://drive.google.com/file/d/" + DRIVEID + "/view");
}

console.log("\n[3] ★ 주소 없는 v2 경로 — 「잃었다」고 밝힌다");
{
  /*  9/10~9/16 에 올린 것. 경로만 있고 주소가 없다.
      여태는 이 경로로 드라이브 주소를 만들어 깨진 그림을 보여 줬다. */
  const a = parse([V2PATH, "사진.jpg", "image/jpeg", "260912 14:00", "김담당"].join("|"))[0];
  check("★ 잃었다고 밝힌다", a.lost, true);
  check("★ 드라이브 주소를 만들지 않는다", a.thumbUrl, "");
  check("사진으로 안 그린다 (깨진 그림 대신 표시를 낸다)", a.isImage, false);
  check("원본 링크도 없다 (죽은 링크를 주지 않는다)", a.viewUrl, "");
  check("경로는 남긴다 (나중에 다시 서명할 열쇠다)", a.fileId, V2PATH);
}

console.log("\n[4] 경로인지 ID 인지 가리기");
{
  const isPath = (v) => vm.runInContext("_cs_hb_isStorePath_(" + JSON.stringify(v) + ")", ctx);
  check("v2 경로", isPath(V2PATH), true);
  check("드라이브 ID", isPath(DRIVEID), false);
  check("빈 값", isPath(""), false);
}

console.log("\n[5] 칸을 맨 뒤에 붙였다 — 옛 줄이 그대로 읽힌다");
{
  //  다섯 칸짜리 옛 드라이브 줄. 여섯째 칸이 없어도 멀쩡해야 한다.
  const 옛줄 = [DRIVEID, "옛사진.jpg", "image/jpeg", "260901 09:00", "박담당"].join("|");
  const a = parse(옛줄)[0];
  check("이름", a.name, "옛사진.jpg");
  check("올린이", a.by, "박담당");
  check("주소 칸은 빈 값", a.url, "");

  //  다시 줄로 만들면 여섯 칸이 되지만 값은 그대로다
  const 새줄 = toLines([a]);
  check("여섯 칸이 된다", 새줄.split("|").length, 6);
  const b = parse(새줄)[0];
  check("★ 되읽어도 같다 (드라이브 썸네일 그대로)", b.thumbUrl, a.thumbUrl);
  check("★ 잃은 것으로 뒤바뀌지 않는다", b.lost, false);
}

console.log("\n[6] v2 주소가 줄에 살아남는다");
{
  const a = parse([V2PATH, "사진.jpg", "image/jpeg", "260916 10:00", "김담당", V2URL].join("|"))[0];
  const 줄 = toLines([a]);
  check("주소가 줄에 적힌다", 줄.indexOf(V2URL) >= 0, true);
  const b = parse(줄)[0];
  check("★ 되읽어도 주소가 산다", b.viewUrl, V2URL);
  check("잃지 않았다", b.lost, false);
}

console.log("\n[7] 올릴 때 주소를 담는다 (csAttachHandoffFile)");
{
  check("★ v2 가 준 주소를 받는다", /fileUrl = String\(put\.url \|\| ''\)/.test(src), true);
  check("★ 첨부 항목에 싣는다", /fileId: fileId, url: fileUrl/.test(src), true);
  check("줄로 만들 때도 싣는다", /_cs_hb_attSafe_\(a\.url \|\| ''\)/.test(src), true);
}

console.log("\n[8] 화면 — 깨진 그림 대신 까닭을 보인다");
{
  const html = fs.readFileSync("home.html", "utf8");
  check("잃은 첨부를 따로 그린다", html.indexOf("hb-thumb-lost") >= 0, true);
  check("무엇을 해야 하는지 말한다", html.indexOf("주소를 잃었습니다. 다시 올려주세요") >= 0, true);
  check("★ 작은 그림이 안 오면 원본으로 물러선다",
    html.indexOf("function hbThumbFallback(img)") >= 0, true);
  check("한 번만 물러선다 (무한히 오가지 않게)",
    /hbThumbFallback[\s\S]{0,300}img\.dataset\.fellBack/.test(html), true);
  check("크게 보기도 물러선다", /img\.dataset\.lbFellBack/.test(html), true);
}

console.log("\n[9] 몇 장이 못 보게 됐는지 셀 수 있다");
{
  check("점검 함수가 있다", src.indexOf("function csDiagnoseBoardAttachments()") >= 0, true);
  check("★ 아무것도 안 고친다 (세기만 한다)",
    /function csDiagnoseBoardAttachments[\s\S]*?setValue\(/.test(src), false);
  check("어느 카드인지 짚어 준다", src.indexOf("해당 카드 (최대 12건)") >= 0, true);
}


console.log("\n[10] v2 가 받는 kind 만 보낸다");
{
  /*  ★ 2026-09-16 ★  csLogistics 가 kind 를 "intake" 로 보내고 있었다.
      v2 는 return · board 둘만 받는다. 400 이 떨어지면 아래 폴백이 조용히
      받아 «그 직원 개인 드라이브»에 만들었다 — 9/10~9/11 에 개인 드라이브를
      떼어내려던 일이 여기서만 안 먹고 있었다. 오류도 안 나서 아무도 몰랐다.

      v2 의 BUCKET 표를 «읽어서» 맞춘다. 베껴 적으면 v2 가 통을 늘릴 때
      여기만 옛것으로 남는다. */
  const 받는kind = (function () {
    const 길 = "../../Pack2U_협력업체시스템_v2/app/src/app/api/files/upload/route.ts";
    let t;
    try { t = fs.readFileSync(길, "utf8"); } catch (e) { return null; }
    const m = t.match(/const BUCKET[^=]*=\s*\{([\s\S]*?)\}/);
    if (!m) return null;
    return (m[1].match(/^\s*([A-Za-z_]+)\s*:/gm) || [])
      .map((x) => x.replace(/[\s:]/g, ""));
  })();

  const 보내는kind = [];
  for (const f of fs.readdirSync(".")) {
    if (!/\.gs$/.test(f)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/csFileStorePut\("([^"]+)"/g)) {
      if (보내는kind.indexOf(m[1]) < 0) 보내는kind.push(m[1]);
    }
  }
  보내는kind.sort();

  if (받는kind) {
    받는kind.sort();
    const 모름 = 보내는kind.filter((k) => 받는kind.indexOf(k) < 0);
    check("v2 가 받는 kind 를 읽었다", 받는kind.length > 0, true);
    check("★ v2 가 모르는 kind 를 보내지 않는다", 모름, []);
  } else {
    //  v2 저장소를 옆에 안 둔 사람도 있다. 그때는 아는 값으로 본다.
    check("★ v2 가 모르는 kind 를 보내지 않는다",
      보내는kind.filter((k) => ["return", "board"].indexOf(k) < 0), []);
  }
  check("보내는 kind", 보내는kind, ["board", "return"]);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
