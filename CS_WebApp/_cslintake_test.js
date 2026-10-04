/**
 * 물류팀 반품입고 사진 — 회사 계정으로 올라가는가
 *
 *  > "모바일 물류팀 반품입고 사진촬영 및 등록을 마무리 짓자"
 *
 *  이 웹앱은 «접속한 사람» 권한으로 돈다. 사진을 여기서 바로 만들면 소유자가
 *  «찍은 물류팀원»이 된다. 반품 첨부(csAttach)가 2026-09-10 에 그 일을 겪었다 —
 *  2주치 사진이 직원 개인 지메일 소유였고, 그 사람이 계정을 정리하면
 *  대장의 링크가 통째로 죽는다. 그때 csAttach 만 고쳤고 이 화면은 남아 있었다.
 *
 *  지켜야 할 것 — csAttach 와 «같은 규칙»이라야 한다
 *    · 파일보관소(csFileStorePut)가 먼저다. 회사 계정이 만든다
 *    · 드라이브 폴더는 «뒷길» — 보관소가 실패했을 때만 연다(미리 열지 않는다)
 *    · 둘 다 막히면 두 까닭을 «둘 다» 말한다
 *    · 성공해도 개인 드라이브로 떨어졌으면 그 사실을 화면에 말한다
 *
 * 실행: node _cslintake_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const L = fs.readFileSync("csLogistics.gs", "utf8");
const A = fs.readFileSync("csAttach.gs", "utf8");

//  csLogisticsSubmit 본문만 떼어 낸다
function body(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const 제출 = body(L, "csLogisticsSubmit");

console.log("");
console.log("[보관소] 회사 계정이 파일을 만든다");
check("★ csFileStorePut 을 쓴다", 제출.indexOf("csFileStorePut(") >= 0, true);
check("★ 반품 첨부와 같은 함수다", A.indexOf("csFileStorePut(") >= 0, true);
check("보관소가 되면 그 url 을 쓴다", 제출.indexOf("links.push(put.url)") >= 0, true);

console.log("");
console.log("[뒷길] 드라이브 폴더는 실패했을 때만 연다");
check("★ 미리 열지 않는다 (var folder = _cs_attFolder_() 가 사라졌다)",
  제출.indexOf("var folder = _cs_attFolder_();") >= 0, false);
check("★ 필요할 때 여는 꼴이다", 제출.indexOf("if (!_folder) _folder = _cs_attFolder_();") >= 0, true);
check("폴더에 만든 파일은 링크로 볼 수 있게 연다",
  제출.indexOf("DriveApp.Access.ANYONE_WITH_LINK") >= 0, true);

console.log("");
console.log("[말하기] 조용히 넘어가지 않는다");
check("★ 둘 다 막히면 두 까닭을 다 말한다",
  제출.indexOf("① 파일보관소: ") >= 0 && 제출.indexOf("② 개인 드라이브: ") >= 0, true);
check("★ 성공해도 개인 드라이브면 말한다",
  제출.indexOf("파일보관소를 못 써서 개인 드라이브에 올렸습니다") >= 0, true);
check("반품 첨부도 같은 말을 한다",
  A.indexOf("파일보관소를 못 써서 개인 드라이브에 올렸습니다") >= 0, true);

console.log("");
console.log("[용량] 한도는 그대로 지킨다");
check("장수·용량 검사가 남아 있다", 제출.indexOf("_CSL_MAX_BYTES_") >= 0, true);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
